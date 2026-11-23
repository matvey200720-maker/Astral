//! Клоны правил эффектов `core.ypt`: режим `ypt-texture-patch` помощника с `effectClones` и `effectCloneReset`.
//!
//! Клон — копия любого штатного правила ядра целиком, со всеми его эмиттерами; поведение приходит от донора, а клон
//! настраивается (цвет, размер, густота, дальность, кадры, текстуры, слои из разных доноров, донор из чужого файла).
//! Порядок шагов, числа и отказы — как у помощника; работа идёт над образом структуры (`ypt::structure`): копия
//! донора — его же блоки под новыми именами, словари остаются упорядоченными по хешу имени.

use std::collections::{BTreeSet, HashMap};

use super::clone_kit as kit;
use super::effect_clones_tune::{self as tune_mod, Layer};
use super::image::{EFFECT_NAME, EMITTER_NAME, PARTICLE_NAME, TEXTURE_NAME};
use super::names::hash_name;
use super::structure::{
    Kind, Structure, TextureSpec, DRAWABLE_MODEL, DRAWABLE_STRIDE, EVENT_EMITTER, EVENT_EMITTER_NAME,
    EVENT_PARTICLE, EVENT_PARTICLE_NAME, PARTICLE_DRAWABLES, PARTICLE_SPAWNERS, PARTICLE_VARS,
    SPAWNER_EFFECT, VAR_KIND, VAR_KIND_TEXTURE, VAR_TEXTURE, VAR_TEXTURE_HASH, VAR_TEXTURE_NAME,
};
use crate::dds;
use crate::error::{Error, Result};
use crate::resource_graph::Address;
use crate::resource_graph::Segment;

pub const MAX_CLONES: usize = 16;
pub const MAX_LAYERS: usize = 8;
const MAX_EVOLUTIONS: usize = 5;
const MAX_EVENT_EMITTERS: usize = super::MAX_EVENT_EMITTERS;
const LOD_EVOLUTION: &str = "LOD";
const DRIVEN_EVOLUTIONS: [&str; 3] = ["LOD", "angle", "size"];
const IMPORTED_TEXTURE_PREFIX: &str = "astral_impact_tex_";
const STOCK_PREFIX: &str = "astral_wheel_stock_";
const SWAPPABLE_EFFECTS: [&str; 1] = ["veh_slipstream"];
/// Дальность LOD штатной крови: 5…40 м.
const BLOOD_LOD_MIN: f32 = 5.0;
const BLOOD_LOD_MAX: f32 = 40.0;
const DIFFUSE_VARIABLE: &str = "diffusetex2";
const SIZE_SCALAR: &str = "ptxEmitterRule:m_sizeScalarKFP";
const ZOOM_SCALAR: &str = "ptxEffectRule:m_zoomScalarKFP";

// ---------------------------------------------------------------------------------------------
// Заказ
// ---------------------------------------------------------------------------------------------

/// Подмена diffuse-текстуры у частиц клона.
#[derive(Debug, Clone, Default)]
pub struct CloneTexture {
    pub texture: String,
    pub particles: Option<Vec<String>>,
    pub donor_texture: Option<String>,
    pub frame_min: Option<i32>,
    pub frame_max: Option<i32>,
    pub last_frame: Option<i32>,
    pub loop_mode: Option<i32>,
    pub scaled_over_life: Option<bool>,
    pub randomised: Option<bool>,
}

