//! `compile-place-types`: новый `.ytyp` из копий архетипов, взятых из файлов
//! типов игры и получивших новые имена. Запрос приходит из окна файлом JSON;
//! копирование поддеревьев и перечитывание делает `rage_res::place_types`,
//! здесь — проверка запроса, чтение источников и запись результата.

use std::collections::HashSet;
use std::fmt;
use std::path::{Path, PathBuf};

use rage_res::{
    hash::sha256_hex,
    meta_graph::{self, Read},
    place_types::{self, CloneSpec, Compiled},
    ymap_write::meta_name,
};
use serde_json::{json, Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Запрос не короче байта и не длиннее 512 КиБ; источник не длиннее 64 МиБ.
const REQUEST_LIMIT: u64 = 512 * 1024;
const SOURCE_LIMIT: u64 = 64 * 1024 * 1024;

/// Отказ по запросу; текст каждого — в `Display`, код у всех — `InvalidDataException`.
#[derive(Debug, PartialEq, Eq)]
enum Rejected {
    Size,
    Broken,
    UnknownFormat,
    TypesName,
    SourcesNotList,
    ClonesNotList,
    TooManySources,
    TooManyClones,
    SourceShape,
    SourceRepeats(String),
    SourceMissing(String),
    SourceNotTypes(String),
    CopyNames(String),
    CopyRepeats(String),
    CopySource(String),
    CopyHash(String),
    CopyArchetype(String),
    CopyDictionary(String),
    OutputName,
}

impl fmt::Display for Rejected {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Rejected::Size => {
                out.write_str("Place types request must be between 1 byte and 512 KiB.")
            }
            Rejected::Broken => out.write_str("Place types request is empty or broken."),
            Rejected::UnknownFormat => out.write_str("Place types request has an unknown format."),
            Rejected::TypesName => {
                out.write_str("Place types name must be lowercase letters, digits and underscores.")
            }
            Rejected::SourcesNotList => out.write_str("Place types sources must be a list."),
            Rejected::ClonesNotList => out.write_str("Place types clones must be a list."),
            Rejected::TooManySources => out.write_str("Place types take at most 64 source files."),
            Rejected::TooManyClones => out.write_str("Place types take at most 512 copies."),
            Rejected::SourceShape => out.write_str("Place types source needs an id and a file."),
            Rejected::SourceRepeats(id) => write!(out, "Place types source {id} repeats."),
            Rejected::SourceMissing(id) => {
                write!(out, "Place types source {id} is missing or too large.")
            }
            Rejected::SourceNotTypes(id) => {
                write!(out, "Place types source {id} is not a types file.")
            }
            Rejected::CopyNames(name) => {
                write!(out, "Place types copy {name} needs lowercase names.")
            }
            Rejected::CopyRepeats(name) => write!(out, "Place types copy {name} repeats."),
            Rejected::CopySource(name) => {
                write!(out, "Place types copy {name} names an unknown source.")
            }
            Rejected::CopyHash(name) => write!(
                out,
                "Place types copy {name}: archetype hash is not 32 bits."
            ),
            Rejected::CopyArchetype(name) => {
                write!(out, "Place types copy {name} needs an archetype.")
            }
            Rejected::CopyDictionary(name) => write!(
                out,
                "Place types copy {name}: dictionary name is not valid."
            ),
            Rejected::OutputName => out.write_str("Place types output must be a .ytyp file."),
        }
    }
}

impl From<Rejected> for EngineError {
    fn from(why: Rejected) -> Self {
        EngineError::invalid_data(why.to_string())
    }
}

/// Имя в запросе: строчные латинские буквы, цифры и `_`, с буквы или цифры, не длиннее 63 знаков.
fn is_slug(text: &str) -> bool {
    let mut bytes = text.bytes();
    let starts_well = bytes
        .next()
        .is_some_and(|head| head.is_ascii_lowercase() || head.is_ascii_digit());
    starts_well
        && text.len() <= 63
        && bytes.all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

/// Объект из запроса; не объект читается как пустой.
#[derive(Clone, Copy)]
struct Fields<'a>(Option<&'a Map<String, Value>>);

impl<'a> Fields<'a> {
    fn of(value: &'a Value) -> Self {
        Fields(value.as_object())
    }

