//! `roads-build`: сборка словарей набора «Дороги» — чтение из архивов игры, перекраска листов и
//! запись готовых файлов одним запуском (крейт `astral-recolor`).
//!
//! Раньше это шло в приложении потоками JS: у «Неоновой ночи» 2442 словаря и 128–138 с на тестовом
//! ПК. Здесь один процесс и общая на все потоки память готовых листов. Файлы выходят теми же байт
//! в байт; то, чего движок дословно не повторяет, отдаётся со статусом `fallback` — такой словарь
//! приложение собирает прежним кодом.
//!
//! Запрос — JSON из `--request`: облик работы уже разобран приложением (числа с плавающей точкой
//! приходят битами `f64` десятичной строкой — так они доезжают до последнего бита), семейства
//! листов по именам (`roadTextureFamily` остаётся у приложения), список заданий.

use std::{collections::HashMap, fs, path::PathBuf};

use astral_recolor::{
    build::{build, Done, Job, Shelf},
    dictionary::{Family, Stats},
    paint::{Kind, Part},
    roads::{GroupState, Look, Markings, Source, Surface, SurfaceMode},
};
use serde_json::{json, Value};

use super::Command;
use crate::{
    archives::load_keys,
    args::Options,
    error::{EngineError, Result},
    paths::full_path,
    progress::Progress,
};

const COMMAND_NAME: &str = "roads-build";
const REQUEST_FORMAT: &str = "astral.roads-build";
const MAX_REQUEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_JOBS: usize = 20_000;
const MAX_THREADS: usize = 32;
/// Потолок памяти готовых листов по умолчанию: разных листов у дорог около тысячи, в среднем по полмегабайта.
const MEMO_BYTES: usize = 512 * 1024 * 1024;
const MAX_MEMO_BYTES: usize = 4 * 1024 * 1024 * 1024;
const MAX_SOURCE_SIDE: usize = 8192;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value> {
    value.get(name).ok_or_else(|| bad(format!("В запросе roads-build нет поля {name}.")))
}

fn text<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    field(value, name)?.as_str().ok_or_else(|| bad(format!("Поле {name} — не строка.")))
}

fn flag(value: &Value, name: &str) -> Result<bool> {
    field(value, name)?.as_bool().ok_or_else(|| bad(format!("Поле {name} — не да/нет.")))
}

fn whole(value: &Value, name: &str) -> Result<usize> {
    field(value, name)?
        .as_u64()
        .and_then(|number| usize::try_from(number).ok())
        .ok_or_else(|| bad(format!("Поле {name} — не целое.")))
}

/// Число `f64` битами (десятичная строка `u64`): так оно то же до последнего бита, что у приложения.
fn real(value: &Value, name: &str) -> Result<f64> {
    text(value, name)?
        .parse::<u64>()
        .map(f64::from_bits)
        .map_err(|_| bad(format!("Поле {name} — не биты числа.")))
}

fn colour(value: &Value, name: &str) -> Result<Option<[f64; 3]>> {
    match field(value, name)? {
        Value::Null => Ok(None),
        Value::Array(items) if items.len() == 3 => {
            let mut out = [0f64; 3];
            for (slot, item) in out.iter_mut().zip(items) {
                let byte = item.as_u64().filter(|&byte| byte <= 255).ok_or_else(|| bad(format!("Поле {name} — не цвет.")))?;
                *slot = byte as f64;
            }
            Ok(Some(out))
        }
        _ => Err(bad(format!("Поле {name} — не цвет."))),
    }
}

fn surface(value: &Value) -> Result<Surface> {
    let mode = match text(value, "mode")? {
        "standard" => SurfaceMode::Standard,
        "colour" => SurfaceMode::Colour,
        "flat" => SurfaceMode::Flat,
        "finish" => SurfaceMode::Finish,
        other => return Err(bad(format!("Неизвестный вид облика части: {other}."))),
    };
    Ok(Surface {
        stock: flag(value, "stock")?,
        mode,
        standard_k: real(value, "standardK")?,
        colour: colour(value, "colour")?,
        repeats: real(value, "repeats")?,
        share: real(value, "share")?,
        bright: real(value, "bright")?,
    })
}

