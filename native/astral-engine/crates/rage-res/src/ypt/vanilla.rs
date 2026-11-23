//! Проверки «ядро осталось ядром» вокруг любой правки структуры: словари, замкнутый граф, опись записей.
//!
//! Помощник прогоняет их, когда запрос меняет не только значения (слоты следа, клоны эффектов, кадры
//! штатных правил): `AssertDictionaries`, `GraphDefects`, `VerifyGraph`, опись записей до и после
//! (`Digest`, `VerifyAfterSave`). Здесь они на образе движка. Опись помощника считает отпечаток каждой
//! записи по её XML-описанию; в движке опись — только по именам (чего нет после записи, что добавилось),
//! а то, что штатные записи не изменились, доказывают сверка читателями и проверка тронутых объектов.
//! Числа в ответе (`vanillaUnchanged`, `intentionallyPatched`, `added`, `purged`, длины словарей)
//! считаются так же, как у помощника.

use std::collections::{BTreeSet, HashSet};

use super::image::{
    Image, DICTIONARY_VALUES, EFFECT_NAME, EMITTER_NAME, PARTICLE_NAME, ROOT_EFFECTS,
    ROOT_EMITTERS, ROOT_PARTICLES, ROOT_TEXTURES, TEXTURE_NAME,
};
use crate::error::{Error, Result};

/// Приставка записей Astral.
pub const ASTRAL_PREFIX: &str = "astral_";
/// Смещение списка хешей имён в словаре.
const DICTIONARY_HASHES: usize = 0x20;
/// Правило эффекта: события; событие: эмиттер и частица.
const EFFECT_EVENTS: usize = 0x38;
const EVENT_EMITTER: usize = 0x40;
const EVENT_PARTICLE: usize = 0x48;
/// Частица: переменные шейдера; переменная-текстура: селектор и указатель на лист.
const SHADER_VARS: usize = 0x1F0;
const SHADER_VAR_KIND: usize = 0x14;
const SHADER_VAR_TEXTURE: u8 = 6;
const SHADER_VAR_TEXTURE_POINTER: usize = 0x28;

const DEFECT_EMITTER: &str = "emitter";
const DEFECT_PARTICLE: &str = "particle";
const DEFECT_TEXTURE: &str = "texture";

fn broken(text: String) -> Error {
    Error::broken(text)
}

/// Чужой хеш имени в словаре: запись перенесена как есть (`nameHashRemarks` ответа).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remark {
    pub dictionary: &'static str,
    pub index: usize,
    pub name: String,
    pub hash: String,
    pub form: &'static str,
}

/// Хеш Дженкинса «по одному разряду» от байтов строки; `fold` — сводить ли латинские A-Z к строчным.
fn joaat(text: &str, fold: bool) -> u32 {
    let mut hash = 0u32;
    for byte in text.bytes() {
        let byte = if fold {
            byte.to_ascii_lowercase()
        } else {
            byte
        };
        hash = hash.wrapping_add(u32::from(byte));
        hash = hash.wrapping_add(hash << 10);
        hash ^= hash >> 6;
    }
    hash = hash.wrapping_add(hash << 3);
    hash ^= hash >> 11;
    hash.wrapping_add(hash << 15)
}

/// Что известно о словаре: ярлык для отказов, поле корня, смещение имени записи.
struct Kind {
    label: &'static str,
    field: usize,
    name_at: usize,
}

const KINDS: [Kind; 4] = [
    Kind {
        label: "effect rule",
        field: ROOT_EFFECTS,
        name_at: EFFECT_NAME,
    },
    Kind {
        label: "emitter rule",
        field: ROOT_EMITTERS,
        name_at: EMITTER_NAME,
    },
    Kind {
        label: "particle rule",
        field: ROOT_PARTICLES,
        name_at: PARTICLE_NAME,
    },
    Kind {
        label: "texture",
        field: ROOT_TEXTURES,
        name_at: TEXTURE_NAME,
    },
];

