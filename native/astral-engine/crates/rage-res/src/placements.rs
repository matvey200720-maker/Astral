//! Расстановка своих моделей: словарь типов `.ytyp`, карта `.ymap` и манифест `_manifest.ymf`.
//!
//! Схемы структур берутся из шаблонов хоста (вшиты в бинарник), узлы собираются руками и записываются
//! `meta_graph`. Рамки карты считаются так же, как у хоста (поворот обратным кватернионом, углы рамки модели),
//! поэтому тела файлов совпадают с его выгрузками.

use std::borrow::Cow;
use std::sync::OnceLock;

use crate::error::{Error, Result};
use crate::manifest_write::{self, Dependency};
use crate::meta_graph::{self, Graph, Link, Node, NodeId, Read, Schema, StructDef};
use crate::meta_graph::{POINTER_BLOCK, STRING_BLOCK};
use crate::mlo;
use crate::ymap_write::meta_name;

/// Уровень детализации сущности: HD.
pub const LOD_HD: u32 = 0;
/// Уровень детализации сущности: LOD.
pub const LOD_LOD: u32 = 1;
/// Бит `contentFlags` карты дальних копий.
pub const CONTENT_LOD: u32 = 2;

/// Счётчики и длины строк в файле — u16: больше не помещается, и такой набор отказывает.
const MAX_COUNT: usize = 65_535;

/// Отказ с типом «неверный аргумент», если условие не выполнено.
fn argue(holds: bool, complaint: &str) -> Result<()> {
    match holds {
        true => Ok(()),
        false => Err(Error::argument(complaint)),
    }
}

