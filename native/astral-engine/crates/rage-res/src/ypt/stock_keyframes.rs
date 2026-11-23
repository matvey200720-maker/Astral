//! Кадры штатных правил ядра игрока (`stockKeyframes` помощника `ypt-texture-patch`).
//!
//! Автор редукса меняет у штатных правил кадры свойств: цвет, свечение, размер частиц взрыва. Целое
//! ядро автора — файл Rockstar, его не раздаём; переносятся числа автора, и ложатся они на те же
//! свойства тех же объектов ядра игрока. Структура не растёт: новых записей нет, меняются только
//! списки кадров свойств. Порт `YptStockKeyframes.cs`: те же проверки и тексты отказов.

use std::collections::{BTreeSet, HashSet};

use super::image::{
    Frame, Image, EFFECT_NAME, EMITTER_NAME, PARTICLE_NAME, PROP_BYTES, PROP_HASH, ROOT_EFFECTS,
    ROOT_EMITTERS, ROOT_PARTICLES,
};
use super::names::hash_name;
use crate::error::{Error, Result};

/// Одна правка свойства штатного объекта.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StockPatch {
    pub kind: String,
    pub name: String,
    pub prop: String,
    /// Строки `[время, x, y, z, w]`; `None` — поля нет в запросе.
    pub values: Option<Vec<Vec<f64>>>,
    pub optional: bool,
    pub from_donor: bool,
}

/// Итог прохода: сколько свойств записано, какие объекты тронуты, что пропущено и какие кадры легли.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StockReport {
    pub applied: usize,
    /// Имена тронутых объектов по возрастанию (порядок побайтный).
    pub objects: Vec<String>,
    pub skipped: Vec<String>,
    /// Ключ `вид:имя:свойство` и кадры всех его свойств, как они легли в образ.
    pub expected: Vec<(String, Vec<Frame>)>,
}

/// Больше правок за запрос помощник не принимает.
pub const MAX_PATCHES: usize = 4096;
/// Встроенные свойства правила эффекта и эмиттера, свойства доменов эмиттера.
const EFFECT_PROPS: usize = 0xC0;
const EFFECT_PROP_COUNT: usize = 5;
const EMITTER_PROPS: usize = 0x78;
const EMITTER_PROP_COUNT: usize = 10;
const EMITTER_DOMAINS: [usize; 3] = [0x38, 0x48, 0x58];
const DOMAIN_PROPS: [usize; 4] = [0x18, 0xA8, 0x138, 0x1C8];
/// Поведения правила частицы и список указателей на их свойства.
const BEHAVIOUR_LISTS: [usize; 5] = [0x128, 0x138, 0x148, 0x158, 0x168];
const BEHAVIOUR_PROPS: usize = 0x10;

fn broken(text: String) -> Error {
    Error::broken(text)
}

/// `^[a-z0-9_]{1,N}$` без учёта регистра.
fn word(text: &str, most: usize) -> bool {
    (1..=most).contains(&text.len()) && text.bytes().all(|b| b == b'_' || b.is_ascii_alphanumeric())
}

fn object_name_ok(name: &str) -> bool {
    word(name, 96)
}

fn prop_name_ok(prop: &str) -> bool {
    prop.split_once(':')
        .is_some_and(|(head, tail)| word(head, 48) && word(tail, 64))
}

/// `StringComparison.OrdinalIgnoreCase` для ключей вида `вид:имя:свойство`.
fn same_key(left: &str, right: &str) -> bool {
    super::cmp_ordinal_ignore_case(left, right) == std::cmp::Ordering::Equal
}

/// Свойства штатного объекта; `None` — объекта нет.
fn targets(image: &Image, kind: &str, name: &str) -> Option<Vec<usize>> {
    match kind {
        "effect" => {
            let rules = image.dictionary(ROOT_EFFECTS).unwrap_or_default();
            let effect = image.first_named(&rules, EFFECT_NAME, name)?;
            Some(
                (0..EFFECT_PROP_COUNT)
                    .map(|k| effect + EFFECT_PROPS + k * PROP_BYTES)
                    .collect(),
            )
        }
        "emitter" => {
            let rules = image.dictionary(ROOT_EMITTERS).unwrap_or_default();
            let emitter = image.first_named(&rules, EMITTER_NAME, name)?;
            let mut props: Vec<usize> = (0..EMITTER_PROP_COUNT)
                .map(|k| emitter + EMITTER_PROPS + k * PROP_BYTES)
                .collect();
            for field in EMITTER_DOMAINS {
                if let Some(domain) = image.pointer(emitter + field) {
                    props.extend(DOMAIN_PROPS.iter().map(|&offset| domain + offset));
                }
            }
            Some(props)
        }
        _ => {
            let rules = image.dictionary(ROOT_PARTICLES).unwrap_or_default();
            let particle = image.first_named(&rules, PARTICLE_NAME, name)?;
            let mut seen: Vec<usize> = Vec::new();
            for list in BEHAVIOUR_LISTS {
                let Ok(list) = image.list(particle + list) else {
                    continue;
                };
                for behaviour in image.objects(list) {
                    if !seen.contains(&behaviour) {
                        seen.push(behaviour);
                    }
                }
            }
            let mut props = Vec::new();
            for behaviour in seen {
                if let Ok(list) = image.list(behaviour + BEHAVIOUR_PROPS) {
                    props.extend(image.objects(list));
                }
            }
            Some(props)
        }
    }
}

