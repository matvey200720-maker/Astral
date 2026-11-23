//! Чтение словарей клипов (`.ycd`): список клипов и поза костей клипа в заданный момент.

use std::iter::successors;

use crate::error::{Error, Result};
use crate::resource::Resource;

#[derive(Debug, Clone, PartialEq)]
pub struct PoseBone {
    pub tag: u16,
    pub track: &'static str,
    pub value: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PoseSample {
    pub clip: String,
    pub frames: u16,
    pub duration: f32,
    pub time: f32,
    pub bones: Vec<PoseBone>,
}

const MAX_VISITS: usize = 4096;
const FRAME_CEILING: f32 = 65535.0;
const KIND_COUNT: usize = 9;
const COUNTERS_LEN: usize = KIND_COUNT * 2;
const BLOCK_HEAD: usize = 32;
const SLOTS: usize = 5;

const MSG_NO_ROOT: &str = "Словарь клипов без корня.";
const MSG_CHAIN: &str = "Цепочка карты клипов слишком длинная.";
const MSG_NO_BONES: &str = "Анимация без костей.";
const MSG_NO_BLOCKS: &str = "Анимация без последовательностей.";
const MSG_NO_BLOCK: &str = "Последовательность без блока.";
const MSG_NO_FRAMES: &str = "Последовательность клипа без кадров.";
const MSG_LIST_CUT: &str = "Список каналов обрезан.";
const MSG_PARAMS_CUT: &str = "Параметры канала обрезаны.";
const MSG_OUTSIDE: &str = "Кадр или кость вне клипа.";
const MSG_LINEAR_RANGE: &str = "Линейный канал выходит за пределы чисел.";
const MSG_PALETTE_OUT: &str = "Палитра канала выходит за данные блока.";

// ---------------------------------------------------------------------------------------------
// Чтение полей и битов
// ---------------------------------------------------------------------------------------------

/// Поля записи по таблице (смещение, ширина в байтах): значения как целые без знака.
fn peek<const N: usize>(res: &Resource, base: usize, spec: [(usize, usize); N]) -> Result<[u64; N]> {
    let mut out = [0u64; N];
    for (cell, (off, width)) in out.iter_mut().zip(spec) {
        let raw = res.bytes(base + off, width)?;
        *cell = raw.iter().rev().fold(0u64, |acc, &b| (acc << 8) | u64::from(b));
    }
    Ok(out)
}

fn float_of(bits: u64) -> f32 {
    f32::from_bits(bits as u32)
}

/// До 64 бит младшим вперёд; всё, что за концом данных, читается нулями.
fn take(bytes: &[u8], pos: usize, width: u64) -> u64 {
    let width = width.min(64) as usize;
    let (mut value, mut got) = (0u64, 0usize);
    while got < width {
        let Some(at) = pos.checked_add(got) else { break };
        let Some(&byte) = bytes.get(at / 8) else { break };
        let shift = at % 8;
        let room = (8 - shift).min(width - got);
        value |= (u64::from(byte >> shift) & ((1 << room) - 1)) << got;
        got += room;
    }
    value
}

fn short_at(blob: &[u8], at: usize) -> Result<u16> {
    at.checked_add(2)
        .and_then(|to| blob.get(at..to))
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
        .ok_or_else(|| Error::broken(MSG_LIST_CUT))
}

/// Свободная четвёртая компонента единичного кватерниона.
fn tail_of(xyz: [f32; 3]) -> f32 {
    (1.0 - xyz.iter().fold(0.0f32, |acc, c| acc + c * c)).max(0.0).sqrt()
}

fn unit_quaternion(xyz: [f32; 3]) -> [f32; 4] {
    [xyz[0], xyz[1], xyz[2], tail_of(xyz)]
}

// ---------------------------------------------------------------------------------------------
// Записи блока
// ---------------------------------------------------------------------------------------------

/// Как достаются значения канала из кадров блока.
enum Decode {
    Raw,
    Scaled { bits: u32, quantum: f32, offset: f32 },
    Indexed { bits: u32, table: Vec<f32>, offset: f32 },
}

impl Decode {
    fn bits(&self) -> u32 {
        match self {
            Decode::Raw => 32,
            Decode::Scaled { bits, .. } | Decode::Indexed { bits, .. } => *bits,
        }
    }
}

enum Entry {
    Fixed(f32),
    Triple([f32; 3]),
    Quad([f32; 4]),
    Stepped(Vec<f32>),
    Packed { lane: usize, how: Decode },
    Cached { index: u16, primary: bool },
}

type Row = [Option<Entry>; SLOTS];

struct Block {
    bytes: Vec<u8>,
    frames_at: usize,
    frame_len: usize,
    frames: usize,
    rows: Vec<Row>,
}

impl Block {
    /// Значение кадрового канала: `lane` — сдвиг его бит внутри кадра.
    fn unpack(&self, lane: usize, how: &Decode, frame: usize) -> f32 {
        let pos = (self.frames_at + self.frame_len * frame) * 8 + lane;
        let raw = take(&self.bytes, pos, u64::from(how.bits()));
        match how {
            Decode::Raw => float_of(raw),
            Decode::Scaled { quantum, offset, .. } => raw as f32 * quantum + offset,
            Decode::Indexed { table, offset, .. } => table.get(raw as usize).copied().unwrap_or(*offset),
        }
    }
}

/// Число, которое читается из четырёх байт параметров.
trait Word: Sized {
    fn from_word(raw: [u8; 4]) -> Self;
}

impl Word for f32 {
    fn from_word(raw: [u8; 4]) -> Self {
        f32::from_le_bytes(raw)
    }
}

impl Word for i32 {
    fn from_word(raw: [u8; 4]) -> Self {
        i32::from_le_bytes(raw)
    }
}

impl Word for u32 {
    fn from_word(raw: [u8; 4]) -> Self {
        u32::from_le_bytes(raw)
    }
}

/// Состояние чтения параметров каналов блока.
struct Ctx<'a> {
    bytes: &'a [u8],
    at: usize,
    lane: usize,
    frames: usize,
    chunk: usize,
}

