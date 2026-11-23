//! Общее для команд ядра эффектов (`ypt-patch`, `ypt-clone-export`, `ypt-own-donor`): разбор тела запроса помощника, его
//! пути, чтение DDS листов и части ответа.
//!
//! Тело то же, что получает помощник (`System.Text.Json` без учёта регистра имён). Тексты отказов — его: тип значения
//! называется как в .NET, пути обязаны быть абсолютными, у файла — нужное расширение.

use std::{fs, path::PathBuf};

use rage_res::{resource::is_resource, Kind};
use serde_json::{Map, Number, Value};

use crate::{
    error::{EngineError, Result},
    paths,
};

/// Поле объекта по имени без учёта регистра; `null` — как отсутствие.
pub(super) fn field<'a>(object: &'a Value, name: &str) -> Option<&'a Value> {
    let found = object
        .as_object()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value)?;
    (!found.is_null()).then_some(found)
}

pub(super) fn wrong(path: &str, wanted: &str) -> EngineError {
    EngineError::invalid_data(format!(
        "The JSON value could not be converted to {wanted}. Path: {path}"
    ))
}

pub(super) fn text_field(object: &Value, name: &str, path: &str) -> Result<Option<String>> {
    match field(object, name) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(wrong(&format!("{path}.{name}"), "System.String")),
    }
}

pub(super) fn flag_field(object: &Value, name: &str, path: &str) -> Result<Option<bool>> {
    match field(object, name) {
        None => Ok(None),
        Some(Value::Bool(flag)) => Ok(Some(*flag)),
        Some(_) => Err(wrong(&format!("{path}.{name}"), "System.Boolean")),
    }
}

pub(super) fn number_field(object: &Value, name: &str, path: &str) -> Result<Option<f64>> {
    match field(object, name) {
        None => Ok(None),
        Some(Value::Number(number)) => Ok(number.as_f64()),
        Some(_) => Err(wrong(&format!("{path}.{name}"), "System.Decimal")),
    }
}

/// Целое `int`: число без дробной части в пределах `Int32`.
pub(super) fn int_field(object: &Value, name: &str, path: &str) -> Result<Option<i32>> {
    match field(object, name) {
        None => Ok(None),
        Some(Value::Number(number)) => number
            .as_i64()
            .and_then(|value| i32::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| wrong(&format!("{path}.{name}"), "System.Int32")),
        Some(_) => Err(wrong(&format!("{path}.{name}"), "System.Int32")),
    }
}

pub(super) fn list_field<'a>(object: &'a Value, name: &str) -> Result<&'a [Value]> {
    match field(object, name) {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => Err(wrong(
            &format!("$.{name}"),
            "System.Collections.Generic.IReadOnlyList",
        )),
    }
}

/// Список строк; `null` внутри списка — пустая строка.
pub(super) fn text_list(object: &Value, name: &str) -> Result<Vec<String>> {
    list_field(object, name)?
        .iter()
        .enumerate()
        .map(|(k, item)| match item {
            Value::String(text) => Ok(text.clone()),
            Value::Null => Ok(String::new()),
            _ => Err(wrong(&format!("$.{name}[{k}]"), "System.String")),
        })
        .collect()
}

/// Абсолютный путь (`RequireAbsolutePath`).
pub(super) fn helper_path(value: Option<&str>) -> Result<PathBuf> {
    let text = value.unwrap_or_default();
    if text.trim().is_empty() || !std::path::Path::new(text).is_absolute() {
        return Err(EngineError::invalid_data("Helper paths must be absolute."));
    }
    paths::full_path(text)
}

/// Существующий файл с расширением (`RequireAbsoluteFile`).
pub(super) fn helper_file(value: Option<&str>, extension: &str) -> Result<PathBuf> {
    let path = helper_path(value)?;
    if !path.is_file() {
        return Err(EngineError::file_not_found("Input file not found."));
    }
    let name = path.to_string_lossy().to_lowercase();
    if !name.ends_with(extension) {
        return Err(EngineError::invalid_data(format!(
            "Expected a {extension} archive."
        )));
    }
    Ok(path)
}

/// Отказ ядра ресурсов — отказ команды с тем же видом (у помощника это исключение того же рода).
pub(super) fn lift(error: rage_res::Error) -> EngineError {
    // Лист в раскладке помощника (мелкие ступени без блока): помощник его строит, движок пока нет — запрос уходит ему.
    if error.message == rage_res::ypt::slot_reservations::SHEET_HELPER_LAYOUT {
        return EngineError::new(super::ypt_patch::NOT_IN_ENGINE, error.message);
    }
    match error.kind {
        Kind::Operation => EngineError::invalid_operation(error.message),
        Kind::Argument => EngineError::argument(error.message),
        Kind::Io => EngineError::io(error.message),
        _ => EngineError::invalid_data(error.message),
    }
}

/// Файл ресурса с диска: заголовок RSC7 обязан быть (текст помощника).
pub(super) fn read_core(path: &std::path::Path) -> Result<Vec<u8>> {
    let bytes = fs::read(path)?;
    if !is_resource(&bytes) {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Err(EngineError::invalid_data(format!(
            "Ресурс без заголовка RSC7 — файл повреждён или нестандартный: {name}"
        )));
    }
    Ok(bytes)
}