/// Свойства с нужным хешем имени, без повторов, в порядке обхода.
fn with_hash(image: &Image, props: Vec<usize>, hash: u32) -> Vec<usize> {
    let mut found: Vec<usize> = Vec::new();
    for prop in props {
        if image.u32(prop + PROP_HASH).is_ok_and(|have| have == hash) && !found.contains(&prop) {
            found.push(prop);
        }
    }
    found
}

/// Кадры из строк `[время, x, y, z, w]`: во втором числе времени — обратная длина отрезка до прежнего кадра.
fn build_frames(values: &[Vec<f64>], key: &str) -> Result<Vec<Frame>> {
    let mut frames = Vec::with_capacity(values.len());
    let mut previous = -1.0f32;
    for (index, row) in values.iter().enumerate() {
        if row.len() != 5 {
            return Err(broken(format!(
                "YPT clone keyframe must be [time, x, y, z, w]: {key}"
            )));
        }
        let time = row[0] as f32;
        if !(0.0..=1.0).contains(&time) || time <= previous {
            return Err(broken(format!(
                "YPT clone keyframe times must rise within 0…1: {key}"
            )));
        }
        if index == 0 && time != 0.0 {
            return Err(broken(format!(
                "YPT clone keyframes must start at zero: {key}"
            )));
        }
        if row
            .iter()
            .any(|&number| !(-100_000.0..=100_000.0).contains(&number))
        {
            return Err(broken(format!(
                "YPT clone keyframe value is out of range: {key}"
            )));
        }
        let inverse = if index == 0 {
            0.0
        } else {
            1.0 / (time - previous)
        };
        frames.push(Frame {
            time: [time, inverse, 0.0, 0.0],
            value: [row[1] as f32, row[2] as f32, row[3] as f32, row[4] as f32],
        });
        previous = time;
    }
    Ok(frames)
}

