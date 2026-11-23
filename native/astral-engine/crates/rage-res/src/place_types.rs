//! Постоянные типы места: копии готовых архетипов под новыми именами в новом `.ytyp`.
//!
//! Образцы читает `meta_graph`; копия повторяет поддерево образца целиком, у неё переписываются имя, модель и
//! (если заданы) словари. Интерьеры и расширения частиц и взрывов копирует хост, поэтому здесь им отказ.

use std::{collections::HashMap, ops::Range};

use crate::{
    error::{Error, Result},
    meta_graph::{self, Graph, Link, Node, NodeId, Read, Schema, StructDef, POINTER_BLOCK},
    ymap_write::meta_name,
};

/// Открытая запись: `поле => тип`, порядок полей — как в списке.
macro_rules! request_record {
    ([$($derive:ident),+] $name:ident { $($field:ident => $kind:ty),+ $(,)? }) => {
        #[derive($($derive),+)]
        pub struct $name {
            $(pub $field: $kind),+
        }
    };
}

request_record!([Debug, Clone, PartialEq] CloneSpec {
    source => usize,
    archetype_hash => u32,
    name => String,
    asset_name => String,
    texture_dictionary => Option<String>,
    drawable_dictionary => Option<String>,
});

request_record!([Debug, Clone, PartialEq] Compiled {
    bytes => Vec<u8>,
    archetypes => usize,
    physics => usize,
});

const UNDESCRIBED: &str = "Тип архетипа не описан в файле: пока на хосте.";
const OUTSIDE_NODE: &str = "Поле вне узла метаданных.";
const ROOT_BLOCK: &str = "CMapTypes";
const MLO_BLOCK: &str = "CMloArchetypeDef";
const EFFECT_BLOCKS: [&str; 2] = [
    "CExtensionDefParticleEffect",
    "CExtensionDefExplosionEffect",
];
/// За указателем массива идут два u16: число и ёмкость.
const COUNT_AT: usize = 8;
const CAPACITY_AT: usize = 10;

/// Где лежит поле шириной `len` байт со смещением `at`; `None`, если счёт переполняется.
fn span(at: usize, len: usize) -> Option<Range<usize>> {
    Some(at..at.checked_add(len)?)
}

fn offset_of(def: &StructDef, field: &str) -> Option<usize> {
    let entry = def.field(meta_name(field))?;
    Some(entry.offset as usize)
}

fn require_offset(def: &StructDef, field: &str) -> Result<usize> {
    offset_of(def, field).ok_or_else(|| Error::argument(format!("В типе нет поля {field}.")))
}

fn read_u32(bytes: &[u8], at: usize) -> Result<u32> {
    let word = span(at, 4).and_then(|range| bytes.get(range));
    match word {
        Some(raw) => Ok(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]])),
        None => Err(Error::broken(OUTSIDE_NODE)),
    }
}

fn write_bytes(bytes: &mut [u8], at: usize, value: &[u8]) -> Result<()> {
    match span(at, value.len()).and_then(|range| bytes.get_mut(range)) {
        Some(slot) => {
            slot.copy_from_slice(value);
            Ok(())
        }
        None => Err(Error::broken(OUTSIDE_NODE)),
    }
}

/// Корень файла типов: блок `CMapTypes`, в схеме у которого есть массив `archetypes`.
fn is_types_file(source: &Read) -> bool {
    let root_name = meta_name(ROOT_BLOCK);
    let root = &source.graph.nodes[source.graph.root];
    let described = source
        .schema
        .struct_named(root_name)
        .is_some_and(|def| offset_of(def, "archetypes").is_some());
    root.block == root_name && described
}

/// Схемы образцов в одну; каждый образец обязан быть файлом типов.
fn merge_sources(sources: &[Read]) -> Result<Schema> {
    if !sources.iter().all(is_types_file) {
        return Err(Error::argument("Источник не файл типов."));
    }
    let mut merged = Schema::default();
    sources
        .iter()
        .for_each(|source| merged.merge(&source.schema));
    Ok(merged)
}

/// Где в корне `CMapTypes` лежат нужные поля.
struct RootLayout {
    name_at: usize,
    archetypes_at: usize,
    size: usize,
}

