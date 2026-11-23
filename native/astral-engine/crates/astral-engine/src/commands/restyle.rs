//! `restyle-drawable`: правка готовой модели `.ydr` по шагам. Шаг — лист (встроенная текстура, на её место встаёт
//! картинка автора), проекция развёртки «полосой», свечение и признак `textureOnly`. Версия 1 — одна модель,
//! версия 2 — до 600 моделей в пустую папку. Для `restyle-model` отсюда открыты `read_texture` и `dictionary_entries`.

use std::{
    borrow::Cow,
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use rage_res::{
    dds,
    hash::{joaat, sha256_hex},
    resource::Resource,
    resource_graph::{self, Address, Graph, Segment},
    texture::Format,
    vertex::{self, FLOAT2, FLOAT3, HALF2, POSITION, UV0},
    ytd_write::{self, payload_bytes, Entry, NewTexture},
};
use serde_json::{Map, Value};

use super::{
    graft::shader_blocks,
    shop::{embed_sheet, texture_objects, write_atomic, ytd_header, Flags},
    split::{
        address_of, geometry_blocks, high_models, mapping_of, pointer_block, texture_name, u16_at,
        u32_at,
    },
    Command,
};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.restyle-drawable";
const MAX_REQUEST_BYTES: usize = 2_097_152;
const MAX_SINGLE_BYTES: usize = 65_536;
const MAX_ITEMS: usize = 600;
const MAX_STEPS: usize = 8;
const MAX_MODEL_BYTES: usize = 67_108_864;
const MIN_DDS_BYTES: usize = 128;
const MAX_DDS_BYTES: usize = 8_388_608;
const MAX_SIDE: u32 = 4096;
const MAX_SCALE: f32 = 10_000.0;
const MIN_AXIS: f32 = 1e-6;
const MAX_GLOW: f32 = 64.0;
const MAX_UNPACKED_LEVELS: u32 = 13;

/// Смещения в графе модели.
mod at {
    pub const GROUP: usize = 0x10;
    pub const DICTIONARY: usize = 0x08;
    pub const PARAMETERS: usize = 0x00;
    pub const PARAMETER_COUNT: usize = 0x10;
    pub const VERTEX_BUFFER: usize = 0x18;
    pub const DECLARATION: usize = 0x30;
    pub const STREAM_FIRST: usize = 0x10;
    pub const STREAM_SECOND: usize = 0x20;
    pub const VERTEX_COUNT: usize = 0x18;
    /// Запись параметра: 16 байт; тип в первом, указатель на объект или данные — по смещению 8.
    pub const RECORD: usize = 16;
    pub const RECORD_POINTER: usize = 8;
}

const KIND_TEXTURE: u8 = 0;
const KIND_VECTOR: u8 = 1;

/// Допустимые ключи каждого уровня запроса.
const ROOT_KEYS: [&str; 8] = [
    "format",
    "version",
    "target",
    "texture",
    "uv",
    "emissive",
    "textureOnly",
    "items",
];
const TOP_LEVEL_STEP_KEYS: [&str; 5] = ["target", "texture", "uv", "emissive", "textureOnly"];
const ITEM_KEYS: [&str; 3] = ["target", "output", "steps"];
const STEP_KEYS: [&str; 4] = ["texture", "uv", "emissive", "textureOnly"];
const TEXTURE_KEYS: [&str; 2] = ["name", "dds"];
const UV_KEYS: [&str; 3] = ["axis", "offset", "scale"];

/// Отказы запроса и обработки; каждый — `InvalidDataException` с приставкой `restyle-drawable: `.
enum Say {
    RequestSize,
    Unreadable,
    NotObject,
    Stray(&'static str, String),
    Format,
    Version,
    SingleSize,
    SingleItems,
    NoModel,
    Inside(&'static str),
    ItemCount,
    ItemNotObject,
    OutputName,
    OutputTwice(String),
    StepCount(String),
    StepNotObject,
    OwnSheets(String),
    NoTexture,
    TextureNotObject,
    SheetName,
    NoProjection,
    ProjectionNotObject,
    AxisCount,
    AxisFinite,
    AxisZero,
    OffsetFinite,
    ScaleFinite,
    ScaleRange,
    GlowFinite,
    GlowRange,
    OnlyFlag,
    ModelSize,
    NoRoot,
    NoGroup,
    NoDictionary,
    NoSheet(String),
    NoVertices,
    NoMapping,
    ShaderOutside,
    PositionKind,
    UvKind,
    VertexOutside,
    ZeroStride,
    UvOutside,
    NoGlowData,
    GlowOutside,
    OutputIsFile,
    OutputBusy,
    NotDds(String),
    Sides(String),
    NotArgb(String),
    DataMismatch(String),
    LostRoot,
    LostGroup,
    LostDictionary,
    LostSheet,
}

impl Say {
    fn words(&self) -> Cow<'static, str> {
        let fixed = match self {
            Say::Stray(who, key) => return Cow::Owned(format!("{who} — лишнее поле «{key}».")),
            Say::Inside(key) => {
                return Cow::Owned(format!("в запросе версии 2 «{key}» — внутри items."))
            }
            Say::OutputTwice(name) => return Cow::Owned(format!("{name} указан дважды.")),
            Say::StepCount(name) => return Cow::Owned(format!("{name} — от 1 до 8 шагов.")),
            Say::OwnSheets(name) => {
                return Cow::Owned(format!("{name} — у каждого шага свой лист и textureOnly."))
            }
            Say::NoSheet(name) => {
                return Cow::Owned(format!("у модели нет встроенной текстуры {name}."))
            }
            Say::NotDds(name) => {
                return Cow::Owned(format!("текстура {name} — не DDS или больше 8 МБ."))
            }
            Say::Sides(name) => return Cow::Owned(format!("текстура {name} — стороны 1–4096.")),
            Say::NotArgb(name) => {
                return Cow::Owned(format!("текстура {name} — несжатый DDS только A8R8G8B8."))
            }
            Say::DataMismatch(name) => {
                return Cow::Owned(format!(
                    "текстура {name} — данные не сходятся с размером и ступенями."
                ))
            }
            Say::RequestSize => "запрос от 1 байта до 2 МБ.",
            Say::Unreadable => "запрос не читается.",
            Say::NotObject => "запрос — не объект.",
            Say::Format => "неизвестный формат запроса.",
            Say::Version => "версия запроса — 1 или 2.",
            Say::SingleSize => "запрос версии 1 — до 64 КБ.",
            Say::SingleItems => "в запросе версии 1 нет items.",
            Say::NoModel => "нет модели.",
            Say::ItemCount => "нужно от 1 до 600 items.",
            Say::ItemNotObject => "элемент — не объект.",
            Say::OutputName => "имя выходного файла — строчный .ydr.",
            Say::StepNotObject => "шаг — не объект.",
            Say::NoTexture => "у шага нет текстуры.",
            Say::TextureNotObject => "текстура — не объект.",
            Say::SheetName => "имя текстуры не годится.",
            Say::NoProjection => "у шага нет проекции.",
            Say::ProjectionNotObject => "проекция — не объект.",
            Say::AxisCount => "ось проекции — три числа.",
            Say::AxisFinite => "ось проекции — конечное число.",
            Say::AxisZero => "ось проекции — нулевая.",
            Say::OffsetFinite => "смещение проекции — конечное число.",
            Say::ScaleFinite => "масштаб проекции — конечное число.",
            Say::ScaleRange => "масштаб проекции вне ±10000.",
            Say::GlowFinite => "свечение — конечное число.",
            Say::GlowRange => "свечение вне 0–64.",
            Say::OnlyFlag => "textureOnly — логическое значение.",
            Say::ModelSize => "модель пустая или больше 64 МБ.",
            Say::NoRoot => "у модели нет корня.",
            Say::NoGroup => "у модели нет группы шейдеров.",
            Say::NoDictionary => "у группы нет словаря текстур.",
            Say::NoVertices => "в модели нет вершин с текстурными координатами.",
            Say::NoMapping => "у модели нет списка шейдеров геометрий.",
            Say::ShaderOutside => "номер шейдера геометрии вне списка.",
            Say::PositionKind => "позиции вершин — не float3.",
            Say::UvKind => "координаты текстуры — не float2 и не half2.",
            Say::VertexOutside => "вершина вне потока.",
            Say::ZeroStride => "шаг вершины в декларации — нулевой.",
            Say::UvOutside => "координаты вне потока.",
            Say::NoGlowData => "данных свечения нет.",
            Say::GlowOutside => "данные свечения вне блоков.",
            Say::OutputIsFile => "вывод — папка, а не файл.",
            Say::OutputBusy => "папка вывода должна быть пустой.",
            Say::LostRoot => "в результате нет корня.",
            Say::LostGroup => "в результате нет группы шейдеров.",
            Say::LostDictionary => "в результате нет словаря.",
            Say::LostSheet => "в результате нет текстуры — семантическая проверка не прошла.",
        };
        Cow::Borrowed(fixed)
    }
}

impl From<Say> for EngineError {
    fn from(say: Say) -> Self {
        EngineError::invalid_data(format!("restyle-drawable: {}", say.words()))
    }
}

// ---------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------

/// Точка чтения JSON: каждый шаг вглубь может оборваться, и тогда дальше читать нечего.
#[derive(Clone, Copy)]
struct Node<'a>(Option<&'a Value>);

impl<'a> Node<'a> {
    fn of(value: &'a Value) -> Self {
        Self(Some(value))
    }

    fn at(self, key: &str) -> Self {
        Self(self.0.and_then(|value| value.get(key)))
    }

    /// Ключ, у которого `null` равен отсутствию.
    fn live(self, key: &str) -> Self {
        Self(self.at(key).0.filter(|value| !value.is_null()))
    }

    fn some(self) -> bool {
        self.0.is_some()
    }

    fn text(self) -> Option<&'a str> {
        self.0?.as_str()
    }

    fn natural(self) -> Option<u64> {
        self.0?.as_u64()
    }

    fn flag(self) -> Option<bool> {
        self.0?.as_bool()
    }

    fn list(self) -> Option<&'a [Value]> {
        self.0?.as_array().map(Vec::as_slice)
    }

    fn fields(self) -> Option<&'a Map<String, Value>> {
        self.0?.as_object()
    }

    /// Конечное число после приведения к `f32`.
    fn finite(self) -> Option<f32> {
        self.0?
            .as_f64()
            .map(|number| number as f32)
            .filter(|number| number.is_finite())
    }
}

