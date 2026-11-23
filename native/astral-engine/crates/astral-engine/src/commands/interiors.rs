//! `inspect-interior-ytyp` и `inspect-interior-ymap`: опись словаря типов с
//! помещениями и опись заголовка и сущностей карты.
//!
//! Модуль только читает. Разбор файлов делают `rage_res::meta_graph`, `mlo` и
//! `placements`; здесь проверяется размер, хеши заменяются именами из строк
//! самого файла и собирается JSON в формате хоста: ключи camelCase, хеши
//! `0x%08x`, числа с плавающей точкой — кратчайшей записью `f32`.
//!
//! Мелкие помощники (`float`, `hash_text`, `vector`, `quaternion`,
//! `unsupported`) нужны соседу `mapfiles`.

use crate::error::EngineError;
use serde_json::Value as Json;

type Names = std::collections::HashMap<u32, String>;
type Outcome<T> = crate::error::Result<T>;

pub const COMMANDS: &[super::Command] = &[
    super::Command::new("inspect-interior-ytyp", inspect_interior_ytyp),
    super::Command::new("inspect-interior-ymap", inspect_interior_ymap),
];

// ---------------------------------------------------------------------------
// Помощники для соседей.
// ---------------------------------------------------------------------------

/// Число `f32` в записи хоста: кратчайшая, у целых хвост `.0`, без числа — `null`.
pub(crate) fn float(value: f32) -> Json {
    rage_res::drawable_write::float_value(value)
}

/// `0x` и восемь строчных шестнадцатеричных цифр.
pub(crate) fn hash_text(hash: u32) -> String {
    struct Hex(u32);
    impl std::fmt::Display for Hex {
        fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(out, "0x{:08x}", self.0)
        }
    }
    Hex(hash).to_string()
}

pub(crate) fn vector(value: [f32; 3]) -> Json {
    axes_object(&["x", "y", "z"], &value)
}

pub(crate) fn quaternion(value: [f32; 4]) -> Json {
    axes_object(&["x", "y", "z", "w"], &value)
}

/// Отказ, который мост студии читает как «команду выполнит хост».
pub(crate) fn unsupported(what: &str) -> EngineError {
    EngineError::argument([what, ": пока на хосте."].concat())
}

/// Имя из таблицы строк файла, иначе хеш десятичным числом.
pub(crate) fn known(names: &std::collections::HashMap<u32, String>, hash: u32) -> String {
    match names.get(&hash) {
        Some(name) => name.clone(),
        None => hash.to_string(),
    }
}

/// Объект из чисел по осям: имена и значения идут парами в порядке осей.
fn axes_object(axes: &[&str], values: &[f32]) -> Json {
    Json::Object(
        axes.iter()
            .zip(values)
            .map(|(axis, &value)| (axis.to_string(), float(value)))
            .collect(),
    )
}

/// Объект с ключами в том порядке, в каком они поданы.
fn record<'a>(fields: impl IntoIterator<Item = (&'a str, Json)>) -> Json {
    Json::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    )
}

/// Массив описаний: каждому элементу известен его номер.
fn list<T>(items: &[T], one: impl Fn(usize, &T) -> Json) -> Json {
    Json::Array(
        items
            .iter()
            .zip(0..)
            .map(|(item, index)| one(index, item))
            .collect(),
    )
}

fn numbers(items: &[u32]) -> Json {
    Json::Array(items.iter().map(|&item| Json::from(item)).collect())
}

// ---------------------------------------------------------------------------
// Входной файл.
// ---------------------------------------------------------------------------

/// Правило входа: расширение, предел размера и текст отказа за пределом.
struct Rule {
    extension: &'static str,
    limit: usize,
    refusal: &'static str,
}

const MAX_YTYP_BYTES: usize = 4 * 1024 * 1024;
const MAX_YMAP_BYTES: usize = 1024 * 1024;

const YTYP_RULE: Rule = Rule {
    extension: ".ytyp",
    limit: MAX_YTYP_BYTES,
    refusal: "Interior YTYP must be between 1 byte and 4 MiB.",
};
const YMAP_RULE: Rule = Rule {
    extension: ".ymap",
    limit: MAX_YMAP_BYTES,
    refusal: "Interior YMAP must be between 1 byte and 1 MiB.",
};

/// Прочитанный файл: путь и содержимое, размер уже проверен.
struct Input {
    path: std::path::PathBuf,
    bytes: Vec<u8>,
}

impl Input {
    fn open(options: &crate::args::Options, rule: &Rule) -> Outcome<Self> {
        let wanted = options.required("input")?;
        let path = crate::paths::existing_file(wanted, &[rule.extension])?;
        let bytes = std::fs::read(&path)?;
        if (1..=rule.limit).contains(&bytes.len()) {
            Ok(Self { path, bytes })
        } else {
            Err(EngineError::invalid_data(rule.refusal))
        }
    }

