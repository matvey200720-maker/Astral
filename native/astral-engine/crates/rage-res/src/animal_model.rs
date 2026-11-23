//! «Животные» мастерской: метка над животным и свечение — новой геометрией в словаре моделей педа
//! (`a_c_boar.ydd`, `head_000_r.ydd` собаки…).
//!
//! Правка идёт на графе блоков ресурса: чужие блоки остаются как есть, дописываются только новые — шейдеры
//! `emissive` (`emissive_alpha.sps`, корзина 1), листы цвета во встроенном словаре группы шейдеров, геометрии
//! («оболочка» свечения — копия каждой геометрии, раздутая вдоль нормалей; метка — одна скинованная сетка на
//! корневую кость) и пересчитанные рамки, маски корзин и счётчики. Результат читается заново и сверяется с тем, что
//! было до правки: каждая прежняя геометрия — те же вершины, индексы, веса и палитра; чужие рисовалки — без единого
//! отличия; кости и имена — те же.
//!
//! Слой команды разбирает запрос и отдаёт сюда уже проверенные значения (`Marker`, `Glow`, `Sheet`); тексты отказов
//! здесь — те же, что видит приложение.

use std::collections::HashSet;

use crate::{
    error::Error,
    hash::{joaat, sha256_hex},
    meta_graph::deflate_body,
    resource::Resource,
    resource_graph::{self as rg, Address, Graph, Segment, Slot},
    vertex,
};

/// Имена листов во встроенном словаре: у метки и у свечения свои.
pub const MARKER_TEXTURE: &str = "astral_animal_marker";
pub const GLOW_TEXTURE: &str = "astral_animal_glow";
/// Уровни детализации по порядку, как их называет ответ.
pub const LOD_NAMES: [&str; 4] = ["high", "medium", "low", "veryLow"];

/// Раскладка вершины новых геометрий: позиция, веса, номера костей, нормаль, цвет, развёртка (`GTAV1`).
const DECLARATION_TYPES: u64 = 0x7755_5555_5599_6996;
const SKINNED_FLAGS: u32 = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6);
const RIGID_FLAGS: u32 = (1 << 0) | (1 << 3) | (1 << 4) | (1 << 6);
const SKINNED_STRIDE: usize = 44;
const RIGID_STRIDE: usize = 36;
/// Бит корзины прозрачности: у шейдера `emissive_alpha` корзина 1.
const ALPHA_BUCKET_BIT: u8 = 1 << 1;
/// Таблицы виртуальных функций, как у объектов игры (проверено на образцах).
const VFT_TEXTURE: u32 = 0x4061_7568;
const VFT_DICTIONARY: u32 = 0x4057_7598;
const VFT_GEOMETRY: u32 = 0x4061_8798;
const VFT_VERTEX_BUFFER: u32 = 0x4061_d3f8;
const VFT_INDEX_BUFFER: u32 = 0x4061_d158;
/// Формат DXT5 в объекте листа: `DXT5` как четыре знака.
const FORMAT_DXT5: u32 = 0x3554_5844;

/// Смещения полей объектов.
mod at {
    pub const DICT_HASHES: usize = 0x20;
    pub const DICT_HASH_COUNT: usize = 0x28;
    pub const DICT_DRAWABLES: usize = 0x30;
    pub const DICT_DRAWABLE_COUNT: usize = 0x38;
    pub const DRAW_GROUP: usize = 0x10;
    pub const DRAW_SKELETON: usize = 0x18;
    pub const DRAW_CENTRE: usize = 0x20;
    pub const DRAW_RADIUS: usize = 0x2c;
    pub const DRAW_MIN: usize = 0x30;
    pub const DRAW_MAX: usize = 0x40;
    pub const DRAW_LODS: usize = 0x50;
    pub const DRAW_FLAGS: usize = 0x80;
    pub const DRAW_WORD: usize = 0x9a;
    pub const DRAW_NAME: usize = 0xa8;
    pub const GROUP_DICTIONARY: usize = 0x08;
    pub const GROUP_SHADERS: usize = 0x10;
    pub const GROUP_COUNT: usize = 0x18;
    pub const GROUP_CAPACITY: usize = 0x1a;
    pub const GROUP_SERVICE: usize = 0x30;
    pub const LIST_ENTRIES: usize = 0x00;
    pub const LIST_COUNT: usize = 0x08;
    pub const MODEL_GEOMETRIES: usize = 0x08;
    pub const MODEL_COUNT: usize = 0x10;
    pub const MODEL_BOUNDS: usize = 0x18;
    pub const MODEL_MAPPING: usize = 0x20;
    pub const MODEL_BONE: usize = 0x28;
    pub const MODEL_SKIN: usize = 0x29;
    pub const MODEL_MASK: usize = 0x2c;
    pub const GEOMETRY_BUFFER: usize = 0x18;
    pub const GEOMETRY_INDICES: usize = 0x38;
    pub const GEOMETRY_INDEX_COUNT: usize = 0x58;
    pub const GEOMETRY_TRIANGLES: usize = 0x5c;
    pub const GEOMETRY_VERTICES: usize = 0x60;
    pub const GEOMETRY_PALETTE: usize = 0x68;
    pub const GEOMETRY_STRIDE: usize = 0x70;
    pub const GEOMETRY_BONES: usize = 0x72;
    pub const GEOMETRY_STREAM: usize = 0x78;
    pub const BUFFER_STRIDE: usize = 0x08;
    pub const BUFFER_STREAM: usize = 0x10;
    pub const BUFFER_COUNT: usize = 0x18;
    pub const BUFFER_STREAM_B: usize = 0x20;
    pub const BUFFER_DECLARATION: usize = 0x30;
    pub const INDEX_COUNT: usize = 0x08;
    pub const INDEX_DATA: usize = 0x10;
    pub const SHADER_PARAMS: usize = 0x00;
    pub const SHADER_COUNT: usize = 0x10;
    pub const SHADER_BUCKET: usize = 0x11;
    pub const SHADER_NAME: usize = 0x08;
    pub const SHADER_FILE: usize = 0x18;
    pub const TEXTURE_NAME: usize = 0x28;
    pub const TEXTURE_DATA: usize = 0x70;
    pub const SKELETON_BONES: usize = 0x20;
    pub const SKELETON_COUNT: usize = 0x5e;
    pub const BONE_SIZE: usize = 0x50;
    pub const BONE_NAME: usize = 0x38;
}

// ---------------------------------------------------------------------------------------------------------------
// Отказ и значения запроса
// ---------------------------------------------------------------------------------------------------------------

/// Отказ правки: готовый текст для приложения (у хоста это `InvalidDataException`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal(pub String);

pub type Result<T> = std::result::Result<T, Refusal>;

fn refuse<T>(text: impl Into<String>) -> Result<T> {
    Err(Refusal(text.into()))
}

/// Лист цвета: DXT5, степень двойки 4–1024, цепочка mip как в файле; `payload` — данные без заголовка DDS.
#[derive(Debug, Clone)]
pub struct Sheet {
    pub name: &'static str,
    pub width: u16,
    pub height: u16,
    pub levels: u8,
    pub payload: Vec<u8>,
}

/// Метка: сетка в метрах в осях RAGE (Z вверх), развёртка, индексы и свой лист цвета.
#[derive(Debug, Clone)]
pub struct Marker {
    pub drawable: u32,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u16>,
    pub sheet: Sheet,
    pub emissive: f32,
}

/// Свечение: оболочка каждой геометрии названных рисовалок, раздутая на `inflate` метров.
#[derive(Debug, Clone)]
pub struct Glow {
    pub drawables: Vec<u32>,
    pub inflate: f32,
    pub sheet: Sheet,
    pub emissive: f32,
}

// ---------------------------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------------------------

