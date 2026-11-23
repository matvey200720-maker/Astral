//! Лист текстуры: разбор блоков DXT в RGBA, уровни и сборка всех уровней обратно в формат листа.
//!
//! Разбор — `decodeBlocks` из `packages/dds/block-codec.js` байт в байт (у `rage_res::texture`
//! разбор по другим формулам округления: промежуточные цвета и ступени альфы расходятся на
//! единицу, а сборке нужен ровно тот первый уровень, что видит JS). Уровни — `halve` из
//! `apps/desktop/src/recolor-pixels.js`, сжатие блоков — `rage_res::dxt_block` (порт кодировщика
//! JS), сборка — `texturePayload` из `apps/desktop/src/texture-payload.js`.

use rage_res::dxt_block::{self, Format};

use crate::roads::clamp8;

/// Откуда альфа пикселя при разборе.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Alpha {
    FromColour,
    Sharp,
    Steps,
}

/// Палитра блока: четыре цвета RGBA (`fillColors`).
fn fill_colours(c0: u32, c1: u32, opaque: bool) -> [[u8; 4]; 4] {
    let expand5 = |value: u32| ((value << 3) | (value >> 2)) as f64;
    let expand6 = |value: u32| ((value << 2) | (value >> 4)) as f64;
    let p0 = [expand5((c0 >> 11) & 0x1f), expand6((c0 >> 5) & 0x3f), expand5(c0 & 0x1f)];
    let p1 = [expand5((c1 >> 11) & 0x1f), expand6((c1 >> 5) & 0x3f), expand5(c1 & 0x1f)];
    let whole = |colour: [f64; 3], alpha: u8| [colour[0] as u8, colour[1] as u8, colour[2] as u8, alpha];
    let mut colours = [whole(p0, 255), whole(p1, 255), [0, 0, 0, 255], [0, 0, 0, 0]];
    if opaque || c0 > c1 {
        for axis in 0..3 {
            colours[2][axis] = clamp8((2.0 * p0[axis] + p1[axis] + 1.0) / 3.0);
            colours[3][axis] = clamp8((p0[axis] + 2.0 * p1[axis] + 1.0) / 3.0);
        }
        colours[3][3] = 255;
    } else {
        /* Три цвета и прозрачный чёрный (punch-through DXT1). */
        for axis in 0..3 {
            colours[2][axis] = clamp8((p0[axis] + p1[axis]) / 2.0);
        }
    }
    colours
}

/// Восемь ступеней альфы DXT5 (`fillAlphas`).
fn fill_alphas(a0: u8, a1: u8) -> [u8; 8] {
    let (first, second) = (f64::from(a0), f64::from(a1));
    let mut alphas = [a0, a1, 0, 0, 0, 0, 0, 0];
    if a0 > a1 {
        for index in 1..7 {
            let step = index as f64;
            alphas[index + 1] = clamp8(((7.0 - step) * first + step * second) / 7.0);
        }
    } else {
        for index in 1..5 {
            let step = index as f64;
            alphas[index + 1] = clamp8(((5.0 - step) * first + step * second) / 5.0);
        }
        alphas[6] = 0;
        alphas[7] = 255;
    }
    alphas
}

