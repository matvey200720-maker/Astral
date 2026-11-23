//! Сборка `.dds` из RGBA: размеры уровней, заголовок, цепочка mip-уровней.
//!
//! Игра отвергает текстуру, у которой ширина, высота, формат или число
//! уровней не совпали со слотом, поэтому заголовок читается и пишется поле
//! за полем. Сжатие блоков делает `dxt_block`, здесь только раскладка.

use crate::dxt_block::{blocks_len, encode_blocks, Format};
use crate::error::{Error, Result};
use std::collections::VecDeque;

pub const DDS_MAGIC: u32 = 0x2053_4444;
pub const HEADER_BYTES: usize = 128;
pub const BLOCK_FORMATS: [&str; 3] = ["DXT1", "DXT3", "DXT5"];

const STRUCT_SIZE: u32 = 124;
const PIXEL_FORMAT_SIZE: u32 = 32;
const MAX_SIDE: usize = 8192;
const MAX_LEVELS: u32 = 16;

/// Что известно о формате при расчёте размера уровня.
enum Layout {
    /// Байт на пиксель.
    Plain(usize),
    /// Байт на блок 4x4.
    Blocks(usize),
}

fn layout_of(format: &str) -> Option<Layout> {
    Some(match format {
        "A8R8G8B8" | "X8R8G8B8" | "A8B8G8R8" => Layout::Plain(4),
        "A8" | "L8" => Layout::Plain(1),
        "DXT1" | "ATI1" => Layout::Blocks(8),
        "DXT3" | "DXT5" | "ATI2" | "BC7" => Layout::Blocks(16),
        _ => return None,
    })
}

/// Сколько байт занимает один уровень картинки в этом формате.
pub fn level_bytes(format: &str, width: usize, height: usize) -> Result<usize> {
    let layout = layout_of(format)
        .ok_or_else(|| Error::argument(format!("Неизвестный формат текстуры: {format}.")))?;
    let size = match layout {
        Layout::Plain(per_pixel) => width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(per_pixel)),
        Layout::Blocks(per_block) => {
            let blocks = |side: usize| side.div_ceil(4).max(1);
            blocks(width)
                .checked_mul(blocks(height))
                .and_then(|count| count.checked_mul(per_block))
        }
    };
    size.ok_or_else(|| Error::argument("Размер уровня текстуры не помещается в память."))
}

/// Длина полной цепочки: до тех пор, пока большая сторона не станет единицей.
pub fn full_mip_levels(width: usize, height: usize) -> usize {
    let side = width.max(height).max(1);
    (usize::BITS - side.leading_zeros()) as usize
}

/// `Math.round` для неотрицательных чисел.
fn round_half_up(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn to_byte(value: f64) -> u8 {
    round_half_up(value).clamp(0.0, 255.0) as u8
}

/// Уровень вдвое меньше: цвет усредняется с весом альфы.
pub fn downsample(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    assert!(width > 0 && height > 0, "downsample: пустая картинка");
    assert!(
        width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(4))
            .is_some_and(|needed| rgba.len() >= needed),
        "downsample: срез короче картинки"
    );
    let (out_w, out_h) = ((width / 2).max(1), (height / 2).max(1));
    // Последний столбец (строка) выходной картинки захватывает и лишний нечётный
    // столбец (строку) источника: ни один пиксель источника не пропадает.
    let span = |index: usize, count: usize, full: usize| {
        let first = index * 2;
        let last = if index + 1 == count { full - 1 } else { first + 1 };
        first..=last.max(first)
    };
    let mut out = Vec::with_capacity(out_w * out_h * 4);
    for y in 0..out_h {
        for x in 0..out_w {
            let mut color = [0.0f64; 3];
            let (mut alpha_sum, mut samples) = (0.0f64, 0.0f64);
            for sy in span(y, out_h, height) {
                for sx in span(x, out_w, width) {
                    let px = &rgba[(sy * width + sx) * 4..][..4];
                    let a = f64::from(px[3]);
                    alpha_sum += a;
                    samples += 1.0;
                    for (acc, &c) in color.iter_mut().zip(px) {
                        *acc += f64::from(c) * a;
                    }
                }
            }
            if alpha_sum > 0.0 {
                out.extend(color.iter().map(|c| to_byte(c / alpha_sum)));
            } else {
                out.extend([0, 0, 0]);
            }
            out.push(to_byte(alpha_sum / samples));
        }
    }
    out
}

