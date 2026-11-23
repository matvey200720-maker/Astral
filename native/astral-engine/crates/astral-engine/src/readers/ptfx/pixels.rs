//! Пиксельный путь превью листов эффектов.
//!
//! Превью обязаны совпасть с прежним JS-читателем по пикселям без допуска, а
//! общий декодер блочных форматов в `rage-res` округляет иначе. Поэтому здесь
//! свой разбор DXT1/DXT3/DXT5, уменьшение со взвешиванием по альфе и выбор
//! самого «видного» кадра листа. Округления повторяют JavaScript: запись в
//! `Uint8ClampedArray` — к ближайшему, ничья к чётному; `Math.round` — пол от
//! суммы с 0,5. Модуль чистый: ни диска, ни других модулей крейта.

use std::{cmp::Ordering, ops::Range};

/// Блочный формат сжатия.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dxt {
    Dxt1,
    Dxt3,
    Dxt5,
}

impl Dxt {
    /// Байт на блок 4×4.
    const fn block_len(self) -> usize {
        match self {
            Dxt::Dxt1 => 8,
            Dxt::Dxt3 | Dxt::Dxt5 => 16,
        }
    }

    /// Где в блоке начинается цветовая половина: у DXT1 — с нуля, у DXT3/DXT5 — после альфы.
    const fn colour_offset(self) -> usize {
        self.block_len() - 8
    }
}

/// Запись числа в `Uint8ClampedArray`: NaN и всё не больше нуля — 0, от 255 — 255,
/// между ними ближайшее целое, ничья уходит к чётному.
pub fn clamped(value: f64) -> u8 {
    if value.is_nan() || value <= 0.0 {
        return 0;
    }
    if value >= 255.0 {
        return 255;
    }
    let whole = value.floor();
    let base = whole as u8;
    match (value - whole).partial_cmp(&0.5) {
        Some(Ordering::Less) => base,
        Some(Ordering::Greater) => base + 1,
        _ => base + (base & 1),
    }
}

/// `Math.round` для неотрицательных чисел.
pub fn math_round(value: f64) -> f64 {
    let shifted = value + 0.5;
    shifted.floor()
}

/// 5-6-5 → три канала по 8 бит. Старшие биты значения дублируются в младшие:
/// пять бит — `v·33/4`, шесть — `v·65/16` (0 даёт 0, максимум даёт 255).
fn unpack565(code: u16) -> [u8; 3] {
    let red = (code >> 11) & 0x1f;
    let green = (code >> 5) & 0x3f;
    let blue = code & 0x1f;
    [
        ((red * 33) >> 2) as u8,
        ((green * 65) >> 4) as u8,
        ((blue * 33) >> 2) as u8,
    ]
}

/// Четыре цвета блока по его цветовой половине (первые 8 байт этой половины).
fn colour_palette(half: &[u8], four_colour_only: bool) -> [[u8; 4]; 4] {
    let [code0, code1] = [0usize, 2].map(|at| u16::from_le_bytes([half[at], half[at + 1]]));
    let ends = [unpack565(code0), unpack565(code1)];
    let solid = |rgb: [u8; 3]| [rgb[0], rgb[1], rgb[2], 255];
    // Промежуточный цвет: по каналам `(w0·a + w1·b + bias) / div` через `clamped`.
    let between = |weights: (f64, f64), bias: f64, div: f64| -> [u8; 4] {
        std::array::from_fn(|channel| match channel {
            3 => 255,
            _ => clamped(
                (weights.0 * f64::from(ends[0][channel])
                    + weights.1 * f64::from(ends[1][channel])
                    + bias)
                    / div,
            ),
        })
    };
    let inner = if four_colour_only || code0 > code1 {
        [between((2.0, 1.0), 1.0, 3.0), between((1.0, 2.0), 1.0, 3.0)]
    } else {
        [between((1.0, 1.0), 0.0, 2.0), [0, 0, 0, 0]]
    };
    [solid(ends[0]), solid(ends[1]), inner[0], inner[1]]
}

/// Восемь ступеней альфы DXT5 по двум крайним значениям.
fn dxt5_steps(a0: u8, a1: u8) -> [u8; 8] {
    let (lo, hi) = (f64::from(a0), f64::from(a1));
    // Семь делений при a0 > a1; иначе пять, а хвост занимают 0 и 255.
    let (reach, parts) = if a0 > a1 {
        (8usize, 7.0)
    } else {
        (6usize, 5.0)
    };
    std::array::from_fn(|k| match k {
        0 => a0,
        1 => a1,
        _ if k < reach => {
            let k = k as f64;
            clamped(((reach as f64 - k) * lo + (k - 1.0) * hi) / parts)
        }
        6 => 0,
        _ => 255,
    })
}