/// Первый ключ объекта, которого нет в списке допустимых.
fn stray<'a>(node: Node<'a>, allowed: &[&str]) -> Option<&'a String> {
    node.fields()?
        .keys()
        .find(|key| !allowed.contains(&key.as_str()))
}

/// Проекция вдоль оси: положение вершины → координата `u`; `v` всегда 0,5.
struct Strip {
    axis: [f32; 3],
    offset: f32,
    scale: f32,
}

impl Strip {
    fn read(step: Node) -> Result<Self> {
        let node = step.live("uv");
        node.some().then_some(()).ok_or(Say::NoProjection)?;
        node.fields().ok_or(Say::ProjectionNotObject)?;
        if let Some(key) = stray(node, &UV_KEYS) {
            return Err(Say::Stray("проекция", key.clone()).into());
        }
        let items = node
            .live("axis")
            .list()
            .filter(|items| items.len() == 3)
            .ok_or(Say::AxisCount)?;
        let axis = items
            .iter()
            .map(|item| Node::of(item).finite())
            .collect::<Option<Vec<f32>>>()
            .and_then(|parts| <[f32; 3]>::try_from(parts).ok())
            .ok_or(Say::AxisFinite)?;
        let length = axis.iter().map(|part| part * part).sum::<f32>().sqrt();
        (length >= MIN_AXIS).then_some(()).ok_or(Say::AxisZero)?;
        let offset = match node.live("offset") {
            absent if !absent.some() => 0.0,
            given => given.finite().ok_or(Say::OffsetFinite)?,
        };
        let scale = match node.live("scale") {
            absent if !absent.some() => 1.0,
            given => given.finite().ok_or(Say::ScaleFinite)?,
        };
        (scale.abs() <= MAX_SCALE)
            .then_some(())
            .ok_or(Say::ScaleRange)?;
        Ok(Self {
            axis,
            offset,
            scale,
        })
    }

