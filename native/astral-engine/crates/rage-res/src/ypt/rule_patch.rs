//! Правки правил следа в ядре `core.ypt`: размер спрайта, белый цвет, «вблизи следа нет».
//!
//! Порт режима `rulePatches` помощника `ypt-texture-patch` (`YptRulePatch`, `ApplyTracerShape`): те же
//! числа, те же отказы и тексты. Правки ложатся на `Image` (`ypt::image`); сборка файла и проверка после
//! записи — у вызывающего.

use super::image::{
    Frame, Image, EFFECT_NAME, PARTICLE_NAME, PROP_BYTES, PROP_HASH, ROOT_EFFECTS, ROOT_PARTICLES,
    ROOT_TEXTURES, TEXTURE_NAME,
};
use super::names::hash_name;
use crate::error::{Error, Result};

/// Дальность «вблизи следа нет», метры от камеры; числа уже приведены к `f32`, как их берёт помощник.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NearHide {
    pub from: f32,
    pub to: f32,
}

/// Одна правка правила частицы следа (поля `YptRulePatch`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RulePatch {
    pub rule: String,
    pub width: Option<f64>,
    pub length: Option<f64>,
    pub neutral_colour: bool,
    pub near_hide: Option<NearHide>,
}

/// Размер спрайта, как его читают правила следа: ширина и длина в метрах.
#[derive(Debug, Clone, PartialEq)]
pub struct Shape {
    pub width: f64,
    pub length: f64,
    pub proportional: bool,
    pub keyframes: usize,
}

/// Что вышло из одной правки: числа для ответа и то, что надо сверить после записи.
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub rule: String,
    pub before_width: f64,
    pub before_length: f64,
    pub width: f64,
    pub length: f64,
    pub proportional: bool,
    pub keyframes: usize,
    pub neutral_frames: usize,
    pub near_hide_emitters: usize,
    pub near_from: f32,
    pub near_to: f32,
}

/// Хеш типа поведения размера и цвета.
const SIZE_BEHAVIOUR: u32 = 0x38B6_0240;
const COLOUR_BEHAVIOUR: u32 = 0x164A_EA72;
/// Списки поведений правила частицы: все, начальные, обновление, завершение обновления, рисование.
const BEHAVIOUR_LISTS: [usize; 5] = [0x128, 0x138, 0x148, 0x158, 0x168];
const BEHAVIOUR_TYPE: usize = 8;
/// Свойства поведения размера и цвета на фиксированных местах.
const WHD_MIN: usize = 0x30;
const WHD_MAX: usize = 0xC0;
const TBLR_SCALAR: usize = 0x150;
const IS_PROPORTIONAL: usize = 0x274;
const RGBA_MIN: usize = 0x30;
const RGBA_MAX: usize = 0xC0;
/// Переменные шейдера: список, селектор, имя листа; размеры листа.
const SHADER_VARS: usize = 0x1F0;
const SHADER_VAR_KIND: usize = 0x14;
const SHADER_VAR_TEXTURE: u8 = 6;
const SHADER_VAR_TEXTURE_NAME: usize = 0x30;
const TEXTURE_WIDTH: usize = 0x50;
const TEXTURE_HEIGHT: usize = 0x52;
/// Правило эффекта: события, дальности эволюции LOD.
const EFFECT_EVENTS: usize = 0x38;
const LOD_MIN: usize = 0xAC;
const LOD_MAX: usize = 0xB0;
/// Событие: список эволюций и правило эмиттера; свойства эмиттера лежат подряд.
const EVENT_EVOLUTIONS: usize = 0x18;
const EVENT_EMITTER: usize = 0x40;
const EMITTER_PROPS: usize = 0x78;
const EMITTER_PROP_COUNT: usize = 10;
/// Список эволюций: свойства (шаг 0x18: набор кадров, хеш имени) и наборы кадров (шаг 0x30, признак LOD).
const EVOLUTION_PROPS: usize = 0x10;
const EVOLUTION_PROP_STRIDE: usize = 0x18;
const EVOLUTION_PROP_HASH: usize = 0x10;
const FRAME_SET_STRIDE: usize = 0x30;
const FRAME_SET_IS_LOD: usize = 0x24;

fn size_scalar_hash() -> u32 {
    hash_name("ptxEmitterRule:m_sizeScalarKFP")
}

fn broken(text: String) -> Error {
    Error::broken(text)
}

