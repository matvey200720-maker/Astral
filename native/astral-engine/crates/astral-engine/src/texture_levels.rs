//! Текстура со ступенями: как формат превращается в пиксели RGBA и обратно,
//! усреднение по площади, срез верхних ступеней и пересжатие цепочки.

use std::ops::Range;

use rage_res::{texture::Format, ytd_write};

mod limit {
    /// Больше этой стороны пересжатие текстуру не берёт.
    pub const SIDE: usize = 8192;
    /// Шаг строки в записи занимает 16 бит.
    pub const STRIDE: usize = 65535;
}

/// Запись с открытыми полями: атрибуты и пары «имя, тип» задаёт вызов.
/// `Eq` объявляется отдельно от остальных свойств.
macro_rules! open_record {
    ($(#[$attr:meta])* $name:ident { $(($field:ident, $kind:ty)),+ $(,)? }) => {
        $(#[$attr])*
        pub struct $name {
            $(pub $field: $kind),+
        }

        impl Eq for $name {}
    };
}

open_record! {
    /// Текстура целиком: описание и подряд лежащие данные всех ступеней.
    #[derive(Debug, Clone, PartialEq)]
    Level {
        (name, String),
        (format, Format),
        (width, usize),
        (height, usize),
        (stride, usize),
        (levels, usize),
        (depth, usize),
        (data, Vec<u8>),
    }
}

/// Размер ступени в точках: ширина и высота.
type Side = (usize, usize);

/// Как формат лежит в байтах ступени и как переводится в RGBA и обратно.
trait Storage: Sync {
    /// Наименьшая сторона ступени.
    fn floor(&self) -> usize;
    fn weigh(&self, side: Side) -> usize;
    fn unpack(&self, data: &[u8], side: Side) -> Result<Vec<u8>, String>;
    fn pack(&self, rgba: &[u8], side: Side) -> Result<Vec<u8>, String>;
}

/// Блоки 4×4 через внешний кодек: вес блока и коды DXGI для чтения и записи.
struct Blocks<const WEIGHT: usize, const READ: u32, const WRITE: u32>;

impl<const WEIGHT: usize, const READ: u32, const WRITE: u32> Storage
    for Blocks<WEIGHT, READ, WRITE>
{
    fn floor(&self) -> usize {
        4
    }

    fn weigh(&self, (width, height): Side) -> usize {
        WEIGHT
            * [width, height]
                .into_iter()
                .map(|side| side.div_ceil(4))
                .product::<usize>()
    }

    fn unpack(&self, data: &[u8], (width, height): Side) -> Result<Vec<u8>, String> {
        let mut rgba = vec![0u8; width * height * 4];
        astral_codec::decode(READ, data, width, height, &mut rgba)
            .map(|()| rgba)
            .map_err(|code| format!("код {code}"))
    }

    fn pack(&self, rgba: &[u8], (width, height): Side) -> Result<Vec<u8>, String> {
        let mut packed = vec![0u8; self.weigh((width, height))];
        astral_codec::encode(WRITE, rgba, width, height, &mut packed)
            .map(|()| packed)
            .map_err(|code| format!("код {code}"))
    }
}

/// Источник канала RGBA при разжатии несжатого формата.
#[derive(Clone, Copy)]
enum Tap {
    /// Байт пикселя с таким номером.
    Byte(usize),
    /// Готовое значение.
    Fixed(u8),
}

/// Несжатый формат: что идёт в каналы RGBA и какие каналы пишутся в байты пикселя.
struct Pixels {
    taps: [Tap; 4],
    back: &'static [usize],
}

impl Storage for Pixels {
    fn floor(&self) -> usize {
        1
    }

    fn weigh(&self, side: Side) -> usize {
        side.0 * side.1 * self.back.len()
    }

    fn unpack(&self, data: &[u8], _: Side) -> Result<Vec<u8>, String> {
        let pixels = data.chunks_exact(self.back.len());
        let leftover = pixels.remainder();
        let mut rgba: Vec<u8> = pixels
            .flat_map(|pixel| {
                self.taps.map(|tap| match tap {
                    Tap::Byte(at) => pixel[at],
                    Tap::Fixed(value) => value,
                })
            })
            .collect();
        rgba.extend_from_slice(leftover);
        Ok(rgba)
    }

    fn pack(&self, rgba: &[u8], _: Side) -> Result<Vec<u8>, String> {
        let quads = rgba.chunks_exact(4);
        let leftover = if self.back.len() == 4 {
            quads.remainder()
        } else {
            &[]
        };
        let mut packed: Vec<u8> = quads
            .flat_map(|quad| self.back.iter().map(move |&channel| quad[channel]))
            .collect();
        packed.extend_from_slice(leftover);
        Ok(packed)
    }
}

/// Строки таблицы форматов: что читается, в каком формате пишется и как хранится.
type Row = (Format, Format, &'static dyn Storage);

static ROWS: [Row; 11] = [
    (Format::Dxt1, Format::Dxt1, &Blocks::<8, 71, 71>),
    (Format::Dxt3, Format::Dxt3, &Blocks::<16, 74, 74>),
    (Format::Dxt5, Format::Dxt5, &Blocks::<16, 77, 77>),
    (Format::Ati1, Format::Ati1, &Blocks::<8, 80, 80>),
    (Format::Ati2, Format::Ati2, &Blocks::<16, 83, 83>),
    // BC7 читается как BC7, а пишется как BC3: вес блока у них один.
    (Format::Bc7, Format::Dxt5, &Blocks::<16, 98, 77>),
    (
        Format::A8R8G8B8,
        Format::A8R8G8B8,
        &Pixels {
            taps: [Tap::Byte(2), Tap::Byte(1), Tap::Byte(0), Tap::Byte(3)],
            back: &[2, 1, 0, 3],
        },
    ),
    (
        Format::X8R8G8B8,
        Format::X8R8G8B8,
        &Pixels {
            taps: [Tap::Byte(2), Tap::Byte(1), Tap::Byte(0), Tap::Byte(3)],
            back: &[2, 1, 0, 3],
        },
    ),
    (
        Format::A8B8G8R8,
        Format::A8B8G8R8,
        &Pixels {
            taps: [Tap::Byte(0), Tap::Byte(1), Tap::Byte(2), Tap::Byte(3)],
            back: &[0, 1, 2, 3],
        },
    ),
    (
        Format::L8,
        Format::L8,
        &Pixels {
            taps: [Tap::Byte(0), Tap::Byte(0), Tap::Byte(0), Tap::Fixed(255)],
            back: &[0],
        },
    ),
    (
        Format::A8,
        Format::A8,
        &Pixels {
            taps: [Tap::Fixed(0), Tap::Fixed(0), Tap::Fixed(0), Tap::Byte(0)],
            back: &[3],
        },
    ),
];

/// Кодек одного формата. Собрать его можно только через `codec_of`.
#[derive(Debug, Clone, PartialEq)]
pub struct Codec {
    /// Номер строки таблицы форматов.
    row: usize,
    #[doc = "Формат, в котором кодек пишет результат."]
    pub output: Format,
    #[doc = "Наименьшая сторона ступени."]
    pub min: usize,
}

impl Eq for Codec {}
impl Copy for Codec {}

pub fn codec_of(format: Format) -> Option<Codec> {
    let row = ROWS.iter().position(|entry| entry.0 == format)?;
    Some(Codec {
        row,
        output: ROWS[row].1,
        min: ROWS[row].2.floor(),
    })
}

pub fn is_block_compressed(format: Format) -> bool {
    matches!(codec_of(format), Some(codec) if codec.min == 4)
}

impl Codec {
    fn storage(&self) -> &'static dyn Storage {
        ROWS[self.row].2
    }

    /// Сколько байт занимает ступень `width × height`. Переполнение не проверяется.
    pub fn bytes(&self, width: usize, height: usize) -> usize {
        self.storage().weigh((width, height))
    }

    /// Байты ступени в пиксели RGBA.
    pub fn decode(&self, data: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
        self.storage().unpack(data, (width, height))
    }

    /// Пиксели RGBA в байты ступени.
    pub fn encode(&self, rgba: &[u8], width: usize, height: usize) -> Result<Vec<u8>, String> {
        self.storage().pack(rgba, (width, height))
    }

    /// Размер, до которого дойдёт цепочка уменьшений вдвое под предел `cap`:
    /// стороны кратны наименьшей стороне кодека и не меньше неё.
    fn target_for(&self, cap: usize, (mut width, mut height): Side) -> Side {
        let smaller = |side: usize| (side / 2).max(self.min) / self.min * self.min;
        while width.max(height) > cap {
            let next = (smaller(width), smaller(height));
            if next == (width, height) {
                break;
            }
            (width, height) = next;
        }
        (width, height)
    }

    /// Следующий размер цепочки: обе стороны чётные, а их половины допустимы для кодека.
    fn halved(&self, side: Side) -> Option<Side> {
        let half = (side.0 / 2, side.1 / 2);
        let both_even = (side.0 | side.1) & 1 == 0;
        let fits = |part: usize| part >= self.min && part % self.min == 0;
        (both_even && fits(half.0) && fits(half.1)).then_some(half)
    }
}

/// Исходные пиксели, по которым считаются окна.
struct Plane<'a> {
    bytes: &'a [u8],
    row_len: usize,
}

impl Plane<'_> {
    /// Среднее окна по каждому из четырёх каналов; половина округляется вверх.
    fn average(&self, rows: &Range<usize>, cols: &Range<usize>) -> [u8; 4] {
        let count = rows.len() * cols.len();
        let starts = || {
            rows.clone()
                .flat_map(|row| cols.clone().map(move |col| (row * self.row_len + col) * 4))
        };
        std::array::from_fn(|channel| {
            let total: usize = starts()
                .map(|at| usize::from(self.bytes[at + channel]))
                .sum();
            ((total + count / 2) / count) as u8
        })
    }
}

