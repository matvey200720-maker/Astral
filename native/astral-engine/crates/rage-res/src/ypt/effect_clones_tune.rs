//! Настройка слоя клона эффекта: цвет, радуга, части, свечение, густота, масштабы, кадры свойств, прицел.
//!
//! Порядок шагов и числа — как у помощника (`ApplyTune`): все умножения идут во float, значения заказа приходят
//! десятичными и переводятся во float один раз.

use std::collections::HashMap;

use super::clone_kit::{
    self as kit, Key, TYPE_COLOUR, TYPE_LIGHT, TYPE_ZCULL,
};
use super::effect_clones::{donor_name, CloneAim, CloneKeyframes, CloneTune};
use super::structure::Structure;
use crate::error::{Error, Result};

/// Что настройка делает со слоем: правило копии, события, эмиттеры, частицы и имена частиц донора.
pub struct Layer<'a> {
    pub effect: usize,
    pub events: &'a [usize],
    pub emitters: &'a [usize],
    pub particles: &'a [usize],
    pub donor_names: &'a HashMap<usize, String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TuneReport {
    pub recoloured: usize,
    pub spawn: usize,
    pub replaced: usize,
    pub scaled: usize,
}

const ZCULL_UNDER_REFERENCE: u32 = 0;
const ZCULL_OVER_REFERENCE: u32 = 1;
const ZCULL_SPACE_WATER: u32 = 3;
const RAINBOW_STEPS: usize = 8;
const MAX_KEYFRAMES: usize = 16;
pub const COLOUR_MODES: [&str; 3] = ["recolour", "duo", "rainbow"];

const SPAWN_RATE: &str = "ptxEmitterRule:m_spawnRateOverTimeKFP";
const EMISSIVE: &str = "ptxu_Colour:m_emissiveIntensityKFP";
const RGBA_MIN: &str = "ptxu_Colour:m_rgbaMinKFP";
const RGBA_MAX: &str = "ptxu_Colour:m_rgbaMaxKFP";
const ZOOM_SCALAR: &str = "ptxEffectRule:m_zoomScalarKFP";
/// Свойства в процентах по осям X, Y, Z; W у них — сотня.
const PERCENT_PROPS: [&str; 4] = [
    "ptxEmitterRule:m_accnScalarKFP",
    "ptxEmitterRule:m_dampeningScalarKFP",
    "ptxEmitterRule:m_sizeScalarKFP",
    "ptxEmitterRule:m_matrixWeightScalarKFP",
];

fn broken(text: String) -> Error {
    Error::broken(text)
}

/// Десятичное число так, как его пишет `decimal.ToString()` для значений без хвостовых нулей.
pub fn decimal_text(value: f64) -> String {
    format!("{value}")
}

/// `Bounded`: значение в пределах включительно, иначе отказ; результат — float.
pub fn bounded(value: f64, min: f64, max: f64, what: &str, effect: &str) -> Result<f32> {
    if value < min || value > max {
        return Err(broken(format!(
            "YPT clone {what} is out of range for {effect}: {}",
            decimal_text(value)
        )));
    }
    Ok(value as f32)
}

