//! `vegetation-build`: файлы игры набора «Растительность» с листами «Травы по миру» — чтение из архивов
//! игры, листы мода на месте штатных, атласы дальних планов в цвет травы, газоны и запись готовых файлов
//! одним запуском (крейт `astral-recolor`).
//!
//! Раньше это шло в приложении потоками JS (`vegetation-build-worker.js`): «как в моде» — 950 файлов, 2 ГБ,
//! «свой цвет» — 3243 файла, 6,6 ГБ. Здесь один процесс и общая на все потоки память готовых листов мода.
//! Файлы выходят теми же байт в байт; то, чего движок дословно не повторяет, отдаётся со статусом
//! `fallback` — такой файл приложение собирает прежним кодом.
//!
//! Запрос — JSON из `--request`: что работа значит, решает приложение. Цвет травы файла, цели цвета
//! (`grassTarget`), полоса цветов эффекта зоны и рамки зон приходят числами; числа с плавающей точкой —
//! битами `f64` десятичной строкой, так они доезжают до последнего бита.

use std::{collections::HashMap, fs, path::PathBuf};

use astral_recolor::{
    build::Shelf,
    grass::{Reference, Target},
    vegetation::{hex_colour, Direction, Distant, Field, GameJob, Image, ModSheets, Paint, Sandy},
    vegetation_build::{build_games, GameDone, VegJob},
    vegetation_grass::{Blade, GrassJob, GrassPlan, GrassZone},
};
use rage_res::dxt_block::Format;
use serde_json::{json, Value};

use super::Command;
use crate::{
    archives::load_keys,
    args::Options,
    error::{EngineError, Result},
    paths::full_path,
    progress::Progress,
};

const COMMAND_NAME: &str = "vegetation-build";
const REQUEST_FORMAT: &str = "astral.vegetation-build";
const MAX_REQUEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_JOBS: usize = 20_000;
const MAX_THREADS: usize = 32;
const MAX_ARCHIVES: usize = 16;
const MAX_IMAGES: usize = 4096;
const MAX_STEPS: usize = 1024;
/// Потолок памяти готовых листов мода по умолчанию: разных листов — сотни, в среднем по паре мегабайт.
const MEMO_BYTES: usize = 1024 * 1024 * 1024;
const MAX_MEMO_BYTES: usize = 6 * 1024 * 1024 * 1024;

fn bad(message: impl Into<String>) -> EngineError {
    EngineError::invalid_data(message)
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value> {
    value.get(name).ok_or_else(|| bad(format!("В запросе vegetation-build нет поля {name}.")))
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

/// Число `f64` битами (десятичная строка `u64`).
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

fn reals<const N: usize>(value: &Value, what: &str) -> Result<[f64; N]> {
    let items = value.as_array().filter(|items| items.len() == N).ok_or_else(|| bad(format!("{what} — не {N} чисел.")))?;
    let mut out = [0f64; N];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = bits(item, what)?;
    }
    Ok(out)
}

fn colour(value: &Value, what: &str) -> Result<[u8; 3]> {
    let items = value.as_array().filter(|items| items.len() == 3).ok_or_else(|| bad(format!("{what} — не цвет.")))?;
    let mut out = [0u8; 3];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = item.as_u64().and_then(|byte| u8::try_from(byte).ok()).ok_or_else(|| bad(format!("{what} — не цвет.")))?;
    }
    Ok(out)
}

/// Цель цвета травы (`grassTarget`): множитель яркости, угол, насыщенность — битами.
fn target(value: &Value) -> Result<Target> {
    let [gain, angle, saturation] = reals::<3>(value, "Цель цвета травы")?;
    Ok(Target { gain, angle, saturation })
}

