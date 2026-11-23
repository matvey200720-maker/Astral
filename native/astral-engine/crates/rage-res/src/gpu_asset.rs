//! Формат ARS2: меш в виде, который окно лаунчера отдаёт видеокарте почти без пересчёта.
//!
//! Позиции лежат 16-битными целыми внутри рамки, нормали — октаэдрической
//! парой байтов, UV — половинной точностью, индексы — 16 или 32 бита.

use serde_json::{json, Value};

use crate::error::{Error, Result};

const MAX_VERTICES: usize = 4_000_000;
const MAX_INDICES: usize = 16_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lod {
    pub name: String,
    pub first: u32,
    pub count: u32,
}

pub const VERSION: u32 = 1;
pub const MAGIC: [u8; 4] = *b"ARS2";

const PREFIX: usize = 12;
/// Индекс 65535 в 16-битном буфере WebGL2 читает как перезапуск примитива.
const RESTART: u32 = 0xffff;

// ---------------------------------------------------------------- half

pub fn f32_to_f16(value: f32) -> u16 {
    const INF: u16 = 0x7c00;
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let fraction = bits & 0x007f_ffff;
    let exp = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    if (bits >> 23) & 0xff == 0xff {
        return sign | INF | (0x200 * u16::from(fraction != 0));
    }
    if exp >= 31 {
        return sign | INF;
    }
    if exp <= 0 {
        return sign;
    }
    // Порядок и мантисса вместе: перенос из мантиссы сам увеличивает порядок.
    let rest = fraction & 0x1fff;
    let tie_to_odd = rest == 0x1000 && (fraction >> 13) & 1 == 1;
    let up = u32::from(rest > 0x1000 || tie_to_odd);
    let packed = ((exp as u32) << 10 | (fraction >> 13)) + up;
    match packed >> 10 >= 31 {
        true => sign | INF,
        false => sign | packed as u16,
    }
}

pub fn f16_to_f32(half: u16) -> f32 {
    let wide = u32::from(half);
    let sign = (wide & 0x8000) << 16;
    let exp = (wide >> 10) & 0x1f;
    let fraction = (wide & 0x3ff) << 13;
    let body = match exp {
        0 => 0,
        31 => 0x7f80_0000 | fraction,
        _ => ((exp + 112) << 23) | fraction,
    };
    f32::from_bits(sign | body)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    pub material: String,
    pub first: u32,
    pub count: u32,
}

fn up4(n: usize) -> usize {
    (n + 3) & !3
}

// ------------------------------------------------------ октаэдр нормалей

fn sign_of(v: f32) -> f32 {
    match v >= 0.0 {
        true => 1.0,
        false => -1.0,
    }
}

/// Складка нижней полусферы: общая для упаковки и распаковки.
fn fold(x: f32, y: f32) -> (f32, f32) {
    let (ax, ay) = (x.abs(), y.abs());
    (sign_of(x) * (1.0 - ay), sign_of(y) * (1.0 - ax))
}

fn pack_normal(n: [f32; 3]) -> [i8; 2] {
    let [nx, ny, nz] = n;
    let len = (nx * nx + ny * ny + nz * nz).sqrt();
    let usable = len.is_finite() && len > 0.0;
    let [x, y, z] = match usable {
        true => [nx / len, ny / len, nz / len],
        false => [0.0, 0.0, 1.0],
    };
    let l = x.abs() + y.abs() + z.abs();
    let flat = (x / l, y / l);
    let (x, y) = if z < 0.0 { fold(flat.0, flat.1) } else { flat };
    [x, y].map(|v| (v * 127.0).round().clamp(-127.0, 127.0) as i8)
}

fn unpack_normal(pair: [i8; 2]) -> [f32; 3] {
    let (x, y) = (f32::from(pair[0]) / 127.0, f32::from(pair[1]) / 127.0);
    let z = 1.0 - x.abs() - y.abs();
    let (x, y) = if z < 0.0 { fold(x, y) } else { (x, y) };
    let len = (x * x + y * y + z * z).sqrt();
    match len >= f32::MIN_POSITIVE {
        true => [x / len, y / len, z / len],
        false => [0.0, 0.0, 1.0],
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub batches: Vec<Batch>,
    pub lods: Vec<Lod>,
}

// ------------------------------------------------------------- рамка

struct Frame {
    center: [f32; 3],
    half: [f32; 3],
}

impl Frame {
    fn around(points: &[[f32; 3]]) -> Self {
        let start = ([f32::MAX; 3], [f32::MIN; 3]);
        let (low, high) = points.iter().fold(start, |(low, high), p| {
            (
                std::array::from_fn(|a| low[a].min(p[a])),
                std::array::from_fn(|a| high[a].max(p[a])),
            )
        });
        let middle = |a: usize| (low[a] + high[a]) * 0.5;
        let reach = |a: usize| ((high[a] - low[a]) * 0.5).max(1e-6);
        Self {
            center: std::array::from_fn(middle),
            half: std::array::from_fn(reach),
        }
    }

    fn quantise(&self, p: [f32; 3]) -> [i16; 3] {
        std::array::from_fn(|a| {
            let scaled = (p[a] - self.center[a]) / self.half[a] * 32767.0;
            scaled.round().clamp(-32767.0, 32767.0) as i16
        })
    }

    fn restore(&self, q: [i16; 3]) -> [f32; 3] {
        std::array::from_fn(|a| f32::from(q[a]) / 32767.0 * self.half[a] + self.center[a])
    }
}

// ----------------------------------------------------------- запись

fn finite_all<'a>(mut values: impl Iterator<Item = &'a f32>) -> bool {
    values.all(|v| v.is_finite())
}

