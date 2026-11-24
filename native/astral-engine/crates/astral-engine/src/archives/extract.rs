//! Команды `extract-rpf` и `extract-many-rpf`: записи архива на диск по
//! запросу из JSON-файла.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use rage_rpf::{Archive, EntryId, EntryKind};
use serde_json::{self, Value};

use super::{
    compose::normalize_entry, index::compare_ignore_case, load_keys, random_hex, sha256_hex,
};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths::{existing_file, full_path, normalize_relative},
    progress::Progress,
};

/// Запись крупнее этого не выгружается.
const ENTRY_BYTES_CAP: usize = 256 << 20;
/// Записей в одной пачке не больше.
const BATCH_CAP: usize = 5_000;

/// Объект JSON из пар «ключ, значение»; порядок ключей — порядок пар.
fn object(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    let fields: serde_json::Map<String, Value> = pairs
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect();
    fields.into()
}

/// Ответ «готово»: общая шапка и затем поля команды.
fn ready(fields: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    let head = [
        ("status", Value::from("ready")),
        ("mode", Value::from("read-only")),
    ];
    object(head.into_iter().chain(fields))
}

/// Поля ответа об одной выгруженной записи.
fn row(links: &[String], target: &Path, size: usize, digest: String) -> [(&'static str, Value); 4] {
    [
        ("entry", links.join("/").into()),
        ("output", target.to_string_lossy().into()),
        ("bytes", size.into()),
        ("sha256", digest.into()),
    ]
}

/// Запрос из JSON-файла и параметры запуска. Поле нужного типа читается,
/// всё прочее считается отсутствующим.
struct Job<'a> {
    options: &'a Options,
    body: Value,
}

/// Читает файл запроса, на который указывает `--request`.
fn read_job<'a>(options: &'a Options) -> Result<Job<'a>> {
    let raw = options
        .required("request")
        .and_then(full_path)
        .and_then(|path| fs::read_to_string(path).map_err(EngineError::from))?;
    let body = raw
        .trim_start_matches('\u{feff}')
        .parse::<Value>()
        .or(Err(EngineError::invalid_data("RPF request is not JSON.")))?;
    Ok(Job { options, body })
}

impl Job<'_> {
    fn text(&self, name: &str) -> Option<&str> {
        self.body.get(name)?.as_str()
    }

    /// Путь из поля запроса, который вызывающий обязан дать абсолютным.
    fn path(&self, name: &'static str) -> Result<PathBuf> {
        match full_path(self.text(name).unwrap_or_default()) {
            Ok(path) if path.is_absolute() => Ok(path),
            Ok(_) => Err(EngineError::argument("Helper paths must be absolute.")),
            Err(failure) => Err(failure),
        }
    }

    /// Строки списка; не массив читается как пустой список, а нестрока в массиве
    /// отказывает, как негодный путь записи.
    fn strings(&self, name: &str) -> Result<Vec<&str>> {
        let Some(Value::Array(items)) = self.body.get(name) else {
            return Ok(Vec::new());
        };
        items
            .iter()
            .map(|item| match item.as_str() {
                Some(text) => Ok(text),
                None => Err(EngineError::invalid_data("Invalid RPF entry path.")),
            })
            .collect()
    }

    /// Пути пачки: число, вид и повторы проверяются раньше любой работы с диском.
    fn batch(&self) -> Result<Vec<Vec<String>>> {
        let listed = match self.strings("extractEntries")? {
            names if (1..=BATCH_CAP).contains(&names.len()) => names,
            _ => {
                return Err(EngineError::invalid_data(
                    "Invalid RPF extraction entry count.",
                ))
            }
        };
        let mut batch = Vec::new();
        for text in listed {
            let links = normalize_entry(text, true)?;
            // Звенья станут путём файла под папкой выхода (`lay_entry`): имя, которое
            // Windows понимает иначе, чем написано, — такой же негодный путь записи.
            if normalize_relative(&links.join("/")).is_err() {
                return Err(EngineError::invalid_data("Unsafe RPF entry path."));
            }
            batch.push(links);
        }
        let distinct = batch.iter().fold(HashSet::new(), |mut seen, links| {
            seen.insert(links.join("/"));
            seen
        });
        if distinct.len() == batch.len() {
            Ok(batch)
        } else {
            Err(EngineError::invalid_data("Duplicate RPF extraction entry."))
        }
    }

    /// Открывает архив из `baseArchive`; ключи берутся после проверки файла.
    fn open_archive(&self) -> Result<(Arc<Archive>, &'static str)> {
        let given = match self.text("baseArchive") {
            Some(given) => given,
            None => return Err(EngineError::argument("RPF base archive is required.")),
        };
        let path = existing_file(given, &[".rpf"])?;
        let game_root = self.options.optional("game-root").unwrap_or_default();
        let (keys, source) = load_keys(game_root, self.options.optional("keys"))?;
        Archive::open_path(&path, Some(keys))
            .map(|archive| (archive.into(), source))
            .map_err(EngineError::from)
    }
}

/// Что ищется в каталоге.
#[derive(Clone, Copy)]
enum Kind {
    Dir,
    File,
}

/// Место обхода: открытый архив (основной или раскрытый из него) и каталог в нём.
#[derive(Clone)]
struct Cursor {
    archive: Arc<Archive>,
    dir: EntryId,
}

impl Cursor {
    fn at_root(archive: &Arc<Archive>) -> Self {
        Self {
            dir: archive.root(),
            archive: Arc::clone(archive),
        }
    }

    /// Точное совпадение, а за неимением его — первая запись из `pool`, чьё имя
    /// совпало с `name` без учёта регистра и вне ASCII (свёртка та же, что у
    /// упорядочения путей описи).
    fn or_folded(&self, name: &str, exact: Option<EntryId>, pool: &[EntryId]) -> Option<EntryId> {
        exact.or_else(|| {
            let same =
                |id: &EntryId| compare_ignore_case(&self.archive.entry(*id).name, name).is_eq();
            pool.iter().copied().find(same)
        })
    }

    /// Запись каталога по имени: как у архива (регистр ASCII), иначе по свёртке.
    fn find(&self, name: &str, kind: Kind) -> Option<EntryId> {
        match kind {
            Kind::Dir => self.or_folded(
                name,
                self.archive.find_dir(self.dir, name),
                self.archive.dirs(self.dir),
            ),
            Kind::File => self.or_folded(
                name,
                self.archive.find_file(self.dir, name),
                self.archive.files(self.dir),
            ),
        }
    }

    /// Шаг по звену пути: в подкаталог, а если его нет — в раскрытый контейнер.
    fn enter(self, link: &str) -> Result<Self> {
        match self.find(link, Kind::Dir) {
            Some(dir) => Ok(Self { dir, ..self }),
            None => self.open_container(link),
        }
    }

    /// Раскрывает файл-контейнер `link` как вложенный архив; нет такого — нет и каталога.
    fn open_container(&self, link: &str) -> Result<Self> {
        let container = Some(link)
            .filter(|name| Archive::is_nested_archive_name(name))
            .and_then(|name| self.find(name, Kind::File));
        match container {
            Some(id) => {
                let inner = Arc::new(self.archive.open_nested(id)?);
                Ok(Self {
                    dir: inner.root(),
                    archive: inner,
                })
            }
            None => {
                let message = format!("RPF directory not found: {link}");
                Err(EngineError::directory_not_found(message))
            }
        }
    }

