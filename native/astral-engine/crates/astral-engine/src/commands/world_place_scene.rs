//! `build-world-place-scene`: сцена места мира для 3D-кадра (то, что собирает `readWorldPlaceScene` в `apps/desktop/src/world-place-scene.js`) — движком, в пуле потоков.
//!
//! Запрос (`--request <файл>` или `--request-json`): `{ origin, reach, plan?, top?, outline?, outlineZones?, zonesRoot?, gameRoot, keys?, indexFile, stamps?, tableFile, cacheFile, threads?, level? }`.
//! Просьбу уже проверило окно (`placeRequest`); оглавление игры строит и держит JS (`openGameIndex`: файл `indexFile` с архивами, записями и списками монтируемого, порядок
//! старшинства здесь пересчитывается теми же правилами); `stamps` — отпечатки архивов игры сейчас (`{ метка: "размер:время" }`): не совпали с файлом — ответ `{ stale: true }`,
//! оболочка обновляет оглавление и спрашивает снова. Таблица карт, имён файлов типов и родства словарей — `tableFile` (`{ typeNames, maps, parents }`, её кладёт оболочка).
//! Обвод: `outlineZones` — зоны части (`ZONES` JS: `id`, `part`, `colour`, `alpha`, `position`, `targets`), модели линий — в `zonesRoot` (папка зон набора Astral).
//! Файлы игры читаются по адресу `метка:путь` из того же сеанса, что `read-workshop-textures` (`workshop_textures::scene_reads`): вторых открытых архивов нет.
//!
//! Ответ: `{ file, bytes, report, timings }` — файл сцены `ARS1` лежит в `cacheFile` (запись атомарна), байты через Desktop не идут; `{ empty: true }` — на месте нет файлов игры;
//! `{ stale: true }` — оглавление устарело; `{ fallback: "unsupported: …" }` — движок этого места не умеет (модель обвода не разобралась), оболочка собирает прежним путём.
//! Любая другая ошибка — отказ команды, оболочка тоже идёт прежним путём.
//! Цифры `timings` — миллисекунды: этапы (`prepare`, `types`, `maps`, `models`, `outline`, `join`, `encode`, `write`, `total`) и суммарное время потоков (`work`: чтение, разбор, поиск листов,
//! расстановка); `dictionaries` — словари листов (`loaded`, `loadedBytes`, `evicted`, `reloaded`, `peakBytes`, `keptBytes`): словарь отпускается после последней модели, что может его
//! читать, так что `peakBytes` — сколько их держалось разом, а `loadedBytes` — сколько было бы без отпускания; `peakWorkingSetBytes` — пик рабочего набора процесса движка за всё время его жизни.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rage_res::world_place::{self, OutlineTarget, OutlineZone, Request, Tables, WorldSource};
use rage_res::world_rules::{parse_txd_parents, parse_world_maps};
use serde_json::{json, Map, Value};

use super::workshop_textures::{
    probe::Probe, resolve_root, scene_reads::session_key, scene_reads::SceneReads, session,
};
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    progress::Progress,
};

const COMMAND_NAME: &str = "build-world-place-scene";
const MAX_REQUEST_BYTES: u64 = 8 * 1024 * 1024;
const WATER_PLACE: &str = "common.rpf:data/levels/gta5/water.xml";
/// Уровень libdeflate файла сцены: файл на диске другой по байтам, чем у zlib JS, и читается так же (`ars1-encoder.md`).
const DEFAULT_LEVEL: i32 = 2;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

// ------------------------------------------------------------------ оглавление игры из файла JS

/// Адреса файлов игры по старшинству: то же, что `locations` в `openGameIndex` JS (`game-file-index.js`).
pub(crate) struct Locations {
    names: Vec<String>,
    found: HashMap<String, String>,
}

/// Вложенный архив записи (`…/cs4_13.rpf/cs4_13_lod.ytd` → `…/cs4_13.rpf`).
fn nested_archive(entry: &str) -> Option<&str> {
    entry.find(".rpf/").map(|at| &entry[..at + 4])
}

