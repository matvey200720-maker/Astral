//! Раздел `environment` ответа `read-ptfx-base`: для каждого семейства окружения
//! (огонь, свечение, дым, искры …) берёт листы текстур из ядра игрока и готовит по
//! одному кадру-превью на лист.
//!
//! Второе назначение — «хранилище оригиналов»: если Astral уже перекрасил лист в игре,
//! превью строится по сохранённому штатному оригиналу. Модуль только читает: папку
//! хранилища (`index.json`, файлы `.gz`) и ресурс ядра.

use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    path::{Path, PathBuf},
};

use rage_res::{
    png_io,
    texture::{Format, TextureRef},
    Resource,
};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::{
    clip_regions::{grid_for, Grid},
    pixels::{self, Dxt},
};
use crate::error::{EngineError, Result};

/// Объект JSON-карты из пар «ключ, значение» в заданном порядке.
pub(super) fn map_of(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Map<String, Value> {
    pairs
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

/// То же, но сразу значением.
pub(super) fn object_of(pairs: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Object(map_of(pairs))
}

/// Размер после масштаба: каждая сторона округляется как в JS и не меньше пикселя.
pub(super) fn scaled(width: usize, height: usize, scale: f64) -> (usize, usize) {
    let side = |n: usize| pixels::math_round(n as f64 * scale).max(1.0) as usize;
    (side(width), side(height))
}

/// PNG из RGBA заданного размера.
pub(super) fn png_of(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>> {
    Ok(png_io::encode(width as u32, height as u32, rgba)?)
}

/// Семейство окружения: ключ раздела, лист-витрина и листы по порядку.
pub struct Family {
    pub id: &'static str,
    pub preview: &'static str,
    pub textures: &'static [&'static str],
}

/// Семейства в порядке ключей раздела `environment`.
pub const FAMILIES: &[Family] = &[
    Family {
        id: "fire",
        preview: "ptfx_fire_v2",
        textures: &["ptfx_fire_v2", "ptfx_fire_v3"],
    },
    Family {
        id: "flame",
        preview: "ptfx_flipbook_fire_rgb",
        textures: &["ptfx_flipbook_fire_rgb", "ptfx_flipbook_fire1_rgb"],
    },
    Family {
        id: "fire-trail",
        preview: "ptfx_fire_tail",
        textures: &["ptfx_fire_tail", "ptfx_ribbon_fire"],
    },
    Family {
        id: "embers",
        preview: "ptfx_embers_rgb",
        textures: &["ptfx_embers_rgb"],
    },
    Family {
        id: "candle",
        preview: "ptfx_ribbon_candle_flame",
        textures: &["ptfx_ribbon_candle_flame"],
    },
    Family {
        id: "afterburner",
        preview: "ptfx_afterburner_rings_rgb",
        textures: &["ptfx_afterburner_rings_rgb", "ptfx_model_afterburner"],
    },
    Family {
        id: "muzzle",
        preview: "ptfx_muzzle_02",
        textures: &["ptfx_muzzle_01", "ptfx_muzzle_02", "ptfx_muzzle_core_02"],
    },
    Family {
        id: "impact-flash",
        preview: "ptfx_muzzle_core_rgb",
        textures: &["ptfx_muzzle_core_rgb", "ptfx_glow_impact_rgb"],
    },
    Family {
        id: "glow",
        preview: "ptfx_glow_rgb",
        textures: &["ptfx_glow_rgb", "ptfx_glow"],
    },
    Family {
        id: "explosion-glow",
        preview: "ptfx_flat_glow_rgb",
        textures: &["ptfx_flat_glow_rgb", "ptfx_glow_flat_rgb"],
    },
    Family {
        id: "flare",
        preview: "ptfx_flare",
        textures: &[
            "ptfx_flare",
            "ptfx_starbursts_rgb",
            "ptfx_star_rgb",
            "ptfx_firework_flare",
        ],
    },
    Family {
        id: "explosion",
        preview: "_explosion_fireball_rgba",
        textures: &[
            "_explosion_fireball",
            "_explosion_fireball_rgba",
            "_explosion_clown_fireball_rgba",
        ],
    },
    Family {
        id: "sparks",
        preview: "ptfx_sparks",
        textures: &[
            "ptfx_sparks",
            "ptfx_sparks_arcing_anim",
            "ptfx_exp_spark_glows",
        ],
    },
    Family {
        id: "smoke",
        preview: "ptfx_smoke_loop",
        textures: &[
            "ptfx_smoke_sheet_6",
            "ptfx_smoke_loop",
            "ptfx_smoke_new_plumes",
            "ptfx_smoke_thin_anim",
            "ptfx_smoke_wispy_anim",
            "ptfx_smoke_billow_anim_rgba",
            "ptfx_smoke_static_rgba",
            "ptfx_smoke_spikes",
            "ptfx_ribbon_smoke",
        ],
    },
    Family {
        id: "steam",
        preview: "ptfx_steam_anim",
        textures: &[
            "ptfx_steam_anim",
            "ptfx_cig_smoke_sheet",
            "ptfx_multi_sheet_006_mist",
        ],
    },
];

/// Длинная сторона превью.
const PREVIEW_SIDE: f64 = 192.0;

/// Предел распаковки оригинала: 64 МиБ.
const UNPACK_LIMIT: usize = 64 * 1024 * 1024;

/// Алфавит base64 (стандартный).
const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Откуда раздел берёт листы.
pub struct Source<'a> {
    pub resource: &'a Resource,
    pub textures: &'a [TextureRef],
    pub grids: &'a BTreeMap<String, Grid>,
    pub originals: &'a Originals,
}

/// Текстуры словаря по имени без учёта регистра; при повторе имён побеждает последняя.
pub(super) struct ByName<'a>(HashMap<String, &'a TextureRef>);

