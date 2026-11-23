//! `weapons-meta-tracer-patch`: точечная правка следа пули, вспышки и вида выстрела в `weapons.meta`.
//!
//! Здесь запрос (один файл или пачка), типы полей, эхо привязок и ответ; дерево файла правит
//! `rage_res::weapons_meta`, запись идёт через `shop::write_atomic`.

use std::{collections::HashSet, fmt, fs, path::PathBuf};

use rage_res::{
    hash::sha256_hex,
    weapons_meta::{check, patch, Binding, Look},
};
use serde_json::Value;

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const MODE: &str = "weapons-meta-tracer-patch";
const BATCH_CAP: usize = 128;
const REQUEST_FILE: &[&str] = &[".json"];
const META_FILE: &[&str] = &[".meta"];
/// Ключ списка привязок: в одиночном запросе один, в элементе пачки другой.
const SINGLE_BINDINGS: &str = "weaponTracerBindings";
const BATCH_BINDINGS: &str = "bindings";

// ---------------------------------------------------------------------------------------------
// Отказы запроса
// ---------------------------------------------------------------------------------------------

/// Отказы запроса: один из них `InvalidDataException`, остальные `ArgumentException`.
enum Refusal {
    BrokenRequest,
    BatchTooBig,
    BatchEmptyItem,
    BatchRepeat,
    NoBindings,
    NotBinding,
    NotLook,
    NotText,
    NotNumber,
    NotFlag,
    NotList,
    NotNumbers,
}

impl Refusal {
    fn words(&self) -> &'static str {
        match self {
            Refusal::BrokenRequest => "Запрос weapons.meta пустой или сломан.",
            Refusal::BatchTooBig => "Weapons metadata batch must not exceed 128 files.",
            Refusal::BatchEmptyItem => "Weapons metadata batch contains an empty item.",
            Refusal::BatchRepeat => "Weapons metadata batch writes one output twice.",
            Refusal::NoBindings => "Weapon tracer bindings are required.",
            Refusal::NotBinding => "Привязка оружия — объект.",
            Refusal::NotLook => "Вид выстрела — объект.",
            Refusal::NotText => "Текстовое поле weapons.meta — строка.",
            Refusal::NotNumber => "Числовое поле weapons.meta — число.",
            Refusal::NotFlag => "Флаг света weapons.meta — true или false.",
            Refusal::NotList => "Цвет и диапазон — список чисел.",
            Refusal::NotNumbers => "Цвет и диапазон — числа.",
        }
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(self.words())
    }
}

impl From<Refusal> for EngineError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::BrokenRequest => EngineError::invalid_data(refusal.words()),
            other => EngineError::argument(other.words()),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Типы полей
// ---------------------------------------------------------------------------------------------

/// Как значение запроса читается в поле нужного типа.
trait Extract: Sized {
    fn extract(value: &Value) -> Result<Self>;
}

impl Extract for String {
    fn extract(value: &Value) -> Result<Self> {
        value
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| Refusal::NotText.into())
    }
}

impl Extract for f64 {
    fn extract(value: &Value) -> Result<Self> {
        match value {
            Value::Number(number) => Ok(number.as_f64().unwrap_or_default()),
            _ => Err(Refusal::NotNumber.into()),
        }
    }
}

impl Extract for bool {
    fn extract(value: &Value) -> Result<Self> {
        value.as_bool().ok_or_else(|| Refusal::NotFlag.into())
    }
}

impl Extract for Vec<f64> {
    fn extract(value: &Value) -> Result<Self> {
        let items = value.as_array().ok_or(Refusal::NotList)?;
        items
            .iter()
            .map(|item| match item {
                Value::Number(number) => Ok(number.as_f64().unwrap_or_default()),
                _ => Err(Refusal::NotNumbers.into()),
            })
            .collect()
    }
}

/// Поле объекта читается переданной функцией; отсутствие и `null` - «не менять».
fn optional_with<T>(
    node: &Value,
    key: &str,
    read: impl FnOnce(&Value) -> Result<T>,
) -> Result<Option<T>> {
    match node.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => read(value).map(Some),
    }
}

