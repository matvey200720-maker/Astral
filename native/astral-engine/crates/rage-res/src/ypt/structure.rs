//! Структура ядра `core.ypt` Legacy: глубокая копия правила эффекта, записи словарей, листы текстур, удаление правил.
//!
//! Примитивы простые и общие, без привязки к клонам: ими пользуются клоны эффектов, слоты следа и всё, что меняет не
//! значения, а состав ядра. Образ — граф блоков ресурса (`resource_graph`): новые блоки дописываются в конец областей,
//! указатели правятся и в словах области, и в слотах графа, а при сборке файла страницы пересчитываются заново.
//!
//! Что копируется и что остаётся общим. Правило эффекта копируется вместе со всем, на что оно ссылается: события,
//! эмиттеры, частицы, поведения, области, эволюции, строки. Общими остаются только четыре вещи, на которые копия ведёт
//! прежние указатели: корень ядра, листы текстур частиц, порождаемые частицами эффекты и модели частиц. Так делает и
//! помощник: его двоичная копия возвращает эти ссылки на штатные объекты.
//!
//! Записи словарей лежат парами «хеш имени — объект», по возрастанию хеша. Вставка встаёт перед первой записью, чей хеш
//! не меньше нового, и отказывает, если такой хеш уже есть; удаление снимает пару целиком.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::image::{
    List, DICTIONARY_VALUES, EFFECT_NAME, EMITTER_NAME, PARTICLE_NAME, ROOT_EFFECTS, ROOT_EMITTERS,
    ROOT_PARTICLES, ROOT_TEXTURES, TEXTURE_NAME,
};
use super::names::hash_name;
use crate::error::{Error, Result};
use crate::resource::{Resource, GRAPHICS_BASE, SYSTEM_BASE, VERSION_YPT_LEGACY};
use crate::resource_graph::{
    append_block, from_parts, identity_order, rebuild, Address, Graph, Segment, Slot,
};

/// Смещение списка хешей имён в словаре.
pub const DICTIONARY_HASHES: usize = 0x20;
/// Правило эффекта: корень ядра, события (указатель, число, ёмкость), эволюции.
pub const EFFECT_ROOT_LINK: usize = 0x28;
pub const EFFECT_EVENTS: usize = 0x38;
/// Событие: номер, имена эмиттера и частицы (строки), сами правила.
pub const EVENT_INDEX: usize = 0x08;
pub const EVENT_EMITTER_NAME: usize = 0x30;
pub const EVENT_PARTICLE_NAME: usize = 0x38;
pub const EVENT_EMITTER: usize = 0x40;
pub const EVENT_PARTICLE: usize = 0x48;
/// Частица: два порождателя эффектов (указатель на эффект лежит в них по 0x58), модели, переменные шейдера.
pub const PARTICLE_SPAWNERS: [usize; 2] = [0x20, 0x90];
pub const SPAWNER_EFFECT: usize = 0x58;
pub const PARTICLE_DRAWABLES: usize = 0x210;
pub const DRAWABLE_STRIDE: usize = 0x30;
pub const DRAWABLE_MODEL: usize = 0x18;
pub const PARTICLE_VARS: usize = 0x1F0;
/// Переменная шейдера: вид (6 — лист), указатель на лист, имя листа (строка), хеш имени.
pub const VAR_KIND: usize = 0x14;
pub const VAR_KIND_TEXTURE: u8 = 6;
pub const VAR_TEXTURE: usize = 0x28;
pub const VAR_TEXTURE_NAME: usize = 0x30;
pub const VAR_TEXTURE_HASH: usize = 0x38;
/// Описание текстуры: указатель на пиксели (графическая область).
pub const TEXTURE_PIXELS: usize = 0x70;
/// Описание текстуры: размеры, глубина, шаг строки, формат, ступени.
pub const TEXTURE_WIDTH: usize = 0x50;
pub const TEXTURE_HEIGHT: usize = 0x52;
pub const TEXTURE_DEPTH: usize = 0x54;
pub const TEXTURE_STRIDE: usize = 0x56;
pub const TEXTURE_FORMAT: usize = 0x58;
pub const TEXTURE_LEVELS: usize = 0x5D;
/// Описание текстуры не короче этого (до указателя пикселей включительно).
const TEXTURE_END: usize = 0x78;

const MSG_EOF: &str = "Чтение за концом данных ресурса.";
const MSG_CUT_BODY: &str = "Ресурс короче заявленного: разбирать нечего.";
const MSG_NO_ROOT: &str = "Корень ресурса недоступен.";
const MSG_OUTSIDE: &str = "Указатель вне блоков.";

/// Четыре словаря ядра.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Effect,
    Emitter,
    Particle,
    Texture,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Effect, Kind::Emitter, Kind::Particle, Kind::Texture];

    /// Вид в ключе описи («effect:имя»).
    pub fn label(self) -> &'static str {
        match self {
            Kind::Effect => "effect",
            Kind::Emitter => "emitter",
            Kind::Particle => "particle",
            Kind::Texture => "texture",
        }
    }

    /// Слово для отказов помощника («YPT effect rule dictionary is inconsistent»).
    pub fn long_label(self) -> &'static str {
        match self {
            Kind::Effect => "effect rule",
            Kind::Emitter => "emitter rule",
            Kind::Particle => "particle rule",
            Kind::Texture => "texture",
        }
    }

    /// Поле корня, где лежит словарь.
    pub fn field(self) -> usize {
        match self {
            Kind::Effect => ROOT_EFFECTS,
            Kind::Emitter => ROOT_EMITTERS,
            Kind::Particle => ROOT_PARTICLES,
            Kind::Texture => ROOT_TEXTURES,
        }
    }

    /// Смещение указателя на имя внутри записи.
    pub fn name_at(self) -> usize {
        match self {
            Kind::Effect => EFFECT_NAME,
            Kind::Emitter => EMITTER_NAME,
            Kind::Particle => PARTICLE_NAME,
            Kind::Texture => TEXTURE_NAME,
        }
    }
}

/// Запись словаря: хеш имени и объект (пустой указатель — `None`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    pub hash: u32,
    pub object: Option<usize>,
}

/// Копия правила эффекта: правило, его события и их правила эмиттеров и частиц (без повторов, в порядке появления).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectCopy {
    pub effect: usize,
    pub events: Vec<usize>,
    pub emitters: Vec<usize>,
    pub particles: Vec<usize>,
}

/// Имена копии: правила эффекта и по одному на каждый эмиттер и каждую частицу (в порядке `EffectCopy`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EffectNames {
    pub effect: String,
    pub emitters: Vec<String>,
    pub particles: Vec<String>,
}

/// Что удалено вместе с правилом эффекта: имена записей по видам.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Removed {
    pub effects: Vec<String>,
    pub emitters: Vec<String>,
    pub particles: Vec<String>,
}

/// Новый лист текстуры: имя, размеры, формат, ступени и пиксели (все ступени подряд).
#[derive(Debug, Clone)]
pub struct TextureSpec<'a> {
    pub name: &'a str,
    pub width: u16,
    pub height: u16,
    pub depth: u16,
    pub stride: u16,
    pub levels: u8,
    pub format: u32,
    pub pixels: &'a [u8],
}

/// Кусок графа, который переносится: подряд идущие блоки источника, склеенные в один (так массивы и объекты, которые
/// указатели разрезали на блоки, остаются сплошными, а смещения внутри них — прежними), с уже разобранными целями слотов.
struct Piece {
    segment: Segment,
    start: usize,
    bytes: Vec<u8>,
    slots: Vec<PieceSlot>,
    /// Блоки куска: номер в источнике и смещение от начала куска.
    members: Vec<(usize, usize)>,
}

struct PieceSlot {
    relative: usize,
    target: Address,
    /// Блок источника, в который ведёт слот, и смещение внутри него.
    block: usize,
    inside: usize,
    /// Слот не идёт за цель: у копии он ведёт туда же, куда вёл у образца.
    pinned: bool,
}

/// Слово копии, которое вело за пределы переносимого куска из другого файла: цель осталась в источнике.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dangling {
    /// Смещение слова в системной области приёмника.
    pub at: usize,
    pub target: Address,
}

/// Итог переноса: куда встали блоки и какие слова остались без цели.
#[derive(Debug, Default)]
pub struct Planted {
    /// (начало, конец, новое начало) системных блоков источника по возрастанию начала.
    spans: Vec<(usize, usize, usize)>,
    pub dangling: Vec<Dangling>,
}

impl Planted {
    /// Новое смещение для смещения системной области источника; `None`, если блок не переносился.
    pub fn translate(&self, old: usize) -> Option<usize> {
        let at = self.spans.partition_point(|&(start, _, _)| start <= old);
        let (start, end, new) = *self.spans.get(at.checked_sub(1)?)?;
        (old < end).then(|| new + (old - start))
    }
}

fn sys(offset: usize) -> Address {
    Address {
        segment: Segment::System,
        offset,
    }
}

fn word_of(target: Address) -> u64 {
    let base = match target.segment {
        Segment::System => SYSTEM_BASE,
        Segment::Graphics => GRAPHICS_BASE,
    };
    base + target.offset as u64
}

/// Сборка кусков, достижимых от `roots`: слоты, чьи слова названы в `stops`, за цель не идут, корень ядра не переносится.
fn gather(
    graph: &Graph,
    extents: &BTreeMap<usize, usize>,
    roots: &[usize],
    stops: &HashSet<usize>,
) -> Result<Vec<Piece>> {
    let root_block = graph.root();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut pending: Vec<usize> = Vec::new();
    for &root in roots {
        let index = graph
            .block_at(sys(root))
            .filter(|&index| graph.blocks[index].start == root)
            .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
        if seen.insert(index) {
            pending.push(index);
        }
    }
    let mut found: Vec<usize> = Vec::new();
    while let Some(index) = pending.pop() {
        found.push(index);
        let block = &graph.blocks[index];
        // Объект, начавшийся в этом блоке, переносится целиком: блоки, на которые он простирается, идут следом.
        if block.segment == Segment::System {
            for (&offset, &length) in extents.range(block.start..block.end) {
                let mut cursor = block.end;
                while cursor < offset + length {
                    let Some(next) = graph.block_at(sys(cursor)) else { break };
                    // Другой объект, который начался внутри этого и вылез за его край (длина в карте завышена: объекты по
                    // 0xD0 идут с шагом 0xB0), — сосед, а не часть объекта: ни он, ни то, что за ним, не переносятся. Иначе
                    // копия донора тянула бы всё, что лежит следом: у ядра игры следом лежит своё же, а у ядра,
                    // записанного помощником (объекты по страницам, «первый подходящий»), — чужие правила целиком
                    // (слот поверх выхода помощника уносил 13 472 блока и 2,4 МБ вместо 132 блоков и 72 КБ).
                    if extents
                        .get(&graph.blocks[next].start)
                        .is_some_and(|&inner| graph.blocks[next].start + inner > offset + length)
                    {
                        break;
                    }
                    if Some(next) != root_block && seen.insert(next) {
                        pending.push(next);
                    }
                    cursor = graph.blocks[next].end;
                }
            }
        }
        for slot in &block.slots {
            if block.segment == Segment::System && stops.contains(&(block.start + slot.relative)) {
                continue;
            }
            let next = graph
                .block_at(slot.target)
                .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
            if Some(next) == root_block {
                continue;
            }
            if seen.insert(next) {
                pending.push(next);
            }
        }
    }
    found.sort_unstable();
    // Подряд идущие блоки одной области (конец одного — начало следующего) переносятся одним куском.
    let mut runs: Vec<Vec<usize>> = Vec::new();
    for index in found {
        let block = &graph.blocks[index];
        let joins = runs.last().and_then(|run| run.last()).is_some_and(|&last| {
            let before = &graph.blocks[last];
            before.segment == block.segment && before.end == block.start
        });
        match runs.last_mut() {
            Some(run) if joins => run.push(index),
            _ => runs.push(vec![index]),
        }
    }
    runs.into_iter()
        .map(|run| -> Result<Piece> {
            let first = &graph.blocks[run[0]];
            let (segment, start) = (first.segment, first.start);
            let end = graph.blocks[*run.last().unwrap_or(&run[0])].end;
            let mut slots = Vec::new();
            let mut members = Vec::new();
            for &index in &run {
                let block = &graph.blocks[index];
                let shift = block.start - start;
                members.push((index, shift));
                for slot in &block.slots {
                    let target = graph
                        .block_at(slot.target)
                        .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
                    slots.push(PieceSlot {
                        relative: shift + slot.relative,
                        target: slot.target,
                        block: target,
                        inside: slot.target.offset - graph.blocks[target].start,
                        pinned: block.segment == Segment::System
                            && stops.contains(&(block.start + slot.relative)),
                    });
                }
            }
            Ok(Piece {
                segment,
                start,
                bytes: graph.bytes(segment)[start..end].to_vec(),
                slots,
                members,
            })
        })
        .collect()
}

