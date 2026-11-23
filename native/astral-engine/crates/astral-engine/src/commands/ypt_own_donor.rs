//! `ypt-own-donor`: режим `ypt-own-donor` помощника в движке — словарь-донор своих правил автора редукса.
//!
//! `--request <файл.json>` с тем же телом, что получает помощник: `inputFile` (ядро автора), `outputFile`, `edition`,
//! `ruleNames` (от 1 до 64 правил эффектов), `ownTextures` (листы автора, остальные листы словаря обнуляются).
//! Ответ — форма ответа помощника: `status`, `mode`, `input`, `output`, `outputBytes`, `outputSha256`, `donor`.
//!
//! Из ядра остаются только названные правила, их эмиттеры, частицы и листы; пиксели листов игры (не из `ownTextures`)
//! нулевые. Ядро Enhanced пока пишет помощник: такой запрос отказывается кодом `NotInEngine`.

use std::fs;

use rage_res::{hash::sha256_hex, ypt::own_donor};
use serde_json::Value;

use super::shop::write_atomic;
use super::ypt_io::{helper_file, lift, object, read_core, strings, text_field, text_list};
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const COMMAND_NAME: &str = "ypt-own-donor";
/// Код отказа для частей запроса, которые пока пишет помощник.
pub const NOT_IN_ENGINE: &str = "NotInEngine";

/// `Path.GetFullPath` помощника: пустой путь — отказ его словами, относительный — от текущего каталога.
fn output_path(value: Option<&str>) -> Result<std::path::PathBuf> {
    let text = value.unwrap_or_default();
    if text.is_empty() {
        return Err(EngineError::argument("The path is empty. (Parameter 'path')"));
    }
    paths::full_path(text)
}

fn run(options: &Options, _progress: &Progress) -> Result<Value> {
    let request_path = paths::existing_file(options.required("request")?, &[".json"])?;
    let text = fs::read_to_string(&request_path)?;
    let document: Value = serde_json::from_str(&text).map_err(|error| {
        EngineError::invalid_data(format!("The request is not valid JSON: {error}"))
    })?;
    let edition = text_field(&document, "edition", "$")?;
    let names = text_list(&document, "ruleNames")?;
    let own = text_list(&document, "ownTextures")?;
    if edition.as_deref().is_some_and(|edition| edition.eq_ignore_ascii_case("Enhanced")) {
        return Err(EngineError::new(
            NOT_IN_ENGINE,
            "ypt-own-donor: the Enhanced edition is not in the engine yet; the helper writes it.",
        ));
    }

    let input = helper_file(text_field(&document, "inputFile", "$")?.as_deref(), ".ypt")?;
    let output = output_path(text_field(&document, "outputFile", "$")?.as_deref())?;
    if !output.to_string_lossy().to_lowercase().ends_with(".ypt") {
        return Err(EngineError::invalid_data(
            "YPT output must use the .ypt extension.",
        ));
    }
    let bytes = read_core(&input)?;
    let (file, report) = own_donor::build(&bytes, &names, &own).map_err(lift)?;
    if let Some(folder) = output.parent() {
        fs::create_dir_all(folder)?;
    }
    write_atomic(&output, &file)?;
    Ok(object([
        ("status", Value::from("ready")),
        ("mode", Value::from("ypt-own-donor")),
        ("input", Value::from(input.display().to_string())),
        ("output", Value::from(output.display().to_string())),
        ("outputBytes", Value::from(file.len())),
        ("outputSha256", Value::from(sha256_hex(&file))),
        (
            "donor",
            object([
                ("effects", strings(&report.effects)),
                ("emitters", Value::from(report.emitters)),
                ("particles", Value::from(report.particles)),
                ("ownTextures", strings(&report.own_textures)),
                ("gameTextures", strings(&report.game_textures)),
            ]),
        ),
    ]))
}

const YPT_OWN_DONOR: Command = Command::new(COMMAND_NAME, run);

pub const COMMANDS: &[Command] = &[YPT_OWN_DONOR];

#[cfg(test)]
mod tests;
