//! Словарь-донор своих правил автора редукса («наш Core», этап 2): режим `ypt-own-donor` помощника.
//!
//! Редукс рисует кровь не штатными правилами, а своими со своими листами. Ядро автора целиком — файл Rockstar, его не
//! раздаём. Из него собирается маленький словарь: только названные правила эффектов, их эмиттеры и частицы и листы, которые
//! эти частицы рисуют. Свои листы автора остаются с пикселями; листы игры (имена не из списка `own`) — той же раскладки, но
//! с нулевыми пикселями: при установке клон берёт лист под тем же именем из ядра игрока, и пиксели Rockstar в словарь не
//! попадают.
//!
//! Модели и порождаемые эффекты в своих частицах не переносятся (клон из чужого словаря их не берёт): такой словарь не
//! собирается, отказ называет правило. Остальное ядро — только достижимое от оставшихся записей; недостижимое при сборке
//! файла отбрасывается.

use std::collections::{BTreeSet, HashSet};

use super::image::Image;
use super::structure::{
    Entry, Kind, Structure, DICTIONARY_HASHES, DRAWABLE_MODEL, DRAWABLE_STRIDE, EVENT_EMITTER,
    EVENT_PARTICLE, PARTICLE_DRAWABLES, PARTICLE_SPAWNERS, PARTICLE_VARS, SPAWNER_EFFECT,
    TEXTURE_PIXELS, VAR_KIND, VAR_KIND_TEXTURE, VAR_TEXTURE,
};
use super::{cmp_ordinal_ignore_case, vanilla};
use crate::error::{Error, Result};
use crate::resource::GRAPHICS_BASE;
use crate::resource_graph::Segment;

/// Больше правил в одном словаре-доноре не собирается.
pub const MAX_RULES: usize = 64;

/// Что вошло в словарь: имена по порядку (по возрастанию, посимвольно), числа эмиттеров и частиц.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub effects: Vec<String>,
    pub emitters: usize,
    pub particles: usize,
    /// Листы автора: остались с пикселями.
    pub own_textures: Vec<String>,
    /// Листы игры: раскладка осталась, пиксели нулевые.
    pub game_textures: Vec<String>,
}

fn sorted(mut names: Vec<String>) -> Vec<String> {
    names.sort_unstable();
    names
}

/// Записи словаря правил; число хешей и объектов обязано совпадать (текст отказа — как у помощника).
fn pairs(structure: &Structure, kind: Kind, label: &str) -> Result<Vec<Entry>> {
    let inconsistent = || Error::broken(format!("YPT {label} rule dictionary is inconsistent."));
    let dictionary = structure.pointer(kind.field()).ok_or_else(inconsistent)?;
    let values = structure.list(dictionary + super::image::DICTIONARY_VALUES)?;
    let hashes = structure.list(dictionary + DICTIONARY_HASHES)?;
    if values.count != hashes.count {
        return Err(inconsistent());
    }
    structure.entries(kind)
}

/// Оставляет записи, чьи объекты названы в `keep`; пары «хеш и объект» сортируются по хешу (игра ищет двоичным поиском),
/// повтор хеша — отказ.
fn kept(structure: &Structure, kind: Kind, label: &str, keep: &HashSet<usize>) -> Result<Vec<Entry>> {
    let mut found: Vec<Entry> = pairs(structure, kind, label)?
        .into_iter()
        .filter(|entry| entry.object.is_some_and(|object| keep.contains(&object)))
        .collect();
    found.sort_by_key(|entry| entry.hash);
    if found.windows(2).any(|pair| pair[0].hash == pair[1].hash) {
        return Err(Error::broken(format!(
            "YPT own donor {label} dictionary has a duplicate hash."
        )));
    }
    Ok(found)
}

/// Объекты, которые нужны названным правилам.
#[derive(Default)]
struct Needed {
    effects: Vec<usize>,
    emitters: HashSet<usize>,
    particles: HashSet<usize>,
    textures: HashSet<usize>,
}

/// События правила: позиции массива до меньшего из числа и ёмкости; пустые указатели опущены.
fn raw_events(structure: &Structure, effect: usize) -> Result<Vec<usize>> {
    let list = structure.list(effect + super::structure::EFFECT_EVENTS)?;
    let Some(array) = list.array else {
        return Ok(Vec::new());
    };
    Ok((0..list.count.min(list.capacity))
        .filter_map(|k| structure.pointer(array + k * 8))
        .collect())
}

