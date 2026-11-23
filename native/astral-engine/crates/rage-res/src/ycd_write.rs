//! Запись словарей клипов (`.ycd`, RSC7 версии 46): новый словарь из описаний клипов
//! и дописывание клипов в готовый словарь без пересборки старых.

use std::collections::{BTreeMap, BTreeSet};
use std::iter::successors;
use std::ops::Range;

use crate::error::{Error, Result};
use crate::hash::joaat;
use crate::resource::{Resource, HEADER_BYTES, RSC7_MAGIC, SYSTEM_BASE};
use crate::ytd_edit::{align16, single_page_flags};

pub const YCD_VERSION: u32 = 46;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoneTrack {
    pub bone: u16,
    pub track: u8,
    pub unk: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Channel {
    StaticFloat(f32),
    StaticVector3([f32; 3]),
    StaticQuaternion([f32; 4]),
    Raw(Vec<f32>),
    Quantize {
        quantum: f32,
        offset: f32,
        values: Vec<f32>,
    },
    Indirect {
        quantum: f32,
        offset: f32,
        values: Vec<f32>,
    },
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Group {
    pub slots: [Option<Channel>; 4],
    pub cached: Option<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewSequence {
    pub frames: usize,
    pub groups: Vec<Group>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewAnimation {
    pub hash: u32,
    pub signature: u32,
    pub duration: f32,
    pub frames: usize,
    pub limit: usize,
    pub bones: Vec<BoneTrack>,
    pub groups: Vec<Group>,
    pub sequences: Option<Vec<NewSequence>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewClip {
    pub hash: u32,
    pub name: String,
    pub start: f32,
    pub end: f32,
    pub rate: f32,
    pub animation: NewAnimation,
    pub properties: Vec<ClipProperty>,
}

/// Свойство клипа: имя, второй хеш и целочисленные атрибуты (имя, значение). Других видов атрибутов писатель не знает.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipProperty {
    pub name: u32,
    pub unk: u32,
    pub ints: Vec<(u32, i32)>,
}

impl ClipProperty {
    /// Свойство, которое хост кладёт в каждый клип моделей звезды и летающих (`NameHash hash_BF6A5D60`, `UnkHash hash_996C3B27`, `Int 32`).
    pub fn host_model() -> Self {
        ClipProperty { name: 0xBF6A_5D60, unk: 0x996C_3B27, ints: vec![(0xBF6A_5D60, 32)] }
    }
}

// ---------------------------------------------------------------------------------------------
// Тексты отказов
// ---------------------------------------------------------------------------------------------

const MSG_NO_CLIPS: &str = "Словарь клипов нужен хотя бы с одним клипом.";
const MSG_NAME: &str = "Имя клипа: ASCII, от 1 до 255 символов.";
const MSG_FRAMES: &str = "Клип: кадров от 1 до 65535.";
const MSG_LIMIT: &str = "Клип: кадров в блоке от 1 до 65535.";
const MSG_DURATION: &str = "Клип: длительность — конечное число не меньше нуля.";
const MSG_TIMES: &str = "Клип: начало, конец и скорость — конечные числа.";
const MSG_TIMES_ORDER: &str = "Клип: конец раньше начала.";
const MSG_BONES: &str = "Клип: дорожек костей столько же, сколько групп каналов, и не больше 16383.";
const MSG_ROOT_TRACK: &str = "Клип: дорожки корня (5, 6) пока не пишутся.";
const MSG_NO_BLOCK: &str = "Клип: нужен хотя бы один блок последовательности.";
const MSG_BLOCK: &str = "Клип: блок — по группе на кость и не больше лимита + 1 кадр.";
const MSG_STATIC: &str = "Канал: значение не конечное.";
const MSG_ROWS: &str = "Канал по кадрам: значений столько же, сколько кадров, и все конечные.";
const MSG_CACHED: &str = "Клип: индекс кэшированного кватерниона от 0 до 3.";
const MSG_STEP: &str = "Квантование: шаг больше нуля, смещение конечное.";
const MSG_BELOW: &str = "Квантование: смещение больше самого маленького значения.";
const MSG_TOO_FINE: &str = "Квантование: шаг слишком мелкий для значений канала.";
const MSG_KIND_COUNT: &str = "Клип: каналов одного типа больше 65535.";
const MSG_BLOCK_FIELDS: &str = "Клип: длина кадра или число кадров блока не влезает в поле заголовка.";
const MSG_SUMS: &str = "Клип: сумма битов каналов не влезает в поле заголовка.";
const MSG_MAP_FULL: &str = "Карта клипов: записей больше 65535.";
const MSG_PROPERTY: &str = "Свойство клипа: атрибутов больше 65535.";
const MSG_ONE_PAGE: &str = "Словарь клипов больше одной страницы системной области.";
const MSG_GRAPHICS: &str = "Словарь клипов не бывает с графической частью.";
const MSG_NOT_YCD: &str = "Это не словарь клипов (версия ресурса не 46).";
const MSG_CUT: &str = "Словарь клипов обрезан: дописывать нельзя.";
const MSG_NO_ROOT: &str = "Словарь клипов без корня.";
const MSG_NO_ANIM_MAP: &str = "Словарь клипов без карты анимаций.";
const MSG_FOREIGN_POINTER: &str = "Указатель вне системной области.";
const MSG_EOF: &str = "Чтение за концом данных.";
const MSG_NO_BUCKETS: &str = "Словарь клипов: записи есть, а корзин нет, дописывать нельзя.";
const MSG_ENTRY_EOF: &str = "Запись карты клипов за концом данных.";
const MSG_LONG_CHAIN: &str = "Цепочка карты клипов слишком длинная.";

// ---------------------------------------------------------------------------------------------
// Размеры и смещения полей
// ---------------------------------------------------------------------------------------------

const ROOT_SIZE: usize = 64;
const ANIM_MAP_SIZE: usize = 48;
const ENTRY_SIZE: usize = 32;
const CLIP_SIZE: usize = 112;
const ANIMATION_SIZE: usize = 96;
const BLOCK_HEAD: usize = 32;
const PAGES_SIZE: usize = 24;
const TAGS_SIZE: usize = 32;
const PROPS_SIZE: usize = 16;
const PROPERTY_SIZE: usize = 64;
const ATTRIBUTE_INT_SIZE: usize = 48;
/// Вид атрибута «целое» в клипе (`ClipPropertyAttributeType.Int`).
const ATTRIBUTE_INT: u8 = 2;

mod root {
    pub const TAG: usize = 0x00;
    pub const REV: usize = 0x04;
    pub const PAGES: usize = 0x08;
    pub const ANIM_MAP: usize = 0x18;
    pub const MARK: usize = 0x20;
    pub const BUCKETS: usize = 0x28;
    pub const CAP: usize = 0x30;
    pub const COUNT: usize = 0x32;
    pub const TAIL: usize = 0x34;
}

mod map {
    pub const TAG: usize = 0x00;
    pub const REV: usize = 0x04;
    pub const BUCKETS: usize = 0x18;
    pub const CAP: usize = 0x20;
    pub const COUNT: usize = 0x22;
    pub const TAIL: usize = 0x24;
    pub const ONE: usize = 0x28;
}

mod entry {
    pub const HASH: usize = 0x00;
    pub const VALUE: usize = 0x08;
    pub const NEXT: usize = 0x10;
}

/// Свойство клипа (64 байта).
mod prop {
    pub const ONE: usize = 0x04;
    pub const NAME: usize = 0x18;
    pub const LIST: usize = 0x20;
    pub const COUNT: usize = 0x28;
    pub const CAPACITY: usize = 0x2A;
    pub const UNK: usize = 0x38;
}

/// Целочисленный атрибут свойства (48 байт).
mod attribute {
    pub const ONE: usize = 0x04;
    pub const KIND: usize = 0x08;
    pub const NAME: usize = 0x18;
    pub const VALUE: usize = 0x20;
}

mod clip {
    pub const TAG: usize = 0x00;
    pub const REV: usize = 0x04;
    pub const KIND: usize = 0x10;
    pub const NAME: usize = 0x18;
    pub const NAME_LEN: usize = 0x20;
    pub const NAME_LEN_NUL: usize = 0x22;
    pub const ROOT: usize = 0x28;
    pub const HOLD: usize = 0x30;
    pub const TAGS: usize = 0x38;
    pub const PROPS: usize = 0x40;
    pub const BODY: usize = 0x48;
    pub const ANIM: usize = 0x50;
    pub const START: usize = 0x58;
    pub const END: usize = 0x5C;
    pub const RATE: usize = 0x60;
}

mod anim {
    pub const TAG: usize = 0x00;
    pub const REV: usize = 0x04;
    pub const FLAG_FIRST: usize = 0x10;
    pub const FLAG: usize = 0x11;
    pub const FRAMES: usize = 0x14;
    pub const LIMIT: usize = 0x16;
    pub const DURATION: usize = 0x18;
    pub const SIGNATURE: usize = 0x1C;
    pub const BIGGEST: usize = 0x38;
    pub const MODE: usize = 0x3C;
    pub const BLOCKS: usize = 0x40;
    pub const BLOCK_COUNT: usize = 0x48;
    pub const BLOCK_COUNT_COPY: usize = 0x4A;
    pub const BONES: usize = 0x50;
    pub const BONE_COUNT: usize = 0x58;
    pub const BONE_COUNT_COPY: usize = 0x5A;
}

mod head {
    pub const HASH: usize = 0x00;
    pub const LEN: usize = 0x04;
    pub const FRAMES_AT: usize = 0x0C;
    pub const TOTAL: usize = 0x10;
    pub const FRAMES: usize = 0x16;
    pub const FRAME_LEN: usize = 0x18;
    pub const WORDS: usize = 0x1A;
    pub const BITS: usize = 0x1C;
    pub const CHUNK: usize = 0x1E;
}

const ROOT_TAG: u32 = 0x4057_0818;
const ANIM_MAP_TAG: u32 = 0x405A_5C08;
const CLIP_TAG: u32 = 0x405A_4088;
const ANIMATION_TAG: u32 = 0x405A_58F0;
const TAIL_MARK: u32 = 0x0100_0000;
const FLAGS_SYSTEM_NEW: u32 = 2;
const FLAGS_GRAPHICS_NEW: u32 = 0xE000_0000;

const MAX_FRAMES: usize = 65535;
const MAX_BONES: usize = 16383;
const MAX_ENTRIES: usize = 65535;
const MAX_FIELD: usize = 65535;
const MAX_VISITS: usize = 65536;
const KIND_COUNT: usize = 9;

/// Ряд простых чисел под число корзин; для большого числа записей берётся `WIDEST`.
const BUCKET_LADDER: [usize; 16] = [
    11, 29, 59, 107, 191, 331, 563, 953, 1609, 2729, 4621, 7841, 13297, 22571, 38351, 65167,
];
const WIDEST: usize = 65521;

/// Типы каналов в блоке последовательности.
const KIND_QUANT: u8 = 4;
const KIND_PALETTE: u8 = 5;
const KIND_CACHED: u8 = 8;

/// Верхняя граница кванта, которую ещё можно записать (`u32::MAX` в f32).
const QUANT_CEILING: f32 = u32::MAX as f32;

pub fn name_hash(name: &str) -> u32 {
    joaat(name)
}

// ---------------------------------------------------------------------------------------------
// Байты: ячейки записей, образ области, битовая запись, хеш данных
// ---------------------------------------------------------------------------------------------

fn ensure(cond: bool, text: &str) -> Result<()> {
    cond.then_some(()).ok_or_else(|| Error::argument(text))
}

fn ensure_broken(cond: bool, text: &str) -> Result<()> {
    cond.then_some(()).ok_or_else(|| Error::broken(text))
}

/// Указатель системной области на смещение.
fn vptr(at: usize) -> u64 {
    SYSTEM_BASE + at as u64
}

/// Значение одного поля записи.
#[derive(Clone, Copy)]
enum Cell {
    B(u8),
    H(u16),
    W(u32),
    F(f32),
    Q(u64),
}

fn ptr(at: usize) -> Cell {
    Cell::Q(vptr(at))
}

impl Cell {
    fn bytes(self) -> Vec<u8> {
        match self {
            Cell::B(v) => vec![v],
            Cell::H(v) => v.to_le_bytes().to_vec(),
            Cell::W(v) => v.to_le_bytes().to_vec(),
            Cell::F(v) => v.to_le_bytes().to_vec(),
            Cell::Q(v) => v.to_le_bytes().to_vec(),
        }
    }
}

/// Запись заданного размера: нули и поля по таблице (смещение, значение).
fn record(size: usize, cells: &[(usize, Cell)]) -> Vec<u8> {
    let mut out = vec![0u8; size];
    for &(pos, cell) in cells {
        let raw = cell.bytes();
        out[pos..pos + raw.len()].copy_from_slice(&raw);
    }
    out
}

/// Системная область, в конец которой по 16 байт выравнивания ложатся блоки.
struct Image(Vec<u8>);

impl Image {
    fn append(&mut self, block: &[u8]) -> usize {
        let start = align16(self.0.len());
        self.0.resize(start, 0);
        self.0.extend_from_slice(block);
        start
    }

    /// Правка полей записи, уже лежащей в образе.
    fn patch(&mut self, base: usize, cells: &[(usize, Cell)]) -> Result<()> {
        for &(pos, cell) in cells {
            let raw = cell.bytes();
            let from = base.saturating_add(pos);
            let slot = from
                .checked_add(raw.len())
                .and_then(|to| self.0.get_mut(from..to))
                .ok_or_else(|| Error::broken(MSG_EOF))?;
            slot.copy_from_slice(&raw);
        }
        Ok(())
    }
}

/// Побитовая запись младшим разрядом вперёд.
#[derive(Default)]
struct BitSink {
    bytes: Vec<u8>,
    acc: u64,
    held: u32,
}

impl BitSink {
    fn push(&mut self, value: u64, width: u32) {
        self.acc |= (value & ((1u64 << width) - 1)) << self.held;
        self.held += width;
        while self.held >= 8 {
            self.bytes.push(self.acc as u8);
            self.acc >>= 8;
            self.held -= 8;
        }
    }

    /// Дописывает хвостовой байт и добивает нулями до `len` байт.
    fn close(mut self, len: usize) -> Vec<u8> {
        if self.held > 0 {
            self.bytes.push(self.acc as u8);
        }
        self.bytes.resize(len, 0);
        self.bytes
    }
}

/// Шаги хеша Дженкинса: «прибавить себя, сдвинутого влево» и «сложить с собой, сдвинутым вправо».
#[derive(Clone, Copy)]
enum Mix {
    Grow(u32),
    Fold(u32),
}

fn mix(state: u32, step: Mix) -> u32 {
    match step {
        Mix::Grow(n) => state.wrapping_add(state << n),
        Mix::Fold(n) => state ^ (state >> n),
    }
}

/// Хеш данных блока: тот же joaat, но без смены регистра и по произвольным байтам.
fn data_hash(bytes: &[u8]) -> u32 {
    const EACH: [Mix; 2] = [Mix::Grow(10), Mix::Fold(6)];
    const LAST: [Mix; 3] = [Mix::Grow(3), Mix::Fold(11), Mix::Grow(15)];
    let body = bytes
        .iter()
        .fold(0u32, |h, &b| EACH.iter().fold(h.wrapping_add(u32::from(b)), |h, &s| mix(h, s)));
    LAST.iter().fold(body, |h, &s| mix(h, s))
}

fn width_of(value: u32) -> u32 {
    u32::BITS - value.leading_zeros()
}

/// Параметры канала: целые, затем дробные, затем готовый хвост.
fn head_bytes(ints: &[i32], floats: &[f32], tail: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = ints.iter().flat_map(|v| v.to_le_bytes()).collect();
    out.extend(floats.iter().flat_map(|v| v.to_le_bytes()));
    out.extend_from_slice(tail);
    out
}

// ---------------------------------------------------------------------------------------------
// Проверка входа
// ---------------------------------------------------------------------------------------------

type Rule = fn(&NewClip) -> bool;

/// Проверки клипа в порядке отказа: условие должно выполняться.
const CLIP_RULES: [(Rule, &str); 8] = [
    (|c| (1..=255).contains(&c.name.len()) && c.name.is_ascii(), MSG_NAME),
    (|c| (1..=MAX_FRAMES).contains(&c.animation.frames), MSG_FRAMES),
    (|c| (1..=MAX_FRAMES).contains(&c.animation.limit), MSG_LIMIT),
    (|c| c.animation.duration.is_finite() && c.animation.duration >= 0.0, MSG_DURATION),
    (
        |c| {
            let a = &c.animation;
            (a.sequences.is_some() || a.groups.len() == a.bones.len()) && a.bones.len() <= MAX_BONES
        },
        MSG_BONES,
    ),
    (|c| c.animation.bones.iter().all(|b| !matches!(b.track, 5 | 6)), MSG_ROOT_TRACK),
    (|c| [c.start, c.end, c.rate].iter().all(|x| x.is_finite()), MSG_TIMES),
    (|c| c.end >= c.start, MSG_TIMES_ORDER),
];

impl Channel {
    /// Текст отказа, если значения канала негодны для блока из `frames` кадров.
    fn flaw(&self, frames: usize) -> Option<&'static str> {
        let (numbers, per_frame): (&[f32], bool) = match self {
            Channel::StaticFloat(v) => (std::slice::from_ref(v), false),
            Channel::StaticVector3(v) => (v, false),
            Channel::StaticQuaternion(q) => (q, false),
            Channel::Raw(v) | Channel::Quantize { values: v, .. } | Channel::Indirect { values: v, .. } => (v, true),
        };
        let sound = numbers.iter().all(|x| x.is_finite());
        match (per_frame, sound) {
            (true, ok) if !ok || numbers.len() != frames => Some(MSG_ROWS),
            (false, false) => Some(MSG_STATIC),
            _ => None,
        }
    }

    fn kind(&self) -> u8 {
        match self {
            Channel::StaticQuaternion(_) => 0,
            Channel::StaticVector3(_) => 1,
            Channel::StaticFloat(_) => 2,
            Channel::Raw(_) => 3,
            Channel::Quantize { .. } => KIND_QUANT,
            Channel::Indirect { .. } => KIND_PALETTE,
        }
    }
}

impl Group {
    fn flaw(&self, frames: usize) -> Option<&'static str> {
        let slots = self.slots.iter().flatten().find_map(|c| c.flaw(frames));
        slots.or_else(|| self.cached.filter(|&i| i > 3).map(|_| MSG_CACHED))
    }
}

/// Проверка групп и блоков клипа после общих правил.
fn layout_flaw(a: &NewAnimation) -> Option<&'static str> {
    let Some(list) = a.sequences.as_deref() else {
        return a.groups.iter().find_map(|g| g.flaw(a.frames));
    };
    if list.is_empty() {
        return Some(MSG_NO_BLOCK);
    }
    list.iter().find_map(|q| {
        let shaped = q.groups.len() == a.bones.len() && (1..=a.limit + 1).contains(&q.frames);
        if shaped {
            q.groups.iter().find_map(|g| g.flaw(q.frames))
        } else {
            Some(MSG_BLOCK)
        }
    })
}

fn vet(c: &NewClip) -> Result<()> {
    let verdict = CLIP_RULES
        .iter()
        .find(|(holds, _)| !holds(c))
        .map(|&(_, text)| text)
        .or_else(|| layout_flaw(&c.animation));
    verdict.map_or(Ok(()), |text| Err(Error::argument(text)))
}

// ---------------------------------------------------------------------------------------------
// Каналы блока
// ---------------------------------------------------------------------------------------------

/// Канал, готовый лечь в блок: параметры, ширина в кадре и значения по кадрам.
struct Coded {
    head: Vec<u8>,
    bits: u32,
    cells: Vec<u64>,
}

impl Coded {
    fn bare(floats: &[f32]) -> Self {
        Coded { head: head_bytes(&[], floats, &[]), bits: 0, cells: Vec::new() }
    }
}

/// Сетка квантования: шаг и смещение проверены один раз.
struct Grid {
    quantum: f32,
    offset: f32,
}

impl Grid {
    fn new(quantum: f32, offset: f32) -> Result<Self> {
        ensure(quantum.is_finite() && quantum > 0.0 && offset.is_finite(), MSG_STEP)?;
        Ok(Grid { quantum, offset })
    }

    fn snap(&self, v: f32) -> Result<u32> {
        ensure(v >= self.offset - 0.5 * self.quantum, MSG_BELOW)?;
        let steps = (v - self.offset) / self.quantum + 0.5;
        ensure(steps <= QUANT_CEILING, MSG_TOO_FINE)?;
        Ok(steps as u32)
    }

    fn snap_all(&self, values: &[f32]) -> Result<Vec<u32>> {
        values.iter().map(|&v| self.snap(v)).collect()
    }
}

impl Channel {
    fn code(&self, span: &Range<usize>) -> Result<Coded> {
        Ok(match self {
            Channel::StaticQuaternion(q) => Coded::bare(&q[..3]),
            Channel::StaticVector3(v) => Coded::bare(v),
            Channel::StaticFloat(v) => Coded::bare(&[*v]),
            Channel::Raw(values) => Coded {
                head: Vec::new(),
                bits: 32,
                cells: values[span.clone()].iter().map(|v| u64::from(v.to_bits())).collect(),
            },
            Channel::Quantize { quantum, offset, values } => {
                let quanta = Grid::new(*quantum, *offset)?.snap_all(&values[span.clone()])?;
                let bits = quanta.iter().max().map_or(1, |&m| width_of(m).max(1));
                Coded {
                    head: head_bytes(&[bits as i32], &[*quantum, *offset], &[]),
                    bits,
                    cells: quanta.into_iter().map(u64::from).collect(),
                }
            }
            Channel::Indirect { quantum, offset, values } => {
                let quanta = Grid::new(*quantum, *offset)?.snap_all(&values[span.clone()])?;
                let palette: BTreeSet<u32> = quanta.iter().copied().collect();
                let value_bits = palette.last().map_or(0, |&m| width_of(m)).max(3);
                let index_bits = width_of(palette.len() as u32).max(2);
                let words = (palette.len() * value_bits as usize).div_ceil(32);
                let mut sink = BitSink::default();
                palette.iter().for_each(|&q| sink.push(u64::from(q), value_bits));
                let rank: BTreeMap<u32, u64> = palette.iter().enumerate().map(|(i, &q)| (q, i as u64)).collect();
                Coded {
                    head: head_bytes(
                        &[index_bits as i32, value_bits as i32, words as i32],
                        &[*quantum, *offset],
                        &sink.close(words * 4),
                    ),
                    bits: index_bits,
                    cells: quanta.iter().map(|q| rank[q]).collect(),
                }
            }
        })
    }
}

/// Ключ канала в блоке: (тип, группа, слот); по нему каналы и сортируются.
type Key = (u8, usize, usize);

/// Собирает блок: заголовок в 32 байта и данные.
fn encode_block(groups: &[Group], span: Range<usize>) -> Result<Vec<u8>> {
    let frames = span.len();
    let wanted = groups.iter().enumerate().flat_map(|(g, group)| {
        let slots = group
            .slots
            .iter()
            .enumerate()
            .filter_map(move |(s, ch)| ch.as_ref().map(|ch| ((ch.kind(), g, s), Some(ch))));
        let cache = group.cached.map(|i| ((KIND_CACHED, g, usize::from(i)), None::<&Channel>));
        slots.chain(cache)
    });
    let coded = wanted
        .map(|(key, ch)| match ch {
            Some(ch) => ch.code(&span).map(|c| (key, c)),
            None => Ok((key, Coded::bare(&[]))),
        })
        .collect::<Result<BTreeMap<Key, Coded>>>()?;

    let sum = |kind: u8, pick: fn(&Coded) -> usize| -> usize {
        coded.iter().filter(|(k, _)| k.0 == kind).map(|(_, c)| pick(c)).sum()
    };
    let palette_words = sum(KIND_PALETTE, |c| c.head.len() / 4);
    let quant_bits = sum(KIND_QUANT, |c| c.bits as usize);
    ensure(palette_words <= MAX_FIELD && quant_bits <= MAX_FIELD, MSG_SUMS)?;

    let mut tags: [Vec<u16>; KIND_COUNT] = Default::default();
    for &(kind, g, s) in coded.keys() {
        tags[usize::from(kind)].push(((g << 2) | s) as u16);
    }
    ensure(tags.iter().all(|t| t.len() <= MAX_FIELD), MSG_KIND_COUNT)?;

    let framed: Vec<&Coded> = coded.values().filter(|c| c.bits > 0).collect();
    let frame_len = framed.iter().map(|c| c.bits as usize).sum::<usize>().next_multiple_of(32) / 8;
    ensure(frame_len <= MAX_FIELD && frames <= MAX_FIELD, MSG_BLOCK_FIELDS)?;
    let mut data: Vec<u8> = coded.values().flat_map(|c| c.head.iter().copied()).collect();
    let frames_at = data.len();
    for k in 0..frames {
        let mut sink = BitSink::default();
        framed.iter().for_each(|c| sink.push(c.cells[k], c.bits));
        data.extend(sink.close(frame_len));
    }
    data.extend(tags.iter().flat_map(|t| (t.len() as u16).to_le_bytes()));
    let filler = ((groups.len() << 2) as u16).to_le_bytes();
    for list in &tags {
        data.extend(list.iter().flat_map(|t| t.to_le_bytes()));
        for _ in list.len()..list.len().next_multiple_of(4) {
            data.extend_from_slice(&filler);
        }
    }

    let top = record(
        BLOCK_HEAD,
        &[
            (head::HASH, Cell::W(data_hash(&data))),
            (head::LEN, Cell::W(data.len() as u32)),
            (head::FRAMES_AT, Cell::W(frames_at as u32)),
            (head::TOTAL, Cell::W((BLOCK_HEAD + data.len()) as u32)),
            (head::FRAMES, Cell::H(frames as u16)),
            (head::FRAME_LEN, Cell::H(frame_len as u16)),
            (head::WORDS, Cell::H(palette_words as u16)),
            (head::BITS, Cell::H(quant_bits as u16)),
            (head::CHUNK, Cell::B(255)),
        ],
    );
    Ok([top, data].concat())
}

// ---------------------------------------------------------------------------------------------
// Карты: записи и корзины
// ---------------------------------------------------------------------------------------------

/// Запись карты: смещение и хеш.
type Row = (usize, u32);

fn bucket_count(entries: usize) -> Result<usize> {
    ensure(entries <= MAX_ENTRIES, MSG_MAP_FULL)?;
    Ok(BUCKET_LADDER.iter().copied().find(|&c| c > entries).unwrap_or(WIDEST))
}

/// Записи двух карт словаря в порядке вставки.
#[derive(Default)]
struct Tables {
    anims: Vec<Row>,
    clips: Vec<Row>,
}

/// Кладёт массив корзин для записей и сшивает их цепочки; возвращает смещение массива и число корзин.
fn stitch(img: &mut Image, rows: &[Row]) -> Result<(usize, usize)> {
    let cap = bucket_count(rows.len())?;
    let mut chains: Vec<Vec<usize>> = vec![Vec::new(); cap];
    for &(at, hash) in rows {
        chains[hash as usize % cap].push(at);
        img.patch(at, &[(entry::NEXT, Cell::Q(0))])?;
    }
    for link in chains.iter().flat_map(|c| c.windows(2)) {
        img.patch(link[0], &[(entry::NEXT, ptr(link[1]))])?;
    }
    let heads: Vec<u8> = chains
        .iter()
        .flat_map(|c| c.first().map_or(0, |&at| vptr(at)).to_le_bytes())
        .collect();
    Ok((img.append(&heads), cap))
}

// ---------------------------------------------------------------------------------------------
// Клип
// ---------------------------------------------------------------------------------------------

/// Карта свойств клипа: корзины, записи, свойства и их целочисленные атрибуты (как пишет хост: `VFT` 0, `Unknown_04h` 1, вид атрибута `Int` = 2).
fn emit_properties(img: &mut Image, properties: &[ClipProperty]) -> Result<usize> {
    let mut rows: Vec<Row> = Vec::new();
    for property in properties {
        let attributes: Vec<u8> = property
            .ints
            .iter()
            .flat_map(|&(name, value)| {
                let at = img.append(&record(
                    ATTRIBUTE_INT_SIZE,
                    &[(attribute::ONE, Cell::W(1)), (attribute::KIND, Cell::B(ATTRIBUTE_INT)), (attribute::NAME, Cell::W(name)), (attribute::VALUE, Cell::W(value as u32))],
                ));
                vptr(at).to_le_bytes()
            })
            .collect();
        let list = img.append(&attributes);
        let count = u16::try_from(property.ints.len()).map_err(|_| Error::argument(MSG_PROPERTY))?;
        let at = img.append(&record(
            PROPERTY_SIZE,
            &[
                (prop::ONE, Cell::W(1)),
                (prop::NAME, Cell::W(property.name)),
                (prop::LIST, ptr(list)),
                (prop::COUNT, Cell::H(count)),
                (prop::CAPACITY, Cell::H(count)),
                (prop::UNK, Cell::W(property.unk)),
            ],
        ));
        let row = img.append(&record(ENTRY_SIZE, &[(entry::HASH, Cell::W(property.name)), (entry::VALUE, ptr(at))]));
        rows.push((row, property.name));
    }
    let (array, cap) = stitch(img, &rows)?;
    let cap = u16::try_from(cap).map_err(|_| Error::argument(MSG_MAP_FULL))?;
    Ok(img.append(&record(
        PROPS_SIZE,
        &[(0, ptr(array)), (8, Cell::H(cap)), (10, Cell::H(rows.len() as u16)), (12, Cell::W(TAIL_MARK))],
    )))
}

fn emit_clip(img: &mut Image, clip: &NewClip, tables: &mut Tables) -> Result<()> {
    vet(clip)?;
    let a = &clip.animation;
    let cuts: Vec<(&[Group], Range<usize>)> = a.sequences.as_ref().map_or_else(
        || {
            (0..a.frames)
                .step_by(a.limit)
                .map(|from| (&a.groups[..], from..(from + a.limit + 1).min(a.frames)))
                .collect()
        },
        |list| list.iter().map(|q| (&q.groups[..], 0..q.frames)).collect(),
    );
    let blocks = cuts
        .into_iter()
        .map(|(groups, span)| encode_block(groups, span))
        .collect::<Result<Vec<_>>>()?;
    let biggest = blocks.iter().map(Vec::len).max().unwrap_or(0);
    let block_ptrs: Vec<u8> = blocks.iter().flat_map(|b| vptr(img.append(b)).to_le_bytes()).collect();
    let block_list = img.append(&block_ptrs);
    let bone_bytes: Vec<u8> = a
        .bones
        .iter()
        .flat_map(|b| (u32::from(b.bone) | u32::from(b.unk) << 16 | u32::from(b.track) << 24).to_le_bytes())
        .collect();
    let bone_list = img.append(&bone_bytes);

    let (nblocks, nbones) = (blocks.len() as u16, a.bones.len() as u16);
    let animation_at = img.append(&record(
        ANIMATION_SIZE,
        &[
            (anim::TAG, Cell::W(ANIMATION_TAG)),
            (anim::REV, Cell::W(1)),
            // Оба байта флагов анимации — 1, как у штатных клипов и у хоста (XML `Unknown10` читает первый из них).
            (anim::FLAG_FIRST, Cell::B(1)),
            (anim::FLAG, Cell::B(1)),
            (anim::FRAMES, Cell::H(a.frames as u16)),
            (anim::LIMIT, Cell::H(a.limit as u16)),
            (anim::DURATION, Cell::F(a.duration)),
            (anim::SIGNATURE, Cell::W(a.signature)),
            (anim::BIGGEST, Cell::W(biggest as u32)),
            (anim::MODE, Cell::W(2)),
            (anim::BLOCKS, ptr(block_list)),
            (anim::BLOCK_COUNT, Cell::H(nblocks)),
            (anim::BLOCK_COUNT_COPY, Cell::H(nblocks)),
            (anim::BONES, ptr(bone_list)),
            (anim::BONE_COUNT, Cell::H(nbones)),
            (anim::BONE_COUNT_COPY, Cell::H(nbones)),
        ],
    ));
    let anim_row = img.append(&record(
        ENTRY_SIZE,
        &[(entry::HASH, Cell::W(a.hash)), (entry::VALUE, ptr(animation_at))],
    ));
    tables.anims.push((anim_row, a.hash));

    let tag_list = img.append(&[0u8; TAGS_SIZE]);
    let props_at = emit_properties(img, &clip.properties)?;
    let name_at = img.append(&[clip.name.as_bytes(), &[0]].concat());
    let name_len = clip.name.len() as u16;
    let clip_at = img.append(&record(
        CLIP_SIZE,
        &[
            (clip::TAG, Cell::W(CLIP_TAG)),
            (clip::REV, Cell::W(1)),
            (clip::KIND, Cell::W(1)),
            (clip::NAME, ptr(name_at)),
            (clip::NAME_LEN, Cell::H(name_len)),
            (clip::NAME_LEN_NUL, Cell::H(name_len + 1)),
            (clip::ROOT, ptr(0)),
            (clip::HOLD, Cell::W(1)),
            (clip::TAGS, ptr(tag_list)),
            (clip::PROPS, ptr(props_at)),
            (clip::BODY, Cell::W(1)),
            (clip::ANIM, ptr(animation_at)),
            (clip::START, Cell::F(clip.start)),
            (clip::END, Cell::F(clip.end)),
            (clip::RATE, Cell::F(clip.rate)),
        ],
    ));
    let clip_row = img.append(&record(
        ENTRY_SIZE,
        &[(entry::HASH, Cell::W(clip.hash)), (entry::VALUE, ptr(clip_at))],
    ));
    tables.clips.push((clip_row, clip.hash));
    Ok(())
}

/// Сшивает обе карты, кладёт блок страниц и правит поля корня и карты анимаций.
fn link_up(img: &mut Image, tables: &Tables, root_at: usize, map_at: usize) -> Result<()> {
    let (anim_array, anim_cap) = stitch(img, &tables.anims)?;
    let (clip_array, clip_cap) = stitch(img, &tables.clips)?;
    let pages = img.append(&record(PAGES_SIZE, &[(8, Cell::B(1))]));
    img.patch(
        root_at,
        &[
            (root::PAGES, ptr(pages)),
            (root::BUCKETS, ptr(clip_array)),
            (root::CAP, Cell::H(clip_cap as u16)),
            (root::COUNT, Cell::H(tables.clips.len() as u16)),
        ],
    )?;
    img.patch(
        map_at,
        &[
            (map::BUCKETS, ptr(anim_array)),
            (map::CAP, Cell::H(anim_cap as u16)),
            (map::COUNT, Cell::H(tables.anims.len() as u16)),
        ],
    )
}

/// Сжимает образ одной страницей и ставит заголовок файла.
fn pack_file(img: Image, nibble: u32, graphics_flags: u32) -> Result<Vec<u8>> {
    let Some((flags, page)) = single_page_flags(nibble, align16(img.0.len())) else {
        return Err(Error::argument(MSG_ONE_PAGE));
    };
    let mut body = img.0;
    body.resize(page, 0);
    let top: Vec<u8> = [RSC7_MAGIC, YCD_VERSION, flags, graphics_flags]
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .collect();
    debug_assert_eq!(top.len(), HEADER_BYTES);
    Ok([top, miniz_oxide::deflate::compress_to_vec(&body, 6)].concat())
}

// ---------------------------------------------------------------------------------------------
// Новый словарь
// ---------------------------------------------------------------------------------------------

pub fn new_dictionary(clips: &[NewClip]) -> Result<Vec<u8>> {
    ensure(!clips.is_empty(), MSG_NO_CLIPS)?;
    let mut img = Image(Vec::new());
    let root_at = img.append(&[0u8; ROOT_SIZE]);
    let map_at = img.append(&[0u8; ANIM_MAP_SIZE]);
    let mut tables = Tables::default();
    for clip in clips {
        emit_clip(&mut img, clip, &mut tables)?;
    }
    img.patch(
        root_at,
        &[
            (root::TAG, Cell::W(ROOT_TAG)),
            (root::REV, Cell::W(1)),
            (root::ANIM_MAP, ptr(map_at)),
            (root::MARK, Cell::W(0x0101)),
            (root::TAIL, Cell::W(TAIL_MARK)),
        ],
    )?;
    img.patch(
        map_at,
        &[
            (map::TAG, Cell::W(ANIM_MAP_TAG)),
            (map::REV, Cell::W(1)),
            (map::TAIL, Cell::W(TAIL_MARK)),
            (map::ONE, Cell::W(1)),
        ],
    )?;
    link_up(&mut img, &tables, root_at, map_at)?;
    pack_file(img, FLAGS_SYSTEM_NEW, FLAGS_GRAPHICS_NEW)
}

// ---------------------------------------------------------------------------------------------
// Дописывание в готовый словарь
// ---------------------------------------------------------------------------------------------

/// Чтение полей исходной системной области по смещениям.
struct Source<'a>(&'a [u8]);