/// Первая нарушенная проверка меша: текст отказа. Порядок проверок важен.
fn refusal(mesh: &Mesh) -> Option<&'static str> {
    let vertices = mesh.positions.len();
    let total = mesh.indices.len() as u64;
    let outside = |first: u32, count: u32| u64::from(first) + u64::from(count) > total;
    let rules: [(&'static str, Box<dyn Fn() -> bool + '_>); 9] = [
        (
            "У вершин разное число позиций, нормалей и UV.",
            Box::new(|| mesh.normals.len() != vertices || mesh.uvs.len() != vertices),
        ),
        (
            "Меш больше предела ARS2.",
            Box::new(|| vertices > MAX_VERTICES || mesh.indices.len() > MAX_INDICES),
        ),
        (
            "Индексов не кратно трём: это не треугольники.",
            Box::new(|| mesh.indices.len() % 3 != 0),
        ),
        (
            "В позициях модели есть не-числа (NaN или бесконечность).",
            Box::new(|| !finite_all(mesh.positions.iter().flatten())),
        ),
        (
            "В нормалях модели есть не-числа (NaN или бесконечность).",
            Box::new(|| !finite_all(mesh.normals.iter().flatten())),
        ),
        (
            "В UV модели есть не-числа (NaN или бесконечность).",
            Box::new(|| !finite_all(mesh.uvs.iter().flatten())),
        ),
        (
            "Индекс смотрит мимо вершин.",
            Box::new(|| mesh.indices.iter().any(|&i| i as usize >= vertices)),
        ),
        (
            "партия выходит за индексы меша.",
            Box::new(|| mesh.batches.iter().any(|b| outside(b.first, b.count))),
        ),
        (
            "LOD выходит за индексы меша.",
            Box::new(|| mesh.lods.iter().any(|l| outside(l.first, l.count))),
        ),
    ];
    let first = rules
        .into_iter()
        .find(|(_, violated)| violated())
        .map(|(text, _)| text);
    first
}

fn pad_to_four(out: &mut Vec<u8>) {
    out.resize(up4(out.len()), 0);
}

/// Текст заголовка ARS2: счётчики, тип индексов, рамка, партии и LOD.
fn header_bytes(mesh: &Mesh, frame: &Frame, wide: bool) -> Vec<u8> {
    let batches: Vec<Value> = mesh
        .batches
        .iter()
        .map(|b| json!({ "material": b.material, "first": b.first, "count": b.count }))
        .collect();
    let lods: Vec<Value> = mesh
        .lods
        .iter()
        .map(|l| json!({ "name": l.name, "first": l.first, "count": l.count }))
        .collect();
    let header = json!({
        "version": VERSION,
        "vertexCount": mesh.positions.len(),
        "indexCount": mesh.indices.len(),
        "indexType": if wide { "u32" } else { "u16" },
        "bounds": { "center": frame.center, "half": frame.half },
        "batches": batches,
        "lods": lods,
    });
    serde_json::to_vec(&header).unwrap_or_default()
}

pub fn encode(mesh: &Mesh) -> Result<Vec<u8>> {
    if let Some(text) = refusal(mesh) {
        return Err(Error::argument(text));
    }
    let frame = Frame::around(&mesh.positions);
    let wide = mesh.indices.iter().any(|&i| i >= RESTART);
    let header = header_bytes(mesh, &frame, wide);

    let mut out = Vec::with_capacity(
        up4(PREFIX + header.len()) + mesh.positions.len() * 12 + mesh.indices.len() * 4,
    );
    let prefix: [&[u8]; 4] = [
        &MAGIC,
        &VERSION.to_le_bytes(),
        &(header.len() as u32).to_le_bytes(),
        &header,
    ];
    for part in prefix {
        out.extend_from_slice(part);
    }
    pad_to_four(&mut out);

    let sections: [Vec<u8>; 4] = [
        mesh.positions
            .iter()
            .flat_map(|p| frame.quantise(*p).into_iter().flat_map(i16::to_le_bytes))
            .collect(),
        mesh.normals
            .iter()
            .flat_map(|n| pack_normal(*n).map(|b| b as u8))
            .collect(),
        mesh.uvs
            .iter()
            .flat_map(|uv| uv.iter().flat_map(|&c| f32_to_f16(c).to_le_bytes()))
            .collect(),
        mesh.indices
            .iter()
            .flat_map(|&i| match wide {
                true => i.to_le_bytes().to_vec(),
                false => (i as u16).to_le_bytes().to_vec(),
            })
            .collect(),
    ];
    for section in &sections {
        out.extend_from_slice(section);
        pad_to_four(&mut out);
    }
    Ok(out)
}

// ----------------------------------------------------------- чтение

fn count_of(header: &Value, key: &str) -> Result<u64> {
    let found = header.get(key).and_then(Value::as_u64);
    found.ok_or_else(|| Error::broken(format!("В заголовке ARS2 нет числа «{key}».")))
}

fn triple(bounds: &Value, key: &str) -> Result<[f32; 3]> {
    let items = match bounds.get(key).and_then(Value::as_array) {
        Some(items) if items.len() == 3 => items,
        _ => return Err(Error::broken("Рамка ARS2 неполна.")),
    };
    let mut out = [0.0f32; 3];
    for (slot, item) in out.iter_mut().zip(items) {
        let number = item.as_f64();
        *slot = number.ok_or_else(|| Error::broken("Рамка ARS2 не числа."))? as f32;
    }
    Ok(out)
}

