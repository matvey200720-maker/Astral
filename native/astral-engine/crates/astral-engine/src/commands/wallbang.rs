//! `build-wallbang-base`: база «прострелов» — по модели каждого объекта строятся новые архетипы, сущности исходной
//! карты копируются на них, рядом пишется манифест. Сборку делают `rage_res::wallbang` и `rage_res::placements`;
//! здесь запрос, файлы и ответ.

use std::{borrow::Cow, collections::HashSet, fs, path::Path};

use rage_res::{
    hash::sha256_hex,
    manifest_write::{self, Dependency},
    placements::{self, SourceEntity},
    wallbang::{self, Object},
    ymap_write::meta_name,
    ytyp_write::{self, TypesFile},
};
use serde_json::Value;

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.build-wallbang-base";
const ANSWER_FORMAT: &str = "astral.wallbang-base";
const VERSION: u64 = 1;
const MAX_REQUEST_BYTES: u64 = 65_536;
const MIN_FILE_BYTES: u64 = 16;
const MAX_TABLE_BYTES: u64 = 4_194_304;
const MAX_MODEL_BYTES: u64 = 16_777_216;
const MAX_OBJECTS: usize = 64;
const NAME_LIMIT: usize = 63;
const EXPORTER: &str = "Astral Wallbang Base 1";
const EXPORT_TIME: &str = "01 January 1970 00:00";
const MANIFEST_FILE: &str = "_manifest.ymf";

/// Чьё имя проверяется: от этого зависит слово в тексте отказа.
#[derive(Clone, Copy)]
enum Role {
    Types,
    Map,
    Asset,
    Source,
}

impl Role {
    fn word(self) -> &'static str {
        match self {
            Role::Types => "types",
            Role::Map => "map",
            Role::Asset => "asset",
            Role::Source => "source",
        }
    }
}

/// Отказ запроса или файлов; все — `InvalidDataException`.
enum Flaw {
    Size,
    Broken,
    Format,
    BadName(Role),
    SameNames,
    Distance,
    ObjectCount,
    Collides(String),
    Twice(Role, String),
    UnsafeSize(&'static str),
    OutputIsFile,
    OutputBusy,
}

impl Flaw {
    fn words(&self) -> Cow<'static, str> {
        match self {
            Flaw::Size => "Wallbang base request must be between 1 byte and 64 KiB.".into(),
            Flaw::Broken => "Wallbang base request is empty or broken.".into(),
            Flaw::Format => "Wallbang base request has an unknown format.".into(),
            Flaw::BadName(role) => format!(
                "Wallbang {} name must be lowercase letters, digits and underscores.",
                role.word()
            )
            .into(),
            Flaw::SameNames => "Wallbang types and map need different names.".into(),
            Flaw::Distance => "Wallbang archetype draw distance is out of range.".into(),
            Flaw::ObjectCount => "Wallbang base request must list 1…64 objects.".into(),
            Flaw::Collides(asset) => {
                format!("Wallbang asset {asset} collides with the types or map name.").into()
            }
            Flaw::Twice(role, name) => {
                format!("Wallbang {} {name} is listed twice.", role.word()).into()
            }
            Flaw::UnsafeSize(extension) => {
                format!("Wallbang file {extension} has an unsafe size.").into()
            }
            Flaw::OutputIsFile => "Wallbang base output must be a directory.".into(),
            Flaw::OutputBusy => "Wallbang base output directory must be empty.".into(),
        }
    }
}

impl From<Flaw> for EngineError {
    fn from(flaw: Flaw) -> Self {
        EngineError::invalid_data(flaw.words())
    }
}

/// Точка чтения JSON: каждый шаг вглубь может оборваться, и тогда дальше читать нечего.
#[derive(Clone, Copy)]
struct Node<'a>(Option<&'a Value>);

impl<'a> Node<'a> {
    fn at(self, key: &str) -> Self {
        Self(self.0.and_then(|value| value.get(key)))
    }

    fn text(self) -> Option<&'a str> {
        self.0?.as_str()
    }

    fn natural(self) -> Option<u64> {
        self.0?.as_u64()
    }

    fn real(self) -> Option<f64> {
        self.0?.as_f64()
    }

    fn list(self) -> Option<&'a [Value]> {
        self.0?.as_array().map(Vec::as_slice)
    }
}

fn fits_name(name: &str) -> bool {
    let plain = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    name.bytes().next().is_some_and(plain)
        && name.len() <= NAME_LIMIT
        && name.bytes().all(|byte| plain(byte) || byte == b'_')
}

