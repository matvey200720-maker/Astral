//! `compile-emblem-plates`: плашки «эмблемы человека» как модели игры.
//!
//! На каждую плашку нужен файл модели `.ydr` с шейдером и встроенной текстурой, на весь набор —
//! файл типов `.ytyp`, карта размещения `.ymap` (и вторая карта `<карта>_lod.ymap`, если у
//! плашек есть дальние копии) и манифест `_manifest.ymf`. Каркас плашки берут у донора
//! (`rage_res::donor`): его геометрию заменяет двусторонняя плашка, а текстуру — картинка
//! человека под именем `<плашка>_img`. Что движок пока не умеет, отдаётся хосту отказом со
//! словами «пока на хосте».
//!
//! Четыре помощника ниже (`texture_side`, `dds_sheet`, `named_sheet`,
//! `refuse`) используются командой `compile-climb-markers`.

use std::{
    fs,
    path::{Path, PathBuf},
};

use rage_res::{
    dds,
    donor::{self, Donor, Mesh, Refusal, Round},
    drawable_write as drawable, hash,
    manifest_write::{self, Dependency},
    placements::{self as maps, ArchetypeFields, ArchetypeSpec, EntitySpec, LodLink},
    resource_graph::{pointer_from, Address, Graph, Segment},
    texture::Format,
    ytd_write::NewTexture,
};
use serde_json::{Map, Value};

use super::{fresh_dirs::FreshDirs, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Названия формата запроса и ответа.
mod wire {
    pub const REQUEST: &str = "astral.compile-emblem-plates";
    pub const ANSWER: &str = "astral.emblem-plates";
    pub const VERSION: u64 = 1;
    pub const EXPORTED_BY: &str = "Astral Emblem Plates 1";
    pub const EXPORT_TIME: &str = "01 January 1970 00:00";
}

/// Пределы запроса; числа сравниваются после сужения до `f32`, границы включены.
mod limits {
    use std::ops::RangeInclusive;

    pub const REQUEST_BYTES: RangeInclusive<u64> = 1..=256 * 1024;
    pub const PLATES: RangeInclusive<usize> = 1..=96;
    pub const DDS_BYTES: RangeInclusive<usize> = 128..=8 * 1024 * 1024;
    pub const NAME_BYTES: usize = 63;
    pub const SIZE: (f32, f32) = (0.2, 160.0);
    pub const POSITION: (f32, f32) = (-20000.0, 20000.0);
    pub const ROTATION: (f32, f32) = (-1.0, 1.0);
    pub const LOD: (f32, f32) = (10.0, 2000.0);
    pub const FAR_REACH: f64 = 5.0;
    pub const FAR_LOD: f32 = 5000.0;
    /// Дальняя модель со своей картинкой видна дальше: до 15 км, как SLOD3 надписи на холме Вайнвуд.
    pub const OWN_FAR_LOD: f32 = 15000.0;
    pub const HD_TEXTURE: f32 = 100.0;
}

/// Флаги архетипа и сущностей.
mod flags {
    pub const ARCHETYPE: u32 = 32;
    pub const ENTITY: u32 = 32;
    pub const ENTITY_WITH_PARENT: u32 = 32 | 8;
}

/// Суффиксы имён.
mod suffix {
    pub const TEXTURE: &str = "_img";
    pub const MAP_LOD: &str = "_lod";
    pub const FAR: &str = "_far";
}

/// Форма плашки: углы, грани и обход треугольников.
mod shape {
    /// Множители полуразмеров по ширине и высоте и текстурные координаты углов.
    pub const CORNERS: [(f32, f32, f32, f32); 4] = [
        (-1.0, -1.0, 0.0, 1.0),
        (1.0, -1.0, 1.0, 1.0),
        (1.0, 1.0, 1.0, 0.0),
        (-1.0, 1.0, 0.0, 0.0),
    ];
    /// Нормали граней по оси Y: сначала лицевая, потом обратная.
    pub const FACE_NORMALS: [f32; 2] = [-1.0, 1.0];
    /// Два треугольника грани по номерам углов.
    pub const FACE_TRIANGLES: [[u16; 3]; 2] = [[0, 1, 2], [0, 2, 3]];
    /// Порядок обхода треугольника у каждой грани: у обратной второй и третий углы меняются местами.
    pub const WINDING: [[usize; 3]; 2] = [[0, 1, 2], [0, 2, 1]];
    /// Половина толщины плашки по оси Y.
    pub const HALF_THICKNESS: f32 = 0.01;
}

/// Поля архетипа, которых у плашки в запросе нет.
const PLAIN_FIELDS: ArchetypeFields = ArchetypeFields {
    special_attribute: 0,
    hd_texture_dist: 0.0,
    texture_dictionary: None,
    time_flags: None,
};

/// Объект JSON из пар «ключ, значение» в порядке записи.
fn table<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Помощники для соседних команд
// ---------------------------------------------------------------------------

/// Сторона картинки: от 4 до 2048, степень двойки.
pub(super) fn texture_side(value: u64) -> bool {
    (4..=2048).contains(&value) && value.is_power_of_two()
}

/// Отказ «делай на хосте»: по этим словам приложение возвращается к хосту.
pub(super) fn refuse(what: &str) -> EngineError {
    EngineError::argument([what, ": пока на хосте."].concat())
}

/// Что не так с картинкой плашки.
enum SheetFlaw {
    Missing,
    Unsafe,
    Mismatch,
    NotDds,
    Shape(u64, u64),
}

impl SheetFlaw {
    fn blame(self, owner: &str) -> EngineError {
        let text = match self {
            SheetFlaw::Missing => return refuse("Картинка не найдена"),
            SheetFlaw::Unsafe => format!("Texture for {owner} has an unsafe file type or size."),
            SheetFlaw::Mismatch => format!("Texture SHA-256 mismatch for {owner}."),
            SheetFlaw::NotDds => format!("Texture for {owner} is not a DDS."),
            SheetFlaw::Shape(width, height) => {
                format!("Texture for {owner} is not {width}x{height} DXT5 with a full mip chain.")
            }
        };
        EngineError::argument(text)
    }
}

fn ensure(holds: bool, flaw: SheetFlaw) -> std::result::Result<(), SheetFlaw> {
    holds.then_some(()).ok_or(flaw)
}

/// Картинка с диска: размер, хэш, разбор DDS и форма (DXT5, полная цепочка уровней).
fn read_sheet(
    file: &Path,
    digest: &str,
    (width, height): (u64, u64),
    texture_name: &str,
) -> std::result::Result<NewTexture, SheetFlaw> {
    let bytes = fs::read(file).map_err(|_| SheetFlaw::Missing)?;
    ensure(limits::DDS_BYTES.contains(&bytes.len()), SheetFlaw::Unsafe)?;
    let actual = ["sha256:", hash::sha256_hex(&bytes).as_str()].concat();
    ensure(actual == digest, SheetFlaw::Mismatch)?;
    let picture = dds::parse(&bytes).map_err(|_| SheetFlaw::NotDds)?;
    let chain = u32::BITS - picture.width.max(picture.height).leading_zeros();
    let matches_request = u64::from(picture.width) == width
        && u64::from(picture.height) == height
        && picture.format == Format::Dxt5
        && u32::from(picture.levels) == chain;
    let sides = (u16::try_from(width), u16::try_from(height));
    match (matches_request, sides) {
        (true, (Ok(wide), Ok(high))) => Ok(NewTexture {
            name: texture_name.to_owned(),
            width: wide,
            height: high,
            format: Format::Dxt5,
            levels: picture.levels,
            payload: picture.payload,
        }),
        _ => Err(SheetFlaw::Shape(width, height)),
    }
}

/// Картинка из DDS DXT5 с полной цепочкой уровней: лист для словаря модели.
pub(super) fn dds_sheet(
    file: &Path,
    digest: &str,
    width: u64,
    height: u64,
    texture_name: &str,
    owner: &str,
) -> Result<NewTexture> {
    match read_sheet(file, digest, (width, height), texture_name) {
        Ok(sheet) => Ok(sheet),
        Err(flaw) => Err(flaw.blame(owner)),
    }
}

/// Чего не хватило собранной плашке на пути от корня к словарю текстур.
#[derive(Clone, Copy, Debug)]
enum Gap {
    Root,
    Group,
    GroupBlock,
    Dictionary,
}

impl From<Gap> for EngineError {
    fn from(gap: Gap) -> Self {
        EngineError::invalid_data(match gap {
            Gap::Root => "Плашка без корня.",
            Gap::Group => "У плашки нет группы шейдеров.",
            Gap::GroupBlock => "Группа шейдеров плашки вне блоков.",
            Gap::Dictionary => "У плашки нет словаря текстур.",
        })
    }
}

/// Путь от корня к словарю: смещение указателя, чего нет без него, чего нет без блока по адресу.
const DICTIONARY_PATH: [(usize, Gap, Gap); 2] = [
    (0x10, Gap::Group, Gap::Root),
    (0x08, Gap::Dictionary, Gap::GroupBlock),
];

fn dictionary_address(graph: &Graph) -> std::result::Result<Address, Gap> {
    let root = Address {
        segment: Segment::System,
        offset: 0,
    };
    DICTIONARY_PATH
        .iter()
        .try_fold(root, |at, &(relative, no_pointer, no_block)| {
            let block = graph.block_at(at).ok_or(no_block)?;
            pointer_from(graph, block, relative).ok_or(no_pointer)
        })
}

/// Текстуры словаря собранной плашки: имя и адрес объекта.
fn plate_textures(graph: &Graph) -> Result<Vec<(String, Address)>> {
    Ok(donor::texture_objects(graph, dictionary_address(graph)?)?)
}

/// Текстура и рисовалка получают новые имена в самом графе; `rehash` — и хеш листа в массиве словаря.
fn rename_in_place(graph: &mut Graph, texture: Address, to: &str, model: &str, rehash: bool) -> Result<()> {
    donor::rename_external_texture(graph, texture, to)?;
    let Some(root) = graph.root() else {
        return Err(Gap::Root.into());
    };
    donor::rename_drawable_plain(graph, root, model)?;
    if rehash {
        donor::refresh_dictionary_hashes(graph)?;
    }
    Ok(())
}

/// Переименовывает текстуру `from` в `to` и саму рисовалку в `model`, собирает файл плотно и
/// перечитывает его: в словаре обязана быть текстура `to`.
pub(super) fn named_sheet(bytes: &[u8], from: &str, to: &str, model: &str) -> Result<Vec<u8>> {
    renamed_sheet(bytes, from, to, model, false)
}

/// То же, и хеш листа в массиве хешей словаря — хеш нового имени, как у хоста (плашка эмблемы).
fn named_sheet_rehashed(bytes: &[u8], from: &str, to: &str, model: &str) -> Result<Vec<u8>> {
    renamed_sheet(bytes, from, to, model, true)
}

fn renamed_sheet(bytes: &[u8], from: &str, to: &str, model: &str, rehash: bool) -> Result<Vec<u8>> {
    let mut graph = drawable::graph_of(bytes)?;
    let wanted = |entry: &(String, Address)| entry.0.eq_ignore_ascii_case(from);
    let texture = match plate_textures(&graph)?.into_iter().find(wanted) {
        Some((_, object)) => object,
        None => {
            return Err(EngineError::invalid_data(
                "В плашке нет текстуры донора для переименования.",
            ))
        }
    };
    rename_in_place(&mut graph, texture, to, model, rehash)?;
    let renamed = drawable::finish_compact(&graph)?;
    let readable = plate_textures(&drawable::graph_of(&renamed)?)?
        .iter()
        .any(|(name, _)| name == to);
    match readable {
        true => Ok(renamed),
        false => Err(EngineError::invalid_data(
            "Переименованная плашка не читается с новым именем текстуры.",
        )),
    }
}

// ---------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------

/// Имя ассета: 1–63 байта, первый знак — строчная буква или цифра, дальше буквы, цифры и `_`.
fn is_asset_name(name: &str) -> bool {
    (1..=limits::NAME_BYTES).contains(&name.len())
        && name.bytes().enumerate().all(|(position, byte)| match byte {
            b'a'..=b'z' | b'0'..=b'9' => true,
            b'_' => position > 0,
            _ => false,
        })
}

fn asset_name(value: Option<&Value>, label: &str) -> Result<String> {
    match value.and_then(Value::as_str) {
        Some(name) if is_asset_name(name) => Ok(name.to_owned()),
        _ => Err(EngineError::argument(format!(
            "Emblem plate {label} name must be lowercase letters, digits and underscores."
        ))),
    }
}

fn lod_map_name(map: &str) -> String {
    [map, suffix::MAP_LOD].concat()
}

/// Расстояние между точками: разности считаются в `f32`, сумма квадратов — в `f64`.
fn reach(from: [f32; 3], to: [f32; 3]) -> f64 {
    let squares = from.iter().zip(to).map(|(a, b)| f64::from(b - a).powi(2));
    squares.sum::<f64>().sqrt()
}

/// Число из JSON, суженное до `f32`: конечное и в пределах `[low, high]`.
fn bounded(value: &Value, (low, high): (f32, f32)) -> Option<f32> {
    let narrowed = value.as_f64()? as f32;
    (narrowed.is_finite() && (low..=high).contains(&narrowed)).then_some(narrowed)
}

/// Чем плох числовой вектор: не тот вид или значение вне пределов.
enum Flaw {
    Malformed,
    OutOfRange,
}

fn numbers<const N: usize>(
    value: Option<&Value>,
    limits: (f32, f32),
) -> std::result::Result<[f32; N], Flaw> {
    let items = match value {
        Some(Value::Array(items)) if items.len() == N => items,
        _ => return Err(Flaw::Malformed),
    };
    let parsed: Vec<f32> = items
        .iter()
        .map(|item| bounded(item, limits))
        .collect::<Option<_>>()
        .ok_or(Flaw::OutOfRange)?;
    Ok(std::array::from_fn(|index| parsed[index]))
}

/// Поза плашки: место и поворот (кватернион x, y, z, w).
#[derive(Clone)]
struct Pose {
    position: [f32; 3],
    rotation: [f32; 4],
}

/// Картинка плашки: файл, хэш из запроса и стороны.
#[derive(Clone)]
struct Picture {
    file: PathBuf,
    sha: String,
    sides: [u64; 2],
}

/// Дальняя копия: место, дальность отрисовки и, если задана, своя картинка. С картинкой копия — своя модель `<имя>_far`
/// и свой архетип (так просит приложение с 30.10.2026), без неё — та же плашка в карте LOD.
#[derive(Clone)]
struct Far {
    place: [f32; 3],
    lod: f32,
    own: Option<Picture>,
}

impl Far {
    fn position(&self) -> [f32; 3] {
        self.place
    }

    fn lod(&self) -> f32 {
        self.lod
    }
}

#[derive(Clone)]
struct Plate {
    name: String,
    size: [f32; 2],
    pose: Pose,
    lod: f32,
    picture: Picture,
    far: Option<Far>,
}

/// Поля одной плашки запроса: читатель с именем плашки для текстов отказов.
struct Fields<'a> {
    item: &'a Value,
    plate: &'a str,
}

