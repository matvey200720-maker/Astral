//! Образ ядра `core.ypt` по объектам: блоки графа — объекты схемы, а не куски между указателями.
//!
//! **С 16.11 вечером этим способом открывается только словарь-донор (`ypt-own-donor`): ему нужен чистый образ, где
//! недостижимое от корня отброшено при открытии.** Остальные шаги `ypt-patch` (кадры, слоты, клоны, текстуры, правила)
//! идут через `Structure::parse` — единый способ открытия (`Image::parse` над ним): замер на четырёх настоящих ядрах
//! показал, что после маски слов-хешей по схеме остаётся 0 слов с целью не на начало объекта, а отбрасывание по цели из
//! этого модуля теряло имена правил на выходах слотов и клонов образца (`slot_fixture`).
//!
//! `Structure::parse` режет ресурс по целям указателей. У правила эффекта (0x3C0 байт) таких целей шесть: массив из
//! пяти указателей ведёт на пять встроенных ключевых свойств внутри самого правила, и правило ложится в граф шестью
//! блоками, из которых достижим по указателям один, головной. Хвост правила (список с указателем на этот массив) лежит в
//! последнем блоке, так что ни один указатель туда не ведёт: копия правила по достижимости берёт только головной блок
//! (0xC0 байт), а сборка файла с отбрасыванием недостижимого теряет остальные пять. Файл получается с оборванными
//! правилами, и чтение помощника отказывает («illegal position»). То же у эмиттера, частицы и поведений со встроенными
//! свойствами.
//!
//! Здесь образ собирается так же, как у писателя текстур (`writer`): карта длин объектов (`layout::lengths`) говорит, где
//! объект кончается; блоки внутри самого большого объекта сливаются в один. Слова, которые на деле хеши имён свойств, и
//! слова внутри пикселей указателями не считаются. Недостижимое от корня при открытии отбрасывается: граф сразу чист.
//! Если карту длин построить не удалось (ядро не по схеме), образ остаётся таким, каким его даёт `Structure::parse`.

use std::collections::HashSet;

use super::layout::lengths;
use super::structure::Structure;
use crate::error::{Error, Result};
use crate::resource::{Resource, VERSION_YPT_LEGACY};
use crate::resource_graph::{scan, subgraph, Address, Graph, Segment, Slot};

const MSG_CUT_BODY: &str = "Ресурс короче заявленного: разбирать нечего.";
const MSG_NO_ROOT: &str = "Корень ресурса недоступен.";

/// Файл ядра Legacy как образ по объектам; обрыв потока и чужая версия — отказ.
pub fn open(file: &[u8]) -> Result<Structure> {
    open_counting(file).map(|(structure, _)| structure)
}

/// Ключ места для набора известных целей: область и смещение.
fn place(segment: Segment, offset: usize) -> usize {
    (segment as usize) << 48 | offset
}

/// То же и число слов, которые разбор принял за указатели и которых схема объектов не знает (хеши имён, попавшие в
/// диапазон адресов области: при перекладке блоков такое «слово» переписалось бы как указатель и испортило хеш).
pub fn open_counting(file: &[u8]) -> Result<(Structure, usize)> {
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
    let mut graph = scan(&res)?;
    drop_pixel_words(&mut graph, &res);
    let Ok(found) = lengths(&res) else {
        return Ok((Structure::from_graph(graph), 0));
    };
    let system_size = res.header.system_size;
    drop_hash_words(&mut graph, &found.name_hashes);
    let objects: Vec<(Segment, usize, usize)> = found
        .objects
        .iter()
        .map(|(&at, &length)| match at.checked_sub(system_size) {
            None => (Segment::System, at, at + length),
            Some(offset) => (Segment::Graphics, offset, offset + length),
        })
        .collect();
    // Настоящий указатель ведёт на объект схемы или на пиксели листа; остальное — случайное попадание числа в область.
    let mut known: HashSet<usize> = objects.iter().map(|&(segment, start, _)| place(segment, start)).collect();
    if let Ok(core) = super::read(&res) {
        known.extend(core.textures.iter().filter_map(|texture| {
            let at = texture.data_at.filter(|_| texture.bytes > 0)?;
            Some(match at.checked_sub(system_size) {
                None => place(Segment::System, at),
                Some(offset) => place(Segment::Graphics, offset),
            })
        }));
    }
    let zone = rule_zone(&graph, &found.objects);
    let models = model_blocks(&graph, &zone);
    let dropped = drop_unknown_words(&mut graph, &known, &models);
    merge_objects(&mut graph, objects);
    // Объекты сведены: недостижимое от корня — настоящий мусор, а не хвосты правил.
    let clean = subgraph(
        &graph,
        Address {
            segment: Segment::System,
            offset: 0,
        },
    )?;
    Ok((Structure::from_graph(clean), dropped))
}

