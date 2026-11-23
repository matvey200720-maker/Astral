//! Граф метаданных RSC7 (карты `.ymap`, файлы типов `.ytyp` и родственные): схема, узлы со ссылками
//! и обратная сборка файла в расположении, которое читает игра.
//!
//! Тело файла: таблица описаний структур и перечислений, таблица блоков и сами блоки. Читатель
//! превращает указатели между областями в ссылки на узлы, писатель раскладывает узлы по блокам
//! заново и возвращает указатели на место. Модуль не проверяет значения полей: поддерево можно
//! переносить между файлами как есть (`copy_node`).

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use libdeflater::{CompressionLvl, Compressor};

use crate::error::{Error, Result};
use crate::resource::{Resource, HEADER_BYTES, RSC7_MAGIC, SYSTEM_BASE};

/// Имя блока, в котором лежат массивы указателей.
pub const POINTER_BLOCK: u32 = 7;
/// Имя блока строк.
pub const STRING_BLOCK: u32 = 0x10;
/// Служебная запись схемы: вид элемента массива, поле которого идёт следом.
pub(crate) const ARRAYINFO: u32 = 0x100;
pub(crate) const T_STRUCTURE: u8 = 0x05;
pub(crate) const T_STRUCTURE_POINTER: u8 = 0x07;
pub(crate) const T_ARRAY: u8 = 0x52;

/// Где что лежит в теле файла метаданных: заголовок, строки таблиц, служебные слова.
mod body_map {
    pub const ROOT_NUMBER: usize = 0x1C;
    pub const STRUCT_TABLE: usize = 0x20;
    pub const ENUM_TABLE: usize = 0x28;
    pub const BLOCK_TABLE: usize = 0x30;
    pub const STRUCT_COUNT: usize = 0x48;
    pub const ENUM_COUNT: usize = 0x4A;
    pub const BLOCK_COUNT: usize = 0x4C;

    pub const STRUCT_ROW: usize = 32;
    pub const ENTRY_ROW: usize = 16;
    pub const ENUM_ROW: usize = 24;
    pub const VALUE_ROW: usize = 8;
    pub const BLOCK_ROW: usize = 16;

    /// Первое слово тела.
    pub const LEAD_WORD: u64 = 0x405b_c808;
    /// Слово `PRD0` по смещению 0x10.
    pub const FORMAT_WORD: u64 = 0x5052_4430;
    /// Начало области, зарезервированной под служебные страницы, и её длина до таблиц.
    pub const RESERVED_AT: usize = 112;
    /// С этого смещения идут таблицы.
    pub const TABLES_AT: usize = 0x480;
    pub const MIN_PAGE: usize = 0x2000;
    /// Блок, перешагнувший эту длину, считается заполненным.
    pub const SOFT_LIMIT: usize = 0x4000;
    /// Номер блока в указателе — 12 бит со сдвигом на единицу.
    pub const MAX_BLOCKS: usize = 0xFFF;
    pub const ALIGN: usize = 16;
}

/// Тексты отказов чтения.
mod refusal {
    pub const NEGATIVE_OFFSET: &str = "Смещение поля в схеме отрицательно.";
    pub const FIELD_PLACE: &str = "Поле не умещается в узел метаданных.";
    pub const EMPTY_GRAPH: &str = "Граф метаданных пуст.";
    pub const ROOT_OUTSIDE: &str = "Корень графа вне узлов.";
    pub const LINK_TARGET: &str = "Ссылка на узел вне файла.";
    pub const LINK_PLACE: &str = "Ссылка за концом узла.";
    pub const TOO_MANY_STRUCTS: &str = "Структур в схеме больше 65535.";
    pub const TOO_MANY_ENUMS: &str = "Перечислений в схеме больше 65535.";
    pub const TOO_MANY_FIELDS: &str = "Полей в структуре больше 65535.";
    pub const TOO_MANY_BLOCKS: &str = "Блоков метаданных больше 4095.";
    pub const NO_TABLE: &str = "Файл метаданных без таблицы.";
    pub const STRUCT_ENTRIES: &str = "Структура без записей.";
    pub const ENUM_VALUES: &str = "Перечисление без значений.";
    pub const BLOCK_DATA: &str = "Блок без данных.";
    pub const NO_ROOT: &str = "Файл метаданных без корня.";
    pub const NO_BLOCK: &str = "Указатель на несуществующий блок.";
    pub const PAST_BLOCK: &str = "Указатель за концом блока.";
    pub const NODE_EOF: &str = "Чтение метаданных за концом данных.";
    pub const UNDESCRIBED: &str = "Тип блока не описан в файле: пока на хосте.";
    pub const NO_ELEMENTS: &str = "Массив без описания элементов: пока на хосте.";
    pub const ELEMENT_UNKNOWN: &str = "Элемент массива не описан в файле: пока на хосте.";
    pub const ARRAY_KIND: &str = "Массив такого типа: пока на хосте.";
    pub const INLINE_UNKNOWN: &str = "Вложенная структура не описана в файле: пока на хосте.";
}

// ---------------------------------------------------------------------------
// Узлы, ссылки, копирование
// ---------------------------------------------------------------------------

pub type NodeId = usize;

/// Указатель из байт узла на другой узел; `at` — смещение указателя в байтах узла.
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub at: usize,
    pub target: Option<NodeId>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub block: u32,
    pub bytes: Vec<u8>,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub root: NodeId,
}

impl Graph {
    pub fn push(&mut self, node: Node) -> NodeId {
        let id = self.nodes.len();
        self.nodes.push(node);
        id
    }
}

/// Узел, у которого ещё не все ссылки скопированы: исходный номер, номер копии, следующая ссылка.
struct Unfinished {
    origin: NodeId,
    copy: NodeId,
    next: usize,
}

/// Копирует узел и всё, что достижимо из него, в `dst`; возвращает номер копии.
///
/// Сам `from` копируется всегда; потомки, уже попавшие в `memo`, берутся готовыми. Номера копиям
/// выдаются при первой встрече узла, обход глубиной идёт на явном стеке.
pub fn copy_node(
    dst: &mut Graph,
    src: &Graph,
    from: NodeId,
    memo: &mut HashMap<NodeId, NodeId>,
) -> NodeId {
    fn spawn(
        dst: &mut Graph,
        src: &Graph,
        id: NodeId,
        memo: &mut HashMap<NodeId, NodeId>,
    ) -> NodeId {
        let original = &src.nodes[id];
        let copy = dst.push(Node {
            block: original.block,
            bytes: original.bytes.clone(),
            links: Vec::with_capacity(original.links.len()),
        });
        memo.insert(id, copy);
        copy
    }

    let first = spawn(dst, src, from, memo);
    let mut stack = vec![Unfinished { origin: from, copy: first, next: 0 }];
    while let Some(top) = stack.last_mut() {
        let Some(link) = src.nodes[top.origin].links.get(top.next) else {
            stack.pop();
            continue;
        };
        top.next += 1;
        let owner = top.copy;
        let target = link.target.map(|id| match memo.get(&id) {
            Some(&done) => done,
            None => {
                let fresh = spawn(dst, src, id, memo);
                stack.push(Unfinished { origin: id, copy: fresh, next: 0 });
                fresh
            }
        });
        dst.nodes[owner].links.push(Link { at: link.at, target });
    }
    first
}

/// Текст поддерева для сравнения: блок, байты и ссылки; общий узел раскрывается каждый раз.
pub fn canonical(graph: &Graph, id: NodeId) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";

    fn spell(graph: &Graph, id: NodeId, out: &mut String) {
        let node = &graph.nodes[id];
        let _ = write!(out, "{:08x}(", node.block);
        out.extend(
            node.bytes
                .iter()
                .flat_map(|&b| [DIGITS[usize::from(b >> 4)], DIGITS[usize::from(b & 15)]])
                .map(char::from),
        );
        out.push(')');
        for link in &node.links {
            let _ = write!(out, "[{}:", link.at);
            match link.target {
                Some(target) => spell(graph, target, out),
                None => out.push('0'),
            }
            out.push(']');
        }
    }

    let mut text = String::new();
    spell(graph, id, &mut text);
    text
}

// ---------------------------------------------------------------------------
// Схема: записи полей, структуры, перечисления
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: u32,
    pub offset: i32,
    pub dtype: u8,
    pub unk9: u8,
    pub ref_index: i16,
    pub ref_key: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StructDef {
    pub name: u32,
    pub key: u32,
    pub unk8: u32,
    pub size: u32,
    pub entries: Vec<Entry>,
}

