//! Вещь педа без привязки к костям получает веса и кости тела игры (команда `skin-from-body`).
//!
//! Правило то же, что у кадра окна (`packages/clothing/body-fit.js`), но над самим `.ydd`:
//!   * какие геометрии: у модели нет флага кожи (поле `+0x29` связки) или в декларации вершины нет весов и костей
//!     (семантики 1 и 2); модель, жёсткая на кости (флага нет, номер кости не корень), стоит как есть;
//!   * откуда веса: ближайшая вершина частей тела (образцов) в позе привязки, её четыре байта весов и четыре байта
//!     костей; номер кости образца — номер в скелете педа (через список костей геометрии, если он есть);
//!   * вершина получает раскладку с весами и костями, остальные семантики остаются теми же байтами, список костей
//!     геометрии снимается, модель помечается скинованной с костью 0.
//!
//! Модуль работает над графом блоков ресурса (`resource_graph`): читает словарь рисовалок, собирает вершины тела и
//! правит буферы вершин на месте; сборка файла и ответ команды — в слое команд. Результат детерминирован: один и
//! тот же вход даёт те же байты.
//!
//! Что хост делает при записи словаря и что повторено здесь (снято с хоста по входам и выходам, `parity/host-port/
//! skin-from-body`): новые байты вершин лежат в системной области; шаг в самой геометрии (`+0x70`), числа индексов,
//! треугольников и вершин геометрии (`+0x58`, `+0x5c`, `+0x60`) и копии числа геометрий в модели (`+0x12`, `+0x2e`)
//! считаются заново у всех геометрий и моделей словаря. Не повторено: имя рисовалки хост переписывает в `hash_<хеш>`,
//! байт `+0x30` группы шейдеров — в 4, а у словарей со скелетом пересчитывает матрицы костей; здесь они остаются как в
//! исходнике (игре они такими и даны).

use std::collections::HashMap;

use crate::{
    error::{Error, Result},
    resource_graph::{self as rg, Address, Graph, Segment, Slot},
    vertex::{BLEND_INDICES, BLEND_WEIGHTS, FLOAT3},
};

/// Сторона клетки поиска ближайшей вершины, как у кадра окна.
pub const CELL: f32 = 0.08;
/// Сколько колец клеток обходится до перебора всех вершин.
pub const MAX_RING: i32 = 12;
/// Биты семантик «веса» и «кости» в флагах декларации.
const SKIN_SEMANTICS: u32 = (1 << BLEND_WEIGHTS) | (1 << BLEND_INDICES);
/// Число семантик в декларации.
const SEMANTICS: usize = 16;

/// Смещения полей в блоках словаря, рисовалки, модели, геометрии и буфера вершин.
mod at {
    pub const DRAWABLES: usize = 0x30;
    pub const DRAWABLE_COUNT: usize = 0x38;
    /// Списки уровней рисовалки: High, Medium, Low, VeryLow.
    pub const LEVELS: [usize; 4] = [0x50, 0x58, 0x60, 0x68];
    pub const LIST_ENTRIES: usize = 0x00;
    pub const LIST_COUNT: usize = 0x08;
    pub const MODEL_GEOMETRIES: usize = 0x08;
    pub const MODEL_COUNT: usize = 0x10;
    pub const MODEL_COUNT_COPY: usize = 0x12;
    pub const MODEL_BINDING: usize = 0x28;
    pub const MODEL_COUNT_SECOND_COPY: usize = 0x2e;
    pub const GEOMETRY_BUFFER: usize = 0x18;
    pub const GEOMETRY_INDEX_BUFFER: usize = 0x38;
    pub const GEOMETRY_INDICES: usize = 0x58;
    pub const GEOMETRY_TRIANGLES: usize = 0x5c;
    pub const GEOMETRY_VERTICES: usize = 0x60;
    pub const GEOMETRY_BONES: usize = 0x68;
    pub const GEOMETRY_STRIDE: usize = 0x70;
    pub const GEOMETRY_BONES_COUNT: usize = 0x72;
    pub const GEOMETRY_DATA: usize = 0x78;
    pub const BUFFER_STRIDE: usize = 0x08;
    pub const BUFFER_DATA: usize = 0x10;
    pub const BUFFER_COUNT: usize = 0x18;
    pub const BUFFER_DATA_ALIAS: usize = 0x20;
    pub const BUFFER_DECLARATION: usize = 0x30;
    pub const INDEX_COUNT: usize = 0x08;
}

/// Размер декларации вершины.
const DECLARATION_BYTES: usize = 16;

const MSG_NO_FLOATS: &str = "Skin model vertices have no float positions.";
const MSG_STILL_BARE: &str = "Skinned model still has geometry without bone weights.";
const MSG_LOST: &str = "Skinned model lost geometries on reopen.";
const MSG_TRUNCATED: &str = "Skin model vertices are cut short.";

/// Итог правки: сколько моделей, геометрий и вершин тронуто и сколько вершин искалось перебором.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    pub models: usize,
    pub geometries: usize,
    pub vertices: usize,
    pub far: usize,
}

// ---------------------------------------------------------------------------------------------
// Чтение графа
// ---------------------------------------------------------------------------------------------

