//! Доводка готового открытого архива шифром NG своим кодом.
//!
//! Это то, что делает внешняя программа доводки, но без запуска программы:
//!
//! 1. Блок имён собирается заново. Обход каталогов идёт вглубь, корень первым;
//!    у каждого каталога сначала имена его подкаталогов, потом имена файлов
//!    (в прежнем порядке записей), без повторов по всему архиву. Длина блока —
//!    `(длина содержимого / 16 + 1) * 16`, то есть всегда с запасом нуля после
//!    последнего имени. Освободившийся хвост прежнего блока не трогается.
//! 2. Дети каждого каталога сортируются по имени (порядок кодовых единиц UTF-16,
//!    при равных именах каталоги раньше файлов, внутри вида — прежний порядок)
//!    и ложатся в таблицу подряд; группы детей идут в порядке обхода вглубь.
//! 3. Тела, начинающиеся ниже порога `E = 16 + 16·N + Σ(длина имени + 1)` по
//!    всем записям (имена считаются с повторами, длина — в кодовых единицах
//!    UTF-16), копируются в конец данных в порядке смещений: первое на
//!    `ceil512(конец последнего тела, оставшегося на месте)`, следующее на
//!    `ceil512(конец предыдущего)`. У плотно записанного файла это длина файла.
//!    Старые копии остаются, хвост файла не добивается. Заголовок копии ресурса,
//!    у которого размер лежит в самом ресурсе (от 16 МиБ), пишется заново:
//!    нули и четыре байта размера.
//! 4. Номер ключа берётся по имени файла и длине после переносов (без роста от
//!    оглавления); область `[16, 16 + 16·N + длина блока имён)` шифруется блоками
//!    по 16 байт, в заголовке метка меняется на NG.
//!
//! Файл, у которого метка не «открыто», не меняется вовсе. Имена в блоке пишутся
//! как младшие байты кодовых единиц UTF-16 (у ASCII это сами байты).
//!
//! Совпадение с ArchiveFix байт в байт проверено на плотных архивах (каждое тело
//! на `ceil512` за предыдущим, без дыр): так пишет `write_archive`. Что здесь
//! НЕ воспроизведено, потому что у такого входа нет значения для игры:
//!
//! * Целые неиспользованные блоки между телами выше порога (дыры). ArchiveFix
//!   кладёт в них переносимые тела, а мы — в хвост. Оба файла верны, но байты
//!   другие. Запас нулей в самом конце файла учтён (см. п. 3).
//! * Одинаковые имена у детей одного каталога (больше 16 штук): порядок равных
//!   у ArchiveFix зависит от неустойчивой сортировки.
//! * Тела длиной 0 ниже порога: ArchiveFix на них зависает (проверено), здесь они
//!   не переносятся.
//! * Корень с именем: ArchiveFix пишет ему чужое смещение имени, здесь отказ.

use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};

use crate::{
    append::{AppendError, Code, Host, PlainHost},
    error::{Result, RpfError},
    keys::KeySet,
    toc::{
        parse_entry, RawKind, BLOCK, ENCRYPTION_NG, ENCRYPTION_OPEN, ENTRY_SIZE, HEADER_SIZE, MAGIC,
    },
};

/// Смещение имени файла в записи — 16 бит.
const FILE_NAME_AT_MAX: usize = 0xffff;
/// Последний блок, на который можно перенести тело: 23 бита смещения.
const LAST_BLOCK: u64 = 0x7f_ffff;
/// Размер ресурса, за которым настоящий размер лежит в самом ресурсе.
const HIDDEN_SIZE_MARK: u32 = 0x00ff_ffff;
const RESOURCE_HEADER_LEN: usize = 16;
const RESOURCE_FLAG: u8 = 0x80;
/// Порция копирования перенесённых тел.
const COPY_PORTION: usize = 8 << 20;

/// Одно перенесённое тело.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Move {
    pub from: u64,
    pub to: u64,
    pub len: u64,
    /// Ресурс с настоящим размером внутри: заголовок копии пишется заново
    /// (нули и четыре байта размера), как у доводчика, который воспроизводится.
    pub rewrite_header: bool,
}

/// Что доводка сделает с файлом.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SealPlan {
    /// Новые заголовок и оглавление, зашифрованные, с позиции 0.
    pub head: Vec<u8>,
    /// Переносы тел в порядке смещений.
    pub moves: Vec<Move>,
    /// Длина файла после доводки.
    pub final_len: u64,
    /// Номер ключа, которым зашифровано оглавление.
    pub key_index: usize,
}

fn refuse(text: impl Into<String>) -> RpfError {
    RpfError::format(text)
}