/// `Math.Min` для float: NaN в любом из двух даёт NaN.
fn min_f(a: f32, b: f32) -> f32 {
    if a.is_nan() || b.is_nan() {
        f32::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

fn max_f(a: f32, b: f32) -> f32 {
    if a.is_nan() || b.is_nan() {
        f32::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

/// `Math.Clamp` для float.
fn clamp(value: f32, low: f32, high: f32) -> f32 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}

/// Перекраска кадров: тон и насыщенность — от цвета, яркость — старший канал кадра; прозрачность — множитель.
pub fn repaint(
    s: &mut Structure,
    header: usize,
    colour: Option<[f32; 3]>,
    alpha: Option<f32>,
) -> Result<usize> {
    kit::map_values(s, header, &mut |value| {
        let (mut red, mut green, mut blue) = (value[0], value[1], value[2]);
        if let Some(colour) = colour {
            let intensity = max_f(value[0], max_f(value[1], value[2]));
            red = clamp(colour[0] * intensity, 0.0, 1.0);
            green = clamp(colour[1] * intensity, 0.0, 1.0);
            blue = clamp(colour[2] * intensity, 0.0, 1.0);
        }
        let opacity = match alpha {
            Some(scale) => clamp(value[3] * scale, 0.0, 1.0),
            None => value[3],
        };
        [red, green, blue, opacity]
    })
}

/// Значение кадров в момент `time`: линейно между соседями (кадры упорядочены по времени, равные — как были).
fn sample(ordered: &[Key], time: f32) -> [f32; 4] {
    if time <= ordered[0].time[0] {
        return ordered[0].value;
    }
    for index in 1..ordered.len() {
        let next = &ordered[index];
        if time > next.time[0] {
            continue;
        }
        let previous = &ordered[index - 1];
        let span = next.time[0] - previous.time[0];
        let amount = if span > 1e-6 {
            (time - previous.time[0]) / span
        } else {
            1.0
        };
        // Как `Vector4.Lerp` у помощника: (1 − доля) · начало + доля · конец.
        let mix = |a: f32, b: f32| (1.0 - amount) * a + amount * b;
        let (a, b) = (previous.value, next.value);
        return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2]), mix(a[3], b[3])];
    }
    ordered[ordered.len() - 1].value
}

/// Чистый тон радуги с яркостью `value` (насыщенность полная).
fn hue(hue: f32, value: f32) -> (f32, f32, f32) {
    let sector = hue * 6.0;
    let floor = sector.floor();
    let index = (floor as i32) % 6;
    let fraction = sector - floor;
    let rising = value * fraction;
    let falling = value * (1.0 - fraction);
    match index {
        0 => (value, rising, 0.0),
        1 => (falling, value, 0.0),
        2 => (0.0, value, rising),
        3 => (0.0, falling, value),
        4 => (rising, 0.0, value),
        _ => (value, 0.0, falling),
    }
}

/// Кадры из пар «время — значение» с обратными длинами отрезков.
pub fn build_keys(frames: &[(f32, [f32; 4])], label: &str) -> Result<Vec<Key>> {
    let mut previous = -1.0f32;
    frames
        .iter()
        .enumerate()
        .map(|(index, &(time, value))| {
            if time < 0.0 || time > 1.0 || time <= previous {
                return Err(broken(format!(
                    "YPT clone keyframe times must rise within 0…1: {label}"
                )));
            }
            let key = Key {
                time: [time, if index == 0 { 0.0 } else { 1.0 / (time - previous) }, 0.0, 0.0],
                value,
            };
            previous = time;
            Ok(key)
        })
        .collect()
}

/// Радуга по кадрам списка: тон бежит по кругу за жизнь частицы, яркость и прозрачность — от кадров донора.
pub fn rainbow_list(
    s: &mut Structure,
    header: usize,
    offset: f32,
    alpha: Option<f32>,
    label: &str,
) -> Result<usize> {
    let mut source = kit::read_keys(s, header)?;
    if source.is_empty() {
        return Ok(0);
    }
    source.sort_by(|a, b| a.time[0].partial_cmp(&b.time[0]).unwrap_or(std::cmp::Ordering::Equal));
    let mut frames = Vec::with_capacity(RAINBOW_STEPS);
    for step in 0..RAINBOW_STEPS {
        let time = step as f32 / (RAINBOW_STEPS - 1) as f32;
        let sampled = sample(&source, time);
        let intensity = max_f(sampled[0], max_f(sampled[1], sampled[2]));
        let opacity = match alpha {
            Some(scale) => clamp(sampled[3] * scale, 0.0, 1.0),
            None => sampled[3],
        };
        let (red, green, blue) = hue((time + offset) % 1.0, intensity);
        frames.push((time, [red, green, blue, opacity]));
    }
    let keys = build_keys(&frames, label)?;
    kit::put_keys(s, header, &keys)?;
    Ok(keys.len())
}

