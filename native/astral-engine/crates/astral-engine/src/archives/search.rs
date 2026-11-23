//! Команда `search-rpf`: поиск записей по подстроке пути или по началу имени
//! в архиве игры и во вложенных в него архивах. Команда только читает.

use std::fs;
use std::ops::RangeInclusive;
use std::rc::Rc;

use rage_rpf::{Archive, EntryId, EntryKind};
use serde_json::{Map, Value};

use super::load_keys;
use crate::args::Options;
use crate::error::{EngineError, Result};
use crate::paths;
use crate::progress::Progress;

const TERM_BYTE_LIMIT: usize = 240;

/// Объект JSON из пар «ключ, значение»; порядок ключей — порядок записи.
fn record<const N: usize>(fields: [(&str, Value); N]) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Подстрока пути, префиксы имён и пределы обхода после нормализации.
pub struct Selector {
    pub query: String,
    pub prefixes: Vec<String>,
    pub limit: usize,
    pub max_depth: usize,
}

/// Очищенные поисковые слова.
struct Terms {
    query: String,
    prefixes: Vec<String>,
}

impl Terms {
    /// Края обрезаны, пустые префиксы выброшены, повторы (только ASCII-регистр)
    /// убраны с сохранением первого написания.
    fn tidy(query: &str, prefixes: &[String]) -> Self {
        let prefixes = prefixes
            .iter()
            .map(|prefix| prefix.trim())
            .filter(|prefix| !prefix.is_empty())
            .fold(Vec::<String>::new(), |mut kept, prefix| {
                if !kept.iter().any(|seen| seen.eq_ignore_ascii_case(prefix)) {
                    kept.push(prefix.to_owned());
                }
                kept
            });
        Self {
            query: query.trim().to_owned(),
            prefixes,
        }
    }

    fn acceptable(&self) -> bool {
        let short_enough = |term: &String| term.len() <= TERM_BYTE_LIMIT;
        short_enough(&self.query)
            && self.prefixes.iter().all(short_enough)
            && !(self.query.is_empty() && self.prefixes.is_empty())
    }
}

/// Значение в заданных пределах; нет значения — `fallback`.
fn bounded(value: Option<i64>, fallback: i64, span: RangeInclusive<i64>) -> usize {
    let value = value.unwrap_or(fallback).clamp(*span.start(), *span.end());
    // Пределы неотрицательны, знак потерять нельзя.
    usize::try_from(value).unwrap_or_default()
}

impl Selector {
    pub fn new(
        query: &str,
        prefixes: &[String],
        max_matches: Option<i64>,
        max_depth: Option<i64>,
    ) -> Result<Self> {
        let terms = Terms::tidy(query, prefixes);
        if !terms.acceptable() {
            return Err(EngineError::invalid_data("Invalid RPF search selector."));
        }
        Ok(Self {
            query: terms.query,
            prefixes: terms.prefixes,
            limit: bounded(max_matches, 1000, 1..=5000),
            max_depth: bounded(max_depth, 12, 0..=24),
        })
    }
}

/// Совпавшие записи и вложенные архивы, которые не открылись.
#[derive(Default)]
pub struct Found {
    pub matches: Vec<Value>,
    pub unreadable: Vec<Value>,
}

/// Архив обхода: корневой взаймы или вложенный в общем владении (подкаталоги
/// делят архив с родителем).
#[derive(Clone)]
enum Held<'a> {
    Lent(&'a Archive),
    Shared(Rc<Archive>),
}

impl Held<'_> {
    fn archive(&self) -> &Archive {
        match self {
            Held::Lent(archive) => archive,
            Held::Shared(archive) => archive,
        }
    }
}

/// Каталог в обходе и место, где обход в нём остановился.
struct Frame<'a> {
    source: Held<'a>,
    directory: EntryId,
    prefix: String,
    depth: usize,
    next_file: usize,
    next_dir: usize,
}

impl<'a> Frame<'a> {
    fn open(source: Held<'a>, directory: EntryId, prefix: String, depth: usize) -> Self {
        Self {
            source,
            directory,
            prefix,
            depth,
            next_file: 0,
            next_dir: 0,
        }
    }
}

/// Что делать обходу после очередного шага.
enum Move<'a> {
    Stay,
    Enter(Frame<'a>),
    Leave,
    Halt,
}

