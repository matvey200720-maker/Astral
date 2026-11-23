//! Сырые блоки листов мастерской и контейнер ASB1 (этап 2 «3D на Rust»).
//!
//! Вместо WebP лист едет блоками BCn из файла игры как есть: окно заливает их в видеокарту без
//! раскодирования. Модуль — чистое ядро без чтения дисков и архивов: ему дают описание текстуры
//! (`TextureRef`) и байты ресурса, он отвечает планом (годен ли лист и с какого уровня), блоками
//! (уровни игры срезами и хвост до 1×1) и контейнером ASB1. Формат и правила выбора —
//! `docs/perf/speed-3d-rust/asb1-format.md`; эталон — `apps/desktop/src/workshop-sheet-blocks.js`.
//! Только целочисленная арифметика и фиксированный выбор: контейнеры совпадают байт в байт.

use std::io::{self, Write};
use std::sync::OnceLock;

use crate::error::{Error, Result};
use crate::texture::{Format, TextureRef};

// ------------------------------------------------------------------ константы формата

pub const MAGIC: u32 = 0x3142_5341;
pub const VERSION: u16 = 1;
pub const HEADER_BYTES: usize = 16;
pub const ENTRY_BYTES: usize = 32;
pub const ALIGN: usize = 16;
pub const MAX_LEVELS: u32 = 16;
pub const MAX_SIDE: u32 = 8192;
pub const TAIL_SIDE: u32 = 4;

/// Статус записи контейнера.
pub mod status {
    pub const OK: u8 = 0;
    pub const ABSENT: u8 = 1;
    pub const UNAVAILABLE: u8 = 2;
}

/// Вид нагрузки записи.
pub mod kind {
    pub const NONE: u8 = 0;
    pub const BCN: u8 = 1;
    pub const WEBP: u8 = 2;
    pub const RGBA: u8 = 3;
    pub const WEBP_LOSSLESS: u8 = 4;
}

pub const FLAG_ALPHA: u8 = 1;
pub const FLAG_TAIL: u8 = 2;
pub const FLAG_CACHED: u8 = 4;

/// Форматы, которые лист может нести блоками.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BlockFormat {
    Dxt1,
    Dxt3,
    Dxt5,
    Bc7,
}

impl BlockFormat {
    pub const ALL: [BlockFormat; 4] = [Self::Dxt1, Self::Dxt3, Self::Dxt5, Self::Bc7];

    pub fn of(format: Format) -> Option<Self> {
        match format {
            Format::Dxt1 => Some(Self::Dxt1),
            Format::Dxt3 => Some(Self::Dxt3),
            Format::Dxt5 => Some(Self::Dxt5),
            Format::Bc7 => Some(Self::Bc7),
            _ => None,
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|format| format.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Dxt1 => "DXT1",
            Self::Dxt3 => "DXT3",
            Self::Dxt5 => "DXT5",
            Self::Bc7 => "BC7",
        }
    }

    /// Код формата в записи: DXT1 1, DXT3 2, DXT5 3, BC7 4.
    pub fn code(self) -> u8 {
        match self {
            Self::Dxt1 => 1,
            Self::Dxt3 => 2,
            Self::Dxt5 => 3,
            Self::Bc7 => 4,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        Self::ALL.into_iter().find(|format| format.code() == code)
    }

    pub fn block_bytes(self) -> usize {
        if self == Self::Dxt1 {
            8
        } else {
            16
        }
    }

    /// Длина уровня `width × height`: блоки 4×4 с округлением вверх, не меньше одного.
    pub fn level_bytes(self, width: u32, height: u32) -> usize {
        blocks_along(width) * blocks_along(height) * self.block_bytes()
    }
}

fn blocks_along(side: u32) -> usize {
    (side as usize).div_ceil(4).max(1)
}

fn level_side(side: u32, level: u32) -> u32 {
    side.checked_shr(level).unwrap_or(0).max(1)
}

/// Полная цепочка: `floor(log2(max)) + 1` без плавающей точки.
fn full_levels(width: u32, height: u32) -> u32 {
    32 - width.max(height).leading_zeros()
}

// ------------------------------------------------------------------ план: годен ли лист

/// Форматы, которые умеет окно: набор из четырёх признаков.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Accept(u8);

impl Accept {
    /// Имена форматов; неизвестные пропускаются.
    pub fn from_names<'a>(names: impl IntoIterator<Item = &'a str>) -> Self {
        names
            .into_iter()
            .filter_map(BlockFormat::from_name)
            .fold(Accept(0), |set, format| Accept(set.0 | Self::bit(format)))
    }