/// Замена кадров свойства: `[время, x, y, z, w]`, времена растут от нуля.
pub fn set_keyframes(
    s: &mut Structure,
    prop: usize,
    values: &[Vec<f64>],
    effect: &str,
) -> Result<()> {
    let mut keys = Vec::with_capacity(values.len());
    let mut previous = -1.0f32;
    for (index, row) in values.iter().enumerate() {
        if row.len() != 5 {
            return Err(broken(format!(
                "YPT clone keyframe must be [time, x, y, z, w]: {effect}"
            )));
        }
        let time = row[0] as f32;
        if time < 0.0 || time > 1.0 || time <= previous {
            return Err(broken(format!(
                "YPT clone keyframe times must rise within 0…1: {effect}"
            )));
        }
        if index == 0 && time != 0.0 {
            return Err(broken(format!(
                "YPT clone keyframes must start at zero: {effect}"
            )));
        }
        if row.iter().any(|&number| !(-100_000.0..=100_000.0).contains(&number)) {
            return Err(broken(format!(
                "YPT clone keyframe value is out of range: {effect}"
            )));
        }
        keys.push(Key {
            time: [time, if index == 0 { 0.0 } else { 1.0 / (time - previous) }, 0.0, 0.0],
            value: [row[1] as f32, row[2] as f32, row[3] as f32, row[4] as f32],
        });
        previous = time;
    }
    kit::put_keys(s, prop + 0x70, &keys)
}

/// Поворот точки прицела: отклонить на `pitch` от собственной оси и провернуть отклонение на `yaw` вокруг неё.
fn aim_domain(s: &mut Structure, header: usize, yaw: f64, pitch: f64) -> Result<usize> {
    let yaw_rad = yaw * std::f64::consts::PI / 180.0;
    let pitch_rad = pitch * std::f64::consts::PI / 180.0;
    let len = |v: [f32; 3]| ((v[0] * v[0]) + (v[1] * v[1]) + (v[2] * v[2])).sqrt_as_double();
    let cross = |l: [f32; 3], r: [f32; 3]| {
        [
            (l[1] * r[2]) - (l[2] * r[1]),
            (l[2] * r[0]) - (l[0] * r[2]),
            (l[0] * r[1]) - (l[1] * r[0]),
        ]
    };
    let mut count = 0;
    kit::map_values(s, header, &mut |value| {
        let mut axis = [value[0], value[1], value[2]];
        let length = len(axis);
        // Вектор нулевой длины оси не задаёт: поворачивать нечего.
        if length < 1e-5 {
            return value;
        }
        axis = [axis[0] / length, axis[1] / length, axis[2] / length];
        let seed = if axis[2].abs() < 0.9 {
            [0.0, 0.0, 1.0]
        } else {
            [1.0, 0.0, 0.0]
        };
        let mut right = cross(axis, seed);
        let right_length = len(right);
        if right_length > 1e-6 {
            let inverse = 1.0f32 / right_length;
            right = [right[0] * inverse, right[1] * inverse, right[2] * inverse];
        }
        let up = cross(axis, right);
        let tilt = pitch_rad.sin() as f32;
        let forward = pitch_rad.cos() as f32;
        let side = (yaw_rad.cos() as f32) * tilt;
        let lift = (yaw_rad.sin() as f32) * tilt;
        let turned = [
            (axis[0] * forward + right[0] * side + up[0] * lift) * length,
            (axis[1] * forward + right[1] * side + up[1] * lift) * length,
            (axis[2] * forward + right[2] * side + up[2] * lift) * length,
        ];
        count += 1;
        [turned[0], turned[1], turned[2], value[3]]
    })?;
    Ok(count)
}

trait SqrtAsDouble {
    fn sqrt_as_double(self) -> f32;
}

impl SqrtAsDouble for f32 {
    /// `(float)Math.Sqrt(x)`: корень берётся в двойной точности.
    fn sqrt_as_double(self) -> f32 {
        f64::from(self).sqrt() as f32
    }
}

fn is_colour_prop(hash: u32) -> bool {
    hash == kit::prop_hash(RGBA_MIN) || hash == kit::prop_hash(RGBA_MAX)
}