impl Fields<'_> {
    fn complain(&self, text: &str) -> EngineError {
        EngineError::argument(format!("Emblem plate {} {text}", self.plate))
    }

    fn vector<const N: usize>(
        &self,
        source: Option<&Value>,
        limits: (f32, f32),
        label: &str,
    ) -> Result<[f32; N]> {
        numbers::<N>(source, limits).map_err(|flaw| {
            let verdict = match flaw {
                Flaw::Malformed => "malformed",
                Flaw::OutOfRange => "out of range",
            };
            self.complain(&format!("{label} is {verdict}."))
        })
    }

    fn key<const N: usize>(&self, key: &str, limits: (f32, f32)) -> Result<[f32; N]> {
        self.vector(self.item.get(key), limits, key)
    }

    /// Поворот: четыре числа от −1 до 1 с длиной единица плюс-минус 0,001.
    fn rotation(&self) -> Result<[f32; 4]> {
        let rotation = self.key::<4>("rotation", limits::ROTATION)?;
        let squares = rotation.iter().map(|&part| f64::from(part).powi(2));
        match (squares.sum::<f64>().sqrt() - 1.0).abs() > 0.001 {
            true => Err(self.complain("rotation must be a unit quaternion.")),
            false => Ok(rotation),
        }
    }

    fn lod(&self) -> Result<f32> {
        match self
            .item
            .get("lodDist")
            .and_then(|value| bounded(value, limits::LOD))
        {
            Some(lod) => Ok(lod),
            None => Err(self.complain("draw distance is out of range.")),
        }
    }

    /// Картинка плашки: стороны целые степени двойки, `texture` — строка; хэш без строки — пустой.
    fn picture(&self) -> Result<Picture> {
        self.picture_in(self.item, "", "Плашка без картинки")
    }

    /// Картинка из объекта `source` (плашка или её дальняя копия): `label` — приписка к тексту отказа про стороны
    /// (`far `), `missing` — слова отказа, если `texture` не строка.
    fn picture_in(&self, source: &Value, label: &str, missing: &str) -> Result<Picture> {
        let side = |key: &str| source.get(key).and_then(Value::as_u64).unwrap_or(0);
        let sides = [side("width"), side("height")];
        if !sides.iter().copied().all(texture_side) {
            return Err(self.complain(&format!("{label}texture must be a power of two, 4\u{2026}2048 px.")));
        }
        let Some(file) = source.get("texture").and_then(Value::as_str) else {
            return Err(refuse(missing));
        };
        let sha = source.get("textureSha256").and_then(Value::as_str);
        Ok(Picture {
            file: PathBuf::from(file),
            sha: sha.unwrap_or_default().to_owned(),
            sides,
        })
    }

    /// Дальняя копия: нет поля или `null` — копии нет. Порядок проверок как у хоста: место, расстояние до плашки, дальность
    /// (с картинкой — до 15 км, без неё — до 5 км), для своей картинки имя `<имя>_far` и стороны листа.
    fn far(&self, position: [f32; 3], lod: f32, names: &mut Names<'_>) -> Result<Option<Far>> {
        let value = match self.item.get("far") {
            None | Some(Value::Null) => return Ok(None),
            Some(value) => value,
        };
        let own = value.get("texture").is_some_and(|texture| !texture.is_null());
        let place = self.vector::<3>(value.get("position"), limits::POSITION, "far position")?;
        if reach(position, place) > limits::FAR_REACH {
            return Err(self.complain("far copy is more than 5 m away."));
        }
        let ceiling = if own { limits::OWN_FAR_LOD } else { limits::FAR_LOD };
        let farther = |candidate: f32| {
            candidate.is_finite() && candidate > lod && candidate <= ceiling
        };
        let distance = match value
            .get("lodDist")
            .and_then(Value::as_f64)
            .map(|number| number as f32)
        {
            Some(candidate) if farther(candidate) => candidate,
            _ => return Err(self.complain("far draw distance is out of range.")),
        };
        let picture = match own {
            true => {
                let far_name = Value::String([self.plate, suffix::FAR].concat());
                names.admit(Some(&far_name), "far plate")?;
                Some(self.picture_in(value, "far ", "Своя картинка дальней плашки")?)
            }
            false => None,
        };
        Ok(Some(Far {
            place,
            lod: distance,
            own: picture,
        }))
    }
}

/// Набор уже известных имён: типы, карта и плашки, прочитанные раньше.
struct Names<'a> {
    types: &'a str,
    map: &'a str,
    seen: Vec<String>,
}

