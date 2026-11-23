//! Ресурс RSC7 как граф блоков.
//!
//! Указатель узнаётся по значению слова: «база области + смещение в ней». Блок — кусок области от цели
//! какого-нибудь указателя (и от нуля) до следующей такой цели. Над графом можно дописывать блоки, вставлять
//! другой граф, править байты и цели слотов, выделять достижимое и собирать файл заново с новой раскладкой по
//! страницам. Ресурс, который не правили, через граф не проходит.

use std::cmp::Reverse;
use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::iter;

use crate::error::{Error, Result};
use crate::resource::{page_flag_size, Resource, GRAPHICS_BASE, HEADER_BYTES, RSC7_MAGIC, SYSTEM_BASE};
use crate::texture::Format;
use crate::ytd_write::payload_bytes;

pub const ALIGN: usize = 16;
pub const MAX_PAGES: usize = 15 + 16 * (127 + 2 * 63 + 4 * 15 + 8 * 3 + 16);
pub const MAX_RESOURCE_PAGES: u32 = 128;

/// Наименьшая страница, которую описывают флаги заголовка.
const HEADER_PAGE: usize = 0x200;
/// Наименьшая страница раскладки `pack_pages`.
const PACK_PAGE: usize = 0x2000;
/// Место под карту страниц: заголовок и по 8 байт на страницу ресурса.
const MAP_ROOM: usize = 16 + 8 * MAX_RESOURCE_PAGES as usize;
/// Слот корня, который ведёт на карту страниц.
const MAP_SLOT: usize = 8;
/// Счётчики страниц обеих областей лежат в карте с этого смещения.
const MAP_COUNTERS: usize = 8;
/// Блок короче не признаётся картой страниц.
const MAP_SMALLEST: usize = 10;
const VERSION_NIBBLE: u32 = 0xF000_0000;
const MINIZ_LEVEL: u8 = 6;

/// Поля «число страниц» флагов: (младший бит, ширина, вес) от самых больших страниц к малым.
const FLAG_FIELDS: [(u32, u32, usize); 9] = [
    (4, 1, 256),
    (5, 2, 128),
    (7, 4, 64),
    (11, 6, 32),
    (17, 7, 16),
    (24, 1, 8),
    (25, 1, 4),
    (26, 1, 2),
    (27, 1, 1),
];

/// Жадное кодирование числа страниц (в шестнадцатых долях): (младший бит, потолок, вес в долях).
const COUNT_STEPS: [(u32, usize, usize); 4] = [(4, 1, 16), (5, 3, 8), (7, 15, 4), (11, 63, 2)];

/// Сколько страниц каждого вида (0…4) вмещают флаги раскладки и где их число стоит в флагах.
const KIND_LIMITS: [usize; 5] = [127, 63, 15, 3, 1];
const KIND_BITS: [u32; 5] = [17, 11, 7, 5, 4];

const MSG_SHORT_RESOURCE: &str = "Ресурс короче заявленного: разбирать нечего.";
const MSG_NOT_PERMUTATION: &str = "Порядок блоков: не перестановка блоков области.";
const MSG_MISSING_BLOCKS: &str = "Порядок блоков: пропущены блоки области.";
const MSG_ROOT_FIRST: &str = "Корень системной области должен идти первым.";
const MSG_OUTSIDE: &str = "Указатель вне блоков.";
const MSG_HEADER_PAGES: &str = "Область не умещается в страницы заголовка.";
const MSG_TOO_BIG: &str = "Блок не умещается в наибольшую страницу.";
const MSG_NO_ROOM: &str = "Блоки не умещаются в страницы даже наибольшего размера.";
const MSG_NO_SOURCE_ROOT: &str = "У источника нет корня.";
const MSG_WRITE_BOUNDS: &str = "Запись за пределами блока.";
const MSG_BAD_TARGET: &str = "Новая цель указателя — не начало блока.";
const MSG_NO_SLOT: &str = "В блоке нет указателя по этому смещению.";
const MSG_ROOT_OUTSIDE: &str = "Корень вне блоков.";
const MSG_ROOT_AREA: &str = "Корень подграфа должен лежать в системной области.";
const MSG_INTERVAL: &str = "Интервал выходит за область.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Segment {
    System,
    Graphics,
}

/// Области по порядку и базы их адресов.
const AREAS: [(Segment, u64); 2] = [(Segment::System, SYSTEM_BASE), (Segment::Graphics, GRAPHICS_BASE)];

impl Segment {
    fn lane(self) -> usize {
        self as usize
    }

    fn base(self) -> u64 {
        AREAS[self.lane()].1
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Address {
    pub segment: Segment,
    pub offset: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Slot {
    pub relative: usize,
    pub target: Address,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub segment: Segment,
    pub start: usize,
    pub end: usize,
    pub slots: Vec<Slot>,
}

impl Block {
    fn size(&self) -> usize {
        self.end - self.start
    }

    /// Тот же блок, сдвинутый вместе с целями своих слотов на базы областей.
    fn moved(&self, bases: [usize; 2]) -> Block {
        let slide = |at: Address| Address { offset: at.offset + bases[at.segment.lane()], ..at };
        let by = bases[self.segment.lane()];
        Block {
            segment: self.segment,
            start: self.start + by,
            end: self.end + by,
            slots: self.slots.iter().map(|slot| Slot { target: slide(slot.target), ..*slot }).collect(),
        }
    }

    /// Где в области лежит слово слота: начало и конец.
    fn word_span(&self, slot: &Slot) -> (usize, usize) {
        let from = self.start + slot.relative;
        (from, from + 8)
    }
}

#[derive(Debug, Clone)]
pub struct Graph {
    pub declared_version: u32,
    pub system_flags: u32,
    pub graphics_flags: u32,
    pub system: Vec<u8>,
    pub graphics: Vec<u8>,
    pub blocks: Vec<Block>,
    /// Индексы блоков каждой области (системной, графической) по порядку.
    lanes: [Vec<usize>; 2],
    /// Начала страниц исходного ресурса по областям; пусто, если страниц исходника нет.
    page_starts: [Vec<usize>; 2],
}

impl Graph {
    fn assemble(
        header: (u32, u32, u32),
        areas: [Vec<u8>; 2],
        blocks: Vec<Block>,
        page_starts: [Vec<usize>; 2],
    ) -> Graph {
        let lanes = AREAS.map(|(segment, _)| {
            blocks
                .iter()
                .enumerate()
                .filter(|(_, block)| block.segment == segment)
                .map(|(index, _)| index)
                .collect()
        });
        let [system, graphics] = areas;
        Graph {
            declared_version: header.0,
            system_flags: header.1,
            graphics_flags: header.2,
            system,
            graphics,
            blocks,
            lanes,
            page_starts,
        }
    }

    fn header(&self) -> (u32, u32, u32) {
        (self.declared_version, self.system_flags, self.graphics_flags)
    }

    fn flags_of(&self, segment: Segment) -> u32 {
        [self.system_flags, self.graphics_flags][segment.lane()]
    }

    fn area_mut(&mut self, segment: Segment) -> &mut Vec<u8> {
        [&mut self.system, &mut self.graphics]
            .into_iter()
            .nth(segment.lane())
            .expect("областей две")
    }

    /// Дописывает байты в конец области с выравниванием и отдаёт начало дописанного.
    fn extend_area(&mut self, segment: Segment, bytes: &[u8]) -> usize {
        let area = self.area_mut(segment);
        let start = area.len().next_multiple_of(ALIGN);
        area.resize(start, 0);
        area.extend_from_slice(bytes);
        start
    }

    /// Номер страницы исходника, на которой лежит смещение (одна страница, если страниц исходника нет).
    fn page_of(&self, segment: Segment, offset: usize) -> usize {
        self.page_starts[segment.lane()].partition_point(|&start| start <= offset)
    }

    /// Первый слот блока с таким смещением.
    fn slot_at(&self, block: usize, relative: usize) -> Option<&Slot> {
        self.blocks[block].slots.iter().find(|slot| slot.relative == relative)
    }

    pub fn bytes(&self, segment: Segment) -> &[u8] {
        [&self.system[..], &self.graphics[..]][segment.lane()]
    }

    /// Байты блока вместе с добивкой до следующего блока.
    pub fn content(&self, block: usize) -> &[u8] {
        let block = &self.blocks[block];
        &self.bytes(block.segment)[block.start..block.end]
    }

    pub fn segment_blocks(&self, segment: Segment) -> &[usize] {
        &self.lanes[segment.lane()]
    }

    /// Блок, в котором лежит адрес: последний, чьё начало не больше смещения, если смещение ещё до его конца.
    pub fn block_at(&self, address: Address) -> Option<usize> {
        let list = self.segment_blocks(address.segment);
        let nearest = match list.binary_search_by_key(&address.offset, |&index| self.blocks[index].start) {
            // Среди блоков с одним началом нужен самый поздний.
            Ok(hit) => {
                let equal = list[hit..].iter().take_while(|&&i| self.blocks[i].start == address.offset).count();
                hit + equal - 1
            }
            Err(gap) => gap.checked_sub(1)?,
        };
        let index = list[nearest];
        (address.offset < self.blocks[index].end).then_some(index)
    }

    pub fn root(&self) -> Option<usize> {
        self.block_at(Address { segment: Segment::System, offset: 0 })
    }

    /// Блок, который начинается ровно с этого адреса.
    fn block_starting_at(&self, address: Address) -> Option<usize> {
        self.block_at(address).filter(|&index| self.blocks[index].start == address.offset)
    }

    /// Карта страниц: блок, на который указывает слот корня со смещением 8.
    fn map_block(&self) -> Option<usize> {
        let root = self.root()?;
        let target = self.slot_at(root, MAP_SLOT)?.target;
        (target.segment == Segment::System)
            .then(|| self.block_starting_at(target))
            .flatten()
            // Сам корень картой быть не может: счётчики страниц затёрли бы его же указатель.
            .filter(|&index| index != root && self.blocks[index].size() >= MAP_SMALLEST)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pages {
    pub flags: u32,
    pub size: usize,
    pub count: u32,
    pub starts: Vec<usize>,
}

// ---------------------------------------------------------------------------------------------
// Разбор: сначала слова и цели, потом нарезка
// ---------------------------------------------------------------------------------------------

/// Начала страниц, которые описывают флаги, если они сходятся с длиной области.
fn source_page_starts(flags: u32, len: usize) -> Vec<usize> {
    if page_flag_size(flags) != len {
        return Vec::new();
    }
    let unit = HEADER_PAGE << (flags & 0xf);
    FLAG_FIELDS
        .iter()
        .flat_map(|&(low, width, weight)| {
            let count = (flags >> low) & ((1u32 << width) - 1);
            iter::repeat_n(unit * weight, count as usize)
        })
        .scan(0usize, |at, size| {
            let start = *at;
            *at += size;
            Some(start)
        })
        .collect()
}

/// Слово-указатель: область, где оно лежит, смещение слова и цель.
struct Word {
    lane: usize,
    at: usize,
    to: Address,
}

/// Куда указывает значение: в графическую область, иначе в системную, иначе никуда.
fn classify(value: u64, lens: [usize; 2]) -> Option<Address> {
    let landing = |segment: Segment| {
        value
            .checked_sub(segment.base())
            .filter(|&offset| offset < lens[segment.lane()] as u64)
            .map(|offset| Address { segment, offset: offset as usize })
    };
    landing(Segment::Graphics).or_else(|| landing(Segment::System))
}

fn find_words(areas: &[Vec<u8>; 2]) -> Vec<Word> {
    let lens = [areas[0].len(), areas[1].len()];
    areas
        .iter()
        .enumerate()
        .flat_map(|(lane, area)| {
            area.chunks_exact(8).enumerate().filter_map(move |(k, chunk)| {
                let value = u64::from_le_bytes(chunk.try_into().ok()?);
                classify(value, lens).map(|to| Word { lane, at: k * 8, to })
            })
        })
        .collect()
}

/// Диапазоны графической области, занятые пикселями обычных двумерных текстур: описание лежит в системной области, его слово по
/// смещению `DATA` ведёт в графику, а размер пикселей считается по ширине, высоте, формату и числу ступеней описания.
fn texture_pixel_ranges(areas: &[Vec<u8>; 2], words: &[Word]) -> Vec<std::ops::Range<usize>> {
    let graphics = areas[1].len();
    words
        .iter()
        .filter(|word| word.lane == 0 && word.to.segment == Segment::Graphics)
        .filter_map(|word| {
            let start = word.at.checked_sub(texture_at::DATA)?;
            let descriptor = areas[0].get(start..start + texture_at::END)?;
            let bytes = texture_pixel_bytes(descriptor).filter(|_| is_plain_texture(descriptor))?;
            Some(word.to.offset..word.to.offset.saturating_add(bytes).min(graphics))
        })
        .collect()
}

/// Слова, которые лежат в пикселях текстур, указателями не считаются: в сжатой картинке восемь байт выровненного слова иногда
/// случайно дают адрес области (блок цвета DXT с нулевыми индексами и двумя цветами `0x6000 + смещение`). Такое «слово» меняло
/// бы начала блоков и при пересборке переписывалось бы, а пиксели портились.
fn without_pixel_words(areas: &[Vec<u8>; 2], words: Vec<Word>) -> Vec<Word> {
    let pixels = texture_pixel_ranges(areas, &words);
    if pixels.is_empty() {
        return words;
    }
    words
        .into_iter()
        .filter(|word| word.lane == 0 || !pixels.iter().any(|range| range.contains(&word.at)))
        .collect()
}

/// Начала блоков каждой области: нуль непустой области и все цели.
fn collect_starts(lens: [usize; 2], words: &[Word]) -> [BTreeSet<usize>; 2] {
    let mut starts: [BTreeSet<usize>; 2] = Default::default();
    for (set, &len) in starts.iter_mut().zip(&lens) {
        if len > 0 {
            set.insert(0);
        }
    }
    for word in words {
        starts[word.to.segment.lane()].insert(word.to.offset);
    }
    starts
}

pub fn from_parts(
    declared_version: u32,
    system_flags: u32,
    graphics_flags: u32,
    system: Vec<u8>,
    graphics: Vec<u8>,
) -> Graph {
    let areas = [system, graphics];
    let lens = [areas[0].len(), areas[1].len()];
    let words = without_pixel_words(&areas, find_words(&areas));

    // Этап 2: нарезка по собранным началам, слова раскладываются по блокам.
    let starts = collect_starts(lens, &words);
    let mut blocks = Vec::new();
    let mut lookup: [BTreeMap<usize, usize>; 2] = Default::default();
    for ((segment, _), (set, &len)) in AREAS.iter().zip(starts.iter().zip(&lens)) {
        let begins: Vec<usize> = set.iter().copied().collect();
        for (k, &start) in begins.iter().enumerate() {
            lookup[segment.lane()].insert(start, blocks.len());
            let end = begins.get(k + 1).copied().unwrap_or(len);
            blocks.push(Block { segment: *segment, start, end, slots: Vec::new() });
        }
    }
    for word in &words {
        let (&start, &index) = lookup[word.lane].range(..=word.at).next_back().expect("начало области есть");
        blocks[index].slots.push(Slot { relative: word.at - start, target: word.to });
    }

    let page_starts = [source_page_starts(system_flags, lens[0]), source_page_starts(graphics_flags, lens[1])];
    Graph::assemble((declared_version, system_flags, graphics_flags), areas, blocks, page_starts)
}

pub fn scan(resource: &Resource) -> Result<Graph> {
    let header = &resource.header;
    let data = resource.data();
    let total = header
        .system_size
        .checked_add(header.graphics_size)
        .filter(|&total| total <= data.len())
        .ok_or_else(|| Error::broken(MSG_SHORT_RESOURCE))?;
    let (system, graphics) = data[..total].split_at(header.system_size);
    Ok(from_parts(
        header.declared_version,
        header.system_flags,
        header.graphics_flags,
        system.to_vec(),
        graphics.to_vec(),
    ))
}

pub fn identity_order(graph: &Graph, segment: Segment) -> Vec<usize> {
    graph.segment_blocks(segment).to_vec()
}

/// Системные блоки: корень первым, остальные от больших к малым. Графическая область остаётся как есть.
pub fn size_descending_order(graph: &Graph, segment: Segment) -> Vec<usize> {
    let mut order = identity_order(graph, segment);
    if let Some(root) = graph.root().filter(|&root| graph.blocks[root].segment == segment) {
        order.sort_by_key(|&index| (index != root, Reverse(graph.blocks[index].size()), index));
    }
    order
}

// ---------------------------------------------------------------------------------------------
// Страницы
// ---------------------------------------------------------------------------------------------

/// Поля «число страниц» для `pages` страниц одной длины: младшие четыре идут в старшие биты зеркально,
/// остальное — жадно от крупных классов к мелким.
fn count_fields(pages: usize) -> u32 {
    let low = (pages % 16) as u32;
    let mirrored = (0..4).fold(0u32, |acc, bit| acc | ((low >> bit) & 1) << (27 - bit));
    let (flags, rest) = COUNT_STEPS.iter().fold((mirrored, pages / 16), |(flags, rest), &(bit, cap, per)| {
        let taken = (rest / per).min(cap);
        (flags | (taken as u32) << bit, rest - taken * per)
    });
    flags | (rest as u32) << 17
}

/// Флаги и размер области не короче `len` с наименьшей страницей, при которой хватает полей заголовка.
pub(crate) fn sized(len: usize, original: u32) -> Result<(u32, usize)> {
    let (shift, pages) = (0..16u32)
        .map(|shift| (shift, len.div_ceil(HEADER_PAGE << shift)))
        .find(|&(_, pages)| pages <= MAX_PAGES)
        .ok_or_else(|| Error::broken(MSG_HEADER_PAGES))?;
    let flags = count_fields(pages) | shift | (original & VERSION_NIBBLE);
    Ok((flags, page_flag_size(flags)))
}

fn page_bytes(shift: u32, kind: usize) -> usize {
    (PACK_PAGE << shift) << kind
}

/// Наименьший вид страницы (0…4), в который кусок помещается.
fn kind_for(size: usize, shift: u32) -> Option<usize> {
    (0..KIND_LIMITS.len()).find(|&kind| page_bytes(shift, kind) >= size)
}

struct Shelf {
    kind: usize,
    used: usize,
}

/// Одна попытка раскладки при заданном сдвиге страницы.
struct Attempt {
    shift: u32,
    shelves: Vec<Shelf>,
    /// (страница, позиция в ней) для каждого куска.
    spots: Vec<(usize, usize)>,
}

impl Attempt {
    fn run(sizes: &[usize], shift: u32) -> Option<Attempt> {
        let top = kind_for(sizes.iter().copied().max()?, shift)?;
        let mut attempt = Attempt {
            shift,
            shelves: vec![Shelf { kind: top, used: sizes[0] }],
            spots: vec![(0, 0); sizes.len()],
        };
        let mut queue: Vec<usize> = (1..sizes.len()).collect();
        queue.sort_by_key(|&piece| Reverse(sizes[piece]));
        for piece in queue {
            attempt.spots[piece] = attempt.settle(sizes[piece], top)?;
        }
        Some(attempt)
    }

    /// Плотная раскладка (графическая область, 10.11.2026): куски от больших к малым, ни один не привязан к первой
    /// странице; страница открывается размером под самый крупный кусок, а потом ужимается до наименьшей, что
    /// вмещает занятое. Так общий размер страниц близок к размеру данных, а самая большая страница — наименьшая,
    /// в которую помещается самый крупный блок.
    fn run_dense(sizes: &[usize], shift: u32) -> Option<Attempt> {
        Attempt::run_dense_lifted(sizes, shift, 0)
    }

    /// Плотная раскладка с запасом: страница-ёмкость на `lift` видов больше наименьшей, что вмещает самый крупный кусок (мелкие куски
    /// иногда ложатся плотнее на больших страницах); после раскладки каждая страница всё равно ужимается до наименьшей вмещающей.
    fn run_dense_lifted(sizes: &[usize], shift: u32, lift: usize) -> Option<Attempt> {
        let top = (kind_for(sizes.iter().copied().max()?, shift)? + lift).min(KIND_LIMITS.len() - 1);
        let room = page_bytes(shift, top);
        let mut attempt = Attempt { shift, shelves: Vec::new(), spots: vec![(0, 0); sizes.len()] };
        let mut queue: Vec<usize> = (0..sizes.len()).collect();
        queue.sort_by_key(|&piece| (Reverse(sizes[piece]), piece));
        for piece in queue {
            let size = sizes[piece];
            let found = attempt.shelves.iter().enumerate().find_map(|(n, shelf)| {
                let at = shelf.used.next_multiple_of(ALIGN);
                (at + size <= room).then_some((n, at))
            });
            let (n, at) = found.unwrap_or_else(|| {
                attempt.shelves.push(Shelf { kind: top, used: 0 });
                (attempt.shelves.len() - 1, 0)
            });
            attempt.shelves[n].used = at + size;
            attempt.spots[piece] = (n, at);
        }
        attempt.shrink(top);
        Some(attempt)
    }

    /// Каждая страница — наименьшего вида, в который помещается занятое; потолок числа страниц вида уважается:
    /// если места в своём виде нет, страница остаётся в ближайшем большем.
    fn shrink(&mut self, top: usize) {
        let mut taken = [0usize; 5];
        let mut order: Vec<usize> = (0..self.shelves.len()).collect();
        order.sort_by_key(|&n| (Reverse(self.shelves[n].used), n));
        for n in order {
            let own = kind_for(self.shelves[n].used.max(1), self.shift).unwrap_or(top).min(top);
            let kind = (own..=top).find(|&kind| taken[kind] < KIND_LIMITS[kind]).unwrap_or(top);
            taken[kind] += 1;
            self.shelves[n].kind = kind;
        }
    }

    /// Первое подходящее место для куска: по видам от собственного до верхнего, иначе новая страница.
    fn settle(&mut self, size: usize, top: usize) -> Option<(usize, usize)> {
        let own = kind_for(size, self.shift)?;
        let roomy = (own..=top)
            .flat_map(|kind| self.shelves.iter().enumerate().filter(move |(_, shelf)| shelf.kind == kind))
            .find_map(|(n, shelf)| {
                let at = shelf.used.next_multiple_of(ALIGN);
                (at + size <= page_bytes(self.shift, shelf.kind)).then_some((n, at))
            });
        let (n, at) = roomy.unwrap_or_else(|| {
            self.shelves.push(Shelf { kind: own, used: 0 });
            (self.shelves.len() - 1, 0)
        });
        self.shelves[n].used = at + size;
        Some((n, at))
    }

    fn counts(&self) -> [usize; 5] {
        let mut counts = [0; 5];
        self.shelves.iter().for_each(|shelf| counts[shelf.kind] += 1);
        counts
    }

    fn fits(&self, limit: u32) -> bool {
        self.shelves.len() <= limit as usize && self.counts().iter().zip(KIND_LIMITS).all(|(&n, cap)| n <= cap)
    }

    fn into_pages(self, top_bits: u32) -> Pages {
        // В памяти страницы идут от больших видов к малым, внутри вида — по порядку создания.
        let mut memory: Vec<usize> = (0..self.shelves.len()).collect();
        memory.sort_by_key(|&n| Reverse(self.shelves[n].kind));
        let mut origin = vec![0usize; self.shelves.len()];
        let size = memory.iter().fold(0, |at, &n| {
            origin[n] = at;
            at + page_bytes(self.shift, self.shelves[n].kind)
        });
        let flags = self
            .counts()
            .iter()
            .zip(KIND_BITS)
            .fold(top_bits | self.shift, |acc, (&n, bit)| acc | (n as u32) << bit);
        Pages {
            flags,
            size,
            count: self.shelves.len() as u32,
            starts: self.spots.iter().map(|&(n, at)| origin[n] + at).collect(),
        }
    }
}

/// Раскладывает куски по страницам: первый кусок открывает область, остальные — от больших к малым.
pub fn pack_pages(sizes: &[usize], original: u32, limit: u32) -> Result<Pages> {
    pack_by(sizes, original, limit, Attempt::run)
}

/// Плотная раскладка для области, где нет «корня первым» (графика): общий размер страниц близок к размеру данных.
/// Из нескольких раскладок (плотная с запасом страницы 0, 1 и 2 вида и прежняя, `pack_pages`) берётся с наименьшим общим размером
/// страниц; при равенстве — с меньшей самой большой страницей, потом с меньшим числом страниц. Самая большая страница не растёт:
/// она не больше той, что даёт плотная без запаса (наименьшая, вмещающая самый крупный кусок), и не больше той, что даёт прежняя раскладка.
/// Так графика никогда не больше, чем у прежней раскладки того же набора кусков (на корпусе репозитория плотная без выбора давала
/// на 6 из 586 файлов до 4 МБ лишних), а страницы не крупнее прежних.
pub fn pack_dense_pages(sizes: &[usize], original: u32, limit: u32) -> Result<Pages> {
    let tight = pack_by(sizes, original, limit, Attempt::run_dense);
    let loose = pack_by(sizes, original, limit, Attempt::run);
    let lifted = [1usize, 2].map(|lift| {
        let run: fn(&[usize], u32) -> Option<Attempt> = if lift == 1 { |sizes, shift| Attempt::run_dense_lifted(sizes, shift, 1) } else { |sizes, shift| Attempt::run_dense_lifted(sizes, shift, 2) };
        pack_by(sizes, original, limit, run)
    });
    let ceiling = [&tight, &loose].into_iter().filter_map(|pages| pages.as_ref().ok()).map(|pages| biggest_page(pages.flags)).max();
    let rank = |pages: &Pages| (pages.size, biggest_page(pages.flags), pages.count);
    let mut best: Option<Pages> = None;
    // Отказ, если не вышла ни одна раскладка, — отказ прежней, как до выбора.
    let mut refusal: Option<Error> = None;
    for (at, pages) in [tight, loose].into_iter().chain(lifted).enumerate() {
        let pages = match pages {
            Ok(pages) => pages,
            Err(error) => {
                if at == 1 {
                    refusal = Some(error);
                }
                continue;
            }
        };
        if ceiling.is_some_and(|top| biggest_page(pages.flags) > top) {
            continue;
        }
        if best.as_ref().map_or(true, |kept| rank(&pages) < rank(kept)) {
            best = Some(pages);
        }
    }
    best.ok_or_else(|| refusal.unwrap_or_else(|| Error::broken(MSG_NO_ROOM)))
}

/// Самая большая страница по флагам области.
fn biggest_page(flags: u32) -> usize {
    let base = HEADER_PAGE << (flags & 0xf);
    FLAG_FIELDS
        .iter()
        .filter(|&&(bit, width, _)| (flags >> bit) & ((1 << width) - 1) != 0)
        .map(|&(_, _, weight)| base * weight)
        .max()
        .unwrap_or(0)
}

fn pack_by(sizes: &[usize], original: u32, limit: u32, run: fn(&[usize], u32) -> Option<Attempt>) -> Result<Pages> {
    let top_bits = original & VERSION_NIBBLE;
    let (Some(smallest), Some(largest)) = (sizes.iter().copied().min(), sizes.iter().copied().max()) else {
        return Ok(Pages { flags: top_bits, size: 0, count: 0, starts: Vec::new() });
    };
    let first = (0..=15u32)
        .find(|&shift| {
            let page = PACK_PAGE << shift;
            page >= smallest && page * 16 >= largest
        })
        .unwrap_or(15);
    if (PACK_PAGE << first) * 16 < largest {
        return Err(Error::broken(MSG_TOO_BIG));
    }
    (first..=15)
        .filter_map(|shift| run(sizes, shift))
        .find(|attempt| attempt.fits(limit))
        .map(|attempt| attempt.into_pages(top_bits))
        .ok_or_else(|| Error::broken(MSG_NO_ROOM))
}

// ---------------------------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------------------------

/// Кусок раскладки: блоки подряд (блок, смещение в куске) и размер куска.
#[derive(Default)]
struct Chunk {
    size: usize,
    parts: Vec<(usize, usize)>,
}

impl Chunk {
    /// Кладёт блок в конец куска; выравнивание берётся по старому началу блока.
    fn append(&mut self, index: usize, old_start: usize, room: usize) {
        let at = self.size.next_multiple_of(alignment_of(old_start));
        self.parts.push((index, at));
        self.size = at + room;
    }
}

/// Выравнивание блока по его старому началу: 16, 8, 4, 2 или 1.
fn alignment_of(start: usize) -> usize {
    1 << start.trailing_zeros().min(4)
}

/// Записывает слово как можно полнее: хвост за концом области отбрасывается.
fn put_word(area: &mut [u8], at: usize, value: u64) {
    for (cell, byte) in area.iter_mut().skip(at).zip(value.to_le_bytes()) {
        *cell = byte;
    }
}

/// Как раскладывать при пересборке. `Dense` — нынешняя: пиксели без нулевого хвоста, графика плотными страницами.
/// `Legacy` — прежняя, до 10.11.2026 (хвосты пикселей наследуются, графика по правилу «корень первым»): оставлена для сверки
/// «до/после» на корпусе (`tests/packing_corpus.rs`), в приложении не используется.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Packing {
    Dense,
    Legacy,
}

/// План сборки одного графа: карта страниц и раскладка каждой области.
struct Planner<'g> {
    graph: &'g Graph,
    map: Option<usize>,
    packing: Packing,
}

impl<'g> Planner<'g> {
    fn new(graph: &'g Graph, packing: Packing) -> Self {
        Planner { graph, map: graph.map_block(), packing }
    }

    fn check(&self, segment: Segment, order: &[usize]) -> Result<()> {
        let graph = self.graph;
        let mut taken = HashSet::new();
        let sound = order
            .iter()
            .all(|&index| graph.blocks.get(index).is_some_and(|block| block.segment == segment) && taken.insert(index));
        if !sound {
            return Err(Error::broken(MSG_NOT_PERMUTATION));
        }
        if order.len() < graph.segment_blocks(segment).len() {
            return Err(Error::broken(MSG_MISSING_BLOCKS));
        }
        Ok(())
    }

    /// Соседи по порядку делят кусок, если идут вперёд по смещениям, лежат на одной странице исходника
    /// и ни один из них не карта страниц.
    fn glued(&self, segment: Segment, before: usize, index: usize) -> bool {
        let graph = self.graph;
        let (behind, block) = (&graph.blocks[before], &graph.blocks[index]);
        behind.end <= block.start
            && graph.page_of(segment, behind.start) == graph.page_of(segment, block.start)
            && ![before, index].iter().any(|&one| Some(one) == self.map)
    }

    fn chunks(&self, segment: Segment, order: &[usize]) -> Vec<Chunk> {
        order.iter().enumerate().fold(Vec::new(), |mut chunks: Vec<Chunk>, (k, &index)| {
            if k == 0 || !self.glued(segment, order[k - 1], index) {
                chunks.push(Chunk::default());
            }
            let block = &self.graph.blocks[index];
            let room = if self.map == Some(index) { block.size().max(MAP_ROOM) } else { block.size() };
            chunks.last_mut().expect("кусок только что добавлен").append(index, block.start, room);
            chunks
        })
    }

    /// Раскладывает области по страницам и записывает новые места блоков.
    fn lay(&self, segment: Segment, order: &[usize], limit: u32, places: &mut [usize]) -> Result<Pages> {
        let chunks = self.chunks(segment, order);
        let sizes: Vec<usize> = chunks.iter().map(|chunk| chunk.size.max(1)).collect();
        // Корень системной области обязан лежать на первой странице; у графики такого требования нет.
        let pages = match segment {
            Segment::System => pack_pages(&sizes, self.graph.flags_of(segment), limit)?,
            Segment::Graphics if self.packing == Packing::Dense => pack_dense_pages(&sizes, self.graph.flags_of(segment), limit)?,
            Segment::Graphics => pack_pages(&sizes, self.graph.flags_of(segment), limit)?,
        };
        for (chunk, base) in chunks.iter().zip(&pages.starts) {
            for &(index, at) in &chunk.parts {
                places[index] = base + at;
            }
        }
        Ok(pages)
    }

    /// Значение слова слота на новой раскладке.
    fn pointer_word(&self, slot: &Slot, places: &[usize]) -> Result<u64> {
        let graph = self.graph;
        let hit = graph.block_at(slot.target).ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
        let inside = slot.target.offset - graph.blocks[hit].start;
        Ok(slot.target.segment.base() + (places[hit] + inside) as u64)
    }

    /// Область: блоки на новых местах, потом слова всех слотов. Слово может перешагнуть начало следующего блока
    /// (его режет цель соседнего указателя), и копия этого блока, лёгшая после слова, затёрла бы хвост слова старыми
    /// байтами: слова пишутся, когда все блоки уже на местах.
    fn emit(&self, segment: Segment, order: &[usize], places: &[usize], size: usize) -> Result<Vec<u8>> {
        let graph = self.graph;
        let source = graph.bytes(segment);
        let mut area = vec![0u8; size];
        for &index in order {
            let block = &graph.blocks[index];
            let at = places[index];
            area[at..at + block.size()].copy_from_slice(&source[block.start..block.end]);
        }
        for &index in order {
            let block = &graph.blocks[index];
            for slot in &block.slots {
                put_word(&mut area, places[index] + slot.relative, self.pointer_word(slot, places)?);
            }
        }
        Ok(area)
    }
}

pub fn rebuild(graph: &Graph, system_order: &[usize], graphics_order: &[usize]) -> Result<Vec<u8>> {
    rebuild_with(graph, system_order, graphics_order, &|body| {
        miniz_oxide::deflate::compress_to_vec(body, MINIZ_LEVEL)
    })
}

pub fn rebuild_with(
    graph: &Graph,
    system_order: &[usize],
    graphics_order: &[usize],
    deflate: &dyn Fn(&[u8]) -> Vec<u8>,
) -> Result<Vec<u8>> {
    rebuild_with_packing(graph, system_order, graphics_order, deflate, Packing::Dense)
}

/// `rebuild_with` с выбором раскладки (`Packing::Legacy` — только для сверки «до/после»).
pub fn rebuild_with_packing(
    graph: &Graph,
    system_order: &[usize],
    graphics_order: &[usize],
    deflate: &dyn Fn(&[u8]) -> Vec<u8>,
    packing: Packing,
) -> Result<Vec<u8>> {
    // Нулевой хвост пикселей (дополнение страницы исходника) не наследуется: иначе каждая пересборка тащит его в куски.
    let trimmed = if packing == Packing::Dense { without_texture_padding(graph) } else { None };
    let graph = trimmed.as_ref().unwrap_or(graph);
    let plan = Planner::new(graph, packing);
    plan.check(Segment::System, system_order)?;
    plan.check(Segment::Graphics, graphics_order)?;
    if system_order.first().is_some_and(|&first| graph.root() != Some(first)) {
        return Err(Error::broken(MSG_ROOT_FIRST));
    }

    let mut places = vec![0usize; graph.blocks.len()];
    let system_pages = plan.lay(Segment::System, system_order, MAX_RESOURCE_PAGES, &mut places)?;
    let graphics_pages = plan.lay(Segment::Graphics, graphics_order, MAX_RESOURCE_PAGES - system_pages.count, &mut places)?;
    let mut system = plan.emit(Segment::System, system_order, &places, system_pages.size)?;
    let graphics = plan.emit(Segment::Graphics, graphics_order, &places, graphics_pages.size)?;
    if let Some(map) = plan.map {
        // Игра сверяет эти числа с заголовком: пишутся после всех указателей.
        for (k, count) in [system_pages.count, graphics_pages.count].into_iter().enumerate() {
            system[places[map] + MAP_COUNTERS + k] = count as u8;
        }
    }

    let mut file: Vec<u8> = [RSC7_MAGIC, graph.declared_version, system_pages.flags, graphics_pages.flags]
        .into_iter()
        .flat_map(u32::to_le_bytes)
        .collect();
    debug_assert_eq!(file.len(), HEADER_BYTES);
    file.extend(deflate(&[system, graphics].concat()));
    Ok(file)
}

// ---------------------------------------------------------------------------------------------
// Нулевой хвост пиксельных блоков
// ---------------------------------------------------------------------------------------------

/// Поля описания текстуры Legacy от начала блока описания.
mod texture_at {
    pub const WIDTH: usize = 0x50;
    pub const HEIGHT: usize = 0x52;
    /// Глубина (число слоёв объёмной текстуры); у обычной 1 (бывает 0).
    pub const DEPTH: usize = 0x54;
    pub const FORMAT: usize = 0x58;
    /// Вид текстуры: 0 — обычная двумерная; куб (шесть граней) и объём иначе (по описанию RageLib: `Unknown_5Ch`, у штатных 0).
    pub const KIND: usize = 0x5c;
    pub const LEVELS: usize = 0x5d;
    /// Указатель на пиксели; описание кончается следом.
    pub const DATA: usize = 0x70;
    pub const END: usize = 0x78;
}

/// Самая большая сторона и число ступеней, при которых описание считается текстурой.
const TEXTURE_SIDE_MAX: u16 = 16384;
const TEXTURE_LEVELS_MAX: u8 = 16;

/// Обычная ли это двумерная текстура: глубина 0 или 1 и вид 0. У куба граней шесть, у объёма слоёв `depth`: настоящих пикселей в блоке больше,
/// чем даёт размер одной картинки, и «лишние» грани или слои, будь они чёрными (нули в DXT), нулевым хвостом не являются.
fn is_plain_texture(descriptor: &[u8]) -> bool {
    let depth = descriptor.get(texture_at::DEPTH..texture_at::DEPTH + 2).map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]));
    let kind = descriptor.get(texture_at::KIND).copied();
    matches!((depth, kind), (Some(0 | 1), Some(0)))
}

