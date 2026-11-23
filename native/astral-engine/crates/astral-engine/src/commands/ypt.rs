//! `write-ypt-texture-patch`: подмена данных листов текстур в ядре эффектов `core.ypt`.
//!
//! Список «лист - DDS» проверяется целиком до чтения ядра; раскладку листа сверяет писатель
//! `rage_res::ypt::writer`, а запись идёт через черновик `shop::write_atomic`.

use std::{
    collections::HashSet,
    fmt, fs,
    path::{Path, PathBuf},
};

use rage_res::{
    hash::sha256_hex,
    resource::Resource,
    ypt::{
        self,
        writer::{patch_textures_with, Layout, TexturePatch},
    },
};
use serde_json::Value;

use super::shop::write_atomic;
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Сколько правок принимается за раз.
const PATCH_CAP: usize = 64;

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

enum Refusal<'a> {
    Unparsable,
    NotAList,
    NoSource(&'a str),
    TooMany,
    BadNames,
    Checksum(&'a str),
    Structure(&'a str),
}

impl Refusal<'_> {
    fn words(&self) -> String {
        match self {
            Refusal::Unparsable => "patches: JSON не разбирается.".to_owned(),
            Refusal::NotAList => "patches: нужен список.".to_owned(),
            Refusal::NoSource(name) => format!("patches: у {name} нет source."),
            Refusal::TooMany => format!("YPT texture patches: не больше {PATCH_CAP}."),
            Refusal::BadNames => "YPT texture patch names must be unique and non-empty.".to_owned(),
            Refusal::Checksum(name) => format!("YPT texture checksum mismatch: {name}"),
            Refusal::Structure(given) => format!("--structure: on или off, пришло «{given}»."),
        }
    }
}

impl fmt::Display for Refusal<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Refusal<'_>> for EngineError {
    fn from(refusal: Refusal<'_>) -> Self {
        match refusal {
            Refusal::Structure(_) => EngineError::argument(refusal.words()),
            _ => EngineError::invalid_data(refusal.words()),
        }
    }
}

/// Режим раскладки: слова `on` и `off` сравниваются точно; без параметра - `off`.
#[derive(Clone, Copy)]
enum Mode {
    Plain,
    Rebuilt,
}

impl Mode {
    fn choose(given: Option<&str>) -> Result<Mode> {
        match given.unwrap_or("off") {
            "off" => Ok(Mode::Plain),
            "on" => Ok(Mode::Rebuilt),
            other => Err(Refusal::Structure(other).into()),
        }
    }

