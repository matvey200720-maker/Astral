//! Правка готового мода меток залазов: файл типов `.ytyp` и карта `.ymap`.
//!
//! Рамки архетипов меток растут до рамки плашки, в конец типов добавляются копии
//! «только лицом», места карты убираются или переходят на копию. Оба файла
//! пересобирает писатель `placements` из прочитанных полей, поэтому до записи
//! сверяются все архетипы и все места: поле, которого писатель не переносит,
//! отклоняет мод текстом «пока на хосте».

use std::{fmt::Display, ops::Range};

use crate::{
    error::{Error, Result},
    meta_graph::{self, Graph, Node, POINTER_BLOCK},
    placements::{
        compile_archetype_types_keeping, compile_map_header_carried, entity_bytes_carried, ArchetypeFields, ArchetypeSpec,
        CarGenerators, EntitySpec, LodLink, MapHeader, PlaceCarry, Sphere,
    },
    ymap_write::meta_name,
    ytyp_write::{read_base_types, BaseArchetype},
};

/// Размеры и смещения формата.
mod layout {
    pub const ARCHETYPE: usize = 144;
    pub const PLACE: usize = 128;
    pub const DRAWABLE_ASSET: i32 = 2;
    pub const ARCHETYPE_STRUCT: &str = "CBaseArchetypeDef";
    pub const MAP_STRUCT: &str = "CMapData";
    /// Корень карты: не короче и ссылка на массив мест.
    pub const MAP_ROOT_LEN: usize = 108;
    pub const MAP_PLACES_LINK: usize = 96;
    /// Поле корня карты `carGenerators`: указатель, число и ёмкость (число — на 8 байт дальше).
    pub const MAP_CARS_LINK: usize = 240;
    pub const CAR_STRUCT: &str = "CCarGen";
    /// Байты архетипа, которые у расширенной метки перерисовывает писатель (рамка и сфера).
    pub const REDRAWN: std::ops::Range<usize> = 32..96;
}

/// Тексты отказов; `{}` — место для имени или номера.
mod words {
    pub const COLLIDES: &str = "Climb marker copy {} collides with an archetype of the types.";
    pub const NO_SOURCE: &str = "Climb marker copy {} has no source archetype in the types.";
    pub const OTHER_MAP_NAME: &str = "Climb map {}.ymap has another name.";
    pub const RENAME_RANGE: &str = "Climb placement {} is renamed but out of range or removed.";
    pub const RENAME_TWICE: &str = "Climb placement {} is renamed twice.";
    pub const NOT_A_MARKER: &str = "Climb placement {} is not a marker of this request.";
    pub const UNKNOWN_COPY: &str = "Climb placement {} is renamed to an unknown copy.";
    pub const OTHER_MARKER: &str = "Climb placement {} is renamed to a copy of another marker.";

    pub const MARKER_WITHOUT_ARCHETYPE: &str = "Every climb marker needs its own archetype in the types.";
    pub const READ_PARTLY: &str = "Типы мода читаются не полностью.";
    pub const LOST_ARCHETYPE: &str = "Compiled climb types lost an archetype.";
    pub const ARCHETYPE_SIZE: &str = "Архетип мода другого размера: пока на хосте.";
    pub const ARCHETYPE_FIELDS: &str = "Поля архетипа мода, которых мы не переносим: пока на хосте.";
    pub const ARCHETYPE_ODD: &str = "Архетип мода с полями, которых мы не переносим: пока на хосте.";
    pub const BOX_NOT_FINITE: &str = "Рамка {} с бесконечностью или NaN.";
    pub const NOT_BASE: &str = "Архетип мода не базовый: пока на хосте.";
    pub const NO_ARCHETYPE_NODE: &str = "Архетип без узла.";
    pub const NOT_A_MAP: &str = "Источник не файл карты.";
    pub const NO_PLACES: &str = "В карте мода нет мест.";
    pub const PLACE_WITHOUT_NODE: &str = "Место карты мода без узла.";
    pub const PLACE_SHORT: &str = "Место карты мода короче записи.";
    pub const PLACE_WITHOUT_ARCHETYPE: &str = "Место карты мода без архетипа в типах мода.";
    pub const PLACE_FIELDS: &str = "Место мода с полями, которых мы не переносим: пока на хосте.";
    pub const REMOVE_BAD: &str = "Места для удаления вне расстановки или повторяются.";
    pub const MAP_EMPTY: &str = "Расстановка мода не может стать пустой: пока на хосте.";
    pub const CAR_GENERATORS: &str = "Генераторы машин карты мода в раскладке, которую мы не переносим: пока на хосте.";
    pub const MAP_SECTIONS: &str = "В карте мода есть разделы, которых мы не переносим: пока на хосте.";
}

/// Малые расчёты над рамками и именами.
mod shape {
    /// Имя-литерал хеша для писателя: `#` и 8 шестнадцатеричных знаков.
    pub fn literal_of(hash: u32) -> String {
        format!("#{hash:08x}")
    }

    /// Все три числа конечны (не NaN и не бесконечность).
    pub fn finite3(v: [f32; 3]) -> bool {
        v.iter().all(|x| x.is_finite())
    }