/// Цвет из заказа: три канала, каждый в пределах `0…4`.
fn channels(values: &[f64], what: &str, effect: &str) -> Result<[f32; 3]> {
    Ok([
        bounded(values[0], 0.0, 4.0, what, effect)?,
        bounded(values[1], 0.0, 4.0, what, effect)?,
        bounded(values[2], 0.0, 4.0, what, effect)?,
    ])
}

/// Наборы кадров эволюций событий слоя, у свойства которых имя из `wanted` (хеши); заголовки списков кадров.
fn evolved_lists(s: &Structure, events: &[usize], wanted: &dyn Fn(u32) -> bool) -> Result<Vec<(u32, usize)>> {
    let mut found = Vec::new();
    for &event in events {
        let Some(list) = s.pointer(event + kit::EVENT_EVOLUTIONS) else {
            continue;
        };
        for (hash, frames) in kit::evolved_frames(s, list)? {
            if wanted(hash) {
                found.extend(frames.into_iter().map(|entry| (hash, entry)));
            }
        }
    }
    Ok(found)
}

pub fn apply_tune(
    s: &mut Structure,
    layer: &Layer,
    tune: Option<&CloneTune>,
    label: &str,
) -> Result<TuneReport> {
    let Some(tune) = tune else {
        return Ok(TuneReport::default());
    };
    let mut report = TuneReport::default();
    let effect = layer.effect;

    if let Some(value) = tune.max_duration {
        let limit = bounded(value, 0.05, 30.0, "maxDuration", label)?;
        for at in [kit::EFFECT_DURATION_MIN, kit::EFFECT_DURATION_MAX] {
            let current = s.f32(effect + at)?;
            s.put_f32(effect + at, min_f(current, limit))?;
        }
    }
    if let Some(value) = tune.cull_dist {
        let wanted = bounded(value, 5.0, 1000.0, "cullDist", label)?;
        let current = s.f32(effect + kit::EFFECT_CULL_DIST)?;
        s.put_f32(effect + kit::EFFECT_CULL_DIST, max_f(current, wanted))?;
    }
    if let Some(value) = tune.cull_fade {
        let wanted = bounded(value, 5.0, 1000.0, "cullFade", label)?;
        let cull = s.f32(effect + kit::EFFECT_CULL_DIST)?;
        let fade = s.f32(effect + kit::EFFECT_CULL_FADE)?;
        s.put_f32(effect + kit::EFFECT_CULL_FADE, min_f(cull, max_f(fade, wanted)))?;
    }

    if let Some(value) = tune.effect_zoom {
        let zoom = bounded(value, 1.0, 1000.0, "effectZoom", label)?;
        let props = kit::with_hash(s, &kit::effect_props(effect), kit::prop_hash(ZOOM_SCALAR))?;
        let header = props.first().map(|&prop| prop + 0x70);
        let keys = match header {
            Some(header) => kit::read_keys(s, header)?,
            None => Vec::new(),
        };
        if keys.is_empty() {
            return Err(broken(format!(
                "YPT clone {label} has no rule zoom keyframes to set."
            )));
        }
        kit::map_values(s, header.unwrap_or_default(), &mut |v| [zoom, zoom, v[2], v[3]])?;
    }

    if let Some(value) = tune.zoom_scale {
        let factor = bounded(value, 0.05, 8.0, "zoomScale", label)?;
        for &event in layer.events {
            for at in [kit::EVENT_ZOOM_MIN, kit::EVENT_ZOOM_MAX] {
                let current = s.f32(event + at)?;
                s.put_f32(event + at, current * factor)?;
            }
        }
    }

    if let Some(one_shot) = tune.one_shot {
        for &emitter in layer.emitters {
            s.put_u8(emitter + kit::EMITTER_ONE_SHOT, u8::from(one_shot))?;
        }
    }

    if tune.open_air == Some(true) {
        for &particle in layer.particles {
            for behaviour in kit::behaviours(s, particle)? {
                if kit::behaviour_type(s, behaviour)? != TYPE_ZCULL {
                    continue;
                }
                if s.u32(behaviour + kit::ZCULL_MODE)? == ZCULL_OVER_REFERENCE
                    && s.u32(behaviour + kit::ZCULL_SPACE)? == ZCULL_SPACE_WATER
                {
                    s.put_u32(behaviour + kit::ZCULL_MODE, ZCULL_UNDER_REFERENCE)?;
                }
            }
        }
    }

    if let Some(value) = tune.spawn_scale {
        let factor = bounded(value, 0.1, 8.0, "spawnScale", label)?;
        let spawn_hash = kit::prop_hash(SPAWN_RATE);
        for &emitter in layer.emitters {
            for prop in kit::with_hash(s, &kit::emitter_props(emitter), spawn_hash)? {
                report.spawn += kit::scale_xy(s, prop + 0x70, factor)?;
            }
        }
        // Эволюции подменяют кадры густоты своими: без них «вдвое гуще» действовало бы только вблизи.
        for (_, header) in evolved_lists(s, layer.events, &|hash| hash == spawn_hash)? {
            report.spawn += kit::scale_xy(s, header, factor)?;
        }
    }

    // Цвет.
    let colour = match &tune.colour {
        Some(values) if values.len() == 3 => Some(channels(values, "colour", label)?),
        _ => None,
    };
    if tune.colour.is_some() && colour.is_none() {
        return Err(broken(format!(
            "YPT clone colour must have three channels: {label}"
        )));
    }
    let mode = tune.colour_mode.as_deref().unwrap_or("recolour");
    if !COLOUR_MODES.contains(&mode) {
        return Err(broken(format!(
            "YPT clone colour mode is not supported: {}",
            tune.colour_mode.as_deref().unwrap_or_default()
        )));
    }
    let colour2 = match &tune.colour2 {
        Some(values) if values.len() == 3 => Some(channels(values, "colour2", label)?),
        _ => None,
    };
    if tune.colour2.is_some() && colour2.is_none() {
        return Err(broken(format!(
            "YPT clone second colour must have three channels: {label}"
        )));
    }
    if mode == "duo" && (colour.is_none() || colour2.is_none()) {
        return Err(broken(format!(
            "YPT clone colour mode duo needs two colours: {label}"
        )));
    }
    if mode == "rainbow" && colour.is_none() {
        return Err(broken(format!(
            "YPT clone colour mode rainbow needs a colour: {label}"
        )));
    }
    let alpha = match tune.alpha_scale {
        Some(value) => Some(bounded(value, 0.05, 4.0, "alphaScale", label)?),
        None => None,
    };
    if colour.is_some() || alpha.is_some() {
        // Верхние кадры цвета: второй цвет режима «два цвета», иначе тот же.
        let upper = if mode == "duo" { colour2 } else { colour };
        // Свет от искр и вспышек красится вместе с ними; радуге свет — белый.
        let light_colour = if mode == "rainbow" { Some([1.0, 1.0, 1.0]) } else { colour };
        for &particle in layer.particles {
            for behaviour in kit::behaviours(s, particle)? {
                let kind = kit::behaviour_type(s, behaviour)?;
                if kind == TYPE_COLOUR {
                    let (min, max) = (
                        behaviour + kit::COLOUR_RGBA_MIN + 0x70,
                        behaviour + kit::COLOUR_RGBA_MAX + 0x70,
                    );
                    report.recoloured += if mode == "rainbow" {
                        rainbow_list(s, min, 0.0, alpha, label)? + rainbow_list(s, max, 0.5, alpha, label)?
                    } else {
                        repaint(s, min, colour, alpha)? + repaint(s, max, upper, alpha)?
                    };
                } else if kind == TYPE_LIGHT {
                    if let Some(light) = light_colour {
                        for at in kit::LIGHT_COLOUR_PROPS {
                            report.recoloured += repaint(s, behaviour + at + 0x70, Some(light), None)?;
                        }
                    }
                }
            }
        }
        // Эволюции цвета (у крови кадры цвета вдали свои) красятся так же.
        let upper_hash = kit::prop_hash(RGBA_MAX);
        for (hash, header) in evolved_lists(s, layer.events, &is_colour_prop)? {
            let is_upper = hash == upper_hash;
            report.recoloured += if mode == "rainbow" {
                rainbow_list(s, header, if is_upper { 0.5 } else { 0.0 }, alpha, label)?
            } else {
                repaint(s, header, if is_upper { upper } else { colour }, alpha)?
            };
        }
    }

    // Цвет по частям — после общего цвета.
    for part in tune.part_colours.iter().flatten() {
        if !donor_name(&part.particle) {
            return Err(broken(format!(
                "YPT clone part colour names no particle: {label}"
            )));
        }
        if part.colour.len() != 3 {
            return Err(broken(format!(
                "YPT clone part colour must have three channels: {}",
                part.particle
            )));
        }
        let tint = channels(&part.colour, "part colour", label)?;
        let mut found = false;
        for &particle in layer.particles {
            if layer.donor_names.get(&particle).map(String::as_str) != Some(part.particle.as_str()) {
                continue;
            }
            found = true;
            for behaviour in kit::behaviours(s, particle)? {
                let kind = kit::behaviour_type(s, behaviour)?;
                if kind == TYPE_COLOUR {
                    for at in [kit::COLOUR_RGBA_MIN, kit::COLOUR_RGBA_MAX] {
                        report.recoloured += repaint(s, behaviour + at + 0x70, Some(tint), None)?;
                    }
                } else if kind == TYPE_LIGHT {
                    for at in kit::LIGHT_COLOUR_PROPS {
                        report.recoloured += repaint(s, behaviour + at + 0x70, Some(tint), None)?;
                    }
                }
            }
        }
        if !found {
            return Err(broken(format!(
                "YPT clone {label} has no part {} to colour.",
                part.particle
            )));
        }
        for &event in layer.events {
            let Some(particle) = s.pointer(event + super::structure::EVENT_PARTICLE) else {
                continue;
            };
            if layer.donor_names.get(&particle).map(String::as_str) != Some(part.particle.as_str()) {
                continue;
            }
            for (_, header) in evolved_lists(s, &[event], &is_colour_prop)? {
                report.recoloured += repaint(s, header, Some(tint), None)?;
            }
        }
    }

    // Точечные замены кадров.
    for patch in tune.keyframes.iter().flatten() {
        report.replaced += apply_keyframes(s, layer, patch, label)?;
    }

    // Множители идут последними: заменённые выше кадры масштабируются так же, как кадры донора.
    if let Some(value) = tune.emissive_scale {
        let factor = bounded(value, 0.05, 8.0, "emissiveScale", label)?;
        for &particle in layer.particles {
            for behaviour in kit::behaviours(s, particle)? {
                if kit::behaviour_type(s, behaviour)? == TYPE_COLOUR {
                    report.scaled += kit::scale_xy(s, behaviour + kit::COLOUR_EMISSIVE + 0x70, factor)?;
                }
            }
        }
        let emissive = kit::prop_hash(EMISSIVE);
        for (_, header) in evolved_lists(s, layer.events, &|hash| hash == emissive)? {
            report.scaled += kit::scale_xy(s, header, factor)?;
        }
    }
    for scale in tune.scales.iter().flatten() {
        if !super::effect_clones::scale_prop_name(&scale.prop) {
            return Err(broken(format!(
                "YPT clone scale property is invalid: {}",
                scale.prop
            )));
        }
        let factor = bounded(scale.factor, 0.0, 8.0, "scale", label)?;
        let hash = kit::prop_hash(&scale.prop);
        // Проценты по осям (ускорение, гашение, размер, вес матрицы) — три оси, как размеры областей; у скорости,
        // жизни и густоты x и y — это «от» и «до».
        let percent = PERCENT_PROPS.iter().any(|name| kit::prop_hash(name) == hash);
        let axes = if percent || scale.prop.contains("Domain:") { 3 } else { 2 };
        for &emitter in layer.emitters {
            let owned = kit::owned_props(s, emitter);
            for prop in kit::with_hash(s, &owned, hash)? {
                // Пустое процентное свойство игра читает как штатные 100 %: множитель ложится одним кадром.
                if percent && kit::prop_keys(s, prop)?.is_empty() {
                    let value = decimal_round_trip(100.0f32 * factor);
                    let row = vec![0.0, f64::from(value), f64::from(value), f64::from(value), 100.0];
                    set_keyframes(s, prop, &[row], label)?;
                    report.scaled += 1;
                    continue;
                }
                report.scaled += kit::scale_axes(s, prop + 0x70, factor, axes)?;
            }
        }
        for (_, header) in evolved_lists(s, layer.events, &|candidate| candidate == hash)? {
            report.scaled += kit::scale_axes(s, header, factor, axes)?;
        }
    }

    // Прицел — последним, поверх всего.
    if let Some(CloneAim { yaw, pitch }) = tune.aim {
        let yaw = f64::from(bounded(yaw, -180.0, 180.0, "aim yaw", label)?);
        let pitch = f64::from(bounded(pitch, -90.0, 90.0, "aim pitch", label)?);
        for &emitter in layer.emitters {
            if let Some(prop) = kit::target_position(s, emitter) {
                report.scaled += aim_domain(s, prop + 0x70, yaw, pitch)?;
            }
        }
    }
    Ok(report)
}

