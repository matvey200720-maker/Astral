//! `read-combat-decals`: данные боевых декалей для предпросмотра ран и крови.
//!
//! Команда только читает игру: два текстовых файла настроек повреждений
//! (`peddamage.xml`, `decals.dat`) и три листа-текстуры (`pd_wound_sheet`,
//! `pd_soak_splat` из `peddamagedecals.ytd`, `fxdecal_splatter_mist` из
//! `fxdecal.ytd`). Листы уходят сырыми байтами `{"$bytes": base64}`.

use crate::{
    archives::{cloud::base64, game_root, load_keys},
    args::Options,
    error::{EngineError, Result},
    progress::Progress,
    readers::archive_access,
};
use rage_res::{
    texture::{decode, read_dictionary, TextureRef},
    Resource,
};
use serde_json::Value;
use std::{
    ops::Range,
    path::{Path, PathBuf},
};

pub const PED_DECALS: [&str; 1] = ["x64a:/textures/peddamagedecals.ytd"];
pub const IMPLEMENTED: [&str; 4] = ["pedDamage", "decals", "sheets", "from"];

pub const FX_DECAL: [&str; 2] = [
    "update:/x64/textures/fxdecal.ytd",
    "x64a:/textures/fxdecal.ytd",
];
pub const DECALS: [&str; 2] = [
    "update:/common/data/effects/decals.dat",
    "common:/data/effects/decals.dat",
];
pub const PED_DAMAGE: [&str; 2] = [
    "update:/common/data/effects/peds/peddamage.xml",
    "common:/data/effects/peds/peddamage.xml",
];

/// Потолок размера текстового файла (2 МиБ) и листа (пикселей).
const TEXT_LIMIT: usize = 2 * 1024 * 1024;
const PIXEL_LIMIT: usize = 4 * 1024 * 1024;

/// Лист с именем из списка просьб.
type NamedSheet = (String, Sheet);
/// Просьба: имя листа и нужные каналы.
type Wanted<'a> = (&'a str, Channels);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channels {
    Alpha,
    Rgb,
}