/// Правило частицы по имени (без учёта регистра); словарь частиц обязан быть.
fn particle_rule(image: &Image, name: &str) -> Result<usize> {
    let rules = image
        .dictionary(ROOT_PARTICLES)
        .ok_or_else(|| broken("YPT particle rule dictionary is missing.".to_owned()))?;
    image
        .single_named(&rules, PARTICLE_NAME, name)?
        .ok_or_else(|| broken(format!("YPT particle rule does not exist: {name}")))
}

/// Поведения правила частицы без повторов, в порядке списков.
fn behaviours(image: &Image, particle: usize) -> Vec<usize> {
    let mut seen = Vec::new();
    for list in BEHAVIOUR_LISTS {
        let Ok(list) = image.list(particle + list) else {
            continue;
        };
        for object in image.objects(list) {
            if !seen.contains(&object) {
                seen.push(object);
            }
        }
    }
    seen
}

/// Поведения нужного типа у правила частицы.
fn behaviours_of(image: &Image, particle: usize, kind: u32) -> Vec<usize> {
    behaviours(image, particle)
        .into_iter()
        .filter(|&at| {
            image
                .u32(at + BEHAVIOUR_TYPE)
                .is_ok_and(|hash| hash == kind)
        })
        .collect()
}

/// Пропорция листа правила (высота / ширина); 2 — если листа нет или у него нет размера.
fn texture_aspect(image: &Image, particle: usize) -> f64 {
    let variables = image
        .list(particle + SHADER_VARS)
        .map(|list| image.objects(list))
        .unwrap_or_default();
    let wanted = variables
        .into_iter()
        .filter(|&at| {
            image
                .u8(at + SHADER_VAR_KIND)
                .is_ok_and(|kind| kind == SHADER_VAR_TEXTURE)
        })
        .find_map(|at| image.name(at + SHADER_VAR_TEXTURE_NAME));
    let textures = image.dictionary(ROOT_TEXTURES).unwrap_or_default();
    let found = wanted.and_then(|name| image.first_named(&textures, TEXTURE_NAME, &name));
    match found {
        Some(texture) => {
            let width = image.u16(texture + TEXTURE_WIDTH).unwrap_or(0);
            let height = image.u16(texture + TEXTURE_HEIGHT).unwrap_or(0);
            if width > 0 && height > 0 {
                f64::from(height) / f64::from(width)
            } else {
                2.0
            }
        }
        None => 2.0,
    }
}

fn largest(frames: &[Frame], axis: usize) -> f64 {
    frames
        .iter()
        .map(|frame| f64::from(frame.value[axis]))
        .fold(f64::NEG_INFINITY, f64::max)
}

/// Размер спрайта и поведения размера правила.
fn read(image: &Image, name: &str) -> Result<(Shape, Vec<usize>)> {
    let particle = particle_rule(image, name)?;
    let sizes = behaviours_of(image, particle, SIZE_BEHAVIOUR);
    let Some(&first) = sizes.first() else {
        return Err(broken(format!(
            "YPT particle rule has no size behaviour: {name}"
        )));
    };
    let widest = image.frames(first + WHD_MAX)?;
    let whd = if widest.is_empty() {
        image.frames(first + WHD_MIN)?
    } else {
        widest
    };
    let tblr = image.frames(first + TBLR_SCALAR)?;
    if whd.is_empty() || tblr.is_empty() {
        return Err(broken(format!(
            "YPT particle rule has no size keyframes: {name}"
        )));
    }
    let width_base = largest(&whd, 0);
    let proportional = image.u8(first + IS_PROPORTIONAL)? != 0;
    let length_base = if proportional {
        width_base * texture_aspect(image, particle)
    } else {
        largest(&whd, 1)
    };
    let edges = tblr[0].value;
    let shape = Shape {
        width: width_base * f64::from(edges[2] + edges[3]),
        length: length_base * f64::from(edges[0] + edges[1]),
        proportional,
        keyframes: tblr.len(),
    };
    Ok((shape, sizes))
}

/// Размер спрайта правила `name` в образе.
pub fn read_shape(image: &Image, name: &str) -> Result<Shape> {
    read(image, name).map(|(shape, _)| shape)
}

