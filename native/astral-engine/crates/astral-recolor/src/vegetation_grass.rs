//! Карты травы в цвете травы своей зоны — `patchGrassMap` из `apps/desktop/src/vegetation-build.js` (вид `grass`, без цветов,
//! клумб и «В разнобой»: цветок или клумбу карты считает приложение).
//!
//! Карта — ресурс `ymap` с пачками травы (`fwGrassInstanceListDef`, 96 байт): рамка, модель, экземпляры по 16 байт — позиция
//! тремя `u16` в рамке пачки и цвет тремя байтами с +8. Цвет экземпляра подбирается под зелёный лист модели травинки
//! (`grassInstanceColour`): лист × цвет экземпляра сдвигается той же формулой, что трава земли. Цель цвета в точке — полоса цветов
//! эффекта зоны (`Field`), цель каждого цвета полосы приходит из приложения (`grassTarget`), как и средняя травинка каждой модели
//! (`grassReference`): арктангенс и гипотенуза считает JS. Синус, косинус и арктангенс на травинку — порт `fdlibm`, как у остального движка.
//!
//! Файл выходит тем же байт в байт, что у сборки на JS: заголовок RSC7 прежний, данные — сырой deflate шестого уровня (карт травы —
//! сотни, шестой уровень на доли процента крупнее девятого и вдвое быстрее).

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use libdeflater::{CompressionLvl, Compressor};
use rage_res::resource::Resource;

use crate::dictionary::{open_resource, Clock};
use crate::grass::{self, Oracle, Reference, Target};
use crate::vegetation::Field;

const HEADER_BYTES: usize = 16;
/// Уровень сжатия карт травы (`deflateRaw(resource.data, { level: 6 })`).
const MAP_LEVEL: i32 = 6;
const BATCH_BYTES: usize = 96;
const BATCH_ARCHETYPE: usize = 48;
const INSTANCE_BYTES: usize = 16;
const INSTANCE_COLOUR: usize = 8;

/// Модель травинки: средний цвет листа и средняя травинка модели по миру (`blades` плана).
#[derive(Clone, Copy)]
pub struct Blade {
    pub sheet: [f64; 3],
    pub reference: Reference,
}

/// Всё общее у карт травы одной сборки.
pub struct GrassPlan {
    /// Модели травинок по хэшу архетипа.
    pub blades: HashMap<u32, Blade>,
    /// Травинка, если модели нет в описи (`DEFAULT_BLADE`).
    pub default: Blade,
    /// Хэши камней и бревен: цвет травы их не красит (`isNonPlantBatch`).
    pub non_plant: HashSet<u32>,
}

/// Цвет травы зоны по месту: полоса цветов и цель каждого из них.
#[derive(Clone)]
pub struct GrassZone {
    pub field: Field,
    pub targets: Vec<Target>,
}

/// Одно задание: карта травы `name` лежит по месту `at` (или файлом `file`), её зона — `zone`.
pub struct GrassJob {
    pub name: String,
    pub at: String,
    pub file: Option<std::path::PathBuf>,
    pub output: std::path::PathBuf,
    pub zone: GrassZone,
}

pub enum Grass {
    Built { bytes: Vec<u8>, instances: u32 },
    Unchanged,
    Fallback(String),
}

fn fallback(reason: impl Into<String>) -> Grass {
    Grass::Fallback(reason.into())
}

/// Мета-ресурс карты: блоки структур и разыменование указателей (`openMeta`).
struct Meta {
    root: i64,
    blocks: Vec<i64>,
}

impl Meta {
    /// `resolve`: указатель мета-ресурса → смещение в данных; `-1` — указатель ни на что не указывает.
    fn resolve(&self, pointer: u64) -> i64 {
        let number = (pointer & 0xfff) as usize;
        match number.checked_sub(1).and_then(|index| self.blocks.get(index)) {
            Some(&data_at) => data_at + ((pointer >> 12) & 0xf_ffff) as i64,
            None => -1,
        }
    }
}

fn open_meta(res: &Resource) -> Result<Meta, String> {
    let broken = |_| "мета-ресурс карты оборван".to_owned();
    let root_at = res.root().ok_or("в ресурсе нет корня")?;
    let root_block = res.u32(root_at + 0x1c).map_err(broken)? as i32;
    let blocks_at = res.at(res.u64(root_at + 0x30).map_err(broken)?).map_or(-1, |at| at as i64);
    let count = res.u16(root_at + 0x4c).map_err(broken)? as i16;
    let mut blocks = Vec::new();
    for index in 0..count.max(0) as usize {
        if blocks_at < 0 {
            return Err("список блоков мета-ресурса вне данных".to_owned());
        }
        let at = blocks_at as usize + index * 16;
        blocks.push(res.at(res.u64(at + 8).map_err(broken)?).map_or(-1, |data_at| data_at as i64));
    }
    let root = usize::try_from(i64::from(root_block) - 1).ok().and_then(|index| blocks.get(index)).copied().unwrap_or(-1);
    Ok(Meta { root, blocks })
}