    fn bit(format: BlockFormat) -> u8 {
        match format {
            BlockFormat::Bc7 => 1,
            BlockFormat::Dxt1 => 2,
            BlockFormat::Dxt3 => 4,
            BlockFormat::Dxt5 => 8,
        }
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub fn allows(self, format: BlockFormat) -> bool {
        self.0 & Self::bit(format) != 0
    }

    /// Имена по алфавиту через запятую: часть ключа кэша (`BC7,DXT1,DXT3,DXT5`).
    pub fn key(self) -> String {
        [
            BlockFormat::Bc7,
            BlockFormat::Dxt1,
            BlockFormat::Dxt3,
            BlockFormat::Dxt5,
        ]
        .into_iter()
        .filter(|format| self.allows(*format))
        .map(BlockFormat::name)
        .collect::<Vec<_>>()
        .join(",")
    }
}

/// Карта нормалей или блеска: такие листы блоками не идут.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapKind {
    Normal,
    Specular,
}

/// Причина отказа сжатому пути (короткий код).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Accept,
    Map,
    Format,
    Incomplete,
    TooLarge,
    NotMultipleOf4,
    ShortChain,
}

impl Refusal {
    pub fn code(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Map => "map",
            Self::Format => "format",
            Self::Incomplete => "incomplete",
            Self::TooLarge => "too-large",
            Self::NotMultipleOf4 => "not-multiple-of-4",
            Self::ShortChain => "short-chain",
        }
    }
}

/// Какие уровни отправлять: `width`, `height` — размер первого отправляемого уровня.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub first_level: u32,
    pub levels: u32,
    pub width: u32,
    pub height: u32,
    pub format: BlockFormat,
}

/// Годен ли лист для сжатого пути. Проверки идут по порядку, первая сработавшая даёт код;
/// `size` — запрошенная большая сторона (первый уровень, у которого она не больше `size`).
pub fn plan(
    reference: &TextureRef,
    size: u32,
    accept: Accept,
    map: Option<MapKind>,
) -> std::result::Result<Plan, Refusal> {
    if accept.is_empty() {
        return Err(Refusal::Accept);
    }
    if map.is_some() {
        return Err(Refusal::Map);
    }
    let format = reference
        .format
        .and_then(BlockFormat::of)
        .filter(|format| accept.allows(*format))
        .ok_or(Refusal::Format)?;
    if !reference.complete {
        return Err(Refusal::Incomplete);
    }
    if reference.levels > MAX_LEVELS || reference.width > MAX_SIDE || reference.height > MAX_SIDE {
        return Err(Refusal::TooLarge);
    }

    let last = reference.levels - 1;
    let mut first_level = 0;
    if size > 0 {
        while first_level < last
            && (reference.width >> first_level).max(reference.height >> first_level) > size
        {
            first_level += 1;
        }
    }
    let width = level_side(reference.width, first_level);
    let height = level_side(reference.height, first_level);
    if width % 4 != 0 || height % 4 != 0 {
        return Err(Refusal::NotMultipleOf4);
    }
    // Уровней в файле бывает больше, чем помещается до 1×1 (повторы 1×1): лишние не берём.
    let levels = (reference.levels - first_level).min(full_levels(width, height));
    let last_width = level_side(width, levels - 1);
    let last_height = level_side(height, levels - 1);
    if last_width.min(last_height) > TAIL_SIDE {
        return Err(Refusal::ShortChain);
    }
    Ok(Plan {
        first_level,
        levels,
        width,
        height,
        format,
    })
}

// ------------------------------------------------------------------ одноцветный блок

/// Таблица концов DXT1 для одноцветного блока: целевое значение канала → пара кодов `(a << 6) | b`.
///
/// Цвет концов — расширение кода до 8 бит, индекс 2 даёт `(2·E(a) + E(b)) / 3`. Видеокарты
/// округляют третью по-разному, поэтому берётся пара, у которой худшая из двух крайних ошибок
/// (`low = x div 3`, `high = (x + 2) div 3`) наименьшая; ключ — `(худшая, |x − 3v|, |E(a) − E(b)|,
/// a, b)` лексикографически, замена только при строго меньшем ключе.
fn pair_table(bits: u32) -> [u16; 256] {
    let count = 1i64 << bits;
    let expand: Vec<i64> = (0..count)
        .map(|code| {
            if bits == 5 {
                (code << 3) | (code >> 2)
            } else {
                (code << 2) | (code >> 4)
            }
        })
        .collect();
    let mut table = [0u16; 256];
    for (target, slot) in table.iter_mut().enumerate() {
        let target = target as i64;
        let mut best_key = i64::MAX;
        let mut best_pair = 0u16;
        for a in 0..count {
            for b in 0..count {
                let x = 2 * expand[a as usize] + expand[b as usize];
                let low = x / 3;
                let high = (x + 2) / 3;
                let first = (low - target).abs().max((high - target).abs());
                let key = (((first * 1024 + (x - 3 * target).abs()) * 256
                    + (expand[a as usize] - expand[b as usize]).abs())
                    * 4096)
                    + a * count
                    + b;
                if key < best_key {
                    best_key = key;
                    best_pair = ((a << 6) | b) as u16;
                }
            }
        }
        *slot = best_pair;
    }
    table
}