pub(crate) fn ceil_block(value: u64) -> u64 {
    value.div_ceil(BLOCK) * BLOCK
}

fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

// ---------------------------------------------------------------------------
// Разбор оглавления
// ---------------------------------------------------------------------------

/// Запись оглавления: сырые 16 байт, разбор, имя в кодовых единицах UTF-16.
pub(crate) struct Node {
    pub(crate) raw: [u8; ENTRY_SIZE],
    pub(crate) kind: RawKind,
    pub(crate) name: Vec<u16>,
}

impl Node {
    pub(crate) fn is_dir(&self) -> bool {
        matches!(self.kind, RawKind::Directory { .. })
    }
}

/// Имя по смещению: до нуля или до конца блока; чужие байты — как у чтения
/// (с заменой), смещение за блоком — пустое имя.
fn name_units(names: &[u8], offset: u32) -> Vec<u16> {
    let tail = names.get(offset as usize..).unwrap_or_default();
    let end = tail.iter().position(|&b| b == 0).unwrap_or(tail.len());
    String::from_utf8_lossy(&tail[..end])
        .encode_utf16()
        .collect()
}

pub(crate) fn read_nodes(records: &[u8], names: &[u8]) -> Vec<Node> {
    records
        .chunks_exact(ENTRY_SIZE)
        .map(|chunk| {
            let mut raw = [0u8; ENTRY_SIZE];
            raw.copy_from_slice(chunk);
            let entry = parse_entry(&raw);
            Node {
                name: name_units(names, entry.name_offset),
                kind: entry.kind,
                raw,
            }
        })
        .collect()
}

/// Новая таблица: порядок записей, `first` каталогов и блок имён.
pub(crate) struct Layout {
    /// Кто стоит на каждой новой позиции (номер прежней записи).
    pub(crate) order: Vec<usize>,
    /// Для прежней записи: новое `first` (у каталога).
    pub(crate) first: Vec<u32>,
    /// Для прежней записи: смещение имени в новом блоке.
    pub(crate) name_at: Vec<u32>,
    /// Содержимое нового блока имён, без добивки.
    pub(crate) block: Vec<u8>,
}

/// Имя (кодовые единицы) → смещение в новом блоке.
struct Interner {
    block: Vec<u8>,
    known: HashMap<Vec<u16>, u32>,
}

impl Interner {
    fn new() -> Interner {
        Interner {
            block: vec![0],
            known: HashMap::from([(Vec::new(), 0)]),
        }
    }

    fn put(&mut self, name: &[u16]) -> u32 {
        if let Some(&at) = self.known.get(name) {
            return at;
        }
        let at = self.block.len() as u32;
        self.block.extend(name.iter().map(|&unit| unit as u8));
        self.block.push(0);
        self.known.insert(name.to_vec(), at);
        at
    }
}

/// Обход вглубь: группа детей каждого каталога занимает следующие места по
/// порядку обхода, имена берутся в прежнем порядке (каталоги, затем файлы).
pub(crate) fn relayout(nodes: &[Node]) -> Result<Layout> {
    let count = nodes.len();
    if !nodes.first().is_some_and(Node::is_dir) {
        return Err(refuse("The archive root is not a directory."));
    }
    if !nodes[0].name.is_empty() {
        return Err(refuse("The archive root has a name."));
    }
    let mut claimed = vec![false; count];
    claimed[0] = true;
    let mut order = vec![0usize];
    let mut first = vec![0u32; count];
    let mut name_at = vec![0u32; count];
    let mut names = Interner::new();
    let mut stack = vec![0usize];
    while let Some(dir) = stack.pop() {
        let RawKind::Directory {
            first: start,
            count: kids,
        } = nodes[dir].kind
        else {
            continue;
        };
        let range = start as usize..start as usize + kids as usize;
        if range.end > count {
            return Err(refuse("A directory points beyond the table of contents."));
        }
        let children: Vec<usize> = range.collect();
        for &child in &children {
            if std::mem::replace(&mut claimed[child], true) {
                return Err(refuse(
                    "The directory tree is malformed (an entry is listed twice).",
                ));
            }
        }

        // имена: сначала подкаталоги, потом файлы, в прежнем порядке
        for want_dir in [true, false] {
            for &child in children.iter().filter(|&&c| nodes[c].is_dir() == want_dir) {
                name_at[child] = names.put(&nodes[child].name);
            }
        }

        // дети по имени; при равных именах каталоги раньше файлов, дальше прежний порядок
        let mut sorted = children;
        sorted.sort_by(|&a, &b| {
            nodes[a]
                .name
                .cmp(&nodes[b].name)
                .then(nodes[a].is_dir().cmp(&nodes[b].is_dir()).reverse())
        });
        first[dir] = u32::try_from(order.len()).map_err(|_| refuse("Too many entries."))?;
        order.extend_from_slice(&sorted);
        stack.extend(sorted.iter().rev().copied().filter(|&c| nodes[c].is_dir()));
    }
    if claimed.iter().any(|&seen| !seen) {
        return Err(refuse(
            "The directory tree is malformed (an entry is not reachable from the root).",
        ));
    }
    Ok(Layout {
        order,
        first,
        name_at,
        block: names.block,
    })
}