    /// Покомпонентное сочетание двух троек.
    pub fn zip3(a: [f32; 3], b: [f32; 3], pick: fn(f32, f32) -> f32) -> [f32; 3] {
        [0, 1, 2].map(|i| pick(a[i], b[i]))
    }

}

/// Отказ с подстановкой имени или номера в шаблон.
fn refuse(template: &str, subject: impl Display) -> Error {
    Error::argument(template.replacen("{}", &subject.to_string(), 1))
}

/// Отказать, если `failed`.
fn deny(failed: bool, refusal: impl FnOnce() -> Error) -> Result<()> {
    if failed {
        Err(refusal())
    } else {
        Ok(())
    }
}

/// Правило отказа: условие (считается лениво) и то, чем отвечать.
struct Rule<'a> {
    fails: &'a dyn Fn() -> bool,
    refusal: &'a dyn Fn() -> Error,
}

/// Первое сработавшее правило отказывает; порядок правил — порядок проверок.
fn first_refusal(rules: &[Rule]) -> Result<()> {
    rules
        .iter()
        .find(|rule| (rule.fails)())
        .map_or(Ok(()), |rule| Err((rule.refusal)()))
}

/// Чтение чисел little-endian из байт узла.
struct View<'a>(&'a [u8]);

impl View<'_> {
    fn u32(&self, at: usize) -> u32 {
        u32::from_le_bytes(self.0[at..at + 4].try_into().expect("четыре байта"))
    }

    fn f32(&self, at: usize) -> f32 {
        f32::from_bits(self.u32(at))
    }

    fn f32s<const N: usize>(&self, at: usize) -> [f32; N] {
        std::array::from_fn(|i| self.f32(at + i * 4))
    }
}

// ------------------------------------------------------------ узлы графа

/// Цели ссылок узла по порядку; пустая ссылка — `None`.
fn members<'g>(graph: &'g Graph, node: &'g Node) -> impl Iterator<Item = Option<&'g Node>> + 'g {
    node.links.iter().map(move |link| link.target.map(|id| &graph.nodes[id]))
}

/// Узлы базовых архетипов файла по порядку: члены массива указателей, который
/// держит корень и в котором есть базовый архетип. Нет такого массива — архетипов нет.
fn archetype_nodes(graph: &Graph) -> Result<Vec<&Node>> {
    let base = meta_name(layout::ARCHETYPE_STRUCT);
    let holds_base = |node: &&Node| {
        node.block == POINTER_BLOCK && members(graph, node).flatten().any(|member| member.block == base)
    };
    members(graph, &graph.nodes[graph.root])
        .flatten()
        .find(holds_base)
        .map_or_else(
            || Ok(Vec::new()),
            |list| {
                members(graph, list)
                    .map(|member| match member {
                        None => Err(Error::broken(words::NO_ARCHETYPE_NODE)),
                        Some(node) if node.block != base => Err(Error::argument(words::NOT_BASE)),
                        Some(node) => Ok(node),
                    })
                    .collect()
            },
        )
}

/// Цель ссылки узла, лежащей по смещению `at` в его байтах.
fn link_at(node: &Node, at: usize) -> Option<usize> {
    node.links.iter().find(|link| link.at == at)?.target
}

// ------------------------------------------------------------ типы

/// Плашка метки: имя модели (оно же имя архетипа в моде) и рамка в системе модели.
#[derive(Debug, Clone, PartialEq)]
pub struct MarkerBox {
    pub model: String,
    pub min: [f32; 3],
    pub max: [f32; 3],
}

/// Архетип исходного файла, готовый к записи писателем.
struct Carried {
    spec: ArchetypeSpec,
    fields: ArchetypeFields,
    /// Рамка выросла по плашке запроса (сфера пересчитана, байты 32–95 не сверяются).
    widened: bool,
    /// Сфера исходного файла для архетипа, которого запрос не трогает: хост переносит её как есть, а не считает по рамке.
    sphere: Option<Sphere>,
}

fn carry_over(arch: &BaseArchetype, boxes: &[MarkerBox]) -> Result<Carried> {
    deny(
        arch.asset_name != arch.name
            || arch.drawable_dictionary != 0
            || arch.physics_dictionary != 0
            || arch.asset_type != layout::DRAWABLE_ASSET,
        || Error::argument(words::ARCHETYPE_ODD),
    )?;
    let plate = boxes.iter().find(|b| meta_name(&b.model) == arch.name);
    let (bb_min, bb_max) = match plate {
        Some(b) => {
            let widened = (shape::zip3(arch.bb_min, b.min, f32::min), shape::zip3(arch.bb_max, b.max, f32::max));
            // NaN рамки min/max молча отбрасывают, а бесконечность дала бы NaN в центре и радиусе сферы.
            let finite = [b.min, b.max, widened.0, widened.1].into_iter().all(shape::finite3);
            deny(!finite, || refuse(words::BOX_NOT_FINITE, &b.model))?;
            widened
        }
        None => (arch.bb_min, arch.bb_max),
    };
    Ok(Carried {
        spec: ArchetypeSpec {
            name: shape::literal_of(arch.name),
            lod_dist: arch.lod_dist,
            bb_min,
            bb_max,
            flags: arch.flags,
            clip_dictionary: (arch.clip_dictionary != 0).then(|| shape::literal_of(arch.clip_dictionary)),
        },
        fields: ArchetypeFields {
            special_attribute: arch.special_attribute,
            hd_texture_dist: arch.hd_texture_dist,
            texture_dictionary: Some(arch.texture_dictionary),
            time_flags: None,
        },
        widened: plate.is_some(),
        sphere: plate.is_none().then_some((arch.bs_centre, arch.bs_radius)),
    })
}

