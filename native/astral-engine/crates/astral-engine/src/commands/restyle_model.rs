//! `restyle-model`: фрагмент `.yft`, рисовалка `.ydr` или словарь `.ytd` — листы заменяются картинками DDS, а
//! шейдеры с названными именами переходят на прозрачный пресет игры. Для `lamp-pole` отсюда открыты
//! `repoint_records` и `relay_textures`: они чинят ссылки на текстуры после замены листа.

use std::{borrow::Cow, collections::HashSet, fmt, fs, path::Path};

use rage_res::{
    donor::redirect,
    hash::{joaat, sha256_hex},
    resource::Resource,
    resource_graph::{self, Address, Graph, Segment, Slot},
    texture::Format,
    ytd_write::{self, payload_bytes, Edit},
};
use serde_json::{Map, Value};

use super::{
    graft::shader_blocks,
    lamp_pole::{lod_models, swap_shader, Layout, HOST_FRAGMENT_RADIUS, HOST_MODEL_RADIUS},
    restyle::{dictionary_entries, read_texture},
    shop::{embed_sheet, texture_objects, write_atomic, Flags},
    split::{address_of, pointer_block, u16_at, u32_at},
    split_heads::{drawables_of, write_drawable_heads, write_models_sizes, YDR_HEAD},
    Command,
};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.restyle-model";

/// Пределы запроса: его размер, число листов, размер цели.
mod limit {
    pub const REQUEST: usize = 65_536;
    pub const SHEETS: usize = 64;
    pub const TARGET: usize = 100_663_296;
}

/// Допустимые ключи запроса и листа.
mod keys {
    pub const ROOT: [&str; 5] = ["format", "version", "target", "textures", "alpha"];
    pub const SHEET: [&str; 2] = ["name", "dds"];
}

/// Смещения в шейдере, модели и объекте текстуры.
mod at {
    pub const GROUP: usize = 0x10;
    pub const DICTIONARY: usize = 0x08;
    pub const SHADER_NAME: usize = 0x08;
    pub const SHADER_BUCKET: usize = 0x11;
    pub const SHADER_FILE: usize = 0x18;
    /// Маска корзин шейдера: бит корзины и общий байт `0xFF00`. Игра рисует по ней, а не по номеру корзины.
    pub const SHADER_MASK: usize = 0x20;
    pub const TEXTURE_NAME: usize = 0x28;
    pub const TEXTURE_WIDTH: usize = 0x50;
    pub const TEXTURE_HEIGHT: usize = 0x52;
    pub const TEXTURE_FORMAT: usize = 0x58;
    pub const TEXTURE_LEVELS: usize = 0x5d;
    pub const TEXTURE_DATA: usize = 0x70;
    pub const MODEL_MASK: usize = 0x2c;
    /// Записи текстур в параметрах шейдера: указатель данных стоит на 72 байта дальше указателя имени.
    pub const RECORD_SPAN: usize = 72;
    /// Объект текстуры словаря занимает ровно столько байт.
    pub const OBJECT: usize = 144;
}

/// Уровни детализации: (список моделей уровня, слово флагов уровня) в порядке High, Med, Low, VLow.
const LEVELS: [(usize, usize); 4] = [(0x50, 0x80), (0x58, 0x84), (0x60, 0x88), (0x68, 0x8c)];
const TRANSPARENT: (u16, u8) = (2, 1);

/// Маска корзин шейдера по номеру корзины: бит корзины поверх общего байта, как в файлах игры
/// (`0xFF01` у непрозрачных, `0xFF02` у прозрачных).
pub(super) fn bucket_mask(bucket: u8) -> u32 {
    0xFF00 | (1u32 << bucket)
}

/// Шейдеры с прозрачным пресетом; файл пресета называется `<имя>_alpha.sps`.
const PRESET_SHADERS: [&str; 9] = [
    "normal_spec",
    "normal",
    "spec",
    "emissivenight",
    "emissive",
    "emissivestrong",
    "normal_spec_reflect",
    "normal_reflect",
    "spec_reflect",
];

