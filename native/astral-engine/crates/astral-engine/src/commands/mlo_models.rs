//! `compile-mlo-models`: свои модели внутри готового помещения игры (MLO).
//! Для каждой модели в файл типов добавляется архетип, а в набор сущностей
//! помещения — экземпляр модели, привязанный к комнате по точке. Запись делает
//! `rage_res::mlo::add_models`; здесь проверка запроса, перечитывание итога
//! и ответ. Любой отказ команды получает хвост «: пока на хосте.» — по нему
//! окно понимает, что запрос надо отдать хосту.

use std::collections::HashSet;
use std::fmt;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};

use rage_res::{
    hash::{joaat_case, sha256_hex},
    meta_graph,
    mlo::{self, NewModel},
};
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Запрос не больше мебибайта, основа не больше тридцати двух.
const REQUEST_LIMIT: u64 = 1024 * 1024;
const BASE_LIMIT: u64 = 32 * 1024 * 1024;
/// Допустимые координаты углов и точки, метры.
const COORDINATE: RangeInclusive<f64> = -2000.0..=2000.0;
const LOD_DISTANCE: RangeInclusive<f64> = 1.0..=5000.0;

/// Отказ по запросу или по итогу; текст — в `Display`, код у всех — `InvalidDataException`.
#[derive(Debug, PartialEq, Eq)]
enum Problem {
    Size,
    Broken,
    UnknownFormat,
    BaseSize,
    HashWidth,
    ModelCount,
    ModelName,
    Distance(String),
    Bits { owner: String, key: &'static str },
    Corner { owner: String, which: &'static str },
    Inverted(String),
    Position(String),
    ClipName,
    LostOnReopen,
}

impl fmt::Display for Problem {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Problem::Size => out.write_str("MLO models request must be between 1 byte and 1 MiB."),
            Problem::Broken => out.write_str("MLO models request is empty or broken."),
            Problem::UnknownFormat => out.write_str("MLO models request has an unknown format."),
            Problem::BaseSize => {
                out.write_str("MLO base must be an existing .ytyp file up to 32 MiB.")
            }
            Problem::HashWidth => out.write_str("MLO hash must be a 32-bit number."),
            Problem::ModelCount => out.write_str("MLO models request needs 1\u{2026}64 models."),
            Problem::ModelName => {
                out.write_str("MLO model name must be lowercase letters, digits and underscores.")
            }
            Problem::Distance(owner) => write!(out, "{owner}: lodDist must be 1\u{2026}5000."),
            Problem::Bits { owner, key } => {
                write!(out, "{owner}: {key} must be 0\u{2026}4294967295.")
            }
            Problem::Corner { owner, which } => {
                write!(out, "{owner} {which} must be three finite numbers.")
            }
            Problem::Inverted(owner) => write!(out, "Model {owner} has an inverted box."),
            Problem::Position(owner) => {
                write!(out, "{owner} position must be three finite numbers.")
            }
            Problem::ClipName => out.write_str(
                "MLO clip dictionary name must be lowercase letters, digits and underscores.",
            ),
            Problem::LostOnReopen => {
                out.write_str("Compiled interior .ytyp lost archetypes on reopen.")
            }
        }
    }
}

impl From<Problem> for EngineError {
    fn from(problem: Problem) -> Self {
        EngineError::invalid_data(problem.to_string())
    }
}

/// Хвост, по которому окно отправляет запрос хосту.
fn hand_to_host(failure: EngineError) -> EngineError {
    let EngineError { code, message } = failure;
    EngineError::new(code, format!("{message}: пока на хосте."))
}

/// Строчные латинские буквы, цифры и `_`; начинается не с `_`; от 1 до 63 знаков.
fn slug(text: &str) -> bool {
    let allowed = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_';
    (1..=63).contains(&text.len()) && !text.starts_with('_') && text.bytes().all(allowed)
}

/// Число из JSON, уложенное в диапазон; вне диапазона (и не число) — ничего.
fn narrow(value: &Value, span: &RangeInclusive<f64>) -> Option<f32> {
    value
        .as_f64()
        .filter(|number| span.contains(number))
        .map(|number| number as f32)
}

/// Имя модели: от него зависят тексты отказов по полям.
struct Named<'a>(&'a str);

impl Named<'_> {
    fn distance(&self) -> Problem {
        Problem::Distance(self.0.to_owned())
    }

    fn corner(&self, which: &'static str) -> Problem {
        Problem::Corner {
            owner: self.0.to_owned(),
            which,
        }
    }

    fn inverted(&self) -> Problem {
        Problem::Inverted(self.0.to_owned())
    }

    fn position(&self) -> Problem {
        Problem::Position(self.0.to_owned())
    }

    fn bits(&self, key: &'static str) -> Problem {
        Problem::Bits {
            owner: self.0.to_owned(),
            key,
        }
    }
}