/// Правило эффекта с таким именем среди значений словаря (хеши не читаются): два — отказ, как у `SingleOrDefault`.
fn find_effect(structure: &Structure, wanted: &str) -> Result<Option<usize>> {
    let Some(dictionary) = structure.pointer(Kind::Effect.field()) else {
        return Ok(None);
    };
    let values = structure.list(dictionary + super::image::DICTIONARY_VALUES)?;
    let mut found = None;
    for object in structure.objects(values) {
        if structure.name_of(Kind::Effect, object).as_deref() != Some(wanted) {
            continue;
        }
        if found.replace(object).is_some() {
            return Err(Error::operation("Sequence contains more than one matching element"));
        }
    }
    Ok(found)
}

fn gather(structure: &Structure, names: &[String]) -> Result<Needed> {
    let mut needed = Needed::default();
    for name in names {
        let effect = find_effect(structure, name)?
            .ok_or_else(|| Error::broken(format!("YPT own effect rule does not exist: {name}")))?;
        if !needed.effects.contains(&effect) {
            needed.effects.push(effect);
        }
        for event in raw_events(structure, effect)? {
            if let Some(emitter) = structure.pointer(event + EVENT_EMITTER) {
                needed.emitters.insert(emitter);
            }
            let Some(particle) = structure.pointer(event + EVENT_PARTICLE) else {
                continue;
            };
            needed.particles.insert(particle);
            let drawables = structure.list(particle + PARTICLE_DRAWABLES)?;
            if let Some(array) = drawables.array {
                let draws = (0..drawables.count)
                    .any(|k| structure.pointer(array + k * DRAWABLE_STRIDE + DRAWABLE_MODEL).is_some());
                if draws {
                    return Err(Error::broken(format!(
                        "YPT own effect {name} draws models; only sprite effects can be carried."
                    )));
                }
            }
            // Клон из чужого словаря порождаемых эффектов не берёт — такой донор не собрать.
            let spawned = PARTICLE_SPAWNERS
                .iter()
                .find_map(|&spawner| structure.pointer(particle + spawner + SPAWNER_EFFECT));
            if let Some(spawned) = spawned {
                let label = structure.name_of(Kind::Effect, spawned).unwrap_or_default();
                return Err(Error::broken(format!(
                    "YPT own effect {name} spawns effect {label}; only self-contained effects can be carried."
                )));
            }
            for variable in structure.objects(structure.list(particle + PARTICLE_VARS)?) {
                if structure.u8(variable + VAR_KIND)? != VAR_KIND_TEXTURE {
                    continue;
                }
                if let Some(texture) = structure.pointer(variable + VAR_TEXTURE) {
                    needed.textures.insert(texture);
                }
            }
        }
    }
    Ok(needed)
}

/// Где в графической области лежат пиксели листов: смещения блоков.
fn pixel_blocks(structure: &Structure, textures: &[usize]) -> Result<HashSet<usize>> {
    let mut found = HashSet::new();
    for &texture in textures {
        let word = structure.u64(texture + TEXTURE_PIXELS)?;
        if word >= GRAPHICS_BASE {
            found.insert(usize::try_from(word - GRAPHICS_BASE).unwrap_or(usize::MAX));
        }
    }
    Ok(found)
}

/// Графика донора: пиксели листов автора остаются, у листов игры блоки остаются той же длины, но нулевыми (раскладку
/// читает клон, пикселей Rockstar в донор не идёт). Остальное — геометрия моделей, которые остаются в корне ядра, — из
/// файла уходит: слова на неё обнуляются, и блоки отбрасываются сборкой. Клон из чужого словаря моделей не берёт, а их
/// вершины тянули бы в файл мегабайты чужих данных; у помощника в файле их тоже нет.
fn blank_graphics(structure: &mut Structure, own: &[usize], game: &[usize]) -> Result<()> {
    let keep = pixel_blocks(structure, own)?;
    let blank = pixel_blocks(structure, game)?;
    let graph = structure.graph_mut();
    let spans: Vec<(usize, usize)> = graph
        .segment_blocks(Segment::Graphics)
        .iter()
        .map(|&index| (graph.blocks[index].start, graph.blocks[index].end))
        .filter(|(start, _)| blank.contains(start))
        .collect();
    for (start, end) in spans {
        if let Some(span) = graph.graphics.get_mut(start..end) {
            span.fill(0);
        }
    }
    let mut cleared: Vec<(Segment, usize)> = Vec::new();
    for block in graph.blocks.iter_mut() {
        let (segment, start) = (block.segment, block.start);
        block.slots.retain(|slot| {
            let hit = slot.target.segment == Segment::Graphics
                && !keep.contains(&slot.target.offset)
                && !blank.contains(&slot.target.offset);
            if hit {
                cleared.push((segment, start + slot.relative));
            }
            !hit
        });
    }
    for (segment, at) in cleared {
        let area = match segment {
            Segment::System => &mut graph.system,
            Segment::Graphics => &mut graph.graphics,
        };
        if let Some(word) = area.get_mut(at..at + 8) {
            word.fill(0);
        }
    }
    Ok(())
}

