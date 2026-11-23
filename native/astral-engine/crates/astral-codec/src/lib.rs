//! Кодек блоков BC для хоста Astral: декод BC1–BC5 по формулам CodeWalker, BC7 через `bcdec_rs`,
//! кодирование отдаёт `rage_res::bc_encode`. Хост зовёт три функции C ABI (`astral_codec.dll`),
//! остальное — открытый Rust-интерфейс для примеров и тестов.
#![allow(unsafe_code)]

use rage_res::bc_encode::{compress, BcFormat};
use std::panic;

/// Объявляет открытые числовые константы интерфейса вместе с их пояснениями.
macro_rules! public_codes {
    ($($(#[$doc:meta])* $name:ident: $ty:ty = $value:expr;)+) => {
        $($(#[$doc])* pub const $name: $ty = $value;)+
    };
}

public_codes! {
    /// Версия интерфейса; хост сверяет её при загрузке.
    ABI_VERSION: u32 = 1;
    OK: i32 = 0;
    ERR_ARGUMENT: i32 = OK + 1;
    ERR_FORMAT: i32 = ERR_ARGUMENT + 1;
    ERR_LENGTH: i32 = ERR_FORMAT + 1;
    ERR_INTERNAL: i32 = ERR_LENGTH + 1;
    /// Коды форматов — как у `DXGI_FORMAT_BCn_UNORM`; хост передаёт их как есть.
    DXGI_BC1: u32 = 71;
    DXGI_BC2: u32 = 74;
    DXGI_BC3: u32 = 77;
    DXGI_BC4: u32 = 80;
    DXGI_BC5: u32 = 83;
    DXGI_BC7: u32 = 98;
}

/// Наибольшая сторона уровня, которую кодек принимает.
const SIDE_LIMIT: usize = 16384;
/// Наибольшая длина буфера, который хост может отдать через границу ABI.
const BUFFER_LIMIT: usize = 4 * SIDE_LIMIT * SIDE_LIMIT;
/// Пиксели плитки 4×4 в блоке.
const TILE_PIXELS: usize = 16;
/// Размер одного закодированного блока для каждого читаемого формата.
const BLOCK_SIZES: [(u32, usize); 6] = [
    (DXGI_BC1, 8),
    (DXGI_BC4, 8),
    (DXGI_BC2, 16),
    (DXGI_BC3, 16),
    (DXGI_BC5, 16),
    (DXGI_BC7, 16),
];
/// Какой кодер `rage_res` сжимает какой формат.
const ENCODERS: [(u32, BcFormat); 5] = [
    (DXGI_BC1, BcFormat::Bc1),
    (DXGI_BC2, BcFormat::Bc2),
    (DXGI_BC3, BcFormat::Bc3),
    (DXGI_BC4, BcFormat::Bc4),
    (DXGI_BC5, BcFormat::Bc5),
];

type Tile = [[u8; 4]; TILE_PIXELS];

/// Размер закодированного уровня в байтах; `None` для неизвестного формата.
pub fn block_bytes(format: u32, width: usize, height: usize) -> Option<usize> {
    let &(_, per_block) = BLOCK_SIZES.iter().find(|(code, _)| *code == format)?;
    let blocks: usize = [width, height]
        .iter()
        .map(|side| side.div_ceil(4))
        .product();
    Some(blocks * per_block)
}

/// Обе стороны должны быть положительными и не больше предела.
fn check_sides(sides: [usize; 2]) -> Result<(), i32> {
    let within = sides.iter().all(|side| (1..=SIDE_LIMIT).contains(side));
    within.then_some(()).ok_or(ERR_ARGUMENT)
}

/// Расширение RGB565 до RGB888 так, как это делает CodeWalker (делениями, не сдвигами).
fn expand565(color: u16) -> [i32; 3] {
    // Для каждого канала: сдвиг, маска, добавка и делитель.
    let channels = [(11, 31, 16, 32), (5, 63, 32, 64), (0, 31, 16, 32)];
    channels.map(|(shift, mask, bias, divisor)| {
        let temp = i32::from((color >> shift) & mask) * 255 + bias;
        (temp / divisor + temp) / divisor
    })
}

/// Один канал блока BC4 (8 байт) — значения 16 пикселей.
fn channel_values(block: &[u8]) -> [u8; 16] {
    let (first, second) = (i32::from(block[0]), i32::from(block[1]));
    let bits = block[2..8]
        .iter()
        .rev()
        .fold(0u64, |bits, &byte| (bits << 8) | u64::from(byte));
    // Восемь опорных значений; при `first <= second` шесть шагов и крайние 0 и 255.
    let steps = if first > second { 7 } else { 5 };
    let ramp: [i32; 8] = std::array::from_fn(|slot| {
        let at = slot as i32;
        match slot {
            0 => first,
            1 => second,
            6 if steps == 5 => 0,
            7 if steps == 5 => 255,
            _ => ((steps + 1 - at) * first + (at - 1) * second) / steps,
        }
    });
    std::array::from_fn(|pixel| ramp[((bits >> (3 * pixel)) & 7) as usize] as u8)
}

/// Цветовой блок BC1 (8 байт) в 16 пикселей RGBA. `always_four` — режим без прозрачности (BC2, BC3).
fn colour_tile(block: &[u8], always_four: bool) -> Tile {
    let word = |at: usize| u16::from_le_bytes([block[at], block[at + 1]]);
    let (first, second) = (word(0), word(2));
    let lookup = u32::from_le_bytes(block[4..8].try_into().unwrap());
    let (c0, c1) = (expand565(first), expand565(second));
    let four_colours = always_four || first > second;
    let opaque = |[r, g, b]: [i32; 3]| [r, g, b, 255];
    // Смесь двух крайних цветов с весами и общим делителем.
    let mix = |near: i32, far: i32, divisor: i32| {
        opaque([0, 1, 2].map(|k| (near * c0[k] + far * c1[k]) / divisor))
    };
    let palette: [[i32; 4]; 4] = [
        opaque(c0),
        opaque(c1),
        if four_colours {
            mix(2, 1, 3)
        } else {
            mix(1, 1, 2)
        },
        if four_colours { mix(1, 2, 3) } else { [0; 4] },
    ];
    std::array::from_fn(|pixel| {
        palette[((lookup >> (2 * pixel)) & 3) as usize].map(|part| part as u8)
    })
}

/// Плитка 4×4 RGBA одного блока заданного формата.
fn decode_tile(format: u32, block: &[u8]) -> Tile {
    match format {
        DXGI_BC1 => colour_tile(block, false),
        DXGI_BC2 | DXGI_BC3 => {
            let alpha: [u8; TILE_PIXELS] = if format == DXGI_BC2 {
                std::array::from_fn(|pixel| ((block[pixel / 2] >> (4 * (pixel % 2))) & 0x0F) * 17)
            } else {
                channel_values(&block[0..8])
            };
            let mut tile = colour_tile(&block[8..16], true);
            tile.iter_mut()
                .zip(alpha)
                .for_each(|(rgba, value)| rgba[3] = value);
            tile
        }
        DXGI_BC7 => {
            let mut raw = [0u8; 4 * TILE_PIXELS];
            bcdec_rs::bc7(block, &mut raw, 16);
            std::array::from_fn(|pixel| raw[pixel * 4..pixel * 4 + 4].try_into().unwrap())
        }
        _ => {
            let red = channel_values(&block[0..8]);
            let green = match format {
                DXGI_BC4 => [0; TILE_PIXELS],
                _ => channel_values(&block[8..16]),
            };
            std::array::from_fn(|pixel| [red[pixel], green[pixel], 0, 255])
        }
    }
}

/// Распаковка уровня BC в RGBA8 (`width × height`, строки подряд, без добивки).
pub fn decode(
    format: u32,
    data: &[u8],
    width: usize,
    height: usize,
    out: &mut [u8],
) -> Result<(), i32> {
    check_sides([width, height])?;
    let need = block_bytes(format, width, height).ok_or(ERR_FORMAT)?;
    (data.len() == need && out.len() == width * height * 4)
        .then_some(())
        .ok_or(ERR_LENGTH)?;
    // Данные идут полосами по четыре строки пикселей; полоса — ряд блоков.
    let band_len = need / height.div_ceil(4);
    let block_len = band_len / width.div_ceil(4);
    for (band, blocks) in data.chunks_exact(band_len).enumerate() {
        let tiles: Vec<Tile> = blocks
            .chunks_exact(block_len)
            .map(|block| decode_tile(format, block))
            .collect();
        for y in band * 4..(band * 4 + 4).min(height) {
            for x in 0..width {
                let at = (y * width + x) * 4;
                out[at..at + 4].copy_from_slice(&tiles[x / 4][(y % 4) * 4 + x % 4]);
            }
        }
    }
    Ok(())
}

/// Сжатие RGBA8 в блоки BC1–BC5 (BC7 только читается).
pub fn encode(
    format: u32,
    rgba: &[u8],
    width: usize,
    height: usize,
    out: &mut [u8],
) -> Result<(), i32> {
    check_sides([width, height])?;
    let (kind, need) = ENCODERS
        .iter()
        .find(|(code, _)| *code == format)
        .and_then(|&(_, kind)| Some((kind, block_bytes(format, width, height)?)))
        .ok_or(ERR_FORMAT)?;
    (rgba.len() == width * height * 4 && out.len() == need)
        .then_some(())
        .ok_or(ERR_LENGTH)?;
    let packed = compress(rgba, width, height, kind).ok_or(ERR_ARGUMENT)?;
    if packed.len() == need {
        out.copy_from_slice(&packed);
        Ok(())
    } else {
        Err(ERR_INTERNAL)
    }
}

/// Общий путь обеих функций C ABI: проверка буферов, срезы из указателей, действие, код возврата.
/// Паника внутри не выходит через границу DLL, а становится `ERR_INTERNAL`.
///
/// # Safety
/// Те же условия, что у `astral_decode_bc`: ненулевые указатели ведут на буферы указанной длины,
/// живущие до возврата.
unsafe fn via_buffers(
    source: (*const u8, usize),
    target: (*mut u8, usize),
    run: impl FnOnce(&[u8], &mut [u8]) -> Result<(), i32>,
) -> i32 {
    let action = || {
        let ((input, input_len), (out, out_len)) = (source, target);
        let present = !(input.is_null() || out.is_null());
        if !present || [input_len, out_len].iter().any(|&len| len > BUFFER_LIMIT) {
            return ERR_ARGUMENT;
        }
        // SAFETY: хост отдаёт буферы нужной длины и держит их до возврата, нули и размеры
        // проверены выше.
        let (readable, writable) = unsafe {
            (
                std::slice::from_raw_parts(input, input_len),
                std::slice::from_raw_parts_mut(out, out_len),
            )
        };
        run(readable, writable).err().unwrap_or(OK)
    };
    panic::catch_unwind(panic::AssertUnwindSafe(action)).unwrap_or(ERR_INTERNAL)
}

/// Версия интерфейса.
#[no_mangle]
pub extern "C" fn astral_codec_abi_version() -> u32 {
    ABI_VERSION
}

/// Объявляет функцию C ABI, которая гонит пару буферов через `via_buffers` в действие `$action`.
macro_rules! c_entry {
    ($(#[$doc:meta])* $name:ident => $action:ident) => {
        $(#[$doc])*
        #[no_mangle]
        pub unsafe extern "C" fn $name(
            format: u32,
            input: *const u8,
            input_len: usize,
            width: u32,
            height: u32,
            out: *mut u8,
            out_len: usize,
        ) -> i32 {
            // SAFETY: условия функции передаются дальше без изменений.
            unsafe {
                via_buffers((input, input_len), (out, out_len), |source, target| {
                    $action(format, source, width as usize, height as usize, target)
                })
            }
        }
    };
}

c_entry! {
    /// Распаковка уровня BC в RGBA8; возвращает `OK` или код ошибки.
    ///
    /// # Safety
    /// `input` и `out` ведут на буферы длиной `input_len` и `out_len` (или оба нулевые с нулевыми
    /// длинами — только для пути отказа); буферы живут до возврата.
    astral_decode_bc => decode
}

c_entry! {
    /// Сжатие RGBA8 в блоки BC1–BC5; возвращает `OK` или код ошибки.
    ///
    /// # Safety
    /// `input` и `out` ведут на буферы длиной `input_len` и `out_len` (или оба нулевые с нулевыми
    /// длинами — только для пути отказа); буферы живут до возврата.
    astral_encode_bc => encode
}

#[cfg(test)]
mod table_tests {
    use super::*;

    #[test]
    fn six_step_alpha_table_truncates_like_codewalker() {
        let block = [0, 255, 2 | (5 << 3), 0, 0, 0, 0, 0];
        assert_eq!(channel_values(&block)[..2], [51, 204]);
    }

    #[test]
    fn rgb565_expansion_matches_codewalker_rounding() {
        let cases = [
            (0xF800, 0, 255),
            (0xF800, 1, 0),
            (0xF800, 2, 0),
            (0x0010, 2, 132),
        ];
        for (colour, channel, expected) in cases {
            assert_eq!(expand565(colour)[channel], expected, "{colour:#06x}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Результат `decode`, который обязан удаться.
    fn decoded(format: u32, data: &[u8], width: usize, height: usize) -> Vec<u8> {
        let mut out: Vec<u8> = std::iter::repeat_n(0, width * height * 4).collect();
        decode(format, data, width, height, &mut out).unwrap();
        out
    }

    /// Результат `encode`, который обязан удаться.
    fn squeezed(format: u32, rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
        let mut out = vec![0; block_bytes(format, width, height).unwrap()];
        encode(format, rgba, width, height, &mut out).unwrap();
        out
    }

    /// Все пиксели кадра равны `expected`.
    fn assert_uniform(pixels: &[u8], expected: [u8; 4]) {
        assert!(pixels.chunks_exact(4).all(|pixel| pixel == expected));
    }

    #[test]
    fn a_solid_bc1_block_decodes_to_its_colour() {
        let frame = [255, 0, 0, 255].repeat(16);
        let packed = squeezed(DXGI_BC1, &frame, 4, 4);
        assert_eq!(decoded(DXGI_BC1, &packed, 4, 4), frame);
    }

    #[test]
    fn bc4_decodes_to_red_only() {
        let mut block = [0u8; 8];
        block[..2].fill(200);
        assert_uniform(&decoded(DXGI_BC4, &block, 4, 4), [200, 0, 0, 255]);
    }

    #[test]
    fn bc5_decodes_red_and_green_and_leaves_blue_zero() {
        let block: Vec<u8> = [100u8, 50]
            .into_iter()
            .flat_map(|level| [level, level, 0, 0, 0, 0, 0, 0])
            .collect();
        assert_uniform(&decoded(DXGI_BC5, &block, 4, 4), [100, 50, 0, 255]);
    }

    #[test]
    fn partial_edges_round_trip_through_bc3() {
        let (width, height) = (6, 5);
        let frame: Vec<u8> = (0..width * height)
            .flat_map(|i| [i * 9, i * 5, 128, 255].map(|part| part as u8))
            .collect();
        let packed = squeezed(DXGI_BC3, &frame, width, height);
        assert_eq!(packed.len(), 64);
        let back = decoded(DXGI_BC3, &packed, width, height);
        let worst = (0..frame.len())
            .map(|at| frame[at].abs_diff(back[at]))
            .max()
            .unwrap();
        assert!(worst < 60, "BC3 отошёл на {worst}");
    }

    #[test]
    fn wrong_lengths_and_formats_are_refused_with_codes() {
        // чем кормим, формат, длина входа, ширина, длина выхода, ожидаемый код
        let refusals = [
            (false, DXGI_BC1, 7, 4, 64, ERR_LENGTH),
            (false, DXGI_BC1, 8, 4, 63, ERR_LENGTH),
            (false, 0, 8, 4, 64, ERR_FORMAT),
            (true, DXGI_BC7, 64, 4, 16, ERR_FORMAT),
            (false, DXGI_BC1, 8, 0, 64, ERR_ARGUMENT),
        ];
        for (encoding, format, in_len, width, out_len, code) in refusals {
            let (input, mut output) = (vec![0u8; in_len], vec![0u8; out_len]);
            let result = match encoding {
                true => encode(format, &input, width, 4, &mut output),
                false => decode(format, &input, width, 4, &mut output),
            };
            assert_eq!(result, Err(code), "формат {format}, входа {in_len}");
        }
    }

    #[test]
    fn the_c_entry_points_refuse_null_pointers_and_report_the_version() {
        let mut out = [0u8; 64];
        let out_len = out.len();
        let mut call = |data: *const u8, data_len: usize| {
            // SAFETY: непустой указатель ведёт на живой буфер указанной длины, пустой — путь отказа.
            unsafe { astral_decode_bc(DXGI_BC1, data, data_len, 4, 4, out.as_mut_ptr(), out_len) }
        };
        assert_eq!(call(std::ptr::null(), 0), ERR_ARGUMENT);
        let block = [0u8; 8];
        assert_eq!(call(block.as_ptr(), block.len()), OK);
        assert_eq!(astral_codec_abi_version(), ABI_VERSION);
    }
}