    fn along(&self, place: [f32; 3]) -> f32 {
        let [ax, ay, az] = self.axis;
        let spread = (place[0] * ax + place[1] * ay) + place[2] * az;
        (spread - self.offset) * self.scale
    }
}

/// Один шаг правки.
struct Step {
    sheet: String,
    dds: PathBuf,
    strip: Strip,
    glow: Option<f32>,
    only_sheet: bool,
}

/// Знак имени листа и выходного файла: строчная латиница, цифра или один из «_.+-».
fn name_char(ch: char) -> bool {
    ch.is_ascii_lowercase() || ch.is_ascii_digit() || "_.+-".contains(ch)
}

fn sheet_name_fits(name: &str) -> bool {
    matches!(name.len(), 1..=160) && name.chars().all(name_char)
}

fn output_name_fits(name: &str) -> bool {
    name.strip_suffix(".ydr").is_some_and(|stem| {
        matches!(stem.len(), 1..=161)
            && stem.starts_with(|ch: char| ch.is_ascii_lowercase() || ch.is_ascii_digit())
            && stem.chars().all(name_char)
    })
}

fn read_step(holder: Node) -> Result<Step> {
    let texture = holder.live("texture");
    texture.some().then_some(()).ok_or(Say::NoTexture)?;
    texture.fields().ok_or(Say::TextureNotObject)?;
    if let Some(key) = stray(texture, &TEXTURE_KEYS) {
        return Err(Say::Stray("текстура", key.clone()).into());
    }
    let sheet = texture
        .at("name")
        .text()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    sheet_name_fits(&sheet)
        .then_some(())
        .ok_or(Say::SheetName)?;
    let dds = paths::existing_file(texture.at("dds").text().unwrap_or_default(), &[".dds"])?;
    let strip = Strip::read(holder)?;
    let glow = match holder.live("emissive") {
        absent if !absent.some() => None,
        given => Some(given.finite().ok_or(Say::GlowFinite)?),
    };
    if glow.is_some_and(|value| !(0.0..=MAX_GLOW).contains(&value)) {
        return Err(Say::GlowRange.into());
    }
    let only_sheet = match holder.live("textureOnly") {
        absent if !absent.some() => false,
        given => given.flag().ok_or(Say::OnlyFlag)?,
    };
    Ok(Step {
        sheet,
        dds,
        strip,
        glow,
        only_sheet,
    })
}