struct Pairs {
    five: [u16; 256],
    six: [u16; 256],
}

fn pairs() -> &'static Pairs {
    static PAIRS: OnceLock<Pairs> = OnceLock::new();
    PAIRS.get_or_init(|| Pairs {
        five: pair_table(5),
        six: pair_table(6),
    })
}

/// Блок цвета DXT1 (8 байт) одним цветом.
fn dxt1_color_block(r: u8, g: u8, b: u8) -> [u8; 8] {
    let pairs = pairs();
    let rp = u32::from(pairs.five[usize::from(r)]);
    let gp = u32::from(pairs.six[usize::from(g)]);
    let bp = u32::from(pairs.five[usize::from(b)]);
    let mut c0 = ((rp >> 6) << 11) | ((gp >> 6) << 5) | (bp >> 6);
    let mut c1 = ((rp & 63) << 11) | ((gp & 63) << 5) | (bp & 63);
    // Индекс 2 у всех шестнадцати пикселей: (2·c0 + c1) / 3.
    let mut indices = 0xaaaa_aaaau32;
    if c0 < c1 {
        std::mem::swap(&mut c0, &mut c1);
        // После обмена то же значение — индекс 3: (c0 + 2·c1) / 3.
        indices = 0xffff_ffff;
    } else if c0 == c1 {
        // Равные концы: индекс 0, сам цвет.
        indices = 0;
    }
    let mut block = [0u8; 8];
    block[0..2].copy_from_slice(&(c0 as u16).to_le_bytes());
    block[2..4].copy_from_slice(&(c1 as u16).to_le_bytes());
    block[4..8].copy_from_slice(&indices.to_le_bytes());
    block
}

/// Блок BC7 режима 6 с равными концами: у канала 7 бит и общий p-бит конца (значение = код·2 + p);
/// p равен младшему биту альфы, поэтому альфа точна, а цвет — с ошибкой не больше 1.
fn bc7_solid_block(r: u8, g: u8, b: u8, a: u8) -> [u8; 16] {
    let p = u32::from(a & 1);
    let mut block = [0u8; 16];
    let mut at = 0usize;
    let mut put = |value: u32, count: u32| {
        for i in 0..count {
            if (value >> i) & 1 != 0 {
                block[at >> 3] |= 1 << (at & 7);
            }
            at += 1;
        }
    };
    put(64, 7); // режим 6: шесть нулей и единица
    for channel in [r, g, b, a] {
        put(u32::from(channel >> 1), 7);
        put(u32::from(channel >> 1), 7);
    }
    put(p, 1);
    put(p, 1);
    block // 63 бита индексов — нули
}

/// Один блок, залитый одним цветом `[r, g, b, a]`: DXT1 — цвет по таблице концов (альфа не
/// кодируется: блок непрозрачный), DXT3 — альфа ближайшими четырьмя битами (`(a + 8) div 17`),
/// DXT5 — альфа обоими концами, BC7 — режим 6 с равными концами.
pub fn solid_block(format: BlockFormat, rgba: [u8; 4]) -> Vec<u8> {
    let [r, g, b, a] = rgba;
    match format {
        BlockFormat::Bc7 => bc7_solid_block(r, g, b, a).to_vec(),
        BlockFormat::Dxt1 => dxt1_color_block(r, g, b).to_vec(),
        BlockFormat::Dxt3 => {
            let nibble = ((u16::from(a) + 8) / 17) as u8;
            let mut block = vec![nibble | (nibble << 4); 8];
            block.extend_from_slice(&dxt1_color_block(r, g, b));
            block
        }
        BlockFormat::Dxt5 => {
            let mut block = vec![a, a, 0, 0, 0, 0, 0, 0];
            block.extend_from_slice(&dxt1_color_block(r, g, b));
            block
        }
    }
}

// ------------------------------------------------------------------ декод для среднего цвета

/// RGB565 → RGB8 с расширением битов.
fn expand565(code: u16) -> [i32; 3] {
    let r5 = i32::from(code >> 11) & 31;
    let g6 = i32::from(code >> 5) & 63;
    let b5 = i32::from(code) & 31;
    [
        (r5 << 3) | (r5 >> 2),
        (g6 << 2) | (g6 >> 4),
        (b5 << 3) | (b5 >> 2),
    ]
}