/// Имя из поля запроса; не строка читается как пустая и не проходит проверку.
fn named(holder: Node, key: &str, role: Role) -> Result<String> {
    let name = holder.at(key).text().unwrap_or_default();
    fits_name(name)
        .then(|| name.to_owned())
        .ok_or_else(|| Flaw::BadName(role).into())
}

/// Файл запроса по пути из поля: расширение, размер от 16 байт до `limit`, содержимое целиком.
fn load_source(holder: Node, key: &str, extension: &'static str, limit: u64) -> Result<Vec<u8>> {
    let path = paths::existing_file(holder.at(key).text().unwrap_or_default(), &[extension])?;
    let size = fs::metadata(&path)?.len();
    (MIN_FILE_BYTES..=limit)
        .contains(&size)
        .then_some(())
        .ok_or(Flaw::UnsafeSize(extension))?;
    Ok(fs::read(&path)?)
}

/// Имена и дальность запроса вместе с объектами, у которых уже прочитаны модели.
struct Request {
    types_name: String,
    map_name: String,
    distance: f32,
    objects: Vec<Object>,
}

/// Какие имена объектов и источников уже заняты.
#[derive(Default)]
struct Taken {
    assets: HashSet<String>,
    sources: HashSet<String>,
}

impl Taken {
    /// Объект целиком: имена, отсутствие повторов и столкновений, затем модель и её рамка.
    fn admit(&mut self, item: Node, request: &Request) -> Result<Object> {
        let asset = named(item, "asset", Role::Asset)?;
        let source = named(item, "source", Role::Source)?;
        if [&request.types_name, &request.map_name].contains(&&asset) {
            return Err(Flaw::Collides(asset).into());
        }
        if !self.assets.insert(asset.clone()) {
            return Err(Flaw::Twice(Role::Asset, asset).into());
        }
        if !self.sources.insert(source.clone()) {
            return Err(Flaw::Twice(Role::Source, source).into());
        }
        let model = load_source(item, "model", ".ydr", MAX_MODEL_BYTES)?;
        let (min, max) = wallbang::model_box(&model)?;
        Ok(Object {
            asset,
            source,
            min,
            max,
        })
    }
}

impl Request {
    fn read(top: Node) -> Result<Self> {
        let known = top.at("format").text() == Some(REQUEST_FORMAT)
            && top.at("version").natural() == Some(VERSION);
        known.then_some(()).ok_or(Flaw::Format)?;
        let types_name = named(top, "typesName", Role::Types)?;
        let map_name = named(top, "mapName", Role::Map)?;
        (types_name != map_name)
            .then_some(())
            .ok_or(Flaw::SameNames)?;
        let distance = top
            .at("lodDistance")
            .real()
            .filter(|value| (10.0..=2000.0).contains(value))
            .ok_or(Flaw::Distance)? as f32;
        let listed = top
            .at("objects")
            .list()
            .filter(|list| (1..=MAX_OBJECTS).contains(&list.len()))
            .ok_or(Flaw::ObjectCount)?;
        let mut request = Self {
            types_name,
            map_name,
            distance,
            objects: Vec::new(),
        };
        let mut taken = Taken::default();
        for item in listed {
            let object = taken.admit(Node(Some(item)), &request)?;
            request.objects.push(object);
        }
        Ok(request)
    }
}

/// Исходные типы и карта мода.
struct Origin {
    types: TypesFile,
    map: Vec<SourceEntity>,
}

impl Origin {
    /// Оба файла читаются и проверяются по размеру до разбора любого из них.
    fn read(top: Node) -> Result<Self> {
        let types_bytes = load_source(top, "types", ".ytyp", MAX_TABLE_BYTES)?;
        let map_bytes = load_source(top, "map", ".ymap", MAX_TABLE_BYTES)?;
        Ok(Self {
            types: ytyp_write::read_base_types(&types_bytes)?,
            map: placements::read_entities(&map_bytes)?,
        })
    }

    /// Сущности карты, попавшие на объекты: (номер сущности, номер объекта) по хешу исходного имени.
    fn placed(&self, objects: &[Object]) -> Vec<(usize, usize)> {
        let hashes: Vec<u32> = objects
            .iter()
            .map(|object| meta_name(&object.source))
            .collect();
        self.map
            .iter()
            .enumerate()
            .filter_map(|(at, entity)| {
                hashes
                    .iter()
                    .position(|&hash| hash == entity.archetype)
                    .map(|owner| (at, owner))
            })
            .collect()
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

fn triple(values: [f32; 3]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|&value| Value::from(f64::from(value)))
            .collect(),
    )
}

