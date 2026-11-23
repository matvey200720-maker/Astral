//! `graft-drawable`: геометрии донора с нужными листами цвета переезжают в модель-приёмник.
//!
//! Копии шейдеров встают в конец списка шейдеров приёмника, их встроенные текстуры
//! дописываются в словарь, геометрии получают новые номера шейдеров, пересчитываются
//! рамки модели и корня и маски корзин. Блоки донора попадают в граф приёмника целиком
//! (`resource_graph::graft`), лишнее убирает `subgraph` при сборке. Размер и хэш выхода
//! определяются порядком дописывания блоков, поэтому порядок стадий `Job::run` — часть
//! контракта.
//!
//! Помощники `shader_blocks`, `records_of`, `bounds_bytes`, `extent`, `read_f32`,
//! `write_f32` и `floats` нужны и соседним командам.

use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
};

use rage_res::{
    drawable::{read_materials, Material},
    hash::joaat,
    meta_graph::deflate_body,
    resource::Resource,
    resource_graph::{self as rg, Address, Graph, Segment, Slot},
    shaders::Role,
    vertex::{self, Layout, BLEND_INDICES, BLEND_WEIGHTS, FLOAT3, POSITION},
};
use serde_json::{Map, Value};

use super::split::{self, address_of, geometry_blocks, high_models, invalid, mapping_of};
use super::split::{pointer_block, pointer_list, texture_name, u16_at, u32_at};
use super::{fresh_dirs::FreshDirs, lamp_mutations::is_same_file, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Название формата запроса.
mod wire {
    pub const REQUEST: &str = "astral.graft-drawable";
    pub const VERSION: u64 = 1;
}

/// Пределы запроса и размеры структур модели, в байтах и штуках.
mod size {
    use std::ops::RangeInclusive;

    pub const MODEL: u64 = 64 * 1024 * 1024;
    pub const NAMES: RangeInclusive<usize> = 1..=32;
    pub const NAME_BYTES: usize = 160;
    pub const OFFSET: f64 = 1000.0;
    pub const EMISSIVE: f64 = 64.0;
    pub const RECORD: usize = 32;
    pub const TEXTURE_OBJECT: usize = 0x90;
    pub const DICTIONARY: usize = 64;
    pub const PARAM: usize = 16;
    pub const PARAM_POINTER: usize = 8;
    pub const POINTER: usize = 8;
}

const EMISSIVE_PARAMETER: &str = "emissivemultiplier";

/// Где в записи рамки лежат минимум и максимум каждой оси; четвёртая ось служебная.
const RECORD_AXES: [(usize, usize); 4] = [(0, 16), (4, 20), (8, 24), (12, 28)];

// ---------------------------------------------------------------------------
// Таблицы смещений и связей между блоками
// ---------------------------------------------------------------------------

/// Смещения полей в блоках рисовалки, по структурам.
mod offset {
    pub mod root {
        pub const GROUP: usize = 0x10;
        pub const SPHERE: usize = 0x20;
        pub const BOX_MIN: usize = 0x30;
        pub const BOX_MAX: usize = 0x40;
        pub const BUCKETS: usize = 0x80;
    }

    pub mod group {
        pub const DICTIONARY: usize = 0x08;
        pub const SHADERS: usize = 0x10;
        pub const SHADER_COUNT: usize = 0x18;
        pub const SHADER_CAPACITY: usize = 0x1a;
    }

    pub mod dictionary {
        pub const ONE: usize = 0x18;
        pub const HASHES: usize = 0x20;
        pub const HASH_COUNT: usize = 0x28;
        pub const TEXTURES: usize = 0x30;
        pub const TEXTURE_COUNT: usize = 0x38;
        /// Четыре счётчика словаря: число и ёмкость списков хешей и текстур.
        pub const COUNTERS: [usize; 4] = [0x28, 0x2a, 0x38, 0x3a];
    }

    pub mod model {
        pub const GEOMETRIES: usize = 0x08;
        pub const BOUNDS: usize = 0x18;
        pub const MAPPING: usize = 0x20;
        pub const MASK: usize = 0x2c;
        /// Три копии числа геометрий.
        pub const COUNTERS: [usize; 3] = [0x10, 0x12, 0x2e];
    }

    pub mod geometry {
        pub const BUFFER: usize = 0x18;
        /// Указатель данных вершин в блоке геометрии: ведёт на те же вершины, что и основной поток буфера.
        pub const DATA: usize = 0x78;
    }

    pub mod buffer {
        pub const COUNT: usize = 0x18;
        pub const DECLARATION: usize = 0x30;
        /// Указатели на потоки вершин: основной и запасной.
        pub const STREAMS: [usize; 2] = [0x10, 0x20];
    }

    pub mod shader {
        pub const PARAMS: usize = 0x00;
        pub const PARAM_COUNT: usize = 0x10;
    }
}

/// Указатель между блоками: где он лежит и что сказать, если его нет.
#[derive(Clone, Copy)]
struct Link {
    at: usize,
    lacking: &'static str,
}

/// Связи, без которых перенос невозможен.
mod link {
    use super::{offset, Link};

    const fn at(at: usize, lacking: &'static str) -> Link {
        Link { at, lacking }
    }

    pub const RECEIVER_GROUP: Link = at(offset::root::GROUP, "у приёмника нет группы шейдеров");
    pub const DONOR_GROUP: Link = at(offset::root::GROUP, "у донора нет группы шейдеров");
    pub const RESULT_GROUP: Link = at(offset::root::GROUP, "в результате нет группы шейдеров");
    pub const RESULT_DICTIONARY: Link = at(offset::group::DICTIONARY, "в результате нет словаря");
    pub const SHADER_LIST: Link = at(offset::group::SHADERS, "у группы нет списка шейдеров");
    pub const HASH_LIST: Link = at(offset::dictionary::HASHES, "у словаря нет списка хешей");
    pub const TEXTURE_LIST: Link = at(offset::dictionary::TEXTURES, "у словаря нет списка текстур");
    pub const MODEL_BOUNDS: Link = at(offset::model::BOUNDS, "у модели нет рамок");
    pub const PARAMS: Link = at(offset::shader::PARAMS, "у шейдера нет параметров");
    pub const VERTEX_BUFFER: Link = at(offset::geometry::BUFFER, "геометрия без буфера вершин");
    pub const DECLARATION: Link = at(offset::buffer::DECLARATION, "буфер вершин без декларации");
}

/// Блок графа с читателем полей: слова и связи по смещению.
#[derive(Clone, Copy)]
struct View<'g> {
    graph: &'g Graph,
    block: usize,
}

impl<'g> View<'g> {
    fn of(graph: &'g Graph, block: usize) -> Self {
        Self { graph, block }
    }

    fn word16(self, at: usize) -> Result<u16> {
        u16_at(self.graph, self.block, at)
    }

    fn word32(self, at: usize) -> Result<u32> {
        u32_at(self.graph, self.block, at)
    }

    fn follow(self, link: Link) -> Result<Self> {
        match pointer_block(self.graph, self.block, link.at) {
            Some(block) => Ok(Self { block, ..self }),
            None => Err(dotted(link.lacking)),
        }
    }
}

/// Блок, на который ведёт связь; нет связи — отказ `dotted`.
fn follow(graph: &Graph, block: usize, link: Link) -> Result<usize> {
    View::of(graph, block).follow(link).map(|view| view.block)
}

/// Блоки, на которые ведут `count` подряд идущих указателей списка.
fn listed<'g>(
    graph: &'g Graph,
    list: usize,
    count: usize,
    lacking: &'static str,
) -> impl Iterator<Item = Result<usize>> + 'g {
    (0..count).map(move |index| {
        follow(
            graph,
            list,
            Link {
                at: index * size::POINTER,
                lacking,
            },
        )
    })
}

// ---------------------------------------------------------------------------
// Отказы и мелкие помощники
// ---------------------------------------------------------------------------

/// Отказ команды: текст получает префикс `graft-drawable: `.
fn plain(message: &str) -> EngineError {
    invalid(format!("graft-drawable: {message}"))
}

/// Отказ проверки указателя: один префикс и одна точка (прежняя проверка писала префикс дважды и две точки).
fn dotted(what: &str) -> EngineError {
    plain(&format!("{what}."))
}

fn byte_at(graph: &Graph, block: usize, relative: usize) -> Result<u8> {
    match graph.content(block).get(relative) {
        Some(&byte) => Ok(byte),
        None => Err(invalid("split-sheet-surfaces: чтение за блоком.")),
    }
}

fn put_u16(graph: &mut Graph, block: usize, relative: usize, value: u16) -> Result<()> {
    Ok(rg::write_at(graph, block, relative, &value.to_le_bytes())?)
}

/// Слова `u16` подряд, младшим байтом вперёд.
fn words16(values: &[u16]) -> Vec<u8> {
    values
        .iter()
        .copied()
        .map(u16::to_le_bytes)
        .collect::<Vec<_>>()
        .concat()
}

/// Слова `u32` подряд, младшим байтом вперёд.
fn words32(values: &[u32]) -> Vec<u8> {
    values
        .iter()
        .copied()
        .map(u32::to_le_bytes)
        .collect::<Vec<_>>()
        .concat()
}

pub(super) fn read_f32(bytes: &[u8], at: usize) -> f32 {
    let word: [u8; 4] = bytes[at..at + 4].try_into().expect("четыре байта");
    f32::from_le_bytes(word)
}

pub(super) fn write_f32(bytes: &mut [u8], at: usize, value: f32) {
    let word: &mut [u8; 4] = (&mut bytes[at..at + 4]).try_into().expect("четыре байта");
    *word = value.to_le_bytes();
}

/// Три числа подряд, по четыре байта: 12 байт.
pub(super) fn floats(values: &[f32; 3]) -> Vec<u8> {
    (*values).map(f32::to_le_bytes).concat()
}

/// Блоки шейдеров группы по порядку её списка.
pub(super) fn shader_blocks(graph: &Graph, group: usize) -> Result<Vec<usize>> {
    let group = View::of(graph, group);
    let (count, list) = (
        usize::from(group.word16(offset::group::SHADER_COUNT)?),
        group.follow(link::SHADER_LIST)?,
    );
    listed(graph, list.block, count, "пустой шейдер в списке").collect()
}

/// Рамки геометрий модели, по записи на геометрию. При нескольких геометриях первая
/// запись блока хранит объединение, и записи геометрий идут со второй.
pub(super) fn records_of(graph: &Graph, model: usize) -> Result<Vec<[u8; 32]>> {
    let view = View::of(graph, model);
    let count = usize::from(view.word16(offset::model::COUNTERS[0])?);
    if count == 0 {
        return Ok(Vec::new());
    }
    let bounds = view.follow(link::MODEL_BOUNDS)?;
    let rows = graph
        .content(bounds.block)
        .chunks_exact(size::RECORD)
        .skip(usize::from(count > 1))
        .take(count)
        .map(|row| <[u8; 32]>::try_from(row).expect("32 байта"))
        .collect::<Vec<_>>();
    match rows.len() < count {
        true => Err(plain("рамки модели короче заявленного.")),
        false => Ok(rows),
    }
}

