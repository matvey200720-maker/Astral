//! `read-workshop-textures`: листы мастерской блоками BCn из файлов игры и наборов (этап 2 «3D на Rust»).
//!
//! Движок отвечает на ту же просьбу, что читатель JS (`apps/desktop/src/workshop-textures.js`,
//! `readTextures`), и его ответ совпадает с JS байт в байт; спецификация — раздел 11 файла
//! `docs/perf/speed-3d-rust/asb1-format.md`. Ядро (годность листа, срезы уровней, хвост, одноцветный
//! блок, контейнер) — `rage_res::sheet_blocks`; здесь — чтение игры и наборов, пул потоков, сеанс
//! между пачками, кэш на диске и ответ.
//!
//! Вход — JSON: `--request <файл>` или `--request-json <текст>`. Ответ — `{ container, deferred }`
//! (`timings` — по просьбе): `container` — `{ sha256, bytes, store, url? }` контейнера ASB1 на пачку,
//! `deferred` — `[{ index, reason }]` листы, которые движок не отдаёт и должен сделать JS.
//! Контейнер забирается `GET /a/<sha256>` с канала данных: в резидентном процессе он лежит на полке в
//! памяти (`store: "memory"`, `shelf.rs`; отдан целиком — освобождён, не забран за 30 с — освобождён) и
//! файла не знает; `store: "file"` во входе, разовый запуск без канала и полная полка пишут его в
//! хранилище-папку (`--assets-dir`, иначе настройка резидентного процесса), как раньше (`store: "file"`
//! в ответе). `url` — полный адрес на 127.0.0.1, пока канал поднят.
//! Листы читаются пулом потоков (`threads` во входе, по умолчанию половина ядер); архивы и разобранные
//! ресурсы живут между пачками (`session`).

mod parents;
pub(crate) mod probe;
/// Читатель игры по адресу для сборщиков сцен (`build-world-place-scene`); интерьеры идут следом.
#[allow(dead_code)]
pub(crate) mod scene_reads;
pub(crate) mod session;
mod sheet_cache;

use std::collections::HashMap;
use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rage_res::drawable;
use rage_res::resource::Resource;
use rage_res::sheet_blocks::{self, Accept, MapKind, Record, Sheet};
use rage_res::texture::{self, TextureRef};
use serde_json::{json, Map, Value};

use self::parents::Search;
use self::probe::{Probe, Stage};
use self::session::{locked, Game, Lease, Loaded, Parsed};
use self::sheet_cache::{self as cache, SheetCache};
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    progress::Progress,
    readers::ars2,
    shelf::{deliver, Shelf},
};

const COMMAND_NAME: &str = "read-workshop-textures";
/// Записей в пачке не больше стольких: лишние отбрасываются (`MAX_REQUESTS` читателя).
const MAX_REQUESTS: usize = 96;
/// Запрос длиннее не принимается.
const MAX_REQUEST_BYTES: u64 = 4 * 1024 * 1024;
/// Стороны, до которых окно просит лист; иная становится 512.
const SIZES: [u32; 6] = [64, 128, 256, 512, 1024, 2048];
const SETS: [&str; 5] = ["zones", "factory", "hangar", "mapping", "arenas"];
const MODEL_EXTENSIONS: [&str; 4] = [".ydr", ".yft", ".ytd", ".ydd"];
/// Потолок потоков по умолчанию: пачка из десятков листов больше не ускоряется.
const MAX_THREADS: usize = 8;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

// ------------------------------------------------------------------ вход

/// Откуда лист: файл набора или файл игры (`метка:путь`).
#[derive(Clone, Debug, PartialEq, Eq)]
enum Source {
    Set { set: String, file: String },
    Game { location: String },
}

/// Запись `textures[i]` после приведения (`normalizeRequest` читателя).
#[derive(Clone, Debug, PartialEq, Eq)]
struct Item {
    source: Source,
    name: String,
    size: u32,
    map: Option<MapKind>,
    blocks: bool,
}

struct GameRoot {
    path: PathBuf,
    /// Приведённая строка папки игры (`path.resolve` читателя).
    text: String,
    lower: String,
}