/// Объект запроса; не объект читается как пустой.
struct Spec<'a>(Option<&'a Map<String, Value>>);

impl<'a> Spec<'a> {
    fn get(&self, key: &str) -> Option<&'a Value> {
        self.0.and_then(|fields| fields.get(key))
    }

    /// Строка поля; нет поля или не строка — пустая.
    fn text(&self, key: &str) -> &'a str {
        self.get(key).and_then(Value::as_str).unwrap_or("")
    }

    /// Ровно три числа в пределах `COORDINATE`.
    fn point(&self, key: &str) -> Option<[f32; 3]> {
        let Some(Value::Array(items)) = self.get(key) else {
            return None;
        };
        let [x, y, z] = items.as_slice() else {
            return None;
        };
        let [x, y, z] = [x, y, z].map(|axis| narrow(axis, &COORDINATE));
        Some([x?, y?, z?])
    }

    /// Нет поля или `null` — умолчание; иначе целое от 0 до 4294967295, прочее — отказ.
    fn bits(
        &self,
        owner: &Named,
        key: &'static str,
        fallback: u32,
    ) -> std::result::Result<u32, Problem> {
        match self.get(key) {
            None | Some(Value::Null) => Ok(fallback),
            Some(value) => value
                .as_u64()
                .and_then(|wide| u32::try_from(wide).ok())
                .ok_or_else(|| owner.bits(key)),
        }
    }

    /// Хеш из 32 бит; поля или `null` нет — хеша нет, не число или не влезло — отказ.
    fn optional_hash(&self, key: &str) -> std::result::Result<Option<u32>, Problem> {
        match self.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(number)) => number
                .as_u64()
                .and_then(|wide| u32::try_from(wide).ok())
                .map(Some)
                .ok_or(Problem::HashWidth),
            Some(_) => Err(Problem::HashWidth),
        }
    }

    fn name(&self) -> std::result::Result<&'a str, Problem> {
        match self.get("name") {
            Some(Value::String(text)) if slug(text) => Ok(text),
            _ => Err(Problem::ModelName),
        }
    }

    /// Имя набора анимаций: нет или `null` — без него, иное должно быть словом из `slug`.
    fn clip(&self) -> std::result::Result<Option<String>, Problem> {
        match self.get("clipDictionary") {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) if slug(text) => Ok(Some(text.clone())),
            Some(_) => Err(Problem::ClipName),
        }
    }

    /// Углы коробки: каждый — три числа, нижний не выше верхнего по всем осям.
    fn bounds(&self, owner: &Named) -> std::result::Result<([f32; 3], [f32; 3]), Problem> {
        let corner = |which: &'static str| self.point(which).ok_or_else(|| owner.corner(which));
        let low = corner("bbMin")?;
        let high = corner("bbMax")?;
        match (0..3).all(|axis| low[axis] <= high[axis]) {
            true => Ok((low, high)),
            false => Err(owner.inverted()),
        }
    }

    /// Модель после всех проверок в порядке полей.
    fn model(&self) -> std::result::Result<NewModel, Problem> {
        let name = self.name()?;
        let owner = Named(name);
        let lod_dist = self
            .get("lodDist")
            .and_then(|meters| narrow(meters, &LOD_DISTANCE))
            .ok_or_else(|| owner.distance())?;
        let (bb_min, bb_max) = self.bounds(&owner)?;
        let position = self.point("position").ok_or_else(|| owner.position())?;
        let clip_dictionary = self.clip()?;
        let flags = self.bits(&owner, "flags", 0)?;
        let entity_flags = self.bits(&owner, "entityFlags", 32)?;
        Ok(NewModel {
            name: name.to_owned(),
            lod_dist,
            bb_min,
            bb_max,
            flags,
            clip_dictionary,
            position,
            entity_flags,
        })
    }

    /// Метка и версия запроса.
    fn expect_format(&self) -> std::result::Result<(), Problem> {
        let kind = self.get("format").and_then(Value::as_str);
        let version = self.get("version").and_then(Value::as_u64);
        match (kind, version) {
            (Some("astral.compile-mlo-models"), Some(1)) => Ok(()),
            _ => Err(Problem::UnknownFormat),
        }
    }

    /// Файл основы: существует, `.ytyp`, от одного байта до тридцати двух мебибайт.
    fn base_file(&self) -> Result<PathBuf> {
        let path = paths::existing_file(self.text("base"), &[".ytyp"])?;
        let length = std::fs::metadata(&path).map_or(0, |meta| meta.len());
        match (1..=BASE_LIMIT).contains(&length) {
            true => Ok(path),
            false => Err(Problem::BaseSize.into()),
        }
    }

    /// От одной до шестидесяти четырёх моделей, каждая проверена.
    fn models(&self) -> Result<Vec<NewModel>> {
        match self.get("models") {
            Some(Value::Array(items)) if (1..=64).contains(&items.len()) => items
                .iter()
                .map(|item| Spec(item.as_object()).model())
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(EngineError::from),
            _ => Err(Problem::ModelCount.into()),
        }
    }
}

