//! Сжатие кадра RGBA8 в блоки BC1, BC2, BC3, BC4 и BC5 (DXT1, DXT3, DXT5, ATI1, ATI2).
//!
//! Порт кодера DirectXTex без дополнительных флагов (у BC1 нет режима «три цвета и
//! прозрачный», дизеринга нет). Байты зависят от порядка и точности каждой операции
//! над `f32`: умножение со сложением не сливаются, константы получаются делением
//! `f32`, суммы идут слева направо. BC7 здесь не кодируется.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BcFormat {
    Bc1,
    Bc2,
    Bc3,
    Bc4,
    Bc5,
}

impl BcFormat {
    pub fn block_bytes(self) -> usize {
        if matches!(self, BcFormat::Bc1 | BcFormat::Bc4) {
            8
        } else {
            16
        }
    }

    /// Из каких частей собирается блок формата, по порядку.
    fn parts(self) -> &'static [Part] {
        match self {
            BcFormat::Bc1 => &[Part::Colour],
            BcFormat::Bc2 => &[Part::Nibbles, Part::Colour],
            BcFormat::Bc3 => &[Part::Ramp, Part::Colour],
            BcFormat::Bc4 => &[Part::Plane(0)],
            BcFormat::Bc5 => &[Part::Plane(0), Part::Plane(1)],
        }
    }
}

#[derive(Clone, Copy)]
enum Part {
    Colour,
    Nibbles,
    Ramp,
    Plane(usize),
}

impl Part {
    fn encode(self, block: &Block) -> [u8; 8] {
        match self {
            Part::Colour => colour_block(block),
            Part::Nibbles => nibble_alpha(block),
            Part::Ramp => ramp_alpha(block),
            Part::Plane(channel) => plane_block(block, channel),
        }
    }
}

/// Четыре канала одного текселя; блок — 16 текселей (`строка × 4 + столбец`).
type Texel = [f32; 4];
type Block = [Texel; 16];

const INV_255: f32 = 1.0 / 255.0;
const INV_31: f32 = 1.0 / 31.0;
const INV_63: f32 = 1.0 / 63.0;

/// Веса яркости (относительно зелёного) и обратные им.
const LUMA: Rgb = Rgb([0.2125f32 / 0.7154f32, 1.0, 0.0721f32 / 0.7154f32]);
const LUMA_BACK: Rgb = Rgb([0.7154f32 / 0.2125f32, 1.0, 0.7154f32 / 0.0721f32]);

/// Порог «нет роста» цветового подбора: (0.25/64)².
const GROWTH_EPS: f32 = (0.25f32 / 64.0f32) * (0.25f32 / 64.0f32);
const TINY_SPAN: f32 = 1.0 / 4096.0;
const PASSES: usize = 8;

/// Откуда берётся недостающий край блока: столбцы и строки 0, 0, 0, 1.
const EDGE_SOURCE: [usize; 4] = [0, 0, 0, 1];

/// Сжимает кадр; `None`, если сторона нулевая или буфер не равен `w × h × 4`.
pub fn compress(rgba: &[u8], width: usize, height: usize, format: BcFormat) -> Option<Vec<u8>> {
    if width.min(height) == 0 || rgba.len() != width * height * 4 {
        return None;
    }
    let (across, down) = (width.div_ceil(4), height.div_ceil(4));
    let mut out = Vec::with_capacity(across * down * format.block_bytes());
    let corners = (0..down).flat_map(|row| (0..across).map(move |col| (col * 4, row * 4)));
    for (x0, y0) in corners {
        let block = load_block(rgba, width, height, x0, y0);
        for part in format.parts() {
            out.extend_from_slice(&part.encode(&block));
        }
    }
    Some(out)
}

/// Блок с началом `(x0, y0)`; нехватка по краю добирается по таблице `EDGE_SOURCE`
/// (четвёртая строка или столбец трёхпиксельного края повторяет вторую, не третью).
fn load_block(rgba: &[u8], width: usize, height: usize, x0: usize, y0: usize) -> Block {
    let (cols, rows) = ((width - x0).min(4), (height - y0).min(4));
    let existing = |wanted: usize, have: usize| {
        let mut at = wanted;
        while at >= have {
            at = EDGE_SOURCE[at];
        }
        at
    };
    std::array::from_fn(|k| {
        let at = ((y0 + existing(k / 4, rows)) * width + x0 + existing(k % 4, cols)) * 4;
        [0, 1, 2, 3].map(|c| f32::from(rgba[at + c]) * INV_255)
    })
}