impl StructDef {
    /// Первое поле с таким именем; служебные записи массивов не считаются полями.
    pub fn field(&self, name: u32) -> Option<&Entry> {
        if name == ARRAYINFO {
            return None;
        }
        self.entries.iter().find(|entry| entry.name == name)
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Schema {
    pub structs: Vec<StructDef>,
    pub enums: Vec<EnumDef>,
}

impl Schema {
    pub fn struct_named(&self, name: u32) -> Option<&StructDef> {
        self.structs.iter().find(|def| def.name == name)
    }

    pub fn struct_keyed(&self, key: u32) -> Option<&StructDef> {
        self.structs.iter().find(|def| def.key == key)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumDef {
    pub name: u32,
    pub key: u32,
    pub unk12: u32,
    pub values: Vec<(u32, i32)>,
}

impl Schema {
    pub fn enum_keyed(&self, key: u32) -> Option<&EnumDef> {
        self.enums.iter().find(|def| def.key == key)
    }

    pub fn enum_named(&self, name: u32) -> Option<&EnumDef> {
        self.enums.iter().find(|def| def.name == name)
    }
}

// ---------------------------------------------------------------------------
// Чтение таблиц тела
// ---------------------------------------------------------------------------

/// Запись таблицы в теле: поля читаются по смещению от её начала.
#[derive(Clone, Copy)]
struct Rec<'r> {
    res: &'r Resource,
    at: usize,
}

impl Rec<'_> {
    fn byte(self, delta: usize) -> Result<u8> {
        self.res.u8(self.at + delta)
    }

    fn half(self, delta: usize) -> Result<u16> {
        self.res.u16(self.at + delta)
    }

    fn signed_half(self, delta: usize) -> Result<i16> {
        self.res.i16(self.at + delta)
    }

    fn word(self, delta: usize) -> Result<u32> {
        self.res.u32(self.at + delta)
    }

    fn signed_word(self, delta: usize) -> Result<i32> {
        self.word(delta).map(|raw| raw as i32)
    }

    /// Указатель в записи, переведённый в смещение тела.
    fn link(self, delta: usize) -> Result<Option<usize>> {
        Ok(self.res.at(self.res.u64(self.at + delta)?))
    }
}

/// `count` записей подряд с шагом `stride`, начиная с `first`. Число берётся из файла и может быть
/// каким угодно большим, поэтому память заранее не резервируется: вектор растёт по записи, а чтение
/// останавливается на первой, что не уместилась в тело.
fn rows<T>(
    res: &Resource,
    first: usize,
    count: usize,
    stride: usize,
    read_row: impl Fn(Rec<'_>) -> Result<T>,
) -> Result<Vec<T>> {
    (0..count)
        .map(|i| read_row(Rec { res, at: first + i * stride }))
        .collect()
}

fn entry_row(rec: Rec<'_>) -> Result<Entry> {
    Ok(Entry {
        name: rec.word(0)?,
        offset: rec.signed_word(4)?,
        dtype: rec.byte(8)?,
        unk9: rec.byte(9)?,
        ref_index: rec.signed_half(10)?,
        ref_key: rec.word(12)?,
    })
}

fn struct_row(rec: Rec<'_>) -> Result<StructDef> {
    let count = usize::from(rec.half(30)?);
    let entries = match count {
        0 => Vec::new(),
        _ => {
            let first = rec
                .link(16)?
                .ok_or_else(|| Error::broken(refusal::STRUCT_ENTRIES))?;
            rows(rec.res, first, count, body_map::ENTRY_ROW, entry_row)?
        }
    };
    Ok(StructDef {
        name: rec.word(0)?,
        key: rec.word(4)?,
        unk8: rec.word(8)?,
        size: rec.word(24)?,
        entries,
    })
}

fn enum_row(rec: Rec<'_>) -> Result<EnumDef> {
    let count = rec.word(16)? as usize;
    let values = match count {
        0 => Vec::new(),
        _ => {
            // Адрес читается целиком, все 64 бита: `unk12` лежит в его старшей половине.
            let first = rec
                .link(8)?
                .ok_or_else(|| Error::broken(refusal::ENUM_VALUES))?;
            rows(rec.res, first, count, body_map::VALUE_ROW, |value| {
                Ok((value.word(0)?, value.signed_word(4)?))
            })?
        }
    };
    Ok(EnumDef {
        name: rec.word(0)?,
        key: rec.word(4)?,
        unk12: rec.word(12)?,
        values,
    })
}

/// Строка таблицы блоков.
struct BlockRec {
    name: u32,
    len: usize,
    start: usize,
}

fn block_row(rec: Rec<'_>) -> Result<BlockRec> {
    let start = rec
        .link(8)?
        .ok_or_else(|| Error::broken(refusal::BLOCK_DATA))?;
    Ok(BlockRec {
        name: rec.word(0)?,
        len: rec.word(4)? as usize,
        start,
    })
}

/// Всё, что узлам нужно знать о файле: схема, блоки и индекс корневого блока.
struct Directory {
    schema: Schema,
    blocks: Vec<BlockRec>,
    root_block: usize,
}

fn read_directory(res: &Resource) -> Result<Directory> {
    use body_map::*;

    let head = Rec { res, at: 0 };
    let struct_count = usize::from(head.half(STRUCT_COUNT)?);
    let enum_count = usize::from(head.half(ENUM_COUNT)?);
    let table = |slot: usize| {
        head.link(slot)?
            .ok_or_else(|| Error::broken(refusal::NO_TABLE))
    };

    let structs = match struct_count {
        0 => Vec::new(),
        n => rows(res, table(STRUCT_TABLE)?, n, STRUCT_ROW, struct_row)?,
    };
    let enums = match enum_count {
        0 => Vec::new(),
        n => rows(res, table(ENUM_TABLE)?, n, ENUM_ROW, enum_row)?,
    };

    // Таблица блоков нужна всегда, даже когда структур и перечислений нет.
    let block_at = table(BLOCK_TABLE)?;
    let block_count = usize::from(head.half(BLOCK_COUNT)?);
    let blocks = rows(res, block_at, block_count, BLOCK_ROW, block_row)?;

    let root_number = head.word(ROOT_NUMBER)? as usize;
    let root_block = match root_number.checked_sub(1) {
        Some(index) if index < blocks.len() => index,
        _ => return Err(Error::broken(refusal::NO_ROOT)),
    };
    Ok(Directory {
        schema: Schema { structs, enums },
        blocks,
        root_block,
    })
}

/// Таблица строк: номер первого блока `STRING_BLOCK` и его байты. Блок, не лежащий в теле,
/// даёт пустую таблицу.
fn string_table(res: &Resource, blocks: &[BlockRec]) -> (Option<usize>, Vec<u8>, Vec<(usize, Vec<u8>)>) {
    let bytes_of = |block: &BlockRec| res.data().get(block.start..).and_then(|rest| rest.get(..block.len)).unwrap_or_default().to_vec();
    let mut tables = blocks.iter().enumerate().filter(|(_, block)| block.name == STRING_BLOCK);
    let first = tables.next();
    // Строки, не поместившиеся в первый блок, лежат в следующих блоках строк; указатели ведут и в них.
    let later = tables.map(|(index, block)| (index, bytes_of(block))).collect();
    (first.map(|(index, _)| index), first.map(|(_, block)| bytes_of(block)).unwrap_or_default(), later)
}

// ---------------------------------------------------------------------------
// Результат чтения
// ---------------------------------------------------------------------------

#[derive(Clone, PartialEq)]
pub struct Read {
    pub schema: Schema,
    pub graph: Graph,
    strings: Vec<u8>,
    string_block: Option<usize>,
    /// Следующие блоки строк: номер блока и байты.
    later_strings: Vec<(usize, Vec<u8>)>,
    /// Начало каждого узла в теле файла.
    pub origins: Vec<Option<usize>>,
}

impl std::fmt::Debug for Read {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Read")
            .field("schema", &self.schema)
            .field("graph", &self.graph)
            .field("strings", &self.strings)
            .field("string_block", &self.string_block)
            .field("origins", &self.origins)
            .finish()
    }
}

impl Read {
    /// Непустые строки таблиц строк по порядку (сначала первого блока, потом следующих); не-UTF-8 части молча пропускаются.
    pub fn strings(&self) -> Vec<String> {
        std::iter::once(&self.strings)
            .chain(self.later_strings.iter().map(|(_, bytes)| bytes))
            .flat_map(|table| table.split(|&b| b == 0))
            .filter_map(|part| match part {
                [] => None,
                _ => String::from_utf8(part.to_vec()).ok(),
            })
            .collect()
    }

    /// Байты таблиц строк как есть: сначала первого блока строк, потом следующих.
    pub fn string_tables(&self) -> Vec<&[u8]> {
        std::iter::once(&self.strings)
            .chain(self.later_strings.iter().map(|(_, bytes)| bytes))
            .map(Vec::as_slice)
            .collect()
    }

    /// Строка по указателю на блок строк (номер блока в низких 12 битах, смещение выше).
    pub fn string_at(&self, pointer: u64) -> Option<String> {
        let block = ((pointer & 0xFFF) as usize).checked_sub(1)?;
        let table = if self.string_block == Some(block) {
            &self.strings
        } else {
            &self.later_strings.iter().find(|(index, _)| *index == block)?.1
        };
        let tail = table.get(usize::try_from(pointer >> 12).ok()?..)?;
        let text = tail.split(|&b| b == 0).next().unwrap_or(tail);
        String::from_utf8(text.to_vec()).ok()
    }
}

/// Тело файла для чтения узлов; любое чтение за концом — отказ с текстом про метаданные.
#[derive(Clone, Copy)]
struct Body<'a>(&'a [u8]);

impl<'a> Body<'a> {
    fn window(self, at: usize, len: usize) -> Result<&'a [u8]> {
        self.0
            .get(at..)
            .and_then(|rest| rest.get(..len))
            .ok_or_else(|| Error::broken(refusal::NODE_EOF))
    }

