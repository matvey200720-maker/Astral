//! `decorate-drawable`: украшения на модели оружия (версия запроса 1; версия 2 без частей — под `ASTRAL_RUST_DECORATE_V2`).
//!
//! Студия оружия «украшает» ствол: к кости ствола добавляются сетки с картинкой. Команда находит у места
//! крепления ближайшую вершину на несущей кости, добавляет сетку новой геометрией в каждый уровень детализации,
//! вписывает DDS-лист в словарь текстур модели, добавляет шейдер украшения и пересчитывает маски корзин, рамки
//! геометрий и корень. Версия 2 — это версия 1 плюс ключ `parts` у украшения (лоза, гирлянда, куски развёртки: свои кости и
//! геометрии); приложение шлёт именно её (`weapon-decorations.js`), и без частей она читается как версия 1, но только если в
//! окружении процесса стоит `ASTRAL_RUST_DECORATE_V2` (приложение: `rustDecorateV2Enabled`, умолчание — выключен). Версии 3–4,
//! части, своя модель и модели без скина отдаются хосту отказом со словами «пока на хосте».
//!
//! Устройство: запрос читается стадиями (`Request`), а правка графа модели — свободными функциями над
//! `&mut Graph`, каждая отвечает за свой кусок файла: словарь, шейдеры, уровни, корень.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::env;
use std::ops::RangeInclusive;
use std::{
    fs,
    path::{Path, PathBuf},
};

use rage_res::resource_graph::{self as rg, Address, Graph, Segment, Slot};
use rage_res::{hash, meta_graph, resource::Resource, vertex, ytd_write};
use serde_json::Value;

use super::{fresh_dirs::FreshDirs, graft, shop, split, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

// ---------------------------------------------------------------------------------------------------------------
// Пределы, раскладки и таблицы
// ---------------------------------------------------------------------------------------------------------------

mod limits {
    use std::ops::RangeInclusive;

    pub const DECORATIONS: RangeInclusive<usize> = 1..=12;
    pub const DECORATION_VERTICES: RangeInclusive<usize> = 3..=6000;
    pub const VERTICES: usize = 80_000;
    pub const EMISSIVE: RangeInclusive<f64> = 0.0..=16.0;
    pub const MODEL_BYTES: usize = 64 << 20;
    pub const DDS_BYTES: RangeInclusive<u64> = 128..=2 << 20;
    pub const SIDES: RangeInclusive<u64> = 4..=1024;
}

/// Допуски значений: положение и точка крепления, нормаль, развёртка.
const POSITION_RANGE: RangeInclusive<f64> = -3.0..=3.0;
const NORMAL_RANGE: RangeInclusive<f64> = -1.01..=1.01;
const UV_RANGE: RangeInclusive<f64> = -1.0..=2.0;

mod shape {
    /// Уровни детализации: заголовки списков моделей идут с +0x50 через 8, слова корзин — с +0x80 через 4.
    pub const LEVELS: usize = 4;
    pub const CARRIER_SHARE: f64 = 0.15;
    /// Вершина украшения: положение, веса, номера костей, нормаль, цвет, развёртка.
    pub const STRIDE: usize = 44;
    pub const FLAGS: u32 = 0x5f;
    /// Типы всех слотов декларации, как у каждой геометрии игры (`0x7755555555996996`); прежнее `0x05096996` оставляло старшие слоты нулями.
    pub const TYPES: u64 = 0x7755_5555_5599_6996;
    /// Список параметров шейдера: семь записей по 16 байт, область векторов в 96 байт, семь хэшей.
    pub const PARAMS_BYTES: usize = 236;
    pub const HASHES_AT: usize = 208;
    /// Слова шейдера `+0x14` (записи и данные векторов: 7·16 + 6·16) и `+0x16` — как у хоста и у шейдеров игры с семью строками и шестью
    /// векторами (`z_z_alien.yft`, второй шейдер: 208 и 272). Образец оставлял свои (304 и 384 у оружия) при другой таблице.
    pub const TABLE_LEN: u16 = 208;
    pub const TABLE_FULL: u16 = 272;
}

const REQUEST_FORMAT: &str = "astral.decorate-drawable";
const FOREIGN_KEYS: [&str; 4] = ["parts", "body", "attachments", "replace"];
/// Выключатель запросов версии 2 в окружении процесса движка (приложение: `rustDecorateV2Enabled`, `native-engine-rust.js`).
const V2_ENV: &str = "ASTRAL_RUST_DECORATE_V2";
const NAME_PREFIX: &str = "astral_deco_";
const NAME_BYTES: usize = 14;

/// Имена параметров шейдера украшения: текстура и шесть векторов. Четвёртый вектор зовётся по свечению
/// (`GLOW_NAMES`), его место здесь пусто.
const PARAM_NAMES: [&str; 7] = [
    "DiffuseSampler",
    "matMaterialColorScale",
    "HardAlphaBlend",
    "useTessellation",
    "",
    "globalAnimUV1",
    "globalAnimUV0",
];
/// Значения шести векторов по порядку; четвёртое подставляется по свечению.
const VECTOR_VALUES: [[f32; 4]; 6] = [
    [1.0, 0.0, 0.0, 1.0],
    [1.0, 0.0, 0.0, 0.0],
    [0.0; 4],
    [0.0; 4],
    [0.0, 1.0, 0.0, 0.0],
    [1.0, 0.0, 0.0, 0.0],
];
const GLOW_NAMES: [&str; 2] = ["wetnessMultiplier", "emissiveMultiplier"];
/// Имена шейдера и файлы по (свечение, alpha).
const SHADER_NAMES: [&str; 2] = ["default", "emissive"];
const SHADER_FILES: [[&str; 2]; 2] = [
    ["default.sps", "alpha.sps"],
    ["emissive.sps", "emissive_alpha.sps"],
];

/// Список чисел украшения: ключ, подпись в отказе и кратность длины.
struct Channel {
    key: &'static str,
    label: &'static str,
    per: usize,
}

const POSITIONS: Channel = Channel {
    key: "positions",
    label: "позиции",
    per: 3,
};
const NORMALS: Channel = Channel {
    key: "normals",
    label: "нормали",
    per: 3,
};
const UVS: Channel = Channel {
    key: "uvs",
    label: "UV",
    per: 2,
};

// ---------------------------------------------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------------------------------------------

/// Отказ команды: все тексты модуля идут с одним префиксом.
fn fail(text: &str) -> EngineError {
    EngineError::invalid_data(format!("decorate-drawable: {text}"))
}

/// Отказ «пока на хосте» для версии, частей и моделей без скина.
fn host_only(what: &str) -> EngineError {
    fail(&format!("{what} пока на хосте (движок — версия 1)."))
}

/// Условие или отказ с текстом, который строится лениво.
fn ensure(holds: bool, text: impl FnOnce() -> String) -> Result<()> {
    match holds {
        true => Ok(()),
        false => Err(fail(&text())),
    }
}

/// Объект ответа из пар «ключ, значение» в том же порядке.
fn record<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn follow(graph: &Graph, block: usize, relative: usize) -> Option<usize> {
    split::pointer_block(graph, block, relative)
}

/// Байты `with` ложатся в `bytes` с места `at`.
fn patch(bytes: &mut [u8], at: usize, with: &[u8]) {
    bytes[at..at + with.len()].copy_from_slice(with);
}

fn segment_of(graph: &Graph, block: usize) -> Segment {
    graph.blocks[block].segment
}

fn plain_block(graph: &mut Graph, segment: Segment, bytes: Vec<u8>) -> usize {
    rg::append_block(graph, segment, bytes, Vec::new())
}

/// Указатель блока `block` по смещению `relative` переводится на начало блока `to`.
fn point(graph: &mut Graph, block: usize, relative: usize, to: usize) -> Result<()> {
    let address = split::address_of(graph, to);
    Ok(rg::retarget(graph, block, relative, address)?)
}

/// Список указателей на `items` блоком системного сегмента; указатель владельца по `relative` переходит на него.
fn replace_list(graph: &mut Graph, owner: usize, relative: usize, items: &[usize]) -> Result<()> {
    let (bytes, slots) = split::pointer_list(graph, items);
    let list = rg::append_block(graph, Segment::System, bytes, slots);
    point(graph, owner, relative, list)
}

/// Слова `values` подряд в порядке «младший байт первым».
fn le_bytes<T: Copy, const N: usize>(values: &[T], one: impl Fn(T) -> [u8; N]) -> Vec<u8> {
    values.iter().flat_map(|value| one(*value)).collect()
}

// ---------------------------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------------------------

struct Request {
    model: PathBuf,
    decorations: Vec<Decoration>,
}

struct Decoration {
    name: String,
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u16>,
    anchor: [f64; 3],
    emissive: f64,
    texture: String,
    sha: String,
    width: u64,
    height: u64,
    alpha: bool,
}

/// Поля объекта запроса: мягкие чтения, где нет ключа или не тот тип — запасное значение.
struct Fields<'a>(&'a Value);

impl<'a> Fields<'a> {
    fn text(&self, key: &str) -> Option<&'a str> {
        match self.0.get(key) {
            Some(Value::String(found)) => Some(found.as_str()),
            _ => None,
        }
    }

    fn whole(&self, key: &str) -> u64 {
        match self.0.get(key) {
            Some(Value::Number(found)) => found.as_u64().unwrap_or(0),
            _ => 0,
        }
    }

    fn real(&self, key: &str) -> f64 {
        match self.0.get(key) {
            Some(Value::Number(found)) => found.as_f64().unwrap_or(0.0),
            _ => 0.0,
        }
    }

    fn flag(&self, key: &str) -> bool {
        matches!(self.0.get(key), Some(Value::Bool(true)))
    }
}

/// Слова выключателя — те же, что у переключателей приложения (`on`, `1`, `true`, `yes`).
fn is_on(word: Option<&str>) -> bool {
    matches!(
        word.map(|text| text.trim().to_ascii_lowercase()).as_deref(),
        Some("on" | "1" | "true" | "yes")
    )
}

/// Включены ли запросы версии 2 в окружении этого процесса.
fn v2_enabled() -> bool {
    is_on(env::var(V2_ENV).ok().as_deref())
}

/// Текст запроса: файл читается как UTF-8, не JSON — отказ.
fn read_document(options: &Options) -> Result<Value> {
    let path = options
        .required("input")
        .and_then(|given| paths::existing_file(given, &[".json"]))?;
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|_| fail("запрос не читается."))
}

/// Формат, версия и ключи, которые движок не берёт: версия 1, версия 2 — только с выключателем (`V2_ENV`), остальное — хосту.
fn check_gates(document: &Value, v2: bool) -> Result<()> {
    let top = Fields(document);
    ensure(top.text("format") == Some(REQUEST_FORMAT), || {
        "неизвестный формат запроса.".to_owned()
    })?;
    let version = top.whole("version");
    ensure(version == 1 || (v2 && version == 2), || {
        format!("версия {version} пока на хосте (движок — версия 1).")
    })?;
    // `replace: false` годится; любое другое непустое значение ключа отправляет запрос хосту.
    let filled = |key: &str| match document.get(key) {
        None | Some(Value::Null) => false,
        Some(Value::Bool(false)) => key != "replace",
        Some(_) => true,
    };
    match FOREIGN_KEYS.iter().find(|key| filled(key)) {
        Some(key) => Err(host_only(&format!("«{key}»"))),
        None => Ok(()),
    }
}

fn read_model_path(document: &Value) -> Result<PathBuf> {
    match Fields(document).text("model") {
        Some(model) => paths::existing_file(model, &[".ydr"]),
        None => Err(fail("нет модели.")),
    }
}

/// У украшения есть ключ `parts` со значением, не `null`.
fn has_parts(item: &Value) -> bool {
    !matches!(item.get("parts"), None | Some(Value::Null))
}

fn read_decorations(document: &Value, v2: bool) -> Result<Vec<Decoration>> {
    let list = match document.get("decorations") {
        Some(Value::Array(list)) => list,
        _ => return Err(fail("нет украшений.")),
    };
    ensure(limits::DECORATIONS.contains(&list.len()), || {
        "нужно от 1 до 12 украшений.".to_owned()
    })?;
    // Части украшения (лоза, гирлянда, куски развёртки) — только у версии 2 и только у хоста: у каждой своя кость и своя геометрия.
    if v2 && list.iter().any(has_parts) {
        return Err(fail(
            "части украшения («parts») пока на хосте (движок — версия 1 и версия 2 без частей).",
        ));
    }
    let decorations = list.iter().enumerate().try_fold(
        Vec::with_capacity(list.len()),
        |mut kept, (number, item)| -> Result<Vec<Decoration>> {
            let next = Decoration::read(number, item, &kept)?;
            kept.push(next);
            Ok(kept)
        },
    )?;
    let total = decorations
        .iter()
        .map(|item| item.vertex_count())
        .sum::<usize>();
    ensure(total <= limits::VERTICES, || {
        "вершин больше 80000.".to_owned()
    })?;
    Ok(decorations)
}

