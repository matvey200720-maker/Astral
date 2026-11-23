//! Слова-хеши ядра `core.ypt` Legacy: счёт значений по видам, чтобы проверять, что запись их не испортила.
//!
//! Хеш имени свойства, вид поведения, хеш листа и запись карты эволюций лежат в тех же словах области, где у соседних
//! объектов лежат указатели. У ядер из `update.rpf` графическая область больше (около 37 МБ), и хеш вроде
//! `0x6232E25A` попадает в диапазон её адресов: разбор, который принял бы его за указатель, при сборке файла переписал
//! бы значение по новому месту «цели». Здесь слова собираются по схеме объектов (не по значению) и считаются: счёт
//! значений до записи и после обязан совпасть (для правок, которые не добавляют и не убирают записи).

use std::collections::BTreeMap;

use super::structure::{hash_word_kinds, HashKind};
use crate::error::Result;
use crate::resource::Resource;

/// Сколько раз каждое значение стоит в словах-хешах данного вида.
pub type Counts = BTreeMap<u32, usize>;

/// Счёт значений слов-хешей по видам.
pub type ByKind = BTreeMap<HashKind, Counts>;

/// Счёт по видам в файле ядра.
pub fn counts(file: &[u8]) -> Result<ByKind> {
    counts_of(&Resource::parse(file)?)
}

/// То же для ресурса в памяти.
pub fn counts_of(res: &Resource) -> Result<ByKind> {
    let mut out = ByKind::new();
    // поведение, которое стоит в двух списках частицы, — одно слово
    let places: std::collections::BTreeSet<(HashKind, usize)> = hash_word_kinds(res).into_iter().collect();
    for (kind, at) in places {
        let value = res.u32(at)?;
        *out.entry(kind).or_default().entry(value).or_default() += 1;
    }
    Ok(out)
}

/// Сколько слов-хешей всего.
pub fn total(counts: &ByKind) -> usize {
    counts.values().flat_map(|kind| kind.values()).sum()
}

/// Сколько раз значение стоит в словах-хешах любого вида.
pub fn count_of(counts: &ByKind, value: u32) -> usize {
    counts.values().filter_map(|kind| kind.get(&value)).sum()
}

/// Сколько слотов графа стоит на словах-хешах (в целом образе их нет): такое слово при сборке файла переписалось бы
/// как указатель по новому месту «цели».
pub fn slots_on_hash_words(graph: &crate::resource_graph::Graph, res: &Resource) -> usize {
    let at: std::collections::HashSet<usize> = hash_word_kinds(res).into_iter().map(|(_, at)| at).collect();
    graph
        .blocks
        .iter()
        .flat_map(|block| block.slots.iter().map(move |slot| (block, slot)))
        .filter(|(block, slot)| {
            block.segment == crate::resource_graph::Segment::System && {
                let word = block.start + slot.relative;
                at.contains(&word) || at.contains(&(word + 4))
            }
        })
        .count()
}

/// Чем два счёта отличаются: строки вида «behaviour 0x6232E25A: 133 → 0». Пусто — счёт одинаков.
pub fn differences(before: &ByKind, after: &ByKind) -> Vec<String> {
    let mut out = Vec::new();
    for kind in before.keys().chain(after.keys()).copied().collect::<std::collections::BTreeSet<_>>() {
        let (was, now) = (before.get(&kind), after.get(&kind));
        let values: std::collections::BTreeSet<u32> = was
            .into_iter()
            .chain(now)
            .flat_map(|counts| counts.keys().copied())
            .collect();
        for value in values {
            let was = was.and_then(|counts| counts.get(&value)).copied().unwrap_or(0);
            let now = now.and_then(|counts| counts.get(&value)).copied().unwrap_or(0);
            if was != now {
                out.push(format!("{} {value:#010X}: {was} → {now}", kind.label()));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
