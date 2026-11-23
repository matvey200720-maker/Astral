//! Синтетическая модель `.ydr` (Legacy, RSC7 версии 165) **для образцов и проверок**, не для поставки: сетки с позициями, нормалями,
//! цветами и двумя развёртками, группа шейдеров (имя шейдера, корзина, листы по именам сэмплеров и числовые параметры), до четырёх
//! уровней детализации. Файл читают оба читателя — `drawable.rs` и `packages/rage-drawable` (`readDrawable`) — и отдают то, что записано.
//!
//! Чего нет: огней, словаря вшитых листов, составных моделей (`.ydd`, `.yft`). Скелет (кости с родителями, поворотом, переносом и масштабом) и связка
//! модели с костью — есть: по ним читатель JS ведёт матрицы костей в `f64`. Раскладка — та же, что читают `drawable.rs` и
//! `packages/rage-drawable/drawable.js` (смещения полей берутся оттуда): корень модели, группа шейдеров, шейдеры с блоками параметров,
//! списки моделей уровней, модели, геометрии, буферы вершин и индексов; данные вершин и индексов лежат в графической области.
//! Оси — как в файле игры (Z вверх); читатели переставляют их в оси glTF (`x, z, −y`).

use crate::error::{Error, Result};
use crate::hash::joaat;
use crate::resource::{GRAPHICS_BASE, SYSTEM_BASE, VERSION_DRAWABLE};
use crate::vertex::{COLOUR, FLOAT2, FLOAT3, HALF2, HALF4, RGBA8_SNORM, UBYTE4};
use crate::ytd_edit::{pack, rsc_file, single_page_flags};

/// Лист шейдера: имя сэмплера (хешируется, если нет готового `hash`) и имя текстуры; без текстуры слот остаётся пустым.
#[derive(Debug, Clone, PartialEq)]
pub struct Sampler {
    pub name: String,
    pub hash: Option<u32>,
    pub texture: Option<String>,
}

/// Числовой параметр шейдера: имя (хешируется) и вектор из четырёх чисел.
#[derive(Debug, Clone, PartialEq)]
pub struct Vector {
    pub name: String,
    pub value: [f32; 4],
}

#[derive(Debug, Clone, PartialEq)]
pub struct Shader {
    /// Имя шейдера (`normal_spec`, `glass`, `decal`…): хеш имени и хеш `<имя>.sps` пишутся в запись.
    pub name: String,
    /// Корзина отрисовки (`renderBucket`): 0 — непрозрачное, 1 — прозрачное, 2 — наклейка, 3 — вырез.
    pub bucket: u8,
    pub samplers: Vec<Sampler>,
    pub vectors: Vec<Vector>,
}

/// Кость скелета: родитель (`-1` — корень), поворот-кватернион (x, y, z, w), перенос и масштаб (нулевой масштаб читатели берут единицей).
#[derive(Debug, Clone, PartialEq)]
pub struct Bone {
    pub parent: i16,
    pub rotation: [f32; 4],
    pub translation: [f32; 3],
    pub scale: [f32; 3],
}

/// Одна геометрия: вершины в осях игры и индексы; необязательные потоки — той же длины, что позиции.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Geometry {
    /// Номер шейдера группы.
    pub shader: usize,
    pub positions: Vec<[f32; 3]>,
    pub normals: Option<Vec<[f32; 3]>>,
    pub colours: Option<Vec<[u8; 4]>>,
    /// Второй набор цвета вершины (семантика 5): у земли в нём веса слоёв.
    pub colours1: Option<Vec<[u8; 4]>>,
    pub uvs: Option<Vec<[f32; 2]>>,
    pub uvs1: Option<Vec<[f32; 2]>>,
    pub indices: Vec<u16>,
    /// Упакованные типы, как у игры: позиции `HALF4`, нормали `RGBA8_SNORM`, развёртки `HALF2`, второй цвет `UBYTE4` (вместо `FLOAT3`, `FLOAT2`, `COLOUR`).
    pub packed: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Drawable {
    pub name: Option<String>,
    pub shaders: Vec<Shader>,
    /// Геометрии уровней: высокий, средний, низкий, очень низкий. Пустой уровень не пишется.
    pub levels: [Vec<Geometry>; 4],
    /// Скелет; пусто — нет скелета.
    pub bones: Vec<Bone>,
    /// Связка модели каждого уровня (`binding`): номер кости в старшем байте, флаг кожи во втором — как её читают `readDrawable` и `drawable.rs`.
    pub bindings: [u32; 4],
}