/// Сжатые блоки DXT1/DXT3/DXT5 → RGBA. `None` — блоки оборваны (у JS это отказ разбора).
pub fn decode_blocks(format: Format, data: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    let blocks_x = width.div_ceil(4).max(1);
    let blocks_y = height.div_ceil(4).max(1);
    let dxt1 = format == Format::Dxt1;
    let block_bytes = if dxt1 { 8 } else { 16 };
    let alpha_mode = match format {
        Format::Dxt5 => Alpha::Steps,
        Format::Dxt3 => Alpha::Sharp,
        Format::Dxt1 => Alpha::FromColour,
    };
    if data.len() < blocks_x * blocks_y * block_bytes {
        return None;
    }
    let mut rgba = vec![0u8; width * height * 4];
    for block_y in 0..blocks_y {
        for block_x in 0..blocks_x {
            let offset = (block_y * blocks_x + block_x) * block_bytes;
            let block = &data[offset..offset + block_bytes];
            let colour = if dxt1 { block } else { &block[8..] };
            let c0 = u32::from(colour[0]) | (u32::from(colour[1]) << 8);
            let c1 = u32::from(colour[2]) | (u32::from(colour[3]) << 8);
            let colours = fill_colours(c0, c1, !dxt1);
            let indices = u32::from_le_bytes([colour[4], colour[5], colour[6], colour[7]]);
            let (alphas, alpha_low, alpha_high) = if alpha_mode == Alpha::Steps {
                (
                    fill_alphas(block[0], block[1]),
                    u32::from(block[2]) | (u32::from(block[3]) << 8) | (u32::from(block[4]) << 16),
                    u32::from(block[5]) | (u32::from(block[6]) << 8) | (u32::from(block[7]) << 16),
                )
            } else {
                ([0u8; 8], 0, 0)
            };
            for index in 0..16usize {
                let x = block_x * 4 + index % 4;
                let y = block_y * 4 + index / 4;
                if x >= width || y >= height {
                    continue;
                }
                let picked = colours[((indices >> (index * 2)) & 0x3) as usize];
                let target = (y * width + x) * 4;
                rgba[target] = picked[0];
                rgba[target + 1] = picked[1];
                rgba[target + 2] = picked[2];
                rgba[target + 3] = match alpha_mode {
                    Alpha::Steps => {
                        let bits = if index < 8 { alpha_low } else { alpha_high };
                        alphas[((bits >> ((index & 7) * 3)) & 0x7) as usize]
                    }
                    Alpha::Sharp => {
                        let nibble = block[index >> 1];
                        (if index % 2 == 0 { nibble & 0xf } else { nibble >> 4 }) * 17
                    }
                    Alpha::FromColour => picked[3],
                };
            }
        }
    }
    Some(rgba)
}

/// Уровень вдвое меньше — среднее четырёх соседей (`halve`).
pub fn halve(rgba: &[u8], width: usize, height: usize) -> (Vec<u8>, usize, usize) {
    let w = (width >> 1).max(1);
    let h = (height >> 1).max(1);
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let top = (y * 2).min(height - 1) * width;
        let bottom = (y * 2 + 1).min(height - 1) * width;
        for x in 0..w {
            let left = (x * 2).min(width - 1) * 4;
            let right = (x * 2 + 1).min(width - 1) * 4;
            let (a, b, c, d) = (top * 4 + left, top * 4 + right, bottom * 4 + left, bottom * 4 + right);
            let at = (y * w + x) * 4;
            for channel in 0..4 {
                let sum = u32::from(rgba[a + channel]) + u32::from(rgba[b + channel]) + u32::from(rgba[c + channel]) + u32::from(rgba[d + channel]) + 2;
                out[at + channel] = (sum >> 2) as u8;
            }
        }
    }
    (out, w, h)
}