/// Усреднение по площади до любого размера, в том числе нечётного и в сторону увеличения.
pub fn shrink(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    width: usize,
    height: usize,
) -> Vec<u8> {
    if width == 0 || height == 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(width * height * 4);
    // Окна по одной оси; пустое окно (при увеличении) растягивается до одной точки.
    let windows = |from: usize, to: usize| -> Vec<Range<usize>> {
        (0..to)
            .map(|i| {
                let start = i * from / to;
                start..((i + 1) * from / to).max(start + 1)
            })
            .collect()
    };
    let plane = Plane {
        bytes: source,
        row_len: source_width,
    };
    let columns = windows(source_width, width);
    for rows in windows(source_height, height) {
        out.extend(columns.iter().flat_map(|cols| plane.average(&rows, cols)));
    }
    out
}

fn ensure(ok: bool) -> Option<()> {
    ok.then_some(())
}

trait Halving {
    /// Деление нацело на два в степени `times`; при слишком большой степени ноль.
    fn halve_times(self, times: usize) -> usize;
}

impl Halving for usize {
    fn halve_times(self, times: usize) -> usize {
        u32::try_from(times).map_or(0, |shift| self.checked_shr(shift).unwrap_or(0))
    }
}

/// Размеры ступеней, где каждая вчетверо меньше предыдущей (целочисленно).
struct Quarters(usize);

impl Quarters {
    /// Сумма первых `count` размеров.
    fn total(&self, count: usize) -> usize {
        (0..count)
            .scan(self.0, |size, _| {
                let now = *size;
                *size /= 4;
                Some(now)
            })
            .sum()
    }
}

/// Отказ пересжатия: молчаливый или со строкой для отчёта.
type Refusal = Option<String>;

fn require(ok: bool) -> Result<(), Refusal> {
    if ok {
        Ok(())
    } else {
        Err(None)
    }
}

impl Level {
    /// Та же текстура без верхних ступеней, если их можно отрезать без пересжатия.
    fn cut(&self, cap: usize) -> Option<Level> {
        ensure(!self.data.is_empty() && self.levels > 1 && self.depth <= 1)?;
        let floor = codec_of(self.format)?.min;
        let may_step_down = |k: usize| {
            self.width.halve_times(k).max(self.height.halve_times(k)) > cap
                && self.width.halve_times(k + 1) >= floor
                && self.height.halve_times(k + 1) >= floor
        };
        let last = self.levels - 1;
        let dropped = (0..last).position(|k| !may_step_down(k)).unwrap_or(last);
        ensure(dropped > 0)?;

        let whole = Quarters(self.stride * self.height);
        ensure(whole.total(self.levels) == self.data.len())?;
        let skipped = whole.total(dropped);
        let stride = self.stride.halve_times(dropped);
        let height = self.height.halve_times(dropped);
        let levels = self.levels - dropped;
        ensure(stride > 0 && Quarters(stride * height).total(levels) == self.data.len() - skipped)?;
        Some(Level {
            name: self.name.clone(),
            format: self.format,
            width: self.width.halve_times(dropped),
            height,
            stride,
            levels,
            depth: self.depth,
            data: self.data[skipped..].to_vec(),
        })
    }

    /// Та же текстура, собранная заново под предел `cap`; отказ кодека приходит строкой.
    fn rebuilt(&self, cap: usize) -> Result<Level, Refusal> {
        let &Level { width, height, .. } = self;
        let turned_away = [
            width.max(height) <= cap,
            self.depth > 1,
            width > limit::SIDE || height > limit::SIDE,
            self.data.is_empty(),
        ];
        require(!turned_away.contains(&true))?;
        let codec = codec_of(self.format).ok_or(None)?;
        let top = codec.bytes(width, height);
        require(top != 0 && self.data.len() >= top && self.stride * height == top)?;
        let target = codec.target_for(cap, (width, height));
        require(target != (width, height))?;

        let from = format!("decode {} {}x{}", self.format.name(), width, height);
        let decoded = codec
            .decode(&self.data[..top], width, height)
            .map_err(|text| format!("{from}: {text}"))
            .and_then(|pixels| match pixels.len() == width * height * 4 {
                true => Ok(pixels),
                false => Err(format!("{from}: got {} bytes", pixels.len())),
            });
        let pixels = decoded.map_err(Some)?;

        // Каждая следующая ступень получается из пикселей предыдущей до сжатия.
        let mut frames = Vec::new();
        let mut side = target;
        let mut rgba = shrink(&pixels, width, height, side.0, side.1);
        loop {
            let next = codec
                .halved(side)
                .map(|half| (half, shrink(&rgba, side.0, side.1, half.0, half.1)));
            frames.push((side, rgba));
            match next {
                Some((half, half_rgba)) => (side, rgba) = (half, half_rgba),
                None => break,
            }
        }

        let label = codec.output.name();
        let packed = frames
            .iter()
            .map(|&((w, h), ref px)| match codec.encode(px, w, h) {
                Ok(bytes) if bytes.len() == codec.bytes(w, h) => Ok(bytes),
                Ok(bytes) => Err(format!("encode {label} {w}x{h}: got {} bytes", bytes.len())),
                Err(text) => Err(format!("encode {label} {}x{}: {text}", target.0, target.1)),
            })
            .collect::<Result<Vec<Vec<u8>>, String>>();
        let packed = packed.map_err(Some)?;

        let first_len = packed[0].len();
        let stride = first_len / target.1;
        require(first_len % target.1 == 0 && stride <= limit::STRIDE)?;
        Ok(Level {
            name: self.name.clone(),
            format: codec.output,
            width: target.0,
            height: target.1,
            stride,
            levels: packed.len(),
            depth: self.depth,
            data: packed.concat(),
        })
    }
}

/// Отрезает верхние ступени без пересжатия, пока большая сторона не опустится до `cap`.
pub fn drop_to(level: &mut Level, cap: usize) -> bool {
    match level.cut(cap) {
        Some(smaller) => {
            *level = smaller;
            true
        }
        None => false,
    }
}

/// Данные ступеней в том виде, в каком их читает хост (CodeWalker). Файл игры держит хвост полной цепочки блоками:
/// ступени `2×2` и `1×1` занимают по целому блоку (`ytd_write::payload_bytes`), а хост считает каждую ступень вчетверо
/// меньше прежней, и его данные короче на этот хвост (DXT1 128×128, 8 ступеней: 10 922 байта против 10 936). Срез ступеней,
/// стадии и пересжатие здесь сверены с хостом на его данных, поэтому при чтении хвост отбрасывается, а при записи
/// возвращается нулями (`stored_bytes`). Размеры не степени двойки, глубина больше единицы и данные, длина которых не равна
/// `payload_bytes`, остаются как были.
pub fn as_host_sees(level: &mut Level) {
    let whole = ytd_write::payload_bytes(level.format, level.width, level.height, level.levels);
    let seen = Quarters(level.stride * level.height).total(level.levels);
    let plain = level.depth <= 1 && level.width.is_power_of_two() && level.height.is_power_of_two();
    if plain && level.data.len() == whole && seen < whole {
        level.data.truncate(seen);
    }
}

/// Байты для файла игры: данные ступеней, дополненные нулями до длины, которую ждёт писатель (`payload_bytes`).
pub fn stored_bytes(level: &Level) -> Vec<u8> {
    let whole = ytd_write::payload_bytes(level.format, level.width, level.height, level.levels);
    let mut bytes = level.data.clone();
    if bytes.len() < whole {
        bytes.resize(whole, 0);
    }
    bytes
}