/// Поле корня со словарём моделей.
const MODEL_DICTIONARY: usize = 0x30;

/// Слот блока по смещению слова.
fn pointer_in(graph: &Graph, block: usize, relative: usize) -> Option<Address> {
    graph.blocks[block].slots.iter().find(|slot| slot.relative == relative).map(|slot| slot.target)
}

/// Блоки правил: каждое правило эффекта, эмиттера и частицы из словарей корня вместе с блоками внутри его объекта.
/// Ложное «слово» из модели не должно втянуть их в число блоков моделей.
fn rule_zone(graph: &Graph, lengths: &std::collections::HashMap<usize, usize>) -> HashSet<usize> {
    let mut zone = HashSet::new();
    let Some(root) = graph.root() else {
        return zone;
    };
    let lane = graph.segment_blocks(Segment::System);
    for field in [0x38, 0x48, 0x50] {
        let Some(dictionary) = pointer_in(graph, root, field).and_then(|at| graph.block_at(at)) else {
            continue;
        };
        let Some(array) = pointer_in(graph, dictionary, 0x30).and_then(|at| graph.block_at(at)) else {
            continue;
        };
        for slot in &graph.blocks[array].slots {
            if slot.target.segment != Segment::System {
                continue;
            }
            let head = slot.target.offset;
            let end = head + lengths.get(&head).copied().unwrap_or(1);
            let first = lane.partition_point(|&index| graph.blocks[index].start < head);
            zone.extend(lane[first..].iter().take_while(|&&index| graph.blocks[index].start < end).copied());
        }
    }
    zone
}

/// Блоки, достижимые от словаря моделей, не входя в правила. У моделей свои объекты (описания вершин, шейдеры),
/// которых карта длин частиц не знает: их слова остаются как разобраны, фильтр «настоящих указателей» на них не
/// распространяется.
fn model_blocks(graph: &Graph, zone: &HashSet<usize>) -> HashSet<usize> {
    let mut seen: HashSet<usize> = HashSet::new();
    let Some(root) = graph.root() else {
        return seen;
    };
    let Some(slot) = graph.blocks[root].slots.iter().find(|slot| slot.relative == MODEL_DICTIONARY) else {
        return seen;
    };
    let Some(start) = graph.block_at(slot.target) else {
        return seen;
    };
    let mut pending = vec![start];
    seen.insert(start);
    while let Some(index) = pending.pop() {
        for slot in &graph.blocks[index].slots {
            if let Some(next) = graph.block_at(slot.target) {
                if next != root && !zone.contains(&next) && seen.insert(next) {
                    pending.push(next);
                }
            }
        }
    }
    seen
}