/// Рамка, расширенная записью: минимум и максимум по всем четырём осям.
fn widen(wide: [u8; 32], record: &[u8; 32]) -> [u8; 32] {
    let mut out = wide;
    for (low, high) in RECORD_AXES {
        write_f32(
            &mut out,
            low,
            read_f32(&wide, low).min(read_f32(record, low)),
        );
        write_f32(
            &mut out,
            high,
            read_f32(&wide, high).max(read_f32(record, high)),
        );
    }
    out
}

/// Блок рамок модели: объединение (только если записей больше одной) и сами записи.
pub(super) fn bounds_bytes(records: &[[u8; 32]]) -> Vec<u8> {
    let union = match records {
        [first, rest @ ..] if !rest.is_empty() => Some(rest.iter().fold(*first, widen)),
        _ => None,
    };
    union.iter().chain(records).flatten().copied().collect()
}

/// Общая рамка записей: минимум по осям x, y, z и максимум по ним.
pub(super) fn extent(records: &[[u8; 32]]) -> ([f32; 3], [f32; 3]) {
    let low = |axis: usize| {
        let at = RECORD_AXES[axis].0;
        records
            .iter()
            .map(|record| read_f32(record, at))
            .fold(f32::MAX, f32::min)
    };
    let high = |axis: usize| {
        let at = RECORD_AXES[axis].1;
        records
            .iter()
            .map(|record| read_f32(record, at))
            .fold(f32::MIN, f32::max)
    };
    (std::array::from_fn(low), std::array::from_fn(high))
}

// ---------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------

struct Request {
    target: PathBuf,
    donor: PathBuf,
    wanted: BTreeSet<String>,
    offset: [f32; 3],
    emissive: Option<f32>,
}

/// Необязательное поле запроса: ключ и отказ, если значение не годится.
struct Field {
    key: &'static str,
    refusal: &'static str,
}

const OFFSET_FIELD: Field = Field {
    key: "offset",
    refusal: "сдвиг — три числа в пределах 1000 м.",
};

const EMISSIVE_FIELD: Field = Field {
    key: "emissive",
    refusal: "свечение — число от 0 до 64.",
};

/// Нет поля или `null` — нет значения; иначе значение обязано разобраться.
fn optional<T>(
    root: &Value,
    field: &Field,
    parse: impl FnOnce(&Value) -> Option<T>,
) -> Result<Option<T>> {
    match root.get(field.key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => parse(value).map(Some).ok_or_else(|| plain(field.refusal)),
    }
}

/// Массив ровно из трёх чисел, каждое из которых принимает `accept`.
fn triple(value: &Value, accept: impl Fn(f64) -> bool) -> Option<[f32; 3]> {
    let Value::Array(items) = value else {
        return None;
    };
    let numbers: Vec<f32> = items
        .iter()
        .map(|item| {
            item.as_f64()
                .filter(|number| accept(*number))
                .map(|number| number as f32)
        })
        .collect::<Option<_>>()?;
    numbers.try_into().ok()
}

fn path_field(root: &Value, key: &str) -> Result<PathBuf> {
    match root.get(key).and_then(Value::as_str) {
        Some(text) => paths::existing_file(text, &[".ydr"]),
        None => Err(plain(&format!("нет поля {key}."))),
    }
}

/// Имя листа: строчные латинские буквы, цифры и `_ . + -`, до 160 байт.
fn sheet_name_ok(name: &str) -> bool {
    let allowed =
        |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_.+-".contains(byte);
    (1..=size::NAME_BYTES).contains(&name.len()) && name.bytes().all(|byte| allowed(&byte))
}

fn wanted_names(root: &Value) -> Result<BTreeSet<String>> {
    let Some(Value::Array(items)) = root.get("diffuse") else {
        return Err(plain("нет списка diffuse."));
    };
    if !size::NAMES.contains(&items.len()) {
        return Err(plain("нужно от 1 до 32 имён текстур."));
    }
    let name_of = |item: &Value| {
        let name = item
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        match sheet_name_ok(&name) {
            true => Ok(name),
            false => Err(plain(&format!("имя текстуры {name} не годится."))),
        }
    };
    items.iter().map(name_of).collect()
}

impl Request {
    fn load(path: &Path) -> Result<Self> {
        let root: Value = serde_json::from_str(&fs::read_to_string(path)?)
            .map_err(|_| plain("запрос не читается."))?;
        let known = root.get("format").and_then(Value::as_str) == Some(wire::REQUEST)
            && root.get("version").and_then(Value::as_u64) == Some(wire::VERSION);
        if !known {
            return Err(plain("неизвестный формат запроса."));
        }
        let target = path_field(&root, "target")?;
        let donor = path_field(&root, "donor")?;
        let wanted = wanted_names(&root)?;
        let offset = optional(&root, &OFFSET_FIELD, |value| {
            triple(value, |number| {
                number.is_finite() && number.abs() <= size::OFFSET
            })
        })?
        .unwrap_or([0.0; 3]);
        let emissive = optional(&root, &EMISSIVE_FIELD, |value| match value {
            Value::Number(number) => number
                .as_f64()
                .filter(|glow| (0.0..=size::EMISSIVE).contains(glow))
                .map(|glow| glow as f32),
            _ => None,
        })?;
        Ok(Self {
            target,
            donor,
            wanted,
            offset,
            emissive,
        })
    }

    /// Сдвиг, если он не нулевой (`-0.0` тоже ноль).
    fn shift(&self) -> Option<[f32; 3]> {
        self.offset
            .iter()
            .any(|value| *value != 0.0)
            .then_some(self.offset)
    }
}

/// Модель целиком: размер от 1 байта до 64 МиБ, затем разбор ресурса.
fn read_model(path: &Path) -> Result<Resource> {
    match fs::metadata(path)?.len() {
        0 => Err(plain("модель пустая или больше 64 МБ.")),
        size if size > size::MODEL => Err(plain("модель пустая или больше 64 МБ.")),
        _ => Ok(Resource::parse(&fs::read(path)?)?),
    }
}

// ---------------------------------------------------------------------------
// Чтение моделей
// ---------------------------------------------------------------------------

/// Раскладка вершин буфера по его декларации: флаги `u32` и типы `u64` в первых 16 байтах.
fn declared_layout(graph: &Graph, buffer: usize) -> Result<Layout> {
    let declaration = follow(graph, buffer, link::DECLARATION)?;
    let Some(Ok(head)) = graph
        .content(declaration)
        .get(..16)
        .map(<[u8; 16]>::try_from)
    else {
        return Err(plain("декларация вершин короче заявленного."));
    };
    let flags = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let types = u64::from_le_bytes(head[8..].try_into().expect("восемь байт"));
    vertex::layout(flags, types).map_err(|error| plain(&error.message))
}

/// Скин: у какой-нибудь геометрии модели в раскладке есть веса или индексы костей.
fn is_skinned(graph: &Graph, model: usize) -> Result<bool> {
    geometry_blocks(graph, model)?
        .into_iter()
        .try_fold(false, |skinned, geometry| {
            if skinned {
                return Ok(true);
            }
            let buffer = follow(graph, geometry, link::VERTEX_BUFFER)?;
            let layout = declared_layout(graph, buffer)?;
            Ok([BLEND_WEIGHTS, BLEND_INDICES]
                .iter()
                .any(|&semantic| layout.get(semantic).is_some()))
        })
}

fn count_geometries(graph: &Graph, models: &[usize]) -> Result<usize> {
    models
        .iter()
        .map(|&model| geometry_blocks(graph, model).map(|list| list.len()))
        .sum()
}

/// Текстуры словаря: имя в нижнем регистре и адрес объекта, по порядку списка.
fn dictionary_textures(graph: &Graph, dictionary: usize) -> Result<Vec<(String, Address)>> {
    let view = View::of(graph, dictionary);
    let (count, list) = (
        usize::from(view.word16(offset::dictionary::TEXTURE_COUNT)?),
        view.follow(link::TEXTURE_LIST)?,
    );
    let named = |object: usize| -> Result<(String, Address)> {
        let name = texture_name(graph, object)?.to_lowercase();
        Ok((name, address_of(graph, object)))
    };
    listed(graph, list.block, count, "пустая запись словаря")
        .map(|entry| entry.and_then(named))
        .collect()
}

/// Словарь приёмника: что в нём лежит (хеш, объект), по имени и что дописано в этом запросе.
struct ReceiverDictionary {
    block: Option<usize>,
    present: Vec<(u32, Address)>,
    by_name: HashMap<String, Address>,
    added: Vec<(String, Address)>,
}

impl ReceiverDictionary {
    fn empty() -> Self {
        Self {
            block: None,
            present: Vec::new(),
            by_name: HashMap::new(),
            added: Vec::new(),
        }
    }

    fn read(graph: &Graph, group: usize) -> Result<Self> {
        let Some(block) = pointer_block(graph, group, offset::group::DICTIONARY) else {
            return Ok(Self::empty());
        };
        let view = View::of(graph, block);
        let (hashes_n, textures_n) = (
            view.word16(offset::dictionary::HASH_COUNT)?,
            view.word16(offset::dictionary::TEXTURE_COUNT)?,
        );
        if hashes_n != textures_n {
            return Err(plain("у словаря списки хешей и текстур разной длины."));
        }
        let hashes = view.follow(link::HASH_LIST)?;
        let textures = dictionary_textures(graph, block)?;
        let present = textures
            .iter()
            .enumerate()
            .map(|(index, (_, object))| Ok((hashes.word32(index * 4)?, *object)))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            block: Some(block),
            present,
            by_name: textures.into_iter().collect(),
            added: Vec::new(),
        })
    }

    /// Объект словаря, на который должен указывать параметр с этой текстурой, если он есть;
    /// текстуры донора при первом появлении записываются в хвост.
    fn resolve(&mut self, name: &str, donor: &HashMap<String, Address>) -> Option<Address> {
        let object = match self.by_name.get(name) {
            Some(&known) => return Some(known),
            None => *donor.get(name)?,
        };
        self.by_name.insert(name.to_owned(), object);
        self.added.push((name.to_owned(), object));
        Some(object)
    }

    fn added_names(&self) -> Vec<String> {
        self.added.iter().map(|(name, _)| name.clone()).collect()
    }
}

/// Приёмник: первая модель высокой детализации и всё, что нужно для переноса.
struct Receiver {
    root: usize,
    main: usize,
    models: Vec<usize>,
    group: usize,
    shaders: Vec<usize>,
    dictionary: ReceiverDictionary,
}

impl Receiver {
    /// Главная модель: первая высокой детализации, без скина.
    fn main_model(graph: &Graph, models: &[usize]) -> Result<usize> {
        match models {
            [] => Err(plain("у приёмника нет высокой детализации.")),
            [main, ..] if is_skinned(graph, *main)? => {
                Err(plain("приёмник со скином не принимает части."))
            }
            [main, ..] => Ok(*main),
        }
    }

    fn inspect(graph: &Graph, root: usize) -> Result<Self> {
        let models = high_models(graph, root)?;
        let main = Self::main_model(graph, &models)?;
        let group = follow(graph, root, link::RECEIVER_GROUP)?;
        let shaders = shader_blocks(graph, group)?;
        let dictionary = ReceiverDictionary::read(graph, group)?;
        Ok(Self {
            root,
            main,
            models,
            group,
            shaders,
            dictionary,
        })
    }
}