    fn short(self, at: usize) -> Result<u16> {
        let raw = self.window(at, 2)?;
        Ok(u16::from_le_bytes([raw[0], raw[1]]))
    }

    fn wide(self, at: usize) -> Result<u64> {
        let mut raw = [0u8; 8];
        raw.copy_from_slice(self.window(at, 8)?);
        Ok(u64::from_le_bytes(raw))
    }
}

/// Адрес узла в файле: индекс блока и смещение внутри него. Ключ для «один адрес — один узел».
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Spot {
    block: usize,
    offset: usize,
}

/// Где в узле лежит структура, поля которой обходятся: узел, адрес в теле и смещение в его байтах.
#[derive(Clone, Copy)]
struct Place {
    node: NodeId,
    base: usize,
    rel: usize,
}

/// Поле структуры в работе: куда оно ведёт в теле (`addr`) и в байтах узла (`rel`), плюс
/// описание элемента, если это массив.
struct Field<'a> {
    place: Place,
    entry: &'a Entry,
    info: Option<&'a Entry>,
    addr: usize,
    rel: usize,
}

/// Читатель поля: что делать с полем известного типа.
type Reader<'a> = fn(&mut Walker<'a>, &Field<'a>) -> Result<()>;

/// Какие элементы лежат в массиве.
enum Items {
    Pointers,
    Records,
    Plain(usize),
}

/// Размеры элементов массивов чисел: виды элемента и ширина одного.
const PLAIN_WIDTHS: [(&[u8], usize); 3] = [
    (&[0x01, 0x11], 1),
    (&[0x14, 0x15, 0x21, 0x4A, 0x62, 0x65], 4),
    (&[0x33, 0x34], 16),
];

fn items_of(kind: &Entry) -> Result<Items> {
    match kind.dtype {
        T_STRUCTURE_POINTER => Ok(Items::Pointers),
        T_STRUCTURE => Ok(Items::Records),
        other => PLAIN_WIDTHS
            .iter()
            .find(|(kinds, _)| kinds.contains(&other))
            .map(|&(_, width)| Items::Plain(width))
            .ok_or_else(|| Error::argument(refusal::ARRAY_KIND)),
    }
}

/// Поля структуры вместе с описанием элемента для массивов. Одно описание достаётся ближайшему
/// массиву после него; сами служебные записи в выдачу не попадают.
fn with_array_info<'d>(
    def: &'d StructDef,
) -> impl Iterator<Item = (&'d Entry, Option<&'d Entry>)> + 'd {
    def.entries
        .iter()
        .scan(None::<&'d Entry>, |pending, entry| {
            if entry.name == ARRAYINFO {
                *pending = Some(entry);
                return Some(None);
            }
            let info = if entry.dtype == T_ARRAY { pending.take() } else { None };
            Some(Some((entry, info)))
        })
        .flatten()
}

/// Обход узлов: тело файла читается один раз, каждый адрес даёт один узел.
struct Walker<'a> {
    body: Body<'a>,
    schema: &'a Schema,
    blocks: &'a [BlockRec],
    nodes: Vec<Node>,
    origins: Vec<Option<usize>>,
    known: HashMap<Spot, NodeId>,
}

impl<'a> Walker<'a> {
    fn new(res: &'a Resource, schema: &'a Schema, blocks: &'a [BlockRec]) -> Self {
        Walker {
            body: Body(res.data()),
            schema,
            blocks,
            nodes: Vec::new(),
            origins: Vec::new(),
            known: HashMap::new(),
        }
    }

    /// Читатель для типа поля, за которым надо идти; остальные поля остаются байтами.
    fn reader(dtype: u8) -> Option<Reader<'a>> {
        let table: [(u8, Reader<'a>); 3] = [
            (T_STRUCTURE_POINTER, Self::pointer_field),
            (T_ARRAY, Self::array_field),
            (T_STRUCTURE, Self::inline_field),
        ];
        table
            .into_iter()
            .find(|&(known, _)| known == dtype)
            .map(|(_, read)| read)
    }

    /// Указатель файла → адрес узла. Ноль в номере блока — пустой указатель.
    fn resolve(&self, pointer: u64) -> Result<Option<Spot>> {
        let Some(block) = ((pointer & 0xFFF) as usize).checked_sub(1) else {
            return Ok(None);
        };
        let rec = self
            .blocks
            .get(block)
            .ok_or_else(|| Error::broken(refusal::NO_BLOCK))?;
        let offset = pointer >> 12;
        if offset > rec.len as u64 {
            return Err(Error::broken(refusal::PAST_BLOCK));
        }
        Ok(Some(Spot { block, offset: offset as usize }))
    }

    fn origin(&self, spot: Spot) -> usize {
        self.blocks[spot.block].start + spot.offset
    }

    fn enter(&mut self, spot: Spot, bytes: Vec<u8>) -> NodeId {
        let id = self.nodes.len();
        self.nodes.push(Node {
            block: self.blocks[spot.block].name,
            bytes,
            links: Vec::new(),
        });
        self.origins.push(Some(self.origin(spot)));
        self.known.insert(spot, id);
        id
    }

    /// Обнуляет указатель в байтах узла и записывает ссылку вместо него.
    fn attach(&mut self, node: NodeId, at: usize, target: Option<NodeId>) -> Result<()> {
        let owner = &mut self.nodes[node];
        let slot = at
            .checked_add(8)
            .and_then(|end| owner.bytes.get_mut(at..end))
            .ok_or_else(|| Error::broken(refusal::FIELD_PLACE))?;
        slot.fill(0);
        owner.links.push(Link { at, target });
        Ok(())
    }

    fn target_of(&mut self, pointer: u64) -> Result<Option<NodeId>> {
        match self.resolve(pointer)? {
            Some(spot) => self.struct_at(spot).map(Some),
            None => Ok(None),
        }
    }

    fn struct_at(&mut self, spot: Spot) -> Result<NodeId> {
        if let Some(&id) = self.known.get(&spot) {
            return Ok(id);
        }
        let schema = self.schema;
        let def = schema
            .struct_named(self.blocks[spot.block].name)
            .ok_or_else(|| Error::argument(refusal::UNDESCRIBED))?;
        let origin = self.origin(spot);
        let bytes = self.body.window(origin, def.size as usize)?.to_vec();
        let node = self.enter(spot, bytes);
        self.fill(def, Place { node, base: origin, rel: 0 })?;
        Ok(node)
    }

    /// Обходит поля структуры, лежащей в теле с адреса `place.base` и в узле со смещения `place.rel`.
    fn fill(&mut self, def: &'a StructDef, place: Place) -> Result<()> {
        for (entry, info) in with_array_info(def) {
            // Идти по полю нужно только за указателем, массивом и вложенной структурой; остальные остаются байтами.
            let Some(follow) = Self::reader(entry.dtype) else { continue };
            let shift = usize::try_from(entry.offset).map_err(|_| Error::broken(refusal::NEGATIVE_OFFSET))?;
            let (Some(addr), Some(rel)) = (place.base.checked_add(shift), place.rel.checked_add(shift)) else {
                return Err(Error::broken(refusal::FIELD_PLACE));
            };
            follow(self, &Field { place, entry, info, addr, rel })?;
        }
        Ok(())
    }

