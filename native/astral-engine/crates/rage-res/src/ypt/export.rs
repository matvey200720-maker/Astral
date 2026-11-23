//! Выгрузка правил эффектов ядра `core.ypt` в JSON и короткая сводка правила.
//!
//! Объект выгрузки собирается по таблице слотов: у каждого слота есть ключ, смещение и функция-читатель,
//! а ключи в готовой карте идут по байтам имени. Сводка (`digest`) строится не из байтов файла, а из
//! готового JSON, по таблицам «ключ сводки → способ свести».

use std::cell::Cell;
use std::collections::BTreeMap;

use serde_json::{json, Map, Number, Value};

use super::evolutions::{self, Key};
use super::names::name_of;
use super::rules::{self, EFFECT_KEYFRAME_PROPS, KEYFRAME_PROP_LENGTH};
use super::{
    cmp_ordinal_ignore_case, named, read_list, EFFECT_EVOLUTIONS, EFFECT_NAME,
    EMITTER_RULE_NAME, EVENT_EVOLUTIONS, PARTICLE_RULE_NAME,
};
use crate::drawable::{read_materials, read_raw_parts, Sampler};
use crate::error::{Error, Result};
use crate::hash::joaat;
use crate::resource::Resource;

/// Сколько записей и объектов один вызов выгрузки может обойти. Списки в файле заявляют число
/// записей двумя байтами, а указатели могут вести на одни и те же объекты, поэтому без потолка
/// специально собранный файл заставлял бы обходить 65535 в степени глубины.
const WORK_LIMIT: usize = 4_000_000;
const MSG_WORK: &str = "Файл частиц требует слишком много работы: списки в нём слишком велики или повторяются.";

thread_local! {
    static WORK_LEFT: Cell<usize> = const { Cell::new(WORK_LIMIT) };
}

/// Начинает отсчёт работы для нового вызова выгрузки.
fn start_work() {
    WORK_LEFT.with(|left| left.set(WORK_LIMIT));
}

/// Списывает `units` работы; отказ, когда потолок исчерпан.
fn spend(units: usize) -> Result<()> {
    WORK_LEFT.with(|left| match left.get().checked_sub(units) {
        Some(rest) => {
            left.set(rest);
            Ok(())
        }
        None => Err(Error::broken(MSG_WORK)),
    })
}

/// Последний байт, который читается у правила эффекта.
const EFFECT_LAST_BYTE: usize = 0x3AB;
/// Список моделей частицы: записи подряд, у каждой имя и указатель на объект.
const MODEL_LIST: usize = 0x210;
const MODEL_STRIDE: usize = 0x30;
const MODEL_NAME: usize = 0x10;
const MODEL_OBJECT: usize = 0x18;
/// Связи смещения частицы: записи подряд.
const LINK_LIST: usize = 0x188;
const LINK_STRIDE: usize = 0x58;
/// Целыми выводятся только числа строго меньше этого порога.
const WHOLE_BELOW: f64 = 9.0e15;
const SCALE: f64 = 10000.0;
const ZOOM_NAME: &str = "ptxEffectRule:m_zoomScalarKFP";

// ---------------------------------------------------------------- числа

/// Число JSON из f64: нефинитные значения — строки, целые меньше порога — целые.
fn json_f64(x: f64) -> Value {
    match (x.is_nan(), x.is_infinite()) {
        (true, _) => Value::from("NaN"),
        (_, true) => Value::from(["-Infinity", "Infinity"][usize::from(x.is_sign_positive())]),
        _ if x.trunc() == x && x.abs() < WHOLE_BELOW => Value::from(x as i64),
        _ => Number::from_f64(x).map_or(Value::Null, Value::Number),
    }
}

/// Число поля: кратчайшая десятичная запись f32, прочитанная как f64.
fn real(v: f32) -> Value {
    json_f64(if v.is_finite() {
        v.to_string().parse().unwrap_or(f64::from(v))
    } else {
        f64::from(v)
    })
}

fn snap(x: f64) -> f64 {
    (x * SCALE).round_ties_even() / SCALE
}

/// Число модели: до четырёх знаков, без перехода через текст.
fn model_real(v: f32) -> Value {
    json_f64(snap(f64::from(v)))
}

/// Число сводки: значение из JSON выгрузки проходит через f32 и четыре знака.
fn summary_real(v: Option<&Value>) -> Value {
    match v.and_then(Value::as_f64) {
        Some(x) if !x.is_finite() => Value::from(0),
        other => real(snap(f64::from(other.unwrap_or(0.0) as f32)) as f32),
    }
}

// ---------------------------------------------------------------- слоты и читатели

type Reader = fn(&Resource, usize) -> Result<Value>;

/// Поле объекта: ключ в JSON, смещение от начала объекта и читатель; `Null` значит «ключа нет».
struct Slot {
    key: &'static str,
    at: usize,
    read: Reader,
}

type Table = &'static [Slot];

macro_rules! table {
    ($($key:literal @ $at:expr => $read:expr),+ $(,)?) => {
        &[$(Slot { key: $key, at: $at, read: $read }),+]
    };
}

/// Собирает объект по таблицам слотов; ключи отсортированы по байтам.
fn assemble(res: &Resource, base: usize, tables: &[Table]) -> Result<Map<String, Value>> {
    spend(1)?;
    let mut cells = tables
        .iter()
        .flat_map(|table| table.iter())
        .map(|slot| (slot.read)(res, base + slot.at).map(|value| (slot.key, value)))
        .collect::<Result<Vec<_>>>()?;
    cells.retain(|(_, value)| !value.is_null());
    cells.sort_by_key(|&(key, _)| key);
    Ok(cells
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect())
}

fn byte(res: &Resource, at: usize) -> Result<Value> {
    res.u8(at).map(Value::from)
}

fn flag(res: &Resource, at: usize) -> Result<Value> {
    res.u8(at).map(|b| Value::from(b & 1))
}

fn dword(res: &Resource, at: usize) -> Result<Value> {
    res.u32(at).map(Value::from)
}

fn signed(res: &Resource, at: usize) -> Result<Value> {
    res.u32(at).map(|v| Value::from(v as i32))
}

fn float(res: &Resource, at: usize) -> Result<Value> {
    res.f32(at).map(real)
}

fn triple(res: &Resource, at: usize) -> Result<Value> {
    (0..3)
        .map(|k| float(res, at + 4 * k))
        .collect::<Result<Vec<_>>>()
        .map(Value::Array)
}

fn fixed<const N: i64>(_: &Resource, _: usize) -> Result<Value> {
    Ok(Value::from(N))
}

/// Имя из таблицы известных по хешу в слове; чужой хеш даёт пустую строку.
fn hashed(res: &Resource, at: usize) -> Result<Value> {
    res.u32(at).map(|hash| Value::from(name_of(hash)))
}

/// Строка по указателю в самом слоте; пустая и из пробелов — `""`.
fn caption(res: &Resource, at: usize) -> Result<Value> {
    Ok(Value::from(named(res, at, 0).unwrap_or_default()))
}

/// Имя объекта, на который указывает слот.
fn linked<const NAME: usize>(res: &Resource, at: usize) -> Result<Value> {
    Ok(Value::from(
        res.pointer_at(at)
            .and_then(|object| named(res, object, NAME))
            .unwrap_or_default(),
    ))
}

fn or_null(items: Vec<Value>) -> Value {
    if items.is_empty() {
        Value::Null
    } else {
        Value::Array(items)
    }
}

fn or_blank(items: Vec<Value>) -> Value {
    if items.is_empty() {
        Value::from("")
    } else {
        Value::Array(items)
    }
}

/// Адреса записей списка: по числу, с шагом `stride`; без массива записей нет.
fn rows(res: &Resource, list: usize, stride: usize) -> Result<Vec<usize>> {
    let (array, count) = read_list(res, list)?;
    spend(count)?;
    Ok(array.map_or_else(Vec::new, |first| {
        (0..count).map(|k| first + k * stride).collect()
    }))
}

/// Объекты, на которые указывают слоты списка указателей.
fn targets(res: &Resource, list: usize) -> Result<Vec<usize>> {
    Ok(rows(res, list, 8)?
        .into_iter()
        .filter_map(|slot| res.pointer_at(slot))
        .collect())
}

fn table_docs(res: &Resource, at: Vec<usize>, table: Table) -> Result<Vec<Value>> {
    at.into_iter()
        .map(|object| assemble(res, object, &[table]).map(Value::Object))
        .collect()
}

fn key_sample(key: &Key) -> Value {
    let [x, y, z, w] = key.value;
    Value::Array([key.time[0], x, y, z, w].map(real).to_vec())
}

fn key_rows(res: &Resource, list: usize) -> Result<Value> {
    evolutions::read_keys(res, list)
        .map(|keys| Value::Array(keys.iter().map(key_sample).collect()))
}

fn key_prop(res: &Resource, at: usize) -> Result<Value> {
    assemble(res, at, &[PROP_DOC]).map(Value::Object)
}

fn key_props<const N: usize>(res: &Resource, at: usize) -> Result<Value> {
    (0..N)
        .map(|k| key_prop(res, at + k * KEYFRAME_PROP_LENGTH))
        .collect::<Result<Vec<_>>>()
        .map(Value::Array)
}

fn domain_kind(res: &Resource, at: usize) -> Result<Value> {
    const KINDS: [&str; 4] = ["Box", "Sphere", "Cylinder", "Attractor"];
    res.u8(at)
        .map(|code| Value::from(KINDS.get(usize::from(code)).copied().unwrap_or("")))
}

fn domain_ref(res: &Resource, slot: usize) -> Result<Value> {
    res.pointer_at(slot).map_or(Ok(Value::Null), |domain| {
        assemble(res, domain, &[DOMAIN_DOC]).map(Value::Object)
    })
}

fn spawner(res: &Resource, at: usize) -> Result<Value> {
    assemble(res, at, &[SPAWNER_DOC]).map(Value::Object)
}

fn event_docs(res: &Resource, effect: usize) -> Result<Value> {
    table_docs(res, rules::event_positions(res, effect)?, EVENT_DOC).map(Value::Array)
}

/// Список эволюций по его адресу.
fn evolution_value(res: &Resource, list: usize) -> Result<Value> {
    let data = evolutions::read(res, list)?;
    let props = data
        .properties
        .iter()
        .map(|prop| {
            let frames = prop
                .frames
                .iter()
                .map(|frame| {
                    let keys = frame.keys.iter().map(key_sample).collect::<Vec<_>>();
                    json!({
                        "EvolutionID": frame.evolution,
                        "IsLodEvolution": frame.lod,
                        "Keyframes": keys,
                    })
                })
                .collect();
            json!({
                "BlendMode": prop.blend,
                "Items": or_blank(frames),
                "Name": name_of(prop.hash),
            })
        })
        .collect();
    let names = data.names.into_iter().map(Value::from).collect();
    Ok(json!({
        "Evolutions": or_blank(names),
        "EvolvedKeyframeProps": or_blank(props),
    }))
}

fn evolutions_ref(res: &Resource, slot: usize) -> Result<Value> {
    res.pointer_at(slot)
        .map_or(Ok(Value::Null), |list| evolution_value(res, list))
}

fn behaviour_label(res: &Resource, at: usize) -> Result<Value> {
    let hash = res.u32(at)?;
    Ok(Value::from(
        BEHAVIOURS
            .iter()
            .find(|kind| kind.0 == hash)
            .map_or("", |kind| kind.1),
    ))
}

fn behaviour_doc(res: &Resource, at: usize) -> Result<Value> {
    let hash = res.u32(at + 8)?;
    let fields = BEHAVIOURS
        .iter()
        .find(|kind| kind.0 == hash)
        .map_or(&[][..], |kind| kind.2);
    assemble(res, at, &[BEHAVIOUR_HEAD, fields]).map(Value::Object)
}

fn behaviour_docs(res: &Resource, particle: usize) -> Result<Value> {
    rules::behaviour_positions(res, particle)?
        .into_iter()
        .map(|at| behaviour_doc(res, at))
        .collect::<Result<Vec<_>>>()
        .map(Value::Array)
}

/// Тип переменной шейдера в слове `+0x14`: от него зависит и набор полей.
fn var_label(res: &Resource, at: usize) -> Result<Value> {
    Ok(Value::from(match res.u8(at)? {
        2 => "Vector2",
        4 => "Vector4",
        6 => "Texture",
        7 => "Keyframe",
        _ => "",
    }))
}

fn var_doc(res: &Resource, var: usize) -> Result<Option<Value>> {
    let specific = match res.u8(var + 0x14)? {
        2 | 4 => VAR_VECTOR,
        6 => VAR_TEXTURE,
        7 => VAR_KEYFRAME,
        _ => return Ok(None),
    };
    assemble(res, var, &[VAR_COMMON, specific]).map(|doc| Some(Value::Object(doc)))
}

fn var_docs(res: &Resource, list: usize) -> Result<Value> {
    targets(res, list)?
        .into_iter()
        .filter_map(|var| var_doc(res, var).transpose())
        .collect::<Result<Vec<_>>>()
        .map(Value::Array)
}

fn var_items(res: &Resource, list: usize) -> Result<Value> {
    table_docs(res, rows(res, list, 0x20)?, VAR_ITEM).map(or_blank)
}

fn model_docs(res: &Resource, list: usize) -> Result<Value> {
    table_docs(res, rows(res, list, MODEL_STRIDE)?, MODEL_DOC).map(or_null)
}

fn link_doc(res: &Resource, at: usize) -> Result<Value> {
    let ids = rows(res, at + 0x40, 4)?
        .into_iter()
        .map(|slot| res.u32(slot).map(|id| Value::from(format!("hash_{id:08X}"))))
        .collect::<Result<Vec<_>>>()?;
    let raw = res.bytes(at, 0x40)?;
    let name = &raw[..raw.iter().position(|&b| b == 0).unwrap_or(raw.len())];
    let random = res.u32(at + 0x50)?;
    Ok(json!({
        "KeyframePropIDs": or_blank(ids),
        "Name": String::from_utf8_lossy(name),
        "RandomIndex": random,
    }))
}

fn link_docs(res: &Resource, list: usize) -> Result<Value> {
    rows(res, list, LINK_STRIDE)?
        .into_iter()
        .map(|at| link_doc(res, at))
        .collect::<Result<Vec<_>>>()
        .map(or_null)
}

// ---------------------------------------------------------------- таблицы объектов

const PROP_DOC: Table = table! {
    "InvertBiasLink" @ 0x6C => byte,
    "Keyframes" @ 0x70 => key_rows,
    "Name" @ 0x68 => hashed,
    "RandomIndex" @ 0x6D => byte,
};