fn quad(values: [f32; 4]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|&value| Value::from(f64::from(value)))
            .collect(),
    )
}

fn object_cards(objects: &[Object], placed: &[(usize, usize)]) -> Vec<Value> {
    objects
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let places = placed.iter().filter(|(_, owner)| *owner == index).count();
            object([
                ("asset", entry.asset.clone().into()),
                ("source", entry.source.clone().into()),
                ("places", places.into()),
                (
                    "bounds",
                    object([("min", triple(entry.min)), ("max", triple(entry.max))]),
                ),
            ])
        })
        .collect()
}

fn placement_cards(objects: &[Object], origin: &Origin, placed: &[(usize, usize)]) -> Vec<Value> {
    placed
        .iter()
        .map(|&(at, owner)| {
            let (entity, entry) = (&origin.map[at], &objects[owner]);
            object([
                ("asset", entry.asset.clone().into()),
                ("source", entry.source.clone().into()),
                ("position", triple(entity.position)),
                ("rotation", quad(entity.rotation)),
                ("scaleXY", 1.0.into()),
                ("scaleZ", 1.0.into()),
                ("lodDist", f64::from(entity.lod_dist).into()),
                ("flags", entity.flags.into()),
            ])
        })
        .collect()
}

/// Папка вывода: нет, либо пустая; существующий файл не годится. Созданная папка остаётся при любом отказе дальше.
fn prepare_folder(folder: &Path) -> Result<()> {
    (!folder.is_file())
        .then_some(())
        .ok_or(Flaw::OutputIsFile)?;
    fs::create_dir_all(folder)?;
    fs::read_dir(folder)?
        .next()
        .is_none()
        .then_some(())
        .ok_or(Flaw::OutputBusy)?;
    Ok(())
}

pub fn build_wallbang_base(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))?;
    let folder = options.required("output").and_then(paths::full_path)?;
    let length = fs::metadata(&input)?.len();
    (1..=MAX_REQUEST_BYTES)
        .contains(&length)
        .then_some(())
        .ok_or(Flaw::Size)?;
    let root: Value = serde_json::from_slice(&fs::read(&input)?).map_err(|_| Flaw::Broken)?;
    let top = Node(Some(&root));
    let request = Request::read(top)?;
    let origin = Origin::read(top)?;
    prepare_folder(&folder)?;

    let compiled = wallbang::build(
        &request.types_name,
        &request.map_name,
        request.distance,
        &request.objects,
        &origin.types,
        &origin.map,
        EXPORTER,
        EXPORT_TIME,
    )?;
    let manifest = placements::manifest(&request.types_name, &request.map_name)?;
    let link = Dependency {
        map: request.map_name.clone(),
        types: vec![request.types_name.clone()],
    };
    manifest_write::verify_fresh(&manifest, &[link])?;

    let placed = origin.placed(&request.objects);
    let semantic = |counter: (&str, Value)| object([("semanticReopen", true.into()), counter]);
    let outputs = [
        (
            format!("{}.ytyp", request.types_name),
            compiled.types,
            semantic(("archetypes", request.objects.len().into())),
        ),
        (
            format!("{}.ymap", request.map_name),
            compiled.map,
            semantic(("entities", placed.len().into())),
        ),
        (
            MANIFEST_FILE.to_owned(),
            manifest,
            semantic(("imapDependencies", 1.into())),
        ),
    ];
    for (file, bytes, _) in &outputs {
        write_atomic(&folder.join(file), bytes)?;
    }
    let cards: Vec<Value> = outputs
        .into_iter()
        .map(|(file, bytes, semantic)| {
            object([
                ("file", file.into()),
                ("bytes", bytes.len().into()),
                ("sha256", sha256_hex(&bytes).into()),
                ("semantic", semantic),
            ])
        })
        .collect();
    Ok(object([
        ("format", ANSWER_FORMAT.into()),
        ("version", VERSION.into()),
        ("files", cards.into()),
        ("objects", object_cards(&request.objects, &placed).into()),
        (
            "placements",
            placement_cards(&request.objects, &origin, &placed).into(),
        ),
    ]))
}

const BUILD_BASE: Command = Command::new("build-wallbang-base", build_wallbang_base);

pub const COMMANDS: &[Command] = &[BUILD_BASE];

#[cfg(test)]
mod tests;