/// Четыре цвета блока цвета DXT: RGBA по индексам. `opaque` — DXT3/DXT5 (всегда четыре цвета).
fn color_palette(block: &[u8], opaque: bool) -> [[u8; 4]; 4] {
    let c0 = u16::from_le_bytes([block[0], block[1]]);
    let c1 = u16::from_le_bytes([block[2], block[3]]);
    let p0 = expand565(c0);
    let p1 = expand565(c1);
    let rgb = |values: [i32; 3]| [values[0] as u8, values[1] as u8, values[2] as u8, 255];
    let mix = |wa: i32, wb: i32| {
        // `(wa·p0 + wb·p1 + 2) div 3`: деление на три с округлением до ближайшего целого.
        [0, 1, 2].map(|c| (wa * p0[c] + wb * p1[c] + 2) / 3)
    };
    if opaque || c0 > c1 {
        [rgb(p0), rgb(p1), rgb(mix(2, 1)), rgb(mix(1, 2))]
    } else {
        // Трёхцветный режим: середина — до ближайшего, ничья к чётному; индекс 3 — прозрачный чёрный.
        let half = [0, 1, 2].map(|c| {
            let sum = p0[c] + p1[c];
            let down = sum / 2;
            if sum % 2 == 0 || down % 2 == 0 {
                down
            } else {
                down + 1
            }
        });
        [rgb(p0), rgb(p1), rgb(half), [0, 0, 0, 0]]
    }
}

/// Палитра альфы DXT5: округление `round(num / d) = (2·num + d) div (2·d)`.
fn dxt5_alpha_palette(a0: u8, a1: u8) -> [u8; 8] {
    let (a0, a1) = (i32::from(a0), i32::from(a1));
    let mut palette = [0u8; 8];
    palette[0] = a0 as u8;
    palette[1] = a1 as u8;
    if a0 > a1 {
        for i in 1..7 {
            palette[i as usize + 1] = ((2 * ((7 - i) * a0 + i * a1) + 7) / 14) as u8;
        }
    } else {
        for i in 1..5 {
            palette[i as usize + 1] = ((2 * ((5 - i) * a0 + i * a1) + 5) / 10) as u8;
        }
        palette[6] = 0;
        palette[7] = 255;
    }
    palette
}

/// Пиксели блока 4×4 в порядке `k = 4·y + x`.
fn decode_block(format: BlockFormat, block: &[u8]) -> [[u8; 4]; 16] {
    let mut pixels = [[0u8; 4]; 16];
    match format {
        BlockFormat::Dxt1 => {
            let palette = color_palette(block, false);
            let indices = u32::from_le_bytes([block[4], block[5], block[6], block[7]]);
            for (k, pixel) in pixels.iter_mut().enumerate() {
                *pixel = palette[((indices >> (2 * k)) & 3) as usize];
            }
        }
        BlockFormat::Dxt3 => {
            let palette = color_palette(&block[8..16], true);
            let indices = u32::from_le_bytes([block[12], block[13], block[14], block[15]]);
            for (k, pixel) in pixels.iter_mut().enumerate() {
                let nibble = (block[k >> 1] >> (4 * (k & 1))) & 15;
                *pixel = palette[((indices >> (2 * k)) & 3) as usize];
                pixel[3] = 17 * nibble;
            }
        }
        BlockFormat::Dxt5 => {
            let palette = color_palette(&block[8..16], true);
            let indices = u32::from_le_bytes([block[12], block[13], block[14], block[15]]);
            let alpha = dxt5_alpha_palette(block[0], block[1]);
            let halves = [
                u32::from(block[2]) | (u32::from(block[3]) << 8) | (u32::from(block[4]) << 16),
                u32::from(block[5]) | (u32::from(block[6]) << 8) | (u32::from(block[7]) << 16),
            ];
            for (k, pixel) in pixels.iter_mut().enumerate() {
                let bits = halves[k >> 3] >> (3 * (k & 7));
                *pixel = palette[((indices >> (2 * k)) & 3) as usize];
                pixel[3] = alpha[(bits & 7) as usize];
            }
        }
        BlockFormat::Bc7 => {
            let mut tile = [0u8; 64];
            bcdec_rs::bc7(block, &mut tile, 16);
            for (k, pixel) in pixels.iter_mut().enumerate() {
                let at = (k / 4) * 16 + (k % 4) * 4;
                pixel.copy_from_slice(&tile[at..at + 4]);
            }
        }
    }
    pixels
}