    /// Ответ: путь, размер и хеш файла, затем остальные поля команды.
    fn report<'a>(&self, rest: impl IntoIterator<Item = (&'a str, Json)>) -> Json {
        let head = [
            ("input", Json::from(self.path.to_string_lossy())),
            ("bytes", Json::from(self.bytes.len())),
            (
                "sha256",
                Json::from(rage_res::hash::sha256_hex(&self.bytes)),
            ),
        ];
        record(head.into_iter().chain(rest))
    }
}

// ---------------------------------------------------------------------------
// inspect-interior-ytyp
// ---------------------------------------------------------------------------

pub fn inspect_interior_ytyp(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Outcome<Json> {
    let input = Input::open(options, &YTYP_RULE)?;
    let graph = rage_res::meta_graph::read(&input.bytes)?;
    let names = rage_res::mlo::name_index(&graph);
    let dictionary = rage_res::mlo::read_ytyp(&graph)?;

    // Первый архетип неизвестного типа отказывает; дальше не смотрим.
    let described = dictionary
        .archetypes
        .iter()
        .map(|archetype| describe_archetype(archetype, &names))
        .collect::<Outcome<Vec<_>>>()?;

    Ok(input.report([
        ("nameHash", Json::from(dictionary.name_hash)),
        ("archetypeCount", Json::from(described.len())),
        ("archetypes", Json::Array(described)),
    ]))
}

/// Ключ структуры обычного архетипа; ключ помещения — `mlo::MLO_ARCHETYPE_KEY`.
const BASE_ARCHETYPE_KEY: u32 = 2_411_387_556;

fn archetype_type(kind: u32) -> Outcome<&'static str> {
    match kind {
        BASE_ARCHETYPE_KEY => Ok("CBaseArchetypeDef"),
        rage_res::mlo::MLO_ARCHETYPE_KEY => Ok("CMloArchetypeDef"),
        other => Err(unsupported(&format!("Архетип типа {other}"))),
    }
}

fn describe_archetype(archetype: &rage_res::mlo::Archetype, names: &Names) -> Outcome<Json> {
    let kind = archetype_type(archetype.kind)?;
    // У обычного архетипа комнат, порталов и сущностей нет: четыре пустых списка.
    let [rooms, portals, entities, sets] = match &archetype.mlo {
        Some(interior) => interior_lists(interior, names),
        None => std::array::from_fn(|_| Json::Array(Vec::new())),
    };
    Ok(record([
        ("type", Json::from(kind)),
        ("name", Json::from(known(names, archetype.name_hash))),
        ("nameHash", Json::from(hash_text(archetype.name_hash))),
        ("assetName", Json::from(known(names, archetype.asset_hash))),
        ("assetHash", Json::from(hash_text(archetype.asset_hash))),
        ("bbMin", vector(archetype.bb_min)),
        ("bbMax", vector(archetype.bb_max)),
        ("bsCenter", vector(archetype.bs_centre)),
        ("bsRadius", float(archetype.bs_radius)),
        ("lodDist", float(archetype.lod_dist)),
        ("rooms", rooms),
        ("portals", portals),
        ("entities", entities),
        ("entitySets", sets),
    ]))
}

/// Комнаты, порталы, сущности и наборы помещения.
fn interior_lists(interior: &rage_res::mlo::Mlo, names: &Names) -> [Json; 4] {
    [
        list(&interior.rooms, describe_room),
        list(&interior.portals, describe_portal),
        list(&interior.entities, |index, entity| {
            describe_entity(index, entity, names)
        }),
        list(&interior.entity_sets, |index, set| {
            describe_set(index, set, names)
        }),
    ]
}

fn describe_room(index: usize, room: &rage_res::mlo::Room) -> Json {
    // Имя, которого в файле нет: нулевая комната — `limbo`, остальные — `room<номер>`.
    let name = match (&room.name, index) {
        (Some(name), _) => name.clone(),
        (None, 0) => String::from("limbo"),
        (None, other) => format!("room{other}"),
    };
    record([
        ("index", Json::from(index)),
        ("roomName", Json::from(name)),
        ("bbMin", vector(room.bb_min)),
        ("bbMax", vector(room.bb_max)),
        ("flags", Json::from(room.flags)),
        ("floorId", Json::from(room.floor_id)),
        ("attachedObjects", numbers(&room.attached_objects)),
    ])
}