/// Копия «только лицом»: своё имя, метка-источник и рамка квада копии.
#[derive(Debug, Clone, PartialEq)]
pub struct CopyBox {
    pub model: String,
    pub source: String,
    pub min: [f32; 3],
    pub max: [f32; 3],
}

/// Копия берёт всё у уже расширенного источника, кроме имени, рамки и своего словаря текстур.
fn copy_of(copy: &CopyBox, originals: &[BaseArchetype], carried: &[Carried]) -> Result<(ArchetypeSpec, ArchetypeFields)> {
    let own = meta_name(&copy.model);
    deny(originals.iter().any(|a| a.name == own), || refuse(words::COLLIDES, &copy.model))?;
    let wanted = meta_name(&copy.source);
    let at = originals
        .iter()
        .position(|a| a.name == wanted)
        .ok_or_else(|| refuse(words::NO_SOURCE, &copy.model))?;
    let (source, base) = (&carried[at], &originals[at]);
    let (bb_min, bb_max) = (
        shape::zip3(source.spec.bb_min, copy.min, f32::min),
        shape::zip3(source.spec.bb_max, copy.max, f32::max),
    );
    let finite = [copy.min, copy.max, bb_min, bb_max].into_iter().all(shape::finite3);
    deny(!finite, || refuse(words::BOX_NOT_FINITE, &copy.model))?;
    let spec = ArchetypeSpec { name: shape::literal_of(own), bb_min, bb_max, ..source.spec.clone() };
    let textures = if base.texture_dictionary == base.name { own } else { base.texture_dictionary };
    Ok((spec, ArchetypeFields { texture_dictionary: Some(textures), ..source.fields }))
}

/// Побайтная сверка собранных типов с исходными: писатель не должен терять чужие поля.
fn audit_types(before: &[&Node], carried: &[Carried], rebuilt: &[u8]) -> Result<()> {
    let parsed = meta_graph::read(rebuilt)?;
    let after = archetype_nodes(&parsed.graph)?;
    deny(after.len() < before.len(), || Error::broken(words::LOST_ARCHETYPE))?;
    before.iter().zip(&after).zip(carried).try_for_each(|((old, new), c)| {
        deny(old.bytes.len() != layout::ARCHETYPE || new.bytes.len() != layout::ARCHETYPE, || {
            Error::argument(words::ARCHETYPE_SIZE)
        })?;
        let differs = |span: Range<usize>| old.bytes[span.clone()] != new.bytes[span];
        let changed = if c.widened {
            differs(0..layout::REDRAWN.start) || differs(layout::REDRAWN.end..layout::ARCHETYPE)
        } else {
            differs(0..layout::ARCHETYPE)
        };
        deny(changed, || Error::argument(words::ARCHETYPE_FIELDS))
    })
}

/// Собранные типы и то, что нужно карте: исходные архетипы и итоговый список спек.
struct RebuiltTypes {
    bytes: Vec<u8>,
    originals: Vec<BaseArchetype>,
    specs: Vec<ArchetypeSpec>,
}

fn rebuild_types(types_name: &str, source: &[u8], edits: &Edits) -> Result<RebuiltTypes> {
    let originals = read_base_types(source)?.archetypes;
    let parsed = meta_graph::read(source)?;
    let source_nodes = archetype_nodes(&parsed.graph)?;
    deny(source_nodes.len() != originals.len(), || Error::broken(words::READ_PARTLY))?;

    let carried = originals
        .iter()
        .map(|arch| carry_over(arch, edits.boxes))
        .collect::<Result<Vec<_>>>()?;
    let widened = carried.iter().filter(|c| c.widened).count();
    deny(widened != edits.boxes.len(), || Error::argument(words::MARKER_WITHOUT_ARCHETYPE))?;
    let copies = edits
        .copies
        .iter()
        .map(|copy| copy_of(copy, &originals, &carried))
        .collect::<Result<Vec<_>>>()?;

    let own = carried.iter().map(|c| (c.spec.clone(), c.fields));
    let (specs, fields): (Vec<_>, Vec<_>) = own.chain(copies).unzip();
    // Копии получают сферу по своей рамке; прочие архетипы — свою из исходного файла.
    let spheres: Vec<Option<Sphere>> = carried.iter().map(|c| c.sphere).chain(edits.copies.iter().map(|_| None)).collect();
    let bytes = compile_archetype_types_keeping(types_name, &specs, &fields, &spheres)?;
    audit_types(&source_nodes, &carried, &bytes)?;
    Ok(RebuiltTypes { bytes, originals, specs })
}

// ------------------------------------------------------------ карта