    /// Содержимое записи: ресурс отдаётся как есть, прочее расшифровывается по архиву.
    fn read(&self, id: EntryId) -> Result<Vec<u8>> {
        let archive = &self.archive;
        let bytes = match archive.entry(id).kind {
            EntryKind::Resource(_) => archive.export(id),
            _ => archive.decode(id, rage_rpf::EntryCipher::ByArchive),
        };
        bytes.map_err(EngineError::from)
    }
}

/// Пройденные места обхода одной пачки: путь каталога от корня → место.
///
/// Записи одной папки и одного вложенного архива делят одно раскрытие. Без этой памяти контейнер
/// раскрывался заново на каждую запись: его оглавление читалось и расшифровывалось столько раз,
/// сколько в пачке записей (замер 14.11.2026 на наборе «Вода»: 1068 записей — 15,8 с и 2 ГБ чтения
/// ради 55 МБ файлов).
#[derive(Default)]
struct Routes {
    known: HashMap<String, Cursor>,
    /// Сколько звеньев пришлось пройти по архиву (остальные взяты из памяти).
    walked: usize,
}

impl Routes {
    /// Место каталога `route`; каждое пройденное звено запоминается.
    fn reach(&mut self, archive: &Arc<Archive>, route: &[String]) -> Result<Cursor> {
        let mut here = Cursor::at_root(archive);
        let mut key = String::new();
        for link in route {
            key.push('/');
            key.push_str(link);
            here = match self.known.get(&key) {
                Some(seen) => seen.clone(),
                None => {
                    let next = here.enter(link)?;
                    self.walked += 1;
                    self.known.insert(key.clone(), next.clone());
                    next
                }
            };
        }
        Ok(here)
    }
}

/// Байты записи по звеньям пути; контейнеры в середине раскрываются.
fn fetch(archive: &Arc<Archive>, links: &[String]) -> Result<Vec<u8>> {
    fetch_along(&mut Routes::default(), archive, links)
}

/// То же с памятью мест обхода: записи пачки не раскрывают один контейнер дважды.
fn fetch_along(routes: &mut Routes, archive: &Arc<Archive>, links: &[String]) -> Result<Vec<u8>> {
    let (route, leaf) = match links {
        [route @ .., leaf] => (route, leaf),
        [] => return Err(EngineError::file_not_found("RPF entry not found: ")),
    };
    let cursor = routes.reach(archive, route)?;
    match cursor.find(leaf, Kind::File) {
        None => {
            let message = format!("RPF entry not found: {}", links.join("/"));
            Err(EngineError::file_not_found(message))
        }
        Some(id) => {
            let bytes = cursor.read(id)?;
            if bytes.len() > ENTRY_BYTES_CAP {
                let message = "RPF entry is too large to extract: ".to_owned() + leaf;
                Err(EngineError::invalid_data(message))
            } else {
                Ok(bytes)
            }
        }
    }
}

/// Временное имя рядом с `target`.
fn scratch_beside(target: &Path) -> PathBuf {
    let mut name = target.as_os_str().to_owned();
    name.push(".extract-");
    name.push(random_hex(16));
    name.into()
}

/// Пишет байты во временный соседний файл и переименовывает его в `target`.
fn place(bytes: &[u8], target: &Path) -> Result<()> {
    target.parent().map_or(Ok(()), fs::create_dir_all)?;
    let scratch = scratch_beside(target);
    fs::File::create(&scratch)?.write_all(bytes)?;
    match fs::rename(&scratch, target) {
        Ok(()) => Ok(()),
        Err(failure) => {
            fs::remove_file(&scratch).ok();
            Err(failure.into())
        }
    }
}

/// Папки и файлы, которые создал этот запуск: при отказе он убирает их сам.
#[derive(Default)]
struct Made {
    dirs: Vec<PathBuf>,
    files: Vec<PathBuf>,
}

impl Made {
    /// Отказывает, если по пути уже что-то лежит (ссылка тоже считается).
    fn vacant(target: &Path) -> Result<()> {
        match target.symlink_metadata() {
            Ok(_) => {
                let message = format!("Output already exists: {}", target.display());
                Err(EngineError::io(message))
            }
            Err(_) => Ok(()),
        }
    }

    /// `create_dir_all`, который запоминает ещё не существовавшие звенья пути.
    fn dirs_all(&mut self, path: &Path) -> Result<()> {
        let mut absent = Vec::new();
        let mut step = Some(path);
        while let Some(each) = step.filter(|each| !each.exists()) {
            absent.push(each.to_path_buf());
            step = each.parent();
        }
        self.dirs.extend(absent.into_iter().rev());
        fs::create_dir_all(path).map_err(EngineError::from)
    }

    /// Кладёт байты в новый файл `target` (занятый путь отказывает), создавая
    /// недостающие папки, и запоминает всё созданное.
    fn lay(&mut self, bytes: &[u8], target: &Path) -> Result<()> {
        Self::vacant(target)?;
        target
            .parent()
            .map_or(Ok(()), |parent| self.dirs_all(parent))?;
        place(bytes, target)?;
        self.files.push(target.to_path_buf());
        Ok(())
    }

    /// Убирает записанные файлы, затем созданные папки с самой глубокой; папка,
    /// в которой лежит чужой файл, не пуста и остаётся.
    fn undo(self) {
        let files = self.files.iter().rev().map(fs::remove_file);
        let dirs = self.dirs.iter().rev().map(fs::remove_dir);
        files.chain(dirs).for_each(drop);
    }
}

/// Кладёт одну запись пачки под `directory` и возвращает её строку ответа. Отпечаток — по тем же
/// байтам, что легли в файл (как у `extract-rpf`): перечитывать с диска тысячу только что
/// записанных файлов незачем.
fn lay_entry(
    made: &mut Made,
    routes: &mut Routes,
    links: &[String],
    archive: &Arc<Archive>,
    directory: &Path,
) -> Result<Value> {
    let bytes = fetch_along(routes, archive, links)?;
    let mut target = directory.to_path_buf();
    target.extend(links);
    made.lay(&bytes, &target)?;
    Ok(object(row(links, &target, bytes.len(), sha256_hex(&bytes))))
}

/// Выкладывает пачку в `directory`: строки ответа и метка источника ключей.
fn lay_batch(
    made: &mut Made,
    job: &Job,
    directory: &Path,
    batch: &[Vec<String>],
) -> Result<(Vec<Value>, &'static str)> {
    let (archive, source) = made.dirs_all(directory).and_then(|()| job.open_archive())?;
    let mut routes = Routes::default();
    let mut rows = Vec::new();
    for links in batch {
        rows.push(lay_entry(made, &mut routes, links, &archive, directory)?);
    }
    Ok((rows, source))
}

pub fn extract_rpf(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = read_job(options)?;
    let output = job.path("extractOutput")?;
    let entry = job.text("entry").unwrap_or_default();
    let links = normalize_entry(entry, true)?;
    let archive = job.open_archive()?.0;

    let bytes = fetch(&archive, &links)?;
    place(&bytes, &output)?;

    Ok(ready(row(&links, &output, bytes.len(), sha256_hex(&bytes))))
}