/// `(decimal)float` и обратно: десятичное число округляется до семи значащих цифр.
fn decimal_round_trip(value: f32) -> f32 {
    if value == 0.0 || !value.is_finite() {
        return value;
    }
    let text = format!("{:.6e}", f64::from(value));
    text.parse::<f64>().map_or(value, |number| number as f32)
}

/// Замена кадров названного свойства; возвращает число заменённых свойств.
fn apply_keyframes(
    s: &mut Structure,
    layer: &Layer,
    patch: &CloneKeyframes,
    label: &str,
) -> Result<usize> {
    if !super::effect_clones::prop_name(&patch.prop) {
        return Err(broken(format!(
            "YPT clone keyframe property is invalid: {}",
            patch.prop
        )));
    }
    if patch.values.is_empty() || patch.values.len() > MAX_KEYFRAMES {
        return Err(broken(format!(
            "YPT clone keyframe count is out of range: {}",
            patch.prop
        )));
    }
    let hash = kit::prop_hash(&patch.prop);
    let mut targets: Vec<usize> = Vec::new();
    let wanted_particle = |particle: usize| -> bool {
        patch.particle.as_ref().is_none_or(|name| {
            layer.donor_names.get(&particle).map(String::as_str) == Some(name.as_str())
        })
    };
    match patch.scope.as_str() {
        "emitter" => {
            for &event in layer.events {
                let (Some(emitter), Some(particle)) = (
                    s.pointer(event + super::structure::EVENT_EMITTER),
                    s.pointer(event + super::structure::EVENT_PARTICLE),
                ) else {
                    continue;
                };
                if !wanted_particle(particle) {
                    continue;
                }
                let owned = kit::owned_props(s, emitter);
                targets.extend(kit::with_hash(s, &owned, hash)?);
            }
        }
        "particle" => {
            for &particle in layer.particles {
                if !wanted_particle(particle) {
                    continue;
                }
                for behaviour in kit::behaviours(s, particle)? {
                    let props = kit::behaviour_props(s, behaviour)?;
                    targets.extend(kit::with_hash(s, &props, hash)?);
                }
            }
        }
        other => {
            return Err(broken(format!(
                "YPT clone keyframe scope is invalid: {other}"
            )))
        }
    }
    let mut distinct: Vec<usize> = Vec::new();
    for target in targets {
        if !distinct.contains(&target) {
            distinct.push(target);
        }
    }
    if distinct.is_empty() {
        return Err(broken(format!(
            "YPT clone {label} has no keyframe property {} in scope {}.",
            patch.prop, patch.scope
        )));
    }
    for &target in &distinct {
        set_keyframes(s, target, &patch.values, label)?;
    }
    Ok(distinct.len())
}
