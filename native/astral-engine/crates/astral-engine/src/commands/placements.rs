//! `compile-placements`: свои модели в мире. Запрос — список «архетипов»
//! (описаний моделей) и «сущностей» (экземпляров на карте); результат — три
//! файла в пустой папке: типы `.ytyp`, карта `.ymap` и манифест контейнера
//! `_manifest.ymf`. Форматы пишет `rage_res::placements`; здесь проверка
//! запроса, перевод чисел в `f32` и запись.

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;

use rage_res::hash::sha256_hex;
use rage_res::manifest_write::{self, Dependency};
use rage_res::placements::{self as writer, ArchetypeSpec, EntitySpec};
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

pub const COMMANDS: &[Command] = &[Command::new("compile-placements", compile_placements)];

/// Всё, на что запрос или папка вывода могут получить отказ.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Fault {
    Size,
    Unreadable,
    UnknownFormat,
    TypesName,
    MapName,
    ArchetypeCount,
    EntityCount,
    ArchetypeName,
    EntityArchetypeName,
    ClipName,
    Twice(String),
    Corner { owner: String, which: &'static str },
    Inverted(String),
    Distance(String),
    Flags(String),
    Unknown(String),
    Position(String),
    Rotation(String),
    NotAFolder,
    FolderBusy,
}

impl fmt::Display for Fault {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lowercase = |what: &str| {
            format!("Placements {what} must be lowercase letters, digits and underscores.")
        };
        match self {
            Fault::Size => out.write_str("Placements request must be between 1 byte and 1 MiB."),
            Fault::Unreadable => out.write_str("Placements request is empty or broken."),
            Fault::UnknownFormat => out.write_str("Placements request has an unknown format."),
            Fault::TypesName => out.write_str(&lowercase("types name")),
            Fault::MapName => out.write_str(&lowercase("map name")),
            Fault::ArchetypeCount => out.write_str("Placements need 1\u{2026}2000 archetypes."),
            Fault::EntityCount => out.write_str("Placements need 1\u{2026}4000 entities."),
            Fault::ArchetypeName => out.write_str(&lowercase("archetype name")),
            Fault::EntityArchetypeName => out.write_str(&lowercase("entity archetype name")),
            Fault::ClipName => out.write_str(&lowercase("clip dictionary name")),
            Fault::Twice(name) => write!(out, "Archetype {name} is listed twice."),
            Fault::Corner { owner, which } => {
                write!(out, "{owner} {which} must be three finite numbers.")
            }
            Fault::Inverted(name) => write!(out, "Archetype {name} has an inverted box."),
            Fault::Distance(owner) => write!(out, "{owner}: lodDist must be 1\u{2026}20000."),
            Fault::Flags(owner) => write!(out, "{owner}: flags must be 0\u{2026}4294967295."),
            Fault::Unknown(name) => write!(out, "Entity uses unknown archetype {name}."),
            Fault::Position(owner) => write!(out, "{owner} position must be three finite numbers."),
            Fault::Rotation(owner) => write!(out, "{owner}: rotation must be a quaternion."),
            Fault::NotAFolder => out.write_str("Placements output must be a directory."),
            Fault::FolderBusy => out.write_str("Placements output directory must be empty."),
        }
    }
}

impl From<Fault> for EngineError {
    fn from(fault: Fault) -> Self {
        EngineError::invalid_data(fault.to_string())
    }
}

type Checked<T> = std::result::Result<T, Fault>;

/// Строчные латинские буквы и цифры, внутри ещё `_`; не длиннее 63 знаков.
fn slug(text: &str) -> bool {
    let starts_well = text
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit());
    starts_well
        && text.len() <= 63
        && text
            .chars()
            .all(|ch| matches!(ch, 'a'..='z' | '0'..='9' | '_'))
}

/// Объект запроса: элемент списка, который не объект, читается как пустой.
#[derive(Clone, Copy)]
struct Item<'a>(Option<&'a Map<String, Value>>);

impl<'a> Item<'a> {
    fn of(value: &'a Value) -> Self {
        Item(value.as_object())
    }