struct Batch {
    game_root: Option<GameRoot>,
    keys: Option<String>,
    accept: Accept,
    items: Vec<Option<Item>>,
    set_roots: HashMap<String, PathBuf>,
    state_dir: Option<PathBuf>,
    timings: bool,
    /// Файлы кэша пишутся до ответа (проверки, разовый запуск); по умолчанию — без ожидания, после ответа.
    flush: bool,
    share: bool,
    over_mods: bool,
    threads: Option<usize>,
    /// `store: "file"`: контейнер пишется в хранилище-папку, а не кладётся на полку в памяти канала.
    to_file: bool,
}

/// `path.resolve` Node на Windows для абсолютного пути: обратные косые, без `.` и `..`, без хвостовой
/// косой. Относительный путь и путь без диска — `None` (игры нет).
pub(crate) fn resolve_root(text: &str) -> Option<String> {
    let flat = text.replace('/', "\\");
    let (root, rest) = if let Some(unc) = flat.strip_prefix("\\\\") {
        let mut parts = unc.splitn(3, '\\');
        let (server, share) = (parts.next()?, parts.next()?);
        if server.is_empty() || share.is_empty() {
            return None;
        }
        (
            format!("\\\\{server}\\{share}\\"),
            parts.next().unwrap_or(""),
        )
    } else {
        let bytes = flat.as_bytes();
        if bytes.len() < 3
            || !bytes[0].is_ascii_alphabetic()
            || bytes[1] != b':'
            || bytes[2] != b'\\'
        {
            return None;
        }
        (flat[..3].to_owned(), &flat[3..])
    };
    let mut kept: Vec<&str> = Vec::new();
    for part in rest.split('\\') {
        match part {
            "" | "." => {}
            ".." => {
                kept.pop();
            }
            other => kept.push(other),
        }
    }
    Some(format!("{root}{}", kept.join("\\")))
}

fn text_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn is_true(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Bool(true)))
}

/// Размер из списка `SIZES`, иначе 512 (`Number(item.size)` читателя).
fn size_of(value: Option<&Value>) -> u32 {
    let number = match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    };
    SIZES
        .into_iter()
        .find(|&size| number == Some(f64::from(size)))
        .unwrap_or(512)
}

fn class_ok(text: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&text.len())
        && text.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'_' | b'.' | b'+' | b'-')
        })
}

/// `[a-z0-9_+.-]{1,120}.(ydr|yft|ytd|ydd)`.
fn file_name_ok(text: &str) -> bool {
    MODEL_EXTENSIONS
        .iter()
        .find_map(|extension| text.strip_suffix(extension))
        .is_some_and(|stem| class_ok(stem, 1, 120))
}

/// Метка архива: `x64a.rpf`…`x64z.rpf`, `update`, `update/x64/dlcpacks/<пак>/dlc.rpf`.
fn label_ok(label: &str) -> bool {
    let bytes = label.as_bytes();
    if label == "update"
        || (bytes.len() == 8
            && label.starts_with("x64")
            && bytes[3].is_ascii_lowercase()
            && label.ends_with(".rpf"))
    {
        return true;
    }
    let Some(pack) = label
        .strip_prefix("update/x64/dlcpacks/")
        .and_then(|rest| rest.strip_suffix("/dlc.rpf"))
    else {
        return false;
    };
    (1..=40).contains(&pack.len())
        && pack
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// Место `метка:путь`: до двенадцати папок по 1…80 знаков и файл; без `.` и `..`.
fn location_ok(place: &str) -> bool {
    let Some((label, path)) = place.split_once(':') else {
        return false;
    };
    if !label_ok(label) {
        return false;
    }
    let parts: Vec<&str> = path.split('/').collect();
    let Some((file, folders)) = parts.split_last() else {
        return false;
    };
    folders.len() <= 12
        && folders.iter().all(|folder| class_ok(folder, 1, 80))
        && file_name_ok(file)
        && !parts.iter().any(|part| *part == ".." || *part == ".")
}

/// Запись `textures[i]` после приведения; `None` — не прошла (ответ `absent`).
fn normalize(value: &Value) -> Option<Item> {
    let object = value.as_object()?;
    let name = text_of(object.get("name")).to_lowercase();
    if !class_ok(&name, 1, 160) {
        return None;
    }
    let size = size_of(object.get("size"));
    let map = if is_true(object.get("normal")) {
        Some(MapKind::Normal)
    } else if is_true(object.get("specular")) {
        Some(MapKind::Specular)
    } else {
        None
    };
    let blocks = is_true(object.get("blocks"));
    let truthy_set = match object.get("set") {
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Null | Value::Bool(false)) | None => false,
        Some(Value::Number(number)) => number.as_f64() != Some(0.0),
        Some(_) => true,
    };
    if truthy_set {
        let set = text_of(object.get("set"));
        let file = text_of(object.get("file")).to_lowercase();
        let file_ok = match set.as_str() {
            "arenas" => ["gta5rp/", "majestic/"]
                .iter()
                .find_map(|folder| file.strip_prefix(folder))
                .is_some_and(file_name_ok),
            _ => file_name_ok(&file),
        };
        if !SETS.contains(&set.as_str()) || !file_ok {
            return None;
        }
        return Some(Item {
            source: Source::Set { set, file },
            name,
            size,
            map,
            blocks,
        });
    }
    let location = text_of(object.get("game"))
        .replace('\\', "/")
        .to_lowercase();
    location_ok(&location).then_some(Item {
        source: Source::Game { location },
        name,
        size,
        map,
        blocks,
    })
}