fn texture_list(value: &Value, what: &str) -> Result<Vec<(String, u32, bool)>> {
    let listed = value.as_array().ok_or_else(|| bad(format!("{what} — не список.")))?;
    let mut out = Vec::with_capacity(listed.len());
    for row in listed {
        let parts = row.as_array().filter(|parts| parts.len() == 3).ok_or_else(|| bad(format!("{what}: строка — не [имя, картинка, оттенок].")))?;
        let name = parts[0].as_str().ok_or_else(|| bad(format!("{what}: имя листа — не строка.")))?;
        let image = parts[1].as_u64().and_then(|number| u32::try_from(number).ok()).ok_or_else(|| bad(format!("{what}: номер картинки — не целое.")))?;
        let tint = match &parts[2] {
            Value::Bool(flag) => *flag,
            Value::Number(number) => number.as_u64().is_some_and(|value| value != 0),
            _ => return Err(bad(format!("{what}: оттенок — не да/нет."))),
        };
        out.push((name.to_owned(), image, tint));
    }
    Ok(out)
}

fn names(value: &Value, what: &str) -> Result<Vec<String>> {
    let listed = value.as_array().ok_or_else(|| bad(format!("{what} — не список.")))?;
    listed.iter().map(|item| item.as_str().map(str::to_owned).ok_or_else(|| bad(format!("{what}: имя — не строка.")))).collect()
}

fn dxt(name: &str) -> Result<Format> {
    match name {
        "DXT1" => Ok(Format::Dxt1),
        "DXT3" => Ok(Format::Dxt3),
        "DXT5" => Ok(Format::Dxt5),
        other => Err(bad(format!("Формат листа мода {other} движок не читает."))),
    }
}

/// Листы мода плана: описание каждой картинки и байты первых уровней одним файлом.
fn sandy(body: &Value, memo_limit: usize) -> Result<Sandy> {
    let images_file = full_path(text(body, "imagesFile")?)?;
    let bytes = fs::read(&images_file).map_err(|error| EngineError::io(format!("Листы мода не прочитаны: {error}")))?;
    let listed = field(body, "images")?.as_object().filter(|rows| rows.len() <= MAX_IMAGES).ok_or_else(|| bad("Картинки мода — не словарь или их слишком много."))?;
    let mut images = HashMap::with_capacity(listed.len());
    for (id, row) in listed {
        let id = id.parse::<u32>().map_err(|_| bad("Номер картинки мода — не целое."))?;
        let flat = match row.get("flat").filter(|value| !value.is_null()) {
            Some(value) => Some(colour(value, "Цвет ровной картинки")?),
            None => None,
        };
        let (width, height) = (whole(row, "width")?, whole(row, "height")?);
        if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
            return Err(bad("Размер картинки мода вне пределов."));
        }
        let (offset, length) = (whole(row, "offset")?, whole(row, "length")?);
        if flat.is_none() && offset.checked_add(length).is_none_or(|end| end > bytes.len()) {
            return Err(bad("Байты картинки мода выходят за файл."));
        }
        images.insert(id, Image { width, height, format: dxt(text(row, "format")?)?, flat, offset, length });
    }
    let sheets = |name: &str| -> Result<HashMap<String, (u32, bool)>> {
        let mut out = HashMap::new();
        for (sheet, image, tint) in texture_list(field(field(body, "modSheets")?, name)?, "Листы мода")? {
            out.insert(sheet, (image, tint));
        }
        Ok(out)
    };
    let mod_sheets = ModSheets { exact: sheets("exact")?, base: sheets("base")? };
    Ok(Sandy::new(images, bytes, mod_sheets, memo_limit))
}

fn direction(name: &str) -> Result<Direction> {
    match name {
        "along" => Ok(Direction::Along),
        "across" => Ok(Direction::Across),
        "height" => Ok(Direction::Height),
        other => Err(bad(format!("Неизвестное направление эффекта травы: {other}."))),
    }
}

