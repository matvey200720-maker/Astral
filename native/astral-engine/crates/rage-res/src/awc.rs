//! Звуковые банки игры (`.awc`): оглавление, звук потоков (PCM и IMA ADPCM),
//! картинка формы волны, сборка плоского банка, правка слоями и вырезка потоков.
//! Зашифрованные и многоканальные банки не разбираются — это дело хоста.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use crate::awc_build::apply_peaks;
use crate::drawable_write::float_value;
use crate::error::{Error, Result};
use crate::hash::sha256_hex;

/// Строит `pub struct` с тем же списком производных и полей, что обычное
/// объявление — только форма записи другая.
macro_rules! data_struct {
    (
        $(#[$meta:meta])*
        $vis:vis struct $name:ident $(<$lt:lifetime>)? {
            $($fvis:vis $field:ident : $ty:ty),* $(,)?
        }
    ) => {
        $(#[$meta])*
        $vis struct $name $(<$lt>)? {
            $($fvis $field: $ty,)*
        }
    };
}

// ---------------------------------------------------------------------------
// Числа формата. Соседний `awc_build` берёт их под старыми именами.
// ---------------------------------------------------------------------------

/// Типы чанков, которые умеет собирать эта сторона.
mod tag {
    pub const DATA: u8 = 0x55;
    pub const FORMAT: u8 = 0xfa;
    pub const PEAK: u8 = 0x36;
    /// Данные «MIDI» потока без звука (банки `RESIDENT/low_latency`): формата у такого потока нет.
    pub const MID: u8 = 0x68;
}

/// Кодеки потока.
mod codec {
    pub const PCM: u8 = 0;
    pub const ADPCM: u8 = 4;
}

/// Биты флагов банка.
mod flag {
    pub const INDEX_TABLE: u16 = 1;
    pub const STREAM_SEALED: u16 = 2;
    pub const MULTI_CHANNEL: u16 = 4;
    pub const MULTI_SEALED: u16 = 8;
}

pub(crate) use codec::{ADPCM as CODEC_ADPCM, PCM as CODEC_PCM};
pub(crate) use ima::{decode_adpcm_as_host, INDEX as IMA_INDEX, STEP as IMA_STEP};
pub(crate) use tag::{DATA as CHUNK_DATA, FORMAT as CHUNK_FORMAT, PEAK as CHUNK_PEAK};

/// Размер чанка формата со словом пика.
pub(crate) const FORMAT_WITH_PEAK: usize = 24;

const ID_MASK: u32 = 0x1FFF_FFFF;
/// Число чанков потока живёт в трёх старших битах слова потока.
const CHUNK_COUNT_SHIFT: u32 = 29;
const HEADER_LEN: usize = 16;
const MAX_STREAMS: usize = 4096;
const MAX_BUILD_CHUNKS: usize = 16;
/// Число чанков потока занимает три бита слова потока: больше семи не записать.
const MAX_STREAM_CHUNKS: usize = 7;
const MAX_ADPCM_SAMPLES: u32 = 1 << 28;
const PEAK_BUCKETS: usize = 240;
const MAX_PICKED_BANK: usize = 0x0FFF_FFFF;

const SHORT_READ: &str = "Чтение за концом банка AWC.";
const HOST_ONLY_BANK: &str = "зашифрованный или многоканальный банк — пока на хосте.";

/// Первый сработавший отказ из таблицы правил «условие → текст»; порядок правил — порядок проверок.
fn refuse_first<const N: usize>(rules: [Option<String>; N]) -> Result<()> {
    match rules.into_iter().flatten().next() {
        Some(text) => Err(Error::broken(text)),
        None => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Имена
// ---------------------------------------------------------------------------

/// Строка таблицы известных типов чанков: имя, группа при раскладке нагрузок,
/// выравнивание начала.
struct KindRow {
    kind: u8,
    name: &'static str,
    group: u8,
    align: usize,
}

/// Тип чанка → имя, группа, выравнивание.
const KNOWN_KINDS: [KindRow; 11] = [
    KindRow { kind: 0x55, name: "data", group: 3, align: 16 },
    KindRow { kind: 0x68, name: "mid", group: 3, align: 16 },
    KindRow { kind: 0xBD, name: "markers", group: 2, align: 4 },
    KindRow { kind: 0x5A, name: "granulargrains", group: 2, align: 4 },
    KindRow { kind: 0xD9, name: "granularloops", group: 2, align: 4 },
    KindRow { kind: 0x5C, name: "animation", group: 2, align: 1 },
    KindRow { kind: 0x2B, name: "gesture", group: 2, align: 1 },
    KindRow { kind: 0xA3, name: "seektable", group: 1, align: 1 },
    KindRow { kind: 0xFA, name: "format", group: 0, align: 1 },
    KindRow { kind: 0x36, name: "peak", group: 0, align: 1 },
    KindRow { kind: 0x48, name: "streamformat", group: 0, align: 1 },
];

fn kind_row(kind: u8) -> Option<&'static KindRow> {
    KNOWN_KINDS.iter().find(|row| row.kind == kind)
}

/// Поле строки `KNOWN_KINDS` по типу чанка, запасное значение — для неизвестного.
fn kind_field<T: Copy>(kind: u8, default: T, pick: fn(&KindRow) -> T) -> T {
    kind_row(kind).map_or(default, pick)
}

fn group_of(kind: u8) -> u8 {
    kind_field(kind, 0, |row| row.group)
}

fn align_of(kind: u8) -> usize {
    kind_field(kind, 1, |row| row.align)
}

pub fn chunk_name(kind: u8) -> String {
    match kind_row(kind) {
        Some(row) => row.name.to_owned(),
        None => kind.to_string(),
    }
}

pub fn stream_name(id: u32) -> String {
    format!("0X{id:08X}")
}

pub fn parse_stream_id(text: &str) -> Option<u32> {
    let (prefix, digits) = text.trim().split_at_checked(2)?;
    if digits.is_empty() || !prefix.eq_ignore_ascii_case("0x") {
        return None;
    }
    let mut wide = 0u64;
    for ch in digits.chars() {
        wide = wide.checked_mul(16)?.checked_add(u64::from(ch.to_digit(16)?))?;
    }
    Some(wide as u32 & ID_MASK)
}

// ---------------------------------------------------------------------------
// Оглавление: чанки, формат, потоки, банк
// ---------------------------------------------------------------------------

/// Поля фиксированной ширины внутри уже проверенного куска байт.
struct Fields<'a>(&'a [u8]);

impl Fields<'_> {
    fn array<const N: usize>(&self, at: usize) -> [u8; N] {
        self.0[at..at + N].try_into().expect("поле лежит внутри куска")
    }

    fn u16(&self, at: usize) -> u16 {
        u16::from_le_bytes(self.array(at))
    }

    fn u32(&self, at: usize) -> u32 {
        u32::from_le_bytes(self.array(at))
    }

    fn i32(&self, at: usize) -> i32 {
        i32::from_le_bytes(self.array(at))
    }
}

data_struct! {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Chunk {
        pub kind: u8,
        pub size: usize,
        pub offset: usize,
    }
}

impl Chunk {
    /// Размер и смещение занимают по 28 бит.
    const FIELD: u64 = (1 << 28) - 1;

    /// Слово таблицы: смещение — биты 0–27, размер — 28–55, тип — 56–63.
    fn unpack(word: u64) -> Self {
        Chunk {
            kind: (word >> 56) as u8,
            size: ((word >> 28) & Self::FIELD) as usize,
            offset: (word & Self::FIELD) as usize,
        }
    }

    fn pack(kind: u8, size: usize, offset: usize) -> u64 {
        (u64::from(kind) << 56) | ((size as u64 & Self::FIELD) << 28) | (offset as u64 & Self::FIELD)
    }

    fn end(&self) -> usize {
        self.offset + self.size
    }

    fn bytes<'a>(&self, file: &'a [u8]) -> &'a [u8] {
        &file[self.offset..self.end()]
    }

    fn to_json(&self) -> Value {
        json!({"type": self.kind, "size": self.size, "offset": self.offset})
    }
}