/// Сколько байт занимают все ступени текстуры по её описанию; `None`, если описание на текстуру не похоже.
fn texture_pixel_bytes(descriptor: &[u8]) -> Option<usize> {
    let field = |at: usize, len: usize| descriptor.get(at..at + len);
    let width = u16::from_le_bytes(field(texture_at::WIDTH, 2)?.try_into().ok()?);
    let height = u16::from_le_bytes(field(texture_at::HEIGHT, 2)?.try_into().ok()?);
    let code = u32::from_le_bytes(field(texture_at::FORMAT, 4)?.try_into().ok()?);
    let levels = *descriptor.get(texture_at::LEVELS)?;
    let sane = (1..=TEXTURE_SIDE_MAX).contains(&width) && (1..=TEXTURE_SIDE_MAX).contains(&height) && (1..=TEXTURE_LEVELS_MAX).contains(&levels);
    let format = Format::from_code(code).filter(|_| sane)?;
    Some(payload_bytes(format, usize::from(width), usize::from(height), usize::from(levels)))
}

/// Пиксельные блоки, за последней ступенью которых до конца блока одни нули: (блок, где ему кончаться).
///
/// Блок кончается у ближайшего указателя, поэтому дополнение страницы исходника (нули после последней текстуры
/// страницы) числится хвостом пикселей. Размер текстуры известен по её описанию, и хвост из нулей за ним — не данные.
/// Хвост с ненулевым байтом, незнакомый формат, указатель пикселей не на начало блока и описание короче 0x78
/// байт остаются как есть. Блок, на который смотрят несколько описаний, оставляет место под самое большое.
/// Текстура не двумерная (куб, объём: глубина больше 1 или вид не 0) блок не режет, даже если на него смотрят и обычные описания.
fn texture_padding(graph: &Graph) -> Vec<(usize, usize)> {
    let (system, graphics) = (graph.bytes(Segment::System), graph.bytes(Segment::Graphics));
    let mut needed: BTreeMap<usize, usize> = BTreeMap::new();
    let mut kept: BTreeSet<usize> = BTreeSet::new();
    for &holder in graph.segment_blocks(Segment::System) {
        // Повреждённый граф (блок за областью) здесь не падает: его разберёт сборка.
        let Some(descriptor) = system.get(graph.blocks[holder].start..graph.blocks[holder].end) else {
            continue;
        };
        if descriptor.len() < texture_at::END {
            continue;
        }
        let pixels = graph.blocks[holder]
            .slots
            .iter()
            .find(|slot| slot.relative == texture_at::DATA && slot.target.segment == Segment::Graphics)
            .and_then(|slot| graph.block_starting_at(slot.target));
        let Some(pixels) = pixels else {
            continue;
        };
        match texture_pixel_bytes(descriptor) {
            // Обычная двумерная текстура известного формата: место под её ступени.
            Some(bytes) if is_plain_texture(descriptor) => {
                let entry = needed.entry(pixels).or_insert(0);
                *entry = (*entry).max(bytes);
            }
            // Куб, объём или описание, размера которого не знаем: этот блок не режется.
            _ => {
                kept.insert(pixels);
            }
        }
    }
    needed
        .into_iter()
        .filter(|(pixels, _)| !kept.contains(pixels))
        .filter_map(|(pixels, bytes)| {
            let block = &graph.blocks[pixels];
            let end = block.start.checked_add(bytes).filter(|&end| bytes > 0 && end < block.end)?;
            graphics.get(end..block.end)?.iter().all(|&byte| byte == 0).then_some((pixels, end))
        })
        .collect()
}

/// Копия графа без нулевого хвоста у пиксельных блоков текстур; `None`, если резать нечего.
pub fn without_texture_padding(graph: &Graph) -> Option<Graph> {
    let cuts = texture_padding(graph);
    if cuts.is_empty() {
        return None;
    }
    let mut trimmed = graph.clone();
    for (block, end) in cuts {
        trimmed.blocks[block].end = end;
    }
    Some(trimmed)
}

// ---------------------------------------------------------------------------------------------
// Сравнение
// ---------------------------------------------------------------------------------------------

fn differ(reason: &str) -> Error {
    Error::broken(format!("Ресурсы различаются: {reason}."))
}

/// Соответствие блоков двух графов: один блок первого — один блок второго.
#[derive(Default)]
struct Pairing {
    forward: HashMap<usize, usize>,
    claimed: HashSet<usize>,
}

enum Claim {
    Fresh,
    Agreed,
    Conflict,
}