impl Batch {
    fn parse(body: &Value) -> Batch {
        let game_root = body
            .get("gameRoot")
            .and_then(Value::as_str)
            .map(str::trim)
            .and_then(resolve_root)
            .map(|text| GameRoot {
                path: PathBuf::from(&text),
                lower: text.to_lowercase(),
                text,
            });
        let keys = body
            .get("keys")
            .and_then(Value::as_str)
            .filter(|keys| !keys.is_empty())
            .map(str::to_owned);
        let accept = Accept::from_names(
            body.get("accept")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str),
        );
        let items = body
            .get("textures")
            .and_then(Value::as_array)
            .map(|list| list.iter().take(MAX_REQUESTS).map(normalize).collect())
            .unwrap_or_default();
        let set_roots = body
            .get("setRoots")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(set, root)| Some((set.clone(), PathBuf::from(root.as_str()?))))
            .collect();
        Batch {
            game_root,
            keys,
            accept,
            items,
            set_roots,
            state_dir: body
                .get("stateDir")
                .and_then(Value::as_str)
                .filter(|dir| !dir.is_empty())
                .map(PathBuf::from),
            timings: is_true(body.get("timings")),
            flush: is_true(body.get("flush")),
            share: !matches!(body.get("share"), Some(Value::Bool(false))),
            over_mods: is_true(body.get("overMods")),
            to_file: body.get("store").and_then(Value::as_str) == Some("file"),
            threads: body
                .get("threads")
                .and_then(Value::as_u64)
                .map(|count| count as usize),
        }
    }

    /// `<stateDir>/workshop-textures` (без папки состояния — временная, как у читателя).
    fn workshop_dir(&self) -> PathBuf {
        self.state_dir
            .clone()
            .unwrap_or_else(std::env::temp_dir)
            .join("workshop-textures")
    }
}

// ------------------------------------------------------------------ отпечаток источника и ключ кэша

/// `<размер>:<время>`; время — `Math.round(mtimeMs)`, где `mtimeMs = сек·1000 + нс/1e6` в f64 именно в таком порядке.
pub(crate) fn stamp_value(len: u64, seconds: u64, nanos: u32) -> String {
    let millis = (seconds as f64 * 1000.0 + f64::from(nanos) / 1_000_000.0 + 0.5).floor();
    format!("{len}:{}", millis as i64)
}

/// Отпечаток файла; нет файла или это не файл — `None`.
pub(crate) fn stamp_of_file(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok().filter(fs::Metadata::is_file)?;
    let since = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    Some(stamp_value(
        meta.len(),
        since.as_secs(),
        since.subsec_nanos(),
    ))
}

/// Файл архива по метке места (`update` — `update/update.rpf`, остальные — как есть).
fn archive_file(root: &Path, label: &str) -> PathBuf {
    if label == "update" {
        root.join("update").join("update.rpf")
    } else {
        root.join(label)
    }
}