/// Замена кадров одного свойства: `[время, x, y, z, w]`.
#[derive(Debug, Clone, Default)]
pub struct CloneKeyframes {
    pub scope: String,
    pub prop: String,
    pub values: Vec<Vec<f64>>,
    pub particle: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CloneScale {
    pub prop: String,
    pub factor: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CloneAim {
    pub yaw: f64,
    pub pitch: f64,
}

#[derive(Debug, Clone, Default)]
pub struct ClonePartColour {
    pub particle: String,
    pub colour: Vec<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct CloneTune {
    pub colour: Option<Vec<f64>>,
    pub colour_mode: Option<String>,
    pub colour2: Option<Vec<f64>>,
    pub part_colours: Option<Vec<ClonePartColour>>,
    pub alpha_scale: Option<f64>,
    pub zoom_scale: Option<f64>,
    pub spawn_scale: Option<f64>,
    pub max_duration: Option<f64>,
    pub cull_fade: Option<f64>,
    pub cull_dist: Option<f64>,
    pub one_shot: Option<bool>,
    pub aim: Option<CloneAim>,
    pub keyframes: Option<Vec<CloneKeyframes>>,
    pub scales: Option<Vec<CloneScale>>,
    pub effect_zoom: Option<f64>,
    pub emissive_scale: Option<f64>,
    pub open_air: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct CloneLayer {
    pub donor_effect: String,
    pub keep_particles: Option<Vec<String>>,
    pub textures: Option<Vec<CloneTexture>>,
    pub tune: Option<CloneTune>,
    pub donor_file: Option<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CloneLod {
    pub near: Option<f64>,
    pub far: Option<f64>,
    pub reach: Option<f64>,
    pub distance_min: Option<f64>,
    pub distance_max: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct EffectClone {
    pub effect: String,
    pub donor_effect: Option<String>,
    pub keep_particles: Option<Vec<String>>,
    pub textures: Option<Vec<CloneTexture>>,
    pub tune: Option<CloneTune>,
    pub layers: Option<Vec<CloneLayer>>,
    pub lod: Option<CloneLod>,
    pub replaces: Option<String>,
    pub texture_prefix: Option<String>,
}

/// Итог по одному клону (`YptClonedEffect`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Cloned {
    pub effect: String,
    pub donor_effect: String,
    pub emitters: usize,
    pub dropped_emitters: usize,
    pub emitter_rules: Vec<String>,
    pub particle_rules: Vec<String>,
    pub textures: Vec<String>,
    pub recoloured_keyframes: usize,
    pub spawn_keyframes: usize,
    pub replaced_props: usize,
    pub scaled_keyframes: usize,
    pub layers: usize,
    pub donors: Vec<String>,
    pub lod_keyframes: usize,
    /// (текстура в ядре, имя исходного листа)
    pub imported_textures: Vec<(String, String)>,
    pub replaced: Option<String>,
}

/// DDS по имени текстуры (строчными буквами).
pub type Payloads = HashMap<String, Vec<u8>>;
/// Образы чужих словарей по пути файла (строчными буквами).
pub type Donors = HashMap<String, Structure>;

// ---------------------------------------------------------------------------------------------
// Имена
// ---------------------------------------------------------------------------------------------

fn within(text: &str, low: usize, high: usize, allowed: &dyn Fn(char) -> bool) -> bool {
    let count = text.chars().count();
    (low..=high).contains(&count) && text.chars().all(allowed)
}

fn lower_word(character: char) -> bool {
    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
}

/// `^astral_[a-z0-9_]{1,48}$`
pub fn clone_name(text: &str) -> bool {
    text.strip_prefix("astral_")
        .is_some_and(|tail| within(tail, 1, 48, &lower_word))
}

/// `^[A-Za-z0-9_]{1,64}$`
pub fn donor_name(text: &str) -> bool {
    within(text, 1, 64, &|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `^astral_[a-z0-9_]{1,32}_$`
pub fn texture_prefix_name(text: &str) -> bool {
    text.strip_prefix("astral_")
        .and_then(|tail| tail.strip_suffix('_'))
        .is_some_and(|middle| within(middle, 1, 32, &lower_word))
}

fn property_tail(text: &str, head: &str) -> bool {
    text.strip_prefix(head)
        .is_some_and(|tail| tail.chars().all(|c| c.is_ascii_alphabetic()) && (1..=48).contains(&tail.chars().count()))
}

/// `^ptx[A-Za-z_]{1,40}:m_[A-Za-z]{1,48}$`
pub fn prop_name(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("ptx") else {
        return false;
    };
    let Some((owner, field)) = rest.split_once(":m_") else {
        return false;
    };
    within(owner, 1, 40, &|c| c.is_ascii_alphabetic() || c == '_') && within(field, 1, 48, &|c| c.is_ascii_alphabetic())
}

/// `^ptx(EmitterRule|CreationDomain|TargetDomain|AttractorDomain):m_[A-Za-z]{1,48}$`
pub fn scale_prop_name(text: &str) -> bool {
    ["EmitterRule", "CreationDomain", "TargetDomain", "AttractorDomain"]
        .iter()
        .any(|owner| property_tail(text, &format!("ptx{owner}:m_")))
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.as_bytes()
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix.as_bytes()))
}

fn same_ignore_case(a: &str, b: &str) -> bool {
    super::cmp_ordinal_ignore_case(a, b) == std::cmp::Ordering::Equal
}

/// Имя импортированного листа: `astral_impact_tex_<имя без ptfx_>`.
pub fn imported_texture_name(original: &str, prefix: Option<&str>) -> Result<String> {
    let trimmed = original.trim().to_lowercase();
    let name = trimmed.strip_prefix("ptfx_").unwrap_or(&trimmed);
    let clean: String = name
        .chars()
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' { c } else { '_' })
        .collect();
    let prefix = prefix.unwrap_or(IMPORTED_TEXTURE_PREFIX);
    if !texture_prefix_name(prefix) {
        return Err(Error::broken(format!(
            "YPT imported texture prefix must live in the astral_ namespace: {prefix}"
        )));
    }
    let imported = format!("{prefix}{clean}");
    if !clone_name(&imported) {
        return Err(Error::broken(format!(
            "YPT donor texture name cannot be imported: {original}"
        )));
    }
    Ok(imported)
}

fn broken(text: String) -> Error {
    Error::broken(text)
}

fn effect_named(s: &Structure, name: &str) -> Result<Option<usize>> {
    s.find_exact(Kind::Effect, name)
}

// ---------------------------------------------------------------------------------------------
// Сброс прежних клонов
// ---------------------------------------------------------------------------------------------

/// Записи словарей под приставками имён — в виде ключей описи («вид:имя»). `restored` получает ключи штатных
/// правил, которые вернулись под своё имя.
pub fn purge(
    s: &mut Structure,
    prefixes: &[String],
    restored: &mut BTreeSet<String>,
) -> Result<BTreeSet<String>> {
    let mut removed = BTreeSet::new();
    if prefixes.is_empty() {
        return Ok(removed);
    }
    for prefix in prefixes {
        if !clone_name(prefix) {
            return Err(broken(format!(
                "YPT clone reset prefix must live in the astral_ namespace: {prefix}"
            )));
        }
    }
    s.assert_dictionaries()?;
    let matches = |name: &str| !name.is_empty() && prefixes.iter().any(|prefix| starts_with_ignore_case(name, prefix));

    // Штатное правило, уступившее имя клону, возвращается первым.
    unswap(s, &matches, &mut removed, restored)?;

    for kind in [Kind::Effect, Kind::Emitter, Kind::Particle] {
        for name in s.remove_entries(kind, &matches)? {
            removed.insert(format!("{}:{name}", kind.label()));
        }
    }
    let gone: Vec<String> = s.remove_entries(Kind::Texture, &matches)?;
    for name in &gone {
        removed.insert(format!("texture:{name}"));
    }

    // Штатное правило не имеет права ссылаться на удалённое.
    if !gone.is_empty() {
        for entry in s.entries(Kind::Particle)? {
            let Some(particle) = entry.object else { continue };
            for variable in s.objects(s.list(particle + PARTICLE_VARS)?) {
                if s.u8(variable + VAR_KIND)? != VAR_KIND_TEXTURE {
                    continue;
                }
                let name = s
                    .pointer(variable + VAR_TEXTURE)
                    .and_then(|texture| s.name(texture + TEXTURE_NAME));
                if let Some(name) = name {
                    if gone.iter().any(|candidate| same_ignore_case(candidate, &name)) {
                        return Err(broken(format!(
                            "YPT particle rule {} still draws a purged texture: {name}",
                            s.name(particle + PARTICLE_NAME).unwrap_or_default()
                        )));
                    }
                }
            }
        }
    }
    Ok(removed)
}

/// Обратное `swap_in`: скрытое штатное правило под выбранными приставками возвращается под своё имя, клон под этим
/// именем уходит.
fn unswap(
    s: &mut Structure,
    matches: &dyn Fn(&str) -> bool,
    removed: &mut BTreeSet<String>,
    restored: &mut BTreeSet<String>,
) -> Result<()> {
    let mut hidden: Vec<(usize, String)> = Vec::new();
    for entry in s.entries(Kind::Effect)? {
        let Some(object) = entry.object else { continue };
        if let Some(name) = s.name(object + EFFECT_NAME) {
            if starts_with_ignore_case(&name, STOCK_PREFIX) && matches(&name) {
                hidden.push((object, name));
            }
        }
    }
    for (rule, hidden_name) in hidden {
        let stock_name = hidden_name[STOCK_PREFIX.len()..].to_owned();
        if !SWAPPABLE_EFFECTS.contains(&stock_name.as_str()) {
            return Err(broken(format!(
                "YPT core holds an unknown stock copy: {hidden_name}"
            )));
        }
        let custom = effect_named(s, &stock_name)?;
        let mut gone: Vec<usize> = vec![rule];
        if let Some(custom) = custom {
            for event in s.events(custom)? {
                let emitter = s.pointer(event + EVENT_EMITTER).and_then(|at| s.name(at + EMITTER_NAME));
                let particle = s.pointer(event + EVENT_PARTICLE).and_then(|at| s.name(at + PARTICLE_NAME));
                let named = |name: &Option<String>| name.as_deref().is_some_and(matches);
                if !named(&emitter) || !named(&particle) {
                    return Err(broken(format!(
                        "YPT effect rule {stock_name} cannot be restored: its clone lives outside the reset prefixes."
                    )));
                }
            }
            gone.push(custom);
            removed.insert(format!("effect:{stock_name}"));
        }
        remove_effects(s, &gone)?;
        removed.insert(format!("effect:{hidden_name}"));
        s.set_name(rule + EFFECT_NAME, &stock_name)?;
        s.insert_entry(Kind::Effect, rule, hash_name(&stock_name))?;
        restored.insert(format!("effect:{stock_name}"));
    }
    Ok(())
}

/// Снимает из словаря правил эффектов пары «хеш — правило» для названных объектов.
fn remove_effects(s: &mut Structure, rules: &[usize]) -> Result<()> {
    let list = s.entries(Kind::Effect)?;
    let kept: Vec<_> = list
        .into_iter()
        .filter(|entry| entry.object.is_none_or(|object| !rules.contains(&object)))
        .collect();
    s.write_entries(Kind::Effect, &kept)
}

/// Клон встаёт под штатным именем правила, штатное уходит под скрытое `astral_wheel_stock_<имя>`.
fn swap_in(s: &mut Structure, mut report: Cloned, stock_name: &str) -> Result<Cloned> {
    let hidden = format!("{STOCK_PREFIX}{stock_name}");
    let stock = effect_named(s, stock_name)?
        .ok_or_else(|| broken(format!("YPT core has no effect rule to replace: {stock_name}")))?;
    let custom = effect_named(s, &report.effect)?
        .ok_or_else(|| broken(format!("YPT clone effect rule is missing: {}", report.effect)))?;
    if effect_named(s, &hidden)?.is_some() {
        return Err(broken(format!(
            "YPT core already holds the stock copy of {stock_name}."
        )));
    }
    // Хеш словаря у штатного правила обязан быть от его имени: чужую запись Astral подменять не берётся.
    let entries = s.entries(Kind::Effect)?;
    let hash = entries
        .iter()
        .find(|entry| entry.object == Some(stock))
        .map(|entry| entry.hash);
    if hash != Some(hash_name(stock_name)) {
        return Err(broken(format!(
            "YPT effect rule {stock_name} carries a foreign name hash."
        )));
    }
    remove_effects(s, &[stock, custom])?;
    s.set_name(stock + EFFECT_NAME, &hidden)?;
    s.set_name(custom + EFFECT_NAME, stock_name)?;
    s.insert_entry(Kind::Effect, stock, hash_name(&hidden))?;
    s.insert_entry(Kind::Effect, custom, hash_name(stock_name))?;
    report.replaced = Some(hidden);
    report.effect = stock_name.to_owned();
    Ok(report)
}

/// Ключи описи, которые обязаны появиться в ядре после клонов.
pub fn expected_keys(cloned: &[Cloned], restored: &BTreeSet<String>) -> BTreeSet<String> {
    let mut keys: BTreeSet<String> = restored.clone();
    for item in cloned {
        keys.insert(format!("effect:{}", item.effect));
        if let Some(hidden) = &item.replaced {
            keys.insert(format!("effect:{hidden}"));
        }
        keys.extend(item.emitter_rules.iter().map(|name| format!("emitter:{name}")));
        keys.extend(item.particle_rules.iter().map(|name| format!("particle:{name}")));
        keys.extend(item.textures.iter().map(|name| format!("texture:{name}")));
    }
    keys
}

// ---------------------------------------------------------------------------------------------
// Применение
// ---------------------------------------------------------------------------------------------

struct Pieces<'a> {
    effect: &'a EffectClone,
    layers: Vec<CloneLayer>,
}

/// Слои заказа: названные или единственный из полей самого заказа.
fn layers_of(clone: &EffectClone) -> Result<Vec<CloneLayer>> {
    if let Some(layers) = clone.layers.as_ref().filter(|layers| !layers.is_empty()) {
        if clone.donor_effect.is_some() || clone.keep_particles.is_some() || clone.textures.is_some() {
            return Err(broken(format!(
                "YPT clone {} names both layers and a single donor.",
                clone.effect
            )));
        }
        return Ok(layers.clone());
    }
    let donor = clone
        .donor_effect
        .as_deref()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| broken(format!("YPT clone {} names no donor effect rule.", clone.effect)))?;
    Ok(vec![CloneLayer {
        donor_effect: donor.to_owned(),
        keep_particles: clone.keep_particles.clone(),
        textures: clone.textures.clone(),
        tune: clone.tune.clone(),
        donor_file: None,
    }])
}

/// Чужой словарь по пути (без учёта регистра).
fn donor_key(file: &str) -> String {
    file.to_lowercase()
}

/// Клоны для записи файла: лист нового клона обязан пережить запись и перечитывание так, как это судит помощник
/// (`slot_reservations::check_new_sheet`).
pub fn apply(
    s: &mut Structure,
    clones: &[EffectClone],
    payloads: &Payloads,
    donors: &Donors,
) -> Result<Vec<Cloned>> {
    apply_to(s, clones, payloads, donors, true)
}

/// Клоны для выгрузки правил (`ypt-clone-export`): файл не пишется и не перечитывается, поэтому годен любой DDS, который
/// разобран (помощник в этом режиме отвечает и на «по блокам», и на длину помощника).
pub fn apply_for_export(
    s: &mut Structure,
    clones: &[EffectClone],
    payloads: &Payloads,
    donors: &Donors,
) -> Result<Vec<Cloned>> {
    apply_to(s, clones, payloads, donors, false)
}

fn apply_to(
    s: &mut Structure,
    clones: &[EffectClone],
    payloads: &Payloads,
    donors: &Donors,
    written: bool,
) -> Result<Vec<Cloned>> {
    if clones.is_empty() || clones.len() > MAX_CLONES {
        return Err(broken(format!(
            "YPT effect clone count must be between 1 and {MAX_CLONES}."
        )));
    }
    s.assert_dictionaries()?;
    let mut names: Vec<String> = Vec::new();
    let mut pieces: Vec<Pieces> = Vec::new();
    let taken = |names: &Vec<String>, name: &str| names.iter().any(|known| same_ignore_case(known, name));
    for clone in clones {
        if !clone_name(&clone.effect) {
            return Err(broken(format!(
                "YPT clone names must live in the astral_ namespace: {}",
                clone.effect
            )));
        }
        let layers = layers_of(clone)?;
        if layers.len() > MAX_LAYERS {
            return Err(broken(format!(
                "YPT clone {} has more than {MAX_LAYERS} layers.",
                clone.effect
            )));
        }
        for layer in &layers {
            if !donor_name(&layer.donor_effect) {
                return Err(broken(format!(
                    "YPT clone donor name is invalid: {}",
                    clone.effect
                )));
            }
            if let Some(file) = &layer.donor_file {
                if !donors.contains_key(&donor_key(file)) {
                    return Err(broken(format!(
                        "YPT clone donor file is not loaded: {file}"
                    )));
                }
            }
        }
        if taken(&names, &clone.effect) {
            return Err(broken(format!(
                "YPT effect is cloned twice: {}",
                clone.effect
            )));
        }
        names.push(clone.effect.clone());
        if let Some(replaces) = &clone.replaces {
            if !SWAPPABLE_EFFECTS.contains(&replaces.as_str()) {
                return Err(broken(format!(
                    "YPT effect rule cannot be replaced in place: {replaces}"
                )));
            }
            if taken(&names, replaces) {
                return Err(broken(format!(
                    "YPT effect is replaced twice: {replaces}"
                )));
            }
            names.push(replaces.clone());
        }
        pieces.push(Pieces { effect: clone, layers });
    }
    // Листы, общие для нескольких клонов, создаются один раз.
    let mut created: HashMap<String, usize> = HashMap::new();
    let mut reports = Vec::with_capacity(pieces.len());
    for piece in &pieces {
        let report = clone_one(s, donors, piece, payloads, &mut created, written)?;
        reports.push(match &piece.effect.replaces {
            Some(stock) => swap_in(s, report, stock)?,
            None => report,
        });
    }
    Ok(reports)
}

/// Одна запись о событии донора: что нужно знать о нём до копирования.
struct DonorParticle {
    name: Option<String>,
    spawned: Option<String>,
    has_model: bool,
    /// Переменные-листы: (номер в списке, хеш имени, лист, текст имени листа, имя листа в его описании).
    variables: Vec<DonorVariable>,
}

struct DonorVariable {
    index: usize,
    name_hash: u32,
    texture: Option<usize>,
    name_text: Option<String>,
    texture_name: Option<String>,
}

fn donor_particle(source: &Structure, particle: usize) -> Result<DonorParticle> {
    let spawned = PARTICLE_SPAWNERS
        .iter()
        .map(|&at| source.pointer(particle + at + SPAWNER_EFFECT))
        .find(Option::is_some)
        .flatten()
        .map(|effect| source.name(effect + EFFECT_NAME).unwrap_or_default());
    let drawables = source.list(particle + PARTICLE_DRAWABLES)?;
    let has_model = drawables.array.is_some_and(|array| {
        (0..drawables.count).any(|k| source.pointer(array + k * DRAWABLE_STRIDE + DRAWABLE_MODEL).is_some())
    });
    let mut variables = Vec::new();
    let list = source.list(particle + PARTICLE_VARS)?;
    for (index, variable) in source.list_slots(list).into_iter().enumerate() {
        let Some(variable) = variable else { continue };
        if source.u8(variable + VAR_KIND)? != VAR_KIND_TEXTURE {
            continue;
        }
        let texture = source.pointer(variable + VAR_TEXTURE);
        variables.push(DonorVariable {
            index,
            name_hash: source.u32(variable + 0x10)?,
            texture,
            name_text: source.name(variable + VAR_TEXTURE_NAME),
            texture_name: texture.and_then(|texture| source.name(texture + TEXTURE_NAME)),
        });
    }
    Ok(DonorParticle {
        name: source.name(particle + PARTICLE_NAME),
        spawned,
        has_model,
        variables,
    })
}

/// Собранный слой: копия правила донора со своими эмиттерами и частицами.
struct LayerBuild {
    copy: usize,
    kept: Vec<usize>,
    emitters: Vec<usize>,
    particles: Vec<usize>,
    emitter_names: Vec<String>,
    particle_names: Vec<String>,
    texture_names: Vec<String>,
    imported: Vec<(String, String)>,
    report: tune_mod::TuneReport,
    donor_events: usize,
    donor: String,
}

fn find_swap<'a>(
    swaps: &'a [CloneTexture],
    donor_particle: Option<&str>,
    donor_texture: Option<&str>,
) -> Option<&'a CloneTexture> {
    swaps.iter().find(|swap| {
        let by_particle = swap.particles.as_ref().is_some_and(|particles| {
            !particles.is_empty() && donor_particle.is_some_and(|name| particles.iter().any(|item| item == name))
        });
        let by_texture = swap
            .donor_texture
            .as_deref()
            .is_some_and(|name| !name.is_empty() && donor_texture.is_some_and(|text| same_ignore_case(name, text)));
        by_particle || by_texture
    })
}

/// Шаг строки листа в описании: байт на строку пикселей (у DXT5 — ширина, у DXT1 — половина ширины).
fn stride_of(dds: &dds::Dds) -> u16 {
    u16::try_from(dds.format.helper_level_bytes(dds.width as usize, 1)).unwrap_or(u16::MAX)
}

#[allow(clippy::too_many_arguments)]
fn swap_texture(
    core: &mut Structure,
    from: Option<&Structure>,
    template: usize,
    swap: &CloneTexture,
    payloads: &Payloads,
    created: &mut HashMap<String, usize>,
    written: bool,
) -> Result<(usize, u32)> {
    if !clone_name(&swap.texture) {
        return Err(broken(format!(
            "YPT clone texture must live in the astral_ namespace: {}",
            swap.texture
        )));
    }
    let key = swap.texture.to_lowercase();
    let hash = hash_name(&key);
    if let Some(&object) = created.get(&key) {
        return Ok((object, hash));
    }
    let bytes = payloads
        .get(&key)
        .ok_or_else(|| broken(format!("YPT clone texture has no payload: {}", swap.texture)))?;
    // DDS приложения: «по блокам» (`encodeDds`) или длины помощника (`yptTextureDds`); годится ли он новому листу при записи —
    // судит `check_new_sheet` по правилам помощника. В выгрузке лист не пишется и не перечитывается: судить нечего.
    let image = dds::parse_helper_layout(bytes)
        .ok()
        .filter(|image| !image.payload.is_empty())
        .ok_or_else(|| broken(format!("DDS could not be decoded: {}", swap.texture)))?;
    if written {
        super::slot_reservations::check_new_sheet(&image)?;
    }
    if core.entries(Kind::Texture)?.iter().any(|entry| entry.hash == hash) {
        return Err(broken(format!(
            "YPT already contains texture {}.",
            swap.texture
        )));
    }
    let side = |value: u32| {
        u16::try_from(value).map_err(|_| broken(format!("DDS could not be decoded: {}", swap.texture)))
    };
    let spec = TextureSpec {
        name: &swap.texture,
        width: side(image.width)?,
        height: side(image.height)?,
        depth: 1,
        stride: stride_of(&image),
        levels: image.levels,
        format: image.format.code(),
        pixels: &image.payload,
    };
    let object = core.add_texture_from(from, template, &spec)?;
    created.insert(key, object);
    Ok((object, hash))
}

fn clone_one(
    s: &mut Structure,
    donors: &Donors,
    piece: &Pieces,
    payloads: &Payloads,
    created: &mut HashMap<String, usize>,
    written: bool,
) -> Result<Cloned> {
    let request = piece.effect;
    for entry in s.entries(Kind::Effect)? {
        let named = entry.object.and_then(|object| s.name(object + EFFECT_NAME));
        if named.is_some_and(|name| same_ignore_case(&name, &request.effect)) {
            return Err(broken(format!("YPT already contains rule {}.", request.effect)));
        }
    }
    let mut builds: Vec<LayerBuild> = Vec::with_capacity(piece.layers.len());
    for (index, layer) in piece.layers.iter().enumerate() {
        builds.push(build_layer(
            s,
            donors,
            &request.effect,
            index,
            layer,
            payloads,
            created,
            request.texture_prefix.as_deref(),
            written,
        )?);
    }

    let composite = builds[0].copy;
    let kept = merge(s, composite, &builds, &request.effect)?;
    let lod_keyframes = match &request.lod {
        Some(lod) => apply_lod(s, composite, &kept, lod, &request.effect)?,
        None => 0,
    };
    // Последним: эволюции слоёв и достроенный LOD сводятся в один список правила.
    unify_evolutions(s, composite, &kept, &request.effect)?;

    s.insert_entry(Kind::Effect, composite, hash_name(&request.effect))?;
    for build in &builds {
        for &rule in &build.emitters {
            s.insert_named(Kind::Emitter, rule)?;
        }
        for &rule in &build.particles {
            s.insert_named(Kind::Particle, rule)?;
        }
    }
    let emitter_rules: Vec<String> = builds.iter().flat_map(|build| build.emitter_names.clone()).collect();
    let particle_rules: Vec<String> = builds.iter().flat_map(|build| build.particle_names.clone()).collect();
    let mut textures: Vec<String> = Vec::new();
    for name in builds.iter().flat_map(|build| build.texture_names.iter()) {
        if !textures.iter().any(|known| same_ignore_case(known, name)) {
            textures.push(name.clone());
        }
    }
    let mut imported: Vec<(String, String)> = Vec::new();
    for item in builds.iter().flat_map(|build| build.imported.iter()) {
        if !imported.iter().any(|known| same_ignore_case(&known.0, &item.0)) {
            imported.push(item.clone());
        }
    }
    Ok(Cloned {
        effect: request.effect.clone(),
        donor_effect: builds[0].donor.clone(),
        emitters: kept.len(),
        dropped_emitters: builds.iter().map(|build| build.donor_events - build.kept.len()).sum(),
        emitter_rules,
        particle_rules,
        textures,
        recoloured_keyframes: builds.iter().map(|build| build.report.recoloured).sum(),
        spawn_keyframes: builds.iter().map(|build| build.report.spawn).sum(),
        replaced_props: builds.iter().map(|build| build.report.replaced).sum(),
        scaled_keyframes: builds.iter().map(|build| build.report.scaled).sum(),
        layers: builds.len(),
        donors: builds.iter().map(|build| build.donor.clone()).collect(),
        lod_keyframes,
        imported_textures: imported,
        replaced: None,
    })
}

/// Копия донора слоя под именами клона: оставленные события, свои эмиттеры и частицы, подмены текстур и настройка
/// самого слоя. В словари ничего не вставляется — это делает составной клон, когда все слои собраны и проверены.
#[allow(clippy::too_many_arguments)]
fn build_layer(
    core: &mut Structure,
    donors: &Donors,
    effect: &str,
    layer_index: usize,
    layer: &CloneLayer,
    payloads: &Payloads,
    created: &mut HashMap<String, usize>,
    texture_prefix: Option<&str>,
    written: bool,
) -> Result<LayerBuild> {
    let foreign = layer.donor_file.is_some();
    let source: Option<&Structure> = match &layer.donor_file {
        Some(file) => Some(
            donors
                .get(&donor_key(file))
                .ok_or_else(|| broken(format!("YPT clone donor file is not loaded: {file}")))?,
        ),
        None => None,
    };

    // --- что известно о доноре до копирования --------------------------------------------------
    let mut found: Vec<usize> = Vec::new();
    {
        let view: &Structure = source.unwrap_or(core);
        for entry in view.entries(Kind::Effect)? {
            if let Some(object) = entry.object {
                if view.name(object + EFFECT_NAME).as_deref() == Some(layer.donor_effect.as_str()) {
                    found.push(object);
                }
            }
        }
    }
    if found.len() != 1 {
        return Err(broken(if found.is_empty() {
            format!("YPT donor effect rule does not exist: {}", layer.donor_effect)
        } else {
            format!("YPT donor effect rule is ambiguous: {}", layer.donor_effect)
        }));
    }
    let donor = found[0];
    let (slots, kept_indices, donor_particles, facts) = {
        let view: &Structure = source.unwrap_or(core);
        let slots = view.event_slots(donor)?;
        let keep: Option<Vec<&str>> = layer
            .keep_particles
            .as_ref()
            .filter(|names| !names.is_empty())
            .map(|names| {
                let mut unique: Vec<&str> = Vec::new();
                for name in names {
                    if !unique.contains(&name.as_str()) {
                        unique.push(name);
                    }
                }
                unique
            });
        let mut kept_indices = Vec::new();
        for (index, slot) in slots.iter().enumerate() {
            let Some(event) = *slot else { continue };
            if view.pointer(event + EVENT_PARTICLE).is_none() || view.pointer(event + EVENT_EMITTER).is_none() {
                continue;
            }
            let particle_name = view.name(event + EVENT_PARTICLE_NAME).unwrap_or_default();
            if keep.as_ref().is_none_or(|names| names.contains(&particle_name.as_str())) {
                kept_indices.push(index);
            }
        }
        if kept_indices.is_empty() {
            return Err(broken(format!(
                "YPT donor effect {} emits none of the requested particle rules.",
                layer.donor_effect
            )));
        }
        if let Some(names) = &keep {
            let emitted: Vec<String> = kept_indices
                .iter()
                .map(|&index| {
                    slots[index]
                        .and_then(|event| view.name(event + EVENT_PARTICLE_NAME))
                        .unwrap_or_default()
                })
                .collect();
            let missing: Vec<&str> = names
                .iter()
                .copied()
                .filter(|name| !emitted.iter().any(|item| item == name))
                .collect();
            if !missing.is_empty() {
                return Err(broken(format!(
                    "YPT donor effect {} does not emit particle rule {}.",
                    layer.donor_effect,
                    missing.join(", ")
                )));
            }
        }
        let mut donor_particles = Vec::new();
        for &index in &kept_indices {
            let event = slots[index].unwrap_or_default();
            donor_particles.push(view.pointer(event + EVENT_PARTICLE).unwrap_or_default());
        }
        let mut facts: HashMap<usize, DonorParticle> = HashMap::new();
        for &particle in &donor_particles {
            if !facts.contains_key(&particle) {
                facts.insert(particle, donor_particle(view, particle)?);
            }
        }
        (slots, kept_indices, donor_particles, facts)
    };

    // --- копия -----------------------------------------------------------------------------------
    let copy = match source {
        Some(other) => core.import_effect(other, donor)?.0,
        None => core.copy_effect(donor)?,
    };
    let copy_slots = core.event_slots(copy.effect)?;
    if copy_slots.len() != slots.len() {
        return Err(broken(format!(
            "YPT donor copy differs from its donor: {}",
            layer.donor_effect
        )));
    }
    let kept_events: Vec<usize> = kept_indices
        .iter()
        .map(|&index| {
            copy_slots[index]
                .ok_or_else(|| broken(format!("YPT donor copy lost its emitters: {}", layer.donor_effect)))
        })
        .collect::<Result<_>>()?;
    // Ёмкость массива событий у правила эффекта сохраняется; оставшиеся события встают в начало и перенумеровываются.
    core.set_events(copy.effect, &kept_events)?;
    // Снятые события лежат в том же блоке: их указатели держали бы копии лишних правил донора.
    let gone: Vec<usize> = copy_slots.iter().flatten().copied().filter(|event| !kept_events.contains(event)).collect();
    core.clear_events(&gone)?;

    // Свои эмиттеры и частицы у клона: штатные правила общие для многих эффектов.
    let (emitters, particles) = core.rules_of(&kept_events);
    let mut donor_particle_of: HashMap<usize, usize> = HashMap::new();
    for (position, &event) in kept_events.iter().enumerate() {
        if let Some(particle) = core.pointer(event + EVENT_PARTICLE) {
            donor_particle_of.entry(particle).or_insert(donor_particles[position]);
        }
    }

    // Первый слой носит имя клона, остальные — с номером слоя.
    let prefix = if layer_index == 0 {
        effect.to_owned()
    } else {
        format!("{effect}_l{layer_index}")
    };
    if layer_index == 0 {
        core.set_name(copy.effect + EFFECT_NAME, effect)?;
    }
    let users = |core: &Structure, at: usize, rule: usize| -> usize {
        kept_events
            .iter()
            .filter(|&&event| core.pointer(event + at) == Some(rule))
            .count()
    };
    let mut emitter_names = Vec::new();
    let mut particle_names = Vec::new();
    for (index, &rule) in emitters.iter().enumerate() {
        let name = format!("{prefix}_e{index}");
        core.set_name(rule + EMITTER_NAME, &name)?;
        core.put_u32(rule + kit::REF_COUNT, (1 + users(core, EVENT_EMITTER, rule)) as u32)?;
        emitter_names.push(name);
    }
    for (index, &rule) in particles.iter().enumerate() {
        let name = format!("{prefix}_p{index}");
        core.set_name(rule + PARTICLE_NAME, &name)?;
        core.put_u32(rule + kit::REF_COUNT, (1 + users(core, EVENT_PARTICLE, rule)) as u32)?;
        particle_names.push(name);
    }
    for &event in &kept_events {
        let emitter = core.pointer(event + EVENT_EMITTER).and_then(|at| core.name(at + EMITTER_NAME));
        let particle = core.pointer(event + EVENT_PARTICLE).and_then(|at| core.name(at + PARTICLE_NAME));
        if let Some(name) = emitter {
            core.set_name(event + EVENT_EMITTER_NAME, &name)?;
        }
        if let Some(name) = particle {
            core.set_name(event + EVENT_PARTICLE_NAME, &name)?;
        }
    }

    // --- листы и внешние ссылки -----------------------------------------------------------------
    let swaps: &[CloneTexture] = layer.textures.as_deref().unwrap_or(&[]);
    let diffuse = hash_name(DIFFUSE_VARIABLE);
    let mut texture_names: Vec<String> = Vec::new();
    let mut imported: Vec<(String, String)> = Vec::new();
    for &particle in &particles {
        let original = donor_particle_of[&particle];
        let fact = &facts[&original];
        // Порождаемые эффекты и модели чужого файла переносить некуда: такой донор отвергается.
        if foreign {
            if let Some(spawned) = &fact.spawned {
                return Err(broken(format!(
                    "YPT donor {} spawns effect {spawned} from another file; only self-contained donors can be borrowed.",
                    layer.donor_effect
                )));
            }
            if fact.has_model {
                return Err(broken(format!(
                    "YPT donor {} draws models from another file; only sprite donors can be borrowed.",
                    layer.donor_effect
                )));
            }
        }
        let list = core.list(particle + PARTICLE_VARS)?;
        let copy_slots = core.list_slots(list);
        for variable in &fact.variables {
            let Some(copy_variable) = copy_slots.get(variable.index).copied().flatten() else {
                return Err(broken(format!(
                    "YPT donor copy changed its shader variables: {}",
                    fact.name.clone().unwrap_or_default()
                )));
            };
            let texture_name = variable.name_text.clone().or_else(|| variable.texture_name.clone());
            let swap = if variable.name_hash == diffuse && variable.texture.is_some() {
                find_swap(swaps, fact.name.as_deref(), texture_name.as_deref())
            } else {
                None
            };
            if let (Some(swap), Some(template)) = (swap, variable.texture) {
                let (object, hash) = swap_texture(core, source, template, swap, payloads, created, written)?;
                if !texture_names.iter().any(|known| same_ignore_case(known, &swap.texture)) {
                    texture_names.push(swap.texture.clone());
                }
                core.set_system_pointer(copy_variable + VAR_TEXTURE, Some(object))?;
                core.set_name(copy_variable + VAR_TEXTURE_NAME, &swap.texture)?;
                core.put_u32(copy_variable + VAR_TEXTURE_HASH, hash)?;
                apply_frames(core, particle, swap, effect)?;
                continue;
            }
            let Some(other) = source else {
                // Штатный лист ядра: ссылка копии осталась на него.
                continue;
            };
            // Чужой донор: лист ядра под тем же именем — общий, иначе лист переезжает из файла донора.
            let name = texture_name.unwrap_or_default();
            if name.is_empty() || name.eq_ignore_ascii_case("None") {
                core.set_system_pointer(copy_variable + VAR_TEXTURE, None)?;
                continue;
            }
            let shared = core.entries(Kind::Texture)?.into_iter().find_map(|entry| {
                let object = entry.object?;
                let candidate = core.name(object + TEXTURE_NAME)?;
                same_ignore_case(&candidate, &name).then_some((object, candidate))
            });
            if let Some((object, candidate)) = shared {
                core.set_system_pointer(copy_variable + VAR_TEXTURE, Some(object))?;
                core.set_name(copy_variable + VAR_TEXTURE_NAME, &candidate)?;
                core.put_u32(copy_variable + VAR_TEXTURE_HASH, hash_name(&candidate.to_lowercase()))?;
                continue;
            }
            let template = variable.texture.ok_or_else(|| {
                broken(format!(
                    "YPT donor {} draws texture {name}, which neither its file nor the core carries.",
                    layer.donor_effect
                ))
            })?;
            let target = imported_texture_name(&name, texture_prefix)?;
            let key = target.to_lowercase();
            let hash = hash_name(&key);
            let object = match created.get(&key) {
                Some(&object) => object,
                None => {
                    if core.entries(Kind::Texture)?.iter().any(|entry| entry.hash == hash) {
                        return Err(broken(format!("YPT already contains texture {target}.")));
                    }
                    if !has_pixels(other, template) {
                        return Err(broken(format!("YPT donor texture has no pixels: {name}")));
                    }
                    let object = core.import_texture(other, template, &target)?;
                    created.insert(key, object);
                    object
                }
            };
            core.set_system_pointer(copy_variable + VAR_TEXTURE, Some(object))?;
            core.set_name(copy_variable + VAR_TEXTURE_NAME, &target)?;
            core.put_u32(copy_variable + VAR_TEXTURE_HASH, hash)?;
            if !texture_names.iter().any(|known| same_ignore_case(known, &target)) {
                texture_names.push(target.clone());
            }
            if !imported.iter().any(|known| same_ignore_case(&known.0, &target)) {
                imported.push((target, name));
            }
        }
    }
    for swap in swaps {
        if !texture_names.iter().any(|known| same_ignore_case(known, &swap.texture)) {
            return Err(broken(format!(
                "YPT clone {effect} has no particle drawing the texture to replace with {}.",
                swap.texture
            )));
        }
    }

    // --- настройка -------------------------------------------------------------------------------
    let donor_names: HashMap<usize, String> = donor_particle_of
        .iter()
        .filter_map(|(&copy_particle, original)| {
            facts[original].name.clone().map(|name| (copy_particle, name))
        })
        .collect();
    let report = tune_mod::apply_tune(
        core,
        &Layer {
            effect: copy.effect,
            events: &kept_events,
            emitters: &emitters,
            particles: &particles,
            donor_names: &donor_names,
        },
        layer.tune.as_ref(),
        effect,
    )?;
    Ok(LayerBuild {
        copy: copy.effect,
        kept: kept_events,
        emitters,
        particles,
        emitter_names,
        particle_names,
        texture_names,
        imported,
        report,
        donor_events: slots.len(),
        donor: layer.donor_effect.clone(),
    })
}

/// Есть ли у описания листа пиксели: указатель в графической области.
fn has_pixels(source: &Structure, texture: usize) -> bool {
    source
        .graph()
        .block_at(Address {
            segment: Segment::System,
            offset: texture,
        })
        .is_some_and(|index| {
            let block = &source.graph().blocks[index];
            block
                .slots
                .iter()
                .any(|slot| block.start + slot.relative == texture + 0x70 && slot.target.segment == Segment::Graphics)
        })
}

/// Кадры листа у частицы и, если заказано, анимация листа.
fn apply_frames(s: &mut Structure, particle: usize, swap: &CloneTexture, effect: &str) -> Result<()> {
    if let Some(min) = swap.frame_min {
        s.put_u32(particle + kit::PARTICLE_FRAME_MIN, min.max(0) as u32)?;
    }
    if let Some(max) = swap.frame_max {
        s.put_u32(particle + kit::PARTICLE_FRAME_MAX, max.max(0) as u32)?;
    }
    if s.u32(particle + kit::PARTICLE_FRAME_MAX)? < s.u32(particle + kit::PARTICLE_FRAME_MIN)? {
        return Err(broken(format!("YPT clone frames are out of order: {effect}")));
    }
    if swap.last_frame.is_none()
        && swap.loop_mode.is_none()
        && swap.scaled_over_life.is_none()
        && swap.randomised.is_none()
    {
        return Ok(());
    }
    for behaviour in kit::behaviours(s, particle)? {
        if kit::behaviour_type(s, behaviour)? != kit::TYPE_ANIMATE_TEXTURE {
            continue;
        }
        if let Some(last) = swap.last_frame {
            s.put_u32(behaviour + kit::ANIMATE_LAST_FRAME, last as u32)?;
        }
        if let Some(mode) = swap.loop_mode {
            s.put_u32(behaviour + kit::ANIMATE_LOOP_MODE, mode as u32)?;
        }
        if let Some(scaled) = swap.scaled_over_life {
            s.put_u8(behaviour + kit::ANIMATE_SCALED, u8::from(scaled))?;
        }
        if let Some(randomised) = swap.randomised {
            s.put_u8(behaviour + kit::ANIMATE_RANDOMISED, u8::from(randomised))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Слияние слоёв, дальность, эволюции
// ---------------------------------------------------------------------------------------------

/// Масштаб уровня правила: первый кадр ptxEffectRule:m_zoomScalarKFP, проценты.
fn effect_zoom(s: &Structure, rule: usize) -> Result<f32> {
    let props = kit::with_hash(s, &kit::effect_props(rule), kit::prop_hash(ZOOM_SCALAR))?;
    let keys = match props.first() {
        Some(&prop) => kit::prop_keys(s, prop)?,
        None => Vec::new(),
    };
    Ok(match keys.first() {
        Some(key) if key.value[0] > 0.0 => key.value[0],
        _ => 100.0,
    })
}

/// События всех слоёв — в одно правило: правило остаётся правилом первого слоя, события остальных встают следом.
fn merge(s: &mut Structure, composite: usize, builds: &[LayerBuild], effect: &str) -> Result<Vec<usize>> {
    let list = s.list(composite + super::structure::EFFECT_EVENTS)?;
    let capacity = list.capacity.max(list.count);
    let total: usize = builds.iter().map(|build| build.kept.len()).sum();
    let room = capacity.min(MAX_EVENT_EMITTERS);
    if total > room {
        return Err(broken(format!(
            "YPT clone {effect} would carry {total} emitters; GTA plays at most {room} per effect rule."
        )));
    }
    if builds.len() > 1 {
        let get = |s: &Structure, rule: usize, at: usize| s.f32(rule + at);
        let mut duration_max = f32::MIN;
        let mut duration_min = f32::MIN;
        for build in builds {
            duration_max = duration_max.max(get(s, build.copy, kit::EFFECT_DURATION_MAX)?);
            duration_min = duration_min.max(get(s, build.copy, kit::EFFECT_DURATION_MIN)?);
        }
        let zoom = effect_zoom(s, composite)?;
        let composite_play_min = get(s, composite, kit::EFFECT_PLAYBACK_MIN)?;
        let composite_play_max = get(s, composite, kit::EFFECT_PLAYBACK_MAX)?;
        for build in builds {
            let own = build.copy;
            // Слой короче правила идёт в своей доле его времени.
            let own_max = get(s, own, kit::EFFECT_DURATION_MAX)?;
            let ratio = if duration_max > 0.0 && own_max > 0.0 { own_max / duration_max } else { 1.0 };
            let mut play_min = if composite_play_min > 0.0 {
                get(s, own, kit::EFFECT_PLAYBACK_MIN)? / composite_play_min
            } else {
                1.0
            };
            let mut play_max = if composite_play_max > 0.0 {
                get(s, own, kit::EFFECT_PLAYBACK_MAX)? / composite_play_max
            } else {
                1.0
            };
            let mut scale = effect_zoom(s, own)? / zoom;
            if own == composite {
                play_min = 1.0;
                play_max = 1.0;
                scale = 1.0;
            }
            for &item in &build.kept {
                let ratio_field = |s: &mut Structure, at: usize| -> Result<()> {
                    let value = s.f32(item + at)?;
                    s.put_f32(item + at, (value * ratio).clamp(0.0, 1.0))
                };
                ratio_field(s, kit::EVENT_START)?;
                ratio_field(s, kit::EVENT_END)?;
                for (at, factor) in [
                    (kit::EVENT_PLAYBACK_MIN, play_min),
                    (kit::EVENT_PLAYBACK_MAX, play_max),
                    (kit::EVENT_ZOOM_MIN, scale),
                    (kit::EVENT_ZOOM_MAX, scale),
                ] {
                    let value = s.f32(item + at)?;
                    s.put_f32(item + at, value * factor)?;
                }
            }
        }
        s.put_f32(composite + kit::EFFECT_DURATION_MIN, duration_min)?;
        s.put_f32(composite + kit::EFFECT_DURATION_MAX, duration_max)?;
        let mut cull = f32::MIN;
        let mut fade = f32::MIN;
        let mut sphere = f32::MIN;
        for build in builds {
            cull = cull.max(s.f32(build.copy + kit::EFFECT_CULL_DIST)?);
            fade = fade.max(s.f32(build.copy + kit::EFFECT_CULL_FADE)?);
            sphere = sphere.max(s.f32(build.copy + kit::EFFECT_VIEWPORT_RADIUS)?);
        }
        s.put_f32(composite + kit::EFFECT_CULL_DIST, cull)?;
        s.put_f32(composite + kit::EFFECT_CULL_FADE, cull.min(fade))?;
        s.put_f32(composite + kit::EFFECT_VIEWPORT_RADIUS, sphere)?;
        // Дальность LOD — у первого слоя, а если её у него нет, — самая широкая из слоёв, у которых она есть.
        let (lod_min, lod_max) = (
            s.f32(composite + kit::EFFECT_LOD_MIN)?,
            s.f32(composite + kit::EFFECT_LOD_MAX)?,
        );
        if lod_max <= lod_min {
            let mut ranged: Vec<(f32, f32)> = Vec::new();
            for build in builds {
                let (low, high) = (
                    s.f32(build.copy + kit::EFFECT_LOD_MIN)?,
                    s.f32(build.copy + kit::EFFECT_LOD_MAX)?,
                );
                if high > low {
                    ranged.push((low, high));
                }
            }
            if !ranged.is_empty() {
                let low = ranged.iter().map(|pair| pair.0).fold(f32::MAX, f32::min);
                let high = ranged.iter().map(|pair| pair.1).fold(f32::MIN, f32::max);
                s.put_f32(composite + kit::EFFECT_LOD_MIN, low)?;
                s.put_f32(composite + kit::EFFECT_LOD_MAX, high)?;
            }
        }
    }
    let kept: Vec<usize> = builds.iter().flat_map(|build| build.kept.iter().copied()).collect();
    s.set_events(composite, &kept)?;
    Ok(kept)
}

fn lod_frames(s: &Structure, event: usize, prop: u32) -> Result<Option<usize>> {
    let Some(list) = s.pointer(event + kit::EVENT_EVOLUTIONS) else {
        return Ok(None);
    };
    for (hash, frames) in kit::evolved_frames(s, list)? {
        if hash != prop {
            continue;
        }
        for entry in frames {
            if s.u8(entry + 0x24)? != 0 {
                return Ok(Some(entry));
            }
        }
    }
    Ok(None)
}

/// Дальность: размер вблизи — базовые кадры размера эмиттера, вдали — кадры его эволюции LOD, предел видимости —
/// отсечение по расстоянию у правила.
fn apply_lod(s: &mut Structure, effect: usize, kept: &[usize], lod: &CloneLod, label: &str) -> Result<usize> {
    let near = match lod.near {
        Some(value) => tune_mod::bounded(value, 0.1, 8.0, "lod near", label)?,
        None => 1.0,
    };
    let far = match lod.far {
        Some(value) => tune_mod::bounded(value, 0.1, 8.0, "lod far", label)?,
        None => 1.0,
    };
    if let Some(value) = lod.distance_min {
        let low = tune_mod::bounded(value, 0.0, 1000.0, "lod distanceMin", label)?;
        s.put_f32(effect + kit::EFFECT_LOD_MIN, low)?;
    }
    if let Some(value) = lod.distance_max {
        let high = tune_mod::bounded(value, 1.0, 1000.0, "lod distanceMax", label)?;
        s.put_f32(effect + kit::EFFECT_LOD_MAX, high)?;
    }
    // Правило без дальности берёт её у крови игры — 5…40 м; заданная заказом дальность не подменяется.
    if lod.distance_min.is_none()
        && lod.distance_max.is_none()
        && s.f32(effect + kit::EFFECT_LOD_MIN)? == 0.0
        && s.f32(effect + kit::EFFECT_LOD_MAX)? == 0.0
    {
        s.put_f32(effect + kit::EFFECT_LOD_MIN, BLOOD_LOD_MIN)?;
        s.put_f32(effect + kit::EFFECT_LOD_MAX, BLOOD_LOD_MAX)?;
    }
    if s.f32(effect + kit::EFFECT_LOD_MAX)? <= s.f32(effect + kit::EFFECT_LOD_MIN)? {
        return Err(broken(format!("YPT clone {label} lod distances are out of order.")));
    }
    if let Some(value) = lod.reach {
        let reach = tune_mod::bounded(value, 5.0, 2000.0, "lod reach", label)?;
        s.put_f32(effect + kit::EFFECT_CULL_DIST, reach)?;
        // Гаснуть начинает на последних 13 % пути — та же доля, что у штатной крови.
        s.put_f32(effect + kit::EFFECT_CULL_FADE, (reach * 0.87f32).max(1.0))?;
    }
    let size_hash = kit::prop_hash(SIZE_SCALAR);
    // Свойство размера эмиттера события: первое с таким именем, если у него есть кадры.
    let size_of = |s: &Structure, event: usize| -> Result<Option<usize>> {
        let Some(emitter) = s.pointer(event + EVENT_EMITTER) else {
            return Ok(None);
        };
        let first = kit::with_hash(s, &kit::emitter_props(emitter), size_hash)?.first().copied();
        Ok(match first {
            Some(prop) if !kit::prop_keys(s, prop)?.is_empty() => Some(prop),
            _ => None,
        })
    };
    let mut touched = 0;
    if far != 1.0 {
        for &event in kept {
            let Some(base) = size_of(s, event)? else { continue };
            touched += match lod_frames(s, event, size_hash)? {
                Some(entry) => kit::scale_xy(s, entry, far)?,
                None => create_lod_keyframes(s, event, base, far)?,
            };
        }
    }
    if near != 1.0 {
        let mut done: Vec<usize> = Vec::new();
        for &event in kept {
            let Some(base) = size_of(s, event)? else { continue };
            let Some(emitter) = s.pointer(event + EVENT_EMITTER) else { continue };
            if done.contains(&emitter) {
                continue;
            }
            done.push(emitter);
            touched += kit::scale_xy(s, base + 0x70, near)?;
        }
    }
    Ok(touched)
}

/// Эволюция LOD для свойства, у которого её не было: те же кадры, что у базового свойства, умноженные на «вдали».
fn create_lod_keyframes(s: &mut Structure, event: usize, base: usize, far: f32) -> Result<usize> {
    let list = match s.pointer(event + kit::EVENT_EVOLUTIONS) {
        Some(list) => list,
        None => {
            let template = template_of(s)?;
            let list = kit::blank_evolution(s, template);
            s.set_system_pointer(event + kit::EVENT_EVOLUTIONS, Some(list))?;
            list
        }
    };
    let mut model = kit::read_evolution(s, list)?;
    let index = match model
        .names
        .iter()
        .position(|name| same_ignore_case(name, LOD_EVOLUTION))
    {
        Some(index) => index,
        None => {
            model.names.push(LOD_EVOLUTION.to_owned());
            model.names.len() - 1
        }
    };
    let hash = kit::hash_of(s, base)?;
    let position = match model.props.iter().position(|prop| prop.hash == hash) {
        Some(position) => position,
        None => {
            model.props.push(kit::EvolvedProp {
                hash,
                blend: 1,
                frames: Vec::new(),
            });
            model.props.len() - 1
        }
    };
    let keys: Vec<kit::Key> = kit::prop_keys(s, base)?
        .into_iter()
        .map(|key| kit::Key {
            time: key.time,
            value: [key.value[0] * far, key.value[1] * far, key.value[2], key.value[3]],
        })
        .collect();
    let count = keys.len();
    let array = if keys.is_empty() {
        None
    } else {
        let bytes: Vec<u8> = keys
            .iter()
            .flat_map(|key| key.time.into_iter().chain(key.value).flat_map(f32::to_le_bytes))
            .collect();
        Some(s.alloc(bytes, &[]))
    };
    let mut raw = [0u8; 0x30];
    raw[8..10].copy_from_slice(&(count as u16).to_le_bytes());
    raw[10..12].copy_from_slice(&(count as u16).to_le_bytes());
    model.props[position].frames.push(kit::Evolved {
        id: index as i32,
        lod: 1,
        raw,
        keys: array,
    });
    kit::write_evolution(s, list, &model)?;
    Ok(count)
}

/// Байты списка эволюций первого правила ядра, у которого он есть.
fn template_of(s: &Structure) -> Result<Option<[u8; 0x40]>> {
    let effects: Vec<usize> = s.entries(Kind::Effect)?.into_iter().filter_map(|entry| entry.object).collect();
    Ok(kit::evolution_template(s, &effects))
}

/// У Rockstar список эволюций события либо пуст, либо тот же, что у его правила: список правила — объединение
/// списков всех событий в порядке появления, каждое событие с непустым списком получает ровно его.
fn unify_evolutions(s: &mut Structure, rule: usize, kept: &[usize], label: &str) -> Result<()> {
    let names_of = |s: &Structure, list: Option<usize>| -> Result<Vec<String>> {
        Ok(match list {
            Some(list) => kit::read_evolution(s, list)?.names,
            None => Vec::new(),
        })
    };
    let mut union: Vec<String> = Vec::new();
    let mut add = |names: Vec<String>| {
        for name in names {
            if !name.is_empty() && !union.iter().any(|known| same_ignore_case(known, &name)) {
                union.push(name);
            }
        }
    };
    add(names_of(s, s.pointer(rule + kit::EFFECT_EVOLUTIONS))?);
    for &event in kept {
        add(names_of(s, s.pointer(event + kit::EVENT_EVOLUTIONS))?);
    }
    while union.len() > MAX_EVOLUTIONS {
        let spare = union
            .iter()
            .rposition(|name| !DRIVEN_EVOLUTIONS.iter().any(|driven| same_ignore_case(driven, name)));
        match spare {
            Some(spare) => {
                union.remove(spare);
            }
            None => {
                return Err(broken(format!(
                    "YPT clone {label} needs more than {MAX_EVOLUTIONS} evolutions."
                )))
            }
        }
    }
    if union.is_empty() {
        return Ok(());
    }
    let template = template_of(s)?;
    renumber(s, rule + kit::EFFECT_EVOLUTIONS, &union, false, template)?;
    for &event in kept {
        renumber(s, event + kit::EVENT_EVOLUTIONS, &union, true, template)?;
    }
    Ok(())
}

/// Список эволюций под общий: кадры перенумерованы по имени, кадры снятых эволюций убраны вместе со свойствами,
/// у которых кадров не осталось. Пустой список события остаётся пустым.
fn renumber(
    s: &mut Structure,
    holder: usize,
    union: &[String],
    keep_empty: bool,
    template: Option<[u8; 0x40]>,
) -> Result<()> {
    let existing = s.pointer(holder);
    let mut model = match existing {
        Some(list) => kit::read_evolution(s, list)?,
        None => kit::Evolution::default(),
    };
    if keep_empty && model.names.is_empty() && model.props.is_empty() {
        return Ok(());
    }
    let names = std::mem::take(&mut model.names);
    for prop in &mut model.props {
        let frames = std::mem::take(&mut prop.frames);
        for mut entry in frames {
            let Some(name) = usize::try_from(entry.id).ok().and_then(|id| names.get(id)) else {
                continue;
            };
            let Some(index) = union.iter().position(|candidate| same_ignore_case(candidate, name)) else {
                continue;
            };
            entry.id = index as i32;
            prop.frames.push(entry);
        }
    }
    model.props.retain(|prop| !prop.frames.is_empty());
    model.names = union.to_vec();
    let list = match existing {
        Some(list) => list,
        None => {
            let list = kit::blank_evolution(s, template);
            s.set_system_pointer(holder, Some(list))?;
            list
        }
    };
    kit::write_evolution(s, list, &model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ypt::fixture;
    use crate::ypt::image::Image;
    use crate::ypt::vanilla;

    fn opened() -> (fixture::Core, Structure) {
        let core = fixture::core(true);
        let structure = Structure::parse(&core.bytes).unwrap();
        (core, structure)
    }

    fn simple(effect: &str, donor: &str) -> EffectClone {
        EffectClone {
            effect: effect.to_owned(),
            donor_effect: Some(donor.to_owned()),
            ..EffectClone::default()
        }
    }

    fn run(s: &mut Structure, clones: &[EffectClone]) -> Result<Vec<Cloned>> {
        apply(s, clones, &Payloads::new(), &Donors::new())
    }

    fn refusal(clones: &[EffectClone]) -> String {
        let (_, mut s) = opened();
        run(&mut s, clones).unwrap_err().message
    }

    /// DDS DXT5 `side`×`side` без ступеней-мип: заголовок и шум.
    fn dds_bytes(side: u32) -> Vec<u8> {
        let payload = (side.div_ceil(4) * side.div_ceil(4) * 16) as usize;
        let mut out = vec![0u8; 128];
        out[..4].copy_from_slice(b"DDS ");
        for (at, value) in [(4, 124u32), (8, 0x0008_1007), (12, side), (16, side), (20, payload as u32), (28, 1), (76, 32), (80, 4)] {
            out[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }
        out[84..88].copy_from_slice(b"DXT5");
        out[108..112].copy_from_slice(&0x0040_1000u32.to_le_bytes());
        out.extend((0..payload).map(|k| (k as u8).wrapping_mul(13).wrapping_add(5)));
        out
    }

    #[test]
    fn names_follow_the_game_namespace_rules() {
        assert!(clone_name("astral_a") && clone_name("astral_a_1"));
        assert!(!clone_name("astral_") && !clone_name("astral_A") && !clone_name("probe_a"));
        assert!(!clone_name(&format!("astral_{}", "a".repeat(49))));
        assert!(clone_name(&format!("astral_{}", "a".repeat(48))));
        assert!(donor_name("blood_entry") && donor_name("Blood_Entry9") && !donor_name("blood entry") && !donor_name(""));
        assert!(texture_prefix_name("astral_impact_tex_") && !texture_prefix_name("astral_impact") && !texture_prefix_name("astral__"));
        assert!(prop_name("ptxEmitterRule:m_speedScalarKFP") && !prop_name("speed") && !prop_name("ptxu_Size:m_whd1"));
        assert!(scale_prop_name("ptxTargetDomain:m_sizeOuterKFP") && !scale_prop_name("ptxu_Size:m_whdMinKFP"));
        assert_eq!(imported_texture_name("ptfx_Clown_Flower", None).unwrap(), "astral_impact_tex_clown_flower");
        assert_eq!(imported_texture_name("a-b c", Some("astral_mine_")).unwrap(), "astral_mine_a_b_c");
    }

    #[test]
    fn a_base_clone_owns_its_rules_and_names() {
        let (_, mut s) = opened();
        let done = run(&mut s, &[simple("astral_x", "tracer")]).unwrap();
        assert_eq!(done.len(), 1);
        let report = &done[0];
        assert_eq!(report.effect, "astral_x");
        assert_eq!(report.donor_effect, "tracer");
        assert_eq!((report.emitters, report.dropped_emitters, report.layers), (1, 0, 1));
        assert_eq!(report.emitter_rules, vec!["astral_x_e0".to_owned()]);
        assert_eq!(report.particle_rules, vec!["astral_x_p0".to_owned()]);
        assert!(report.textures.is_empty() && report.replaced.is_none());
        let file = s.into_file().unwrap();
        let image = Image::parse(&file).unwrap();
        assert!(vanilla::assert_dictionaries(&image).unwrap().is_empty());
        let mut remarks = std::collections::BTreeSet::new();
        vanilla::verify_graph(&image, None, &mut remarks).unwrap();
        let keys = vanilla::inventory(&image).unwrap().keys();
        for wanted in ["effect:astral_x", "emitter:astral_x_e0", "particle:astral_x_p0", "effect:tracer", "texture:ptfx_tracer"] {
            assert!(keys.iter().any(|key| key == wanted), "нет {wanted}");
        }
        // счётчики ссылок клона: свои, 1 + число событий
        let again = Structure::parse(&file).unwrap();
        let effect = again.find_exact(Kind::Effect, "astral_x").unwrap().unwrap();
        let event = again.events(effect).unwrap()[0];
        let emitter = again.pointer(event + EVENT_EMITTER).unwrap();
        assert_eq!(again.u32(emitter + kit::REF_COUNT).unwrap(), 2);
        assert_eq!(again.name(event + EVENT_EMITTER_NAME).as_deref(), Some("astral_x_e0"));
    }

    #[test]
    fn a_family_is_removed_by_its_prefix_and_the_core_is_as_before() {
        let (core, mut s) = opened();
        let before = vanilla::inventory(&Image::parse(&core.bytes).unwrap()).unwrap();
        run(&mut s, &[simple("astral_x", "tracer"), simple("astral_y", "tracer")]).unwrap();
        let mut restored = BTreeSet::new();
        let removed = purge(&mut s, &["astral_x".to_owned(), "astral_y".to_owned()], &mut restored).unwrap();
        for wanted in ["effect:astral_x", "effect:astral_y", "emitter:astral_x_e0", "particle:astral_y_p0"] {
            assert!(removed.contains(wanted), "нет {wanted}");
        }
        assert!(restored.is_empty());
        let file = s.into_file().unwrap();
        assert_eq!(vanilla::inventory(&Image::parse(&file).unwrap()).unwrap(), before);
        assert_eq!(
            purge(&mut Structure::parse(&file).unwrap(), &["Astral".to_owned()], &mut restored).unwrap_err().message,
            "YPT clone reset prefix must live in the astral_ namespace: Astral"
        );
    }

    #[test]
    fn the_request_is_refused_where_the_helper_refuses() {
        let donor = |name: &str, rest: EffectClone| EffectClone { effect: name.to_owned(), ..rest };
        assert_eq!(refusal(&[]), "YPT effect clone count must be between 1 and 16.");
        assert_eq!(refusal(&[simple("probe", "tracer")]), "YPT clone names must live in the astral_ namespace: probe");
        assert_eq!(refusal(&[donor("astral_x", EffectClone::default())]), "YPT clone astral_x names no donor effect rule.");
        assert_eq!(refusal(&[simple("astral_x", "no such")]), "YPT clone donor name is invalid: astral_x");
        assert_eq!(refusal(&[simple("astral_x", "nobody")]), "YPT donor effect rule does not exist: nobody");
        assert_eq!(
            refusal(&[simple("astral_x", "tracer"), simple("astral_x", "tracer")]),
            "YPT effect is cloned twice: astral_x"
        );
        let mut both = simple("astral_x", "tracer");
        both.layers = Some(vec![CloneLayer { donor_effect: "tracer".to_owned(), ..CloneLayer::default() }]);
        assert_eq!(refusal(&[both]), "YPT clone astral_x names both layers and a single donor.");
        let mut keep = simple("astral_x", "tracer");
        keep.keep_particles = Some(vec!["nothing".to_owned()]);
        assert_eq!(refusal(&[keep]), "YPT donor effect tracer emits none of the requested particle rules.");
        let mut other = simple("astral_x", "tracer");
        other.replaces = Some("tracer".to_owned());
        assert_eq!(refusal(&[other]), "YPT effect rule cannot be replaced in place: tracer");
        let layer = |donor: &str| CloneLayer { donor_effect: donor.to_owned(), ..CloneLayer::default() };
        let mut crowded = donor("astral_x", EffectClone::default());
        crowded.layers = Some(vec![layer("tracer"), layer("tracer")]);
        assert_eq!(
            refusal(&[crowded]),
            "YPT clone astral_x would carry 2 emitters; GTA plays at most 1 per effect rule."
        );
        let mut far = donor("astral_x", EffectClone::default());
        far.layers = Some(vec![CloneLayer { donor_file: Some("C:/nowhere.ypt".to_owned()), ..layer("tracer") }]);
        assert_eq!(refusal(&[far]), "YPT clone donor file is not loaded: C:/nowhere.ypt");
    }

    #[test]
    fn a_colour_keeps_the_brightness_of_the_donor_and_counts_what_it_painted() {
        let (_, mut s) = opened();
        let mut clone = simple("astral_x", "tracer");
        clone.tune = Some(CloneTune {
            colour: Some(vec![0.1, 0.4, 1.0]),
            alpha_scale: Some(0.5),
            ..CloneTune::default()
        });
        let report = run(&mut s, &[clone]).unwrap().remove(0);
        // у цвета частицы два свойства: нижние кадры (два) и верхние (один)
        assert_eq!(report.recoloured_keyframes, 3);
        let effect = s.find_exact(Kind::Effect, "astral_x").unwrap().unwrap();
        let event = s.events(effect).unwrap()[0];
        let particle = s.pointer(event + EVENT_PARTICLE).unwrap();
        let colour = kit::behaviours(&s, particle)
            .unwrap()
            .into_iter()
            .find(|&behaviour| kit::behaviour_type(&s, behaviour).unwrap() == kit::TYPE_COLOUR)
            .unwrap();
        let keys = kit::read_keys(&s, colour + kit::COLOUR_RGBA_MIN + 0x70).unwrap();
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].value, [0.1, 0.4, 1.0, 0.25]);
        assert_eq!(keys[1].value, [0.1 * 0.5, 0.4 * 0.5, 1.0 * 0.5, 0.0]);
        // донор не тронут
        let donor_colour = kit::behaviours(&s, s.pointer(s.events(s.find_exact(Kind::Effect, "tracer").unwrap().unwrap()).unwrap()[0] + EVENT_PARTICLE).unwrap())
            .unwrap()
            .into_iter()
            .find(|&behaviour| kit::behaviour_type(&s, behaviour).unwrap() == kit::TYPE_COLOUR)
            .unwrap();
        let original = kit::read_keys(&s, donor_colour + kit::COLOUR_RGBA_MIN + 0x70).unwrap();
        assert_eq!(original[0].value, [1.0, 0.6, 0.2, 0.5]);
    }

    #[test]
    fn a_picture_swaps_the_sheet_and_the_donor_keeps_its_own() {
        let (core, mut s) = opened();
        // у частицы фикстуры лист не связан с переменной: имя шейдерной переменной и указатель задаём сами
        let particle = core.map.particle;
        let variable = s.objects(s.list(particle + PARTICLE_VARS).unwrap())[0];
        let texture = s.entries(Kind::Texture).unwrap()[0].object.unwrap();
        s.put_u32(variable + 0x10, hash_name(DIFFUSE_VARIABLE)).unwrap();
        s.set_system_pointer(variable + VAR_TEXTURE, Some(texture)).unwrap();
        let mut clone = simple("astral_x", "tracer");
        clone.textures = Some(vec![CloneTexture {
            texture: "astral_pic".to_owned(),
            particles: Some(vec!["tracer".to_owned()]),
            frame_min: Some(0),
            frame_max: Some(3),
            ..CloneTexture::default()
        }]);
        let mut payloads = Payloads::new();
        payloads.insert("astral_pic".to_owned(), dds_bytes(16));
        let report = apply(&mut s, &[clone], &payloads, &Donors::new()).unwrap().remove(0);
        assert_eq!(report.textures, vec!["astral_pic".to_owned()]);
        let file = s.into_file().unwrap();
        let again = Structure::parse(&file).unwrap();
        let names = again.names(Kind::Texture).unwrap();
        assert!(names.contains(&"astral_pic".to_owned()) && names.contains(&"ptfx_tracer".to_owned()));
        let core_read = super::super::read(&crate::resource::Resource::parse(&file).unwrap()).unwrap();
        let sheet = core_read.textures.iter().find(|item| item.name == "astral_pic").unwrap();
        assert_eq!((sheet.width, sheet.height, sheet.levels), (16, 16, 1));
        // клон рисует новый лист, донор — прежний
        let effect = again.find_exact(Kind::Effect, "astral_x").unwrap().unwrap();
        let clone_particle = again.pointer(again.events(effect).unwrap()[0] + EVENT_PARTICLE).unwrap();
        let clone_variable = again.objects(again.list(clone_particle + PARTICLE_VARS).unwrap())[0];
        let drawn = again.pointer(clone_variable + VAR_TEXTURE).unwrap();
        assert_eq!(again.name(drawn + TEXTURE_NAME).as_deref(), Some("astral_pic"));
        assert_eq!(again.name(clone_variable + VAR_TEXTURE_NAME).as_deref(), Some("astral_pic"));
        assert_eq!(again.u32(clone_particle + kit::PARTICLE_FRAME_MAX).unwrap(), 3);
        let donor_effect = again.find_exact(Kind::Effect, "tracer").unwrap().unwrap();
        let donor_particle = again.pointer(again.events(donor_effect).unwrap()[0] + EVENT_PARTICLE).unwrap();
        let donor_variable = again.objects(again.list(donor_particle + PARTICLE_VARS).unwrap())[0];
        let kept = again.pointer(donor_variable + VAR_TEXTURE).unwrap();
        assert_eq!(again.name(kept + TEXTURE_NAME).as_deref(), Some("ptfx_tracer"));
        // отказы по листу
        let (_, mut other) = opened();
        let mut missing = simple("astral_x", "tracer");
        missing.textures = Some(vec![CloneTexture {
            texture: "astral_pic".to_owned(),
            particles: Some(vec!["tracer".to_owned()]),
            ..CloneTexture::default()
        }]);
        assert_eq!(
            apply(&mut other, &[missing], &Payloads::new(), &Donors::new()).unwrap_err().message,
            "YPT clone astral_x has no particle drawing the texture to replace with astral_pic."
        );
    }

    #[test]
    fn two_layers_of_one_donor_do_not_fit_the_event_array_of_the_fixture_but_one_does() {
        let (_, mut s) = opened();
        let mut clone = simple("astral_x", "tracer");
        clone.donor_effect = None;
        clone.layers = Some(vec![CloneLayer { donor_effect: "tracer".to_owned(), ..CloneLayer::default() }]);
        let report = run(&mut s, &[clone]).unwrap().remove(0);
        assert_eq!((report.layers, report.emitters), (1, 1));
        assert_eq!(report.donors, vec!["tracer".to_owned()]);
    }
}