/// Накладывает правки на образ; `donor` — ядро образца для возвратных кадров (`fromDonor`).
pub fn apply(
    image: &mut Image,
    patches: &[StockPatch],
    donor: Option<&Image>,
) -> Result<StockReport> {
    if patches.len() > MAX_PATCHES {
        return Err(broken(format!(
            "YPT stock keyframe patch count must not exceed {MAX_PATCHES}."
        )));
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut objects: BTreeSet<String> = BTreeSet::new();
    let mut report = StockReport::default();
    for patch in patches {
        let kind = patch.kind.trim().to_lowercase();
        let name = patch.name.trim();
        let prop = patch.prop.trim();
        if !matches!(kind.as_str(), "effect" | "emitter" | "particle") {
            return Err(broken(format!(
                "YPT stock keyframe kind is invalid: {}",
                patch.kind
            )));
        }
        if !object_name_ok(name) || name.len() >= 7 && name[..7].eq_ignore_ascii_case("astral_") {
            return Err(broken(format!(
                "YPT stock keyframe object must be a stock name: {}",
                patch.name
            )));
        }
        if !prop_name_ok(prop) {
            return Err(broken(format!(
                "YPT stock keyframe property is invalid: {}",
                patch.prop
            )));
        }
        let key = format!("{kind}:{name}:{prop}");
        if !seen.insert(key.to_uppercase()) {
            return Err(broken(format!(
                "YPT stock keyframe is patched twice: {key}"
            )));
        }
        let hash = hash_name(prop);
        let owned = targets(image, &kind, name);
        let found: Vec<usize> = owned
            .clone()
            .map(|props| with_hash(image, props, hash))
            .unwrap_or_default();
        if found.is_empty() {
            if !patch.optional {
                return Err(broken(if owned.is_none() {
                    format!("YPT core has no stock {kind} {name}.")
                } else {
                    format!("YPT stock {kind} {name} has no keyframe property {prop}.")
                }));
            }
            report.skipped.push(key);
            continue;
        }
        if patch.from_donor {
            let donor = donor
                .ok_or_else(|| broken(format!("YPT stock keyframes need a donor core: {key}")))?;
            let sources = targets(donor, &kind, name)
                .map(|props| with_hash(donor, props, hash))
                .unwrap_or_default();
            if sources.len() != found.len() {
                if !patch.optional {
                    return Err(broken(format!("YPT donor core does not match {key}")));
                }
                report.skipped.push(key);
                continue;
            }
            for (&target, &source) in found.iter().zip(&sources) {
                let frames = donor.frames(source)?;
                image.replace_frames(target, &frames)?;
                report.applied += 1;
            }
        } else {
            let values = patch
                .values
                .as_ref()
                .ok_or_else(|| broken(format!("YPT stock keyframes have no values: {key}")))?;
            for &target in &found {
                let frames = build_frames(values, &key)?;
                image.replace_frames(target, &frames)?;
                report.applied += 1;
            }
        }
        let mut landed = Vec::new();
        for &target in &found {
            landed.extend(image.frames(target)?);
        }
        report.expected.push((key, landed));
        objects.insert(name.to_owned());
    }
    report.objects = objects.into_iter().collect();
    Ok(report)
}

/// Перечитанный образ хранит ровно те кадры, что легли в память перед записью.
pub fn verify_after_save(
    image: &Image,
    patches: &[StockPatch],
    report: &StockReport,
) -> Result<()> {
    for patch in patches {
        let kind = patch.kind.trim().to_lowercase();
        let key = format!("{kind}:{}:{}", patch.name.trim(), patch.prop.trim());
        if report.skipped.iter().any(|skipped| same_key(skipped, &key)) {
            continue;
        }
        let hash = hash_name(patch.prop.trim());
        let found = targets(image, &kind, patch.name.trim())
            .map(|props| with_hash(image, props, hash))
            .unwrap_or_default();
        let mut frames = Vec::new();
        for target in found {
            frames.extend(image.frames(target)?);
        }
        let wanted = report
            .expected
            .iter()
            .find(|(have, _)| same_key(have, &key))
            .map(|(_, wanted)| wanted);
        let lost = wanted.is_none_or(|wanted| {
            wanted.len() != frames.len() || !wanted.iter().zip(&frames).all(|(a, b)| a.same(b))
        });
        if lost {
            return Err(broken(format!(
                "YPT stock keyframes did not survive the save: {key}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::Resource;
    use crate::ypt::fixture::{self, Core};
    use crate::ypt::image::Image;
    use crate::ypt::rules::effect_positions;

    fn opened() -> (Core, Image) {
        let core = fixture::core(true);
        let image = Image::parse(&core.bytes).unwrap();
        (core, image)
    }

    fn rows(rows: &[[f64; 5]]) -> Option<Vec<Vec<f64>>> {
        Some(rows.iter().map(|row| row.to_vec()).collect())
    }

    fn patch(kind: &str, name: &str, prop: &str, values: Option<Vec<Vec<f64>>>) -> StockPatch {
        StockPatch {
            kind: kind.to_owned(),
            name: name.to_owned(),
            prop: prop.to_owned(),
            values,
            ..StockPatch::default()
        }
    }

    fn effect_prop(core: &Core, slot: usize) -> usize {
        core.map.effect + 0xC0 + 0x90 * slot
    }

    #[test]
    fn four_frames_replace_two_with_the_inverse_segment_length() {
        let (core, mut image) = opened();
        let wanted = rows(&[
            [0.0, 1.0, 1.0, 1.0, 1.0],
            [0.25, 1.5, 1.5, 1.5, 1.5],
            [0.5, 2.0, 2.0, 2.0, 2.0],
            [1.0, 1.0, 1.0, 1.0, 1.0],
        ]);
        let report = apply(
            &mut image,
            &[patch(
                "effect",
                "tracer",
                "ptxEffectRule:m_zoomScalarKFP",
                wanted,
            )],
            None,
        )
        .unwrap();
        assert_eq!(
            (report.applied, report.objects.clone(), report.skipped.len()),
            (1, vec!["tracer".to_owned()], 0)
        );
        let frames = image.frames(effect_prop(&core, 2)).unwrap();
        let times: Vec<[f32; 2]> = frames.iter().map(|f| [f.time[0], f.time[1]]).collect();
        assert_eq!(times, vec![[0.0, 0.0], [0.25, 4.0], [0.5, 4.0], [1.0, 2.0]]);
        assert_eq!(frames[1].value, [1.5; 4]);
        assert_eq!(report.expected.len(), 1);
        assert_eq!(
            report.expected[0].0,
            "effect:tracer:ptxEffectRule:m_zoomScalarKFP"
        );
        // та же запись находится и после сборки файла
        let file = image.into_file().unwrap();
        let again = Image::parse(&file).unwrap();
        verify_after_save(
            &again,
            &[patch(
                "effect",
                "tracer",
                "ptxEffectRule:m_zoomScalarKFP",
                None,
            )],
            &report,
        )
        .unwrap();
        let effect = effect_positions(&Resource::parse(&file).unwrap()).unwrap()["tracer"];
        assert_eq!(again.frames(effect + 0xC0 + 0x90 * 2).unwrap().len(), 4);
    }

    #[test]
    fn a_shorter_or_empty_list_is_written_too() {
        let (core, mut image) = opened();
        apply(
            &mut image,
            &[patch(
                "effect",
                "tracer",
                "ptxEffectRule:m_zoomScalarKFP",
                rows(&[[0.0, 3.0, 3.0, 3.0, 3.0]]),
            )],
            None,
        )
        .unwrap();
        assert_eq!(image.frames(effect_prop(&core, 2)).unwrap().len(), 1);
        apply(
            &mut image,
            &[patch(
                "effect",
                "tracer",
                "ptxEffectRule:m_zoomScalarKFP",
                Some(Vec::new()),
            )],
            None,
        )
        .unwrap();
        assert!(image.frames(effect_prop(&core, 2)).unwrap().is_empty());
    }

    #[test]
    fn emitter_and_particle_properties_are_found_by_the_hash_of_their_name() {
        let (core, mut image) = opened();
        let one = rows(&[[0.0, 7.0, 7.0, 7.0, 7.0]]);
        let report = apply(
            &mut image,
            &[
                patch(
                    "emitter",
                    "TRACER",
                    "ptxEmitterRule:m_spawnRateOverTimeKFP",
                    one.clone(),
                ),
                patch("particle", "tracer", "ptxu_Colour:m_rgbaMaxKFP", one),
            ],
            None,
        )
        .unwrap();
        assert_eq!(report.applied, 2);
        assert_eq!(
            report.objects,
            vec!["TRACER".to_owned(), "tracer".to_owned()]
        );
        assert_eq!(
            image.frames(core.map.emitter + 0x78 + 0x90).unwrap()[0].value,
            [7.0; 4]
        );
        assert_eq!(
            image.frames(core.map.colour + 0xC0).unwrap()[0].value,
            [7.0; 4]
        );
    }

    #[test]
    fn frames_come_back_from_the_donor_as_they_are_stored() {
        let (core, mut image) = opened();
        let (_, donor_core) = (0, fixture::core(true));
        let mut donor = Image::parse(&donor_core.bytes).unwrap();
        // у донора эти кадры другие, с одинаковым временем (так бывает у Rockstar)
        let odd = [
            Frame {
                time: [0.0, 0.0, 0.0, 0.0],
                value: [5.0; 4],
            },
            Frame {
                time: [0.5, 9.0, 0.0, 0.0],
                value: [6.0; 4],
            },
            Frame {
                time: [0.5, 9.5, 0.0, 0.0],
                value: [7.0; 4],
            },
        ];
        donor
            .replace_frames(effect_prop(&donor_core, 2), &odd)
            .unwrap();
        let mut back = patch("effect", "tracer", "ptxEffectRule:m_zoomScalarKFP", None);
        back.from_donor = true;
        let report = apply(&mut image, &[back], Some(&donor)).unwrap();
        assert_eq!(report.applied, 1);
        let frames = image.frames(effect_prop(&core, 2)).unwrap();
        assert!(frames.iter().zip(&odd).all(|(a, b)| a.same(b)) && frames.len() == 3);
    }

    #[test]
    fn requests_are_refused_with_the_helper_words() {
        let (_, mut image) = opened();
        let one = rows(&[[0.0, 1.0, 1.0, 1.0, 1.0]]);
        let zoom = "ptxEffectRule:m_zoomScalarKFP";
        let say = |image: &mut Image, patches: &[StockPatch]| {
            apply(image, patches, None).unwrap_err().message
        };
        assert_eq!(
            say(&mut image, &[patch("rule", "tracer", zoom, one.clone())]),
            "YPT stock keyframe kind is invalid: rule"
        );
        assert_eq!(
            say(
                &mut image,
                &[patch("effect", "astral_x", zoom, one.clone())]
            ),
            "YPT stock keyframe object must be a stock name: astral_x"
        );
        assert_eq!(
            say(
                &mut image,
                &[patch("effect", "bad name", zoom, one.clone())]
            ),
            "YPT stock keyframe object must be a stock name: bad name"
        );
        assert_eq!(
            say(
                &mut image,
                &[patch("effect", "tracer", "zoom", one.clone())]
            ),
            "YPT stock keyframe property is invalid: zoom"
        );
        let twice = [
            patch("effect", "tracer", zoom, one.clone()),
            patch("EFFECT", "Tracer", &zoom.to_uppercase(), one.clone()),
        ];
        assert_eq!(
            say(&mut image, &twice),
            "YPT stock keyframe is patched twice: effect:Tracer:PTXEFFECTRULE:M_ZOOMSCALARKFP"
        );
        assert_eq!(
            say(&mut image, &[patch("effect", "ghost", zoom, one.clone())]),
            "YPT core has no stock effect ghost."
        );
        assert_eq!(
            say(
                &mut image,
                &[patch(
                    "effect",
                    "tracer",
                    "ptxEffectRule:m_dataSphereKFP",
                    one.clone()
                )]
            ),
            "YPT stock effect tracer has no keyframe property ptxEffectRule:m_dataSphereKFP."
        );
        assert_eq!(
            say(&mut image, &[patch("effect", "tracer", zoom, None)]),
            "YPT stock keyframes have no values: effect:tracer:ptxEffectRule:m_zoomScalarKFP"
        );
        let key = "effect:tracer:ptxEffectRule:m_zoomScalarKFP";
        let row = |values: &[f64]| Some(vec![values.to_vec()]);
        assert_eq!(
            say(
                &mut image,
                &[patch("effect", "tracer", zoom, row(&[0.0, 1.0]))]
            ),
            format!("YPT clone keyframe must be [time, x, y, z, w]: {key}")
        );
        assert_eq!(
            say(
                &mut image,
                &[patch(
                    "effect",
                    "tracer",
                    zoom,
                    row(&[0.5, 1.0, 1.0, 1.0, 1.0])
                )]
            ),
            format!("YPT clone keyframes must start at zero: {key}")
        );
        assert_eq!(
            say(
                &mut image,
                &[patch(
                    "effect",
                    "tracer",
                    zoom,
                    row(&[1.5, 1.0, 1.0, 1.0, 1.0])
                )]
            ),
            format!("YPT clone keyframe times must rise within 0…1: {key}")
        );
        assert_eq!(
            say(
                &mut image,
                &[patch(
                    "effect",
                    "tracer",
                    zoom,
                    rows(&[[0.0, 1.0, 1.0, 1.0, 1.0], [0.0, 1.0, 1.0, 1.0, 1.0]])
                )]
            ),
            format!("YPT clone keyframe times must rise within 0…1: {key}")
        );
        assert_eq!(
            say(
                &mut image,
                &[patch(
                    "effect",
                    "tracer",
                    zoom,
                    row(&[0.0, 100001.0, 1.0, 1.0, 1.0])
                )]
            ),
            format!("YPT clone keyframe value is out of range: {key}")
        );
        let mut missing_donor = patch("effect", "tracer", zoom, None);
        missing_donor.from_donor = true;
        assert_eq!(
            say(&mut image, &[missing_donor]),
            format!("YPT stock keyframes need a donor core: {key}")
        );
    }

    #[test]
    fn an_optional_patch_without_an_object_is_skipped_and_named() {
        let (_, mut image) = opened();
        let one = rows(&[[0.0, 1.0, 1.0, 1.0, 1.0]]);
        let mut ghost = patch("particle", "ghost", "ptxu_Colour:m_rgbaMaxKFP", one.clone());
        ghost.optional = true;
        let mut sphere = patch("effect", "tracer", "ptxEffectRule:m_dataSphereKFP", one);
        sphere.optional = true;
        let report = apply(&mut image, &[ghost, sphere], None).unwrap();
        assert_eq!(report.applied, 0);
        assert!(report.objects.is_empty());
        assert_eq!(
            report.skipped,
            vec![
                "particle:ghost:ptxu_Colour:m_rgbaMaxKFP".to_owned(),
                "effect:tracer:ptxEffectRule:m_dataSphereKFP".to_owned()
            ]
        );
    }
}
