#![allow(clippy::too_many_arguments, clippy::manual_is_multiple_of, clippy::chunks_exact_to_as_chunks, clippy::type_complexity)]

//! Ядра цвета травы для JS (15.11.2026): `recolourGrass`, `recolourDistantBlocks`,
//! `recolourDistantSand`, `grassInstanceColour` из `packages/climb-contract/recolor/grass-colour.js`.
//!
//! Сама арифметика — в крейте `astral-recolor` (`grass.rs`), байт в байт с JS; здесь только
//! переход границы: типизированные массивы туда и обратно. Какой лист красить и каким цветом,
//! решает JS; ядро получает байты листа или блоков и числа облика. Дальний план идёт двумя
//! половинами (веса → JS спрашивает цвет травы в точках → сдвиг), остальное — одной.
//!
//! Синус, косинус и арктангенс ядро не считает: у V8 они свои и разные в Node и в Electron, и
//! совпасть с эталоном можно, только взяв значения у самого JS. Поэтому у каждого ядра сдвига три
//! вызова с одними и теми же входами и таблицами `tables`: режим 1 — ядро отвечает, какие
//! арктангенсы ему нужны; режим 2 — какие углы; режим 3 — результат. Таблицы между вызовами
//! наполняет JS (`Math.atan2`, `Math.sin`, `Math.cos`): обёртка `grassKernels` в `@modovik/native-rs`.
//! Режим 0 — порт `fdlibm` (Node 24) для тестов.
//!
//! Отказ ядра (вход не тот, что у JS-пути) — исключение: вызывающий считает на JS.

use astral_recolor::grass::{self as kernels, BlockFormat, Fail, Mode, Oracle, Reference, Sums, Target, WeightsIn};
use napi::bindgen_prelude::*;
use napi_derive::napi;

fn refuse(reason: Fail) -> Error {
    /* «Шум» — не сбой: статус `Cancelled`, JS по нему считает сам и не заносит отказ в счётчик. */
    let status = if reason == kernels::DECLINED { Status::Cancelled } else { Status::GenericFailure };
    Error::new(status, reason.to_string())
}

fn dimension(value: u32) -> Result<usize> {
    if value > 65_536 {
        return Err(refuse("размер листа вне области ядра"));
    }
    Ok(value as usize)
}

fn block_format(code: u32) -> Result<BlockFormat> {
    BlockFormat::from_code(code).ok_or_else(|| refuse("формат не DXT1/3/5"))
}

/// Таблица целей: `gain, angle, saturation` на строку.
fn targets_of(table: &[f64]) -> Result<Vec<Target>> {
    if table.len() % 3 != 0 {
        return Err(refuse("таблица целей не кратна трём"));
    }
    Ok(table.chunks_exact(3).map(|row| Target { gain: row[0], angle: row[1], saturation: row[2] }).collect())
}

/// Средняя трава: `y, angle, saturation` (или ничего).
fn reference_of(values: Option<Vec<f64>>) -> Result<Option<Reference>> {
    match values {
        None => Ok(None),
        Some(values) if values.len() == 3 => Ok(Some(Reference { y: values[0], angle: values[1], saturation: values[2] })),
        Some(_) => Err(refuse("средняя трава — три числа")),
    }
}

fn sums_numbers(sums: Sums) -> Vec<f64> {
    vec![sums.weight, sums.sum_y, sums.sum_cb, sums.sum_cr]
}

/// Версия набора ядер: JS не зовёт то, чего в старом бинарнике нет.
#[napi]
pub fn grass_kernels_version() -> u32 {
    2
}

/// Порт математики V8 (`fdlibm`, как в Node 24) для тестов и самопроверки `Math.hypot`: `kind` 0 —
/// `Math.sin`, 1 — `Math.cos`, 2 — `Math.atan2(y, x)` по парам `(y, x)`, 3 — `Math.hypot(a, b)` по парам.
#[napi]
pub fn grass_trig(kind: u32, input: Float64Array) -> Result<Float64Array> {
    let values: &[f64] = &input;
    Ok(kernels::trig(kind, values).map_err(refuse)?.into())
}

