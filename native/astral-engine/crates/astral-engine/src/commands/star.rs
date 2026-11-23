//! `compile-star-clip`: словарь клипов звезды (движение барабана и сдвиг развёртки) из того же запроса,
//! что читает `compile-star-model`. Модель `.ydr` команда не трогает.

use std::{borrow::Cow, fs, path::Path};

use rage_res::{
    hash::sha256_hex,
    star_clip::{self, Motion, UvAnimation},
};
use serde_json::Value;

use super::{lamp_mutations::is_same_file, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.compile-star-model";
const REQUEST_VERSION: u64 = 1;
const MOTION: &str = "motion";
const PICTURE: &str = "uvAnimation";

/// Чем запрос не годится; текст знает сама причина, приставку команды добавляет переход в `EngineError`.
enum Defect {
    Unreadable,
    UnknownFormat,
    NoName,
    NoDuration(&'static str),
    NoList(&'static str, &'static str),
    NotNumber(&'static str, &'static str),
    Unpaired,
}

impl Defect {
    fn words(&self) -> Cow<'static, str> {
        match self {
            Defect::Unreadable => "запрос не читается.".into(),
            Defect::UnknownFormat => "неизвестный формат запроса.".into(),
            Defect::NoName => "нет имени модели.".into(),
            Defect::NoDuration(owner) => format!("у {owner} нет длительности.").into(),
            Defect::NoList(owner, list) => format!("у {owner} нет списка «{list}».").into(),
            Defect::NotNumber(owner, list) => format!("в «{list}» у {owner} не число.").into(),
            Defect::Unpaired => format!("сдвиги {PICTURE} — пары (u, v).").into(),
        }
    }
}

impl From<Defect> for EngineError {
    fn from(defect: Defect) -> Self {
        EngineError::invalid_data(format!("compile-star-clip: {}", defect.words()))
    }
}

/// Точка чтения JSON: каждый шаг вглубь может оборваться, и тогда дальше читать нечего.
#[derive(Clone, Copy)]
struct Node<'a>(Option<&'a Value>);

impl<'a> Node<'a> {
    fn at(self, key: &str) -> Self {
        Self(self.0.and_then(|value| value.get(key)))
    }

    /// Раздел, который есть и не `null`.
    fn section(self, key: &str) -> Option<Self> {
        self.at(key)
            .0
            .filter(|value| !value.is_null())
            .map(|value| Self(Some(value)))
    }

    fn text(self) -> Option<&'a str> {
        self.0?.as_str()
    }

    fn natural(self) -> Option<u64> {
        self.0?.as_u64()
    }

    fn real(self) -> Option<f64> {
        self.0?.as_f64()
    }

    fn list(self) -> Option<&'a [Value]> {
        self.0?.as_array().map(Vec::as_slice)
    }
}

fn seconds(section: Node, owner: &'static str) -> Result<f32> {
    section
        .at("duration")
        .real()
        .map(|value| value as f32)
        .ok_or_else(|| Defect::NoDuration(owner).into())
}

/// Массив чисел под ключом; сначала нужен сам массив, потом каждый его элемент.
fn series(section: Node, owner: &'static str, key: &'static str) -> Result<Vec<f32>> {
    let items = section.at(key).list().ok_or(Defect::NoList(owner, key))?;
    items
        .iter()
        .map(|item| Node(Some(item)).real().map(|value| value as f32))
        .collect::<Option<_>>()
        .ok_or_else(|| Defect::NotNumber(owner, key).into())
}

fn read_motion(section: Node) -> Result<Motion> {
    Ok(Motion {
        duration: seconds(section, MOTION)?,
        lift: series(section, MOTION, "lift")?,
        angle: series(section, MOTION, "angle")?,
    })
}

fn read_picture(section: Node) -> Result<UvAnimation> {
    let flat = series(section, PICTURE, "shifts")?;
    let pairs = flat.chunks_exact(2);
    if !pairs.remainder().is_empty() {
        return Err(Defect::Unpaired.into());
    }
    let shifts = pairs.map(|pair| [pair[0], pair[1]]).collect();
    Ok(UvAnimation {
        duration: seconds(section, PICTURE)?,
        shifts,
    })
}

/// Запрос после разбора: имя клипа и два необязательных раздела.
struct Clips {
    name: String,
    motion: Option<Motion>,
    picture: Option<UvAnimation>,
}

impl TryFrom<&str> for Clips {
    type Error = EngineError;

    fn try_from(text: &str) -> Result<Self> {
        let root: Value = serde_json::from_str(text).map_err(|_| Defect::Unreadable)?;
        let top = Node(Some(&root));
        let known = top.at("format").text() == Some(REQUEST_FORMAT)
            && top.at("version").natural() == Some(REQUEST_VERSION);
        known.then_some(()).ok_or(Defect::UnknownFormat)?;
        let name = top.at("name").text().ok_or(Defect::NoName)?.to_owned();
        Ok(Self {
            name,
            motion: top.section(MOTION).map(read_motion).transpose()?,
            picture: top.section(PICTURE).map(read_picture).transpose()?,
        })
    }
}

impl Clips {
    fn dictionary(&self) -> Result<Vec<u8>> {
        Ok(star_clip::build_dictionary(
            &self.name,
            self.motion.as_ref(),
            self.picture.as_ref(),
        )?)
    }

    fn report(&self, target: &Path, bytes: &[u8]) -> Value {
        let frames = self
            .picture
            .as_ref()
            .map_or(0, |picture| picture.shifts.len());
        object([
            ("output", target.display().to_string().into()),
            ("bytes", bytes.len().into()),
            ("sha256", sha256_hex(bytes).into()),
            ("motion", self.motion.is_some().into()),
            ("uvFrames", frames.into()),
        ])
    }
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

pub fn compile_star_clip(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))?;
    let target = options.required("output").and_then(paths::full_path)?;
    let clips = Clips::try_from(fs::read_to_string(&input)?.as_str())?;
    let bytes = clips.dictionary()?;
    if target == input || is_same_file(&input, &target) {
        return Err(EngineError::argument(
            "--output must not be the input file.",
        ));
    }
    target.parent().map(fs::create_dir_all).transpose()?;
    write_atomic(&target, &bytes)?;
    Ok(clips.report(&target, &bytes))
}

const COMPILE_CLIP: Command = Command::new("compile-star-clip", compile_star_clip);

pub const COMMANDS: &[Command] = &[COMPILE_CLIP];

#[cfg(test)]
mod tests;
