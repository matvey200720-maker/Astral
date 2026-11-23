//! Сжатие блоков текстур DXT1/3/5 для JS (ядро «Astral быстрее», 15.11.2026).
//!
//! Тот же кодек, что в движке: `rage_res::dxt_block` — точный порт
//! `packages/dds/block-codec.js`, сверенный байт в байт на 814 словарях игры.
//! Здесь только мост для Node: формат, картинка и готовый буфер под блоки
//! приходят из JS, ничего не выделяется и не копируется лишний раз.
//!
//! JS зовёт ядро через `@modovik/native-rs` (`encodeBlocksNative`); любой
//! отказ — неизвестный формат, чужая длина, старый модуль без этой функции —
//! молча возвращает JS его собственный кодек, он остаётся эталоном.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rage_res::dxt_block::{blocks_len, encode_blocks, Format};

/// Сжимает RGBA в блоки DXT: `format` — «DXT1», «DXT3» или «DXT5»; `rgba` —
/// ровно `width × height × 4` байт; `output` — буфер под блоки длиной ровно
/// `blocks_len` (JS заводит его сам, так результат остаётся его обычным
/// `Uint8Array` без копии). Края картинки, не кратные четырём, достраиваются
/// повтором, как в JS.
#[napi]
pub fn encode_dxt_blocks(format: String, rgba: Buffer, width: u32, height: u32, mut output: Buffer) -> Result<()> {
    let format = Format::parse(&format).ok_or_else(|| Error::from_reason(format!("формат блоков {format}: нужен DXT1, DXT3 или DXT5")))?;
    if width == 0 || height == 0 {
        return Err(Error::from_reason(format!("размер {width}×{height}: стороны от 1")));
    }
    let (width, height) = (width as usize, height as usize);
    let pixels_len = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| Error::from_reason(format!("размер {width}×{height} не помещается в память")))?;
    let pixels: &[u8] = &rgba;
    if pixels.len() != pixels_len {
        return Err(Error::from_reason(format!("RGBA {width}×{height}: нужно {pixels_len} байт, пришло {}", pixels.len())));
    }
    let want = blocks_len(format, width, height);
    let target: &mut [u8] = &mut output;
    if target.len() != want {
        return Err(Error::from_reason(format!("блоки {width}×{height}: нужно {want} байт, буфер {}", target.len())));
    }
    encode_blocks(format, pixels, width, height, target);
    Ok(())
}
