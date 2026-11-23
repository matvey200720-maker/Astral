//! `billboards-build`: файлы щитов набора «Билборды» — чтение из архивов игры, картинки щитов, укладка в листы, сжатие тронутых
//! блоков и запись готовых файлов одним запуском (крейт `astral-recolor`, модуль `billboards`).
//!
//! Раньше это шло в приложении потоками JS (`paintBillboardFile`): «одна картинка на все щиты» — 720 файлов и 1 ГБ, 315 с процессора
//! (замер тестового ПК 16.11.2026). Файлы выходят теми же байт в байт; то, чего движок дословно не повторяет (рисунок поверх щита,
//! гифка, лист не DXT), он отдаёт со статусом `fallback` — такой файл приложение собирает прежним кодом.
//!
//! Запрос — JSON из `--request`: облик каждого щита приложение уже разобрало (обликов в списке `looks` немного, щиты ссылаются на них
//! номерами), картинки — файлами RGBA (`sources`), места щитов на листах и размер места в пикселях — числами; числа с плавающей точкой —
//! битами `f64` десятичной строкой, так они доезжают до последнего бита.

use std::{fs, path::PathBuf};

use astral_recolor::{
    billboards::{build, Done, Entry, Fit, Image, Item, Job, Look, Paint, SheetJob},
    build::Shelf,
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

const COMMAND_NAME: &str = "billboards-build";
const REQUEST_FORMAT: &str = "astral.billboards-build";
const MAX_REQUEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_JOBS: usize = 20_000;
const MAX_THREADS: usize = 32;
const MAX_LOOKS: usize = 4_096;
const MAX_SOURCES: usize = 256;
const MAX_SIDE: usize = 8192;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value> {
    value.get(name).ok_or_else(|| bad(format!("В запросе billboards-build нет поля {name}.")))
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

/// Целое со знаком: сдвиг кадрирования бывает отрицательным.
fn signed(value: &Value, name: &str) -> Result<f64> {
    field(value, name)?.as_i64().map(|number| number as f64).ok_or_else(|| bad(format!("Поле {name} — не целое.")))
}

/// Число `f64` битами (десятичная строка `u64`).
fn bits(value: &Value, what: &str) -> Result<f64> {
    value
        .as_str()
        .and_then(|text| text.parse::<u64>().ok())
        .map(f64::from_bits)
        .ok_or_else(|| bad(format!("{what} — не биты числа.")))
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

/// Цвет: три байта.
fn colour(value: &Value, name: &str) -> Result<[u8; 3]> {
    let wrong = || bad(format!("Поле {name} — не цвет."));
    let items = field(value, name)?.as_array().filter(|items| items.len() == 3).ok_or_else(wrong)?;
    let mut out = [0u8; 3];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = item.as_u64().and_then(|byte| u8::try_from(byte).ok()).ok_or_else(wrong)?;
    }
    Ok(out)
}

fn source(value: &Value) -> Result<Image> {
    let file = full_path(text(value, "file")?)?;
    let side = |name: &str| -> Result<usize> {
        let side = whole(value, name)?;
        if side == 0 || side > MAX_SIDE {
            return Err(bad(format!("Поле {name} картинки вне пределов.")));
        }
        Ok(side)
    };
    let (width, height) = (side("width")?, side("height")?);
    let rgba = fs::read(&file).map_err(|error| EngineError::io(format!("Картинка щита не прочитана: {error}")))?;
    if rgba.len() != width * height * 4 {
        return Err(bad("Картинка щита не того размера."));
    }
    Ok(Image { rgba, width, height })
}

fn look(value: &Value, sources: usize) -> Result<Look> {
    let brightness = signed(value, "brightness")?;
    let paint = match text(value, "paint")? {
        "shade" => Paint::Shade,
        "colour" => Paint::Colour(colour(value, "colour")?),
        "gradient" => Paint::Gradient { from: colour(value, "from")?, to: colour(value, "to")?, down: flag(value, "down")? },
        "image" => {
            let source = whole(value, "source")?;
            if source >= sources {
                return Err(bad("Облик ссылается на картинку, которой нет."));
            }
            let fit = match text(value, "fit")? {
                "cover" => Fit::Cover,
                "contain" => Fit::Contain,
                "stretch" => Fit::Stretch,
                other => return Err(bad(format!("Неизвестная подгонка картинки: {other}."))),
            };
            Paint::Image { source, fit, background: colour(value, "background")?, zoom: signed(value, "zoom")?, pan_x: signed(value, "panX")?, pan_y: signed(value, "panY")? }
        }
        other => return Err(bad(format!("Неизвестный вид облика щита: {other}."))),
    };
    /* Масштаб ноль у JS читается как «как есть» (100), а у движка был бы делением на ноль: такой облик движку не годится. */
    if matches!(paint, Paint::Image { zoom, .. } if zoom <= 0.0) {
        return Err(bad("Масштаб кадрирования не положителен."));
    }
    Ok(Look { paint, brightness })
}

fn entry(value: &Value) -> Result<Entry> {
    let clip = reals::<4>(field(value, "clip")?, "Рамка щита")?;
    let rows = field(value, "map")?.as_array().filter(|rows| rows.len() == 3).ok_or_else(|| bad("Углы щита — не три точки."))?;
    let mut map = [[0f64; 2]; 3];
    for (slot, row) in map.iter_mut().zip(rows) {
        *slot = reals::<2>(row, "Угол щита")?;
    }
    let size = field(value, "size")?.as_array().filter(|items| items.len() == 2).ok_or_else(|| bad("Размер места щита — не два числа."))?;
    let side = |item: &Value| -> Result<usize> {
        item.as_u64().and_then(|number| usize::try_from(number).ok()).filter(|&side| side > 0 && side <= MAX_SIDE * 4).ok_or_else(|| bad("Размер места щита вне пределов."))
    };
    Ok(Entry { clip, map, size: [side(&size[0])?, side(&size[1])?] })
}

fn item(value: &Value, looks: usize) -> Result<Item> {
    let look = whole(value, "look")?;
    if look >= looks {
        return Err(bad("Щит ссылается на облик, которого нет."));
    }
    Ok(Item { look, aspect: bits(field(value, "aspect")?, "Пропорция щита")?, entry: entry(value)? })
}

fn sheet(value: &Value, looks: usize) -> Result<SheetJob> {
    let listed = field(value, "items")?.as_array().ok_or_else(|| bad("Щиты листа — не список."))?;
    let mut items = Vec::with_capacity(listed.len());
    for row in listed {
        items.push(self::item(row, looks)?);
    }
    let side = |name: &str| -> Result<usize> {
        let side = whole(value, name)?;
        if side == 0 || side > MAX_SIDE {
            return Err(bad(format!("Поле {name} листа вне пределов.")));
        }
        Ok(side)
    };
    Ok(SheetJob { name: text(value, "name")?.to_owned(), width: side("width")?, height: side("height")?, items })
}

fn jobs(value: &Value, looks: usize) -> Result<Vec<Job>> {
    let rows = value.as_array().filter(|rows| rows.len() <= MAX_JOBS).ok_or_else(|| bad("Задания — не список или их слишком много."))?;
    rows.iter()
        .map(|row| {
            let output = full_path(text(row, "output")?)?;
            if !output.is_absolute() {
                return Err(EngineError::argument("Helper paths must be absolute."));
            }
            /* Файл на диске — стенды и тесты без игры; место в игре тогда не нужно. */
            let file = match row.get("file") {
                None | Some(Value::Null) => None,
                Some(Value::String(path)) => Some(full_path(path)?).filter(|path| path.is_absolute()),
                Some(_) => return Err(bad("Поле file задания — не путь.")),
            };
            let at = if file.is_some() { row.get("at").and_then(Value::as_str).unwrap_or_default() } else { text(row, "at")? };
            let listed = field(row, "sheets")?.as_array().ok_or_else(|| bad("Листы файла — не список."))?;
            let mut sheets = Vec::with_capacity(listed.len());
            for item in listed {
                sheets.push(sheet(item, looks)?);
            }
            Ok(Job { name: text(row, "name")?.to_owned(), at: at.to_owned(), file, output, sheets })
        })
        .collect()
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
        Done::Unchanged { missing } => {
            put("status", "unchanged".into());
            put("missing", missing.into());
        }
        Done::Built { bytes, sha256, textures, sheets, missing } => {
            put("status", "built".into());
            put("bytes", bytes.into());
            put("sha256", sha256.into());
            put("textures", textures.into());
            put("sheets", sheets.into());
            put("missing", missing.into());
        }
    }
    Value::Object(out)
}

fn billboards_build(options: &Options, progress: &Progress) -> Result<Value> {
    let request_path = full_path(options.required("request")?)?;
    let size = fs::metadata(&request_path).map_err(EngineError::from)?.len();
    if size > MAX_REQUEST_BYTES {
        return Err(bad("Запрос billboards-build слишком велик."));
    }
    let raw = fs::read_to_string(&request_path).map_err(EngineError::from)?;
    let body: Value = raw.trim_start_matches('\u{feff}').parse().map_err(|_| bad("Запрос billboards-build — не JSON."))?;
    if text(&body, "format")? != REQUEST_FORMAT || whole(&body, "version")? != 1 {
        return Err(bad("Запрос billboards-build другого формата или версии."));
    }
    let game_root: PathBuf = full_path(text(&body, "gameRoot")?)?;
    if !game_root.is_absolute() {
        return Err(EngineError::argument("Helper paths must be absolute."));
    }
    let listed = field(&body, "sources")?.as_array().filter(|rows| rows.len() <= MAX_SOURCES).ok_or_else(|| bad("Картинки — не список или их слишком много."))?;
    let sources = listed.iter().map(source).collect::<Result<Vec<_>>>()?;
    let listed = field(&body, "looks")?.as_array().filter(|rows| rows.len() <= MAX_LOOKS).ok_or_else(|| bad("Облики — не список или их слишком много."))?;
    let looks = listed.iter().map(|item| look(item, sources.len())).collect::<Result<Vec<_>>>()?;
    let jobs = jobs(field(&body, "jobs")?, looks.len())?;
    let threads = whole(&body, "threads")?.clamp(1, MAX_THREADS);

    /* Ключи архивов нужны, только если хоть один файл читается из игры. */
    let keys = if jobs.iter().any(|job| job.file.is_none()) {
        Some(load_keys(&game_root.to_string_lossy(), options.optional("keys"))?.0)
    } else {
        None
    };
    let shelf = Shelf::new(game_root, keys);
    let total = jobs.len() as u64;
    progress.report_bytes("billboards", 0, total);
    let tick = |done: usize| {
        if done % 4 == 0 || done as u64 == total {
            progress.report_bytes("billboards", done as u64, total);
        }
    };
    let stop = || progress.cancel().requested();
    let (done, clock, stages) = build(&jobs, &shelf, &looks, &sources, threads, &tick, &stop);
    progress.checkpoint()?;

    let files: Vec<Value> = jobs.iter().zip(done).map(|(job, done)| row(&job.name, done)).collect();
    /* Время потоков по этапам (суммой по всем потокам): по нему видно, на чём сборка стоит. */
    let mut timings: serde_json::Map<String, Value> = clock.report().into_iter().map(|(stage, value)| (stage.to_owned(), json!(value))).collect();
    for (stage, value) in stages.report() {
        timings.insert(stage.to_owned(), json!(value));
    }
    Ok(json!({ "status": "ready", "mode": "build", "threads": threads, "files": files, "timings": timings }))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, billboards_build)];