fn pack_of(label: &str) -> Option<&str> {
    label
        .strip_prefix("update/x64/dlcpacks/")?
        .strip_suffix("/dlc.rpf")
        .filter(|pack| !pack.contains('/'))
}

fn texts(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

impl Locations {
    /// Из файла оглавления JS: `{ version: 3, archives: { метка: { stamp, entries, mounted?, patched? } } }`.
    pub(crate) fn from_index(index: &Value) -> Result<Locations> {
        let archives = index
            .get("archives")
            .and_then(Value::as_object)
            .ok_or_else(|| bad("В файле оглавления игры нет архивов."))?;
        if index.get("version").and_then(Value::as_u64) != Some(3) {
            return Err(bad("Файл оглавления игры другой версии."));
        }
        let mut mounted_by_pack: HashMap<String, Vec<String>> = HashMap::new();
        for (label, record) in archives {
            if let (Some(pack), Some(list)) = (pack_of(label), record.get("mounted")) {
                mounted_by_pack.insert(pack.to_owned(), texts(Some(list)));
            }
        }
        if let Some(patched) = archives
            .get("update")
            .and_then(|record| record.get("patched"))
            .and_then(Value::as_object)
        {
            for (pack, list) in patched {
                mounted_by_pack.insert(pack.clone(), texts(Some(list)));
            }
        }
        let mut names: Vec<String> = Vec::new();
        // Старший файл на имя: вес больше — заменяет, равный — остаётся прежний (у JS сортировка по убыванию веса устойчива: из равных первым идёт тот, что записан раньше).
        let mut found: HashMap<String, (u32, String)> = HashMap::new();
        for (order, (label, record)) in archives.iter().enumerate() {
            let rank = if label == "update" {
                1
            } else if pack_of(label).is_some() {
                2
            } else {
                0
            };
            let entries = texts(record.get("entries"));
            let active: Vec<&String> = if let Some(pack) = pack_of(label) {
                match mounted_by_pack.get(pack) {
                    None => entries.iter().collect(),
                    Some(mounted) => {
                        let any = entries
                            .iter()
                            .filter_map(|entry| nested_archive(entry))
                            .any(|archive| mounted.iter().any(|m| m == archive));
                        if any {
                            entries
                                .iter()
                                .filter(|entry| {
                                    nested_archive(entry).map_or(true, |archive| {
                                        mounted.iter().any(|m| m == archive)
                                    })
                                })
                                .collect()
                        } else {
                            entries.iter().collect()
                        }
                    }
                }
            } else if label == "update" {
                entries
                    .iter()
                    .filter(|entry| {
                        let Some(rest) = entry.strip_prefix("dlc_patch/") else {
                            return true;
                        };
                        let Some((pack, tail)) = rest.split_once('/') else {
                            return true;
                        };
                        match mounted_by_pack.get(pack) {
                            None => true,
                            Some(mounted) => nested_archive(tail)
                                .map_or(true, |archive| mounted.iter().any(|m| m == archive)),
                        }
                    })
                    .collect()
            } else {
                entries.iter().collect()
            };
            for entry in active {
                let name = entry.rsplit('/').next().unwrap_or(entry);
                let patched = rank == 1 && entry.starts_with("dlc_patch/");
                let weight = if patched {
                    4000
                } else if rank == 2 {
                    2000 + order as u32
                } else if rank == 1 {
                    1000
                } else {
                    order as u32
                };
                match found.get_mut(name) {
                    Some(best) => {
                        if weight > best.0 {
                            *best = (weight, format!("{label}:{entry}"));
                        }
                    }
                    None => {
                        names.push(name.to_owned());
                        found.insert(name.to_owned(), (weight, format!("{label}:{entry}")));
                    }
                }
            }
        }
        let found = found
            .into_iter()
            .map(|(name, (_, address))| (name, address))
            .collect();
        Ok(Locations { names, found })
    }
}

/// Отпечатки архивов в файле оглавления: `метка → "размер:время"`; `None` — файл не тот (другая версия или нет архивов).
fn stamps_in(index: &Value) -> Option<Vec<(String, String)>> {
    if index.get("version").and_then(Value::as_u64) != Some(3) {
        return None;
    }
    let archives = index.get("archives").and_then(Value::as_object)?;
    Some(
        archives
            .iter()
            .map(|(label, record)| {
                let stamp = record.get("stamp").and_then(Value::as_str);
                (label.clone(), stamp.unwrap_or("").to_owned())
            })
            .collect(),
    )
}

/// Оглавление в файле — то, что дало бы `openGameIndex` сейчас: те же архивы и те же отпечатки. Иначе оболочка обновит файл (поток JS) и спросит снова.
fn stamps_are_fresh(have: &[(String, String)], now: &Map<String, Value>) -> bool {
    have.len() == now.len()
        && have
            .iter()
            .all(|(label, stamp)| now.get(label).and_then(Value::as_str) == Some(stamp.as_str()))
}

/// Оглавление, разобранное из файла, и то, по чему узнать тот же файл. Держится между сборками процесса (резидентный движок): разбор файла в десятки мегабайт — около секунды на каждую сборку.
struct IndexCache {
    file: PathBuf,
    len: u64,
    modified: Option<std::time::SystemTime>,
    taken: Instant,
    stamps: Vec<(String, String)>,
    locations: Arc<Locations>,
}

static INDEX: Mutex<Option<IndexCache>> = Mutex::new(None);
/// Сколько разобранное оглавление ждёт следующей сборки: резидентный процесс держит его не дольше этого.
const INDEX_KEPT: Duration = Duration::from_secs(120);

/// Оглавление игры из файла JS: `None` — файла нет или он устарел против `stamps` (отпечатки архивов игры сейчас).
fn open_index(file: &Path, stamps: Option<&Map<String, Value>>) -> Result<Option<Arc<Locations>>> {
    let meta = match fs::metadata(file) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(EngineError::from(error)),
    };
    let modified = meta.modified().ok();
    let mut cache = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(kept) = cache.as_ref() {
        let same = kept.file == file
            && kept.len == meta.len()
            && kept.modified == modified
            && kept.taken.elapsed() < INDEX_KEPT;
        if same {
            let fresh = stamps.map_or(true, |now| stamps_are_fresh(&kept.stamps, now));
            return Ok(fresh.then(|| Arc::clone(&kept.locations)));
        }
    }
    *cache = None;
    let text = fs::read_to_string(file).map_err(EngineError::from)?;
    let index: Value =
        serde_json::from_str(&text).map_err(|_| bad("Файл оглавления игры — не JSON."))?;
    drop(text);
    let have = stamps_in(&index).ok_or_else(|| bad("Файл оглавления игры другой версии."))?;
    if let Some(now) = stamps {
        if !stamps_are_fresh(&have, now) {
            return Ok(None);
        }
    }
    let locations = Arc::new(Locations::from_index(&index)?);
    *cache = Some(IndexCache {
        file: file.to_owned(),
        len: meta.len(),
        modified,
        taken: Instant::now(),
        stamps: have,
        locations: Arc::clone(&locations),
    });
    Ok(Some(locations))
}