impl Ctx<'_> {
    fn word(&mut self) -> Result<[u8; 4]> {
        let from = self.at;
        let got = from
            .checked_add(4)
            .and_then(|to| self.bytes.get(from..to))
            .ok_or_else(|| Error::broken(MSG_PARAMS_CUT))?;
        self.at += 4;
        Ok([got[0], got[1], got[2], got[3]])
    }

    fn num<T: Word>(&mut self) -> Result<T> {
        self.word().map(T::from_word)
    }

    /// Сдвиг на `words` слов; ниже нуля курсор не уходит.
    fn shift_words(&mut self, words: i64) {
        self.at = (self.at as i64 + words * 4).max(0) as usize;
    }

    /// Канал с битами в кадре: запоминает его сдвиг и двигает общий.
    fn packed(&mut self, how: Decode) -> Entry {
        let lane = self.lane;
        self.lane += how.bits() as usize;
        Entry::Packed { lane, how }
    }
}

fn read_quaternion(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    let xyz: [f32; 3] = [cx.num()?, cx.num()?, cx.num()?];
    Ok(Entry::Quad(unit_quaternion(xyz)))
}

fn read_vector(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    Ok(Entry::Triple([cx.num()?, cx.num()?, cx.num()?]))
}

fn read_float(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    Ok(Entry::Fixed(cx.num()?))
}

fn read_raw(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    Ok(cx.packed(Decode::Raw))
}

fn read_scaled(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    let bits: u32 = cx.num()?;
    let (quantum, offset): (f32, f32) = (cx.num()?, cx.num()?);
    Ok(cx.packed(Decode::Scaled { bits, quantum, offset }))
}

fn read_palette(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    let (index_bits, value_bits): (u32, u32) = (cx.num()?, cx.num()?);
    let words = i64::from(cx.num::<i32>()?);
    let (quantum, offset): (f32, f32) = (cx.num()?, cx.num()?);
    let by_size = (words * 32).checked_div(i64::from(value_bits)).unwrap_or(0);
    let by_index = match index_bits {
        0..=30 => (1i64 << index_bits) - 1,
        _ => i64::MAX,
    };
    let count = by_size.min(by_index).max(0);
    let (bytes, origin, step) = (cx.bytes, cx.at * 8, value_bits as usize);
    // Таблица лежит внутри данных блока; иначе разбор шёл бы по миллиардам нулевых значений.
    let inside = usize::try_from(count)
        .ok()
        .and_then(|n| n.checked_mul(step))
        .and_then(|span| origin.checked_add(span))
        .is_some_and(|end| end <= bytes.len() * 8);
    if !inside {
        return Err(Error::broken(MSG_PALETTE_OUT));
    }
    let room = usize::try_from(count).unwrap_or(0).min(1 << 20);
    let table = (0..count).fold(Vec::with_capacity(room), |mut table, i| {
        let raw = take(bytes, origin + i as usize * step, u64::from(value_bits));
        table.push(raw as f32 * quantum + offset);
        table
    });
    cx.shift_words(words);
    Ok(cx.packed(Decode::Indexed { bits: index_bits, table, offset }))
}

/// Бегущее значение линейного канала: уровень и скорость меняются ступенями.
struct Ramp<'a> {
    bytes: &'a [u8],
    cursor: usize,
    value: i64,
    speed: i64,
    bits: u64,
}

impl Ramp<'_> {
    fn level(&self, quantum: f32, offset: f32) -> f32 {
        self.value as f32 * quantum + offset
    }

    /// Читает очередное изменение скорости и применяет его; None, если числа не умещаются.
    fn advance(&mut self) -> Option<()> {
        let mut change = take(self.bytes, self.cursor, self.bits) as i64;
        self.cursor = self.cursor.checked_add(self.bits as usize)?;
        let stop = (self.bytes.len() * 8).max(self.cursor.checked_add(1)?);
        let consumed = (self.cursor..stop)
            .position(|p| take(self.bytes, p, 1) == 1)
            .map_or(stop - self.cursor, |i| i + 1);
        self.cursor = self.cursor.checked_add(consumed)?;
        change |= i64::from((consumed as i32 - 1) << (self.bits & 31));
        if change != 0 {
            let minus = take(self.bytes, self.cursor, 1) == 1;
            self.cursor = self.cursor.checked_add(1)?;
            if minus {
                change = change.checked_neg()?;
            }
        }
        self.speed = self.speed.checked_add(change)?;
        self.value = self.value.checked_add(self.speed)?;
        Some(())
    }
}

fn read_linear(cx: &mut Ctx, _tag: u16) -> Result<Entry> {
    let words = i64::from(cx.num::<i32>()?);
    let counters: u32 = cx.num()?;
    let (quantum, offset): (f32, f32) = (cx.num()?, cx.num()?);
    let [w_off, w_start, w_change] = [0, 8, 16].map(|s| u64::from((counters >> s) & 0xFF));
    let (bytes, frames, chunk) = (cx.bytes, cx.frames, cx.chunk);
    let chunks = (chunk + frames - 1) / chunk;
    let begin = cx.at * 8;
    let data_start = begin + chunks * (w_off + w_start) as usize;

    let mut cursor = begin;
    let mut pull = |width: u64| -> Vec<u64> {
        (0..chunks)
            .map(|_| {
                let v = take(bytes, cursor, width);
                cursor += width as usize;
                v
            })
            .collect()
    };
    let offsets = pull(w_off);
    let starts = pull(w_start);

    let range_error = || Error::broken(MSG_LINEAR_RANGE);
    let mut series: Vec<f32> = Vec::with_capacity(frames.min(1 << 20));
    for (k, (&shift, &first)) in offsets.iter().zip(&starts).enumerate() {
        let cursor = usize::try_from(shift)
            .ok()
            .and_then(|s| s.checked_add(data_start))
            .ok_or_else(range_error)?;
        let mut ramp = Ramp { bytes, cursor, value: first as i64, speed: 0, bits: w_change };
        let room = (frames - k * chunk).min(chunk);
        for s in 0..room {
            series.push(ramp.level(quantum, offset));
            if s + 1 < chunk {
                ramp.advance().ok_or_else(range_error)?;
            }
        }
    }
    cx.shift_words(words - 4);
    Ok(Entry::Stepped(series))
}

fn read_cache_primary(_cx: &mut Ctx, tag: u16) -> Result<Entry> {
    Ok(Entry::Cached { index: tag & 3, primary: true })
}

fn read_cache_alt(_cx: &mut Ctx, tag: u16) -> Result<Entry> {
    Ok(Entry::Cached { index: tag & 3, primary: false })
}