/// Особый случай: шейдер переходит на `emissive` вместе с его прозрачным пресетом.
const SPECLUM: &str = "emissive_speclum";
const SPECLUM_TARGET: &str = "emissive";

fn preset_file(shader: &str) -> String {
    format!("{shader}_alpha.sps")
}

const TEXTURE: &str = "Texture";
const VECTOR: &str = "Vector";
const BLANK: [f32; 4] = [0.0; 4];
const UNIT: [f32; 4] = [1.0, 0.0, 0.0, 0.0];

/// Параметры нового шейдера при подмене `emissive_speclum`: векторы берут прежнее значение, если оно есть.
const SPECLUM_LAYOUT: Layout = &[
    ("DiffuseSampler", TEXTURE, BLANK),
    ("matMaterialColorScale", VECTOR, [1.0, 0.0, 0.0, 1.0]),
    ("HardAlphaBlend", VECTOR, UNIT),
    ("useTessellation", VECTOR, BLANK),
    ("emissiveMultiplier", VECTOR, UNIT),
    ("globalAnimUV1", VECTOR, [0.0, 1.0, 0.0, 0.0]),
    ("globalAnimUV0", VECTOR, UNIT),
];

/// Отказы запроса и обработки. Русские — с приставкой `restyle-model: `, английские — как у хоста.
enum Fault {
    RequestSize,
    Unreadable,
    NotObject,
    StrayKeys,
    Format,
    SheetsNotList,
    TooManySheets,
    SheetNotObject,
    SheetStray,
    SheetName,
    AlphaNotList,
    UnknownShader(String),
    NothingToDo,
    DictionaryHasNoShaders,
    TargetSize,
    NotAnImage,
    NoSheet(String),
    NoneTransparent,
    NoRoot,
    NoDictionaryFor(String),
    OutsideBlocks,
    NoTextureName,
    NoTextureData,
    DataOutside,
    LostSheet(String, String),
}

impl Fault {
    fn words(&self) -> Cow<'static, str> {
        let fixed = match self {
            Fault::RequestSize => "restyle-model: запрос от 1 байта до 64 КБ.",
            Fault::Unreadable => "restyle-model: запрос не читается.",
            Fault::NotObject => "restyle-model: запрос — не объект.",
            Fault::StrayKeys => "restyle-model: в запрос лишние ключи.",
            Fault::Format => "restyle-model: неизвестный формат или версия запроса.",
            Fault::SheetsNotList => "restyle-model: textures — список.",
            Fault::TooManySheets => "restyle-model: в запросе больше 64 листов.",
            Fault::SheetNotObject => "restyle-model: лист — не объект.",
            Fault::SheetStray => "restyle-model: в лист лишние ключи.",
            Fault::SheetName => "restyle-model: имя листа не годится.",
            Fault::AlphaNotList => "restyle-model: alpha — список.",
            Fault::NothingToDo => "Restyle-model request changes nothing.",
            Fault::DictionaryHasNoShaders => "restyle-model: словарь текстур без шейдеров.",
            Fault::TargetSize => "restyle-model: цель пустая или больше 96 МБ.",
            Fault::NotAnImage => "Restyle-model texture must be an existing .dds file.",
            Fault::NoneTransparent => {
                "Restyle-model target has none of the shaders to make transparent."
            }
            Fault::NoRoot => "restyle-model: у модели нет корня.",
            Fault::OutsideBlocks => "Restyle-model: текстура вне блоков.",
            Fault::NoTextureName => "Restyle-model: у текстуры нет имени.",
            Fault::NoTextureData => "Restyle-model: у текстуры нет данных.",
            Fault::DataOutside => "Restyle-model: данные текстуры вне блоков.",
            Fault::UnknownShader(name) => {
                return Cow::Owned(format!("Shader {name} has no transparent preset."))
            }
            Fault::NoSheet(name) => {
                return Cow::Owned(format!("Restyle-model target has no texture {name}."))
            }
            Fault::NoDictionaryFor(name) => {
                return Cow::Owned(format!("Restyle-model: словаря с листом {name} нет."))
            }
            Fault::LostSheet(file, name) => {
                return Cow::Owned(format!("Restyled {file} lost texture {name}."))
            }
        };
        Cow::Borrowed(fixed)
    }
}

