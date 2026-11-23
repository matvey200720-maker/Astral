// Набор ключей GTA V: AES-256, 101 ключ табличного шифра NG, таблица имён.
// Расшифровка NG идёт по таблицам набора, шифрование NG — по обратному раунду,
// который строится из тех же таблиц (раздел «Шифрование NG» ниже).

use crate::error::{Result, RpfError};
use crate::ng_inverse::{Inverse, Lanes};
use aes::{
    cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit},
    Aes256,
};
use sha2::{Digest, Sha256};
use std::{fs, io, path::Path, sync::OnceLock};

// Имена файлов набора.
macro_rules! key_files {
    ($($name:ident = $file:literal;)+) => {
        $(pub const $name: &str = $file;)+
    };
}

key_files! {
    AES_KEY_FILE = "gtav_aes_key.dat";
    NG_KEY_FILE = "gtav_ng_key.dat";
    NG_TABLES_FILE = "gtav_ng_decrypt_tables.dat";
    HASH_LUT_FILE = "gtav_hash_lut.dat";
}

pub const NG_KEY_COUNT: usize = 101;

// Порядок чтения файлов набора совпадает с порядком аргументов `from_parts`.
const SET_FILES: [&str; 4] = [AES_KEY_FILE, NG_KEY_FILE, NG_TABLES_FILE, HASH_LUT_FILE];

const BLOCK_LEN: usize = 16;
const ROUNDS: usize = 17;
const KEY_WORDS: usize = ROUNDS * 4;
// Таблицы раунда: 16 положений в блоке по 256 значений байта.
const ROUND_TABLE_WORDS: usize = BLOCK_LEN * 256;

const AES_BYTES: usize = 32;
const LUT_BYTES: usize = 256;
const NG_KEYS_BYTES: usize = NG_KEY_COUNT * KEY_WORDS * 4;
const NG_TABLES_BYTES: usize = ROUNDS * ROUND_TABLE_WORDS * 4;
const SET_SIZES: [usize; 4] = [AES_BYTES, NG_KEYS_BYTES, NG_TABLES_BYTES, LUT_BYTES];

// Слагаемое выбора ключа: 101 - 40.
const KEY_PICK_BIAS: u64 = NG_KEY_COUNT as u64 - 40;

type Blob<'a> = &'a [u8];

const STRAIGHT_0: [usize; 4] = [0, 1, 2, 3];
const STRAIGHT_1: [usize; 4] = [4, 5, 6, 7];
const STRAIGHT_2: [usize; 4] = [8, 9, 10, 11];
const STRAIGHT_3: [usize; 4] = [12, 13, 14, 15];
const STRAIGHT: Lanes = [STRAIGHT_0, STRAIGHT_1, STRAIGHT_2, STRAIGHT_3];

const MIXED_0: [usize; 4] = [0, 7, 10, 13];
const MIXED_1: [usize; 4] = [1, 4, 11, 14];
const MIXED_2: [usize; 4] = [2, 5, 8, 15];
const MIXED_3: [usize; 4] = [3, 6, 9, 12];
const MIXED: Lanes = [MIXED_0, MIXED_1, MIXED_2, MIXED_3];

// Раунды 0, 1 и 16 берут положения подряд, остальные — перемешанные.
const SCHEDULE: [&Lanes; ROUNDS] = {
    let mut plan = [&MIXED; ROUNDS];
    plan[0] = &STRAIGHT;
    plan[1] = &STRAIGHT;
    plan[ROUNDS - 1] = &STRAIGHT;
    plan
};

fn word_at(bytes: &[u8], index: usize) -> u32 {
    let quad: [u8; 4] = bytes[index * 4..][..4].try_into().expect("четыре байта");
    u32::from_le_bytes(quad)
}

#[inline(always)]
fn lookup(tables: &[u32], state: &[u32; 4], pos: usize) -> u32 {
    let byte = (state[pos >> 2] >> ((pos & 3) << 3)) & 0xff;
    tables[(pos << 8) + byte as usize]
}

