//! Бегущие развёртки арен: клипы словаря с дорожками 17 и 18 на кости 0, разложенные
//! на равномерную сетку отсчётов цикла.

use std::collections::{BTreeMap, HashMap};
use std::iter::successors;
use std::rc::Rc;

use crate::error::{Error, Result};
use crate::resource::Resource;

const MSG_CHAIN: &str = "Цепочка карты клипов слишком длинная.";

#[derive(Debug, Clone, PartialEq)]
pub struct UvClip {
    pub loop_seconds: f64,
    pub frames: Vec<[f64; 6]>,
}

/// Предельные значения разбора.
struct Limits {
    visits: usize,
    buckets: usize,
    blocks: usize,
    bones: usize,
    field_bits: i64,
    palette: f64,
}

const LIMITS: Limits = Limits {
    visits: 4096,
    buckets: 65521,
    blocks: 4096,
    bones: 255,
    field_bits: 53,
    palette: 16_777_216.0,
};

/// Дорожки строк `u` и `v` на кости 0.
const TRACKS: [u8; 2] = [17, 18];
/// Плотность сетки: отсчётов на секунду, наименьшее и наибольшее число отсчётов.
const GRID: (f64, f64, f64) = (30.0, 2.0, 900.0);
/// Масштабы округления выхода: числа строки и длительность цикла.
const SCALES: (f64, f64) = (1e5, 1e4);
const BLOCK_HEAD: usize = 32;
const KINDS: usize = 9;

// ---------------------------------------------------------------------------------------------
// Приведения чисел в манере JS
// ---------------------------------------------------------------------------------------------

/// Округление «половина вверх»; нечисла и бесконечности остаются как есть.
fn round_up(x: f64) -> f64 {
    match x.floor() {
        f if !f.is_finite() => x,
        f if x - f >= 0.5 => f + 1.0,
        f => f,
    }
}

fn wrap_u32(x: f64) -> u32 {
    if x.is_finite() {
        ((x.trunc() % 4_294_967_296.0) as i64) as u32
    } else {
        0
    }
}

fn wrap_i32(x: f64) -> i32 {
    wrap_u32(x) as i32
}

fn scaled(x: f64, scale: f64) -> f64 {
    round_up(x * scale) / scale
}

/// Значение, пропущенное через f32 и возвращённое в f64.
fn narrow(x: f64) -> f64 {
    f64::from(x as f32)
}

// ---------------------------------------------------------------------------------------------
// Чтение полей и битов
// ---------------------------------------------------------------------------------------------

/// Поля записи по таблице (смещение, ширина в байтах): значения как целые без знака.
fn load<const N: usize>(res: &Resource, base: usize, spec: [(usize, usize); N]) -> Option<[u64; N]> {
    let mut out = [0u64; N];
    for (cell, (off, width)) in out.iter_mut().zip(spec) {
        let raw = res.bytes(base + off, width).ok()?;
        *cell = raw.iter().rev().fold(0u64, |acc, &b| (acc << 8) | u64::from(b));
    }
    Some(out)
}

fn real(bits: u64) -> f64 {
    f64::from(f32::from_bits(bits as u32))
}

/// `width` бит младшим вперёд с позиции `pos`; отрицательная позиция, нулевая или
/// отрицательная ширина дают ноль, всё за концом данных читается нулями.
fn grab(bytes: &[u8], pos: i64, width: i64) -> u64 {
    if pos < 0 || width <= 0 {
        return 0;
    }
    let (pos, width) = (pos as usize, width.min(64) as usize);
    let (mut value, mut got) = (0u64, 0usize);
    while got < width {
        let at = pos + got;
        let Some(&byte) = bytes.get(at / 8) else { break };
        let shift = at % 8;
        let room = (8 - shift).min(width - got);
        value |= (u64::from(byte >> shift) & ((1 << room) - 1)) << got;
        got += room;
    }
    value
}

fn short_at(blob: &[u8], at: usize) -> Option<u16> {
    let s = blob.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes([s[0], s[1]]))
}