/// Слова, которые вели на описания убранных листов (параметры шейдеров моделей, остающихся в корне), обнуляются: убранные
/// листы уходят из файла вместе со своими пикселями, как у помощника, чей файл несёт только листы словаря.
fn detach_textures(structure: &mut Structure, removed: &HashSet<usize>) {
    let graph = structure.graph_mut();
    let mut cleared: Vec<(Segment, usize)> = Vec::new();
    for block in graph.blocks.iter_mut() {
        let (segment, start) = (block.segment, block.start);
        block.slots.retain(|slot| {
            let hit = slot.target.segment == Segment::System && removed.contains(&slot.target.offset);
            if hit {
                cleared.push((segment, start + slot.relative));
            }
            !hit
        });
    }
    for (segment, at) in cleared {
        let area = match segment {
            Segment::System => &mut graph.system,
            Segment::Graphics => &mut graph.graphics,
        };
        if let Some(word) = area.get_mut(at..at + 8) {
            word.fill(0);
        }
    }
}

/// Режет образ до названных правил (правка по месту; файл собирает вызывающий).
pub fn carve(structure: &mut Structure, names: &[String], own_textures: &[String]) -> Result<Report> {
    if names.is_empty() || names.len() > MAX_RULES {
        return Err(Error::broken("YPT own donor needs 1\u{2026}64 effect rules."));
    }
    let needed = gather(structure, names)?;
    let effects: HashSet<usize> = needed.effects.iter().copied().collect();

    // Три словаря правил: сначала все собираются (отказ первого по порядку), потом записываются.
    let keep_effects = kept(structure, Kind::Effect, "effect", &effects)?;
    let keep_emitters = kept(structure, Kind::Emitter, "emitter", &needed.emitters)?;
    let keep_particles = kept(structure, Kind::Particle, "particle", &needed.particles)?;
    structure.write_entries(Kind::Effect, &keep_effects)?;
    structure.write_entries(Kind::Emitter, &keep_emitters)?;
    structure.write_entries(Kind::Particle, &keep_particles)?;

    // Листы: только те, что рисуют оставшиеся частицы, в порядке словаря, по хешу.
    let every_texture = structure.entries(Kind::Texture)?;
    let mut keep_textures: Vec<Entry> = every_texture
        .iter()
        .copied()
        .filter(|entry| entry.object.is_some_and(|object| needed.textures.contains(&object)))
        .collect();
    keep_textures.sort_by_key(|entry| entry.hash);
    let removed: HashSet<usize> = every_texture
        .iter()
        .filter_map(|entry| entry.object)
        .filter(|object| !needed.textures.contains(object))
        .collect();
    let mut own = Vec::new();
    let mut own_objects = Vec::new();
    let mut game_objects = Vec::new();
    let mut game = Vec::new();
    for entry in &keep_textures {
        let Some(object) = entry.object else { continue };
        let name = structure.name_of(Kind::Texture, object).unwrap_or_default();
        let is_own = own_textures
            .iter()
            .any(|candidate| cmp_ordinal_ignore_case(candidate, &name) == std::cmp::Ordering::Equal);
        if is_own {
            own.push(name);
            own_objects.push(object);
        } else {
            game.push(name);
            game_objects.push(object);
        }
    }
    structure.write_entries(Kind::Texture, &keep_textures)?;
    detach_textures(structure, &removed);
    blank_graphics(structure, &own_objects, &game_objects)?;

    let names_of = |objects: &[usize]| -> Vec<String> {
        sorted(
            objects
                .iter()
                .map(|&effect| structure.name_of(Kind::Effect, effect).unwrap_or_default())
                .collect(),
        )
    };
    Ok(Report {
        effects: names_of(&needed.effects),
        emitters: needed.emitters.len(),
        particles: needed.particles.len(),
        own_textures: sorted(own),
        game_textures: sorted(game),
    })
}

/// Из файла ядра автора — файл словаря-донора и отчёт о нём. Файл перечитывается: правила на месте, ссылки внутри
/// словарей (отказы — тексты помощника).
pub fn build(file: &[u8], names: &[String], own_textures: &[String]) -> Result<(Vec<u8>, Report)> {
    let mut structure = super::object_image::open(file)?;
    let report = carve(&mut structure, names, own_textures)?;
    let bytes = structure.into_file()?;
    let reread = Image::parse(&bytes)?;
    vanilla::verify_graph(&reread, None, &mut BTreeSet::new())?;
    Ok((bytes, report))
}

#[cfg(test)]
mod tests;
