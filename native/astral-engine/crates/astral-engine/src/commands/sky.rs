//! `compile-sky-clip`: клип полёта дирижабля (`.ycd`) из запроса мастерской неба. Пересчёт частоты и запись
//! словаря делает `rage_res::sky_clip`; здесь только разбор запроса и файл.

use std::{borrow::Cow, fs, path::Path};

use rage_res::{
    hash::sha256_hex,
    sky_clip::{self, Local},
};
use serde_json::Value;

use super::{lamp_mutations::is_same_file, shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const REQUEST_FORMAT: &str = "astral.compile-sky-flyer";
const REQUEST_VERSION: u64 = 1;
/// Сколько чисел в кадре: положение (3) и кватернион (4).
const FRAME_CELLS: usize = 7;

/// Какая дорожка запроса читается: от неё зависят тексты отказов.
#[derive(Clone, Copy)]
enum Track {
    Flight,
    Inner,
}

impl Track {
    fn word(self) -> &'static str {
        ["path", "local"][self as usize]
    }
}

/// Причины отказа разбора; приставка команды ставится при переходе в `EngineError`.
enum Defect {
    Unreadable,
    UnknownFormat,
    NoName,
    NoFlight,
    NoDuration,
    NoFrames(Track),
    NotSeven(Track),
    NotNumber(Track),
}

impl Defect {
    fn words(&self) -> Cow<'static, str> {
        match self {
            Defect::Unreadable => "запрос не читается.".into(),
            Defect::UnknownFormat => "неизвестный формат запроса.".into(),
            Defect::NoName => "нет имени модели.".into(),
            Defect::NoFlight => "нет пути полёта.".into(),
            Defect::NoDuration => format!("у {} нет длительности.", Track::Flight.word()).into(),
            Defect::NoFrames(track) => format!("у {} нет списка кадров.", track.word()).into(),
            Defect::NotSeven(track) => format!("кадр {} — семь чисел.", track.word()).into(),
            Defect::NotNumber(track) => format!("в кадре {} не число.", track.word()).into(),
        }
    }
}

impl From<Defect> for EngineError {
    fn from(defect: Defect) -> Self {
        EngineError::invalid_data(format!("compile-sky-clip: {}", defect.words()))
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

/// Кадр дорожки: ровно семь чисел.
fn frame_of(cell: &Value, track: Track) -> Result<[f64; FRAME_CELLS]> {
    let numbers = Node(Some(cell))
        .list()
        .filter(|numbers| numbers.len() == FRAME_CELLS);
    let numbers = numbers.ok_or(Defect::NotSeven(track))?;
    let values = numbers
        .iter()
        .map(|number| Node(Some(number)).real())
        .collect::<Option<Vec<f64>>>()
        .ok_or(Defect::NotNumber(track))?;
    values
        .try_into()
        .map_err(|_| Defect::NotSeven(track).into())
}

fn frames_of(owner: Node, track: Track) -> Result<Vec<[f64; FRAME_CELLS]>> {
    let cells = owner.at("frames").list().ok_or(Defect::NoFrames(track))?;
    cells.iter().map(|cell| frame_of(cell, track)).collect()
}

/// То, что запрос несёт для соседа: имя, путь и необязательное местное движение.
struct Flight {
    name: String,
    path: sky_clip::Path,
    inner: Option<Local>,
}

impl TryFrom<&str> for Flight {
    type Error = EngineError;

    fn try_from(text: &str) -> Result<Self> {
        let root: Value = serde_json::from_str(text).map_err(|_| Defect::Unreadable)?;
        let top = Node(Some(&root));
        let known = top.at("format").text() == Some(REQUEST_FORMAT)
            && top.at("version").natural() == Some(REQUEST_VERSION);
        known.then_some(()).ok_or(Defect::UnknownFormat)?;
        let name = top.at("name").text().ok_or(Defect::NoName)?.to_owned();
        let flight = Node(Some(top.at("path").0.ok_or(Defect::NoFlight)?));
        let duration = flight.at("duration").real().ok_or(Defect::NoDuration)?;
        let frames = frames_of(flight, Track::Flight)?;
        let inner = flight
            .section("local")
            .map(|section| frames_of(section, Track::Inner).map(|frames| Local { frames }))
            .transpose()?;
        Ok(Self {
            name,
            path: sky_clip::Path { duration, frames },
            inner,
        })
    }
}

impl Flight {
    fn dictionary(&self) -> Result<Vec<u8>> {
        Ok(sky_clip::build_dictionary(
            &self.name,
            &self.path,
            self.inner.as_ref(),
        )?)
    }

    fn report(&self, target: &Path, bytes: &[u8]) -> Value {
        object([
            ("output", target.display().to_string().into()),
            ("bytes", bytes.len().into()),
            ("sha256", sha256_hex(bytes).into()),
            ("frames", self.path.frames.len().into()),
            ("local", self.inner.is_some().into()),
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

pub fn compile_sky_clip(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))?;
    let target = options.required("output").and_then(paths::full_path)?;
    let flight = Flight::try_from(fs::read_to_string(&input)?.as_str())?;
    let bytes = flight.dictionary()?;
    if target == input || is_same_file(&input, &target) {
        return Err(EngineError::argument(
            "--output must not be the input file.",
        ));
    }
    target.parent().map(fs::create_dir_all).transpose()?;
    write_atomic(&target, &bytes)?;
    Ok(flight.report(&target, &bytes))
}

const COMPILE_CLIP: Command = Command::new("compile-sky-clip", compile_sky_clip);

pub const COMMANDS: &[Command] = &[COMPILE_CLIP];

#[cfg(test)]
mod tests;
