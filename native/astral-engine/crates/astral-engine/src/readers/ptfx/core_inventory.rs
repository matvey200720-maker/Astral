//! Опись ядра эффектов игрока (раздел `core` ответа `read-ptfx-base`).
//!
//! Говорит, какие в ядре текстуры и правила и какие из слотов следа пули
//! (`astral_tracer_000` … `astral_tracer_015`) Astral сможет использовать. Недостающие
//! слоты установка достроит из штатного донора `bullet_tracer`, который лежит в самом
//! ядре; когда донора нет или слот собран не до конца, опись сообщает об этом заранее.
//! Модуль чистый: вход — разобранное ядро, выход — JSON.

use std::{
    cmp::Ordering,
    collections::{BTreeSet, HashSet},
    fmt,
};

use rage_res::ypt::Core;
use serde_json::Value;

use super::environment::object_of;
use crate::readers::js_text::cmp_utf16;

/// Строка, которая упорядочивается по единицам UTF-16, как в JS.
#[derive(PartialEq, Eq)]
struct Utf16Key<'a>(&'a str);

impl PartialOrd for Utf16Key<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Utf16Key<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        cmp_utf16(self.0, other.0)
    }
}

/// Имена без точных повторов в порядке единиц UTF-16.
fn sorted_unique<'a>(names: impl Iterator<Item = &'a str>) -> Vec<String> {
    let ordered: BTreeSet<Utf16Key> = names.map(Utf16Key).collect();
    ordered.into_iter().map(|key| key.0.to_owned()).collect()
}

/// Список имён как массив строк JSON.
fn listing(names: &[String]) -> Value {
    Value::from(names)
}

/// Из чего состоит слот; порядок — порядок подписей в сообщении.
#[derive(Clone, Copy)]
enum Part {
    Effect,
    Texture,
    Emitter,
    Particle,
}

impl Part {
    const IN_ORDER: [Part; 4] = [Part::Effect, Part::Texture, Part::Emitter, Part::Particle];

    fn label(self) -> &'static str {
        match self {
            Part::Effect => "правило эффекта",
            Part::Texture => "текстура",
            Part::Emitter => "эмиттер",
            Part::Particle => "правило частиц",
        }
    }
}

/// Слот следа: от номера зависят имена всех его частей.
#[derive(Clone, Copy)]
struct Slot(usize);

impl Slot {
    const COUNT: usize = 16;

    fn rule(self) -> String {
        format!("astral_tracer_{:03}", self.0)
    }

    /// Имя, под которым часть должна лежать в ядре.
    fn name_of(self, part: Part) -> String {
        match part {
            Part::Texture => format!("astral_tracer_tex_{:03}", self.0),
            _ => self.rule(),
        }
    }
}

/// Донор следа: и правило эффекта, и правило частиц с этим именем.
const DONOR: &str = "bullet_tracer";

/// Имена ядра, разложенные по частям слота: набор на каждую часть, в порядке `Part`.
struct Roster<'a>([HashSet<&'a str>; 4]);

impl<'a> Roster<'a> {
    fn of(core: &'a Core) -> Self {
        let effects = core.effect_rules.iter().map(|rule| rule.name.as_str());
        let textures = core.textures.iter().map(|texture| texture.name.as_str());
        let emitters = core.emitter_rules.iter().map(String::as_str);
        let particles = core.particle_rules.iter().map(String::as_str);
        Roster([
            effects.collect(),
            textures.collect(),
            emitters.collect(),
            particles.collect(),
        ])
    }

    fn holds(&self, part: Part, name: &str) -> bool {
        self.0[part as usize].contains(name)
    }

    /// Каких частей слота в ядре нет, в порядке подписей.
    fn lacking(&self, slot: Slot) -> Vec<Part> {
        Part::IN_ORDER
            .into_iter()
            .filter(|&part| !self.holds(part, &slot.name_of(part)))
            .collect()
    }

    /// Донор цел, когда он есть и как правило эффекта, и как правило частиц.
    fn has_donor(&self) -> bool {
        [Part::Effect, Part::Particle]
            .into_iter()
            .all(|part| self.holds(part, DONOR))
    }
}

/// Жалоба опись на ядро; `Display` — готовый текст сообщения.
enum Complaint {
    Unfinished { slot: String, lacking: Vec<Part> },
    NoDonor,
}