/// Партии и LOD читаются одинаково: диапазон `first..first+count` внутри индексов.
fn ranges<T>(
    header: &Value,
    key: &str,
    index_count: u64,
    outside: &str,
    build: impl Fn(String, u32, u32) -> T,
) -> Result<Vec<T>> {
    let Some(list) = header.get(key).and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut built = Vec::with_capacity(list.len());
    for entry in list {
        let first = count_of(entry, "first")?;
        let count = count_of(entry, "count")?;
        let within = first.checked_add(count).filter(|&end| end <= index_count);
        let (Some(_), Ok(first), Ok(count)) = (within, u32::try_from(first), u32::try_from(count))
        else {
            return Err(Error::broken(outside));
        };
        let label = entry.get("name").or_else(|| entry.get("material"));
        let name = label.and_then(Value::as_str).unwrap_or_default();
        built.push(build(name.to_owned(), first, count));
    }
    Ok(built)
}

/// Куски по `N` байт из секции с известной длиной.
fn lanes<const N: usize>(bytes: &[u8]) -> impl Iterator<Item = [u8; N]> + '_ {
    bytes.chunks_exact(N).map(|c| std::array::from_fn(|i| c[i]))
}

/// Отрезает от начала `rest` секции заданных длин; границы проверены заранее.
fn split_sections<'a>(rest: &mut &'a [u8], sizes: [usize; 4]) -> [&'a [u8]; 4] {
    sizes.map(|len| {
        let (head, tail) = rest.split_at(len);
        *rest = tail;
        head
    })
}

/// Первые `k` индексов секции; индекс за вершинами или рестарт в 16 битах — ошибка.
fn read_indices(section: &[u8], wide: bool, k: usize, vertices: usize) -> Result<Vec<u32>> {
    let raw: Vec<u32> = match wide {
        true => lanes::<4>(section)
            .map(u32::from_le_bytes)
            .take(k)
            .collect(),
        false => lanes::<2>(section)
            .map(|c| u32::from(u16::from_le_bytes(c)))
            .take(k)
            .collect(),
    };
    for &index in &raw {
        if index as usize >= vertices {
            return Err(Error::broken("Индекс ARS2 смотрит мимо вершин."));
        }
        if !wide && index == RESTART {
            return Err(Error::broken(
                "В ARS2 с u16-индексами стоит 65535: рестарт примитива в WebGL2.",
            ));
        }
    }
    Ok(raw)
}

/// Разбирает приставку и заголовок; отдаёт JSON заголовка и конец его текста.
fn read_header(bytes: &[u8]) -> Result<(Value, usize)> {
    if bytes.len() < PREFIX || bytes[..4] != MAGIC {
        return Err(Error::broken("Файл не ARS2."));
    }
    let word =
        |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let version = word(4);
    if version != VERSION {
        return Err(Error::version(format!(
            "ARS2 версии {version} не поддерживается."
        )));
    }
    let header_end = PREFIX
        .checked_add(word(8) as usize)
        .filter(|&end| end <= bytes.len())
        .ok_or_else(|| Error::broken("Заголовок ARS2 обрезан."))?;
    let header: Value = serde_json::from_slice(&bytes[PREFIX..header_end])
        .map_err(|e| Error::broken(e.to_string()))?;
    Ok((header, header_end))
}

/// Счётчики вершин и индексов из заголовка, в пределах формата.
fn read_counts(header: &Value) -> Result<(u64, u64)> {
    let vertex_count = count_of(header, "vertexCount")?;
    let index_count = count_of(header, "indexCount")?;
    let out_of_range = vertex_count > MAX_VERTICES as u64
        || index_count > MAX_INDICES as u64
        || index_count % 3 != 0;
    match out_of_range {
        true => Err(Error::broken("Счётчики ARS2 вне пределов.")),
        false => Ok((vertex_count, index_count)),
    }
}

