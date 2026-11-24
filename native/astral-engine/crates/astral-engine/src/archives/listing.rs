//! Команды `read-archive-file` (одна запись архива в файл) и
//! `list-archive-entries` (список записей архива, при желании в файл).

use std::fs;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind};
use serde_json::{Map, Value};

use super::{game_root, load_keys, resolve_root_archive, sha256_hex, strip_archive_prefix};
use crate::args::Options;
use crate::error::{EngineError, Result};
use crate::paths::{full_path, inside, normalize_relative};
use crate::progress::Progress;

/// Наибольшая запись, которую команда отдаёт файлом: 32 МиБ.
const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;

/// Объект JSON из пар «ключ, значение»; порядок ключей — порядок записи.
fn object<const N: usize>(fields: [(&str, Value); N]) -> Map<String, Value> {
    fields
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

/// Корневой архив команды, найденный в папке игры.
struct Located<'o> {
    options: &'o Options,
    name: String,
    file: PathBuf,
}

impl Located<'_> {
    /// Ключи и открытый архив; вторая часть — метка источника ключей.
    fn open(&self) -> Result<(Archive, &'static str)> {
        let (keys, source) = load_keys(
            self.options.optional("game-root").unwrap_or_default(),
            self.options.optional("keys"),
        )?;
        Ok((Archive::open_path(&self.file, Some(keys))?, source))
    }
}

/// Общая подготовка обеих команд: папка игры, имя корневого архива (его даёт
/// `name_of`) и сам файл архива в папке игры.
fn locate<'o>(
    options: &'o Options,
    name_of: impl FnOnce(&Options) -> Result<String>,
) -> Result<Located<'o>> {
    let game = game_root(options)?;
    let name = name_of(options)?;
    let file = find_archive(&game, &name)?;
    Ok(Located {
        options,
        name,
        file,
    })
}

fn find_archive(game: &Path, relative: &str) -> Result<PathBuf> {
    let file = inside(&game.to_string_lossy(), relative)?;
    file.is_file()
        .then_some(file)
        .ok_or_else(|| EngineError::file_not_found(format!("Archive was not found: {relative}")))
}

fn is_binary(archive: &Archive, id: EntryId) -> bool {
    matches!(archive.entry(id).kind, EntryKind::Binary(_))
}

/// Положение в архиве при спуске по пути записи.
struct Cursor {
    archive: Archive,
    directory: EntryId,
}

impl Cursor {
    fn at_root(archive: Archive) -> Self {
        let directory = archive.root();
        Self { archive, directory }
    }

    /// Следующее звено пути. Каталог побеждает вложенный архив с тем же
    /// именем; раскрывается только двоичная запись. `None` — такого нет.
    fn enter(self, segment: &str) -> Result<Option<Cursor>> {
        if let Some(child) = self.archive.find_dir(self.directory, segment) {
            return Ok(Some(Cursor {
                directory: child,
                ..self
            }));
        }
        let nested = Archive::is_nested_archive_name(segment)
            .then(|| self.archive.find_file(self.directory, segment))
            .flatten()
            .filter(|&id| is_binary(&self.archive, id));
        match nested {
            Some(id) => Ok(Some(Cursor::at_root(self.archive.open_nested(id)?))),
            None => Ok(None),
        }
    }
}