// ---------------------------------------------------------------------------------------------
// Записи блока
// ---------------------------------------------------------------------------------------------

/// Как достаются значения канала из кадров блока; `bits` может быть и отрицательным.
enum Decode {
    Raw,
    Scaled { bits: i64, quantum: f64, offset: f64 },
    Indexed { bits: i64, table: Vec<f64>, offset: f64 },
}

impl Decode {
    fn bits(&self) -> i64 {
        match self {
            Decode::Raw => 32,
            Decode::Scaled { bits, .. } | Decode::Indexed { bits, .. } => *bits,
        }
    }
}

enum Entry {
    Triple([f64; 3]),
    Fixed(f64),
    Stepped(Vec<f64>),
    Packed { lane: i64, how: Decode },
}

struct Block {
    bytes: Vec<u8>,
    frames_at: usize,
    frame_len: usize,
    frames: usize,
    /// Каналы групп: пары (слот, канал) по возрастанию слота, при равных — в порядке чтения.
    groups: HashMap<usize, Vec<(usize, Entry)>>,
}

impl Block {
    fn unpack(&self, lane: i64, how: &Decode, frame: usize) -> f64 {
        let pos = ((self.frames_at + self.frame_len * frame) * 8) as i64 + lane;
        let raw = grab(&self.bytes, pos, how.bits());
        match how {
            Decode::Raw => real(raw),
            Decode::Scaled { quantum, offset, .. } => narrow(raw as f64 * quantum + offset),
            Decode::Indexed { table, offset, .. } => {
                table.get(wrap_u32(raw as f64) as usize).copied().unwrap_or(*offset)
            }
        }
    }

    fn scalar(&self, entry: &Entry, local: usize) -> f64 {
        match entry {
            Entry::Fixed(c) => *c,
            Entry::Stepped(s) => s[local % s.len()],
            Entry::Packed { lane, how } => self.unpack(*lane, how, local % self.frames),
            Entry::Triple(_) => 0.0,
        }
    }

    /// Четыре числа группы: векторный канал занимает три места, прочие — по одному.
    fn numbers(&self, group: usize, local: usize) -> [f64; 4] {
        let lanes = self.groups.get(&group);
        let parts = lanes.into_iter().flatten().scan(0usize, |filled, (_, entry)| {
            if *filled >= 4 {
                return None;
            }
            let part = match entry {
                Entry::Triple(v) => v.to_vec(),
                other => vec![self.scalar(other, local)],
            };
            *filled += part.len();
            Some(part)
        });
        let mut out = [0.0; 4];
        out.iter_mut().zip(parts.flatten()).for_each(|(dst, src)| *dst = src);
        out
    }
}

/// Состояние чтения параметров каналов блока; курсор параметров может уходить назад.
struct Ctx<'a> {
    bytes: &'a [u8],
    at: i64,
    lane: i64,
    frames: usize,
    chunk: usize,
}

impl Ctx<'_> {
    fn word(&mut self) -> Option<[u8; 4]> {
        let from = usize::try_from(self.at).ok()?;
        let got = self.bytes.get(from..from.checked_add(4)?)?;
        self.at += 4;
        Some([got[0], got[1], got[2], got[3]])
    }

    fn int(&mut self) -> Option<i64> {
        self.word().map(|w| i64::from(i32::from_le_bytes(w)))
    }

    fn float(&mut self) -> Option<f64> {
        self.word().map(|w| f64::from(f32::from_le_bytes(w)))
    }

    fn packed(&mut self, how: Decode) -> Entry {
        let lane = self.lane;
        self.lane += how.bits();
        Entry::Packed { lane, how }
    }
}

fn read_vector(cx: &mut Ctx) -> Option<Entry> {
    Some(Entry::Triple([cx.float()?, cx.float()?, cx.float()?]))
}

fn read_float(cx: &mut Ctx) -> Option<Entry> {
    cx.float().map(Entry::Fixed)
}

fn read_raw(cx: &mut Ctx) -> Option<Entry> {
    Some(cx.packed(Decode::Raw))
}