fn source(value: &Value) -> Result<Option<Source>> {
    if value.is_null() {
        return Ok(None);
    }
    let file = full_path(text(value, "file")?)?;
    let rgba = fs::read(&file).map_err(|error| EngineError::io(format!("Источник отделки не прочитан: {error}")))?;
    let side = |name: &str| -> Result<usize> {
        let side = whole(value, name)?;
        if side == 0 || side > MAX_SOURCE_SIDE {
            return Err(bad(format!("Поле {name} источника отделки вне пределов.")));
        }
        Ok(side)
    };
    let sized = |width: usize, height: usize| -> Result<()> {
        if rgba.len() == width * height * 4 {
            Ok(())
        } else {
            Err(bad("Источник отделки не того размера."))
        }
    };
    match text(value, "kind")? {
        "tile" => {
            let size = side("size")?;
            sized(size, size)?;
            Ok(Some(Source::Tile { rgba, size, clamp: flag(value, "clamp")? }))
        }
        "image" => {
            let (width, height) = (side("width")?, side("height")?);
            sized(width, height)?;
            Ok(Some(Source::Image { rgba, width, height, wrap: flag(value, "wrap")? }))
        }
        other => Err(bad(format!("Неизвестный источник отделки: {other}."))),
    }
}

fn markings(value: &Value) -> Result<Markings> {
    let listed = field(value, "groups")?.as_array().filter(|items| items.len() == 6).ok_or_else(|| bad("У разметки должно быть шесть групп."))?;
    let mut groups = Vec::with_capacity(6);
    for item in listed {
        groups.push(GroupState {
            stock: flag(item, "stock")?,
            hidden: flag(item, "hidden")?,
            colour: colour(item, "colour")?,
            bright: real(item, "bright")?,
            wear: real(item, "wear")?,
        });
    }
    let groups: [GroupState; 6] = groups.try_into().map_err(|_| bad("У разметки должно быть шесть групп."))?;
    let mask = u32::try_from(whole(value, "mask")?).map_err(|_| bad("Маска групп вне пределов."))?;
    Ok(Markings { stock: flag(value, "stock")?, mask, groups })
}

fn look(value: &Value) -> Result<Look> {
    let parts = field(value, "parts")?;
    let sources = field(value, "sources")?;
    Ok(Look {
        asphalt: surface(field(parts, "asphalt")?)?,
        dirt: surface(field(parts, "dirt")?)?,
        sidewalk: surface(field(parts, "sidewalk")?)?,
        asphalt_source: source(field(sources, "asphalt")?)?,
        dirt_source: source(field(sources, "dirt")?)?,
        sidewalk_source: source(field(sources, "sidewalk")?)?,
        markings: markings(field(value, "markings")?)?,
    })
}

/// Семейства листов: строки `[имя, часть, вид или null, дальний]`.
fn families(value: &Value) -> Result<HashMap<String, Family>> {
    let rows = value.as_array().ok_or_else(|| bad("Семейства листов — не список."))?;
    let mut out = HashMap::with_capacity(rows.len());
    for row in rows {
        let wrong = || bad("Строка семейства листа — не [имя, часть, вид, дальний].");
        let items = row.as_array().filter(|items| items.len() == 4).ok_or_else(wrong)?;
        let name = items[0].as_str().ok_or_else(wrong)?;
        let part = match items[1].as_str().ok_or_else(wrong)? {
            "asphalt" => Part::Asphalt,
            "dirt" => Part::Dirt,
            "sidewalk" => Part::Sidewalk,
            "markings" => Part::Markings,
            _ => return Err(wrong()),
        };
        let kind = match &items[2] {
            Value::Null => Kind::Plain,
            Value::String(kind) if kind == "crossing" => Kind::Crossing,
            Value::String(kind) if kind == "parking" => Kind::Parking,
            _ => return Err(wrong()),
        };
        let lod = items[3].as_bool().ok_or_else(wrong)?;
        out.insert(name.to_ascii_lowercase(), Family { part, kind, lod });
    }
    Ok(out)
}

