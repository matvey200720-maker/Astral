//! Модели и картинки: `convert-model`, `convert-models`, `create-image-card`, `extract-textures`,
//! `rename-texture` и вход в подмодуль `convert-scene`.
//!
//! Тонкая оболочка над `rage-res`: пути и расширения проверяются здесь, файлы читаются здесь,
//! преобразования готовые, ответ повторяет ответ прежнего хоста по именам и порядку ключей.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use rage_res::{
    card,
    convert::{self, Converted, Library},
    drawable::FileKind,
    ytd_edit,
};
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

mod scene;

/// Какие расширения что значат (регистр не важен).
const MODEL_KINDS: [(&str, FileKind); 3] = [
    (".ydr", FileKind::Ydr),
    (".ydd", FileKind::Ydd),
    (".yft", FileKind::Yft),
];
const SINGLE_KINDS: &[FileKind] = &[FileKind::Ydr, FileKind::Ydd, FileKind::Yft];
const BATCH_KINDS: &[FileKind] = &[FileKind::Ydr, FileKind::Yft];
const BATCH_LIMIT: usize = 256;
/// Допустимые расширения файлов: любое, словарь, GLB и картинка для карточки.
const ANY_FILE: &[&str] = &[];
const DICTIONARY_FILE: &[&str] = &[".ytd"];
const GLB_FILE: &[&str] = &[".glb"];
const IMAGE_FILE: &[&str] = &[".png", ".jpg", ".jpeg", ".webp"];
/// Знаки, которые в имени файла листа заменяются на `_`.
const UNSAFE_FILE_CHARS: &str = "\"<>|:*?\\/";
const FALLBACK_NAME: &str = "texture";
/// Имена устройств Windows: файл с таким именем (с любым расширением) не создать.
const DEVICE_NAMES: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
const NUMBERED_DEVICES: [&str; 2] = ["COM", "LPT"];
const CONVERSION_FAILED: &str = "Model conversion failed.";

/// Ответ команды: ключи идут в том порядке, в каком их вставили.
#[derive(Default)]
struct Reply(Map<String, Value>);

impl Reply {
    fn with(mut self, key: &str, value: impl Into<Value>) -> Reply {
        self.0.insert(key.to_owned(), value.into());
        self
    }

    fn path(self, key: &str, path: &Path) -> Reply {
        self.with(key, path.display().to_string())
    }

    fn sealed(self) -> Value {
        Value::Object(self.0)
    }
}

// ---------------------------------------------------------------------------------------------
// Пути и словари
// ---------------------------------------------------------------------------------------------

fn input_file(options: &Options, kinds: &[&str]) -> Result<PathBuf> {
    paths::existing_file(options.required("input")?, kinds)
}

fn output_file(options: &Options, kinds: &[&str]) -> Result<PathBuf> {
    paths::output_file(options.required("output")?, kinds)
}

/// Папка вывода по параметру `key`: полный путь, создаётся вместе с родителями.
fn output_folder(options: &Options, key: &str) -> Result<PathBuf> {
    let folder = paths::full_path(options.required(key)?)?;
    fs::create_dir_all(&folder)?;
    Ok(folder)
}

/// Все значения параметра обязаны быть существующими файлами, расширение не проверяется.
fn existing_all(values: &[String]) -> Result<Vec<PathBuf>> {
    values
        .iter()
        .map(|value| paths::existing_file(value, ANY_FILE))
        .collect()
}

/// Пара `--input` и `--output`, проверенная по расширениям.
struct Ends {
    input: PathBuf,
    output: PathBuf,
}

impl Ends {
    fn read(options: &Options, input_kinds: &[&str], output_kinds: &[&str]) -> Result<Ends> {
        Ok(Ends {
            input: input_file(options, input_kinds)?,
            output: output_file(options, output_kinds)?,
        })
    }

    /// Начало ответа: оба пути.
    fn reply(&self) -> Reply {
        Reply::default()
            .path("input", &self.input)
            .path("output", &self.output)
    }
}

