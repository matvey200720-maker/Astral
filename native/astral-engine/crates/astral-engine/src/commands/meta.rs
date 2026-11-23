//! `compile-timecycle-box`: запрос окна на «коробку модификатора таймцикла»
//! превращается в карту `.ymap` с одной такой коробкой. Формат файла пишет
//! `rage_res::ymap_write`; здесь только проверка запроса, перевод в `f32`,
//! рамки карты и запись. Один и тот же запрос даёт одни и те же байты.

use std::fmt;
use std::path::PathBuf;

use rage_res::hash::sha256_hex;
use rage_res::ymap_write::{self, Extents, TimeCycleBox};
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

pub const COMMANDS: &[Command] = &[Command::new("compile-timecycle-box", compile_timecycle_box)];

/// Что может быть не так с запросом; текст каждого отказа — в `Display`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Defect {
    Unreadable,
    UnknownFormat,
    MapName,
    ModifierName,
    Low,
    High,
    NotAscending,
    PercentageKind,
    RangeKind,
    PercentageSpan,
    RangeSpan,
    Hours,
}

impl fmt::Display for Defect {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(match self {
            Defect::Unreadable => "compile-timecycle-box: запрос не читается.",
            Defect::UnknownFormat => "compile-timecycle-box: неизвестный формат запроса.",
            Defect::MapName => "Timecycle-box map name is not valid.",
            Defect::ModifierName => "Timecycle-box modifier name is not valid.",
            Defect::Low => "Timecycle-box min must be three numbers within the world.",
            Defect::High => "Timecycle-box max must be three numbers within the world.",
            Defect::NotAscending => "Timecycle-box min must be below max.",
            Defect::PercentageKind => "Timecycle-box percentage must be a number.",
            Defect::RangeKind => "Timecycle-box range must be a number.",
            Defect::PercentageSpan => "Timecycle-box percentage must be 0\u{2026}100.",
            Defect::RangeSpan => "Timecycle-box range must be 0\u{2026}2000.",
            Defect::Hours => "Timecycle-box hours must be 0\u{2026}24.",
        })
    }
}

impl From<Defect> for EngineError {
    fn from(defect: Defect) -> Self {
        EngineError::invalid_data(defect.to_string())
    }
}

/// Поля корня запроса с читателями по видам значений.
struct Doc<'a>(&'a Map<String, Value>);

impl<'a> Doc<'a> {
    /// Корень — объект нужного формата и версии, иначе «неизвестный формат».
    fn open(root: &'a Value) -> std::result::Result<Self, Defect> {
        let body = root.as_object().ok_or(Defect::UnknownFormat)?;
        let pinned = body.get("format").and_then(Value::as_str) == Some("astral.timecycle-box")
            && body.get("version").and_then(Value::as_u64) == Some(1);
        pinned.then_some(Doc(body)).ok_or(Defect::UnknownFormat)
    }

    /// Имя: после обрезки от 1 знака до `longest`, все знаки подходят.
    fn word(
        &self,
        key: &str,
        longest: usize,
        suits: fn(u8) -> bool,
        defect: Defect,
    ) -> std::result::Result<String, Defect> {
        let text = self.0.get(key).and_then(Value::as_str).unwrap_or("").trim();
        (!text.is_empty() && text.len() <= longest && text.bytes().all(suits))
            .then(|| text.to_owned())
            .ok_or(defect)
    }

    /// Три конечных числа не больше 20000 по модулю.
    fn corner(&self, key: &str, defect: Defect) -> std::result::Result<[f64; 3], Defect> {
        let in_world = |item: &Value| {
            item.as_f64()
                .filter(|number| number.is_finite() && number.abs() <= 20_000.0)
        };
        let list = self.0.get(key).and_then(Value::as_array).ok_or(defect)?;
        match list
            .iter()
            .map(in_world)
            .collect::<Option<Vec<f64>>>()
            .as_deref()
        {
            Some(&[x, y, z]) => Ok([x, y, z]),
            _ => Err(defect),
        }
    }

    /// Число или, если поля нет (или `null`), значение по умолчанию.
    fn scalar(&self, key: &str, fallback: f64, defect: Defect) -> std::result::Result<f64, Defect> {
        match self.0.get(key).filter(|value| !value.is_null()) {
            None => Ok(fallback),
            Some(value) => value.as_f64().ok_or(defect),
        }
    }

    /// Целый час 0…24 или значение по умолчанию.
    fn hour(&self, key: &str, fallback: u32) -> std::result::Result<u32, Defect> {
        match self.0.get(key).filter(|value| !value.is_null()) {
            None => Ok(fallback),
            Some(value) => value
                .as_u64()
                .and_then(|hour| u32::try_from(hour).ok())
                .filter(|hour| *hour <= 24)
                .ok_or(Defect::Hours),
        }
    }
}