impl Source<'_> {
    fn raw<const N: usize>(&self, at: usize) -> Result<[u8; N]> {
        at.checked_add(N)
            .and_then(|to| self.0.get(at..to))
            .and_then(|s| s.try_into().ok())
            .ok_or_else(|| Error::broken(MSG_EOF))
    }

    /// Указатель в поле: пусто, смещение или отказ для значения ниже базы.
    fn link(&self, at: usize) -> Result<Option<usize>> {
        match u64::from_le_bytes(self.raw(at)?) {
            0 => Ok(None),
            v if v < SYSTEM_BASE => Err(Error::broken(MSG_FOREIGN_POINTER)),
            v => Ok(Some((v - SYSTEM_BASE) as usize)),
        }
    }

    /// Записи одной цепочки; ошибки чтения указателей всплывают на следующем шаге.
    fn chain(&self, head: Option<usize>) -> Result<Vec<Row>> {
        let hops = successors(head.map(Ok), |prev: &Result<usize>| match prev {
            Ok(at) => self.link(at + entry::NEXT).transpose(),
            Err(_) => None,
        });
        let mut rows = Vec::new();
        for (visit, hop) in hops.enumerate() {
            let at = hop?;
            ensure_broken(visit < MAX_VISITS, MSG_LONG_CHAIN)?;
            let fits = at.checked_add(ENTRY_SIZE).is_some_and(|end| end <= self.0.len());
            ensure_broken(fits, MSG_ENTRY_EOF)?;
            rows.push((at, u32::from_le_bytes(self.raw(at + entry::HASH)?)));
        }
        Ok(rows)
    }

    /// Все записи карты: поля с указателем на массив корзин и с числом корзин.
    fn rows(&self, array_field: usize, cap_field: usize, count_field: usize) -> Result<Vec<Row>> {
        let array = self.link(array_field)?;
        let cap = usize::from(u16::from_le_bytes(self.raw(cap_field)?));
        let listed = u16::from_le_bytes(self.raw(count_field)?);
        let Some(array) = array.filter(|_| cap > 0) else {
            // Записи заявлены, а корзин нет: при дописывании они молча пропали бы.
            ensure_broken(listed == 0, MSG_NO_BUCKETS)?;
            return Ok(Vec::new());
        };
        let mut rows = Vec::new();
        for bucket in 0..cap {
            let head = self.link(array.saturating_add(bucket * 8))?;
            rows.extend(self.chain(head)?);
        }
        Ok(rows)
    }
}

