//! Чтение моделей GTA V Legacy (`.ydr`, `.ydd`, `.yft`) из разобранного ресурса RSC7.
//!
//! Граф структур с указателями внутри одного буфера обходится по фиксированным
//! смещениям и превращается в обычные структуры: меши по уровням детализации,
//! материалы, кости, рамка, огни и оглавление словаря моделей. Координаты на
//! выходе в осях glTF: `(x, y, z)` Rage становится `(x, z, -y)`. Исключение —
//! «сырые» части и матрицы костей: они остаются в осях Rage.
//!
//! Читатель терпимый: пустые и недостающие указатели дают пустые списки; жёсткие
//! ошибки только там, где файл заявляет больше, чем в нём есть, и при нарушении
//! целостности (индекс вершины мимо буфера, кольцо в скелете).

use std::collections::HashMap;

use crate::error::{Error, Kind, Result};
use crate::resource::{Resource, ENHANCED_MODEL_VERSIONS, VERSION_DRAWABLE, VERSION_FRAGMENT};
use crate::shaders::{alpha_mode_of, is_emissive, sampler_role, shader_name, AlphaMode, Role};
use crate::texture::{read_dictionary_at, TextureRef};
use crate::vertex::{self, Element, Layout};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lod {
    High,
    Medium,
    Low,
    VeryLow,
}

impl Lod {
    pub const ORDER: [Lod; 4] = [Lod::High, Lod::Medium, Lod::Low, Lod::VeryLow];

    /// Смещение указателя на список моделей уровня в drawable: четыре списка идут подряд, по 8 байт.
    fn list_field(self) -> usize {
        0x50 + 8 * self as usize
    }

    /// Сначала запрошенный уровень, потом остальные в обычном порядке.
    pub(crate) fn fallback(self) -> impl Iterator<Item = Lod> {
        std::iter::once(self).chain(Lod::ORDER.into_iter().filter(move |&l| l != self))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Ydr,
    Ydd,
    Yft,
}

#[derive(Debug, Clone)]
pub struct Sampler {
    pub hash: u32,
    pub role: Option<Role>,
    pub texture: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Material {
    pub shader: String,
    pub shader_hash: u32,
    pub shader_file: Option<&'static str>,
    pub shader_file_hash: u32,
    pub render_bucket: u8,
    pub alpha_mode: AlphaMode,
    pub emissive: bool,
    pub textures: HashMap<Role, String>,
    pub samplers: Vec<Sampler>,
}

#[derive(Debug, Clone)]
pub struct Bone {
    pub name: String,
    pub parent: i16,
    pub tag: u16,
    pub rotation: [f32; 4],
    pub translation: [f32; 3],
    pub scale: [f32; 3],
    pub matrix: [f32; 16],
}

#[derive(Debug, Clone, Default)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub uvs1: Option<Vec<f32>>,
    pub colours: Option<Vec<f32>>,
    pub indices: Vec<u16>,
    pub skinned: bool,
    pub shader_index: usize,
    pub bone_index: Option<u8>,
    pub bone_matrix: Option<[f32; 16]>,
    pub joints: Option<Vec<u16>>,
    pub weights: Option<Vec<f32>>,
}

impl Mesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Frame {
    pub sphere_center: [f32; 3],
    pub sphere_radius: f32,
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
    pub lod_distances: [f32; 4],
}

#[derive(Debug, Clone)]
pub struct Light {
    pub position: [f32; 3],
    pub direction: [f32; 3],
    pub color: [u8; 3],
    pub intensity: f32,
    pub falloff: f32,
    pub falloff_exponent: f32,
    pub cone_inner_angle: f32,
    pub cone_outer_angle: f32,
    pub kind: u16,
    pub flags: u32,
    pub time_flags: u32,
    pub bone_id: u16,
    pub corona_size: f32,
    pub corona_intensity: f32,
    pub extent: [f32; 3],
}

#[derive(Debug, Clone)]
pub struct Level {
    pub lod: Lod,
    pub models: usize,
    pub meshes: Vec<Mesh>,
}

#[derive(Debug, Clone)]
pub struct Drawable {
    pub name: Option<String>,
    pub hash: Option<u32>,
    pub lod: Option<Lod>,
    pub has_shader_group: bool,
    pub meshes: Vec<Mesh>,
    pub materials: Vec<Option<Material>>,
    pub embedded_textures: Vec<TextureRef>,
    pub bones: Vec<Bone>,
}

impl Drawable {
    pub fn material_of(&self, mesh: &Mesh) -> Option<&Material> {
        self.materials.get(mesh.shader_index)?.as_ref()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Entry {
    pub at: usize,
    pub hash: Option<u32>,
}

#[derive(Debug)]
pub struct Model {
    pub kind: FileKind,
    pub version: u32,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone)]
pub struct RawPart {
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub indices: Vec<u16>,
    pub shader_index: usize,
}

const MSG_POSITION_TYPE: &str = "Геометрия модели: позиция вершины не читается (тип не поддержан).";
pub(crate) const MSG_VERTEX_BUFFER: &str = "Буфер вершин модели заявляет больше, чем есть в файле.";
const MSG_INDEX_BUFFER: &str = "Буфер индексов модели заявляет больше, чем есть в файле.";

const MAX_SHADERS: usize = 512;
const MAX_LIGHTS: usize = 512;
const MAX_BONES: usize = 1024;
const MAX_GEOMETRIES: usize = 1024;
const MAX_PARTS: usize = 4096;
pub(crate) const MAX_VERTICES: usize = 1 << 20;
const MAX_INDICES: usize = 3 << 21;
const BONE_SIZE: usize = 0x50;
const LIGHT_SIZE: usize = 0xa8;

// ------------------------------------------------------------ оси и матрицы

type Matrix = [f32; 16];

/// Оси Rage -> оси glTF.
fn to_gltf(v: [f32; 3]) -> [f32; 3] {
    [v[0], v[2], -v[1]]
}

fn unit(v: [f32; 3]) -> [f32; 3] {
    let [x, y, z] = v;
    let len = (x * x + y * y + z * z).sqrt();
    if len > 0.0 {
        v.map(|c| c / len)
    } else {
        v
    }
}

/// Перенос · поворот · масштаб; матрицы хранятся по столбцам.
fn compose(rotation: [f32; 4], translation: [f32; 3], scale: [f32; 3]) -> Matrix {
    let [x, y, z, w] = rotation;
    let (x2, y2, z2) = (x * 2.0, y * 2.0, z * 2.0);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    // Три столбца осей (каждый умножен на масштаб своей оси), затем столбец переноса.
    let axes = [
        ([1.0 - (yy + zz), xy + wz, xz - wy], scale[0]),
        ([xy - wz, 1.0 - (xx + zz), yz + wx], scale[1]),
        ([xz + wy, yz - wx, 1.0 - (xx + yy)], scale[2]),
    ];
    let mut matrix = [0.0; 16];
    for (column, (direction, factor)) in axes.into_iter().enumerate() {
        for (row, value) in direction.into_iter().enumerate() {
            matrix[column * 4 + row] = value * factor;
        }
    }
    let [tx, ty, tz] = translation;
    matrix[12..].copy_from_slice(&[tx, ty, tz, 1.0]);
    matrix
}

/// `a × b`: `out[столбец·4 + строка] = Σ a[k·4 + строка]·b[столбец·4 + k]`.
fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    std::array::from_fn(|i| {
        let (column, row) = (i / 4, i % 4);
        (0..4).map(|k| a[k * 4 + row] * b[column * 4 + k]).sum()
    })
}

/// Где кость в обходе скелета: ещё не считали, считаем сейчас (на пути вверх), посчитана.
#[derive(Clone, Copy)]
enum Walk {
    Todo,
    Open,
    Done(Matrix),
}

/// Матрица кости: родитель считается раньше, а повторный заход в кость на пути вверх — кольцо.
fn resolve_bone(
    bone: usize,
    parents: &[i16],
    locals: &[Matrix],
    walk: &mut [Walk],
) -> Result<Matrix> {
    match walk[bone] {
        Walk::Done(matrix) => return Ok(matrix),
        Walk::Open => return Err(Error::broken("Кольцо в скелете модели.")),
        Walk::Todo => walk[bone] = Walk::Open,
    }
    let parent = usize::try_from(parents[bone])
        .ok()
        .filter(|&p| p < locals.len() && p != bone);
    let matrix = match parent {
        Some(parent) => multiply(&resolve_bone(parent, parents, locals, walk)?, &locals[bone]),
        None => locals[bone],
    };
    walk[bone] = Walk::Done(matrix);
    Ok(matrix)
}

/// Абсолютные матрицы костей. Порядок костей не важен: родитель может стоять позже.
fn absolute_matrices(parents: &[i16], locals: &[Matrix]) -> Result<Vec<Matrix>> {
    let mut walk = vec![Walk::Todo; locals.len()];
    (0..locals.len())
        .map(|bone| resolve_bone(bone, parents, locals, &mut walk))
        .collect()
}

// ----------------------------------------------------------- мелкие чтения

fn floats<const N: usize>(res: &Resource, at: usize) -> Result<[f32; N]> {
    let mut out = [0.0f32; N];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = res.f32(at + i * 4)?;
    }
    Ok(out)
}

fn pointer_array(
    res: &Resource,
    array: usize,
    count: usize,
) -> impl Iterator<Item = (usize, usize)> + '_ {
    (0..count).filter_map(move |slot| Some((slot, res.pointer_at(array + slot * 8)?)))
}

// ------------------------------------------------------------------ скелет

/// Одна запись кости; нулевой масштаб по оси считается единичным, абсолютная матрица заполняется позже.
fn read_bone(res: &Resource, at: usize) -> Result<Bone> {
    let scale: [f32; 3] = floats(res, at + 0x20)?;
    Ok(Bone {
        name: res.cstring(res.u64(at + 0x38)?).unwrap_or_default(),
        parent: res.i16(at + 0x32)?,
        tag: res.u16(at + 0x44)?,
        rotation: floats(res, at)?,
        translation: floats(res, at + 0x10)?,
        scale: scale.map(|c| if c == 0.0 { 1.0 } else { c }),
        matrix: [0.0; 16],
    })
}

pub(crate) fn read_skeleton(res: &Resource, drawable_at: usize) -> Result<Vec<Bone>> {
    let Some(skeleton) = res.pointer_at(drawable_at + 0x18) else {
        return Ok(Vec::new());
    };
    let Some(first) = res.pointer_at(skeleton + 0x20) else {
        return Ok(Vec::new());
    };
    let count = usize::from(res.u16(skeleton + 0x5e)?);
    if count == 0 || count > MAX_BONES || first + count * BONE_SIZE > res.len() {
        return Ok(Vec::new());
    }

    let mut bones = (0..count)
        .map(|index| read_bone(res, first + index * BONE_SIZE))
        .collect::<Result<Vec<_>>>()?;
    let parents: Vec<i16> = bones.iter().map(|b| b.parent).collect();
    let locals: Vec<Matrix> = bones
        .iter()
        .map(|b| compose(b.rotation, b.translation, b.scale))
        .collect();
    let absolute = absolute_matrices(&parents, &locals)?;
    for (bone, matrix) in bones.iter_mut().zip(absolute) {
        bone.matrix = matrix;
    }
    Ok(bones)
}