impl fmt::Display for Fault {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Fault> for EngineError {
    fn from(fault: Fault) -> Self {
        EngineError::invalid_data(fault.words())
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

    fn raw(self) -> Option<&'a Value> {
        self.0
    }

    fn text(self) -> Option<&'a str> {
        self.0?.as_str()
    }

    fn natural(self) -> Option<u64> {
        self.0?.as_u64()
    }

    fn list(self) -> Option<&'a [Value]> {
        self.0?.as_array().map(Vec::as_slice)
    }

    fn fields(self) -> Option<&'a Map<String, Value>> {
        self.0?.as_object()
    }

    /// Есть ли в объекте ключ вне списка допустимых.
    fn strays(self, allowed: &[&str]) -> bool {
        self.fields()
            .is_some_and(|fields| fields.keys().any(|key| !allowed.contains(&key.as_str())))
    }
}

struct Sheet {
    name: String,
    dds: String,
}

struct Order {
    target: String,
    sheets: Vec<Sheet>,
    alpha: Vec<String>,
}

fn sheet_name_fits(name: &str) -> bool {
    let allowed = |ch: char| ch.is_ascii_lowercase() || ch.is_ascii_digit() || "_.+-".contains(ch);
    matches!(name.len(), 1..=160) && name.chars().all(allowed)
}

fn read_sheets(list: &Value) -> Result<Vec<Sheet>> {
    let items = Node::of(list).list().ok_or(Fault::SheetsNotList)?;
    if items.len() > limit::SHEETS {
        return Err(Fault::TooManySheets.into());
    }
    items
        .iter()
        .map(|item| {
            let node = Node::of(item);
            node.fields().ok_or(Fault::SheetNotObject)?;
            if node.strays(&keys::SHEET) {
                return Err(Fault::SheetStray.into());
            }
            let name = node
                .at("name")
                .text()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase();
            sheet_name_fits(&name)
                .then(|| Sheet {
                    name,
                    dds: node.at("dds").text().unwrap_or_default().to_owned(),
                })
                .ok_or_else(|| Fault::SheetName.into())
        })
        .collect()
}

fn has_preset(name: &str) -> bool {
    name == SPECLUM || PRESET_SHADERS.contains(&name)
}

/// Имена шейдеров для прозрачности: очищенные, без повторов, только известные.
fn read_alpha(list: &Value) -> Result<Vec<String>> {
    let items = Node::of(list).list().ok_or(Fault::AlphaNotList)?;
    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(Value::as_str)
        .map(|text| text.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty() && seen.insert(name.clone()))
        .map(|name| match has_preset(&name) {
            true => Ok(name),
            false => Err(Fault::UnknownShader(name).into()),
        })
        .collect()
}

fn parse_order(bytes: &[u8]) -> Result<Order> {
    if !(1..=limit::REQUEST).contains(&bytes.len()) {
        return Err(Fault::RequestSize.into());
    }
    let root: Value = serde_json::from_slice(bytes).map_err(|_| Fault::Unreadable)?;
    let top = Node::of(&root);
    top.fields().ok_or(Fault::NotObject)?;
    if top.strays(&keys::ROOT) {
        return Err(Fault::StrayKeys.into());
    }
    let recognised =
        top.at("format").text() == Some(REQUEST_FORMAT) && top.at("version").natural() == Some(1);
    if !recognised {
        return Err(Fault::Format.into());
    }
    let sheets = top
        .at("textures")
        .raw()
        .map(read_sheets)
        .transpose()?
        .unwrap_or_default();
    let alpha = top
        .at("alpha")
        .raw()
        .map(read_alpha)
        .transpose()?
        .unwrap_or_default();
    if sheets.is_empty() && alpha.is_empty() {
        return Err(Fault::NothingToDo.into());
    }
    Ok(Order {
        target: top.at("target").text().unwrap_or_default().to_owned(),
        sheets,
        alpha,
    })
}

