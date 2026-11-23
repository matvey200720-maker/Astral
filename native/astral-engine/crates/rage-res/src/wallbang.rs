//! База «прострелов»: для каждой модели-объекта новые архетипы в файле типов, а для
//! каждой сущности исходной карты, что ссылается на исходный архетип объекта, —
//! сущность нового архетипа с теми же идентификатором, положением, поворотом,
//! дальностью и флагами. Меняется только архетип.
//!
//! Запись форматов делает `placements::compile_copied`; здесь — чтение рамки модели
//! из `.ydr` и подбор исходных архетипов и сущностей.

use crate::{
    error::{Error, Result},
    placements::{
        compile_copied, ArchetypeFields, ArchetypeSpec, Compiled, EntitySpec, SourceEntity,
    },
    resource::Resource,
    ymap_write::meta_name,
    ytyp_write::{BaseArchetype, TypesFile},
};
use std::collections::HashMap;

/// Где в распакованных данных модели лежат нижний и верхний углы рамки.
const CORNER_AT: [usize; 2] = [0x30, 0x40];

#[derive(Debug, Clone, PartialEq)]
pub struct Object {
    /// Имя нового архетипа.
    pub asset: String,
    /// Имя исходного архетипа в файле типов и в исходной карте.
    pub source: String,
    pub min: [f32; 3],
    pub max: [f32; 3],
}

/// Угол рамки: три f32 подряд с позиции `at`.
fn corner_at(data: &[u8], at: usize) -> [f32; 3] {
    std::array::from_fn(|axis| {
        let start = at + axis * 4;
        let word: [u8; 4] = data[start..start + 4].try_into().unwrap_or_default();
        f32::from_le_bytes(word)
    })
}

/// Нижний и верхний углы рамки модели из корня `.ydr`.
pub fn model_box(model: &[u8]) -> Result<([f32; 3], [f32; 3])> {
    let resource = Resource::parse(model)?;
    let data = resource.data();
    if data.len() < CORNER_AT[1] + 12 {
        return Err(Error::broken("Модель прострела без рамки."));
    }
    let [min, max] = CORNER_AT.map(|at| corner_at(&data, at));
    if !box_is_sound(min, max) {
        return Err(Error::broken("Модель прострела с неверной рамкой."));
    }
    Ok((min, max))
}

/// Углы конечны, и нижний нигде не выше верхнего.
fn box_is_sound(min: [f32; 3], max: [f32; 3]) -> bool {
    (0..3).all(|axis| min[axis].is_finite() && max[axis].is_finite() && min[axis] <= max[axis])
}

/// Из одноимённых записей берётся последняя с настоящей сферой, иначе последняя.
fn donor_of(types: &TypesFile, hash: u32) -> Option<&BaseArchetype> {
    let named = || types.archetypes.iter().filter(|a| a.name == hash);
    named()
        .rfind(|a| a.bs_radius > 0.0)
        .or_else(|| named().next_back())
}

fn ensure(holds: bool, complaint: impl FnOnce() -> String) -> Result<()> {
    holds
        .then_some(())
        .ok_or_else(|| Error::argument(complaint()))
}

/// Архетип выхода и его добавочные поля: имя ассета, общая дальность, рамка объекта,
/// флаги и прочее — от исходной записи.
fn derive_archetype(
    object: &Object,
    lod_dist: f32,
    donor: &BaseArchetype,
) -> (ArchetypeSpec, ArchetypeFields) {
    let (bb_min, bb_max) = (object.min, object.max);
    let spec = ArchetypeSpec {
        name: object.asset.clone(),
        lod_dist,
        bb_min,
        bb_max,
        flags: donor.flags,
        clip_dictionary: None,
    };
    let extra = ArchetypeFields {
        hd_texture_dist: donor.hd_texture_dist,
        special_attribute: donor.special_attribute,
        texture_dictionary: None,
        time_flags: None,
    };
    (spec, extra)
}