    fn pointer_field(&mut self, field: &Field<'a>) -> Result<()> {
        let target = self.target_of(self.body.wide(field.addr)?)?;
        self.attach(field.place.node, field.rel, target)
    }

    fn array_field(&mut self, field: &Field<'a>) -> Result<()> {
        let kind = field
            .info
            .ok_or_else(|| Error::argument(refusal::NO_ELEMENTS))?;
        let count = usize::from(self.body.short(field.addr + 8)?);
        let pointer = self.body.wide(field.addr)?;
        let target = if count == 0 {
            None
        } else {
            self.array_at(kind, pointer, count)?
        };
        self.attach(field.place.node, field.rel, target)
    }

    fn inline_field(&mut self, field: &Field<'a>) -> Result<()> {
        let schema = self.schema;
        let inner = schema
            .struct_ref(field.entry.ref_key)
            .ok_or_else(|| Error::argument(refusal::INLINE_UNKNOWN))?;
        let place = Place { node: field.place.node, base: field.addr, rel: field.rel };
        self.fill(inner, place)
    }

    fn array_at(&mut self, kind: &Entry, pointer: u64, count: usize) -> Result<Option<NodeId>> {
        let Some(spot) = self.resolve(pointer)? else {
            return Ok(None);
        };
        if let Some(&id) = self.known.get(&spot) {
            return Ok(Some(id));
        }
        let origin = self.origin(spot);
        let node = match items_of(kind)? {
            Items::Pointers => self.pointer_array(spot, origin, count)?,
            Items::Records => self.record_array(kind, spot, origin, count)?,
            Items::Plain(width) => {
                let bytes = self.body.window(origin, count * width)?.to_vec();
                self.enter(spot, bytes)
            }
        };
        Ok(Some(node))
    }

    /// Массив указателей: узел из нулей, по ссылке на слот.
    fn pointer_array(&mut self, spot: Spot, origin: usize, count: usize) -> Result<NodeId> {
        self.body.window(origin, count * 8)?;
        let node = self.enter(spot, vec![0; count * 8]);
        for slot in 0..count {
            let target = self.target_of(self.body.wide(origin + slot * 8)?)?;
            self.nodes[node].links.push(Link { at: slot * 8, target });
        }
        Ok(node)
    }

    /// Массив структур: байты одним куском, поля каждого элемента обходятся отдельно.
    fn record_array(
        &mut self,
        kind: &Entry,
        spot: Spot,
        origin: usize,
        count: usize,
    ) -> Result<NodeId> {
        let schema = self.schema;
        let def = schema
            .struct_ref(kind.ref_key)
            .ok_or_else(|| Error::argument(refusal::ELEMENT_UNKNOWN))?;
        let width = def.size as usize;
        let bytes = self.body.window(origin, count * width)?.to_vec();
        let node = self.enter(spot, bytes);
        (0..count).try_for_each(|slot| {
            let place = Place { node, base: origin + slot * width, rel: slot * width };
            self.fill(def, place)
        })?;
        Ok(node)
    }
}

/// Разбирает файл метаданных в схему и граф узлов.
pub fn read(bytes: &[u8]) -> Result<Read> {
    let res = Resource::parse(bytes)?;
    let Directory { schema, blocks, root_block } = read_directory(&res)?;
    let (string_block, strings, later_strings) = string_table(&res, &blocks);

    let mut walker = Walker::new(&res, &schema, &blocks);
    walker.struct_at(Spot { block: root_block, offset: 0 })?;
    let Walker { nodes, origins, .. } = walker;

    Ok(Read {
        schema,
        graph: Graph { nodes, root: 0 },
        strings,
        string_block,
        later_strings,
        origins,
    })
}

// ---------------------------------------------------------------------------
// Ссылки между структурами и слияние схем
// ---------------------------------------------------------------------------

impl Schema {
    /// Ссылка из записи поля: ключ сильнее имени.
    pub fn struct_ref(&self, reference: u32) -> Option<&StructDef> {
        let lookups: [fn(&Schema, u32) -> Option<&StructDef>; 2] =
            [Schema::struct_keyed, Schema::struct_named];
        lookups.iter().find_map(|look| look(self, reference))
    }

    pub fn enum_ref(&self, reference: u32) -> Option<&EnumDef> {
        let lookups: [fn(&Schema, u32) -> Option<&EnumDef>; 2] =
            [Schema::enum_keyed, Schema::enum_named];
        lookups.iter().find_map(|look| look(self, reference))
    }

    /// Дополняет схему чужими описаниями: структуры сверяются по имени, перечисления по ключу;
    /// повторы внутри добавляемой схемы тоже отсекаются.
    pub fn merge(&mut self, other: &Schema) {
        let mut names: HashSet<u32> = self.structs.iter().map(|def| def.name).collect();
        self.structs
            .extend(other.structs.iter().filter(|def| names.insert(def.name)).cloned());
        let mut keys: HashSet<u32> = self.enums.iter().map(|def| def.key).collect();
        self.enums
            .extend(other.enums.iter().filter(|def| keys.insert(def.key)).cloned());
    }
}

// ---------------------------------------------------------------------------
// Запись: порядок узлов, блоки
// ---------------------------------------------------------------------------

/// Порядок записи: корень, затем остальные узлы так, что потомки идут раньше предка.
fn write_order(graph: &Graph) -> Vec<NodeId> {
    let mut seen = vec![false; graph.nodes.len()];
    seen[graph.root] = true;
    let mut order = vec![graph.root];
    // Узлы, у которых ещё есть непосмотренные ссылки, и номер следующей из них.
    let mut open = vec![(graph.root, 0usize)];
    while let Some(frame) = open.last_mut() {
        let (at, cursor) = *frame;
        frame.1 += 1;
        match graph.nodes[at].links.get(cursor) {
            None => {
                open.pop();
                if at != graph.root {
                    order.push(at);
                }
            }
            Some(link) => {
                if let Some(target) = link.target {
                    if !seen[target] {
                        seen[target] = true;
                        open.push((target, 0));
                    }
                }
            }
        }
    }
    order
}

/// Блок будущего файла: имя и длина вместе с выравниванием.
struct Slab {
    name: u32,
    len: usize,
}

impl Slab {
    /// Занимает место под узел из `size` байт и возвращает его смещение в блоке.
    fn take(&mut self, size: usize) -> usize {
        let at = self.len;
        let end = at + size;
        // Блок строк — единственный без выравнивания.
        self.len = match self.name {
            STRING_BLOCK => end,
            _ => end.next_multiple_of(body_map::ALIGN),
        };
        at
    }
}

/// Номер блока и смещение размещённого узла.
#[derive(Clone, Copy)]
struct Placement {
    block: usize,
    inside: usize,
}

/// Указатель на узел: номер блока с единицы в 12 младших битах (лишнее отбрасывается), выше смещение.
fn encode_pointer(block: usize, inside: usize) -> u64 {
    ((block as u64 + 1) & 0xFFF) | ((inside as u64) << 12)
}

/// Куда легли узлы: блоки и место каждого узла (`None` — узел не достижим из корня).
struct Arrangement {
    slabs: Vec<Slab>,
    placed: Vec<Option<Placement>>,
}

impl Arrangement {
    fn pointer_to(&self, id: NodeId) -> Result<u64> {
        self.placed[id]
            .map(|spot| encode_pointer(spot.block, spot.inside))
            .ok_or_else(|| Error::broken("Ссылка на узел вне файла."))
    }

    fn placed_nodes(&self) -> impl Iterator<Item = (NodeId, Placement)> + '_ {
        self.placed
            .iter()
            .enumerate()
            .filter_map(|(id, spot)| spot.map(|spot| (id, spot)))
    }
}

/// Раскладывает узлы по блокам. Корень всегда в собственном новом блоке; остальные идут в
/// последний блок своего имени, пока тот короче мягкого предела.
fn arrange(graph: &Graph, order: &[NodeId]) -> Arrangement {
    let mut slabs: Vec<Slab> = Vec::new();
    let mut latest: HashMap<u32, usize> = HashMap::new();
    let mut placed = vec![None; graph.nodes.len()];
    for (rank, &id) in order.iter().enumerate() {
        let node = &graph.nodes[id];
        let block = match latest.get(&node.block) {
            Some(&open) if slabs[open].len < body_map::SOFT_LIMIT => open,
            _ => {
                slabs.push(Slab { name: node.block, len: 0 });
                slabs.len() - 1
            }
        };
        if rank > 0 {
            latest.insert(node.block, block);
        }
        let inside = slabs[block].take(node.bytes.len());
        placed[id] = Some(Placement { block, inside });
    }
    Arrangement { slabs, placed }
}