/// Сырой deflate данных ресурса под прежним заголовком (`compressed` у JS: `deflateRaw` + заголовок RSC7).
fn deflate_with_header(head: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let level = CompressionLvl::new(MAP_LEVEL).map_err(|_| "уровень сжатия вне 1…12".to_owned())?;
    let mut compressor = Compressor::new(level);
    let mut out = vec![0u8; head.len() + compressor.deflate_compress_bound(data.len())];
    out[..head.len()].copy_from_slice(head);
    let size = compressor.deflate_compress(data, &mut out[head.len()..]).map_err(|error| format!("сжатие: {error:?}"))?;
    out.truncate(head.len() + size);
    Ok(out)
}

/// Карта травы `raw` в цвете травы зоны (`patchGrassMap` с `targetAt`, без цветов).
pub fn process(raw: &[u8], job: &GrassJob, plan: &GrassPlan, clock: &Clock) -> Grass {
    if raw.len() < HEADER_BYTES {
        return fallback("файл короче заголовка");
    }
    let parse_from = Instant::now();
    let mut res = match open_resource(raw) {
        Ok(res) if res.complete => res,
        Ok(_) => return fallback("данные ресурса короче заявленных"),
        Err(error) => return fallback(error.to_string()),
    };
    let meta = match open_meta(&res) {
        Ok(meta) => meta,
        Err(reason) => return fallback(reason),
    };
    Clock::add(&clock.parse, parse_from);
    if meta.root < 0 {
        return Grass::Unchanged;
    }
    let root = meta.root as usize;
    let (Ok(list), Ok(batches)) = (res.u64(root + 208), res.u16(root + 216)) else { return fallback("корень карты оборван") };
    let list_at = meta.resolve(list);
    if list_at < 0 || batches == 0 {
        return Grass::Unchanged;
    }
    let pixels_from = Instant::now();
    let mut oracle = Oracle::port();
    let mut instances = 0u32;
    for batch in 0..usize::from(batches) {
        let at = list_at as usize + batch * BATCH_BYTES;
        let read = (|| -> Result<(f64, f64, f64, f64, u32, u64, u16), rage_res::Error> {
            Ok((
                f64::from(res.f32(at)?),
                f64::from(res.f32(at + 4)?),
                f64::from(res.f32(at + 16)?),
                f64::from(res.f32(at + 20)?),
                res.u32(at + BATCH_ARCHETYPE)?,
                res.u64(at + 72)?,
                res.u16(at + 80)?,
            ))
        })();
        let Ok((min_x, min_y, max_x, max_y, archetype, items, count)) = read else { return fallback("пачка карты оборвана") };
        let items_at = meta.resolve(items);
        if items_at < 0 || plan.non_plant.contains(&archetype) {
            continue;
        }
        let blade = plan.blades.get(&archetype).unwrap_or(&plan.default);
        let count = usize::from(count);
        let mut colours = Vec::with_capacity(count * 3);
        let mut slots = Vec::with_capacity(count);
        for item in 0..count {
            let instance = items_at as usize + item * INSTANCE_BYTES;
            let (Ok(x16), Ok(y16), Ok(colour)) = (res.u16(instance), res.u16(instance + 2), res.bytes(instance + INSTANCE_COLOUR, 3)) else {
                return fallback("экземпляр травы за концом данных");
            };
            let x = min_x + (f64::from(x16) / 65535.0) * (max_x - min_x);
            let y = min_y + (f64::from(y16) / 65535.0) * (max_y - min_y);
            let Some(slot) = job.zone.field.index(x, y) else { return fallback("цвет травы в точке вне полосы эффекта") };
            slots.push(slot as i32);
            colours.extend_from_slice(colour);
        }
        if count == 0 {
            continue;
        }
        let shifted = match grass::instance_colours(&colours, &slots, &job.zone.targets, blade.sheet, &blade.reference, &mut oracle) {
            Ok(shifted) => shifted,
            Err(reason) => return fallback(reason),
        };
        instances += count as u32;
        /* Сразу в данные: у JS партии правят экземпляры по порядку, и общий массив экземпляров второй партии читается уже правленым. */
        let data = res.data_mut();
        for (item, colour) in shifted.chunks_exact(3).enumerate() {
            let at = items_at as usize + item * INSTANCE_BYTES + INSTANCE_COLOUR;
            data[at..at + 3].copy_from_slice(colour);
        }
    }
    Clock::add(&clock.pixels, pixels_from);
    if instances == 0 {
        return Grass::Unchanged;
    }
    let deflate_from = Instant::now();
    let packed = deflate_with_header(&raw[..HEADER_BYTES], res.data());
    Clock::add(&clock.deflate, deflate_from);
    match packed {
        Ok(bytes) => Grass::Built { bytes, instances },
        Err(reason) => fallback(reason),
    }
}