/// Записи новой таблицы подряд (без заголовка и блока имён): каждая прежняя
/// запись получает своё место в порядке `layout.order`, новое смещение имени,
/// у каталога — новые `first` и число детей, у файла из `new_blocks` — новый
/// номер блока. Остальные байты записи остаются как были. Отказ, если смещение
/// имени файла не помещается в 16 бит.
pub(crate) fn encode_records(
    nodes: &[Node],
    layout: &Layout,
    new_blocks: &HashMap<usize, u64>,
) -> Result<Vec<u8>> {
    let mut table = Vec::with_capacity(nodes.len() * ENTRY_SIZE);
    for &old in &layout.order {
        let node = &nodes[old];
        let mut raw = node.raw;
        let at = layout.name_at[old];
        match node.kind {
            RawKind::Directory { count: kids, .. } => {
                raw[0..4].copy_from_slice(&at.to_le_bytes());
                raw[8..12].copy_from_slice(&layout.first[old].to_le_bytes());
                raw[12..16].copy_from_slice(&kids.to_le_bytes());
            }
            _ => {
                if at as usize > FILE_NAME_AT_MAX {
                    return Err(refuse(
                        "The archive has too many file names for the RPF7 table of contents.",
                    ));
                }
                raw[0..2].copy_from_slice(&(at as u16).to_le_bytes());
                if let Some(&block) = new_blocks.get(&old) {
                    raw[5] = block as u8;
                    raw[6] = (block >> 8) as u8;
                    raw[7] = (raw[7] & RESOURCE_FLAG) | ((block >> 16) as u8 & !RESOURCE_FLAG);
                }
            }
        }
        table.extend_from_slice(&raw);
    }
    Ok(table)
}

/// Блок имён с добивкой нулями до кратного 16; у кратного — ещё целый блок.
pub(crate) fn pad_names(mut block: Vec<u8>) -> Vec<u8> {
    block.resize((block.len() / 16 + 1) * 16, 0);
    block
}

// ---------------------------------------------------------------------------
// Переносы тел
// ---------------------------------------------------------------------------

/// Где лежит тело записи и сколько оно занимает.
struct Body {
    from: u64,
    len: u64,
    /// Размер ресурса лежит в его же заголовке.
    hidden_size: bool,
}

/// Тело записи; `None` — у записи нет тела (каталог).
fn body_len(
    node: &Node,
    hidden: &mut dyn FnMut(u64) -> Result<[u8; RESOURCE_HEADER_LEN]>,
) -> Result<Option<Body>> {
    Ok(match node.kind {
        RawKind::Directory { .. } => None,
        RawKind::Binary {
            stored_size,
            offset_blocks,
            uncompressed_size,
            ..
        } => {
            let len = if stored_size == 0 {
                uncompressed_size
            } else {
                stored_size
            };
            Some(Body {
                from: u64::from(offset_blocks) * BLOCK,
                len: u64::from(len),
                hidden_size: false,
            })
        }
        RawKind::Resource {
            stored_size,
            offset_blocks,
            ..
        } => {
            let from = u64::from(offset_blocks) * BLOCK;
            let hidden_size = stored_size == HIDDEN_SIZE_MARK;
            let len = if hidden_size {
                let head = hidden(from)?;
                u32::from_le_bytes([head[7], head[14], head[5], head[2]])
            } else {
                stored_size
            };
            Some(Body {
                from,
                len: u64::from(len),
                hidden_size,
            })
        }
    })
}

/// Порог, ниже которого тела уезжают в конец: размер оглавления, каким оно
/// могло бы стать, если бы ни одно имя не было общим.
pub(crate) fn threshold(nodes: &[Node]) -> u64 {
    let names: u64 = nodes.iter().map(|node| node.name.len() as u64 + 1).sum();
    HEADER_SIZE as u64 + ENTRY_SIZE as u64 * nodes.len() as u64 + names
}