/// Место карты (индекс до удаления), которое переходит на копию с этим именем.
#[derive(Debug, Clone, PartialEq)]
pub struct Rename {
    pub index: usize,
    pub copy: String,
}

/// Отсортированные индексы удаляемых мест; повтор или выход за карту — отказ.
fn removal_set(remove: &[usize], places: usize) -> Result<Vec<usize>> {
    let mut sorted = remove.to_vec();
    sorted.sort_unstable();
    let repeated = sorted.windows(2).any(|pair| pair[0] == pair[1]);
    deny(repeated || sorted.last().is_some_and(|&last| last >= places), || Error::argument(words::REMOVE_BAD))?;
    Ok(sorted)
}

fn check_renames(renames: &[Rename], places: usize, removed: &[usize]) -> Result<()> {
    renames.iter().enumerate().try_for_each(|(n, rename)| {
        let index = rename.index;
        first_refusal(&[
            Rule {
                fails: &move || index >= places || removed.binary_search(&index).is_ok(),
                refusal: &move || refuse(words::RENAME_RANGE, index),
            },
            Rule {
                fails: &move || renames[..n].iter().any(|earlier| earlier.index == index),
                refusal: &move || refuse(words::RENAME_TWICE, index),
            },
        ])
    })
}

/// Место карты, как оно уйдёт в сборку: сущность, связь с LOD и поля, которые писатель переносит из исходной карты.
struct Place {
    entity: EntitySpec,
    link: LodLink,
    carry: PlaceCarry,
}

/// Всё, что нужно, чтобы разобрать места карты.
struct MapJob<'a> {
    map_name: &'a str,
    edits: &'a Edits<'a>,
    types: &'a RebuiltTypes,
    removed: Vec<usize>,
}

impl MapJob<'_> {
    /// Судьба одного места: `None` — место убрано, иначе оно (возможно, на копии) и его связь.
    fn judge(&self, i: usize, node: &Node) -> Result<Option<Place>> {
        deny(node.bytes.len() < layout::PLACE, || Error::broken(words::PLACE_SHORT))?;
        let cells = View(&node.bytes);
        let arch_hash = cells.u32(8);
        let originals = &self.types.originals;
        // Место с архетипом, которого нет в типах мода (у `climbs.ymap` два таких: чужой штатный архетип), хост переносит как есть:
        // писателю даётся хеш архетипа места, а номер в списке — любой (хеш перекроет его).
        let known = originals.iter().position(|a| a.name == arch_hash);
        let foreign = known.is_none().then_some(arch_hash);
        deny(known.is_none() && originals.is_empty(), || Error::argument(words::PLACE_WITHOUT_ARCHETYPE))?;
        let arch_index = known.unwrap_or(0);
        let mut entity = EntitySpec {
            archetype: arch_index,
            position: cells.f32s(32),
            rotation: cells.f32s(48),
            lod_dist: cells.f32(76),
            flags: cells.u32(12),
            guid: Some(cells.u32(16)),
        };
        let link = LodLink {
            parent_index: cells.u32(72) as i32,
            lod_level: cells.u32(84),
            num_children: cells.u32(88),
            child_lod_dist: cells.f32(80),
        };
        // Поля, которых писатель с нуля не знает, хост переносит как есть: масштаб места, приоритет, затенение, оттенок
        // (у `climbs.ymap` масштаб не единица у 931 места из 1393, приоритет — у части мест).
        let carry = PlaceCarry {
            scale: [cells.f32(64), cells.f32(68)],
            archetype: foreign,
            priority: cells.u32(92),
            ao_multiplier: cells.u32(112),
            ao_artificial: cells.u32(116),
            tint: cells.u32(120),
        };
        // Писатель обязан воспроизвести запись места байт в байт.
        let rebuilt = entity_bytes_carried(self.map_name, i, &self.types.specs[arch_index], &entity, &link, &carry);
        deny(rebuilt[..] != node.bytes[..layout::PLACE], || Error::argument(words::PLACE_FIELDS))?;

        if self.removed.binary_search(&i).is_ok() {
            let is_marker = self.edits.boxes.iter().any(|b| meta_name(&b.model) == arch_hash);
            deny(!is_marker, || refuse(words::NOT_A_MARKER, i))?;
            return Ok(None);
        }
        if let Some(rename) = self.edits.renames.iter().find(|r| r.index == i) {
            let copies = self.edits.copies;
            let copy_at = copies.iter().position(|c| c.model == rename.copy);
            first_refusal(&[
                Rule { fails: &|| copy_at.is_none(), refusal: &|| refuse(words::UNKNOWN_COPY, i) },
                Rule {
                    fails: &|| copy_at.is_some_and(|at| meta_name(&copies[at].source) != arch_hash),
                    refusal: &|| refuse(words::OTHER_MARKER, i),
                },
            ])?;
            // Копии стоят в списке архетипов сразу за исходными.
            if let Some(at) = copy_at {
                entity.archetype = originals.len() + at;
            }
        }
        Ok(Some(Place { entity, link, carry }))
    }
}