// ---------------------------------------------------------------------------
// Тройки RGB
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Rgb([f32; 3]);

impl Rgb {
    fn of(t: &Texel) -> Rgb {
        Rgb([t[0], t[1], t[2]])
    }

    fn zip(self, other: Rgb, f: impl Fn(f32, f32) -> f32) -> Rgb {
        Rgb(std::array::from_fn(|c| f(self.0[c], other.0[c])))
    }

    fn map(self, f: impl Fn(f32) -> f32) -> Rgb {
        Rgb(self.0.map(f))
    }

    fn minus(self, other: Rgb) -> Rgb {
        self.zip(other, |a, b| a - b)
    }

    fn times(self, other: Rgb) -> Rgb {
        self.zip(other, |a, b| a * b)
    }

    fn scaled(self, k: f32) -> Rgb {
        self.map(|v| v * k)
    }

    /// Скалярное произведение: `(a0·b0 + a1·b1) + a2·b2`.
    fn dot(self, other: Rgb) -> f32 {
        self.times(other).0.into_iter().reduce(|a, b| a + b).unwrap_or(0.0)
    }
}

/// Меньшее из двух; при равенстве остаётся первое.
fn lesser(kept: f32, seen: f32) -> f32 {
    if seen < kept {
        seen
    } else {
        kept
    }
}

fn greater(kept: f32, seen: f32) -> f32 {
    if seen > kept {
        seen
    } else {
        kept
    }
}

// ---------------------------------------------------------------------------
// Цветовой блок BC1 (общий для BC1, BC2, BC3)
// ---------------------------------------------------------------------------

/// Веса концов отрезка из четырёх ступеней: у нижнего и у верхнего конца.
fn ramp_weights4() -> [[f32; 4]; 2] {
    [[1.0, 2.0 / 3.0, 1.0 / 3.0, 0.0], [0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0]]
}

/// Подбор концов отрезка по шестнадцати взвешенным точкам.
fn fit_colour_ends(points: &[Rgb; 16]) -> [Rgb; 2] {
    let lo = points.iter().fold(LUMA, |kept, p| kept.zip(*p, lesser));
    let hi = points.iter().fold(Rgb([0.0; 3]), |kept, p| kept.zip(*p, greater));
    let mut ends = [lo, hi];
    let span = hi.minus(lo);
    let span_sq = span.dot(span);
    if span_sq < f32::MIN_POSITIVE {
        return ends;
    }
    let inv = 1.0 / span_sq;
    let dir = span.map(|v| v * inv);
    let mid = lo.zip(hi, |a, b| a + b).scaled(0.5);
    // Знаки каналов четырёх «диагоналей»: побеждает та, что сильнее разводит точки.
    const SIGNS: [Rgb; 4] = [Rgb([1.0, 1.0, 1.0]), Rgb([1.0, 1.0, -1.0]), Rgb([1.0, -1.0, 1.0]), Rgb([1.0, -1.0, -1.0])];
    let energy = points.iter().fold([0.0f32; 4], |acc, p| {
        let q = p.minus(mid).times(dir);
        let mut next = acc;
        next.iter_mut().zip(SIGNS).for_each(|(sum, sign)| {
            let s = q.dot(sign);
            *sum += s * s;
        });
        next
    });
    let best = (1..4).fold(0, |top, k| if energy[k] > energy[top] { k } else { top });
    for (bit, channel) in [(2, 1), (1, 2)] {
        if best & bit != 0 {
            let (a, b) = (ends[0].0[channel], ends[1].0[channel]);
            ends[0].0[channel] = b;
            ends[1].0[channel] = a;
        }
    }
    if span_sq < TINY_SPAN {
        return ends;
    }
    let weights = ramp_weights4();
    for _ in 0..PASSES {
        let steps: [Rgb; 4] = std::array::from_fn(|s| {
            Rgb(std::array::from_fn(|c| ends[0].0[c] * weights[0][s] + ends[1].0[c] * weights[1][s]))
        });
        let d = ends[1].minus(ends[0]);
        let len_sq = d.dot(d);
        if len_sq < TINY_SPAN {
            break;
        }
        let d = d.scaled(3.0 / len_sq);
        // Для каждого из концов: сумма весов в квадрате и тяга по каналам.
        let mut hess = [0.0f32; 2];
        let mut pull = [Rgb([0.0; 3]); 2];
        for p in points {
            let dot = p.minus(ends[0]).dot(d);
            let s = if dot <= 0.0 {
                0
            } else if dot >= 3.0 {
                3
            } else {
                (dot + 0.5) as usize
            };
            let diff = steps[s].minus(*p);
            for end in 0..2 {
                let fc = weights[end][s] * 0.125;
                hess[end] += fc * weights[end][s];
                pull[end] = pull[end].zip(diff, |acc, v| acc + fc * v);
            }
        }
        for end in 0..2 {
            if hess[end] > 0.0 {
                let g = -1.0 / hess[end];
                ends[end] = ends[end].zip(pull[end], |at, v| at + v * g);
            }
        }
        if pull.iter().all(|p| p.0.iter().all(|v| v * v < GROWTH_EPS)) {
            break;
        }
    }
    ends
}