/// Записи словаря как есть (пустые указатели — `None`) и его хеши по порядку.
fn entries(image: &Image, field: usize) -> Option<(Vec<Option<usize>>, Vec<u32>)> {
    let dictionary = image.pointer(field)?;
    let values = image.list(dictionary + DICTIONARY_VALUES).ok()?;
    let items: Vec<Option<usize>> = match values.array {
        Some(array) => (0..values.count)
            .map(|k| image.pointer(array + k * 8))
            .collect(),
        None => vec![None; values.count],
    };
    let list = image.list(dictionary + DICTIONARY_HASHES).ok()?;
    let hashes = match list.array {
        Some(array) => (0..list.count)
            .filter_map(|k| image.u32(array + k * 4).ok())
            .collect(),
        None => Vec::new(),
    };
    Some((items, hashes))
}

/// Словари отсортированы по хешу имени, у каждой записи есть имя. Хеш чужой записи (ядро из мода) не
/// отказ, а замечание; у записей Astral расхождение — порча.
pub fn assert_dictionaries(image: &Image) -> Result<Vec<Remark>> {
    let mut remarks = Vec::new();
    for kind in &KINDS {
        let label = kind.label;
        let (items, hashes) = entries(image, kind.field)
            .ok_or_else(|| broken(format!("YPT {label} dictionary is missing.")))?;
        if items.len() != hashes.len() {
            return Err(broken(format!(
                "YPT {label} dictionary is inconsistent: {} items, {} hashes.",
                items.len(),
                hashes.len()
            )));
        }
        for (index, item) in items.iter().enumerate() {
            let name = item
                .and_then(|at| image.name(at + kind.name_at))
                .unwrap_or_default();
            if name.is_empty() {
                return Err(broken(format!(
                    "YPT {label} dictionary has a nameless entry at {index}."
                )));
            }
            let hash = hashes[index];
            if joaat(&name.to_lowercase(), false) != hash {
                if name.len() >= ASTRAL_PREFIX.len()
                    && name[..ASTRAL_PREFIX.len()].eq_ignore_ascii_case(ASTRAL_PREFIX)
                {
                    return Err(broken(format!(
                        "YPT {label} dictionary hash does not match its name at {index}: {name}."
                    )));
                }
                let form = if joaat(&name, false) == hash {
                    "case-sensitive"
                } else {
                    "foreign"
                };
                remarks.push(Remark {
                    dictionary: label,
                    index,
                    name,
                    hash: format!("{hash:08x}"),
                    form,
                });
            }
            if index > 0 && hash <= hashes[index - 1] {
                return Err(broken(format!(
                    "YPT {label} dictionary is not sorted by name hash."
                )));
            }
        }
    }
    Ok(remarks)
}

/// Что граф правил ядра ссылается не туда: ключи «вид:имя» (эффект с событием в чужой эмиттер или частицу,
/// частица с чужим листом). Записи Astral в список не попадают.
pub fn graph_defects(image: &Image) -> Result<HashSet<String>> {
    let mut defects = HashSet::new();
    walk(image, &mut |kind, name| {
        if !name.is_empty() && !is_astral(name) {
            defects.insert(format!("{kind}:{name}"));
        }
        Ok(())
    })?;
    Ok(defects)
}

fn is_astral(name: &str) -> bool {
    name.len() >= ASTRAL_PREFIX.len()
        && name[..ASTRAL_PREFIX.len()].eq_ignore_ascii_case(ASTRAL_PREFIX)
}