/// Копия сущности исходной карты, поставленная на новый архетип.
fn copy_entity(owner: usize, source: &SourceEntity) -> EntitySpec {
    EntitySpec {
        archetype: owner,
        guid: Some(source.id),
        position: source.position,
        rotation: source.rotation,
        lod_dist: source.lod_dist,
        flags: source.flags,
    }
}

type Planned = (
    Vec<ArchetypeSpec>,
    Vec<ArchetypeFields>,
    HashMap<u32, usize>,
);

/// Первый проход: к каждому объекту ищется исходный архетип, а хеш исходного имени
/// запоминается за первым объектом, который его назвал.
fn plan_archetypes(objects: &[Object], types: &TypesFile, lod_distance: f32) -> Result<Planned> {
    let mut owner_of: HashMap<u32, usize> = HashMap::new();
    let (mut archetypes, mut fields) = (Vec::new(), Vec::new());
    for (index, object) in objects.iter().enumerate() {
        let hash = meta_name(&object.source);
        let Some(donor) = donor_of(types, hash) else {
            return Err(Error::argument(format!(
                "Исходный файл типов не содержит архетип {}.",
                object.source
            )));
        };
        owner_of.entry(hash).or_insert(index);
        let (spec, extra) = derive_archetype(object, lod_distance, donor);
        archetypes.push(spec);
        fields.push(extra);
    }
    Ok((archetypes, fields, owner_of))
}

/// Второй проход: сущности карты по таблице владельцев; чужие пропускаются молча.
/// Вторым значением идёт, сколько сущностей поставил каждый объект.
fn copy_entities(
    map: &[SourceEntity],
    owner_of: &HashMap<u32, usize>,
    objects: usize,
) -> Result<(Vec<EntitySpec>, Vec<usize>)> {
    let mut served = vec![0usize; objects];
    let mut entities = Vec::new();
    for source in map {
        let Some(&owner) = owner_of.get(&source.archetype) else {
            continue;
        };
        let unscaled = [source.scale_xy, source.scale_z].iter().all(|&s| s == 1.0);
        ensure(unscaled, || {
            "Масштаб сущности в карте прострела: пока на хосте.".to_string()
        })?;
        served[owner] += 1;
        entities.push(copy_entity(owner, source));
    }
    Ok((entities, served))
}