fn label_of(location: &str) -> &str {
    location
        .split_once(':')
        .map_or(location, |(label, _)| label)
}

/// Ключ кэша: `<источник>|<имя>|<размер>|<отпечаток>[|<карта>]|<форматы>|bcn1` (раздел 11.5).
pub(crate) fn cache_key(
    source: &str,
    name: &str,
    size: u32,
    stamp: &str,
    map: Option<MapKind>,
    accept: Accept,
) -> String {
    let map = match map {
        Some(MapKind::Normal) => "|normal",
        Some(MapKind::Specular) => "|specular",
        None => "",
    };
    format!("{source}|{name}|{size}|{stamp}{map}|{}|bcn1", accept.key())
}

// ------------------------------------------------------------------ работа над записью

/// Чем кончилась запись.
enum Done {
    Absent,
    Unavailable,
    /// Лист отдаёт JS; причина — код отказа.
    Deferred(&'static str),
    Hit(cache::Hit),
    Blocks {
        record: Record,
        sheet: Sheet,
    },
}

enum Located {
    Found(Arc<Parsed>, usize),
    Absent,
    Unavailable,
}

struct Ctx<'a> {
    batch: &'a Batch,
    lease: &'a Lease,
    game: Option<Arc<Game>>,
    probe: &'a Probe,
    cache: Option<Arc<SheetCache>>,
    dir: PathBuf,
    stamps: Mutex<HashMap<String, Option<String>>>,
    budget: usize,
    threads: usize,
}

fn position(parsed: &Parsed, name: &str) -> Option<usize> {
    parsed
        .refs
        .iter()
        .position(|reference| reference.name.to_lowercase() == name)
}

/// Описания встроенных листов модели: у всех её частей по порядку.
fn model_refs(resource: &Resource) -> Result<Vec<TextureRef>> {
    let model = drawable::open_model(resource, None)?;
    let mut found = Vec::new();
    for entry in &model.entries {
        let (_, _, embedded) = drawable::read_materials(resource, entry.at)?;
        found.extend(embedded);
    }
    Ok(found)
}

/// Разбор ресурса: `.ytd` — словарь, остальное — встроенные листы модели. Не разобралось — пусто.
fn parse_resource(bytes: &[u8], dictionary: bool) -> Parsed {
    let Ok(resource) = Resource::parse(bytes) else {
        return Parsed::empty();
    };
    let refs = if dictionary {
        texture::read_dictionary(&resource).ok()
    } else {
        model_refs(&resource).ok()
    };
    match refs {
        Some(refs) if !refs.is_empty() => Parsed {
            resource: Some(resource),
            refs,
        },
        _ => Parsed::empty(),
    }
}