/// Все уровни листа из нового первого — байт в байт той длины, что у файла (`texturePayload` без
/// сохранения прежних блоков). `None` — уровни не сошлись с длиной (у JS это отказ, лист остаётся как был).
pub fn payload(format: Format, width: usize, height: usize, levels: usize, total: usize, rgba: Vec<u8>) -> Option<Vec<u8>> {
    let mut out = vec![0u8; total];
    let mut level = (rgba, width, height);
    let mut offset = 0;
    for index in 0..levels {
        let length = dxt_block::blocks_len(format, level.1, level.2);
        if offset + length > out.len() {
            return None;
        }
        dxt_block::encode_blocks(format, &level.0, level.1, level.2, &mut out[offset..offset + length]);
        offset += length;
        if index + 1 < levels {
            level = halve(&level.0, level.1, level.2);
        }
    }
    (offset == out.len()).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Блок DXT1 из двух цветов и кодов по пикселям (код пикселя `index` — `codes[index]`).
    fn dxt1_block(c0: u16, c1: u16, codes: [u8; 16]) -> Vec<u8> {
        let mut block = Vec::new();
        block.extend_from_slice(&c0.to_le_bytes());
        block.extend_from_slice(&c1.to_le_bytes());
        let mut bits = 0u32;
        for (index, &code) in codes.iter().enumerate() {
            bits |= u32::from(code & 3) << (index * 2);
        }
        block.extend_from_slice(&bits.to_le_bytes());
        block
    }

    #[test]
    fn four_colour_block_rounds_thirds_to_nearest_like_the_js_decoder() {
        // c0 = чисто красный (31, 0, 0), c1 = чёрный: c0 > c1 — четыре цвета.
        let block = dxt1_block(0xf800, 0x0000, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
        let rgba = decode_blocks(Format::Dxt1, &block, 4, 4).unwrap();
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&rgba[4..8], &[0, 0, 0, 255]);
        // (2·255 + 0 + 1) / 3 = 170,33… → 170; (255 + 0 + 1) / 3 = 85,33… → 85.
        assert_eq!(&rgba[8..12], &[170, 0, 0, 255]);
        assert_eq!(&rgba[12..16], &[85, 0, 0, 255]);
    }

    #[test]
    fn punch_through_block_takes_the_even_half_and_a_clear_fourth_colour() {
        // c0 <= c1: три цвета и прозрачный. Красный 8 (байт 66) и 9 (байт 74): среднее 70 ровно.
        // Зелёный 1 (байт 4) и 2 (байт 8): 6. Синий 0 и 1 (байт 8): 4.
        let c0 = (8u16 << 11) | (1 << 5);
        let c1 = (9u16 << 11) | (2 << 5) | 1;
        let block = dxt1_block(c0, c1, [2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
        let rgba = decode_blocks(Format::Dxt1, &block, 4, 4).unwrap();
        assert_eq!(&rgba[0..4], &[70, 6, 4, 255]);
        assert_eq!(&rgba[4..8], &[0, 0, 0, 0]);
        // Половинка уходит к чётному, как у Uint8ClampedArray: (0 + 33) / 2 = 16,5 → 16 (c0 <= c1 — три цвета).
        let half = fill_colours(0, 4 << 11, false);
        assert_eq!(half[2][0], 16);
    }

    #[test]
    fn dxt5_alpha_steps_round_to_nearest() {
        // a0 = 255 > a1 = 0: шесть промежуточных ступеней, 255·k/7 к ближайшему.
        assert_eq!(fill_alphas(255, 0), [255, 0, 219, 182, 146, 109, 73, 36]);
        // a0 <= a1: четыре ступени, ноль и 255.
        assert_eq!(fill_alphas(10, 20), [10, 20, 12, 14, 16, 18, 0, 255]);
    }

    #[test]
    fn truncated_blocks_are_refused_and_edges_are_cut_to_the_picture() {
        let block = dxt1_block(0xffff, 0x0000, [0; 16]);
        assert!(decode_blocks(Format::Dxt1, &block[..7], 4, 4).is_none());
        let rgba = decode_blocks(Format::Dxt1, &block, 2, 3).unwrap();
        assert_eq!(rgba.len(), 2 * 3 * 4);
        assert!(rgba.chunks_exact(4).all(|pixel| pixel == [255, 255, 255, 255]));
    }

    #[test]
    fn halving_averages_four_neighbours_with_the_js_rounding() {
        let rgba = [10, 0, 0, 255, 11, 0, 0, 255, 12, 0, 0, 255, 14, 0, 0, 255];
        let (half, width, height) = halve(&rgba, 2, 2);
        assert_eq!((width, height), (1, 1));
        // (10 + 11 + 12 + 14 + 2) >> 2 = 12.
        assert_eq!(half, [12, 0, 0, 255]);
        let (line, width, height) = halve(&[1, 2, 3, 4, 5, 6, 7, 8], 2, 1);
        assert_eq!((width, height), (1, 1));
        assert_eq!(line, [3, 4, 5, 6]);
    }

    #[test]
    fn a_payload_fills_every_level_or_refuses() {
        let rgba = vec![200u8; 8 * 8 * 4];
        // DXT1 8×8 с четырьмя уровнями: 32 + 8 + 8 + 8 байт.
        let whole = payload(Format::Dxt1, 8, 8, 4, 56, rgba.clone()).unwrap();
        assert_eq!(whole.len(), 56);
        assert!(payload(Format::Dxt1, 8, 8, 4, 48, rgba.clone()).is_none(), "уровни длиннее листа");
        assert!(payload(Format::Dxt1, 8, 8, 4, 64, rgba).is_none(), "уровни короче листа");
    }
}
