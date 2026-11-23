//! `compile-sky-rainbow`: набор радуги из заказа — модель на каждую ступень, словарь спектра, типы, карта и
//! манифест. Всё считает `rage_res::sky_rainbow`; донорская дуга берётся из файла игры. Любой отказ этого пути
//! говорит «пока на хосте»: приложение передаёт заказ хосту.

use std::{borrow::Cow, fs, path::Path};

use rage_res::{
    donor,
    hash::sha256_hex,
    sky_rainbow::{self, Tier},
    ytd_write,
};
use serde_json::Value;

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const ORDER_FORMAT: &str = "astral.compile-sky-rainbow";
const ORDER_VERSION: u64 = 4;
const ANSWER_FORMAT: &str = "astral.sky-rainbow";
const MAX_ORDER_BYTES: u64 = 4096;
const MAX_TIERS: usize = 5;
const DAY_HOURS: i64 = 24;
/// Четверть шага восьмибитного канала и запас в одну тысячную: ниже яркость не различима.
const QUIETEST: f32 = 0.25 / 256.0 * 0.999;
const BRIGHTEST: f32 = 3.0;

const SPECTRUM_FILE: &str = "astral_rainbow.ytd";
const TYPES_FILE: &str = "astral_rainbow.ytyp";
const MAP_FILE: &str = "astral_rainbow_map.ymap";
const MANIFEST_FILE: &str = "_manifest.ymf";

/// Отказ с хвостом «пока на хосте»; у каждого свой короткий заголовок.
enum Hold {
    Size,
    Unreadable,
    OtherFormat,
    NoDonor,
    NoTiers,
    TierCount,
    NoHours,
    HoursNotNumbers,
    HoursOutOfDay,
    SharedHour,
    BrightnessNotNumber,
    BrightnessOutOfRange,
    OutputBusy,
    DonorMissing,
    /// Этап сборки и сообщение соседа.
    Stage(&'static str, String),
}

impl Hold {
    fn headline(&self) -> Cow<'static, str> {
        let fixed = match self {
            Hold::Size => "Заказ радуги вне размера",
            Hold::Unreadable => "Заказ радуги не читается",
            Hold::OtherFormat => "Заказ радуги другого формата",
            Hold::NoDonor => "Радуга без донора",
            Hold::NoTiers => "В заказе нет ступеней",
            Hold::TierCount => "Число ступеней радуги вне предела",
            Hold::NoHours => "Ступень без часов",
            Hold::HoursNotNumbers => "Часы ступени не числа",
            Hold::HoursOutOfDay => "Часы радуги вне 0…23",
            Hold::SharedHour => "Две ступени радуги делят час",
            Hold::BrightnessNotNumber => "Яркость ступени не число",
            Hold::BrightnessOutOfRange => "Яркость радуги вне предела",
            Hold::OutputBusy => "Папка вывода радуги не пуста",
            Hold::DonorMissing => "Донор радуги не найден",
            Hold::Stage(stage, detail) => return Cow::Owned(format!("{stage}: {detail}")),
        };
        Cow::Borrowed(fixed)
    }
}

impl From<Hold> for EngineError {
    fn from(hold: Hold) -> Self {
        EngineError::argument(format!("{}: пока на хосте.", hold.headline()))
    }
}

/// Точка чтения JSON: каждый шаг вглубь может оборваться, и тогда дальше читать нечего.
#[derive(Clone, Copy)]
struct Node<'a>(Option<&'a Value>);