const ROOT_BYTES: usize = 0xc0;
const ROOT_GROUP: usize = 0x10;
const ROOT_SKELETON: usize = 0x18;
const BONE_BYTES: usize = 0x50;
const SKELETON_BYTES: usize = 0x70;
const ROOT_LEVELS: usize = 0x50;
const ROOT_NAME: usize = 0xa8;
const VERTEX_BUFFER_BYTES: usize = 0x40;
const GEOMETRY_BYTES: usize = 0x78;
const SYSTEM_NIBBLE: u32 = 0xA;
const GRAPHICS_NIBBLE: u32 = 0x5;

/// Область байт: размещение с выравниванием и запись чисел по смещению.
#[derive(Default)]
struct Arena(Vec<u8>);

impl Arena {
    fn alloc(&mut self, size: usize) -> usize {
        let at = self.0.len().next_multiple_of(16);
        self.0.resize(at + size.max(1), 0);
        at
    }

    fn put(&mut self, at: usize, bytes: &[u8]) {
        self.0[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn put16(&mut self, at: usize, value: u16) {
        self.put(at, &value.to_le_bytes());
    }

    fn put32(&mut self, at: usize, value: u32) {
        self.put(at, &value.to_le_bytes());
    }

    fn put64(&mut self, at: usize, value: u64) {
        self.put(at, &value.to_le_bytes());
    }

    fn putf(&mut self, at: usize, values: &[f32]) {
        for (step, value) in values.iter().enumerate() {
            self.put(at + step * 4, &value.to_le_bytes());
        }
    }

    /// Строка с нулём на конце; указатель на неё.
    fn text(&mut self, text: &str) -> u64 {
        let at = self.alloc(text.len() + 1);
        self.put(at, text.as_bytes());
        system(at)
    }
}

fn system(at: usize) -> u64 {
    SYSTEM_BASE + at as u64
}

fn graphics(at: usize) -> u64 {
    GRAPHICS_BASE + at as u64
}

fn refuse(text: impl Into<String>) -> Error {
    Error::argument(text)
}

/// Проверка геометрии: потоки одной длины, индексы внутри, вершин не больше предела `u16`-индексов.
fn vet(geometry: &Geometry, shaders: usize) -> Result<()> {
    let count = geometry.positions.len();
    if count == 0 || count > 65535 {
        return Err(refuse("Геометрия: вершин от 1 до 65 535."));
    }
    let lengths = [
        geometry.normals.as_ref().map(Vec::len),
        geometry.colours.as_ref().map(Vec::len),
        geometry.colours1.as_ref().map(Vec::len),
        geometry.uvs.as_ref().map(Vec::len),
        geometry.uvs1.as_ref().map(Vec::len),
    ];
    if lengths.iter().flatten().any(|length| *length != count) {
        return Err(refuse(
            "Геометрия: нормали, цвета и развёртки — столько же, сколько позиций.",
        ));
    }
    if geometry
        .indices
        .iter()
        .any(|index| usize::from(*index) >= count)
    {
        return Err(refuse("Геометрия: индекс вершины вне буфера."));
    }
    if geometry.shader >= shaders {
        return Err(refuse("Геометрия: нет такого шейдера в группе."));
    }
    Ok(())
}

/// Шейдер: запись, блок параметров (записи по 16 байт, данные векторов, хеши слотов), объекты листов.
fn write_shader(system_image: &mut Arena, shader: &Shader) -> Result<usize> {
    let slots = shader.samplers.len() + shader.vectors.len();
    if slots == 0 || slots > 96 {
        return Err(refuse("Шейдер: от 1 до 96 слотов параметров."));
    }
    let at = system_image.alloc(0x20);
    let records = system_image.alloc(slots * 16 + shader.vectors.len() * 16 + slots * 4);
    let blocks = records + slots * 16;
    let hashes = blocks + shader.vectors.len() * 16;
    for (slot, sampler) in shader.samplers.iter().enumerate() {
        // Запись листа: вид 0, указатель на объект с именем текстуры по смещению 0x28.
        if let Some(texture) = &sampler.texture {
            let object = system_image.alloc(0x30);
            let name = system_image.text(texture);
            system_image.put64(object + 0x28, name);
            system_image.put64(records + slot * 16 + 8, system(object));
        }
        system_image.put32(
            hashes + slot * 4,
            sampler.hash.unwrap_or_else(|| joaat(&sampler.name)),
        );
    }
    for (step, vector) in shader.vectors.iter().enumerate() {
        let slot = shader.samplers.len() + step;
        system_image.put(records + slot * 16, &[1]);
        system_image.put64(records + slot * 16 + 8, system(blocks + step * 16));
        system_image.putf(blocks + step * 16, &vector.value);
        system_image.put32(hashes + slot * 4, joaat(&vector.name));
    }
    system_image.put64(at, system(records));
    system_image.put32(at + 8, joaat(&shader.name));
    system_image.put(at + 0x10, &[slots as u8, shader.bucket]);
    system_image.put32(at + 0x18, joaat(&format!("{}.sps", shader.name)));
    Ok(at)
}

/// Один поток вершины: номер семантики (позиция 0, нормаль 3, цвет 4, развёртки 6 и 7), код типа, байты вершины по её номеру.
struct Stream<'a> {
    semantic: usize,
    code: u8,
    bytes: Box<dyn Fn(usize) -> Vec<u8> + 'a>,
}

fn float_bytes(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// `f32` → половинная точность (IEEE 754 binary16), к ближайшему чётному; переполнение — бесконечность.
fn half_bits(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32;
    let fraction = bits & 0x007f_ffff;
    if exponent == 0xff {
        return sign | 0x7c00 | if fraction != 0 { 0x0200 } else { 0 };
    }
    let unbiased = exponent - 127;
    if unbiased > 15 {
        return sign | 0x7c00;
    }
    if unbiased >= -14 {
        let mut half = (((unbiased + 15) as u32) << 10) | (fraction >> 13);
        let rest = fraction & 0x1fff;
        if rest > 0x1000 || (rest == 0x1000 && half & 1 == 1) {
            half += 1;
        }
        return sign | half as u16;
    }
    if unbiased < -25 {
        return sign;
    }
    let full = fraction | 0x0080_0000;
    let shift = (-unbiased - 1) as u32;
    let mut half = full >> shift;
    let rest = full & ((1 << shift) - 1);
    let middle = 1 << (shift - 1);
    if rest > middle || (rest == middle && half & 1 == 1) {
        half += 1;
    }
    sign | half as u16
}

fn half_bytes(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| half_bits(*value).to_le_bytes())
        .collect()
}

/// Нормаль в четыре байта `RGBA8_SNORM`: компонента — `round(v · 127)`, четвёртый байт — ноль.
fn snorm_bytes(value: [f32; 3]) -> Vec<u8> {
    let byte = |v: f32| (v.clamp(-1.0, 1.0) * 127.0).round() as i8 as u8;
    vec![byte(value[0]), byte(value[1]), byte(value[2]), 0]
}

/// Декларация вершины (флаги семантик, коды типов, шаг) и поток байт одной геометрии: элементы по порядку семантик.
fn vertex_data(geometry: &Geometry) -> (u32, u64, usize, Vec<u8>) {
    let packed = geometry.packed;
    let mut streams: Vec<Stream> = vec![Stream {
        semantic: 0,
        code: if packed { HALF4 } else { FLOAT3 },
        bytes: Box::new(move |at| {
            let point = geometry.positions[at];
            if packed {
                half_bytes(&[point[0], point[1], point[2], 1.0])
            } else {
                float_bytes(&point)
            }
        }),
    }];
    if let Some(list) = &geometry.normals {
        streams.push(Stream {
            semantic: 3,
            code: if packed { RGBA8_SNORM } else { FLOAT3 },
            bytes: Box::new(move |at| {
                if packed {
                    snorm_bytes(list[at])
                } else {
                    float_bytes(&list[at])
                }
            }),
        });
    }
    if let Some(list) = &geometry.colours {
        streams.push(Stream {
            semantic: 4,
            code: COLOUR,
            bytes: Box::new(|at| list[at].to_vec()),
        });
    }
    if let Some(list) = &geometry.colours1 {
        streams.push(Stream {
            semantic: 5,
            code: if packed { UBYTE4 } else { COLOUR },
            bytes: Box::new(|at| list[at].to_vec()),
        });
    }
    for (semantic, list) in [(6, &geometry.uvs), (7, &geometry.uvs1)] {
        if let Some(list) = list {
            streams.push(Stream {
                semantic,
                code: if packed { HALF2 } else { FLOAT2 },
                bytes: Box::new(move |at| {
                    if packed {
                        half_bytes(&list[at])
                    } else {
                        float_bytes(&list[at])
                    }
                }),
            });
        }
    }
    let flags = streams
        .iter()
        .fold(0u32, |flags, stream| flags | 1 << stream.semantic);
    let types = streams.iter().fold(0u64, |types, stream| {
        types | u64::from(stream.code) << (stream.semantic * 4)
    });
    let mut data = Vec::new();
    for vertex in 0..geometry.positions.len() {
        for stream in &streams {
            data.extend((stream.bytes)(vertex));
        }
    }
    let stride = data.len() / geometry.positions.len();
    (flags, types, stride, data)
}

/// Геометрия: буфер вершин, декларация, буфер индексов; данные уходят в графическую область.
fn write_geometry(
    system_image: &mut Arena,
    graphics_image: &mut Arena,
    geometry: &Geometry,
) -> usize {
    let (flags, types, stride, data) = vertex_data(geometry);
    let vertices_at = graphics_image.alloc(data.len());
    graphics_image.put(vertices_at, &data);
    let index_bytes: Vec<u8> = geometry
        .indices
        .iter()
        .flat_map(|index| index.to_le_bytes())
        .collect();
    let indices_at = graphics_image.alloc(index_bytes.len());
    graphics_image.put(indices_at, &index_bytes);

    let declaration = system_image.alloc(0x10);
    system_image.put32(declaration, flags);
    system_image.put16(declaration + 4, stride as u16);
    system_image.put64(declaration + 8, types);
    let buffer = system_image.alloc(VERTEX_BUFFER_BYTES);
    system_image.put16(buffer + 0x08, stride as u16);
    system_image.put64(buffer + 0x10, graphics(vertices_at));
    system_image.put32(buffer + 0x18, geometry.positions.len() as u32);
    system_image.put64(buffer + 0x30, system(declaration));
    let index_buffer = system_image.alloc(0x20);
    system_image.put32(index_buffer + 0x08, geometry.indices.len() as u32);
    system_image.put64(index_buffer + 0x10, graphics(indices_at));
    let at = system_image.alloc(GEOMETRY_BYTES);
    system_image.put64(at + 0x18, system(buffer));
    system_image.put64(at + 0x38, system(index_buffer));
    at
}

/// Модель уровня (одна часть со всеми геометриями уровня) и список из неё; указатель на список.
fn write_level(
    system_image: &mut Arena,
    graphics_image: &mut Arena,
    geometries: &[Geometry],
    binding: u32,
) -> u64 {
    let slots: Vec<usize> = geometries
        .iter()
        .map(|geometry| write_geometry(system_image, graphics_image, geometry))
        .collect();
    let array = system_image.alloc(slots.len() * 8);
    let mapping = system_image.alloc(slots.len() * 2);
    for (slot, at) in slots.iter().enumerate() {
        system_image.put64(array + slot * 8, system(*at));
        system_image.put16(mapping + slot * 2, geometries[slot].shader as u16);
    }
    let model = system_image.alloc(0x30);
    system_image.put64(model + 0x08, system(array));
    system_image.put16(model + 0x10, slots.len() as u16);
    system_image.put64(model + 0x20, system(mapping));
    system_image.put32(model + 0x28, binding);
    let models = system_image.alloc(8);
    system_image.put64(models, system(model));
    let list = system_image.alloc(16);
    system_image.put64(list, system(models));
    system_image.put16(list + 8, 1);
    system_image.put16(list + 10, 1);
    system(list)
}

/// Файл `.ydr`: корень, группа шейдеров, уровни; тело сжато, размеры страниц — по флагам RSC7.
pub fn write_ydr(drawable: &Drawable) -> Result<Vec<u8>> {
    if drawable.levels.iter().all(Vec::is_empty) {
        return Err(refuse("Модель: нужен хотя бы один уровень с геометрией."));
    }
    for geometry in drawable.levels.iter().flatten() {
        vet(geometry, drawable.shaders.len())?;
    }
    let mut system_image = Arena::default();
    let mut graphics_image = Arena::default();
    let root = system_image.alloc(ROOT_BYTES);
    debug_assert_eq!(root, 0);
    if let Some(name) = &drawable.name {
        let pointer = system_image.text(name);
        system_image.put64(ROOT_NAME, pointer);
    }
    if !drawable.shaders.is_empty() {
        let shaders = drawable
            .shaders
            .iter()
            .map(|shader| write_shader(&mut system_image, shader))
            .collect::<Result<Vec<_>>>()?;
        let array = system_image.alloc(shaders.len() * 8);
        for (slot, at) in shaders.iter().enumerate() {
            system_image.put64(array + slot * 8, system(*at));
        }
        let group = system_image.alloc(0x20);
        system_image.put64(group + 0x10, system(array));
        system_image.put16(group + 0x18, shaders.len() as u16);
        system_image.put64(ROOT_GROUP, system(group));
    }
    if !drawable.bones.is_empty() {
        if drawable.bones.len() > 1024 {
            return Err(refuse("Скелет: не больше 1024 костей."));
        }
        let array = system_image.alloc(drawable.bones.len() * BONE_BYTES);
        for (number, bone) in drawable.bones.iter().enumerate() {
            let at = array + number * BONE_BYTES;
            system_image.putf(at, &bone.rotation);
            system_image.putf(at + 0x10, &bone.translation);
            system_image.putf(at + 0x20, &bone.scale);
            system_image.put16(at + 0x32, bone.parent as u16);
            system_image.put16(at + 0x44, number as u16);
        }
        let skeleton = system_image.alloc(SKELETON_BYTES);
        system_image.put64(skeleton + 0x20, system(array));
        system_image.put16(skeleton + 0x5e, drawable.bones.len() as u16);
        system_image.put64(ROOT_SKELETON, system(skeleton));
    }
    for (level, geometries) in drawable
        .levels
        .iter()
        .enumerate()
        .filter(|(_, list)| !list.is_empty())
    {
        let list = write_level(
            &mut system_image,
            &mut graphics_image,
            geometries,
            drawable.bindings[level],
        );
        system_image.put64(ROOT_LEVELS + level * 8, list);
    }

    let (system_flags, system_page) = single_page_flags(SYSTEM_NIBBLE, system_image.0.len())
        .ok_or_else(|| refuse("Системная область больше страницы."))?;
    let (graphics_flags, graphics_page) =
        single_page_flags(GRAPHICS_NIBBLE, graphics_image.0.len())
            .ok_or_else(|| refuse("Графическая область больше страницы."))?;
    let mut body = system_image.0;
    body.resize(system_page, 0);
    body.extend_from_slice(&graphics_image.0);
    body.resize(system_page + graphics_page, 0);
    Ok(rsc_file(
        VERSION_DRAWABLE,
        system_flags,
        graphics_flags,
        pack(&body),
    ))
}

#[cfg(test)]
mod tests;