fn field_of(value: &Value) -> Result<Option<Field>> {
    if value.is_null() {
        return Ok(None);
    }
    let steps = whole(value, "steps")?;
    if steps == 0 || steps > MAX_STEPS {
        return Err(bad("Ступеней эффекта травы вне пределов."));
    }
    let [west, south, east, north] = reals::<4>(field(value, "box")?, "Рамка зоны")?;
    Ok(Some(Field {
        direction: direction(text(value, "direction")?)?,
        line: flag(value, "line")?,
        width: real(value, "width")?,
        west,
        south,
        east,
        north,
        centre: reals::<2>(field(value, "centre")?, "Середина зоны")?,
        radius: real(value, "radius")?,
        steps,
    }))
}

/// Дальний план зоны (`distantOptions`): цели цветов, поле эффекта и середина зоны. Рамка файла — у задания.
fn distant_options(value: &Value) -> Result<Distant> {
    let listed = field(value, "targets")?.as_array().filter(|rows| !rows.is_empty() && rows.len() <= MAX_STEPS + 1).ok_or_else(|| bad("Цели цветов дальнего плана — не список."))?;
    let targets = listed.iter().map(target).collect::<Result<Vec<_>>>()?;
    let shape = field_of(field(value, "field")?)?;
    if shape.as_ref().is_some_and(|shape| shape.steps + 1 != targets.len()) {
        return Err(bad("Целей цвета не столько, сколько ступеней эффекта."));
    }
    if shape.is_none() && targets.len() != 1 {
        return Err(bad("У ровного цвета дальнего плана должна быть одна цель."));
    }
    Ok(Distant {
        greens: flag(value, "greens")?,
        sand: flag(value, "sand")?,
        albedo: real(value, "albedo")?,
        targets,
        field: shape,
        place: None,
        zone_centre: reals::<2>(field(value, "zoneCentre")?, "Середина зоны")?,
    })
}

fn distants(value: Option<&Value>) -> Result<HashMap<String, Distant>> {
    let Some(value) = value.filter(|value| !value.is_null()) else { return Ok(HashMap::new()) };
    let listed = value.as_object().filter(|rows| rows.len() <= 8).ok_or_else(|| bad("Дальние планы зон — не словарь."))?;
    listed.iter().map(|(zone, row)| Ok((zone.clone(), distant_options(row)?))).collect()
}

/// Модель травинки: средний цвет листа и средняя травинка (`grassReference`) — битами.
fn blade(value: &Value) -> Result<Blade> {
    let [y, angle, saturation] = reals::<3>(field(value, "reference")?, "Средняя травинка")?;
    Ok(Blade { sheet: reals::<3>(field(value, "sheet")?, "Лист травинки")?, reference: Reference { y, angle, saturation } })
}

/// Карты травы: зоны (полоса цветов и цель каждого), модели травинок, камни и бревна. Без `grass` в запросе карт травы нет.
fn grass_plan(value: Option<&Value>) -> Result<(GrassPlan, HashMap<String, GrassZone>)> {
    let empty = GrassPlan { blades: HashMap::new(), default: Blade { sheet: [0.0; 3], reference: Reference { y: 0.0, angle: 0.0, saturation: 0.0 } }, non_plant: Default::default() };
    let Some(value) = value.filter(|value| !value.is_null()) else { return Ok((empty, HashMap::new())) };
    let mut blades = HashMap::new();
    for (hash, row) in field(value, "blades")?.as_object().ok_or_else(|| bad("Модели травинок — не словарь."))? {
        blades.insert(hash.parse::<u32>().map_err(|_| bad("Хэш модели травинки — не целое."))?, blade(row)?);
    }
    let non_plant: std::collections::HashSet<u32> = field(value, "nonPlant")?
        .as_array()
        .ok_or_else(|| bad("Камни и бревна — не список."))?
        .iter()
        .map(|hash| hash.as_u64().and_then(|hash| u32::try_from(hash).ok()).ok_or_else(|| bad("Хэш камня — не целое.")))
        .collect::<Result<_>>()?;
    let mut zones = HashMap::new();
    for (zone, row) in field(value, "zones")?.as_object().filter(|rows| rows.len() <= 8).ok_or_else(|| bad("Зоны карт травы — не словарь."))? {
        let targets = field(row, "targets")?.as_array().filter(|rows| !rows.is_empty() && rows.len() <= MAX_STEPS + 1).ok_or_else(|| bad("Цели цветов травы зоны — не список."))?.iter().map(target).collect::<Result<Vec<_>>>()?;
        let Some(shape) = field_of(field(row, "field")?)? else { return Err(bad("У зоны карт травы нет полосы цветов.")) };
        if shape.steps + 1 != targets.len() {
            return Err(bad("Целей цвета не столько, сколько ступеней эффекта."));
        }
        zones.insert(zone.clone(), GrassZone { field: shape, targets });
    }
    Ok((GrassPlan { blades, default: blade(field(value, "default")?)?, non_plant }, zones))
}

