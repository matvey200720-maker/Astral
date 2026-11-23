//! Ядро эффектов `core.ypt` Legacy: текстуры, правила и проверка «клонов Astral».
//!
//! Параметры самих правил читают модули подпапки; здесь список правил, события и списки эволюций.

pub mod clone_kit;
pub mod effect_clones;
pub mod effect_clones_tune;
pub mod evolutions;
pub mod export;
#[doc(hidden)]
pub mod fixture;
pub mod hash_words;
pub mod image;
pub mod layout;
pub mod names;
pub mod object_image;
pub mod own_donor;
pub mod pixels;
pub mod rule_patch;
pub mod rules;
#[doc(hidden)]
pub mod slot_fixture;
pub mod slot_reservations;
pub mod stock_keyframes;
pub mod structure;
pub mod vanilla;
pub mod writer;

use std::cmp::Ordering;

use crate::{
    error::{Error, Result},
    resource::{Resource, VERSION_YPT_LEGACY},
    texture::{self, TextureRef},
};

/// Закрытые смещения и пределы: `ИМЯ = значение;`.
macro_rules! offsets {
    ($($(#[$doc:meta])* $name:ident = $value:expr;)+) => {
        $($(#[$doc])* const $name: usize = $value;)+
    };
}

/// Открытая запись: `поле => тип`, порядок полей — как в списке.
macro_rules! core_record {
    ([$($derive:ident),+] $name:ident { $($field:ident => $kind:ty),+ $(,)? }) => {
        #[derive($($derive),+)]
        pub struct $name {
            $(pub $field: $kind),+
        }
    };
}

/// Больше событий на правило игра не проигрывает.
pub const MAX_EVENT_EMITTERS: usize = 7;
/// Больше эволюций у правила в данных игры не бывает.
pub const MAX_EVOLUTIONS: usize = 5;

offsets! {
    ROOT_NAME = 0x10;
    LIST_TEXTURES = 0x20;
    LIST_PARTICLE_RULES = 0x38;
    LIST_EFFECT_RULES = 0x48;
    LIST_EMITTER_RULES = 0x50;
    DICTIONARY_VALUES = 0x30;
    EFFECT_NAME = 0x20;
    EFFECT_EVENTS = 0x38;
    EFFECT_EVOLUTIONS = 0x48;
    EMITTER_RULE_NAME = 0x20;
    PARTICLE_RULE_NAME = 0x120;
    EVENT_EVOLUTIONS = 0x18;
    EVOLUTION_NAME_STRIDE = 0x18;
    EVOLUTION_PROPS = 0x10;
    PROP_STRIDE = 0x18;
    FRAME_STRIDE = 0x30;
    FRAME_NUMBER = 0x20;
    /// Потолки заявленных чисел (имён эволюций, событий).
    MAX_DECLARED = 4096;
}

const CLONE_PREFIX: &[u8] = b"astral_";
const FRAMES_OUTSIDE: &str = "has evolution frames outside its evolution list.";

core_record!([Debug, Clone, Default, PartialEq, Eq] EvolutionList {
    names => Vec<String>,
    frame_ids => Vec<i32>,
});

core_record!([Debug, Clone, Default] EventEmitter {
    evolutions => EvolutionList,
});

core_record!([Debug, Clone] EffectRule {
    name => String,
    events => Vec<EventEmitter>,
    evolutions => EvolutionList,
});

core_record!([Debug, Clone] Core {
    name => Option<String>,
    textures => Vec<TextureRef>,
    effect_rules => Vec<EffectRule>,
    emitter_rules => Vec<String>,
    particle_rules => Vec<String>,
});

impl EvolutionList {
    /// Все номера кадров указывают на имена списка из `count` штук.
    pub fn frames_inside(&self, count: usize) -> bool {
        let fits = |&id: &i32| matches!(usize::try_from(id), Ok(number) if number < count);
        self.frame_ids.iter().all(fits)
    }

    fn same_names_as(&self, other: &EvolutionList) -> bool {
        let equal = |(a, b): (&String, &String)| cmp_ordinal_ignore_case(a, b) == Ordering::Equal;
        self.names.len() == other.names.len() && self.names.iter().zip(&other.names).all(equal)
    }

    fn own_frames_fit(&self) -> bool {
        self.frames_inside(self.names.len())
    }
}

impl EffectRule {
    fn crowded_emitters(&self) -> Option<String> {
        let count = self.events.len();
        (count > MAX_EVENT_EMITTERS).then(|| {
            format!(
                "carries {count} emitters; GTA plays at most {MAX_EVENT_EMITTERS} per effect rule."
            )
        })
    }

    fn crowded_evolutions(&self) -> Option<String> {
        let count = self.evolutions.names.len();
        (count > MAX_EVOLUTIONS).then(|| {
            format!("carries {count} evolutions; game rules carry at most {MAX_EVOLUTIONS}.")
        })
    }

    fn stray_frames(&self) -> Option<String> {
        (!self.evolutions.own_frames_fit()).then(|| FRAMES_OUTSIDE.to_owned())
    }

    /// Первый из событий, чьи эволюции расходятся с правилом или чьи кадры вылезают.
    fn odd_emitter(&self) -> Option<String> {
        self.events.iter().find_map(|event| {
            let own = &event.evolutions;
            if !own.names.is_empty() && !own.same_names_as(&self.evolutions) {
                let (theirs, ours) = (own.names.join(", "), self.evolutions.names.join(", "));
                return Some(format!(
                    "has an emitter whose evolutions ({theirs}) differ from its rule ({ours})."
                ));
            }
            (!own.own_frames_fit()).then(|| FRAMES_OUTSIDE.to_owned())
        })
    }

    /// Первая причина, по которой правило не похоже на данные Rockstar.
    pub fn evolution_problem(&self) -> Option<String> {
        let checks: [fn(&Self) -> Option<String>; 4] = [
            Self::crowded_emitters,
            Self::crowded_evolutions,
            Self::stray_frames,
            Self::odd_emitter,
        ];
        checks.iter().find_map(|check| check(self))
    }
}

/// Сравнение строк как `OrdinalIgnoreCase`: верхний регистр, затем единицы UTF-16.
pub fn cmp_ordinal_ignore_case(left: &str, right: &str) -> Ordering {
    fn units(text: &str) -> Vec<u16> {
        let upper: String = text.chars().flat_map(char::to_uppercase).collect();
        upper.encode_utf16().collect()
    }
    units(left).cmp(&units(right))
}

/// Имя правила начинается с `astral_` (без учёта регистра ASCII).
fn is_clone_name(name: &str) -> bool {
    let head = name.as_bytes().get(..CLONE_PREFIX.len());
    head.is_some_and(|head| head.eq_ignore_ascii_case(CLONE_PREFIX))
}

impl Core {
    /// Правила `astral_…` с расхождением против данных игры: (имя, причина) по имени.
    pub fn clone_problems(&self) -> Vec<(String, String)> {
        let mut found = Vec::new();
        for rule in &self.effect_rules {
            if !is_clone_name(&rule.name) {
                continue;
            }
            if let Some(problem) = rule.evolution_problem() {
                found.push((rule.name.clone(), problem));
            }
        }
        found.sort_by(|a, b| cmp_ordinal_ignore_case(&a.0, &b.0));
        found
    }
}

/// Список «указатель, число, ёмкость» по смещению: где массив (если указатель годен) и сколько записей.
fn read_list(res: &Resource, at: usize) -> Result<(Option<usize>, usize)> {
    res.pointer_list(at)
        .map(|list| (res.at(list.entries), usize::from(list.count)))
}

/// Смещения объектов, на которые указывают первые `count` слов массива; пустые указатели опускаются.
fn pointed_objects(res: &Resource, array: usize, count: usize) -> Vec<usize> {
    let slots = (0..count).map(|index| array + index * 8);
    slots.filter_map(|slot| res.pointer_at(slot)).collect()
}

/// Объекты-значения словаря; пустые указатели опускаются.
fn dictionary_values(res: &Resource, dictionary: Option<usize>) -> Result<Vec<usize>> {
    let Some(dictionary) = dictionary else {
        return Ok(Vec::new());
    };
    let (array, count) = read_list(res, dictionary + DICTIONARY_VALUES)?;
    Ok(array.map_or_else(Vec::new, |array| pointed_objects(res, array, count)))
}

/// Имя из указателя в объекте; пустое и из одних пробелов — нет имени.
fn named(res: &Resource, object: usize, name_at: usize) -> Option<String> {
    let pointer = res.u64(object + name_at).ok()?;
    let text = res.cstring(pointer)?;
    (!text.trim().is_empty()).then_some(text)
}

/// Номера эволюций всех кадров всех свойств подряд.
fn read_frame_ids(res: &Resource, list: usize) -> Result<Vec<i32>> {
    let (props, count) = read_list(res, list + EVOLUTION_PROPS)?;
    let Some(props) = props else {
        return Ok(Vec::new());
    };
    (0..count).try_fold(Vec::new(), |mut ids, prop| {
        if let (Some(frames), frame_count) = read_list(res, props + prop * PROP_STRIDE)? {
            for frame in 0..frame_count {
                ids.push(res.u32(frames + frame * FRAME_STRIDE + FRAME_NUMBER)? as i32);
            }
        }
        Ok(ids)
    })
}

fn read_evolutions(res: &Resource, list: Option<usize>) -> Result<EvolutionList> {
    let Some(list) = list else {
        return Ok(EvolutionList::default());
    };
    let (array, count) = read_list(res, list)?;
    if count > MAX_DECLARED {
        return Err(Error::broken(
            "Список эволюций заявляет слишком много записей.",
        ));
    }
    let slots = array
        .into_iter()
        .flat_map(|array| (0..count).map(move |index| array + index * EVOLUTION_NAME_STRIDE));
    let names = slots
        .map(|slot| {
            res.u64(slot)
                .map(|pointer| res.cstring(pointer).unwrap_or_default())
        })
        .collect::<Result<Vec<String>>>()?;
    let frame_ids = read_frame_ids(res, list)?;
    Ok(EvolutionList { names, frame_ids })
}

fn read_effect_rule(res: &Resource, object: usize) -> Result<Option<EffectRule>> {
    let Some(name) = named(res, object, EFFECT_NAME) else {
        return Ok(None);
    };
    let (array, count) = read_list(res, object + EFFECT_EVENTS)?;
    if count > MAX_DECLARED {
        return Err(Error::broken(format!(
            "У правила «{name}» заявлено слишком много событий."
        )));
    }
    let event_objects = array.map_or_else(Vec::new, |array| pointed_objects(res, array, count));
    let events = event_objects
        .into_iter()
        .map(|event| {
            let list = res.pointer_at(event + EVENT_EVOLUTIONS);
            read_evolutions(res, list).map(|evolutions| EventEmitter { evolutions })
        })
        .collect::<Result<Vec<EventEmitter>>>()?;
    let evolutions = read_evolutions(res, res.pointer_at(object + EFFECT_EVOLUTIONS))?;
    Ok(Some(EffectRule {
        evolutions,
        events,
        name,
    }))
}

/// Имена объектов словаря по смещению поля имени.
fn rule_names(
    res: &Resource,
    root: usize,
    dictionary: usize,
    name_at: usize,
) -> Result<Vec<String>> {
    let values = dictionary_values(res, res.pointer_at(root + dictionary))?;
    let names = values.into_iter().map(|object| named(res, object, name_at));
    Ok(names.flatten().collect())
}

pub fn read(res: &Resource) -> Result<Core> {
    if res.version() != VERSION_YPT_LEGACY {
        return Err(Error::version(format!(
            "core.ypt версии {} не поддерживается; ожидается Legacy {VERSION_YPT_LEGACY}.",
            res.version()
        )));
    }
    let root = res
        .root()
        .ok_or_else(|| Error::broken("Корень ресурса недоступен."))?;

    let dictionary = res
        .pointer_at(root + LIST_TEXTURES)
        .ok_or_else(|| Error::broken("В core.ypt нет словаря текстур."))?;
    let textures = texture::read_dictionary_at(res, Some(dictionary))?;

    let rule_objects = dictionary_values(res, res.pointer_at(root + LIST_EFFECT_RULES))?;
    let rules = rule_objects
        .into_iter()
        .map(|object| read_effect_rule(res, object))
        .collect::<Result<Vec<Option<EffectRule>>>>()?;
    let emitter_rules = rule_names(res, root, LIST_EMITTER_RULES, EMITTER_RULE_NAME)?;
    let particle_rules = rule_names(res, root, LIST_PARTICLE_RULES, PARTICLE_RULE_NAME)?;

    let name_pointer = res.u64(root + ROOT_NAME)?;
    Ok(Core {
        particle_rules,
        emitter_rules,
        effect_rules: rules.into_iter().flatten().collect(),
        textures,
        name: Some(name_pointer)
            .filter(|&p| p != 0)
            .and_then(|p| res.cstring(p)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::resource::Header;
    use std::cmp::Ordering::{Equal, Greater, Less};

    const SIZE: usize = 128 * 1024;

    fn list(names: &[&str], frames: &[i32]) -> EvolutionList {
        EvolutionList {
            names: names.iter().copied().map(String::from).collect(),
            frame_ids: frames.to_vec(),
        }
    }

    fn rule(name: &str, events: &[EvolutionList], own: EvolutionList) -> EffectRule {
        let emitters = events
            .iter()
            .map(|evolutions| EventEmitter {
                evolutions: evolutions.clone(),
            })
            .collect();
        EffectRule {
            evolutions: own,
            events: emitters,
            name: name.to_owned(),
        }
    }

    fn plain_events(count: usize) -> Vec<EventEmitter> {
        vec![EventEmitter::default(); count]
    }

    #[test]
    fn frames_inside_the_list() {
        let inside = |ids: &[i32], count: usize| list(&[], ids).frames_inside(count);
        assert!(inside(&[], 0));
        assert!(!inside(&[0], 0));
        assert!(inside(&[0], 1));
        assert!(!inside(&[1], 1));
        assert!(!inside(&[-1], 3));
        assert!(inside(&[0, 1, 2], 3));
        assert!(!inside(&[0, 1, 3], 3));
        assert!(!inside(&[i32::MAX], 3));
        assert!(!inside(&[i32::MIN], 3));
        assert_eq!((MAX_EVENT_EMITTERS, MAX_EVOLUTIONS), (7, 5));
    }

    #[test]
    fn a_rule_like_rockstars_has_no_problem() {
        let own = list(&["size", "wind"], &[0, 1, 1]);
        let emitters = [list(&["size", "wind"], &[0, 1]), list(&[], &[])];
        let good = rule("astral_x", &emitters, own);
        assert_eq!(good.evolution_problem(), None);
    }

    #[test]
    fn limits_come_first() {
        let problem = |rule: &EffectRule| rule.evolution_problem();
        let mut many = rule("r", &[], EvolutionList::default());
        many.events = plain_events(7);
        assert_eq!(problem(&many), None);
        many.events = plain_events(8);
        assert_eq!(
            problem(&many).as_deref(),
            Some("carries 8 emitters; GTA plays at most 7 per effect rule.")
        );
        let five = ["a", "b", "c", "d", "e"];
        assert_eq!(problem(&rule("r", &[], list(&five, &[]))), None);
        let six = ["a", "b", "c", "d", "e", "f"];
        let wordy = rule("r", &[], list(&six, &[9]));
        assert_eq!(
            problem(&wordy).as_deref(),
            Some("carries 6 evolutions; game rules carry at most 5.")
        );
        let mut both = rule("r", &[], list(&six, &[]));
        both.events = plain_events(8);
        assert!(problem(&both).unwrap().starts_with("carries 8 emitters"));
    }

    #[test]
    fn frames_outside_the_own_list() {
        for frames in [&[2][..], &[-1]] {
            let bad = rule("r", &[], list(&["a", "b"], frames));
            assert_eq!(bad.evolution_problem().as_deref(), Some(FRAMES_OUTSIDE));
        }
    }

    #[test]
    fn emitters_are_compared_with_their_rule() {
        let own = list(&["size", "wind"], &[]);
        let cases: Vec<(Vec<EvolutionList>, EvolutionList, Option<&str>)> = vec![
            (
                vec![list(&["SIZE", "fire"], &[])],
                own.clone(),
                Some("has an emitter whose evolutions (SIZE, fire) differ from its rule (size, wind)."),
            ),
            (vec![list(&["SIZE", "WIND"], &[1])], own.clone(), None),
            (
                vec![list(&["size"], &[])],
                own.clone(),
                Some("has an emitter whose evolutions (size) differ from its rule (size, wind)."),
            ),
            (
                vec![list(&["size"], &[])],
                EvolutionList::default(),
                Some("has an emitter whose evolutions (size) differ from its rule ()."),
            ),
            (vec![list(&[], &[0])], own.clone(), Some(FRAMES_OUTSIDE)),
            (
                vec![list(&["size"], &[1])],
                list(&["size"], &[]),
                Some(FRAMES_OUTSIDE),
            ),
            (
                vec![list(&["a"], &[]), list(&["b"], &[])],
                list(&["a"], &[]),
                Some("has an emitter whose evolutions (b) differ from its rule (a)."),
            ),
            (
                vec![list(&["a"], &[3]), list(&["b"], &[])],
                list(&["a"], &[]),
                Some(FRAMES_OUTSIDE),
            ),
        ];
        for (number, (emitters, rule_list, want)) in cases.into_iter().enumerate() {
            let checked = rule("r", &emitters, rule_list);
            assert_eq!(
                checked.evolution_problem().as_deref(),
                want,
                "случай {number}"
            );
        }
    }

    fn core_of(rules: Vec<EffectRule>) -> Core {
        Core {
            particle_rules: vec![],
            emitter_rules: vec![],
            effect_rules: rules,
            textures: vec![],
            name: None,
        }
    }

    #[test]
    fn clone_problems_cover_astral_rules_only_and_sort_by_name() {
        let off = list(&["a"], &[3]);
        let names = [
            "veh_bad",
            "astral_b",
            "ASTRAL_a",
            "astral_ok",
            "Astral_Z",
            "astral",
            "астрал_x",
            "astraL_\u{e9}",
            "astra\u{e9}_x",
        ];
        let mut rules = Vec::new();
        for name in names {
            rules.push(match name {
                "veh_bad" => EffectRule {
                    events: plain_events(9),
                    ..rule(name, &[], EvolutionList::default())
                },
                "astral_b" => rule(name, &[], list(&["1", "2", "3", "4", "5", "6"], &[])),
                "astral_ok" | "astral" | "астрал_x" => {
                    rule(name, &[], EvolutionList::default())
                }
                _ => rule(name, &[], off.clone()),
            });
        }
        let got = core_of(rules).clone_problems();
        let outside = FRAMES_OUTSIDE.to_owned();
        let six = "carries 6 evolutions; game rules carry at most 5.";
        let want = [
            ("ASTRAL_a", outside.as_str()),
            ("astral_b", six),
            ("Astral_Z", outside.as_str()),
            ("astraL_\u{e9}", outside.as_str()),
        ];
        let want: Vec<(String, String)> = want
            .iter()
            .map(|&(name, why)| (name.to_owned(), why.to_owned()))
            .collect();
        assert_eq!(got, want);
    }

    #[test]
    fn clone_prefix_survives_char_boundaries_and_ties_keep_order() {
        let off = list(&["a"], &[3]);
        let names = [
            "astral_\u{e9}",
            "ast",
            "",
            "astral_b",
            "ASTRAL_B",
            "astral_B",
        ];
        let rules = names.iter().map(|name| rule(name, &[], off.clone()));
        let found: Vec<String> = core_of(rules.collect())
            .clone_problems()
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        assert_eq!(found, ["astral_b", "ASTRAL_B", "astral_B", "astral_\u{e9}"]);
    }

    #[test]
    fn ordinal_ignore_case_orders_like_dotnet() {
        // «левая|правая|знак»: < меньше, = равны, > больше.
        let table = [
            "abc|ABD|<",
            "_fog|a|>",
            "Zed|zed|=",
            "||=",
            "|a|<",
            "a|ab|<",
            "ab|a|>",
            "\u{df}|SS|=",
            "\u{df}|ss|=",
            "stra\u{df}e|STRASSE|=",
            "\u{131}|I|=",
            "i|\u{130}|<",
            "\u{130}|i|>",
            "\u{1c6}|\u{1c4}|=",
            "\u{1c5}|\u{1c6}|=",
            "\u{e9}|\u{c9}|=",
            "\u{e9}|e|>",
            "\u{44f}|\u{42f}|=",
            "\u{44f}|Z|>",
            "\u{ff5e}|\u{1f600}|>",
            "\u{1f600}|\u{ff5e}|<",
            "\u{1f600}|\u{1f601}|<",
            "a\u{301}|\u{e1}|<",
            "z|[|<",
            "z|_|<",
            "Z|_|<",
            "[|_|<",
            "\u{fb01}|FI|=",
        ];
        for row in table {
            let parts: Vec<&str> = row.split('|').collect();
            let expected = match parts[2] {
                "<" => Less,
                "=" => Equal,
                _ => Greater,
            };
            let got = cmp_ordinal_ignore_case(parts[0], parts[1]);
            assert_eq!(got, expected, "{:?} {:?}", parts[0], parts[1]);
        }
    }

    /// Ресурс версии 68 из 128 КиБ с корнем в начале; объекты кладутся с 0x100.
    struct Img {
        data: Vec<u8>,
        top: usize,
    }

    fn ptr(at: usize) -> u64 {
        0x5000_0000 + at as u64
    }

    impl Img {
        fn new() -> Self {
            Img {
                top: 0x100,
                data: vec![0; SIZE],
            }
        }
        fn alloc(&mut self, size: usize) -> usize {
            let at = self.top;
            self.top += size.next_multiple_of(16);
            at
        }
        fn put(&mut self, at: usize, bytes: &[u8]) {
            let slot = &mut self.data[at..at + bytes.len()];
            slot.copy_from_slice(bytes);
        }
        fn q(&mut self, at: usize, value: u64) {
            self.put(at, &value.to_le_bytes());
        }
        fn h(&mut self, at: usize, value: u16) {
            self.put(at, &value.to_le_bytes());
        }
        fn text(&mut self, text: &[u8]) -> u64 {
            let at = self.alloc(text.len() + 1);
            self.put(at, text);
            ptr(at)
        }
        /// Список указателей: массив, число и ёмкость по смещению `at`.
        fn pointers(&mut self, at: usize, items: &[u64]) {
            let array = self.alloc(items.len().max(1) * 8);
            for (slot, item) in (array..).step_by(8).zip(items) {
                self.q(slot, *item);
            }
            self.q(at, ptr(array));
            for offset in [8, 10] {
                self.h(at + offset, items.len() as u16);
            }
        }
        fn dictionary(&mut self, values: &[u64]) -> u64 {
            let at = self.alloc(0x40);
            self.pointers(at + 0x30, values);
            ptr(at)
        }
        /// Список эволюций: имена и кадры по свойствам.
        fn evolutions(&mut self, names: &[&str], props: &[&[i32]]) -> u64 {
            let at = self.alloc(0x40);
            let name_array = self.alloc(names.len().max(1) * 0x18);
            for (slot, name) in (name_array..).step_by(0x18).zip(names) {
                let text = self.text(name.as_bytes());
                self.q(slot, text);
            }
            self.q(at, ptr(name_array));
            self.h(at + 8, names.len() as u16);
            let table = self.alloc(props.len().max(1) * 0x18);
            for (row, frames) in (table..).step_by(0x18).zip(props) {
                let array = self.alloc(frames.len().max(1) * 0x30);
                for (cell, id) in (array + 0x20..).step_by(0x30).zip(*frames) {
                    self.put(cell, &id.to_le_bytes());
                }
                self.q(row, ptr(array));
                self.h(row + 8, frames.len() as u16);
            }
            self.q(at + 0x10, ptr(table));
            self.h(at + 0x18, props.len() as u16);
            ptr(at)
        }
        /// Объект события; список эволюций, если он есть, лежит по смещению 0x18.
        fn event(&mut self, evolutions: Option<u64>) -> u64 {
            let at = self.alloc(0x40);
            if let Some(list) = evolutions {
                self.q(at + 0x18, list);
            }
            ptr(at)
        }
        fn effect(&mut self, name: &[u8], events: &[u64], evolutions: Option<u64>) -> u64 {
            let at = self.alloc(0x60);
            let label = self.text(name);
            self.q(at + 0x20, label);
            self.pointers(at + 0x38, events);
            if let Some(list) = evolutions {
                self.q(at + 0x48, list);
            }
            ptr(at)
        }
        /// Ядро с пустым словарём текстур; остальное дописывают тесты.
        fn core(&mut self) -> usize {
            let textures = self.dictionary(&[]);
            self.q(0x20, textures);
            0
        }
        fn read(&self) -> Result<Core> {
            read(&resource(68, self.data.clone()))
        }
    }

    fn resource(version: u32, data: Vec<u8>) -> Resource {
        let header = Header {
            system_flags: ((version >> 4) << 28) | (2 << 17),
            graphics_flags: (version & 0xf) << 28,
            system_size: data.len(),
            graphics_size: 0,
            version,
            declared_version: version,
        };
        Resource::from_parts(header, data)
    }

    fn failure(result: Result<Core>) -> (Kind, String) {
        let error = result.unwrap_err();
        (error.kind, error.message)
    }

    #[test]
    fn versions_and_missing_dictionaries() {
        for version in [13, 46, 5, 69, 67, 0] {
            let (kind, text) = failure(read(&resource(version, vec![0; 0x1000])));
            assert_eq!(kind, Kind::Version);
            assert_eq!(
                text,
                format!("core.ypt версии {version} не поддерживается; ожидается Legacy 68.")
            );
        }
        let (kind, text) = failure(read(&resource(68, vec![0; 0x1000])));
        assert_eq!(kind, Kind::Broken);
        assert_eq!(text, "В core.ypt нет словаря текстур.");
    }

    #[test]
    fn an_empty_core_reads() {
        let mut img = Img::new();
        img.core();
        let core = img.read().unwrap();
        assert!(core.name.is_none());
        assert!(core.textures.is_empty());
        assert!(core.effect_rules.is_empty());
        assert!(core.emitter_rules.is_empty());
        assert!(core.particle_rules.is_empty());
    }

    #[test]
    fn name_and_a_plain_rule() {
        let mut img = Img::new();
        img.core();
        let name = img.text(b"core_name");
        img.q(0x10, name);
        let rule = img.effect(b"fx_one", &[], None);
        let dict = img.dictionary(&[rule]);
        img.q(0x48, dict);
        let core = img.read().unwrap();
        assert_eq!(core.name.as_deref(), Some("core_name"));
        assert_eq!(core.effect_rules.len(), 1);
        let one = &core.effect_rules[0];
        assert_eq!(one.name, "fx_one");
        assert!(one.events.is_empty());
        assert_eq!(one.evolutions, EvolutionList::default());
    }

    #[test]
    fn events_and_evolutions_are_flattened() {
        let mut img = Img::new();
        img.core();
        let with_names = |img: &mut Img| {
            let list = img.evolutions(&["size", "wind"], &[&[0]]);
            img.event(Some(list))
        };
        let (e1, e4) = (with_names(&mut img), with_names(&mut img));
        let plain = img.event(None);
        let own = img.evolutions(&["size", "wind"], &[&[0, 1], &[], &[1, -1]]);
        let rule = img.effect(b"astral_hit", &[e1, plain, 0, e4], Some(own));
        let dict = img.dictionary(&[rule]);
        img.q(0x48, dict);
        let core = img.read().unwrap();
        let hit = &core.effect_rules[0];
        assert_eq!(hit.events.len(), 3);
        assert_eq!(hit.events[0].evolutions, list(&["size", "wind"], &[0]));
        assert_eq!(hit.events[1].evolutions, EvolutionList::default());
        assert_eq!(hit.evolutions, list(&["size", "wind"], &[0, 1, 1, -1]));
        let want = vec![("astral_hit".to_owned(), FRAMES_OUTSIDE.to_owned())];
        assert_eq!(core.clone_problems(), want);
    }

    #[test]
    fn nameless_rules_are_skipped_and_names_are_kept_raw() {
        let mut img = Img::new();
        img.core();
        let mut values = Vec::new();
        for name in [&b""[..], b"   ", b"\t", b"  keep  ", b"ok"] {
            values.push(img.effect(name, &[], None));
        }
        let nameless = img.alloc(0x60);
        values.extend([ptr(nameless), 0]);
        let dict = img.dictionary(&values);
        img.q(0x48, dict);
        let rules = img.read().unwrap().effect_rules;
        let names: Vec<&str> = rules.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["  keep  ", "ok"]);

        let mut img = Img::new();
        img.core();
        let long = img.effect(&[b'n'; 300], &[], None);
        let dict = img.dictionary(&[long]);
        img.q(0x48, dict);
        assert_eq!(img.read().unwrap().effect_rules[0].name.len(), 256);
    }

    #[test]
    fn emitter_and_particle_rules() {
        let mut img = Img::new();
        img.core();
        let named_at = |img: &mut Img, offset: usize, name: &[u8]| {
            let at = img.alloc(0x140);
            let text = img.text(name);
            img.q(at + offset, text);
            ptr(at)
        };
        let emitters = [
            named_at(&mut img, 0x20, b"emit_a"),
            named_at(&mut img, 0x20, b"  "),
            0,
        ];
        let particles = [
            named_at(&mut img, 0x120, b"part_a"),
            named_at(&mut img, 0x120, b"part_b"),
        ];
        let emitter_dict = img.dictionary(&emitters);
        let particle_dict = img.dictionary(&particles);
        img.q(0x50, emitter_dict);
        img.q(0x38, particle_dict);
        let core = img.read().unwrap();
        assert_eq!(core.emitter_rules, ["emit_a"]);
        assert_eq!(core.particle_rules, ["part_a", "part_b"]);
    }

    #[test]
    fn declared_counts_have_ceilings() {
        // События.
        for (declared, ok) in [(4097u16, false), (4096, true)] {
            let mut img = Img::new();
            img.core();
            let rule = img.effect(b"many", &[], None);
            let at = rule as usize - 0x5000_0000;
            let dict = img.dictionary(&[rule]);
            img.q(0x48, dict);
            // Массив последним: за ним одни нули.
            let array = img.alloc(8);
            img.q(at + 0x38, ptr(array));
            img.h(at + 0x40, declared);
            match (img.read(), ok) {
                (Ok(core), true) => assert!(core.effect_rules[0].events.is_empty()),
                (Err(error), false) => {
                    assert_eq!(error.kind, Kind::Broken);
                    assert_eq!(
                        error.message,
                        "У правила «many» заявлено слишком много событий."
                    );
                }
                other => panic!("{other:?}"),
            }
        }
        // Имена эволюций.
        for (declared, ok) in [(4097u16, false), (4096, true)] {
            let mut img = Img::new();
            img.core();
            let own = img.evolutions(&[], &[]);
            let at = own as usize - 0x5000_0000;
            let rule = img.effect(b"names", &[], Some(own));
            let dict = img.dictionary(&[rule]);
            img.q(0x48, dict);
            let array = img.alloc(4);
            img.q(at, ptr(array));
            img.h(at + 8, declared);
            match (img.read(), ok) {
                (Ok(core), true) => {
                    let names = &core.effect_rules[0].evolutions.names;
                    assert_eq!((names.len(), names[0].as_str()), (4096, ""));
                }
                (Err(error), false) => assert_eq!(
                    error.message,
                    "Список эволюций заявляет слишком много записей."
                ),
                other => panic!("{other:?}"),
            }
        }
        // Свойства не ограничены.
        let mut img = Img::new();
        img.core();
        let own = img.evolutions(&[], &[]);
        let at = own as usize - 0x5000_0000;
        let rule = img.effect(b"props", &[], Some(own));
        let dict = img.dictionary(&[rule]);
        img.q(0x48, dict);
        let table = img.alloc(8);
        img.q(at + 0x10, ptr(table));
        img.h(at + 0x18, 5000);
        let frame_ids = &img.read().unwrap().effect_rules[0].evolutions.frame_ids;
        assert!(frame_ids.is_empty());

        // Текстуры.
        let mut img = Img::new();
        let textures = img.dictionary(&[]);
        let at = textures as usize - 0x5000_0000;
        img.h(at + 0x38, 4097);
        img.q(0x20, textures);
        assert_eq!(
            failure(img.read()).1,
            "Словарь текстур заявляет слишком много записей."
        );
    }

    #[test]
    fn unreadable_fields() {
        // Имя читается, список событий за концом данных.
        let mut img = Img::new();
        img.core();
        let text = img.text(b"edge");
        let end = SIZE - 0x28;
        img.put(end + 0x20, &text.to_le_bytes());
        let dict = img.dictionary(&[ptr(end)]);
        img.q(0x48, dict);
        let (kind, message) = failure(img.read());
        assert_eq!(kind, Kind::Broken);
        assert_eq!(message, "Чтение за концом данных ресурса.");

        // Имя за концом данных: правило пропущено.
        let mut img = Img::new();
        img.core();
        let dict = img.dictionary(&[ptr(SIZE - 0x10)]);
        img.q(0x48, dict);
        assert!(img.read().unwrap().effect_rules.is_empty());
    }

    #[test]
    fn a_texture_in_the_dictionary() {
        let mut img = Img::new();
        let object = img.alloc(0x90);
        let name = img.text(b"ptfx_smoke");
        img.q(object + 0x28, name);
        img.h(object + 0x50, 64);
        img.h(object + 0x52, 32);
        img.h(object + 0x54, 1);
        let code = crate::texture::Format::Dxt5.code();
        img.put(object + 0x58, &code.to_le_bytes());
        img.data[object + 0x5D] = 2;
        let data = img.alloc(4096);
        img.q(object + 0x70, ptr(data));
        let dict = img.dictionary(&[ptr(object)]);
        img.q(0x20, dict);
        let core = img.read().unwrap();
        let only = &core.textures[0];
        assert_eq!(
            (only.name.as_str(), only.width, only.height, only.format),
            ("ptfx_smoke", 64, 32, Some(crate::texture::Format::Dxt5))
        );
    }
}