/// Файлы игры мира: оглавление и чтение по адресу через сеанс читателя листов; модели обвода — из папки зон Astral.
struct GameSource<'a> {
    locations: &'a Locations,
    reads: SceneReads<'a>,
    zones_root: Option<PathBuf>,
}

impl WorldSource for GameSource<'_> {
    fn names(&self) -> &[String] {
        &self.locations.names
    }
    fn lookup(&self, name: &str) -> Option<String> {
        self.locations.found.get(&name.to_lowercase()).cloned()
    }
    fn read(&self, address: &str) -> rage_res::Result<Option<Vec<u8>>> {
        self.reads
            .file(address)
            .map_err(|error| rage_res::Error::new(rage_res::Kind::Io, error.to_string()))
    }
    fn water(&self) -> Option<String> {
        let bytes = self.reads.file(WATER_PLACE).ok().flatten()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }
    fn zone_file(&self, file: &str) -> rage_res::Result<Option<Vec<u8>>> {
        // Имя модели — простое имя файла набора: путь наружу из папки зон не идёт.
        let plain = !file.is_empty() && !file.contains(['/', '\\', ':']) && !file.contains("..");
        Ok(self
            .zones_root
            .as_ref()
            .filter(|_| plain)
            .and_then(|root| fs::read(root.join(file)).ok()))
    }
}