const EFFECT_DOC: Table = table! {
    "CollisionProbeDistance" @ 0xB8 => float,
    "CollisionRange" @ 0xB4 => float,
    "CollisionType" @ 0xBC => byte,
    "ColourTintMaxEnable" @ 0x3A0 => byte,
    "DataVolumeType" @ 0x3A2 => byte,
    "DistanceCullingCullDist" @ 0xA8 => float,
    "DistanceCullingFadeDist" @ 0xA4 => float,
    "DistanceCullingMode" @ 0x8C => byte,
    "DrawListID" @ 0x55 => byte,
    "DurationMax" @ 0x7C => float,
    "DurationMin" @ 0x78 => float,
    "EmitWhenDistanceCulled" @ 0x8F => byte,
    "EmitWhenViewportCulled" @ 0x8B => byte,
    "EventEmitters" @ 0 => event_docs,
    "EvolutionList" @ EFFECT_EVOLUTIONS => evolutions_ref,
    "FileVersion" @ 0x18 => float,
    "GameFlags" @ 0xBF => byte,
    "HasNoShadows" @ 0x57 => byte,
    "IsShortLived" @ 0x56 => byte,
    "KeyframeProps" @ EFFECT_KEYFRAME_PROPS => key_props::<5>,
    "LodEvoDistanceMax" @ 0xB0 => float,
    "LodEvoDistanceMin" @ 0xAC => float,
    "Name" @ EFFECT_NAME => caption,
    "NumLoops" @ 0x50 => dword,
    "OnlyUseBVHCollisions" @ 0xBE => byte,
    "PlaybackRateScalarMax" @ 0x84 => float,
    "PlaybackRateScalarMin" @ 0x80 => float,
    "PreUpdateTime" @ 0x70 => float,
    "PreUpdateTimeInterval" @ 0x74 => float,
    "RefCount" @ 0 => fixed::<1>,
    "RenderWhenDistanceCulled" @ 0x8D => byte,
    "RenderWhenViewportCulled" @ 0x89 => byte,
    "ShareEntityCollisions" @ 0xBD => flag,
    "SortEventsByDistance" @ 0x54 => byte,
    "UpdateWhenDistanceCulled" @ 0x8E => flag,
    "UpdateWhenViewportCulled" @ 0x8A => byte,
    "UseDataVolume" @ 0x3A1 => byte,
    "VRandomOffsetPos" @ 0x60 => triple,
    "ViewportCullingMode" @ 0x88 => byte,
    "ViewportCullingSphereOffset" @ 0x90 => triple,
    "ViewportCullingSphereRadius" @ 0xA0 => float,
    "ZoomLevel" @ 0x3A8 => float,
};

const EVENT_DOC: Table = table! {
    "ColourTintMax" @ 0x64 => dword,
    "ColourTintMin" @ 0x60 => dword,
    "EmitterRule" @ 0x40 => linked::<EMITTER_RULE_NAME>,
    "EndRatio" @ 0x14 => float,
    "EventType" @ 0 => fixed::<0>,
    "EvolutionList" @ EVENT_EVOLUTIONS => evolutions_ref,
    "ParticleRule" @ 0x48 => linked::<PARTICLE_RULE_NAME>,
    "PlaybackRateScalarMax" @ 0x54 => float,
    "PlaybackRateScalarMin" @ 0x50 => float,
    "StartRatio" @ 0x10 => float,
    "ZoomScalarMax" @ 0x5C => float,
    "ZoomScalarMin" @ 0x58 => float,
};

const EMITTER_DOC: Table = table! {
    "AttractorDomainObj" @ 0x58 => domain_ref,
    "CreationDomainObj" @ 0x38 => domain_ref,
    "IsOneShot" @ 0x628 => byte,
    "KeyframeProps" @ 0x78 => key_props::<10>,
    "Name" @ EMITTER_RULE_NAME => caption,
    "RefCount" @ 0x10 => dword,
    "TargetDomainObj" @ 0x48 => domain_ref,
};

const DOMAIN_DOC: Table = table! {
    "DomainType" @ 0x0C => domain_kind,
    "FileVersion" @ 0x258 => float,
    "IsCreationRelative" @ 0x12 => flag,
    "IsPointRelative" @ 0x11 => flag,
    "IsTargetRelatve" @ 0x13 => flag,
    "IsWorldSpace" @ 0x10 => flag,
    "PositionKFP" @ 0x18 => key_prop,
    "RotationKFP" @ 0xA8 => key_prop,
    "SizeInnerKFP" @ 0x1C8 => key_prop,
    "SizeOuterKFP" @ 0x138 => key_prop,
};

const SPAWNER_DOC: Table = table! {
    "ColourTintScalarMax" @ 0x40 => dword,
    "ColourTintScalarMin" @ 0x20 => dword,
    "DurationScalarMax" @ 0x38 => float,
    "DurationScalarMin" @ 0x18 => float,
    "EffectRule" @ 0x58 => linked::<EFFECT_NAME>,
    "FlagsMax" @ 0x48 => dword,
    "FlagsMin" @ 0x28 => dword,
    "InheritsPointLife" @ 0x6C => byte,
    "PlaybackRateScalarMax" @ 0x3C => float,
    "PlaybackRateScalarMin" @ 0x1C => float,
    "TracksPointDir" @ 0x6E => byte,
    "TracksPointNegDir" @ 0x6F => byte,
    "TracksPointPos" @ 0x6D => byte,
    "TriggerInfo" @ 0x68 => float,
    "ZoomScalarMax" @ 0x44 => float,
    "ZoomScalarMin" @ 0x24 => float,
};

const PARTICLE_DOC: Table = table! {
    "AllBehaviours" @ 0 => behaviour_docs,
    "AlphaBlend" @ 0 => fixed::<1>,
    "BiasLinks" @ LINK_LIST => link_docs,
    "BlendSet" @ 0x104 => byte,
    "CullMode" @ 0x100 => byte,
    "DepthTest" @ 0x10D => byte,
    "DepthWrite" @ 0x10C => byte,
    "DiffuseMode" @ 0x1E0 => byte,
    "DrawType" @ 0x221 => byte,
    "Drawables" @ MODEL_LIST => model_docs,
    "EffectSpawnerAtRatio" @ 0x20 => spawner,
    "EffectSpawnerOnCollision" @ 0x90 => spawner,
    "Flags" @ 0 => fixed::<0>,
    "IsLit" @ 0x1E8 => byte,
    "IsNormalSpec" @ 0x1EC => byte,
    "IsRefract" @ 0x1EB => byte,
    "IsScreenSpace" @ 0x1EA => byte,
    "IsSoft" @ 0x1E9 => byte,
    "LightingMode" @ 0x108 => byte,
    "Name" @ PARTICLE_RULE_NAME => caption,
    "ProjectionMode" @ 0x1E4 => byte,
    "RefCount" @ 0x10 => dword,
    "RuntimeFlags" @ 0 => fixed::<0>,
    "ShaderFile" @ 0x1B8 => caption,
    "ShaderTechnique" @ 0x1C0 => caption,
    "ShaderTemplateTechniqueID" @ 0x1D0 => byte,
    "ShaderVars" @ 0x1F0 => var_docs,
    "SortType" @ 0x220 => byte,
    "TexFrameIDMax" @ 0x11C => dword,
    "TexFrameIDMin" @ 0x118 => dword,
};

const MODEL_DOC: Table = table! {
    "BoundBoxDepth" @ 8 => float,
    "BoundBoxHeight" @ 4 => float,
    "BoundBoxWidth" @ 0 => float,
    "BoundingSphereRadius" @ 0xC => float,
    "Name" @ MODEL_NAME => caption,
};

const VAR_COMMON: Table = table! {
    "Name" @ 0x10 => hashed,
    "ShaderVarID" @ 0x18 => dword,
    "Type" @ 0x14 => var_label,
};
const VAR_VECTOR: Table = table! {
    "IsKeyFrameable" @ 0 => fixed::<0>,
    "VectorW" @ 0x3C => float,
    "VectorX" @ 0x30 => float,
    "VectorY" @ 0x34 => float,
    "VectorZ" @ 0x38 => float,
};
const VAR_TEXTURE: Table = table! {
    "ExternalReference" @ 0x3C => byte,
    "IsKeyframeable" @ 0 => fixed::<0>,
    "TextureName" @ 0x30 => caption,
};
const VAR_KEYFRAME: Table = table! {
    "IsKeyframeable" @ 0 => fixed::<1>,
    "Items" @ 0x28 => var_items,
};
const VAR_ITEM: Table = table! {
    "Unknown0" @ 0 => float,
    "Unknown10" @ 0x10 => float,
    "Unknown4" @ 4 => float,
};

/// Общий слот всех поведений: тип по хешу в `+8`.
const BEHAVIOUR_HEAD: Table = table! { "Type" @ 8 => behaviour_label };

const ACCELERATION: Table = table! {
    "EnableGravity" @ 0 => fixed::<0>,
    "IsAffectedByZoom" @ 0x15C => byte,
    "ReferenceSpace" @ 0x158 => byte,
    "XYZMaxKFP" @ 0xC0 => key_prop,
    "XYZMinKFP" @ 0x30 => key_prop,
};
const ANIMATE_TEXTURE: Table = table! {
    "AnimRateKFP" @ 0x30 => key_prop,
    "DoFrameBlending" @ 0xCF => byte,
    "IsHeldOnLastFrame" @ 0xCE => byte,
    "IsRandomised" @ 0xCC => byte,
    "IsScaledOverParticleLife" @ 0xCD => byte,
    "KeyframeMode" @ 0xC0 => byte,
    "LastFrameID" @ 0xC4 => signed,
    "LoopMode" @ 0xC8 => byte,
};
const ATTRACTOR: Table = table! { "StrengthKFP" @ 0x30 => key_prop };
const COLLISION: Table = table! {
    "BounceDirVarKFP" @ 0xC0 => key_prop,
    "BouncinessKFP" @ 0x30 => key_prop,
    "CollisionChance" @ 0x158 => byte,
    "KillChance" @ 0x15C => byte,
    "OverrideMinRadius" @ 0 => fixed::<0>,
    "RadiusMult" @ 0x150 => float,
    "RestSpeed" @ 0x154 => float,
};
const COLOUR: Table = table! {
    "EmissiveIntensityKFP" @ 0x150 => key_prop,
    "KeyframeMode" @ 0x1E0 => byte,
    "RGBAMaxEnable" @ 0x1E4 => byte,
    "RGBAMaxKFP" @ 0xC0 => key_prop,
    "RGBAMinKFP" @ 0x30 => key_prop,
    "RGBAProportional" @ 0x1E5 => byte,
    "RGBCanTint" @ 0x1E6 => byte,
};
const DAMPENING: Table = table! {
    "EnableAirResistance" @ 0 => fixed::<0>,
    "ReferenceSpace" @ 0x158 => byte,
    "XYZMaxKFP" @ 0xC0 => key_prop,
    "XYZMinKFP" @ 0x30 => key_prop,
};
const DECAL: Table = table! {
    "AlphaKFP" @ 0xC0 => key_prop,
    "DecalID" @ 0x150 => signed,
    "DimensionsKFP" @ 0x30 => key_prop,
    "DistanceScale" @ 0x178 => float,
    "DuplicateRejectDist" @ 0x16C => float,
    "FadeInTime" @ 0x15C => float,
    "FlipU" @ 0x170 => byte,
    "FlipV" @ 0x171 => byte,
    "ProjectionDepth" @ 0x174 => float,
    "ProportionalSize" @ 0x172 => byte,
    "TotalLife" @ 0x158 => float,
    "UVMultEnd" @ 0x164 => float,
    "UVMultStart" @ 0x160 => float,
    "UVMultTime" @ 0x168 => float,
    "UseComplexCollision" @ 0x173 => byte,
    "VelocityThreshold" @ 0 => fixed::<0>,
};
const DECAL_POOL: Table = table! {
    "DecalID" @ 0x38 => signed,
    "EndSize" @ 0x40 => float,
    "GrowthRate" @ 0x44 => float,
    "LiquidType" @ 0x34 => signed,
    "StartSize" @ 0x3C => float,
    "VelocityThreshold" @ 0 => fixed::<0>,
};
const FOG_VOLUME: Table = table! {
    "ColourTintFromParticle" @ 0x42C => byte,
    "DensityRangeKFP" @ 0x150 => key_prop,
    "Falloff" @ 0x420 => float,
    "HDRMult" @ 0x424 => float,
    "LightingType" @ 0x428 => byte,
    "RGBTintMaxKFP" @ 0xC0 => key_prop,
    "RGBTintMinKFP" @ 0x30 => key_prop,
    "RotationMaxKFP" @ 0x390 => key_prop,
    "RotationMinKFP" @ 0x300 => key_prop,
    "ScaleMaxKFP" @ 0x270 => key_prop,
    "ScaleMinKFP" @ 0x1E0 => key_prop,
    "SortWithParticles" @ 0x42D => byte,
    "UseEffectEvoValues" @ 0 => fixed::<0>,
    "UseGroundFogColour" @ 0x42E => byte,
};
const LIGHT: Table = table! {
    "CastsShadows" @ 0x549 => byte,
    "ColourFromParticle" @ 0x545 => byte,
    "ColourPerFrame" @ 0x546 => byte,
    "CoronaFlareKFP" @ 0x4B0 => key_prop,
    "CoronaIntensityKFP" @ 0x390 => key_prop,
    "CoronaNotInReflection" @ 0 => fixed::<0>,
    "CoronaOnlyInReflection" @ 0x54B => byte,
    "CoronaRGBMaxKFP" @ 0x300 => key_prop,
    "CoronaRGBMinKFP" @ 0x270 => key_prop,
    "CoronaSizeKFP" @ 0x420 => key_prop,
    "CoronaUseLightColour" @ 0x544 => byte,
    "CoronaZBias" @ 0x540 => float,
    "IntensityKFP" @ 0x150 => key_prop,
    "IntensityPerFrame" @ 0x547 => byte,
    "LightType" @ 0x54C => byte,
    "RGBMaxKFP" @ 0xC0 => key_prop,
    "RGBMinKFP" @ 0x30 => key_prop,
    "RangeKFP" @ 0x1E0 => key_prop,
    "RangePerFrame" @ 0x548 => byte,
};
const LIQUID: Table = table! {
    "LiquidType" @ 0x34 => signed,
    "PoolEndSize" @ 0x3C => float,
    "PoolGrowthRate" @ 0x40 => float,
    "PoolStartSize" @ 0x38 => float,
    "TrailWidthMax" @ 0x48 => float,
    "TrailWidthMin" @ 0x44 => float,
    "VelocityThreshold" @ 0 => fixed::<0>,
};
const MATRIX_WEIGHT: Table = table! {
    "ReferenceSpace" @ 0xC0 => byte,
    "mtxWeightKFP" @ 0x30 => key_prop,
};
const MODEL: Table = table! {
    "CameraShrink" @ 0x34 => float,
    "DisableDraw" @ 0 => fixed::<0>,
    "ShadowCastIntensity" @ 0x38 => float,
};
const NOISE: Table = table! {
    "KeepConstantSpeed" @ 0x274 => byte,
    "PosNoiseMaxKFP" @ 0xC0 => key_prop,
    "PosNoiseMinKFP" @ 0x30 => key_prop,
    "ReferenceSpace" @ 0x270 => byte,
    "VelNoiseMaxKFP" @ 0x1E0 => key_prop,
    "VelNoiseMinKFP" @ 0x150 => key_prop,
};
const RIVER: Table = table! {
    "Influence" @ 0x34 => float,
    "VelocityMult" @ 0x30 => float,
};
const ROTATION: Table = table! {
    "AccumulateAngle" @ 0x278 => byte,
    "AngleMaxKFP" @ 0x1E0 => key_prop,
    "AngleMinKFP" @ 0x150 => key_prop,
    "InitRotationMode" @ 0x270 => byte,
    "InitialAngleMaxKFP" @ 0xC0 => key_prop,
    "InitialAngleMinKFP" @ 0x30 => key_prop,
    "RotateAngleAxes" @ 0x279 => byte,
    "RotateInitAngleAxes" @ 0x27A => byte,
    "SpeedFadeThreshold" @ 0x27C => float,
    "UpdateRotationMode" @ 0x274 => byte,
};
const SIZE: Table = table! {
    "IsProportional" @ 0x274 => byte,
    "KeyframeMode" @ 0x270 => byte,
    "TblrScalarKFP" @ 0x150 => key_prop,
    "TblrVelScalarKFP" @ 0x1E0 => key_prop,
    "WhdMaxKFP" @ 0xC0 => key_prop,
    "WhdMinKFP" @ 0x30 => key_prop,
};
const SPRITE: Table = table! {
    "AlignAxis" @ 0x30 => triple,
    "AlignmentMode" @ 0x40 => byte,
    "DisableDraw" @ 0x61 => byte,
    "FarClip" @ 0x5F => byte,
    "FarClipDist" @ 0x50 => float,
    "FlipChanceU" @ 0x44 => float,
    "FlipChanceV" @ 0x48 => float,
    "IsHighRes" @ 0x5D => byte,
    "IsScreenSpace" @ 0x5C => byte,
    "NearClip" @ 0x5E => byte,
    "NearClipDist" @ 0x4C => float,
    "ProjectionDepth" @ 0x54 => float,
    "ShadowCastIntensity" @ 0x58 => float,
    "UVClip" @ 0x60 => byte,
};
const TRAIL: Table = table! {
    "AlignAxis" @ 0xC0 => triple,
    "AlignmentMode" @ 0 => fixed::<0>,
    "DisableDraw" @ 0xEF => byte,
    "FlipU" @ 0xEC => byte,
    "FlipV" @ 0xED => byte,
    "ProjectionDepth" @ 0xE4 => float,
    "ShadowCastIntensity" @ 0 => fixed::<0>,
    "SmoothnessX" @ 0xDC => float,
    "SmoothnessY" @ 0xE0 => float,
    "TessellationU" @ 0xD4 => byte,
    "TessellationV" @ 0xD8 => byte,
    "TexInfoKFP" @ 0x30 => key_prop,
    "WrapTextureOverParticleLife" @ 0xEE => byte,
};
const WIND: Table = table! {
    "HighLodDisturbanceMode" @ 0xD8 => byte,
    "HighLodRange" @ 0xD0 => float,
    "IgnoreMtxWeight" @ 0xE0 => byte,
    "InfluenceKFP" @ 0x30 => key_prop,
    "LodLodDisturbanceMode" @ 0xDC => byte,
    "LowLodRange" @ 0xD4 => float,
};
const Z_CULL: Table = table! {
    "CullMode" @ 0x158 => byte,
    "FadeDistKFP" @ 0xC0 => key_prop,
    "HeightKFP" @ 0x30 => key_prop,
    "ReferenceSpace" @ 0x15C => byte,
};
const NO_FIELDS: Table = &[];