impl Request {
    fn load(options: &Options) -> Result<Request> {
        let v2 = v2_enabled();
        let document = read_document(options)?;
        check_gates(&document, v2)?;
        let model = read_model_path(&document)?;
        let decorations = read_decorations(&document, v2)?;
        Ok(Request { model, decorations })
    }
}

/// Числа списка поля: нет массива — одно сообщение, нечисло — другое, длина не по кратности — третье.
fn channel_values(item: &Value, channel: &Channel, number: usize) -> Result<Vec<f32>> {
    let said = |tail: &str| fail(&format!("украшение {number}: {} — {tail}", channel.label));
    let list = match item.get(channel.key) {
        Some(Value::Array(list)) => list,
        _ => return Err(said("нет списка.")),
    };
    let numbers: Option<Vec<f32>> = list
        .iter()
        .map(|entry| entry.as_f64().map(|found| found as f32))
        .collect();
    let values = numbers.ok_or_else(|| said("не числа."))?;
    match values.len() % channel.per {
        0 => Ok(values),
        _ => Err(said(&format!("длина не кратна {}.", channel.per))),
    }
}

/// `astral_deco_` и две ASCII-цифры.
fn is_decoration_name(name: &str) -> bool {
    name.len() == NAME_BYTES
        && name
            .strip_prefix(NAME_PREFIX)
            .is_some_and(|digits| digits.bytes().all(|byte| byte.is_ascii_digit()))
}

fn read_name(item: &Value, earlier: &[Decoration]) -> Result<String> {
    let name = Fields(item).text("name").unwrap_or_default();
    let fresh = !earlier.iter().any(|other| other.name == name);
    ensure(fresh && is_decoration_name(name), || {
        "имена украшений — уникальные astral_deco_NN.".to_owned()
    })?;
    Ok(name.to_owned())
}

/// Индексы треугольников: целые JSON-числа строго меньше числа вершин; длина — не меньше трёх и кратна трём.
fn read_indices(item: &Value, name: &str, count: usize) -> Result<Vec<u16>> {
    let listed = match item.get("indices") {
        Some(Value::Array(list)) => list,
        _ => return Err(fail(&format!("{name} — нет индексов."))),
    };
    let checked: Option<Vec<u16>> = listed
        .iter()
        .map(|entry| {
            let index = usize::try_from(entry.as_u64()?).ok()?;
            (index < count).then_some(index as u16)
        })
        .collect();
    let indices = checked.ok_or_else(|| fail(&format!("{name} — индекс вне вершин.")))?;
    let triangles = !indices.is_empty() && indices.len() % 3 == 0;
    ensure(triangles, || format!("{name} — индексы не треугольники."))?;
    Ok(indices)
}

fn in_range(values: &[f32], range: &RangeInclusive<f64>) -> bool {
    values
        .iter()
        .all(|value| value.is_finite() && range.contains(&f64::from(*value)))
}

/// Точка крепления: ровно три конечных числа в допуске положения.
fn read_anchor(item: &Value, name: &str) -> Result<[f64; 3]> {
    let listed = match item.get("anchor") {
        Some(Value::Array(list)) if list.len() == 3 => list,
        _ => return Err(fail(&format!("{name} — нет точки крепления."))),
    };
    let tolerated = |entry: &Value| {
        entry
            .as_f64()
            .filter(|n| n.is_finite() && POSITION_RANGE.contains(n))
    };
    let found: Option<Vec<f64>> = listed.iter().map(tolerated).collect();
    found
        .and_then(|numbers| <[f64; 3]>::try_from(numbers).ok())
        .ok_or_else(|| fail(&format!("{name} — точка вне допуска.")))
}

impl Decoration {
    fn read(number: usize, item: &Value, earlier: &[Decoration]) -> Result<Decoration> {
        let name = read_name(item, earlier)?;
        let (positions, normals, uvs) = (
            channel_values(item, &POSITIONS, number)?,
            channel_values(item, &NORMALS, number)?,
            channel_values(item, &UVS, number)?,
        );
        let count = positions.len() / 3;
        let shaped = limits::DECORATION_VERTICES.contains(&count)
            && (normals.len(), uvs.len()) == (count * 3, count * 2);
        ensure(shaped, || format!("{name} — сломаны массивы вершин."))?;
        let indices = read_indices(item, &name, count)?;
        let ranges = [
            (&positions, &POSITION_RANGE),
            (&normals, &NORMAL_RANGE),
            (&uvs, &UV_RANGE),
        ];
        let tolerated = ranges.iter().all(|(values, range)| in_range(values, range));
        ensure(tolerated, || format!("{name} — значения вне допуска."))?;
        let anchor = read_anchor(item, &name)?;
        let fields = Fields(item);
        let emissive = fields.real("emissive");
        ensure(limits::EMISSIVE.contains(&emissive), || {
            format!("{name} — свечение вне 0–16.")
        })?;
        let texture = match fields.text("texture") {
            Some(found) => found,
            None => return Err(fail(&format!("{name} — нет текстуры."))),
        };
        Ok(Decoration {
            sha: fields.text("textureSha256").unwrap_or_default().to_owned(),
            width: fields.whole("width"),
            height: fields.whole("height"),
            alpha: fields.flag("alpha"),
            texture: texture.to_owned(),
            name,
            positions,
            normals,
            uvs,
            indices,
            anchor,
            emissive,
        })
    }

    fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// Рамка позиций украшения.
    fn frame(&self) -> ([f32; 3], [f32; 3]) {
        let column = |axis: usize| self.positions.iter().skip(axis).step_by(3).copied();
        let low = [0, 1, 2].map(|axis| column(axis).fold(f32::INFINITY, f32::min));
        let high = [0, 1, 2].map(|axis| column(axis).fold(f32::NEG_INFINITY, f32::max));
        (low, high)
    }

    /// Лист обязан быть DXT5 нужной стороны с полной цепочкой, а хэш файла — тем, что назван в запросе.
    fn check_picture(&self) -> Result<()> {
        let (name, width, height) = (&self.name, self.width, self.height);
        let refusal = |tail: &str| fail(&format!("текстура {name} — {tail}"));
        let size = fs::metadata(&self.texture)?.len();
        if !limits::DDS_BYTES.contains(&size) {
            return Err(refusal("размер файла вне допуска."));
        }
        let sides = [width, height];
        if !sides
            .iter()
            .all(|side| limits::SIDES.contains(side) && side.is_power_of_two())
        {
            return Err(refusal("стороны 4–1024 степенью двойки."));
        }
        let bytes = fs::read(&self.texture)?;
        if !is_full_dxt5(&bytes, width as usize, height as usize) {
            return Err(refusal(&format!(
                "не DXT5 {width}x{height} с полной цепочкой мипов."
            )));
        }
        match format!("sha256:{}", hash::sha256_hex(&bytes)) == self.sha {
            true => Ok(()),
            false => Err(fail(&format!("SHA-256 текстуры {name} не сходится."))),
        }
    }
}

/// Шапка DDS: магия, стороны, число ступеней — полная цепочка, формат `DXT5` и длина ровно по данным ступеней.
fn is_full_dxt5(bytes: &[u8], width: usize, height: usize) -> bool {
    let chain = (usize::BITS - width.max(height).leading_zeros()) as usize;
    let level_bytes = |level: usize| {
        let (across, down) = ((width >> level).max(1), (height >> level).max(1));
        across.div_ceil(4) * down.div_ceil(4) * 16
    };
    let expected = 128 + (0..chain).map(level_bytes).sum::<usize>();
    let word = |at: usize| {
        let part = bytes.get(at..at + 4)?;
        Some(
            part.iter()
                .rev()
                .fold(0usize, |sum, byte| sum << 8 | usize::from(*byte)),
        )
    };
    let header = [(12, height), (16, width), (28, chain)];
    let header_ok = header.iter().all(|&(at, want)| word(at) == Some(want));
    bytes.len() == expected
        && bytes.starts_with(b"DDS ")
        && header_ok
        && bytes.get(84..88) == Some(b"DXT5")
}

fn read_model(path: &Path) -> Result<Vec<u8>> {
    let bytes = fs::read(path)?;
    ensure((1..=limits::MODEL_BYTES).contains(&bytes.len()), || {
        "модель пустая или больше 64 МБ.".to_owned()
    })?;
    Ok(bytes)
}

// ---------------------------------------------------------------------------------------------------------------
// Словарь текстур и шейдеры
// ---------------------------------------------------------------------------------------------------------------

/// Словарь из одного листа приращивается к графу модели; группа получает указатель `+0x08` на его корень.
fn attach_dictionary(graph: &mut Graph, group: usize, sheet: &ytd_write::NewTexture) -> Result<()> {
    let packed = ytd_write::write(std::slice::from_ref(sheet))?;
    let parsed = Resource::parse(&packed)?;
    let fresh = rg::scan(&parsed)?;
    let (mut grown, dictionary) = rg::graft(graph, &fresh)?;
    let link = Slot {
        target: dictionary,
        relative: 0x08,
    };
    grown.blocks[group].slots.extend([link]);
    *graph = grown;
    Ok(())
}

/// Имя образца в словаре модели, где уже есть текстуры: занятые имена украшений отказывают.
fn dictionary_sample(
    graph: &Graph,
    dictionary: Address,
    decorations: &[Decoration],
) -> Result<String> {
    let objects = shop::texture_objects(graph, dictionary)?;
    let clash = decorations.iter().find(|item| {
        objects
            .iter()
            .any(|(have, _)| have.eq_ignore_ascii_case(&item.name))
    });
    if let Some(item) = clash {
        return Err(fail(&format!("у модели уже есть текстура {}.", item.name)));
    }
    // Образец служебных полей — первая текстура словаря, под её именем из словаря.
    let sample = objects.into_iter().map(|(sample, _)| sample).next();
    sample.ok_or_else(|| fail("в словаре модели нет текстур-образцов."))
}

/// Словарь модели: проверяется на занятые имена или создаётся из первого листа; остальные листы вписываются в него.
/// Возвращает адреса текстур по именам в нижнем регистре.
fn settle_dictionary(
    graph: &mut Graph,
    group: usize,
    decorations: &[Decoration],
    sheets: Vec<ytd_write::NewTexture>,
) -> Result<HashMap<String, Address>> {
    let mut pending = sheets.into_iter();
    let existing = follow(graph, group, 0x08).map(|block| split::address_of(graph, block));
    let template = match existing {
        Some(dictionary) => dictionary_sample(graph, dictionary, decorations)?,
        None => {
            let first = pending.next().ok_or_else(|| fail("нет украшений."))?;
            attach_dictionary(graph, group, &first)?;
            first.name
        }
    };
    for sheet in pending {
        let flags = shop::Flags {
            from: &template,
            source: None,
            keep_donor: false,
            prefer_dictionary: true,
        };
        shop::embed_sheet(graph, group, sheet, flags)?;
    }
    let dictionary = follow(graph, group, 0x08)
        .map(|block| split::address_of(graph, block))
        .ok_or_else(|| fail("у группы нет словаря текстур."))?;
    let mut by_name = HashMap::new();
    for (name, address) in shop::texture_objects(graph, dictionary)? {
        by_name.insert(name.to_lowercase(), address);
    }
    Ok(by_name)
}

/// Параметры шейдера украшения: шесть блоков значений векторов и список на 236 байт с их указателями.
fn params_block(graph: &mut Graph, decoration: &Decoration, texture: Address) -> usize {
    let glow = decoration.emissive > 0.0;
    let mut values = VECTOR_VALUES;
    values[3][0] = if glow {
        decoration.emissive as f32
    } else {
        1.0
    };
    let mut names = PARAM_NAMES;
    names[4] = GLOW_NAMES[usize::from(glow)];
    let mut params = vec![0u8; shape::PARAMS_BYTES];
    let mut slots = vec![Slot {
        relative: 8,
        target: texture,
    }];
    let blocks = values
        .iter()
        .map(|value| plain_block(graph, Segment::System, le_bytes(value, f32::to_le_bytes)))
        .collect::<Vec<_>>();
    for (record_at, block) in (1..).map(|number| number * 16).zip(blocks) {
        params[record_at] = 1;
        slots.push(Slot {
            relative: record_at + 8,
            target: split::address_of(graph, block),
        });
    }
    names.iter().enumerate().for_each(|(number, name)| {
        let word = hash::joaat(name).to_le_bytes();
        patch(&mut params, shape::HASHES_AT + number * 4, &word);
    });
    rg::append_block(graph, Segment::System, params, slots)
}