impl<'a> ByName<'a> {
    pub(super) fn of(textures: &'a [TextureRef]) -> Self {
        let named = textures
            .iter()
            .map(|texture| (texture.name.to_lowercase(), texture));
        ByName(named.collect())
    }

    pub(super) fn find(&self, name: &str) -> Option<&'a TextureRef> {
        self.0.get(&name.to_lowercase()).copied()
    }
}

/// Base64 с дополнением `=` и без переводов строки.
pub(super) fn base64(bytes: &[u8]) -> String {
    bytes.chunks(3).flat_map(base64_group).collect()
}

/// Группа до трёх байт → четыре знака (недостающие места занимает `=`).
fn base64_group(group: &[u8]) -> [char; 4] {
    let mut padded = [0u8; 4];
    padded[1..=group.len()].copy_from_slice(group);
    let word = u32::from_be_bytes(padded);
    let mut out = ['='; 4];
    for (k, slot) in out.iter_mut().enumerate().take(group.len() + 1) {
        *slot = char::from(BASE64_ALPHABET[((word >> (18 - 6 * k)) & 63) as usize]);
    }
    out
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Поток deflate внутри gzip: после фиксированных десяти байт идут необязательные
/// поля по флагам, а последние 8 байт (CRC и размер) отбрасываются без проверки.
fn deflate_body(file: &[u8]) -> Option<&[u8]> {
    const FHCRC: u8 = 2;
    const FEXTRA: u8 = 4;
    const FNAME: u8 = 8;
    const FCOMMENT: u8 = 16;
    if file.len() < 18 || file[..3] != [0x1f, 0x8b, 8] {
        return None;
    }
    let flags = file[3];
    let mut rest = &file[10..];
    if flags & FEXTRA != 0 {
        let extra = u16::from_le_bytes([*rest.first()?, *rest.get(1)?]);
        rest = rest.get(2 + usize::from(extra)..)?;
    }
    for flag in [FNAME, FCOMMENT] {
        if flags & flag != 0 {
            let end = rest.iter().position(|b| *b == 0)?;
            rest = &rest[end + 1..];
        }
    }
    if flags & FHCRC != 0 {
        rest = rest.get(2..)?;
    }
    rest.len().checked_sub(8).map(|len| &rest[..len])
}

/// Читает gzip целиком; `None` — «оригинала нет».
fn gunzip(file: &[u8]) -> Option<Vec<u8>> {
    let stream = deflate_body(file)?;
    miniz_oxide::inflate::decompress_to_vec_with_limit(stream, UNPACK_LIMIT).ok()
}

/// Что ищется в хранилище: лист, его формат и то, что игра отдаёт для него сейчас.
struct Ask<'a> {
    texture: &'a TextureRef,
    format: &'a str,
    payload: &'a [u8],
}