impl Pairing {
    fn claim(&mut self, left: usize, right: usize) -> Claim {
        match self.forward.entry(left) {
            Entry::Occupied(known) if *known.get() == right => Claim::Agreed,
            Entry::Occupied(_) => Claim::Conflict,
            Entry::Vacant(free) => {
                if self.claimed.insert(right) {
                    free.insert(right);
                    Claim::Fresh
                } else {
                    Claim::Conflict
                }
            }
        }
    }
}

/// Сколько первых байт блока занимает хвост слова-указателя из предыдущих блоков: слово перешагнуло границу блока.
fn spilled_head(graph: &Graph, block: usize) -> usize {
    let start = graph.blocks[block].start;
    let list = graph.segment_blocks(graph.blocks[block].segment);
    let Some(position) = list.iter().position(|&index| index == block) else { return 0 };
    let mut covered = 0;
    for &before in list[..position].iter().rev() {
        let behind = &graph.blocks[before];
        // Слово в восемь байт дальше не достанет.
        if behind.end + 8 <= start {
            break;
        }
        for slot in &behind.slots {
            covered = covered.max((behind.start + slot.relative + 8).saturating_sub(start));
        }
    }
    covered
}

/// Форма, хвост и байты вне слотов у пары блоков.
fn compare_content(a: &Graph, b: &Graph, x: usize, y: usize, x_is_map: bool) -> Result<()> {
    let (left, right) = (&a.blocks[x], &b.blocks[y]);
    if left.segment != right.segment || left.slots.len() != right.slots.len() {
        return Err(differ("блоки разной формы"));
    }
    let (bytes_a, bytes_b) = (a.content(x), b.content(y));
    let common = bytes_a.len().min(bytes_b.len());
    if [&bytes_a[common..], &bytes_b[common..]].iter().any(|tail| tail.iter().any(|&byte| byte != 0)) {
        return Err(differ("содержимое блока длиннее второго блока"));
    }
    let mut skipped = vec![false; common];
    for slot in &left.slots {
        // Слово, перешагнувшее конец блока, лежит в нём до конца, а остаток закрывает начало следующего (`spilled_head`).
        let inside = (slot.relative + 8).min(bytes_a.len());
        if inside > common {
            return Err(differ("указатель в хвосте блока"));
        }
        skipped[slot.relative..inside].fill(true);
    }
    skipped[..spilled_head(a, x).max(spilled_head(b, y)).min(common)].fill(true);
    if x_is_map {
        // Счётчики страниц карты не сверяются; у короткого партнёра от них остаётся то, что есть.
        let counters = MAP_COUNTERS.min(common)..(MAP_COUNTERS + 2).min(common);
        skipped[counters].fill(true);
    }
    let unequal = bytes_a[..common].iter().zip(&bytes_b[..common]).zip(&skipped).any(|((p, q), &skip)| !skip && p != q);
    if unequal {
        return Err(differ("байты блока вне указателей"));
    }
    Ok(())
}

/// Сверяет пару слотов и возвращает блоки их целей.
fn compare_pointers(a: &Graph, b: &Graph, slot_a: &Slot, slot_b: &Slot) -> Result<(usize, usize)> {
    if slot_a.relative != slot_b.relative || slot_a.target.segment != slot_b.target.segment {
        return Err(differ("указатели стоят иначе"));
    }
    let (Some(ta), Some(tb)) = (a.block_at(slot_a.target), b.block_at(slot_b.target)) else {
        return Err(differ("указатель вне блоков"));
    };
    let inside = |graph: &Graph, slot: &Slot, block: usize| slot.target.offset - graph.blocks[block].start;
    if inside(a, slot_a, ta) != inside(b, slot_b, tb) {
        return Err(differ("указатель не на начало блока"));
    }
    Ok((ta, tb))
}