/// Кладёт куски в конец областей приёмника. `foreign` — куски из другого файла: слоты за пределы куска теряют цель.
fn plant(dst: &mut Graph, pieces: Vec<Piece>, foreign: bool) -> Result<Planted> {
    let mut landing: HashMap<usize, (Segment, usize)> = HashMap::new();
    let mut placed: Vec<usize> = Vec::new();
    for piece in &pieces {
        let slots = piece
            .slots
            .iter()
            .map(|slot| Slot {
                relative: slot.relative,
                target: slot.target,
            })
            .collect();
        // Начало куска у копии стоит по тому же остатку от 16, что у образца: выравнивание данных внутри не сбивается.
        let pad = piece.start % 16;
        let mut bytes = vec![0u8; pad];
        bytes.extend_from_slice(&piece.bytes);
        let index = append_block(dst, piece.segment, bytes, slots);
        dst.blocks[index].start += pad;
        let start = dst.blocks[index].start;
        for &(old, shift) in &piece.members {
            landing.insert(old, (piece.segment, start + shift));
        }
        placed.push(index);
    }
    let mut planted = Planted::default();
    for (piece, &index) in pieces.iter().zip(&placed) {
        let (segment, start) = (piece.segment, dst.blocks[index].start);
        if segment == Segment::System {
            planted
                .spans
                .push((piece.start, piece.start + piece.bytes.len(), start));
        }
        let mut gone: Vec<usize> = Vec::new();
        for (k, slot) in piece.slots.iter().enumerate() {
            let at = start + slot.relative;
            let moved = landing.get(&slot.block).filter(|_| !slot.pinned);
            match (moved, foreign) {
                (Some(&(lane, new_start)), _) => {
                    let target = Address {
                        segment: lane,
                        offset: new_start + slot.inside,
                    };
                    dst.blocks[index].slots[k].target = target;
                    write_word(dst, segment, at, word_of(target));
                }
                (None, false) => {}
                (None, true) => {
                    gone.push(k);
                    write_word(dst, segment, at, 0);
                    if segment == Segment::System {
                        planted.dangling.push(Dangling {
                            at,
                            target: slot.target,
                        });
                    }
                }
            }
        }
        for &k in gone.iter().rev() {
            dst.blocks[index].slots.remove(k);
        }
    }
    Ok(planted)
}

/// Слова ресурса, которые хранят хеш, а не указатель, хотя могут выглядеть указателем: хеши имён свойств (по карте
/// длин), виды поведений, записи карты свойств эволюций, хеш листа в переменной шейдера, нечётный хвост массива хешей
/// каждого словаря.
fn hash_words(res: &Resource, name_hashes: &[usize]) -> Vec<usize> {
    hash_words_by_kind(res, name_hashes).into_iter().map(|(_, at)| at).collect()
}

/// Вид слова-хеша: что за значение лежит в слове, которое по виду может быть указателем.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum HashKind {
    /// Хеш имени свойства ключевых кадров (`+0x68` свойства).
    Property,
    /// Вид поведения частицы (`+8` поведения).
    Behaviour,
    /// Запись карты свойств набора эволюций.
    Evolution,
    /// Хеш листа в переменной шейдера (`+0x38`).
    Leaf,
    /// Нечётный хвост массива хешей словаря.
    DictionaryTail,
}

impl HashKind {
    pub fn label(self) -> &'static str {
        match self {
            HashKind::Property => "property",
            HashKind::Behaviour => "behaviour",
            HashKind::Evolution => "evolution",
            HashKind::Leaf => "leaf",
            HashKind::DictionaryTail => "dictionaryTail",
        }
    }
}

/// Слова-хеши ядра по видам: положение слова в системной области. Те же слова, что прикрывает разбор.
pub fn hash_word_kinds(res: &Resource) -> Vec<(HashKind, usize)> {
    let (_, name_hashes) = extents_of(res);
    hash_words_by_kind(res, &name_hashes)
}

fn hash_words_by_kind(res: &Resource, name_hashes: &[usize]) -> Vec<(HashKind, usize)> {
    let list = |at: usize| -> Option<(usize, usize)> {
        let found = res.pointer_list(at).ok()?;
        Some((res.at(found.entries)?, usize::from(found.count)))
    };
    let objects = |at: usize| -> Vec<usize> {
        list(at).map_or_else(Vec::new, |(array, count)| {
            (0..count).filter_map(|k| res.pointer_at(array + k * 8)).collect()
        })
    };
    let mut words: Vec<(HashKind, usize)> = name_hashes.iter().map(|&at| (HashKind::Property, at)).collect();
    let Some(root) = res.root() else { return words };
    let dictionary = |field: usize| res.pointer_at(root + field);
    let values = |field: usize| dictionary(field).map_or_else(Vec::new, |at| objects(at + DICTIONARY_VALUES));
    for particle in values(ROOT_PARTICLES) {
        for at in super::clone_kit::PARTICLE_BEHAVIOURS {
            words.extend(objects(particle + at).into_iter().map(|behaviour| (HashKind::Behaviour, behaviour + 8)));
        }
        for variable in objects(particle + PARTICLE_VARS) {
            if res.u8(variable + VAR_KIND).is_ok_and(|kind| kind == VAR_KIND_TEXTURE) {
                words.push((HashKind::Leaf, variable + VAR_TEXTURE_HASH));
            }
        }
    }
    for effect in values(ROOT_EFFECTS) {
        let mut lists: Vec<usize> = res.pointer_at(effect + super::clone_kit::EFFECT_EVOLUTIONS).into_iter().collect();
        for event in objects(effect + EFFECT_EVENTS) {
            lists.extend(res.pointer_at(event + super::clone_kit::EVENT_EVOLUTIONS));
        }
        for evolution in lists {
            if let Some((array, count)) = list(evolution + 0x28) {
                words.extend((0..count).map(|k| (HashKind::Evolution, array + k * 0x10)));
            }
        }
    }
    for field in [ROOT_EFFECTS, ROOT_EMITTERS, ROOT_PARTICLES, ROOT_TEXTURES] {
        if let Some((array, count)) = dictionary(field).and_then(|at| list(at + DICTIONARY_HASHES)) {
            if count % 2 == 1 {
                words.push((HashKind::DictionaryTail, array + 4 * (count - 1)));
            }
        }
    }
    words
}

/// Граф ресурса без слотов на словах `words`: слова прикрыты нулями на время разбора и возвращены на место.
fn scan_without(res: &Resource, words: &[usize]) -> Result<Graph> {
    let header = &res.header;
    let data = res.data();
    let total = header
        .system_size
        .checked_add(header.graphics_size)
        .filter(|&total| total <= data.len())
        .ok_or_else(|| Error::broken(MSG_CUT_BODY))?;
    let (system, graphics) = data[..total].split_at(header.system_size);
    let mut masked = system.to_vec();
    for &word in words {
        if let Some(cell) = masked.get_mut(word..word + 8) {
            cell.fill(0);
        }
    }
    let mut graph = from_parts(
        header.declared_version,
        header.system_flags,
        header.graphics_flags,
        masked,
        graphics.to_vec(),
    );
    for &word in words {
        if let (Some(cell), Some(original)) = (graph.system.get_mut(word..word + 8), system.get(word..word + 8)) {
            cell.copy_from_slice(original);
        }
    }
    Ok(graph)
}

/// Длины объектов файла: смещение объекта → его длина (карта `layout::lengths`); чего нет, то переносится блоками.
fn extents_of(res: &Resource) -> (BTreeMap<usize, usize>, Vec<usize>) {
    super::layout::lengths(res)
        .map(|found| (found.objects.into_iter().collect(), found.name_hashes))
        .unwrap_or_default()
}

fn write_word(graph: &mut Graph, segment: Segment, at: usize, value: u64) {
    let area = match segment {
        Segment::System => &mut graph.system,
        Segment::Graphics => &mut graph.graphics,
    };
    area[at..at + 8].copy_from_slice(&value.to_le_bytes());
}

/// Блоки, достижимые от корня и от `extra`: отметка на каждый блок.
fn reached(graph: &Graph, extra: &[usize]) -> Vec<bool> {
    let mut marked = vec![false; graph.blocks.len()];
    let starts: Vec<usize> = graph.root().into_iter().chain(extra.iter().copied()).collect();
    mark_from(graph, &mut marked, &starts);
    marked
}

/// Отмечает `starts` и всё, что от них достижимо.
fn mark_from(graph: &Graph, marked: &mut [bool], starts: &[usize]) {
    let mut pending: Vec<usize> = Vec::new();
    for &start in starts {
        if !std::mem::replace(&mut marked[start], true) {
            pending.push(start);
        }
    }
    while let Some(index) = pending.pop() {
        for slot in &graph.blocks[index].slots {
            if let Some(next) = graph.block_at(slot.target) {
                if !std::mem::replace(&mut marked[next], true) {
                    pending.push(next);
                }
            }
        }
    }
}

/// Образ ядра для правок структуры.
pub struct Structure {
    graph: Graph,
    /// После правок остались блоки, на которые никто не ссылается: при сборке файла они отбрасываются.
    garbage: bool,
    /// Блоки, которых не достичь от корня уже в исходном файле. Их помощник сохраняет, и образ тоже: отбрасываются
    /// только блоки, ставшие ничьими после правок, и всё, что держат эти исходные блоки, остаётся.
    orphans: Vec<usize>,
    /// Длины объектов системной области (карта `layout::lengths`): объект переносится целиком, даже если его хвост
    /// указатели от начала не достигают (встроенные свойства правил лежат внутри них, а массив указателей на них — в
    /// их же хвосте).
    extents: BTreeMap<usize, usize>,
}

impl Structure {
    /// Файл ядра Legacy; обрыв потока и чужая версия — отказ.
    pub fn parse(file: &[u8]) -> Result<Structure> {
        let (res, proven) = Resource::parse_proven(file)?;
        if !proven {
            return Err(Error::broken(MSG_CUT_BODY));
        }
        if res.version() != VERSION_YPT_LEGACY {
            return Err(Error::version(format!(
                "core.ypt версии {} не поддерживается; ожидается Legacy {VERSION_YPT_LEGACY}.",
                res.version()
            )));
        }
        res.root().ok_or_else(|| Error::broken(MSG_NO_ROOT))?;
        let (extents, name_hashes) = extents_of(&res);
        // Слова-хеши при разборе прикрываются нулями и возвращаются на место: ни слота, ни разреза блока у них нет.
        let words = hash_words(&res, &name_hashes);
        let mut graph = scan_without(&res, &words)?;
        drop_pixel_words(&mut graph, &res);
        drop_text_words(&mut graph, &extents);
        Ok(Structure::with_extents(graph, extents, &[]))
    }

    pub fn from_graph(graph: Graph) -> Structure {
        let mut structure = Structure::with_extents(graph, BTreeMap::new(), &[]);
        let (extents, hashes) = extents_of(&structure.to_resource());
        structure.extents = extents;
        structure.drop_hash_words(&hashes);
        structure.refresh_orphans();
        structure
    }

    fn with_extents(graph: Graph, extents: BTreeMap<usize, usize>, hashes: &[usize]) -> Structure {
        let mut structure = Structure {
            graph,
            garbage: false,
            orphans: Vec::new(),
            extents,
        };
        structure.drop_hash_words(hashes);
        structure.refresh_orphans();
        structure
    }

    fn refresh_orphans(&mut self) {
        let marked = reached(&self.graph, &[]);
        self.orphans = (0..self.graph.blocks.len()).filter(|&index| !marked[index]).collect();
    }

    /// Слова-хеши (имена свойств, виды поведений, записи карты свойств эволюций, хеш листа в переменной шейдера,
    /// нечётный хвост массива хешей словаря) выглядят указателем, когда хеш попадает в диапазон адресов области
    /// (у ядра `update.rpf` так выглядит вид «модель» `0x6232E25A`). Слотами они не считаются: иначе сборка файла
    /// переписала бы хеш по новому месту блока, на который он «ведёт».
    fn drop_hash_words(&mut self, name_hashes: &[usize]) {
        let mut words: Vec<usize> = name_hashes.to_vec();
        if let Ok(particles) = self.entries(Kind::Particle) {
            for particle in particles.into_iter().filter_map(|entry| entry.object) {
                for at in super::clone_kit::PARTICLE_BEHAVIOURS {
                    if let Ok(list) = self.list(particle + at) {
                        words.extend(self.objects(list).into_iter().map(|behaviour| behaviour + 8));
                    }
                }
                if let Ok(list) = self.list(particle + PARTICLE_VARS) {
                    for variable in self.objects(list) {
                        if self.u8(variable + VAR_KIND).is_ok_and(|kind| kind == VAR_KIND_TEXTURE) {
                            words.push(variable + VAR_TEXTURE_HASH);
                        }
                    }
                }
            }
        }
        if let Ok(effects) = self.entries(Kind::Effect) {
            for effect in effects.into_iter().filter_map(|entry| entry.object) {
                let mut lists: Vec<usize> = self.pointer(effect + super::clone_kit::EFFECT_EVOLUTIONS).into_iter().collect();
                for event in self.events(effect).unwrap_or_default() {
                    lists.extend(self.pointer(event + super::clone_kit::EVENT_EVOLUTIONS));
                }
                for list in lists {
                    if let Ok(map) = self.list(list + 0x28) {
                        if let Some(array) = map.array {
                            words.extend((0..map.count).map(|k| array + k * 0x10));
                        }
                    }
                }
            }
        }
        for kind in Kind::ALL {
            let Ok(dictionary) = self.dictionary(kind) else { continue };
            if let Ok(hashes) = self.list(dictionary + DICTIONARY_HASHES) {
                if let (Some(array), true) = (hashes.array, hashes.count % 2 == 1) {
                    words.push(array + 4 * (hashes.count - 1));
                }
            }
        }
        for word in words {
            let Some(index) = self.graph.block_at(sys(word)) else { continue };
            let block = &mut self.graph.blocks[index];
            let relative = word - block.start;
            block.slots.retain(|slot| slot.relative != relative);
        }
    }