/// Средний цвет уровня `width × height`: по каждому каналу `(2·s + n) div (2·n)`, где `s` — сумма
/// по пикселям, `n` — их число. Пиксели блоков за краем уровня отбрасываются; RGB не умножается на альфу.
pub fn average_colour(format: BlockFormat, data: &[u8], width: u32, height: u32) -> [u8; 4] {
    let across = blocks_along(width);
    let down = blocks_along(height);
    let step = format.block_bytes();
    let mut sums = [0u64; 4];
    for by in 0..down {
        for bx in 0..across {
            let at = (by * across + bx) * step;
            let Some(block) = data.get(at..at + step) else {
                continue;
            };
            let pixels = decode_block(format, block);
            for (k, pixel) in pixels.iter().enumerate() {
                if bx * 4 + k % 4 >= width as usize || by * 4 + k / 4 >= height as usize {
                    continue;
                }
                for c in 0..4 {
                    sums[c] += u64::from(pixel[c]);
                }
            }
        }
    }
    let n = u64::from(width) * u64::from(height);
    sums.map(|sum| ((2 * sum + n) / (2 * n)) as u8)
}

// ------------------------------------------------------------------ признак альфы

fn dxt1_has_alpha(data: &[u8]) -> bool {
    data.chunks_exact(8).any(|block| {
        let c0 = u16::from_le_bytes([block[0], block[1]]);
        let c1 = u16::from_le_bytes([block[2], block[3]]);
        if c0 > c1 {
            return false;
        }
        let word = u32::from_le_bytes([block[4], block[5], block[6], block[7]]);
        word & (word >> 1) & 0x5555_5555 != 0
    })
}

fn dxt3_has_alpha(data: &[u8]) -> bool {
    data.chunks_exact(16)
        .any(|block| block[..8].iter().any(|&byte| byte != 255))
}

/// Маска индексов альфы DXT5, которым соответствует полное значение 255.
fn dxt5_opaque_mask(a0: u8, a1: u8) -> u8 {
    let palette = dxt5_alpha_palette(a0, a1);
    palette
        .iter()
        .enumerate()
        .fold(0u8, |mask, (index, &value)| {
            mask | (u8::from(value == 255) << index)
        })
}

fn dxt5_has_alpha(data: &[u8]) -> bool {
    data.chunks_exact(16).any(|block| {
        let mask = dxt5_opaque_mask(block[0], block[1]);
        if mask == 255 {
            return false;
        }
        (0..2).any(|half| {
            let base = 2 + half * 3;
            let bits = u32::from(block[base])
                | (u32::from(block[base + 1]) << 8)
                | (u32::from(block[base + 2]) << 16);
            (0..8).any(|texel| (mask >> ((bits >> (texel * 3)) & 7)) & 1 == 0)
        })
    })
}

/// `count` бит блока с бита `from`, младшие вперёд (раскладка BC7).
fn bits_of(block: &[u8], from: usize, count: usize) -> u32 {
    (0..count).fold(0u32, |value, i| {
        let at = from + i;
        value | ((u32::from(block[at >> 3]) >> (at & 7)) & 1) << i
    })
}

/// Блок BC7 наверняка непрозрачен по режиму и концам альфы (иначе его надо разбирать).
fn bc7_block_opaque(block: &[u8]) -> bool {
    let lead = block[0];
    if lead == 0 {
        return false;
    }
    let mode = lead.trailing_zeros();
    match mode {
        0..=3 => true,
        4 => {
            let rotation = bits_of(block, 5, 2);
            if rotation == 0 {
                return bits_of(block, 38, 6) == 63 && bits_of(block, 44, 6) == 63;
            }
            // Поворот: альфа блока — цветовой канал `rotation − 1`; концы по 5 бит с бита 8 + 10·канал.
            let from = 8 + (rotation as usize - 1) * 10;
            bits_of(block, from, 5) == 31 && bits_of(block, from + 5, 5) == 31
        }
        5 => {
            let rotation = bits_of(block, 6, 2);
            if rotation == 0 {
                return bits_of(block, 50, 8) == 255 && bits_of(block, 58, 8) == 255;
            }
            let from = 8 + (rotation as usize - 1) * 14;
            bits_of(block, from, 7) == 127 && bits_of(block, from + 7, 7) == 127
        }
        6 => {
            ((bits_of(block, 49, 7) << 1) | bits_of(block, 63, 1)) == 255
                && ((bits_of(block, 56, 7) << 1) | bits_of(block, 64, 1)) == 255
        }
        _ => (0..4).all(|point| {
            ((bits_of(block, 74 + point * 5, 5) << 1) | bits_of(block, 94 + point, 1)) == 63
        }),
    }
}

