//! `lamp-pole`: переделка столба уличного фонаря (фрагмент `.yft`) по запросу мастерской.
//!
//! Работа идёт над графом блоков RSC7 (`resource_graph`): листы краски `astral_pole_*` вписываются в словарь
//! текстур модели, у выбранных шейдеров корпуса меняются сэмплер цвета, пресет, блеск или раскладка параметров,
//! а «украшение» добавляет новые геометрии в модели уровней high/medium/low. Новые блоки дописываются в конец
//! областей, поэтому порядок их создания определяет раскладку итогового файла.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use rage_res::resource::{Resource, VERSION_FRAGMENT};
use rage_res::resource_graph::{self as rg, Address, Graph, Segment, Slot};
use rage_res::ytd_write::{self, NewTexture};
use rage_res::{dds, hash, meta_graph};
use serde_json::{Map, Value};

use super::fresh_dirs::FreshDirs;
use super::{graft, restyle_model, shop, split, split_heads, Command};
use crate::args::Options;
use crate::error::{EngineError, Result};
use crate::paths;
use crate::progress::Progress;

// ================================================================ отказы

/// Отказы самой команды (чужие приходят от соседей как есть): все тексты собраны в одном месте.
enum Fail {
    ModelSize,
    NotFragment,
    Present(String),
    Reopen,
    RequestSize,
    RequestBroken,
    RequestFormat,
    TooManySheets,
    SheetNamesTwice,
    Nothing,
    SheetName,
    DdsFile(String),
    DdsSum(String),
    DdsFormat(String),
    DdsSides(String),
    ShaderNumber,
    ShineNumber,
    PartKind,
    PartArrays,
    PartIndex,
    PartTriangles,
    PartRange,
    NotNumbers(&'static str),
    NotMultiple(&'static str, usize),
    DecoSheet,
    DecoGlow,
    DecoBone,
    DecoParts,
    PartTwice,
    DecoVertices,
    NoRoot,
    NoDrawable,
    NoGroup,
    NoSheetObject(String),
    NoDictionary,
    NoSample,
    ShaderIndex,
    SwapUnknown(String),
    PresetUnknown(String),
    SheetUnnamed(String),
    NoDiffuse,
    ShineRange,
    NoShaders,
    NoSampleGeometry,
    NoVertexBuffer,
    NoIndexBuffer,
    TemplatePointer,
    EmptyLevelModel,
    NoPalette,
    NoParams,
    ParamsOverflow,
    TextureNoTarget,
    NoParam(&'static str),
    VectorOutside,
    BoneOutside,
}

impl Fail {
    fn text(&self) -> String {
        use Fail::*;
        match self {
            ModelSize => "lamp-pole: модель пустая или больше 16 МБ.".to_owned(),
            NotFragment => "lamp-pole: модель — фрагмент .yft.".to_owned(),
            Present(name) => format!("lamp-pole: у модели уже есть текстура {name}."),
            Reopen => "lamp-pole: после сборки скелет или листы другие.".to_owned(),
            RequestSize => "lamp-pole: запрос от 1 байта до 24 МБ.".to_owned(),
            RequestBroken => "lamp-pole: запрос не читается.".to_owned(),
            RequestFormat => "lamp-pole: неизвестный формат запроса.".to_owned(),
            TooManySheets => "lamp-pole: листов больше 16.".to_owned(),
            SheetNamesTwice => "lamp-pole: имена листов повторяются.".to_owned(),
            Nothing => "lamp-pole: запрос ничего не меняет.".to_owned(),
            SheetName => "lamp-pole: имя листа — astral_pole_*.".to_owned(),
            DdsFile(name) => format!("lamp-pole: лист {name} — не DDS или больше 4 МБ."),
            DdsSum(name) => format!("lamp-pole: SHA-256 листа {name} не сходится."),
            DdsFormat(name) => format!("lamp-pole: лист {name} — DXT1 или DXT5."),
            DdsSides(name) => format!("lamp-pole: лист {name} — стороны 4–2048 степенью двойки."),
            ShaderNumber => "lamp-pole: у шейдера нет номера.".to_owned(),
            ShineNumber => "lamp-pole: блеск — число.".to_owned(),
            PartKind => "lamp-pole: часть — уровень high/medium/low и роль body/glow.".to_owned(),
            PartArrays => "lamp-pole: у части сломаны массивы вершин.".to_owned(),
            PartIndex => "lamp-pole: индекс вне вершин.".to_owned(),
            PartTriangles => "lamp-pole: индексы — не треугольники.".to_owned(),
            PartRange => "lamp-pole: значения части вне допуска.".to_owned(),
            NotNumbers(key) => format!("lamp-pole: {key} — не числа."),
            NotMultiple(key, step) => format!("lamp-pole: {key} — длина не кратна {step}."),
            DecoSheet => "lamp-pole: украшению нужен лист.".to_owned(),
            DecoGlow => "lamp-pole: свечение украшения — от 0 до 64.".to_owned(),
            DecoBone => "lamp-pole: кость украшения вне 0–255.".to_owned(),
            DecoParts => "lamp-pole: украшение — от 1 до 6 частей.".to_owned(),
            PartTwice => "lamp-pole: часть с таким уровнем и ролью уже есть.".to_owned(),
            DecoVertices => "lamp-pole: вершин украшения больше 40000.".to_owned(),
            NoRoot => "lamp-pole: у фрагмента нет корня.".to_owned(),
            NoDrawable => "lamp-pole: у фрагмента нет модели.".to_owned(),
            NoGroup => "lamp-pole: у модели нет группы шейдеров.".to_owned(),
            NoSheetObject(name) => format!("lamp-pole: в словаре нет листа {name}."),
            NoDictionary => "lamp-pole: нет словаря.".to_owned(),
            NoSample => "lamp-pole: в словаре нет текстур-образцов.".to_owned(),
            ShaderIndex => "lamp-pole: номер шейдера вне списка или повторен.".to_owned(),
            SwapUnknown(name) => format!("lamp-pole: подмена {name} не поддержана."),
            PresetUnknown(name) => format!("lamp-pole: пресет {name} не разрешён."),
            SheetUnnamed(name) => format!("lamp-pole: лист {name} не назван в запросе."),
            NoDiffuse => "lamp-pole: у шейдера корпуса нет DiffuseSampler.".to_owned(),
            ShineRange => "lamp-pole: блеск — от 0 до 4.".to_owned(),
            NoShaders => "lamp-pole: у модели нет шейдеров.".to_owned(),
            NoSampleGeometry => "lamp-pole: у модели нет геометрии-образца.".to_owned(),
            NoVertexBuffer => "lamp-pole: у геометрии нет буфера вершин.".to_owned(),
            NoIndexBuffer => "lamp-pole: у геометрии нет буфера индексов.".to_owned(),
            TemplatePointer => "lamp-pole: у шаблона нет нужного указателя.".to_owned(),
            EmptyLevelModel => "lamp-pole: пустая модель уровня.".to_owned(),
            NoPalette => "lamp-pole: у модели со скином нет палитры костей.".to_owned(),
            NoParams => "lamp-pole: у шейдера нет параметров.".to_owned(),
            ParamsOverflow => {
                "lamp-pole: таблица параметров шейдера не умещается в блок.".to_owned()
            }
            TextureNoTarget => "lamp-pole: текстура без цели.".to_owned(),
            NoParam(name) => format!("lamp-pole: у шейдера нет {name}."),
            VectorOutside => "lamp-pole: данные вектора вне блоков.".to_owned(),
            BoneOutside => "lamp-pole: кость вне блока.".to_owned(),
        }
    }
}

impl From<Fail> for EngineError {
    fn from(fail: Fail) -> Self {
        EngineError::invalid_data(fail.text())
    }
}

/// Условие выполнено — иначе отказ.
fn ensure(holds: bool, otherwise: Fail) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(otherwise.into())
    }
}

// ============================================================== пределы

mod limits {
    pub const REQUEST: usize = 24 << 20;
    pub const MODEL: usize = 16 << 20;
    pub const DDS: usize = 4 << 20;
    pub const DDS_HEADER: usize = 128;
    pub const SHEETS: usize = 16;
    pub const PARTS: usize = 6;
    pub const DECOR_VERTICES: usize = 40_000;
    pub const PART_VERTICES: (usize, usize) = (3, 12_000);
    pub const SHEET_TAIL: (usize, usize) = (1, 40);
    pub const SHEET_PREFIX: &str = "astral_pole_";
    pub const FORMAT: &str = "astral.lamp-pole";
}

const KIND_TEXTURE: u8 = 0;
const KIND_VECTOR: u8 = 1;
/// Поля блока геометрии: число индексов, число треугольников, число вершин (младшие 16 бит слова), шаг вершины и число
/// костей палитры (два `u16` подряд).
const GEOMETRY_INDICES: usize = 0x58;
const GEOMETRY_TRIANGLES: usize = 0x5c;
const GEOMETRY_VERTICES: usize = 0x60;
const GEOMETRY_STRIDE: usize = 0x70;
const GEOMETRY_BONES: usize = 0x72;
/// Указатель данных вершин в блоке геометрии: у игры и хоста он ведёт на те же вершины, что и буфер вершин (`+0x10` буфера).
const GEOMETRY_DATA: usize = 0x78;
/// Регистры строк таблицы параметров (второй байт первого слова строки): вектор номер `j` из `V` лежит в `0xa0 + V − 1 − j`,
/// лист номер `k` — в `0` (цвет) или `k + 1`. Так записаны шейдеры `default`, `emissive`, `normal` и `normal_spec` у игры.
const VECTOR_REGISTER_BASE: u8 = 0xa0;
const BONE_RECORD: usize = 0x50;
const BOUNDS_RECORD: usize = 32;
/// Пустая рамка: нижний угол на максимуме, верхний на минимуме.
const EMPTY_REACH: ([f32; 3], [f32; 3]) = ([f32::MAX; 3], [f32::MIN; 3]);

// ============================================================ обход графа

/// Короткие обороты над блоками графа: переход по указателю, чтение слов, запись и добавление блоков.
trait Walk {
    fn follow(&self, block: usize, relative: usize) -> Option<usize>;
    fn pointer(&self, block: usize, relative: usize) -> Option<Address>;
    fn half(&self, block: usize, relative: usize) -> Result<u16>;
    fn word(&self, block: usize, relative: usize) -> Result<u32>;
    fn float(&self, block: usize, relative: usize) -> Result<f32>;
    fn triple(&self, block: usize, at: usize) -> Result<[f32; 3]>;
    fn here(&self, block: usize) -> Address;
    fn patch(&mut self, block: usize, relative: usize, bytes: &[u8]) -> Result<()>;
    fn spawn(&mut self, segment: Segment, bytes: Vec<u8>, slots: Vec<Slot>) -> usize;
    fn append(&mut self, segment: Segment, bytes: Vec<u8>, slots: Vec<Slot>) -> Address;
    fn derive(
        &mut self,
        from: usize,
        tweak: impl FnOnce(&mut Vec<u8>, &mut Vec<Slot>) -> Result<()>,
    ) -> Result<usize>;
}

impl Walk for Graph {
    fn follow(&self, block: usize, relative: usize) -> Option<usize> {
        split::pointer_block(self, block, relative)
    }

    fn pointer(&self, block: usize, relative: usize) -> Option<Address> {
        rg::pointer_from(self, block, relative)
    }

    fn half(&self, block: usize, relative: usize) -> Result<u16> {
        split::u16_at(self, block, relative)
    }

    fn word(&self, block: usize, relative: usize) -> Result<u32> {
        split::u32_at(self, block, relative)
    }

    fn float(&self, block: usize, relative: usize) -> Result<f32> {
        self.word(block, relative).map(f32::from_bits)
    }

    fn triple(&self, block: usize, at: usize) -> Result<[f32; 3]> {
        Ok([
            self.float(block, at)?,
            self.float(block, at + 4)?,
            self.float(block, at + 8)?,
        ])
    }

    fn here(&self, block: usize) -> Address {
        let found = &self.blocks[block];
        Address {
            segment: found.segment,
            offset: found.start,
        }
    }

    fn patch(&mut self, block: usize, relative: usize, bytes: &[u8]) -> Result<()> {
        Ok(rg::write_at(self, block, relative, bytes)?)
    }

    fn spawn(&mut self, segment: Segment, bytes: Vec<u8>, slots: Vec<Slot>) -> usize {
        rg::append_block(self, segment, bytes, slots)
    }

    fn append(&mut self, segment: Segment, bytes: Vec<u8>, slots: Vec<Slot>) -> Address {
        let block = self.spawn(segment, bytes, slots);
        self.here(block)
    }

    /// Копия блока в его же области; `tweak` правит байты и указатели копии. Возвращает номер нового блока.
    fn derive(
        &mut self,
        from: usize,
        tweak: impl FnOnce(&mut Vec<u8>, &mut Vec<Slot>) -> Result<()>,
    ) -> Result<usize> {
        let mut bytes = self.content(from).to_vec();
        let mut slots = self.blocks[from].slots.clone();
        tweak(&mut bytes, &mut slots)?;
        let segment = self.blocks[from].segment;
        Ok(self.spawn(segment, bytes, slots))
    }
}

/// Указатель блока на смещении `relative`: цель переводится, а если указателя не было — он добавляется.
fn aim(slots: &mut Vec<Slot>, relative: usize, target: Address) {
    match slots.iter_mut().find(|slot| slot.relative == relative) {
        Some(slot) => slot.target = target,
        None => slots.push(Slot { relative, target }),
    }
}

fn has_slot(slots: &[Slot], relative: usize) -> bool {
    slots.iter().any(|slot| slot.relative == relative)
}

/// Поэлементное соединение двух троек выбранной функцией.
fn merge(a: [f32; 3], b: [f32; 3], pick: fn(f32, f32) -> f32) -> [f32; 3] {
    std::array::from_fn(|axis| pick(a[axis], b[axis]))
}

// ============================================================== запрос

/// Узел запроса: чтение по ключам без отказов (чужой тип и отсутствие дают пустое значение).
#[derive(Clone, Copy)]
struct Doc<'a>(&'a Value);

impl<'a> Doc<'a> {
    fn at(self, key: &str) -> Doc<'a> {
        Doc(&self.0[key])
    }

    fn maybe_text(self) -> Option<&'a str> {
        self.0.as_str()
    }

    fn text(self) -> &'a str {
        self.0.as_str().unwrap_or_default()
    }

    fn each(self) -> impl Iterator<Item = Doc<'a>> {
        self.0.as_array().into_iter().flatten().map(Doc)
    }
}

/// Разобранный и проверенный запрос.
struct Job {
    model: PathBuf,
    textures: Vec<Sheet>,
    edits: Vec<ShaderEdit>,
    decoration: Option<Decoration>,
}

impl Job {
    fn load(argument: &str) -> Result<Job> {
        let body = Self::document(argument)?;
        let root = Doc(&body);
        let known = root.at("format").maybe_text() == Some(limits::FORMAT)
            && root.at("version").0.as_u64() == Some(1);
        ensure(known, Fail::RequestFormat)?;
        let model = paths::existing_file(root.at("model").text(), &[".yft"])?;

        let textures = root
            .at("textures")
            .each()
            .map(Sheet::from_doc)
            .collect::<Result<Vec<_>>>()?;
        ensure(textures.len() <= limits::SHEETS, Fail::TooManySheets)?;
        let mut seen = HashSet::new();
        ensure(
            textures
                .iter()
                .all(|sheet| seen.insert(sheet.name.as_str())),
            Fail::SheetNamesTwice,
        )?;

        let edits = root
            .at("shaders")
            .each()
            .map(ShaderEdit::from_doc)
            .collect::<Result<Vec<_>>>()?;
        let decoration = match root.at("decorations").0 {
            Value::Null => None,
            other => Some(Decoration::from_doc(Doc(other))?),
        };
        ensure(!edits.is_empty() || decoration.is_some(), Fail::Nothing)?;
        Ok(Job {
            model,
            textures,
            edits,
            decoration,
        })
    }

    /// Файл запроса целиком: размер и разбор JSON.
    fn document(argument: &str) -> Result<Value> {
        let raw = fs::read(paths::existing_file(argument, &[".json"])?)?;
        ensure(
            (1..=limits::REQUEST).contains(&raw.len()),
            Fail::RequestSize,
        )?;
        serde_json::from_slice(&raw).map_err(|_| Fail::RequestBroken.into())
    }

    /// Листы по порядку вставки: сначала листы запроса, затем лист украшения.
    fn sheets(&self) -> Vec<&Sheet> {
        let decorated = self.decoration.iter().map(|deco| &deco.sheet);
        self.textures.iter().chain(decorated).collect()
    }
}

/// Лист краски: имя, DDS и ожидаемая сумма.
struct Sheet {
    name: String,
    dds: PathBuf,
    sha: String,
}

fn name_fits(name: &str) -> bool {
    let (shortest, longest) = limits::SHEET_TAIL;
    name.strip_prefix(limits::SHEET_PREFIX).is_some_and(|tail| {
        (shortest..=longest).contains(&tail.len())
            && tail
                .bytes()
                .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_'))
    })
}

fn le32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().expect("четыре байта"))
}

impl Sheet {
    fn from_doc(node: Doc) -> Result<Sheet> {
        let name = node.at("name").text().trim().to_owned();
        ensure(name_fits(&name), Fail::SheetName)?;
        let dds = paths::existing_file(node.at("dds").text(), &[".dds"])?;
        Ok(Sheet {
            name,
            dds,
            sha: node.at("sha256").text().to_owned(),
        })
    }

    /// Файл DDS, проверенный по порядку: размер и сигнатура, сумма, формат, стороны, разбор.
    fn texture(&self) -> Result<NewTexture> {
        let named = || self.name.clone();
        let bytes = fs::read(&self.dds)?;
        let sized = (limits::DDS_HEADER..=limits::DDS).contains(&bytes.len());
        ensure(sized && bytes.starts_with(b"DDS "), Fail::DdsFile(named()))?;
        let sum = format!("sha256:{}", hash::sha256_hex(&bytes));
        ensure(self.sha == sum, Fail::DdsSum(named()))?;
        ensure(
            matches!(&bytes[84..88], b"DXT1" | b"DXT5"),
            Fail::DdsFormat(named()),
        )?;
        let sides = [le32(&bytes, 12), le32(&bytes, 16)];
        let fitting = sides
            .iter()
            .all(|side| (4..=2048).contains(side) && side.is_power_of_two());
        ensure(fitting, Fail::DdsSides(named()))?;
        let image = dds::parse(&bytes)?;
        Ok(NewTexture {
            name: named(),
            width: image.width as u16,
            height: image.height as u16,
            format: image.format,
            levels: image.levels,
            payload: image.payload,
        })
    }
}

/// Правка одного шейдера корпуса.
struct ShaderEdit {
    index: usize,
    specular: Option<f32>,
    diffuse: Option<String>,
    preset: Option<String>,
    swap: Option<String>,
}

impl ShaderEdit {
    fn from_doc(node: Doc) -> Result<ShaderEdit> {
        let index = node.at("index").0.as_u64().ok_or(Fail::ShaderNumber)? as usize;
        let specular = match node.at("specular").0 {
            Value::Null => None,
            number => Some(number.as_f64().ok_or(Fail::ShineNumber)? as f32),
        };
        let word = |key: &str| node.at(key).maybe_text().map(str::to_owned);
        Ok(ShaderEdit {
            index,
            specular,
            diffuse: word("diffuse"),
            preset: word("preset"),
            swap: word("swap"),
        })
    }
}

/// Уровень детализации: где лежит список его моделей и слово флагов.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Level {
    High,
    Medium,
    Low,
}

impl Level {
    const ALL: [Level; 3] = [Level::High, Level::Medium, Level::Low];

    fn parse(text: &str) -> Option<Level> {
        Level::ALL.into_iter().find(|level| level.key() == text)
    }

    fn key(self) -> &'static str {
        ["high", "medium", "low"][self as usize]
    }

    fn list_at(self) -> usize {
        0x50 + 8 * self as usize
    }

    fn flags_at(self) -> usize {
        0x80 + 4 * self as usize
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Role {
    Body,
    Glow,
}

impl Role {
    fn parse(text: &str) -> Option<Role> {
        match text {
            "body" => Some(Role::Body),
            "glow" => Some(Role::Glow),
            _ => None,
        }
    }
}

/// Часть украшения: одна геометрия на уровне.
struct Part {
    level: Level,
    role: Role,
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u16>,
}

/// Массивы вершин части: ключ и сколько чисел приходится на вершину.
const PART_ARRAYS: [(&str, usize); 3] = [("positions", 3), ("normals", 3), ("uvs", 2)];

/// Числа массива `key`: каждый элемент — число, длина кратна `step`.
fn numbers(node: Doc, key: &'static str, step: usize) -> Result<Vec<f32>> {
    let found = node
        .at(key)
        .each()
        .map(|item| item.0.as_f64().map(|wide| wide as f32))
        .collect::<Option<Vec<f32>>>()
        .ok_or(Fail::NotNumbers(key))?;
    ensure(found.len() % step == 0, Fail::NotMultiple(key, step))?;
    Ok(found)
}

impl Part {
    fn from_doc(node: Doc) -> Result<Part> {
        let level = node.at("lod").maybe_text().and_then(Level::parse);
        let role = node.at("role").maybe_text().and_then(Role::parse);
        let (level, role) = level.zip(role).ok_or(Fail::PartKind)?;

        let lists = PART_ARRAYS
            .iter()
            .map(|&(key, step)| numbers(node, key, step))
            .collect::<Result<Vec<_>>>()?;
        let [positions, normals, uvs]: [Vec<f32>; 3] =
            lists.try_into().expect("три массива вершин");
        let count = positions.len() / 3;
        let (fewest, most) = limits::PART_VERTICES;
        let matching = normals.len() == 3 * count && uvs.len() == 2 * count;
        ensure(
            (fewest..=most).contains(&count) && matching,
            Fail::PartArrays,
        )?;

        let indices = node
            .at("indices")
            .each()
            .map(|item| item.0.as_u64().filter(|&at| at < count as u64))
            .map(|found| found.map(|at| at as u16))
            .collect::<Option<Vec<u16>>>()
            .ok_or(Fail::PartIndex)?;
        ensure(
            indices.len() >= 3 && indices.len() % 3 == 0,
            Fail::PartTriangles,
        )?;

        let tolerable = [
            (&positions, -30.0, 30.0),
            (&normals, -1.01, 1.01),
            (&uvs, 0.0, 1.0),
        ];
        let inside = tolerable
            .iter()
            .all(|&(list, low, high)| list.iter().all(|value| (low..=high).contains(value)));
        ensure(inside, Fail::PartRange)?;
        Ok(Part {
            level,
            role,
            positions,
            normals,
            uvs,
            indices,
        })
    }

    fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// Вершины по три значения: позиция, нормаль и uv.
    fn vertices(&self) -> impl Iterator<Item = ([f32; 3], [f32; 3], [f32; 2])> + '_ {
        let triples = self
            .positions
            .chunks_exact(3)
            .zip(self.normals.chunks_exact(3));
        triples
            .zip(self.uvs.chunks_exact(2))
            .map(|((p, n), uv)| ([p[0], p[1], p[2]], [n[0], n[1], n[2]], [uv[0], uv[1]]))
    }

    /// Сырые позиции вершин.
    fn points(&self) -> impl Iterator<Item = [f32; 3]> + '_ {
        self.vertices().map(|(position, _, _)| position)
    }
}

struct Decoration {
    sheet: Sheet,
    glow: f32,
    bone: u8,
    parts: Vec<Part>,
}

impl Decoration {
    fn from_doc(node: Doc) -> Result<Decoration> {
        let sheet = Sheet::from_doc(Doc(node.0.get("texture").ok_or(Fail::DecoSheet)?))?;
        let glow = node.at("glow").0.as_f64().unwrap_or(0.0) as f32;
        ensure((0.0..=64.0).contains(&glow), Fail::DecoGlow)?;
        let bone =
            u8::try_from(node.at("bone").0.as_u64().unwrap_or(0)).map_err(|_| Fail::DecoBone)?;
        let parts = node
            .at("parts")
            .each()
            .map(Part::from_doc)
            .collect::<Result<Vec<_>>>()?;
        ensure((1..=limits::PARTS).contains(&parts.len()), Fail::DecoParts)?;
        let mut taken = HashSet::new();
        ensure(
            parts
                .iter()
                .all(|part| taken.insert((part.level, part.role))),
            Fail::PartTwice,
        )?;
        let total: usize = parts.iter().map(Part::vertex_count).sum();
        ensure(total <= limits::DECOR_VERTICES, Fail::DecoVertices)?;
        Ok(Decoration {
            sheet,
            glow,
            bone,
            parts,
        })
    }