#[allow(clippy::too_many_arguments)]
pub fn build(
    types_name: &str,
    map_name: &str,
    lod_distance: f32,
    objects: &[Object],
    types: &TypesFile,
    map: &[SourceEntity],
    exported_by: &str,
    time: &str,
) -> Result<Compiled> {
    let (archetypes, fields, owner_of) = plan_archetypes(objects, types, lod_distance)?;
    let (entities, served) = copy_entities(map, &owner_of, objects.len())?;

    let idle: Vec<&str> = objects
        .iter()
        .zip(&served)
        .filter(|&(_, &count)| count == 0)
        .map(|(object, _)| object.asset.as_str())
        .collect();
    ensure(idle.is_empty(), || {
        format!("Карта прострела не ставит: {}.", idle.join(", "))
    })?;

    // Рамка и дальность идут в файл как есть: NaN, бесконечность и перевёрнутая рамка
    // дали бы сферу и радиус NaN, поэтому проверяются здесь, а не только у вызывающего.
    ensure(lod_distance.is_finite() && lod_distance >= 0.0, || {
        "Дальность прострела должна быть конечным числом не меньше нуля.".to_string()
    })?;
    let unsound = objects.iter().find(|o| !box_is_sound(o.min, o.max));
    if let Some(object) = unsound {
        return Err(Error::argument(format!(
            "Рамка объекта {} неверная: углы должны быть конечными, нижний не выше верхнего.",
            object.asset
        )));
    }
    compile_copied(
        types_name,
        map_name,
        &archetypes,
        &fields,
        &entities,
        exported_by,
        time,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{deflate_zlib9, RSC7_MAGIC};
    use crate::ytyp_write::read_base_types;

    fn archetype(name: &str, radius: f32, flags: u32) -> BaseArchetype {
        let mut a = BaseArchetype::with_defaults(name, name);
        a.bs_radius = radius;
        a.flags = flags;
        a
    }

    /// Файл типов из списка «имя, радиус сферы, флаги».
    fn types_of(list: &[(&str, f32, u32)]) -> TypesFile {
        let archetypes = list
            .iter()
            .map(|&(name, radius, flags)| archetype(name, radius, flags))
            .collect();
        TypesFile {
            name_hash: 0,
            archetypes,
        }
    }

    fn entity(name: &str, id: u32, scale: f32) -> SourceEntity {
        SourceEntity {
            archetype: meta_name(name),
            id,
            position: [1.0, 2.0, 3.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            lod_dist: 100.0,
            flags: 32,
            scale_xy: scale,
            scale_z: 1.0,
        }
    }

    fn object(asset: &str, source: &str) -> Object {
        Object {
            asset: asset.into(),
            source: source.into(),
            min: [-1.0; 3],
            max: [1.0; 3],
        }
    }

    fn made(objects: &[Object], types: &TypesFile, map: &[SourceEntity]) -> Result<Compiled> {
        build(
            "astral_types",
            "astral_map",
            300.0,
            objects,
            types,
            map,
            "x",
            "y",
        )
    }

    #[test]
    fn source_archetype_prefers_the_last_real_sphere() {
        let types = types_of(&[
            ("progmat_6", 0.0, 1),
            ("progmat_6", 2.0, 2),
            ("progmat_6", 3.0, 3),
            ("progmat_7", 0.0, 4),
        ]);
        let map = [entity("progmat_6", 1, 1.0), entity("progmat_7", 2, 1.0)];
        let objects = [object("wb_6", "progmat_6"), object("wb_7", "progmat_7")];
        let built = made(&objects, &types, &map).unwrap();
        let written = read_base_types(&built.types).unwrap();
        let flags: Vec<u32> = written.archetypes.iter().map(|a| a.flags).collect();
        assert_eq!(flags, [3, 4]);
        let missing = made(&[object("wb_m", "missing")], &types, &map).unwrap_err();
        assert_eq!(
            missing.to_string(),
            "Исходный файл типов не содержит архетип missing."
        );
    }

    #[test]
    fn a_source_entity_with_scale_is_refused() {
        let types = types_of(&[("pl_crate", 1.0, 0)]);
        let scaled = [entity("pl_crate", 7, 2.0)];
        let err = made(&[object("astral_crate", "pl_crate")], &types, &scaled).unwrap_err();
        assert!(err.to_string().contains("пока на хосте"));
    }

    #[test]
    fn objects_without_entities_are_named_by_asset() {
        let types = types_of(&[("pl_a", 1.0, 0), ("pl_b", 1.0, 0)]);
        let objects = [
            object("wb_a", "pl_a"),
            object("wb_b", "pl_b"),
            object("wb_c", "pl_a"),
        ];
        let err = made(&objects, &types, &[entity("pl_a", 1, 1.0)]).unwrap_err();
        assert_eq!(err.to_string(), "Карта прострела не ставит: wb_b, wb_c.");
        // чужая сущность молча пропускается, а масштаб проверяется только у своих
        let mixed = [entity("pl_a", 1, 1.0), entity("pl_x", 2, 5.0)];
        assert!(made(&objects[..1], &types, &mixed).is_ok());
    }

    #[test]
    fn a_broken_box_or_distance_is_refused_before_anything_is_written() {
        let types = types_of(&[("pl_crate", 1.0, 0)]);
        let map = [entity("pl_crate", 7, 1.0)];
        let boxed = |min: [f32; 3], max: [f32; 3]| Object {
            asset: "wb_crate".into(),
            source: "pl_crate".into(),
            min,
            max,
        };
        let wrong_box =
            "Рамка объекта wb_crate неверная: углы должны быть конечными, нижний не выше верхнего.";
        let wrong_distance = "Дальность прострела должна быть конечным числом не меньше нуля.";
        let at_distance = |distance: f32| {
            let crate_object = [object("wb_crate", "pl_crate")];
            build(
                "astral_types",
                "astral_map",
                distance,
                &crate_object,
                &types,
                &map,
                "x",
                "y",
            )
        };

        let boxes = [
            ([f32::NAN, 0.0, 0.0], [1.0; 3]),
            ([0.0; 3], [1.0, f32::NAN, 1.0]),
            ([0.0; 3], [f32::INFINITY, 1.0, 1.0]),
            ([f32::NEG_INFINITY, 0.0, 0.0], [1.0; 3]),
            ([3.0, 0.0, 0.0], [2.0, 1.0, 1.0]),
            ([0.0, 0.0, 5.0], [1.0, 1.0, -5.0]),
        ];
        for (min, max) in boxes {
            let err = made(&[boxed(min, max)], &types, &map).unwrap_err();
            assert_eq!(err.to_string(), wrong_box, "{min:?} {max:?}");
        }
        // плоская рамка и рамка в одной точке остаются допустимыми
        assert!(made(&[boxed([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])], &types, &map).is_ok());

        for distance in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -1.0] {
            let refusal = at_distance(distance).unwrap_err();
            assert_eq!(refusal.to_string(), wrong_distance, "{distance}");
        }
        assert!(at_distance(0.0).is_ok());

        // прежние отказы не перекрываются новыми: нет исходного архетипа — об этом и сказано
        let pair = [boxed([f32::NAN; 3], [1.0; 3]), object("wb_m", "missing")];
        let missing = made(&pair, &types, &map).unwrap_err();
        assert_eq!(
            missing.to_string(),
            "Исходный файл типов не содержит архетип missing."
        );
    }

    fn model(len: usize, min: [f32; 3], max: [f32; 3]) -> Vec<u8> {
        let mut data = vec![0u8; len];
        for (at, corner) in CORNER_AT.into_iter().zip([min, max]) {
            for (axis, v) in corner.iter().enumerate() {
                if at + axis * 4 + 4 <= len {
                    data[at + axis * 4..at + axis * 4 + 4].copy_from_slice(&v.to_le_bytes());
                }
            }
        }
        let mut file = Vec::new();
        for word in [RSC7_MAGIC, 165, 0x0800_0000, 0] {
            file.extend_from_slice(&word.to_le_bytes());
        }
        file.extend(deflate_zlib9(&data));
        file
    }

    #[test]
    fn model_box_reads_the_corners_and_refuses_bad_ones() {
        let ok = model(512, [-2.0, -3.0, 0.0], [2.0, 3.0, 4.0]);
        assert_eq!(
            model_box(&ok).unwrap(),
            ([-2.0, -3.0, 0.0], [2.0, 3.0, 4.0])
        );
        let flat = model(512, [1.0, 2.0, 3.0], [1.0, 2.0, 3.0]);
        assert!(model_box(&flat).is_ok());
        let wrong_box = "Модель прострела с неверной рамкой.";
        let bad_boxes = [
            model(512, [3.0, 0.0, 0.0], [2.0, 1.0, 1.0]),
            model(512, [f32::NAN, 0.0, 0.0], [1.0; 3]),
        ];
        for file in bad_boxes {
            assert_eq!(model_box(&file).unwrap_err().to_string(), wrong_box);
        }
        let short = model(0x4b, [0.0; 3], [1.0; 3]);
        assert_eq!(
            model_box(&short).unwrap_err().to_string(),
            "Модель прострела без рамки."
        );
        assert!(model_box(&[1, 2, 3]).is_err());
    }
}
