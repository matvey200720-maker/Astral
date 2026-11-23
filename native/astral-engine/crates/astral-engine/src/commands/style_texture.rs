//! `style-texture`: стиль мира на текстуре игры целиком, со всеми ступенями.
//!
//! Ступени кодируются в формат (DXT1, DXT5 или A8R8G8B8), к получившейся текстуре применяется
//! стадия стиля, а на выходе два набора ступеней RGBA: до стиля и после.

use std::{collections::HashMap, fs, ops::RangeInclusive, path::Path};

use rage_res::{style, texture::Format};
use serde_json::{json, Map, Value};

use super::{shop::write_atomic, textures::check_report_path, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
    texture_levels::{codec_of, Codec, Level},
    texture_stages,
};

const SIDE_LIMITS: RangeInclusive<i64> = 4..=2048;
const LEVEL_LIMITS: RangeInclusive<i64> = 1..=12;
/// Форматы запроса (в верхнем регистре) и то, как их знает текстурный слой.
const FORMATS: [(&str, Format); 3] = [
    ("DXT1", Format::Dxt1),
    ("DXT5", Format::Dxt5),
    ("A8R8G8B8", Format::A8R8G8B8),
];
/// Байт на пиксель в файлах ступеней RGBA.
const RGBA_BYTES: usize = 4;

// ---------------------------------------------------------------------------------------------
// Отказы и запрос
// ---------------------------------------------------------------------------------------------

enum Refusal {
    EmptyRequest,
    Style(String),
    Format(String),
    Geometry,
    Filling,
}

impl From<Refusal> for EngineError {
    fn from(refusal: Refusal) -> Self {
        let (is_data, words) = match refusal {
            Refusal::EmptyRequest => (true, "Style request is empty.".to_owned()),
            Refusal::Style(name) => (false, format!("Unknown texture style: {name}")),
            Refusal::Format(name) => (false, format!("Unsupported texture format: {name}")),
            Refusal::Geometry => (
                false,
                "Texture sides must be 4–2048 pixels, levels 1–12.".to_owned(),
            ),
            Refusal::Filling => (true, "Levels do not fill the pixel file.".to_owned()),
        };
        if is_data {
            EngineError::invalid_data(words)
        } else {
            EngineError::argument(words)
        }
    }
}

/// Поля объекта запроса: ключ без учёта регистра, при повторе берётся первый по порядку в файле.
struct Document<'a> {
    fields: HashMap<String, &'a Value>,
}

impl<'a> Document<'a> {
    fn of(root: &'a Value) -> Document<'a> {
        let mut fields = HashMap::new();
        for (key, value) in root.as_object().into_iter().flatten() {
            fields.entry(key.to_ascii_lowercase()).or_insert(value);
        }
        Document { fields }
    }

    fn get(&self, wanted: &str) -> Option<&'a Value> {
        self.fields.get(&wanted.to_ascii_lowercase()).copied()
    }

    fn string(&self, wanted: &str) -> &'a str {
        self.get(wanted).and_then(Value::as_str).unwrap_or_default()
    }

    /// Целое число; всё, что целым не записано, равно нулю.
    fn number(&self, wanted: &str) -> i64 {
        self.get(wanted).and_then(Value::as_i64).unwrap_or_default()
    }

    /// Число в пределах или `None`.
    fn within(&self, wanted: &str, limits: &RangeInclusive<i64>) -> Option<usize> {
        let value = self.number(wanted);
        limits.contains(&value).then_some(value as usize)
    }
}

/// Проверенный запрос.
struct Plan {
    style: String,
    name: String,
    format: Format,
    width: usize,
    height: usize,
    levels: usize,
    pixels_in: String,
    pixels_out: String,
    pixels_before: Option<String>,
}

