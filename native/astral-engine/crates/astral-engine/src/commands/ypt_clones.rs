//! Клоны правил эффектов `core.ypt` в движке: команда `ypt-clone-export` и разбор заказа клонов для `ypt-patch`.
//!
//! * `ypt-clone-export --request <файл.json>` — режим `ypt-clone-export` помощника: клоны собираются в памяти, ядро не
//!   пишется, ответ — выгрузка правил клонов (`ypt-rule-export`). Ответ побайтно равен ответу помощника после
//!   нормализации путей.
//! * Запись клонов (`effectClones`, `effectCloneReset`) — шаг прохода `ypt-patch` (`commands/ypt_patch.rs`): он зовёт
//!   `rage_res::ypt::effect_clones::{purge, apply}` над общим образом ядра, а разбор заказа, чтение доноров, ответ и
//!   проверку после записи берёт отсюда. Временная команда `ypt-clones-patch` (сверка 16.11.2026) убрана из реестра.

use std::{collections::BTreeSet, fs};

use rage_res::{
    hash::sha256_hex,
    ypt::{
        self,
        effect_clones::{
            self as clones, CloneAim, CloneKeyframes, CloneLayer, CloneLod, ClonePartColour, CloneScale,
            CloneTexture, CloneTune, Cloned, Donors, EffectClone,
        },
        export,
        structure::{Kind as RuleKind, Structure},
    },
};
use serde_json::Value;

use super::ypt_io::{
    field, flag_field, helper_file, int_field, lift, number_field as decimal_field, object, read_core, read_payloads,
    strings, text_field, texture_draft, wrong, TextureDraft,
};
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const EXPORT_NAME: &str = "ypt-clone-export";

// ---------------------------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------------------------

fn items<'a>(object: &'a Value, name: &str, path: &str) -> Result<Option<&'a [Value]>> {
    match field(object, name) {
        None => Ok(None),
        Some(Value::Array(list)) => Ok(Some(list)),
        Some(_) => Err(wrong(
            &format!("{path}.{name}"),
            "System.Collections.Generic.IReadOnlyList",
        )),
    }
}

