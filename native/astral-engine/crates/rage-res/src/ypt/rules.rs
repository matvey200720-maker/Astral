//! Обход графа правил `core.ypt` Legacy: от имён правил эффектов к событиям,
//! эмиттерам, частицам, текстурам и моделям.
//!
//! Модуль читает только имена и связи; числовые поля правил и их ключевые кадры
//! отдаёт выгрузка полей (`ypt/export.rs`). Дополнительно здесь несколько
//! простых функций, которые по позиции объекта находят соседние объекты.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::{
    cmp_ordinal_ignore_case, dictionary_values, named, read_list, EFFECT_EVENTS,
    EFFECT_EVOLUTIONS, EFFECT_NAME, EMITTER_RULE_NAME, EVENT_EVOLUTIONS, LIST_EFFECT_RULES,
    PARTICLE_RULE_NAME,
};
use crate::error::{Error, Result};
use crate::resource::{Resource, VERSION_YPT_LEGACY};

/// Сколько правил эффектов обход берёт за один запрос.
pub const MAX_RULES: usize = 128;
/// Начало пяти встроенных ключевых свойств в правиле эффекта.
pub const EFFECT_KEYFRAME_PROPS: usize = 0xC0;
/// Длина одного ключевого свойства.
pub const KEYFRAME_PROP_LENGTH: usize = 0x90;

/// Указатель из одного объекта на другой: куда он лежит в источнике.
#[derive(Clone, Copy)]
enum Link {
    EffectEvolutions,
    EventEvolutions,
    EventEmitter,
    EventParticle,
}

impl Link {
    fn offset(self) -> usize {
        match self {
            Link::EffectEvolutions => EFFECT_EVOLUTIONS,
            Link::EventEvolutions => EVENT_EVOLUTIONS,
            Link::EventEmitter => 0x40,
            Link::EventParticle => 0x48,
        }
    }
}

/// Список указателей на объекты внутри правила.
#[derive(Clone, Copy)]
enum Listing {
    Events,
    Behaviours,
}

impl Listing {
    fn offset(self) -> usize {
        match self {
            Listing::Events => EFFECT_EVENTS,
            Listing::Behaviours => 0x128,
        }
    }
}

/// Как из массива списка получаются позиции записей: по указателям или подряд с шагом.
#[derive(Clone, Copy)]
enum Shape {
    Pointers,
    Rows(usize),
}

/// Где в правиле частицы лежат списки и что в их записях.
struct ParticleMap {
    variables: usize,
    models: usize,
    /// Шаг записи модели и смещение имени внутри неё.
    model_row: (usize, usize),
    /// Тип переменной шейдера (смещение, значение «текстура») и имя текстуры.
    variable_kind: (usize, u8),
    variable_texture: usize,
    /// Порождатели эффектов: указатель на правило эффекта лежит на 0x58
    /// от начала порождателя («по доле» в 0x20, «при столкновении» в 0x90).
    spawners: [usize; 2],
}

const PARTICLE: ParticleMap = ParticleMap {
    variables: 0x1F0,
    models: 0x210,
    model_row: (0x30, 0x10),
    variable_kind: (0x14, 6),
    variable_texture: 0x30,
    spawners: [0x20 + 0x58, 0x90 + 0x58],
};