fn map_word(byte: u8) -> bool {
    matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_')
}

fn modifier_word(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

/// Проверенный запрос; числа ещё в `f64`, как их прочли.
struct Request {
    map_name: String,
    modifier: String,
    corners: [[f64; 3]; 2],
    percentage: f64,
    range: f64,
    hours: [u32; 2],
}

impl Request {
    fn read(root: &Value) -> std::result::Result<Self, Defect> {
        let doc = Doc::open(root)?;
        let map_name = doc.word("name", 48, map_word, Defect::MapName)?;
        let modifier = doc.word("modifier", 64, modifier_word, Defect::ModifierName)?;
        let corners = [
            doc.corner("min", Defect::Low)?,
            doc.corner("max", Defect::High)?,
        ];
        if !corners[0]
            .iter()
            .zip(&corners[1])
            .all(|(below, above)| below < above)
        {
            return Err(Defect::NotAscending);
        }
        let percentage = doc.scalar("percentage", 100.0, Defect::PercentageKind)?;
        let range = doc.scalar("range", 0.0, Defect::RangeKind)?;
        let spans = [
            (percentage, 0.0..=100.0, Defect::PercentageSpan),
            (range, 0.0..=2000.0, Defect::RangeSpan),
        ];
        if let Some((_, _, defect)) = spans.iter().find(|(value, span, _)| !span.contains(value)) {
            return Err(*defect);
        }
        let hours = [doc.hour("startHour", 0)?, doc.hour("endHour", 24)?];
        Ok(Self {
            map_name,
            modifier,
            corners,
            percentage,
            range,
            hours,
        })
    }

    /// Файл карты: потоковая рамка шире сущностей на `range` с каждой стороны.
    fn render(&self) -> Result<Vec<u8>> {
        let [min, max] = self.corners.map(|corner| corner.map(|value| value as f32));
        let margin = self.range as f32;
        let extents = Extents {
            streaming_min: min.map(|value| value - margin),
            streaming_max: max.map(|value| value + margin),
            entities_min: min,
            entities_max: max,
        };
        let shape = TimeCycleBox {
            modifier: self.modifier.clone(),
            min,
            max,
            percentage: self.percentage as f32,
            range: margin,
            start_hour: self.hours[0],
            end_hour: self.hours[1],
        };
        let bytes = ymap_write::timecycle_map(
            &self.map_name,
            extents,
            &[shape],
            "Astral",
            "06 October 2026 00:00",
        )?;
        Ok(bytes)
    }

    fn file_name(&self) -> String {
        [self.map_name.as_str(), "ymap"].join(".")
    }

    /// Хеш модификатора считается от строчной формы имени.
    fn modifier_hash(&self) -> u32 {
        ymap_write::meta_name(&self.modifier.to_ascii_lowercase())
    }
}

/// Вход команды: текст запроса и папка вывода.
struct Job {
    text: String,
    folder: PathBuf,
}

impl Job {
    fn open(options: &Options) -> Result<Self> {
        let input = paths::existing_file(options.required("input")?, &[".json"])?;
        let folder = paths::full_path(options.required("output")?)?;
        Ok(Self {
            text: std::fs::read_to_string(input)?,
            folder,
        })
    }

    fn request(&self) -> Result<Request> {
        let root: Value = serde_json::from_str(&self.text).map_err(|_| Defect::Unreadable)?;
        Ok(Request::read(&root)?)
    }

    /// Папка создаётся только теперь; файл пишется через черновик рядом под итоговым именем.
    fn store(&self, name: &str, bytes: &[u8]) -> Result<()> {
        std::fs::create_dir_all(&self.folder)?;
        write_atomic(&self.folder.join(name), bytes)?;
        Ok(())
    }
}

pub fn compile_timecycle_box(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = Job::open(options)?;
    let request = job.request()?;
    let bytes = request.render()?;
    let file = request.file_name();
    job.store(&file, &bytes)?;

    let mut semantic = Map::new();
    semantic.insert("semanticReopen".into(), true.into());
    semantic.insert("boxes".into(), 1.into());
    let mut answer = Map::new();
    for (key, value) in [
        ("file", Value::from(file)),
        ("bytes", bytes.len().into()),
        ("sha256", sha256_hex(&bytes).into()),
        ("modifierHash", request.modifier_hash().into()),
        ("semantic", Value::Object(semantic)),
    ] {
        answer.insert(key.to_owned(), value);
    }
    Ok(Value::Object(answer))
}

#[cfg(test)]
mod tests;