/// Блок шейдера украшения: параметры, затем сам шейдер на образце.
fn build_shader(
    graph: &mut Graph,
    decoration: &Decoration,
    texture: Address,
    template: usize,
) -> Result<usize> {
    let params = params_block(graph, decoration, texture);
    let kind = usize::from(decoration.emissive > 0.0);
    let file = SHADER_FILES[kind][usize::from(decoration.alpha)];
    let mut bytes = Vec::from(graph.content(template));
    patch(
        &mut bytes,
        0x08,
        &hash::joaat(SHADER_NAMES[kind]).to_le_bytes(),
    );
    patch(&mut bytes, 0x18, &hash::joaat(file).to_le_bytes());
    patch(&mut bytes, 0x10, &[7, u8::from(decoration.alpha)]);
    // длины таблицы параметров и маска корзины шейдера — по самому шейдеру, а не по образцу (хост и игра: `0xff00 | 1 << корзина`)
    patch(&mut bytes, 0x14, &shape::TABLE_LEN.to_le_bytes());
    patch(&mut bytes, 0x16, &shape::TABLE_FULL.to_le_bytes());
    patch(&mut bytes, 0x20, &(0xFF00u32 | 1 << u32::from(decoration.alpha)).to_le_bytes());
    let link = Relink::required(0, params, "нет указателя параметров шейдера.");
    let slots = relinked(graph, template, &[link])?;
    let segment = segment_of(graph, template);
    Ok(rg::append_block(graph, segment, bytes, slots))
}

/// Шейдеры украшений и новый список шейдеров группы. Возвращает номер первого нового шейдера.
fn add_shaders(
    graph: &mut Graph,
    group: usize,
    decorations: &[Decoration],
    textures: &HashMap<String, Address>,
) -> Result<usize> {
    let list = follow(graph, group, 0x10).ok_or_else(|| fail("у группы нет списка шейдеров."))?;
    let count = usize::from(split::u16_at(graph, group, 0x18)?);
    let mut shaders = (0..count)
        .map(|slot| follow(graph, list, slot * 8).ok_or_else(|| fail("пустой шейдер в списке.")))
        .collect::<Result<Vec<usize>>>()?;
    let template = *shaders
        .first()
        .ok_or_else(|| fail("у модели нет шейдеров."))?;
    let first_new = shaders.len();
    for decoration in decorations {
        let texture = *textures
            .get(&decoration.name.to_lowercase())
            .ok_or_else(|| fail("у модели нет текстуры украшения."))?;
        let shader = build_shader(graph, decoration, texture, template)?;
        shaders.push(shader);
    }
    replace_list(graph, group, 0x10, &shaders)?;
    set_u16(graph, group, 0x18, shaders.len() as u16)?;
    // ёмкость списка равна числу, как у игры и у хоста (образец оставлял прежнюю, меньшую)
    set_u16(graph, group, 0x1a, shaders.len() as u16)?;
    Ok(first_new)
}

// ---------------------------------------------------------------------------------------------------------------
// Вершины с весами, несущие кости и ближайшая вершина
// ---------------------------------------------------------------------------------------------------------------

type Point = [f32; 3];

struct Weighted {
    geometry: usize,
    bone: u16,
    slot: u8,
    position: Point,
}

/// Несущие кости: у которых вершин не меньше порога; нет таких — одна, за которой больше всего вершин.
fn carrier_bones(weighted: &[Weighted]) -> Vec<u16> {
    // Кости с числом их вершин, в порядке первого появления.
    let mut census: Vec<(u16, usize)> = Vec::new();
    for vertex in weighted {
        match census.iter_mut().find(|(bone, _)| *bone == vertex.bone) {
            Some((_, seen)) => *seen += 1,
            None => census.push((vertex.bone, 1)),
        }
    }
    let share = (weighted.len() as f64 * shape::CARRIER_SHARE).ceil();
    let threshold = usize::max(1, share as usize);
    let heavy = census
        .iter()
        .filter_map(|&(bone, seen)| (seen >= threshold).then_some(bone))
        .collect::<Vec<_>>();
    match heavy.is_empty() {
        false => heavy,
        // Побеждает первая из равных: у `max_by_key` при равенстве последняя, поэтому обход с конца.
        true => census
            .iter()
            .rev()
            .max_by_key(|(_, seen)| *seen)
            .map_or_else(Vec::new, |(bone, _)| vec![*bone]),
    }
}

/// Ближайшая к точке крепления вершина на несущих костях; расстояние в квадрате, в `f32`; при равенстве — первая.
fn nearest_vertex<'a>(
    weighted: &'a [Weighted],
    carriers: &[u16],
    anchor: [f64; 3],
) -> Option<&'a Weighted> {
    let anchor = anchor.map(|value| value as f32);
    let distance = |vertex: &Weighted| {
        let [dx, dy, dz] = [0, 1, 2].map(|axis| vertex.position[axis] - anchor[axis]);
        dx * dx + dy * dy + dz * dz
    };
    let nearest = weighted
        .iter()
        .filter(|vertex| carriers.contains(&vertex.bone))
        .fold(None, |best: Option<(&Weighted, f32)>, vertex| {
            let here = distance(vertex);
            match best {
                Some((_, closest)) if closest.partial_cmp(&here) != Some(Ordering::Greater) => best,
                _ => Some((vertex, here)),
            }
        });
    nearest.map(|(vertex, _)| vertex)
}

/// Числа `f32` байтами, младший байт первым.
fn float_bytes(values: &[f32]) -> impl Iterator<Item = u8> + '_ {
    values.iter().flat_map(|value| value.to_le_bytes())
}

/// Вершины украшения по 44 байта: положение, веса, номера костей, нормаль, цвет, развёртка.
fn vertex_bytes(slot: u8, item: &Decoration) -> Vec<u8> {
    let skin = [0, 0, 0xff, 0, 0, 0, slot, 0];
    let rows = item
        .positions
        .chunks_exact(3)
        .zip(item.normals.chunks_exact(3))
        .zip(item.uvs.chunks_exact(2));
    rows.flat_map(|((position, normal), uv)| {
        float_bytes(position)
            .chain(skin)
            .chain(float_bytes(normal))
            .chain([0xff; 4])
            .chain(float_bytes(uv))
    })
    .collect()
}

/// Запись рамки геометрии: минимум и максимум позиций, в четвёртых компонентах — X.
fn frame_record(item: &Decoration) -> [u8; 32] {
    let (low, high) = item.frame();
    let packed: Vec<u8> = [low, high]
        .into_iter()
        .flat_map(|[x, y, z]| [x, y, z, x])
        .flat_map(f32::to_le_bytes)
        .collect();
    std::array::from_fn(|at| packed[at])
}

// ---------------------------------------------------------------------------------------------------------------
// Уровни детализации
// ---------------------------------------------------------------------------------------------------------------

/// Что сделали украшения по уровням.
#[derive(Default)]
struct Tally {
    lods: usize,
    geometries: usize,
    vertices: usize,
    bones: usize,
}

/// Общее для всех уровней: украшения, номер первого нового шейдера и маска корзин украшений.
struct Shared<'a> {
    decorations: &'a [Decoration],
    first_shader: usize,
    mask: u16,
}

/// Первая модель списка уровня и её геометрии; `None`, если уровня нет, в нём ноль моделей или геометрий.
fn level_geometries(
    graph: &Graph,
    root: usize,
    level: usize,
) -> Result<Option<(usize, Vec<usize>)>> {
    let header = match follow(graph, root, 0x50 + level * 8) {
        Some(header) if split::u16_at(graph, header, 8)? != 0 => header,
        _ => return Ok(None),
    };
    let model = follow(graph, header, 0)
        .ok_or_else(|| fail("список моделей без записей."))
        .and_then(|list| follow(graph, list, 0).ok_or_else(|| fail("пустая модель.")))?;
    let geometries = split::geometry_blocks(graph, model)?;
    Ok(match geometries.is_empty() {
        true => None,
        false => Some((model, geometries)),
    })
}

/// Буфер вершин геометрии и раскладка по его декларации; `None` — нет буфера или декларации.
fn layout_of(graph: &Graph, geometry: usize) -> Result<Option<(usize, vertex::Layout)>> {
    let chain = follow(graph, geometry, 0x18)
        .and_then(|buffer| follow(graph, buffer, 0x30).map(|declaration| (buffer, declaration)));
    let Some((buffer, declaration)) = chain else {
        return Ok(None);
    };
    let (flags, low, high) = (
        split::u32_at(graph, declaration, 0)?,
        split::u32_at(graph, declaration, 8)?,
        split::u32_at(graph, declaration, 12)?,
    );
    let types = u64::from(low) | u64::from(high) << 32;
    Ok(Some((buffer, vertex::layout(flags, types)?)))
}

/// Первая геометрия уровня обязана быть со скином: в декларации есть веса и номера костей.
fn require_skin(graph: &Graph, geometry: usize) -> Result<()> {
    let buffer =
        follow(graph, geometry, 0x18).ok_or_else(|| fail("геометрия без буфера вершин."))?;
    ensure(follow(graph, buffer, 0x30).is_some(), || {
        "буфер вершин без декларации.".to_owned()
    })?;
    let layout = layout_of(graph, geometry)?;
    let skinned = layout.is_some_and(|(_, found)| {
        found.get(vertex::BLEND_WEIGHTS).is_some() && found.get(vertex::BLEND_INDICES).is_some()
    });
    if skinned {
        return Ok(());
    }
    Err(host_only("модель без скина"))
}

/// Палитра костей геометрии: кость по номеру слота.
type Palette = Vec<u16>;

/// Палитра костей геометрии; блок короче заявленного — палитра пуста.
fn palette_of(graph: &Graph, geometry: usize) -> Result<Palette> {
    let words_in = |block: usize| -> Result<Palette> {
        let wanted = usize::from(split::u16_at(graph, geometry, 0x72)?) * 2;
        let head = graph.content(block).get(..wanted).unwrap_or_default();
        Ok(head
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect())
    };
    let palette = follow(graph, geometry, 0x68).map(words_in).transpose()?;
    Ok(palette.unwrap_or_default())
}

/// Поток вершин геометрии со скином: где лежит, шаг и число вершин, элементы (положение, веса, номера костей) и палитра.
struct Skinned {
    stream: usize,
    stride: usize,
    count: usize,
    elements: [vertex::Element; 3],
    palette: Palette,
}

/// Поток геометрии, если у неё есть буфер, нужные элементы, палитра и шаг; иначе `None`.
fn skinned_stream(graph: &Graph, geometry: usize) -> Result<Option<Skinned>> {
    let (buffer, layout) = match layout_of(graph, geometry)? {
        Some(found) => found,
        None => return Ok(None),
    };
    let found = [
        layout.get(vertex::POSITION),
        layout.get(vertex::BLEND_WEIGHTS),
        layout.get(vertex::BLEND_INDICES),
    ];
    let [Some(position), Some(weights), Some(indices)] = found else {
        return Ok(None);
    };
    let palette = palette_of(graph, geometry)?;
    let usable = position.offset == 0 && !palette.is_empty();
    let Some(stream) = follow(graph, buffer, 0x10).filter(|_| usable) else {
        return Ok(None);
    };
    let stride = usize::from(split::u16_at(graph, buffer, 0x08)?);
    let count = split::u32_at(graph, buffer, 0x18)? as usize;
    Ok((stride != 0).then_some(Skinned {
        stream,
        stride,
        count,
        elements: [position, weights, indices],
        palette,
    }))
}

/// Номер самого весомого веса среди четырёх; при равных — первый.
fn heaviest_of(weights: &[u8]) -> usize {
    (1..weights.len()).fold(0, |best, at| match weights[at] > weights[best] {
        true => at,
        false => best,
    })
}

impl Skinned {
    /// Вершины с самым весомым весом: положение, номер в палитре, кость и номер геометрии.
    fn vertices(&self, graph: &Graph, number: usize) -> Vec<Weighted> {
        let [position, weights, indices] = self.elements;
        let rows = graph
            .content(self.stream)
            .chunks_exact(self.stride)
            .take(self.count);
        rows.filter_map(|row| {
            let weight_bytes = row.get(weights.offset..weights.offset + 4)?;
            let index_bytes = row.get(indices.offset..indices.offset + 4)?;
            let mut point: Point = [0.0; 3];
            if !vertex::read_components(row, position, &mut point) {
                return None;
            }
            let slot = index_bytes[heaviest_of(weight_bytes)];
            let bone = *self.palette.get(usize::from(slot))?;
            Some(Weighted {
                geometry: number,
                bone,
                slot,
                position: point,
            })
        })
        .collect()
    }
}

/// Вершины одной геометрии; геометрия без скина ничего не даёт.
fn geometry_vertices(graph: &Graph, geometry: usize, number: usize) -> Result<Vec<Weighted>> {
    Ok(match skinned_stream(graph, geometry)? {
        Some(skin) => skin.vertices(graph, number),
        None => Vec::new(),
    })
}

/// Слот блока-источника, который надо перевести на новый блок; `missing` — отказ, если слота нет (`None` — не обязателен).
struct Relink {
    at: usize,
    to: usize,
    missing: Option<&'static str>,
}

impl Relink {
    /// Слот обязан быть: нет его — отказ с этим текстом.
    fn required(at: usize, to: usize, text: &'static str) -> Self {
        Relink {
            at,
            to,
            missing: Some(text),
        }
    }