// --------------------------------------------------------------- материалы

/// Один текстурный слот: хеш сэмплера из таблицы хешей и имя текстуры, если оно доступно.
fn read_sampler(res: &Resource, params: usize, hashes: usize, slot: usize) -> Option<Sampler> {
    let hash = res.u32(hashes + slot * 4).ok()?;
    let texture = res
        .pointer_at(params + slot * 16 + 8)
        .and_then(|object| res.u64(object + 0x28).ok())
        .and_then(|name| res.cstring(name));
    Some(Sampler {
        hash,
        role: sampler_role(hash),
        texture,
    })
}

/// Слоты параметров шейдера: текстурные слоты вместе с их хешами сэмплеров.
fn read_samplers(res: &Resource, params: usize, declared: usize) -> Vec<Sampler> {
    // Записи по 16 байт читаются, пока запись целиком помещается в данные.
    let kinds: Vec<u8> = (0..declared)
        .map(|slot| params + slot * 16)
        .take_while(|&record| record + 16 <= res.len())
        .map_while(|record| res.u8(record).ok())
        .collect();
    let blocks: usize = kinds.iter().map(|&kind| usize::from(kind)).sum();
    let hashes = params + declared * 16 + blocks * 16;

    (0..kinds.len())
        .filter(|&slot| kinds[slot] == 0)
        .filter_map(|slot| read_sampler(res, params, hashes, slot))
        .collect()
}

fn read_material(res: &Resource, shader: usize) -> Result<Material> {
    let shader_hash = res.u32(shader + 8)?;
    let declared = res.u8(shader + 0x10)?;
    let render_bucket = res.u8(shader + 0x11)?;
    let shader_file_hash = res.u32(shader + 0x18)?;

    let samplers = match res.pointer_at(shader) {
        Some(params) => read_samplers(res, params, usize::from(declared)),
        None => Vec::new(),
    };
    // Первая текстура роли остаётся, повторные той же роли пропускаются.
    let mut textures = HashMap::new();
    for (role, name) in samplers
        .iter()
        .filter_map(|sampler| Some((sampler.role?, sampler.texture.as_ref()?)))
    {
        textures.entry(role).or_insert_with(|| name.clone());
    }

    Ok(Material {
        shader: shader_name(shader_hash)
            .map(str::to_string)
            .unwrap_or_else(|| format!("0x{shader_hash:08x}")),
        shader_hash,
        shader_file: shader_name(shader_file_hash),
        shader_file_hash,
        render_bucket,
        alpha_mode: alpha_mode_of(shader_hash, shader_file_hash, render_bucket),
        emissive: is_emissive(shader_hash, shader_file_hash),
        textures,
        samplers,
    })
}

pub fn read_materials(
    res: &Resource,
    drawable_at: usize,
) -> Result<(bool, Vec<Option<Material>>, Vec<TextureRef>)> {
    let Some(group) = res.pointer_at(drawable_at + 0x10) else {
        return Ok((false, Vec::new(), Vec::new()));
    };
    let count = usize::from(res.u16(group + 0x18)?);
    let array = res
        .pointer_at(group + 0x10)
        .filter(|_| count <= MAX_SHADERS);
    let materials = match array {
        None => Vec::new(),
        Some(array) => (0..count)
            .map(|slot| {
                res.pointer_at(array + slot * 8)
                    .map(|shader| read_material(res, shader))
                    .transpose()
            })
            .collect::<Result<Vec<_>>>()?,
    };
    let embedded = read_dictionary_at(res, res.pointer_at(group + 0x08))?;
    Ok((true, materials, embedded))
}

// -------------------------------------------------------- рамка и огни

pub fn read_frame(res: &Resource, drawable_at: usize) -> Result<Frame> {
    let centre: [f32; 3] = floats(res, drawable_at + 0x20)?;
    let radius = res.f32(drawable_at + 0x2c)?;
    // Углы коробки в осях Rage; в осях glTF меньший угол по z — это -max y, больший — -min y.
    let [min_x, min_y, min_z]: [f32; 3] = floats(res, drawable_at + 0x30)?;
    let [max_x, max_y, max_z]: [f32; 3] = floats(res, drawable_at + 0x40)?;
    Ok(Frame {
        sphere_center: to_gltf(centre),
        sphere_radius: radius,
        bounds_min: [min_x, min_z, -max_y],
        bounds_max: [max_x, max_z, -min_y],
        lod_distances: floats(res, drawable_at + 0x70)?,
    })
}

fn read_light(res: &Resource, at: usize) -> Result<Light> {
    let rgb = res.bytes(at + 0x18, 3)?;
    Ok(Light {
        position: to_gltf(floats(res, at + 0x08)?),
        direction: to_gltf(floats(res, at + 0x74)?),
        color: [rgb[0], rgb[1], rgb[2]],
        intensity: res.f32(at + 0x1c)?,
        falloff: res.f32(at + 0x2c)?,
        falloff_exponent: res.f32(at + 0x30)?,
        cone_inner_angle: res.f32(at + 0x8c)?,
        cone_outer_angle: res.f32(at + 0x90)?,
        kind: res.u16(at + 0x26)?,
        flags: res.u32(at + 0x20)?,
        time_flags: res.u32(at + 0x28)?,
        bone_id: res.u16(at + 0x24)?,
        corona_size: res.f32(at + 0x5c)?,
        corona_intensity: res.f32(at + 0x6c)?,
        extent: to_gltf(floats(res, at + 0x94)?),
    })
}

pub fn read_lights(res: &Resource, drawable_at: usize) -> Result<Vec<Light>> {
    if drawable_at + 0xc0 > res.len() {
        return Ok(Vec::new());
    }
    let Some(first) = res.pointer_at(drawable_at + 0xb0) else {
        return Ok(Vec::new());
    };
    let count = usize::from(res.u16(drawable_at + 0xb8)?);
    if count > MAX_LIGHTS || first + count * LIGHT_SIZE > res.len() {
        return Ok(Vec::new());
    }
    (0..count)
        .map(|index| read_light(res, first + index * LIGHT_SIZE))
        .collect()
}

// ---------------------------------------------------------------- геометрия

/// Буфер вершин геометрии: где лежат данные, декларация и счётчики.
pub(crate) struct VertexBuffer {
    pub(crate) data: Option<usize>,
    pub(crate) declaration: Option<usize>,
    pub(crate) count: usize,
    pub(crate) stride: usize,
}

impl VertexBuffer {
    /// Буфер геометрии; без указателя на него геометрии нет.
    pub(crate) fn read(res: &Resource, geometry: usize) -> Result<Option<VertexBuffer>> {
        let Some(buffer) = res.pointer_at(geometry + 0x18) else {
            return Ok(None);
        };
        Ok(Some(VertexBuffer {
            stride: usize::from(res.u16(buffer + 0x08)?),
            data: res
                .pointer_at(buffer + 0x10)
                .or_else(|| res.pointer_at(buffer + 0x20)),
            count: res.u32(buffer + 0x18)? as usize,
            declaration: res.pointer_at(buffer + 0x30),
        }))
    }

    /// Первый ненулевой из шага буфера, шага декларации и шага раскладки.
    pub(crate) fn effective_stride(&self, declared: usize, layout: &Layout) -> usize {
        [self.stride, declared, layout.stride]
            .into_iter()
            .find(|&s| s != 0)
            .unwrap_or(0)
    }
}

/// Раскладка по декларации и шаг, записанный в самой декларации.
pub(crate) fn read_declaration(res: &Resource, declaration: usize) -> Result<(Layout, usize)> {
    let flags = res.u32(declaration)?;
    let stride = usize::from(res.u16(declaration + 4)?);
    let types = res.u64(declaration + 8)?;
    // Неизвестный тип позиции отказывает прежним текстом геометрии, остальные неизвестные
    // типы — текстом раскладки.
    vertex::layout(flags & (1 << vertex::POSITION), types)
        .map_err(|_| Error::broken(MSG_POSITION_TYPE))?;
    Ok((vertex::layout(flags, types)?, stride))
}

/// Слоты геометрий модели: (номер слота, смещение геометрии).
pub(crate) fn geometry_slots(
    res: &Resource,
    model: usize,
    strict: bool,
) -> Result<Vec<(usize, usize)>> {
    let count = usize::from(res.u16(model + 0x10)?);
    if strict && count > MAX_GEOMETRIES {
        return Err(Error::broken(
            "Часть модели заявляет слишком много геометрий.",
        ));
    }
    let Some(array) = res.pointer_at(model + 0x08) else {
        return Ok(Vec::new());
    };
    Ok(pointer_array(res, array, count.min(MAX_GEOMETRIES)).collect())
}

/// Номера костей геометрии, если её список костей лежит в данных целиком.
fn bone_list(res: &Resource, geometry: usize) -> Result<Option<(usize, usize)>> {
    let Some(list) = res.pointer_at(geometry + 0x68) else {
        return Ok(None);
    };
    let len = usize::from(res.u16(geometry + 0x72)?);
    Ok((len > 0 && list + len * 2 <= res.len()).then_some((list, len)))
}

/// Индексы геометрии: буфер индексов целиком в данных, каждый индекс указывает внутрь буфера вершин.
pub(crate) fn read_indices(
    res: &Resource,
    index_buffer: usize,
    vertices: usize,
) -> Result<Vec<u16>> {
    let count = res.u32(index_buffer + 0x08)? as usize;
    let at = res
        .pointer_at(index_buffer + 0x10)
        .filter(|&at| count <= MAX_INDICES && at + count * 2 <= res.len())
        .ok_or_else(|| Error::broken(MSG_INDEX_BUFFER))?;
    let indices: Vec<u16> = res
        .bytes(at, count * 2)?
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    if indices.iter().any(|&index| usize::from(index) >= vertices) {
        return Err(Error::broken("Индекс вершины вне буфера."));
    }
    Ok(indices)
}

/// Элементы вершины, которые читает геометрия. Для «сырой» части второй UV, цвет и кожа не читаются.
struct Elements {
    position: Element,
    normal: Option<Element>,
    uv0: Option<Element>,
    uv1: Option<Element>,
    colour: Option<Element>,
    /// Веса и номера костей — только парой.
    skin: Option<(Element, Element)>,
}

/// Номер кости в сетке: через список костей геометрии, а без списка байт и есть номер.
fn joint_id(res: &Resource, bones: Option<(usize, usize)>, byte: u8) -> u16 {
    match bones {
        Some((list, len)) if usize::from(byte) < len => {
            res.u16(list + usize::from(byte) * 2).unwrap_or(0)
        }
        Some(_) => 0,
        None => u16::from(byte),
    }
}

