//! Кодировщик файла сцены `ARS1` — тот же файл, что пишет `encodeShopScene` (`apps/desktop/src/recolor-shops-scene.js:497`) и
//! читает окно (`apps/web/src/features/workshop/model-stage/scene-asset.js`). Распакованная нагрузка совпадает с JS **до байта**
//! (образцы — `launcher_app/fixtures/ars1/parity/`, сторож — `launcher_app/tests/ars1-parity.test.js`); сжатый zlib — нет:
//! libdeflate и zlib дают разные потоки, а читают их одинаково.
//!
//! Вход (`Scene`) — то, что сборщики JS отдают кодировщику: сетки с массивами и материалы и части готовым JSON-текстом.
//!
//! * `Mesh` — `positions` (`x y z` в осях сцены, `f32`), `normals?` (`f32×3`), `uvs?` и `uvs1?` (`f32×2`), `colours?` (`f32×4`, 0…1),
//!   `indices` (`u32`), `material` и `part` (номера в `materials` и `parts`), `entity?` (номер сущности части; пишется только
//!   при `Options::entities`).
//! * `Scene` — `meshes`, `bounds?` (нет — по вершинам, как `boundsOf` сборщиков), `parts`, `materials`, `textures` и, если не пусты,
//!   `rooms`, `lamps` — **текст JSON** того, что сборщик положил бы в одноимённые поля заголовка (`JSON.stringify`), и `neutral_light`.
//!   Тексты кладутся в заголовок как есть: числа внутри (`area`, `colour`, `emission`, места вещей) остаются теми, что записал JS, а
//!   сборщик на Rust собирает такой текст сам (`js_math::number_to_string` даёт числа в записи JS).
//!
//! Всё, что кодировщик считает сам, повторяет JS: рамка `∓ 0,01` и размах не меньше `1e-3`, позиции `i16` по формуле
//! `clamp(round(((p − min) / span) · 65535 − 32768))`, нормали `i8` `clamp(round(n · 127))`, цвета `u8` `clamp(round(c · 255))`,
//! `Math.round` вверх на половинке (`js_math::round`), NaN в массивах — нуль, добивка кусков нулями до кратного 4, заголовок
//! добит пробелами, числа заголовка — как `JSON.stringify`. Сетки квантуются потоками (`Options::threads`), порядок байт от них не зависит.

use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::sync::Mutex;
use std::thread;

use libdeflater::{CompressionLvl, Compressor};

use crate::error::{Error, Result};
use crate::js_math::{clamp, number_to_string, round};

const MAGIC: &[u8; 4] = b"ARS1";
/// Версия файла в четырёх байтах после знака (окно читает 1, 2 и 3; сборщики зон и интерьеров пишут 1).
const FILE_VERSION: u32 = 1;
/// Больше стольких вершин у сетки — индексы `u32`, иначе `u16`.
const WIDE_FROM: usize = 65_535;
/// Рамка сцены шире вершин на столько с каждой стороны.
const MARGIN: f64 = 0.01;
/// Размах рамки по оси не меньше.
const MIN_SPAN: f64 = 1e-3;

#[derive(Debug, Clone, Default)]
pub struct Mesh {
    pub material: u32,
    pub part: u32,
    pub entity: Option<u32>,
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub uvs1: Option<Vec<f32>>,
    pub colours: Option<Vec<f32>>,
    pub indices: Vec<u32>,
}

/// Рамка сцены: меньшие и большие координаты вершин (`f64` из `f32`, как `boundsOf` сборщиков).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

#[derive(Debug, Clone, Default)]
pub struct Scene {
    pub bounds: Option<Bounds>,
    pub parts: String,
    pub rooms: Option<String>,
    pub materials: String,
    pub textures: String,
    pub lamps: Option<String>,
    pub neutral_light: bool,
    pub meshes: Vec<Mesh>,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Уровень libdeflate, 1…12, 0 — без сжатия. По умолчанию 2: на сцене в 1,6 млн вершин (51 МБ нагрузки) 23,65 МБ за 454 мс против
    /// 23,61 МБ за 592 мс у уровня 4, 28,6 МБ за 274 мс у уровня 1 и 51,0 МБ за 20 мс у нуля (замер, `docs/perf/speed-3d-rust/ars1-encoder.md`).
    pub level: i32,
    /// Потоков для квантования сеток; 0 — половина ядер. Результат от числа потоков не зависит.
    pub threads: usize,
    /// Писать `entity` у сеток, где он есть (помещения проектов).
    pub entities: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            level: 2,
            threads: 0,
            entities: false,
        }
    }
}

/// Рамка по вершинам сеток, как `boundsOf` у сборщиков: нет вершин — нули.
pub fn bounds_of(meshes: &[Mesh]) -> Bounds {
    bounds_of_refs(meshes)
}

/// То же по любому перечню сеток (рамка части сцены).
pub fn bounds_of_refs<'a>(meshes: impl IntoIterator<Item = &'a Mesh>) -> Bounds {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for mesh in meshes {
        for (at, value) in mesh.positions.iter().enumerate() {
            let (axis, value) = (at % 3, f64::from(*value));
            if value < min[axis] {
                min[axis] = value;
            }
            if value > max[axis] {
                max[axis] = value;
            }
        }
    }
    if min[0].is_finite() {
        Bounds { min, max }
    } else {
        Bounds {
            min: [0.0; 3],
            max: [0.0; 3],
        }
    }
}