/// Тела под порогом и их новые места. Дальше: длина файла после переносов и
/// самое раннее смещение тела, которое осталось на месте (`u64::MAX`, если таких нет).
fn plan_moves(
    nodes: &[Node],
    file_len: u64,
    hidden: &mut dyn FnMut(u64) -> Result<[u8; RESOURCE_HEADER_LEN]>,
) -> Result<(Vec<(usize, Move)>, u64, u64)> {
    let below = threshold(nodes);
    let mut found = Vec::new();
    let mut kept = u64::MAX;
    // конец последнего тела, оставшегося на месте: с него начинается хвост
    let mut data_end = 0u64;
    for (index, node) in nodes.iter().enumerate() {
        let Some(body) = body_len(node, hidden)? else {
            continue;
        };
        if body.len == 0 {
            continue;
        }
        if body.from.saturating_add(body.len) > file_len {
            return Err(refuse("An entry body goes beyond the end of the file."));
        }
        if body.from >= below {
            kept = kept.min(body.from);
            data_end = data_end.max(ceil_block(body.from + body.len));
        } else {
            found.push((index, body));
        }
    }
    // по смещениям; при равных — по номеру записи
    found.sort_by_key(|(index, body)| (body.from, *index));

    // Хвост лежит там, где кончаются тела: у файла с запасом нулей в конце
    // (так бывает у файлов игры) первое тело встаёт на запас, а не за него.
    let mut cursor = if kept == u64::MAX { file_len } else { data_end };
    let mut moves = Vec::with_capacity(found.len());
    for (index, body) in found {
        let to = ceil_block(cursor);
        if to / BLOCK > LAST_BLOCK {
            return Err(refuse(
                "The archive is too large to carry the moved bodies in an RPF7 entry.",
            ));
        }
        cursor = to + body.len;
        moves.push((
            index,
            Move {
                from: body.from,
                to,
                len: body.len,
                rewrite_header: body.hidden_size,
            },
        ));
    }
    let after = if moves.is_empty() {
        file_len
    } else {
        file_len.max(cursor)
    };
    Ok((moves, after, kept))
}

// ---------------------------------------------------------------------------
// План доводки
// ---------------------------------------------------------------------------

/// Сколько байт с начала файла нужно прочитать, чтобы составить план: заголовок,
/// записи и блок имён. `None` — метка не «открыто», файл не трогается.
pub fn head_span(header: &[u8]) -> Result<Option<usize>> {
    if header.len() < HEADER_SIZE {
        return Err(refuse("The file is too short to be an RPF7 archive."));
    }
    if word(header, 0) != MAGIC {
        return Err(refuse(format!(
            "The identifier {:08X} did not match the expected value of 0x52504637",
            word(header, 0)
        )));
    }
    if word(header, 12) != ENCRYPTION_OPEN {
        return Ok(None);
    }
    let (count, names) = (word(header, 4) as usize, word(header, 8) as usize);
    Ok(Some(HEADER_SIZE + count * ENTRY_SIZE + names))
}

/// План доводки по началу файла. `head` — байты с позиции 0 (не меньше, чем
/// назвал `head_span`), `file_len` — длина файла, `name` — имя файла (по нему и
/// по длине выбирается ключ), `first_bytes` отдаёт первые 16 байт тела по
/// смещению (нужны только ресурсам с настоящим размером внутри). Файл не
/// «открытый» — `None`.
pub fn plan_seal(
    head: &[u8],
    file_len: u64,
    name: &str,
    keys: &KeySet,
    first_bytes: &mut dyn FnMut(u64) -> Result<[u8; RESOURCE_HEADER_LEN]>,
) -> Result<Option<SealPlan>> {
    let Some(span) = head_span(head)? else {
        return Ok(None);
    };
    if head.len() < span || (span as u64) > file_len {
        return Err(refuse(
            "The table of contents goes beyond the end of the file.",
        ));
    }
    let count = word(head, 4) as usize;
    let records = &head[HEADER_SIZE..HEADER_SIZE + count * ENTRY_SIZE];
    let old_names = &head[HEADER_SIZE + count * ENTRY_SIZE..span];
    let nodes = read_nodes(records, old_names);
    let layout = relayout(&nodes)?;

    let (moves, after_moves, kept) = plan_moves(&nodes, file_len, first_bytes)?;
    let mut new_blocks: HashMap<usize, u64> = HashMap::new();
    for (index, shift) in &moves {
        new_blocks.insert(*index, shift.to / BLOCK);
    }

    let table = encode_records(&nodes, &layout, &new_blocks)?;
    let names = pad_names(layout.block);

    let key_index = keys.ng_key_index(name, after_moves.max(file_len));
    let mut sealed = table;
    sealed.extend_from_slice(&names);
    keys.encrypt_ng(key_index, &mut sealed)?;

    let mut out = Vec::with_capacity(HEADER_SIZE + sealed.len());
    for value in [MAGIC, count as u32, names.len() as u32, ENCRYPTION_NG] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&sealed);
    // новое оглавление не должно налезть на тело, оставшееся на месте
    if out.len() as u64 > kept {
        return Err(refuse(
            "The sealed table of contents would run over the body of an entry.",
        ));
    }
    let final_len = after_moves.max(file_len).max(out.len() as u64);
    Ok(Some(SealPlan {
        head: out,
        moves: moves.into_iter().map(|(_, shift)| shift).collect(),
        final_len,
        key_index,
    }))
}