// ------------------------------------------------------------------ запрос и ответ

fn number(value: Option<&Value>, what: &str) -> Result<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .ok_or_else(|| bad(format!("Запрос: нет числа «{what}».")))
}

fn triple(value: Option<&Value>, what: &str) -> Result<[f64; 3]> {
    let list = value
        .and_then(Value::as_array)
        .filter(|list| list.len() == 3)
        .ok_or_else(|| bad(format!("Запрос: «{what}» — три числа.")))?;
    Ok([
        number(list.first(), what)?,
        number(list.get(1), what)?,
        number(list.get(2), what)?,
    ])
}

fn text_of(value: Option<&Value>, what: &str) -> Result<String> {
    match value {
        Some(Value::String(text)) => Ok(text.clone()),
        Some(Value::Number(n)) => Ok(n.to_string()),
        _ => Err(bad(format!("Запрос: нет строки «{what}»."))),
    }
}

/// Линии обвода: `outlineZones` — описание зон, как оно у `ZONES` JS (`id`, `part`, `colour`, `alpha`, `position`, `targets`).
fn zones_of(value: Option<&Value>) -> Result<Vec<OutlineZone>> {
    let list = match value {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(list)) => list,
        Some(_) => return Err(bad("Запрос: зоны обвода — список.")),
    };
    list.iter()
        .map(|zone| {
            let targets = zone
                .get("targets")
                .and_then(Value::as_array)
                .ok_or_else(|| bad("Запрос: у зоны обвода нет моделей."))?
                .iter()
                .map(|target| {
                    Ok(OutlineTarget {
                        file: text_of(target.get("file"), "file")?,
                        origin: triple(target.get("origin"), "origin")?,
                        texture: text_of(target.get("texture"), "texture")?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(OutlineZone {
                id: text_of(zone.get("id"), "id")?,
                part: text_of(zone.get("part"), "part")?,
                colour: text_of(zone.get("colour"), "colour")?,
                alpha: number(zone.get("alpha"), "alpha")?,
                position: triple(zone.get("position"), "position")?,
                targets,
            })
        })
        .collect()
}

fn request_of(body: &Value) -> Result<Request> {
    let origin = body
        .get("origin")
        .and_then(Value::as_array)
        .filter(|list| list.len() == 3)
        .ok_or_else(|| bad("Запрос: нет начала места."))?;
    let origin = [
        number(origin.first(), "origin")?,
        number(origin.get(1), "origin")?,
        number(origin.get(2), "origin")?,
    ];
    let plan = match body.get("plan") {
        None | Some(Value::Null) => None,
        Some(Value::Array(points)) => Some(
            points
                .iter()
                .map(|point| {
                    let pair = point
                        .as_array()
                        .filter(|p| p.len() == 2)
                        .ok_or_else(|| bad("Запрос: точка плана — пара чисел."))?;
                    Ok([number(pair.first(), "plan")?, number(pair.get(1), "plan")?])
                })
                .collect::<Result<Vec<_>>>()?,
        ),
        Some(_) => return Err(bad("Запрос: план — список точек.")),
    };
    Ok(Request {
        origin,
        reach: number(body.get("reach"), "reach")?,
        plan,
        top: body
            .get("top")
            .and_then(Value::as_f64)
            .filter(|t| t.is_finite())
            .unwrap_or(f64::INFINITY),
        outline: body
            .get("outline")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        zones: zones_of(body.get("outlineZones"))?,
        threads: body
            .get("threads")
            .and_then(Value::as_u64)
            .map_or(0, |n| n as usize),
    })
}

fn tables_of(file: &Path) -> Result<Tables> {
    let text = fs::read_to_string(file).map_err(EngineError::from)?;
    let table: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| bad("Файл таблицы мира — не JSON."))?;
    let parents = table.get("parents").and_then(Value::as_str).unwrap_or("");
    let maps = table
        .get("maps")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("В таблице мира нет карт."))?;
    Ok(Tables {
        type_names: texts(table.get("typeNames")),
        maps: parse_world_maps(maps),
        parents: parse_txd_parents(parents),
    })
}

fn path_of(body: &Value, key: &str) -> Result<PathBuf> {
    let text = body
        .get(key)
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| bad(format!("Запрос: нет «{key}».")))?;
    crate::paths::full_path(text)
}