/// Типы поведений: хеш, имя и таблица полей.
const BEHAVIOURS: &[(u32, &str, Table)] = &[
    (0xF5B3_3BAA, "Age", NO_FIELDS),
    (0xD63D_9F1B, "Acceleration", ACCELERATION),
    (0x6C07_19BC, "Velocity", NO_FIELDS),
    (0x1EE6_4552, "Rotation", ROTATION),
    (0x38B6_0240, "Size", SIZE),
    (0x052B_1293, "Dampening", DAMPENING),
    (0x64E5_D702, "MatrixWeight", MATRIX_WEIGHT),
    (0x928A_1C45, "Collision", COLLISION),
    (0xECA8_4C1E, "AnimateTexture", ANIMATE_TEXTURE),
    (0x164A_EA72, "Colour", COLOUR),
    (0x68FA_73F5, "Sprite", SPRITE),
    (0x38B6_3978, "Wind", WIND),
    (0x0544_C710, "Light", LIGHT),
    (0x6232_E25A, "Model", MODEL),
    (0x8F3B_6036, "Decal", DECAL),
    (0xA35C_721F, "ZCull", Z_CULL),
    (0xB77F_ED19, "Noise", NOISE),
    (0x25AC_9437, "Attractor", ATTRACTOR),
    (0xC573_77F8, "Trail", TRAIL),
    (0xA05D_A63E, "FogVolume", FOG_VOLUME),
    (0xD459_4BEF, "River", RIVER),
    (0xA2D6_DC3F, "DecalPool", DECAL_POOL),
    (0xDF22_9542, "Liquid", LIQUID),
];

// ---------------------------------------------------------------- выгрузка

/// Поля правила эффекта по смещению объекта в данных (без проверки версии и словарей).
pub fn effect(res: &Resource, at: usize) -> Result<Map<String, Value>> {
    start_work();
    effect_object(res, at)
}

fn effect_object(res: &Resource, at: usize) -> Result<Map<String, Value>> {
    // Хвост объекта читается первым: у короткого ресурса отказ сразу, в том числе когда
    // адрес так велик, что смещение не умещается в `usize`.
    res.bytes(at, EFFECT_LAST_BYTE + 1)?;
    assemble(res, at, &[EFFECT_DOC])
}

pub struct Export {
    pub effects: Map<String, Value>,
    pub emitters: Map<String, Value>,
    pub particles: Map<String, Value>,
    pub textures: Vec<String>,
    pub drawables: Vec<String>,
    pub meshes: Map<String, Value>,
    pub missing: Vec<String>,
}

/// Первый объект на каждое имя; имена идут по байтам.
fn first_by_name(pairs: impl Iterator<Item = (String, usize)>) -> BTreeMap<String, usize> {
    pairs.fold(BTreeMap::new(), |mut found, (name, object)| {
        found.entry(name).or_insert(object);
        found
    })
}

fn docs_by_name(
    res: &Resource,
    objects: &BTreeMap<String, usize>,
    table: Table,
) -> Result<Map<String, Value>> {
    objects
        .iter()
        .map(|(name, &at)| assemble(res, at, &[table]).map(|doc| (name.clone(), Value::Object(doc))))
        .collect()
}

struct Mesh {
    name: String,
    doc: Value,
    textures: Vec<String>,
}

fn build_mesh(res: &Resource, name: String, drawable: usize) -> Result<Mesh> {
    let parts = read_raw_parts(res, drawable)?;
    let materials = read_materials(res, drawable)?.1;
    let diffuse = joaat("diffusesampler");
    let named_diffuse = |sampler: &&Sampler| {
        sampler.hash == diffuse && sampler.texture.as_ref().is_some_and(|text| !text.is_empty())
    };
    let texture_of = |slot: usize| {
        let material = materials.get(slot)?.as_ref()?;
        material.samplers.iter().rfind(named_diffuse)?.texture.clone()
    };
    let numbers = |values: &[f32]| Value::Array(values.iter().map(|&v| model_real(v)).collect());
    let picked = parts
        .iter()
        .map(|part| texture_of(part.shader_index))
        .collect::<Vec<_>>();
    let docs = parts
        .iter()
        .zip(&picked)
        .map(|(part, texture)| {
            json!({
                "positions": numbers(&part.positions),
                "normals": numbers(part.normals.as_deref().unwrap_or_default()),
                "uvs": numbers(part.uvs.as_deref().unwrap_or_default()),
                "indices": part.indices,
                "texture": texture,
            })
        })
        .collect::<Vec<_>>();
    Ok(Mesh {
        name,
        doc: json!({ "parts": docs }),
        textures: picked.into_iter().flatten().collect(),
    })
}

pub fn rules(res: &Resource, names: &[String]) -> Result<Export> {
    start_work();
    let graph = rules::walk(res, names)?;
    let positions = rules::effect_positions(res)?;
    let found = graph
        .effects
        .keys()
        .filter_map(|name| positions.get(name).map(|&at| (name, at)))
        .collect::<Vec<_>>();

    let effects = found
        .iter()
        .map(|&(name, at)| effect_object(res, at).map(|doc| (name.clone(), Value::Object(doc))))
        .collect::<Result<Map<_, _>>>()?;

    let events = found
        .iter()
        .map(|&(_, at)| rules::event_positions(res, at))
        .collect::<Result<Vec<_>>>()?
        .concat();
    let (emitter_at, particle_at): (Vec<_>, Vec<_>) = events
        .into_iter()
        .map(|event| rules::event_objects(res, event))
        .unzip();
    let named_by = |objects: Vec<Option<usize>>, name_at: usize| {
        first_by_name(
            objects
                .into_iter()
                .flatten()
                .filter_map(|object| named(res, object, name_at).map(|name| (name, object))),
        )
    };
    let emitter_objects = named_by(emitter_at, EMITTER_RULE_NAME);
    let particle_objects = named_by(particle_at, PARTICLE_RULE_NAME);

    let emitters = docs_by_name(res, &emitter_objects, EMITTER_DOC)?;
    let particles = docs_by_name(res, &particle_objects, PARTICLE_DOC)?;

    let model_slots = particle_objects
        .values()
        .map(|&particle| rows(res, particle + MODEL_LIST, MODEL_STRIDE))
        .collect::<Result<Vec<_>>>()?
        .concat();
    let model_objects = first_by_name(model_slots.into_iter().filter_map(|slot| {
        Some((named(res, slot, MODEL_NAME)?, res.pointer_at(slot + MODEL_OBJECT)?))
    }));
    let mut meshes = model_objects
        .into_iter()
        .map(|(name, at)| build_mesh(res, name, at))
        .collect::<Result<Vec<_>>>()?;
    meshes.sort_by(|a, b| cmp_ordinal_ignore_case(&a.name, &b.name));

    let mut textures = graph
        .textures
        .into_iter()
        .chain(meshes.iter().flat_map(|mesh| mesh.textures.clone()))
        .fold(Vec::<String>::new(), |mut kept, texture| {
            if kept.iter().all(|known| cmp_ordinal_ignore_case(known, &texture).is_ne()) {
                kept.push(texture);
            }
            kept
        });
    textures.sort_by(|a, b| cmp_ordinal_ignore_case(a.as_str(), b.as_str()));

    Ok(Export {
        effects,
        emitters,
        particles,
        textures,
        drawables: graph.drawables,
        meshes: meshes.into_iter().map(|mesh| (mesh.name, mesh.doc)).collect(),
        missing: graph.missing,
    })
}

// ---------------------------------------------------------------- сводка

/// Короткие обращения к полям JSON-документа выгрузки.
trait Peek {
    fn word(&self, key: &str) -> &str;
    fn int(&self, key: &str) -> i64;
    fn list(&self, key: &str) -> &[Value];
}

impl Peek for Value {
    fn word(&self, key: &str) -> &str {
        self.get(key).and_then(Value::as_str).unwrap_or("")
    }

    fn int(&self, key: &str) -> i64 {
        self.get(key).and_then(Value::as_i64).unwrap_or(0)
    }

    fn list(&self, key: &str) -> &[Value] {
        self.get(key)
            .and_then(Value::as_array)
            .map_or(&[], Vec::as_slice)
    }
}

/// Кадры ключевого свойства: строка `[время, x, y, z, w]` на ключ.
fn frames(prop: &Value) -> Vec<Value> {
    prop.list("Keyframes")
        .iter()
        .map(|key| {
            let cells = key.as_array().map_or(&[][..], Vec::as_slice);
            Value::Array(cells.iter().map(|cell| summary_real(Some(cell))).collect())
        })
        .collect()
}

/// Короткое имя свойства: после первого `:`, без `m_` впереди и `KFP` позади.
fn short_name(full: &str) -> &str {
    let tail = full.find(':').map_or(full, |colon| &full[colon + 1..]);
    let from = if tail.starts_with("m_") { 2 } else { 0 };
    let to = if tail.len() >= from + 3 && tail.ends_with("KFP") {
        tail.len() - 3
    } else {
        tail.len()
    };
    &tail[from..to]
}

/// Свойства с кадрами под короткими именами; при совпадении имён остаётся первое.
fn short_props<'a>(props: impl Iterator<Item = &'a Value>) -> Value {
    let named_frames = props.filter_map(|prop| {
        let rows = frames(prop);
        let key = short_name(prop.word("Name"));
        (!rows.is_empty() && !key.is_empty()).then(|| (key.to_owned(), Value::Array(rows)))
    });
    Value::Object(named_frames.fold(Map::new(), |mut acc, (key, rows)| {
        acc.entry(key).or_insert(rows);
        acc
    }))
}

/// Кадры ключевых свойств поведения в порядке их смещений.
fn behaviour_props(doc: &Value) -> Value {
    let fields = BEHAVIOURS
        .iter()
        .find(|kind| kind.1 == doc.word("Type"))
        .map_or(&[][..], |kind| kind.2);
    let mut keyed = fields
        .iter()
        .filter(|slot| doc.get(slot.key).is_some_and(|v| v.get("Keyframes").is_some()))
        .collect::<Vec<_>>();
    keyed.sort_by_key(|slot| slot.at);
    short_props(keyed.into_iter().filter_map(|slot| doc.get(slot.key)))
}

type Spec = &'static [(&'static str, Fold)];

