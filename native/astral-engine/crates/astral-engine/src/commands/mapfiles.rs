//! `inspect-map-files`: опись файлов карты (`.ymap`), типов (`.ytyp`) и родства словарей текстур (`gtxd.ymt`).
//!
//! Команда только читает входные файлы и отдаёт один JSON: размер, sha256 и разобранное содержимое каждого.
//! Файлы других видов и всё, что не разобралось, отдаётся хосту отказом со словами «пока на хосте»: ответ
//! строится по всему запросу сразу, поэтому один плохой файл отменяет всю опись.
//!
//! Устройство: каждый вид записи — таблица столбцов «ключ, чтение поля»; обход таблицы собирает объект ответа,
//! так что порядок ключей задан порядком строк таблицы.

use std::collections::{HashMap, HashSet};
use std::{
    fs,
    path::{Path, PathBuf},
};

use rage_res::{hash, meta_graph, mlo, rbf};
use serde_json::{Map, Value};

use super::{interiors, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

// ---------------------------------------------------------------------------------------------------------------
// Пределы, ключи и названия
// ---------------------------------------------------------------------------------------------------------------

mod limits {
    pub const INPUTS: usize = 4096;
    pub const YMAP_BYTES: usize = 8 << 20;
    pub const META_BYTES: usize = 16 << 20;
}

mod wire {
    pub const FORMAT: &str = "astral.map-files";
    pub const VERSION: u64 = 1;
    /// Ключ структуры обычного архетипа в файле типов; ключ помещения — `mlo::MLO_ARCHETYPE_KEY`.
    pub const BASE_ARCHETYPE_KEY: u32 = 2_411_387_556;
    pub const TXD_ROOT: &str = "CMapParentTxds";
    pub const TXD_LIST: &str = "txdRelationships";
    pub const TXD_ITEM: &str = "item";
}

const LOD_LEVELS: &[&str] = &["HD", "LOD", "SLOD1", "SLOD2", "SLOD3", "ORPHANHD", "SLOD4"];
const PRIORITY_LEVELS: &[&str] = &[
    "REQUIRED",
    "OPTIONAL_HIGH",
    "OPTIONAL_MEDIUM",
    "OPTIONAL_LOW",
];
const ASSET_TYPES: &[&str] = &[
    "uninitialized",
    "fragment",
    "drawable",
    "drawabledictionary",
    "assetless",
];

// ---------------------------------------------------------------------------------------------------------------
// Таблицы столбцов
// ---------------------------------------------------------------------------------------------------------------

type Names = HashMap<u32, String>;
type Fields = Vec<(&'static str, Value)>;

/// Читаемая строка таблицы: номер, сама запись и имена из таблицы строк файла.
struct Cell<'a, T> {
    index: usize,
    item: &'a T,
    names: &'a Names,
}

struct Column<T> {
    key: &'static str,
    read: fn(&Cell<'_, T>) -> Value,
}

const fn col<T>(key: &'static str, read: fn(&Cell<'_, T>) -> Value) -> Column<T> {
    Column { key, read }
}

fn object(fields: Fields) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<_, _>>(),
    )
}

fn fields_of<T>(columns: &[Column<T>], item: &T, names: &Names) -> Fields {
    let cell = Cell {
        index: 0,
        item,
        names,
    };
    columns
        .iter()
        .map(|column| (column.key, (column.read)(&cell)))
        .collect()
}

fn rows<T>(columns: &[Column<T>], items: &[T], names: &Names) -> Value {
    let lines = items.iter().enumerate().map(|(index, item)| {
        let cell = Cell { index, item, names };
        object(
            columns
                .iter()
                .map(|column| (column.key, (column.read)(&cell)))
                .collect(),
        )
    });
    Value::Array(lines.collect())
}

/// Имя из таблицы строк файла или `null`.
fn label(names: &Names, hash: u32) -> Value {
    match names.get(&hash) {
        Some(text) => Value::String(text.clone()),
        None => Value::Null,
    }
}

fn hex(hash: u32) -> Value {
    interiors::hash_text(hash).into()
}

fn real(value: f32) -> Value {
    interiors::float(value)
}

/// Имя значения перечисления по номеру; вне таблицы — десятичное число строкой.
fn enum_label(table: &[&str], value: i64) -> String {
    match usize::try_from(value).ok().and_then(|at| table.get(at)) {
        Some(known) => (*known).to_owned(),
        None => value.to_string(),
    }
}

/// Ориентация места карты по записанному повороту: обратный кватернион (сопряжение, делённое на сумму квадратов).
pub(super) fn orientation(rotation: [f32; 4]) -> [f32; 4] {
    if rotation == [0.0, 0.0, 0.0, 1.0] {
        return rotation;
    }
    // Сумма квадратов слева направо: порядок сложения задаёт последние знаки.
    let scale = 1.0 / rotation.iter().map(|part| part * part).sum::<f32>();
    let [x, y, z, w] = rotation;
    let [rx, ry, rz] = [x, y, z].map(|part| -part * scale);
    [rx, ry, rz, w * scale]
}

const PLACE: &[Column<mlo::CEntity>] = &[
    col("index", |c| c.index.into()),
    col("archetypeHash", |c| hex(c.item.archetype_hash)),
    col("archetypeName", |c| label(c.names, c.item.archetype_hash)),
    col("isMlo", |c| c.item.is_mlo.into()),
    col("position", |c| interiors::vector(c.item.position)),
    // Вход в помещение сохраняет записанный поворот, у остальных мест он обращается.
    col("rotation", |c| {
        let turn = &c.item.rotation;
        interiors::quaternion(match c.item.is_mlo {
            true => *turn,
            false => orientation(*turn),
        })
    }),
    col("scale", |c| {
        object(vec![
            ("xy", real(c.item.scale_xy)),
            ("z", real(c.item.scale_z)),
        ])
    }),
    col("flags", |c| c.item.flags.into()),
    col("guid", |c| c.item.guid.into()),
    col("parentIndex", |c| c.item.parent_index.into()),
    col("lodDist", |c| real(c.item.lod_dist)),
    col("childLodDist", |c| real(c.item.child_lod_dist)),
    col("numChildren", |c| c.item.num_children.into()),
    col("lodLevel", |c| {
        enum_label(LOD_LEVELS, i64::from(c.item.lod_level)).into()
    }),
    col("priorityLevel", |c| {
        enum_label(PRIORITY_LEVELS, i64::from(c.item.priority_level)).into()
    }),
    col("tintValue", |c| c.item.tint_value.into()),
];

const YMAP: &[Column<mlo::Ymap>] = &[
    col("nameHash", |c| hex(c.item.name_hash)),
    col("name", |c| label(c.names, c.item.name_hash)),
    col("parentHash", |c| hex(c.item.parent_hash)),
    col("parent", |c| label(c.names, c.item.parent_hash)),
    col("flags", |c| c.item.flags.into()),
    col("contentFlags", |c| c.item.content_flags.into()),
    col("streamingExtentsMin", |c| {
        interiors::vector(c.item.streaming_min)
    }),
    col("streamingExtentsMax", |c| {
        interiors::vector(c.item.streaming_max)
    }),
    col("entitiesExtentsMin", |c| {
        interiors::vector(c.item.entities_min)
    }),
    col("entitiesExtentsMax", |c| {
        interiors::vector(c.item.entities_max)
    }),
    col("entityCount", |c| c.item.entities.len().into()),
    col("entities", |c| rows(PLACE, &c.item.entities, c.names)),
];

const ROOM: &[Column<mlo::Room>] = &[
    col("index", |c| c.index.into()),
    col("name", |c| match &c.item.name {
        Some(text) => Value::String(text.clone()),
        None => Value::Null,
    }),
    col("bbMin", |c| interiors::vector(c.item.bb_min)),
    col("bbMax", |c| interiors::vector(c.item.bb_max)),
    col("flags", |c| c.item.flags.into()),
];

/// Предметы помещения: поворот как записан.
const INTERIOR_ENTITY: &[Column<mlo::Entity>] = &[
    col("index", |c| c.index.into()),
    col("archetypeHash", |c| hex(c.item.archetype_hash)),
    col("archetypeName", |c| label(c.names, c.item.archetype_hash)),
    col("position", |c| interiors::vector(c.item.position)),
    col("rotation", |c| interiors::quaternion(c.item.rotation)),
    col("flags", |c| c.item.flags.into()),
    col("lodDist", |c| real(c.item.lod_dist)),
    col("parentIndex", |c| c.item.parent_index.into()),
];