/// Одна вершина `n` в выходные списки меша.
fn append_vertex(
    res: &Resource,
    mesh: &mut Mesh,
    (n, vertex): (usize, &[u8]),
    found: &Elements,
    bones: Option<(usize, usize)>,
    raw: bool,
) -> Result<()> {
    // Позиция, которую не удалось прочитать (неизвестный тип, вершина короче
    // элемента), — отказ геометрии, а не чужие числа из прошлого чтения.
    let mut at = [0.0f32; 3];
    if !vertex::read_components(vertex, found.position, &mut at) {
        return Err(Error::broken(MSG_POSITION_TYPE));
    }
    mesh.positions.extend(if raw { at } else { to_gltf(at) });
    if let (Some(element), Some(out)) = (found.normal, mesh.normals.as_mut()) {
        let mut work = [0.0f32; 3];
        vertex::read_components(vertex, element, &mut work);
        // Нормаль приводится к единичной длине в осях файла, до перестановки осей.
        out.extend(if raw { work } else { to_gltf(unit(work)) });
    }
    for (element, out, width) in [
        (found.uv0, &mut mesh.uvs, 2),
        (found.uv1, &mut mesh.uvs1, 2),
        (found.colour, &mut mesh.colours, 4),
    ] {
        if let (Some(element), Some(out)) = (element, out.as_mut()) {
            vertex::read_components(vertex, element, &mut out[n * width..(n + 1) * width]);
        }
    }
    if let (Some((weight_el, joint_el)), Some(joints), Some(weights)) =
        (found.skin, mesh.joints.as_mut(), mesh.weights.as_mut())
    {
        weights.extend(normalised_weights(vertex, weight_el));
        for k in 0..4 {
            let byte = vertex.get(joint_el.offset + k).copied().unwrap_or(0);
            joints.push(joint_id(res, bones, byte));
        }
    }
    Ok(())
}

fn read_geometry(res: &Resource, geometry: usize, raw: bool) -> Result<Option<Mesh>> {
    let Some(buffer) = VertexBuffer::read(res, geometry)? else {
        return Ok(None);
    };
    let Some(index_buffer) = res.pointer_at(geometry + 0x38) else {
        return Ok(None);
    };
    let (Some(data), Some(declaration)) = (buffer.data, buffer.declaration) else {
        return Ok(None);
    };
    if buffer.count == 0 {
        return Ok(None);
    }

    let (layout, declared_stride) = read_declaration(res, declaration)?;
    let stride = buffer.effective_stride(declared_stride, &layout);
    let count = buffer.count;
    if count > MAX_VERTICES || stride < 12 || data + count * stride > res.len() {
        return Err(Error::broken(MSG_VERTEX_BUFFER));
    }
    let position = layout
        .get(vertex::POSITION)
        .ok_or_else(|| Error::broken("Геометрия модели без позиций вершин."))?;
    let indices = read_indices(res, index_buffer, count)?;

    let (weights_at, joints_at) = (
        layout.get(vertex::BLEND_WEIGHTS),
        layout.get(vertex::BLEND_INDICES),
    );
    let found = Elements {
        position,
        normal: layout.get(vertex::NORMAL),
        uv0: layout.get(vertex::UV0),
        uv1: layout.get(vertex::UV1).filter(|_| !raw),
        colour: layout.get(vertex::COLOUR0).filter(|_| !raw),
        skin: weights_at.zip(joints_at).filter(|_| !raw),
    };
    let bones = if found.skin.is_some() {
        bone_list(res, geometry)?
    } else {
        None
    };

    let mut mesh = Mesh {
        positions: Vec::with_capacity(count * 3),
        normals: found.normal.map(|_| Vec::with_capacity(count * 3)),
        uvs: found.uv0.map(|_| vec![0.0; count * 2]),
        uvs1: found.uv1.map(|_| vec![0.0; count * 2]),
        colours: found.colour.map(|_| vec![0.0; count * 4]),
        indices,
        skinned: weights_at.is_some() || joints_at.is_some(),
        joints: found.skin.map(|_| Vec::with_capacity(count * 4)),
        weights: found.skin.map(|_| Vec::with_capacity(count * 4)),
        ..Mesh::default()
    };

    let block = res.bytes(data, count * stride)?;
    for numbered in block.chunks_exact(stride).enumerate() {
        append_vertex(res, &mut mesh, numbered, &found, bones, raw)?;
    }
    Ok(Some(mesh))
}

fn normalised_weights(vertex: &[u8], element: Element) -> [f32; 4] {
    let mut w = [0.0f32; 4];
    vertex::read_components(vertex, element, &mut w);
    let sum: f32 = w.iter().sum();
    if sum > 0.0 {
        w.map(|c| c / sum)
    } else {
        w
    }
}

// -------------------------------------------------------------- уровни

/// Модели уровня: смещения тех указателей, что прошли проверку.
pub(crate) fn level_models(res: &Resource, drawable_at: usize, lod: Lod) -> Result<Vec<usize>> {
    let Some(list) = res.pointer_at(drawable_at + lod.list_field()) else {
        return Ok(Vec::new());
    };
    let found = res.pointer_list(list)?;
    let Some(array) = res.at(found.entries) else {
        return Ok(Vec::new());
    };
    match usize::from(found.count) {
        0 => Ok(Vec::new()),
        count @ 1..=MAX_PARTS => Ok(pointer_array(res, array, count)
            .map(|(_, model)| model)
            .collect()),
        _ => Err(Error::broken("Модель заявляет слишком много частей.")),
    }
}

/// Меши одной модели: номер таблицы шейдеров берётся по слоту геометрии, кость — из связки модели.
fn model_meshes(res: &Resource, model: usize, bones: &[Bone], raw: bool) -> Result<Vec<Mesh>> {
    let mapping = res.pointer_at(model + 0x20);
    let binding = res.u32(model + 0x28)?;
    let skin_flag = (binding >> 8) & 0xff != 0;
    let bone = (binding >> 24) as u8;
    let mut meshes = Vec::new();
    for (slot, geometry) in geometry_slots(res, model, true)? {
        let Some(mut mesh) = read_geometry(res, geometry, raw)? else {
            continue;
        };
        mesh.shader_index = match mapping {
            Some(table) => usize::from(res.u16(table + slot * 2)?),
            None => 0,
        };
        if !raw && !skin_flag {
            mesh.bone_index = Some(bone);
            mesh.bone_matrix = bones.get(usize::from(bone)).map(|b| b.matrix);
        }
        meshes.push(mesh);
    }
    Ok(meshes)
}

fn level_meshes(res: &Resource, models: &[usize], bones: &[Bone], raw: bool) -> Result<Vec<Mesh>> {
    let per_model = models
        .iter()
        .map(|&model| model_meshes(res, model, bones, raw))
        .collect::<Result<Vec<_>>>()?;
    Ok(per_model.into_iter().flatten().collect())
}

fn read_level(
    res: &Resource,
    drawable_at: usize,
    lod: Lod,
    bones: &[Bone],
) -> Result<Option<Level>> {
    let models = level_models(res, drawable_at, lod)?;
    if models.is_empty() {
        return Ok(None);
    }
    let meshes = level_meshes(res, &models, bones, false)?;
    Ok(Some(Level {
        lod,
        models: models.len(),
        meshes,
    }))
}

pub fn read_levels(res: &Resource, drawable_at: usize) -> Result<Vec<Level>> {
    let bones = read_skeleton(res, drawable_at)?;
    Lod::ORDER
        .into_iter()
        .filter_map(|lod| read_level(res, drawable_at, lod, &bones).transpose())
        .collect()
}

/// Имя модели: строка по указателю на смещении 0xa8, пустая считается отсутствующей.
pub(crate) fn drawable_name(res: &Resource, drawable_at: usize) -> Option<String> {
    let pointer = res.u64(drawable_at + 0xa8).ok()?;
    res.cstring(pointer).filter(|text| !text.is_empty())
}

pub fn read_drawable_at(
    res: &Resource,
    drawable_at: usize,
    lod: Lod,
    hash: Option<u32>,
) -> Result<Drawable> {
    let (has_shader_group, materials, embedded_textures) = read_materials(res, drawable_at)?;
    let bones = read_skeleton(res, drawable_at)?;
    let chosen = lod
        .fallback()
        .find_map(|l| read_level(res, drawable_at, l, &bones).transpose())
        .transpose()?;
    let (lod, meshes) = match chosen {
        Some(level) => (Some(level.lod), level.meshes),
        None => (None, Vec::new()),
    };
    Ok(Drawable {
        name: drawable_name(res, drawable_at),
        hash,
        lod,
        has_shader_group,
        meshes,
        materials,
        embedded_textures,
        bones,
    })
}

fn raw_part(mesh: Mesh) -> RawPart {
    RawPart {
        positions: mesh.positions,
        normals: mesh.normals,
        uvs: mesh.uvs,
        indices: mesh.indices,
        shader_index: mesh.shader_index,
    }
}

/// «Сырые» части лучшего из имеющихся уровней: первый уровень, где есть модели.
pub fn read_raw_parts(res: &Resource, drawable_at: usize) -> Result<Vec<RawPart>> {
    let first_with_models = Lod::ORDER
        .into_iter()
        .map(|lod| level_models(res, drawable_at, lod))
        .find(|models| !matches!(models, Ok(list) if list.is_empty()));
    let Some(models) = first_with_models.transpose()? else {
        return Ok(Vec::new());
    };
    Ok(level_meshes(res, &models, &[], true)?
        .into_iter()
        .map(raw_part)
        .collect())
}

// ------------------------------------------------------ вид файла и оглавление

pub fn kind_of(res: &Resource) -> Option<FileKind> {
    match res.version() {
        VERSION_FRAGMENT => Some(FileKind::Yft),
        VERSION_DRAWABLE => {
            let dictionary = res.u64(res.root()? + 0x18).ok()? == 1;
            Some(if dictionary {
                FileKind::Ydd
            } else {
                FileKind::Ydr
            })
        }
        _ => None,
    }
}

fn dictionary_entries(res: &Resource, root: usize) -> Result<Vec<Entry>> {
    let (hashes, list) = (res.pointer_at(root + 0x20), res.pointer_at(root + 0x30));
    let hash_count = usize::from(res.u16(root + 0x28)?);
    let count = usize::from(res.u16(root + 0x38)?);
    if count > MAX_PARTS {
        return Err(Error::broken("Словарь заявляет слишком много моделей."));
    }
    let Some(list) = list else {
        return Ok(Vec::new());
    };
    // Хеш есть не у каждой записи: таблица может быть короче списка.
    let hash_of = |slot: usize| -> Result<Option<u32>> {
        hashes
            .filter(|_| slot < hash_count)
            .map(|table| res.u32(table + slot * 4))
            .transpose()
    };
    pointer_array(res, list, count)
        .map(|(slot, at)| {
            Ok(Entry {
                at,
                hash: hash_of(slot)?,
            })
        })
        .collect()
}