/// Закрашивает цветом ближайших видимых пикселей те, что полностью прозрачны.
pub fn bleed_transparent(rgba: &mut [u8], width: usize, height: usize) {
    let Some(total) = width.checked_mul(height) else {
        panic!("bleed_transparent: срез короче картинки");
    };
    if total == 0 {
        return;
    }
    assert!(
        total.checked_mul(4).is_some_and(|needed| rgba.len() >= needed),
        "bleed_transparent: срез короче картинки"
    );
    let mut seen: Vec<bool> = (0..total).map(|i| rgba[i * 4 + 3] != 0).collect();
    let mut queue: VecDeque<usize> = (0..total).filter(|&i| seen[i]).collect();
    if queue.is_empty() || queue.len() == total {
        return;
    }
    while let Some(index) = queue.pop_front() {
        let (x, y) = (index % width, index / width);
        let around = [
            (x > 0).then(|| index - 1),
            (x + 1 < width).then(|| index + 1),
            (y > 0).then(|| index - width),
            (y + 1 < height).then(|| index + width),
        ];
        for next in around.into_iter().flatten() {
            if !std::mem::replace(&mut seen[next], true) {
                rgba.copy_within(index * 4..index * 4 + 3, next * 4);
                queue.push_back(next);
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MipLevel {
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
}

/// Цепочка уровней: исходная картинка и её последовательные уменьшения.
pub fn build_mip_chain(rgba: &[u8], width: usize, height: usize, mip_levels: u32) -> Vec<MipLevel> {
    let count = mip_levels.max(1) as usize;
    let mut chain = Vec::with_capacity(count);
    chain.push(MipLevel {
        width,
        height,
        rgba: rgba.to_vec(),
    });
    for level in 1..count {
        let prev = &chain[level - 1];
        let rgba = downsample(&prev.rgba, prev.width, prev.height);
        let shrink = |side: usize| side.checked_shr(level as u32).unwrap_or(0).max(1);
        chain.push(MipLevel {
            width: shrink(width),
            height: shrink(height),
            rgba,
        });
    }
    chain
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub width: usize,
    pub height: usize,
    pub depth: u32,
    pub mip_levels: u32,
    pub format: String,
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

pub fn read_header(bytes: &[u8]) -> Result<Header> {
    if bytes.len() < HEADER_BYTES {
        return Err(Error::broken("DDS короче заголовка."));
    }
    if word(bytes, 0) != DDS_MAGIC || word(bytes, 4) != STRUCT_SIZE {
        return Err(Error::broken("Файл не является DDS."));
    }
    if word(bytes, 76) != PIXEL_FORMAT_SIZE {
        return Err(Error::broken(
            "DDS содержит повреждённый блок формата пикселей.",
        ));
    }
    let format = if word(bytes, 80) & 0x4 != 0 {
        let code: String = bytes[84..88]
            .iter()
            .filter(|&&b| b != 0)
            .map(|&b| char::from(b))
            .collect();
        if !BLOCK_FORMATS.contains(&code.as_str()) {
            let shown = if code.is_empty() { "?" } else { code.as_str() };
            return Err(Error::broken(format!(
                "DDS формата {shown} не поддерживается."
            )));
        }
        code
    } else if word(bytes, 88) == 32 {
        let masks = [92, 96, 100, 104].map(|at| word(bytes, at));
        if masks != [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000] {
            return Err(Error::broken(
                "DDS без сжатия: нужен A8R8G8B8 с масками ARGB.",
            ));
        }
        "A8R8G8B8".to_string()
    } else {
        return Err(Error::broken(
            "DDS без сжатия поддерживается только в 32 битах.",
        ));
    };
    let (width, height, levels) = (
        word(bytes, 16) as usize,
        word(bytes, 12) as usize,
        word(bytes, 28),
    );
    let sides_ok = (1..=MAX_SIDE).contains(&width) && (1..=MAX_SIDE).contains(&height);
    if !sides_ok || levels > MAX_LEVELS {
        return Err(Error::broken(
            "DDS содержит неподдерживаемые размеры или mip-уровни.",
        ));
    }
    Ok(Header {
        width,
        height,
        depth: word(bytes, 24).max(1),
        mip_levels: levels.max(1),
        format,
    })
}

/// Как формат записывается в блок пикселей заголовка.
enum PixelRecord {
    /// FourCC сжатого формата (DXT/ATI) в самом заголовке.
    FourCc([u8; 4]),
    /// FourCC «DX10» и расширение DXGI_FORMAT: формат без своего FourCC (BC7).
    Dx10(u32),
    /// Несжатые пиксели: флаги, число бит и маски R, G, B, A.
    Masks { flags: u32, bits: u32, masks: [u32; 4] },
}

const DXGI_BC7_UNORM: u32 = 98;
const DX10_EXTENSION_BYTES: usize = 20;

fn pixel_record(format: &str) -> Option<PixelRecord> {
    const RGB: [u32; 3] = [0x00ff_0000, 0x0000_ff00, 0x0000_00ff];
    Some(match format {
        "DXT1" | "DXT3" | "DXT5" | "ATI1" | "ATI2" => {
            let mut code = [0u8; 4];
            code.copy_from_slice(format.as_bytes());
            PixelRecord::FourCc(code)
        }
        "BC7" => PixelRecord::Dx10(DXGI_BC7_UNORM),
        "A8R8G8B8" => PixelRecord::Masks {
            flags: 0x41,
            bits: 32,
            masks: [RGB[0], RGB[1], RGB[2], 0xff00_0000],
        },
        "X8R8G8B8" => PixelRecord::Masks {
            flags: 0x40,
            bits: 32,
            masks: [RGB[0], RGB[1], RGB[2], 0],
        },
        "A8B8G8R8" => PixelRecord::Masks {
            flags: 0x41,
            bits: 32,
            masks: [RGB[2], RGB[1], RGB[0], 0xff00_0000],
        },
        "A8" => PixelRecord::Masks {
            flags: 0x2,
            bits: 8,
            masks: [0, 0, 0, 0xff],
        },
        "L8" => PixelRecord::Masks {
            flags: 0x2_0000,
            bits: 8,
            masks: [0xff, 0, 0, 0],
        },
        _ => return None,
    })
}

/// Заголовок DDS для данных в этом формате. Неизвестное имя — ошибка; BC7 пишется с
/// расширением DX10, поэтому заголовок бывает длиннее `HEADER_BYTES`.
pub fn write_header(
    width: usize,
    height: usize,
    mip_levels: u32,
    format: &str,
) -> Result<Vec<u8>> {
    let record = pixel_record(format)
        .ok_or_else(|| Error::argument(format!("Неизвестный формат текстуры: {format}.")))?;
    let has_mips = mip_levels > 1;
    let (linear, pitch) = match &record {
        PixelRecord::Masks { bits, .. } => (
            false,
            width
                .checked_mul(*bits as usize / 8)
                .ok_or_else(|| Error::argument("Размер уровня текстуры не помещается в память."))?,
        ),
        _ => (true, level_bytes(format, width, height)?),
    };
    let mut flags = 0x1007u32 | if linear { 0x80000 } else { 0x8 };
    let mut caps = 0x1000u32;
    if has_mips {
        flags |= 0x2_0000;
        caps |= 0x40_0008;
    }
    // Размеры и шаг строки лежат в 32-битных словах заголовка: лишнее не отбрасывается молча.
    let word = |value: usize| {
        u32::try_from(value)
            .map_err(|_| Error::argument("Размер текстуры не помещается в заголовок DDS."))
    };
    let (height_word, width_word, pitch_word) = (word(height)?, word(width)?, word(pitch)?);
    // (смещение, значение) всех непустых слов; остальное остаётся нулями.
    let mut fields = vec![
        (0, DDS_MAGIC),
        (4, STRUCT_SIZE),
        (8, flags),
        (12, height_word),
        (16, width_word),
        (20, pitch_word),
        (28, mip_levels),
        (76, PIXEL_FORMAT_SIZE),
        (108, caps),
    ];
    let mut length = HEADER_BYTES;
    match record {
        PixelRecord::FourCc(code) => {
            fields.extend([(80, 0x4), (84, u32::from_le_bytes(code))]);
        }
        PixelRecord::Dx10(dxgi) => {
            fields.extend([
                (80, 0x4),
                (84, u32::from_le_bytes(*b"DX10")),
                (128, dxgi),
                (132, 3),
                (140, 1),
            ]);
            length += DX10_EXTENSION_BYTES;
        }
        PixelRecord::Masks { flags, bits, masks } => {
            fields.extend([(80, flags), (88, bits)]);
            fields.extend(masks.iter().enumerate().map(|(i, &m)| (92 + 4 * i, m)));
        }
    }
    let mut out = vec![0u8; length];
    for (offset, value) in fields {
        out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    Ok(out)
}

pub fn encode_dds(
    width: usize,
    height: usize,
    format: &str,
    mip_levels: u32,
    rgba: &[u8],
) -> Result<Vec<u8>> {
    let block_format = Format::parse(format);
    if block_format.is_none() && format != "A8R8G8B8" {
        return Err(Error::argument(format!(
            "Формат DDS {format} не поддерживается."
        )));
    }
    if !(1..=MAX_SIDE).contains(&width) || !(1..=MAX_SIDE).contains(&height) {
        return Err(Error::argument("Размер DDS вне допустимых границ."));
    }
    if !(1..=MAX_LEVELS).contains(&mip_levels) {
        return Err(Error::argument(
            "Число mip-уровней DDS вне допустимых границ.",
        ));
    }
    if mip_levels as usize > full_mip_levels(width, height) {
        return Err(Error::argument(format!(
            "Для {width}×{height} нельзя построить {mip_levels} mip-уровней."
        )));
    }
    if rgba.len() != width * height * 4 {
        return Err(Error::argument(
            "Размер RGBA не совпадает с заявленным размером DDS.",
        ));
    }
    let mut out = write_header(width, height, mip_levels, format)?;
    for level in build_mip_chain(rgba, width, height, mip_levels) {
        match block_format {
            Some(kind) => {
                let start = out.len();
                out.resize(start + blocks_len(kind, level.width, level.height), 0);
                encode_blocks(
                    kind,
                    &level.rgba,
                    level.width,
                    level.height,
                    &mut out[start..],
                );
            }
            None => out.extend(
                level
                    .rgba
                    .chunks_exact(4)
                    .flat_map(|p| [p[2], p[1], p[0], p[3]]),
            ),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len() / 2)
            .map(|i| u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).unwrap())
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn fail(result: Result<impl std::fmt::Debug>) -> String {
        let e = result.unwrap_err();
        format!("{:?}: {}", e.kind, e.message)
    }

    #[test]
    fn level_bytes_table() {
        let sizes = [
            (0, 0),
            (1, 1),
            (3, 2),
            (4, 4),
            (5, 5),
            (8, 1),
            (256, 64),
            (8192, 8192),
        ];
        let rows: [(&str, [usize; 8]); 11] = [
            ("DXT1", [8, 8, 8, 8, 32, 16, 8192, 33554432]),
            ("DXT3", [16, 16, 16, 16, 64, 32, 16384, 67108864]),
            ("DXT5", [16, 16, 16, 16, 64, 32, 16384, 67108864]),
            ("ATI1", [8, 8, 8, 8, 32, 16, 8192, 33554432]),
            ("ATI2", [16, 16, 16, 16, 64, 32, 16384, 67108864]),
            ("BC7", [16, 16, 16, 16, 64, 32, 16384, 67108864]),
            ("A8R8G8B8", [0, 4, 24, 64, 100, 32, 65536, 268435456]),
            ("X8R8G8B8", [0, 4, 24, 64, 100, 32, 65536, 268435456]),
            ("A8B8G8R8", [0, 4, 24, 64, 100, 32, 65536, 268435456]),
            ("A8", [0, 1, 6, 16, 25, 8, 16384, 67108864]),
            ("L8", [0, 1, 6, 16, 25, 8, 16384, 67108864]),
        ];
        for (format, expected) in rows {
            for (&(w, h), want) in sizes.iter().zip(expected) {
                assert_eq!(level_bytes(format, w, h).unwrap(), want, "{format} {w}x{h}");
            }
        }
        for bad in ["dxt1", "", "BC1", "DX10"] {
            for &(w, h) in &sizes {
                assert_eq!(
                    fail(level_bytes(bad, w, h)),
                    format!("Argument: Неизвестный формат текстуры: {bad}.")
                );
            }
        }
    }

    #[test]
    fn level_bytes_overflow_is_an_error() {
        let message = "Argument: Размер уровня текстуры не помещается в память.";
        assert_eq!(fail(level_bytes("A8R8G8B8", usize::MAX, 2)), message);
        assert_eq!(fail(level_bytes("A8R8G8B8", 1 << 40, 1 << 40)), message);
        assert_eq!(fail(level_bytes("DXT1", usize::MAX, usize::MAX)), message);
        assert_eq!(level_bytes("DXT1", 1 << 20, 1 << 20).unwrap(), 1usize << 39);
    }

    #[test]
    fn mip_count_table() {
        let rows = [
            ((0, 0), 1),
            ((1, 1), 1),
            ((2, 1), 2),
            ((1, 2), 2),
            ((3, 3), 2),
            ((4, 4), 3),
            ((5, 3), 3),
            ((256, 64), 9),
            ((64, 256), 9),
            ((1000, 1), 10),
            ((8192, 8192), 14),
            ((8193, 1), 14),
            ((65535, 65535), 16),
            ((usize::MAX, 1), 64),
        ];
        for ((w, h), want) in rows {
            assert_eq!(full_mip_levels(w, h), want, "{w}x{h}");
        }
    }

    #[test]
    fn downsample_table() {
        let rows: [(usize, usize, &str, &str); 13] = [
            (2, 2, "0a141eff14283cff1e3c5aff295179ff", "19324bff"),
            (2, 2, "ff0000ff00000000ff0000ff00000000", "ff000080"),
            (2, 2, "09090900090909000909090009090900", "00000000"),
            (2, 2, "c8000001006400ff000032800a0a0a00", "01421160"),
            (2, 2, "000000ff000000000000000000000000", "00000040"),
            (2, 2, "00000001000000010000000000000000", "00000001"),
            (2, 2, "00000003000000030000000000000000", "00000002"),
            (2, 2, "010000ff020000ff000000ff000000ff", "010000ff"),
            (1, 1, "01020304", "01020304"),
            (3, 3, "c8cfd6dde4ebf2f900070e151c232a31383f464d545b626970777e858c939aa1a8afb6bd", "99a0a786"),
            (1, 4, "000a14ff28323cff505a64ff78828cff", "141e28ff646e78ff"),
            (4, 1, "000a14ff28323cff505a64ff78828cff", "141e28ff646e78ff"),
            (
                5,
                3,
                "000306c80c0f12c9181b1eca24272acb303336cc3c3f42cd484b4ece54575acf606366d06c6f72d1787b7ed284878ad3909396d49c9fa2d5a8abaed6",
                "434649ce616467d0",
            ),
        ];
        for (w, h, input, want) in rows {
            assert_eq!(hex(&downsample(&unhex(input), w, h)), want, "{input}");
        }
        assert_eq!(downsample(&[0u8; 40], 2, 2), [0, 0, 0, 0]);
    }

    /// Нечётная сторона: последний столбец и строка источника входят в среднее, а не
    /// отбрасываются (при равной непрозрачности — среднее арифметическое).
    #[test]
    fn downsample_keeps_the_odd_edge() {
        // 3x1: красный канал 0, 30, 90 -> один пиксель, среднее 40.
        let row = [0, 0, 0, 255, 30, 0, 0, 255, 90, 0, 0, 255];
        assert_eq!(downsample(&row, 3, 1), [40, 0, 0, 255]);
        // 1x3 то же по вертикали.
        assert_eq!(downsample(&row, 1, 3), [40, 0, 0, 255]);
        // 5x1: [0, 10] и [20, 30, 40] -> 5 и 30.
        let wide: Vec<u8> = [0u8, 10, 20, 30, 40]
            .iter()
            .flat_map(|&r| [r, 0, 0, 255])
            .collect();
        assert_eq!(downsample(&wide, 5, 1), [5, 0, 0, 255, 30, 0, 0, 255]);
        // Чётная картинка не изменилась.
        assert_eq!(downsample(&wide[..16], 4, 1), [5, 0, 0, 255, 25, 0, 0, 255]);
    }

    #[test]
    fn downsample_panics_on_bad_input() {
        for (data, w, h) in [(&[][..], 0, 0), (&[1, 2, 3, 4][..], 2, 2), (&[][..], 2, 0)] {
            assert!(std::panic::catch_unwind(|| downsample(data, w, h)).is_err());
        }
    }

    #[test]
    fn downsample_weights_colour_by_alpha() {
        let src = [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0];
        assert_eq!(downsample(&src, 2, 2), [255, 0, 0, 128]);
    }

    #[test]
    fn bleed_table() {
        let rows: [(usize, usize, &str, &str); 10] = [
            (2, 1, "090807ff00000000", "090807ff09080700"),
            (3, 1, "000000000506070a00000000", "050607000506070a05060700"),
            (3, 1, "010101ff00000000020202ff", "010101ff01010100020202ff"),
            (2, 1, "0102030004050600", "0102030004050600"),
            (2, 1, "01020301040506ff", "01020301040506ff"),
            (
                3,
                3,
                "00000000000000000000000000000000646e78ff00000000000000000000000000000000",
                "646e7800646e7800646e7800646e7800646e78ff646e7800646e7800646e7800646e7800",
            ),
            (
                3,
                3,
                "0a141eff00000000000000000000000000000000000000000000000000000000c8d2dcff",
                "0a141eff0a141e000a141e000a141e000a141e00c8d2dc000a141e00c8d2dc00c8d2dcff",
            ),
            (
                2,
                3,
                "0a0000ff0000000000000000000000000000000000000aff",
                "0a0000ff0a0000000a00000000000a0000000a0000000aff",
            ),
            (
                4,
                1,
                "0a0000ff0000000000000000000014ff",
                "0a0000ff0a00000000001400000014ff",
            ),
            (1, 3, "000000000707070900000000", "070707000707070907070700"),
        ];
        for (w, h, input, want) in rows {
            let mut data = unhex(input);
            bleed_transparent(&mut data, w, h);
            assert_eq!(hex(&data), want, "{input}");
        }
        let mut empty: [u8; 0] = [];
        bleed_transparent(&mut empty, 0, 0);
        assert!(std::panic::catch_unwind(|| bleed_transparent(&mut [1, 2, 3, 4], 2, 2)).is_err());
    }

    #[test]
    fn bleed_fills_transparent_colour_from_the_visible_neighbour() {
        let mut px = [9, 8, 7, 255, 0, 0, 0, 0];
        bleed_transparent(&mut px, 2, 1);
        assert_eq!(px, [9, 8, 7, 255, 9, 8, 7, 0]);
    }

    #[test]
    fn mip_chain_shapes_and_content() {
        let shape = |levels: u32| -> Vec<(usize, usize, usize)> {
            build_mip_chain(&[7u8; 64], 4, 4, levels)
                .iter()
                .map(|m| (m.width, m.height, m.rgba.len()))
                .collect()
        };
        assert_eq!(shape(0), [(4, 4, 64)]);
        assert_eq!(shape(1), [(4, 4, 64)]);
        assert_eq!(shape(2), [(4, 4, 64), (2, 2, 16)]);
        assert_eq!(shape(3), [(4, 4, 64), (2, 2, 16), (1, 1, 4)]);
        assert_eq!(shape(4), [(4, 4, 64), (2, 2, 16), (1, 1, 4), (1, 1, 4)]);
        assert_eq!(
            shape(5),
            [(4, 4, 64), (2, 2, 16), (1, 1, 4), (1, 1, 4), (1, 1, 4)]
        );

        let base = unhex("0b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186abd0f51a3f6489aed3f81d42678cb1d6fb20456a8fb4d9fe23486d92b7dc0126");
        let chain = build_mip_chain(&base, 4, 4, 3);
        assert_eq!(chain[0].rgba, base);
        assert_eq!(hex(&chain[1].rgba), "6754796c5b808e948c80a58c688d7874");
        assert_eq!(hex(&chain[2].rgba), "6e7a8b80");

        let flat: Vec<(usize, usize, usize)> = build_mip_chain(&[1, 2, 3, 4].repeat(8), 4, 2, 4)
            .iter()
            .map(|m| (m.width, m.height, m.rgba.len()))
            .collect();
        assert_eq!(flat, [(4, 2, 32), (2, 1, 8), (1, 1, 4), (1, 1, 4)]);
        let level = &build_mip_chain(&[1, 2, 3, 4].repeat(8), 4, 2, 4)[1];
        assert_eq!(
            format!("{level:?}"),
            "MipLevel { width: 2, height: 1, rgba: [1, 2, 3, 4, 1, 2, 3, 4] }"
        );
    }

    const HEAD_DXT1_1: &str = "444453207c000000071008002000000040000000000400000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000040000004458543100000000000000000000000000000000000000000010000000000000000000000000000000000000";

    #[test]
    fn write_header_table() {
        let rows: [(usize, usize, u32, &str, &str); 9] = [
            (64, 32, 1, "DXT1", HEAD_DXT1_1),
            (64, 32, 3, "DXT1", "444453207c00000007100a002000000040000000000400000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000040000004458543100000000000000000000000000000000000000000810400000000000000000000000000000000000"),
            (64, 32, 3, "DXT3", "444453207c00000007100a002000000040000000000800000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000040000004458543300000000000000000000000000000000000000000810400000000000000000000000000000000000"),
            (64, 32, 3, "DXT5", "444453207c00000007100a002000000040000000000800000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000040000004458543500000000000000000000000000000000000000000810400000000000000000000000000000000000"),
            (1, 1, 1, "DXT5", "444453207c000000071008000100000001000000100000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000040000004458543500000000000000000000000000000000000000000010000000000000000000000000000000000000"),
            (0, 0, 0, "DXT1", "444453207c000000071008000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000040000004458543100000000000000000000000000000000000000000010000000000000000000000000000000000000"),
            (64, 32, 1, "A8R8G8B8", "444453207c0000000f10000020000000400000000001000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000004100000000000000200000000000ff0000ff0000ff000000000000ff0010000000000000000000000000000000000000"),
            (64, 32, 3, "A8R8G8B8", "444453207c0000000f10020020000000400000000001000000000000030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000004100000000000000200000000000ff0000ff0000ff000000000000ff0810400000000000000000000000000000000000"),
            (0, 0, 0, "A8R8G8B8", "444453207c0000000f10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000004100000000000000200000000000ff0000ff0000ff000000000000ff0010000000000000000000000000000000000000"),
        ];
        for (w, h, m, f, want) in rows {
            assert_eq!(
                hex(&write_header(w, h, m, f).unwrap()),
                want,
                "{f} {w}x{h} m{m}"
            );
        }
        for name in ["XXXX", "dxt1", "", "D", "a8", "DX10"] {
            assert_eq!(
                fail(write_header(4, 4, 1, name)),
                format!("Argument: Неизвестный формат текстуры: {name}.")
            );
        }
    }

    /// Заголовок описывает ровно те данные, что за ним лежат: FourCC, DXGI или маски
    /// пикселей своего формата, а не «A8R8G8B8 для всего».
    #[test]
    fn header_describes_the_format_of_the_data() {
        let h = |name: &str| write_header(8, 4, 1, name).unwrap();
        let word = |b: &[u8], at: usize| u32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        for (name, code) in [("DXT1", b"DXT1"), ("DXT3", b"DXT3"), ("DXT5", b"DXT5"), ("ATI1", b"ATI1"), ("ATI2", b"ATI2")] {
            let b = h(name);
            assert_eq!((b.len(), word(&b, 80), &b[84..88]), (128, 0x4, &code[..]), "{name}");
            assert_eq!(word(&b, 20) as usize, level_bytes(name, 8, 4).unwrap(), "{name}");
        }
        let bc7 = h("BC7");
        assert_eq!((bc7.len(), &bc7[84..88]), (148, &b"DX10"[..]));
        assert_eq!(
            [word(&bc7, 128), word(&bc7, 132), word(&bc7, 136), word(&bc7, 140), word(&bc7, 144)],
            [98, 3, 0, 1, 0]
        );
        let masks = |b: &[u8]| [word(b, 80), word(b, 88), word(b, 92), word(b, 96), word(b, 100), word(b, 104)];
        assert_eq!(masks(&h("A8R8G8B8")), [0x41, 32, 0xff0000, 0xff00, 0xff, 0xff000000]);
        assert_eq!(masks(&h("X8R8G8B8")), [0x40, 32, 0xff0000, 0xff00, 0xff, 0]);
        assert_eq!(masks(&h("A8B8G8R8")), [0x41, 32, 0xff, 0xff00, 0xff0000, 0xff000000]);
        assert_eq!(masks(&h("A8")), [0x2, 8, 0, 0, 0, 0xff]);
        assert_eq!(masks(&h("L8")), [0x2_0000, 8, 0xff, 0, 0, 0]);
        assert_eq!(word(&h("A8"), 20), 8);
        assert_eq!(word(&h("A8R8G8B8"), 20), 32);
    }

    #[test]
    fn read_header_table() {
        let base = write_header(64, 32, 3, "DXT5").unwrap().to_vec();
        let patch = |edits: &[(usize, u32)]| {
            let mut b = base.clone();
            for &(at, v) in edits {
                b[at..at + 4].copy_from_slice(&v.to_le_bytes());
            }
            b
        };
        let ok = |w: usize, h: usize, d: u32, m: u32, f: &str| Header {
            width: w,
            height: h,
            depth: d,
            mip_levels: m,
            format: f.into(),
        };
        let four = |s: &[u8; 4]| u32::from_le_bytes(*s);
        let dims = "Broken: DDS содержит неподдерживаемые размеры или mip-уровни.";

        assert_eq!(read_header(&base).unwrap(), ok(64, 32, 1, 3, "DXT5"));
        assert_eq!(
            fail(read_header(&base[..127])),
            "Broken: DDS короче заголовка."
        );
        assert_eq!(fail(read_header(&[])), "Broken: DDS короче заголовка.");
        assert_eq!(
            fail(read_header(&patch(&[(0, 1)]))),
            "Broken: Файл не является DDS."
        );
        assert_eq!(
            fail(read_header(&patch(&[(4, 123)]))),
            "Broken: Файл не является DDS."
        );
        assert_eq!(
            fail(read_header(&patch(&[(76, 31)]))),
            "Broken: DDS содержит повреждённый блок формата пикселей."
        );
        assert_eq!(fail(read_header(&patch(&[(12, 0)]))), dims);
        assert_eq!(fail(read_header(&patch(&[(16, 0)]))), dims);
        assert_eq!(
            read_header(&patch(&[(16, 8192)])).unwrap(),
            ok(8192, 32, 1, 3, "DXT5")
        );
        assert_eq!(fail(read_header(&patch(&[(16, 8193)]))), dims);
        assert_eq!(fail(read_header(&patch(&[(12, 8193)]))), dims);
        assert_eq!(
            read_header(&patch(&[(28, 16)])).unwrap(),
            ok(64, 32, 1, 16, "DXT5")
        );
        assert_eq!(fail(read_header(&patch(&[(28, 17)]))), dims);
        assert_eq!(
            read_header(&patch(&[(28, 0)])).unwrap(),
            ok(64, 32, 1, 1, "DXT5")
        );
        assert_eq!(
            read_header(&patch(&[(24, 5)])).unwrap(),
            ok(64, 32, 5, 3, "DXT5")
        );
        assert_eq!(
            read_header(&patch(&[(24, 0)])).unwrap(),
            ok(64, 32, 1, 3, "DXT5")
        );
        for (code, shown) in [
            (four(b"DX10"), "DX10"),
            (0, "?"),
            (four(b"ATI1"), "ATI1"),
            (four(b"dxt1"), "dxt1"),
            (four(&[b'D', 0, b'X', b'T']), "DXT"),
            (four(&[0xe9; 4]), "éééé"),
        ] {
            assert_eq!(
                fail(read_header(&patch(&[(84, code)]))),
                format!("Broken: DDS формата {shown} не поддерживается.")
            );
        }
        // 32 бита без масок ARGB — отказ; с масками — A8R8G8B8.
        assert_eq!(
            fail(read_header(&patch(&[(80, 0), (88, 32)]))),
            "Broken: DDS без сжатия: нужен A8R8G8B8 с масками ARGB."
        );
        assert_eq!(
            read_header(&patch(&[
                (80, 0x41),
                (88, 32),
                (92, 0x00ff_0000),
                (96, 0x0000_ff00),
                (100, 0x0000_00ff),
                (104, 0xff00_0000),
            ]))
            .unwrap(),
            ok(64, 32, 1, 3, "A8R8G8B8")
        );
        assert_eq!(
            fail(read_header(&patch(&[(80, 0x41), (88, 24)]))),
            "Broken: DDS без сжатия поддерживается только в 32 битах."
        );
        assert_eq!(
            read_header(&patch(&[(80, 0x45)])).unwrap(),
            ok(64, 32, 1, 3, "DXT5")
        );
        let argb = write_header(4, 4, 1, "A8R8G8B8").unwrap();
        assert_eq!(read_header(&argb).unwrap(), ok(4, 4, 1, 1, "A8R8G8B8"));
        // 32 бита без масок ARGB (например, A8B8G8R8 или X8R8G8B8) — не A8R8G8B8.
        for odd in ["A8B8G8R8", "X8R8G8B8"] {
            assert_eq!(
                fail(read_header(&write_header(4, 4, 1, odd).unwrap())),
                "Broken: DDS без сжатия: нужен A8R8G8B8 с масками ARGB."
            );
        }
        let mut bpp16 = argb.to_vec();
        bpp16[88] = 16;
        assert_eq!(
            fail(read_header(&bpp16)),
            "Broken: DDS без сжатия поддерживается только в 32 битах."
        );
        let mut trailing = base.clone();
        trailing.extend([1, 2, 3, 4, 5]);
        assert_eq!(read_header(&trailing).unwrap(), ok(64, 32, 1, 3, "DXT5"));
    }

    #[test]
    fn header_round_trips_through_the_reader() {
        let h = write_header(64, 32, 3, "DXT5").unwrap();
        assert_eq!(
            read_header(&h).unwrap(),
            Header {
                width: 64,
                height: 32,
                depth: 1,
                mip_levels: 3,
                format: "DXT5".into()
            }
        );
        assert_eq!(
            read_header(&write_header(4, 4, 1, "A8R8G8B8").unwrap())
                .unwrap()
                .format,
            "A8R8G8B8"
        );
    }

    #[test]
    fn encode_errors_follow_check_order() {
        let call = |w: usize, h: usize, f: &str, m: u32, len: usize| {
            fail(encode_dds(w, h, f, m, &vec![0; len]))
        };
        let size = "Argument: Размер DDS вне допустимых границ.";
        let mips = "Argument: Число mip-уровней DDS вне допустимых границ.";
        assert_eq!(
            call(4, 4, "BC7", 1, 64),
            "Argument: Формат DDS BC7 не поддерживается."
        );
        assert_eq!(
            call(4, 4, "dxt1", 1, 64),
            "Argument: Формат DDS dxt1 не поддерживается."
        );
        assert_eq!(
            call(4, 4, "A8", 1, 64),
            "Argument: Формат DDS A8 не поддерживается."
        );
        assert_eq!(call(0, 4, "DXT1", 1, 0), size);
        assert_eq!(call(4, 0, "DXT1", 1, 0), size);
        assert_eq!(call(8193, 1, "DXT1", 1, 32772), size);
        assert_eq!(call(1, 8193, "DXT1", 1, 32772), size);
        assert_eq!(call(4, 4, "DXT1", 0, 64), mips);
        assert_eq!(call(4, 4, "DXT1", 17, 64), mips);
        assert_eq!(
            call(4, 4, "DXT1", 4, 64),
            "Argument: Для 4×4 нельзя построить 4 mip-уровней."
        );
        assert_eq!(
            call(4, 4, "DXT1", 1, 63),
            "Argument: Размер RGBA не совпадает с заявленным размером DDS."
        );
        assert_eq!(
            call(4, 4, "DXT1", 1, 65),
            "Argument: Размер RGBA не совпадает с заявленным размером DDS."
        );
        assert_eq!(
            call(0, 0, "NOPE", 0, 0),
            "Argument: Формат DDS NOPE не поддерживается."
        );
        assert_eq!(call(0, 4, "DXT1", 0, 0), size);
        assert_eq!(call(4, 4, "DXT1", 0, 3), mips);
        assert_eq!(call(4, 4, "DXT1", 17, 3), mips);
        assert_eq!(
            call(4, 4, "DXT1", 9, 3),
            "Argument: Для 4×4 нельзя построить 9 mip-уровней."
        );
        let e = encode_dds(4, 4, "DXT1", 1, &[0; 3]).unwrap_err();
        assert_eq!(
            format!("{e:?}"),
            r#"Error { kind: Argument, message: "Размер RGBA не совпадает с заявленным размером DDS." }"#
        );
    }

    fn sample(w: usize, h: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let a = if (x + y) % 5 == 0 {
                    0
                } else {
                    255 - (x * y % 100)
                };
                out.extend([
                    (x * 255 / w) as u8,
                    (y * 255 / h) as u8,
                    ((x + y) * 13 % 256) as u8,
                    a as u8,
                ]);
            }
        }
        out
    }

    #[test]
    fn encode_lengths_and_digests() {
        let rows: [(&str, usize, usize, u32, usize, &str); 36] = [
            (
                "DXT1",
                1,
                1,
                1,
                136,
                "b128a04da98b6d855fd98c6908f9ba47d0acf2e79c1b39d0cf3e5787ee52b23c",
            ),
            (
                "DXT1",
                2,
                2,
                2,
                144,
                "cb5267ba245e05965ab3051e1d126116bbf13f86fb1db017303897595844dd06",
            ),
            (
                "DXT1",
                4,
                4,
                1,
                136,
                "5b3e988d04923885363d646efc6dac9e75bcb980b2b58bfb9c2d911438db9b80",
            ),
            (
                "DXT1",
                4,
                4,
                3,
                152,
                "4294a3f40fb4cb033d1bd97d8a75b7163cc344e0961e7228a9300d9e8811c4ae",
            ),
            (
                "DXT1",
                5,
                3,
                3,
                160,
                "b4c1d35f45a992e1d6626d08600e86b71bbfd58f315389ec41dda9cb7d3f5a9d",
            ),
            (
                "DXT1",
                16,
                16,
                5,
                312,
                "8aee69c5cbf4e65f712d4ea9cf7a0ac0ce3bf12ffcf57a4f08834fa9a0d7c35d",
            ),
            (
                "DXT1",
                64,
                32,
                7,
                1512,
                "8f7cfcfddf9e05958fc04c5804e1e891563ca0bbde52725e12b480c36ca73fb7",
            ),
            (
                "DXT1",
                1,
                8,
                4,
                168,
                "fa803cea37c603c22cd9620881978f363a3642142fda2c7d619abb2880f743b2",
            ),
            (
                "DXT1",
                8192,
                1,
                14,
                32904,
                "fa0ce7a83ed5d53ba5c64163e0b0fba55fb360c16b391abf6e95a6e5bc5ce4c9",
            ),
            (
                "DXT3",
                1,
                1,
                1,
                144,
                "4af6e6dd63b6cca9985b871f819eabe1bba3621687c138eb261bd95909f99d37",
            ),
            (
                "DXT3",
                2,
                2,
                2,
                160,
                "272fdc129d1a11d5fc717d31537a95631ede50ad12732652ccea1adf90973f37",
            ),
            (
                "DXT3",
                4,
                4,
                1,
                144,
                "e2c2bc8e930dfe188f30792fc2939b6fe93d0e35b800ffe51a69f8e0e5c82e30",
            ),
            (
                "DXT3",
                4,
                4,
                3,
                176,
                "97959525275bf9a789d270ef76558ea8acd9f40b1afdb57a910c163080ed0222",
            ),
            (
                "DXT3",
                5,
                3,
                3,
                192,
                "cc709c758c9183bea94c146576e861d88c3376746b3aa926134bbd560a2d0749",
            ),
            (
                "DXT3",
                16,
                16,
                5,
                496,
                "f71fb215b5aa87e133e54647c4c8da8ce1b5341ea1468b2b3e00649c95577263",
            ),
            (
                "DXT3",
                64,
                32,
                7,
                2896,
                "e1d5fbc98376870c839f0576cfaa4e30cf7e991a3f92df60ac99e85193c0ad7d",
            ),
            (
                "DXT3",
                1,
                8,
                4,
                208,
                "a046b7499071b5771d0e96724af5c892398b3f1b294862601ff7b2d5e84c9f5f",
            ),
            (
                "DXT3",
                8192,
                1,
                14,
                65680,
                "da29e39ac697128a24ddb85ccb63094cab80b2e1a4ec9622edf1ad2a2255ff30",
            ),
            (
                "DXT5",
                1,
                1,
                1,
                144,
                "4add95de6b1efdd776d061b5b895298a15f12d8d7c5aff6d30940ec5d0d3a8fe",
            ),
            (
                "DXT5",
                2,
                2,
                2,
                160,
                "49f8803c06792199823b25dd70df128061b3004c662f9a6f22d6f042437cbde8",
            ),
            (
                "DXT5",
                4,
                4,
                1,
                144,
                "25936e79f4415e9b288686019dcac53d98f439ef7e4c245fd6c0ce2d990a00b9",
            ),
            (
                "DXT5",
                4,
                4,
                3,
                176,
                "36ce884edc853810c7b20d31b8a6a969f92279e22036408989dead8552862206",
            ),
            (
                "DXT5",
                5,
                3,
                3,
                192,
                "845e3ed445be3c128d07463b373641358713be2142336547ef79a629ac04476b",
            ),
            (
                "DXT5",
                16,
                16,
                5,
                496,
                "6220adb414e3841f9b7d742c977ff5a80cce9edf484cd9ca8b1f9bcca9d50233",
            ),
            (
                "DXT5",
                64,
                32,
                7,
                2896,
                "351fbd44839ab16e796fca59997edd44f253879510b98a8bed1e6f2b98f00a69",
            ),
            (
                "DXT5",
                1,
                8,
                4,
                208,
                "f28b6d3573ba0d78bb01065e692320ba82b4359df9104aedd03fb63c29dbfb8c",
            ),
            (
                "DXT5",
                8192,
                1,
                14,
                65680,
                "16c569cee16ef18c1881993c3d88eb7af1358fbac3200fc832336f78dd42e795",
            ),
            (
                "A8R8G8B8",
                1,
                1,
                1,
                132,
                "1d73a978ae99b284792ad4fe97b5569288db741c52b39b30aa127b5368ddcef2",
            ),
            (
                "A8R8G8B8",
                2,
                2,
                2,
                148,
                "0705173f2a964b8d44f1afe30f48c42fb51d18a6eb4eda0dd8569bbdb89dc2c3",
            ),
            (
                "A8R8G8B8",
                4,
                4,
                1,
                192,
                "41230b79d49dc884bb0dbdd947f754021677289e52d3833995cfaf1ef9d8bcc7",
            ),
            (
                "A8R8G8B8",
                4,
                4,
                3,
                212,
                "6fca130d5352607e9e98adb726f66923b769b1203940a23d439a331cfe2ac508",
            ),
            (
                "A8R8G8B8",
                5,
                3,
                3,
                200,
                "f3e0cd2b32539b54cc27ff73f90811cda8f1281051fad35b8f62c0a3201cf53b",
            ),
            (
                "A8R8G8B8",
                16,
                16,
                5,
                1492,
                "9dc6b2a06a99083986579e200b1445ff1b6b8996bff22508428d28a12336a547",
            ),
            (
                "A8R8G8B8",
                64,
                32,
                7,
                11052,
                "cbd2a622d6cae6ec792c4a754ee7d3645fd666ef31631414e34223360d1ed8ec",
            ),
            (
                "A8R8G8B8",
                1,
                8,
                4,
                188,
                "05becf17939bbc98308108ce7c0a61f3ca3d43092172fd901b9d764428eea1fd",
            ),
            (
                "A8R8G8B8",
                8192,
                1,
                14,
                65660,
                "cd6da33c24c37793b004c112fc70757ea1e2b12010cf99a007a40cba549b1b39",
            ),
        ];
        for (f, w, h, m, len, digest) in rows {
            let out = encode_dds(w, h, f, m, &sample(w, h)).unwrap();
            assert_eq!(out.len(), len, "{f} {w}x{h} m{m}");
            assert_eq!(hex(&Sha256::digest(&out)), digest, "{f} {w}x{h} m{m}");
        }
    }

    #[test]
    fn encode_whole_files() {
        let input = unhex("000000003f000dff7f001affbf0027ff003f0dff3f3f1afe7f3f27fdbf3f34fc007f1aff3f7f27fd7f7f34fbbf7f410000bf27ff3fbf34fc7fbf4100bfbf4ef6");
        let dxt1 = encode_dds(4, 4, "DXT1", 3, &input).unwrap();
        assert_eq!(hex(&dxt1), "444453207c00000007100a0004000000040000000800000000000000030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000400000044585431000000000000000000000000000000000000000008104000000000000000000000000000000000000250c86e03aaea750424e49856fcfcfccef76010ffffffff");
        let argb = encode_dds(4, 4, "A8R8G8B8", 3, &input).unwrap();
        assert_eq!(hex(&argb), "444453207c0000000f10020004000000040000001000000000000000030000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000004100000000000000200000000000ff0000ff0000ff000000000000ff0810400000000000000000000000000000000000000000000d003fff1a007fff2700bfff0d3f00ff1a3f3ffe273f7ffd343fbffc1a7f00ff277f3ffd347f7ffb417fbf0027bf00ff34bf3ffc41bf7f004ebfbff6112a2abf271f9ffe279f1ffe419f9f7c265c5cce");
        let red = [0xff, 0, 0, 0xff].repeat(4);
        let tail = |f: &str| hex(&encode_dds(2, 2, f, 2, &red).unwrap()[HEADER_BYTES..]);
        assert_eq!(tail("DXT1"), "00f8fff70000000000f8fff700000000");
        assert_eq!(
            tail("DXT3"),
            "ffffffffffffffff00f8fff700000000ffffffffffffffff00f8fff700000000"
        );
        assert_eq!(
            tail("DXT5"),
            "ffff00000000000000f8fff700000000ffff00000000000000f8fff700000000"
        );
        let one = encode_dds(1, 1, "A8R8G8B8", 1, &[1, 2, 3, 4]).unwrap();
        assert_eq!(hex(&one[..4]), "44445320");
        assert_eq!(one[128..], [3, 2, 1, 4]);
        assert_eq!(
            read_header(&encode_dds(16, 8, "DXT3", 4, &sample(16, 8)).unwrap()).unwrap(),
            Header {
                width: 16,
                height: 8,
                depth: 1,
                mip_levels: 4,
                format: "DXT3".into()
            }
        );
        let pattern: Vec<u8> = (0..64)
            .map(|i| ((i * 37 + i / 7 * 11 + 5) % 256) as u8)
            .collect();
        let out = encode_dds(4, 4, "DXT1", 1, &pattern).unwrap();
        assert_eq!(hex(&out[128..]), "ab11b76cefbdf71e");
    }

    fn panic_text(run: impl FnOnce() + std::panic::UnwindSafe) -> String {
        let payload = std::panic::catch_unwind(run).unwrap_err();
        match payload.downcast::<String>() {
            Ok(text) => *text,
            Err(other) => other
                .downcast_ref::<&str>()
                .map(|text| text.to_string())
                .unwrap_or_default(),
        }
    }

    #[test]
    fn sizes_that_overflow_are_refused_with_the_usual_message() {
        // 2^62 x 1 x 4 байт = 2^64: в release произведение обёртывалось в ноль, в debug было переполнением.
        assert_eq!(
            panic_text(|| {
                downsample(&[], 1 << 62, 1);
            }),
            "downsample: срез короче картинки"
        );
        assert_eq!(
            panic_text(|| bleed_transparent(&mut [], 1 << 62, 4)),
            "bleed_transparent: срез короче картинки"
        );
        // Пустая картинка без переполнения по-прежнему ничего не делает.
        bleed_transparent(&mut [], 0, usize::MAX);
    }

    #[test]
    fn header_refuses_sizes_that_do_not_fit_in_its_words() {
        let too_big = (1usize << 32) + 4;
        let no_room = "Размер текстуры не помещается в заголовок DDS.";
        let refusal = |result: Result<Vec<u8>>| {
            let error = result.unwrap_err();
            (error.kind, error.message)
        };
        // Ширина, высота и шаг строки — 32-битные слова: раньше лишнее молча отбрасывалось.
        for (width, height, format) in [
            (too_big, 1, "A8R8G8B8"),
            (1, too_big, "A8R8G8B8"),
            (1 << 31, 1, "A8R8G8B8"),
            (1 << 20, 1 << 20, "DXT1"),
        ] {
            assert_eq!(
                refusal(write_header(width, height, 1, format)),
                (crate::error::Kind::Argument, no_room.to_owned()),
                "{width}x{height} {format}"
            );
        }
        // Неизвестный формат по-прежнему побеждает: он проверяется первым.
        assert!(refusal(write_header(too_big, 1, 1, "NOPE")).1.starts_with("Неизвестный формат"));
        // Предельные размеры, которые влезают, пишутся как раньше.
        assert_eq!(write_header(u32::MAX as usize, 1, 1, "A8").unwrap().len(), 128);
    }
}