const ENTITY_SET: &[Column<mlo::EntitySet>] = &[
    col("index", |c| c.index.into()),
    col("name", |c| label(c.names, c.item.name_hash)),
    col("entityCount", |c| c.item.entities.len().into()),
];

const INTERIOR: &[Column<mlo::Mlo>] = &[
    col("rooms", |c| rows(ROOM, &c.item.rooms, c.names)),
    col("entities", |c| {
        rows(INTERIOR_ENTITY, &c.item.entities, c.names)
    }),
    col("entitySets", |c| {
        rows(ENTITY_SET, &c.item.entity_sets, c.names)
    }),
];

const ARCHETYPE: &[Column<mlo::Archetype>] = &[
    col("type", |c| {
        archetype_kind(c.item.kind).unwrap_or_default().into()
    }),
    col("nameHash", |c| hex(c.item.name_hash)),
    col("name", |c| label(c.names, c.item.name_hash)),
    col("assetHash", |c| hex(c.item.asset_hash)),
    col("assetName", |c| label(c.names, c.item.asset_hash)),
    col("assetType", |c| {
        enum_label(ASSET_TYPES, i64::from(c.item.asset_type)).into()
    }),
    col("textureDictionaryHash", |c| hex(c.item.texture_dictionary)),
    col("textureDictionary", |c| {
        label(c.names, c.item.texture_dictionary)
    }),
    col("drawableDictionaryHash", |c| {
        hex(c.item.drawable_dictionary)
    }),
    col("drawableDictionary", |c| {
        label(c.names, c.item.drawable_dictionary)
    }),
    col("physicsDictionaryHash", |c| hex(c.item.physics_dictionary)),
    col("clipDictionaryHash", |c| hex(c.item.clip_dictionary)),
    col("lodDist", |c| real(c.item.lod_dist)),
    col("hdTextureDist", |c| real(c.item.hd_texture_dist)),
    col("flags", |c| c.item.flags.into()),
    col("specialAttribute", |c| c.item.special_attribute.into()),
    // Время у архетипов не описывается: такие архетипы отказывают раньше.
    col("timeFlags", |_| Value::Null),
    col("bbMin", |c| interiors::vector(c.item.bb_min)),
    col("bbMax", |c| interiors::vector(c.item.bb_max)),
    col("bsCenter", |c| interiors::vector(c.item.bs_centre)),
    col("bsRadius", |c| real(c.item.bs_radius)),
    col("mlo", |c| match &c.item.mlo {
        Some(interior) => object(fields_of(INTERIOR, interior, c.names)),
        None => Value::Null,
    }),
];

const TYPES: &[Column<mlo::Ytyp>] = &[
    col("nameHash", |c| hex(c.item.name_hash)),
    col("archetypeCount", |c| c.item.archetypes.len().into()),
    col("archetypes", |c| {
        rows(ARCHETYPE, &c.item.archetypes, c.names)
    }),
];

/// Связь словарей текстур: `(потомок, родитель)`.
type Link = (String, String);

const LINK: &[Column<Link>] = &[
    col("child", |c| c.item.0.as_str().into()),
    col("childHash", |c| hex(hash::joaat(&c.item.0))),
    col("parent", |c| c.item.1.as_str().into()),
    col("parentHash", |c| hex(hash::joaat(&c.item.1))),
];

fn archetype_kind(key: u32) -> Option<&'static str> {
    match key {
        wire::BASE_ARCHETYPE_KEY => Some("CBaseArchetypeDef"),
        mlo::MLO_ARCHETYPE_KEY => Some("CMloArchetypeDef"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Разбор файлов по видам
// ---------------------------------------------------------------------------------------------------------------

/// Файл метаданных и имена из его таблицы строк.
fn load_meta(bytes: &[u8]) -> Result<(meta_graph::Read, Names)> {
    let graph = meta_graph::read(bytes)?;
    let names = mlo::name_index(&graph);
    Ok((graph, names))
}

fn describe_ymap(bytes: &[u8]) -> Result<Fields> {
    let (graph, names) = load_meta(bytes)?;
    Ok(fields_of(YMAP, &mlo::read_ymap(&graph)?, &names))
}

fn describe_ytyp(bytes: &[u8]) -> Result<Fields> {
    let (graph, names) = load_meta(bytes)?;
    let types = mlo::read_ytyp(&graph)?;
    // Неизвестный ключ архетипа отказывает всей описи, первый по порядку файла.
    if let Some(odd) = types
        .archetypes
        .iter()
        .find(|archetype| archetype_kind(archetype.kind).is_none())
    {
        return Err(interiors::unsupported(&format!(
            "Архетип типа {}",
            odd.kind
        )));
    }
    Ok(fields_of(TYPES, &types, &names))
}

fn describe_gtxd(bytes: &[u8]) -> Result<Fields> {
    let tree = match rbf::is_rbf(bytes) {
        true => rbf::read(bytes)?,
        false => return Err(interiors::unsupported("Связи словарей текстур не в RBF")),
    };
    let links = txd_links(&tree);
    let names = Names::new();
    Ok(vec![
        ("loaded", true.into()),
        ("count", links.len().into()),
        ("parents", rows(LINK, &links, &names)),
    ])
}

/// Все дочерние структуры.
fn structs_of(parent: &rbf::Struct) -> impl Iterator<Item = &rbf::Struct> {
    parent.children.iter().filter_map(|node| {
        if let rbf::Node::Struct(inner) = node {
            Some(inner)
        } else {
            None
        }
    })
}

/// Дочерние структуры с данным именем.
fn children_named<'a>(
    parent: &'a rbf::Struct,
    name: &'a str,
) -> impl Iterator<Item = &'a rbf::Struct> {
    structs_of(parent).filter(move |inner| inner.name == name)
}

/// Текст поля: байты первого потомка без нулей, знаки выше ASCII — `?`.
fn field_text(field: &rbf::Struct) -> String {
    let Some(rbf::Node::Bytes(block)) = field.children.first() else {
        return String::new();
    };
    block
        .iter()
        .copied()
        .filter(|&byte| byte != 0)
        .map(|byte| match byte {
            0..=0x7f => char::from(byte),
            _ => '?',
        })
        .collect()
}

/// Пара `(потомок, родитель)` одного элемента; повтор поля побеждает последним.
fn item_link(item: &rbf::Struct) -> Link {
    structs_of(item).fold(
        (String::new(), String::new()),
        |(child, parent), field| match field.name.as_str() {
            "parent" => (child, field_text(field)),
            "child" => (field_text(field), parent),
            _ => (child, parent),
        },
    )
}

/// Связи файла: первая запись на потомка (точное сравнение), порядок — по потомку без учёта регистра, стабильно.
fn txd_links(root: &rbf::Struct) -> Vec<Link> {
    if root.name != wire::TXD_ROOT {
        return Vec::new();
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut links: Vec<Link> = children_named(root, wire::TXD_LIST)
        .flat_map(|list| children_named(list, wire::TXD_ITEM))
        .map(item_link)
        .filter(|(child, parent)| !child.is_empty() && !parent.is_empty())
        .filter(|(child, _)| seen.insert(child.clone()))
        .collect();
    links.sort_by_cached_key(|(child, _)| child.to_ascii_uppercase());
    links
}

// ---------------------------------------------------------------------------------------------------------------
// Вид файла по имени
// ---------------------------------------------------------------------------------------------------------------

struct Kind {
    label: &'static str,
    limit: usize,
    accepts: fn(&str) -> bool,
    describe: fn(&[u8]) -> Result<Fields>,
}

fn extension_of(name: &str) -> &str {
    Path::new(name)
        .extension()
        .and_then(|part| part.to_str())
        .unwrap_or_default()
}

/// Вид по строчному имени файла: расширение, а для `.ymt` ещё и слово `gtxd` в имени.
const KINDS: &[Kind] = &[
    Kind {
        label: "ymap",
        limit: limits::YMAP_BYTES,
        accepts: |name| extension_of(name) == "ymap",
        describe: describe_ymap,
    },
    Kind {
        label: "ytyp",
        limit: limits::META_BYTES,
        accepts: |name| extension_of(name) == "ytyp",
        describe: describe_ytyp,
    },
    Kind {
        label: "gtxd",
        limit: limits::META_BYTES,
        accepts: |name| extension_of(name) == "ymt" && name.contains("gtxd"),
        describe: describe_gtxd,
    },
];

fn kind_for(name: &str) -> Option<&'static Kind> {
    KINDS.iter().find(|kind| (kind.accepts)(name))
}

