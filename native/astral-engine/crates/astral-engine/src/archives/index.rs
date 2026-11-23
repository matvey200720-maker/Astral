//! Команды `index-archive` (опись архива) и `extract-archive-entries`
//! (выемка названных записей в плоскую папку), а также упорядочение путей,
//! которым пользуются соседи.

use serde_json::{json, Value};

use crate::{
    args::Options,
    clock::Utc,
    error::{EngineError, Result},
    paths::{existing_file, full_path, output_file},
    progress::Progress,
    response::ascii_json,
};

use rage_rpf::read_pace::{self, ReadPace};
use rage_rpf::Archive;
use rage_rpf::EntryCipher;
use rage_rpf::EntryId;
use rage_rpf::EntryKind;
use rage_rpf::KeySet;

use super::sha256_hex;
use super::{content, load_keys, sha256_file};

use std::{
    cmp::Ordering,
    collections::{hash_map::Entry, HashMap, HashSet, VecDeque},
    fs,
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{self, AtomicUsize},
        Arc, OnceLock,
    },
    thread::{self, scope},
};

/// Знак для сравнения: единственный знак его верхнего регистра, иначе он сам.
fn fold_char(ch: char) -> char {
    if ch.is_ascii() {
        return ch.to_ascii_uppercase();
    }
    let mut upper = ch.to_uppercase();
    upper
        .next()
        .filter(|_| upper.next().is_none())
        .unwrap_or(ch)
}

/// Порядок путей без учёта регистра: знаки по коду после одиночной замены на верхний.
pub fn compare_ignore_case(left: &str, right: &str) -> Ordering {
    left.chars()
        .map(fold_char)
        .cmp(right.chars().map(fold_char))
}

/// Число потоков хеширования: половина доступных процессоров вверх, не меньше одного.
pub fn worker_count() -> usize {
    match thread::available_parallelism() {
        Ok(cpus) => cpus.get().div_ceil(2),
        Err(_) => 1,
    }
}

/// Набор ключей по `--keys` и `--game-root`; метка источника вызывающему не нужна.
fn keys_from(options: &Options) -> Result<Arc<KeySet>> {
    let game_root = options.optional("game-root").unwrap_or_default();
    let (keys, _source) = load_keys(game_root, options.optional("keys"))?;
    Ok(keys)
}

/// Параметр-путь `key`: его значение проходит проверку `check` для файла с
/// расширением `extension`.
fn path_param(
    check: fn(&str, &[&str]) -> Result<PathBuf>,
    options: &Options,
    key: &str,
    extension: &str,
) -> Result<PathBuf> {
    check(options.required(key)?, &[extension])
}

fn open_shared(keys: &Arc<KeySet>, input: &Path) -> Result<Arc<Archive>> {
    let archive = Archive::open_path(input, Some(Arc::clone(keys)))?;
    Ok(Arc::new(archive))
}

// ---------------------------------------------------------------------------
// Обход записей
// ---------------------------------------------------------------------------

/// Запись, на которую вышел обход: путь, архив с ней и номер в нём, глубина
/// архива (у корневого она нулевая).
struct Visit {
    path: String,
    place: (Arc<Archive>, EntryId),
    depth: usize,
}

/// Каталог в стопке обхода: архив с глубиной, очередь его файлов и подкаталогов
/// и путь к каталогу.
struct Frame {
    place: (Arc<Archive>, usize),
    queue: VecDeque<Item>,
    prefix: String,
}

/// Что ещё не выдано из каталога.
enum Item {
    File(EntryId),
    Dir(EntryId),
}

impl Frame {
    fn new(depth: usize, prefix: String, dir: EntryId, archive: &Arc<Archive>) -> Frame {
        let files = archive.files(dir).iter().map(|&id| Item::File(id));
        let dirs = archive.dirs(dir).iter().map(|&id| Item::Dir(id));
        Frame {
            place: (Arc::clone(archive), depth),
            queue: files.chain(dirs).collect(),
            prefix,
        }
    }
}

/// Обход без рекурсии: файлы каталога по оглавлению, затем его подкаталоги.
/// Контейнер, который решили раскрыть, обходится сразу, до следующих записей
/// того же каталога.
struct Walker {
    stack: Vec<Frame>,
}

impl Walker {
    fn over(archive: &Arc<Archive>) -> Walker {
        let root = Frame::new(0, String::new(), archive.root(), archive);
        Walker { stack: vec![root] }
    }

    /// Следующий файл или `None`, когда обходить больше нечего.
    fn advance(&mut self) -> Option<Visit> {
        loop {
            let top = self.stack.last_mut()?;
            let (archive, depth) = (Arc::clone(&top.place.0), top.place.1);
            match top.queue.pop_front() {
                None => {
                    self.stack.pop();
                }
                Some(Item::File(id)) => {
                    let path = format!("{}{}", top.prefix, archive.entry(id).name);
                    return Some(Visit {
                        path,
                        place: (archive, id),
                        depth,
                    });
                }
                Some(Item::Dir(id)) => {
                    let prefix = format!("{}{}/", top.prefix, archive.entry(id).name);
                    self.stack.push(Frame::new(depth, prefix, id, &archive));
                }
            }
        }
    }

    /// Раскрывает контейнер `at`: его записи выйдут следующими.
    fn enter(&mut self, inner: Arc<Archive>, at: &Visit) {
        let prefix = format!("{}/", at.path);
        let frame = Frame::new(at.depth + 1, prefix, inner.root(), &inner);
        self.stack.push(frame);
    }
}

/// Чем оказался файл при попытке раскрыть его как вложенный архив.
enum Container {
    Plain,
    Opened(Arc<Archive>),
    Broken,
}

/// Контейнеры раскрываются, пока архив, в котором они лежат, не глубже этого.
const NESTING_CAP: usize = 6;

impl Visit {
    fn container(&self) -> Container {
        let (archive, id) = &self.place;
        let entry = archive.entry(*id);
        let binary = matches!(&entry.kind, EntryKind::Binary(..));
        if self.depth >= NESTING_CAP || !binary || !Archive::is_nested_archive_name(&entry.name) {
            return Container::Plain;
        }
        archive.open_nested(*id).map_or(Container::Broken, |inner| {
            Container::Opened(Arc::new(inner))
        })
    }

    /// Размер записи и SHA-256 её байт; `None`, если запись не читается.
    fn fingerprint(&self) -> Option<Fingerprint> {
        let (archive, id) = &self.place;
        let bytes = archive.decode(*id, EntryCipher::AlwaysNg).ok()?;
        Some((bytes.len(), sha256_hex(&bytes)))
    }
}

// ---------------------------------------------------------------------------
// index-archive
// ---------------------------------------------------------------------------

/// Версия схемы описи.
pub const SCHEMA: u32 = 1;

/// Запрос описи: параметры в порядке их проверки.
struct IndexRequest {
    input: PathBuf,
    with_content: bool,
    output: PathBuf,
    label: Option<Box<str>>,
    keys: Arc<KeySet>,
}

/// Размер записи и SHA-256 её байт.
type Fingerprint = (usize, String);

/// Записи для описи в порядке обхода и номера среди них тех контейнеров,
/// которые не раскрылись: они лежат записями и числятся нечитаемыми.
#[derive(Default)]
struct Survey {
    truncated: bool,
    unopened: HashSet<usize>,
    jobs: Vec<Visit>,
}

/// Сколько записей сохраняется в описи.
const ENTRY_CAP: usize = 400_000;

fn survey(archive: &Arc<Archive>, cap: usize) -> Survey {
    let mut found = Survey::default();
    let mut walker = Walker::over(archive);
    while let Some(visit) = walker.advance() {
        let container = visit.container();
        if let Container::Opened(inner) = container {
            walker.enter(inner, &visit);
            continue;
        }
        if found.jobs.len() >= cap {
            found.truncated = true;
            break;
        }
        if matches!(container, Container::Broken) {
            found.unopened.insert(found.jobs.len());
        }
        found.jobs.push(visit);
    }
    found
}

/// Отпечатки записей в нескольких потоках; порядок результатов — порядок работ.
fn fingerprints(jobs: &[Visit], pace: &ReadPace) -> Vec<Option<Fingerprint>> {
    let slots: Vec<OnceLock<Fingerprint>> = jobs.iter().map(|_| OnceLock::new()).collect();
    let ticket = AtomicUsize::new(0);
    let take = || {
        let at = ticket.fetch_add(1, atomic::Ordering::Relaxed);
        jobs.get(at).map(|job| (at, job))
    };
    let work = || {
        pace.install();
        while let Some((at, job)) = take() {
            if let Some(print) = job.fingerprint() {
                let _ = slots[at].set(print);
            }
        }
    };
    scope(|lanes| {
        for _ in 0..worker_count().min(jobs.len()) {
            // упавший поток оставляет свои записи без отпечатка: они станут нечитаемыми
            lanes.spawn(|| {
                let _ = panic::catch_unwind(AssertUnwindSafe(&work));
            });
        }
    });
    slots.into_iter().map(OnceLock::into_inner).collect()
}

/// Всё, что считается при открытом архиве: обход, отпечатки записей и
/// отпечаток самого файла.
fn measure(
    archive: &Arc<Archive>,
    input: &Path,
) -> (Survey, Vec<Option<Fingerprint>>, Result<String>) {
    let pace = read_pace::current();
    scope(|helpers| {
        // файл целиком хешируется рядом с обходом, по той же ленте потолка
        let hash_file = || {
            pace.install();
            sha256_file(input)
        };
        let hashing = helpers.spawn(hash_file);
        let walked = survey(archive, ENTRY_CAP);
        let prints = fingerprints(&walked.jobs, &pace);
        let digest = match hashing.join() {
            Ok(digest) => digest,
            Err(_) => Err(EngineError::internal("The archive hash thread failed.")),
        };
        (walked, prints, digest)
    })
}