    /// После переноса: у скопированных объектов те же длины, что у образцов (`spans` — перенесённые куски).
    fn remember_extents(&mut self, source: Option<&BTreeMap<usize, usize>>, planted: &Planted) {
        let known = source.unwrap_or(&self.extents);
        let mut fresh: Vec<(usize, usize)> = Vec::new();
        for &(from, to, new_start) in &planted.spans {
            for (&offset, &length) in known.range(from..to) {
                fresh.push((new_start + (offset - from), length));
            }
        }
        self.extents.extend(fresh);
    }

    pub fn graph(&self) -> &Graph {
        &self.graph
    }

    pub fn graph_mut(&mut self) -> &mut Graph {
        &mut self.graph
    }

    pub fn into_graph(self) -> Graph {
        self.graph
    }

    /// Файл из образа: блоки в прежнем порядке, ничьи блоки отброшены, страницы пересчитаны.
    pub fn into_file(mut self) -> Result<Vec<u8>> {
        if self.garbage {
            self.collect_garbage()?;
        }
        let system = identity_order(&self.graph, Segment::System);
        let graphics = identity_order(&self.graph, Segment::Graphics);
        rebuild(&self.graph, &system, &graphics)
    }

    /// Отбрасывает блоки, ставшие ничьими после правок: недостижимые ни от корня, ни от блоков, которых не достичь
    /// уже в исходном файле. Блок лишается байтов и слотов (становится пустым), а при сборке файла исчезает.
    pub fn collect_garbage(&mut self) -> Result<()> {
        let marked = self.alive();
        for (index, block) in self.graph.blocks.iter_mut().enumerate() {
            if !marked[index] && block.end > block.start {
                block.end = block.start;
                block.slots.clear();
            }
        }
        self.garbage = false;
        Ok(())
    }

    /// Какие блоки остаются при сборке файла. Живы достижимые от корня и от исходных ничьих блоков (их помощник
    /// сохраняет), кроме ничьих блоков, что лежат внутри длины другого объекта: встроенное свойство правила, место
    /// под ещё не занятое свойство. Такой блок — часть тела своего объекта и живёт, пока жив объект; ушёл объект
    /// (сброс клона) — уходит и он. Иначе тело каждого сброшенного клона, разобранное заново из файла, считалось бы
    /// «исходно ничьим» и оставалось навсегда: пять-семь мёртвых блоков на каждую переустановку.
    fn alive(&self) -> Vec<bool> {
        let inside = self.orphans_inside_objects();
        // Что держит только тело объекта: сами такие блоки и всё, что от них достижимо.
        let mut bodies = vec![false; self.graph.blocks.len()];
        mark_from(&self.graph, &mut bodies, &inside.iter().map(|(orphan, _)| *orphan).collect::<Vec<_>>());
        let roots: Vec<usize> = self.orphans.iter().copied().filter(|&orphan| !bodies[orphan]).collect();
        let mut marked = reached(&self.graph, &roots);
        loop {
            let mut grew = false;
            for (orphan, owners) in &inside {
                if !marked[*orphan] && owners.iter().any(|&owner| marked[owner]) {
                    mark_from(&self.graph, &mut marked, &[*orphan]);
                    grew = true;
                }
            }
            if !grew {
                return marked;
            }
        }
    }

    /// Исходные ничьи блоки внутри длины других объектов — с блоками этих объектов.
    fn orphans_inside_objects(&self) -> Vec<(usize, Vec<usize>)> {
        let mut sorted: Vec<usize> = self
            .orphans
            .iter()
            .copied()
            .filter(|&index| {
                let block = &self.graph.blocks[index];
                block.segment == Segment::System && block.end > block.start
            })
            .collect();
        sorted.sort_unstable_by_key(|&index| self.graph.blocks[index].start);
        let mut objects = self.extents.iter().peekable();
        let mut open: Vec<(usize, usize)> = Vec::new();
        let mut inside = Vec::new();
        for orphan in sorted {
            let at = self.graph.blocks[orphan].start;
            while let Some((&start, &length)) = objects.peek().copied() {
                if start >= at {
                    break;
                }
                open.push((start, start + length));
                objects.next();
            }
            open.retain(|&(_, end)| end > at);
            let mut owners: Vec<usize> = open
                .iter()
                .filter_map(|&(start, _)| self.graph.block_at(sys(start)))
                .filter(|&owner| owner != orphan)
                .collect();
            owners.sort_unstable();
            owners.dedup();
            if !owners.is_empty() {
                inside.push((orphan, owners));
            }
        }
        inside
    }

    /// Сколько блоков системной и графической областей недостижимо от корня (для проверок, образ не меняется).
    pub fn unreachable_blocks(&self) -> Result<[usize; 2]> {
        let marked = reached(&self.graph, &[]);
        let mut count = [0usize; 2];
        for (index, block) in self.graph.blocks.iter().enumerate() {
            if !marked[index] && block.end > block.start {
                count[block.segment as usize] += 1;
            }
        }
        Ok(count)
    }

    /// Сколько блоков недостижимо от корня уже в исходном файле.
    pub fn original_orphans(&self) -> usize {
        self.orphans.len()
    }

    /// Образ как ресурс в памяти, без сборки страниц и сжатия: им читают читатели ядра (выгрузка правил, опись).
    /// Слова указателей в областях согласованы с графом, поэтому ресурс читается так же, как собранный файл.
    pub fn to_resource(&self) -> Resource {
        let header = crate::resource::Header {
            system_flags: self.graph.system_flags,
            graphics_flags: self.graph.graphics_flags,
            system_size: self.graph.system.len(),
            graphics_size: self.graph.graphics.len(),
            version: self.graph.declared_version,
            declared_version: self.graph.declared_version,
        };
        let mut data = self.graph.system.clone();
        data.extend_from_slice(&self.graph.graphics);
        Resource::from_parts(header, data)
    }

    // --- чтение ------------------------------------------------------------------------------

    pub fn system(&self) -> &[u8] {
        &self.graph.system
    }

    pub fn bytes(&self, at: usize, len: usize) -> Result<&[u8]> {
        let end = at.checked_add(len).ok_or_else(|| Error::broken(MSG_EOF))?;
        self.graph
            .system
            .get(at..end)
            .ok_or_else(|| Error::broken(MSG_EOF))
    }

    pub fn u8(&self, at: usize) -> Result<u8> {
        Ok(self.bytes(at, 1)?[0])
    }

    pub fn u16(&self, at: usize) -> Result<u16> {
        Ok(u16::from_le_bytes(
            self.bytes(at, 2)?.try_into().unwrap_or_default(),
        ))
    }