/// Опись одного файла: читает, проверяет размер и собирает объект ответа.
fn read_and_describe(path: &Path, kind: &Kind) -> Result<Value> {
    let bytes = fs::read(path)?;
    if !(1..=kind.limit).contains(&bytes.len()) {
        return Err(EngineError::argument(format!(
            "Map file must be between 1 byte and {} bytes.",
            kind.limit
        )));
    }
    let mut fields: Fields = vec![
        ("input", path.to_string_lossy().into()),
        ("kind", kind.label.into()),
        ("bytes", bytes.len().into()),
        ("sha256", hash::sha256_hex(&bytes).into()),
    ];
    fields.extend((kind.describe)(&bytes)?);
    Ok(object(fields))
}

/// Опись одного файла. Любой внутренний отказ получает имя файла и слова для хоста.
fn inspect(path: &Path) -> Result<Value> {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let Some(kind) = kind_for(&name) else {
        return Err(interiors::unsupported(&format!("Файл карты {name}")));
    };
    read_and_describe(path, kind)
        .map_err(|inner| interiors::unsupported(&format!("Файл карты {name}: {}", inner.message)))
}

// ---------------------------------------------------------------------------------------------------------------
// Вход и выход команды
// ---------------------------------------------------------------------------------------------------------------

/// Значение параметра, если оно не пустое и не из одних пробелов.
fn present(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.trim().is_empty())
}

/// Записи списка `--list`; отказ чтения становится единственным элементом.
fn list_entries(file: &str) -> Vec<Result<String>> {
    let read = || -> Result<Vec<String>> {
        let full = paths::full_path(file)?;
        if !full.is_file() {
            return Err(EngineError::file_not_found(format!(
                "Input list was not found: {file}"
            )));
        }
        serde_json::from_slice(&fs::read(&full)?)
            .map_err(|_| EngineError::invalid_data("Input list must be a JSON array of paths."))
    };
    match read() {
        Ok(entries) => entries.into_iter().map(Ok).collect(),
        Err(refusal) => vec![Err(refusal)],
    }
}

/// Полный путь существующего файла; в отказе стоит значение так, как его подали.
fn resolve(value: &str) -> Result<PathBuf> {
    let full = paths::full_path(value)?;
    match full.is_file() {
        true => Ok(full),
        false => Err(EngineError::file_not_found(format!(
            "File was not found: {value}"
        ))),
    }
}

/// Пути из `--input` по порядку, затем из файла `--list`; число входов проверяется после существования всех.
fn collect_paths(options: &Options) -> Result<Vec<PathBuf>> {
    let named = options.values("input").iter().cloned().map(Ok);
    let listed = present(options.optional("list"))
        .into_iter()
        .flat_map(list_entries);
    let found = named
        .chain(listed)
        .map(|entry| entry.and_then(|text| resolve(&text)))
        .collect::<Result<Vec<_>>>()?;
    match found.len() {
        0 => Err(EngineError::invalid_data(
            "At least one --input file is required.",
        )),
        count if count > limits::INPUTS => Err(EngineError::invalid_data(
            "Too many input files for one inspection.",
        )),
        _ => Ok(found),
    }
}