fn read_scaled(cx: &mut Ctx) -> Option<Entry> {
    let bits = cx.int()?;
    let (quantum, offset) = (cx.float()?, cx.float()?);
    (bits <= LIMITS.field_bits).then(|| cx.packed(Decode::Scaled { bits, quantum, offset }))
}

fn read_palette(cx: &mut Ctx) -> Option<Entry> {
    let (index_bits, value_bits, words) = (cx.int()?, cx.int()?, cx.int()?);
    let (quantum, offset) = (cx.float()?, cx.float()?);
    if index_bits.max(value_bits) > LIMITS.field_bits {
        return None;
    }
    let by_size = match (value_bits, words.signum()) {
        (0, 1) => f64::INFINITY,
        (0, -1) => f64::NEG_INFINITY,
        (0, _) => f64::NAN,
        (v, _) => (words as f64 * 32.0 / v as f64).floor(),
    };
    let by_index = 2f64.powi(index_bits as i32) - 1.0;
    let count = match by_size {
        s if s.is_nan() => 0,
        s if s.min(by_index) <= -1.0 || s.min(by_index) > LIMITS.palette => return None,
        s => s.min(by_index).max(0.0) as i64,
    };
    let (bytes, origin) = (cx.bytes, cx.at * 8);
    let table = (0..count).fold(Vec::with_capacity(count as usize), |mut table, i| {
        let raw = grab(bytes, origin + i * value_bits, value_bits);
        table.push(narrow(raw as f64 * quantum + offset));
        table
    });
    cx.at += words * 4;
    Some(cx.packed(Decode::Indexed { bits: index_bits, table, offset }))
}

/// Бегущее значение линейного канала: уровень и скорость меняются ступенями.
struct Ramp<'a> {
    bytes: &'a [u8],
    cursor: i64,
    level: f64,
    speed: f64,
    bits: i64,
}

impl Ramp<'_> {
    fn advance(&mut self) {
        let low = grab(self.bytes, self.cursor, self.bits);
        self.cursor += self.bits;
        let stop = (self.bytes.len() as i64 * 8).max(self.cursor + 1);
        let consumed = (self.cursor..stop)
            .position(|p| grab(self.bytes, p, 1) == 1)
            .map_or(stop - self.cursor, |i| i as i64 + 1);
        self.cursor += consumed;
        let run = (consumed as i32 - 1).wrapping_shl((self.bits % 32) as u32);
        let change = wrap_i32(low as f64) | run;
        let mut delta = f64::from(change);
        if change != 0 {
            let minus = grab(self.bytes, self.cursor, 1) == 1;
            self.cursor += 1;
            if minus {
                delta = -delta;
            }
        }
        self.speed += delta;
        self.level += self.speed;
    }
}

fn read_linear(cx: &mut Ctx) -> Option<Entry> {
    let words = cx.int()?;
    let counters = cx.int()?;
    let (quantum, offset) = (cx.float()?, cx.float()?);
    let [w_off, w_start, w_change] = [0, 8, 16].map(|s| (counters >> s) & 0xFF);
    if [w_off, w_start, w_change].iter().any(|&w| w > LIMITS.field_bits) {
        return None;
    }
    let (bytes, frames, chunk) = (cx.bytes, cx.frames, cx.chunk);
    let chunks = (chunk + frames - 1) / chunk;
    let begin = cx.at * 8;
    let data_start = begin + chunks as i64 * (w_off + w_start);

    let mut cursor = begin;
    let mut pull = |width: i64| -> Vec<u64> {
        (0..chunks)
            .map(|_| {
                let v = grab(bytes, cursor, width);
                cursor += width;
                v
            })
            .collect()
    };
    let offsets = pull(w_off);
    let starts = pull(w_start);

    let series: Vec<f64> = offsets
        .iter()
        .zip(&starts)
        .enumerate()
        .flat_map(|(k, (&shift, &first))| {
            let mut ramp = Ramp {
                bytes,
                cursor: shift as i64 + data_start,
                level: first as f64,
                speed: 0.0,
                bits: w_change,
            };
            let room = (frames - k * chunk).min(chunk);
            (0..room).map(move |s| {
                let value = narrow(ramp.level * quantum + offset);
                if s + 1 < chunk {
                    ramp.advance();
                }
                value
            })
        })
        .collect();
    cx.at += words * 4 - 16;
    Some(Entry::Stepped(series))
}