/// Куски одной сетки в виде байт, готовые лечь в тело.
struct Chunks {
    position: Vec<u8>,
    normal: Vec<u8>,
    uv: Option<Vec<u8>>,
    index: Vec<u8>,
    colour: Option<Vec<u8>>,
    uv1: Option<Vec<u8>>,
    vertices: usize,
    indices: usize,
    wide: bool,
}

fn float_bytes(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// `Int16Array`/`Int8Array`/`Uint8Array` из числа JS: после зажима в пределы целое; NaN становится нулём.
fn stored(value: f64) -> i64 {
    if value.is_nan() {
        0
    } else {
        value as i64
    }
}

fn quantize(mesh: &Mesh, min: &[f64; 3], span: &[f64; 3]) -> Chunks {
    let count = mesh.positions.len() / 3;
    let mut position = Vec::with_capacity(count * 6);
    for (at, value) in mesh.positions.iter().take(count * 3).enumerate() {
        let axis = at % 3;
        let scaled = ((f64::from(*value) - min[axis]) / span[axis]) * 65535.0 - 32768.0;
        let step = stored(clamp(round(scaled), -32768.0, 32767.0)) as i16;
        position.extend_from_slice(&step.to_le_bytes());
    }
    let mut normal = Vec::with_capacity(count * 4);
    for at in 0..count {
        for axis in 0..3 {
            // Нет нормали или её не хватает — нуль (`?? 0`).
            let value = mesh
                .normals
                .as_ref()
                .and_then(|list| list.get(at * 3 + axis))
                .map_or(0.0, |value| f64::from(*value));
            normal.push(stored(clamp(round(value * 127.0), -127.0, 127.0)) as i8 as u8);
        }
        normal.push(0);
    }
    let wide = count > WIDE_FROM;
    let index = if wide {
        mesh.indices
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    } else {
        // `Uint16Array.from`: значение по модулю 65536.
        mesh.indices
            .iter()
            .flat_map(|value| (*value as u16).to_le_bytes())
            .collect()
    };
    let colour = mesh.colours.as_ref().map(|list| {
        (0..count * 4)
            .map(|at| {
                // Не хватает цвета — `undefined · 255` = NaN → нуль.
                let value = list.get(at).map_or(f64::NAN, |value| f64::from(*value));
                stored(clamp(round(value * 255.0), 0.0, 255.0)) as u8
            })
            .collect()
    });
    Chunks {
        position,
        normal,
        uv: mesh.uvs.as_deref().map(float_bytes),
        index,
        colour,
        uv1: mesh.uvs1.as_deref().map(float_bytes),
        vertices: count,
        indices: mesh.indices.len(),
        wide,
    }
}

/// Решает, сколько потоков брать: 0 — половина ядер, не больше числа сеток.
fn workers(wanted: usize, items: usize) -> usize {
    let cores = thread::available_parallelism().map_or(1, |n| n.get());
    let base = if wanted == 0 {
        (cores / 2).max(1)
    } else {
        wanted
    };
    base.min(items.max(1))
}

fn quantize_all(meshes: &[Mesh], min: &[f64; 3], span: &[f64; 3], threads: usize) -> Vec<Chunks> {
    let threads = workers(threads, meshes.len());
    if threads <= 1 {
        return meshes
            .iter()
            .map(|mesh| quantize(mesh, min, span))
            .collect();
    }
    let next = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<Chunks>>> = meshes.iter().map(|_| Mutex::new(None)).collect();
    thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| loop {
                let at = next.fetch_add(1, Relaxed);
                let Some(mesh) = meshes.get(at) else { break };
                let done = quantize(mesh, min, span);
                *slots[at]
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(done);
            });
        }
    });
    slots
        .into_iter()
        .map(|slot| {
            slot.into_inner()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .expect("сетка квантована")
        })
        .collect()
}

fn clamp_min(value: f64, floor: f64) -> f64 {
    if value.is_nan() {
        value
    } else {
        value.max(floor)
    }
}

fn padded(length: usize) -> usize {
    length.div_ceil(4) * 4
}

/// Число заголовка, как у `JSON.stringify`: не конечное — `null`.
fn json_number(value: f64) -> String {
    if value.is_finite() {
        number_to_string(value)
    } else {
        "null".to_owned()
    }
}

fn numbers(list: &[f64; 3]) -> String {
    let parts: Vec<String> = list.iter().map(|value| json_number(*value)).collect();
    format!("[{}]", parts.join(","))
}