    /// Слот может отсутствовать.
    fn optional(at: usize, to: usize) -> Self {
        Relink {
            at,
            to,
            missing: None,
        }
    }
}

/// Слоты блока: указатели с целями.
type Slots = Vec<Slot>;

/// Слоты блока `source` с переведёнными целями.
fn relinked(graph: &Graph, source: usize, relinks: &[Relink]) -> Result<Slots> {
    let mut slots = graph.blocks[source].slots.clone();
    relinks.iter().try_for_each(|relink| {
        let found = slots.iter_mut().find(|slot| slot.relative == relink.at);
        match (found, relink.missing) {
            (Some(slot), _) => {
                slot.target = split::address_of(graph, relink.to);
                Ok(())
            }
            (None, Some(text)) => Err(fail(text)),
            (None, None) => Ok(()),
        }
    })?;
    Ok(slots)
}

/// Блок-копия `source`: правки байтов `(место, байты)` и переведённые указатели; лежит в сегменте источника.
fn clone_block(
    graph: &mut Graph,
    source: usize,
    edits: &[(usize, &[u8])],
    relinks: &[Relink],
) -> Result<usize> {
    let mut bytes = Vec::from(graph.content(source));
    for &(at, with) in edits {
        patch(&mut bytes, at, with);
    }
    let slots = relinked(graph, source, relinks)?;
    let segment = segment_of(graph, source);
    Ok(rg::append_block(graph, segment, bytes, slots))
}

/// Декларация вершин украшения: флаги, шаг, нулевой байт, число занятых слотов (байт `+7`, как у декларации игры) и типы — 16 байт.
fn declaration_bytes() -> Vec<u8> {
    [
        &shape::FLAGS.to_le_bytes()[..],
        &(shape::STRIDE as u16).to_le_bytes(),
        &[0, shape::FLAGS.count_ones() as u8],
        &shape::TYPES.to_le_bytes(),
    ]
    .concat()
}

/// Палитра новой геометрии: значения палитры ближайшей геометрии целиком, без добивки блока-источника;
/// у ближайшей палитры нет — одна кость ближайшей вершины. Возвращает блок и число костей.
fn palette_block(
    graph: &mut Graph,
    home: Segment,
    near_geometry: usize,
    near: &Weighted,
) -> Result<(usize, u16)> {
    let copied = follow(graph, near_geometry, 0x68)
        .map(|block| -> Result<(Segment, Vec<u8>, u16)> {
            let count = split::u16_at(graph, near_geometry, 0x72)?;
            let words = graph.content(block)[..usize::from(count) * 2].to_vec();
            Ok((segment_of(graph, block), words, count))
        })
        .transpose()?;
    let (segment, words, count) =
        copied.unwrap_or_else(|| (home, near.bone.to_le_bytes().to_vec(), 1));
    Ok((plain_block(graph, segment, words), count))
}

/// Новая геометрия украшения на основе шаблона `template`: семь блоков в порядке, который задаёт раскладку файла.
fn add_geometry(
    graph: &mut Graph,
    template: usize,
    near_geometry: usize,
    item: &Decoration,
    near: &Weighted,
) -> Result<usize> {
    let buffer =
        follow(graph, template, 0x18).ok_or_else(|| fail("нет указателя буфера вершин."))?;
    let index_buffer =
        follow(graph, template, 0x38).ok_or_else(|| fail("геометрия без буфера индексов."))?;
    let home = segment_of(graph, template);
    // 1. декларация
    let declaration = plain_block(graph, home, declaration_bytes());
    // 2. данные вершин
    let stream_home = follow(graph, buffer, 0x10).map_or(home, |stream| segment_of(graph, stream));
    let data = plain_block(graph, stream_home, vertex_bytes(near.slot, item));
    // 3. буфер вершин
    let stride = u16::to_le_bytes(shape::STRIDE as u16);
    let count = u32::to_le_bytes(item.vertex_count() as u32);
    let vertex_buffer = clone_block(
        graph,
        buffer,
        &[(0x08, &stride[..]), (0x18, &count[..])],
        &[
            Relink::required(0x30, declaration, "нет указателя декларации."),
            Relink::required(0x10, data, "нет указателя вершин."),
            Relink::optional(0x20, data),
        ],
    )?;
    // 4. данные индексов
    let index_home = match follow(graph, index_buffer, 0x10) {
        Some(data) => segment_of(graph, data),
        None => segment_of(graph, index_buffer),
    };
    let index_data = plain_block(graph, index_home, le_bytes(&item.indices, u16::to_le_bytes));
    // 5. буфер индексов
    let total = (item.indices.len() as u32).to_le_bytes();
    let index_block = clone_block(
        graph,
        index_buffer,
        &[(0x08, &total[..])],
        &[Relink::required(
            0x10,
            index_data,
            "нет указателя индексов.",
        )],
    )?;
    // 6. палитра костей
    let (palette, bones) = palette_block(graph, home, near_geometry, near)?;
    // 7. геометрия: игра рисует по счётчикам самого блока геометрии (индексы `+0x58`, треугольники `+0x5c`, вершины `+0x60` и шаг `+0x70`,
    // по младшим 16 битам) и по указателю данных вершин `+0x78`, а не по буферам; копия образца оставляла образцовые числа и данные образца
    // (19.11.2026: так пропала гирлянда столба, у украшения оружия то же)
    let bones = bones.to_le_bytes();
    let indices = (item.indices.len() as u32).to_le_bytes();
    let triangles = ((item.indices.len() / 3) as u32).to_le_bytes();
    let vertices = (item.vertex_count() as u16).to_le_bytes();
    let relinks = [
        Relink::required(0x18, vertex_buffer, "нет указателя буфера вершин."),
        Relink::required(0x38, index_block, "нет указателя буфера индексов."),
        Relink::required(0x68, palette, "нет указателя палитры костей."),
        Relink::optional(0x78, data),
    ];
    let edits: [(usize, &[u8]); 5] = [(0x58, &indices[..]), (0x5c, &triangles[..]), (0x60, &vertices[..]), (0x70, &stride[..]), (0x72, &bones[..])];
    clone_block(graph, template, &edits, &relinks)
}

/// Слово блока по смещению `at` заменяется значением.
fn set_u16(graph: &mut Graph, block: usize, at: usize, value: u16) -> Result<()> {
    Ok(rg::write_at(graph, block, at, &value.to_le_bytes())?)
}

/// К слову блока по смещению `at` добавляются биты `bits`.
fn merge_u16(graph: &mut Graph, block: usize, at: usize, bits: u16) -> Result<()> {
    let merged = split::u16_at(graph, block, at)? | bits;
    set_u16(graph, block, at, merged)
}

fn merge_u32(graph: &mut Graph, block: usize, at: usize, bits: u32) -> Result<()> {
    let merged = split::u32_at(graph, block, at)? | bits;
    Ok(rg::write_at(graph, block, at, &merged.to_le_bytes())?)
}

/// Новые списки модели уровня: геометрии, соответствие шейдеров, рамки и маска корзин украшений.
struct Grown<'a> {
    model: usize,
    level: usize,
    geometries: &'a [usize],
    mapping: &'a [u16],
    records: &'a [[u8; 32]],
    mask: u16,
}

/// Списки модели уровня заменяются на длиннее: геометрии, соответствие шейдеров, число, маски и рамки.
fn close_level(graph: &mut Graph, root: usize, grown: &Grown) -> Result<()> {
    let model = grown.model;
    let total = grown.geometries.len() as u16;
    replace_list(graph, model, 0x08, grown.geometries)?;
    let table = le_bytes(grown.mapping, u16::to_le_bytes);
    let table = plain_block(graph, Segment::System, table);
    point(graph, model, 0x20, table)?;
    for at in [0x10, 0x12, 0x2E] {
        set_u16(graph, model, at, total)?;
    }
    merge_u16(graph, model, 0x2C, grown.mask)?;
    let bounds = graft::bounds_bytes(grown.records);
    let bounds = plain_block(graph, Segment::System, bounds);
    point(graph, model, 0x18, bounds)?;
    merge_u32(graph, root, 0x80 + grown.level * 4, u32::from(grown.mask))
}