/// Читатель таблицы чанков: идёт по строкам подряд, каждая проверяется на выход за файл.
struct ChunkRows<'a> {
    file: &'a [u8],
    next: usize,
}

impl ChunkRows<'_> {
    fn row(&mut self, owner: u32) -> Result<Chunk> {
        let raw = self
            .file
            .get(self.next..self.next + 8)
            .ok_or_else(|| Error::broken("Оглавление чанков обрывается."))?;
        self.next += 8;
        let chunk = Chunk::unpack(u64::from_le_bytes(raw.try_into().expect("восемь байт")));
        if chunk.end() > self.file.len() {
            return Err(Error::broken(format!(
                "Чанк потока {} выходит за конец файла.",
                stream_name(owner)
            )));
        }
        Ok(chunk)
    }

    /// Поток по его слову: идентификатор и столько строк, сколько в нём чанков.
    fn stream(&mut self, word: u32) -> Result<Stream> {
        let id = word & ID_MASK;
        let mut chunks = Vec::new();
        for _ in 0..word >> CHUNK_COUNT_SHIFT {
            chunks.push(self.row(id)?);
        }
        Ok(Stream { id, chunks, format: None })
    }
}

data_struct! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Format {
        pub samples: u32,
        pub loop_point: i32,
        pub sample_rate: u16,
        pub headroom: i16,
        pub loop_begin: u16,
        pub loop_end: u16,
        pub play_end: u16,
        pub play_begin: u8,
        pub codec: u8,
        pub peak: Option<u32>,
    }
}

impl Format {
    /// Поля читаются по фиксированным местам, как бы мал ни был чанк.
    fn read(file: &[u8], chunk: &Chunk) -> Result<Format> {
        let window = |from: usize, len: usize| {
            file.get(chunk.offset + from..chunk.offset + from + len)
                .ok_or_else(|| Error::broken(SHORT_READ))
        };
        let at = Fields(window(0, 20)?);
        let peak = match chunk.size {
            FORMAT_WITH_PEAK => Some(Fields(window(20, 4)?).u32(0)),
            _ => None,
        };
        Ok(Format {
            samples: at.u32(0),
            loop_point: at.i32(4),
            sample_rate: at.u16(8),
            headroom: at.u16(10) as i16,
            loop_begin: at.u16(12),
            loop_end: at.u16(14),
            play_end: at.u16(16),
            play_begin: at.array::<1>(18)[0],
            codec: at.array::<1>(19)[0],
            peak,
        })
    }

    fn to_json(self) -> Value {
        json!({
            "samples": self.samples,
            "loopPoint": self.loop_point,
            "sampleRate": self.sample_rate,
            "headroom": self.headroom,
            "codec": self.codec,
            "loopBegin": self.loop_begin,
            "loopEnd": self.loop_end,
            "playBegin": self.play_begin,
            "playEnd": self.play_end,
            "peak": self.peak.is_some(),
        })
    }
}

/// Кодек потока: известный или номер, который эта сторона не понимает.
#[derive(Clone, Copy)]
enum Codec {
    Pcm,
    Adpcm,
    Other(u8),
}

impl Codec {
    fn of(byte: u8) -> Self {
        match byte {
            codec::PCM => Codec::Pcm,
            codec::ADPCM => Codec::Adpcm,
            other => Codec::Other(other),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Codec::Pcm => "PCM",
            Codec::Adpcm => "ADPCM",
            Codec::Other(_) => "Unknown",
        }
    }
}

data_struct! {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Stream {
        pub id: u32,
        pub chunks: Vec<Chunk>,
        pub format: Option<Format>,
    }
}

impl Stream {
    fn chunk_of(&self, kind: u8) -> Option<&Chunk> {
        self.chunks.iter().find(|c| c.kind == kind)
    }

    pub fn pcm_length(&self) -> Option<usize> {
        let (format, data) = self.format.zip(self.chunk_of(tag::DATA))?;
        match Codec::of(format.codec) {
            Codec::Adpcm => Some(format.samples as usize),
            Codec::Pcm => Some((format.samples as usize).min(data.size / 2)),
            Codec::Other(_) => None,
        }
    }

    /// Сколько байт занимают чанки кроме данных.
    fn meta_bytes(&self) -> usize {
        self.chunks.iter().filter(|c| c.kind != tag::DATA).map(|c| c.size).sum()
    }

    fn has_peak_format(&self) -> bool {
        self.format.is_some_and(|f| f.peak.is_some())
    }

    /// Поток с теми же нагрузками, готовый к повторной сборке.
    fn restage(&self, file: &[u8]) -> NewStream {
        let chunks = self.chunks.iter().map(|c| (c.kind, c.bytes(file).to_vec())).collect();
        NewStream { id: self.id, chunks }
    }

    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "chunks": self.chunks.iter().map(Chunk::to_json).collect::<Vec<_>>(),
            "format": self.format.map_or(Value::Null, Format::to_json),
            "pcmLength": self.pcm_length(),
        })
    }
}

data_struct! {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Bank {
        pub encrypted: bool,
        pub version: u16,
        pub flags: u16,
        pub multi_channel: bool,
        pub header_bytes: usize,
        pub streams: Vec<Stream>,
    }
}

/// Начало файла говорит, чей это банк.
enum Magic {
    Little,
    Console,
    Foreign,
}

impl Magic {
    fn sniff(file: &[u8]) -> Self {
        let head = &file[..4];
        if head == b"ADAT" {
            Magic::Little
        } else if head == b"TADA" {
            Magic::Console
        } else {
            Magic::Foreign
        }
    }
}