fn bc7_has_alpha(data: &[u8]) -> bool {
    data.chunks_exact(16).any(|block| {
        if bc7_block_opaque(block) {
            return false;
        }
        decode_block(BlockFormat::Bc7, block)
            .iter()
            .any(|pixel| pixel[3] != 255)
    })
}

/// Есть ли альфа в блоках одного уровня: прозрачные или полупрозрачные пиксели.
pub fn blocks_have_alpha(format: BlockFormat, data: &[u8]) -> bool {
    match format {
        BlockFormat::Dxt1 => dxt1_has_alpha(data),
        BlockFormat::Dxt3 => dxt3_has_alpha(data),
        BlockFormat::Dxt5 => dxt5_has_alpha(data),
        BlockFormat::Bc7 => bc7_has_alpha(data),
    }
}

// ------------------------------------------------------------------ блоки листа

/// Уровень нагрузки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Level {
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
}

/// Блоки листа: уровни подряд от большого к малому.
#[derive(Debug, Clone)]
pub struct Sheet {
    pub format: BlockFormat,
    pub width: u32,
    pub height: u32,
    pub levels: Vec<Level>,
    pub data: Vec<u8>,
    pub alpha: bool,
    pub synthesized: u32,
    pub first_level: u32,
    pub game_width: u32,
    pub game_height: u32,
}

/// Блоки листа по плану `plan(...)`. Уровни игры — срезы `data` байт в байт; если цепочка игры
/// кончается выше 1×1, хвост достраивается: каждый достроенный уровень залит одним блоком одного
/// цвета, среднего по последнему уровню игры. `data` — разжатые байты ресурса, `reference.data_at` — в них.
pub fn blocks(reference: &TextureRef, data: &[u8], plan: &Plan) -> Result<Sheet> {
    let Plan {
        first_level,
        levels: game_levels,
        width,
        height,
        format,
    } = *plan;
    let data_at = reference
        .data_at
        .ok_or_else(|| Error::broken("У листа нет данных."))?;
    let mut levels = Vec::new();
    let mut slices: Vec<&[u8]> = Vec::new();
    for k in 0..game_levels {
        let span = reference
            .spans
            .get((first_level + k) as usize)
            .ok_or_else(|| Error::broken("Уровень листа не описан."))?;
        let start = data_at + span.offset;
        let slice = data
            .get(start..start + span.bytes)
            .ok_or_else(|| Error::broken("Уровень листа за концом данных."))?;
        levels.push(Level {
            width: level_side(width, k),
            height: level_side(height, k),
            bytes: span.bytes,
        });
        slices.push(slice);
    }

    let total = full_levels(width, height);
    let synthesized = total - game_levels;
    let mut tail = None;
    if synthesized > 0 {
        let last = levels[game_levels as usize - 1];
        let colour = average_colour(
            format,
            slices[game_levels as usize - 1],
            last.width,
            last.height,
        );
        tail = Some(solid_block(format, colour));
        for k in game_levels..total {
            let (w, h) = (level_side(width, k), level_side(height, k));
            levels.push(Level {
                width: w,
                height: h,
                bytes: blocks_along(w) * blocks_along(h) * format.block_bytes(),
            });
        }
    }

    let bytes: usize = levels.iter().map(|level| level.bytes).sum();
    let mut out = Vec::with_capacity(bytes);
    for slice in &slices {
        out.extend_from_slice(slice);
    }
    if let Some(tail) = &tail {
        for level in &levels[game_levels as usize..] {
            for _ in 0..level.bytes / tail.len() {
                out.extend_from_slice(tail);
            }
        }
    }
    let alpha = blocks_have_alpha(format, slices[0]);
    Ok(Sheet {
        format,
        width,
        height,
        levels,
        data: out,
        alpha,
        synthesized,
        first_level,
        game_width: reference.width,
        game_height: reference.height,
    })
}

// ------------------------------------------------------------------ контейнер ASB1

/// Запись контейнера без нагрузки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Record {
    pub status: u8,
    pub kind: u8,
    pub format: u8,
    pub levels: u8,
    pub width: u16,
    pub height: u16,
    pub game_width: u16,
    pub game_height: u16,
    pub first_level: u8,
    pub flags: u8,
    pub synthesized: u32,
}

impl Record {
    const EMPTY: Record = Record {
        status: status::OK,
        kind: kind::NONE,
        format: 0,
        levels: 0,
        width: 0,
        height: 0,
        game_width: 0,
        game_height: 0,
        first_level: 0,
        flags: 0,
        synthesized: 0,
    };

    /// Листа нет окончательно: без нагрузки.
    pub fn absent() -> Record {
        Record {
            status: status::ABSENT,
            ..Self::EMPTY
        }
    }