/// Поле объекта обязано подходить по типу.
fn optional<T: Extract>(node: &Value, key: &str) -> Result<Option<T>> {
    optional_with(node, key, T::extract)
}

/// Вид выстрела из объекта запроса; поля читаются в порядке описания, строки остаются как пришли.
fn read_look(node: &Value) -> Result<Look> {
    let Value::Object(_) = node else {
        return Err(Refusal::NotLook.into());
    };
    Ok(Look {
        flash_scale: optional(node, "flashScale")?,
        light_enabled: optional(node, "lightEnabled")?,
        light_rgb_min: optional(node, "lightRgbMin")?,
        light_rgb_max: optional(node, "lightRgbMax")?,
        light_intensity: optional(node, "lightIntensity")?,
        light_range: optional(node, "lightRange")?,
        smoke_fx: optional(node, "smokeFx")?,
        smoke_inc_per_shot: optional(node, "smokeIncPerShot")?,
        shell_fx: optional(node, "shellFx")?,
        flash_fx_fp: optional(node, "flashFxFP")?,
        smoke_fx_fp: optional(node, "smokeFxFP")?,
        shell_fx_fp: optional(node, "shellFxFP")?,
    })
}

/// Строка привязки (след, вспышка) приходит обрезанной.
fn optional_trimmed(node: &Value, key: &str) -> Result<Option<String>> {
    Ok(optional::<String>(node, key)?.map(|text| text.trim().to_owned()))
}

fn read_binding(node: &Value) -> Result<Binding> {
    let Value::Object(fields) = node else {
        return Err(Refusal::NotBinding.into());
    };
    let weapon = fields
        .get("weapon")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    Ok(Binding {
        weapon,
        tracer_fx: optional_trimmed(node, "tracerFx")?,
        chance_sp: optional(node, "chanceSP")?,
        chance_mp: optional(node, "chanceMP")?,
        flash_fx: optional_trimmed(node, "flashFx")?,
        look: optional_with(node, "look", read_look)?,
    })
}

/// Список привязок из поля `key`: обязан быть массивом, элементы читаются по порядку.
fn read_bindings(node: &Value, key: &str) -> Result<Vec<Binding>> {
    let Some(listed) = node.get(key).and_then(Value::as_array) else {
        return Err(Refusal::NoBindings.into());
    };
    listed.iter().map(read_binding).collect()
}

// ---------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------

/// Объект JSON с ключами в том порядке, в каком они перечислены.
fn object<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn look_echo(look: &Look) -> Value {
    object([
        ("flashScale", look.flash_scale.into()),
        ("lightEnabled", look.light_enabled.into()),
        ("lightRgbMin", look.light_rgb_min.clone().into()),
        ("lightRgbMax", look.light_rgb_max.clone().into()),
        ("lightIntensity", look.light_intensity.clone().into()),
        ("lightRange", look.light_range.clone().into()),
        ("smokeFx", look.smoke_fx.clone().into()),
        ("smokeIncPerShot", look.smoke_inc_per_shot.into()),
        ("shellFx", look.shell_fx.clone().into()),
        ("flashFxFP", look.flash_fx_fp.clone().into()),
        ("smokeFxFP", look.smoke_fx_fp.clone().into()),
        ("shellFxFP", look.shell_fx_fp.clone().into()),
    ])
}

/// Шансы попадают в эхо только вместе со следом (пустая строка тоже след).
fn binding_echo(binding: &Binding) -> Value {
    let (chance_sp, chance_mp) = match binding.tracer_fx {
        Some(_) => (binding.chance_sp, binding.chance_mp),
        None => (None, None),
    };
    object([
        ("weapon", binding.weapon.clone().into()),
        ("tracerFx", binding.tracer_fx.clone().into()),
        ("chanceSP", chance_sp.into()),
        ("chanceMP", chance_mp.into()),
        ("flashFx", binding.flash_fx.clone().into()),
        ("look", binding.look.as_ref().map(look_echo).into()),
    ])
}

