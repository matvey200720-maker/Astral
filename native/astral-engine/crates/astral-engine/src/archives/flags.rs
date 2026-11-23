//! Команда `describe-archive`: описание архива с флагами для паритетной сверки.
//!
//! Открывает архив и отдаёт построчное описание, которое строит `rage_rpf`.
//! Команда всегда требует ключи, даже для архива с открытым оглавлением.

use std::path::PathBuf;

use rage_rpf::{describe::describe_flags, Archive};
use serde_json::Value;

use super::load_keys;
use crate::{args::Options, error::Result, paths, progress::Progress};

/// Порядок отказов: `--input`, путь не пуст, файл есть, расширение `.rpf`,
/// ключи, открытие архива. Ход и отмена не поддерживаются.
pub fn describe_archive(options: &Options, _progress: &Progress) -> Result<Value> {
    let (input, archive) = open_input(options)?;
    let lines = describe_flags(&archive);

    // Порядок вставки - порядок ключей в ответе.
    let count = lines.len();
    let fields = [
        ("input", Value::from(input.to_string_lossy().into_owned())),
        ("count", Value::from(count)),
        ("lines", Value::from(lines)),
    ];
    Ok(Value::Object(
        fields
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    ))
}

/// Входной файл и открытый по нему архив: проверка пути, ключи, открытие.
fn open_input(options: &Options) -> Result<(PathBuf, Archive)> {
    let named = options.required("input")?;
    let input = paths::existing_file(named, &[".rpf"])?;
    let (keys, _source) = load_keys(
        options.optional("game-root").unwrap_or_default(),
        options.optional("keys"),
    )?;
    let archive = Archive::open_path(&input, Some(keys))?;
    Ok((input, archive))
}
