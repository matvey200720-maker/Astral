//! `lamp-archive-scan`: опись архива игры для мастерской фонарей.
//!
//! Команда обходит архив RPF (и вложенные до заданной глубины), считает записи,
//! строит отпечаток списка путей и для каждой карты `.ymap` находит сущности
//! запрошенных архетипов. Всё, что не разбирается точно, не пропускается, а
//! отдаётся хосту отказом «пока на хосте». На диск ничего не пишется.
//!
//! Шесть элементов с `pub(super)` нужны соседу `lamp_lod_nearest`: разбор пути
//! архива и глубины, склейка путей, порядок «без учёта регистра» и печать чисел.

use {
    rage_res::{hash, lamp_light, meta_graph, mlo, resource},
    rage_rpf::{Archive, EntryCipher, EntryId, EntryKind},
    serde_json::Value,
    std::{
        path::{Path, PathBuf},
        rc::Rc,
        vec::IntoIter,
    },
};

use super::{lamp_mutations::refuse, mapfiles::orientation};
use crate::{archives, args::Options, error::Result, paths, progress::Progress};

pub const COMMANDS: &[super::Command] = &[super::Command::new(MODE, lamp_archive_scan)];

const MODE: &str = "lamp-archive-scan";

/// Смещение указателя к описанию структур в образе метаданных `.ymap`.
pub(super) const META_SCHEMA_POINTER: usize = 0x20;

/// Пределы запроса: число имён, длина имени, самая большая глубина и глубина по умолчанию.
struct Limits {
    names: usize,
    name_len: usize,
    deepest: i64,
    depth: usize,
}

const LIMITS: Limits = Limits {
    names: 64,
    name_len: 128,
    deepest: 24,
    depth: 12,
};

/// Ключи чисел в записи описи, в порядке ответа.
const POSITION_KEYS: [&str; 3] = ["positionX", "positionY", "positionZ"];
const ROTATION_KEYS: [&str; 4] = ["rotationX", "rotationY", "rotationZ", "rotationW"];
const SCALE_KEYS: [&str; 3] = ["scaleX", "scaleY", "scaleZ"];

pub fn lamp_archive_scan(options: &Options, _progress: &Progress) -> Result<Value> {
    let brief = Brief::read(options)?;
    let (archive, key_mode) = open_archive(options, &brief.archive)?;
    let mut survey = Survey::new(&brief.wanted);
    let opened = survey.scan(archive, brief.depth)?;
    // Целиком файл читается уже после обхода.
    let digest = archives::sha256_file(&brief.archive)?;
    Ok(survey.report(&brief.request, digest, key_mode, opened))
}

/// Всё, что проверяется в запросе до обращения к игре.
struct Brief {
    request: Value,
    archive: PathBuf,
    wanted: Wanted,
    depth: usize,
}

impl Brief {
    fn read(options: &Options) -> Result<Self> {
        let request = read_request(options)?;
        Ok(Self {
            archive: archive_file(&request)?,
            wanted: Wanted::from_request(&request)?,
            depth: max_depth(&request)?,
            request,
        })
    }
}

/// Папка игры, набор ключей, затем сам архив: каждый шаг отказывает своим словом.
fn open_archive(options: &Options, path: &Path) -> Result<(Archive, &'static str)> {
    let root = archives::game_root(options)?;
    let (keys, mode) = archives::load_keys(&root.to_string_lossy(), options.optional("keys"))?;
    Ok((Archive::open_path(path, Some(keys))?, mode))
}

/// Путь к архиву из запроса: абсолютный `.rpf`, который существует.
pub(super) fn archive_file(request: &Value) -> Result<PathBuf> {
    let raw = match request["baseArchive"].as_str() {
        Some(text) if Path::new(text).is_absolute() && ends_with_ignore_case(text, ".rpf") => text,
        _ => return Err(refuse("Архив — только абсолютный .rpf")),
    };
    match paths::existing_file(raw, &[".rpf"]) {
        Ok(path) => Ok(path),
        Err(_) => Err(refuse("Архив не найден")),
    }
}

/// Глубина вложенных архивов: по умолчанию 12, значение срезается в 0…24.
pub(super) fn max_depth(request: &Value) -> Result<usize> {
    match &request["maxNestedDepth"] {
        Value::Null => Ok(LIMITS.depth),
        given => match given.as_i64() {
            Some(depth) => Ok(depth.clamp(0, LIMITS.deepest) as usize),
            None => Err(refuse("Глубина вложенности не число")),
        },
    }
}

/// Число `f32` для ответа: текст .NET-вида разбирается как число JSON.
pub(super) fn number(value: f32) -> Value {
    lamp_light::float_json(value).parse().unwrap_or_default()
}

pub(super) fn join_path(prefix: &str, name: &str) -> String {
    match prefix {
        "" => name.to_owned(),
        _ => [prefix, name].join("/"),
    }
}

/// Порядок побайтно, ASCII-буквы сравниваются как прописные; остальное сырыми байтами UTF-8.
pub(super) fn ordinal_ignore_case(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_ascii_uppercase().cmp(&right.to_ascii_uppercase())
}

// ---------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------

fn read_request(options: &Options) -> Result<Value> {
    let input = options.required("input")?;
    let path = paths::existing_file(input, &[".json"])?;
    let parsed: Option<Value> = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).ok(),
        Err(_) => None,
    };
    match parsed {
        None => Err(refuse("Запрос описи архива не читается")),
        Some(request) if request["mode"] == MODE => Ok(request),
        Some(_) => Err(refuse("Запрос описи архива другого режима")),
    }
}

/// Значение ключа запроса, которое уходит в ответ как есть.
fn carried(request: &Value, key: &str) -> Value {
    request[key].clone()
}

/// Объект ответа из пар «ключ, значение» в заданном порядке.
fn record<'k>(pairs: impl IntoIterator<Item = (&'k str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Запрошенные архетипы: имена по возрастанию байт с хешами и хеши с местом имени.
struct Wanted {
    sorted: Vec<(String, u32)>,
    by_hash: Vec<(u32, usize)>,
}

impl Wanted {
    fn from_request(request: &Value) -> Result<Self> {
        let Some(listed) = request["lampArchetypeNames"].as_array() else {
            return Err(refuse("Нет имён архетипов"));
        };
        let names: Vec<String> = listed.iter().map(tidy_name).collect();
        let mut ordered = names.clone();
        ordered.sort();
        ordered.dedup();
        let fine = ordered.len() == names.len()
            && (1..=LIMITS.names).contains(&names.len())
            && names.iter().all(|name| is_archetype_name(name));
        if !fine {
            return Err(refuse("Имена архетипов вне правил"));
        }

        let sorted: Vec<(String, u32)> = ordered
            .into_iter()
            .map(|name| {
                let code = hash::joaat(&name);
                (name, code)
            })
            .collect();
        let mut by_hash: Vec<(u32, usize)> = sorted
            .iter()
            .enumerate()
            .map(|(place, entry)| (entry.1, place))
            .collect();
        by_hash.sort_unstable();
        if by_hash.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            return Err(refuse("Два имени архетипа дают один хеш"));
        }
        Ok(Self { sorted, by_hash })
    }

    fn place(&self, code: u32) -> Option<usize> {
        let at = self
            .by_hash
            .binary_search_by_key(&code, |entry| entry.0)
            .ok()?;
        Some(self.by_hash[at].1)
    }

    fn name_of(&self, code: u32) -> Option<&str> {
        self.place(code).map(|place| self.sorted[place].0.as_str())
    }

    /// Хеш любого из имён встречается в байтах где угодно: в прямом или обратном порядке.
    fn appears_in(&self, bytes: &[u8]) -> bool {
        bytes.windows(4).any(|window| {
            let word = u32::from_le_bytes(window.try_into().expect("окно в четыре байта"));
            [word, word.swap_bytes()]
                .iter()
                .any(|probe| self.place(*probe).is_some())
        })
    }
}

/// Имя из запроса: не строка читается как пустое, края без пробельных знаков, буквы строчные.
fn tidy_name(item: &Value) -> String {
    item.as_str().unwrap_or("").trim().to_ascii_lowercase()
}

fn is_archetype_name(name: &str) -> bool {
    let plain =
        |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(byte);
    !name.is_empty() && name.len() <= LIMITS.name_len && name.as_bytes().iter().all(plain)
}