/// Таблицы значений, которые JS посчитал для ядра, и режим вызова (0 — порт, 1 — спросить
/// арктангенсы, 2 — спросить углы, 3 — ответить).
#[napi(object)]
pub struct GrassTables {
    pub mode: u32,
    /// Пары `(y, x)` подряд и `Math.atan2` от них.
    pub atan_args: Float64Array,
    pub atan_values: Float64Array,
    /// Углы и `Math.sin`, `Math.cos` от них.
    pub angles: Float64Array,
    pub sines: Float64Array,
    pub cosines: Float64Array,
}

/// Ответ ядра сдвига. В режимах 1 и 2 — что ему нужно (`ask_atan`, `ask_angles`); `done` — результат
/// уже окончателен (в режимах 0 и 3 всегда; в 1 и 2 — если он не зависит от значений, например «травы нет»).
#[napi(object)]
pub struct GrassReply {
    pub done: bool,
    pub bytes: Option<Buffer>,
    pub ask_atan: Float64Array,
    pub ask_angles: Float64Array,
}

fn oracle_of(tables: &GrassTables) -> Result<Oracle> {
    let mode = Mode::from_code(tables.mode).ok_or_else(|| refuse("режим ядра — 0…3"))?;
    match mode {
        Mode::Port => Ok(Oracle::port()),
        Mode::AskAtan => Ok(Oracle::asking_atan()),
        Mode::AskAngles | Mode::Answer => {
            let (args, values, angles, sines, cosines): (&[f64], &[f64], &[f64], &[f64], &[f64]) =
                (&tables.atan_args, &tables.atan_values, &tables.angles, &tables.sines, &tables.cosines);
            Oracle::with_tables(mode, args, values, angles, sines, cosines).map_err(refuse)
        }
    }
}

/// Ответ вызова: в режимах 0 и 3 — результат (если таблицы дали всё нужное), в 1 и 2 — вопросы.
/// `settled` — результат окончателен и в режимах вопросов (не зависит от синусов и арктангенсов).
fn reply_of(oracle: &Oracle, bytes: Option<Vec<u8>>, settled: bool) -> Result<GrassReply> {
    if let Some(failure) = oracle.failure() {
        return Err(refuse(failure));
    }
    let asking = matches!(oracle.mode(), Mode::AskAtan | Mode::AskAngles);
    Ok(GrassReply {
        done: !asking || settled,
        bytes: if asking && !settled { None } else { bytes.map(Buffer::from) },
        ask_atan: oracle.asked_atan().to_vec().into(),
        ask_angles: oracle.asked_angles().to_vec().into(),
    })
}

/// `recolourGrass`: лист RGBA в цвете цели. В ответе `bytes: null` и `done` — травы на листе нет
/// (JS отдаёт тот же массив).
#[napi]
pub fn grass_recolour(rgba: Buffer, gain: f64, angle: f64, saturation: f64, tables: GrassTables) -> Result<GrassReply> {
    let data: &[u8] = &rgba;
    let mut oracle = oracle_of(&tables)?;
    let target = Target { gain, angle, saturation };
    let out = kernels::recolour_grass(data, &target, &mut oracle).map_err(refuse)?;
    let settled = out.is_none();
    reply_of(&oracle, out, settled)
}

/// Веса опорных цветов или пикселей и суммы двух средних для JS: средняя из суммы — `Math.atan2`, её
/// считает JS (`[weight, sumY, sumCb, sumCr]`).
#[napi(object)]
pub struct GrassWeights {
    pub grass: Float32Array,
    pub sandy: Float32Array,
    /// Тронутые блоки (или пиксели) по возрастанию: JS спрашивает цвет травы только у них.
    pub touched: Uint32Array,
    pub grass_sum: Vec<f64>,
    pub sand_sum: Vec<f64>,
}

fn weights_out(found: kernels::BlockWeights) -> GrassWeights {
    GrassWeights {
        grass: found.weights.grass.into(),
        sandy: found.weights.sandy.into(),
        touched: found.touched.into(),
        grass_sum: sums_numbers(found.weights.grass_sum),
        sand_sum: sums_numbers(found.weights.sand_sum),
    }
}