    pub fn u32(&self, at: usize) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.bytes(at, 4)?.try_into().unwrap_or_default(),
        ))
    }

    pub fn u64(&self, at: usize) -> Result<u64> {
        Ok(u64::from_le_bytes(
            self.bytes(at, 8)?.try_into().unwrap_or_default(),
        ))
    }

    pub fn f32(&self, at: usize) -> Result<f32> {
        Ok(f32::from_bits(self.u32(at)?))
    }

    /// Куда в системной области ведёт указатель в слове `at`; нуль, чужая область и вылет за данные — `None`.
    pub fn pointer(&self, at: usize) -> Option<usize> {
        let value = self.u64(at).ok()?;
        let offset = usize::try_from(value.checked_sub(SYSTEM_BASE)?).ok()?;
        (value < GRAPHICS_BASE && offset < self.graph.system.len()).then_some(offset)
    }

    /// Список «указатель, число, ёмкость» по смещению.
    pub fn list(&self, at: usize) -> Result<List> {
        Ok(List {
            array: self.pointer(at),
            count: usize::from(self.u16(at + 8)?),
            capacity: usize::from(self.u16(at + 10)?),
        })
    }

    /// Объекты, на которые указывают первые `count` слов массива; пустые указатели опускаются.
    pub fn objects(&self, list: List) -> Vec<usize> {
        let Some(array) = list.array else {
            return Vec::new();
        };
        (0..list.count)
            .filter_map(|k| self.pointer(array + k * 8))
            .collect()
    }

    /// Первые `count` слов массива указателей как они лежат: пустые указатели — `None`.
    pub fn list_slots(&self, list: List) -> Vec<Option<usize>> {
        let Some(array) = list.array else {
            return Vec::new();
        };
        (0..list.count).map(|k| self.pointer(array + k * 8)).collect()
    }

    /// Строка, на которую указывает слово `at`; пустая и из пробелов — `None`.
    pub fn name(&self, at: usize) -> Option<String> {
        let start = self.pointer(at)?;
        let tail = &self.graph.system[start..];
        let window = &tail[..tail.len().min(256)];
        let text = match window.iter().position(|&b| b == 0) {
            Some(end) => &window[..end],
            None => window,
        };
        let text = String::from_utf8_lossy(text).into_owned();
        (!text.trim().is_empty()).then_some(text)
    }

    /// Имя записи словаря.
    pub fn name_of(&self, kind: Kind, object: usize) -> Option<String> {
        self.name(object + kind.name_at())
    }

    // --- запись по месту ----------------------------------------------------------------------

    /// Записывает байты в системную область по смещению; за пределы области — отказ.
    pub fn put(&mut self, at: usize, bytes: &[u8]) -> Result<()> {
        let end = at.checked_add(bytes.len()).ok_or_else(|| Error::broken(MSG_EOF))?;
        self.graph
            .system
            .get_mut(at..end)
            .ok_or_else(|| Error::broken(MSG_EOF))?
            .copy_from_slice(bytes);
        Ok(())
    }

    /// Записывает байты в графическую область по смещению; за пределы области — отказ.
    pub fn put_graphics(&mut self, at: usize, bytes: &[u8]) -> Result<()> {
        let end = at.checked_add(bytes.len()).ok_or_else(|| Error::broken(MSG_EOF))?;
        self.graph
            .graphics
            .get_mut(at..end)
            .ok_or_else(|| Error::broken(MSG_EOF))?
            .copy_from_slice(bytes);
        Ok(())
    }

    pub fn put_u8(&mut self, at: usize, value: u8) -> Result<()> {
        self.put(at, &[value])
    }

    pub fn put_u16(&mut self, at: usize, value: u16) -> Result<()> {
        self.put(at, &value.to_le_bytes())
    }

    pub fn put_u32(&mut self, at: usize, value: u32) -> Result<()> {
        self.put(at, &value.to_le_bytes())
    }

    pub fn put_f32(&mut self, at: usize, value: f32) -> Result<()> {
        self.put(at, &value.to_le_bytes())
    }

    /// Слово-указатель по смещению `at`: цель в любой области или пусто. Слот графа и слово области правятся вместе.
    pub fn set_pointer(&mut self, at: usize, target: Option<Address>) -> Result<()> {
        let index = self
            .graph
            .block_at(sys(at))
            .filter(|&index| at + 8 <= self.graph.blocks[index].end)
            .ok_or_else(|| Error::broken(MSG_EOF))?;
        let relative = at - self.graph.blocks[index].start;
        let slots = &mut self.graph.blocks[index].slots;
        slots.retain(|slot| slot.relative != relative);
        if let Some(target) = target {
            let place = slots.partition_point(|slot| slot.relative < relative);
            slots.insert(place, Slot { relative, target });
        }
        write_word(
            &mut self.graph,
            Segment::System,
            at,
            target.map_or(0, word_of),
        );
        Ok(())
    }

    /// То же для цели в системной области.
    pub fn set_system_pointer(&mut self, at: usize, target: Option<usize>) -> Result<()> {
        self.set_pointer(at, target.map(sys))
    }

    /// Новый блок в конце системной области; `pointers` — слова блока, которые ведут на цели (смещение внутри блока и
    /// цель); их значения вписываются в байты. Отдаёт адрес начала блока.
    pub fn alloc(&mut self, mut bytes: Vec<u8>, pointers: &[(usize, Address)]) -> Address {
        let mut slots = Vec::with_capacity(pointers.len());
        for &(relative, target) in pointers {
            bytes[relative..relative + 8].copy_from_slice(&word_of(target).to_le_bytes());
            slots.push(Slot { relative, target });
        }
        slots.sort_by_key(|slot| slot.relative);
        let index = append_block(&mut self.graph, Segment::System, bytes, slots);
        sys(self.graph.blocks[index].start)
    }

    /// Новая строка в конце системной области; отдаёт её адрес.
    pub fn new_string(&mut self, text: &str) -> Address {
        let mut bytes = text.as_bytes().to_vec();
        bytes.push(0);
        self.alloc(bytes, &[])
    }

    /// Список «указатель, число, ёмкость» по смещению `at` целиком; пустой массив — нулевой указатель.
    pub fn set_list(&mut self, at: usize, array: Option<Address>, count: usize, capacity: usize) -> Result<()> {
        let narrow = |value: usize| {
            u16::try_from(value).map_err(|_| Error::argument("Слишком много записей в списке."))
        };
        let (count, capacity) = (narrow(count)?, narrow(capacity)?);
        self.set_pointer(at, array)?;
        self.put_u16(at + 8, count)?;
        self.put_u16(at + 10, capacity)
    }

    /// Имя объекта: слово по смещению `at` ведёт на новую строку. Прежняя строка остаётся блоком, на который могут
    /// ссылаться другие; ничья отбрасывается при сборке.
    pub fn set_name(&mut self, at: usize, text: &str) -> Result<()> {
        let target = self.new_string(text);
        self.set_pointer(at, Some(target))?;
        self.garbage = true;
        Ok(())
    }

    // --- перенос кусков графа -----------------------------------------------------------------

    /// Копия подграфа от `root` в конец областей; слова из `stops` за цель не идут и у копии ведут туда же, куда у образца.
    pub fn copy_subgraph(&mut self, root: usize, stops: &HashSet<usize>) -> Result<Planted> {
        let pieces = gather(&self.graph, &self.extents, &[root], stops)?;
        let planted = plant(&mut self.graph, pieces, false)?;
        self.remember_extents(None, &planted);
        Ok(planted)
    }

    /// Копия подграфа другого образа: слова, чьи цели остались в источнике, обнуляются и называются в `dangling`.
    pub fn import_subgraph(
        &mut self,
        from: &Structure,
        root: usize,
        stops: &HashSet<usize>,
    ) -> Result<Planted> {
        let pieces = gather(&from.graph, &from.extents, &[root], stops)?;
        let planted = plant(&mut self.graph, pieces, true)?;
        self.remember_extents(Some(&from.extents), &planted);
        Ok(planted)
    }

    // --- словари ------------------------------------------------------------------------------

    /// Смещение объекта-словаря.
    fn dictionary(&self, kind: Kind) -> Result<usize> {
        self.pointer(kind.field())
            .ok_or_else(|| inconsistent(kind, "dictionary is missing."))
    }

    /// Записи словаря по порядку. Число хешей и объектов обязано совпадать.
    pub fn entries(&self, kind: Kind) -> Result<Vec<Entry>> {
        let dictionary = self.dictionary(kind)?;
        let values = self.list(dictionary + DICTIONARY_VALUES)?;
        let hashes = self.list(dictionary + DICTIONARY_HASHES)?;
        if values.count != hashes.count {
            return Err(Error::broken(format!(
                "YPT {} dictionary is inconsistent: {} items, {} hashes.",
                kind.long_label(),
                values.count,
                hashes.count
            )));
        }
        (0..values.count)
            .map(|k| -> Result<Entry> {
                let hash = match hashes.array {
                    Some(array) => self.u32(array + k * 4)?,
                    None => 0,
                };
                let object = values.array.and_then(|array| self.pointer(array + k * 8));
                Ok(Entry { hash, object })
            })
            .collect()
    }

    /// Имена записей по порядку (пустое имя — запись без имени).
    pub fn names(&self, kind: Kind) -> Result<Vec<String>> {
        Ok(self
            .entries(kind)?
            .iter()
            .map(|entry| {
                entry
                    .object
                    .and_then(|object| self.name_of(kind, object))
                    .unwrap_or_default()
            })
            .collect())
    }

    /// Записывает словарь заново: два новых массива (значения и хеши), число и ёмкость — длина списка.
    pub fn write_entries(&mut self, kind: Kind, entries: &[Entry]) -> Result<()> {
        let dictionary = self.dictionary(kind)?;
        let count = u16::try_from(entries.len())
            .map_err(|_| Error::argument("Слишком много записей в словаре."))?;
        let (values_at, hashes_at) = (dictionary + DICTIONARY_VALUES, dictionary + DICTIONARY_HASHES);
        let (values, hashes) = if entries.is_empty() {
            (None, None)
        } else {
            let pointers: Vec<(usize, Address)> = entries
                .iter()
                .enumerate()
                .filter_map(|(k, entry)| Some((k * 8, sys(entry.object?))))
                .collect();
            let values = self.alloc(vec![0u8; entries.len() * 8], &pointers);
            let hashes: Vec<u8> = entries.iter().flat_map(|e| e.hash.to_le_bytes()).collect();
            (Some(values), Some(self.alloc(hashes, &[])))
        };
        self.set_list(values_at, values, usize::from(count), usize::from(count))?;
        self.set_list(hashes_at, hashes, usize::from(count), usize::from(count))?;
        self.garbage = true;
        Ok(())
    }

    /// Вставка записи: перед первой, чей хеш не меньше нового; такой хеш уже есть — отказ. Отдаёт место записи.
    pub fn insert_entry(&mut self, kind: Kind, object: usize, hash: u32) -> Result<usize> {
        let mut list = self.entries(kind)?;
        let index = list
            .iter()
            .position(|entry| entry.hash >= hash)
            .unwrap_or(list.len());
        if list.get(index).is_some_and(|entry| entry.hash == hash) {
            return Err(Error::operation(
                "YPT dictionary already contains this name hash.",
            ));
        }
        list.insert(
            index,
            Entry {
                hash,
                object: Some(object),
            },
        );
        self.write_entries(kind, &list)?;
        Ok(index)
    }

    /// Вставка записи под хешем её имени в нижнем регистре (так хешируют имена Astral).
    pub fn insert_named(&mut self, kind: Kind, object: usize) -> Result<usize> {
        let name = self
            .name_of(kind, object)
            .ok_or_else(|| Error::broken(format!("YPT {} has no name.", kind.long_label())))?;
        self.insert_entry(kind, object, hash_name(&name))
    }

    /// Снимает записи, чьё имя подошло под `matches`, парой «хеш и объект». Отдаёт снятые имена по порядку словаря.
    pub fn remove_entries(
        &mut self,
        kind: Kind,
        matches: &dyn Fn(&str) -> bool,
    ) -> Result<Vec<String>> {
        let list = self.entries(kind)?;
        let mut kept = Vec::with_capacity(list.len());
        let mut removed = Vec::new();
        for entry in list.iter().copied() {
            let name = entry
                .object
                .and_then(|object| self.name_of(kind, object))
                .unwrap_or_default();
            if !name.is_empty() && matches(&name) {
                removed.push(name);
            } else {
                kept.push(entry);
            }
        }
        if !removed.is_empty() {
            self.write_entries(kind, &kept)?;
        }
        Ok(removed)
    }

    /// Единственная запись с таким именем (без учёта регистра); две — отказ, как у `SingleOrDefault`.
    pub fn find(&self, kind: Kind, wanted: &str) -> Result<Option<usize>> {
        let mut found = None;
        for entry in self.entries(kind)? {
            let Some(object) = entry.object else { continue };
            let Some(name) = self.name_of(kind, object) else {
                continue;
            };
            if super::cmp_ordinal_ignore_case(&name, wanted) != std::cmp::Ordering::Equal {
                continue;
            }
            if found.replace(object).is_some() {
                return Err(Error::operation(
                    "Sequence contains more than one matching element",
                ));
            }
        }
        Ok(found)
    }

    /// Запись с таким именем в точности (по байтам имени). Две — отказ.
    pub fn find_exact(&self, kind: Kind, wanted: &str) -> Result<Option<usize>> {
        let mut found = None;
        for entry in self.entries(kind)? {
            let Some(object) = entry.object else { continue };
            if self.name_of(kind, object).as_deref() != Some(wanted) {
                continue;
            }
            if found.replace(object).is_some() {
                return Err(Error::operation(
                    "Sequence contains more than one matching element",
                ));
            }
        }
        Ok(found)
    }

    // --- правило эффекта ----------------------------------------------------------------------

    /// События правила: первые `count` указателей массива, пустые опускаются.
    pub fn events(&self, effect: usize) -> Result<Vec<usize>> {
        Ok(self.objects(self.list(effect + EFFECT_EVENTS)?))
    }

    /// Слоты событий правила как они лежат: первые `min(count, ёмкость)` слов массива, пустые — `None`.
    pub fn event_slots(&self, effect: usize) -> Result<Vec<Option<usize>>> {
        let list = self.list(effect + EFFECT_EVENTS)?;
        let readable = List {
            count: list.count.min(list.capacity),
            ..list
        };
        Ok(self.list_slots(readable))
    }

    /// Словари упорядочены по хешу имени, у каждой записи есть имя. Хеш чужой записи (ядро из мода) не отказ, а
    /// замечание; у записей Astral расхождение — порча (как `AssertDictionaries` помощника).
    pub fn assert_dictionaries(&self) -> Result<Vec<super::vanilla::Remark>> {
        let mut remarks = Vec::new();
        for kind in Kind::ALL {
            let label = kind.long_label();
            let list = self.entries(kind)?;
            for (index, entry) in list.iter().enumerate() {
                let name = entry
                    .object
                    .and_then(|object| self.name_of(kind, object))
                    .unwrap_or_default();
                if name.is_empty() {
                    return Err(Error::broken(format!(
                        "YPT {label} dictionary has a nameless entry at {index}."
                    )));
                }
                let hash = entry.hash;
                if hash_name(&name.to_lowercase()) != hash {
                    if name.as_bytes().get(..7).is_some_and(|head| head.eq_ignore_ascii_case(b"astral_")) {
                        return Err(Error::broken(format!(
                            "YPT {label} dictionary hash does not match its name at {index}: {name}."
                        )));
                    }
                    let exact = name
                        .bytes()
                        .fold(0u32, |hash, byte| {
                            let hash = hash.wrapping_add(u32::from(byte));
                            let hash = hash.wrapping_add(hash << 10);
                            hash ^ (hash >> 6)
                        });
                    let exact = exact.wrapping_add(exact << 3);
                    let exact = exact ^ (exact >> 11);
                    let exact = exact.wrapping_add(exact << 15);
                    remarks.push(super::vanilla::Remark {
                        dictionary: label_static(kind),
                        index,
                        name,
                        hash: format!("{hash:08x}"),
                        form: if exact == hash { "case-sensitive" } else { "foreign" },
                    });
                }
                if index > 0 && hash <= list[index - 1].hash {
                    return Err(Error::broken(format!(
                        "YPT {label} dictionary is not sorted by name hash."
                    )));
                }
            }
        }
        Ok(remarks)
    }

    /// Эмиттеры и частицы событий без повторов, в порядке появления.
    pub fn rules_of(&self, events: &[usize]) -> (Vec<usize>, Vec<usize>) {
        let mut emitters = Vec::new();
        let mut particles = Vec::new();
        for &event in events {
            if let Some(emitter) = self.pointer(event + EVENT_EMITTER) {
                if !emitters.contains(&emitter) {
                    emitters.push(emitter);
                }
            }
            if let Some(particle) = self.pointer(event + EVENT_PARTICLE) {
                if !particles.contains(&particle) {
                    particles.push(particle);
                }
            }
        }
        (emitters, particles)
    }

    /// Слова, за которые копия правила не идёт: порождаемые эффекты, модели и листы текстур частиц событий.
    pub fn effect_stops(&self, effect: usize) -> Result<HashSet<usize>> {
        let mut stops = HashSet::new();
        let events = self.events(effect)?;
        let (_, particles) = self.rules_of(&events);
        for particle in particles {
            for spawner in PARTICLE_SPAWNERS {
                stops.insert(particle + spawner + SPAWNER_EFFECT);
            }
            let drawables = self.list(particle + PARTICLE_DRAWABLES)?;
            if let Some(array) = drawables.array {
                for k in 0..drawables.count {
                    stops.insert(array + k * DRAWABLE_STRIDE + DRAWABLE_MODEL);
                }
            }
            for variable in self.objects(self.list(particle + PARTICLE_VARS)?) {
                if self.u8(variable + VAR_KIND)? == VAR_KIND_TEXTURE {
                    stops.insert(variable + VAR_TEXTURE);
                }
            }
        }
        Ok(stops)
    }

    /// Глубокая копия правила эффекта: свои события, эмиттеры и частицы; имена и словари не тронуты (у копии имена
    /// донора). Порождаемые эффекты, модели, листы текстур и корень остаются общими с донором.
    pub fn copy_effect(&mut self, donor: usize) -> Result<EffectCopy> {
        let stops = self.effect_stops(donor)?;
        let planted = self.copy_subgraph(donor, &stops)?;
        self.garbage = true;
        self.describe_copy(donor, &planted)
    }

    fn describe_copy(&self, donor: usize, planted: &Planted) -> Result<EffectCopy> {
        let effect = planted
            .translate(donor)
            .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
        let events = self.events(effect)?;
        let (emitters, particles) = self.rules_of(&events);
        Ok(EffectCopy {
            effect,
            events,
            emitters,
            particles,
        })
    }

    /// Глубокая копия правила эффекта из другого образа. Порождаемые эффекты и модели у такого донора переносить некуда:
    /// слова остаются пустыми и называются в итоге; ссылка на корень ведёт на корень этого образа.
    pub fn import_effect(
        &mut self,
        from: &Structure,
        donor: usize,
    ) -> Result<(EffectCopy, Planted)> {
        let stops = from.effect_stops(donor)?;
        let planted = self.import_subgraph(from, donor, &stops)?;
        self.garbage = true;
        let copy = self.describe_copy(donor, &planted)?;
        // Ссылка правила на корень ядра — первое слово «за пределами»: у копии она ведёт на корень приёмника.
        let link = copy.effect + EFFECT_ROOT_LINK;
        if from.pointer(donor + EFFECT_ROOT_LINK) == Some(0) {
            self.set_pointer(link, Some(sys(0)))?;
        }
        Ok((copy, planted))
    }

    /// Имена копии: правило, эмиттеры и частицы по порядку `EffectCopy`, имена в событиях.
    pub fn name_copy(&mut self, copy: &EffectCopy, names: &EffectNames) -> Result<()> {
        if names.emitters.len() != copy.emitters.len() || names.particles.len() != copy.particles.len() {
            return Err(Error::argument(
                "Имён эмиттеров и частиц столько же, сколько правил у копии.",
            ));
        }
        self.set_name(copy.effect + EFFECT_NAME, &names.effect)?;
        for (&emitter, name) in copy.emitters.iter().zip(&names.emitters) {
            self.set_name(emitter + EMITTER_NAME, name)?;
        }
        for (&particle, name) in copy.particles.iter().zip(&names.particles) {
            self.set_name(particle + PARTICLE_NAME, name)?;
        }
        for &event in &copy.events {
            let emitter = self.pointer(event + EVENT_EMITTER).and_then(|at| copy.emitters.iter().position(|&e| e == at));
            let particle = self.pointer(event + EVENT_PARTICLE).and_then(|at| copy.particles.iter().position(|&p| p == at));
            if let Some(k) = emitter {
                self.set_name(event + EVENT_EMITTER_NAME, &names.emitters[k])?;
            }
            if let Some(k) = particle {
                self.set_name(event + EVENT_PARTICLE_NAME, &names.particles[k])?;
            }
        }
        Ok(())
    }

    /// Оставляет правилу только перечисленные события, в этом порядке: указатели в начале массива, остальные слоты
    /// пусты, число событий обновлено, номера событий по порядку. Ёмкость массива не меняется; не влезают — отказ.
    pub fn set_events(&mut self, effect: usize, events: &[usize]) -> Result<()> {
        let list = self.list(effect + EFFECT_EVENTS)?;
        let array = list
            .array
            .filter(|_| events.len() <= list.capacity.max(list.count))
            .ok_or_else(|| Error::argument("События не влезают в массив правила."))?;
        let room = list.capacity.max(list.count);
        for k in 0..room {
            let target = events.get(k).copied().map(sys);
            self.set_pointer(array + k * 8, target)?;
        }
        for (k, &event) in events.iter().enumerate() {
            self.put_u32(event + EVENT_INDEX, k as u32)?;
        }
        let count = u16::try_from(events.len()).map_err(|_| Error::argument("Слишком много событий."))?;
        self.put_u16(effect + EFFECT_EVENTS + 8, count)
    }

    /// Обнуляет события, снятые с правила `set_events`. События лежат в массиве по `EVENT` байт подряд, и копия донора несёт
    /// их одним блоком: снятое событие остаётся телом внутри блока оставшегося, и его указатели на эмиттер, частицу и
    /// имена продолжают держать копии лишних правил донора живыми. Обнулённое тело ничего не держит, и сборка файла
    /// отбрасывает лишнее. Вызывают после `set_events`, для событий, которых в нём не оставили.
    pub fn clear_events(&mut self, events: &[usize]) -> Result<()> {
        for &event in events {
            for at in (event..event + super::layout::EVENT).step_by(8) {
                self.set_pointer(at, None)?;
            }
        }
        self.garbage = true;
        Ok(())
    }

    /// Удаляет правило эффекта из словаря и вместе с ним эмиттеры и частицы, которые перестали быть чьими-либо:
    /// ни одно из оставшихся правил эффектов не ссылается на них событием. Листы текстур остаются.
    pub fn remove_effect(&mut self, name: &str) -> Result<Removed> {
        let Some(effect) = self.find_exact(Kind::Effect, name)? else {
            return Err(Error::operation(format!(
                "YPT effect rule does not exist: {name}"
            )));
        };
        let events = self.events(effect)?;
        let (emitters, particles) = self.rules_of(&events);
        let mut removed = Removed {
            effects: self.remove_entries(Kind::Effect, &|candidate| candidate == name)?,
            ..Removed::default()
        };
        // Кто из кандидатов ещё нужен оставшимся правилам.
        let mut used_emitters = HashSet::new();
        let mut used_particles = HashSet::new();
        for entry in self.entries(Kind::Effect)? {
            let Some(other) = entry.object else { continue };
            let (e, p) = self.rules_of(&self.events(other)?);
            used_emitters.extend(e);
            used_particles.extend(p);
        }
        let names_of = |me: &Structure, kind: Kind, objects: &[usize], used: &HashSet<usize>| -> HashSet<String> {
            objects
                .iter()
                .filter(|object| !used.contains(object))
                .filter_map(|&object| me.name_of(kind, object))
                .collect()
        };
        let lone_emitters = names_of(self, Kind::Emitter, &emitters, &used_emitters);
        let lone_particles = names_of(self, Kind::Particle, &particles, &used_particles);
        removed.emitters = self.remove_entries(Kind::Emitter, &|candidate| lone_emitters.contains(candidate))?;
        removed.particles = self.remove_entries(Kind::Particle, &|candidate| lone_particles.contains(candidate))?;
        self.garbage = true;
        Ok(removed)
    }

    // --- листы текстур ------------------------------------------------------------------------

    /// Добавляет лист во встроенный словарь: описание — копия описания `template` с новыми именем, размерами, форматом и
    /// пикселями. Пиксели ложатся в графическую область новым блоком. Хеш имени — от имени в нижнем регистре; такой
    /// хеш уже есть — отказ. Отдаёт смещение нового описания.
    pub fn add_texture(&mut self, template: usize, spec: &TextureSpec) -> Result<usize> {
        self.add_texture_from(None, template, spec)
    }

    /// Лист из другого образа целиком (описание, имя и пиксели) под новым именем: во встроенный словарь.
    pub fn import_texture(&mut self, from: &Structure, texture: usize, name: &str) -> Result<usize> {
        let hash = hash_name(&name.to_lowercase());
        if self.entries(Kind::Texture)?.iter().any(|entry| entry.hash == hash) {
            return Err(Error::operation(format!("YPT already contains texture {name}.")));
        }
        let planted = self.import_subgraph(from, texture, &HashSet::new())?;
        self.garbage = true;
        let object = planted
            .translate(texture)
            .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
        self.set_name(object + TEXTURE_NAME, name)?;
        self.insert_entry(Kind::Texture, object, hash)?;
        Ok(object)
    }

    /// `add_texture`, когда образец описания лежит в другом образе (`from`).
    pub fn add_texture_from(
        &mut self,
        from: Option<&Structure>,
        template: usize,
        spec: &TextureSpec,
    ) -> Result<usize> {
        let hash = hash_name(&spec.name.to_lowercase());
        let taken = self
            .entries(Kind::Texture)?
            .iter()
            .any(|entry| entry.hash == hash);
        if taken {
            return Err(Error::operation(format!(
                "YPT already contains texture {}.",
                spec.name
            )));
        }
        if spec.pixels.is_empty() {
            return Err(Error::argument("У листа нет пикселей."));
        }
        let stops = HashSet::from([template + TEXTURE_PIXELS]);
        let descriptor = match from {
            None => self.copy_subgraph(template, &stops)?,
            Some(other) => self.import_subgraph(other, template, &stops)?,
        };
        self.garbage = true;
        let object = descriptor
            .translate(template)
            .ok_or_else(|| Error::broken(MSG_OUTSIDE))?;
        if self.graph.block_at(sys(object)).is_none_or(|index| self.graph.blocks[index].end < object + TEXTURE_END) {
            return Err(Error::broken("Описание текстуры короче положенного."));
        }
        let pixels = append_block(&mut self.graph, Segment::Graphics, spec.pixels.to_vec(), Vec::new());
        let pixel_at = Address {
            segment: Segment::Graphics,
            offset: self.graph.blocks[pixels].start,
        };
        self.set_pointer(object + TEXTURE_PIXELS, Some(pixel_at))?;
        self.set_name(object + TEXTURE_NAME, spec.name)?;
        self.put_u16(object + TEXTURE_WIDTH, spec.width)?;
        self.put_u16(object + TEXTURE_HEIGHT, spec.height)?;
        self.put_u16(object + TEXTURE_DEPTH, spec.depth)?;
        self.put_u16(object + TEXTURE_STRIDE, spec.stride)?;
        self.put_u32(object + TEXTURE_FORMAT, spec.format)?;
        self.put_u8(object + TEXTURE_LEVELS, spec.levels)?;
        self.insert_entry(Kind::Texture, object, hash)?;
        Ok(object)
    }
}

