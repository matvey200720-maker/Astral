//! `water-build`: плитки тумана набора «Вода» — чтение из архива игры, перекраска каждого уровня
//! и запись готовых файлов одним запуском (крейт `astral-recolor`).
//!
//! Плитки — 96 % сборки воды: 944 словаря BC7 и DXT1 с полной цепочкой mip, 71 с процессора на JS
//! (замер тестового ПК 14.11.2026: разбор BC7 — 36 %, цвет точки — 27 %, сжатие BC7 — 26 %).
//! Файлы выходят теми же байт в байт; плитку, которую движок дословно не повторяет, он отдаёт со
//! статусом `fallback` — её собирает приложение прежним кодом. Реки, квады и подводный таймцикл
//! остаются у приложения: это два процента работы.
//!
//! Запрос — JSON из `--request`: облик воды уже разобран приложением (`waterFogEngineLook`):
//! полоса цвета каждой группы — 256 ступеней байтами, числа с плавающей точкой — битами `f64`
//! десятичной строкой. `archives` — свои метки архивов (чистая основа `update.rpf` из кэша Astral).

use std::{collections::HashMap, fs, path::PathBuf};

use astral_recolor::{
    build::{build_tiles, Shelf, TileDone, TileJob},
    water::{Direction, Fog, FogLook, Rect},
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

const COMMAND_NAME: &str = "water-build";
const REQUEST_FORMAT: &str = "astral.water-build";
const MAX_REQUEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_JOBS: usize = 20_000;
const MAX_THREADS: usize = 32;
const MAX_LAKES: usize = 4_096;
const MAX_ARCHIVES: usize = 16;
const STRIP_STEPS: usize = 256;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value> {
    value.get(name).ok_or_else(|| bad(format!("В запросе water-build нет поля {name}.")))
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
fn bits(value: &Value, what: &str) -> Result<f64> {
    value
        .as_str()
        .and_then(|text| text.parse::<u64>().ok())
        .map(f64::from_bits)
        .ok_or_else(|| bad(format!("{what} — не биты числа.")))
}

fn real(value: &Value, name: &str) -> Result<f64> {
    bits(field(value, name)?, &format!("Поле {name}"))
}

/// Ровно `N` чисел битами.
fn reals<const N: usize>(value: &Value, what: &str) -> Result<[f64; N]> {
    let items = value.as_array().filter(|items| items.len() == N).ok_or_else(|| bad(format!("{what} — не {N} чисел.")))?;
    let mut out = [0f64; N];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = bits(item, what)?;
    }
    Ok(out)
}

fn fog_look(value: &Value) -> Result<FogLook> {
    let tint = flag(value, "tint")?;
    let direction = match text(value, "direction")? {
        "height" => Direction::Height,
        "across" => Direction::Across,
        "along" => Direction::Along,
        other => return Err(bad(format!("Неизвестное направление эффекта воды: {other}."))),
    };
    let listed = field(value, "table")?.as_array().ok_or_else(|| bad("Полоса цвета воды — не список."))?;
    if listed.len() != if tint { STRIP_STEPS * 3 } else { 0 } {
        return Err(bad("Полоса цвета воды не той длины."));
    }
    let mut bytes = Vec::with_capacity(listed.len());
    for item in listed {
        bytes.push(item.as_u64().and_then(|byte| u8::try_from(byte).ok()).ok_or_else(|| bad("Полоса цвета воды — не байты."))?);
    }
    Ok(FogLook {
        tint,
        line: flag(value, "line")?,
        direction,
        width: real(value, "width")?,
        table: bytes.chunks_exact(3).map(|step| [step[0], step[1], step[2]]).collect(),
    })
}

fn fog(value: &Value) -> Result<Fog> {
    let [west, east, south, north] = reals::<4>(field(value, "bounds")?, "Границы карты")?;
    let listed = field(value, "lakes")?.as_array().filter(|rows| rows.len() <= MAX_LAKES).ok_or_else(|| bad("Озёра — не список или их слишком много."))?;
    let mut lakes = Vec::with_capacity(listed.len());
    for row in listed {
        lakes.push(reals::<4>(row, "Озеро")?);
    }
    let fog = Fog {
        west,
        east,
        south,
        north,
        depth_metres: real(value, "depthMetres")?,
        luma_deep: real(value, "lumaDeep")?,
        luma_shallow: real(value, "lumaShallow")?,
        min_green: u8::try_from(whole(value, "minGreen")?).map_err(|_| bad("Поле minGreen — не байт."))?,
        sea: fog_look(field(value, "sea")?)?,
        inland: fog_look(field(value, "inland")?)?,
        lakes,
    };
    if !fog.sound() {
        return Err(bad("Облик воды не для движка: полоса цвета неполна или ширина линии не положительна."));
    }
    Ok(fog)
}

fn jobs(value: &Value) -> Result<Vec<TileJob>> {
    let listed = value.as_array().filter(|rows| rows.len() <= MAX_JOBS).ok_or_else(|| bad("Задания — не список или их слишком много."))?;
    let mut out = Vec::with_capacity(listed.len());
    for row in listed {
        let name = text(row, "name")?;
        if name.is_empty() || name.contains(['/', '\\']) {
            return Err(bad("Имя плитки пустое или с путём."));
        }
        let output = full_path(text(row, "output")?)?;
        if !output.is_absolute() {
            return Err(EngineError::argument("Helper paths must be absolute."));
        }
        let file = match row.get("file").filter(|value| !value.is_null()) {
            Some(value) => Some(full_path(value.as_str().ok_or_else(|| bad("Поле file — не строка."))?)?),
            None => None,
        };
        let at = if file.is_some() { String::new() } else { text(row, "at")?.to_owned() };
        let [west, north, size] = reals::<3>(field(row, "rect")?, "Прямоугольник плитки")?;
        out.push(TileJob { name: name.to_owned(), at, file, rect: Rect { west, north, size }, output });
    }
    Ok(out)
}

/// Свои метки архивов: имя → файл.
fn archives(value: Option<&Value>) -> Result<HashMap<String, PathBuf>> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(HashMap::new());
    };
    let listed = value.as_object().filter(|rows| rows.len() <= MAX_ARCHIVES).ok_or_else(|| bad("Архивы — не словарь или их слишком много."))?;
    let mut out = HashMap::with_capacity(listed.len());
    for (label, file) in listed {
        let word = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-';
        if label.is_empty() || label.len() > 32 || !label.bytes().all(word) {
            return Err(bad("Метка архива — не слово строчными."));
        }
        let file = full_path(file.as_str().ok_or_else(|| bad("Файл архива — не строка."))?)?;
        if !file.is_absolute() {
            return Err(EngineError::argument("Helper paths must be absolute."));
        }
        out.insert(label.clone(), file);
    }
    Ok(out)
}