/// Шейдер донора, у которого нашлась подходящая геометрия.
struct DonorShader {
    number: usize,
    block: usize,
    bucket: u8,
}

/// Подходящая геометрия донора с её рамкой и номером шейдера в списке донора.
struct Pick {
    geometry: usize,
    shader: usize,
    record: [u8; 32],
}

struct Selection {
    picks: Vec<Pick>,
    shaders: Vec<DonorShader>,
}

impl Selection {
    /// Маска корзин всех скопированных шейдеров; корзины выше седьмой делят последний бит.
    fn buckets(&self) -> u8 {
        self.shaders
            .iter()
            .map(|shader| 1u8 << shader.bucket.min(7))
            .fold(0, |mask, bit| mask | bit)
    }

    /// Место копии шейдера донора с этим номером среди копий.
    fn copy_position(&self, number: usize) -> usize {
        self.shaders
            .iter()
            .position(|shader| shader.number == number)
            .expect("шейдер геометрии скопирован")
    }

    /// Геометрия принята; её шейдер попадает в список копий при первом появлении.
    fn accept(&mut self, pick: Pick, shader: DonorShader) {
        if self
            .shaders
            .iter()
            .all(|known| known.number != shader.number)
        {
            self.shaders.push(shader);
        }
        self.picks.push(pick);
    }
}

/// Диффузный лист шейдера донора, если материал есть и его лист нужен.
fn wanted_material<'m>(
    materials: &'m [Option<Material>],
    number: usize,
    wanted: &BTreeSet<String>,
) -> Option<&'m Material> {
    let material = materials.get(number)?.as_ref()?;
    let sheet = material.textures.get(&Role::Diffuse)?;
    wanted.contains(&sheet.to_lowercase()).then_some(material)
}

/// Подходящие геометрии одной модели донора с шейдерами, которые к ним относятся.
fn model_picks(
    graph: &Graph,
    model: usize,
    shaders: &[usize],
    materials: &[Option<Material>],
    wanted: &BTreeSet<String>,
) -> Result<Vec<(Pick, DonorShader)>> {
    let geometries = geometry_blocks(graph, model)?;
    let mapping = match mapping_of(graph, model)? {
        Some(mapping) => mapping,
        None => return Err(plain("у модели донора нет шейдеров.")),
    };
    let records = records_of(graph, model)?;
    let mut found = Vec::new();
    for (index, &geometry) in geometries.iter().enumerate() {
        let number = mapping.get(index).copied().map_or(0, usize::from);
        let Some(material) = wanted_material(materials, number, wanted) else {
            continue;
        };
        let Some(&block) = shaders.get(number) else {
            continue;
        };
        let Some(&record) = records.get(index) else {
            return Err(plain("рамки донора короче геометрий."));
        };
        let shader = DonorShader {
            number,
            block,
            bucket: material.render_bucket,
        };
        found.push((
            Pick {
                geometry,
                shader: number,
                record,
            },
            shader,
        ));
    }
    Ok(found)
}

/// Геометрии донора, чей шейдер берёт диффузный лист из `wanted`.
fn select_donor_geometries(
    graph: &Graph,
    donor_root: usize,
    materials: &[Option<Material>],
    wanted: &BTreeSet<String>,
) -> Result<Selection> {
    let group = follow(graph, donor_root, link::DONOR_GROUP)?;
    let donor_shaders = shader_blocks(graph, group)?;
    let mut selection = Selection {
        picks: Vec::new(),
        shaders: Vec::new(),
    };
    for model in high_models(graph, donor_root)? {
        if is_skinned(graph, model)? {
            continue;
        }
        for (pick, shader) in model_picks(graph, model, &donor_shaders, materials, wanted)? {
            selection.accept(pick, shader);
        }
    }
    match selection.picks.len() {
        0 => Err(plain("у донора нет геометрии с этими текстурами.")),
        _ => Ok(selection),
    }
}

/// Текстуры словаря донора (если он есть): имя в нижнем регистре и объект.
fn donor_dictionary(graph: &Graph, donor_root: usize) -> Result<HashMap<String, Address>> {
    let group = follow(graph, donor_root, link::DONOR_GROUP)?;
    match pointer_block(graph, group, offset::group::DICTIONARY) {
        Some(dictionary) => Ok(dictionary_textures(graph, dictionary)?
            .into_iter()
            .collect()),
        None => Ok(HashMap::new()),
    }
}

// ---------------------------------------------------------------------------
// Параметры шейдера
// ---------------------------------------------------------------------------

/// Вид параметра шейдера: первый байт его записи.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Texture,
    Vector,
    Array(u8),
}

impl Kind {
    fn of(byte: u8) -> Self {
        match byte {
            0 => Kind::Texture,
            1 => Kind::Vector,
            other => Kind::Array(other),
        }
    }

    /// Сколько векторов данных лежит после записей за параметром этого вида.
    fn vectors(self) -> usize {
        match self {
            Kind::Texture => 0,
            Kind::Vector => 1,
            Kind::Array(count) => usize::from(count),
        }
    }
}

/// Копия блока параметров вместе с данными векторов и таблицей хешей имён.
struct Params {
    bytes: Vec<u8>,
    slots: Vec<Slot>,
    kinds: Vec<Kind>,
    hashes_at: usize,
}

impl Params {
    fn hash(&self, index: usize) -> u32 {
        let at = self.hashes_at + index * 4;
        u32::from_le_bytes(self.bytes[at..at + 4].try_into().expect("четыре байта"))
    }

    /// Место указателя параметра среди указателей копии.
    fn pointer_slot(&self, index: usize) -> Option<usize> {
        let relative = index * size::PARAM + size::PARAM_POINTER;
        self.slots.iter().position(|slot| slot.relative == relative)
    }

    fn indices_of(&self, kind: Kind) -> Vec<usize> {
        (0..self.kinds.len())
            .filter(|&index| self.kinds[index] == kind)
            .collect()
    }
}

/// Блок параметров шейдера и его копия с указателями.
fn read_params(graph: &Graph, shader: usize) -> Result<(usize, Params)> {
    let block = follow(graph, shader, link::PARAMS)?;
    let count = usize::from(byte_at(graph, shader, offset::shader::PARAM_COUNT)?);
    let (records, _) = split::copy_span(graph, block, count * size::PARAM)?;
    let kinds: Vec<Kind> = records
        .chunks_exact(size::PARAM)
        .map(|record| Kind::of(record[0]))
        .collect();
    let vectors: usize = kinds.iter().map(|kind| kind.vectors()).sum();
    let hashes_at = count * size::PARAM + vectors * size::PARAM;
    let (bytes, slots) = split::copy_span(graph, block, hashes_at + 4 * count)?;
    Ok((
        block,
        Params {
            bytes,
            slots,
            kinds,
            hashes_at,
        },
    ))
}

/// Объект текстуры «целый»: блок начинается там, куда ведёт указатель, и не короче 0x90.
fn is_whole_object(graph: &Graph, object: usize, target: Address) -> bool {
    graph.blocks[object].start == target.offset
        && graph.content(object).len() >= size::TEXTURE_OBJECT
}

/// Отдельная копия объекта текстуры на 0x90 байт (лишнее нулями) вместе с его указателями.
fn copy_texture_object(graph: &mut Graph, object: usize, target: Address) -> Address {
    let block = graph.blocks[object].clone();
    let skip = target.offset.saturating_sub(block.start);
    let content = graph.content(object);
    let mut bytes = vec![0u8; size::TEXTURE_OBJECT];
    content
        .iter()
        .skip(skip)
        .take(size::TEXTURE_OBJECT)
        .zip(bytes.iter_mut())
        .for_each(|(from, to)| *to = *from);
    let inside =
        |slot: &&Slot| slot.relative >= skip && slot.relative - skip + 8 <= size::TEXTURE_OBJECT;
    let slots = block
        .slots
        .iter()
        .filter(inside)
        .map(|slot| Slot {
            relative: slot.relative - skip,
            ..*slot
        })
        .collect();
    let fresh = rg::append_block(graph, block.segment, bytes, slots);
    address_of(graph, fresh)
}

/// Сдвиг позиций вершин потока: `vertices` вершин с шагом `stride`, позиция — три числа в начале.
fn shift_positions(bytes: &mut [u8], stride: usize, vertices: usize, delta: [f32; 3]) {
    let whole = bytes
        .len()
        .checked_div(stride)
        .map_or(0, |fit| vertices.min(fit));
    let spots = (0..whole).flat_map(|vertex| {
        delta
            .into_iter()
            .enumerate()
            .map(move |(axis, step)| (vertex * stride + axis * 4, step))
    });
    for (at, step) in spots {
        if at + 4 <= bytes.len() {
            let moved = read_f32(bytes, at) + step;
            write_f32(bytes, at, moved);
        }
    }
}

/// Запись рамки донора, сдвинутая на `delta` (четвёртые числа не меняются).
fn shifted_record(record: &[u8; 32], delta: [f32; 3]) -> [u8; 32] {
    let mut out = *record;
    for ((low, high), step) in RECORD_AXES.into_iter().zip(delta) {
        write_f32(&mut out, low, read_f32(record, low) + step);
        write_f32(&mut out, high, read_f32(record, high) + step);
    }
    out
}

// ---------------------------------------------------------------------------
// Работа над графом
// ---------------------------------------------------------------------------

/// Геометрии, которые добавляются к главной модели приёмника.
struct Grown {
    blocks: Vec<usize>,
    numbers: Vec<u16>,
    records: Vec<[u8; 32]>,
}

/// Итог переноса для ответа команды.
struct Report {
    bytes: Vec<u8>,
    grafted: usize,
    shaders: usize,
    textures: Vec<String>,
    geometries: usize,
    flags_high: u8,
    bounds: ([f32; 3], [f32; 3]),
}

/// Состояние переноса: граф приёмника с донором и то, что выяснено о них до стадий.
struct Job<'a> {
    request: &'a Request,
    graph: Graph,
    target_root: usize,
    donor_root: usize,
    before: usize,
    materials: Vec<Option<Material>>,
}

impl<'a> Job<'a> {
    /// Читает обе модели, считает геометрии приёмника «до» и вшивает донора в его граф.
    fn start(request: &'a Request) -> Result<Self> {
        let target_file = read_model(&request.target)?;
        let donor_file = read_model(&request.donor)?;
        let (target, donor) = (rg::scan(&target_file)?, rg::scan(&donor_file)?);
        let Some(target_root) = target.root() else {
            return Err(plain("у приёмника нет корня."));
        };
        let before = count_geometries(&target, &high_models(&target, target_root)?)?;
        let materials = read_materials(&donor_file, 0)?.1;
        let (graph, donor_at) = rg::graft(&target, &donor)?;
        let Some(donor_root) = graph.block_at(donor_at) else {
            return Err(plain("корень донора вне блоков."));
        };
        Ok(Self {
            request,
            graph,
            target_root,
            donor_root,
            before,
            materials,
        })
    }