impl Ctx<'_> {
    /// Отпечаток источника записи; память на пачку.
    fn stamp(&self, source: &Source) -> Option<String> {
        let (key, path) = match source {
            Source::Set { set, file } => (
                format!("set:{set}/{file}"),
                self.batch.set_roots.get(set).map(|root| root.join(file)),
            ),
            Source::Game { location } => {
                let label = label_of(location);
                (
                    format!("game:{label}"),
                    self.batch
                        .game_root
                        .as_ref()
                        .map(|root| archive_file(&root.path, label)),
                )
            }
        };
        locked(&self.stamps)
            .entry(key)
            .or_insert_with(|| path.as_deref().and_then(stamp_of_file))
            .clone()
    }

    /// Источник в ключе кэша: `<набор>/<файл>` или `<папка игры в нижнем регистре>|<game>`.
    fn source_text(&self, source: &Source) -> String {
        match source {
            Source::Set { set, file } => format!("{set}/{file}"),
            Source::Game { location } => {
                let root = self
                    .batch
                    .game_root
                    .as_ref()
                    .map_or("", |root| root.lower.as_str());
                format!("{root}|{location}")
            }
        }
    }

    /// Чтение и разбор одного ресурса (набора или игры); отказ игры — отказ пачки.
    fn read_parsed(&self, source: &Source) -> Result<Loaded> {
        let began = Instant::now();
        let (bytes, dictionary) = match source {
            Source::Set { set, file } => {
                let root = self.batch.set_roots.get(set);
                (
                    root.and_then(|root| fs::read(root.join(file)).ok()),
                    file.ends_with(".ytd"),
                )
            }
            Source::Game { location } => {
                let game = self
                    .game
                    .as_ref()
                    .ok_or_else(|| EngineError::invalid_operation("Игры нет."))?;
                (game.read(location, self.probe)?, location.ends_with(".ytd"))
            }
        };
        let Some(bytes) = bytes else {
            self.probe.add(Stage::Read, began);
            return Ok(Loaded::Missing);
        };
        if bytes.len() > parents::MAX_RESOURCE_BYTES {
            self.probe.add(Stage::Read, began);
            return Ok(Loaded::Found(Arc::new(Parsed::empty())));
        }
        let parsed = parse_resource(&bytes, dictionary);
        self.probe.add(Stage::Read, began);
        Probe::count(&self.probe.loaded, 1);
        Probe::count(&self.probe.bytes, bytes.len() as u64);
        Ok(Loaded::Found(Arc::new(parsed)))
    }

    /// Разобранный ресурс источника: из таблицы сеанса или прочитанный; `None` — файла нет.
    fn resource(&self, source: &Source) -> Result<Option<Arc<Parsed>>> {
        let base = match source {
            Source::Set { set, file } => format!("set:{set}/{file}"),
            Source::Game { location } => format!("game:{location}"),
        };
        let loaded = match self.stamp(source) {
            Some(stamp) => {
                let (loaded, reused) = self
                    .lease
                    .resource(&base, &stamp, self.budget, || self.read_parsed(source))?;
                if reused {
                    Probe::count(&self.probe.reused, 1);
                }
                loaded
            }
            None => self.read_parsed(source)?,
        };
        Ok(match loaded {
            Loaded::Found(parsed) => Some(parsed),
            Loaded::Missing => None,
        })
    }

    fn parent(&self, location: &str, name: &str) -> Result<Option<String>> {
        let Some(root) = &self.batch.game_root else {
            return Ok(None);
        };
        let Some(game) = &self.game else {
            return Ok(None);
        };
        let stamp_of = |label: &str| stamp_of_file(&archive_file(&root.path, label));
        let search = Search {
            game: game.as_ref(),
            probe: self.probe,
            root_key: &root.lower,
            dir: &self.dir,
            stamp_of: &stamp_of,
            threads: self.threads,
        };
        parents::parent_location(&search, location, name)
    }

    /// Поиск листа: в собственном ресурсе, потом (у записи из игры) у родителей словаря.
    fn locate(&self, item: &Item) -> Result<Located> {
        if let Some(parsed) = self.resource(&item.source)? {
            if let Some(at) = position(&parsed, &item.name) {
                return Ok(Located::Found(parsed, at));
            }
        }
        let Source::Game { location } = &item.source else {
            return Ok(Located::Absent);
        };
        // Игра, что не открылась при поиске у родителей, — «недоступно», а не «листа нет».
        let searched = (|| -> Result<Option<(Arc<Parsed>, usize)>> {
            let Some(parent) = self.parent(location, &item.name)? else {
                return Ok(None);
            };
            let Some(parsed) = self.resource(&Source::Game { location: parent })? else {
                return Ok(None);
            };
            Ok(position(&parsed, &item.name).map(|at| (parsed, at)))
        })();
        Ok(match searched {
            Err(_) => Located::Unavailable,
            Ok(Some((parsed, at))) => Located::Found(parsed, at),
            Ok(None) => Located::Absent,
        })
    }

    /// Пункты 4–7 порядка работы над записью (раздел 11.3): кэш, поиск листа, план, блоки.
    fn work(&self, item: &Item, key: &str) -> Result<Done> {
        if let Some(cache) = &self.cache {
            let began = Instant::now();
            let hit = cache.get(key);
            self.probe.add(Stage::CacheRead, began);
            if let Some(hit) = hit {
                Probe::count(&self.probe.hits_blocks, 1);
                return Ok(Done::Hit(hit));
            }
        }
        let (parsed, at) = match self.locate(item)? {
            Located::Found(parsed, at) => (parsed, at),
            Located::Absent => return Ok(Done::Absent),
            Located::Unavailable => return Ok(Done::Unavailable),
        };
        let reference = &parsed.refs[at];
        let chosen = match sheet_blocks::plan(reference, item.size, self.batch.accept, item.map) {
            Ok(chosen) => chosen,
            Err(refusal) => return Ok(Done::Deferred(refusal.code())),
        };
        let began = Instant::now();
        let data = parsed.resource.as_ref().map_or(&[][..], Resource::data);
        let built = sheet_blocks::blocks(reference, data, &chosen)
            .and_then(|sheet| Record::blocks(&sheet, false).map(|record| (sheet, record)));
        self.probe.add(Stage::Blocks, began);
        let Ok((sheet, record)) = built else {
            return Ok(Done::Deferred("build"));
        };
        Ok(Done::Blocks { record, sheet })
    }
}