// ---------------------------------------------------------------------------
// Запись: какие структуры и перечисления попадут в файл
// ---------------------------------------------------------------------------

/// Тип записи схемы «перечисление».
const ENUM_FIELD: u8 = 0x62;

/// Что попадёт в таблицы схемы: структуры в порядке записи и перечисления без повторов по ключу.
struct Picked<'s> {
    schema: &'s Schema,
    defs: Vec<&'s StructDef>,
    enums: Vec<&'s EnumDef>,
}

impl<'s> Picked<'s> {
    fn new(schema: &'s Schema) -> Self {
        Picked { schema, defs: Vec::new(), enums: Vec::new() }
    }

    /// Вложенная структура записи: по типу 0x05, ссылка по ключу или имени.
    fn nested(&self, entry: &Entry) -> Option<&'s StructDef> {
        let schema = self.schema;
        (entry.dtype == T_STRUCTURE)
            .then(|| schema.struct_ref(entry.ref_key))
            .flatten()
    }

    fn take_enum(&mut self, entry: &Entry) {
        let schema = self.schema;
        let found = (entry.dtype == ENUM_FIELD)
            .then(|| schema.enum_ref(entry.ref_key))
            .flatten();
        if let Some(def) = found {
            if self.enums.iter().all(|taken| taken.key != def.key) {
                self.enums.push(def);
            }
        }
    }

    /// Берёт структуру, если структуры с таким именем ещё нет.
    fn admit(&mut self, def: &'s StructDef) -> bool {
        let fresh = self.defs.iter().all(|taken| taken.name != def.name);
        if fresh {
            self.defs.push(def);
        }
        fresh
    }

    /// Структура вместе с вложенными и перечислениями из их записей; вложенная сразу за хозяйкой.
    fn take_family(&mut self, top: &'s StructDef) {
        if !self.admit(top) {
            return;
        }
        let mut path: Vec<(&'s StructDef, usize)> = vec![(top, 0)];
        while let Some(frame) = path.last_mut() {
            let (def, index) = *frame;
            frame.1 += 1;
            let Some(entry) = def.entries.get(index) else {
                path.pop();
                continue;
            };
            self.take_enum(entry);
            if let Some(inner) = self.nested(entry) {
                if self.admit(inner) {
                    path.push((inner, 0));
                }
            }
        }
    }
}

fn pick_schema<'s>(
    schema: &'s Schema,
    slabs: &[Slab],
    wanted: Option<&[u32]>,
) -> Result<Picked<'s>> {
    let mut picked = Picked::new(schema);
    match wanted {
        None => slabs
            .iter()
            .filter_map(|slab| schema.struct_named(slab.name))
            .for_each(|def| picked.take_family(def)),
        Some(names) => {
            picked.defs = names
                .iter()
                .map(|&name| {
                    schema
                        .struct_named(name)
                        .ok_or_else(|| Error::argument("Структура не описана в схеме."))
                })
                .collect::<Result<_>>()?;
            // Перечисления только из собственных записей перечисленных структур.
            let entries: Vec<&Entry> = picked.defs.iter().flat_map(|def| &def.entries).collect();
            entries.into_iter().for_each(|entry| picked.take_enum(entry));
        }
    }
    Ok(picked)
}

/// Граф годится для записи: есть корень, ссылки ведут в узлы графа и лежат внутри байт своего узла.
fn check_graph(graph: &Graph) -> Result<()> {
    if graph.nodes.is_empty() {
        return Err(Error::argument(refusal::EMPTY_GRAPH));
    }
    if graph.root >= graph.nodes.len() {
        return Err(Error::argument(refusal::ROOT_OUTSIDE));
    }
    for node in &graph.nodes {
        for link in &node.links {
            if link.target.is_some_and(|target| target >= graph.nodes.len()) {
                return Err(Error::broken(refusal::LINK_TARGET));
            }
            if link.at.checked_add(8).is_none_or(|end| end > node.bytes.len()) {
                return Err(Error::broken(refusal::LINK_PLACE));
            }
        }
    }
    Ok(())
}