fn label_static(kind: Kind) -> &'static str {
    kind.long_label()
}

fn inconsistent(kind: Kind, tail: &str) -> Error {
    Error::broken(format!("YPT {} {tail}", kind.long_label()))
}

/// Слова внутри ступеней текстур, похожие на указатели, указателями не считаются: пиксели при пересборке остаются как
/// были (то же правило, что у образа значений и у писателя текстур).
fn drop_pixel_words(graph: &mut Graph, res: &Resource) {
    let Ok(core) = super::read(res) else {
        return;
    };
    let system_size = res.header.system_size;
    let spans: Vec<(Segment, usize, usize)> = core
        .textures
        .iter()
        .filter_map(|texture| {
            let at = texture.data_at.filter(|_| texture.bytes > 0)?;
            Some(match at.checked_sub(system_size) {
                None => (Segment::System, at, at + texture.bytes),
                Some(offset) => (Segment::Graphics, offset, offset + texture.bytes),
            })
        })
        .collect();
    for block in &mut graph.blocks {
        let (segment, start) = (block.segment, block.start);
        block.slots.retain(|slot| {
            let word = start + slot.relative;
            !spans
                .iter()
                .any(|&(lane, from, to)| lane == segment && (from..to).contains(&word))
        });
    }
}

/// Слова внутри строк (имена правил, листов, частиц) указателями не считаются. У ядра игры строки идут вплотную, и хвост
/// вроде `area` + нули там не встречается (замер: ни одного слова на четырёх ядрах). У ядра, записанного помощником, каждая
/// строка лежит отдельно и добита нулями до 8 байт, и такой хвост по значению (`0x61657261`) попадает в диапазон адресов
/// графики: сборка переписала бы его как указатель, и имя стало бы `ent_amb_dry_ice_Area`. Строка — объект карты длин, чьи
/// байты до последнего печатные, а последний нуль; слова внутри неё ни к чему не ведут.
pub(crate) fn drop_text_words(graph: &mut Graph, extents: &BTreeMap<usize, usize>) {
    let system = &graph.system;
    let texts: Vec<(usize, usize)> = extents
        .iter()
        .filter(|&(&start, &length)| {
            length >= 2
                && start + length <= system.len()
                && system[start + length - 1] == 0
                && system[start..start + length - 1].iter().all(|byte| (0x20..0x7f).contains(byte))
        })
        .map(|(&start, &length)| (start, start + length))
        .collect();
    if texts.is_empty() {
        return;
    }
    for block in &mut graph.blocks {
        if block.segment != Segment::System {
            continue;
        }
        let start = block.start;
        block.slots.retain(|slot| {
            let word = start + slot.relative;
            let place = texts.partition_point(|&(from, _)| from <= word);
            !place.checked_sub(1).is_some_and(|k| word < texts[k].1)
        });
    }
}