/// Коробка и сфера рисовалки.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Frame {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub centre: [f32; 3],
    pub radius: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LodRow {
    pub lod: &'static str,
    pub models: usize,
    pub before: usize,
    pub after: usize,
    pub glow: usize,
    pub marker: usize,
    pub flags_before: u32,
    pub flags_after: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ShaderRow {
    pub index: usize,
    pub texture: &'static str,
    pub emissive: f32,
    pub width: u16,
    pub height: u16,
    pub levels: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Changed {
    pub hash: u32,
    pub name: String,
    pub marker: bool,
    pub glow: bool,
    pub lods: Vec<LodRow>,
    pub shaders_before: usize,
    pub shaders_after: usize,
    pub added: Vec<ShaderRow>,
    pub textures_before: Vec<String>,
    pub textures_after: Vec<String>,
    pub bounds_before: Frame,
    pub bounds_after: Frame,
    pub bones: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Semantic {
    pub drawables: usize,
    pub unchanged: usize,
    pub changed: Vec<Changed>,
}

#[derive(Debug)]
pub struct Patched {
    pub bytes: Vec<u8>,
    pub semantic: Semantic,
}

// ---------------------------------------------------------------------------------------------------------------
// Мелкие чтения графа
// ---------------------------------------------------------------------------------------------------------------

fn link(g: &Graph, block: usize, relative: usize) -> Option<usize> {
    let slot = g.blocks[block]
        .slots
        .iter()
        .find(|slot| slot.relative == relative)?;
    g.block_at(slot.target)
}

fn word<const N: usize>(g: &Graph, block: usize, relative: usize) -> [u8; N] {
    let mut out = [0u8; N];
    if let Some(part) = g.content(block).get(relative..relative + N) {
        out.copy_from_slice(part);
    }
    out
}

fn u8_at(g: &Graph, block: usize, relative: usize) -> u8 {
    word::<1>(g, block, relative)[0]
}

fn u16_at(g: &Graph, block: usize, relative: usize) -> u16 {
    u16::from_le_bytes(word(g, block, relative))
}

fn u32_at(g: &Graph, block: usize, relative: usize) -> u32 {
    u32::from_le_bytes(word(g, block, relative))
}

fn f32_at(g: &Graph, block: usize, relative: usize) -> f32 {
    f32::from_le_bytes(word(g, block, relative))
}

fn f32s<const N: usize>(g: &Graph, block: usize, relative: usize) -> [f32; N] {
    std::array::from_fn(|k| f32_at(g, block, relative + 4 * k))
}

/// Строка с нулём на конце, на которую указывает поле.
fn text_at(g: &Graph, block: usize, relative: usize) -> Option<String> {
    let text = link(g, block, relative)?;
    let bytes = g.content(text);
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
}

fn address(g: &Graph, block: usize) -> Address {
    Address {
        segment: g.blocks[block].segment,
        offset: g.blocks[block].start,
    }
}

/// Блок с указателями на `targets` (слоты по порядку).
fn pointer_block(g: &mut Graph, targets: &[usize]) -> usize {
    let slots = targets
        .iter()
        .enumerate()
        .map(|(k, &t)| Slot {
            relative: k * 8,
            target: address(g, t),
        })
        .collect();
    rg::append_block(g, Segment::System, vec![0u8; targets.len() * 8], slots)
}

/// Указатель поля `relative` переводится на начало блока `to`; нет слота — он заводится.
fn point(g: &mut Graph, block: usize, relative: usize, to: usize) {
    let target = address(g, to);
    match g.blocks[block]
        .slots
        .iter_mut()
        .find(|slot| slot.relative == relative)
    {
        Some(slot) => slot.target = target,
        None => g.blocks[block].slots.push(Slot { relative, target }),
    }
}

fn put(g: &mut Graph, block: usize, relative: usize, bytes: &[u8]) -> Result<()> {
    rg::write_at(g, block, relative, bytes).map_err(|e| Refusal(e.message))
}

fn le16(value: u16) -> [u8; 2] {
    value.to_le_bytes()
}

fn from_lib(error: Error) -> Refusal {
    Refusal(error.message)
}

// ---------------------------------------------------------------------------------------------------------------
// Словарь и его рисовалки
// ---------------------------------------------------------------------------------------------------------------

/// Рисовалка словаря: блок, хэш и имя в файле (если есть).
struct Slotted {
    block: usize,
    hash: u32,
    stored: Option<String>,
}

fn read_dictionary(g: &Graph) -> Result<Vec<Slotted>> {
    let open =
        "Модель не открывается: в словаре нет drawable или хэши не сходятся с числом моделей.";
    let root = g.root().ok_or_else(|| Refusal(open.into()))?;
    let (hashes, list) = (
        link(g, root, at::DICT_HASHES),
        link(g, root, at::DICT_DRAWABLES),
    );
    let (hash_count, count) = (
        usize::from(u16_at(g, root, at::DICT_HASH_COUNT)),
        usize::from(u16_at(g, root, at::DICT_DRAWABLE_COUNT)),
    );
    let (Some(hashes), Some(list)) = (hashes, list) else {
        return refuse(open);
    };
    if count == 0 || hash_count != count {
        return refuse(open);
    }
    let mut items = Vec::with_capacity(count);
    for index in 0..count {
        let Some(block) = link(g, list, index * 8) else {
            return refuse(open);
        };
        let hash = u32_at(g, hashes, index * 4);
        items.push(Slotted {
            block,
            hash,
            stored: text_at(g, block, at::DRAW_NAME),
        });
    }
    let distinct: HashSet<u32> = items.iter().map(|item| item.hash).collect();
    if distinct.len() != items.len() {
        return refuse("В словаре два drawable с одним хэшем: правка однозначной не будет.");
    }
    Ok(items)
}

/// Имя рисовалки так, как его видит читатель словаря: хэш без своего имени в файле называется `hash_XXXXXXXX`.
fn reader_name(item: &Slotted) -> String {
    match &item.stored {
        Some(name) if !name.is_empty() && joaat(name) == item.hash => name.clone(),
        _ => format!("hash_{:08X}", item.hash),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Отпечатки: что было до правки и что стало
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
struct GeometryPrint {
    digest: String,
    shader: u16,
    vertices: usize,
    skinned: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct ModelPrint {
    has_skin: u8,
    bone_index: u8,
    render_mask: u8,
    geometries: Vec<GeometryPrint>,
}

#[derive(Debug, Clone, PartialEq)]
struct ShaderPrint {
    name: u32,
    file: u32,
    bucket: u8,
    params: usize,
    textures: String,
}

#[derive(Debug, Clone)]
struct DrawPrint {
    bones: Vec<String>,
    shaders: Vec<ShaderPrint>,
    textures: Vec<String>,
    lods: [Vec<ModelPrint>; 4],
    lod_flags: [u32; 4],
    frame: Frame,
}

/// Компоненты декларации вершин: флаги, типы, шаг.
#[derive(Debug, Clone, Copy)]
struct Declaration {
    flags: u32,
    stride: usize,
    types: u64,
}

impl Declaration {
    fn read(g: &Graph, block: usize) -> Declaration {
        Declaration {
            flags: u32_at(g, block, 0),
            stride: usize::from(u16_at(g, block, 4)),
            types: u64::from_le_bytes(word(g, block, 8)),
        }
    }

    fn layout(&self) -> vertex::Layout {
        vertex::layout_lenient(self.flags, self.types)
    }

    fn type_of(&self, component: usize) -> u8 {
        (self.types >> (component * 4) & 0xf) as u8
    }

    /// Скин в вершине: веса и номера костей по четыре байта.
    fn carries_skin(&self) -> bool {
        let layout = self.layout();
        self.flags & 6 == 6
            && layout
                .get(vertex::BLEND_WEIGHTS)
                .is_some_and(|e| e.size == 4)
            && layout
                .get(vertex::BLEND_INDICES)
                .is_some_and(|e| e.size == 4)
    }
}

/// Геометрия модели: блоки и то, что из них читается.
struct Geometry {
    block: usize,
    declaration: Option<Declaration>,
    stream: Option<usize>,
    vertices: usize,
    indices: Option<Vec<u16>>,
    palette: Vec<u16>,
}

impl Geometry {
    fn read(g: &Graph, block: usize) -> Geometry {
        let buffer = link(g, block, at::GEOMETRY_BUFFER);
        let declaration = buffer
            .and_then(|b| link(g, b, at::BUFFER_DECLARATION))
            .filter(|d| g.content(*d).len() >= 16)
            .map(|d| Declaration::read(g, d));
        let stream = buffer.and_then(|b| {
            link(g, b, at::BUFFER_STREAM).or_else(|| link(g, b, at::BUFFER_STREAM_B))
        });
        let vertices = buffer.map_or(0, |b| u32_at(g, b, at::BUFFER_COUNT) as usize);
        let indices = link(g, block, at::GEOMETRY_INDICES).and_then(|ib| {
            let count = u32_at(g, ib, at::INDEX_COUNT) as usize;
            let data = link(g, ib, at::INDEX_DATA)?;
            let bytes = g.content(data).get(..count * 2)?;
            Some(
                bytes
                    .chunks_exact(2)
                    .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                    .collect(),
            )
        });
        let wanted = usize::from(u16_at(g, block, at::GEOMETRY_BONES));
        let palette = link(g, block, at::GEOMETRY_PALETTE)
            .map(|p| {
                g.content(p)
                    .get(..wanted * 2)
                    .unwrap_or_default()
                    .chunks_exact(2)
                    .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                    .collect()
            })
            .unwrap_or_default();
        Geometry {
            block,
            declaration,
            stream,
            vertices,
            indices,
            palette,
        }
    }

    /// Вершины потока: `vertices` штук по шагу декларации; короче заявленного — `None`.
    fn vertex_bytes<'g>(&self, g: &'g Graph) -> Option<&'g [u8]> {
        let declaration = self.declaration?;
        let all = g.content(self.stream?);
        all.get(..self.vertices.checked_mul(declaration.stride)?)
    }
}

/// Модель уровня: блок и поля.
struct Model {
    block: usize,
    geometries: Vec<usize>,
    skin: u8,
    bone: u8,
    mask: u8,
    mapping: Option<Vec<u16>>,
    boxes: Vec<[f32; 8]>,
}

impl Model {
    fn read(g: &Graph, block: usize) -> Model {
        let count = usize::from(u16_at(g, block, at::MODEL_COUNT));
        let list = link(g, block, at::MODEL_GEOMETRIES);
        let geometries = list
            .map(|list| (0..count).filter_map(|k| link(g, list, k * 8)).collect())
            .unwrap_or_default();
        let mapping = link(g, block, at::MODEL_MAPPING)
            .map(|m| (0..count).map(|k| u16_at(g, m, k * 2)).collect());
        let records = if count > 1 { count + 1 } else { count };
        let boxes = link(g, block, at::MODEL_BOUNDS)
            .map(|b| (0..records).map(|k| f32s::<8>(g, b, k * 32)).collect())
            .unwrap_or_default();
        Model {
            block,
            geometries,
            skin: u8_at(g, block, at::MODEL_SKIN),
            bone: u8_at(g, block, at::MODEL_BONE),
            mask: u8_at(g, block, at::MODEL_MASK),
            mapping,
            boxes,
        }
    }

    fn shader_of(&self, index: usize) -> u16 {
        self.mapping
            .as_ref()
            .and_then(|m| m.get(index).copied())
            .unwrap_or(0)
    }

    /// Рамка геометрии: у модели из нескольких геометрий записи идут после сводной.
    fn box_of(&self, index: usize) -> [f32; 8] {
        let skip = usize::from(self.geometries.len() > 1);
        self.boxes.get(skip + index).copied().unwrap_or([0.0; 8])
    }
}

/// Модели уровня рисовалки.
fn level_models(g: &Graph, drawable: usize, lod: usize) -> Vec<Model> {
    let Some(head) = link(g, drawable, at::DRAW_LODS + lod * 8) else {
        return Vec::new();
    };
    let count = usize::from(u16_at(g, head, at::LIST_COUNT));
    let Some(entries) = link(g, head, at::LIST_ENTRIES) else {
        return Vec::new();
    };
    (0..count)
        .filter_map(|k| link(g, entries, k * 8))
        .map(|block| Model::read(g, block))
        .collect()
}

fn lod_flags(g: &Graph, drawable: usize, lod: usize) -> u32 {
    u32::from(u16_at(g, drawable, at::DRAW_FLAGS + lod * 4))
}

fn frame_of(g: &Graph, drawable: usize) -> Frame {
    Frame {
        min: f32s(g, drawable, at::DRAW_MIN),
        max: f32s(g, drawable, at::DRAW_MAX),
        centre: f32s(g, drawable, at::DRAW_CENTRE),
        radius: f32_at(g, drawable, at::DRAW_RADIUS),
    }
}

fn print_geometry(g: &Graph, geometry: usize, shader: u16) -> GeometryPrint {
    let read = Geometry::read(g, geometry);
    let mut body = Vec::new();
    if let Some(d) = read.declaration {
        body.extend_from_slice(&d.flags.to_le_bytes());
        body.extend_from_slice(&d.types.to_le_bytes());
        body.extend_from_slice(&(d.stride as u16).to_le_bytes());
    }
    if let Some(bytes) = read.vertex_bytes(g) {
        body.extend_from_slice(bytes);
    }
    for index in read.indices.iter().flatten() {
        body.extend_from_slice(&index.to_le_bytes());
    }
    for bone in &read.palette {
        body.extend_from_slice(&bone.to_le_bytes());
    }
    GeometryPrint {
        digest: sha256_hex(&body),
        shader,
        vertices: read.vertices,
        skinned: read.declaration.is_some_and(|d| d.carries_skin()),
    }
}

fn print_model(g: &Graph, model: &Model) -> ModelPrint {
    ModelPrint {
        has_skin: model.skin,
        bone_index: model.bone,
        render_mask: model.mask,
        geometries: model
            .geometries
            .iter()
            .enumerate()
            .map(|(k, &geometry)| print_geometry(g, geometry, model.shader_of(k)))
            .collect(),
    }
}

fn print_shader(g: &Graph, shader: usize) -> ShaderPrint {
    let params = usize::from(u8_at(g, shader, at::SHADER_COUNT));
    let records = link(g, shader, at::SHADER_PARAMS);
    let textures = (0..params)
        .map(|k| {
            let texture = records
                .filter(|&r| u8_at(g, r, k * 16) == 0)
                .and_then(|r| link(g, r, k * 16 + 8));
            texture.map_or_else(
                || "v".to_owned(),
                |t| {
                    text_at(g, t, at::TEXTURE_NAME)
                        .unwrap_or_default()
                        .to_lowercase()
                },
            )
        })
        .collect::<Vec<_>>()
        .join("|");
    ShaderPrint {
        name: u32_at(g, shader, at::SHADER_NAME),
        file: u32_at(g, shader, at::SHADER_FILE),
        bucket: u8_at(g, shader, at::SHADER_BUCKET),
        params,
        textures,
    }
}

/// Блоки шейдеров группы по порядку.
fn group_shaders(g: &Graph, group: usize) -> Vec<usize> {
    let count = usize::from(u16_at(g, group, at::GROUP_COUNT));
    link(g, group, at::GROUP_SHADERS)
        .map(|list| (0..count).filter_map(|k| link(g, list, k * 8)).collect())
        .unwrap_or_default()
}

/// Объекты листов встроенного словаря по порядку списка: блок и имя.
fn dictionary_textures(g: &Graph, group: usize) -> Vec<(usize, String)> {
    let Some(dictionary) = link(g, group, at::GROUP_DICTIONARY) else {
        return Vec::new();
    };
    let count = usize::from(u16_at(g, dictionary, 0x38));
    let Some(list) = link(g, dictionary, 0x30) else {
        return Vec::new();
    };
    (0..count)
        .filter_map(|k| link(g, list, k * 8))
        .map(|object| {
            (
                object,
                text_at(g, object, at::TEXTURE_NAME).unwrap_or_default(),
            )
        })
        .collect()
}

fn skeleton_bones(g: &Graph, drawable: usize) -> Vec<String> {
    let Some(skeleton) = link(g, drawable, at::DRAW_SKELETON) else {
        return Vec::new();
    };
    let count = usize::from(u16_at(g, skeleton, at::SKELETON_COUNT));
    let Some(bones) = link(g, skeleton, at::SKELETON_BONES) else {
        return Vec::new();
    };
    let slots = &g.blocks[bones].slots;
    (0..count)
        .map(|k| {
            let relative = k * at::BONE_SIZE + at::BONE_NAME;
            let named = slots
                .iter()
                .find(|s| s.relative == relative)
                .and_then(|s| g.block_at(s.target));
            named
                .map(|n| {
                    let bytes = g.content(n);
                    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                    String::from_utf8_lossy(&bytes[..end]).into_owned()
                })
                .unwrap_or_default()
        })
        .collect()
}

fn print_drawable(g: &Graph, drawable: usize) -> DrawPrint {
    let group = link(g, drawable, at::DRAW_GROUP);
    DrawPrint {
        bones: skeleton_bones(g, drawable),
        shaders: group
            .map(|group| {
                group_shaders(g, group)
                    .into_iter()
                    .map(|s| print_shader(g, s))
                    .collect()
            })
            .unwrap_or_default(),
        textures: group
            .map(|group| {
                dictionary_textures(g, group)
                    .into_iter()
                    .map(|(_, name)| name.to_lowercase())
                    .collect()
            })
            .unwrap_or_default(),
        lods: std::array::from_fn(|lod| {
            level_models(g, drawable, lod)
                .iter()
                .map(|m| print_model(g, m))
                .collect()
        }),
        lod_flags: std::array::from_fn(|lod| lod_flags(g, drawable, lod)),
        frame: frame_of(g, drawable),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Числа: те же действия над `f32`, что у хоста
// ---------------------------------------------------------------------------------------------------------------

fn length3(v: [f32; 3]) -> f32 {
    f64::from(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt() as f32
}

fn less(a: f32, b: f32) -> f32 {
    if a < b {
        a
    } else {
        b
    }
}

fn greater(a: f32, b: f32) -> f32 {
    if a > b {
        a
    } else {
        b
    }
}

/// Нормали метки по площади соседних треугольников, если окно их не дало.
pub fn smooth_normals(positions: &[f32], indices: &[usize]) -> Vec<f32> {
    let mut sums = vec![0f64; positions.len()];
    for triangle in indices.chunks_exact(3) {
        let [a, b, c] = [triangle[0] * 3, triangle[1] * 3, triangle[2] * 3];
        let p = |at: usize| f64::from(positions[at]);
        let (ux, uy, uz) = (p(b) - p(a), p(b + 1) - p(a + 1), p(b + 2) - p(a + 2));
        let (vx, vy, vz) = (p(c) - p(a), p(c + 1) - p(a + 1), p(c + 2) - p(a + 2));
        let (nx, ny, nz) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        for vertex in [a, b, c] {
            sums[vertex] += nx;
            sums[vertex + 1] += ny;
            sums[vertex + 2] += nz;
        }
    }
    let mut normals = vec![0f32; positions.len()];
    for at in (0..normals.len()).step_by(3) {
        let length =
            (sums[at] * sums[at] + sums[at + 1] * sums[at + 1] + sums[at + 2] * sums[at + 2])
                .sqrt();
        if length < 1e-12 {
            normals[at + 2] = 1.0;
            continue;
        }
        for axis in 0..3 {
            normals[at + axis] = (sums[at + axis] / length) as f32;
        }
    }
    normals
}

/// Слово `+0x9a` рисовалки: по числу геометрий уровня и по палитрам костей (число костей в восьмёрках).
fn render_word(levels: &[Vec<Model>; 4], g: &Graph) -> u16 {
    let mut total = 0usize;
    for models in levels {
        let geometries: Vec<usize> = models
            .iter()
            .flat_map(|m| m.geometries.iter().copied())
            .collect();
        total += match geometries.len() {
            0 => 0,
            n => usize::from(crate::drawable_write::sign_render_word(n)),
        };
        total += geometries
            .iter()
            .map(|&geometry| usize::from(u16_at(g, geometry, at::GEOMETRY_BONES)).div_ceil(8))
            .sum::<usize>();
    }
    total.min(usize::from(u16::MAX)) as u16
}

// ---------------------------------------------------------------------------------------------------------------
// Новые блоки
// ---------------------------------------------------------------------------------------------------------------

/// Новая геометрия до вставки в модель.
struct NewGeometry {
    block: usize,
    shader: u16,
    aabb: [f32; 8],
}

/// Всё, что нужно, чтобы собрать геометрию в графе.
struct Mesh<'a> {
    positions: &'a [f32],
    normals: &'a [f32],
    uvs: &'a [f32],
    weights: Option<&'a [u8]>,
    bones: Option<&'a [u8]>,
    indices: &'a [u16],
    /// Куда указывает буфер индексов: готовое место (копия индексов лежит рядом с оригиналом, так файл сжимается
    /// лучше) или `None` — свой блок.
    index_data: Option<Address>,
    palette: Option<&'a [u16]>,
    shader: u16,
}

/// Геометрия, собранная прямо в графе: раскладка `GTAV1` (у скинованной — позиция, веса, номера костей, нормаль,
/// цвет, развёртка), белый цвет вершин, один поток на обе ссылки буфера, 16-битные индексы.
fn build_geometry(g: &mut Graph, mesh: &Mesh) -> Result<NewGeometry> {
    let count = mesh.positions.len() / 3;
    if !(3..=usize::from(u16::MAX)).contains(&count) {
        return refuse("Геометрия: число вершин вне 3…65535 (индексы игры — 16 бит).");
    }
    let skinned = mesh.weights.is_some();
    let (flags, stride) = if skinned {
        (SKINNED_FLAGS, SKINNED_STRIDE)
    } else {
        (RIGID_FLAGS, RIGID_STRIDE)
    };
    let layout = vertex::layout_lenient(flags, DECLARATION_TYPES);
    let offset = |semantic: usize| layout.get(semantic).map_or(0, |e| e.offset);
    let [position_at, weights_at, indices_at, normal_at, colour_at, uv_at] = [
        vertex::POSITION,
        vertex::BLEND_WEIGHTS,
        vertex::BLEND_INDICES,
        vertex::NORMAL,
        vertex::COLOUR0,
        vertex::UV0,
    ]
    .map(offset);
    let mut bytes = vec![0u8; count * stride];
    let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
    for vertex in 0..count {
        let row = vertex * stride;
        for axis in 0..3 {
            let position = mesh.positions[vertex * 3 + axis];
            bytes[row + position_at + axis * 4..][..4].copy_from_slice(&position.to_le_bytes());
            bytes[row + normal_at + axis * 4..][..4]
                .copy_from_slice(&mesh.normals[vertex * 3 + axis].to_le_bytes());
            low[axis] = f32_min(low[axis], position);
            high[axis] = f32_max(high[axis], position);
        }
        if let (Some(weights), Some(bones)) = (mesh.weights, mesh.bones) {
            bytes[row + weights_at..][..4].copy_from_slice(&weights[vertex * 4..][..4]);
            bytes[row + indices_at..][..4].copy_from_slice(&bones[vertex * 4..][..4]);
        }
        bytes[row + colour_at..][..4].fill(255);
        bytes[row + uv_at..][..4].copy_from_slice(&mesh.uvs[vertex * 2].to_le_bytes());
        bytes[row + uv_at + 4..][..4].copy_from_slice(&mesh.uvs[vertex * 2 + 1].to_le_bytes());
    }

    let mut declaration = Vec::with_capacity(16);
    declaration.extend_from_slice(&flags.to_le_bytes());
    declaration.extend_from_slice(&(stride as u16).to_le_bytes());
    declaration.extend_from_slice(&[0, flags.count_ones() as u8]);
    declaration.extend_from_slice(&DECLARATION_TYPES.to_le_bytes());
    let declaration = rg::append_block(g, Segment::System, declaration, Vec::new());
    let stream = rg::append_block(g, Segment::System, bytes, Vec::new());

    let mut buffer = vec![0u8; 0x40];
    buffer[..8].copy_from_slice(&(u64::from(VFT_VERTEX_BUFFER) | 1 << 32).to_le_bytes());
    buffer[at::BUFFER_STRIDE..][..2].copy_from_slice(&le16(stride as u16));
    buffer[at::BUFFER_COUNT..][..4].copy_from_slice(&(count as u32).to_le_bytes());
    let slots = vec![
        Slot {
            relative: at::BUFFER_STREAM,
            target: address(g, stream),
        },
        Slot {
            relative: at::BUFFER_STREAM_B,
            target: address(g, stream),
        },
        Slot {
            relative: at::BUFFER_DECLARATION,
            target: address(g, declaration),
        },
    ];
    let buffer = rg::append_block(g, Segment::System, buffer, slots);

    let index_at = match mesh.index_data {
        Some(at) => at,
        None => {
            let index_data: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();
            let index_data = rg::append_block(g, Segment::System, index_data, Vec::new());
            address(g, index_data)
        }
    };
    let mut index_buffer = vec![0u8; 0x40];
    index_buffer[..8].copy_from_slice(&(u64::from(VFT_INDEX_BUFFER) | 1 << 32).to_le_bytes());
    index_buffer[at::INDEX_COUNT..][..4]
        .copy_from_slice(&(mesh.indices.len() as u32).to_le_bytes());
    let index_buffer = rg::append_block(
        g,
        Segment::System,
        index_buffer,
        vec![Slot {
            relative: at::INDEX_DATA,
            target: index_at,
        }],
    );

    let mut geometry = vec![0u8; 0xa0];
    geometry[..8].copy_from_slice(&(u64::from(VFT_GEOMETRY) | 1 << 32).to_le_bytes());
    geometry[at::GEOMETRY_INDEX_COUNT..][..4]
        .copy_from_slice(&(mesh.indices.len() as u32).to_le_bytes());
    geometry[at::GEOMETRY_TRIANGLES..][..4]
        .copy_from_slice(&((mesh.indices.len() / 3) as u32).to_le_bytes());
    geometry[at::GEOMETRY_VERTICES..][..2].copy_from_slice(&le16(count as u16));
    geometry[0x62..][..2].copy_from_slice(&le16(3));
    geometry[at::GEOMETRY_STRIDE..][..2].copy_from_slice(&le16(stride as u16));
    let mut slots = vec![
        Slot {
            relative: at::GEOMETRY_BUFFER,
            target: address(g, buffer),
        },
        Slot {
            relative: at::GEOMETRY_INDICES,
            target: address(g, index_buffer),
        },
    ];
    if let Some(palette) = mesh.palette.filter(|p| !p.is_empty()) {
        let words: Vec<u8> = palette.iter().flat_map(|w| w.to_le_bytes()).collect();
        let palette_block = rg::append_block(g, Segment::System, words, Vec::new());
        slots.push(Slot {
            relative: at::GEOMETRY_PALETTE,
            target: address(g, palette_block),
        });
        geometry[at::GEOMETRY_BONES..][..2].copy_from_slice(&le16(palette.len() as u16));
    }
    slots.push(Slot {
        relative: at::GEOMETRY_STREAM,
        target: address(g, stream),
    });
    let block = rg::append_block(g, Segment::System, geometry, slots);
    /* Рамка геометрии у Rockstar: четвёртая компонента повторяет первую. */
    let aabb = [
        low[0], low[1], low[2], low[0], high[0], high[1], high[2], high[0],
    ];
    Ok(NewGeometry {
        block,
        shader: mesh.shader,
        aabb,
    })
}

/// `Math.Min` у `float`: NaN побеждает.
fn f32_min(a: f32, b: f32) -> f32 {
    if a.is_nan() || b.is_nan() {
        f32::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

fn f32_max(a: f32, b: f32) -> f32 {
    if a.is_nan() || b.is_nan() {
        f32::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

/// Параметры шейдера `emissive`: запись листа, шесть векторов и таблица хэшей — один блок в 236 байт, как у игры.
fn params_block(g: &mut Graph, texture: usize, emissive: f32) -> usize {
    const NAMES: [&str; 7] = [
        "DiffuseSampler",
        "matMaterialColorScale",
        "HardAlphaBlend",
        "useTessellation",
        "emissiveMultiplier",
        "globalAnimUV1",
        "globalAnimUV0",
    ];
    let vectors: [[f32; 4]; 6] = [
        [1.0, 0.0, 0.0, 1.0],
        [1.0, 0.0, 0.0, 0.0],
        [0.0; 4],
        [emissive, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0, 0.0],
    ];
    let mut bytes = vec![0u8; 236];
    bytes[1] = 2;
    for (k, vector) in vectors.iter().enumerate() {
        let record = (k + 1) * 16;
        bytes[record] = 1;
        bytes[record + 1] = 0xa5 - k as u8;
        for (axis, value) in vector.iter().enumerate() {
            bytes[112 + k * 16 + axis * 4..][..4].copy_from_slice(&value.to_le_bytes());
        }
    }
    for (k, name) in NAMES.iter().enumerate() {
        bytes[208 + k * 4..][..4].copy_from_slice(&joaat(name).to_le_bytes());
    }
    let block = rg::append_block(g, Segment::System, bytes, Vec::new());
    let start = g.blocks[block].start;
    let mut slots = vec![Slot {
        relative: 8,
        target: address(g, texture),
    }];
    for k in 0..6 {
        slots.push(Slot {
            relative: (k + 1) * 16 + 8,
            target: Address {
                segment: Segment::System,
                offset: start + 112 + k * 16,
            },
        });
    }
    g.blocks[block].slots = slots;
    block
}

/// Блок шейдера `emissive` (`emissive_alpha.sps`, корзина 1) на параметрах `params`.
fn shader_block(g: &mut Graph, params: usize) -> usize {
    let mut bytes = vec![0u8; 0x30];
    bytes[at::SHADER_NAME..][..4].copy_from_slice(&joaat("emissive").to_le_bytes());
    bytes[at::SHADER_COUNT..][..4].copy_from_slice(&[7, 1, 0, 0x80]);
    bytes[0x14..][..4].copy_from_slice(&[0xd0, 0x00, 0x10, 0x01]);
    bytes[at::SHADER_FILE..][..4].copy_from_slice(&joaat("emissive_alpha.sps").to_le_bytes());
    bytes[0x20..][..8].copy_from_slice(&[2, 0xff, 0, 0, 0, 0, 0, 1]);
    rg::append_block(
        g,
        Segment::System,
        bytes,
        vec![Slot {
            relative: at::SHADER_PARAMS,
            target: address(g, params),
        }],
    )
}

/// Объект листа DXT5: служебные поля, имя и пиксели (пиксели — в графической области).
fn texture_object(g: &mut Graph, sheet: &Sheet) -> usize {
    let side = u32::from(sheet.width.max(sheet.height));
    let mut usage = 0x2000_b034u32;
    if side >= 512 {
        usage |= 0x2_0000;
    }
    if side >= 1024 {
        usage |= 0x8_0000;
    }
    let mut name = sheet.name.as_bytes().to_vec();
    name.push(0);
    let name = rg::append_block(g, Segment::System, name, Vec::new());
    let pixels = rg::append_block(g, Segment::Graphics, sheet.payload.clone(), Vec::new());
    let mut bytes = vec![0u8; 0x90];
    bytes[..8].copy_from_slice(&(u64::from(VFT_TEXTURE) | 1 << 32).to_le_bytes());
    bytes[0x30..][..2].copy_from_slice(&le16(1));
    bytes[0x32..][..2].copy_from_slice(&le16(0x80));
    bytes[0x40..][..4].copy_from_slice(&usage.to_le_bytes());
    bytes[0x50..][..2].copy_from_slice(&le16(sheet.width));
    bytes[0x52..][..2].copy_from_slice(&le16(sheet.height));
    bytes[0x54..][..2].copy_from_slice(&le16(1));
    let top = (usize::from(sheet.width).div_ceil(4).max(1))
        * (usize::from(sheet.height).div_ceil(4).max(1))
        * 16;
    bytes[0x56..][..2].copy_from_slice(&le16((top / usize::from(sheet.height)) as u16));
    bytes[0x58..][..4].copy_from_slice(&FORMAT_DXT5.to_le_bytes());
    bytes[0x5d] = sheet.levels;
    let slots = vec![
        Slot {
            relative: at::TEXTURE_NAME,
            target: address(g, name),
        },
        Slot {
            relative: at::TEXTURE_DATA,
            target: address(g, pixels),
        },
    ];
    rg::append_block(g, Segment::System, bytes, slots)
}

// ---------------------------------------------------------------------------------------------------------------
// Правка одной рисовалки
// ---------------------------------------------------------------------------------------------------------------

struct LodReport {
    before: usize,
    after: usize,
    glow: usize,
    marker: usize,
}

struct DrawReport {
    marker: bool,
    glow: bool,
    lods: Vec<LodReport>,
    shaders_before: usize,
    shaders_after: usize,
    marker_shader: Option<usize>,
    glow_shader: Option<usize>,
}

/// Листы во встроенный словарь группы (есть — дополняем, нет — заводим), шейдеры — в конец списка.
/// Возвращает номера шейдеров метки и свечения.
fn add_sheets(
    g: &mut Graph,
    group: usize,
    hash: u32,
    marker: Option<&Marker>,
    glow: Option<&Glow>,
) -> Result<(Option<usize>, Option<usize>)> {
    let existing = dictionary_textures(g, group);
    let mut entries: Vec<(u32, usize)> = existing
        .iter()
        .map(|(object, name)| (joaat(name), *object))
        .collect();
    let mut objects = Vec::new();
    for sheet in [marker.map(|m| &m.sheet), glow.map(|v| &v.sheet)]
        .into_iter()
        .flatten()
    {
        if existing
            .iter()
            .any(|(_, name)| name.eq_ignore_ascii_case(sheet.name))
        {
            return refuse(format!(
                "В drawable {hash} уже есть лист {}: файл уже правили.",
                sheet.name
            ));
        }
        let object = texture_object(g, sheet);
        entries.push((joaat(sheet.name), object));
        objects.push(object);
    }
    entries.sort_by_key(|(key, _)| *key);

    let hashes: Vec<u8> = entries
        .iter()
        .flat_map(|(key, _)| key.to_le_bytes())
        .collect();
    let hashes = rg::append_block(g, Segment::System, hashes, Vec::new());
    let list = pointer_block(
        g,
        &entries
            .iter()
            .map(|(_, object)| *object)
            .collect::<Vec<_>>(),
    );
    let count = entries.len() as u16;
    let dictionary = match link(g, group, at::GROUP_DICTIONARY) {
        Some(dictionary) => dictionary,
        None => {
            let mut root = vec![0u8; 0x40];
            root[..8].copy_from_slice(&(u64::from(VFT_DICTIONARY) | 1 << 32).to_le_bytes());
            root[0x18] = 1;
            let root = rg::append_block(g, Segment::System, root, Vec::new());
            point(g, group, at::GROUP_DICTIONARY, root);
            root
        }
    };
    point(g, dictionary, at::DICT_HASHES, hashes);
    point(g, dictionary, at::DICT_DRAWABLES, list);
    for relative in [
        at::DICT_HASH_COUNT,
        at::DICT_HASH_COUNT + 2,
        at::DICT_DRAWABLE_COUNT,
        at::DICT_DRAWABLE_COUNT + 2,
    ] {
        put(g, dictionary, relative, &le16(count))?;
    }

    // Шейдеры: сначала метки, потом свечения.
    let mut shaders = group_shaders(g, group);
    let mut found = (None, None);
    let mut objects = objects.into_iter();
    for (is_marker, emissive) in [
        (true, marker.map(|m| m.emissive)),
        (false, glow.map(|v| v.emissive)),
    ] {
        let Some(emissive) = emissive else { continue };
        let texture = objects.next().expect("лист на каждый шейдер");
        let params = params_block(g, texture, emissive);
        let shader = shader_block(g, params);
        if is_marker {
            found.0 = Some(shaders.len());
        } else {
            found.1 = Some(shaders.len());
        }
        shaders.push(shader);
    }
    let list = pointer_block(g, &shaders);
    point(g, group, at::GROUP_SHADERS, list);
    put(g, group, at::GROUP_COUNT, &le16(shaders.len() as u16))?;
    put(g, group, at::GROUP_CAPACITY, &le16(shaders.len() as u16))?;
    // Служебный байт группы, который хост пишет у каждой собранной рисовалки (у штатных файлов он зависит от числа шейдеров).
    put(g, group, at::GROUP_SERVICE, &[4])?;
    Ok(found)
}

/// Копия геометрии, раздутая вдоль нормалей: те же индексы, развёртка, веса, номера костей и палитра.
fn shell_of(
    g: &mut Graph,
    source: &Geometry,
    model: &Model,
    inflate: f32,
    shader: u16,
    place: &str,
) -> Result<NewGeometry> {
    let vertex_bytes = source.vertex_bytes(g).map(<[u8]>::to_vec);
    let (Some(info), Some(indices), Some(_)) =
        (source.declaration, source.indices.as_ref(), source.stream)
    else {
        return refuse(format!(
            "Свечение: у геометрии нет буферов вершин или индексов ({place})."
        ));
    };
    if info.flags & 1 == 0 || info.type_of(0) != vertex::FLOAT3 {
        return refuse(format!("Свечение: позиции вершин не float3 ({place})."));
    }
    if info.flags & (1 << 3) == 0 || info.type_of(3) != vertex::FLOAT3 {
        return refuse(format!(
            "Свечение: у геометрии нет нормалей float3 — сдвигать вершины не по чему ({place})."
        ));
    }
    if info.flags & (1 << 6) == 0 || info.type_of(6) != vertex::FLOAT2 {
        return refuse(format!(
            "Свечение: у геометрии нет развёртки float2 ({place})."
        ));
    }
    let skinned = model.skin == 1;
    if skinned && !info.carries_skin() {
        return refuse(format!(
            "Свечение: модель скинована, а у геометрии нет весов и костей ({place})."
        ));
    }
    let count = source.vertices;
    let stride = info.stride;
    let Some(bytes) = vertex_bytes.filter(|bytes| count >= 1 && bytes.len() >= count * stride)
    else {
        return refuse(format!(
            "Свечение: буфер вершин короче заявленного ({place})."
        ));
    };
    let layout = info.layout();
    let [position_at, normal_at, uv_at] = [vertex::POSITION, vertex::NORMAL, vertex::UV0]
        .map(|s| layout.get(s).map_or(0, |e| e.offset));
    let (weights_at, indices_at) = (
        layout.get(vertex::BLEND_WEIGHTS).map_or(0, |e| e.offset),
        layout.get(vertex::BLEND_INDICES).map_or(0, |e| e.offset),
    );
    let read =
        |at: usize| f32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let mut positions = vec![0f32; count * 3];
    let mut normals = vec![0f32; count * 3];
    let mut uvs = vec![0f32; count * 2];
    let mut weights = skinned.then(|| vec![0u8; count * 4]);
    let mut bones = skinned.then(|| vec![0u8; count * 4]);
    for vertex in 0..count {
        let row = vertex * stride;
        let (nx, ny, nz) = (
            read(row + normal_at),
            read(row + normal_at + 4),
            read(row + normal_at + 8),
        );
        let length = (nx * nx + ny * ny + nz * nz).sqrt();
        let scale = if length > 1e-6 { inflate / length } else { 0.0 };
        positions[vertex * 3] = read(row + position_at) + nx * scale;
        positions[vertex * 3 + 1] = read(row + position_at + 4) + ny * scale;
        positions[vertex * 3 + 2] = read(row + position_at + 8) + nz * scale;
        normals[vertex * 3..][..3].copy_from_slice(&[nx, ny, nz]);
        uvs[vertex * 2] = read(row + uv_at);
        uvs[vertex * 2 + 1] = read(row + uv_at + 4);
        if let (Some(weights), Some(bones)) = (weights.as_mut(), bones.as_mut()) {
            weights[vertex * 4..][..4].copy_from_slice(&bytes[row + weights_at..][..4]);
            bones[vertex * 4..][..4].copy_from_slice(&bytes[row + indices_at..][..4]);
        }
    }
    let palette = (!source.palette.is_empty()).then_some(source.palette.as_slice());
    let index_data = twin_indices(g, source, indices);
    build_geometry(
        g,
        &Mesh {
            positions: &positions,
            normals: &normals,
            uvs: &uvs,
            weights: weights.as_deref(),
            bones: bones.as_deref(),
            indices,
            index_data,
            palette,
            shader,
        },
    )
}

/// Индексы оболочки — те же, что у исходной геометрии. Копия кладётся вплотную к оригиналу в одном блоке (исходный
/// буфер индексов указывает на первую половину, новый — на вторую): тело файла сжимается окном в 32 КиБ, и совпадение
/// двух одинаковых кусков рядом даёт вдвое меньше байт, чем те же куски в разных местах файла.
fn twin_indices(g: &mut Graph, source: &Geometry, indices: &[u16]) -> Option<Address> {
    let buffer = link(g, source.block, at::GEOMETRY_INDICES)?;
    let bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let half = bytes.len().next_multiple_of(16);
    let mut both = bytes.clone();
    both.resize(half, 0);
    both.extend_from_slice(&bytes);
    let block = rg::append_block(g, Segment::System, both, Vec::new());
    let start = address(g, block);
    rg::retarget(g, buffer, at::INDEX_DATA, start).ok()?;
    Some(Address {
        segment: start.segment,
        offset: start.offset + half,
    })
}

/// Метка: скинована на корневую кость (вес 255 на слот корня в палитре соседней скинованной геометрии).
fn marker_of(
    g: &mut Graph,
    marker: &Marker,
    model: &Model,
    shader: u16,
    hash: u32,
    lod: usize,
) -> Result<NewGeometry> {
    let template = model
        .geometries
        .iter()
        .map(|&block| Geometry::read(g, block))
        .find(|geometry| geometry.declaration.is_some_and(|d| d.carries_skin()));
    let Some(template) = template else {
        return refuse(format!("Метка: в модели drawable {hash} ({}) нет скинованной геометрии для образца палитры костей.", LOD_NAMES[lod]));
    };
    let (mut palette, mut slot) = (None, 0usize);
    if !template.palette.is_empty() {
        match template.palette.iter().position(|&bone| bone == 0) {
            Some(found) => {
                palette = Some(template.palette.clone());
                slot = found;
            }
            None => palette = Some(vec![0]),
        }
    }
    let count = marker.positions.len() / 3;
    let mut weights = vec![0u8; count * 4];
    let mut bones = vec![0u8; count * 4];
    for vertex in 0..count {
        weights[vertex * 4 + 2] = 255;
        bones[vertex * 4 + 2] = slot as u8;
    }
    build_geometry(
        g,
        &Mesh {
            positions: &marker.positions,
            normals: &marker.normals,
            uvs: &marker.uvs,
            weights: Some(&weights),
            bones: Some(&bones),
            indices: &marker.indices,
            index_data: None,
            palette: palette.as_deref(),
            shader,
        },
    )
}

/// Новые геометрии — в конец модели: списки, карта шейдеров, рамки и счётчики собираются заново.
fn append_to_model(g: &mut Graph, model: &Model, added: &[NewGeometry]) -> Result<()> {
    let old = model.geometries.len();
    let total = old + added.len();
    let mut targets: Vec<usize> = model.geometries.clone();
    targets.extend(added.iter().map(|n| n.block));
    let list = pointer_block(g, &targets);

    let mapping: Vec<u16> = (0..old)
        .map(|k| model.shader_of(k))
        .chain(added.iter().map(|n| n.shader))
        .collect();
    let mapping_block = rg::append_block(
        g,
        Segment::System,
        mapping.iter().flat_map(|w| w.to_le_bytes()).collect(),
        Vec::new(),
    );

    let boxes: Vec<[f32; 8]> = (0..old)
        .map(|k| model.box_of(k))
        .chain(added.iter().map(|n| n.aabb))
        .collect();
    let (mut low, mut high): ([f32; 4], [f32; 4]) = if old > 1 && !model.boxes.is_empty() {
        (
            model.boxes[0][..4].try_into().expect("четыре числа"),
            model.boxes[0][4..].try_into().expect("четыре числа"),
        )
    } else {
        (
            boxes[0][..4].try_into().expect("четыре числа"),
            boxes[0][4..].try_into().expect("четыре числа"),
        )
    };
    for each in &boxes {
        for axis in 0..4 {
            low[axis] = less(low[axis], each[axis]);
            high[axis] = greater(high[axis], each[4 + axis]);
        }
    }
    let record = |min: &[f32], max: &[f32]| -> Vec<u8> {
        min.iter()
            .chain(max)
            .flat_map(|v| v.to_le_bytes())
            .collect()
    };
    let mut bounds = Vec::new();
    if total > 1 {
        bounds.extend(record(&low, &high));
    }
    for each in &boxes {
        bounds.extend(record(&each[..4], &each[4..]));
    }
    if total == 1 {
        bounds.truncate(32);
    }
    let bounds_block = rg::append_block(g, Segment::System, bounds, Vec::new());

    point(g, model.block, at::MODEL_GEOMETRIES, list);
    point(g, model.block, at::MODEL_MAPPING, mapping_block);
    point(g, model.block, at::MODEL_BOUNDS, bounds_block);
    for relative in [at::MODEL_COUNT, at::MODEL_COUNT + 2, 0x2e] {
        put(g, model.block, relative, &le16(total as u16))?;
    }
    let mask = u8_at(g, model.block, at::MODEL_MASK) | ALPHA_BUCKET_BIT;
    put(g, model.block, at::MODEL_MASK, &[mask])
}

/// Правит одну рисовалку: шейдеры и листы, геометрии по уровням, рамки и слово `+0x9a`.
fn patch_drawable(
    g: &mut Graph,
    drawable: usize,
    hash: u32,
    marker: Option<&Marker>,
    glow: Option<&Glow>,
) -> Result<DrawReport> {
    let Some(group) = link(g, drawable, at::DRAW_GROUP) else {
        return refuse(format!(
            "У drawable {hash} нет группы шейдеров: шейдеру метки некуда встать."
        ));
    };
    if link(g, group, at::GROUP_SHADERS).is_none() {
        return refuse(format!("У drawable {hash} нет списка шейдеров."));
    }
    if (0..4).all(|lod| link(g, drawable, at::DRAW_LODS + lod * 8).is_none()) {
        return refuse(format!("У drawable {hash} нет моделей."));
    }
    let shaders_before = group_shaders(g, group).len();
    let bounds_before = frame_of(g, drawable);
    let (marker_shader, glow_shader) = add_sheets(g, group, hash, marker, glow)?;
    let shaders_after = group_shaders(g, group).len();

    let mut touched: Vec<[f32; 8]> = Vec::new();
    let mut lods = Vec::new();
    let mut any = false;
    for lod in 0..4 {
        let models = level_models(g, drawable, lod);
        let before = models.iter().map(|m| m.geometries.len()).sum::<usize>();
        let flags_before = lod_flags(g, drawable, lod);
        let mut report = LodReport {
            before,
            after: before,
            glow: 0,
            marker: 0,
        };
        if before == 0 {
            lods.push(report);
            continue;
        }
        any = true;
        let place = format!("drawable {hash}, уровень {}", LOD_NAMES[lod]);
        let mut plan: Vec<Vec<NewGeometry>> = Vec::new();
        for model in &models {
            let mut add = Vec::new();
            if let Some(glow) = glow {
                for &block in &model.geometries {
                    let source = Geometry::read(g, block);
                    add.push(shell_of(
                        g,
                        &source,
                        model,
                        glow.inflate,
                        glow_shader.unwrap_or(0) as u16,
                        &place,
                    )?);
                    report.glow += 1;
                }
            }
            plan.push(add);
        }
        if let Some(marker) = marker {
            let target = models
                .iter()
                .position(|m| m.skin == 1 && !m.geometries.is_empty());
            let Some(target) = target else {
                return refuse(format!("Метка: у drawable {hash} на уровне {} нет скинованной модели — метку не к чему привязать.", LOD_NAMES[lod]));
            };
            let made = marker_of(
                g,
                marker,
                &models[target],
                marker_shader.unwrap_or(0) as u16,
                hash,
                lod,
            )?;
            plan[target].push(made);
            report.marker += 1;
        }
        for (model, add) in models.iter().zip(&plan) {
            if add.is_empty() {
                continue;
            }
            append_to_model(g, model, add)?;
            touched.extend(add.iter().map(|n| n.aabb));
        }
        // Маски корзин: у шейдера `emissive_alpha` корзина 1 — бит 2 у уровня и у частей.
        let refreshed = level_models(g, drawable, lod);
        let mask = refreshed.iter().fold(0u8, |mask, model| mask | model.mask);
        let flags = ((flags_before & 0xff) as u8 | ALPHA_BUCKET_BIT) as u32 | u32::from(mask) << 8;
        put(g, drawable, at::DRAW_FLAGS + lod * 4, &flags.to_le_bytes())?;
        report.after = refreshed.iter().map(|m| m.geometries.len()).sum();
        lods.push(report);
    }
    if !any {
        return refuse(format!(
            "У drawable {hash} нет ни одного уровня детализации с геометрией."
        ));
    }

    // Рамки рисовалки: коробка — прежняя плюс новые точки, сфера — вокруг коробки и прежней сферы.
    let (mut min, mut max) = (bounds_before.min, bounds_before.max);
    for each in &touched {
        for axis in 0..3 {
            min[axis] = less(min[axis], each[axis]);
            max[axis] = greater(max[axis], each[4 + axis]);
        }
    }
    let centre: [f32; 3] = std::array::from_fn(|axis| (min[axis] + max[axis]) / 2.0);
    let span: [f32; 3] = std::array::from_fn(|axis| max[axis] - min[axis]);
    let mut radius = length3(span) / 2.0;
    let shift: [f32; 3] = std::array::from_fn(|axis| centre[axis] - bounds_before.centre[axis]);
    radius = greater(radius, length3(shift) + bounds_before.radius);
    for (relative, values) in [
        (at::DRAW_MIN, min),
        (at::DRAW_MAX, max),
        (at::DRAW_CENTRE, centre),
    ] {
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        put(g, drawable, relative, &bytes)?;
    }
    put(g, drawable, at::DRAW_RADIUS, &radius.to_le_bytes())?;
    let levels: [Vec<Model>; 4] = std::array::from_fn(|lod| level_models(g, drawable, lod));
    let word = render_word(&levels, g);
    put(g, drawable, at::DRAW_WORD, &le16(word))?;

    Ok(DrawReport {
        marker: marker.is_some(),
        glow: glow.is_some(),
        lods,
        shaders_before,
        shaders_after,
        marker_shader,
        glow_shader,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Чтение заново и сверка
// ---------------------------------------------------------------------------------------------------------------

fn same_shader(a: &ShaderPrint, b: &ShaderPrint) -> bool {
    a == b
}

fn same_drawable(a: &DrawPrint, b: &DrawPrint) -> bool {
    (0..4).all(|lod| {
        let (left, right) = (&a.lods[lod], &b.lods[lod]);
        left.len() == right.len()
            && left.iter().zip(right).all(|(x, y)| {
                x.has_skin == y.has_skin
                    && x.bone_index == y.bone_index
                    && x.render_mask == y.render_mask
                    && x.geometries.len() == y.geometries.len()
                    && x.geometries
                        .iter()
                        .zip(&y.geometries)
                        .all(|(p, q)| p.digest == q.digest && p.shader == q.shader)
            })
    })
}

/// Файл читается заново и сверяется с тем, что было: исходные геометрии, чужие рисовалки, кости, имена и шейдеры.
fn reopen(
    bytes: &[u8],
    hashes: &[u32],
    names: &[Option<String>],
    before: &[DrawPrint],
    reports: &[Option<DrawReport>],
    marker: Option<&Marker>,
    glow: Option<&Glow>,
) -> Result<Semantic> {
    let reread = |error: Error| {
        Refusal(format!(
            "Собранная модель не открывается заново: {}",
            error.message
        ))
    };
    let resource = Resource::parse(bytes).map_err(reread)?;
    let g = rg::scan(&resource).map_err(reread)?;
    let items = read_dictionary(&g).map_err(|_| {
        Refusal("Собранная модель после открытия заново: хэши drawable не те, что были.".into())
    })?;
    if items.iter().map(|i| i.hash).collect::<Vec<_>>() != hashes {
        return refuse("Собранная модель после открытия заново: хэши drawable не те, что были.");
    }
    for (index, item) in items.iter().enumerate() {
        if item.stored != names[index] {
            return refuse(format!(
                "drawable {}: имя в файле изменилось ('{}' → '{}').",
                hashes[index],
                names[index].clone().unwrap_or_default(),
                item.stored.clone().unwrap_or_default()
            ));
        }
    }
    let mut semantic = Semantic {
        drawables: items.len(),
        unchanged: 0,
        changed: Vec::new(),
    };
    let expected = joaat("emissive_alpha.sps");
    for (index, item) in items.iter().enumerate() {
        let hash = hashes[index];
        let was = &before[index];
        let now = print_drawable(&g, item.block);
        let report = reports[index].as_ref();
        if now.bones != was.bones {
            return refuse(format!(
                "drawable {hash}: кости скелета изменились при пересборке."
            ));
        }
        let wanted = report.map_or(was.shaders.len(), |r| {
            was.shaders.len() + (r.shaders_after - r.shaders_before)
        });
        if now.shaders.len() != wanted {
            return refuse(format!(
                "drawable {hash}: число шейдеров не то, что собирали."
            ));
        }
        for (k, old) in was.shaders.iter().enumerate() {
            if !same_shader(old, &now.shaders[k]) {
                return refuse(format!("drawable {hash}: прежний шейдер {k} изменился."));
            }
        }
        for texture in &was.textures {
            if !now.textures.contains(texture) {
                return refuse(format!(
                    "drawable {hash}: прежний встроенный лист {texture} пропал."
                ));
            }
        }
        let Some(report) = report else {
            if !same_drawable(was, &now) {
                return refuse(format!("drawable {hash}: он не в запросе, но изменился."));
            }
            if now.textures.len() != was.textures.len() {
                return refuse(format!(
                    "drawable {hash}: у нетронутого drawable изменился встроенный словарь."
                ));
            }
            if was.frame != now.frame || was.lod_flags != now.lod_flags {
                return refuse(format!(
                    "drawable {hash}: у нетронутого drawable изменились рамки или маски."
                ));
            }
            semantic.unchanged += 1;
            continue;
        };

        let mut rows = Vec::new();
        for lod in 0..4 {
            let lod_report = &report.lods[lod];
            let (old_models, new_models) = (&was.lods[lod], &now.lods[lod]);
            let name = LOD_NAMES[lod];
            if old_models.len() != new_models.len() {
                return refuse(format!(
                    "drawable {hash}, {name}: число частей модели изменилось."
                ));
            }
            let (mut markers, mut glows) = (0usize, 0usize);
            for (old, current) in old_models.iter().zip(new_models) {
                if old.has_skin != current.has_skin || old.bone_index != current.bone_index {
                    return refuse(format!(
                        "drawable {hash}, {name}: привязка части модели к скелету изменилась."
                    ));
                }
                for (k, geometry) in old.geometries.iter().enumerate() {
                    let same = current.geometries.get(k).is_some_and(|c| {
                        c.digest == geometry.digest && c.shader == geometry.shader
                    });
                    if !same {
                        return refuse(format!("drawable {hash}, {name}: исходная геометрия {k} изменилась (вершины, индексы, веса, палитра или шейдер)."));
                    }
                }
                for added in
                    &current.geometries[old.geometries.len().min(current.geometries.len())..]
                {
                    let is_marker = Some(usize::from(added.shader)) == report.marker_shader;
                    let is_glow = Some(usize::from(added.shader)) == report.glow_shader;
                    if !is_marker && !is_glow {
                        return refuse(format!(
                            "drawable {hash}, {name}: новая геометрия смотрит на чужой шейдер {}.",
                            added.shader
                        ));
                    }
                    if current.has_skin == 1 && !added.skinned {
                        return refuse(format!("drawable {hash}, {name}: новая геометрия без весов в скинованной модели."));
                    }
                    if is_marker {
                        markers += 1;
                    } else {
                        glows += 1;
                    }
                }
                if current.render_mask & ALPHA_BUCKET_BIT == 0
                    && current.geometries.len() > old.geometries.len()
                {
                    return refuse(format!(
                        "drawable {hash}, {name}: у части нет бита корзины прозрачности."
                    ));
                }
            }
            if markers != lod_report.marker || glows != lod_report.glow {
                return refuse(format!("drawable {hash}, {name}: после чтения новых геометрий {markers}+{glows}, собирали {}+{}.", lod_report.marker, lod_report.glow));
            }
            let total: usize = new_models.iter().map(|m| m.geometries.len()).sum();
            if total != lod_report.after
                || old_models.iter().map(|m| m.geometries.len()).sum::<usize>() != lod_report.before
            {
                return refuse(format!(
                    "drawable {hash}, {name}: число геометрий после чтения {total}, собирали {}.",
                    lod_report.after
                ));
            }
            if lod_report.marker + lod_report.glow > 0
                && now.lod_flags[lod] & u32::from(ALPHA_BUCKET_BIT) == 0
            {
                return refuse(format!(
                    "drawable {hash}, {name}: в масках уровня нет корзины прозрачности."
                ));
            }
            rows.push(LodRow {
                lod: name,
                models: new_models.len(),
                before: lod_report.before,
                after: total,
                glow: glows,
                marker: markers,
                flags_before: was.lod_flags[lod],
                flags_after: now.lod_flags[lod],
            });
        }

        // Шейдеры: корзина 1, emissive_alpha.sps, лист — свой.
        let group = link(&g, item.block, at::DRAW_GROUP).expect("группа есть");
        let shader_blocks = group_shaders(&g, group);
        let embedded = dictionary_textures(&g, group);
        let mut shader_rows = Vec::new();
        for (index, sheet, emissive) in [
            (
                report.marker_shader,
                marker.map(|m| &m.sheet),
                marker.map_or(0.0, |m| m.emissive),
            ),
            (
                report.glow_shader,
                glow.map(|v| &v.sheet),
                glow.map_or(0.0, |v| v.emissive),
            ),
        ] {
            let (Some(index), Some(sheet)) = (index, sheet) else {
                continue;
            };
            let shader = shader_blocks[index];
            let Some(&(texture, _)) = embedded
                .iter()
                .find(|(_, name)| name.eq_ignore_ascii_case(sheet.name))
            else {
                return refuse(format!(
                    "drawable {hash}: лист {} не нашёлся во встроенном словаре.",
                    sheet.name
                ));
            };
            if u32_at(&g, shader, at::SHADER_FILE) != expected
                || u8_at(&g, shader, at::SHADER_BUCKET) != 1
            {
                return refuse(format!(
                    "drawable {hash}: шейдер {index} — не emissive_alpha.sps в корзине 1."
                ));
            }
            let params = link(&g, shader, at::SHADER_PARAMS);
            let points_at_texture = params.is_some_and(|p| {
                (0..usize::from(u8_at(&g, shader, at::SHADER_COUNT)))
                    .any(|k| u8_at(&g, p, k * 16) == 0 && link(&g, p, k * 16 + 8) == Some(texture))
            });
            if !points_at_texture {
                return refuse(format!(
                    "drawable {hash}: шейдер {index} не смотрит на встроенный лист {}.",
                    sheet.name
                ));
            }
            let (width, height, levels) = (
                u16_at(&g, texture, 0x50),
                u16_at(&g, texture, 0x52),
                u8_at(&g, texture, 0x5d),
            );
            if u32_at(&g, texture, 0x58) != FORMAT_DXT5
                || width != sheet.width
                || height != sheet.height
                || levels != sheet.levels
            {
                return refuse(format!(
                    "drawable {hash}: лист {} после чтения не {}x{} DXT5 с {} уровнями.",
                    sheet.name, sheet.width, sheet.height, sheet.levels
                ));
            }
            shader_rows.push(ShaderRow {
                index,
                texture: sheet.name,
                emissive,
                width,
                height,
                levels,
            });
        }

        // Рамка рисовалки вмещает всё: и прежнюю рамку, и каждую новую точку.
        for axis in 0..3 {
            if now.frame.min[axis] > was.frame.min[axis] + 1e-6
                || now.frame.max[axis] < was.frame.max[axis] - 1e-6
            {
                return refuse(format!("drawable {hash}: рамка сузилась."));
            }
        }
        if let Some(marker) = marker.filter(|m| m.drawable == hash) {
            for axis in 0..3 {
                let (low, high) = marker
                    .positions
                    .iter()
                    .skip(axis)
                    .step_by(3)
                    .fold((f32::MAX, f32::MIN), |(l, h), &v| (l.min(v), h.max(v)));
                if now.frame.min[axis] > low + 1e-5 || now.frame.max[axis] < high - 1e-5 {
                    return refuse(format!("drawable {hash}: рамка не вмещает метку."));
                }
            }
        }
        semantic.changed.push(Changed {
            hash,
            name: reader_name(item),
            marker: report.marker,
            glow: report.glow,
            lods: rows,
            shaders_before: was.shaders.len(),
            shaders_after: now.shaders.len(),
            added: shader_rows,
            textures_before: was.textures.clone(),
            textures_after: now.textures.clone(),
            bounds_before: was.frame,
            bounds_after: now.frame,
            bones: now.bones.len(),
        });
    }
    Ok(semantic)
}

// ---------------------------------------------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------------------------------------------

/// Словарь моделей Legacy: байты ресурса, метка и свечение (любое из двух может не быть, но не оба).
/// Проверки, зависящие от файла, идут в том же порядке, что у хоста.
pub fn patch(model: &[u8], marker: Option<&Marker>, glow: Option<&Glow>) -> Result<Patched> {
    let open = |error: Error| {
        Refusal(format!(
            "Модель не открывается как словарь .ydd Legacy: {}",
            error.message
        ))
    };
    let resource = Resource::parse(model).map_err(open)?;
    let mut graph = rg::scan(&resource).map_err(open)?;
    let items = read_dictionary(&graph)?;
    let hashes: Vec<u32> = items.iter().map(|item| item.hash).collect();
    let known: HashSet<u32> = hashes.iter().copied().collect();
    let listed = || {
        hashes
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    };
    if let Some(marker) = marker.filter(|m| !known.contains(&m.drawable)) {
        return refuse(format!(
            "Метка: в словаре нет drawable {}. Есть: {}.",
            marker.drawable,
            listed()
        ));
    }
    for hash in glow.map(|v| v.drawables.as_slice()).unwrap_or_default() {
        if !known.contains(hash) {
            return refuse(format!(
                "Свечение: в словаре нет drawable {hash}. Есть: {}.",
                listed()
            ));
        }
    }

    let before: Vec<DrawPrint> = items
        .iter()
        .map(|item| print_drawable(&graph, item.block))
        .collect();
    let names: Vec<Option<String>> = items.iter().map(|item| item.stored.clone()).collect();
    let mut reports: Vec<Option<DrawReport>> = Vec::new();
    for item in &items {
        let is_marker = marker.filter(|m| m.drawable == item.hash);
        let is_glow = glow.filter(|v| v.drawables.contains(&item.hash));
        if is_marker.is_none() && is_glow.is_none() {
            reports.push(None);
            continue;
        }
        reports.push(Some(patch_drawable(
            &mut graph, item.block, item.hash, is_marker, is_glow,
        )?));
    }

    let root = Address {
        segment: Segment::System,
        offset: 0,
    };
    let part = rg::subgraph(&graph, root).map_err(from_lib)?;
    let (system, graphics) = (
        rg::identity_order(&part, Segment::System),
        rg::identity_order(&part, Segment::Graphics),
    );
    let bytes = rg::rebuild_with(&part, &system, &graphics, &deflate_body).map_err(from_lib)?;
    let semantic = reopen(&bytes, &hashes, &names, &before, &reports, marker, glow)?;
    Ok(Patched { bytes, semantic })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smooth_normals_of_a_flat_quad_point_along_its_winding() {
        let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
        let normals = smooth_normals(&positions, &[0, 1, 2, 0, 2, 3]);
        for vertex in normals.chunks_exact(3) {
            assert_eq!(vertex, [0.0, 0.0, 1.0]);
        }
        // Вырожденный треугольник: нормаль по умолчанию — вверх.
        let flat = smooth_normals(&[0.0; 9], &[0, 1, 2]);
        assert_eq!(flat, [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn the_reader_names_a_drawable_by_its_padded_hash_unless_the_file_names_it_by_that_hash() {
        let item = |hash: u32, stored: Option<&str>| Slotted {
            block: 0,
            hash,
            stored: stored.map(str::to_owned),
        };
        assert_eq!(
            reader_name(&item(0x0739_fe07, Some("a_c_boar.#dd"))),
            "hash_0739FE07"
        );
        assert_eq!(reader_name(&item(0x976f_bf04, None)), "hash_976FBF04");
        assert_eq!(
            reader_name(&item(joaat("head_000_r"), Some("head_000_r"))),
            "head_000_r"
        );
    }

    #[test]
    fn the_lengths_and_the_word_follow_the_hosts_numbers() {
        // Слово `+0x9a`: сумма по уровням (одна геометрия — 18, дальше по формуле) плюс палитры костей по восемь.
        let word = |geometries: usize| crate::drawable_write::sign_render_word(geometries);
        assert_eq!([word(1), word(2), word(3), word(4)], [18, 33, 46, 58]);
        assert_eq!(length3([3.0, 4.0, 0.0]), 5.0);
        assert_eq!(less(1.0, 2.0), 1.0);
        assert_eq!(greater(1.0, 2.0), 2.0);
    }
}