/// Запись индекса оригиналов: сверяется с текстурой и обоими хэшами.
struct Claim<'e>(&'e Map<String, Value>);

impl Claim<'_> {
    /// Поле записи равно значению JSON в точности: `32.0` и `"32"` числу 32 не равны.
    fn says(&self, key: &str, want: Value) -> bool {
        self.0.get(key) == Some(&want)
    }

    /// Размеры, число уровней и формат листа.
    fn describes(&self, ask: &Ask) -> bool {
        let facts = [
            ("width", Value::from(ask.texture.width)),
            ("height", Value::from(ask.texture.height)),
            ("levels", Value::from(ask.texture.levels)),
            ("format", Value::from(ask.format)),
        ];
        facts.into_iter().all(|(key, want)| self.says(key, want))
    }

    /// Имя файла оригинала; только если оно остаётся внутри папки хранилища.
    fn file(&self) -> Option<&str> {
        let name = self.0.get("file")?.as_str()?;
        stays_in_store(name).then_some(name)
    }
}

/// Обратная косая черта (разделитель путей Windows).
const BACKSLASH: u8 = 0x5c;

/// Имя файла внутри папки хранилища: не пустое, не абсолютное (`/…`, обратная черта в
/// начале, буква диска с двоеточием) и без компонента `..` — разделителями считаются
/// оба вида косой черты. Иначе запись индекса могла бы вывести чтение за папку.
fn stays_in_store(name: &str) -> bool {
    let bytes = name.as_bytes();
    let rooted = matches!(bytes.first(), Some(&first) if first == b'/' || first == BACKSLASH);
    let drive = matches!(bytes, [letter, b':', ..] if letter.is_ascii_alphabetic());
    let climbs = bytes
        .split(|&byte| byte == b'/' || byte == BACKSLASH)
        .any(|part| part == b"..");
    !(bytes.is_empty() || rooted || drive || climbs)
}

/// Папка хранилища и его индекс: ключ (имя текстуры в нижнем регистре) → запись.
struct Store {
    dir: PathBuf,
    textures: Map<String, Value>,
}

impl Store {
    /// Читает `index.json`: объект с целой версией 1 и объектом `textures`.
    fn load(dir: &Path) -> Option<Store> {
        let raw = std::fs::read(dir.join("index.json")).ok()?;
        let Value::Object(mut index) = serde_json::from_slice(&raw).ok()? else {
            return None;
        };
        if index.get("version") != Some(&Value::from(1u64)) {
            return None;
        }
        let Some(Value::Object(textures)) = index.remove("textures") else {
            return None;
        };
        Some(Store {
            dir: dir.to_path_buf(),
            textures,
        })
    }

    /// Штатные байты листа, если запись индекса подходит текстуре и обоим хэшам.
    fn original(&self, ask: &Ask) -> Option<Vec<u8>> {
        let entry = self
            .textures
            .get(&ask.texture.name.to_lowercase())?
            .as_object()?;
        let claim = Claim(entry);
        if !claim.describes(ask) || !claim.says("writtenSha", sha256_hex(ask.payload).into()) {
            return None;
        }
        let packed = std::fs::read(self.dir.join(claim.file()?)).ok();
        let original = packed.as_deref().and_then(gunzip)?;
        let restored = sha256_hex(&original);
        claim
            .says("originalSha", restored.into())
            .then_some(original)
    }
}