/// Рабочий набор процесса за всё время, байт (`PeakWorkingSetSize`); других систем нет.
#[cfg(windows)]
#[allow(unsafe_code)]
fn peak_working_set() -> Option<u64> {
    #[repr(C)]
    struct Counters {
        size: u32,
        faults: u32,
        peak: usize,
        working: usize,
        rest: [usize; 6],
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
    }
    // Не `K32GetProcessMemoryInfo`: под этим именем в `process_memory.rs` уже объявлена функция с другим типом записи.
    #[link(name = "psapi")]
    extern "system" {
        fn GetProcessMemoryInfo(process: isize, counters: *mut Counters, size: u32) -> i32;
    }
    let mut counters = Counters {
        size: std::mem::size_of::<Counters>() as u32,
        faults: 0,
        peak: 0,
        working: 0,
        rest: [0; 6],
    };
    // SAFETY: структура совпадает с `PROCESS_MEMORY_COUNTERS` (72 байта на x64), размер передан; вызов только пишет в неё.
    let done = unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.size) };
    (done != 0).then_some(counters.peak as u64)
}

#[cfg(not(windows))]
fn peak_working_set() -> Option<u64> {
    None
}

/// Правила сеанса: в работе — свои, в проверках — готовый набор ключей и короткий простой.
#[derive(Clone)]
pub(crate) struct Settings {
    pub keys: Option<Arc<rage_rpf::KeySet>>,
    pub idle: Duration,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            keys: None,
            idle: session::IDLE,
        }
    }
}

fn ms(map: &mut Map<String, Value>, key: &str, value: f64) {
    map.insert(key.to_owned(), json!((value * 10.0).round() / 10.0));
}