impl fmt::Display for Complaint {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Complaint::Unfinished { slot, lacking } => {
                let parts: Vec<&str> = lacking.iter().map(|part| part.label()).collect();
                write!(
                    out,
                    "Слот {slot} в ядре эффектов собран не полностью: нет {}. Так бывает, когда core.ypt правил сторонний инструмент. Откатите последнюю установку эффектов или верните исходный update.rpf — Astral построит слот сам.",
                    parts.join(", ")
                )
            }
            Complaint::NoDonor => write!(
                out,
                "В ядре эффектов вашей игры нет штатного правила {DONOR} — из него Astral строит след пули. Скорее всего core.ypt заменён редуксом, из которого оно вырезано. Верните штатный core.ypt (откатите редукс) или поставьте редукс с полным ядром и повторите."
            ),
        }
    }
}

/// Слоты, разложенные по состояниям, и жалоба на первый недостроенный.
#[derive(Default)]
struct Census {
    built: Vec<String>,
    unfinished: Vec<String>,
    vacant: Vec<String>,
    first_gap: Option<Complaint>,
}

impl Census {
    fn take(mut self, slot: Slot, roster: &Roster) -> Self {
        let name = slot.rule();
        let lacking = roster.lacking(slot);
        match (lacking.len(), self.first_gap.is_some()) {
            (0, _) => self.built.push(name),
            (n, _) if n == Part::IN_ORDER.len() => self.vacant.push(name),
            (_, true) => self.unfinished.push(name),
            (_, false) => {
                let slot = name.clone();
                self.first_gap = Some(Complaint::Unfinished { slot, lacking });
                self.unfinished.push(name);
            }
        }
        self
    }
}

/// Слоты следа: объект `slots` и список доступных слотов (то же, что в `slots.available`).
pub fn describe_core_slots(core: &Core) -> (Value, Vec<String>) {
    let roster = Roster::of(core);
    let census = (0..Slot::COUNT)
        .map(Slot)
        .fold(Census::default(), |census, slot| census.take(slot, &roster));
    // Донор нужен, только если есть что достраивать.
    let donor_missing = !census.vacant.is_empty() && !roster.has_donor();

    let Census {
        built,
        unfinished,
        vacant,
        first_gap,
    } = census;
    let complaints = first_gap
        .into_iter()
        .chain(donor_missing.then_some(Complaint::NoDonor));
    let message = complaints
        .map(|complaint| complaint.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    let (derivable, missing) = if donor_missing {
        (Vec::new(), vec![DONOR.to_owned()])
    } else {
        (vacant, Vec::new())
    };
    let status = match (message.is_empty(), derivable.is_empty()) {
        (false, _) => "unavailable",
        (true, false) => "derived",
        (true, true) => "present",
    };
    let available = sorted_unique(built.iter().chain(&derivable).map(String::as_str));

    let tracer = object_of([
        ("present", listing(&built)),
        ("derivable", listing(&derivable)),
        ("partial", listing(&unfinished)),
        ("missingDonors", listing(&missing)),
        ("donor", DONOR.into()),
        ("message", message.as_str().into()),
    ]);
    let slots = object_of([
        ("status", status.into()),
        ("available", listing(&available)),
        ("kinds", object_of([("tracer", tracer)])),
        ("message", message.into()),
    ]);
    (slots, available)
}

/// Версия набора слотов (зашита, с содержимым ядра не связана).
pub const ASTRAL_PTFX_CORE_VERSION: &str = "1.1.0";

/// Замечание о клоне правила в форме ответа.
fn clone_entry((effect, problem): (String, String)) -> Value {
    object_of([("effect", effect.into()), ("problem", problem.into())])
}

/// Раздел `core` целиком.
pub fn describe(core: &Core) -> Value {
    let textures = sorted_unique(core.textures.iter().map(|entry| entry.name.as_str()));
    let (slots, available) = describe_core_slots(core);
    let own_rules = core.effect_rules.iter().map(|rule| rule.name.as_str());
    let rules = sorted_unique(own_rules.chain(available.iter().map(String::as_str)));
    let clones: Vec<Value> = core.clone_problems().into_iter().map(clone_entry).collect();
    object_of([
        ("version", ASTRAL_PTFX_CORE_VERSION.into()),
        ("textures", textures.into()),
        ("effectRules", rules.into()),
        ("slots", slots),
        ("cloneProblems", clones.into()),
    ])
}

#[cfg(test)]
mod tests;
