//! Придуманный набор ключей для проверок, которым нужно шифрование NG.
//!
//! Таблицы нелинейные, как у набора игры, но придуманные: каждая — перестановка
//! байта, вложенная в своё подпространство слова через случайную обратимую
//! матрицу, плюс постоянная часть. Раундов, положений и расписания столько же,
//! сколько у игры. Суммы SHA-256 посчитаны по самому набору, поэтому шифрование
//! на нём работает. К набору игры это отношения не имеет: ни одного его байта
//! здесь нет.

use crate::keys::{KeySet, SetPins};

const AES_LEN: usize = 32;
const NG_KEYS_LEN: usize = 27_472;
const TABLES_LEN: usize = 278_528;
const LUT_LEN: usize = 256;
const MIXED: [[usize; 4]; 4] = [[0, 7, 10, 13], [1, 4, 11, 14], [2, 5, 8, 15], [3, 6, 9, 12]];

fn xorshift(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

/// Положения блока, питающие слово `word` в раунде `round`.
fn lanes(round: usize, word: usize) -> [usize; 4] {
    if matches!(round, 0 | 1 | 16) {
        [4 * word, 4 * word + 1, 4 * word + 2, 4 * word + 3]
    } else {
        MIXED[word]
    }
}

/// Обратима ли матрица 32 × 32 над GF(2), заданная столбцами.
#[allow(clippy::explicit_counter_loop, clippy::needless_range_loop)]
fn invertible(columns: &[u32; 32]) -> bool {
    let mut rows = *columns;
    let mut rank = 0;
    for bit in 0..32 {
        let Some(pivot) = (rank..32).find(|&r| (rows[r] >> bit) & 1 == 1) else {
            return false;
        };
        rows.swap(rank, pivot);
        let keep = rows[rank];
        for r in 0..32 {
            if r != rank && (rows[r] >> bit) & 1 == 1 {
                rows[r] ^= keep;
            }
        }
        rank += 1;
    }
    true
}

/// Четыре файла набора по зерну: AES, ключи NG, таблицы расшифровки, таблица имён.
fn parts(seed: u64) -> [Vec<u8>; 4] {
    let mut state = seed;
    let mut take = |n: usize| {
        (0..n)
            .map(|_| {
                xorshift(&mut state);
                (state >> 24) as u8
            })
            .collect::<Vec<u8>>()
    };
    let aes = take(AES_LEN);
    let ng_keys = take(NG_KEYS_LEN);
    let _ = take(TABLES_LEN);
    let lut = take(LUT_LEN);

    let mut state = seed | 1;
    let mut tables = vec![0u32; 17 * 16 * 256];
    for round in 0..17 {
        for word in 0..4 {
            let picks = lanes(round, word);
            let columns = loop {
                let candidate: [u32; 32] = std::array::from_fn(|_| xorshift(&mut state) as u32);
                if invertible(&candidate) {
                    break candidate;
                }
            };
            for (k, &pos) in picks.iter().enumerate() {
                let mut sbox: Vec<u8> = (0..=255).collect();
                for i in (1..256).rev() {
                    let j = (xorshift(&mut state) % (i as u64 + 1)) as usize;
                    sbox.swap(i, j);
                }
                let constant = xorshift(&mut state) as u32;
                for (b, &coordinate) in sbox.iter().enumerate() {
                    let mut value = 0u32;
                    for j in 0..8 {
                        if (coordinate >> j) & 1 == 1 {
                            value ^= columns[k * 8 + j];
                        }
                    }
                    tables[(round * 16 + pos) * 256 + b] = value ^ constant;
                }
            }
        }
    }
    let tables = tables.iter().flat_map(|w| w.to_le_bytes()).collect();
    [aes, ng_keys, tables, lut]
}

/// Придуманный набор по зерну; шифрование NG на нём проходит сверку по своим
/// же суммам.
pub fn nonlinear_set(seed: u64) -> KeySet {
    let [aes, ng_keys, tables, lut] = parts(seed);
    debug_assert_eq!(tables.len(), TABLES_LEN);
    let pins = SetPins::of_parts(&aes, &ng_keys, &tables, &lut);
    KeySet::from_parts(&aes, &ng_keys, &tables, &lut)
        .expect("набор нужных размеров")
        .with_pins(pins)
}