pub(crate) fn run(body: &Value, settings: Settings) -> Result<Value> {
    let began = Instant::now();
    let request = request_of(body)?;
    let game_root = body
        .get("gameRoot")
        .and_then(Value::as_str)
        .map(str::trim)
        .and_then(resolve_root)
        .ok_or_else(|| bad("Запрос: нет папки игры."))?;
    let keys = body
        .get("keys")
        .and_then(Value::as_str)
        .filter(|keys| !keys.is_empty());
    let cache_file = path_of(body, "cacheFile")?;
    let index_file = path_of(body, "indexFile")?;
    let table_file = path_of(body, "tableFile")?;
    let level = body
        .get("level")
        .and_then(Value::as_i64)
        .map_or(DEFAULT_LEVEL, |l| l.clamp(0, 12) as i32);

    let stage = Instant::now();
    // Нет файла оглавления или он устарел — ответ «stale»: оболочка обновит его (поток JS) и спросит снова.
    let Some(locations) = open_index(&index_file, body.get("stamps").and_then(Value::as_object))?
    else {
        return Ok(json!({ "stale": true }));
    };
    let tables = tables_of(&table_file)?;
    let prepare_ms = stage.elapsed().as_secs_f64() * 1000.0;

    let root = PathBuf::from(&game_root);
    let lease = session::lease(
        &session_key(&game_root.to_lowercase(), keys),
        true,
        settings.idle,
    );
    let game = lease.game(&root, &game_root, keys, settings.keys.clone());
    let probe = Probe::default();
    let source = GameSource {
        locations: &locations,
        reads: SceneReads::new(&lease, game, root, &probe, session::BUDGET_BYTES),
        zones_root: body
            .get("zonesRoot")
            .and_then(Value::as_str)
            .filter(|root| !root.is_empty())
            .and_then(|root| crate::paths::full_path(root).ok()),
    };

    let built = match world_place::build(&source, &tables, &request) {
        Ok(built) => built,
        Err(error) if error.message.starts_with("unsupported:") => {
            return Ok(json!({ "fallback": error.message }))
        }
        Err(error) => return Err(error.into()),
    };
    if built.scene.meshes.is_empty() {
        return Ok(json!({ "empty": true }));
    }
    let threads = if request.threads == 0 {
        0
    } else {
        request.threads
    };
    let (bytes, encode_ms) = world_place::encode(&built, level, threads)?;
    let stage = Instant::now();
    if let Some(folder) = cache_file.parent() {
        fs::create_dir_all(folder).map_err(EngineError::from)?;
    }
    // Общая запись через соседний черновик: сцену в кэше читатель никогда не видит наполовину записанной.
    super::shop::write_atomic(&cache_file, &bytes)?;
    let write_ms = stage.elapsed().as_secs_f64() * 1000.0;

    let r = &built.report;
    let report = json!({
        "maps": r.maps, "types": r.types, "entities": r.entities, "interiors": r.interiors, "models": r.models, "missingModels": r.missing_models,
        "noColour": r.no_colour, "sheets": r.sheets, "missingSheets": r.missing_sheets, "dropped": r.dropped, "vertices": r.vertices, "triangles": r.triangles,
        "meshes": r.meshes, "water": r.water, "bytes": bytes.len(),
    });
    let mut timings = Map::new();
    ms(&mut timings, "prepare", prepare_ms);
    for (key, value) in &r.ms {
        ms(&mut timings, key, *value);
    }
    ms(&mut timings, "encode", encode_ms);
    ms(&mut timings, "write", write_ms);
    ms(
        &mut timings,
        "total",
        began.elapsed().as_secs_f64() * 1000.0,
    );
    let mut work = Map::new();
    for (key, value) in &r.work_ms {
        ms(&mut work, key, *value);
    }
    timings.insert("work".into(), Value::Object(work));
    // Словари листов: сколько прочитано и отпущено (после последней модели, что может их читать) и сколько байт держалось разом; `reloaded` — ноль, если счёт читателей верен.
    let d = &r.dictionaries;
    timings.insert(
        "dictionaries".into(),
        json!({ "loaded": d.loaded, "loadedBytes": d.loaded_bytes, "evicted": d.evicted, "reloaded": d.reloaded, "peakBytes": d.peak_bytes, "keptBytes": d.kept_bytes }),
    );
    timings.insert("sessionReads".into(), json!({ "loaded": probe.loaded.load(std::sync::atomic::Ordering::Relaxed), "reused": probe.reused.load(std::sync::atomic::Ordering::Relaxed) }));
    if let Some(peak) = peak_working_set() {
        timings.insert("peakWorkingSetBytes".into(), json!(peak));
    }
    Ok(
        json!({ "file": cache_file.to_string_lossy(), "bytes": bytes.len(), "report": report, "timings": Value::Object(timings) }),
    )
}

fn request_body(options: &Options) -> Result<Value> {
    let text = match options.optional("request-json") {
        Some(inline) => inline.to_owned(),
        None => {
            let path = crate::paths::full_path(options.required("request")?)?;
            if fs::metadata(&path).map_err(EngineError::from)?.len() > MAX_REQUEST_BYTES {
                return Err(bad("Запрос build-world-place-scene слишком велик."));
            }
            fs::read_to_string(&path).map_err(EngineError::from)?
        }
    };
    text.trim_start_matches('\u{feff}')
        .parse()
        .map_err(|_| bad("Запрос build-world-place-scene — не JSON."))
}

fn build_world_place_scene(options: &Options, _progress: &Progress) -> Result<Value> {
    run(&request_body(options)?, Settings::default())
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, build_world_place_scene)];

#[cfg(test)]
mod tests;