fn existing_model(holder: Node) -> Result<PathBuf> {
    let given = holder.at("target").text().ok_or(Say::NoModel)?;
    paths::existing_file(given, &[".ydr"])
}

/// Модель, её шаги и (в версии 2) имя итогового файла.
struct Job {
    target: PathBuf,
    file: String,
    steps: Vec<Step>,
}

/// Разобранный запрос: одна модель (версия 1) или набор (версия 2).
struct Plan {
    jobs: Vec<Job>,
    many: bool,
}

fn read_item(item: &Value, taken: &mut HashSet<String>) -> Result<Job> {
    let node = Node::of(item);
    node.fields().ok_or(Say::ItemNotObject)?;
    if let Some(key) = stray(node, &ITEM_KEYS) {
        return Err(Say::Stray("элемент", key.clone()).into());
    }
    let file = node
        .at("output")
        .text()
        .unwrap_or_default()
        .trim()
        .to_owned();
    output_name_fits(&file)
        .then_some(())
        .ok_or(Say::OutputName)?;
    if !taken.insert(file.clone()) {
        return Err(Say::OutputTwice(file).into());
    }
    let target = existing_model(node)?;
    let listed = node
        .live("steps")
        .list()
        .filter(|list| (1..=MAX_STEPS).contains(&list.len()))
        .ok_or_else(|| Say::StepCount(file.clone()))?;
    let steps = listed
        .iter()
        .map(|entry| {
            let holder = Node::of(entry);
            holder.fields().ok_or(Say::StepNotObject)?;
            match stray(holder, &STEP_KEYS) {
                Some(key) => Err(Say::Stray("шаг", key.clone()).into()),
                None => read_step(holder),
            }
        })
        .collect::<Result<Vec<_>>>()?;
    let distinct = steps
        .iter()
        .map(|step| step.sheet.as_str())
        .collect::<HashSet<_>>()
        .len()
        == steps.len();
    let separate = steps.len() == 1 || (distinct && steps.iter().all(|step| step.only_sheet));
    separate.then_some(()).ok_or(Say::OwnSheets(file.clone()))?;
    Ok(Job {
        target,
        file,
        steps,
    })
}

fn parse_request(bytes: &[u8]) -> Result<Plan> {
    if !(1..=MAX_REQUEST_BYTES).contains(&bytes.len()) {
        return Err(Say::RequestSize.into());
    }
    let root: Value = serde_json::from_slice(bytes).map_err(|_| Say::Unreadable)?;
    let top = Node::of(&root);
    top.fields().ok_or(Say::NotObject)?;
    if let Some(key) = stray(top, &ROOT_KEYS) {
        return Err(Say::Stray("запрос", key.clone()).into());
    }
    (top.at("format").text() == Some(REQUEST_FORMAT))
        .then_some(())
        .ok_or(Say::Format)?;
    match top.at("version").natural() {
        Some(1) => {
            (bytes.len() <= MAX_SINGLE_BYTES)
                .then_some(())
                .ok_or(Say::SingleSize)?;
            (!top.live("items").some())
                .then_some(())
                .ok_or(Say::SingleItems)?;
            let target = existing_model(top)?;
            let step = read_step(top)?;
            Ok(Plan {
                jobs: vec![Job {
                    target,
                    file: String::new(),
                    steps: vec![step],
                }],
                many: false,
            })
        }
        Some(2) => {
            if let Some(key) = TOP_LEVEL_STEP_KEYS.iter().find(|key| top.live(key).some()) {
                return Err(Say::Inside(key).into());
            }
            let items = top
                .live("items")
                .list()
                .filter(|list| (1..=MAX_ITEMS).contains(&list.len()))
                .ok_or(Say::ItemCount)?;
            let mut taken = HashSet::new();
            let jobs = items
                .iter()
                .map(|item| read_item(item, &mut taken))
                .collect::<Result<Vec<_>>>()?;
            Ok(Plan { jobs, many: true })
        }
        _ => Err(Say::Version.into()),
    }
}

// ---------------------------------------------------------------------------------------------
// Лист из DDS
// ---------------------------------------------------------------------------------------------

/// Четыре байта в начале среза как слово little-endian; короче — None.
fn le32(bytes: &[u8]) -> Option<u32> {
    bytes
        .first_chunk::<4>()
        .map(|chunk| u32::from_le_bytes(*chunk))
}

/// Заголовок DDS: слова по смещению от начала файла.
struct Header<'a>(&'a [u8]);

impl Header<'_> {
    fn word(&self, at: usize) -> u32 {
        le32(&self.0[at..]).expect("в заголовке 128 байт")
    }
}