fn envelope(count: usize, tail: (&'static str, Value)) -> Value {
    object(vec![
        ("format", wire::FORMAT.into()),
        ("version", wire::VERSION.into()),
        ("count", count.into()),
        tail,
    ])
}

/// Без `--output` ответ уходит целиком; иначе целиком он пишется в файл, а вызывающему идёт краткий.
fn deliver(options: &Options, files: Vec<Value>) -> Result<Value> {
    let count = files.len();
    let whole = envelope(count, ("files", Value::Array(files)));
    let Some(target) = present(options.optional("output")) else {
        return Ok(whole);
    };
    let target = paths::full_path(target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(&target, whole.to_string().as_bytes())?;
    Ok(envelope(
        count,
        ("output", target.to_string_lossy().into_owned().into()),
    ))
}

pub fn inspect_map_files(options: &Options, _progress: &Progress) -> Result<Value> {
    let files = collect_paths(options)?
        .iter()
        .map(|path| inspect(path))
        .collect::<Result<Vec<Value>>>()?;
    deliver(options, files)
}

pub const COMMANDS: &[Command] = &[Command::new("inspect-map-files", inspect_map_files)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use crate::{args::Options, error::Result, progress::Progress};
    use serde_json::json;
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};

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

        /// Образец хоста (`mod3-map.ymap`, `mod3-types.ytyp`) под своим именем.
        fn sample(&self, from: &str, name: &str) -> String {
            let bytes = fs::read(crate::test_support::engine(&format!(
                "parity/host-port/climb/{from}"
            )))
            .unwrap();
            self.put(name, &bytes)
        }

        fn call(&self, args: &[&str]) -> Result<Value> {
            let argv: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            inspect_map_files(&Options::parse(&argv)?, &Progress::silent())
        }
    }

    fn refusal(result: Result<Value>) -> (String, String) {
        let error = result.expect_err("отказ");
        (error.code, error.message)
    }

    fn denied(code: &str, message: &str) -> (String, String) {
        (code.to_owned(), message.to_owned())
    }

    fn host(message: &str) -> (String, String) {
        denied("ArgumentException", message)
    }

    // -- orientation ------------------------------------------------------------------------------------------------

    #[test]
    fn orientation_inverts_the_quaternion_as_sharpdx_does() {
        assert_eq!(orientation([0.0, 0.0, 0.0, 1.0]), [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(orientation([0.5, 0.5, 0.5, 0.5]), [-0.5, -0.5, -0.5, 0.5]);
        assert_eq!(
            orientation([1.0, 2.0, 3.0, 4.0]),
            [-0.033333335, -0.06666667, -0.10000001, 0.13333334]
        );
        let flipped = orientation([0.0, 0.0, 0.0, -1.0]);
        assert_eq!(
            flipped.map(f32::to_bits),
            [
                (-0.0f32).to_bits(),
                (-0.0f32).to_bits(),
                (-0.0f32).to_bits(),
                (-1.0f32).to_bits()
            ]
        );
        assert!(orientation([0.0; 4]).iter().all(|part| part.is_nan()));
        assert_eq!(real(orientation([0.0; 4])[0]), Value::Null);
        assert_eq!(
            orientation([0.1, 0.2, 0.3, 0.9]),
            [-0.105263166, -0.21052633, -0.3157895, 0.94736844]
        );
        // Нулевая «почти единица» не считается единицей.
        assert_ne!(orientation([0.0, 0.0, 0.0, 1.5]), [0.0, 0.0, 0.0, 1.5]);
    }

    // -- параметры и список входов ---------------------------------------------------------------------------------

    #[test]
    fn inputs_are_checked_one_by_one_before_the_list() {
        let bench = Bench::new();
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        bench.put("in/readme.txt", b"text");
        let nowhere = bench.path("in/nope.ymap");
        assert_eq!(
            refusal(bench.call(&[])),
            denied(
                "InvalidDataException",
                "At least one --input file is required."
            ),
            "M1"
        );
        assert_eq!(
            refusal(bench.call(&["--input", ""])),
            host("The path is empty."),
            "M2"
        );
        assert_eq!(
            refusal(bench.call(&["--input", "   "])),
            host("The path is empty."),
            "M3"
        );
        assert_eq!(
            refusal(bench.call(&["--input", &nowhere])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "M4"
        );
        let folder = bench.path("in");
        assert_eq!(
            refusal(bench.call(&["--input", &folder])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {folder}")
            ),
            "M5"
        );
        let readme = bench.path("in/readme.txt");
        assert_eq!(
            refusal(bench.call(&["--input", &nowhere, "--input", &readme])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "M10"
        );
        assert_eq!(
            refusal(bench.call(&["--input", &map, "--input", &nowhere])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "M11"
        );
        assert_eq!(
            refusal(bench.call(&["--input", &readme])),
            host("Файл карты readme.txt: пока на хосте."),
            "M12"
        );
        assert_eq!(
            refusal(bench.call(&["--input"])),
            host("A value is required for --input."),
            "M13"
        );
        let dotted = bench.path("in/../in/mod3-map.ymap");
        let answer = bench.call(&["--input", &dotted]).unwrap();
        assert_eq!(answer["count"], json!(1), "M6");
        assert_eq!(answer["files"][0]["input"], json!(map));
        let twice = bench.call(&["--INPUT", &map, "--input", &map]).unwrap();
        assert_eq!(twice["count"], json!(2), "M7/M9");
    }

    #[test]
    fn the_list_file_is_read_after_the_inputs_and_must_be_an_array_of_paths() {
        let bench = Bench::new();
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        let types = bench.sample("mod3-types.ytyp", "in/mod3-types.ytyp");
        let list = |name: &str, body: &str| bench.put(name, body.as_bytes());
        let listing = |paths: &[&str]| serde_json::to_string(paths).unwrap();
        let two = list("in/list-two.json", &listing(&[&map, &types]));
        let answer = bench.call(&["--list", &two]).unwrap();
        assert_eq!(answer["count"], json!(2), "M20");
        let kinds: Vec<&str> = answer["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["ymap", "ytyp"]);
        let only_txt = list("in/list-two.txt", &listing(&[&map, &types]));
        assert_eq!(
            bench.call(&["--list", &only_txt]).unwrap()["count"],
            json!(2),
            "M38b"
        );
        let wrong = denied(
            "InvalidDataException",
            "Input list must be a JSON array of paths.",
        );
        for (id, body) in [
            ("M22", "{}".to_owned()),
            ("M23", "[1,2]".to_owned()),
            (
                "M24",
                format!("[{}, 5]", serde_json::to_string(&map).unwrap()),
            ),
            ("M26", "not json".to_owned()),
            ("M27", "null".to_owned()),
            ("M29", "\"text\"".to_owned()),
            (
                "M30",
                format!("\u{feff}[{}]", serde_json::to_string(&map).unwrap()),
            ),
        ] {
            let file = list("in/bad.json", &body);
            assert_eq!(refusal(bench.call(&["--list", &file])), wrong, "{id}");
        }
        let empty = list("in/list-empty.json", "[]");
        assert_eq!(
            refusal(bench.call(&["--list", &empty])),
            denied(
                "InvalidDataException",
                "At least one --input file is required."
            ),
            "M21"
        );
        let blank = list("in/list-blank.json", "[\"\"]");
        assert_eq!(
            refusal(bench.call(&["--list", &blank])),
            host("The path is empty."),
            "M28"
        );
        let nowhere = bench.path("in/nope.ymap");
        let missing = list("in/list-missing.json", &listing(&[&map, &nowhere]));
        assert_eq!(
            refusal(bench.call(&["--list", &missing])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "M25"
        );
        let no_list = bench.path("in/nope.json");
        assert_eq!(
            refusal(bench.call(&["--list", &no_list])),
            denied(
                "FileNotFoundException",
                &format!("Input list was not found: {no_list}")
            ),
            "M31"
        );
        let folder = bench.path("in");
        assert_eq!(
            refusal(bench.call(&["--list", &folder])),
            denied(
                "FileNotFoundException",
                &format!("Input list was not found: {folder}")
            ),
            "M32"
        );
        assert_eq!(
            bench.call(&["--list", "", "--input", &map]).unwrap()["count"],
            json!(1),
            "M33"
        );
        assert_eq!(
            bench.call(&["--list", "   ", "--input", &map]).unwrap()["count"],
            json!(1),
            "M34"
        );
        let together = bench.call(&["--input", &types, "--list", &two]).unwrap();
        let kinds: Vec<&str> = together["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["ytyp", "ymap", "ytyp"], "M35");
        let bad = list("in/list-bad.json", "oops");
        assert_eq!(
            bench.call(&["--list", &bad, "--list", &two]).unwrap()["count"],
            json!(2),
            "M36"
        );
        assert_eq!(
            refusal(bench.call(&["--input", &nowhere, "--list", &no_list])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "M39"
        );
    }

    #[test]
    fn the_input_limit_is_applied_after_every_path_is_checked() {
        let bench = Bench::new();
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        let many = |count: usize, last: Option<&str>| {
            let mut paths: Vec<&str> = vec![map.as_str(); count];
            if let Some(last) = last {
                *paths.last_mut().unwrap() = last;
            }
            bench.put(
                "in/list.json",
                serde_json::to_string(&paths).unwrap().as_bytes(),
            )
        };
        let list = many(4096, None);
        let out = bench.path("out/M40.json");
        let answer = bench.call(&["--list", &list, "--output", &out]).unwrap();
        assert_eq!(answer["count"], json!(4096), "M40");
        assert_eq!(answer["output"], json!(out));
        assert!(answer.get("files").is_none());
        let list = many(4097, None);
        assert_eq!(
            refusal(bench.call(&["--list", &list])),
            denied(
                "InvalidDataException",
                "Too many input files for one inspection."
            ),
            "M41"
        );
        let nowhere = bench.path("in/nope.ymap");
        let list = many(4097, Some(&nowhere));
        assert_eq!(
            refusal(bench.call(&["--list", &list])),
            denied(
                "FileNotFoundException",
                &format!("File was not found: {nowhere}")
            ),
            "M42"
        );
        let list = many(4096, None);
        assert_eq!(
            refusal(bench.call(&["--input", &map, "--list", &list])),
            denied(
                "InvalidDataException",
                "Too many input files for one inspection."
            ),
            "M43"
        );
    }

    // -- ответ и файл вывода -----------------------------------------------------------------------------------------

    const MAP_ANSWER: &str = r#"{"format":"astral.map-files","version":1,"count":1,"files":[{"input":@INPUT@,"kind":"ymap","bytes":1182,"sha256":"197135c5ee1dd41c4cbcf8b6c28f0c1f070a28d63cb4a8cd9822a2f30dade50e","nameHash":"0x0d38c58d","name":"climb_map","parentHash":"0x00000000","parent":null,"flags":0,"contentFlags":1,"streamingExtentsMin":{"x":-90.5,"y":-100.01,"z":-80.25},"streamingExtentsMax":{"x":114.5,"y":100.01,"z":120.25},"entitiesExtentsMin":{"x":9.5,"y":-0.01,"z":19.75},"entitiesExtentsMax":{"x":14.5,"y":0.01,"z":20.25},"entityCount":3,"entities":[{"index":0,"archetypeHash":"0x057d41d5","archetypeName":null,"isMlo":false,"position":{"x":10.0,"y":0.0,"z":20.0},"rotation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0},"scale":{"xy":1.0,"z":1.0},"flags":32,"guid":3920654948,"parentIndex":-1,"lodDist":100.0,"childLodDist":0.0,"numChildren":0,"lodLevel":"ORPHANHD","priorityLevel":"REQUIRED","tintValue":0},{"index":1,"archetypeHash":"0x174de576","archetypeName":null,"isMlo":false,"position":{"x":12.0,"y":0.0,"z":20.0},"rotation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0},"scale":{"xy":1.0,"z":1.0},"flags":32,"guid":3690649337,"parentIndex":-1,"lodDist":100.0,"childLodDist":0.0,"numChildren":0,"lodLevel":"ORPHANHD","priorityLevel":"REQUIRED","tintValue":0},{"index":2,"archetypeHash":"0xa8f308c2","archetypeName":null,"isMlo":false,"position":{"x":14.0,"y":0.0,"z":20.0},"rotation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0},"scale":{"xy":1.0,"z":1.0},"flags":32,"guid":3409786238,"parentIndex":-1,"lodDist":100.0,"childLodDist":0.0,"numChildren":0,"lodLevel":"ORPHANHD","priorityLevel":"REQUIRED","tintValue":0}]}]}"#;

    const TYPES_ANSWER: &str = r#"{"format":"astral.map-files","version":1,"count":1,"files":[{"input":@INPUT@,"kind":"ytyp","bytes":511,"sha256":"ebbf309a8b647b2d57832411d20eede4edbe5dda9bb2ee9591dcd555512ad3f6","nameHash":"0xe869db4d","archetypeCount":3,"archetypes":[{"type":"CBaseArchetypeDef","nameHash":"0x057d41d5","name":null,"assetHash":"0x057d41d5","assetName":null,"assetType":"drawable","textureDictionaryHash":"0x057d41d5","textureDictionary":null,"drawableDictionaryHash":"0x00000000","drawableDictionary":null,"physicsDictionaryHash":"0x00000000","clipDictionaryHash":"0x00000000","lodDist":100.0,"hdTextureDist":100.0,"flags":32,"specialAttribute":0,"timeFlags":null,"bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"mlo":null},{"type":"CBaseArchetypeDef","nameHash":"0x174de576","name":null,"assetHash":"0x174de576","assetName":null,"assetType":"drawable","textureDictionaryHash":"0x174de576","textureDictionary":null,"drawableDictionaryHash":"0x00000000","drawableDictionary":null,"physicsDictionaryHash":"0x00000000","clipDictionaryHash":"0x00000000","lodDist":100.0,"hdTextureDist":100.0,"flags":32,"specialAttribute":0,"timeFlags":null,"bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"mlo":null},{"type":"CBaseArchetypeDef","nameHash":"0xa8f308c2","name":null,"assetHash":"0xa8f308c2","assetName":null,"assetType":"drawable","textureDictionaryHash":"0xa8f308c2","textureDictionary":null,"drawableDictionaryHash":"0x00000000","drawableDictionary":null,"physicsDictionaryHash":"0x00000000","clipDictionaryHash":"0x00000000","lodDist":100.0,"hdTextureDist":100.0,"flags":32,"specialAttribute":0,"timeFlags":null,"bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"mlo":null}]}]}"#;

    fn expected(template: &str, input: &str) -> String {
        template.replace("@INPUT@", &serde_json::to_string(input).unwrap())
    }

    #[test]
    fn a_map_and_a_types_file_are_described_to_the_last_character() {
        let bench = Bench::new();
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        let types = bench.sample("mod3-types.ytyp", "in/mod3-types.ytyp");
        assert_eq!(
            bench.call(&["--input", &map]).unwrap().to_string(),
            expected(MAP_ANSWER, &map),
            "M70"
        );
        assert_eq!(
            bench.call(&["--input", &types]).unwrap().to_string(),
            expected(TYPES_ANSWER, &types),
            "M79"
        );
        let upper = bench.sample("mod3-types.ytyp", "in/UPPER.YTYP");
        assert_eq!(
            bench.call(&["--input", &upper]).unwrap()["files"][0]["kind"],
            json!("ytyp"),
            "M16"
        );
        // Целиком через `run`: обёртка `ok` и `command` ставится вокруг ответа команды.
        let argv = [
            "inspect-map-files".to_owned(),
            "--input".to_owned(),
            map.clone(),
        ];
        let outcome = run(&argv, &Progress::silent());
        assert_eq!(outcome.exit_code, 0);
        assert_eq!(
            outcome.line,
            format!(
                r#"{{"ok":true,"command":"inspect-map-files","result":{}}}"#,
                expected(MAP_ANSWER, &map)
            )
        );
    }

    /// Полный ответ ложится через черновик рядом: имя черновика занято папкой - запись
    /// отказывает, прежний файл цел. Прямая запись молча перезаписала бы его.
    #[test]
    fn an_answer_that_cannot_be_staged_leaves_the_old_file() {
        let bench = Bench::new();
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        let out = bench.put("out/keep.json", b"old answer");
        let stage = bench.path("out/keep.json.shop-stage");
        fs::create_dir(&stage).unwrap();
        let (code, _) = refusal(bench.call(&["--input", &map, "--output", &out]));
        assert_eq!(code, "UnauthorizedAccessException");
        assert_eq!(fs::read(&out).unwrap(), b"old answer");
        assert!(Path::new(&stage).is_dir());

        fs::remove_dir(&stage).unwrap();
        assert!(bench.call(&["--input", &map, "--output", &out]).is_ok());
        assert!(fs::read(&out).unwrap().starts_with(b"{"));
        assert!(!Path::new(&stage).exists());
    }

    #[test]
    fn the_output_file_holds_the_whole_answer() {
        let bench = Bench::new();
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        let out = bench.path("out/M50.json");
        let brief = bench.call(&["--input", &map, "--output", &out]).unwrap();
        assert_eq!(
            brief.to_string(),
            format!(
                r#"{{"format":"astral.map-files","version":1,"count":1,"output":{}}}"#,
                serde_json::to_string(&out).unwrap()
            ),
            "M50"
        );
        assert_eq!(
            fs::read_to_string(&out).unwrap(),
            expected(MAP_ANSWER, &map)
        );
        let nested = bench.path("out/nest/a/b/M53.json");
        assert!(
            bench.call(&["--input", &map, "--output", &nested]).is_ok(),
            "M53"
        );
        assert!(Path::new(&nested).is_file());
        let odd = bench.path("out/папка с пробелом/файл.json");
        assert!(
            bench.call(&["--input", &map, "--output", &odd]).is_ok(),
            "M64"
        );
        for name in ["out/M54.bin", "out/M55"] {
            let path = bench.path(name);
            assert!(
                bench.call(&["--input", &map, "--output", &path]).is_ok(),
                "M54/M55"
            );
            assert!(Path::new(&path).is_file());
        }
        // Существующий файл заменяется, последний --output побеждает.
        assert!(
            bench.call(&["--input", &map, "--output", &out]).is_ok(),
            "M57"
        );
        let (first, second) = (bench.path("out/M63a.json"), bench.path("out/M63b.json"));
        let brief = bench
            .call(&["--input", &map, "--output", &first, "--output", &second])
            .unwrap();
        assert_eq!(brief["output"], json!(second), "M63");
        assert!(!Path::new(&first).exists());
        // Пустое и пробельное значение — как нет.
        assert!(
            bench
                .call(&["--input", &map, "--output", ""])
                .unwrap()
                .get("files")
                .is_some(),
            "M51"
        );
        assert!(
            bench
                .call(&["--input", &map, "--output", "   "])
                .unwrap()
                .get("files")
                .is_some(),
            "M52"
        );
        // Каталог на месте файла.
        let folder = bench.path("out/nest");
        assert_eq!(
            refusal(bench.call(&["--input", &map, "--output", &folder])).0,
            "UnauthorizedAccessException",
            "M56"
        );
        // Отказ описи не оставляет ни файла, ни папок.
        let readme = bench.put("in/readme.txt", b"x");
        let (file, dir) = (bench.path("out/M58.json"), bench.path("out/M59dir/x.json"));
        for target in [&file, &dir] {
            assert_eq!(
                refusal(bench.call(&["--input", &readme, "--output", target])),
                host("Файл карты readme.txt: пока на хосте."),
                "M58/M59"
            );
        }
        assert!(!Path::new(&file).exists() && !Path::new(&bench.path("out/M59dir")).exists());
        let nowhere = bench.path("in/nope.ymap");
        assert_eq!(
            refusal(bench.call(&["--input", &nowhere, "--output", &file])).0,
            "FileNotFoundException",
            "M60"
        );
    }

    // -- виды файлов и отказы описи -------------------------------------------------------------------------------

    #[test]
    fn names_and_kinds_decide_what_is_read() {
        let bench = Bench::new();
        let cases = [
            ("in/model.ydr", "Файл карты model.ydr: пока на хосте."),
            ("in/Model.YDD", "Файл карты model.ydd: пока на хосте."),
            ("in/noext", "Файл карты noext: пока на хосте."),
            ("in/other.ymt", "Файл карты other.ymt: пока на хосте."),
            ("in/gtxd.meta", "Файл карты gtxd.meta: пока на хосте."),
            ("in/empty.ymt", "Файл карты empty.ymt: пока на хосте."),
            (
                "in/gtxd.ymap",
                "Файл карты gtxd.ymap: Файл не является ресурсом RSC7.: пока на хосте.",
            ),
            (
                "in/garbage.ymap",
                "Файл карты garbage.ymap: Файл не является ресурсом RSC7.: пока на хосте.",
            ),
        ];
        for (name, message) in cases {
            let file = bench.put(name, b"not a resource at all, just text");
            assert_eq!(
                refusal(bench.call(&["--input", &file])),
                host(message),
                "{name}"
            );
        }
        let kind_of = |name: &str| kind_for(name).map(|kind| kind.label);
        assert_eq!(kind_of("a.ymap"), Some("ymap"));
        assert_eq!(kind_of("gtxd-upper.ymt"), Some("gtxd"));
        assert_eq!(kind_of("a."), None);
        assert_eq!(kind_of(".ymap"), None);
    }

    #[test]
    fn sizes_and_garbage_are_refused_with_the_host_words() {
        let bench = Bench::new();
        let go = |name: &str, bytes: &[u8]| {
            let file = bench.put(name, bytes);
            refusal(bench.call(&["--input", &file]))
        };
        let size = |name: &str, limit: u32| {
            host(&format!("Файл карты {name}: Map file must be between 1 byte and {limit} bytes.: пока на хосте."))
        };
        assert_eq!(
            go("in/zero.ymap", b""),
            size("zero.ymap", 8_388_608),
            "M121"
        );
        assert_eq!(
            go("in/zero.ytyp", b""),
            size("zero.ytyp", 16_777_216),
            "M122"
        );
        assert_eq!(
            go("in/one.ymap", b"x"),
            host("Файл карты one.ymap: Ресурс короче заголовка RSC7.: пока на хосте."),
            "M123"
        );
        assert_eq!(
            go("in/garbage.ytyp", b"not a resource at all, just text"),
            host("Файл карты garbage.ytyp: Файл не является ресурсом RSC7.: пока на хосте."),
            "M125"
        );
        assert_eq!(
            go("in/zeros16.ymap", &[0u8; 16]),
            host("Файл карты zeros16.ymap: Файл не является ресурсом RSC7.: пока на хосте."),
            "M126"
        );
        let mut header = b"RSC7".to_vec();
        header.extend_from_slice(&[0; 12]);
        assert_eq!(
            go("in/rsc7-only.ymap", &header),
            host(
                "Файл карты rsc7-only.ymap: Поток ресурса пуст или не распакован.: пока на хосте."
            ),
            "M127"
        );
        assert_eq!(
            go("in/big-ymap-8M.ymap", &vec![0u8; 8_388_608]),
            host("Файл карты big-ymap-8m.ymap: Файл не является ресурсом RSC7.: пока на хосте."),
            "M128"
        );
        assert_eq!(
            go("in/big-ymap-8M1.ymap", &vec![0u8; 8_388_609]),
            size("big-ymap-8m1.ymap", 8_388_608),
            "M129"
        );
        assert_eq!(
            go("in/big-ytyp-16M.ytyp", &vec![0u8; 16_777_216]),
            host("Файл карты big-ytyp-16m.ytyp: Файл не является ресурсом RSC7.: пока на хосте."),
            "M130"
        );
        assert_eq!(
            go("in/big-ytyp-16M1.ytyp", &vec![0u8; 16_777_217]),
            size("big-ytyp-16m1.ytyp", 16_777_216),
            "M131"
        );
        assert_eq!(
            go("in/big-gtxd-16M1.ymt", &vec![0u8; 16_777_217]),
            size("big-gtxd-16m1.ymt", 16_777_216),
            "M132"
        );
        assert_eq!(
            go("in/gtxd-empty.ymt", b""),
            size("gtxd-empty.ymt", 16_777_216),
            "M109"
        );
        // Одна плохая опись отменяет весь ответ.
        let map = bench.sample("mod3-map.ymap", "in/mod3-map.ymap");
        let garbage = bench.path("in/garbage.ymap");
        bench.put("in/garbage.ymap", b"not a resource at all, just text");
        assert_eq!(
            refusal(bench.call(&["--input", &map, "--input", &garbage])),
            host("Файл карты garbage.ymap: Файл не является ресурсом RSC7.: пока на хосте."),
            "M133"
        );
        let wrong_kind = bench.sample("mod3-map.ymap", "in/ymap-as.ytyp");
        assert_eq!(
            refusal(bench.call(&["--input", &wrong_kind])),
            host("Файл карты ymap-as.ytyp: В метаданных нет поля archetypes.: пока на хосте."),
            "M87"
        );
        let wrong_kind = bench.sample("mod3-types.ytyp", "in/ytyp-as.ymap");
        assert_eq!(
            refusal(bench.call(&["--input", &wrong_kind])),
            host("Файл карты ytyp-as.ymap: В метаданных нет поля entities.: пока на хосте."),
            "M88"
        );
    }

    // -- места карты с подставными полями --------------------------------------------------------------------------

    struct Place {
        hash: u32,
        flags: u32,
        position: Option<[f32; 3]>,
        rotation: Option<[f32; 4]>,
        scale: (f32, f32),
        parent: i32,
        lods: (f32, f32),
        level: i32,
        children: u32,
        priority: i32,
    }

    impl Place {
        fn new(hash: u32) -> Self {
            Self {
                hash,
                flags: 32,
                position: None,
                rotation: None,
                scale: (1.0, 1.0),
                parent: -1,
                lods: (100.0, 0.0),
                level: 5,
                children: 0,
                priority: 0,
            }
        }
    }

    /// Копия `mod3-map.ymap` с переписанными полями мест (как в описании): тело распаковывается, правится и сжимается заново.
    fn edited_map(places: &[Place]) -> Vec<u8> {
        let original = fs::read(crate::test_support::engine(
            "parity/host-port/climb/mod3-map.ymap",
        ))
        .unwrap();
        let mut body = miniz_oxide::inflate::decompress_to_vec(&original[16..]).unwrap();
        for place in places {
            let at = (0..body.len().saturating_sub(128))
                .step_by(16)
                .find(|&at| {
                    body[at + 8..at + 12] == place.hash.to_le_bytes()
                        && body[at + 12..at + 16] == 32u32.to_le_bytes()
                        && body[at + 84..at + 88] == 5u32.to_le_bytes()
                })
                .expect("запись места");
            let put = |body: &mut Vec<u8>, offset: usize, bytes: &[u8]| {
                body[at + offset..at + offset + bytes.len()].copy_from_slice(bytes)
            };
            put(&mut body, 12, &place.flags.to_le_bytes());
            if let Some(position) = place.position {
                position
                    .iter()
                    .enumerate()
                    .for_each(|(axis, value)| put(&mut body, 32 + axis * 4, &value.to_le_bytes()));
            }
            if let Some(rotation) = place.rotation {
                rotation
                    .iter()
                    .enumerate()
                    .for_each(|(axis, value)| put(&mut body, 48 + axis * 4, &value.to_le_bytes()));
            }
            put(&mut body, 64, &place.scale.0.to_le_bytes());
            put(&mut body, 68, &place.scale.1.to_le_bytes());
            put(&mut body, 72, &place.parent.to_le_bytes());
            put(&mut body, 76, &place.lods.0.to_le_bytes());
            put(&mut body, 80, &place.lods.1.to_le_bytes());
            put(&mut body, 84, &place.level.to_le_bytes());
            put(&mut body, 88, &place.children.to_le_bytes());
            put(&mut body, 92, &place.priority.to_le_bytes());
        }
        let mut out = original[..16].to_vec();
        out.extend(miniz_oxide::deflate::compress_to_vec(&body, 9));
        out
    }

    fn entities_of(bench: &Bench, bytes: &[u8]) -> Vec<Value> {
        let file = bench.put("in/edited.ymap", bytes);
        bench.call(&["--input", &file]).unwrap()["files"][0]["entities"]
            .as_array()
            .unwrap()
            .clone()
    }

    fn field(entity: &Value, key: &str) -> String {
        entity[key].to_string()
    }

    #[test]
    fn levels_priorities_and_rotations_are_named_and_inverted() {
        let bench = Bench::new();
        // lod-a
        let first = Place {
            flags: 7,
            rotation: Some([0.5, 0.5, 0.5, 0.5]),
            scale: (2.0, 3.0),
            parent: 5,
            lods: (250.5, 33.25),
            level: 0,
            children: 4,
            priority: 0,
            ..Place::new(0x057d41d5)
        };
        let second = Place {
            level: 1,
            priority: 1,
            ..Place::new(0x174de576)
        };
        let third = Place {
            rotation: Some([1.0, 2.0, 3.0, 4.0]),
            level: 2,
            priority: 2,
            ..Place::new(0xa8f308c2)
        };
        let found = entities_of(&bench, &edited_map(&[first, second, third]));
        assert_eq!(
            field(&found[0], "rotation"),
            r#"{"x":-0.5,"y":-0.5,"z":-0.5,"w":0.5}"#
        );
        assert_eq!(field(&found[0], "scale"), r#"{"xy":2.0,"z":3.0}"#);
        assert_eq!(
            (
                field(&found[0], "flags"),
                field(&found[0], "parentIndex"),
                field(&found[0], "lodDist"),
                field(&found[0], "childLodDist"),
                field(&found[0], "numChildren")
            ),
            (
                "7".into(),
                "5".into(),
                "250.5".into(),
                "33.25".into(),
                "4".into()
            )
        );
        assert_eq!(
            (
                field(&found[0], "lodLevel"),
                field(&found[0], "priorityLevel")
            ),
            (r#""HD""#.into(), r#""REQUIRED""#.into())
        );
        assert_eq!(
            (
                field(&found[1], "lodLevel"),
                field(&found[1], "priorityLevel")
            ),
            (r#""LOD""#.into(), r#""OPTIONAL_HIGH""#.into())
        );
        assert_eq!(
            field(&found[2], "rotation"),
            r#"{"x":-0.033333335,"y":-0.06666667,"z":-0.10000001,"w":0.13333334}"#
        );
        assert_eq!(
            (
                field(&found[2], "lodLevel"),
                field(&found[2], "priorityLevel")
            ),
            (r#""SLOD1""#.into(), r#""OPTIONAL_MEDIUM""#.into())
        );
        // lod-b: нулевой кватернион даёт null, [0, 0, 0, -1] — минус ноль.
        let first = Place {
            rotation: Some([0.0, 0.0, 0.0, -1.0]),
            level: 3,
            priority: 3,
            ..Place::new(0x057d41d5)
        };
        let second = Place {
            rotation: Some([0.0; 4]),
            level: 4,
            priority: 4,
            ..Place::new(0x174de576)
        };
        let third = Place {
            rotation: Some([0.1, 0.2, 0.3, 0.9]),
            level: 5,
            priority: 255,
            ..Place::new(0xa8f308c2)
        };
        let found = entities_of(&bench, &edited_map(&[first, second, third]));
        assert_eq!(
            field(&found[0], "rotation"),
            r#"{"x":-0.0,"y":-0.0,"z":-0.0,"w":-1.0}"#
        );
        assert_eq!(
            field(&found[1], "rotation"),
            r#"{"x":null,"y":null,"z":null,"w":null}"#
        );
        assert_eq!(
            field(&found[2], "rotation"),
            r#"{"x":-0.105263166,"y":-0.21052633,"z":-0.3157895,"w":0.94736844}"#
        );
        assert_eq!(
            (
                field(&found[0], "lodLevel"),
                field(&found[0], "priorityLevel")
            ),
            (r#""SLOD2""#.into(), r#""OPTIONAL_LOW""#.into())
        );
        assert_eq!(
            (
                field(&found[1], "lodLevel"),
                field(&found[1], "priorityLevel")
            ),
            (r#""SLOD3""#.into(), r#""4""#.into())
        );
        assert_eq!(
            (
                field(&found[2], "lodLevel"),
                field(&found[2], "priorityLevel")
            ),
            (r#""ORPHANHD""#.into(), r#""255""#.into())
        );
        // lod-c: неизвестные значения, большие и малые числа.
        let first = Place {
            rotation: Some([-0.5, 0.5, -0.5, 0.5]),
            level: 6,
            priority: -1,
            ..Place::new(0x057d41d5)
        };
        let second = Place {
            level: 7,
            priority: 2_147_483_647,
            ..Place::new(0x174de576)
        };
        let third = Place {
            position: Some([123_456.79, -0.5, 1e-7]),
            level: -1,
            ..Place::new(0xa8f308c2)
        };
        let found = entities_of(&bench, &edited_map(&[first, second, third]));
        assert_eq!(
            field(&found[0], "rotation"),
            r#"{"x":0.5,"y":-0.5,"z":0.5,"w":0.5}"#
        );
        assert_eq!(
            (
                field(&found[0], "lodLevel"),
                field(&found[0], "priorityLevel")
            ),
            (r#""SLOD4""#.into(), r#""-1""#.into())
        );
        assert_eq!(
            (
                field(&found[1], "lodLevel"),
                field(&found[1], "priorityLevel")
            ),
            (r#""7""#.into(), r#""2147483647""#.into())
        );
        assert_eq!(
            field(&found[2], "position"),
            r#"{"x":123456.79,"y":-0.5,"z":1e-7}"#
        );
        assert_eq!(field(&found[2], "lodLevel"), r#""-1""#);
    }

    #[test]
    fn a_known_name_comes_from_the_string_table() {
        let bench = Bench::new();
        // named.ymap: хэш архетипа первого места заменён хэшем имени самой карты.
        let mut bytes = edited_map(&[]);
        let mut body = miniz_oxide::inflate::decompress_to_vec(&bytes[16..]).unwrap();
        let at = (0..body.len() - 128)
            .step_by(16)
            .find(|&at| body[at + 8..at + 12] == 0x057d41d5u32.to_le_bytes())
            .unwrap();
        body[at + 8..at + 12].copy_from_slice(&0x0d38c58du32.to_le_bytes());
        bytes.truncate(16);
        bytes.extend(miniz_oxide::deflate::compress_to_vec(&body, 9));
        let found = entities_of(&bench, &bytes);
        assert_eq!(found[0]["archetypeName"], json!("climb_map"));
        assert_eq!(found[0]["archetypeHash"], json!("0x0d38c58d"));
        assert_eq!(found[1]["archetypeName"], Value::Null);
    }

    // -- родство словарей текстур -----------------------------------------------------------------------------------

    /// RBF по описанию: `idx 00 | длина имени u16 | имя | 6 нулей`, закрытие `ff ff`, байты `fd ff | длина u32 | данные`.
    #[derive(Default)]
    struct Rbf {
        bytes: Vec<u8>,
        names: Vec<String>,
    }

    impl Rbf {
        fn new() -> Self {
            Self {
                bytes: b"RBF0".to_vec(),
                names: Vec::new(),
            }
        }

        fn open(&mut self, name: &str) -> &mut Self {
            match self.names.iter().position(|known| known == name) {
                Some(index) => self.bytes.extend([index as u8, 0]),
                None => {
                    self.bytes.extend([self.names.len() as u8, 0]);
                    self.bytes.extend((name.len() as u16).to_le_bytes());
                    self.bytes.extend(name.as_bytes());
                    self.names.push(name.to_owned());
                }
            }
            self.bytes.extend([0; 6]);
            self
        }

        /// Значение без содержимого (тип `20`).
        fn value(&mut self, name: &str) -> &mut Self {
            match self.names.iter().position(|known| known == name) {
                Some(index) => self.bytes.extend([index as u8, 0x20]),
                None => {
                    self.bytes.extend([self.names.len() as u8, 0x20]);
                    self.bytes.extend((name.len() as u16).to_le_bytes());
                    self.bytes.extend(name.as_bytes());
                    self.names.push(name.to_owned());
                }
            }
            self
        }

        fn text(&mut self, text: &[u8]) -> &mut Self {
            self.bytes.extend([0xfd, 0xff]);
            self.bytes.extend((text.len() as u32).to_le_bytes());
            self.bytes.extend(text);
            self
        }

        fn close(&mut self) -> &mut Self {
            self.bytes.extend([0xff, 0xff]);
            self
        }

        fn field(&mut self, name: &str, text: &[u8]) -> &mut Self {
            self.open(name).text(text).close()
        }

        /// Пара «потомок, родитель» как элемент `item`.
        fn item(&mut self, child: &[u8], parent: &[u8]) -> &mut Self {
            self.open("item")
                .field("parent", parent)
                .field("child", child)
                .close()
        }
    }

    fn txd(pairs: &[(&str, &str)]) -> Vec<u8> {
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds").open("txdRelationships");
        for (child, parent) in pairs {
            rbf.item(child.as_bytes(), parent.as_bytes());
        }
        rbf.close().close();
        rbf.bytes
    }

    fn parents_of(bench: &Bench, name: &str, bytes: &[u8]) -> Value {
        let file = bench.put(name, bytes);
        bench.call(&["--input", &file]).unwrap()["files"][0].clone()
    }

    fn links(parents: &Value) -> Vec<(String, String)> {
        parents["parents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|link| {
                (
                    link["child"].as_str().unwrap().to_owned(),
                    link["parent"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    }

    fn pair(child: &str, parent: &str) -> (String, String) {
        (child.to_owned(), parent.to_owned())
    }

    #[test]
    fn relationships_are_sorted_by_child_without_case_and_hashed() {
        let bench = Bench::new();
        let small = txd(&[
            ("Zed", "p_b"),
            ("alpha", "p_a"),
            ("gamma", "P_D"),
            ("Beta", "p_c"),
        ]);
        let answer = parents_of(&bench, "in/gtxd-small.ymt", &small);
        assert_eq!(answer["kind"], json!("gtxd"));
        assert_eq!(
            (answer["loaded"].clone(), answer["count"].clone()),
            (json!(true), json!(4))
        );
        assert_eq!(
            answer["parents"].to_string(),
            r#"[{"child":"alpha","childHash":"0x2db8d1aa","parent":"p_a","parentHash":"0xeeeff4cc"},{"child":"Beta","childHash":"0xf678efb4","parent":"p_c","parentHash":"0xbc820ff1"},{"child":"gamma","childHash":"0x606ae898","parent":"P_D","parentHash":"0x0876a7dd"},{"child":"Zed","childHash":"0x28a2f1bb","parent":"p_b","parentHash":"0x2a2b6b46"}]"#,
            "M62/M90"
        );
        assert_eq!(answer["bytes"], json!(small.len()));
        // M110: цифры, затем буквы без различия регистра, затем «_»; равные остаются в порядке файла.
        let sorted = parents_of(
            &bench,
            "in/gtxd-sort-case.ymt",
            &txd(&[
                ("b", "p"),
                ("A", "p"),
                ("a", "p"),
                ("B", "p"),
                ("_x", "p"),
                ("9z", "p"),
                ("Zz", "p"),
            ]),
        );
        let order: Vec<String> = links(&sorted).into_iter().map(|(child, _)| child).collect();
        assert_eq!(order, ["9z", "A", "a", "b", "B", "Zz", "_x"], "M110");
        let hashes: Vec<&str> = sorted["parents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|link| link["childHash"].as_str().unwrap())
            .collect();
        assert_eq!(hashes[0], "0xf369247b");
        assert_eq!(hashes[1], "0xca2e9442");
        // M91: повтор потомка — остаётся первая запись, имена с разным регистром — разные потомки.
        let dups = parents_of(
            &bench,
            "in/gtxd-dups.ymt",
            &txd(&[("dup", "p1"), ("dup", "p3"), ("DUP", "p2"), ("other", "p4")]),
        );
        assert_eq!(
            links(&dups),
            [pair("dup", "p1"), pair("DUP", "p2"), pair("other", "p4")],
            "M91"
        );
        // M92: пустые поля пропускаются.
        let empty = parents_of(
            &bench,
            "in/gtxd-empty-fields.ymt",
            &txd(&[("", "p1"), ("c2", ""), ("", ""), ("c4", "p4")]),
        );
        assert_eq!(links(&empty), [pair("c4", "p4")], "M92");
    }

    #[test]
    fn zeros_and_high_bytes_in_names_are_cleaned_before_hashing() {
        let bench = Bench::new();
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds").open("txdRelationships");
        rbf.item(b"c\0h", b"p\0a");
        rbf.item(&[b'c', b'h', 0xff, b'z'], &[b'p', b'a', 0xff]);
        rbf.close().close();
        let answer = parents_of(&bench, "in/gtxd-nul-ascii.ymt", &rbf.bytes);
        assert_eq!(
            links(&answer),
            [pair("ch", "pa"), pair("ch?z", "pa?")],
            "M93"
        );
        let hashes: Vec<&str> = answer["parents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|link| link["childHash"].as_str().unwrap())
            .collect();
        assert_eq!(hashes, ["0x4ab1a5ab", "0xd03b1813"]);
    }

    #[test]
    fn the_tree_decides_which_relationships_count() {
        let bench = Bench::new();
        let count = |name: &str, bytes: &[u8]| parents_of(&bench, name, bytes)["count"].clone();
        // M94: нет элементов; M95: нет списка.
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds")
            .open("txdRelationships")
            .close()
            .close();
        assert_eq!(count("in/gtxd-no-items.ymt", &rbf.bytes), json!(0), "M94");
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds").close();
        assert_eq!(count("in/gtxd-no-list.ymt", &rbf.bytes), json!(0), "M95");
        // M96: корень другой.
        let mut rbf = Rbf::new();
        rbf.open("Other")
            .open("txdRelationships")
            .item(b"c", b"p")
            .close()
            .close();
        assert_eq!(count("in/gtxd-other-root.ymt", &rbf.bytes), json!(0), "M96");
        // M97: элемент не `item`; M98: поле не байтовое; M99: два списка.
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds").open("txdRelationships");
        rbf.open("other")
            .field("parent", b"p9")
            .field("child", b"c9")
            .close();
        rbf.item(b"c1", b"p1");
        rbf.close().close();
        assert_eq!(count("in/gtxd-other-item.ymt", &rbf.bytes), json!(1), "M97");
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds").open("txdRelationships");
        rbf.open("item");
        rbf.open("parent").value("v");
        rbf.close();
        rbf.field("child", b"c1").close();
        rbf.item(b"c2", b"p2");
        rbf.close().close();
        assert_eq!(
            count("in/gtxd-field-not-bytes.ymt", &rbf.bytes),
            json!(1),
            "M98"
        );
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds");
        rbf.open("txdRelationships").item(b"c1", b"p1").close();
        rbf.open("txdRelationships").item(b"c2", b"p2").close();
        rbf.close();
        let two = parents_of(&bench, "in/gtxd-two-lists.ymt", &rbf.bytes);
        assert_eq!(links(&two), [pair("c1", "p1"), pair("c2", "p2")], "M99");
        // Поле повторено: побеждает последнее.
        let mut rbf = Rbf::new();
        rbf.open("CMapParentTxds")
            .open("txdRelationships")
            .open("item");
        rbf.field("parent", b"first")
            .field("parent", b"last")
            .field("child", b"c")
            .close()
            .close()
            .close();
        let last = parents_of(&bench, "in/gtxd-repeat.ymt", &rbf.bytes);
        assert_eq!(links(&last), [pair("c", "last")]);
        let upper = parents_of(&bench, "in/GTXD-Upper.YMT", &txd(&[("c", "p")]));
        assert_eq!(upper["count"], json!(1), "M104");
    }

    #[test]
    fn broken_relationship_files_are_refused_with_double_host_words() {
        let bench = Bench::new();
        let go = |name: &str, bytes: &[u8]| {
            let file = bench.put(name, bytes);
            refusal(bench.call(&["--input", &file]))
        };
        assert_eq!(go("in/gtxd-notrbf.ymt", b"<xml/>"), host("Файл карты gtxd-notrbf.ymt: Связи словарей текстур не в RBF: пока на хосте.: пока на хосте."), "M100");
        let whole = txd(&[("a", "b")]);
        assert_eq!(
            go("in/gtxd-trunc.ymt", &whole[..whole.len() - 3]),
            host("Файл карты gtxd-trunc.ymt: RBF: обрыв файла.: пока на хосте."),
            "M101"
        );
        assert_eq!(
            go("in/gtxd-rbf-only.ymt", b"RBF0"),
            host("Файл карты gtxd-rbf-only.ymt: RBF: неожиданный конец файла.: пока на хосте."),
            "M102"
        );
        let mut open = Rbf::new();
        open.open("CMapParentTxds").open("txdRelationships");
        assert_eq!(
            go("in/gtxd-unclosed.ymt", &open.bytes),
            host("Файл карты gtxd-unclosed.ymt: RBF: неожиданный конец файла.: пока на хосте."),
            "M103"
        );
        let mut cut = Rbf::new();
        cut.open("CMapParentTxds").text(b"abcdef");
        let end = cut.bytes.len() - 3;
        assert_eq!(
            go("in/gtxd-cut.ymt", &cut.bytes[..end]),
            host("Файл карты gtxd-cut.ymt: RBF: обрыв файла.: пока на хосте."),
            "M101"
        );
    }
}
