//! Один словарь карты (или модель со встроенными листами) с обликом дорог — `processRoadsDictionary`
//! из `apps/desktop/src/roads-build.js` вместе с `patchResourceTextures` (`recolor-textures.js`).
//!
//! Файл выходит тем же байт в байт, что у сборки на JS: те же листы, тот же порядок, тот же поток
//! deflate. Всё, чего этот путь не повторяет дословно (редкий формат листа, спорная раскладка,
//! любой отказ разбора), — `Outcome::Fallback`: такой файл собирает приложение прежним кодом.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use libdeflater::{CompressionLvl, Compressor, Decompressor};
use rage_res::drawable::{self, FileKind};
use rage_res::dxt_block;
use rage_res::resource::{self, Resource};
use rage_res::texture::{self, TextureRef};
use sha2::{Digest, Sha256};

use crate::paint::{Kind, Part};
use crate::roads::{road_sheet_pixels, Look};
use crate::sheet;

/// Семейство листа дороги (`roadTextureFamily`): часть, вид и дальний ли это лист.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Family {
    pub part: Part,
    pub kind: Kind,
    pub lod: bool,
}

/// Заголовок RSC7 остаётся прежним.
const HEADER_BYTES: usize = 16;
/// Сжатый файл крупнее этого у общего правила пережимается девятым уровнем (`LEVEL_FALLBACK_BYTES`
/// в `recolor-textures.js`); у дорог правила нет.
pub(crate) const LEVEL_FALLBACK_BYTES: usize = 12 * 1024 * 1024;
/// Уровень сжатия ресурса (`DEFAULT_RESOURCE_LEVEL`). Крупные словари дорог девятым уровнем не
/// пережимаются (`fallbackBytes: Infinity` в `roads-build.js`, 14.11.2026): из 52 словарей крупнее
/// 12 МиБ половина не входит в 24 бита размера записи и после девятого, пакет от него легче на
/// 14 МБ из 5,1 ГБ, а стоил он пятую часть времени сборки.
const RESOURCE_LEVEL: i32 = 1;

/// Ключ памяти готовых листов: сжатые байты первого уровня и всё, от чего ещё зависит итог.
#[derive(Clone, PartialEq, Eq, Hash)]
struct SheetKey {
    digest: [u8; 32],
    format: u8,
    width: u32,
    height: u32,
    levels: u32,
    bytes: usize,
    family: Family,
}

/// Время потоков по этапам сборки (наносекунды, суммой по всем потокам): видно, на чём сборка стоит.
#[derive(Default)]
pub struct Clock {
    /// Чтение словаря из архива игры или с диска.
    pub read: AtomicU64,
    /// Разбор ресурса (inflate) и списка листов.
    pub parse: AtomicU64,
    /// Отпечатки листов — ключи памяти готовых листов.
    pub keys: AtomicU64,
    /// Разбор блоков DXT в пиксели.
    pub decode: AtomicU64,
    /// Пиксели листа по облику работы.
    pub pixels: AtomicU64,
    /// Уровни листа и сжатие блоков DXT.
    pub encode: AtomicU64,
    /// Взятие листа из памяти, в том числе ожидание листа, который считает другой поток.
    pub waits: AtomicU64,
    /// Сжатие словаря.
    pub deflate: AtomicU64,
    /// SHA-256 готового файла и запись на диск.
    pub write: AtomicU64,
}

impl Clock {
    /// Прибавить к этапу время, прошедшее с `from`.
    pub fn add(stage: &AtomicU64, from: Instant) {
        stage.fetch_add(u64::try_from(from.elapsed().as_nanos()).unwrap_or(u64::MAX), Ordering::Relaxed);
    }