/// Правила совпадения и пределы одного обхода.
struct Scan<'f> {
    query: String,
    prefixes: Vec<String>,
    limit: usize,
    max_depth: usize,
    found: &'f mut Found,
    /// Сколько нечитаемых вложенных архивов было к моменту последнего
    /// разрешённого совпадения: всё, что найдено после него, в ответ не идёт.
    unreadable_at_limit: Option<usize>,
}

impl<'f> Scan<'f> {
    fn for_selector(selector: &Selector, found: &'f mut Found) -> Self {
        Self {
            query: selector.query.to_lowercase(),
            prefixes: selector.prefixes.iter().map(|p| p.to_lowercase()).collect(),
            limit: selector.limit,
            max_depth: selector.max_depth,
            found,
            unreadable_at_limit: None,
        }
    }

    fn selects(&self, path: &str, name: &str) -> bool {
        if !self.query.is_empty() && path.to_lowercase().contains(&self.query) {
            return true;
        }
        let name = name.to_lowercase();
        self.prefixes
            .iter()
            .any(|prefix| name.starts_with(prefix.as_str()))
    }

    /// Обход без рекурсии: файлы каталога по очереди (вложенный архив
    /// раскрывается сразу после своей записи), затем подкаталоги.
    fn run(&mut self, first: Frame<'_>) -> bool {
        let mut stack = vec![first];
        while let Some(frame) = stack.last_mut() {
            let source = frame.source.clone();
            let archive = source.archive();
            let step = if let Some(&id) = archive.files(frame.directory).get(frame.next_file) {
                frame.next_file += 1;
                self.file(archive, id, &frame.prefix, frame.depth)
            } else if let Some(&child) = archive.dirs(frame.directory).get(frame.next_dir) {
                frame.next_dir += 1;
                let prefix = extend(&frame.prefix, &archive.entry(child).name);
                Move::Enter(Frame::open(source.clone(), child, prefix, frame.depth))
            } else {
                Move::Leave
            };
            match step {
                Move::Stay => {}
                Move::Enter(next) => stack.push(next),
                Move::Leave => {
                    stack.pop();
                }
                Move::Halt => return true,
            }
        }
        false
    }

    fn file<'a>(&mut self, archive: &Archive, id: EntryId, prefix: &str, depth: usize) -> Move<'a> {
        let entry = archive.entry(id);
        let path = extend(prefix, &entry.name);

        if self.selects(&path, &entry.name) {
            let kind = if matches!(entry.kind, EntryKind::Resource(_)) {
                "resource"
            } else {
                "binary"
            };
            self.found.matches.push(record([
                ("entry", Value::from(path.as_str())),
                ("name", Value::from(entry.name.as_str())),
                ("size", Value::from(archive.listing_size(id))),
                ("kind", Value::from(kind)),
            ]));
            // Ответ усечён, только если совпадение нашлось за пределом: на
            // последнем разрешённом обход идёт дальше и ищет ещё одно.
            let count = self.found.matches.len();
            if count == self.limit {
                self.unreadable_at_limit = Some(self.found.unreadable.len());
            } else if count > self.limit {
                return Move::Halt;
            }
        }

        let opens = depth < self.max_depth
            && matches!(entry.kind, EntryKind::Binary(_))
            && is_nested_name(&entry.name);
        if !opens {
            return Move::Stay;
        }
        match archive.open_nested(id) {
            Ok(inner) => {
                let inner = Rc::new(inner);
                let root = inner.root();
                Move::Enter(Frame::open(Held::Shared(inner), root, path, depth + 1))
            }
            Err(error) => {
                self.found.unreadable.push(record([
                    ("entry", Value::from(path)),
                    ("error", Value::from(error.to_string())),
                ]));
                Move::Stay
            }
        }
    }
}

fn extend(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_owned()
    } else {
        [prefix, "/", name].concat()
    }
}

fn is_nested_name(name: &str) -> bool {
    name.len() >= 4 && name.as_bytes()[name.len() - 4..].eq_ignore_ascii_case(b".rpf")
}