    fn get(&self, key: &str) -> Option<&'a Value> {
        self.0?.get(key)
    }

    /// Строка-имя без обрезки; не строка и плохое имя дают `None`.
    fn slug(&self, key: &str) -> Option<&'a str> {
        self.get(key)?.as_str().filter(|text| slug(text))
    }

    /// Ровно `N` чисел, каждое в `f32` конечное; при `bounded` — ещё и в пределах мира.
    fn vector<const N: usize>(&self, key: &str, bounded: bool) -> Option<[f32; N]> {
        let fits = |value: &f32| value.is_finite() && (!bounded || value.abs() <= 20_000.0);
        let numbers: Option<Vec<f32>> = self
            .get(key)?
            .as_array()?
            .iter()
            .map(|item| item.as_f64().map(|number| number as f32).filter(fits))
            .collect();
        numbers?.try_into().ok()
    }

    /// Дальность: не число — 100, число — конечное `f32` от 1 до 20000.
    fn distance(&self) -> Option<f32> {
        match self.get("lodDist") {
            Some(number @ Value::Number(_)) => number
                .as_f64()
                .map(|meters| meters as f32)
                .filter(|meters| meters.is_finite() && (1.0..=20_000.0).contains(meters)),
            _ => Some(100.0),
        }
    }

    /// Флаги: нет ключа или `null` — умолчание; иначе целое от 0 до 4294967295, прочее — `None`.
    fn flags(&self, fallback: u32) -> Option<u32> {
        match self.get("flags") {
            None | Some(Value::Null) => Some(fallback),
            Some(value) => value.as_u64().and_then(|bits| u32::try_from(bits).ok()),
        }
    }
}

/// Проверенный запрос.
struct Plan {
    types: String,
    map: String,
    archetypes: Vec<ArchetypeSpec>,
    entities: Vec<EntitySpec>,
    with_manifest: bool,
}

impl Plan {
    fn read(bytes: &[u8]) -> Checked<Self> {
        let root: Value = serde_json::from_slice(bytes).map_err(|_| Fault::Unreadable)?;
        let doc = Item::of(&root);
        let pinned = doc.0.is_some()
            && doc.get("format").and_then(Value::as_str) == Some("astral.compile-placements")
            && doc.get("version").and_then(Value::as_u64) == Some(1);
        if !pinned {
            return Err(Fault::UnknownFormat);
        }
        let types = doc.slug("types").ok_or(Fault::TypesName)?.to_owned();
        let map = doc.slug("map").ok_or(Fault::MapName)?.to_owned();
        let listed = |key: &str, most: usize, fault: Fault| -> Checked<&[Value]> {
            let items = doc
                .get(key)
                .and_then(Value::as_array)
                .map_or(&[][..], Vec::as_slice);
            if (1..=most).contains(&items.len()) {
                Ok(items)
            } else {
                Err(fault)
            }
        };
        let archetype_items = listed("archetypes", 2000, Fault::ArchetypeCount)?;
        let entity_items = listed("entities", 4000, Fault::EntityCount)?;

        let archetypes = Self::archetypes(archetype_items)?;
        let by_name: HashMap<&str, usize> = archetypes
            .iter()
            .enumerate()
            .map(|(at, spec)| (spec.name.as_str(), at))
            .collect();
        let entities = entity_items
            .iter()
            .map(|item| Self::entity(Item::of(item), &by_name))
            .collect::<Checked<Vec<_>>>()?;
        let with_manifest = doc.get("manifest").and_then(Value::as_bool).unwrap_or(true);
        Ok(Plan {
            types,
            map,
            archetypes,
            entities,
            with_manifest,
        })
    }