fn sides_fit(width: u32, height: u32) -> bool {
    [width, height]
        .iter()
        .all(|side| (1..=MAX_SIDE).contains(side))
}

/// Несжатый DDS читается здесь сам: только A8R8G8B8, заголовок почти не проверяется.
fn plain_image(name: &str, header: &Header, payload: &[u8]) -> Result<dds::Dds> {
    const MASKS: [u32; 4] = [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000];
    let masked = [92, 96, 100, 104].map(|place| header.word(place)) == MASKS;
    (header.word(88) == 32 && masked)
        .then_some(())
        .ok_or_else(|| Say::NotArgb(name.to_owned()))?;
    let (width, height) = (header.word(16), header.word(12));
    sides_fit(width, height)
        .then_some(())
        .ok_or_else(|| Say::Sides(name.to_owned()))?;
    let levels = if header.word(8) & 0x2_0000 == 0 {
        1
    } else {
        header.word(28).max(1)
    };
    let expected = payload_bytes(
        Format::A8R8G8B8,
        width as usize,
        height as usize,
        levels as usize,
    );
    (levels <= MAX_UNPACKED_LEVELS && payload.len() == expected)
        .then_some(())
        .ok_or_else(|| Say::DataMismatch(name.to_owned()))?;
    Ok(dds::Dds {
        width,
        height,
        levels: levels as u8,
        format: Format::A8R8G8B8,
        payload: payload.to_vec(),
    })
}

/// Лист для словаря из разобранного DDS: размеры сужаются до `u16`.
fn texture_of(name: &str, image: dds::Dds) -> NewTexture {
    NewTexture {
        name: name.to_owned(),
        width: image.width as u16,
        height: image.height as u16,
        format: image.format,
        levels: image.levels,
        payload: image.payload,
    }
}

/// Лист для модели из DDS; `name` встаёт в `NewTexture.name` и в тексты отказов.
pub(super) fn read_texture(name: &str, path: &Path) -> Result<NewTexture> {
    let bytes = fs::read(path)?;
    let file = Some(bytes.as_slice()).filter(|all| {
        (MIN_DDS_BYTES..=MAX_DDS_BYTES).contains(&all.len()) && all.starts_with(b"DDS ")
    });
    let file = file.ok_or_else(|| Say::NotDds(name.to_owned()))?;
    let header = Header(file);
    let image = match header.word(80) & 0x40 {
        0 => dds::parse(file)?,
        _ => plain_image(name, &header, &file[MIN_DDS_BYTES..])?,
    };
    sides_fit(image.width, image.height)
        .then_some(())
        .ok_or_else(|| Say::Sides(name.to_owned()))?;
    Ok(texture_of(name, image))
}

/// Порядок блоков обеих областей графа: как в нём лежат.
fn orders(graph: &Graph) -> [Vec<usize>; 2] {
    [Segment::System, Segment::Graphics]
        .map(|segment| resource_graph::identity_order(graph, segment))
}

/// Записи словаря текстур, встроенного в граф, в порядке словаря.
pub(super) fn dictionary_entries(graph: &Graph, dictionary: Address) -> Result<Vec<Entry>> {
    let mut part = resource_graph::subgraph(graph, dictionary)?;
    let head = ytd_header(None)?;
    part.declared_version = head.declared_version;
    part.system_flags = head.system_flags;
    part.graphics_flags = head.graphics_flags;
    let [system, graphics] = orders(&part);
    let standalone = resource_graph::rebuild(&part, &system, &graphics)?;
    Ok(ytd_write::read_entries(&standalone)?)
}

// ---------------------------------------------------------------------------------------------
// Проекция
// ---------------------------------------------------------------------------------------------

/// `value >> shift` с округлением к чётному: перед сдвигом прибавляется «почти половина» и младший бит результата.
fn shift_even(value: u32, shift: u32) -> u32 {
    let bias = (1u32 << (shift - 1)) - 1 + ((value >> shift) & 1);
    (value + bias) >> shift
}

/// IEEE 754 binary16 с округлением к чётному; не вмещающееся — бесконечность, NaN сохраняет знак.
fn half_bits(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 31) as u16) << 15;
    let exponent = (bits >> 23) & 0xff;
    let mantissa = bits & 0x007f_ffff;
    let body = match exponent {
        0xff if mantissa != 0 => 0x7e00,
        // от 2^16 и выше, а также сама бесконечность
        143..=0xff => 0x7c00,
        // нормальные: показатель переносится на смещение 15, перенос при округлении уходит в показатель
        113..=142 => shift_even((bits & 0x7fff_ffff) - 0x3800_0000, 13),
        // субнормальные: мантисса с неявной единицей сдвигается на недостающие показатели
        102..=112 => shift_even(mantissa | 0x0080_0000, 126 - exponent),
        _ => 0,
    };
    sign | body as u16
}