/// Альфа шестнадцати пикселей блока; `None` у DXT1 (там альфа берётся у цвета палитры).
fn block_alpha(format: Dxt, block: &[u8]) -> Option<[u8; 16]> {
    match format {
        Dxt::Dxt1 => None,
        Dxt::Dxt3 => {
            // Два пикселя на байт: младший полубайт — чётному.
            let mut alpha = [0u8; 16];
            for (pair, byte) in alpha.chunks_exact_mut(2).zip(&block[..8]) {
                pair[0] = (byte & 0x0f) * 17;
                pair[1] = (byte >> 4) * 17;
            }
            Some(alpha)
        }
        Dxt::Dxt5 => {
            let steps = dxt5_steps(block[0], block[1]);
            // Индексы — три бита на пиксель в одном 48-битном слове, младшим вперёд.
            let bits = block[2..8]
                .iter()
                .rev()
                .fold(0u64, |word, byte| (word << 8) | u64::from(*byte));
            Some(std::array::from_fn(|i| {
                steps[((bits >> (3 * i)) & 7) as usize]
            }))
        }
    }
}

/// Шестнадцать пикселей блока RGBA, по строкам блока.
fn decode_block(format: Dxt, block: &[u8]) -> [[u8; 4]; 16] {
    let half = &block[format.colour_offset()..];
    let palette = colour_palette(half, format != Dxt::Dxt1);
    let selectors = u32::from_le_bytes([half[4], half[5], half[6], half[7]]);
    let alpha = block_alpha(format, block);
    std::array::from_fn(|i| {
        let mut px = palette[((selectors >> (2 * i)) & 3) as usize];
        if let Some(own) = &alpha {
            px[3] = own[i];
        }
        px
    })
}

/// Блочная картинка в RGBA. Данных должно хватить на все блоки (блоков по оси не
/// меньше одного), хвост игнорируется.
pub fn decode_dxt(
    format: Dxt,
    data: &[u8],
    width: usize,
    height: usize,
) -> Result<Vec<u8>, String> {
    let (across, down) = (width.div_ceil(4).max(1), height.div_ceil(4).max(1));
    let needed = across * down;
    let stride = format.block_len();
    if data.len() < needed * stride {
        return Err(format!("блоков {}, а байт {}", needed, data.len()));
    }
    let blocks: Vec<[[u8; 4]; 16]> = data
        .chunks_exact(stride)
        .take(needed)
        .map(|block| decode_block(format, block))
        .collect();
    // Дальше идём по пикселям результата: пиксель берётся из своего блока.
    let mut out = vec![0u8; width * height * 4];
    for (at, pixel) in out.chunks_exact_mut(4).enumerate() {
        let (x, y) = (at % width, at / width);
        pixel.copy_from_slice(&blocks[(y / 4) * across + x / 4][(y % 4) * 4 + x % 4]);
    }
    Ok(out)
}

/// Накопитель окна уменьшения: цвет с весом альфы.
#[derive(Default)]
struct Tally {
    weighted: [u64; 3],
    alpha: u64,
    count: u64,
}

impl Tally {
    /// Добавляет пиксель источника по индексу `at`. Альфа читается первой: на пустом
    /// источнике паника называет именно её индекс.
    fn take(&mut self, rgba: &[u8], at: usize) {
        let alpha = u64::from(rgba[at + 3]);
        for (channel, sum) in self.weighted.iter_mut().enumerate() {
            *sum += u64::from(rgba[at + channel]) * alpha;
        }
        self.alpha += alpha;
        self.count += 1;
    }

    /// Среднее окна: цвет по весу альфы (нулевой вес — чёрный), альфа — по числу пикселей.
    fn average(&self) -> [u8; 4] {
        let ratio = |sum: u64, weight: u64| math_round(sum as f64 / weight as f64) as u8;
        let [red, green, blue] = self.weighted.map(|sum| {
            if self.alpha > 0 {
                ratio(sum, self.alpha)
            } else {
                0
            }
        });
        [red, green, blue, ratio(self.alpha, self.count)]
    }
}

/// Какие пиксели источника по оси длиной `source` попадают в выходную клетку `n`.
fn source_window(n: usize, scale: f64, source: usize) -> Range<usize> {
    let from = (n as f64 * scale).floor() as usize;
    let to = (((n + 1) as f64 * scale).ceil() as usize)
        .min(source)
        .max(from + 1);
    from..to
}