/// Генераторы машин исходной карты (`CCarGen`): хост сохраняет их при правке, и писатель несёт их теми же байтами. Раскладка проверяется:
/// один массив структур, на который ссылается поле `carGenerators` корня, а число записей в корне сходится с длиной массива. Любое иное
/// расположение — «пока на хосте», а не тихая потеря записей (у настоящего `resources/climbs/climbs.ymap` одна запись).
fn read_car_generators(parsed: &meta_graph::Read) -> Result<Option<CarGenerators>> {
    let graph = &parsed.graph;
    let block = meta_name(layout::CAR_STRUCT);
    let arrays: Vec<usize> = graph.nodes.iter().enumerate().filter(|(_, node)| node.block == block).map(|(id, _)| id).collect();
    let root = &graph.nodes[graph.root];
    let held = link_at(root, layout::MAP_CARS_LINK);
    let Some(&only) = arrays.first() else {
        return deny(held.is_some(), || Error::argument(words::CAR_GENERATORS)).map(|()| None);
    };
    let def = parsed.schema.struct_named(block).ok_or_else(|| Error::argument(words::CAR_GENERATORS))?;
    let width = def.size as usize;
    let count = usize::from(u16::from_le_bytes([root.bytes[layout::MAP_CARS_LINK + 8], root.bytes[layout::MAP_CARS_LINK + 9]]));
    let bytes = &graph.nodes[only].bytes;
    let fits = arrays.len() == 1 && held == Some(only) && width > 0 && count > 0 && bytes.len() == count * width;
    deny(!fits, || Error::argument(words::CAR_GENERATORS))?;
    Ok(Some(CarGenerators { def: def.clone(), bytes: bytes.clone() }))
}

/// Сборка карты из мест исходного файла. Писатель несёт места, заголовок и генераторы машин; остальные разделы корня (контейнеры LOD,
/// окклюдеры, словари физики, свет, зоны времени) он не строит, и карта с ними — «пока на хосте», а не молчаливая потеря.
fn rebuild_places(
    map_name: &str,
    source: &[u8],
    edits: &Edits,
    types: &RebuiltTypes,
    exported_by: &str,
    time: &str,
) -> Result<Vec<u8>> {
    let parsed = meta_graph::read(source)?;
    let graph = &parsed.graph;
    let root = &graph.nodes[graph.root];
    let head = View(&root.bytes);
    first_refusal(&[
        Rule {
            fails: &|| root.block != meta_name(layout::MAP_STRUCT) || root.bytes.len() < layout::MAP_ROOT_LEN,
            refusal: &|| Error::argument(words::NOT_A_MAP),
        },
        Rule {
            fails: &|| head.u32(8) != meta_name(map_name),
            refusal: &|| refuse(words::OTHER_MAP_NAME, map_name),
        },
    ])?;
    let header = MapHeader {
        parent: head.u32(12),
        map_flags: head.u32(16),
        content_flags: head.u32(20),
        streaming: (head.f32s(32), head.f32s(48)),
        entities_extents: (head.f32s(64), head.f32s(80)),
    };

    let strangers = root.links.iter().any(|link| link.target.is_some() && ![layout::MAP_PLACES_LINK, layout::MAP_CARS_LINK].contains(&link.at));
    deny(strangers, || Error::argument(words::MAP_SECTIONS))?;
    let cars = read_car_generators(&parsed)?;

    let list = link_at(root, layout::MAP_PLACES_LINK).ok_or_else(|| Error::argument(words::NO_PLACES))?;
    let places = members(graph, &graph.nodes[list])
        .map(|place| place.ok_or_else(|| Error::broken(words::PLACE_WITHOUT_NODE)))
        .collect::<Result<Vec<_>>>()?;

    let removed = removal_set(edits.remove, places.len())?;
    check_renames(edits.renames, places.len(), &removed)?;

    let job = MapJob { map_name, edits, types, removed };
    let survivors = places
        .iter()
        .enumerate()
        .filter_map(|(i, node)| job.judge(i, node).transpose())
        .collect::<Result<Vec<_>>>()?;
    deny(survivors.is_empty(), || Error::argument(words::MAP_EMPTY))?;
    let entities: Vec<EntitySpec> = survivors.iter().map(|place| place.entity.clone()).collect();
    let links: Vec<LodLink> = survivors.iter().map(|place| place.link).collect();
    let carries: Vec<PlaceCarry> = survivors.iter().map(|place| place.carry).collect();
    compile_map_header_carried(map_name, &types.specs, &entities, &links, &carries, cars.as_ref(), &header, exported_by, time)
}

// ------------------------------------------------------------ вход

#[derive(Debug, Clone, Copy)]
pub struct Edits<'a> {
    pub boxes: &'a [MarkerBox],
    pub copies: &'a [CopyBox],
    pub renames: &'a [Rename],
    pub remove: &'a [usize],
}

#[derive(Debug, Clone, PartialEq)]
pub struct Compiled {
    pub types: Vec<u8>,
    pub map: Vec<u8>,
}