impl Bank {
    /// Банк с чужим началом считается зашифрованным: содержимого у него нет.
    fn sealed() -> Self {
        Bank {
            encrypted: true,
            version: 0,
            flags: 0,
            multi_channel: false,
            header_bytes: 0,
            streams: Vec::new(),
        }
    }

    /// Банк, который эта сторона не трогает: зашифрованный, многоканальный или с шифрованными данными.
    fn host_only(&self) -> bool {
        self.encrypted
            || self.multi_channel
            || self.flags & (flag::STREAM_SEALED | flag::MULTI_SEALED) != 0
    }

    fn find(&self, id: u32) -> Option<&Stream> {
        self.streams.iter().find(|s| s.id == id)
    }

    fn has(&self, id: u32) -> bool {
        self.find(id).is_some()
    }

    fn parse(file: &[u8]) -> Result<Bank> {
        let head = Fields(&file[..HEADER_LEN]);
        let (version, flags, count) = (head.u16(4), head.u16(6), head.i32(8));
        let streams_n = usize::try_from(count)
            .ok()
            .filter(|n| *n <= MAX_STREAMS)
            .ok_or_else(|| Error::broken(format!("Невозможное число потоков: {count}.")))?;
        let words_at = HEADER_LEN + if flags & flag::INDEX_TABLE != 0 { 2 * streams_n } else { 0 };
        let rows_at = words_at + 4 * streams_n;
        let words: Vec<u32> = file
            .get(words_at..rows_at)
            .ok_or_else(|| Error::broken(SHORT_READ))?
            .chunks_exact(4)
            .map(|w| Fields(w).u32(0))
            .collect();

        let mut rows = ChunkRows { file, next: rows_at };
        let mut streams = Vec::with_capacity(words.len());
        for word in words {
            streams.push(rows.stream(word)?);
        }
        for stream in &mut streams {
            let format = stream.chunk_of(tag::FORMAT).map(|c| Format::read(file, c)).transpose()?;
            stream.format = format;
        }
        Ok(Bank {
            encrypted: false,
            version,
            flags,
            multi_channel: flags & flag::MULTI_CHANNEL != 0,
            header_bytes: rows.next,
            streams,
        })
    }
}

pub fn read_bank(bytes: &[u8]) -> Result<Bank> {
    if bytes.len() < HEADER_LEN {
        return Err(Error::broken("Файл короче заголовка AWC."));
    }
    match Magic::sniff(bytes) {
        Magic::Console => Err(Error::broken("Банк консольной версии игры (big-endian).")),
        Magic::Foreign => Ok(Bank::sealed()),
        Magic::Little => Bank::parse(bytes),
    }
}

pub fn bank_json(bank: &Bank) -> Value {
    let streams: Vec<Value> = bank.streams.iter().map(Stream::to_json).collect();
    let (encrypted, version, flags, multi_channel) =
        (bank.encrypted, bank.version, bank.flags, bank.multi_channel);
    json!({
        "encrypted": encrypted,
        "version": version,
        "flags": flags,
        "multiChannel": multi_channel,
        "streams": streams,
    })
}

/// Итоги по всем чанкам банка: размер служебных чанков и самый дальний конец.
struct Totals {
    metadata: usize,
    reach: usize,
}

impl Totals {
    fn of(bank: &Bank) -> Self {
        bank.streams.iter().flat_map(|s| &s.chunks).fold(Totals { metadata: 0, reach: 0 }, |acc, c| {
            Totals {
                metadata: acc.metadata + if c.kind != tag::DATA { c.size } else { 0 },
                reach: acc.reach.max(c.end()),
            }
        })
    }
}

pub fn budget(bytes: &[u8]) -> Result<(usize, usize, usize)> {
    let bank = read_bank(bytes)?;
    let Totals { metadata, reach } = Totals::of(&bank);
    Ok((bank.header_bytes, metadata, reach))
}

// ---------------------------------------------------------------------------
// IMA ADPCM
// ---------------------------------------------------------------------------

mod ima {
    pub(crate) const INDEX: [i32; 16] = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
    pub(crate) const STEP: [i32; 89] = [
        7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60,
        66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371,
        408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
        2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845,
        8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
        29794, 32767,
    ];

    /// Блок потока: четыре байта заголовка и 2044 байта данных.
    const BLOCK_LEN: usize = 2048;
    const HEAD_LEN: usize = 4;
    const TOP_INDEX: i32 = 88;

    fn pin16(value: i32) -> i16 {
        value.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16
    }

    /// Полубайты в порядке чтения: сначала младший.
    fn halves(byte: u8) -> [u8; 2] {
        [byte & 0x0F, byte >> 4]
    }

    /// Состояние декодера внутри блока.
    struct Walker {
        index: i32,
        level: i32,
    }

    impl Walker {
        fn open(head: &[u8]) -> Self {
            Walker {
                index: i32::from(head[0]).min(TOP_INDEX),
                level: i32::from(i16::from_le_bytes([head[2], head[3]])),
            }
        }

        /// Применяет полубайт; предсказание копится без ограничения.
        fn feed(&mut self, nibble: u8) -> i32 {
            let step = STEP[self.index as usize];
            let size = ((i32::from(nibble & 7) * 2 + 1) * step) >> 3;
            let signed = if nibble & 8 == 0 { size } else { -size };
            self.level = self.level.wrapping_add(signed);
            self.index = (self.index + INDEX[usize::from(nibble)]).clamp(0, TOP_INDEX);
            self.level
        }

        /// То же, но предсказание держится в пределах i16 после каждого шага.
        fn feed_pinned(&mut self, nibble: u8) -> i16 {
            let pinned = pin16(self.feed(nibble));
            self.level = i32::from(pinned);
            pinned
        }
    }

    /// Декодер «как у хоста»: буфер в 4 байта на байт входа, предсказание без зажима.
    pub(crate) fn decode_adpcm_as_host(data: &[u8], sample_count: u32) -> Option<Vec<u8>> {
        let mut left = i64::from(sample_count);
        let mut out: Vec<u8> = Vec::with_capacity(data.len() * 4);
        for block in data.chunks(BLOCK_LEN) {
            if left <= 0 {
                break;
            }
            let (head, body) = block.split_at_checked(HEAD_LEN)?;
            let mut walker = Walker::open(head);
            // Каждый байт даёт два сэмпла; счёт идёт, пока он положителен.
            let used = body.len().min(((left + 1) / 2) as usize);
            for &byte in &body[..used] {
                for nibble in halves(byte) {
                    out.extend_from_slice(&pin16(walker.feed(nibble)).to_le_bytes());
                }
            }
            left -= 2 * used as i64;
        }
        out.resize(data.len() * 4, 0);
        Some(out)
    }