/// Картинка `width × height` в RGBA: буфер не короче `width × height × 4` (лишнее в конце
/// не читается). Короче, а также размер, не помещающийся в `usize`, — отказ: дальше
/// по буферу идут обращения по индексу.
fn require_picture(rgba: &[u8], width: usize, height: usize) -> Result<(), String> {
    let need = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4));
    match need {
        Some(need) if rgba.len() >= need => Ok(()),
        Some(need) => Err(format!(
            "картинка {width}×{height}: нужно байт {need}, а есть {}",
            rgba.len()
        )),
        None => Err(format!("картинка {width}×{height} слишком велика")),
    }
}

/// Приведение к новому размеру усреднением; цвет взвешен альфой. Отказ — буфер короче
/// размера картинки либо пустая картинка, из которой нечего усреднять.
pub fn resample(
    rgba: &[u8],
    width: usize,
    height: usize,
    next_width: usize,
    next_height: usize,
) -> Result<Vec<u8>, String> {
    require_picture(rgba, width, height)?;
    if (width, height) == (next_width, next_height) {
        return Ok(rgba.to_vec());
    }
    if (width == 0 || height == 0) && next_width > 0 && next_height > 0 {
        return Err(format!(
            "картинка {width}×{height} пуста, а нужна {next_width}×{next_height}"
        ));
    }
    let scale_x = width as f64 / next_width as f64;
    let scale_y = height as f64 / next_height as f64;
    Ok((0..next_height)
        .flat_map(|y| (0..next_width).map(move |x| (x, y)))
        .flat_map(|(x, y)| {
            let rows = source_window(y, scale_y, height);
            let cols = source_window(x, scale_x, width);
            rows.flat_map(|row| cols.clone().map(move |col| (row * width + col) * 4))
                .fold(Tally::default(), |mut tally, at| {
                    tally.take(rgba, at);
                    tally
                })
                .average()
        })
        .collect())
}

/// Кадр, вырезанный из листа.
pub struct Frame {
    pub rgba: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub index: usize,
}

/// «Видность» клетки: узлы с шагом 4, вклад узла — средний цвет, умноженный на альфу.
fn cell_energy(
    sheet: &[u8],
    sheet_width: usize,
    origin: (usize, usize),
    cell: (usize, usize),
) -> f64 {
    let nodes = (0..cell.1)
        .step_by(4)
        .flat_map(|ty| (0..cell.0).step_by(4).map(move |tx| (tx, ty)));
    nodes.fold(0.0, |sum, (tx, ty)| {
        let at = ((origin.1 + ty) * sheet_width + origin.0 + tx) * 4;
        let px = &sheet[at..at + 4];
        let mean = (f64::from(px[0]) + f64::from(px[1]) + f64::from(px[2])) / 3.0;
        sum + mean * f64::from(px[3]) / 255.0
    })
}

/// Кадр листа с наибольшей видностью по сетке `columns × rows` (при равенстве — первый).
/// Отказ — буфер короче листа либо сетка шире листа (клетка нулевой стороны).
pub fn preview_frame(
    rgba: &[u8],
    texture_width: usize,
    texture_height: usize,
    columns: usize,
    rows: usize,
) -> Result<Frame, String> {
    require_picture(rgba, texture_width, texture_height)?;
    let (columns, rows) = (columns.max(1), rows.max(1));
    if columns == 1 && rows == 1 {
        return Ok(Frame {
            rgba: rgba.to_vec(),
            width: texture_width,
            height: texture_height,
            index: 0,
        });
    }
    if columns > texture_width || rows > texture_height {
        return Err(format!(
            "сетка кадров {columns}×{rows} шире листа {texture_width}×{texture_height}"
        ));
    }
    let cell = (texture_width / columns, texture_height / rows);
    let corner = |n: usize| ((n % columns) * cell.0, (n / columns) * cell.1);
    let index = (0..columns * rows)
        .map(|n| (n, cell_energy(rgba, texture_width, corner(n), cell)))
        .reduce(|best, next| if next.1 > best.1 { next } else { best })
        .map_or(0, |(n, _)| n);
    let (left, top) = corner(index);
    let cropped = (0..cell.1)
        .flat_map(|row| {
            let from = ((top + row) * texture_width + left) * 4;
            rgba[from..from + cell.0 * 4].iter().copied()
        })
        .collect();
    Ok(Frame {
        rgba: cropped,
        width: cell.0,
        height: cell.1,
        index,
    })
}

#[cfg(test)]
mod tests;