// ---------------------------------------------------------------------------
// Доводка файла на месте
// ---------------------------------------------------------------------------

fn copy_range(file: &mut File, shift: Move, buffer: &mut Vec<u8>) -> Result<()> {
    let mut done = 0u64;
    while done < shift.len {
        let take = (shift.len - done).min(COPY_PORTION as u64) as usize;
        if buffer.len() < take {
            buffer.resize(take, 0);
        }
        file.seek(SeekFrom::Start(shift.from + done))?;
        file.read_exact(&mut buffer[..take])?;
        file.seek(SeekFrom::Start(shift.to + done))?;
        file.write_all(&buffer[..take])?;
        done += take as u64;
    }
    if shift.rewrite_header {
        // у копии ресурса с размером внутри заголовок: нули и четыре байта размера
        let mut head = [0u8; RESOURCE_HEADER_LEN];
        let size = shift.len as u32;
        head[7] = size as u8;
        head[14] = (size >> 8) as u8;
        head[5] = (size >> 16) as u8;
        head[2] = (size >> 24) as u8;
        file.seek(SeekFrom::Start(shift.to))?;
        file.write_all(&head)?;
    }
    Ok(())
}

/// Доводит файл на месте: переносит тела, потом пишет голову (метка «открыто»
/// меняется на NG последней, поэтому оборванная доводка оставляет файл
/// «открытым»). Возвращает план; `None` — метка не «открыто», файл не тронут. Число имён файла называет хозяин `host` (у крейта на
/// Windows своего вызова нет): файл с двумя именами — отказ `Linked` ДО первой записи (20.11.2026, `docs/RP-APPEND-SECOND-LINK.md`).
pub fn seal_file_with(
    path: &Path,
    name: &str,
    keys: &KeySet,
    host: &dyn Host,
) -> std::result::Result<Option<SealPlan>, AppendError> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let len = file.metadata()?.len();
    let mut header = [0u8; HEADER_SIZE];
    if len < HEADER_SIZE as u64 {
        return Err(refuse("The file is too short to be an RPF7 archive.").into());
    }
    file.read_exact(&mut header)?;
    let Some(span) = head_span(&header)? else {
        return Ok(None);
    };
    if span as u64 > len {
        return Err(refuse("The table of contents goes beyond the end of the file.").into());
    }
    let mut head = vec![0u8; span];
    file.seek(SeekFrom::Start(0))?;
    file.read_exact(&mut head)?;

    let plan = {
        let reader = &file;
        let mut first_bytes = |at: u64| -> Result<[u8; RESOURCE_HEADER_LEN]> {
            let mut handle: &File = reader;
            let mut bytes = [0u8; RESOURCE_HEADER_LEN];
            handle.seek(SeekFrom::Start(at))?;
            handle.read_exact(&mut bytes)?;
            Ok(bytes)
        };
        plan_seal(&head, len, name, keys, &mut first_bytes)?
    };
    let Some(plan) = plan else {
        return Ok(None);
    };
    if host.facts(&file)?.links.is_some_and(|links| links > 1) {
        return Err(AppendError::refused(
            Code::Linked,
            "The archive has more than one hard link; it is not written in place.",
        ));
    }

    let mut buffer = Vec::new();
    for shift in &plan.moves {
        copy_range(&mut file, *shift, &mut buffer)?;
    }
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&plan.head)?;
    file.flush()?;
    Ok(Some(plan))
}

/// То же с хозяином по умолчанию (`PlainHost`: число имён знает только на Unix); боевые вызовы движка — `seal_file_with` с его хозяином.
pub fn seal_file(path: &Path, name: &str, keys: &KeySet) -> Result<Option<SealPlan>> {
    seal_file_with(path, name, keys, &PlainHost).map_err(|error| match error {
        AppendError::Other(inner) => inner,
        other => RpfError::state(other.to_string()),
    })
}