fn ends_with_ignore_case(text: &str, suffix: &str) -> bool {
    let (text, suffix) = (text.as_bytes(), suffix.as_bytes());
    text.len() >= suffix.len() && text[text.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

// ---------------------------------------------------------------------------
// Обход
// ---------------------------------------------------------------------------

/// Находка: запись описи и ключи сортировки.
struct Find {
    entry: String,
    index: usize,
    row: Value,
}

/// Файл архива в порядке обхода; `lost` — вложенный архив по этой записи не открылся и обход в него не идёт.
struct Visit {
    archive: Rc<Archive>,
    id: EntryId,
    path: String,
    lost: Option<&'static str>,
}

/// Причины пропуска в `parseErrors`: карта или вложенный архив не читаются, а опись идёт дальше.
const NESTED_LOST: &str = "Вложенный архив не открылся";
const MAP_UNPACKED: &str = "Запись .ymap не распакована";
const MAP_UNREADABLE: &str = "Карта .ymap не читается";
const MAP_NOT_FINITE: &str = "Поворот или масштаб сущности не конечны";

enum Task {
    File(EntryId),
    Dir(EntryId),
}

/// Каталог, который обходится сейчас: сначала его файлы, потом подкаталоги.
struct Level {
    archive: Rc<Archive>,
    prefix: String,
    depth: usize,
    pending: IntoIter<Task>,
}

impl Level {
    fn open(archive: Rc<Archive>, dir: EntryId, prefix: String, depth: usize) -> Self {
        let mut pending: Vec<Task> = archive.files(dir).iter().copied().map(Task::File).collect();
        pending.extend(archive.dirs(dir).iter().copied().map(Task::Dir));
        Self {
            archive,
            prefix,
            depth,
            pending: pending.into_iter(),
        }
    }
}

/// Ленивый обход: вложенный архив открывается, когда до его записи дошла очередь,
/// поэтому первым отказывает то, что раньше в порядке обхода.
struct Walker {
    deepest: usize,
    levels: Vec<Level>,
    archives: usize,
}

impl Walker {
    fn new(root: Archive, deepest: usize) -> Self {
        let root = Rc::new(root);
        let top = root.root();
        Self {
            deepest,
            levels: vec![Level::open(root, top, String::new(), 0)],
            archives: 1,
        }
    }

    /// Двоичная запись `.rpf` открывается как вложенный архив, пока глубина меньше предела.
    /// Не открывшийся архив пропускается (раньше он ронял всю опись): причина уходит в parseErrors.
    fn descend(
        &mut self,
        archive: &Archive,
        id: EntryId,
        path: &str,
        depth: usize,
    ) -> Option<&'static str> {
        let entry = archive.entry(id);
        let nested = match entry.kind {
            EntryKind::Binary(_) => {
                depth < self.deepest && Archive::is_nested_archive_name(&entry.name)
            }
            _ => false,
        };
        if !nested {
            return None;
        }
        match archive.open_nested(id) {
            Err(_) => Some(NESTED_LOST),
            Ok(inner) => {
                let top = inner.root();
                self.archives += 1;
                self.levels
                    .push(Level::open(Rc::new(inner), top, path.to_owned(), depth + 1));
                None
            }
        }
    }
}

impl Iterator for Walker {
    type Item = Visit;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let level = self.levels.last_mut()?;
            let (archive, prefix, depth) =
                (Rc::clone(&level.archive), level.prefix.clone(), level.depth);
            match level.pending.next() {
                None => {
                    self.levels.pop();
                }
                Some(Task::Dir(id)) => {
                    let inner = join_path(&prefix, &archive.entry(id).name);
                    self.levels.push(Level::open(archive, id, inner, depth));
                }
                Some(Task::File(id)) => {
                    let path = join_path(&prefix, &archive.entry(id).name);
                    let lost = self.descend(&archive, id, &path, depth);
                    return Some(Visit {
                        archive,
                        id,
                        path,
                        lost,
                    });
                }
            }
        }
    }
}

struct Survey<'w> {
    wanted: &'w Wanted,
    entries: usize,
    maps: usize,
    paths: Vec<String>,
    finds: Vec<Find>,
    /// Карты и вложенные архивы, которые не прочитались: имя и причина (как у хоста: `entry`, `error`), порядок обхода.
    skipped: Vec<Value>,
}

impl<'w> Survey<'w> {
    fn new(wanted: &'w Wanted) -> Self {
        Self {
            wanted,
            entries: 0,
            maps: 0,
            paths: Vec::new(),
            finds: Vec::new(),
            skipped: Vec::new(),
        }
    }

    /// Обходит архив до конца или до первого отказа; отдаёт число открытых архивов.
    fn scan(&mut self, root: Archive, deepest: usize) -> Result<usize> {
        let mut walker = Walker::new(root, deepest);
        walker.by_ref().try_for_each(|visit| self.take(&visit))?;
        Ok(walker.archives)
    }

    fn take(&mut self, visit: &Visit) -> Result<()> {
        let name = &visit.archive.entry(visit.id).name;
        self.entries += 1;
        self.paths.push(visit.path.clone());
        if let Some(reason) = visit.lost {
            self.skip(&visit.path, reason);
        }
        if !ends_with_ignore_case(name, ".ymap") {
            return Ok(());
        }
        self.maps += 1;
        self.read_map(&visit.archive, visit.id, &visit.path)
    }

    /// Запись о пропущенном: что и почему.
    fn skip(&mut self, path: &str, reason: &str) {
        self.skipped
            .push(record([("entry", path.into()), ("error", reason.into())]));
    }

    /// Нечитаемая карта пропускается и попадает в parseErrors (раньше одна такая карта роняла всю опись);
    /// карта PSO с нужным хешем остаётся отказом хосту: движок её не разбирает.
    fn read_map(&mut self, archive: &Archive, id: EntryId, path: &str) -> Result<()> {
        match self.map_finds(archive, id, path)? {
            Ok(finds) => self.finds.extend(finds),
            Err(reason) => self.skip(path, reason),
        }
        Ok(())
    }

    fn map_finds(
        &self,
        archive: &Archive,
        id: EntryId,
        path: &str,
    ) -> Result<std::result::Result<Vec<Find>, &'static str>> {
        let Ok(bytes) = archive.decode(id, EntryCipher::ByArchive) else {
            return Ok(Err(MAP_UNPACKED));
        };
        if let [b'P', b'S', b'I', b'N', ..] = bytes.as_slice() {
            // Карту PSO движок не разбирает: если нужный хеш внутри, опись у хоста.
            return match self.wanted.appears_in(&bytes) {
                true => Err(refuse("PSO-карта с нужным архетипом")),
                false => Ok(Ok(Vec::new())),
            };
        }
        let Ok(found) = map_entities(&bytes) else {
            return Ok(Err(MAP_UNREADABLE));
        };

        // Обычные сущности идут первыми, входы в помещения следом; номер считается в своей группе.
        let groups =
            [false, true].map(|portal| found.iter().filter(move |entity| entity.is_mlo == portal));
        let mut finds = Vec::new();
        for (index, entity) in groups.into_iter().flat_map(|group| group.enumerate()) {
            let Some(name) = self.wanted.name_of(entity.archetype_hash) else {
                continue;
            };
            let Ok(row) = occurrence(path, index, name, entity) else {
                return Ok(Err(MAP_NOT_FINITE));
            };
            finds.push(Find {
                entry: path.to_owned(),
                index,
                row,
            });
        }
        Ok(Ok(finds))
    }

    fn report(mut self, request: &Value, digest: String, key_mode: &str, opened: usize) -> Value {
        let complete = self.skipped.is_empty();
        // Как у хоста: при любом пропуске статус «incomplete», а не «ready».
        let status = if complete { "ready" } else { "incomplete" };
        self.paths
            .sort_by_cached_key(|path| path.to_ascii_uppercase());
        self.finds
            .sort_by_cached_key(|find| (find.entry.to_ascii_uppercase(), find.index));
        let inventory = hash::sha256_hex(self.paths.join("\n").as_bytes());

        let archetypes: Vec<Value> = self
            .wanted
            .sorted
            .iter()
            .map(|(name, code)| {
                record([("name", name.as_str().into()), ("hash", hex8(*code).into())])
            })
            .collect();
        let occurrences: Vec<Value> = self.finds.into_iter().map(|find| find.row).collect();
        record([
            ("status", status.into()),
            ("mode", MODE.into()),
            ("edition", carried(request, "edition")),
            ("archive", carried(request, "archiveTarget")),
            ("archiveSha256", digest.into()),
            ("archiveCount", opened.into()),
            ("entryCount", self.entries.into()),
            ("ymapCount", self.maps.into()),
            ("inventorySha256", inventory.into()),
            ("archetypes", archetypes.into()),
            ("occurrences", occurrences.into()),
            (
                "parseErrors",
                Value::Array(std::mem::take(&mut self.skipped)),
            ),
            ("complete", complete.into()),
            ("keyMode", key_mode.into()),
        ])
    }
}

/// Сущности карты. Карта без таблицы структур (так выглядят карты окклюдеров) их не имеет.
fn map_entities(bytes: &[u8]) -> Result<Vec<mlo::CEntity>> {
    let unreadable = || refuse("Карта .ymap не читается");
    let res = resource::Resource::parse(bytes).map_err(|_| unreadable())?;
    let schema = res.u64(META_SCHEMA_POINTER).map_err(|_| unreadable())?;
    match res.at(schema) {
        None => Ok(Vec::new()),
        Some(_) => meta_graph::read(bytes)
            .and_then(|graph| mlo::read_ymap(&graph))
            .map(|ymap| ymap.entities)
            .map_err(|_| unreadable()),
    }
}

// ---------------------------------------------------------------------------
// Запись описи сущности
// ---------------------------------------------------------------------------