    /// Декодер звука потока: ровно `want` сэмплов, оборванный блок молча кончает разбор.
    pub(super) fn decode_samples(data: &[u8], want: usize) -> Vec<i16> {
        let mut pcm: Vec<i16> = Vec::new();
        for block in data.chunks(BLOCK_LEN) {
            if pcm.len() >= want {
                break;
            }
            let Some((head, body)) = block.split_at_checked(HEAD_LEN) else { break };
            let mut walker = Walker::open(head);
            let room = want - pcm.len();
            pcm.extend(
                body.iter()
                    .flat_map(|&byte| halves(byte))
                    .take(room)
                    .map(|nibble| walker.feed_pinned(nibble)),
            );
        }
        pcm.resize(want, 0);
        pcm
    }
}

// ---------------------------------------------------------------------------
// WAV и пики
// ---------------------------------------------------------------------------

/// Заголовок WAV в 44 байта; числа лежат одинаковыми байтами и для знаковых, и для беззнаковых полей.
fn riff_head(channels: u16, rate: u32, data_len: usize) -> Vec<u8> {
    let mut head = [0u8; 44];
    head[0..4].copy_from_slice(b"RIFF");
    head[4..8].copy_from_slice(&((36 + data_len) as u32).to_le_bytes());
    head[8..16].copy_from_slice(b"WAVEfmt ");
    head[16..20].copy_from_slice(&16u32.to_le_bytes());
    head[20..22].copy_from_slice(&1u16.to_le_bytes());
    head[22..24].copy_from_slice(&channels.to_le_bytes());
    head[24..28].copy_from_slice(&rate.to_le_bytes());
    head[28..32].copy_from_slice(&rate.wrapping_mul(u32::from(channels) * 2).to_le_bytes());
    head[32..34].copy_from_slice(&(channels * 2).to_le_bytes());
    head[34..36].copy_from_slice(&16u16.to_le_bytes());
    head[36..40].copy_from_slice(b"data");
    head[40..44].copy_from_slice(&(data_len as u32).to_le_bytes());
    head.to_vec()
}

pub fn wav(sample_rate: u16, pcm: &[i16]) -> Vec<u8> {
    let head = riff_head(1, u32::from(sample_rate), pcm.len() * 2);
    head.into_iter().chain(pcm.iter().flat_map(|s| s.to_le_bytes())).collect()
}

pub fn stereo_wav(left: &StreamAudio, right: &StreamAudio) -> Vec<u8> {
    let frames = left.pcm.len().min(right.pcm.len());
    let head = riff_head(2, u32::from(left.sample_rate), frames * 4);
    let mut body = Vec::with_capacity(frames * 4);
    for (l, r) in left.pcm.iter().zip(&right.pcm) {
        body.extend_from_slice(&l.to_le_bytes());
        body.extend_from_slice(&r.to_le_bytes());
    }
    head.into_iter().chain(body).collect()
}

pub fn peaks(pcm: &[i16]) -> Vec<f32> {
    if pcm.is_empty() {
        return vec![0.0; PEAK_BUCKETS];
    }
    let width = pcm.len() as f64 / PEAK_BUCKETS as f64;
    let edge = |n: usize| (n as f64 * width).floor() as usize;
    let mut out = Vec::with_capacity(PEAK_BUCKETS);
    for b in 0..PEAK_BUCKETS {
        let from = edge(b);
        let to = edge(b + 1).max(from + 1).min(pcm.len());
        let loudest = pcm[from..to].iter().map(|s| i32::from(*s).abs()).max().unwrap_or(0);
        out.push((f64::from(loudest) / 32768.0) as f32);
    }
    out
}

/// То, что описание берёт из формата потока; у потока без формата — пустой PCM.
struct Facts {
    present: bool,
    /// Поток без формата, у которого есть чанк `mid`: хост описывает его как «MIDI», без длины (сверка 16.11.2026).
    midi: bool,
    fmt: Format,
}

const BLANK_FORMAT: Format = Format {
    samples: 0,
    loop_point: 0,
    sample_rate: 0,
    headroom: 0,
    loop_begin: 0,
    loop_end: 0,
    play_end: 0,
    play_begin: 0,
    codec: codec::PCM,
    peak: None,
};

impl Facts {
    fn of(stream: &Stream) -> Self {
        Facts {
            present: stream.format.is_some(),
            midi: stream.format.is_none() && stream.chunk_of(tag::MID).is_some(),
            fmt: stream.format.unwrap_or(BLANK_FORMAT),
        }
    }

    fn type_text(&self) -> String {
        if self.midi {
            return "MIDI".to_owned();
        }
        let label = Codec::of(self.fmt.codec).label();
        match self.fmt.sample_rate {
            0 => label.to_owned(),
            rate => format!("{label}, {rate} Hz"),
        }
    }

    fn codec_json(&self) -> Value {
        if !self.present {
            return Value::Null;
        }
        match Codec::of(self.fmt.codec) {
            Codec::Other(number) => json!(number.to_string()),
            known => json!(known.label()),
        }
    }

    fn seconds(&self) -> Value {
        if self.midi {
            return json!(0);
        }
        if !self.present || self.fmt.sample_rate == 0 {
            return Value::Null;
        }
        float_value(self.fmt.samples as f32 / f32::from(self.fmt.sample_rate))
    }

    /// Поле формата либо `null`, когда формата нет.
    fn shown<T>(&self, field: T) -> Option<T> {
        self.present.then_some(field)
    }
}

/// Образ WAV, по которому банки сравниваются: моно, частота формата, данные потока как есть
/// (для ADPCM — раскодированные «как у хоста»). `None` — образа нет.
fn canonical_wav(file: &[u8], stream: &Stream) -> Option<Vec<u8>> {
    let facts = Facts::of(stream);
    let raw = stream.chunk_of(tag::DATA)?.bytes(file);
    let body = match Codec::of(facts.fmt.codec) {
        Codec::Adpcm => decode_adpcm_as_host(raw, facts.fmt.samples)?,
        _ => raw.to_vec(),
    };
    Some([riff_head(1, u32::from(facts.fmt.sample_rate), body.len()), body].concat())
}

fn canonical_digest(file: &[u8], stream: &Stream) -> Option<String> {
    canonical_wav(file, stream).map(|image| sha256_hex(&image))
}

fn describe_stream(file: &[u8], stream: &Stream) -> Value {
    let facts = Facts::of(stream);
    let fmt = facts.fmt;
    let hex_name = format!("0x{:08X}", stream.id);
    json!({
        "name": hex_name,
        "hash": hex_name,
        "type": facts.type_text(),
        "codec": facts.codec_json(),
        "sampleRate": fmt.sample_rate,
        "samples": fmt.samples,
        "seconds": facts.seconds(),
        "bytes": stream
            .chunk_of(tag::DATA)
            .or_else(|| stream.chunk_of(tag::MID).filter(|_| facts.midi))
            .map_or(0, |c| c.size),
        "peak": fmt.peak.is_some(),
        "loopBegin": facts.shown(fmt.loop_begin),
        "loopEnd": facts.shown(fmt.loop_end),
        "playBegin": facts.shown(fmt.play_begin),
        "playEnd": facts.shown(fmt.play_end),
        "payloadSha256": canonical_digest(file, stream),
        "chunks": stream.chunks.iter().map(|c| chunk_name(c.kind)).collect::<Vec<_>>(),
        "metadataBytes": stream.meta_bytes(),
    })
}