/// Число записей по видам словарей (для сводок): «effect», «emitter», «particle», «texture».
pub fn counts(structure: &Structure) -> Result<BTreeMap<&'static str, usize>> {
    Kind::ALL
        .iter()
        .map(|&kind| Ok((kind.label(), structure.entries(kind)?.len())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ypt::fixture;
    use crate::ypt::image::Image;
    use crate::ypt::vanilla;

    fn opened() -> (fixture::Core, Structure) {
        let core = fixture::core(true);
        let structure = Structure::parse(&core.bytes).unwrap();
        (core, structure)
    }

    fn names_of(copy: &str) -> EffectNames {
        EffectNames {
            effect: copy.to_owned(),
            emitters: vec![format!("{copy}_e0")],
            particles: vec![format!("{copy}_p0")],
        }
    }

    /// Копия под новым именем, вставленная во все три словаря.
    fn installed(structure: &mut Structure, donor: usize, name: &str) -> EffectCopy {
        let copy = structure.copy_effect(donor).unwrap();
        structure.name_copy(&copy, &names_of(name)).unwrap();
        structure.insert_named(Kind::Effect, copy.effect).unwrap();
        structure.insert_named(Kind::Emitter, copy.emitters[0]).unwrap();
        structure.insert_named(Kind::Particle, copy.particles[0]).unwrap();
        copy
    }

    fn sorted_by_hash(names: &[&str]) -> Vec<String> {
        let mut list: Vec<&str> = names.to_vec();
        list.sort_by_key(|name| hash_name(name));
        list.into_iter().map(str::to_owned).collect()
    }

    #[test]
    fn a_copy_has_its_own_objects_under_its_own_names() {
        let (core, mut s) = opened();
        let guarded: Vec<(usize, usize, Vec<u8>)> = [
            (core.map.effect, 0x3C0),
            (core.map.event, 0x70),
            (core.map.emitter, 0x630),
            (core.map.particle, 0x240),
        ]
        .into_iter()
        .map(|(at, len)| (at, len, s.system()[at..at + len].to_vec()))
        .collect();
        let copy = installed(&mut s, core.map.effect, "astral_a");
        assert_ne!(copy.effect, core.map.effect);
        assert_eq!(
            (copy.events.len(), copy.emitters.len(), copy.particles.len()),
            (1, 1, 1)
        );
        assert!(copy.emitters[0] != core.map.emitter && copy.particles[0] != core.map.particle);
        // событие копии ведёт в правила копии
        assert_eq!(s.pointer(copy.events[0] + EVENT_EMITTER), Some(copy.emitters[0]));
        assert_eq!(s.pointer(copy.events[0] + EVENT_PARTICLE), Some(copy.particles[0]));
        // штатные объекты не тронуты ни байтом
        for (at, len, was) in &guarded {
            assert_eq!(&s.system()[*at..*at + *len], &was[..], "объект {at:#x} изменился");
        }
        let file = s.into_file().unwrap();
        let image = Image::parse(&file).unwrap();
        let inventory = vanilla::inventory(&image).unwrap();
        assert_eq!(inventory.effects, sorted_by_hash(&["tracer", "astral_a"]));
        assert_eq!(inventory.emitters, sorted_by_hash(&["tracer", "astral_a_e0"]));
        assert_eq!(inventory.particles, sorted_by_hash(&["tracer", "astral_a_p0"]));
        assert_eq!(inventory.textures, vec!["ptfx_tracer".to_owned()]);
        assert!(vanilla::assert_dictionaries(&image).unwrap().is_empty());
        let mut remarks = std::collections::BTreeSet::new();
        vanilla::verify_graph(&image, None, &mut remarks).unwrap();
        // имена в событии копии
        let again = Structure::parse(&file).unwrap();
        let effect = again.find_exact(Kind::Effect, "astral_a").unwrap().unwrap();
        let event = again.events(effect).unwrap()[0];
        assert_eq!(again.name(event + EVENT_EMITTER_NAME).as_deref(), Some("astral_a_e0"));
        assert_eq!(again.name(event + EVENT_PARTICLE_NAME).as_deref(), Some("astral_a_p0"));
    }

    #[test]
    fn shared_things_stay_shared_with_the_donor() {
        let (core, mut s) = opened();
        let texture = s.entries(Kind::Texture).unwrap()[0].object.unwrap();
        let variable = s.objects(s.list(core.map.particle + PARTICLE_VARS).unwrap())[0];
        // частица донора рождает его же эффект и рисует лист словаря
        s.set_system_pointer(core.map.particle + PARTICLE_SPAWNERS[0] + SPAWNER_EFFECT, Some(core.map.effect)).unwrap();
        s.set_system_pointer(variable + VAR_TEXTURE, Some(texture)).unwrap();
        s.set_system_pointer(core.map.effect + EFFECT_ROOT_LINK, Some(0)).unwrap();
        let copy = s.copy_effect(core.map.effect).unwrap();
        let particle = copy.particles[0];
        assert_ne!(particle, core.map.particle);
        let own_variable = s.objects(s.list(particle + PARTICLE_VARS).unwrap())[0];
        assert_ne!(own_variable, variable);
        assert_eq!(s.pointer(own_variable + VAR_TEXTURE), Some(texture));
        assert_eq!(s.pointer(particle + PARTICLE_SPAWNERS[0] + SPAWNER_EFFECT), Some(core.map.effect));
        assert_eq!(s.pointer(copy.effect + EFFECT_ROOT_LINK), Some(0));
        // слоты графа согласны со словами: файл пересобирается и читается
        let file = s.into_file().unwrap();
        let again = Structure::parse(&file).unwrap();
        let effect = again.find_exact(Kind::Effect, "tracer").unwrap().unwrap();
        assert!(effect > 0);
    }

    #[test]
    fn entries_go_in_by_hash_and_a_taken_hash_is_refused() {
        let (core, mut s) = opened();
        let first = hash_name("tracer");
        let object = core.map.effect;
        // низкий, высокий и средний хеши; ни один не равен хешу штатной записи
        let wanted = [0x0000_0010u32, 0xFFFF_FF00, first / 2 + 0x1000_0000];
        assert!(wanted.iter().all(|&hash| hash != first));
        for hash in wanted {
            let index = s.insert_entry(Kind::Effect, object, hash).unwrap();
            let list = s.entries(Kind::Effect).unwrap();
            assert_eq!(list[index].hash, hash);
            assert!(list.windows(2).all(|pair| pair[0].hash < pair[1].hash));
        }
        let hashes: Vec<u32> = s.entries(Kind::Effect).unwrap().iter().map(|e| e.hash).collect();
        assert_eq!(hashes.len(), 4);
        assert_eq!(hashes[0], 0x0000_0010);
        assert_eq!(hashes[3], 0xFFFF_FF00);
        let refusal = s.insert_entry(Kind::Effect, object, wanted[2]).unwrap_err();
        assert_eq!(refusal.message, "YPT dictionary already contains this name hash.");
        // и значения, и хеши — одной длины, число и ёмкость равны
        let dictionary = s.pointer(ROOT_EFFECTS).unwrap();
        let values = s.list(dictionary + DICTIONARY_VALUES).unwrap();
        let hashes = s.list(dictionary + DICTIONARY_HASHES).unwrap();
        assert_eq!((values.count, values.capacity, hashes.count, hashes.capacity), (4, 4, 4, 4));
    }

    #[test]
    fn removing_a_rule_takes_what_became_nobodys_and_the_file_is_as_before() {
        let (core, mut s) = opened();
        let original = Structure::parse(&core.bytes).unwrap();
        let before = original.graph().blocks.len();
        installed(&mut s, core.map.effect, "astral_a");
        installed(&mut s, core.map.effect, "astral_b");
        let removed = s.remove_effect("astral_a").unwrap();
        assert_eq!(
            removed,
            Removed {
                effects: vec!["astral_a".to_owned()],
                emitters: vec!["astral_a_e0".to_owned()],
                particles: vec!["astral_a_p0".to_owned()],
            }
        );
        assert!(s.remove_effect("astral_a").is_err());
        s.remove_effect("astral_b").unwrap();
        let file = s.into_file().unwrap();
        let after = Structure::parse(&file).unwrap();
        assert_eq!(after.graph().blocks.len(), before);
        assert_eq!(after.unreachable_blocks().unwrap(), [0, 0]);
        assert_eq!(
            vanilla::inventory(&Image::parse(&file).unwrap()).unwrap().keys(),
            vec!["effect:tracer", "emitter:tracer", "particle:tracer", "texture:ptfx_tracer"]
        );
    }

    #[test]
    fn a_rule_that_others_still_use_keeps_its_emitter() {
        let (core, mut s) = opened();
        let copy = installed(&mut s, core.map.effect, "astral_a");
        // событие копии снова ведёт в штатный эмиттер: копия эмиттера никому не нужна, штатный нужен донору
        s.set_system_pointer(copy.events[0] + EVENT_EMITTER, Some(core.map.emitter)).unwrap();
        let removed = s.remove_effect("astral_a").unwrap();
        assert!(removed.emitters.is_empty());
        assert_eq!(s.names(Kind::Emitter).unwrap().len(), 2);
        assert_eq!(removed.particles, vec!["astral_a_p0".to_owned()]);
    }

    #[test]
    fn a_new_texture_joins_the_dictionary_with_its_pixels() {
        let (core, mut s) = opened();
        let template = s.entries(Kind::Texture).unwrap()[0].object.unwrap();
        let pixels: Vec<u8> = (0..32u8).map(|k| k.wrapping_mul(7).wrapping_add(3)).collect();
        let spec = TextureSpec {
            name: "astral_sheet",
            width: 8,
            height: 8,
            depth: 1,
            stride: 16,
            levels: 1,
            format: 0x3154_5844,
            pixels: &pixels,
        };
        let object = s.add_texture(template, &spec).unwrap();
        assert!(object != template);
        let duplicate = s.add_texture(template, &spec).unwrap_err();
        assert_eq!(duplicate.message, "YPT already contains texture astral_sheet.");
        let file = s.into_file().unwrap();
        let res = Resource::parse(&file).unwrap();
        let read = super::super::read(&res).unwrap();
        let sheet = read.textures.iter().find(|t| t.name == "astral_sheet").unwrap();
        assert_eq!((sheet.width, sheet.height, sheet.levels, sheet.format_code), (8, 8, 1, 0x3154_5844));
        let at = sheet.data_at.unwrap();
        assert_eq!(res.bytes(at, 32).unwrap(), &pixels[..]);
        // прежний лист не тронут
        let old = read.textures.iter().find(|t| t.name == "ptfx_tracer").unwrap();
        assert_eq!((old.width, old.height), (128, 256));
        let again = Structure::parse(&file).unwrap();
        assert_eq!(
            again.names(Kind::Texture).unwrap(),
            sorted_by_hash(&["ptfx_tracer", "astral_sheet"])
        );
        let image = Image::parse(&file).unwrap();
        assert!(vanilla::assert_dictionaries(&image).unwrap().is_empty());
        let _ = core;
    }

    #[test]
    fn the_events_of_a_copy_can_be_cut_down_and_restored_within_the_array() {
        let (core, mut s) = opened();
        let copy = s.copy_effect(core.map.effect).unwrap();
        s.set_events(copy.effect, &[]).unwrap();
        assert!(s.events(copy.effect).unwrap().is_empty());
        assert_eq!(s.list(copy.effect + EFFECT_EVENTS).unwrap().capacity, 1);
        s.set_events(copy.effect, &copy.events).unwrap();
        assert_eq!(s.events(copy.effect).unwrap(), copy.events);
        let too_many = [copy.events[0], copy.events[0]];
        assert!(s.set_events(copy.effect, &too_many).is_err());
    }

    #[test]
    fn a_foreign_donor_comes_over_without_its_outside_links() {
        let (donor_core, mut donor) = opened();
        let texture = donor.entries(Kind::Texture).unwrap()[0].object.unwrap();
        let variable = donor.objects(donor.list(donor_core.map.particle + PARTICLE_VARS).unwrap())[0];
        donor.set_system_pointer(donor_core.map.particle + PARTICLE_SPAWNERS[1] + SPAWNER_EFFECT, Some(donor_core.map.effect)).unwrap();
        donor.set_system_pointer(variable + VAR_TEXTURE, Some(texture)).unwrap();
        donor.set_system_pointer(donor_core.map.effect + EFFECT_ROOT_LINK, Some(0)).unwrap();

        let (_, mut target) = opened();
        let (copy, planted) = target.import_effect(&donor, donor_core.map.effect).unwrap();
        // три слова остались без цели: порождаемый эффект, лист и корень; корень правило получает от приёмника
        assert_eq!(planted.dangling.len(), 3);
        let particle = copy.particles[0];
        assert_eq!(target.pointer(particle + PARTICLE_SPAWNERS[1] + SPAWNER_EFFECT), None);
        let own_variable = target.objects(target.list(particle + PARTICLE_VARS).unwrap())[0];
        assert_eq!(target.pointer(own_variable + VAR_TEXTURE), None);
        assert_eq!(target.pointer(copy.effect + EFFECT_ROOT_LINK), Some(0));
        assert!(planted.dangling.iter().any(|d| d.at == own_variable + VAR_TEXTURE && d.target.offset == texture));
        // имя в приёмнике — свободное, значит вставляется
        target.name_copy(&copy, &names_of("astral_f")).unwrap();
        target.insert_named(Kind::Effect, copy.effect).unwrap();
        let file = target.into_file().unwrap();
        assert_eq!(Structure::parse(&file).unwrap().names(Kind::Effect).unwrap().len(), 2);
    }

    /// Блоки, достижимые от `root` без прохода через слова `stops` и корень.
    fn reach(graph: &Graph, root: usize, stops: &HashSet<usize>) -> HashSet<usize> {
        let top = graph.root();
        let mut seen = HashSet::new();
        let mut pending = vec![graph.block_at(sys(root)).unwrap()];
        seen.insert(pending[0]);
        while let Some(index) = pending.pop() {
            let block = &graph.blocks[index];
            for slot in &block.slots {
                if block.segment == Segment::System && stops.contains(&(block.start + slot.relative)) {
                    continue;
                }
                let next = graph.block_at(slot.target).unwrap();
                if Some(next) != top && seen.insert(next) {
                    pending.push(next);
                }
            }
        }
        seen
    }

    /// Настоящее ядро (`ASTRAL_YPT_CORE`): каждое правило копируется целиком и ничего не делит с донором, кроме
    /// допущенного. Без переменной тест пропускается. `ASTRAL_YPT_ALL=1` — все правила, иначе каждое восьмое.
    #[test]
    fn real_core_every_rule_copies_cleanly() {
        let Ok(path) = std::env::var("ASTRAL_YPT_CORE") else {
            return;
        };
        let file = std::fs::read(path).unwrap();
        let mut s = Structure::parse(&file).unwrap();
        let originals = s.graph().blocks.len();
        eprintln!(
            "блоков {originals}; недостижимо {:?}; исходных ничьих {}",
            s.unreachable_blocks().unwrap(),
            s.original_orphans()
        );
        for kind in Kind::ALL {
            let dictionary = s.pointer(kind.field()).unwrap();
            let values = s.list(dictionary + DICTIONARY_VALUES).unwrap();
            let hashes = s.list(dictionary + DICTIONARY_HASHES).unwrap();
            eprintln!("{}: значения {values:?}, хеши {hashes:?}", kind.label());
        }
        // Общие массивы кадров: у скольких свойств эмиттеров и правил массив один на несколько свойств.
        let mut users: HashMap<usize, usize> = HashMap::new();
        let mut props = 0usize;
        for entry in s.entries(Kind::Emitter).unwrap() {
            let emitter = entry.object.unwrap();
            for k in 0..10 {
                let prop = emitter + 0x78 + k * 0x90;
                if let Some(array) = s.pointer(prop + 0x70) {
                    *users.entry(array).or_default() += 1;
                    props += 1;
                }
            }
        }
        let shared = users.values().filter(|&&n| n > 1).count();
        eprintln!("свойства эмиттеров с кадрами {props}; общих массивов кадров {shared}");
        let step = if std::env::var("ASTRAL_YPT_ALL").is_ok() { 1 } else { 8 };
        let effects = s.entries(Kind::Effect).unwrap();
        let mut checked = 0;
        for entry in effects.iter().step_by(step) {
            let donor = entry.object.unwrap();
            let donor_events = s.events(donor).unwrap();
            let (donor_emitters, donor_particles) = s.rules_of(&donor_events);
            let copy = s.copy_effect(donor).unwrap();
            assert_eq!(copy.events.len(), donor_events.len());
            assert_eq!(copy.emitters.len(), donor_emitters.len());
            assert_eq!(copy.particles.len(), donor_particles.len());
            let stops = s.effect_stops(copy.effect).unwrap();
            let reached = reach(s.graph(), copy.effect, &stops);
            let old: Vec<usize> = reached.iter().copied().filter(|&index| index < originals).collect();
            assert!(old.is_empty(), "правило {:?}: у копии остались общие блоки {old:?}", s.name_of(Kind::Effect, donor));
            // внешние ссылки копии те же, что у донора
            let donor_stops = s.effect_stops(donor).unwrap();
            let mut donor_words: Vec<u64> = donor_stops.iter().map(|&at| s.u64(at).unwrap()).collect();
            let mut copy_words: Vec<u64> = stops.iter().map(|&at| s.u64(at).unwrap()).collect();
            donor_words.sort_unstable();
            copy_words.sort_unstable();
            assert_eq!(donor_words, copy_words);
            checked += 1;
        }
        eprintln!("скопировано правил: {checked}");
    }

    /// Убирает из выгрузки то, что у копии своё: имена и счётчики ссылок.
    fn scrub(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                for key in ["Name", "RefCount", "EmitterRule", "ParticleRule"] {
                    map.remove(key);
                }
                map.values_mut().for_each(scrub);
            }
            serde_json::Value::Array(items) => items.iter_mut().for_each(scrub),
            _ => {}
        }
    }

    /// Разбор одного донора: какие блоки лежат в объекте правила, какие из них вошли в копию и где копия расходится с
    /// образцом по байтам, не считая слов-указателей.
    #[test]
    fn real_core_copy_bytes_probe() {
        let Ok(path) = std::env::var("ASTRAL_YPT_CORE") else {
            return;
        };
        let file = std::fs::read(path).unwrap();
        let mut s = Structure::parse(&file).unwrap();
        for name in ["water_splash_ped_wade", "bul_gravel_heli", "blood_exit"] {
            let donor = s.find_exact(Kind::Effect, name).unwrap().unwrap();
            let stops = s.effect_stops(donor).unwrap();
            let pieces = gather(s.graph(), &s.extents, &[donor], &stops).unwrap();
            let covering: Vec<(usize, usize, usize)> = s
                .graph()
                .segment_blocks(Segment::System)
                .iter()
                .map(|&index| (index, s.graph().blocks[index].start, s.graph().blocks[index].end))
                .filter(|&(_, from, to)| from < donor + 0x3C0 && to > donor)
                .collect();
            let selected: Vec<usize> = pieces.iter().flat_map(|piece| piece.members.iter().map(|m| m.0)).collect();
            eprintln!("{name}: объект {donor:#x}");
            for (index, from, to) in &covering {
                eprintln!(
                    "   блок {index}: {:+#x}..{:+#x} {}",
                    *from as i64 - donor as i64,
                    *to as i64 - donor as i64,
                    if selected.contains(index) { "в копии" } else { "НЕ в копии" }
                );
            }
            let copy = s.copy_effect(donor).unwrap();
            let words: std::collections::HashSet<usize> = (0..0x3C0 / 8)
                .filter(|&k| {
                    let at = donor + k * 8;
                    s.graph().block_at(sys(at)).is_some_and(|b| {
                        let block = &s.graph().blocks[b];
                        block.slots.iter().any(|slot| block.start + slot.relative == at)
                    })
                })
                .map(|k| k * 8)
                .collect();
            let mut differing = Vec::new();
            for k in 0..0x3C0 {
                if words.contains(&(k & !7)) {
                    continue;
                }
                if s.system()[donor + k] != s.system()[copy.effect + k] {
                    differing.push(format!("{k:#x}:{}→{}", s.system()[donor + k], s.system()[copy.effect + k]));
                }
            }
            eprintln!("   байтов вне указателей расходится {}: {:?}", differing.len(), &differing[..differing.len().min(12)]);
        }
    }

    /// Поведение «модель» у частицы донора и у копии: байты и блоки вокруг.
    #[test]
    fn real_core_model_behaviour_probe() {
        let Ok(path) = std::env::var("ASTRAL_YPT_CORE") else {
            return;
        };
        let file = std::fs::read(path).unwrap();
        let mut s = Structure::parse(&file).unwrap();
        let donor_effect = s.find_exact(Kind::Effect, "exp_grd_petrol_pump").unwrap().unwrap();
        let copy = s.copy_effect(donor_effect).unwrap();
        let find_model = |s: &Structure, effect: usize| -> Vec<usize> {
            let (_, particles) = s.rules_of(&s.events(effect).unwrap());
            let mut found = Vec::new();
            for particle in particles {
                for at in [0x128usize] {
                    for behaviour in s.objects(s.list(particle + at).unwrap()) {
                        if s.u32(behaviour + 8).unwrap() == 0x6232_E25A {
                            found.push(behaviour);
                        }
                    }
                }
            }
            found
        };
        let (donors, copies) = (find_model(&s, donor_effect), find_model(&s, copy.effect));
        eprintln!("моделей у донора {}, у копии {}", donors.len(), copies.len());
        for (label, effect) in [("донор", donor_effect), ("копия", copy.effect)] {
            let (_, particles) = s.rules_of(&s.events(effect).unwrap());
            for particle in particles {
                let list = s.list(particle + 0x128).unwrap();
                let slots = s.list_slots(list);
                let kinds: Vec<String> = slots
                    .iter()
                    .map(|slot| match slot {
                        Some(at) => format!("{:#x}@{at:#x}", s.u32(at + 8).unwrap()),
                        None => "нет".to_owned(),
                    })
                    .collect();
                eprintln!("{label}: частица {particle:#x} список {list:?} виды {kinds:?}");
            }
        }
        for (&d, &c) in donors.iter().zip(&copies) {
            eprintln!("донор {d:#x}: {}", hex(&s.system()[d..d + 0x48]));
            eprintln!("копия {c:#x}: {}", hex(&s.system()[c..c + 0x48]));
            eprintln!("длина по карте: {:?}", s.extents.get(&d));
            let block = s.graph().block_at(sys(d)).unwrap();
            eprintln!("блок донора {:#x}..{:#x}", s.graph().blocks[block].start, s.graph().blocks[block].end);
            let block = s.graph().block_at(sys(c)).unwrap();
            eprintln!("блок копии {:#x}..{:#x}", s.graph().blocks[block].start, s.graph().blocks[block].end);
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// Первое расхождение двух выгрузок: путь и значения.
    fn first_difference(left: &serde_json::Value, right: &serde_json::Value, at: &str) -> String {
        use serde_json::Value;
        match (left, right) {
            (Value::Object(a), Value::Object(b)) => {
                for key in a.keys().chain(b.keys()) {
                    let (x, y) = (a.get(key).unwrap_or(&Value::Null), b.get(key).unwrap_or(&Value::Null));
                    if x != y {
                        return first_difference(x, y, &format!("{at}.{key}"));
                    }
                }
                String::from("равны")
            }
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                for (k, (x, y)) in a.iter().zip(b).enumerate() {
                    if x != y {
                        return first_difference(x, y, &format!("{at}[{k}]"));
                    }
                }
                String::from("равны")
            }
            _ => format!("{at}: {} против {}", left.to_string().chars().take(100).collect::<String>(), right.to_string().chars().take(100).collect::<String>()),
        }
    }

    /// Настоящее ядро (`ASTRAL_YPT_CORE`): выгрузка копии правила — та же, что у донора, кроме имён и счётчиков ссылок.
    /// Копия читается читателем ядра (`export::rules`) по тем же смещениям, значит раскладка объектов цела.
    #[test]
    fn real_core_copies_export_like_their_donors() {
        let Ok(path) = std::env::var("ASTRAL_YPT_CORE") else {
            return;
        };
        let file = std::fs::read(path).unwrap();
        let mut s = Structure::parse(&file).unwrap();
        let step = if std::env::var("ASTRAL_YPT_ALL").is_ok() { 1 } else { 12 };
        let donors: Vec<String> = s
            .names(Kind::Effect)
            .unwrap()
            .into_iter()
            .step_by(step)
            .filter(|name| !name.is_empty())
            .collect();
        let mut pairs: Vec<(String, String)> = Vec::new();
        for (k, name) in donors.iter().enumerate() {
            let Some(donor) = s.find_exact(Kind::Effect, name).unwrap() else {
                continue;
            };
            let copy = s.copy_effect(donor).unwrap();
            let clone = format!("astral_c{k}");
            let named = EffectNames {
                effect: clone.clone(),
                emitters: (0..copy.emitters.len()).map(|n| format!("{clone}_e{n}")).collect(),
                particles: (0..copy.particles.len()).map(|n| format!("{clone}_p{n}")).collect(),
            };
            s.name_copy(&copy, &named).unwrap();
            s.insert_named(Kind::Effect, copy.effect).unwrap();
            for &emitter in &copy.emitters {
                s.insert_named(Kind::Emitter, emitter).unwrap();
            }
            for &particle in &copy.particles {
                s.insert_named(Kind::Particle, particle).unwrap();
            }
            pairs.push((name.clone(), clone));
        }
        let resource = s.to_resource();
        let mut bad = Vec::new();
        for chunk in pairs.chunks(50) {
        let wanted: Vec<String> = chunk.iter().flat_map(|(a, b)| [a.clone(), b.clone()]).collect();
        let dump = crate::ypt::export::rules(&resource, &wanted).unwrap();
        for (donor, clone) in chunk {
            let (mut left, mut right) = (dump.effects[donor].clone(), dump.effects[clone].clone());
            // имена эмиттеров и частиц событий — по порядку событий
            let events = |effect: &serde_json::Value| -> Vec<(String, String)> {
                effect["EventEmitters"]
                    .as_array()
                    .map(|list| {
                        list.iter()
                            .map(|event| {
                                (
                                    event["EmitterRule"].as_str().unwrap_or_default().to_owned(),
                                    event["ParticleRule"].as_str().unwrap_or_default().to_owned(),
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let (donor_events, clone_events) = (events(&left), events(&right));
            scrub(&mut left);
            scrub(&mut right);
            if left != right {
                bad.push(format!("эффект {donor}: {}", first_difference(&left, &right, "$")));
                continue;
            }
            for ((de, dp), (ce, cp)) in donor_events.iter().zip(&clone_events) {
                let (mut a, mut b) = (dump.emitters[de].clone(), dump.emitters[ce].clone());
                scrub(&mut a);
                scrub(&mut b);
                if a != b {
                    bad.push(format!("эмиттер {de} ({donor}): {}", first_difference(&a, &b, "$")));
                }
                let (mut a, mut b) = (dump.particles[dp].clone(), dump.particles[cp].clone());
                scrub(&mut a);
                scrub(&mut b);
                if a != b {
                    bad.push(format!("частица {dp} ({donor}): {}", first_difference(&a, &b, "$")));
                }
            }
        }
        }
        eprintln!("копий {}, расхождений {}: {:?}", pairs.len(), bad.len(), &bad[..bad.len().min(10)]);
        assert!(bad.is_empty());
    }

    /// Настоящее ядро: правило ставится и снимается, ядро после этого такое же по составу и по числу блоков.
    #[test]
    fn real_core_install_then_remove_leaves_the_core_as_it_was() {
        let Ok(path) = std::env::var("ASTRAL_YPT_CORE") else {
            return;
        };
        let file = std::fs::read(path).unwrap();
        let started = std::time::Instant::now();
        let mut s = Structure::parse(&file).unwrap();
        let names: Vec<Vec<String>> = Kind::ALL.iter().map(|&kind| s.names(kind).unwrap()).collect();
        let blocks = s.graph().blocks.len();
        eprintln!("разбор {:?}", started.elapsed());
        let donor = s.find_exact(Kind::Effect, "blood_entry").unwrap().unwrap();
        let copy = s.copy_effect(donor).unwrap();
        let named = EffectNames {
            effect: "astral_probe_a".to_owned(),
            emitters: (0..copy.emitters.len()).map(|k| format!("astral_probe_a_e{k}")).collect(),
            particles: (0..copy.particles.len()).map(|k| format!("astral_probe_a_p{k}")).collect(),
        };
        s.name_copy(&copy, &named).unwrap();
        s.insert_named(Kind::Effect, copy.effect).unwrap();
        for &emitter in &copy.emitters {
            s.insert_named(Kind::Emitter, emitter).unwrap();
        }
        for &particle in &copy.particles {
            s.insert_named(Kind::Particle, particle).unwrap();
        }
        assert!(s.assert_dictionaries().unwrap().len() < 1000);
        // установленное ядро собирается и читается
        let removed = s.remove_effect("astral_probe_a").unwrap();
        assert_eq!(removed.effects, vec!["astral_probe_a".to_owned()]);
        assert_eq!(removed.emitters.len(), copy.emitters.len());
        assert_eq!(removed.particles.len(), copy.particles.len());
        let rebuilt = std::time::Instant::now();
        let out = s.into_file().unwrap();
        eprintln!("сборка {:?}; файл {} против {}", rebuilt.elapsed(), out.len(), file.len());
        let again = Structure::parse(&out).unwrap();
        let after: Vec<Vec<String>> = Kind::ALL.iter().map(|&kind| again.names(kind).unwrap()).collect();
        assert_eq!(names, after);
        eprintln!("блоков было {blocks}, стало {}", again.graph().blocks.len());
        // блоков столько же с точностью до слов-хешей, которые читаются указателем и режутся иначе
        assert!(again.graph().blocks.len().abs_diff(blocks) <= 3);
        // штатные правила читаются после сборки так же, как до неё
        let stock: Vec<String> = names[0].iter().step_by(24).take(40).cloned().collect();
        let before = crate::ypt::export::rules(&Resource::parse(&file).unwrap(), &stock).unwrap();
        let after = crate::ypt::export::rules(&Resource::parse(&out).unwrap(), &stock).unwrap();
        for name in &stock {
            assert_eq!(before.effects[name], after.effects[name], "правило {name}");
        }
        for (name, doc) in &before.particles {
            assert_eq!(*doc, after.particles[name], "частица {name}");
        }
        for (name, doc) in &before.emitters {
            assert_eq!(*doc, after.emitters[name], "эмиттер {name}");
        }
    }

    /// Пиксели всех текстур файла: имя → хеш ступеней.
    fn pixel_digests(file: &[u8]) -> Vec<(String, u64)> {
        use std::hash::{Hash, Hasher};
        let res = Resource::parse(file).unwrap();
        let core = crate::ypt::read(&res).unwrap();
        core.textures
            .iter()
            .map(|texture| {
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                if let Some(bytes) = texture.data_at.and_then(|at| res.bytes(at, texture.bytes).ok()) {
                    bytes.hash(&mut hasher);
                }
                (texture.name.clone(), hasher.finish())
            })
            .collect()
    }

    /// Настоящее ядро (`ASTRAL_YPT_CORE` или `ASTRAL_YPT_CORE_B`): пиксели штатных текстур переживают сборку, установку
    /// копии поверх собранного ядра и повторную сборку.
    #[test]
    fn real_core_pixels_survive_rebuilds() {
        for variable in ["ASTRAL_YPT_CORE", "ASTRAL_YPT_CORE_B"] {
            let Ok(path) = std::env::var(variable) else {
                continue;
            };
            let file = std::fs::read(path).unwrap();
            let before = pixel_digests(&file);
            let rebuilt = Structure::parse(&file).unwrap().into_file().unwrap();
            let once = pixel_digests(&rebuilt);
            let moved: Vec<&str> = before
                .iter()
                .zip(&once)
                .filter(|(a, b)| a != b)
                .map(|(a, _)| a.0.as_str())
                .collect();
            assert!(moved.is_empty(), "{variable}: после сборки изменились пиксели {moved:?}");
            // одно снятие прежнего семейства, без новой копии
            let mut only = Structure::parse(&rebuilt).unwrap();
            for name in only.names(Kind::Effect).unwrap() {
                if name.starts_with("astral_probe_") {
                    only.remove_effect(&name).unwrap();
                }
            }
            let cut = pixel_digests(&only.into_file().unwrap());
            let moved: Vec<&str> = before
                .iter()
                .zip(&cut)
                .filter(|(a, b)| a != b)
                .map(|(a, _)| a.0.as_str())
                .collect();
            assert!(moved.is_empty(), "{variable}: после одного снятия изменились пиксели {moved:?}");
            let mut again = Structure::parse(&rebuilt).unwrap();
            // прежнее семейство снимается, как при повторной установке
            for name in again.names(Kind::Effect).unwrap() {
                if name.starts_with("astral_probe_") {
                    again.remove_effect(&name).unwrap();
                }
            }
            let donor = again.find_exact(Kind::Effect, "blood_mist").unwrap().unwrap();
            let copy = again.copy_effect(donor).unwrap();
            let named = EffectNames {
                effect: "astral_zz_probe".to_owned(),
                emitters: (0..copy.emitters.len()).map(|k| format!("astral_zz_probe_e{k}")).collect(),
                particles: (0..copy.particles.len()).map(|k| format!("astral_zz_probe_p{k}")).collect(),
            };
            again.name_copy(&copy, &named).unwrap();
            again.insert_named(Kind::Effect, copy.effect).unwrap();
            for &emitter in &copy.emitters {
                again.insert_named(Kind::Emitter, emitter).unwrap();
            }
            for &particle in &copy.particles {
                again.insert_named(Kind::Particle, particle).unwrap();
            }
            let twice = pixel_digests(&again.into_file().unwrap());
            let moved: Vec<&str> = before
                .iter()
                .zip(&twice)
                .filter(|(a, b)| a != b)
                .map(|(a, _)| a.0.as_str())
                .collect();
            assert!(moved.is_empty(), "{variable}: после второй установки изменились пиксели {moved:?}");
        }
    }

    #[test]
    fn a_core_without_garbage_has_nothing_to_drop() {
        let (_, s) = opened();
        assert_eq!(s.unreachable_blocks().unwrap(), [0, 0]);
        let table = counts(&s).unwrap();
        assert_eq!(table.values().sum::<usize>(), 4);
    }

    fn put_word(area: &mut [u8], at: usize, to: usize) {
        area[at..at + 8].copy_from_slice(&(SYSTEM_BASE + to as u64).to_le_bytes());
    }

    /// Система 0x600: корень (0x40) ведёт на объект «А» (0x100, на деле 0xB0 байт, в карте длин — 0xD0) и на его соседа «Б»
    /// (0x1B0, 0xD0 байт, длина верна). В «А» слово на лист «Л» (0x300), в «Б» — слово на «В» (0x400), а оно — на «Г»
    /// (0x500): чужие объекты, которых у «А» нет. Длина «А» вылезает на начало «Б», как у цепочек поведений (шаг 0xB0
    /// при длине 0xD0): в ядре игры за таким объектом лежит свой же, а у ядра, записанного помощником, — что попало.
    fn neighbour_sample() -> Structure {
        let mut system = vec![0u8; 0x600];
        put_word(&mut system, 0, 0x100);
        put_word(&mut system, 8, 0x1B0);
        put_word(&mut system, 0x108, 0x300);
        put_word(&mut system, 0x1B8, 0x400);
        put_word(&mut system, 0x408, 0x500);
        system[0x300] = 0x31;
        system[0x500] = 0x51;
        let graph = from_parts(68, 0, 0, system, Vec::new());
        let extents: BTreeMap<usize, usize> =
            [(0x100, 0xD0), (0x1B0, 0xD0), (0x300, 0x20), (0x400, 0x40), (0x500, 0x20)].into_iter().collect();
        Structure::with_extents(graph, extents, &[])
    }

    #[test]
    fn a_copy_takes_the_object_and_what_it_points_at_but_not_the_neighbour_its_length_runs_into() {
        let mut s = neighbour_sample();
        let before = s.graph().system.len();
        let planted = s.copy_subgraph(0x100, &HashSet::new()).unwrap();
        // перенесены «А» (его блок 0x100..0x1B0) и «Л»
        assert!(planted.translate(0x100).is_some());
        assert!(planted.translate(0x300).is_some());
        // «Б» и всё, что за ним (В, Г), не тронуты: ни одного лишнего байта
        for neighbour in [0x1B0, 0x400, 0x500] {
            assert!(planted.translate(neighbour).is_none(), "{neighbour:#x} перенесён вместе с объектом");
        }
        // блок «А» 0xB0 и блок «Л» (до следующей цели, 0x100) — с выравниванием не больше 0x200; с соседом было бы 0x500
        let added = s.graph().system.len() - before;
        assert!(added <= 0x200, "копия принесла {added:#x} байт: лишнее ({before:#x} было)");
    }

    #[test]
    fn a_piece_of_the_object_that_starts_inside_it_is_still_taken_with_it() {
        // «А» целиком в карте на 0x100 байт, внутри него ещё один объект «а» (0x180, 0x30): он часть «А», его блок идёт следом
        let mut system = vec![0u8; 0x600];
        put_word(&mut system, 0, 0x100);
        put_word(&mut system, 0x108, 0x180);
        put_word(&mut system, 0x188, 0x300);
        system[0x300] = 0x31;
        let graph = from_parts(68, 0, 0, system, Vec::new());
        let extents: BTreeMap<usize, usize> = [(0x100, 0x100), (0x180, 0x30), (0x300, 0x20)].into_iter().collect();
        let mut s = Structure::with_extents(graph, extents, &[]);
        let planted = s.copy_subgraph(0x100, &HashSet::new()).unwrap();
        for part in [0x100, 0x180, 0x1B0, 0x300] {
            assert!(planted.translate(part).is_some(), "{part:#x} не перенесён");
        }
    }

    /// Корень (0) ведёт на объект «А» (0x100, длина 0x100) со слотом на лист «Л» (0x300). Внутри длины «А» лежат два
    /// блока, на которые не ссылается ни один достижимый: свойство «С» (0x180) и массив «М» (0x1C0) — они ссылаются друг
    /// на друга (в файле такие остаются от тела объекта, на них никто живой не указывает). Снаружи — чужая мёртвая пара
    /// «Ч» (0x500) и «Я» (0x540), исходно ничья, не в длине ни одного объекта.
    fn body_sample() -> Structure {
        let mut system = vec![0u8; 0x600];
        put_word(&mut system, 0, 0x100);
        put_word(&mut system, 0x108, 0x300);
        put_word(&mut system, 0x188, 0x1C0);
        put_word(&mut system, 0x1C8, 0x180);
        put_word(&mut system, 0x508, 0x540);
        put_word(&mut system, 0x548, 0x500);
        let graph = from_parts(68, 0, 0, system, Vec::new());
        let extents: BTreeMap<usize, usize> = [(0x100, 0x100), (0x300, 0x20)].into_iter().collect();
        Structure::with_extents(graph, extents, &[])
    }

    /// Корень (0) ведёт на правило «Э» (0x100), у него массив «М» (0x180) с указателями на два события по `EVENT` байт подряд
    /// (0x200 и 0x270), у каждого события указатель на свой лист (0x800 и 0xA00). Чужие блоки (0x600, 0x900) стоят между
    /// листами, поэтому лист переносится своим куском, а «Э», «М» и оба события — одним блоком.
    fn events_sample() -> Structure {
        let mut system = vec![0u8; 0xC00];
        put_word(&mut system, 0, 0x100);
        put_word(&mut system, 8, 0x600);
        put_word(&mut system, 0x10, 0x900);
        put_word(&mut system, 0x108, 0x180);
        put_word(&mut system, 0x180, 0x200);
        put_word(&mut system, 0x188, 0x270);
        put_word(&mut system, 0x248, 0x800);
        put_word(&mut system, 0x2B8, 0xA00);
        system[0x800] = 0x31;
        system[0xA00] = 0x51;
        Structure::with_extents(from_parts(68, 0, 0, system, Vec::new()), BTreeMap::new(), &[])
    }

    fn lives(s: &Structure, at: usize) -> bool {
        s.graph().block_at(sys(at)).is_some_and(|index| s.graph().blocks[index].end > s.graph().blocks[index].start)
    }

    #[test]
    fn an_event_taken_off_a_copy_holds_its_rules_alive_until_it_is_cleared() {
        for (clear, leaf_lives) in [(false, true), (true, false)] {
            let mut s = events_sample();
            let planted = s.copy_subgraph(0x100, &HashSet::new()).unwrap();
            let (array, event, kept_leaf, dropped_leaf) = (
                planted.translate(0x180).unwrap(),
                planted.translate(0x270).unwrap(),
                planted.translate(0x800).unwrap(),
                planted.translate(0xA00).unwrap(),
            );
            // копия правила повешена на корень, как вешает её словарь
            s.set_pointer(0x20, Some(sys(planted.translate(0x100).unwrap()))).unwrap();
            // события лежат одним блоком с правилом: перенос несёт подряд идущие блоки одним куском
            assert_eq!(s.graph().block_at(sys(event)), s.graph().block_at(sys(array)));
            // второе событие снято с массива, как это делает `set_events`
            s.set_pointer(array + 8, None).unwrap();
            if clear {
                s.clear_events(&[event]).unwrap();
            }
            s.garbage = true;
            s.collect_garbage().unwrap();
            assert!(lives(&s, kept_leaf), "лист оставленного события потерян");
            assert_eq!(lives(&s, dropped_leaf), leaf_lives, "обнуление {clear}: лист снятого события");
        }
    }

    fn whole_blocks(s: &Structure) -> Vec<usize> {
        s.graph().blocks.iter().filter(|block| block.end > block.start).map(|block| block.start).collect()
    }

    #[test]
    fn the_dead_body_of_a_live_object_stays_with_it() {
        let mut s = body_sample();
        assert_eq!(s.original_orphans(), 4);
        s.garbage = true;
        s.collect_garbage().unwrap();
        assert_eq!(whole_blocks(&s), [0, 0x100, 0x180, 0x1C0, 0x300, 0x500, 0x540]);
    }

    #[test]
    fn the_dead_body_of_a_dropped_object_goes_with_it_but_foreign_dead_blocks_stay() {
        let mut s = body_sample();
        // объект «А» сброшен (клон снят из словаря): на него больше никто не ссылается
        s.graph_mut().blocks[0].slots.clear();
        s.garbage = true;
        s.collect_garbage().unwrap();
        // ушли «А», его лист, его свойство и его массив; чужая исходная пара осталась, как у помощника
        assert_eq!(whole_blocks(&s), [0, 0x500, 0x540]);
    }
}
