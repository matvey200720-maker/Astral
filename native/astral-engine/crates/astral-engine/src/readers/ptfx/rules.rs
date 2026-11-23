//! Пять команд над `.ypt` на диске (ядро эффектов или донорский словарь): граф связей
//! правил, полная выгрузка полей, сводка для окна, списки эволюций и сырые
//! встроенные ключевые кадры.
//!
//! Вся работа с форматом Rockstar — в `rage_res::ypt`; здесь только разбор параметров,
//! чтение файла и сборка JSON из того, что отдал сосед. Команды заменяют прежнего
//! помощника `rpf-helper` (`ypt-rule-export`, `ypt-rule-digest`).

use rage_res::{
    ypt::{
        evolutions::{self, Key},
        export, rules as graph,
    },
    Resource,
};
use serde_json::{Map, Value};

use super::scene::export_of;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Что нужно каждой из пяти команд после подготовки: ресурс и имена правил.
struct Job {
    resource: Resource,
    names: Vec<String>,
}

/// Общая подготовка: `--input` (существующий `.ypt`), хотя бы одно `--name`, чтение
/// файла, строка хода (она выходит до разбора) и разбор ресурса; дальше работает `body`.
fn with_job(
    options: &Options,
    progress: &Progress,
    phase: &str,
    body: impl FnOnce(&Job) -> Result<Value>,
) -> Result<Value> {
    let input = paths::existing_file(options.required("input")?, &[".ypt"])?;
    let names = match options.values("name") {
        [] => {
            return Err(EngineError::argument(
                "Нужно хотя бы одно --name с именем правила эффекта.",
            ))
        }
        given => given.to_vec(),
    };
    let bytes = std::fs::read(&input)?;
    progress.report(phase);
    body(&Job {
        resource: Resource::parse(&bytes)?,
        names,
    })
}

/// Объект JSON из пар «ключ, значение» в заданном порядке.
fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn names_json(items: impl IntoIterator<Item = String>) -> Value {
    Value::Array(items.into_iter().map(Value::String).collect())
}

/// Событие правила: эмиттер и частица (каждое может отсутствовать).
fn event_json(event: graph::EventNames) -> Value {
    let name = |slot: Option<String>| slot.map_or(Value::Null, Value::String);
    object([
        ("emitter", name(event.emitter)),
        ("particle", name(event.particle)),
    ])
}

fn particle_json(part: graph::ParticleNames) -> Value {
    object([
        ("shaderTextures", names_json(part.shader_textures)),
        ("drawables", names_json(part.drawables)),
        ("spawned", names_json(part.spawned)),
    ])
}

/// Граф правил в форме ответа `read-ypt-rules`.
fn graph_json(found: graph::RuleGraph) -> Value {
    let effects: Map<String, Value> = found
        .effects
        .into_iter()
        .map(|(name, effect)| {
            let events = effect.events.into_iter().map(event_json).collect();
            (name, object([("events", Value::Array(events))]))
        })
        .collect();
    let particles: Map<String, Value> = found
        .particles
        .into_iter()
        .map(|(name, part)| (name, particle_json(part)))
        .collect();
    object([
        ("effects", Value::Object(effects)),
        ("emitters", names_json(found.emitters)),
        ("particles", Value::Object(particles)),
        ("textures", names_json(found.textures)),
        ("drawables", names_json(found.drawables)),
        ("missing", names_json(found.missing)),
    ])
}

/// `read-ypt-rules`: граф связей запрошенных правил.
pub fn read_ypt_rules(options: &Options, progress: &Progress) -> Result<Value> {
    with_job(options, progress, "rules", |job| {
        Ok(graph_json(graph::walk(&job.resource, &job.names)?))
    })
}

/// `read-ypt-export`: полная выгрузка полей правил (та же, что кладёт в `exports` сцена).
pub fn read_ypt_export(options: &Options, progress: &Progress) -> Result<Value> {
    with_job(options, progress, "export", |job| {
        let names: Vec<&str> = job.names.iter().map(String::as_str).collect();
        export_of(&job.resource, &names)
    })
}