/// Разбор исходного словаря: ресурс, смещение карты анимаций и записи обеих карт.
fn inherit(original: &[u8]) -> Result<(Resource, usize, Vec<Row>, Vec<Row>)> {
    let res = Resource::parse(original)?;
    ensure_broken(res.complete, MSG_CUT)?;
    ensure(res.header.graphics_size == 0, MSG_GRAPHICS)?;
    ensure(res.header.version == YCD_VERSION, MSG_NOT_YCD)?;
    let root = res.root().ok_or_else(|| Error::broken(MSG_NO_ROOT))?;
    let src = Source(res.data());
    let map = src
        .link(root + root::ANIM_MAP)?
        .ok_or_else(|| Error::broken(MSG_NO_ANIM_MAP))?;
    let anims = src.rows(map.saturating_add(map::BUCKETS), map.saturating_add(map::CAP), map.saturating_add(map::COUNT))?;
    let clips = src.rows(root + root::BUCKETS, root + root::CAP, root + root::COUNT)?;
    Ok((res, map, anims, clips))
}

pub fn add_clips(original: &[u8], clips: &[NewClip]) -> Result<Vec<u8>> {
    let (res, map_at, anims, listed) = inherit(original)?;
    let mut img = Image(res.data()[..res.header.system_size].to_vec());
    let mut tables = Tables { anims, clips: listed };
    for clip in clips {
        emit_clip(&mut img, clip, &mut tables)?;
    }
    link_up(&mut img, &tables, 0, map_at)?;
    pack_file(img, res.header.system_flags >> 28, res.header.graphics_flags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::ycd::summarize;
    use crate::ycd_pose::{clip_names, sample_clip, PoseSample};

    fn expect_pose(sample: &PoseSample, frame: usize) {
        let near = |got: &[f32], want: &[f32], tol: f32| {
            assert_eq!(got.len(), want.len());
            for (g, w) in got.iter().zip(want) {
                assert!((g - w).abs() <= tol, "кадр {frame}: {got:?} против {want:?}");
            }
        };
        assert_eq!(sample.bones.len(), 3, "кадр {frame}");
        let (shift, turn, drift) = (&sample.bones[0], &sample.bones[1], &sample.bones[2]);
        assert_eq!((shift.tag, shift.track), (10, "translation"));
        near(&shift.value, &[0.5, -1.25, 2.0], 1e-6);
        assert_eq!((turn.tag, turn.track), (20, "rotation"));
        near(&turn.value, &[0.0, 0.0, 0.6, 0.8], 1e-5);
        assert_eq!((drift.tag, drift.track), (30, "translation"));
        let series = |s: usize| -1.0 + 0.001 * ((frame * s) % 9) as f32;
        near(&drift.value, &[series(3), series(5), series(7)], 1e-4);
    }

    fn row(frames: usize, step: usize) -> Vec<f32> {
        (0..frames).map(|k| -1.0 + 0.001 * ((k * step) % 9) as f32).collect()
    }

    fn model_clip(name: &str, frames: usize, limit: usize) -> NewClip {
        let duration = (frames - 1) as f32 / 30.0;
        let drift = Group {
            slots: [
                Some(Channel::Indirect { quantum: 0.001, offset: -1.0, values: row(frames, 3) }),
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: row(frames, 5) }),
                Some(Channel::Quantize { quantum: 0.001, offset: -1.0, values: row(frames, 7) }),
                None,
            ],
            cached: None,
        };
        let single = |c| Group { slots: [Some(c), None, None, None], cached: None };
        NewClip {
            hash: name_hash(name),
            name: name.to_string(),
            start: 0.0,
            end: duration,
            rate: 1.0,
            properties: Vec::new(),
            animation: NewAnimation {
                hash: name_hash(&format!("{name}_anim")),
                signature: 0x1234_5678,
                duration,
                frames,
                limit,
                bones: vec![
                    BoneTrack { bone: 10, track: 0, unk: 0 },
                    BoneTrack { bone: 20, track: 1, unk: 1 },
                    BoneTrack { bone: 30, track: 0, unk: 0 },
                ],
                groups: vec![
                    single(Channel::StaticVector3([0.5, -1.25, 2.0])),
                    single(Channel::StaticQuaternion([0.0, 0.0, 0.6, 0.8])),
                    drift,
                ],
                sequences: None,
            },
        }
    }

    fn check_every_frame(file: &[u8], name: &str, frames: usize) {
        for k in 0..frames {
            let at = (k as f32 + 0.25) / 30.0;
            expect_pose(&sample_clip(file, name, at).unwrap(), k);
        }
    }

    /// 16.11.2026: CodeWalker читает у анимации два байта флагов (`Unknown10` и `Unknown11`), у штатных клипов и у клипа хоста оба равны 1.
    /// Писатель ставил только второй: XML выхода показывал `Unknown10` = 0 (сверка `ycd-from-xml` и клипов дирижаблей и звезды).
    #[test]
    fn both_animation_flag_bytes_are_one_like_stock_clips() {
        let file = new_dictionary(&[model_clip("ycd_flags", 10, 12)]).unwrap();
        let body = crate::resource::Resource::parse(&file).unwrap().data().to_vec();
        let (tag, revision) = (ANIMATION_TAG.to_le_bytes(), 1u32.to_le_bytes());
        let at = body.windows(8).position(|word| word[..4] == tag && word[4..] == revision).expect("запись анимации в теле словаря");
        assert_eq!((body[at + 0x10], body[at + 0x11]), (1, 1));
    }

    #[test]
    fn new_dictionary_reads_back_every_channel_type() {
        let file = new_dictionary(&[model_clip("ycd_round", 10, 12)]).unwrap();
        assert_eq!(clip_names(&file).unwrap(), ["ycd_round"]);
        let summary = summarize(&file).unwrap();
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].hash, name_hash("ycd_round_anim"));
        check_every_frame(&file, "ycd_round", 10);
    }

    #[test]
    fn frames_split_into_blocks_read_back_across_blocks() {
        let file = new_dictionary(&[model_clip("ycd_blocks", 10, 4)]).unwrap();
        assert_eq!(summarize(&file).unwrap()[0].sequences.len(), 9);
        check_every_frame(&file, "ycd_blocks", 10);
    }

    #[test]
    fn appended_clip_keeps_the_old_clip_poses_unchanged() {
        let first = new_dictionary(&[model_clip("ycd_first", 10, 12)]).unwrap();
        let both = add_clips(&first, &[model_clip("ycd_second", 8, 10)]).unwrap();
        let names = clip_names(&both).unwrap();
        assert!(names.contains(&"ycd_first".to_string()) && names.contains(&"ycd_second".to_string()));
        check_every_frame(&both, "ycd_first", 10);
        for k in 0..8 {
            let sample = sample_clip(&both, "ycd_second", (k as f32 + 0.25) / 30.0).unwrap();
            assert_eq!(sample.bones.len(), 3);
        }
    }

    #[test]
    fn cached_quaternion_reads_back_with_its_quantized_pair() {
        let frames = 6;
        let angle = |k: usize| 0.2 * k as f32;
        let hold = || Some(Channel::StaticFloat(0.0));
        let quant = |f: fn(f32) -> f32| {
            Some(Channel::Quantize {
                quantum: 1e-4,
                offset: -1.0,
                values: (0..frames).map(|k| f(angle(k))).collect(),
            })
        };
        let name = "pack:/ycd_cached.clip";
        let duration = (frames - 1) as f32 / 30.0;
        let clip = NewClip {
            hash: name_hash("ycd_cached"),
            name: name.to_string(),
            start: 0.0,
            end: duration,
            rate: 1.0,
            properties: Vec::new(),
            animation: NewAnimation {
                hash: name_hash("ycd_cached_anim"),
                signature: 0x1234_5678,
                duration,
                frames,
                limit: 8,
                bones: vec![BoneTrack { bone: 5, track: 1, unk: 1 }],
                groups: vec![Group {
                    slots: [hold(), hold(), quant(f32::sin), quant(f32::cos)],
                    cached: Some(0),
                }],
                sequences: None,
            },
        };
        let file = new_dictionary(&[clip]).unwrap();
        for k in 0..frames {
            let sample = sample_clip(&file, "ycd_cached", (k as f32 + 0.25) / 30.0).unwrap();
            let turn = &sample.bones[0];
            assert_eq!((turn.tag, turn.track), (5, "rotation"));
            let want = [0.0, 0.0, angle(k).sin(), angle(k).cos()];
            for (g, w) in turn.value.iter().zip(want) {
                assert!((g - w).abs() <= 2e-4, "кадр {k}: {:?}", turn.value);
            }
        }
    }

    #[test]
    fn a_block_whose_frame_length_or_frame_count_overflows_u16_is_refused() {
        // 4096 костей по четыре канала Raw: 16384 канала по 32 бита, длина кадра 65536 байт.
        let mut clip = tiny("wide", 1, 1, Channel::Raw(vec![0.0]));
        clip.animation.bones = (0..4096).map(|i| BoneTrack { bone: i as u16, track: 0, unk: 0 }).collect();
        clip.animation.groups = (0..4096)
            .map(|_| Group { slots: std::array::from_fn(|_| Some(Channel::Raw(vec![0.0]))), cached: None })
            .collect();
        let refusal = new_dictionary(&[clip.clone()]).unwrap_err();
        assert_eq!((refusal.kind, refusal.message.as_str()), (Kind::Argument, MSG_BLOCK_FIELDS));
        // Одним каналом меньше: 65532 байта умещаются.
        clip.animation.groups[0].slots[0] = None;
        assert!(new_dictionary(&[clip]).is_ok());
        // Явный блок в 65536 кадров: число кадров обернулось бы в ноль.
        let mut long = tiny("long", 65535, 65535, Channel::Raw(vec![0.0; 65535]));
        let group = Group { slots: [Some(Channel::Raw(vec![0.0; 65536])), None, None, None], cached: None };
        long.animation.sequences = Some(vec![NewSequence { frames: 65536, groups: vec![group] }]);
        assert_eq!(new_dictionary(&[long]).unwrap_err().message, MSG_BLOCK_FIELDS);
    }

    #[test]
    fn clip_times_must_be_finite_numbers() {
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for field in 0..3 {
                let mut clip = tiny("timed", 2, 4, Channel::StaticFloat(1.0));
                match field {
                    0 => clip.start = bad,
                    1 => clip.end = bad,
                    _ => clip.rate = bad,
                }
                let refusal = new_dictionary(&[clip]).unwrap_err();
                assert_eq!((refusal.kind, refusal.message.as_str()), (Kind::Argument, MSG_TIMES), "{field} {bad}");
            }
        }
        // Большие конечные числа допустимы.
        let mut clip = tiny("timed", 2, 4, Channel::StaticFloat(1.0));
        (clip.start, clip.end, clip.rate) = (-1e30, 1e30, 1e-30);
        assert!(new_dictionary(&[clip]).is_ok());
    }

    /// Файл с правкой несжатой системной области: заголовок тот же, тело сжато заново.
    fn with_body(file: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut body = system_area(file);
        edit(&mut body);
        [&file[..16], crate::resource::deflate_zlib9(&body).as_slice()].concat()
    }

    #[test]
    fn a_source_with_entries_but_no_buckets_is_refused_not_emptied() {
        let file = new_dictionary(&[tiny("old", 2, 4, Channel::StaticFloat(1.0))]).unwrap();
        let extra = || tiny("new", 2, 4, Channel::StaticFloat(2.0));
        assert!(add_clips(&file, &[extra()]).is_ok());
        let no_buckets = with_body(&file, |d| d[root::CAP..root::CAP + 2].copy_from_slice(&[0, 0]));
        let refusal = add_clips(&no_buckets, &[extra()]).unwrap_err();
        assert_eq!((refusal.kind, refusal.message.as_str()), (Kind::Broken, MSG_NO_BUCKETS));
        let no_array = with_body(&file, |d| d[root::BUCKETS..root::BUCKETS + 8].copy_from_slice(&[0; 8]));
        assert_eq!(add_clips(&no_array, &[extra()]).unwrap_err().message, MSG_NO_BUCKETS);
        // Словарь, в котором записей нет вовсе, дописывается.
        let empty = with_body(&file, |d| {
            d[root::CAP..root::CAP + 2].copy_from_slice(&[0, 0]);
            d[root::COUNT..root::COUNT + 2].copy_from_slice(&[0, 0]);
        });
        assert!(add_clips(&empty, &[extra()]).is_ok());
    }

    #[test]
    fn a_clip_that_ends_before_it_starts_is_refused() {
        let mut clip = tiny("backwards", 2, 4, Channel::StaticFloat(1.0));
        (clip.start, clip.end) = (2.0, 1.0);
        let refusal = new_dictionary(&[clip.clone()]).unwrap_err();
        assert_eq!((refusal.kind, refusal.message.as_str()), (Kind::Argument, MSG_TIMES_ORDER));
        // Равные начало и конец — клип нулевой длины, он допустим.
        clip.end = 2.0;
        assert!(new_dictionary(&[clip]).is_ok());
    }

    #[test]
    fn quantize_refuses_an_offset_above_the_values() {
        let mut clip = model_clip("ycd_bad", 4, 6);
        clip.animation.groups[2].slots[1] =
            Some(Channel::Quantize { quantum: 0.1, offset: 0.0, values: vec![-1.0; 4] });
        let err = new_dictionary(&[clip]).unwrap_err();
        assert_eq!((err.kind, err.message.as_str()), (Kind::Argument, MSG_BELOW));
    }

    fn tiny(name: &str, frames: usize, limit: usize, channel: Channel) -> NewClip {
        NewClip {
            hash: name_hash(name),
            name: name.to_string(),
            start: 0.0,
            end: 1.0,
            rate: 1.0,
            properties: Vec::new(),
            animation: NewAnimation {
                hash: name_hash(&format!("{name}_anim")),
                signature: 0x1234_5678,
                duration: 1.0,
                frames,
                limit,
                bones: vec![BoneTrack { bone: 1, track: 0, unk: 0 }],
                groups: vec![Group { slots: [Some(channel), None, None, None], cached: None }],
                sequences: None,
            },
        }
    }

    fn system_area(file: &[u8]) -> Vec<u8> {
        Resource::parse(file).unwrap().data().to_vec()
    }

    /// 16.11.2026: хост кладёт в клипы звезды и летающих свойство `hash_BF6A5D60 = Int 32`; карта свойств клипа движка была пустой.
    /// Читаем записанное по указателям: клип → карта → корзина `имя % 11` → запись → свойство → атрибут `Int`.
    #[test]
    fn a_clip_property_sits_in_its_bucket_of_the_property_map() {
        let mut clip = tiny("props", 4, 6, Channel::StaticFloat(1.0));
        clip.properties = vec![ClipProperty::host_model()];
        let area = system_area(&new_dictionary(&[clip]).unwrap());
        let word = |at: usize| u32::from_le_bytes(area[at..at + 4].try_into().unwrap());
        let half = |at: usize| u16::from_le_bytes(area[at..at + 2].try_into().unwrap());
        let quad = |at: usize| (u64::from_le_bytes(area[at..at + 8].try_into().unwrap()) - SYSTEM_BASE) as usize;
        let clip_at = (0..area.len()).step_by(16).find(|&at| word(at) == CLIP_TAG).expect("клип в области");
        let map = quad(clip_at + clip::PROPS);
        assert_eq!((half(map + 8), half(map + 10)), (11, 1), "корзин 11, свойство одно");
        let entry = quad(quad(map) + (0xBF6A_5D60u32 % 11) as usize * 8);
        assert_eq!(word(entry + entry::HASH), 0xBF6A_5D60);
        assert_eq!(u64::from_le_bytes(area[entry + entry::NEXT..entry + entry::NEXT + 8].try_into().unwrap()), 0, "цепочки нет");
        let property = quad(entry + entry::VALUE);
        assert_eq!((word(property + prop::ONE), word(property + prop::NAME), word(property + prop::UNK)), (1, 0xBF6A_5D60, 0x996C_3B27));
        assert_eq!((half(property + prop::COUNT), half(property + prop::CAPACITY)), (1, 1));
        let attribute = quad(quad(property + prop::LIST));
        assert_eq!((word(attribute + attribute::ONE), area[attribute + attribute::KIND]), (1, 2), "вид атрибута — `Int`");
        assert_eq!((word(attribute + attribute::NAME), word(attribute + attribute::VALUE)), (0xBF6A_5D60, 32));
    }

    #[test]
    fn a_clip_without_properties_keeps_an_empty_map() {
        let area = system_area(&new_dictionary(&[tiny("empty", 4, 6, Channel::StaticFloat(1.0))]).unwrap());
        let word = |at: usize| u32::from_le_bytes(area[at..at + 4].try_into().unwrap());
        let half = |at: usize| u16::from_le_bytes(area[at..at + 2].try_into().unwrap());
        let clip_at = (0..area.len()).step_by(16).find(|&at| word(at) == CLIP_TAG).expect("клип в области");
        let map = u64::from_le_bytes(area[clip_at + clip::PROPS..clip_at + clip::PROPS + 8].try_into().unwrap()) as usize - SYSTEM_BASE as usize;
        assert_eq!((half(map + 8), half(map + 10)), (11, 0));
    }

    #[test]
    fn name_hash_folds_ascii_case() {
        assert_eq!(name_hash(""), 0);
        assert_eq!(name_hash("a"), 0xca2e_9442);
        assert_eq!(name_hash("HELLO"), 0xc8fd_181b);
        assert_eq!(name_hash("pack:/ycd_cached.clip"), 0x5099_eb1e);
        assert_eq!(YCD_VERSION, 46);
    }

    #[test]
    fn minimal_dictionary_layout_matches_the_format() {
        let mut clip = tiny("a", 2, 3, Channel::StaticFloat(1.5));
        clip.animation.hash = 0x9f6c_a971;
        clip.animation.bones[0].bone = 7;
        let file = new_dictionary(&[clip]).unwrap();
        assert_eq!(file.len(), 238);
        assert_eq!(&file[..16], [0x52, 0x53, 0x43, 0x37, 46, 0, 0, 0, 0, 0, 2, 0x20, 0, 0, 0, 0xe0]);
        let data = system_area(&file);
        assert_eq!(data.len(), 0x2000);
        let word = |at: usize| u32::from_le_bytes(data[at..at + 4].try_into().unwrap());
        assert_eq!([word(0), word(0x40), word(0xd0), word(0x1f0)], [0x4057_0818, 0x405a_5c08, 0x405a_58f0, 0x405a_4088]);
        assert_eq!(&data[0x70 + 32..0x70 + 36], 1.5f32.to_le_bytes());
        assert_eq!(&data[0x340..0x350], [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
        assert!(data[0x358..].iter().all(|&b| b == 0));
    }

    #[test]
    fn rejections_follow_the_documented_order() {
        let err = |clip: NewClip| new_dictionary(&[clip]).unwrap_err().message;
        let base = || tiny("ok", 2, 4, Channel::StaticFloat(1.0));
        assert_eq!(new_dictionary(&[]).unwrap_err().message, MSG_NO_CLIPS);

        let mut c = base();
        c.name.clear();
        c.animation.frames = 0;
        assert_eq!(err(c), MSG_NAME);
        let mut c = base();
        c.animation.frames = 0;
        c.animation.limit = 0;
        assert_eq!(err(c), MSG_FRAMES);
        let mut c = base();
        c.animation.limit = 0;
        c.animation.duration = f32::NAN;
        assert_eq!(err(c), MSG_LIMIT);
        let mut c = base();
        c.animation.duration = f32::NAN;
        c.animation.groups.clear();
        assert_eq!(err(c), MSG_DURATION);
        let mut c = base();
        c.animation.groups.clear();
        c.animation.bones[0].track = 5;
        assert_eq!(err(c), MSG_BONES);
        let mut c = base();
        c.animation.bones[0].track = 6;
        c.animation.groups[0].slots[0] = Some(Channel::StaticFloat(f32::NAN));
        assert_eq!(err(c), MSG_ROOT_TRACK);
        let mut c = base();
        c.animation.groups[0].slots[1] = Some(Channel::Raw(vec![1.0]));
        c.animation.groups[0].cached = Some(9);
        assert_eq!(err(c), MSG_ROWS);
        let mut c = base();
        c.animation.groups[0].cached = Some(4);
        assert_eq!(err(c), MSG_CACHED);

        let mut c = base();
        c.animation.sequences = Some(Vec::new());
        assert_eq!(err(c), MSG_NO_BLOCK);
        let mut c = base();
        c.animation.sequences = Some(vec![NewSequence { frames: 5, groups: c.animation.groups.clone() }]);
        assert!(new_dictionary(&[c.clone()]).is_ok());
        c.animation.sequences = Some(vec![NewSequence { frames: 6, groups: c.animation.groups.clone() }]);
        assert_eq!(err(c), MSG_BLOCK);
    }

    #[test]
    fn quantization_edges_are_checked_in_f32() {
        let quant = |quantum, offset, v: f32| {
            let channel = Channel::Quantize { quantum, offset, values: vec![v, v] };
            new_dictionary(&[tiny("q", 2, 4, channel)]).map(|_| ()).map_err(|e| e.message)
        };
        assert_eq!(quant(0.0, 0.0, 0.0), Err(MSG_STEP.to_string()));
        assert_eq!(quant(1.0, f32::INFINITY, 0.0), Err(MSG_STEP.to_string()));
        assert_eq!(quant(1.0, 0.0, -0.6), Err(MSG_BELOW.to_string()));
        assert_eq!(quant(1.0, 0.0, -0.5), Ok(()));
        assert_eq!(quant(1e-30, 0.0, 1.0), Err(MSG_TOO_FINE.to_string()));
        assert_eq!(quant(1.0, 0.0, 4294967296.0), Ok(()));
        assert_eq!(quant(1.0, 0.0, 8589934592.0), Err(MSG_TOO_FINE.to_string()));
        assert_eq!(quant(1.0, -3e38, 3e38), Err(MSG_TOO_FINE.to_string()));
    }

    #[test]
    fn palette_widths_follow_the_palette_length() {
        let channel = Channel::Indirect { quantum: 0.25, offset: 0.0, values: vec![0.0, 0.5, 0.0, 0.5, 0.25] };
        let data = system_area(&new_dictionary(&[tiny("ind", 5, 7, channel)]).unwrap());
        let block = &data[0x70..];
        assert_eq!(u16::from_le_bytes([block[0x1A], block[0x1B]]), 6);
        assert_eq!(&block[32..44], [2, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(&block[32 + 20..32 + 24], [0x88, 0, 0, 0]);
    }

    #[test]
    fn buckets_grow_along_the_ladder_and_chains_keep_insertion_order() {
        assert_eq!([bucket_count(0), bucket_count(10), bucket_count(11)].map(|r| r.unwrap()), [11, 11, 29]);
        assert_eq!(bucket_count(65166).unwrap(), 65167);
        assert_eq!(bucket_count(65167).unwrap(), 65521);
        assert_eq!(bucket_count(65536).unwrap_err().message, MSG_MAP_FULL);

        let hashes = [0u32, 11, 22, 33, 1, 12];
        let clips: Vec<NewClip> = hashes
            .iter()
            .map(|&h| {
                let mut c = tiny(&format!("c{h}"), 2, 4, Channel::StaticFloat(1.0));
                c.hash = h;
                c
            })
            .collect();
        let data = system_area(&new_dictionary(&clips).unwrap());
        let cap = u16::from_le_bytes([data[0x30], data[0x31]]) as usize;
        assert_eq!(cap, 11);
        let array = (u64::from_le_bytes(data[0x28..0x30].try_into().unwrap()) - SYSTEM_BASE) as usize;
        let walk = |bucket: usize| {
            let mut out = Vec::new();
            let mut at = u64::from_le_bytes(data[array + bucket * 8..array + bucket * 8 + 8].try_into().unwrap());
            while at != 0 {
                let e = (at - SYSTEM_BASE) as usize;
                out.push(u32::from_le_bytes(data[e..e + 4].try_into().unwrap()));
                at = u64::from_le_bytes(data[e + 0x10..e + 0x18].try_into().unwrap());
            }
            out
        };
        assert_eq!(walk(0), [0, 11, 22, 33]);
        assert_eq!(walk(1), [1, 12]);
    }

    #[test]
    fn add_clips_grows_the_page_and_touches_only_link_fields() {
        let one = new_dictionary(&[tiny("alpha", 2, 4, Channel::StaticFloat(1.0))]).unwrap();
        let before = system_area(&one);
        let grown = add_clips(&one, &[]).unwrap();
        let after = system_area(&grown);
        assert_eq!((before.len(), after.len()), (0x2000, 0x4000));
        let flags = u32::from_le_bytes(grown[8..12].try_into().unwrap());
        assert_eq!(flags, 0x2002_0001);
        let changed: Vec<usize> = (0..before.len()).filter(|&i| before[i] != after[i]).collect();
        assert!(changed.iter().all(|&i| matches!(i, 8 | 9 | 40 | 41 | 88 | 89)), "{changed:?}");
        assert_eq!(clip_names(&grown).unwrap(), ["alpha"]);
    }

    #[test]
    fn add_clips_refuses_foreign_and_broken_input() {
        let text = |r: Result<Vec<u8>>| {
            let e = r.unwrap_err();
            (e.kind, e.message)
        };
        assert_eq!(text(add_clips(&[], &[])), (Kind::Broken, "Ресурс короче заголовка RSC7.".to_string()));
        let good = new_dictionary(&[tiny("alpha", 2, 4, Channel::StaticFloat(1.0))]).unwrap();
        assert_eq!(text(add_clips(&good[..good.len() / 2], &[])), (Kind::Broken, MSG_CUT.to_string()));

        let mut other = good.clone();
        other[8..12].copy_from_slice(&0x1002_0000u32.to_le_bytes());
        assert_eq!(text(add_clips(&other, &[])), (Kind::Argument, MSG_NOT_YCD.to_string()));

        let mut other = good.clone();
        other[12..16].copy_from_slice(&0xE002_0000u32.to_le_bytes());
        assert_eq!(text(add_clips(&other, &[])).1, MSG_CUT);

        let data = system_area(&good);
        let rebuild = |mutate: &dyn Fn(&mut Vec<u8>)| {
            let mut d = data.clone();
            mutate(&mut d);
            let mut f = good[..16].to_vec();
            f.extend(miniz_oxide::deflate::compress_to_vec(&d, 6));
            f
        };
        let no_map = rebuild(&|d| d[0x18..0x20].fill(0));
        assert_eq!(text(add_clips(&no_map, &[])), (Kind::Broken, MSG_NO_ANIM_MAP.to_string()));
        let low_map = rebuild(&|d| d[0x18..0x20].copy_from_slice(&5u64.to_le_bytes()));
        assert_eq!(text(add_clips(&low_map, &[])), (Kind::Broken, MSG_FOREIGN_POINTER.to_string()));
        let far_map = rebuild(&|d| d[0x18..0x20].copy_from_slice(&0x5fff_0000u64.to_le_bytes()));
        assert_eq!(text(add_clips(&far_map, &[])), (Kind::Broken, MSG_EOF.to_string()));
        let cycle = rebuild(&|d| {
            let entry = 0x260usize;
            d[entry + 0x10..entry + 0x18].copy_from_slice(&(SYSTEM_BASE + entry as u64).to_le_bytes());
        });
        assert_eq!(text(add_clips(&cycle, &[])), (Kind::Broken, MSG_LONG_CHAIN.to_string()));
        let mut bad = tiny("x", 2, 4, Channel::StaticFloat(1.0));
        bad.name.clear();
        assert_eq!(text(add_clips(&good, &[bad])), (Kind::Argument, MSG_NAME.to_string()));
    }

    #[test]
    fn rebuilt_chains_follow_the_old_walk_order() {
        let mk = |h: u32| {
            let mut c = tiny(&format!("n{h}"), 2, 4, Channel::StaticFloat(1.0));
            c.hash = h;
            c.animation.hash = h + 5000;
            c
        };
        let old = new_dictionary(&[mk(118), mk(59), mk(0)]).unwrap();
        let extra: Vec<NewClip> = (1000..1026).map(mk).collect();
        let file = add_clips(&old, &extra).unwrap();
        let data = system_area(&file);
        assert_eq!(u16::from_le_bytes([data[0x30], data[0x31]]), 59);
        assert_eq!(u16::from_le_bytes([data[0x32], data[0x33]]), 29);
        let array = (u64::from_le_bytes(data[0x28..0x30].try_into().unwrap()) - SYSTEM_BASE) as usize;
        let mut at = u64::from_le_bytes(data[array..array + 8].try_into().unwrap());
        let mut order = Vec::new();
        while at != 0 {
            let e = (at - SYSTEM_BASE) as usize;
            order.push(u32::from_le_bytes(data[e..e + 4].try_into().unwrap()));
            at = u64::from_le_bytes(data[e + 0x10..e + 0x18].try_into().unwrap());
        }
        assert_eq!(order, [0, 59, 118, 1003]);
    }
}