/// Параметры шейдера: блок параметров и тип каждой записи.
fn parameter_kinds(graph: &Graph, shader: usize) -> Option<(usize, Vec<u8>)> {
    let params = pointer_block(graph, shader, at::PARAMETERS)?;
    let count = graph
        .content(shader)
        .get(at::PARAMETER_COUNT)
        .copied()
        .map_or(0, usize::from);
    let body = graph.content(params);
    let kinds = (0..count)
        .map(|slot| body.get(slot * at::RECORD).copied().unwrap_or(0))
        .collect();
    Some((params, kinds))
}

/// Берёт ли шейдер лист с таким именем: среди его параметров-текстур есть объект с этим именем.
fn samples_sheet(graph: &Graph, shader: usize, sheet: &str) -> Result<bool> {
    let Some((params, kinds)) = parameter_kinds(graph, shader) else {
        return Ok(false);
    };
    kinds
        .iter()
        .enumerate()
        .filter(|(_, &kind)| kind == KIND_TEXTURE)
        .filter_map(|(slot, _)| {
            pointer_block(graph, params, slot * at::RECORD + at::RECORD_POINTER)
        })
        .try_fold(false, |found, object| {
            Ok(found || texture_name(graph, object)?.eq_ignore_ascii_case(sheet))
        })
}

/// Как лежат вершины геометрии: шаг, места позиции и текстурных координат, тип координат.
struct Vertices {
    stride: usize,
    position: usize,
    uv: usize,
    half: bool,
}

impl Vertices {
    /// Раскладка геометрии; `None` — у вершин нет позиции или текстурных координат.
    fn of(graph: &Graph, buffer: usize) -> Result<Option<Self>> {
        let Some(declaration) = pointer_block(graph, buffer, at::DECLARATION) else {
            return Ok(None);
        };
        let word = |at| u32_at(graph, declaration, at);
        let flags = word(0)?;
        let stride = usize::from(u16_at(graph, declaration, 4)?);
        let types = [word(8)?, word(12)?]
            .iter()
            .rev()
            .fold(0u64, |packed, &half| packed << 32 | u64::from(half));
        let layout = vertex::layout(flags, types)?;
        let (Some(position), Some(uv)) = (layout.get(POSITION), layout.get(UV0)) else {
            return Ok(None);
        };
        (position.type_code == FLOAT3)
            .then_some(())
            .ok_or(Say::PositionKind)?;
        matches!(uv.type_code, FLOAT2 | HALF2)
            .then_some(())
            .ok_or(Say::UvKind)?;
        Ok(Some(Self {
            stride,
            position: position.offset,
            uv: uv.offset,
            half: uv.type_code == HALF2,
        }))
    }

    fn encode(&self, u: f32) -> Vec<u8> {
        if self.half {
            [half_bits(u), half_bits(0.5)]
                .iter()
                .flat_map(|part| part.to_le_bytes())
                .collect()
        } else {
            [u, 0.5]
                .iter()
                .flat_map(|part: &f32| part.to_le_bytes())
                .collect()
        }
    }
}

/// Поток вершин одной геометрии: чтение позиции и запись пары (u, v) по раскладке.
struct Cursor<'a> {
    bytes: &'a mut [u8],
    layout: &'a Vertices,
}

impl Cursor<'_> {
    fn position(&self, index: usize) -> Result<[f32; 3]> {
        let start = index * self.layout.stride + self.layout.position;
        let raw = self
            .bytes
            .get(start..start + 12)
            .ok_or(Say::VertexOutside)?;
        let mut place = [0.0; 3];
        for (slot, chunk) in place.iter_mut().zip(raw.chunks_exact(4)) {
            *slot = f32::from_bits(le32(chunk).expect("по четыре байта"));
        }
        Ok(place)
    }

    fn put_uv(&mut self, index: usize, u: f32) -> Result<()> {
        let start = index * self.layout.stride + self.layout.uv;
        let pair = self.layout.encode(u);
        self.bytes
            .get_mut(start..start + pair.len())
            .ok_or(Say::UvOutside)?
            .copy_from_slice(&pair);
        Ok(())
    }
}

/// Геометрия получает развёртку; возвращает число вершин буфера.
fn project_geometry(graph: &mut Graph, geometry: usize, step: &Step) -> Result<usize> {
    let Some(buffer) = pointer_block(graph, geometry, at::VERTEX_BUFFER) else {
        return Ok(0);
    };
    let Some(vertices) = Vertices::of(graph, buffer)? else {
        return Ok(0);
    };
    let Some(stream_block) = pointer_block(graph, buffer, at::STREAM_FIRST)
        .or_else(|| pointer_block(graph, buffer, at::STREAM_SECOND))
    else {
        return Ok(0);
    };
    let count = u32_at(graph, buffer, at::VERTEX_COUNT)? as usize;
    if count > 0 && vertices.stride == 0 {
        return Err(Say::ZeroStride.into());
    }
    let mut stream = graph.content(stream_block).to_vec();
    let mut cursor = Cursor {
        bytes: &mut stream,
        layout: &vertices,
    };
    (0..count).try_for_each(|index| {
        let place = cursor.position(index)?;
        cursor.put_uv(index, step.strip.along(place))
    })?;
    resource_graph::write_at(graph, stream_block, 0, &stream)?;
    Ok(count)
}