/// `read-ypt-digest`: короткая сводка каждого запрошенного правила (или `null`).
pub fn read_ypt_digest(options: &Options, progress: &Progress) -> Result<Value> {
    with_job(options, progress, "digest", |job| {
        let summaries = export::digest(&job.resource, &job.names)?;
        Ok(object([("rules", Value::Object(summaries))]))
    })
}

/// Четыре числа `f32` как числа `f64` без изменений.
fn quad(values: [f32; 4]) -> Value {
    Value::from(values.map(f64::from).to_vec())
}

fn key_json(key: &Key) -> Value {
    object([("time", quad(key.time)), ("value", quad(key.value))])
}

fn keys_json(keys: &[Key]) -> Value {
    Value::Array(keys.iter().map(key_json).collect())
}

fn frame_json(frame: &evolutions::Frame) -> Value {
    object([
        ("evolution", Value::from(frame.evolution)),
        ("lod", Value::from(frame.lod)),
        ("keys", keys_json(&frame.keys)),
    ])
}

fn property_json(property: &evolutions::Property) -> Value {
    object([
        ("hash", Value::from(property.hash)),
        ("blend", Value::from(property.blend)),
        (
            "frames",
            Value::Array(property.frames.iter().map(frame_json).collect()),
        ),
    ])
}

fn evolutions_json(list: &evolutions::Evolutions) -> Value {
    object([
        ("evolutions", Value::from(list.names.clone())),
        (
            "properties",
            Value::Array(list.properties.iter().map(property_json).collect()),
        ),
    ])
}

/// Правила эффектов по точному имени: для `evolutions` и `keyframes`, где имена не
/// проверяются и не обрезаются. Повтор имени перезаписывает то же место.
fn per_rule(job: &Job, detail: impl Fn(&Resource, usize) -> Result<Value>) -> Result<Value> {
    let positions = graph::effect_positions(&job.resource)?;
    job.names
        .iter()
        .map(|name| {
            let value = match positions.get(name) {
                Some(at) => detail(&job.resource, *at)?,
                None => Value::Null,
            };
            Ok((name.clone(), value))
        })
        .collect::<Result<Map<String, Value>>>()
        .map(Value::Object)
}

/// `read-ypt-evolutions`: списки эволюций правил.
pub fn read_ypt_evolutions(options: &Options, progress: &Progress) -> Result<Value> {
    with_job(options, progress, "evolutions", |job| {
        per_rule(job, |resource, at| {
            Ok(match graph::effect_evolutions_at(resource, at) {
                Some(list_at) => evolutions_json(&evolutions::read(resource, list_at)?),
                None => evolutions_json(&evolutions::Evolutions::default()),
            })
        })
    })
}

/// Число встроенных слотов ключевых кадров у правила.
const KEYFRAME_SLOTS: usize = 5;

/// Смещение списка ключей внутри слота.
const SLOT_KEY_LIST: usize = 0x70;

fn hex_lower(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|b| [DIGITS[usize::from(b >> 4)], DIGITS[usize::from(b & 15)]])
        .map(char::from)
        .collect()
}

/// Встроенные слоты ключевых кадров правила: сырые байты слота и его ключи.
fn keyframe_slots(resource: &Resource, rule_at: usize) -> Result<Value> {
    (0..KEYFRAME_SLOTS)
        .map(|slot| {
            let start = rule_at + graph::EFFECT_KEYFRAME_PROPS + slot * graph::KEYFRAME_PROP_LENGTH;
            let raw = resource.bytes(start, graph::KEYFRAME_PROP_LENGTH)?;
            let keys = evolutions::read_keys(resource, start + SLOT_KEY_LIST)?;
            Ok(object([
                ("slot", Value::from(slot)),
                ("raw", Value::from(hex_lower(raw))),
                ("keys", keys_json(&keys)),
            ]))
        })
        .collect::<Result<Vec<_>>>()
        .map(Value::Array)
}

/// `read-ypt-keyframes`: пять встроенных слотов ключевых кадров правила.
pub fn read_ypt_keyframes(options: &Options, progress: &Progress) -> Result<Value> {
    with_job(options, progress, "keyframes", |job| {
        per_rule(job, keyframe_slots)
    })
}

#[cfg(test)]
mod tests;