/// Спускается по пути записи и отдаёт настоящие байты последнего звена,
/// которое всегда файл.
fn read_entry(root: Archive, path: &str, entry: &str) -> Result<Vec<u8>> {
    let missing = || EngineError::file_not_found(format!("Archive entry was not found: {entry}"));
    let too_large =
        || EngineError::invalid_data(format!("Archive entry is too large to read: {entry}"));

    let segments: Vec<&str> = path.split('/').collect();
    let Some((file_name, folders)) = segments.split_last() else {
        return Err(missing());
    };
    let mut cursor = Cursor::at_root(root);
    for segment in folders {
        cursor = cursor.enter(segment)?.ok_or_else(missing)?;
    }

    let Cursor { archive, directory } = cursor;
    let id = archive
        .find_file(directory, file_name)
        .ok_or_else(missing)?;
    let declared = match &archive.entry(id).kind {
        EntryKind::Binary(info) => u64::from(info.uncompressed_size),
        _ => 0,
    };
    if declared > MAX_READ_BYTES {
        return Err(too_large());
    }
    let bytes = archive.decode(id, EntryCipher::ByArchive)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

pub fn read_archive_file(options: &Options, _progress: &Progress) -> Result<Value> {
    let located = locate(options, |opts| {
        let entry = opts.required("entry")?;
        resolve_root_archive(entry)?
            .ok_or_else(|| EngineError::argument(format!("Unsupported archive entry: {entry}")))
    })?;
    let entry = options.required("entry")?;
    // Запись уходит в файл, и имя файла вызывающий нередко берёт из имени записи
    // (`rpf-composer.js`, чтение записей хостом). Поэтому имя записи здесь
    // проверяется правилом диска, а не мягким правилом дерева архива.
    let inner_path = normalize_relative(&strip_archive_prefix(entry))?;

    let output = full_path(options.required("output")?)?;

    let (archive, key_source) = located.open()?;
    let bytes = read_entry(archive, &inner_path, entry)?;
    // Папка выхода появляется, только когда есть что в неё класть.
    if let Some(folder) = output.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::write(&output, &bytes)?;

    Ok(Value::Object(object([
        ("entry", Value::from(entry)),
        ("archive", Value::from(located.name.as_str())),
        ("output", Value::from(output.to_string_lossy())),
        ("bytes", Value::from(bytes.len())),
        ("sha256", Value::from(sha256_hex(&bytes).to_uppercase())),
        ("keySource", Value::from(key_source)),
    ])))
}

/// Целое из опции в пределах `span`: число вне пределов сжимается к ним, нет
/// опции - `fallback`, а не число - отказ.
fn int_setting(
    options: &Options,
    name: &str,
    fallback: i32,
    span: RangeInclusive<i32>,
) -> Result<usize> {
    let value = match options.optional(name) {
        None => i64::from(fallback),
        Some(text) => text.trim().parse::<i64>().map_err(|_| {
            EngineError::argument(format!("--{name} must be a whole number."))
        })?,
    };
    let value = value.clamp(i64::from(*span.start()), i64::from(*span.end()));
    Ok(usize::try_from(value).unwrap_or_default())
}

/// Каталог архива в обходе и место, где обход в нём остановился.
struct Frame {
    archive: Rc<Archive>,
    directory: EntryId,
    prefix: String,
    depth: usize,
    next_file: usize,
    next_dir: usize,
}

impl Frame {
    fn open(archive: Rc<Archive>, directory: EntryId, prefix: String, depth: usize) -> Self {
        Self {
            archive,
            directory,
            prefix,
            depth,
            next_file: 0,
            next_dir: 0,
        }
    }
}

/// Что делать обходу после очередного шага.
enum Move {
    Stay,
    Enter(Frame),
    Leave,
    Halt,
}

/// Список записей: фильтр, пределы и набранное.
struct Tally {
    filter: String,
    capacity: usize,
    depth_limit: usize,
    rows: Vec<(String, u64)>,
    overflowed: bool,
}

impl Tally {
    fn admits(&self, path: &str) -> bool {
        self.filter.is_empty() || path.to_lowercase().contains(&self.filter)
    }

    /// Обход без рекурсии: файлы каталога по порядку, затем подкаталоги.
    /// `prefix` пуст или оканчивается на `/`.
    fn collect(&mut self, root: Archive) {
        let root = Rc::new(root);
        let directory = root.root();
        let mut stack = vec![Frame::open(root, directory, String::new(), 0)];
        while let Some(frame) = stack.last_mut() {
            let archive = Rc::clone(&frame.archive);
            let step = if let Some(&id) = archive.files(frame.directory).get(frame.next_file) {
                frame.next_file += 1;
                self.file(&archive, id, &frame.prefix, frame.depth)
            } else if let Some(&child) = archive.dirs(frame.directory).get(frame.next_dir) {
                frame.next_dir += 1;
                let prefix = format!("{}{}/", frame.prefix, archive.entry(child).name);
                Move::Enter(Frame::open(Rc::clone(&archive), child, prefix, frame.depth))
            } else {
                Move::Leave
            };
            match step {
                Move::Stay => {}
                Move::Enter(next) => stack.push(next),
                Move::Leave => {
                    stack.pop();
                }
                Move::Halt => return,
            }
        }
    }

    fn file(&mut self, archive: &Archive, id: EntryId, prefix: &str, depth: usize) -> Move {
        let name = &archive.entry(id).name;
        let path = [prefix, name].concat();
        // Вложенный по имени архив раскрывается и сам в список не попадает.
        let opens = Archive::is_nested_archive_name(name) && depth < self.depth_limit;

        if !opens && self.admits(&path) {
            if self.rows.len() >= self.capacity {
                self.overflowed = true;
                return Move::Halt;
            }
            self.rows.push((path.clone(), archive.listing_size(id)));
        }
        if opens && is_binary(archive, id) {
            // Не открывшийся архив молча пропускается.
            if let Ok(inner) = archive.open_nested(id) {
                let inner = Rc::new(inner);
                let root = inner.root();
                return Move::Enter(Frame::open(inner, root, format!("{path}/"), depth + 1));
            }
        }
        Move::Stay
    }

    /// Первые четыре поля ответа и файла списка.
    fn summary(&self, archive: &str, filter: &str) -> Map<String, Value> {
        object([
            ("archive", Value::from(archive)),
            ("filter", Value::from(filter)),
            ("truncated", Value::from(self.overflowed)),
            ("count", Value::from(self.rows.len())),
        ])
    }

    fn entries(&self) -> Value {
        Value::Array(
            self.rows
                .iter()
                .map(|(path, size)| {
                    Value::Object(object([
                        ("path", Value::from(path.as_str())),
                        ("size", Value::from(*size)),
                    ]))
                })
                .collect(),
        )
    }
}

pub fn list_archive_entries(options: &Options, _progress: &Progress) -> Result<Value> {
    let located = locate(options, |opts| {
        normalize_relative(opts.required("archive")?)
    })?;

    let filter = options.optional("filter").unwrap_or_default().trim();
    let output = options
        .optional("output")
        .filter(|path| !path.trim().is_empty());
    let mut tally = Tally {
        filter: filter.to_lowercase(),
        capacity: int_setting(options, "max-entries", 4000, 1..=1_000_000)?,
        depth_limit: int_setting(options, "depth", 3, 0..=6)?,
        rows: Vec::new(),
        overflowed: false,
    };

    let (archive, _) = located.open()?;
    tally.collect(archive);

    let mut answer = tally.summary(&located.name, filter);
    match output {
        None => {
            answer.insert("entries".to_owned(), tally.entries());
        }
        Some(path) => {
            let path = full_path(path)?;
            let mut document = answer.clone();
            document.insert("entries".to_owned(), tally.entries());
            if let Some(folder) = path.parent() {
                fs::create_dir_all(folder)?;
            }
            fs::write(&path, Value::Object(document).to_string())?;
            answer.insert("output".to_owned(), Value::from(path.to_string_lossy()));
        }
    }
    Ok(Value::Object(answer))
}