    /// Стадии в порядке дописывания блоков: словарь, копии шейдеров, списки словаря и шейдеров,
    /// геометрии, модель, корень.
    fn run(mut self) -> Result<Report> {
        let mut receiver = Receiver::inspect(&self.graph, self.target_root)?;
        let donor_textures = donor_dictionary(&self.graph, self.donor_root)?;
        let selection = select_donor_geometries(
            &self.graph,
            self.donor_root,
            &self.materials,
            &self.request.wanted,
        )?;

        self.ensure_dictionary(&mut receiver);
        let copies = self.copy_shaders(&selection, &mut receiver.dictionary, &donor_textures)?;
        self.merge_textures(&receiver)?;
        self.extend_shader_list(&receiver, &copies)?;
        let grown = self.graft_geometries(&selection, receiver.shaders.len())?;
        let mask = selection.buckets();
        let main_records = self.extend_main_model(&receiver, &grown, mask)?;
        let (min, max, flags_high) = self.refresh_root(&receiver, &main_records, mask)?;

        let bytes = self.assemble()?;
        let textures = receiver.dictionary.added_names();
        let geometries = self.before + selection.picks.len();
        reopen(&bytes, geometries, &textures, mask)?;
        Ok(Report {
            bytes,
            grafted: selection.picks.len(),
            shaders: selection.shaders.len(),
            textures,
            geometries,
            flags_high,
            bounds: (min, max),
        })
    }

    /// У приёмника без словаря текстур он создаётся: списки хешей и текстур по 8 нулевых байт
    /// и блок словаря в 64 байта с единицей в слове +0x18.
    fn ensure_dictionary(&mut self, receiver: &mut Receiver) {
        if receiver.dictionary.block.is_some() {
            return;
        }
        let parts = [offset::dictionary::HASHES, offset::dictionary::TEXTURES].map(|relative| {
            (
                relative,
                rg::append_block(&mut self.graph, Segment::System, vec![0u8; 8], Vec::new()),
            )
        });
        let slots = parts
            .map(|(relative, block)| Slot {
                relative,
                target: address_of(&self.graph, block),
            })
            .to_vec();
        let mut bytes = vec![0u8; size::DICTIONARY];
        bytes[offset::dictionary::ONE..][..4].copy_from_slice(&1u32.to_le_bytes());
        let dictionary = rg::append_block(&mut self.graph, Segment::System, bytes, slots);
        let target = address_of(&self.graph, dictionary);
        let group_slots = &mut self.graph.blocks[receiver.group].slots;
        group_slots.push(Slot {
            relative: offset::group::DICTIONARY,
            target,
        });
        group_slots.sort_by_key(|slot| slot.relative);
        receiver.dictionary.block = Some(dictionary);
    }

    /// Копии шейдеров донора в порядке первого появления.
    fn copy_shaders(
        &mut self,
        selection: &Selection,
        dictionary: &mut ReceiverDictionary,
        donor_textures: &HashMap<String, Address>,
    ) -> Result<Vec<usize>> {
        selection
            .shaders
            .iter()
            .map(|shader| self.copy_shader(shader.block, dictionary, donor_textures))
            .collect()
    }

    /// Копия шейдера: данные свечения и объекты текстур, блок параметров, блок шейдера.
    fn copy_shader(
        &mut self,
        shader: usize,
        dictionary: &mut ReceiverDictionary,
        donor_textures: &HashMap<String, Address>,
    ) -> Result<usize> {
        let (params_block, mut params) = read_params(&self.graph, shader)?;
        if let Some(value) = self.request.emissive {
            self.glow(&mut params, value)?;
        }
        self.settle_textures(&mut params, dictionary, donor_textures)?;

        let segment = self.graph.blocks[params_block].segment;
        let fresh = rg::append_block(&mut self.graph, segment, params.bytes, params.slots);
        let target = address_of(&self.graph, fresh);
        let source = self.graph.blocks[shader].clone();
        let slots = source
            .slots
            .iter()
            .map(|slot| match slot.relative == offset::shader::PARAMS {
                true => Slot { target, ..*slot },
                false => *slot,
            })
            .collect();
        let content = self.graph.content(shader).to_vec();
        Ok(rg::append_block(
            &mut self.graph,
            source.segment,
            content,
            slots,
        ))
    }

    /// Свечение: у каждого вектора `emissiveMultiplier` данные копируются с новым `x`.
    fn glow(&mut self, params: &mut Params, value: f32) -> Result<()> {
        let wanted = joaat(EMISSIVE_PARAMETER);
        let glowing: Vec<usize> = params
            .indices_of(Kind::Vector)
            .into_iter()
            .filter(|&index| params.hash(index) == wanted)
            .collect();
        for index in glowing {
            let position = params
                .pointer_slot(index)
                .ok_or_else(|| plain("данные свечения вне блоков."))?;
            let source = self
                .graph
                .block_at(params.slots[position].target)
                .ok_or_else(|| plain("данные свечения вне блоков."))?;
            let mut vector = self
                .graph
                .content(source)
                .get(..size::PARAM)
                .ok_or_else(|| plain("данные свечения короче вектора."))?
                .to_vec();
            write_f32(&mut vector, 0, value);
            let segment = self.graph.blocks[source].segment;
            let fresh = rg::append_block(&mut self.graph, segment, vector, Vec::new());
            params.slots[position].target = address_of(&self.graph, fresh);
        }
        Ok(())
    }

    /// Текстурные параметры: объект словаря приёмника, объект словаря донора или заглушка.
    fn settle_textures(
        &mut self,
        params: &mut Params,
        dictionary: &mut ReceiverDictionary,
        donor_textures: &HashMap<String, Address>,
    ) -> Result<()> {
        for index in params.indices_of(Kind::Texture) {
            let lacking = || plain("текстура параметра вне блоков.");
            let Some(position) = params.pointer_slot(index) else {
                return Err(lacking());
            };
            let target = params.slots[position].target;
            let Some(object) = self.graph.block_at(target) else {
                return Err(lacking());
            };
            let name = texture_name(&self.graph, object)?.to_lowercase();
            params.slots[position].target = match dictionary.resolve(&name, donor_textures) {
                Some(known) => known,
                None if is_whole_object(&self.graph, object, target) => target,
                None => copy_texture_object(&mut self.graph, object, target),
            };
        }
        Ok(())
    }

    /// Дописанные текстуры уходят в словарь: списки указателей и хешей по возрастанию хеша.
    fn merge_textures(&mut self, receiver: &Receiver) -> Result<()> {
        let state = &receiver.dictionary;
        if state.added.is_empty() {
            return Ok(());
        }
        let dictionary = state.block.expect("словарь есть");
        let mut entries: Vec<(u32, Address)> = state.present.clone();
        entries.extend(
            state
                .added
                .iter()
                .map(|(name, object)| (joaat(name), *object)),
        );
        entries.sort_by_key(|entry| entry.0);

        let slots = entries
            .iter()
            .enumerate()
            .map(|(index, entry)| Slot {
                relative: index * size::POINTER,
                target: entry.1,
            })
            .collect();
        let list_bytes = vec![0u8; entries.len() * size::POINTER];
        let list = rg::append_block(&mut self.graph, Segment::System, list_bytes, slots);
        let hashes: Vec<u32> = entries.iter().map(|entry| entry.0).collect();
        let hashes = rg::append_block(
            &mut self.graph,
            Segment::System,
            words32(&hashes),
            Vec::new(),
        );
        let (list, hashes) = (
            address_of(&self.graph, list),
            address_of(&self.graph, hashes),
        );
        rg::retarget(
            &mut self.graph,
            dictionary,
            offset::dictionary::HASHES,
            hashes,
        )?;
        rg::retarget(
            &mut self.graph,
            dictionary,
            offset::dictionary::TEXTURES,
            list,
        )?;
        let total = entries.len() as u16;
        offset::dictionary::COUNTERS
            .iter()
            .try_for_each(|&at| put_u16(&mut self.graph, dictionary, at, total))
    }

    /// Новый список шейдеров группы: прежние блоки и копии.
    fn extend_shader_list(&mut self, receiver: &Receiver, copies: &[usize]) -> Result<()> {
        let blocks: Vec<usize> = receiver.shaders.iter().chain(copies).copied().collect();
        let (bytes, slots) = pointer_list(&self.graph, &blocks);
        let list = rg::append_block(&mut self.graph, Segment::System, bytes, slots);
        let address = address_of(&self.graph, list);
        rg::retarget(
            &mut self.graph,
            receiver.group,
            offset::group::SHADERS,
            address,
        )?;
        put_u16(
            &mut self.graph,
            receiver.group,
            offset::group::SHADER_COUNT,
            blocks.len() as u16,
        )?;
        // ёмкость списка равна числу, как у игры и у хоста (прежняя ёмкость приёмника оставалась меньше числа)
        put_u16(
            &mut self.graph,
            receiver.group,
            offset::group::SHADER_CAPACITY,
            blocks.len() as u16,
        )
    }

    /// Геометрии донора для главной модели: с нулевым сдвигом — те же блоки, иначе копии.
    fn graft_geometries(&mut self, selection: &Selection, old_shaders: usize) -> Result<Grown> {
        let shift = self.request.shift();
        let mut grown = Grown {
            blocks: Vec::new(),
            numbers: Vec::new(),
            records: Vec::new(),
        };
        for pick in &selection.picks {
            let (block, record) = match shift {
                Some(delta) => (
                    self.shifted_geometry(pick.geometry, delta)?,
                    shifted_record(&pick.record, delta),
                ),
                None => (pick.geometry, pick.record),
            };
            grown.blocks.push(block);
            grown
                .numbers
                .push((old_shaders + selection.copy_position(pick.shader)) as u16);
            grown.records.push(record);
        }
        Ok(grown)
    }