    /// Этапы в миллисекундах потоков.
    pub fn report(&self) -> [(&'static str, u64); 9] {
        let ms = |stage: &AtomicU64| stage.load(Ordering::Relaxed) / 1_000_000;
        [
            ("readMs", ms(&self.read)),
            ("parseMs", ms(&self.parse)),
            ("keysMs", ms(&self.keys)),
            ("decodeMs", ms(&self.decode)),
            ("pixelsMs", ms(&self.pixels)),
            ("encodeMs", ms(&self.encode)),
            ("waitsMs", ms(&self.waits)),
            ("deflateMs", ms(&self.deflate)),
            ("writeMs", ms(&self.write)),
        ]
    }
}

/// Итог листа в памяти готовых.
#[derive(Clone)]
enum Sheet {
    /// Готовые байты листа; `None` — лист не меняется.
    Ready(Option<Arc<Vec<u8>>>),
    /// Правка лист не пишет: блоки не разобрались или лист не собрался.
    Skipped,
    /// Облик части считает приложение.
    Unsupported,
}

/// Место листа в памяти: одно на ключ у всех потоков.
type Slot = Arc<OnceLock<Sheet>>;

/// Память готовых листов на сборку — общая у всех потоков: один лист дороги лежит в десятках
/// словарей карты (у «Неоновой ночи» 7178 листов, разных — около тысячи). Лист считает один поток;
/// кому он нужен в это же время — ждёт готового, а не считает его ещё раз (до 14.11.2026 пятая
/// часть расчётов была такими повторами).
pub struct SheetMemo {
    entries: Mutex<HashMap<SheetKey, Slot>>,
    held: AtomicUsize,
    limit: usize,
}

impl SheetMemo {
    /// `limit` — потолок байт готовых листов; сверх него новые листы не запоминаются.
    pub fn new(limit: usize) -> Self {
        Self { entries: Mutex::new(HashMap::new()), held: AtomicUsize::new(0), limit }
    }

    fn slot(&self, key: &SheetKey) -> Slot {
        match self.entries.lock() {
            Ok(mut entries) => Arc::clone(entries.entry(key.clone()).or_default()),
            Err(_) => Slot::default(),
        }
    }

    /// Учесть посчитанный лист. Сверх потолка лист в памяти не остаётся: кто его уже ждёт —
    /// получит, следующий посчитает заново.
    fn account(&self, key: &SheetKey, size: usize) {
        if self.held.load(Ordering::Relaxed) + size > self.limit {
            if let Ok(mut entries) = self.entries.lock() {
                entries.remove(key);
            }
            return;
        }
        self.held.fetch_add(size, Ordering::Relaxed);
    }
}

/// Итог словаря.
pub enum Outcome {
    /// Словарь с новыми листами: байты файла, имена легших листов (строчными, в порядке словаря).
    Built(Built),
    /// Ни один лист не изменился.
    Unchanged(Stats),
    /// Этот файл собирает приложение прежним кодом.
    Fallback(String),
}

/// Счётчики словаря.
#[derive(Default)]
pub struct Stats {
    /// Листы, которых правка не пишет (у JS — пойманный отказ листа).
    pub skipped: usize,
    /// Листы, взятые из памяти готовых.
    pub memo: usize,
    /// Листы, посчитанные заново.
    pub computed: usize,
    /// Имена листов, про которые приложение не сказало, дорога ли это (строчными, без повторов).
    pub unknown: Vec<String>,
}

pub struct Built {
    pub bytes: Vec<u8>,
    pub textures: Vec<String>,
    pub stats: Stats,
}

fn fallback(reason: impl Into<String>) -> Outcome {
    Outcome::Fallback(reason.into())
}

/// Вид файла по расширению, как `kindOf` у JS.
fn kind_of(file_name: &str) -> Option<Option<FileKind>> {
    match file_name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "ytd" => Some(None),
        "ydr" => Some(Some(FileKind::Ydr)),
        "ydd" => Some(Some(FileKind::Ydd)),
        "yft" => Some(Some(FileKind::Yft)),
        _ => None,
    }
}