#[inline(always)]
fn mix_word(tables: &[u32], picks: &[usize; 4], base: u32, state: &[u32; 4]) -> u32 {
    // Четыре обращения подряд, без перебора и замыканий: так быстрее в отладочной сборке.
    base ^ lookup(tables, state, picks[0])
        ^ lookup(tables, state, picks[1])
        ^ lookup(tables, state, picks[2])
        ^ lookup(tables, state, picks[3])
}

// Один раунд для любого набора положений: четыре новых слова из старого состояния.
fn ng_round(tables: &[u32], lanes: &Lanes, key: &[u32], state: [u32; 4]) -> [u32; 4] {
    [
        mix_word(tables, &lanes[0], key[0], &state),
        mix_word(tables, &lanes[1], key[1], &state),
        mix_word(tables, &lanes[2], key[2], &state),
        mix_word(tables, &lanes[3], key[3], &state),
    ]
}

fn name_hash_step(acc: u32, byte: u8) -> u32 {
    let acc = acc.wrapping_add(u32::from(byte));
    let acc = acc.wrapping_add(acc << 10);
    acc ^ (acc >> 6)
}

fn name_hash_finish(acc: u32) -> u32 {
    let acc = acc.wrapping_add(acc << 3);
    let acc = acc ^ (acc >> 11);
    acc.wrapping_add(acc << 15)
}

// Отказ чтения одного из файлов набора.
fn unreadable(file: &str, dir: &Path, cause: &io::Error) -> RpfError {
    RpfError::keys(format!(
        "The GTA V RPF key file {file} could not be read from {}: {cause}",
        dir.display()
    ))
}

// Поля набора. `aes_key` и `ng_*` нужны ещё и затем, чтобы по ним пересчитать
// SHA-256 файлов набора перед шифрованием.
pub struct KeySet {
    name_lut: [u8; LUT_BYTES],
    ng_tables: Vec<u32>,
    ng_keys: Vec<[u32; KEY_WORDS]>,
    aes_key: [u8; AES_BYTES],
    aes: Aes256,
    pins: SetPins,
    // Обратные раунды NG: строятся один раз при первом шифровании, после сверки
    // набора с закреплёнными суммами. Отказ сверки или построения помнится так же.
    sealing: OnceLock<std::result::Result<Inverse, String>>,
}

/// SHA-256 четырёх файлов набора: AES-ключ, 101 ключ NG, таблицы расшифровки
/// NG, таблица хеша имён. Сверяются перед шифрованием, чтение их не проверяет.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetPins {
    pub aes: [u8; 32],
    pub ng_keys: [u8; 32],
    pub ng_tables: [u8; 32],
    pub hash_lut: [u8; 32],
}

const fn hex_digit(digit: u8) -> u8 {
    match digit {
        b'0'..=b'9' => digit - b'0',
        b'a'..=b'f' => digit - b'a' + 10,
        _ => panic!("не шестнадцатеричная цифра"),
    }
}

const fn sha256_of_hex(text: &str) -> [u8; 32] {
    let digits = text.as_bytes();
    assert!(digits.len() == 64);
    let mut out = [0u8; 32];
    let mut at = 0;
    while at < 32 {
        out[at] = hex_digit(digits[at * 2]) << 4 | hex_digit(digits[at * 2 + 1]);
        at += 1;
    }
    out
}

/// Закреплённые суммы набора, с которым работает игра (те же, что у лаунчера,
/// `LEGACY_ARCHIVE_KEY_HASHES`).
pub const GAME_SET_PINS: SetPins = SetPins {
    aes: sha256_of_hex("1bc7625fc374717d47fa98c801562180873294a9d9de9eedb18876a208afe077"),
    ng_keys: sha256_of_hex("3c956b6220627e4350fc9a4f6da1c0269a7aac180093992296c892de5057dcf2"),
    ng_tables: sha256_of_hex("d6fbef9059284a68f617824ea188c74eae11b89f43c68580290f99ce75bb5fee"),
    hash_lut: sha256_of_hex("6590a782f6ad62e59d2f41204eb394a2671398509260b7cd9a368d0d9c832010"),
};