/// Первая половина `recolourDistantBlocks`; `null` — как у JS (`null`: менять нечего).
#[napi]
pub fn grass_blocks_weights(bytes: Buffer, format: u32, width: u32, height: u32, greens: bool, sand: bool) -> Result<Option<GrassWeights>> {
    let data: &[u8] = &bytes;
    let found = kernels::blocks_weights(data, block_format(format)?, dimension(width)?, dimension(height)?, greens, sand).map_err(refuse)?;
    Ok(found.map(weights_out))
}

/// Вторая половина `recolourDistantBlocks`: `slots` — номер цели у каждого блока (`-1` — не трогать),
/// `targets` — таблица целей по три числа, `grass_ref` и `sand_ref` — средние, которые JS посчитал по суммам.
/// `bytes: null` — ни один блок не изменился.
#[napi]
pub fn grass_blocks_shift(
    bytes: Buffer,
    format: u32,
    width: u32,
    height: u32,
    grass: Float32Array,
    sandy: Float32Array,
    grass_ref: Option<Vec<f64>>,
    sand_ref: Option<Vec<f64>>,
    targets: Float64Array,
    slots: Int32Array,
    albedo: f64,
    tables: GrassTables,
) -> Result<GrassReply> {
    let data: &[u8] = &bytes;
    let (grass, sandy, targets, slots): (&[f32], &[f32], &[f64], &[i32]) = (&grass, &sandy, &targets, &slots);
    let weights = WeightsIn { grass, sandy, grass_ref: reference_of(grass_ref)?, sand_ref: reference_of(sand_ref)? };
    let mut oracle = oracle_of(&tables)?;
    let shifted = kernels::blocks_shift(data, block_format(format)?, dimension(width)?, dimension(height)?, weights, &targets_of(targets)?, slots, albedo, &mut oracle).map_err(refuse)?;
    reply_of(&oracle, shifted, false)
}

/// Первая половина `recolourDistantSand` (лист RGBA); `null` — ни травы, ни песка.
#[napi]
pub fn grass_rgba_weights(rgba: Buffer, greens: bool, sand: bool) -> Result<Option<GrassWeights>> {
    let data: &[u8] = &rgba;
    Ok(kernels::rgba_weights(data, greens, sand).map_err(refuse)?.map(weights_out))
}

/// Вторая половина `recolourDistantSand`: `bytes: null` — менять нечего.
#[napi]
pub fn grass_rgba_shift(
    rgba: Buffer,
    grass: Float32Array,
    sandy: Float32Array,
    grass_ref: Option<Vec<f64>>,
    sand_ref: Option<Vec<f64>>,
    targets: Float64Array,
    slots: Int32Array,
    albedo: f64,
    tables: GrassTables,
) -> Result<GrassReply> {
    let data: &[u8] = &rgba;
    let (grass, sandy, targets, slots): (&[f32], &[f32], &[f64], &[i32]) = (&grass, &sandy, &targets, &slots);
    let weights = WeightsIn { grass, sandy, grass_ref: reference_of(grass_ref)?, sand_ref: reference_of(sand_ref)? };
    let mut oracle = oracle_of(&tables)?;
    let shifted = kernels::rgba_shift(data, weights, &targets_of(targets)?, slots, albedo, &mut oracle).map_err(refuse)?;
    reply_of(&oracle, shifted, false)
}

/// `grassInstanceColour` пачкой: `instances` — `r, g, b` подряд, `slots` — номер цели у каждого
/// (`-1` — цвет как был), `sheet` — средний цвет листа модели травы, `reference` — `[y, angle,
/// saturation]` средней травинки модели.
#[napi]
pub fn grass_instance_colours(instances: Buffer, slots: Int32Array, targets: Float64Array, sheet: Vec<f64>, reference: Vec<f64>, tables: GrassTables) -> Result<GrassReply> {
    let data: &[u8] = &instances;
    let (slots, targets): (&[i32], &[f64]) = (&slots, &targets);
    let sheet: [f64; 3] = sheet.try_into().map_err(|_| refuse("лист модели — три числа"))?;
    let reference = reference_of(Some(reference))?.ok_or_else(|| refuse("нет средней травинки"))?;
    let mut oracle = oracle_of(&tables)?;
    let out = kernels::instance_colours(data, slots, &targets_of(targets)?, sheet, &reference, &mut oracle).map_err(refuse)?;
    reply_of(&oracle, Some(out), false)
}
