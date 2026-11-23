//! Блоки DXT1/DXT3/DXT5 в RGBA **так, как их распаковывает JS** (`packages/dds/block-codec.js: decodeBlocks`).
//!
//! Распаковщик `bcdec` (`texture::decode_pixels`) считает промежуточные цвета и альфу целым делением (вниз); у JS те же числа делятся в дробных и пишутся в
//! `Uint8ClampedArray`, то есть округляются к ближайшему (ровная половинка — к чётному). Разница — единица в младшем разряде у каждого промежуточного
//! цвета и ступени альфы, и она доходит до палитры тинта и среднего цвета листа в сцене. Остальные форматы (BC7, пиксельные) у обоих читателей дают
//! одни и те же байты (сверено по образцам листов, `fixtures/ars1/sheets`), и здесь отдаются прежнему `decode_pixels`; `ATI1` и `ATI2` не сверялись.
//!
//! Сверка с JS: `fixtures/ars1/sheets/dxt-blocks.json` (блоки и ответы настоящего `decodeTexture`) и листы целиком у сборщиков сцен движка.

use crate::error::{Error, Result};
use crate::texture::{decode_pixels as bcdec_pixels, Format};

/// Конец записи в `Uint8ClampedArray`: целое `n / d`, округлённое к ближайшему; ровная половинка — к чётному.
fn nearest(n: u32, d: u32) -> u8 {
    let (q, r) = (n / d, n % d);
    let up = match (2 * r).cmp(&d) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => q % 2 == 1,
    };
    (q + u32::from(up)) as u8
}

/// `meanColour` JS (`world-place-scene.js`): сумма каналов R, G, B по пикселям, деление на число пикселей (не меньше одного), `Math.round`, две цифры на канал.
pub fn mean_colour_of(rgba: &[u8]) -> String {
    let count = (rgba.len() as f64 / 4.0).max(1.0);
    let mut sums = [0.0f64; 3];
    for pixel in rgba.chunks(4) {
        for (sum, channel) in sums.iter_mut().zip(pixel) {
            *sum += f64::from(*channel);
        }
    }
    let [r, g, b] = sums.map(|sum| crate::js_math::round(sum / count) as u32);
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Цвет RGB565 → 8 бит на канал (`(v << 3) | (v >> 2)`, у зелёного `(v << 2) | (v >> 4)`).
fn expand565(color: u16) -> [u8; 3] {
    let (r, g, b) = ((color >> 11) & 0x1f, (color >> 5) & 0x3f, color & 0x1f);
    [
        ((r << 3) | (r >> 2)) as u8,
        ((g << 2) | (g >> 4)) as u8,
        ((b << 3) | (b >> 2)) as u8,
    ]
}

/// Палитра блока: четыре цвета RGBA. Четыре цвета — у DXT3/DXT5 всегда и у DXT1 при `c0 > c1`; иначе три цвета и прозрачный чёрный.
fn palette(c0: u16, c1: u16, four_colours: bool) -> [[u8; 4]; 4] {
    let (p0, p1) = (expand565(c0), expand565(c1));
    let mix = |weights: (u32, u32)| {
        let channel = |k: usize| {
            nearest(
                weights.0 * u32::from(p0[k]) + weights.1 * u32::from(p1[k]) + 1,
                3,
            )
        };
        [channel(0), channel(1), channel(2), 255]
    };
    let third = |k: usize| u32::from(p0[k]) + u32::from(p1[k]);
    if four_colours || c0 > c1 {
        [
            [p0[0], p0[1], p0[2], 255],
            [p1[0], p1[1], p1[2], 255],
            mix((2, 1)),
            mix((1, 2)),
        ]
    } else {
        [
            [p0[0], p0[1], p0[2], 255],
            [p1[0], p1[1], p1[2], 255],
            [
                nearest(third(0), 2),
                nearest(third(1), 2),
                nearest(third(2), 2),
                255,
            ],
            [0, 0, 0, 0],
        ]
    }
}

/// Восемь ступеней альфы DXT5.
fn alphas(a0: u8, a1: u8) -> [u8; 8] {
    let (a0, a1) = (u32::from(a0), u32::from(a1));
    let mut steps = [0u8; 8];
    steps[0] = a0 as u8;
    steps[1] = a1 as u8;
    if a0 > a1 {
        for index in 1..7 {
            steps[index + 1] = nearest((7 - index as u32) * a0 + index as u32 * a1, 7);
        }
    } else {
        for index in 1..5 {
            steps[index + 1] = nearest((5 - index as u32) * a0 + index as u32 * a1, 5);
        }
        steps[6] = 0;
        steps[7] = 255;
    }
    steps
}

/// RGBA уровня; формат вне DXT — прежний `decode_pixels`.
pub fn decode_pixels(format: Format, data: &[u8], width: usize, height: usize) -> Result<Vec<u8>> {
    if !matches!(format, Format::Dxt1 | Format::Dxt3 | Format::Dxt5) {
        return bcdec_pixels(format, data, width, height);
    }
    let needed = format.level_bytes(width, height);
    if data.len() < needed {
        return Err(Error::texture(format!(
            "Текстуре {width}\u{d7}{height} {} нужно {needed} байт, пришло {}.",
            format.name(),
            data.len()
        )));
    }
    if width == 0 || height == 0 {
        return Ok(Vec::new());
    }
    let dxt1 = format == Format::Dxt1;
    let block_bytes = if dxt1 { 8 } else { 16 };
    let columns = width.div_ceil(4);
    let rows = height.div_ceil(4);
    let mut rgba = vec![0u8; width * height * 4];
    for (index, block) in data
        .chunks_exact(block_bytes)
        .take(columns * rows)
        .enumerate()
    {
        let (left, top) = ((index % columns) * 4, (index / columns) * 4);
        let colour = if dxt1 { block } else { &block[8..] };
        let c0 = u16::from(colour[0]) | u16::from(colour[1]) << 8;
        let c1 = u16::from(colour[2]) | u16::from(colour[3]) << 8;
        let colours = palette(c0, c1, !dxt1);
        let codes = u32::from_le_bytes([colour[4], colour[5], colour[6], colour[7]]);
        let steps = (format == Format::Dxt5).then(|| alphas(block[0], block[1]));
        let alpha_bits = |pixel: usize| {
            // индексы альфы DXT5: пиксели 0–7 — в байтах 2–4, 8–15 — в байтах 5–7, по три бита на пиксель
            let base = if pixel < 8 { 2 } else { 5 };
            let word = u32::from(block[base])
                | u32::from(block[base + 1]) << 8
                | u32::from(block[base + 2]) << 16;
            ((word >> ((pixel & 7) * 3)) & 7) as usize
        };
        for pixel in 0..16 {
            let (x, y) = (left + pixel % 4, top + pixel / 4);
            if x >= width || y >= height {
                continue;
            }
            let mut value = colours[((codes >> (pixel * 2)) & 3) as usize];
            if let Some(steps) = &steps {
                value[3] = steps[alpha_bits(pixel)];
            } else if format == Format::Dxt3 {
                let nibble = block[pixel / 2];
                value[3] = (if pixel % 2 == 0 {
                    nibble & 0xf
                } else {
                    nibble >> 4
                }) * 17;
            }
            let at = (y * width + x) * 4;
            rgba[at..at + 4].copy_from_slice(&value);
        }
    }
    Ok(rgba)
}

#[cfg(test)]
mod tests;