    fn has_role(&self, role: Role) -> bool {
        self.parts.iter().any(|part| part.role == role)
    }
}

// ===================================================== модель в графе

/// Граф модели и опорные блоки: корень фрагмента, модель (drawable) и группа шейдеров.
struct Bench {
    graph: Graph,
    root: usize,
    drawable: usize,
    group: usize,
}

/// Что украшение положило в модель: ответ по уровням и рамка сырых позиций.
#[derive(Default)]
struct Placed {
    report: Map<String, Value>,
    reach: Option<([f32; 3], [f32; 3])>,
}

impl Placed {
    /// Часть легла в модель: запись в ответе (последняя часть уровня заменяет прежнюю) и рост рамки.
    fn note(&mut self, part: &Part) {
        let entry: Map<String, Value> = [
            ("vertices".to_owned(), Value::from(part.vertex_count())),
            ("geometries".to_owned(), Value::from(1)),
        ]
        .into_iter()
        .collect();
        self.report
            .insert(part.level.key().to_owned(), Value::Object(entry));
        let grown = part
            .points()
            .fold(self.reach.unwrap_or(EMPTY_REACH), |(low, high), point| {
                (merge(low, point, f32::min), merge(high, point, f32::max))
            });
        self.reach = Some(grown);
    }
}

impl Bench {
    fn from_graph(graph: Graph) -> Result<Bench> {
        let root = graph.root().ok_or(Fail::NoRoot)?;
        let drawable = graph.follow(root, 0x30).ok_or(Fail::NoDrawable)?;
        let group = graph.follow(drawable, 0x10).ok_or(Fail::NoGroup)?;
        Ok(Bench {
            group,
            drawable,
            root,
            graph,
        })
    }

    fn bone_count(&self) -> Result<u16> {
        match self.graph.follow(self.drawable, 0x18) {
            Some(skeleton) => self.graph.half(skeleton, 0x5e),
            None => Ok(0),
        }
    }

    /// Объекты текстур словаря модели с именами (без словаря — пусто).
    fn sheet_objects(&self) -> Result<Vec<(String, Address)>> {
        objects_of(&self.graph, self.group)
    }

    fn sheet_object(&self, name: &str) -> Result<Address> {
        object_named(&self.graph, self.group, name)
    }

    /// Вписывает лист: первый лист модели без словаря создаёт словарь, остальные идут через образец.
    fn insert_sheet(&mut self, position: usize, texture: NewTexture) -> Result<()> {
        let group = self.group;
        let graph = &mut self.graph;
        match (dictionary_of(graph, group), position) {
            (None, 0) => {
                let packed = ytd_write::write(&[texture])?;
                let standalone = rg::scan(&Resource::parse(&packed)?)?;
                let (merged, at) = rg::graft(graph, &standalone)?;
                *graph = merged;
                let target = Slot {
                    relative: 0x08,
                    target: at,
                };
                graph.blocks[group].slots.push(target);
                Ok(())
            }
            (None, _) => Err(Fail::NoDictionary.into()),
            (Some(dictionary), _) => {
                let first = shop::texture_objects(graph, dictionary)?.into_iter().next();
                let (sample, _) = first.ok_or(Fail::NoSample)?;
                let flags = shop::Flags {
                    from: &sample,
                    source: None,
                    keep_donor: false,
                    prefer_dictionary: true,
                };
                shop::embed_sheet(graph, group, texture, flags)
            }
        }
    }

    /// Правки по порядку; возвращает, сколько из них поставили пресет.
    fn edit_shaders(&mut self, edits: &[ShaderEdit], textures: &[Sheet]) -> Result<usize> {
        if edits.is_empty() {
            return Ok(0);
        }
        let group = self.group;
        let shaders = graft::shader_blocks(&self.graph, group)?;
        let mut seen = HashSet::new();
        let mut presets = 0;
        for edit in edits {
            let listed = edit.index < shaders.len() && seen.insert(edit.index);
            ensure(listed, Fail::ShaderIndex)?;
            let shader = shaders[edit.index];
            presets += usize::from(apply_edit(&mut self.graph, group, shader, edit, textures)?);
        }
        Ok(presets)
    }

    fn decorate(&mut self, deco: &Decoration) -> Result<Placed> {
        let (group, drawable) = (self.group, self.drawable);
        let object = self.sheet_object(&deco.sheet.name)?;
        let (body_at, glow_at) = plant_shaders(&mut self.graph, group, deco, object)?;
        let pose = bone_pose(&self.graph, drawable)?;
        let mut placed = Placed::default();
        deco.parts.iter().try_for_each(|part| -> Result<()> {
            let search = if part.level == Level::High {
                deco.bone
            } else {
                0
            };
            let shader = if part.role == Role::Glow {
                glow_at
            } else {
                body_at
            };
            if plant_part(
                &mut self.graph,
                drawable,
                part,
                (search, shader as u16),
                &pose,
            )? {
                placed.note(part);
            }
            Ok(())
        })?;
        Ok(placed)
    }

    /// Маски корзин: у каждой модели уровня и в слове уровня.
    fn stamp_masks(&mut self) -> Result<()> {
        let (group, drawable) = (self.group, self.drawable);
        let graph = &mut self.graph;
        let buckets: Vec<u8> = graft::shader_blocks(graph, group)?
            .into_iter()
            .map(|shader| graph.content(shader)[0x11])
            .collect();
        for level in Level::ALL {
            let models = lod_models(graph, drawable, level.list_at())?;
            let masks = models
                .iter()
                .map(|&model| mask_of(graph, model, &buckets))
                .collect::<Result<Vec<u32>>>()?;
            let marked = models.iter().zip(&masks).filter(|(_, mask)| **mask != 0);
            for (&model, &mask) in marked {
                let old = u32::from(graph.half(model, 0x2c)?);
                graph.patch(model, 0x2c, &((old | mask) as u16).to_le_bytes())?;
            }
            let whole = masks.iter().fold(0, |sum, mask| sum | mask);
            if whole != 0 {
                let old = graph.word(drawable, level.flags_at())?;
                graph.patch(drawable, level.flags_at(), &(old | whole).to_le_bytes())?;
            }
        }
        Ok(())
    }

    /// Рамка модели растёт на сырые позиции украшения, шары модели и фрагмента — до дальнего угла рамки.
    fn grow_frame(&mut self, low: [f32; 3], high: [f32; 3]) -> Result<()> {
        let (drawable, root) = (self.drawable, self.root);
        let graph = &mut self.graph;
        let min = merge(graph.triple(drawable, 0x30)?, low, f32::min);
        let max = merge(graph.triple(drawable, 0x40)?, high, f32::max);
        for (at, corner) in [(0x30, min), (0x40, max)] {
            let packed: Vec<u8> = corner
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect();
            graph.patch(drawable, at, &packed)?;
        }
        let corners: Vec<[f32; 3]> = (0..8u32)
            .map(|mask| {
                std::array::from_fn(|axis| {
                    if mask >> axis & 1 == 0 {
                        min[axis]
                    } else {
                        max[axis]
                    }
                })
            })
            .collect();
        for block in [drawable, root] {
            let centre = graph.triple(block, 0x20)?;
            let radius = graph.float(block, 0x2c)?;
            let reach = |corner: &[f32; 3]| {
                squares(std::array::from_fn(|axis| corner[axis] - centre[axis])).sqrt()
            };
            let farthest = corners.iter().map(reach).fold(0.0f32, f32::max);
            if farthest > radius {
                graph.patch(block, 0x2c, &farthest.to_le_bytes())?;
            }
        }
        Ok(())
    }

    /// Служебные слова, размеры, перенаправление листов и сборка файла.
    fn finish(self, first_sheet: Option<&str>) -> Result<Vec<u8>> {
        let Bench {
            mut graph,
            root,
            drawable,
            ..
        } = self;
        graph.patch(root, 0x00, &HOST_FRAGMENT_RADIUS.to_le_bytes())?;
        graph.patch(drawable, 0x00, &HOST_MODEL_RADIUS.to_le_bytes())?;
        split_heads::write_models_sizes(&mut graph, root)?;
        if let Some(name) = first_sheet {
            restyle_model::repoint_records(&mut graph, root, name)?;
        }
        restyle_model::relay_textures(&mut graph)?;
        let trimmed = rg::drop_unreferenced_graphics(&graph)?;
        let orders =
            [Segment::System, Segment::Graphics].map(|part| rg::identity_order(&trimmed, part));
        let [system, graphics] = &orders;
        Ok(rg::rebuild_with(
            &trimmed,
            system,
            graphics,
            &meta_graph::deflate_body,
        )?)
    }
}

// ---- словарь и шейдеры корпуса (над графом)

/// Словарь текстур группы шейдеров, если он есть.
fn dictionary_of(graph: &Graph, group: usize) -> Option<Address> {
    graph.pointer(group, 0x08)
}

fn objects_of(graph: &Graph, group: usize) -> Result<Vec<(String, Address)>> {
    match dictionary_of(graph, group) {
        None => Ok(Vec::new()),
        Some(dictionary) => Ok(shop::texture_objects(graph, dictionary)?),
    }
}

fn object_named(graph: &Graph, group: usize, name: &str) -> Result<Address> {
    let found = objects_of(graph, group)?
        .into_iter()
        .find(|(known, _)| known.eq_ignore_ascii_case(name));
    match found {
        Some((_, at)) => Ok(at),
        None => Err(Fail::NoSheetObject(name.to_owned()).into()),
    }
}

/// Одна правка: подмена, краска, пресет, блеск. `true`, если ставился пресет.
fn apply_edit(
    graph: &mut Graph,
    group: usize,
    shader: usize,
    edit: &ShaderEdit,
    textures: &[Sheet],
) -> Result<bool> {
    if let Some(name) = &edit.swap {
        let standard = Standard::named(name).ok_or_else(|| Fail::SwapUnknown(name.clone()))?;
        swap_shader(graph, shader, name, standard.layout())?;
    }
    if let Some(name) = &edit.diffuse {
        repaint(graph, group, shader, name, textures)?;
    }
    let preset = edit
        .preset
        .as_deref()
        .map(|name| make_transparent(graph, shader, name))
        .transpose()?;
    if let Some(shine) = edit.specular {
        polish(graph, shader, shine)?;
    }
    Ok(preset.is_some())
}

fn make_transparent(graph: &mut Graph, shader: usize, preset: &str) -> Result<()> {
    let known = PRESETS.contains(&preset);
    ensure(known, Fail::PresetUnknown(preset.to_owned()))?;
    graph.patch(shader, 0x18, &hash::joaat(preset).to_le_bytes())?;
    graph.patch(shader, 0x11, &[1])?;
    // маска корзин идёт вместе с корзиной: по ней игра решает, в каком проходе рисовать шейдер
    graph.patch(shader, 0x20, &0xFF02u32.to_le_bytes())
}

/// Сэмплер цвета шейдера смотрит на лист из запроса.
fn repaint(
    graph: &mut Graph,
    group: usize,
    shader: usize,
    wanted: &str,
    textures: &[Sheet],
) -> Result<()> {
    let named = textures.iter().any(|sheet| sheet.name == wanted);
    ensure(named, Fail::SheetUnnamed(wanted.to_owned()))?;
    let object = object_named(graph, group, wanted)?;
    let table = ParamTable::read(graph, shader)?;
    let diffuse = hash::joaat("DiffuseSampler");
    let row = table.find(diffuse, KIND_TEXTURE).ok_or(Fail::NoDiffuse)?;
    rg::retarget(graph, table.block, row * 16 + 8, object)?;
    Ok(())
}

/// Блеск: множитель яркости блика растёт вместе со значением, спад блика — когда блеск больше единицы.
fn polish(graph: &mut Graph, shader: usize, shine: f32) -> Result<()> {
    ensure((0.0..=4.0).contains(&shine), Fail::ShineRange)?;
    let table = ParamTable::read(graph, shader)?;
    rescale(graph, &table, "specularIntensityMult", |x| {
        (x * shine).clamp(0.0, 4.0)
    })?;
    if shine > 1.0 {
        let grow = 1.0 + (shine - 1.0) * 0.5;
        rescale(graph, &table, "specularFalloffMult", |x| {
            (x * grow).clamp(1.0, 512.0)
        })?;
    }
    Ok(())
}

/// Первая компонента вектора-параметра меняется функцией; нет параметра или данных — ничего.
fn rescale(
    graph: &mut Graph,
    table: &ParamTable,
    name: &str,
    change: impl Fn(f32) -> f32,
) -> Result<()> {
    let spot = table
        .find(hash::joaat(name), KIND_VECTOR)
        .and_then(|row| graph.pointer(table.block, row * 16 + 8))
        .and_then(|at| {
            let block = graph.block_at(at)?;
            Some((block, at.offset - graph.blocks[block].start))
        });
    let Some((block, relative)) = spot else {
        return Ok(());
    };
    let current = graph.float(block, relative)?;
    graph.patch(block, relative, &change(current).to_le_bytes())
}

// ---- украшение (над графом)

/// Шейдеры украшения (корпус, затем свечение) и новый список шейдеров группы.
/// Возвращает номера шейдеров корпуса и свечения.
fn plant_shaders(
    graph: &mut Graph,
    group: usize,
    deco: &Decoration,
    object: Address,
) -> Result<(usize, usize)> {
    let mut shaders = graft::shader_blocks(graph, group)?;
    let sample = *shaders.first().ok_or(Fail::NoShaders)?;
    let body_at = shaders.len();
    let glow_at = body_at + usize::from(deco.has_role(Role::Body));
    for role in [Role::Body, Role::Glow] {
        if deco.has_role(role) {
            shaders.push(plant_shader(graph, sample, role, object, deco.glow)?);
        }
    }
    let (bytes, slots) = split::pointer_list(graph, &shaders);
    let list = graph.append(Segment::System, bytes, slots);
    rg::retarget(graph, group, 0x10, list)?;
    // число шейдеров и ёмкость списка: игра пишет их одинаковыми (раньше обновлялось только число)
    let size = (shaders.len() as u16).to_le_bytes();
    graph.patch(group, 0x18, &[size[0], size[1], size[0], size[1]])?;
    Ok((body_at, glow_at))
}

/// Шейдер украшения: векторы, блок параметров и копия образца с новым именем и файлом.
fn plant_shader(
    graph: &mut Graph,
    sample: usize,
    role: Role,
    object: Address,
    glow: f32,
) -> Result<usize> {
    let (standard, file) = match role {
        Role::Body => (Standard::Default, "default.sps"),
        Role::Glow => (Standard::Emissive, "emissive.sps"),
    };
    let layout = standard.layout();
    let cells: Vec<Cell> = layout
        .iter()
        .map(|&(param, kind, value)| match kind {
            "Texture" => Cell::Texture(Some(object)),
            _ if param == "emissiveMultiplier" => Cell::Vector([glow, 0.0, 0.0, 0.0]),
            _ => Cell::Vector(value),
        })
        .collect();
    let params = lay_params(graph, layout, &cells)?;
    let (table, block, textures) = param_sizes(&cells);
    graph.derive(sample, |bytes, slots| {
        bytes[0x08..0x0c].copy_from_slice(&hash::joaat(standard.name()).to_le_bytes());
        bytes[0x10] = layout.len() as u8;
        bytes[0x11] = 0;
        // длины таблицы, маска корзины непрозрачных и число листов — своей раскладки, а не образца:
        // по ним игра читает имена параметров и выбирает проход отрисовки
        bytes[0x14..0x16].copy_from_slice(&table.to_le_bytes());
        bytes[0x16..0x18].copy_from_slice(&block.to_le_bytes());
        bytes[0x20..0x24].copy_from_slice(&0xFF01u32.to_le_bytes());
        bytes[0x27] = textures;
        bytes[0x18..0x1c].copy_from_slice(&hash::joaat(file).to_le_bytes());
        aim(slots, 0x00, params);
        Ok(())
    })
}

/// Кладёт часть в подходящую модель уровня; `false` — у модели нет списка этого уровня, часть пропущена.
/// `(search, shader_index)`: кость поиска и номер шейдера новой геометрии.
fn plant_part(
    graph: &mut Graph,
    drawable: usize,
    part: &Part,
    (search, shader_index): (u8, u16),
    pose: &[Mat],
) -> Result<bool> {
    let models = lod_models(graph, drawable, part.level.list_at())?;
    if models.is_empty() {
        return Ok(false);
    }
    let target = pick_target(graph, &models, search)?;
    let word = graph.word(target, 0x28)?;
    let geometries = split::geometry_blocks(graph, target)?;
    let sample = *geometries.first().ok_or(Fail::NoSampleGeometry)?;

    let (shape, palette, vertices, record) = if (word >> 8) & 0xff != 0 {
        let (slot, palette) = find_palette(graph, &geometries, search)?;
        let record = bounds_record(part.points());
        (
            Shape::Skinned,
            Some(palette),
            skinned_vertices(part, slot),
            record,
        )
    } else {
        let inverse = pose.get((word >> 24) as usize).map_or(IDENTITY, invert);
        let (vertices, moved) = rigid_vertices(part, &inverse);
        (
            Shape::Rigid,
            None,
            vertices,
            bounds_record(moved.into_iter()),
        )
    };
    let geometry = build_geometry(graph, sample, shape, (vertices, part), palette)?;
    attach_geometry(graph, target, &geometries, (geometry, record), shader_index)?;
    Ok(true)
}

/// Блоки новой геометрии в порядке создания: декларация, вершины, буфер вершин, индексы, буфер индексов,
/// палитра (кожа) и сама геометрия. Образец — первая геометрия целевой модели.
fn build_geometry(
    graph: &mut Graph,
    sample: usize,
    shape: Shape,
    (vertices, part): (Vec<u8>, &Part),
    palette: Option<Vec<u16>>,
) -> Result<usize> {
    let vertex_buffer = graph.follow(sample, 0x18).ok_or(Fail::NoVertexBuffer)?;
    let index_buffer = graph.follow(sample, 0x38).ok_or(Fail::NoIndexBuffer)?;
    let home = graph.blocks[sample].segment;
    // Область блока, на который указывает `owner` по смещению `relative`; без указателя — запасная.
    let area_of = |graph: &Graph, owner: usize, relative: usize, fallback: Segment| {
        graph
            .pointer(owner, relative)
            .map_or(fallback, |at| at.segment)
    };
    let (flags, stride) = shape.facts();

    // слово флагов, шаг, число занятых слотов (байт `+7`) и типы всех слотов — как у декларации геометрии игры
    let mut declaration = vec![0u8; 16];
    declaration[0..4].copy_from_slice(&flags.to_le_bytes());
    declaration[4..6].copy_from_slice(&stride.to_le_bytes());
    declaration[7] = flags.count_ones() as u8;
    declaration[8..16].copy_from_slice(&DECLARATION_TYPES.to_le_bytes());
    let declaration_at = graph.append(home, declaration, Vec::new());

    let data_area = area_of(graph, vertex_buffer, 0x10, home);
    let data_at = graph.append(data_area, vertices, Vec::new());
    let count = part.vertex_count() as u32;
    let fresh_vertices = graph.derive(vertex_buffer, |bytes, slots| {
        bytes[0x08..0x0a].copy_from_slice(&stride.to_le_bytes());
        bytes[0x18..0x1c].copy_from_slice(&count.to_le_bytes());
        let wired = has_slot(slots, 0x30) && has_slot(slots, 0x10);
        ensure(wired, Fail::TemplatePointer)?;
        aim(slots, 0x30, declaration_at);
        aim(slots, 0x10, data_at);
        if has_slot(slots, 0x20) {
            aim(slots, 0x20, data_at);
        }
        Ok(())
    })?;

    let index_home = graph.blocks[index_buffer].segment;
    let index_area = area_of(graph, index_buffer, 0x10, index_home);
    let packed: Vec<u8> = part
        .indices
        .iter()
        .flat_map(|index| index.to_le_bytes())
        .collect();
    let index_data_at = graph.append(index_area, packed, Vec::new());
    let total = part.indices.len() as u32;
    let fresh_indices = graph.derive(index_buffer, |bytes, slots| {
        bytes[0x08..0x0c].copy_from_slice(&total.to_le_bytes());
        ensure(has_slot(slots, 0x10), Fail::TemplatePointer)?;
        aim(slots, 0x10, index_data_at);
        Ok(())
    })?;

    let palette_at = palette.as_ref().map(|ids| {
        let area = area_of(graph, sample, 0x68, home);
        let packed = ids.iter().flat_map(|id| id.to_le_bytes()).collect();
        graph.append(area, packed, Vec::new())
    });
    let (vertices_at, indices_at) = (graph.here(fresh_vertices), graph.here(fresh_indices));
    graph.derive(sample, |bytes, slots| {
        // Счётчики самой геометрии: игра рисует по ним, а не по буферам. Копия образца оставляла его числа, и
        // рисовались первые индексы образца (гирлянда `prop_streetlight_08` пропадала, у `01` оставался нижний кусок).
        let indices = part.indices.len() as u32;
        bytes[GEOMETRY_INDICES..GEOMETRY_INDICES + 4].copy_from_slice(&indices.to_le_bytes());
        bytes[GEOMETRY_TRIANGLES..GEOMETRY_TRIANGLES + 4].copy_from_slice(&(indices / 3).to_le_bytes());
        bytes[GEOMETRY_VERTICES..GEOMETRY_VERTICES + 2].copy_from_slice(&(count as u16).to_le_bytes());
        bytes[GEOMETRY_STRIDE..GEOMETRY_STRIDE + 2].copy_from_slice(&stride.to_le_bytes());
        let bones = palette.as_ref().map_or(0, |ids| ids.len() as u16);
        bytes[GEOMETRY_BONES..GEOMETRY_BONES + 2].copy_from_slice(&bones.to_le_bytes());
        aim(slots, 0x18, vertices_at);
        aim(slots, 0x38, indices_at);
        // данные вершин самой геометрии — те же, что у буфера (19.11.2026, правила целостности: копия образца оставляла вершины образца)
        if has_slot(slots, GEOMETRY_DATA) {
            aim(slots, GEOMETRY_DATA, data_at);
        }
        if let Some(at) = palette_at {
            ensure(has_slot(slots, 0x68), Fail::TemplatePointer)?;
            aim(slots, 0x68, at);
        }
        Ok(())
    })
}

/// Добавляет геометрию в модель: список геометрий, отображение шейдеров, счётчики и рамки.
fn attach_geometry(
    graph: &mut Graph,
    model: usize,
    old: &[usize],
    (geometry, record): (usize, [u8; BOUNDS_RECORD]),
    shader_index: u16,
) -> Result<()> {
    let mut records = graft::records_of(graph, model)?;
    let grown: Vec<usize> = old.iter().copied().chain([geometry]).collect();

    let (bytes, slots) = split::pointer_list(graph, &grown);
    let list = graph.append(Segment::System, bytes, slots);
    rg::retarget(graph, model, 0x08, list)?;

    let mut mapping = split::mapping_of(graph, model)?.unwrap_or_default();
    mapping.push(shader_index);
    let packed = mapping
        .iter()
        .flat_map(|number| number.to_le_bytes())
        .collect();
    let mapping_at = graph.append(Segment::System, packed, Vec::new());
    rg::retarget(graph, model, 0x20, mapping_at)?;

    let count = (old.len() + 1) as u16;
    for at in [0x10, 0x12, 0x2e] {
        graph.patch(model, at, &count.to_le_bytes())?;
    }

    records.push(record);
    let frames_at = graph.append(Segment::System, graft::bounds_bytes(&records), Vec::new());
    rg::retarget(graph, model, 0x18, frames_at)?;
    Ok(())
}

/// Маска корзин модели: по биту на корзину каждого шейдера её отображения (номера вне списка пропускаются).
fn mask_of(graph: &Graph, model: usize, buckets: &[u8]) -> Result<u32> {
    let mapping = split::mapping_of(graph, model)?.unwrap_or_default();
    Ok(mapping
        .into_iter()
        .filter_map(|number| buckets.get(usize::from(number)))
        .fold(0, |mask, &bucket| {
            mask | 1u32.wrapping_shl(u32::from(bucket))
        }))
}

/// Сумма квадратов компонент слева направо.
fn squares(values: [f32; 3]) -> f32 {
    values
        .iter()
        .map(|value| value * value)
        .reduce(|sum, square| sum + square)
        .unwrap_or_default()
}

// ================================================== списки уровней, поиск