fn describe_portal(index: usize, portal: &rage_res::mlo::Portal) -> Json {
    let corners = list(&portal.corners, |_, corner| vector(*corner));
    record([
        ("index", Json::from(index)),
        ("roomFrom", Json::from(portal.room_from)),
        ("roomTo", Json::from(portal.room_to)),
        ("flags", Json::from(portal.flags)),
        ("center", vector(corners_center(&portal.corners))),
        ("corners", corners),
        ("attachedObjects", numbers(&portal.attached_objects)),
    ])
}

/// Среднее углов: сумма по осям, умноженная на `1/число углов` (оба во `f32`).
fn corners_center(corners: &[[f32; 3]]) -> [f32; 3] {
    match corners.len() {
        0 => [0.0; 3],
        count => {
            let scale = 1.0f32 / count as f32;
            std::array::from_fn(|axis| {
                corners
                    .iter()
                    .fold(0.0f32, |sum, corner| sum + corner[axis])
                    * scale
            })
        }
    }
}

/// Поля сущности, общие для помещения и набора.
fn entity_fields<'a>(entity: &rage_res::mlo::Entity, names: &Names) -> Vec<(&'a str, Json)> {
    let hash = entity.archetype_hash;
    vec![
        ("archetypeName", Json::from(known(names, hash))),
        ("archetypeHash", Json::from(hash_text(hash))),
        ("position", vector(entity.position)),
        ("rotation", quaternion(entity.rotation)),
        ("flags", Json::from(entity.flags)),
        ("lodDist", float(entity.lod_dist)),
    ]
}

fn describe_entity(index: usize, entity: &rage_res::mlo::Entity, names: &Names) -> Json {
    let parent = ("parentIndex", Json::from(entity.parent_index));
    record(
        std::iter::once(("index", Json::from(index)))
            .chain(entity_fields(entity, names))
            .chain(std::iter::once(parent)),
    )
}

/// У сущности набора нет ни номера, ни родителя.
fn describe_set(index: usize, set: &rage_res::mlo::EntitySet, names: &Names) -> Json {
    let inner = list(&set.entities, |_, entity| {
        record(entity_fields(entity, names))
    });
    record([
        ("index", Json::from(index)),
        ("name", Json::from(known(names, set.name_hash))),
        ("nameHash", Json::from(hash_text(set.name_hash))),
        ("entityCount", Json::from(set.entities.len())),
        ("entities", inner),
    ])
}

// ---------------------------------------------------------------------------
// inspect-interior-ymap
// ---------------------------------------------------------------------------

/// Причина отказа разбора теряется: любой отказ соседа — один и тот же.
fn unreadable(_: rage_res::Error) -> EngineError {
    EngineError::invalid_data("Карта не разбирается движком: пока на хосте.")
}

pub fn inspect_interior_ymap(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Outcome<Json> {
    let input = Input::open(options, &YMAP_RULE)?;
    let graph = rage_res::meta_graph::read(&input.bytes).map_err(unreadable)?;
    // Имена карты — записи таблиц строк файла под хешем «по буквам как написано» (в отличие от словаря типов).
    let names = rage_res::mlo::exact_name_index(&graph);
    let map = rage_res::placements::read_map(&input.bytes).map_err(unreadable)?;

    Ok(input.report([
        ("map", describe_map(&map, &names)),
        ("entityCount", Json::from(map.entities.len())),
        (
            "entities",
            list(&map.entities, |index, entity| {
                describe_map_entity(index, entity, &names)
            }),
        ),
        ("saveWarnings", Json::Array(Vec::new())),
    ]))
}

fn describe_map(map: &rage_res::placements::MapRead, names: &Names) -> Json {
    record([
        ("nameHash", Json::from(hash_text(map.name))),
        ("name", Json::from(known(names, map.name))),
        ("parentHash", Json::from(hash_text(map.parent))),
        ("parent", Json::from(known(names, map.parent))),
        ("flags", Json::from(map.flags)),
        ("contentFlags", Json::from(map.content_flags)),
        ("streamingExtentsMin", vector(map.streaming.0)),
        ("streamingExtentsMax", vector(map.streaming.1)),
        ("entitiesExtentsMin", vector(map.entities_extents.0)),
        ("entitiesExtentsMax", vector(map.entities_extents.1)),
    ])
}

fn describe_map_entity(
    index: usize,
    entity: &rage_res::placements::EntityRead,
    names: &Names,
) -> Json {
    // Обратный поворот; единичный остаётся как есть (так делает `invert`). У экземпляра помещения хост поворот не обращает.
    let orientation = quaternion(if entity.mlo { entity.rotation } else { rage_res::placements::invert(entity.rotation) });
    let scale = axes_object(
        &["x", "y", "z"],
        &[entity.scale_xy, entity.scale_xy, entity.scale_z],
    );
    record([
        ("index", Json::from(index)),
        ("archetypeHash", Json::from(hash_text(entity.archetype))),
        ("archetypeName", Json::from(known(names, entity.archetype))),
        ("isMlo", Json::from(entity.mlo)),
        ("orientation", orientation),
        ("storedRotation", quaternion(entity.rotation)),
        ("position", vector(entity.position)),
        ("scale", scale),
        ("flags", Json::from(entity.flags)),
        ("guid", Json::from(entity.guid)),
        ("parentIndex", Json::from(entity.parent_index)),
        ("lodDist", float(entity.lod_dist)),
        ("childLodDist", float(entity.child_lod_dist)),
        (
            "lodLevel",
            Json::from(level_name(Level::Lod, entity.lod_level)),
        ),
        (
            "priorityLevel",
            Json::from(level_name(Level::Priority, entity.priority_level)),
        ),
    ])
}

/// Перечисления карты: слова после общего префикса, по номерам с нуля.
#[derive(Clone, Copy)]
enum Level {
    Lod,
    Priority,
}

impl Level {
    const fn prefix(self) -> &'static str {
        match self {
            Level::Lod => "LODTYPES_DEPTH_",
            Level::Priority => "PRI_",
        }
    }

    const fn words(self) -> &'static str {
        match self {
            Level::Lod => "HD LOD SLOD1 SLOD2 SLOD3 ORPHANHD SLOD4",
            Level::Priority => "REQUIRED OPTIONAL_HIGH OPTIONAL_MEDIUM OPTIONAL_LOW",
        }
    }
}