/// Вошедшие в опись записи с путём и отпечатком.
type Entries<'a> = Vec<(&'a str, Fingerprint)>;

/// Итог по записям в порядке обхода: что вошло в опись и что нечитаемо.
fn settle(walked: &Survey, prints: Vec<Option<Fingerprint>>) -> (Entries<'_>, Vec<String>) {
    let unreadable = walked
        .jobs
        .iter()
        .zip(&prints)
        .enumerate()
        .flat_map(|(at, (job, print))| {
            let lost = [walked.unopened.contains(&at), print.is_none()];
            lost.into_iter()
                .filter(|&flag| flag)
                .map(|_| job.path.clone())
        })
        .collect();
    let mut entries = Entries::new();
    for (job, print) in walked.jobs.iter().zip(prints) {
        entries.extend(print.map(|print| (job.path.as_str(), print)));
    }
    entries.sort_by(|(left, _), (right, _)| compare_ignore_case(left, right));
    (entries, unreadable)
}

/// Самый длинный `setup2.xml`, текст которого берётся в опись.
const SETUP_CAP: usize = 65_536;

/// Текст корневого `setup2.xml` или `None`.
fn setup_text(archive: &Archive) -> Option<String> {
    archive
        .find_file(archive.root(), "setup2.xml")
        .and_then(|id| archive.decode(id, EntryCipher::AlwaysNg).ok())
        .filter(|bytes| bytes.len() <= SETUP_CAP)
        .map(|bytes| {
            String::from_utf8_lossy(&bytes)
                .trim_start_matches('\u{feff}')
                .to_owned()
        })
}

impl IndexRequest {
    fn from_options(options: &Options) -> Result<IndexRequest> {
        Ok(IndexRequest {
            input: path_param(existing_file, options, "input", ".rpf")?,
            output: path_param(output_file, options, "output", ".json")?,
            keys: keys_from(options)?,
            // разбор `content.xml` выключает ровно слово `false`, регистр не важен
            with_content: options
                .optional("content-xml")
                .is_none_or(|word| !word.eq_ignore_ascii_case("false")),
            label: options.optional("label").map(|label| label.into()),
        })
    }

    fn run(self) -> Result<Value> {
        let IndexRequest {
            label,
            input,
            with_content,
            output,
            keys,
        } = self;
        let archive = open_shared(&keys, &input)?;

        let (walked, prints, digest) = measure(&archive, &input);
        let digest = digest?;
        let archive_bytes = input.metadata()?.len();
        let (entries, unreadable) = settle(&walked, prints);

        let analysis = match with_content {
            true => content::analyze(&archive),
            false => Value::Null,
        };
        let mut document = json!({
            "schema": SCHEMA,
            "archive": input.to_string_lossy(),
            "archiveBytes": archive_bytes,
            "archiveSha256": digest,
            "label": label,
            "builtAt": Utc::now().iso_z(),
            "entryCount": entries.len(),
            "truncated": walked.truncated,
            "unreadable": unreadable,
            "content": analysis,
            "setup": setup_text(&archive),
        });
        let mut rows = Vec::with_capacity(entries.len());
        for (path, (size, sha256)) in &entries {
            rows.push(json!({"path": path, "size": size, "sha256": sha256}));
        }
        document["entries"] = Value::Array(rows);
        let text = ascii_json(&document);
        fs::write(&output, text.as_bytes())?;

        Ok(json!({
            "schema": SCHEMA,
            "archive": input.to_string_lossy(),
            "output": output.to_string_lossy(),
            "entryCount": entries.len(),
            "truncated": walked.truncated,
            "unreadable": unreadable.len(),
            "outputBytes": text.len(),
        }))
    }
}

pub fn index_archive(options: &Options, _: &Progress) -> Result<Value> {
    IndexRequest::from_options(options)?.run()
}

// ---------------------------------------------------------------------------
// extract-archive-entries
// ---------------------------------------------------------------------------

/// Запрошенные пути, склеенные по ключу в верхнем регистре: у каждого последнее
/// написание и признак «найден».
#[derive(Default)]
struct Wanted {
    slots: Vec<(String, bool)>,
    outstanding: usize,
    by_key: HashMap<String, usize>,
}

/// Запрошенное значение в виде пути записи; пустое после правки пропадает.
fn tidy_request(value: &str) -> Option<String> {
    Some(value.replace('\\', "/").trim().trim_start_matches('/'))
        .filter(|rest| !rest.is_empty())
        .map(str::to_owned)
}

impl Wanted {
    fn collect<'a>(values: impl IntoIterator<Item = &'a String>) -> Wanted {
        values
            .into_iter()
            .filter_map(|value| tidy_request(value))
            .fold(Wanted::default(), |mut wanted, spelling| {
                wanted.add(spelling);
                wanted
            })
    }

    /// Новый путь занимает следующее место, повтор лишь меняет написание.
    fn add(&mut self, spelling: String) {
        match self.by_key.entry(spelling.to_uppercase()) {
            Entry::Occupied(known) => self.slots[*known.get()].0 = spelling,
            Entry::Vacant(free) => {
                free.insert(self.slots.len());
                self.slots.push((spelling, false));
                self.outstanding += 1;
            }
        }
    }

    /// Отмечает путь найденным, если он запрошен и ещё не найден.
    fn claim(&mut self, path: impl AsRef<str>) -> bool {
        match self
            .by_key
            .get(&path.as_ref().to_uppercase())
            .and_then(|&at| self.slots.get_mut(at))
        {
            Some((_, found)) if !*found => {
                *found = true;
                self.outstanding -= 1;
                true
            }
            _ => false,
        }
    }

    fn missing(&self) -> Vec<&str> {
        self.slots
            .iter()
            .filter(|&&(_, found)| !found)
            .map(|slot| slot.0.as_str())
            .collect()
    }
}

/// Последние `count` знаков текста (или весь текст, если он короче).
fn last_chars(text: &str, count: usize) -> &str {
    match text.char_indices().rev().nth(count - 1) {
        Some((from, _)) => &text[from..],
        None => text,
    }
}

/// Знак имени файла на диске: буквы, цифры и `.-_+` остаются, прочее — `_`.
fn safe_char(ch: char) -> char {
    if ch.is_alphanumeric() || ".-_+".contains(ch) {
        ch
    } else {
        '_'
    }
}

/// Сколько последних знаков плоского имени остаётся.
const DISK_NAME_CAP: usize = 120;

/// Имя файла на диске: всё, кроме букв, цифр и `.-_+`, становится `_`;
/// остаются последние знаки.
fn disk_name(path: &str) -> String {
    last_chars(path, DISK_NAME_CAP)
        .chars()
        .map(safe_char)
        .collect()
}

/// Сколько значений `--entry` принимает выемка.
const REQUEST_CAP: usize = 5000;

/// Запрос выемки: параметры в порядке их проверки.
struct ExtractRequest {
    directory: PathBuf,
    keys: Arc<KeySet>,
    entries: Box<[String]>,
    input: PathBuf,
}

/// Запрошенная запись, найденная в обходе, и имя её файла в плоской папке.
type Found = (Visit, String);

/// Запрошенные записи в порядке обхода; обход кончается, когда найдены все.
fn find_wanted(archive: &Arc<Archive>, wanted: &mut Wanted) -> Vec<Found> {
    let mut found = Vec::new();
    let mut walker = Walker::over(archive);
    while wanted.outstanding > 0 {
        let Some(visit) = walker.advance() else { break };
        if wanted.claim(&visit.path) {
            let file = disk_name(&visit.path);
            found.push((visit, file));
        } else if let Container::Opened(inner) = visit.container() {
            walker.enter(inner, &visit);
        }
    }
    found
}

/// Отказывает, если у двух записей совпало плоское имя файла; регистр не важен
/// (на Windows это один файл), свёртка та же, что у упорядочения путей.
fn refuse_shared_names<'a>(mut found: impl Iterator<Item = &'a Found>) -> Result<()> {
    let mut taken: HashMap<String, &Found> = HashMap::new();
    found.try_for_each(|entry| {
        let key: String = entry.1.chars().map(fold_char).collect();
        match taken.entry(key) {
            Entry::Occupied(first) => {
                let (first_visit, first_file) = first.get();
                Err(EngineError::argument(format!(
                    "Entries \"{}\" and \"{}\" share the output file name \"{}\".",
                    first_visit.path, entry.0.path, first_file
                )))
            }
            Entry::Vacant(free) => {
                free.insert(entry);
                Ok(())
            }
        }
    })
}

impl Visit {
    /// Записывает запись в плоскую папку под именем `file`; строка `files` ответа.
    fn write_to(&self, file: &str, directory: &Path) -> Result<Value> {
        let (archive, id) = &self.place;
        archive
            .decode(*id, EntryCipher::AlwaysNg)
            .map_err(EngineError::from)
            .and_then(|bytes| {
                fs::write(directory.join(file), &bytes)?;
                Ok(json!({
                    "entry": self.path,
                    "file": file,
                    "size": bytes.len(),
                    "sha256": sha256_hex(&bytes),
                }))
            })
    }
}