// ------------------------------------------------------------------ пачка

/// Правила сеанса; в работе — как у читателя JS, в проверках — свои.
#[derive(Clone)]
struct Settings {
    idle: Duration,
    budget: usize,
    /// Готовый набор ключей: у проверок нет папки ключей, в работе его нет.
    keys: Option<Arc<rage_rpf::KeySet>>,
    /// Полка ответов в памяти канала данных: в работе — полка боевого канала, без неё (разовый
    /// запуск, проверки) контейнер идёт в файл хранилища.
    shelf: Option<Arc<Shelf>>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            idle: session::IDLE,
            budget: session::BUDGET_BYTES,
            keys: None,
            shelf: None,
        }
    }
}

fn default_threads() -> usize {
    thread::available_parallelism()
        .map_or(1, |cores| cores.get() / 2)
        .clamp(1, MAX_THREADS)
}

/// Пункты 1–3 порядка работы: приведение, отпечаток источника, отложение без чтения ресурса.
enum First {
    Done(Done),
    Work(String),
}

fn first_steps(ctx: &Ctx<'_>, item: &Option<Item>) -> First {
    let Some(item) = item else {
        return First::Done(Done::Absent);
    };
    if matches!(item.source, Source::Game { .. }) && ctx.batch.game_root.is_none() {
        return First::Done(Done::Unavailable);
    }
    let Some(stamp) = ctx.stamp(&item.source) else {
        return First::Done(Done::Unavailable);
    };
    if !item.blocks {
        return First::Done(Done::Deferred("no-blocks"));
    }
    if ctx.batch.accept.is_empty() {
        return First::Done(Done::Deferred("accept"));
    }
    if item.map.is_some() {
        return First::Done(Done::Deferred("map"));
    }
    First::Work(cache_key(
        &ctx.source_text(&item.source),
        &item.name,
        item.size,
        &stamp,
        item.map,
        ctx.batch.accept,
    ))
}

fn slot(done: &Done) -> (Record, &[u8]) {
    match done {
        Done::Blocks { record, sheet } => (*record, &sheet.data),
        Done::Hit(hit) => (hit.record, hit.payload()),
        Done::Absent => (Record::absent(), &[]),
        Done::Unavailable | Done::Deferred(_) => (Record::unavailable(), &[]),
    }
}