/// Счётчики структур, перечислений, блоков и полей в файле занимают по два байта, а номер блока в указателе — 12
/// бит (с единицей): больше не помещается, и такой граф не пишется молча с обрезанными числами.
fn check_table_limits(picked: &Picked<'_>, blocks: usize) -> Result<()> {
    let fits16 = |count: usize| u16::try_from(count).is_ok();
    if !fits16(picked.defs.len()) {
        return Err(Error::argument(refusal::TOO_MANY_STRUCTS));
    }
    if !fits16(picked.enums.len()) {
        return Err(Error::argument(refusal::TOO_MANY_ENUMS));
    }
    if picked.defs.iter().any(|def| !fits16(def.entries.len())) {
        return Err(Error::argument(refusal::TOO_MANY_FIELDS));
    }
    if blocks > body_map::MAX_BLOCKS {
        return Err(Error::argument(refusal::TOO_MANY_BLOCKS));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Запись: страница
// ---------------------------------------------------------------------------

/// Начала областей тела: таблицы идут подряд с `TABLES_AT`, за ними данные блоков.
struct Areas {
    structs: usize,
    entries: usize,
    enums: usize,
    values: usize,
    blocks: usize,
    data: usize,
    end: usize,
}

/// Место под значения одного перечисления: по 8 байт, округлённое до 16.
fn value_room(def: &EnumDef) -> usize {
    (def.values.len() * body_map::VALUE_ROW).next_multiple_of(body_map::ALIGN)
}

impl Areas {
    fn plan(picked: &Picked<'_>, slabs: &[Slab]) -> Self {
        use body_map::*;
        let mut cursor = TABLES_AT;
        let mut carve = |len: usize| {
            let start = cursor;
            cursor += len;
            start
        };
        let entry_total: usize = picked.defs.iter().map(|def| def.entries.len()).sum();
        let structs = carve(picked.defs.len() * STRUCT_ROW);
        let entries = carve(entry_total * ENTRY_ROW);
        let enums = carve((picked.enums.len() * ENUM_ROW).next_multiple_of(ALIGN));
        let values = carve(picked.enums.iter().map(|def| value_room(def)).sum());
        let blocks = carve(slabs.len() * BLOCK_ROW);
        let data = carve(slabs.iter().map(|slab| slab.len).sum());
        Areas { structs, entries, enums, values, blocks, data, end: cursor }
    }
}

fn address(offset: usize) -> u64 {
    SYSTEM_BASE + offset as u64
}

/// Тело-страница. Числа кладутся по смещению; выход за страницу — паника среза.
struct Page(Vec<u8>);

impl Page {
    /// Кладёт младшие `width` байт `value` по смещению `at`.
    fn put(&mut self, at: usize, width: usize, value: u64) {
        self.0[at..at + width].copy_from_slice(&value.to_le_bytes()[..width]);
    }

    /// Раскладывает строку таблицы: (смещение от начала, ширина, значение), по порядку.
    fn stamp(&mut self, base: usize, fields: &[(usize, usize, u64)]) {
        for &(delta, width, value) in fields {
            self.put(base + delta, width, value);
        }
    }

    fn lay_header(&mut self, areas: &Areas, picked: &Picked<'_>, block_count: usize) {
        use body_map::*;
        self.stamp(
            0,
            &[
                (0x00, 4, LEAD_WORD),
                (0x04, 4, 1),
                (0x08, 8, address(RESERVED_AT)),
                (0x10, 4, FORMAT_WORD),
                (0x14, 2, 0x0079),
                (ROOT_NUMBER, 4, 1),
                (STRUCT_TABLE, 8, address(areas.structs)),
                (ENUM_TABLE, 8, address(areas.enums)),
                (BLOCK_TABLE, 8, address(areas.blocks)),
                (STRUCT_COUNT, 2, picked.defs.len() as u64),
                (ENUM_COUNT, 2, picked.enums.len() as u64),
                (BLOCK_COUNT, 2, block_count as u64),
                (RESERVED_AT + 8, 1, 1),
            ],
        );
    }

    fn lay_structs(&mut self, picked: &Picked<'_>, areas: &Areas) {
        let mut entry_at = areas.entries;
        for (i, def) in picked.defs.iter().enumerate() {
            self.stamp(
                areas.structs + i * body_map::STRUCT_ROW,
                &[
                    (0, 4, u64::from(def.name)),
                    (4, 4, u64::from(def.key)),
                    (8, 4, u64::from(def.unk8)),
                    (16, 8, address(entry_at)),
                    (24, 4, u64::from(def.size)),
                    (30, 2, def.entries.len() as u64),
                ],
            );
            for entry in &def.entries {
                self.stamp(
                    entry_at,
                    &[
                        (0, 4, u64::from(entry.name)),
                        (4, 4, u64::from(entry.offset as u32)),
                        (8, 1, u64::from(entry.dtype)),
                        (9, 1, u64::from(entry.unk9)),
                        (10, 2, u64::from(entry.ref_index as u16)),
                        (12, 4, u64::from(entry.ref_key)),
                    ],
                );
                entry_at += body_map::ENTRY_ROW;
            }
        }
    }

    fn lay_enums(&mut self, picked: &Picked<'_>, areas: &Areas) {
        let mut value_at = areas.values;
        for (i, def) in picked.enums.iter().enumerate() {
            // `unk12` ложится поверх старшей половины адреса значений, как в старой записи.
            self.stamp(
                areas.enums + i * body_map::ENUM_ROW,
                &[
                    (0, 4, u64::from(def.name)),
                    (4, 4, u64::from(def.key)),
                    (8, 8, address(value_at)),
                    (12, 4, u64::from(def.unk12)),
                    (16, 4, def.values.len() as u64),
                ],
            );
            for (j, &(name, value)) in def.values.iter().enumerate() {
                self.stamp(
                    value_at + j * body_map::VALUE_ROW,
                    &[(0, 4, u64::from(name)), (4, 4, u64::from(value as u32))],
                );
            }
            value_at += value_room(def);
        }
    }

    /// Таблица блоков; возвращает начало данных каждого блока.
    fn lay_blocks(&mut self, slabs: &[Slab], areas: &Areas) -> Vec<usize> {
        let mut starts = Vec::with_capacity(slabs.len());
        let mut data_at = areas.data;
        for (i, slab) in slabs.iter().enumerate() {
            self.stamp(
                areas.blocks + i * body_map::BLOCK_ROW,
                &[
                    (0, 4, u64::from(slab.name)),
                    (4, 4, slab.len as u64),
                    (8, 8, address(data_at)),
                ],
            );
            starts.push(data_at);
            data_at += slab.len;
        }
        starts
    }
}

/// Сжимает тело файла в сырой deflate уровня 9 (libdeflate): выход детерминирован, его ждёт хост.
pub fn deflate_body(system: &[u8]) -> Vec<u8> {
    let mut packer = Compressor::new(CompressionLvl::new(9).unwrap_or_default());
    let mut packed = vec![0u8; packer.deflate_compress_bound(system.len())];
    let used = packer.deflate_compress(system, &mut packed).unwrap_or(0);
    packed.truncate(used);
    packed
}

/// Записывает схему и граф файлом RSC7.
pub fn write(schema: &Schema, graph: &Graph) -> Result<Vec<u8>> {
    write_with_structs(schema, graph, None)
}

/// То же, но набор структур в файле задан именами (`StructDef.name`); `None` — по блокам графа.
pub fn write_with_structs(
    schema: &Schema,
    graph: &Graph,
    structs_named: Option<&[u32]>,
) -> Result<Vec<u8>> {
    check_graph(graph)?;
    let layout = arrange(graph, &write_order(graph));
    let picked = pick_schema(schema, &layout.slabs, structs_named)?;
    check_table_limits(&picked, layout.slabs.len())?;
    let areas = Areas::plan(&picked, &layout.slabs);
    let page_size = areas.end.max(body_map::MIN_PAGE).next_power_of_two();

    let mut page = Page(vec![0u8; page_size]);
    page.lay_header(&areas, &picked, layout.slabs.len());
    page.lay_structs(&picked, &areas);
    page.lay_enums(&picked, &areas);
    let starts = page.lay_blocks(&layout.slabs, &areas);

    for (id, spot) in layout.placed_nodes() {
        let at = starts[spot.block] + spot.inside;
        let bytes = &graph.nodes[id].bytes;
        page.0[at..at + bytes.len()].copy_from_slice(bytes);
    }
    // Указатели пишутся после данных и могут перекрыть соседние байты.
    for (id, spot) in layout.placed_nodes() {
        for link in &graph.nodes[id].links {
            let value = match link.target {
                Some(target) => layout.pointer_to(target)?,
                None => 0,
            };
            page.put(starts[spot.block] + spot.inside + link.at, 8, value);
        }
    }

    let shift = page_size.trailing_zeros() - 9;
    let mut file: Vec<u8> = [RSC7_MAGIC, 2, 0x0800_0000 | shift, 0x2000_0000]
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect();
    debug_assert_eq!(file.len(), HEADER_BYTES);
    file.extend(deflate_body(&page.0));
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::{joaat_case, sha256_hex};
    use crate::resource::read_header;
    use crate::ymap_write::meta_name;
    use crate::ytyp_write::{base_types, BaseArchetype};

    const T_U32: u8 = 0x15;
    const T_ENUM: u8 = 0x62;

    fn name(text: &str) -> u32 {
        joaat_case(text)
    }

    fn def(text: &str, size: u32, entries: Vec<Entry>) -> StructDef {
        StructDef { name: name(text), key: name(&format!("{text}#key")), unk8: 0, size, entries }
    }

    fn field(text: &str, offset: i32, dtype: u8, ref_key: u32) -> Entry {
        Entry { name: name(text), offset, dtype, unk9: 0, ref_index: -1, ref_key }
    }

    fn info(dtype: u8, ref_key: u32) -> Entry {
        Entry { name: ARRAYINFO, offset: 0, dtype, unk9: 0, ref_index: -1, ref_key }
    }

    fn node(block: u32, bytes: Vec<u8>, links: Vec<Link>) -> Node {
        Node { block, bytes, links }
    }

    fn link(at: usize, target: Option<usize>) -> Link {
        Link { at, target }
    }

    fn put(bytes: &mut [u8], at: usize, raw: &[u8]) {
        bytes[at..at + raw.len()].copy_from_slice(raw);
    }

    /// «Игрушка» из описания: корень, два `Item`, массив указателей, числа, два `Pair`.
    fn toy() -> (Schema, Graph) {
        let item = def("Item", 16, vec![field("value", 0, T_U32, 0), field("child", 8, 7, name("Item"))]);
        let pair = def("Pair", 8, vec![field("a", 0, T_U32, 0), field("b", 4, T_U32, 0)]);
        let root = def(
            "Root",
            64,
            vec![
                field("id", 0, T_U32, 0),
                field("ptr", 8, 7, name("Item")),
                info(7, name("Item")),
                field("items", 16, T_ARRAY, 0),
                info(T_U32, 0),
                field("nums", 32, T_ARRAY, 0),
                info(T_STRUCTURE, name("Pair")),
                field("pairs", 48, T_ARRAY, 0),
            ],
        );
        let schema = Schema { structs: vec![root, item, pair], enums: vec![] };

        let mut root_bytes = vec![0u8; 64];
        put(&mut root_bytes, 0, &0xAABBu32.to_le_bytes());
        // Счётчики трёх массивов лежат на +8 от их полей.
        put(&mut root_bytes, 24, &[2, 0]);
        put(&mut root_bytes, 40, &[3, 0]);
        put(&mut root_bytes, 56, &[2, 0]);
        let mut graph = Graph::default();
        let root_id = graph.push(node(name("Root"), root_bytes, vec![]));
        let first = graph.push(node(name("Item"), [vec![1u8, 0, 0, 0], vec![0; 12]].concat(), vec![]));
        let second = graph.push(node(name("Item"), [vec![2u8, 0, 0, 0], vec![0; 12]].concat(), vec![]));
        graph.nodes[first].links.push(link(8, Some(second)));
        let pointers = graph.push(node(
            POINTER_BLOCK,
            vec![0; 16],
            vec![link(0, Some(first)), link(8, Some(second))],
        ));
        let nums: Vec<u8> = [10u32, 20, 30].iter().flat_map(|v| v.to_le_bytes()).collect();
        let nums = graph.push(node(name("U32Block"), nums, vec![]));
        let pairs: Vec<u8> = [1u32, 2, 3, 4].iter().flat_map(|v| v.to_le_bytes()).collect();
        let pairs = graph.push(node(name("Pair"), pairs, vec![]));
        graph.nodes[root_id].links = vec![
            link(8, Some(second)),
            link(16, Some(pointers)),
            link(32, Some(nums)),
            link(48, Some(pairs)),
        ];
        (schema, graph)
    }

    fn system_block(file: &[u8]) -> Vec<u8> {
        Resource::parse(file).unwrap().data().to_vec()
    }

    #[test]
    fn a_base_types_file_rewrites_to_the_same_system_block() {
        let archetypes: Vec<BaseArchetype> = (0..3)
            .map(|i| {
                let mut a = BaseArchetype::with_defaults(&format!("a{i}"), &format!("a{i}_asset"));
                a.lod_dist = 100.0 + i as f32;
                a.bb_min = [-1.0, -2.0, -3.0 - i as f32];
                a
            })
            .collect();
        let original = base_types(meta_name("t"), &archetypes).unwrap();
        let read = read(&original).unwrap();
        let rewritten = write(&read.schema, &read.graph).unwrap();
        let (before, after) = (system_block(&original), system_block(&rewritten));
        let first_diff = before.iter().zip(&after).position(|(a, b)| a != b);
        assert_eq!(before.len(), after.len());
        assert_eq!(first_diff, None, "первое отличие системного блока");
    }

    #[test]
    fn a_base_types_file_reads_back_as_the_same_graph() {
        let archetype = BaseArchetype::with_defaults("only", "only_asset");
        let original = base_types(meta_name("t"), &[archetype]).unwrap();
        let first = read(&original).unwrap();
        let second = read(&write(&first.schema, &first.graph).unwrap()).unwrap();
        assert_eq!(
            canonical(&first.graph, first.graph.root),
            canonical(&second.graph, second.graph.root)
        );
    }

    #[test]
    fn toy_file_has_the_documented_shape_and_roundtrips() {
        let (schema, graph) = toy();
        let file = write(&schema, &graph).unwrap();
        assert_eq!(file.len(), 326);
        assert_eq!(
            sha256_hex(&file),
            "8f4778c8ec3d7968207eebae7eb7bfac5efe1350551386a39e09e7c00e56556c"
        );
        assert_eq!(file[..16], [0x52, 0x53, 0x43, 0x37, 2, 0, 0, 0, 4, 0, 0, 8, 0, 0, 0, 0x20]);
        let header = read_header(&file).unwrap();
        assert_eq!((header.system_size, header.graphics_size), (8192, 0));

        let back = read(&file).unwrap();
        assert_eq!(back.graph.nodes.len(), 6);
        let names: Vec<u32> = back.schema.structs.iter().map(|d| d.name).collect();
        assert_eq!(names, [name("Root"), name("Pair"), name("Item")]);
        assert_eq!(write(&back.schema, &back.graph).unwrap(), file);
        assert_eq!(read(&write(&back.schema, &back.graph).unwrap()).unwrap(), back);
    }

    #[test]
    fn deflate_matches_the_reference_vectors() {
        assert_eq!(deflate_body(&[]), [0x01, 0x00, 0x00, 0xff, 0xff]);
        assert_eq!(deflate_body(b"abc"), [0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63]);
        assert_eq!(deflate_body(&[0u8; 100]), [0x63, 0xa0, 0x03, 0x00, 0x00]);
        let pattern: Vec<u8> = (0..8192u32).map(|i| (i * 7 + 3) as u8).collect();
        let packed = deflate_body(&pattern);
        assert_eq!(packed.len(), 339);
        assert_eq!(miniz_oxide::inflate::decompress_to_vec(&packed).unwrap(), pattern);
    }

    #[test]
    fn schema_lookups_prefer_the_key_for_references() {
        let tag = |name, key| StructDef { name, key, unk8: 0, size: 0, entries: vec![] };
        let schema = Schema {
            structs: vec![tag(10, 20), tag(20, 30), tag(10, 40)],
            enums: vec![],
        };
        assert_eq!(schema.struct_named(10).map(|d| d.key), Some(20));
        assert_eq!(schema.struct_ref(20).map(|d| d.name), Some(10));
        assert_eq!(schema.struct_ref(30).map(|d| d.name), Some(20));
        assert!(schema.struct_ref(99).is_none());

        let mut base = Schema { structs: vec![tag(1, 11), tag(2, 12)], enums: vec![] };
        let extra = Schema { structs: vec![tag(2, 99), tag(3, 13), tag(3, 14)], enums: vec![] };
        base.merge(&extra);
        let keys: Vec<u32> = base.structs.iter().map(|d| d.key).collect();
        assert_eq!(keys, [11, 12, 13]);
    }

    #[test]
    fn copy_node_shares_descendants_through_the_memo() {
        let mut src = Graph::default();
        let c = src.push(node(0xc0, vec![0], vec![]));
        let a = src.push(node(0xa0, vec![1], vec![link(0, Some(c))]));
        let b = src.push(node(0xb0, vec![2], vec![link(0, Some(c)), link(8, None)]));
        let r = src.push(node(0x50, vec![3], vec![link(0, Some(a)), link(8, Some(b))]));
        let mut dst = Graph::default();
        let mut memo = HashMap::new();
        assert_eq!(copy_node(&mut dst, &src, r, &mut memo), 0);
        assert_eq!(dst.nodes.len(), 4);
        assert_eq!(memo[&c], 2);
        assert_eq!(canonical(&dst, 0), canonical(&src, r));
        // Повторное копирование того же узла даёт новую копию, потомки берутся из памяти.
        assert_eq!(copy_node(&mut dst, &src, a, &mut memo), 4);
        assert_eq!(dst.nodes[4].links[0].target, Some(2));
    }

    #[test]
    fn canonical_expands_shared_nodes_each_time() {
        let mut g = Graph::default();
        let leaf = g.push(node(0x10, vec![0xab, 0xcd], vec![]));
        let mid = g.push(node(0xdeadbeef, vec![1; 16], vec![link(0, Some(leaf)), link(8, None)]));
        assert_eq!(canonical(&g, leaf), "00000010(abcd)");
        assert_eq!(
            canonical(&g, mid),
            "deadbeef(01010101010101010101010101010101)[0:00000010(abcd)][8:0]"
        );
    }

    #[test]
    fn string_table_is_split_and_addressed_by_pointer() {
        let schema = Schema { structs: vec![def("Root", 16, vec![])], enums: vec![] };
        let mut g = Graph::default();
        let root = g.push(node(name("Root"), vec![0; 16], vec![]));
        let text = g.push(node(STRING_BLOCK, b"alpha\0beta\0\0gam\xffma\0tail".to_vec(), vec![]));
        g.nodes[root].links.push(link(0, Some(text)));
        let read = read(&write(&schema, &g).unwrap()).unwrap();
        assert_eq!(read.strings(), ["alpha", "beta", "tail"]);
        let at = |offset: u64| read.string_at(2 | (offset << 12));
        assert_eq!(at(0).as_deref(), Some("alpha"));
        assert_eq!(at(2).as_deref(), Some("pha"));
        assert_eq!(at(12), None);
        assert_eq!(at(23).as_deref(), Some(""));
        assert_eq!(at(24), None);
        assert_eq!(read.string_at(0), None);
        assert_eq!(read.string_at(1), None);
    }

    #[test]
    fn blocks_are_split_at_the_soft_limit() {
        let schema = Schema { structs: vec![], enums: vec![] };
        let mut g = Graph::default();
        let root = g.push(node(0xaa, vec![0; 16], vec![]));
        for i in 0..5 {
            let child = g.push(node(0xbb, vec![i as u8; 0x1800], vec![]));
            g.nodes[root].links.push(link(0, Some(child)));
        }
        let layout = arrange(&g, &write_order(&g));
        let lens: Vec<usize> = layout.slabs.iter().map(|s| s.len).collect();
        assert_eq!(lens, [0x10, 0x4800, 0x3000]);
        assert!(write(&schema, &g).is_ok());
    }

    #[test]
    fn enum_count_larger_than_the_body_is_refused_without_reserving_memory() {
        let schema = Schema {
            structs: vec![def("S", 8, vec![field("e", 0, T_ENUM, name("eA"))])],
            enums: vec![EnumDef { name: name("eA"), key: name("eA"), unk12: 0, values: vec![(1, 1), (2, 2)] }],
        };
        let graph = Graph { nodes: vec![node(name("S"), vec![0; 8], vec![])], root: 0 };
        let mut res = Resource::parse(&write(&schema, &graph).unwrap()).unwrap();
        let table = res.at(res.u64(0x28).unwrap()).unwrap();
        res.data_mut()[table + 16..table + 20].copy_from_slice(&u32::MAX.to_le_bytes());
        let broken = res.to_file_bytes().unwrap();
        let error = read(&broken).unwrap_err();
        assert_eq!(error.message, "Чтение за концом данных ресурса.");
    }

    // Три прогона ниже работают на файлах игры или выгрузках; без переменных среды сразу выходят.

    #[test]
    #[ignore]
    fn survey_bytes_of_effect_objects() {
        let Ok(folder) = std::env::var("YTYP_SURVEY") else { return };
        let particle = name("CExtensionDefParticleEffect");
        let mut pairs: HashMap<(u8, u8), usize> = HashMap::new();
        for entry in std::fs::read_dir(folder).unwrap().flatten() {
            let Ok(bytes) = std::fs::read(entry.path()) else { continue };
            let Ok(file) = read(&bytes) else { continue };
            for node in file.graph.nodes.iter().filter(|n| n.block == particle || n.bytes.len() > 58) {
                if node.bytes.len() > 58 {
                    *pairs.entry((node.bytes[48], node.bytes[58])).or_default() += 1;
                }
            }
        }
        println!("{pairs:?}");
    }

    #[test]
    #[ignore]
    fn dump_meta() {
        let Ok(path) = std::env::var("META_DUMP") else { return };
        let file = read(&std::fs::read(path).unwrap()).unwrap();
        for def in &file.schema.structs {
            println!("struct {:08x} key {:08x} size {}", def.name, def.key, def.size);
            for entry in &def.entries {
                println!("  {entry:?}");
            }
        }
        for def in &file.schema.enums {
            println!("enum {:08x} key {:08x} {:?}", def.name, def.key, def.values);
        }
        let words = std::env::var("META_WORDS").is_ok();
        for (id, node) in file.graph.nodes.iter().enumerate() {
            println!("node {id}: block {:08x} len {} links {}", node.block, node.bytes.len(), node.links.len());
            if words {
                let list: Vec<u32> = node
                    .bytes
                    .chunks(4)
                    .map(|c| c.iter().rev().fold(0u32, |acc, &b| acc << 8 | u32::from(b)))
                    .collect();
                println!("  {list:x?}");
            }
        }
    }

    #[test]
    #[ignore]
    fn roundtrip_game_file() {
        let Ok(path) = std::env::var("YTYP_ROUNDTRIP") else { return };
        let first = read(&std::fs::read(path).unwrap()).unwrap();
        let bytes = write(&first.schema, &first.graph).unwrap();
        let second = read(&bytes).unwrap();
        assert_eq!(
            canonical(&first.graph, first.graph.root),
            canonical(&second.graph, second.graph.root)
        );
        println!("узлов {} и {}, файл {} байт", first.graph.nodes.len(), second.graph.nodes.len(), bytes.len());
    }

    #[test]
    fn strings_that_spilled_past_the_first_string_block_are_read_back() {
        let schema = Schema { structs: vec![def("Root", 24, vec![])], enums: vec![] };
        let mut g = Graph::default();
        let root = g.push(node(name("Root"), vec![0; 24], vec![]));
        let long = |fill: u8| [vec![fill; 12_000], vec![0]].concat();
        let first = g.push(node(STRING_BLOCK, long(b'a'), vec![]));
        let second = g.push(node(STRING_BLOCK, long(b'b'), vec![]));
        let spilled = g.push(node(STRING_BLOCK, b"tail one late two ".to_vec(), vec![]));
        for (slot, target) in [first, second, spilled].into_iter().enumerate() {
            g.nodes[root].links.push(link(slot * 8, Some(target)));
        }
        let read = read(&write(&schema, &g).unwrap()).unwrap();
        let word = |slot: usize| u64::from_le_bytes(read.graph.nodes[0].bytes[slot * 8..slot * 8 + 8].try_into().unwrap());
        assert_eq!(read.string_at(word(0)).unwrap().len(), 12_000);
        assert_eq!(read.string_at(word(1)).unwrap().len(), 12_000);
        assert_eq!(read.string_at(word(2)).as_deref(), Some("tail one"));
        assert_eq!(read.strings().last().map(String::as_str), Some("late two"));
        assert_eq!(read.strings().len(), 4);
    }

    #[test]
    fn tables_that_do_not_fit_their_counters_are_refused() {
        let refused = |schema: &Schema, g: &Graph, named: Option<&[u32]>| write_with_structs(schema, g, named).unwrap_err().message;
        // Структуры: 65536 имён.
        let many = Schema { structs: (0..65_536u32).map(|i| def(&format!("S{i}"), 8, vec![])).collect(), enums: vec![] };
        let mut g = Graph::default();
        g.push(node(name("S0"), vec![0; 8], vec![]));
        let names: Vec<u32> = many.structs.iter().map(|d| d.name).collect();
        assert_eq!(refused(&many, &g, Some(&names)), "Структур в схеме больше 65535.");
        // Поля: 65536 записей в одной структуре.
        let entry = Entry { name: 1, offset: 0, dtype: 0x11, unk9: 0, ref_index: -1, ref_key: 0 };
        let wide = Schema { structs: vec![def("Wide", 8, vec![entry; 65_536])], enums: vec![] };
        let mut g = Graph::default();
        g.push(node(name("Wide"), vec![0; 8], vec![]));
        assert_eq!(refused(&wide, &g, None), "Полей в структуре больше 65535.");
        // Блоки: корень и столько детей с разными именами, чтобы блоков стало 4096.
        let schema = Schema { structs: vec![], enums: vec![] };
        let build = |children: usize| {
            let mut g = Graph::default();
            let root = g.push(node(0xaa, vec![0; 8 * children], vec![]));
            for i in 0..children {
                let child = g.push(node(0x1000 + i as u32, vec![1; 8], vec![]));
                g.nodes[root].links.push(link(i * 8, Some(child)));
            }
            g
        };
        assert_eq!(refused(&schema, &build(4095), None), "Блоков метаданных больше 4095.");
        // Последний допустимый граф пишется: у каждого блока свой ненулевой номер в указателе.
        let ok = write(&schema, &build(4094)).unwrap();
        assert!(ok.len() > 16);
    }

    #[test]
    fn a_graph_that_cannot_be_laid_out_is_refused_not_panicked_on() {
        let schema = Schema { structs: vec![def("Root", 16, vec![])], enums: vec![] };
        let message = |g: &Graph| write(&schema, g).unwrap_err().message;
        assert_eq!(message(&Graph::default()), "Граф метаданных пуст.");
        let mut g = Graph::default();
        g.push(node(name("Root"), vec![0; 16], vec![]));
        g.root = 3;
        assert_eq!(message(&g), "Корень графа вне узлов.");
        g.root = 0;
        g.nodes[0].links.push(link(0, Some(9)));
        assert_eq!(message(&g), "Ссылка на узел вне файла.");
        g.nodes[0].links[0] = link(12, None);
        assert_eq!(message(&g), "Ссылка за концом узла.");
        g.nodes[0].links[0] = link(usize::MAX - 3, None);
        assert_eq!(message(&g), "Ссылка за концом узла.");
        g.nodes[0].links[0] = link(8, None);
        assert!(write(&schema, &g).is_ok());
    }

    #[test]
    fn a_schema_whose_fields_do_not_fit_their_struct_is_refused_not_panicked_on() {
        let pointer = |offset: i32| Entry { name: name("p"), offset, dtype: T_STRUCTURE_POINTER, unk9: 0, ref_index: -1, ref_key: 0 };
        let read_with = |size: u32, entries: Vec<Entry>| {
            let schema = Schema { structs: vec![def("Root", size, entries)], enums: vec![] };
            let mut g = Graph::default();
            g.push(node(name("Root"), vec![0; 32], vec![]));
            read(&write(&schema, &g).unwrap())
        };
        // Поле-указатель не помещается в структуру из четырёх байт.
        let narrow = read_with(4, vec![pointer(0)]).unwrap_err();
        assert_eq!(narrow.message, "Поле не умещается в узел метаданных.");
        // Структура нулевого размера с указателем.
        assert_eq!(read_with(0, vec![pointer(0)]).unwrap_err().message, "Поле не умещается в узел метаданных.");
        // Смещение поля за концом структуры.
        assert_eq!(read_with(16, vec![pointer(12)]).unwrap_err().message, "Поле не умещается в узел метаданных.");
        // Отрицательное смещение у поля, за которым нужно идти.
        assert_eq!(read_with(16, vec![pointer(-8)]).unwrap_err().message, "Смещение поля в схеме отрицательно.");
        // Поле, за которым не идут, с любым смещением не мешает.
        let plain = Entry { name: name("n"), offset: -4, dtype: 0x11, unk9: 0, ref_index: -1, ref_key: 0 };
        assert!(read_with(16, vec![plain]).is_ok());
        assert!(read_with(16, vec![pointer(8)]).is_ok());
    }
}