/// Листы файла в порядке чтения: словарь — как есть, модель — встроенные листы всех её моделей подряд.
fn read_refs(res: &Resource, kind: Option<FileKind>) -> Result<Vec<TextureRef>, String> {
    let Some(kind) = kind else {
        return texture::read_dictionary(res).map_err(|error| error.to_string());
    };
    let model = drawable::open_model(res, Some(kind)).map_err(|error| error.to_string())?;
    let mut refs = Vec::new();
    for entry in &model.entries {
        let (_, _, embedded) = drawable::read_materials(res, entry.at).map_err(|error| error.to_string())?;
        refs.extend(embedded);
    }
    Ok(refs)
}

fn dxt_format(format: texture::Format) -> Option<dxt_block::Format> {
    match format {
        texture::Format::Dxt1 => Some(dxt_block::Format::Dxt1),
        texture::Format::Dxt3 => Some(dxt_block::Format::Dxt3),
        texture::Format::Dxt5 => Some(dxt_block::Format::Dxt5),
        _ => None,
    }
}

/// Все mip-уровни одинаковы — картинка ровного цвета (`flatColour`).
fn flat_colour(payload: &[u8], spans: &[texture::Span]) -> bool {
    let Some(first) = spans.first() else { return true };
    spans.iter().all(|span| {
        payload[span.offset..span.offset + span.bytes]
            .iter()
            .enumerate()
            .all(|(index, &byte)| byte == payload[index % first.bytes])
    })
}

/// Ресурс из файла RSC7. Распаковка — libdeflate сразу в буфер заявленного размера: читатель
/// `rage_res` распаковывает в растущий буфер и на словарях карты втрое медленнее (пятая часть
/// времени сборки). Поток, что не дал ровно заявленный размер (обрыв, лишнее, порча), разбирает
/// прежний читатель — итог тот же, что был.
pub(crate) fn open_resource(raw: &[u8]) -> rage_res::Result<Resource> {
    if let Ok(header) = resource::read_header(raw) {
        let total = header.system_size + header.graphics_size;
        if total > 0 {
            let mut data = vec![0u8; total];
            if Decompressor::new().deflate_decompress(&raw[HEADER_BYTES..], &mut data) == Ok(total) {
                return Ok(Resource::from_parts(header, data));
            }
        }
    }
    Resource::parse(raw)
}

/// Файл ресурса: заголовок `head` и сырое deflate данных тем же кодом, что у сборки на JS
/// (`native/astral-rs`, libdeflate). Сжатие идёт сразу в выходной буфер — без второго буфера и копии.
fn deflate_into(head: &[u8], data: &[u8], level: i32) -> Result<Vec<u8>, String> {
    let level = CompressionLvl::new(level).map_err(|_| "уровень сжатия вне 1…12".to_owned())?;
    let mut compressor = Compressor::new(level);
    let mut out = vec![0u8; head.len() + compressor.deflate_compress_bound(data.len())];
    out[..head.len()].copy_from_slice(head);
    let size = compressor.deflate_compress(data, &mut out[head.len()..]).map_err(|error| format!("сжатие: {error:?}"))?;
    out.truncate(head.len() + size);
    Ok(out)
}