impl Names<'_> {
    /// Имя плашки или её дальней модели: имя ассета, не равное типам, карте и её карте LOD и не встречавшееся раньше.
    fn admit(&mut self, value: Option<&Value>, label: &str) -> Result<String> {
        let name = asset_name(value, label)?;
        let reserved =
            [self.types, self.map, lod_map_name(self.map).as_str()].contains(&name.as_str());
        if reserved {
            return Err(EngineError::argument(format!(
                "Emblem plate {name} collides with the types or map name."
            )));
        }
        if self.seen.contains(&name) {
            return Err(EngineError::argument(format!(
                "Emblem plate {name} is listed twice."
            )));
        }
        self.seen.push(name.clone());
        Ok(name)
    }
}

impl Plate {
    fn read(item: &Value, names: &mut Names<'_>) -> Result<Self> {
        let name = names.admit(item.get("name"), "plate")?;
        let fields = Fields { item, plate: &name };
        let size = fields.key::<2>("size", limits::SIZE)?;
        let position = fields.key::<3>("position", limits::POSITION)?;
        let rotation = fields.rotation()?;
        let lod = fields.lod()?;
        let picture = fields.picture()?;
        let far = fields.far(position, lod, names)?;
        Ok(Self {
            name,
            size,
            pose: Pose { position, rotation },
            lod,
            picture,
            far,
        })
    }

    fn texture_name(&self) -> String {
        [self.name.as_str(), suffix::TEXTURE].concat()
    }

    /// Дальность архетипа плашки с дальней копией без своей картинки — большая из двух (иначе копия за дальностью плашки
    /// ничего бы не рисовала); у копии со своей моделью у плашки остаётся её дальность. Дальность HD-текстуры — только плашки.
    fn archetype_distance(&self) -> f32 {
        match &self.far {
            Some(Far { own: None, lod, .. }) => lod.max(self.lod),
            _ => self.lod,
        }
    }

    /// Дальняя модель со своей картинкой: та же плашка (размер, разворот) под именем `<имя>_far`, её дальность — дальность копии.
    fn far_model(&self) -> Option<Plate> {
        let far = self.far.as_ref()?;
        Some(Plate {
            name: [self.name.as_str(), suffix::FAR].concat(),
            size: self.size,
            pose: self.pose.clone(),
            lod: far.lod,
            picture: far.own.clone()?,
            far: None,
        })
    }

    fn entity_flags(&self) -> u32 {
        match self.far {
            Some(_) => flags::ENTITY_WITH_PARENT,
            None => flags::ENTITY,
        }
    }
}

struct Request {
    donor: String,
    types: String,
    map: String,
    plates: Vec<Plate>,
}

impl Request {
    /// Модели набора по порядку хоста: сначала плашки, потом дальние модели со своей картинкой (в порядке плашек).
    fn models(&self) -> Vec<Plate> {
        let far = self.plates.iter().filter_map(Plate::far_model);
        self.plates.iter().cloned().chain(far).collect()
    }
}

fn read_request(path: &Path) -> Result<Request> {
    if !limits::REQUEST_BYTES.contains(&fs::metadata(path)?.len()) {
        return Err(refuse("Запрос эмблемы вне размера"));
    }
    let Ok(root) = serde_json::from_slice::<Value>(&fs::read(path)?) else {
        return Err(refuse("Запрос эмблемы не читается"));
    };
    let stamped = matches!(
        (root.get("format"), root.get("version")),
        (Some(Value::String(format)), Some(version))
            if format == wire::REQUEST && version.as_u64() == Some(wire::VERSION)
    );
    if !stamped {
        return Err(refuse("Запрос эмблемы другого формата"));
    }
    let Some(donor) = root.get("donor").and_then(Value::as_str) else {
        return Err(refuse("Эмблема без донора"));
    };
    let types = asset_name(root.get("typesName"), "types")?;
    let map = asset_name(root.get("mapName"), "map")?;
    if types == map {
        return Err(EngineError::argument(
            "Emblem plate types and map need different names.",
        ));
    }
    let items = match root.get("plates") {
        Some(Value::Array(items)) => items,
        _ => return Err(refuse("В запросе эмблемы нет плашек")),
    };
    if !limits::PLATES.contains(&items.len()) {
        return Err(refuse("Число плашек эмблемы вне предела"));
    }
    let mut names = Names {
        types: &types,
        map: &map,
        seen: Vec::new(),
    };
    let plates = items
        .iter()
        .map(|item| Plate::read(item, &mut names))
        .collect::<Result<Vec<_>>>()?;
    Ok(Request {
        donor: donor.to_owned(),
        types,
        map,
        plates,
    })
}

// ---------------------------------------------------------------------------
// Сборка плашек и файлов набора
// ---------------------------------------------------------------------------

/// Двусторонняя плашка и её явная рамка.
fn plate_mesh(size: [f32; 2]) -> (Mesh, ([f32; 3], [f32; 3])) {
    let (half_w, half_h) = (size[0] / 2.0, size[1] / 2.0);
    let vertices = shape::FACE_NORMALS
        .iter()
        .flat_map(|&normal| {
            shape::CORNERS.iter().map(move |&(across, up, u, v)| {
                [across * half_w, 0.0, up * half_h, 0.0, normal, 0.0, u, v]
            })
        })
        .collect();
    let indices = (0..shape::FACE_NORMALS.len())
        .flat_map(|face| {
            let base = (face * shape::CORNERS.len()) as u16;
            shape::FACE_TRIANGLES.iter().flat_map(move |triangle| {
                shape::WINDING[face].map(|corner| base + triangle[corner])
            })
        })
        .collect();
    let half = [half_w, shape::HALF_THICKNESS, half_h];
    let mesh = Mesh {
        shader: 0,
        vertices,
        indices,
    };
    (mesh, (half.map(|side| -side), half))
}

fn donor_refusal(refusal: Refusal) -> EngineError {
    EngineError::new(refusal.code(), refusal.to_string())
}

/// Донор из файла запроса: путь берётся как есть, диффузное имя — у шейдера 0.
fn open_donor(path: &str) -> Result<(Donor, String)> {
    let Ok(bytes) = fs::read(path) else {
        return Err(EngineError::new(
            "sign-donor-missing",
            "Донор эмблемы не найден.",
        ));
    };
    // Хост пишет вершины плашки в XML (`0.######`): семь значащих цифр.
    let donor = Donor::open(&bytes).map_err(donor_refusal)?.with_round(Round::Seven).without_page_padding();
    match donor.diffuse_name(0).map(str::to_owned) {
        Some(sheet) => Ok((donor, sheet)),
        None => Err(EngineError::new(
            "sign-donor-no-texture",
            "У донора эмблемы нет диффузной текстуры.",
        )),
    }
}

/// Выходная папка: существующий файл или непустая папка отказывают, иначе она создаётся.
fn prepare_output(value: &str) -> Result<PathBuf> {
    let output = paths::full_path(value)?;
    let busy = match fs::read_dir(&output) {
        Ok(mut entries) => entries.next().is_some(),
        Err(_) => output.exists(),
    };
    if busy {
        return Err(refuse("Папка вывода эмблемы не пуста"));
    }
    fs::create_dir_all(&output)?;
    Ok(output)
}

/// Описание файла в ответе: `semanticReopen` и поля, которые добавляет вид файла.
fn reopened(extra: Value) -> Value {
    let mut described = Map::new();
    described.insert("semanticReopen".to_owned(), Value::Bool(true));
    if let Value::Object(more) = extra {
        described.extend(more);
    }
    Value::Object(described)
}

/// Собранная плашка: файл модели и то, что про неё пишется в ответ.
struct Built {
    file: String,
    bytes: Vec<u8>,
    semantic: Value,
}

fn build_plate(donor: &Donor, donor_sheet: &str, plate: &Plate) -> Result<Built> {
    let [width, height] = plate.picture.sides;
    let Picture { file, sha, .. } = &plate.picture;
    let sheet = dds_sheet(file, sha, width, height, donor_sheet, &plate.name)?;
    let levels = sheet.levels;
    let (mesh, bounds) = plate_mesh(plate.size);
    // Модель плашки видна, пока видна хоть одна её сущность: у плашки с дальней копией дальность модели — большая
    // из двух (хост: `DrawDistance`), иначе дальняя копия за дальностью плашки ничего бы не рисовала.
    let packed = donor
        .pack_bounded(&[mesh], Some(plate.archetype_distance()), Some(bounds))
        .map_err(donor_refusal)?;
    let assembled = donor.apply_hosted(&packed, &[sheet], None, None).map_err(donor_refusal)?;
    let texture_name = plate.texture_name();
    let bytes = match texture_name.len() <= limits::NAME_BYTES {
        true => named_sheet_rehashed(&assembled, donor_sheet, &texture_name, &plate.name)?,
        false => return Err(refuse("Имя плашки длинное для имени текстуры")),
    };
    let semantic = reopened(table([
        ("plate", Value::from(plate.name.as_str())),
        ("size", Value::from(plate.size.map(f64::from).to_vec())),
        (
            "texture",
            table([
                ("width", Value::from(width)),
                ("height", Value::from(height)),
                ("mipLevels", Value::from(levels)),
                (
                    "sha256",
                    Value::from(sha.strip_prefix("sha256:").unwrap_or(sha)),
                ),
            ]),
        ),
    ]));
    Ok(Built {
        file: format!("{}.ydr", plate.name),
        bytes,
        semantic,
    })
}

fn archetypes_of(
    plates: &[Plate],
    bounds: &[([f32; 3], [f32; 3])],
) -> (Vec<ArchetypeSpec>, Vec<ArchetypeFields>) {
    let spec_of = |plate: &Plate, (bb_min, bb_max): ([f32; 3], [f32; 3])| ArchetypeSpec {
        name: plate.name.clone(),
        lod_dist: plate.archetype_distance(),
        bb_min,
        bb_max,
        flags: flags::ARCHETYPE,
        clip_dictionary: None,
    };
    let fields_of = |plate: &Plate| ArchetypeFields {
        hd_texture_dist: plate.lod.min(limits::HD_TEXTURE),
        ..PLAIN_FIELDS
    };
    plates
        .iter()
        .zip(bounds)
        .map(|(plate, &bounds)| (spec_of(plate, bounds), fields_of(plate)))
        .unzip()
}