/// Хранилище штатных оригиналов листов.
pub struct Originals {
    store: Option<Store>,
}

impl Originals {
    /// Открывает хранилище. Любая неудача (нет файла, не JSON, не та версия, нет
    /// `textures`) даёт пустое: оригиналов нет.
    pub fn open(dir: Option<&Path>) -> Self {
        Originals {
            store: dir.and_then(Store::load),
        }
    }

    /// Штатные байты листа и признак «запись нашлась и подошла». Иначе — байты игры.
    pub fn base_for(&self, texture: &TextureRef, format: &str, payload: &[u8]) -> (Vec<u8>, bool) {
        let ask = Ask {
            texture,
            format,
            payload,
        };
        let restored = self
            .store
            .as_ref()
            .filter(|_| !payload.is_empty())
            .and_then(|store| store.original(&ask));
        restored.map_or_else(|| (payload.to_vec(), false), |original| (original, true))
    }

    /// Уровень 0 листа: штатные байты и признак «из хранилища»; короче уровня — `None`.
    pub(super) fn level_zero(
        &self,
        resource: &Resource,
        texture: &TextureRef,
        format: Format,
    ) -> Result<Option<(Vec<u8>, bool)>> {
        let need = format.level_bytes(texture.width as usize, texture.height as usize);
        let payload = resource.bytes(texture.data_at.unwrap_or_default(), texture.bytes)?;
        let (bytes, ours) = self.base_for(texture, format.name(), payload);
        Ok((bytes.len() >= need).then_some((bytes, ours)))
    }
}

/// Отказ листа: текст виден человеку в строке `environmentError`.
enum SheetFault<'a> {
    TooShort(&'a str),
    Undecodable(&'a str, String),
}

impl fmt::Display for SheetFault<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SheetFault::TooShort(name) => write!(out, "Текстура {name} короче уровня."),
            SheetFault::Undecodable(name, why) => write!(out, "Текстура {name}: {why}."),
        }
    }
}

impl From<SheetFault<'_>> for EngineError {
    fn from(fault: SheetFault<'_>) -> Self {
        EngineError::invalid_data(fault.to_string())
    }
}

/// Блочный формат листа; остальные раздел не рисует.
pub(super) fn block_format(format: Format) -> Option<Dxt> {
    match format {
        Format::Dxt1 => Some(Dxt::Dxt1),
        Format::Dxt3 => Some(Dxt::Dxt3),
        Format::Dxt5 => Some(Dxt::Dxt5),
        _ => None,
    }
}

/// Превью листа: выбранный кадр и его PNG.
struct Preview {
    frame: usize,
    width: usize,
    height: usize,
    png: Vec<u8>,
}

impl Preview {
    fn value(&self) -> Value {
        let packed = object_of([("$bytes", Value::from(base64(&self.png)))]);
        object_of([
            ("width", Value::from(self.width)),
            ("height", Value::from(self.height)),
            ("png", packed),
        ])
    }
}

/// Готовый лист: имя в нижнем регистре (для сравнения) и поля записи.
struct Sheet {
    key: String,
    fields: Map<String, Value>,
}

/// Сборка записей листов по одному источнику.
struct Builder<'s> {
    source: &'s Source<'s>,
    catalogue: ByName<'s>,
}

impl<'s> Builder<'s> {
    fn new(source: &'s Source<'s>) -> Self {
        Builder {
            source,
            catalogue: ByName::of(source.textures),
        }
    }