type Reader = fn(&mut Ctx) -> Option<Entry>;

/// Читатели каналов по типу 0..8; кватернионы (0, 7, 8) в развёртках не читаются.
const READERS: [Option<Reader>; KINDS] = [
    None,
    Some(read_vector),
    Some(read_float),
    Some(read_raw),
    Some(read_scaled),
    Some(read_palette),
    Some(read_linear),
    None,
    None,
];

fn read_block(res: &Resource, at: usize) -> Option<Block> {
    let [data_len, frames_at, frames, frame_len, chunk] =
        load(res, at, [(4, 4), (12, 4), (0x16, 2), (0x18, 2), (0x1E, 1)])?.map(|v| v as usize);
    let body = at + BLOCK_HEAD;
    if body.checked_add(data_len)? > res.data().len() || frames == 0 || chunk == 0 {
        return None;
    }
    let blob = &res.data()[body..body + data_len];
    let counters_at = frames_at + frame_len * frames;
    let counts = (0..KINDS)
        .map(|i| short_at(blob, counters_at + i * 2).map(usize::from))
        .collect::<Option<Vec<_>>>()?;

    let mut cx = Ctx { bytes: blob, at: 0, lane: 0, frames, chunk };
    let mut groups: HashMap<usize, Vec<(usize, Entry)>> = HashMap::new();
    let mut tag_at = counters_at + KINDS * 2;
    for (kind, count) in counts.into_iter().enumerate() {
        let tags: Vec<u16> = blob
            .get(tag_at..)
            .unwrap_or_default()
            .chunks_exact(2)
            .take(count)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        if tags.len() < count {
            return None;
        }
        for tag in tags {
            let entry = READERS[kind]?(&mut cx)?;
            groups.entry(usize::from(tag >> 2)).or_default().push((usize::from(tag & 3), entry));
        }
        tag_at += count.next_multiple_of(4) * 2;
    }
    groups.values_mut().for_each(|lanes| lanes.sort_by_key(|(slot, _)| *slot));
    Some(Block { bytes: blob.to_vec(), frames_at, frame_len, frames, groups })
}

// ---------------------------------------------------------------------------------------------
// Анимация и клип
// ---------------------------------------------------------------------------------------------

struct Animation {
    frames: usize,
    limit: usize,
    duration: f64,
    bones: Vec<(u16, u8)>,
    blocks: Vec<Block>,
}

impl Animation {
    fn read(res: &Resource, at: usize) -> Option<Self> {
        let [frames, limit, duration, block_count, bone_count] =
            load(res, at, [(0x14, 2), (0x16, 2), (0x18, 4), (0x48, 2), (0x58, 2)])?;
        let (block_list, bone_list) = (res.pointer_at(at + 0x40)?, res.pointer_at(at + 0x50)?);
        let sane = frames > 0
            && limit > 0
            && block_count as usize <= LIMITS.blocks
            && bone_count as usize <= LIMITS.bones;
        if !sane {
            return None;
        }
        let bones = (0..bone_count as usize)
            .map(|i| load(res, bone_list + i * 4, [(0, 2), (3, 1)]).map(|[id, track]| (id as u16, track as u8)))
            .collect::<Option<Vec<_>>>()?;
        let blocks = (0..block_count as usize)
            .map(|i| read_block(res, res.pointer_at(block_list + i * 8)?))
            .collect::<Option<Vec<_>>>()?;
        Some(Animation { frames: frames as usize, limit: limit as usize, duration: real(duration), bones, blocks })
    }