/// Слово 5:6:5 по цвету, зажатому в [0, 1].
fn pack565(color: Rgb) -> u16 {
    const SCALE: [f32; 3] = [31.0, 63.0, 31.0];
    let [r, g, b] = std::array::from_fn(|c| (color.0[c].clamp(0.0, 1.0) * SCALE[c] + 0.5) as u16);
    (r << 11) | (g << 5) | b
}

/// Взвешенный цвет, в который раскодируется слово 5:6:5.
fn unpack565(word: u16) -> Rgb {
    const BACK: [f32; 3] = [INV_31, INV_63, INV_31];
    let parts = [(word >> 11) & 31, (word >> 5) & 63, word & 31];
    Rgb(std::array::from_fn(|c| f32::from(parts[c]) * BACK[c] * LUMA.0[c]))
}

fn colour_block(block: &Block) -> [u8; 8] {
    const SCALE: [f32; 3] = [31.0, 63.0, 31.0];
    const BACK: [f32; 3] = [INV_31, INV_63, INV_31];
    let snapped: [Rgb; 16] = block.map(|t| {
        Rgb(std::array::from_fn(|c| (((t[c] * SCALE[c] + 0.5) as i32) as f32 * BACK[c]) * LUMA.0[c]))
    });
    let words = fit_colour_ends(&snapped).map(|end| pack565(end.times(LUMA_BACK)));
    let mut out = [0u8; 8];
    if words[0] == words[1] {
        out[..2].copy_from_slice(&words[0].to_le_bytes());
        out[2..4].copy_from_slice(&words[1].to_le_bytes());
        return out;
    }
    let (c0, c1) = (words[0].max(words[1]), words[0].min(words[1]));
    out[..2].copy_from_slice(&c0.to_le_bytes());
    out[2..4].copy_from_slice(&c1.to_le_bytes());
    let (p0, p1) = (unpack565(c0), unpack565(c1));
    let axis = p1.minus(p0);
    let along = axis.scaled(3.0 / axis.dot(axis));
    // Ступень вдоль отрезка (0, 1, 2, 3) → код индекса (0, 2, 3, 1).
    const CODE: [u32; 4] = [0, 2, 3, 1];
    let indices = block.iter().enumerate().fold(0u32, |bits, (i, t)| {
        let dot = Rgb::of(t).times(LUMA).minus(p0).dot(along);
        let code = if dot <= 0.0 {
            0
        } else if dot >= 3.0 {
            1
        } else {
            CODE[(dot + 0.5) as usize]
        };
        bits | (code << (2 * i))
    });
    out[4..].copy_from_slice(&indices.to_le_bytes());
    out
}