fn occurrence(path: &str, index: usize, name: &str, entity: &mlo::CEntity) -> Result<Value> {
    let finite = |values: &[f32]| values.iter().all(|value| value.is_finite());
    let sane = finite(&entity.position)
        && finite(&entity.rotation)
        && finite(&[entity.scale_xy, entity.scale_z]);
    if !sane {
        return Err(refuse("Поворот или масштаб сущности не конечны"));
    }

    // У входа в помещение поворот печатается как записан, у обычной сущности — обратный.
    let rotation = match entity.is_mlo {
        true => entity.rotation,
        false => orientation(entity.rotation),
    };
    // Нулевой и почти нулевой поворот даёт в обратном кватернионе NaN или бесконечность: раньше `number` на них паниковала
    // (InternalError «научная запись»), теперь тот же отказ, что и для не конечного поворота в файле.
    if !finite(&rotation) {
        return Err(refuse("Поворот или масштаб сущности не конечны"));
    }
    let scale = [entity.scale_xy, entity.scale_xy, entity.scale_z];
    let head = [
        ("ymapEntry", Value::from(path)),
        ("entityIndex", Value::from(index)),
        ("archetypeName", Value::from(name)),
        ("archetypeHash", Value::from(hex8(entity.archetype_hash))),
        (
            "entityGuid",
            Value::from(hex8(fingerprint(entity.archetype_hash, entity.position))),
        ),
    ];
    let numbers = POSITION_KEYS
        .iter()
        .chain(&ROTATION_KEYS)
        .chain(&SCALE_KEYS)
        .zip(entity.position.iter().chain(&rotation).chain(&scale))
        .map(|(key, value)| (*key, number(*value)));
    Ok(record(head.into_iter().chain(numbers)))
}

/// Отпечаток вместо идентификатора из файла: хеш архетипа и сотые доли координат.
fn fingerprint(code: u32, position: [f32; 3]) -> u32 {
    position
        .iter()
        .map(|axis| (axis * 100.0) as i64 as u32)
        .fold(code, |acc, part| acc ^ part)
}