    /// Кадр по абсолютному времени; `None` — время не вычисляется.
    fn frame_for(&self, t: f64) -> Option<usize> {
        if self.duration.is_nan() || self.duration <= 0.0 {
            return Some(0);
        }
        let last = (self.frames - 1) as f64;
        let x = t / self.duration * last;
        (!x.is_nan()).then(|| round_up(x).clamp(0.0, last) as usize)
    }
}

type Shelf = BTreeMap<usize, Option<Rc<Animation>>>;

fn read_clip(res: &Resource, clip: usize, shelf: &mut Shelf) -> Option<UvClip> {
    let [kind, start, end, rate] = load(res, clip, [(0x10, 4), (0x58, 4), (0x5C, 4), (0x60, 4)])?;
    let [start, end, rate] = [start, end, rate].map(real);
    let anim_at = res.pointer_at(clip + 0x50).filter(|_| kind == 1)?;
    let cycle = (end - start) / rate;
    if rate.is_nan() || rate <= 0.0 || cycle.is_nan() || cycle <= 0.0 {
        return None;
    }
    let anim = match shelf.get(&anim_at) {
        Some(hit) => hit.clone(),
        None => {
            let made = Animation::read(res, anim_at).map(Rc::new);
            shelf.insert(anim_at, made.clone());
            made
        }
    }?;
    let [Some(u_group), Some(v_group)] = TRACKS.map(|track| anim.bones.iter().position(|b| *b == (0, track))) else {
        return None;
    };

    let count = round_up(cycle * GRID.0).clamp(GRID.1, GRID.2) as usize;
    let frames = (0..count)
        .map(|i| {
            let t = start + i as f64 * cycle / count as f64 * rate;
            let frame = anim.frame_for(t)?;
            let block = anim.blocks.get(frame / anim.limit)?;
            let local = frame % anim.limit;
            let (u, v) = (block.numbers(u_group, local), block.numbers(v_group, local));
            Some([u[0], u[1], u[2], v[0], v[1], v[2]].map(|x| scaled(x, SCALES.0)))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(UvClip { loop_seconds: scaled(cycle, SCALES.1), frames })
}

// ---------------------------------------------------------------------------------------------
// Словарь
// ---------------------------------------------------------------------------------------------

pub fn uv_clips(resource: &Resource) -> Result<BTreeMap<u32, UvClip>> {
    let capacity = usize::from(resource.u16(0x30)?);
    let mut found = BTreeMap::new();
    let Some(array) = resource
        .pointer_at(0x28)
        .filter(|_| (1..=LIMITS.buckets).contains(&capacity))
    else {
        return Ok(found);
    };
    let mut shelf = Shelf::new();
    for bucket in 0..capacity {
        let head = resource.pointer_at(array + bucket * 8);
        let mut walk = successors(head, |&e| resource.pointer_at(e + 0x10));
        for entry in walk.by_ref().take(LIMITS.visits) {
            let hash = resource.u32(entry)?;
            let clip = resource
                .pointer_at(entry + 8)
                .and_then(|at| read_clip(resource, at, &mut shelf));
            if let Some(clip) = clip {
                found.insert(hash, clip);
            }
        }
        // Цепочка длиннее предела (или замкнутая) раньше молча обрывалась, теряя хвост.
        if walk.next().is_some() {
            return Err(Error::broken(MSG_CHAIN));
        }
    }
    Ok(found)
}

pub fn read_uv_clips(bytes: &[u8]) -> Result<BTreeMap<u32, UvClip>> {
    uv_clips(&Resource::parse(bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::Header;

    const V: u64 = 0x5000_0000;

    fn put(data: &mut [u8], at: usize, bytes: &[u8]) {
        data[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn put_ptr(data: &mut [u8], at: usize, target: usize) {
        put(data, at, &(V + target as u64).to_le_bytes());
    }

    /// Словарь на 0x600 байт: один клип в корзине 1, две кости, один блок.
    fn dictionary(end: f32, rate: f32, tracks: [u8; 2]) -> Vec<u8> {
        let mut d = vec![0u8; 0x600];
        put_ptr(&mut d, 0x28, 0x100);
        put(&mut d, 0x30, &3u16.to_le_bytes());
        put_ptr(&mut d, 0x108, 0x140);
        put(&mut d, 0x140, &0xabcd_1234u32.to_le_bytes());
        put_ptr(&mut d, 0x148, 0x180);

        put(&mut d, 0x190, &1u32.to_le_bytes());
        put_ptr(&mut d, 0x1d0, 0x200);
        put(&mut d, 0x1d8, &0.0f32.to_le_bytes());
        put(&mut d, 0x1dc, &end.to_le_bytes());
        put(&mut d, 0x1e0, &rate.to_le_bytes());

        put(&mut d, 0x214, &4u16.to_le_bytes());
        put(&mut d, 0x216, &4u16.to_le_bytes());
        put(&mut d, 0x218, &1.0f32.to_le_bytes());
        put_ptr(&mut d, 0x240, 0x300);
        put(&mut d, 0x248, &1u16.to_le_bytes());
        put_ptr(&mut d, 0x250, 0x320);
        put(&mut d, 0x258, &2u16.to_le_bytes());
        put_ptr(&mut d, 0x300, 0x400);
        d[0x323] = tracks[0];
        d[0x327] = tracks[1];

        put(&mut d, 0x404, &78u32.to_le_bytes());
        put(&mut d, 0x40c, &32u32.to_le_bytes());
        put(&mut d, 0x416, &4u16.to_le_bytes());
        put(&mut d, 0x418, &1u16.to_le_bytes());
        d[0x41e] = 255;
        let mut body: Vec<u8> = [1.0f32, 0.0, 0.0, 1.0, 0.0]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        body.extend(4u32.to_le_bytes());
        body.extend(0.25f32.to_le_bytes());
        body.extend(0.0f32.to_le_bytes());
        body.extend([0u8, 1, 2, 3]);
        body.extend([0u16, 0, 5, 0, 1, 0, 0, 0, 0].iter().flat_map(|c| c.to_le_bytes()));
        body.extend([0u16, 1, 4, 5, 6, 0, 0, 0, 2, 0, 0, 0].iter().flat_map(|t| t.to_le_bytes()));
        put(&mut d, 0x420, &body);
        d
    }

    fn resource(data: Vec<u8>) -> Resource {
        let header = Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size: data.len(),
            graphics_size: 0,
            version: 0,
            declared_version: 0,
        };
        Resource::from_parts(header, data)
    }

    #[test]
    fn clip_with_two_tracks_steps_thirty_times_a_second() {
        let found = uv_clips(&resource(dictionary(1.0, 1.0, TRACKS))).unwrap();
        assert_eq!(found.keys().copied().collect::<Vec<_>>(), [0xabcd_1234]);
        let clip = &found[&0xabcd_1234];
        assert_eq!(clip.loop_seconds, 1.0);
        assert_eq!(clip.frames.len(), 30);
        assert_eq!(clip.frames[0], [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        assert_eq!(clip.frames[29], [1.0, 0.0, 0.75, 0.0, 1.0, 0.0]);
        let mut steps: Vec<f64> = clip.frames.iter().map(|r| r[2]).collect();
        steps.sort_by(f64::total_cmp);
        steps.dedup();
        assert_eq!(steps, [0.0, 0.25, 0.5, 0.75]);
    }

    #[test]
    fn clip_rate_stretches_the_loop() {
        let found = uv_clips(&resource(dictionary(2.0, 0.5, TRACKS))).unwrap();
        let clip = &found[&0xabcd_1234];
        assert_eq!((clip.loop_seconds, clip.frames.len()), (4.0, 120));
    }

    #[test]
    fn clip_without_tracks_17_and_18_is_skipped_and_broken_dictionaries_are_empty() {
        assert!(uv_clips(&resource(dictionary(1.0, 1.0, [1, 2]))).unwrap().is_empty());
        assert!(uv_clips(&resource(vec![0u8; 0x40])).unwrap().is_empty());
        let mut torn = dictionary(1.0, 1.0, TRACKS);
        put(&mut torn, 0x404, &0xfffffu32.to_le_bytes());
        assert!(uv_clips(&resource(torn)).unwrap().is_empty());
    }

    #[test]
    fn a_chain_longer_than_the_limit_is_refused_not_cut() {
        // Цепочка из `total` записей: первая — запись словаря, остальные лежат за его телом.
        let chain = |total: usize| {
            let mut d = dictionary(1.0, 1.0, TRACKS);
            let first = d.len();
            d.resize(first + (total - 1) * 0x20, 0);
            for i in 0..total - 1 {
                let at = first + i * 0x20;
                if i + 2 < total {
                    put_ptr(&mut d, at + 0x10, at + 0x20);
                }
            }
            put_ptr(&mut d, 0x150, first);
            d
        };
        // Ровно предел: цепочка в 4096 записей читается.
        assert!(uv_clips(&resource(chain(4096))).unwrap().contains_key(&0xabcd_1234));
        // Одна лишняя: раньше хвост пропадал молча, теперь отказ.
        let refusal = uv_clips(&resource(chain(4097))).unwrap_err();
        assert_eq!(refusal.message, "Цепочка карты клипов слишком длинная.");
        // Замкнутая цепочка тоже отказ, а не обрыв на пределе.
        let mut looped = dictionary(1.0, 1.0, TRACKS);
        put_ptr(&mut looped, 0x150, 0x140);
        assert_eq!(uv_clips(&resource(looped)).unwrap_err().message, "Цепочка карты клипов слишком длинная.");
    }

    #[test]
    fn js_rounding_rounds_halves_up() {
        assert_eq!(round_up(2.5), 3.0);
        assert_eq!(round_up(-2.5), -2.0);
        assert_eq!(round_up(0.49999999999999994), 0.0);
        assert_eq!(wrap_i32(4294967297.0), 1);
        assert_eq!(wrap_u32(-1.0), 4294967295);
        assert!(round_up(f64::NAN).is_nan());
        assert_eq!(round_up(f64::NEG_INFINITY), f64::NEG_INFINITY);
        assert_eq!(wrap_u32(f64::INFINITY), 0);
    }

    #[test]
    fn short_data_is_refused_only_below_the_bucket_header() {
        for len in [0usize, 0x20, 0x31] {
            let err = uv_clips(&resource(vec![0u8; len])).unwrap_err();
            assert_eq!(err.message, "Чтение за концом данных ресурса.");
        }
        for len in [0x32usize, 0x33, 0x40] {
            assert!(uv_clips(&resource(vec![0u8; len])).unwrap().is_empty());
        }
    }

    #[test]
    fn cycle_decides_sample_count_and_skips_unusable_clips() {
        let count = |end: f32, rate: f32| {
            uv_clips(&resource(dictionary(end, rate, TRACKS)))
                .unwrap()
                .get(&0xabcd_1234)
                .map(|c| c.frames.len())
        };
        assert_eq!(count(0.01, 1.0), Some(2));
        assert_eq!(count(0.0834, 1.0), Some(3));
        assert_eq!(count(100.0, 1.0), Some(900));
        assert_eq!(count(0.0, 1.0), None);
        assert_eq!(count(1.0, 0.0), None);
        assert_eq!(count(1.0, -1.0), None);
        assert_eq!(count(f32::INFINITY, 1.0), None);
        assert_eq!(count(1.0, f32::NAN), None);
    }

    #[test]
    fn output_numbers_are_rounded_to_five_places() {
        assert_eq!(scaled(0.000015f32 as f64, SCALES.0), 1e-5);
        assert_eq!(scaled(-0.000001, SCALES.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(scaled(-0.0, SCALES.0).to_bits(), (-0.0f64).to_bits());
        assert!(scaled(f64::NAN, SCALES.0).is_nan());
        assert_eq!(scaled(f64::INFINITY, SCALES.0), f64::INFINITY);
    }
}