pub fn describe(name: &str, bytes: &[u8]) -> Result<Value> {
    let bank = read_bank(bytes)?;
    refuse_first([bank.host_only().then(|| format!("AWC {name}: {HOST_ONLY_BANK}"))])?;
    let Totals { metadata, reach } = Totals::of(&bank);
    let raised = |mask: u16| bank.flags & mask != 0;
    Ok(json!({
        "name": name,
        "version": bank.version,
        "flags": bank.flags,
        "wholeFileEncrypted": false,
        "multiChannelFlag": raised(flag::MULTI_CHANNEL),
        "singleChannelEncryptFlag": raised(flag::STREAM_SEALED),
        "multiChannelEncryptFlag": raised(flag::MULTI_SEALED),
        "streamCount": bank.streams.len(),
        "headerBytes": bank.header_bytes,
        "metadataBytes": metadata,
        "contentBytes": reach,
        "streams": bank.streams.iter().map(|s| describe_stream(bytes, s)).collect::<Vec<_>>(),
    }))
}

// ---------------------------------------------------------------------------
// Звук потока и вырезка потоков
// ---------------------------------------------------------------------------

/// Банк, из которого можно брать звук и потоки: штатный, не зашифрованный, не многоканальный.
fn open_plain(bytes: &[u8]) -> Result<Bank> {
    let bank = read_bank(bytes)?;
    refuse_first([
        bank.encrypted.then(|| "Банк зашифрован — это штатный банк игры.".to_owned()),
        (bank.flags & (flag::STREAM_SEALED | flag::MULTI_SEALED) != 0)
            .then(|| "Данные потоков банка зашифрованы.".to_owned()),
        bank.multi_channel
            .then(|| "Многоканальный банк (музыка, радио) — не звук ствола.".to_owned()),
    ])?;
    Ok(bank)
}

data_struct! {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct StreamAudio {
        pub sample_rate: u16,
        pub pcm: Vec<i16>,
    }
}

pub fn stream_audio(bytes: &[u8], id: u32) -> Result<StreamAudio> {
    let bank = open_plain(bytes)?;
    let id = id & ID_MASK;
    let stream = bank
        .find(id)
        .ok_or_else(|| Error::broken(format!("В банке нет потока {}.", stream_name(id))))?;
    let (format, data) = stream
        .format
        .zip(stream.chunk_of(tag::DATA))
        .ok_or_else(|| Error::broken("У потока нет звука (только метки)."))?;
    let raw = data.bytes(bytes);
    let pcm = match Codec::of(format.codec) {
        Codec::Adpcm if format.samples > MAX_ADPCM_SAMPLES => {
            return Err(Error::broken("Звук потока длиннее допустимого."))
        }
        Codec::Adpcm => ima::decode_samples(raw, format.samples as usize),
        Codec::Pcm => raw
            .chunks_exact(2)
            .take(format.samples as usize)
            .map(|pair| Fields(pair).u16(0) as i16)
            .collect(),
        Codec::Other(number) => {
            return Err(Error::broken(format!("Неизвестный кодек потока: {number}.")))
        }
    };
    Ok(StreamAudio { sample_rate: format.sample_rate, pcm })
}

// ---------------------------------------------------------------------------
// Сборка банка
// ---------------------------------------------------------------------------

data_struct! {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct NewStream {
        pub id: u32,
        pub chunks: Vec<(u8, Vec<u8>)>,
    }
}

/// Поток при сборке: чанки как пары «тип, нагрузка».
struct Part<'a> {
    id: u32,
    chunks: Vec<(u8, &'a [u8])>,
}

/// Чанк в сборке: номер потока и номер чанка в нём.
type Slot = (usize, usize);

/// Куда легли нагрузки: смещения по потокам и чанкам и длина файла.
struct Placement {
    at: Vec<Vec<usize>>,
    end: usize,
}

/// Банк в сборке: флаги и потоки; порядок нагрузок в файле выбирает вызывающий.
struct Sheet<'a> {
    flags: u16,
    parts: Vec<Part<'a>>,
}

impl<'a> Sheet<'a> {
    /// Все чанки в порядке общей таблицы.
    fn slots(&self) -> Vec<Slot> {
        let per_stream = self.parts.iter().enumerate();
        per_stream.flat_map(|(s, p)| (0..p.chunks.len()).map(move |c| (s, c))).collect()
    }

    fn kind_at(&self, (s, c): Slot) -> u8 {
        self.parts[s].chunks[c].0
    }

    fn body_at(&self, (s, c): Slot) -> &'a [u8] {
        self.parts[s].chunks[c].1
    }

    fn header_end(&self) -> usize {
        let streams = self.parts.len();
        let rows: usize = self.parts.iter().map(|p| p.chunks.len()).sum();
        let indices = if self.flags & flag::INDEX_TABLE != 0 { 2 * streams } else { 0 };
        HEADER_LEN + indices + 4 * streams + 8 * rows
    }

    /// Нагрузки встают подряд в заданном порядке, каждая на ближайшее допустимое место.
    fn place(&self, order: &[Slot]) -> Placement {
        let mut at: Vec<Vec<usize>> = self.parts.iter().map(|p| vec![0; p.chunks.len()]).collect();
        let end = order.iter().fold(self.header_end(), |cursor, &slot| {
            let start = cursor.next_multiple_of(align_of(self.kind_at(slot)));
            at[slot.0][slot.1] = start;
            start + self.body_at(slot).len()
        });
        Placement { at, end }
    }

    /// Размер и смещение каждого чанка умещаются в свои 28 бит строки таблицы.
    fn fits(&self, placement: &Placement) -> bool {
        self.slots().into_iter().all(|slot| {
            self.body_at(slot).len() as u64 <= Chunk::FIELD && placement.at[slot.0][slot.1] as u64 <= Chunk::FIELD
        })
    }

    fn render(&self, version: u16, placement: &Placement) -> Vec<u8> {
        let mut file = Vec::new();
        file.extend_from_slice(b"ADAT");
        file.extend_from_slice(&version.to_le_bytes());
        file.extend_from_slice(&self.flags.to_le_bytes());
        file.extend_from_slice(&(self.parts.len() as i32).to_le_bytes());
        file.extend_from_slice(&(self.header_end() as i32).to_le_bytes());

        if self.flags & flag::INDEX_TABLE != 0 {
            let mut seen = 0usize;
            for part in &self.parts {
                file.extend_from_slice(&(seen as u16).to_le_bytes());
                seen += part.chunks.len();
            }
        }

        // Число чанков занимает три старших бита: больше семи молча теряется.
        for part in &self.parts {
            let word = (part.id & ID_MASK) | ((part.chunks.len() as u32) << CHUNK_COUNT_SHIFT);
            file.extend_from_slice(&word.to_le_bytes());
        }

        for (part, offsets) in self.parts.iter().zip(&placement.at) {
            for (&(kind, body), &offset) in part.chunks.iter().zip(offsets) {
                file.extend_from_slice(&Chunk::pack(kind, body.len(), offset).to_le_bytes());
            }
        }

        file.resize(placement.end, 0);
        for slot in self.slots() {
            let start = placement.at[slot.0][slot.1];
            let body = self.body_at(slot);
            file[start..start + body.len()].copy_from_slice(body);
        }
        file
    }
}