/// Распакованная нагрузка `ARS1`: знак, версия, длина заголовка, заголовок, тело — то, что даёт `zlib.inflateSync(encodeShopScene(…))`.
pub fn encode_payload(scene: &Scene, options: &Options) -> Vec<u8> {
    let bounds = scene.bounds.unwrap_or_else(|| bounds_of(&scene.meshes));
    let min = bounds.min.map(|value| value - MARGIN);
    let max = bounds.max.map(|value| value + MARGIN);
    // `Math.max(размах, 1e-3)`: NaN остаётся NaN (у `f64::max` он пропадает).
    let span = [0, 1, 2].map(|axis| clamp_min(max[axis] - min[axis], MIN_SPAN));
    let chunks = quantize_all(&scene.meshes, &min, &span, options.threads);

    let mut body: Vec<u8> = Vec::with_capacity(
        chunks
            .iter()
            .map(|c| padded(c.position.len()) + padded(c.normal.len()) + padded(c.index.len()) + 64)
            .sum(),
    );
    let mut push = |bytes: &[u8]| -> usize {
        let at = body.len();
        body.extend_from_slice(bytes);
        body.resize(at + padded(bytes.len()), 0);
        at
    };
    let mut entries = Vec::with_capacity(chunks.len());
    for (mesh, chunk) in scene.meshes.iter().zip(&chunks) {
        let position = push(&chunk.position);
        let normal = push(&chunk.normal);
        let uv = chunk.uv.as_ref().map(|bytes| push(bytes));
        let index = push(&chunk.index);
        let mut entry = format!(
            "{{\"material\":{},\"part\":{},\"vertices\":{},\"indices\":{},\"wide\":{},\"position\":{position},\"normal\":{normal},\"uv\":{},\"index\":{index}",
            mesh.material,
            mesh.part,
            chunk.vertices,
            chunk.indices,
            chunk.wide,
            uv.map_or(-1, |at| at as i64),
        );
        if let (true, Some(entity)) = (options.entities, mesh.entity) {
            entry.push_str(&format!(",\"entity\":{entity}"));
        }
        if let Some(bytes) = &chunk.colour {
            entry.push_str(&format!(",\"colour\":{}", push(bytes)));
        }
        if let Some(bytes) = &chunk.uv1 {
            entry.push_str(&format!(",\"uv1\":{}", push(bytes)));
        }
        entry.push('}');
        entries.push(entry);
    }

    let mut header = format!(
        "{{\"version\":1,\"up\":\"z\",\"bounds\":{{\"min\":{},\"max\":{}}},\"parts\":{}",
        numbers(&min),
        numbers(&max),
        scene.parts
    );
    if let Some(rooms) = &scene.rooms {
        header.push_str(&format!(",\"rooms\":{rooms}"));
    }
    header.push_str(&format!(
        ",\"materials\":{},\"textures\":{}",
        scene.materials, scene.textures
    ));
    if let Some(lamps) = &scene.lamps {
        header.push_str(&format!(",\"lamps\":{lamps}"));
    }
    if scene.neutral_light {
        header.push_str(",\"neutralLight\":true");
    }
    header.push_str(",\"meshes\":[");
    header.push_str(&entries.join(","));
    header.push_str("]}");

    let header_bytes = padded(header.len());
    let mut out = Vec::with_capacity(12 + header_bytes + body.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FILE_VERSION.to_le_bytes());
    out.extend_from_slice(&(header_bytes as u32).to_le_bytes());
    out.extend_from_slice(header.as_bytes());
    out.resize(12 + header_bytes, b' ');
    out.extend_from_slice(&body);
    out
}

/// Контрольная сумма Adler-32 (хвост потока zlib).
fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for block in bytes.chunks(5552) {
        for byte in block {
            a += u32::from(*byte);
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    (b << 16) | a
}

/// Поток zlib без сжатия (блоки «stored» по 65 535 байт): окно распаковывает его почти копированием, файл в сумме на несколько байт больше нагрузки.
pub fn store(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + payload.len() / 65_535 * 5 + 16);
    out.extend_from_slice(&[0x78, 0x01]);
    let mut blocks = payload.chunks(65_535).peekable();
    if blocks.peek().is_none() {
        out.extend_from_slice(&[1, 0, 0, 0xff, 0xff]);
    }
    while let Some(block) = blocks.next() {
        let last = u8::from(blocks.peek().is_none());
        let length = block.len() as u16;
        out.push(last);
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&(!length).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(payload).to_be_bytes());
    out
}

/// zlib-поток libdeflate; `level` 1…12, 0 — без сжатия (`store`).
pub fn compress(payload: &[u8], level: i32) -> Result<Vec<u8>> {
    if level == 0 {
        return Ok(store(payload));
    }
    let level = CompressionLvl::new(level)
        .map_err(|_| Error::argument("Уровень сжатия — от 0 (без сжатия) до 12."))?;
    let mut compressor = Compressor::new(level);
    let mut out = vec![0u8; compressor.zlib_compress_bound(payload.len())];
    let used = compressor
        .zlib_compress(payload, &mut out)
        .map_err(|_| Error::operation("Сжатие сцены не удалось."))?;
    out.truncate(used);
    Ok(out)
}

/// Файл сцены: нагрузка в zlib. Читается окном (`unzlibSync`) и кэшем так же, как файл `encodeShopScene`.
pub fn encode(scene: &Scene, options: &Options) -> Result<Vec<u8>> {
    compress(&encode_payload(scene, options), options.level)
}

#[cfg(test)]
mod tests;
