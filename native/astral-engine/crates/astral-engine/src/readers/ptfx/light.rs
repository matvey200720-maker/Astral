//! Освещение ясного дня для превью эффектов: 43 параметра таймцикла и 27 ключей
//! `visualsettings.dat` (кривые экспозиции, плёночное сведение, свечение).
//!
//! Нет таймцикла — `values` пуст, окно берёт эталонный день; нет ключа — его нет
//! и в `visual`, окно подставляет штатное значение. Читает два текста из
//! `update.rpf` (разделы `light` и `lightError` команды `read-ptfx-base`),
//! ничего не пишет.

use std::{borrow::Cow, path::Path, sync::Arc};

use rage_rpf::{Archive, KeySet};
use serde_json::{Map, Number, Value};

use super::environment::object_of;
use crate::readers::{
    archive_access,
    js_text::{is_js_space, js_parse_float},
    locator, timecycle,
};

/// Параметры таймцикла, влияющие на частицы. Порядок — порядок ключей `values`.
pub const SCENE_LIGHT_PARAMETERS: [&str; 43] = [
    "light_dir_col_r",
    "light_dir_col_g",
    "light_dir_col_b",
    "light_dir_mult",
    "light_directional_amb_col_r",
    "light_directional_amb_col_g",
    "light_directional_amb_col_b",
    "light_directional_amb_intensity",
    "light_directional_amb_intensity_mult",
    "light_natural_amb_down_col_r",
    "light_natural_amb_down_col_g",
    "light_natural_amb_down_col_b",
    "light_natural_amb_down_intensity",
    "light_natural_amb_up_col_r",
    "light_natural_amb_up_col_g",
    "light_natural_amb_up_col_b",
    "light_natural_amb_up_intensity",
    "light_natural_amb_up_intensity_mult",
    "natural_ambient_multiplier",
    "particle_emissive_intensity_mult",
    "postfx_exposure",
    "postfx_exposure_min",
    "postfx_exposure_max",
    "postfx_intensity_bloom",
    "postfx_bright_pass_thresh",
    "postfx_tonemap_filmic_override_dark",
    "postfx_tonemap_filmic_exposure_dark",
    "postfx_tonemap_filmic_a",
    "postfx_tonemap_filmic_b",
    "postfx_tonemap_filmic_c",
    "postfx_tonemap_filmic_d",
    "postfx_tonemap_filmic_e",
    "postfx_tonemap_filmic_f",
    "postfx_tonemap_filmic_w",
    "postfx_tonemap_filmic_override_bright",
    "postfx_tonemap_filmic_exposure_bright",
    "postfx_tonemap_filmic_a_bright",
    "postfx_tonemap_filmic_b_bright",
    "postfx_tonemap_filmic_c_bright",
    "postfx_tonemap_filmic_d_bright",
    "postfx_tonemap_filmic_e_bright",
    "postfx_tonemap_filmic_f_bright",
    "postfx_tonemap_filmic_w_bright",
];

/// Ключи `visualsettings.dat`. Порядок — порядок ключей `visual`. «expsoure» —
/// так написано в самой игре.
pub const SCENE_VISUAL_KEYS: [&str; 27] = [
    "Tonemapping.bright.filmic.A",
    "Tonemapping.bright.filmic.B",
    "Tonemapping.bright.filmic.C",
    "Tonemapping.bright.filmic.D",
    "Tonemapping.bright.filmic.E",
    "Tonemapping.bright.filmic.F",
    "Tonemapping.bright.filmic.W",
    "Tonemapping.bright.filmic.exposure",
    "Tonemapping.dark.filmic.A",
    "Tonemapping.dark.filmic.B",
    "Tonemapping.dark.filmic.C",
    "Tonemapping.dark.filmic.D",
    "Tonemapping.dark.filmic.E",
    "Tonemapping.dark.filmic.F",
    "Tonemapping.dark.filmic.W",
    "Tonemapping.dark.filmic.exposure",
    "Exposure.curve.scale",
    "Exposure.curve.power",
    "Exposure.curve.offset",
    "bloom.threshold.min",
    "bloom.threshold.expsoure.diff.min",
    "bloom.threshold.expsoure.diff.max",
    "bloom.threshold.power",
    "bloom.blurblendmult.large",
    "bloom.blurblendmult.med",
    "bloom.blurblendmult.small",
    "particles.shadowintensity",
];

pub const WEATHER: &str = "EXTRASUNNY";

/// Регион, который предпочитается первому в файле.
const PREFERRED_REGION: &str = "GLOBAL";

pub const WEATHER_ENTRY: &str = "update:/common/data/timecycle/w_extrasunny.xml";

/// Знаки, после которых в тексте настроек начинается новая «строка».
const LINE_BREAKS: [char; 4] = ['\n', '\r', '\u{2028}', '\u{2029}'];

/// Число для JSON; то, чего JSON выразить не может, становится `null`.
fn json_number(x: f64) -> Value {
    Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// Текст, если он есть и не пуст; пустой считается отсутствующим.
fn non_empty(text: Option<&str>) -> Option<&str> {
    text.filter(|t| !t.is_empty())
}

/// Пробел или табуляция: единственные разделители ключа и значения.
fn is_blank(c: char) -> bool {
    c == ' ' || c == '\t'
}

/// Знак платформенного суффикса: латиница, цифра или `_`.
fn is_suffix_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Знак, на котором значение кончается: пробельный знак JS или начало комментария.
fn ends_value(c: char) -> bool {
    is_js_space(c) || c == '#'
}

/// Остаток строки после ключа (ASCII без учёта регистра); ключ «не помещается» — `None`.
fn strip_key<'t>(line: &'t str, key: &str) -> Option<&'t str> {
    let head = line.get(..key.len())?;
    head.eq_ignore_ascii_case(key).then(|| &line[key.len()..])
}