pub fn encode(version: u16, flags: u16, streams: &[NewStream]) -> Result<Vec<u8>> {
    let kinds = || streams.iter().flat_map(|s| &s.chunks).map(|(kind, _)| *kind);
    let outsider = kinds().find(|kind| ![tag::DATA, tag::FORMAT, tag::PEAK].contains(kind));
    let crowded = streams.iter().find(|s| s.chunks.len() > MAX_STREAM_CHUNKS);
    refuse_first([
        outsider.map(|kind| format!("AWC: сборка чанка {} пока на хосте.", chunk_name(kind))),
        (kinds().count() > MAX_BUILD_CHUNKS)
            .then(|| "AWC: сборка банка больше 16 чанков пока на хосте.".to_owned()),
        crowded.map(|s| {
            format!("AWC: в потоке {} больше {MAX_STREAM_CHUNKS} чанков, число чанков не умещается в слово потока.", stream_name(s.id))
        }),
    ])?;
    let parts = streams
        .iter()
        .map(|s| Part {
            id: s.id,
            chunks: s.chunks.iter().map(|(kind, body)| (*kind, body.as_slice())).collect(),
        })
        .collect();
    let sheet = Sheet { flags, parts };
    // Группы по порядку типов; внутри группы чанки идут с конца общей таблицы.
    let mut order = sheet.slots();
    order.sort_by_key(|&slot| (group_of(sheet.kind_at(slot)), Reverse(slot)));
    let placement = sheet.place(&order);
    refuse_first([(!sheet.fits(&placement))
        .then(|| "AWC: размер или смещение чанка не умещается в 28 бит, банк больше 256 МБ.".to_owned())])?;
    Ok(sheet.render(version, &placement))
}

pub fn reencode(bytes: &[u8]) -> Result<Vec<u8>> {
    let bank = read_bank(bytes)?;
    refuse_first([
        bank.host_only().then(|| format!("AWC: {HOST_ONLY_BANK}")),
        bank.streams
            .iter()
            .any(Stream::has_peak_format)
            .then(|| "AWC: формат с пиком — пик пересчитывает хост, пока на хосте.".to_owned()),
    ])?;
    let streams: Vec<NewStream> = bank.streams.iter().map(|s| s.restage(bytes)).collect();
    encode(bank.version, bank.flags, &streams)
}

pub fn pick_streams(bytes: &[u8], ids: &[u32]) -> Result<Vec<u8>> {
    let bank = open_plain(bytes)?;
    let wanted: BTreeSet<u32> = ids.iter().map(|id| id & ID_MASK).collect();
    if let Some(missing) = wanted.iter().find(|id| !bank.has(**id)) {
        return Err(Error::broken(format!("В банке нет потоков {}.", stream_name(*missing))));
    }
    let parts = bank
        .streams
        .iter()
        .filter(|s| wanted.contains(&s.id))
        .map(|s| Part { id: s.id, chunks: s.chunks.iter().map(|c| (c.kind, c.bytes(bytes))).collect() })
        .collect();
    let sheet = Sheet { flags: bank.flags, parts };
    // Группы по порядку типов, внутри — по номеру потока и чанка.
    let mut order = sheet.slots();
    order.sort_by_key(|&slot| (group_of(sheet.kind_at(slot)), slot));
    let placement = sheet.place(&order);
    refuse_first([(placement.end > MAX_PICKED_BANK)
        .then(|| "Банк из выбранных потоков больше 256 МБ.".to_owned())])?;
    Ok(sheet.render(bank.version, &placement))
}

// ---------------------------------------------------------------------------
// Правка слоями
// ---------------------------------------------------------------------------

data_struct! {
    pub struct PatchLayer<'a> {
        pub source: &'a [u8],
        pub streams: Vec<u32>,
        pub drop: Vec<u32>,
    }
}

data_struct! {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct PatchResult {
        pub bytes: Vec<u8>,
        pub replaced: Vec<u32>,
        pub dropped: Vec<u32>,
    }
}

/// Подмена потока: чанки из источника и образ WAV, с которым потом сверится итог.
struct Swap {
    chunks: Vec<(u8, Vec<u8>)>,
    digest: Option<String>,
}

fn claimed_text(id: u32) -> String {
    format!("AWC stream 0x{id:08X} is claimed by multiple active layers.")
}

/// Что слои требуют от основы: убрать одни потоки и заменить другие.
#[derive(Default)]
struct Claims {
    dropped: BTreeSet<u32>,
    swaps: BTreeMap<u32, Swap>,
}

impl Claims {
    fn collect(base: &Bank, layers: &[PatchLayer]) -> Result<Claims> {
        let mut claims = Claims::default();
        for &id in layers.iter().flat_map(|l| &l.drop) {
            refuse_first([
                (!base.has(id))
                    .then(|| format!("AWC base does not contain stream 0x{id:08X} to drop.")),
                claims.dropped.contains(&id).then(|| claimed_text(id)),
            ])?;
            claims.dropped.insert(id);
        }
        for layer in layers {
            claims.take_swaps(base, layer)?;
        }
        Ok(claims)
    }

    fn take_swaps(&mut self, base: &Bank, layer: &PatchLayer) -> Result<()> {
        refuse_first([layer.streams.is_empty().then(|| "AWC patch has no declared streams.".to_owned())])?;
        let source = read_bank(layer.source)?;
        refuse_first([
            source.host_only().then(|| format!("AWC (источник): {HOST_ONLY_BANK}")),
            (source.version != base.version)
                .then(|| "AWC: источник другой версии, чем основа.".to_owned()),
        ])?;
        for &id in &layer.streams {
            refuse_first([(self.swaps.contains_key(&id) || self.dropped.contains(&id))
                .then(|| claimed_text(id))])?;
            let found = source.find(id).ok_or_else(|| {
                Error::broken(format!("AWC source does not contain stream 0x{id:08X}."))
            })?;
            refuse_first([(!base.has(id))
                .then(|| format!("AWC base does not contain stream 0x{id:08X}."))])?;
            self.swaps.insert(
                id,
                Swap {
                    chunks: found.restage(layer.source).chunks,
                    digest: canonical_digest(layer.source, found),
                },
            );
        }
        Ok(())
    }