/// Один засчитанный уровень: украшения садятся на ближайшие вершины несущих костей.
fn decorate_level(
    graph: &mut Graph,
    root: usize,
    (level, model, geometries): (usize, usize, Vec<usize>),
    shared: &Shared,
    tally: &mut Tally,
) -> Result<()> {
    // Вершины всех геометрий уровня по порядку геометрий.
    let weighted = geometries.iter().enumerate().try_fold(
        Vec::new(),
        |mut found, (number, &geometry)| -> Result<Vec<Weighted>> {
            found.extend(geometry_vertices(graph, geometry, number)?);
            Ok(found)
        },
    )?;
    let carriers = carrier_bones(&weighted);
    let nearest = shared
        .decorations
        .iter()
        .map(|item| nearest_vertex(&weighted, &carriers, item.anchor))
        .collect::<Option<Vec<&Weighted>>>()
        .ok_or_else(|| fail("скинутая модель — нет взвешенной вершины у украшения."))?;
    let mut mapping =
        split::mapping_of(graph, model)?.ok_or_else(|| fail("у уровня нет шейдеров."))?;
    let mut records = graft::records_of(graph, model)?;
    let mut all = geometries.clone();
    let additions = shared
        .decorations
        .iter()
        .zip(nearest)
        .enumerate()
        .map(|(number, (item, near))| -> Result<(usize, u16, [u8; 32])> {
            let template = geometries[0];
            let added = add_geometry(graph, template, geometries[near.geometry], item, near)?;
            Ok((
                added,
                (shared.first_shader + number) as u16,
                frame_record(item),
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    for (geometry, shader, frame) in additions {
        all.push(geometry);
        mapping.push(shader);
        records.push(frame);
    }
    let count = shared.decorations.len();
    tally.geometries += count;
    tally.bones += count;
    tally.vertices += shared
        .decorations
        .iter()
        .map(Decoration::vertex_count)
        .sum::<usize>();
    let grown = Grown {
        model,
        level,
        geometries: &all,
        mapping: &mapping,
        records: &records,
        mask: shared.mask,
    };
    close_level(graph, root, &grown)
}

/// Все уровни детализации по порядку; уровень без геометрии пропускается.
fn decorate_levels(
    graph: &mut Graph,
    root: usize,
    decorations: &[Decoration],
    first_shader: usize,
) -> Result<Tally> {
    let mask = decorations
        .iter()
        .fold(0u16, |mask, item| mask | 1 << u16::from(item.alpha));
    let shared = Shared {
        decorations,
        first_shader,
        mask,
    };
    (0..shape::LEVELS).try_fold(Tally::default(), |mut tally, level| {
        if let Some((model, geometries)) = level_geometries(graph, root, level)? {
            require_skin(graph, geometries[0])?;
            tally.lods += 1;
            decorate_level(graph, root, (level, model, geometries), &shared, &mut tally)?;
        }
        Ok(tally)
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Корень и сборка
// ---------------------------------------------------------------------------------------------------------------

/// Рамка украшений вместе с рамкой корня; центр, радиус и рамка пишутся в корень.
fn fit_root(graph: &mut Graph, root: usize, decorations: &[Decoration]) -> Result<(Point, Point)> {
    let content = graph.content(root);
    let read = |at: usize| [0, 4, 8].map(|step| graft::read_f32(content, at + step));
    let (low, high) = decorations.iter().map(Decoration::frame).fold(
        (read(0x30), read(0x40)),
        |(low, high), (item_low, item_high)| {
            (
                [0, 1, 2].map(|axis| low[axis].min(item_low[axis])),
                [0, 1, 2].map(|axis| high[axis].max(item_high[axis])),
            )
        },
    );
    let centre = [0, 1, 2].map(|axis| (low[axis] + high[axis]) / 2.0);
    let [dx, dy, dz] = [0, 1, 2].map(|axis| high[axis] - low[axis]);
    let radius = (dx * dx + dy * dy + dz * dz).sqrt() / 2.0;
    let writes = [
        (0x20, graft::floats(&centre)),
        (0x2C, radius.to_le_bytes().to_vec()),
        (0x30, graft::floats(&low)),
        (0x40, graft::floats(&high)),
    ];
    for (at, bytes) in &writes {
        rg::write_at(graph, root, *at, bytes)?;
    }
    Ok((low, high))
}

/// Достижимое из корня, порядок блоков как есть.
fn finish(graph: &Graph) -> Result<Vec<u8>> {
    let root = Address {
        segment: Segment::System,
        offset: 0,
    };
    let part = rg::subgraph(graph, root)?;
    let (system, graphics) = (
        rg::identity_order(&part, Segment::System),
        rg::identity_order(&part, Segment::Graphics),
    );
    Ok(rg::rebuild_with(
        &part,
        &system,
        &graphics,
        &meta_graph::deflate_body,
    )?)
}

/// Корень модели и группа шейдеров на его +0x10.
fn locate(graph: &Graph) -> Result<(usize, usize)> {
    match graph.root() {
        None => Err(fail("у модели нет корня.")),
        Some(root) => match follow(graph, root, 0x10) {
            Some(group) => Ok((root, group)),
            None => Err(fail("у модели нет группы шейдеров.")),
        },
    }
}

/// Выход команды: страж созданных папок и путь к `.ydr`.
/// Папка выхода создаётся здесь; отказ дальше убирает созданное, пока оно пусто.
fn claim_output(options: &Options) -> Result<(FreshDirs, PathBuf)> {
    let guard = FreshDirs::beside(options.required("output"));
    let target = options
        .required("output")
        .and_then(|given| paths::output_file(given, &[".ydr"]))?;
    Ok((guard, target))
}

/// Модель читается, листы украшений проверяются, граф собирается; граф, корень и группа шейдеров.
fn open_model(request: &Request) -> Result<(Graph, usize, usize)> {
    let bytes = read_model(&request.model)?;
    request
        .decorations
        .iter()
        .try_for_each(Decoration::check_picture)?;
    let parsed = Resource::parse(&bytes)?;
    let graph = rg::scan(&parsed)?;
    let (root, group) = locate(&graph)?;
    Ok((graph, root, group))
}

/// Ответ команды: что сделано, имена украшений и рамка модели.
fn report(
    output: &Path,
    tally: &Tally,
    bounds: (Point, Point),
    written: usize,
    names: &[&str],
) -> Value {
    let corner = |point: Point| point.map(f64::from).to_vec();
    record([
        ("output", output.display().to_string().into()),
        ("lods", tally.lods.into()),
        ("geometries", tally.geometries.into()),
        ("vertices", tally.vertices.into()),
        ("textures", names.into()),
        ("bones", tally.bones.into()),
        (
            "bounds",
            record([
                ("min", corner(bounds.0).into()),
                ("max", corner(bounds.1).into()),
            ]),
        ),
        ("outputBytes", written.into()),
    ])
}

fn decorate_drawable(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = Request::load(options)?;
    let (fresh, output) = claim_output(options)?;
    let (mut graph, root, group) = open_model(&request)?;
    let decorations = request.decorations.as_slice();
    let sheets = decorations
        .iter()
        .map(|item| shop::texture_of(&item.name, Path::new(&item.texture)))
        .collect::<Result<Vec<_>>>()?;
    let textures = settle_dictionary(&mut graph, group, decorations, sheets)?;
    let first_shader = add_shaders(&mut graph, group, decorations, &textures)?;
    let tally = decorate_levels(&mut graph, root, decorations, first_shader)?;
    ensure(tally.lods > 0, || {
        "у модели нет уровня с геометрией для украшения.".to_owned()
    })?;
    let bounds = fit_root(&mut graph, root, decorations)?;
    let bytes = finish(&graph)?;
    shop::write_atomic(&output, &bytes)?;
    fresh.keep();
    let names: Vec<&str> = decorations.iter().map(|item| item.name.as_str()).collect();
    Ok(report(&output, &tally, bounds, bytes.len(), &names))
}

pub const COMMANDS: &[Command] = &[Command::new("decorate-drawable", decorate_drawable)];

#[cfg(test)]
mod tests {
    use super::graft::records_of;
    use super::shop::texture_objects;
    use super::split::{address_of, geometry_blocks, mapping_of, u16_at, u32_at};
    use super::*;
    use crate::run;
    use rage_res::hash::{joaat, sha256_hex};
    use rage_res::resource::Resource;
    use rage_res::resource_graph::{from_parts, identity_order, rebuild, scan};
    use serde_json::json;
    use std::sync::Mutex;

    /// Тесты модуля, что запускают команду, идут по очереди: выключатель версии 2 — переменная окружения всего процесса.
    static GATE_LOCK: Mutex<()> = Mutex::new(());

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn at(&self, name: &str) -> PathBuf {
            name.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
        }

        fn path(&self, name: &str) -> String {
            self.at(name).to_string_lossy().into_owned()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.at(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        }

        /// Выключатель версии 2 читается из окружения процесса: тесты модуля идут по очереди через `GATE_LOCK`, каждый со своим
        /// состоянием выключателя (`exec` — выключен, `exec_gated` — как сказано).
        fn exec(&self, request: &Value, output: Option<&str>) -> (Value, i32) {
            self.exec_gated(request, output, None)
        }

        fn exec_gated(
            &self,
            request: &Value,
            output: Option<&str>,
            gate: Option<&str>,
        ) -> (Value, i32) {
            let _turn = GATE_LOCK.lock().unwrap_or_else(|taken| taken.into_inner());
            match gate {
                Some(word) => std::env::set_var(V2_ENV, word),
                None => std::env::remove_var(V2_ENV),
            }
            let outcome = self.exec_now(request, output);
            std::env::remove_var(V2_ENV);
            outcome
        }

        fn exec_now(&self, request: &Value, output: Option<&str>) -> (Value, i32) {
            let input = self.put("request.json", request.to_string().as_bytes());
            let mut argv = vec!["decorate-drawable".to_owned(), "--input".to_owned(), input];
            if let Some(file) = output {
                argv.extend(["--output".to_owned(), file.to_owned()]);
            }
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }
    }

    // -- DDS из нулей и запрос из описания ------------------------------------------------------------------------

    /// DXT5 16×16 с полной цепочкой: 128 байт шапки и 368 байт данных.
    fn sheet_16(fill: u8) -> Vec<u8> {
        let mut bytes = vec![0u8; 128];
        bytes[0..4].copy_from_slice(b"DDS ");
        for (at, value) in [
            (4, 124u32),
            (8, 0x0002_1007),
            (12, 16),
            (16, 16),
            (28, 5),
            (76, 32),
            (80, 4),
            (108, 0x1000),
        ] {
            bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes[84..88].copy_from_slice(b"DXT5");
        bytes.extend(vec![fill; 368]);
        bytes
    }

    fn decoration(bench: &Bench, name: &str, fill: u8) -> Value {
        let sheet = sheet_16(fill);
        let texture = bench.put(&format!("in/{name}.dds"), &sheet);
        json!({
            "name": name,
            "anchor": [0, 0, 0],
            "positions": [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0],
            "normals": [0, 0, 1, 0, 0, 1, 0, 0, 1],
            "uvs": [0, 0, 1, 0, 0, 1],
            "indices": [0, 1, 2],
            "texture": texture,
            "textureSha256": format!("sha256:{}", sha256_hex(&sheet)),
            "width": 16,
            "height": 16,
        })
    }

    fn base(bench: &Bench) -> Value {
        let model = bench.put("game/model.ydr", &skinned_model(&[0]));
        json!({
            "format": "astral.decorate-drawable",
            "version": 1,
            "model": model,
            "decorations": [decoration(bench, "astral_deco_01", 0)],
        })
    }

    fn failure(outcome: &(Value, i32)) -> (String, String) {
        assert_eq!(outcome.1, 1, "{}", outcome.0);
        (
            outcome.0["error"]["code"].as_str().unwrap().to_owned(),
            outcome.0["error"]["message"].as_str().unwrap().to_owned(),
        )
    }

    fn refused(message: &str) -> (String, String) {
        (
            "InvalidDataException".to_owned(),
            format!("decorate-drawable: {message}"),
        )
    }

    fn patched(request: &Value, edits: &[(&str, Option<Value>)]) -> Value {
        let mut doc = request.clone();
        for (path, value) in edits {
            let (parent, key) = path.rsplit_once('/').unwrap();
            let target = doc.pointer_mut(parent).unwrap_or_else(|| panic!("{path}"));
            match (target, value) {
                (Value::Object(map), Some(value)) => {
                    map.insert(key.to_owned(), value.clone());
                }
                (Value::Object(map), None) => {
                    map.remove(key);
                }
                (Value::Array(items), Some(value)) => {
                    items[key.parse::<usize>().unwrap()] = value.clone()
                }
                _ => panic!("{path}"),
            }
        }
        doc
    }

    #[test]
    fn the_request_is_refused_field_by_field_in_the_documented_order() {
        let bench = Bench::new();
        let request = base(&bench);
        let out = bench.path("out/model.ydr");
        let go = |edits: &[(&str, Option<Value>)]| {
            failure(&bench.exec(&patched(&request, edits), Some(&out)))
        };
        let some = |value: Value| Some(value);
        assert_eq!(
            go(&[("/format", some(json!("other")))]),
            refused("неизвестный формат запроса.")
        );
        assert_eq!(
            go(&[("/format", None)]),
            refused("неизвестный формат запроса.")
        );
        for (version, shown) in [
            (json!(2), 2),
            (json!(0), 0),
            (json!(-1), 0),
            (json!("1"), 0),
            (json!(1.0), 0),
            (json!(4), 4),
        ] {
            assert_eq!(
                go(&[("/version", some(version))]),
                refused(&format!(
                    "версия {shown} пока на хосте (движок — версия 1)."
                ))
            );
        }
        assert_eq!(
            go(&[("/version", None)]),
            refused("версия 0 пока на хосте (движок — версия 1).")
        );
        for key in ["parts", "body", "attachments", "replace"] {
            let text = format!("«{key}» пока на хосте (движок — версия 1).");
            assert_eq!(
                go(&[(&format!("/{key}"), some(json!([])))]),
                refused(&text),
                "{key}"
            );
            assert_eq!(
                go(&[(&format!("/{key}"), some(json!(0)))]),
                refused(&text),
                "{key}"
            );
        }
        assert_eq!(
            go(&[("/replace", some(json!(true)))]),
            refused("«replace» пока на хосте (движок — версия 1).")
        );
        assert_eq!(
            go(&[("/replace", some(json!("false")))]),
            refused("«replace» пока на хосте (движок — версия 1).")
        );
        assert_eq!(
            go(&[("/parts", some(json!([]))), ("/body", some(json!([])))]),
            refused("«parts» пока на хосте (движок — версия 1).")
        );
        // `null` и `replace: false` годятся: запрос идёт дальше, до модели без скина или до успеха.
        assert!(
            bench
                .exec(
                    &patched(
                        &request,
                        &[
                            ("/parts", some(json!(null))),
                            ("/replace", some(json!(false)))
                        ]
                    ),
                    Some(&out)
                )
                .1
                == 0
        );
        assert_eq!(go(&[("/model", None)]), refused("нет модели."));
        assert_eq!(go(&[("/model", some(json!(5)))]), refused("нет модели."));
        assert_eq!(go(&[("/decorations", None)]), refused("нет украшений."));
        assert_eq!(
            go(&[("/decorations", some(json!([])))]),
            refused("нужно от 1 до 12 украшений.")
        );
        let many: Vec<Value> = (0..13).map(|index| json!(index)).collect();
        assert_eq!(
            go(&[("/decorations", some(Value::Array(many)))]),
            refused("нужно от 1 до 12 украшений.")
        );
        let missing = bench.path("game/nope.ydr");
        let denied = go(&[("/model", some(json!(missing)))]);
        assert_eq!(denied.0, "FileNotFoundException");
        let wrong = bench.put("game/model.bin", b"x");
        assert_eq!(
            go(&[("/model", some(json!(wrong)))]),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .bin".to_owned()
            )
        );
    }

    #[test]
    fn decorations_are_checked_one_at_a_time() {
        let bench = Bench::new();
        let request = base(&bench);
        let out = bench.path("out/model.ydr");
        let go = |edits: &[(&str, Option<Value>)]| {
            failure(&bench.exec(&patched(&request, edits), Some(&out)))
        };
        let at = |key: &str| format!("/decorations/0/{key}");
        let some = |value: Value| Some(value);
        let names = refused("имена украшений — уникальные astral_deco_NN.");
        for name in [
            json!("astral_deco_1"),
            json!("astral_deco_001"),
            json!("Astral_deco_01"),
            json!("astral_deco_0a"),
            json!(5),
            json!("astral_deco_٠١"),
        ] {
            assert_eq!(go(&[(&at("name"), some(name))]), names);
        }
        assert_eq!(go(&[(&at("name"), None)]), names);
        let twice = patched(
            &request,
            &[(
                "/decorations",
                some(json!([
                    request["decorations"][0].clone(),
                    request["decorations"][0].clone()
                ])),
            )],
        );
        assert_eq!(failure(&bench.exec(&twice, Some(&out))), names);
        assert_eq!(
            go(&[(&at("positions"), None)]),
            refused("украшение 0: позиции — нет списка.")
        );
        assert_eq!(
            go(&[(
                &at("positions"),
                some(json!([0, 0, 0, null, 0, 0, 0, 0, 0]))
            )]),
            refused("украшение 0: позиции — не числа.")
        );
        assert_eq!(
            go(&[(&at("positions"), some(json!([0, 0, 0, 0])))]),
            refused("украшение 0: позиции — длина не кратна 3.")
        );
        assert_eq!(
            go(&[(&at("normals"), some(json!("x")))]),
            refused("украшение 0: нормали — нет списка.")
        );
        assert_eq!(
            go(&[(&at("normals"), some(json!([0, 0])))]),
            refused("украшение 0: нормали — длина не кратна 3.")
        );
        assert_eq!(
            go(&[(&at("uvs"), None)]),
            refused("украшение 0: UV — нет списка.")
        );
        assert_eq!(
            go(&[(&at("uvs"), some(json!([0, 0, 1, "x", 0, 1])))]),
            refused("украшение 0: UV — не числа.")
        );
        assert_eq!(
            go(&[(&at("uvs"), some(json!([0, 0, 1])))]),
            refused("украшение 0: UV — длина не кратна 2.")
        );
        let broken = refused("astral_deco_01 — сломаны массивы вершин.");
        assert_eq!(
            go(&[(&at("normals"), some(json!([0, 0, 1, 0, 0, 1])))]),
            broken
        );
        assert_eq!(go(&[(&at("uvs"), some(json!([0, 0, 1, 0])))]), broken);
        assert_eq!(
            go(&[(&at("positions"), some(json!([0, 0, 0, 1, 0, 0])))]),
            broken
        );
        assert_eq!(
            go(&[(&at("indices"), None)]),
            refused("astral_deco_01 — нет индексов.")
        );
        for indices in [
            json!([0, 1, 3]),
            json!([0, 1, 2.0]),
            json!([0, 1, -1]),
            json!([0, 1, "2"]),
        ] {
            assert_eq!(
                go(&[(&at("indices"), some(indices))]),
                refused("astral_deco_01 — индекс вне вершин.")
            );
        }
        assert_eq!(
            go(&[(&at("indices"), some(json!([0, 1])))]),
            refused("astral_deco_01 — индексы не треугольники.")
        );
        assert_eq!(
            go(&[(&at("indices"), some(json!([])))]),
            refused("astral_deco_01 — индексы не треугольники.")
        );
        let tolerance = refused("astral_deco_01 — значения вне допуска.");
        assert_eq!(
            go(&[(
                &at("positions"),
                some(json!([0, 0, 0, 3.01, 0, 0, 0, 0.1, 0]))
            )]),
            tolerance
        );
        assert_eq!(
            go(&[(&at("normals"), some(json!([0, 0, 1.02, 0, 0, 1, 0, 0, 1])))]),
            tolerance
        );
        assert_eq!(
            go(&[(&at("uvs"), some(json!([0, 0, 1, 0, 0, 2.5])))]),
            tolerance
        );
        assert_eq!(
            go(&[(&at("anchor"), None)]),
            refused("astral_deco_01 — нет точки крепления.")
        );
        assert_eq!(
            go(&[(&at("anchor"), some(json!([0, 0])))]),
            refused("astral_deco_01 — нет точки крепления.")
        );
        assert_eq!(
            go(&[(&at("anchor"), some(json!([0, 0, 3.5])))]),
            refused("astral_deco_01 — точка вне допуска.")
        );
        assert_eq!(
            go(&[(&at("anchor"), some(json!([0, "x", 0])))]),
            refused("astral_deco_01 — точка вне допуска.")
        );
        assert_eq!(
            go(&[(&at("emissive"), some(json!(16.5)))]),
            refused("astral_deco_01 — свечение вне 0–16.")
        );
        assert_eq!(
            go(&[(&at("emissive"), some(json!(-1)))]),
            refused("astral_deco_01 — свечение вне 0–16.")
        );
        assert_eq!(
            go(&[(&at("texture"), None)]),
            refused("astral_deco_01 — нет текстуры.")
        );
        // Границы годятся, нечисловые emissive и alpha читаются как 0 и false, и запрос доходит до проверки файла.
        for (key, value) in [
            ("emissive", json!(16)),
            ("emissive", json!("x")),
            ("emissive", json!(null)),
            ("alpha", json!("yes")),
            ("alpha", json!(1)),
        ] {
            let outcome = bench.exec(&patched(&request, &[(&at(key), some(value))]), Some(&out));
            assert_eq!(outcome.1, 0, "{key}: {}", outcome.0);
        }
    }

    #[test]
    fn pictures_are_checked_in_order_after_the_output_folder_is_made() {
        let bench = Bench::new();
        let request = base(&bench);
        let out = bench.path("made/here/model.ydr");
        let go = |edits: &[(&str, Option<Value>)]| {
            failure(&bench.exec(&patched(&request, edits), Some(&out)))
        };
        let at = |key: &str| format!("/decorations/0/{key}");
        let some = |value: Value| Some(value);
        let name = "astral_deco_01";
        assert_eq!(
            go(&[(&at("texture"), some(json!(bench.path("in/nope.dds"))))]).0,
            "FileNotFoundException"
        );
        let tiny = bench.put("in/tiny.dds", &[0u8; 100]);
        assert_eq!(
            go(&[(&at("texture"), some(json!(tiny)))]),
            refused(&format!("текстура {name} — размер файла вне допуска."))
        );
        let sides = refused(&format!(
            "текстура {name} — стороны 4–1024 степенью двойки."
        ));
        for side in [
            json!(3),
            json!(2048),
            json!(0),
            json!(24),
            json!("16"),
            json!(16.0),
        ] {
            assert_eq!(go(&[(&at("width"), some(side))]), sides);
        }
        let not_dxt5 = refused(&format!(
            "текстура {name} — не DXT5 16x16 с полной цепочкой мипов."
        ));
        assert_eq!(
            go(&[(&at("width"), some(json!(32)))]),
            refused(&format!(
                "текстура {name} — не DXT5 32x16 с полной цепочкой мипов."
            ))
        );
        let mut dxt1 = sheet_16(0);
        dxt1[84..88].copy_from_slice(b"DXT1");
        let path = bench.put("in/dxt1.dds", &dxt1);
        assert_eq!(go(&[(&at("texture"), some(json!(path)))]), not_dxt5);
        let mut short_chain = sheet_16(0);
        short_chain[28] = 4;
        let path = bench.put("in/short.dds", &short_chain);
        assert_eq!(go(&[(&at("texture"), some(json!(path)))]), not_dxt5);
        assert_eq!(
            go(&[(&at("textureSha256"), some(json!("sha256:00")))]),
            refused(&format!("SHA-256 текстуры {name} не сходится."))
        );
        assert_eq!(
            go(&[(&at("textureSha256"), None)]),
            refused(&format!("SHA-256 текстуры {name} не сходится."))
        );
        // Отказ без `--output` не создаёт ничего, а с `--output` созданная папка убирается (раньше оставалась пустой).
        assert!(!bench.dir.path().join("made").exists());
        // Первая плохая картинка побеждает, даже если вторая украшения не существует.
        let second = {
            let mut item = request["decorations"][0].clone();
            item["name"] = json!("astral_deco_02");
            item["texture"] = json!(bench.path("in/missing.dds"));
            item
        };
        let first_bad = patched(
            &request,
            &[(
                "/decorations",
                some(json!([
                    patched(
                        &request["decorations"][0],
                        &[("/textureSha256", some(json!("sha256:00")))]
                    ),
                    second
                ])),
            )],
        );
        assert_eq!(
            failure(&bench.exec(&first_bad, Some(&out))),
            refused(&format!("SHA-256 текстуры {name} не сходится."))
        );
    }

    #[test]
    fn output_is_required_late_and_must_be_a_ydr() {
        let bench = Bench::new();
        let request = base(&bench);
        assert_eq!(
            failure(&bench.exec(&request, None)),
            (
                "ArgumentException".to_owned(),
                "--output is required.".to_owned()
            )
        );
        assert_eq!(
            failure(&bench.exec(&request, Some(&bench.path("x/out.bin")))),
            (
                "ArgumentException".to_owned(),
                "Unsupported output extension: .bin".to_owned()
            )
        );
        // Пока запрос плохой, папка выхода не создаётся.
        let bad = patched(&request, &[("/decorations", None)]);
        let folder = bench.path("fresh/dir/out.ydr");
        assert_eq!(
            failure(&bench.exec(&bad, Some(&folder))),
            refused("нет украшений.")
        );
        assert!(!bench.dir.path().join("fresh").exists());
    }

    // -- подставная модель со скином ----------------------------------------------------------------------------------

    const SYSTEM_BASE: u64 = 0x5000_0000;
    const GRAPHICS_BASE: u64 = 0x6000_0000;

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

        fn link(&mut self, at: usize, target: usize) {
            self.put(at, &(SYSTEM_BASE + target as u64).to_le_bytes());
        }

        fn link_graphics(&mut self, at: usize, target: usize) {
            self.put(at, &(GRAPHICS_BASE + target as u64).to_le_bytes());
        }

        fn list(&mut self, targets: &[usize]) -> usize {
            let at = self.alloc(targets.len() * 8);
            for (index, &target) in targets.iter().enumerate() {
                self.link(at + index * 8, target);
            }
            at
        }
    }

    /// Положение четырёх вершин ствола и кости палитры: вершина `i` весом на кость `PALETTE[i]` (слот `i`).
    const POINTS: [[f32; 3]; 4] = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [2.0, 0.0, 0.0],
        [3.0, 0.0, 0.0],
    ];
    const PALETTE: [u16; 4] = [10, 20, 30, 40];

    /// Ствол со скином по описанию структуры: корень, группа с одним шейдером (без словаря), один уровень High,
    /// одна геометрия на 20-байтной вершине (положение, веса, номера костей) с палитрой из четырёх костей.
    /// `weights_slot` — для каждой вершины, на какой из четырёх весов приходится 255 (остальные нули).
    fn skinned_model(heaviest: &[usize]) -> Vec<u8> {
        let mut asm = Asm::default();
        let root = asm.alloc(0x100);
        let params = asm.alloc(32);
        let shader = asm.alloc(0x30);
        asm.link(shader, params);
        asm.put(shader + 0x10, &[1, 2]);
        asm.put(shader + 0x20, &0xff04u32.to_le_bytes());
        let shaders = asm.list(&[shader]);
        let group = asm.alloc(0x20);
        asm.link(group + 0x10, shaders);
        asm.put(group + 0x18, &1u16.to_le_bytes());
        let mut stream = Vec::new();
        for (index, point) in POINTS.iter().enumerate() {
            point
                .iter()
                .for_each(|value| stream.extend_from_slice(&value.to_le_bytes()));
            let mut weights = [0u8; 4];
            weights[heaviest.get(index).copied().unwrap_or(0)] = 255;
            stream.extend_from_slice(&weights);
            stream.extend_from_slice(&[index as u8, 0, 0, 0]);
        }
        let stream_at = asm.gfx(&stream);
        let declaration = asm.alloc(16);
        asm.put(declaration, &7u32.to_le_bytes());
        asm.put(declaration + 4, &20u16.to_le_bytes());
        asm.put(declaration + 8, &0x996u64.to_le_bytes());
        let buffer = asm.alloc(0x40);
        asm.put(buffer + 8, &20u16.to_le_bytes());
        asm.link_graphics(buffer + 0x10, stream_at);
        asm.put(buffer + 0x18, &4u32.to_le_bytes());
        asm.link(buffer + 0x30, declaration);
        let indices: Vec<u8> = [0u16, 1, 2, 1, 2, 3]
            .iter()
            .flat_map(|index| index.to_le_bytes())
            .collect();
        let indices_at = asm.gfx(&indices);
        let index_buffer = asm.alloc(0x40);
        asm.put(index_buffer + 8, &6u32.to_le_bytes());
        asm.link_graphics(index_buffer + 0x10, indices_at);
        let palette = asm.alloc(8);
        for (index, bone) in PALETTE.iter().enumerate() {
            asm.put(palette + index * 2, &bone.to_le_bytes());
        }
        let geometry = asm.alloc(0x80);
        asm.link(geometry + 0x18, buffer);
        asm.link(geometry + 0x38, index_buffer);
        asm.link(geometry + 0x68, palette);
        asm.put(geometry + 0x72, &4u16.to_le_bytes());
        let model = asm.alloc(0x40);
        let geometry_list = asm.list(&[geometry]);
        asm.link(model + 0x08, geometry_list);
        let mapping = asm.alloc(2);
        asm.link(model + 0x20, mapping);
        let mut record = [0u8; 32];
        for (axis, low) in [0.0f32, 0.0, 0.0].iter().enumerate() {
            record[axis * 4..axis * 4 + 4].copy_from_slice(&low.to_le_bytes());
        }
        for (axis, high) in [3.0f32, 0.0, 0.0].iter().enumerate() {
            record[16 + axis * 4..20 + axis * 4].copy_from_slice(&high.to_le_bytes());
        }
        let bounds = asm.alloc(32);
        asm.put(bounds, &record);
        asm.link(model + 0x18, bounds);
        for at in [0x10, 0x12, 0x2e] {
            asm.put(model + at, &1u16.to_le_bytes());
        }
        asm.put(model + 0x2c, &1u16.to_le_bytes());
        let models = asm.list(&[model]);
        let header = asm.alloc(16);
        asm.link(header, models);
        asm.put(header + 8, &1u16.to_le_bytes());
        asm.link(root + 0x10, group);
        asm.link(root + 0x50, header);
        asm.put(root + 0x80, &0xff01u32.to_le_bytes());
        for (axis, value) in [-1.0f32, 0.0, 0.0].iter().enumerate() {
            asm.put(root + 0x30 + axis * 4, &value.to_le_bytes());
        }
        for (axis, value) in [3.0f32, 0.5, 0.5].iter().enumerate() {
            asm.put(root + 0x40 + axis * 4, &value.to_le_bytes());
        }
        let graph = from_parts(165, 0xA000_0000, 0x5000_0000, asm.system, asm.graphics);
        rebuild(
            &graph,
            &identity_order(&graph, Segment::System),
            &identity_order(&graph, Segment::Graphics),
        )
        .unwrap()
    }

    struct Inspection {
        graph: Graph,
        root: usize,
        group: usize,
        model: usize,
    }

    impl Inspection {
        fn of(bytes: &[u8]) -> Self {
            let graph = scan(&Resource::parse(bytes).unwrap()).unwrap();
            let root = graph.root().unwrap();
            let group = follow(&graph, root, 0x10).unwrap();
            let header = follow(&graph, root, 0x50).unwrap();
            let list = follow(&graph, header, 0).unwrap();
            let model = follow(&graph, list, 0).unwrap();
            Self {
                graph,
                root,
                group,
                model,
            }
        }

        fn shaders(&self) -> Vec<usize> {
            let list = follow(&self.graph, self.group, 0x10).unwrap();
            let count = usize::from(u16_at(&self.graph, self.group, 0x18).unwrap());
            (0..count)
                .map(|index| follow(&self.graph, list, index * 8).unwrap())
                .collect()
        }

        fn geometries(&self) -> Vec<usize> {
            geometry_blocks(&self.graph, self.model).unwrap()
        }
    }

    fn run_ok(bench: &Bench, request: &Value, out: &str) -> Value {
        let outcome = bench.exec(request, Some(out));
        assert_eq!(outcome.1, 0, "{}", outcome.0);
        outcome.0["result"].clone()
    }

    #[test]
    fn a_skinned_model_gets_a_decoration_geometry_shader_and_texture() {
        let bench = Bench::new();
        let request = patched(
            &base(&bench),
            &[("/decorations/0/anchor", Some(json!([0.9, 0, 0])))],
        );
        let out = bench.path("out/model.ydr");
        let result = run_ok(&bench, &request, &out);
        assert_eq!(
            (
                result["lods"].clone(),
                result["geometries"].clone(),
                result["vertices"].clone(),
                result["bones"].clone()
            ),
            (json!(1), json!(1), json!(3), json!(1))
        );
        assert_eq!(result["textures"], json!(["astral_deco_01"]));
        assert_eq!(
            result["bounds"],
            json!({ "min": [-1.0, 0.0, 0.0], "max": [3.0, 0.5, 0.5] })
        );
        let bytes = fs::read(&out).unwrap();
        assert_eq!(result["outputBytes"], json!(bytes.len()));
        assert_eq!(result["output"], json!(out));
        let found = Inspection::of(&bytes);
        // Шейдеры: прежний и новый, у нового шесть векторов, корзина 0, хэши по файлу.
        let shaders = found.shaders();
        assert_eq!(shaders.len(), 2);
        let content = found.graph.content(shaders[1]).to_vec();
        assert_eq!((content[0x10], content[0x11]), (7, 0));
        assert_eq!(
            u32::from_le_bytes(content[0x08..0x0c].try_into().unwrap()),
            joaat("default")
        );
        assert_eq!(
            u32::from_le_bytes(content[0x18..0x1c].try_into().unwrap()),
            joaat("default.sps")
        );
        assert_eq!(
            u32::from_le_bytes(content[0x20..0x24].try_into().unwrap()),
            0xff01,
            "маска — по корзине шейдера, как у хоста и игры (`0xff00 | 1 << корзина`); у образца была своя"
        );
        // длины таблицы параметров и ёмкость списка шейдеров — по самому шейдеру
        assert_eq!(u16::from_le_bytes(content[0x14..0x16].try_into().unwrap()), 208);
        assert_eq!(u16::from_le_bytes(content[0x16..0x18].try_into().unwrap()), 272);
        let params = follow(&found.graph, shaders[1], 0).unwrap();
        let params_bytes = found.graph.content(params);
        assert!(params_bytes.len() >= 236);
        assert_eq!(
            u32::from_le_bytes(params_bytes[208..212].try_into().unwrap()),
            joaat("DiffuseSampler")
        );
        assert_eq!(
            u32::from_le_bytes(params_bytes[232..236].try_into().unwrap()),
            joaat("globalAnimUV0")
        );
        assert_eq!(
            (params_bytes[0], params_bytes[16], params_bytes[96]),
            (0, 1, 1)
        );
        let wetness = follow(&found.graph, params, 16 * 4 + 8).unwrap();
        assert_eq!(
            found.graph.content(wetness)[..16],
            [0, 0, 128, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
        // Словарь создан и содержит лист украшения; параметр текстуры указывает на её объект.
        let dictionary = follow(&found.graph, found.group, 0x08).unwrap();
        let objects = texture_objects(&found.graph, address_of(&found.graph, dictionary)).unwrap();
        assert_eq!(
            objects
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            ["astral_deco_01"]
        );
        assert_eq!(
            pointer_from_block(&found.graph, params, 8),
            Some(objects[0].1)
        );
        // Геометрии: прежняя и новая; соответствие шейдеров, число, маска, рамка.
        let geometries = found.geometries();
        assert_eq!(geometries.len(), 2);
        assert_eq!(
            mapping_of(&found.graph, found.model).unwrap().unwrap(),
            [0, 1]
        );
        for at in [0x10, 0x12, 0x2e] {
            assert_eq!(u16_at(&found.graph, found.model, at).unwrap(), 2);
        }
        assert_eq!(u16_at(&found.graph, found.model, 0x2c).unwrap(), 1);
        assert_eq!(u32_at(&found.graph, found.root, 0x80).unwrap(), 0xff01);
        let records = records_of(&found.graph, found.model).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(
            f32::from_le_bytes(records[1][16..20].try_into().unwrap()),
            0.1
        );
        assert_eq!(
            f32::from_le_bytes(records[1][28..32].try_into().unwrap()),
            0.1,
            "четвёртая компонента — X"
        );
        // Новая геометрия: палитра ближайшей геометрии целиком (четыре кости; прежний код делал палитру из одной кости),
        // вершины по 44 байта, номер в палитре у ближайшей вершины — слот 1 (кость 20).
        let new = geometries[1];
        assert_eq!(u16_at(&found.graph, new, 0x72).unwrap(), 4);
        let palette = follow(&found.graph, new, 0x68).unwrap();
        let wanted: Vec<u8> = PALETTE.iter().flat_map(|bone| bone.to_le_bytes()).collect();
        assert_eq!(found.graph.content(palette)[..8], wanted[..]);
        let buffer = follow(&found.graph, new, 0x18).unwrap();
        assert_eq!(
            (
                u16_at(&found.graph, buffer, 8).unwrap(),
                u32_at(&found.graph, buffer, 0x18).unwrap()
            ),
            (44, 3)
        );
        let declaration = follow(&found.graph, buffer, 0x30).unwrap();
        assert_eq!(u32_at(&found.graph, declaration, 0).unwrap(), 0x5f);
        assert_eq!(u16_at(&found.graph, declaration, 4).unwrap(), 44);
        assert_eq!(
            found.graph.content(declaration),
            // байт +7 — число бит флагов (6), типы всех слотов — `0x7755555555996996`, как у каждой геометрии игры
            [0x5f, 0, 0, 0, 44, 0, 0, 6, 0x96, 0x69, 0x99, 0x55, 0x55, 0x55, 0x55, 0x77]
        );
        // счётчики блока геометрии — по самой геометрии: 3 индекса, 1 треугольник, 3 вершины, шаг 44, данные вершин — свои
        assert_eq!(
            (u32_at(&found.graph, new, 0x58).unwrap(), u32_at(&found.graph, new, 0x5c).unwrap(), u16_at(&found.graph, new, 0x60).unwrap(), u16_at(&found.graph, new, 0x70).unwrap()),
            (3, 1, 3, 44)
        );
        let stream = follow(&found.graph, buffer, 0x10).unwrap();
        let data = found.graph.content(stream);
        assert!(data.len() >= 3 * 44);
        assert_eq!(&data[12..20], [0, 0, 0xff, 0, 0, 0, 1, 0]);
        assert_eq!(&data[32..36], [0xff; 4]);
        let index_buffer = follow(&found.graph, new, 0x38).unwrap();
        assert_eq!(u32_at(&found.graph, index_buffer, 8).unwrap(), 3);
        let index_data = found
            .graph
            .content(follow(&found.graph, index_buffer, 0x10).unwrap());
        assert_eq!(index_data[..6], [0, 0, 1, 0, 2, 0]);
        // Корень: рамка объединена, центр и радиус пересчитаны.
        let root = found.graph.content(found.root);
        let read = |at: usize| f32::from_le_bytes(root[at..at + 4].try_into().unwrap());
        assert_eq!([read(0x30), read(0x34), read(0x38)], [-1.0, 0.0, 0.0]);
        assert_eq!([read(0x40), read(0x44), read(0x48)], [3.0, 0.5, 0.5]);
        assert_eq!([read(0x20), read(0x24), read(0x28)], [1.0, 0.25, 0.25]);
        assert_eq!(read(0x2c), (16.0f32 + 0.25 + 0.25).sqrt() / 2.0);
        // Повтор даёт те же байты; выход можно положить поверх модели.
        let again = bench.path("out/again.ydr");
        run_ok(&bench, &request, &again);
        assert_eq!(fs::read(&again).unwrap(), bytes);
        assert!(!Path::new(&format!("{out}.shop-stage")).exists());
    }

    #[test]
    fn several_decorations_keep_their_order_and_choose_their_own_bones() {
        let bench = Bench::new();
        let template = base(&bench);
        let first = patched(
            &decoration(&bench, "astral_deco_01", 1),
            &[("/anchor", Some(json!([0.0, 0, 0])))],
        );
        let second = patched(
            &decoration(&bench, "astral_deco_02", 2),
            &[
                ("/anchor", Some(json!([2.9, 0, 0]))),
                ("/alpha", Some(json!(true))),
                ("/emissive", Some(json!(2))),
            ],
        );
        let request = patched(&template, &[("/decorations", Some(json!([first, second])))]);
        let out = bench.path("out/two.ydr");
        let result = run_ok(&bench, &request, &out);
        assert_eq!(
            (
                result["geometries"].clone(),
                result["vertices"].clone(),
                result["bones"].clone()
            ),
            (json!(2), json!(6), json!(2))
        );
        assert_eq!(
            result["textures"],
            json!(["astral_deco_01", "astral_deco_02"])
        );
        let found = Inspection::of(&fs::read(&out).unwrap());
        let shaders = found.shaders();
        assert_eq!(shaders.len(), 3);
        // Второе украшение: свечение и alpha — emissive_alpha.sps, корзина 1.
        let second_shader = found.graph.content(shaders[2]);
        assert_eq!(
            u32::from_le_bytes(second_shader[0x08..0x0c].try_into().unwrap()),
            joaat("emissive")
        );
        assert_eq!(
            u32::from_le_bytes(second_shader[0x18..0x1c].try_into().unwrap()),
            joaat("emissive_alpha.sps")
        );
        assert_eq!(second_shader[0x11], 1);
        let params = follow(&found.graph, shaders[2], 0).unwrap();
        let multiplier = follow(&found.graph, params, 16 * 4 + 8).unwrap();
        assert_eq!(&found.graph.content(multiplier)[..4], 2.0f32.to_le_bytes());
        // Соответствие шейдеров и маска корзин: у второго украшения корзина 1 даёт бит 2.
        assert_eq!(
            mapping_of(&found.graph, found.model).unwrap().unwrap(),
            [0, 1, 2]
        );
        assert_eq!(u16_at(&found.graph, found.model, 0x2c).unwrap(), 3);
        assert_eq!(u32_at(&found.graph, found.root, 0x80).unwrap(), 0xff03);
        // Кости: у обоих новых геометрий палитра целиком (четыре кости), а выбор — в номере палитры вершины:
        // слот 0 (кость 10) у первого украшения и слот 3 (кость 40) у второго.
        let geometries = found.geometries();
        let slots: Vec<(u16, u8)> = geometries[1..]
            .iter()
            .map(|&geometry| {
                let buffer = follow(&found.graph, geometry, 0x18).unwrap();
                let stream = follow(&found.graph, buffer, 0x10).unwrap();
                (
                    u16_at(&found.graph, geometry, 0x72).unwrap(),
                    found.graph.content(stream)[18],
                )
            })
            .collect();
        assert_eq!(slots, [(4, 0), (4, 3)]);
        // Словарь: оба листа, в порядке, который задаёт писатель словарей.
        let dictionary = follow(&found.graph, found.group, 0x08).unwrap();
        let mut names: Vec<String> =
            texture_objects(&found.graph, address_of(&found.graph, dictionary))
                .unwrap()
                .into_iter()
                .map(|(name, _)| name)
                .collect();
        names.sort();
        assert_eq!(names, ["astral_deco_01", "astral_deco_02"]);
        // Вторая запись рамок и объединение первой: у блока из трёх записей первая — объединение.
        let bounds = follow(&found.graph, found.model, 0x18).unwrap();
        assert!(found.graph.content(bounds).len() >= 32 * 4);
    }

    #[test]
    fn a_dictionary_in_the_model_is_kept_and_a_name_clash_is_refused() {
        let bench = Bench::new();
        let request = base(&bench);
        let first = bench.path("out/first.ydr");
        run_ok(&bench, &request, &first);
        // Украшенную модель украшают снова: словарь есть, шаблон — его первая текстура.
        let second_deco = decoration(&bench, "astral_deco_02", 3);
        let again = patched(
            &request,
            &[
                ("/model", Some(json!(first))),
                ("/decorations", Some(json!([second_deco]))),
            ],
        );
        let out = bench.path("out/second.ydr");
        let result = run_ok(&bench, &again, &out);
        assert_eq!(result["geometries"], json!(1));
        let found = Inspection::of(&fs::read(&out).unwrap());
        let dictionary = follow(&found.graph, found.group, 0x08).unwrap();
        let mut names: Vec<String> =
            texture_objects(&found.graph, address_of(&found.graph, dictionary))
                .unwrap()
                .into_iter()
                .map(|(name, _)| name)
                .collect();
        names.sort();
        assert_eq!(names, ["astral_deco_01", "astral_deco_02"]);
        assert_eq!(found.shaders().len(), 3);
        // То же имя второй раз отказывает.
        let clash = patched(&request, &[("/model", Some(json!(first)))]);
        assert_eq!(
            failure(&bench.exec(&clash, Some(&bench.path("out/third.ydr")))),
            refused("у модели уже есть текстура astral_deco_01.")
        );
        // Выход поверх самой модели.
        let on_place = patched(
            &request,
            &[
                ("/model", Some(json!(first))),
                (
                    "/decorations",
                    Some(json!([decoration(&bench, "astral_deco_05", 4)])),
                ),
            ],
        );
        run_ok(&bench, &on_place, &first);
        assert_eq!(
            Inspection::of(&fs::read(&first).unwrap())
                .geometries()
                .len(),
            3
        );
    }

    #[test]
    fn a_model_without_skin_or_geometry_is_left_to_the_host() {
        let bench = Bench::new();
        let request = base(&bench);
        let out = bench.path("out/model.ydr");
        // Модель без шейдеров и без модели в уровне отказывают своими словами.
        let junk = bench.put("game/junk.ydr", b"not a resource at all, just text");
        let outcome = bench.exec(
            &patched(&request, &[("/model", Some(json!(junk)))]),
            Some(&out),
        );
        assert_eq!(
            failure(&outcome),
            (
                "InvalidOperationException".to_owned(),
                "Файл не является ресурсом RSC7.".to_owned()
            )
        );
        let empty = bench.put("game/empty.ydr", b"");
        let outcome = bench.exec(
            &patched(&request, &[("/model", Some(json!(empty)))]),
            Some(&out),
        );
        assert_eq!(
            failure(&outcome),
            refused("модель пустая или больше 64 МБ.")
        );
        assert!(!Path::new(&out).exists());
    }

    #[test]
    fn the_heaviest_weight_wins_and_the_first_of_equals_is_taken() {
        assert_eq!(heaviest_of(&[10, 200, 30, 4]), 1);
        assert_eq!(heaviest_of(&[10, 200, 200, 4]), 1);
        assert_eq!(heaviest_of(&[7, 7, 7, 7]), 0);
        assert_eq!(heaviest_of(&[0, 0, 0, 0]), 0);
        assert_eq!(heaviest_of(&[1, 2, 3, 255]), 3);
        assert_eq!(heaviest_of(&[255, 255, 0, 255]), 0);
    }

    #[test]
    fn carrier_bones_and_nearest_vertices_follow_the_rules() {
        let vertex = |bone: u16, x: f32, geometry: usize| Weighted {
            position: [x, 0.0, 0.0],
            slot: 0,
            bone,
            geometry,
        };
        // 20 вершин: порог ⌈0,15 × 20⌉ = 3.
        let mut all: Vec<Weighted> = (0..17).map(|index| vertex(1, index as f32, 0)).collect();
        all.extend((0..3).map(|index| vertex(2, 100.0 + index as f32, 0)));
        assert_eq!(carrier_bones(&all), [1, 2]);
        let mut few: Vec<Weighted> = (0..18).map(|index| vertex(1, index as f32, 0)).collect();
        few.push(vertex(2, 100.0, 0));
        few.push(vertex(3, 101.0, 0));
        assert_eq!(
            carrier_bones(&few),
            [1],
            "кости с двумя вершинами ниже порога"
        );
        // Нет костей с достаточной долей: берётся одна, за которой больше вершин; при равенстве — первая.
        let spread: Vec<Weighted> = (0..10u16)
            .map(|bone| vertex(bone, bone as f32, 0))
            .collect();
        assert_eq!(
            carrier_bones(&spread),
            [0],
            "порог 2: ни у кого, берётся первая"
        );
        let tie = [vertex(5, 0.0, 0), vertex(6, 0.0, 1)];
        assert_eq!(
            nearest_vertex(&tie, &[5, 6], [0.0; 3]).unwrap().bone,
            5,
            "при равенстве остаётся первая"
        );
        assert_eq!(nearest_vertex(&tie, &[6], [0.0; 3]).unwrap().geometry, 1);
        assert!(nearest_vertex(&tie, &[7], [0.0; 3]).is_none());
        assert!(carrier_bones(&[]).is_empty());
    }

    // -- запрос версии 2, как его шлёт приложение (`weapon-decorations.js`), 20.11.2026 ------------------------------------

    /// DXT5 квадрат `side` со всеми ступенями до 1×1.
    fn sheet_square(side: usize, fill: u8) -> Vec<u8> {
        let chain = (usize::BITS - side.leading_zeros()) as usize;
        let data: usize = (0..chain)
            .map(|level| {
                let across = (side >> level).max(1).div_ceil(4);
                across * across * 16
            })
            .sum();
        let mut bytes = vec![0u8; 128];
        bytes[0..4].copy_from_slice(b"DDS ");
        for (at, value) in [
            (4, 124u32),
            (8, 0x0002_1007),
            (12, side as u32),
            (16, side as u32),
            (28, chain as u32),
            (76, 32),
            (80, 4),
            (108, 0x1000),
        ] {
            bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes[84..88].copy_from_slice(b"DXT5");
        bytes.extend(vec![fill; data]);
        bytes
    }

    /// Настоящий запрос приложения без частей (звезда, шипы, логотип, светящаяся голограмма; `tests/decorate_v2/app-request.json`
    /// пересобирается из кода приложения тестом `weapon-decorate-v2-request.test.js`): листы кладутся на место, путь модели — свой.
    fn app_request(bench: &Bench, version: u64) -> Value {
        let mut request: Value =
            serde_json::from_str(include_str!("../../tests/decorate_v2/app-request.json"))
                .expect("образец запроса приложения читается");
        request["model"] = json!(bench.put("game/model.ydr", &skinned_model(&[0])));
        request["version"] = json!(version);
        let names: Vec<String> = request["decorations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["name"].as_str().unwrap().to_owned())
            .collect();
        for (number, name) in names.iter().enumerate() {
            let side = request["decorations"][number]["width"].as_u64().unwrap() as usize;
            let sheet = sheet_square(side, number as u8);
            let file = bench.put(&format!("in/{name}.dds"), &sheet);
            let item = &mut request["decorations"][number];
            item["texture"] = json!(file);
            item["textureSha256"] = json!(format!("sha256:{}", sha256_hex(&sheet)));
        }
        request
    }

    #[test]
    fn the_app_request_of_version_2_follows_the_form_the_app_writes() {
        let bench = Bench::new();
        let request = app_request(&bench, 2);
        assert_eq!(
            request.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["format", "version", "model", "decorations"]
        );
        assert_eq!(request["decorations"].as_array().unwrap().len(), 4);
        for item in request["decorations"].as_array().unwrap() {
            assert!(item.get("parts").is_none(), "образец — без частей");
        }
        assert_eq!(request["decorations"][3]["emissive"], json!(6));
        assert_eq!(request["decorations"][2]["alpha"], json!(true));
    }

    #[test]
    fn a_version_2_app_request_is_left_to_the_host_while_the_gate_is_off() {
        let bench = Bench::new();
        let request = app_request(&bench, 2);
        let out = bench.path("out/model.ydr");
        for gate in [None, Some("off"), Some("0"), Some(""), Some("maybe")] {
            let outcome = bench.exec_gated(&request, Some(&out), gate);
            assert_eq!(
                failure(&outcome),
                refused("версия 2 пока на хосте (движок — версия 1)."),
                "{gate:?}"
            );
        }
        assert!(!Path::new(&out).exists());
    }

    #[test]
    fn a_version_2_app_request_is_built_like_version_1_with_the_gate_on() {
        let bench = Bench::new();
        let out_v1 = bench.path("out/v1.ydr");
        let out_v2 = bench.path("out/v2.ydr");
        let first = bench.exec(&app_request(&bench, 1), Some(&out_v1));
        assert_eq!(first.1, 0, "{}", first.0);
        for word in ["on", "1", "true", "yes", " ON "] {
            let _ = fs::remove_file(&out_v2);
            let second = bench.exec_gated(&app_request(&bench, 2), Some(&out_v2), Some(word));
            assert_eq!(second.1, 0, "{word:?}: {}", second.0);
            assert_eq!(second.0["result"]["geometries"], json!(4), "{word:?}");
            assert_eq!(
                fs::read(&out_v1).unwrap(),
                fs::read(&out_v2).unwrap(),
                "{word:?}: модель по запросу версии 2 равна модели по запросу версии 1"
            );
        }
        // у светящейся голограммы свой шейдер: корзина 1 (альфа), список параметров с `emissiveMultiplier`
        let found = Inspection::of(&fs::read(&out_v2).unwrap());
        assert_eq!(found.shaders().len(), 5, "прежний шейдер и четыре украшения");
    }

    #[test]
    fn parts_of_a_decoration_and_versions_above_2_are_left_to_the_host_with_the_gate_on() {
        let bench = Bench::new();
        let out = bench.path("out/model.ydr");
        let request = app_request(&bench, 2);
        let part = json!({ "anchor": [0, 0, 0], "vertex": 0, "vertices": 120, "index": 0, "indices": 120 });
        for parts in [json!([part]), json!([]), json!({}), json!(0), json!("x")] {
            let held = patched(&request, &[("/decorations/0/parts", Some(parts.clone()))]);
            let outcome = bench.exec_gated(&held, Some(&out), Some("on"));
            let (code, message) = failure(&outcome);
            assert_eq!(code, "InvalidDataException", "{parts}");
            assert!(message.contains("пока на хосте"), "{parts}: {message}");
        }
        // `null` — как нет ключа, запрос идёт дальше
        let null = patched(&request, &[("/decorations/0/parts", Some(json!(null)))]);
        assert_eq!(bench.exec_gated(&null, Some(&out), Some("on")).1, 0);
        // версии 3 и 4, свои ключи верхнего уровня остаются хосту при любом выключателе
        for version in [0, 3, 4, 5] {
            let outcome = bench.exec_gated(&app_request(&bench, version), Some(&out), Some("on"));
            assert_eq!(
                failure(&outcome),
                refused(&format!(
                    "версия {version} пока на хосте (движок — версия 1)."
                )),
                "версия {version}"
            );
        }
        for key in ["parts", "body", "attachments", "replace"] {
            let held = patched(&request, &[(&format!("/{key}"), Some(json!([1])))]);
            let outcome = bench.exec_gated(&held, Some(&out), Some("on"));
            assert_eq!(
                failure(&outcome),
                refused(&format!("«{key}» пока на хосте (движок — версия 1).")),
                "{key}"
            );
        }
    }

    #[test]
    fn the_gate_words_are_the_words_of_the_app_switches() {
        for word in ["on", "1", "true", "yes", "ON", " Yes "] {
            assert!(is_on(Some(word)), "{word:?}");
        }
        for word in ["off", "0", "false", "no", "", "maybe", "2"] {
            assert!(!is_on(Some(word)), "{word:?}");
        }
        assert!(!is_on(None));
    }

    fn pointer_from_block(graph: &Graph, block: usize, relative: usize) -> Option<Address> {
        graph.blocks[block]
            .slots
            .iter()
            .find(|slot| slot.relative == relative)
            .map(|slot| slot.target)
    }
}