    fn get(&self, key: &str) -> Option<&'a Value> {
        self.0?.get(key)
    }

    /// Строка поля, обрезанная по краям; поле другого вида или без значения — `None`.
    fn text(&self, key: &str) -> Option<&'a str> {
        Some(self.get(key)?.as_str()?.trim())
    }

    /// Непустая строка поля после обрезки.
    fn filled(&self, key: &str) -> Option<&'a str> {
        self.text(key).filter(|text| !text.is_empty())
    }

    /// Список поля; нет поля или `null` — пустой, иной вид — отказ.
    fn list(&self, key: &str, refusal: Rejected) -> std::result::Result<&'a [Value], Rejected> {
        match self.get(key) {
            None | Some(Value::Null) => Ok(&[]),
            Some(Value::Array(items)) => Ok(items.as_slice()),
            Some(_) => Err(refusal),
        }
    }
}

/// Файл-источник из запроса: идентификатор и путь, ещё не читанный.
struct Source<'a> {
    id: &'a str,
    file: &'a str,
}

impl<'a> Source<'a> {
    fn of(entry: &'a Value) -> std::result::Result<Self, Rejected> {
        let fields = Fields::of(entry);
        match (fields.filled("id"), fields.filled("file")) {
            (Some(id), Some(file)) => Ok(Source { id, file }),
            _ => Err(Rejected::SourceShape),
        }
    }

    /// Размер, чтение, разбор метаданных. Папка проходит проверку размера:
    /// отказ приходит от чтения (длина папки на разных томах бывает и нулевой).
    fn load(&self) -> Result<Read> {
        let path = paths::full_path(self.file)?;
        let allowed = match std::fs::metadata(&path) {
            Ok(meta) => meta.is_dir() || (1..=SOURCE_LIMIT).contains(&meta.len()),
            Err(_) => false,
        };
        if !allowed {
            return Err(Rejected::SourceMissing(self.id.to_owned()).into());
        }
        let bytes = std::fs::read(&path)?;
        match meta_graph::read(&bytes) {
            Ok(read) => Ok(read),
            Err(_) => Err(Rejected::SourceNotTypes(self.id.to_owned()).into()),
        }
    }
}

/// Одна копия из запроса, ещё не проверенная.
struct Wish<'a> {
    name: &'a str,
    fields: Fields<'a>,
}

impl<'a> Wish<'a> {
    fn of(entry: &'a Value) -> Self {
        let fields = Fields::of(entry);
        Wish {
            name: fields.text("name").unwrap_or(""),
            fields,
        }
    }

    /// Имя копии и имя ресурса — слова из `is_slug`; возвращает имя ресурса.
    fn asset(&self) -> std::result::Result<&'a str, Rejected> {
        let asset = self.fields.text("assetName").unwrap_or("");
        match is_slug(self.name) && is_slug(asset) {
            true => Ok(asset),
            false => Err(Rejected::CopyNames(self.name.to_owned())),
        }
    }

    /// Номер источника среди `ids`.
    fn source(&self, ids: &[String]) -> std::result::Result<usize, Rejected> {
        let wanted = self.fields.text("source");
        wanted
            .and_then(|wanted| ids.iter().position(|id| id == wanted))
            .ok_or_else(|| Rejected::CopySource(self.name.to_owned()))
    }

    /// Хеш исходного архетипа: число `archetypeHash` в пределах `u32`, а без него — имя `archetype` строчными.
    fn archetype_hash(&self) -> std::result::Result<u32, Rejected> {
        if let Some(number) = self.fields.get("archetypeHash").and_then(Value::as_u64) {
            return u32::try_from(number).or(Err(Rejected::CopyHash(self.name.to_owned())));
        }
        match self.fields.filled("archetype") {
            Some(archetype) => Ok(meta_name(&archetype.to_lowercase())),
            None => Err(Rejected::CopyArchetype(self.name.to_owned())),
        }
    }

    /// Словарь текстур или моделей: нет или пуст — без него, иначе слово из `is_slug`.
    fn dictionary(&self, key: &str) -> std::result::Result<Option<String>, Rejected> {
        match self.fields.filled(key) {
            Some(word) if !is_slug(word) => Err(Rejected::CopyDictionary(self.name.to_owned())),
            word => Ok(word.map(str::to_owned)),
        }
    }

    /// Проверки идут по порядку: имена, повтор, источник, хеш, словарь текстур, словарь моделей.
    fn into_spec(
        self,
        ids: &[String],
        seen: &mut HashSet<&'a str>,
    ) -> std::result::Result<CloneSpec, Rejected> {
        let asset = self.asset()?;
        if !seen.insert(self.name) {
            return Err(Rejected::CopyRepeats(self.name.to_owned()));
        }
        Ok(CloneSpec {
            source: self.source(ids)?,
            archetype_hash: self.archetype_hash()?,
            name: self.name.to_owned(),
            asset_name: asset.to_owned(),
            texture_dictionary: self.dictionary("textureDictionary")?,
            drawable_dictionary: self.dictionary("drawableDictionary")?,
        })
    }
}