/// Вид модели по расширению; `allowed` ограничивает набор видов.
fn model_kind(path: &Path, allowed: &[FileKind]) -> Option<FileKind> {
    let extension = paths::extension_with_dot(path).to_lowercase();
    MODEL_KINDS
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|&(_, kind)| kind)
        .filter(|kind| allowed.contains(kind))
}

/// Словари читаются и разбираются библиотекой; в неё имена файлов идут для порядка `+hi`.
fn load_library(files: &[PathBuf]) -> Result<Library> {
    let named = files
        .iter()
        .map(|file| -> Result<(String, Vec<u8>)> {
            let label = file
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            Ok((label, fs::read(file)?))
        })
        .collect::<Result<Vec<_>>>()?;
    Library::load(&named).map_err(EngineError::from)
}

/// Любой отказ преобразования - `InvalidOperationException`; точную фразу сосед отдаёт без приставки.
fn conversion_failure(error: rage_res::Error) -> EngineError {
    let said = match error.message.as_str() {
        CONVERSION_FAILED => error.message,
        other => format!("Model conversion failed: {other}"),
    };
    EngineError::invalid_operation(said)
}

fn to_glb(
    file: &Path,
    kind: FileKind,
    library: &Library,
    selector: Option<&str>,
) -> Result<Converted> {
    let bytes = fs::read(file)?;
    convert::model_to_glb(&bytes, Some(kind), library, selector).map_err(conversion_failure)
}

// ---------------------------------------------------------------------------------------------
// convert-model
// ---------------------------------------------------------------------------------------------

/// Проверенный вызов `convert-model`.
struct ModelJob<'a> {
    ends: Ends,
    kind: FileKind,
    textures: Vec<PathBuf>,
    selector: Option<&'a str>,
}

impl<'a> ModelJob<'a> {
    /// Порядок: вход и его вид, выход, словари, селектор.
    fn accept(options: &'a Options) -> Result<ModelJob<'a>> {
        let input = input_file(options, ANY_FILE)?;
        let kind = model_kind(&input, SINGLE_KINDS).ok_or_else(|| {
            EngineError::argument(
                "Only .ydr, .ydd and .yft model resources can be converted to GLB.",
            )
        })?;
        let output = output_file(options, GLB_FILE)?;
        Ok(ModelJob {
            ends: Ends { input, output },
            kind,
            textures: existing_all(options.values("texture"))?,
            selector: options.optional("drawable"),
        })
    }

    /// Разбор словарей, преобразование и запись `.glb`.
    fn convert(&self, progress: &Progress) -> Result<Converted> {
        progress.report("convert");
        let library = load_library(&self.textures)?;
        let converted = to_glb(&self.ends.input, self.kind, &library, self.selector)?;
        write_atomic(&self.ends.output, &converted.glb)?;
        Ok(converted)
    }

    fn reply(&self, converted: &Converted) -> Value {
        let base = self
            .ends
            .reply()
            .with("bytes", converted.glb.len())
            .with("textures", self.textures.len());
        match self.kind {
            FileKind::Ydd => base
                .with("drawable", self.selector)
                .with("drawables", converted.drawables.clone())
                .sealed(),
            _ => base.sealed(),
        }
    }
}

fn run_convert_model(options: &Options, progress: &Progress) -> Result<Value> {
    let job = ModelJob::accept(options)?;
    let converted = job.convert(progress)?;
    Ok(job.reply(&converted))
}

// ---------------------------------------------------------------------------------------------
// convert-models
// ---------------------------------------------------------------------------------------------

/// Партия: модели с видами, папка вывода, число словарей и разобранная библиотека.
struct Batch {
    members: Vec<(PathBuf, FileKind)>,
    directory: PathBuf,
    textures: usize,
    library: Library,
}

impl Batch {
    /// Входы партии: существование, число, потом вид каждого.
    fn members(options: &Options) -> Result<Vec<(PathBuf, FileKind)>> {
        let found = existing_all(options.values("input"))?;
        match found.len() {
            0 => {
                return Err(EngineError::argument(
                    "At least one --input model is required.",
                ))
            }
            count if count > BATCH_LIMIT => {
                return Err(EngineError::argument("Too many input models in one batch."))
            }
            _ => {}
        }
        found
            .into_iter()
            .map(|path| model_kind(&path, BATCH_KINDS).map(|kind| (path, kind)))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| {
                EngineError::argument("Only .ydr and .yft models can be batch-converted to GLB.")
            })
    }