type Reader = fn(&mut Ctx, u16) -> Result<Entry>;

/// Читатели каналов по типу 0..8.
const READERS: [Reader; KIND_COUNT] = [
    read_quaternion,
    read_vector,
    read_float,
    read_raw,
    read_scaled,
    read_palette,
    read_linear,
    read_cache_primary,
    read_cache_alt,
];

/// Слот канала в группе: у кэшированных типов он свой, у прочих — из тега.
fn home_slot(kind: usize, tag: u16) -> usize {
    match kind {
        7 => 3,
        8 => 4,
        _ => usize::from(tag & 3),
    }
}

fn read_block(res: &Resource, at: usize) -> Result<Block> {
    let [data_len, frames_at, frames, frame_len, chunk] =
        peek(res, at, [(4, 4), (12, 4), (0x16, 2), (0x18, 2), (0x1E, 1)])?.map(|v| v as usize);
    if frames == 0 || chunk == 0 {
        return Err(Error::broken(MSG_NO_FRAMES));
    }
    let blob = res.bytes(at + BLOCK_HEAD, data_len)?;
    let counters_at = frames_at + frame_len * frames;
    let counts = (0..KIND_COUNT)
        .map(|i| short_at(blob, counters_at + i * 2).map(usize::from))
        .collect::<Result<Vec<_>>>()?;

    let mut cx = Ctx { bytes: blob, at: 0, lane: 0, frames, chunk };
    let mut rows: Vec<Row> = Vec::new();
    let mut tag_at = counters_at + COUNTERS_LEN;
    for (kind, count) in counts.into_iter().enumerate() {
        for i in 0..count {
            let tag = short_at(blob, tag_at + i * 2)?;
            let entry = READERS[kind](&mut cx, tag)?;
            let group = usize::from(tag >> 2);
            if rows.len() <= group {
                rows.resize_with(group + 1, Default::default);
            }
            rows[group][home_slot(kind, tag)].get_or_insert(entry);
        }
        tag_at += count.next_multiple_of(4) * 2;
    }
    Ok(Block { bytes: blob.to_vec(), frames_at, frame_len, frames, rows })
}

// ---------------------------------------------------------------------------------------------
// Значения группы в кадре блока
// ---------------------------------------------------------------------------------------------

struct View<'a> {
    block: &'a Block,
    row: &'a Row,
    local: usize,
}

impl View<'_> {
    /// Число канала; векторы и кэшированные каналы дают ноль.
    fn plain(&self, entry: &Entry) -> f32 {
        match entry {
            Entry::Fixed(v) => *v,
            Entry::Stepped(s) => s[self.local % s.len()],
            Entry::Packed { lane, how } => self.block.unpack(*lane, how, self.local % self.block.frames),
            _ => 0.0,
        }
    }

    fn at_slot(&self, slot: usize) -> f32 {
        self.row[slot].as_ref().map_or(0.0, |e| self.plain(e))
    }

    fn xyz(&self) -> [f32; 3] {
        [0, 1, 2].map(|s| self.at_slot(s))
    }

    fn primary(&self) -> bool {
        self.row
            .iter()
            .flatten()
            .any(|e| matches!(e, Entry::Cached { primary: true, .. }))
    }

    /// Четыре числа группы: слот — позиция, пустой слот оставляет нулевую дыру.
    fn vector(&self) -> [f32; 4] {
        let parts = self.row.iter().scan(0usize, |filled, slot| {
            if *filled >= 4 {
                return None;
            }
            let part: Vec<f32> = match slot {
                None => vec![0.0],
                Some(Entry::Triple(v)) => v.to_vec(),
                Some(Entry::Quad(q)) => q.to_vec(),
                Some(Entry::Cached { .. }) => vec![tail_of(self.xyz())],
                Some(other) => vec![self.plain(other)],
            };
            *filled += part.len();
            Some(part)
        });
        let mut out = [0f32; 4];
        out.iter_mut().zip(parts.flatten()).for_each(|(dst, src)| *dst = src);
        out
    }

    /// Кэшированный кватернион: `w` встаёт на место, заданное индексом.
    fn cached_quaternion(&self) -> [f32; 4] {
        let xyz = self.xyz();
        let index = [3, 4].iter().find_map(|&s| match &self.row[s] {
            Some(Entry::Cached { index, .. }) => Some(usize::from(*index)),
            _ => None,
        });
        match index {
            Some(i) if i <= 3 => {
                let mut parts = xyz.to_vec();
                parts.insert(i, tail_of(xyz));
                [parts[0], parts[1], parts[2], parts[3]]
            }
            _ => [0.0, 0.0, 0.0, 1.0],
        }
    }

    fn value(&self, rotation: bool) -> Vec<f32> {
        if !self.primary() {
            let v = self.vector();
            return v[..if rotation { 4 } else { 3 }].to_vec();
        }
        let q = self.cached_quaternion();
        if rotation {
            return q.to_vec();
        }
        let norm = q.iter().fold(0.0f32, |acc, c| acc + c * c).sqrt();
        q[..3].iter().map(|c| c / norm).collect()
    }
}

// ---------------------------------------------------------------------------------------------
// Словарь
// ---------------------------------------------------------------------------------------------

struct Names {
    full: String,
    short: String,
}

/// Короткое имя: хвост после последнего `/` (если он не пуст), до первой точки
/// (если она не первый символ), в нижнем регистре.
fn short_name(full: &str) -> String {
    let unified = full.replace('\\', "/");
    let tail = unified
        .rsplit_once('/')
        .map(|(_, t)| t)
        .filter(|t| !t.is_empty())
        .unwrap_or(&unified);
    let stem = tail
        .split_once('.')
        .map(|(s, _)| s)
        .filter(|s| !s.is_empty())
        .unwrap_or(tail);
    stem.to_lowercase()
}

struct Animation {
    frames: u16,
    limit: u16,
    duration: f32,
    bones: Vec<(u16, u8)>,
    blocks: Vec<Block>,
}

struct Dict {
    res: Resource,
}

impl Dict {
    fn open(bytes: &[u8]) -> Result<Self> {
        Resource::parse(bytes).map(|res| Dict { res })
    }