fn row(name: &str, done: TileDone) -> Value {
    match done {
        TileDone::Missing => json!({ "name": name, "status": "missing" }),
        TileDone::Unchanged => json!({ "name": name, "status": "unchanged" }),
        TileDone::Fallback(reason) => json!({ "name": name, "status": "fallback", "reason": reason }),
        TileDone::Built { bytes, sha256 } => json!({ "name": name, "status": "built", "bytes": bytes, "sha256": sha256 }),
    }
}

fn water_build(options: &Options, progress: &Progress) -> Result<Value> {
    let request_path = full_path(options.required("request")?)?;
    if fs::metadata(&request_path).map_err(EngineError::from)?.len() > MAX_REQUEST_BYTES {
        return Err(bad("Запрос water-build слишком велик."));
    }
    let raw = fs::read_to_string(&request_path).map_err(EngineError::from)?;
    let body: Value = raw.trim_start_matches('\u{feff}').parse().map_err(|_| bad("Запрос water-build — не JSON."))?;
    if text(&body, "format")? != REQUEST_FORMAT || whole(&body, "version")? != 1 {
        return Err(bad("Запрос water-build другого формата или версии."));
    }
    let game_root: PathBuf = full_path(text(&body, "gameRoot")?)?;
    if !game_root.is_absolute() {
        return Err(EngineError::argument("Helper paths must be absolute."));
    }
    let fog = fog(field(&body, "fog")?)?;
    let jobs = jobs(field(&body, "jobs")?)?;
    let extra = archives(body.get("archives"))?;
    let threads = whole(&body, "threads")?.clamp(1, MAX_THREADS);

    /* Ключи архивов нужны, только если хоть одна плитка читается из архива. */
    let keys = if jobs.iter().any(|job| job.file.is_none()) {
        Some(load_keys(&game_root.to_string_lossy(), options.optional("keys"))?.0)
    } else {
        None
    };
    let shelf = Shelf::with_archives(game_root, keys, extra);
    let total = jobs.len() as u64;
    progress.report_bytes("water", 0, total);
    let tick = |done: usize| {
        if done % 8 == 0 || done as u64 == total {
            progress.report_bytes("water", done as u64, total);
        }
    };
    let stop = || progress.cancel().requested();
    let (done, clock) = build_tiles(&jobs, &shelf, &fog, threads, &tick, &stop);
    progress.checkpoint()?;

    let files: Vec<Value> = jobs.iter().zip(done).map(|(job, done)| row(&job.name, done)).collect();
    /* Время потоков по этапам (суммой по всем потокам): по нему видно, на чём сборка стоит. */
    let timings: serde_json::Map<String, Value> = clock.report().into_iter().map(|(stage, value)| (stage.to_owned(), json!(value))).collect();
    Ok(json!({ "status": "ready", "mode": "build", "threads": threads, "files": files, "timings": timings }))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, water_build)];