/// Разобранный запрос: основа, какое помещение брать и что вставлять.
struct Ask {
    base: PathBuf,
    wanted: Option<u32>,
    models: Vec<NewModel>,
}

impl Ask {
    fn read(root: &Value) -> Result<Self> {
        let body = Spec(root.as_object());
        body.expect_format()?;
        let base = body.base_file()?;
        let wanted = body.optional_hash("mlo")?;
        let models = body.models()?;
        Ok(Ask {
            base,
            wanted,
            models,
        })
    }

    /// Дописывает модели в основу и сверяет итог перечитыванием.
    fn compile(&self) -> Result<Compiled> {
        let base = std::fs::read(&self.base)?;
        let bytes = mlo::add_models(&base, self.wanted, &self.models)?;
        let census = reopened(&base, &bytes, &self.models)?;
        Ok(Compiled { bytes, census })
    }
}

/// Что видно в перечитанном файле типов: сколько архетипов, хеши имён обычных (не помещений) и сущности первого помещения.
struct Census {
    total: usize,
    plain: Vec<u32>,
    first_interior_entities: usize,
}

impl Census {
    fn of(bytes: &[u8]) -> Result<Self> {
        let types = mlo::read_ytyp(&meta_graph::read(bytes)?)?;
        let all = &types.archetypes;
        Ok(Census {
            total: all.len(),
            plain: all
                .iter()
                .filter(|archetype| archetype.mlo.is_none())
                .map(|archetype| archetype.name_hash)
                .collect(),
            first_interior_entities: all
                .iter()
                .flat_map(|archetype| archetype.mlo.as_ref())
                .next()
                .map_or(0, |interior| interior.entities.len()),
        })
    }
}

/// Сверка итога: архетипов столько же, сколько было, за вычетом заменённых по имени и с новыми.
fn reopened(base: &[u8], written: &[u8], models: &[NewModel]) -> Result<Census> {
    let before = Census::of(base)?;
    let after = Census::of(written)?;
    let fresh: HashSet<u32> = models.iter().map(|model| joaat_case(&model.name)).collect();
    let replaced = before
        .plain
        .iter()
        .filter(|hash| fresh.contains(hash))
        .count();
    let expected = before.total - replaced + models.len();
    (after.total == expected)
        .then_some(after)
        .ok_or_else(|| Problem::LostOnReopen.into())
}

/// Файлы команды: запрос и результат.
struct Files {
    input: PathBuf,
    output: PathBuf,
}

impl Files {
    fn of(options: &Options) -> Result<Self> {
        Ok(Files {
            input: paths::existing_file(options.required("input")?, &[".json"])?,
            output: paths::output_file(options.required("output")?, &[".ytyp"])?,
        })
    }

    fn request(&self) -> Result<Ask> {
        let length = std::fs::metadata(&self.input)?.len();
        if !(1..=REQUEST_LIMIT).contains(&length) {
            return Err(Problem::Size.into());
        }
        let text = std::fs::read(&self.input)?;
        let root = serde_json::from_slice::<Value>(&text).or(Err(Problem::Broken))?;
        Ask::read(&root)
    }
}

/// Готовый файл типов и то, что в нём нашлось при перечитывании.
struct Compiled {
    bytes: Vec<u8>,
    census: Census,
}

impl Compiled {
    fn describe(&self, output: &Path) -> Value {
        let file = output
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut answer = Map::new();
        let mut put = |key: &str, value: Value| answer.insert(key.to_owned(), value);
        put("format", "astral.mlo-models".into());
        put("version", 1.into());
        put("file", file.into());
        put("bytes", self.bytes.len().into());
        put("sha256", sha256_hex(&self.bytes).into());
        put("entities", self.census.first_interior_entities.into());
        put("archetypes", self.census.total.into());
        Value::Object(answer)
    }
}

fn run(options: &Options) -> Result<Value> {
    let files = Files::of(options)?;
    let compiled = files.request()?.compile()?;
    write_atomic(&files.output, &compiled.bytes)?;
    Ok(compiled.describe(&files.output))
}

pub fn compile_mlo_models(options: &Options, _progress: &Progress) -> Result<Value> {
    run(options).map_err(hand_to_host)
}

pub const COMMANDS: &[Command] = &[Command::new("compile-mlo-models", compile_mlo_models)];

#[cfg(test)]
mod tests;