/// Способ свести значение документа выгрузки к значению сводки.
#[derive(Clone, Copy)]
enum Fold {
    /// Значение как есть.
    Raw(&'static str),
    /// Число сводки.
    Tidy(&'static str),
    /// Пара чисел сводки.
    Tidy2(&'static str, &'static str),
    Int(&'static str),
    Int2(&'static str, &'static str),
    On(&'static str),
    Text(&'static str),
    Lower(&'static str),
    /// Кадры ключевого свойства, лежащего под ключом.
    Rows(&'static str),
    /// Вложенный объект сводится по своей таблице; нет объекта — `null`.
    Sub(&'static str, Spec),
    /// Объект ищется по имени из ключа в карте выгрузки.
    Via(fn(&Export) -> &Map<String, Value>, &'static str, Spec),
    Calc(fn(&Value, &Export) -> Value),
}

impl Fold {
    fn apply(self, src: &Value, export: &Export) -> Value {
        match self {
            Fold::Raw(key) => src.get(key).cloned().unwrap_or(Value::Null),
            Fold::Tidy(key) => summary_real(src.get(key)),
            Fold::Tidy2(low, high) => {
                Value::Array(vec![summary_real(src.get(low)), summary_real(src.get(high))])
            }
            Fold::Int(key) => Value::from(src.int(key)),
            Fold::Int2(low, high) => json!([src.int(low), src.int(high)]),
            Fold::On(key) => Value::Bool(src.int(key) != 0),
            Fold::Text(key) => Value::from(src.word(key)),
            Fold::Lower(key) => Value::from(src.word(key).to_lowercase()),
            Fold::Rows(key) => Value::Array(src.get(key).map(frames).unwrap_or_default()),
            Fold::Sub(key, spec) => src
                .get(key)
                .map_or(Value::Null, |inner| fold(&[spec], inner, export)),
            Fold::Via(book, key, spec) => book(export)
                .get(src.word(key))
                .map_or(Value::Null, |inner| fold(&[spec], inner, export)),
            Fold::Calc(calc) => calc(src, export),
        }
    }
}

fn fold(specs: &[Spec], src: &Value, export: &Export) -> Value {
    Value::Object(
        specs
            .iter()
            .flat_map(|spec| spec.iter())
            .map(|(key, how)| ((*key).to_owned(), how.apply(src, export)))
            .collect(),
    )
}

const RULE_SPEC: Spec = &[
    ("duration", Fold::Tidy2("DurationMin", "DurationMax")),
    ("playback", Fold::Tidy2("PlaybackRateScalarMin", "PlaybackRateScalarMax")),
    ("loops", Fold::Raw("NumLoops")),
    ("cull", Fold::Tidy2("DistanceCullingFadeDist", "DistanceCullingCullDist")),
    ("lod", Fold::Tidy2("LodEvoDistanceMin", "LodEvoDistanceMax")),
    (
        "zoom",
        Fold::Calc(|rule, _| {
            let zoom = rule.list("KeyframeProps").iter().find(|p| p.word("Name") == ZOOM_NAME);
            Value::Array(zoom.map(frames).unwrap_or_default())
        }),
    ),
    (
        "events",
        Fold::Calc(|rule, export| {
            let complete = |event: &&Value| {
                !event.word("EmitterRule").is_empty() && !event.word("ParticleRule").is_empty()
            };
            Value::Array(
                rule.list("EventEmitters")
                    .iter()
                    .filter(complete)
                    .map(|event| fold(&[EVENT_SPEC], event, export))
                    .collect(),
            )
        }),
    ),
];

const EVENT_SPEC: Spec = &[
    ("emitter", Fold::Text("EmitterRule")),
    ("particle", Fold::Text("ParticleRule")),
    ("start", Fold::Tidy("StartRatio")),
    ("end", Fold::Tidy("EndRatio")),
    ("zoom", Fold::Tidy2("ZoomScalarMin", "ZoomScalarMax")),
    ("playback", Fold::Tidy2("PlaybackRateScalarMin", "PlaybackRateScalarMax")),
    (
        "evolutions",
        Fold::Calc(|event, _| {
            let names = event.get("EvolutionList").map_or(&[][..], |list| list.list("Evolutions"));
            Value::Array(
                names
                    .iter()
                    .filter(|name| name.as_str().is_some_and(|text| !text.is_empty()))
                    .cloned()
                    .collect(),
            )
        }),
    ),
    ("emitterRule", Fold::Via(|export| &export.emitters, "EmitterRule", EMITTER_SPEC)),
    ("particleRule", Fold::Via(|export| &export.particles, "ParticleRule", PARTICLE_SPEC)),
];

const EMITTER_SPEC: Spec = &[
    ("oneShot", Fold::On("IsOneShot")),
    ("props", Fold::Calc(|emitter, _| short_props(emitter.list("KeyframeProps").iter()))),
    ("creation", Fold::Sub("CreationDomainObj", DOMAIN_SPEC)),
    ("target", Fold::Sub("TargetDomainObj", DOMAIN_SPEC)),
    ("attractor", Fold::Sub("AttractorDomainObj", DOMAIN_SPEC)),
];

const DOMAIN_SPEC: Spec = &[
    ("type", Fold::Lower("DomainType")),
    ("worldSpace", Fold::On("IsWorldSpace")),
    ("pointRelative", Fold::On("IsPointRelative")),
    ("position", Fold::Rows("PositionKFP")),
    ("rotation", Fold::Rows("RotationKFP")),
    ("sizeOuter", Fold::Rows("SizeOuterKFP")),
    ("sizeInner", Fold::Rows("SizeInnerKFP")),
];

const PARTICLE_SPEC: Spec = &[
    (
        "texture",
        Fold::Calc(|particle, _| {
            particle
                .list("ShaderVars")
                .iter()
                .rev()
                .find(|var| var.word("Name") == "diffusetex2" && var.word("Type") == "Texture")
                .map(|var| var.word("TextureName"))
                .filter(|name| !name.is_empty() && *name != "None")
                .map_or(Value::Null, Value::from)
        }),
    ),
    ("drawType", Fold::Int("DrawType")),
    ("blendSet", Fold::Int("BlendSet")),
    ("lit", Fold::On("IsLit")),
    ("soft", Fold::On("IsSoft")),
    ("technique", Fold::Text("ShaderTechnique")),
    ("frames", Fold::Int2("TexFrameIDMin", "TexFrameIDMax")),
    ("drawables", Fold::Calc(|particle, _| Value::from(particle.list("Drawables").len()))),
    (
        "behaviours",
        Fold::Calc(|particle, export| {
            let first_of_kind = particle
                .list("AllBehaviours")
                .iter()
                .filter(|doc| !doc.word("Type").is_empty())
                .fold(Map::new(), |mut acc, doc| {
                    acc.entry(doc.word("Type")).or_insert_with(|| behaviour_summary(doc, export));
                    acc
                });
            Value::Object(first_of_kind)
        }),
    ),
];

const BEHAVIOUR_PROPS: Spec = &[("props", Fold::Calc(|doc, _| behaviour_props(doc)))];

/// Признаки поведений в сводке, по типу.
const BEHAVIOUR_EXTRAS: &[(&str, Spec)] = &[
    (
        "AnimateTexture",
        &[
            ("lastFrame", Fold::Int("LastFrameID")),
            ("loopMode", Fold::Int("LoopMode")),
            ("randomised", Fold::On("IsRandomised")),
            ("scaledOverLife", Fold::On("IsScaledOverParticleLife")),
            ("heldOnLastFrame", Fold::On("IsHeldOnLastFrame")),
        ],
    ),
    (
        "Acceleration",
        &[
            ("gravity", Fold::On("EnableGravity")),
            ("affectedByZoom", Fold::On("IsAffectedByZoom")),
        ],
    ),
    (
        "Rotation",
        &[
            ("initMode", Fold::Int("InitRotationMode")),
            ("updateMode", Fold::Int("UpdateRotationMode")),
            ("accumulate", Fold::On("AccumulateAngle")),
        ],
    ),
    ("Size", &[("proportional", Fold::On("IsProportional"))]),
    (
        "Colour",
        &[
            ("maxEnabled", Fold::On("RGBAMaxEnable")),
            ("proportional", Fold::On("RGBAProportional")),
        ],
    ),
    ("Trail", &[("wrapOverLife", Fold::On("WrapTextureOverParticleLife"))]),
    ("Dampening", &[("airResistance", Fold::On("EnableAirResistance"))]),
    ("Light", &[("lightType", Fold::Int("LightType"))]),
];

fn behaviour_summary(doc: &Value, export: &Export) -> Value {
    let extras = BEHAVIOUR_EXTRAS
        .iter()
        .find(|(kind, _)| *kind == doc.word("Type"))
        .map_or(&[][..], |&(_, spec)| spec);
    fold(&[BEHAVIOUR_PROPS, extras], doc, export)
}

/// Сводка по запрошенным именам: ключ — имя как передано, значение — сводка или `null`.
pub fn digest(res: &Resource, names: &[String]) -> Result<Map<String, Value>> {
    let export = rules(res, names)?;
    let mut summaries = Map::new();
    for name in names {
        summaries.entry(name.clone()).or_insert_with(|| {
            export
                .effects
                .get(name)
                .map_or(Value::Null, |rule| fold(&[RULE_SPEC], rule, &export))
        });
    }
    Ok(summaries)
}

/// Синтетические образы для тестов: объекты кладутся подряд, указатели пишутся руками.
#[cfg(test)]
pub(super) mod fixture {
    use crate::resource::{Header, Resource};

    pub(crate) fn pointer(at: usize) -> u64 {
        0x5000_0000 + at as u64
    }

    pub(crate) fn resource(version: u32, data: Vec<u8>) -> Resource {
        let header = Header {
            system_flags: ((version >> 4) << 28) | (2 << 17),
            graphics_flags: (version & 0xf) << 28,
            system_size: data.len(),
            graphics_size: 0,
            version,
            declared_version: version,
        };
        Resource::from_parts(header, data)
    }

    pub(crate) struct Image {
        pub(crate) data: Vec<u8>,
        top: usize,
    }

    impl Image {
        pub(crate) fn new() -> Image {
            Image {
                data: vec![0; 0x40000],
                top: 0x100,
            }
        }

        /// Свободное место под объект, выровненное на 16 байт.
        pub(crate) fn alloc(&mut self, size: usize) -> usize {
            let at = self.top;
            self.top += (size + 15) & !15;
            assert!(self.top <= self.data.len(), "образ переполнен");
            at
        }

        pub(crate) fn put(&mut self, at: usize, bytes: &[u8]) {
            self.data[at..at + bytes.len()].copy_from_slice(bytes);
        }

        pub(crate) fn byte(&mut self, at: usize, value: u8) {
            self.data[at] = value;
        }

        pub(crate) fn word(&mut self, at: usize, value: u16) {
            self.put(at, &value.to_le_bytes());
        }

        pub(crate) fn dword(&mut self, at: usize, value: u32) {
            self.put(at, &value.to_le_bytes());
        }

        pub(crate) fn float(&mut self, at: usize, value: f32) {
            self.put(at, &value.to_le_bytes());
        }

        /// Указатель на `target` в слот `slot`; цель 0 оставляет слот пустым.
        pub(crate) fn link(&mut self, slot: usize, target: usize) {
            let value = if target == 0 { 0 } else { pointer(target) };
            self.put(slot, &value.to_le_bytes());
        }

        pub(crate) fn text(&mut self, slot: usize, text: &str) {
            let at = self.alloc(text.len() + 1);
            self.put(at, text.as_bytes());
            self.link(slot, at);
        }

        pub(crate) fn list(&mut self, at: usize, array: usize, count: u16, capacity: u16) {
            self.link(at, array);
            self.word(at + 8, count);
            self.word(at + 10, capacity);
        }

        /// Массив указателей на объекты и заголовок списка при нём; возвращает адрес массива.
        pub(crate) fn pointers(&mut self, at: usize, items: &[usize], capacity: u16) -> usize {
            let capacity = capacity.max(items.len() as u16);
            let array = self.alloc(usize::from(capacity.max(1)) * 8);
            for (k, item) in items.iter().enumerate() {
                self.link(array + k * 8, *item);
            }
            self.list(at, array, items.len() as u16, capacity);
            array
        }

        pub(crate) fn resource(&self, version: u32) -> Resource {
            resource(version, self.data.clone())
        }

        /// Пустой словарь текстур в корне: без него ядро не читается.
        pub(crate) fn core(&mut self) {
            let dictionary = self.alloc(0x40);
            self.link(0x20, dictionary);
        }

        pub(crate) fn dictionary(&mut self, values: &[usize]) -> usize {
            let at = self.alloc(0x40);
            self.pointers(at + 0x30, values, 0);
            at
        }

        pub(crate) fn effect(&mut self, name: &str, events: &[usize]) -> usize {
            let at = self.alloc(0x3C0);
            self.text(at + 0x20, name);
            self.pointers(at + 0x38, events, 0);
            at
        }

        pub(crate) fn event(&mut self, emitter: usize, particle: usize) -> usize {
            let at = self.alloc(0x70);
            self.link(at + 0x40, emitter);
            self.link(at + 0x48, particle);
            at
        }

        pub(crate) fn emitter(&mut self, name: &str) -> usize {
            let at = self.alloc(0x630);
            self.text(at + 0x20, name);
            at
        }

        pub(crate) fn particle(&mut self, name: &str) -> usize {
            let at = self.alloc(0x240);
            self.text(at + 0x120, name);
            at
        }

        /// Словари правил в корне: эффекты @0x48, эмиттеры @0x50, частицы @0x38; пустые не пишутся.
        pub(crate) fn rule_dictionaries(
            &mut self,
            effects: &[usize],
            emitters: &[usize],
            particles: &[usize],
        ) {
            for (slot, values) in [(0x48, effects), (0x50, emitters), (0x38, particles)] {
                if !values.is_empty() {
                    let dictionary = self.dictionary(values);
                    self.link(slot, dictionary);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::fixture::{resource, Image};
    use super::*;
    use crate::error::Kind as Failure;
    use crate::hash::joaat;
    use crate::ypt::names::hash_name;

    const EOF: &str = "Чтение за концом данных ресурса.";

    fn json_text(value: impl Into<Value>) -> String {
        serde_json::to_string(&value.into()).unwrap()
    }

    fn pattern(img: &mut Image, at: usize, len: usize) {
        for offset in 0..len {
            img.data[at + offset] = offset as u8;
        }
    }

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    /// Ключевое свойство: хеш имени, два байта и ключи `[время, x, y, z, w]`.
    fn set_prop(img: &mut Image, at: usize, name: &str, bytes: (u8, u8), keys: &[[f32; 5]]) {
        img.dword(at + 0x68, hash_name(name));
        img.byte(at + 0x6C, bytes.0);
        img.byte(at + 0x6D, bytes.1);
        if keys.is_empty() {
            return;
        }
        let array = img.alloc(keys.len() * 0x20);
        for (k, key) in keys.iter().enumerate() {
            img.float(array + k * 0x20, key[0]);
            for c in 0..4 {
                img.float(array + k * 0x20 + 0x10 + c * 4, key[1 + c]);
            }
        }
        img.list(at + 0x70, array, keys.len() as u16, keys.len() as u16);
    }

    type EvolutionKey = [f32; 5];
    type EvolutionFrame = (i32, u8, Vec<EvolutionKey>);

    /// Список эволюций: имена и свойства `(хеш, режим, кадры)`.
    fn evolution_list(
        img: &mut Image,
        list_names: &[&str],
        props: &[(u32, u32, Vec<EvolutionFrame>)],
    ) -> usize {
        let at = img.alloc(0x40);
        if !list_names.is_empty() {
            let array = img.alloc(list_names.len() * 0x18);
            for (k, name) in list_names.iter().enumerate() {
                img.text(array + k * 0x18, name);
            }
            img.list(at, array, list_names.len() as u16, list_names.len() as u16);
        }
        if !props.is_empty() {
            let table = img.alloc(props.len() * 0x18);
            for (p, (hash, blend, frames)) in props.iter().enumerate() {
                let item = table + p * 0x18;
                if !frames.is_empty() {
                    let array = img.alloc(frames.len() * 0x30);
                    for (f, (evolution, lod, keys)) in frames.iter().enumerate() {
                        let frame = array + f * 0x30;
                        let key_array = img.alloc(keys.len().max(1) * 0x20);
                        for (k, key) in keys.iter().enumerate() {
                            img.float(key_array + k * 0x20, key[0]);
                            for c in 0..4 {
                                img.float(key_array + k * 0x20 + 0x10 + c * 4, key[1 + c]);
                            }
                        }
                        img.list(frame, key_array, keys.len() as u16, keys.len() as u16);
                        img.dword(frame + 0x20, *evolution as u32);
                        img.byte(frame + 0x24, *lod);
                    }
                    img.list(item, array, frames.len() as u16, frames.len() as u16);
                }
                img.dword(item + 0x10, *hash);
                img.dword(item + 0x14, *blend);
            }
            img.list(at + 0x10, table, props.len() as u16, props.len() as u16);
        }
        at
    }

    // ------------------------------------------------------------ числа

    #[test]
    fn field_numbers_use_the_shortest_f32_text() {
        let cases: &[(u32, &str)] = &[
            (0x0000_0000, "0"),
            (0x8000_0000, "0"),
            (0x3F80_0000, "1"),
            (0x3DCC_CCCD, "0.1"),
            (0x3EAA_AAAB, "0.33333334"),
            (0x47F1_2065, "123456.79"),
            (0x4B80_0001, "16777218"),
            (0x5015_02F9, "10000000000"),
            (0x59FC_F406, "8900000000000000"),
            (0x59FF_FFFF, "9007198700000000.0"),
            (0x5A0E_1BCA, "1e+16"),
            (0x60AD_78EC, "1e+20"),
            (0x7F7F_FFFF, "3.4028235e+38"),
            (0x0000_0001, "1e-45"),
            (0x7F80_0000, "\"Infinity\""),
            (0xFF80_0000, "\"-Infinity\""),
            (0x7FC0_0000, "\"NaN\""),
            (0xFFC0_0000, "\"NaN\""),
            (0x7F80_0001, "\"NaN\""),
        ];
        for &(bits, expected) in cases {
            assert_eq!(json_text(real(f32::from_bits(bits))), expected, "{bits:#010x}");
        }
    }

    #[test]
    fn whole_values_are_integers_only_below_the_limit() {
        assert!(real(1.0).is_i64());
        assert!(real(-0.0).is_i64());
        assert!(real(8.9e15).is_i64());
        assert!(real(9.0e15).is_f64());
        assert!(real(1e20).is_f64());
        assert!(real(0.1).is_f64());
        assert!(real(f32::NAN).is_string());
        assert_eq!(real(-0.0), json!(0));
    }

    #[test]
    fn model_numbers_round_half_to_even_in_f64() {
        let cases: &[(f32, &str)] = &[
            (0.03125, "0.0312"),
            (0.09375, "0.0938"),
            (0.15625, "0.1562"),
            (0.34375, "0.3438"),
            (1.23455, "1.2345"),
            (2.00005, "2.0001"),
            (1.00005, "1"),
            (123_456.79, "123456.7891"),
            (-0.00004, "0"),
            (-0.00005, "0"),
            (1e-30, "0"),
            (1e10, "10000000000"),
            (9e15, "8999999815811072"),
            (f32::MAX, "3.4028234663852886e+38"),
            (1e16, "1.0000000272564224e+16"),
            (f32::NAN, "\"NaN\""),
            (f32::INFINITY, "\"Infinity\""),
            (f32::NEG_INFINITY, "\"-Infinity\""),
        ];
        for &(value, expected) in cases {
            assert_eq!(json_text(model_real(value)), expected, "{value}");
        }
    }

    #[test]
    fn summary_numbers_round_through_f32() {
        let cases: &[(f32, &str)] = &[
            (0.03125, "0.0312"),
            (0.09375, "0.0938"),
            (0.15625, "0.1562"),
            (1.00005, "1"),
            (1.23455, "1.2345"),
            (2.00005, "2.0001"),
            (123_456.79, "123456.79"),
            (-0.00004, "0"),
            (1e-30, "0"),
            (1.0 / 3.0, "0.3333"),
            (1e20, "1e+20"),
            (f32::MAX, "3.4028235e+38"),
            (9e15, "9000000000000000.0"),
            (8.9e15, "8900000000000000"),
            (-2.5, "-2.5"),
            (0.99995, "0.9999"),
            (7.00005, "7.0001"),
            (0.000061035156, "0.0001"),
        ];
        for &(value, expected) in cases {
            let source = real(value);
            assert_eq!(json_text(summary_real(Some(&source))), expected, "{value}");
        }
        assert_eq!(summary_real(Some(&Value::from("NaN"))), json!(0));
        assert_eq!(summary_real(None), json!(0));
    }

    #[test]
    fn short_names_drop_prefix_and_suffix() {
        let cases = [
            ("ptxEmitterRule:m_spawnRateOverTimeKFP", "spawnRateOverTime"),
            ("softness", "softness"),
            ("ptxd_Trail:m_texInfoKFP", "texInfo"),
            ("ptxTargetDomain:m_positionKFP", "position"),
            ("m_aKFP", "a"),
            ("a:b:KFP", "b:"),
            ("KFP", ""),
            ("", ""),
        ];
        for (name, expected) in cases {
            assert_eq!(short_name(name), expected, "{name}");
        }
    }

    // ------------------------------------------------------------ правило эффекта

    fn blank_effect() -> (Image, usize) {
        let mut img = Image::new();
        let at = img.alloc(0x3C0);
        (img, at)
    }

    #[test]
    fn an_empty_effect_has_every_key_in_byte_order() {
        let (img, at) = blank_effect();
        let doc = effect(&img.resource(68), at).unwrap();
        let keys: Vec<&String> = doc.keys().collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
        assert_eq!(keys.len(), 41);
        assert_eq!(doc["RefCount"], 1);
        assert_eq!(doc["Name"], "");
        assert_eq!(doc["EventEmitters"], json!([]));
        assert_eq!(doc["VRandomOffsetPos"], json!([0, 0, 0]));
        assert_eq!(doc["ViewportCullingSphereOffset"], json!([0, 0, 0]));
        assert_eq!(doc["KeyframeProps"].as_array().unwrap().len(), 5);
        assert_eq!(
            doc["KeyframeProps"][0],
            json!({"InvertBiasLink": 0, "Keyframes": [], "Name": "", "RandomIndex": 0})
        );
        assert!(!doc.contains_key("EvolutionList"));
    }

    #[test]
    fn effect_fields_come_from_their_offsets() {
        let (mut img, at) = blank_effect();
        pattern(&mut img, at, 0x3C0);
        let doc = effect(&img.resource(68), at).unwrap();
        let bytes = [
            ("CollisionType", 188),
            ("ColourTintMaxEnable", 160),
            ("DataVolumeType", 162),
            ("DistanceCullingMode", 140),
            ("DrawListID", 85),
            ("EmitWhenDistanceCulled", 143),
            ("EmitWhenViewportCulled", 139),
            ("GameFlags", 191),
            ("HasNoShadows", 87),
            ("IsShortLived", 86),
            ("OnlyUseBVHCollisions", 190),
            ("RenderWhenDistanceCulled", 141),
            ("RenderWhenViewportCulled", 137),
            ("SortEventsByDistance", 84),
            ("UpdateWhenViewportCulled", 138),
            ("UseDataVolume", 161),
            ("ViewportCullingMode", 136),
        ];
        for (key, expected) in bytes {
            assert_eq!(doc[key], expected, "{key}");
        }
        assert_eq!(doc["NumLoops"], 1_397_903_696u32);
        assert_eq!(doc["ShareEntityCollisions"], 1);
        assert_eq!(doc["UpdateWhenDistanceCulled"], 0);
        let floats = [
            ("DurationMin", 0x78),
            ("DurationMax", 0x7C),
            ("FileVersion", 0x18),
            ("ZoomLevel", 0x3A8),
            ("CollisionRange", 0xB4),
            ("ViewportCullingSphereRadius", 0xA0),
        ];
        for (key, offset) in floats {
            let raw = [0, 1, 2, 3].map(|k| ((offset + k) & 0xFF) as u8);
            assert_eq!(doc[key], real(f32::from_le_bytes(raw)), "{key}");
        }
        assert_eq!(doc["VRandomOffsetPos"][0], real(f32::from_le_bytes([0x60, 0x61, 0x62, 0x63])));
        assert_eq!(
            doc["ViewportCullingSphereOffset"][2],
            real(f32::from_le_bytes([0x98, 0x99, 0x9A, 0x9B]))
        );
    }

    #[test]
    fn only_bit_zero_of_the_flag_bytes_counts() {
        for (byte, expected) in [(0u8, 0), (1, 1), (2, 0), (3, 1), (0x80, 0), (0x81, 1), (0xFE, 0), (0xFF, 1)] {
            let (mut img, at) = blank_effect();
            img.byte(at + 0xBD, byte);
            img.byte(at + 0x8E, byte);
            let doc = effect(&img.resource(68), at).unwrap();
            assert_eq!(doc["ShareEntityCollisions"], expected, "{byte:#x}");
            assert_eq!(doc["UpdateWhenDistanceCulled"], expected, "{byte:#x}");
        }
    }

    #[test]
    fn whole_numbers_keep_their_exact_value() {
        for value in [0u32, 1, 255, 256, 70_000, 2_147_483_647, 2_147_483_648, u32::MAX] {
            let (mut img, at) = blank_effect();
            img.dword(at + 0x50, value);
            assert_eq!(effect(&img.resource(68), at).unwrap()["NumLoops"], value);
        }
    }

    #[test]
    fn effect_names_are_kept_as_they_are() {
        let cases: Vec<(Vec<u8>, String)> = vec![
            (b"fx_one".to_vec(), "fx_one".to_owned()),
            (b"   ".to_vec(), String::new()),
            (b"\t".to_vec(), String::new()),
            (b"  keep  ".to_vec(), "  keep  ".to_owned()),
            (vec![0x61, 0xFF, 0xFE, 0x62], "a\u{fffd}\u{fffd}b".to_owned()),
            (vec![b'n'; 300], "n".repeat(256)),
        ];
        for (bytes, expected) in cases {
            let (mut img, at) = blank_effect();
            let text = img.alloc(bytes.len() + 1);
            img.put(text, &bytes);
            img.link(at + 0x20, text);
            let doc = effect(&img.resource(68), at).unwrap();
            assert_eq!(doc["Name"], expected.as_str());
        }
    }

    #[test]
    fn an_effect_must_fit_in_the_data() {
        let (img, _) = blank_effect();
        let res = img.resource(68);
        let len = res.len();
        assert!(effect(&res, len - 0x3AC).is_ok());
        for at in [len - 0x3AB, len, len + 16] {
            let error = effect(&res, at).unwrap_err();
            assert_eq!(error.kind, Failure::Broken);
            assert_eq!(error.message, EOF);
        }
    }

    #[test]
    fn an_address_at_the_end_of_the_space_is_refused_not_overflowed() {
        let (img, _) = blank_effect();
        let res = img.resource(68);
        for at in [usize::MAX, usize::MAX - 1, usize::MAX - 0x50, usize::MAX - 0x3AB, usize::MAX - 0x3AA] {
            let error = effect(&res, at).unwrap_err();
            assert_eq!((error.kind, error.message.as_str()), (Failure::Broken, EOF), "{at:#x}");
        }
    }

    #[test]
    fn one_call_cannot_walk_more_than_the_work_limit() {
        // Список на 65535 записей, на который можно ссылаться сколько угодно раз.
        let mut img = Image::new();
        let list = img.alloc(16);
        let array = img.alloc(8);
        img.list(list, array, 65535, 65535);
        let res = img.resource(68);
        start_work();
        for _ in 0..WORK_LIMIT / 65535 {
            assert_eq!(rows(&res, list, 8).unwrap().len(), 65535);
        }
        let refusal = rows(&res, list, 8).unwrap_err();
        assert_eq!((refusal.kind, refusal.message.as_str()), (Failure::Broken, MSG_WORK));
        // Каждая собранная запись тоже стоит работы.
        WORK_LEFT.with(|left| left.set(1));
        assert!(assemble(&res, 0x40, &[]).is_ok());
        assert_eq!(assemble(&res, 0x40, &[]).unwrap_err().message, MSG_WORK);
    }

    #[test]
    fn every_entry_point_starts_with_a_full_allowance() {
        let (img, at) = blank_effect();
        let res = img.resource(68);
        WORK_LEFT.with(|left| left.set(0));
        assert!(effect(&res, at).is_ok());
        WORK_LEFT.with(|left| left.set(0));
        assert!(rules(&res, &[]).is_ok());
        WORK_LEFT.with(|left| left.set(0));
        assert!(digest(&res, &[]).is_ok());
    }

    #[test]
    fn effect_ignores_the_resource_version() {
        let (img, at) = blank_effect();
        assert!(effect(&img.resource(13), at).is_ok());
    }

    // ------------------------------------------------------------ события

    #[test]
    fn events_are_listed_by_count_and_empty_slots_are_skipped() {
        let (mut img, fx) = blank_effect();
        let first = img.alloc(0x70);
        let second = img.alloc(0x70);
        img.float(first + 0x10, 0.25);
        img.float(second + 0x10, 0.5);
        let array = img.alloc(7 * 8);
        img.link(array, first);
        img.link(array + 16, second);
        img.put(array + 24, &0x5010_0000u64.to_le_bytes());
        img.link(array + 32, first);
        img.link(array + 48, second);
        img.list(fx + 0x38, array, 5, 7);
        let doc = effect(&img.resource(68), fx).unwrap();
        let starts: Vec<&Value> = doc["EventEmitters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|event| &event["StartRatio"])
            .collect();
        assert_eq!(starts, [&json!(0.25), &json!(0.5), &json!(0.25)]);
        for (count, expected) in [(3u16, 2usize), (0, 0), (9, 4)] {
            img.word(fx + 0x38 + 8, count);
            let doc = effect(&img.resource(68), fx).unwrap();
            assert_eq!(doc["EventEmitters"].as_array().unwrap().len(), expected, "{count}");
        }
    }

    #[test]
    fn an_event_carries_the_names_of_its_emitter_and_particle() {
        let mut img = Image::new();
        let emitter = img.emitter("emit_a");
        let particle = img.particle(" p ");
        let event = img.event(emitter, particle);
        let fx = img.effect("fx", &[event]);
        let doc = effect(&img.resource(68), fx).unwrap();
        let event = &doc["EventEmitters"][0];
        assert_eq!(event["EmitterRule"], "emit_a");
        assert_eq!(event["ParticleRule"], " p ");
        assert_eq!(event["EventType"], 0);
        assert_eq!(event.as_object().unwrap().len(), 11);
        let keys: Vec<&String> = event.as_object().unwrap().keys().collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[test]
    fn blank_event_names_are_empty_strings() {
        let mut img = Image::new();
        let emitter = img.alloc(0x630);
        img.text(emitter + 0x20, " \t");
        let event = img.event(emitter, 0);
        let fx = img.effect("fx", &[event]);
        let doc = effect(&img.resource(68), fx).unwrap();
        assert_eq!(doc["EventEmitters"][0]["EmitterRule"], "");
        assert_eq!(doc["EventEmitters"][0]["ParticleRule"], "");
    }

    #[test]
    fn event_fields_come_from_their_offsets() {
        let mut img = Image::new();
        let event = img.alloc(0x70);
        pattern(&mut img, event, 0x70);
        for slot in [0x18, 0x30, 0x38, 0x40, 0x48] {
            img.put(event + slot, &[0; 8]);
        }
        let doc = assemble(&img.resource(68), event, &[EVENT_DOC]).unwrap();
        assert_eq!(doc["ColourTintMax"], 1_734_763_876u32);
        assert_eq!(doc["ColourTintMin"], 1_667_391_840u32);
        assert_eq!(doc["EndRatio"], real(f32::from_le_bytes([0x14, 0x15, 0x16, 0x17])));
        assert_eq!(doc["ZoomScalarMax"], real(f32::from_le_bytes([0x5C, 0x5D, 0x5E, 0x5F])));
        assert!(!doc.contains_key("EvolutionList"));
    }

    #[test]
    fn an_event_past_the_end_of_the_data_fails_the_whole_effect() {
        let mut img = Image::new();
        let len = img.data.len();
        let array = img.alloc(8);
        img.link(array, len - 0x60);
        let fx = img.alloc(0x3C0);
        img.list(fx + 0x38, array, 1, 1);
        let error = effect(&img.resource(68), fx).unwrap_err();
        assert_eq!(error.message, EOF);
    }

    // ------------------------------------------------------------ эволюции

    #[test]
    fn evolution_lists_print_like_the_helper() {
        let mut img = Image::new();
        let zoom = hash_name("ptxEffectRule:m_zoomScalarKFP");
        let size = hash_name("ptxu_Size:m_whdMaxKFP");
        let list = evolution_list(
            &mut img,
            &["size", "Wind", "  ", ""],
            &[
                (
                    zoom,
                    1,
                    vec![
                        (0, 0, vec![[0.0, 0.0, 0.0, 0.0, 1.0], [0.5, 0.1, 0.3, 1.0 / 3.0, 0.0]]),
                        (-3, 255, vec![]),
                        (7, 1, vec![[1.0, 1.0, 2.0, 3.0, 4.0]]),
                    ],
                ),
                (0xDEAD_BEEF, u32::MAX, vec![]),
                (size, 0, vec![(1, 0, vec![])]),
            ],
        );
        let doc = evolution_value(&img.resource(68), list).unwrap();
        assert_eq!(
            json_text(doc),
            concat!(
                r#"{"Evolutions":["size","Wind","  ",""],"EvolvedKeyframeProps":["#,
                r#"{"BlendMode":1,"Items":[{"EvolutionID":0,"IsLodEvolution":0,"Keyframes":[[0,0,0,0,1],[0.5,0.1,0.3,0.33333334,0]]},"#,
                r#"{"EvolutionID":-3,"IsLodEvolution":255,"Keyframes":[]},"#,
                r#"{"EvolutionID":7,"IsLodEvolution":1,"Keyframes":[[1,1,2,3,4]]}],"Name":"ptxEffectRule:m_zoomScalarKFP"},"#,
                r#"{"BlendMode":4294967295,"Items":"","Name":""},"#,
                r#"{"BlendMode":0,"Items":[{"EvolutionID":1,"IsLodEvolution":0,"Keyframes":[]}],"Name":"ptxu_Size:m_whdMaxKFP"}]}"#,
            )
        );
    }

    #[test]
    fn empty_evolution_lists_become_empty_strings() {
        let mut img = Image::new();
        let empty = evolution_list(&mut img, &[], &[]);
        let only_name = evolution_list(&mut img, &["a"], &[]);
        let res = img.resource(68);
        assert_eq!(
            json_text(evolution_value(&res, empty).unwrap()),
            r#"{"Evolutions":"","EvolvedKeyframeProps":""}"#
        );
        assert_eq!(
            json_text(evolution_value(&res, only_name).unwrap()),
            r#"{"Evolutions":["a"],"EvolvedKeyframeProps":""}"#
        );
    }

    #[test]
    fn an_effect_and_an_event_expose_their_evolution_lists() {
        let mut img = Image::new();
        let list = evolution_list(&mut img, &["x"], &[]);
        let event = img.event(0, 0);
        img.link(event + 0x18, list);
        let fx = img.effect("fx", &[event]);
        img.link(fx + 0x48, list);
        let doc = effect(&img.resource(68), fx).unwrap();
        assert_eq!(doc["EvolutionList"]["Evolutions"], json!(["x"]));
        assert_eq!(doc["EventEmitters"][0]["EvolutionList"]["Evolutions"], json!(["x"]));
        assert_eq!(doc.len(), 42);
    }

    #[test]
    fn an_evolution_list_past_the_end_is_an_error() {
        let mut img = Image::new();
        let len = img.data.len();
        let list = img.alloc(0x40);
        let table = img.alloc(0x18);
        img.link(list + 0x10, table);
        img.word(list + 0x18, 1);
        img.link(table, len - 0x20);
        img.word(table + 8, 2);
        let error = evolution_value(&img.resource(68), list).unwrap_err();
        assert_eq!(error.message, EOF);
    }

    // ------------------------------------------------------------ ключевые свойства

    #[test]
    fn keyframe_properties_report_name_flags_and_unrounded_keys() {
        let (mut img, fx) = blank_effect();
        let titles = [
            "ptxEffectRule:m_zoomScalarKFP",
            "ptxEffectRule:m_colourTintMinKFP",
            "not_in_the_table",
            "",
            "PTXEFFECTRULE:M_DATASPHEREKFP",
        ];
        for (i, title) in titles.iter().enumerate() {
            let keys: Vec<[f32; 5]> = (0..i)
                .map(|k| [0.5 * k as f32, k as f32, 0.1, -0.0, 1e20])
                .collect();
            let at = fx + 0xC0 + i * 0x90;
            set_prop(&mut img, at, title, (i as u8, 200 + i as u8), &keys);
        }
        let doc = effect(&img.resource(68), fx).unwrap();
        assert_eq!(
            json_text(doc["KeyframeProps"].clone()),
            concat!(
                r#"[{"InvertBiasLink":0,"Keyframes":[],"Name":"ptxEffectRule:m_zoomScalarKFP","RandomIndex":200},"#,
                r#"{"InvertBiasLink":1,"Keyframes":[[0,0,0.1,0,1e+20]],"Name":"ptxEffectRule:m_colourTintMinKFP","RandomIndex":201},"#,
                r#"{"InvertBiasLink":2,"Keyframes":[[0,0,0.1,0,1e+20],[0.5,1,0.1,0,1e+20]],"Name":"","RandomIndex":202},"#,
                r#"{"InvertBiasLink":3,"Keyframes":[[0,0,0.1,0,1e+20],[0.5,1,0.1,0,1e+20],[1,2,0.1,0,1e+20]],"Name":"","RandomIndex":203},"#,
                r#"{"InvertBiasLink":4,"Keyframes":[[0,0,0.1,0,1e+20],[0.5,1,0.1,0,1e+20],[1,2,0.1,0,1e+20],[1.5,3,0.1,0,1e+20]],"Name":"ptxEffectRule:m_dataSphereKFP","RandomIndex":204}]"#,
            )
        );
    }

    // ------------------------------------------------------------ эмиттер и домен

    #[test]
    fn an_emitter_lists_only_the_domains_it_points_to() {
        let mut img = Image::new();
        let domain = img.alloc(0x280);
        for mask in 0..8usize {
            let emitter = img.emitter("E");
            for (bit, slot) in [(1, 0x38), (2, 0x48), (4, 0x58)] {
                if mask & bit != 0 {
                    img.link(emitter + slot, domain);
                }
            }
            let doc = assemble(&img.resource(68), emitter, &[EMITTER_DOC]).unwrap();
            let mut expected = vec!["IsOneShot", "KeyframeProps", "Name", "RefCount"];
            for (bit, key) in [(1, "CreationDomainObj"), (2, "TargetDomainObj"), (4, "AttractorDomainObj")] {
                if mask & bit != 0 {
                    expected.push(key);
                }
            }
            expected.sort_unstable();
            let keys: Vec<&str> = doc.keys().map(String::as_str).collect();
            assert_eq!(keys, expected, "mask {mask}");
            assert_eq!(doc["KeyframeProps"].as_array().unwrap().len(), 10);
        }
    }

    #[test]
    fn emitter_counts_come_from_the_bytes() {
        let mut img = Image::new();
        let emitter = img.emitter("E_one");
        img.dword(emitter + 0x10, u32::MAX);
        img.byte(emitter + 0x628, 7);
        let doc = assemble(&img.resource(68), emitter, &[EMITTER_DOC]).unwrap();
        assert_eq!(doc["RefCount"], 4_294_967_295u32);
        assert_eq!(doc["IsOneShot"], 7);
        assert_eq!(doc["Name"], "E_one");
    }

    #[test]
    fn an_emitter_near_the_end_of_the_data_fails() {
        let img = Image::new();
        let len = img.data.len();
        let res = img.resource(68);
        let error = assemble(&res, len - 0x100, &[EMITTER_DOC]).unwrap_err();
        assert_eq!(error.message, EOF);
    }

    #[test]
    fn domains_report_type_flags_and_four_properties() {
        let mut img = Image::new();
        let emitter = img.emitter("E");
        let domain = img.alloc(0x280);
        img.link(emitter + 0x38, domain);
        img.byte(domain + 0x0C, 1);
        img.byte(domain + 0x10, 1);
        img.byte(domain + 0x12, 1);
        img.float(domain + 0x258, 2.5);
        let doc = assemble(&img.resource(68), emitter, &[EMITTER_DOC]).unwrap();
        let domain_doc = &doc["CreationDomainObj"];
        assert_eq!(domain_doc["DomainType"], "Sphere");
        assert_eq!(domain_doc["FileVersion"], 2.5);
        assert_eq!(domain_doc["IsCreationRelative"], 1);
        assert_eq!(domain_doc["IsPointRelative"], 0);
        assert_eq!(domain_doc["IsTargetRelatve"], 0);
        assert_eq!(domain_doc["IsWorldSpace"], 1);
        for key in ["PositionKFP", "RotationKFP", "SizeInnerKFP", "SizeOuterKFP"] {
            assert_eq!(domain_doc[key]["Keyframes"], json!([]), "{key}");
        }
        assert_eq!(domain_doc.as_object().unwrap().len(), 10);
    }

    #[test]
    fn domain_types_have_fixed_names() {
        let mut img = Image::new();
        let domain = img.alloc(0x280);
        for (code, expected) in [(0u8, "Box"), (1, "Sphere"), (2, "Cylinder"), (3, "Attractor"), (4, ""), (7, ""), (255, "")] {
            img.byte(domain + 0x0C, code);
            let doc = assemble(&img.resource(68), domain, &[DOMAIN_DOC]).unwrap();
            assert_eq!(doc["DomainType"], expected, "{code}");
        }
    }

    // ------------------------------------------------------------ частица

    const PARTICLE_KEYS: [&str; 28] = [
        "AllBehaviours",
        "AlphaBlend",
        "BlendSet",
        "CullMode",
        "DepthTest",
        "DepthWrite",
        "DiffuseMode",
        "DrawType",
        "EffectSpawnerAtRatio",
        "EffectSpawnerOnCollision",
        "Flags",
        "IsLit",
        "IsNormalSpec",
        "IsRefract",
        "IsScreenSpace",
        "IsSoft",
        "LightingMode",
        "Name",
        "ProjectionMode",
        "RefCount",
        "RuntimeFlags",
        "ShaderFile",
        "ShaderTechnique",
        "ShaderTemplateTechniqueID",
        "ShaderVars",
        "SortType",
        "TexFrameIDMax",
        "TexFrameIDMin",
    ];

    fn particle_doc(img: &Image, at: usize) -> Map<String, Value> {
        assemble(&img.resource(68), at, &[PARTICLE_DOC]).unwrap()
    }

    #[test]
    fn a_plain_particle_has_the_base_key_set() {
        let mut img = Image::new();
        let particle = img.particle("PX");
        let doc = particle_doc(&img, particle);
        let keys: Vec<&str> = doc.keys().map(String::as_str).collect();
        assert_eq!(keys, PARTICLE_KEYS);
        assert_eq!(doc["AlphaBlend"], 1);
        assert_eq!(doc["Flags"], 0);
        assert_eq!(doc["RuntimeFlags"], 0);
        assert_eq!(doc["AllBehaviours"], json!([]));
        assert_eq!(doc["ShaderVars"], json!([]));
        assert_eq!(doc["ShaderFile"], "");
    }

    #[test]
    fn particle_fields_come_from_their_offsets() {
        let mut img = Image::new();
        let particle = img.alloc(0x240);
        pattern(&mut img, particle, 0x240);
        for slot in [0x128, 0x188, 0x1F0, 0x210] {
            img.put(particle + slot, &[0; 8]);
        }
        let doc = particle_doc(&img, particle);
        assert_eq!(doc["BlendSet"], 4);
        assert_eq!(doc["DepthTest"], 13);
        assert_eq!(doc["IsLit"], 232);
        assert_eq!(doc["SortType"], 32);
        assert_eq!(doc["RefCount"], 319_951_120u32);
        assert_eq!(doc["TexFrameIDMin"], 454_695_192u32);
        assert_eq!(doc["TexFrameIDMax"], 522_067_228u32);
        let at_ratio = &doc["EffectSpawnerAtRatio"];
        assert_eq!(at_ratio["ColourTintScalarMin"], 1_128_415_552u32);
        assert_eq!(at_ratio["InheritsPointLife"], 140);
        assert_eq!(at_ratio["TracksPointNegDir"], 143);
        assert_eq!(doc["EffectSpawnerOnCollision"]["TracksPointNegDir"], 255);
        assert_eq!(doc["EffectSpawnerOnCollision"]["FlagsMin"], 3_149_576_632u32);
        assert_eq!(at_ratio.as_object().unwrap().len(), 16);
    }

    #[test]
    fn a_spawner_names_the_effect_it_points_to() {
        let mut img = Image::new();
        let spawned = img.effect("fx_spawned", &[]);
        let particle = img.particle("PX");
        img.link(particle + 0x20 + 0x58, spawned);
        let doc = particle_doc(&img, particle);
        assert_eq!(doc["EffectSpawnerAtRatio"]["EffectRule"], "fx_spawned");
        assert_eq!(doc["EffectSpawnerOnCollision"]["EffectRule"], "");
    }

    fn var_object(img: &mut Image, kind: u8, name: &str, id: u32) -> usize {
        let at = img.alloc(0x50);
        img.dword(at + 0x10, hash_name(name));
        img.byte(at + 0x14, kind);
        img.dword(at + 0x18, id);
        at
    }

    #[test]
    fn shader_variables_depend_on_their_type_and_unknown_ones_are_skipped() {
        let mut img = Image::new();
        let particle = img.particle("PX");
        let vector = var_object(&mut img, 2, "softness", 11);
        for (k, value) in [1.0f32, 0.1, 0.0, 1.0 / 3.0].into_iter().enumerate() {
            img.float(vector + 0x30 + k * 4, value);
        }
        let wide = var_object(&mut img, 4, "diffusetex2", 22);
        let texture = var_object(&mut img, 6, "diffusetex2", 33);
        img.text(texture + 0x30, "ptfx_smoke");
        img.byte(texture + 0x3C, 1);
        let keyframes = var_object(&mut img, 7, "camerabias", 44);
        let items = img.alloc(0x40);
        img.float(items, 1.0);
        img.float(items + 4, 2.0);
        img.float(items + 0x10, 3.0);
        img.float(items + 0x20, 0.1);
        img.float(items + 0x30, 1e20);
        img.list(keyframes + 0x28, items, 2, 2);
        let blank = var_object(&mut img, 7, "", 45);
        let skipped: Vec<usize> = [0u8, 1, 3, 5, 8, 9, 255]
            .iter()
            .map(|&kind| var_object(&mut img, kind, "softness", 99))
            .collect();
        let mut all = vec![vector, wide, texture, keyframes, blank];
        all.extend(skipped);
        img.pointers(particle + 0x1F0, &all, 0);
        let doc = particle_doc(&img, particle);
        let vars = doc["ShaderVars"].as_array().unwrap();
        assert_eq!(vars.len(), 5);
        assert_eq!(
            json_text(vars[0].clone()),
            r#"{"IsKeyFrameable":0,"Name":"softness","ShaderVarID":11,"Type":"Vector2","VectorW":0.33333334,"VectorX":1,"VectorY":0.1,"VectorZ":0}"#
        );
        assert_eq!(vars[1]["Type"], "Vector4");
        assert_eq!(
            json_text(vars[2].clone()),
            r#"{"ExternalReference":1,"IsKeyframeable":0,"Name":"diffusetex2","ShaderVarID":33,"TextureName":"ptfx_smoke","Type":"Texture"}"#
        );
        assert_eq!(
            json_text(vars[3].clone()),
            r#"{"IsKeyframeable":1,"Items":[{"Unknown0":1,"Unknown10":3,"Unknown4":2},{"Unknown0":0.1,"Unknown10":1e+20,"Unknown4":0}],"Name":"camerabias","ShaderVarID":44,"Type":"Keyframe"}"#
        );
        assert_eq!(
            json_text(vars[4].clone()),
            r#"{"IsKeyframeable":1,"Items":"","Name":"","ShaderVarID":45,"Type":"Keyframe"}"#
        );
    }

    #[test]
    fn behaviours_read_the_layout_of_their_type() {
        let mut img = Image::new();
        let particle = img.particle("PX");
        let size = img.alloc(0x280);
        pattern(&mut img, size, 0x280);
        img.dword(size + 8, 0x38B6_0240);
        img.put(size + 0x10, &[0; 8]);
        let unknown = img.alloc(0x40);
        img.dword(unknown + 8, 0x1234_5678);
        let age = img.alloc(0x30);
        img.dword(age + 8, 0xF5B3_3BAA);
        let motion = img.alloc(0x170);
        img.dword(motion + 8, 0xD63D_9F1B);
        img.byte(motion + 0x15C, 9);
        img.pointers(particle + 0x128, &[size, unknown, age, motion], 0);
        let doc = particle_doc(&img, particle);
        let all = doc["AllBehaviours"].as_array().unwrap();
        assert_eq!(all.len(), 4);
        assert_eq!(all[0]["Type"], "Size");
        assert_eq!(all[0]["IsProportional"], 116);
        assert_eq!(all[0]["KeyframeMode"], 112);
        assert_eq!(all[0]["WhdMinKFP"]["InvertBiasLink"], 156);
        assert_eq!(all[0]["WhdMinKFP"]["RandomIndex"], 157);
        assert_eq!(all[0].as_object().unwrap().len(), 7);
        assert_eq!(all[1], json!({"Type": ""}));
        assert_eq!(all[2], json!({"Type": "Age"}));
        assert_eq!(all[3]["EnableGravity"], 0);
        assert_eq!(all[3]["IsAffectedByZoom"], 9);
        let keys: Vec<&str> = all[3].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["EnableGravity", "IsAffectedByZoom", "ReferenceSpace", "Type", "XYZMaxKFP", "XYZMinKFP"]);
    }

    #[test]
    fn bias_links_use_strings_for_missing_ids() {
        let mut img = Image::new();
        let particle = img.particle("PX");
        let array = img.alloc(5 * LINK_STRIDE);
        let ids = img.alloc(12);
        for (k, id) in [0xABu32, 0xDEAD_BEEF, 0].into_iter().enumerate() {
            img.dword(ids + k * 4, id);
        }
        img.put(array, b"link_a");
        img.list(array + 0x40, ids, 3, 3);
        img.dword(array + 0x50, 7);
        let single = img.alloc(4);
        img.dword(single, 1);
        img.put(array + 2 * LINK_STRIDE, &[b'L'; 0x40]);
        img.list(array + 2 * LINK_STRIDE + 0x40, single, 1, 1);
        img.dword(array + 2 * LINK_STRIDE + 0x50, u32::MAX);
        img.put(array + 3 * LINK_STRIDE, "имя".as_bytes());
        img.list(array + 3 * LINK_STRIDE + 0x40, single, 1, 1);
        img.put(array + 4 * LINK_STRIDE, &[b'a', 0xFF, b'b']);
        img.list(particle + LINK_LIST, array, 5, 5);
        let doc = particle_doc(&img, particle);
        let links = doc["BiasLinks"].as_array().unwrap();
        assert_eq!(links[0], json!({"KeyframePropIDs": ["hash_000000AB", "hash_DEADBEEF", "hash_00000000"], "Name": "link_a", "RandomIndex": 7}));
        assert_eq!(links[1], json!({"KeyframePropIDs": "", "Name": "", "RandomIndex": 0}));
        assert_eq!(links[2]["Name"], "L".repeat(64).as_str());
        assert_eq!(links[2]["RandomIndex"], 4_294_967_295u32);
        assert_eq!(links[3]["Name"], "имя");
        assert_eq!(links[4]["Name"], "a\u{fffd}b");
    }

    #[test]
    fn drawables_keep_entries_with_blank_names() {
        let mut img = Image::new();
        let particle = img.particle("PX");
        let array = img.alloc(3 * MODEL_STRIDE);
        for (k, value) in [1.0f32, 2.0, 3.0, 4.0].into_iter().enumerate() {
            img.float(array + k * 4, value);
        }
        img.text(array + 0x10, "mesh_a");
        img.float(array + 2 * MODEL_STRIDE, 0.1);
        img.float(array + 2 * MODEL_STRIDE + 8, 1e20);
        img.text(array + 2 * MODEL_STRIDE + 0x10, "Mesh_B");
        img.list(particle + MODEL_LIST, array, 3, 3);
        let doc = particle_doc(&img, particle);
        assert_eq!(
            json_text(doc["Drawables"].clone()),
            concat!(
                r#"[{"BoundBoxDepth":3,"BoundBoxHeight":2,"BoundBoxWidth":1,"BoundingSphereRadius":4,"Name":"mesh_a"},"#,
                r#"{"BoundBoxDepth":0,"BoundBoxHeight":0,"BoundBoxWidth":0,"BoundingSphereRadius":0,"Name":""},"#,
                r#"{"BoundBoxDepth":1e+20,"BoundBoxHeight":0,"BoundBoxWidth":0.1,"BoundingSphereRadius":0,"Name":"Mesh_B"}]"#,
            )
        );
        assert_eq!(doc.len(), 29);
    }

    // ------------------------------------------------------------ rules

    fn linked_core() -> (Image, usize, usize, usize) {
        let mut img = Image::new();
        img.core();
        let emitter = img.emitter("emit_a");
        let particle = img.particle("part_a");
        let event = img.event(emitter, particle);
        let fx = img.effect("fx_a", &[event]);
        img.rule_dictionaries(&[fx], &[emitter], &[particle]);
        (img, fx, emitter, particle)
    }

    #[test]
    fn rules_check_the_version_before_anything_else() {
        let (img, ..) = linked_core();
        let error = rules(&img.resource(13), &names(&["bad name"])).err().unwrap();
        assert_eq!(error.kind, Failure::Version);
        assert_eq!(
            error.message,
            "core.ypt версии 13 не поддерживается; ожидается Legacy 68."
        );
        let error = digest(&img.resource(165), &[]).unwrap_err();
        assert_eq!(error.kind, Failure::Version);
    }

    #[test]
    fn rules_need_a_root() {
        let error = rules(&resource(68, Vec::new()), &names(&["fx"])).err().unwrap();
        assert_eq!(error.kind, Failure::Broken);
        assert_eq!(error.message, "Корень ресурса недоступен.");
    }

    #[test]
    fn rule_names_are_validated_after_trimming() {
        let (img, ..) = linked_core();
        let res = img.resource(68);
        let long = "a".repeat(65);
        for bad in ["bad name", "", "  ", "a-b", long.as_str(), "fx\u{0}"] {
            let error = rules(&res, &names(&["fx_a", bad])).err().unwrap();
            assert_eq!(error.kind, Failure::Broken);
            assert_eq!(error.message, format!("YPT rule name is invalid: {bad}"));
        }
        let padded = rules(&res, &names(&["\u{a0}fx_a\n"])).unwrap();
        assert_eq!(padded.effects.keys().collect::<Vec<_>>(), ["fx_a"]);
        assert!(rules(&res, &names(&[&"a".repeat(64)])).is_ok());
    }

    #[test]
    fn an_empty_request_gives_an_empty_export() {
        let (img, ..) = linked_core();
        let export = rules(&img.resource(68), &[]).unwrap();
        assert!(export.effects.is_empty() && export.emitters.is_empty() && export.particles.is_empty());
        assert!(export.textures.is_empty() && export.drawables.is_empty());
        assert!(export.meshes.is_empty() && export.missing.is_empty());
    }

    #[test]
    fn a_core_without_rule_dictionaries_misses_every_name() {
        let mut img = Image::new();
        img.core();
        let export = rules(&img.resource(68), &names(&["muz_clown", "other"])).unwrap();
        assert!(export.effects.is_empty());
        assert_eq!(export.missing, ["muz_clown", "other"]);
    }

    #[test]
    fn the_export_follows_events_to_emitters_and_particles() {
        let (img, fx, ..) = linked_core();
        let export = rules(&img.resource(68), &names(&["fx_a", "nope", "nope"])).unwrap();
        assert_eq!(export.effects.keys().collect::<Vec<_>>(), ["fx_a"]);
        assert_eq!(export.emitters.keys().collect::<Vec<_>>(), ["emit_a"]);
        assert_eq!(export.particles.keys().collect::<Vec<_>>(), ["part_a"]);
        assert_eq!(export.missing, ["nope"]);
        assert_eq!(
            export.effects["fx_a"],
            Value::Object(effect(&img.resource(68), fx).unwrap())
        );
        assert_eq!(export.emitters["emit_a"]["Name"], "emit_a");
        assert_eq!(export.particles["part_a"]["Name"], "part_a");
    }

    #[test]
    fn effects_are_ordered_by_bytes_not_by_request() {
        let mut img = Image::new();
        img.core();
        let rules_list: Vec<usize> = ["b_fx", "Z_fx", "9fx", "a_fx", "_fx", "B_fx"]
            .iter()
            .map(|name| img.effect(name, &[]))
            .collect();
        img.rule_dictionaries(&rules_list, &[], &[]);
        let request = names(&["b_fx", "Z_fx", "9fx", "a_fx", "_fx", "B_fx"]);
        let export = rules(&img.resource(68), &request).unwrap();
        assert_eq!(
            export.effects.keys().collect::<Vec<_>>(),
            ["9fx", "B_fx", "Z_fx", "_fx", "a_fx", "b_fx"]
        );
    }

    #[test]
    fn effects_spawned_by_particles_are_exported_and_cycles_end() {
        let mut img = Image::new();
        img.core();
        let particle_a = img.particle("pa");
        let particle_b = img.particle("pb");
        let event_a = img.event(0, particle_a);
        let event_b = img.event(0, particle_b);
        let fx_a = img.effect("fx_A", &[event_a]);
        let fx_b = img.effect("fx_B", &[event_b]);
        let bad = img.effect("bad name", &[]);
        img.link(particle_a + 0x20 + 0x58, fx_b);
        img.link(particle_b + 0x20 + 0x58, fx_a);
        img.link(particle_b + 0x90 + 0x58, bad);
        img.rule_dictionaries(&[fx_a, fx_b, bad], &[], &[particle_a, particle_b]);
        let export = rules(&img.resource(68), &names(&["fx_A"])).unwrap();
        assert_eq!(export.effects.keys().collect::<Vec<_>>(), ["fx_A", "fx_B"]);
        assert_eq!(export.particles["pb"]["EffectSpawnerOnCollision"]["EffectRule"], "bad name");
        assert!(export.missing.is_empty());
    }

    #[test]
    fn the_first_object_with_a_name_wins() {
        let mut img = Image::new();
        img.core();
        let first = img.emitter("E");
        let second = img.emitter("E");
        img.dword(first + 0x10, 1);
        img.dword(second + 0x10, 2);
        let event_a = img.event(first, 0);
        let event_b = img.event(second, 0);
        let fx_a = img.effect("fx_a", &[event_a]);
        let fx_b = img.effect("fx_b", &[event_b]);
        let twin = img.effect("fx_a", &[event_b]);
        img.rule_dictionaries(&[fx_a, fx_b, twin], &[], &[]);
        let export = rules(&img.resource(68), &names(&["fx_b", "fx_a"])).unwrap();
        assert_eq!(export.emitters["E"]["RefCount"], 1);
        assert_eq!(export.effects["fx_a"]["EventEmitters"][0]["EmitterRule"], "E");
    }

    #[test]
    fn at_most_128_rules_can_be_found() {
        let mut img = Image::new();
        img.core();
        let list: Vec<usize> = (0..129).map(|k| img.effect(&format!("fx_{k:03}"), &[])).collect();
        img.rule_dictionaries(&list, &[], &[]);
        let res = img.resource(68);
        let mut found: Vec<String> = (0..128).map(|k| format!("fx_{k:03}")).collect();
        assert_eq!(rules(&res, &found).unwrap().effects.len(), 128);
        found.push("fx_128".to_owned());
        let error = rules(&res, &found).err().unwrap();
        assert_eq!(error.message, "YPT rule export names at most 128 rules.");
        let mut after_missing = vec!["nope".to_owned()];
        after_missing.extend((0..128).map(|k| format!("fx_{k:03}")));
        let export = rules(&res, &after_missing).unwrap();
        assert_eq!((export.effects.len(), export.missing.len()), (128, 1));
        let mut missing_last: Vec<String> = (0..128).map(|k| format!("fx_{k:03}")).collect();
        missing_last.push("nope".to_owned());
        // отсутствующее имя ничего не добавляет к 128 найденным, поэтому не мешает
        let export = rules(&res, &missing_last).unwrap();
        assert_eq!((export.effects.len(), export.missing.len()), (128, 1));
        assert_eq!(export.missing, ["nope"]);
        // а 129-е найденное правило по-прежнему отказ, даже после отсутствующего
        missing_last.push("fx_128".to_owned());
        assert_eq!(
            rules(&res, &missing_last).err().unwrap().message,
            "YPT rule export names at most 128 rules."
        );
    }

    #[test]
    fn a_particle_cut_off_by_the_end_of_the_data_is_an_error() {
        let mut img = Image::new();
        img.core();
        let len = img.data.len();
        let particle = len - 0x130;
        img.text(particle + 0x120, "pa");
        let event = img.event(0, particle);
        let fx = img.effect("fx", &[event]);
        img.rule_dictionaries(&[fx], &[], &[particle]);
        let error = rules(&img.resource(68), &names(&["fx"])).err().unwrap();
        assert_eq!(error.kind, Failure::Broken);
        assert_eq!(error.message, EOF);
    }

    // ------------------------------------------------------------ модели

    /// Материал: пары «хеш образца, текстура или её отсутствие».
    type Samplers<'a> = Vec<(u32, Option<&'a str>)>;

    struct Part {
        positions: Vec<[f32; 3]>,
        normals: Option<Vec<[f32; 3]>>,
        uvs: Option<Vec<[f32; 2]>>,
        indices: Vec<u16>,
        shader: u16,
    }

    /// Модель уровня High: по геометрии на часть; материалы — списки `(хеш образца, текстура)`.
    fn drawable(img: &mut Image, parts: &[Part], shaders: Option<&[Samplers<'_>]>) -> usize {
        let at = img.alloc(0xD0);
        if let Some(shaders) = shaders {
            let group = img.alloc(0x40);
            let array = img.alloc(shaders.len().max(1) * 8);
            for (i, slots) in shaders.iter().enumerate() {
                let shader = img.alloc(0x30);
                let params = img.alloc(slots.len().max(1) * 20 + 16);
                for (k, (hash, texture)) in slots.iter().enumerate() {
                    if let Some(name) = texture {
                        let object = img.alloc(0x90);
                        img.text(object + 0x28, name);
                        img.link(params + k * 16 + 8, object);
                    }
                    img.dword(params + slots.len() * 16 + k * 4, *hash);
                }
                img.link(shader, params);
                img.dword(shader + 8, 0x1111_1111 + i as u32);
                img.byte(shader + 0x10, slots.len() as u8);
                img.link(array + i * 8, shader);
            }
            img.link(group + 0x10, array);
            img.word(group + 0x18, shaders.len() as u16);
            img.word(group + 0x1A, shaders.len() as u16);
            img.link(at + 0x10, group);
        }
        if parts.is_empty() {
            return at;
        }
        let model = img.alloc(0x30);
        let geometries = img.alloc(parts.len() * 8);
        let mapping = img.alloc(parts.len() * 2);
        for (i, part) in parts.iter().enumerate() {
            let geometry = img.alloc(0xA0);
            let buffer = img.alloc(0x80);
            let declaration = img.alloc(0x10);
            let index_buffer = img.alloc(0x60);
            let mut flags = 1u32;
            let mut types = 6u64;
            let mut stride = 12usize;
            if part.normals.is_some() {
                flags |= 1 << 3;
                types |= 6u64 << 12;
                stride += 12;
            }
            if part.uvs.is_some() {
                flags |= 1 << 6;
                types |= 5u64 << 24;
                stride += 8;
            }
            let data = img.alloc(part.positions.len().max(1) * stride);
            for (v, position) in part.positions.iter().enumerate() {
                let mut cursor = data + v * stride;
                let mut floats: Vec<f32> = position.to_vec();
                if let Some(normals) = &part.normals {
                    floats.extend(normals[v]);
                }
                if let Some(uvs) = &part.uvs {
                    floats.extend(uvs[v]);
                }
                for value in floats {
                    img.float(cursor, value);
                    cursor += 4;
                }
            }
            img.dword(declaration, flags);
            img.word(declaration + 4, stride as u16);
            img.put(declaration + 8, &types.to_le_bytes());
            img.word(buffer + 8, stride as u16);
            img.link(buffer + 0x10, data);
            img.dword(buffer + 0x18, part.positions.len() as u32);
            img.link(buffer + 0x30, declaration);
            let index_data = img.alloc(part.indices.len().max(1) * 2);
            for (k, index) in part.indices.iter().enumerate() {
                img.word(index_data + k * 2, *index);
            }
            img.dword(index_buffer + 8, part.indices.len() as u32);
            img.link(index_buffer + 0x10, index_data);
            img.link(geometry + 0x18, buffer);
            img.link(geometry + 0x38, index_buffer);
            img.link(geometries + i * 8, geometry);
            img.word(mapping + i * 2, part.shader);
        }
        img.link(model + 8, geometries);
        img.word(model + 0x10, parts.len() as u16);
        img.link(model + 0x20, mapping);
        let models = img.alloc(8);
        img.link(models, model);
        let list = img.alloc(16);
        img.list(list, models, 1, 1);
        img.link(at + 0x50, list);
        at
    }

    fn triangle(shader: u16) -> Part {
        Part {
            positions: vec![[0.03125, 0.09375, 1.23455], [-0.00004, 2.00005, 123_456.79], [1e10, 0.3, f32::NAN]],
            normals: Some(vec![[0.0, 0.0, 2.0]; 3]),
            uvs: Some(vec![[0.5, 0.25]; 3]),
            indices: vec![0, 1, 2],
            shader,
        }
    }

    /// Список моделей частицы: имя и объект на запись.
    fn set_models(img: &mut Image, particle: usize, models: &[(&str, usize)]) {
        let array = img.alloc(models.len().max(1) * MODEL_STRIDE);
        for (k, (name, object)) in models.iter().enumerate() {
            let at = array + k * MODEL_STRIDE;
            img.text(at + 0x10, name);
            img.link(at + 0x18, *object);
        }
        img.list(particle + MODEL_LIST, array, models.len() as u16, models.len() as u16);
    }

    /// Ядро с одной частицей, у которой перечислены модели `(имя, объект)`.
    fn core_with_models(img: &mut Image, models: &[(&str, usize)]) -> Vec<String> {
        img.core();
        let particle = img.particle("pa");
        let event = img.event(0, particle);
        let fx = img.effect("fx", &[event]);
        img.rule_dictionaries(&[fx], &[], &[particle]);
        set_models(img, particle, models);
        names(&["fx"])
    }

    #[test]
    fn meshes_are_ordered_ignoring_case_and_model_real() {
        let mut img = Image::new();
        let model = drawable(&mut img, &[triangle(0)], None);
        let request = core_with_models(
            &mut img,
            &[("Zed", model), ("beta", model), ("alpha", model), ("Beta", model), ("ghost", 0)],
        );
        let export = rules(&img.resource(68), &request).unwrap();
        assert_eq!(export.meshes.keys().collect::<Vec<_>>(), ["alpha", "Beta", "beta", "Zed"]);
        assert_eq!(export.drawables, ["alpha", "beta", "ghost", "Zed"]);
        let part = &export.meshes["alpha"]["parts"][0];
        assert_eq!(
            json_text(part["positions"].clone()),
            r#"[0.0312,0.0938,1.2345,0,2.0001,123456.7891,10000000000,0.3,"NaN"]"#
        );
        assert_eq!(part["normals"], json!([0, 0, 2, 0, 0, 2, 0, 0, 2]));
        assert_eq!(part["uvs"], json!([0.5, 0.25, 0.5, 0.25, 0.5, 0.25]));
        assert_eq!(part["indices"], json!([0, 1, 2]));
        assert_eq!(part["texture"], Value::Null);
        let keys: Vec<&str> = part.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["positions", "normals", "uvs", "indices", "texture"]);
    }

    #[test]
    fn a_part_takes_the_last_named_diffuse_sample_of_its_material() {
        let diffuse = joaat("diffusesampler");
        let bump = joaat("bumpsampler");
        let mut img = Image::new();
        let shaders = vec![
            vec![(diffuse, Some("first")), (diffuse, Some("second")), (bump, Some("bumpy")), (diffuse, None)],
            vec![(bump, Some("only_bump"))],
        ];
        let mut bare = triangle(0);
        bare.normals = None;
        bare.uvs = None;
        let model = drawable(&mut img, &[triangle(0), triangle(1), triangle(7), bare], Some(shaders.as_slice()));
        let lone = drawable(&mut img, &[triangle(0)], None);
        let empty = drawable(&mut img, &[], None);
        let request = core_with_models(&mut img, &[("m", model), ("lone", lone), ("empty", empty)]);
        let export = rules(&img.resource(68), &request).unwrap();
        let textures: Vec<&Value> = export.meshes["m"]["parts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|part| &part["texture"])
            .collect();
        assert_eq!(textures, [&json!("second"), &Value::Null, &Value::Null, &json!("second")]);
        assert_eq!(export.meshes["m"]["parts"][3]["normals"], json!([]));
        assert_eq!(export.meshes["m"]["parts"][3]["uvs"], json!([]));
        assert_eq!(export.meshes["lone"]["parts"][0]["texture"], Value::Null);
        assert_eq!(export.meshes["empty"], json!({"parts": []}));
        assert_eq!(export.textures, ["second"]);
    }

    #[test]
    fn mesh_textures_join_the_traversal_ones_without_case_duplicates() {
        let diffuse = joaat("diffusesampler");
        let mut img = Image::new();
        img.core();
        let shaders = vec![vec![(diffuse, Some("PTFX_Smoke"))]];
        let model = drawable(&mut img, &[triangle(0)], Some(shaders.as_slice()));
        let particle = img.particle("pa");
        let smoke = var_object(&mut img, 6, "diffusetex2", 1);
        img.text(smoke + 0x30, "ptfx_smoke");
        let other = var_object(&mut img, 6, "diffusetex2", 2);
        img.text(other + 0x30, "ABC");
        img.pointers(particle + 0x1F0, &[smoke, other], 0);
        set_models(&mut img, particle, &[("m", model)]);
        let event = img.event(0, particle);
        let fx = img.effect("fx", &[event]);
        img.rule_dictionaries(&[fx], &[], &[particle]);
        let export = rules(&img.resource(68), &names(&["fx"])).unwrap();
        assert_eq!(export.textures, ["ABC", "ptfx_smoke"]);
    }

    // ------------------------------------------------------------ digest

    #[test]
    fn digest_keys_follow_the_names_as_passed() {
        let (img, ..) = linked_core();
        let res = img.resource(68);
        let asked = names(&["fx_a", " fx_a ", "fx_a", "nope", "FX_A"]);
        let doc = digest(&res, &asked).unwrap();
        assert_eq!(doc.keys().collect::<Vec<_>>(), ["fx_a", " fx_a ", "nope", "FX_A"]);
        assert!(doc["fx_a"].is_object());
        assert_eq!(doc[" fx_a "], Value::Null);
        assert_eq!(doc["nope"], Value::Null);
        assert_eq!(doc["FX_A"], Value::Null);
        assert!(digest(&res, &[]).unwrap().is_empty());
        assert_eq!(digest(&res, &names(&["bad name"])).err().unwrap().kind, Failure::Broken);
    }

    #[test]
    fn a_digest_keeps_only_events_with_both_rules_and_rounds_numbers() {
        let mut img = Image::new();
        img.core();
        let emitter = img.emitter("emit_d");
        let particle = img.particle("part_d");
        let list = evolution_list(&mut img, &["size", "wind", "  ", ""], &[]);
        let event = img.event(emitter, particle);
        img.link(event + 0x18, list);
        img.float(event + 0x10, 0.03125);
        img.float(event + 0x14, 0.9);
        img.float(event + 0x58, 0.5);
        img.float(event + 0x5C, 1.5);
        let half = img.event(emitter, 0);
        let fx = img.effect("fx_d", &[event, half]);
        img.dword(fx + 0x50, u32::MAX);
        img.float(fx + 0x78, 0.03125);
        img.float(fx + 0x7C, 123_456.79);
        img.float(fx + 0x80, 1.0);
        img.float(fx + 0xA4, 10.5);
        img.float(fx + 0xA8, 100.0);
        set_prop(&mut img, fx + 0xC0 + 0x90, "ptxEffectRule:m_colourTintMinKFP", (0, 0), &[[9.0; 5]]);
        set_prop(&mut img, fx + 0xC0 + 2 * 0x90, "ptxEffectRule:m_zoomScalarKFP", (0, 0), &[[0.0, 0.03125, 1.0, 0.09375, 0.5]]);
        // эмиттер: одноразовый, четыре свойства (одно без кадров, одно без имени, одно с занятым именем)
        img.byte(emitter + 0x628, 1);
        let spawn = "ptxEmitterRule:m_spawnRateOverTimeKFP";
        set_prop(&mut img, emitter + 0x78, spawn, (0, 0), &[[0.0, 1.0, 1.0, 1.0, 1.0]]);
        set_prop(&mut img, emitter + 0x78 + 0x90, "ptxEmitterRule:m_speedScalarKFP", (0, 0), &[]);
        set_prop(&mut img, emitter + 0x78 + 2 * 0x90, "", (0, 0), &[[2.0; 5]]);
        set_prop(&mut img, emitter + 0x78 + 3 * 0x90, spawn, (0, 0), &[[3.0; 5]]);
        set_prop(&mut img, emitter + 0x78 + 4 * 0x90, "softness", (0, 0), &[[4.0; 5]]);
        let domain = img.alloc(0x280);
        img.byte(domain + 0x0C, 2);
        img.byte(domain + 0x10, 1);
        set_prop(&mut img, domain + 0x18, "ptxCreationDomain:m_positionKFP", (0, 0), &[[0.5; 5]]);
        img.link(emitter + 0x38, domain);
        // частица: текстура, поведения (второе Size пропускается)
        let texture = var_object(&mut img, 6, "diffusetex2", 1);
        img.text(texture + 0x30, "ptfx_x");
        img.pointers(particle + 0x1F0, &[texture], 0);
        img.byte(particle + 0x221, 3);
        img.byte(particle + 0x104, 2);
        img.byte(particle + 0x1E8, 1);
        img.text(particle + 0x1C0, "tech_d");
        img.dword(particle + 0x118, 4);
        img.dword(particle + 0x11C, 15);
        let size = img.alloc(0x280);
        img.dword(size + 8, 0x38B6_0240);
        img.byte(size + 0x274, 1);
        set_prop(&mut img, size + 0x30, "ptxu_Size:m_whdMinKFP", (0, 0), &[[0.0, 5.0, 5.0, 5.0, 5.0]]);
        let again = img.alloc(0x280);
        img.dword(again + 8, 0x38B6_0240);
        let unknown = img.alloc(0x40);
        img.dword(unknown + 8, 7);
        let animation = img.alloc(0xD0);
        img.dword(animation + 8, 0xECA8_4C1E);
        img.dword(animation + 0xC4, (-5i32) as u32);
        img.byte(animation + 0xCC, 1);
        img.pointers(particle + 0x128, &[size, again, unknown, animation], 0);
        img.rule_dictionaries(&[fx], &[emitter], &[particle]);

        let doc = digest(&img.resource(68), &names(&["fx_d"])).unwrap();
        let rule = &doc["fx_d"];
        let keys: Vec<&str> = rule.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["duration", "playback", "loops", "cull", "lod", "zoom", "events"]);
        assert_eq!(rule["duration"], json!([0.0312, 123456.79]));
        assert_eq!(rule["playback"], json!([1, 0]));
        assert_eq!(rule["loops"], 4_294_967_295u32);
        assert_eq!(rule["cull"], json!([10.5, 100]));
        assert_eq!(rule["lod"], json!([0, 0]));
        assert_eq!(rule["zoom"], json!([[0, 0.0312, 1, 0.0938, 0.5]]));
        let events = rule["events"].as_array().unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        let keys: Vec<&str> = event.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["emitter", "particle", "start", "end", "zoom", "playback", "evolutions", "emitterRule", "particleRule"]
        );
        assert_eq!((&event["start"], &event["end"]), (&json!(0.0312), &json!(0.9)));
        assert_eq!(event["zoom"], json!([0.5, 1.5]));
        assert_eq!(event["evolutions"], json!(["size", "wind", "  "]));
        let emitter_rule = &event["emitterRule"];
        assert_eq!(emitter_rule["oneShot"], true);
        assert_eq!(
            emitter_rule["props"],
            json!({"spawnRateOverTime": [[0, 1, 1, 1, 1]], "softness": [[4, 4, 4, 4, 4]]})
        );
        assert_eq!(
            emitter_rule["creation"],
            json!({"type": "cylinder", "worldSpace": true, "pointRelative": false, "position": [[0.5, 0.5, 0.5, 0.5, 0.5]], "rotation": [], "sizeOuter": [], "sizeInner": []})
        );
        assert_eq!(emitter_rule["target"], Value::Null);
        assert_eq!(emitter_rule["attractor"], Value::Null);
        let particle_rule = &event["particleRule"];
        assert_eq!(particle_rule["texture"], "ptfx_x");
        assert_eq!(
            (&particle_rule["drawType"], &particle_rule["blendSet"], &particle_rule["lit"], &particle_rule["soft"]),
            (&json!(3), &json!(2), &json!(true), &json!(false))
        );
        assert_eq!(particle_rule["technique"], "tech_d");
        assert_eq!(particle_rule["frames"], json!([4, 15]));
        assert_eq!(particle_rule["drawables"], 0);
        assert_eq!(
            particle_rule["behaviours"],
            json!({
                "Size": {"props": {"whdMin": [[0, 5, 5, 5, 5]]}, "proportional": true},
                "AnimateTexture": {"props": {}, "lastFrame": -5, "loopMode": 0, "randomised": true, "scaledOverLife": false, "heldOnLastFrame": false},
            })
        );
    }

    #[test]
    fn the_texture_of_a_particle_summary_is_the_last_diffuse_one_and_none_is_null() {
        let cases = [("ptfx_a", "ptfx_a"), ("", ""), ("None", "")];
        for (name, expected) in cases {
            let mut img = Image::new();
            img.core();
            let particle = img.particle("pa");
            let first = var_object(&mut img, 6, "diffusetex2", 1);
            img.text(first + 0x30, "ptfx_first");
            let last = var_object(&mut img, 6, "DiffuseTex2", 2);
            if !name.is_empty() {
                img.text(last + 0x30, name);
            }
            let other = var_object(&mut img, 6, "softness", 3);
            img.text(other + 0x30, "ptfx_other");
            img.pointers(particle + 0x1F0, &[first, last, other], 0);
            let emitter = img.emitter("em");
            let event = img.event(emitter, particle);
            let fx = img.effect("fx", &[event]);
            img.rule_dictionaries(&[fx], &[emitter], &[particle]);
            let doc = digest(&img.resource(68), &names(&["fx"])).unwrap();
            let texture = &doc["fx"]["events"][0]["particleRule"]["texture"];
            if expected.is_empty() {
                assert_eq!(*texture, Value::Null, "{name}");
            } else {
                assert_eq!(*texture, expected, "{name}");
            }
        }
    }
}