// ---------------------------------------------------------------------------
// Альфа BC2 и BC3
// ---------------------------------------------------------------------------

fn nibble_alpha(block: &Block) -> [u8; 8] {
    block
        .iter()
        .enumerate()
        .fold(0u64, |word, (i, t)| word | (((t[3] * 15.0 + 0.5) as u64) << (4 * i)))
        .to_le_bytes()
}

/// Наименьшее и наибольшее значение: сперва `<` на минимум, иначе `>` на максимум.
fn extremes(values: &[f32; 16]) -> (f32, f32) {
    values.iter().fold((values[0], values[0]), |(lo, hi), &v| {
        if v < lo {
            (v, hi)
        } else if v > hi {
            (lo, v)
        } else {
            (lo, hi)
        }
    })
}

/// Коды по порядку ступеней вдоль отрезка для шести и для восьми ступеней.
const CODES_SIX: [u64; 6] = [0, 2, 3, 4, 5, 1];
const CODES_EIGHT: [u64; 8] = [0, 2, 3, 4, 5, 6, 7, 1];

fn ramp_alpha(block: &Block) -> [u8; 8] {
    let alpha: [f32; 16] = block.map(|t| t[3]);
    let rounded = alpha.map(|a| (((a * 255.0 + 0.5) as i32) as f32) * INV_255);
    let (amin, amax) = extremes(&rounded);
    if amin == 1.0 {
        return [0xff, 0xff, 0, 0, 0, 0, 0, 0];
    }
    let six = amin == 0.0 || amax == 1.0;
    let steps = if six { 6 } else { 8 };
    let [fa, fb] = fit_channel(&rounded, steps).map(|f| (f * 255.0 + 0.5) as u8);
    if !six && fa == fb {
        return [fa, fb, 0, 0, 0, 0, 0, 0];
    }
    // Шесть ступеней: младший конец первым; восемь: старший.
    let (first, second) = if six { (fa, fb) } else { (fb, fa) };
    let [f0, f1] = [first, second].map(|b| f32::from(b) * INV_255);
    let top = (steps - 1) as f32;
    let rate = if f0 != f1 { top / (f1 - f0) } else { 0.0 };
    let table: &[u64] = if six { &CODES_SIX } else { &CODES_EIGHT };
    let bits = alpha.iter().enumerate().fold(0u64, |word, (i, &a)| {
        let dot = (a - f0) * rate;
        let code = if dot <= 0.0 {
            if six && a <= f0 * 0.5 {
                6
            } else {
                0
            }
        } else if dot >= top {
            if six && a >= (f1 + 1.0) * 0.5 {
                7
            } else {
                1
            }
        } else {
            table[(dot + 0.5) as usize]
        };
        word | (code << (3 * i))
    });
    let mut out = [0u8; 8];
    out[0] = first;
    out[1] = second;
    out[2..].copy_from_slice(&bits.to_le_bytes()[..6]);
    out
}