/// Словарь `file_name` с обликом работы. `families` — семейства листов по имени строчными: имя,
/// которого там нет, считается не дорогой и возвращается в `unknown` — приложение сверит его своими правилами.
pub fn process(raw: &[u8], file_name: &str, look: &Look, families: &HashMap<String, Family>, memo: &SheetMemo, clock: &Clock) -> Outcome {
    let Some(kind) = kind_of(file_name) else {
        return fallback("вид файла не словарь и не модель");
    };
    if raw.len() < HEADER_BYTES {
        return fallback("файл короче заголовка");
    }
    let parse_from = Instant::now();
    let mut res = match open_resource(raw) {
        Ok(res) if res.complete => res,
        Ok(_) => return fallback("данные ресурса короче заявленных"),
        Err(error) => return fallback(error.to_string()),
    };
    let refs = match read_refs(&res, kind) {
        Ok(refs) => refs,
        Err(reason) => return fallback(reason),
    };
    Clock::add(&clock.parse, parse_from);
    if refs.iter().any(|item| item.complete && !item.name.is_ascii()) {
        return fallback("имя листа вне ASCII");
    }

    /* Листы под перекраску: у модели повтор по месту данных отбрасывается (первый остаётся), как у `resourceRefs`. */
    let mut seen_places = HashSet::new();
    let decode_list: Vec<&TextureRef> = refs
        .iter()
        .filter(|item| kind.is_none() || seen_places.insert(item.data_at))
        .collect();

    let mut stats = Stats::default();
    let mut unknown_seen = HashSet::new();
    let mut replacements: Vec<(String, Arc<Vec<u8>>)> = Vec::new();
    let mut textures = Vec::new();
    for item in decode_list {
        if !item.complete {
            continue;
        }
        let lower = item.name.to_ascii_lowercase();
        let Some(&family) = families.get(&lower) else {
            if unknown_seen.insert(lower.clone()) {
                stats.unknown.push(lower);
            }
            continue;
        };
        let (Some(format), Some(data_at), Some(first)) = (item.format.and_then(dxt_format), item.data_at, item.spans.first().copied()) else {
            return fallback(format!("лист {} в формате, который движок не пишет", item.name));
        };
        let Ok(stored) = res.bytes(data_at + first.offset, first.bytes) else {
            return fallback(format!("лист {} выходит за данные", item.name));
        };
        let key_from = Instant::now();
        let key = SheetKey {
            digest: Sha256::digest(stored).into(),
            format: format as u8,
            width: item.width,
            height: item.height,
            levels: item.levels,
            bytes: item.bytes,
            family,
        };
        Clock::add(&clock.keys, key_from);
        let slot = memo.slot(&key);
        let mut computed_here = false;
        let taken_from = Instant::now();
        let sheet = slot
            .get_or_init(|| {
                computed_here = true;
                let (width, height) = (item.width as usize, item.height as usize);
                let from = Instant::now();
                let rgba = sheet::decode_blocks(format, stored, width, height);
                Clock::add(&clock.decode, from);
                let Some(rgba) = rgba else { return Sheet::Skipped };
                let from = Instant::now();
                let pixels = road_sheet_pixels(&rgba, width, height, family.part, look, family.kind, family.lod);
                Clock::add(&clock.pixels, from);
                let pixels = match pixels {
                    Ok(Some(pixels)) => pixels,
                    Ok(None) => return Sheet::Ready(None),
                    Err(_) => return Sheet::Unsupported,
                };
                let from = Instant::now();
                let built = sheet::payload(format, width, height, item.levels as usize, item.bytes, pixels);
                Clock::add(&clock.encode, from);
                built.map_or(Sheet::Skipped, |bytes| Sheet::Ready(Some(Arc::new(bytes))))
            })
            .clone();
        if computed_here {
            stats.computed += 1;
            memo.account(&key, if let Sheet::Ready(Some(bytes)) = &sheet { bytes.len() } else { 0 });
        } else {
            stats.memo += 1;
            Clock::add(&clock.waits, taken_from);
        }
        let payload = match sheet {
            Sheet::Ready(payload) => payload,
            Sheet::Skipped => {
                stats.skipped += 1;
                continue;
            }
            Sheet::Unsupported => return fallback("облик части считает приложение"),
        };
        let Some(payload) = payload else { continue };
        /* Имя из одних цифр у объекта JS встаёт вперёд остальных ключей: порядок правок здесь бы разошёлся. */
        if item.name.bytes().all(|byte| byte.is_ascii_digit()) {
            return fallback("имя листа из одних цифр");
        }
        match replacements.iter_mut().find(|(name, _)| *name == item.name) {
            Some(slot) => slot.1 = payload,
            None => replacements.push((item.name.clone(), payload)),
        }
        textures.push(lower);
    }
    if textures.is_empty() {
        return Outcome::Unchanged(stats);
    }

    match pack_patched(raw, &mut res, &refs, &replacements, None, clock) {
        Ok(bytes) => Outcome::Built(Built { bytes, textures, stats }),
        Err(reason) => fallback(reason),
    }
}