pub fn decode(bytes: &[u8]) -> Result<Mesh> {
    let (header, header_end) = read_header(bytes)?;
    let (vertex_count, index_count) = read_counts(&header)?;
    let wide = match header.get("indexType").and_then(Value::as_str) {
        Some("u16") => false,
        Some("u32") => true,
        _ => return Err(Error::broken("В ARS2 неизвестный тип индексов.")),
    };
    let (v, k) = (vertex_count as usize, index_count as usize);
    let index_size = if wide { 4 } else { 2 };
    let sizes = [up4(6 * v), up4(2 * v), up4(4 * v), up4(index_size * k)];
    let needed = up4(header_end) + sizes.iter().sum::<usize>();
    if bytes.len() < needed {
        return Err(Error::broken("Модель ARS2 обрезана."));
    }

    let bounds = header
        .get("bounds")
        .ok_or_else(|| Error::broken("В ARS2 нет рамки."))?;
    let frame = Frame {
        center: triple(bounds, "center")?,
        half: triple(bounds, "half")?,
    };

    let mut rest = &bytes[up4(header_end)..];
    let [pos, nrm, uv, idx] = split_sections(&mut rest, sizes);
    let indices = read_indices(idx, wide, k, v)?;

    let batches = ranges(
        &header,
        "batches",
        index_count,
        "Партия ARS2 выходит за индексы.",
        |material, first, count| Batch {
            material,
            first,
            count,
        },
    )?;
    let lods = ranges(
        &header,
        "lods",
        index_count,
        "LOD ARS2 выходит за индексы.",
        |name, first, count| Lod { name, first, count },
    )?;

    let positions = lanes::<6>(pos)
        .take(v)
        .map(|c| {
            let q = std::array::from_fn(|a| i16::from_le_bytes([c[a * 2], c[a * 2 + 1]]));
            frame.restore(q)
        })
        .collect();
    let normals = lanes::<2>(nrm)
        .take(v)
        .map(|c| unpack_normal([c[0] as i8, c[1] as i8]))
        .collect();
    let uvs = lanes::<4>(uv)
        .take(v)
        .map(|c| {
            let half = |at: usize| f16_to_f32(u16::from_le_bytes([c[at], c[at + 1]]));
            [half(0), half(2)]
        })
        .collect();
    Ok(Mesh {
        positions,
        normals,
        uvs,
        indices,
        batches,
        lods,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;

    fn quad() -> Mesh {
        let mut mesh = Mesh::default();
        mesh.indices = vec![0, 1, 2, 0, 2, 3];
        mesh.uvs = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 2.5], [0.0, 2.5]];
        mesh.normals = vec![[0.0, 0.0, 1.0]; 4];
        mesh.positions = vec![
            [-1.0, -1.0, 0.0],
            [1.0, -1.0, 0.0],
            [1.0, 1.0, 0.5],
            [-1.0, 1.0, 0.5],
        ];
        mesh.batches.push(Batch {
            material: "paint".into(),
            first: 0,
            count: 6,
        });
        mesh.lods.push(Lod {
            name: "#high".into(),
            first: 0,
            count: 6,
        });
        mesh
    }

    fn hex(bytes: &[u8]) -> String {
        let mut text = String::new();
        for b in bytes {
            text.push_str(&format!("{b:02x}"));
        }
        text
    }

    fn header_len(bytes: &[u8]) -> usize {
        u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize
    }

    fn header_json(bytes: &[u8]) -> String {
        String::from_utf8(bytes[12..12 + header_len(bytes)].to_vec()).unwrap()
    }

    /// Файл quad с заголовком, правленным функцией; секции переезжают на новые места.
    fn with_header(f: impl FnOnce(&mut Value)) -> Vec<u8> {
        let file = encode(&quad()).unwrap();
        let old_end = up4(12 + header_len(&file));
        let mut header: Value = serde_json::from_slice(&file[12..12 + header_len(&file)]).unwrap();
        f(&mut header);
        let json = serde_json::to_vec(&header).unwrap();
        let mut out = file[..8].to_vec();
        out.extend_from_slice(&(json.len() as u32).to_le_bytes());
        out.extend_from_slice(&json);
        pad_to_four(&mut out);
        out.extend_from_slice(&file[old_end..]);
        out
    }

    /// quad с заголовком, правленным функцией, разобран без ошибок.
    fn lenient(f: impl FnOnce(&mut Value)) -> Mesh {
        decode(&with_header(f)).unwrap()
    }

    /// Тот же файл, но разбор обязан отказать с этим текстом.
    fn rejects(f: impl FnOnce(&mut Value), text: &str) {
        broken(decode(&with_header(f)), text);
    }

    /// Кодирует меш и сразу разбирает.
    fn round(mesh: &Mesh) -> Mesh {
        decode(&encode(mesh).unwrap()).unwrap()
    }

    fn err(r: Result<impl std::fmt::Debug>) -> (Kind, String) {
        let e = r.unwrap_err();
        (e.kind, e.message)
    }

    fn broken(r: Result<impl std::fmt::Debug>, text: &str) {
        assert_eq!(err(r), (Kind::Broken, text.to_string()));
    }

    fn argument(r: Result<impl std::fmt::Debug>, text: &str) {
        assert_eq!(err(r), (Kind::Argument, text.to_string()));
    }

    /// quad, испорченный правкой, отвергается кодированием с этим текстом.
    fn refused(edit: impl FnOnce(&mut Mesh), text: &str) {
        let mut mesh = quad();
        edit(&mut mesh);
        argument(encode(&mesh), text);
    }

    fn tri(vertices: usize, indices: Vec<u32>) -> Mesh {
        let mut mesh = Mesh::default();
        mesh.uvs = vec![[0.0; 2]; vertices];
        mesh.normals = vec![[0.0, 0.0, 1.0]; vertices];
        mesh.positions = vec![[0.0; 3]; vertices];
        mesh.indices = indices;
        mesh
    }

    #[test]
    fn constants_and_types() {
        assert_eq!(MAGIC, [65, 82, 83, 50]);
        assert_eq!(VERSION, 1);
        let batch = Batch {
            material: "m".into(),
            first: 1,
            count: 2,
        };
        let lod = Lod {
            name: "n".into(),
            first: 3,
            count: 4,
        };
        assert_eq!(
            format!("{:?} {:?} {:?}", batch, lod, Mesh::default()),
            "Batch { material: \"m\", first: 1, count: 2 } Lod { name: \"n\", first: 3, count: 4 } Mesh { positions: [], normals: [], uvs: [], indices: [], batches: [], lods: [] }"
        );
    }

    #[test]
    fn a1_quad_bytes() {
        let file = encode(&quad()).unwrap();
        assert_eq!(file.len(), 292);
        assert_eq!(
            hex(&file),
            "4152533201000000da0000007b2276657273696f6e223a312c22766572746578436f756e74223a342c22696e646578436f756e74223a362c22696e64657854797065223a22753136222c22626f756e6473223a7b2263656e746572223a5b302e302c302e302c302e32355d2c2268616c66223a5b312e302c312e302c302e32355d7d2c2262617463686573223a5b7b226d6174657269616c223a227061696e74222c226669727374223a302c22636f756e74223a367d5d2c226c6f6473223a5b7b226e616d65223a222368696768222c226669727374223a302c22636f756e74223a367d5d7d0000018001800180ff7f01800180ff7fff7fff7f0180ff7fff7f000000000000000000000000003c0000003c004100000041000001000200000002000300"
        );
        assert_eq!(
            header_json(&file),
            r##"{"version":1,"vertexCount":4,"indexCount":6,"indexType":"u16","bounds":{"center":[0.0,0.0,0.25],"half":[1.0,1.0,0.25]},"batches":[{"material":"paint","first":0,"count":6}],"lods":[{"name":"#high","first":0,"count":6}]}"##
        );
    }

    #[test]
    fn a2_round_trip() {
        assert_eq!(round(&quad()), quad());
    }

    #[test]
    fn a3_empty_mesh() {
        let file = encode(&Mesh::default()).unwrap();
        assert_eq!(
            hex(&file),
            "4152533201000000bf0000007b2276657273696f6e223a312c22766572746578436f756e74223a302c22696e646578436f756e74223a302c22696e64657854797065223a22753136222c22626f756e6473223a7b2263656e746572223a5b302e302c302e302c302e305d2c2268616c66223a5b392e393939393939393734373532343237652d372c392e393939393939393734373532343237652d372c392e393939393939393734373532343237652d375d7d2c2262617463686573223a5b5d2c226c6f6473223a5b5d7d00"
        );
        assert_eq!(decode(&file).unwrap(), Mesh::default());
    }

    #[test]
    fn a4_single_point() {
        let mut m = tri(3, vec![0, 1, 2]);
        m.positions = vec![[5.0, 6.0, 7.0]; 3];
        let file = encode(&m).unwrap();
        let start = up4(12 + header_len(&file));
        let body = hex(&file[start..]);
        assert_eq!(
            "00000000000000000000000000000000000000000000000000000000000000000000010002000000",
            &body[16..]
        );
        let back = decode(&file).unwrap();
        assert_eq!(back.positions, vec![[5.0, 6.0, 7.0]; 3]);
        assert_eq!(back.normals, vec![[0.0, 0.0, 1.0]; 3]);
    }

    #[test]
    fn a5_a19_encode_refusals() {
        let counts = "У вершин разное число позиций, нормалей и UV.";
        let not_finite =
            |what: &str| format!("В {what} модели есть не-числа (NaN или бесконечность).");
        refused(
            |m| {
                m.normals.pop();
            },
            counts,
        );
        refused(
            |m| {
                m.uvs.pop();
            },
            counts,
        );
        refused(
            |m| m.indices.push(0),
            "Индексов не кратно трём: это не треугольники.",
        );
        refused(|m| m.indices[0] = 4, "Индекс смотрит мимо вершин.");
        refused(|m| m.positions[0][0] = f32::NAN, &not_finite("позициях"));
        refused(|m| m.normals[0][1] = f32::INFINITY, &not_finite("нормалях"));
        refused(|m| m.uvs[1][0] = f32::NEG_INFINITY, &not_finite("UV"));
        refused(
            |m| m.batches[0].first = 4,
            "партия выходит за индексы меша.",
        );
        refused(
            |m| {
                m.lods[0].first = 6;
                m.lods[0].count = 1;
            },
            "LOD выходит за индексы меша.",
        );
        refused(
            |m| {
                m.batches[0] = Batch {
                    material: "x".into(),
                    first: u32::MAX,
                    count: u32::MAX,
                }
            },
            "партия выходит за индексы меша.",
        );
        let mut m = quad();
        m.batches[0] = Batch {
            material: "paint".into(),
            first: 6,
            count: 0,
        };
        assert_eq!(encode(&m).unwrap().len(), 292);
        // порядок проверок
        refused(
            |m| {
                m.normals.pop();
                m.indices.push(0);
                m.positions[0][0] = f32::NAN;
            },
            counts,
        );
        refused(
            |m| {
                m.indices.push(0);
                m.positions[0][0] = f32::NAN;
            },
            "Индексов не кратно трём: это не треугольники.",
        );
        refused(
            |m| {
                m.positions[0][0] = f32::NAN;
                m.indices[0] = 9;
            },
            &not_finite("позициях"),
        );
        refused(
            |m| {
                m.indices[0] = 9;
                m.batches[0].count = 99;
            },
            "Индекс смотрит мимо вершин.",
        );
    }

    #[test]
    fn a80_a82_limits() {
        let mut m = Mesh::default();
        m.uvs = vec![[0.0; 2]; 4_000_001];
        m.normals = vec![[0.0; 3]; 4_000_001];
        m.positions = vec![[0.0; 3]; 4_000_001];
        argument(encode(&m), "Меш больше предела ARS2.");
        let mut m = tri(1, vec![]);
        m.indices = vec![0; 16_000_001];
        argument(encode(&m), "Меш больше предела ARS2.");
        assert_eq!(encode(&tri(4_000_000, vec![])).unwrap().len(), 48_000_212);
    }

    #[test]
    fn a20_a28_normals_round_trip() {
        let cases: [([f32; 3], [f32; 3]); 9] = [
            ([0.0, 0.0, 1.0], [0.0, 0.0, 1.0]),
            ([0.0, 0.0, -1.0], [0.0, 0.0, -1.0]),
            ([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]),
            ([0.0, -1.0, 0.0], [0.0, -1.0, 0.0]),
            ([0.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
            ([3.0, 4.0, 0.0], [0.5947007, 0.8039472, -8.336592e-8]),
            (
                [0.57735026, 0.57735026, -0.57735026],
                [0.5727687, 0.5727687, -0.58640593],
            ),
            ([1e-30, 0.0, 0.0], [0.0, 0.0, 1.0]),
            ([-1.0, -1.0, -1.0], [-0.5727687, -0.5727687, -0.58640593]),
        ];
        for (input, expected) in cases {
            let round = unpack_normal(pack_normal(input));
            assert_eq!(round, expected, "{input:?}");
        }
        let huge = unpack_normal(pack_normal([1e30, 0.0, 0.0]));
        assert_eq!(huge, [0.0, 0.0, 1.0]);
    }

    #[test]
    fn a29_normal_bytes() {
        let sample = [
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
            [1.0, 0.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, 0.0],
            [1.0, 1.0, -1.0],
        ];
        let mut bytes: Vec<u8> = Vec::new();
        for n in sample {
            bytes.extend(pack_normal(n).map(|b| b as u8));
        }
        assert_eq!(hex(&bytes), "00007f7f7f00008100005555");
    }

    #[test]
    fn a30_a47_to_half() {
        let cases: [(f32, u16, f32); 17] = [
            (0.0, 0x0000, 0.0),
            (1.0, 0x3c00, 1.0),
            (0.1, 0x2e66, 0.099975586),
            (65504.0, 0x7bff, 65504.0),
            (65520.0, 0x7c00, f32::INFINITY),
            (1e-5, 0x0000, 0.0),
            (6.1e-5, 0x0000, 0.0),
            (6.104e-5, 0x0400, 6.1035156e-5),
            (f32::INFINITY, 0x7c00, f32::INFINITY),
            (f32::NEG_INFINITY, 0xfc00, f32::NEG_INFINITY),
            (1_000_000.0, 0x7c00, f32::INFINITY),
            (2.5, 0x4100, 2.5),
            (1.0004883, 0x3c00, 1.0),
            (1.0004884, 0x3c01, 1.0009766),
            (-2.5, 0xc100, -2.5),
            (6.1035156e-5, 0x0400, 6.1035156e-5),
            (-1e-5, 0x8000, -0.0),
        ];
        for (value, half, back) in cases {
            assert_eq!(f32_to_f16(value), half, "{value}");
            assert_eq!(f16_to_f32(half).to_bits(), back.to_bits(), "{half:#x}");
        }
        assert_eq!(f32_to_f16(-0.0), 0x8000);
        assert_eq!(f16_to_f32(0x8000).to_bits(), 0x8000_0000);
        assert_eq!(f32_to_f16(f32::NAN), 0x7e00);
        assert_eq!(f32_to_f16(f32::from_bits(0x7f80_0001)), 0x7e00);
        assert_eq!(f32_to_f16(-f32::NAN), 0xfe00);
        assert!(f16_to_f32(0x7e00).is_nan());
    }

    #[test]
    fn a50_a62_from_half() {
        let cases: [(u16, u32); 12] = [
            (0x0000, 0x0000_0000),
            (0x8000, 0x8000_0000),
            (0x0001, 0x0000_0000),
            (0x03ff, 0x0000_0000),
            (0x0400, 0x3880_0000),
            (0x7bff, 0x477f_e000),
            (0x7c00, 0x7f80_0000),
            (0xfc00, 0xff80_0000),
            (0x7e00, 0x7fc0_0000),
            (0x7c01, 0x7f80_2000),
            (0xffff, 0xffff_e000),
            (0x3c00, 0x3f80_0000),
        ];
        for (half, bits) in cases {
            assert_eq!(f16_to_f32(half).to_bits(), bits, "{half:#x}");
        }
        assert_eq!(f16_to_f32(0x3555).to_bits(), 0x3eaa_a000);
        assert_eq!(f16_to_f32(0x3555), 0.33325195);
    }

    #[test]
    fn a65_a70_rounding() {
        let step = 2f32.powi(-11);
        assert_eq!(f32_to_f16(1.0 + step), 0x3c00);
        assert_eq!(f32_to_f16(1.0 + step + 2f32.powi(-23)), 0x3c01);
        assert_eq!(f32_to_f16(1.0 + 3.0 * step), 0x3c02);
        assert_eq!(f32_to_f16(2047.5), 0x6800);
        assert_eq!(f32_to_f16(65519.99), 0x7bff);
        assert_eq!(f32_to_f16(6.0e-8), 0x0000);
    }

    #[test]
    fn a71_a73_wide_threshold() {
        let sizes = [
            (65535usize, 786_632usize, false),
            (65536, 786_644, true),
            (65537, 786_660, true),
        ];
        for (n, size, wide) in sizes {
            let mut mesh = tri(n, vec![0, 1, n as u32 - 1]);
            mesh.positions[0] = [1.0, 2.0, 3.0];
            let file = encode(&mesh).unwrap();
            let item = if wide { 4 } else { 2 };
            let sections = up4(6 * n) + up4(2 * n) + up4(4 * n) + up4(3 * item);
            assert_eq!(file.len(), up4(12 + header_len(&file)) + sections, "{size}");
            assert_eq!(header_json(&file).contains("\"u32\""), wide);
        }
    }

    #[test]
    fn a90_a93_precision_and_layout() {
        let mut m = tri(3, vec![0, 1, 2]);
        m.positions = vec![
            [-1000.0, 0.0, 12.5],
            [1000.0, 3.0, 12.5],
            [0.12207404, 1.0000153, 12.5],
        ];
        let file = encode(&m).unwrap();
        let start = up4(12 + header_len(&file));
        assert_eq!(
            header_json(&file),
            r#"{"version":1,"vertexCount":3,"indexCount":3,"indexType":"u16","bounds":{"center":[0.0,1.5,12.5],"half":[1000.0,1.5,9.999999974752427e-7]},"batches":[],"lods":[]}"#
        );
        assert_eq!(
            hex(&file[start..start + 18]),
            "018001800000ff7fff7f0000040056d50000"
        );
        let back = decode(&file).unwrap();
        assert_eq!(
            back.positions,
            vec![
                [-1000.0, 0.0, 12.5],
                [1000.0, 3.0, 12.5],
                [0.12207404, 1.0000153, 12.5]
            ]
        );

        let sizes = [
            encode(&tri(1, vec![0, 0, 0])).unwrap(),
            encode(&tri(5, vec![0, 0, 0])).unwrap(),
        ];
        assert_eq!(sizes[0].len(), 228);
        assert_eq!(sizes[1].len(), 276);
        assert_eq!(
            sizes.iter().map(|f| header_len(f)).collect::<Vec<_>>(),
            vec![191, 191]
        );
    }

    #[test]
    fn a92_uv_values() {
        let mut m = tri(3, vec![0, 1, 2]);
        m.uvs = vec![[1e6, -0.3], [0.3333, 0.0], [-65504.0, 3.140625]];
        let expected = vec![
            [f32::INFINITY, -0.30004883],
            [0.33325195, 0.0],
            [-65504.0, 3.140625],
        ];
        assert_eq!(round(&m).uvs, expected);
    }

    #[test]
    fn a101_a103_unrepresentable_frame() {
        let mut m = tri(3, vec![0, 1, 2]);
        m.positions = vec![[3e38, 0.0, 0.0], [-3e38, 0.0, 0.0], [0.0, 0.0, 0.0]];
        let file = encode(&m).unwrap();
        assert_eq!(
            header_json(&file),
            "{\"version\":1,\"vertexCount\":3,\"indexCount\":3,\"indexType\":\"u16\",\"bounds\":{\"center\":[0.0,0.0,0.0],\"half\":[null,9.999999974752427e-7,9.999999974752427e-7]},\"batches\":[],\"lods\":[]}"
        );
        broken(decode(&file), "Рамка ARS2 не числа.");
        let mut m = tri(3, vec![0, 1, 2]);
        m.positions = vec![[f32::MAX, 0.0, 0.0]; 3];
        broken(decode(&encode(&m).unwrap()), "Рамка ARS2 не числа.");
    }

    #[test]
    fn a105_a107_decode_leniency() {
        let mut m = tri(3, vec![0, 1, 2]);
        m.positions = vec![[0.0, 0.0, 0.0], [1.0, 3.0, 0.0], [0.0, 0.0, 0.0]];
        let file = encode(&m).unwrap();
        let start = up4(12 + header_len(&file));
        // половинки рамки заменяем на 0, -1, 2: числа не проверяются
        let text = header_json(&file).replace(
            "\"half\":[0.5,1.5,9.999999974752427e-7]",
            "\"half\":[0.0,-1.0,2.0]",
        );
        let mut out = file[..8].to_vec();
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
        out.extend_from_slice(text.as_bytes());
        pad_to_four(&mut out);
        out.extend_from_slice(&file[start..]);
        let back = decode(&out).unwrap();
        assert_eq!(
            back.positions,
            vec![[0.5, 2.5, 0.0], [0.5, 0.5, 0.0], [0.5, 2.5, 0.0]]
        );

        let file = encode(&tri(1, vec![])).unwrap();
        let start = up4(12 + header_len(&file)) + 8;
        let mut patched = file.clone();
        patched[start..start + 2].copy_from_slice(&[0x80, 0x80]);
        assert_eq!(
            decode(&patched).unwrap().normals,
            vec![[0.0077514686, 0.0077514686, -0.9999399]]
        );
        patched[start..start + 2].copy_from_slice(&[0, 0]);
        assert_eq!(decode(&patched).unwrap().normals, vec![[0.0, 0.0, 1.0]]);
    }

    #[test]
    fn da1_da9_prefix_errors() {
        broken(decode(&[]), "Файл не ARS2.");
        broken(decode(&[0u8; 11]), "Файл не ARS2.");
        let good = encode(&quad()).unwrap();
        broken(decode(&good[..12]), "Заголовок ARS2 обрезан.");
        // Испорченный файл: копия хорошего, поправленная функцией.
        let spoiled = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut bad = good.clone();
            edit(&mut bad);
            decode(&bad)
        };
        broken(spoiled(&|b| b[0] = b'X'), "Файл не ARS2.");
        assert_eq!(
            err(spoiled(&|b| b[4] = 2)),
            (
                Kind::Version,
                "ARS2 версии 2 не поддерживается.".to_string()
            )
        );
        let wipe = |b: &mut Vec<u8>, word: u32| b[8..12].copy_from_slice(&word.to_le_bytes());
        broken(spoiled(&|b| wipe(b, u32::MAX)), "Заголовок ARS2 обрезан.");
        broken(
            spoiled(&|b| wipe(b, 0)),
            "EOF while parsing a value at line 1 column 0",
        );
        broken(decode(&good[..good.len() - 1]), "Модель ARS2 обрезана.");
        let mut tail = good.clone();
        tail.extend_from_slice(&[1, 2, 3]);
        assert_eq!(decode(&tail).unwrap().indices.len(), 6);
        broken(
            spoiled(&|b| b[12] = b'#'),
            "expected value at line 1 column 1",
        );
        broken(
            spoiled(&|b| b[12..14].copy_from_slice(b"##")),
            "expected value at line 1 column 1",
        );
    }

    type Patch = Box<dyn FnOnce(&mut Value)>;

    #[test]
    fn da10_da22_header_fields() {
        let gone = |key: &'static str| -> Patch {
            Box::new(move |h| {
                h.as_object_mut().unwrap().remove(key);
            })
        };
        let set = |key: &'static str, value: Value| -> Patch { Box::new(move |h| h[key] = value) };
        let no_vertex_count = "В заголовке ARS2 нет числа «vertexCount».";
        let out_of_range = "Счётчики ARS2 вне пределов.";
        let no_index_type = "В ARS2 неизвестный тип индексов.";
        let cases: Vec<(Patch, &str)> = vec![
            (gone("vertexCount"), no_vertex_count),
            (set("vertexCount", json!("4")), no_vertex_count),
            (set("vertexCount", json!(4000001)), out_of_range),
            (set("indexCount", json!(7)), out_of_range),
            (set("indexCount", json!(16000002)), out_of_range),
            (set("indexType", json!("u8")), no_index_type),
            (gone("indexType"), no_index_type),
            (gone("bounds"), "В ARS2 нет рамки."),
            (
                Box::new(|h| h["bounds"]["center"] = json!([0.0, 0.0])),
                "Рамка ARS2 неполна.",
            ),
            (
                Box::new(|h| h["bounds"]["half"] = json!([1.0, "x", 1.0])),
                "Рамка ARS2 не числа.",
            ),
            (
                Box::new(|h| {
                    h["bounds"].as_object_mut().unwrap().remove("half");
                }),
                "Рамка ARS2 неполна.",
            ),
            (set("vertexCount", json!(5)), "Модель ARS2 обрезана."),
            (
                set("vertexCount", json!(3)),
                "Индекс ARS2 смотрит мимо вершин.",
            ),
            (set("vertexCount", json!(1.0)), no_vertex_count),
        ];
        for (patch, text) in cases {
            broken(decode(&with_header(patch)), text);
        }
    }

    #[test]
    fn da23_da37_batches_and_lods() {
        let no_first = "В заголовке ARS2 нет числа «first».";
        let one_batch = |first: Value, count: Value| json!([{ "material": "a", "first": first, "count": count }]);
        let back = lenient(|h| {
            h.as_object_mut().unwrap().remove("batches");
        });
        assert_eq!((back.batches.len(), back.lods.len()), (0, 1));
        assert!(lenient(|h| h["batches"] = json!(5)).batches.is_empty());
        rejects(
            |h| h["batches"] = json!([{ "material": "a", "count": 1 }]),
            no_first,
        );
        let back = lenient(|h| h["batches"] = json!([{ "first": 0, "count": 1 }]));
        assert_eq!(
            back.batches,
            vec![Batch {
                material: String::new(),
                first: 0,
                count: 1
            }]
        );
        // Имя записи: у партии и LOD ищется «name», затем «material».
        let named = |entry: Value, lods: bool| -> Vec<String> {
            let key = if lods { "lods" } else { "batches" };
            let back = lenient(|h| h[key] = json!([entry]));
            match lods {
                true => back.lods.iter().map(|l| l.name.clone()).collect(),
                false => back.batches.iter().map(|b| b.material.clone()).collect(),
            }
        };
        assert_eq!(
            named(json!({"name": "nm", "first": 0, "count": 1}), false),
            vec!["nm"]
        );
        assert_eq!(
            named(
                json!({"name": "nm", "material": "mm", "first": 0, "count": 1}),
                false
            ),
            vec!["nm"]
        );
        assert_eq!(
            named(
                json!({"name": 5, "material": "mm", "first": 0, "count": 1}),
                false
            ),
            vec![""]
        );
        assert_eq!(named(json!({"first": 0, "count": 1}), true), vec![""]);
        assert_eq!(
            named(json!({"material": "mm", "first": 0, "count": 1}), true),
            vec!["mm"]
        );
        for bad in [json!(0.5), json!(-1)] {
            rejects(
                |h| h["batches"] = json!([{ "first": bad, "count": 1 }]),
                no_first,
            );
        }
        let back = lenient(|h| h["batches"] = one_batch(json!(3), json!(3)));
        assert_eq!(
            back.batches,
            vec![Batch {
                material: "a".into(),
                first: 3,
                count: 3
            }]
        );
        for (first, count) in [(3u64, 4u64), (u64::MAX, 1), (u64::MAX - 1, 2)] {
            rejects(
                |h| h["batches"] = one_batch(json!(first), json!(count)),
                "Партия ARS2 выходит за индексы.",
            );
        }
        let lod_outside = "LOD ARS2 выходит за индексы.";
        rejects(
            |h| h["lods"] = json!([{ "name": "a", "first": 0, "count": 4294967296u64 }]),
            lod_outside,
        );
        rejects(
            |h| h["lods"] = json!([{ "name": "a", "first": 5_000_000_000u64, "count": 0 }]),
            lod_outside,
        );
    }

    #[test]
    fn da40_empty_and_index_checks() {
        let back = round(&Mesh::default());
        assert_eq!((back.positions.len(), back.indices.len()), (0, 0));
        // u16-файл с 65535 в индексах
        let file = encode(&tri(70_000, vec![0, 1, 2])).unwrap();
        assert!(header_json(&file).contains("\"u16\""));
        let mut bad = file.clone();
        let n = bad.len();
        bad[n - 4..n - 2].copy_from_slice(&[0xff, 0xff]);
        broken(
            decode(&bad),
            "В ARS2 с u16-индексами стоит 65535: рестарт примитива в WebGL2.",
        );
        // u32-файл: индекс равен числу вершин
        let mut m = tri(65_536, vec![0, 1, 65535]);
        let mut file = encode(&m).unwrap();
        let n = file.len();
        file[n - 4..].copy_from_slice(&65_536u32.to_le_bytes());
        broken(decode(&file), "Индекс ARS2 смотрит мимо вершин.");
        m.indices = vec![0, 1, 65535];
        assert_eq!(round(&m).indices, vec![0, 1, 65535]);
        let m = tri(70_000, vec![0, 65000, 69999]);
        assert_eq!(round(&m).indices, vec![0, 65000, 69999]);
    }

    #[test]
    fn sphere_normals_survive() {
        for i in 0..40 {
            for j in 0..40 {
                let (a, b) = (
                    0.05 + i as f32 / 40.0 * 3.04,
                    j as f32 / 40.0 * std::f32::consts::TAU,
                );
                let n = [a.sin() * b.cos(), a.sin() * b.sin(), a.cos()];
                let r = unpack_normal(pack_normal(n));
                assert!(n[0] * r[0] + n[1] * r[1] + n[2] * r[2] > 0.999);
            }
        }
    }

    #[test]
    fn negative_control_catches_a_broken_header() {
        let mut bad = encode(&quad()).unwrap();
        bad[13] = b'x';
        assert!(decode(&bad).is_err());
    }
}