    /// Копия геометрии со сдвигом вершин: потоки, буфер вершин, блок геометрии.
    fn shifted_geometry(&mut self, geometry: usize, delta: [f32; 3]) -> Result<usize> {
        let buffer = follow(&self.graph, geometry, link::VERTEX_BUFFER)?;
        let layout = declared_layout(&self.graph, buffer)?;
        let position = layout.get(POSITION);
        let starts_with_position =
            matches!(position, Some(element) if element.offset == 0 && element.type_code == FLOAT3);
        if !starts_with_position {
            return Err(plain("вершины донора не начинаются с позиции float3."));
        }
        let stride = split::vertex_stride(&self.graph, buffer)?;
        let vertices = View::of(&self.graph, buffer).word32(offset::buffer::COUNT)? as usize;

        // Потоки в порядке указателей; один блок, на который указывают оба, сдвигается один раз.
        let streams = offset::buffer::STREAMS
            .iter()
            .filter_map(|&relative| {
                rg::pointer_from(&self.graph, buffer, relative).map(|address| (relative, address))
            })
            .map(|(relative, address)| {
                self.graph
                    .block_at(address)
                    .map(|block| (relative, block))
                    .ok_or_else(|| plain("поток вершин вне блоков."))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut moved: Vec<(usize, usize)> = Vec::new();
        let mut retargets: Vec<(usize, Address)> = Vec::new();
        for (relative, block) in streams {
            let copy = match moved.iter().find(|(source, _)| *source == block) {
                Some(&(_, copy)) => copy,
                None => {
                    let source = self.graph.blocks[block].clone();
                    let mut bytes = self.graph.content(block).to_vec();
                    shift_positions(&mut bytes, stride, vertices, delta);
                    let copy =
                        rg::append_block(&mut self.graph, source.segment, bytes, source.slots);
                    moved.push((block, copy));
                    copy
                }
            };
            retargets.push((relative, address_of(&self.graph, copy)));
        }

        let buffer_source = self.graph.blocks[buffer].clone();
        let buffer_slots = buffer_source
            .slots
            .iter()
            .map(|slot| {
                match retargets
                    .iter()
                    .find(|(relative, _)| *relative == slot.relative)
                {
                    Some(&(_, target)) => Slot { target, ..*slot },
                    None => *slot,
                }
            })
            .collect();
        let content = self.graph.content(buffer).to_vec();
        let fresh_buffer = rg::append_block(
            &mut self.graph,
            buffer_source.segment,
            content,
            buffer_slots,
        );
        let buffer_at = address_of(&self.graph, fresh_buffer);

        // данные вершин самой геометрии — копия основного потока, как у буфера (прежний указатель вёл на несдвинутые вершины донора)
        let data_at = retargets
            .iter()
            .find(|(relative, _)| *relative == offset::buffer::STREAMS[0])
            .map(|&(_, address)| address);
        let source = self.graph.blocks[geometry].clone();
        let slots = source
            .slots
            .iter()
            .map(|slot| match (slot.relative, data_at) {
                (offset::geometry::BUFFER, _) => Slot {
                    target: buffer_at,
                    ..*slot
                },
                (offset::geometry::DATA, Some(target)) => Slot { target, ..*slot },
                _ => *slot,
            })
            .collect();
        let content = self.graph.content(geometry).to_vec();
        Ok(rg::append_block(
            &mut self.graph,
            source.segment,
            content,
            slots,
        ))
    }

    /// К главной модели добавляются геометрии, номера шейдеров и рамки; возвращает все её записи рамок.
    fn extend_main_model(
        &mut self,
        receiver: &Receiver,
        grown: &Grown,
        mask: u8,
    ) -> Result<Vec<[u8; 32]>> {
        let main = receiver.main;
        let mut blocks = geometry_blocks(&self.graph, main)?;
        let mut records = records_of(&self.graph, main)?;
        let mut numbers = mapping_of(&self.graph, main)?
            .ok_or_else(|| plain("у модели приёмника нет шейдеров."))?;
        blocks.extend_from_slice(&grown.blocks);
        numbers.extend_from_slice(&grown.numbers);
        records.extend_from_slice(&grown.records);

        let (bytes, slots) = pointer_list(&self.graph, &blocks);
        let list = rg::append_block(&mut self.graph, Segment::System, bytes, slots);
        let mapping = rg::append_block(
            &mut self.graph,
            Segment::System,
            words16(&numbers),
            Vec::new(),
        );
        let old_bounds = pointer_block(&self.graph, main, offset::model::BOUNDS)
            .ok_or_else(|| plain("у модели приёмника нет рамок."))?;
        let bounds_segment = self.graph.blocks[old_bounds].segment;
        let bounds = rg::append_block(
            &mut self.graph,
            bounds_segment,
            bounds_bytes(&records),
            Vec::new(),
        );

        let total = blocks.len() as u16;
        let old_mask = u16_at(&self.graph, main, offset::model::MASK)?;
        for (relative, block) in [
            (offset::model::GEOMETRIES, list),
            (offset::model::MAPPING, mapping),
            (offset::model::BOUNDS, bounds),
        ] {
            let address = address_of(&self.graph, block);
            rg::retarget(&mut self.graph, main, relative, address)?;
        }
        offset::model::COUNTERS
            .iter()
            .try_for_each(|&at| put_u16(&mut self.graph, main, at, total))?;
        put_u16(
            &mut self.graph,
            main,
            offset::model::MASK,
            old_mask | u16::from(mask),
        )?;
        Ok(records)
    }

    /// Корень: маска корзин и рамка по записям всех геометрий всех моделей высокой детализации.
    fn refresh_root(
        &mut self,
        receiver: &Receiver,
        main_records: &[[u8; 32]],
        mask: u8,
    ) -> Result<([f32; 3], [f32; 3], u8)> {
        let root = receiver.root;
        let old_word = View::of(&self.graph, root).word32(offset::root::BUCKETS)?;
        let low = (old_word as u8) | mask;
        let word = (old_word & !0xff) | u32::from(low);
        rg::write_at(
            &mut self.graph,
            root,
            offset::root::BUCKETS,
            &word.to_le_bytes(),
        )?;

        let mut records: Vec<[u8; 32]> = Vec::new();
        for &model in &receiver.models {
            match model == receiver.main {
                true => records.extend_from_slice(main_records),
                false => records.extend(records_of(&self.graph, model)?),
            }
        }
        let (min, max) = extent(&records);
        let centre: [f32; 3] = std::array::from_fn(|axis| (min[axis] + max[axis]) * 0.5);
        let span: [f32; 3] = std::array::from_fn(|axis| max[axis] - min[axis]);
        let radius = span.iter().map(|side| side * side).sum::<f32>().sqrt() * 0.5;
        let mut sphere = floats(&centre);
        sphere.extend_from_slice(&radius.to_le_bytes());
        for (at, bytes) in [
            (offset::root::SPHERE, sphere),
            (offset::root::BOX_MIN, floats(&min)),
            (offset::root::BOX_MAX, floats(&max)),
        ] {
            rg::write_at(&mut self.graph, root, at, &bytes)?;
        }
        Ok((min, max, low))
    }

    /// Плотная сборка: достижимые от корня блоки в порядке графа, тело сжато `deflate_body`.
    fn assemble(&self) -> Result<Vec<u8>> {
        let root = address_of(&self.graph, self.target_root);
        let compact = rg::subgraph(&self.graph, root)?;
        let system = rg::identity_order(&compact, Segment::System);
        let graphics = rg::identity_order(&compact, Segment::Graphics);
        Ok(rg::rebuild_with(
            &compact,
            &system,
            &graphics,
            &deflate_body,
        )?)
    }
}

/// Результат читается заново: геометрии, группа, словарь, добавленные листы и маска корзин.
fn reopen(bytes: &[u8], geometries: usize, added: &[String], mask: u8) -> Result<()> {
    let graph = rg::scan(&Resource::parse(bytes)?)?;
    let root = graph
        .root()
        .ok_or_else(|| plain("в результате нет корня."))?;
    if count_geometries(&graph, &high_models(&graph, root)?)? != geometries {
        return Err(plain("после записи число геометрий другое."));
    }
    let group = follow(&graph, root, link::RESULT_GROUP)?;
    let dictionary = follow(&graph, group, link::RESULT_DICTIONARY)?;
    let names: BTreeSet<String> = dictionary_textures(&graph, dictionary)?
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    if !added.iter().all(|name| names.contains(name)) {
        return Err(plain("текстура донора не попала в словарь."));
    }
    let low = View::of(&graph, root).word32(offset::root::BUCKETS)? as u8;
    match low & mask == mask {
        true => Ok(()),
        false => Err(plain("маска корзин не записалась в корень.")),
    }
}

pub const COMMANDS: &[Command] = &[Command::new("graft-drawable", graft_drawable)];

/// Ответ как пары «ключ, значение» в порядке записи.
fn table<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<_, _>>(),
    )
}