/// Разобранный корень запроса: что в нём лежит списками и под каким именем строится файл.
struct Sheet<'a> {
    types_name: &'a str,
    sources: &'a [Value],
    clones: &'a [Value],
}

impl<'a> Sheet<'a> {
    fn open(root: &'a Value) -> std::result::Result<Self, Rejected> {
        let body = Fields::of(root);
        let stamp = (
            body.get("format").and_then(Value::as_str),
            body.get("version").and_then(Value::as_u64),
        );
        if stamp != (Some("astral.compile-place-types"), Some(1)) {
            return Err(Rejected::UnknownFormat);
        }
        let types_name = match body.get("typesName") {
            Some(Value::String(name)) if is_slug(name) => name.as_str(),
            _ => return Err(Rejected::TypesName),
        };
        let sources = body.list("sources", Rejected::SourcesNotList)?;
        let clones = body.list("clones", Rejected::ClonesNotList)?;
        let overflows = [
            (sources.len() > 64, Rejected::TooManySources),
            (clones.len() > 512, Rejected::TooManyClones),
        ];
        match overflows.into_iter().find(|(over, _)| *over) {
            Some((_, why)) => Err(why),
            None => Ok(Sheet {
                types_name,
                sources,
                clones,
            }),
        }
    }

    /// Читает файлы источников по порядку запроса; возвращает их `id` и разобранные метаданные.
    fn gather(&self) -> Result<(Vec<String>, Vec<Read>)> {
        let mut taken = HashSet::new();
        let mut ids = Vec::new();
        let mut files = Vec::new();
        for entry in self.sources {
            let source = Source::of(entry)?;
            if !taken.insert(source.id) {
                return Err(Rejected::SourceRepeats(source.id.to_owned()).into());
            }
            files.push(source.load()?);
            ids.push(source.id.to_owned());
        }
        Ok((ids, files))
    }

    /// Копии по порядку запроса; `ids` — идентификаторы источников в том же порядке, что и их файлы.
    fn copies(&self, ids: &[String]) -> std::result::Result<Vec<CloneSpec>, Rejected> {
        let mut seen = HashSet::new();
        self.clones
            .iter()
            .map(|entry| Wish::of(entry).into_spec(ids, &mut seen))
            .collect()
    }
}

/// Запрос и путь результата, как их назвала командная строка.
struct Job {
    input: PathBuf,
    target: PathBuf,
}

impl Job {
    fn of(options: &Options) -> Result<Self> {
        Ok(Job {
            input: paths::existing_file(options.required("input")?, &[".json"])?,
            target: paths::full_path(options.required("output")?)?,
        })
    }

    /// Байты запроса; размер проверен, расширение результата — ещё нет.
    fn request(&self) -> Result<Vec<u8>> {
        let length = std::fs::metadata(&self.input)?.len();
        match (1..=REQUEST_LIMIT).contains(&length) {
            true => Ok(std::fs::read(&self.input)?),
            false => Err(Rejected::Size.into()),
        }
    }
}

/// Куда и под каким именем ложится результат.
struct Delivery<'a> {
    target: &'a Path,
    shown: String,
}

impl<'a> Delivery<'a> {
    /// Расширение имени проверяется только теперь, когда результат уже собран.
    fn named(target: &'a Path) -> std::result::Result<Self, Rejected> {
        let shown = target
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        match shown.to_lowercase().ends_with(".ytyp") {
            true => Ok(Delivery { target, shown }),
            false => Err(Rejected::OutputName),
        }
    }

    fn save(&self, bytes: &[u8]) -> Result<()> {
        if let Some(parent) = self.target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomic(self.target, bytes)
    }

    fn reply(&self, compiled: &Compiled) -> Value {
        json!({
            "file": self.shown,
            "bytes": compiled.bytes.len(),
            "sha256": sha256_hex(&compiled.bytes),
            "semantic": {
                "semanticReopen": true,
                "archetypes": compiled.archetypes,
                "physics": compiled.physics,
            },
        })
    }
}

pub fn compile_place_types(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = Job::of(options)?;
    let root = serde_json::from_slice::<Value>(&job.request()?).or(Err(Rejected::Broken))?;
    let sheet = Sheet::open(&root)?;
    let (ids, files) = sheet.gather()?;
    let specs = sheet.copies(&ids)?;
    let compiled = place_types::compile(sheet.types_name, &files, &specs)?;
    let delivery = Delivery::named(&job.target)?;
    delivery.save(&compiled.bytes)?;
    Ok(delivery.reply(&compiled))
}

pub const COMMANDS: &[Command] = &[Command::new("compile-place-types", compile_place_types)];

#[cfg(test)]
mod tests;