    /// Потоки основы в её порядке без убранных и с подменами, рядом — образы, которые должны сохраниться.
    fn survivors(&self, base_bytes: &[u8], base: &Bank) -> (Vec<NewStream>, Vec<Option<String>>) {
        base.streams
            .iter()
            .filter(|s| !self.dropped.contains(&s.id))
            .map(|s| match self.swaps.get(&s.id) {
                Some(swap) => {
                    (NewStream { id: s.id, chunks: swap.chunks.clone() }, swap.digest.clone())
                }
                None => (s.restage(base_bytes), canonical_digest(base_bytes, s)),
            })
            .unzip()
    }
}

/// Перечитывает собранный банк и сверяет число потоков, идентификаторы и образы WAV.
fn confirm(bytes: &[u8], streams: &[NewStream], expected: &[Option<String>]) -> Result<()> {
    let rebuilt = read_bank(bytes)?;
    refuse_first([(rebuilt.streams.len() != streams.len())
        .then(|| "AWC stream patch changed the stream count.".to_owned())])?;
    let drifted = rebuilt
        .streams
        .iter()
        .zip(streams)
        .zip(expected)
        .find(|((now, want), digest)| now.id != want.id || canonical_digest(bytes, now) != **digest);
    match drifted {
        Some(((_, want), _)) => Err(Error::broken(format!(
            "AWC stream validation failed for 0x{:08X}.",
            want.id
        ))),
        None => Ok(()),
    }
}