/// Записывает запрошенные записи в плоскую папку; результат — строки `files`.
/// Папка не тронута, пока не известно, что плоские имена не совпадают.
fn pull_files(archive: &Arc<Archive>, directory: &Path, wanted: &mut Wanted) -> Result<Vec<Value>> {
    let found = find_wanted(archive, wanted);
    refuse_shared_names(found.iter())?;
    let mut rows = Vec::with_capacity(found.len());
    for (visit, file) in &found {
        rows.push(visit.write_to(file, directory)?);
    }
    Ok(rows)
}

impl ExtractRequest {
    fn from_options(options: &Options) -> Result<ExtractRequest> {
        Ok(ExtractRequest {
            input: path_param(existing_file, options, "input", ".rpf")?,
            directory: full_path(options.required("output-dir")?)?,
            keys: keys_from(options)?,
            entries: match options.values("entry") {
                [] => return Err(EngineError::argument("At least one --entry is required.")),
                values if values.len() > REQUEST_CAP => {
                    return Err(EngineError::argument("Too many entries in one extraction."));
                }
                values => values.into(),
            },
        })
    }

    fn run(self) -> Result<Value> {
        let ExtractRequest {
            entries,
            directory,
            input,
            keys,
        } = self;
        fs::create_dir_all(&directory)?;
        let archive = open_shared(&keys, &input)?;

        let mut wanted = Wanted::collect(entries.iter());
        let files = pull_files(&archive, &directory, &mut wanted)?;
        Ok(json!({
            "archive": input.to_string_lossy(),
            "outputDirectory": directory.to_string_lossy(),
            "requested": entries.len(),
            "extracted": files.len(),
            "missing": wanted.missing(),
            "files": files,
        }))
    }
}