    /// Лист не удалось получить сейчас: без нагрузки.
    pub fn unavailable() -> Record {
        Record {
            status: status::UNAVAILABLE,
            ..Self::EMPTY
        }
    }

    /// Файл WebP как есть (или WebP без потерь); размер, если известен, иначе нули.
    pub fn webp(lossless: bool, width: u16, height: u16, cached: bool) -> Record {
        Record {
            kind: if lossless {
                kind::WEBP_LOSSLESS
            } else {
                kind::WEBP
            },
            width,
            height,
            flags: if cached { FLAG_CACHED } else { 0 },
            ..Self::EMPTY
        }
    }

    /// Сырой RGBA8 `width · height · 4` байт.
    pub fn rgba(width: u16, height: u16, cached: bool) -> Record {
        Record {
            kind: kind::RGBA,
            width,
            height,
            flags: if cached { FLAG_CACHED } else { 0 },
            ..Self::EMPTY
        }
    }

    /// Запись блоков листа; проверяет, что уровни сходятся с данными.
    pub fn blocks(sheet: &Sheet, cached: bool) -> Result<Record> {
        let mut sum = 0usize;
        for (k, level) in sheet.levels.iter().enumerate() {
            let k = k as u32;
            if level.width != level_side(sheet.width, k)
                || level.height != level_side(sheet.height, k)
                || level.bytes != sheet.format.level_bytes(level.width, level.height)
            {
                return Err(Error::broken(
                    "Уровень листа не сходится с размерами и форматом.",
                ));
            }
            sum += level.bytes;
        }
        if sum != sheet.data.len() {
            return Err(Error::broken("Байты уровней не сходятся с данными."));
        }
        if sheet.levels.is_empty() || sheet.levels.len() > MAX_LEVELS as usize {
            return Err(Error::broken("Число уровней листа вне 1…16."));
        }
        let dimension = |value: u32| {
            u16::try_from(value).map_err(|_| Error::broken("Размер листа не помещается в 16 бит."))
        };
        let flags = (if sheet.alpha { FLAG_ALPHA } else { 0 })
            | (if sheet.synthesized > 0 { FLAG_TAIL } else { 0 })
            | (if cached { FLAG_CACHED } else { 0 });
        Ok(Record {
            kind: kind::BCN,
            format: sheet.format.code(),
            levels: sheet.levels.len() as u8,
            width: dimension(sheet.width)?,
            height: dimension(sheet.height)?,
            game_width: dimension(sheet.game_width)?,
            game_height: dimension(sheet.game_height)?,
            first_level: sheet.first_level as u8,
            flags,
            synthesized: sheet.synthesized,
            ..Self::EMPTY
        })
    }

    /// Та же запись с битом «из кэша».
    pub fn cached(self) -> Record {
        Record {
            flags: self.flags | FLAG_CACHED,
            ..self
        }
    }

    /// Та же запись без бита «из кэша»: так лежит файл кэша.
    pub fn uncached(self) -> Record {
        Record {
            flags: self.flags & !FLAG_CACHED,
            ..self
        }
    }
}

fn align_up(value: usize) -> usize {
    value.div_ceil(ALIGN) * ALIGN
}

/// Длина контейнера для нагрузок данных длин.
pub fn container_len(payloads: impl IntoIterator<Item = usize>) -> usize {
    let mut count = 0usize;
    let mut end = 0usize;
    for length in payloads {
        count += 1;
        if length > 0 {
            end = align_up(end + length);
        }
    }
    HEADER_BYTES + ENTRY_BYTES * count + end
}

/// Пишет контейнер ASB1: заголовок, по записи на лист, нагрузки с заполнением до 16 нулями.
/// Нагрузка нулевой длины считается «нет нагрузки» (`offset = 0`, `length = 0`).
pub fn write_container(out: &mut impl Write, items: &[(Record, &[u8])]) -> io::Result<()> {
    let payload_start = HEADER_BYTES + ENTRY_BYTES * items.len();
    let mut header = Vec::with_capacity(payload_start);
    header.extend_from_slice(&MAGIC.to_le_bytes());
    header.extend_from_slice(&VERSION.to_le_bytes());
    header.extend_from_slice(&(ENTRY_BYTES as u16).to_le_bytes());
    header.extend_from_slice(&(items.len() as u32).to_le_bytes());
    header.extend_from_slice(&(payload_start as u32).to_le_bytes());
    let mut end = 0usize;
    for (record, payload) in items {
        let (offset, length) = if payload.is_empty() {
            (0usize, 0usize)
        } else {
            let at = end;
            end = align_up(end + payload.len());
            (at, payload.len())
        };
        header.extend_from_slice(&[record.status, record.kind, record.format, record.levels]);
        header.extend_from_slice(&record.width.to_le_bytes());
        header.extend_from_slice(&record.height.to_le_bytes());
        header.extend_from_slice(&record.game_width.to_le_bytes());
        header.extend_from_slice(&record.game_height.to_le_bytes());
        header.extend_from_slice(&[record.first_level, record.flags, 0, 0]);
        header.extend_from_slice(&(offset as u32).to_le_bytes());
        header.extend_from_slice(&(length as u32).to_le_bytes());
        header.extend_from_slice(&record.synthesized.to_le_bytes());
        header.extend_from_slice(&0u32.to_le_bytes());
    }
    out.write_all(&header)?;
    const ZEROS: [u8; ALIGN] = [0; ALIGN];
    for (_, payload) in items {
        if payload.is_empty() {
            continue;
        }
        out.write_all(payload)?;
        out.write_all(&ZEROS[..align_up(payload.len()) - payload.len()])?;
    }
    Ok(())
}

