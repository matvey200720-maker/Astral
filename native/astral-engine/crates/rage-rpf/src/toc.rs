// Заголовок и оглавление RPF7: записи по 16 байт, блок имён, выбор шифра пробой.

use std::{borrow::Cow, cell::Cell};

use crate::{
    error::{Result, RpfError},
    keys::KeySet,
    source::ByteSource,
};

pub const BLOCK: u64 = 512;
pub const HEADER_SIZE: usize = 16;
pub const ENTRY_SIZE: usize = 16;
pub const ENCRYPTION_OPEN: u32 = 0x4e45_504f;
pub const ENCRYPTION_AES: u32 = 0x0fff_fff9;
pub const ENCRYPTION_NG: u32 = 0x0fef_ffff;
pub const DIRECTORY_MARKER: u32 = 0x7fff_ff00;
pub const MAGIC: u32 = 0x5250_4637;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawEntry {
    pub name_offset: u32,
    pub kind: RawKind,
}

pub struct Toc {
    pub encryption: Encryption,
    pub ng_key_index: Option<usize>,
    pub entries: Vec<RawEntry>,
    pub names: Vec<u8>,
}

// Поле записи: с какого байта и сколько байт (число младшим байтом вперёд).
#[derive(Clone, Copy)]
struct Span {
    at: usize,
    width: usize,
}

const fn span(at: usize, width: usize) -> Span {
    Span { at, width }
}

// У каталога: смещение имени, метка, первый потомок, число потомков.
const DIRECTORY_SPANS: [Span; 4] = [span(0, 4), span(4, 4), span(8, 4), span(12, 4)];
// У файла и ресурса поля общие, различается только смысл двух последних слов:
// смещение имени, размер в архиве, смещение в блоках, слово A, слово B.
const LEAF_SPANS: [Span; 5] = [span(0, 2), span(2, 3), span(5, 3), span(8, 4), span(12, 4)];
// Заголовок: признак, число записей, длина блока имён, метка шифра.
const HEADER_SPANS: [Span; 4] = [span(0, 4), span(4, 4), span(8, 4), span(12, 4)];
const RESOURCE_FLAG: u8 = 0x80;
const RESOURCE_BLOCKS_MASK: u32 = 0x7f_ffff;

// Индексы берутся по возрастанию: короткий срез падает на первом же выходе за край.
fn load(bytes: &[u8], field: Span) -> u32 {
    (0..field.width).fold(0, |acc, k| acc | u32::from(bytes[field.at + k]) << (8 * k))
}

fn load_all<const N: usize>(bytes: &[u8], fields: &[Span; N]) -> [u32; N] {
    std::array::from_fn(|i| load(bytes, fields[i]))
}

fn store_all<const N: usize>(fields: &[Span; N], values: [u32; N]) -> [u8; ENTRY_SIZE] {
    let mut out = [0u8; ENTRY_SIZE];
    for (field, value) in fields.iter().zip(values) {
        out[field.at..field.at + field.width].copy_from_slice(&value.to_le_bytes()[..field.width]);
    }
    out
}