/// Обход: на каждую ссылку за словарём зовёт `found(вид, имя записи-хозяина)`.
fn walk(image: &Image, found: &mut dyn FnMut(&'static str, &str) -> Result<()>) -> Result<()> {
    let objects = |field: usize| image.dictionary(field).unwrap_or_default();
    let emitters: HashSet<usize> = objects(ROOT_EMITTERS).into_iter().collect();
    let particles: HashSet<usize> = objects(ROOT_PARTICLES).into_iter().collect();
    let textures: HashSet<usize> = objects(ROOT_TEXTURES).into_iter().collect();
    for effect in objects(ROOT_EFFECTS) {
        let name = image.name(effect + EFFECT_NAME).unwrap_or_default();
        for event in image.objects(image.list(effect + EFFECT_EVENTS)?) {
            if let Some(emitter) = image.pointer(event + EVENT_EMITTER) {
                if !emitters.contains(&emitter) {
                    found(DEFECT_EMITTER, &name)?;
                }
            }
            if let Some(particle) = image.pointer(event + EVENT_PARTICLE) {
                if !particles.contains(&particle) {
                    found(DEFECT_PARTICLE, &name)?;
                }
            }
        }
    }
    for particle in objects(ROOT_PARTICLES) {
        let name = image.name(particle + PARTICLE_NAME).unwrap_or_default();
        for variable in image.objects(image.list(particle + SHADER_VARS)?) {
            if image.u8(variable + SHADER_VAR_KIND)? != SHADER_VAR_TEXTURE {
                continue;
            }
            if let Some(texture) = image.pointer(variable + SHADER_VAR_TEXTURE_POINTER) {
                if !textures.contains(&texture) {
                    found(DEFECT_TEXTURE, &name)?;
                }
            }
        }
    }
    Ok(())
}

/// Граф ядра замкнут: события ведут в эмиттеры и частицы словарей, листы частиц — в словарь листов.
/// Допущенное из `tolerated` (дефекты исходного ядра, не записи Astral) попадает в `remarks`.
pub fn verify_graph(
    image: &Image,
    tolerated: Option<&HashSet<String>>,
    remarks: &mut BTreeSet<String>,
) -> Result<()> {
    assert_dictionaries(image)?;
    walk(image, &mut |kind, name| {
        let key = format!("{kind}:{name}");
        if !name.is_empty() && tolerated.is_some_and(|set| set.contains(&key)) {
            remarks.insert(key);
            return Ok(());
        }
        Err(broken(match kind {
            DEFECT_EMITTER => {
                format!("YPT effect {name} points at an emitter rule outside the dictionary.")
            }
            DEFECT_PARTICLE => {
                format!("YPT effect {name} points at a particle rule outside the dictionary.")
            }
            _ => format!("YPT particle rule {name} points at a texture outside the dictionary."),
        }))
    })
}

/// Опись записей ядра по именам: правила эффектов, эмиттеров, частиц и листы, в порядке словарей.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Inventory {
    pub effects: Vec<String>,
    pub emitters: Vec<String>,
    pub particles: Vec<String>,
    pub textures: Vec<String>,
}

impl Inventory {
    /// Ключи «вид:имя» в порядке описи помощника: эффекты, эмиттеры, частицы, листы.
    pub fn keys(&self) -> Vec<String> {
        let kinds = [
            ("effect", &self.effects),
            ("emitter", &self.emitters),
            ("particle", &self.particles),
            ("texture", &self.textures),
        ];
        kinds
            .into_iter()
            .flat_map(|(kind, names)| names.iter().map(move |name| format!("{kind}:{name}")))
            .collect()
    }
}

/// Опись образа. Два ключа с одним видом и именем — отказ, как у помощника.
pub fn inventory(image: &Image) -> Result<Inventory> {
    let names = |kind: &Kind| -> Vec<String> {
        entries(image, kind.field)
            .map(|(items, _)| items)
            .unwrap_or_default()
            .into_iter()
            .map(|item| {
                item.and_then(|at| image.name(at + kind.name_at))
                    .unwrap_or_default()
            })
            .collect()
    };
    let found = Inventory {
        effects: names(&KINDS[0]),
        emitters: names(&KINDS[1]),
        particles: names(&KINDS[2]),
        textures: names(&KINDS[3]),
    };
    let mut seen = HashSet::new();
    for key in found.keys() {
        if !seen.insert(key.clone()) {
            return Err(broken(format!("YPT contains a duplicate {key}.")));
        }
    }
    Ok(found)
}