impl RootLayout {
    fn of(schema: &Schema) -> Result<Self> {
        let Some(def) = schema.struct_named(meta_name(ROOT_BLOCK)) else {
            return Err(Error::argument("В файлах нет описания CMapTypes."));
        };
        let archetypes_at = require_offset(def, "archetypes")?;
        let name_at = require_offset(def, "name")?;
        Ok(Self {
            name_at,
            archetypes_at,
            size: def.size as usize,
        })
    }
}

/// Узлы архетипов файла по порядку массива `archetypes` корня.
fn archetype_nodes(file: &Read) -> Vec<NodeId> {
    let graph = &file.graph;
    let root = &graph.nodes[graph.root];
    let described_at = file
        .schema
        .struct_named(root.block)
        .and_then(|def| offset_of(def, "archetypes"));
    let Some(at) = described_at else {
        return Vec::new();
    };
    let array = root
        .links
        .iter()
        .find(|link| link.at == at)
        .and_then(|link| link.target);
    let mut slots: Vec<(usize, NodeId)> = array
        .into_iter()
        .flat_map(|id| &graph.nodes[id].links)
        .filter_map(|link| Some((link.at, link.target?)))
        .collect();
    slots.sort_by_key(|&(slot_at, _)| slot_at);
    slots.into_iter().map(|(_, target)| target).collect()
}

/// Первый архетип образца с этим именем и описание его блока.
fn find_archetype(source: &Read, wanted: u32) -> Result<(NodeId, &StructDef)> {
    for id in archetype_nodes(source) {
        let node = &source.graph.nodes[id];
        let Some(def) = source.schema.struct_named(node.block) else {
            return Err(Error::argument(UNDESCRIBED));
        };
        let name_at = require_offset(def, "name")?;
        if read_u32(&node.bytes, name_at)? == wanted {
            return Ok((id, def));
        }
    }
    Err(Error::argument("В файле типов нет такого архетипа."))
}

/// Есть ли среди потомков узла (включая его самого) частицы или взрывы.
fn reaches_effects(graph: &Graph, start: NodeId) -> bool {
    let effects = EFFECT_BLOCKS.map(meta_name);
    let mut visited = vec![false; graph.nodes.len()];
    let mut pending = vec![start];
    while let Some(id) = pending.pop() {
        if visited[id] {
            continue;
        }
        visited[id] = true;
        let node = &graph.nodes[id];
        if effects.contains(&node.block) {
            return true;
        }
        let children = node.links.iter().filter_map(|link| link.target);
        pending.extend(children);
    }
    false
}

/// Новые значения полей копии: имя и модель всегда, словари — только непустые.
fn clone_edits(spec: &CloneSpec) -> Vec<(&'static str, u32)> {
    let mut edits = vec![
        ("name", meta_name(&spec.name)),
        ("assetName", meta_name(&spec.asset_name)),
    ];
    for (field, dictionary) in [
        ("textureDictionary", &spec.texture_dictionary),
        ("drawableDictionary", &spec.drawable_dictionary),
    ] {
        match dictionary.as_deref() {
            Some(text) if !text.is_empty() => edits.push((field, meta_name(text))),
            _ => {}
        }
    }
    edits
}

fn reopen_failed() -> Error {
    Error::broken("Compiled place types failed semantic reopen.")
}

/// Значение поля архетипа в перечитанном файле; `None`, если поля нет в описании блока.
fn archetype_field(file: &Read, id: NodeId, field: &str) -> Option<u32> {
    let node = &file.graph.nodes[id];
    let def = file.schema.struct_named(node.block)?;
    let at = offset_of(def, field)?;
    read_u32(&node.bytes, at).ok()
}

/// Проверка одной копии по перечитанному файлу: имя, модель и словарь текстур.
fn check_clone(file: &Read, by_name: &HashMap<u32, NodeId>, spec: &CloneSpec) -> Result<()> {
    let Some(&id) = by_name.get(&meta_name(&spec.name)) else {
        return Err(Error::broken(format!(
            "Compiled place types lost {}.",
            spec.name
        )));
    };
    let model = archetype_field(file, id, "assetName");
    if model != Some(meta_name(&spec.asset_name)) {
        return Err(Error::broken(format!(
            "Compiled place types changed the model of {}.",
            spec.name
        )));
    }
    let wanted = spec.texture_dictionary.as_deref().filter(|t| !t.is_empty());
    if let Some(text) = wanted {
        if archetype_field(file, id, "textureDictionary") != Some(meta_name(text)) {
            return Err(Error::broken(format!(
                "Compiled place types changed the dictionary of {}.",
                spec.name
            )));
        }
    }
    Ok(())
}