/// Обходит каталог архива и вложенные архивы, дописывая найденное в `found`.
/// Возвращает `true`, если совпадений больше предела: лишнее и найденное
/// после последнего разрешённого совпадения в `found` не попадает.
pub fn walk(
    archive: &Archive,
    directory: EntryId,
    prefix: &str,
    selector: &Selector,
    found: &mut Found,
    depth: usize,
) -> bool {
    let first = Frame::open(Held::Lent(archive), directory, prefix.to_owned(), depth);
    let mut scan = Scan::for_selector(selector, found);
    let exceeded = scan.run(first);
    let unreadable_kept = scan.unreadable_at_limit;
    if exceeded {
        found.matches.truncate(selector.limit);
        if let Some(kept) = unreadable_kept {
            found.unreadable.truncate(kept);
        }
    }
    exceeded
}

/// Как читается поле файла запроса.
#[derive(Clone, Copy)]
enum Shape {
    Text,
    Texts,
    Integer,
}

enum Reading {
    Text(Option<String>),
    Texts(Vec<String>),
    Integer(Option<i64>),
}

/// Поля запроса по порядку: имя и способ чтения.
const REQUEST_FIELDS: [(&str, Shape); 5] = [
    ("baseArchive", Shape::Text),
    ("query", Shape::Text),
    ("prefixes", Shape::Texts),
    ("maxMatches", Shape::Integer),
    ("maxNestedDepth", Shape::Integer),
];

fn read_field(fields: &Map<String, Value>, name: &str, shape: Shape) -> Reading {
    let value = fields.get(name);
    match shape {
        Shape::Text => Reading::Text(value.and_then(Value::as_str).map(str::to_owned)),
        Shape::Texts => Reading::Texts(
            value
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        ),
        Shape::Integer => Reading::Integer(value.and_then(Value::as_i64)),
    }
}

/// Файл запроса команды.
struct Request {
    base_archive: String,
    query: String,
    prefixes: Vec<String>,
    max_matches: Option<i64>,
    max_depth: Option<i64>,
}

impl Request {
    fn load(options: &Options) -> Result<Self> {
        let path = paths::full_path(options.required("request")?)?;
        let text = fs::read_to_string(path)?;
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        let root: Value = serde_json::from_str(text)
            .map_err(|_| EngineError::invalid_data("RPF request is not JSON."))?;
        match root {
            Value::Object(fields) => Self::from_fields(&fields),
            _ => Err(EngineError::invalid_data("RPF request is not an object.")),
        }
    }

    fn from_fields(fields: &Map<String, Value>) -> Result<Self> {
        let readings: Vec<Reading> = REQUEST_FIELDS
            .iter()
            .map(|&(name, shape)| read_field(fields, name, shape))
            .collect();
        let Ok(
            [Reading::Text(base), Reading::Text(query), Reading::Texts(prefixes), Reading::Integer(max_matches), Reading::Integer(max_depth)],
        ) = <[Reading; 5]>::try_from(readings)
        else {
            unreachable!("таблица полей и разбор согласованы");
        };
        let base_archive =
            base.ok_or_else(|| EngineError::argument("RPF base archive is required."))?;
        Ok(Self {
            base_archive,
            query: query.unwrap_or_default(),
            prefixes,
            max_matches,
            max_depth,
        })
    }
}

pub fn search_rpf(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = Request::load(options)?;
    let selector = Selector::new(
        &request.query,
        &request.prefixes,
        request.max_matches,
        request.max_depth,
    )?;

    let base = paths::existing_file(&request.base_archive, &[".rpf"])?;
    let (key_set, key_source) = load_keys(
        options.optional("game-root").unwrap_or_default(),
        options.optional("keys"),
    )?;
    let archive = Archive::open_path(&base, Some(key_set))?;

    let mut found = Found::default();
    let truncated = walk(&archive, archive.root(), "", &selector, &mut found, 0);
    // Режим зависит от того, откуда ключи на самом деле: каталог из `--keys`
    // и каталог из переменной окружения - один и тот же внешний источник.
    let key_mode = if key_source == "configured-key-directory" {
        "external-verified-local"
    } else {
        "game-executable"
    };

    Ok(record([
        ("status", Value::from("ready")),
        ("mode", Value::from("read-only")),
        ("query", Value::from(selector.query)),
        ("prefixes", Value::from(selector.prefixes)),
        ("matches", Value::Array(found.matches)),
        ("unreadable", Value::Array(found.unreadable)),
        ("truncated", Value::from(truncated)),
        ("keyMode", Value::from(key_mode)),
    ]))
}