/// Подбор концов для одного значения на тексель; `steps` — 6 или 8.
fn fit_channel(values: &[f32; 16], steps: usize) -> [f32; 2] {
    let divisor = (steps - 1) as f32;
    let weights: [[f32; 8]; 2] = [
        std::array::from_fn(|s| if s < steps { (divisor - s as f32) / divisor } else { 0.0 }),
        std::array::from_fn(|s| if s < steps { s as f32 / divisor } else { 0.0 }),
    ];
    // Шесть ступеней: значения ровно 0 и 1 в поиск крайних не входят.
    let six = steps == 6;
    let mut ends = values.iter().fold([1.0f32, 0.0], |[x, y], &v| {
        [if (!six || v > 0.0) && v < x { v } else { x }, if (!six || v < 1.0) && v > y { v } else { y }]
    });
    if six && ends[0] == ends[1] {
        ends[1] = 1.0;
    }
    for _ in 0..PASSES {
        if (ends[1] - ends[0]) < 1.0 / 256.0 {
            break;
        }
        let rate = divisor / (ends[1] - ends[0]);
        let ramp: [f32; 8] = std::array::from_fn(|s| weights[0][s] * ends[0] + weights[1][s] * ends[1]);
        // На каждый из концов: сумма «тяги» и сумма квадратов весов.
        let mut acc = [(0.0f32, 0.0f32); 2];
        for &v in values {
            let dot = (v - ends[0]) * rate;
            let s = if dot <= 0.0 {
                if six && v <= ends[0] * 0.5 {
                    6
                } else {
                    0
                }
            } else if dot >= divisor {
                if six && v >= (ends[1] + 1.0) * 0.5 {
                    7
                } else {
                    steps - 1
                }
            } else {
                (dot + 0.5) as usize
            };
            if s < steps {
                let diff = ramp[s] - v;
                for (cell, w) in acc.iter_mut().zip(&weights) {
                    cell.0 += w[s] * diff;
                    cell.1 += w[s] * w[s];
                }
            }
        }
        for (end, &(pull, hess)) in ends.iter_mut().zip(&acc) {
            if hess > 0.0 {
                *end -= pull / hess;
            }
        }
        if ends[0] > ends[1] {
            ends.swap(0, 1);
        }
        if acc.iter().all(|&(pull, _)| pull * pull < 1.0 / 64.0) {
            break;
        }
    }
    ends.map(|f| f.clamp(0.0, 1.0))
}

// ---------------------------------------------------------------------------
// BC4 и BC5
// ---------------------------------------------------------------------------

fn plane_block(block: &Block, channel: usize) -> [u8; 8] {
    let values: [f32; 16] = block.map(|t| t[channel]);
    let (vmin, vmax) = extremes(&values);
    let bordered = vmin == 0.0 || vmax == 1.0;
    let [start, end] = fit_channel(&values, if bordered { 6 } else { 8 }).map(|f| (f * 255.0) as u8);
    // С границей концы идут как есть, без неё — старший первым.
    let (red0, red1) = if bordered { (start, end) } else { (end, start) };
    let [f0, f1] = [red0, red1].map(|r| f32::from(r) / 255.0);
    let wide = red0 > red1;
    let span = if wide { 7.0 } else { 5.0 };
    let gradient: [f32; 8] = std::array::from_fn(|k| {
        let u = k as f32 - 1.0;
        match k {
            0 => f0,
            1 => f1,
            6 | 7 if !wide => (k - 6) as f32,
            _ => (f0 * (span - u) + f1 * u) / span,
        }
    });
    let head = u64::from(red0) | (u64::from(red1) << 8);
    values
        .iter()
        .enumerate()
        .fold(head, |word, (i, &v)| {
            // Ближайшая ступень, при равенстве — меньший номер.
            let pick = (0..8)
                .min_by(|&a, &b| (gradient[a] - v).abs().total_cmp(&(gradient[b] - v).abs()))
                .unwrap_or(0);
            word | ((pick as u64) << (16 + 3 * i))
        })
        .to_le_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_block_encodes_to_its_colour() {
        let rgba = [200u8, 100, 50, 255].repeat(16);
        let bytes = compress(&rgba, 4, 4, BcFormat::Bc1).unwrap();
        assert_eq!(bytes.len(), 8);
        assert_eq!(bytes[0..2], bytes[2..4]);
        assert_eq!(bytes[4..8], [0, 0, 0, 0]);
        assert_eq!(bytes, [0x26, 0xc3, 0x26, 0xc3, 0, 0, 0, 0]);
    }

    #[test]
    fn sizes_follow_the_block_grid() {
        let buffer = vec![9u8; 120];
        assert_eq!(compress(&buffer, 6, 5, BcFormat::Bc3).unwrap().len(), 2 * 2 * 16);
        assert_eq!(compress(&buffer, 6, 5, BcFormat::Bc4).unwrap().len(), 2 * 2 * 8);
        assert!(compress(&buffer[1..], 6, 5, BcFormat::Bc1).is_none());
        assert!(compress(&buffer, 0, 5, BcFormat::Bc1).is_none());
        assert!(compress(&buffer, 6, 0, BcFormat::Bc5).is_none());
        assert_eq!([BcFormat::Bc1, BcFormat::Bc2, BcFormat::Bc3, BcFormat::Bc4, BcFormat::Bc5].map(BcFormat::block_bytes), [8, 16, 16, 8, 16]);
    }

    #[test]
    fn flat_extremes_pin_the_single_channel_endpoints() {
        // 255 плоский: red0 = 255, все индексы 0; 0 плоский: red0 = 255, red1 = 0, индексы 1
        let white = compress(&[255u8; 64], 4, 4, BcFormat::Bc4).unwrap();
        assert_eq!(white, [0xff, 0x00, 0, 0, 0, 0, 0, 0]);
        let black = compress(&[0, 0, 0, 255].repeat(16), 4, 4, BcFormat::Bc4).unwrap();
        assert_eq!(black, [0xff, 0x00, 0x49, 0x92, 0x24, 0x49, 0x92, 0x24]);
        // красный от 0 до 240 через 16: в блоке есть ноль, берётся шестиступенчатая раскладка
        let ramp: Vec<u8> = (0..16u8).flat_map(|i| [i * 16, 0, 5, 255]).collect();
        let bc4 = compress(&ramp, 4, 4, BcFormat::Bc4).unwrap();
        assert_eq!(bc4, [0x14, 0xe8, 0x06, 0x24, 0x6d, 0x24, 0xdb, 0x26]);
    }

    #[test]
    fn narrow_edges_repeat_the_second_column_and_row() {
        // ширина 3: четвёртый столбец блока копирует второй, а не третий
        let rgba: Vec<u8> = (0..3).flat_map(|x| [x * 90, 10, 20, 255]).collect();
        let block = load_block(&rgba, 3, 1, 0, 0);
        let reds: Vec<u8> = block.iter().take(4).map(|t| (t[0] * 255.0 + 0.5) as u8).collect();
        assert_eq!(reds, [0, 90, 180, 90]);
        assert_eq!(block[4], block[0]);
        assert_eq!(block[8], block[0]);
        assert_eq!(block[12], block[4]);
    }
}