fn jobs(value: &Value) -> Result<Vec<Job>> {
    let rows = value.as_array().filter(|rows| rows.len() <= MAX_JOBS).ok_or_else(|| bad("Задания — не список или их слишком много."))?;
    rows.iter()
        .map(|row| {
            let output = full_path(text(row, "output")?)?;
            if !output.is_absolute() {
                return Err(EngineError::argument("Helper paths must be absolute."));
            }
            /* Словарь файлом на диске — стенды и тесты без игры; место в игре тогда не нужно. */
            let file = match row.get("file") {
                None | Some(Value::Null) => None,
                Some(Value::String(path)) => Some(full_path(path)?).filter(|path| path.is_absolute()),
                Some(_) => return Err(bad("Поле file задания — не путь.")),
            };
            let at = if file.is_some() { row.get("at").and_then(Value::as_str).unwrap_or_default() } else { text(row, "at")? };
            Ok(Job { name: text(row, "name")?.to_owned(), at: at.to_owned(), file, output })
        })
        .collect()
}

fn stats_fields(stats: &Stats) -> [(&'static str, Value); 4] {
    [
        ("skipped", stats.skipped.into()),
        ("memo", stats.memo.into()),
        ("computed", stats.computed.into()),
        ("unknown", stats.unknown.clone().into()),
    ]
}

fn row(name: &str, done: Done) -> Value {
    let mut out = serde_json::Map::new();
    out.insert("name".to_owned(), name.into());
    let mut put = |key: &str, value: Value| {
        out.insert(key.to_owned(), value);
    };
    match done {
        Done::Missing => put("status", "missing".into()),
        Done::Fallback(reason) => {
            put("status", "fallback".into());
            put("reason", reason.into());
        }
        Done::Unchanged(stats) => {
            put("status", "unchanged".into());
            for (key, value) in stats_fields(&stats) {
                put(key, value);
            }
        }
        Done::Built { bytes, sha256, textures, stats } => {
            put("status", "built".into());
            put("bytes", bytes.into());
            put("sha256", sha256.into());
            put("textures", textures.into());
            for (key, value) in stats_fields(&stats) {
                put(key, value);
            }
        }
    }
    Value::Object(out)
}

fn roads_build(options: &Options, progress: &Progress) -> Result<Value> {
    let request_path = full_path(options.required("request")?)?;
    let size = fs::metadata(&request_path).map_err(EngineError::from)?.len();
    if size > MAX_REQUEST_BYTES {
        return Err(bad("Запрос roads-build слишком велик."));
    }
    let raw = fs::read_to_string(&request_path).map_err(EngineError::from)?;
    let body: Value = raw.trim_start_matches('\u{feff}').parse().map_err(|_| bad("Запрос roads-build — не JSON."))?;
    if text(&body, "format")? != REQUEST_FORMAT || whole(&body, "version")? != 1 {
        return Err(bad("Запрос roads-build другого формата или версии."));
    }
    let game_root: PathBuf = full_path(text(&body, "gameRoot")?)?;
    if !game_root.is_absolute() {
        return Err(EngineError::argument("Helper paths must be absolute."));
    }
    let look = look(field(&body, "look")?)?;
    let families = families(field(&body, "families")?)?;
    let jobs = jobs(field(&body, "jobs")?)?;
    let threads = whole(&body, "threads")?.clamp(1, MAX_THREADS);
    let memo_bytes = match body.get("memoBytes") {
        Some(_) => whole(&body, "memoBytes")?.min(MAX_MEMO_BYTES),
        None => MEMO_BYTES,
    };

    /* Ключи архивов нужны, только если хоть один словарь читается из игры. */
    let keys = if jobs.iter().any(|job| job.file.is_none()) {
        Some(load_keys(&game_root.to_string_lossy(), options.optional("keys"))?.0)
    } else {
        None
    };
    let shelf = Shelf::new(game_root, keys);
    let total = jobs.len() as u64;
    progress.report_bytes("roads", 0, total);
    let tick = |done: usize| {
        if done % 8 == 0 || done as u64 == total {
            progress.report_bytes("roads", done as u64, total);
        }
    };
    let stop = || progress.cancel().requested();
    let (done, clock) = build(&jobs, &shelf, &look, &families, threads, memo_bytes, &tick, &stop);
    progress.checkpoint()?;

    let files: Vec<Value> = jobs.iter().zip(done).map(|(job, done)| row(&job.name, done)).collect();
    /* Время потоков по этапам (суммой по всем потокам): по нему видно, на чём сборка стоит. */
    let timings: serde_json::Map<String, Value> = clock.report().into_iter().map(|(stage, value)| (stage.to_owned(), json!(value))).collect();
    Ok(json!({ "status": "ready", "mode": "build", "threads": threads, "files": files, "timings": timings }))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, roads_build)];