// Короткий срез не должен ронять разбор: недостающие байты читаются как нули,
// лишние (после шестнадцатого) игнорируются.
pub fn parse_entry(bytes: &[u8]) -> RawEntry {
    let mut record = [0u8; ENTRY_SIZE];
    let known = bytes.len().min(ENTRY_SIZE);
    record[..known].copy_from_slice(&bytes[..known]);
    let bytes = &record[..];

    if load(bytes, DIRECTORY_SPANS[1]) == DIRECTORY_MARKER {
        let [name_offset, _, first, count] = load_all(bytes, &DIRECTORY_SPANS);
        return RawEntry {
            name_offset,
            kind: RawKind::Directory { first, count },
        };
    }

    let [name_offset, stored_size, blocks, word_a, word_b] = load_all(bytes, &LEAF_SPANS);
    let kind = if bytes[7] & RESOURCE_FLAG != 0 {
        RawKind::Resource {
            stored_size,
            offset_blocks: blocks & RESOURCE_BLOCKS_MASK,
            system_flags: word_a,
            graphics_flags: word_b,
        }
    } else {
        RawKind::Binary {
            stored_size,
            offset_blocks: blocks,
            uncompressed_size: word_a,
            encrypted: word_b != 0,
        }
    };
    RawEntry { name_offset, kind }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawKind {
    Directory {
        first: u32,
        count: u32,
    },
    Binary {
        stored_size: u32,
        offset_blocks: u32,
        uncompressed_size: u32,
        encrypted: bool,
    },
    Resource {
        stored_size: u32,
        offset_blocks: u32,
        system_flags: u32,
        graphics_flags: u32,
    },
}

pub fn encode_entry(entry: &RawEntry) -> [u8; ENTRY_SIZE] {
    let name = entry.name_offset;
    match entry.kind {
        RawKind::Resource {
            stored_size,
            offset_blocks,
            system_flags,
            graphics_flags,
        } => {
            let mut out = store_all(
                &LEAF_SPANS,
                [
                    name,
                    stored_size,
                    offset_blocks,
                    system_flags,
                    graphics_flags,
                ],
            );
            out[7] |= RESOURCE_FLAG;
            out
        }
        RawKind::Binary {
            stored_size,
            offset_blocks,
            uncompressed_size,
            encrypted,
        } => store_all(
            &LEAF_SPANS,
            [
                name,
                stored_size,
                offset_blocks,
                uncompressed_size,
                u32::from(encrypted),
            ],
        ),
        RawKind::Directory { first, count } => {
            store_all(&DIRECTORY_SPANS, [name, DIRECTORY_MARKER, first, count])
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Encryption {
    None,
    Aes,
    Ng,
}

// Разобранный заголовок и размеры двух областей, уже проверенные против источника.
struct Layout {
    entries_bytes: usize,
    names_bytes: usize,
    marker: u32,
}

// Одна догадка о шифре оглавления: режим и номер ключа NG (только у NG).
// `blind` — ключ подобран перебором, без оснований (ни метка, ни имя на него не
// указывают).
#[derive(Clone, Copy)]
struct Probe {
    mode: Encryption,
    key: Option<usize>,
    blind: bool,
}

// Сколько записей из начала таблицы расшифровывает проба вслепую: корневой
// каталог лежит первой записью, остальную таблицу расшифровывает уже подошедший
// ключ. Без этого безнадёжный архив стоил бы сто полных расшифровок таблицы.
const BLIND_WINDOW: usize = 1024 * ENTRY_SIZE;

// Метки шифра в порядке вариантов `Encryption`: None, Aes, Ng.
const MODE_MARKERS: [u32; 3] = [ENCRYPTION_OPEN, ENCRYPTION_AES, ENCRYPTION_NG];

impl Encryption {
    pub fn marker(self) -> u32 {
        MODE_MARKERS[self as usize]
    }

    pub fn from_marker(marker: u32) -> Self {
        const MODES: [Encryption; 3] = [Encryption::None, Encryption::Aes, Encryption::Ng];
        MODE_MARKERS
            .iter()
            .position(|&known| known == marker)
            .map_or(Encryption::Ng, |at| MODES[at])
    }
}

const MAX_ENTRIES: u32 = 8_000_000;
const MAX_NAMES_BYTES: u32 = 268_435_456;

fn check_header(source: &dyn ByteSource, name: &str) -> Result<Layout> {
    let fail = |msg: &str| RpfError::format(format!("{name}: {msg}"));
    let total = source.len();
    if total < HEADER_SIZE as u64 {
        return Err(fail("the file is too short to be an RPF7 archive"));
    }

    let head = source.read_vec(0, HEADER_SIZE)?;
    let [magic, count, names_len, marker] = load_all(&head, &HEADER_SPANS);
    if magic != MAGIC {
        return Err(fail(&format!(
            "The identifier {magic:08X} did not match the expected value of 0x52504637"
        )));
    }
    if count > MAX_ENTRIES || names_len > MAX_NAMES_BYTES {
        return Err(fail("the table of contents is implausibly large"));
    }

    let entries_bytes = count as usize * ENTRY_SIZE;
    let reach = HEADER_SIZE as u64 + entries_bytes as u64 + u64::from(names_len);
    if reach <= total {
        Ok(Layout {
            entries_bytes,
            names_bytes: names_len as usize,
            marker,
        })
    } else {
        Err(fail(
            "the table of contents goes beyond the end of the file",
        ))
    }
}

pub(crate) const NO_DIRECTORIES: &str =
    "RPF7 has no directory entries \u{2014} file is malformed or uses an unsupported format.";

thread_local! {
    // Сколько раз этот поток разбирал оглавление; считает и отказы.
    static PARSED: Cell<u64> = const { Cell::new(0) };
}

/// Сколько оглавлений разобрал текущий поток с начала жизни. Команда берёт
/// счёт до работы и после и по разнице видит, сколько раз она разбирала
/// оглавления (корневые и вложенные архивы).
pub fn parse_count() -> u64 {
    PARSED.with(Cell::get)
}

pub fn read_toc(source: &dyn ByteSource, name: &str, keys: Option<&KeySet>) -> Result<Toc> {
    PARSED.with(|parsed| parsed.set(parsed.get() + 1));
    let Layout {
        entries_bytes,
        names_bytes,
        marker,
    } = check_header(source, name)?;
    let records = source.read_vec(HEADER_SIZE as u64, entries_bytes)?;
    let names = source.read_vec((HEADER_SIZE + entries_bytes) as u64, names_bytes)?;

    let probes = probe_queue(
        Encryption::from_marker(marker),
        keys.map(|set| set.ng_key_index(name, source.len())),
        keys.map_or(0, KeySet::ng_key_count),
    );
    open_with_probes(probes, keys, &records, &names).ok_or_else(|| RpfError::format(NO_DIRECTORIES))
}

// Первая подошедшая проба даёт результат; подошла — значит, в записях есть каталог.
fn open_with_probes(
    probes: Vec<Probe>,
    keys: Option<&KeySet>,
    records: &[u8],
    names: &[u8],
) -> Option<Toc> {
    probes.into_iter().find_map(|probe| {
        if probe.blind {
            let head = &records[..records.len().min(BLIND_WINDOW)];
            unseal(probe, keys, head).filter(|r| has_directory(r))?;
        }
        let plain_records = unseal(probe, keys, records).filter(|r| has_directory(r))?;
        let plain_names = unseal(probe, keys, names)?;
        let mut entries = Vec::new();
        for chunk in plain_records.chunks_exact(ENTRY_SIZE) {
            entries.push(parse_entry(chunk));
        }
        Some(Toc {
            encryption: probe.mode,
            ng_key_index: probe.key,
            entries,
            names: plain_names.into_owned(),
        })
    })
}

fn has_directory(records: &[u8]) -> bool {
    let mark = DIRECTORY_MARKER.to_le_bytes();
    records
        .chunks_exact(ENTRY_SIZE)
        .any(|record| record[4..8] == mark)
}

// Расшифровка копии; `None`, если пробе не хватает ключей.
fn unseal<'a>(probe: Probe, keys: Option<&KeySet>, data: &'a [u8]) -> Option<Cow<'a, [u8]>> {
    if probe.mode == Encryption::None {
        return Some(Cow::Borrowed(data));
    }
    let keys = keys?;
    let mut copy = data.to_vec();
    if probe.mode == Encryption::Aes {
        keys.decrypt_aes(&mut copy);
    } else {
        keys.decrypt_ng(probe.key?, &mut copy);
    }
    Some(Cow::Owned(copy))
}

// Очередь проб: режим из метки; остальные режимы по списку «открыто, AES, NG»;
// затем NG с каждым номером ключа, кроме «по имени».
fn probe_queue(first: Encryption, key_by_name: Option<usize>, key_count: usize) -> Vec<Probe> {
    let with_key = |mode| Probe {
        mode,
        key: key_by_name.filter(|_| mode == Encryption::Ng),
        blind: false,
    };
    let mut queue = vec![with_key(first)];
    queue.extend(
        [Encryption::None, Encryption::Aes, Encryption::Ng]
            .into_iter()
            .filter(|&mode| mode != first)
            .map(with_key),
    );
    if let Some(skip) = key_by_name {
        queue.extend((0..key_count).filter(|&k| k != skip).map(|k| Probe {
            mode: Encryption::Ng,
            key: Some(k),
            blind: true,
        }));
    }
    queue
}

impl Toc {
    pub fn name_at(&self, offset: u32) -> String {
        let tail = self.names.get(offset as usize..).unwrap_or_default();
        let name = tail.split(|&b| b == 0).next().unwrap_or_default();
        String::from_utf8_lossy(name).into_owned()
    }
}