fn run(batch: &Batch, settings: Settings, assets: &Path) -> Result<Value> {
    let began = Instant::now();
    if batch.over_mods {
        return Err(EngineError::invalid_operation(
            "overMods движок не читает: чёрный лист мода заменяет JS.",
        ));
    }
    let probe = Probe::default();
    // Тот же ключ, что у сборщиков сцен (`scene_reads`): их чтение делит с пачкой один сеанс.
    let session_key = scene_reads::session_key(
        batch
            .game_root
            .as_ref()
            .map_or("", |root| root.lower.as_str()),
        batch.keys.as_deref(),
    );
    let lease = session::lease(&session_key, batch.share, settings.idle);
    let dir = batch.workshop_dir();
    let game = batch.game_root.as_ref().map(|root| {
        lease.game(
            &root.path,
            &root.text,
            batch.keys.as_deref(),
            settings.keys.clone(),
        )
    });
    let threads = batch.threads.unwrap_or_else(default_threads).max(1);
    // Папка кэша блоков создаётся только тогда, когда пришла первая запись с блоками.
    let wants_blocks = !batch.accept.is_empty()
        && batch
            .items
            .iter()
            .flatten()
            .any(|item| item.blocks && item.map.is_none());
    let ctx = Ctx {
        batch,
        lease: &lease,
        game,
        probe: &probe,
        cache: wants_blocks.then(|| cache::open(&dir.join(cache::FOLDER))),
        dir: dir.clone(),
        stamps: Mutex::new(HashMap::new()),
        budget: settings.budget,
        threads,
    };

    let count = batch.items.len();
    let mut results: Vec<Option<Arc<Done>>> = vec![None; count];
    // Записи с одним ключом читаются один раз: ответ зависит от запроса, а не от соседей по пачке.
    let mut leaders: Vec<(usize, String)> = Vec::new();
    let mut followers: Vec<(usize, usize)> = Vec::new();
    let mut by_key: HashMap<String, usize> = HashMap::new();
    for (index, item) in batch.items.iter().enumerate() {
        match first_steps(&ctx, item) {
            First::Done(done) => results[index] = Some(Arc::new(done)),
            First::Work(key) => match by_key.get(&key) {
                Some(&leader) => followers.push((index, leader)),
                None => {
                    by_key.insert(key.clone(), index);
                    leaders.push((index, key));
                }
            },
        }
    }

    let slots: Vec<Mutex<Option<Arc<Done>>>> = (0..count).map(|_| Mutex::new(None)).collect();
    let failure: Mutex<Option<EngineError>> = Mutex::new(None);
    let next = AtomicUsize::new(0);
    let worker = || loop {
        if locked(&failure).is_some() {
            break;
        }
        let Some((index, key)) = leaders.get(next.fetch_add(1, Relaxed)) else {
            break;
        };
        let Some(item) = &batch.items[*index] else {
            continue;
        };
        let guarded = panic::catch_unwind(AssertUnwindSafe(|| ctx.work(item, key)));
        match guarded {
            Ok(Ok(done)) => *locked(&slots[*index]) = Some(Arc::new(done)),
            Ok(Err(error)) => *locked(&failure) = Some(error),
            // Паника на одном листе не роняет пачку: лист сделает JS.
            Err(_) => *locked(&slots[*index]) = Some(Arc::new(Done::Deferred("build"))),
        }
    };
    let workers = threads.min(leaders.len()).max(1);
    if workers == 1 {
        worker();
    } else {
        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(worker);
            }
        });
    }
    if let Some(error) = locked(&failure).take() {
        return Err(error);
    }
    for (index, _) in &leaders {
        results[*index] = locked(&slots[*index]).take();
    }
    for (follower, leader) in followers {
        results[follower] = results[leader].clone();
    }

    let done: Vec<Arc<Done>> = results
        .into_iter()
        .map(|result| result.unwrap_or_else(|| Arc::new(Done::Unavailable)))
        .collect();
    let mut deferred = Vec::new();
    for (index, one) in done.iter().enumerate() {
        match &**one {
            Done::Absent | Done::Unavailable => Probe::count(&probe.sheets_refused, 1),
            Done::Deferred(reason) => {
                Probe::count(&probe.sheets_deferred, 1);
                deferred.push(json!({ "index": index, "reason": reason }));
            }
            Done::Hit(hit) => {
                Probe::count(&probe.sheets_cached, 1);
                Probe::count(
                    if hit.record.kind == sheet_blocks::kind::BCN {
                        &probe.sheets_blocks
                    } else {
                        &probe.sheets_webp
                    },
                    1,
                );
            }
            Done::Blocks { .. } => Probe::count(&probe.sheets_blocks, 1),
        }
    }
    let items: Vec<(Record, &[u8])> = done.iter().map(|one| slot(one)).collect();
    let container = sheet_blocks::pack(&items);
    let delivery = deliver(container, batch.to_file, settings.shelf.as_ref(), assets)?;

    // Файлы кэша: записи блоков, посчитанные в этой пачке (по одной на ключ).
    let puts: Vec<(String, Arc<Done>)> = leaders
        .iter()
        .filter(|(index, _)| matches!(&*done[*index], Done::Blocks { .. }))
        .map(|(index, key)| (key.clone(), Arc::clone(&done[*index])))
        .collect();
    Probe::count(&probe.puts_blocks, puts.len() as u64);
    let mut background = None;
    if let Some(cache) = ctx.cache.clone().filter(|_| !puts.is_empty()) {
        if batch.flush {
            let began = Instant::now();
            write_puts(&cache, &puts);
            probe.add(Stage::Puts, began);
        } else {
            background = Some((cache, puts));
        }
    }

    let mut answer = Map::new();
    answer.insert("container".to_owned(), delivery.json());
    answer.insert("deferred".to_owned(), Value::Array(deferred));
    let wanted_line = std::env::var("ASTRAL_SHEETS_TIMINGS").is_ok_and(|value| value == "1");
    let report = (batch.timings || wanted_line).then(|| {
        let wall = u64::try_from(began.elapsed().as_millis()).unwrap_or(u64::MAX);
        probe.report(batch.share, count, wall, workers)
    });
    if let (true, Some(report)) = (batch.timings, &report) {
        answer.insert("timings".to_owned(), report.clone());
    }
    let line = report
        .filter(|_| wanted_line)
        .map(|report| (dir.clone(), report));
    match background {
        // Без ожидания, как у читателя: ответ уходит, файлы кэша пишутся следом; их время (`cache.putsMs`)
        // известно позже и попадает только в строку `timings.jsonl`.
        Some((cache, puts)) => {
            let writer = thread::spawn(move || {
                let began = Instant::now();
                write_puts(&cache, &puts);
                if let Some((dir, mut report)) = line {
                    let spent = u64::try_from(began.elapsed().as_millis()).unwrap_or(u64::MAX);
                    report["cache"]["putsMs"] = json!(spent);
                    write_timings_line(&dir, &report);
                }
            });
            #[cfg(test)]
            locked(&WRITERS).push(writer);
            #[cfg(not(test))]
            drop(writer);
        }
        None => {
            if let Some((dir, report)) = &line {
                write_timings_line(dir, report);
            }
        }
    }
    Ok(Value::Object(answer))
}