/// Правит мод и собирает оба файла заново; все проверки типов идут раньше карты.
pub fn compile(
    types_name: &str,
    map_name: &str,
    types_source: &[u8],
    map_source: &[u8],
    edits: &Edits,
    exported_by: &str,
    time: &str,
) -> Result<Compiled> {
    let types = rebuild_types(types_name, types_source, edits)?;
    let map = rebuild_places(map_name, map_source, edits, &types, exported_by, time)?;
    Ok(Compiled { types: types.bytes, map })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::Resource;

    const TYPES: &[u8] = include_bytes!("../../../parity/host-port/climb/mod3-types.ytyp");
    const MAP: &[u8] = include_bytes!("../../../parity/host-port/climb/mod3-map.ymap");
    const HOST_TYPES: &[u8] = include_bytes!("../../../parity/host-port/climb/mod3-host-types.ytyp");
    const HOST_MAP: &[u8] = include_bytes!("../../../parity/host-port/climb/mod3-host-map.ymap");
    /// Настоящий мод, который приложение отдаёт сборщику: `resources/climbs` (десять меток и четыре чужих архетипа).
    const REAL_TYPES: &[u8] = include_bytes!("../../../../../resources/climbs/climbs.ytyp");
    const REAL_MAP: &[u8] = include_bytes!("../../../../../resources/climbs/climbs.ymap");
    const REAL_MARKERS: [&str; 10] = ["arrow", "stay", "jump", "firstpov", "thirdpov", "rightclick", "car", "teamneed", "hit", "q"];

    fn plate(model: &str, min: [f32; 3], max: [f32; 3]) -> MarkerBox {
        MarkerBox { model: model.to_string(), min, max }
    }

    fn three_plates() -> Vec<MarkerBox> {
        vec![
            plate("climb_a", [-0.5, -0.25, -0.1], [0.5, 0.25, 0.1]),
            plate("climb_b", [-0.5, -0.1, -0.25], [0.5, 0.1, 0.25]),
            plate("climb_c", [-0.25, -0.1, -0.5], [0.25, 0.1, 0.5]),
        ]
    }

    fn run(boxes: &[MarkerBox], copies: &[CopyBox], renames: &[Rename], remove: &[usize]) -> Result<Compiled> {
        let edits = Edits { boxes, copies, renames, remove };
        compile("climb_types", "climb_map", TYPES, MAP, &edits, "Astral Climbs 3", "01 January 1970 00:00")
    }

    fn body(file: &[u8]) -> Vec<u8> {
        Resource::parse(file).unwrap().data().to_vec()
    }

    #[test]
    fn the_three_marker_mod_matches_the_host_after_a_removal() {
        let built = run(&three_plates(), &[], &[], &[1]).unwrap();
        assert_eq!(body(&built.types), body(HOST_TYPES));
        assert_eq!(body(&built.map), body(HOST_MAP));
    }

    /// Сборка по настоящему моду приложения (16.11.2026): в `resources/climbs/climbs.ytyp` четыре архетипа вне запроса хранят сферу, не равную
    /// пересчёту по рамке (хост переносит её как есть). Прежняя сверка «сфера по рамке» отказывала такой мод целиком: путь Rust не брал ни одного
    /// настоящего запроса. Теперь они едут своими байтами, а сфера расширенных меток считается по новой рамке.
    #[test]
    fn the_real_mod_keeps_the_sphere_of_archetypes_the_request_does_not_touch() {
        let before = read_base_types(REAL_TYPES).unwrap().archetypes;
        let plated: Vec<u32> = REAL_MARKERS.iter().map(|name| meta_name(name)).collect();
        assert!(plated.iter().all(|hash| before.iter().any(|a| a.name == *hash)), "десять меток есть в типах мода");
        let boxes: Vec<MarkerBox> = REAL_MARKERS
            .iter()
            .map(|name| {
                let arch = before.iter().find(|a| a.name == meta_name(name)).unwrap();
                MarkerBox { model: (*name).to_string(), min: arch.bb_min.map(|v| v - 0.01), max: arch.bb_max.map(|v| v + 0.01) }
            })
            .collect();
        let edits = Edits { boxes: &boxes, copies: &[], renames: &[], remove: &[] };
        let types = rebuild_types("climbs", REAL_TYPES, &edits).unwrap();
        let after = read_base_types(&types.bytes).unwrap().archetypes;
        assert_eq!(after.len(), before.len());
        let mut untouched = 0;
        for (old, new) in before.iter().zip(&after) {
            if plated.contains(&old.name) {
                let (centre, radius) = {
                    let centre = [0, 1, 2].map(|i| (new.bb_min[i] + new.bb_max[i]) * 0.5);
                    let [dx, dy, dz] = [0, 1, 2].map(|i| (new.bb_max[i] - centre[i]).powi(2));
                    (centre, (dx + dy + dz).sqrt())
                };
                assert_eq!((new.bs_centre, new.bs_radius), (centre, radius), "сфера расширенной метки по новой рамке");
            } else {
                untouched += 1;
                assert_eq!((new.bs_centre, new.bs_radius), (old.bs_centre, old.bs_radius), "сфера чужого архетипа как в файле");
                assert_eq!((new.bb_min, new.bb_max), (old.bb_min, old.bb_max));
            }
        }
        assert_eq!(untouched, before.len() - REAL_MARKERS.len());

        // Места настоящей карты (1393, у 931 масштаб не единица, у двух чужой архетип, часть с приоритетом) едут теми же байтами записи.
        let places = |file: &[u8]| -> Vec<Vec<u8>> {
            let graph = meta_graph::read(file).unwrap().graph;
            let block = meta_name("CEntityDef");
            graph.nodes.iter().filter(|node| node.block == block).map(|node| node.bytes[..layout::PLACE].to_vec()).collect()
        };
        let map = rebuild_places("climbs", REAL_MAP, &edits, &types, "Astral Climbs", "01 January 1970 00:00").unwrap();
        let (was, now) = (places(REAL_MAP), places(&map));
        assert_eq!(was.len(), 1393);
        assert_eq!(now.len(), was.len());
        assert!(was.iter().zip(&now).all(|(old, new)| old == new), "записи мест как в исходной карте мода");
    }

    /// Правки настоящего запроса приложения, макет «по умолчанию» (стенд 18.11.2026): двенадцать мест переходят на копии «только лицом»,
    /// четыре убраны. Выход хоста на этих правках лежит в `real-default-host-map.ymap`.
    const DEFAULT_RENAMES: [(usize, &str); 12] = [
        (77, "firstpov_astral_front"),
        (80, "firstpov_astral_front"),
        (96, "firstpov_astral_front"),
        (110, "firstpov_astral_front"),
        (140, "firstpov_astral_front"),
        (215, "firstpov_astral_front"),
        (713, "jump_astral_front"),
        (760, "jump_astral_front"),
        (764, "jump_astral_front"),
        (783, "jump_astral_front"),
        (813, "jump_astral_front"),
        (1051, "stay_astral_front"),
    ];
    const DEFAULT_REMOVED: [usize; 4] = [172, 354, 356, 368];
    const HOST_REAL_MAP: &[u8] = include_bytes!("../../../parity/host-port/climb/real-default-host-map.ymap");

    /// Типы и карта настоящего мода с правками запроса «по умолчанию».
    fn compile_real_default() -> Result<Compiled> {
        let before = read_base_types(REAL_TYPES).unwrap().archetypes;
        let boxes: Vec<MarkerBox> = REAL_MARKERS
            .iter()
            .map(|name| {
                let arch = before.iter().find(|a| a.name == meta_name(name)).unwrap();
                MarkerBox { model: (*name).to_string(), min: arch.bb_min.map(|v| v - 0.01), max: arch.bb_max.map(|v| v + 0.01) }
            })
            .collect();
        let copies: Vec<CopyBox> = [("firstpov_astral_front", "firstpov"), ("jump_astral_front", "jump"), ("stay_astral_front", "stay")]
            .iter()
            .map(|(model, source)| CopyBox { model: (*model).to_string(), source: (*source).to_string(), min: [-0.5; 3], max: [0.5; 3] })
            .collect();
        let renames: Vec<Rename> = DEFAULT_RENAMES.iter().map(|(index, copy)| Rename { index: *index, copy: (*copy).to_string() }).collect();
        let edits = Edits { boxes: &boxes, copies: &copies, renames: &renames, remove: &DEFAULT_REMOVED };
        compile("climbs", "climbs", REAL_TYPES, REAL_MAP, &edits, "Astral Climbs 3", "01 January 1970 00:00")
    }

    /// Записи узлов блока `name` в файле, по порядку.
    fn nodes_of(file: &[u8], name: &str) -> Vec<Vec<u8>> {
        let graph = meta_graph::read(file).unwrap().graph;
        let block = meta_name(name);
        graph.nodes.iter().filter(|node| node.block == block).map(|node| node.bytes.clone()).collect()
    }

    /// У настоящей карты мода есть генератор машин (`CCarGen`, 80 байт): хост сохраняет его, и писатель карты обязан нести его так же,
    /// а не терять и не отдавать хосту весь мод (до 18.11.2026 оба настоящих запроса залазов уходили хосту).
    #[test]
    fn the_real_map_keeps_its_car_generator() {
        let built = compile_real_default().expect("карта с генератором машин собирается движком");
        let (was, now) = (nodes_of(REAL_MAP, "CCarGen"), nodes_of(&built.map, "CCarGen"));
        assert_eq!(was.len(), 1, "в исходной карте один генератор машин");
        assert_eq!(now, was, "запись генератора машин — те же 80 байт");
        let graph = meta_graph::read(&built.map).unwrap();
        let root = &graph.graph.nodes[graph.graph.root];
        assert_eq!(u16::from_le_bytes([root.bytes[248], root.bytes[249]]), 1, "число генераторов в корне карты");
        assert_eq!(u16::from_le_bytes([root.bytes[250], root.bytes[251]]), 1, "ёмкость массива генераторов");
        assert!(root.links.iter().any(|link| link.at == 240 && link.target.is_some()), "корень карты ссылается на массив генераторов");
        assert!(graph.schema.struct_named(meta_name("CCarGen")).is_some(), "описание CCarGen есть в схеме файла");
    }

    /// Карта после правок запроса «по умолчанию» (1389 мест и генератор машин) — тот же граф, что у хоста: схема файла, строки, узлы и ссылки.
    /// Побайтно тело не сравнивается: у большого файла хост раскладывает страницы иначе (несколько страниц против одной степени двойки), на
    /// маленьких образцах (`the_three_marker_mod_matches_the_host_after_a_removal`) тело совпадает до байта.
    #[test]
    fn the_real_map_after_the_default_edits_matches_the_host() {
        let built = compile_real_default().expect("карта собирается");
        let (ours, host) = (meta_graph::read(&built.map).unwrap(), meta_graph::read(HOST_REAL_MAP).unwrap());
        assert_eq!(ours.schema, host.schema, "схема файла: те же структуры в том же порядке");
        assert_eq!(ours.strings(), host.strings(), "строки таблицы");
        assert_eq!(ours.graph.nodes.len(), host.graph.nodes.len(), "число узлов");
        let (a, b) = (meta_graph::canonical(&ours.graph, ours.graph.root), meta_graph::canonical(&host.graph, host.graph.root));
        assert!(a == b, "узлы и ссылки карты как у хоста");
    }

    /// Писатель карты несёт места, заголовок и генераторы машин. Остальные разделы корня (здесь — словарь физики) он не строил бы, и карта с
    /// ним уходит хосту, а не теряет раздел молча.
    #[test]
    fn a_map_with_a_section_the_writer_does_not_carry_goes_to_the_host() {
        use crate::meta_graph::{Link, Node};
        const PHYSICS_DICTIONARIES: usize = 160;
        let read = meta_graph::read(REAL_MAP).unwrap();
        let mut graph = read.graph.clone();
        let root = graph.root;
        let dictionary = graph.push(Node { block: 7, bytes: 0x1234_5678u32.to_le_bytes().to_vec(), links: Vec::new() });
        graph.nodes[root].links.push(Link { at: PHYSICS_DICTIONARIES, target: Some(dictionary) });
        graph.nodes[root].bytes[PHYSICS_DICTIONARIES + 8..PHYSICS_DICTIONARIES + 12].copy_from_slice(&0x0001_0001u32.to_le_bytes());
        let source = meta_graph::write(&read.schema, &graph).unwrap();
        let edits = Edits { boxes: &[], copies: &[], renames: &[], remove: &[] };
        let refusal = compile("climbs", "climbs", REAL_TYPES, &source, &edits, "Astral Climbs", "01 January 1970 00:00");
        assert_eq!(refusal.map(|_| ()).unwrap_err().message, words::MAP_SECTIONS);
    }

    #[test]
    fn a_mark_without_its_archetype_is_refused() {
        let mut boxes = three_plates();
        boxes.push(plate("climb_z", [0.0; 3], [1.0; 3]));
        let err = run(&boxes, &[], &[], &[]).unwrap_err();
        assert_eq!(err.message, "Every climb marker needs its own archetype in the types.");
    }

    #[test]
    fn a_box_with_infinity_or_nan_is_refused_by_the_name_of_its_model() {
        for bad in [f32::INFINITY, f32::NEG_INFINITY, f32::NAN] {
            let mut boxes = three_plates();
            boxes[1].max[2] = bad;
            let err = run(&boxes, &[], &[], &[]).unwrap_err();
            assert_eq!(err.message, "Рамка climb_b с бесконечностью или NaN.", "{bad}");
            let mut boxes = three_plates();
            boxes[2].min[0] = bad;
            let err = run(&boxes, &[], &[], &[]).unwrap_err();
            assert_eq!(err.message, "Рамка climb_c с бесконечностью или NaN.", "{bad}");
            let copy = CopyBox { model: "climb_d".into(), source: "climb_a".into(), min: [0.0; 3], max: [1.0, bad, 1.0] };
            let err = run(&three_plates(), &[copy], &[], &[]).unwrap_err();
            assert_eq!(err.message, "Рамка climb_d с бесконечностью или NaN.", "{bad}");
        }
    }

    #[test]
    fn bad_copies_are_refused() {
        let copy = |model: &str, source: &str| CopyBox {
            model: model.to_string(),
            source: source.to_string(),
            min: [0.0; 3],
            max: [1.0; 3],
        };
        let missing = run(&three_plates(), &[copy("climb_d", "climb_zz")], &[], &[]).unwrap_err();
        assert_eq!(missing.message, "Climb marker copy climb_d has no source archetype in the types.");
        let taken = run(&three_plates(), &[copy("climb_a", "climb_b")], &[], &[]).unwrap_err();
        assert_eq!(taken.message, "Climb marker copy climb_a collides with an archetype of the types.");
    }

    #[test]
    fn removal_and_rename_requests_are_checked_before_the_places() {
        let boxes = three_plates();
        let repeated = run(&boxes, &[], &[], &[1, 1]).unwrap_err();
        assert_eq!(repeated.message, "Места для удаления вне расстановки или повторяются.");
        let rename = |index: usize| Rename { index, copy: "x".to_string() };
        let gone = run(&boxes, &[], &[rename(1)], &[1]).unwrap_err();
        assert_eq!(gone.message, "Climb placement 1 is renamed but out of range or removed.");
        let twice = run(&boxes, &[], &[rename(0), rename(0)], &[]).unwrap_err();
        assert_eq!(twice.message, "Climb placement 0 is renamed twice.");
    }
}