// ---------------------------------------------------------------------------------------------
// Ссылки на текстуры (для lamp-pole)
// ---------------------------------------------------------------------------------------------

/// Текст до нуля от адреса до конца его блока, в нижнем регистре.
fn lowered_text(graph: &Graph, place: Address) -> Option<String> {
    let holder = graph.block_at(place)?;
    let tail = graph
        .bytes(place.segment)
        .get(place.offset..graph.blocks[holder].end)?;
    let length = tail
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(tail.len());
    Some(String::from_utf8_lossy(&tail[..length]).to_lowercase())
}

/// Лист нового словаря: имя, объект, указатель имени и указатель данных.
struct Fresh {
    name: String,
    object: Address,
    name_at: Address,
    data_at: Address,
}

fn fresh_sheets(graph: &Graph, dictionary: Address) -> Result<Vec<Fresh>> {
    texture_objects(graph, dictionary)?
        .into_iter()
        .map(|(name, object)| {
            let block = graph.block_at(object).ok_or(Fault::OutsideBlocks)?;
            let pointer = |relative, lack: Fault| {
                resource_graph::pointer_from(graph, block, relative).ok_or(lack)
            };
            Ok(Fresh {
                name: name.to_lowercase(),
                object,
                name_at: pointer(at::TEXTURE_NAME, Fault::NoTextureName)?,
                data_at: pointer(at::TEXTURE_DATA, Fault::NoTextureData)?,
            })
        })
        .collect()
}

/// Объекты текстур модели: системные блоки ровно в 144 байта, у которых данные лежат в области графики.
fn texture_object_blocks(graph: &Graph) -> Vec<usize> {
    graph
        .segment_blocks(Segment::System)
        .iter()
        .copied()
        .filter(|&block| graph.blocks[block].end - graph.blocks[block].start == at::OBJECT)
        .filter(|&block| {
            resource_graph::pointer_from(graph, block, at::TEXTURE_DATA)
                .is_some_and(|data| data.segment == Segment::Graphics)
        })
        .collect()
}

/// Группа шейдеров модели и адрес её словаря текстур.
fn dictionary_of(graph: &Graph, drawable: usize) -> Option<(usize, Address)> {
    let group = pointer_block(graph, drawable, at::GROUP)?;
    let dictionary = resource_graph::pointer_from(graph, group, at::DICTIONARY)?;
    Some((group, dictionary))
}

/// Словари текстур всех моделей корня: (группа шейдеров, адрес словаря).
struct Dictionaries<'g> {
    graph: &'g Graph,
    found: Vec<(usize, Address)>,
}

impl<'g> Dictionaries<'g> {
    fn of(graph: &'g Graph, root: usize) -> Result<Self> {
        let found = drawables_of(graph, root)?
            .into_iter()
            .filter_map(|drawable| dictionary_of(graph, drawable))
            .collect();
        Ok(Self { graph, found })
    }

    /// Первый словарь, где есть лист с таким именем: группа, словарь и имя в его написании.
    fn holding(&self, wanted: &str) -> Result<Option<(usize, Address, String)>> {
        for &(group, dictionary) in &self.found {
            let listed = texture_objects(self.graph, dictionary)?;
            if let Some((name, _)) = listed
                .into_iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(wanted))
            {
                return Ok(Some((group, dictionary, name)));
            }
        }
        Ok(None)
    }
}

/// Правка графа ссылок.
enum Fix {
    Redirect {
        from: Address,
        to: Address,
    },
    Retarget {
        block: usize,
        relative: usize,
        to: Address,
    },
}