/// Перечитывает записанный файл и сверяет его с заказом; возвращает число архетипов с физикой.
fn verify(
    bytes: &[u8],
    layout: &RootLayout,
    types_name: &str,
    clones: &[CloneSpec],
) -> Result<usize> {
    let file = meta_graph::read(bytes)?;
    let root = &file.graph.nodes[file.graph.root];
    if read_u32(&root.bytes, layout.name_at)? != meta_name(types_name) {
        return Err(Error::broken("Compiled place types changed the file name."));
    }
    let nodes = archetype_nodes(&file);
    let declared = read_u32(&root.bytes, layout.archetypes_at + COUNT_AT)? & 0xffff;
    if clones.len() != nodes.len() || clones.len() != declared as usize {
        return Err(reopen_failed());
    }

    // Среди одноимённых архетипов берётся первый.
    let mut by_name: HashMap<u32, NodeId> = HashMap::new();
    for &id in &nodes {
        if let Some(name) = archetype_field(&file, id, "name") {
            by_name.entry(name).or_insert(id);
        }
    }
    clones
        .iter()
        .try_for_each(|spec| check_clone(&file, &by_name, spec))?;
    let physical = |&&id: &&NodeId| {
        archetype_field(&file, id, "physicsDictionary").is_some_and(|hash| hash != 0)
    };
    Ok(nodes.iter().filter(physical).count())
}

/// Копии образцов в общем графе: подчинённые узлы делятся между копиями одного образца.
fn copy_archetypes(
    graph: &mut Graph,
    sources: &[Read],
    clones: &[CloneSpec],
) -> Result<Vec<NodeId>> {
    let mut shared: HashMap<usize, HashMap<NodeId, NodeId>> = HashMap::new();
    let mut copies = Vec::with_capacity(clones.len());
    for spec in clones {
        let Some(source) = sources.get(spec.source) else {
            return Err(Error::argument("Копия ссылается на неизвестный источник."));
        };
        let (original, def) = find_archetype(source, spec.archetype_hash)?;
        if source.graph.nodes[original].block == meta_name(MLO_BLOCK) {
            return Err(Error::argument("Интерьеры не копируются: пока на хосте."));
        }
        if reaches_effects(&source.graph, original) {
            return Err(Error::argument(
                "Расширения частиц и взрывов хост переписывает по своему правилу: пока на хосте.",
            ));
        }
        let memo = shared.entry(spec.source).or_default();
        let copy = meta_graph::copy_node(graph, &source.graph, original, memo);
        for (field, value) in clone_edits(spec) {
            let at = require_offset(def, field)?;
            write_bytes(&mut graph.nodes[copy].bytes, at, &value.to_le_bytes())?;
        }
        copies.push(copy);
    }
    Ok(copies)
}

/// Корень нового файла: имя, число копий и ссылка на массив их указателей.
fn build_root(
    graph: &mut Graph,
    layout: &RootLayout,
    types_name: &str,
    copies: &[NodeId],
) -> Result<Node> {
    let mut root = Node {
        links: Vec::new(),
        bytes: vec![0; layout.size],
        block: meta_name(ROOT_BLOCK),
    };
    let name = meta_name(types_name).to_le_bytes();
    write_bytes(&mut root.bytes, layout.name_at, &name)?;
    // Число и ёмкость — u16: на 65536 копиях значение усекается, и проверка ниже откажет.
    let count = (copies.len() as u16).to_le_bytes();
    write_bytes(&mut root.bytes, layout.archetypes_at + COUNT_AT, &count)?;
    write_bytes(&mut root.bytes, layout.archetypes_at + CAPACITY_AT, &count)?;
    if !copies.is_empty() {
        let slots = copies.iter().enumerate().map(|(slot, &target)| Link {
            target: Some(target),
            at: slot * 8,
        });
        let array = graph.push(Node {
            links: slots.collect(),
            bytes: vec![0; copies.len() * 8],
            block: POINTER_BLOCK,
        });
        root.links.push(Link {
            target: Some(array),
            at: layout.archetypes_at,
        });
    }
    Ok(root)
}