pub fn extract_many_rpf(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = read_job(options)?;
    let directory = job.path("extractOutputDirectory")?;
    let batch = job.batch()?;

    let mut made = Made::default();
    let laid = lay_batch(&mut made, &job, &directory, &batch);
    let (rows, source) = laid.inspect_err(|_| made.undo())?;

    let key_mode = match source {
        super::KEYS_FROM_DIRECTORY => "external-verified-local",
        _ => "game-executable",
    };
    Ok(ready([
        ("extracted", rows.into()),
        ("keyMode", key_mode.into()),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_rpf::fixtures::{noise, resource, text, update_tree};
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::fs::File;
    use tempfile::{tempdir, TempDir};

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
        root.files = files
            .iter()
            .map(|(name, bytes)| memory_file(name, bytes.clone()))
            .collect();
        root
    }

    fn pack(name: &str, inner: DirNode) -> FileNode {
        FileNode {
            name: name.into(),
            body: Body::Nested(Box::new(inner)),
        }
    }

    fn write_tree(tree: &DirNode, path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    struct Lab {
        dir: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempdir().unwrap();
            let keys = dir.path().join("keys");
            fs::create_dir_all(&keys).unwrap();
            for (name, len) in [
                ("gtav_aes_key.dat", 32),
                ("gtav_ng_key.dat", 101 * 68 * 4),
                ("gtav_ng_decrypt_tables.dat", 17 * 4096 * 4),
                ("gtav_hash_lut.dat", 256),
            ] {
                fs::write(keys.join(name), vec![5u8; len]).unwrap();
            }
            Lab { dir }
        }

        fn at(&self, tail: &str) -> PathBuf {
            tail.split('/')
                .filter(|part| !part.is_empty())
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
        }

        fn text(&self, tail: &str) -> String {
            self.at(tail).display().to_string()
        }

        fn archive(&self, name: &str, tree: &DirNode) -> String {
            let path = self.at("arch").join(name);
            write_tree(tree, &path);
            path.display().to_string()
        }

        fn update(&self) -> String {
            self.archive("update.rpf", &update_tree(None))
        }

        /// Файл запроса с заданным текстом и запуск команды с ключами лаборатории.
        fn raw_request(&self, body: &[u8], keys: bool) -> (PathBuf, Options) {
            let path = self.at("req").join(format!("{}.json", random_hex(8)));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, body).unwrap();
            let mut args = vec!["--request".to_owned(), path.display().to_string()];
            if keys {
                args.extend(["--keys".to_owned(), self.text("keys")]);
            }
            (path, Options::parse(&args).unwrap())
        }

        fn one(&self, request: &Value) -> Result<Value> {
            let (_, options) = self.raw_request(request.to_string().as_bytes(), true);
            extract_rpf(&options, &Progress::silent())
        }

        fn many(&self, request: &Value) -> Result<Value> {
            let (_, options) = self.raw_request(request.to_string().as_bytes(), true);
            extract_many_rpf(&options, &Progress::silent())
        }
    }

    fn failure<T>(result: Result<T>) -> (String, String) {
        match result {
            Err(error) => (error.code, error.message),
            Ok(_) => panic!("ожидался отказ"),
        }
    }

    fn refusal(code: &str, message: &str) -> (String, String) {
        (code.to_owned(), message.to_owned())
    }

    fn tree_listing(root: &Path) -> Vec<String> {
        fn visit(dir: &Path, base: &Path, out: &mut Vec<String>) {
            let mut kids: Vec<_> = fs::read_dir(dir)
                .unwrap()
                .map(|e| e.unwrap().path())
                .collect();
            kids.sort();
            for kid in kids {
                out.push(
                    kid.strip_prefix(base)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
                if kid.is_dir() {
                    visit(&kid, base, out);
                }
            }
        }
        let mut out = Vec::new();
        visit(root, root, &mut out);
        out
    }

    const A_XML_SHA: &str = "74f7ba8b5166af8773eac89a138fd9627efbbe560b560fb6244e1593449afff5";

    // ----- extract-rpf -----

    #[test]
    fn single_entry_lands_in_the_named_file() {
        let lab = Lab::new();
        let arch = lab.update();
        let out = lab.text("o/a.xml");
        let answer = lab
            .one(&json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": out}))
            .unwrap();
        assert_eq!(
            answer,
            json!({"status": "ready", "mode": "read-only", "entry": "common/data/a.xml",
                   "output": out, "bytes": 4000, "sha256": A_XML_SHA})
        );
        let keys: Vec<&str> = answer
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            ["status", "mode", "entry", "output", "bytes", "sha256"]
        );
        assert_eq!(sha256_hex(&fs::read(&out).unwrap()), A_XML_SHA);
        assert_eq!(tree_listing(&lab.at("o")), ["a.xml"]);

        let spelled = lab
            .one(&json!({"baseArchive": arch, "entry": "  COMMON\\Data\\A.XML  ", "extractOutput": lab.text("o/a2.xml")}))
            .unwrap();
        assert_eq!(spelled["entry"], "common/data/a.xml");
        // повторная выгрузка в тот же файл заменяет его
        let again = lab
            .one(&json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": out}))
            .unwrap();
        assert_eq!(again["bytes"], 4000);
        assert_eq!(tree_listing(&lab.at("o")), ["a.xml", "a2.xml"]);
    }

    #[test]
    fn resources_containers_and_nested_paths() {
        let lab = Lab::new();
        let arch = lab.update();
        let ytd = lab.text("o/tex.ytd");
        let answer = lab
            .one(&json!({"baseArchive": arch, "entry": "x64/data/cdimages/scaleform_generic.rpf/tex.ytd", "extractOutput": ytd}))
            .unwrap();
        assert_eq!(answer["bytes"], 916);
        let head = fs::read(&ytd).unwrap();
        assert_eq!(&head[..4], b"RSC7");
        assert_eq!(&head[4..16], [0x69, 0, 0, 0, 1, 0, 0, 0x60, 2, 0, 0, 0x90]);

        let whole = lab
            .one(&json!({"baseArchive": arch, "entry": "x64/data/cdimages/scaleform_generic.rpf", "extractOutput": lab.text("o/gen.rpf")}))
            .unwrap();
        assert_eq!(
            whole["bytes"],
            fs::metadata(lab.at("o/gen.rpf")).unwrap().len()
        );
        let deep = lab
            .one(&json!({"baseArchive": arch, "entry": "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml", "extractOutput": lab.text("o/deep.xml")}))
            .unwrap();
        assert_eq!(deep["bytes"], 700);
        assert_eq!(
            deep["sha256"],
            "bcbc978d7aa7abe0cd18682e913dd56852d3482d987efed863926cef0e650156"
        );
    }

    #[test]
    fn lookups_that_fail_name_the_missing_part() {
        let lab = Lab::new();
        let arch = lab.update();
        let ask = |entry: &str| {
            failure(lab.one(
                &json!({"baseArchive": arch, "entry": entry, "extractOutput": lab.text("o/z.xml")}),
            ))
        };
        assert_eq!(
            ask("common/data/zzz.xml"),
            refusal(
                "FileNotFoundException",
                "RPF entry not found: common/data/zzz.xml"
            )
        );
        assert_eq!(
            ask("nodir/data/zzz.xml"),
            refusal(
                "DirectoryNotFoundException",
                "RPF directory not found: nodir"
            )
        );
        assert_eq!(
            ask("common/data"),
            refusal("FileNotFoundException", "RPF entry not found: common/data")
        );
        assert_eq!(
            ask("x64/data/cdimages/scaleform_generic.rpf/nothere/x.xml"),
            refusal(
                "DirectoryNotFoundException",
                "RPF directory not found: nothere"
            )
        );
        assert_eq!(
            ask("x64/data/cdimages/nothere.rpf/x.xml"),
            refusal(
                "DirectoryNotFoundException",
                "RPF directory not found: nothere.rpf"
            )
        );
        assert!(!lab.at("o").exists(), "до записи ничего не создаётся");
    }

    #[test]
    fn request_file_problems() {
        let lab = Lab::new();
        let arch = lab.update();
        let out = lab.text("o/q.xml");
        let ok = format!(
            "{{\"baseArchive\":{},\"entry\":\"setup2.xml\",\"extractOutput\":{}}}",
            Value::from(arch.clone()),
            Value::from(out.clone())
        );
        let run = |body: &[u8]| {
            let (_, options) = lab.raw_request(body, true);
            extract_rpf(&options, &Progress::silent())
        };
        assert_eq!(
            failure(run(b"not json")),
            refusal("InvalidDataException", "RPF request is not JSON.")
        );
        assert_eq!(
            failure(run(b"")),
            refusal("InvalidDataException", "RPF request is not JSON.")
        );
        assert_eq!(
            failure(run(b"[1,2]")),
            refusal("ArgumentException", "The path is empty.")
        );
        assert_eq!(
            failure(run(b"5")),
            refusal("ArgumentException", "The path is empty.")
        );
        let with_bom = [&[0xEF, 0xBB, 0xBF][..], ok.as_bytes()].concat();
        assert_eq!(run(&with_bom).unwrap()["bytes"], 315);
        let (code, message) = failure(run(&[b'{', 0xFF, 0xFE, b'}']));
        assert_eq!(
            (code.as_str(), message.as_str()),
            ("IOException", "stream did not contain valid UTF-8")
        );
        // повтор ключа: берётся последний
        let doubled = format!(
            "{{\"baseArchive\":{},\"entry\":\"setup2.xml\",\"entry\":\"content.xml\",\"extractOutput\":{}}}",
            Value::from(arch.clone()),
            Value::from(lab.text("o/dup.xml"))
        );
        assert_eq!(run(doubled.as_bytes()).unwrap()["entry"], "content.xml");

        let no_request = Options::parse(&["--keys".to_owned(), lab.text("keys")]).unwrap();
        assert_eq!(
            failure(extract_rpf(&no_request, &Progress::silent())),
            refusal("ArgumentException", "--request is required.")
        );
        let blank = Options::parse(&["--request".to_owned(), String::new()]).unwrap();
        assert_eq!(
            failure(extract_rpf(&blank, &Progress::silent())),
            refusal("ArgumentException", "The path is empty.")
        );
        let missing = Options::parse(&["--request".to_owned(), lab.text("nothere.json")]).unwrap();
        let (code, message) = failure(extract_rpf(&missing, &Progress::silent()));
        assert_eq!(code, "FileNotFoundException");
        assert!(message.ends_with("(os error 2)"));
        let folder = Options::parse(&["--request".to_owned(), lab.text("req")]).unwrap();
        let (code, message) = failure(extract_rpf(&folder, &Progress::silent()));
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"));
    }

    #[test]
    fn field_checks_run_in_the_documented_order() {
        let lab = Lab::new();
        let arch = lab.update();
        let out = lab.text("o/q.xml");
        let one = |request: Value| failure(lab.one(&request));
        assert_eq!(
            one(json!({"baseArchive": arch, "entry": "common/data/a.xml"})),
            refusal("ArgumentException", "The path is empty.")
        );
        assert_eq!(
            one(json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": "   "})),
            refusal("ArgumentException", "The path is empty.")
        );
        assert_eq!(
            one(
                json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": "Z:rel"})
            ),
            refusal("ArgumentException", "Helper paths must be absolute.")
        );
        assert_eq!(
            one(json!({"baseArchive": arch, "extractOutput": out})),
            refusal("InvalidDataException", "Invalid RPF entry path.")
        );
        assert_eq!(
            one(json!({"baseArchive": arch, "entry": 5, "extractOutput": out})),
            refusal("InvalidDataException", "Invalid RPF entry path.")
        );
        assert_eq!(
            one(json!({"entry": "../x", "extractOutput": out})),
            refusal("InvalidDataException", "Unsafe RPF entry path.")
        );
        assert_eq!(
            one(json!({"entry": "common/data/a.xml", "extractOutput": out})),
            refusal("ArgumentException", "RPF base archive is required.")
        );
        assert_eq!(
            one(json!({"baseArchive": 5, "entry": "common/data/a.xml", "extractOutput": out})),
            refusal("ArgumentException", "RPF base archive is required.")
        );
        let gone = lab.text("arch/nothere.rpf");
        assert_eq!(
            one(json!({"baseArchive": gone, "entry": "a", "extractOutput": out})),
            refusal(
                "FileNotFoundException",
                format!("File was not found: {gone}").as_str()
            )
        );
        let json_file = lab.text("keys/gtav_hash_lut.dat");
        assert_eq!(
            one(json!({"baseArchive": json_file, "entry": "a", "extractOutput": out})),
            refusal("ArgumentException", "Unsupported file extension: .dat")
        );
        for (entry, text) in [
            ("../a", "Unsafe RPF entry path."),
            ("update:/common/a.xml", "Unsafe RPF entry path."),
            ("/common/data/a.xml", "Invalid RPF entry path."),
        ] {
            assert_eq!(
                one(json!({"baseArchive": arch, "entry": entry, "extractOutput": out})),
                refusal("InvalidDataException", text)
            );
        }
        assert!(!lab.at("o").exists());
    }

    /// В пачке звенья записи становятся путём файла под папкой выхода. Имя, которое
    /// Windows понимает иначе, чем написано (точка или пробел на конце, устройство,
    /// знак не из имён файлов), отвергается до работы с диском тем же отказом, что и
    /// прочие негодные пути записи (разбор безопасности 23.11.2026, H3-03). У
    /// одиночной выгрузки файл выхода назван запросом, её это не касается.
    #[test]
    fn a_batch_refuses_entry_names_that_windows_reads_differently() {
        let lab = Lab::new();
        let arch = lab.update();
        let out = lab.text("batch-out");
        let many = |entries: &[&str]| {
            failure(
                lab.many(&json!({"baseArchive": arch, "extractEntries": entries,
                "extractOutputDirectory": out})),
            )
        };
        for entry in [
            "common/data/a.xml.",
            "common/data /a.xml",
            "common/nul",
            "common/COM1.xml",
            "common/data/a?.xml",
        ] {
            assert_eq!(
                many(&["common/data/a.xml", entry]),
                refusal("InvalidDataException", "Unsafe RPF entry path."),
                "{entry}"
            );
            assert!(!lab.at("batch-out").exists(), "{entry}");
        }
        // пробел и точки внутри имени — обычное имя: отказа по имени нет, записи просто нет
        let (code, message) = many(&["common/data/my file.v2.xml"]);
        assert_eq!(code, "FileNotFoundException", "{message}");
    }

    #[test]
    fn names_are_lowered_fully_and_matched_without_regard_to_case() {
        let lab = Lab::new();
        let names = lab.archive(
            "names.rpf",
            &flat(&[
                ("Ärger.xml", text(30, "upper")),
                ("ärger.xml", text(31, "lower")),
                ("STRASSE.TXT", text(32, "s")),
                ("straße.txt", text(33, "sz")),
            ]),
        );
        let upper_only = lab.archive(
            "upper-only.rpf",
            &flat(&[("ÄÖÜ.xml", text(20, "u")), ("ABC.XML", text(26, "abc"))]),
        );
        let ask = |arch: &str, entry: &str, out: &str| {
            lab.one(&json!({"baseArchive": arch, "entry": entry, "extractOutput": lab.text(out)}))
        };
        let first = ask(&names, "Ärger.xml", "o/n1.xml").unwrap();
        assert_eq!(
            (
                first["entry"].as_str().unwrap(),
                first["bytes"].as_u64().unwrap()
            ),
            ("ärger.xml", 31)
        );
        let upper = ask(&upper_only, "ÄÖÜ.xml", "o/n2.xml").unwrap();
        assert_eq!(
            (
                upper["entry"].as_str().unwrap(),
                upper["bytes"].as_u64().unwrap()
            ),
            ("äöü.xml", 20)
        );
        assert_eq!(
            ask(&upper_only, "abc.xml", "o/n3.xml").unwrap()["bytes"],
            26
        );
        assert_eq!(
            ask(&names, "STRASSE.TXT", "o/n4.xml").unwrap()["entry"],
            "strasse.txt"
        );
        assert_eq!(ask(&names, "straße.txt", "o/n5.xml").unwrap()["bytes"], 33);
    }

    #[test]
    fn names_with_capital_letters_outside_ascii_are_found_in_any_case() {
        let lab = Lab::new();
        let mut folder = DirNode::new("Ärger");
        folder.files.push(memory_file("ÖL.ydr", text(40, "oel")));
        let mut root = flat(&[("ÄÖÜ.xml", text(20, "u"))]);
        root.dirs.push(folder);
        root.files
            .push(pack("ÖPACK.rpf", flat(&[("Ünï.txt", text(12, "in"))])));
        let arch = lab.archive("capitals.rpf", &root);
        let ask = |entry: &str, tag: &str| {
            lab.one(&json!({"baseArchive": arch, "entry": entry,
                "extractOutput": lab.text(&format!("o/{tag}.bin"))}))
        };
        for (n, entry) in [
            "Ärger/ÖL.ydr",
            "ärger/öl.ydr",
            "ÄRGER/ÖL.YDR",
            "ärGER\\Öl.YDr",
        ]
        .iter()
        .enumerate()
        {
            let answer = ask(entry, &format!("a{n}")).unwrap();
            assert_eq!(answer["entry"], "ärger/öl.ydr", "{entry}");
            assert_eq!(answer["bytes"], 40, "{entry}");
        }
        for (n, entry) in ["ÄÖÜ.xml", "äöü.XML"].iter().enumerate() {
            let answer = ask(entry, &format!("b{n}")).unwrap();
            assert_eq!(
                (answer["entry"].as_str(), answer["bytes"].as_u64()),
                (Some("äöü.xml"), Some(20))
            );
        }
        // контейнер с такой буквой в имени раскрывается, запись в нём находится
        for (n, entry) in ["ÖPACK.rpf/Ünï.txt", "öpack.RPF/ÜNÏ.TXT"]
            .iter()
            .enumerate()
        {
            let answer = ask(entry, &format!("c{n}")).unwrap();
            assert_eq!(answer["bytes"], 12, "{entry}");
        }
        // та же выемка в пачке
        let batch = lab
            .many(
                &json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m_caps"),
                "extractEntries": ["Ärger/ÖL.ydr", "ÄÖÜ.xml", "ÖPACK.rpf/Ünï.txt"]}),
            )
            .unwrap();
        let sizes: Vec<u64> = batch["extracted"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["bytes"].as_u64().unwrap())
            .collect();
        assert_eq!(sizes, [40, 20, 12]);
        // чего нет, того нет
        let none = failure(ask("Ärger/ÖL.xml", "d0"));
        assert_eq!(
            none,
            refusal("FileNotFoundException", "RPF entry not found: ärger/öl.xml")
        );
        let nodir = failure(ask("Öрger/ÖL.ydr", "d1"));
        assert_eq!(nodir.0, "DirectoryNotFoundException");
    }

    #[test]
    fn first_of_equal_names_wins_and_directories_are_not_entries() {
        let lab = Lab::new();
        let dups = lab.archive(
            "dups.rpf",
            &flat(&[
                ("DUP.XML", text(42, "a")),
                ("Dup.xml", text(40, "b")),
                ("dup.xml", text(41, "c")),
            ]),
        );
        let got = lab
            .one(&json!({"baseArchive": dups, "entry": "dup.xml", "extractOutput": lab.text("o/d.xml")}))
            .unwrap();
        assert_eq!(got["bytes"], 42);

        let mut mods = DirNode::new("Mods");
        mods.files
            .push(pack("Pack.RPF", flat(&[("Inside.TXT", text(55, "i"))])));
        let mut root = DirNode::new("");
        root.dirs.push(mods);
        let arch = lab.archive("containers.rpf", &root);
        let inside = lab
            .one(&json!({"baseArchive": arch, "entry": "Mods/Pack.RPF/Inside.TXT", "extractOutput": lab.text("o/c1.txt")}))
            .unwrap();
        assert_eq!(inside["entry"], "mods/pack.rpf/inside.txt");
        assert_eq!(inside["bytes"], 55);
        assert_eq!(
            failure(lab.one(&json!({"baseArchive": arch, "entry": "mods", "extractOutput": lab.text("o/c2.txt")}))),
            refusal("FileNotFoundException", "RPF entry not found: mods")
        );
    }

    #[test]
    fn nesting_has_no_depth_limit_and_bad_containers_are_refused() {
        let lab = Lab::new();
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
                    .push(pack(&format!("l{}.rpf", level + 1), inner));
            }
            inner = layer;
        }
        let mut root = DirNode::new("");
        root.files.push(pack("l1.rpf", inner));
        let deep = lab.archive("deep.rpf", &root);
        let path = "l1.rpf/l2.rpf/l3.rpf/l4.rpf/l5.rpf/l6.rpf/l7.rpf/l8.rpf/f8.xml";
        let got = lab
            .one(
                &json!({"baseArchive": deep, "entry": path, "extractOutput": lab.text("o/f8.xml")}),
            )
            .unwrap();
        assert_eq!(got["bytes"], 80);

        let mut x64 = DirNode::new("x64");
        x64.files.push(memory_file("bad.rpf", noise(3000, 4)));
        x64.files.push(memory_file("SHORT.RPF", noise(10, 5)));
        x64.files.push(FileNode {
            name: "res.rpf".into(),
            body: Body::Resource {
                data: Data::memory(resource(1, 2, &noise(300, 6))),
            },
        });
        let mut tree = DirNode::new("");
        tree.dirs.push(x64);
        let bad = lab.archive("badnested.rpf", &tree);
        let ask = |entry: &str| {
            failure(lab.one(
                &json!({"baseArchive": bad, "entry": entry, "extractOutput": lab.text("o/q.xml")}),
            ))
        };
        let (code, message) = ask("x64/bad.rpf/x.xml");
        assert_eq!(code, "InvalidDataException");
        assert!(message.starts_with("bad.rpf: The identifier "));
        assert_eq!(
            ask("x64/short.rpf/x.xml"),
            refusal(
                "InvalidDataException",
                "SHORT.RPF: the file is too short to be an RPF7 archive"
            )
        );
        assert_eq!(
            ask("x64/res.rpf/x.xml"),
            refusal("ArgumentException", "res.rpf is not a binary file.")
        );
        let res = lab
            .one(&json!({"baseArchive": bad, "entry": "x64/res.rpf", "extractOutput": lab.text("o/res.bin")}))
            .unwrap();
        assert_eq!(res["bytes"], 316);
    }

    // снятие запрета записи нужно только затем, чтобы убрать временную папку
    #[allow(clippy::permissions_set_readonly_false)]
    #[test]
    fn output_trouble_is_reported_and_leaves_no_scratch_files() {
        let lab = Lab::new();
        let arch = lab.update();
        let ask = |out: String| {
            lab.one(
                &json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": out}),
            )
        };
        let folder = lab.at("dirout");
        fs::create_dir_all(&folder).unwrap();
        let (code, message) = failure(ask(folder.display().to_string()));
        assert_eq!(code, "UnauthorizedAccessException");
        assert!(message.ends_with("(os error 5)"));
        assert_eq!(
            tree_listing(&lab.at(""))
                .iter()
                .filter(|n| n.contains(".extract-"))
                .count(),
            0
        );

        let target = lab.at("o/a.xml");
        assert!(ask(target.display().to_string()).is_ok());
        let below = lab.text("o/a.xml/inside.txt");
        let (code, message) = failure(ask(below));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 183)"));

        let readonly = lab.at("ro.xml");
        fs::write(&readonly, b"kept bytes!").unwrap();
        let mut permissions = fs::metadata(&readonly).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&readonly, permissions.clone()).unwrap();
        let (code, _) = failure(ask(readonly.display().to_string()));
        permissions.set_readonly(false);
        fs::set_permissions(&readonly, permissions).unwrap();
        assert_eq!(code, "UnauthorizedAccessException");
        assert_eq!(fs::read(&readonly).unwrap(), b"kept bytes!");
        let scratch: Vec<String> = tree_listing(&lab.at(""))
            .into_iter()
            .filter(|name| name.contains(".extract-"))
            .collect();
        assert!(scratch.is_empty(), "{scratch:?}");

        let zero = lab.archive("zero.rpf", &flat(&[("empty.bin", vec![])]));
        let empty = lab
            .one(&json!({"baseArchive": zero, "entry": "empty.bin", "extractOutput": lab.text("o/zero.bin")}))
            .unwrap();
        assert_eq!(
            (empty["bytes"].as_u64(), empty["sha256"].as_str()),
            (
                Some(0),
                Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
            )
        );
        let unicode = lab
            .one(&json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": lab.text("вывод/файл ★ 😀.xml")}))
            .unwrap();
        assert_eq!(unicode["bytes"], 4000);
        assert!(lab.at("вывод").join("файл ★ 😀.xml").is_file());
    }

    #[test]
    fn a_damaged_entry_stops_the_single_extraction() {
        let lab = Lab::new();
        let mut tree = DirNode::new("");
        tree.files.push(FileNode {
            name: "bad.xml".into(),
            body: Body::Binary {
                data: Data::memory(text(4000, "bad")),
                compress: Compress::Always,
            },
        });
        let arch = lab.archive("corrupt.rpf", &tree);
        let offset = {
            let opened = Archive::open_path(Path::new(&arch), None).unwrap();
            let id = opened.find_file(opened.root(), "bad.xml").unwrap();
            match &opened.entry(id).kind {
                EntryKind::Binary(info) => info.offset() as usize,
                _ => unreachable!(),
            }
        };
        let mut raw = fs::read(&arch).unwrap();
        raw[offset..offset + 6].fill(0xFF);
        fs::write(&arch, raw).unwrap();
        let result = lab.one(
            &json!({"baseArchive": arch, "entry": "bad.xml", "extractOutput": lab.text("o/c.xml")}),
        );
        assert_eq!(failure(result).0, "InvalidDataException");
        assert!(!lab.at("o/c.xml").exists());
    }

    // ----- ключи -----

    #[test]
    fn key_failures_come_after_the_archive_file_checks() {
        let lab = Lab::new();
        let arch = lab.update();
        let body = json!({"baseArchive": arch, "entry": "common/data/a.xml", "extractOutput": lab.text("o/k.xml")});
        let (path, bare) = lab.raw_request(body.to_string().as_bytes(), false);
        if std::env::var_os(crate::archives::KEYS_ENV).is_none() {
            assert_eq!(
                failure(extract_rpf(&bare, &Progress::silent())),
                refusal(
                    "FileNotFoundException",
                    "GTA V executable was not found for in-memory key discovery."
                )
            );
        }
        let broken = Options::parse(&[
            "--request".to_owned(),
            path.display().to_string(),
            "--keys".to_owned(),
            lab.text("nokeys"),
            "--game-root".to_owned(),
            lab.text("nothing"),
        ])
        .unwrap();
        let (code, message) = failure(extract_rpf(&broken, &Progress::silent()));
        assert_eq!(code, "InvalidOperationException");
        assert!(message.contains("gtav_aes_key.dat could not be read from"));
        assert!(!lab.at("o").exists());

        // файл архива проверяется раньше ключей
        let gone = json!({"baseArchive": lab.text("arch/nothere.rpf"), "entry": "a", "extractOutput": lab.text("o/k.xml")});
        let (gone_path, _) = lab.raw_request(gone.to_string().as_bytes(), false);
        let options = Options::parse(&[
            "--request".to_owned(),
            gone_path.display().to_string(),
            "--keys".to_owned(),
            lab.text("nokeys"),
        ])
        .unwrap();
        assert_eq!(
            failure(extract_rpf(&options, &Progress::silent())).0,
            "FileNotFoundException"
        );
    }

    // ----- extract-many-rpf -----

    #[test]
    fn batch_walks_each_folder_and_nested_archive_once() {
        let lab = Lab::new();
        let arch = lab.update();
        let keys_dir = lab.text("keys");
        let (keys, _) = load_keys("", Some(keys_dir.as_str())).unwrap();
        let archive: Arc<Archive> = Archive::open_path(Path::new(&arch), Some(keys))
            .unwrap()
            .into();
        let wanted = [
            "x64/data/cdimages/scaleform_generic.rpf/hud.gfx",
            "x64/data/cdimages/scaleform_generic.rpf/mini.gfx",
            "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml",
            "x64/data/cdimages/scaleform_other.rpf/keep.xml",
            "common/data/a.xml",
        ];
        let mut routes = Routes::default();
        for entry in wanted {
            let links = normalize_entry(entry, true).unwrap();
            let along = fetch_along(&mut routes, &archive, &links).unwrap();
            assert_eq!(along, fetch(&archive, &links).unwrap(), "{entry}");
        }
        // Восемь звеньев на пять записей: x64, data, cdimages, scaleform_generic.rpf, inner,
        // scaleform_other.rpf, common, data. Без памяти мест их 4 + 4 + 5 + 4 + 2 = 19, и контейнер
        // scaleform_generic.rpf раскрывался бы трижды.
        assert_eq!(routes.walked, 8);

        // Отказ по дороге ничего не запоминает: следующая запись того же пути отказывает так же.
        let missing = normalize_entry("x64/data/nothere.rpf/a.xml", true).unwrap();
        for _ in 0..2 {
            let refusal = fetch_along(&mut routes, &archive, &missing).unwrap_err();
            assert_eq!(refusal.message, "RPF directory not found: nothere.rpf");
        }
        assert_eq!(routes.walked, 8);
    }

    #[test]
    fn batch_keeps_paths_in_subfolders_in_request_order() {
        let lab = Lab::new();
        let arch = lab.update();
        let m1 = lab.text("m1");
        let answer = lab
            .many(&json!({"baseArchive": arch, "extractOutputDirectory": m1,
                "extractEntries": ["common/data/a.xml", "setup2.xml", "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml"]}))
            .unwrap();
        let keys: Vec<&str> = answer
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["status", "mode", "extracted", "keyMode"]);
        assert_eq!(answer["keyMode"], "external-verified-local");
        let list = answer["extracted"].as_array().unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0]["entry"], "common/data/a.xml");
        assert_eq!(
            list[0]["output"],
            Value::from(
                lab.at("m1")
                    .join("common")
                    .join("data")
                    .join("a.xml")
                    .display()
                    .to_string()
            )
        );
        assert_eq!(list[0]["sha256"], A_XML_SHA);
        assert_eq!(list[2]["bytes"], 700);
        assert_eq!(
            tree_listing(&lab.at("m1")),
            [
                "common",
                "common/data",
                "common/data/a.xml",
                "setup2.xml",
                "x64",
                "x64/data",
                "x64/data/cdimages",
                "x64/data/cdimages/scaleform_generic.rpf",
                "x64/data/cdimages/scaleform_generic.rpf/inner",
                "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml",
            ]
        );
        let spaced = lab
            .many(
                &json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m18"),
                "extractEntries": ["  setup2.xml  ", "Common\\Data\\Old.XML"]}),
            )
            .unwrap();
        assert_eq!(spaced["extracted"][1]["entry"], "common/data/old.xml");
        // нестрока в списке отказывает, а не пропускается молча
        let mixed = failure(lab.many(
            &json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m4"),
            "extractEntries": ["common/data/a.xml", 5, "setup2.xml"]}),
        ));
        assert_eq!(
            mixed,
            refusal("InvalidDataException", "Invalid RPF entry path.")
        );
        assert!(!lab.at("m4").exists());
        let container = lab
            .many(&json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m8b"),
                "extractEntries": ["common/data/a.xml", "x64/data/cdimages/scaleform_generic.rpf"]}))
            .unwrap();
        assert_eq!(
            container["extracted"][1]["bytes"],
            fs::metadata(lab.at("m8b/x64/data/cdimages/scaleform_generic.rpf"))
                .unwrap()
                .len()
        );
    }

    #[test]
    fn batch_validates_the_list_before_touching_the_disk() {
        let lab = Lab::new();
        let arch = lab.update();
        let ask = |dir: &str, entries: Value| {
            failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": lab.text(dir), "extractEntries": entries})))
        };
        let count = refusal(
            "InvalidDataException",
            "Invalid RPF extraction entry count.",
        );
        assert_eq!(ask("m3", json!([])), count);
        let path = refusal("InvalidDataException", "Invalid RPF entry path.");
        // нестрока отказывает раньше проверки числа; не-массив читается как пустой список
        assert_eq!(ask("m3", json!([1, 2, null])), path);
        assert_eq!(ask("m3", json!([null])), path);
        assert_eq!(ask("m3", json!(["../evil", ["x"]])), path);
        assert_eq!(ask("m5", json!("common/data/a.xml")), count);
        assert_eq!(ask("m5", json!({"0": "common/data/a.xml"})), count);
        assert_eq!(
            ask("m6", json!(["common/data/a.xml", "COMMON\\DATA\\A.XML"])),
            refusal("InvalidDataException", "Duplicate RPF extraction entry.")
        );
        assert_eq!(
            ask("m7", json!(["common/data/a.xml", "../evil"])),
            refusal("InvalidDataException", "Unsafe RPF entry path.")
        );
        assert_eq!(
            ask("m8", json!(["common/data/a.xml", "a.rpf/"])),
            refusal("InvalidDataException", "Unsafe RPF entry path.")
        );
        for dir in ["m3", "m5", "m6", "m7", "m8"] {
            assert!(!lab.at(dir).exists(), "{dir}");
        }
        assert_eq!(
            failure(lab.many(&json!({"baseArchive": arch, "extractEntries": ["setup2.xml"]}))),
            refusal("ArgumentException", "The path is empty.")
        );
        assert_eq!(
            failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": "Z:rel", "extractEntries": ["setup2.xml"]}))),
            refusal("ArgumentException", "Helper paths must be absolute.")
        );
        let too_many: Vec<String> = (0..=BATCH_CAP).map(|n| format!("a/f{n}.xml")).collect();
        assert_eq!(ask("m_big", json!(too_many)), count);
        let exact: Vec<String> = (0..BATCH_CAP).map(|n| format!("a/f{n}.xml")).collect();
        assert_eq!(
            ask("m_exact", json!(exact)),
            refusal("DirectoryNotFoundException", "RPF directory not found: a")
        );
    }

    #[test]
    fn batch_folder_is_removed_after_later_refusals() {
        let lab = Lab::new();
        let arch = lab.update();
        let no_base = failure(lab.many(
            &json!({"extractOutputDirectory": lab.text("m9"), "extractEntries": ["setup2.xml"]}),
        ));
        assert_eq!(
            no_base,
            refusal("ArgumentException", "RPF base archive is required.")
        );
        assert!(!lab.at("m9").exists());
        let gone = lab.text("arch/nothere.rpf");
        let no_file = failure(lab.many(&json!({"baseArchive": gone, "extractOutputDirectory": lab.text("m10"), "extractEntries": ["setup2.xml"]})));
        assert_eq!(no_file.0, "FileNotFoundException");
        assert!(!lab.at("m10").exists());
        // папка, которая была до запуска, остаётся
        fs::create_dir_all(lab.at("m10b")).unwrap();
        let again = failure(lab.many(&json!({"baseArchive": gone, "extractOutputDirectory": lab.text("m10b"), "extractEntries": ["setup2.xml"]})));
        assert_eq!(again.0, "FileNotFoundException");
        assert!(lab.at("m10b").is_dir());

        fs::write(lab.at("afile3"), b"x").unwrap();
        let (code, message) = failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": lab.text("afile3"), "extractEntries": ["setup2.xml"]})));
        assert_eq!(code, "IOException");
        assert!(message.ends_with("(os error 183)"));
        assert_eq!(fs::read(lab.at("afile3")).unwrap(), b"x");
    }

    #[test]
    fn batch_never_overwrites_and_takes_back_earlier_results() {
        let lab = Lab::new();
        let arch = lab.update();
        let m1 = lab.text("m1");
        lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": m1, "extractEntries": ["common/data/a.xml"]}))
            .unwrap();
        let exists = failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": m1, "extractEntries": ["common/data/a.xml"]})));
        assert_eq!(
            exists,
            refusal(
                "IOException",
                format!(
                    "Output already exists: {}",
                    lab.at("m1")
                        .join("common")
                        .join("data")
                        .join("a.xml")
                        .display()
                )
                .as_str()
            )
        );
        let second = failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": m1, "extractEntries": ["common/data/b.dat", "common/data/a.xml"]})));
        assert_eq!(second.0, "IOException");
        assert!(!lab.at("m1/common/data/b.dat").exists());
        assert!(lab.at("m1/common/data/a.xml").is_file());

        let missing = failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m2"),
            "extractEntries": ["common/data/old.xml", "common/data/c.txt", "common/data/nothere.xml"]})));
        assert_eq!(
            missing,
            refusal(
                "FileNotFoundException",
                "RPF entry not found: common/data/nothere.xml"
            )
        );
        assert!(!lab.at("m2").exists());

        // контейнер и запись внутри него в одной пачке
        let both = failure(lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m11"),
            "extractEntries": ["setup2.xml", "x64/data/cdimages/scaleform_generic.rpf/tex.ytd", "x64/data/cdimages/scaleform_generic.rpf"]})));
        assert_eq!(both.0, "IOException");
        assert!(both.1.starts_with("Output already exists: "));
        assert!(!lab.at("m11").exists());
        let mut mods = DirNode::new("mods");
        mods.files
            .push(pack("pack.rpf", flat(&[("inside.txt", text(10, "i"))])));
        let mut root = DirNode::new("");
        root.dirs.push(mods);
        let containers = lab.archive("containers.rpf", &root);
        let clash = failure(lab.many(
            &json!({"baseArchive": containers, "extractOutputDirectory": lab.text("m12"),
            "extractEntries": ["mods/pack.rpf", "mods/pack.rpf/inside.txt"]}),
        ));
        assert_eq!(clash.0, "IOException");
        assert!(clash.1.ends_with("(os error 183)"));
        assert!(!lab.at("m12").exists());
    }

    #[test]
    fn batch_names_follow_the_lowered_spelling() {
        let lab = Lab::new();
        let arch = lab.archive(
            "names.rpf",
            &flat(&[
                ("ärger.xml", text(30, "a")),
                ("ǆ.txt", text(30, "d")),
                ("файл.dat", text(30, "f")),
            ]),
        );
        let answer = lab
            .many(
                &json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m14"),
                "extractEntries": ["ärger.xml", "ǆ.txt", "файл.dat"]}),
            )
            .unwrap();
        assert_eq!(answer["extracted"].as_array().unwrap().len(), 3);
        assert_eq!(
            tree_listing(&lab.at("m14")),
            ["ärger.xml", "ǆ.txt", "файл.dat"]
        );
        let mut sub = DirNode::new("Подпапка");
        sub.files.push(memory_file("внутри.xml", text(30, "x")));
        let mut root = DirNode::new("");
        root.dirs.push(sub);
        let nested = lab.archive("sub.rpf", &root);
        let found = lab
            .many(
                &json!({"baseArchive": nested, "extractOutputDirectory": lab.text("m13"),
                "extractEntries": ["Подпапка/внутри.xml"]}),
            )
            .unwrap();
        assert_eq!(found["extracted"][0]["entry"], "подпапка/внутри.xml");
        assert_eq!(
            tree_listing(&lab.at("m13")),
            ["подпапка", "подпапка/внутри.xml"]
        );
        assert_eq!(
            failure(lab.many(
                &json!({"baseArchive": nested, "extractOutputDirectory": lab.text("m13b"),
                "extractEntries": ["Другая/внутри.xml"]})
            )),
            refusal(
                "DirectoryNotFoundException",
                "RPF directory not found: другая"
            )
        );
        assert!(!lab.at("m13b").exists());
    }

    #[test]
    fn batch_stops_at_a_damaged_entry_and_takes_back_the_earlier_file() {
        let lab = Lab::new();
        let mut tree = DirNode::new("");
        tree.files.push(memory_file("a_plain.txt", text(100, "p")));
        tree.files.push(FileNode {
            name: "bad.xml".into(),
            body: Body::Binary {
                data: Data::memory(text(4000, "bad")),
                compress: Compress::Always,
            },
        });
        let arch = lab.archive("corrupt.rpf", &tree);
        let offset = {
            let opened = Archive::open_path(Path::new(&arch), None).unwrap();
            let id = opened.find_file(opened.root(), "bad.xml").unwrap();
            match &opened.entry(id).kind {
                EntryKind::Binary(info) => info.offset() as usize,
                _ => unreachable!(),
            }
        };
        let mut raw = fs::read(&arch).unwrap();
        raw[offset..offset + 6].fill(0xFF);
        fs::write(&arch, raw).unwrap();
        let result = lab.many(
            &json!({"baseArchive": arch, "extractOutputDirectory": lab.text("m15"),
            "extractEntries": ["a_plain.txt", "bad.xml", "zz.xml"]}),
        );
        assert_eq!(failure(result).0, "InvalidDataException");
        assert!(!lab.at("m15").exists());
    }

    // ----- откат пачки -----

    #[test]
    fn a_refusal_in_the_middle_of_a_batch_removes_the_folder_the_run_made() {
        let lab = Lab::new();
        let arch = lab.update();
        let fresh = lab.at("fresh/deep/out");
        let refused = failure(lab.many(&json!({"baseArchive": arch,
            "extractOutputDirectory": fresh.display().to_string(),
            "extractEntries": ["common/data/old.xml", "common/data/c.txt", "common/data/nothere.xml"]})));
        assert_eq!(
            refused,
            refusal(
                "FileNotFoundException",
                "RPF entry not found: common/data/nothere.xml"
            )
        );
        // ни файлов запуска, ни созданной им цепочки папок
        assert!(!lab.at("fresh").exists());
        assert!(lab.at("").is_dir());

        // отказ при открытии архива тоже не оставляет созданную папку
        let gone = lab.text("arch/nothere.rpf");
        let no_file = failure(
            lab.many(&json!({"baseArchive": gone,
            "extractOutputDirectory": lab.text("fresh/second"), "extractEntries": ["setup2.xml"]})),
        );
        assert_eq!(no_file.0, "FileNotFoundException");
        assert!(!lab.at("fresh").exists());

        // после отката тот же запрос с верным списком проходит в ту же папку
        let again = lab
            .many(
                &json!({"baseArchive": arch, "extractOutputDirectory": fresh.display().to_string(),
                "extractEntries": ["common/data/old.xml", "common/data/c.txt"]}),
            )
            .unwrap();
        assert_eq!(again["extracted"].as_array().unwrap().len(), 2);
        assert_eq!(
            tree_listing(&lab.at("fresh")),
            [
                "deep",
                "deep/out",
                "deep/out/common",
                "deep/out/common/data",
                "deep/out/common/data/c.txt",
                "deep/out/common/data/old.xml"
            ]
        );
    }

    #[test]
    fn a_rollback_keeps_earlier_folders_and_foreign_files() {
        let lab = Lab::new();
        let arch = lab.update();
        let keep = lab.at("keep");
        fs::create_dir_all(keep.join("common")).unwrap();
        fs::write(keep.join("foreign.txt"), b"mine").unwrap();
        fs::write(keep.join("common").join("other.txt"), b"mine too").unwrap();
        // прежний файл с тем же именем, что у записи запуска
        fs::create_dir_all(keep.join("x64")).unwrap();
        fs::write(keep.join("x64").join("old.bin"), b"previous run").unwrap();

        let refused = failure(lab.many(&json!({"baseArchive": arch,
            "extractOutputDirectory": keep.display().to_string(),
            "extractEntries": ["setup2.xml", "common/data/old.xml", "common/data/nothere.xml"]})));
        assert_eq!(refused.0, "FileNotFoundException");
        assert_eq!(
            tree_listing(&keep),
            [
                "common",
                "common/other.txt",
                "foreign.txt",
                "x64",
                "x64/old.bin"
            ]
        );
        assert_eq!(fs::read(keep.join("foreign.txt")).unwrap(), b"mine");
        assert_eq!(
            fs::read(keep.join("x64").join("old.bin")).unwrap(),
            b"previous run"
        );

        // отказ «уже существует» убирает файлы этого запуска, но не прежний файл
        let m1 = lab.text("m1");
        lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": m1, "extractEntries": ["common/data/a.xml"]}))
            .unwrap();
        let exists = failure(
            lab.many(&json!({"baseArchive": arch, "extractOutputDirectory": m1,
            "extractEntries": ["common/data/b.dat", "setup2.xml", "common/data/a.xml"]})),
        );
        assert_eq!(exists.0, "IOException");
        assert!(exists.1.starts_with("Output already exists: "));
        assert_eq!(
            tree_listing(&lab.at("m1")),
            ["common", "common/data", "common/data/a.xml"]
        );
        assert_eq!(
            sha256_hex(&fs::read(lab.at("m1/common/data/a.xml")).unwrap()),
            A_XML_SHA
        );
    }

    #[test]
    fn a_rollback_leaves_a_folder_that_holds_a_foreign_file() {
        let lab = Lab::new();
        let mut made = Made::default();
        made.dirs_all(&lab.at("fresh/inner")).unwrap();
        fs::write(lab.at("fresh/inner/foreign.txt"), b"x").unwrap();
        let own = lab.at("fresh/inner/own.txt");
        fs::write(&own, b"y").unwrap();
        made.files.push(own.clone());
        made.undo();
        assert!(!own.exists());
        assert_eq!(
            tree_listing(&lab.at("fresh")),
            ["inner", "inner/foreign.txt"]
        );
    }
}