/// Кадры цвета правила белеют: RGB — единица, прозрачность не меняется. Возвращает число кадров.
fn neutralise(image: &mut Image, name: &str) -> Result<usize> {
    let particle = particle_rule(image, name)?;
    let colours = behaviours_of(image, particle, COLOUR_BEHAVIOUR);
    if colours.is_empty() {
        return Err(broken(format!(
            "YPT tracer rule has no colour behaviour: {name}"
        )));
    }
    let mut changed = 0;
    for colour in colours {
        for prop in [colour + RGBA_MIN, colour + RGBA_MAX] {
            for (k, frame) in image.frames(prop)?.iter().enumerate() {
                image.set_value(prop, k, [1.0, 1.0, 1.0, frame.value[3]])?;
                changed += 1;
            }
        }
    }
    if changed == 0 {
        return Err(broken(format!(
            "YPT tracer rule has no colour keyframes: {name}"
        )));
    }
    Ok(changed)
}

/// Все ли кадры цвета правила белые (сверка после записи).
fn colour_is_neutral(image: &Image, name: &str) -> Result<bool> {
    let particle = particle_rule(image, name)?;
    for colour in behaviours_of(image, particle, COLOUR_BEHAVIOUR) {
        for prop in [colour + RGBA_MIN, colour + RGBA_MAX] {
            let white = image
                .frames(prop)?
                .iter()
                .all(|frame| frame.value[..3].iter().all(|x| (x - 1.0).abs() < 1e-4));
            if !white {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// Заголовок списка кадров эволюции LOD названного свойства у события; нет — `None`.
fn lod_keyframes(image: &Image, event: usize, hash: u32) -> Result<Option<usize>> {
    let Some(list) = image.pointer(event + EVENT_EVOLUTIONS) else {
        return Ok(None);
    };
    let props = image.list(list + EVOLUTION_PROPS)?;
    let Some(array) = props.array else {
        return Ok(None);
    };
    for k in 0..props.count {
        let prop = array + k * EVOLUTION_PROP_STRIDE;
        if image.u32(prop + EVOLUTION_PROP_HASH)? != hash {
            continue;
        }
        let sets = image.list(prop)?;
        let Some(first) = sets.array else {
            continue;
        };
        for j in 0..sets.count {
            let set = first + j * FRAME_SET_STRIDE;
            if image.u8(set + FRAME_SET_IS_LOD)? != 0 {
                return Ok(Some(set));
            }
        }
    }
    Ok(None)
}

/// Свойство размера эмиттера (первое с таким хешем среди встроенных).
fn size_scalar(image: &Image, emitter: usize) -> Option<usize> {
    let hash = size_scalar_hash();
    (0..EMITTER_PROP_COUNT)
        .map(|k| emitter + EMITTER_PROPS + k * PROP_BYTES)
        .find(|&prop| image.u32(prop + PROP_HASH).is_ok_and(|have| have == hash))
}

fn effect_rule(image: &Image, name: &str) -> Result<Option<usize>> {
    let rules = image.dictionary(ROOT_EFFECTS).unwrap_or_default();
    image.single_named(&rules, EFFECT_NAME, name)
}

/// События правила эффекта (первые `count`, пустые указатели опущены).
fn events(image: &Image, effect: usize) -> Result<Vec<usize>> {
    Ok(image.objects(image.list(effect + EFFECT_EVENTS)?))
}

/// «Вблизи следа нет»: базовые кадры размера эмиттера — ноль, кадры LOD — сто процентов, дальность LOD
/// правила — от `from` до `to`. Возвращает число затронутых событий.
fn hide_near(image: &mut Image, name: &str, from: f32, to: f32) -> Result<usize> {
    if !(from >= 0.5 && from < to && to <= 100.0) {
        return Err(broken(format!(
            "YPT tracer near-hide distances are out of range: {name}"
        )));
    }
    let effect = effect_rule(image, name)?
        .ok_or_else(|| broken(format!("YPT effect rule does not exist: {name}")))?;
    let mut touched = 0;
    for event in events(image, effect)? {
        let Some(emitter) = image.pointer(event + EVENT_EMITTER) else {
            continue;
        };
        let size = size_scalar(image, emitter)
            .ok_or_else(|| broken(format!("YPT tracer emitter has no size scalar: {name}")))?;
        let lod = lod_keyframes(image, event, size_scalar_hash())?.ok_or_else(|| {
            broken(format!(
                "YPT tracer event has no LOD size evolution: {name}"
            ))
        })?;
        image.replace_frames_in(
            lod,
            &[Frame {
                time: [0.0; 4],
                value: [100.0, 100.0, 100.0, 0.0],
            }],
        )?;
        image.replace_frames(
            size,
            &[Frame {
                time: [0.0; 4],
                value: [0.0, 0.0, 0.0, 100.0],
            }],
        )?;
        touched += 1;
    }
    if touched == 0 {
        return Err(broken(format!("YPT tracer has no emitter to hide: {name}")));
    }
    image.set_f32(effect + LOD_MIN, from)?;
    image.set_f32(effect + LOD_MAX, to)?;
    Ok(touched)
}

/// Пережило ли сохранение «вблизи следа нет» (сверка после записи).
fn hidden_near(image: &Image, name: &str, from: f32, to: f32) -> Result<bool> {
    let Some(effect) = effect_rule(image, name)? else {
        return Ok(false);
    };
    if (image.f32(effect + LOD_MIN)? - from).abs() > 1e-3
        || (image.f32(effect + LOD_MAX)? - to).abs() > 1e-3
    {
        return Ok(false);
    }
    for event in events(image, effect)? {
        let Some(emitter) = image.pointer(event + EVENT_EMITTER) else {
            continue;
        };
        let near = match size_scalar(image, emitter) {
            Some(size) => image.frames(size)?,
            None => Vec::new(),
        };
        if near.is_empty()
            || near
                .iter()
                .any(|frame| frame.value[..3].iter().any(|&x| x != 0.0))
        {
            return Ok(false);
        }
        let far = match lod_keyframes(image, event, size_scalar_hash())? {
            Some(set) => image.frames_in(set)?,
            None => Vec::new(),
        };
        if far.is_empty()
            || far
                .iter()
                .any(|frame| (frame.value[0] - 100.0).abs() > 1e-3)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Применяет одну правку к образу.
pub fn apply_tracer_shape(image: &mut Image, patch: &RulePatch) -> Result<Report> {
    let name = patch.rule.trim();
    let (current, sizes) = read(image, name)?;
    if current.width <= 0.0 || current.length <= 0.0 {
        return Err(broken(format!(
            "YPT particle rule has a degenerate size: {name}"
        )));
    }
    let target_width = patch.width.unwrap_or(current.width);
    let target_length = patch.length.unwrap_or(current.length);
    if target_width <= 0.0 || target_width > 10.0 || target_length <= 0.0 || target_length > 100.0 {
        return Err(broken(format!("YPT rule shape is out of range: {name}")));
    }
    let width_factor = (target_width / current.width) as f32;
    let length_factor = (target_length / current.length) as f32;
    // Меняются только множители краёв у каждого кадра; число кадров, whd и всё остальное остаются исходными.
    for behaviour in sizes {
        let prop = behaviour + TBLR_SCALAR;
        for (k, frame) in image.frames(prop)?.iter().enumerate() {
            let [x, y, z, w] = frame.value;
            image.set_value(
                prop,
                k,
                [
                    x * length_factor,
                    y * length_factor,
                    z * width_factor,
                    w * width_factor,
                ],
            )?;
        }
    }
    let applied = read_shape(image, name)?;
    let neutral_frames = if patch.neutral_colour {
        neutralise(image, name)?
    } else {
        0
    };
    let (near_from, near_to) = patch
        .near_hide
        .map_or((0.0, 0.0), |near| (near.from, near.to));
    let near_hide_emitters = match patch.near_hide {
        Some(near) => hide_near(image, name, near.from, near.to)?,
        None => 0,
    };
    Ok(Report {
        rule: name.to_owned(),
        before_width: current.width,
        before_length: current.length,
        width: applied.width,
        length: applied.length,
        proportional: applied.proportional,
        keyframes: applied.keyframes,
        neutral_frames,
        near_hide_emitters,
        near_from,
        near_to,
    })
}

fn same_size(actual: f64, expected: f64) -> bool {
    (actual - expected).abs() <= 1e-4 * expected.abs().max(1.0)
}

/// Перечитанный образ хранит то, что записано в отчёте.
pub fn verify_after_save(image: &Image, report: &Report) -> Result<()> {
    let rule = &report.rule;
    let reread = read_shape(image, rule)?;
    if !same_size(reread.width, report.width) || !same_size(reread.length, report.length) {
        return Err(broken(format!(
            "YPT rule shape did not survive the save: {rule}"
        )));
    }
    if report.neutral_frames > 0 && !colour_is_neutral(image, rule)? {
        return Err(broken(format!(
            "YPT rule colour did not survive the save: {rule}"
        )));
    }
    if report.near_hide_emitters > 0 && !hidden_near(image, rule, report.near_from, report.near_to)?
    {
        return Err(broken(format!(
            "YPT rule near-hide did not survive the save: {rule}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::resource::Resource;
    use crate::ypt::fixture::{self, Core};
    use crate::ypt::image::{Frame, Image, KEY_LIST};
    use crate::ypt::rules::effect_positions;

    fn opened() -> (Core, Image) {
        let core = fixture::core(true);
        let image = Image::parse(&core.bytes).unwrap();
        (core, image)
    }

    fn patch(rule: &str, width: Option<f64>, length: Option<f64>) -> RulePatch {
        RulePatch {
            rule: rule.to_owned(),
            width,
            length,
            ..RulePatch::default()
        }
    }

    fn values(image: &Image, prop: usize) -> Vec<[f32; 4]> {
        image
            .frames(prop)
            .unwrap()
            .iter()
            .map(|frame| frame.value)
            .collect()
    }

    /// Свойство, найденное по хешу в списке встроенных свойств поведения (первые `count` по 0x90 от `first`).
    fn tblr(core: &Core) -> usize {
        core.map.size + 0x150
    }

    #[test]
    fn the_size_comes_from_the_widest_frame_the_edges_and_the_sheet_aspect() {
        let (_, image) = opened();
        let shape = read_shape(&image, "tracer").unwrap();
        // ширина = самая большая whd.x × (лево + право); длина = ширина-основа × пропорция листа (256/128) × (верх + низ)
        let base = f64::from(0.2f32);
        assert_eq!(shape.width, base * f64::from(0.5f32 + 0.5f32));
        assert_eq!(shape.length, base * 2.0 * f64::from(1.0f32 + 1.0f32));
        assert!(shape.proportional);
        assert_eq!(shape.keyframes, 2);
        // без листа пропорция по умолчанию — те же 2
        let bare = Image::parse(&fixture::core(false).bytes).unwrap();
        assert_eq!(read_shape(&bare, "TRACER").unwrap(), shape);
    }

    #[test]
    fn a_new_size_scales_every_tblr_frame_and_keeps_the_rest() {
        let (core, mut image) = opened();
        let whd = values(&image, core.map.size + 0xC0);
        let report =
            apply_tracer_shape(&mut image, &patch("tracer", Some(0.4), Some(1.6))).unwrap();
        // множители ровно 2 и 2: лево/право × 2, верх/низ × 2
        assert_eq!(
            values(&image, tblr(&core)),
            vec![[2.0, 2.0, 1.0, 1.0], [4.0, 4.0, 0.5, 0.5]]
        );
        assert_eq!(values(&image, core.map.size + 0xC0), whd);
        assert_eq!(report.rule, "tracer");
        assert_eq!(report.before_width, f64::from(0.2f32));
        assert_eq!(report.width, f64::from(0.2f32) * 2.0);
        assert_eq!(report.keyframes, 2);
        assert!(report.proportional);
        assert_eq!((report.neutral_frames, report.near_hide_emitters), (0, 0));
    }

    #[test]
    fn a_missing_axis_stays_as_it_was() {
        let (core, mut image) = opened();
        apply_tracer_shape(&mut image, &patch("tracer", Some(0.4), None)).unwrap();
        // длина не менялась: верх и низ те же, лево и право вдвое
        assert_eq!(
            values(&image, tblr(&core)),
            vec![[1.0, 1.0, 1.0, 1.0], [2.0, 2.0, 0.5, 0.5]]
        );
    }

    #[test]
    fn sizes_out_of_range_and_unknown_rules_are_refused_with_the_helper_words() {
        let (_, mut image) = opened();
        let refused =
            |image: &mut Image, rule: RulePatch| apply_tracer_shape(image, &rule).unwrap_err();
        for bad in [(0.0, 1.0), (10.5, 1.0), (1.0, 100.5), (1.0, -1.0)] {
            let error = refused(&mut image, patch("tracer", Some(bad.0), Some(bad.1)));
            assert_eq!(error.message, "YPT rule shape is out of range: tracer");
        }
        let error = refused(&mut image, patch("nope", Some(1.0), None));
        assert_eq!(error.message, "YPT particle rule does not exist: nope");
        // на границах — можно
        apply_tracer_shape(&mut image, &patch("tracer", Some(10.0), Some(100.0))).unwrap();
    }

    #[test]
    fn a_rule_without_a_size_behaviour_is_refused() {
        let (core, mut image) = opened();
        // поведение размера становится возрастом: размера у правила нет
        let at = core.map.size + 8;
        image.set_f32(at, f32::from_bits(0xF5B3_3BAA)).unwrap();
        let error = apply_tracer_shape(&mut image, &patch("tracer", Some(1.0), None)).unwrap_err();
        assert_eq!(
            error.message,
            "YPT particle rule has no size behaviour: tracer"
        );
    }

    #[test]
    fn neutral_colour_whitens_rgb_and_keeps_the_alpha() {
        let (core, mut image) = opened();
        let mut rule = patch("tracer", None, None);
        rule.neutral_colour = true;
        let report = apply_tracer_shape(&mut image, &rule).unwrap();
        assert_eq!(report.neutral_frames, 3);
        assert_eq!(
            values(&image, core.map.colour + 0x30),
            vec![[1.0, 1.0, 1.0, 0.5], [1.0, 1.0, 1.0, 0.0]]
        );
        assert_eq!(
            values(&image, core.map.colour + 0xC0),
            vec![[1.0, 1.0, 1.0, 1.0]]
        );
    }

    #[test]
    fn near_hide_zeroes_the_close_size_and_raises_the_far_one() {
        let (core, mut image) = opened();
        let mut rule = patch("tracer", None, None);
        rule.near_hide = Some(NearHide { from: 2.0, to: 8.0 });
        let report = apply_tracer_shape(&mut image, &rule).unwrap();
        assert_eq!(report.near_hide_emitters, 1);
        assert_eq!((report.near_from, report.near_to), (2.0, 8.0));
        let size = core.map.emitter + 0x78;
        let frames = image.frames(size).unwrap();
        assert_eq!(frames.len(), 1);
        assert!(frames[0].same(&Frame {
            time: [0.0; 4],
            value: [0.0, 0.0, 0.0, 100.0]
        }));
        // кадры эволюции LOD события: один кадр (100, 100, 100, 0)
        let lod_keys = core.map.evolution_frames + 0x30;
        let list = image.list(lod_keys).unwrap();
        assert_eq!(list.count, 1);
        let at = list.array.unwrap();
        assert_eq!(image.f32(at + 0x10).unwrap(), 100.0);
        assert_eq!(image.f32(at + 0x1C).unwrap(), 0.0);
        // дальности правила эффекта
        assert_eq!(image.f32(core.map.effect + 0xAC).unwrap(), 2.0);
        assert_eq!(image.f32(core.map.effect + 0xB0).unwrap(), 8.0);
        // не-LOD набор кадров не тронут
        assert_eq!(image.list(core.map.evolution_frames).unwrap().count, 2);
    }

    #[test]
    fn near_hide_distances_are_checked_first() {
        let (_, mut image) = opened();
        for (from, to) in [(0.4, 8.0), (8.0, 8.0), (9.0, 8.0), (2.0, 100.5)] {
            let mut rule = patch("tracer", None, None);
            rule.near_hide = Some(NearHide { from, to });
            let error = apply_tracer_shape(&mut image, &rule).unwrap_err();
            assert_eq!(
                error.message,
                "YPT tracer near-hide distances are out of range: tracer"
            );
        }
    }

    #[test]
    fn everything_survives_the_save_and_the_check_after_it_passes() {
        let (_, mut image) = opened();
        let mut rule = patch("tracer", Some(0.4), Some(1.6));
        rule.neutral_colour = true;
        rule.near_hide = Some(NearHide { from: 1.0, to: 6.0 });
        let report = apply_tracer_shape(&mut image, &rule).unwrap();
        let file = image.into_file().unwrap();
        let reread = Image::parse(&file).unwrap();
        verify_after_save(&reread, &report).unwrap();
        // другой размер — проверка отказывает тем же словом, что у помощника
        let mut wrong = report.clone();
        wrong.width *= 1.5;
        let error = verify_after_save(&reread, &wrong).unwrap_err();
        assert_eq!(
            error.message,
            "YPT rule shape did not survive the save: tracer"
        );
        assert_eq!(error.kind, Kind::Broken);
        // правило нашлось и после пересборки (адреса сдвинулись, имя осталось)
        assert!(effect_positions(&Resource::parse(&file).unwrap())
            .unwrap()
            .contains_key("tracer"));
        let _ = KEY_LIST;
    }
}
