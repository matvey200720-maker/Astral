//! Раздел `impact` ответа `read-ptfx-base`: данные для окна эффектов попаданий
//! (пуля в материал, кровь, ломающиеся предметы).
//!
//! Для каждого правила каталога импакта собирается краткая сводка (длительность,
//! события, эмиттеры, частицы), готовятся листы текстур этих правил и выгрузка
//! «модели» каждого словаря. Словарей два рода: ядро игры и донорские `.ypt`, из
//! которых каталог берёт правила, которых в ядре нет (сейчас один — `scr_rcbarry2`).
//! Модуль чистый: донорские файлы приходят байтами от вызывающего.

use std::{
    collections::{BTreeMap, HashSet},
    iter,
};

use rage_res::{
    texture::TextureRef,
    ypt::{self, export},
    Resource,
};
use serde_json::{Map, Value};

use super::{
    clip_regions::{grid_for, Grid},
    environment::{object_of, ByName, Originals},
    scene::{export_of, list_at, Press, SheetKind},
};
use crate::error::Result;

/// Ключ модели ядра в разделе.
const CORE_KEY: &str = "core";

/// Правила каталога импакта в ядре, в порядке каталога.
const CORE_RULES: [&str; 29] = [
    "bang_carmetal",
    "bang_hydraulics",
    "blood_entry",
    "blood_entry_head_sniper",
    "blood_entry_shotgun",
    "blood_exit",
    "blood_headshot",
    "blood_nose",
    "blood_throat",
    "bul_carmetal",
    "bul_concrete",
    "bul_paper",
    "bul_water",
    "ent_amb_elec_crackle_sp",
    "ent_brk_banknotes",
    "ent_brk_coins",
    "ent_brk_steam_burst",
    "ent_brk_tree_leaves",
    "ent_dst_casino_chips",
    "ent_dst_electrical",
    "ent_dst_gen_gobstop",
    "ent_sht_electrical_box",
    "ent_sht_feathers",
    "ent_sht_flame",
    "exp_air_molotov",
    "exp_xs_mine_emp",
    "fire_ped_smoulder",
    "shotgun_water",
    "veh_sub_crush",
];

/// Донорские словари каталога: идентификатор и правила, которые из него берутся.
pub const DONOR_RULES: &[(&str, &[&str])] = &[(
    "scr_rcbarry2",
    &[
        "muz_clown",
        "scr_clown_appears",
        "scr_clown_bul",
        "scr_clown_death",
    ],
)];

/// Правила донора по его идентификатору; незнакомый донор правил не даёт.
fn rule_list(id: &str) -> &'static [&'static str] {
    DONOR_RULES
        .iter()
        .find_map(|&(donor, rules)| (donor == id).then_some(rules))
        .unwrap_or(&[])
}

/// Текстуры правила по сводке: `events[].particleRule.texture`, непустые.
fn summary_textures(summary: &Value) -> Vec<&str> {
    list_at(summary, "events")
        .iter()
        .filter_map(|event| event.get("particleRule")?.get("texture")?.as_str())
        .filter(|texture| !texture.is_empty())
        .collect()
}

/// Строки из `textures` выгрузки модели.
fn model_texture_names(model: Option<&Value>) -> Vec<&str> {
    model
        .map(|m| list_at(m, "textures"))
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_str)
        .collect()
}

/// Кандидаты на листы одного словаря: текстуры правил по порядку правил, а затем один
/// раз текстуры модели словаря.
fn candidates<'a>(
    summaries: &'a [Value],
    model: Option<&'a Value>,
) -> impl Iterator<Item = &'a str> {
    let ruled = summaries.iter().flat_map(summary_textures);
    ruled.chain(model_texture_names(model))
}

/// Запись раздела `donorFiles`: есть ли файл и какие правила из него найдены.
fn donor_entry(available: bool, rules: Vec<&str>) -> Value {
    object_of([
        ("available", Value::Bool(available)),
        ("effectRules", Value::from(rules)),
    ])
}

/// Разобранный донор: ресурс и его текстуры.
struct Donor {
    resource: Resource,
    textures: Vec<TextureRef>,
}

impl Donor {
    fn parse(bytes: &[u8]) -> Result<Donor> {
        let resource = Resource::parse(bytes)?;
        let textures = ypt::read(&resource)?.textures;
        Ok(Donor { resource, textures })
    }
}

/// Словарь, из которого читаются сводки: ресурс и его текстуры по имени.
struct Shelf<'a> {
    resource: &'a Resource,
    textures: ByName<'a>,
}

impl<'a> Shelf<'a> {
    fn new(resource: &'a Resource, textures: &'a [TextureRef]) -> Self {
        Shelf {
            resource,
            textures: ByName::of(textures),
        }
    }

    fn has(&self, name: &str) -> bool {
        self.textures.find(name).is_some()
    }

    /// Лист по имени: пара «имя текстуры, запись»; нет текстуры или листа — `None`.
    fn sheet(
        &self,
        name: &str,
        grids: &BTreeMap<String, Grid>,
        originals: &Originals,
    ) -> Result<Option<(String, Value)>> {
        let Some(texture) = self.textures.find(name) else {
            return Ok(None);
        };
        let press = Press::new(self.resource, originals, SheetKind::Weapon);
        let entry = press.entry(texture, grid_for(grids, name))?;
        Ok(entry.map(|sheet| (texture.name.clone(), sheet)))
    }
}