// ---------------------------------------------------------------------------------------------
// Один файл и пачка
// ---------------------------------------------------------------------------------------------

fn path_text<'a>(node: &'a Value, key: &str) -> &'a str {
    node.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// Проверенный одиночный вызов: пути и привязки уже разобраны, файл ещё не читался.
struct Plan {
    input: PathBuf,
    output: PathBuf,
    bindings: Vec<Binding>,
}

impl Plan {
    fn from_node(node: &Value, bindings_key: &str) -> Result<Plan> {
        Ok(Plan {
            input: paths::existing_file(path_text(node, "inputFile"), META_FILE)?,
            output: paths::output_file(path_text(node, "outputFile"), META_FILE)?,
            bindings: read_bindings(node, bindings_key)?,
        })
    }

    /// Правка, повторное чтение результата, запись и ответ.
    fn execute(self) -> Result<Value> {
        let original = fs::read(&self.input)?;
        let patched = patch(&original, &self.bindings)?;
        check(&patched)?;
        write_atomic(&self.output, &patched)?;

        Ok(object([
            ("status", "ready".into()),
            ("mode", MODE.into()),
            ("input", self.input.display().to_string().into()),
            ("output", self.output.display().to_string().into()),
            ("inputSha256", sha256_hex(&original).into()),
            ("outputSha256", sha256_hex(&patched).into()),
            ("outputBytes", patched.len().into()),
            ("bindings", self.bindings.iter().map(binding_echo).collect()),
            (
                "validation",
                object([("reopened", true.into()), ("atomicOutput", true.into())]),
            ),
        ]))
    }
}

/// Выходы пачки, уже занятые предыдущими файлами (по тексту, в нижнем регистре).
#[derive(Default)]
struct Claimed {
    outputs: HashSet<String>,
}

impl Claimed {
    /// Элемент пачки не пуст и не пишет в тот же выход, что предыдущие.
    fn admit(&mut self, file: &Value) -> Result<()> {
        if file.is_null() {
            return Err(Refusal::BatchEmptyItem.into());
        }
        match self
            .outputs
            .insert(path_text(file, "outputFile").to_lowercase())
        {
            true => Ok(()),
            false => Err(Refusal::BatchRepeat.into()),
        }
    }
}

/// Пачка: файлы по порядку, первый же отказ останавливает, записанное остаётся.
fn patch_batch(files: &[Value]) -> Result<Value> {
    (files.len() <= BATCH_CAP)
        .then_some(())
        .ok_or(Refusal::BatchTooBig)?;
    let mut claimed = Claimed::default();
    let answers = files
        .iter()
        .map(|file| {
            claimed.admit(file)?;
            Plan::from_node(file, BATCH_BINDINGS)?.execute()
        })
        .collect::<Result<Vec<Value>>>()?;
    Ok(object([
        ("status", "ready".into()),
        ("mode", MODE.into()),
        ("files", Value::Array(answers)),
    ]))
}

/// Корень запроса: JSON из файла, указанного в `--request`.
fn request_root(options: &Options) -> Result<Value> {
    let path = paths::existing_file(options.required("request")?, REQUEST_FILE)?;
    serde_json::from_slice(&fs::read(path)?).map_err(|_| Refusal::BrokenRequest.into())
}

fn run_request(options: &Options, _progress: &Progress) -> Result<Value> {
    let root = request_root(options)?;
    let files = root.get("weaponMetaFiles").and_then(Value::as_array);
    match files.filter(|listed| !listed.is_empty()) {
        Some(listed) => patch_batch(listed),
        None => Plan::from_node(&root, SINGLE_BINDINGS)?.execute(),
    }
}

const TRACER_PATCH: Command = Command::new(MODE, run_request);

pub const COMMANDS: &[Command] = &[TRACER_PATCH];

#[cfg(test)]
mod tests;