impl Fix {
    fn apply(self, graph: &mut Graph) -> Result<()> {
        match self {
            Fix::Redirect { from, to } => {
                redirect(graph, from, to);
                Ok(())
            }
            Fix::Retarget {
                block,
                relative,
                to,
            } => Ok(resource_graph::retarget(graph, block, relative, to)?),
        }
    }
}

/// Прежние объекты текстур с именем нового листа уступают ему место.
fn object_fixes(graph: &Graph, fresh: &[Fresh]) -> Vec<Fix> {
    texture_object_blocks(graph)
        .into_iter()
        .filter_map(|block| {
            let from = address_of(graph, block);
            let name = lowered_text(
                graph,
                resource_graph::pointer_from(graph, block, at::TEXTURE_NAME)?,
            )?;
            let sheet = fresh.iter().find(|sheet| sheet.name == name)?;
            (!fresh.iter().any(|known| known.object == from)).then_some(Fix::Redirect {
                from,
                to: sheet.object,
            })
        })
        .collect()
}

/// Записи текстур в параметрах шейдеров: имя и данные переходят на указатели нового листа.
fn record_fixes(graph: &Graph, fresh: &[Fresh]) -> Vec<Fix> {
    let mut fixes = Vec::new();
    for (block, holder) in graph.blocks.iter().enumerate() {
        for data_slot in &holder.slots {
            let Some(name_slot) = data_slot.relative.checked_sub(at::RECORD_SPAN) else {
                continue;
            };
            let found = holder
                .slots
                .iter()
                .find(|other| other.relative == name_slot)
                .and_then(|named| lowered_text(graph, named.target))
                .and_then(|text| fresh.iter().find(|sheet| sheet.name == text));
            if let Some(sheet) = found {
                fixes.push(Fix::Retarget {
                    block,
                    relative: data_slot.relative,
                    to: sheet.data_at,
                });
                fixes.push(Fix::Retarget {
                    block,
                    relative: name_slot,
                    to: sheet.name_at,
                });
            }
        }
    }
    fixes
}

/// После замены листа `wanted` ссылки на прежние объекты текстур переводятся на объекты нового словаря.
pub(super) fn repoint_records(graph: &mut Graph, root: usize, wanted: &str) -> Result<()> {
    let (_, dictionary, _) = Dictionaries::of(graph, root)?
        .holding(wanted)?
        .ok_or_else(|| Fault::NoDictionaryFor(wanted.to_owned()))?;
    let fresh = fresh_sheets(graph, dictionary)?;
    // Сначала объекты, потом записи: вторая выборка видит граф после первой правки.
    object_fixes(graph, &fresh)
        .into_iter()
        .try_for_each(|fix| fix.apply(graph))?;
    record_fixes(graph, &fresh)
        .into_iter()
        .try_for_each(|fix| fix.apply(graph))
}

/// Какой префикс данных текстуры нужен по заголовку объекта; `None` — текстуру не трогать.
fn trimmed_data(graph: &Graph, object: usize, data: Address) -> Result<Option<Vec<u8>>> {
    let width = usize::from(u16_at(graph, object, at::TEXTURE_WIDTH)?);
    let height = usize::from(u16_at(graph, object, at::TEXTURE_HEIGHT)?);
    let code = u32_at(graph, object, at::TEXTURE_FORMAT)?;
    let levels = usize::from(graph.content(object)[at::TEXTURE_LEVELS]);
    let Some(format) = Format::from_code(code) else {
        return Ok(None);
    };
    let usable = width > 0 && height > 0 && matches!(levels, 1..=12);
    if !usable {
        return Ok(None);
    }
    let holder = graph.block_at(data).ok_or(Fault::DataOutside)?;
    if graph.blocks[holder].start != data.offset {
        return Ok(None);
    }
    let size = payload_bytes(format, width, height, levels);
    let content = graph.content(holder);
    let clean = content.len() >= size && content[size..].iter().all(|&byte| byte == 0);
    Ok(clean.then(|| content[..size].to_vec()))
}