/// Словарь каталога: ключ в ответе, значение `file` у его правил, имена правил и
/// полка (у донора, которого не нашли, её нет).
struct Volume<'a> {
    key: &'static str,
    file: Value,
    names: &'static [&'static str],
    shelf: Option<Shelf<'a>>,
}

/// Какие листы нужны и из какого словаря взять каждый (0 — ядро, 1… — доноры по порядку).
#[derive(Default)]
struct Wishlist {
    /// Уже встреченные кандидаты (общие на все словари).
    seen: HashSet<String>,
    wanted: Vec<(String, usize)>,
}

impl Wishlist {
    /// Рассматривает кандидата из словаря `slot`: у донора — его собственные текстуры
    /// первыми, иначе ядро; чего нигде нет, того в «встреченных» не запоминаем.
    /// `holds(слот, имя)` говорит, есть ли у словаря текстура.
    fn request(&mut self, holds: impl Fn(usize, &str) -> bool, slot: usize, candidate: &str) {
        let name = candidate.to_lowercase();
        let fresh = !name.is_empty() && !self.seen.contains(&name);
        let source = fresh
            .then(|| [slot, 0].into_iter().find(|&at| holds(at, &name)))
            .flatten();
        if let Some(source) = source {
            self.seen.insert(name.clone());
            self.wanted.push((name, source));
        }
    }
}

/// То, что набирается по словарям: правила, донорские файлы и модели.
#[derive(Default)]
struct Tally {
    rules: Map<String, Value>,
    donor_files: Map<String, Value>,
    models: Map<String, Value>,
}

impl Tally {
    /// Сводки, модель и кандидаты на листы словаря `slot`. Отказ сводок — отказ всего
    /// раздела; отказ выгрузки модели молча пропускается.
    fn record(&mut self, volumes: &[Volume], slot: usize, wishlist: &mut Wishlist) -> Result<()> {
        let volume = &volumes[slot];
        let Some(shelf) = &volume.shelf else {
            self.donor_files
                .insert(volume.key.to_owned(), donor_entry(false, Vec::new()));
            return Ok(());
        };
        let holds = |at: usize, name: &str| {
            volumes[at]
                .shelf
                .as_ref()
                .is_some_and(|other| other.has(name))
        };

        let asked: Vec<String> = volume.names.iter().map(|name| name.to_string()).collect();
        let mut digest = export::digest(shelf.resource, &asked)?;
        let model = export_of(shelf.resource, volume.names).ok();

        let (present, summaries): (Vec<&str>, Vec<Value>) = volume
            .names
            .iter()
            .filter_map(|&name| {
                let summary = digest.remove(name).filter(|s| !s.is_null())?;
                Some((name, summary))
            })
            .unzip();
        for texture in candidates(&summaries, model.as_ref()) {
            wishlist.request(holds, slot, texture);
        }
        for (&name, mut summary) in present.iter().zip(summaries) {
            if let Some(fields) = summary.as_object_mut() {
                fields.insert("file".to_owned(), volume.file.clone());
            }
            self.rules.insert(name.to_owned(), summary);
        }
        if slot > 0 {
            self.donor_files
                .insert(volume.key.to_owned(), donor_entry(true, present));
        }
        if let Some(model) = model {
            self.models.insert(volume.key.to_owned(), model);
        }
        Ok(())
    }
}

/// Раздел `impact`: правила со сводками, листы, донорские файлы и модели словарей.
pub fn read(
    core: &Resource,
    core_textures: &[TextureRef],
    donors: &[(&'static str, Option<Vec<u8>>)],
    grids: &BTreeMap<String, Grid>,
    originals: &Originals,
) -> Result<Value> {
    // Донор, который найден, но не разбирается, роняет весь раздел.
    let parsed = donors
        .iter()
        .map(|(_, bytes)| bytes.as_deref().map(Donor::parse).transpose())
        .collect::<Result<Vec<_>>>()?;

    let core_volume = Volume {
        key: CORE_KEY,
        file: Value::Null,
        names: &CORE_RULES,
        shelf: Some(Shelf::new(core, core_textures)),
    };
    let donor_volumes = donors.iter().zip(&parsed).map(|(&(id, _), donor)| Volume {
        key: id,
        file: Value::from(id),
        names: rule_list(id),
        shelf: donor.as_ref().map(|d| Shelf::new(&d.resource, &d.textures)),
    });
    let volumes: Vec<Volume> = iter::once(core_volume).chain(donor_volumes).collect();

    let mut wishlist = Wishlist::default();
    let tally = (0..volumes.len()).try_fold(Tally::default(), |mut tally, slot| {
        tally.record(&volumes, slot, &mut wishlist).map(|()| tally)
    })?;

    let sheets = wishlist
        .wanted
        .iter()
        .filter_map(|(name, slot)| {
            let shelf = volumes[*slot].shelf.as_ref()?;
            shelf.sheet(name, grids, originals).transpose()
        })
        .collect::<Result<Map<String, Value>>>()?;

    Ok(object_of([
        ("rules", tally.rules.into()),
        ("sheets", sheets.into()),
        ("donorFiles", tally.donor_files.into()),
        ("model", tally.models.into()),
    ]))
}

#[cfg(test)]
mod tests;