/// Модели уровня: список по смещению `relative` модели `drawable`; нет списка — пусто.
pub(super) fn lod_models(graph: &Graph, drawable: usize, relative: usize) -> Result<Vec<usize>> {
    let listed = graph
        .follow(drawable, relative)
        .map(|header| -> Result<Vec<usize>> {
            let count = usize::from(graph.half(header, 8)?);
            match graph.follow(header, 0) {
                None => Ok(Vec::new()),
                Some(entries) => (0..count)
                    .map(|at| {
                        graph
                            .follow(entries, at * 8)
                            .ok_or_else(|| Fail::EmptyLevelModel.into())
                    })
                    .collect(),
            }
        });
    listed.unwrap_or_else(|| Ok(Vec::new()))
}

/// Целевая модель: жёсткая с костью поиска, иначе жёсткая с костью 0, иначе любая жёсткая, иначе первая.
fn pick_target(graph: &Graph, models: &[usize], search: u8) -> Result<usize> {
    // (жёсткая ли, номер кости) по слову на +0x28 каждой модели
    let traits = models
        .iter()
        .map(|&model| {
            graph
                .word(model, 0x28)
                .map(|word| ((word >> 8) & 0xff == 0, (word >> 24) as u8))
        })
        .collect::<Result<Vec<_>>>()?;
    let rigid = || traits.iter().enumerate().filter(|(_, found)| found.0);
    let chosen = rigid()
        .find(|(_, found)| found.1 == search)
        .or_else(|| rigid().find(|(_, found)| found.1 == 0))
        .or_else(|| rigid().next())
        .map_or(0, |(at, _)| at);
    Ok(models[chosen])
}

/// Палитра костей геометрии, если она есть и не пуста.
fn palette_of(graph: &Graph, geometry: usize) -> Result<Option<Vec<u16>>> {
    let Some(block) = graph.follow(geometry, 0x68) else {
        return Ok(None);
    };
    let count = usize::from(graph.half(geometry, 0x72)?);
    let content = graph.content(block);
    if count == 0 || content.len() < 2 * count {
        return Ok(None);
    }
    Ok(Some(
        content
            .chunks_exact(2)
            .take(count)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect(),
    ))
}

/// Палитры костей геометрий модели: слот кости поиска и сама палитра.
fn find_palette(graph: &Graph, geometries: &[usize], search: u8) -> Result<(u8, Vec<u16>)> {
    let palettes = geometries
        .iter()
        .filter_map(|&geometry| palette_of(graph, geometry).transpose())
        .collect::<Result<Vec<_>>>()?;
    let slot_of = |palette: &[u16], bone: u8| palette.iter().position(|&id| id == u16::from(bone));
    let hit = palettes
        .iter()
        .find_map(|palette| slot_of(palette, search).map(|slot| (slot, palette)));
    let (slot, palette) = match hit {
        Some(found) => found,
        None => {
            let first = palettes.first().ok_or(Fail::NoPalette)?;
            (slot_of(first, 0).unwrap_or(0), first)
        }
    };
    Ok((slot as u8, palette.clone()))
}

// ========================================================= параметры шейдера

/// Запись таблицы параметров: хеш имени и вид.
struct Param {
    hash: u32,
    kind: u8,
}

/// Таблица параметров шейдера: блок и записи по порядку.
struct ParamTable {
    block: usize,
    rows: Vec<Param>,
}

impl ParamTable {
    /// Читает таблицу: число записей — байт `+0x10` шейдера, вид — первый байт записи, хеши лежат после данных
    /// (по 16 байт на вектор) и читаются прямо из области. Таблица шире блока или хеши за областью — отказ
    /// (раньше паника индексации, InternalError).
    fn read(graph: &Graph, shader: usize) -> Result<ParamTable> {
        let block = graph.follow(shader, 0).ok_or(Fail::NoParams)?;
        let count = usize::from(graph.content(shader)[0x10]);
        let table = graph.content(block);
        if count * 16 > table.len() {
            return Err(Fail::ParamsOverflow.into());
        }
        let kinds: Vec<u8> = (0..count).map(|row| table[row * 16]).collect();
        let data_len: usize = kinds.iter().map(|&kind| usize::from(kind) * 16).sum();
        let hashes = graph.blocks[block].start + count * 16 + data_len;
        let area = graph.bytes(graph.blocks[block].segment);
        if hashes + count * 4 > area.len() {
            return Err(Fail::ParamsOverflow.into());
        }
        let rows = kinds
            .into_iter()
            .enumerate()
            .map(|(row, kind)| Param {
                hash: le32(area, hashes + row * 4),
                kind,
            })
            .collect();
        Ok(ParamTable { block, rows })
    }

    /// Первая запись с этим хешем и видом.
    fn find(&self, hash: u32, kind: u8) -> Option<usize> {
        self.rows
            .iter()
            .position(|row| row.hash == hash && row.kind == kind)
    }
}

/// Готовая запись новой таблицы: цель текстуры или значение вектора.
enum Cell {
    Texture(Option<Address>),
    Vector([f32; 4]),
}

/// Блоки раскладки: по блоку на каждый вектор в порядке раскладки, затем блок параметров
/// (таблица, место под данные, хеши имён).
fn lay_params(graph: &mut Graph, layout: Layout, cells: &[Cell]) -> Result<Address> {
    let lanes: Vec<Option<Address>> = cells
        .iter()
        .map(|cell| match cell {
            Cell::Texture(_) => None,
            Cell::Vector(values) => {
                let mut data = vec![0u8; 16];
                for (at, value) in values.iter().enumerate() {
                    graft::write_f32(&mut data, at * 4, *value);
                }
                Some(graph.append(Segment::System, data, Vec::new()))
            }
        })
        .collect();
    let rows = layout.len();
    let vectors = lanes.iter().flatten().count();
    let hashes = rows * 16 + vectors * 16;
    let mut bytes = vec![0u8; hashes + rows * 4];
    // регистры строк: у игры вектор номер `j` лежит в `0xa0 + V − 1 − j`, лист номер `k` — в `0` или `k + 1`
    let (mut textures_seen, mut vectors_seen) = (0u8, 0usize);
    let slots = cells
        .iter()
        .zip(&lanes)
        .enumerate()
        .map(|(row, (cell, lane))| -> Result<Slot> {
            let target = match (cell, lane) {
                (Cell::Texture(target), _) => {
                    bytes[row * 16 + 1] = if textures_seen == 0 { 0 } else { textures_seen + 1 };
                    textures_seen += 1;
                    target.ok_or(Fail::TextureNoTarget)?
                }
                (Cell::Vector(_), lane) => {
                    bytes[row * 16] = KIND_VECTOR;
                    bytes[row * 16 + 1] = VECTOR_REGISTER_BASE + (vectors - 1 - vectors_seen) as u8;
                    vectors_seen += 1;
                    lane.expect("блок вектора создан выше")
                }
            };
            Ok(Slot {
                relative: row * 16 + 8,
                target,
            })
        })
        .collect::<Result<Vec<Slot>>>()?;
    for (row, &(name, _, _)) in layout.iter().enumerate() {
        let at = hashes + row * 4;
        bytes[at..at + 4].copy_from_slice(&hash::joaat(name).to_le_bytes());
    }
    Ok(graph.append(Segment::System, bytes, slots))
}

/// Запись новой таблицы по записи раскладки: значения и цели берутся у прежнего параметра с тем же именем.
fn carry_cell(
    graph: &Graph,
    old: &ParamTable,
    (param, kind, default): (&'static str, &'static str, [f32; 4]),
) -> Result<Cell> {
    let found = old
        .rows
        .iter()
        .position(|row| row.hash == hash::joaat(param));
    let target = found.and_then(|row| graph.pointer(old.block, row * 16 + 8));
    if kind == "Texture" {
        let is_texture = found.is_some_and(|row| old.rows[row].kind == KIND_TEXTURE);
        ensure(is_texture, Fail::NoParam(param))?;
        return Ok(Cell::Texture(target));
    }
    let mut values = default;
    if let (Some(row), Some(at)) = (found, target) {
        if old.rows[row].kind == KIND_VECTOR {
            let block = graph.block_at(at).ok_or(Fail::VectorOutside)?;
            let tail = &graph.content(block)[at.offset - graph.blocks[block].start..];
            for (slot, word) in values.iter_mut().zip(tail.chunks_exact(4)) {
                *slot = f32::from_bits(le32(word, 0));
            }
        }
    }
    Ok(Cell::Vector(values))
}

/// Подмена шейдера на штатную раскладку: значения векторов и цели текстур берутся у прежних параметров
/// с теми же именами, недостающие — штатные. Файл шейдера и корзину подмена не трогает.
pub(super) fn swap_shader(
    graph: &mut Graph,
    shader: usize,
    name: &str,
    layout: Layout,
) -> Result<()> {
    let old = ParamTable::read(graph, shader)?;
    let cells = layout
        .iter()
        .map(|&entry| carry_cell(graph, &old, entry))
        .collect::<Result<Vec<Cell>>>()?;
    let params = lay_params(graph, layout, &cells)?;
    rg::retarget(graph, shader, 0x00, params)?;
    graph.patch(shader, 0x10, &[layout.len() as u8])?;
    // длины новой таблицы: по первой игра находит хеши имён параметров, вторая — весь блок с хешами.
    // С длинами прежней раскладки имена читаются не с того места (свечение постера у навеса
    // `prop_busstop_04` после подмены `emissive_speclum` читалось нулём, 17.11.2026)
    let (table, block, textures) = param_sizes(&cells);
    graph.patch(shader, 0x14, &table.to_le_bytes())?;
    graph.patch(shader, 0x16, &block.to_le_bytes())?;
    graph.patch(shader, 0x27, &[textures])?;
    graph.patch(shader, 0x08, &hash::joaat(name).to_le_bytes())
}

/// Длины таблицы параметров шейдера, как их пишет игра: до хешей имён (строка и вектор — по 16 байт),
/// весь блок (таблица, хеши по 4 байта и 32 байта служебных, кратно 16) и число листов. Сверено с
/// шейдерами `emissive` (7 параметров: 208 и 272), `emissive_speclum` (8: 240 и 304), `normal_spec`
/// (11: 304 и 384) и `glass_breakable` (17: 496 и 608) из `prop_busstop_04.yft`.
fn param_sizes(cells: &[Cell]) -> (u16, u16, u8) {
    let vectors = cells
        .iter()
        .filter(|cell| matches!(cell, Cell::Vector(_)))
        .count();
    let table = cells.len() * 16 + vectors * 16;
    let block = (table + cells.len() * 4 + 32).div_ceil(16) * 16;
    (table as u16, block as u16, (cells.len() - vectors) as u8)
}

// ================================================================ геометрия

/// Вид новой геометрии: жёсткая в оси кости или со скином.
#[derive(Clone, Copy)]
enum Shape {
    Rigid,
    Skinned,
}

/// Типы всех слотов вершины в декларации, как их пишет игра (и хост): не только занятые слоты. Слова `0x55996996` и `0x77555555`
/// у каждой геометрии игры; игра берёт из них типы занятых слотов, но декларация с нулями в свободных слотах — не такая, как у неё.
const DECLARATION_TYPES: u64 = 0x7755_5555_5599_6996;

impl Shape {
    /// Слово флагов (занятые слоты вершины) и шаг вершины.
    fn facts(self) -> (u32, u16) {
        match self {
            Shape::Rigid => (0x59, 36),
            Shape::Skinned => (0x5f, 44),
        }
    }
}

fn floats_le(values: &[f32]) -> impl Iterator<Item = u8> + '_ {
    values.iter().flat_map(|value| value.to_le_bytes())
}

/// Жёсткие вершины: позиция и нормаль в оси кости, белый цвет, uv. Вторым значением — позиции после перехода.
fn rigid_vertices(part: &Part, inverse: &Mat) -> (Vec<u8>, Vec<[f32; 3]>) {
    let carried: Vec<_> = part
        .vertices()
        .map(|(position, normal, uv)| {
            (
                carry_point(inverse, position),
                carry_normal(inverse, normal),
                uv,
            )
        })
        .collect();
    let bytes = carried
        .iter()
        .flat_map(|(position, normal, uv)| {
            floats_le(position)
                .chain(floats_le(normal))
                .chain([0xff; 4])
                .chain(floats_le(uv))
        })
        .collect();
    (
        bytes,
        carried
            .into_iter()
            .map(|(position, _, _)| position)
            .collect(),
    )
}

/// Вершины со скином: позиция и нормаль как заданы, вес и индекс кости в третьем байте.
fn skinned_vertices(part: &Part, slot: u8) -> Vec<u8> {
    part.vertices()
        .flat_map(|(position, normal, uv)| {
            let mut one: Vec<u8> = Vec::with_capacity(44);
            one.extend(floats_le(&position));
            one.extend([0, 0, 0xff, 0, 0, 0, slot, 0]);
            one.extend(floats_le(&normal));
            one.extend([0xff; 4]);
            one.extend(floats_le(&uv));
            one
        })
        .collect()
}

/// Запись рамки геометрии: `min.xyz, min.x, max.xyz, max.x`.
fn bounds_record(points: impl Iterator<Item = [f32; 3]>) -> [u8; BOUNDS_RECORD] {
    let (low, high) = points.fold(EMPTY_REACH, |(low, high), point| {
        (merge(low, point, f32::min), merge(high, point, f32::max))
    });
    let words = [
        low[0], low[1], low[2], low[0], high[0], high[1], high[2], high[0],
    ];
    let mut record = [0u8; BOUNDS_RECORD];
    for (word, slot) in words.iter().zip(record.chunks_exact_mut(4)) {
        slot.copy_from_slice(&word.to_le_bytes());
    }
    record
}

// ================================================================== матрицы

/// Матрица 4×4 по строкам, точка — строка-вектор.
type Mat = [f32; 16];

/// Матрица с одним числом по главной диагонали.
const fn diagonal(value: f32) -> Mat {
    let mut matrix = [0.0; 16];
    let mut at = 0;
    while at < 16 {
        matrix[at] = value;
        at += 5;
    }
    matrix
}

const IDENTITY: Mat = diagonal(1.0);

fn mul(a: &Mat, b: &Mat) -> Mat {
    std::array::from_fn(|at| {
        let (row, column) = (at / 4, at % 4);
        (0..4)
            .map(|k| a[row * 4 + k] * b[k * 4 + column])
            .sum::<f32>()
    })
}

fn float_at(record: &[u8], at: usize) -> f32 {
    f32::from_bits(le32(record, at))
}

/// Локальная матрица кости `(масштаб · поворот) · перенос` и номер родителя.
fn local_matrix(record: &[u8]) -> (Mat, i16) {
    let [x, y, z, w] = std::array::from_fn(|at| float_at(record, at * 4));
    let [sx, sy, sz] = std::array::from_fn(|at| {
        let scale = float_at(record, 0x20 + at * 4);
        if scale == 0.0 {
            1.0
        } else {
            scale
        }
    });
    let [tx, ty, tz] = std::array::from_fn(|at| float_at(record, 0x10 + at * 4));
    let size = [
        sx, 0.0, 0.0, 0.0, 0.0, sy, 0.0, 0.0, 0.0, 0.0, sz, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let turn = [
        1.0 - 2.0 * (y * y + z * z),
        2.0 * (x * y + w * z),
        2.0 * (x * z - w * y),
        0.0,
        2.0 * (x * y - w * z),
        1.0 - 2.0 * (x * x + z * z),
        2.0 * (y * z + w * x),
        0.0,
        2.0 * (x * z + w * y),
        2.0 * (y * z - w * x),
        1.0 - 2.0 * (x * x + y * y),
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ];
    let shift = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, tx, ty, tz, 1.0,
    ];
    let parent = i16::from_le_bytes([record[0x32], record[0x33]]);
    (mul(&mul(&size, &turn), &shift), parent)
}

/// Мировые матрицы костей скелета модели; нет скелета или костей — пусто.
fn bone_pose(graph: &Graph, drawable: usize) -> Result<Vec<Mat>> {
    let Some(skeleton) = graph.follow(drawable, 0x18) else {
        return Ok(Vec::new());
    };
    let count = usize::from(graph.half(skeleton, 0x5e)?);
    let Some(bones) = graph.follow(skeleton, 0x20) else {
        return Ok(Vec::new());
    };
    let content = graph.content(bones);
    let locals = (0..count)
        .map(|at| {
            content
                .get(at * BONE_RECORD..(at + 1) * BONE_RECORD)
                .map(local_matrix)
                .ok_or(Fail::BoneOutside)
        })
        .collect::<std::result::Result<Vec<_>, Fail>>()?;
    let world = locals.iter().enumerate().fold(
        Vec::with_capacity(count),
        |mut world: Vec<Mat>, (at, (local, parent))| {
            let joined = match usize::try_from(*parent) {
                Ok(up) if up < at => mul(local, &world[up]),
                _ => *local,
            };
            world.push(joined);
            world
        },
    );
    Ok(world)
}

/// Слагаемые элементов обратной матрицы: номер элемента и шесть слагаемых (знак «плюс», три индекса).
type Cofactors = Vec<(usize, Vec<(bool, [usize; 3])>)>;

fn cofactor_rows() -> &'static Cofactors {
    static ROWS: OnceLock<Cofactors> = OnceLock::new();
    ROWS.get_or_init(|| {
        COFACTOR_TEXT
            .split(';')
            .filter_map(|row| row.split_once(':'))
            .map(|(slot, terms)| {
                let terms = terms
                    .split_whitespace()
                    .map(|term| {
                        let indices: Vec<usize> = term[1..]
                            .split('.')
                            .filter_map(|n| n.parse().ok())
                            .collect();
                        (term.starts_with('+'), [indices[0], indices[1], indices[2]])
                    })
                    .collect();
                (slot.trim().parse().unwrap_or(0), terms)
            })
            .collect()
    })
}

/// Обратная матрица методом алгебраических дополнений; почти нулевой определитель — единичная.
fn invert(m: &Mat) -> Mat {
    let mut out = [0.0f32; 16];
    for (slot, terms) in cofactor_rows() {
        out[*slot] = terms
            .iter()
            .map(|&(plus, [a, b, c])| {
                let product = m[a] * m[b] * m[c];
                if plus {
                    product
                } else {
                    -product
                }
            })
            .reduce(|sum, term| sum + term)
            .unwrap_or_default();
    }
    let det = (0..4)
        .map(|column| m[column] * out[column * 4])
        .reduce(|sum, term| sum + term)
        .unwrap_or_default();
    match det.abs() < 1e-12 {
        true => IDENTITY,
        false => {
            let scale = 1.0 / det;
            out.map(|value| value * scale)
        }
    }
}

/// Сумма произведений `v[k] · m[4k + a]` слева направо.
fn row_times(m: &Mat, v: [f32; 3], a: usize) -> f32 {
    (0..3)
        .map(|k| v[k] * m[4 * k + a])
        .reduce(|sum, term| sum + term)
        .unwrap_or_default()
}

fn carry_point(m: &Mat, p: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|a| row_times(m, p, a) + m[12 + a])
}

fn carry_normal(m: &Mat, n: [f32; 3]) -> [f32; 3] {
    let moved: [f32; 3] = std::array::from_fn(|a| row_times(m, n, a));
    let length = squares(moved).sqrt();
    if length < 1e-12 {
        moved
    } else {
        moved.map(|value| value / length)
    }
}

// ==================================================================== данные

const PRESETS: [&str; 5] = [
    "alpha.sps",
    "spec_alpha.sps",
    "normal_alpha.sps",
    "normal_spec_alpha.sps",
    "emissive_alpha.sps",
];

/// Раскладка параметров штатного шейдера: имя, вид (`"Texture"` или вектор), значение вектора по умолчанию.
pub(super) type Layout = &'static [(&'static str, &'static str, [f32; 4])];

/// Штатные раскладки: имя подмены и записи через «;» — `Имя*` для текстуры, `Имя x y z w` для вектора.
const LAYOUT_TEXT: [(&str, &str); 4] = [
    (
        "default",
        "DiffuseSampler*; matMaterialColorScale 1 0 0 1; HardAlphaBlend 1 0 0 0; useTessellation 0 0 0 0; \
         wetnessMultiplier 1 0 0 0; globalAnimUV1 0 1 0 0; globalAnimUV0 1 0 0 0",
    ),
    (
        "normal",
        "DiffuseSampler*; BumpSampler*; HardAlphaBlend 1 0 0 0; useTessellation 0 0 0 0; wetnessMultiplier 1 0 0 0; \
         bumpiness 1 0 0 0; specularIntensityMult 0.125 0 0 0; specularFalloffMult 100 0 0 0; specularFresnel 0.97 0 0 0",
    ),
    (
        "normal_spec",
        "DiffuseSampler*; BumpSampler*; SpecSampler*; HardAlphaBlend 1 0 0 0; useTessellation 0 0 0 0; \
         wetnessMultiplier 1 0 0 0; bumpiness 1 0 0 0; specMapIntMask 1 0 0 0; specularIntensityMult 1 0 0 0; \
         specularFalloffMult 100 0 0 0; specularFresnel 0.97 0 0 0",
    ),
    (
        "emissive",
        "DiffuseSampler*; matMaterialColorScale 1 0 0 1; HardAlphaBlend 1 0 0 0; useTessellation 0 0 0 0; \
         emissiveMultiplier 1 0 0 0; globalAnimUV1 0 1 0 0; globalAnimUV0 1 0 0 0",
    ),
];

fn parse_layout(text: &'static str) -> Vec<(&'static str, &'static str, [f32; 4])> {
    text.split(';')
        .map(str::trim)
        .map(|entry| match entry.strip_suffix('*') {
            Some(name) => (name, "Texture", [0.0; 4]),
            None => {
                let mut words = entry.split_whitespace();
                let name = words.next().unwrap_or_default();
                let mut value = [0.0f32; 4];
                for (slot, word) in value.iter_mut().zip(words) {
                    *slot = word.parse().unwrap_or(0.0);
                }
                (name, "Vector", value)
            }
        })
        .collect()
}

/// Четыре штатные раскладки, по которым шейдер подменяется.
#[derive(Clone, Copy)]
enum Standard {
    Default,
    Normal,
    NormalSpec,
    Emissive,
}

impl Standard {
    const ALL: [Standard; 4] = [
        Standard::Default,
        Standard::Normal,
        Standard::NormalSpec,
        Standard::Emissive,
    ];

    fn name(self) -> &'static str {
        LAYOUT_TEXT[self as usize].0
    }

    fn named(text: &str) -> Option<Standard> {
        Standard::ALL.into_iter().find(|known| known.name() == text)
    }

    fn layout(self) -> Layout {
        type Rows = Vec<(&'static str, &'static str, [f32; 4])>;
        static PARSED: OnceLock<[Rows; 4]> = OnceLock::new();
        let all = PARSED.get_or_init(|| LAYOUT_TEXT.map(|(_, text)| parse_layout(text)));
        &all[self as usize]
    }
}

/// Слагаемые обратной матрицы: `номер: ±a.b.c …`, знак — у произведения `m[a]·m[b]·m[c]`.
const COFACTOR_TEXT: &str = "\
0: +5.10.15 -5.11.14 -9.6.15 +9.7.14 +13.6.11 -13.7.10; \
4: -4.10.15 +4.11.14 +8.6.15 -8.7.14 -12.6.11 +12.7.10; \
8: +4.9.15 -4.11.13 -8.5.15 +8.7.13 +12.5.11 -12.7.9; \
12: -4.9.14 +4.10.13 +8.5.14 -8.6.13 -12.5.10 +12.6.9; \
1: -1.10.15 +1.11.14 +9.2.15 -9.3.14 -13.2.11 +13.3.10; \
5: +0.10.15 -0.11.14 -8.2.15 +8.3.14 +12.2.11 -12.3.10; \
9: -0.9.15 +0.11.13 +8.1.15 -8.3.13 -12.1.11 +12.3.9; \
13: +0.9.14 -0.10.13 -8.1.14 +8.2.13 +12.1.10 -12.2.9; \
2: +1.6.15 -1.7.14 -5.2.15 +5.3.14 +13.2.7 -13.3.6; \
6: -0.6.15 +0.7.14 +4.2.15 -4.3.14 -12.2.7 +12.3.6; \
10: +0.5.15 -0.7.13 -4.1.15 +4.3.13 +12.1.7 -12.3.5; \
14: -0.5.14 +0.6.13 +4.1.14 -4.2.13 -12.1.6 +12.2.5; \
3: -1.6.11 +1.7.10 +5.2.11 -5.3.10 -9.2.7 +9.3.6; \
7: +0.6.11 -0.7.10 -4.2.11 +4.3.10 +8.2.7 -8.3.6; \
11: -0.5.11 +0.7.9 +4.1.11 -4.3.9 -8.1.7 +8.3.5; \
15: +0.5.10 -0.6.9 -4.1.10 +4.2.9 +8.1.6 -8.2.5";

