//! Тяжёлые модули Astral на Rust (задача 6 ТЗ 06.10.2026).
//!
//! Модули выбраны замером, а не на глаз: сборка растительности владельца в
//! одном потоке шла 266 с, из них 141 с — сжатие ресурсов RSC7 (`zlib`
//! `deflateRawSync`, уровень 9), ещё 18 с — распаковка. Здесь то же сырое
//! deflate через libdeflate: поток, который читает любой inflate (и игра),
//! заметно быстрее при том же или меньшем размере.
//!
//! JS зовёт модуль через `@modovik/native-rs`; нет модуля — тот же вызов
//! идёт в `zlib` Node, результат после распаковки тот же байт в байт.

use libdeflater::{CompressionLvl, Compressor, DecompressionError, Decompressor};
use napi::bindgen_prelude::*;
use napi_derive::napi;

mod grass;

/// Сырое deflate (без заголовка zlib) уровнем 1…12; `level` как у zlib —
/// 6 и 9 значат то же, что там.
#[napi]
pub fn deflate_raw(input: Buffer, level: u32) -> Result<Buffer> {
    let lvl = CompressionLvl::new(level.clamp(1, 12) as i32)
        .map_err(|_| Error::from_reason(format!("уровень сжатия {level} вне 1…12")))?;
    let mut compressor = Compressor::new(lvl);
    let data: &[u8] = &input;
    let mut out = vec![0u8; compressor.deflate_compress_bound(data.len())];
    let size = compressor
        .deflate_compress(data, &mut out)
        .map_err(|error| Error::from_reason(format!("сжатие: {error:?}")))?;
    out.truncate(size);
    Ok(out.into())
}

/// Сырое inflate: `size` — длина распакованного (у ресурсов RSC7 она
/// известна из заголовка). Длина не та — отказ: значит, поток чужой.
#[napi]
pub fn inflate_raw(input: Buffer, size: u32) -> Result<Buffer> {
    let mut decompressor = Decompressor::new();
    let mut out = vec![0u8; size as usize];
    let written = decompressor
        .deflate_decompress(&input, &mut out)
        .map_err(|error| match error {
            DecompressionError::InsufficientSpace => Error::from_reason("распакованное длиннее ожидаемого".to_string()),
            DecompressionError::BadData => Error::from_reason("поток deflate повреждён".to_string()),
        })?;
    if written != out.len() {
        return Err(Error::from_reason(format!("распаковано {written} байт вместо {size}")));
    }
    Ok(out.into())
}

/// Слов в таблицах NG: 17 раундов × 16 таблиц × 256.
const NG_TABLE_WORDS: usize = 17 * 16 * 256;

/// Раунд NG: 16 табличных подстановок и ключ раунда (как `ngRound` в
/// `packages/rpf7/crypto.js`). Таблица `slot` раунда — с `round * 4096 +
/// slot * 256`.
#[inline(always)]
fn ng_round(input: &[u8; 16], output: &mut [u8; 16], key: &[u32], key_at: usize, tables: &[u32], round: usize, mixed: bool) {
    let t = &tables[round * 4096..round * 4096 + 4096];
    let s = |slot: usize, byte: usize| t[slot * 256 + input[byte] as usize];
    let (x1, x2, x3, x4) = if mixed {
        (
            s(0, 0) ^ s(7, 7) ^ s(10, 10) ^ s(13, 13),
            s(1, 1) ^ s(4, 4) ^ s(11, 11) ^ s(14, 14),
            s(2, 2) ^ s(5, 5) ^ s(8, 8) ^ s(15, 15),
            s(3, 3) ^ s(6, 6) ^ s(9, 9) ^ s(12, 12),
        )
    } else {
        (
            s(0, 0) ^ s(1, 1) ^ s(2, 2) ^ s(3, 3),
            s(4, 4) ^ s(5, 5) ^ s(6, 6) ^ s(7, 7),
            s(8, 8) ^ s(9, 9) ^ s(10, 10) ^ s(11, 11),
            s(12, 12) ^ s(13, 13) ^ s(14, 14) ^ s(15, 15),
        )
    };
    output[0..4].copy_from_slice(&(x1 ^ key[key_at]).to_le_bytes());
    output[4..8].copy_from_slice(&(x2 ^ key[key_at + 1]).to_le_bytes());
    output[8..12].copy_from_slice(&(x3 ^ key[key_at + 2]).to_le_bytes());
    output[12..16].copy_from_slice(&(x4 ^ key[key_at + 3]).to_le_bytes());
}

/// Расшифровка NG ключом `key` (68 слов) по таблицам `tables` (17×16×256
/// слов) — та же, что `decryptNgWithKey` в JS (задача 6 ТЗ 08.10, вечер).
/// Хвост короче блока остаётся как есть — так делает и игра.
#[napi]
pub fn ng_decrypt(input: Buffer, key: Uint32Array, tables: Uint32Array) -> Result<Buffer> {
    let key: &[u32] = &key;
    let tables: &[u32] = &tables;
    if key.len() != 68 {
        return Err(Error::from_reason(format!("ключ NG — 68 слов, а не {}", key.len())));
    }
    if tables.len() != NG_TABLE_WORDS {
        return Err(Error::from_reason(format!("таблицы NG — {NG_TABLE_WORDS} слов, а не {}", tables.len())));
    }
    let data: &[u8] = &input;
    let mut out = data.to_vec();
    let mut a = [0u8; 16];
    let mut b = [0u8; 16];
    for (block, chunk) in data.chunks_exact(16).enumerate() {
        a.copy_from_slice(chunk);
        ng_round(&a, &mut b, key, 0, tables, 0, false);
        ng_round(&b, &mut a, key, 4, tables, 1, false);
        for round in 2..=15 {
            ng_round(&a, &mut b, key, round * 4, tables, round, true);
            std::mem::swap(&mut a, &mut b);
        }
        ng_round(&a, &mut b, key, 64, tables, 16, false);
        out[block * 16..block * 16 + 16].copy_from_slice(&b);
    }
    Ok(out.into())
}

/// Сжатие блоков текстур DXT1/3/5 (`encodeDxtBlocks`).
mod dxt;

/// Приоритет ввода-вывода дочернего процесса (`setProcessIoPriority`, `processIoPriority`).
mod io_priority;

/// Занятость физического диска (`diskPerformance`): накопительные счётчики драйвера диска для регулятора (`disk-governor.js`).
mod disk_perf;
