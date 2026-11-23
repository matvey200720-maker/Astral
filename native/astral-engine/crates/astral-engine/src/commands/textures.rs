//! `style-pixels`: правило стиля мира применяется к кадру RGBA из файла.
//!
//! Запрос читается мягко (ключи без учёта регистра, значение не того типа равно отсутствию),
//! а отказы идут в порядке хоста: стиль, стороны, подробность, чтение кадра, запись.

use std::{collections::HashMap, fs, io::ErrorKind, ops::RangeInclusive, path::Path};

use rage_res::style;
use serde_json::{json, Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const SIDES: RangeInclusive<i64> = 1..=4096;
const DETAIL: RangeInclusive<i64> = 0..=256;
/// Байт на пиксель кадра RGBA.
const PIXEL_BYTES: usize = 4;

// ---------------------------------------------------------------------------------------------
// Отказы и запрос
// ---------------------------------------------------------------------------------------------

/// Отказы разбора запроса; каждый знает свой код и слова хоста.
enum Refusal {
    EmptyRequest,
    UnknownStyle(String),
    BadSides,
    BadDetail,
    FrameMismatch,
}

impl From<Refusal> for EngineError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::EmptyRequest => EngineError::invalid_data("Style request is empty."),
            Refusal::FrameMismatch => {
                EngineError::invalid_data("Frame size does not match its sides.")
            }
            Refusal::UnknownStyle(name) => {
                EngineError::argument(format!("Unknown texture style: {name}"))
            }
            Refusal::BadSides => EngineError::argument("Frame sides must be 1–4096 pixels."),
            Refusal::BadDetail => EngineError::argument("Style detail must be 0–256."),
        }
    }
}

/// Поля объекта запроса: ключ без учёта регистра, при повторе берётся первый по порядку в файле.
struct Fields<'a> {
    by_key: HashMap<String, &'a Value>,
}

impl<'a> Fields<'a> {
    fn of(root: &'a Value) -> Fields<'a> {
        let mut by_key = HashMap::new();
        if let Some(object) = root.as_object() {
            for (key, value) in object {
                by_key.entry(key.to_ascii_lowercase()).or_insert(value);
            }
        }
        Fields { by_key }
    }

    fn raw(&self, wanted: &str) -> Option<&'a Value> {
        self.by_key.get(&wanted.to_ascii_lowercase()).copied()
    }

    fn text(&self, wanted: &str) -> &'a str {
        self.raw(wanted).and_then(Value::as_str).unwrap_or_default()
    }

    /// Целое в пределах или `None`; всё, что целым не записано, пределов не проходит.
    fn whole_within(&self, wanted: &str, limits: &RangeInclusive<i64>) -> Option<i64> {
        self.raw(wanted)
            .and_then(Value::as_i64)
            .filter(|value| limits.contains(value))
    }
}

/// Разобранный и проверенный запрос.
struct Job {
    style: String,
    width: usize,
    height: usize,
    detail: Option<i32>,
    pixels_in: String,
    pixels_out: String,
}

impl Job {
    /// Порядок проверок: стиль, стороны, подробность.
    fn parse(text: &str) -> Result<Job> {
        let document = match serde_json::from_str::<Value>(text) {
            Ok(Value::Null) | Err(_) => return Err(Refusal::EmptyRequest.into()),
            Ok(document) => document,
        };
        let fields = Fields::of(&document);

        let style = fields.text("style");
        if !style::is_style(style) {
            return Err(Refusal::UnknownStyle(style.to_owned()).into());
        }
        let width = fields
            .whole_within("width", &SIDES)
            .ok_or(Refusal::BadSides)?;
        let height = fields
            .whole_within("height", &SIDES)
            .ok_or(Refusal::BadSides)?;
        let detail = match fields.raw("detail") {
            None | Some(Value::Null) => None,
            Some(given) => {
                let in_range = given.as_i64().filter(|value| DETAIL.contains(value));
                Some(in_range.ok_or(Refusal::BadDetail)? as i32)
            }
        };
        Ok(Job {
            style: style.to_owned(),
            width: width as usize,
            height: height as usize,
            detail,
            pixels_in: fields.text("pixelsIn").to_owned(),
            pixels_out: fields.text("pixelsOut").to_owned(),
        })
    }

    fn frame_bytes(&self) -> usize {
        self.width * self.height * PIXEL_BYTES
    }

    /// Кадр из файла: путь не пуст, файл есть, длина равна `ширина × высота × 4`.
    fn read_frame(&self) -> Result<Vec<u8>> {
        paths::full_path(&self.pixels_in)?;
        let frame = fs::read(&self.pixels_in).map_err(|failure| match failure.kind() {
            ErrorKind::NotFound => {
                EngineError::file_not_found(format!("Could not find file '{}'.", self.pixels_in))
            }
            _ => failure.into(),
        })?;
        match frame.len() == self.frame_bytes() {
            true => Ok(frame),
            false => Err(Refusal::FrameMismatch.into()),
        }
    }

    /// Отчёт `--output`: одна строка JSON без перевода строки в конце.
    fn report(&self) -> String {
        let mut fields = Map::new();
        fields.insert("width".to_owned(), self.width.into());
        fields.insert("height".to_owned(), self.height.into());
        fields.insert("bytes".to_owned(), self.frame_bytes().into());
        Value::Object(fields).to_string()
    }
}

/// Файл-отчёт `--output` проверяется до записи любых файлов результата: путь не пуст (как у соседних
/// команд, через `paths`), папка у файла есть (папок команда не создаёт) и на его месте не папка.
/// Без этого отказ приходил уже после записи кадра.
pub(super) fn check_report_path(value: &str) -> Result<()> {
    let target = paths::full_path(value)?;
    if target.is_dir() {
        return Err(EngineError::argument(format!(
            "Report path is a folder: {}",
            target.display()
        )));
    }
    match target.parent() {
        Some(parent) if !parent.is_dir() => Err(EngineError::directory_not_found(format!(
            "Directory was not found: {}",
            parent.display()
        ))),
        _ => Ok(()),
    }
}

fn run_style_pixels(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = paths::existing_file(options.required("input")?, &[".json"])?;
    let report_path = options.required("output")?;

    let job = Job::parse(&fs::read_to_string(input)?)?;
    let mut frame = job.read_frame()?;
    style::style(&mut frame, job.width, job.height, &job.style, job.detail)?;

    paths::full_path(&job.pixels_out)?;
    check_report_path(report_path)?;
    write_atomic(Path::new(&job.pixels_out), &frame)?;
    write_atomic(Path::new(report_path), job.report().as_bytes())?;
    Ok(json!({"output": report_path, "bytes": frame.len()}))
}

const STYLE_PIXELS: Command = Command::new("style-pixels", run_style_pixels);

pub const COMMANDS: &[Command] = &[STYLE_PIXELS];

#[cfg(test)]
mod tests;