/// Числа сверки после записи (`slotReservations.verification` ответа помощника).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verification {
    pub vanilla_unchanged: usize,
    pub intentionally_patched: usize,
    pub added: usize,
    pub purged: usize,
    pub effect_rules: usize,
    pub emitter_rules: usize,
    pub particle_rules: usize,
    pub textures: usize,
}

/// Опись до и после. `patched_*` — имена в верхнем регистре (сравнение без учёта регистра), `purged` —
/// ключи, которые установка удалила сама, `expected` — ключи, которые обязаны появиться.
pub fn compare(
    before: &Inventory,
    after: &Inventory,
    patched_textures: &HashSet<String>,
    patched_rules: &HashSet<String>,
    purged: &HashSet<String>,
    expected: &HashSet<String>,
) -> Result<Verification> {
    let have: HashSet<String> = after.keys().into_iter().collect();
    let was: HashSet<String> = before.keys().iter().cloned().collect();
    let (mut unchanged, mut intended) = (0, 0);
    for key in before.keys() {
        if purged.contains(&key) {
            continue;
        }
        if !have.contains(&key) {
            return Err(broken(format!(
                "YPT lost {key} while reserving Astral slots."
            )));
        }
        let (kind, name) = key.split_once(':').unwrap_or((key.as_str(), ""));
        let set = if kind == "texture" {
            patched_textures
        } else {
            patched_rules
        };
        if set.contains(&name.to_uppercase()) {
            intended += 1;
        } else {
            unchanged += 1;
        }
    }
    let added: HashSet<String> = have
        .iter()
        .filter(|key| !was.contains(*key) || purged.contains(*key))
        .cloned()
        .collect();
    if &added != expected {
        let mut odd: Vec<&String> = added
            .difference(expected)
            .chain(expected.difference(&added))
            .collect();
        odd.sort();
        let joined = odd
            .iter()
            .map(|key| key.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(broken(format!(
            "YPT entries changed unexpectedly while reserving Astral slots: {joined}"
        )));
    }
    Ok(Verification {
        vanilla_unchanged: unchanged,
        intentionally_patched: intended,
        added: added.len(),
        purged: purged.iter().filter(|key| !have.contains(*key)).count(),
        effect_rules: after.effects.len(),
        emitter_rules: after.emitters.len(),
        particle_rules: after.particles.len(),
        textures: after.textures.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ypt::fixture;

    fn opened() -> (fixture::Core, Image) {
        let core = fixture::core(true);
        let image = Image::parse(&core.bytes).unwrap();
        (core, image)
    }

    #[test]
    fn the_joaat_matches_the_ragelike_known_value() {
        assert_eq!(joaat("abc", true), 0xed13_1f5b);
        assert_eq!(joaat("ABC", true), joaat("abc", false));
        assert_ne!(joaat("ABC", false), joaat("abc", false));
    }

    #[test]
    fn a_sound_core_has_no_remarks_and_a_closed_graph() {
        let (_, image) = opened();
        assert!(assert_dictionaries(&image).unwrap().is_empty());
        assert!(graph_defects(&image).unwrap().is_empty());
        let mut remarks = BTreeSet::new();
        verify_graph(&image, None, &mut remarks).unwrap();
        assert!(remarks.is_empty());
        let found = inventory(&image).unwrap();
        assert_eq!(
            found.keys(),
            vec![
                "effect:tracer",
                "emitter:tracer",
                "particle:tracer",
                "texture:ptfx_tracer"
            ]
        );
    }

    #[test]
    fn a_foreign_hash_is_a_remark_but_an_astral_one_is_a_refusal() {
        let (core, mut image) = opened();
        // хеш единственного правила эффекта — чужой
        let dictionary = image.pointer(ROOT_EFFECTS).unwrap();
        let hash_at = image
            .list(dictionary + DICTIONARY_HASHES)
            .unwrap()
            .array
            .unwrap();
        image.put(hash_at, &0x1234_5678u32.to_le_bytes()).unwrap();
        let remarks = assert_dictionaries(&image).unwrap();
        assert_eq!(
            remarks,
            vec![Remark {
                dictionary: "effect rule",
                index: 0,
                name: "tracer".to_owned(),
                hash: "12345678".to_owned(),
                form: "foreign"
            }]
        );
        // имя той же записи с приставкой Astral: порча
        let name = image.pointer(core.map.effect + EFFECT_NAME).unwrap();
        image.put(name, b"astral_t\0").unwrap();
        let error = assert_dictionaries(&image).unwrap_err();
        assert_eq!(
            error.message,
            "YPT effect rule dictionary hash does not match its name at 0: astral_t."
        );
    }

    #[test]
    fn a_dangling_reference_is_named_and_can_be_tolerated_once_seen() {
        let (core, mut image) = opened();
        // событие ведёт в эмиттер, которого в словаре нет: на само событие
        let target = crate::resource::SYSTEM_BASE + core.map.event as u64;
        image
            .put(core.map.event + EVENT_EMITTER, &target.to_le_bytes())
            .unwrap();
        let defects = graph_defects(&image).unwrap();
        assert_eq!(defects, HashSet::from(["emitter:tracer".to_owned()]));
        let mut remarks = BTreeSet::new();
        let error = verify_graph(&image, None, &mut remarks).unwrap_err();
        assert_eq!(
            error.message,
            "YPT effect tracer points at an emitter rule outside the dictionary."
        );
        verify_graph(&image, Some(&defects), &mut remarks).unwrap();
        assert_eq!(remarks, BTreeSet::from(["emitter:tracer".to_owned()]));
    }

    #[test]
    fn the_comparison_counts_patched_unchanged_added_and_lost_entries() {
        let (_, image) = opened();
        let before = inventory(&image).unwrap();
        let rules: HashSet<String> = HashSet::from(["TRACER".to_owned()]);
        let none = HashSet::new();
        let found = compare(&before, &before, &none, &rules, &none, &none).unwrap();
        // эффект, эмиттер и частица с этим именем — правка; лист — нет
        assert_eq!(
            (
                found.vanilla_unchanged,
                found.intentionally_patched,
                found.added,
                found.purged
            ),
            (1, 3, 0, 0)
        );
        assert_eq!(
            (
                found.effect_rules,
                found.emitter_rules,
                found.particle_rules,
                found.textures
            ),
            (1, 1, 1, 1)
        );
        let textures: HashSet<String> = HashSet::from(["PTFX_TRACER".to_owned()]);
        assert_eq!(
            compare(&before, &before, &textures, &none, &none, &none)
                .unwrap()
                .intentionally_patched,
            1
        );
        // потеря записи
        let mut lost = before.clone();
        lost.textures.clear();
        assert_eq!(
            compare(&before, &lost, &none, &none, &none, &none)
                .unwrap_err()
                .message,
            "YPT lost texture:ptfx_tracer while reserving Astral slots."
        );
        // неожиданная прибавка
        let mut grown = before.clone();
        grown.effects.push("astral_x".to_owned());
        assert_eq!(
            compare(&before, &grown, &none, &none, &none, &none)
                .unwrap_err()
                .message,
            "YPT entries changed unexpectedly while reserving Astral slots: effect:astral_x"
        );
        let expected = HashSet::from(["effect:astral_x".to_owned()]);
        assert_eq!(
            compare(&before, &grown, &none, &none, &none, &expected)
                .unwrap()
                .added,
            1
        );
    }
}