#[cfg(test)]
mod quality {
    use super::*;
    use crate::texture::{self, Format};

    /// Шумная картинка с градиентом и дырами по альфе (генератор тот же, что у проб).
    fn image(w: usize, h: usize, seed: u32) -> Vec<u8> {
        let mut state = seed;
        let mut out = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = (state >> 28) as i32;
                out.push((x * 255 / w.max(2)) as u8);
                out.push((y * 255 / h.max(2)) as u8);
                out.push((128 + noise * 4 - 32).clamp(0, 255) as u8);
                out.push(if (x + y) % 5 == 0 { 0 } else { 255 });
            }
        }
        out
    }

    fn psnr(a: &[u8], b: &[u8], channels: &[usize]) -> f64 {
        let (mut sum, mut n) = (0.0f64, 0usize);
        for (p, q) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
            for &c in channels {
                let d = f64::from(p[c]) - f64::from(q[c]);
                sum += d * d;
                n += 1;
            }
        }
        if sum == 0.0 {
            99.0
        } else {
            10.0 * (255.0 * 255.0 / (sum / n as f64)).log10()
        }
    }

    #[test]
    fn decoded_encodings_stay_close_to_the_source() {
        let cases: [(BcFormat, Format, &[usize]); 5] = [
            (BcFormat::Bc1, Format::Dxt1, &[0, 1, 2]),
            (BcFormat::Bc2, Format::Dxt3, &[0, 1, 2, 3]),
            (BcFormat::Bc3, Format::Dxt5, &[0, 1, 2, 3]),
            (BcFormat::Bc4, Format::Ati1, &[0]),
            (BcFormat::Bc5, Format::Ati2, &[0, 1]),
        ];
        for (encoder, decoder, channels) in cases {
            for (w, h) in [(16usize, 16usize), (33, 31), (7, 7)] {
                let source = image(w, h, 7 + w as u32);
                let packed = compress(&source, w, h, encoder).unwrap();
                let decoded = texture::decode_pixels(decoder, &packed, w, h).unwrap();
                let score = psnr(&source, &decoded, channels);
                assert!(score >= 20.0, "{encoder:?} {w}x{h}: {score}");
            }
        }
    }
}