fn strings_field(object: &Value, name: &str, path: &str) -> Result<Option<Vec<String>>> {
    let Some(list) = items(object, name, path)? else {
        return Ok(None);
    };
    list.iter()
        .enumerate()
        .map(|(k, item)| match item {
            Value::String(text) => Ok(text.clone()),
            _ => Err(wrong(&format!("{path}.{name}[{k}]"), "System.String")),
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn numbers_field(object: &Value, name: &str, path: &str) -> Result<Option<Vec<f64>>> {
    let Some(list) = items(object, name, path)? else {
        return Ok(None);
    };
    list.iter()
        .enumerate()
        .map(|(k, item)| match item {
            Value::Number(number) => Ok(number.as_f64().unwrap_or(0.0)),
            _ => Err(wrong(&format!("{path}.{name}[{k}]"), "System.Decimal")),
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn objects_of<T>(
    object: &Value,
    name: &str,
    path: &str,
    parse: impl Fn(&Value, &str) -> Result<T>,
) -> Result<Option<Vec<T>>> {
    let Some(list) = items(object, name, path)? else {
        return Ok(None);
    };
    list.iter()
        .enumerate()
        .map(|(k, item)| {
            let at = format!("{path}.{name}[{k}]");
            if !item.is_object() {
                return Err(wrong(&at, "Modovik.RpfHelper.Record"));
            }
            parse(item, &at)
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn clone_texture(item: &Value, path: &str) -> Result<CloneTexture> {
    Ok(CloneTexture {
        texture: text_field(item, "texture", path)?.unwrap_or_default(),
        particles: strings_field(item, "particles", path)?,
        donor_texture: text_field(item, "donorTexture", path)?,
        frame_min: int_field(item, "frameMin", path)?,
        frame_max: int_field(item, "frameMax", path)?,
        last_frame: int_field(item, "lastFrame", path)?,
        loop_mode: int_field(item, "loopMode", path)?,
        scaled_over_life: flag_field(item, "scaledOverLife", path)?,
        randomised: flag_field(item, "randomised", path)?,
    })
}

fn clone_keyframes(item: &Value, path: &str) -> Result<CloneKeyframes> {
    let rows = match items(item, "values", path)? {
        None => Vec::new(),
        Some(rows) => rows
            .iter()
            .enumerate()
            .map(|(r, row)| match row {
                Value::Array(numbers) => numbers
                    .iter()
                    .enumerate()
                    .map(|(n, number)| match number {
                        Value::Number(number) => Ok(number.as_f64().unwrap_or(0.0)),
                        _ => Err(wrong(&format!("{path}.values[{r}][{n}]"), "System.Decimal")),
                    })
                    .collect::<Result<Vec<f64>>>(),
                _ => Err(wrong(
                    &format!("{path}.values[{r}]"),
                    "System.Collections.Generic.IReadOnlyList",
                )),
            })
            .collect::<Result<Vec<_>>>()?,
    };
    Ok(CloneKeyframes {
        scope: text_field(item, "scope", path)?.unwrap_or_default(),
        prop: text_field(item, "prop", path)?.unwrap_or_default(),
        values: rows,
        particle: text_field(item, "particle", path)?,
    })
}

fn clone_tune(item: &Value, path: &str) -> Result<CloneTune> {
    let aim = match field(item, "aim") {
        None => None,
        Some(aim @ Value::Object(_)) => {
            let at = format!("{path}.aim");
            Some(CloneAim {
                yaw: decimal_field(aim, "yaw", &at)?.unwrap_or(0.0),
                pitch: decimal_field(aim, "pitch", &at)?.unwrap_or(0.0),
            })
        }
        Some(_) => return Err(wrong(&format!("{path}.aim"), "Modovik.RpfHelper.YptCloneAim")),
    };
    Ok(CloneTune {
        colour: numbers_field(item, "colour", path)?,
        colour_mode: text_field(item, "colourMode", path)?,
        colour2: numbers_field(item, "colour2", path)?,
        part_colours: objects_of(item, "partColours", path, |part, at| {
            Ok(ClonePartColour {
                particle: text_field(part, "particle", at)?.unwrap_or_default(),
                colour: numbers_field(part, "colour", at)?.unwrap_or_default(),
            })
        })?,
        alpha_scale: decimal_field(item, "alphaScale", path)?,
        zoom_scale: decimal_field(item, "zoomScale", path)?,
        spawn_scale: decimal_field(item, "spawnScale", path)?,
        max_duration: decimal_field(item, "maxDuration", path)?,
        cull_fade: decimal_field(item, "cullFade", path)?,
        cull_dist: decimal_field(item, "cullDist", path)?,
        one_shot: flag_field(item, "oneShot", path)?,
        aim,
        keyframes: objects_of(item, "keyframes", path, clone_keyframes)?,
        scales: objects_of(item, "scales", path, |scale, at| {
            Ok(CloneScale {
                prop: text_field(scale, "prop", at)?.unwrap_or_default(),
                factor: decimal_field(scale, "factor", at)?.unwrap_or(0.0),
            })
        })?,
        effect_zoom: decimal_field(item, "effectZoom", path)?,
        emissive_scale: decimal_field(item, "emissiveScale", path)?,
        open_air: flag_field(item, "openAir", path)?,
    })
}

fn tune_of(item: &Value, path: &str) -> Result<Option<CloneTune>> {
    match field(item, "tune") {
        None => Ok(None),
        Some(tune @ Value::Object(_)) => clone_tune(tune, &format!("{path}.tune")).map(Some),
        Some(_) => Err(wrong(&format!("{path}.tune"), "Modovik.RpfHelper.YptCloneTune")),
    }
}

fn clone_layer(item: &Value, path: &str) -> Result<CloneLayer> {
    Ok(CloneLayer {
        donor_effect: text_field(item, "donorEffect", path)?.unwrap_or_default(),
        keep_particles: strings_field(item, "keepParticles", path)?,
        textures: objects_of(item, "textures", path, clone_texture)?,
        tune: tune_of(item, path)?,
        donor_file: text_field(item, "donorFile", path)?,
    })
}

fn clone_lod(item: &Value, path: &str) -> Result<CloneLod> {
    Ok(CloneLod {
        near: decimal_field(item, "near", path)?,
        far: decimal_field(item, "far", path)?,
        reach: decimal_field(item, "reach", path)?,
        distance_min: decimal_field(item, "distanceMin", path)?,
        distance_max: decimal_field(item, "distanceMax", path)?,
    })
}

fn effect_clone(item: &Value, path: &str) -> Result<EffectClone> {
    let lod = match field(item, "lod") {
        None => None,
        Some(lod @ Value::Object(_)) => Some(clone_lod(lod, &format!("{path}.lod"))?),
        Some(_) => return Err(wrong(&format!("{path}.lod"), "Modovik.RpfHelper.YptCloneLod")),
    };
    Ok(EffectClone {
        effect: text_field(item, "effect", path)?.unwrap_or_default(),
        donor_effect: text_field(item, "donorEffect", path)?,
        keep_particles: strings_field(item, "keepParticles", path)?,
        textures: objects_of(item, "textures", path, clone_texture)?,
        tune: tune_of(item, path)?,
        layers: objects_of(item, "layers", path, clone_layer)?,
        lod,
        replaces: text_field(item, "replaces", path)?,
        texture_prefix: text_field(item, "texturePrefix", path)?,
    })
}

/// Клоны из тела запроса помощника (`effectClones`).
pub(super) fn parse_clones(document: &Value) -> Result<Vec<EffectClone>> {
    Ok(objects_of(document, "effectClones", "$", effect_clone)?.unwrap_or_default())
}

/// Имена прежних клонов для сброса (`effectCloneReset`).
pub(super) fn parse_reset(document: &Value) -> Result<Vec<String>> {
    Ok(strings_field(document, "effectCloneReset", "$")?.unwrap_or_default())
}

/// Запрос выгрузки клонов: общие поля и части, нужные клонам.
struct Request {
    input: Option<String>,
    clones: Vec<EffectClone>,
    reset: Vec<String>,
    textures: Vec<TextureDraft>,
}

impl Request {
    fn parse(document: &Value) -> Result<Request> {
        let textures = objects_of(document, "texturePatches", "$", texture_draft)?.unwrap_or_default();
        Ok(Request {
            input: text_field(document, "inputFile", "$")?,
            clones: parse_clones(document)?,
            reset: parse_reset(document)?,
            textures,
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Файлы, доноры, листы
// ---------------------------------------------------------------------------------------------

fn load(path: &std::path::Path) -> Result<Structure> {
    Structure::parse(&read_core(path)?).map_err(lift)
}

/// Все листы подмены заказа: у самого клона и у слоёв.
pub(super) fn swap_textures(clone_list: &[EffectClone]) -> Vec<String> {
    clone_list
        .iter()
        .flat_map(|item| {
            let own = item.textures.iter().flatten();
            let layered = item.layers.iter().flatten().flat_map(|layer| layer.textures.iter().flatten());
            own.chain(layered).map(|swap| swap.texture.clone()).collect::<Vec<_>>()
        })
        .collect()
}

/// Чужие словари доноров: каждый файл читается один раз, сколько бы слоёв на него ни ссылалось.
pub(super) fn read_donors(clone_list: &[EffectClone]) -> Result<Donors> {
    let mut donors = Donors::new();
    for item in clone_list {
        for layer in item.layers.iter().flatten() {
            let Some(file) = layer.donor_file.as_deref().filter(|text| !text.trim().is_empty()) else {
                continue;
            };
            let key = file.to_lowercase();
            if donors.contains_key(&key) {
                continue;
            }
            donors.insert(key, load(&helper_file(Some(file), ".ypt")?)?);
        }
    }
    Ok(donors)
}

// ---------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------

/// Отчёт об одном клоне в форме ответа помощника.
pub(super) fn cloned_json(item: &Cloned) -> Value {
    let imported = item
        .imported_textures
        .iter()
        .map(|(texture, source)| {
            object([
                ("texture", Value::from(texture.as_str())),
                ("source", Value::from(source.as_str())),
            ])
        })
        .collect();
    object([
        ("effect", Value::from(item.effect.as_str())),
        ("donorEffect", Value::from(item.donor_effect.as_str())),
        ("emitters", Value::from(item.emitters)),
        ("droppedEmitters", Value::from(item.dropped_emitters)),
        ("emitterRules", strings(&item.emitter_rules)),
        ("particleRules", strings(&item.particle_rules)),
        ("textures", strings(&item.textures)),
        ("recolouredKeyframes", Value::from(item.recoloured_keyframes)),
        ("spawnKeyframes", Value::from(item.spawn_keyframes)),
        ("replacedProps", Value::from(item.replaced_props)),
        ("scaledKeyframes", Value::from(item.scaled_keyframes)),
        ("layers", Value::from(item.layers)),
        ("donors", strings(&item.donors)),
        ("lodKeyframes", Value::from(item.lod_keyframes)),
        ("importedTextures", Value::Array(imported)),
        (
            "replaced",
            item.replaced.as_deref().map_or(Value::Null, Value::from),
        ),
    ])
}

/// Выгрузка правил в форме `ypt-rule-export`: поля `Export` как есть, в порядке ключей.
fn export_json(structure: &Structure, names: &[String]) -> Result<Value> {
    let resource = structure.to_resource();
    let dump = export::rules(&resource, names).map_err(lift)?;
    Ok(object([
        ("effects", Value::Object(dump.effects)),
        ("emitters", Value::Object(dump.emitters)),
        ("particles", Value::Object(dump.particles)),
        ("textures", Value::from(dump.textures)),
        ("drawables", Value::from(dump.drawables)),
        ("meshes", Value::Object(dump.meshes)),
        ("missing", Value::from(dump.missing)),
    ]))
}

// ---------------------------------------------------------------------------------------------
// ypt-clone-export
// ---------------------------------------------------------------------------------------------

/// Общий разбор запроса из файла.
fn read_request(options: &Options) -> Result<Request> {
    let request_path = paths::existing_file(options.required("request")?, &[".json"])?;
    let text = fs::read_to_string(&request_path)?;
    let document: Value = serde_json::from_str(&text).map_err(|error| {
        EngineError::invalid_data(format!("The request is not valid JSON: {error}"))
    })?;
    Request::parse(&document)
}

fn distinct_ignore_case(names: impl Iterator<Item = String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for name in names.filter(|name| !name.is_empty()) {
        if !kept.iter().any(|known| known.eq_ignore_ascii_case(&name)) {
            kept.push(name);
        }
    }
    kept
}

fn run_export(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = read_request(options)?;
    let input = helper_file(request.input.as_deref(), ".ypt")?;
    if request.clones.is_empty() {
        return Err(EngineError::invalid_data(
            "YPT clone export needs at least one effect clone.",
        ));
    }
    let mut structure = load(&input)?;
    // В ядре игрока могут жить клоны и листы прошлой установки под теми же именами: здесь они снимаются поимённо.
    let swaps = swap_textures(&request.clones);
    let prefixes = distinct_ignore_case(
        request
            .reset
            .iter()
            .cloned()
            .chain(request.clones.iter().map(|item| item.effect.clone()))
            .chain(swaps.iter().cloned()),
    );
    let mut restored = BTreeSet::new();
    clones::purge(&mut structure, &prefixes, &mut restored).map_err(lift)?;
    let donors = read_donors(&request.clones)?;
    let payloads = read_payloads(swaps.iter().cloned(), &request.textures, |name| name.to_lowercase())?;
    let cloned = clones::apply_for_export(&mut structure, &request.clones, &payloads, &donors).map_err(lift)?;
    let names: Vec<String> = cloned.iter().map(|item| item.effect.clone()).collect();
    let exported = export_json(&structure, &names)?;
    let input_sha = sha256_hex(&fs::read(&input)?);
    Ok(object([
        ("status", Value::from("ready")),
        ("mode", Value::from("ypt-clone-export")),
        ("input", Value::from(input.display().to_string())),
        ("inputSha256", Value::from(input_sha)),
        ("cloned", Value::Array(cloned.iter().map(cloned_json).collect())),
        ("export", exported),
    ]))
}

// ---------------------------------------------------------------------------------------------
// Проверка клонов после записи
// ---------------------------------------------------------------------------------------------

/// Клоны после сохранения: свой набор правил под своими именами, верные счётчики ссылок и заказанные листы.
pub(super) fn verify_clones(reloaded: &Structure, cloned: &[Cloned]) -> Result<()> {
    let broken = |text: String| EngineError::invalid_data(text);
    for report in cloned {
        let effect = reloaded
            .find_exact(RuleKind::Effect, &report.effect)
            .map_err(lift)?
            .ok_or_else(|| broken(format!("YPT clone effect rule is missing: {}", report.effect)))?;
        let events = reloaded.events(effect).map_err(lift)?;
        if events.len() != report.emitters {
            return Err(broken(format!("YPT clone did not keep its emitters: {}", report.effect)));
        }
        for &event in &events {
            let emitter = reloaded.pointer(event + ypt::structure::EVENT_EMITTER);
            let particle = reloaded.pointer(event + ypt::structure::EVENT_PARTICLE);
            let (emitter_name, particle_name) = (
                emitter.and_then(|at| reloaded.name_of(RuleKind::Emitter, at)),
                particle.and_then(|at| reloaded.name_of(RuleKind::Particle, at)),
            );
            let (Some(emitter_name), Some(particle_name)) = (emitter_name, particle_name) else {
                return Err(broken(format!(
                    "YPT clone emitter does not point at its own rules: {}",
                    report.effect
                )));
            };
            let own = report.emitter_rules.contains(&emitter_name) && report.particle_rules.contains(&particle_name);
            let named = reloaded.name(event + ypt::structure::EVENT_EMITTER_NAME).as_deref() == Some(emitter_name.as_str())
                && reloaded.name(event + ypt::structure::EVENT_PARTICLE_NAME).as_deref()
                    == Some(particle_name.as_str());
            if !own || !named {
                return Err(broken(format!(
                    "YPT clone emitter does not point at its own rules: {}",
                    report.effect
                )));
            }
            let (emitter, particle) = (emitter.unwrap_or_default(), particle.unwrap_or_default());
            let emitter_users = events
                .iter()
                .filter(|&&other| reloaded.pointer(other + ypt::structure::EVENT_EMITTER) == Some(emitter))
                .count();
            let particle_users = events
                .iter()
                .filter(|&&other| reloaded.pointer(other + ypt::structure::EVENT_PARTICLE) == Some(particle))
                .count();
            let counts = (
                reloaded.u32(emitter + ypt::clone_kit::REF_COUNT).map_err(lift)? as usize,
                reloaded.u32(particle + ypt::clone_kit::REF_COUNT).map_err(lift)? as usize,
            );
            if counts != (1 + emitter_users, 1 + particle_users) {
                return Err(broken(format!(
                    "YPT clone reference counts are inconsistent: {}",
                    report.effect
                )));
            }
        }
        for name in &report.textures {
            let texture = reloaded
                .find(RuleKind::Texture, name)
                .map_err(lift)?
                .ok_or_else(|| broken(format!("YPT clone texture is missing: {name}")))?;
            let mut drawn = false;
            for &event in &events {
                let Some(particle) = reloaded.pointer(event + ypt::structure::EVENT_PARTICLE) else {
                    continue;
                };
                let list = reloaded.list(particle + ypt::structure::PARTICLE_VARS).map_err(lift)?;
                for variable in reloaded.objects(list) {
                    let kind = reloaded.u8(variable + ypt::structure::VAR_KIND).map_err(lift)?;
                    if kind == ypt::structure::VAR_KIND_TEXTURE
                        && reloaded.pointer(variable + ypt::structure::VAR_TEXTURE) == Some(texture)
                    {
                        drawn = true;
                    }
                }
            }
            if !drawn {
                return Err(broken(format!(
                    "YPT clone does not draw its texture: {}/{name}",
                    report.effect
                )));
            }
        }
    }
    Ok(())
}

const YPT_CLONE_EXPORT: Command = Command::new(EXPORT_NAME, run_export);

pub const COMMANDS: &[Command] = &[YPT_CLONE_EXPORT];

#[cfg(test)]
mod tests;