fn hex8(value: u32) -> String {
    format!("0x{value:08X}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{args::Options, error::Result, progress::Progress};
    use rage_res::placements::{compile_map, ArchetypeSpec, EntitySpec};
    use rage_res::{
        hash::{joaat, sha256_hex},
        mlo::CEntity,
    };
    use rage_rpf::fixtures::noise;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::{cmp::Ordering, fs, path::PathBuf};

    const KEY_SIZES: [(&str, usize); 4] = [
        ("gtav_aes_key.dat", 32),
        ("gtav_ng_key.dat", 27472),
        ("gtav_ng_decrypt_tables.dat", 278528),
        ("gtav_hash_lut.dat", 256),
    ];

    struct Lab {
        dir: tempfile::TempDir,
    }

    type Failure = (String, String);

    impl Lab {
        fn new() -> Self {
            let lab = Self {
                dir: tempfile::tempdir().unwrap(),
            };
            fs::create_dir_all(lab.path("keys")).unwrap();
            for (name, size) in KEY_SIZES {
                fs::write(lab.path("keys").join(name), noise(size, 7)).unwrap();
            }
            fs::create_dir_all(lab.path("game")).unwrap();
            fs::write(lab.path("game").join("GTA5.exe"), b"").unwrap();
            lab
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn text(&self, name: &str) -> String {
            self.path(name).display().to_string()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            fs::write(self.path(name), bytes).unwrap();
            self.text(name)
        }

        fn archive(&self, name: &str, root: &DirNode) -> String {
            let mut file = fs::File::create(self.path(name)).unwrap();
            let staging = self.path("staging");
            fs::create_dir_all(&staging).unwrap();
            let mut context = WriteContext {
                staging: &staging,
                keys: None,
                finalizer: None,
            };
            write_archive(root, &mut file, &mut context, &mut |_| {}).unwrap();
            self.text(name)
        }

        /// Запрос в файле и запуск с поддельной игрой и ключами.
        fn scan(&self, request: &Value) -> Result<Value> {
            let input = self.put("req.json", request.to_string().as_bytes());
            let game = self.text("game");
            let keys = self.text("keys");
            self.run(&["--input", &input, "--game-root", &game, "--keys", &keys])
        }

        fn run(&self, args: &[&str]) -> Result<Value> {
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            lamp_archive_scan(&Options::parse(&argv)?, &Progress::silent())
        }
    }

    fn failure(result: Result<Value>) -> Failure {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    fn refused(what: &str) -> Failure {
        (
            "ArgumentException".into(),
            format!("{what}: пока на хосте."),
        )
    }

    fn file(name: &str, body: Body) -> FileNode {
        FileNode {
            name: name.into(),
            body,
        }
    }

    fn stored(name: &str, bytes: &[u8]) -> FileNode {
        file(
            name,
            Body::Binary {
                data: Data::memory(bytes.to_vec()),
                compress: Compress::Store,
            },
        )
    }

    fn deflated(name: &str, bytes: &[u8]) -> FileNode {
        file(
            name,
            Body::Binary {
                data: Data::memory(bytes.to_vec()),
                compress: Compress::Always,
            },
        )
    }

    fn resource(name: &str, bytes: &[u8]) -> FileNode {
        file(
            name,
            Body::Resource {
                data: Data::memory(bytes.to_vec()),
            },
        )
    }

    fn pack(name: &str, root: DirNode) -> FileNode {
        file(name, Body::Nested(Box::new(root)))
    }

    fn folder(name: &str, dirs: Vec<DirNode>, files: Vec<FileNode>) -> DirNode {
        DirNode {
            name: name.into(),
            dirs,
            files,
        }
    }

    fn top(files: Vec<FileNode>) -> DirNode {
        folder("", Vec::new(), files)
    }

    type Placed<'a> = (&'a str, [f32; 3], [f32; 4]);

    const IDENTITY: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

    /// Карта `.ymap` с обычными сущностями: файл ресурса целиком.
    fn map_of(placed: &[Placed]) -> Vec<u8> {
        let mut names: Vec<&str> = placed.iter().map(|item| item.0).collect();
        names.sort_unstable();
        names.dedup();
        let archetypes: Vec<ArchetypeSpec> = names
            .iter()
            .map(|name| ArchetypeSpec {
                name: (*name).into(),
                lod_dist: 100.0,
                bb_min: [-1.0; 3],
                bb_max: [1.0; 3],
                flags: 0,
                clip_dictionary: None,
            })
            .collect();
        let entities: Vec<EntitySpec> = placed
            .iter()
            .map(|(name, position, rotation)| EntitySpec {
                archetype: names.iter().position(|each| each == name).unwrap(),
                position: *position,
                rotation: *rotation,
                lod_dist: 100.0,
                flags: 0,
                guid: None,
            })
            .collect();
        compile_map("m", &archetypes, &entities, "exporter", "now").unwrap()
    }

    fn request(archive: &str, names: &[&str]) -> Value {
        json!({ "mode": MODE, "baseArchive": archive, "lampArchetypeNames": names })
    }

    fn with_depth(mut request: Value, depth: Option<i64>) -> Value {
        if let Some(depth) = depth {
            request["maxNestedDepth"] = json!(depth);
        }
        request
    }

    fn sha_of(path: &str) -> String {
        sha256_hex(&fs::read(path).unwrap())
    }

    fn mlo_entity(hash: u32) -> CEntity {
        CEntity {
            is_mlo: true,
            archetype_hash: hash,
            flags: 0,
            guid: 0,
            position: [1.0, 2.0, 3.0],
            rotation: [0.0; 4],
            scale_xy: 1.0,
            scale_z: 1.0,
            parent_index: -1,
            lod_dist: 0.0,
            child_lod_dist: 0.0,
            num_children: 0,
            lod_level: 0,
            priority_level: 0,
            tint_value: 0,
        }
    }

    fn row_of(path: &str, index: usize, name: &str, entity: &CEntity) -> String {
        occurrence(path, index, name, entity).unwrap().to_string()
    }

    fn entries_of(done: &Value) -> Vec<String> {
        done["occurrences"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["ymapEntry"].as_str().unwrap().to_owned())
            .collect()
    }

    // --- открытые для соседа элементы (пробы 4.12) ---

    #[test]
    fn registry_and_constants() {
        let names: Vec<&str> = COMMANDS.iter().map(|command| command.name).collect();
        assert_eq!(names, ["lamp-archive-scan"]);
        assert_eq!(META_SCHEMA_POINTER, 32);
    }

    #[test]
    fn join_path_keeps_slashes_as_they_are() {
        let cases = [
            ("", "a.ymap", "a.ymap"),
            ("p/q", "a.ymap", "p/q/a.ymap"),
            ("p/", "a", "p//a"),
            ("p", "", "p/"),
            ("", "", ""),
            ("p\\q", "a\\b", "p\\q/a\\b"),
        ];
        for (prefix, name, expected) in cases {
            assert_eq!(join_path(prefix, name), expected);
        }
    }

    #[test]
    fn ordinal_order_folds_only_ascii_letters() {
        use Ordering::{Equal, Greater, Less};
        let cases = [
            ("a", "A", Equal),
            ("a", "b", Less),
            ("B", "a", Greater),
            ("A/z", "a/B", Greater),
            ("b.ymap", "A/z", Greater),
            ("_", "Z", Greater),
            ("", "a", Less),
            ("a", "", Greater),
            ("a", "a", Equal),
            ("ab", "a", Greater),
            ("Я", "я", Less),
            ("я", "z", Greater),
            ("é", "E", Greater),
            ("a.", "a/", Less),
            ("a-", "a_", Less),
        ];
        for (left, right, expected) in cases {
            assert_eq!(ordinal_ignore_case(left, right), expected, "{left} {right}");
        }
        let mut paths = vec!["b.ymap", "A/z", "a/B"];
        paths.sort_by(|left, right| ordinal_ignore_case(left, right));
        assert_eq!(paths, ["a/B", "A/z", "b.ymap"]);
    }

    #[test]
    fn depth_defaults_and_clamps() {
        let depth = |request: Value| max_depth(&request).map_err(|error| error.message);
        for (given, expected) in [
            (json!({}), 12),
            (json!({ "maxNestedDepth": null }), 12),
            (json!({ "maxNestedDepth": 0 }), 0),
            (json!({ "maxNestedDepth": 1 }), 1),
            (json!({ "maxNestedDepth": 12 }), 12),
            (json!({ "maxNestedDepth": 24 }), 24),
            (json!({ "maxNestedDepth": 25 }), 24),
            (json!({ "maxNestedDepth": 100 }), 24),
            (json!({ "maxNestedDepth": -1 }), 0),
            (json!({ "maxNestedDepth": -100 }), 0),
            (json!({ "maxNestedDepth": i64::MAX }), 24),
            (json!({ "maxNestedDepth": i64::MIN }), 0),
        ] {
            assert_eq!(depth(given.clone()), Ok(expected), "{given}");
        }
        let refusal = Err("Глубина вложенности не число: пока на хосте.".to_owned());
        for bad in [
            json!({ "maxNestedDepth": "3" }),
            json!({ "maxNestedDepth": 2.5 }),
            json!({ "maxNestedDepth": true }),
            json!({ "maxNestedDepth": [1] }),
            json!({ "maxNestedDepth": u64::MAX }),
        ] {
            assert_eq!(depth(bad.clone()), refusal, "{bad}");
        }
        // 2.0 и 2e0 записаны с точкой или порядком: целыми не считаются
        for text in ["2.0", "2e0"] {
            let raw: Value =
                serde_json::from_str(&format!(r#"{{"maxNestedDepth":{text}}}"#)).unwrap();
            assert_eq!(depth(raw), refusal, "{text}");
        }
    }

    #[test]
    fn numbers_print_like_the_dotnet_text() {
        let cases: [(u32, &str); 26] = [
            (0, "0"),
            (0x8000_0000, "-0.0"),
            (1_065_353_216, "1"),
            (3_212_836_864, "-1"),
            (1_036_831_949, "0.1"),
            (1_069_547_520, "1.5"),
            (925_353_388, "0.00001"),
            (953_267_990, "0.00009999999"),
            (953_267_991, "0.0001"),
            (1_454_761_505, "100000000000000"),
            (1_482_907_561, "1000000000000000.0"),
            (1_510_874_058, "1e+16"),
            (1_290_500_515, "123456790"),
            (1_266_679_808, "16777216"),
            (1_900_671_690, "1e+30"),
            (4_048_155_338, "-1e+30"),
            (2_139_095_039, "3.4028235e+38"),
            (8_388_608, "1.1754944e-38"),
            (1_159_642_752, "2539.9062"),
            (989_855_744, "0.001953125"),
            (3_021_433_525, "-1.410179e-7"),
            (1_269_028_618, "21474836"),
            (1_127_405_562, "178.84366"),
            (1, "1.0000000000000001e-45"),
            (925_353_388, "0.00001"),
            (1_621_981_420, "1e+20"),
        ];
        for (bits, expected) in cases {
            assert_eq!(number(f32::from_bits(bits)).to_string(), expected, "{bits}");
        }
    }

    #[test]
    #[should_panic(expected = "научная запись")]
    fn number_panics_on_not_a_number() {
        number(f32::NAN);
    }

    #[test]
    #[should_panic(expected = "научная запись")]
    fn number_panics_on_infinity() {
        number(f32::INFINITY);
    }

    #[test]
    fn archive_file_follows_the_path_rules() {
        let lab = Lab::new();
        let real = lab.put("basic.rpf", b"x");
        let upper = lab.put("basic.RPF", b"x");
        fs::create_dir_all(lab.path("dir.rpf")).unwrap();
        let refusal = |what: &str| Err(format!("{what}: пока на хосте."));
        let probe = |request: Value| {
            archive_file(&request)
                .map(|path| path.display().to_string())
                .map_err(|error| error.message)
        };
        let only = "Архив — только абсолютный .rpf";
        assert_eq!(probe(json!({})), refusal(only));
        assert_eq!(probe(json!({ "baseArchive": "" })), refusal(only));
        assert_eq!(probe(json!({ "baseArchive": 5 })), refusal(only));
        assert_eq!(probe(json!({ "baseArchive": null })), refusal(only));
        assert_eq!(
            probe(json!({ "baseArchive": "samples/archives/basic.rpf" })),
            refusal(only)
        );
        assert_eq!(probe(json!({ "baseArchive": real })), Ok(real.clone()));
        assert_eq!(probe(json!({ "baseArchive": upper })), Ok(upper.clone()));
        assert_eq!(
            probe(json!({ "baseArchive": lab.text("нет.rpf") })),
            refusal("Архив не найден")
        );
        assert_eq!(
            probe(json!({ "baseArchive": lab.text("basic.zip") })),
            refusal(only)
        );
        assert_eq!(
            probe(json!({ "baseArchive": lab.text("dir.rpf") })),
            refusal("Архив не найден")
        );
        assert_eq!(
            probe(json!({ "baseArchive": real.replace('\\', "/") })),
            Ok(real.clone())
        );
        assert_eq!(
            probe(json!({ "baseArchive": format!("{real} ") })),
            refusal(only)
        );
        assert_eq!(probe(json!({ "baseArchive": "\\a.rpf" })), refusal(only));
        assert_eq!(probe(json!({ "baseArchive": "C:a.rpf" })), refusal(only));
        assert_eq!(
            probe(json!({ "baseArchive": "C:\\.rpf" })),
            refusal("Архив не найден")
        );
        assert_eq!(
            probe(json!({ "baseArchive": "\\\\нет-сервера\\share\\a.rpf" })),
            refusal("Архив не найден")
        );
    }

    // --- имена архетипов (старые тесты и 4.5) ---

    #[test]
    fn archetype_names_follow_the_host_rules() {
        let names = |list: Value| {
            Wanted::from_request(&json!({ "lampArchetypeNames": list }))
                .map(|wanted| {
                    wanted
                        .sorted
                        .into_iter()
                        .map(|(name, _)| name)
                        .collect::<Vec<_>>()
                })
                .map_err(|error| error.message)
        };
        assert_eq!(
            names(json!([" Prop_Streetlight_01 ", "PROP-X\t"])),
            Ok(vec!["prop-x".to_owned(), "prop_streetlight_01".to_owned()])
        );
        let outside = Err("Имена архетипов вне правил: пока на хосте.".to_owned());
        for bad in [
            json!(["a", "A"]),
            json!(["a", " a "]),
            json!(["a/b"]),
            json!(["a b"]),
            json!([""]),
            json!(["   "]),
            json!(["a.b"]),
            json!(["a:b"]),
            json!(["лампа"]),
            json!([5]),
            json!([null, "prop_lamp_a"]),
            json!(["a\u{0}b"]),
            json!(["\u{2003}"]),
            json!([]),
            json!(["a".repeat(129)]),
        ] {
            assert_eq!(names(bad.clone()), outside, "{bad}");
        }
        assert_eq!(names(json!(["a".repeat(128)])), Ok(vec!["a".repeat(128)]));
        // пробельные знаки обрезаются по Юникоду, в том числе неразрывный пробел
        assert_eq!(
            names(json!(["\u{a0}prop_lamp_a\u{a0}"])),
            Ok(vec!["prop_lamp_a".to_owned()])
        );
        let many = |count: usize| json!((0..count).map(|n| format!("p{n}")).collect::<Vec<_>>());
        assert_eq!(names(many(64)).map(|list| list.len()), Ok(64));
        assert_eq!(names(many(65)), outside);
        for absent in [json!({}), json!("prop_lamp_a")] {
            assert_eq!(
                names(absent),
                Err("Нет имён архетипов: пока на хосте.".to_owned())
            );
        }
        // два разных имени с одним хешем
        assert_eq!(joaat("c450"), joaat("c4lg"));
        assert_eq!(
            names(json!(["c450", "c4lg"])),
            Err("Два имени архетипа дают один хеш: пока на хосте.".to_owned())
        );
        assert_eq!(
            names(json!(["c450", "c4lg", "a/b"])),
            outside,
            "неверное имя побеждает общий хеш"
        );
    }

    #[test]
    fn archetypes_are_sorted_bytewise_with_upper_hex_hash() {
        let wanted = Wanted::from_request(&json!({
            "lampArchetypeNames": ["prop_lamp_b", "prop-x", "prop_lamp_a", "Z9", "0abc"]
        }))
        .unwrap();
        let names: Vec<&str> = wanted
            .sorted
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            names,
            ["0abc", "prop-x", "prop_lamp_a", "prop_lamp_b", "z9"]
        );
        assert_eq!(hex8(joaat("prop_lamp_a")), "0xE1F367AB");
        assert_eq!(hex8(joaat("prop_lamp_b")), "0xB31D09FF");
    }

    #[test]
    fn either_endian_finds_the_hash_in_any_order() {
        let wanted = Wanted::from_request(&json!({ "lampArchetypeNames": ["prop_a"] })).unwrap();
        let hash = joaat("prop_a");
        let mut forward = b"PSIN....".to_vec();
        forward.extend(hash.to_le_bytes());
        let mut backward = b"PSIN....".to_vec();
        backward.extend(hash.to_be_bytes());
        assert!(wanted.appears_in(&forward));
        assert!(wanted.appears_in(&backward));
        assert!(!wanted.appears_in(&forward[..forward.len() - 1]));
        assert!(!wanted.appears_in(&hash.to_le_bytes()[..3]));
        assert!(wanted.appears_in(&hash.to_le_bytes()));
    }

    // --- сущности ---

    #[test]
    fn entity_hash_wraps_negative_coordinates_like_dotnet() {
        assert_eq!(fingerprint(0, [-1.0, 0.0, 0.0]), 0xFFFF_FF9C);
        assert_eq!(
            fingerprint(0x10, [1.5, 2.25, -0.5]),
            0x10 ^ 150 ^ 225 ^ 0xFFFF_FFCE
        );
        assert_eq!(fingerprint(0xE1F3_67AB, [1.0, 2.0, 3.0]), 0xE1F3_662B);
        assert_eq!(fingerprint(0xB31D_09FF, [-1.5, 2.25, -0.5]), 0xB31D_09BA);
        assert_eq!(fingerprint(0xB31D_09FF, [100.126, -3.1, 7.0]), 0x4CE2_D295);
    }

    #[test]
    fn plain_entities_print_the_inverse_rotation_and_mlo_keeps_it() {
        let mut plain = mlo_entity(joaat("prop_lamp_a"));
        plain.is_mlo = false;
        plain.rotation = [0.1, 0.2, 0.3, 0.9];
        plain.scale_xy = 1.5;
        plain.scale_z = 2.0;
        assert_eq!(
            row_of("levels/a/ent-basic.ymap", 0, "prop_lamp_a", &plain),
            concat!(
                r#"{"ymapEntry":"levels/a/ent-basic.ymap","entityIndex":0,"archetypeName":"prop_lamp_a","#,
                r#""archetypeHash":"0xE1F367AB","entityGuid":"0xE1F3662B","positionX":1,"positionY":2,"positionZ":3,"#,
                r#""rotationX":-0.105263166,"rotationY":-0.21052633,"rotationZ":-0.3157895,"rotationW":0.94736844,"#,
                r#""scaleX":1.5,"scaleY":1.5,"scaleZ":2}"#
            )
        );
        // вход в помещение: поворот как записан, даже нулевой
        let portal = mlo_entity(joaat("prop_a"));
        let row = occurrence("m.ymap", 0, "prop_a", &portal).unwrap();
        for key in ["rotationX", "rotationY", "rotationZ", "rotationW"] {
            assert_eq!(row[key].to_string(), "0", "{key}");
        }
        // единичный поворот остаётся как есть
        plain.rotation = IDENTITY;
        let row = occurrence("m.ymap", 3, "prop_lamp_a", &plain).unwrap();
        assert_eq!(row["rotationW"].to_string(), "1");
        assert_eq!(row["entityIndex"], 3);
        // поворот (0,0,0,-1) и переполнение суммы квадратов
        plain.rotation = [0.0, 0.0, 0.0, -1.0];
        let row = occurrence("m.ymap", 0, "prop_lamp_a", &plain).unwrap();
        assert_eq!(
            [row["rotationX"].to_string(), row["rotationW"].to_string()],
            ["-0.0", "-1"]
        );
        plain.rotation = [3e38, 3e38, 0.0, 0.0];
        let row = occurrence("m.ymap", 0, "prop_lamp_a", &plain).unwrap();
        assert_eq!(
            [
                row["rotationX"].to_string(),
                row["rotationZ"].to_string(),
                row["rotationW"].to_string()
            ],
            ["-0.0", "-0.0", "0"]
        );
    }

    #[test]
    fn not_finite_numbers_are_refused_before_the_inverse_is_taken() {
        let refusal = "Поворот или масштаб сущности не конечны: пока на хосте.";
        let spoil: [fn(&mut CEntity); 6] = [
            |entity| entity.position[0] = f32::NAN,
            |entity| entity.position[2] = f32::INFINITY,
            |entity| entity.rotation[1] = f32::NAN,
            |entity| entity.rotation[3] = f32::NEG_INFINITY,
            |entity| entity.scale_xy = f32::INFINITY,
            |entity| entity.scale_z = f32::NAN,
        ];
        for (n, apply) in spoil.iter().enumerate() {
            for portal in [false, true] {
                let mut entity = mlo_entity(1);
                entity.rotation = IDENTITY;
                entity.is_mlo = portal;
                apply(&mut entity);
                let error = occurrence("m.ymap", 0, "a", &entity).unwrap_err();
                assert_eq!(error.message, refusal, "{n} {portal}");
            }
        }
    }

    #[test]
    fn a_zero_rotation_whose_inverse_is_not_finite_is_refused_not_a_panic() {
        let refusal = "Поворот или масштаб сущности не конечны: пока на хосте.";
        for rotation in [
            [0.0, 0.0, 0.0, 0.0],
            [1e-30, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1e-30, 0.0],
        ] {
            let mut plain = mlo_entity(joaat("prop_lamp_a"));
            plain.is_mlo = false;
            plain.rotation = rotation;
            let error = occurrence("m.ymap", 0, "prop_lamp_a", &plain).unwrap_err();
            assert_eq!(error.message, refusal, "{rotation:?}");
        }
        // у входа в помещение поворот не пересчитывается: нулевой остаётся как записан
        let mut portal = mlo_entity(joaat("prop_a"));
        portal.rotation = [0.0, 0.0, 0.0, 0.0];
        assert!(occurrence("m.ymap", 0, "prop_a", &portal).is_ok());
    }

    // --- запрос и параметры ---

    #[test]
    fn parameters_and_request_shape() {
        let lab = Lab::new();
        let archive = lab.archive("basic.rpf", &top(vec![stored("readme.txt", b"hi")]));
        let ok = request(&archive, &["prop_a"]);
        let game = lab.text("game");
        let keys = lab.text("keys");

        let no_input = lab.run(&["--game-root", &game, "--keys", &keys]);
        assert_eq!(failure(no_input).1, "--input is required.");
        let missing = lab.text("нет.json");
        assert_eq!(
            failure(lab.run(&["--input", &missing, "--game-root", &game])),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {missing}")
            )
        );
        let text = lab.put("r.txt", b"{}");
        assert_eq!(
            failure(lab.run(&["--input", &text, "--game-root", &game])).1,
            "Unsupported file extension: .txt"
        );
        assert_eq!(
            failure(lab.run(&["--input", "", "--game-root", &game])).1,
            "The path is empty."
        );
        fs::create_dir_all(lab.path("d.json")).unwrap();
        assert_eq!(
            failure(lab.run(&["--input", &lab.text("d.json")])).0,
            "FileNotFoundException"
        );

        // игровая папка проверяется после запроса, но до открытия архива
        let input = lab.put("req.json", ok.to_string().as_bytes());
        assert_eq!(
            failure(lab.run(&["--input", &input, "--keys", &keys])).1,
            "--game-root is required."
        );
        let nowhere = lab.text("нет");
        let not_game = (
            "DirectoryNotFoundException".to_owned(),
            "The selected directory is not a GTA V installation.".to_owned(),
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &nowhere])),
            not_game
        );
        let empty_game = lab.path("empty-game");
        fs::create_dir_all(&empty_game).unwrap();
        let empty_game = empty_game.display().to_string();
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &empty_game])),
            not_game
        );
        let dir_exe = lab.path("dir-exe");
        fs::create_dir_all(dir_exe.join("GTA5.exe")).unwrap();
        let dir_exe = dir_exe.display().to_string();
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &dir_exe])),
            not_game
        );
        // PlayGTAV.exe и GTA5_Enhanced.exe тоже годятся
        for exe in ["PlayGTAV.exe", "GTA5_Enhanced.exe"] {
            let home = lab.path(exe);
            fs::create_dir_all(&home).unwrap();
            fs::write(home.join(exe), b"").unwrap();
            let home = home.display().to_string();
            let done = lab.run(&["--input", &input, "--game-root", &home, "--keys", &keys]);
            assert_eq!(done.unwrap()["entryCount"], 1, "{exe}");
        }

        // повтор и регистр имён параметров: берётся последний
        let other = lab.put("other.json", r#"{"mode":"другое"}"#.as_bytes());
        let done = lab
            .run(&[
                "--INPUT",
                &other,
                "--Input",
                &input,
                "--game-root",
                &nowhere,
                "--GAME-ROOT",
                &game,
                "--keys",
                &nowhere,
                "--Keys",
                &keys,
                "--лишний",
                "x",
            ])
            .unwrap();
        assert_eq!(done["archiveCount"], 1);

        // ключи
        let bare = lab.path("bare-keys");
        fs::create_dir_all(&bare).unwrap();
        let bare_text = bare.display().to_string();
        let with_keys =
            |keys: &str| lab.run(&["--input", &input, "--game-root", &game, "--keys", keys]);
        let key_failure = failure(with_keys(&bare_text));
        assert_eq!(key_failure.0, "InvalidOperationException");
        assert!(
            key_failure.1.starts_with(&format!(
                "The GTA V RPF key file gtav_aes_key.dat could not be read from {bare_text}: "
            )),
            "{}",
            key_failure.1
        );
        let short = lab.path("short-keys");
        fs::create_dir_all(&short).unwrap();
        for (name, size) in KEY_SIZES {
            let size = size - usize::from(name == "gtav_hash_lut.dat");
            fs::write(short.join(name), noise(size, 3)).unwrap();
        }
        let short_text = short.display().to_string();
        assert_eq!(
            failure(with_keys(&short_text)),
            (
                "InvalidOperationException".into(),
                "The GTA V RPF key set is incomplete.".into()
            )
        );
        fs::remove_file(short.join("gtav_hash_lut.dat")).unwrap();
        assert!(failure(with_keys(&short_text))
            .1
            .starts_with("The GTA V RPF key file gtav_hash_lut.dat could not be read from"));
    }

    #[test]
    fn request_checks_run_in_order() {
        let lab = Lab::new();
        let archive = lab.archive("a.rpf", &top(vec![stored("readme.txt", b"hi")]));
        let game = lab.text("game");
        let keys = lab.text("keys");
        let nowhere = lab.text("нет");
        let unreadable = refused("Запрос описи архива не читается");
        for body in [b"".to_vec(), b"nope".to_vec(), b"\xEF\xBB\xBF{}".to_vec()] {
            let input = lab.put("req.json", &body);
            assert_eq!(
                failure(lab.run(&["--input", &input, "--game-root", &game])),
                unreadable
            );
        }
        let other_mode = refused("Запрос описи архива другого режима");
        for body in [
            json!([]),
            json!(5),
            json!({}),
            json!({ "mode": "other" }),
            json!({ "mode": "Lamp-Archive-Scan" }),
            json!({ "mode": "lamp-lod-nearest" }),
            json!({ "mode": 5 }),
            json!({ "mode": "x" }),
        ] {
            assert_eq!(failure(lab.scan(&body)), other_mode, "{body}");
        }
        let only = refused("Архив — только абсолютный .rpf");
        assert_eq!(failure(lab.scan(&json!({ "mode": MODE }))), only);
        assert_eq!(
            failure(
                lab.scan(&json!({ "mode": MODE, "baseArchive": "", "lampArchetypeNames": [] }))
            ),
            only
        );
        assert_eq!(
            failure(lab.scan(&json!({
                "mode": MODE, "baseArchive": lab.text("нет.rpf"), "lampArchetypeNames": []
            }))),
            refused("Архив не найден")
        );
        assert_eq!(
            failure(lab.scan(&json!({ "mode": MODE, "baseArchive": archive }))),
            refused("Нет имён архетипов")
        );
        let names = refused("Имена архетипов вне правил");
        assert_eq!(
            failure(lab.scan(&json!({
                "mode": MODE, "baseArchive": archive, "lampArchetypeNames": [], "maxNestedDepth": "x"
            }))),
            names,
            "имена раньше глубины"
        );
        let mut wrong_depth = request(&archive, &["prop_a"]);
        wrong_depth["maxNestedDepth"] = json!("x");
        let input = lab.put("req.json", wrong_depth.to_string().as_bytes());
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &nowhere, "--keys", &keys])),
            refused("Глубина вложенности не число"),
            "глубина раньше игровой папки"
        );
        // папка игры раньше открытия архива, который не архив
        let text_rpf = lab.put("text.rpf", "привет, это не архив".as_bytes());
        let input = lab.put(
            "req.json",
            request(&text_rpf, &["prop_a"]).to_string().as_bytes(),
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &nowhere, "--keys", &keys])).0,
            "DirectoryNotFoundException"
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &game, "--keys", &keys])),
            (
                "InvalidDataException".into(),
                "text.rpf: The identifier 80D1BFD0 did not match the expected value of 0x52504637"
                    .into()
            )
        );
        let empty = lab.put("empty.rpf", b"");
        assert_eq!(
            failure(lab.scan(&request(&empty, &["prop_a"]))).1,
            "empty.rpf: the file is too short to be an RPF7 archive"
        );
    }

    // --- обход и ответ ---

    fn ymap_archive(lab: &Lab, name: &str) -> String {
        let lamp = map_of(&[
            ("prop_lamp_a", [1.0, 2.0, 3.0], [0.1, 0.2, 0.3, 0.9]),
            ("prop_lamp_b", [-1.5, 2.25, -0.5], IDENTITY),
            ("prop_other", [5.0, 6.0, 7.0], IDENTITY),
            ("prop_lamp_b", [100.126, -3.1, 7.0], IDENTITY),
        ]);
        let order = map_of(&[
            ("prop_a", [1.0, 1.0, 1.0], IDENTITY),
            ("prop_x", [2.0, 2.0, 2.0], IDENTITY),
            ("prop_a", [3.0, 3.0, 3.0], IDENTITY),
        ]);
        let root = folder(
            "",
            vec![folder(
                "levels",
                vec![
                    folder("a", Vec::new(), vec![resource("ent-basic.ymap", &lamp)]),
                    folder("b", Vec::new(), vec![resource("ent-order.ymap", &order)]),
                ],
                vec![stored("readme.txt", b"hello")],
            )],
            vec![deflated("gta5.dat", &noise(300, 5))],
        );
        lab.archive(name, &root)
    }

    #[test]
    fn a_plain_archive_is_described_in_full() {
        let lab = Lab::new();
        let archive = ymap_archive(&lab, "basic.rpf");
        let mut asked = request(&archive, &["prop_lamp_a", "prop_lamp_b"]);
        asked["edition"] = json!("legacy");
        asked["archiveTarget"] = json!({ "a": [1, 2] });
        let done = lab.scan(&asked).unwrap();

        let keys: Vec<&str> = done
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "edition",
                "archive",
                "archiveSha256",
                "archiveCount",
                "entryCount",
                "ymapCount",
                "inventorySha256",
                "archetypes",
                "occurrences",
                "parseErrors",
                "complete",
                "keyMode"
            ]
        );
        assert_eq!(done["status"], "ready");
        assert_eq!(done["mode"], "lamp-archive-scan");
        assert_eq!(done["edition"], "legacy");
        assert_eq!(done["archive"], json!({ "a": [1, 2] }));
        assert_eq!(done["archiveSha256"], sha_of(&archive));
        assert_eq!(done["archiveCount"], 1);
        assert_eq!(done["entryCount"], 4);
        assert_eq!(done["ymapCount"], 2);
        let inventory = [
            "gta5.dat",
            "levels/a/ent-basic.ymap",
            "levels/b/ent-order.ymap",
            "levels/readme.txt",
        ];
        assert_eq!(
            done["inventorySha256"],
            sha256_hex(inventory.join("\n").as_bytes())
        );
        assert_eq!(
            done["archetypes"],
            json!([
                { "name": "prop_lamp_a", "hash": "0xE1F367AB" },
                { "name": "prop_lamp_b", "hash": "0xB31D09FF" },
            ])
        );
        assert_eq!(done["parseErrors"], json!([]));
        assert_eq!(done["complete"], true);
        assert_eq!(done["keyMode"], "configured-key-directory");

        let rows = done["occurrences"].as_array().unwrap();
        let summary: Vec<(String, u64, String, String)> = rows
            .iter()
            .map(|row| {
                (
                    row["ymapEntry"].as_str().unwrap().to_owned(),
                    row["entityIndex"].as_u64().unwrap(),
                    row["archetypeName"].as_str().unwrap().to_owned(),
                    row["entityGuid"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        let entry = "levels/a/ent-basic.ymap".to_owned();
        let owned = |index: u64, name: &str, guid: &str| {
            (entry.clone(), index, name.to_owned(), guid.to_owned())
        };
        assert_eq!(
            summary,
            [
                owned(0, "prop_lamp_a", "0xE1F3662B"),
                owned(1, "prop_lamp_b", "0xB31D09BA"),
                owned(3, "prop_lamp_b", "0x4CE2D295"),
            ]
        );
        assert_eq!(
            rows[0].to_string(),
            concat!(
                r#"{"ymapEntry":"levels/a/ent-basic.ymap","entityIndex":0,"archetypeName":"prop_lamp_a","#,
                r#""archetypeHash":"0xE1F367AB","entityGuid":"0xE1F3662B","positionX":1,"positionY":2,"positionZ":3,"#,
                r#""rotationX":-0.105263166,"rotationY":-0.21052633,"rotationZ":-0.3157895,"rotationW":0.94736844,"#,
                r#""scaleX":1,"scaleY":1,"scaleZ":1}"#
            )
        );
        assert_eq!(rows[2]["positionX"].to_string(), "100.126");
        assert_eq!(rows[2]["positionY"].to_string(), "-3.1");

        // ни одного совпавшего архетипа
        let none = lab.scan(&request(&archive, &["nothing_here"])).unwrap();
        assert_eq!(none["occurrences"], json!([]));
        assert_eq!(none["entryCount"], 4);
        assert_eq!(none["edition"], Value::Null);
        assert_eq!(none["archive"], Value::Null);
        // карты идут в порядке пути без учёта регистра
        let both = lab.scan(&request(&archive, &["prop_a", "prop_x"])).unwrap();
        let order: Vec<(&str, u64)> = both["occurrences"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                (
                    row["ymapEntry"].as_str().unwrap(),
                    row["entityIndex"].as_u64().unwrap(),
                )
            })
            .collect();
        let order_entry = "levels/b/ent-order.ymap";
        assert_eq!(
            order,
            [(order_entry, 0), (order_entry, 1), (order_entry, 2)]
        );
    }

    #[test]
    fn nested_archives_prefix_paths_and_depth_limits_the_opening() {
        let lab = Lab::new();
        let map = |x: f32| map_of(&[("prop_a", [x, x, x], IDENTITY)]);
        let n4 = top(vec![resource("in4.ymap", &map(50.0))]);
        let n3 = top(vec![resource("in3.ymap", &map(40.0)), pack("n4.rpf", n4)]);
        let n2 = top(vec![resource("in2.ymap", &map(30.0)), pack("n3.rpf", n3)]);
        let n1 = top(vec![resource("in1.ymap", &map(20.0)), pack("n2.rpf", n2)]);
        let nest = lab.archive(
            "nest.rpf",
            &top(vec![resource("top.ymap", &map(10.0)), pack("n1.rpf", n1)]),
        );
        let scan = |depth: Option<i64>| {
            let done = lab
                .scan(&with_depth(request(&nest, &["prop_a"]), depth))
                .unwrap();
            (
                done["archiveCount"].as_u64().unwrap(),
                done["entryCount"].as_u64().unwrap(),
                done["ymapCount"].as_u64().unwrap(),
                entries_of(&done),
            )
        };
        let names = |list: &[&str]| {
            list.iter()
                .map(|name| (*name).to_owned())
                .collect::<Vec<_>>()
        };
        let all = names(&[
            "n1.rpf/in1.ymap",
            "n1.rpf/n2.rpf/in2.ymap",
            "n1.rpf/n2.rpf/n3.rpf/in3.ymap",
            "n1.rpf/n2.rpf/n3.rpf/n4.rpf/in4.ymap",
            "top.ymap",
        ]);
        assert_eq!(scan(None), (5, 9, 5, all.clone()));
        assert_eq!(scan(Some(4)), (5, 9, 5, all.clone()));
        assert_eq!(scan(Some(5)), (5, 9, 5, all));
        assert_eq!(scan(Some(0)), (1, 2, 1, names(&["top.ymap"])));
        assert_eq!(scan(Some(-7)), (1, 2, 1, names(&["top.ymap"])));
        assert_eq!(
            scan(Some(1)),
            (2, 4, 2, names(&["n1.rpf/in1.ymap", "top.ymap"]))
        );
        assert_eq!(
            scan(Some(2)),
            (
                3,
                6,
                3,
                names(&["n1.rpf/in1.ymap", "n1.rpf/n2.rpf/in2.ymap", "top.ymap"])
            )
        );
        assert_eq!(scan(Some(3)).0, 4);
    }

    #[test]
    fn depth_is_capped_at_24_levels() {
        let lab = Lab::new();
        let map = map_of(&[("prop_a", [1.0, 1.0, 1.0], IDENTITY)]);
        // 26 вложенных архивов: n1 внутри корня, n26 внутри n25
        let mut inner = top(vec![resource("in26.ymap", &map)]);
        for level in (1..=25).rev() {
            inner = top(vec![
                resource(&format!("in{level}.ymap"), &map),
                pack(&format!("n{}.rpf", level + 1), inner),
            ]);
        }
        let deep = lab.archive("deep.rpf", &top(vec![pack("n1.rpf", inner)]));
        let archives = |depth: Option<i64>| {
            let asked = with_depth(request(&deep, &["prop_a"]), depth);
            lab.scan(&asked).unwrap()["archiveCount"].as_u64().unwrap()
        };
        assert_eq!(archives(Some(24)), 25);
        assert_eq!(archives(Some(25)), 25);
        assert_eq!(archives(Some(100)), 25);
        assert_eq!(archives(Some(23)), 24);
        assert_eq!(archives(None), 13);
    }

    #[test]
    fn extensions_names_and_kinds_decide_what_is_counted() {
        let lab = Lab::new();
        let map = map_of(&[("prop_a", [1.0, 1.0, 1.0], IDENTITY)]);
        let inner = top(vec![resource("in.ymap", &map)]);
        let root = folder(
            "",
            vec![folder(
                "dir.ymap",
                Vec::new(),
                vec![resource("deep.ymap", &map)],
            )],
            vec![
                resource("UP.YMAP", &map),
                resource("Mixed.Ymap", &map),
                resource(".ymap", &map),
                stored("a b,c.txt", b"x"),
                resource("x.rpf.ymap", &map),
                pack("x.rpf", inner.clone()),
                pack("N.RPF", inner.clone()),
                pack("m.Rpf", inner),
            ],
        );
        let archive = lab.archive("names.rpf", &root);
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        assert_eq!(
            entries_of(&done),
            [
                ".ymap",
                "dir.ymap/deep.ymap",
                "m.Rpf/in.ymap",
                "Mixed.Ymap",
                "N.RPF/in.ymap",
                "UP.YMAP",
                "x.rpf.ymap",
                "x.rpf/in.ymap",
            ]
        );
        assert_eq!(done["archiveCount"], 4);
        // каталог с именем .ymap картой не считается: пять карт в корне и каталоге и три во вложенных
        assert_eq!(done["ymapCount"], 8);
        assert_eq!(done["entryCount"], 12);
    }

    #[test]
    fn maps_in_other_forms_of_storage_and_without_a_schema_table() {
        let lab = Lab::new();
        let map = map_of(&[("prop_a", [1.0, 1.0, 1.0], IDENTITY)]);
        // карта без таблицы структур: указатель по смещению 0x20 нулевой
        let mut flat = Vec::new();
        for word in [rage_res::resource::RSC7_MAGIC, 2, 1 << 27, 0] {
            flat.extend(word.to_le_bytes());
        }
        flat.extend(rage_res::resource::deflate_zlib9(&[0u8; 0x200]));
        let archive = lab.archive(
            "noschema.rpf",
            &top(vec![resource("y.ymap", &map), resource("z.ymap", &flat)]),
        );
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        assert_eq!(done["ymapCount"], 2);
        assert_eq!(entries_of(&done), ["y.ymap"]);

        // двоичная запись: несжатая и сжатая; те же байты, что у ресурса
        let archive = lab.archive(
            "bin.rpf",
            &top(vec![
                stored("d.ymap", &map),
                deflated("s.ymap", &map),
                resource("r.ymap", &map),
            ]),
        );
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        assert_eq!(entries_of(&done), ["d.ymap", "r.ymap", "s.ymap"]);
    }

    #[test]
    fn pso_goes_to_the_host_but_unreadable_maps_and_bad_nested_archives_are_skipped() {
        let lab = Lab::new();
        let hash = joaat("prop_a");
        let pso = |bytes: Vec<u8>| [b"PSIN".to_vec(), bytes].concat();
        let scan_one = |name: &str, file: FileNode, extra: Vec<FileNode>, depth: Option<i64>| {
            let mut files = vec![file];
            files.extend(extra);
            let archive = lab.archive(name, &top(files));
            lab.scan(&with_depth(request(&archive, &["prop_a"]), depth))
        };
        let host = refused("PSO-карта с нужным архетипом");
        let le = [vec![9u8; 5], hash.to_le_bytes().to_vec()].concat();
        let be = [vec![9u8; 5], hash.to_be_bytes().to_vec()].concat();
        let right_after_magic = hash.to_le_bytes().to_vec();
        for hit in [le, be, right_after_magic] {
            let result = scan_one("pso.rpf", stored("p.ymap", &pso(hit)), vec![], None);
            assert_eq!(failure(result), host);
        }
        // хеш оборван на краю: карты без сущностей
        let cut = hash.to_le_bytes();
        let edge = [
            pso(cut[..3].to_vec()),
            pso([vec![0u8; 5], cut[..3].to_vec()].concat()),
        ];
        for miss in edge {
            let done = scan_one("pso.rpf", stored("p.ymap", &miss), vec![], None).unwrap();
            assert_eq!(done["ymapCount"], 1);
            assert_eq!(done["occurrences"], json!([]));
        }
        // Раньше одна нечитаемая карта роняла всю опись; теперь она пропускается и называется в parseErrors.
        let skipped = |done: &Value| -> Vec<(String, String)> {
            done["parseErrors"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| {
                    (
                        item["entry"].as_str().unwrap().to_owned(),
                        item["error"].as_str().unwrap().to_owned(),
                    )
                })
                .collect()
        };
        let pair = |entry: &str, reason: &str| (entry.to_owned(), reason.to_owned());
        let unreadable = "Карта .ymap не читается";
        let magic = rage_res::resource::RSC7_MAGIC.to_le_bytes();
        let rsc7_cut = [magic.to_vec(), vec![1u8, 2, 3]].concat();
        let rsc7_head = [magic.to_vec(), vec![0u8; 12]].concat();
        let rsc7_junk = [
            magic.to_vec(),
            vec![2, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0x20],
            vec![0xFF; 40],
        ]
        .concat();
        for junk in [
            b"text instead of a map".to_vec(),
            Vec::new(),
            rsc7_cut,
            rsc7_head,
            rsc7_junk,
        ] {
            let done = scan_one("junk.rpf", stored("g.ymap", &junk), vec![], None).unwrap();
            assert_eq!(skipped(&done), [pair("g.ymap", unreadable)]);
            assert_eq!(done["complete"], false);
            assert_eq!(done["ymapCount"], 1);
            assert_eq!(done["occurrences"], json!([]));
        }
        // не архив под именем .rpf: пропускается, карты рядом читаются; на нулевой глубине не открывается вовсе
        let bad = stored("z.rpf", b"not an archive");
        let nested = "Вложенный архив не открылся";
        let map = map_of(&[("prop_a", [1.0, 1.0, 1.0], IDENTITY)]);
        let good = resource("a.ymap", &map);
        let done = scan_one("n.rpf", bad.clone(), vec![good.clone()], None).unwrap();
        assert_eq!(skipped(&done), [pair("z.rpf", nested)]);
        assert_eq!(done["occurrences"].as_array().unwrap().len(), 1);
        assert_eq!(done["entryCount"], 2);
        let done = scan_one("n.rpf", bad, vec![good.clone()], Some(0)).unwrap();
        assert_eq!(done["entryCount"], 2);
        assert_eq!(done["archiveCount"], 1);
        // ресурс с именем .rpf не открывается и не попадает в parseErrors, а запись .rpf не архив — пропускается
        let fake = resource("r.rpf", &map);
        let junk_rpf = stored("q.rpf", b"junk");
        let done = scan_one(
            "fake.rpf",
            fake.clone(),
            vec![junk_rpf.clone(), good.clone()],
            None,
        )
        .unwrap();
        assert_eq!(skipped(&done), [pair("q.rpf", nested)]);
        assert_eq!(done["occurrences"].as_array().unwrap().len(), 1);
        let result = scan_one(
            "fake.rpf",
            fake.clone(),
            vec![junk_rpf, good.clone()],
            Some(0),
        );
        let done = result.unwrap();
        assert_eq!(done["entryCount"], 3);
        assert_eq!(done["archiveCount"], 1);
        let done = scan_one("fake.rpf", fake, vec![good], None).unwrap();
        assert_eq!(
            done["archiveCount"], 1,
            "ресурс .rpf не открывается без отказа"
        );
        assert_eq!(done["parseErrors"], json!([]));
        assert_eq!(done["complete"], true);
        // порядок обхода решает, в каком порядке пропуски лягут в parseErrors
        let early_bad = stored("a.rpf", b"junk");
        let late_map = stored("z.ymap", b"junk");
        let done = scan_one("order.rpf", early_bad, vec![late_map.clone()], None).unwrap();
        assert_eq!(
            skipped(&done),
            [pair("a.rpf", nested), pair("z.ymap", unreadable)]
        );
        let done = scan_one("order.rpf", late_map, vec![stored("zz.rpf", b"junk")], None).unwrap();
        assert_eq!(
            skipped(&done),
            [pair("z.ymap", unreadable), pair("zz.rpf", nested)]
        );
        // файлы каталога идут раньше его подкаталогов: нечитаемая карта корня встаёт в parseErrors раньше плохого архива глубже
        let root = folder(
            "",
            vec![folder("a", Vec::new(), vec![stored("bad.rpf", b"junk")])],
            vec![stored("z.ymap", b"junk")],
        );
        let archive = lab.archive("files-first.rpf", &root);
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        assert_eq!(
            skipped(&done),
            [pair("z.ymap", unreadable), pair("a/bad.rpf", nested)]
        );
    }

    #[test]
    fn damaged_archives_fail_in_their_own_words() {
        let lab = Lab::new();
        let archive = ymap_archive(&lab, "whole.rpf");
        let bytes = fs::read(&archive).unwrap();
        let cut = |len: usize| {
            let path = lab.put("a.rpf", &bytes[..len]);
            lab.scan(&request(&path, &["prop_lamp_a"]))
        };
        // Раньше запись .ymap, которая не распаковалась, роняла всю опись; теперь она пропускается и называется в parseErrors.
        for len in [512, bytes.len() / 2] {
            let done = cut(len).unwrap();
            let reasons: Vec<&str> = done["parseErrors"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["error"].as_str().unwrap())
                .collect();
            assert!(!reasons.is_empty(), "{len}");
            assert!(
                reasons
                    .iter()
                    .all(|reason| *reason == "Запись .ymap не распакована"),
                "{len}"
            );
            assert_eq!(done["complete"], false, "{len}");
        }
        assert_eq!(
            failure(cut(4)),
            (
                "InvalidDataException".into(),
                "a.rpf: the file is too short to be an RPF7 archive".into()
            )
        );
        assert_eq!(
            failure(cut(16)),
            (
                "InvalidDataException".into(),
                "a.rpf: the table of contents goes beyond the end of the file".into()
            )
        );
        let mut wrong = bytes.clone();
        wrong[..4].copy_from_slice(b"XXXX");
        let path = lab.put("a.rpf", &wrong);
        assert_eq!(
            failure(lab.scan(&request(&path, &["prop_lamp_a"]))),
            (
                "InvalidDataException".into(),
                "a.rpf: The identifier 58585858 did not match the expected value of 0x52504637"
                    .into()
            )
        );
        // архив без записей
        let empty = lab.archive("e.rpf", &top(Vec::new()));
        let done = lab.scan(&request(&empty, &["prop_lamp_a"])).unwrap();
        assert_eq!(done["entryCount"], 0);
        assert_eq!(done["ymapCount"], 0);
        assert_eq!(done["inventorySha256"], sha256_hex(b""));
        // хэш файла в ответе следует за самим файлом
        let again = lab.scan(&request(&archive, &["prop_lamp_a"])).unwrap();
        assert_eq!(again["archiveSha256"], sha_of(&archive));
    }

    #[test]
    fn a_non_finite_entity_in_the_map_skips_that_map_and_says_so() {
        let lab = Lab::new();
        let archive = lab.archive(
            "nan.rpf",
            &top(vec![resource(
                "m.ymap",
                &map_of(&[("prop_a", [f32::NAN, 0.0, 0.0], IDENTITY)]),
            )]),
        );
        // Раньше такая карта роняла всю опись; теперь она пропускается и называется в parseErrors.
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        assert_eq!(done["occurrences"], json!([]));
        assert_eq!(done["complete"], false);
        assert_eq!(done["status"], "incomplete");
        assert_eq!(
            done["parseErrors"],
            json!([{"entry": "m.ymap", "error": "Поворот или масштаб сущности не конечны"}])
        );
        // чужая сущность с NaN не мешает
        let archive = lab.archive(
            "nan-other.rpf",
            &top(vec![resource(
                "m.ymap",
                &map_of(&[
                    ("prop_b", [f32::NAN, 0.0, 0.0], IDENTITY),
                    ("prop_a", [1.0, 0.0, 0.0], IDENTITY),
                ]),
            )]),
        );
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        assert_eq!(done["occurrences"].as_array().unwrap().len(), 1);
        assert_eq!(done["occurrences"][0]["entityIndex"], 1);
    }

    #[test]
    fn inventory_follows_the_case_insensitive_order() {
        let lab = Lab::new();
        let archive = lab.archive(
            "case.rpf",
            &folder(
                "",
                vec![
                    folder("a", Vec::new(), vec![stored("B.txt", b"1")]),
                    folder("A", Vec::new(), vec![stored("z.txt", b"2")]),
                ],
                vec![
                    stored("A.txt", b"3"),
                    stored("a.txt", b"4"),
                    stored("b.txt", b"5"),
                    stored("Я.txt", b"6"),
                ],
            ),
        );
        let done = lab.scan(&request(&archive, &["prop_a"])).unwrap();
        // порядок обхода: файлы корня по оглавлению, затем подкаталоги; равные без учёта регистра остаются в нём
        let mut walked = ["A.txt", "a.txt", "b.txt", "Я.txt", "A/z.txt", "a/B.txt"];
        walked.sort_by(|left, right| ordinal_ignore_case(left, right));
        assert_eq!(
            done["inventorySha256"],
            sha256_hex(walked.join("\n").as_bytes())
        );
        assert_eq!(done["entryCount"], 6);
    }
}