    /// Смещения всех клипов в порядке обхода корзин.
    fn clips(&self) -> Result<Vec<usize>> {
        let res = &self.res;
        let root = res.root().ok_or_else(|| Error::broken(MSG_NO_ROOT))?;
        let Some(array) = res.pointer_at(root + 0x28) else {
            return Ok(Vec::new());
        };
        let cap = usize::from(res.u16(root + 0x30)?);
        let mut found = Vec::new();
        for bucket in 0..cap {
            let chain: Vec<usize> = successors(res.pointer_at(array + bucket * 8), |&e| res.pointer_at(e + 0x10))
                .take(MAX_VISITS + 1)
                .collect();
            if chain.len() > MAX_VISITS {
                return Err(Error::broken(MSG_CHAIN));
            }
            found.extend(chain.iter().filter_map(|&e| res.pointer_at(e + 8)));
        }
        Ok(found)
    }

    fn names(&self, clip: usize) -> Result<Option<Names>> {
        let [len] = peek(&self.res, clip, [(0x20, 2)])?;
        let Some(at) = self.res.pointer_at(clip + 0x18).filter(|_| len > 0) else {
            return Ok(None);
        };
        let full = String::from_utf8_lossy(self.res.bytes(at, len as usize)?).into_owned();
        Ok(Some(Names { short: short_name(&full), full }))
    }

    /// Первый клип, у которого короткое или полное имя совпало (регистр ASCII не важен).
    fn find(&self, wanted: &str) -> Result<Option<(usize, Names)>> {
        let same = |n: &Names| wanted.eq_ignore_ascii_case(&n.short) || wanted.eq_ignore_ascii_case(&n.full);
        self.clips()?
            .into_iter()
            .map(|clip| self.names(clip).map(|n| n.map(|n| (clip, n))))
            .find_map(|probe| match probe {
                Ok(Some((clip, n))) if same(&n) => Some(Ok((clip, n))),
                Ok(_) => None,
                Err(e) => Some(Err(e)),
            })
            .transpose()
    }

    /// Анимация клипа и границы времени по виду клипа.
    fn target(&self, clip: usize, wanted: &str) -> Result<(usize, f32, f32)> {
        let res = &self.res;
        let empty = || Error::broken(format!("клип «{wanted}» пуст"));
        let no_bones = || Error::broken(format!("у клипа «{wanted}» нет анимации костей"));
        let ends = |at: usize| peek(res, at, [(0, 4), (4, 4)]).map(|[s, e]| (float_of(s), float_of(e)));
        let [kind] = peek(res, clip, [(0x10, 4)])?;
        match kind {
            1 => {
                let anim = res.pointer_at(clip + 0x50).ok_or_else(empty)?;
                let (start, end) = ends(clip + 0x58)?;
                Ok((anim, start, end))
            }
            2 => {
                let [count] = peek(res, clip, [(0x58, 2)])?;
                let Some(list) = res.pointer_at(clip + 0x50).filter(|_| count > 0) else {
                    return Err(no_bones());
                };
                let (start, end) = ends(list)?;
                let anim = res.pointer_at(list + 0x10).ok_or_else(empty)?;
                Ok((anim, start, end))
            }
            _ => Err(no_bones()),
        }
    }

    fn animation(&self, at: usize) -> Result<Animation> {
        let res = &self.res;
        let [frames, limit, duration, bone_count, block_count] =
            peek(res, at, [(0x14, 2), (0x16, 2), (0x18, 4), (0x58, 2), (0x48, 2)])?;
        let bones = if bone_count == 0 {
            Vec::new()
        } else {
            let list = res.pointer_at(at + 0x50).ok_or_else(|| Error::broken(MSG_NO_BONES))?;
            (0..bone_count as usize)
                .map(|i| peek(res, list + i * 4, [(0, 2), (3, 1)]).map(|[id, track]| (id as u16, track as u8)))
                .collect::<Result<Vec<_>>>()?
        };
        let blocks = if block_count == 0 {
            Vec::new()
        } else {
            let list = res.pointer_at(at + 0x40).ok_or_else(|| Error::broken(MSG_NO_BLOCKS))?;
            (0..block_count as usize)
                .map(|i| {
                    let block = res.pointer_at(list + i * 8).ok_or_else(|| Error::broken(MSG_NO_BLOCK))?;
                    read_block(res, block)
                })
                .collect::<Result<Vec<_>>>()?
        };
        Ok(Animation { frames: frames as u16, limit: limit as u16, duration: float_of(duration), bones, blocks })
    }

    /// Клип словаря, разобранный целиком: дальше его кадры снимает `ClipSampler`, словарь не нужен.
    fn sampler(&self, wanted: &str) -> Result<ClipSampler> {
        let (clip, names) = self
            .find(wanted)?
            .ok_or_else(|| Error::broken(format!("клипа «{wanted}» нет")))?;
        let (anim_at, start, end) = self.target(clip, wanted)?;
        if start.is_nan() {
            return Err(Error::broken(format!("у клипа «{wanted}» время начала не число")));
        }
        let anim = self.animation(anim_at)?;
        Ok(ClipSampler { clip: names.short, start, end, anim })
    }
}

/// Клип, открытый один раз: разобранная анимация и границы времени клипа.
///
/// Словарь читается и разбирается при `open`; дальше любое число моментов снимается без повторного
/// разбора. `sample` даёт ровно то, что `sample_clip` на тех же байтах, имени и смещении.
pub struct ClipSampler {
    clip: String,
    start: f32,
    end: f32,
    anim: Animation,
}

impl ClipSampler {
    pub fn open(bytes: &[u8], clip_name: &str) -> Result<Self> {
        Dict::open(bytes)?.sampler(clip_name)
    }

    /// Короткое имя клипа, как в ответе `sample_clip`.
    pub fn clip(&self) -> &str {
        &self.clip
    }

    pub fn frames(&self) -> u16 {
        self.anim.frames
    }

    pub fn duration(&self) -> f32 {
        self.anim.duration
    }

    /// Момент выборки и номер кадра анимации для смещения от начала клипа.
    pub fn locate(&self, offset: f32) -> (f32, usize) {
        let time = settle(self.start, self.end, offset);
        (time, pick_frame(time, self.anim.duration, self.anim.frames))
    }