    fn layout(self) -> Layout {
        match self {
            Mode::Plain => Layout::Identity,
            Mode::Rebuilt => Layout::Structured,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Список правок
// ---------------------------------------------------------------------------------------------

/// Элемент списка до чтения файлов.
struct Draft {
    name: String,
    source: Option<String>,
    sha256: Option<String>,
}

impl Draft {
    fn of(node: &Value) -> Draft {
        let text_at = |key: &str| node.get(key).and_then(Value::as_str);
        Draft {
            name: text_at("texture").unwrap_or_default().trim().to_owned(),
            source: text_at("source").map(str::to_owned),
            sha256: text_at("sha256").map(str::to_lowercase),
        }
    }

    /// Существующий `.dds` из `source`; нет поля - отказ с именем листа.
    fn locate(&self) -> Result<PathBuf> {
        match &self.source {
            Some(source) => paths::existing_file(source, &[".dds"]),
            None => Err(Refusal::NoSource(&self.name).into()),
        }
    }
}

/// Правка, прошедшая проверку файла и имени.
struct Ready {
    name: String,
    dds: Vec<u8>,
}

impl Ready {
    /// Имя не пусто и не повторяется, сумма файла (если задана) совпадает.
    fn admit(draft: Draft, file: &Path, taken: &mut HashSet<String>) -> Result<Ready> {
        if draft.name.is_empty() || !taken.insert(draft.name.to_lowercase()) {
            return Err(Refusal::BadNames.into());
        }
        let dds = fs::read(file)?;
        let mismatch = draft
            .sha256
            .as_deref()
            .is_some_and(|wanted| wanted != sha256_hex(&dds));
        if mismatch {
            return Err(Refusal::Checksum(&draft.name).into());
        }
        Ok(Ready {
            name: draft.name,
            dds,
        })
    }
}

fn read_drafts(path: &Path) -> Result<Vec<Draft>> {
    let text = fs::read_to_string(path)?;
    let document: Value = serde_json::from_str(&text).map_err(|_| Refusal::Unparsable)?;
    let items = document.as_array().ok_or(Refusal::NotAList)?;
    Ok(items.iter().map(Draft::of).collect())
}

/// Сначала у всех элементов проверяются `source` и файлы, потом число правок, потом имена и суммы.
fn prepare(drafts: Vec<Draft>) -> Result<Vec<Ready>> {
    let files = drafts
        .iter()
        .map(Draft::locate)
        .collect::<Result<Vec<_>>>()?;
    if drafts.len() > PATCH_CAP {
        return Err(Refusal::TooMany.into());
    }
    let mut taken = HashSet::new();
    drafts
        .into_iter()
        .zip(&files)
        .map(|(draft, file)| Ready::admit(draft, file, &mut taken))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------------------------

/// Проверенные пути и правки; ядро ещё не читалось.
struct Job {
    input: PathBuf,
    output: PathBuf,
    ready: Vec<Ready>,
}

impl Job {
    fn open(options: &Options) -> Result<Job> {
        let input = paths::existing_file(options.required("input")?, &[".ypt"])?;
        let output = paths::output_file(options.required("output")?, &[".ypt"])?;
        let list = paths::existing_file(options.required("patches")?, &[".json"])?;
        Ok(Job {
            input,
            output,
            ready: prepare(read_drafts(&list)?)?,
        })
    }

    /// Без правок ядро только проверяется на разбор и отдаётся как есть.
    fn result_for(&self, core: &[u8], mode: Mode) -> Result<Vec<u8>> {
        if self.ready.is_empty() {
            ypt::read(&Resource::parse(core)?)?;
            return Ok(core.to_vec());
        }
        let patches: Vec<TexturePatch> = self
            .ready
            .iter()
            .map(|item| TexturePatch {
                texture: item.name.clone(),
                dds: item.dds.clone(),
            })
            .collect();
        Ok(patch_textures_with(core, &patches, mode.layout())?)
    }
}

fn run_patch(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = Job::open(options)?;
    let core = fs::read(&job.input)?;
    let mode = Mode::choose(options.optional("structure"))?;
    let result = job.result_for(&core, mode)?;
    write_atomic(&job.output, &result)?;

    let names: Vec<&str> = job.ready.iter().map(|item| item.name.as_str()).collect();
    Ok(answer_of(&job.input, &job.output, &names, &core, &result))
}

/// Ответ команды. Маршрут приложения (`tryYptTextureOnEngine`, `rpf-composer.js`) берёт запись движка только
/// при `status: "ready"`, как и ответ помощника `ypt-texture-patch`; без этого слова приложение молча
/// отбрасывало готовый файл и записывало ядро помощником второй раз (16.11.2026). Остальные поля помощника,
/// которых у движка нет (правила, клоны, слоты следа), в этом ответе не нужны: такие запросы он не получает.
fn answer_of(input: &Path, output: &Path, names: &[&str], core: &[u8], result: &[u8]) -> Value {
    let mut answer = serde_json::Map::new();
    answer.insert("status".to_owned(), "ready".into());
    answer.insert("mode".to_owned(), "ypt-texture-patch".into());
    answer.insert("input".to_owned(), input.display().to_string().into());
    answer.insert("output".to_owned(), output.display().to_string().into());
    answer.insert("inputSha256".to_owned(), sha256_hex(core).into());
    answer.insert("outputSha256".to_owned(), sha256_hex(result).into());
    answer.insert("patched".to_owned(), names.len().into());
    answer.insert("textures".to_owned(), names.to_vec().into());
    answer.insert("sourceBytes".to_owned(), core.len().into());
    answer.insert("outputBytes".to_owned(), result.len().into());
    answer.insert("unchanged".to_owned(), names.is_empty().into());
    Value::Object(answer)
}

const WRITE_PATCH: Command = Command::new("write-ypt-texture-patch", run_patch);

pub const COMMANDS: &[Command] = &[WRITE_PATCH];

#[cfg(test)]
mod tests;