/// Данные каждой текстуры приводятся к размеру по заголовку: лишний хвост из нулей отрезается новым блоком.
pub(super) fn relay_textures(graph: &mut Graph) -> Result<()> {
    let pairs: Vec<(usize, Address)> = texture_object_blocks(graph)
        .into_iter()
        .filter_map(|object| {
            resource_graph::pointer_from(graph, object, at::TEXTURE_DATA).map(|data| (object, data))
        })
        .collect();
    // Общие данные обрабатываются один раз — по первому объекту, которому обрезка подошла:
    // объект, ей не подошедший, данные за собой не занимает.
    let mut taken = HashSet::new();
    let mut plans = Vec::new();
    for (object, data) in pairs {
        if taken.contains(&data.offset) {
            continue;
        }
        if let Some(bytes) = trimmed_data(graph, object, data)? {
            taken.insert(data.offset);
            plans.push((data, bytes));
        }
    }
    for (old, bytes) in plans {
        let created =
            resource_graph::append_block(graph, Segment::Graphics, bytes, Vec::<Slot>::new());
        let fresh = address_of(graph, created);
        redirect(graph, old, fresh);
    }
    Ok(())
}

/// Порядок блоков обеих областей графа: как в нём лежат.
fn orders(graph: &Graph) -> [Vec<usize>; 2] {
    [Segment::System, Segment::Graphics]
        .map(|segment| resource_graph::identity_order(graph, segment))
}

// ---------------------------------------------------------------------------------------------
// Правка модели
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Fragment,
    Drawable,
    Dictionary,
}

impl Kind {
    fn of(extension: &str) -> Self {
        match extension {
            ".yft" => Kind::Fragment,
            ".ydr" => Kind::Drawable,
            _ => Kind::Dictionary,
        }
    }

    /// Служебные слова корня: у фрагмента отдельное слово корня и слово моделей, у рисовалки — одно.
    fn stamp(self, graph: &mut Graph, root: usize) -> Result<()> {
        match self {
            Kind::Fragment => {
                resource_graph::write_at(graph, root, 0, &HOST_FRAGMENT_RADIUS.to_le_bytes())?;
                write_drawable_heads(graph, root, HOST_MODEL_RADIUS)
            }
            _ => write_drawable_heads(graph, root, YDR_HEAD),
        }
    }
}

/// Граф модели, который правят по шагам запроса.
struct Model(Graph);

impl Model {
    fn root(&self) -> Result<usize> {
        self.0.root().ok_or_else(|| Fault::NoRoot.into())
    }

    /// Лист запроса заменяется в первой модели, где он нашёлся; отдаёт имя из словаря.
    fn exchange(&mut self, sheet: &Sheet) -> Result<String> {
        paths::existing_file(&sheet.dds, &[".dds"]).map_err(|_| Fault::NotAnImage)?;
        let root = self.root()?;
        let (group, _, name) = Dictionaries::of(&self.0, root)?
            .holding(&sheet.name)?
            .ok_or_else(|| Fault::NoSheet(sheet.name.clone()))?;
        let texture = read_texture(&name, Path::new(&sheet.dds))?;
        let flags = Flags {
            from: &name,
            source: None,
            keep_donor: true,
            prefer_dictionary: true,
        };
        embed_sheet(&mut self.0, group, texture, flags)?;
        Ok(name)
    }

    fn exchange_all(&mut self, sheets: &[Sheet]) -> Result<Vec<String>> {
        sheets.iter().map(|sheet| self.exchange(sheet)).collect()
    }