fn paints(value: &Value) -> Result<Vec<Paint>> {
    let listed = value.as_array().filter(|rows| rows.len() <= 4096).ok_or_else(|| bad("Цвета травы — не список или их слишком много."))?;
    let mut out = Vec::with_capacity(listed.len());
    for row in listed {
        let rgb = colour(field(row, "rgb")?, "Цвет травы файла")?;
        let paint = Paint { key: hex_colour(rgb), rgb, target: target(field(row, "target")?)? };
        if text(row, "key")? != paint.key {
            return Err(bad("Ключ цвета травы не совпадает с его байтами."));
        }
        out.push(paint);
    }
    Ok(out)
}

fn jobs(value: &Value, paints: &[Paint], zones: &HashMap<String, Distant>, grass_zones: &HashMap<String, GrassZone>) -> Result<Vec<VegJob>> {
    let listed = value.as_array().filter(|rows| rows.len() <= MAX_JOBS).ok_or_else(|| bad("Задания — не список или их слишком много."))?;
    let mut out = Vec::with_capacity(listed.len());
    for row in listed {
        let name = text(row, "name")?;
        if name.is_empty() || name.contains(['/', '\\']) {
            return Err(bad("Имя файла пустое или с путём."));
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
        if row.get("kind").and_then(Value::as_str) == Some("grass") {
            let zone = text(row, "zone")?;
            let zone = grass_zones.get(zone).ok_or_else(|| bad(format!("Нет зоны карт травы {zone}.")))?.clone();
            out.push(VegJob::Grass(GrassJob { name: name.to_owned(), at, file, output, zone }));
            continue;
        }
        let paint = match row.get("paint").filter(|value| !value.is_null()) {
            Some(index) => {
                let index = index.as_u64().and_then(|index| usize::try_from(index).ok()).filter(|&index| index < paints.len()).ok_or_else(|| bad("Номер цвета травы вне списка."))?;
                Some(paints[index].clone())
            }
            None => None,
        };
        let green = match row.get("green").filter(|value| !value.is_null()) {
            Some(value) => Some(texture_list(value, "Листы мода файла")?),
            None => None,
        };
        let lawns = match row.get("lawns").filter(|value| !value.is_null()) {
            Some(value) => Some(names(value, "Листы газонов")?),
            None => None,
        };
        let distant = match row.get("distant").filter(|value| !value.is_null()) {
            Some(value) => {
                let zone = text(value, "zone")?;
                let options = zones.get(zone).ok_or_else(|| bad(format!("Нет дальнего плана зоны {zone}.")))?;
                let place = match value.get("place").filter(|value| !value.is_null()) {
                    Some(place) => Some(reals::<6>(place, "Рамка файла")?),
                    None => None,
                };
                Some(options.with_place(place))
            }
            None => None,
        };
        out.push(VegJob::Game(GameJob { name: name.to_owned(), at, file, output, country: flag(row, "country")?, paint, green, distant, lawns }));
    }
    Ok(out)
}

/// Свои метки архивов: имя → файл.
fn archives(value: Option<&Value>) -> Result<HashMap<String, PathBuf>> {
    let Some(value) = value.filter(|value| !value.is_null()) else { return Ok(HashMap::new()) };
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

fn row(name: &str, done: GameDone) -> Value {
    match done {
        GameDone::Missing => json!({ "name": name, "status": "missing" }),
        GameDone::Unchanged => json!({ "name": name, "status": "unchanged" }),
        GameDone::Fallback(reason) => json!({ "name": name, "status": "fallback", "reason": reason }),
        GameDone::Built { bytes, sha256, kinds, counts } => {
            let counts: serde_json::Map<String, Value> = counts.into_iter().map(|(key, value)| (key.to_owned(), json!(value))).collect();
            json!({ "name": name, "status": "built", "bytes": bytes, "sha256": sha256, "kinds": kinds, "counts": counts })
        }
    }
}

fn vegetation_build(options: &Options, progress: &Progress) -> Result<Value> {
    let request_path = full_path(options.required("request")?)?;
    if fs::metadata(&request_path).map_err(EngineError::from)?.len() > MAX_REQUEST_BYTES {
        return Err(bad("Запрос vegetation-build слишком велик."));
    }
    let raw = fs::read_to_string(&request_path).map_err(EngineError::from)?;
    let body: Value = raw.trim_start_matches('\u{feff}').parse().map_err(|_| bad("Запрос vegetation-build — не JSON."))?;
    if text(&body, "format")? != REQUEST_FORMAT || whole(&body, "version")? != 1 {
        return Err(bad("Запрос vegetation-build другого формата или версии."));
    }
    let game_root: PathBuf = full_path(text(&body, "gameRoot")?)?;
    if !game_root.is_absolute() {
        return Err(EngineError::argument("Helper paths must be absolute."));
    }
    let memo_limit = match body.get("memoBytes") {
        Some(value) => usize::try_from(value.as_u64().ok_or_else(|| bad("Поле memoBytes — не целое."))?).unwrap_or(MEMO_BYTES).clamp(1, MAX_MEMO_BYTES),
        None => MEMO_BYTES,
    };
    let sandy = sandy(&body, memo_limit)?;
    let paints = paints(field(&body, "paints")?)?;
    let zones = distants(body.get("distants"))?;
    let (grass, grass_zones) = grass_plan(body.get("grass"))?;
    let jobs = jobs(field(&body, "jobs")?, &paints, &zones, &grass_zones)?;
    let extra = archives(body.get("archives"))?;
    let threads = whole(&body, "threads")?.clamp(1, MAX_THREADS);

    /* Ключи архивов нужны, только если хоть один файл читается из архива. */
    let keys = if jobs.iter().any(|job| matches!(job, VegJob::Game(GameJob { file: None, .. }) | VegJob::Grass(GrassJob { file: None, .. }))) {
        Some(load_keys(&game_root.to_string_lossy(), options.optional("keys"))?.0)
    } else {
        None
    };
    let shelf = Shelf::with_archives(game_root, keys, extra);
    let total = jobs.len() as u64;
    progress.report_bytes("vegetation", 0, total);
    let tick = |done: usize| {
        if done % 8 == 0 || done as u64 == total {
            progress.report_bytes("vegetation", done as u64, total);
        }
    };
    let stop = || progress.cancel().requested();
    let (done, clock) = build_games(&jobs, &shelf, &sandy, &grass, threads, &tick, &stop);
    progress.checkpoint()?;

    let files: Vec<Value> = jobs.iter().zip(done).map(|(job, done)| row(job.name(), done)).collect();
    /* Время потоков по этапам (суммой по всем потокам): по нему видно, на чём сборка стоит. */
    let timings: serde_json::Map<String, Value> = clock.report().into_iter().map(|(stage, value)| (stage.to_owned(), json!(value))).collect();
    Ok(json!({ "status": "ready", "mode": "build", "threads": threads, "files": files, "timings": timings }))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, vegetation_build)];