pub fn compile(types_name: &str, sources: &[Read], clones: &[CloneSpec]) -> Result<Compiled> {
    let schema = merge_sources(sources)?;
    let layout = RootLayout::of(&schema)?;

    let mut graph = Graph::default();
    let copies = copy_archetypes(&mut graph, sources, clones)?;
    let root = build_root(&mut graph, &layout, types_name, &copies)?;
    graph.root = graph.push(root);

    let bytes = meta_graph::write(&schema, &graph)?;
    let physics = verify(&bytes, &layout, types_name, clones)?;
    Ok(Compiled {
        physics,
        archetypes: clones.len(),
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use crate::ytyp_write::{base_types, BaseArchetype};

    /// Байты из записи «0x52 2 0 …»: десятичные или с `0x`, разделители любые.
    fn octets(text: &str) -> Vec<u8> {
        text.split(|c: char| c == ',' || c.is_whitespace())
            .filter(|item| !item.is_empty())
            .map(|item| match item.strip_prefix("0x") {
                Some(hex) => u8::from_str_radix(hex, 16).unwrap(),
                None => item.parse().unwrap(),
            })
            .collect()
    }

    fn source_file() -> Vec<u8> {
        let mut archetypes = Vec::new();
        for n in 0..3 {
            let name = format!("src_{n}");
            let mut one = BaseArchetype::with_defaults(&name, &format!("{name}_asset"));
            one.texture_dictionary = meta_name("srctex");
            if n == 1 {
                one.physics_dictionary = meta_name("phys");
            }
            archetypes.push(one);
        }
        base_types(meta_name("src_types"), &archetypes).unwrap()
    }

    fn source() -> Read {
        meta_graph::read(&source_file()).unwrap()
    }

    fn spec(from: usize, name: &str, asset: &str) -> CloneSpec {
        CloneSpec {
            drawable_dictionary: None,
            texture_dictionary: None,
            asset_name: asset.to_owned(),
            name: name.to_owned(),
            archetype_hash: meta_name(&format!("src_{from}")),
            source: 0,
        }
    }

    fn reread(compiled: &Compiled) -> Read {
        meta_graph::read(&compiled.bytes).unwrap()
    }

    /// Поле архетипа с номером `index` перечитанного файла.
    fn field(file: &Read, index: usize, name: &str) -> u32 {
        let node = archetype_nodes(file)[index];
        archetype_field(file, node, name).unwrap()
    }

    fn failure(result: Result<Compiled>) -> (Kind, String) {
        let error = result.unwrap_err();
        (error.kind, error.message)
    }

    #[test]
    fn name_hashes_are_case_sensitive() {
        let table = "copy_a=0x0cd946e1 copy_b_asset=0x03dfa7af srctex=0xd6939475 phys=0x9735db8f
                     out_types=0x1d0c106d newtex=0x7f2bc8f5 newdraw=0x34f3e8b9";
        for pair in table.split_whitespace() {
            let (text, hash) = pair.split_once('=').unwrap();
            let hash = u32::from_str_radix(&hash[2..], 16).unwrap();
            assert_eq!(meta_name(text), hash, "{text}");
        }
    }

    #[test]
    fn copies_of_base_archetypes_reopen_with_their_names() {
        let clones = [
            spec(0, "copy_a", "copy_a"),
            spec(1, "copy_b", "copy_b_asset"),
        ];
        let compiled = compile("out_types", &[source()], &clones).unwrap();
        assert_eq!((compiled.archetypes, compiled.physics), (2, 1));
        let file = reread(&compiled);
        assert_eq!(archetype_nodes(&file).len(), 2);
        let wanted = [
            (0, "name", 0x0cd9_46e1),
            (0, "assetName", 0x0cd9_46e1),
            (0, "textureDictionary", 0xd693_9475),
            (0, "physicsDictionary", 0),
            (1, "name", 0x1f1f_6b6d),
            (1, "assetName", 0x03df_a7af),
            (1, "physicsDictionary", 0x9735_db8f),
        ];
        for (index, name, value) in wanted {
            assert_eq!(field(&file, index, name), value, "{index} {name}");
        }
        let again = compile("out_types", &[source()], &clones).unwrap();
        assert_eq!(again, compiled);
    }

    #[test]
    fn root_fields_of_the_result() {
        let compiled = compile("out_types", &[source()], &[spec(0, "copy_a", "copy_a")]).unwrap();
        let head = octets("0x52 0x53 0x43 0x37 2 0 0 0 4 0 0 8 0 0 0 0x20");
        assert_eq!(&compiled.bytes[..16], head);
        let file = reread(&compiled);
        let root = &file.graph.nodes[file.graph.root];
        assert_eq!(root.bytes.len(), 80);
        assert_eq!(&root.bytes[32..36], &[1, 0, 1, 0]);
        assert_eq!(&root.bytes[40..44], &0x1d0c_106du32.to_le_bytes());
    }

    #[test]
    fn no_clones_still_makes_a_file() {
        let compiled = compile("out_types", &[source()], &[]).unwrap();
        assert_eq!((compiled.archetypes, compiled.physics), (0, 0));
        assert!(archetype_nodes(&reread(&compiled)).is_empty());
        let no_description = "В файлах нет описания CMapTypes.";
        let (kind, text) = failure(compile("out_types", &[], &[]));
        assert_eq!((kind, text.as_str()), (Kind::Argument, no_description));
        let (_, text) = failure(compile("out_types", &[], &[spec(0, "a", "a")]));
        assert_eq!(text, no_description);
    }

    #[test]
    fn dictionaries_replace_only_when_not_empty() {
        let mut one = spec(0, "copy_a", "copy_a");
        one.texture_dictionary = Some("newtex".into());
        one.drawable_dictionary = Some("newdraw".into());
        let file = reread(&compile("out_types", &[source()], &[one.clone()]).unwrap());
        assert_eq!(field(&file, 0, "textureDictionary"), 0x7f2b_c8f5);
        assert_eq!(field(&file, 0, "drawableDictionary"), 0x34f3_e8b9);

        one.texture_dictionary = Some(String::new());
        one.drawable_dictionary = Some(String::new());
        let file = reread(&compile("out_types", &[source()], &[one]).unwrap());
        assert_eq!(field(&file, 0, "textureDictionary"), 0xd693_9475);
        assert_eq!(field(&file, 0, "drawableDictionary"), 0);
    }

    #[test]
    fn empty_names_are_accepted() {
        let archetypes = |types: &str, clone: CloneSpec| {
            compile(types, &[source()], &[clone]).unwrap().archetypes
        };
        assert_eq!(archetypes("out_types", spec(0, "", "")), 1);
        assert_eq!(archetypes("", spec(0, "a", "b")), 1);
    }

    #[test]
    fn bad_requests_name_their_reason() {
        let argument = |text: &str| (Kind::Argument, text.to_owned());
        let elsewhere = CloneSpec {
            source: 5,
            ..spec(0, "a", "a")
        };
        assert_eq!(
            failure(compile("o", &[source()], &[elsewhere])),
            argument("Копия ссылается на неизвестный источник.")
        );
        let missing = CloneSpec {
            archetype_hash: 0xdead_beef,
            ..spec(0, "a", "a")
        };
        assert_eq!(
            failure(compile("o", &[source()], &[missing])),
            argument("В файле типов нет такого архетипа.")
        );
    }

    #[test]
    fn one_sample_twice_and_shared_names() {
        let twice = [spec(0, "a", "a"), spec(0, "b", "b")];
        let compiled = compile("o", &[source()], &twice).unwrap();
        assert_eq!((compiled.archetypes, compiled.physics), (2, 0));
        let sources = [source(), source()];
        let mut other = CloneSpec {
            source: 1,
            ..spec(1, "same", "x")
        };
        let first = spec(0, "same", "y");
        let clashing = compile("o", &sources, &[first.clone(), other.clone()]);
        assert_eq!(
            failure(clashing),
            (
                Kind::Broken,
                "Compiled place types changed the model of same.".to_owned()
            )
        );
        other.asset_name = "y".into();
        let compiled = compile("o", &sources, &[first, other]).unwrap();
        assert_eq!((compiled.archetypes, compiled.physics), (2, 1));
    }

    #[test]
    fn physics_counts_only_the_physical_samples() {
        let clones = [spec(0, "a", "a"), spec(1, "b", "b"), spec(2, "c", "c")];
        let compiled = compile("o", &[source()], &clones).unwrap();
        assert_eq!((compiled.archetypes, compiled.physics), (3, 1));
        let two = [spec(1, "b", "b"), spec(1, "c", "c")];
        let both_physical = compile("o", &[source(), source()], &two).unwrap();
        assert_eq!(both_physical.physics, 2);
    }

    #[test]
    fn foreign_roots_are_refused() {
        let mut broken = source();
        let root = broken.graph.root;
        broken.graph.nodes[root].block = meta_name("CNotTypes");
        let message = (Kind::Argument, "Источник не файл типов.".to_owned());
        assert_eq!(failure(compile("o", &[broken.clone()], &[])), message);
        assert_eq!(failure(compile("o", &[source(), broken], &[])), message);
    }

    #[test]
    fn mlo_and_effects_are_left_to_the_host() {
        let host = |text: &str| (Kind::Argument, text.to_owned());
        let original = source();
        let first = archetype_nodes(&original)[0];

        let mut renamed = original.clone();
        renamed.graph.nodes[first].block = meta_name(MLO_BLOCK);
        assert_eq!(
            failure(compile("o", &[renamed], &[spec(0, "a", "a")])),
            host("Тип архетипа не описан в файле: пока на хосте.")
        );

        // Блок MLO описан в схеме: отказ именно за интерьер.
        let mut mlo = original.clone();
        let base = mlo
            .schema
            .struct_named(meta_name("CBaseArchetypeDef"))
            .unwrap()
            .clone();
        let interior = StructDef {
            name: meta_name(MLO_BLOCK),
            key: 1,
            ..base
        };
        mlo.schema.structs.push(interior);
        mlo.graph.nodes[first].block = meta_name(MLO_BLOCK);
        assert_eq!(
            failure(compile("o", &[mlo], &[spec(0, "a", "a")])),
            host("Интерьеры не копируются: пока на хосте.")
        );

        let effect_message =
            "Расширения частиц и взрывов хост переписывает по своему правилу: пока на хосте.";
        for (block, deep) in [
            ("CExtensionDefParticleEffect", false),
            ("CExtensionDefExplosionEffect", true),
        ] {
            let mut file = original.clone();
            let effect = file.graph.push(Node {
                block: meta_name(block),
                bytes: vec![0; 8],
                links: vec![],
            });
            let target = if deep {
                let wrapper = Node {
                    block: 1,
                    bytes: vec![0; 8],
                    links: vec![Link {
                        at: 0,
                        target: Some(effect),
                    }],
                };
                file.graph.push(wrapper)
            } else {
                effect
            };
            file.graph.nodes[first].links.push(Link {
                at: 0,
                target: Some(target),
            });
            let refused = compile("o", &[file.clone()], &[spec(0, "a", "a")]);
            assert_eq!(failure(refused), host(effect_message));
            // Другой архетип того же файла копируется.
            let other = compile("o", &[file], &[spec(1, "a", "a")]).unwrap();
            assert_eq!(other.physics, 1);
        }
    }

    #[test]
    fn self_reference_does_not_loop() {
        let mut looped = source();
        let first = archetype_nodes(&looped)[0];
        looped.graph.nodes[first].links.push(Link {
            at: 0,
            target: Some(first),
        });
        let compiled = compile("o", &[looped], &[spec(0, "a", "a")]).unwrap();
        assert_eq!(compiled.archetypes, 1);
    }

    #[test]
    fn counter_wraps_at_sixty_five_thousand() {
        let many = |n: usize| -> Vec<CloneSpec> {
            (0..n).map(|i| spec(0, &format!("c{i}"), "m")).collect()
        };
        let broken = (
            Kind::Broken,
            "Compiled place types failed semantic reopen.".to_owned(),
        );
        assert_eq!(failure(compile("o", &[source()], &many(65_536))), broken);
        let fine = compile("o", &[source()], &many(300)).unwrap();
        assert_eq!(fine.archetypes, 300);
    }

    #[test]
    fn digest_of_the_sample_source() {
        let bytes = source_file();
        assert_eq!(bytes.len(), 517);
        assert!(sha256_hex(&bytes).starts_with("0510248d330fe8dc"));
        let clones = [
            spec(0, "copy_a", "copy_a"),
            spec(1, "copy_b", "copy_b_asset"),
        ];
        let compiled = compile("out_types", &[source()], &clones).unwrap();
        assert_eq!(compiled.bytes.len(), 475);
        assert!(sha256_hex(&compiled.bytes).starts_with("f84ac2caf19d0e52"));
        let empty = compile("empty", &[source()], &[]).unwrap();
        assert_eq!(empty.bytes.len(), 209);
        assert!(sha256_hex(&empty.bytes).starts_with("34cdb8161d671ae8"));
    }

    /// Файлы типов каталога `PT_DIR`; без переменной проверки пропускаются.
    fn catalog() -> Option<(std::path::PathBuf, Vec<std::path::PathBuf>)> {
        let dir = std::path::PathBuf::from(std::env::var("PT_DIR").ok()?);
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .ok()?
            .filter_map(|entry| Some(entry.ok()?.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "ytyp"))
            .collect();
        files.sort();
        Some((dir, files))
    }

    /// Имя выходного файла для копии архетипа `index` образца `path`.
    fn out_name(path: &std::path::Path, index: usize) -> String {
        format!(
            "{}-{index}.ytyp",
            path.file_stem().unwrap().to_string_lossy()
        )
    }

    /// По копии каждого архетипа образца: интерьеры и частицы дают отказ, остальное собирается.
    fn copy_each(path: &std::path::Path) -> Vec<(usize, Result<Compiled>)> {
        let sources = [meta_graph::read(&std::fs::read(path).unwrap()).unwrap()];
        let nodes = archetype_nodes(&sources[0]);
        let mut results = Vec::new();
        for (index, &node) in nodes.iter().enumerate() {
            let block = sources[0].graph.nodes[node].block;
            let def = sources[0].schema.struct_named(block);
            let name_at = def.and_then(|d| offset_of(d, "name")).unwrap_or(0);
            let hash = read_u32(&sources[0].graph.nodes[node].bytes, name_at).unwrap_or(0);
            let clone = CloneSpec {
                source: 0,
                archetype_hash: hash,
                name: format!("copy_{index}"),
                asset_name: format!("copy_{index}_asset"),
                texture_dictionary: None,
                drawable_dictionary: None,
            };
            results.push((index, compile("out_types", &sources, &[clone])));
        }
        results
    }

    #[test]
    #[ignore = "нужен каталог PT_DIR"]
    fn place_types_write_requests() {
        let Some((dir, files)) = catalog() else {
            return;
        };
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        for path in files {
            for (index, result) in copy_each(&path) {
                if let Ok(done) = result {
                    std::fs::write(out.join(out_name(&path, index)), done.bytes).unwrap();
                }
            }
        }
    }

    #[test]
    #[ignore = "нужен каталог PT_DIR и файлы хоста"]
    fn place_types_compare() {
        let Some((dir, files)) = catalog() else {
            return;
        };
        for path in files {
            for (index, result) in copy_each(&path) {
                let name = out_name(&path, index);
                let Ok(host) = std::fs::read(dir.join("host").join(&name)) else {
                    continue;
                };
                let ours = result.unwrap_or_else(|e| panic!("{name}: {e}"));
                let ours = meta_graph::read(&ours.bytes).unwrap();
                let theirs = meta_graph::read(&host).unwrap();
                assert_eq!(
                    archetype_nodes(&ours).len(),
                    archetype_nodes(&theirs).len(),
                    "{name}"
                );
            }
        }
    }

    #[test]
    #[ignore = "нужен каталог PT_DIR и файлы хоста"]
    fn place_types_host_check() {
        let Some((dir, _)) = catalog() else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(dir.join("host")) else {
            return;
        };
        for entry in entries.filter_map(|entry| entry.ok()) {
            let file = meta_graph::read(&std::fs::read(entry.path()).unwrap()).unwrap();
            let root = &file.graph.nodes[file.graph.root];
            assert_eq!(root.block, meta_name(ROOT_BLOCK));
        }
    }
}