pub fn same_graph(a: &Graph, b: &Graph) -> Result<()> {
    let (Some(root_a), Some(root_b)) = (a.root(), b.root()) else {
        return Err(differ("нет корня"));
    };
    if a.blocks.len() != b.blocks.len() {
        return Err(differ("разное число блоков"));
    }
    let map = a.map_block();
    let mut pairing = Pairing::default();
    pairing.claim(root_a, root_b);
    // Рабочий список обходится по очереди: пары берутся в порядке появления.
    let mut work = vec![(root_a, root_b)];
    let mut done = 0;
    while let Some(&(x, y)) = work.get(done) {
        done += 1;
        compare_content(a, b, x, y, map == Some(x))?;
        for (slot_a, slot_b) in a.blocks[x].slots.iter().zip(&b.blocks[y].slots) {
            let (ta, tb) = compare_pointers(a, b, slot_a, slot_b)?;
            match pairing.claim(ta, tb) {
                Claim::Fresh => work.push((ta, tb)),
                Claim::Agreed => {}
                Claim::Conflict => return Err(differ("указатели ведут в разные блоки")),
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Правки
// ---------------------------------------------------------------------------------------------

/// Область приёмника, добитая нулями до `base`, и следом область источника.
fn splice(own: &[u8], extra: &[u8], base: usize) -> Vec<u8> {
    let mut joined = own.to_vec();
    joined.resize(base, 0);
    joined.extend_from_slice(extra);
    joined
}

/// Начала страниц склейки: приёмника, источника со сдвигом, начало вставки и начала графических блоков вставки.
fn grafted_page_starts(target: &Graph, source: &Graph, bases: [usize; 2]) -> [Vec<usize>; 2] {
    [0, 1].map(|lane| {
        let shifted = source.page_starts[lane].iter().map(|start| start + bases[lane]);
        let own_blocks = source.lanes[lane].iter().map(|&index| source.blocks[index].start + bases[lane]);
        let wanted: BTreeSet<usize> = target.page_starts[lane]
            .iter()
            .copied()
            .chain(shifted)
            .chain(iter::once(bases[lane]))
            .chain(own_blocks.filter(|_| lane == 1))
            .collect();
        wanted.into_iter().collect()
    })
}

/// Вставляет граф `source` в конец областей `target`; слова-указатели в байтах не переписываются.
pub fn graft(target: &Graph, source: &Graph) -> Result<(Graph, Address)> {
    let root = source.root().ok_or_else(|| Error::broken(MSG_NO_SOURCE_ROOT))?;
    let bases = [target.system.len(), target.graphics.len()].map(|len| len.next_multiple_of(ALIGN));
    let mut areas = [
        splice(&target.system, &source.system, bases[0]),
        splice(&target.graphics, &source.graphics, bases[1]),
    ];

    let mut blocks: Vec<Block> =
        target.blocks.iter().cloned().chain(source.blocks.iter().map(|block| block.moved(bases))).collect();

    // У вложенного объекта карты страниц быть не должно: слот и его слово убираются.
    let inserted = &mut blocks[target.blocks.len() + root];
    if inserted.slots.iter().any(|slot| slot.relative == MAP_SLOT) {
        inserted.slots.retain(|slot| slot.relative != MAP_SLOT);
        let word = inserted.start + MAP_SLOT;
        if let Some(bytes) = areas[0].get_mut(word..word + 8) {
            bytes.fill(0);
        }
    }

    let at = Address { segment: Segment::System, offset: bases[0] + source.blocks[root].start };
    let page_starts = grafted_page_starts(target, source, bases);
    Ok((Graph::assemble(target.header(), areas, blocks, page_starts), at))
}

/// Дописывает блок в конец области (с выравниванием 16) и возвращает его номер.
pub fn append_block(graph: &mut Graph, segment: Segment, bytes: Vec<u8>, slots: Vec<Slot>) -> usize {
    let start = graph.extend_area(segment, &bytes);
    let index = graph.blocks.len();
    graph.blocks.push(Block { segment, start, end: start + bytes.len(), slots });
    graph.lanes[segment.lane()].push(index);
    let pages = &mut graph.page_starts[segment.lane()];
    if pages.last() != Some(&start) {
        pages.push(start);
    }
    index
}

pub fn write_at(graph: &mut Graph, block: usize, relative: usize, bytes: &[u8]) -> Result<()> {
    let (segment, start, room) = {
        let target = &graph.blocks[block];
        (target.segment, target.start, target.size())
    };
    if relative.checked_add(bytes.len()).is_none_or(|end| end > room) {
        return Err(Error::broken(MSG_WRITE_BOUNDS));
    }
    let from = start + relative;
    graph.area_mut(segment)[from..from + bytes.len()].copy_from_slice(bytes);
    Ok(())
}

pub fn retarget(graph: &mut Graph, block: usize, relative: usize, to: Address) -> Result<()> {
    graph.block_starting_at(to).ok_or_else(|| Error::broken(MSG_BAD_TARGET))?;
    let slot = graph.blocks[block]
        .slots
        .iter_mut()
        .find(|slot| slot.relative == relative)
        .ok_or_else(|| Error::broken(MSG_NO_SLOT))?;
    slot.target = to;
    Ok(())
}

pub fn pointer_from(graph: &Graph, block: usize, relative: usize) -> Option<Address> {
    graph.slot_at(block, relative).map(|slot| slot.target)
}

pub fn dictionary_address(graph: &Graph) -> Option<Address> {
    let group = graph.block_at(pointer_from(graph, graph.root()?, 0x10)?)?;
    pointer_from(graph, group, 0x08)
}

// ---------------------------------------------------------------------------------------------
// Выделение
// ---------------------------------------------------------------------------------------------

/// Обходчик достижимых блоков: отдаёт по одному блоку, отказывает на указателе вне блоков.
struct Reach<'g> {
    graph: &'g Graph,
    seen: Vec<bool>,
    pending: Vec<usize>,
}

impl<'g> Reach<'g> {
    fn from_seeds(graph: &'g Graph, seeds: impl IntoIterator<Item = usize>) -> Self {
        let mut seen = vec![false; graph.blocks.len()];
        let pending = seeds.into_iter().filter(|&seed| !std::mem::replace(&mut seen[seed], true)).collect();
        Reach { graph, seen, pending }
    }

    /// Обходит всё и отдаёт отметки достигнутых блоков.
    fn marks(mut self) -> Result<Vec<bool>> {
        self.by_ref().try_for_each(|visit| visit.map(drop))?;
        Ok(self.seen)
    }
}

impl Iterator for Reach<'_> {
    type Item = Result<usize>;

    fn next(&mut self) -> Option<Self::Item> {
        let graph = self.graph;
        let index = self.pending.pop()?;
        for slot in &graph.blocks[index].slots {
            let Some(next) = graph.block_at(slot.target) else {
                self.pending.clear();
                return Some(Err(Error::broken(MSG_OUTSIDE)));
            };
            if !std::mem::replace(&mut self.seen[next], true) {
                self.pending.push(next);
            }
        }
        Some(Ok(index))
    }
}

/// Блоки нового графа по областям: в системной корень первым, остальные в прежнем порядке.
fn pick_blocks(graph: &Graph, root: usize, marks: &[bool]) -> [Vec<usize>; 2] {
    let others = |segment: Segment| {
        graph.segment_blocks(segment).iter().copied().filter(|&index| marks[index]).collect::<Vec<_>>()
    };
    let system = iter::once(root).chain(others(Segment::System).into_iter().filter(|&index| index != root)).collect();
    [system, others(Segment::Graphics)]
}

/// Собирает новый граф из выбранных блоков: в каждой области блоки подряд, начало — по выравниванию старого.
/// Слоты переносятся на новые цели, байты слов не переписываются.
fn compact(graph: &Graph, lists: [Vec<usize>; 2]) -> Result<Graph> {
    // Новые начала: накопительно по списку каждой области.
    let layouts = lists.map(|list| {
        list.iter()
            .scan(0usize, |cursor, &index| {
                let old = &graph.blocks[index];
                let start = cursor.next_multiple_of(alignment_of(old.start));
                *cursor = start + old.size();
                Some((index, start))
            })
            .collect::<Vec<_>>()
    });
    let mut moved: Vec<Option<Address>> = vec![None; graph.blocks.len()];
    for ((segment, _), layout) in AREAS.iter().zip(&layouts) {
        for &(index, offset) in layout {
            moved[index] = Some(Address { segment: *segment, offset });
        }
    }
    let carry = |slot: &Slot| -> Result<Slot> {
        let hit = graph.block_at(slot.target).ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
        let home = moved[hit].expect("цель отмечена");
        let inside = slot.target.offset - graph.blocks[hit].start;
        Ok(Slot { relative: slot.relative, target: Address { segment: home.segment, offset: home.offset + inside } })
    };

    let mut areas: [Vec<u8>; 2] = Default::default();
    let mut page_starts: [Vec<usize>; 2] = Default::default();
    let mut blocks = Vec::new();
    for ((segment, _), layout) in AREAS.iter().zip(&layouts) {
        let lane = segment.lane();
        for &(index, start) in layout {
            let old = &graph.blocks[index];
            areas[lane].resize(start, 0);
            areas[lane].extend_from_slice(&graph.bytes(*segment)[old.start..old.end]);
            let slots = old.slots.iter().map(&carry).collect::<Result<Vec<_>>>()?;
            blocks.push(Block { segment: *segment, start, end: start + old.size(), slots });
            if graph.page_starts[lane].binary_search(&old.start).is_ok() {
                page_starts[lane].push(start);
            }
        }
    }
    Ok(Graph::assemble(graph.header(), areas, blocks, page_starts))
}

/// Блок с корнем и всё, что от него достижимо.
pub fn subgraph(graph: &Graph, root: Address) -> Result<Graph> {
    let start = graph.block_starting_at(root).ok_or_else(|| Error::broken(MSG_ROOT_OUTSIDE))?;
    if graph.blocks[start].segment != Segment::System {
        return Err(Error::broken(MSG_ROOT_AREA));
    }
    let marks = Reach::from_seeds(graph, [start]).marks()?;
    compact(graph, pick_blocks(graph, start, &marks))
}

/// Убирает графические блоки, на которые ничто не ссылается; системные остаются все.
pub fn drop_unreferenced_graphics(graph: &Graph) -> Result<Graph> {
    let root = graph.root().ok_or_else(|| Error::broken(MSG_ROOT_OUTSIDE))?;
    let marks = Reach::from_seeds(graph, graph.segment_blocks(Segment::System).iter().copied()).marks()?;
    compact(graph, pick_blocks(graph, root, &marks))
}

// ---------------------------------------------------------------------------------------------
// Перенос интервалов
// ---------------------------------------------------------------------------------------------

/// Сливает интервалы, которые пересекаются или касаются: заметающий проход по событиям, открытие раньше закрытия.
fn merge_spans(spans: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut events: Vec<(usize, u8)> = spans.iter().flat_map(|&(start, end)| [(start, 0), (end, 1)]).collect();
    events.sort_unstable();
    let mut depth = 0usize;
    let mut opened = 0;
    let mut merged = Vec::new();
    for (at, kind) in events {
        if kind == 0 {
            if depth == 0 {
                opened = at;
            }
            depth += 1;
        } else {
            depth -= 1;
            if depth == 0 {
                merged.push((opened, at));
            }
        }
    }
    merged
}

/// Отбирает рабочие интервалы по областям; пустые пропускаются, выходящие за область — отказ.
fn gather_intervals(graph: &Graph, intervals: &[(Segment, usize, usize)]) -> Result<[Vec<(usize, usize)>; 2]> {
    let mut wanted: [Vec<(usize, usize)>; 2] = Default::default();
    for &(segment, start, end) in intervals.iter().filter(|&&(_, start, end)| start < end) {
        if end > graph.bytes(segment).len() {
            return Err(Error::broken(MSG_INTERVAL));
        }
        wanted[segment.lane()].push((start, end));
    }
    Ok(wanted)
}

/// Слова слотов области: каждое слово, начатое внутри интервала и не кончающееся в нём, растягивает интервал.
fn stretch_to_words(spans: &mut [(usize, usize)], words: &[(usize, usize)]) {
    for &(word_start, word_end) in words {
        spans
            .iter_mut()
            .filter(|span| span.0 <= word_start && word_start < span.1 && word_end > span.1)
            .for_each(|span| span.1 = word_end);
    }
}

/// Переносит интервалы областей в новые блоки; области остаются полной длины, адреса прежние.
/// Второй результат — число перенесённых слотов.
pub fn repack(graph: &Graph, intervals: &[(Segment, usize, usize)]) -> Result<(Graph, usize)> {
    let wanted = gather_intervals(graph, intervals)?;
    let mut areas = [graph.system.clone(), graph.graphics.clone()];
    let mut spans: [Vec<(usize, usize)>; 2] = Default::default();
    for (lane, (segment, _)) in AREAS.iter().enumerate() {
        let words: Vec<(usize, usize)> = graph
            .blocks
            .iter()
            .filter(|block| block.segment == *segment)
            .flat_map(|block| block.slots.iter().map(|slot| block.word_span(slot)))
            .collect();
        let mut stretched = merge_spans(&wanted[lane]);
        stretch_to_words(&mut stretched, &words);
        // Начало идёт вниз до кратного 8; добавленные байты, не покрытые интервалами, зануляются.
        let covered = |at: usize| stretched.iter().any(|&(start, end)| start <= at && at < end);
        for &(start, _) in &stretched {
            let from = start & !7;
            for (k, byte) in areas[lane][from..start].iter_mut().enumerate() {
                if !covered(from + k) {
                    *byte = 0;
                }
            }
        }
        let rounded: Vec<(usize, usize)> = stretched.iter().map(|&(start, end)| (start & !7, end)).collect();
        spans[lane] = merge_spans(&rounded);
    }

    let mut blocks: Vec<Block> = AREAS
        .iter()
        .zip(&spans)
        .flat_map(|((segment, _), list)| {
            list.iter().map(move |&(start, end)| Block { segment: *segment, start, end, slots: Vec::new() })
        })
        .collect();
    let first_of = [0, spans[0].len()];
    let mut carried = 0;
    for old in &graph.blocks {
        let lane = old.segment.lane();
        for slot in &old.slots {
            let (word_start, word_end) = old.word_span(slot);
            let home = spans[lane]
                .partition_point(|&(start, _)| start <= word_start)
                .checked_sub(1)
                .filter(|&nth| word_end <= spans[lane][nth].1);
            if let Some(nth) = home {
                let block = &mut blocks[first_of[lane] + nth];
                block.slots.push(Slot { relative: word_start - block.start, target: slot.target });
                carried += 1;
            }
        }
    }
    Ok((Graph::assemble(graph.header(), areas, blocks, graph.page_starts.clone()), carried))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use crate::resource::{read_header, Header};
    use crate::texture::{self, Format};
    use crate::ytd_write::{self, payload_bytes, NewTexture};
    use std::ops::Range;
    use std::sync::Mutex;

    const SYS: Segment = Segment::System;
    const GFX: Segment = Segment::Graphics;

    fn at(segment: Segment, offset: usize) -> Address {
        Address { segment, offset }
    }

    /// Две области с вписанными словами-указателями.
    struct Canvas {
        system: Vec<u8>,
        graphics: Vec<u8>,
    }

    impl Canvas {
        fn new(system: usize, graphics: usize) -> Self {
            Canvas { system: vec![0; system], graphics: vec![0; graphics] }
        }

        fn area(&mut self, segment: Segment) -> &mut Vec<u8> {
            match segment {
                SYS => &mut self.system,
                GFX => &mut self.graphics,
            }
        }

        fn word(&mut self, from: (Segment, usize), value: u64) -> &mut Self {
            self.area(from.0)[from.1..from.1 + 8].copy_from_slice(&value.to_le_bytes());
            self
        }

        fn ptr(&mut self, from: (Segment, usize), to: (Segment, usize)) -> &mut Self {
            self.word(from, to.0.base() + to.1 as u64)
        }

        fn fill(&mut self, segment: Segment, range: Range<usize>, byte: u8) -> &mut Self {
            self.area(segment)[range].fill(byte);
            self
        }

        fn graph(&self, version: u32, system_flags: u32, graphics_flags: u32) -> Graph {
            from_parts(version, system_flags, graphics_flags, self.system.clone(), self.graphics.clone())
        }
    }

    /// Система 96 байт: корень со слотами `0→0x20`, `8→0x30`, блок со слотом в графику, блок на 48 байт.
    fn sample() -> Graph {
        let mut c = Canvas::new(96, 0);
        c.ptr((SYS, 0), (SYS, 32)).ptr((SYS, 8), (SYS, 48)).fill(SYS, 16..24, 7);
        c.ptr((SYS, 32), (GFX, 0)).fill(SYS, 40..48, 9).fill(SYS, 48..64, 5).fill(SYS, 64..96, 3);
        c.graphics = vec![0x22; 40];
        c.graph(165, 0, 0)
    }

    /// Система 0x1E00 (флаги `0xAF000000`), графика 0x1000 (`0x51000000`): блоки системы на 0, 0x40, 0x80, 0x1000,
    /// 0x1800, 0x1C00, графики — на 0 и 0x100; слот корня `8` ведёт на блок 0x1000.
    fn paged() -> Graph {
        let mut c = Canvas::new(0x1e00, 0x1000);
        c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x1000)).ptr((SYS, 16), (SYS, 0x1800));
        c.ptr((SYS, 24), (SYS, 0x1c00)).ptr((SYS, 0x40), (SYS, 0x80)).ptr((SYS, 0x48), (GFX, 0x100));
        c.fill(SYS, 0x50..0x80, 0x41).fill(SYS, 0x88..0x1000, 0x42).fill(SYS, 0x1008..0x1800, 0x43);
        c.fill(SYS, 0x1808..0x1c00, 0x44).fill(SYS, 0x1c08..0x1e00, 0x45).ptr((SYS, 0x80), (GFX, 0));
        c.fill(GFX, 0..0x100, 0x61).fill(GFX, 0x108..0x1000, 0x62);
        c.graph(165, 0xAF00_0000, 0x5100_0000)
    }

    fn orders(graph: &Graph) -> (Vec<usize>, Vec<usize>) {
        (identity_order(graph, SYS), identity_order(graph, GFX))
    }

    fn raw(body: &[u8]) -> Vec<u8> {
        body.to_vec()
    }

    /// Файл, собранный без сжатия: заголовок и обе области.
    struct Flat {
        head: [u8; 16],
        system_flags: u32,
        graphics_flags: u32,
        system: Vec<u8>,
        graphics: Vec<u8>,
    }

    fn flat(graph: &Graph, system_order: &[usize], graphics_order: &[usize]) -> Flat {
        let out = rebuild_with(graph, system_order, graphics_order, &raw).unwrap();
        let word = |k: usize| u32::from_le_bytes(out[4 * k..4 * k + 4].try_into().unwrap());
        let (system_flags, graphics_flags) = (word(2), word(3));
        let system_size = page_flag_size(system_flags);
        assert_eq!(out.len(), 16 + system_size + page_flag_size(graphics_flags));
        Flat {
            head: out[..16].try_into().unwrap(),
            system_flags,
            graphics_flags,
            system: out[16..16 + system_size].to_vec(),
            graphics: out[16 + system_size..].to_vec(),
        }
    }

    fn flat_identity(graph: &Graph) -> Flat {
        let (system, graphics) = orders(graph);
        flat(graph, &system, &graphics)
    }

    fn word_at(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    fn failure<T: std::fmt::Debug>(result: Result<T>) -> String {
        let error = result.unwrap_err();
        assert_eq!(error.kind, Kind::Broken);
        error.message
    }

    static HOOK: Mutex<()> = Mutex::new(());

    /// Сообщение паники вызова (пустая строка, если паники нет); обработчик паники на время подменяется.
    fn panic_text<R>(call: impl FnOnce() -> R + std::panic::UnwindSafe) -> String {
        let _turn = HOOK.lock().unwrap_or_else(|held| held.into_inner());
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let caught = std::panic::catch_unwind(call);
        std::panic::set_hook(hook);
        match caught {
            Ok(_) => String::new(),
            Err(payload) => payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default(),
        }
    }

    type Shape = Vec<(Segment, usize, usize, Vec<(usize, Segment, usize)>)>;

    fn shape(graph: &Graph) -> Shape {
        graph
            .blocks
            .iter()
            .map(|b| {
                let slots = b.slots.iter().map(|s| (s.relative, s.target.segment, s.target.offset)).collect();
                (b.segment, b.start, b.end, slots)
            })
            .collect()
    }

    /// Размеры страниц, которые описывают флаги, от больших к малым.
    fn pages_of(flags: u32) -> Vec<usize> {
        let unit = 0x200usize << (flags & 0xf);
        let fields = [(4, 1, 256), (5, 2, 128), (7, 4, 64), (11, 6, 32), (17, 7, 16), (24, 1, 8), (25, 1, 4), (26, 1, 2), (27, 1, 1)];
        let mut sizes = Vec::new();
        for (low, width, weight) in fields {
            for _ in 0..(flags >> low) & ((1 << width) - 1) {
                sizes.push(unit * weight);
            }
        }
        sizes
    }

    // =========================================================================================
    // Старые тесты модуля (с синтетическими входами вместо корпуса)
    // =========================================================================================

    #[test]
    fn every_piece_lies_on_one_page_and_the_first_opens_the_region() {
        let mut sizes = vec![0x150usize, 700_000, 700_000, 175_000, 700_000, 44_000];
        sizes.extend((0..400).map(|i| 200 + i * 37));
        let pages = pack_pages(&sizes, 0x5000_0000, 128).unwrap();
        assert_eq!(pages.starts[0], 0);
        assert_eq!(pages.flags & 0xf000_0000, 0x5000_0000);
        assert_eq!(pages.size, page_flag_size(pages.flags));
        let page_sizes = pages_of(pages.flags);
        assert_eq!(page_sizes.len(), pages.count as usize);
        assert!(pages.count <= 128);
        let mut bounds = Vec::new();
        let mut edge = 0;
        for size in &page_sizes {
            bounds.push((edge, edge + size));
            edge += size;
        }
        let mut placed: Vec<(usize, usize)> = Vec::new();
        for (&start, &size) in pages.starts.iter().zip(&sizes) {
            assert_eq!(start % 16, 0);
            assert!(bounds.iter().any(|&(from, to)| from <= start && start + size <= to), "кусок {start:#x}+{size:#x}");
            placed.push((start, start + size));
        }
        placed.sort_unstable();
        assert!(placed.windows(2).all(|pair| pair[0].1 <= pair[1].0));
        assert_eq!((pages.flags, pages.size, pages.count), (0x5022_0064, 0x52_0000, 20));
    }

    #[test]
    fn too_many_pages_raise_the_page_size() {
        let sizes = vec![0x2000usize; 300];
        assert!(pack_pages(&sizes, 0, 128).unwrap().count <= 128);
        assert!(pack_pages(&sizes, 0, 4).unwrap().count <= 4);
    }

    #[test]
    fn a_new_large_block_rebuilds_without_crossing_pages() {
        let mut graph = sample();
        append_block(&mut graph, GFX, vec![7; 700_000], Vec::new());
        let out = rebuild(&graph, &identity_order(&graph, SYS), &identity_order(&graph, GFX)).unwrap();
        let parsed = Resource::parse(&out).unwrap();
        let header = parsed.header;
        assert_eq!(header.graphics_flags, 0x13);
        assert_eq!(header.graphics_size, 0x10_0000);
        let graphics = &parsed.data()[header.system_size..];
        let first = graphics.iter().position(|&b| b == 7).unwrap();
        let last = graphics.iter().rposition(|&b| b == 7).unwrap();
        // Графика раскладывается плотно (10.11.2026): у неё нет «корня первым», крупный блок встаёт на начало страницы,
        // прежний блок в 40 байт — следом, на выровненном месте.
        assert_eq!((first, last + 1), (0, 700_000));
        assert!(graphics[first..=last].iter().all(|&b| b == 7));
        assert!(graphics[700_000..700_040].iter().all(|&b| b == 0x22));

        let (merged, address) = graft(&graph, &scan(&parsed).unwrap()).unwrap();
        let inserted = merged.block_at(address).unwrap();
        assert_eq!(address, at(SYS, 0x60));
        assert!(pointer_from(&merged, inserted, 8).is_none());
        assert_eq!(merged.content(inserted)[8..16], [0; 8]);
    }

    #[test]
    fn flags_describe_exactly_the_pages_asked_for() {
        for shift in 0..4u32 {
            for pages in 0..=MAX_PAGES {
                let len = pages * (HEADER_PAGE << shift);
                let (flags, size) = sized(len, 0x5000_0000).unwrap();
                assert_eq!(size, len, "страниц {pages}, сдвиг {shift}");
                assert_eq!(flags & 0xf000_0000, 0x5000_0000);
                assert_eq!(page_flag_size(flags), len);
            }
        }
    }

    #[test]
    fn blocks_follow_pointer_targets_and_the_root_is_block_zero() {
        let graph = sample();
        let root = graph.root().unwrap();
        assert_eq!((graph.blocks[root].start, graph.blocks[root].end), (0, 32));
        assert_eq!(graph.blocks[root].slots.len(), 2);
        let starts: Vec<usize> = graph.segment_blocks(SYS).iter().map(|&b| graph.blocks[b].start).collect();
        assert_eq!(starts, [0, 32, 48]);
    }

    #[test]
    fn a_reversed_layout_rebuilds_into_the_same_graph() {
        let graph = sample();
        let (mut system, graphics) = orders(&graph);
        system[1..].reverse();
        let out = rebuild(&graph, &system, &graphics).unwrap();
        let header = read_header(&out).unwrap();
        assert_eq!(
            header.system_size + header.graphics_size,
            page_flag_size(header.system_flags) + page_flag_size(header.graphics_flags)
        );
        let again = scan(&Resource::parse(&out).unwrap()).unwrap();
        same_graph(&graph, &again).unwrap();
    }

    #[test]
    fn a_size_descending_layout_keeps_the_same_graph() {
        let graph = sample();
        let system = size_descending_order(&graph, SYS);
        assert_eq!(system[0], graph.root().unwrap());
        let out = rebuild(&graph, &system, &identity_order(&graph, GFX)).unwrap();
        same_graph(&graph, &scan(&Resource::parse(&out).unwrap()).unwrap()).unwrap();
    }

    #[test]
    fn a_damaged_pointer_is_refused() {
        let graph = sample();
        let (system, graphics) = orders(&graph);
        let out = rebuild(&graph, &system, &graphics).unwrap();
        let mut damaged = scan(&Resource::parse(&out).unwrap()).unwrap();
        let first = damaged.segment_blocks(SYS)[0];
        damaged.blocks[first].slots[0].target.offset += 8;
        assert!(same_graph(&graph, &damaged).is_err());
    }

    #[test]
    fn the_root_must_stay_first() {
        let graph = sample();
        let (mut system, graphics) = orders(&graph);
        system.swap(0, 1);
        assert!(rebuild(&graph, &system, &graphics).is_err());
    }

    /// Свойства перекладки на наборе синтетических графов вместо корпуса игры.
    #[test]
    fn synthetic_graphs_rebuild_into_the_same_graph() {
        let mut with_map = Canvas::new(0x100, 0x40);
        with_map.ptr((SYS, 0), (SYS, 0x80)).ptr((SYS, 8), (SYS, 0x40)).ptr((SYS, 16), (SYS, 0xc0));
        with_map.fill(SYS, 0x40..0x80, 0x4d).fill(SYS, 0x88..0xc0, 0x41).fill(SYS, 0xc8..0x100, 0x43);
        with_map.ptr((SYS, 0x80), (GFX, 0)).fill(GFX, 8..0x40, 0x62);
        // Вставка без слота +8 и дописанный блок, на который кто-то ссылается: всё достижимо, пересчёт сохраняет блоки.
        let mut inserted = Canvas::new(0x40, 0x48);
        inserted.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 16), (SYS, 0x38));
        inserted.ptr((SYS, 0x20), (GFX, 0)).ptr((SYS, 0x28), (GFX, 0x18)).ptr((SYS, 0x30), (GFX, 0x30));
        let (mut grafted, place) = graft(&sample(), &inserted.graph(13, 0, 0)).unwrap();
        grafted.blocks[0].slots.push(Slot { relative: 16, target: place });
        let added = append_block(&mut grafted, SYS, vec![0xcc; 100], vec![Slot { relative: 8, target: at(GFX, 0) }]);
        let start = grafted.blocks[added].start;
        grafted.blocks[0].slots.push(Slot { relative: 24, target: at(SYS, start) });
        let graphs = [sample(), paged(), with_map.graph(165, 0xA000_0000, 0x5000_0000), grafted];
        let mut checked = 0;
        for graph in &graphs {
            let identity = orders(graph);
            let descending = (size_descending_order(graph, SYS), size_descending_order(graph, GFX));
            for (system, graphics) in [identity, descending] {
                let out = rebuild(graph, &system, &graphics).unwrap();
                let header = read_header(&out).unwrap();
                assert_eq!(header.system_size, page_flag_size(header.system_flags));
                let parsed = Resource::parse(&out).unwrap();
                assert_eq!(parsed.data().len(), header.system_size + header.graphics_size);
                let again = scan(&parsed).unwrap();
                same_graph(graph, &again).unwrap();
                if let Some(map) = again.map_block() {
                    let content = again.content(map);
                    let system_pages = pages_of(header.system_flags).len();
                    let graphics_pages = pages_of(header.graphics_flags).len();
                    assert_eq!(content[8] as usize, system_pages);
                    assert_eq!(content[9] as usize, graphics_pages);
                    assert!(content.len() >= 16 + 8 * (system_pages + graphics_pages));
                }
                for block in &again.blocks {
                    for slot in &block.slots {
                        let target = again.block_at(slot.target).unwrap();
                        assert_eq!(again.blocks[target].start, slot.target.offset);
                    }
                }
                checked += 1;
            }
        }
        assert_eq!(checked, 8);
    }

    // --- вставка и выделение словаря текстур (синтетические аналоги проверок на моделях) ---

    fn texture(name: &str, fill: u8) -> NewTexture {
        NewTexture {
            name: name.into(),
            width: 64,
            height: 64,
            format: Format::Dxt1,
            levels: 1,
            payload: vec![fill; payload_bytes(Format::Dxt1, 64, 64, 1)],
        }
    }

    fn texture_set(resource: &Resource) -> Vec<(String, u32, u32, u32)> {
        let mut set: Vec<_> = texture::read_dictionary_at(resource, resource.root())
            .unwrap()
            .iter()
            .map(|t| (t.name.clone(), t.width, t.height, t.levels))
            .collect();
        set.sort();
        set
    }

    fn named(names: &[&str]) -> Vec<(String, u32, u32, u32)> {
        names.iter().map(|n| (n.to_string(), 64, 64, 1)).collect()
    }

    fn two_dictionaries() -> (Graph, Graph) {
        let host = ytd_write::write(&[texture("astral_shop_a", 0x11), texture("astral_shop_b", 0x22)]).unwrap();
        let extra = ytd_write::write(&[
            texture("astral_new_1", 0x33),
            texture("astral_new_2", 0x44),
            texture("astral_new_3", 0x55),
        ])
        .unwrap();
        (
            scan(&Resource::parse(&host).unwrap()).unwrap(),
            scan(&Resource::parse(&extra).unwrap()).unwrap(),
        )
    }

    #[test]
    fn a_new_embedded_dictionary_reads_back_from_the_rebuilt_dictionary() {
        let (host, extra) = two_dictionaries();
        let (merged, address) = graft(&host, &extra).unwrap();
        assert_eq!(address, at(SYS, 0x2000));
        assert_eq!(merged.blocks.len(), host.blocks.len() + extra.blocks.len());
        assert!(pointer_from(&merged, merged.block_at(address).unwrap(), 8).is_none());
        let (system, graphics) = orders(&merged);
        let all = rebuild(&merged, &system, &graphics).unwrap();
        assert_eq!(texture_set(&Resource::parse(&all).unwrap()), named(&["astral_shop_a", "astral_shop_b"]));
    }

    #[test]
    fn the_embedded_dictionary_extracts_as_a_standalone_resource() {
        let (host, extra) = two_dictionaries();
        let (merged, address) = graft(&host, &extra).unwrap();
        let alone = subgraph(&merged, address).unwrap();
        let (system, graphics) = orders(&alone);
        let file = rebuild(&alone, &system, &graphics).unwrap();
        assert_eq!(
            texture_set(&Resource::parse(&file).unwrap()),
            named(&["astral_new_1", "astral_new_2", "astral_new_3"])
        );
        // Корень приёмника из той же склейки читается как прежний словарь.
        let first = subgraph(&merged, at(SYS, 0)).unwrap();
        let (system, graphics) = orders(&first);
        let file = rebuild(&first, &system, &graphics).unwrap();
        assert_eq!(texture_set(&Resource::parse(&file).unwrap()), named(&["astral_shop_a", "astral_shop_b"]));
    }

    #[test]
    fn a_rebuilt_dictionary_still_reads() {
        let (host, _) = two_dictionaries();
        assert_eq!(host.blocks.len(), 10);
        let (system, graphics) = orders(&host);
        let out = rebuild(&host, &system, &graphics).unwrap();
        assert_eq!(texture_set(&Resource::parse(&out).unwrap()), named(&["astral_shop_a", "astral_shop_b"]));
    }

    // =========================================================================================
    // Разбор
    // =========================================================================================

    #[test]
    fn empty_and_tiny_areas_become_tiny_graphs() {
        let empty = from_parts(165, 0, 0, vec![], vec![]);
        assert!(empty.blocks.is_empty() && empty.root().is_none());
        let one = Canvas::new(16, 0).graph(13, 0, 0);
        assert_eq!(shape(&one), [(SYS, 0, 16, vec![])]);
        assert_eq!(one.root(), Some(0));
        let graphics_only = Canvas::new(0, 16).graph(13, 0, 0);
        assert_eq!(graphics_only.root(), None);
        let mut crossing = Canvas::new(12, 0);
        crossing.ptr((SYS, 0), (SYS, 8));
        assert_eq!(
            shape(&crossing.graph(165, 0, 0)),
            [(SYS, 0, 8, vec![(0, SYS, 8)]), (SYS, 8, 12, vec![])]
        );
        let mut seven = Canvas::new(7, 0);
        seven.fill(SYS, 0..7, 0xff);
        assert_eq!(shape(&seven.graph(165, 0, 0)), [(SYS, 0, 7, vec![])]);
    }

    #[test]
    fn only_words_inside_an_area_are_pointers() {
        let mut c = Canvas::new(128, 32);
        c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x80)).ptr((SYS, 16), (SYS, 0x7f));
        c.ptr((SYS, 24), (GFX, 0x10)).ptr((SYS, 32), (GFX, 0x20)).word((SYS, 40), 0x4fff_ffff);
        c.ptr((SYS, 48), (SYS, 0)).word((SYS, 56), u64::MAX).word((SYS, 64), 0x1_5000_0010);
        c.word((SYS, 72), 0x7000_0000);
        c.system[100..108].copy_from_slice(&(SYSTEM_BASE + 0x60).to_le_bytes());
        c.ptr((SYS, 112), (SYS, 4)).word((SYS, 120), 0);
        c.ptr((GFX, 0), (SYS, 0x40)).ptr((GFX, 8), (GFX, 8)).word((GFX, 16), 0x5000_0001).word((GFX, 24), 0x5fff_ffff);
        let graph = c.graph(165, 0, 0);
        let expected = [
            (SYS, 0, 1, vec![(0, SYS, 0x40)]),
            (SYS, 1, 4, vec![]),
            (SYS, 4, 0x40, vec![(12, SYS, 0x7f), (20, GFX, 0x10), (44, SYS, 0)]),
            (SYS, 0x40, 0x7f, vec![(48, SYS, 4)]),
            (SYS, 0x7f, 0x80, vec![]),
            (GFX, 0, 8, vec![(0, SYS, 0x40)]),
            (GFX, 8, 0x10, vec![(0, GFX, 8)]),
            (GFX, 0x10, 0x20, vec![(0, SYS, 1)]),
        ];
        assert_eq!(shape(&graph), expected);
        assert_eq!(graph.segment_blocks(SYS), [0, 1, 2, 3, 4]);
        assert_eq!(graph.segment_blocks(GFX), [5, 6, 7]);
    }

    #[test]
    fn a_word_may_step_over_the_next_block_start() {
        let mut c = Canvas::new(32, 0);
        c.ptr((SYS, 0), (SYS, 4));
        assert_eq!(
            shape(&c.graph(165, 0, 0)),
            [(SYS, 0, 4, vec![(0, SYS, 4)]), (SYS, 4, 0x20, vec![])]
        );
        let mut twice = Canvas::new(64, 0);
        twice.ptr((SYS, 0), (SYS, 32)).ptr((SYS, 8), (SYS, 32)).ptr((SYS, 40), (SYS, 32));
        assert_eq!(
            shape(&twice.graph(165, 0, 0)),
            [
                (SYS, 0, 0x20, vec![(0, SYS, 0x20), (8, SYS, 0x20)]),
                (SYS, 0x20, 0x40, vec![(8, SYS, 0x20)])
            ]
        );
    }

    /// Слово, которое режет начало блока посреди себя, на сборке пишется целиком: хвост слова лежит в соседнем блоке, и
    /// копия этого блока не вправе затирать его старыми байтами (столб `prop_streetlight_08`: ложный «указатель» на нечётное
    /// смещение 57 резал корень посреди настоящего слова `+0x38`, и после сборки оно вело не туда).
    #[test]
    fn a_pointer_word_cut_by_a_block_start_is_written_whole_on_rebuild() {
        // Слово `0 → 0x100` режет слово `0x10 → 1` после первого байта; блок `0x100` встаёт перед блоком `0x20` и меняет
        // средний байт своего адреса (был 0x0100, станет 0x0020).
        let mut c = Canvas::new(0x200, 0);
        c.ptr((SYS, 0), (SYS, 0x100)).ptr((SYS, 0x10), (SYS, 1)).ptr((SYS, 0x18), (SYS, 0x20));
        let graph = c.graph(165, 0, 0);
        assert_eq!(
            shape(&graph),
            [
                (SYS, 0, 1, vec![(0, SYS, 0x100)]),
                (SYS, 1, 0x20, vec![(0xf, SYS, 1), (0x17, SYS, 0x20)]),
                (SYS, 0x20, 0x100, vec![]),
                (SYS, 0x100, 0x200, vec![])
            ]
        );
        let out = flat(&graph, &[0, 1, 3, 2], &[]);
        assert_eq!(word_at(&out.system, 0), 0x5000_0020, "слово корня после сборки");
        assert_eq!(word_at(&out.system, 4), 0);
        assert_eq!(word_at(&out.system, 0x10), 0x5000_0001);
        // Перечитанный граф тот же: корень ведёт на блок, у которого было такое же содержимое и такие же слоты.
        let again = from_parts(165, out.system_flags, out.graphics_flags, out.system, out.graphics);
        assert_eq!(again.blocks[0].slots[0].target.offset, 0x20);
    }

    /// Сверка графов понимает слово, перешагнувшее начало блока: его хвост лежит в соседнем блоке и не считается «байтами
    /// вне указателей»; слово со старым хвостом (так писала сборка до правки) — другой граф.
    #[test]
    fn same_graph_follows_a_word_that_steps_over_a_block_start() {
        let mut c = Canvas::new(0x200, 0);
        c.ptr((SYS, 0), (SYS, 0x100)).ptr((SYS, 0x10), (SYS, 1)).ptr((SYS, 0x18), (SYS, 0x20));
        let graph = c.graph(165, 0, 0);
        let out = flat(&graph, &[0, 1, 3, 2], &[]);
        let again = from_parts(165, out.system_flags, out.graphics_flags, out.system.clone(), out.graphics.clone());
        same_graph(&graph, &again).unwrap();
        same_graph(&again, &graph).unwrap();
        let mut stale = out.system.clone();
        stale[1] = 0x01;
        let worn = from_parts(165, out.system_flags, out.graphics_flags, stale, out.graphics);
        assert!(same_graph(&graph, &worn).is_err());
    }

    #[test]
    fn access_helpers_follow_the_block_list() {
        let graph = sample();
        assert_eq!(graph.bytes(SYS).len(), 96);
        assert_eq!(graph.bytes(GFX).len(), 40);
        assert_eq!([0, 1, 2, 3].map(|b| graph.content(b).len()), [32, 16, 48, 40]);
        assert_eq!(graph.content(3), graph.bytes(GFX));
        let probes = [
            (at(SYS, 0x1f), Some(0)),
            (at(SYS, 0x20), Some(1)),
            (at(SYS, 0x30), Some(2)),
            (at(SYS, 0x5f), Some(2)),
            (at(SYS, 0x60), None),
            (at(SYS, usize::MAX), None),
            (at(GFX, 0), Some(3)),
            (at(GFX, 0x27), Some(3)),
            (at(GFX, 0x28), None),
        ];
        for (address, expected) in probes {
            assert_eq!(graph.block_at(address), expected, "{address:?}");
        }
        assert_eq!(Canvas::new(0, 16).graph(1, 0, 0).block_at(at(SYS, 0)), None);
        assert_eq!(Canvas::new(16, 0).graph(1, 0, 0).block_at(at(GFX, 0)), None);
        let index = "index out of bounds: the len is 4 but the index is 99";
        assert_eq!(panic_text(|| sample().content(99).len()), index);
        assert_eq!(panic_text(|| pointer_from(&sample(), 99, 0)), index);
    }

    #[test]
    fn scan_takes_header_sizes_and_ignores_the_tail() {
        let graph = sample();
        let mut data = graph.system.clone();
        data.extend_from_slice(&graph.graphics);
        let header = |system_flags, graphics_flags, declared_version| Header {
            system_flags,
            graphics_flags,
            system_size: 96,
            graphics_size: 40,
            version: 99,
            declared_version,
        };
        let exact = scan(&Resource::from_parts(header(0xA000_0000, 0x5000_0000, 165), data.clone())).unwrap();
        assert_eq!(shape(&exact), shape(&graph));
        assert_eq!((exact.system_flags, exact.graphics_flags, exact.declared_version), (0xA000_0000, 0x5000_0000, 165));

        let short = scan(&Resource::from_parts(header(0, 0, 7), data[..135].to_vec()));
        assert_eq!(failure(short), "Ресурс короче заявленного: разбирать нечего.");
        let nothing = scan(&Resource::from_parts(header(0, 0, 7), Vec::new()));
        assert_eq!(failure(nothing), "Ресурс короче заявленного: разбирать нечего.");

        let mut longer = data.clone();
        longer.extend_from_slice(&[0xee; 10]);
        let tail = scan(&Resource::from_parts(header(1, 2, 7), longer)).unwrap();
        assert_eq!(tail.graphics, graph.graphics);
        assert_eq!((tail.blocks.len(), tail.system_flags, tail.graphics_flags, tail.declared_version), (4, 1, 2, 7));
    }

    #[test]
    fn size_order_puts_the_root_first_and_only_in_the_system() {
        let mut c = Canvas::new(0x100, 0x60);
        c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 8), (SYS, 0x30)).ptr((SYS, 16), (SYS, 0x70)).ptr((SYS, 24), (SYS, 0x80));
        c.ptr((SYS, 0x20), (SYS, 0xc0)).ptr((SYS, 0x30), (GFX, 0)).ptr((SYS, 0x38), (GFX, 0x10)).ptr((SYS, 0x40), (GFX, 0x40));
        let graph = c.graph(165, 0, 0);
        assert_eq!(size_descending_order(&graph, SYS), [0, 2, 4, 5, 1, 3]);
        assert_eq!(size_descending_order(&graph, GFX), [6, 7, 8]);
        assert_eq!(identity_order(&graph, GFX), [6, 7, 8]);
        let only_graphics = Canvas::new(0, 48).graph(1, 0, 0);
        assert_eq!(size_descending_order(&only_graphics, GFX), [0]);
        assert!(size_descending_order(&only_graphics, SYS).is_empty());
    }

    // =========================================================================================
    // Страницы
    // =========================================================================================

    fn packed(sizes: &[usize], original: u32, limit: u32) -> (u32, usize, u32, Vec<usize>) {
        let pages = pack_pages(sizes, original, limit).unwrap();
        (pages.flags, pages.size, pages.count, pages.starts)
    }

    const NO_ROOM: &str = "Блоки не умещаются в страницы даже наибольшего размера.";

    #[test]
    fn pack_pages_follows_the_documented_table() {
        assert_eq!(packed(&[], 0xA5A5_A5A5, 128), (0xa000_0000, 0, 0, vec![]));
        for piece in [0usize, 1, 0x2000] {
            assert_eq!(packed(&[piece], 0, 128), (0x0002_0000, 0x2000, 1, vec![0]));
        }
        assert_eq!(packed(&[0x2001], 0, 128), (0x0002_0001, 0x4000, 1, vec![0]));
        assert_eq!(packed(&[0x20000], 0, 128), (0x0002_0004, 0x20000, 1, vec![0]));
        assert_eq!(packed(&[0x20001], 0, 128), (0x0002_0005, 0x40000, 1, vec![0]));
        assert_eq!(packed(&[0x1_0000_0000], 0, 128), (0x1f, 0x1_0000_0000, 1, vec![0]));
        for huge in [0x1_0000_0001usize, usize::MAX] {
            assert_eq!(failure(pack_pages(&[huge], 0, 128)), "Блок не умещается в наибольшую страницу.");
        }
        assert_eq!(packed(&[0x100, 0x200, 0x100], 0, 128), (0x0002_0000, 0x2000, 1, vec![0, 0x100, 0x300]));
        assert_eq!(packed(&[0x10, 0x1ff0, 0x10], 0, 128), (0x0004_0000, 0x4000, 2, vec![0, 0x10, 0x2000]));
        assert_eq!(packed(&[0x10, 0x1ff1, 0x10], 0, 128), (0x0004_0000, 0x4000, 2, vec![0, 0x2000, 0x10]));
        assert_eq!(packed(&[0x10, 0x20, 0x30, 0x40, 0x50], 0, 128).3, [0, 0xd0, 0xa0, 0x60, 0x10]);
        assert_eq!(packed(&[0x13; 4], 0, 128).3, [0, 0x20, 0x40, 0x60]);
        assert_eq!(packed(&[5; 4], 0, 128).3, [0, 0x10, 0x20, 0x30]);
        assert_eq!(packed(&[0, 0, 0], 0, 128), (0x0002_0000, 0x2000, 1, vec![0, 0, 0]));
        assert_eq!(packed(&[0x2000, 0, 0x2000, 0], 0, 128), (0x0004_0000, 0x4000, 2, vec![0, 0x2000, 0x2000, 0x2000]));
        assert_eq!(packed(&[0x150, 0x30000, 0x200, 0x40], 0, 128), (0x11, 0x40000, 1, vec![0, 0x150, 0x30150, 0x30350]));
        assert_eq!(packed(&[0x7fff, 0x2000, 0x2000], 0, 128), (0x0004_0080, 0xc000, 3, vec![0, 0x8000, 0xa000]));
        assert_eq!(packed(&[0x3000; 3], 0, 128), (0x0006_0001, 0xc000, 3, vec![0, 0x4000, 0x8000]));
        assert_eq!(packed(&[0x5000, 0x20000, 0x6000], 0, 128), (0x102, 0x40000, 2, vec![0, 0x20000, 0x5000]));
    }

    /// Куски графики «оболочки зала владельца»: один на страницу исходника (8 МиБ минус 16 байт), одиннадцать листов
    /// 1024², три плашки 512², два листа 16×16 — 24,8 МБ данных.
    fn shell_like_pieces() -> Vec<usize> {
        let mut sizes = vec![8 * 1024 * 1024 - 16];
        sizes.extend([1_398_096; 11]);
        sizes.extend([349_520; 3]);
        sizes.extend([336; 2]);
        sizes
    }

    #[test]
    fn dense_pages_stay_close_to_the_data_and_the_biggest_page_fits_the_biggest_piece() {
        let sizes = shell_like_pieces();
        let data: usize = sizes.iter().sum();
        let dense = pack_dense_pages(&sizes, 0, 128).unwrap();
        let loose = pack_pages(&sizes, 0, 128).unwrap();
        assert!(dense.size >= data, "страницы вмещают данные");
        assert!(dense.size * 100 <= data * 106, "плотная раскладка: {} Б страниц на {} Б данных", dense.size, data);
        assert!(dense.size < loose.size, "прежняя раскладка занимает {} Б, плотная — {} Б", loose.size, dense.size);
        assert_eq!(biggest_page(dense.flags), 8 * 1024 * 1024, "самая большая страница — наименьшая, в которую помещается самый крупный кусок");
        assert_eq!(dense.starts.len(), sizes.len());
    }

    #[test]
    fn dense_pages_are_never_bigger_than_the_loose_ones_for_the_same_pieces() {
        // Куски, на которых плотная раскладка в 8 МиБ страницах давала 24 МиБ при 21 МиБ данных, а прежняя укладывалась в 22 МиБ.
        let mib = 1024 * 1024;
        let samples: [Vec<usize>; 4] = [
            vec![5 * mib, 5 * mib, 4 * mib, 4 * mib, 3 * mib],
            vec![5 * mib + 200_000, 4 * mib, 4 * mib, 3 * mib, 2 * mib + 500_000, 2 * mib],
            vec![3 * mib; 7],
            (1..40).map(|n| n * 100_000).collect(),
        ];
        for sizes in samples {
            let dense = pack_dense_pages(&sizes, 0, 128).unwrap();
            let loose = pack_pages(&sizes, 0, 128).unwrap();
            let data: usize = sizes.iter().sum();
            assert!(dense.size >= data);
            assert!(dense.size <= loose.size, "плотная {} Б против прежней {} Б на {:?}", dense.size, loose.size, sizes);
        }
    }

    #[test]
    fn dense_pages_never_put_two_pieces_over_each_other_or_over_a_page_edge() {
        let sizes = shell_like_pieces();
        let dense = pack_dense_pages(&sizes, 0, 128).unwrap();
        // Страницы в памяти идут от больших к малым: границы восстанавливаются по флагам.
        let base = HEADER_PAGE << (dense.flags & 0xf);
        let mut edges = Vec::new();
        let mut at = 0;
        for &(bit, width, weight) in &FLAG_FIELDS {
            for _ in 0..(dense.flags >> bit) & ((1 << width) - 1) {
                edges.push((at, at + base * weight));
                at += base * weight;
            }
        }
        assert_eq!(at, dense.size);
        let mut placed: Vec<(usize, usize)> = dense.starts.iter().zip(&sizes).map(|(&start, &size)| (start, start + size)).collect();
        placed.sort_unstable();
        for pair in placed.windows(2) {
            assert!(pair[0].1 <= pair[1].0, "куски пересеклись: {pair:?}");
        }
        for (start, end) in placed {
            assert!(edges.iter().any(|&(from, to)| from <= start && end <= to), "кусок {start}..{end} лёг через край страницы");
        }
    }

    #[test]
    fn dense_pages_fall_back_to_the_loose_rule_when_there_is_nothing_to_pack() {
        assert_eq!(pack_dense_pages(&[], 0xA5A5_A5A5, 128).unwrap(), pack_pages(&[], 0xA5A5_A5A5, 128).unwrap());
        assert_eq!(failure(pack_dense_pages(&[0x1_0000_0001], 0, 128)), "Блок не умещается в наибольшую страницу.");
    }

    #[test]
    fn pack_pages_raises_the_shift_under_limits() {
        let many = vec![0x2000usize; 300];
        assert_eq!(packed(&many, 0, 128).0, 0x0096_0002);
        assert_eq!(packed(&many, 0, 4).0, 0x0006_0007);
        assert_eq!(packed(&many, 0, 1).0, 0x0002_0009);
        assert_eq!(failure(pack_pages(&many, 0, 0)), NO_ROOM);
        assert_eq!(failure(pack_pages(&[0x100], 0, 0)), NO_ROOM);
        assert_eq!(packed(&vec![0x2000; 128], 0, 128).0, 0x0080_0001);
        assert_eq!(packed(&vec![0x2000; 129], 0, 128).0, 0x0082_0001);
        let mut first_wide = vec![0x2000usize; 127];
        first_wide.insert(0, 0x4000);
        let wide = packed(&first_wide, 0, 128);
        assert_eq!((wide.0, wide.1, wide.2), (0x00fe_0800, 0x10_2000, 128));
        assert_eq!(packed(&[0x20000; 20], 0, 128).0, 0x0028_0004);
        let ten = packed(&[0x1000; 10], 0x5000_0000, 125);
        assert_eq!((ten.0, ten.1, ten.2), (0x500a_0000, 0xa000, 5));
        assert_eq!(ten.3, (0..10).map(|k| k * 0x1000).collect::<Vec<usize>>());
        assert_eq!(failure(pack_pages(&[0x1_0000_0000; 2], 0, 128)), NO_ROOM);
        assert_eq!(failure(pack_pages(&vec![0x1_0000_0000; 129], 0, 128)), NO_ROOM);
        assert_eq!(packed(&[0x1ff0, 0x10, 1], 0, 128).3, [0, 0x1ff0, 0x2000]);
        assert_eq!(packed(&[0x1ff1, 0x10], 0, 128).3, [0, 0x2000]);
        assert_eq!(packed(&[0x1fef, 0x10], 0, 128).3, [0, 0x1ff0]);
        assert_eq!(packed(&vec![0x20; 1000], 0, 128).0, 0x0008_0000);
    }

    #[test]
    fn sized_matches_the_documented_table() {
        let table: [(usize, u32, usize); 16] = [
            (0, 0, 0),
            (1, 0x0800_0000, 0x200),
            (0x200, 0x0800_0000, 0x200),
            (0x201, 0x0400_0000, 0x400),
            (0x400, 0x0400_0000, 0x400),
            (0x1000, 0x0100_0000, 0x1000),
            (0x1fff, 0x0002_0000, 0x2000),
            (0x2000, 0x0002_0000, 0x2000),
            (0x2001, 0x0802_0000, 0x2200),
            (0x3000, 0x0102_0000, 0x3000),
            (0x4000, 0x0000_0800, 0x4000),
            (0x10000, 0x20, 0x10000),
            (0x20000, 0x10, 0x20000),
            (0x10_0000, 0x77f0, 0x10_0000),
            (5663 * 0x200, 0x0fff_fff0, 0x2c_3e00),
            (5663 * 0x200 + 1, 0x0003_37f1, 0x2c_4000),
        ];
        for (len, flags, size) in table {
            assert_eq!(sized(len, 0).unwrap(), (flags, size), "{len:#x}");
        }
        assert_eq!(sized(0x16_1f00_0000, 0).unwrap(), (0x0fff_ffff, 0x16_1f00_0000));
        assert_eq!(failure(sized(0x16_1f00_0001, 0)), "Область не умещается в страницы заголовка.");
        assert_eq!(failure(sized(usize::MAX, 0)), "Область не умещается в страницы заголовка.");
        assert_eq!(sized(0x1234, 0xA5A5_A5A5).unwrap(), (0xa500_0000, 0x1400));
        assert_eq!(sized(0, 0xFFFF_FFFF).unwrap(), (0xf000_0000, 0));
        let worst = (0..0x40_0000usize).step_by(0x1f3).map(|len| sized(len, 0).unwrap().1 - len).max().unwrap();
        assert_eq!(worst, 0x3ff);
    }

    #[test]
    fn page_lists_come_from_flags_only_when_they_match_the_length() {
        assert_eq!(source_page_starts(0xAF00_0000, 0x1e00), [0, 0x1000, 0x1800, 0x1c00]);
        assert!(source_page_starts(0xAF00_0000, 0x1d00).is_empty());
        assert!(source_page_starts(0, 0).is_empty());
        assert_eq!(paged().page_starts[0], [0, 0x1000, 0x1800, 0x1c00]);
        assert_eq!(paged().page_starts[1], [0]);
        assert!(sample().page_starts[0].is_empty());
    }

    // =========================================================================================
    // Сборка
    // =========================================================================================

    #[test]
    fn rebuild_lays_the_sample_into_two_pages_with_a_map() {
        let graph = sample();
        let out = flat_identity(&graph);
        assert_eq!(out.head, [0x52, 0x53, 0x43, 0x37, 0xa5, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0]);
        assert_eq!(sha256_hex(&out.system), "826e0d45385f4b0ea89c1b6769d5df4d4641da54168cad06e0d1c5ed01167529");
        assert_eq!(sha256_hex(&out.graphics), "ad0df66de23c3f876010f33b81fb3b6bff932a7eab99bc56a3a2887a7e38f3a2");
        // Блок 0x30 — карта страниц: числа страниц записаны после указателей.
        assert_eq!(out.system[0x30 + 8..0x30 + 10], [1, 1]);
        assert_eq!(out.system[8..12], [0x30, 0, 0, 0x50]);

        let file = rebuild(&graph, &identity_order(&graph, SYS), &identity_order(&graph, GFX)).unwrap();
        assert_eq!(file.len(), 85);
        assert_eq!(sha256_hex(&file), "284fa2afa208e619c641edf034b74377cdc0a6f876e7588e2f1826c34fc30e98");
        let parsed = Resource::parse(&file).unwrap();
        assert_eq!((parsed.header.version, parsed.header.declared_version), (0, 165));
        let again = scan(&parsed).unwrap();
        assert_eq!(
            shape(&again),
            [
                (SYS, 0, 0x20, vec![(0, SYS, 0x20), (8, SYS, 0x30)]),
                (SYS, 0x20, 0x30, vec![(0, GFX, 0)]),
                (SYS, 0x30, 0x2000, vec![]),
                (GFX, 0, 0x2000, vec![]),
            ]
        );
        same_graph(&graph, &again).unwrap();
        let (system, graphics) = orders(&again);
        assert_eq!(rebuild(&again, &system, &graphics).unwrap(), file);
    }

    const DXT1: u32 = 0x3154_5844;

    /// Корень, описание текстуры DXT1 64×64 с одной ступенью (2048 байт пикселей) и блок пикселей в графике на `pixels` байт.
    /// Пиксели — 2048 байт `0x5a`, дальше нули; `mark` кладёт в хвост один ненулевой байт.
    fn textured(pixels: usize, format: u32, mark: Option<usize>) -> Graph {
        let descriptor = 0x40;
        let mut c = Canvas::new(0x100, pixels);
        c.ptr((SYS, 0), (SYS, descriptor)).ptr((SYS, descriptor + 0x70), (GFX, 0));
        c.system[descriptor + 0x50..descriptor + 0x52].copy_from_slice(&64u16.to_le_bytes());
        c.system[descriptor + 0x52..descriptor + 0x54].copy_from_slice(&64u16.to_le_bytes());
        c.system[descriptor + 0x58..descriptor + 0x5c].copy_from_slice(&format.to_le_bytes());
        c.system[descriptor + 0x5d] = 1;
        c.fill(GFX, 0..2048, 0x5a);
        if let Some(at) = mark {
            c.graphics[at] = 1;
        }
        c.graph(165, 0, 0)
    }

    #[test]
    fn rebuild_drops_the_zero_tail_after_the_last_texture_level() {
        let graph = textured(0x1_0000, DXT1, None);
        let cuts = texture_padding(&graph);
        assert_eq!(cuts.len(), 1);
        assert_eq!((graph.blocks[cuts[0].0].segment, cuts[0].1), (GFX, 2048));
        let out = flat_identity(&graph);
        assert_eq!(out.graphics.len(), 0x2000, "блок в 64 КиБ с 2 КиБ пикселей занимает одну наименьшую страницу");
        assert!(out.graphics[..2048].iter().all(|&byte| byte == 0x5a));
        assert!(out.graphics[2048..].iter().all(|&byte| byte == 0));
    }

    /// Пиксели, в которых восемь байт выровненного слова случайно выглядят указателем (в DXT это блок цвета с нулевыми индексами и
    /// двумя цветами, в сумме дающими адрес области), — пиксели, а не указатель: иначе слово «переезжает» вместе с блоком, в системной
    /// области появляется лишнее начало блока и модель перестаёт читаться. Найдено 18.11.2026 на листе 1024×1024 логотипа
    /// (`compile-star-model` с движением): слово `0x5001A0FF` на 4 КБ до конца листа, данные листа не совпали с исходными.
    #[test]
    fn a_pointer_like_word_inside_texture_pixels_stays_pixels() {
        let descriptor = 0x40;
        let mut c = Canvas::new(0x100, 0x1000);
        c.ptr((SYS, 0), (SYS, descriptor)).ptr((SYS, descriptor + 0x70), (GFX, 0));
        c.system[descriptor + 0x50..descriptor + 0x52].copy_from_slice(&64u16.to_le_bytes());
        c.system[descriptor + 0x52..descriptor + 0x54].copy_from_slice(&64u16.to_le_bytes());
        c.system[descriptor + 0x58..descriptor + 0x5c].copy_from_slice(&DXT1.to_le_bytes());
        c.system[descriptor + 0x5d] = 1;
        c.fill(GFX, 0..2048, 0x5a);
        // в пикселях лежит слово, похожее на указатель в системную область, и слово, похожее на указатель в графическую
        c.ptr((GFX, 0x400), (SYS, 0x80)).ptr((GFX, 0x500), (GFX, 0x700));
        let pixels = c.graphics[..2048].to_vec();

        let graph = c.graph(165, 0, 0);
        let starts = |segment| graph.segment_blocks(segment).iter().map(|&block| graph.blocks[block].start).collect::<Vec<_>>();
        assert_eq!(starts(SYS), [0, descriptor], "ложного начала блока в системной области нет");
        assert_eq!(starts(GFX), [0], "и в графической тоже");
        assert!(graph.blocks.iter().filter(|block| block.segment == GFX).all(|block| block.slots.is_empty()), "в пикселях указателей нет");
        // настоящие указатели описания остались: корень на описание и описание на пиксели
        assert_eq!(graph.blocks[graph.root().unwrap()].slots.len(), 1);
        let out = flat_identity(&graph);
        assert_eq!(out.graphics[..2048], pixels[..], "пиксели после пересборки те же байты");
    }

    #[test]
    fn rebuild_keeps_a_tail_with_data_an_unknown_format_and_a_graph_without_textures() {
        let marked = textured(0x1_0000, DXT1, Some(0x8000));
        assert!(texture_padding(&marked).is_empty());
        let out = flat_identity(&marked);
        assert_eq!(out.graphics.len(), 0x1_0000);
        assert_eq!(out.graphics[0x8000], 1);
        let strange = textured(0x1_0000, 0x1234, None);
        assert!(without_texture_padding(&strange).is_none());
        assert_eq!(flat_identity(&strange).graphics.len(), 0x1_0000);
        assert!(without_texture_padding(&sample()).is_none());
    }

    #[test]
    fn texture_padding_leaves_room_for_the_biggest_description_of_a_shared_block() {
        // Два описания на одни пиксели: 64×64 (2048 байт) и 128×64 (4096 байт) — резать до 4096, а не до 2048.
        let mut c = Canvas::new(0x200, 0x1_0000);
        c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0xc0));
        for (at, width) in [(0x40usize, 64u16), (0xc0, 128)] {
            c.ptr((SYS, at + 0x70), (GFX, 0));
            c.system[at + 0x50..at + 0x52].copy_from_slice(&width.to_le_bytes());
            c.system[at + 0x52..at + 0x54].copy_from_slice(&64u16.to_le_bytes());
            c.system[at + 0x58..at + 0x5c].copy_from_slice(&DXT1.to_le_bytes());
            c.system[at + 0x5d] = 1;
        }
        c.fill(GFX, 0..4096, 0x5a);
        let graph = c.graph(165, 0, 0);
        let cuts = texture_padding(&graph);
        assert_eq!(cuts.len(), 1);
        assert_eq!((graph.blocks[cuts[0].0].segment, cuts[0].1), (GFX, 4096));
    }

    /// Описание обычной текстуры DXT1 `width`×`height` на `levels` ступеней, чьи пиксели лежат в графике с нуля, а блок пикселей — на `pixels` байт.
    /// `touch` правит описание (глубина, вид), `data` — сколько первых байт пикселей ненулевые.
    fn described(width: u16, height: u16, levels: u8, pixels: usize, data: usize, touch: impl Fn(&mut [u8])) -> Graph {
        let descriptor = 0x40;
        let mut c = Canvas::new(0x100, pixels);
        c.ptr((SYS, 0), (SYS, descriptor)).ptr((SYS, descriptor + 0x70), (GFX, 0));
        c.system[descriptor + 0x50..descriptor + 0x52].copy_from_slice(&width.to_le_bytes());
        c.system[descriptor + 0x52..descriptor + 0x54].copy_from_slice(&height.to_le_bytes());
        c.system[descriptor + 0x54..descriptor + 0x56].copy_from_slice(&1u16.to_le_bytes());
        c.system[descriptor + 0x58..descriptor + 0x5c].copy_from_slice(&DXT1.to_le_bytes());
        c.system[descriptor + 0x5d] = levels;
        touch(&mut c.system[descriptor..descriptor + 0x78]);
        c.fill(GFX, 0..data, 0x5a);
        c.graph(165, 0, 0)
    }

    #[test]
    fn a_cube_or_a_volume_texture_keeps_its_whole_pixel_block() {
        // Куб: вид не 0, граней шесть — «лишние» грани чёрные, и хвост из нулей не хвост.
        let cube = described(64, 64, 1, 0x1_0000, 2048, |d| d[0x5c] = 3);
        assert!(texture_padding(&cube).is_empty(), "куб с чёрными гранями 2–6 не режется");
        assert!(without_texture_padding(&cube).is_none());
        assert_eq!(flat_identity(&cube).graphics.len(), 0x1_0000);
        // Объём: глубина 4 — слоёв больше, чем в картинке одного.
        let volume = described(64, 64, 1, 0x1_0000, 2048, |d| d[0x54..0x56].copy_from_slice(&4u16.to_le_bytes()));
        assert!(texture_padding(&volume).is_empty(), "объёмная с depth = 4 не режется");
        assert_eq!(flat_identity(&volume).graphics.len(), 0x1_0000);
        // Обычная режется, как и раньше; глубина 0 и 1 — обычная.
        for depth in [0u16, 1] {
            let plain = described(64, 64, 1, 0x1_0000, 2048, |d| d[0x54..0x56].copy_from_slice(&depth.to_le_bytes()));
            let cuts = texture_padding(&plain);
            assert_eq!(cuts.len(), 1, "depth = {depth}");
            assert_eq!(cuts[0].1, 2048);
        }
    }

    #[test]
    fn a_pixel_block_shared_with_a_cube_or_an_unknown_description_is_not_cut() {
        // Два описания на одни пиксели; `second` правит второе описание.
        let shared = |second: &dyn Fn(&mut Vec<u8>)| -> Graph {
            let mut c = Canvas::new(0x200, 0x1_0000);
            c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0xc0));
            for at in [0x40usize, 0xc0] {
                c.ptr((SYS, at + 0x70), (GFX, 0));
                c.system[at + 0x50..at + 0x52].copy_from_slice(&64u16.to_le_bytes());
                c.system[at + 0x52..at + 0x54].copy_from_slice(&64u16.to_le_bytes());
                c.system[at + 0x58..at + 0x5c].copy_from_slice(&DXT1.to_le_bytes());
                c.system[at + 0x5d] = 1;
            }
            c.fill(GFX, 0..2048, 0x5a);
            second(&mut c.system);
            c.graph(165, 0, 0)
        };
        let plain_and_cube = shared(&|system| system[0xc0 + 0x5c] = 2);
        assert!(texture_padding(&plain_and_cube).is_empty(), "обычное описание не режет блок, на который смотрит куб");
        let plain_and_volume = shared(&|system| system[0xc0 + 0x54..0xc0 + 0x56].copy_from_slice(&3u16.to_le_bytes()));
        assert!(texture_padding(&plain_and_volume).is_empty(), "и блок, на который смотрит объём");
        let plain_and_strange = shared(&|system| system[0xc0 + 0x58..0xc0 + 0x5c].copy_from_slice(&0x1234u32.to_le_bytes()));
        assert!(texture_padding(&plain_and_strange).is_empty(), "и блок, на который смотрит описание неизвестного формата");
        // Оба обычные — режется, как и раньше.
        assert_eq!(texture_padding(&shared(&|_| {})).len(), 1);
    }

    #[test]
    fn the_cut_keeps_the_tiny_last_levels_of_block_formats() {
        // 8×8 DXT1 на четыре ступени: 8×8 — 4 блока, 4×4, 2×2 и 1×1 — по целому блоку: 32 + 8 + 8 + 8 = 56 байт.
        // Ступени мельче 4×4 занимают блок целиком: счёт на 1 байт короче отрезал бы настоящие нули последней, тёмной ступени.
        let tiny = described(8, 8, 4, 0x1_0000, 32, |_| {});
        let cuts = texture_padding(&tiny);
        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].1, 56, "8×8 DXT1 с четырьмя ступенями — ровно 56 байт");
        assert_eq!(flat_identity(&tiny).graphics.len(), 0x2000);
        assert!(flat_identity(&tiny).graphics[..56].iter().all(|&byte| byte == 0x5a || byte == 0));
        // 1×1 и 2×2 — по целому блоку; цепочка короче полной (ступени 3, а не 4) считается по заявленным ступеням.
        let one = described(1, 1, 1, 0x1000, 8, |_| {});
        assert_eq!(texture_padding(&one)[0].1, 8);
        let two = described(2, 2, 2, 0x1000, 8, |_| {});
        assert_eq!(texture_padding(&two)[0].1, 16);
        // Лишние заявленные ступени сверх цепочки (до 1×1 повторяются целым блоком) места только прибавляют, а не отнимают.
        let extra = described(4, 4, 6, 0x1000, 8, |_| {});
        assert_eq!(texture_padding(&extra)[0].1, 8 * 6);
    }

    #[test]
    fn rebuild_with_hands_the_body_to_the_compressor() {
        let graph = sample();
        let (system, graphics) = orders(&graph);
        let seen = std::cell::RefCell::new(String::new());
        let out = rebuild_with(&graph, &system, &graphics, &|body| {
            *seen.borrow_mut() = format!("{} {}", body.len(), sha256_hex(body));
            vec![1, 2, 3]
        })
        .unwrap();
        assert_eq!(
            seen.into_inner(),
            "16384 f7f1e9b889c3bf16b16fdddce8202dfb693b04cdec6a39bc39516f45a0bc4fc4"
        );
        assert_eq!(out[..16], [0x52, 0x53, 0x43, 0x37, 0xa5, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0]);
        assert_eq!(out[16..], [1, 2, 3]);
        let bare = rebuild_with(&graph, &system, &graphics, &|_| Vec::new()).unwrap();
        assert_eq!(bare.len(), 16);
        let plain = rebuild(&graph, &system, &graphics).unwrap();
        let body = flat(&graph, &system, &graphics);
        let mut joined = body.system.clone();
        joined.extend_from_slice(&body.graphics);
        assert_eq!(plain[16..], miniz_oxide::deflate::compress_to_vec(&joined, 6)[..]);
        let text = panic_text(|| rebuild_with(&graph, &system, &graphics, &|_| panic!("deflate упал")).map(|v| v.len()));
        assert_eq!(text, "deflate упал");
    }

    #[test]
    fn blocks_share_a_chunk_only_inside_one_source_page() {
        let graph = paged();
        let identity = flat_identity(&graph);
        assert_eq!((identity.system_flags, identity.graphics_flags), (0xa002_0000, 0x5002_0000));
        assert_eq!(sha256_hex(&identity.system), "35aff34f7a86643c7e0ce6fb77ac485c73a2398cdb23e79b34d3e097f8b907dd");
        assert_eq!(identity.system[..4], [0x40, 0, 0, 0x50]);
        assert_eq!(identity.system[8..12], [0, 0x10, 0, 0x50]);

        let (system, graphics) = orders(&graph);
        for order in [vec![0, 5, 4, 3, 2, 1], vec![0, 3, 1, 4, 2, 5], vec![0, 2, 1, 3, 4, 5]] {
            let out = flat(&graph, &order, &graphics);
            assert_eq!(sha256_hex(&out.system), "eb11be1a5b8b70523b3045beef807eadd9d48980940db0f0d546ae79c7f10280");
            assert_eq!(word_at(&out.system, 0), 0x5000_1dc0);
            assert_eq!(word_at(&out.system, 8), 0x5000_0fc0);
            assert_eq!(word_at(&out.system, 16), 0x5000_17c0);
            assert_eq!(word_at(&out.system, 24), 0x5000_1bc0);
        }
        // Те же байты без страниц исходника: корень склеивается с блоком 5.
        let plain = from_parts(165, 0xA000_0000, 0x5000_0000, graph.system.clone(), graph.graphics.clone());
        let (plain_system, plain_graphics) = orders(&plain);
        let mut reversed = plain_system.clone();
        reversed[1..].reverse();
        let out = flat(&plain, &reversed, &plain_graphics);
        assert_eq!(sha256_hex(&out.system), "cc4e05668442b4d459fd675d12240410e4039c1d83736f4d7cefbb136a34bf79");
        assert_eq!(word_at(&out.system, 24), 0x5000_0040);
        // Флаги, не сходящиеся с длиной области, страниц тоже не дают.
        let mismatched = from_parts(165, 0xAF00_0000, 0x5100_0000, graph.system[..0x1d00].to_vec(), graph.graphics.clone());
        assert!(mismatched.page_starts[0].is_empty());
        let mut order = identity_order(&mismatched, SYS);
        order[1..].reverse();
        let out = flat(&mismatched, &order, &identity_order(&mismatched, GFX));
        assert_eq!(sha256_hex(&out.system), "fe75b4316b081207d4f1cd6221b8c33bd41c064c3fe2f6ca2737af0cc59dbd07");
        // Графические блоки в обратном порядке: отдельные куски.
        let swapped = flat(&graph, &system, &[graphics[1], graphics[0]]);
        assert_eq!(sha256_hex(&swapped.system)[..8], *"36ba2fe0");
    }

    /// Корень на 0x40 байт со слотами `0`, `8` (если задан) и `16`; блок по слоту 8 — на 0x40 длиной `map_len`.
    fn map_candidate(map_len: usize, system_target: bool, with_slot: bool) -> Graph {
        let mut c = Canvas::new(0x100, 0x40);
        c.ptr((SYS, 0), (SYS, 0x80)).ptr((SYS, 16), (SYS, 0xc0));
        if with_slot {
            if system_target {
                c.ptr((SYS, 8), (SYS, 0x40));
            } else {
                c.ptr((SYS, 8), (GFX, 0));
            }
        }
        c.ptr((SYS, 0x40), (SYS, 0x40 + map_len));
        c.fill(SYS, 0x48..0x40 + map_len, 0x4d).fill(SYS, 0x88..0xc0, 0x41).fill(SYS, 0xc8..0x100, 0x43);
        c.graph(165, 0xA000_0000, 0x5000_0000)
    }

    #[test]
    fn the_page_map_is_found_by_the_root_slot_at_eight() {
        let ten = map_candidate(10, true, true);
        assert!(ten.map_block().is_some());
        let out = flat_identity(&ten);
        let map_at = word_at(&out.system, 8) as usize - SYSTEM_BASE as usize;
        assert_eq!(out.system[map_at + 8..map_at + 10], [1, 1]);
        assert!(map_candidate(9, true, true).map_block().is_none());
        assert!(map_candidate(10, false, true).map_block().is_none());
        assert!(map_candidate(10, true, false).map_block().is_none());

        // Слот +8 на сам корень картой не считается: указатель остаётся указателем.
        let mut selfish = Canvas::new(0x100, 0);
        selfish.ptr((SYS, 0), (SYS, 0x80)).ptr((SYS, 8), (SYS, 0)).ptr((SYS, 16), (SYS, 0xc0));
        selfish.fill(SYS, 0x88..0xc0, 0x41).fill(SYS, 0xc8..0x100, 0x43);
        let graph = selfish.graph(165, 0, 0);
        assert_eq!(graph.map_block(), None);
        let out = flat_identity(&graph);
        assert_eq!(out.system[8..16], [0, 0, 0, 0x50, 0, 0, 0, 0]);
    }

    #[test]
    fn a_map_gets_a_chunk_of_its_own_with_room_for_the_page_table() {
        let mut c = Canvas::new(0x80, 0x40);
        c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x40));
        c.fill(SYS, 0x48..0x80, 0x4d).ptr((SYS, 0x40), (GFX, 0)).fill(GFX, 8..0x40, 0x62);
        let graph = c.graph(165, 0xA000_0000, 0x5000_0000);
        let out = flat_identity(&graph);
        assert_eq!(word_at(&out.system, 8), 0x5000_0040);
        assert_eq!(out.system[0x48..0x4a], [1, 1]);
        assert_eq!(out.system[0x40 + 1040 - 1], 0);
        let (system, graphics) = orders(&graph);
        let again = scan(&Resource::parse(&rebuild(&graph, &system, &graphics).unwrap()).unwrap()).unwrap();
        assert!(again.map_block().is_some());
        same_graph(&graph, &again).unwrap();
    }

    #[test]
    fn empty_graphs_rebuild_to_a_bare_header() {
        let empty = from_parts(165, 0xA000_0000, 0x5000_0000, vec![], vec![]);
        let bare = rebuild_with(&empty, &[], &[], &raw).unwrap();
        assert_eq!(bare, [0x52, 0x53, 0x43, 0x37, 0xa5, 0, 0, 0, 0, 0, 0, 0xa0, 0, 0, 0, 0x50]);
        assert_eq!(rebuild(&empty, &[], &[]).unwrap().len(), 18);
        let graphics_only = Canvas::new(0, 16).graph(5, 0x7000_0000, 0x3000_0000);
        let out = rebuild_with(&graphics_only, &[], &[0], &raw).unwrap();
        assert_eq!(out[..16], [0x52, 0x53, 0x43, 0x37, 5, 0, 0, 0, 0, 0, 0, 0x70, 0, 0, 2, 0x30]);
        let wild = Canvas::new(16, 0).graph(0xdead_beef, 0xffff_ffff, 0xffff_ffff);
        let out = rebuild_with(&wild, &[0], &[], &raw).unwrap();
        assert_eq!(out[..16], [0x52, 0x53, 0x43, 0x37, 0xef, 0xbe, 0xad, 0xde, 0, 0, 2, 0xf0, 0, 0, 0, 0xf0]);
    }

    #[test]
    fn orders_are_validated_before_anything_is_laid_out() {
        let graph = sample();
        let (system, graphics) = orders(&graph);
        let permutation = "Порядок блоков: не перестановка блоков области.";
        let missing = "Порядок блоков: пропущены блоки области.";
        let first = "Корень системной области должен идти первым.";
        let cases: [(&[usize], &[usize], &str); 12] = [
            (&[], &graphics, missing),
            (&[0, 0, 2], &graphics, permutation),
            (&[0, 1, 9], &graphics, permutation),
            (&[0, 1, 3], &graphics, permutation),
            (&[1, 0, 2], &graphics, first),
            (&[1, 2, 0], &graphics, first),
            (&[0, 1], &graphics, missing),
            (&system, &[], missing),
            (&system, &[0], permutation),
            (&system, &[3, 3], permutation),
            (&[0, 0, 0], &[], permutation),
            (&[1, 0, 2], &[], missing),
        ];
        for (so, go, message) in cases {
            assert_eq!(failure(rebuild_with(&graph, so, go, &raw)), message, "{so:?} {go:?}");
        }
        let blank = from_parts(1, 0, 0, vec![], vec![]);
        assert_eq!(failure(rebuild_with(&blank, &[0], &[], &raw)), permutation);
        let tail = Canvas::new(0, 16).graph(1, 0, 0);
        assert_eq!(failure(rebuild_with(&tail, &[0], &[0], &raw)), permutation);
    }

    #[test]
    fn damaged_graphs_are_refused_or_written_as_they_are() {
        let outside = "Указатель вне блоков.";
        let (system, graphics) = orders(&sample());
        for target in [at(SYS, 0x1000), at(GFX, 0x28)] {
            let mut graph = sample();
            graph.blocks[0].slots[0].target = target;
            assert_eq!(failure(rebuild_with(&graph, &system, &graphics, &raw)), outside);
        }
        let mut inside = sample();
        inside.blocks[0].slots[0].target.offset = 0x38;
        assert_eq!(flat(&inside, &system, &graphics).system[..8], [0x38, 0, 0, 0x50, 0, 0, 0, 0]);
        let mut no_slots = sample();
        no_slots.blocks[0].slots.clear();
        assert_eq!(flat(&no_slots, &system, &graphics).system[..4], [0x20, 0, 0, 0x50]);
        let mut hanging = sample();
        hanging.blocks[0].slots.push(Slot { relative: 28, target: at(SYS, 0x30) });
        assert_eq!(flat(&hanging, &system, &graphics).system[28..36], [0x30, 0, 0, 0x50, 0, 0, 0, 0x60]);

        let mut huge = sample();
        huge.blocks[2].end = 5_000_000_000;
        assert_eq!(failure(rebuild_with(&huge, &system, &graphics, &raw)), "Блок не умещается в наибольшую страницу.");
        let mut big_pages = paged();
        for index in [3, 4, 5] {
            big_pages.blocks[index].end = big_pages.blocks[index].start + 0x1_0000_0000;
        }
        let (so, go) = orders(&big_pages);
        assert_eq!(failure(rebuild_with(&big_pages, &so, &go, &raw)), NO_ROOM);
    }

    #[test]
    fn empty_blocks_take_a_byte_of_layout_and_must_be_ordered() {
        let mut graph = sample();
        let (system, graphics) = orders(&graph);
        append_block(&mut graph, SYS, vec![], vec![]);
        append_block(&mut graph, GFX, vec![], vec![]);
        assert_eq!(failure(rebuild_with(&graph, &system, &graphics, &raw)), "Порядок блоков: пропущены блоки области.");
        let (system, graphics) = orders(&graph);
        let out = rebuild(&graph, &system, &graphics).unwrap();
        let again = scan(&Resource::parse(&out).unwrap()).unwrap();
        assert_eq!(sha256_hex(&out), "284fa2afa208e619c641edf034b74377cdc0a6f876e7588e2f1826c34fc30e98");
        same_graph(&sample(), &again).unwrap();
    }

    // =========================================================================================
    // same_graph
    // =========================================================================================

    fn base_with(tweak: impl Fn(&mut Canvas)) -> Graph {
        let mut c = Canvas::new(0x80, 0x20);
        c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 16), (SYS, 0x60)).fill(SYS, 24..0x40, 0x11);
        c.ptr((SYS, 0x40), (GFX, 0)).fill(SYS, 0x48..0x60, 0x22).fill(SYS, 0x60..0x80, 0x33).fill(GFX, 0..0x20, 0x44);
        tweak(&mut c);
        c.graph(165, 0, 0)
    }

    fn differs(result: Result<()>, reason: &str) {
        assert_eq!(failure(result), format!("Ресурсы различаются: {reason}."));
    }

    #[test]
    fn same_graph_accepts_relabelled_copies() {
        let base = base_with(|_| {});
        same_graph(&base, &base).unwrap();
        same_graph(&base, &base.clone()).unwrap();
        let other_header = from_parts(7, 0xdead_0000, 0xbeef_0000, base.system.clone(), base.graphics.clone());
        same_graph(&base, &other_header).unwrap();
        let (so, go) = orders(&base);
        let out = rebuild(&base, &[so[0], so[2], so[1]], &go).unwrap();
        let again = scan(&Resource::parse(&out).unwrap()).unwrap();
        same_graph(&base, &again).unwrap();
        same_graph(&again, &base).unwrap();
        // Ссылки веером с целями в другом порядке и недостижимые блоки не мешают.
        let fan = |first: usize, second: usize| {
            let mut c = Canvas::new(0x50, 0);
            c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 8), (SYS, 0x20)).ptr((SYS, 0x10), (SYS, first)).ptr((SYS, 0x20), (SYS, second));
            c.graph(1, 0, 0)
        };
        same_graph(&fan(0x30, 0x40), &fan(0x40, 0x30)).unwrap();
        let ghosts = |fill: u8| {
            let mut c = Canvas::new(0x50, 0);
            c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 0x20), (SYS, 0x30)).ptr((SYS, 0x30), (SYS, 0x20)).fill(SYS, 0x28..0x30, fill);
            c.graph(1, 0, 0)
        };
        same_graph(&ghosts(0x77), &ghosts(0x99)).unwrap();
    }

    #[test]
    fn same_graph_reports_the_shape_and_content_differences() {
        let base = base_with(|_| {});
        let gfx_only = Canvas::new(0, 16).graph(1, 0, 0);
        differs(same_graph(&gfx_only, &base), "нет корня");
        differs(same_graph(&base, &gfx_only), "нет корня");
        let empty = from_parts(1, 0, 0, vec![], vec![]);
        differs(same_graph(&empty, &empty), "нет корня");
        let more = base_with(|c| {
            c.ptr((SYS, 0x68), (SYS, 0x70));
        });
        differs(same_graph(&base, &more), "разное число блоков");

        let two = {
            let mut c = Canvas::new(0x30, 0);
            c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 8), (SYS, 0x20));
            c.graph(1, 0, 0)
        };
        let one = {
            let mut c = Canvas::new(0x30, 0);
            c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 0x10), (SYS, 0x20));
            c.graph(1, 0, 0)
        };
        differs(same_graph(&two, &one), "блоки разной формы");
        differs(same_graph(&one, &two), "блоки разной формы");
        let moved = {
            let mut c = Canvas::new(0x30, 0);
            c.ptr((SYS, 8), (SYS, 0x10)).ptr((SYS, 0x10), (SYS, 0x20));
            c.graph(1, 0, 0)
        };
        differs(same_graph(&one, &moved), "байты блока вне указателей");

        // Хвост длинного блока должен быть нулевым, слоты в хвосте и на границе недопустимы.
        let long = {
            let mut c = Canvas::new(0x30, 0);
            c.ptr((SYS, 0), (SYS, 0x20));
            c.graph(1, 0, 0)
        };
        let short = {
            let mut c = Canvas::new(0x20, 0);
            c.ptr((SYS, 0), (SYS, 0x10));
            c.graph(1, 0, 0)
        };
        same_graph(&long, &short).unwrap();
        same_graph(&short, &long).unwrap();
        let dirty = {
            let mut c = Canvas::new(0x30, 0);
            c.ptr((SYS, 0), (SYS, 0x20)).fill(SYS, 0x18..0x20, 0x55);
            c.graph(1, 0, 0)
        };
        differs(same_graph(&dirty, &short), "содержимое блока длиннее второго блока");
        differs(same_graph(&short, &dirty), "содержимое блока длиннее второго блока");
        let last_byte = {
            let mut c = Canvas::new(0x30, 0);
            c.ptr((SYS, 0), (SYS, 0x20));
            c.system[0x1f] = 1;
            c.graph(1, 0, 0)
        };
        differs(same_graph(&last_byte, &short), "содержимое блока длиннее второго блока");
        let double = {
            let mut c = Canvas::new(0x20, 0);
            c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 8), (SYS, 0x10));
            c.graph(1, 0, 0)
        };
        let mut in_tail = long.clone();
        in_tail.blocks[0].slots.push(Slot { relative: 0x10, target: at(SYS, 0x20) });
        differs(same_graph(&in_tail, &double), "указатель в хвосте блока");
        let mut straddle = long.clone();
        straddle.blocks[0].slots.push(Slot { relative: 0x0c, target: at(SYS, 0x20) });
        differs(same_graph(&straddle, &double), "указатель в хвосте блока");

        // Байты вне слотов и внутри слотов.
        let stray = base_with(|c| c.system[0x0f] = 0x99);
        differs(same_graph(&base, &stray), "байты блока вне указателей");
        let other_gfx = base_with(|c| c.graphics[0x1f] = 0);
        differs(same_graph(&base, &other_gfx), "байты блока вне указателей");
        let mut inside_word = base.clone();
        inside_word.system[0x04] = 0x99;
        same_graph(&base, &inside_word).unwrap();
        let mut other_word = base.clone();
        other_word.system[0] = 0x41;
        same_graph(&base, &other_word).unwrap();
        same_graph(&other_word, &base).unwrap();
        let mut shifted = base.clone();
        shifted.blocks[0].slots[0].relative = 8;
        differs(same_graph(&shifted, &base), "указатели стоят иначе");
    }

    #[test]
    fn same_graph_checks_pointer_pairs() {
        let base = base_with(|_| {});
        let tweaked = |change: &dyn Fn(&mut Graph)| {
            let mut graph = base.clone();
            change(&mut graph);
            graph
        };
        let outside = tweaked(&|g| g.blocks[0].slots[0].target = at(SYS, 0x1000));
        differs(same_graph(&outside, &base), "указатель вне блоков");
        differs(same_graph(&base, &outside), "указатель вне блоков");
        let inner = tweaked(&|g| g.blocks[0].slots[0].target.offset = 0x44);
        differs(same_graph(&inner, &base), "указатель не на начало блока");
        differs(same_graph(&base, &inner), "указатель не на начало блока");
        let other_area = tweaked(&|g| g.blocks[0].slots[0].target = at(GFX, 0));
        differs(same_graph(&other_area, &base), "указатели стоят иначе");
        let swapped = tweaked(&|g| g.blocks[0].slots.swap(0, 1));
        differs(same_graph(&swapped, &base), "указатели стоят иначе");
        let doubled = tweaked(&|g| g.blocks[0].slots[1].target = at(SYS, 0x40));
        differs(same_graph(&doubled, &base), "указатели ведут в разные блоки");
        differs(same_graph(&base, &doubled), "указатели ведут в разные блоки");

        let diamond = |middle: usize| {
            let mut c = Canvas::new(0x60, 0);
            c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 8), (SYS, 0x20)).ptr((SYS, 0x10), (SYS, 0x30));
            c.ptr((SYS, 0x20), (SYS, middle)).ptr((SYS, 0x30), (SYS, 0x40));
            c.graph(1, 0, 0)
        };
        differs(same_graph(&diamond(0x30), &diamond(0x40)), "указатели ведут в разные блоки");
        differs(same_graph(&diamond(0x40), &diamond(0x30)), "указатели ведут в разные блоки");

        // Одинаковое смещение внутри блока — согласие, разное — отказ.
        let inner4 = tweaked(&|g| g.blocks[0].slots[0].target.offset += 4);
        same_graph(&inner4, &inner4.clone()).unwrap();
        let inner8 = tweaked(&|g| g.blocks[0].slots[0].target.offset += 8);
        differs(same_graph(&inner4, &inner8), "указатель не на начало блока");
    }

    #[test]
    fn same_graph_ignores_page_counts_of_the_first_graphs_map() {
        let first = {
            let mut c = Canvas::new(0x80, 0);
            c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x50)).fill(SYS, 0x50..0x80, 0x22).fill(SYS, 0x48..0x50, 0x11);
            c.graph(1, 0, 0)
        };
        let patched = |at_byte: usize, bytes: &[u8]| {
            let mut graph = first.clone();
            write_at(&mut graph, 2, at_byte, bytes).unwrap();
            graph
        };
        same_graph(&first, &patched(8, &[7, 9])).unwrap();
        same_graph(&patched(8, &[7, 9]), &first).unwrap();
        differs(same_graph(&first, &patched(10, &[7])), "байты блока вне указателей");
        differs(same_graph(&first, &patched(7, &[7])), "байты блока вне указателей");

        let no_map = {
            let mut c = Canvas::new(0x80, 0);
            c.ptr((SYS, 0), (SYS, 0x49)).ptr((SYS, 8), (SYS, 0x40)).fill(SYS, 0x49..0x80, 0x22).fill(SYS, 0x48..0x49, 0x11);
            c.graph(1, 0, 0)
        };
        let mut changed = no_map.clone();
        write_at(&mut changed, 1, 8, &[1]).unwrap();
        differs(same_graph(&no_map, &changed), "байты блока вне указателей");
    }

    #[test]
    fn a_map_against_a_short_partner_block_is_a_difference_in_both_directions() {
        let long_map = {
            let mut c = Canvas::new(0x80, 0);
            c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x50)).ptr((SYS, 0x40), (SYS, 0x70));
            c.fill(SYS, 0x48..0x50, 0x11).fill(SYS, 0x78..0x80, 0x33);
            c.graph(1, 0, 0)
        };
        let short_partner = {
            let mut c = Canvas::new(0x80, 0);
            c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x50)).ptr((SYS, 0x40), (SYS, 0x59)).fill(SYS, 0x48..0x50, 0x11);
            c.graph(1, 0, 0)
        };
        differs(same_graph(&long_map, &short_partner), "байты блока вне указателей");
        differs(same_graph(&short_partner, &long_map), "байты блока вне указателей");
    }

    // =========================================================================================
    // Правки
    // =========================================================================================

    fn donor(system_len: usize, graphics_len: usize) -> Graph {
        let mut c = Canvas::new(system_len, graphics_len);
        c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 8), (SYS, 0x30)).fill(SYS, 0x10..0x20, 0xa1);
        c.fill(SYS, 0x28..0x30, 0xa2).fill(SYS, 0x38..0x40, 0xa3).ptr((SYS, 0x20), (GFX, 0));
        c.fill(GFX, 8..graphics_len.min(0x20), 0xb1);
        c.graph(13, 0, 0)
    }

    #[test]
    fn graft_appends_the_source_and_drops_its_map_slot() {
        let target = sample();
        let (merged, address) = graft(&target, &donor(0x40, 0x20)).unwrap();
        assert_eq!(address, at(SYS, 0x60));
        assert_eq!((merged.system.len(), merged.graphics.len()), (160, 80));
        assert_eq!(merged.blocks.len(), 8);
        assert_eq!(
            shape(&merged)[4..],
            [
                (SYS, 0x60, 0x80, vec![(0, SYS, 0x80)]),
                (SYS, 0x80, 0x90, vec![(0, GFX, 0x30)]),
                (SYS, 0x90, 0xa0, vec![]),
                (GFX, 0x30, 0x50, vec![]),
            ]
        );
        assert_eq!(merged.system[0x68..0x70], [0; 8]);
        assert_eq!(merged.system[0x60..0x68], [0x20, 0, 0, 0x50, 0, 0, 0, 0]);
        assert_eq!(merged.root(), Some(0));
        assert_eq!(target.blocks.len(), 4);
        assert_eq!((merged.declared_version, merged.system_flags), (165, 0));

        // Источник без слота +8 остаётся как есть.
        let mut c = Canvas::new(0x30, 0);
        c.ptr((SYS, 0), (SYS, 0x20)).fill(SYS, 8..0x20, 0x5a);
        let (kept, place) = graft(&target, &c.graph(1, 0, 0)).unwrap();
        assert_eq!(kept.system[place.offset + 8..place.offset + 16], [0x5a; 8]);
        // Слоты +8 и +0x10 на один блок: уходит только первый.
        let mut c = Canvas::new(0x30, 0);
        c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 8), (SYS, 0x28)).ptr((SYS, 0x10), (SYS, 0x28));
        let (twin, place) = graft(&target, &c.graph(1, 0, 0)).unwrap();
        let relatives: Vec<usize> = twin.blocks[twin.block_at(place).unwrap()].slots.iter().map(|s| s.relative).collect();
        assert_eq!(relatives, [0, 16]);
    }

    #[test]
    fn graft_aligns_each_area_and_refuses_a_rootless_source() {
        let source = donor(0x40, 0x20);
        for ((system, graphics), expected) in [((96, 40), 0x60), ((100, 17), 0x70), ((112, 32), 0x70), ((1, 1), 0x10)] {
            let mut c = Canvas::new(system, graphics);
            if system >= 16 {
                c.ptr((SYS, 0), (SYS, 8));
            }
            let target = c.graph(165, 0xA000_0000, 0x5000_0000);
            let (merged, address) = graft(&target, &source).unwrap();
            assert_eq!(address, at(SYS, expected));
            assert_eq!(merged.blocks.len(), target.blocks.len() + source.blocks.len());
            assert_eq!((merged.system_flags, merged.graphics_flags, merged.declared_version), (0xA000_0000, 0x5000_0000, 165));
        }
        let empty = from_parts(165, 0, 0, vec![], vec![]);
        let (merged, address) = graft(&empty, &source).unwrap();
        assert_eq!(address, at(SYS, 0));
        assert_eq!(merged.blocks[0].start, 0);
        let target = sample();
        assert_eq!(failure(graft(&target, &Canvas::new(0, 16).graph(1, 0, 0))), "У источника нет корня.");
        assert_eq!(failure(graft(&target, &empty)), "У источника нет корня.");
        let (twice, place) = graft(&target, &target).unwrap();
        assert_eq!(place, at(SYS, 0x60));
        let (third, place) = graft(&twice, &source).unwrap();
        assert_eq!((place, third.blocks.len(), third.system.len()), (at(SYS, 0xc0), 12, 256));
    }

    #[test]
    fn graft_keeps_source_graphics_blocks_on_separate_chunks() {
        let mut c = Canvas::new(0x40, 0x48);
        c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 16), (SYS, 0x38));
        c.ptr((SYS, 0x20), (GFX, 0)).ptr((SYS, 0x28), (GFX, 0x18)).ptr((SYS, 0x30), (GFX, 0x30));
        c.fill(SYS, 0x38..0x40, 0xc1).fill(GFX, 8..0x18, 0xd1).fill(GFX, 0x20..0x30, 0xd2).fill(GFX, 0x38..0x48, 0xd3);
        let (merged, _) = graft(&sample(), &c.graph(13, 0, 0)).unwrap();
        let (system, graphics) = orders(&merged);
        let file = rebuild(&merged, &system, &graphics).unwrap();
        let again = scan(&Resource::parse(&file).unwrap()).unwrap();
        let gfx_starts: Vec<usize> = again.segment_blocks(GFX).iter().map(|&b| again.blocks[b].start).collect();
        assert_eq!(gfx_starts[..4], [0, 0x30, 0x50, 0x70]);
        // Системный блок вставки со старым началом 0x38 остаётся на 8 по модулю 16.
        assert!(again.segment_blocks(SYS).iter().any(|&b| again.blocks[b].start == 0x478));
    }

    #[test]
    fn append_block_aligns_and_extends_the_lists() {
        let mut graph = from_parts(165, 0, 0, vec![], vec![]);
        let indexes = [
            append_block(&mut graph, SYS, vec![1, 2, 3], vec![]),
            append_block(&mut graph, SYS, vec![4; 16], vec![]),
            append_block(&mut graph, GFX, vec![9; 5], vec![Slot { relative: 0, target: at(SYS, 0) }]),
            append_block(&mut graph, SYS, vec![], vec![]),
            append_block(&mut graph, SYS, vec![7; 4], vec![]),
        ];
        assert_eq!(indexes, [0, 1, 2, 3, 4]);
        let summary: Vec<(Segment, usize, usize)> = graph.blocks.iter().map(|b| (b.segment, b.start, b.end)).collect();
        assert_eq!(summary, [(SYS, 0, 3), (SYS, 0x10, 0x20), (GFX, 0, 5), (SYS, 0x20, 0x20), (SYS, 0x20, 0x24)]);
        let mut expected = vec![1, 2, 3];
        expected.extend([0; 13]);
        expected.extend([4; 16]);
        expected.extend([7; 4]);
        assert_eq!(graph.system, expected);
        assert_eq!(graph.block_at(at(SYS, 0x20)), Some(4));
        assert_eq!(graph.block_at(at(SYS, 0x30)), None);
        assert_eq!(graph.segment_blocks(SYS), [0, 1, 3, 4]);

        // Блок со слотом попадает в раскладку, слот пишет слово сам.
        let mut with_block = sample();
        let slots = vec![Slot { relative: 8, target: at(GFX, 0) }, Slot { relative: 0, target: at(SYS, 0) }];
        let added = append_block(&mut with_block, SYS, vec![0xab; 100], slots);
        append_block(&mut with_block, GFX, vec![0xcd; 3], vec![]);
        assert_eq!((with_block.blocks[added].start, with_block.blocks[added].end), (0x60, 0xc4));
        assert_eq!(with_block.blocks[5].start, 0x30);
        let out = flat_identity(&with_block);
        assert_eq!(out.system[0x440..0x444], [0, 0, 0, 0x50]);
        assert_eq!(out.system[0x448..0x44c], [0, 0, 0, 0x60]);
        // Цель вне блоков выдаётся при сборке.
        let mut broken = sample();
        append_block(&mut broken, SYS, vec![0; 8], vec![Slot { relative: 0, target: at(SYS, 0x1234) }]);
        let (system, graphics) = orders(&broken);
        assert_eq!(failure(rebuild_with(&broken, &system, &graphics, &raw)), "Указатель вне блоков.");
    }

    #[test]
    fn write_at_stays_inside_the_block() {
        let mut graph = sample();
        write_at(&mut graph, 1, 4, &[1, 2, 3, 4]).unwrap();
        assert_eq!(graph.system[0x24..0x28], [1, 2, 3, 4]);
        assert_eq!(graph.blocks[1].slots.len(), 1);
        write_at(&mut graph, 1, 0, &[0x5a; 16]).unwrap();
        assert_eq!(failure(write_at(&mut graph, 1, 0, &[0x5a; 17])), "Запись за пределами блока.");
        write_at(&mut graph, 1, 15, &[0x6b]).unwrap();
        write_at(&mut graph, 1, 16, &[]).unwrap();
        assert_eq!(failure(write_at(&mut graph, 1, 17, &[])), "Запись за пределами блока.");
        write_at(&mut graph, 3, 39, &[0xee]).unwrap();
        assert_eq!(graph.graphics[39], 0xee);
        let before = graph.system.clone();
        assert!(write_at(&mut graph, 1, 12, &[0; 8]).is_err());
        assert_eq!(graph.system, before);
        // Слово слота записью не создаётся.
        write_at(&mut graph, 0, 24, &(SYSTEM_BASE + 0x30).to_le_bytes()).unwrap();
        assert_eq!(graph.blocks[0].slots.len(), 2);

        // Смещение, от которого конец записи не помещается в число, — тот же отказ, а не паника и не заворот.
        for relative in [usize::MAX, usize::MAX - 3] {
            let before = sample().system;
            let mut graph = sample();
            assert_eq!(failure(write_at(&mut graph, 1, relative, &[1, 2, 3, 4])), "Запись за пределами блока.");
            assert_eq!(graph.system, before);
        }
        assert_eq!(
            panic_text(|| write_at(&mut sample(), 99, 0, &[1]).is_ok()),
            "index out of bounds: the len is 4 but the index is 99"
        );
        // При сборке слот перезаписывает слово.
        let mut over = sample();
        write_at(&mut over, 0, 0, &[0xaa; 8]).unwrap();
        assert_eq!(flat_identity(&over).system, flat_identity(&sample()).system);
    }

    #[test]
    fn retarget_checks_the_new_target_first() {
        let mut graph = sample();
        assert_eq!(pointer_from(&graph, 0, 0), Some(at(SYS, 32)));
        assert_eq!(pointer_from(&graph, 0, 8), Some(at(SYS, 48)));
        assert_eq!(pointer_from(&graph, 0, 4), None);
        assert_eq!(pointer_from(&graph, 1, 0), Some(at(GFX, 0)));
        assert_eq!(pointer_from(&graph, 2, 0), None);
        retarget(&mut graph, 0, 0, at(SYS, 0x30)).unwrap();
        assert_eq!(pointer_from(&graph, 0, 0), Some(at(SYS, 0x30)));
        assert_eq!(graph.system[..4], [0x20, 0, 0, 0x50]);
        retarget(&mut graph, 0, 8, at(GFX, 0)).unwrap();
        for bad in [at(SYS, 0x34), at(SYS, 0x60), at(SYS, 0x1000)] {
            assert_eq!(failure(retarget(&mut graph, 0, 0, bad)), "Новая цель указателя — не начало блока.");
        }
        assert_eq!(failure(retarget(&mut graph, 0, 4, at(SYS, 0x30))), "В блоке нет указателя по этому смещению.");
        assert_eq!(failure(retarget(&mut graph, 0, 4, at(SYS, 0x34))), "Новая цель указателя — не начало блока.");
        let index = "index out of bounds: the len is 4 but the index is 99";
        assert_eq!(panic_text(|| retarget(&mut sample(), 99, 0, at(SYS, 0)).is_ok()), index);
        assert_eq!(failure(retarget(&mut sample(), 99, 0, at(SYS, 0x1000))), "Новая цель указателя — не начало блока.");
        let out = flat_identity(&graph);
        assert_eq!(out.system[..4], [0x30, 0, 0, 0x50]);
        assert_eq!(out.system[8..12], [0, 0, 0, 0x60]);

        let mut twin = sample();
        twin.blocks[0].slots.push(Slot { relative: 0, target: at(SYS, 0x30) });
        retarget(&mut twin, 0, 0, at(SYS, 0x30)).unwrap();
        let targets: Vec<usize> = twin.blocks[0].slots.iter().map(|s| s.target.offset).collect();
        assert_eq!(targets, [0x30, 0x30, 0x30]);
        let mut zero = sample();
        let empty = append_block(&mut zero, SYS, vec![], vec![]);
        let start = zero.blocks[empty].start;
        assert_eq!(failure(retarget(&mut zero, 0, 0, at(SYS, start))), "Новая цель указателя — не начало блока.");
    }

    // =========================================================================================
    // Выделение
    // =========================================================================================

    /// Корень, Y, D (словарь в середине), E, X (недостижим из D) и пять графических блоков.
    fn g6() -> Graph {
        let mut c = Canvas::new(0x100, 0x80);
        c.ptr((SYS, 0), (SYS, 0x40)).ptr((SYS, 8), (SYS, 0x80)).ptr((SYS, 0x10), (SYS, 0x20)).fill(SYS, 0x18..0x20, 0x11);
        c.ptr((SYS, 0x20), (GFX, 0)).fill(SYS, 0x28..0x40, 0x22);
        c.ptr((SYS, 0x40), (SYS, 0x70)).ptr((SYS, 0x48), (GFX, 0x30)).fill(SYS, 0x50..0x70, 0xd1);
        c.fill(SYS, 0x70..0x80, 0xe1).ptr((SYS, 0x80), (GFX, 0x20)).fill(SYS, 0x88..0x100, 0x91);
        c.fill(GFX, 0..0x20, 0x61).fill(GFX, 0x20..0x30, 0x62).fill(GFX, 0x30..0x60, 0x63);
        c.ptr((GFX, 0x60), (GFX, 0x70)).fill(GFX, 0x68..0x70, 0x64).ptr((GFX, 0x70), (GFX, 0x60)).fill(GFX, 0x78..0x80, 0x65);
        c.graph(165, 0xA000_0000, 0x5000_0000)
    }

    #[test]
    fn subgraph_keeps_what_the_root_reaches() {
        let graph = g6();
        let part = subgraph(&graph, at(SYS, 0x40)).unwrap();
        assert_eq!(
            shape(&part),
            [
                (SYS, 0, 0x30, vec![(0, SYS, 0x30), (8, GFX, 0)]),
                (SYS, 0x30, 0x40, vec![]),
                (GFX, 0, 0x30, vec![]),
            ]
        );
        assert_eq!(part.system.len(), 0x40);
        // Слова остаются прежними, пока граф не собран.
        assert_eq!(part.system[..4], [0x70, 0, 0, 0x50]);
        assert_eq!(part.graphics[..4], [0x63; 4]);
        assert_eq!((part.declared_version, part.system_flags, part.graphics_flags), (165, 0xA000_0000, 0x5000_0000));
        let out = flat_identity(&part);
        assert_eq!(out.system[..4], [0x30, 0, 0, 0x50]);
        assert_eq!(out.system[8..12], [0, 0, 0, 0x60]);

        let all = subgraph(&graph, at(SYS, 0)).unwrap();
        assert_eq!(all.segment_blocks(SYS).len(), 5);
        assert_eq!(all.segment_blocks(GFX).len(), 3);
        assert_eq!(
            shape(&subgraph(&graph, at(SYS, 0x20)).unwrap()),
            [(SYS, 0, 0x20, vec![(0, GFX, 0)]), (GFX, 0, 0x20, vec![])]
        );
        assert_eq!(shape(&subgraph(&graph, at(SYS, 0x70)).unwrap()), [(SYS, 0, 0x10, vec![])]);
        assert_eq!(subgraph(&graph, at(SYS, 0x80)).unwrap().graphics.len(), 0x10);
        for bad in [at(SYS, 0x44), at(SYS, 0x1000), at(SYS, 0x100)] {
            assert_eq!(failure(subgraph(&graph, bad)), "Корень вне блоков.");
        }
    }

    #[test]
    fn subgraph_follows_cycles_and_checks_reachable_pointers_only() {
        let mut c = Canvas::new(0x30, 0);
        c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 0x10), (SYS, 0x20)).ptr((SYS, 0x20), (SYS, 0x10));
        let cycle = subgraph(&c.graph(1, 0, 0), at(SYS, 0x10)).unwrap();
        assert_eq!(
            shape(&cycle),
            [(SYS, 0, 0x10, vec![(0, SYS, 0x10)]), (SYS, 0x10, 0x20, vec![(0, SYS, 0)])]
        );
        let mut bad = g6();
        bad.blocks[1].slots[0].target = at(SYS, 0x1000);
        assert_eq!(failure(subgraph(&bad, at(SYS, 0))), "Указатель вне блоков.");
        assert!(subgraph(&bad, at(SYS, 0x40)).is_ok());
    }

    #[test]
    fn a_subgraph_root_in_the_graphics_area_is_refused() {
        let refusal = "Корень подграфа должен лежать в системной области.";
        assert_eq!(failure(subgraph(&g6(), at(GFX, 0x30))), refusal);
        assert_eq!(failure(subgraph(&Canvas::new(0, 16).graph(1, 0, 0), at(GFX, 0))), refusal);
        // Адрес вне блоков по-прежнему отвечает прежним отказом.
        assert_eq!(failure(subgraph(&g6(), at(GFX, 0x31))), "Корень вне блоков.");
    }

    #[test]
    fn drop_unreferenced_graphics_keeps_every_system_block() {
        let graph = g6();
        let trimmed = drop_unreferenced_graphics(&graph).unwrap();
        assert_eq!(trimmed.segment_blocks(SYS).len(), 5);
        let kept: Vec<(usize, usize)> = trimmed
            .segment_blocks(GFX)
            .iter()
            .map(|&b| (trimmed.blocks[b].start, trimmed.blocks[b].end))
            .collect();
        assert_eq!(kept, [(0, 0x20), (0x20, 0x30), (0x30, 0x60)]);
        assert_eq!((trimmed.graphics.len(), trimmed.system.len()), (96, 0x100));
        for same in [sample(), paged()] {
            let unchanged = drop_unreferenced_graphics(&same).unwrap();
            assert_eq!(shape(&unchanged), shape(&same));
            assert_eq!((unchanged.system.len(), unchanged.graphics.len()), (same.system.len(), same.graphics.len()));
        }
        let paged_kept = drop_unreferenced_graphics(&paged()).unwrap();
        assert_eq!((paged_kept.system.len(), paged_kept.graphics.len()), (7680, 4096));
        assert_eq!((paged_kept.system_flags, paged_kept.graphics_flags), (0xaf00_0000, 0x5100_0000));
        assert_eq!(paged_kept.page_starts, paged().page_starts);

        assert_eq!(failure(drop_unreferenced_graphics(&Canvas::new(0, 16).graph(1, 0, 0))), "Корень вне блоков.");
        assert_eq!(failure(drop_unreferenced_graphics(&from_parts(1, 0, 0, vec![], vec![]))), "Корень вне блоков.");
        let mut bad = g6();
        bad.blocks[2].slots[0].target = at(GFX, 0x1000);
        assert_eq!(failure(drop_unreferenced_graphics(&bad)), "Указатель вне блоков.");
        let mut quiet = g6();
        let last = quiet.blocks.len() - 1;
        quiet.blocks[last].slots[0].target = at(GFX, 0x1000);
        assert!(drop_unreferenced_graphics(&quiet).is_ok());

        let mut c = Canvas::new(0x40, 0x20);
        c.ptr((SYS, 0), (SYS, 0x10)).ptr((SYS, 0x20), (SYS, 0x30)).ptr((SYS, 0x30), (SYS, 0x20)).ptr((SYS, 0x38), (GFX, 0x10));
        let ghosts = drop_unreferenced_graphics(&c.graph(1, 0, 0)).unwrap();
        assert_eq!(ghosts.segment_blocks(SYS).len(), 4);
        assert_eq!(shape(&ghosts)[4], (GFX, 0, 0x10, vec![]));
    }

    #[test]
    fn compacting_aligns_blocks_by_their_old_start() {
        for (old_start, expected) in [(0x30usize, 32usize), (0x38, 24), (0x34, 20), (0x32, 20), (0x31, 20), (0x40, 32)] {
            let mut c = Canvas::new(0x10, 128);
            c.ptr((SYS, 0), (GFX, 0)).ptr((SYS, 8), (GFX, old_start));
            // Блоки 0x14.. и 96..128 ссылаются только друг на друга: из системы их никто не называет.
            c.ptr((GFX, 0x18), (GFX, 96)).ptr((GFX, 96), (GFX, 0x14));
            let kept = drop_unreferenced_graphics(&c.graph(1, 0, 0)).unwrap();
            let spans: Vec<(usize, usize)> = kept
                .segment_blocks(GFX)
                .iter()
                .map(|&b| (kept.blocks[b].start, kept.blocks[b].end))
                .collect();
            assert_eq!(spans.len(), 2);
            assert_eq!(spans[0], (0, 0x14));
            assert_eq!(spans[1].0, expected, "старое начало {old_start:#x}");
            assert_eq!(spans[1].1 - spans[1].0, 96 - old_start);
        }
    }

    #[test]
    fn dictionary_address_goes_root_group_dictionary() {
        let build = |group_at: usize, with_dictionary: bool| {
            let mut c = Canvas::new(0x80, 0);
            c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 0x10), (SYS, group_at));
            if with_dictionary {
                c.ptr((SYS, group_at + 8), (SYS, 0x60));
            }
            c.graph(1, 0, 0)
        };
        assert_eq!(dictionary_address(&build(0x40, true)), Some(at(SYS, 0x60)));
        assert_eq!(dictionary_address(&build(0x40, false)), None);
        assert_eq!(dictionary_address(&from_parts(1, 0, 0, vec![], vec![])), None);
        assert_eq!(dictionary_address(&Canvas::new(0, 16).graph(1, 0, 0)), None);
        let mut no_group = Canvas::new(0x80, 0);
        no_group.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 8), (SYS, 0x40));
        assert_eq!(dictionary_address(&no_group.graph(1, 0, 0)), None);
        // Слот +8 берётся у блока, в котором лежит цель, а не у самой цели.
        let mut inner = Canvas::new(0x80, 0);
        inner.ptr((SYS, 0x10), (SYS, 0x40)).ptr((SYS, 0x48), (SYS, 0x60));
        let mut inner = inner.graph(1, 0, 0);
        inner.blocks[0].slots[0].target.offset = 0x44;
        assert_eq!(dictionary_address(&inner), Some(at(SYS, 0x60)));
        // Невыровненное слово слотом не считается.
        let mut unaligned = Canvas::new(0x80, 0);
        unaligned.ptr((SYS, 0x10), (SYS, 0x44));
        unaligned.system[0x4c..0x54].copy_from_slice(&(SYSTEM_BASE + 0x60).to_le_bytes());
        assert_eq!(dictionary_address(&unaligned.graph(1, 0, 0)), None);
        // Группа может быть корнем.
        let mut same = Canvas::new(0x80, 0);
        same.ptr((SYS, 0x10), (SYS, 0)).ptr((SYS, 8), (SYS, 0x40));
        assert_eq!(dictionary_address(&same.graph(1, 0, 0)), Some(at(SYS, 0x40)));
        // Группа в графической области.
        let mut gfx_group = Canvas::new(0x80, 0x40);
        gfx_group.ptr((SYS, 0x10), (GFX, 0x10)).ptr((GFX, 0x18), (SYS, 0x60));
        assert_eq!(dictionary_address(&gfx_group.graph(1, 0, 0)), Some(at(SYS, 0x60)));
    }

    // =========================================================================================
    // repack
    // =========================================================================================

    fn repack_graph() -> Graph {
        let mut c = Canvas::new(0x80, 0x40);
        c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 16), (GFX, 0)).ptr((SYS, 0x20), (SYS, 0x60)).ptr((GFX, 16), (SYS, 0x20));
        c.graph(1, 0, 0)
    }

    #[test]
    fn repack_carries_whole_slots_and_stretches_words() {
        let graph = repack_graph();
        let (all, carried) = repack(&graph, &[(SYS, 0, 0x80), (GFX, 0, 0x40)]).unwrap();
        assert_eq!(carried, 4);
        assert_eq!(
            shape(&all),
            [
                (SYS, 0, 0x80, vec![(0, SYS, 0x20), (16, GFX, 0), (32, SYS, 0x60)]),
                (GFX, 0, 0x40, vec![(16, SYS, 0x20)]),
            ]
        );
        assert_eq!((all.system.len(), all.graphics.len()), (0x80, 0x40));

        let (head, carried) = repack(&graph, &[(SYS, 0, 0x20)]).unwrap();
        assert_eq!((carried, shape(&head)), (2, vec![(SYS, 0, 0x20, vec![(0, SYS, 0x20), (16, GFX, 0)])]));
        let (apart, carried) = repack(&graph, &[(SYS, 0x20, 0x40), (SYS, 0x60, 0x80)]).unwrap();
        assert_eq!(
            (carried, shape(&apart)),
            (1, vec![(SYS, 0x20, 0x40, vec![(0, SYS, 0x60)]), (SYS, 0x60, 0x80, vec![])])
        );
        let (stretched, _) = repack(&graph, &[(SYS, 0, 0x14)]).unwrap();
        assert_eq!(shape(&stretched)[0].2, 0x18);
        let (rounded, _) = repack(&graph, &[(SYS, 0x2c, 0x40)]).unwrap();
        assert_eq!(shape(&rounded)[0].1, 0x28);
        assert_eq!(rounded.system[0x28..0x2c], [0; 4]);
        let (word, carried) = repack(&graph, &[(SYS, 0x14, 0x40)]).unwrap();
        assert_eq!((shape(&word)[0].1, carried), (0x10, 2));
        assert_eq!(word.system[0x13], 0);

        let skipped = [(SYS, 5, 5), (SYS, 9, 3), (GFX, 0x100, 0x50), (SYS, 0x200, 0x200)];
        let (nothing, carried) = repack(&graph, &skipped).unwrap();
        assert!(nothing.blocks.is_empty());
        assert_eq!(carried, 0);
        let (touching, _) = repack(&graph, &[(SYS, 0, 0x10), (SYS, 0x10, 0x20), (SYS, 8, 0x18)]).unwrap();
        assert_eq!(shape(&touching).len(), 1);
    }

    #[test]
    fn repack_merges_after_rounding_and_clears_the_gap() {
        let mut c = Canvas::new(0x80, 0);
        c.ptr((SYS, 0x10), (SYS, 0x40)).fill(SYS, 0x18..0x1c, 0xee).fill(SYS, 0x1c..0x30, 0x55);
        let graph = c.graph(1, 0, 0);
        let (joined, carried) = repack(&graph, &[(SYS, 0, 0x14), (SYS, 0x1c, 0x30)]).unwrap();
        assert_eq!(shape(&joined).iter().map(|b| (b.1, b.2)).collect::<Vec<_>>(), [(0, 0x30)]);
        assert_eq!(carried, 1);
        assert_eq!(joined.system[0x18..0x1c], [0; 4]);
        let (also, _) = repack(&graph, &[(SYS, 0, 0x1a), (SYS, 0x1c, 0x30)]).unwrap();
        assert_eq!(shape(&also).len(), 1);
        assert_eq!(also.system[0x1a..0x1c], [0; 2]);
        for bad in [(SYS, 0, 0x81), (GFX, 0, 1), (SYS, 0, usize::MAX)] {
            assert_eq!(failure(repack(&graph, &[bad])), "Интервал выходит за область.");
        }
        assert_eq!(failure(repack(&graph, &[(SYS, 0, 0x20), (SYS, 0x70, 0x90)])), "Интервал выходит за область.");
        let (paged_all, carried) = repack(&paged(), &[(SYS, 0, 0x1e00), (GFX, 0, 0x1000)]).unwrap();
        assert_eq!((paged_all.blocks.len(), carried), (2, 7));
        assert_eq!(paged_all.page_starts, paged().page_starts);
    }

    // =========================================================================================
    // Свойства типов
    // =========================================================================================

    #[test]
    fn type_properties_are_stable() {
        assert!(SYS < GFX);
        assert_eq!(format!("{SYS:?} {GFX:?}"), "System Graphics");
        assert_eq!(format!("{:?}", at(GFX, 3)), "Address { segment: Graphics, offset: 3 }");
        assert_eq!(
            format!("{:?}", Slot { relative: 8, target: at(SYS, 0x20) }),
            "Slot { relative: 8, target: Address { segment: System, offset: 32 } }"
        );
        assert_eq!(
            format!("{:?}", sample().blocks[1]),
            "Block { segment: System, start: 32, end: 48, slots: [Slot { relative: 0, target: Address { segment: Graphics, offset: 0 } }] }"
        );
        let pages = pack_pages(&[0x100, 0x100], 0x5000_0000, 128).unwrap();
        assert_eq!(format!("{pages:?}"), "Pages { flags: 1342308352, size: 8192, count: 1, starts: [0, 256] }");
        assert_eq!(pages.clone(), pages);
        assert_eq!((ALIGN, MAX_PAGES, MAX_RESOURCE_PAGES), (16, 5663, 128));
    }

    #[test]
    fn a_root_slot_pointing_at_the_root_is_not_taken_for_the_page_map() {
        let mut c = Canvas::new(0x40, 0);
        c.ptr((SYS, 0), (SYS, 0x20)).ptr((SYS, 8), (SYS, 0)).fill(SYS, 0x28..0x40, 5);
        let graph = c.graph(165, 0, 0);
        assert_eq!(graph.map_block(), None);
        let (system, graphics) = orders(&graph);
        let rebuilt = rebuild(&graph, &system, &graphics).unwrap();
        let again = scan(&Resource::parse(&rebuilt).unwrap()).unwrap();
        same_graph(&graph, &again).unwrap();
        let root = again.root().unwrap();
        assert_eq!(again.slot_at(root, 8).map(|slot| slot.target), Some(at(SYS, 0)));
    }
}