/// Число JSON так, как его пишет `System.Text.Json`: целое без точки.
pub(super) fn number(value: f64) -> Value {
    if value.is_finite() && value.trunc() == value && value.abs() < 1e15 {
        Value::from(value as i64)
    } else {
        Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}

pub(super) fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<_, _>>(),
    )
}

/// Строки списком JSON.
pub(super) fn strings(items: &[String]) -> Value {
    Value::Array(items.iter().map(|item| Value::from(item.as_str())).collect())
}

// ---------------------------------------------------------------------------------------------
// Подмена текстур: запрос, DDS листов слотов и клонов, отказы чтения DDS
// ---------------------------------------------------------------------------------------------

/// Сколько правок текстур и правил принимается за раз.
pub(super) const PATCH_CAP: usize = 64;
/// Сколько записей замечаний ответ называет.
pub(super) const REMARK_CAP: usize = 32;

/// Одна подмена текстуры из запроса: имя в словаре, путь к DDS и сумма SHA-256 (пусто — не сверять).
pub(super) struct TextureDraft {
    pub texture: Option<String>,
    pub source: Option<String>,
    pub sha256: Option<String>,
}

pub(super) fn texture_draft(item: &Value, path: &str) -> Result<TextureDraft> {
    Ok(TextureDraft {
        texture: text_field(item, "texture", path)?,
        source: text_field(item, "source", path)?,
        sha256: text_field(item, "sha256", path)?,
    })
}

/// Имена списка: пустое или повторившееся (без учёта регистра и пробелов по краям) — отказ.
pub(super) fn named_twice(names: impl Iterator<Item = String>) -> bool {
    let mut seen = std::collections::HashSet::new();
    names
        .map(|name| name.trim().to_uppercase())
        .any(|key| key.is_empty() || !seen.insert(key))
}

/// DDS по именам листов: те же файлы и та же сверка SHA-256, что у подмены текстуры (`ReadTexturePayloadsAsync`).
/// `key` — как имя ложится в словарь байтов (слоты и клоны хранят их под разным написанием).
pub(super) fn read_payloads(
    names: impl IntoIterator<Item = String>,
    drafts: &[TextureDraft],
    key: fn(&str) -> String,
) -> Result<std::collections::HashMap<String, Vec<u8>>> {
    let mut found = std::collections::HashMap::new();
    for name in names {
        let name = name.trim().to_owned();
        if found.contains_key(&key(&name)) {
            continue;
        }
        let draft = drafts
            .iter()
            .find(|draft| {
                rage_res::ypt::cmp_ordinal_ignore_case(draft.texture.as_deref().unwrap_or_default().trim(), &name)
                    == std::cmp::Ordering::Equal
            })
            .ok_or_else(|| EngineError::invalid_data(format!("YPT slot texture has no payload: {name}")))?;
        let source = helper_file(draft.source.as_deref(), ".dds")?;
        let bytes = fs::read(&source)?;
        if let Some(wanted) = draft.sha256.as_deref().filter(|text| !text.trim().is_empty()) {
            if !wanted.eq_ignore_ascii_case(&rage_res::hash::sha256_hex(&bytes)) {
                return Err(EngineError::invalid_data(format!(
                    "YPT texture checksum mismatch: {name}"
                )));
            }
        }
        found.insert(key(&name), bytes);
    }
    Ok(found)
}

/// Отказ чтения DDS: у чтения DDS помощника свои исключения, остальное — вид отказа ядра.
pub(super) fn lift_dds(error: rage_res::Error) -> EngineError {
    use rage_res::ypt::slot_reservations as slots;
    let text = error.message.clone();
    match text.as_str() {
        slots::DDS_MAGIC => EngineError::new("Exception", text),
        slots::DDS_SHORT => EngineError::new("EndOfStreamException", text),
        _ => lift(error),
    }
}

// ---------------------------------------------------------------------------------------------
// Части ответа помощника
// ---------------------------------------------------------------------------------------------

pub(super) fn remarks_answer(remarks: &[rage_res::ypt::vanilla::Remark]) -> Value {
    if remarks.is_empty() {
        return Value::Null;
    }
    let entries: Vec<Value> = remarks
        .iter()
        .take(REMARK_CAP)
        .map(|remark| {
            object([
                ("dictionary", Value::from(remark.dictionary)),
                ("index", Value::from(remark.index)),
                ("name", Value::from(remark.name.as_str())),
                ("hash", Value::from(remark.hash.as_str())),
                ("form", Value::from(remark.form)),
            ])
        })
        .collect();
    object([("count", Value::from(remarks.len())), ("entries", Value::Array(entries))])
}

pub(super) fn graph_answer(remarks: &std::collections::BTreeSet<String>) -> Value {
    if remarks.is_empty() {
        return Value::Null;
    }
    let entries: Vec<Value> = remarks.iter().take(REMARK_CAP).map(|key| Value::from(key.as_str())).collect();
    object([("count", Value::from(remarks.len())), ("entries", Value::Array(entries))])
}

pub(super) fn verification_answer(found: &rage_res::ypt::vanilla::Verification) -> Value {
    object([
        ("vanillaUnchanged", Value::from(found.vanilla_unchanged)),
        ("intentionallyPatched", Value::from(found.intentionally_patched)),
        ("added", Value::from(found.added)),
        ("purged", Value::from(found.purged)),
        ("effectRules", Value::from(found.effect_rules)),
        ("emitterRules", Value::from(found.emitter_rules)),
        ("particleRules", Value::from(found.particle_rules)),
        ("textures", Value::from(found.textures)),
    ])
}