impl Plan {
    /// Порядок проверок: стиль, формат, размеры.
    fn parse(text: &str) -> Result<Plan> {
        let root = match serde_json::from_str::<Value>(text) {
            Ok(Value::Null) | Err(_) => return Err(Refusal::EmptyRequest.into()),
            Ok(root) => root,
        };
        let doc = Document::of(&root);

        let style = doc.string("style");
        if !style::is_style(style) {
            return Err(Refusal::Style(style.to_owned()).into());
        }
        let shouted = doc.string("format").to_uppercase();
        let Some(&(_, format)) = FORMATS.iter().find(|(label, _)| *label == shouted) else {
            return Err(Refusal::Format(shouted).into());
        };
        let (Some(width), Some(height), Some(levels)) = (
            doc.within("width", &SIDE_LIMITS),
            doc.within("height", &SIDE_LIMITS),
            doc.within("levels", &LEVEL_LIMITS),
        ) else {
            return Err(Refusal::Geometry.into());
        };
        let before = doc.string("pixelsBefore");
        Ok(Plan {
            style: style.to_owned(),
            name: doc.string("name").to_owned(),
            format,
            width,
            height,
            levels,
            pixels_in: doc.string("pixelsIn").to_owned(),
            pixels_out: doc.string("pixelsOut").to_owned(),
            pixels_before: (!before.is_empty()).then(|| before.to_owned()),
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Ступени
// ---------------------------------------------------------------------------------------------

/// Стороны всех ступеней по порядку, от самой крупной.
struct Ladder(Vec<(usize, usize)>);

impl Ladder {
    /// Сторона ступени - половинится на каждом шаге; блочные форматы округляют её вверх до кратной
    /// четырём (не меньше четырёх).
    fn of(plan: &Plan, codec: &Codec) -> Ladder {
        let side = |full: usize, step: usize| match codec.min {
            4 => (full >> step).max(1).next_multiple_of(4),
            _ => (full >> step).max(1),
        };
        Ladder(
            (0..plan.levels)
                .map(|step| (side(plan.width, step), side(plan.height, step)))
                .collect(),
        )
    }

    /// Размер файла ступеней RGBA подряд.
    fn rgba_total(&self) -> usize {
        self.0
            .iter()
            .map(|&(width, height)| width * height * RGBA_BYTES)
            .sum()
    }

    fn top(&self) -> (usize, usize) {
        self.0[0]
    }

    fn sizes(&self) -> Vec<Value> {
        self.0
            .iter()
            .map(|&(width, height)| json!({"width": width, "height": height}))
            .collect()
    }

    /// Ступени RGBA из файла кодируются в формат и склеиваются в тело текстуры.
    fn encode(&self, codec: &Codec, rgba: &[u8]) -> Result<Vec<u8>> {
        let (body, _) =
            self.0
                .iter()
                .try_fold((Vec::new(), rgba), |(mut body, rest), &(width, height)| {
                    let (mine, tail) = rest.split_at(width * height * RGBA_BYTES);
                    body.extend(
                        codec
                            .encode(mine, width, height)
                            .map_err(EngineError::invalid_operation)?,
                    );
                    Ok::<_, EngineError>((body, tail))
                })?;
        Ok(body)
    }

    /// Обратно: тело текстуры разжимается ступень за ступенью в RGBA подряд.
    fn decode(&self, codec: &Codec, body: &[u8]) -> Result<Vec<u8>> {
        let (rgba, _) = self.0.iter().try_fold(
            (Vec::with_capacity(self.rgba_total()), body),
            |(mut rgba, rest), &(width, height)| {
                let (mine, tail) = rest.split_at(codec.bytes(width, height).min(rest.len()));
                rgba.extend(
                    codec
                        .decode(mine, width, height)
                        .map_err(EngineError::invalid_operation)?,
                );
                Ok::<_, EngineError>((rgba, tail))
            },
        )?;
        Ok(rgba)
    }
}

/// Что получилось после стадии: ступени до и после, признак и формат после стадии.
struct Staged {
    before: Vec<u8>,
    after: Vec<u8>,
    changed: bool,
    format: Format,
}

fn stage(plan: &Plan, codec: &Codec, ladder: &Ladder, given: &[u8]) -> Result<Staged> {
    let (top_width, top_height) = ladder.top();
    let mut texture = Level {
        name: plan.name.clone(),
        format: plan.format,
        width: plan.width,
        height: plan.height,
        stride: codec.bytes(top_width, top_height) / top_height,
        levels: plan.levels,
        depth: 1,
        data: ladder.encode(codec, given)?,
    };
    let before = ladder.decode(codec, &texture.data)?;
    let changed = texture_stages::apply(&mut texture, &plan.style);
    Ok(Staged {
        before,
        after: ladder.decode(codec, &texture.data)?,
        changed,
        format: texture.format,
    })
}

fn run_style_texture(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = paths::existing_file(options.required("input")?, &[".json"])?;
    let report_path = options.required("output")?;
    let plan = Plan::parse(&fs::read_to_string(input)?)?;

    let given = fs::read(paths::full_path(&plan.pixels_in)?)?;
    let codec = codec_of(plan.format)
        .ok_or_else(|| EngineError::invalid_operation("Texture format has no codec."))?;
    let ladder = Ladder::of(&plan, &codec);
    if given.len() != ladder.rgba_total() {
        return Err(Refusal::Filling.into());
    }
    let staged = stage(&plan, &codec, &ladder, &given)?;

    // Все пути проверяются до первой записи: отказ не оставляет набор ступеней без отчёта.
    let before_path = plan
        .pixels_before
        .as_deref()
        .map(paths::full_path)
        .transpose()?;
    let out_path = paths::full_path(&plan.pixels_out)?;
    check_report_path(report_path)?;
    if let Some(path) = &before_path {
        write_atomic(path, &staged.before)?;
    }
    write_atomic(&out_path, &staged.after)?;

    let mut report = Map::new();
    report.insert("staged".to_owned(), staged.changed.into());
    report.insert(
        "format".to_owned(),
        format!("D3DFMT_{}", staged.format.name()).into(),
    );
    report.insert("levels".to_owned(), ladder.sizes().into());
    write_atomic(
        Path::new(report_path),
        Value::Object(report).to_string().as_bytes(),
    )?;
    Ok(json!({"output": report_path, "staged": staged.changed}))
}

const STYLE_TEXTURE: Command = Command::new("style-texture", run_style_texture);

pub const COMMANDS: &[Command] = &[STYLE_TEXTURE];

#[cfg(test)]
mod tests;