// ============================================================ вход команды

/// Служебное слово корня фрагмента (число 3,362375 как слово).
pub(super) const HOST_FRAGMENT_RADIUS: u32 = 0x4057_3128;
/// Служебное слово модели (число 3,506578 как слово).
pub(super) const HOST_MODEL_RADIUS: u32 = 0x4060_6bc8;

pub const COMMANDS: &[Command] = &[Command::new("lamp-pole", lamp_pole)];

/// Открытая модель: граф, число костей и листы словаря до правки.
struct Opened {
    bench: Bench,
    bones: u16,
    known: Vec<(String, Address)>,
}

fn open_model(job: &Job) -> Result<Opened> {
    let raw = fs::read(&job.model)?;
    ensure((1..=limits::MODEL).contains(&raw.len()), Fail::ModelSize)?;
    let resource = Resource::parse(&raw)?;
    ensure(resource.version() == VERSION_FRAGMENT, Fail::NotFragment)?;
    let bench = Bench::from_graph(rg::scan(&resource)?)?;
    let bones = bench.bone_count()?;
    let known = bench.sheet_objects()?;
    Ok(Opened {
        bench,
        bones,
        known,
    })
}

/// Результат перечитывается до записи: число костей прежнее, листов не меньше «было плюс добавленные».
fn reopen(bytes: &[u8], bones: u16, sheets: usize) -> Result<u16> {
    let again = Bench::from_graph(rg::scan(&Resource::parse(bytes)?)?)?;
    let found = (again.bone_count()?, again.sheet_objects()?.len());
    ensure(found.0 == bones && found.1 >= sheets, Fail::Reopen)?;
    Ok(found.0)
}