/// Контейнер целиком в одном буфере.
pub fn pack(items: &[(Record, &[u8])]) -> Vec<u8> {
    let mut out = Vec::with_capacity(container_len(
        items.iter().map(|(_, payload)| payload.len()),
    ));
    write_container(&mut out, items).expect("запись в память не отказывает");
    out
}

/// Файл кэша читателя: контейнер ровно с одной записью. Запись и срез нагрузки.
#[derive(Debug, Clone, Copy)]
pub struct Single<'a> {
    pub record: Record,
    pub payload: &'a [u8],
}

fn le16(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn le32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Разбор файла кэша: `None` — файл битый, чужой, оборванный, с другим числом записей, с отказом
/// вместо листа или с рассогласованной нагрузкой (вызывающий считает «нет в кэше» и удаляет файл).
/// Запись возвращается так, как её собирает читатель: лишние поля обнулены, бит «из кэша» стоит.
pub fn parse_single(bytes: &[u8]) -> Option<Single<'_>> {
    const PAYLOAD_START: usize = HEADER_BYTES + ENTRY_BYTES;
    if bytes.len() < PAYLOAD_START
        || le32(bytes, 0) != MAGIC
        || le16(bytes, 4) != VERSION
        || usize::from(le16(bytes, 6)) != ENTRY_BYTES
        || le32(bytes, 8) != 1
        || le32(bytes, 12) as usize != PAYLOAD_START
    {
        return None;
    }
    let at = HEADER_BYTES;
    let (state, kind_code, format_code, level_count) =
        (bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    let width = le16(bytes, at + 4);
    let height = le16(bytes, at + 6);
    let flags = bytes[at + 13];
    let offset = le32(bytes, at + 16) as usize;
    let length = le32(bytes, at + 20) as usize;
    if state != status::OK
        || !(kind::BCN..=kind::WEBP_LOSSLESS).contains(&kind_code)
        || offset != 0
        || length == 0
    {
        return None;
    }
    if bytes.len() != PAYLOAD_START + align_up(length) {
        return None;
    }
    let payload = &bytes[PAYLOAD_START..PAYLOAD_START + length];
    match kind_code {
        kind::WEBP | kind::WEBP_LOSSLESS => Some(Single {
            record: Record::webp(kind_code == kind::WEBP_LOSSLESS, width, height, true),
            payload,
        }),
        kind::RGBA => (length == usize::from(width) * usize::from(height) * 4).then(|| Single {
            record: Record::rgba(width, height, true),
            payload,
        }),
        _ => {
            let format = BlockFormat::from_code(format_code)?;
            let synthesized = le32(bytes, at + 24);
            if level_count < 1
                || u32::from(level_count) > MAX_LEVELS
                || synthesized > u32::from(level_count)
            {
                return None;
            }
            let (w, h) = (u32::from(width), u32::from(height));
            if w < 4 || h < 4 || w > MAX_SIDE || h > MAX_SIDE || w % 4 != 0 || h % 4 != 0 {
                return None;
            }
            let sum: usize = (0..u32::from(level_count))
                .map(|k| format.level_bytes(level_side(w, k), level_side(h, k)))
                .sum();
            if sum != length {
                return None;
            }
            Some(Single {
                record: Record {
                    kind: kind::BCN,
                    format: format_code,
                    levels: level_count,
                    width,
                    height,
                    game_width: le16(bytes, at + 8),
                    game_height: le16(bytes, at + 10),
                    first_level: bytes[at + 12],
                    flags: (flags & FLAG_ALPHA)
                        | (if synthesized > 0 { FLAG_TAIL } else { 0 })
                        | FLAG_CACHED,
                    synthesized,
                    ..Record::EMPTY
                },
                payload,
            })
        }
    }
}

#[cfg(test)]
mod tests;