/// Место сущности на карте: позиция, дальность и флаги.
struct Placement {
    position: [f32; 3],
    lod: f32,
    flags: u32,
}

/// Сущность плашки на карте `scope`; guid строится от имени карты и имени плашки.
fn entity_of(archetype: usize, plate: &Plate, scope: &str, place: Placement) -> EntitySpec {
    EntitySpec {
        archetype,
        position: place.position,
        rotation: plate.pose.rotation,
        lod_dist: place.lod,
        flags: place.flags,
        guid: Some(hash::joaat(&format!("{scope}/{}", plate.name))),
    }
}

/// Плашки с дальней копией: номер плашки в запросе, она сама и её копия.
fn far_copies(request: &Request) -> impl Iterator<Item = (usize, &Plate, &Far)> {
    request
        .plates
        .iter()
        .enumerate()
        .filter_map(|(index, plate)| plate.far.as_ref().map(|far| (index, plate, far)))
}

/// Сущности карты HD: по одной на плашку; у плашки с дальней копией связь указывает на её место в карте LOD.
fn hd_specs(request: &Request) -> (Vec<EntitySpec>, Vec<LodLink>) {
    let mut far_seen = 0;
    request
        .plates
        .iter()
        .enumerate()
        .map(|(index, plate)| {
            let place = Placement {
                position: plate.pose.position,
                lod: plate.lod,
                flags: plate.entity_flags(),
            };
            let link = match plate.far {
                Some(_) => {
                    far_seen += 1;
                    LodLink {
                        parent_index: far_seen - 1,
                        lod_level: maps::LOD_HD,
                        num_children: 0,
                        child_lod_dist: 0.0,
                    }
                }
                None => LodLink::orphan_hd(),
            };
            (entity_of(index, plate, &request.map, place), link)
        })
        .unzip()
}

/// Сущности карты LOD: по одной на каждую дальнюю плашку.
fn lod_specs(request: &Request) -> (Vec<EntitySpec>, Vec<LodLink>) {
    let scope = lod_map_name(&request.map);
    let mut own_seen = 0;
    far_copies(request)
        .map(|(index, plate, far)| {
            // Архетип копии со своей моделью стоит после архетипов плашек, в порядке плашек.
            let archetype = match far.own {
                Some(_) => {
                    own_seen += 1;
                    request.plates.len() + own_seen - 1
                }
                None => index,
            };
            let place = Placement {
                position: far.position(),
                lod: far.lod(),
                flags: flags::ENTITY,
            };
            let link = LodLink {
                parent_index: -1,
                lod_level: maps::LOD_LOD,
                num_children: 1,
                child_lod_dist: plate.lod,
            };
            (entity_of(archetype, plate, &scope, place), link)
        })
        .unzip()
}

/// Карта HD; родитель — карта LOD, если у какой-нибудь плашки есть дальняя копия.
fn hd_map(request: &Request, archetypes: &[ArchetypeSpec]) -> Result<Vec<u8>> {
    let (entities, links) = hd_specs(request);
    let lod_name = lod_map_name(&request.map);
    let parent = (far_copies(request).count() > 0).then_some(lod_name.as_str());
    let (map_flags, content_flags) = (0, 1);
    Ok(maps::compile_map_linked(
        &request.map,
        archetypes,
        &entities,
        &links,
        parent,
        map_flags,
        content_flags,
        wire::EXPORTED_BY,
        wire::EXPORT_TIME,
    )?)
}

/// Карта LOD: дальние копии, связанные с плашками карты HD.
fn lod_map(request: &Request, archetypes: &[ArchetypeSpec]) -> Result<Vec<u8>> {
    let (entities, links) = lod_specs(request);
    let (map_flags, content_flags) = (2, maps::CONTENT_LOD);
    Ok(maps::compile_map_linked(
        &lod_map_name(&request.map),
        archetypes,
        &entities,
        &links,
        None,
        map_flags,
        content_flags,
        wire::EXPORTED_BY,
        wire::EXPORT_TIME,
    )?)
}

fn record(file: &str, bytes: &[u8], semantic: Value) -> Value {
    table([
        ("file", Value::from(file)),
        ("bytes", Value::from(bytes.len())),
        ("sha256", Value::from(hash::sha256_hex(bytes))),
        ("semantic", semantic),
    ])
}

/// Все файлы вывода по порядку: плашки, дальние модели, типы, карта, карта LOD, манифест.
fn outputs(request: &Request, models: &[Plate], built: Vec<Built>) -> Result<Vec<(String, Vec<u8>, Value)>> {
    let bounds: Vec<_> = models
        .iter()
        .map(|plate| plate_mesh(plate.size).1)
        .collect();
    let (archetypes, fields) = archetypes_of(models, &bounds);
    let types = maps::compile_archetype_types(&request.types, &archetypes, &fields)?;
    let map = hd_map(request, &archetypes)?;
    let far_count = far_copies(request).count();
    let lod = match far_count {
        0 => None,
        _ => Some(lod_map(request, &archetypes)?),
    };
    let dependencies: Vec<Dependency> = std::iter::once(request.map.clone())
        .chain(lod.iter().map(|_| lod_map_name(&request.map)))
        .map(|map| Dependency {
            map,
            types: vec![request.types.clone()],
        })
        .collect();
    let manifest = manifest_write::fresh(&dependencies)?;

    let mut files: Vec<(String, Vec<u8>, Value)> = built
        .into_iter()
        .map(|plate| (plate.file, plate.bytes, plate.semantic))
        .collect();
    files.push((
        format!("{}.ytyp", request.types),
        types,
        reopened(table([("archetypes", Value::from(archetypes.len()))])),
    ));
    files.push((
        format!("{}.ymap", request.map),
        map,
        reopened(table([("entities", Value::from(request.plates.len()))])),
    ));
    files.extend(lod.map(|bytes| {
        let semantic = table([
            ("entities", Value::from(far_count)),
            ("far", Value::Bool(true)),
        ]);
        (
            format!("{}.ymap", lod_map_name(&request.map)),
            bytes,
            reopened(semantic),
        )
    }));
    files.push((
        "_manifest.ymf".to_owned(),
        manifest,
        reopened(table([(
            "imapDependencies",
            Value::from(dependencies.len()),
        )])),
    ));
    Ok(files)
}

pub const COMMANDS: &[Command] = &[Command::new("compile-emblem-plates", compile_emblem_plates)];