pub fn open_model(res: &Resource, kind: Option<FileKind>) -> Result<Model> {
    let version = res.version();
    if ENHANCED_MODEL_VERSIONS.contains(&version) {
        return Err(Error::new(
            Kind::Enhanced,
            format!("Модель из GTA V Enhanced (версия {version}): Astral читает модели Legacy."),
        ));
    }
    let Some(kind) = kind.or_else(|| kind_of(res)) else {
        return Err(Error::version(format!(
            "Это не модель GTA V Legacy (версия ресурса {version})."
        )));
    };
    let root = res
        .root()
        .ok_or_else(|| Error::broken("Корень модели недоступен."))?;
    let entries = match kind {
        FileKind::Ydr => vec![Entry {
            at: root,
            hash: None,
        }],
        FileKind::Ydd => dictionary_entries(res, root)?,
        FileKind::Yft => {
            let at = res
                .pointer_at(root + 0x30)
                .ok_or_else(|| Error::broken("У фрагмента нет модели."))?;
            vec![Entry { at, hash: None }]
        }
    };
    Ok(Model {
        kind,
        version,
        entries,
    })
}

pub fn entry_label(entry: &Entry) -> String {
    match entry.hash {
        Some(hash) => format!("hash_{hash:08X}"),
        None => "drawable".to_string(),
    }
}

// ------------------------------------------------------- цвета и экстенты

fn visit_colours(
    res: &Resource,
    drawable_at: usize,
    visit: &mut dyn FnMut(usize, [u8; 4]),
) -> Result<()> {
    for lod in Lod::ORDER {
        for model in level_models(res, drawable_at, lod)? {
            for (_, geometry) in geometry_slots(res, model, false)? {
                visit_geometry_colours(res, geometry, visit)?;
            }
        }
    }
    Ok(())
}

fn visit_geometry_colours(
    res: &Resource,
    geometry: usize,
    visit: &mut dyn FnMut(usize, [u8; 4]),
) -> Result<()> {
    let Some(buffer) = VertexBuffer::read(res, geometry)? else {
        return Ok(());
    };
    let (Some(data), Some(declaration)) = (buffer.data, buffer.declaration) else {
        return Ok(());
    };
    let (layout, step) = read_declaration(res, declaration)?;
    let Some(colour) = layout.get(vertex::COLOUR0).filter(|_| step != 0) else {
        return Ok(());
    };
    let available = (buffer.count * buffer.stride).min(res.len().saturating_sub(data));
    let offsets = (0..buffer.count.min(available / step))
        .map(|n| n * step + colour.offset)
        .take_while(|&offset| offset + 4 <= available);
    for offset in offsets {
        let bytes = res.bytes(data + offset, 4)?;
        visit(data + offset, [bytes[0], bytes[1], bytes[2], bytes[3]]);
    }
    Ok(())
}

pub fn for_each_vertex_colour(
    res: &Resource,
    drawable_at: usize,
    mut visit: impl FnMut([u8; 4]),
) -> Result<()> {
    visit_colours(res, drawable_at, &mut |_, colour| visit(colour))
}

pub fn for_each_vertex_colour_slot(
    res: &Resource,
    drawable_at: usize,
    mut visit: impl FnMut(usize, [u8; 4]),
) -> Result<()> {
    visit_colours(res, drawable_at, &mut |at, colour| visit(at, colour))
}

/// Отрезок буфера вершин: где данные и сколько байт заявлено; без отрезка — буфер неполный или шаг мал.
fn vertex_extent(res: &Resource, buffer: &VertexBuffer) -> Result<Option<(usize, usize)>> {
    let (Some(data), Some(declaration)) = (buffer.data, buffer.declaration) else {
        return Ok(None);
    };
    if buffer.count == 0 {
        return Ok(None);
    }
    let (layout, declared) = read_declaration(res, declaration)?;
    let stride = buffer.effective_stride(declared, &layout);
    Ok((stride >= 12).then_some((data, buffer.count * stride)))
}

/// Отрезок буфера индексов: по два байта на индекс.
fn index_extent(res: &Resource, index_buffer: usize) -> Result<Option<(usize, usize)>> {
    let Some(indices) = res.pointer_at(index_buffer + 0x10) else {
        return Ok(None);
    };
    let count = res.u32(index_buffer + 0x08)? as usize;
    Ok((count > 0).then_some((indices, count * 2)))
}