fn graft_drawable(options: &Options, _: &Progress) -> Result<Value> {
    let request_file = options
        .required("input")
        .and_then(|text| paths::existing_file(text, &[".json"]))?;
    let request = Request::load(&request_file)?;
    let fresh = FreshDirs::beside(options.required("output"));
    let output = options
        .required("output")
        .and_then(|text| paths::output_file(text, &[".ydr"]))?;
    let report = Job::start(&request).and_then(Job::run)?;
    // Раньше результат поверх приёмника или донора молча заменял исходную модель (в том числе под другим написанием пути).
    if [&request.target, &request.donor]
        .iter()
        .any(|input| is_same_file(input, &output))
    {
        return Err(plain(
            "результат не может лежать на месте приёмника или донора.",
        ));
    }
    write_atomic(&output, &report.bytes)?;
    fresh.keep();

    let (min, max) = report.bounds;
    let corner = |point: [f32; 3]| Value::from(point.map(f64::from).to_vec());
    Ok(table([
        ("output", Value::from(output.display().to_string())),
        ("grafted", Value::from(report.grafted)),
        ("shaders", Value::from(report.shaders)),
        ("textures", Value::from(report.textures)),
        ("geometries", Value::from(report.geometries)),
        ("flagsHigh", Value::from(report.flags_high)),
        (
            "bounds",
            table([("min", corner(min)), ("max", corner(max))]),
        ),
        ("outputBytes", Value::from(report.bytes.len())),
    ]))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::split::{geometry_blocks, high_models, mapping_of};
    use crate::run;
    use rage_res::resource_graph::{from_parts, identity_order, rebuild};
    use serde_json::json;

    const SYSTEM_BASE: u64 = 0x5000_0000;
    const GRAPHICS_BASE: u64 = 0x6000_0000;

    // ----------------------------------------------------------------------------------------
    // Сборщик подставных моделей: в песочнице нет файлов игры, поэтому рисовалка собирается
    // по описанию структуры (корень, группа шейдеров, словарь, модель, геометрии, вершины).
    // ----------------------------------------------------------------------------------------

    #[derive(Default)]
    struct Asm {
        system: Vec<u8>,
        graphics: Vec<u8>,
    }

    impl Asm {
        fn alloc(&mut self, size: usize) -> usize {
            let at = (self.system.len() + 15) & !15;
            self.system.resize(at + size.max(1), 0);
            at
        }

        fn gfx(&mut self, bytes: &[u8]) -> usize {
            let at = (self.graphics.len() + 15) & !15;
            self.graphics.resize(at, 0);
            self.graphics.extend_from_slice(bytes);
            at
        }

        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.system[at..at + bytes.len()].copy_from_slice(bytes);
        }

        fn u16(&mut self, at: usize, value: u16) {
            self.put(at, &value.to_le_bytes());
        }

        fn u32(&mut self, at: usize, value: u32) {
            self.put(at, &value.to_le_bytes());
        }

        fn link(&mut self, at: usize, target: usize) {
            self.put(at, &(SYSTEM_BASE + target as u64).to_le_bytes());
        }

        fn link_graphics(&mut self, at: usize, target: usize) {
            self.put(at, &(GRAPHICS_BASE + target as u64).to_le_bytes());
        }

        fn text(&mut self, text: &str) -> usize {
            let at = self.alloc(text.len() + 1);
            self.put(at, text.as_bytes());
            at
        }

        fn list(&mut self, targets: &[usize]) -> usize {
            let at = self.alloc(targets.len() * 8);
            for (index, &target) in targets.iter().enumerate() {
                self.link(at + index * 8, target);
            }
            at
        }
    }

    #[derive(Clone)]
    struct ShaderSpec {
        texture: &'static str,
        bucket: u8,
        emissive: Option<[f32; 4]>,
    }

    #[derive(Clone)]
    struct GeometrySpec {
        shader: usize,
        points: Vec<[f32; 3]>,
    }

    #[derive(Clone)]
    struct ModelSpec {
        shaders: Vec<ShaderSpec>,
        geometries: Vec<GeometrySpec>,
        skinned: bool,
        dictionary: bool,
        root_word: u32,
    }

    fn shader(texture: &'static str, bucket: u8) -> ShaderSpec {
        ShaderSpec {
            texture,
            bucket,
            emissive: None,
        }
    }

    fn triangle(shift: f32) -> Vec<[f32; 3]> {
        vec![
            [shift, 0.0, 0.0],
            [shift + 1.0, 0.5, 0.25],
            [shift + 0.5, 1.0, 2.0],
        ]
    }

    impl ModelSpec {
        fn new(shaders: Vec<ShaderSpec>, geometries: Vec<GeometrySpec>) -> Self {
            Self {
                shaders,
                geometries,
                skinned: false,
                dictionary: true,
                root_word: 0x0000_ff00,
            }
        }

        fn build(&self) -> Vec<u8> {
            let mut asm = Asm::default();
            let root = asm.alloc(0x100);
            // Словарь и объекты текстур.
            let mut names: Vec<&str> = Vec::new();
            for name in self.shaders.iter().map(|shader| shader.texture) {
                if !names.contains(&name) {
                    names.push(name);
                }
            }
            let objects: Vec<usize> = names
                .iter()
                .map(|name| {
                    let object = asm.alloc(0x90);
                    let text = asm.text(name);
                    asm.link(object + 0x28, text);
                    object
                })
                .collect();
            // Шейдеры: параметры (записи, данные векторов, хеши), блок шейдера.
            let mut shader_blocks = Vec::new();
            for (index, spec) in self.shaders.iter().enumerate() {
                let count = 1 + usize::from(spec.emissive.is_some());
                let data_at = count * 16;
                let hashes_at = data_at + 16 * (count - 1);
                let params = asm.alloc(hashes_at + 4 * count);
                let object = objects[names.iter().position(|name| *name == spec.texture).unwrap()];
                asm.link(params + 8, object);
                asm.u32(params + hashes_at, joaat("diffusesampler"));
                if let Some(vector) = spec.emissive {
                    asm.put(params + 16, &[1]);
                    asm.link(params + 24, params + data_at);
                    for (axis, value) in vector.iter().enumerate() {
                        asm.put(params + data_at + axis * 4, &value.to_le_bytes());
                    }
                    asm.u32(params + hashes_at + 4, joaat(EMISSIVE_PARAMETER));
                }
                let block = asm.alloc(0x20);
                asm.link(block, params);
                asm.u32(block + 8, 0xAAAA_0000 + index as u32);
                asm.put(block + 0x10, &[count as u8, spec.bucket]);
                shader_blocks.push(block);
            }
            let group = asm.alloc(0x20);
            let list = asm.list(&shader_blocks);
            asm.link(group + 0x10, list);
            asm.u16(group + 0x18, shader_blocks.len() as u16);
            if self.dictionary {
                let hashes = asm.alloc(names.len() * 4);
                for (index, name) in names.iter().enumerate() {
                    asm.u32(hashes + index * 4, joaat(name));
                }
                let textures = asm.list(&objects);
                let dictionary = asm.alloc(0x40);
                asm.u32(dictionary + 0x18, 1);
                asm.link(dictionary + 0x20, hashes);
                asm.link(dictionary + 0x30, textures);
                for at in [0x28, 0x2a, 0x38, 0x3a] {
                    asm.u16(dictionary + at, names.len() as u16);
                }
                asm.link(group + 0x08, dictionary);
            }
            // Геометрии.
            let mut geometry_blocks = Vec::new();
            let mut records = Vec::new();
            for geometry in &self.geometries {
                let mut stream = Vec::new();
                for point in &geometry.points {
                    point
                        .iter()
                        .for_each(|value| stream.extend_from_slice(&value.to_le_bytes()));
                }
                let stream_at = asm.gfx(&stream);
                let declaration = asm.alloc(32);
                asm.u32(declaration, if self.skinned { 1 | 2 | 4 } else { 1 });
                asm.put(declaration + 8, &0x866u64.to_le_bytes());
                let buffer = asm.alloc(0x40);
                asm.u16(buffer + 8, 12);
                asm.link_graphics(buffer + 0x10, stream_at);
                asm.link_graphics(buffer + 0x20, stream_at);
                asm.u32(buffer + 0x18, geometry.points.len() as u32);
                asm.link(buffer + 0x30, declaration);
                let block = asm.alloc(0x40);
                asm.link(block + 0x18, buffer);
                geometry_blocks.push(block);
                let mut record = [0u8; 32];
                for axis in 0..3 {
                    let low = geometry
                        .points
                        .iter()
                        .map(|p| p[axis])
                        .fold(f32::MAX, f32::min);
                    let high = geometry
                        .points
                        .iter()
                        .map(|p| p[axis])
                        .fold(f32::MIN, f32::max);
                    write_f32(&mut record, axis * 4, low);
                    write_f32(&mut record, 16 + axis * 4, high);
                }
                records.push(record);
            }
            let count = self.geometries.len();
            let model = asm.alloc(0x40);
            if count > 0 {
                let geometry_list = asm.list(&geometry_blocks);
                asm.link(model + 0x08, geometry_list);
                let mapping = asm.alloc(count * 2);
                for (index, geometry) in self.geometries.iter().enumerate() {
                    asm.u16(mapping + index * 2, geometry.shader as u16);
                }
                asm.link(model + 0x20, mapping);
                let bounds = bounds_bytes(&records);
                let bounds_at = asm.alloc(bounds.len());
                asm.put(bounds_at, &bounds);
                asm.link(model + 0x18, bounds_at);
            }
            for at in [0x10, 0x12, 0x2e] {
                asm.u16(model + at, count as u16);
            }
            let entries = asm.list(&[model]);
            let header = asm.alloc(16);
            asm.link(header, entries);
            asm.u16(header + 8, 1);
            asm.link(root + 0x10, group);
            asm.link(root + 0x50, header);
            asm.u32(root + 0x80, self.root_word);
            let graph = from_parts(165, 0xA000_0000, 0x5000_0000, asm.system, asm.graphics);
            rebuild(
                &graph,
                &identity_order(&graph, Segment::System),
                &identity_order(&graph, Segment::Graphics),
            )
            .unwrap()
        }
    }

    /// Что видно в собранном файле.
    struct Inspection {
        graph: Graph,
        root: usize,
        main: usize,
    }

    impl Inspection {
        fn of(bytes: &[u8]) -> Self {
            let graph = rg::scan(&Resource::parse(bytes).unwrap()).unwrap();
            let root = graph.root().unwrap();
            let main = high_models(&graph, root).unwrap()[0];
            Self { graph, root, main }
        }

        fn geometries(&self) -> Vec<usize> {
            geometry_blocks(&self.graph, self.main).unwrap()
        }

        fn mapping(&self) -> Vec<u16> {
            mapping_of(&self.graph, self.main).unwrap().unwrap()
        }

        fn group(&self) -> usize {
            pointer_block(&self.graph, self.root, 0x10).unwrap()
        }

        fn shader_count(&self) -> usize {
            shader_blocks(&self.graph, self.group()).unwrap().len()
        }

        fn dictionary(&self) -> usize {
            pointer_block(&self.graph, self.group(), 0x08).unwrap()
        }

        fn texture_names(&self) -> Vec<String> {
            dictionary_textures(&self.graph, self.dictionary())
                .unwrap()
                .into_iter()
                .map(|(name, _)| name)
                .collect()
        }

        fn hashes(&self) -> Vec<u32> {
            let block = pointer_block(&self.graph, self.dictionary(), 0x20).unwrap();
            (0..self.texture_names().len())
                .map(|index| u32_at(&self.graph, block, index * 4).unwrap())
                .collect()
        }

        fn root_word(&self) -> u32 {
            u32_at(&self.graph, self.root, 0x80).unwrap()
        }

        fn points(&self, geometry: usize) -> Vec<[f32; 3]> {
            let buffer = pointer_block(&self.graph, geometry, 0x18).unwrap();
            let stream = pointer_block(&self.graph, buffer, 0x10).unwrap();
            let count = u32_at(&self.graph, buffer, 0x18).unwrap() as usize;
            let bytes = self.graph.content(stream);
            (0..count)
                .map(|index| [0, 1, 2].map(|axis| read_f32(bytes, index * 12 + axis * 4)))
                .collect()
        }

        fn records(&self) -> Vec<[u8; 32]> {
            records_of(&self.graph, self.main).unwrap()
        }

        fn root_box(&self) -> ([f32; 3], [f32; 3]) {
            let bytes = self.graph.content(self.root);
            (
                [0, 1, 2].map(|axis| read_f32(bytes, 0x30 + axis * 4)),
                [0, 1, 2].map(|axis| read_f32(bytes, 0x40 + axis * 4)),
            )
        }
    }

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> String {
            self.dir.path().join(name).to_string_lossy().into_owned()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        }

        fn model(&self, name: &str, spec: &ModelSpec) -> String {
            self.put(name, &spec.build())
        }

        fn exec(&self, body: &Value, output: &str) -> (Value, i32) {
            let input = self.put("request.json", body.to_string().as_bytes());
            let args = ["graft-drawable", "--input", &input, "--output", output].map(str::to_owned);
            let outcome = run(&args, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }

        fn graft(&self, target: &str, donor: &str, extra: Value) -> (Value, i32, String) {
            let output = self.path("out/result.ydr");
            let mut body = json!({
                "format": "astral.graft-drawable",
                "version": 1,
                "target": target,
                "donor": donor,
                "diffuse": ["tex_b"],
            });
            for (key, value) in extra.as_object().cloned().unwrap_or_default() {
                body[key] = value;
            }
            let (value, code) = self.exec(&body, &output);
            (value, code, output)
        }
    }

    fn refused(message: &str) -> (Value, i32) {
        (
            json!({ "ok": false, "error": { "code": "InvalidDataException", "message": message } }),
            1,
        )
    }

    fn two_shader_model() -> ModelSpec {
        ModelSpec::new(
            vec![shader("tex_a", 0), shader("tex_b", 2)],
            vec![
                GeometrySpec {
                    shader: 0,
                    points: triangle(0.0),
                },
                GeometrySpec {
                    shader: 1,
                    points: triangle(10.0),
                },
            ],
        )
    }

    fn record(low: [f32; 4], high: [f32; 4]) -> [u8; 32] {
        let mut out = [0u8; 32];
        for axis in 0..4 {
            write_f32(&mut out, axis * 4, low[axis]);
            write_f32(&mut out, 16 + axis * 4, high[axis]);
        }
        out
    }

    // ----------------------------------------------------------------------------------------
    // Помощники для соседних команд
    // ----------------------------------------------------------------------------------------

    #[test]
    fn floats_are_three_little_endian_numbers() {
        assert_eq!(
            floats(&[1.0, 2.0, 3.0]),
            [0, 0, 0x80, 0x3f, 0, 0, 0, 0x40, 0, 0, 0x40, 0x40]
        );
    }

    #[test]
    fn read_and_write_f32_use_little_endian_at_an_offset() {
        let mut bytes = [0u8; 12];
        write_f32(&mut bytes, 4, -2.5);
        assert_eq!(bytes[4..8], (-2.5f32).to_le_bytes());
        assert_eq!(read_f32(&bytes, 4), -2.5);
        assert_eq!(read_f32(&bytes, 0), 0.0);
    }

    #[test]
    #[should_panic]
    fn reading_past_the_end_panics() {
        read_f32(&[0u8; 6], 4);
    }

    #[test]
    #[should_panic]
    fn writing_past_the_end_panics() {
        write_f32(&mut [0u8; 6], 4, 1.0);
    }

    #[test]
    fn extent_takes_the_axes_over_all_records_and_starts_from_the_extremes() {
        assert_eq!(extent(&[]), ([f32::MAX; 3], [f32::MIN; 3]));
        let records = [
            record([-1.0, 0.0, 2.0, 7.0], [1.0, 1.0, 3.0, 7.0]),
            record([-2.0, 0.5, 1.0, 7.0], [0.5, 4.0, 2.5, 7.0]),
        ];
        assert_eq!(extent(&records), ([-2.0, 0.0, 1.0], [1.0, 4.0, 3.0]));
        // Число побеждает не-число.
        let nan = record([f32::NAN, 0.0, 0.0, 0.0], [f32::NAN, 1.0, 1.0, 0.0]);
        assert_eq!(extent(&[nan, records[0]]).0[0], -1.0);
    }

    #[test]
    fn bounds_bytes_put_the_union_first_only_for_several_records() {
        assert!(bounds_bytes(&[]).is_empty());
        let one = record([0.0, 1.0, 2.0, 3.0], [4.0, 5.0, 6.0, 7.0]);
        assert_eq!(bounds_bytes(&[one]), one);
        let two = record([-1.0, 2.0, 0.0, -5.0], [3.0, 9.0, 1.0, 8.0]);
        let joined = bounds_bytes(&[one, two]);
        assert_eq!(joined.len(), 96);
        let union = record([-1.0, 1.0, 0.0, -5.0], [4.0, 9.0, 6.0, 8.0]);
        assert_eq!(joined[..32], union);
        assert_eq!(joined[32..64], one);
        assert_eq!(joined[64..], two);
    }

    #[test]
    fn records_and_shaders_of_a_built_model_read_back() {
        let bytes = two_shader_model().build();
        let view = Inspection::of(&bytes);
        assert_eq!(view.geometries().len(), 2);
        assert_eq!(view.shader_count(), 2);
        let records = view.records();
        assert_eq!(records.len(), 2);
        assert_eq!(read_f32(&records[1], 0), 10.0);
        assert_eq!(read_f32(&records[1], 16), 11.0);
    }

    #[test]
    fn missing_pointers_give_single_prefixed_texts() {
        let view = Inspection::of(&two_shader_model().build());
        let mut graph = view.graph.clone();
        let group = view.group();
        graph.blocks[group]
            .slots
            .retain(|slot| slot.relative != 0x10);
        assert_eq!(
            shader_blocks(&graph, group).unwrap_err(),
            invalid("graft-drawable: у группы нет списка шейдеров.")
        );
        let mut broken = view.graph.clone();
        broken.blocks[view.main]
            .slots
            .retain(|slot| slot.relative != 0x18);
        assert_eq!(
            records_of(&broken, view.main).unwrap_err(),
            invalid("graft-drawable: у модели нет рамок.")
        );
        // Ноль геометрий — пустой список без чтения рамок.
        let empty = Inspection::of(&ModelSpec::new(vec![shader("tex_a", 0)], vec![]).build());
        assert!(records_of(&empty.graph, empty.main).unwrap().is_empty());
    }

    // ----------------------------------------------------------------------------------------
    // Запрос
    // ----------------------------------------------------------------------------------------

    #[test]
    fn request_refusals_come_in_the_documented_order() {
        let bench = Bench::new();
        let target = bench.model("target.ydr", &two_shader_model());
        let donor = bench.model("donor.ydr", &two_shader_model());
        let out = bench.path("o.ydr");
        let base = |extra: Value| {
            let mut body = json!({
                "format": "astral.graft-drawable",
                "version": 1,
                "target": target,
                "donor": donor,
                "diffuse": ["tex_b"],
            });
            for (key, value) in extra.as_object().unwrap() {
                body[key.as_str()] = value.clone();
            }
            body
        };
        let call = |body: Value| bench.exec(&body, &out);

        let unknown = refused("graft-drawable: неизвестный формат запроса.");
        assert_eq!(call(base(json!({ "format": "other" }))), unknown);
        for version in [json!(2), json!("1"), json!(1.0), json!(null)] {
            assert_eq!(call(base(json!({ "version": version }))), unknown);
        }
        assert_eq!(call(json!([])), unknown);
        for field in ["target", "donor"] {
            for value in [json!(null), json!(5)] {
                assert_eq!(
                    call(base(json!({ field: value }))),
                    refused(&format!("graft-drawable: нет поля {field}."))
                );
            }
        }
        assert_eq!(
            call(base(json!({ "diffuse": "x" }))),
            refused("graft-drawable: нет списка diffuse.")
        );
        for list in [json!([]), json!(vec!["a"; 33])] {
            assert_eq!(
                call(base(json!({ "diffuse": list }))),
                refused("graft-drawable: нужно от 1 до 32 имён текстур.")
            );
        }
        let long = "x".repeat(161);
        let names = [
            (json!("Bad Name"), "bad name"),
            (json!(""), ""),
            (json!(5), ""),
            (json!("  "), ""),
            (json!("a/b"), "a/b"),
            (json!(long), long.as_str()),
        ];
        for (name, shown) in names {
            assert_eq!(
                call(base(json!({ "diffuse": [name] }))),
                refused(&format!("graft-drawable: имя текстуры {shown} не годится.")),
                "{shown:?}"
            );
        }
        let offset = refused("graft-drawable: сдвиг — три числа в пределах 1000 м.");
        for value in [
            json!([1, 2]),
            json!([1, 2, 3, 4]),
            json!("x"),
            json!({}),
            json!(true),
            json!([1, 2, 1000.5]),
            json!([1, "2", 3]),
        ] {
            assert_eq!(call(base(json!({ "offset": value }))), offset, "{value}");
        }
        let emissive = refused("graft-drawable: свечение — число от 0 до 64.");
        for value in [
            json!(-1),
            json!(64.5),
            json!("1"),
            json!(true),
            json!([]),
            json!({}),
        ] {
            assert_eq!(
                call(base(json!({ "emissive": value }))),
                emissive,
                "{value}"
            );
        }
    }

    #[test]
    fn file_level_refusals_and_output_directories() {
        let bench = Bench::new();
        let target = bench.model("target.ydr", &two_shader_model());
        let donor = bench.model("donor.ydr", &two_shader_model());
        let body = |target: &str, donor: &str| {
            json!({
                "format": "astral.graft-drawable",
                "version": 1,
                "target": target,
                "donor": donor,
                "diffuse": ["tex_b"],
            })
        };
        let out = bench.path("made/deep/o.ydr");
        let missing = bench.path("none.ydr");
        let reply = bench.exec(&body(&missing, &donor), &out);
        assert_eq!(reply.0["error"]["code"], "FileNotFoundException");
        assert_eq!(
            reply.0["error"]["message"],
            format!("File was not found: {missing}")
        );
        let txt = bench.put("model.txt", b"x");
        let reply = bench.exec(&body(&target, &txt), &out);
        assert_eq!(
            reply.0["error"]["message"],
            "Unsupported file extension: .txt"
        );
        let reply = bench.exec(&body(&target, &donor), &bench.path("o.bin"));
        assert_eq!(
            reply.0["error"]["message"],
            "Unsupported output extension: .bin"
        );
        // Каталог результата создаётся до чтения моделей, но отказ позже убирает созданные каталоги (раньше они оставались пустыми).
        let empty = bench.put("empty.ydr", b"");
        let reply = bench.exec(&body(&empty, &donor), &out);
        assert_eq!(
            reply,
            refused("graft-drawable: модель пустая или больше 64 МБ.")
        );
        assert!(!Path::new(&bench.path("made")).exists());
        assert!(!Path::new(&out).exists());
        // Отказ по приёмнику побеждает любой отказ по донору.
        let junk = bench.put("junk.ydr", b"not a resource at all, but long enough");
        let reply = bench.exec(&body(&junk, &empty), &out);
        assert_eq!(reply.0["error"]["code"], "InvalidOperationException");
        let reply = bench.exec(&body(&target, &junk), &out);
        assert_eq!(reply.0["error"]["code"], "InvalidOperationException");
        let reply = bench.exec(&body(&target, &empty), &out);
        assert_eq!(
            reply,
            refused("graft-drawable: модель пустая или больше 64 МБ.")
        );
        // Запрос не-UTF-8 — отказ чтения, запрос не JSON — отказ разбора.
        let input = bench.put("bad.json", &[0xff, 0xfe, 0x00]);
        let args = ["graft-drawable", "--input", &input, "--output", &out].map(str::to_owned);
        let value: Value = serde_json::from_str(&run(&args, &Progress::silent()).line).unwrap();
        assert_eq!(value["error"]["code"], "IOException");
        assert_eq!(
            value["error"]["message"],
            "stream did not contain valid UTF-8"
        );
        let input = bench.put("broken.json", b"{ nope");
        let args = ["graft-drawable", "--input", &input, "--output", &out].map(str::to_owned);
        let value: Value = serde_json::from_str(&run(&args, &Progress::silent()).line).unwrap();
        assert_eq!(
            value["error"]["message"],
            "graft-drawable: запрос не читается."
        );
    }

    // ----------------------------------------------------------------------------------------
    // Перенос
    // ----------------------------------------------------------------------------------------

    #[test]
    fn a_geometry_with_the_wanted_sheet_is_grafted_with_a_copy_of_its_shader() {
        let bench = Bench::new();
        let model = bench.model("model.ydr", &two_shader_model());
        let (value, code, output) = bench.graft(&model, &model, json!({}));
        assert_eq!(code, 0, "{value}");
        let result = &value["result"];
        assert_eq!(result["grafted"], 1);
        assert_eq!(result["shaders"], 1);
        assert_eq!(result["textures"], json!([]));
        assert_eq!(result["geometries"], 3);
        assert_eq!(result["flagsHigh"], 4, "корзина 2 даёт бит 1 << 2");
        let written = std::fs::read(&output).unwrap();
        assert_eq!(result["outputBytes"], written.len());
        let view = Inspection::of(&written);
        assert_eq!(view.geometries().len(), 3);
        assert_eq!(view.mapping(), [0, 1, 2], "шейдер копии — третий в списке");
        assert_eq!(view.shader_count(), 3);
        assert_eq!(view.root_word() & 0xffff_ff00, 0x0000_ff00);
        assert_eq!(view.root_word() & 0xff, 4);
        assert_eq!(view.records().len(), 3);
        // Рамка корня — по записям всех геометрий, числа ответа те же.
        let (min, max) = view.root_box();
        assert_eq!(min, [0.0, 0.0, 0.0]);
        assert_eq!(max, [11.0, 1.0, 2.0]);
        assert_eq!(
            result["bounds"],
            json!({ "min": [0.0, 0.0, 0.0], "max": [11.0, 1.0, 2.0] })
        );
        // Объединение — первая запись блока рамок.
        let bounds = pointer_block(&view.graph, view.main, 0x18).unwrap();
        assert_eq!(read_f32(&view.graph.content(bounds)[..32], 16), 11.0);
        assert_eq!(view.texture_names(), ["tex_a", "tex_b"]);
        assert_eq!(u16_at(&view.graph, view.main, 0x2c).unwrap(), 4);
    }

    #[test]
    fn a_zero_offset_keeps_the_donor_blocks_and_the_donor_record() {
        let bench = Bench::new();
        let model = bench.model("model.ydr", &two_shader_model());
        let (_, _, plain_output) = bench.graft(&model, &model, json!({}));
        let (value, code, zero_output) =
            bench.graft(&model, &model, json!({ "offset": [0, -0.0, 0.0] }));
        assert_eq!(code, 0, "{value}");
        assert_eq!(
            std::fs::read(plain_output).unwrap(),
            std::fs::read(zero_output).unwrap()
        );
    }

    #[test]
    fn an_offset_moves_vertices_the_record_and_the_root_box() {
        let bench = Bench::new();
        let model = bench.model("model.ydr", &two_shader_model());
        let (value, code, output) =
            bench.graft(&model, &model, json!({ "offset": [100, -2, 0.5] }));
        assert_eq!(code, 0, "{value}");
        let view = Inspection::of(&std::fs::read(output).unwrap());
        let moved = view.geometries()[2];
        assert_eq!(
            view.points(moved),
            [[110.0, -2.0, 0.5], [111.0, -1.5, 0.75], [110.5, -1.0, 2.5]]
        );
        // Исходная геометрия приёмника не тронута.
        assert_eq!(view.points(view.geometries()[1])[0], [10.0, 0.0, 0.0]);
        let record = view.records()[2];
        assert_eq!(
            [
                read_f32(&record, 0),
                read_f32(&record, 4),
                read_f32(&record, 8)
            ],
            [110.0, -2.0, 0.5]
        );
        assert_eq!(
            [
                read_f32(&record, 16),
                read_f32(&record, 20),
                read_f32(&record, 24)
            ],
            [111.0, -1.0, 2.5]
        );
        assert_eq!(view.root_box().1, [111.0, 1.0, 2.5]);
        assert_eq!(value["result"]["bounds"]["max"], json!([111.0, 1.0, 2.5]));
    }

    #[test]
    fn new_sheets_go_into_the_dictionary_in_hash_order() {
        let bench = Bench::new();
        let target = bench.model(
            "target.ydr",
            &ModelSpec::new(
                vec![shader("tex_a", 0)],
                vec![GeometrySpec {
                    shader: 0,
                    points: triangle(0.0),
                }],
            ),
        );
        let donor = bench.model(
            "donor.ydr",
            &ModelSpec::new(
                vec![shader("tex_new_one", 1), shader("tex_new_two", 3)],
                vec![
                    GeometrySpec {
                        shader: 0,
                        points: triangle(1.0),
                    },
                    GeometrySpec {
                        shader: 1,
                        points: triangle(2.0),
                    },
                ],
            ),
        );
        let (value, code, output) = bench.graft(
            &target,
            &donor,
            json!({ "diffuse": ["TEX_NEW_TWO", "tex_new_one"] }),
        );
        assert_eq!(code, 0, "{value}");
        assert_eq!(
            value["result"]["textures"],
            json!(["tex_new_one", "tex_new_two"])
        );
        assert_eq!(value["result"]["grafted"], 2);
        assert_eq!(value["result"]["shaders"], 2);
        assert_eq!(value["result"]["flagsHigh"], (1 << 1) | (1 << 3));
        let view = Inspection::of(&std::fs::read(output).unwrap());
        let names = view.texture_names();
        let mut expected = vec![
            "tex_a".to_owned(),
            "tex_new_one".to_owned(),
            "tex_new_two".to_owned(),
        ];
        expected.sort_by_key(|name| joaat(name));
        assert_eq!(names, expected);
        let hashes = view.hashes();
        assert_eq!(
            hashes,
            names.iter().map(|name| joaat(name)).collect::<Vec<_>>()
        );
        assert!(hashes.windows(2).all(|pair| pair[0] <= pair[1]));
        for at in [0x28, 0x2a, 0x38, 0x3a] {
            assert_eq!(u16_at(&view.graph, view.dictionary(), at).unwrap(), 3);
        }
        assert_eq!(view.mapping(), [0, 1, 2]);
        assert_eq!(view.shader_count(), 3);
    }

    #[test]
    fn a_receiver_without_a_dictionary_gets_one() {
        let bench = Bench::new();
        let mut bare = ModelSpec::new(
            vec![shader("tex_a", 0)],
            vec![GeometrySpec {
                shader: 0,
                points: triangle(0.0),
            }],
        );
        bare.dictionary = false;
        let target = bench.model("target.ydr", &bare);
        let donor = bench.model("donor.ydr", &two_shader_model());
        let (value, code, output) = bench.graft(&target, &donor, json!({}));
        assert_eq!(code, 0, "{value}");
        assert_eq!(value["result"]["textures"], json!(["tex_b"]));
        let view = Inspection::of(&std::fs::read(output).unwrap());
        assert_eq!(view.texture_names(), ["tex_b"]);
        assert_eq!(u32_at(&view.graph, view.dictionary(), 0x18).unwrap(), 1);
    }

    #[test]
    fn the_emissive_value_goes_only_to_the_copied_shader() {
        let bench = Bench::new();
        let mut glowing = two_shader_model();
        glowing.shaders[1].emissive = Some([1.0, 2.0, 3.0, 4.0]);
        let model = bench.model("model.ydr", &glowing);
        let (value, code, output) = bench.graft(&model, &model, json!({ "emissive": 0.25 }));
        assert_eq!(code, 0, "{value}");
        let view = Inspection::of(&std::fs::read(output).unwrap());
        let shaders = shader_blocks(&view.graph, view.group()).unwrap();
        assert_eq!(shaders.len(), 3);
        let vector_of = |view: &Inspection, shader: usize| {
            let params = pointer_block(&view.graph, shader, 0).unwrap();
            let data = pointer_block(&view.graph, params, 16 + 8).unwrap();
            let bytes = view.graph.content(data);
            [0, 1, 2, 3].map(|axis| read_f32(bytes, axis * 4))
        };
        assert_eq!(
            vector_of(&view, shaders[1]),
            [1.0, 2.0, 3.0, 4.0],
            "приёмник не тронут"
        );
        assert_eq!(
            vector_of(&view, shaders[2]),
            [0.25, 2.0, 3.0, 4.0],
            "у копии меняется только x"
        );
        // Без свечения копия берёт данные исходного шейдера.
        let (_, code, output) = bench.graft(&model, &model, json!({}));
        assert_eq!(code, 0);
        let plain = Inspection::of(&std::fs::read(output).unwrap());
        let shaders = shader_blocks(&plain.graph, plain.group()).unwrap();
        assert_eq!(vector_of(&plain, shaders[2]), [1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn a_skinned_receiver_is_refused_and_a_skinned_donor_model_is_skipped() {
        let bench = Bench::new();
        let mut skinned = two_shader_model();
        skinned.skinned = true;
        let plain = bench.model("plain.ydr", &two_shader_model());
        let skin = bench.model("skin.ydr", &skinned);
        let (value, code, _) = bench.graft(&skin, &plain, json!({}));
        assert_eq!(
            (value, code),
            refused("graft-drawable: приёмник со скином не принимает части.")
        );
        let (value, code, _) = bench.graft(&plain, &skin, json!({}));
        assert_eq!(
            (value, code),
            refused("graft-drawable: у донора нет геометрии с этими текстурами.")
        );
    }

    #[test]
    fn missing_sheets_and_missing_high_detail_have_their_texts() {
        let bench = Bench::new();
        let plain = bench.model("plain.ydr", &two_shader_model());
        let (value, code, _) = bench.graft(&plain, &plain, json!({ "diffuse": ["no_such_sheet"] }));
        assert_eq!(
            (value, code),
            refused("graft-drawable: у донора нет геометрии с этими текстурами.")
        );
    }

    #[test]
    fn grafting_twice_gives_the_same_bytes() {
        let bench = Bench::new();
        let model = bench.model("model.ydr", &two_shader_model());
        let extra = json!({ "offset": [1, 2, 3], "emissive": 3 });
        let (_, _, first) = bench.graft(&model, &model, extra.clone());
        let first = std::fs::read(first).unwrap();
        let (_, _, second) = bench.graft(&model, &model, extra);
        assert_eq!(first, std::fs::read(second).unwrap());
    }

    #[test]
    fn grafting_onto_the_result_keeps_growing_the_model() {
        let bench = Bench::new();
        let model = bench.model("model.ydr", &two_shader_model());
        let (_, code, result) = bench.graft(&model, &model, json!({}));
        assert_eq!(code, 0);
        // Результат первой пересадки становится приёмником второй; он лежит в другом файле, чем её результат.
        let first = bench.path("out/first.ydr");
        std::fs::rename(&result, &first).unwrap();
        let (value, code, second) = bench.graft(&first, &model, json!({}));
        assert_eq!(code, 0, "{value}");
        assert_eq!(value["result"]["geometries"], 4);
        let view = Inspection::of(&std::fs::read(second).unwrap());
        assert_eq!(view.geometries().len(), 4);
        assert_eq!(view.shader_count(), 4);
    }

    #[test]
    fn the_output_may_not_replace_the_target_or_the_donor() {
        let bench = Bench::new();
        let model = bench.model("model.ydr", &two_shader_model());
        let before = std::fs::read(&model).unwrap();
        // Раньше результат поверх приёмника (и донора) молча заменял исходную модель.
        let body = json!({
            "format": "astral.graft-drawable",
            "version": 1,
            "target": model,
            "donor": model,
            "diffuse": ["tex_b"],
        });
        let (value, code) = bench.exec(&body, &model);
        assert_eq!(code, 1, "{value}");
        assert_eq!(
            value["error"]["message"],
            "graft-drawable: результат не может лежать на месте приёмника или донора."
        );
        assert_eq!(std::fs::read(&model).unwrap(), before);
        assert!(!Path::new(&format!("{model}.shop-stage")).exists());
        // донор отдельным файлом, результат поверх донора
        let other = bench.model("other.ydr", &two_shader_model());
        let body = json!({
            "format": "astral.graft-drawable",
            "version": 1,
            "target": model,
            "donor": other,
            "diffuse": ["tex_b"],
        });
        let (value, code) = bench.exec(&body, &other);
        assert_eq!(code, 1, "{value}");
        assert_eq!(
            Inspection::of(&std::fs::read(&other).unwrap())
                .geometries()
                .len(),
            Inspection::of(&before).geometries().len()
        );
    }

    #[test]
    fn a_bucket_above_seven_sets_the_last_bit_of_the_mask() {
        let bench = Bench::new();
        let mut spec = two_shader_model();
        spec.shaders[1].bucket = 9;
        let model = bench.model("model.ydr", &spec);
        let (value, code, output) = bench.graft(&model, &model, json!({}));
        assert_eq!(code, 0, "{value}");
        assert_eq!(value["result"]["flagsHigh"], 0x80);
        let view = Inspection::of(&std::fs::read(output).unwrap());
        assert_eq!(view.root_word(), 0x0000_ff80);
        assert_eq!(u16_at(&view.graph, view.main, 0x2c).unwrap(), 0x80);
    }

    #[test]
    fn a_changed_expectation_is_caught() {
        // Отрицательный контроль: объединение рамок не равно первой записи геометрии.
        let one = record([0.0; 4], [1.0; 4]);
        let two = record([-3.0; 4], [4.0; 4]);
        assert_ne!(bounds_bytes(&[one, two])[..32], one);
    }
}
