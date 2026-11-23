//! `read-model-ars2`: модель игры (`.ydr`, `.ydd`, `.yft`) в компактный формат ARS2.
//!
//! Сам перевод делает `rage_res::gpu_model`; здесь решается, откуда взять файл,
//! какого он рода, куда положить готовые байты (хранилище ассетов канала
//! данных) и как собрать ответ. Окно забирает байты у движка по отпечатку.

use crate::{
    args::Options,
    error::{EngineError, Result},
    http, paths,
    progress::Progress,
};
use rage_res::{
    drawable::FileKind,
    gpu_model::{self, Ars2Model},
};
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// Расширения моделей и их род.
const MODEL_KINDS: [(&str, FileKind); 3] = [
    (".yft", FileKind::Yft),
    (".ydd", FileKind::Ydd),
    (".ydr", FileKind::Ydr),
];

/// Род модели по расширению полного пути (регистр не важен).
fn kind_of(path: &Path) -> Result<FileKind> {
    let extension = paths::extension_with_dot(path).to_lowercase();
    let refusal = || EngineError::argument("Только модели .ydr, .ydd и .yft переводятся в ARS2.");
    MODEL_KINDS
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|&(_, kind)| kind)
        .ok_or_else(refusal)
}

// ---------- файл модели ----------

/// Прочитанный файл модели и его род.
struct ModelFile {
    kind: FileKind,
    bytes: Vec<u8>,
}

impl ModelFile {
    /// `--input`: существующий файл с расширением модели, прочитанный целиком.
    fn load(options: &Options) -> Result<ModelFile> {
        let path = paths::existing_file(options.required("input")?, &[])?;
        let kind = kind_of(&path)?;
        Ok(ModelFile {
            kind,
            bytes: fs::read(&path)?,
        })
    }

    fn convert(&self, selector: Option<&str>) -> Result<Ars2Model> {
        Ok(gpu_model::model_to_ars2(
            &self.bytes,
            Some(self.kind),
            selector,
        )?)
    }
}

// ---------- хранилище ----------

/// Папка хранилища ассетов: байты ложатся в неё под своим отпечатком.
struct Store(PathBuf);

impl Store {
    /// `--assets-dir` (если не пуст) как есть, иначе настройка канала данных
    /// резидентного процесса, иначе умолчание.
    fn chosen(options: &Options) -> Store {
        let flagged = options
            .optional("assets-dir")
            .filter(|given| !given.chars().all(char::is_whitespace))
            .map(PathBuf::from);
        Store(flagged.unwrap_or_else(|| {
            http::Config::from_env().map_or_else(http::default_assets_dir, |config| config.assets)
        }))
    }

    /// Кладёт байты и возвращает отпечаток (он же имя файла).
    fn put(&self, bytes: &[u8]) -> Result<String> {
        Ok(http::store(&self.0, bytes)?)
    }
}

pub fn assets_dir(options: &Options) -> PathBuf {
    Store::chosen(options).0
}

// ---------- ответ ----------

/// Запись `{ключ: значение}`, которая собирается по ключам в нужном порядке.
struct Record(Map<String, Value>);

impl Record {
    fn new() -> Record {
        Record(Map::new())
    }

    fn with(mut self, key: &str, value: impl Into<Value>) -> Record {
        self.0.insert(key.to_owned(), value.into());
        self
    }

    fn finish(self) -> Value {
        Value::Object(self.0)
    }
}

/// Ответ команды: описание модели и отпечаток уже лежащих в хранилище байт.
fn describe(sha256: &str, model: &Ars2Model) -> Value {
    let batches: Vec<Value> = model
        .batches
        .iter()
        .map(|batch| {
            Record::new()
                .with("material", batch.material.as_str())
                .with("first", batch.first)
                .with("count", batch.count)
                .finish()
        })
        .collect();
    // Уровень один и считается здесь, а не берётся из модели.
    let high = Record::new()
        .with("name", "#high")
        .with("first", 0)
        .with("count", model.indices)
        .finish();
    Record::new()
        .with("sha256", sha256)
        .with("bytes", model.bytes.len())
        .with("format", "ARS2")
        .with("formatVersion", 1)
        .with("vertices", model.vertices)
        .with("indices", model.indices)
        .with("batches", batches)
        .with("lods", vec![high])
        .with("drawable", model.drawable.clone())
        .with("drawables", model.drawables.clone())
        .finish()
}

/// Кладёт байты модели в хранилище `dir` и собирает ответ.
fn publish(dir: &Path, model: &Ars2Model) -> Result<Value> {
    let store = Store(dir.to_path_buf());
    let sha256 = store.put(&model.bytes)?;
    Ok(describe(&sha256, model))
}

pub fn read_model_ars2(options: &Options, progress: &Progress) -> Result<Value> {
    let file = ModelFile::load(options)?;
    progress.report("ars2");
    let model = file.convert(options.optional("drawable"))?;
    // Папка хранилища выбирается только теперь: отказам перевода окружение не мешает.
    publish(&assets_dir(options), &model)
}

#[cfg(test)]
mod tests;