/// Пишет файлы кэша для записей блоков; сбой диска — не ошибка.
fn write_puts(cache: &SheetCache, puts: &[(String, Arc<Done>)]) {
    for (key, done) in puts {
        if let Done::Blocks { record, sheet } = &**done {
            cache.put(key, record, &sheet.data);
        }
    }
}

/// Для проверок: потоки, что пишут файлы кэша после ответа.
#[cfg(test)]
static WRITERS: Mutex<Vec<thread::JoinHandle<()>>> = Mutex::new(Vec::new());

/// Для проверок: дождаться записи файлов кэша, начатой после ответов.
#[cfg(test)]
fn settle_writers() {
    let handles: Vec<_> = locked(&WRITERS).drain(..).collect();
    for handle in handles {
        handle.join().unwrap();
    }
}

/// Строка `timings.jsonl` в папке листов: без ожидания и без падения на ошибке диска.
fn write_timings_line(dir: &Path, report: &Value) {
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64);
    let mut line = Map::new();
    line.insert("at".to_owned(), json!(at));
    line.insert("pid".to_owned(), json!(std::process::id()));
    if let Value::Object(fields) = report {
        line.extend(fields.clone());
    }
    cache::append_line(&dir.join("timings.jsonl"), &Value::Object(line).to_string());
}

// ------------------------------------------------------------------ команда

fn request_body(options: &Options) -> Result<Value> {
    let text = match options.optional("request-json") {
        Some(inline) => inline.to_owned(),
        None => {
            let path = crate::paths::full_path(options.required("request")?)?;
            if fs::metadata(&path).map_err(EngineError::from)?.len() > MAX_REQUEST_BYTES {
                return Err(bad("Запрос read-workshop-textures слишком велик."));
            }
            fs::read_to_string(&path).map_err(EngineError::from)?
        }
    };
    text.trim_start_matches('\u{feff}')
        .parse()
        .map_err(|_| bad("Запрос read-workshop-textures — не JSON."))
}

fn read_workshop_textures(options: &Options, _progress: &Progress) -> Result<Value> {
    let batch = Batch::parse(&request_body(options)?);
    let settings = Settings {
        shelf: crate::shelf::production(),
        ..Settings::default()
    };
    run(&batch, settings, &ars2::assets_dir(options))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, read_workshop_textures)];

#[cfg(test)]
mod tests;