    /// Уровень 0 листа в RGBA и признак «взят из хранилища».
    fn level(&self, texture: &TextureRef, format: Format, dxt: Dxt) -> Result<(Vec<u8>, bool)> {
        let found = self
            .source
            .originals
            .level_zero(self.source.resource, texture, format)?;
        let Some((base, ours)) = found else {
            return Err(SheetFault::TooShort(&texture.name).into());
        };
        let (width, height) = (texture.width as usize, texture.height as usize);
        let rgba = pixels::decode_dxt(dxt, &base, width, height)
            .map_err(|why| SheetFault::Undecodable(&texture.name, why))?;
        Ok((rgba, ours))
    }

    fn preview(&self, rgba: &[u8], texture: &TextureRef, grid: Grid) -> Result<Preview> {
        let (across, down) = (texture.width as usize, texture.height as usize);
        let unfit = |why| SheetFault::Undecodable(&texture.name, why);
        let frame =
            pixels::preview_frame(rgba, across, down, grid.columns, grid.rows).map_err(unfit)?;
        let (from_w, from_h) = (frame.width, frame.height);
        let shrink = (PREVIEW_SIDE / from_w.max(from_h) as f64).min(1.0);
        let (width, height) = scaled(from_w, from_h, shrink);
        let small = pixels::resample(&frame.rgba, from_w, from_h, width, height).map_err(unfit)?;
        Ok(Preview {
            frame: frame.index,
            width,
            height,
            png: png_of(width, height, &small)?,
        })
    }

    /// Запись листа: поля по порядку.
    fn sheet(&self, texture: &TextureRef, format: Format, dxt: Dxt) -> Result<Sheet> {
        let (rgba, tinted) = self.level(texture, format, dxt)?;
        let grid = grid_for(self.source.grids, &texture.name);
        let preview = self.preview(&rgba, texture, grid)?;
        let fields = map_of([
            ("texture", Value::from(texture.name.as_str())),
            ("width", Value::from(texture.width)),
            ("height", Value::from(texture.height)),
            ("format", Value::from(format.name())),
            (
                "grid",
                object_of([
                    ("columns", Value::from(grid.columns)),
                    ("rows", Value::from(grid.rows)),
                ]),
            ),
            ("frame", Value::from(preview.frame)),
            ("tinted", Value::from(tinted)),
            ("preview", preview.value()),
        ]);
        Ok(Sheet {
            key: texture.name.to_lowercase(),
            fields,
        })
    }

    /// Листы семейства: найденные, полные, блочного формата — по порядку названий.
    fn sheets(&self, family: &Family) -> Result<Vec<Sheet>> {
        family
            .textures
            .iter()
            .filter_map(|wanted| {
                let texture = self.catalogue.find(wanted)?;
                let format = texture.format.filter(|_| texture.complete)?;
                let dxt = block_format(format)?;
                Some(self.sheet(texture, format, dxt))
            })
            .collect()
    }

    /// Запись семейства: поля лидера, затем все листы. Нет листов — нет записи.
    fn entry(&self, family: &Family) -> Result<Option<(String, Value)>> {
        let sheets = self.sheets(family)?;
        let showcase = family.preview.to_lowercase();
        let Some(leader) = sheets
            .iter()
            .find(|sheet| sheet.key == showcase)
            .or(sheets.first())
        else {
            return Ok(None);
        };
        let mut record = leader.fields.clone();
        let listed: Vec<Value> = sheets
            .into_iter()
            .map(|sheet| Value::Object(sheet.fields))
            .collect();
        record.insert("sheets".to_owned(), Value::Array(listed));
        Ok(Some((family.id.to_owned(), Value::Object(record))))
    }
}

/// Раздел `environment`: объект «семейство → запись семейства».
pub fn section(source: &Source) -> Result<Value> {
    let builder = Builder::new(source);
    FAMILIES
        .iter()
        .filter_map(|family| builder.entry(family).transpose())
        .collect::<Result<Map<String, Value>>>()
        .map(Value::Object)
}

#[cfg(test)]
mod tests;