    fn prepare(options: &Options) -> Result<Batch> {
        let members = Self::members(options)?;
        let directory = output_folder(options, "output-dir")?;
        let textures = existing_all(options.values("texture"))?;
        Ok(Batch {
            members,
            directory,
            library: load_library(&textures)?,
            textures: textures.len(),
        })
    }

    /// Одна модель партии: любая неудача даёт `None`, партия идёт дальше.
    fn convert_member(&self, source: &Path, kind: FileKind, target: &Path) -> Option<usize> {
        let converted = to_glb(source, kind, &self.library, None).ok()?;
        write_atomic(target, &converted.glb).ok()?;
        Some(converted.glb.len())
    }

    /// Строки ответа по моделям в порядке командной строки; ход идёт по номеру модели.
    /// Вход, чьё имя `.glb` уже занял более ранний вход запуска, не пишет файл и получает
    /// запись неудачи: иначе он молча затёр бы выход предыдущего (имена сравниваются без
    /// учёта регистра, как на Windows).
    fn convert_all(&self, progress: &Progress) -> Vec<Value> {
        let total = self.members.len() as u64;
        let mut taken: HashSet<String> = HashSet::new();
        let lines = self
            .members
            .iter()
            .enumerate()
            .map(|(index, (source, kind))| {
                progress.report_bytes("convert", index as u64, total);
                let glb_name = source.with_extension("glb");
                let glb_file = glb_name.file_name().unwrap_or_default();
                let target = self.directory.join(glb_file);
                let first_of_name = taken.insert(glb_file.to_string_lossy().to_lowercase());
                let written = first_of_name
                    .then(|| self.convert_member(source, *kind, &target))
                    .flatten();
                Reply::default()
                    .path("input", source)
                    .path("output", &target)
                    .with("ok", written.is_some())
                    .with("bytes", written.unwrap_or_default())
                    .sealed()
            })
            .collect();
        progress.report_bytes("convert", total, total);
        lines
    }
}

fn run_convert_models(options: &Options, progress: &Progress) -> Result<Value> {
    let batch = Batch::prepare(options)?;
    let models = batch.convert_all(progress);
    Ok(Reply::default()
        .path("outputDirectory", &batch.directory)
        .with("textures", batch.textures)
        .with("models", models)
        .sealed())
}

// ---------------------------------------------------------------------------------------------
// create-image-card
// ---------------------------------------------------------------------------------------------

fn run_image_card(options: &Options, _progress: &Progress) -> Result<Value> {
    let ends = Ends::read(options, IMAGE_FILE, GLB_FILE)?;
    let glb = card::build(&fs::read(&ends.input)?)?;
    write_atomic(&ends.output, &glb)?;
    Ok(ends.reply().with("bytes", glb.len()).sealed())
}

// ---------------------------------------------------------------------------------------------
// extract-textures
// ---------------------------------------------------------------------------------------------

/// Имя устройства Windows (`CON`, `NUL`, `COM1`…`COM9`, `LPT1`…`LPT9`) в любом регистре.
fn is_device_name(head: &str) -> bool {
    let upper = head.trim_end().to_ascii_uppercase();
    DEVICE_NAMES.contains(&upper.as_str())
        || NUMBERED_DEVICES.iter().any(|prefix| {
            upper
                .strip_prefix(prefix)
                .is_some_and(|digit| matches!(digit.as_bytes(), [b'1'..=b'9']))
        })
}