fn half_at(graph: &Graph, block: usize, relative: usize) -> Option<u16> {
    let bytes = graph.content(block).get(relative..relative + 2)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn word_at(graph: &Graph, block: usize, relative: usize) -> Option<u32> {
    let bytes = graph.content(block).get(relative..relative + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// Блок, на который указывает слово по смещению; нет указателя или цель вне блоков — `None`.
fn target(graph: &Graph, block: usize, relative: usize) -> Option<usize> {
    let slot = graph.blocks[block]
        .slots
        .iter()
        .find(|slot| slot.relative == relative)?;
    graph.block_at(slot.target)
}

fn address_of(graph: &Graph, block: usize) -> Address {
    Address {
        segment: graph.blocks[block].segment,
        offset: graph.blocks[block].start,
    }
}

/// Рисовалки словаря по порядку записей; пустая запись пропускается.
fn drawables(graph: &Graph) -> Vec<usize> {
    let Some(root) = graph.root() else {
        return Vec::new();
    };
    let Some(array) = target(graph, root, at::DRAWABLES) else {
        return Vec::new();
    };
    let count = usize::from(half_at(graph, root, at::DRAWABLE_COUNT).unwrap_or(0));
    (0..count)
        .filter_map(|index| target(graph, array, index * 8))
        .collect()
}

/// Есть ли в словаре хоть одна рисовалка.
pub fn has_drawables(graph: &Graph) -> bool {
    let Some(root) = graph.root() else {
        return false;
    };
    target(graph, root, at::DRAWABLES).is_some()
        && half_at(graph, root, at::DRAWABLE_COUNT).unwrap_or(0) > 0
}

/// Модели одного уровня рисовалки по порядку списка; пустая запись пропускается.
fn level_models(graph: &Graph, drawable: usize, level: usize) -> Vec<usize> {
    let Some(head) = target(graph, drawable, at::LEVELS[level]) else {
        return Vec::new();
    };
    let Some(entries) = target(graph, head, at::LIST_ENTRIES) else {
        return Vec::new();
    };
    let count = usize::from(half_at(graph, head, at::LIST_COUNT).unwrap_or(0));
    (0..count)
        .filter_map(|index| target(graph, entries, index * 8))
        .collect()
}

/// Все модели рисовалки: уровни по порядку.
fn all_models(graph: &Graph, drawable: usize) -> Vec<usize> {
    (0..at::LEVELS.len())
        .flat_map(|level| level_models(graph, drawable, level))
        .collect()
}

/// Геометрии модели по номерам записей; пустая запись — `None`. Без списка геометрий — `None`.
fn geometries(graph: &Graph, model: usize) -> Option<Vec<Option<usize>>> {
    let array = target(graph, model, at::MODEL_GEOMETRIES)?;
    let count = usize::from(half_at(graph, model, at::MODEL_COUNT).unwrap_or(0));
    Some(
        (0..count)
            .map(|index| target(graph, array, index * 8))
            .collect(),
    )
}

/// Флаг кожи модели (байт `+0x29`) и номер кости (байт `+0x2b`).
fn binding(graph: &Graph, model: usize) -> (u8, u8) {
    let word = word_at(graph, model, at::MODEL_BINDING).unwrap_or(0);
    ((word >> 8) as u8, (word >> 24) as u8)
}

/// Жёсткая деталь на кости: так устроены пряжки и подвески игры, они идут за своей костью, это не брак.
fn rigid_on_bone(graph: &Graph, model: usize) -> bool {
    let (skin, bone) = binding(graph, model);
    skin == 0 && bone != 0
}

/// Декларация вершины: флаги семантик, шаг, байт `+6`, коды типов по семантикам.
#[derive(Debug, Clone, Copy)]
struct Declaration {
    flags: u32,
    stride: usize,
    spare: u8,
    types: u64,
}

impl Declaration {
    fn read(graph: &Graph, block: usize) -> Option<Self> {
        let bytes = graph.content(block).get(..DECLARATION_BYTES)?;
        Some(Declaration {
            flags: u32::from_le_bytes(bytes[0..4].try_into().ok()?),
            stride: usize::from(u16::from_le_bytes(bytes[4..6].try_into().ok()?)),
            spare: bytes[6],
            types: u64::from_le_bytes(bytes[8..16].try_into().ok()?),
        })
    }

    fn type_of(&self, semantic: usize) -> u8 {
        (self.types >> (semantic * 4) & 0xf) as u8
    }

    fn has(&self, semantic: usize) -> bool {
        self.flags >> semantic & 1 != 0
    }

    /// Смещение семантики: сумма размеров тех, что стоят раньше.
    fn offset_of(&self, semantic: usize) -> usize {
        (0..semantic)
            .filter(|&k| self.has(k))
            .map(|k| size_of_type(self.type_of(k)))
            .sum()
    }

    fn carries_skin(&self) -> bool {
        self.flags & SKIN_SEMANTICS == SKIN_SEMANTICS
    }

    fn to_bytes(self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(DECLARATION_BYTES);
        bytes.extend(self.flags.to_le_bytes());
        bytes.extend((self.stride as u16).to_le_bytes());
        bytes.push(self.spare);
        bytes.push(self.flags.count_ones() as u8);
        bytes.extend(self.types.to_le_bytes());
        bytes
    }
}

/// Размер компонента вершины в байтах по коду типа; неизвестный код — 0.
fn size_of_type(code: u8) -> usize {
    match code {
        1 | 2 | 8 | 9 | 10 => 4,
        3 | 5 => 8,
        6 => 12,
        7 => 16,
        _ => 0,
    }
}

/// Буфер вершин геометрии: где он лежит, что говорит декларация и откуда читать байты.
struct Buffer {
    block: usize,
    declaration: Option<Declaration>,
    data: Option<usize>,
    stride: usize,
    count: usize,
}

impl Buffer {
    fn of(graph: &Graph, geometry: usize) -> Option<Buffer> {
        let block = target(graph, geometry, at::GEOMETRY_BUFFER)?;
        Some(Buffer {
            block,
            declaration: target(graph, block, at::BUFFER_DECLARATION)
                .and_then(|found| Declaration::read(graph, found)),
            data: target(graph, block, at::BUFFER_DATA),
            stride: usize::from(half_at(graph, block, at::BUFFER_STRIDE).unwrap_or(0)),
            count: word_at(graph, block, at::BUFFER_COUNT).unwrap_or(0) as usize,
        })
    }

    /// Шаг вершины: из буфера, а если там ноль — из декларации.
    fn row(&self, declaration: &Declaration) -> usize {
        if self.stride > 0 {
            self.stride
        } else {
            declaration.stride
        }
    }
}

fn carries_skin(graph: &Graph, geometry: usize) -> bool {
    Buffer::of(graph, geometry)
        .and_then(|buffer| buffer.declaration)
        .is_some_and(|declaration| declaration.carries_skin())
}

/// Байты вершин: `count` строк по `row` байт от начала блока данных.
fn vertex_bytes(graph: &Graph, data: usize, row: usize, count: usize) -> Result<&[u8]> {
    let wanted = row
        .checked_mul(count)
        .ok_or_else(|| Error::broken(MSG_TRUNCATED))?;
    let block = &graph.blocks[data];
    graph
        .bytes(block.segment)
        .get(block.start..)
        .and_then(|rest| rest.get(..wanted))
        .ok_or_else(|| Error::broken(MSG_TRUNCATED))
}

/// Список костей геометрии; пустой, если указателя или счётчика нет.
fn bone_ids(graph: &Graph, geometry: usize) -> Result<Vec<u16>> {
    let Some(list) = target(graph, geometry, at::GEOMETRY_BONES) else {
        return Ok(Vec::new());
    };
    let count = usize::from(half_at(graph, geometry, at::GEOMETRY_BONES_COUNT).unwrap_or(0));
    let block = &graph.blocks[list];
    let bytes = graph
        .bytes(block.segment)
        .get(block.start..)
        .and_then(|rest| rest.get(..count * 2))
        .ok_or_else(|| Error::broken(MSG_TRUNCATED))?;
    Ok(bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect())
}

fn float_at(bytes: &[u8], at: usize) -> Result<f32> {
    let word = bytes
        .get(at..at + 4)
        .ok_or_else(|| Error::broken(MSG_TRUNCATED))?;
    Ok(f32::from_le_bytes([word[0], word[1], word[2], word[3]]))
}

/// Приведение числа с плавающей точкой к целому, как оно идёт в хосте: вне диапазона и `NaN` дают минимум.
fn cast_int(value: f32) -> i32 {
    if value.is_nan() || value >= 2_147_483_648.0 || value < -2_147_483_648.0 {
        i32::MIN
    } else {
        value as i32
    }
}

fn cell_of(point: [f32; 3]) -> (i32, i32, i32) {
    let cell = |value: f32| cast_int((value / CELL).floor());
    (cell(point[0]), cell(point[1]), cell(point[2]))
}

/// Квадрат расстояния: те же вычитания и сложения в том же порядке.
fn distance_squared(a: [f32; 3], b: [f32; 3]) -> f32 {
    let x = a[0] - b[0];
    let y = a[1] - b[1];
    let z = a[2] - b[2];
    x * x + y * y + z * z
}

// ---------------------------------------------------------------------------------------------
// Вершины тела
// ---------------------------------------------------------------------------------------------

/// Вершины тела: позиции, по четыре байта весов и костей, клетки поиска.
#[derive(Debug, Default)]
pub struct BodyVertices {
    positions: Vec<[f32; 3]>,
    weights: Vec<u8>,
    bones: Vec<u8>,
    cells: HashMap<(i32, i32, i32), Vec<u32>>,
    types: Option<(u8, u8)>,
}

impl BodyVertices {
    pub fn new() -> Self {
        Self::default()
    }

    /// Сколько вершин собрано.
    pub fn len(&self) -> usize {
        self.positions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    /// Коды типов весов и костей, которые взяла первая подходящая геометрия образца.
    pub fn types(&self) -> Option<(u8, u8)> {
        self.types
    }

    pub fn weights_of(&self, index: usize) -> [u8; 4] {
        self.weights[index * 4..index * 4 + 4]
            .try_into()
            .expect("четыре байта")
    }

    pub fn bones_of(&self, index: usize) -> [u8; 4] {
        self.bones[index * 4..index * 4 + 4]
            .try_into()
            .expect("четыре байта")
    }

    /// Собирает вершины частей тела из словаря `graph`: только модели High с кожей.
    pub fn add(&mut self, graph: &Graph) -> Result<()> {
        for drawable in drawables(graph) {
            for model in level_models(graph, drawable, 0) {
                if binding(graph, model).0 != 1 {
                    continue;
                }
                for geometry in geometries(graph, model)
                    .unwrap_or_default()
                    .into_iter()
                    .flatten()
                {
                    self.add_geometry(graph, geometry)?;
                }
            }
        }
        Ok(())
    }

    fn add_geometry(&mut self, graph: &Graph, geometry: usize) -> Result<()> {
        let Some(buffer) = Buffer::of(graph, geometry) else {
            return Ok(());
        };
        let (Some(info), Some(data)) = (buffer.declaration, buffer.data) else {
            return Ok(());
        };
        if !info.carries_skin() || info.type_of(0) != FLOAT3 {
            return Ok(());
        }
        let (weights_type, bones_type) = (info.type_of(BLEND_WEIGHTS), info.type_of(BLEND_INDICES));
        if size_of_type(weights_type) != 4 || size_of_type(bones_type) != 4 {
            return Ok(());
        }
        match self.types {
            None => self.types = Some((weights_type, bones_type)),
            Some(known) if known != (weights_type, bones_type) => return Ok(()),
            Some(_) => {}
        }
        let row = buffer.row(&info);
        let bytes = vertex_bytes(graph, data, row, buffer.count)?;
        let (position_at, weights_at, bones_at) = (
            info.offset_of(0),
            info.offset_of(BLEND_WEIGHTS),
            info.offset_of(BLEND_INDICES),
        );
        let ids = bone_ids(graph, geometry)?;
        for vertex in 0..buffer.count {
            let base = vertex * row;
            let position = [
                float_at(bytes, base + position_at)?,
                float_at(bytes, base + position_at + 4)?,
                float_at(bytes, base + position_at + 8)?,
            ];
            let mut mapped = [0u8; 4];
            let mut usable = true;
            for (slot, out) in mapped.iter_mut().enumerate() {
                let raw = usize::from(
                    *bytes
                        .get(base + bones_at + slot)
                        .ok_or_else(|| Error::broken(MSG_TRUNCATED))?,
                );
                let bone: i32 = if ids.is_empty() {
                    raw as i32
                } else {
                    ids.get(raw).map_or(-1, |&id| i32::from(id))
                };
                match u8::try_from(bone) {
                    Ok(byte) => *out = byte,
                    Err(_) => usable = false,
                }
            }
            if !usable {
                continue;
            }
            let index = self.positions.len() as u32;
            self.positions.push(position);
            self.weights.extend(
                bytes
                    .get(base + weights_at..base + weights_at + 4)
                    .ok_or_else(|| Error::broken(MSG_TRUNCATED))?,
            );
            self.bones.extend(mapped);
            self.cells.entry(cell_of(position)).or_default().push(index);
        }
        Ok(())
    }

    /// Ближайшая вершина тела и признак «искали перебором, а не кольцами клеток»; `None`, если ближайшей нет.
    pub fn nearest(&self, point: [f32; 3]) -> Option<(usize, bool)> {
        let (cx, cy, cz) = cell_of(point);
        let mut best: Option<usize> = None;
        let mut best_distance = f32::INFINITY;
        let consider =
            |cell: (i32, i32, i32), best: &mut Option<usize>, best_distance: &mut f32| {
                if let Some(list) = self.cells.get(&cell) {
                    for &index in list {
                        let distance = distance_squared(self.positions[index as usize], point);
                        if distance < *best_distance {
                            *best_distance = distance;
                            *best = Some(index as usize);
                        }
                    }
                }
            };
        for ring in 0..=MAX_RING {
            // Кольцо — клетки, у которых наибольшее из смещений по осям равно кольцу; порядок x, y, z, как у кадра.
            for dx in -ring..=ring {
                for dy in -ring..=ring {
                    if dx.abs() == ring || dy.abs() == ring {
                        for dz in -ring..=ring {
                            consider(
                                (
                                    cx.wrapping_add(dx),
                                    cy.wrapping_add(dy),
                                    cz.wrapping_add(dz),
                                ),
                                &mut best,
                                &mut best_distance,
                            );
                        }
                    } else if ring > 0 {
                        for dz in [-ring, ring] {
                            consider(
                                (
                                    cx.wrapping_add(dx),
                                    cy.wrapping_add(dy),
                                    cz.wrapping_add(dz),
                                ),
                                &mut best,
                                &mut best_distance,
                            );
                        }
                    }
                }
            }
            let reach = ring as f32 * CELL;
            if best.is_some() && best_distance <= reach * reach {
                return best.map(|index| (index, false));
            }
        }
        if let Some(index) = best {
            return Some((index, false));
        }
        let mut best_distance = f32::INFINITY;
        for (index, &position) in self.positions.iter().enumerate() {
            let distance = distance_squared(position, point);
            if distance < best_distance {
                best_distance = distance;
                best = Some(index);
            }
        }
        best.map(|index| (index, true))
    }
}

// ---------------------------------------------------------------------------------------------
// Правка модели
// ---------------------------------------------------------------------------------------------

/// Новые вершины одной геометрии: декларация, байты, число перебранных вершин.
struct Edit {
    buffer: usize,
    geometry: usize,
    declaration: Declaration,
    data: Vec<u8>,
    far: usize,
    count: usize,
}

/// Новая раскладка геометрии с весами тела; чтение только, граф не меняется.
fn plan_geometry(graph: &Graph, geometry: usize, body: &BodyVertices) -> Result<Edit> {
    let buffer = Buffer::of(graph, geometry).expect("геометрия с буфером");
    let old = buffer.declaration.expect("декларация проверена");
    let data = buffer.data.expect("данные проверены");
    if old.type_of(0) != FLOAT3 {
        return Err(Error::broken(MSG_NO_FLOATS));
    }
    let (weights_type, bones_type) = body.types().ok_or_else(|| Error::broken(MSG_NO_FLOATS))?;
    let mut types = old.types;
    types &= !(0xffu64 << 4);
    types |= u64::from(weights_type) << 4 | u64::from(bones_type) << 8;
    let mut info = Declaration {
        flags: old.flags | SKIN_SEMANTICS,
        stride: 0,
        spare: old.spare,
        types,
    };
    info.stride = (0..SEMANTICS)
        .filter(|&k| info.has(k))
        .map(|k| size_of_type(info.type_of(k)))
        .sum();

    let count = buffer.count;
    let old_row = buffer.row(&old);
    let row = info.stride;
    let source = vertex_bytes(graph, data, old_row, count)?;
    let mut target_bytes = vec![0u8; count * row];
    let (weights_at, bones_at) = (info.offset_of(BLEND_WEIGHTS), info.offset_of(BLEND_INDICES));
    let position_at = old.offset_of(0);
    let kept: Vec<(usize, usize, usize)> = (0..SEMANTICS)
        .filter(|&semantic| {
            old.has(semantic) && semantic != BLEND_WEIGHTS && semantic != BLEND_INDICES
        })
        .map(|semantic| {
            (
                old.offset_of(semantic),
                info.offset_of(semantic),
                size_of_type(old.type_of(semantic)),
            )
        })
        .collect();
    let mut far = 0;
    for vertex in 0..count {
        for &(from, to, size) in &kept {
            let part = source
                .get(vertex * old_row + from..vertex * old_row + from + size)
                .ok_or_else(|| Error::broken(MSG_TRUNCATED))?;
            target_bytes[vertex * row + to..vertex * row + to + size].copy_from_slice(part);
        }
        let base = vertex * old_row + position_at;
        let position = [
            float_at(source, base)?,
            float_at(source, base + 4)?,
            float_at(source, base + 8)?,
        ];
        let (near, searched) = body
            .nearest(position)
            .ok_or_else(|| Error::broken(MSG_NO_FLOATS))?;
        if searched {
            far += 1;
        }
        target_bytes[vertex * row + weights_at..][..4].copy_from_slice(&body.weights_of(near));
        target_bytes[vertex * row + bones_at..][..4].copy_from_slice(&body.bones_of(near));
    }
    Ok(Edit {
        buffer: buffer.block,
        geometry,
        declaration: info,
        data: target_bytes,
        far,
        count,
    })
}

/// Ставит указатель по смещению: слот меняется или добавляется на своё место в порядке смещений.
fn set_pointer(graph: &mut Graph, block: usize, relative: usize, to: Address) {
    let slots = &mut graph.blocks[block].slots;
    match slots.iter_mut().find(|slot| slot.relative == relative) {
        Some(slot) => slot.target = to,
        None => {
            let place = slots.partition_point(|slot| slot.relative < relative);
            slots.insert(
                place,
                Slot {
                    relative,
                    target: to,
                },
            );
        }
    }
}

/// Снимает указатель по смещению вместе с его словом.
fn clear_pointer(graph: &mut Graph, block: usize, relative: usize) -> Result<()> {
    graph.blocks[block]
        .slots
        .retain(|slot| slot.relative != relative);
    rg::write_at(graph, block, relative, &[0u8; 8])?;
    Ok(())
}

/// Кладёт новые вершины в граф: данные (в системной области, как их пишет хост), декларация, указатели геометрии и буфера.
fn apply(graph: &mut Graph, edit: Edit) -> Result<()> {
    let data = rg::append_block(graph, Segment::System, edit.data, Vec::new());
    let data_at = address_of(graph, data);
    let declaration = rg::append_block(
        graph,
        Segment::System,
        edit.declaration.to_bytes(),
        Vec::new(),
    );
    let declaration_at = address_of(graph, declaration);

    set_pointer(graph, edit.buffer, at::BUFFER_DATA, data_at);
    set_pointer(graph, edit.buffer, at::BUFFER_DATA_ALIAS, data_at);
    set_pointer(graph, edit.buffer, at::BUFFER_DECLARATION, declaration_at);
    rg::write_at(
        graph,
        edit.buffer,
        at::BUFFER_STRIDE,
        &(edit.declaration.stride as u16).to_le_bytes(),
    )?;
    set_pointer(graph, edit.geometry, at::GEOMETRY_DATA, data_at);
    rg::write_at(
        graph,
        edit.geometry,
        at::GEOMETRY_STRIDE,
        &(edit.declaration.stride as u16).to_le_bytes(),
    )?;
    // Номер кости в вершине — сразу номер в скелете педа, как у одежды игры: список костей геометрии снимается.
    clear_pointer(graph, edit.geometry, at::GEOMETRY_BONES)?;
    rg::write_at(
        graph,
        edit.geometry,
        at::GEOMETRY_BONES_COUNT,
        &0u16.to_le_bytes(),
    )?;
    Ok(())
}

/// Модель без кожи на корне — все её геометрии получают веса тела; скинованная — только геометрии без весов.
fn skin_model(
    graph: &mut Graph,
    model: usize,
    body: &BodyVertices,
    report: &mut Report,
) -> Result<()> {
    let Some(list) = geometries(graph, model).filter(|list| !list.is_empty()) else {
        return Ok(());
    };
    if rigid_on_bone(graph, model) {
        return Ok(());
    }
    let unskinned = binding(graph, model).0 == 0;
    let needs = unskinned
        || list
            .iter()
            .flatten()
            .any(|&geometry| !carries_skin(graph, geometry));
    if !needs {
        return Ok(());
    }
    for geometry in list.into_iter().flatten() {
        let Some(buffer) = Buffer::of(graph, geometry) else {
            continue;
        };
        if buffer.declaration.is_none() || buffer.data.is_none() {
            continue;
        }
        if !unskinned && carries_skin(graph, geometry) {
            continue;
        }
        let edit = plan_geometry(graph, geometry, body)?;
        report.geometries += 1;
        report.vertices += edit.count;
        report.far += edit.far;
        apply(graph, edit)?;
    }
    // Флаг кожи — 1, кость — корень; остальные байты связки на месте.
    let word = word_at(graph, model, at::MODEL_BINDING).unwrap_or(0);
    rg::write_at(
        graph,
        model,
        at::MODEL_BINDING,
        &((word & 0x00ff_00ff) | 0x0000_0100).to_le_bytes(),
    )?;
    report.models += 1;
    Ok(())
}

/// Пишет число, если оно помещается в блок; иначе блок остаётся как есть.
fn put(graph: &mut Graph, block: usize, relative: usize, bytes: &[u8]) {
    let _ = rg::write_at(graph, block, relative, bytes);
}

/// Поля, которые хост при каждой записи считает заново: копии числа геометрий в модели, а в геометрии — число
/// индексов, число треугольников, число вершин и шаг вершины (по декларации). У целых файлов они уже верны.
fn settle(graph: &mut Graph) {
    for drawable in drawables(graph) {
        for model in all_models(graph, drawable) {
            if let Some(count) = half_at(graph, model, at::MODEL_COUNT) {
                put(graph, model, at::MODEL_COUNT_COPY, &count.to_le_bytes());
                put(
                    graph,
                    model,
                    at::MODEL_COUNT_SECOND_COPY,
                    &count.to_le_bytes(),
                );
            }
            for geometry in geometries(graph, model)
                .unwrap_or_default()
                .into_iter()
                .flatten()
            {
                if let Some(buffer) = Buffer::of(graph, geometry) {
                    put(
                        graph,
                        geometry,
                        at::GEOMETRY_VERTICES,
                        &(buffer.count as u16).to_le_bytes(),
                    );
                    if let Some(declaration) = buffer.declaration {
                        put(
                            graph,
                            geometry,
                            at::GEOMETRY_STRIDE,
                            &(declaration.stride as u16).to_le_bytes(),
                        );
                    }
                }
                if let Some(count) = target(graph, geometry, at::GEOMETRY_INDEX_BUFFER)
                    .and_then(|index| word_at(graph, index, at::INDEX_COUNT))
                {
                    put(graph, geometry, at::GEOMETRY_INDICES, &count.to_le_bytes());
                    put(
                        graph,
                        geometry,
                        at::GEOMETRY_TRIANGLES,
                        &(count / 3).to_le_bytes(),
                    );
                }
            }
        }
    }
}

/// Даёт веса тела всем сеткам без привязки; граф правится на месте. Если хоть одна геометрия получила веса, словарь
/// будет записан заново, и производные поля пересчитываются у всех геометрий, как это делает хост.
pub fn skin(graph: &mut Graph, body: &BodyVertices) -> Result<Report> {
    let mut report = Report::default();
    for drawable in drawables(graph) {
        for model in all_models(graph, drawable) {
            skin_model(graph, model, body, &mut report)?;
        }
    }
    if report.geometries > 0 {
        settle(graph);
    }
    Ok(report)
}

/// Проверка собранной модели после перечитывания: у каждой геометрии скинованной модели есть веса.
pub fn verify_skinned(graph: &Graph, skinned: usize) -> Result<()> {
    let mut found = 0;
    for drawable in drawables(graph) {
        for model in all_models(graph, drawable) {
            for geometry in geometries(graph, model)
                .unwrap_or_default()
                .into_iter()
                .flatten()
            {
                if rigid_on_bone(graph, model) {
                    continue;
                }
                if binding(graph, model).0 != 1 || !carries_skin(graph, geometry) {
                    return Err(Error::broken(MSG_STILL_BARE));
                }
                found += 1;
            }
        }
    }
    if found < skinned {
        return Err(Error::broken(MSG_LOST));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{GRAPHICS_BASE, SYSTEM_BASE};
    use crate::resource_graph::from_parts;

    // ---------- стенд: словарь рисовалок собирается таблицами полей ----------

    /// Типы весов и костей образца: четыре байта у обоих.
    const WEIGHTS_TYPE: u8 = 9;
    const BONES_TYPE: u8 = 8;
    const FLOAT2: u8 = 5;

    #[derive(Default)]
    struct Arena {
        areas: [Vec<u8>; 2],
    }

    impl Arena {
        fn area(&mut self, segment: Segment) -> &mut Vec<u8> {
            &mut self.areas[usize::from(segment == Segment::Graphics)]
        }

        /// Блок нужной длины на границе 16; возвращает начало.
        fn reserve(&mut self, segment: Segment, len: usize) -> usize {
            let area = self.area(segment);
            let start = area.len().next_multiple_of(16);
            area.resize(start + len.max(1), 0);
            start
        }

        fn poke(&mut self, segment: Segment, at: usize, bytes: &[u8]) {
            self.area(segment)[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn base(segment: Segment) -> u64 {
            if segment == Segment::System {
                SYSTEM_BASE
            } else {
                GRAPHICS_BASE
            }
        }

        fn pointer(&mut self, from: (Segment, usize), field: usize, to: (Segment, usize)) {
            self.poke(
                from.0,
                from.1 + field,
                &(Self::base(to.0) + to.1 as u64).to_le_bytes(),
            );
        }

        fn into_graph(self) -> Graph {
            let [system, graphics] = self.areas;
            from_parts(165, 0, 0, system, graphics)
        }
    }

    use Segment::{Graphics as Gfx, System as Sys};

    /// Описание геометрии стенда: вершины по порядку и что у них есть.
    #[derive(Clone)]
    struct Geo {
        positions: Vec<[f32; 3]>,
        /// Веса и кости по вершинам: `None` — семантик нет.
        skin: Option<Vec<([u8; 4], [u8; 4])>>,
        /// Список костей геометрии.
        bone_ids: Option<Vec<u16>>,
        /// Указатель на данные вершин (`+0x10`): `false` — его нет.
        data_pointer: bool,
        /// Декларации нет вовсе.
        no_declaration: bool,
        /// Область, где лежат байты вершин: у вещей педа системная.
        home: Segment,
        /// Число индексов в буфере индексов; ноль — буфера нет.
        indices: u32,
    }

    impl Geo {
        fn plain(positions: &[[f32; 3]]) -> Geo {
            Geo {
                positions: positions.to_vec(),
                skin: None,
                bone_ids: None,
                data_pointer: true,
                no_declaration: false,
                home: Sys,
                indices: 0,
            }
        }

        fn skinned(positions: &[[f32; 3]], skin: &[([u8; 4], [u8; 4])]) -> Geo {
            Geo {
                skin: Some(skin.to_vec()),
                ..Geo::plain(positions)
            }
        }

        fn flags(&self) -> u32 {
            0b100_1001
                | if self.skin.is_some() {
                    SKIN_SEMANTICS
                } else {
                    0
                }
        }

        fn stride(&self) -> usize {
            12 + if self.skin.is_some() { 8 } else { 0 } + 12 + 8
        }

        /// Вершина: позиция, веса, кости, нормаль (по номеру вершины), uv.
        fn bytes(&self) -> Vec<u8> {
            let mut out = Vec::new();
            for (n, position) in self.positions.iter().enumerate() {
                for value in position {
                    out.extend(value.to_le_bytes());
                }
                if let Some(skin) = &self.skin {
                    out.extend(skin[n].0);
                    out.extend(skin[n].1);
                }
                for value in [n as f32, 0.5, -1.0] {
                    out.extend(value.to_le_bytes());
                }
                for value in [n as f32 / 8.0, 0.25] {
                    out.extend(value.to_le_bytes());
                }
            }
            out
        }

        /// Типы по семантикам: позиция, нормаль, uv0 — как у вещей игры; веса и кости — образца.
        fn types(&self) -> u64 {
            let mut types = u64::from(FLOAT3) | u64::from(FLOAT3) << 12 | u64::from(FLOAT2) << 24;
            if self.skin.is_some() {
                types |= u64::from(WEIGHTS_TYPE) << 4 | u64::from(BONES_TYPE) << 8;
            }
            types
        }
    }

    fn lay_geometry(arena: &mut Arena, geo: &Geo) -> (Segment, usize) {
        let bytes = geo.bytes();
        let data = arena.reserve(geo.home, bytes.len());
        arena.poke(geo.home, data, &bytes);
        let declaration = arena.reserve(Sys, 16);
        arena.poke(Sys, declaration, &geo.flags().to_le_bytes());
        arena.poke(Sys, declaration + 4, &(geo.stride() as u16).to_le_bytes());
        arena.poke(Sys, declaration + 6, &[0, geo.flags().count_ones() as u8]);
        arena.poke(Sys, declaration + 8, &geo.types().to_le_bytes());
        let buffer = arena.reserve(Sys, 0x80);
        arena.poke(Sys, buffer, &0x4061_d3e0u32.to_le_bytes());
        arena.poke(Sys, buffer + 8, &(geo.stride() as u16).to_le_bytes());
        arena.poke(Sys, buffer + 0x0a, &4u16.to_le_bytes());
        arena.poke(
            Sys,
            buffer + 0x18,
            &(geo.positions.len() as u32).to_le_bytes(),
        );
        if geo.data_pointer {
            arena.pointer((Sys, buffer), at::BUFFER_DATA, (geo.home, data));
            arena.pointer((Sys, buffer), at::BUFFER_DATA_ALIAS, (geo.home, data));
        }
        if !geo.no_declaration {
            arena.pointer((Sys, buffer), at::BUFFER_DECLARATION, (Sys, declaration));
        }
        let geometry = arena.reserve(Sys, 0xa0);
        arena.poke(Sys, geometry, &0x4061_8780u32.to_le_bytes());
        arena.pointer((Sys, geometry), at::GEOMETRY_BUFFER, (Sys, buffer));
        arena.poke(
            Sys,
            geometry + 0x60,
            &(geo.positions.len() as u16).to_le_bytes(),
        );
        arena.poke(Sys, geometry + 0x70, &(geo.stride() as u16).to_le_bytes());
        if geo.indices > 0 {
            let index_buffer = arena.reserve(Sys, 0x40);
            arena.poke(Sys, index_buffer + 8, &geo.indices.to_le_bytes());
            arena.pointer(
                (Sys, geometry),
                at::GEOMETRY_INDEX_BUFFER,
                (Sys, index_buffer),
            );
            arena.poke(
                Sys,
                geometry + at::GEOMETRY_INDICES,
                &geo.indices.to_le_bytes(),
            );
            arena.poke(
                Sys,
                geometry + at::GEOMETRY_TRIANGLES,
                &(geo.indices / 3).to_le_bytes(),
            );
        }
        if geo.data_pointer {
            arena.pointer((Sys, geometry), at::GEOMETRY_DATA, (geo.home, data));
        }
        if let Some(ids) = &geo.bone_ids {
            let list = arena.reserve(Sys, ids.len() * 2);
            for (n, id) in ids.iter().enumerate() {
                arena.poke(Sys, list + n * 2, &id.to_le_bytes());
            }
            arena.pointer((Sys, geometry), at::GEOMETRY_BONES, (Sys, list));
            arena.poke(
                Sys,
                geometry + at::GEOMETRY_BONES_COUNT,
                &(ids.len() as u16).to_le_bytes(),
            );
        }
        (Sys, geometry)
    }

    /// Модель: связка `+0x28` (кость, кожа) и геометрии.
    fn lay_model(arena: &mut Arena, geos: &[Geo], has_skin: u8, bone: u8) -> (Segment, usize) {
        let placed: Vec<(Segment, usize)> =
            geos.iter().map(|geo| lay_geometry(arena, geo)).collect();
        let array = arena.reserve(Sys, placed.len() * 8);
        for (n, &geometry) in placed.iter().enumerate() {
            arena.pointer((Sys, array), n * 8, geometry);
        }
        let model = arena.reserve(Sys, 0x30);
        arena.poke(Sys, model, &0x4061_0a90u32.to_le_bytes());
        arena.pointer((Sys, model), at::MODEL_GEOMETRIES, (Sys, array));
        arena.poke(
            Sys,
            model + at::MODEL_COUNT,
            &(placed.len() as u16).to_le_bytes(),
        );
        arena.poke(Sys, model + 0x12, &(placed.len() as u16).to_le_bytes());
        let binding = u32::from(has_skin) << 8 | u32::from(bone) << 24;
        arena.poke(Sys, model + at::MODEL_BINDING, &binding.to_le_bytes());
        arena.poke(Sys, model + 0x2e, &(placed.len() as u16).to_le_bytes());
        (Sys, model)
    }

    /// Список моделей уровня.
    fn lay_level(arena: &mut Arena, models: &[(Segment, usize)]) -> (Segment, usize) {
        let entries = arena.reserve(Sys, models.len() * 8);
        for (n, &model) in models.iter().enumerate() {
            arena.pointer((Sys, entries), n * 8, model);
        }
        let head = arena.reserve(Sys, 16);
        arena.pointer((Sys, head), at::LIST_ENTRIES, (Sys, entries));
        arena.poke(
            Sys,
            head + at::LIST_COUNT,
            &(models.len() as u16).to_le_bytes(),
        );
        arena.poke(Sys, head + 0x0a, &(models.len() as u16).to_le_bytes());
        (Sys, head)
    }

    /// Описание модели стенда по уровням: модели уровня — (геометрии, кожа, кость).
    type Levels = [Vec<(Vec<Geo>, u8, u8)>; 4];

    fn lay_drawable(arena: &mut Arena, levels: &Levels) -> (Segment, usize) {
        let heads: Vec<Option<(Segment, usize)>> = levels
            .iter()
            .map(|models| {
                (!models.is_empty()).then(|| {
                    let placed: Vec<_> = models
                        .iter()
                        .map(|(geos, skin, bone)| lay_model(arena, geos, *skin, *bone))
                        .collect();
                    lay_level(arena, &placed)
                })
            })
            .collect();
        let drawable = arena.reserve(Sys, 0xb0);
        arena.poke(Sys, drawable, &0x4057_3170u32.to_le_bytes());
        for (n, head) in heads.into_iter().enumerate() {
            if let Some(head) = head {
                arena.pointer((Sys, drawable), at::LEVELS[n], head);
            }
        }
        (Sys, drawable)
    }

    /// Словарь из рисовалок по описаниям уровней.
    fn dictionary(drawables: &[Levels]) -> Graph {
        let mut arena = Arena::default();
        assert_eq!(arena.reserve(Sys, 0x40), 0);
        let placed: Vec<_> = drawables
            .iter()
            .map(|levels| lay_drawable(&mut arena, levels))
            .collect();
        let hashes = arena.reserve(Sys, 4 * placed.len());
        let array = arena.reserve(Sys, 8 * placed.len());
        for (n, &drawable) in placed.iter().enumerate() {
            arena.pointer((Sys, array), n * 8, drawable);
            arena.poke(
                Sys,
                hashes + n * 4,
                &(0x1000_0000u32 + n as u32).to_le_bytes(),
            );
        }
        arena.pointer((Sys, 0), 0x20, (Sys, hashes));
        arena.poke(Sys, 0x28, &(placed.len() as u16).to_le_bytes());
        arena.pointer((Sys, 0), at::DRAWABLES, (Sys, array));
        arena.poke(
            Sys,
            at::DRAWABLE_COUNT,
            &(placed.len() as u16).to_le_bytes(),
        );
        arena.into_graph()
    }

    fn one_drawable(high: Vec<(Vec<Geo>, u8, u8)>) -> Graph {
        dictionary(&[[high, vec![], vec![], vec![]]])
    }

    /// Тело из одной скинованной геометрии: четыре вершины на осях, у каждой свои веса и кости.
    fn body_graph() -> Graph {
        let positions = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let skin: Vec<([u8; 4], [u8; 4])> = (0..4u8)
            .map(|n| ([255 - n, n, 0, 0], [10 + n, 20 + n, 0, 0]))
            .collect();
        let mut geo = Geo::skinned(&positions, &skin);
        geo.bone_ids = Some(vec![
            100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116,
            117, 118, 119, 120, 121, 122, 123, 124,
        ]);
        one_drawable(vec![(vec![geo], 1, 0)])
    }

    fn body() -> BodyVertices {
        let mut body = BodyVertices::new();
        body.add(&body_graph()).unwrap();
        body
    }

    // ---------- чтение графа стенда ----------

    fn pointer_block(graph: &Graph, block: usize, relative: usize) -> Option<usize> {
        let slot = graph.blocks[block]
            .slots
            .iter()
            .find(|slot| slot.relative == relative)?;
        graph.block_at(slot.target)
    }

    /// Блоки рисовалки 0: уровень → модели → геометрии.
    fn model_blocks(graph: &Graph, level: usize) -> Vec<usize> {
        let array = pointer_block(graph, graph.root().unwrap(), at::DRAWABLES).unwrap();
        let drawable = pointer_block(graph, array, 0).unwrap();
        let Some(head) = pointer_block(graph, drawable, at::LEVELS[level]) else {
            return Vec::new();
        };
        let count = usize::from(u16::from_le_bytes(
            graph.content(head)[8..10].try_into().unwrap(),
        ));
        let entries = pointer_block(graph, head, 0).unwrap();
        (0..count)
            .map(|n| pointer_block(graph, entries, n * 8).unwrap())
            .collect()
    }

    fn geometry_blocks(graph: &Graph, model: usize) -> Vec<usize> {
        let count = usize::from(u16::from_le_bytes(
            graph.content(model)[0x10..0x12].try_into().unwrap(),
        ));
        let array = pointer_block(graph, model, at::MODEL_GEOMETRIES).unwrap();
        (0..count)
            .map(|n| pointer_block(graph, array, n * 8).unwrap())
            .collect()
    }

    fn binding(graph: &Graph, model: usize) -> u32 {
        u32::from_le_bytes(graph.content(model)[0x28..0x2c].try_into().unwrap())
    }

    /// Раскладка буфера геометрии: (флаги, типы, шаг декларации, шаг буфера, число вершин, байты вершин).
    fn buffer_of(graph: &Graph, geometry: usize) -> (u32, u64, usize, usize, usize, Vec<u8>) {
        let buffer = pointer_block(graph, geometry, at::GEOMETRY_BUFFER).unwrap();
        let declaration = pointer_block(graph, buffer, at::BUFFER_DECLARATION).unwrap();
        let head = graph.content(declaration);
        let count =
            u32::from_le_bytes(graph.content(buffer)[0x18..0x1c].try_into().unwrap()) as usize;
        let stride = usize::from(u16::from_le_bytes(
            graph.content(buffer)[8..10].try_into().unwrap(),
        ));
        let data = pointer_block(graph, buffer, at::BUFFER_DATA).unwrap();
        (
            u32::from_le_bytes(head[0..4].try_into().unwrap()),
            u64::from_le_bytes(head[8..16].try_into().unwrap()),
            usize::from(u16::from_le_bytes(head[4..6].try_into().unwrap())),
            stride,
            count,
            graph.content(data)[..count * stride].to_vec(),
        )
    }

    // ---------- сбор вершин тела ----------

    #[test]
    fn body_takes_skinned_high_geometries_and_maps_bones_through_the_geometry_list() {
        let body = body();
        assert_eq!(body.len(), 4);
        assert!(!body.is_empty());
        assert_eq!(body.types(), Some((WEIGHTS_TYPE, BONES_TYPE)));
        // кости образца идут через список костей геометрии: номер 10 → 110, 20 → 120
        assert_eq!(body.bones_of(0), [110, 120, 100, 100]);
        assert_eq!(body.weights_of(1), [254, 1, 0, 0]);
    }

    #[test]
    fn body_without_a_bone_list_keeps_the_raw_bone_bytes() {
        let skin = [([255, 0, 0, 0], [7, 8, 9, 10])];
        let graph = one_drawable(vec![(vec![Geo::skinned(&[[0.0; 3]], &skin)], 1, 0)]);
        let mut body = BodyVertices::new();
        body.add(&graph).unwrap();
        assert_eq!(body.bones_of(0), [7, 8, 9, 10]);
    }

    #[test]
    fn body_skips_what_is_not_a_skinned_high_geometry() {
        let skin = [([255, 0, 0, 0], [0; 4])];
        let skinned = Geo::skinned(&[[0.0; 3]], &skin);
        // модель без кожи; геометрия без весов; нет данных; нет декларации; модель только в Low
        let mut no_data = skinned.clone();
        no_data.data_pointer = false;
        let mut no_declaration = skinned.clone();
        no_declaration.no_declaration = true;
        let graph = dictionary(&[[
            vec![
                (vec![skinned.clone()], 0, 0),
                (vec![Geo::plain(&[[0.0; 3]])], 1, 0),
                (vec![no_data], 1, 0),
                (vec![no_declaration], 1, 0),
            ],
            vec![],
            vec![(vec![skinned.clone()], 1, 0)],
            vec![],
        ]]);
        let mut body = BodyVertices::new();
        body.add(&graph).unwrap();
        assert_eq!(body.len(), 0);
        assert!(body.is_empty());
        assert_eq!(body.types(), None);
    }

    #[test]
    fn body_drops_vertices_whose_bone_cannot_be_numbered() {
        // номер 30 вне списка из 25 костей; кость 300 не влезает в байт
        let mut geo = Geo::skinned(
            &[[0.0; 3], [1.0; 3]],
            &[
                ([255, 0, 0, 0], [30, 0, 0, 0]),
                ([255, 0, 0, 0], [1, 0, 0, 0]),
            ],
        );
        let mut ids = vec![1u16; 25];
        ids[1] = 300;
        geo.bone_ids = Some(ids);
        let graph = one_drawable(vec![(vec![geo], 1, 0)]);
        let mut body = BodyVertices::new();
        body.add(&graph).unwrap();
        assert_eq!(body.len(), 0);
    }

    #[test]
    fn body_keeps_the_first_weight_types_and_skips_other_kinds() {
        let skin = [([255, 0, 0, 0], [1, 0, 0, 0])];
        let first = Geo::skinned(&[[0.0; 3]], &skin);
        let graph = one_drawable(vec![(vec![first.clone()], 1, 0)]);
        let mut body = BodyVertices::new();
        body.add(&graph).unwrap();
        // та же раскладка у второго образца: вершины добавляются
        body.add(&graph).unwrap();
        assert_eq!(body.len(), 2);
    }

    // ---------- ближайшая вершина ----------

    #[test]
    fn nearest_is_the_closest_vertex_and_far_is_only_for_the_brute_force_branch() {
        let body = body();
        assert_eq!(body.nearest([0.9, 0.1, 0.0]), Some((1, false)));
        assert_eq!(body.nearest([0.0, 0.0, 0.8]), Some((3, false)));
        // дальше двенадцати колец (12 · 0,08 = 0,96) — перебор
        assert_eq!(body.nearest([40.0, 0.0, 0.0]), Some((1, true)));
        assert_eq!(BodyVertices::new().nearest([0.0; 3]), None);
    }

    #[test]
    fn nearest_agrees_with_brute_force_on_scattered_points() {
        let mut state = 12345u32;
        let mut next = move || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 8) as f32 / 16_777_216.0
        };
        let points: Vec<[f32; 3]> = (0..300)
            .map(|_| [next() * 2.0 - 1.0, next() * 2.0 - 1.0, next() * 2.0 - 1.0])
            .collect();
        let skin: Vec<([u8; 4], [u8; 4])> =
            (0..300).map(|n| ([n as u8, 0, 0, 0], [0; 4])).collect();
        let mut geo = Geo::skinned(&points, &skin);
        geo.bone_ids = None;
        let mut body = BodyVertices::new();
        body.add(&one_drawable(vec![(vec![geo], 1, 0)])).unwrap();
        assert_eq!(body.len(), 300);
        for _ in 0..200 {
            let probe = [next() * 4.0 - 2.0, next() * 4.0 - 2.0, next() * 4.0 - 2.0];
            let distance = |p: [f32; 3]| {
                (p[0] - probe[0]) * (p[0] - probe[0])
                    + (p[1] - probe[1]) * (p[1] - probe[1])
                    + (p[2] - probe[2]) * (p[2] - probe[2])
            };
            let best = points
                .iter()
                .map(|&p| distance(p))
                .fold(f32::INFINITY, f32::min);
            let (found, searched) = body.nearest(probe).unwrap();
            // Точно ближайшая — в пределах двенадцати колец (0,96); дальше кольца отдают первую найденную вершину, как у кадра.
            let reach = MAX_RING as f32 * CELL;
            if best <= reach * reach {
                assert_eq!(distance(points[found]), best);
                assert!(!searched);
            } else {
                assert!(distance(points[found]) >= best);
            }
        }
    }

    // ---------- правка модели ----------

    /// Вершины модели вещи: три точки у вершин тела 1, 2 и 3.
    fn cloth_positions() -> [[f32; 3]; 3] {
        [[0.9, 0.1, 0.0], [0.0, 0.8, 0.1], [0.05, 0.0, 0.9]]
    }

    #[test]
    fn a_model_without_skin_takes_the_weights_of_the_nearest_body_vertices() {
        let mut graph = one_drawable(vec![(vec![Geo::plain(&cloth_positions())], 0, 0)]);
        let report = skin(&mut graph, &body()).unwrap();
        assert_eq!(
            report,
            Report {
                models: 1,
                geometries: 1,
                vertices: 3,
                far: 0
            }
        );
        let model = model_blocks(&graph, 0)[0];
        assert_eq!(binding(&graph, model) >> 8 & 0xff, 1, "флаг кожи");
        assert_eq!(binding(&graph, model) >> 24, 0, "кость — корень");
        let geometry = geometry_blocks(&graph, model)[0];
        let (flags, types, declared, stride, count, bytes) = buffer_of(&graph, geometry);
        assert_eq!(flags & SKIN_SEMANTICS, SKIN_SEMANTICS);
        assert_eq!(
            (types >> 4) & 0xff,
            u64::from(WEIGHTS_TYPE) | u64::from(BONES_TYPE) << 4
        );
        assert_eq!((declared, stride, count), (40, 40, 3));
        assert_eq!(bytes.len(), 120);
        // позиция, веса, кости, нормаль, uv — в порядке семантик
        let expected = [
            (1usize, [254u8, 1, 0, 0], [111u8, 121, 100, 100]),
            (2, [253, 2, 0, 0], [112, 122, 100, 100]),
            (3, [252, 3, 0, 0], [113, 123, 100, 100]),
        ];
        for (vertex, (_near, weights, bones)) in expected.into_iter().enumerate() {
            let row = &bytes[vertex * 40..vertex * 40 + 40];
            assert_eq!(&row[12..16], &weights, "веса вершины {vertex}");
            assert_eq!(&row[16..20], &bones, "кости вершины {vertex}");
            assert_eq!(
                &row[0..12],
                &cloth_positions()[vertex]
                    .iter()
                    .flat_map(|v| v.to_le_bytes())
                    .collect::<Vec<u8>>()[..],
                "позиция"
            );
            assert_eq!(
                &row[20..24],
                &(vertex as f32).to_le_bytes(),
                "нормаль на новом месте"
            );
            assert_eq!(
                &row[32..36],
                &(vertex as f32 / 8.0).to_le_bytes(),
                "uv на новом месте"
            );
        }
    }

    #[test]
    fn the_geometry_loses_its_bone_list_and_points_at_the_new_data() {
        let mut geo = Geo::plain(&cloth_positions());
        geo.bone_ids = Some(vec![3, 4, 5]);
        let mut graph = one_drawable(vec![(vec![geo], 0, 0)]);
        skin(&mut graph, &body()).unwrap();
        let geometry = geometry_blocks(&graph, model_blocks(&graph, 0)[0])[0];
        assert!(graph.blocks[geometry]
            .slots
            .iter()
            .all(|slot| slot.relative != at::GEOMETRY_BONES));
        assert_eq!(
            &graph.content(geometry)[at::GEOMETRY_BONES..at::GEOMETRY_BONES + 8],
            &[0; 8]
        );
        assert_eq!(
            &graph.content(geometry)[at::GEOMETRY_BONES_COUNT..at::GEOMETRY_BONES_COUNT + 2],
            &[0, 0]
        );
        let buffer = pointer_block(&graph, geometry, at::GEOMETRY_BUFFER).unwrap();
        let data = pointer_block(&graph, buffer, at::BUFFER_DATA).unwrap();
        assert_eq!(
            pointer_block(&graph, buffer, at::BUFFER_DATA_ALIAS),
            Some(data)
        );
        assert_eq!(
            pointer_block(&graph, geometry, at::GEOMETRY_DATA),
            Some(data),
            "указатель геометрии ведёт на сами байты"
        );
        assert_eq!(
            graph.blocks[data].segment,
            Segment::System,
            "новые байты — в системной области"
        );
    }

    #[test]
    fn new_vertex_bytes_go_to_the_system_area_even_when_the_old_ones_lay_elsewhere() {
        let mut geo = Geo::plain(&cloth_positions());
        geo.home = Gfx;
        let mut graph = one_drawable(vec![(vec![geo], 0, 0)]);
        skin(&mut graph, &body()).unwrap();
        let geometry = geometry_blocks(&graph, model_blocks(&graph, 0)[0])[0];
        let buffer = pointer_block(&graph, geometry, at::GEOMETRY_BUFFER).unwrap();
        assert_eq!(
            graph.blocks[pointer_block(&graph, buffer, at::BUFFER_DATA).unwrap()].segment,
            Segment::System
        );
    }

    #[test]
    fn a_skinned_model_changes_only_geometries_without_weights() {
        let skin_rows = [([200, 55, 0, 0], [5, 6, 0, 0]); 3];
        let already = Geo::skinned(&cloth_positions(), &skin_rows);
        let bare = Geo::plain(&cloth_positions());
        let mut graph = one_drawable(vec![(vec![already, bare], 1, 0)]);
        let before = buffer_of(
            &graph,
            geometry_blocks(&graph, model_blocks(&graph, 0)[0])[0],
        );
        let report = skin(&mut graph, &body()).unwrap();
        assert_eq!(
            report,
            Report {
                models: 1,
                geometries: 1,
                vertices: 3,
                far: 0
            }
        );
        let geometries = geometry_blocks(&graph, model_blocks(&graph, 0)[0]);
        assert_eq!(
            buffer_of(&graph, geometries[0]),
            before,
            "скинованная геометрия осталась"
        );
        assert_eq!(
            buffer_of(&graph, geometries[1]).0 & SKIN_SEMANTICS,
            SKIN_SEMANTICS
        );
    }

    #[test]
    fn an_unskinned_model_re_skins_even_the_geometries_that_already_carry_weights() {
        let skin_rows = [([200, 55, 0, 0], [5, 6, 0, 0]); 3];
        let mut graph = one_drawable(vec![(
            vec![Geo::skinned(&cloth_positions(), &skin_rows)],
            0,
            0,
        )]);
        let report = skin(&mut graph, &body()).unwrap();
        assert_eq!(
            report,
            Report {
                models: 1,
                geometries: 1,
                vertices: 3,
                far: 0
            }
        );
        let (_, _, _, stride, _, bytes) = buffer_of(
            &graph,
            geometry_blocks(&graph, model_blocks(&graph, 0)[0])[0],
        );
        assert_eq!(stride, 40);
        assert_eq!(
            &bytes[12..16],
            &[254, 1, 0, 0],
            "веса взяты у тела, а не у вещи"
        );
    }

    #[test]
    fn a_rigid_part_on_a_bone_and_a_fully_skinned_model_are_left_alone() {
        let skin_rows = [([200, 55, 0, 0], [5, 6, 0, 0]); 3];
        let mut graph = dictionary(&[[
            vec![
                (vec![Geo::plain(&cloth_positions())], 0, 7),
                (vec![Geo::skinned(&cloth_positions(), &skin_rows)], 1, 0),
            ],
            vec![],
            vec![],
            vec![],
        ]]);
        let before: Vec<u8> = graph.system.clone();
        let report = skin(&mut graph, &body()).unwrap();
        assert_eq!(report, Report::default());
        assert_eq!(graph.system, before);
    }

    #[test]
    fn derived_fields_are_settled_for_every_geometry_once_the_dictionary_is_written_again() {
        let skin_rows = [([200, 55, 0, 0], [5, 6, 0, 0]); 3];
        let mut kept = Geo::skinned(&cloth_positions(), &skin_rows);
        kept.indices = 12;
        let mut bare = Geo::plain(&cloth_positions());
        bare.indices = 6;
        let mut graph = one_drawable(vec![(vec![bare, kept], 1, 0)]);
        let model = model_blocks(&graph, 0)[0];
        let geometries = geometry_blocks(&graph, model);
        // Производные поля у нетронутой геометрии и у модели испорчены.
        for (at, bytes) in [
            (at::GEOMETRY_INDICES, vec![1u8, 2, 3, 4]),
            (at::GEOMETRY_TRIANGLES, vec![5, 6, 7, 8]),
            (at::GEOMETRY_VERTICES, vec![9, 9]),
            (at::GEOMETRY_STRIDE, vec![0x34, 0x12]),
        ] {
            rg::write_at(&mut graph, geometries[1], at, &bytes).unwrap();
        }
        rg::write_at(&mut graph, model, at::MODEL_COUNT_COPY, &[7, 0]).unwrap();
        rg::write_at(&mut graph, model, at::MODEL_COUNT_SECOND_COPY, &[8, 0]).unwrap();
        skin(&mut graph, &body()).unwrap();
        let word = |block: usize, relative: usize, len: usize| {
            graph.content(block)[relative..relative + len].to_vec()
        };
        assert_eq!(
            word(geometries[1], at::GEOMETRY_INDICES, 4),
            12u32.to_le_bytes(),
            "число индексов"
        );
        assert_eq!(
            word(geometries[1], at::GEOMETRY_TRIANGLES, 4),
            4u32.to_le_bytes(),
            "число треугольников"
        );
        assert_eq!(
            word(geometries[1], at::GEOMETRY_VERTICES, 2),
            3u16.to_le_bytes(),
            "число вершин"
        );
        assert_eq!(
            word(geometries[1], at::GEOMETRY_STRIDE, 2),
            40u16.to_le_bytes(),
            "шаг по декларации"
        );
        assert_eq!(
            word(geometries[0], at::GEOMETRY_STRIDE, 2),
            40u16.to_le_bytes(),
            "шаг изменённой геометрии"
        );
        assert_eq!(word(model, at::MODEL_COUNT_COPY, 2), 2u16.to_le_bytes());
        assert_eq!(
            word(model, at::MODEL_COUNT_SECOND_COPY, 2),
            2u16.to_le_bytes()
        );
    }

    #[test]
    fn all_levels_are_skinned_and_far_vertices_are_counted() {
        let far = [[30.0, 0.0, 0.0], [0.0, 0.7, 0.0]];
        let mut graph = dictionary(&[[
            vec![(vec![Geo::plain(&far)], 0, 0)],
            vec![(vec![Geo::plain(&far)], 0, 0)],
            vec![(vec![Geo::plain(&far)], 0, 0)],
            vec![(vec![Geo::plain(&far)], 0, 0)],
        ]]);
        let report = skin(&mut graph, &body()).unwrap();
        assert_eq!(
            report,
            Report {
                models: 4,
                geometries: 4,
                vertices: 8,
                far: 4
            }
        );
        for level in 0..4 {
            let model = model_blocks(&graph, level)[0];
            assert_eq!(binding(&graph, model) >> 8 & 0xff, 1, "уровень {level}");
        }
    }

    #[test]
    fn a_model_whose_geometry_has_no_vertex_data_is_counted_but_changes_nothing() {
        let mut geo = Geo::plain(&cloth_positions());
        geo.data_pointer = false;
        let mut graph = one_drawable(vec![(vec![geo], 0, 0)]);
        let report = skin(&mut graph, &body()).unwrap();
        assert_eq!(
            report,
            Report {
                models: 1,
                geometries: 0,
                vertices: 0,
                far: 0
            }
        );
    }

    #[test]
    fn vertices_without_float_positions_are_refused() {
        let mut graph = one_drawable(vec![(vec![Geo::plain(&cloth_positions())], 0, 0)]);
        let model = model_blocks(&graph, 0)[0];
        let geometry = geometry_blocks(&graph, model)[0];
        let buffer = pointer_block(&graph, geometry, at::GEOMETRY_BUFFER).unwrap();
        let declaration = pointer_block(&graph, buffer, at::BUFFER_DECLARATION).unwrap();
        rg::write_at(&mut graph, declaration, 8, &[FLOAT2]).unwrap();
        let error = skin(&mut graph, &body()).unwrap_err();
        assert_eq!(
            error.message,
            "Skin model vertices have no float positions."
        );
    }

    #[test]
    fn verify_accepts_skinned_geometries_and_names_the_ones_without_weights() {
        let mut graph = one_drawable(vec![(vec![Geo::plain(&cloth_positions())], 0, 0)]);
        skin(&mut graph, &body()).unwrap();
        verify_skinned(&graph, 1).unwrap();
        assert_eq!(
            verify_skinned(&graph, 2).unwrap_err().message,
            "Skinned model lost geometries on reopen."
        );
        let bare = one_drawable(vec![(vec![Geo::plain(&cloth_positions())], 1, 0)]);
        assert_eq!(
            verify_skinned(&bare, 0).unwrap_err().message,
            "Skinned model still has geometry without bone weights."
        );
        let rigid = one_drawable(vec![(vec![Geo::plain(&cloth_positions())], 0, 7)]);
        verify_skinned(&rigid, 0).unwrap();
    }

    #[test]
    fn a_dictionary_without_drawables_does_not_open() {
        assert!(has_drawables(&body_graph()));
        assert!(!has_drawables(&dictionary(&[])));
    }

    #[test]
    fn the_skinned_dictionary_survives_a_rebuild() {
        let mut graph = one_drawable(vec![(vec![Geo::plain(&cloth_positions())], 0, 0)]);
        skin(&mut graph, &body()).unwrap();
        let bytes = crate::drawable_write::finish_compact(&graph).unwrap();
        let again = crate::drawable_write::graph_of(&bytes).unwrap();
        verify_skinned(&again, 1).unwrap();
        let (_, _, _, stride, count, data) = buffer_of(
            &again,
            geometry_blocks(&again, model_blocks(&again, 0)[0])[0],
        );
        assert_eq!((stride, count, data.len()), (40, 3, 120));
    }
}

/// Зонды над настоящими файлами игры: делают входы без весов и описывают словари. Идут только по запросу
/// (`--ignored`) и переменным окружения; в обычный прогон не входят.
#[cfg(test)]
mod probes {
    use super::*;
    use crate::drawable_write::{finish_compact, graph_of};
    use std::path::PathBuf;

    /// Шаг вершины в самой геометрии.
    const GEOMETRY_STRIDE: usize = 0x70;

    fn env_dir(name: &str) -> PathBuf {
        PathBuf::from(std::env::var(name).unwrap_or_else(|_| panic!("нужна переменная {name}")))
    }

    /// Снимает с геометрии веса и кости: декларация без семантик 1 и 2, вершины без них, список костей снят.
    fn strip_geometry(graph: &mut Graph, geometry: usize) -> Result<bool> {
        let Some(buffer) = Buffer::of(graph, geometry) else {
            return Ok(false);
        };
        let (Some(old), Some(data)) = (buffer.declaration, buffer.data) else {
            return Ok(false);
        };
        let mut info = Declaration {
            flags: old.flags & !SKIN_SEMANTICS,
            stride: 0,
            spare: old.spare,
            types: old.types,
        };
        info.stride = (0..SEMANTICS)
            .filter(|&k| info.has(k))
            .map(|k| size_of_type(info.type_of(k)))
            .sum();
        let old_row = buffer.row(&old);
        let source = vertex_bytes(graph, data, old_row, buffer.count)?.to_vec();
        let mut bytes = vec![0u8; buffer.count * info.stride];
        for vertex in 0..buffer.count {
            for semantic in (0..SEMANTICS).filter(|&k| info.has(k)) {
                let size = size_of_type(info.type_of(semantic));
                let from = vertex * old_row + old.offset_of(semantic);
                let to = vertex * info.stride + info.offset_of(semantic);
                bytes[to..to + size].copy_from_slice(&source[from..from + size]);
            }
        }
        let stride = info.stride as u16;
        apply(
            graph,
            Edit {
                buffer: buffer.block,
                geometry,
                declaration: info,
                data: bytes,
                far: 0,
                count: buffer.count,
            },
        )?;
        // Вещь без привязки, как её выгружает автор, держит свой шаг и в самой геометрии.
        rg::write_at(graph, geometry, GEOMETRY_STRIDE, &stride.to_le_bytes())?;
        Ok(true)
    }

    fn set_binding(graph: &mut Graph, model: usize, skin: u8, bone: u8) {
        let word = word_at(graph, model, at::MODEL_BINDING).unwrap();
        let word = (word & 0x00ff_00ff) | u32::from(skin) << 8 | u32::from(bone) << 24;
        rg::write_at(graph, model, at::MODEL_BINDING, &word.to_le_bytes()).unwrap();
    }

    /// Режимы входа: `strip` — как мод без привязки; `flag` — только флаг кожи снят; `mix` — первая геометрия без весов
    /// в скинованной модели; `rigid` — без весов и на кости 7.
    fn make(graph: &mut Graph, mode: &str) -> usize {
        let mut touched = 0;
        for drawable in drawables(graph) {
            for model in all_models(graph, drawable) {
                let list: Vec<usize> = geometries(graph, model)
                    .unwrap_or_default()
                    .into_iter()
                    .flatten()
                    .collect();
                match mode {
                    "flag" => {
                        set_binding(graph, model, 0, 0);
                        touched += 1;
                    }
                    "mix" => {
                        if let Some(&first) = list.first() {
                            touched += usize::from(strip_geometry(graph, first).unwrap());
                        }
                    }
                    "fields" => {
                        // Первая геометрия без весов; в остальных, модели и рисовалке портятся поля из SKIN_FIELDS
                        // («вид:смещение:длина» через запятую; вид — geometry, buffer, index, model, drawable).
                        let spec = std::env::var("SKIN_FIELDS").unwrap_or_default();
                        for (n, &geometry) in list.iter().enumerate() {
                            if n == 0 {
                                touched += usize::from(strip_geometry(graph, geometry).unwrap());
                            }
                        }
                        let victims = |graph: &Graph, kind: &str| -> Vec<usize> {
                            match kind {
                                "geometry" => list.iter().skip(1).copied().collect(),
                                "buffer" => list
                                    .iter()
                                    .skip(1)
                                    .filter_map(|&g| target(graph, g, at::GEOMETRY_BUFFER))
                                    .collect(),
                                "index" => list
                                    .iter()
                                    .skip(1)
                                    .filter_map(|&g| target(graph, g, 0x38))
                                    .collect(),
                                "model" => vec![model],
                                _ => vec![drawable],
                            }
                        };
                        for item in spec.split(',').filter(|item| !item.is_empty()) {
                            let mut part = item.split(':');
                            let (kind, offset, len) = (
                                part.next().unwrap(),
                                part.next().unwrap(),
                                part.next().unwrap(),
                            );
                            let (offset, len): (usize, usize) = (
                                usize::from_str_radix(offset.trim_start_matches("0x"), 16).unwrap(),
                                len.parse().unwrap(),
                            );
                            let junk: Vec<u8> = (0..len).map(|i| 0x5a + i as u8).collect();
                            for block in victims(graph, kind) {
                                rg::write_at(graph, block, offset, &junk).unwrap();
                            }
                        }
                    }
                    "junk" => {
                        // Первая геометрия без весов, у остальных шаг в самой геометрии испорчен.
                        for (n, &geometry) in list.iter().enumerate() {
                            if n == 0 {
                                touched += usize::from(strip_geometry(graph, geometry).unwrap());
                            } else {
                                rg::write_at(
                                    graph,
                                    geometry,
                                    GEOMETRY_STRIDE,
                                    &0x1234u16.to_le_bytes(),
                                )
                                .unwrap();
                            }
                        }
                    }
                    _ => {
                        for &geometry in &list {
                            touched += usize::from(strip_geometry(graph, geometry).unwrap());
                        }
                        set_binding(graph, model, 0, if mode == "rigid" { 7 } else { 0 });
                    }
                }
            }
        }
        touched
    }

    #[test]
    #[ignore = "зонд: нужны SKIN_STRIP_SRC, SKIN_STRIP_DST, SKIN_STRIP_MODE и SKIN_STRIP_NAMES (имена через запятую)"]
    fn make_inputs_without_weights() {
        let (source, target, mode) = (
            env_dir("SKIN_STRIP_SRC"),
            env_dir("SKIN_STRIP_DST"),
            std::env::var("SKIN_STRIP_MODE").unwrap(),
        );
        let names = std::env::var("SKIN_STRIP_NAMES").unwrap();
        std::fs::create_dir_all(&target).unwrap();
        for name in names.split(',') {
            let mut graph = graph_of(&std::fs::read(source.join(name)).unwrap()).unwrap();
            let touched = make(&mut graph, &mode);
            let stem = name.trim_end_matches(".ydd");
            let out = target.join(format!("{stem}.{mode}.ydd"));
            std::fs::write(&out, finish_compact(&graph).unwrap()).unwrap();
            println!("{name} -> {} ({touched} геометрий тронуто)", out.display());
        }
    }

    #[test]
    #[ignore = "зонд: нужны SKIN_MODEL, SKIN_REFS (через запятую), SKIN_OUT"]
    fn skin_files() {
        let mut body = BodyVertices::new();
        for reference in std::env::var("SKIN_REFS").unwrap().split(',') {
            body.add(&graph_of(&std::fs::read(reference).unwrap()).unwrap())
                .unwrap();
        }
        let bytes = std::fs::read(std::env::var("SKIN_MODEL").unwrap()).unwrap();
        let mut graph = graph_of(&bytes).unwrap();
        let report = skin(&mut graph, &body).unwrap();
        println!("{report:?} вершин тела {}", body.len());
        let out = if report.geometries == 0 {
            bytes
        } else {
            finish_compact(&graph).unwrap()
        };
        std::fs::write(std::env::var("SKIN_OUT").unwrap(), out).unwrap();
    }

    /// Чем различаются две строки канона: номера и значения байтов тела блока и хвост со связями.
    fn line_diff(a: &str, b: &str) -> String {
        let parts = |line: &str| -> (Vec<String>, String) {
            let open = line.find('[').unwrap_or(0);
            let close = line[open..].find(']').map_or(line.len(), |at| open + at);
            let bytes = line[open + 1..close.min(line.len())]
                .split(", ")
                .map(str::to_owned)
                .collect();
            (bytes, line[close.min(line.len())..].to_owned())
        };
        let ((xa, ta), (xb, tb)) = (parts(a), parts(b));
        let mut text: Vec<String> = (0..xa.len().max(xb.len()))
            .filter(|&n| xa.get(n) != xb.get(n))
            .take(12)
            .map(|n| {
                format!(
                    "+{n:#x}: {} -> {}",
                    xa.get(n).map_or("-", String::as_str),
                    xb.get(n).map_or("-", String::as_str)
                )
            })
            .collect();
        if ta != tb {
            text.push(format!("связи: {ta} -> {tb}"));
        }
        text.join("; ")
    }

    /// Канонический текст с приведением того, что зависит от раскладки страниц: число страниц в карте корня.
    fn normalized(bytes: &[u8]) -> String {
        let mut graph = graph_of(bytes).unwrap();
        let map = graph
            .root()
            .and_then(|root| rg::pointer_from(&graph, root, 8))
            .and_then(|at| graph.block_at(at));
        if let Some(block) = map {
            let start = graph.blocks[block].start + 8;
            graph.system[start] = 0;
        }
        // Байт +0x30 группы шейдеров хост пишет сам (4), а мы держим исходный; слово размера блоков моделей (+0x9a рисовалки)
        // считает команда, поэтому в сверке команд оно сравнивается, а у зондов над одним ядром (SKIN_ZERO_SIZE_WORD) обнуляется.
        let zero_size_word = std::env::var("SKIN_ZERO_SIZE_WORD").is_ok();
        for drawable in drawables(&graph) {
            if zero_size_word {
                let start = graph.blocks[drawable].start + 0x9a;
                graph.system[start] = 0;
                graph.system[start + 1] = 0;
            }
            if let Some(group) = target(&graph, drawable, 0x10) {
                let at = graph.blocks[group].start + 0x30;
                graph.system[at] = 0;
            }
        }
        if std::env::var("SKIN_MASK_SKELETON").is_ok() {
            // Матрицы костей хост пересчитывает при записи (последний бит, знак нуля); с маской они не сравниваются.
            for drawable in drawables(&graph) {
                let Some(skeleton) = target(&graph, drawable, 0x18) else {
                    continue;
                };
                let mut seen = vec![false; graph.blocks.len()];
                let mut stack = vec![skeleton];
                while let Some(block) = stack.pop() {
                    if std::mem::replace(&mut seen[block], true) {
                        continue;
                    }
                    stack.extend(
                        graph.blocks[block]
                            .slots
                            .iter()
                            .filter_map(|slot| graph.block_at(slot.target)),
                    );
                }
                for block in (0..seen.len()).filter(|&block| seen[block]) {
                    let (segment, start, end) = (
                        graph.blocks[block].segment,
                        graph.blocks[block].start,
                        graph.blocks[block].end,
                    );
                    match segment {
                        Segment::System => graph.system[start..end].fill(0),
                        Segment::Graphics => graph.graphics[start..end].fill(0),
                    }
                }
            }
        }
        crate::drawable_write::canonical_with(&graph, false)
    }

    #[test]
    #[ignore = "зонд: нужны SKIN_A и SKIN_B"]
    fn compare_files() {
        let (a, b) = (
            std::fs::read(std::env::var("SKIN_A").unwrap()).unwrap(),
            std::fs::read(std::env::var("SKIN_B").unwrap()).unwrap(),
        );
        let (ta, tb) = (normalized(&a), normalized(&b));
        println!(
            "байты: {} и {}; блоков: {} и {}",
            a.len(),
            b.len(),
            ta.lines().count(),
            tb.lines().count()
        );
        let limit: usize = std::env::var("SKIN_SHOW")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(6);
        let mut shown = 0;
        for (n, (x, y)) in ta.lines().zip(tb.lines()).enumerate() {
            if x != y {
                shown += 1;
                println!("--- строка {n}: {}", line_diff(x, y));
                if shown >= limit {
                    break;
                }
            }
        }
        println!(
            "{}",
            if ta == tb {
                "КАНОН РАВЕН"
            } else {
                "канон расходится"
            }
        );
    }

    #[test]
    #[ignore = "зонд: нужны SKIN_DIR_A (хост) и SKIN_DIR_B (движок) с одноимёнными .ydd"]
    fn compare_dirs() {
        let (a, b) = (env_dir("SKIN_DIR_A"), env_dir("SKIN_DIR_B"));
        let mut names: Vec<String> = std::fs::read_dir(&a)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".ydd"))
            .collect();
        names.sort();
        let (mut equal, mut total) = (0, 0);
        let (mut host_sum, mut engine_sum) = (0usize, 0usize);
        for name in &names {
            let Ok(ours) = std::fs::read(b.join(name)) else {
                println!("НЕТ {name}: у движка файла нет");
                continue;
            };
            let host = std::fs::read(a.join(name)).unwrap();
            total += 1;
            host_sum += host.len();
            engine_sum += ours.len();
            let (ta, tb) = (normalized(&host), normalized(&ours));
            let ratio = (ours.len() as f64 / host.len() as f64 - 1.0) * 100.0;
            if ta == tb {
                equal += 1;
                println!(
                    "РАВНО {name}: хост {} байт, движок {} байт ({ratio:+.2} %)",
                    host.len(),
                    ours.len()
                );
            } else {
                let line = ta.lines().zip(tb.lines()).position(|(x, y)| x != y);
                println!("РАСХОДИТСЯ {name}: хост {} байт, движок {} байт ({ratio:+.2} %), первая строка {line:?}", host.len(), ours.len());
                if let Some(line) = line {
                    println!(
                        "  отличия (хост -> движок): {}",
                        line_diff(ta.lines().nth(line).unwrap(), tb.lines().nth(line).unwrap())
                    );
                }
            }
        }
        println!("канон равен: {equal} из {total}; сумма хоста {host_sum}, движка {engine_sum} ({:+.2} %)", (engine_sum as f64 / host_sum.max(1) as f64 - 1.0) * 100.0);
    }

    #[test]
    #[ignore = "зонд: нужен SKIN_DESCRIBE_DIR с каталогом .ydd"]
    fn describe_dictionaries() {
        let mut names: Vec<PathBuf> = std::fs::read_dir(env_dir("SKIN_DESCRIBE_DIR"))
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .collect();
        names.sort();
        for path in names
            .into_iter()
            .filter(|path| path.extension().is_some_and(|ext| ext == "ydd"))
        {
            let Ok(graph) = graph_of(&std::fs::read(&path).unwrap()) else {
                println!("{}: не читается", path.display());
                continue;
            };
            let mut parts = Vec::new();
            for drawable in drawables(&graph) {
                for level in 0..4 {
                    for model in level_models(&graph, drawable, level) {
                        let (skin, bone) = binding(&graph, model);
                        let flags: Vec<String> = geometries(&graph, model)
                            .unwrap_or_default()
                            .into_iter()
                            .map(|geometry| {
                                geometry
                                    .and_then(|g| Buffer::of(&graph, g))
                                    .and_then(|b| b.declaration)
                                    .map_or("-".to_owned(), |d| format!("{:x}", d.flags))
                            })
                            .collect();
                        parts.push(format!(
                            "L{level} skin={skin} bone={bone} [{}]",
                            flags.join(" ")
                        ));
                    }
                }
            }
            println!(
                "{}: {}",
                path.file_name().unwrap().to_string_lossy(),
                parts.join(" | ")
            );
        }
    }
}