pub fn patch(base: &[u8], layers: &[PatchLayer]) -> Result<PatchResult> {
    let base_bank = read_bank(base)?;
    refuse_first([base_bank.host_only().then(|| format!("AWC (основа): {HOST_ONLY_BANK}"))])?;
    let claims = Claims::collect(&base_bank, layers)?;
    let (mut streams, expected) = claims.survivors(base, &base_bank);
    streams.iter_mut().try_for_each(apply_peaks)?;
    let bytes = encode(base_bank.version, base_bank.flags, &streams)?;
    confirm(&bytes, &streams, &expected)?;
    Ok(PatchResult {
        bytes,
        replaced: claims.swaps.into_keys().collect(),
        dropped: claims.dropped.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Простой банк «в лоб»: у каждого потока формат (20 байт) и данные, формат сразу
    /// за таблицей, данные на ближайшем кратном 16.
    fn plain_bank(streams: &[(u32, Vec<u8>, Vec<u8>)]) -> Vec<u8> {
        let table_end = 16 + 4 * streams.len() + 16 * streams.len();
        let mut words = Vec::new();
        let mut table = Vec::new();
        let mut body: Vec<u8> = Vec::new();
        for (id, format, data) in streams {
            words.extend_from_slice(&((id & 0x1FFF_FFFF) | (2 << 29)).to_le_bytes());
            let format_at = table_end + body.len();
            body.extend_from_slice(format);
            let data_at = (table_end + body.len()).next_multiple_of(16);
            body.resize(data_at - table_end, 0);
            body.extend_from_slice(data);
            for (kind, size, at) in [(0xfau64, format.len(), format_at), (0x55, data.len(), data_at)] {
                let packed = kind << 56 | (size as u64) << 28 | at as u64;
                table.extend_from_slice(&packed.to_le_bytes());
            }
        }
        let mut out = b"ADAT".to_vec();
        out.extend_from_slice(&0xffu16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(streams.len() as i32).to_le_bytes());
        out.extend_from_slice(&(table_end as i32).to_le_bytes());
        out.extend(words);
        out.extend(table);
        out.extend(body);
        out
    }

    fn format20(samples: u32, rate: u16, codec: u8) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&samples.to_le_bytes());
        out.extend_from_slice(&(-1i32).to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&[0; 8]);
        out.push(0);
        out.push(codec);
        out
    }

    fn pcm_bytes(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    /// Банк из уже собранных байт; отказ читается тестом как провал, не как `Result`.
    fn load(bytes: &[u8]) -> Bank {
        read_bank(bytes).unwrap()
    }

    /// Сверяет id потока по индексу и отдаёт сам поток для дальнейших проверок.
    fn expect_stream(bank: &Bank, index: usize, id: u32) -> &Stream {
        let stream = &bank.streams[index];
        assert_eq!(stream.id, id);
        stream
    }

    /// Слово по смещению в собранном файле (WAV или подобном), младший байт первым.
    fn word_at(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    }

    #[test]
    fn pcm_stream_reads_its_format_and_samples() {
        let samples = [0, 1000, -2000, 32000];
        let bytes = plain_bank(&[(0x0339_2bec, format20(4, 44100, 0), pcm_bytes(&samples))]);
        let bank = load(&bytes);
        assert!(!bank.encrypted);
        let stream = expect_stream(&bank, 0, 0x0339_2bec);
        let format = stream.format.unwrap();
        assert_eq!((format.samples, format.sample_rate, format.codec), (4, 44100, 0));
        let audio = stream_audio(&bytes, 0x0339_2bec).unwrap();
        assert_eq!(audio.sample_rate, 44100);
        assert_eq!(audio.pcm, samples);
    }

    /// Банк из одного MIDI-потока: единственный чанк `mid`, формата и звука нет (так лежит `RESIDENT/low_latency`).
    fn midi_bank(id: u32, midi: &[u8]) -> Vec<u8> {
        let table_end: usize = 16 + 4 + 8;
        let at = table_end.next_multiple_of(16);
        let mut out = b"ADAT".to_vec();
        out.extend_from_slice(&0xffu16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&1i32.to_le_bytes());
        out.extend_from_slice(&(table_end as i32).to_le_bytes());
        out.extend_from_slice(&((id & 0x1FFF_FFFF) | (1 << 29)).to_le_bytes());
        let packed = u64::from(tag::MID) << 56 | (midi.len() as u64) << 28 | at as u64;
        out.extend_from_slice(&packed.to_le_bytes());
        out.resize(at, 0);
        out.extend_from_slice(midi);
        out
    }

    /// Хост описывает MIDI-поток как «MIDI», длиной 0 с и размером чанка `mid`; движок называл его «PCM» без размера
    /// (сверка 16.11.2026 на расшифрованной копии `RESIDENT/low_latency`: 14 потоков из 15).
    #[test]
    fn a_midi_only_stream_is_described_like_the_host_does() {
        let midi = [0x4d, 0x54, 0x68, 0x64, 1, 2, 3, 4];
        let described = describe("midi.awc", &midi_bank(0x0056_5824, &midi)).unwrap();
        let stream = &described["streams"][0];
        assert_eq!(stream["name"], "0x00565824");
        assert_eq!(stream["type"], "MIDI");
        assert_eq!(stream["seconds"], 0);
        assert_eq!(stream["bytes"], midi.len());
        assert_eq!(stream["codec"], Value::Null);
        assert_eq!(stream["chunks"], json!(["mid"]));
        assert_eq!(stream["payloadSha256"], Value::Null);
        // Поток со звуком остаётся прежним: «PCM, 44100 Hz», размер из данных.
        let sound = plain_bank(&[(5, format20(4, 44100, 0), pcm_bytes(&[1, 2, 3, 4]))]);
        let heard = describe("pcm.awc", &sound).unwrap();
        assert_eq!(heard["streams"][0]["type"], "PCM, 44100 Hz");
        assert_eq!(heard["streams"][0]["bytes"], 8);
    }

    #[test]
    fn encrypted_and_big_endian_banks_are_told_apart() {
        let strange = load(&[0u8; 16]);
        assert!(strange.encrypted && strange.streams.is_empty());
        let mut console = vec![0u8; 16];
        console[..4].copy_from_slice(b"TADA");
        for refused in [console, vec![0u8; 8]] {
            assert!(read_bank(&refused).is_err());
        }
    }

    #[test]
    fn adpcm_block_decodes_by_the_ima_table() {
        let bytes = plain_bank(&[(7, format20(2, 22050, 4), vec![0, 0, 0, 0, 0x07])]);
        assert_eq!(stream_audio(&bytes, 7).unwrap().pcm, [13, 15]);
    }

    #[test]
    fn wav_header_carries_rate_and_length() {
        let out = wav(44100, &[1, -1]);
        assert_eq!(out.len(), 48);
        assert_eq!(&out[..4], b"RIFF");
        assert_eq!(&out[8..16], b"WAVEfmt ");
        let checks = [(24, 44100), (28, 88200), (40, 4)];
        for (at, want) in checks {
            assert_eq!(word_at(&out, at), want);
        }
    }

    #[test]
    fn peaks_are_per_bucket_and_normalised() {
        assert_eq!(peaks(&[16384; 480]).len(), 240);
        let cases: [(&[i16], f32); 2] = [(&[16384; 480], 0.5), (&[], 0.0)];
        for (pcm, want) in cases {
            assert!(peaks(pcm).iter().all(|v| *v == want));
        }
    }

    #[test]
    fn pick_keeps_only_the_chosen_streams_and_their_audio() {
        let bytes = plain_bank(&[
            (0x10, format20(3, 22050, 0), pcm_bytes(&[1, 2, 3])),
            (0x20, format20(2, 36000, 0), pcm_bytes(&[-4, 5])),
        ]);
        let cut = pick_streams(&bytes, &[0x20]).unwrap();
        let bank = load(&cut);
        assert_eq!(bank.streams.len(), 1);
        expect_stream(&bank, 0, 0x20);
        assert_eq!(stream_audio(&cut, 0x20).unwrap().pcm, [-4, 5]);
        assert!(pick_streams(&bytes, &[0x30]).is_err());
    }

    #[test]
    fn stereo_pair_takes_the_shorter_length_and_the_left_rate() {
        let left = StreamAudio { sample_rate: 22050, pcm: vec![1, 2, 3] };
        let right = StreamAudio { sample_rate: 36000, pcm: vec![-1, -2] };
        let out = stereo_wav(&left, &right);
        assert_eq!(out.len(), 52);
        assert_eq!(word_at(&out, 24), 22050);
        assert_eq!(&out[44..48], &[1, 0, 0xff, 0xff]);
    }

    #[test]
    fn pcm_length_follows_the_data_not_only_the_header() {
        let bytes = plain_bank(&[
            (1, format20(4, 8000, 0), pcm_bytes(&[1, 2, 3, 4])),
            (2, format20(4, 8000, 0), pcm_bytes(&[1])),
            (3, format20(9, 8000, 4), vec![0; 8]),
        ]);
        let lengths: Vec<_> = read_bank(&bytes).unwrap().streams.iter().map(Stream::pcm_length).collect();
        assert_eq!(lengths, [Some(4), Some(1), Some(9)]);
    }

    #[test]
    fn stream_names_round_trip() {
        assert_eq!(stream_name(0x0339_2bec), "0X03392BEC");
        let cases = [
            ("0X03392BEC", Some(0x0339_2bec)),
            ("0xffffffff", Some(0x1FFF_FFFF)),
            ("snp_heavy", None),
            ("0x1_0", None),
            ("0x10000000000000000", None),
            (" 0X10 ", Some(16)),
        ];
        for (input, want) in cases {
            assert_eq!(parse_stream_id(input), want);
        }
    }

    #[test]
    fn eight_chunks_in_one_stream_are_refused_not_wrapped_to_zero() {
        // Хост-сборщик здесь молча пишет число чанков 0 (три бита переполняются); мы отказываем.
        let eight = NewStream { id: 1, chunks: vec![(CHUNK_DATA, vec![1, 2]); 8] };
        let refusal = encode(0xff, 0, &[eight]).unwrap_err();
        assert_eq!(
            refusal.message,
            "AWC: в потоке 0X00000001 больше 7 чанков, число чанков не умещается в слово потока."
        );
        // Два потока по четыре чанка — в пределе, а отказ называет именно тесный поток.
        let fine = NewStream { id: 1, chunks: vec![(CHUNK_DATA, vec![1, 2]); 4] };
        let crowded = NewStream { id: 0x20, chunks: vec![(CHUNK_DATA, vec![3]); 8] };
        let refusal = encode(0xff, 0, &[fine.clone(), crowded]).unwrap_err();
        assert!(refusal.message.contains("0X00000020"), "{}", refusal.message);
        assert!(encode(0xff, 0, &[fine.clone(), fine]).is_ok());
        let seven = NewStream { id: 1, chunks: vec![(CHUNK_DATA, vec![1, 2]); 7] };
        let bytes = encode(0xff, 0, &[seven]).unwrap();
        assert_eq!(u32::from_le_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]), 0xe000_0001);
    }

    #[test]
    fn a_chunk_that_does_not_fit_28_bits_is_refused_not_cut() {
        // 256 МБ нулей: память лишь выделяется, не трогается — отказ приходит до сборки файла.
        let huge = NewStream { id: 1, chunks: vec![(CHUNK_DATA, vec![0u8; 1 << 28])] };
        let refusal = encode(0xff, 0, &[huge]).unwrap_err();
        assert_eq!(refusal.message, "AWC: размер или смещение чанка не умещается в 28 бит, банк больше 256 МБ.");
        // Размер влезает, а смещение следующего чанка уже нет: в обратном порядке раскладки
        // большой чанк ложится первым, и маленький оказывается за 2^28.
        let small = NewStream { id: 2, chunks: vec![(CHUNK_DATA, vec![0u8; 128])] };
        let big = NewStream { id: 1, chunks: vec![(CHUNK_DATA, vec![0u8; (1 << 28) - 32])] };
        let refusal = encode(0xff, 0, &[small, big]).unwrap_err();
        assert_eq!(refusal.message, "AWC: размер или смещение чанка не умещается в 28 бит, банк больше 256 МБ.");
    }
}