/// Слова, чья цель не начало известного объекта, указателями не считаются (кроме блоков `exempt`); отдаёт, сколько их
/// было.
fn drop_unknown_words(graph: &mut Graph, known: &HashSet<usize>, exempt: &HashSet<usize>) -> usize {
    let mut dropped = 0;
    for (index, block) in graph.blocks.iter_mut().enumerate() {
        if exempt.contains(&index) {
            continue;
        }
        let before = block.slots.len();
        block
            .slots
            .retain(|slot| known.contains(&place(slot.target.segment, slot.target.offset)));
        dropped += before - block.slots.len();
    }
    dropped
}

/// Слова внутри пикселей текстур указателями не считаются.
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

/// Слова-хеши имён свойств ключевых кадров (хеш и два байта признаков рядом) указателями не считаются.
fn drop_hash_words(graph: &mut Graph, hashes: &[usize]) {
    let at: HashSet<usize> = hashes.iter().copied().collect();
    for block in &mut graph.blocks {
        if block.segment != Segment::System {
            continue;
        }
        let start = block.start;
        block.slots.retain(|slot| {
            let word = start + slot.relative;
            !(at.contains(&word) || at.contains(&(word + 4)))
        });
    }
}

/// Самые большие объекты: вложенные (свойства внутри правила) входят в объемлющий. Объект, который начат внутри другого
/// и кончается за его краем, — не вложенный: длина прежнего в карте завышена (так у цепочек поведений: объекты по 0xD0
/// идут с шагом 0xB0), поэтому прежний обрезается по началу соседа, а сосед начинает свой объект. Сливать их в один
/// нельзя: цепочка утянула бы в образ чужие правила, которые стоят рядом.
fn containers(mut objects: Vec<(Segment, usize, usize)>) -> Vec<(Segment, usize, usize)> {
    objects.sort_by_key(|&(segment, start, end)| (segment as usize, start, std::cmp::Reverse(end)));
    let mut found: Vec<(Segment, usize, usize)> = Vec::new();
    for (segment, start, end) in objects {
        match found.last_mut() {
            Some(last) if last.0 == segment && start < last.2 => {
                if end > last.2 {
                    last.2 = start;
                    found.push((segment, start, end));
                }
            }
            _ => found.push((segment, start, end)),
        }
    }
    found
}

/// Сливает блоки, начатые внутри объекта, с головным блоком объекта. Слитые блоки остаются в графе пустыми: у них нет
/// слотов, начало и конец — на конце головного блока, и ни один указатель в них не попадает.
fn merge_objects(graph: &mut Graph, objects: Vec<(Segment, usize, usize)>) {
    for segment in [Segment::System, Segment::Graphics] {
        let wanted: Vec<(usize, usize)> = containers(objects.iter().copied().filter(|object| object.0 == segment).collect())
            .into_iter()
            .map(|(_, start, end)| (start, end))
            .collect();
        let lane: Vec<usize> = graph.segment_blocks(segment).to_vec();
        let mut cursor = 0;
        for (start, end) in wanted {
            while cursor < lane.len() && graph.blocks[lane[cursor]].start < start {
                cursor += 1;
            }
            if cursor >= lane.len() || graph.blocks[lane[cursor]].start != start {
                continue;
            }
            let head = lane[cursor];
            let mut next = cursor + 1;
            let mut tail = graph.blocks[head].end;
            while next < lane.len() && graph.blocks[lane[next]].start < end {
                let inner = lane[next];
                let (inner_start, inner_end) = (graph.blocks[inner].start, graph.blocks[inner].end);
                let moved: Vec<Slot> = std::mem::take(&mut graph.blocks[inner].slots);
                let shift = inner_start - start;
                graph.blocks[head].slots.extend(moved.into_iter().map(|slot| Slot {
                    relative: slot.relative + shift,
                    target: slot.target,
                }));
                tail = tail.max(inner_end);
                next += 1;
            }
            for &inner in &lane[cursor + 1..next] {
                graph.blocks[inner].start = tail;
                graph.blocks[inner].end = tail;
            }
            graph.blocks[head].end = tail;
            cursor = next;
        }
    }
}

#[cfg(test)]
mod tests;