/// Без платформенного суффикса: точка и хотя бы один знак суффикса (только первая
/// часть). Точка без знаков за ней суффиксом не считается и остаётся.
fn without_platform_suffix(tail: &str) -> &str {
    let Some(word) = tail.strip_prefix('.') else {
        return tail;
    };
    match word.find(|c| !is_suffix_char(c)) {
        Some(0) => tail,
        Some(end) => &word[end..],
        None if word.is_empty() => tail,
        None => "",
    }
}

/// Значение ключа в одной строке настроек, если строка ему подходит: отступ, ключ,
/// необязательный суффикс, хотя бы один пробел или табуляция и непустое значение до
/// пробельного знака JS или `#`.
fn value_token<'t>(line: &'t str, key: &str) -> Option<&'t str> {
    let after_key = strip_key(line.trim_start_matches(is_blank), key)?;
    let tail = without_platform_suffix(after_key);
    if !tail.starts_with(is_blank) {
        return None;
    }
    let value_area = tail.trim_start_matches(is_blank);
    let token = value_area.split(ends_value).next()?;
    Some(token).filter(|t| !t.is_empty())
}

/// Число ключа: первая подошедшая строка решает, даже если в ней не число.
fn number_for(key: &str, text: &str) -> Option<f64> {
    let token = text
        .split(|c| LINE_BREAKS.contains(&c))
        .find_map(|line| value_token(line, key))?;
    js_parse_float(token).filter(|number| number.is_finite())
}

/// Что дал таймцикл: имя региона-источника (как в файле) и его параметры.
struct Sunlight {
    region: Value,
    values: Map<String, Value>,
}

impl Sunlight {
    fn nothing() -> Self {
        Sunlight {
            region: Value::Null,
            values: Map::new(),
        }
    }

    /// Известные параметры региона, по порядку списка, непустые.
    fn of(region: &timecycle::Region) -> Self {
        let values = SCENE_LIGHT_PARAMETERS
            .iter()
            .filter_map(|name| {
                let list = region.values.get(*name).filter(|list| !list.is_empty())?;
                let numbers = list.iter().map(|&x| json_number(x)).collect();
                Some((String::from(*name), Value::Array(numbers)))
            })
            .collect();
        Sunlight {
            region: Value::String(region.name.clone()),
            values,
        }
    }

    /// По тексту таймцикла: предпочтённый регион, иначе первый; пустой текст — «нет».
    fn from_xml(xml: Option<&str>) -> Result<Self, String> {
        let Some(xml) = non_empty(xml) else {
            return Ok(Sunlight::nothing());
        };
        let parsed = timecycle::parse(xml)?;
        let source = parsed.region(PREFERRED_REGION).or(parsed.regions.first());
        Ok(source.map_or_else(Sunlight::nothing, Sunlight::of))
    }
}

/// Найденные числа настроек по списку ключей; пустой текст — «нет».
fn visual_part(text: Option<&str>) -> Map<String, Value> {
    let Some(text) = non_empty(text) else {
        return Map::new();
    };
    SCENE_VISUAL_KEYS
        .iter()
        .filter_map(|key| {
            let number = number_for(key, text)?;
            Some((key.to_string(), json_number(number)))
        })
        .collect()
}

/// Освещение из двух текстов (оба необязательны; пустой текст — «нет»).
pub fn scene_light_from_texts(
    weather_xml: Option<&str>,
    visual_dat: Option<&str>,
) -> Result<Value, String> {
    let Sunlight { region, values } = Sunlight::from_xml(weather_xml)?;
    Ok(object_of([
        ("weather", WEATHER.into()),
        ("region", region),
        ("values", values.into()),
        ("visual", visual_part(visual_dat).into()),
    ]))
}

pub const VISUAL_SETTINGS_ENTRY: &str = "update:/common/data/visualsettings.dat";

/// Открытый `update.rpf`: тексты читаются из него по штатному пути.
struct UpdateRpf {
    archive: Archive,
}

impl UpdateRpf {
    fn open(root: &Path, keys: &Arc<KeySet>) -> Result<Self, String> {
        let path = root.join("update").join("update.rpf");
        let archive = archive_access::open(&path, keys).map_err(|e| e.message)?;
        Ok(UpdateRpf { archive })
    }

    /// Текст записи; записи нет — `Ok(None)`.
    fn text(&self, entry: &str) -> Result<Option<String>, String> {
        let inner = locator::update_inner(entry);
        let found = archive_access::read_entry(&self.archive, &inner).map_err(|e| e.message)?;
        Ok(found
            .as_deref()
            .map(String::from_utf8_lossy)
            .map(Cow::into_owned))
    }
}

/// Читает оба текста из `update/update.rpf` игры и собирает освещение.
/// Любой отказ — сообщение без кода.
pub fn read(root: &Path, keys: &Arc<KeySet>) -> Result<Value, String> {
    let rpf = UpdateRpf::open(root, keys)?;
    // Сначала таймцикл: его отказ не даёт дойти до настроек.
    let weather = rpf.text(WEATHER_ENTRY)?;
    let settings = rpf.text(VISUAL_SETTINGS_ENTRY)?;
    scene_light_from_texts(weather.as_deref(), settings.as_deref())
}

#[cfg(test)]
mod tests;