/// Имя значения перечисления; чужое значение — знаковое десятичное число строкой.
fn level_name(kind: Level, value: u32) -> String {
    match kind.words().split_whitespace().nth(value as usize) {
        Some(word) => [kind.prefix(), word].concat(),
        None => (value as i32).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::Options;
    use crate::error::Result;
    use crate::progress::Progress;
    use rage_res::hash::sha256_hex;
    use rage_res::mlo::{self, Entity, EntitySet, Portal, Room};
    use rage_res::mlo::{Archetype, Mlo};
    use rage_res::ymap_write::{self, Extents, TimeCycleBox};
    use rage_res::ytyp_write::{self, BaseArchetype};
    use serde_json::json;
    use serde_json::Value;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;

    // --- помощники (таблица выдач прямого вызова из описания) ---

    #[test]
    fn float_matches_the_probe_table() {
        let cases: [(f32, &str); 28] = [
            (0.0, "0.0"),
            (-0.0, "-0.0"),
            (1.0, "1.0"),
            (-1.0, "-1.0"),
            (100.0, "100.0"),
            (f32::from_bits(0x41d5a524), "26.705635"),
            (f32::from_bits(0x33000000), "2.9802322e-8"),
            (f32::from_bits(0x3727c5ac), "0.00001"),
            (f32::from_bits(0x38d1b717), "0.0001"),
            (f32::from_bits(0x4b189680), "10000000.0"),
            (f32::from_bits(0x58635fa9), "1000000000000000.0"),
            (f32::from_bits(0x5a0e1bca), "1e+16"),
            (f32::from_bits(0x6258d727), "1e+21"),
            (f32::from_bits(0x47f12065), "123456.79"),
            (f32::from_bits(0x7f7fffff), "3.4028235e+38"),
            (f32::from_bits(0x00800000), "1.1754944e-38"),
            (f32::from_bits(0x00000001), "1e-45"),
            (f32::from_bits(0x3dcccccd), "0.1"),
            (f32::from_bits(0x3e4ccccd), "0.2"),
            (f32::from_bits(0x3e99999a), "0.3"),
            (f32::from_bits(0x4b800000), "16777216.0"),
            (f32::from_bits(0x4c000000), "33554432.0"),
            (f32::from_bits(0x3f0f2199), "0.5591064"),
            (f32::from_bits(0x451ebe80), "2539.9062"),
            (f32::from_bits(0x45906040), "4620.0312"),
            (f32::from_bits(0x41180000), "9.5"),
            (f32::from_bits(0x3d6978d5), "0.057"),
            (f32::from_bits(0x3eaaaaab), "0.33333334"),
        ];
        for (value, text) in cases {
            assert_eq!(float(value).to_string(), text, "{:#010x}", value.to_bits());
        }
        for special in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert_eq!(float(special), Value::Null);
        }
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn hash_vector_quaternion_unsupported_known() {
        for (hash, text) in [
            (0u32, "0x00000000"),
            (1, "0x00000001"),
            (255, "0x000000ff"),
            (92094933, "0x057d41d5"),
            (4294967295, "0xffffffff"),
            (16, "0x00000010"),
        ] {
            assert_eq!(hash_text(hash), text);
        }
        assert_eq!(
            vector([1.0, -2.5, 0.0]).to_string(),
            r#"{"x":1.0,"y":-2.5,"z":0.0}"#
        );
        assert_eq!(
            quaternion([0.0, 0.0, 0.7071068, 0.7071068]).to_string(),
            r#"{"x":0.0,"y":0.0,"z":0.7071068,"w":0.7071068}"#
        );
        let error = unsupported("Архетип типа 7");
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            ("ArgumentException", "Архетип типа 7: пока на хосте.")
        );
        assert_eq!(unsupported("").message, ": пока на хосте.");
        let mut names = HashMap::new();
        names.insert(5u32, "five".to_owned());
        assert_eq!(known(&names, 5), "five");
        assert_eq!(known(&names, 6), "6");
        assert_eq!(known(&names, 4294967295), "4294967295");
    }

    // --- разбор описаний без файлов ---

    #[test]
    fn rooms_portals_and_sets_have_the_documented_shape() {
        let room = |name: Option<&str>| Room {
            name: name.map(str::to_owned),
            bb_min: [-1.0, -2.0, -3.0],
            bb_max: [1.0, 2.0, 3.0],
            flags: 234,
            floor_id: -1,
            attached_objects: vec![1, 2],
        };
        assert_eq!(describe_room(0, &room(None))["roomName"], "limbo");
        assert_eq!(describe_room(3, &room(None))["roomName"], "room3");
        assert_eq!(describe_room(0, &room(Some("Hall")))["roomName"], "Hall");
        let described = describe_room(1, &room(None));
        let keys: Vec<&str> = described
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "index",
                "roomName",
                "bbMin",
                "bbMax",
                "flags",
                "floorId",
                "attachedObjects"
            ]
        );
        assert_eq!(described["floorId"], -1);
        assert_eq!(described["attachedObjects"], json!([1, 2]));

        let portal = Portal {
            room_from: 1,
            room_to: 0,
            flags: 2,
            corners: vec![
                [6.8171196, 20.776518, -7.7522144],
                [6.8171196, 20.776518, -0.997051],
                [12.39703, 20.776518, -0.997051],
                [12.39703, 20.776518, -7.7522144],
            ],
            attached_objects: vec![],
        };
        let shown = describe_portal(0, &portal);
        let keys: Vec<&str> = shown
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "index",
                "roomFrom",
                "roomTo",
                "flags",
                "center",
                "corners",
                "attachedObjects"
            ]
        );
        assert_eq!(
            shown["center"].to_string(),
            r#"{"x":9.607075,"y":20.776518,"z":-4.374633}"#
        );
        assert_eq!(shown["corners"].as_array().unwrap().len(), 4);
        let empty = describe_portal(
            1,
            &Portal {
                corners: vec![],
                ..portal
            },
        );
        assert_eq!(empty["center"].to_string(), r#"{"x":0.0,"y":0.0,"z":0.0}"#);

        let entity = Entity {
            archetype_hash: 1326575758,
            position: [2.1240048, 2.9802322e-8, 0.07506989],
            rotation: [0.0, 0.0, 0.0, 1.0],
            flags: 0,
            lod_dist: 200.0,
            parent_index: -1,
        };
        let names = HashMap::new();
        let described = describe_entity(0, &entity, &names);
        assert_eq!(
            described.to_string(),
            r#"{"index":0,"archetypeName":"1326575758","archetypeHash":"0x4f11f08e","position":{"x":2.1240048,"y":2.9802322e-8,"z":0.07506989},"rotation":{"x":0.0,"y":0.0,"z":0.0,"w":1.0},"flags":0,"lodDist":200.0,"parentIndex":-1}"#
        );
        let set = EntitySet {
            name_hash: 3439338963,
            entities: vec![entity],
        };
        let shown = describe_set(0, &set, &names);
        assert_eq!(shown["name"], "3439338963");
        assert_eq!(shown["nameHash"], "0xcd0025d3");
        assert_eq!(shown["entityCount"], 1);
        let inner = shown["entities"][0].as_object().unwrap();
        assert!(!inner.contains_key("index") && !inner.contains_key("parentIndex"));
        assert_eq!(inner.keys().next().unwrap(), "archetypeName");
    }

    #[test]
    fn base_archetype_has_empty_lists_and_unknown_kinds_refuse() {
        let base = Archetype {
            kind: BASE_ARCHETYPE_KEY,
            name_hash: 92094933,
            asset_hash: 92094933,
            lod_dist: 100.0,
            flags: 0,
            special_attribute: 0,
            bb_min: [-0.5, -0.01, -0.25],
            bb_max: [0.5, 0.01, 0.25],
            bs_centre: [0.0; 3],
            bs_radius: 0.5591064,
            hd_texture_dist: 15.0,
            asset_type: 2,
            texture_dictionary: 0,
            drawable_dictionary: 0,
            physics_dictionary: 0,
            clip_dictionary: 0,
            mlo: None,
        };
        let names = HashMap::new();
        assert_eq!(
            describe_archetype(&base, &names).unwrap().to_string(),
            r#"{"type":"CBaseArchetypeDef","name":"92094933","nameHash":"0x057d41d5","assetName":"92094933","assetHash":"0x057d41d5","bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"lodDist":100.0,"rooms":[],"portals":[],"entities":[],"entitySets":[]}"#
        );
        let room = Archetype {
            kind: mlo::MLO_ARCHETYPE_KEY,
            mlo: Some(Mlo {
                rooms: vec![],
                portals: vec![],
                entities: vec![],
                entity_sets: vec![],
            }),
            ..base.clone()
        };
        assert_eq!(
            describe_archetype(&room, &names).unwrap()["type"],
            "CMloArchetypeDef"
        );
        let strange = Archetype {
            kind: 2520619910,
            ..base.clone()
        };
        let error = describe_archetype(&strange, &names).unwrap_err();
        assert_eq!(
            (error.code.as_str(), error.message.as_str()),
            (
                "ArgumentException",
                "Архетип типа 2520619910: пока на хосте."
            )
        );
        let zero = Archetype { kind: 0, ..base };
        assert_eq!(
            describe_archetype(&zero, &names).unwrap_err().message,
            "Архетип типа 0: пока на хосте."
        );
    }

    #[test]
    fn level_names() {
        assert_eq!(level_name(Level::Lod, 5), "LODTYPES_DEPTH_ORPHANHD");
        assert_eq!(level_name(Level::Lod, 6), "LODTYPES_DEPTH_SLOD4");
        assert_eq!(level_name(Level::Lod, 7), "7");
        assert_eq!(level_name(Level::Lod, u32::MAX), "-1");
        assert_eq!(level_name(Level::Priority, 0), "PRI_REQUIRED");
        assert_eq!(level_name(Level::Priority, 3), "PRI_OPTIONAL_LOW");
        assert_eq!(level_name(Level::Priority, 4), "4");
    }

    // --- команды над файлами ---

    struct Lab(tempfile::TempDir);

    impl Lab {
        fn new() -> Self {
            Self(tempfile::tempdir().unwrap())
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.0.path().join(name);
            fs::write(&path, bytes).unwrap();
            path.display().to_string()
        }

        fn run(
            &self,
            command: fn(&Options, &Progress) -> Result<Value>,
            args: &[&str],
        ) -> Result<Value> {
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            command(&Options::parse(&argv)?, &Progress::silent())
        }
    }

    fn failure(result: Result<Value>) -> (String, String) {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    fn climb_like() -> Vec<u8> {
        let archetype = |name: u32| BaseArchetype {
            name,
            asset_name: name,
            lod_dist: 100.0,
            flags: 32,
            special_attribute: 0,
            bb_min: [-0.5, -0.01, -0.25],
            bb_max: [0.5, 0.01, 0.25],
            bs_centre: [0.0; 3],
            bs_radius: 0.5591064,
            hd_texture_dist: 15.0,
            texture_dictionary: 0,
            clip_dictionary: 0,
            drawable_dictionary: 0,
            physics_dictionary: 0,
            asset_type: 2,
        };
        ytyp_write::base_types(
            3899251533,
            &[
                archetype(92094933),
                archetype(390980982),
                archetype(2834499778),
            ],
        )
        .unwrap()
    }

    #[test]
    fn ytyp_of_base_archetypes() {
        let lab = Lab::new();
        let bytes = climb_like();
        let path = lab.put("i-climb-mod3.ytyp", &bytes);
        let value = lab.run(inspect_interior_ytyp, &["--input", &path]).unwrap();
        let keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "input",
                "bytes",
                "sha256",
                "nameHash",
                "archetypeCount",
                "archetypes"
            ]
        );
        assert_eq!(value["bytes"], bytes.len());
        assert_eq!(value["sha256"], sha256_hex(&bytes));
        assert_eq!(value["nameHash"], 3899251533u32);
        assert_eq!(value["archetypeCount"], 3);
        let expected: Value = serde_json::from_str(
            r#"[{"type":"CBaseArchetypeDef","name":"92094933","nameHash":"0x057d41d5","assetName":"92094933","assetHash":"0x057d41d5","bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"lodDist":100.0,"rooms":[],"portals":[],"entities":[],"entitySets":[]},{"type":"CBaseArchetypeDef","name":"390980982","nameHash":"0x174de576","assetName":"390980982","assetHash":"0x174de576","bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"lodDist":100.0,"rooms":[],"portals":[],"entities":[],"entitySets":[]},{"type":"CBaseArchetypeDef","name":"2834499778","nameHash":"0xa8f308c2","assetName":"2834499778","assetHash":"0xa8f308c2","bbMin":{"x":-0.5,"y":-0.01,"z":-0.25},"bbMax":{"x":0.5,"y":0.01,"z":0.25},"bsCenter":{"x":0.0,"y":0.0,"z":0.0},"bsRadius":0.5591064,"lodDist":100.0,"rooms":[],"portals":[],"entities":[],"entitySets":[]}]"#,
        )
        .unwrap();
        assert_eq!(value["archetypes"], expected);
        assert_eq!(value["input"], path);
    }

    #[test]
    fn ytyp_sizes_paths_and_garbage() {
        let lab = Lab::new();
        let size = (
            "InvalidDataException",
            "Interior YTYP must be between 1 byte and 4 MiB.",
        );
        let empty = lab.put("i-empty.ytyp", b"");
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &empty])),
            (size.0.into(), size.1.into())
        );
        let over = lab.put("i-4mib-plus1.ytyp", &vec![0u8; MAX_YTYP_BYTES + 1]);
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &over])).1,
            size.1
        );
        let zeros = lab.put("i-4mib.ytyp", &vec![0u8; MAX_YTYP_BYTES]);
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &zeros])),
            (
                "InvalidOperationException".into(),
                "Файл не является ресурсом RSC7.".into()
            )
        );
        let one = lab.put("i-zero-1.ytyp", &[0u8]);
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &one])).1,
            "Ресурс короче заголовка RSC7."
        );
        let text = lab.put("i-text.ytyp", b"text");
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &text])).1,
            "Ресурс короче заголовка RSC7."
        );
        // ymap на месте ytyp: схема не та
        let map = ymap_write::timecycle_map(
            "m",
            Extents {
                streaming_min: [0.0; 3],
                streaming_max: [1.0; 3],
                entities_min: [0.0; 3],
                entities_max: [1.0; 3],
            },
            &[TimeCycleBox {
                modifier: "x".into(),
                min: [0.0; 3],
                max: [1.0; 3],
                percentage: 1.0,
                range: 1.0,
                start_hour: 0,
                end_hour: 24,
            }],
            "t",
            "now",
        )
        .unwrap();
        let wrong = lab.put("i-ymap-as.ytyp", &map);
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &wrong])).1,
            "В метаданных нет поля archetypes."
        );
        // хвост после данных не мешает
        let mut tail = climb_like();
        tail.extend([0u8; 4]);
        let trailing = lab.put("i-trailing.ytyp", &tail);
        assert_eq!(
            lab.run(inspect_interior_ytyp, &["--input", &trailing])
                .unwrap()["archetypeCount"],
            3
        );
        // параметры
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &[])).1,
            "--input is required."
        );
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", ""])).1,
            "The path is empty."
        );
        let wrong_ext = lab.put("i-wrongext.txt", b"x");
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &wrong_ext])).1,
            "Unsupported file extension: .txt"
        );
        let no_ext = lab.put("i-noext", b"x");
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &no_ext])).1,
            "Unsupported file extension: "
        );
        let missing = lab.0.path().join("nope.ytyp").display().to_string();
        assert_eq!(
            failure(lab.run(inspect_interior_ytyp, &["--input", &missing])),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {missing}")
            )
        );
        // верхний регистр расширения, имя параметра и повтор
        let upper = lab.put("i-upper.YTYP", &climb_like());
        assert!(lab
            .run(inspect_interior_ytyp, &["--INPUT", &upper, "--bogus", "1"])
            .is_ok());
        assert!(lab
            .run(
                inspect_interior_ytyp,
                &["--input", &missing, "--input", &upper]
            )
            .is_ok());
    }

    fn small_map() -> Vec<u8> {
        ymap_write::timecycle_map(
            "climb_map",
            Extents {
                streaming_min: [-90.5, -100.01, -80.25],
                streaming_max: [114.5, 100.01, 120.25],
                entities_min: [9.5, -0.01, 19.75],
                entities_max: [14.5, 0.01, 20.25],
            },
            &[TimeCycleBox {
                modifier: "mod".into(),
                min: [0.0; 3],
                max: [1.0; 3],
                percentage: 1.0,
                range: 1.0,
                start_hour: 0,
                end_hour: 24,
            }],
            "exporter",
            "01 January 1970 00:00",
        )
        .unwrap()
    }

    #[test]
    fn ymap_header_and_empty_entity_list() {
        let lab = Lab::new();
        let bytes = small_map();
        let path = lab.put("i-climb-mod3.ymap", &bytes);
        let value = lab.run(inspect_interior_ymap, &["--input", &path]).unwrap();
        let keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "input",
                "bytes",
                "sha256",
                "map",
                "entityCount",
                "entities",
                "saveWarnings"
            ]
        );
        assert_eq!(value["bytes"], bytes.len());
        assert_eq!(value["sha256"], sha256_hex(&bytes));
        assert_eq!(value["entityCount"], 0);
        assert_eq!(value["entities"], json!([]));
        assert_eq!(value["saveWarnings"], json!([]));
        let map = &value["map"];
        let keys: Vec<&str> = map
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "nameHash",
                "name",
                "parentHash",
                "parent",
                "flags",
                "contentFlags",
                "streamingExtentsMin",
                "streamingExtentsMax",
                "entitiesExtentsMin",
                "entitiesExtentsMax"
            ]
        );
        assert_eq!(map["parentHash"], "0x00000000");
        assert_eq!(map["parent"], "0");
        assert_eq!(
            map["nameHash"],
            hash_text(ymap_write::meta_name("climb_map"))
        );
        assert_eq!(
            map["streamingExtentsMin"].to_string(),
            r#"{"x":-90.5,"y":-100.01,"z":-80.25}"#
        );
        assert_eq!(
            map["entitiesExtentsMax"].to_string(),
            r#"{"x":14.5,"y":0.01,"z":20.25}"#
        );
    }

    #[test]
    fn ymap_sizes_and_garbage() {
        let lab = Lab::new();
        let size = "Interior YMAP must be between 1 byte and 1 MiB.";
        let empty = lab.put("i-empty.ymap", b"");
        assert_eq!(
            failure(lab.run(inspect_interior_ymap, &["--input", &empty])),
            ("InvalidDataException".into(), size.into())
        );
        let over = lab.put("i-1mib-plus1.ymap", &vec![0u8; MAX_YMAP_BYTES + 1]);
        assert_eq!(
            failure(lab.run(inspect_interior_ymap, &["--input", &over])).1,
            size
        );
        let unreadable = (
            "InvalidDataException".to_owned(),
            "Карта не разбирается движком: пока на хосте.".to_owned(),
        );
        for (name, bytes) in [
            ("i-1mib.ymap", vec![0u8; MAX_YMAP_BYTES]),
            ("i-zero-1.ymap", vec![0u8]),
            ("i-text.ymap", b"plain text".to_vec()),
            ("i-ytyp-as.ymap", climb_like()),
        ] {
            let path = lab.put(name, &bytes);
            assert_eq!(
                failure(lab.run(inspect_interior_ymap, &["--input", &path])),
                unreadable,
                "{name}"
            );
        }
        let mut tail = small_map();
        tail.extend([0u8; 4]);
        let trailing = lab.put("i-trailing.ymap", &tail);
        assert_eq!(
            lab.run(inspect_interior_ymap, &["--input", &trailing])
                .unwrap()["entityCount"],
            0
        );
        let upper = lab.put("i-upper.YMAP", &small_map());
        assert!(lab.run(inspect_interior_ymap, &["--input", &upper]).is_ok());
        let wrong = lab.put("i-wrongext.txt", b"x");
        assert_eq!(
            failure(lab.run(inspect_interior_ymap, &["--input", &wrong])).1,
            "Unsupported file extension: .txt"
        );
    }

    /// Испорченный байт схемы (число значений перечисления) отказывает, а не просит у системы десятки гигабайт.
    /// На прежнем коде при нехватке памяти процесс умирал на `memory allocation of 10855085352 bytes failed`;
    /// от объёма памяти машины не зависит проверка в `rage-res/tests/schema_enum_count.rs`.
    #[test]
    fn a_damaged_enum_count_refuses_instead_of_exhausting_memory() {
        let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../parity/host-port/placements/sample-map.ymap");
        let Ok(mut bytes) = fs::read(&sample) else {
            eprintln!("образец карты хоста недоступен: пропущено");
            return;
        };
        bytes[268] ^= 0xff;
        let lab = Lab::new();
        let path = lab.put("i-damaged-enum.ymap", &bytes);
        let (code, message) = failure(lab.run(inspect_interior_ymap, &["--input", &path]));
        assert_eq!(code, "InvalidDataException");
        assert_eq!(message, "Карта не разбирается движком: пока на хосте.");
    }

    #[test]
    fn registry_has_both_commands_in_order() {
        let names: Vec<&str> = COMMANDS.iter().map(|command| command.name).collect();
        assert_eq!(names, ["inspect-interior-ytyp", "inspect-interior-ymap"]);
    }
}