/// Имена эмиттера и частицы одного события; нет имени — `None`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventNames {
    pub emitter: Option<String>,
    pub particle: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EffectNames {
    pub events: Vec<EventNames>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParticleNames {
    pub shader_textures: Vec<String>,
    pub drawables: Vec<String>,
    pub spawned: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RuleGraph {
    pub effects: BTreeMap<String, EffectNames>,
    pub emitters: BTreeSet<String>,
    pub particles: BTreeMap<String, ParticleNames>,
    pub textures: Vec<String>,
    pub drawables: Vec<String>,
    pub missing: Vec<String>,
}

/// Имя правила: от 1 до 64 латинских букв, цифр и `_`.
pub fn is_rule_name(name: &str) -> bool {
    matches!(name.len(), 1..=64) && name.chars().all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// Объект ядра: ресурс и позиция, от которой отсчитываются смещения полей.
#[derive(Clone, Copy)]
struct Anchor<'a> {
    res: &'a Resource,
    at: usize,
}

impl<'a> Anchor<'a> {
    fn new(res: &'a Resource, at: usize) -> Self {
        Anchor { res, at }
    }

    /// Куда ведёт указатель, лежащий в объекте по смещению связи.
    fn follow(&self, link: Link) -> Option<usize> {
        self.res.pointer_at(self.at + link.offset())
    }

    /// Члены списка указателей: нулевые, чужие и ведущие за конец данных опускаются.
    fn members(&self, listing: Listing) -> Result<Vec<usize>> {
        entries(self.res, self.at + listing.offset(), Shape::Pointers)
    }
}

/// Позиции записей списка с заголовком в `list_at`; нет массива — записей нет.
fn entries(res: &Resource, list_at: usize, shape: Shape) -> Result<Vec<usize>> {
    let (array, declared) = read_list(res, list_at)?;
    let Some(base) = array else {
        return Ok(Vec::new());
    };
    Ok((0..declared)
        .filter_map(|n| match shape {
            Shape::Pointers => res.pointer_at(base + n * 8),
            Shape::Rows(stride) => Some(base + n * stride),
        })
        .collect())
}

/// Имена, которые достаёт `pick` из записей списка, в порядке записей.
fn names_from(
    res: &Resource,
    list_at: usize,
    shape: Shape,
    pick: impl Fn(usize) -> Result<Option<String>>,
) -> Result<Vec<String>> {
    let mut found = Vec::new();
    for entry in entries(res, list_at, shape)? {
        found.extend(pick(entry)?);
    }
    Ok(found)
}

/// Корень ядра, если ресурс — ядро Legacy: версия проверяется раньше корня.
fn legacy_root(res: &Resource) -> Result<usize> {
    match (res.version(), res.root()) {
        (VERSION_YPT_LEGACY, Some(root)) => Ok(root),
        (VERSION_YPT_LEGACY, None) => Err(Error::broken("Корень ресурса недоступен.")),
        (other, _) => Err(Error::version(format!(
            "core.ypt версии {other} не поддерживается; ожидается Legacy {VERSION_YPT_LEGACY}."
        ))),
    }
}

/// Правила эффектов по именам: позиция правила в данных. При повторе имени
/// остаётся первое вхождение, имя берётся как записано.
pub fn effect_positions(res: &Resource) -> Result<BTreeMap<String, usize>> {
    let root = legacy_root(res)?;
    let dictionary = res.pointer_at(root + LIST_EFFECT_RULES);
    let rules = dictionary_values(res, dictionary)?;
    // С конца: при повторе имени последняя вставка в карту — первое вхождение.
    Ok(rules
        .into_iter()
        .rev()
        .filter_map(|rule| named(res, rule, EFFECT_NAME).map(|name| (name, rule)))
        .collect())
}

/// События правила эффекта.
pub fn event_positions(res: &Resource, effect_at: usize) -> Result<Vec<usize>> {
    Anchor::new(res, effect_at).members(Listing::Events)
}

/// Список эволюций правила эффекта.
pub fn effect_evolutions_at(res: &Resource, effect_at: usize) -> Option<usize> {
    Anchor::new(res, effect_at).follow(Link::EffectEvolutions)
}

/// Список эволюций события.
pub fn event_evolutions_at(res: &Resource, event_at: usize) -> Option<usize> {
    Anchor::new(res, event_at).follow(Link::EventEvolutions)
}

/// Правило эмиттера и правило частицы события.
pub fn event_objects(res: &Resource, event_at: usize) -> (Option<usize>, Option<usize>) {
    let event = Anchor::new(res, event_at);
    (
        event.follow(Link::EventEmitter),
        event.follow(Link::EventParticle),
    )
}

/// Поведения правила частицы.
pub fn behaviour_positions(res: &Resource, particle_at: usize) -> Result<Vec<usize>> {
    Anchor::new(res, particle_at).members(Listing::Behaviours)
}

/// Добавляет имена в общий список, пропуская те, что там уже есть без учёта
/// регистра (в том числе повторы внутри самих `names`): остаётся первое написание.
fn absorb(list: &mut Vec<String>, names: &[String]) {
    let fresh = names.iter().fold(Vec::<&String>::new(), |mut fresh, name| {
        let known = list
            .iter()
            .chain(fresh.iter().copied())
            .any(|have| cmp_ordinal_ignore_case(have, name) == Ordering::Equal);
        if !known {
            fresh.push(name);
        }
        fresh
    });
    list.extend(fresh.into_iter().cloned());
}

/// Эффекты, которые частица запускает сама; годятся только имена правил.
fn spawned_effects(res: &Resource, particle: usize) -> Vec<String> {
    PARTICLE
        .spawners
        .iter()
        .filter_map(|&slot| res.pointer_at(particle + slot))
        .filter_map(|effect| named(res, effect, EFFECT_NAME))
        .filter(|name| is_rule_name(name))
        .collect()
}

/// Читает правило частицы: текстуры, модели, порождаемые эффекты (в таком порядке).
fn read_particle(res: &Resource, particle: usize) -> Result<ParticleNames> {
    let (kind_at, texture_kind) = PARTICLE.variable_kind;
    // Переменные шейдера: берутся только текстуры, повторы остаются.
    let shader_textures = names_from(
        res,
        particle + PARTICLE.variables,
        Shape::Pointers,
        |variable| {
            let is_texture = res.u8(variable + kind_at)? == texture_kind;
            Ok(if is_texture {
                named(res, variable, PARTICLE.variable_texture)
            } else {
                None
            })
        },
    )?;
    // Модели лежат подряд; запись без имени пропускается.
    let (row, name_at) = PARTICLE.model_row;
    let drawables = names_from(
        res,
        particle + PARTICLE.models,
        Shape::Rows(row),
        |model| Ok(named(res, model, name_at)),
    )?;
    Ok(ParticleNames {
        shader_textures,
        drawables,
        spawned: spawned_effects(res, particle),
    })
}

/// Раскрывает правило эффекта: имена событий, а в граф ложатся эмиттеры,
/// частицы и их общие списки. Второй результат — порождённые эффекты.
fn describe_effect(
    res: &Resource,
    rule: usize,
    graph: &mut RuleGraph,
) -> Result<(EffectNames, Vec<String>)> {
    let mut spawns = Vec::new();
    let mut events = Vec::new();
    for position in Anchor::new(res, rule).members(Listing::Events)? {
        let event = Anchor::new(res, position);
        let emitter = event
            .follow(Link::EventEmitter)
            .and_then(|at| named(res, at, EMITTER_RULE_NAME));
        graph.emitters.extend(emitter.clone());
        let particle = event
            .follow(Link::EventParticle)
            .and_then(|at| named(res, at, PARTICLE_RULE_NAME).map(|name| (at, name)));
        if let Some((at, name)) = &particle {
            // Двойник с тем же именем уже в графе: его не читаем.
            if !graph.particles.contains_key(name) {
                let body = read_particle(res, *at)?;
                absorb(&mut graph.textures, &body.shader_textures);
                absorb(&mut graph.drawables, &body.drawables);
                spawns.extend(body.spawned.iter().cloned());
                graph.particles.insert(name.clone(), body);
            }
        }
        events.push(EventNames {
            emitter,
            particle: particle.map(|(_, name)| name),
        });
    }
    Ok((EffectNames { events }, spawns))
}

/// В графе ещё есть место под правило эффекта.
fn ensure_room(graph: &RuleGraph) -> Result<()> {
    match graph.effects.len().checked_sub(MAX_RULES) {
        None => Ok(()),
        Some(_) => Err(Error::broken(format!(
            "YPT rule export names at most {MAX_RULES} rules."
        ))),
    }
}

/// Имена запроса без пробелов по краям; первое негодное имя — отказ с исходной строкой.
fn trimmed_names(names: &[String]) -> Result<Vec<String>> {
    names
        .iter()
        .map(|raw| {
            let name = raw.trim();
            if is_rule_name(name) {
                Ok(name.to_owned())
            } else {
                Err(Error::broken(format!("YPT rule name is invalid: {raw}")))
            }
        })
        .collect()
}

/// Обходит граф правил от заданных имён правил эффектов. Имена обрезаются по
/// краям и проверяются все до начала обхода; правила раскрываются волнами
/// (сначала все названные, затем порождённые ими и так далее), не найденные
/// уходят в `missing`.
pub fn walk(res: &Resource, names: &[String]) -> Result<RuleGraph> {
    let index = effect_positions(res)?;
    let mut wave = trimmed_names(names)?;
    let mut graph = RuleGraph::default();
    let mut seen: HashSet<String> = HashSet::new();
    while !wave.is_empty() {
        let mut next = Vec::new();
        for name in std::mem::take(&mut wave) {
            if !seen.insert(name.clone()) {
                continue;
            }
            match index.get(&name) {
                // Отсутствующее имя места не занимает: потолок считает найденные правила.
                None => graph.missing.push(name),
                Some(&rule) => {
                    ensure_room(&graph)?;
                    let (effect, spawns) = describe_effect(res, rule, &mut graph)?;
                    next.extend(spawns);
                    graph.effects.insert(name, effect);
                }
            }
        }
        wave = next;
    }
    for list in [&mut graph.textures, &mut graph.drawables] {
        list.sort_by(|a, b| cmp_ordinal_ignore_case(a, b));
    }
    Ok(graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::resource::{Header, SYSTEM_BASE};

    /// Образ ядра эффектов: системная область, объекты кладутся подряд.
    struct Image {
        data: Vec<u8>,
        top: usize,
    }

    impl Image {
        fn new() -> Self {
            Image {
                data: vec![0; 0x2_0000],
                top: 0x200,
            }
        }

        fn alloc(&mut self, size: usize) -> usize {
            let at = self.top.next_multiple_of(16);
            self.top = at + size;
            at
        }

        fn point(&mut self, at: usize, target: usize) {
            let word = SYSTEM_BASE + target as u64;
            self.data[at..at + 8].copy_from_slice(&word.to_le_bytes());
        }

        fn text(&mut self, text: &str) -> usize {
            let at = self.alloc(text.len() + 1);
            self.data[at..at + text.len()].copy_from_slice(text.as_bytes());
            at
        }

        /// Объект с указателем на имя по смещению `name_at`.
        fn named(&mut self, size: usize, name_at: usize, name: &str) -> usize {
            let object = self.alloc(size);
            let text = self.text(name);
            self.point(object + name_at, text);
            object
        }

        /// Массив указателей и заголовок списка на него в `list_at`.
        fn targets(&mut self, list_at: usize, targets: &[usize]) {
            let array = self.alloc(8 * targets.len().max(1));
            for (slot, &target) in targets.iter().enumerate() {
                self.point(array + slot * 8, target);
            }
            self.point(list_at, array);
            let count = (targets.len() as u16).to_le_bytes();
            self.data[list_at + 8..list_at + 10].copy_from_slice(&count);
        }

        fn event(&mut self, emitter: Option<&str>, particle: Option<usize>) -> usize {
            let event = self.alloc(0x80);
            if let Some(name) = emitter {
                let rule = self.named(0x40, 0x20, name);
                self.point(event + 0x40, rule);
            }
            if let Some(particle) = particle {
                self.point(event + 0x48, particle);
            }
            event
        }

        fn effect(&mut self, name: &str, events: &[usize]) -> usize {
            let effect = self.named(0x100, 0x20, name);
            if !events.is_empty() {
                self.targets(effect + 0x38, events);
            }
            effect
        }

        fn dictionary(&mut self, effects: &[usize]) {
            let dictionary = self.alloc(0x40);
            self.targets(dictionary + 0x30, effects);
            self.point(0x48, dictionary);
        }

        fn resource(self, version: u32) -> Resource {
            Resource::from_parts(header_of(self.data.len(), version), self.data)
        }
    }

    fn header_of(system_size: usize, version: u32) -> Header {
        Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size,
            graphics_size: 0,
            version,
            declared_version: version,
        }
    }

    /// Правило частицы с текстурами шейдера (тип, имя), моделями и порождениями.
    fn particle(
        img: &mut Image,
        name: &str,
        textures: &[(u8, &str)],
        models: &[&str],
        spawns: [usize; 2],
    ) -> usize {
        let particle = img.named(0x240, 0x120, name);
        let variables: Vec<usize> = textures
            .iter()
            .map(|&(kind, texture)| {
                let variable = img.named(0x40, 0x30, texture);
                img.data[variable + 0x14] = kind;
                variable
            })
            .collect();
        img.targets(particle + 0x1F0, &variables);
        let table = img.alloc(0x30 * models.len().max(1));
        for (slot, model) in models.iter().enumerate() {
            let text = img.text(model);
            img.point(table + slot * 0x30 + 0x10, text);
        }
        img.point(particle + 0x210, table);
        let count = (models.len() as u16).to_le_bytes();
        img.data[particle + 0x218..particle + 0x21A].copy_from_slice(&count);
        for (slot, target) in [0x78, 0xE8].into_iter().zip(spawns) {
            if target != 0 {
                img.point(particle + slot, target);
            }
        }
        particle
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    /// `fx_a` порождает `fx_b`, а тот снова `fx_a`; `fx_a` встречается в словаре дважды.
    fn cycle() -> Resource {
        let mut img = Image::new();
        let fx_a = img.effect("fx_a", &[]);
        let fx_b = img.effect("fx_b", &[]);
        let twin = img.effect("fx_a", &[]);
        let pt_a = particle(
            &mut img,
            "pt_a",
            &[(6, "tex_B"), (6, "TEX_b"), (5, "not_a_texture"), (6, "Tex_a")],
            &["dr_z", "DR_z"],
            [fx_b, 0],
        );
        let pt_b = particle(&mut img, "pt_b", &[], &[], [fx_a, 0]);
        let first = img.event(Some("em1"), Some(pt_a));
        let second = img.event(None, None);
        img.targets(fx_a + 0x38, &[first, second]);
        let third = img.event(None, Some(pt_b));
        img.targets(fx_b + 0x38, &[third]);
        img.dictionary(&[fx_a, fx_b, twin]);
        img.resource(68)
    }

    #[test]
    fn the_walk_follows_spawned_effects_and_stops_on_a_cycle() {
        let res = cycle();
        let graph = walk(&res, &names(&["fx_a"])).unwrap();
        assert_eq!(graph.effects.keys().collect::<Vec<_>>(), ["fx_a", "fx_b"]);
        let events = &graph.effects["fx_a"].events;
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].emitter.as_deref(), Some("em1"));
        assert_eq!(events[0].particle.as_deref(), Some("pt_a"));
        assert_eq!(events[1], EventNames::default());
        assert_eq!(graph.emitters.iter().collect::<Vec<_>>(), ["em1"]);
        let particle = &graph.particles["pt_a"];
        assert_eq!(particle.shader_textures, ["tex_B", "TEX_b", "Tex_a"]);
        assert_eq!(particle.drawables, ["dr_z", "DR_z"]);
        assert_eq!(particle.spawned, ["fx_b"]);
        // общие списки без повторов по регистру и по порядку без учёта регистра
        assert_eq!(graph.textures, ["Tex_a", "tex_B"]);
        assert_eq!(graph.drawables, ["dr_z"]);
        assert!(graph.missing.is_empty());
    }

    #[test]
    fn names_are_trimmed_and_unknown_ones_go_to_missing() {
        let res = cycle();
        let graph = walk(&res, &names(&["  fx_b\t", "nope", "FX_A"])).unwrap();
        assert_eq!(graph.effects.len(), 2);
        assert_eq!(graph.missing, ["nope", "FX_A"]);
        assert!(walk(&res, &[]).unwrap().effects.is_empty());
    }

    #[test]
    fn refusals_keep_their_texts() {
        let res = cycle();
        let err = walk(&res, &names(&["fx_a", " bad name "])).unwrap_err();
        assert_eq!(err.kind, Kind::Broken);
        assert_eq!(err.message, "YPT rule name is invalid:  bad name ");
        let foreign = Image::new().resource(13);
        let err = walk(&foreign, &[]).unwrap_err();
        assert_eq!(err.kind, Kind::Version);
        assert_eq!(
            err.message,
            "core.ypt версии 13 не поддерживается; ожидается Legacy 68."
        );
        let hollow = Resource::from_parts(header_of(0, 68), Vec::new());
        let err = effect_positions(&hollow).unwrap_err();
        assert_eq!(err.message, "Корень ресурса недоступен.");
    }

    #[test]
    fn the_first_of_two_effects_with_one_name_is_kept() {
        let res = cycle();
        let found = effect_positions(&res).unwrap();
        assert_eq!(found.keys().collect::<Vec<_>>(), ["fx_a", "fx_b"]);
        let listed = event_positions(&res, found["fx_a"]).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(event_objects(&res, listed[1]), (None, None));
    }

    #[test]
    fn more_than_the_ceiling_of_rules_is_refused() {
        let mut img = Image::new();
        let effects: Vec<usize> = (0..=MAX_RULES)
            .map(|n| img.effect(&format!("eff_{n:03}"), &[]))
            .collect();
        img.dictionary(&effects);
        let res = img.resource(68);
        let wanted: Vec<String> = (0..=MAX_RULES).map(|n| format!("eff_{n:03}")).collect();
        assert_eq!(
            walk(&res, &wanted[..MAX_RULES]).unwrap().effects.len(),
            MAX_RULES
        );
        let err = walk(&res, &wanted).unwrap_err();
        assert_eq!(err.message, "YPT rule export names at most 128 rules.");
        // имя, которого в файле нет, не занимает место и не упирается в потолок
        let mut with_absent: Vec<String> = wanted[..MAX_RULES].to_vec();
        with_absent.push("eff_absent".to_owned());
        let graph = walk(&res, &with_absent).unwrap();
        assert_eq!(graph.effects.len(), MAX_RULES);
        assert_eq!(graph.missing, ["eff_absent"]);
    }

    #[test]
    fn rule_names_follow_the_helper_pattern() {
        for good in ["bullet_tracer", "MUZ_pistol_2", "_", "0"] {
            assert!(is_rule_name(good), "{good:?}");
        }
        for bad in ["", "muz pistol", "muz-pistol", "a\n", "é", "а"] {
            assert!(!is_rule_name(bad), "{bad:?}");
        }
        assert!(is_rule_name(&"a".repeat(64)));
        assert!(!is_rule_name(&"a".repeat(65)));
        // 32 знака `é` дают 64 байта, но не латиницу.
        assert!(!is_rule_name(&"é".repeat(32)));
    }

    #[test]
    fn add_unique_keeps_the_first_spelling() {
        let mut list = Vec::new();
        let names: Vec<String> = ["ptfx_Muzzle", "PTFX_MUZZLE", "ptfx_other"]
            .map(String::from)
            .to_vec();
        absorb(&mut list, &names);
        assert_eq!(list, ["ptfx_Muzzle", "ptfx_other"]);
    }
}