    /// Один шейдер: назван ли он в запросе и, если да, переведён ли на пресет.
    fn retint(&mut self, shader: usize, alpha: &[String]) -> Result<bool> {
        let hash = u32_at(&self.0, shader, at::SHADER_NAME)?;
        let named = alpha
            .iter()
            .map(String::as_str)
            .find(|&name| joaat(name) == hash);
        let Some(name) = named else {
            return Ok(false);
        };
        let file = match name {
            SPECLUM => {
                swap_shader(&mut self.0, shader, SPECLUM_TARGET, SPECLUM_LAYOUT)?;
                preset_file(SPECLUM_TARGET)
            }
            other => preset_file(other),
        };
        resource_graph::write_at(
            &mut self.0,
            shader,
            at::SHADER_FILE,
            &joaat(&file).to_le_bytes(),
        )?;
        resource_graph::write_at(&mut self.0, shader, at::SHADER_BUCKET, &[TRANSPARENT.1])?;
        // маска корзин идёт вместе с корзиной: с прежней маской непрозрачных игра рисует шейдер глухим,
        // хотя пресет и корзина уже прозрачные (проверка в GTA V 17.11.2026, навес `prop_busstop_04`)
        resource_graph::write_at(
            &mut self.0,
            shader,
            at::SHADER_MASK,
            &bucket_mask(TRANSPARENT.1).to_le_bytes(),
        )?;
        Ok(true)
    }

    /// Шейдеры названных имён переходят на прозрачный пресет и в корзину прозрачных. Число переведённых.
    fn make_transparent(&mut self, alpha: &[String]) -> Result<usize> {
        let root = self.root()?;
        let mut visited = HashSet::new();
        let mut changed = 0;
        for drawable in drawables_of(&self.0, root)? {
            let Some(group) = pointer_block(&self.0, drawable, at::GROUP) else {
                continue;
            };
            for shader in shader_blocks(&self.0, group)? {
                if visited.insert(shader) && self.retint(shader, alpha)? {
                    changed += 1;
                }
            }
        }
        match changed {
            0 => Err(Fault::NoneTransparent.into()),
            total => Ok(total),
        }
    }

    /// В масках моделей уровней и в словах флагов уровней взводится бит прозрачных.
    fn raise_masks(&mut self) -> Result<()> {
        let root = self.root()?;
        for drawable in drawables_of(&self.0, root)? {
            for (list, _) in LEVELS {
                for model in lod_models(&self.0, drawable, list)? {
                    let mask = u16_at(&self.0, model, at::MODEL_MASK)? | TRANSPARENT.0;
                    resource_graph::write_at(
                        &mut self.0,
                        model,
                        at::MODEL_MASK,
                        &mask.to_le_bytes(),
                    )?;
                }
            }
            for (_, place) in LEVELS {
                let flags = u32_at(&self.0, drawable, place)?;
                if flags != 0 {
                    let raised = flags | u32::from(TRANSPARENT.0);
                    resource_graph::write_at(&mut self.0, drawable, place, &raised.to_le_bytes())?;
                }
            }
        }
        Ok(())
    }

    /// Готовые байты: без неиспользуемых графических блоков, обе области в прежнем порядке.
    fn into_bytes(self) -> Result<Vec<u8>> {
        let compact = resource_graph::drop_unreferenced_graphics(&self.0)?;
        let [system, graphics] = orders(&compact);
        Ok(resource_graph::rebuild_with(
            &compact,
            &system,
            &graphics,
            &rage_res::meta_graph::deflate_body,
        )?)
    }
}

fn model_bytes(original: &[u8], order: &Order, kind: Kind) -> Result<(Vec<u8>, usize)> {
    let mut model = Model(resource_graph::scan(&Resource::parse(original)?)?);
    if let Some(first) = model.exchange_all(&order.sheets)?.first() {
        let root = model.root()?;
        repoint_records(&mut model.0, root, first)?;
    }
    let transparent = match order.alpha.is_empty() {
        true => 0,
        false => {
            let count = model.make_transparent(&order.alpha)?;
            model.raise_masks()?;
            count
        }
    };
    let root = model.root()?;
    kind.stamp(&mut model.0, root)?;
    write_models_sizes(&mut model.0, root)?;
    relay_textures(&mut model.0)?;
    Ok((model.into_bytes()?, transparent))
}