/// Берёт ли шаг геометрию номер `index`: её шейдер по списку соответствий берёт лист шага.
fn takes_geometry(
    graph: &Graph,
    shaders: &[usize],
    mapping: Option<&[u16]>,
    index: usize,
    sheet: &str,
) -> Result<bool> {
    let numbers = mapping.ok_or(Say::NoMapping)?;
    let shader = numbers
        .get(index)
        .and_then(|&number| shaders.get(usize::from(number)))
        .ok_or(Say::ShaderOutside)?;
    samples_sheet(graph, *shader, sheet)
}

/// Места вектора свечения в шейдере: (блок, смещение) каждого вектора с хешем `emissiveMultiplier`.
fn glow_targets(graph: &Graph, shader: usize) -> Result<Vec<(usize, usize)>> {
    let Some((params, kinds)) = parameter_kinds(graph, shader) else {
        return Ok(Vec::new());
    };
    let wanted = joaat("emissiveMultiplier");
    // Таблица хешей лежит за записями и их данными; блок графа её не ограничивает.
    let table = kinds.len() * at::RECORD
        + kinds
            .iter()
            .map(|&kind| 16 * usize::from(kind))
            .sum::<usize>();
    let (segment, start) = (graph.blocks[params].segment, graph.blocks[params].start);
    kinds
        .iter()
        .enumerate()
        .filter(|(_, &kind)| kind == KIND_VECTOR)
        .filter(|(slot, _)| {
            let place = start + table + slot * 4;
            graph.bytes(segment).get(place..).and_then(le32) == Some(wanted)
        })
        .map(|(slot, _)| {
            let target =
                resource_graph::pointer_from(graph, params, slot * at::RECORD + at::RECORD_POINTER)
                    .ok_or(Say::NoGlowData)?;
            let holder = graph.block_at(target).ok_or(Say::GlowOutside)?;
            Ok((holder, target.offset - graph.blocks[holder].start))
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Модель на столе
// ---------------------------------------------------------------------------------------------

/// Граф модели, который правят по шагам.
struct Canvas {
    graph: Graph,
}

impl Canvas {
    fn open(original: &[u8]) -> Result<Self> {
        (1..=MAX_MODEL_BYTES)
            .contains(&original.len())
            .then_some(())
            .ok_or(Say::ModelSize)?;
        let graph = resource_graph::scan(&Resource::parse(original)?)?;
        graph.root().ok_or(Say::NoRoot)?;
        Ok(Self { graph })
    }

    fn root(&self) -> Result<usize> {
        self.graph.root().ok_or_else(|| Say::NoRoot.into())
    }

    fn group(&self) -> Result<usize> {
        pointer_block(&self.graph, self.root()?, at::GROUP).ok_or_else(|| Say::NoGroup.into())
    }

    /// Проекция шага по всем моделям высокой детализации; число переписанных вершин.
    fn project(&mut self, step: &Step) -> Result<usize> {
        let root = self.root()?;
        let shaders = shader_blocks(&self.graph, self.group()?)?;
        let done = high_models(&self.graph, root)?.into_iter().try_fold(
            0,
            |done, model| -> Result<usize> {
                let geometries = geometry_blocks(&self.graph, model)?;
                let mapping = mapping_of(&self.graph, model)?;
                geometries
                    .into_iter()
                    .enumerate()
                    .try_fold(done, |done, (index, geometry)| {
                        let wanted = !step.only_sheet
                            || takes_geometry(
                                &self.graph,
                                &shaders,
                                mapping.as_deref(),
                                index,
                                &step.sheet,
                            )?;
                        match wanted {
                            true => Ok(done + project_geometry(&mut self.graph, geometry, step)?),
                            false => Ok(done),
                        }
                    })
            },
        )?;
        (done > 0)
            .then_some(done)
            .ok_or_else(|| Say::NoVertices.into())
    }

    /// Свечение: вектор `emissiveMultiplier` шейдеров группы (при textureOnly — только берущих лист).
    fn glow(&mut self, step: &Step, value: f32) -> Result<()> {
        let group = self.group()?;
        for shader in shader_blocks(&self.graph, group)? {
            if step.only_sheet && !samples_sheet(&self.graph, shader, &step.sheet)? {
                continue;
            }
            for (holder, relative) in glow_targets(&self.graph, shader)? {
                resource_graph::write_at(&mut self.graph, holder, relative, &value.to_le_bytes())?;
            }
        }
        Ok(())
    }

    /// Лист шага встаёт на место встроенного; затем, если задано, пишется свечение.
    fn exchange(&mut self, step: &Step) -> Result<()> {
        let group = self.group()?;
        let dictionary = resource_graph::pointer_from(&self.graph, group, at::DICTIONARY)
            .ok_or(Say::NoDictionary)?;
        let existing = texture_objects(&self.graph, dictionary)?
            .into_iter()
            .map(|(name, _)| name)
            .find(|name| name.eq_ignore_ascii_case(&step.sheet))
            .ok_or_else(|| Say::NoSheet(step.sheet.clone()))?;
        let texture = read_texture(&existing, &step.dds)?;
        let flags = Flags {
            from: &existing,
            source: None,
            keep_donor: true,
            prefer_dictionary: true,
        };
        embed_sheet(&mut self.graph, group, texture, flags)?;
        match step.glow {
            Some(value) => self.glow(step, value),
            None => Ok(()),
        }
    }

    /// Готовые байты: только то, что достижимо от корня.
    fn into_bytes(self) -> Result<Vec<u8>> {
        let root = self.root()?;
        let compact = resource_graph::subgraph(&self.graph, address_of(&self.graph, root))?;
        let [system, graphics] = orders(&compact);
        Ok(resource_graph::rebuild_with(
            &compact,
            &system,
            &graphics,
            &rage_res::meta_graph::deflate_body,
        )?)
    }
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Описание листа в ответе: имя из модели, размеры, ступени, формат.
fn sheet_card(entry: &Entry) -> Value {
    object([
        ("name", entry.name.clone().into()),
        ("width", entry.width.into()),
        ("height", entry.height.into()),
        ("levels", entry.levels.into()),
        ("format", format!("D3DFMT_{}", entry.format.name()).into()),
    ])
}

/// Записанное читается заново: лист каждого шага обязан найтись в словаре результата.
fn reread_cards(bytes: &[u8], steps: &[Step]) -> Result<Vec<Value>> {
    let graph = resource_graph::scan(&Resource::parse(bytes)?)?;
    let top = graph.root().ok_or(Say::LostRoot)?;
    let dictionary = pointer_block(&graph, top, at::GROUP)
        .ok_or(Say::LostGroup)
        .and_then(|group| {
            resource_graph::pointer_from(&graph, group, at::DICTIONARY).ok_or(Say::LostDictionary)
        })?;
    let entries = dictionary_entries(&graph, dictionary)?;
    steps
        .iter()
        .map(|step| {
            entries
                .iter()
                .find(|entry| entry.name.eq_ignore_ascii_case(&step.sheet))
                .map(sheet_card)
                .ok_or_else(|| Say::LostSheet.into())
        })
        .collect()
}

/// Правит модель `target` по шагам и пишет `output`; возвращает карточку файла для ответа.
fn restyle_file(target: &Path, steps: &[Step], output: &Path) -> Result<Value> {
    let mut canvas = Canvas::open(&fs::read(target)?)?;
    let vertices = steps
        .iter()
        .try_fold(0, |sum, step| canvas.project(step).map(|done| sum + done))?;
    steps.iter().try_for_each(|step| canvas.exchange(step))?;
    let bytes = canvas.into_bytes()?;
    write_atomic(output, &bytes)?;

    let mut cards = reread_cards(&bytes, steps)?;
    let sheets = match cards.len() {
        1 => ("texture", cards.remove(0)),
        _ => ("textures", Value::Array(cards)),
    };
    let file = output
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(object([
        ("file", file.into()),
        ("bytes", bytes.len().into()),
        ("sha256", sha256_hex(&bytes).into()),
        (
            "semantic",
            object([
                ("semanticReopen", true.into()),
                ("vertices", vertices.into()),
                sheets,
            ]),
        ),
    ]))
}

fn restyle_drawable(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))?;
    let plan = parse_request(&fs::read(input)?)?;
    let destination = options.required("output")?;
    let outputs = if plan.many {
        let folder = paths::full_path(destination)?;
        if folder.is_file() {
            return Err(Say::OutputIsFile.into());
        }
        fs::create_dir_all(&folder)?;
        if fs::read_dir(&folder)?.next().is_some() {
            return Err(Say::OutputBusy.into());
        }
        plan.jobs.iter().map(|job| folder.join(&job.file)).collect()
    } else {
        vec![paths::output_file(destination, &[".ydr"])?]
    };
    let mut files = plan
        .jobs
        .iter()
        .zip(&outputs)
        .map(|(job, output)| restyle_file(&job.target, &job.steps, output))
        .collect::<Result<Vec<_>>>()?;
    Ok(match plan.many {
        true => object([
            ("format", REQUEST_FORMAT.into()),
            ("version", 2.into()),
            ("files", files.into()),
        ]),
        false => files.remove(0),
    })
}

const RESTYLE_DRAWABLE: Command = Command::new("restyle-drawable", restyle_drawable);

pub const COMMANDS: &[Command] = &[RESTYLE_DRAWABLE];

#[cfg(test)]
mod tests;