fn pairs<const N: usize>(items: [(&str, Value); N]) -> Value {
    Value::Object(
        items
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Листы по порядку вставки в словарь модели; уже имеющиеся имена отказывают раньше первого файла DDS.
fn add_sheets(bench: &mut Bench, known: &[(String, Address)], sheets: &[&Sheet]) -> Result<()> {
    for sheet in sheets {
        let taken = known
            .iter()
            .any(|(name, _)| name.to_lowercase() == sheet.name);
        ensure(!taken, Fail::Present(sheet.name.clone()))?;
    }
    sheets
        .iter()
        .enumerate()
        .try_for_each(|(position, sheet)| bench.insert_sheet(position, sheet.texture()?))
}

/// Правки шейдеров, украшение, маски и рост рамки. Возвращает число пресетов и итог украшения.
fn reshape(bench: &mut Bench, job: &Job) -> Result<(usize, Placed)> {
    let presets = bench.edit_shaders(&job.edits, &job.textures)?;
    let placed = match &job.decoration {
        Some(deco) => bench.decorate(deco)?,
        None => Placed::default(),
    };
    bench.stamp_masks()?;
    if let Some((low, high)) = placed.reach {
        bench.grow_frame(low, high)?;
    }
    Ok((presets, placed))
}

/// Ответ команды: файл, размер, сумма и сводка перечитанного результата.
fn answer(
    output: &std::path::Path,
    bytes: &[u8],
    names: Vec<&str>,
    (bones, presets): (u16, usize),
    decorated: Map<String, Value>,
) -> Value {
    let file = output
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let semantic = pairs([
        ("semanticReopen", Value::Bool(true)),
        ("bones", Value::from(bones)),
        ("textures", Value::from(names)),
        ("transparent", Value::from(presets)),
        ("decorated", Value::Object(decorated)),
    ]);
    pairs([
        ("file", Value::from(file)),
        ("bytes", Value::from(bytes.len())),
        ("sha256", Value::from(hash::sha256_hex(bytes))),
        ("semantic", semantic),
    ])
}

fn lamp_pole(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = Job::load(options.required("input")?)?;
    // Папка выхода создаётся раньше проверок модели; отказ убирает созданное, пока оно пусто.
    let created = FreshDirs::beside(options.required("output"));
    let output = paths::output_file(options.required("output")?, &[".yft"])?;

    let Opened {
        mut bench,
        bones,
        known,
    } = open_model(&job)?;
    let sheets = job.sheets();
    add_sheets(&mut bench, &known, &sheets)?;
    let (presets, placed) = reshape(&mut bench, &job)?;

    let bytes = bench.finish(sheets.first().map(|sheet| sheet.name.as_str()))?;
    let bones_after = reopen(&bytes, bones, known.len() + sheets.len())?;
    shop::write_atomic(&output, &bytes)?;
    created.keep();

    let names = sheets.iter().map(|sheet| sheet.name.as_str()).collect();
    Ok(answer(
        &output,
        &bytes,
        names,
        (bones_after, presets),
        placed.report,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::graft::{bounds_bytes, records_of, shader_blocks, write_f32};
    use crate::commands::shop::texture_objects;
    use crate::commands::split::{geometry_blocks, mapping_of, pointer_block, u16_at, u32_at};
    use rage_res::hash::{joaat, sha256_hex};
    use rage_res::texture::Format;
    use serde_json::json;
    use tempfile::TempDir;

    fn standard_layout(name: &str) -> Layout {
        Standard::named(name).expect("штатная раскладка").layout()
    }

    const OLD_DEFAULT_LAYOUT: Layout = &[
        ("DiffuseSampler", "Texture", [0.0; 4]),
        ("matMaterialColorScale", "Vector", [1.0, 0.0, 0.0, 1.0]),
        ("HardAlphaBlend", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("useTessellation", "Vector", [0.0; 4]),
        ("wetnessMultiplier", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("globalAnimUV1", "Vector", [0.0, 1.0, 0.0, 0.0]),
        ("globalAnimUV0", "Vector", [1.0, 0.0, 0.0, 0.0]),
    ];

    const OLD_NORMAL_LAYOUT: Layout = &[
        ("DiffuseSampler", "Texture", [0.0; 4]),
        ("BumpSampler", "Texture", [0.0; 4]),
        ("HardAlphaBlend", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("useTessellation", "Vector", [0.0; 4]),
        ("wetnessMultiplier", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("bumpiness", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("specularIntensityMult", "Vector", [0.125, 0.0, 0.0, 0.0]),
        ("specularFalloffMult", "Vector", [100.0, 0.0, 0.0, 0.0]),
        ("specularFresnel", "Vector", [0.97, 0.0, 0.0, 0.0]),
    ];

    const OLD_NORMAL_SPEC_LAYOUT: Layout = &[
        ("DiffuseSampler", "Texture", [0.0; 4]),
        ("BumpSampler", "Texture", [0.0; 4]),
        ("SpecSampler", "Texture", [0.0; 4]),
        ("HardAlphaBlend", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("useTessellation", "Vector", [0.0; 4]),
        ("wetnessMultiplier", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("bumpiness", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("specMapIntMask", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("specularIntensityMult", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("specularFalloffMult", "Vector", [100.0, 0.0, 0.0, 0.0]),
        ("specularFresnel", "Vector", [0.97, 0.0, 0.0, 0.0]),
    ];

    const OLD_EMISSIVE_LAYOUT: Layout = &[
        ("DiffuseSampler", "Texture", [0.0; 4]),
        ("matMaterialColorScale", "Vector", [1.0, 0.0, 0.0, 1.0]),
        ("HardAlphaBlend", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("useTessellation", "Vector", [0.0; 4]),
        ("emissiveMultiplier", "Vector", [1.0, 0.0, 0.0, 0.0]),
        ("globalAnimUV1", "Vector", [0.0, 1.0, 0.0, 0.0]),
        ("globalAnimUV0", "Vector", [1.0, 0.0, 0.0, 0.0]),
    ];

    #[test]
    fn parsed_layouts_equal_the_recorded_tables() {
        for (name, expected) in [
            ("default", OLD_DEFAULT_LAYOUT),
            ("normal", OLD_NORMAL_LAYOUT),
            ("normal_spec", OLD_NORMAL_SPEC_LAYOUT),
            ("emissive", OLD_EMISSIVE_LAYOUT),
        ] {
            assert_eq!(standard_layout(name), expected, "{name}");
        }
        assert_eq!(Standard::named("Default").map(Standard::name), None);
    }

    const SYS: u64 = 0x5000_0000;
    const GFX: u64 = 0x6000_0000;

    // ------------------------------------------------------------ образец фрагмента

    #[derive(Default)]
    struct Areas {
        sys: Vec<u8>,
        gfx: Vec<u8>,
    }

    fn grow(area: &mut Vec<u8>, len: usize) -> usize {
        let at = area.len().next_multiple_of(16);
        area.resize(at + len.next_multiple_of(16), 0);
        at
    }

    impl Areas {
        fn block(&mut self, len: usize) -> usize {
            grow(&mut self.sys, len)
        }
        fn graphics(&mut self, len: usize) -> usize {
            grow(&mut self.gfx, len)
        }
        fn set(&mut self, at: usize, bytes: &[u8]) {
            self.sys[at..at + bytes.len()].copy_from_slice(bytes);
        }
        fn u16(&mut self, at: usize, value: u16) {
            self.set(at, &value.to_le_bytes());
        }
        fn u32(&mut self, at: usize, value: u32) {
            self.set(at, &value.to_le_bytes());
        }
        fn f32s(&mut self, at: usize, values: &[f32]) {
            for (slot, value) in values.iter().enumerate() {
                self.set(at + slot * 4, &value.to_le_bytes());
            }
        }
        fn link(&mut self, at: usize, target: usize) {
            self.set(at, &(SYS + target as u64).to_le_bytes());
        }
        fn link_graphics(&mut self, at: usize, target: usize) {
            self.set(at, &(GFX + target as u64).to_le_bytes());
        }
    }

    #[derive(Clone)]
    struct GeometrySpec {
        vertices: usize,
        palette: Vec<u16>,
    }

    #[derive(Clone)]
    struct ModelSpec {
        word: u32,
        mask: u16,
        mapping: Vec<u16>,
        geometries: Vec<GeometrySpec>,
    }

    #[derive(Clone)]
    struct BoneSpec {
        quaternion: [f32; 4],
        translation: [f32; 3],
        scale: [f32; 3],
        parent: i16,
    }

    #[derive(Clone)]
    struct ShaderSpec {
        name: &'static str,
        layout: Layout,
        bucket: u8,
        texture: &'static str,
    }

    #[derive(Clone)]
    struct Spec {
        shaders: Vec<ShaderSpec>,
        textures: Vec<&'static str>,
        bones: Vec<BoneSpec>,
        levels: [Vec<ModelSpec>; 3],
        level_flags: [u32; 3],
    }

    fn plain_geometry() -> GeometrySpec {
        GeometrySpec {
            vertices: 3,
            palette: Vec::new(),
        }
    }

    fn rigid_model(bone: u32, mapping: &[u16]) -> ModelSpec {
        ModelSpec {
            word: bone << 24,
            mask: 0x0100,
            mapping: mapping.to_vec(),
            geometries: mapping.iter().map(|_| plain_geometry()).collect(),
        }
    }

    fn bone(translation: [f32; 3], parent: i16) -> BoneSpec {
        BoneSpec {
            quaternion: [0.0, 0.0, 0.0, 1.0],
            translation,
            scale: [1.0; 3],
            parent,
        }
    }

    /// Фонарь поменьше настоящего: четыре шейдера, словарь из двух листов, четыре кости, три уровня.
    fn standard() -> Spec {
        let half = std::f32::consts::FRAC_1_SQRT_2;
        let turned = BoneSpec {
            quaternion: [0.0, 0.0, half, half],
            translation: [0.0; 3],
            scale: [1.0; 3],
            parent: 1,
        };
        Spec {
            shaders: vec![
                ShaderSpec {
                    name: "normal_spec",
                    layout: standard_layout("normal_spec"),
                    bucket: 0,
                    texture: "prop_a",
                },
                ShaderSpec {
                    name: "default",
                    layout: standard_layout("default"),
                    bucket: 0,
                    texture: "prop_a",
                },
                ShaderSpec {
                    name: "normal",
                    layout: standard_layout("normal"),
                    bucket: 1,
                    texture: "prop_b",
                },
                ShaderSpec {
                    name: "default",
                    layout: standard_layout("default"),
                    bucket: 3,
                    texture: "prop_b",
                },
            ],
            textures: vec!["prop_a", "prop_b"],
            bones: vec![
                bone([0.0; 3], -1),
                bone([1.0, 2.0, 3.0], 0),
                turned,
                bone([0.0, 0.0, 5.0], -1),
            ],
            levels: [
                vec![rigid_model(0, &[0]), rigid_model(1, &[1, 2])],
                vec![rigid_model(0, &[3])],
                vec![rigid_model(0, &[3])],
            ],
            level_flags: [0x10, 0x20, 0x20],
        }
    }

    fn tiny_texture(name: &str) -> NewTexture {
        NewTexture {
            name: name.to_owned(),
            width: 4,
            height: 4,
            format: Format::Dxt1,
            levels: 1,
            payload: vec![0x11; 8],
        }
    }

    fn block_at(graph: &Graph, offset: usize) -> usize {
        graph
            .block_at(Address {
                segment: Segment::System,
                offset,
            })
            .expect("блок на месте")
    }

    /// Собирает граф фрагмента по описанию; словарь текстур — писателем YTD и `graft`.
    fn build(spec: &Spec) -> Graph {
        let mut a = Areas::default();
        let root = a.block(0x60);
        let drawable = a.block(0xa0);
        a.link(root + 0x30, drawable);
        a.u32(root, 0x4057_1138);
        a.f32s(root + 0x20, &[0.0, -0.9768, 4.6238, 4.927]);
        a.u32(drawable, 0x4060_4bc8);
        a.f32s(drawable + 0x20, &[0.0, -0.9768, 4.6238]);
        a.f32s(drawable + 0x2c, &[4.927]);
        a.f32s(drawable + 0x30, &[-0.3952, -2.4175, -0.0712]);
        a.f32s(drawable + 0x40, &[0.3952, 0.4639, 9.3189]);

        let group = a.block(0x20);
        a.link(drawable + 0x10, group);
        let stand_in = if spec.textures.is_empty() {
            Some(a.block(0x90))
        } else {
            None
        };
        let count = spec.shaders.len();
        let list = a.block(8 * count.max(1));
        a.link(group + 0x10, list);
        a.u16(group + 0x18, count as u16);
        for (at, shader) in spec.shaders.iter().enumerate() {
            let block = a.block(0x30);
            a.link(list + 8 * at, block);
            let rows = shader.layout.len();
            let vectors = shader
                .layout
                .iter()
                .filter(|row| row.1 != "Texture")
                .count();
            let params = a.block(rows * 16 + vectors * 16 + rows * 4);
            a.link(block, params);
            a.u32(block + 0x08, joaat(shader.name));
            a.set(block + 0x10, &[rows as u8, shader.bucket]);
            // длины таблицы параметров, маска корзин и число листов — как у шейдеров игры
            let (table, whole) = sizes_of(rows, vectors);
            a.set(block + 0x14, &table.to_le_bytes());
            a.set(block + 0x16, &whole.to_le_bytes());
            a.u32(block + 0x20, 0xFF00 | (1 << shader.bucket));
            a.set(block + 0x27, &[(rows - vectors) as u8]);
            // метка «прочих байт»: её не трогает ни подмена, ни перевод в прозрачные
            a.u32(block + 0x28, 0xABCD_0001 + at as u32);
            a.u32(block + 0x18, joaat(&format!("{}.sps", shader.name)));
            let mut next = 0;
            for (row, (name, kind, value)) in shader.layout.iter().enumerate() {
                a.u32(params + rows * 16 + vectors * 16 + row * 4, joaat(name));
                if let ("Texture", Some(object)) = (*kind, stand_in) {
                    a.link(params + row * 16 + 8, object);
                }
                if *kind != "Texture" {
                    a.set(params + row * 16, &[1]);
                    let data = params + rows * 16 + next * 16;
                    next += 1;
                    a.link(params + row * 16 + 8, data);
                    a.f32s(data, value);
                }
            }
        }

        if !spec.bones.is_empty() {
            let skeleton = a.block(0x70);
            a.link(drawable + 0x18, skeleton);
            a.u16(skeleton + 0x5e, spec.bones.len() as u16);
            let bones = a.block(spec.bones.len() * 0x50);
            a.link(skeleton + 0x20, bones);
            for (at, item) in spec.bones.iter().enumerate() {
                let record = bones + at * 0x50;
                a.f32s(record, &item.quaternion);
                a.f32s(record + 0x10, &item.translation);
                a.f32s(record + 0x20, &item.scale);
                a.set(record + 0x32, &item.parent.to_le_bytes());
            }
        }

        for (level, models) in spec.levels.iter().enumerate() {
            if models.is_empty() {
                continue;
            }
            let header = a.block(16);
            a.link(drawable + 0x50 + 8 * level, header);
            a.u16(header + 8, models.len() as u16);
            let entries = a.block(8 * models.len());
            a.link(header, entries);
            a.u32(drawable + 0x80 + 4 * level, spec.level_flags[level]);
            for (at, model) in models.iter().enumerate() {
                let block = a.block(0x40);
                a.link(entries + 8 * at, block);
                let count = model.geometries.len();
                a.u32(block + 0x28, model.word);
                a.u16(block + 0x2c, model.mask);
                for relative in [0x10, 0x12, 0x2e] {
                    a.u16(block + relative, count as u16);
                }
                let geometries = a.block(8 * count);
                a.link(block + 0x08, geometries);
                let frames = a.block(32 * (count + usize::from(count > 1)));
                a.link(block + 0x18, frames);
                let mapping = a.block(2 * count);
                a.link(block + 0x20, mapping);
                for (slot, number) in model.mapping.iter().enumerate() {
                    a.u16(mapping + 2 * slot, *number);
                }
                let mut records = Vec::new();
                for (slot, geometry) in model.geometries.iter().enumerate() {
                    let g = a.block(0x80);
                    a.link(geometries + 8 * slot, g);
                    let vb = a.block(0x40);
                    let ib = a.block(0x20);
                    let declaration = a.block(16);
                    a.link(g + 0x18, vb);
                    a.link(g + 0x38, ib);
                    a.link(vb + 0x30, declaration);
                    let stride = if geometry.palette.is_empty() { 36 } else { 44 };
                    a.u16(vb + 0x08, stride as u16);
                    a.u32(vb + 0x18, geometry.vertices as u32);
                    let data = a.graphics(stride * geometry.vertices);
                    a.link_graphics(vb + 0x10, data);
                    a.link_graphics(vb + 0x20, data);
                    a.u32(ib + 0x08, 3);
                    let indices = a.graphics(6);
                    a.link_graphics(ib + 0x10, indices);
                    if !geometry.palette.is_empty() {
                        let palette = a.block(2 * geometry.palette.len());
                        a.link(g + 0x68, palette);
                        a.u16(g + 0x72, geometry.palette.len() as u16);
                        for (place, id) in geometry.palette.iter().enumerate() {
                            a.u16(palette + 2 * place, *id);
                        }
                    }
                    let base = slot as f32;
                    let mut record = [0u8; BOUNDS_RECORD];
                    for (place, value) in [
                        base,
                        base,
                        base,
                        base,
                        base + 1.0,
                        base + 1.0,
                        base + 1.0,
                        base + 1.0,
                    ]
                    .iter()
                    .enumerate()
                    {
                        write_f32(&mut record, place * 4, *value);
                    }
                    records.push(record);
                }
                a.set(frames, &bounds_bytes(&records));
            }
        }

        let mut graph = rg::from_parts(0xA2, 0xA000_0000, 0x2000_0000, a.sys, a.gfx);
        if !spec.textures.is_empty() {
            let pack: Vec<NewTexture> = spec
                .textures
                .iter()
                .map(|name| tiny_texture(name))
                .collect();
            let standalone =
                rg::scan(&Resource::parse(&ytd_write::write(&pack).unwrap()).unwrap()).unwrap();
            let (merged, dictionary) = rg::graft(&graph, &standalone).unwrap();
            graph = merged;
            let group_block = block_at(&graph, group);
            graph.blocks[group_block].slots.push(Slot {
                relative: 8,
                target: dictionary,
            });
            let objects = texture_objects(&graph, dictionary).unwrap();
            for (at, shader) in spec.shaders.iter().enumerate() {
                let target = objects
                    .iter()
                    .find(|(name, _)| name == shader.texture)
                    .unwrap()
                    .1;
                let table = pointer_block(
                    &graph,
                    pointer_block(&graph, block_at(&graph, list), at * 8).unwrap(),
                    0,
                )
                .unwrap();
                for (row, item) in shader.layout.iter().enumerate() {
                    if item.1 == "Texture" {
                        graph.blocks[table].slots.push(Slot {
                            relative: row * 16 + 8,
                            target,
                        });
                    }
                }
            }
        }
        graph
    }

    fn pack(graph: &Graph) -> Vec<u8> {
        let system = rg::identity_order(graph, Segment::System);
        let graphics = rg::identity_order(graph, Segment::Graphics);
        rg::rebuild_with(graph, &system, &graphics, &meta_graph::deflate_body).unwrap()
    }

    /// Блок, до которого дойдёшь по цепочке смещений указателей.
    fn nav(graph: &Graph, start: usize, path: &[usize]) -> usize {
        path.iter().fold(start, |block, &relative| {
            pointer_block(graph, block, relative)
                .unwrap_or_else(|| panic!("нет указателя +{relative:#x}"))
        })
    }

    fn cut(graph: &mut Graph, block: usize, relative: usize) {
        graph.blocks[block]
            .slots
            .retain(|slot| slot.relative != relative);
        rg::write_at(graph, block, relative, &[0u8; 8]).unwrap();
    }

    fn poke(graph: &mut Graph, block: usize, relative: usize, bytes: &[u8]) {
        rg::write_at(graph, block, relative, bytes).unwrap();
    }

    fn drawable_of(graph: &Graph) -> usize {
        nav(graph, graph.root().unwrap(), &[0x30])
    }

    fn group_of(graph: &Graph) -> usize {
        nav(graph, drawable_of(graph), &[0x10])
    }

    /// Первая модель высокого уровня.
    fn high_model(graph: &Graph) -> usize {
        nav(graph, drawable_of(graph), &[0x50, 0, 0])
    }

    fn open(bytes: &[u8]) -> Bench {
        Bench::from_graph(rg::scan(&Resource::parse(bytes).unwrap()).unwrap()).unwrap()
    }

    // ----------------------------------------------------------------- DDS

    /// DDS по рецепту из описания: блоки DXT1 или DXT5 по затравке.
    fn make_dds(fourcc: &[u8; 4], width: u32, height: u32, levels: u32, seed: u32) -> Vec<u8> {
        let block_bytes: usize = if fourcc == b"DXT1" || fourcc == b"dxt1" {
            8
        } else {
            16
        };
        let blocks = |level: u32| {
            ((width >> level).max(1) as usize).div_ceil(4)
                * ((height >> level).max(1) as usize).div_ceil(4)
        };
        let mut out = vec![0u8; 128];
        out[0..4].copy_from_slice(b"DDS ");
        out[4..8].copy_from_slice(&124u32.to_le_bytes());
        let flags: u32 = 0x80000 | 0x1007 | if levels > 1 { 0x20000 } else { 0 };
        out[8..12].copy_from_slice(&flags.to_le_bytes());
        out[12..16].copy_from_slice(&height.to_le_bytes());
        out[16..20].copy_from_slice(&width.to_le_bytes());
        out[20..24].copy_from_slice(&((blocks(0) * block_bytes) as u32).to_le_bytes());
        out[28..32].copy_from_slice(&levels.to_le_bytes());
        out[76..80].copy_from_slice(&32u32.to_le_bytes());
        out[80..84].copy_from_slice(&4u32.to_le_bytes());
        out[84..88].copy_from_slice(fourcc);
        let caps: u32 = 0x1000 | if levels > 1 { 0x400008 } else { 0 };
        out[108..112].copy_from_slice(&caps.to_le_bytes());
        for level in 0..levels {
            for block in 0..blocks(level) as u32 {
                let c0 = (seed
                    .wrapping_mul(2111)
                    .wrapping_add(level * 37)
                    .wrapping_add(block * 11)
                    & 0xffff) as u16
                    | 1;
                let c1 =
                    ((seed.wrapping_mul(977).wrapping_add(block * 13) & 0xffff) as u16) & 0xfffe;
                if block_bytes == 8 {
                    out.extend_from_slice(&c0.to_le_bytes());
                    out.extend_from_slice(&c1.to_le_bytes());
                    out.extend_from_slice(
                        &seed
                            .wrapping_mul(0x0101_0101)
                            .wrapping_add(block.wrapping_mul(0x0403_0201))
                            .to_le_bytes(),
                    );
                } else {
                    out.push((255 - seed % 64) as u8);
                    out.push(((seed * 3) & 0xff) as u8);
                    for k in 2..8u32 {
                        out.push(((seed * k + block) & 0xff) as u8);
                    }
                    out.extend_from_slice(&c0.to_le_bytes());
                    out.extend_from_slice(&c1.to_le_bytes());
                    out.extend_from_slice(
                        &seed
                            .wrapping_mul(0x0101_0101)
                            .wrapping_add(block)
                            .to_le_bytes(),
                    );
                }
            }
        }
        out
    }

    // ------------------------------------------------------------------ стенд

    struct Rig {
        dir: TempDir,
    }

    impl Rig {
        fn new() -> Rig {
            Rig {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn text(&self, name: &str) -> String {
            self.path(name).to_string_lossy().into_owned()
        }

        fn write(&self, name: &str, bytes: &[u8]) -> String {
            fs::write(self.path(name), bytes).unwrap();
            self.text(name)
        }

        /// Модель в файле `<name>.yft`.
        fn model(&self, name: &str, graph: &Graph) -> String {
            self.write(&format!("{name}.yft"), &pack(graph))
        }

        /// Лист: файл DDS и запись запроса с верной суммой.
        fn sheet(&self, name: &str, file: &str, bytes: &[u8]) -> Value {
            let path = self.write(file, bytes);
            json!({ "name": name, "dds": path, "sha256": format!("sha256:{}", sha256_hex(bytes)) })
        }

        fn request(&self, model: &str, rest: Value) -> String {
            let mut body = json!({ "format": "astral.lamp-pole", "version": 1, "model": model });
            for (key, value) in rest.as_object().unwrap() {
                body[key] = value.clone();
            }
            self.write("request.json", body.to_string().as_bytes())
        }

        fn run(&self, request: &str) -> Value {
            self.run_to(request, "out.yft")
        }

        fn run_to(&self, request: &str, output: &str) -> Value {
            let argv: Vec<String> = [
                "lamp-pole",
                "--input",
                request,
                "--output",
                &self.text(output),
            ]
            .iter()
            .map(|part| (*part).to_owned())
            .collect();
            let outcome = crate::run(&argv, &Progress::silent());
            let value: Value = serde_json::from_str(&outcome.line).unwrap();
            assert_eq!(outcome.exit_code, i32::from(value["ok"] != true), "{value}");
            value
        }

        fn output(&self) -> Vec<u8> {
            fs::read(self.path("out.yft")).unwrap()
        }
    }

    fn failure(response: &Value) -> (String, String) {
        assert_eq!(response["ok"], false, "{response}");
        (
            response["error"]["code"].as_str().unwrap().to_owned(),
            response["error"]["message"].as_str().unwrap().to_owned(),
        )
    }

    fn assert_refused(response: &Value, code: &str, message: &str) {
        assert_eq!(failure(response), (code.to_owned(), message.to_owned()));
    }

    fn result_of(response: &Value) -> &Value {
        assert_eq!(response["ok"], true, "{response}");
        &response["result"]
    }

    fn shine() -> Value {
        json!({ "shaders": [{ "index": 0, "specular": 1.5 }] })
    }

    // ------------------------------------------------------------ чтение выходов

    fn shaders_of(bench: &Bench) -> Vec<usize> {
        shader_blocks(&bench.graph, bench.group).unwrap()
    }

    /// Длины таблицы параметров шейдера, как их пишет игра: до хешей имён и весь блок.
    fn sizes_of(rows: usize, vectors: usize) -> (u16, u16) {
        let table = rows * 16 + vectors * 16;
        (table as u16, ((table + rows * 4 + 32).div_ceil(16) * 16) as u16)
    }

    /// Длины, маска корзин и число листов шейдера на выходе.
    fn shader_facts(graph: &Graph, shader: usize) -> (u16, u16, u32, u8) {
        (
            half(graph, shader, 0x14),
            half(graph, shader, 0x16),
            word(graph, shader, 0x20),
            graph.content(shader)[0x27],
        )
    }

    /// Чего ждать от шейдера со штатной раскладкой `name` в корзине `bucket`.
    fn layout_facts(name: &str, bucket: u8) -> (u16, u16, u32, u8) {
        let layout = standard_layout(name);
        let vectors = layout.iter().filter(|row| row.1 != "Texture").count();
        let (table, whole) = sizes_of(layout.len(), vectors);
        (
            table,
            whole,
            0xFF00 | (1 << bucket),
            (layout.len() - vectors) as u8,
        )
    }

    fn word(graph: &Graph, block: usize, at: usize) -> u32 {
        u32_at(graph, block, at).unwrap()
    }

    fn half(graph: &Graph, block: usize, at: usize) -> u16 {
        u16_at(graph, block, at).unwrap()
    }

    fn sheet_names(bench: &Bench) -> Vec<String> {
        bench
            .sheet_objects()
            .unwrap()
            .into_iter()
            .map(|(name, _)| name)
            .collect()
    }

    /// Вектор параметра `row` таблицы: четыре числа из блока данных.
    fn vector_of(graph: &Graph, table: usize, row: usize) -> [f32; 4] {
        let target = rg::pointer_from(graph, table, row * 16 + 8).expect("у записи есть данные");
        let block = graph.block_at(target).unwrap();
        let from = target.offset - graph.blocks[block].start;
        std::array::from_fn(|at| float_at(graph.content(block), from + at * 4))
    }

    /// Регистры строк таблицы параметров: второй байт первого слова каждой из `rows` строк.
    fn registers_of(graph: &Graph, table: usize, rows: usize) -> Vec<u8> {
        (0..rows).map(|row| graph.content(table)[row * 16 + 1]).collect()
    }

    fn texture_of_row(graph: &Graph, table: usize, row: usize) -> String {
        let target = rg::pointer_from(graph, table, row * 16 + 8).expect("у записи есть текстура");
        super::super::split::texture_name(graph, graph.block_at(target).unwrap()).unwrap()
    }

    fn row_of(layout: Layout, name: &str) -> usize {
        layout.iter().position(|row| row.0 == name).unwrap()
    }

    // --------------------------------------------------------------- модульные

    #[test]
    fn dds_recipe_matches_the_recorded_sums() {
        let deco = make_dds(b"DXT5", 16, 16, 1, 7);
        let body = make_dds(b"DXT1", 16, 16, 1, 3);
        assert_eq!((deco.len(), body.len()), (384, 256));
        assert_eq!(
            sha256_hex(&deco),
            "0914fed6a6154158a476c62f69b536bbe54eef7cf0a807504929418db362582b"
        );
        assert_eq!(
            sha256_hex(&body),
            "15ee860ea7f4614531a40b1350df5005fc1c04c60edb8ac482f75eeebbf37e28"
        );
        assert_eq!(make_dds(b"DXT5", 64, 64, 7, 5).len(), 5616);
        assert_eq!(make_dds(b"DXT1", 64, 16, 3, 5).len(), 800);
    }

    #[test]
    fn names_and_constants_match_the_description() {
        for (name, expected) in [
            ("default", 0xe4df_46d5u32),
            ("normal", 0x4f48_5502),
            ("normal_spec", 0x38dd_00df),
            ("emissive", 0x8f24_5469),
            ("default.sps", 0x18ad_1594),
            ("emissive.sps", 0x9d18_3303),
            ("alpha.sps", 0x11c7_0430),
            ("spec_alpha.sps", 0x0f58_61c7),
            ("normal_alpha.sps", 0x5d3f_c1bb),
            ("normal_spec_alpha.sps", 0x7883_8e05),
            ("emissive_alpha.sps", 0x0aaf_1851),
            ("DiffuseSampler", 0xf1fe_2b71),
            ("specularIntensityMult", 0xf418_334f),
            ("specularFalloffMult", 0x8774_4680),
        ] {
            assert_eq!(joaat(name), expected, "{name}");
        }
        assert_eq!(HOST_FRAGMENT_RADIUS, 0x4057_3128);
        assert_eq!(HOST_MODEL_RADIUS, 0x4060_6bc8);
        assert!((f32::from_bits(HOST_FRAGMENT_RADIUS) - 3.362375).abs() < 1e-6);
        assert!((f32::from_bits(HOST_MODEL_RADIUS) - 3.506578).abs() < 1e-6);
        assert_eq!(
            Standard::ALL.map(|standard| standard.layout().len()),
            [7, 9, 11, 7]
        );
    }

    #[test]
    fn layouts_lay_out_blocks_of_the_recorded_lengths_in_creation_order() {
        for (layout, length, vectors) in [
            (standard_layout("default"), 236, 6usize),
            (standard_layout("normal"), 292, 7),
            (standard_layout("normal_spec"), 348, 8),
            (standard_layout("emissive"), 236, 6),
        ] {
            let mut graph = build(&standard());
            let before = graph.blocks.len();
            let object = Address {
                segment: Segment::System,
                offset: 0,
            };
            let cells: Vec<Cell> = layout
                .iter()
                .map(|&(_, kind, value)| {
                    if kind == "Texture" {
                        Cell::Texture(Some(object))
                    } else {
                        Cell::Vector(value)
                    }
                })
                .collect();
            let at = lay_params(&mut graph, layout, &cells).unwrap();
            assert_eq!(graph.blocks.len(), before + vectors + 1);
            let params = graph.block_at(at).unwrap();
            assert_eq!(params, before + vectors, "блок параметров последний");
            assert_eq!(graph.content(params).len(), length);
            for created in before..before + vectors {
                assert_eq!(graph.content(created).len(), 16);
                assert!(graph.blocks[created].slots.is_empty());
                assert!(graph.blocks[created].start < graph.blocks[params].start);
            }
            let rows = layout.len();
            let slots = &graph.blocks[params].slots;
            assert_eq!(slots.len(), rows);
            for (row, slot) in slots.iter().enumerate() {
                assert_eq!(slot.relative, row * 16 + 8);
            }
        }
    }

    #[test]
    fn a_texture_without_a_target_refuses_after_the_vectors() {
        let mut graph = build(&standard());
        let cells = [Cell::Texture(None), Cell::Vector([0.0; 4])];
        let layout: Layout = &standard_layout("default")[..2];
        let error = lay_params(&mut graph, layout, &cells).unwrap_err();
        assert_eq!(error.message, "lamp-pole: текстура без цели.");
    }

    #[test]
    fn matrices_invert_and_multiply() {
        let turn = {
            let half = std::f32::consts::FRAC_1_SQRT_2;
            let mut record = [0u8; BONE_RECORD];
            for (at, value) in [
                0.0, 0.0, half, half, 0.0, 0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 0.0, 2.0, 3.0, 4.0, 0.0,
            ]
            .iter()
            .enumerate()
            {
                record[at * 4..at * 4 + 4].copy_from_slice(&f32::to_le_bytes(*value));
            }
            record[0x32..0x34].copy_from_slice(&(-1i16).to_le_bytes());
            local_matrix(&record).0
        };
        let product = mul(&turn, &invert(&turn));
        for (at, value) in product.iter().enumerate() {
            let expected = if at % 5 == 0 { 1.0 } else { 0.0 };
            assert!((value - expected).abs() < 1e-5, "{at}: {value}");
        }
        assert_eq!(mul(&IDENTITY, &turn), turn);
        // Полная матрица без нулевого столбца: в слагаемые входят все шестнадцать элементов.
        let dense: Mat = [
            2.0, 1.0, 0.5, 0.25, -1.0, 3.0, 0.25, 0.5, 0.75, 1.0, 4.0, -0.5, 5.0, -2.0, 1.0, 6.0,
        ];
        let back = mul(&dense, &invert(&dense));
        for (at, value) in back.iter().enumerate() {
            let expected = if at % 5 == 0 { 1.0 } else { 0.0 };
            assert!((value - expected).abs() < 1e-4, "полная {at}: {value}");
        }
        // Вырожденная матрица: обратная единичная.
        let mut flat = IDENTITY;
        flat[0] = 1e-7;
        flat[5] = 1e-7;
        assert_eq!(invert(&flat), IDENTITY);
        // Все шестнадцать элементов: сверка с проверенной суммой для случайной матрицы.
        let m: Mat = [
            2.0, 1.0, 0.5, 0.0, -1.0, 3.0, 0.25, 0.0, 0.0, 1.0, 4.0, 0.0, 5.0, -2.0, 1.0, 1.0,
        ];
        let back = mul(&m, &invert(&m));
        for (at, value) in back.iter().enumerate() {
            let expected = if at % 5 == 0 { 1.0 } else { 0.0 };
            assert!((value - expected).abs() < 1e-5, "{at}: {value}");
        }
    }

    #[test]
    fn a_bone_matrix_follows_scale_rotation_translation_and_zero_scale_reads_as_one() {
        let mut record = [0u8; BONE_RECORD];
        for (at, value) in [
            0.0f32, 0.0, 0.0, 1.0, 1.0, 2.0, 3.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ]
        .iter()
        .enumerate()
        {
            record[at * 4..at * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
        let (matrix, parent) = local_matrix(&record);
        assert_eq!(parent, 0);
        assert_eq!(matrix[0], 1.0);
        assert_eq!(matrix[5], 2.0);
        assert_eq!(matrix[10], 1.0, "нулевой масштаб читается как 1");
        assert_eq!(&matrix[12..15], &[1.0, 2.0, 3.0]);
        assert_eq!(matrix[15], 1.0);
    }

    #[test]
    fn points_and_normals_carry_through_a_matrix() {
        let mut m = IDENTITY;
        m[12] = -1.0;
        m[13] = -2.0;
        m[14] = -3.0;
        assert_eq!(carry_point(&m, [1.0, 2.0, 3.0]), [0.0, 0.0, 0.0]);
        assert_eq!(carry_normal(&m, [0.0, 0.0, 2.0]), [0.0, 0.0, 1.0]);
        assert_eq!(carry_normal(&m, [0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        assert_eq!(carry_normal(&IDENTITY, [0.0, 3.0, 4.0]), [0.0, 0.6, 0.8]);
        assert_eq!(carry_normal(&IDENTITY, [1e-6, 0.0, 0.0]), [1.0, 0.0, 0.0]);
        assert_eq!(
            carry_normal(&IDENTITY, [1e-13, 0.0, 0.0]),
            [1e-13, 0.0, 0.0]
        );
    }

    #[test]
    fn lod_models_reads_lists_and_refuses_empty_entries() {
        let graph = build(&standard());
        let drawable = drawable_of(&graph);
        assert_eq!(lod_models(&graph, drawable, 0x50).unwrap().len(), 2);
        assert_eq!(lod_models(&graph, drawable, 0x58).unwrap().len(), 1);
        assert!(lod_models(&graph, drawable, 0x68).unwrap().is_empty());

        let mut broken = build(&standard());
        let drawable = drawable_of(&broken);
        let entries = nav(&broken, drawable, &[0x50, 0]);
        cut(&mut broken, entries, 8);
        assert_eq!(
            lod_models(&broken, drawable, 0x50).unwrap_err().message,
            "lamp-pole: пустая модель уровня."
        );

        let header = nav(&broken, drawable, &[0x58]);
        cut(&mut broken, header, 0);
        assert!(lod_models(&broken, drawable, 0x58).unwrap().is_empty());
    }

    #[test]
    fn the_target_model_prefers_the_searched_bone_then_bone_zero_then_any_rigid() {
        let mut spec = standard();
        spec.levels[0] = vec![
            ModelSpec {
                word: 0x0000_0100,
                ..rigid_model(0, &[0])
            },
            rigid_model(2, &[1]),
            rigid_model(0, &[2]),
        ];
        let graph = build(&spec);
        let models = lod_models(&graph, drawable_of(&graph), 0x50).unwrap();
        assert_eq!(pick_target(&graph, &models, 2).unwrap(), models[1]);
        assert_eq!(
            pick_target(&graph, &models, 9).unwrap(),
            models[2],
            "кость 0 среди жёстких"
        );
        spec.levels[0] = vec![
            ModelSpec {
                word: 0x0000_0100,
                ..rigid_model(0, &[0])
            },
            rigid_model(5, &[1]),
        ];
        let graph = build(&spec);
        let models = lod_models(&graph, drawable_of(&graph), 0x50).unwrap();
        assert_eq!(
            pick_target(&graph, &models, 9).unwrap(),
            models[1],
            "любая жёсткая"
        );
        spec.levels[0] = vec![ModelSpec {
            word: 0x0000_0100,
            ..rigid_model(0, &[0])
        }];
        let graph = build(&spec);
        let models = lod_models(&graph, drawable_of(&graph), 0x50).unwrap();
        assert_eq!(
            pick_target(&graph, &models, 0).unwrap(),
            models[0],
            "жёстких нет — первая"
        );
    }

    #[test]
    fn palettes_give_the_slot_of_the_searched_bone() {
        let mut spec = standard();
        let skin = |palette: &[u16]| GeometrySpec {
            vertices: 3,
            palette: palette.to_vec(),
        };
        spec.levels[0] = vec![ModelSpec {
            word: 0x0000_0100,
            mask: 3,
            mapping: vec![0, 1, 2],
            geometries: vec![skin(&[5, 3, 0, 7]), skin(&[]), skin(&[2, 9])],
        }];
        let graph = build(&spec);
        let model = high_model(&graph);
        let geometries = geometry_blocks(&graph, model).unwrap();
        assert_eq!(
            find_palette(&graph, &geometries, 3).unwrap(),
            (1, vec![5, 3, 0, 7])
        );
        assert_eq!(
            find_palette(&graph, &geometries, 9).unwrap(),
            (1, vec![2, 9])
        );
        assert_eq!(
            find_palette(&graph, &geometries, 4).unwrap(),
            (2, vec![5, 3, 0, 7]),
            "кость 0 первой палитры"
        );
        spec.levels[0][0].geometries = vec![skin(&[8, 9])];
        spec.levels[0][0].mapping = vec![0];
        let graph = build(&spec);
        let geometries = geometry_blocks(&graph, high_model(&graph)).unwrap();
        assert_eq!(
            find_palette(&graph, &geometries, 4).unwrap(),
            (0, vec![8, 9])
        );
        spec.levels[0][0].geometries = vec![skin(&[])];
        let graph = build(&spec);
        let geometries = geometry_blocks(&graph, high_model(&graph)).unwrap();
        assert_eq!(
            find_palette(&graph, &geometries, 0).unwrap_err().message,
            "lamp-pole: у модели со скином нет палитры костей."
        );
    }

    // ------------------------------------------------------- запрос и параметры

    #[test]
    fn process_and_request_refusals_come_in_the_documented_order() {
        let rig = Rig::new();
        let graph = build(&standard());
        let model = rig.model("m", &graph);
        let run_args = |tail: &[&str]| {
            let mut argv = vec!["lamp-pole".to_owned()];
            argv.extend(tail.iter().map(|part| (*part).to_owned()));
            serde_json::from_str::<Value>(&crate::run(&argv, &Progress::silent()).line).unwrap()
        };
        assert_refused(&run_args(&[]), "ArgumentException", "--input is required.");
        assert_refused(
            &run_args(&["--input"]),
            "ArgumentException",
            "A value is required for --input.",
        );
        assert_refused(
            &run_args(&["--output", &rig.text("o.yft")]),
            "ArgumentException",
            "--input is required.",
        );
        let request = rig.request(&model, shine());
        assert_refused(
            &run_args(&["--input", &request]),
            "ArgumentException",
            "--output is required.",
        );
        assert_refused(
            &run_args(&["--input", &request, "--output", &rig.text("o.txt")]),
            "ArgumentException",
            "Unsupported output extension: .txt",
        );
        assert_refused(
            &run_args(&["--input", &request, "--output", &rig.text("o")]),
            "ArgumentException",
            "Unsupported output extension: ",
        );
        assert_refused(
            &run_args(&["--input", &request, "--output", ""]),
            "ArgumentException",
            "The path is empty.",
        );
        // Плохой запрос побеждает отсутствие --output.
        rig.write("request.json", b"{oops");
        assert_refused(
            &run_args(&["--input", &rig.text("request.json")]),
            "InvalidDataException",
            "lamp-pole: запрос не читается.",
        );

        let none = rig.text("none.json");
        assert_refused(
            &run_args(&["--input", &none, "--output", &rig.text("o.yft")]),
            "FileNotFoundException",
            &format!("File was not found: {none}"),
        );
        let text = rig.write("request.txt", b"{}");
        assert_refused(
            &run_args(&["--input", &text, "--output", &rig.text("o.yft")]),
            "ArgumentException",
            "Unsupported file extension: .txt",
        );
        let limit = "lamp-pole: запрос от 1 байта до 24 МБ.";
        let broken = "lamp-pole: запрос не читается.";
        for (body, message) in [
            (Vec::new(), limit),
            (vec![b' '; limits::REQUEST + 1], limit),
            (vec![b' '; limits::REQUEST], broken),
            (b"\xEF\xBB\xBF{}".to_vec(), broken),
            (b"{\"a\":1e400}".to_vec(), broken),
            (b"{} x".to_vec(), broken),
        ] {
            let path = rig.write("request.json", &body);
            assert_refused(&rig.run(&path), "InvalidDataException", message);
        }
    }

    #[test]
    fn request_fields_are_read_in_the_documented_order() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let unknown = "lamp-pole: неизвестный формат запроса.";
        let with = |patch: Value| -> Value {
            let mut body = json!({ "format": "astral.lamp-pole", "version": 1, "model": model });
            for (key, value) in patch.as_object().unwrap() {
                if value.is_null() && key.starts_with('-') {
                    body.as_object_mut().unwrap().remove(&key[1..]);
                } else {
                    body[key] = value.clone();
                }
            }
            body
        };
        let run_body = |body: Value| -> Value {
            let path = rig.write("request.json", body.to_string().as_bytes());
            rig.run(&path)
        };
        let shines = json!([{ "index": 0, "specular": 1.5 }]);
        for body in [
            json!([]),
            Value::Null,
            json!({}),
            with(json!({ "format": "astral.other", "shaders": shines })),
            with(json!({ "format": 5, "shaders": shines })),
            with(json!({ "version": 2, "shaders": shines })),
            with(json!({ "version": "1", "shaders": shines })),
            with(json!({ "version": 1.0, "shaders": shines })),
            with(json!({ "-version": null, "shaders": shines })),
        ] {
            assert_refused(&run_body(body), "InvalidDataException", unknown);
        }
        let empty = "The path is empty.";
        assert_refused(
            &run_body(with(json!({ "-model": null, "shaders": shines }))),
            "ArgumentException",
            empty,
        );
        assert_refused(
            &run_body(with(json!({ "model": 5, "shaders": shines }))),
            "ArgumentException",
            empty,
        );
        assert_refused(
            &run_body(with(json!({ "model": "", "shaders": shines }))),
            "ArgumentException",
            empty,
        );
        let missing = rig.text("none.yft");
        assert_refused(
            &run_body(with(json!({ "model": missing, "shaders": shines }))),
            "FileNotFoundException",
            &format!("File was not found: {missing}"),
        );
        let ydr = rig.write("m.ydr", b"x");
        assert_refused(
            &run_body(with(json!({ "model": ydr, "shaders": shines }))),
            "ArgumentException",
            "Unsupported file extension: .ydr",
        );
        fs::create_dir(rig.path("d.yft")).unwrap();
        let folder = rig.text("d.yft");
        assert_refused(
            &run_body(with(json!({ "model": folder, "shaders": shines }))),
            "FileNotFoundException",
            &format!("File was not found: {folder}"),
        );

        let nothing = "lamp-pole: запрос ничего не меняет.";
        let sheet = rig.sheet(
            "astral_pole_body",
            "body16.dds",
            &make_dds(b"DXT1", 16, 16, 1, 3),
        );
        for body in [
            with(json!({})),
            with(json!({ "shaders": [] })),
            with(json!({ "textures": [sheet] })),
            with(json!({ "shaders": { "index": 0, "specular": 2 } })),
            with(json!({ "shaders": "x" })),
        ] {
            assert_refused(&run_body(body), "InvalidDataException", nothing);
        }
        for (decoration, message) in [
            (json!({}), "lamp-pole: украшению нужен лист."),
            (json!(5), "lamp-pole: украшению нужен лист."),
            (json!(false), "lamp-pole: украшению нужен лист."),
            (
                json!({ "texture": "x", "parts": [] }),
                "lamp-pole: имя листа — astral_pole_*.",
            ),
        ] {
            assert_refused(
                &run_body(with(json!({ "decorations": decoration }))),
                "InvalidDataException",
                message,
            );
        }
        // Лишние ключи игнорируются.
        let response = run_body(with(json!({ "shaders": shines, "extra": 1, "note": "x" })));
        assert_eq!(result_of(&response)["file"], "out.yft");
    }

    #[test]
    fn sheet_requests_are_checked_one_by_one() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let body16 = make_dds(b"DXT1", 16, 16, 1, 3);
        let good = rig.sheet("astral_pole_a", "body16.dds", &body16);
        let bad_name = "lamp-pole: имя листа — astral_pole_*.";
        let named =
            |name: &str| json!({ "name": name, "dds": good["dds"], "sha256": good["sha256"] });
        let long40 = format!("astral_pole_{}", "a".repeat(40));
        let long41 = format!("astral_pole_{}", "a".repeat(41));
        for (name, accepted) in [
            ("pole_a", false),
            ("astral_pole_", false),
            ("astral_pole_A", false),
            ("astral_pole_a b", false),
            ("astral_pole_a-b", false),
            ("astral_pole_ж", false),
            (long41.as_str(), false),
            (long40.as_str(), true),
            ("  astral_pole_a  ", true),
            ("astral_pole_0_9__", true),
        ] {
            let request = rig.request(
                &model,
                json!({ "textures": [named(name)], "shaders": [{ "index": 0 }] }),
            );
            let response = rig.run(&request);
            if accepted {
                assert_eq!(result_of(&response)["semantic"]["textures"][0], name.trim());
            } else {
                assert_refused(&response, "InvalidDataException", bad_name);
            }
        }
        for element in [
            json!(5),
            json!("x"),
            json!({ "name": 5, "dds": good["dds"] }),
        ] {
            let request = rig.request(
                &model,
                json!({ "textures": [element], "shaders": [{ "index": 0 }] }),
            );
            assert_refused(&rig.run(&request), "InvalidDataException", bad_name);
        }
        let shaders = json!([{ "index": 0 }]);
        let without_dds = json!({ "name": "astral_pole_a" });
        let request = rig.request(
            &model,
            json!({ "textures": [without_dds], "shaders": shaders }),
        );
        assert_refused(
            &rig.run(&request),
            "ArgumentException",
            "The path is empty.",
        );
        let none = rig.text("none.dds");
        let request = rig.request(
            &model,
            json!({ "textures": [{ "name": "astral_pole_a", "dds": none }], "shaders": shaders }),
        );
        assert_refused(
            &rig.run(&request),
            "FileNotFoundException",
            &format!("File was not found: {none}"),
        );
        let png = rig.write("a.png", b"x");
        let request = rig.request(
            &model,
            json!({ "textures": [{ "name": "astral_pole_a", "dds": png }], "shaders": shaders }),
        );
        assert_refused(
            &rig.run(&request),
            "ArgumentException",
            "Unsupported file extension: .png",
        );
        // Имя плохое и файла нет: побеждает имя.
        let request = rig.request(
            &model,
            json!({ "textures": [{ "name": "bad", "dds": none }], "shaders": shaders }),
        );
        assert_refused(&rig.run(&request), "InvalidDataException", bad_name);
        // Плохой лист и плохая модель: побеждает модель.
        let request = rig.request(
            &none.replace("none.dds", "none.yft"),
            json!({ "textures": [named("bad")], "shaders": shaders }),
        );
        assert_eq!(failure(&rig.run(&request)).0, "FileNotFoundException");

        // Больше шестнадцати, повторы: порядок проверок.
        let many = |count: usize, name: &dyn Fn(usize) -> String| -> Vec<Value> {
            (0..count).map(|at| named(&name(at))).collect()
        };
        let numbered = |at: usize| format!("astral_pole_t{at}");
        let request = rig.request(
            &model,
            json!({ "textures": many(17, &numbered), "shaders": shaders }),
        );
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: листов больше 16.",
        );
        let request = rig.request(
            &model,
            json!({ "textures": many(17, &|_| "astral_pole_a".to_owned()), "shaders": shaders }),
        );
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: листов больше 16.",
        );
        let mut with_bad = many(17, &numbered);
        with_bad[16] = named("bad");
        let request = rig.request(&model, json!({ "textures": with_bad, "shaders": shaders }));
        assert_refused(&rig.run(&request), "InvalidDataException", bad_name);
        let request = rig.request(&model, json!({ "textures": [named("astral_pole_a"), named(" astral_pole_a ")], "shaders": shaders }));
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: имена листов повторяются.",
        );
        let request = rig.request(
            &model,
            json!({ "textures": many(16, &numbered), "shaders": shaders }),
        );
        let response = rig.run(&request);
        assert_eq!(
            result_of(&response)["semantic"]["textures"]
                .as_array()
                .unwrap()
                .len(),
            16
        );
        assert_eq!(sheet_names(&open(&rig.output())).len(), 18);
    }

    #[test]
    fn dds_files_are_checked_before_they_reach_the_model() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let shaders = json!([{ "index": 0 }]);
        let attempt = |bytes: &[u8]| -> Value {
            let sheet = rig.sheet("astral_pole_a", "x.dds", bytes);
            let request = rig.request(&model, json!({ "textures": [sheet], "shaders": shaders }));
            rig.run(&request)
        };
        let base = make_dds(b"DXT5", 16, 16, 1, 7);
        let not_dds = "lamp-pole: лист astral_pole_a — не DDS или больше 4 МБ.";
        let formats = "lamp-pole: лист astral_pole_a — DXT1 или DXT5.";
        let sides = "lamp-pole: лист astral_pole_a — стороны 4–2048 степенью двойки.";
        let patched = |at: usize, bytes: &[u8]| {
            let mut copy = base.clone();
            copy[at..at + bytes.len()].copy_from_slice(bytes);
            copy
        };
        for (bytes, message) in [
            (vec![b'a'; 200], not_dds),
            (base[..100].to_vec(), not_dds),
            (patched(0, b"XXXX"), not_dds),
            (vec![0u8; limits::DDS + 1], not_dds),
            (patched(84, b"DX10"), formats),
            (patched(84, b"DXT3"), formats),
            (patched(84, b"ATI1"), formats),
            (patched(84, b"dxt5"), formats),
            (patched(16, &24u32.to_le_bytes()), sides),
            (patched(16, &2u32.to_le_bytes()), sides),
            (patched(16, &4096u32.to_le_bytes()), sides),
            (patched(12, &0u32.to_le_bytes()), sides),
        ] {
            assert_refused(&attempt(&bytes), "InvalidDataException", message);
        }
        assert_refused(
            &attempt(&base[..128]),
            "InvalidOperationException",
            "DDS: данных 0 байт, для 16×16 и 1 ступеней DXT5 нужно 256.",
        );
        let mut extra = base.clone();
        extra.extend_from_slice(&[0; 7]);
        assert_refused(
            &attempt(&extra),
            "InvalidOperationException",
            "DDS: данных 263 байт, для 16×16 и 1 ступеней DXT5 нужно 256.",
        );
        assert_refused(
            &attempt(&base[..379]),
            "InvalidOperationException",
            "DDS: данных 251 байт, для 16×16 и 1 ступеней DXT5 нужно 256.",
        );
        assert_refused(
            &attempt(&patched(4, &100u32.to_le_bytes())),
            "InvalidOperationException",
            "Файл не DDS: нет заголовка.",
        );
        assert_refused(
            &attempt(&patched(24, &2u32.to_le_bytes())),
            "InvalidOperationException",
            "Объёмные DDS не поддерживаются.",
        );
        let mut mip = make_dds(b"DXT5", 4, 4, 3, 7);
        mip[28..32].copy_from_slice(&13u32.to_le_bytes());
        assert_refused(
            &attempt(&mip),
            "InvalidOperationException",
            "DDS: больше 12 ступеней.",
        );
        // Сумма проверяется раньше формата; формат и стороны — раньше разбора.
        let sheet = json!({ "name": "astral_pole_a", "dds": rig.write("x.dds", &base), "sha256": "sha256:00" });
        let request = rig.request(&model, json!({ "textures": [sheet], "shaders": shaders }));
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: SHA-256 листа astral_pole_a не сходится.",
        );
        let whole = format!("sha256:{}", sha256_hex(&base));
        for sha in [
            Value::Null,
            json!(sha256_hex(&base)),
            json!(whole.to_uppercase()),
            json!(whole.replace("sha256", "SHA256")),
        ] {
            let sheet = json!({ "name": "astral_pole_a", "dds": rig.text("x.dds"), "sha256": sha });
            let request = rig.request(&model, json!({ "textures": [sheet], "shaders": shaders }));
            assert_refused(
                &rig.run(&request),
                "InvalidDataException",
                "lamp-pole: SHA-256 листа astral_pole_a не сходится.",
            );
        }
        // Допустимые листы: ступени, прямоугольники, пределы сторон.
        for (fourcc, width, height, levels) in [
            (b"DXT1", 4u32, 4u32, 1u32),
            (b"DXT5", 4, 4, 3),
            (b"DXT5", 64, 64, 7),
            (b"DXT1", 64, 16, 3),
            (b"DXT1", 2048, 4, 1),
            (b"DXT1", 2048, 2048, 12),
        ] {
            let bytes = make_dds(fourcc, width, height, levels, 5);
            let response = attempt(&bytes);
            assert_eq!(
                result_of(&response)["semantic"]["textures"][0],
                "astral_pole_a",
                "{width}x{height}x{levels}"
            );
            let after = open(&rig.output());
            let object = after.sheet_object("astral_pole_a").unwrap();
            let block = after.graph.block_at(object).unwrap();
            assert_eq!(
                half(&after.graph, block, 0x50),
                width as u16,
                "ширина в объекте"
            );
        }
    }

    // ------------------------------------------------------------ шейдеры корпуса

    #[test]
    fn a_shine_request_scales_the_vectors_and_stamps_the_header() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let request = rig.request(
            &model,
            json!({ "shaders": [{ "index": 0, "specular": 2 }] }),
        );
        let response = rig.run(&request);
        let result = result_of(&response);
        let keys: Vec<&String> = result.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["file", "bytes", "sha256", "semantic"]);
        let semantic: Vec<&String> = result["semantic"].as_object().unwrap().keys().collect();
        assert_eq!(
            semantic,
            [
                "semanticReopen",
                "bones",
                "textures",
                "transparent",
                "decorated"
            ]
        );
        let bytes = rig.output();
        assert_eq!(result["file"], "out.yft");
        assert_eq!(result["bytes"], bytes.len());
        assert_eq!(result["sha256"], sha256_hex(&bytes));
        assert_eq!(
            result["semantic"],
            json!({
                "semanticReopen": true, "bones": 4, "textures": [], "transparent": 0, "decorated": {}
            })
        );
        let after = open(&bytes);
        assert_eq!(word(&after.graph, after.root, 0), HOST_FRAGMENT_RADIUS);
        assert_eq!(word(&after.graph, after.drawable, 0), HOST_MODEL_RADIUS);
        assert_ne!(half(&after.graph, after.drawable, 0x9a), 0);
        let table = nav(&after.graph, shaders_of(&after)[0], &[0]);
        assert_eq!(
            vector_of(
                &after.graph,
                table,
                row_of(standard_layout("normal_spec"), "specularIntensityMult")
            ),
            [2.0, 0.0, 0.0, 0.0]
        );
        assert_eq!(
            vector_of(
                &after.graph,
                table,
                row_of(standard_layout("normal_spec"), "specularFalloffMult")
            ),
            [150.0, 0.0, 0.0, 0.0]
        );
    }

    #[test]
    fn specular_values_follow_the_formulas_and_their_limits() {
        for shine in [0.0f32, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0] {
            let rig = Rig::new();
            let model = rig.model("m", &build(&standard()));
            let request = rig.request(&model, json!({ "shaders": [{ "index": 0, "specular": shine }, { "index": 2, "specular": shine }] }));
            result_of(&rig.run(&request));
            let after = open(&rig.output());
            let shaders = shaders_of(&after);
            let intensity = (1.0f32 * shine).clamp(0.0, 4.0);
            let falloff = if shine > 1.0 {
                (100.0f32 * (1.0 + (shine - 1.0) * 0.5)).clamp(1.0, 512.0)
            } else {
                100.0
            };
            let table = nav(&after.graph, shaders[0], &[0]);
            assert_eq!(vector_of(&after.graph, table, 8)[0], intensity, "{shine}");
            assert_eq!(vector_of(&after.graph, table, 9)[0], falloff, "{shine}");
            let plain = nav(&after.graph, shaders[2], &[0]);
            assert_eq!(
                vector_of(
                    &after.graph,
                    plain,
                    row_of(standard_layout("normal"), "specularIntensityMult")
                )[0],
                (0.125f32 * shine).clamp(0.0, 4.0)
            );
            // Шейдер без параметров блеска не меняется (default-раскладка).
        }
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let request = rig.request(
            &model,
            json!({ "shaders": [{ "index": 1, "specular": 3 }] }),
        );
        result_of(&rig.run(&request));
        let range = "lamp-pole: блеск — от 0 до 4.";
        let number = "lamp-pole: блеск — число.";
        for (value, message) in [
            (json!(4.01), range),
            (json!(-0.01), range),
            (json!("2"), number),
            (json!(true), number),
            (json!([1]), number),
        ] {
            let request = rig.request(
                &model,
                json!({ "shaders": [{ "index": 0, "specular": value }] }),
            );
            assert_refused(&rig.run(&request), "InvalidDataException", message);
        }
        let request = rig.request(
            &model,
            json!({ "shaders": [{ "index": 0, "specular": null }] }),
        );
        result_of(&rig.run(&request));
    }

    #[test]
    fn shader_numbers_are_checked_before_anything_else_of_the_edit() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let nothing = "lamp-pole: у шейдера нет номера.";
        let listed = "lamp-pole: номер шейдера вне списка или повторен.";
        let cases = [
            (json!([{ "specular": 2 }]), nothing),
            (json!([{ "index": -1, "specular": 2 }]), nothing),
            (json!([{ "index": 1.5, "specular": 2 }]), nothing),
            (json!([{ "index": "0", "specular": 2 }]), nothing),
            (json!([{ "index": 4, "specular": 2 }]), listed),
            (
                json!([{ "index": 0, "specular": 2 }, { "index": 0, "specular": 3 }]),
                listed,
            ),
            (
                json!([{ "index": 0, "specular": 2 }, { "index": 9, "specular": 2 }]),
                listed,
            ),
            (json!([{ "index": 9, "swap": "glass" }]), listed),
        ];
        for (shaders, message) in cases {
            let request = rig.request(&model, json!({ "shaders": shaders }));
            assert_refused(&rig.run(&request), "InvalidDataException", message);
        }
        for shaders in [
            json!([{ "index": 3, "specular": 2 }]),
            json!([{ "index": 0 }]),
        ] {
            let request = rig.request(&model, json!({ "shaders": shaders }));
            result_of(&rig.run(&request));
        }
        // Ошибка номера у второй правки: порядок и тип.
        let request = rig.request(
            &model,
            json!({ "shaders": [{ "index": 0, "specular": "x" }, { "specular": 2 }] }),
        );
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: блеск — число.",
        );
    }

    #[test]
    fn presets_make_the_shader_transparent_and_refresh_the_masks() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let request = rig.request(
            &model,
            json!({ "shaders": [{ "index": 3, "preset": "alpha.sps" }] }),
        );
        let response = rig.run(&request);
        assert_eq!(result_of(&response)["semantic"]["transparent"], 1);
        let after = open(&rig.output());
        let shader = shaders_of(&after)[3];
        assert_eq!(word(&after.graph, shader, 0x18), joaat("alpha.sps"));
        assert_eq!(after.graph.content(shader)[0x11], 1);
        // маска корзин идёт вместе с корзиной: по ней игра выбирает проход отрисовки (17.11.2026)
        assert_eq!(word(&after.graph, shader, 0x20), 0xFF02);
        // Корзины [0, 0, 1, 1]: маски моделей и слова уровней складываются через ИЛИ.
        let high = lod_models(&after.graph, after.drawable, 0x50).unwrap();
        let masks: Vec<u16> = high
            .iter()
            .map(|&model| half(&after.graph, model, 0x2c))
            .collect();
        assert_eq!(masks, [0x0101, 0x0103]);
        let flags: Vec<u32> = [0x80, 0x84, 0x88]
            .iter()
            .map(|&at| word(&after.graph, after.drawable, at))
            .collect();
        assert_eq!(flags, [0x13, 0x22, 0x22]);
        let medium = lod_models(&after.graph, after.drawable, 0x58).unwrap();
        assert_eq!(half(&after.graph, medium[0], 0x2c), 0x0102);

        for preset in [
            "alpha.sps",
            "spec_alpha.sps",
            "normal_alpha.sps",
            "normal_spec_alpha.sps",
            "emissive_alpha.sps",
        ] {
            let request = rig.request(
                &model,
                json!({ "shaders": [{ "index": 2, "preset": preset }] }),
            );
            result_of(&rig.run(&request));
            assert_eq!(
                word(
                    &open(&rig.output()).graph,
                    shaders_of(&open(&rig.output()))[2],
                    0x18
                ),
                joaat(preset)
            );
        }
        // Уже прозрачный шейдер тоже считается; без строки пресета правка пропускается.
        let request = rig.request(&model, json!({ "shaders": [
            { "index": 2, "preset": "alpha.sps" }, { "index": 0, "preset": 1 }, { "index": 1, "preset": "emissive_alpha.sps" }] }));
        assert_eq!(result_of(&rig.run(&request))["semantic"]["transparent"], 2);
        for preset in ["default.sps", "ALPHA.SPS"] {
            let request = rig.request(
                &model,
                json!({ "shaders": [{ "index": 2, "preset": preset }] }),
            );
            assert_refused(
                &rig.run(&request),
                "InvalidDataException",
                &format!("lamp-pole: пресет {preset} не разрешён."),
            );
        }
    }

    #[test]
    fn the_edit_runs_swap_then_paint_then_preset_then_shine() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let sheet = rig.sheet(
            "astral_pole_body",
            "body16.dds",
            &make_dds(b"DXT1", 16, 16, 1, 3),
        );
        let with =
            |edit: Value| rig.request(&model, json!({ "textures": [sheet], "shaders": [edit] }));
        assert_refused(
            &rig.run(&with(
                json!({ "index": 0, "swap": "glass", "diffuse": "astral_pole_zzz" }),
            )),
            "InvalidDataException",
            "lamp-pole: подмена glass не поддержана.",
        );
        assert_refused(
            &rig.run(&with(
                json!({ "index": 0, "diffuse": "astral_pole_zzz", "preset": "default.sps" }),
            )),
            "InvalidDataException",
            "lamp-pole: лист astral_pole_zzz не назван в запросе.",
        );
        assert_refused(
            &rig.run(&with(
                json!({ "index": 0, "preset": "default.sps", "specular": 99 }),
            )),
            "InvalidDataException",
            "lamp-pole: пресет default.sps не разрешён.",
        );
        assert_refused(
            &rig.run(&with(
                json!({ "index": 4, "diffuse": "astral_pole_body", "preset": "default.sps" }),
            )),
            "InvalidDataException",
            "lamp-pole: номер шейдера вне списка или повторен.",
        );
        for (value, message) in [
            (
                "ASTRAL_POLE_BODY",
                "lamp-pole: лист ASTRAL_POLE_BODY не назван в запросе.",
            ),
            ("prop_a", "lamp-pole: лист prop_a не назван в запросе."),
            ("", "lamp-pole: лист  не назван в запросе."),
        ] {
            assert_refused(
                &rig.run(&with(json!({ "index": 1, "diffuse": value }))),
                "InvalidDataException",
                message,
            );
        }
        result_of(&rig.run(&with(json!({ "index": 0, "swap": 5, "diffuse": 5 }))));
        assert_refused(
            &rig.run(&with(json!({ "index": 0, "swap": "Default" }))),
            "InvalidDataException",
            "lamp-pole: подмена Default не поддержана.",
        );
        // Все четыре действия в одной правке.
        let response = rig.run(&with(json!({
            "index": 0, "swap": "default", "diffuse": "astral_pole_body", "preset": "alpha.sps", "specular": 2
        })));
        assert_eq!(result_of(&response)["semantic"]["transparent"], 1);
        let after = open(&rig.output());
        let shader = shaders_of(&after)[0];
        assert_eq!(word(&after.graph, shader, 0x08), joaat("default"));
        assert_eq!(word(&after.graph, shader, 0x18), joaat("alpha.sps"));
        assert_eq!(after.graph.content(shader)[0x10], 7);
        let table = nav(&after.graph, shader, &[0]);
        assert_eq!(texture_of_row(&after.graph, table, 0), "astral_pole_body");
    }

    #[test]
    fn paint_retargets_the_diffuse_sampler_and_keeps_the_other_sheets() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let sheets = json!([
            rig.sheet(
                "astral_pole_a",
                "body16.dds",
                &make_dds(b"DXT1", 16, 16, 1, 3)
            ),
            rig.sheet(
                "astral_pole_b",
                "deco16.dds",
                &make_dds(b"DXT5", 16, 16, 1, 7)
            ),
        ]);
        let request = rig.request(&model, json!({
            "textures": sheets,
            "shaders": [{ "index": 0, "diffuse": "astral_pole_a" }, { "index": 3, "diffuse": "astral_pole_b" }],
        }));
        let response = rig.run(&request);
        assert_eq!(
            result_of(&response)["semantic"]["textures"],
            json!(["astral_pole_a", "astral_pole_b"])
        );
        let after = open(&rig.output());
        let mut names = sheet_names(&after);
        names.sort();
        assert_eq!(
            names,
            ["astral_pole_a", "astral_pole_b", "prop_a", "prop_b"]
        );
        let shaders = shaders_of(&after);
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[0], &[0]), 0),
            "astral_pole_a"
        );
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[3], &[0]), 0),
            "astral_pole_b"
        );
        // Остальные сэмплеры смотрят на прежние листы под прежними именами.
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[1], &[0]), 0),
            "prop_a"
        );
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[2], &[0]), 0),
            "prop_b"
        );
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[0], &[0]), 1),
            "prop_a"
        );
    }

    #[test]
    fn a_swap_keeps_values_targets_and_the_shader_file() {
        let mut graph = build(&standard());
        let shader = nav(&graph, group_of(&graph), &[0x10, 0]);
        let table = nav(&graph, shader, &[0]);
        let data = nav(
            &graph,
            table,
            &[row_of(standard_layout("normal_spec"), "HardAlphaBlend") * 16 + 8],
        );
        for (at, value) in [7.0f32, 8.0, 9.0, 10.0].iter().enumerate() {
            poke(&mut graph, data, at * 4, &value.to_le_bytes());
        }
        let rig = Rig::new();
        let model = rig.model("m", &graph);
        let request = rig.request(&model, json!({ "shaders": [{ "index": 0, "swap": "default" }, { "index": 1, "swap": "emissive" }] }));
        result_of(&rig.run(&request));
        let after = open(&rig.output());
        let shaders = shaders_of(&after);
        assert_eq!(word(&after.graph, shaders[0], 0x08), joaat("default"));
        assert_eq!(
            word(&after.graph, shaders[0], 0x18),
            joaat("normal_spec.sps"),
            "файл шейдера не трогается"
        );
        assert_eq!(after.graph.content(shaders[0])[0x10], 7);
        assert_eq!(after.graph.content(shaders[0])[0x11], 0);
        assert_eq!(
            word(&after.graph, shaders[0], 0x28),
            0xABCD_0001,
            "прочие байты шейдера те же"
        );
        // длины таблицы параметров идут за раскладкой: по ним игра находит хеши имён (17.11.2026)
        assert_eq!(
            shader_facts(&after.graph, shaders[0]),
            layout_facts("default", 0)
        );
        assert_eq!(
            shader_facts(&after.graph, shaders[1]),
            layout_facts("emissive", 0)
        );
        let table = nav(&after.graph, shaders[0], &[0]);
        assert_eq!(texture_of_row(&after.graph, table, 0), "prop_a");
        assert_eq!(
            vector_of(
                &after.graph,
                table,
                row_of(standard_layout("default"), "HardAlphaBlend")
            ),
            [7.0, 8.0, 9.0, 10.0]
        );
        assert_eq!(
            vector_of(
                &after.graph,
                table,
                row_of(standard_layout("default"), "matMaterialColorScale")
            ),
            [1.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(
            vector_of(
                &after.graph,
                table,
                row_of(standard_layout("default"), "globalAnimUV1")
            ),
            [0.0, 1.0, 0.0, 0.0]
        );
        let second = nav(&after.graph, shaders[1], &[0]);
        assert_eq!(word(&after.graph, shaders[1], 0x08), joaat("emissive"));
        assert_eq!(
            registers_of(&after.graph, second, 7),
            [0, 0xa5, 0xa4, 0xa3, 0xa2, 0xa1, 0xa0],
            "подменённый шейдер получает регистры игры, а не нули"
        );
        assert_eq!(
            vector_of(
                &after.graph,
                second,
                row_of(standard_layout("emissive"), "emissiveMultiplier")
            ),
            [1.0, 0.0, 0.0, 0.0]
        );
        for (swap, shader_at, message) in [
            ("normal", 3, "lamp-pole: у шейдера нет BumpSampler."),
            ("normal_spec", 1, "lamp-pole: у шейдера нет BumpSampler."),
            ("glass", 0, "lamp-pole: подмена glass не поддержана."),
        ] {
            let request = rig.request(
                &model,
                json!({ "shaders": [{ "index": shader_at, "swap": swap }] }),
            );
            assert_refused(&rig.run(&request), "InvalidDataException", message);
        }
    }

    #[test]
    fn broken_shader_parameters_are_refused() {
        let rig = Rig::new();
        let fresh = || build(&standard());
        let shader3 = |graph: &Graph| {
            let list = nav(graph, group_of(graph), &[0x10]);
            pointer_block(graph, list, 24).unwrap()
        };
        let run = |graph: &Graph, edit: Value| {
            let model = rig.model("m", graph);
            let sheet = rig.sheet(
                "astral_pole_body",
                "body16.dds",
                &make_dds(b"DXT1", 16, 16, 1, 3),
            );
            let request = rig.request(&model, json!({ "textures": [sheet], "shaders": [edit] }));
            rig.run(&request)
        };
        let params = "lamp-pole: у шейдера нет параметров.";
        let mut graph = fresh();
        let shader = shader3(&graph);
        cut(&mut graph, shader, 0);
        for edit in [
            json!({ "index": 3, "diffuse": "astral_pole_body" }),
            json!({ "index": 3, "specular": 2 }),
            json!({ "index": 3, "swap": "default" }),
        ] {
            assert_refused(&run(&graph, edit), "InvalidDataException", params);
        }
        result_of(&run(&graph, json!({ "index": 3, "preset": "alpha.sps" })));

        let mut graph = fresh();
        let shader = shader3(&graph);
        poke(&mut graph, shader, 0x10, &[0]);
        assert_refused(
            &run(
                &graph,
                json!({ "index": 3, "specular": 2, "swap": "default" }),
            ),
            "InvalidDataException",
            "lamp-pole: у шейдера нет DiffuseSampler.",
        );
        assert_refused(
            &run(&graph, json!({ "index": 3, "diffuse": "astral_pole_body" })),
            "InvalidDataException",
            "lamp-pole: у шейдера корпуса нет DiffuseSampler.",
        );

        // Число параметров больше блока таблицы (176 = 11 записей): раньше паника индексации (InternalError), теперь отказ.
        let mut graph = fresh();
        let first = nav(&graph, group_of(&graph), &[0x10, 0]);
        poke(&mut graph, first, 0x10, &[200]);
        let response = run(&graph, json!({ "index": 0, "specular": 2 }));
        assert_refused(
            &response,
            "InvalidDataException",
            "lamp-pole: таблица параметров шейдера не умещается в блок.",
        );

        // Нет указателя на текстуру у DiffuseSampler.
        let mut graph = fresh();
        let first = nav(&graph, group_of(&graph), &[0x10, 0]);
        let table = nav(&graph, first, &[0]);
        cut(&mut graph, table, 8);
        assert_refused(
            &run(&graph, json!({ "index": 0, "swap": "default" })),
            "InvalidDataException",
            "lamp-pole: текстура без цели.",
        );
        assert_refused(
            &run(&graph, json!({ "index": 0, "diffuse": "astral_pole_body" })),
            "InvalidOperationException",
            "В блоке нет указателя по этому смещению.",
        );
    }

    // ---------------------------------------------------------------- словарь

    #[test]
    fn a_model_without_a_dictionary_gets_one_from_the_first_sheet() {
        let mut spec = standard();
        spec.textures.clear();
        let rig = Rig::new();
        let model = rig.model("m", &build(&spec));
        let sheets = json!([
            rig.sheet(
                "astral_pole_body",
                "body16.dds",
                &make_dds(b"DXT1", 16, 16, 1, 3)
            ),
            rig.sheet(
                "astral_pole_b",
                "deco16b.dds",
                &make_dds(b"DXT5", 16, 16, 1, 8)
            ),
        ]);
        let request = rig.request(&model, json!({
            "textures": sheets,
            "shaders": [{ "index": 1, "diffuse": "astral_pole_body" }, { "index": 2, "diffuse": "astral_pole_b" }],
        }));
        let response = rig.run(&request);
        assert_eq!(
            result_of(&response)["semantic"]["textures"],
            json!(["astral_pole_body", "astral_pole_b"])
        );
        let after = open(&rig.output());
        let mut names = sheet_names(&after);
        names.sort();
        assert_eq!(names, ["astral_pole_b", "astral_pole_body"]);
        let shaders = shaders_of(&after);
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[1], &[0]), 0),
            "astral_pole_body"
        );
        assert_eq!(
            texture_of_row(&after.graph, nav(&after.graph, shaders[2], &[0]), 0),
            "astral_pole_b"
        );
        assert!(after.graph.blocks[after.group]
            .slots
            .iter()
            .any(|slot| slot.relative == 8));
    }

    #[test]
    fn dictionary_defects_are_refused_with_the_neighbour_texts() {
        let rig = Rig::new();
        let sheet = rig.sheet(
            "astral_pole_body",
            "body16.dds",
            &make_dds(b"DXT1", 16, 16, 1, 3),
        );
        let mut graph = build(&standard());
        let dictionary = nav(&graph, group_of(&graph), &[0x08]);
        cut(&mut graph, dictionary, 0x30);
        let model = rig.model("m", &graph);
        for body in [
            json!({ "textures": [sheet], "shaders": [{ "index": 0, "diffuse": "astral_pole_body" }] }),
            json!({ "shaders": [{ "index": 0, "specular": 1.5 }] }),
        ] {
            let request = rig.request(&model, body);
            assert_refused(
                &rig.run(&request),
                "InvalidOperationException",
                "словарь текстур: у словаря нет списка текстур.",
            );
        }
        let mut graph = build(&standard());
        let dictionary = nav(&graph, group_of(&graph), &[0x08]);
        poke(&mut graph, dictionary, 0x38, &0u16.to_le_bytes());
        let model = rig.model("m", &graph);
        let request = rig.request(
            &model,
            json!({ "textures": [sheet], "shaders": [{ "index": 0, "specular": 2 }] }),
        );
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: в словаре нет текстур-образцов.",
        );
    }

    // ------------------------------------------------------------- украшение

    fn deco_sheet(rig: &Rig, name: &str) -> Value {
        rig.sheet(
            name,
            &format!("{name}.dds"),
            &make_dds(b"DXT5", 16, 16, 1, 7),
        )
    }

    fn triangle(offset: f64, size: f64) -> Value {
        json!({
            "positions": [offset, 0.0, 0.0, offset + size, 0.0, 0.0, offset, size, 0.0],
            "normals": [0, 0, 1, 0, 0, 1, 0, 0, 1],
            "uvs": [0, 0, 1, 0, 0, 1],
            "indices": [0, 1, 2],
        })
    }

    fn quad(z: f64, size: f64, x: f64, y: f64) -> Value {
        json!({
            "positions": [x, y, z, x + size, y, z, x + size, y + size, z, x, y + size, z],
            "normals": [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
            "uvs": [0, 0, 1, 0, 1, 1, 0, 1],
            "indices": [0, 1, 2, 0, 2, 3],
        })
    }

    fn part(level: &str, role: &str, geometry: Value) -> Value {
        let mut part = geometry;
        part["lod"] = json!(level);
        part["role"] = json!(role);
        part
    }

    fn decoration(rig: &Rig, parts: Vec<Value>, glow: f64, bone: u64) -> Value {
        json!({ "texture": deco_sheet(rig, "astral_pole_deco"), "glow": glow, "bone": bone, "parts": parts })
    }

    fn floats_of_bytes(bytes: &[u8], count: usize) -> Vec<f32> {
        (0..count).map(|at| float_at(bytes, at * 4)).collect()
    }

    /// Последняя геометрия модели: (геометрия, буфер вершин, буфер индексов).
    fn newest(graph: &Graph, model: usize) -> (usize, usize, usize) {
        let geometry = *geometry_blocks(graph, model).unwrap().last().unwrap();
        (
            geometry,
            nav(graph, geometry, &[0x18]),
            nav(graph, geometry, &[0x38]),
        )
    }

    #[test]
    fn a_body_and_glow_decoration_adds_shaders_and_geometries() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let parts = vec![
            part("high", "body", triangle(0.0, 0.1)),
            part("high", "glow", triangle(0.02, 0.1)),
        ];
        let request = rig.request(
            &model,
            json!({ "decorations": decoration(&rig, parts, 1.5, 0) }),
        );
        let response = rig.run(&request);
        let result = result_of(&response);
        assert_eq!(result["semantic"]["textures"], json!(["astral_pole_deco"]));
        assert_eq!(
            result["semantic"]["decorated"],
            json!({ "high": { "vertices": 3, "geometries": 1 } })
        );
        let after = open(&rig.output());
        assert_eq!(sheet_names(&after).len(), 3);
        assert_eq!(half(&after.graph, after.group, 0x18), 6);
        assert_eq!(
            half(&after.graph, after.group, 0x1a),
            6,
            "ёмкость списка шейдеров равна числу, как у игры"
        );
        let shaders = shaders_of(&after);
        assert_eq!(shaders.len(), 6);
        let object = after.sheet_object("astral_pole_deco").unwrap();
        for (at, name, file) in [
            (4, "default", "default.sps"),
            (5, "emissive", "emissive.sps"),
        ] {
            let shader = shaders[at];
            assert_eq!(word(&after.graph, shader, 0x08), joaat(name));
            assert_eq!(word(&after.graph, shader, 0x18), joaat(file));
            assert_eq!(
                word(&after.graph, shader, 0x28),
                0xABCD_0001,
                "байты образца сохраняются"
            );
            assert_eq!(shader_facts(&after.graph, shader), layout_facts(name, 0));
            assert_eq!(&after.graph.content(shader)[0x10..0x12], &[7, 0]);
            let table = nav(&after.graph, shader, &[0]);
            assert_eq!(rg::pointer_from(&after.graph, table, 8), Some(object));
            // регистры строк, как у шейдеров `default` и `emissive` игры: лист в 0, шесть векторов в 0xa5…0xa0
            assert_eq!(
                registers_of(&after.graph, table, 7),
                [0, 0xa5, 0xa4, 0xa3, 0xa2, 0xa1, 0xa0]
            );
        }
        let glow_table = nav(&after.graph, shaders[5], &[0]);
        assert_eq!(
            vector_of(
                &after.graph,
                glow_table,
                row_of(standard_layout("emissive"), "emissiveMultiplier")
            ),
            [1.5, 0.0, 0.0, 0.0]
        );
        let body_table = nav(&after.graph, shaders[4], &[0]);
        assert_eq!(
            vector_of(
                &after.graph,
                body_table,
                row_of(standard_layout("default"), "wetnessMultiplier")
            ),
            [1.0, 0.0, 0.0, 0.0]
        );

        let high = lod_models(&after.graph, after.drawable, 0x50).unwrap();
        assert_eq!(geometry_blocks(&after.graph, high[0]).unwrap().len(), 3);
        assert_eq!(
            geometry_blocks(&after.graph, high[1]).unwrap().len(),
            2,
            "другие модели те же"
        );
        for relative in [0x10, 0x12, 0x2e] {
            assert_eq!(half(&after.graph, high[0], relative), 3);
        }
        assert_eq!(
            mapping_of(&after.graph, high[0]).unwrap(),
            Some(vec![0, 4, 5])
        );
        let records = records_of(&after.graph, high[0]).unwrap();
        assert_eq!(records.len(), 3);
        assert_eq!(
            floats_of_bytes(&records[2], 8),
            [0.02, 0.0, 0.0, 0.02, 0.12, 0.1, 0.0, 0.12]
        );
        assert_eq!(half(&after.graph, high[0], 0x2c), 0x0101);

        let (geometry, vertex_buffer, index_buffer) = newest(&after.graph, high[0]);
        assert_eq!(half(&after.graph, vertex_buffer, 0x08), 36);
        assert_eq!(word(&after.graph, vertex_buffer, 0x18), 3);
        let data = nav(&after.graph, vertex_buffer, &[0x10]);
        assert_eq!(
            rg::pointer_from(&after.graph, vertex_buffer, 0x20),
            rg::pointer_from(&after.graph, vertex_buffer, 0x10)
        );
        let expected: Vec<u8> = [
            [0.02f32, 0.0, 0.0, 0.0, 0.0, 1.0],
            [0.12, 0.0, 0.0, 0.0, 0.0, 1.0],
            [0.02, 0.1, 0.0, 0.0, 0.0, 1.0],
        ]
        .iter()
        .zip([[0.0f32, 0.0], [1.0, 0.0], [0.0, 1.0]])
        .flat_map(|(head, uv)| {
            let mut vertex: Vec<u8> = head.iter().flat_map(|value| value.to_le_bytes()).collect();
            vertex.extend_from_slice(&[0xff; 4]);
            vertex.extend(uv.iter().flat_map(|value| value.to_le_bytes()));
            vertex
        })
        .collect();
        assert_eq!(&after.graph.content(data)[..108], &expected[..]);
        let declaration = nav(&after.graph, vertex_buffer, &[0x30]);
        assert_eq!(word(&after.graph, declaration, 0), 0x59);
        assert_eq!(half(&after.graph, declaration, 4), 36);
        // число занятых слотов и типы всех слотов — как у геометрии игры
        assert_eq!(after.graph.content(declaration)[7], 4);
        assert_eq!(
            &after.graph.content(declaration)[8..16],
            &0x7755_5555_5599_6996u64.to_le_bytes()
        );
        assert_eq!(word(&after.graph, index_buffer, 0x08), 3);
        // игра рисует по счётчикам самой геометрии, а не по буферам: индексы, треугольники, вершины, шаг, кости
        assert_eq!(word(&after.graph, geometry, 0x58), 3);
        assert_eq!(word(&after.graph, geometry, 0x5c), 1);
        assert_eq!(half(&after.graph, geometry, 0x60), 3);
        assert_eq!(half(&after.graph, geometry, 0x70), 36);
        assert_eq!(half(&after.graph, geometry, 0x72), 0);
        let indices = nav(&after.graph, index_buffer, &[0x10]);
        assert_eq!(&after.graph.content(indices)[..6], &[0, 0, 1, 0, 2, 0]);
        assert_eq!(
            rg::pointer_from(&after.graph, geometry, 0x18).map(|at| at.offset),
            Some(after.graph.blocks[vertex_buffer].start)
        );
    }

    #[test]
    fn rigid_vertices_are_carried_into_the_axis_of_the_chosen_bone() {
        let mut spec = standard();
        spec.levels[0].push(rigid_model(2, &[3]));
        let rig = Rig::new();
        let model = rig.model("m", &build(&spec));
        for (bone, expected) in [
            (0u64, [[0.0f32, 0.0, 0.0], [0.1, 0.0, 0.0], [0.0, 0.1, 0.0]]),
            (
                1,
                [[-1.0, -2.0, -3.0], [-0.9, -2.0, -3.0], [-1.0, -1.9, -3.0]],
            ),
            (2, [[-2.0, 1.0, -3.0], [-2.0, 0.9, -3.0], [-1.9, 1.0, -3.0]]),
        ] {
            let request = rig.request(&model, json!({ "decorations": decoration(&rig, vec![part("high", "body", triangle(0.0, 0.1))], 1.0, bone) }));
            result_of(&rig.run(&request));
            let after = open(&rig.output());
            let high = lod_models(&after.graph, after.drawable, 0x50).unwrap();
            let target = high[bone as usize];
            let expected_count = [2, 3, 2][bone as usize];
            assert_eq!(
                geometry_blocks(&after.graph, target).unwrap().len(),
                expected_count
            );
            let (_, vertex_buffer, _) = newest(&after.graph, target);
            let data = after
                .graph
                .content(nav(&after.graph, vertex_buffer, &[0x10]));
            for (vertex, want) in expected.iter().enumerate() {
                let got = floats_of_bytes(&data[vertex * 36..], 6);
                for axis in 0..3 {
                    assert!(
                        (got[axis] - want[axis]).abs() < 1e-5,
                        "кость {bone}, вершина {vertex}: {got:?} вместо {want:?}"
                    );
                }
                assert!(
                    (got[5] - 1.0).abs() < 1e-5 && got[3].abs() < 1e-5 && got[4].abs() < 1e-5,
                    "нормаль {got:?}"
                );
            }
            // Рамка геометрии — по позициям после перехода.
            let records = records_of(&after.graph, target).unwrap();
            let record = floats_of_bytes(records.last().unwrap(), 8);
            let low = (0..3)
                .map(|axis| expected.iter().map(|p| p[axis]).fold(f32::MAX, f32::min))
                .collect::<Vec<_>>();
            for axis in 0..3 {
                assert!((record[axis] - low[axis]).abs() < 1e-5, "{record:?}");
            }
        }
    }

    #[test]
    fn skinned_vertices_keep_positions_and_name_the_palette_slot() {
        let mut spec = standard();
        let skin = |palette: &[u16]| GeometrySpec {
            vertices: 3,
            palette: palette.to_vec(),
        };
        spec.levels[0] = vec![ModelSpec {
            word: 0x0000_0100,
            mask: 0x0100,
            mapping: vec![0, 1],
            geometries: vec![skin(&[5, 3, 0, 7]), skin(&[2, 9])],
        }];
        let rig = Rig::new();
        let model = rig.model("m", &build(&spec));
        for (bone, slot, palette) in [
            (3u64, 1u8, vec![5u16, 3, 0, 7]),
            (9, 1, vec![2, 9]),
            (4, 2, vec![5, 3, 0, 7]),
        ] {
            let request = rig.request(&model, json!({ "decorations": decoration(&rig, vec![part("high", "body", quad(1.0, 0.4, 0.3, 0.2))], 1.0, bone) }));
            result_of(&rig.run(&request));
            let after = open(&rig.output());
            let target = high_model(&after.graph);
            let (geometry, vertex_buffer, _) = newest(&after.graph, target);
            assert_eq!(half(&after.graph, vertex_buffer, 0x08), 44);
            assert_eq!(word(&after.graph, vertex_buffer, 0x18), 4);
            let declaration = nav(&after.graph, vertex_buffer, &[0x30]);
            assert_eq!(word(&after.graph, declaration, 0), 0x5f);
            assert_eq!(after.graph.content(declaration)[7], 6);
            assert_eq!(
                &after.graph.content(declaration)[8..16],
                &0x7755_5555_5599_6996u64.to_le_bytes()
            );
            // четыре вершины, шесть индексов (два треугольника) и шаг кожи
            assert_eq!(word(&after.graph, geometry, 0x58), 6);
            assert_eq!(word(&after.graph, geometry, 0x5c), 2);
            assert_eq!(half(&after.graph, geometry, 0x60), 4);
            assert_eq!(half(&after.graph, geometry, 0x70), 44);
            let data = after
                .graph
                .content(nav(&after.graph, vertex_buffer, &[0x10]));
            assert_eq!(floats_of_bytes(data, 3), [0.3, 0.2, 1.0]);
            assert_eq!(&data[12..20], &[0, 0, 0xff, 0, 0, 0, slot, 0]);
            assert_eq!(floats_of_bytes(&data[20..], 3), [0.0, 0.0, 1.0]);
            assert_eq!(&data[32..36], &[0xff; 4]);
            assert_eq!(half(&after.graph, geometry, 0x72), palette.len() as u16);
            let ids: Vec<u16> = after
                .graph
                .content(nav(&after.graph, geometry, &[0x68]))
                .chunks_exact(2)
                .take(palette.len())
                .map(|p| u16::from_le_bytes([p[0], p[1]]))
                .collect();
            assert_eq!(ids, palette);
            let records = records_of(&after.graph, target).unwrap();
            assert_eq!(
                floats_of_bytes(records.last().unwrap(), 8),
                [0.3, 0.2, 1.0, 0.3, 0.7, 0.6, 1.0, 0.7]
            );
        }
        // Нет палитр: отказ.
        for cut_all in [true, false] {
            let mut graph = build(&spec);
            for geometry in geometry_blocks(&graph, high_model(&graph)).unwrap() {
                if cut_all {
                    cut(&mut graph, geometry, 0x68);
                } else {
                    poke(&mut graph, geometry, 0x72, &0u16.to_le_bytes());
                }
            }
            let model = rig.model("m", &graph);
            let request = rig.request(&model, json!({ "decorations": decoration(&rig, vec![part("high", "body", triangle(0.0, 0.1))], 1.0, 0) }));
            assert_refused(
                &rig.run(&request),
                "InvalidDataException",
                "lamp-pole: у модели со скином нет палитры костей.",
            );
        }
    }

    #[test]
    fn parts_without_a_level_list_are_skipped_but_the_shaders_stay() {
        let mut spec = standard();
        spec.levels[1].clear();
        let rig = Rig::new();
        let model = rig.model("m", &build(&spec));
        let parts = vec![
            part("high", "body", triangle(0.0, 0.1)),
            part("medium", "body", triangle(0.0, 0.1)),
            part("low", "glow", triangle(0.0, 0.1)),
        ];
        let request = rig.request(
            &model,
            json!({ "decorations": decoration(&rig, parts, 1.5, 0) }),
        );
        let response = rig.run(&request);
        assert_eq!(
            result_of(&response)["semantic"]["decorated"],
            json!({ "high": { "vertices": 3, "geometries": 1 }, "low": { "vertices": 3, "geometries": 1 } })
        );
        let after = open(&rig.output());
        assert_eq!(shaders_of(&after).len(), 6, "шейдеры body и glow добавлены");

        let mut spec = standard();
        spec.levels = [vec![rigid_model(0, &[0])], Vec::new(), Vec::new()];
        let model = rig.model("m", &build(&spec));
        let request = rig.request(&model, json!({ "decorations": decoration(&rig, vec![part("medium", "body", triangle(0.0, 0.1))], 1.0, 0) }));
        let response = rig.run(&request);
        assert_eq!(result_of(&response)["semantic"]["decorated"], json!({}));
        assert_eq!(shaders_of(&open(&rig.output())).len(), 5);
    }

    #[test]
    fn the_report_keeps_the_first_place_and_the_last_value_of_a_level() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let parts = vec![
            part("medium", "body", quad(0.0, 0.2, 0.0, 0.0)),
            part("high", "body", triangle(0.0, 0.1)),
            part("medium", "glow", triangle(0.0, 0.1)),
            part("low", "body", quad(0.1, 0.2, 0.0, 0.0)),
        ];
        let request = rig.request(
            &model,
            json!({ "decorations": decoration(&rig, parts, 1.5, 0) }),
        );
        let response = rig.run(&request);
        let report = &result_of(&response)["semantic"]["decorated"];
        let keys: Vec<&String> = report.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["medium", "high", "low"]);
        assert_eq!(report["medium"]["vertices"], 3);
        assert_eq!(report["low"]["vertices"], 4);
    }

    #[test]
    fn a_part_far_from_the_pole_grows_the_frame_and_both_spheres() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let request = rig.request(&model, json!({ "decorations": decoration(&rig, vec![part("high", "body", quad(0.0, 2.0, 20.0, 0.0))], 1.0, 0) }));
        result_of(&rig.run(&request));
        let after = open(&rig.output());
        let floats = |block: usize, at: usize, count: usize| {
            floats_of_bytes(&after.graph.content(block)[at..], count)
        };
        let low = floats(after.drawable, 0x30, 3);
        let high = floats(after.drawable, 0x40, 3);
        assert_eq!(low, [-0.3952, -2.4175, -0.0712]);
        assert_eq!(high, [22.0, 2.0, 9.3189]);
        let expected =
            ((22.0f64).powi(2) + (2.0f64 + 0.9768).powi(2) + (9.3189f64 - 4.6238).powi(2)).sqrt();
        for block in [after.drawable, after.root] {
            let radius = floats(block, 0x2c, 1)[0];
            assert!(
                (f64::from(radius) - expected).abs() < 1e-3,
                "{radius} {expected}"
            );
            assert_eq!(floats(block, 0x20, 3), [0.0, -0.9768, 4.6238]);
        }
        // Часть внутри рамки: рамка и шар остаются.
        let request = rig.request(&model, json!({ "decorations": decoration(&rig, vec![part("high", "body", quad(2.0, 0.1, 0.0, 0.0))], 1.0, 0) }));
        result_of(&rig.run(&request));
        let inside = open(&rig.output());
        assert_eq!(
            floats_of_bytes(&inside.graph.content(inside.drawable)[0x30..], 3),
            [-0.3952, -2.4175, -0.0712]
        );
        assert_eq!(
            floats_of_bytes(&inside.graph.content(inside.drawable)[0x40..], 3),
            [0.3952, 0.4639, 9.3189]
        );
        let radius = floats_of_bytes(&inside.graph.content(inside.root)[0x2c..], 1)[0];
        assert!((radius - 4.927).abs() < 1e-3);
    }

    #[test]
    fn decoration_requests_are_refused_in_the_documented_order() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let sheet = deco_sheet(&rig, "astral_pole_deco");
        let own = |positions: Value, normals: Value, uvs: Value, indices: Value| {
            part(
                "high",
                "body",
                json!({ "positions": positions, "normals": normals, "uvs": uvs, "indices": indices }),
            )
        };
        let good = || {
            own(
                json!([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]),
                json!([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                json!([0, 0, 1, 0, 0, 1]),
                json!([0, 1, 2]),
            )
        };
        let with = |patch: &dyn Fn(&mut Value)| {
            let mut value = good();
            patch(&mut value);
            value
        };
        let big = |count: usize, level: &str, role: &str| {
            part(
                level,
                role,
                json!({
                    "positions": vec![0; 3 * count], "normals": vec![0; 3 * count], "uvs": vec![0; 2 * count], "indices": [0, 1, 2]
                }),
            )
        };
        let layout = "lamp-pole: у части сломаны массивы вершин.";
        let outside = "lamp-pole: значения части вне допуска.";
        let triangles = "lamp-pole: индексы — не треугольники.";
        let cases: Vec<(Vec<Value>, &str)> = vec![
            (vec![], "lamp-pole: украшение — от 1 до 6 частей."),
            (
                vec![with(&|p| p["lod"] = json!("vlow"))],
                "lamp-pole: часть — уровень high/medium/low и роль body/glow.",
            ),
            (
                vec![with(&|p| p["lod"] = json!("High"))],
                "lamp-pole: часть — уровень high/medium/low и роль body/glow.",
            ),
            (
                vec![with(&|p| p["role"] = json!("decal"))],
                "lamp-pole: часть — уровень high/medium/low и роль body/glow.",
            ),
            (
                vec![json!({})],
                "lamp-pole: часть — уровень high/medium/low и роль body/glow.",
            ),
            (
                vec![with(&|p| {
                    p.as_object_mut().unwrap().remove("positions");
                })],
                layout,
            ),
            (
                vec![with(&|p| {
                    p["positions"] = json!([0, 0, "a", 1, 1, 1, 2, 2, 2])
                })],
                "lamp-pole: positions — не числа.",
            ),
            (
                vec![with(&|p| p["positions"] = json!([0, 0, 0, 1, 1, 1, 2, 2]))],
                "lamp-pole: positions — длина не кратна 3.",
            ),
            (
                vec![with(&|p| p["normals"] = json!([0, 0, 1, 0, 0, 1, 0, 0]))],
                "lamp-pole: normals — длина не кратна 3.",
            ),
            (
                vec![with(&|p| p["uvs"] = json!([0, 0, 1, 0, 0]))],
                "lamp-pole: uvs — длина не кратна 2.",
            ),
            (
                vec![with(&|p| {
                    p["positions"] = json!([0, 0, 0, 1, 1, 1]);
                    p["normals"] = json!([0, 0, 1, 0, 0, 1]);
                    p["uvs"] = json!([0, 0, 1, 1]);
                })],
                layout,
            ),
            (
                vec![with(&|p| p["normals"] = json!([0, 0, 1, 0, 0, 1]))],
                layout,
            ),
            (
                vec![with(&|p| p["uvs"] = json!([0, 0, 1, 0, 0, 1, 0, 0]))],
                layout,
            ),
            (vec![big(12001, "high", "body")], layout),
            (
                vec![with(&|p| p["indices"] = json!([0, 1, 3]))],
                "lamp-pole: индекс вне вершин.",
            ),
            (
                vec![with(&|p| p["indices"] = json!([0, 1, 1.5]))],
                "lamp-pole: индекс вне вершин.",
            ),
            (
                vec![with(&|p| p["indices"] = json!([0, 1, -1]))],
                "lamp-pole: индекс вне вершин.",
            ),
            (
                vec![with(&|p| p["indices"] = json!([0, 1, "2"]))],
                "lamp-pole: индекс вне вершин.",
            ),
            (vec![with(&|p| p["indices"] = json!([0, 1]))], triangles),
            (
                vec![with(&|p| p["indices"] = json!([0, 1, 2, 0]))],
                triangles,
            ),
            (vec![with(&|p| p["indices"] = json!([]))], triangles),
            (
                vec![with(&|p| {
                    p["positions"] = json!([30.01, 0, 0, 0, 0, 0, 0, 1, 0])
                })],
                outside,
            ),
            (
                vec![with(&|p| {
                    p["normals"] = json!([0, 0, 1.02, 0, 0, 1, 0, 0, 1])
                })],
                outside,
            ),
            (
                vec![with(&|p| p["uvs"] = json!([0, 0, 1.001, 0, 0, 1]))],
                outside,
            ),
            (
                vec![with(&|p| p["uvs"] = json!([0, -0.001, 1, 0, 0, 1]))],
                outside,
            ),
            (
                vec![good(), part("high", "body", good())],
                "lamp-pole: часть с таким уровнем и ролью уже есть.",
            ),
            (
                vec![
                    big(12000, "high", "body"),
                    big(12000, "medium", "body"),
                    big(12000, "low", "body"),
                    big(12000, "high", "glow"),
                ],
                "lamp-pole: вершин украшения больше 40000.",
            ),
            (
                vec![
                    with(&|p| p["indices"] = json!([0, 1])),
                    part("low", "bad", good()),
                ],
                triangles,
            ),
            (
                (0..7)
                    .map(|at| {
                        part(
                            ["high", "medium", "low"][at % 3],
                            ["body", "glow"][at % 2],
                            good(),
                        )
                    })
                    .collect(),
                "lamp-pole: украшение — от 1 до 6 частей.",
            ),
        ];
        for (parts, message) in cases {
            let body = json!({ "texture": sheet, "glow": 1.5, "bone": 0, "parts": parts });
            let request = rig.request(&model, json!({ "decorations": body }));
            assert_refused(&rig.run(&request), "InvalidDataException", message);
        }
        // Предельные значения допустимы.
        for patch in [
            Box::new(|p: &mut Value| p["positions"] = json!([-30, 0, 0, 0, 0, 0, 0, 1, 0]))
                as Box<dyn Fn(&mut Value)>,
            Box::new(|p: &mut Value| p["normals"] = json!([0, 0, 1.01, 0, 0, 0, 0.5, 0.5, 0.5])),
            Box::new(|p: &mut Value| p["uvs"] = json!([0, 0, 1, 1, 0, 1])),
            Box::new(|p: &mut Value| p["positions"] = json!([-30, -30, -30, 30, 30, 30, 0, 0, 0])),
        ] {
            let body =
                json!({ "texture": sheet, "glow": 1.5, "bone": 0, "parts": [with(&*patch)] });
            let request = rig.request(&model, json!({ "decorations": body }));
            result_of(&rig.run(&request));
        }
        // Шесть частей по 12000 вершин не набрать, три — можно.
        let three = vec![
            big(12000, "high", "body"),
            big(12000, "medium", "body"),
            big(12000, "low", "body"),
        ];
        let body = json!({ "texture": sheet, "glow": 1.5, "bone": 0, "parts": three });
        let request = rig.request(&model, json!({ "decorations": body }));
        let response = rig.run(&request);
        assert_eq!(
            result_of(&response)["semantic"]["decorated"]["low"]["vertices"],
            12000
        );
    }

    #[test]
    fn decoration_fields_are_read_softly_or_refused() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let sheet = deco_sheet(&rig, "astral_pole_deco");
        let parts = json!([part("high", "glow", triangle(0.0, 0.1))]);
        let run = |patch: Value| {
            let mut body = json!({ "texture": sheet, "parts": parts });
            for (key, value) in patch.as_object().unwrap() {
                body[key] = value.clone();
            }
            let request = rig.request(&model, json!({ "decorations": body }));
            rig.run(&request)
        };
        let glow = "lamp-pole: свечение украшения — от 0 до 64.";
        for (patch, message) in [
            (json!({ "glow": 64.01 }), Some(glow)),
            (json!({ "glow": -0.5 }), Some(glow)),
            (
                json!({ "bone": 256 }),
                Some("lamp-pole: кость украшения вне 0–255."),
            ),
            (json!({ "glow": 999, "bone": 999 }), Some(glow)),
            (json!({ "glow": "5" }), None),
            (json!({ "glow": 64 }), None),
            (json!({ "bone": -1 }), None),
            (json!({ "bone": 1.5 }), None),
            (json!({ "bone": "2" }), None),
            (json!({ "bone": 255 }), None),
            (json!({}), None),
        ] {
            let response = run(patch.clone());
            match message {
                Some(text) => assert_refused(&response, "InvalidDataException", text),
                None => {
                    result_of(&response);
                }
            }
        }
        let after = open(&rig.output());
        let glow_table = nav(&after.graph, shaders_of(&after)[4], &[0]);
        assert_eq!(
            vector_of(
                &after.graph,
                glow_table,
                row_of(standard_layout("emissive"), "emissiveMultiplier")
            )[0],
            0.0,
            "glow по умолчанию — ноль"
        );
        run(json!({ "glow": 0.1234567 }));
        let after = open(&rig.output());
        let glow_table = nav(&after.graph, shaders_of(&after)[4], &[0]);
        assert_eq!(
            vector_of(
                &after.graph,
                glow_table,
                row_of(standard_layout("emissive"), "emissiveMultiplier")
            )[0],
            0.123_456_7_f32
        );
        // Нет листа: отказ раньше свечения.
        let request = rig.request(
            &model,
            json!({ "decorations": { "glow": 999, "parts": [] } }),
        );
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: украшению нужен лист.",
        );
    }

    #[test]
    fn decoration_defects_in_the_model_are_refused() {
        let rig = Rig::new();
        let parts = || {
            vec![
                part("high", "body", triangle(0.0, 0.1)),
                part("high", "glow", triangle(0.0, 0.1)),
            ]
        };
        let run = |graph: &Graph| {
            let model = rig.model("m", graph);
            let request = rig.request(
                &model,
                json!({ "decorations": decoration(&rig, parts(), 1.5, 0) }),
            );
            rig.run(&request)
        };
        let template = "lamp-pole: у шаблона нет нужного указателя.";
        type Defect = Box<dyn Fn(&mut Graph)>;
        let first_geometry = |graph: &Graph| nav(graph, high_model(graph), &[0x08, 0]);
        let cases: Vec<(Defect, &str, &str)> = vec![
            (
                Box::new(|g| {
                    let s = group_of(g);
                    poke(g, s, 0x18, &0u16.to_le_bytes());
                }),
                "InvalidDataException",
                "lamp-pole: у модели нет шейдеров.",
            ),
            (
                Box::new(|g| {
                    let e = nav(g, drawable_of(g), &[0x50, 0]);
                    cut(g, e, 0);
                }),
                "InvalidDataException",
                "lamp-pole: пустая модель уровня.",
            ),
            (
                Box::new(|g| {
                    let m = high_model(g);
                    poke(g, m, 0x10, &0u16.to_le_bytes());
                }),
                "InvalidDataException",
                "lamp-pole: у модели нет геометрии-образца.",
            ),
            (
                Box::new(move |g| {
                    let x = first_geometry(g);
                    cut(g, x, 0x18);
                }),
                "InvalidDataException",
                "lamp-pole: у геометрии нет буфера вершин.",
            ),
            (
                Box::new(move |g| {
                    let x = first_geometry(g);
                    cut(g, x, 0x38);
                }),
                "InvalidDataException",
                "lamp-pole: у геометрии нет буфера индексов.",
            ),
            (
                Box::new(move |g| {
                    let x = nav(g, first_geometry(g), &[0x18]);
                    cut(g, x, 0x30);
                }),
                "InvalidDataException",
                template,
            ),
            (
                Box::new(move |g| {
                    let x = nav(g, first_geometry(g), &[0x18]);
                    cut(g, x, 0x10);
                }),
                "InvalidDataException",
                template,
            ),
            (
                Box::new(move |g| {
                    let x = nav(g, first_geometry(g), &[0x38]);
                    cut(g, x, 0x10);
                }),
                "InvalidDataException",
                template,
            ),
            (
                Box::new(|g| {
                    let m = high_model(g);
                    cut(g, m, 0x20);
                }),
                "InvalidOperationException",
                "В блоке нет указателя по этому смещению.",
            ),
            (
                Box::new(|g| {
                    let m = high_model(g);
                    cut(g, m, 0x18);
                }),
                "InvalidDataException",
                "graft-drawable: у модели нет рамок.",
            ),
            (
                Box::new(|g| {
                    let s = nav(g, drawable_of(g), &[0x18]);
                    poke(g, s, 0x5e, &200u16.to_le_bytes());
                }),
                "InvalidDataException",
                "lamp-pole: кость вне блока.",
            ),
        ];
        for (defect, code, message) in cases {
            let mut graph = build(&standard());
            defect(&mut graph);
            assert_refused(&run(&graph), code, message);
        }
        // Нет скелета или списка костей: украшение ставится, костей ноль или как были.
        let mut graph = build(&standard());
        let drawable = drawable_of(&graph);
        cut(&mut graph, drawable, 0x18);
        assert_eq!(result_of(&run(&graph))["semantic"]["bones"], 0);
        let mut graph = build(&standard());
        let skeleton = nav(&graph, drawable_of(&graph), &[0x18]);
        cut(&mut graph, skeleton, 0x20);
        assert_eq!(result_of(&run(&graph))["semantic"]["bones"], 4);
        // Нет списка высокого уровня: части молча пропущены.
        let mut graph = build(&standard());
        let drawable = drawable_of(&graph);
        cut(&mut graph, drawable, 0x50);
        let response = run(&graph);
        assert_eq!(result_of(&response)["semantic"]["decorated"], json!({}));
        // Нет словаря: украшение создаёт его.
        let mut graph = build(&standard());
        let group = group_of(&graph);
        cut(&mut graph, group, 0x08);
        let response = run(&graph);
        assert_eq!(
            result_of(&response)["semantic"]["textures"],
            json!(["astral_pole_deco"])
        );
        assert_eq!(sheet_names(&open(&rig.output())), ["astral_pole_deco"]);
    }

    #[test]
    fn a_sheet_that_is_already_in_the_model_is_refused_before_any_dds_is_read() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let body = rig.sheet(
            "astral_pole_body",
            "body16.dds",
            &make_dds(b"DXT1", 16, 16, 1, 3),
        );
        let parts = vec![part("high", "body", triangle(0.0, 0.1))];
        let request = rig.request(&model, json!({ "textures": [body], "shaders": [{ "index": 0, "diffuse": "astral_pole_body" }], "decorations": decoration(&rig, parts.clone(), 1.5, 0) }));
        result_of(&rig.run(&request));
        let first = rig.path("first.yft");
        fs::copy(rig.path("out.yft"), &first).unwrap();
        let again = first.to_string_lossy().into_owned();
        let sheet_a =
            json!({ "name": "astral_pole_deco", "dds": body["dds"], "sha256": "sha256:wrong" });
        for (patch, message) in [
            (
                json!({ "decorations": decoration(&rig, parts.clone(), 1.5, 0) }),
                "lamp-pole: у модели уже есть текстура astral_pole_deco.",
            ),
            (
                json!({ "textures": [body.clone()], "shaders": [{ "index": 0, "diffuse": "astral_pole_body" }] }),
                "lamp-pole: у модели уже есть текстура astral_pole_body.",
            ),
            (
                json!({ "textures": [body.clone()], "decorations": decoration(&rig, parts.clone(), 1.5, 0) }),
                "lamp-pole: у модели уже есть текстура astral_pole_body.",
            ),
            (
                json!({ "textures": [sheet_a], "shaders": [{ "index": 0, "specular": 2 }] }),
                "lamp-pole: у модели уже есть текстура astral_pole_deco.",
            ),
        ] {
            let request = rig.request(&again, patch);
            assert_refused(&rig.run(&request), "InvalidDataException", message);
        }
        // Второе украшение с другим именем листа и повторный блеск.
        let second = json!({
            "texture": rig.sheet("astral_pole_deco2", "deco16b.dds", &make_dds(b"DXT5", 16, 16, 1, 8)),
            "glow": 3, "bone": 0,
            "parts": [part("high", "body", quad(0.5, 0.2, 0.0, 0.0)), part("medium", "glow", triangle(0.0, 0.1))],
        });
        let request = rig.request(&again, json!({ "decorations": second }));
        let response = rig.run(&request);
        assert_eq!(
            result_of(&response)["semantic"]["decorated"]["high"]["vertices"],
            4
        );
        let after = open(&rig.output());
        assert_eq!(
            shaders_of(&after).len(),
            7,
            "пять после первого украшения и ещё два"
        );
        let request = rig.request(&again, json!({ "shaders": [{ "index": 4, "specular": 2 }, { "index": 3, "preset": "alpha.sps" }] }));
        let response = rig.run(&request);
        assert_eq!(result_of(&response)["semantic"]["transparent"], 1);
    }

    #[test]
    fn identically_named_sheets_pass_the_checks_but_fail_the_reopen_and_leave_no_file() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let body = rig.sheet(
            "astral_pole_a",
            "body16.dds",
            &make_dds(b"DXT1", 16, 16, 1, 3),
        );
        let deco = rig.sheet(
            "astral_pole_a",
            "deco16.dds",
            &make_dds(b"DXT5", 16, 16, 1, 7),
        );
        let decoration = json!({ "texture": deco, "glow": 1, "bone": 0, "parts": [part("high", "body", triangle(0.0, 0.1))] });
        let request = rig.request(
            &model,
            json!({ "textures": [body], "decorations": decoration }),
        );
        assert_refused(
            &rig.run(&request),
            "InvalidDataException",
            "lamp-pole: после сборки скелет или листы другие.",
        );
        // Результат перечитывается до записи: прежний код оставлял на диске файл, не прошедший сверку (LP304).
        assert!(!rig.path("out.yft").exists(), "выход не записан до сверки");
    }

    #[test]
    fn model_files_are_checked_before_the_graph_is_built() {
        let rig = Rig::new();
        let good = pack(&build(&standard()));
        let shaders = json!([{ "index": 0, "specular": 1.5 }]);
        let run_with = |bytes: &[u8]| {
            let path = rig.write("m.yft", bytes);
            let request = rig.request(&path, json!({ "shaders": shaders }));
            rig.run(&request)
        };
        assert_refused(
            &run_with(&[]),
            "InvalidDataException",
            "lamp-pole: модель пустая или больше 16 МБ.",
        );
        assert_refused(
            &run_with(&vec![0u8; limits::MODEL + 1]),
            "InvalidDataException",
            "lamp-pole: модель пустая или больше 16 МБ.",
        );
        assert_refused(
            &run_with(&vec![0u8; limits::MODEL]),
            "InvalidOperationException",
            "Файл не является ресурсом RSC7.",
        );
        assert_refused(
            &run_with(b"this is a text, not a model!"),
            "InvalidOperationException",
            "Файл не является ресурсом RSC7.",
        );
        assert_refused(
            &run_with(&good[..8]),
            "InvalidOperationException",
            "Ресурс короче заголовка RSC7.",
        );
        assert_refused(
            &run_with(&good[..16]),
            "InvalidOperationException",
            "Поток ресурса пуст или не распакован.",
        );
        let mut drawable = good.clone();
        drawable[12..16].copy_from_slice(&0x5000_0000u32.to_le_bytes());
        assert_refused(
            &run_with(&drawable),
            "InvalidDataException",
            "lamp-pole: модель — фрагмент .yft.",
        );
        assert_eq!(
            failure(&run_with(&good[..good.len() / 3])).0,
            "InvalidOperationException"
        );
        // Выход поверх самой модели допустим.
        let path = rig.write("m.yft", &good);
        let request = rig.request(&path, json!({ "shaders": shaders }));
        let response = rig.run_to(&request, "m.yft");
        result_of(&response);
        assert_ne!(fs::read(rig.path("m.yft")).unwrap(), good);
    }

    #[test]
    fn output_paths_create_folders_and_replace_files() {
        let rig = Rig::new();
        let model = rig.model("m", &build(&standard()));
        let request = rig.request(&model, shine());
        let response = rig.run_to(&request, "a/b/c/o.YFT");
        assert_eq!(result_of(&response)["file"], "o.YFT");
        assert!(rig.path("a/b/c/o.YFT").is_file());
        let response = rig.run_to(&request, "a/b/c/o.YFT");
        result_of(&response);
        // Выход — папка: отказ доступа, временный файл убран.
        fs::create_dir(rig.path("out.yft")).unwrap();
        assert_eq!(failure(&rig.run(&request)).0, "UnauthorizedAccessException");
        assert!(!rig.path("out.yft.shop-stage").exists());
        // Родитель — файл: отказ создания папки.
        rig.write("afile", b"x");
        assert_eq!(
            failure(&rig.run_to(&request, "afile/o.yft")).0,
            "IOException"
        );
    }

    #[test]
    fn bone_poses_follow_parents_that_come_earlier_only() {
        let record = |translation: [f32; 3], scale: [f32; 3], parent: i16| {
            let mut bytes = vec![0u8; BONE_RECORD];
            bytes[12..16].copy_from_slice(&1.0f32.to_le_bytes());
            for (at, value) in translation.iter().enumerate() {
                bytes[0x10 + at * 4..0x14 + at * 4].copy_from_slice(&value.to_le_bytes());
            }
            for (at, value) in scale.iter().enumerate() {
                bytes[0x20 + at * 4..0x24 + at * 4].copy_from_slice(&value.to_le_bytes());
            }
            bytes[0x32..0x34].copy_from_slice(&parent.to_le_bytes());
            bytes
        };
        let pose_of = |bones: &[Vec<u8>]| {
            let mut a = Areas::default();
            let root = a.block(0x60);
            let drawable = a.block(0xa0);
            a.link(root + 0x30, drawable);
            let skeleton = a.block(0x70);
            a.link(drawable + 0x18, skeleton);
            a.u16(skeleton + 0x5e, bones.len() as u16);
            let block = a.block(bones.len() * BONE_RECORD);
            a.link(skeleton + 0x20, block);
            for (at, bone) in bones.iter().enumerate() {
                a.set(block + at * BONE_RECORD, bone);
            }
            let graph = rg::from_parts(0xA2, 0xA000_0000, 0x2000_0000, a.sys, a.gfx);
            bone_pose(&graph, nav(&graph, graph.root().unwrap(), &[0x30])).unwrap()
        };
        let one = [1.0; 3];
        // Родитель с меньшим номером учитывается, с большим — нет (матрица остаётся локальной).
        let pose = pose_of(&[
            record([1.0, 0.0, 0.0], one, -1),
            record([0.0, 2.0, 0.0], one, 0),
            record([0.0, 0.0, 3.0], one, 1),
        ]);
        assert_eq!(&pose[1][12..15], &[1.0, 2.0, 0.0]);
        assert_eq!(&pose[2][12..15], &[1.0, 2.0, 3.0]);
        let pose = pose_of(&[
            record([1.0, 0.0, 0.0], one, 2),
            record([0.0, 2.0, 0.0], one, 2),
            record([0.0, 0.0, 3.0], one, -1),
        ]);
        assert_eq!(&pose[0][12..15], &[1.0, 0.0, 0.0]);
        assert_eq!(&pose[1][12..15], &[0.0, 2.0, 0.0]);
        let scaled = pose_of(&[record([0.0; 3], [0.0, 2.0, 0.0], -1)]);
        assert_eq!((scaled[0][0], scaled[0][5], scaled[0][10]), (1.0, 2.0, 1.0));
    }
}