/// Целые листы без повторов по месту данных, по порядку места — как их видит правка (`textureRefs`
/// в `recolor-textures.js`).
pub(crate) fn unique_refs(refs: &[TextureRef]) -> Vec<(&TextureRef, usize)> {
    let mut seen_places = HashSet::new();
    let mut list: Vec<(&TextureRef, usize)> = refs
        .iter()
        .filter(|item| item.complete)
        .filter_map(|item| item.data_at.map(|at| (item, at)))
        .filter(|&(_, at)| seen_places.insert(at))
        .collect();
    list.sort_by_key(|&(_, at)| at);
    list
}

/// Правка листов на месте и файл заново (`patchResourceTextures`): `replacements` — новые байты
/// листов по имени (поздний с тем же именем строчными заменяет ранний). Лист ложится до общего с
/// соседом хвоста; в общий хвост — только те же байты или ровный цвет. `tighter_above` — порог
/// пережатия девятым уровнем. Отказ — словами: такой файл собирает приложение прежним кодом.
pub(crate) fn pack_patched(
    raw: &[u8],
    res: &mut Resource,
    refs: &[TextureRef],
    replacements: &[(String, Arc<Vec<u8>>)],
    tighter_above: Option<usize>,
    clock: &Clock,
) -> Result<Vec<u8>, String> {
    let mut wanted: HashMap<String, Arc<Vec<u8>>> = HashMap::new();
    for (name, payload) in replacements {
        wanted.insert(name.to_ascii_lowercase(), Arc::clone(payload));
    }
    let patch_list = unique_refs(refs);
    let mut patched: HashSet<String> = HashSet::new();
    let mut writes: Vec<(usize, Arc<Vec<u8>>, usize)> = Vec::new();
    for (index, &(item, at)) in patch_list.iter().enumerate() {
        let lower = item.name.to_ascii_lowercase();
        let Some(payload) = wanted.get(&lower) else { continue };
        if payload.len() != item.bytes {
            return Err(format!("лист {}: длина правки не совпала", item.name));
        }
        let writable = match patch_list.get(index + 1) {
            Some(&(_, next)) => item.bytes.min(next - at),
            None => item.bytes,
        };
        let first_level = item.spans.first().map_or(0, |span| span.bytes);
        if writable < first_level {
            return Err(format!("лист {} перекрыт соседним", item.name));
        }
        if writable < payload.len() {
            let Ok(tail) = res.bytes(at + writable, item.bytes - writable) else {
                return Err(format!("лист {} выходит за данные", item.name));
            };
            if payload[writable..] != *tail && !flat_colour(payload, &item.spans) {
                return Err(format!("лист {} делит байты с соседним", item.name));
            }
        }
        writes.push((at, Arc::clone(payload), writable));
        patched.insert(lower);
    }
    if wanted.keys().any(|name| !patched.contains(name)) {
        return Err("правке листа некуда лечь".to_owned());
    }
    let data = res.data_mut();
    for (at, payload, writable) in writes {
        data[at..at + writable].copy_from_slice(&payload[..writable]);
    }

    let deflate_from = Instant::now();
    let mut bytes = deflate_into(&raw[..HEADER_BYTES], res.data(), RESOURCE_LEVEL)?;
    if tighter_above.is_some_and(|limit| bytes.len() - HEADER_BYTES > limit) {
        let tighter = deflate_into(&raw[..HEADER_BYTES], res.data(), 9)?;
        if tighter.len() < bytes.len() {
            bytes = tighter;
        }
    }
    Clock::add(&clock.deflate, deflate_from);
    Ok(bytes)
}