impl Channels {
    /// Имя канала в ответе и байты пикселя RGBA, которые уходят в лист.
    fn layout(self) -> (&'static str, Range<usize>) {
        match self {
            Channels::Rgb => ("rgb", 0..3),
            Channels::Alpha => ("a", 3..4),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sheet {
    pub channels: Channels,
    pub data: Vec<u8>,
    pub height: u32,
    pub width: u32,
}

/// Число пикселей листа, если оно в пределах (и не нулевое).
fn pixel_total(width: u32, height: u32) -> Option<usize> {
    let total = (width as usize).saturating_mul(height as usize);
    (1..=PIXEL_LIMIT).contains(&total).then_some(total)
}

/// Из RGBA оставляет нужные каналы подряд. Размер проверяется до чтения `rgba`;
/// слишком короткий `rgba` — паника (из команды недостижима) на первом недостающем байте.
pub fn channels_of(width: u32, height: u32, rgba: &[u8], channels: Channels) -> Result<Sheet> {
    let pixels = match pixel_total(width, height) {
        Some(total) => total,
        None => {
            return Err(EngineError::invalid_operation(
                "Лист декалей слишком велик.",
            ))
        }
    };
    let (_, wanted) = channels.layout();
    let data = (0..pixels)
        .flat_map(|pixel| wanted.clone().map(move |offset| pixel * 4 + offset))
        .map(|at| rgba[at])
        .collect();
    Ok(Sheet {
        channels,
        data,
        height,
        width,
    })
}

/// Словарь текстур: сам ресурс и список его текстур.
struct Dictionary {
    resource: Resource,
    textures: Vec<TextureRef>,
}

impl Dictionary {
    fn open(bytes: &[u8]) -> Result<Dictionary> {
        Resource::parse(bytes)
            .map_err(EngineError::from)
            .and_then(|resource| {
                let textures = read_dictionary(&resource)?;
                Ok(Dictionary { resource, textures })
            })
    }

    /// Лист по имени (регистр ASCII безразличен): ступень 0 целиком; нет текстуры — `None`.
    fn sheet(&self, (name, channels): Wanted<'_>) -> Option<Result<NamedSheet>> {
        let at = self
            .textures
            .iter()
            .position(|texture| texture.name.eq_ignore_ascii_case(name))?;
        let texture = &self.textures[at];
        let cut = decode(&self.resource, texture, None, None)
            .map_err(EngineError::from)
            .and_then(|image| channels_of(image.width, image.height, &image.rgba, channels));
        Some(cut.map(|sheet| (name.to_owned(), sheet)))
    }
}

/// Листы из файла словаря текстур: для каждой пары из `wanted` — ступень 0 полностью.
/// Текстуры без такого имени пропускаются; имя в ответе — из `wanted`.
pub fn sheets_from(bytes: &[u8], wanted: &[Wanted<'_>]) -> Result<Vec<NamedSheet>> {
    let dictionary = Dictionary::open(bytes)?;
    wanted
        .iter()
        .filter_map(|&request| dictionary.sheet(request))
        .collect()
}

// ---------- чтение записей игры ----------

/// Куда ведёт запись `устройство:/путь`: пара «устройство, путь внутри архива».
struct Target<'s> {
    device: &'s str,
    inner: &'s str,
}

impl<'s> Target<'s> {
    /// Делит по первому `:/`; нет такого места — отказ.
    fn parse(spec: &'s str) -> Result<Target<'s>> {
        let cut = spec.as_bytes().windows(2).position(|pair| pair == b":/");
        match cut {
            Some(at) => Ok(Target {
                device: &spec[..at],
                inner: spec[at + 2..].trim_start_matches('/'),
            }),
            None => Err(EngineError::argument(format!(
                "Неверный путь записи: {spec}"
            ))),
        }
    }

    /// Файл архива этого устройства под корнем игры.
    fn archive_under(&self, root: &Path) -> PathBuf {
        let (folder, file) = match self.device {
            "update" => (Some("update"), "update.rpf".to_owned()),
            "common" => (None, "common.rpf".to_owned()),
            other => (None, format!("{other}.rpf")),
        };
        let base = folder.map_or_else(|| root.to_path_buf(), |dir| root.join(dir));
        base.join(file)
    }
}

/// Читатель записей: по цели отдаёт байты, `None` — записи нет.
type Fetch = Box<dyn Fn(&Target<'_>) -> Result<Option<Vec<u8>>>>;

/// Откуда читаем: замкнутый на корень игры и ключи читатель записей.
struct Source {
    fetch: Fetch,
}

/// Прочитанная запись и путь, по которому она нашлась.
struct Found {
    bytes: Vec<u8>,
    from: &'static str,
}

impl Source {
    /// Корень игры из `--game-root` и ключи (раньше любого чтения архивов).
    fn from_options(options: &Options) -> Result<Source> {
        game_root(options).and_then(|root| {
            let (keys, _) = load_keys(&root.to_string_lossy(), options.optional("keys"))?;
            let fetch: Fetch = Box::new(move |target| {
                let archive = archive_access::open(&target.archive_under(&root), &keys)?;
                archive_access::read_entry(&archive, target.inner)
            });
            Ok(Source { fetch })
        })
    }

    /// Одна попытка.
    fn attempt(&self, spec: &str) -> Result<Vec<u8>> {
        let target = Target::parse(spec)?;
        (self.fetch)(&target)?.ok_or_else(|| {
            EngineError::file_not_found(format!("Archive entry was not found: {spec}"))
        })
    }

    /// Первая удавшаяся попытка; если не удалась ни одна — ошибка последней.
    fn first(&self, specs: &[&'static str]) -> Result<Found> {
        let mut last_error = None;
        let found = specs.iter().find_map(|&spec| match self.attempt(spec) {
            Ok(bytes) => Some(Found { bytes, from: spec }),
            Err(error) => {
                last_error = Some(error);
                None
            }
        });
        found.ok_or_else(|| {
            last_error.unwrap_or_else(|| EngineError::file_not_found("Файла нет в архивах игры."))
        })
    }
}

/// Какие списки попыток читаются, и в каком порядке.
const LISTS: [&[&str]; 4] = [&PED_DAMAGE, &DECALS, &PED_DECALS, &FX_DECAL];
const PED_DAMAGE_AT: usize = 0;
const DECALS_AT: usize = 1;
const PED_DECALS_AT: usize = 2;
const FX_DECAL_AT: usize = 3;

/// Четыре записи, которые читает команда, в порядке `LISTS`.
struct Corpus(Vec<Found>);

impl Corpus {
    /// Читает записи в порядке списков; первая же неудача кончает чтение.
    fn gather(source: &Source) -> Result<Corpus> {
        LISTS
            .iter()
            .map(|list| source.first(list))
            .collect::<Result<Vec<Found>>>()
            .map(Corpus)
    }

    fn entry(&self, at: usize) -> &Found {
        &self.0[at]
    }

    /// Оба текста должны уместиться в предел (проверка — после чтения всех записей).
    fn check_texts(&self) -> Result<()> {
        let oversized = [PED_DAMAGE_AT, DECALS_AT]
            .into_iter()
            .any(|at| self.entry(at).bytes.len() > TEXT_LIMIT);
        match oversized {
            true => Err(EngineError::invalid_data(
                "Файл данных повреждений слишком велик.",
            )),
            false => Ok(()),
        }
    }

    fn sheets(&self) -> Result<Vec<NamedSheet>> {
        let ped = [
            ("pd_wound_sheet", Channels::Rgb),
            ("pd_soak_splat", Channels::Rgb),
        ];
        let fx = [("fxdecal_splatter_mist", Channels::Alpha)];
        let mut all = sheets_from(&self.entry(PED_DECALS_AT).bytes, &ped)?;
        all.extend(sheets_from(&self.entry(FX_DECAL_AT).bytes, &fx)?);
        Ok(all)
    }
}

// ---------- ответ ----------

/// Запись `{ключ: значение}` из пар в нужном порядке.
fn record<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    pairs
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

fn sheet_value(sheet: &Sheet) -> Value {
    record([
        ("width", sheet.width.into()),
        ("height", sheet.height.into()),
        ("channels", sheet.channels.layout().0.into()),
        ("data", record([("$bytes", base64(&sheet.data).into())])),
    ])
}

pub fn read(options: &Options, _progress: &Progress) -> Result<Value> {
    let corpus = Source::from_options(options).and_then(|source| Corpus::gather(&source))?;
    corpus.check_texts()?;
    let sheets = corpus.sheets()?;

    let sheets_value: Value = sheets
        .iter()
        .map(|(name, sheet)| (name.clone(), sheet_value(sheet)))
        .collect();
    let origin = |at: usize| Value::from(corpus.entry(at).from);
    // `decals.dat` отдаётся как Latin-1: каждый байт — знак с тем же кодом.
    let latin1: String = corpus
        .entry(DECALS_AT)
        .bytes
        .iter()
        .copied()
        .map(char::from)
        .collect();
    let utf8 = String::from_utf8_lossy(&corpus.entry(PED_DAMAGE_AT).bytes).into_owned();
    Ok(record([
        ("pedDamage", utf8.into()),
        ("decals", latin1.into()),
        ("sheets", sheets_value),
        (
            "from",
            record([
                ("pedDamage", origin(PED_DAMAGE_AT)),
                ("decals", origin(DECALS_AT)),
                ("pedDecals", origin(PED_DECALS_AT)),
                ("fxDecal", origin(FX_DECAL_AT)),
            ]),
        ),
        ("implemented", IMPLEMENTED.to_vec().into()),
    ]))
}

#[cfg(test)]
mod tests;