impl SetPins {
    /// Суммы по тем же четырём блокам, что принимает `KeySet::from_parts`.
    pub fn of_parts(aes: &[u8], ng_keys: &[u8], ng_tables: &[u8], hash_lut: &[u8]) -> SetPins {
        let sum = |bytes: &[u8]| -> [u8; 32] { Sha256::digest(bytes).into() };
        SetPins {
            aes: sum(aes),
            ng_keys: sum(ng_keys),
            ng_tables: sum(ng_tables),
            hash_lut: sum(hash_lut),
        }
    }
}

fn le_words(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

impl KeySet {
    pub fn name_hash(&self, name: &str) -> u32 {
        let mut acc = 0;
        for unit in name.encode_utf16() {
            acc = name_hash_step(acc, self.name_lut[usize::from(unit & 0xff)]);
        }
        name_hash_finish(acc)
    }

    pub fn from_parts(aes: Blob, ng_keys: Blob, ng_tables: Blob, hash_lut: Blob) -> Result<Self> {
        if [aes.len(), ng_keys.len(), ng_tables.len(), hash_lut.len()] != SET_SIZES {
            return Err(RpfError::keys("The GTA V RPF key set is incomplete."));
        }

        let mut name_lut = [0u8; LUT_BYTES];
        name_lut.copy_from_slice(hash_lut);
        let tables = Vec::from_iter((0..NG_TABLES_BYTES / 4).map(|at| word_at(ng_tables, at)));
        let keys = Vec::from_iter(
            (0..NG_KEY_COUNT)
                .map(|at| std::array::from_fn(|word| word_at(ng_keys, at * KEY_WORDS + word))),
        );
        let cipher = Aes256::new(GenericArray::from_slice(aes));
        let mut aes_key = [0u8; AES_BYTES];
        aes_key.copy_from_slice(aes);

        Ok(KeySet {
            name_lut,
            ng_tables: tables,
            ng_keys: keys,
            aes_key,
            aes: cipher,
            pins: GAME_SET_PINS,
            sealing: OnceLock::new(),
        })
    }

    /// Набор, у которого шифрование NG сверяется с другими суммами. Нужен
    /// проверкам на придуманных наборах; рабочий набор сверяется с `GAME_SET_PINS`.
    #[doc(hidden)]
    pub fn with_pins(mut self, pins: SetPins) -> Self {
        self.pins = pins;
        self.sealing = OnceLock::new();
        self
    }

    pub fn load_dir(dir: &Path) -> Result<Self> {
        // Остановка на первой неудаче: дальше файлы не читаются.
        let mut blobs: Vec<Vec<u8>> = Vec::new();
        for file in SET_FILES {
            match fs::read(dir.join(file)) {
                Ok(blob) => blobs.push(blob),
                Err(cause) => return Err(unreadable(file, dir, &cause)),
            }
        }
        Self::from_parts(&blobs[0], &blobs[1], &blobs[2], &blobs[3])
    }

    pub fn decrypt_ng_by_name(&self, name: &str, size: u64, data: &mut [u8]) {
        let index = self.ng_key_index(name, size);
        self.decrypt_ng(index, data);
    }

    pub fn decrypt_aes(&self, data: &mut [u8]) {
        data.chunks_exact_mut(BLOCK_LEN)
            .for_each(|block| self.aes.decrypt_block(GenericArray::from_mut_slice(block)));
    }

    pub fn decrypt_ng(&self, key_index: usize, data: &mut [u8]) {
        let key = self.ng_keys[key_index];
        for block in data.chunks_exact_mut(BLOCK_LEN) {
            self.ng_block(&key, block);
        }
    }

    // Один блок в 16 байт проходит все раунды.
    fn ng_block(&self, key: &[u32; KEY_WORDS], block: &mut [u8]) {
        let packed = u128::from_le_bytes((&*block).try_into().expect("блок в 16 байт"));
        let mut state: [u32; 4] = std::array::from_fn(|w| (packed >> (32 * w)) as u32);
        for (round, lanes) in SCHEDULE.iter().enumerate() {
            let tables = &self.ng_tables[round * ROUND_TABLE_WORDS..][..ROUND_TABLE_WORDS];
            state = ng_round(tables, lanes, &key[round * 4..], state);
        }
        let joined = state
            .iter()
            .rev()
            .fold(0u128, |acc, &word| (acc << 32) | u128::from(word));
        block.copy_from_slice(&joined.to_le_bytes());
    }

    /// SHA-256 четырёх файлов набора, как они лежат на диске.
    fn set_digests(&self) -> SetPins {
        let keys: Vec<u32> = self.ng_keys.iter().flatten().copied().collect();
        SetPins::of_parts(
            &self.aes_key,
            &le_words(&keys),
            &le_words(&self.ng_tables),
            &self.name_lut,
        )
    }

    /// Набор совпадает с закреплённым: четыре файла по SHA-256. Отказ называет
    /// файл, но не показывает ни сумм, ни содержимого.
    pub fn verify_pins(&self) -> Result<()> {
        let have = self.set_digests();
        let files = [
            (AES_KEY_FILE, have.aes == self.pins.aes),
            (NG_KEY_FILE, have.ng_keys == self.pins.ng_keys),
            (NG_TABLES_FILE, have.ng_tables == self.pins.ng_tables),
            (HASH_LUT_FILE, have.hash_lut == self.pins.hash_lut),
        ];
        match files.iter().find(|(_, same)| !same) {
            None => Ok(()),
            Some((file, _)) => Err(RpfError::keys(format!(
                "The GTA V RPF key file {file} does not match the pinned SHA-256; NG encryption refused."
            ))),
        }
    }

    // Обратные раунды: сверка набора, затем построение; итог помнится.
    fn sealing(&self) -> Result<&Inverse> {
        let built = self.sealing.get_or_init(|| {
            self.verify_pins().map_err(|error| error.to_string())?;
            Inverse::build(&self.ng_tables, &SCHEDULE, ROUND_TABLE_WORDS)
                .map_err(|reason| format!("The GTA V RPF key set cannot be inverted: {reason}."))
        });
        built.as_ref().map_err(|text| RpfError::keys(text.clone()))
    }

    /// Шифрование NG: обратное к `decrypt_ng`, блоками по 16 байт (неполный хвост
    /// не трогается, как и при расшифровке). Работает только на наборе, чьи
    /// файлы совпали с закреплёнными суммами; иначе отказ и данные не тронуты.
    pub fn encrypt_ng(&self, key_index: usize, data: &mut [u8]) -> Result<()> {
        let inverse = self.sealing()?;
        let key = &self.ng_keys[key_index];
        for block in data.chunks_exact_mut(BLOCK_LEN) {
            inverse.block(key, block);
        }
        Ok(())
    }

    /// То же, ключ выбирается по имени и размеру, как у `decrypt_ng_by_name`.
    pub fn encrypt_ng_by_name(&self, name: &str, size: u64, data: &mut [u8]) -> Result<()> {
        self.encrypt_ng(self.ng_key_index(name, size), data)
    }

    pub fn ng_key_count(&self) -> usize {
        self.ng_keys.len()
    }

    pub fn ng_key_index(&self, name: &str, size: u64) -> usize {
        let sum = u64::from(self.name_hash(name)) + (size & 0xffff_ffff) + KEY_PICK_BIAS;
        ((sum & 0xffff_ffff) % NG_KEY_COUNT as u64) as usize
    }
}