    fn archetypes(items: &[Value]) -> Checked<Vec<ArchetypeSpec>> {
        let mut specs: Vec<ArchetypeSpec> = Vec::with_capacity(items.len());
        for value in items {
            let item = Item::of(value);
            let name = item.slug("name").ok_or(Fault::ArchetypeName)?;
            if specs.iter().any(|known| known.name == name) {
                return Err(Fault::Twice(name.to_owned()));
            }
            let corner = |which: &'static str| {
                item.vector::<3>(which, true).ok_or_else(|| Fault::Corner {
                    owner: name.to_owned(),
                    which,
                })
            };
            let (bb_min, bb_max) = (corner("bbMin")?, corner("bbMax")?);
            if bb_min.iter().zip(bb_max).any(|(low, high)| *low > high) {
                return Err(Fault::Inverted(name.to_owned()));
            }
            let clip_dictionary = match item.get("clipDictionary") {
                Some(Value::String(text)) if slug(text) => Some(text.clone()),
                Some(Value::String(_)) => return Err(Fault::ClipName),
                _ => None,
            };
            let lod_dist = item
                .distance()
                .ok_or_else(|| Fault::Distance(name.to_owned()))?;
            let flags = item.flags(0).ok_or_else(|| Fault::Flags(name.to_owned()))?;
            specs.push(ArchetypeSpec {
                name: name.to_owned(),
                lod_dist,
                bb_min,
                bb_max,
                flags,
                clip_dictionary,
            });
        }
        Ok(specs)
    }

    fn entity(item: Item<'_>, by_name: &HashMap<&str, usize>) -> Checked<EntitySpec> {
        let owner = item.slug("archetype").ok_or(Fault::EntityArchetypeName)?;
        let archetype = *by_name
            .get(owner)
            .ok_or_else(|| Fault::Unknown(owner.to_owned()))?;
        let position = item
            .vector::<3>("position", true)
            .ok_or_else(|| Fault::Position(owner.to_owned()))?;
        let rotation = match item.get("rotation") {
            None | Some(Value::Null) => [0.0, 0.0, 0.0, 1.0],
            Some(_) => item
                .vector::<4>("rotation", false)
                .ok_or_else(|| Fault::Rotation(owner.to_owned()))?,
        };
        let lod_dist = item
            .distance()
            .ok_or_else(|| Fault::Distance(owner.to_owned()))?;
        let flags = item
            .flags(32)
            .ok_or_else(|| Fault::Flags(owner.to_owned()))?;
        Ok(EntitySpec {
            archetype,
            position,
            rotation,
            lod_dist,
            flags,
            guid: None,
        })
    }

    fn manifest(&self) -> Result<Vec<u8>> {
        let bytes = writer::manifest(&self.types, &self.map)?;
        let link = Dependency {
            map: self.map.clone(),
            types: vec![self.types.clone()],
        };
        manifest_write::verify_fresh(&bytes, &[link])?;
        Ok(bytes)
    }
}

/// Пустая выходная папка, в которую по очереди ложатся файлы.
struct Depot(PathBuf);

impl Depot {
    /// Не файл; создаётся при нужде; обязана оказаться пустой.
    fn prepare(folder: PathBuf) -> Result<Self> {
        if folder.is_file() {
            return Err(Fault::NotAFolder.into());
        }
        std::fs::create_dir_all(&folder)?;
        match std::fs::read_dir(&folder)?.next() {
            Some(_) => Err(Fault::FolderBusy.into()),
            None => Ok(Depot(folder)),
        }
    }

    /// Пишет файл и возвращает его строку для ответа: сколько чего лежит внутри — `(поле, число)`.
    fn put(&self, file: &str, bytes: &[u8], inside: (&str, usize)) -> Result<Value> {
        write_atomic(&self.0.join(file), bytes)?;
        let semantic = object([("semanticReopen", true.into()), (inside.0, inside.1.into())]);
        Ok(object([
            ("file", file.into()),
            ("bytes", bytes.len().into()),
            ("sha256", sha256_hex(bytes).into()),
            ("semantic", semantic),
        ]))
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

pub fn compile_placements(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = paths::existing_file(options.required("input")?, &[".json"])?;
    let folder = paths::full_path(options.required("output")?)?;
    if !(1..=1024 * 1024).contains(&std::fs::metadata(&input)?.len()) {
        return Err(Fault::Size.into());
    }
    let plan = Plan::read(&std::fs::read(&input)?)?;

    let depot = Depot::prepare(folder)?;
    let built = writer::compile(
        &plan.types,
        &plan.map,
        &plan.archetypes,
        &plan.entities,
        "Astral Placements 1",
        "01 January 1970 00:00",
    )?;
    let mut files = vec![
        depot.put(
            &format!("{}.ytyp", plan.types),
            &built.types,
            ("archetypes", plan.archetypes.len()),
        )?,
        depot.put(
            &format!("{}.ymap", plan.map),
            &built.map,
            ("entities", plan.entities.len()),
        )?,
    ];
    if plan.with_manifest {
        files.push(depot.put("_manifest.ymf", &plan.manifest()?, ("imapDependencies", 1))?);
    }
    Ok(object([
        ("format", "astral.placements".into()),
        ("version", 1.into()),
        ("exportedBy", "Astral Placements 1".into()),
        ("files", Value::Array(files)),
    ]))
}

#[cfg(test)]
mod tests;