impl<'a> Node<'a> {
    fn at(self, key: &str) -> Self {
        Self(self.0.and_then(|value| value.get(key)))
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

/// Часы суток одной ступени как набор битов: дубли склеиваются, порядок — по возрастанию.
#[derive(Clone, Copy, PartialEq)]
struct DayMask(u32);

impl TryFrom<Node<'_>> for DayMask {
    type Error = EngineError;

    fn try_from(tier: Node<'_>) -> Result<Self> {
        let items = tier.at("hours").list().ok_or(Hold::NoHours)?;
        let hours = items
            .iter()
            .map(Value::as_i64)
            .collect::<Option<Vec<_>>>()
            .ok_or(Hold::HoursNotNumbers)?;
        let sane = (1..=DAY_HOURS as usize).contains(&hours.len())
            && hours.iter().all(|hour| (0..DAY_HOURS).contains(hour));
        sane.then(|| Self(hours.iter().fold(0, |mask, &hour| mask | 1u32 << hour)))
            .ok_or_else(|| Hold::HoursOutOfDay.into())
    }
}

impl DayMask {
    fn hours(self) -> Vec<u32> {
        (0..DAY_HOURS as u32)
            .filter(|hour| self.0 >> hour & 1 == 1)
            .collect()
    }
}

/// Яркость ступени: конечное число в пределах чувствительности канала и потолка.
fn brightness_of(tier: Node<'_>) -> Result<f32> {
    let level = tier
        .at("brightness")
        .real()
        .map(|value| value as f32)
        .filter(|level| level.is_finite())
        .ok_or(Hold::BrightnessNotNumber)?;
    (QUIETEST..=BRIGHTEST)
        .contains(&level)
        .then_some(level)
        .ok_or_else(|| Hold::BrightnessOutOfRange.into())
}

/// Заказ после проверок: путь донора и ступени.
struct Order {
    donor: String,
    tiers: Vec<Tier>,
}

impl Order {
    fn parse(bytes: &[u8]) -> Result<Self> {
        let root: Value = serde_json::from_slice(bytes).map_err(|_| Hold::Unreadable)?;
        let top = Node(Some(&root));
        let known = top.at("format").text() == Some(ORDER_FORMAT)
            && top.at("version").natural() == Some(ORDER_VERSION);
        known.then_some(()).ok_or(Hold::OtherFormat)?;
        let donor = top.at("donor").text().ok_or(Hold::NoDonor)?.to_owned();
        let raw = top.at("tiers").list().ok_or(Hold::NoTiers)?;
        (1..=MAX_TIERS)
            .contains(&raw.len())
            .then_some(())
            .ok_or(Hold::TierCount)?;
        // Часы занятых ступеней копятся в маске: общий час — отказ, пока ступень не прочитана целиком.
        let mut taken = 0u32;
        let tiers = raw
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let tier = Node(Some(entry));
                let mask = DayMask::try_from(tier)?;
                (mask.0 & taken == 0)
                    .then_some(())
                    .ok_or(Hold::SharedHour)?;
                taken |= mask.0;
                Ok(Tier {
                    asset: format!("astral_rainbow_{}", index + 1),
                    hours: mask.hours(),
                    brightness: brightness_of(tier)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self { donor, tiers })
    }

    /// Заказ из файла: размер смотрится по метаданным, до чтения.
    fn load(path: &Path) -> Result<Self> {
        let length = fs::metadata(path)?.len();
        (1..=MAX_ORDER_BYTES)
            .contains(&length)
            .then_some(())
            .ok_or(Hold::Size)?;
        Self::parse(&fs::read(path)?)
    }

    /// Все файлы набора в порядке записи; собираются целиком до первой записи на диск.
    fn assemble(&self, donor: &[u8]) -> Result<Vec<(String, Vec<u8>)>> {
        let stage = |name: &'static str| {
            move |error: rage_res::Error| EngineError::from(Hold::Stage(name, error.message))
        };
        let models =
            sky_rainbow::tier_models(donor, &self.tiers).map_err(stage("Модели ступеней"))?;
        let compiled = sky_rainbow::compile(&self.tiers).map_err(stage("Типы и карта радуги"))?;
        let manifest = sky_rainbow::manifest().map_err(stage("Манифест радуги"))?;
        // Вид и флаги листа спектра — как у хоста (`DIFFUSE`, `NOT_HALF, X32, X64, X128, UNK24`), а не как у нормалей игры.
        let sheet = sky_rainbow::spectrum_texture();
        let usage = donor::host_usage_data(sheet.width, sheet.height);
        let spectrum = ytd_write::write_with_usage(&[sheet], usage).map_err(stage("Спектр радуги"))?;
        let fixed = [
            (SPECTRUM_FILE, spectrum),
            (TYPES_FILE, compiled.types),
            (MAP_FILE, compiled.map),
            (MANIFEST_FILE, manifest),
        ];
        Ok(models
            .into_iter()
            .map(|(asset, bytes)| (format!("{asset}.ydr"), bytes))
            .chain(
                fixed
                    .into_iter()
                    .map(|(file, bytes)| (file.to_owned(), bytes)),
            )
            .collect())
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

fn describe(files: &[(String, Vec<u8>)]) -> Value {
    let cards: Vec<Value> = files
        .iter()
        .map(|(file, bytes)| {
            object([
                ("file", file.clone().into()),
                ("bytes", bytes.len().into()),
                ("sha256", sha256_hex(bytes).into()),
            ])
        })
        .collect();
    object([
        ("format", ANSWER_FORMAT.into()),
        ("version", ORDER_VERSION.into()),
        ("files", cards.into()),
    ])
}

pub fn compile_sky_rainbow(options: &Options, _progress: &Progress) -> Result<Value> {
    let input = options
        .required("input")
        .and_then(|name| paths::existing_file(name, &[".json"]))?;
    let order = Order::load(&input)?;
    let output = options.required("output").and_then(paths::full_path)?;
    let busy = output.exists() && (!output.is_dir() || fs::read_dir(&output)?.next().is_some());
    (!busy).then_some(()).ok_or(Hold::OutputBusy)?;
    let donor = fs::read(&order.donor).map_err(|_| Hold::DonorMissing)?;
    let files = order.assemble(&donor)?;
    fs::create_dir_all(&output)?;
    files
        .iter()
        .try_for_each(|(file, bytes)| write_atomic(&output.join(file), bytes))?;
    Ok(describe(&files))
}

const COMPILE_RAINBOW: Command = Command::new("compile-sky-rainbow", compile_sky_rainbow);

pub const COMMANDS: &[Command] = &[COMPILE_RAINBOW];

#[cfg(test)]
mod tests;