/// Разжимает верхнюю ступень, усредняет её до размера под предел `cap` и собирает цепочку заново.
pub fn resample_to(level: &mut Level, cap: usize, failures: &mut Vec<String>) -> bool {
    match level.rebuilt(cap) {
        Ok(next) => {
            *level = next;
            true
        }
        Err(line) => {
            failures.extend(line);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    type Pattern = fn(usize, usize) -> Vec<u8>;

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn unhex(text: &str) -> Vec<u8> {
        text.split_whitespace()
            .map(|part| u8::from_str_radix(part, 16).unwrap())
            .collect()
    }

    /// Сверка длинных данных: sha256 всего и начало.
    fn assert_data(data: &[u8], digest: &str, head: &str) {
        assert_eq!(sha(data), digest);
        let count = head.split_whitespace().count();
        assert_eq!(hex(&data[..count]), head);
    }

    /// Узор `P`: красный от x, зелёный от y, синий (7x + 13y) mod 256, альфа 255.
    fn pattern(w: usize, h: usize) -> Vec<u8> {
        let mut out = Vec::new();
        for y in 0..h {
            for x in 0..w {
                out.extend([
                    (x * 255 / w) as u8,
                    (y * 255 / h) as u8,
                    ((7 * x + 13 * y) % 256) as u8,
                    255,
                ]);
            }
        }
        out
    }

    /// Узор `PA`: как `P`, но альфа (31x + 17y) mod 256.
    fn pattern_alpha(w: usize, h: usize) -> Vec<u8> {
        let mut out = pattern(w, h);
        for y in 0..h {
            for x in 0..w {
                out[(y * w + x) * 4 + 3] = ((31 * x + 17 * y) % 256) as u8;
            }
        }
        out
    }

    fn seq(n: usize) -> Vec<u8> {
        (0..n).map(|i| ((37 * i + 11) % 256) as u8).collect()
    }

    fn codec(format: Format) -> Codec {
        codec_of(format).unwrap()
    }

    fn stride_of(format: Format, width: usize) -> usize {
        match format {
            Format::Dxt1 | Format::Ati1 => width.div_ceil(4) * 2,
            Format::Dxt3 | Format::Dxt5 | Format::Ati2 | Format::Bc7 => width.div_ceil(4) * 4,
            Format::A8 | Format::L8 => width,
            _ => width * 4,
        }
    }

    fn mip(format: Format, w: usize, h: usize, i: usize) -> (usize, usize) {
        let step = codec(format).min;
        (
            (w >> i).max(1).next_multiple_of(step),
            (h >> i).max(1).next_multiple_of(step),
        )
    }

    /// Данные `levels` ступеней: узор нужного размера, сжатый кодеком формата.
    fn chain(format: Format, w: usize, h: usize, levels: usize, draw: Pattern) -> Vec<u8> {
        (0..levels)
            .flat_map(|i| {
                let (lw, lh) = mip(format, w, h, i);
                codec(format).encode(&draw(lw, lh), lw, lh).unwrap()
            })
            .collect()
    }

    fn level(format: Format, w: usize, h: usize, levels: usize, data: Vec<u8>) -> Level {
        Level {
            name: "t".to_owned(),
            format,
            width: w,
            height: h,
            stride: stride_of(format, w),
            levels,
            depth: 1,
            data,
        }
    }

    /// Формат, ширина, высота, шаг, ступени, глубина, длина данных.
    fn shape(l: &Level) -> (Format, usize, usize, usize, usize, usize, usize) {
        (
            l.format,
            l.width,
            l.height,
            l.stride,
            l.levels,
            l.depth,
            l.data.len(),
        )
    }

    #[test]
    fn the_codec_table_and_sizes_follow_the_formats() {
        // Кд1 – Кд11, Мс1 – Мс4
        let sizes = [
            (0, 0),
            (1, 1),
            (3, 5),
            (4, 4),
            (5, 5),
            (8, 4),
            (16, 16),
            (256, 256),
            (8192, 8192),
        ];
        let dxt1 = [0, 8, 16, 8, 32, 16, 128, 32768, 33554432];
        let dxt3 = [0, 16, 32, 16, 64, 32, 256, 65536, 67108864];
        let argb = [0, 4, 60, 64, 100, 128, 1024, 262144, 268435456];
        let one = [0, 1, 15, 16, 25, 32, 256, 65536, 67108864];
        let rows = [
            (Format::Dxt1, Format::Dxt1, true, dxt1),
            (Format::Dxt3, Format::Dxt3, true, dxt3),
            (Format::Dxt5, Format::Dxt5, true, dxt3),
            (Format::Ati1, Format::Ati1, true, dxt1),
            (Format::Ati2, Format::Ati2, true, dxt3),
            (Format::Bc7, Format::Dxt5, true, dxt3),
            (Format::A8R8G8B8, Format::A8R8G8B8, false, argb),
            (Format::X8R8G8B8, Format::X8R8G8B8, false, argb),
            (Format::A8, Format::A8, false, one),
            (Format::A8B8G8R8, Format::A8B8G8R8, false, argb),
            (Format::L8, Format::L8, false, one),
        ];
        for (format, output, block, bytes) in rows {
            let found = codec(format);
            assert_eq!(found.output, output, "{format:?}");
            assert_eq!(found.min, if block { 4 } else { 1 }, "{format:?}");
            assert_eq!(is_block_compressed(format), block, "{format:?}");
            for ((w, h), want) in sizes.iter().zip(bytes) {
                assert_eq!(found.bytes(*w, *h), want, "{format:?} {w}x{h}");
            }
            let copy = found;
            assert_eq!(copy, found, "{format:?}");
        }
        assert_ne!(codec(Format::A8R8G8B8), codec(Format::X8R8G8B8));
        assert_ne!(codec(Format::Bc7), codec(Format::Dxt5));
        assert_ne!(codec(Format::A8B8G8R8), codec(Format::A8R8G8B8));
    }

    #[test]
    fn unpacked_formats_swap_or_pick_channels() {
        // Нс1 – Нс16
        let quad = unhex("10 20 30 40 01 02 03 04");
        let swapped = unhex("30 20 10 40 03 02 01 04");
        for format in [Format::A8R8G8B8, Format::X8R8G8B8] {
            assert_eq!(codec(format).decode(&quad, 2, 1).unwrap(), swapped);
            assert_eq!(codec(format).encode(&quad, 2, 1).unwrap(), swapped);
        }
        let abgr = codec(Format::A8B8G8R8);
        assert_eq!(abgr.decode(&quad, 2, 1).unwrap(), quad);
        assert_eq!(abgr.encode(&quad, 2, 1).unwrap(), quad);

        let x = codec(Format::X8R8G8B8);
        assert_eq!(
            x.decode(&unhex("10 20 30 00"), 1, 1).unwrap(),
            unhex("30 20 10 00")
        );
        let argb = codec(Format::A8R8G8B8);
        assert_eq!(
            argb.decode(&unhex("01 02 03 04 05 06"), 1, 1).unwrap(),
            unhex("03 02 01 04 05 06")
        );
        assert_eq!(
            argb.decode(&unhex("01 02 03 04 05 06 07 08"), 9, 9)
                .unwrap(),
            unhex("03 02 01 04 07 06 05 08")
        );
        assert!(argb.decode(&[], 0, 0).unwrap().is_empty());
        assert_eq!(
            argb.encode(&unhex("01 02 03 04 05 06 07 08 09"), 1, 1)
                .unwrap(),
            unhex("03 02 01 04 07 06 05 08 09")
        );

        let luma = codec(Format::L8);
        assert_eq!(
            luma.decode(&unhex("00 07 80 ff"), 2, 2).unwrap(),
            unhex("00 00 00 ff 07 07 07 ff 80 80 80 ff ff ff ff ff")
        );
        assert_eq!(
            luma.decode(&unhex("00 07"), 9, 9).unwrap(),
            unhex("00 00 00 ff 07 07 07 ff")
        );
        let nine = unhex("0a 14 1e 28 32 3c 46 50 5a");
        assert_eq!(luma.encode(&nine, 2, 1).unwrap(), unhex("0a 32"));
        let alpha = codec(Format::A8);
        assert_eq!(
            alpha.decode(&unhex("00 07 80 ff"), 2, 2).unwrap(),
            unhex("00 00 00 00 00 00 00 07 00 00 00 80 00 00 00 ff")
        );
        assert_eq!(alpha.encode(&nine, 2, 1).unwrap(), unhex("28 50"));
    }

    #[test]
    fn solid_blocks_encode_and_decode_like_the_codec() {
        // Бл1 – Бл24
        let formats = [
            Format::Dxt1,
            Format::Dxt3,
            Format::Dxt5,
            Format::Ati1,
            Format::Ati2,
            Format::Bc7,
        ];
        let red_sha = "fec0f57de0b19bc7dacb5b0fc3de7b56fc68dfdbeeebc8f9f4c506bf6e821c77";
        let clear_a = "20e65596fe7c15642996b35ef3054f8c93a772fc0e91f66b3174ae8ff26a2921";
        let clear_b = "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b";
        let white_sha = "8667e718294e9e0df1d30600ba3eeb201f764aad2dad72748643e4a285e1d1f7";
        let solids: [([u8; 4], [&str; 6], [&str; 6]); 4] = [
            (
                [255, 0, 0, 255],
                [
                    "00 f8 00 f8 00 00 00 00",
                    "ff ff ff ff ff ff ff ff 00 f8 00 f8 00 00 00 00",
                    "ff ff 00 00 00 00 00 00 00 f8 00 f8 00 00 00 00",
                    "ff 00 00 00 00 00 00 00",
                    "ff 00 00 00 00 00 00 00 ff 00 49 92 24 49 92 24",
                    "ff ff 00 00 00 00 00 00 00 f8 00 f8 00 00 00 00",
                ],
                [
                    red_sha,
                    red_sha,
                    red_sha,
                    red_sha,
                    red_sha,
                    "cdc17fb335cc7b59b93cc368d94eede8bde457224d7599dede7a019a59447efd",
                ],
            ),
            (
                [0, 0, 0, 0],
                [
                    "00 00 00 00 00 00 00 00",
                    "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
                    "ff 00 49 92 24 49 92 24 00 00 00 00 00 00 00 00",
                    "ff 00 49 92 24 49 92 24",
                    "ff 00 49 92 24 49 92 24 ff 00 49 92 24 49 92 24",
                    "ff 00 49 92 24 49 92 24 00 00 00 00 00 00 00 00",
                ],
                [
                    clear_a,
                    clear_b,
                    clear_b,
                    clear_a,
                    clear_a,
                    "91af2ac1c7030cccdac89ab4fafc4254834a38891a50cf2182ac0ce85d199a6d",
                ],
            ),
            (
                [10, 20, 30, 128],
                [
                    "a4 08 a4 08 00 00 00 00",
                    "88 88 88 88 88 88 88 88 a4 08 a4 08 00 00 00 00",
                    "80 80 00 00 00 00 00 00 a4 08 a4 08 00 00 00 00",
                    "0a 0a 00 00 00 00 00 00",
                    "0a 0a 00 00 00 00 00 00 14 14 00 00 00 00 00 00",
                    "80 80 00 00 00 00 00 00 a4 08 a4 08 00 00 00 00",
                ],
                [
                    "13a246af8e4847755fadd3396b8a54e1f514bb8933469df8b3a1d966052c49b5",
                    "6b8e4c0be22002cc8f7b8636459608d85cc5af016d7183259bdf10d6e0453587",
                    "c28645831cc5a8a7d94d3bb92d7acf762de02399e5d9fd5f857b6046dea94ce6",
                    "de2090d124348edd89457d7ec32a3dd54b9114ae75620e8f93b2a42aa31fbca2",
                    "49e2b0285c5b81e795b92b4264c9000776545dfae59409c8c4c3bf951e530c49",
                    "b00a785f2be2e01a905a58cd9ff99eb8d2102ebd25f7c411e06880105e682c58",
                ],
            ),
            (
                [255, 255, 255, 255],
                [
                    "ff ff ff ff 00 00 00 00",
                    "ff ff ff ff ff ff ff ff ff ff ff ff 00 00 00 00",
                    "ff ff 00 00 00 00 00 00 ff ff ff ff 00 00 00 00",
                    "ff 00 00 00 00 00 00 00",
                    "ff 00 00 00 00 00 00 00 ff 00 00 00 00 00 00 00",
                    "ff ff 00 00 00 00 00 00 ff ff ff ff 00 00 00 00",
                ],
                [
                    white_sha,
                    white_sha,
                    white_sha,
                    red_sha,
                    "577c18e7087501cba4e970698977f9f1ec6bca15aa3b0b31e64f35bd725e3e5f",
                    "177712311e8ef6f1315c83de07c630b829e44d54b07b2454cbf1238bffa0a6f8",
                ],
            ),
        ];
        for (color, encoded, decoded) in solids {
            let frame: Vec<u8> = color.iter().copied().cycle().take(64).collect();
            for (i, format) in formats.into_iter().enumerate() {
                let found = codec(format);
                let packed = found.encode(&frame, 4, 4).unwrap();
                assert_eq!(hex(&packed), encoded[i], "{format:?} {color:?}");
                assert_eq!(
                    sha(&found.decode(&packed, 4, 4).unwrap()),
                    decoded[i],
                    "{format:?} {color:?}"
                );
            }
        }
    }

    #[test]
    fn patterned_blocks_and_the_bc7_asymmetry() {
        // Бл25 – Бл45
        assert_data(
            &pattern(8, 8),
            "5b689fcd38399b684ad07a899324773827f1d91fcaed2a065404f5a86683fc06",
            "00 00 00 ff 1f 00 07 ff 3f 00 0e ff 5f 00 15 ff",
        );
        assert_data(
            &pattern_alpha(8, 8),
            "5ef62b70978ab9d99889e2c4e97f8e33cd1784f14bbdeca943ad148425b21a5a",
            "00 00 00 00 1f 00 07 1f 3f 00 0e 3e 5f 00 15 5d",
        );
        let dxt1 = codec(Format::Dxt1);
        let packed = dxt1.encode(&pattern(8, 8), 8, 8).unwrap();
        assert_eq!(
            hex(&packed),
            "e6 32 01 30 55 ff aa 00 ea aa 05 a8 55 ff aa 00 ec 36 e7 33 55 ff aa 00 f0 ae eb ab 55 ff aa 00"
        );
        assert_data(
            &dxt1.decode(&packed, 8, 8).unwrap(),
            "5e8bd0b24d93428a9462aea6b478b307d70db41a972ab368f3bd93ceb8c75987",
            "31 00 08 ff 31 00 08 ff 31 00 08 ff 31 00 08 ff",
        );
        let dxt5 = codec(Format::Dxt5).encode(&pattern(8, 8), 8, 8).unwrap();
        assert_data(
            &dxt5,
            "4693b70f38bf27329b2264ebf50bb76e7590918cd2b0591e7d991ebd754d3506",
            "ff ff 00 00 00 00 00 00 e6 32 01 30 55 ff aa 00",
        );
        let bc7 = codec(Format::Bc7);
        let wrong_way = bc7.decode(&dxt5, 8, 8).unwrap();
        assert_data(
            &wrong_way,
            "8393b219b97f1335a5ba215298bcc258112343279d0f7b38821c163a5d579fd1",
            "ff 08 08 ff ff 08 08 ff 73 00 00 ff 55 02 10 ff",
        );
        assert_eq!(
            bc7.encode(&pattern_alpha(8, 8), 8, 8).unwrap(),
            codec(Format::Dxt5)
                .encode(&pattern_alpha(8, 8), 8, 8)
                .unwrap()
        );
        let ati1 = codec(Format::Ati1).encode(&pattern(8, 8), 8, 8).unwrap();
        assert_eq!(
            hex(&ati1),
            "1c 5c 06 63 30 06 63 30 dd 80 f1 10 0f f1 10 0f 1c 5c 06 63 30 06 63 30 dd 80 f1 10 0f f1 10 0f"
        );
        // края, не кратные четырём
        let edge = codec(Format::Dxt1)
            .encode(&pattern_alpha(5, 3), 5, 3)
            .unwrap();
        assert_eq!(
            hex(&edge),
            "04 5d 41 38 55 af 00 af c7 cc 03 c8 55 aa 00 aa"
        );
        assert_data(
            &codec(Format::Dxt1).decode(&edge, 5, 3).unwrap(),
            "5a308aea60a586dfbb3ecdf186de1a983c704361177f0ce2037005ff3328b2f1",
            "3a 08 08 ff 3a 08 08 ff 3a 08 08 ff 3a 08 08 ff",
        );
        let edge5 = codec(Format::Dxt5)
            .encode(&pattern_alpha(5, 3), 5, 3)
            .unwrap();
        assert_eq!(
            hex(&edge5),
            "12 80 d6 08 b1 5a 03 b1 04 5d 41 38 55 af 00 af 9c 7a 49 42 92 00 40 92 c7 cc 03 c8 55 aa 00 aa"
        );
        // чтение BC7 из готовых байт
        assert_data(
            &bc7.decode(&[0; 16], 4, 4).unwrap(),
            clear_hash(),
            "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        );
        assert_data(
            &bc7.decode(&[255; 16], 4, 4).unwrap(),
            "8667e718294e9e0df1d30600ba3eeb201f764aad2dad72748643e4a285e1d1f7",
            "ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff",
        );
        assert_data(
            &bc7.decode(&seq(16), 4, 4).unwrap(),
            "b9cd139387227b11ac94f5828ee4b0eef6078034f7a66b4aa4a21dbc9605cd97",
            "3b d4 76 ff 3b d4 76 ff 9b 3b 8b ff 94 42 84 ff",
        );
    }

    fn clear_hash() -> &'static str {
        "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b"
    }

    #[test]
    fn the_block_codec_refusals_are_numbers() {
        // Ош1 – Ош15
        let dxt1 = codec(Format::Dxt1);
        assert_eq!(dxt1.decode(&[0; 7], 4, 4), Err("код 3".to_owned()));
        assert_eq!(dxt1.decode(&[0; 9], 4, 4), Err("код 3".to_owned()));
        assert_eq!(dxt1.decode(&[0; 8], 0, 4), Err("код 1".to_owned()));
        assert_eq!(dxt1.decode(&[], 0, 0), Err("код 1".to_owned()));
        assert_eq!(dxt1.decode(&[0; 8], 4, 0), Err("код 1".to_owned()));
        assert_eq!(
            dxt1.decode(&vec![0; 4097 * 8], 16385, 1),
            Err("код 1".to_owned())
        );
        let wide = dxt1.decode(&vec![0; 4096 * 8], 16384, 4).unwrap();
        assert_data(
            &wide,
            "b7997c60612a8f60f104b19583162aaac7dde1f1ab2e8ef7c9b935550e2b0aa8",
            "00 00 00 ff 00 00 00 ff 00 00 00 ff 00 00 00 ff",
        );
        assert_eq!(dxt1.encode(&[0; 63], 4, 4), Err("код 3".to_owned()));
        assert_eq!(dxt1.encode(&[0; 65], 4, 4), Err("код 3".to_owned()));
        assert_eq!(dxt1.encode(&[], 0, 0), Err("код 1".to_owned()));
        assert_eq!(
            dxt1.encode(&vec![0; 16385 * 4], 16385, 1),
            Err("код 1".to_owned())
        );
        assert_eq!(dxt1.encode(&[0; 64], 4, 4), Ok(vec![0; 8]));
        assert_eq!(
            codec(Format::Bc7).decode(&[0; 15], 4, 4),
            Err("код 3".to_owned())
        );
        let flat = "20e65596fe7c15642996b35ef3054f8c93a772fc0e91f66b3174ae8ff26a2921";
        assert_data(
            &codec(Format::Ati1).decode(&[0; 8], 4, 4).unwrap(),
            flat,
            "00 00 00 ff 00 00 00 ff 00 00 00 ff 00 00 00 ff",
        );
        assert_data(
            &codec(Format::Ati2).decode(&[0; 16], 4, 4).unwrap(),
            flat,
            "00 00 00 ff 00 00 00 ff 00 00 00 ff 00 00 00 ff",
        );
    }

    #[test]
    fn shrink_averages_windows_with_half_up_rounding() {
        // Ср1 – Ср32
        let two = |a: [u8; 4]| -> Vec<u8> { a.iter().flat_map(|&v| [v, v, v, v]).collect() };
        let cases: [([u8; 4], [u8; 4]); 7] = [
            ([0, 0, 0, 1], [0; 4]),
            ([0, 0, 1, 1], [1; 4]),
            ([0, 1, 1, 1], [1; 4]),
            ([254, 255, 255, 255], [255; 4]),
            ([0, 0, 0, 2], [1; 4]),
            ([1, 1, 1, 2], [1; 4]),
            ([0, 255, 0, 255], [128, 128, 128, 128]),
        ];
        for (input, want) in cases {
            assert_eq!(shrink(&two(input), 2, 2, 1, 1), want.to_vec(), "{input:?}");
        }
        let bw = unhex("00 00 00 ff ff ff ff ff 00 00 00 ff ff ff ff ff");
        assert_eq!(shrink(&bw, 2, 2, 1, 1), unhex("80 80 80 ff"));

        let p4 = pattern(4, 4);
        assert_eq!(shrink(&p4, 4, 4, 4, 4), p4);
        assert_eq!(
            hex(&shrink(&p4, 4, 4, 2, 2)),
            "20 20 0a ff 9f 20 18 ff 20 9f 24 ff 9f 9f 32 ff"
        );
        assert_eq!(hex(&shrink(&p4, 4, 4, 1, 1)), "5f 5f 1e ff");
        let halved = shrink(&pattern_alpha(8, 8), 8, 8, 4, 4);
        assert_data(
            &halved,
            "b52a37f34e06b1740a5dd9046ace447a67d4c1be9879c3412753bae96c5ca475",
            "10 10 0a 18 4f 10 18 56 8f 10 26 94 cf 10 34 d2",
        );

        let reds =
            |values: &[u8]| -> Vec<u8> { values.iter().flat_map(|&v| [v, 0, 0, 255]).collect() };
        let nine = reds(&[0, 10, 20, 30, 40, 50, 60, 70, 80]);
        assert_eq!(
            hex(&shrink(&nine, 3, 3, 2, 2)),
            "00 00 00 ff 0f 00 00 ff 2d 00 00 ff 3c 00 00 ff"
        );
        assert_eq!(hex(&shrink(&nine, 3, 3, 1, 1)), "28 00 00 ff");
        assert_eq!(
            hex(&shrink(&nine, 3, 3, 4, 4)),
            "00 00 00 ff 00 00 00 ff 0a 00 00 ff 14 00 00 ff 00 00 00 ff 00 00 00 ff 0a 00 00 ff 14 00 00 ff 1e 00 00 ff 1e 00 00 ff 28 00 00 ff 32 00 00 ff 3c 00 00 ff 3c 00 00 ff 46 00 00 ff 50 00 00 ff"
        );
        let row = reds(&[0, 50, 100, 150, 200]);
        assert_eq!(hex(&shrink(&row, 5, 1, 2, 1)), "19 00 00 ff 96 00 00 ff");
        assert_eq!(
            hex(&shrink(&row, 5, 1, 3, 1)),
            "00 00 00 ff 4b 00 00 ff af 00 00 ff"
        );
        assert_eq!(
            hex(&shrink(&row, 5, 1, 5, 3)),
            "00 00 00 ff 32 00 00 ff 64 00 00 ff 96 00 00 ff c8 00 00 ff 00 00 00 ff 32 00 00 ff 64 00 00 ff 96 00 00 ff c8 00 00 ff 00 00 00 ff 32 00 00 ff 64 00 00 ff 96 00 00 ff c8 00 00 ff"
        );
        assert_eq!(
            hex(&shrink(&unhex("09 08 07 06"), 1, 1, 3, 2)),
            "09 08 07 06 ".repeat(6).trim_end()
        );
        let corners = reds(&[10, 20, 30, 40]);
        assert_eq!(
            hex(&shrink(&corners, 2, 2, 4, 4)),
            "0a 00 00 ff 0a 00 00 ff 14 00 00 ff 14 00 00 ff 0a 00 00 ff 0a 00 00 ff 14 00 00 ff 14 00 00 ff 1e 00 00 ff 1e 00 00 ff 28 00 00 ff 28 00 00 ff 1e 00 00 ff 1e 00 00 ff 28 00 00 ff 28 00 00 ff"
        );
        let odd = shrink(&pattern(7, 5), 7, 5, 3, 2);
        assert_eq!(
            hex(&odd),
            "12 1a 0a ff 5b 1a 18 ff b6 1a 2a ff 12 99 2b ff 5b 99 39 ff b6 99 4a ff"
        );
        for (w, h) in [(0, 0), (0, 3), (3, 0)] {
            assert!(shrink(&p4, 4, 4, w, h).is_empty());
        }
        let double: Vec<u8> = [pattern(8, 8), pattern(8, 8)].concat();
        assert_eq!(
            shrink(&double, 8, 8, 4, 4),
            shrink(&pattern(8, 8), 8, 8, 4, 4)
        );
        // пустое или нулевое описание исходника повторяет первую точку
        assert_eq!(
            hex(&shrink(&unhex("01 02 03 04 05 06 07 08"), 0, 0, 2, 1)),
            "01 02 03 04 01 02 03 04"
        );
        assert_eq!(
            hex(&shrink(&p4, 4, 0, 2, 2)),
            "20 00 04 ff 9f 00 12 ff 20 00 04 ff 9f 00 12 ff"
        );
        let wide = shrink(&pattern(8192, 2), 8192, 2, 4096, 1);
        assert_data(
            &wide,
            "4b40193b749920d5007b43291290b124fcb5c1c8b069270c4b9b98a9f1f82a20",
            "00 40 0a ff 00 40 18 ff 00 40 26 ff 00 40 34 ff",
        );
        let tall = shrink(&pattern(2, 8192), 2, 8192, 1, 4096);
        assert_data(
            &tall,
            "9b06043b4554db58ff168f9380558492022579a53339a1ad6b58a5388944c64f",
            "40 00 0a ff 40 00 24 ff 40 00 3e ff 40 00 58 ff",
        );
        assert_eq!(
            hex(&shrink(&pattern(8192, 1), 8192, 1, 1, 1)),
            "7f 00 80 ff"
        );
        let skew = shrink(&pattern(4097, 3), 4097, 3, 2048, 1);
        assert_data(
            &skew,
            "efb1d2f033a625a2c5dd7f9314f6affb9e20db3b3c03caeef2164305b3c4c067",
            "00 55 11 ff 00 55 1f ff 00 55 2d ff 00 55 3b ff",
        );
    }

    fn panic_text(job: impl FnOnce()) -> String {
        let caught = catch_unwind(AssertUnwindSafe(job)).unwrap_err();
        match caught.downcast::<String>() {
            Ok(text) => *text,
            Err(other) => (*other.downcast::<&str>().unwrap()).to_owned(),
        }
    }

    #[test]
    fn shrink_panics_on_short_sources_like_before() {
        // Ср24, Ср25
        let short = pattern(4, 4)[..32].to_vec();
        let text = panic_text(|| {
            shrink(&short, 4, 4, 2, 2);
        });
        assert_eq!(
            text,
            "index out of bounds: the len is 32 but the index is 32"
        );
        let text = panic_text(|| {
            shrink(&[], 0, 0, 1, 1);
        });
        assert_eq!(text, "index out of bounds: the len is 0 but the index is 0");
    }

    #[test]
    fn size_overflows_follow_the_build_profile() {
        // Пп1, Пп2
        let argb = codec(Format::A8R8G8B8);
        let dxt1 = codec(Format::Dxt1);
        if cfg!(debug_assertions) {
            assert_eq!(
                panic_text(|| {
                    argb.bytes(usize::MAX, 2);
                }),
                "attempt to multiply with overflow"
            );
            assert_eq!(
                panic_text(|| {
                    dxt1.bytes(usize::MAX, 1);
                }),
                "attempt to multiply with overflow"
            );
        } else {
            assert_eq!(argb.bytes(usize::MAX, 2), 18446744073709551608);
            assert_eq!(dxt1.bytes(usize::MAX, 1), 0);
        }
        // Пп3: размер результата не помещается
        let pixel = [1u8, 2, 3, 4];
        let text = panic_text(|| {
            shrink(&pixel, 1, 1, usize::MAX, 2);
        });
        let want = if cfg!(debug_assertions) {
            "attempt to multiply with overflow"
        } else {
            "capacity overflow"
        };
        assert_eq!(text, want);
    }

    #[test]
    fn drop_to_cuts_the_top_levels_without_recompressing() {
        // Сз1 – Сз8
        let full = chain(Format::Dxt1, 64, 64, 3, pattern);
        assert_eq!(full.len(), 2688);
        let mut flat = level(Format::Dxt1, 64, 64, 3, vec![7; 2688]);
        assert!(drop_to(&mut flat, 32));
        assert_eq!(shape(&flat), (Format::Dxt1, 32, 32, 16, 2, 1, 640));
        assert_data(
            &flat.data,
            "bc341eab70a4afbd5524c81aefa65137e8f442f5b8fd0987c96eda4698cb8f93",
            "07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07",
        );

        let mut cut = level(Format::Dxt1, 64, 64, 3, full.clone());
        assert!(drop_to(&mut cut, 32));
        assert_eq!(shape(&cut), (Format::Dxt1, 32, 32, 16, 2, 1, 640));
        assert_data(
            &cut.data,
            "3f46abf914b61fd97892b834d663cd5475e9b9a7dabd12d0d883470eb70e73a6",
            "c6 10 01 08 55 ff aa 00 ca 30 04 28 55 ff aa 00",
        );
        assert_eq!(cut.data, full[2048..]);

        let mut sixteen = level(Format::Dxt1, 64, 64, 3, full.clone());
        assert!(drop_to(&mut sixteen, 16));
        assert_eq!(shape(&sixteen), (Format::Dxt1, 16, 16, 8, 1, 1, 128));
        assert_data(
            &sixteen.data,
            "22ea6b896e9b65d2c1550627366b407ac11539a9c6db21b9164f40f19bff628a",
            "86 19 01 18 55 ff aa 00 8a 59 05 58 55 ff aa 00",
        );
        assert_eq!(sixteen.data, full[2560..]);
        for cap in [4, 0] {
            let mut deeper = level(Format::Dxt1, 64, 64, 3, full.clone());
            assert!(drop_to(&mut deeper, cap), "{cap}");
            assert_eq!(
                shape(&deeper),
                (Format::Dxt1, 16, 16, 8, 1, 1, 128),
                "{cap}"
            );
        }
        for cap in [64, 100] {
            let mut same = level(Format::Dxt1, 64, 64, 3, full.clone());
            assert!(!drop_to(&mut same, cap), "{cap}");
            assert_eq!(same, level(Format::Dxt1, 64, 64, 3, full.clone()));
        }
    }

    #[test]
    fn drop_to_checks_the_layout_of_the_chain() {
        // Сз9 – Сз27
        let tail_to_one = chain(Format::Dxt5, 128, 128, 8, pattern);
        assert_eq!(tail_to_one.len(), 21872);
        let mut refused = level(Format::Dxt5, 128, 128, 8, tail_to_one);
        let before = refused.clone();
        assert!(!drop_to(&mut refused, 32));
        assert_eq!(refused, before);
        let mut accepted = level(
            Format::Dxt5,
            128,
            128,
            6,
            chain(Format::Dxt5, 128, 128, 6, pattern),
        );
        assert_eq!(accepted.data.len(), 21840);
        assert!(drop_to(&mut accepted, 32));
        assert_eq!(shape(&accepted), (Format::Dxt5, 32, 32, 32, 4, 1, 1360));
        assert_data(
            &accepted.data,
            "688baa63fd9d23d58bdd301dfeccda2004b06553b33edb2fd9fe7edba6114e09",
            "ff ff 00 00 00 00 00 00 c6 10 01 08 55 ff aa 00",
        );
        assert_eq!(
            accepted.data,
            chain(Format::Dxt5, 128, 128, 6, pattern)[20480..]
        );

        let mut big = level(
            Format::A8R8G8B8,
            256,
            256,
            9,
            chain(Format::A8R8G8B8, 256, 256, 9, pattern),
        );
        assert!(drop_to(&mut big, 32));
        assert_eq!(shape(&big), (Format::A8R8G8B8, 32, 32, 128, 6, 1, 5460));
        assert_data(
            &big.data,
            "f0819d9832e6d60bf1fd70d7ec6e3f9f590d2c0b61b692854b5abe430aed01c2",
            "00 00 00 ff 07 00 07 ff 0e 00 0f ff 15 00 17 ff",
        );
        let mut tiny = level(
            Format::A8R8G8B8,
            256,
            256,
            9,
            chain(Format::A8R8G8B8, 256, 256, 9, pattern),
        );
        assert!(drop_to(&mut tiny, 1));
        assert_eq!(shape(&tiny), (Format::A8R8G8B8, 1, 1, 4, 1, 1, 4));
        assert_eq!(tiny.data, unhex("00 00 00 ff"));
        let mut mono = level(Format::L8, 64, 64, 7, chain(Format::L8, 64, 64, 7, pattern));
        assert!(drop_to(&mut mono, 8));
        assert_eq!(shape(&mono), (Format::L8, 8, 8, 8, 4, 1, 85));
        assert_data(
            &mono.data,
            "26a9ccb846dfd3996253eac1ee69acd3be696fbb719a87f99618f2e3bef18ff4",
            "00 1f 3f 5f 7f 9f bf df 00 1f 3f 5f 7f 9f bf df",
        );
        let mut flat = level(
            Format::Dxt1,
            128,
            64,
            4,
            chain(Format::Dxt1, 128, 64, 4, pattern),
        );
        assert!(drop_to(&mut flat, 32));
        assert_eq!(shape(&flat), (Format::Dxt1, 32, 16, 16, 2, 1, 320));
        assert_data(
            &flat.data,
            "9f296b89072abd9ef1973cc2a0a53d3a53e8c138ca556165290fc26b6b4fa1a2",
            "86 11 01 08 55 ff aa 00 8a 31 04 28 55 ff aa 00",
        );

        let strip = chain(Format::Dxt1, 64, 8, 3, pattern);
        assert_eq!(strip.len(), 352);
        let mut odd_chain = level(Format::Dxt1, 64, 8, 3, strip);
        assert!(!drop_to(&mut odd_chain, 8));
        assert_eq!(odd_chain.data.len(), 352);
        let mut three = level(Format::Dxt1, 64, 8, 3, vec![9; 336]);
        assert!(drop_to(&mut three, 8));
        assert_eq!(shape(&three), (Format::Dxt1, 32, 4, 16, 2, 1, 80));
        assert_data(
            &three.data,
            "7718bd0b6e3022a019399d962ae64eacbfb4982f8dddadb553ead64fdec5f34e",
            "09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09",
        );
        for cap in [8, 2] {
            let mut two = level(Format::Dxt1, 64, 8, 2, vec![9; 320]);
            assert!(drop_to(&mut two, cap), "{cap}");
            assert_eq!(shape(&two), (Format::Dxt1, 32, 4, 16, 1, 1, 64), "{cap}");
            assert_data(
                &two.data,
                "aa725e51a9d8e9a8abe3cefa68561d19a4b06c6f1526e46e3a55a23aef753c73",
                "09 09 09 09 09 09 09 09",
            );
        }
        let mut strip_argb = level(
            Format::A8R8G8B8,
            64,
            8,
            4,
            chain(Format::A8R8G8B8, 64, 8, 4, pattern),
        );
        assert!(drop_to(&mut strip_argb, 8));
        assert_eq!(shape(&strip_argb), (Format::A8R8G8B8, 8, 1, 32, 1, 1, 32));
        assert_eq!(
            hex(&strip_argb.data),
            "00 00 00 ff 07 00 1f ff 0e 00 3f ff 15 00 5f ff 1c 00 7f ff 23 00 9f ff 2a 00 bf ff 31 00 df ff"
        );

        let refusals = [
            ("мало данных", level(Format::Dxt1, 64, 64, 3, vec![0; 100])),
            (
                "одна ступень",
                level(Format::Dxt1, 64, 64, 1, vec![0; 2048]),
            ),
            ("нет данных", level(Format::Dxt1, 64, 64, 3, Vec::new())),
            (
                "шаг 17",
                Level {
                    stride: 17,
                    ..level(Format::Dxt1, 64, 64, 3, vec![0; 2688])
                },
            ),
            (
                "шаг 15",
                Level {
                    stride: 15,
                    ..level(Format::Dxt1, 64, 64, 3, vec![0; 2688])
                },
            ),
            (
                "глубина 2",
                Level {
                    depth: 2,
                    ..level(Format::Dxt1, 64, 64, 3, vec![0; 2688])
                },
            ),
            (
                "шаг обнулится",
                Level {
                    stride: 1,
                    ..level(Format::A8, 8, 8, 2, vec![1; 10])
                },
            ),
            (
                "1×1",
                level(Format::A8R8G8B8, 1, 1, 1, unhex("01 02 03 04")),
            ),
            ("4×4 блок", level(Format::Dxt1, 4, 4, 1, vec![0; 8])),
        ];
        for (label, original) in refusals {
            let mut subject = original.clone();
            let cap = if label == "шаг обнулится" {
                4
            } else {
                32
            };
            assert!(!drop_to(&mut subject, cap), "{label}");
            assert_eq!(subject, original, "{label}");
        }
        let mut quarter = Level {
            stride: 2,
            ..level(Format::A8, 8, 8, 2, vec![1; 20])
        };
        assert!(drop_to(&mut quarter, 4));
        assert_eq!(shape(&quarter), (Format::A8, 4, 4, 1, 1, 1, 4));
        assert_eq!(quarter.data, vec![1; 4]);
    }

    #[test]
    fn drop_to_handles_small_and_huge_chains() {
        // Сз28, Сз29, Сз31 – Сз33
        let len = Quarters(4096 * 8192).total(14);
        assert_eq!(len, 44739242);
        let mut huge = Level {
            stride: 4096,
            ..level(Format::Dxt1, 8192, 8192, 14, vec![0; len])
        };
        assert!(drop_to(&mut huge, 256));
        assert_eq!(
            (
                huge.width,
                huge.height,
                huge.stride,
                huge.levels,
                huge.data.len()
            ),
            (256, 256, 128, 9, 43690)
        );
        let mut huge = Level {
            stride: 4096,
            ..level(Format::Dxt1, 8192, 8192, 14, vec![0; len])
        };
        assert!(drop_to(&mut huge, 4096));
        assert_eq!(
            (
                huge.width,
                huge.height,
                huge.stride,
                huge.levels,
                huge.data.len()
            ),
            (4096, 4096, 2048, 13, 11184810)
        );
        let mut argb = level(Format::A8R8G8B8, 4, 4, 3, vec![0; 84]);
        assert!(drop_to(&mut argb, 1));
        assert_eq!(shape(&argb), (Format::A8R8G8B8, 1, 1, 4, 1, 1, 4));
        let mut block = level(Format::Dxt1, 8, 8, 2, vec![0; 40]);
        assert!(drop_to(&mut block, 4));
        assert_eq!(shape(&block), (Format::Dxt1, 4, 4, 2, 1, 1, 8));
    }

    #[test]
    fn drop_to_keeps_every_format_the_same() {
        // Сф1 – Сф11 (64×64, 4 ступени, предел 16)
        let rows: [(Format, usize, &str, &str); 11] = [
            (
                Format::Dxt1,
                160,
                "24de41748e800f5232b3ba1fcfec9308677ec4056b8263d96fcff55d471e2443",
                "86 19 01 18 55 ff aa 00 8a 59 05 58 55 ff aa 00",
            ),
            (
                Format::Dxt3,
                320,
                "06f3456e80b3adda86b3eeedfe0df4ed9888579ea570967fca61db4f86a25916",
                "ff ff ff ff ff ff ff ff 86 19 01 18 55 ff aa 00",
            ),
            (
                Format::Dxt5,
                320,
                "c7c3a831b7fac2335d02556cbaf1ee334fdaf499404b5ca01bbc88f3319ea228",
                "ff ff 00 00 00 00 00 00 86 19 01 18 55 ff aa 00",
            ),
            (
                Format::Ati1,
                160,
                "814eb4276c98cd446c359a2d505f40c998047b66359940451d13c86e98fcf9d5",
                "0d 2d 06 63 30 06 63 30 6e 3f f1 10 0f f1 10 0f",
            ),
            (
                Format::Ati2,
                320,
                "2bfc88642e0210fbfb14dceae922f7f2d82e005c8897dd2afa1dd04f81514f5e",
                "0d 2d 06 63 30 06 63 30 0d 2d b6 0d 00 24 99 24",
            ),
            (
                Format::Bc7,
                320,
                "c7c3a831b7fac2335d02556cbaf1ee334fdaf499404b5ca01bbc88f3319ea228",
                "ff ff 00 00 00 00 00 00 86 19 01 18 55 ff aa 00",
            ),
            (
                Format::A8R8G8B8,
                1280,
                "770c35925cb221b715a26d3826ad499da5f67a767dbb2b151bf1a98dcb1d600d",
                "00 00 00 ff 07 00 0f ff 0e 00 1f ff 15 00 2f ff",
            ),
            (
                Format::X8R8G8B8,
                1280,
                "770c35925cb221b715a26d3826ad499da5f67a767dbb2b151bf1a98dcb1d600d",
                "00 00 00 ff 07 00 0f ff 0e 00 1f ff 15 00 2f ff",
            ),
            (
                Format::A8,
                320,
                "1f34be94c0f6303063808553c7e906fedaf542afe7fc5d52040008ebfbe35038",
                "ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff",
            ),
            (
                Format::A8B8G8R8,
                1280,
                "69e61d06fba4fe2efc02ce7d49efeed6267f79241ec5570648813c0a21804dc6",
                "00 00 00 ff 0f 00 07 ff 1f 00 0e ff 2f 00 15 ff",
            ),
            (
                Format::L8,
                320,
                "cdce2d3ce4fe8a10f1b242168252bf6ebe5986ea1d1cb3d01c068c5b7c647d9a",
                "00 0f 1f 2f 3f 4f 5f 6f 7f 8f 9f af bf cf df ef",
            ),
        ];
        for (format, len, digest, head) in rows {
            let mut cut = level(format, 64, 64, 4, chain(format, 64, 64, 4, pattern));
            assert!(drop_to(&mut cut, 16), "{format:?}");
            assert_eq!(
                (
                    cut.width,
                    cut.height,
                    cut.levels,
                    cut.data.len(),
                    cut.format,
                    cut.depth
                ),
                (16, 16, 2, len, format, 1)
            );
            assert_eq!(cut.stride, stride_of(format, 16), "{format:?}");
            assert_data(&cut.data, digest, head);
        }
    }

    #[test]
    fn resample_rebuilds_the_whole_chain() {
        // Пс1 – Пс8
        let source = chain(Format::Dxt1, 128, 128, 1, pattern);
        assert_data(
            &source,
            "f732c8d0ea785f9dcc6cc5520d80dc49c713227053f2422bbf294961348ad0b1",
            "27 08 00 00 f5 ff ab 02 2b 10 04 08 d5 fd ab 0a",
        );
        let mut block = level(Format::Dxt1, 128, 128, 1, source);
        let mut failures = Vec::new();
        assert!(resample_to(&mut block, 32, &mut failures));
        assert_eq!(shape(&block), (Format::Dxt1, 32, 32, 16, 4, 1, 680));
        assert_data(
            &block.data,
            "3117e15d2f7dd677f7cfbbc8809a607a6f774b7629e3b101f4ea94bd5d30d278",
            "d7 10 0a 08 55 ff aa 00 c9 30 17 28 55 bf 82 00",
        );
        assert!(failures.is_empty());

        let mut named = level(
            Format::A8R8G8B8,
            8,
            8,
            1,
            chain(Format::A8R8G8B8, 8, 8, 1, pattern),
        );
        named.name = "keep_me".to_owned();
        assert!(resample_to(&mut named, 4, &mut failures));
        assert_eq!((named.name.as_str(), named.depth), ("keep_me", 1));
        assert_eq!(shape(&named), (Format::A8R8G8B8, 4, 4, 16, 3, 1, 84));
        assert_data(
            &named.data,
            "795788c93d7962b838271a7053fa5df072d6cb89c58395c6736ddeff634b8101",
            "0a 10 10 ff 18 10 4f ff 26 10 8f ff 34 10 cf ff",
        );

        let mut with_tail = level(
            Format::A8R8G8B8,
            16,
            16,
            5,
            chain(Format::A8R8G8B8, 16, 16, 5, pattern),
        );
        let mut top_only = level(
            Format::A8R8G8B8,
            16,
            16,
            1,
            chain(Format::A8R8G8B8, 16, 16, 1, pattern),
        );
        assert!(resample_to(&mut with_tail, 4, &mut failures));
        assert!(resample_to(&mut top_only, 4, &mut failures));
        assert_eq!(shape(&with_tail), (Format::A8R8G8B8, 4, 4, 16, 3, 1, 84));
        assert_data(
            &with_tail.data,
            "7d33dd3ce08c5fdfa77c543593679faccfadfa3dfca7d03d12dc4c1c3c1fdf0d",
            "1e 17 17 ff 3a 17 57 ff 56 17 97 ff 72 17 d7 ff",
        );
        assert_eq!(with_tail, top_only);

        let mut single = level(
            Format::A8R8G8B8,
            8,
            8,
            1,
            chain(Format::A8R8G8B8, 8, 8, 1, pattern),
        );
        assert!(resample_to(&mut single, 1, &mut failures));
        assert_eq!(shape(&single), (Format::A8R8G8B8, 1, 1, 4, 1, 1, 4));
        assert_eq!(hex(&single.data), "46 6f 6f ff");

        let mut bc7 = level(Format::Bc7, 64, 64, 1, seq(4096));
        assert!(resample_to(&mut bc7, 32, &mut failures));
        assert_eq!(shape(&bc7), (Format::Dxt5, 32, 32, 32, 4, 1, 1360));
        assert_data(
            &bc7.data,
            "6ee4129fd3e716206f16228ae6db219260123119ecddd157921b5b07cf94b9c5",
            "ff ff 00 00 00 00 00 00 8e 89 cd 4e f1 fd f1 fd",
        );
        assert!(failures.is_empty());
    }

    #[test]
    fn resample_in_every_format() {
        // Пф1 – Пф11 (64×64, одна ступень, предел 16)
        let rows: [(Format, usize, usize, &str, &str); 11] = [
            (
                Format::Dxt1,
                3,
                168,
                "aaf2f519c4bd520a4cba845037262236a100464fa47f74aca11ef206a2453bfb",
                "d6 19 2a 18 55 ff aa 00 36 60 c8 59 00 aa ff 55",
            ),
            (
                Format::Dxt3,
                3,
                336,
                "f44c19f956999107338e2dacbb03d389bd0abdc36b7cf504974e51b8ceb1388c",
                "b4 a5 78 88 5a 5b 97 86 d6 19 2a 18 55 ff aa 00",
            ),
            (
                Format::Dxt5,
                3,
                336,
                "34b933a2e19477a7e5a4c53c62cedc04c45ccf8e83de762cadfe7f42ca164468",
                "ba 4b 41 c4 b2 0a 5e 9a d6 19 2a 18 55 ff aa 00",
            ),
            (
                Format::Ati1,
                3,
                168,
                "cbb590fe850e3db9b0780d03da643e2cd389b459820db91e5dc856062f238bd8",
                "34 05 f1 10 0f f1 10 0f 74 45 f1 10 0f f1 10 0f",
            ),
            (
                Format::Ati2,
                3,
                336,
                "ad5d267fb9313f6729a2d12979b45f6dbcf782461cc14369909d036cad4fb809",
                "34 05 f1 10 0f f1 10 0f 34 05 49 62 db db 06 00",
            ),
            (
                Format::Bc7,
                3,
                336,
                "9a75ad99c62d79353ccebeec0edfaf2916cb4563d9f961961dd8e52461bd5dc3",
                "ff ff 00 00 00 00 00 00 71 9c 6b 45 4f 4f 4f 4f",
            ),
            (
                Format::A8R8G8B8,
                5,
                1364,
                "090458fef328e3ef3b01d52d8c8240585622f3da073a9557ed743025a4cb6d8f",
                "1e 05 05 48 3a 05 15 b4 56 05 25 50 72 05 35 ac",
            ),
            (
                Format::X8R8G8B8,
                5,
                1364,
                "090458fef328e3ef3b01d52d8c8240585622f3da073a9557ed743025a4cb6d8f",
                "1e 05 05 48 3a 05 15 b4 56 05 25 50 72 05 35 ac",
            ),
            (
                Format::A8,
                5,
                341,
                "1a139fc9212fbf990dc504ac6198f2d70ae964e62819a42b92ddb2d17cc13909",
                "48 b4 50 ac 48 b4 50 ac 58 a4 60 9c 58 94 70 8c",
            ),
            (
                Format::A8B8G8R8,
                5,
                1364,
                "55c98aac86527698b3ff3199716a8fd7c892eab9c2215f605b8c1070b121acab",
                "05 05 1e 48 15 05 3a b4 25 05 56 50 35 05 72 ac",
            ),
            (
                Format::L8,
                5,
                341,
                "1cdc3850ce3394776b14d3ce16afb7be51f3567f2c9d67047edb7411f1746c1e",
                "05 15 25 35 45 55 65 75 85 95 a5 b5 c5 d5 e5 f5",
            ),
        ];
        for (format, levels, len, digest, head) in rows {
            let data = if format == Format::Bc7 {
                seq(4096)
            } else {
                chain(format, 64, 64, 1, pattern_alpha)
            };
            let mut subject = level(format, 64, 64, 1, data);
            let mut failures = Vec::new();
            assert!(resample_to(&mut subject, 16, &mut failures), "{format:?}");
            assert!(failures.is_empty());
            let output = codec(format).output;
            assert_eq!(
                (
                    subject.format,
                    subject.width,
                    subject.height,
                    subject.levels,
                    subject.data.len()
                ),
                (output, 16, 16, levels, len),
                "{format:?}"
            );
            assert_eq!(subject.stride, stride_of(output, 16), "{format:?}");
            assert_data(&subject.data, digest, head);
        }
    }

    /// Что ждём от пересжатия: байты целиком (короткие) или отпечаток и начало.
    enum Want {
        Untouched,
        Bytes(&'static str),
        Hash(&'static str, &'static str),
    }

    #[test]
    #[allow(clippy::type_complexity)]
    fn resample_boundaries_and_odd_sizes() {
        // Пг1 – Пг26, Пг28 – Пг30; Пг27 и Пг31 (4096² и 8192²) в отладочной сборке слишком долгие
        let a = Format::A8R8G8B8;
        let d1 = Format::Dxt1;
        let d5 = Format::Dxt5;
        use Want::{Bytes, Hash, Untouched};
        #[rustfmt::skip]
        let rows: Vec<(&str, Format, usize, usize, usize, Want, (Format, usize, usize, usize, usize, usize))> = vec![
            ("Пг1", a, 16, 16, 16, Untouched, (a, 16, 16, 64, 1, 1024)),
            ("Пг2", a, 8, 8, 16, Untouched, (a, 8, 8, 32, 1, 256)),
            ("Пг3", a, 1, 1, 0, Untouched, (a, 1, 1, 4, 1, 4)),
            ("Пг4", d1, 4, 4, 2, Untouched, (d1, 4, 4, 2, 1, 8)),
            ("Пг5", d1, 4, 4, 3, Untouched, (d1, 4, 4, 2, 1, 8)),
            ("Пг6", d1, 8, 4, 4, Bytes("e8 75 03 68 55 ff aa 00"), (d1, 4, 4, 2, 1, 8)),
            ("Пг7", d1, 4, 1024, 16, Bytes("90 c1 8f 00 bd ad 2d 2b 10 bb ef 02 2d 2d 2d 2d 70 c5 6f 04 bd ad 2f 2b 70 c7 6f 06 bd ad 2f 2b"), (d1, 4, 16, 2, 1, 32)),
            ("Пг8", d5, 1024, 4, 16, Hash("1e7d0ba9a0034e91f17a48b55bab565b83fdf1a52b484153fc490343a804546c", "ff ff 00 00 00 00 00 00 f0 25 0f 20 55 ff aa 00"), (d5, 16, 4, 16, 1, 64)),
            ("Пг9", a, 1, 1024, 16, Hash("044a187bf59afbec1707a55df53db3318d0c965114859c3d5a698b3e4332304b", "7a 07 00 ff 7e 17 00 ff 82 27 00 ff 86 37 00 ff"), (a, 1, 16, 4, 1, 64)),
            ("Пг10", a, 100, 60, 16, Hash("92e65b6b931297af06743b210e28aadb37aad4316c001192b5608c05439dbce2", "46 0f 09 ff 7e 0f 1d ff b6 0f 33 ff 91 0f 48 ff"), (a, 12, 7, 48, 1, 336)),
            ("Пг11", d1, 100, 60, 16, Bytes("ef 2e f0 28 55 ff aa 00 ef 7e f0 78 55 ff aa 00 ef d6 f0 c8 55 ff aa 00"), (d1, 12, 4, 6, 1, 24)),
            ("Пг12", d1, 100, 100, 16, Hash("9c4b1f5d137f58dc5a576509fab5ab6581ec88362c124dc7c7b1528bda21fce0", "4f 2a 50 28 55 ff aa 00 4f 7a 50 78 55 ff aa 00"), (d1, 12, 12, 6, 1, 72)),
            ("Пг13", d5, 12, 12, 8, Bytes("ff ff 00 00 00 00 00 00 b4 7e a6 70 55 ff aa 00"), (d5, 4, 4, 4, 1, 16)),
            ("Пг14", d1, 20, 20, 8, Hash("6715ec6e98ac5bd9d434c3f40b5e32e1d91f51f9a167dc1287dee4b2efd77d06", "30 3b 25 38 55 ff aa 00 38 b3 2d a8 55 ff aa 00"), (d1, 8, 8, 4, 2, 40)),
            ("Пг15", a, 3, 3, 1, Bytes("14 55 55 ff"), (a, 1, 1, 4, 1, 4)),
            ("Пг16", a, 3, 3, 2, Bytes("14 55 55 ff"), (a, 1, 1, 4, 1, 4)),
            ("Пг17", Format::L8, 5, 7, 3, Bytes("1a 99 1a 99 1a 99"), (Format::L8, 2, 3, 2, 1, 6)),
            ("Пг18", a, 64, 64, 1, Bytes("7f 7d 7d ff"), (a, 1, 1, 4, 1, 4)),
            ("Пг19", d1, 64, 64, 1, Bytes("ef 7e f0 78 55 ff aa 00"), (d1, 4, 4, 2, 1, 8)),
            ("Пг20", d1, 64, 64, 4, Bytes("ef 7e f0 78 55 ff aa 00"), (d1, 4, 4, 2, 1, 8)),
            ("Пг21", d5, 256, 128, 32, Hash("b02da3bf6f2ae7f6a3ede338ab82dc65e55097e4a4738563ed2da24ce2b42ca9", "ff ff 00 00 00 00 00 00 30 10 cf 09 00 aa ff 55"), (d5, 32, 16, 32, 3, 672)),
            ("Пг22", d1, 128, 32, 32, Hash("f13538f74a28a958868364b60f922feb51d543f91762ee5746ea2201b34295ab", "56 13 6a 08 55 ff aa 00 48 33 76 28 55 ff aa 00"), (d1, 32, 8, 16, 2, 160)),
            ("Пг23", d1, 128, 32, 16, Bytes("f0 20 cf 1e 00 aa ff 55 d0 66 ee 58 55 ff aa 00 d0 a6 ef 98 55 ff aa 00 cf de ef d8 55 ff aa 00"), (d1, 16, 4, 8, 1, 32)),
            ("Пг24", Format::L8, 2, 1, 1, Bytes("40"), (Format::L8, 1, 1, 1, 1, 1)),
            ("Пг25", a, 6, 4, 2, Bytes("25 5f 6a ff"), (a, 1, 1, 4, 1, 4)),
            ("Пг30", Format::A8, 8192, 4, 4096, Hash("60fca11cc26532222f1c8ba09d64a2a4c72f0b16222663d412b926a23d202fc9", "ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff"), (Format::A8, 4096, 2, 4096, 2, 10240)),
        ];
        for (label, format, w, h, cap, want, shape_after) in rows {
            let original = level(format, w, h, 1, chain(format, w, h, 1, pattern));
            let mut subject = original.clone();
            let mut failures = Vec::new();
            let done = resample_to(&mut subject, cap, &mut failures);
            assert!(failures.is_empty(), "{label}");
            let (out_format, out_w, out_h, out_stride, out_levels, out_len) = shape_after;
            match want {
                Untouched => {
                    assert!(!done, "{label}");
                    assert_eq!(subject, original, "{label}");
                    continue;
                }
                Bytes(text) => assert_eq!(hex(&subject.data), text, "{label}"),
                Hash(digest, head) => assert_data(&subject.data, digest, head),
            }
            assert!(done, "{label}");
            assert_eq!(
                shape(&subject),
                (out_format, out_w, out_h, out_stride, out_levels, 1, out_len),
                "{label}"
            );
        }

        // Пг26: 4096×4096 при пределе 4096 не трогается, Пг28, Пг29: сторона больше 8192
        let mut huge = level(Format::Dxt1, 4096, 4096, 1, vec![0x33; 8388608]);
        assert!(!resample_to(&mut huge, 4096, &mut Vec::new()));
        for (w, h) in [(8193, 4), (4, 8193)] {
            let mut long = level(Format::A8, w, h, 1, vec![255; w * h]);
            assert!(!resample_to(&mut long, 4096, &mut Vec::new()));
            assert_eq!((long.width, long.height, long.data.len()), (w, h, w * h));
        }
    }

    #[test]
    fn resample_refuses_inconsistent_input_untouched() {
        // По1 – По6
        let top = chain(Format::Dxt1, 64, 64, 1, pattern);
        let mut short = top.clone();
        short.pop();
        let refusals = [
            ("По1", level(Format::Dxt1, 64, 64, 1, short), 16),
            (
                "По2",
                Level {
                    stride: 33,
                    ..level(Format::Dxt1, 64, 64, 1, top.clone())
                },
                16,
            ),
            (
                "По3",
                Level {
                    depth: 2,
                    ..level(Format::Dxt1, 64, 64, 1, top.clone())
                },
                16,
            ),
            ("По4", level(Format::Dxt1, 64, 64, 1, Vec::new()), 16),
            (
                "По5",
                Level {
                    width: 0,
                    stride: 0,
                    ..level(Format::Dxt1, 64, 64, 1, top.clone())
                },
                16,
            ),
            (
                "По6",
                Level {
                    height: 0,
                    ..level(Format::A8R8G8B8, 4, 4, 1, vec![0; 16])
                },
                2,
            ),
        ];
        for (label, original, cap) in refusals {
            let mut subject = original.clone();
            let mut failures = vec!["прежняя строка".to_owned()];
            assert!(!resample_to(&mut subject, cap, &mut failures), "{label}");
            assert_eq!(subject, original, "{label}");
            assert_eq!(failures, vec!["прежняя строка".to_owned()], "{label}");
        }
    }

    #[test]
    fn levels_compare_and_clone_by_value() {
        // Мс5, Мс6
        let original = level(Format::Dxt1, 4, 4, 1, vec![1; 8]);
        assert_eq!(original.clone(), original);
        let renamed = Level {
            name: "other".to_owned(),
            ..original.clone()
        };
        assert_ne!(renamed, original);
        assert!(format!("{original:?}").starts_with("Level {"));
    }

    #[test]
    fn a_full_chain_from_a_game_file_is_seen_and_cut_the_way_the_host_does() {
        // DXT1 128×128, 8 ступеней до 1×1: файл игры держит хвост блоками (10 936 байт), хост видит 10 922 (замер 16.11:
        // `nxg_im_branches_23`, `clothdenim03_dn` и другие полные цепочки хост режет, а не пересжимает).
        let format = Format::Dxt1;
        let whole = ytd_write::payload_bytes(format, 128, 128, 8);
        assert_eq!(whole, 10_936);
        let data = seq(whole);
        let mut subject = level(format, 128, 128, 8, data.clone());
        assert!(!drop_to(&mut subject, 64), "полная цепочка в длине файла игры до чтения не срезается");
        as_host_sees(&mut subject);
        assert_eq!(subject.data, data[..10_922], "хвост отброшен, начало то же");
        assert!(drop_to(&mut subject, 64));
        assert_eq!(shape(&subject), (format, 64, 64, 32, 7, 1, 2730));
        assert_eq!(subject.data, data[8192..8192 + 2730], "срез — те же байты, без пересжатия");

        // Запись возвращает хвост нулями до длины писателя.
        let stored = stored_bytes(&subject);
        assert_eq!(stored.len(), ytd_write::payload_bytes(format, 64, 64, 7));
        assert_eq!(stored[..2730], subject.data[..]);
        assert!(stored[2730..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn data_that_is_not_the_file_layout_is_left_alone() {
        let whole = ytd_write::payload_bytes(Format::Dxt1, 128, 128, 8);
        let short = level(Format::Dxt1, 128, 128, 8, seq(whole - 3));
        let mut subject = short.clone();
        as_host_sees(&mut subject);
        assert_eq!(subject, short, "длина не равна длине файла игры");

        let mut odd = level(Format::Dxt1, 100, 100, 3, seq(ytd_write::payload_bytes(Format::Dxt1, 100, 100, 3)));
        let before = odd.clone();
        as_host_sees(&mut odd);
        assert_eq!(odd, before, "размеры не степени двойки");

        let mut shallow = level(Format::Dxt1, 64, 64, 4, seq(ytd_write::payload_bytes(Format::Dxt1, 64, 64, 4)));
        let before = shallow.clone();
        as_host_sees(&mut shallow);
        assert_eq!(shallow, before, "цепочка до 8×8: хвоста короче блока нет");
    }
}