pub fn compile_emblem_plates(options: &Options, _: &Progress) -> Result<Value> {
    let request_file = options
        .required("input")
        .and_then(|text| paths::existing_file(text, &[".json"]))?;
    let request = read_request(&request_file)?;
    let (donor, donor_sheet) = open_donor(&request.donor)?;
    let created = FreshDirs::at(options.required("output"));
    let output = prepare_output(options.required("output")?)?;

    let models = request.models();
    let built = models
        .iter()
        .map(|plate| build_plate(&donor, &donor_sheet, plate))
        .collect::<Result<Vec<_>>>()?;
    // Запись идёт по порядку и останавливается на первом отказе.
    let answer = outputs(&request, &models, built)?
        .into_iter()
        .map(|(file, bytes, semantic)| {
            write_atomic(&output.join(&file), &bytes)?;
            Ok(record(&file, &bytes, semantic))
        })
        .collect::<Result<Vec<_>>>()?;
    created.keep();
    Ok(table([
        ("format", Value::from(wire::ANSWER)),
        ("version", Value::from(wire::VERSION)),
        ("exportedBy", Value::from(wire::EXPORTED_BY)),
        ("files", Value::Array(answer)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use rage_res::dds_build::encode_dds;
    use rage_res::{
        hash::{joaat, sha256_hex},
        placements::{LodLink, LOD_HD, LOD_LOD},
        resource_graph::Segment,
        texture::Format,
    };
    use serde_json::json;

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

        fn exec(&self, args: &[&str]) -> (Value, i32) {
            let mut argv = vec!["compile-emblem-plates".to_owned()];
            argv.extend(args.iter().map(|arg| (*arg).to_owned()));
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }

        /// Запрос в файл и запуск; `output` — папка результата.
        fn compile(&self, body: &Value, output: &str) -> (Value, i32) {
            let input = self.put("request.json", body.to_string().as_bytes());
            self.exec(&["--input", &input, "--output", output])
        }
    }

    fn refused(code: &str, message: &str) -> (Value, i32) {
        (
            json!({ "ok": false, "error": { "code": code, "message": message } }),
            1,
        )
    }

    fn argument(message: &str) -> (Value, i32) {
        refused("ArgumentException", message)
    }

    fn host(what: &str) -> (Value, i32) {
        argument(&format!("{what}: пока на хосте."))
    }

    fn plate_json(name: &str) -> Value {
        json!({
            "name": name,
            "size": [1.0, 0.5],
            "position": [1.0, 2.0, 3.0],
            "rotation": [0.0, 0.0, 0.0, 1.0],
            "lodDist": 50,
            "texture": "picture.dds",
            "textureSha256": "sha256:00",
            "width": 64,
            "height": 64,
        })
    }

    fn request_with(plates: Vec<Value>, donor: &str) -> Value {
        json!({
            "format": "astral.compile-emblem-plates",
            "version": 1,
            "donor": donor,
            "typesName": "emb_types",
            "mapName": "emb_map",
            "plates": plates,
        })
    }

    fn with(mut plate: Value, key: &str, value: Value) -> Value {
        plate[key] = value;
        plate
    }

    fn read_plate(value: &Value) -> Result<Plate> {
        let mut names = Names {
            types: "emb_types",
            map: "emb_map",
            seen: Vec::new(),
        };
        Plate::read(value, &mut names)
    }

    fn message_of(result: Result<Plate>) -> String {
        match result {
            Ok(_) => "принято".to_owned(),
            Err(error) => {
                assert_eq!(error.code, "ArgumentException");
                error.message
            }
        }
    }

    // ----------------------------------------------------------------------------------------
    // Помощники для соседних команд
    // ----------------------------------------------------------------------------------------

    #[test]
    fn texture_sides_are_powers_of_two_from_4_to_2048() {
        for side in [4u64, 8, 16, 64, 128, 512, 1024, 2048] {
            assert!(texture_side(side), "{side}");
        }
        for side in [0u64, 1, 2, 3, 5, 6, 96, 100, 2049, 4096, 1 << 40] {
            assert!(!texture_side(side), "{side}");
        }
    }

    #[test]
    fn refuse_wraps_the_words_for_the_host() {
        let error = refuse("Картинка не найдена");
        assert_eq!(error.code, "ArgumentException");
        assert_eq!(error.message, "Картинка не найдена: пока на хосте.");
    }

    fn picture(width: usize, height: usize, format: &str, mips: u32) -> Vec<u8> {
        let rgba: Vec<u8> = (0..width * height * 4)
            .map(|index| (index * 7 % 251) as u8)
            .collect();
        encode_dds(width, height, format, mips, &rgba).unwrap()
    }

    fn sha_of(bytes: &[u8]) -> String {
        format!("sha256:{}", sha256_hex(bytes))
    }

    #[test]
    fn a_full_chain_dxt5_picture_becomes_a_sheet() {
        let bench = Bench::new();
        let bytes = picture(64, 64, "DXT5", 7);
        let path = bench.put("p.dds", &bytes);
        let sheet = dds_sheet(
            Path::new(&path),
            &sha_of(&bytes),
            64,
            64,
            "donor_tex",
            "emb_a",
        )
        .unwrap();
        assert_eq!(sheet.name, "donor_tex");
        assert_eq!((sheet.width, sheet.height, sheet.levels), (64, 64, 7));
        assert_eq!(sheet.format, Format::Dxt5);
        assert_eq!(sheet.payload.len(), bytes.len() - 128);
        assert_eq!(sheet.payload, bytes[128..]);
        let wide = picture(128, 64, "DXT5", 8);
        let path = bench.put("w.dds", &wide);
        let sheet = dds_sheet(Path::new(&path), &sha_of(&wide), 128, 64, "t", "o").unwrap();
        assert_eq!((sheet.width, sheet.height, sheet.levels), (128, 64, 8));
        let tiny = picture(4, 4, "DXT5", 3);
        let path = bench.put("t.dds", &tiny);
        assert_eq!(
            dds_sheet(Path::new(&path), &sha_of(&tiny), 4, 4, "t", "o")
                .unwrap()
                .levels,
            3
        );
    }

    #[test]
    fn picture_refusals_follow_the_documented_order_and_texts() {
        let bench = Bench::new();
        let good = picture(64, 64, "DXT5", 7);
        let check = |path: &str, sha: &str, width: u64, height: u64| {
            dds_sheet(Path::new(path), sha, width, height, "t", "owner").unwrap_err()
        };
        let missing = bench.path("none.dds");
        assert_eq!(check(&missing, "", 64, 64), refuse("Картинка не найдена"));
        assert_eq!(
            check(&bench.path(""), "", 64, 64),
            refuse("Картинка не найдена")
        );
        let unsafe_size =
            EngineError::argument("Texture for owner has an unsafe file type or size.");
        let tiny = bench.put("tiny.dds", &[0u8; 127]);
        assert_eq!(check(&tiny, "whatever", 64, 64), unsafe_size);
        let huge = bench.put("huge.dds", &vec![0u8; 8 * 1024 * 1024 + 1]);
        assert_eq!(check(&huge, "whatever", 64, 64), unsafe_size);
        let path = bench.put("good.dds", &good);
        let mismatch = EngineError::argument("Texture SHA-256 mismatch for owner.");
        let plain = sha_of(&good);
        let hex = plain.strip_prefix("sha256:").unwrap().to_owned();
        for sha in [
            hex.clone(),
            plain.to_uppercase(),
            format!("SHA256:{hex}"),
            format!("sha256:sha256:{hex}"),
            String::new(),
            format!("{plain} "),
        ] {
            assert_eq!(check(&path, &sha, 64, 64), mismatch, "{sha:?}");
        }
        let junk = vec![0x41u8; 200];
        let junk_path = bench.put("junk.dds", &junk);
        let not_dds = EngineError::argument("Texture for owner is not a DDS.");
        assert_eq!(check(&junk_path, &sha_of(&junk), 64, 64), not_dds);
        let mut trailing = good.clone();
        trailing.extend_from_slice(&[1, 2, 3, 4]);
        let trailing_path = bench.put("trailing.dds", &trailing);
        assert_eq!(check(&trailing_path, &sha_of(&trailing), 64, 64), not_dds);
        let cut = good[..good.len() - 10].to_vec();
        let cut_path = bench.put("cut.dds", &cut);
        assert_eq!(check(&cut_path, &sha_of(&cut), 64, 64), not_dds);
        let header_only = good[..128].to_vec();
        let header_path = bench.put("head.dds", &header_only);
        assert_eq!(check(&header_path, &sha_of(&header_only), 64, 64), not_dds);

        let shape = |width: u64, height: u64| {
            EngineError::argument(format!(
                "Texture for owner is not {width}x{height} DXT5 with a full mip chain."
            ))
        };
        for (name, bytes) in [
            ("dxt1.dds", picture(64, 64, "DXT1", 7)),
            ("dxt3.dds", picture(64, 64, "DXT3", 7)),
            ("argb.dds", picture(64, 64, "A8R8G8B8", 7)),
            ("m6.dds", picture(64, 64, "DXT5", 6)),
            ("m1.dds", picture(64, 64, "DXT5", 1)),
            ("t32.dds", picture(32, 32, "DXT5", 6)),
        ] {
            let path = bench.put(name, &bytes);
            assert_eq!(
                check(&path, &sha_of(&bytes), 64, 64),
                shape(64, 64),
                "{name}"
            );
        }
        // В тексте — заявленные размеры.
        assert_eq!(check(&path, &plain, 64, 128), shape(64, 128));
        assert_eq!(check(&path, &plain, 128, 128), shape(128, 128));
    }

    // ----------------------------------------------------------------------------------------
    // Плашки
    // ----------------------------------------------------------------------------------------

    #[test]
    fn a_plain_plate_reads_every_field() {
        let plate = read_plate(&plate_json("emb_test")).unwrap();
        assert_eq!(plate.name, "emb_test");
        assert_eq!(plate.size, [1.0, 0.5]);
        assert_eq!(plate.pose.position, [1.0, 2.0, 3.0]);
        assert_eq!(plate.pose.rotation, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(plate.lod, 50.0);
        assert_eq!(plate.picture.sides, [64, 64]);
        assert_eq!(plate.picture.file, PathBuf::from("picture.dds"));
        assert_eq!(plate.picture.sha, "sha256:00");
        assert!(plate.far.is_none());
        assert_eq!(plate.texture_name(), "emb_test_img");
        assert_eq!(plate.archetype_distance(), 50.0);
        assert_eq!(plate.entity_flags(), 32);
    }

    #[test]
    fn plate_names_follow_the_asset_rule_and_do_not_collide() {
        let bad = "Emblem plate plate name must be lowercase letters, digits and underscores.";
        for name in [
            json!(""),
            json!("Upper"),
            json!("a b"),
            json!("a+b"),
            json!(5),
            json!(null),
            json!("é"),
            json!("_x"),
            json!("x".repeat(64)),
        ] {
            assert_eq!(
                message_of(read_plate(&with(plate_json("a"), "name", name.clone()))),
                bad,
                "{name}"
            );
        }
        let mut missing = plate_json("a");
        missing.as_object_mut().unwrap().remove("name");
        assert_eq!(message_of(read_plate(&missing)), bad);
        for item in [json!(5), json!(null), json!({}), json!([])] {
            assert_eq!(message_of(read_plate(&item)), bad);
        }
        for name in ["0plate_zero", "a", &"n".repeat(63)] {
            assert_eq!(
                message_of(read_plate(&plate_json(name))),
                "принято",
                "{name}"
            );
        }
        for name in ["emb_types", "emb_map", "emb_map_lod"] {
            assert_eq!(
                message_of(read_plate(&plate_json(name))),
                format!("Emblem plate {name} collides with the types or map name.")
            );
        }
        let mut names = Names {
            types: "emb_types",
            map: "emb_map",
            seen: Vec::new(),
        };
        assert!(Plate::read(&plate_json("dup"), &mut names).is_ok());
        let error = Plate::read(&plate_json("dup"), &mut names).err().unwrap();
        assert_eq!(error.message, "Emblem plate dup is listed twice.");
    }

    #[test]
    fn size_position_and_rotation_limits() {
        let plate =
            |key: &str, value: Value| message_of(read_plate(&with(plate_json("sz"), key, value)));
        let malformed = |what: &str| format!("Emblem plate sz {what} is malformed.");
        let range = |what: &str| format!("Emblem plate sz {what} is out of range.");
        for value in [
            json!([1]),
            json!([1, 1, 1]),
            json!(5),
            json!({}),
            json!(null),
        ] {
            assert_eq!(plate("size", value.clone()), malformed("size"), "{value}");
        }
        for value in [
            json!(["1", "1"]),
            json!([null, 1]),
            json!([0.19, 1]),
            json!([1, 0.19]),
            json!([160.5, 1]),
            json!([1, 161]),
            json!([0, 1]),
            json!([-1, 1]),
        ] {
            assert_eq!(plate("size", value.clone()), range("size"), "{value}");
        }
        for value in [json!([0.2, 0.2]), json!([160, 160]), json!([1, 1])] {
            assert_eq!(plate("size", value), "принято");
        }
        assert_eq!(plate("position", json!([1, 2])), malformed("position"));
        assert_eq!(
            plate("position", json!([1, 2, 3, 4])),
            malformed("position")
        );
        assert_eq!(plate("position", json!([20000.5, 0, 0])), range("position"));
        assert_eq!(
            plate("position", json!([0, -20000.5, 0])),
            range("position")
        );
        assert_eq!(plate("position", json!([0, 0, "z"])), range("position"));
        assert_eq!(plate("position", json!([-20000, 0, 20000])), "принято");
        assert_eq!(plate("rotation", json!([0, 0, 1])), malformed("rotation"));
        assert_eq!(plate("rotation", json!(5)), malformed("rotation"));
        assert_eq!(
            plate("rotation", json!([0, 0, 0, 1.0001])),
            range("rotation")
        );
        let unit = "Emblem plate sz rotation must be a unit quaternion.";
        assert_eq!(plate("rotation", json!([0, 0, 0, 0])), unit);
        assert_eq!(plate("rotation", json!([0.5, 0.5, 0.5, 0.4])), unit);
        assert_eq!(plate("rotation", json!([0, 0, 0, 0.9985])), unit);
        assert_eq!(plate("rotation", json!([0, 0, 0, 0.9995])), "принято");
        assert_eq!(
            plate(
                "rotation",
                json!([
                    0,
                    std::f64::consts::FRAC_1_SQRT_2,
                    0,
                    std::f64::consts::FRAC_1_SQRT_2
                ])
            ),
            "принято"
        );
    }

    #[test]
    fn draw_distance_and_picture_fields() {
        let plate =
            |key: &str, value: Value| message_of(read_plate(&with(plate_json("ld"), key, value)));
        let range = "Emblem plate ld draw distance is out of range.";
        for value in [
            json!(9.99),
            json!(2000.5),
            json!("50"),
            json!(null),
            json!(-1),
            json!(0),
        ] {
            assert_eq!(plate("lodDist", value.clone()), range, "{value}");
        }
        for value in [json!(10), json!(2000), json!(100.0), json!(50)] {
            assert_eq!(plate("lodDist", value), "принято");
        }
        let mut missing = plate_json("ld");
        missing.as_object_mut().unwrap().remove("lodDist");
        assert_eq!(message_of(read_plate(&missing)), range);
        let side = "Emblem plate ld texture must be a power of two, 4\u{2026}2048 px.";
        for value in [
            json!(0),
            json!(3),
            json!(2),
            json!(96),
            json!(4096),
            json!(-1),
            json!("64"),
            json!(null),
            json!(64.0),
            json!(6.4e1),
        ] {
            assert_eq!(plate("width", value.clone()), side, "{value}");
            assert_eq!(plate("height", value.clone()), side, "{value}");
        }
        assert_eq!(plate("width", json!(2048)), "принято");
        // Сторона проверяется раньше картинки.
        let mut no_texture = with(plate_json("ld"), "width", json!(3));
        no_texture.as_object_mut().unwrap().remove("texture");
        assert_eq!(message_of(read_plate(&no_texture)), side);
        for value in [json!(5), json!(null)] {
            let error = read_plate(&with(plate_json("ld"), "texture", value))
                .err()
                .unwrap();
            assert_eq!(error, refuse("Плашка без картинки"));
        }
        let mut no_sha = plate_json("ld");
        no_sha.as_object_mut().unwrap().remove("textureSha256");
        assert_eq!(read_plate(&no_sha).unwrap().picture.sha, "");
        assert_eq!(
            read_plate(&with(plate_json("ld"), "textureSha256", json!(5)))
                .unwrap()
                .picture
                .sha,
            ""
        );
    }

    #[test]
    fn far_copies_must_be_close_and_farther_than_their_plate() {
        let far = |value: Value| read_plate(&with(plate_json("fr"), "far", value));
        let ok = |position: Value, lod: Value| far(json!({ "position": position, "lodDist": lod }));
        let copy = ok(json!([1.0, 2.0, 5.0]), json!(400)).unwrap();
        let far_copy = copy.far.as_ref().unwrap();
        assert_eq!(far_copy.position(), [1.0, 2.0, 5.0]);
        assert_eq!(far_copy.lod(), 400.0);
        assert_eq!(copy.archetype_distance(), 400.0);
        assert_eq!(copy.entity_flags(), 40);
        assert_eq!(copy.lod, 50.0, "дальность HD остаётся у плашки");
        assert!(far(json!(null)).unwrap().far.is_none());
        assert!(read_plate(&plate_json("fr")).unwrap().far.is_none());
        // Расстояние ровно 5 м годится, чуть больше — нет.
        assert!(ok(json!([4.0, 2.0, 3.0]), json!(400)).is_ok());
        assert!(ok(json!([4.0, 6.0, 3.0]), json!(400)).is_ok());
        let away = "Emblem plate fr far copy is more than 5 m away.";
        assert_eq!(message_of(ok(json!([6.001, 2.0, 3.0]), json!(400))), away);
        assert_eq!(message_of(ok(json!([21.0, 2.0, 3.0]), json!(400))), away);
        assert_eq!(message_of(ok(json!([5.0, 5.0, 5.0]), json!(400))), away);
        // Дальность: больше дальности плашки, не больше 5000.
        let lod = "Emblem plate fr far draw distance is out of range.";
        for value in [
            json!(50),
            json!(49),
            json!(5000.5),
            json!("400"),
            json!(null),
        ] {
            assert_eq!(
                message_of(ok(json!([1.0, 2.0, 3.0]), value.clone())),
                lod,
                "{value}"
            );
        }
        assert!(ok(json!([1.0, 2.0, 3.0]), json!(50.001)).is_ok());
        assert!(ok(json!([1.0, 2.0, 3.0]), json!(5000)).is_ok());
        let no_lod = far(json!({ "position": [1.0, 2.0, 3.0] }));
        assert_eq!(message_of(no_lod), lod);
        // Позиция.
        let malformed = "Emblem plate fr far position is malformed.";
        for value in [
            json!({}),
            json!(5),
            json!("x"),
            json!([]),
            json!(true),
            json!({ "position": [1, 2] }),
            json!({ "position": "x" }),
        ] {
            assert_eq!(message_of(far(value.clone())), malformed, "{value}");
        }
        assert_eq!(
            message_of(ok(json!([30000, 0, 0]), json!(400))),
            "Emblem plate fr far position is out of range."
        );
        // Своя картинка дальней: проверки места идут раньше проверок картинки, как у хоста.
        for texture in [json!("far.dds"), json!(""), json!(false), json!(0)] {
            assert_eq!(
                message_of(far(json!({ "texture": texture, "position": "bad" }))),
                malformed,
                "{texture}"
            );
        }
        assert!(
            far(json!({ "texture": null, "position": [1.0, 2.0, 3.0], "lodDist": 400 })).is_ok()
        );
        // Ошибки плашки идут раньше ошибок `far`.
        let early = with(
            with(plate_json("fr"), "far", json!({})),
            "lodDist",
            json!(5),
        );
        assert_eq!(
            message_of(read_plate(&early)),
            "Emblem plate fr draw distance is out of range."
        );
    }

    /// Дальняя копия со своей картинкой: потолок дальности 15 км вместо 5, имя `<имя>_far` занято, стороны листа проверяются,
    /// дальность плашки в архетипе остаётся её собственной, а модель копии идёт следом за плашками.
    #[test]
    fn a_far_copy_with_its_own_picture_is_its_own_model() {
        let own = |extra: Value| {
            let mut copy = json!({ "position": [1.0, 2.0, 5.0], "lodDist": 9000, "texture": "far.dds", "textureSha256": "sha256:aa", "width": 32, "height": 16 });
            if let Value::Object(more) = extra {
                more.into_iter().for_each(|(key, value)| copy[key] = value);
            }
            read_plate(&with(plate_json("fr"), "far", copy))
        };
        let plate = own(json!({})).unwrap();
        let far = plate.far.as_ref().unwrap();
        assert_eq!(far.lod(), 9000.0);
        let picture = far.own.as_ref().expect("своя картинка");
        assert_eq!((picture.file.to_str(), picture.sha.as_str(), picture.sides), (Some("far.dds"), "sha256:aa", [32, 16]));
        assert_eq!(plate.archetype_distance(), 50.0, "у плашки со своей дальней моделью дальность архетипа — её собственная");
        assert_eq!(plate.entity_flags(), 40);
        let model = plate.far_model().expect("модель копии");
        assert_eq!((model.name.as_str(), model.size, model.lod, model.archetype_distance()), ("fr_far", [1.0, 0.5], 9000.0, 9000.0));
        assert_eq!((model.texture_name().as_str(), model.picture.sides, model.far.is_none()), ("fr_far_img", [32, 16], true));
        // Потолок дальности: 15 км со своей картинкой, 5 км без неё.
        assert!(own(json!({ "lodDist": 15000 })).is_ok());
        let lod = "Emblem plate fr far draw distance is out of range.";
        assert_eq!(message_of(own(json!({ "lodDist": 15000.5 }))), lod);
        assert_eq!(message_of(own(json!({ "lodDist": 50 }))), lod);
        assert!(read_plate(&with(plate_json("fr"), "far", json!({ "position": [1.0, 2.0, 5.0], "lodDist": 5000 }))).is_ok());
        assert_eq!(message_of(read_plate(&with(plate_json("fr"), "far", json!({ "position": [1.0, 2.0, 5.0], "lodDist": 9000 })))), lod);
        // Стороны листа: степени двойки от 4 до 2048.
        let sides = "Emblem plate fr far texture must be a power of two, 4\u{2026}2048 px.";
        for (width, height) in [(3, 16), (32, 5000), (0, 0), (63, 64)] {
            assert_eq!(message_of(own(json!({ "width": width, "height": height }))), sides, "{width}x{height}");
        }
        // Не строка в `texture` отдаётся хосту (на хосте такой запрос не читается вовсе).
        for texture in [json!(false), json!(0), json!([])] {
            assert_eq!(own(json!({ "texture": texture })).err().unwrap(), refuse("Своя картинка дальней плашки"), "{texture}");
        }
        // Имя `<имя>_far` занимает место среди имён набора.
        let mut names = Names { types: "emb_types", map: "emb_map", seen: Vec::new() };
        Plate::read(&with(plate_json("fr"), "far", json!({ "position": [1.0, 2.0, 5.0], "lodDist": 9000, "texture": "far.dds", "width": 32, "height": 16 })), &mut names).unwrap();
        assert_eq!(message_of(Plate::read(&plate_json("fr_far"), &mut names)), "Emblem plate fr_far is listed twice.");
        let mut names = Names { types: "emb_types", map: "emb_map", seen: Vec::new() };
        Plate::read(&plate_json("fr_far"), &mut names).unwrap();
        let again = with(plate_json("fr"), "far", json!({ "position": [1.0, 2.0, 5.0], "lodDist": 9000, "texture": "far.dds", "width": 32, "height": 16 }));
        assert_eq!(message_of(Plate::read(&again, &mut names)), "Emblem plate fr_far is listed twice.");
        // Имя плашки в 60 знаков не даёт имени `<имя>_far` в пределах 63.
        let long = "a".repeat(60);
        let copy = with(plate_json(&long), "far", json!({ "position": [1.0, 2.0, 5.0], "lodDist": 9000, "texture": "far.dds", "width": 32, "height": 16 }));
        assert_eq!(message_of(read_plate(&copy)), "Emblem plate far plate name must be lowercase letters, digits and underscores.");
    }

    // ----------------------------------------------------------------------------------------
    // Что строится
    // ----------------------------------------------------------------------------------------

    #[test]
    fn the_plate_mesh_is_two_sided_with_the_host_indices() {
        let (mesh, (min, max)) = plate_mesh([1.0, 0.5]);
        assert_eq!(mesh.shader, 0);
        assert_eq!(mesh.vertices.len(), 8);
        assert_eq!(mesh.indices, [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
        assert_eq!(
            mesh.vertices[0],
            [-0.5, 0.0, -0.25, 0.0, -1.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(
            mesh.vertices[1],
            [0.5, 0.0, -0.25, 0.0, -1.0, 0.0, 1.0, 1.0]
        );
        assert_eq!(mesh.vertices[2], [0.5, 0.0, 0.25, 0.0, -1.0, 0.0, 1.0, 0.0]);
        assert_eq!(
            mesh.vertices[3],
            [-0.5, 0.0, 0.25, 0.0, -1.0, 0.0, 0.0, 0.0]
        );
        assert_eq!(
            mesh.vertices[4],
            [-0.5, 0.0, -0.25, 0.0, 1.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(mesh.vertices[7][4], 1.0);
        assert_eq!(min, [-0.5, -0.01, -0.25]);
        assert_eq!(max, [0.5, 0.01, 0.25]);
    }

    #[test]
    fn archetypes_keep_the_texture_distance_with_the_plate() {
        let near = read_plate(&plate_json("p_near")).unwrap();
        let far_plate = read_plate(&with(
            plate_json("p_far"),
            "far",
            json!({ "position": [1.0, 2.0, 3.0], "lodDist": 400 }),
        ))
        .unwrap();
        let far_ten = read_plate(&with(
            with(plate_json("p_far2"), "lodDist", json!(500)),
            "far",
            json!({ "position": [1.0, 2.0, 3.0], "lodDist": 900 }),
        ))
        .unwrap();
        let bounds = [plate_mesh(near.size).1; 3];
        let (specs, fields) = archetypes_of(&[near, far_plate, far_ten], &bounds);
        assert_eq!(
            specs.iter().map(|spec| spec.lod_dist).collect::<Vec<_>>(),
            [50.0, 400.0, 900.0]
        );
        assert_eq!(
            fields
                .iter()
                .map(|field| field.hd_texture_dist)
                .collect::<Vec<_>>(),
            [50.0, 50.0, 100.0]
        );
        assert!(specs
            .iter()
            .all(|spec| spec.flags == 32 && spec.clip_dictionary.is_none()));
        assert!(fields.iter().all(|field| field.special_attribute == 0
            && field.texture_dictionary.is_none()
            && field.time_flags.is_none()));
        assert_eq!(specs[1].name, "p_far");
        assert_eq!(specs[0].bb_min, [-0.5, -0.01, -0.25]);
    }

    #[test]
    fn the_hd_and_lod_maps_link_far_plates_in_order() {
        let far = |name: &str, x: f32| {
            read_plate(&with(
                with(plate_json(name), "position", json!([x, 0.0, 0.0])),
                "far",
                json!({ "position": [x + 1.0, 0.0, 0.0], "lodDist": 300 }),
            ))
            .unwrap()
        };
        let request = Request {
            donor: String::new(),
            types: "emb_types".into(),
            map: "emb_map".into(),
            plates: vec![
                far("a_far", 1.0),
                read_plate(&plate_json("b_near")).unwrap(),
                far("c_far", 9.0),
            ],
        };
        let (entities, links) = hd_specs(&request);
        assert_eq!(
            entities
                .iter()
                .map(|entity| entity.archetype)
                .collect::<Vec<_>>(),
            [0, 1, 2]
        );
        assert_eq!(
            entities
                .iter()
                .map(|entity| entity.flags)
                .collect::<Vec<_>>(),
            [40, 32, 40]
        );
        assert_eq!(entities[0].guid, Some(joaat("emb_map/a_far")));
        assert_eq!(entities[1].guid, Some(joaat("emb_map/b_near")));
        assert_eq!(entities[2].position, [9.0, 0.0, 0.0]);
        assert_eq!(entities[0].lod_dist, 50.0);
        assert_eq!(
            links,
            [
                LodLink {
                    parent_index: 0,
                    lod_level: LOD_HD,
                    num_children: 0,
                    child_lod_dist: 0.0
                },
                LodLink::orphan_hd(),
                LodLink {
                    parent_index: 1,
                    lod_level: LOD_HD,
                    num_children: 0,
                    child_lod_dist: 0.0
                },
            ]
        );
        let (lod_entities, lod_links) = lod_specs(&request);
        assert_eq!(lod_entities.len(), 2);
        assert_eq!(
            lod_entities
                .iter()
                .map(|entity| entity.archetype)
                .collect::<Vec<_>>(),
            [0, 2]
        );
        assert_eq!(lod_entities[0].position, [2.0, 0.0, 0.0]);
        assert_eq!(lod_entities[0].lod_dist, 300.0);
        assert_eq!(lod_entities[0].flags, 32);
        assert_eq!(lod_entities[0].guid, Some(joaat("emb_map_lod/a_far")));
        assert_eq!(lod_entities[1].guid, Some(joaat("emb_map_lod/c_far")));
        assert_eq!(lod_entities[0].rotation, [0.0, 0.0, 0.0, 1.0]);
        assert!(lod_links.iter().all(|link| *link
            == LodLink {
                parent_index: -1,
                lod_level: LOD_LOD,
                num_children: 1,
                child_lod_dist: 50.0
            }));
        assert_eq!(lod_map_name("emb_map"), "emb_map_lod");
    }

    // ----------------------------------------------------------------------------------------
    // Команда
    // ----------------------------------------------------------------------------------------

    #[test]
    fn parameters_and_the_request_file_come_first() {
        let bench = Bench::new();
        assert_eq!(bench.exec(&[]), argument("--input is required."));
        assert_eq!(
            bench.exec(&["--output", "x"]),
            argument("--input is required.")
        );
        let missing = bench.path("none.json");
        assert_eq!(
            bench.exec(&["--input", &missing, "--output", "x"]),
            refused(
                "FileNotFoundException",
                &format!("File was not found: {missing}")
            )
        );
        let dds = bench.put("tex.dds", b"x");
        assert_eq!(
            bench.exec(&["--input", &dds, "--output", "x"]),
            argument("Unsupported file extension: .dds")
        );
        assert_eq!(
            bench.exec(&["--input", "", "--output", "x"]),
            argument("The path is empty.")
        );
        let call = |bytes: &[u8]| {
            let input = bench.put("r.json", bytes);
            bench.exec(&["--input", &input, "--output", &bench.path("out")])
        };
        assert_eq!(call(b""), host("Запрос эмблемы вне размера"));
        let body = request_with(vec![plate_json("p")], "d").to_string();
        let exact = format!("{body}{}", " ".repeat(262_144 - body.len()));
        assert_eq!(exact.len(), 262_144);
        assert_ne!(call(exact.as_bytes()), host("Запрос эмблемы вне размера"));
        assert_eq!(
            call(format!("{exact} ").as_bytes()),
            host("Запрос эмблемы вне размера")
        );
        for junk in [
            &b"not json"[..],
            b"\xEF\xBB\xBF{}",
            b"{} junk",
            b"{ \"a\": 1e999 }",
        ] {
            assert_eq!(call(junk), host("Запрос эмблемы не читается"), "{junk:?}");
        }
        for other in ["[]", "null", "\"s\"", "{}"] {
            assert_eq!(
                call(other.as_bytes()),
                host("Запрос эмблемы другого формата"),
                "{other}"
            );
        }
    }

    #[test]
    fn format_version_donor_field_and_names_are_checked_in_order() {
        let bench = Bench::new();
        let out = bench.path("out");
        let good = request_with(vec![plate_json("p")], "donor.ydr");
        let change = |key: &str, value: Value| {
            let mut body = good.clone();
            body[key] = value;
            bench.compile(&body, &out)
        };
        let other_format = host("Запрос эмблемы другого формата");
        assert_eq!(change("format", json!("astral.other")), other_format);
        assert_eq!(
            change("format", json!("Astral.Compile-Emblem-Plates")),
            other_format
        );
        for version in [
            json!(0),
            json!(2),
            json!(-1),
            json!("1"),
            json!(1.0),
            json!(null),
        ] {
            assert_eq!(
                change("version", version.clone()),
                other_format,
                "{version}"
            );
        }
        for donor in [json!(null), json!(5), json!(true)] {
            assert_eq!(change("donor", donor), host("Эмблема без донора"));
        }
        let name_refusal = |label: &str| {
            argument(&format!(
                "Emblem plate {label} name must be lowercase letters, digits and underscores."
            ))
        };
        for key in ["typesName", "mapName"] {
            let label = key.trim_end_matches("Name");
            for bad in [
                json!(null),
                json!(""),
                json!("Upper"),
                json!("a-b"),
                json!("_x"),
                json!("m".repeat(64)),
                json!(5),
                json!("карта"),
            ] {
                assert_eq!(change(key, bad.clone()), name_refusal(label), "{key} {bad}");
            }
        }
        let mut same = good.clone();
        same["mapName"] = json!("emb_types");
        assert_eq!(
            bench.compile(&same, &out),
            argument("Emblem plate types and map need different names.")
        );
        // Имя типов проверяется раньше имени карты и раньше донора, равенство — после обоих.
        let mut both = good.clone();
        both["typesName"] = json!("BAD");
        both["mapName"] = json!("BAD");
        assert_eq!(bench.compile(&both, &out), name_refusal("types"));
        let mut donor_and_types = good.clone();
        donor_and_types["donor"] = json!(null);
        donor_and_types["typesName"] = json!("BAD");
        assert_eq!(
            bench.compile(&donor_and_types, &out),
            host("Эмблема без донора")
        );
    }

    #[test]
    fn the_plate_list_is_checked_before_the_donor_is_read() {
        let bench = Bench::new();
        let out = bench.path("out");
        let call = |plates: Value| {
            let mut body = request_with(vec![], bench.path("missing-donor.ydr").as_str());
            body["plates"] = plates;
            bench.compile(&body, &out)
        };
        for plates in [json!(null), json!({}), json!("x"), json!(5)] {
            assert_eq!(
                call(plates.clone()),
                host("В запросе эмблемы нет плашек"),
                "{plates}"
            );
        }
        assert_eq!(call(json!([])), host("Число плашек эмблемы вне предела"));
        let many = |count: usize| {
            Value::Array(
                (0..count)
                    .map(|index| plate_json(&format!("p_{index}")))
                    .collect(),
            )
        };
        assert_eq!(call(many(97)), host("Число плашек эмблемы вне предела"));
        // 96 плашек читаются, и отказывает уже донор.
        assert_eq!(
            call(many(96)),
            refused("sign-donor-missing", "Донор эмблемы не найден.")
        );
        // Плашки читаются по очереди: первая плохая побеждает, и донор не нужен.
        let list = json!([
            with(plate_json("bad_one"), "size", json!([1])),
            plate_json("BAD NAME")
        ]);
        assert_eq!(
            call(list),
            argument("Emblem plate bad_one size is malformed.")
        );
        let list = json!([plate_json("good"), plate_json("good")]);
        assert_eq!(call(list), argument("Emblem plate good is listed twice."));
    }

    #[test]
    fn the_donor_is_read_before_the_output_folder_and_names_its_trouble() {
        let bench = Bench::new();
        let busy = bench.path("busy");
        bench.put("busy/keep.txt", b"keep");
        let missing_donor = bench.path("none.ydr");
        let body = request_with(vec![plate_json("p")], &missing_donor);
        let missing = refused("sign-donor-missing", "Донор эмблемы не найден.");
        assert_eq!(bench.compile(&body, &busy), missing);
        // Нет `--output` при плохом доноре отвечает про донора.
        let input = bench.put("r.json", body.to_string().as_bytes());
        assert_eq!(bench.exec(&["--input", &input]), missing);
        // Каталог на месте донора, пустой и мусорный файл.
        let folder = bench.path("donor-folder");
        std::fs::create_dir(&folder).unwrap();
        for donor in ["", folder.as_str()] {
            assert_eq!(
                bench.compile(&request_with(vec![plate_json("p")], donor), &busy),
                missing
            );
        }
        let empty = bench.put("empty.ydr", b"");
        let junk = bench.put(
            "junk.ydr",
            b"this is not a resource, only text of some length",
        );
        let unreadable = refused("sign-donor-not-drawable", "Донор не читается как ресурс.");
        for donor in [&empty, &junk] {
            assert_eq!(
                bench.compile(&request_with(vec![plate_json("p")], donor), &busy),
                unreadable
            );
        }
        // Папка вывода не тронута, файл в ней цел.
        assert_eq!(std::fs::read(bench.path("busy/keep.txt")).unwrap(), b"keep");
    }

    /// Отказ после создания папки вывода убирает созданное (раньше пустая папка оставалась, и повторный запуск в неё проходил).
    #[test]
    fn a_late_refusal_removes_the_folder_it_created() {
        let donor = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../resources/climbs/panika1z.ydr");
        if !donor.is_file() {
            eprintln!("донор из resources недоступен: пропущено");
            return;
        }
        let bench = Bench::new();
        let out = bench.path("made/by/failure");
        // Картинки плашки нет: отказ приходит, когда папка вывода уже создана.
        let body = request_with(vec![plate_json("p")], &donor.to_string_lossy());
        let reply = bench.compile(&body, &out);
        assert_eq!(reply.1, 1, "{}", reply.0);
        assert!(!std::path::Path::new(&bench.path("made")).exists());
        // Существующая пустая папка вывода остаётся, как была.
        let ready = bench.path("ready");
        std::fs::create_dir(&ready).unwrap();
        assert_eq!(bench.compile(&body, &ready).1, 1);
        assert!(std::path::Path::new(&ready).is_dir());
    }

    #[test]
    fn the_output_folder_rules() {
        let bench = Bench::new();
        let fresh = bench.path("a/b/new");
        let made = prepare_output(&fresh).unwrap();
        assert!(made.is_dir());
        // Существующая пустая папка годится и остаётся.
        assert_eq!(prepare_output(&fresh).unwrap(), made);
        // Файл и непустая папка отказывают, ничего не меняя.
        let file = bench.put("a-file", b"data");
        assert_eq!(
            prepare_output(&file).unwrap_err(),
            refuse("Папка вывода эмблемы не пуста")
        );
        std::fs::write(made.join("x.txt"), b"x").unwrap();
        assert_eq!(
            prepare_output(&fresh).unwrap_err(),
            refuse("Папка вывода эмблемы не пуста")
        );
        assert_eq!(std::fs::read(made.join("x.txt")).unwrap(), b"x");
        assert_eq!(
            prepare_output("").unwrap_err(),
            EngineError::argument("The path is empty.")
        );
        assert_eq!(
            prepare_output("   ").unwrap_err(),
            EngineError::argument("The path is empty.")
        );
        let dotted = prepare_output(&bench.path("x/../relative-dots")).unwrap();
        assert!(dotted.is_dir());
        assert!(!bench.dir.path().join("x").exists());
    }

    #[test]
    fn named_sheet_refuses_what_is_not_a_drawable() {
        let error = named_sheet(b"not a resource", "from", "to", "model").unwrap_err();
        assert_eq!(error.code, "InvalidOperationException");
        let error = named_sheet(&[], "from", "to", "model").unwrap_err();
        assert_eq!(error.code, "InvalidOperationException");
    }

    #[test]
    fn the_dictionary_path_names_what_the_plate_lacks() {
        use rage_res::resource_graph::from_parts;
        let graph = |system: Vec<u8>| from_parts(165, 0xA000_0000, 0x5000_0000, system, Vec::new());
        let link = |bytes: &mut Vec<u8>, at: usize, target: usize| {
            bytes[at..at + 8].copy_from_slice(&(0x5000_0000u64 + target as u64).to_le_bytes());
        };
        let words = |gap: Gap| EngineError::from(gap).message;

        assert_eq!(
            words(dictionary_address(&graph(Vec::new())).unwrap_err()),
            "Плашка без корня."
        );
        let mut bytes = vec![0u8; 0x40];
        assert_eq!(
            words(dictionary_address(&graph(bytes.clone())).unwrap_err()),
            "У плашки нет группы шейдеров."
        );
        link(&mut bytes, 0x10, 0x20);
        assert_eq!(
            words(dictionary_address(&graph(bytes.clone())).unwrap_err()),
            "У плашки нет словаря текстур."
        );
        link(&mut bytes, 0x28, 0x30);
        let at = dictionary_address(&graph(bytes)).unwrap();
        assert_eq!((at.segment, at.offset), (Segment::System, 0x30));
        assert_eq!(
            EngineError::from(Gap::GroupBlock).message,
            "Группа шейдеров плашки вне блоков."
        );
    }

    #[test]
    fn file_descriptions_start_with_the_reopen_flag_and_keep_the_key_order() {
        let line = |value: Value| value.to_string();
        assert_eq!(
            line(reopened(json!({ "entities": 3, "far": true }))),
            r#"{"semanticReopen":true,"entities":3,"far":true}"#
        );
        assert_eq!(
            line(reopened(json!({ "archetypes": 2 }))),
            r#"{"semanticReopen":true,"archetypes":2}"#
        );
        let entry = record("emb_map.ymap", b"abc", reopened(json!({ "entities": 1 })));
        assert_eq!(
            line(entry),
            r#"{"file":"emb_map.ymap","bytes":3,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","semantic":{"semanticReopen":true,"entities":1}}"#
        );
    }

    #[test]
    fn a_wrong_expectation_is_caught() {
        // Отрицательный контроль: ни 3, ни 4096 не годятся как сторона, а имя `refuse` не пустое.
        assert!(!texture_side(3) && !texture_side(4096));
        assert_ne!(refuse("a").message, refuse("b").message);
        assert_ne!(
            plate_mesh([1.0, 0.5]).0.vertices[0],
            plate_mesh([2.0, 0.5]).0.vertices[0]
        );
    }
}