pub fn extract_archive_entries(options: &Options, _: &Progress) -> Result<Value> {
    ExtractRequest::from_options(options)?.run()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::KEYS_ENV;
    use crate::response::ascii_escape;
    use rage_rpf::fixtures::{noise, resource, text, update_tree};
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::fs::File;
    use std::path::{Path, PathBuf};
    use tempfile::{tempdir, TempDir};

    // ----- упорядочение путей -----

    #[test]
    fn ordering_table() {
        use Ordering::{Equal, Greater, Less};
        let rows: &[(&str, &str, Ordering)] = &[
            ("", "", Equal),
            ("", "a", Less),
            ("a", "", Greater),
            ("a", "a", Equal),
            ("a", "A", Equal),
            ("a", "B", Less),
            ("A", "b", Less),
            ("b", "A", Greater),
            ("Dir/File", "dir/file", Equal),
            ("a_b", "ab", Greater),
            ("ab", "a_b", Less),
            ("a_b", "aB", Greater),
            ("Z", "_", Less),
            ("z", "_", Less),
            ("z", "[", Less),
            ("[", "_", Less),
            ("a/b", "a.b", Greater),
            ("a/b", "a b", Greater),
            ("a", "ab", Less),
            ("ab", "a", Greater),
            ("x64/a.rpf/b", "x64/a.rpf", Greater),
            ("é", "É", Equal),
            ("é", "e", Greater),
            ("е", "Е", Equal),
            ("файл", "ФАЙЛ", Equal),
            ("я", "Я", Equal),
            ("я", "Z", Greater),
            ("ß", "SS", Greater),
            ("ß", "ss", Greater),
            ("ß", "ß", Equal),
            ("ß", "S", Greater),
            ("ß", "T", Greater),
            ("straße", "STRASSE", Greater),
            ("ı", "I", Equal),
            ("ı", "i", Equal),
            ("i", "İ", Less),
            ("İ", "i", Greater),
            ("İ", "I", Greater),
            ("ǆ", "Ǆ", Equal),
            ("ǅ", "ǆ", Equal),
            ("ǅ", "Ǆ", Equal),
            ("ﬁ", "FI", Greater),
            ("ﬁ", "ﬁ", Equal),
            ("ﬁ", "g", Greater),
            ("ŉ", "ʼN", Less),
            ("a\u{301}", "á", Less),
            ("ａ", "Ａ", Equal),
            ("～", "😀", Less),
            ("😀", "～", Greater),
            ("😀", "😁", Less),
            ("𐐨", "𐐀", Equal),
            ("ǰ", "J\u{30c}", Greater),
            ("ς", "Σ", Equal),
            ("σ", "ς", Equal),
            ("ᾳ", "ᾼ", Less),
            ("ⅰ", "Ⅰ", Equal),
            ("ⓐ", "Ⓐ", Equal),
            ("\0", "\u{1}", Less),
            ("tab\t", "tab ", Less),
        ];
        for (left, right, expected) in rows {
            assert_eq!(
                compare_ignore_case(left, right),
                *expected,
                "{left:?} / {right:?}"
            );
        }
    }

    #[test]
    fn ordering_is_a_total_preorder_and_sorts_stably() {
        let words = [
            "", "a", "A", "b", "B", "a_b", "ab", "aB", "Z", "z", "_", "[", "ß", "SS", "ss", "ı",
            "I", "i", "İ", "ǅ", "ǆ", "Ǆ", "😀", "～", "é", "É", "a.xml", "A.xml", "B.xml", "b.xml",
        ];
        for a in words {
            for b in words {
                assert_eq!(
                    compare_ignore_case(a, b),
                    compare_ignore_case(b, a).reverse(),
                    "{a:?} {b:?}"
                );
                for c in words {
                    if compare_ignore_case(a, b) != Ordering::Greater
                        && compare_ignore_case(b, c) != Ordering::Greater
                    {
                        assert_ne!(compare_ignore_case(a, c), Ordering::Greater);
                    }
                }
            }
        }
        let mut sample = vec!["b.xml", "B.xml", "ǅ", "a.xml", "Ǆ", "A.xml", "ǆ"];
        sample.sort_by(|a, b| compare_ignore_case(a, b));
        assert_eq!(sample, ["a.xml", "A.xml", "b.xml", "B.xml", "ǅ", "Ǆ", "ǆ"]);
    }

    #[test]
    fn workers_are_half_of_the_processors_rounded_up() {
        let cpus = thread::available_parallelism().map_or(2, usize::from);
        assert_eq!(worker_count(), (cpus / 2 + cpus % 2).max(1));
        assert!(worker_count() >= 1);
    }

    // ----- стенд -----

    fn memory_file(name: &str, bytes: Vec<u8>) -> FileNode {
        FileNode {
            name: name.into(),
            body: Body::Binary {
                data: Data::memory(bytes),
                compress: Compress::Auto,
            },
        }
    }

    fn flat(files: &[(&str, Vec<u8>)]) -> DirNode {
        let mut root = DirNode::new("");
        for (name, bytes) in files {
            root.files.push(memory_file(name, bytes.clone()));
        }
        root
    }

    fn container(name: &str, inner: DirNode) -> FileNode {
        FileNode {
            name: name.into(),
            body: Body::Nested(Box::new(inner)),
        }
    }

    fn write_tree(tree: &DirNode, path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    pub(super) fn write_keys(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        for (name, len) in [
            ("gtav_aes_key.dat", 32),
            ("gtav_ng_key.dat", 101 * 68 * 4),
            ("gtav_ng_decrypt_tables.dat", 17 * 4096 * 4),
            ("gtav_hash_lut.dat", 256),
        ] {
            std::fs::write(dir.join(name), vec![5u8; len]).unwrap();
        }
    }

    struct Lab {
        dir: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempdir().unwrap();
            write_keys(&dir.path().join("keys"));
            Lab { dir }
        }

        fn at(&self, tail: &str) -> PathBuf {
            self.dir.path().join(tail)
        }

        fn archive(&self, name: &str, tree: &DirNode) -> String {
            let path = self.at("arch").join(name);
            write_tree(tree, &path);
            path.display().to_string()
        }

        fn keys(&self) -> String {
            self.at("keys").display().to_string()
        }

        fn index(&self, args: &[&str]) -> Result<Value> {
            let mut all: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            if !args.contains(&"--keys") {
                all.extend(["--keys".to_owned(), self.keys()]);
            }
            index_archive(&Options::parse(&all).unwrap(), &Progress::silent())
        }

        /// Опись в файл `out.json`: ответ и разобранный файл.
        fn index_to(&self, archive: &str, extra: &[&str]) -> (Value, Value, String) {
            let out = self.at("out").join("out.json").display().to_string();
            let mut args = vec!["--input", archive, "--output", &out];
            args.extend_from_slice(extra);
            let answer = self.index(&args).unwrap();
            let raw = std::fs::read_to_string(&out).unwrap();
            (answer, serde_json::from_str(&raw).unwrap(), raw)
        }

        fn extract(&self, archive: &str, dir: &str, entries: &[&str]) -> Result<Value> {
            let mut all = vec![
                "--input".to_owned(),
                archive.to_owned(),
                "--output-dir".to_owned(),
                dir.to_owned(),
                "--keys".to_owned(),
                self.keys(),
            ];
            for entry in entries {
                all.extend(["--entry".to_owned(), (*entry).to_owned()]);
            }
            extract_archive_entries(&Options::parse(&all).unwrap(), &Progress::silent())
        }
    }

    fn failure<T>(result: Result<T>) -> (String, String) {
        match result {
            Err(error) => (error.code, error.message),
            Ok(_) => panic!("ожидался отказ"),
        }
    }

    fn paths_of(document: &Value) -> Vec<String> {
        document["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["path"].as_str().unwrap().to_owned())
            .collect()
    }

    fn names_tree(names: &[&str]) -> DirNode {
        let mut root = DirNode::new("");
        for name in names {
            match name.split_once('/') {
                Some((dir, leaf)) => {
                    let mut sub = DirNode::new(dir);
                    sub.files.push(memory_file(leaf, text(30, name)));
                    root.dirs.push(sub);
                }
                None => root.files.push(memory_file(name, text(30, name))),
            }
        }
        root
    }

    // ----- опись -----

    #[test]
    fn update_archive_gets_a_full_index() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let (answer, document, raw) = lab.index_to(&arch, &["--label", "demo"]);

        assert_eq!(answer["schema"], 1);
        assert_eq!(answer["archive"], Value::from(arch.clone()));
        assert_eq!(answer["entryCount"], 11);
        assert_eq!(answer["truncated"], false);
        assert_eq!(answer["unreadable"], 0);
        assert_eq!(answer["outputBytes"], raw.len());
        assert_eq!(
            answer["output"],
            Value::from(lab.at("out").join("out.json").display().to_string())
        );
        assert!(raw.is_ascii() && !raw.ends_with('\n'));

        let keys: Vec<&str> = document
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "schema",
                "archive",
                "archiveBytes",
                "archiveSha256",
                "label",
                "builtAt",
                "entryCount",
                "truncated",
                "unreadable",
                "content",
                "setup",
                "entries"
            ]
        );
        assert_eq!(document["label"], "demo");
        assert_eq!(document["archiveBytes"], 12288);
        assert_eq!(
            document["archiveSha256"],
            "9571b6fb09619f76e82337993a808ef468c53aa71970eec9ef1f434577a587aa"
        );
        assert_eq!(document["builtAt"].as_str().unwrap().len(), 28);
        assert_eq!(
            document["archiveBytes"],
            std::fs::metadata(&arch).unwrap().len()
        );
        assert_eq!(
            document["archiveSha256"],
            sha256_hex(&std::fs::read(&arch).unwrap())
        );
        assert_eq!(document["unreadable"], json!([]));
        assert_eq!(
            document["content"],
            json!({
                "filesToEnable": [
                    "x64/data/cdimages/scaleform_generic.rpf",
                    "x64/models/cdimages/panika.rpf",
                    "common/data/a.meta",
                    "dlcpacks:/mine/dlc.rpf"
                ],
                "customRpfs": ["x64/models/cdimages/panika.rpf", "common/data/a.meta", "dlcpacks:/mine/dlc.rpf"],
                "defaultRpfs": ["x64/data/cdimages/scaleform_generic.rpf"]
            })
        );
        assert_eq!(
            document["setup"],
            String::from_utf8(text(315, "<SSetupData/>")).unwrap()
        );

        let expected: [(&str, u64, &str); 11] = [
            ("common/data/a.xml", 4000, "74f7ba8b"),
            ("common/data/b.dat", 3000, "59fd8326"),
            ("common/data/c.txt", 900, "bfb45e02"),
            ("common/data/old.xml", 500, "5eddcaf4"),
            ("content.xml", 568, "f79c02c6"),
            ("setup2.xml", 315, "0b7c7f84"),
            (
                "x64/data/cdimages/scaleform_generic.rpf/hud.gfx",
                1800,
                "ff8e4191",
            ),
            (
                "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml",
                700,
                "bcbc978d",
            ),
            (
                "x64/data/cdimages/scaleform_generic.rpf/mini.gfx",
                2500,
                "54ae3b95",
            ),
            (
                "x64/data/cdimages/scaleform_generic.rpf/tex.ytd",
                916,
                "173e3d61",
            ),
            (
                "x64/data/cdimages/scaleform_other.rpf/keep.xml",
                600,
                "a7df92e8",
            ),
        ];
        let listed = document["entries"].as_array().unwrap();
        assert_eq!(listed.len(), expected.len());
        for (entry, (path, size, prefix)) in listed.iter().zip(expected) {
            assert_eq!(entry["path"], path);
            assert_eq!(entry["size"], size);
            assert!(
                entry["sha256"].as_str().unwrap().starts_with(prefix),
                "{path}"
            );
            assert_eq!(entry.as_object().unwrap().len(), 3);
        }
    }

    #[test]
    fn a_deeply_nested_content_xml_does_not_take_the_process_down() {
        // content.xml в сто тысяч вложенных элементов: опись и выемка отвечают,
        // а в `content` — пустые списки (разбор отказал по глубине)
        let outcome = thread::Builder::new()
            .stack_size(1 << 20)
            .spawn(|| {
                let lab = Lab::new();
                let deep = format!(
                    "{}<filesToEnable/>{}",
                    "<a>".repeat(100_000),
                    "</a>".repeat(100_000)
                );
                let arch = lab.archive("deep.rpf", &update_tree(Some(deep.into_bytes())));
                let (answer, document, _) = lab.index_to(&arch, &[]);
                let dir = lab.at("pulled").display().to_string();
                let pulled = lab.extract(&arch, &dir, &["content.xml"]).unwrap();
                (answer, document, pulled)
            })
            .unwrap()
            .join()
            .unwrap();
        let (answer, document, pulled) = outcome;
        assert_eq!(answer["entryCount"], 11);
        assert_eq!(answer["unreadable"], 0);
        assert_eq!(
            document["content"],
            json!({"filesToEnable": [], "customRpfs": [], "defaultRpfs": []})
        );
        assert_eq!(pulled["extracted"], 1);
        assert_eq!(pulled["files"][0]["size"], 100_000 * 7 + 16);
    }

    #[test]
    fn empty_and_zero_length_archives() {
        let lab = Lab::new();
        let arch = lab.archive("empty.rpf", &DirNode::new(""));
        let (answer, document, raw) = lab.index_to(&arch, &[]);
        assert_eq!(answer["entryCount"], 0);
        assert_eq!(document["setup"], Value::Null);
        assert_eq!(document["label"], Value::Null);
        assert_eq!(document["entries"], json!([]));
        assert_eq!(
            document["content"],
            json!({"filesToEnable": [], "customRpfs": [], "defaultRpfs": []})
        );
        assert!(raw.ends_with(r#""setup":null,"entries":[]}"#));

        let mut tree = flat(&[
            ("empty.bin", vec![]),
            ("empty2.xml", vec![]),
            ("one.bin", vec![9]),
        ]);
        let mut sub = DirNode::new("d");
        sub.files.push(memory_file("z.xml", vec![]));
        tree.dirs.push(sub);
        let arch = lab.archive("zero.rpf", &tree);
        let (_, document, _) = lab.index_to(&arch, &[]);
        assert_eq!(
            paths_of(&document),
            ["d/z.xml", "empty.bin", "empty2.xml", "one.bin"]
        );
        let empty_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let sizes: Vec<(u64, String)> = document["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["size"].as_u64().unwrap(),
                    e["sha256"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        assert_eq!(sizes[0], (0, empty_hash.to_owned()));
        assert_eq!(sizes[2], (0, empty_hash.to_owned()));
        assert_eq!(sizes[3], (1, sha256_hex(&[9])));
    }

    #[test]
    fn names_are_sorted_by_folded_characters() {
        let lab = Lab::new();
        let names = [
            "A.xml",
            "ab.xml",
            "a_b.xml",
            "B.xml",
            "b.xml",
            "dir.part.xml",
            "FI.txt",
            "I.txt",
            "ı.txt",
            "name with spaces.xml",
            "STRASSE.TXT",
            "straße.txt",
            "Z.xml",
            "z.xml",
            "_z.xml",
            "Ärger.xml",
            "ärger.xml",
            "İ.txt",
            "ǅ.txt",
            "ǆ.txt",
            "Подпапка/внутри.xml",
            "ФАЙЛ.DAT",
            "файл.dat",
            "ﬁ.txt",
            "ｚ.bin",
            "😀.bin",
        ];
        let arch = lab.archive("names.rpf", &names_tree(&names));
        let (answer, document, raw) = lab.index_to(&arch, &[]);
        assert_eq!(answer["entryCount"], 26);
        assert_eq!(paths_of(&document), names);
        let quoted = |word: &str, tail: &str| format!("\"path\":\"{}{tail}", ascii_escape(word));
        assert!(raw.contains(&quoted("ı", ".txt\"")));
        assert!(raw.contains(&quoted("😀", ".bin\"")));
        assert!(raw.contains(&quoted("Подпапка", "/")));
        assert!(raw.contains("\\uD83D\\uDE00.bin"));
    }

    #[test]
    fn same_name_in_other_case_keeps_the_archive_order() {
        let lab = Lab::new();
        let tree = flat(&[
            ("DUP.XML", text(42, "u")),
            ("Dup.xml", text(40, "m")),
            ("dup.xml", text(41, "l")),
        ]);
        let arch = lab.archive("dups.rpf", &tree);
        let (_, document, _) = lab.index_to(&arch, &[]);
        let listed: Vec<(String, u64)> = document["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["path"].as_str().unwrap().to_owned(),
                    e["size"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            listed,
            [
                ("DUP.XML".to_owned(), 42),
                ("Dup.xml".to_owned(), 40),
                ("dup.xml".to_owned(), 41)
            ]
        );
    }

    /// Цепочка `l1.rpf` … `l8.rpf`, в каждом слое файл `fN.xml`.
    fn nested_chain() -> DirNode {
        let mut inner = DirNode::new("");
        for level in (1..=8).rev() {
            let mut layer = DirNode::new("");
            layer.files.push(memory_file(
                &format!("f{level}.xml"),
                text(80, &format!("f{level}")),
            ));
            if level < 8 {
                layer
                    .files
                    .push(container(&format!("l{}.rpf", level + 1), inner));
            }
            inner = layer;
        }
        let mut root = DirNode::new("");
        root.files.push(container("l1.rpf", inner));
        root
    }

    #[test]
    fn containers_open_six_levels_deep() {
        let lab = Lab::new();
        let arch = lab.archive("deep.rpf", &nested_chain());
        let (answer, document, _) = lab.index_to(&arch, &[]);
        let deep = "l1.rpf/l2.rpf/l3.rpf/l4.rpf/l5.rpf/l6.rpf";
        let expected = [
            "l1.rpf/f1.xml".to_owned(),
            "l1.rpf/l2.rpf/f2.xml".to_owned(),
            "l1.rpf/l2.rpf/l3.rpf/f3.xml".to_owned(),
            "l1.rpf/l2.rpf/l3.rpf/l4.rpf/f4.xml".to_owned(),
            "l1.rpf/l2.rpf/l3.rpf/l4.rpf/l5.rpf/f5.xml".to_owned(),
            format!("{deep}/f6.xml"),
            format!("{deep}/l7.rpf"),
        ];
        assert_eq!(paths_of(&document), expected);
        assert_eq!(answer["entryCount"], 7);
        assert_eq!(answer["unreadable"], 0);
        assert_eq!(document["entries"][6]["size"], 2048);
    }

    #[test]
    fn containers_that_do_not_open_stay_entries_and_become_unreadable() {
        let lab = Lab::new();
        let mut x64 = DirNode::new("x64");
        x64.files.push(memory_file("bad.rpf", noise(3000, 4)));
        x64.files.push(memory_file("SHORT.RPF", noise(10, 5)));
        x64.files.push(memory_file("ok.xml", text(200, "ok")));
        x64.files
            .push(container("plain.rpf", flat(&[("in.xml", text(900, "in"))])));
        x64.files.push(FileNode {
            name: "res.rpf".into(),
            body: Body::Resource {
                data: Data::memory(resource(1, 2, &noise(300, 6))),
            },
        });
        let mut root = DirNode::new("");
        root.dirs.push(x64);
        let arch = lab.archive("badnested.rpf", &root);
        let (answer, document, _) = lab.index_to(&arch, &[]);
        assert_eq!(answer["entryCount"], 5);
        assert_eq!(answer["unreadable"], 2);
        assert_eq!(
            document["unreadable"],
            json!(["x64/SHORT.RPF", "x64/bad.rpf"])
        );
        assert_eq!(
            paths_of(&document),
            [
                "x64/bad.rpf",
                "x64/ok.xml",
                "x64/plain.rpf/in.xml",
                "x64/res.rpf",
                "x64/SHORT.RPF"
            ]
        );
        assert_eq!(document["entries"][3]["size"], 316);
        assert_eq!(document["entries"][4]["size"], 10);
    }

    #[test]
    fn resources_are_indexed_as_exports_with_a_new_header() {
        let lab = Lab::new();
        let body = noise(900, 5);
        let mut tree = flat(&[("plain.bin", noise(64, 1))]);
        tree.files.push(FileNode {
            name: "a.ytd".into(),
            body: Body::Resource {
                data: Data::memory(resource(0x6000_0001, 0x9000_0002, &body)),
            },
        });
        let arch = lab.archive("resources.rpf", &tree);
        let (_, document, _) = lab.index_to(&arch, &[]);
        assert_eq!(paths_of(&document), ["a.ytd", "plain.bin"]);
        assert_eq!(document["entries"][0]["size"], 916);
        let extract_dir = lab.at("x").display().to_string();
        lab.extract(&arch, &extract_dir, &["a.ytd"]).unwrap();
        let written = std::fs::read(lab.at("x").join("a.ytd")).unwrap();
        assert_eq!(&written[..4], b"RSC7");
        assert_eq!(document["entries"][0]["sha256"], sha256_hex(&written));
    }

    #[test]
    fn container_suffix_is_matched_without_case() {
        let lab = Lab::new();
        let mut mods = DirNode::new("Mods");
        let mut folder = DirNode::new("Folder");
        folder.files.push(memory_file("Deep.txt", text(66, "d")));
        let mut pack = flat(&[("Inside.TXT", text(55, "i"))]);
        pack.dirs.push(folder);
        mods.files.push(container("Pack.RPF", pack));
        let mut root = flat(&[("Root.txt", text(10, "r"))]);
        root.dirs.push(mods);
        let arch = lab.archive("containers.rpf", &root);
        let (_, document, _) = lab.index_to(&arch, &[]);
        assert_eq!(
            paths_of(&document),
            [
                "Mods/Pack.RPF/Folder/Deep.txt",
                "Mods/Pack.RPF/Inside.TXT",
                "Root.txt"
            ]
        );
    }

    #[test]
    fn a_damaged_entry_is_unreadable_but_the_rest_survive() {
        let lab = Lab::new();
        let mut tree = DirNode::new("");
        tree.files.push(memory_file("good.xml", text(4000, "good")));
        tree.files.push(FileNode {
            name: "plain.txt".into(),
            body: Body::Binary {
                data: Data::memory(text(100, "plain")),
                compress: Compress::Store,
            },
        });
        tree.files.push(FileNode {
            name: "bad.xml".into(),
            body: Body::Binary {
                data: Data::memory(text(4000, "bad")),
                compress: Compress::Always,
            },
        });
        let arch = lab.archive("corrupt.rpf", &tree);
        let spoiled = {
            let opened = Archive::open_path(Path::new(&arch), None).unwrap();
            let id = opened.find_file(opened.root(), "bad.xml").unwrap();
            match &opened.entry(id).kind {
                EntryKind::Binary(info) => info.offset(),
                _ => unreachable!(),
            }
        };
        let mut bytes = std::fs::read(&arch).unwrap();
        for byte in &mut bytes[spoiled as usize..spoiled as usize + 6] {
            *byte = 0xFF;
        }
        std::fs::write(&arch, bytes).unwrap();
        let (answer, document, _) = lab.index_to(&arch, &[]);
        assert_eq!(document["unreadable"], json!(["bad.xml"]));
        assert_eq!(answer["unreadable"], 1);
        assert_eq!(paths_of(&document), ["good.xml", "plain.txt"]);
    }

    // ----- параметры -----

    #[test]
    fn parameters_change_only_what_they_name() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let (_, empty, _) = lab.index_to(&arch, &["--label", ""]);
        assert_eq!(empty["label"], "");
        let (_, pretty, raw) = lab.index_to(&arch, &["--label", "Метка ★ 😀"]);
        assert_eq!(pretty["label"], "Метка ★ 😀");
        assert!(raw.contains(&format!("\"label\":\"{}\"", ascii_escape("Метка ★ 😀"))));
        assert!(raw.contains("\\u2605 \\uD83D\\uDE00\""));
        let (_, last, _) = lab.index_to(&arch, &["--label", "a", "--label", "b"]);
        assert_eq!(last["label"], "b");
        for off in ["false", "FALSE"] {
            let (_, plain, _) = lab.index_to(&arch, &["--content-xml", off]);
            assert_eq!(plain["content"], Value::Null);
        }
        for on in [" false", "0", "no", "true", ""] {
            let (_, kept, _) = lab.index_to(&arch, &["--content-xml", on]);
            assert_eq!(
                kept["content"]["defaultRpfs"].as_array().unwrap().len(),
                1,
                "{on:?}"
            );
        }
        let nothing = lab.at("nothing-here").display().to_string();
        let (_, with_root, _) = lab.index_to(&arch, &["--game-root", &nothing]);
        assert_eq!(with_root["entryCount"], 11);
    }

    #[test]
    fn extensions_and_repeat_runs() {
        let lab = Lab::new();
        let upper = lab.at("UP.RPF");
        write_tree(&update_tree(None), &upper);
        let out = lab.at("p13.JSON").display().to_string();
        let answer = lab
            .index(&["--input", &upper.display().to_string(), "--output", &out])
            .unwrap();
        assert_eq!(answer["entryCount"], 11);

        let big = lab.archive("update.rpf", &update_tree(None));
        let small = lab.archive("zero.rpf", &flat(&[("a.bin", vec![1])]));
        let first = lab.index(&["--input", &big, "--output", &out]).unwrap();
        let second = lab.index(&["--input", &small, "--output", &out]).unwrap();
        let length = std::fs::metadata(&out).unwrap().len();
        assert!(length < first["outputBytes"].as_u64().unwrap());
        assert_eq!(second["outputBytes"].as_u64().unwrap(), length);
    }

    #[test]
    fn index_is_stable_between_runs() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let strip = |raw: &str| {
            let mut value: Value = serde_json::from_str(raw).unwrap();
            value["builtAt"] = Value::Null;
            value
        };
        let (_, _, first) = lab.index_to(&arch, &[]);
        for _ in 0..5 {
            let (_, _, again) = lab.index_to(&arch, &[]);
            assert_eq!(strip(&first), strip(&again));
        }
    }

    // ----- setup2.xml -----

    fn setup_of(lab: &Lab, name: &str, root: DirNode) -> Value {
        let arch = lab.archive(name, &root);
        lab.index_to(&arch, &[]).1["setup"].clone()
    }

    #[test]
    fn setup_text_rules() {
        let lab = Lab::new();
        let with = |bytes: Vec<u8>| flat(&[("setup2.xml", bytes)]);
        let exact = setup_of(&lab, "exact.rpf", with(text(65_536, "<S/>")));
        assert_eq!(exact.as_str().unwrap().len(), 65_536);
        assert_eq!(
            setup_of(&lab, "big.rpf", with(text(65_537, "<S/>"))),
            Value::Null
        );
        let doubled: Vec<u8> = [&[0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF][..], b"<S a='1'/>"].concat();
        assert_eq!(setup_of(&lab, "bom.rpf", with(doubled)), "<S a='1'/>");
        assert_eq!(
            setup_of(&lab, "bad.rpf", with(b"<S>\xFF\xFE\xFD</S>".to_vec())),
            "<S>\u{fffd}\u{fffd}\u{fffd}</S>"
        );
        let uni = setup_of(
            &lab,
            "uni.rpf",
            with("<S>Привет, мир ★ 😀</S>".as_bytes().to_vec()),
        );
        assert_eq!(uni, "<S>Привет, мир ★ 😀</S>");
        assert_eq!(setup_of(&lab, "empty.rpf", with(vec![])), "");
        assert_eq!(
            setup_of(
                &lab,
                "upper.rpf",
                flat(&[("SETUP2.XML", text(20, "<UP/>"))])
            ),
            String::from_utf8(text(20, "<UP/>")).unwrap()
        );
        let mut nested = DirNode::new("");
        let mut sub = DirNode::new("sub");
        sub.files.push(memory_file("setup2.xml", text(20, "<S/>")));
        nested.dirs.push(sub);
        assert_eq!(setup_of(&lab, "indir.rpf", nested), Value::Null);
    }

    // ----- отказы -----

    #[test]
    fn refusals_follow_the_documented_order() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let out = lab.at("e.json").display().to_string();
        let args =
            |parts: &[&str]| -> Vec<String> { parts.iter().map(|p| (*p).to_owned()).collect() };
        let run = |parts: &[&str]| {
            failure(index_archive(
                &Options::parse(&args(parts)).unwrap(),
                &Progress::silent(),
            ))
        };
        let keys = lab.keys();
        let argument = |text: &str| ("ArgumentException".to_owned(), text.to_owned());

        assert_eq!(
            run(&["--output", &out, "--keys", &keys]),
            argument("--input is required.")
        );
        assert_eq!(
            run(&["--input", &arch, "--keys", &keys]),
            argument("--output is required.")
        );
        assert_eq!(run(&["--keys", &keys]), argument("--input is required."));
        let nothere = lab.at("arch").join("nothere.rpf").display().to_string();
        assert_eq!(
            run(&["--input", &nothere, "--output", &out, "--keys", &keys]),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {nothere}")
            )
        );
        let folder = lab.at("arch").display().to_string();
        assert_eq!(
            run(&["--input", &folder, "--output", &out, "--keys", &keys]),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {folder}")
            )
        );
        let txt = lab.at("u.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert_eq!(
            run(&[
                "--input",
                &txt.display().to_string(),
                "--output",
                &out,
                "--keys",
                &keys
            ]),
            argument("Unsupported file extension: .txt")
        );
        assert_eq!(
            run(&["--input", "", "--output", &out, "--keys", &keys]),
            argument("The path is empty.")
        );
        let wrong = lab.at("e.txt").display().to_string();
        assert_eq!(
            run(&["--input", &arch, "--output", &wrong, "--keys", &keys]),
            argument("Unsupported output extension: .txt")
        );
        let noext = lab.at("noext").display().to_string();
        assert_eq!(
            run(&["--input", &arch, "--output", &noext, "--keys", &keys]),
            argument("Unsupported output extension: ")
        );
        assert_eq!(
            run(&["--input", &arch, "--output", "", "--keys", &keys]),
            argument("The path is empty.")
        );
        let nokeys = lab.at("nokeys").display().to_string();
        let (code, message) = run(&["--input", &arch, "--output", &out, "--keys", &nokeys]);
        assert_eq!(code, "InvalidOperationException");
        assert!(
            message.starts_with("The GTA V RPF key file gtav_aes_key.dat could not be read from")
        );
        assert!(!Path::new(&out).exists());
    }

    #[test]
    fn output_folder_is_made_before_the_keys_are_read() {
        if std::env::var_os(KEYS_ENV).is_some() {
            return;
        }
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let out = lab.at("made").join("deep").join("e.json");
        let result = index_archive(
            &Options::parse(&[
                "--input".into(),
                arch,
                "--output".into(),
                out.display().to_string(),
            ])
            .unwrap(),
            &Progress::silent(),
        );
        assert_eq!(
            failure(result),
            (
                "FileNotFoundException".to_owned(),
                "GTA V executable was not found for in-memory key discovery.".to_owned()
            )
        );
        assert!(out.parent().unwrap().is_dir());
        assert!(!out.exists());
    }

    #[test]
    fn broken_inputs_and_outputs_are_reported_as_they_are() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let garbage = lab.at("garbage.rpf");
        std::fs::write(&garbage, [7u8; 5000]).unwrap();
        let tiny = lab.at("tiny.rpf");
        std::fs::write(&tiny, [1u8; 10]).unwrap();
        let zero = lab.at("zero.rpf");
        std::fs::write(&zero, b"").unwrap();
        let out = lab.at("e.json").display().to_string();
        for (file, text) in [
            (&garbage, "garbage.rpf: The identifier 07070707 did not match the expected value of 0x52504637"),
            (&tiny, "tiny.rpf: the file is too short to be an RPF7 archive"),
            (&zero, "zero.rpf: the file is too short to be an RPF7 archive"),
        ] {
            let result = lab.index(&["--input", &file.display().to_string(), "--output", &out]);
            assert_eq!(failure(result), ("InvalidDataException".to_owned(), text.to_owned()));
        }
        let dir_out = lab.at("dirout.json");
        std::fs::create_dir_all(&dir_out).unwrap();
        let (code, message) =
            failure(lab.index(&["--input", &arch, "--output", &dir_out.display().to_string()]));
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"));
        let afile = lab.at("afile");
        std::fs::write(&afile, b"x").unwrap();
        let below = afile.join("o.json").display().to_string();
        let (code, message) = failure(lab.index(&["--input", &arch, "--output", &below]));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 183)"));
    }

    // ----- предел числа записей -----

    fn many_empty(count: usize) -> DirNode {
        let mut root = DirNode::new("");
        root.files = (0..count)
            .map(|_| memory_file("x.bin", Vec::new()))
            .collect();
        root
    }

    #[test]
    #[ignore = "долго (около двух минут): 400 000 записей; запуск: cargo test -- --ignored"]
    fn the_cap_keeps_the_first_entries_and_marks_the_rest() {
        let lab = Lab::new();
        for (count, truncated) in [(ENTRY_CAP, false), (ENTRY_CAP + 1, true)] {
            let arch = lab.archive(&format!("many{count}.rpf"), &many_empty(count));
            let (answer, document, _) = lab.index_to(&arch, &[]);
            assert_eq!(answer["entryCount"], ENTRY_CAP);
            assert_eq!(answer["truncated"], truncated);
            assert_eq!(document["entries"].as_array().unwrap().len(), ENTRY_CAP);
        }
    }

    #[test]
    fn a_small_cap_counts_records_not_containers() {
        // обход самой команды, но с порогом в три записи
        fn count_with(tree: &DirNode, cap: usize) -> (usize, bool) {
            let lab = Lab::new();
            let arch = lab.archive("cap.rpf", tree);
            let archive = Arc::new(Archive::open_path(Path::new(&arch), None).unwrap());
            let found = survey(&archive, cap);
            (found.jobs.len(), found.truncated)
        }
        let mut with_zz = many_empty(2);
        with_zz.files.push(container(
            "zz.rpf",
            flat(&[("n1.xml", vec![]), ("n2.xml", vec![]), ("n3.xml", vec![])]),
        ));
        assert_eq!(count_with(&many_empty(3), 3), (3, false));
        assert_eq!(count_with(&many_empty(4), 3), (3, true));
        assert_eq!(count_with(&with_zz, 3), (3, true));
        let mut empty_pack = many_empty(3);
        empty_pack.files.push(container("zz.rpf", DirNode::new("")));
        assert_eq!(count_with(&empty_pack, 3), (3, false));
    }

    // ----- выемка -----

    fn files_of(answer: &Value) -> Vec<(String, String)> {
        answer["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| {
                (
                    f["entry"].as_str().unwrap().to_owned(),
                    f["file"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    fn missing_of(answer: &Value) -> Vec<String> {
        answer["missing"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m.as_str().unwrap().to_owned())
            .collect()
    }

    fn listing(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn extraction_follows_archive_order_and_reports_missing() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let x1 = lab.at("x1").display().to_string();
        let answer = lab
            .extract(
                &arch,
                &x1,
                &[
                    "common/data/a.xml",
                    "setup2.xml",
                    "nothere.xml",
                    "x64/data/cdimages/scaleform_generic.rpf/tex.ytd",
                ],
            )
            .unwrap();
        assert_eq!(answer["requested"], 4);
        assert_eq!(answer["extracted"], 3);
        assert_eq!(missing_of(&answer), ["nothere.xml"]);
        assert_eq!(
            files_of(&answer),
            [
                ("setup2.xml".to_owned(), "setup2.xml".to_owned()),
                (
                    "common/data/a.xml".to_owned(),
                    "common_data_a.xml".to_owned()
                ),
                (
                    "x64/data/cdimages/scaleform_generic.rpf/tex.ytd".to_owned(),
                    "x64_data_cdimages_scaleform_generic.rpf_tex.ytd".to_owned()
                ),
            ]
        );
        assert_eq!(answer["files"][1]["size"], 4000);
        assert_eq!(
            answer["files"][1]["sha256"],
            "74f7ba8b5166af8773eac89a138fd9627efbbe560b560fb6244e1593449afff5"
        );
        assert_eq!(
            listing(&lab.at("x1")),
            [
                "common_data_a.xml",
                "setup2.xml",
                "x64_data_cdimages_scaleform_generic.rpf_tex.ytd"
            ]
        );
        let keys: Vec<&str> = answer
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "archive",
                "outputDirectory",
                "requested",
                "extracted",
                "missing",
                "files"
            ]
        );
        // повтор в ту же папку перезаписывает
        let again = lab.extract(&arch, &x1, &["setup2.xml"]).unwrap();
        assert_eq!(again["extracted"], 1);
    }

    #[test]
    fn requested_paths_are_tidied_and_merged() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let dir = lab.at("x2").display().to_string();
        let answer = lab
            .extract(
                &arch,
                &dir,
                &[
                    "COMMON\\DATA\\A.XML",
                    "/setup2.xml",
                    "  content.xml  ",
                    "common/data/a.xml",
                ],
            )
            .unwrap();
        assert_eq!(answer["requested"], 4);
        assert_eq!(answer["extracted"], 3);
        assert_eq!(missing_of(&answer), Vec::<String>::new());
        assert_eq!(
            files_of(&answer)
                .into_iter()
                .map(|f| f.0)
                .collect::<Vec<_>>(),
            ["content.xml", "setup2.xml", "common/data/a.xml"]
        );

        let blank_dir = lab.at("x7").display().to_string();
        let blanks = lab.extract(&arch, &blank_dir, &["", "   ", "/"]).unwrap();
        assert_eq!(
            (blanks["requested"].as_u64(), blanks["extracted"].as_u64()),
            (Some(3), Some(0))
        );
        assert_eq!(missing_of(&blanks), Vec::<String>::new());
        assert!(listing(&lab.at("x7")).is_empty());

        let dirs_dir = lab.at("x6").display().to_string();
        let dirs = lab
            .extract(&arch, &dirs_dir, &["common/data", "common"])
            .unwrap();
        assert_eq!(missing_of(&dirs), ["common/data", "common"]);
    }

    #[test]
    fn containers_are_extracted_whole_or_opened_never_both() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let pack = "x64/data/cdimages/scaleform_generic.rpf";
        for (tag, order) in [
            (
                "a",
                vec![pack, "x64/data/cdimages/scaleform_generic.rpf/hud.gfx"],
            ),
            (
                "b",
                vec!["x64/data/cdimages/scaleform_generic.rpf/hud.gfx", pack],
            ),
        ] {
            let dir = lab.at(tag).display().to_string();
            let answer = lab.extract(&arch, &dir, &order).unwrap();
            assert_eq!(answer["extracted"], 1);
            assert_eq!(
                missing_of(&answer),
                ["x64/data/cdimages/scaleform_generic.rpf/hud.gfx"]
            );
            assert_eq!(
                answer["files"][0]["file"],
                "x64_data_cdimages_scaleform_generic.rpf"
            );
            assert_eq!(
                answer["files"][0]["size"],
                std::fs::metadata(lab.at(tag).join("x64_data_cdimages_scaleform_generic.rpf"))
                    .unwrap()
                    .len()
            );
        }
    }

    #[test]
    fn unicode_keys_and_flat_names() {
        let lab = Lab::new();
        let names = [
            "Подпапка/внутри.xml",
            "name with spaces.xml",
            "😀.bin",
            "STRASSE.TXT",
            "ǅ.txt",
            "ǆ.txt",
        ];
        let arch = lab.archive("names.rpf", &names_tree(&names));
        let dir = lab.at("x12").display().to_string();
        let answer = lab
            .extract(
                &arch,
                &dir,
                &[
                    "Подпапка/внутри.xml",
                    "name with spaces.xml",
                    "😀.bin",
                    "straße.txt",
                    "ǅ.txt",
                    "ǆ.TXT",
                ],
            )
            .unwrap();
        assert_eq!(answer["requested"], 6);
        assert_eq!(answer["extracted"], 5);
        assert_eq!(missing_of(&answer), Vec::<String>::new());
        let found: Vec<(String, String)> = files_of(&answer);
        assert_eq!(
            found,
            [
                ("STRASSE.TXT".to_owned(), "STRASSE.TXT".to_owned()),
                (
                    "name with spaces.xml".to_owned(),
                    "name_with_spaces.xml".to_owned()
                ),
                ("ǅ.txt".to_owned(), "ǅ.txt".to_owned()),
                ("😀.bin".to_owned(), "_.bin".to_owned()),
                (
                    "Подпапка/внутри.xml".to_owned(),
                    "Подпапка_внутри.xml".to_owned()
                ),
            ]
        );
        assert_eq!(
            listing(&lab.at("x12")),
            [
                "STRASSE.TXT",
                "_.bin",
                "name_with_spaces.xml",
                "ǅ.txt",
                "Подпапка_внутри.xml"
            ]
        );
    }

    #[test]
    fn flat_names_keep_the_tail_and_the_allowed_marks() {
        let table = [
            ("a/b c.ytd", "a_b_c.ytd"),
            ("a+b-c_d.e.xml", "a+b-c_d.e.xml"),
            (
                "ёж, \"кавычки\" (скобки) ★.xml",
                "ёж___кавычки___скобки___.xml",
            ),
        ];
        for (path, flat) in table {
            assert_eq!(disk_name(path), flat);
        }
        let long = disk_name(&format!("{}/end.xml", "x".repeat(200)));
        assert_eq!(
            (long.chars().count(), long.ends_with("_end.xml")),
            (120, true)
        );
        assert_eq!(disk_name(&"я".repeat(130)).chars().count(), 120);
    }

    #[test]
    fn wanted_set_dedupes_by_upper_key_and_remembers_the_last_spelling() {
        let values: Vec<String> = ["A/B.ytd", "\\a\\b.YTD ", "  ", "", "c.xml"]
            .iter()
            .map(|v| (*v).to_owned())
            .collect();
        let mut wanted = Wanted::collect(&values);
        assert_eq!(wanted.outstanding, 2);
        assert!(wanted.claim("a/B.YTD"));
        assert!(!wanted.claim("a/b.ytd"));
        assert_eq!(wanted.missing(), ["c.xml"]);
        assert!(wanted.claim("C.XML"));
        assert_eq!(wanted.outstanding, 0);
    }

    #[test]
    fn same_name_in_other_case_takes_the_first_in_the_walk() {
        let lab = Lab::new();
        let tree = flat(&[
            ("DUP.XML", text(42, "u")),
            ("Dup.xml", text(40, "m")),
            ("dup.xml", text(41, "l")),
        ]);
        let arch = lab.archive("dups.rpf", &tree);
        for (tag, entries) in [("d1", vec!["dup.xml"]), ("d2", vec!["DUP.XML", "Dup.xml"])] {
            let dir = lab.at(tag).display().to_string();
            let answer = lab.extract(&arch, &dir, &entries).unwrap();
            assert_eq!(answer["extracted"], 1);
            assert_eq!(answer["files"][0]["entry"], "DUP.XML");
            assert_eq!(answer["files"][0]["size"], 42);
            assert_eq!(listing(&lab.at(tag)), ["DUP.XML"]);
        }
    }

    #[test]
    fn missing_entries_are_listed_once_per_key_with_the_last_spelling() {
        let lab = Lab::new();
        let arch = lab.archive("zero.rpf", &flat(&[("empty.bin", vec![])]));
        let dir = lab.at("x20").display().to_string();
        let answer = lab
            .extract(
                &arch,
                &dir,
                &["nothere.xml", "NOTHERE.XML", "other.xml", "Nothere.xml"],
            )
            .unwrap();
        assert_eq!(answer["requested"], 4);
        assert_eq!(answer["extracted"], 0);
        assert_eq!(missing_of(&answer), ["Nothere.xml", "other.xml"]);
        assert!(listing(&lab.at("x20")).is_empty());
    }

    #[test]
    fn extraction_refusals_and_what_stays_on_disk() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let x8 = lab.at("x8").display().to_string();
        assert_eq!(
            failure(lab.extract(&arch, &x8, &[])),
            (
                "ArgumentException".to_owned(),
                "At least one --entry is required.".to_owned()
            )
        );
        assert!(!lab.at("x8").exists());
        let bad = lab.at("nokeys").display().to_string();
        let x10 = lab.at("x10").display().to_string();
        let result = extract_archive_entries(
            &Options::parse(
                &[
                    "--input",
                    &arch,
                    "--output-dir",
                    &x10,
                    "--keys",
                    &bad,
                    "--entry",
                    "common/data/a.xml",
                ]
                .map(String::from),
            )
            .unwrap(),
            &Progress::silent(),
        );
        assert_eq!(failure(result).0, "InvalidOperationException");
        assert!(!lab.at("x10").exists());

        let file_in_the_way = lab.at("afile2");
        std::fs::write(&file_in_the_way, b"x").unwrap();
        let (code, message) = failure(lab.extract(
            &arch,
            &file_in_the_way.display().to_string(),
            &["setup2.xml"],
        ));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 183)"));
        assert!(file_in_the_way.is_file());

        let mut tree = DirNode::new("");
        tree.files.push(memory_file("plain.txt", text(100, "p")));
        tree.files.push(FileNode {
            name: "bad.xml".into(),
            body: Body::Binary {
                data: Data::memory(text(4000, "bad")),
                compress: Compress::Always,
            },
        });
        let corrupt = lab.archive("corrupt.rpf", &tree);
        let offset = {
            let opened = Archive::open_path(Path::new(&corrupt), None).unwrap();
            let id = opened.find_file(opened.root(), "bad.xml").unwrap();
            match &opened.entry(id).kind {
                EntryKind::Binary(info) => info.offset() as usize,
                _ => unreachable!(),
            }
        };
        let mut raw = std::fs::read(&corrupt).unwrap();
        raw[offset..offset + 6].fill(0xFF);
        std::fs::write(&corrupt, raw).unwrap();
        let x16 = lab.at("x16").display().to_string();
        let result = lab.extract(&corrupt, &x16, &["plain.txt", "bad.xml"]);
        assert_eq!(failure(result).0, "InvalidDataException");
        assert!(lab.at("x16").is_dir());
    }

    #[test]
    fn the_request_limit_is_checked_before_the_folder_is_made() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let names: Vec<String> = (0..=REQUEST_CAP).map(|n| format!("n/{n}")).collect();
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let over = lab.at("over").display().to_string();
        assert_eq!(
            failure(lab.extract(&arch, &over, &refs)),
            (
                "ArgumentException".to_owned(),
                "Too many entries in one extraction.".to_owned()
            )
        );
        assert!(!lab.at("over").exists());
        let exact = lab.at("exact").display().to_string();
        let answer = lab.extract(&arch, &exact, &refs[..REQUEST_CAP]).unwrap();
        assert_eq!(
            (answer["requested"].as_u64(), answer["extracted"].as_u64()),
            (Some(REQUEST_CAP as u64), Some(0))
        );
        assert_eq!(missing_of(&answer).len(), REQUEST_CAP);
        assert!(lab.at("exact").is_dir());
    }

    #[test]
    fn extraction_goes_six_levels_deep_and_keeps_bad_containers_whole() {
        let lab = Lab::new();
        let deep = lab.archive("deep.rpf", &nested_chain());
        let base = "l1.rpf/l2.rpf/l3.rpf/l4.rpf/l5.rpf/l6.rpf";
        let wanted = [
            format!("{base}/f6.xml"),
            format!("{base}/l7.rpf/l8.rpf/f8.xml"),
            format!("{base}/l7.rpf"),
        ];
        let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
        let dir = lab.at("x17").display().to_string();
        let answer = lab.extract(&deep, &dir, &refs).unwrap();
        assert_eq!(
            (answer["requested"].as_u64(), answer["extracted"].as_u64()),
            (Some(3), Some(2))
        );
        assert_eq!(
            missing_of(&answer),
            [format!("{base}/l7.rpf/l8.rpf/f8.xml")]
        );
        assert_eq!(
            listing(&lab.at("x17")),
            [
                "l1.rpf_l2.rpf_l3.rpf_l4.rpf_l5.rpf_l6.rpf_f6.xml",
                "l1.rpf_l2.rpf_l3.rpf_l4.rpf_l5.rpf_l6.rpf_l7.rpf"
            ]
        );
        assert_eq!(answer["files"][1]["size"], 2048);

        let mut x64 = DirNode::new("x64");
        x64.files.push(memory_file("bad.rpf", noise(3000, 4)));
        x64.files.push(memory_file("SHORT.RPF", noise(10, 5)));
        x64.files.push(FileNode {
            name: "res.rpf".into(),
            body: Body::Resource {
                data: Data::memory(resource(1, 2, &noise(300, 6))),
            },
        });
        x64.files
            .push(container("plain.rpf", flat(&[("in.xml", text(900, "in"))])));
        let mut root = DirNode::new("");
        root.dirs.push(x64);
        let bad = lab.archive("badnested.rpf", &root);
        let dir = lab.at("x15").display().to_string();
        let answer = lab
            .extract(
                &bad,
                &dir,
                &[
                    "x64/bad.rpf",
                    "x64/short.rpf",
                    "x64/res.rpf",
                    "x64/plain.rpf/in.xml",
                ],
            )
            .unwrap();
        assert_eq!(answer["extracted"], 4);
        assert_eq!(
            listing(&lab.at("x15")),
            [
                "x64_SHORT.RPF",
                "x64_bad.rpf",
                "x64_plain.rpf_in.xml",
                "x64_res.rpf"
            ]
        );
        assert_eq!(answer["files"][3]["size"], 316);
    }

    #[test]
    fn flat_names_that_differ_only_in_case_are_refused_before_anything_is_written() {
        let lab = Lab::new();
        let mut tree = flat(&[
            ("aaa.xml", text(10, "first")),
            ("a_b.xml", text(21, "x")),
            ("ǆ_ä.txt", text(5, "u")),
        ]);
        let mut slash = DirNode::new("a");
        slash.files.push(memory_file("B.xml", text(22, "y")));
        tree.dirs.push(slash);
        let mut other = DirNode::new("ǅ");
        other.files.push(memory_file("Ä.txt", text(6, "v")));
        tree.dirs.push(other);
        let arch = lab.archive("collide.rpf", &tree);
        let dir = lab.at("kept");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a_b.xml"), b"old bytes").unwrap();
        let dir_text = dir.display().to_string();

        // `a/B.xml` и `a_b.xml` — один файл на Windows; ранее найденный `aaa.xml` не пишется
        let refused = failure(lab.extract(&arch, &dir_text, &["aaa.xml", "a/b.xml", "A_B.XML"]));
        assert_eq!(
            refused,
            (
                "ArgumentException".to_owned(),
                "Entries \"a_b.xml\" and \"a/B.xml\" share the output file name \"a_b.xml\"."
                    .to_owned()
            )
        );
        assert_eq!(listing(&dir), ["a_b.xml"]);
        assert_eq!(std::fs::read(dir.join("a_b.xml")).unwrap(), b"old bytes");

        // не только ASCII: `ǅ/Ä.txt` и `ǆ_ä.txt` сводятся к одному имени
        let wide = lab.at("kept2").display().to_string();
        let refused = failure(lab.extract(&arch, &wide, &["aaa.xml", "ǅ/Ä.txt", "ǆ_ä.txt"]));
        assert_eq!(refused.0, "ArgumentException");
        assert!(
            refused.1.contains("\"ǆ_ä.txt\" and \"ǅ/Ä.txt\""),
            "{}",
            refused.1
        );
        assert!(listing(&lab.at("kept2")).is_empty());

        // без совпадений вывод тот же, что и раньше
        let fine = lab.at("kept3").display().to_string();
        let answer = lab
            .extract(&arch, &fine, &["aaa.xml", "a/b.xml", "ǅ/Ä.txt"])
            .unwrap();
        assert_eq!(answer["extracted"], 3);
        assert_eq!(
            files_of(&answer),
            [
                ("aaa.xml".to_owned(), "aaa.xml".to_owned()),
                ("a/B.xml".to_owned(), "a_B.xml".to_owned()),
                ("ǅ/Ä.txt".to_owned(), "ǅ_Ä.txt".to_owned()),
            ]
        );
        assert_eq!(listing(&lab.at("kept3")), ["a_B.xml", "aaa.xml", "ǅ_Ä.txt"]);
    }

    #[test]
    fn extraction_of_empty_entries_and_colliding_flat_names() {
        let lab = Lab::new();
        let mut tree = flat(&[("empty.bin", vec![])]);
        let mut sub = DirNode::new("d");
        sub.files.push(memory_file("z.xml", vec![]));
        tree.dirs.push(sub);
        let zero = lab.archive("zero.rpf", &tree);
        let dir = lab.at("x18").display().to_string();
        let answer = lab.extract(&zero, &dir, &["empty.bin", "d/z.xml"]).unwrap();
        assert_eq!(listing(&lab.at("x18")), ["d_z.xml", "empty.bin"]);
        for item in answer["files"].as_array().unwrap() {
            assert_eq!(item["size"], 0);
            assert_eq!(
                item["sha256"],
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            );
        }

        let mut clash = flat(&[("a_b.xml", text(21, "x"))]);
        let mut slash = DirNode::new("a");
        slash.files.push(memory_file("b.xml", text(22, "y")));
        clash.dirs.push(slash);
        let arch = lab.archive("collide.rpf", &clash);
        let dir = lab.at("x22").display().to_string();
        // два пути с одним плоским именем: отказ до записи, папка остаётся пустой
        let refused = failure(lab.extract(&arch, &dir, &["a/b.xml", "a_b.xml"]));
        assert_eq!(
            refused,
            (
                "ArgumentException".to_owned(),
                "Entries \"a_b.xml\" and \"a/b.xml\" share the output file name \"a_b.xml\"."
                    .to_owned()
            )
        );
        assert!(listing(&lab.at("x22")).is_empty());
        let args: Vec<String> = [
            "--INPUT",
            arch.as_str(),
            "--OUTPUT-DIR",
            &lab.at("x24").display().to_string(),
            "--KEYS",
            &lab.keys(),
            "--ENTRY",
            "a_b.xml",
        ]
        .iter()
        .map(|item| (*item).to_owned())
        .collect();
        let upper =
            extract_archive_entries(&Options::parse(&args).unwrap(), &Progress::silent()).unwrap();
        assert_eq!(upper["extracted"], 1);
    }
}