    /// Кости в кадре `frame` (номер из `locate`): те, что дают конечные числа, дорожками поворота и сдвига.
    pub fn bones_at(&self, frame: usize) -> Result<Vec<PoseBone>> {
        let anim = &self.anim;
        let per_block = usize::from(anim.limit).max(1);
        let (block_no, local) = (frame / per_block, frame % per_block);
        let posed = anim
            .bones
            .iter()
            .enumerate()
            .map(|(i, &(tag, track))| -> Result<Option<PoseBone>> {
                let Some((rotation, label)) = track_label(track) else {
                    return Ok(None);
                };
                let (block, row) = anim
                    .blocks
                    .get(block_no)
                    .and_then(|b| b.rows.get(i).map(|row| (b, row)))
                    .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
                let value = View { block, row, local }.value(rotation);
                if value.iter().any(|v| !v.is_finite()) {
                    return Ok(None);
                }
                Ok(Some(PoseBone { tag, track: label, value }))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(posed.into_iter().flatten().collect())
    }

    pub fn sample(&self, offset: f32) -> Result<PoseSample> {
        let (time, frame) = self.locate(offset);
        let bones = self.bones_at(frame)?;
        Ok(PoseSample { clip: self.clip.clone(), frames: self.anim.frames, duration: self.anim.duration, time, bones })
    }
}

/// Момент выборки: смещение от начала клипа, зажатое между началом и концом.
fn settle(start: f32, end: f32, offset: f32) -> f32 {
    let ceiling = start.max(end);
    (start + offset).clamp(start, ceiling)
}

fn track_label(track: u8) -> Option<(bool, &'static str)> {
    match track {
        0 => Some((false, "translation")),
        1 => Some((true, "rotation")),
        _ => None,
    }
}

/// Кадр по времени: кадров на один меньше, дробная часть отбрасывается, номер по модулю.
fn pick_frame(time: f32, duration: f32, frames: u16) -> usize {
    let total = u32::from(frames).max(1);
    let cur = (time / duration) * (total - 1) as f32;
    let whole = if cur > 0.0 && cur.is_finite() { cur.min(FRAME_CEILING) as u32 } else { 0 };
    (whole % total) as usize
}

pub fn clip_names(bytes: &[u8]) -> Result<Vec<String>> {
    let dict = Dict::open(bytes)?;
    let mut keyed = Vec::new();
    for clip in dict.clips()? {
        if let Some(n) = dict.names(clip)? {
            keyed.push((n.short.to_ascii_uppercase(), n.short));
        }
    }
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    let mut out: Vec<String> = Vec::with_capacity(keyed.len());
    for (_, name) in keyed {
        if !out.last().is_some_and(|prev| prev.eq_ignore_ascii_case(&name)) {
            out.push(name);
        }
    }
    Ok(out)
}

pub fn sample_clip(bytes: &[u8], clip_name: &str, time_offset: f32) -> Result<PoseSample> {
    ClipSampler::open(bytes, clip_name)?.sample(time_offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_names_follow_the_path_and_dot_rules() {
        let table = [
            ("pack:/ycd_cached.clip", "ycd_cached"),
            ("Dir\\Sub\\Foo.Bar.clip", "foo"),
            ("NoExt", "noext"),
            (".hidden", ".hidden"),
            (".hidden.clip", ".hidden.clip"),
            ("a/", "a/"),
            ("/", "/"),
            (".", "."),
            ("..", ".."),
            ("a.", "a"),
            ("a.b/c", "c"),
            ("x/y/", "x/y/"),
            ("x\\y\\", "x/y/"),
            ("ÄÖ.clip", "äö"),
            ("İx", "i̇x"),
            ("dir/.hidden", ".hidden"),
            ("weird//double", "double"),
            ("C:\\a\\b\\Walk_Fwd.clip", "walk_fwd"),
        ];
        for (full, short) in table {
            assert_eq!(short_name(full), short, "{full:?}");
        }
    }

    #[test]
    fn unit_quaternion_closes_the_unit_length() {
        assert_eq!(unit_quaternion([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(unit_quaternion([1.0, 1.0, 1.0])[3], 0.0);
        assert_eq!(unit_quaternion([f32::NAN, 0.0, 0.0])[3], 0.0);
        let q = unit_quaternion([0.1, 0.2, 0.3]);
        assert!((q[3] - 0.92736185).abs() < 1e-7);
    }

    #[test]
    fn bit_reader_is_little_endian_and_zero_past_the_end() {
        let bytes = [0b1010_0101u8, 0xff];
        assert_eq!(take(&bytes, 0, 4), 0b0101);
        assert_eq!(take(&bytes, 4, 8), 0xfa);
        assert_eq!(take(&bytes, 12, 8), 0x0f);
        assert_eq!(take(&bytes, 100, 32), 0);
        assert_eq!(take(&bytes, usize::MAX - 3, 64), 0);
        assert_eq!(take(&bytes, 0, 100), 0xffa5);
    }

    fn row_of(entries: Vec<Option<Entry>>) -> Row {
        let mut row: Row = Default::default();
        for (slot, entry) in entries.into_iter().enumerate() {
            row[slot] = entry;
        }
        row
    }

    fn lone_block() -> Block {
        Block { bytes: Vec::new(), frames_at: 0, frame_len: 0, frames: 1, rows: Vec::new() }
    }

    fn numbers(entries: Vec<Option<Entry>>, local: usize, rotation: bool) -> Vec<f32> {
        let (block, row) = (lone_block(), row_of(entries));
        View { block: &block, row: &row, local }.value(rotation)
    }

    #[test]
    fn group_vectors_use_slot_positions() {
        let hole = vec![Some(Entry::Fixed(1.0)), None, Some(Entry::Fixed(3.0))];
        assert_eq!(numbers(hole, 0, true), [1.0, 0.0, 3.0, 0.0]);
        let mixed = vec![Some(Entry::Triple([1.0, 2.0, 3.0])), Some(Entry::Fixed(9.0))];
        assert_eq!(numbers(mixed, 0, true), [1.0, 2.0, 3.0, 9.0]);
        let shifted = vec![Some(Entry::Fixed(9.0)), Some(Entry::Triple([1.0, 2.0, 3.0]))];
        assert_eq!(numbers(shifted, 0, true), [9.0, 1.0, 2.0, 3.0]);
        let ring = vec![Some(Entry::Stepped(vec![4.0, 5.0]))];
        assert_eq!(numbers(ring, 3, true), [5.0, 0.0, 0.0, 0.0]);
        let single = vec![Some(Entry::Fixed(7.0))];
        assert_eq!(numbers(single, 0, false), [7.0, 0.0, 0.0]);
    }

    #[test]
    fn cached_quaternion_places_w_by_index() {
        let entries = |index| {
            vec![
                Some(Entry::Fixed(0.1)),
                Some(Entry::Fixed(0.2)),
                Some(Entry::Fixed(0.3)),
                Some(Entry::Cached { index, primary: true }),
            ]
        };
        let w = 0.92736185f32;
        assert_eq!(numbers(entries(0), 0, true), [w, 0.1, 0.2, 0.3]);
        assert_eq!(numbers(entries(3), 0, true), [0.1, 0.2, 0.3, w]);
        let shifted = numbers(entries(1), 0, false);
        assert!((shifted[1] - w).abs() < 1e-6 && (shifted[0] - 0.1).abs() < 1e-6);
    }

    #[test]
    fn frames_come_from_time_by_dropping_the_fraction() {
        assert_eq!(pick_frame(0.5, 1.0, 10), 4);
        assert_eq!(pick_frame(1.0, 1.0, 10), 9);
        assert_eq!(pick_frame(1.5, 1.0, 10), 3);
        assert_eq!(pick_frame(0.5, 0.0, 10), 0);
        assert_eq!(pick_frame(f32::NAN, 1.0, 10), 0);
        assert_eq!(pick_frame(0.5, 1.0, 0), 0);
        assert_eq!(settle(0.5, 0.2, 3.0), 0.5);
        assert_eq!(settle(0.0, 1.0, -2.0), 0.0);
    }

    fn tiny_dictionary(start: f32) -> Vec<u8> {
        use crate::ycd_write::{name_hash, BoneTrack, Channel, Group, NewAnimation, NewClip};
        let group = Group { slots: [Some(Channel::StaticVector3([1.0, 2.0, 3.0])), None, None, None], cached: None };
        crate::ycd_write::new_dictionary(&[NewClip {
            hash: name_hash("pose_nan"),
            name: "pose_nan".into(),
            start,
            end: 0.9,
            rate: 1.0,
            properties: Vec::new(),
            animation: NewAnimation {
                hash: name_hash("pose_nan_anim"),
                signature: 1,
                duration: 1.0,
                frames: 4,
                limit: 6,
                bones: vec![BoneTrack { bone: 3, track: 0, unk: 0 }],
                groups: vec![group],
                sequences: None,
            },
        }])
        .unwrap()
    }

    /// Файл с правкой несжатого тела: заголовок тот же, тело сжато заново.
    fn patched(file: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut body = Resource::parse(file).unwrap().data().to_vec();
        edit(&mut body);
        [&file[..16], crate::resource::deflate_zlib9(&body).as_slice()].concat()
    }

    #[test]
    fn a_clip_that_starts_at_nan_is_refused_not_panicked_on() {
        let file = tiny_dictionary(0.123_456_79);
        let ok = sample_clip(&file, "pose_nan", 0.0).unwrap();
        assert_eq!(ok.time, 0.123_456_79);
        let marker = 0.123_456_79f32.to_le_bytes();
        let broken = patched(&file, |body| {
            let at = body.windows(4).position(|w| w == marker).expect("начало клипа в теле");
            body[at..at + 4].copy_from_slice(&f32::NAN.to_le_bytes());
        });
        let refusal = sample_clip(&broken, "pose_nan", 0.5).unwrap_err();
        assert_eq!(refusal.message, "у клипа «pose_nan» время начала не число");
        // Конец клипа NaN не ломает: берётся начало.
        let marker_end = 0.9f32.to_le_bytes();
        let no_end = patched(&file, |body| {
            let at = body.windows(4).position(|w| w == marker_end).expect("конец клипа в теле");
            body[at..at + 4].copy_from_slice(&f32::NAN.to_le_bytes());
        });
        assert!(sample_clip(&no_end, "pose_nan", 0.5).is_ok());
    }

    /// Параметры канала подряд, как их читает блок: слова в little-endian.
    fn params(words: &[u32], tail: &[u8]) -> Vec<u8> {
        words.iter().flat_map(|w| w.to_le_bytes()).chain(tail.iter().copied()).collect()
    }

    #[test]
    fn a_palette_that_claims_more_values_than_the_block_holds_is_refused_at_once() {
        // Индекс в 24 бита, значения по биту, слов почти до предела: прежний разбор шёл по 16 млн значений.
        let blob = params(&[24, 1, 0x7fff_ffff, 0, 0], &[0u8; 8]);
        let mut cx = Ctx { bytes: &blob, at: 0, lane: 0, frames: 4, chunk: 4 };
        let started = std::time::Instant::now();
        let refusal = read_palette(&mut cx, 0).err().expect("отказ");
        assert_eq!(refusal.message, "Палитра канала выходит за данные блока.");
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        // Честная палитра: 3 значения по 8 бит в одном слове читаются.
        let honest = params(&[2, 8, 1, 0x3f80_0000, 0], &[10, 20, 30, 0]);
        let mut cx = Ctx { bytes: &honest, at: 0, lane: 0, frames: 4, chunk: 4 };
        let Ok(Entry::Packed { how: Decode::Indexed { table, .. }, .. }) = read_palette(&mut cx, 0) else {
            panic!("палитра должна читаться")
        };
        assert_eq!(table, [10.0, 20.0, 30.0]);
    }

    #[test]
    fn a_linear_channel_whose_numbers_do_not_fit_is_refused_not_wrapped() {
        let refusal = "Линейный канал выходит за пределы чисел.";
        // Изменения по 63 бита из одних единиц, знак плюс: скорость уходит за предел i64 на втором шаге.
        let mut pattern: Vec<bool> = Vec::new();
        for _ in 0..3 {
            pattern.extend(std::iter::repeat(true).take(64));
            pattern.push(false);
        }
        let mut tail = vec![0u8; pattern.len().div_ceil(8)];
        for (i, bit) in pattern.iter().enumerate() {
            if *bit {
                tail[i / 8] |= 1 << (i % 8);
            }
        }
        let steps = params(&[6, 63 << 16, 0, 0], &tail);
        let mut cx = Ctx { bytes: &steps, at: 0, lane: 0, frames: 4, chunk: 4 };
        assert_eq!(read_linear(&mut cx, 0).err().expect("отказ").message, refusal);
        // Смещение цепочки в 64 бита: адрес не умещается в usize.
        let shifts = params(&[6, 64, 0, 0], &[0xffu8; 16]);
        let mut cx = Ctx { bytes: &shifts, at: 0, lane: 0, frames: 4, chunk: 4 };
        assert_eq!(read_linear(&mut cx, 0).err().expect("отказ").message, refusal);
        // Нулевые поля читаются: значения на месте и ровно столько, сколько кадров.
        let calm = params(&[6, 0, 0x3f80_0000, 0], &[0u8; 16]);
        let mut cx = Ctx { bytes: &calm, at: 0, lane: 0, frames: 4, chunk: 4 };
        let Ok(Entry::Stepped(series)) = read_linear(&mut cx, 0) else { panic!("канал должен читаться") };
        assert_eq!(series.len(), 4);
    }

    #[test]
    fn missing_dictionaries_report_their_own_reasons() {
        assert_eq!(clip_names(&[]).unwrap_err().message, "Ресурс короче заголовка RSC7.");
        assert_eq!(clip_names(&[0u8; 32]).unwrap_err().message, "Файл не является ресурсом RSC7.");
        let mut header = vec![0u8; 16];
        header[..4].copy_from_slice(b"RSC7");
        assert_eq!(
            sample_clip(&header, "x", 0.0).unwrap_err().message,
            "Поток ресурса пуст или не распакован."
        );
    }
    // -----------------------------------------------------------------------------------------
    // Клип, открытый один раз
    // -----------------------------------------------------------------------------------------

    use crate::ycd_write::{name_hash as hash_of, BoneTrack, Channel, Group, NewAnimation, NewClip, NewSequence};

    /// Прежний одиночный путь, как он был до деления на «открыть» и «снять»: образец для сверки.
    fn one_shot(bytes: &[u8], wanted: &str, offset: f32) -> Result<PoseSample> {
        let dict = Dict::open(bytes)?;
        let (clip, names) = dict
            .find(wanted)?
            .ok_or_else(|| Error::broken(format!("клипа «{wanted}» нет")))?;
        let (anim_at, start, end) = dict.target(clip, wanted)?;
        if start.is_nan() {
            return Err(Error::broken(format!("у клипа «{wanted}» время начала не число")));
        }
        let anim = dict.animation(anim_at)?;
        let time = settle(start, end, offset);
        let frame = pick_frame(time, anim.duration, anim.frames);
        let per_block = usize::from(anim.limit).max(1);
        let (block_no, local) = (frame / per_block, frame % per_block);
        let posed = anim
            .bones
            .iter()
            .enumerate()
            .map(|(i, &(tag, track))| -> Result<Option<PoseBone>> {
                let Some((rotation, label)) = track_label(track) else {
                    return Ok(None);
                };
                let (block, row) = anim
                    .blocks
                    .get(block_no)
                    .and_then(|b| b.rows.get(i).map(|row| (b, row)))
                    .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
                let value = View { block, row, local }.value(rotation);
                if value.iter().any(|v| !v.is_finite()) {
                    return Ok(None);
                }
                Ok(Some(PoseBone { tag, track: label, value }))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(PoseSample {
            clip: names.short,
            frames: anim.frames,
            duration: anim.duration,
            time,
            bones: posed.into_iter().flatten().collect(),
        })
    }

    /// Равенство до бита: `NaN` у времени равен себе, `-0` не равен `0`.
    fn same_bits(a: &Result<PoseSample>, b: &Result<PoseSample>) -> bool {
        match (a, b) {
            (Ok(x), Ok(y)) => {
                x.clip == y.clip
                    && x.frames == y.frames
                    && x.duration.to_bits() == y.duration.to_bits()
                    && x.time.to_bits() == y.time.to_bits()
                    && x.bones.len() == y.bones.len()
                    && x.bones.iter().zip(&y.bones).all(|(p, q)| {
                        p.tag == q.tag
                            && p.track == q.track
                            && p.value.len() == q.value.len()
                            && p.value.iter().zip(&q.value).all(|(m, n)| m.to_bits() == n.to_bits())
                    })
            }
            (Err(x), Err(y)) => x.message == y.message,
            _ => false,
        }
    }

    /// Клип с движением: поворот и сдвиг корня (тег 0), поворот с каналами всех видов, повтор тега,
    /// кэшированный кватернион, дрейф и дорожка, которую выборка не читает.
    fn walking(name: &str, frames: usize, limit: usize, start: f32, end: f32) -> NewClip {
        let duration = frames.saturating_sub(1) as f32 / 30.0;
        let angle = |k: usize| 0.07 * k as f32;
        let raw = |f: fn(f32) -> f32| Channel::Raw((0..frames).map(|k| f(angle(k))).collect());
        let grid = |step: usize| (0..frames).map(|k| -1.0 + 0.001 * ((k * step) % 9) as f32).collect::<Vec<f32>>();
        let quant = |f: fn(f32) -> f32| Channel::Quantize {
            quantum: 1e-4,
            offset: -1.0,
            values: (0..frames).map(|k| f(0.2 * k as f32)).collect(),
        };
        let hold = || Some(Channel::StaticFloat(0.0));
        let single = |c| Group { slots: [Some(c), None, None, None], cached: None };
        let turn = Group {
            slots: [hold(), hold(), Some(raw(|a| (a / 2.0).sin())), Some(raw(|a| (a / 2.0).cos()))],
            cached: None,
        };
        let sway = Group {
            slots: [
                Some(Channel::Indirect { quantum: 0.001, offset: -1.0, values: grid(3) }),
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: grid(5) }),
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: grid(7) }),
                Some(raw(|a| (a / 2.0).cos())),
            ],
            cached: None,
        };
        let drift = Group {
            slots: [
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: grid(2) }),
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: grid(4) }),
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: grid(8) }),
                None,
            ],
            cached: None,
        };
        let cached = Group { slots: [hold(), hold(), Some(quant(f32::sin)), Some(quant(f32::cos))], cached: Some(0) };
        NewClip {
            hash: hash_of(name),
            name: name.to_string(),
            start,
            end,
            rate: 1.0,
            properties: Vec::new(),
            animation: NewAnimation {
                hash: hash_of(&format!("{name}_anim")),
                signature: 0x1234_5678,
                duration,
                frames,
                limit,
                bones: vec![
                    BoneTrack { bone: 0, track: 1, unk: 1 },
                    BoneTrack { bone: 0, track: 0, unk: 0 },
                    BoneTrack { bone: 7, track: 1, unk: 1 },
                    BoneTrack { bone: 7, track: 1, unk: 1 },
                    BoneTrack { bone: 12, track: 0, unk: 0 },
                    BoneTrack { bone: 15, track: 2, unk: 2 },
                    BoneTrack { bone: 20, track: 1, unk: 1 },
                ],
                groups: vec![
                    turn,
                    single(Channel::StaticVector3([-0.0, 0.25, 1.0])),
                    sway,
                    single(Channel::StaticQuaternion([0.0, 0.0, 0.6, 0.8])),
                    drift,
                    single(Channel::StaticVector3([1.0, 1.0, 1.0])),
                    cached,
                ],
                sequences: None,
            },
        }
    }

    fn walking_file(frames: usize, limit: usize, start: f32, end: f32) -> Vec<u8> {
        crate::ycd_write::new_dictionary(&[walking("walk_a", frames, limit, start, end)]).expect("словарь клипов")
    }

    /// Моменты со всех сторон: до начала, на границах кадров, внутри, за концом, не числа.
    fn moments(frames: usize) -> Vec<f32> {
        let mut list = vec![
            -5.0,
            -0.0,
            0.0,
            1e-9,
            0.01,
            0.016_666_668,
            0.5,
            1.0,
            1.2,
            1.333_333_4,
            3.0,
            1e6,
            f32::MAX,
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
        ];
        list.extend((0..frames + 2).map(|k| (k as f32 + 0.5) / 30.0));
        list.extend((0..frames + 2).map(|k| k as f32 / 30.0));
        list
    }

    #[test]
    fn a_clip_opened_once_gives_what_the_one_shot_path_gives() {
        let cases = [
            ("несколько блоков", walking_file(40, 16, 0.0, 39.0 / 30.0)),
            ("один блок", walking_file(10, 63, 0.0, 9.0 / 30.0)),
            ("отрезок длинной анимации", walking_file(31, 8, 0.2, 0.6)),
            ("начало равно концу", walking_file(12, 5, 0.3, 0.3)),
            ("один кадр", walking_file(1, 1, 0.0, 0.0)),
        ];
        for (title, file) in cases {
            let sampler = ClipSampler::open(&file, "walk_a").unwrap();
            for moment in moments(45) {
                let want = one_shot(&file, "walk_a", moment);
                assert!(same_bits(&sampler.sample(moment), &want), "{title}, момент {moment}");
                assert!(same_bits(&sample_clip(&file, "walk_a", moment), &want), "{title}, sample_clip, момент {moment}");
            }
        }
    }

    #[test]
    fn the_sampler_reads_the_same_poses_back_that_the_clip_was_written_with() {
        let file = walking_file(40, 16, 0.0, 39.0 / 30.0);
        let sampler = ClipSampler::open(&file, "WALK_A").unwrap();
        assert_eq!((sampler.clip(), sampler.frames()), ("walk_a", 40));
        assert_eq!(sampler.duration(), 39.0 / 30.0);
        // Кадр 17 лежит во втором блоке (по 16 кадров); мувер и дорожка, которую выборка не читает, на своих местах.
        let (time, frame) = sampler.locate(17.5 / 30.0);
        assert_eq!(frame, 17);
        assert_eq!(time, 17.5 / 30.0);
        let bones = sampler.bones_at(frame).unwrap();
        let tags: Vec<(u16, &str)> = bones.iter().map(|b| (b.tag, b.track)).collect();
        assert_eq!(
            tags,
            [
                (0, "rotation"),
                (0, "translation"),
                (7, "rotation"),
                (7, "rotation"),
                (12, "translation"),
                (20, "rotation")
            ]
        );
        let angle = 0.07f32 * 17.0;
        assert!((bones[0].value[2] - (angle / 2.0).sin()).abs() < 1e-6);
        assert!((bones[0].value[3] - (angle / 2.0).cos()).abs() < 1e-6);
        assert_eq!(bones[1].value, [-0.0, 0.25, 1.0]);
        assert!(bones[1].value[0].is_sign_negative());
        assert_eq!(bones[3].value, [0.0, 0.0, 0.6, 0.8]);
    }

    #[test]
    fn two_moments_in_one_frame_share_the_frame_and_its_bones() {
        let file = walking_file(40, 16, 0.0, 39.0 / 30.0);
        let sampler = ClipSampler::open(&file, "walk_a").unwrap();
        let (a, b) = (sampler.locate(10.1 / 30.0), sampler.locate(10.9 / 30.0));
        assert_ne!(a.0, b.0);
        assert_eq!((a.1, b.1), (10, 10));
        assert_eq!(sampler.bones_at(a.1).unwrap(), sampler.bones_at(b.1).unwrap());
        assert_ne!(sampler.bones_at(10).unwrap(), sampler.bones_at(11).unwrap());
    }

    #[test]
    fn a_frame_without_its_block_fails_alone_and_with_the_old_reason() {
        // Кадров 40 по 16 в блоке, а блок один: кадры с шестнадцатого блока не имеют.
        let mut clip = walking("walk_a", 40, 16, 0.0, 39.0 / 30.0);
        let first = NewSequence { frames: 16, groups: walking("walk_a", 16, 16, 0.0, 0.5).animation.groups };
        clip.animation.sequences = Some(vec![first]);
        let file = crate::ycd_write::new_dictionary(&[clip]).expect("словарь клипов");
        let sampler = ClipSampler::open(&file, "walk_a").unwrap();
        assert!(sampler.bones_at(15).is_ok());
        assert_eq!(sampler.bones_at(16).unwrap_err().message, MSG_OUTSIDE);
        for moment in moments(45) {
            assert!(same_bits(&sampler.sample(moment), &one_shot(&file, "walk_a", moment)), "момент {moment}");
        }
    }

    #[test]
    fn opening_reports_the_same_refusals_as_the_one_shot_path() {
        let file = walking_file(10, 63, 0.0, 9.0 / 30.0);
        assert_eq!(ClipSampler::open(&file, "nope").err().unwrap().message, "клипа «nope» нет");
        assert_eq!(
            ClipSampler::open(&[], "walk_a").err().unwrap().message,
            "Ресурс короче заголовка RSC7."
        );
    }
}