/// Словарь `.ytd`: лист за листом, служебный объект берётся у самого листа.
fn dictionary_bytes(original: &[u8], sheets: &[Sheet]) -> Result<Vec<u8>> {
    sheets.iter().try_fold(original.to_vec(), |bytes, sheet| {
        let entries = ytd_write::read_entries(&bytes)?;
        let existing = entries
            .iter()
            .find(|entry| entry.name.eq_ignore_ascii_case(&sheet.name))
            .ok_or_else(|| Fault::NoSheet(sheet.name.clone()))?;
        paths::existing_file(&sheet.dds, &[".dds"]).map_err(|_| Fault::NotAnImage)?;
        let texture = read_texture(&existing.name, Path::new(&sheet.dds))?;
        let donor = Some(existing.name.clone());
        Ok(ytd_write::edit(&bytes, &[Edit::Add { texture, donor }])?)
    })
}

// ---------------------------------------------------------------------------------------------
// Перечитывание и ответ
// ---------------------------------------------------------------------------------------------

fn written_entries(bytes: &[u8], kind: Kind) -> Result<Vec<ytd_write::Entry>> {
    if kind == Kind::Dictionary {
        return Ok(ytd_write::read_entries(bytes)?);
    }
    let graph = resource_graph::scan(&Resource::parse(bytes)?)?;
    let root = graph.root().ok_or(Fault::NoRoot)?;
    let lists = drawables_of(&graph, root)?
        .into_iter()
        .filter_map(|drawable| dictionary_of(&graph, drawable))
        .map(|(_, dictionary)| dictionary_entries(&graph, dictionary))
        .collect::<Result<Vec<_>>>()?;
    Ok(lists.concat())
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn sheet_cards(file: &str, bytes: &[u8], kind: Kind, sheets: &[Sheet]) -> Result<Vec<Value>> {
    let entries = written_entries(bytes, kind)?;
    sheets
        .iter()
        .map(|sheet| {
            let entry = entries
                .iter()
                .find(|entry| entry.name.eq_ignore_ascii_case(&sheet.name))
                .ok_or_else(|| Fault::LostSheet(file.to_owned(), sheet.name.clone()))?;
            Ok(object([
                ("name", entry.name.clone().into()),
                ("width", entry.width.into()),
                ("height", entry.height.into()),
                ("levels", entry.levels.into()),
                ("format", format!("D3DFMT_{}", entry.format.name()).into()),
            ]))
        })
        .collect()
}

fn restyle_model(options: &Options, _progress: &Progress) -> Result<Value> {
    let order = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))
        .and_then(|input| Ok(fs::read(input)?))
        .and_then(|bytes| parse_order(&bytes))?;

    let target = paths::existing_file(&order.target, &[".yft", ".ydr", ".ytd"])?;
    let extension = paths::extension_with_dot(&target).to_ascii_lowercase();
    let kind = Kind::of(&extension);
    if kind == Kind::Dictionary && !order.alpha.is_empty() {
        return Err(Fault::DictionaryHasNoShaders.into());
    }
    let original = fs::read(&target)?;
    (1..=limit::TARGET)
        .contains(&original.len())
        .then_some(())
        .ok_or(Fault::TargetSize)?;
    let output = paths::output_file(options.required("output")?, &[extension.as_str()])?;

    let (bytes, transparent) = match kind {
        Kind::Dictionary => (dictionary_bytes(&original, &order.sheets)?, 0),
        _ => model_bytes(&original, &order, kind)?,
    };
    write_atomic(&output, &bytes)?;

    let file = target
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let textures = sheet_cards(&file, &bytes, kind, &order.sheets)?;
    let semantic = object([
        ("semanticReopen", true.into()),
        ("textures", textures.into()),
        ("transparent", transparent.into()),
    ]);
    Ok(object([
        ("file", file.into()),
        ("bytes", bytes.len().into()),
        ("sha256", sha256_hex(&bytes).into()),
        ("semantic", semantic),
    ]))
}

const RESTYLE_MODEL: Command = Command::new("restyle-model", restyle_model);

pub const COMMANDS: &[Command] = &[RESTYLE_MODEL];

#[cfg(test)]
mod tests;