/// Имя файла листа: управляющие знаки и `" < > | : * ? \ /` заменяются на `_`, края срезаются,
/// пустое имя заменяется словом `texture`. Имя устройства Windows (часть до первой точки)
/// получает `_` после себя: `CON` -> `CON_`.
fn file_name_of(texture: &str) -> String {
    let replaced = texture.replace(
        |ch: char| ch.is_control() || UNSAFE_FILE_CHARS.contains(ch),
        "_",
    );
    let name = Some(replaced.trim())
        .filter(|kept| !kept.is_empty())
        .unwrap_or(FALLBACK_NAME);
    let (head, rest) = name.split_at(name.find('.').unwrap_or(name.len()));
    match is_device_name(head) {
        true => format!("{head}_{rest}"),
        false => name.to_owned(),
    }
}

/// Листы словаря пишутся в папку по одному PNG; возвращаются полные пути в порядке словаря.
/// Два листа с одним именем файла (регистр не важен, как на Windows) отказывают всю команду
/// до первой записи: иначе второй молча затирал бы первый.
fn write_sheets(directory: &Path, sheets: &[(String, Vec<u8>)]) -> Result<Vec<String>> {
    let names: Vec<String> = sheets
        .iter()
        .map(|(name, _)| format!("{}.png", file_name_of(name)))
        .collect();
    let mut seen = HashSet::new();
    if let Some(repeat) = names.iter().find(|name| !seen.insert(name.to_lowercase())) {
        return Err(EngineError::invalid_operation(format!(
            "Texture sheets share the file name {repeat}."
        )));
    }
    names
        .iter()
        .zip(sheets)
        .map(|(file, (_, png))| {
            let target = directory.join(file);
            write_atomic(&target, png)?;
            Ok(target.display().to_string())
        })
        .collect()
}

fn run_extract(options: &Options, progress: &Progress) -> Result<Value> {
    let input = input_file(options, DICTIONARY_FILE)?;
    let directory = output_folder(options, "output")?;

    progress.report("extract");
    let sheets = convert::extract_textures(&fs::read(&input)?)?;
    let files = write_sheets(&directory, &sheets)?;
    Ok(Reply::default()
        .path("input", &input)
        .path("output", &directory)
        .with("count", files.len())
        .with("files", files)
        .sealed())
}

// ---------------------------------------------------------------------------------------------
// rename-texture
// ---------------------------------------------------------------------------------------------

fn run_rename(options: &Options, progress: &Progress) -> Result<Value> {
    let ends = Ends::read(options, DICTIONARY_FILE, DICTIONARY_FILE)?;
    let (from, to) = (options.required("from")?, options.required("to")?);

    progress.report("rename");
    let renamed = ytd_edit::rename_texture(&fs::read(&ends.input)?, from, to)?;
    write_atomic(&ends.output, &renamed.bytes)?;
    Ok(ends
        .reply()
        .with("wasNoOp", renamed.was_noop)
        .with("bytes", renamed.bytes.len())
        .sealed())
}

// ---------------------------------------------------------------------------------------------
// Реестр
// ---------------------------------------------------------------------------------------------

const CONVERT_SCENE: Command = Command::new("convert-scene", scene::convert_scene);
const CONVERT_MODEL: Command = Command::new("convert-model", run_convert_model);
const CONVERT_MODELS: Command = Command::new("convert-models", run_convert_models);
const IMAGE_CARD: Command = Command::new("create-image-card", run_image_card);
const EXTRACT: Command = Command::new("extract-textures", run_extract);
const RENAME: Command = Command::new("rename-texture", run_rename);

pub const COMMANDS: &[Command] = &[
    CONVERT_SCENE,
    CONVERT_MODEL,
    CONVERT_MODELS,
    IMAGE_CARD,
    EXTRACT,
    RENAME,
];

#[cfg(test)]
mod tests;