/// Отрезки буферов геометрии уровня High: вершины, затем индексы каждой геометрии.
/// Длины с размером данных не сверяются.
pub(crate) fn geometry_extents(res: &Resource, drawable_at: usize) -> Result<Vec<(usize, usize)>> {
    let mut extents = Vec::new();
    for model in level_models(res, drawable_at, Lod::High)? {
        for (_, geometry) in geometry_slots(res, model, false)? {
            let Some(buffer) = VertexBuffer::read(res, geometry)? else {
                continue;
            };
            let Some(index_buffer) = res.pointer_at(geometry + 0x38) else {
                continue;
            };
            extents.extend(vertex_extent(res, &buffer)?);
            extents.extend(index_extent(res, index_buffer)?);
        }
    }
    Ok(extents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::joaat;
    use crate::resource::Header;

    // ---- сборка синтетического ресурса

    /// Что записать в образ по смещению.
    #[derive(Clone, Copy)]
    enum Put<'a> {
        U8(u8),
        U16(u16),
        I16(i16),
        U32(u32),
        U64(u64),
        /// Указатель на смещение в системной части.
        Ptr(usize),
        Floats(&'a [f32]),
        Bytes(&'a [u8]),
        Text(&'a str),
    }
    use Put::{Bytes, Floats, Ptr, Text, I16, U16, U32, U64, U8};

    #[derive(Clone)]
    struct Image {
        data: Vec<u8>,
    }

    fn ptr(offset: usize) -> u64 {
        0x5000_0000 + offset as u64
    }

    impl Image {
        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.data[at..at + bytes.len()].copy_from_slice(bytes);
        }
        fn u8(&mut self, at: usize, v: u8) {
            self.put(at, &[v]);
        }
        fn u16(&mut self, at: usize, v: u16) {
            self.put(at, &v.to_le_bytes());
        }
        fn i16(&mut self, at: usize, v: i16) {
            self.put(at, &v.to_le_bytes());
        }
        fn u32(&mut self, at: usize, v: u32) {
            self.put(at, &v.to_le_bytes());
        }
        fn u64(&mut self, at: usize, v: u64) {
            self.put(at, &v.to_le_bytes());
        }
        fn ptr(&mut self, at: usize, target: usize) {
            self.u64(at, ptr(target));
        }
        fn f32s(&mut self, at: usize, values: &[f32]) {
            for (i, v) in values.iter().enumerate() {
                self.put(at + i * 4, &v.to_le_bytes());
            }
        }
        fn text(&mut self, at: usize, s: &str) {
            self.put(at, s.as_bytes());
        }
        /// Записывает таблицу «смещение -> значение» по порядку.
        fn lay(&mut self, entries: &[(usize, Put)]) {
            for &(at, value) in entries {
                match value {
                    U8(v) => self.u8(at, v),
                    U16(v) => self.u16(at, v),
                    I16(v) => self.i16(at, v),
                    U32(v) => self.u32(at, v),
                    U64(v) => self.u64(at, v),
                    Ptr(target) => self.ptr(at, target),
                    Floats(values) => self.f32s(at, values),
                    Bytes(bytes) => self.put(at, bytes),
                    Text(text) => self.text(at, text),
                }
            }
        }
    }

    fn base_image() -> Image {
        let mut m = Image {
            data: vec![0; 0x1000],
        };
        // заголовок drawable: группа шейдеров, рамка, список уровня High, имя, огни
        m.lay(&[
            (0x10, Ptr(0x100)),
            (0x18, Ptr(0x2c0)),
            (0x20, Floats(&[1.0, 2.0, 3.0])),
            (0x2c, Floats(&[5.0])),
            (0x30, Floats(&[-1.0, -2.0, -3.0])),
            (0x40, Floats(&[4.0, 5.0, 6.0])),
            (0x50, Ptr(0x400)),
            (0x70, Floats(&[10.0, 20.0, 30.0, 40.0])),
            (0xa8, Ptr(0x2a0)),
            (0xb0, Ptr(0xd00)),
            // группа шейдеров и первый шейдер
            (0x110, Ptr(0x140)),
            (0x118, U16(2)),
            (0x140, Ptr(0x180)),
            (0x180, Ptr(0x1c0)),
            (0x188, U32(joaat("normal_spec"))),
            (0x190, U8(2)),
            (0x191, U8(0)),
            (0x198, U32(joaat("normal_spec.sps"))),
            // параметры: текстура и вектор
            (0x1c0, U8(0)),
            (0x1c8, Ptr(0x240)),
            (0x1d0, U8(1)),
            (0x1f0, U32(joaat("diffusesampler"))),
            (0x268, Ptr(0x280)),
            (0x280, Text("tex_d")),
            (0x2a0, Text("prop_x")),
            // скелет
            (0x2e0, Ptr(0x300)),
            (0x31e, U16(2)),
        ]);
        for (at, translation, parent, name, tag) in [
            (0x300, [1.0, 0.0, 0.0], -1, 0x3b0, 7),
            (0x350, [0.0, 2.0, 0.0], 0, 0x3c0, 8),
        ] {
            m.lay(&[
                (at, Floats(&[0.0, 0.0, 0.0, 1.0])),
                (at + 0x10, Floats(&translation)),
                (at + 0x20, Floats(&[1.0, 1.0, 1.0])),
                (at + 0x32, I16(parent)),
                (at + 0x38, Ptr(name)),
                (at + 0x44, U16(tag)),
            ]);
        }
        // имена костей и уровень High: список -> массив -> модель -> геометрия
        m.lay(&[
            (0x3b0, Text("root")),
            (0x3c0, Text("child")),
            (0x400, Ptr(0x420)),
            (0x408, U16(1)),
            (0x420, Ptr(0x440)),
            (0x448, Ptr(0x480)),
            (0x450, U16(1)),
            (0x460, Ptr(0x4a0)),
            (0x468, U32(0x0100_0000)),
            (0x480, Ptr(0x500)),
            (0x4a0, U16(1)),
            (0x518, Ptr(0x580)),
            (0x538, Ptr(0x5c0)),
            (0x568, Ptr(0x5e0)),
            (0x588, U16(36)),
            (0x590, Ptr(0x700)),
            (0x598, U32(3)),
            (0x5b0, Ptr(0x600)),
            (0x600, U32(0x59)),
            (0x604, U16(36)),
            (0x608, U64(6 | 6 << 12 | 9 << 16 | 5 << 24)),
            (0x5c8, U32(3)),
            (0x5d0, Ptr(0x680)),
            (0x680, Bytes(&[0, 0, 1, 0, 2, 0])),
        ]);
        let normals = [[0.0, 0.0, 2.0], [0.0, 1.0, 0.0], [3.0, 0.0, 0.0]];
        let colours = [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0]];
        let uvs = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];
        for v in 0..3 {
            let at = 0x700 + v * 36;
            let corner = 3.0 * v as f32;
            m.lay(&[
                (at, Floats(&[1.0 + corner, 2.0 + corner, 3.0 + corner])),
                (at + 12, Floats(&normals[v])),
                (at + 24, Bytes(&colours[v])),
                (at + 28, Floats(&uvs[v])),
            ]);
        }
        m
    }

    /// Скинованная геометрия: шаг 44, веса и кости байтами, список костей 10, 11, 12.
    fn skin_image() -> Image {
        let mut m = base_image();
        m.lay(&[
            (0x588, U16(44)),
            (0x600, U32(0x5f)),
            (0x604, U16(44)),
            (
                0x608,
                U64(6 | 9 << 4 | 8 << 8 | 6 << 12 | 9 << 16 | 5 << 24),
            ),
            (0x5e0, U16(10)),
            (0x5e2, U16(11)),
            (0x5e4, U16(12)),
            (0x572, U16(3)),
        ]);
        let weights = [[255u8, 0, 0, 0], [128, 128, 0, 0], [0, 0, 0, 0]];
        let joints = [[0u8, 1, 0, 0], [2, 5, 0, 0], [0, 0, 0, 0]];
        for v in 0..3 {
            let at = 0x700 + v * 44;
            let corner = 3.0 * v as f32;
            m.lay(&[
                (at, Floats(&[1.0 + corner, 2.0 + corner, 3.0 + corner])),
                (at + 12, Bytes(&weights[v])),
                (at + 16, Bytes(&joints[v])),
                (at + 20, Floats(&[0.0, 0.0, 1.0])),
                (at + 32, Bytes(&[255, 255, 255, 255])),
                (at + 36, Floats(&[0.5, 0.5])),
            ]);
        }
        m
    }

    fn resource(m: &Image, version: u32) -> Resource {
        let header = Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size: m.data.len(),
            graphics_size: 0,
            version,
            declared_version: version,
        };
        Resource::from_parts(header, m.data.clone())
    }

    fn patched(f: impl FnOnce(&mut Image)) -> Resource {
        let mut m = base_image();
        f(&mut m);
        resource(&m, 165)
    }

    fn base() -> Resource {
        resource(&base_image(), 165)
    }

    // Простые правки одной таблицей «смещение -> значение»; сложные идут замыканием в `*_of`.
    fn with(patches: &[(usize, Put)]) -> Resource {
        patched(|m| m.lay(patches))
    }

    fn levels_with(patches: &[(usize, Put)]) -> Vec<Level> {
        levels_of(|m| m.lay(patches))
    }

    fn bones_with(patches: &[(usize, Put)]) -> Vec<Bone> {
        bones_of(|m| m.lay(patches))
    }

    fn mesh_with(patches: &[(usize, Put)]) -> Mesh {
        mesh_of(|m| m.lay(patches))
    }

    fn mesh_count_with(patches: &[(usize, Put)]) -> usize {
        mesh_count(|m| m.lay(patches))
    }

    fn material_with(patches: &[(usize, Put)]) -> Material {
        first_material(|m| m.lay(patches))
    }

    fn materials_with(patches: &[(usize, Put)]) -> Vec<Option<Material>> {
        materials_after(|m| m.lay(patches))
    }

    fn fails<T: std::fmt::Debug>(r: Result<T>, kind: Kind, message: &str) {
        let e = r.expect_err("ожидалась ошибка");
        assert_eq!((e.kind, e.message.as_str()), (kind, message));
    }

    fn broken<T: std::fmt::Debug>(r: Result<T>, message: &str) {
        fails(r, Kind::Broken, message);
    }

    const EOF: &str = "Чтение за концом данных ресурса.";
    const IDENTITY_AT_1_2: &str =
        "[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 2.0, 0.0, 1.0]";
    const NO_TURN: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

    // ---- внутренние помощники из старых тестов

    fn transform_point(m: &Matrix, p: [f32; 3]) -> [f32; 3] {
        std::array::from_fn(|r| m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
    }

    #[test]
    fn matrices_compose_and_multiply() {
        let moved = compose(NO_TURN, [1.0, 2.0, 3.0], [1.0; 3]);
        let identity = compose(NO_TURN, [0.0; 3], [1.0; 3]);
        assert_eq!(multiply(&identity, &moved), moved);
        assert_eq!(transform_point(&moved, [1.0; 3]), [2.0, 3.0, 4.0]);
        // Четверть оборота вокруг z переводит ось x в ось y.
        let h = std::f32::consts::FRAC_1_SQRT_2;
        let turn = compose([0.0, 0.0, h, h], [0.0; 3], [1.0; 3]);
        let [px, py, pz] = transform_point(&turn, [1.0, 0.0, 0.0]);
        assert!(px.abs() < 1e-6 && (py - 1.0).abs() < 1e-6 && pz.abs() < 1e-6);
    }

    #[test]
    fn directions_are_normalised() {
        let doubled = compose(NO_TURN, [0.0; 3], [2.0; 3]);
        let moved = transform_point(&doubled, [0.0, 3.0, 0.0]);
        assert!((unit(moved)[1] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn lod_fallback_order_starts_with_the_requested_level() {
        let order: Vec<Lod> = Lod::Low.fallback().collect();
        assert_eq!(order, [Lod::Low, Lod::High, Lod::Medium, Lod::VeryLow]);
        assert_eq!(Lod::ORDER, [Lod::High, Lod::Medium, Lod::Low, Lod::VeryLow]);
    }

    #[test]
    fn labels() {
        let cases = [
            (Some(0x0840_FD10), "hash_0840FD10"),
            (Some(0), "hash_00000000"),
            (Some(u32::MAX), "hash_FFFFFFFF"),
            (Some(0xabc), "hash_00000ABC"),
            (None, "drawable"),
        ];
        for (hash, label) in cases {
            assert_eq!(entry_label(&Entry { at: 0, hash }), label);
        }
    }

    // ---- Д1..Д21: drawable, скелет

    const MESH_DEBUG: &str = "Mesh { positions: [1.0, 3.0, -2.0, 4.0, 6.0, -5.0, 7.0, 9.0, -8.0], normals: Some([0.0, 1.0, -0.0, 0.0, 0.0, -1.0, 1.0, 0.0, -0.0]), uvs: Some([0.0, 0.0, 1.0, 0.0, 0.0, 1.0]), uvs1: None, colours: Some([1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.5019608, 0.0, 0.0, 1.0, 0.0]), indices: [0, 1, 2], skinned: false, shader_index: 1, bone_index: Some(1), bone_matrix: Some([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 2.0, 0.0, 1.0]), joints: None, weights: None }";

    #[test]
    fn d1_whole_drawable() {
        let d = read_drawable_at(&base(), 0, Lod::High, Some(0xAB)).unwrap();
        let expected = format!("Drawable {{ name: Some(\"prop_x\"), hash: Some(171), lod: Some(High), has_shader_group: true, meshes: [{MESH_DEBUG}], materials: [Some(Material {{ shader: \"normal_spec\", shader_hash: 954007775, shader_file: Some(\"normal_spec.sps\"), shader_file_hash: 346521853, render_bucket: 0, alpha_mode: Opaque, emissive: false, textures: {{Diffuse: \"tex_d\"}}, samplers: [Sampler {{ hash: 4059966321, role: Some(Diffuse), texture: Some(\"tex_d\") }}] }}), None], embedded_textures: [], bones: [Bone {{ name: \"root\", parent: -1, tag: 7, rotation: [0.0, 0.0, 0.0, 1.0], translation: [1.0, 0.0, 0.0], scale: [1.0, 1.0, 1.0], matrix: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0] }}, Bone {{ name: \"child\", parent: 0, tag: 8, rotation: [0.0, 0.0, 0.0, 1.0], translation: [0.0, 2.0, 0.0], scale: [1.0, 1.0, 1.0], matrix: {IDENTITY_AT_1_2} }}] }}");
        assert_eq!(format!("{d:?}"), expected);
    }

    fn drawable_of(patch: impl FnOnce(&mut Image), lod: Lod) -> Drawable {
        read_drawable_at(&patched(patch), 0, lod, None).unwrap()
    }

    fn levels_of(patch: impl FnOnce(&mut Image)) -> Vec<Level> {
        read_levels(&patched(patch), 0).unwrap()
    }

    fn bones_of(patch: impl FnOnce(&mut Image)) -> Vec<Bone> {
        read_skeleton(&patched(patch), 0).unwrap()
    }

    #[test]
    fn d2_d4_level_choice() {
        let asked_low = drawable_of(|_| {}, Lod::Low);
        assert_eq!(
            (asked_low.hash, asked_low.lod, asked_low.meshes.len()),
            (None, Some(Lod::High), 1)
        );
        // High нет, есть Medium: берётся он.
        let medium_only = drawable_of(
            |m| m.lay(&[(0x58, U64(ptr(0x400))), (0x50, U64(0))]),
            Lod::High,
        );
        assert_eq!(
            (medium_only.lod, medium_only.meshes.len()),
            (Some(Lod::Medium), 1)
        );
        // Уровней нет совсем: имя остаётся.
        let nothing = drawable_of(|m| m.u64(0x50, 0), Lod::High);
        assert_eq!(
            (nothing.lod, nothing.meshes.len(), nothing.name.as_deref()),
            (None, 0, Some("prop_x"))
        );
    }

    #[test]
    fn d5_d7_levels() {
        let only_high = levels_with(&[]);
        assert_eq!(
            format!("{only_high:?}"),
            format!("[Level {{ lod: High, models: 1, meshes: [{MESH_DEBUG}] }}]")
        );
        assert!(levels_with(&[(0x50, U64(0))]).is_empty());
        let four = levels_of(|m| {
            for list in [0x58, 0x60, 0x68] {
                m.ptr(list, 0x400);
            }
        });
        let summary: Vec<String> = four
            .iter()
            .map(|level| format!("{:?}:{}:{}", level.lod, level.models, level.meshes.len()))
            .collect();
        assert_eq!(summary.join(","), "High:1:1,Medium:1:1,Low:1:1,VeryLow:1:1");
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn d8_skeleton_and_d9_matrix_composition() {
        let bones = bones_with(&[]);
        assert_eq!(bones.len(), 2);
        assert_eq!(format!("{:?}", bones[1].matrix), IDENTITY_AT_1_2);

        // Нулевой масштаб считается единичным; у второй кости четверть оборота и масштаб (1, 2, 1).
        let bones = bones_with(&[
            (0x320, Floats(&[0.0, 0.0, 0.0])),
            (0x350, Floats(&[0.0, 0.0, 0.7071068, 0.7071068])),
            (0x370, Floats(&[1.0, 2.0, 1.0])),
        ]);
        assert_eq!(bones[0].scale, [1.0, 1.0, 1.0]);
        assert_eq!(bones[1].scale, [1.0, 2.0, 1.0]);
        assert_eq!(
            format!("{:?}", bones[1].matrix),
            "[-1.1920929e-7, 1.0000001, 0.0, 0.0, -2.0000002, -2.3841858e-7, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 2.0, 0.0, 1.0]"
        );
    }

    #[test]
    fn d10_d13_parent_links() {
        // родитель позже ребёнка
        let bones = bones_with(&[(0x332, I16(1)), (0x382, I16(-1))]);
        assert_eq!(bones[0].parent, 1);
        assert_eq!(format!("{:?}", bones[0].matrix), IDENTITY_AT_1_2);
        assert_eq!(
            format!("{:?}", bones[1].matrix),
            "[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 1.0]"
        );
        // кольцо
        broken(
            read_skeleton(&with(&[(0x332, I16(1))]), 0),
            "Кольцо в скелете модели.",
        );
        // сам себе родитель
        let bones = bones_with(&[(0x332, I16(0))]);
        assert_eq!(bones[0].parent, 0);
        assert_eq!(
            format!("{:?}", bones[0].matrix),
            "[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0]"
        );
        // родитель вне диапазона
        let bones = bones_with(&[(0x382, I16(9))]);
        assert_eq!(bones.len(), 2);
        assert_eq!(bones[1].parent, 9);
        assert_eq!(
            format!("{:?}", bones[1].matrix),
            "[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 1.0]"
        );
    }

    #[test]
    fn d14_d21_skeleton_limits() {
        // Нуль, больше предела и ровно предел костей — пустой скелет.
        for count in [0u16, 1025, 1024] {
            assert!(bones_with(&[(0x31e, U16(count))]).is_empty());
        }
        assert_eq!(bones_with(&[(0x31e, U16(13))]).len(), 13);
        // Нет указателя на первую кость и нет указателя на скелет вовсе — тоже пусто.
        for (at, value) in [(0x2e0usize, 0u64), (0x18, 0)] {
            assert!(bones_with(&[(at, U64(value))]).is_empty());
        }
        assert_eq!(bones_with(&[(0x338, U64(0))])[0].name, "");
        let mut short = base_image();
        short.data.truncate(0x340);
        assert!(read_skeleton(&resource(&short, 165), 0).unwrap().is_empty());
        assert!(read_skeleton(&base(), 5000).unwrap().is_empty());
    }

    // ---- Д22..Д40: материалы

    fn materials_after(patch: impl FnOnce(&mut Image)) -> Vec<Option<Material>> {
        read_materials(&patched(patch), 0).unwrap().1
    }

    fn first_material(patch: impl FnOnce(&mut Image)) -> Material {
        materials_after(patch).swap_remove(0).unwrap()
    }

    /// Хеши шейдера и его файла, которых нет в таблице имён.
    fn unknown_shader(m: &mut Image) {
        m.lay(&[(0x188, U32(0x1234abcd)), (0x198, U32(0x1234abce))]);
    }

    #[test]
    fn d22_d28_materials() {
        let (group, materials, embedded) = read_materials(&base(), 0).unwrap();
        assert!(group && embedded.is_empty());
        assert_eq!(materials.len(), 2);
        assert!(materials[0].is_some() && materials[1].is_none());
        assert!(!read_materials(&with(&[(0x10, U64(0))]), 0).unwrap().0);
        let far = read_materials(&base(), 5000).unwrap();
        assert_eq!((far.0, far.1.len(), far.2.len()), (false, 0, 0));
        let (group, materials, _) = read_materials(&with(&[(0x140, U64(0))]), 0).unwrap();
        assert_eq!(
            (
                group,
                materials.iter().map(Option::is_some).collect::<Vec<_>>()
            ),
            (true, vec![false, false])
        );
        let (group, materials, _) = read_materials(&with(&[(0x118, U16(513))]), 0).unwrap();
        assert_eq!((group, materials.len()), (true, 0));
        assert_eq!(materials_with(&[(0x118, U16(512))]).len(), 512);
        let (group, materials, _) = read_materials(&with(&[(0x110, U64(0))]), 0).unwrap();
        assert_eq!((group, materials.len()), (true, 0));
        let unknown = first_material(unknown_shader);
        assert_eq!(
            (
                unknown.shader.as_str(),
                unknown.shader_file,
                unknown.alpha_mode,
                unknown.emissive,
                unknown.render_bucket
            ),
            ("0x1234abcd", None, AlphaMode::Opaque, false, 0)
        );
    }

    #[test]
    fn d29_d32_alpha_by_bucket() {
        for (bucket, known, expected) in [
            (1, true, AlphaMode::Mask),
            (2, true, AlphaMode::Blend),
            (3, true, AlphaMode::Opaque),
            (1, false, AlphaMode::Opaque),
        ] {
            let first = first_material(|m| {
                m.u8(0x191, bucket);
                if !known {
                    unknown_shader(m);
                }
            });
            assert_eq!(
                first.alpha_mode, expected,
                "bucket {bucket}, known shader: {known}"
            );
            assert_eq!(first.render_bucket, bucket);
        }
    }

    #[test]
    fn d33_d39_parameters() {
        assert!(material_with(&[(0x190, U8(255))]).samplers.is_empty());
        assert!(material_with(&[(0x190, U8(0))]).samplers.is_empty());
        assert!(material_with(&[(0x180, U64(0))]).samplers.is_empty());
        // параметр без текстуры
        let bare = material_with(&[(0x1c8, U64(0))]).samplers;
        assert_eq!(
            format!("{bare:?}"),
            "[Sampler { hash: 4059966321, role: Some(Diffuse), texture: None }]"
        );
        // сэмплер без роли
        let roleless = material_with(&[(0x1f0, U32(0x5555_5555))]).samplers;
        assert_eq!(
            format!("{roleless:?}"),
            "[Sampler { hash: 1431655765, role: None, texture: Some(\"tex_d\") }]"
        );
        // вторая текстура с той же ролью: первая остаётся
        let twice = material_with(&[
            (0x190, U8(2)),
            (0x1d0, U8(0)),
            (0x1d8, Ptr(0x290)),
            (0x2b8, Ptr(0x2f8)),
            (0x2f8, Text("tex2")),
            (0x1e0, U32(joaat("diffusesampler"))),
            (0x1e4, U32(joaat("diffusesampler"))),
        ]);
        assert_eq!(format!("{:?}", twice.textures), "{Diffuse: \"tex_d\"}");
        assert_eq!(twice.samplers.len(), 2);
        assert_eq!(twice.samplers[1].texture.as_deref(), Some("tex2"));
        // тип 2 у второго слота сдвигает хеши на 32 байта
        let shifted =
            material_with(&[(0x1d0, U8(2)), (0x200, U32(joaat("diffusesampler")))]).samplers;
        assert_eq!(shifted.len(), 1);
        assert_eq!(shifted[0].texture.as_deref(), Some("tex_d"));
        assert_eq!(shifted[0].role, Some(Role::Diffuse));
    }

    #[test]
    fn d40_dictionary_error() {
        let r = with(&[(0x108, Ptr(0x900)), (0x900 + 0x30 + 8, U16(5000))]);
        broken(
            read_materials(&r, 0),
            "Словарь текстур заявляет слишком много записей.",
        );
    }

    // ---- Д41..Д50: рамка, огни

    #[test]
    fn d41_d42_frame() {
        let f = read_frame(&base(), 0).unwrap();
        assert_eq!(
            format!("{f:?}"),
            "Frame { sphere_center: [1.0, 3.0, -2.0], sphere_radius: 5.0, bounds_min: [-1.0, -3.0, -5.0], bounds_max: [4.0, 6.0, 2.0], lod_distances: [10.0, 20.0, 30.0, 40.0] }"
        );
        let mut short = base_image();
        short.data.truncate(0x44);
        broken(read_frame(&resource(&short, 165), 0), EOF);
        broken(read_frame(&base(), 5000), EOF);
        // то же самое по смещению 0x100: рамка копируется из заголовка
        let mut moved = base_image();
        let header = moved.data[..0xb8].to_vec();
        moved.put(0x100 + 0x20, &header[0x20..0x80]);
        let frame = read_frame(&resource(&moved, 165), 0x100).unwrap();
        assert_eq!(frame.lod_distances, [10.0, 20.0, 30.0, 40.0]);
    }

    fn lit(count: u16) -> Image {
        let mut m = base_image();
        m.u16(0xb8, count);
        for (i, x) in [1.0f32, 2.0].into_iter().enumerate() {
            let at = 0xd00 + i * 0xa8;
            m.lay(&[
                (at + 8, Floats(&[x, 2.0, 3.0])),
                (at + 0x18, Bytes(&[10, 20, 30])),
                (at + 0x1c, Floats(&[4.5])),
                (at + 0x20, U32(17)),
                (at + 0x24, U16(3)),
                (at + 0x26, U16(2)),
                (at + 0x28, U32(34)),
                (at + 0x2c, Floats(&[7.0, 8.0])),
                (at + 0x5c, Floats(&[0.25])),
                (at + 0x6c, Floats(&[0.75])),
                (at + 0x74, Floats(&[0.0, 1.0, 0.0])),
                (at + 0x8c, Floats(&[15.0, 45.0])),
                (at + 0x94, Floats(&[0.1, 0.2, 0.3])),
            ]);
        }
        m
    }

    fn lights_of(image: &Image) -> Vec<Light> {
        read_lights(&resource(image, 165), 0).unwrap()
    }

    #[test]
    fn d43_d50_lights() {
        assert!(read_lights(&base(), 0).unwrap().is_empty());
        let lights = lights_of(&lit(2));
        assert_eq!(
            format!("{lights:?}"),
            "[Light { position: [1.0, 3.0, -2.0], direction: [0.0, 0.0, -1.0], color: [10, 20, 30], intensity: 4.5, falloff: 7.0, falloff_exponent: 8.0, cone_inner_angle: 15.0, cone_outer_angle: 45.0, kind: 2, flags: 17, time_flags: 34, bone_id: 3, corona_size: 0.25, corona_intensity: 0.75, extent: [0.1, 0.3, -0.2] }, Light { position: [2.0, 3.0, -2.0], direction: [0.0, 0.0, -1.0], color: [10, 20, 30], intensity: 4.5, falloff: 7.0, falloff_exponent: 8.0, cone_inner_angle: 15.0, cone_outer_angle: 45.0, kind: 2, flags: 17, time_flags: 34, bone_id: 3, corona_size: 0.25, corona_intensity: 0.75, extent: [0.1, 0.3, -0.2] }]"
        );
        // Больше предела и ровно предел — огней нет.
        for count in [513, 512] {
            assert!(lights_of(&lit(count)).is_empty());
        }
        // Записи должны помещаться в данные целиком.
        let mut cut = lit(2);
        cut.data.truncate(0xd00 + 2 * 0xa8);
        assert_eq!(lights_of(&cut).len(), 2);
        cut.data.truncate(0xd00 + 2 * 0xa8 - 1);
        assert!(lights_of(&cut).is_empty());
        let mut header_only = lit(2);
        header_only.data.truncate(0xbf);
        assert!(lights_of(&header_only).is_empty());
        assert!(read_lights(&with(&[(0xb0, U64(0))]), 0).unwrap().is_empty());
        assert!(read_lights(&base(), 5000).unwrap().is_empty());
    }

    // ---- Д51..Д77: вид файла и оглавление

    fn with_marker(version: u32, marker: u64) -> Resource {
        let mut m = base_image();
        m.u64(0x18, marker);
        resource(&m, version)
    }

    #[test]
    fn d51_d56_kind() {
        let expected = [
            (with_marker(165, 0), Some(FileKind::Ydr)),
            (with_marker(165, 1), Some(FileKind::Ydd)),
            (with_marker(165, 2), Some(FileKind::Ydr)),
            (with_marker(165, ptr(0x2c0)), Some(FileKind::Ydr)),
            (with_marker(162, 0), Some(FileKind::Yft)),
            (with_marker(13, 0), None),
            (resource(&Image { data: vec![] }, 165), None),
            (
                resource(
                    &Image {
                        data: vec![0; 0x1f],
                    },
                    165,
                ),
                None,
            ),
        ];
        for (res, kind) in &expected {
            assert_eq!(kind_of(res), *kind);
        }
    }

    #[test]
    fn d57_d62_open_model() {
        let mut fragment = base_image();
        fragment.ptr(0x30, 0x440);
        let enhanced = |version: u32| {
            format!(
                "Enhanced: Модель из GTA V Enhanced (версия {version}): Astral читает модели Legacy."
            )
        };
        let ydr = |version: u32| {
            format!(
                "Model {{ kind: Ydr, version: {version}, entries: [Entry {{ at: 0, hash: None }}] }}"
            )
        };
        // образ, версия ресурса, вид, который просят открыть, и что должно получиться
        let rows = [
            (base_image(), 165, None, ydr(165)),
            (base_image(), 154, None, enhanced(154)),
            (base_image(), 159, None, enhanced(159)),
            (base_image(), 171, None, enhanced(171)),
            (base_image(), 154, Some(FileKind::Ydr), enhanced(154)),
            (
                base_image(),
                13,
                None,
                "Version: Это не модель GTA V Legacy (версия ресурса 13).".to_string(),
            ),
            (base_image(), 13, Some(FileKind::Ydr), ydr(13)),
            (
                fragment,
                162,
                None,
                "Model { kind: Yft, version: 162, entries: [Entry { at: 1088, hash: None }] }"
                    .to_string(),
            ),
            (
                base_image(),
                162,
                None,
                "Broken: У фрагмента нет модели.".to_string(),
            ),
            (
                Image { data: vec![] },
                165,
                Some(FileKind::Ydr),
                "Broken: Корень модели недоступен.".to_string(),
            ),
        ];
        for (image, version, kind, expected) in rows {
            let shown = match open_model(&resource(&image, version), kind) {
                Ok(model) => format!("{model:?}"),
                Err(error) => format!("{:?}: {}", error.kind, error.message),
            };
            assert_eq!(shown, expected, "версия {version}, вид {kind:?}");
        }
    }

    fn dictionary(entries: u16, hashes: u16) -> Image {
        let mut m = Image {
            data: vec![0; 0x1000],
        };
        m.lay(&[
            (0x18, U64(1)),
            (0x20, Ptr(0x80)),
            (0x28, U16(hashes)),
            (0x30, Ptr(0x100)),
            (0x38, U16(entries)),
            (0x80, U32(0xdead_beef)),
            (0x84, U32(0x1234)),
            (0x100, Ptr(0x100)),
            (0x108, U64(0)),
            (0x110, Ptr(0x440)),
        ]);
        m
    }

    #[test]
    fn d63_d69_dictionary() {
        let model = open_model(&resource(&dictionary(3, 2), 165), None).unwrap();
        assert_eq!(
            format!("{model:?}"),
            "Model { kind: Ydd, version: 165, entries: [Entry { at: 256, hash: Some(3735928559) }, Entry { at: 1088, hash: None }] }"
        );
        broken(
            open_model(&resource(&dictionary(4097, 0), 165), None),
            "Словарь заявляет слишком много моделей.",
        );
        let at_limit = open_model(&resource(&dictionary(4096, 0), 165), None).unwrap();
        assert_eq!(at_limit.entries.len(), 2);
        let mut no_list = dictionary(3, 2);
        no_list.u64(0x30, 0);
        assert!(open_model(&resource(&no_list, 165), None)
            .unwrap()
            .entries
            .is_empty());
        let single = open_model(&resource(&dictionary(1, 0), 165), None).unwrap();
        assert_eq!(
            format!("{:?}", single.entries),
            "[Entry { at: 256, hash: None }]"
        );
        let mut short = dictionary(1, 0);
        short.data.truncate(0x20);
        broken(open_model(&resource(&short, 165), Some(FileKind::Ydd)), EOF);
    }

    #[test]
    fn d75_level_list_at_the_end() {
        let mut m = base_image();
        m.ptr(0x50, 0xffc);
        broken(read_levels(&resource(&m, 165), 0), EOF);
    }

    // ---- Г: геометрия

    fn mesh_in(image: &Image) -> Mesh {
        read_levels(&resource(image, 165), 0)
            .unwrap()
            .remove(0)
            .meshes
            .remove(0)
    }

    fn mesh_of(patch: impl FnOnce(&mut Image)) -> Mesh {
        levels_of(patch).remove(0).meshes.remove(0)
    }

    fn mesh_count(patch: impl FnOnce(&mut Image)) -> usize {
        levels_of(patch)[0].meshes.len()
    }

    #[test]
    fn g1_g3_mesh_and_raw() {
        assert_eq!(format!("{:?}", mesh_with(&[])), MESH_DEBUG);
        let raw = read_raw_parts(&base(), 0).unwrap();
        assert_eq!(
            format!("{raw:?}"),
            "[RawPart { positions: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0], normals: Some([0.0, 0.0, 2.0, 0.0, 1.0, 0.0, 3.0, 0.0, 0.0]), uvs: Some([0.0, 0.0, 1.0, 0.0, 0.0, 1.0]), indices: [0, 1, 2], shader_index: 1 }]"
        );
        assert!(read_raw_parts(&with(&[(0x50, U64(0))]), 0)
            .unwrap()
            .is_empty());
        assert!(read_raw_parts(&base(), 5000).unwrap().is_empty());
        broken(
            read_raw_parts(&with(&[(0x680, Bytes(&[0, 0, 1, 0, 3, 0]))]), 0),
            "Индекс вершины вне буфера.",
        );
        let d = read_drawable_at(&base(), 0, Lod::High, None).unwrap();
        assert!(d.material_of(&d.meshes[0]).is_none());
        assert!(d.material_of(&Mesh::default()).is_some());
        assert_eq!(d.meshes[0].vertex_count(), 3);
    }

    #[test]
    fn a_normal_is_made_unit_in_the_files_own_axis_order_before_the_swap() {
        // Длина считается по осям файла (x, y, z), а не по осям glTF: порядок сложения квадратов
        // даёт разные последние биты, и нормаль должна совпасть с прежней.
        let (x, y, z) = (-0.532_475_95_f32, -0.582_103_2_f32, 0.575_147_03_f32);
        let mesh = mesh_with(&[(0x70c, Floats(&[x, y, z]))]);
        let length = (x * x + y * y + z * z).sqrt();
        let want = [x / length, z / length, -y / length];
        assert_eq!(&mesh.normals.as_ref().unwrap()[..3], &want);
        assert_eq!(want, [-0.545_399_9_f32, 0.589_106_7_f32, 0.596_231_7_f32]);
    }

    #[test]
    fn g2_zero_normal() {
        let mesh = mesh_with(&[(0x70c, Floats(&[0.0, 0.0, 0.0]))]);
        assert_eq!(
            format!("{:?}", mesh.normals.as_ref().unwrap()),
            "[0.0, 0.0, -0.0, 0.0, 0.0, -1.0, 1.0, 0.0, -0.0]"
        );
    }

    #[test]
    fn g4_g8_skin() {
        let skinned = skin_image();
        let mesh = mesh_in(&skinned);
        assert!(mesh.skinned);
        assert_eq!(
            mesh.joints.as_deref(),
            Some(&[10, 11, 10, 10, 12, 0, 10, 10, 10, 10, 10, 10][..])
        );
        assert_eq!(
            mesh.weights.as_deref(),
            Some(&[1.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0][..])
        );
        assert_eq!(
            mesh.normals.as_deref(),
            Some(&[0.0, 1.0, -0.0, 0.0, 1.0, -0.0, 0.0, 1.0, -0.0][..])
        );
        assert_eq!(mesh.uvs.as_deref(), Some(&[0.5; 6][..]));
        assert_eq!(mesh.colours.as_deref(), Some(&[1.0; 12][..]));
        assert_eq!(mesh.bone_index, Some(1));

        let joints_after = |change: &dyn Fn(&mut Image)| {
            let mut m = skin_image();
            change(&mut m);
            mesh_in(&m).joints
        };
        // без списка костей байты — сразу номера
        assert_eq!(
            joints_after(&|m| m.u16(0x572, 0)).as_deref(),
            Some(&[0, 1, 0, 0, 2, 5, 0, 0, 0, 0, 0, 0][..])
        );
        // список из одной записи
        assert_eq!(
            joints_after(&|m| m.u16(0x572, 1)).as_deref(),
            Some(&[10, 0, 10, 10, 0, 0, 10, 10, 10, 10, 10, 10][..])
        );
        // список не помещается в данные
        assert_eq!(
            joints_after(&|m| m.ptr(0x568, 0xfff)).as_deref(),
            Some(&[0, 1, 0, 0, 2, 5, 0, 0, 0, 0, 0, 0][..])
        );
        // raw без skin-данных
        assert_eq!(
            read_raw_parts(&resource(&skinned, 165), 0).unwrap().len(),
            1
        );
        // только веса: skinned, но без joints и weights
        let mut weights_only = skin_image();
        weights_only.u32(0x600, 0x5b);
        let partial = mesh_in(&weights_only);
        assert_eq!(
            (
                partial.skinned,
                partial.joints.is_some(),
                partial.weights.is_some()
            ),
            (true, false, false)
        );
    }

    #[test]
    fn g9_g25_refusals_and_skips() {
        for (at, nothing) in [
            (0x598, U32(0)),
            (0x538, U64(0)),
            (0x590, U64(0)),
            (0x5b0, U64(0)),
        ] {
            assert_eq!(mesh_count_with(&[(at, nothing)]), 0);
        }
        let positions_at_strides = |buffer: u16, decl: u16| {
            let image = with(&[(0x588, U16(buffer)), (0x604, U16(decl))]);
            read_levels(&image, 0).map(|levels| levels[0].meshes[0].positions.len())
        };
        assert_eq!(positions_at_strides(0, 0).unwrap(), 9);
        assert_eq!(positions_at_strides(0, 36).unwrap(), 9);
        broken(positions_at_strides(8, 36), MSG_VERTEX_BUFFER);
        assert_eq!(positions_at_strides(40, 36).unwrap(), 9);
        // Что портит геометрию и каким текстом её отвергают.
        let refusals: [(&[(usize, Put)], &str); 6] = [
            (
                &[(0x600, U32(0x58))],
                "Геометрия модели без позиций вершин.",
            ),
            (&[(0x598, U32(100_000))], MSG_VERTEX_BUFFER),
            (&[(0x598, U32((1 << 20) + 1))], MSG_VERTEX_BUFFER),
            (
                &[(0x680, Bytes(&[0, 0, 1, 0, 3, 0]))],
                "Индекс вершины вне буфера.",
            ),
            (&[(0x5c8, U32(3_000_000_000))], MSG_INDEX_BUFFER),
            (&[(0x5d0, U64(0))], MSG_INDEX_BUFFER),
        ];
        for (patches, message) in refusals {
            broken(read_levels(&with(patches), 0), message);
        }
        let indices_for = |count: u32| mesh_with(&[(0x5c8, U32(count))]).indices;
        assert!(indices_for(0).is_empty());
        assert_eq!(indices_for(2), vec![0, 1]);
        // запасной указатель данных +0x20
        let spare = mesh_with(&[(0x590, U64(0)), (0x5a0, Ptr(0x700))]);
        assert_eq!(
            spare.positions,
            vec![1.0, 3.0, -2.0, 4.0, 6.0, -5.0, 7.0, 9.0, -8.0]
        );
    }

    #[test]
    fn g26_g37_binding_and_models() {
        let bind = |value: u32| {
            let mesh = mesh_with(&[(0x468, U32(value))]);
            (
                mesh.bone_index,
                mesh.bone_matrix.map(|m| (m[12], m[13], m[14])),
            )
        };
        assert_eq!(bind(0), (Some(0), Some((1.0, 0.0, 0.0))));
        assert_eq!(bind(0x0100_0000), (Some(1), Some((1.0, 2.0, 0.0))));
        assert_eq!(bind(0x0200_0000), (Some(2), None));
        assert_eq!(bind(0x0100_0100), (None, None));
        assert_eq!(bind(0xff00_0000), (Some(255), None));
        let shader_index = |patch: &dyn Fn(&mut Image)| mesh_of(|m| patch(m)).shader_index;
        assert_eq!(shader_index(&|m| m.u64(0x460, 0)), 0);
        assert_eq!(shader_index(&|m| m.u16(0x4a0, 7)), 7);
        for (patch, message) in [
            (
                (0x450, U16(1025)),
                "Часть модели заявляет слишком много геометрий.",
            ),
            ((0x408, U16(4097)), "Модель заявляет слишком много частей."),
        ] {
            broken(read_levels(&with(&[patch]), 0), message);
        }
        assert!(levels_with(&[(0x408, U16(0))]).is_empty());
        assert!(levels_with(&[(0x400, U64(0))]).is_empty());
        let no_geometry = levels_with(&[(0x448, U64(0))]);
        assert_eq!((no_geometry[0].models, no_geometry[0].meshes.len()), (1, 0));
        assert!(read_levels(&base(), 5000).unwrap().is_empty());
    }

    #[test]
    fn g39_g45_vertex_colours() {
        let slots_of = |r: &Resource| {
            let mut out = Vec::new();
            for_each_vertex_colour_slot(r, 0, |at, c| out.push((at, c))).unwrap();
            out
        };
        let mut plain = Vec::new();
        for_each_vertex_colour(&base(), 0, |c| plain.push(c)).unwrap();
        assert_eq!(
            plain,
            vec![[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0]]
        );
        let expected = vec![
            (1816, [255, 0, 0, 255]),
            (1852, [0, 255, 0, 128]),
            (1888, [0, 0, 255, 0]),
        ];
        assert_eq!(slots_of(&base()), expected);
        assert_eq!(slots_of(&with(&[(0x58, Ptr(0x400))])).len(), 6);
        assert_eq!(slots_of(&with(&[(0x600, U32(0x49))])).len(), 0);
        assert_eq!(slots_of(&with(&[(0x604, U16(0))])).len(), 0);
        assert_eq!(slots_of(&with(&[(0x588, U16(40))])), expected);
        assert_eq!(slots_of(&with(&[(0x598, U32(100_000))])).len(), 64);
        for_each_vertex_colour(&base(), 5000, |_| panic!("пусто")).unwrap();
        broken(
            for_each_vertex_colour(&with(&[(0x408, U16(4097))]), 0, |_| {}),
            "Модель заявляет слишком много частей.",
        );
    }

    #[test]
    fn g46_g54_extents() {
        let extents_of =
            |patch: &dyn Fn(&mut Image)| geometry_extents(&patched(|m| patch(m)), 0).unwrap();
        assert_eq!(
            geometry_extents(&base(), 0).unwrap(),
            vec![(1792, 108), (1664, 6)]
        );
        assert_eq!(
            geometry_extents(&resource(&skin_image(), 165), 0).unwrap(),
            vec![(1792, 132), (1664, 6)]
        );
        assert_eq!(
            extents_of(&|m| m.u32(0x598, 100_000)),
            vec![(1792, 3_600_000), (1664, 6)]
        );
        assert_eq!(
            extents_of(&|m| m.u32(0x5c8, 3_000_000_000)),
            vec![(1792, 108), (1664, 6_000_000_000)]
        );
        // шаг меньше 12 байт: вершины не считаются, индексы остаются
        assert_eq!(
            extents_of(&|m| m.lay(&[
                (0x588, U16(8)),
                (0x604, U16(8)),
                (0x600, U32(1)),
                (0x608, U64(2))
            ])),
            vec![(1664, 6)]
        );
        assert_eq!(extents_of(&|m| m.u32(0x5c8, 0)), vec![(1792, 108)]);
        assert!(extents_of(&|m| m.u64(0x538, 0)).is_empty());
        assert_eq!(
            extents_of(&|m| m.u16(0x450, 1025)),
            vec![(1792, 108), (1664, 6)]
        );
        broken(
            geometry_extents(&with(&[(0x408, U16(4097))]), 0),
            "Модель заявляет слишком много частей.",
        );
        assert!(geometry_extents(&base(), 5000).unwrap().is_empty());
    }

    #[test]
    fn g58_g59_second_uv_and_unknown_type() {
        // UV1 как HALF2 рядом с UV0
        let mut m = base_image();
        m.lay(&[
            (0x588, U16(40)),
            (0x600, U32(0x59 | 0x80)),
            (0x604, U16(40)),
            (0x608, U64(6 | 6 << 12 | 9 << 16 | 5 << 24 | 1 << 28)),
        ]);
        let verts = base_image().data[0x700..0x700 + 108].to_vec();
        for v in 0..3 {
            m.lay(&[
                (0x700 + v * 40, Bytes(&verts[v * 36..v * 36 + 36])),
                (0x700 + v * 40 + 36, Bytes(&[0x00, 0x3c, 0x00, 0x40])),
            ]);
        }
        let mesh = mesh_in(&m);
        assert_eq!(
            mesh.uvs1.as_deref(),
            Some(&[1.0, 2.0, 1.0, 2.0, 1.0, 2.0][..])
        );
        assert_eq!(
            mesh.uvs.as_deref(),
            Some(&[0.0, 0.0, 1.0, 0.0, 0.0, 1.0][..])
        );
        // тип позиции 4 не читается: геометрия отвергается, а не берёт числа прошлой вершины
        let r = with(&[(0x608, U64(4 | 6 << 12 | 9 << 16 | 5 << 24))]);
        let error = read_levels(&r, 0).unwrap_err();
        assert_eq!(error.message, MSG_POSITION_TYPE);
    }

    #[test]
    fn g60_g63_graphics_pages_and_names() {
        let mut m = base_image();
        m.data.resize(0x2000, 0);
        let verts = m.data[0x700..0x700 + 108].to_vec();
        m.lay(&[
            (0x1000 + 0x100, Bytes(&verts)),
            (0x1000 + 0x300, Bytes(&[0, 0, 1, 0, 2, 0])),
            (0x590, U64(0x6000_0100)),
            (0x5d0, U64(0x6000_0300)),
        ]);
        let header = Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size: 0x1000,
            graphics_size: 0x1000,
            version: 165,
            declared_version: 165,
        };
        let paged = Resource::from_parts(header, m.data.clone());
        let mesh = &read_levels(&paged, 0).unwrap()[0].meshes[0];
        assert_eq!(
            (&mesh.positions[..], &mesh.indices[..]),
            (
                &[1.0, 3.0, -2.0, 4.0, 6.0, -5.0, 7.0, 9.0, -8.0][..],
                &[0u16, 1, 2][..]
            )
        );

        let name_after = |patch: &dyn Fn(&mut Image)| drawable_of(|m| patch(m), Lod::High).name;
        assert_eq!(name_after(&|m| m.u8(0x2a0, 0)), None);
        assert_eq!(name_after(&|m| m.u64(0xa8, 0)), None);
        let long = patched(|m| {
            m.data.resize(0x1000, 0);
            for i in 0..300 {
                m.u8(0xe00 + i, b'a');
            }
            m.ptr(0xa8, 0xe00);
        });
        let name = read_drawable_at(&long, 0, Lod::High, None)
            .unwrap()
            .name
            .unwrap();
        assert_eq!(name.len(), 256);
        let empty = read_drawable_at(&base(), 5000, Lod::High, None).unwrap();
        assert_eq!(
            format!("{empty:?}"),
            "Drawable { name: None, hash: None, lod: None, has_shader_group: false, meshes: [], materials: [], embedded_textures: [], bones: [] }"
        );
    }

    #[test]
    fn g74_narrow_vertex_with_bones_outside() {
        // шаг 18: байты костей вне вершины читаются как нули
        let mut m = skin_image();
        m.lay(&[
            (0x588, U16(18)),
            (0x604, U16(18)),
            (0x600, U32(0x07)),
            (0x608, U64(6 | 9 << 4 | 8 << 8)),
            (0x572, U16(3)),
        ]);
        for v in 0..3usize {
            m.f32s(0x700 + v * 18, &[1.0 + v as f32, 2.0, 3.0]);
        }
        m.put(0x700 + 12, &[255, 0, 0, 0, 0, 1]);
        let mesh = mesh_in(&m);
        assert_eq!(mesh.joints.as_ref().unwrap().len(), 12);
        assert_eq!(mesh.weights.as_ref().unwrap()[..4], [1.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn negative_control_changes_are_visible() {
        let untouched = format!("{:?}", levels_with(&[]));
        let changed = format!("{:?}", levels_with(&[(0x700, Floats(&[9.0]))]));
        assert_ne!(untouched, changed);
    }
}