/// Отказ с типом «файл повреждён», если условие не выполнено.
fn ensure(holds: bool, complaint: &str) -> Result<()> {
    match holds {
        true => Ok(()),
        false => Err(Error::broken(complaint)),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Смещения полей структур хоста
// ---------------------------------------------------------------------------------------------------------------

/// Модули со смещениями: `модуль { ИМЯ = байт, … }`.
macro_rules! offsets {
    ($($(#[$doc:meta])* $module:ident { $($(#[$note:meta])* $name:ident = $at:expr),+ $(,)? })+) => {
        $(
            $(#[$doc])*
            mod $module {
                $($(#[$note])* pub const $name: usize = $at;)+
            }
        )+
    };
}

offsets! {
    /// Смещения полей `CMapTypes`.
    ctypes { LIST = 24, COUNT = 32, NAME = 40 }

    /// Смещения полей `CBaseArchetypeDef` (у `CTimeArchetypeDef` за ними идёт `timeFlags`).
    carch {
        LOD_DIST = 8, FLAGS = 12, SPECIAL = 16, BB_MIN = 32, BB_MAX = 48, CENTRE = 64, RADIUS = 80,
        HD_DIST = 84, NAME = 88, TEXTURES = 92, CLIPS = 96, ASSET_TYPE = 108, ASSET_NAME = 112,
        TIME_FLAGS = 144
    }

    /// Смещения полей `CEntityDef`.
    cdef {
        ARCHETYPE = 8, FLAGS = 12, GUID = 16, POSITION = 32, ROTATION = 48, SCALE_XY = 64, SCALE_Z = 68,
        PARENT = 72, LOD_DIST = 76, CHILD_LOD = 80, LOD_LEVEL = 84, NUM_CHILDREN = 88, PRIORITY = 92,
        AO_MULTIPLIER = 112, AO_ARTIFICIAL = 116, TINT = 120
    }

    /// Смещения полей `CMapData`.
    cmap {
        NAME = 8, PARENT = 12, FLAGS = 16, CONTENT = 20, STREAM_MIN = 32, STREAM_MAX = 48, EXTENT_MIN = 64,
        EXTENT_MAX = 80, ENTITIES = 96, ENTITY_COUNT = 104,
        /// Массив генераторов машин: указатель, число и ёмкость.
        CAR_GENERATORS = 240,
        /// Три строки блока описания: имя карты, «кем выгружено», время.
        NAME_TEXT = 448,
        EXPORTER_TEXT = 464,
        TIME_TEXT = 496
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Байты узлов: таблица «смещение → значение» на запись и чтение слов по смещению
// ---------------------------------------------------------------------------------------------------------------

/// Значение, которое кладётся в узел по смещению.
enum Cell {
    Word(u32),
    Float(f32),
    Triple([f32; 3]),
    Quad([f32; 4]),
    /// Число элементов и ёмкость: два `u16` подряд (число усекается до `u16`).
    Pair(usize),
}

impl Cell {
    /// Слова значения, как они лежат в узле подряд.
    fn words(&self) -> Vec<u32> {
        match *self {
            Cell::Word(w) => vec![w],
            Cell::Float(f) => vec![f.to_bits()],
            Cell::Triple(v) => v.iter().map(|c| c.to_bits()).collect(),
            Cell::Quad(v) => v.iter().map(|c| c.to_bits()).collect(),
            Cell::Pair(n) => {
                let half = u32::from(n as u16);
                vec![half | half << 16]
            }
        }
    }
}

/// Раскладывает значения таблицы по байтам узла.
fn fill(bytes: &mut [u8], cells: &[(usize, Cell)]) {
    for (at, cell) in cells {
        for (i, word) in cell.words().into_iter().enumerate() {
            let slot = at + 4 * i;
            bytes[slot..slot + 4].copy_from_slice(&word.to_le_bytes());
        }
    }
}

/// `N` байт по смещению `at`.
fn bytes_at<const N: usize>(bytes: &[u8], at: usize) -> [u8; N] {
    bytes[at..at + N].try_into().expect("ровно N байт")
}

fn word_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes_at(bytes, at))
}

fn int_at(bytes: &[u8], at: usize) -> i32 {
    i32::from_le_bytes(bytes_at(bytes, at))
}

fn float_at(bytes: &[u8], at: usize) -> f32 {
    f32::from_bits(word_at(bytes, at))
}

/// `N` чисел подряд, начиная со смещения `at`.
fn floats_at<const N: usize>(bytes: &[u8], at: usize) -> [f32; N] {
    std::array::from_fn(|i| float_at(bytes, at + 4 * i))
}

// ---------------------------------------------------------------------------------------------------------------
// Шаблоны хоста
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Template {
    Types,
    Rainbow,
    Map,
}

/// Разобранный шаблон; разбирается один раз.
fn template(which: Template) -> Result<&'static Read> {
    static PARSED: [OnceLock<Result<Read>>; 3] =
        [OnceLock::new(), OnceLock::new(), OnceLock::new()];
    let (slot, source): (usize, &[u8]) = match which {
        Template::Types => (
            0,
            include_bytes!("../../../parity/host-port/placements/sample-types.ytyp"),
        ),
        Template::Rainbow => (
            1,
            include_bytes!("../../../parity/host-port/sky-rainbow/sample-types.ytyp"),
        ),
        Template::Map => (
            2,
            include_bytes!("../../../parity/host-port/placements/sample-map.ymap"),
        ),
    };
    PARSED[slot]
        .get_or_init(|| meta_graph::read(source))
        .as_ref()
        .map_err(Clone::clone)
}

/// Байты корня шаблона (указатели в них уже обнулены `read`).
fn template_root(read: &Read) -> Vec<u8> {
    read.graph.nodes[read.graph.root].bytes.clone()
}

// ---------------------------------------------------------------------------------------------------------------
// Имена и поворот
// ---------------------------------------------------------------------------------------------------------------

/// Имя архетипа или словаря: `#` и шестнадцатеричное число — само число, иначе хеш всей строки.
pub fn name_hash(name: &str) -> u32 {
    let literal = name
        .strip_prefix('#')
        .and_then(|digits| u32::from_str_radix(digits, 16).ok());
    literal.unwrap_or_else(|| meta_name(name))
}

/// Обратный кватернион; единичный отдаётся теми же битами.
pub fn invert(q: [f32; 4]) -> [f32; 4] {
    if q == [0.0, 0.0, 0.0, 1.0] {
        return q;
    }
    let [x, y, z, w] = q;
    let scale = (x * x + y * y + z * z + w * w).recip();
    [-x * scale, -y * scale, -z * scale, w * scale]
}

/// Поворот точки кватернионом, как у хоста: матрица поворота по строкам и умножение строки-вектора на неё.
fn rotate(v: [f32; 3], q: [f32; 4]) -> [f32; 3] {
    let [x, y, z, w] = q;
    let [xx, yy, zz] = [x, y, z].map(|c| c * c);
    let [wx, wy, wz] = [x, y, z].map(|c| w * c);
    let (xy, xz, yz) = (x * y, x * z, y * z);
    let rows = [
        [1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy)],
        [2.0 * (xy - wz), 1.0 - 2.0 * (zz + xx), 2.0 * (yz + wx)],
        [2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (yy + xx)],
    ];
    std::array::from_fn(|col| {
        let products = [0, 1, 2].map(|row| v[row] * rows[row][col]);
        products[0] + products[1] + products[2]
    })
}

/// Восемь углов рамки: ось x — внешний цикл, z — внутренний.
fn corners(lo: [f32; 3], hi: [f32; 3]) -> impl Iterator<Item = [f32; 3]> {
    (0..8usize).map(move |k| {
        std::array::from_fn(|axis| {
            let high = (k >> (2 - axis)) & 1 == 1;
            if high {
                hi[axis]
            } else {
                lo[axis]
            }
        })
    })
}

/// Накопленная рамка; NaN в точке не попадает в минимум и максимум.
#[derive(Clone, Copy)]
struct Extent {
    lo: [f32; 3],
    hi: [f32; 3],
}

const NO_EXTENT: Extent = Extent {
    lo: [f32::MAX; 3],
    hi: [f32::MIN; 3],
};

impl Extent {
    fn with(self, p: [f32; 3]) -> Self {
        Extent {
            lo: std::array::from_fn(|i| self.lo[i].min(p[i])),
            hi: std::array::from_fn(|i| self.hi[i].max(p[i])),
        }
    }

    /// Все углы рамки `(lo, hi)`, повёрнутые `turn` и сдвинутые на `at`.
    fn grown(self, (lo, hi): ([f32; 3], [f32; 3]), turn: [f32; 4], at: [f32; 3]) -> Self {
        let mut grown = self;
        for corner in corners(lo, hi) {
            let r = rotate(corner, turn);
            grown = grown.with([r[0] + at[0], r[1] + at[1], r[2] + at[2]]);
        }
        grown
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Словарь типов
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct ArchetypeSpec {
    pub name: String,
    pub lod_dist: f32,
    pub bb_min: [f32; 3],
    pub bb_max: [f32; 3],
    pub flags: u32,
    pub clip_dictionary: Option<String>,
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub struct ArchetypeFields {
    pub special_attribute: u32,
    pub hd_texture_dist: f32,
    pub texture_dictionary: Option<u32>,
    pub time_flags: Option<u32>,
}

impl ArchetypeFields {
    /// Поля «как есть»: расстояние текстур не больше 100, без словаря и без времени.
    fn plain(spec: &ArchetypeSpec) -> Self {
        ArchetypeFields {
            hd_texture_dist: spec.lod_dist.min(100.0),
            special_attribute: 0,
            texture_dictionary: None,
            time_flags: None,
        }
    }
}

const BASE_BYTES: usize = 144;
const TIMED_BYTES: usize = 160;

/// Сфера архетипа: центр и радиус.
pub type Sphere = ([f32; 3], f32);

fn archetype_node(spec: &ArchetypeSpec, fields: &ArchetypeFields, kept: Option<Sphere>) -> Node {
    let (lo, hi) = (spec.bb_min, spec.bb_max);
    // Сфера по рамке; готовая (`kept`) идёт как есть: так в типах остаются архетипы, которых запрос не трогает.
    let (centre, radius): Sphere = kept.unwrap_or_else(|| {
        let centre: [f32; 3] = std::array::from_fn(|i| (lo[i] + hi[i]) * 0.5);
        let [dx, dy, dz]: [f32; 3] = std::array::from_fn(|i| (hi[i] - centre[i]).powi(2));
        (centre, (dx + dy + dz).sqrt())
    });
    let name = name_hash(&spec.name);
    let clips = spec.clip_dictionary.as_deref().map_or(0, name_hash);
    let timed = fields.time_flags.is_some();
    let mut cells = vec![
        (carch::LOD_DIST, Cell::Float(spec.lod_dist)),
        (carch::FLAGS, Cell::Word(spec.flags)),
        (carch::SPECIAL, Cell::Word(fields.special_attribute)),
        (carch::BB_MIN, Cell::Triple(lo)),
        (carch::BB_MAX, Cell::Triple(hi)),
        (carch::CENTRE, Cell::Triple(centre)),
        (carch::RADIUS, Cell::Float(radius)),
        (carch::HD_DIST, Cell::Float(fields.hd_texture_dist)),
        (carch::NAME, Cell::Word(name)),
        (
            carch::TEXTURES,
            Cell::Word(fields.texture_dictionary.unwrap_or(name)),
        ),
        (carch::CLIPS, Cell::Word(clips)),
        (carch::ASSET_TYPE, Cell::Word(2)),
        (carch::ASSET_NAME, Cell::Word(name)),
    ];
    cells.extend(
        fields
            .time_flags
            .map(|time| (carch::TIME_FLAGS, Cell::Word(time))),
    );
    let mut bytes = vec![0u8; if timed { TIMED_BYTES } else { BASE_BYTES }];
    fill(&mut bytes, &cells);
    let kind = if timed {
        "CTimeArchetypeDef"
    } else {
        "CBaseArchetypeDef"
    };
    Node {
        block: meta_name(kind),
        bytes,
        links: Vec::new(),
    }
}

/// Узел массива указателей на `members`.
fn pointer_array(graph: &mut Graph, members: &[NodeId]) -> NodeId {
    let mut links = Vec::with_capacity(members.len());
    for (slot, &member) in members.iter().enumerate() {
        links.push(Link {
            at: slot * 8,
            target: Some(member),
        });
    }
    graph.push(Node {
        block: POINTER_BLOCK,
        bytes: vec![0u8; members.len() * 8],
        links,
    })
}

pub fn compile_archetype_types(
    types_name: &str,
    archetypes: &[ArchetypeSpec],
    fields: &[ArchetypeFields],
) -> Result<Vec<u8>> {
    compile_archetype_types_keeping(types_name, archetypes, fields, &vec![None; archetypes.len()])
}

/// То же, но у архетипа с `Some` сфера берётся готовая (центр и радиус как в исходном файле), а не считается по рамке.
pub fn compile_archetype_types_keeping(
    types_name: &str,
    archetypes: &[ArchetypeSpec],
    fields: &[ArchetypeFields],
    spheres: &[Option<Sphere>],
) -> Result<Vec<u8>> {
    argue(
        fields.len() == archetypes.len() && spheres.len() == archetypes.len(),
        "Placements fields must match the archetypes.",
    )?;
    argue(
        archetypes.len() <= MAX_COUNT,
        "Placements take at most 65535 archetypes.",
    )?;
    let timed = fields.iter().any(|f| f.time_flags.is_some());
    let template = template(if timed {
        Template::Rainbow
    } else {
        Template::Types
    })?;

    let mut root = template_root(template);
    let header = [
        (ctypes::COUNT, Cell::Pair(archetypes.len())),
        (ctypes::NAME, Cell::Word(meta_name(types_name))),
    ];
    fill(&mut root, &header);
    let mut graph = Graph::default();
    let root_id = graph.push(Node {
        block: meta_name("CMapTypes"),
        bytes: root,
        links: Vec::new(),
    });
    let mut members: Vec<NodeId> = Vec::with_capacity(archetypes.len());
    for ((spec, f), kept) in archetypes.iter().zip(fields).zip(spheres) {
        members.push(graph.push(archetype_node(spec, f, *kept)));
    }
    let list = pointer_array(&mut graph, &members);
    graph.nodes[root_id].links.push(Link {
        at: ctypes::LIST,
        target: Some(list),
    });

    if !timed {
        return meta_graph::write(&template.schema, &graph);
    }
    let structs = ["CMapTypes", "CBaseArchetypeDef", "CTimeArchetypeDef"].map(meta_name);
    meta_graph::write_with_structs(&template.schema, &graph, Some(&structs))
}

// ---------------------------------------------------------------------------------------------------------------
// Сущности карты
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct EntitySpec {
    pub archetype: usize,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub lod_dist: f32,
    pub flags: u32,
    pub guid: Option<u32>,
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub struct LodLink {
    pub parent_index: i32,
    pub lod_level: u32,
    pub num_children: u32,
    pub child_lod_dist: f32,
}

impl LodLink {
    /// Сущность без родителя и детей, уровень «сирота HD».
    pub fn orphan_hd() -> Self {
        const ORPHAN_LEVEL: u32 = 5;
        LodLink {
            lod_level: ORPHAN_LEVEL,
            num_children: 0,
            child_lod_dist: 0.0,
            parent_index: -1,
        }
    }
}

const ENTITY_BYTES: usize = 128;

/// 128 байт сущности `CEntityDef`.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn entity_bytes(
    map_name: &str,
    index: usize,
    archetype: &ArchetypeSpec,
    entity: &EntitySpec,
    link: &LodLink,
) -> Vec<u8> {
    entity_bytes_carried(map_name, index, archetype, entity, link, &PlaceCarry::NEW)
}

/// Поля места, которые собранное с нуля место не знает, а место исходной карты мода (залазы) несёт своими:
/// хост переносит их как есть.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlaceCarry {
    /// `scaleXY` и `scaleZ`.
    pub scale: [f32; 2],
    /// Хеш архетипа, которого нет в наших типах (чужой штатный архетип): идёт в запись вместо хеша `archetype`.
    pub archetype: Option<u32>,
    /// `priorityLevel`, `ambientOcclusionMultiplier`, `artificialAmbientOcclusion`, `tintValue`.
    pub priority: u32,
    pub ao_multiplier: u32,
    pub ao_artificial: u32,
    pub tint: u32,
}

impl PlaceCarry {
    /// Значения мест, которые собираем с нуля.
    pub const NEW: PlaceCarry = PlaceCarry { scale: [1.0, 1.0], archetype: None, priority: 0, ao_multiplier: 255, ao_artificial: 255, tint: 0 };
}

/// То же с полями, перенесёнными из исходной карты (см. `PlaceCarry`).
pub(crate) fn entity_bytes_carried(
    map_name: &str,
    index: usize,
    archetype: &ArchetypeSpec,
    entity: &EntitySpec,
    link: &LodLink,
    carry: &PlaceCarry,
) -> Vec<u8> {
    let [scale_xy, scale_z] = carry.scale;
    let guid = match entity.guid {
        Some(own) => own,
        None => meta_name(&format!("{map_name}/{}/{index}", archetype.name)),
    };
    let cells = [
        (cdef::ARCHETYPE, Cell::Word(carry.archetype.unwrap_or_else(|| name_hash(&archetype.name)))),
        (cdef::FLAGS, Cell::Word(entity.flags)),
        (cdef::GUID, Cell::Word(guid)),
        (cdef::POSITION, Cell::Triple(entity.position)),
        (cdef::ROTATION, Cell::Quad(entity.rotation)),
        (cdef::SCALE_XY, Cell::Float(scale_xy)),
        (cdef::SCALE_Z, Cell::Float(scale_z)),
        (cdef::PARENT, Cell::Word(link.parent_index as u32)),
        (cdef::LOD_DIST, Cell::Float(entity.lod_dist)),
        (cdef::CHILD_LOD, Cell::Float(link.child_lod_dist)),
        (cdef::LOD_LEVEL, Cell::Word(link.lod_level)),
        (cdef::NUM_CHILDREN, Cell::Word(link.num_children)),
        (cdef::PRIORITY, Cell::Word(carry.priority)),
        (cdef::AO_MULTIPLIER, Cell::Word(carry.ao_multiplier)),
        (cdef::AO_ARTIFICIAL, Cell::Word(carry.ao_artificial)),
        (cdef::TINT, Cell::Word(carry.tint)),
    ];
    let mut bytes = vec![0u8; ENTITY_BYTES];
    fill(&mut bytes, &cells);
    bytes
}

// ---------------------------------------------------------------------------------------------------------------
// Карта: рамки, заголовок, сборка
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct MapHeader {
    pub parent: u32,
    pub map_flags: u32,
    pub content_flags: u32,
    pub streaming: ([f32; 3], [f32; 3]),
    pub entities_extents: ([f32; 3], [f32; 3]),
}

/// Рамка потоковой подгрузки и рамка сущностей карты; первая неизвестная модель прерывает расчёт.
fn map_extents(archetypes: &[ArchetypeSpec], entities: &[EntitySpec]) -> Result<(Extent, Extent)> {
    let (mut streaming, mut placed) = (NO_EXTENT, NO_EXTENT);
    for e in entities {
        let a = archetypes
            .get(e.archetype)
            .ok_or_else(|| Error::argument("Сущность ссылается на неизвестный архетип."))?;
        let reach = if e.lod_dist <= 0.0 {
            a.lod_dist
        } else {
            e.lod_dist
        };
        let turn = invert(e.rotation);
        let wide = (a.bb_min.map(|v| v - reach), a.bb_max.map(|v| v + reach));
        streaming = streaming.grown(wide, turn, e.position);
        placed = placed.grown((a.bb_min, a.bb_max), turn, e.position);
    }
    Ok((streaming, placed))
}

fn string_node(text: &str) -> Node {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    Node {
        block: STRING_BLOCK,
        bytes,
        links: Vec::new(),
    }
}

const MAP_ROOT_BYTES: usize = 512;

/// Генераторы машин исходной карты (`CCarGen`): хост переносит их как есть, писатель карты своих не строит.
#[derive(Clone, Debug, PartialEq)]
pub struct CarGenerators {
    /// Описание структуры из схемы исходного файла: оно встанет в схему собранной карты.
    pub def: StructDef,
    /// Записи подряд, по `def.size` байт каждая.
    pub bytes: Vec<u8>,
}

impl CarGenerators {
    /// Число записей.
    pub fn count(&self) -> usize {
        self.bytes.len() / (self.def.size as usize).max(1)
    }
}

/// Сборка карты по шагам: что задано снаружи (связи, родитель, флаги или готовый заголовок), всё остальное
/// выводится при `emit`.
struct MapBuild<'a> {
    name: &'a str,
    archetypes: &'a [ArchetypeSpec],
    entities: &'a [EntitySpec],
    links: Option<&'a [LodLink]>,
    parent: Option<&'a str>,
    map_flags: u32,
    content_flags: u32,
    header: Option<&'a MapHeader>,
    /// Поля мест, перенесённые из исходной карты, по порядку сущностей; без них места как у собранных с нуля.
    carries: Option<&'a [PlaceCarry]>,
    /// Генераторы машин исходной карты; без них массив пуст.
    cars: Option<&'a CarGenerators>,
}

impl<'a> MapBuild<'a> {
    /// Карта HD без связей: все сущности — «сироты HD», бит «есть сущности HD».
    fn of(name: &'a str, archetypes: &'a [ArchetypeSpec], entities: &'a [EntitySpec]) -> Self {
        const HD_PRESENT: u32 = 1;
        MapBuild {
            name,
            archetypes,
            entities,
            links: None,
            parent: None,
            map_flags: 0,
            content_flags: HD_PRESENT,
            header: None,
            carries: None,
            cars: None,
        }
    }

    fn carrying(self, carries: &'a [PlaceCarry]) -> Self {
        MapBuild {
            carries: Some(carries),
            ..self
        }
    }

    fn with_cars(self, cars: Option<&'a CarGenerators>) -> Self {
        MapBuild { cars, ..self }
    }

    fn linked(self, links: &'a [LodLink]) -> Self {
        MapBuild {
            links: Some(links),
            ..self
        }
    }

    fn tagged(self, parent: Option<&'a str>, map_flags: u32, content_flags: u32) -> Self {
        MapBuild {
            parent,
            map_flags,
            content_flags,
            ..self
        }
    }

    fn headed(self, header: &'a MapHeader) -> Self {
        MapBuild {
            header: Some(header),
            ..self
        }
    }

    /// Заголовок: заданный как есть либо собранный из рамок и флагов.
    fn header(&self) -> Result<Cow<'a, MapHeader>> {
        if let Some(fixed) = self.header {
            return Ok(Cow::Borrowed(fixed));
        }
        let (streaming, placed) = map_extents(self.archetypes, self.entities)?;
        Ok(Cow::Owned(MapHeader {
            parent: self.parent.map_or(0, name_hash),
            map_flags: self.map_flags,
            content_flags: self.content_flags,
            streaming: (streaming.lo, streaming.hi),
            entities_extents: (placed.lo, placed.hi),
        }))
    }

    /// Ячейки корня карты: заголовок, число сущностей и длины трёх строк.
    fn root_cells(&self, header: &MapHeader, texts: &[(usize, &str)]) -> Vec<(usize, Cell)> {
        let mut cells = vec![
            (cmap::NAME, Cell::Word(meta_name(self.name))),
            (cmap::PARENT, Cell::Word(header.parent)),
            (cmap::FLAGS, Cell::Word(header.map_flags)),
            (cmap::CONTENT, Cell::Word(header.content_flags)),
            (cmap::STREAM_MIN, Cell::Triple(header.streaming.0)),
            (cmap::STREAM_MAX, Cell::Triple(header.streaming.1)),
            (cmap::EXTENT_MIN, Cell::Triple(header.entities_extents.0)),
            (cmap::EXTENT_MAX, Cell::Triple(header.entities_extents.1)),
            (cmap::ENTITY_COUNT, Cell::Pair(self.entities.len())),
        ];
        if let Some(cars) = self.cars {
            cells.push((cmap::CAR_GENERATORS + 8, Cell::Pair(cars.count())));
        }
        // длина строки и её ёмкость лежат через 8 байт от указателя
        for &(at, text) in texts {
            cells.push((at + 8, Cell::Pair(text.len())));
        }
        cells
    }

    fn emit(self, exported_by: &str, time: &str) -> Result<Vec<u8>> {
        let header = self.header()?;
        let links: Cow<[LodLink]> = match self.links {
            Some(given) => Cow::Borrowed(given),
            None => Cow::Owned(vec![LodLink::orphan_hd(); self.entities.len()]),
        };
        argue(
            links.len() == self.entities.len(),
            "Placements links must match the entities.",
        )?;
        argue(
            self.entities.len() <= MAX_COUNT,
            "Placements take at most 65535 entities.",
        )?;
        let texts = [
            (cmap::NAME_TEXT, self.name),
            (cmap::EXPORTER_TEXT, exported_by),
            (cmap::TIME_TEXT, time),
        ];
        argue(
            texts.iter().all(|(_, text)| text.len() <= MAX_COUNT),
            "Placements text is longer than 65535 bytes.",
        )?;
        argue(
            self.cars.map_or(0, CarGenerators::count) <= MAX_COUNT,
            "Placements take at most 65535 car generators.",
        )?;

        let template = template(Template::Map)?;
        let mut root = template_root(template);
        ensure(root.len() == MAP_ROOT_BYTES, "Шаблон карты повреждён.")?;
        let known = |entity: &EntitySpec| entity.archetype < self.archetypes.len();
        argue(
            self.entities.iter().all(known),
            "Сущность ссылается на неизвестный архетип.",
        )?;
        fill(&mut root, &self.root_cells(&header, &texts));

        let mut graph = Graph::default();
        let root_id = graph.push(Node {
            block: meta_name("CMapData"),
            bytes: root,
            links: Vec::new(),
        });
        if !self.entities.is_empty() {
            let block = meta_name("CEntityDef");
            let mut members: Vec<NodeId> = Vec::with_capacity(self.entities.len());
            for (index, (entity, link)) in self.entities.iter().zip(links.iter()).enumerate() {
                let archetype = &self.archetypes[entity.archetype];
                let carry = self.carries.and_then(|all| all.get(index)).unwrap_or(&PlaceCarry::NEW);
                let bytes = entity_bytes_carried(self.name, index, archetype, entity, link, carry);
                members.push(graph.push(Node {
                    block,
                    bytes,
                    links: Vec::new(),
                }));
            }
            let list = pointer_array(&mut graph, &members);
            graph.nodes[root_id].links.push(Link {
                at: cmap::ENTITIES,
                target: Some(list),
            });
        }
        let cars = self.cars.filter(|cars| cars.count() > 0);
        if let Some(cars) = cars {
            let target = Some(graph.push(Node {
                block: cars.def.name,
                bytes: cars.bytes.clone(),
                links: Vec::new(),
            }));
            graph.nodes[root_id].links.push(Link {
                at: cmap::CAR_GENERATORS,
                target,
            });
        }
        for &(at, text) in &texts {
            let target = Some(graph.push(string_node(text)));
            graph.nodes[root_id].links.push(Link { at, target });
        }

        // Схема шаблона; структура генераторов машин, если они есть, встаёт в конец списка, как у хоста.
        let mut schema: Cow<Schema> = Cow::Borrowed(&template.schema);
        let mut structs: Vec<u32> = template.schema.structs.iter().map(|d| d.name).collect();
        if let Some(cars) = cars.filter(|cars| !structs.contains(&cars.def.name)) {
            schema.to_mut().structs.push(cars.def.clone());
            structs.push(cars.def.name);
        }
        meta_graph::write_with_structs(&schema, &graph, Some(&structs))
    }
}

pub fn compile_map(
    map_name: &str,
    archetypes: &[ArchetypeSpec],
    entities: &[EntitySpec],
    exported_by: &str,
    time: &str,
) -> Result<Vec<u8>> {
    MapBuild::of(map_name, archetypes, entities).emit(exported_by, time)
}

#[allow(clippy::too_many_arguments)]
pub fn compile_map_linked(
    map_name: &str,
    archetypes: &[ArchetypeSpec],
    entities: &[EntitySpec],
    links: &[LodLink],
    parent: Option<&str>,
    map_flags: u32,
    content_flags: u32,
    exported_by: &str,
    time: &str,
) -> Result<Vec<u8>> {
    let build = MapBuild::of(map_name, archetypes, entities);
    let build = build.linked(links).tagged(parent, map_flags, content_flags);
    build.emit(exported_by, time)
}

pub fn compile_map_header(
    map_name: &str,
    archetypes: &[ArchetypeSpec],
    entities: &[EntitySpec],
    links: &[LodLink],
    header: &MapHeader,
    exported_by: &str,
    time: &str,
) -> Result<Vec<u8>> {
    let build = MapBuild::of(map_name, archetypes, entities);
    build.linked(links).headed(header).emit(exported_by, time)
}

/// То же, но места несут поля исходной карты (`carries[i]` — места `i`): у карты мода есть масштаб, приоритет и чужие архетипы;
/// `cars` — генераторы машин исходной карты, которые хост сохраняет (`None` — их нет).
#[allow(clippy::too_many_arguments)]
pub fn compile_map_header_carried(
    map_name: &str,
    archetypes: &[ArchetypeSpec],
    entities: &[EntitySpec],
    links: &[LodLink],
    carries: &[PlaceCarry],
    cars: Option<&CarGenerators>,
    header: &MapHeader,
    exported_by: &str,
    time: &str,
) -> Result<Vec<u8>> {
    let build = MapBuild::of(map_name, archetypes, entities);
    build
        .linked(links)
        .headed(header)
        .carrying(carries)
        .with_cars(cars)
        .emit(exported_by, time)
}

// ---------------------------------------------------------------------------------------------------------------
// Готовые наборы: типы, карта, манифест
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct Compiled {
    pub types: Vec<u8>,
    pub map: Vec<u8>,
}

fn need_both(archetypes: &[ArchetypeSpec], entities: &[EntitySpec]) -> Result<()> {
    let both = !archetypes.is_empty() && !entities.is_empty();
    argue(both, "Placements need archetypes and entities.")
}

pub fn compile(
    types_name: &str,
    map_name: &str,
    archetypes: &[ArchetypeSpec],
    entities: &[EntitySpec],
    exported_by: &str,
    time: &str,
) -> Result<Compiled> {
    need_both(archetypes, entities)?;
    let fields: Vec<ArchetypeFields> = archetypes.iter().map(ArchetypeFields::plain).collect();
    compile_copied(
        types_name,
        map_name,
        archetypes,
        &fields,
        entities,
        exported_by,
        time,
    )
}

/// Типы и карта вместе; оба файла тут же открываются заново и сверяются с запросом.
pub fn compile_copied(
    types_name: &str,
    map_name: &str,
    archetypes: &[ArchetypeSpec],
    fields: &[ArchetypeFields],
    entities: &[EntitySpec],
    exported_by: &str,
    time: &str,
) -> Result<Compiled> {
    need_both(archetypes, entities)?;
    let types = compile_archetype_types(types_name, archetypes, fields)?;
    let dictionary = mlo::read_ytyp(&meta_graph::read(&types)?)?;
    let same_types = dictionary.archetypes.len() == archetypes.len();
    ensure(
        same_types,
        "Compiled placements .ytyp failed semantic reopen.",
    )?;

    let map = compile_map(map_name, archetypes, entities, exported_by, time)?;
    let reopened = mlo::read_ymap(&meta_graph::read(&map)?)?;
    let same_map = reopened.entities.len() == entities.len();
    ensure(
        same_map,
        "Compiled placements .ymap failed semantic reopen.",
    )?;
    let off = |a: f32, b: f32| (a - b).abs() > 0.01;
    let moved = entities.iter().zip(&reopened.entities).any(|(spec, got)| {
        let wanted = name_hash(&archetypes[spec.archetype].name);
        let shifts = [
            (got.position[0], spec.position[0]),
            (got.position[1], spec.position[1]),
            (got.lod_dist, spec.lod_dist),
        ];
        got.archetype_hash != wanted || shifts.iter().any(|&(a, b)| off(a, b))
    });
    ensure(!moved, "Compiled placements .ymap moved an entity.")?;
    Ok(Compiled { types, map })
}

/// Манифест с одной связью «карта → типы».
pub fn manifest(types_name: &str, map_name: &str) -> Result<Vec<u8>> {
    let link = Dependency {
        map: map_name.to_string(),
        types: vec![types_name.to_string()],
    };
    manifest_write::fresh(&[link])
}

// ---------------------------------------------------------------------------------------------------------------
// Чтение карты по фиксированным смещениям
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct SourceEntity {
    pub archetype: u32,
    pub id: u32,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub lod_dist: f32,
    pub flags: u32,
    pub scale_xy: f32,
    pub scale_z: f32,
}

impl SourceEntity {
    fn parse(b: &[u8]) -> Self {
        SourceEntity {
            archetype: word_at(b, cdef::ARCHETYPE),
            id: word_at(b, cdef::GUID),
            position: floats_at(b, cdef::POSITION),
            rotation: floats_at(b, cdef::ROTATION),
            lod_dist: float_at(b, cdef::LOD_DIST),
            flags: word_at(b, cdef::FLAGS),
            scale_xy: float_at(b, cdef::SCALE_XY),
            scale_z: float_at(b, cdef::SCALE_Z),
        }
    }
}

pub struct EntityRead {
    pub archetype: u32,
    pub flags: u32,
    pub guid: u32,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub scale_xy: f32,
    pub scale_z: f32,
    pub parent_index: i32,
    pub lod_dist: f32,
    pub child_lod_dist: f32,
    pub lod_level: u32,
    pub priority_level: u32,
    /// Экземпляр помещения (`CMloInstanceDef`): у хоста такая запись — `isMlo`, поворот выводится без обращения.
    pub mlo: bool,
}

impl EntityRead {
    fn parse(b: &[u8], mlo: bool) -> Self {
        EntityRead {
            mlo,
            archetype: word_at(b, cdef::ARCHETYPE),
            flags: word_at(b, cdef::FLAGS),
            guid: word_at(b, cdef::GUID),
            position: floats_at(b, cdef::POSITION),
            rotation: floats_at(b, cdef::ROTATION),
            scale_xy: float_at(b, cdef::SCALE_XY),
            scale_z: float_at(b, cdef::SCALE_Z),
            parent_index: int_at(b, cdef::PARENT),
            lod_dist: float_at(b, cdef::LOD_DIST),
            child_lod_dist: float_at(b, cdef::CHILD_LOD),
            lod_level: word_at(b, cdef::LOD_LEVEL),
            priority_level: word_at(b, cdef::PRIORITY),
        }
    }
}

pub struct MapRead {
    pub name: u32,
    pub parent: u32,
    pub flags: u32,
    pub content_flags: u32,
    pub streaming: ([f32; 3], [f32; 3]),
    pub entities_extents: ([f32; 3], [f32; 3]),
    pub entities: Vec<EntityRead>,
}

/// Разобранный файл карты и доступ к узлам-сущностям.
struct MapFile(Read);

impl MapFile {
    fn open(bytes: &[u8]) -> Option<Self> {
        meta_graph::read(bytes).ok().map(MapFile)
    }

    fn root(&self) -> Option<&Node> {
        self.0.graph.nodes.get(self.0.graph.root)
    }

    /// Байты узлов-сущностей в порядке ссылок массива; `None` — карта не читается (пустая цель ссылки, узел
    /// короче 128 байт). Нет массива — сущностей ноль.
    fn rows(&self) -> Option<Vec<&Node>> {
        let nodes = &self.0.graph.nodes;
        let listed = self
            .root()?
            .links
            .iter()
            .find(|l| l.at == cmap::ENTITIES)
            .and_then(|l| l.target);
        let Some(array) = listed else {
            return Some(Vec::new());
        };
        let mut rows = Vec::new();
        for link in &nodes.get(array)?.links {
            let node = nodes.get(link.target?)?;
            if node.bytes.len() < ENTITY_BYTES {
                return None;
            }
            rows.push(node);
        }
        Some(rows)
    }
}

pub fn read_map(bytes: &[u8]) -> Result<MapRead> {
    let parsed = MapFile::open(bytes).and_then(|file| {
        let root = file.root()?.bytes.as_slice();
        if root.len() < MAP_ROOT_BYTES {
            return None;
        }
        let rows = file.rows()?;
        Some(MapRead {
            name: word_at(root, cmap::NAME),
            parent: word_at(root, cmap::PARENT),
            flags: word_at(root, cmap::FLAGS),
            content_flags: word_at(root, cmap::CONTENT),
            streaming: (
                floats_at(root, cmap::STREAM_MIN),
                floats_at(root, cmap::STREAM_MAX),
            ),
            entities_extents: (
                floats_at(root, cmap::EXTENT_MIN),
                floats_at(root, cmap::EXTENT_MAX),
            ),
            entities: rows.into_iter().map(|node| EntityRead::parse(&node.bytes, node.block == meta_name("CMloInstanceDef"))).collect(),
        })
    });
    parsed.ok_or_else(|| Error::broken("Карта .ymap не читается."))
}

pub fn read_entities(bytes: &[u8]) -> Result<Vec<SourceEntity>> {
    let parsed = MapFile::open(bytes).and_then(|file| {
        let rows = file.rows()?;
        Some(
            rows.into_iter()
                .map(|node| SourceEntity::parse(&node.bytes))
                .collect::<Vec<_>>(),
        )
    });
    match parsed {
        Some(entities) => Ok(entities),
        None => Err(Error::broken("Исходная карта прострела не читается.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::Resource;
    use std::f32::consts::FRAC_1_SQRT_2;

    const EXPORTED_BY: &str = "Astral Placements 1";
    const EXPORTED_AT: &str = "01 January 1970 00:00";
    const UPRIGHT: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

    fn spec(
        name: &str,
        lod: f32,
        lo: [f32; 3],
        hi: [f32; 3],
        flags: u32,
        clip: Option<&str>,
    ) -> ArchetypeSpec {
        ArchetypeSpec {
            clip_dictionary: clip.map(str::to_string),
            name: name.into(),
            lod_dist: lod,
            bb_min: lo,
            bb_max: hi,
            flags,
        }
    }

    fn put(
        archetype: usize,
        position: [f32; 3],
        rotation: [f32; 4],
        lod: f32,
        flags: u32,
    ) -> EntitySpec {
        EntitySpec {
            guid: None,
            archetype,
            position,
            rotation,
            lod_dist: lod,
            flags,
        }
    }

    /// Сущность без поворота.
    fn upright(archetype: usize, position: [f32; 3], lod: f32, flags: u32) -> EntitySpec {
        put(archetype, position, UPRIGHT, lod, flags)
    }

    /// Единичный ящик с этим именем: расстояние 100, без флагов и клипов.
    fn unit_box(name: &str) -> ArchetypeSpec {
        spec(name, 100.0, [0.0; 3], [1.0; 3], 0, None)
    }

    /// Поля архетипа «как есть».
    fn plain_fields() -> ArchetypeFields {
        ArchetypeFields {
            special_attribute: 0,
            hd_texture_dist: 100.0,
            texture_dictionary: None,
            time_flags: None,
        }
    }

    /// Текст отказа; успех — провал теста.
    fn complaint<T>(result: Result<T>) -> String {
        match result {
            Err(error) => error.message,
            Ok(_) => panic!("ожидался отказ"),
        }
    }

    fn body(file: &[u8]) -> Vec<u8> {
        Resource::parse(file).expect("ресурс RSC7").data().to_vec()
    }

    /// Тела наших файлов равны телам выгрузки хоста.
    fn matches_host(out: &Compiled, host_types: &[u8], host_map: &[u8]) {
        assert_eq!(body(&out.types), body(host_types));
        assert_eq!(body(&out.map), body(host_map));
    }

    /// Первый образец запроса: два архетипа и три сущности.
    fn sample_request() -> ([ArchetypeSpec; 2], [EntitySpec; 3]) {
        let archetypes = [
            spec(
                "pl_crate",
                150.0,
                [-1.0, -2.0, 0.0],
                [1.0, 2.0, 3.0],
                0,
                None,
            ),
            spec(
                "pl_lamp",
                200.0,
                [-0.5, -0.5, 0.0],
                [0.5, 0.5, 6.0],
                32,
                Some("pl_clip"),
            ),
        ];
        let entities = [
            upright(0, [10.0, 20.0, 5.0], 300.0, 32),
            upright(1, [-40.5, 3.25, 12.0], 250.0, 32),
            put(
                0,
                [100.0, -50.0, 7.5],
                [0.0, FRAC_1_SQRT_2, 0.0, FRAC_1_SQRT_2],
                120.0,
                32,
            ),
        ];
        (archetypes, entities)
    }

    #[test]
    fn the_sample_request_is_the_hosts_bytes() {
        let (archetypes, entities) = sample_request();
        let out = compile(
            "pl_types",
            "pl_map",
            &archetypes,
            &entities,
            EXPORTED_BY,
            EXPORTED_AT,
        )
        .unwrap();
        matches_host(
            &out,
            include_bytes!("../../../parity/host-port/placements/sample-types.ytyp"),
            include_bytes!("../../../parity/host-port/placements/sample-map.ymap"),
        );
    }

    #[test]
    fn the_second_request_is_the_hosts_bytes() {
        let archetypes = [spec(
            "pq_wall_piece",
            75.5,
            [-8.0, -0.25, 0.0],
            [8.0, 0.25, 2.75],
            8,
            None,
        )];
        let entities = [
            upright(0, [-1500.125, 250.0, -3.0], 400.0, 32),
            put(
                0,
                [0.5, 0.5, 0.5],
                [0.382_683_4, 0.0, 0.0, 0.923_879_5],
                60.0,
                0,
            ),
            upright(0, [12.0, -7.0, 1.0], 200.0, 32),
        ];
        let out = compile(
            "pq_types_b",
            "pq_map_longer_name",
            &archetypes,
            &entities,
            EXPORTED_BY,
            EXPORTED_AT,
        )
        .unwrap();
        matches_host(
            &out,
            include_bytes!("../../../parity/host-port/placements/second-types.ytyp"),
            include_bytes!("../../../parity/host-port/placements/second-map.ymap"),
        );
    }

    #[test]
    fn the_manifest_is_one_link_to_the_types() {
        let host = include_bytes!("../../../parity/host-port/placements/sample-manifest.ymf");
        assert_eq!(manifest("pl_types", "pl_map").unwrap(), host.to_vec());
    }

    #[test]
    fn an_entity_of_an_unknown_archetype_is_refused() {
        let far = upright(3, [0.0; 3], 100.0, 32);
        let refused = compile("t", "m", &[unit_box("a")], &[far], "x", "y");
        assert_eq!(
            complaint(refused),
            "Сущность ссылается на неизвестный архетип."
        );
    }

    #[test]
    fn name_hash_takes_a_hash_literal_or_hashes_the_whole_string() {
        assert_eq!(name_hash("#0000abcd"), 0xabcd);
        assert_eq!(name_hash("#+1f"), 31);
        assert_eq!(name_hash("#FFFFFFFF"), u32::MAX);
        for plain in ["#", "#-1", "#100000000", "#１２", "Pl_Crate"] {
            assert_eq!(name_hash(plain), meta_name(plain));
        }
    }

    #[test]
    fn invert_keeps_the_identity_bits_and_negates_the_vector_part() {
        let id = [-0.0, -0.0, -0.0, 1.0];
        assert_eq!(invert(id).map(f32::to_bits), id.map(f32::to_bits));
        assert_eq!(invert([0.5; 4]), [-0.5, -0.5, -0.5, 0.5]);
        assert_eq!(
            invert([0.0, 0.0, 0.0, 2.0]).map(f32::to_bits),
            [0x8000_0000, 0x8000_0000, 0x8000_0000, 0x3f00_0000]
        );
        assert!(invert([0.0; 4]).iter().all(|v| v.is_nan()));
    }

    #[test]
    fn extents_follow_the_rotation_and_skip_nan_points() {
        let a = spec(
            "pl_crate",
            150.0,
            [-1.0, -2.0, 0.0],
            [1.0, 2.0, 3.0],
            0,
            None,
        );
        let turn = [0.0, 0.0, FRAC_1_SQRT_2, FRAC_1_SQRT_2];
        let turned = put(0, [10.0, 20.0, 5.0], turn, 300.0, 32);
        let bytes = compile_map("rot", std::slice::from_ref(&a), &[turned], "x", "y").unwrap();
        let map = read_map(&bytes).unwrap();
        assert_eq!(map.entities_extents.1[2], 8.0);
        assert_eq!(map.entities_extents.0[0], 7.999_999_5);
        let lost = upright(0, [f32::NAN; 3], 100.0, 32);
        let nan = compile_map("nan", &[a], &[lost], "x", "y").unwrap();
        let map = read_map(&nan).unwrap();
        assert_eq!(map.entities_extents.0, [f32::MAX; 3]);
        assert_eq!(map.entities_extents.1, [f32::MIN; 3]);
    }

    #[test]
    fn linked_maps_check_links_after_the_archetypes() {
        let a = unit_box("a");
        let e = upright(0, [0.0; 3], 100.0, 32);
        let one = std::slice::from_ref(&e);
        let short = compile_map_linked(
            "m",
            std::slice::from_ref(&a),
            one,
            &[],
            None,
            0,
            1,
            "x",
            "y",
        );
        assert_eq!(
            complaint(short),
            "Placements links must match the entities."
        );
        let both = compile_map_linked("m", &[], &[e], &[], None, 0, 1, "x", "y");
        assert_eq!(
            complaint(both),
            "Сущность ссылается на неизвестный архетип."
        );
    }

    #[test]
    fn a_linked_map_keeps_parent_levels_and_default_guids() {
        let ents = [
            upright(0, [1.0, 2.0, 3.0], 100.0, 32),
            upright(0, [4.0, 5.0, 6.0], 200.0, 32),
        ];
        let links = [
            LodLink {
                parent_index: 1,
                lod_level: LOD_HD,
                num_children: 0,
                child_lod_dist: 0.0,
            },
            LodLink {
                parent_index: -1,
                lod_level: LOD_LOD,
                num_children: 1,
                child_lod_dist: 150.5,
            },
        ];
        let bytes = compile_map_linked(
            "hd",
            &[spec("box", 100.0, [0.0; 3], [1.0; 3], 0, None)],
            &ents,
            &links,
            Some("#00000042"),
            2,
            3,
            "Astral",
            "t",
        )
        .unwrap();
        let map = read_map(&bytes).unwrap();
        assert_eq!((map.parent, map.flags, map.content_flags), (0x42, 2, 3));
        assert_eq!(map.entities[0].parent_index, 1);
        assert_eq!(map.entities[1].lod_level, LOD_LOD);
        assert_eq!(map.entities[1].child_lod_dist, 150.5);
        assert_eq!(map.entities[1].guid, meta_name("hd/box/1"));
    }

    #[test]
    fn a_header_map_takes_the_header_as_is_and_refuses_a_bad_archetype_index() {
        let a = spec("box", 100.0, [0.0; 3], [1.0; 3], 0, None);
        let header = MapHeader {
            parent: 0x1122_3344,
            map_flags: 0xAABB_CCDD,
            content_flags: 0x0102_0304,
            streaming: ([-1.0, -2.0, -3.0], [4.0, 5.0, 6.0]),
            entities_extents: ([7.0, 8.0, 9.0], [10.0, 11.0, 12.0]),
        };
        let orphan = [LodLink::orphan_hd()];
        let e = upright(0, [1.0, 2.0, 3.0], 100.0, 32);
        let bytes = compile_map_header(
            "hdr",
            std::slice::from_ref(&a),
            &[e],
            &orphan,
            &header,
            "A",
            "t",
        )
        .unwrap();
        let map = read_map(&bytes).unwrap();
        assert_eq!(map.parent, 0x1122_3344);
        assert_eq!(map.streaming, header.streaming);
        assert_eq!(map.entities_extents, header.entities_extents);
        let bad = upright(5, [0.0; 3], 100.0, 32);
        let refused = compile_map_header("hdr", &[a], &[bad], &orphan, &header, "A", "t");
        assert_eq!(
            complaint(refused),
            "Сущность ссылается на неизвестный архетип."
        );
    }

    #[test]
    fn counts_that_do_not_fit_sixteen_bits_are_refused_not_truncated() {
        let a = unit_box("box");
        let e = upright(0, [0.0; 3], 100.0, 0);
        let many_entities = vec![e; 65_536];
        let refused = compile_map("m", std::slice::from_ref(&a), &many_entities, "x", "y");
        assert_eq!(
            complaint(refused),
            "Placements take at most 65535 entities."
        );
        let many_archetypes = vec![a.clone(); 65_536];
        let fields = vec![plain_fields(); 65_536];
        let refused = compile_archetype_types("t", &many_archetypes, &fields);
        assert_eq!(
            complaint(refused),
            "Placements take at most 65535 archetypes."
        );
        let long = "n".repeat(65_536);
        let one = upright(0, [0.0; 3], 100.0, 0);
        let refused = compile_map(&long, std::slice::from_ref(&a), &[one], "x", "y");
        assert_eq!(
            complaint(refused),
            "Placements text is longer than 65535 bytes."
        );
        let single = [upright(0, [0.0; 3], 100.0, 0)];
        let refused = compile_copied("t", "m", &many_archetypes, &fields, &single, "x", "y");
        assert_eq!(
            complaint(refused),
            "Placements take at most 65535 archetypes."
        );
    }

    /// 16.11.2026: карты помещений игры (`*_milo_*.ymap`) хранят `CMloInstanceDef`; хост называет такую запись `isMlo`.
    /// С файлом игры: `MLO_YMAP=<путь к *_milo_*.ymap>`; без переменной тест выходит сразу.
    #[test]
    fn instances_of_interiors_are_marked_in_a_real_map() {
        let Ok(path) = std::env::var("MLO_YMAP") else { return };
        let map = read_map(&std::fs::read(path).unwrap()).unwrap();
        assert!(!map.entities.is_empty());
        assert!(map.entities.iter().all(|entity| entity.mlo), "в карте помещения все записи — экземпляры");
    }

    #[test]
    fn entity_bytes_are_the_nodes_of_the_compiled_map() {
        let a = unit_box("box");
        let e = put(0, [1.0, 2.0, 3.0], [-0.0, -0.0, -0.0, 1.0], 100.0, 32);
        let bytes = compile_map(
            "m",
            std::slice::from_ref(&a),
            std::slice::from_ref(&e),
            "x",
            "y",
        )
        .unwrap();
        let read = meta_graph::read(&bytes).unwrap();
        let block = meta_name("CEntityDef");
        let node = read.graph.nodes.iter().find(|n| n.block == block).unwrap();
        assert_eq!(
            node.bytes,
            entity_bytes("m", 0, &a, &e, &LodLink::orphan_hd())
        );
    }

    #[test]
    fn read_map_refuses_what_is_not_a_map_while_read_entities_is_lenient() {
        let types = compile_archetype_types("t", &[unit_box("box")], &[plain_fields()]).unwrap();
        let not_map = "Карта .ymap не читается.";
        assert_eq!(complaint(read_map(&types)), not_map);
        assert!(read_entities(&types).unwrap().is_empty());
        assert_eq!(
            complaint(read_entities(&[1, 2, 3])),
            "Исходная карта прострела не читается."
        );
        assert_eq!(complaint(read_map(&[])), not_map);
    }

    #[test]
    fn the_largest_countable_map_compiles_and_one_more_is_refused() {
        let a = unit_box("same");
        let list: Vec<EntitySpec> = (0..65_536)
            .map(|i| upright(0, [i as f32, 0.0, 0.0], 100.0, 32))
            .collect();
        let bytes =
            compile_map("big", std::slice::from_ref(&a), &list[..65_535], "x", "y").unwrap();
        let read = meta_graph::read(&bytes).unwrap();
        let root = &read.graph.nodes[read.graph.root].bytes;
        assert_eq!(&root[104..108], &[255, 255, 255, 255]);
        let refused = compile_copied("big", "big_map", &[a], &[plain_fields()], &list, "x", "y");
        assert_eq!(
            complaint(refused),
            "Placements take at most 65535 entities."
        );
    }

    #[test]
    fn copied_fields_are_checked_before_the_request() {
        let a = unit_box("a");
        let e = upright(0, [0.0; 3], 100.0, 32);
        let one = std::slice::from_ref(&e);
        let empty_types = compile_copied("t", "m", &[], &[], one, "x", "y");
        assert_eq!(
            complaint(empty_types),
            "Placements need archetypes and entities."
        );
        let no_fields = compile_copied("t", "m", std::slice::from_ref(&a), &[], one, "x", "y");
        assert_eq!(
            complaint(no_fields),
            "Placements fields must match the archetypes."
        );
        let no_entities = compile("t", "m", &[a], &[], "x", "y");
        assert_eq!(
            complaint(no_entities),
            "Placements need archetypes and entities."
        );
    }

    /// Пишет `ours-types.ytyp` и `ours-map.ymap` образца 1 в папку из `PL_OUT` для ручной сверки с хостом.
    #[test]
    #[ignore]
    fn write_placement_check() {
        let Ok(dir) = std::env::var("PL_OUT") else {
            return;
        };
        let (archetypes, entities) = sample_request();
        let out = compile(
            "pl_types",
            "pl_map",
            &archetypes,
            &entities,
            EXPORTED_BY,
            EXPORTED_AT,
        )
        .unwrap();
        let target = std::path::Path::new(&dir);
        std::fs::write(target.join("ours-types.ytyp"), &out.types).unwrap();
        std::fs::write(target.join("ours-map.ymap"), &out.map).unwrap();
    }

    // --- чтение запроса хоста (JSON) маленькими помощниками

    fn json_num(v: &serde_json::Value) -> f32 {
        v.as_f64().unwrap_or(0.0) as f32
    }

    fn json_text(v: &serde_json::Value) -> Option<String> {
        v.as_str().map(str::to_string)
    }

    fn json_floats<const N: usize>(v: &serde_json::Value) -> [f32; N] {
        std::array::from_fn(|i| json_num(&v[i]))
    }

    fn json_list<T>(v: &serde_json::Value, each: impl Fn(&serde_json::Value) -> T) -> Vec<T> {
        v.as_array()
            .map_or_else(Vec::new, |items| items.iter().map(each).collect())
    }

    fn request_archetypes(json: &serde_json::Value) -> Vec<ArchetypeSpec> {
        json_list(&json["archetypes"], |a| ArchetypeSpec {
            name: json_text(&a["name"]).unwrap_or_default(),
            lod_dist: json_num(&a["lodDist"]),
            bb_min: json_floats(&a["bbMin"]),
            bb_max: json_floats(&a["bbMax"]),
            flags: a["flags"].as_u64().unwrap_or(0) as u32,
            clip_dictionary: json_text(&a["clipDictionary"]),
        })
    }

    fn request_entities(json: &serde_json::Value, archetypes: &[ArchetypeSpec]) -> Vec<EntitySpec> {
        json_list(&json["entities"], |e| {
            let wanted = json_text(&e["archetype"]).unwrap_or_default();
            let rotation = if e["rotation"].is_array() {
                json_floats(&e["rotation"])
            } else {
                UPRIGHT
            };
            EntitySpec {
                archetype: archetypes
                    .iter()
                    .position(|a| a.name == wanted)
                    .unwrap_or(0),
                position: json_floats(&e["position"]),
                rotation,
                lod_dist: json_num(&e["lodDist"]),
                flags: e["flags"].as_u64().unwrap_or(0) as u32,
                guid: None,
            }
        })
    }

    /// Наибольшее расхождение рамок нашей карты и выгрузки хоста по запросу `reqNN.json`; нет файла — `None`.
    fn gap_to_host(dir: &std::path::Path, n: usize) -> Option<f32> {
        let text = std::fs::read_to_string(dir.join(format!("req{n:02}.json"))).ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).expect("запрос");
        let types = json["types"].as_str().unwrap_or("t");
        let map_name = json["map"].as_str().unwrap_or("m");
        let archetypes = request_archetypes(&json);
        let entities = request_entities(&json, &archetypes);
        let ours = compile(
            types,
            map_name,
            &archetypes,
            &entities,
            EXPORTED_BY,
            EXPORTED_AT,
        )
        .unwrap();
        let out_dir = dir.join(format!("req{n:02}-out"));
        let host_bytes = std::fs::read(out_dir.join(format!("{map_name}.ymap"))).ok()?;
        let ours_map = mlo::read_ymap(&meta_graph::read(&ours.map).unwrap()).unwrap();
        let host_map = mlo::read_ymap(&meta_graph::read(&host_bytes).unwrap()).unwrap();
        assert_eq!(
            ours_map.entities.len(),
            host_map.entities.len(),
            "запрос {n}"
        );
        let pairs = [
            (ours_map.streaming_min, host_map.streaming_min),
            (ours_map.streaming_max, host_map.streaming_max),
            (ours_map.entities_min, host_map.entities_min),
            (ours_map.entities_max, host_map.entities_max),
        ];
        let gaps = pairs
            .iter()
            .flat_map(|(a, b)| (0..3).map(|i| (a[i] - b[i]).abs()));
        Some(gaps.fold(0.0, f32::max))
    }

    /// Папка `PROBE_DIR` с запросами `reqNN.json` и выгрузками хоста `reqNN-out/<карта>.ymap`: сравнивает рамки
    /// и печатает наибольшее расхождение.
    #[test]
    #[ignore]
    fn streaming_extents_match_host_on_rotations() {
        let Ok(dir) = std::env::var("PROBE_DIR") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let worst = (0..30)
            .filter_map(|n| gap_to_host(&dir, n))
            .fold(0.0f32, f32::max);
        println!("наибольшее расхождение рамок: {worst}");
    }

    /// Переменная `EMBLEM_PROBE` — папка: пишет `types.ytyp`, `map.ymap`, `manifest.ymf` одной плашки `emb_test`.
    #[test]
    #[ignore]
    fn probe_emblem_near() {
        let Ok(dir) = std::env::var("EMBLEM_PROBE") else {
            return;
        };
        let plate = spec(
            "emb_test",
            100.0,
            [-0.5, -0.01, -0.25],
            [0.5, 0.01, 0.25],
            32,
            None,
        );
        let mut entity = upright(0, [10.0, 0.0, 20.0], 100.0, 32);
        entity.guid = Some(crate::hash::joaat("emb_map/emb_test"));
        let out = compile(
            "emb_types",
            "emb_map",
            &[plate],
            &[entity],
            EXPORTED_BY,
            EXPORTED_AT,
        )
        .unwrap();
        let dir = std::path::PathBuf::from(dir);
        std::fs::write(dir.join("types.ytyp"), &out.types).unwrap();
        std::fs::write(dir.join("map.ymap"), &out.map).unwrap();
        std::fs::write(
            dir.join("manifest.ymf"),
            manifest("emb_types", "emb_map").unwrap(),
        )
        .unwrap();
    }
}
