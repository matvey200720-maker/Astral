//! Собранное в памяти ядро из нескольких правил для проверок слотов следа и словаря-донора.
//!
//! Открыто (скрыто из документации), чтобы им пользовались и тесты команд движка; в поставке не используется.
//!
//! У ядра `fixture` одно правило; здесь правил столько, сколько попросят: каждое — свои события, эмиттеры и частицы
//! (имена в разных правилах могут совпадать — тогда правила делят эмиттер или частицу), у частицы — лист шейдера
//! `diffusetex2`, вторая переменная-лист без текстуры, поведение «лист кадров», порождаемый эффект, модель. Смещения —
//! как у настоящего ядра (`docs/rust-rewrite/ypt-schema.md`): правило 0x3C0, событие 0x70, эмиттер 0x630, частица 0x240.

use std::collections::BTreeMap;

use super::names::hash_name;
use crate::resource::{Header, Resource, GRAPHICS_BASE, SYSTEM_BASE};

/// Имя переменной шейдера, в которой частица держит свой лист.
pub const DIFFUSE: &str = "diffusetex2";
/// Хеш типа поведения «лист кадров».
pub const ANIMATE_HASH: u32 = 0xECA8_4C1E;
/// FourCC `DXT5`.
pub const DXT5: u32 = 0x3554_5844;

/// Лист: размеры, число ступеней и байт-заливка пикселей.
#[derive(Debug, Clone, Copy)]
pub struct Sheet {
    pub name: &'static str,
    pub width: u16,
    pub height: u16,
    pub levels: u8,
    pub fill: u8,
}

/// Поведение «лист кадров»: последний кадр, режим повтора, растяжение на жизнь частицы.
#[derive(Debug, Clone, Copy)]
pub struct Animation {
    pub last: i32,
    pub loop_mode: u8,
    pub scaled: u8,
}

/// Правило частицы.
#[derive(Debug, Clone, Copy)]
pub struct ParticleSpec {
    pub name: &'static str,
    /// Лист переменной `diffusetex2`; `None` — диффузной переменной нет.
    pub sheet: Option<&'static str>,
    /// Вторая переменная-лист с пустым указателем (так у настоящих частиц).
    pub null_var: bool,
    pub animation: Option<Animation>,
    pub frames: (u32, u32),
    /// Эффект, который частица рождает по доле жизни.
    pub spawns: Option<&'static str>,
    /// Частица рисует модель.
    pub model: bool,
}

impl ParticleSpec {
    pub const fn new(name: &'static str, sheet: Option<&'static str>) -> Self {
        ParticleSpec {
            name,
            sheet,
            null_var: true,
            animation: None,
            frames: (0, 0),
            spawns: None,
            model: false,
        }
    }
}

/// Правило эффекта: события — пары «эмиттер, частица» по именам.
#[derive(Debug, Clone)]
pub struct EffectSpec {
    pub name: &'static str,
    pub events: Vec<(&'static str, &'static str)>,
}

#[derive(Debug, Clone, Default)]
pub struct Spec {
    pub sheets: Vec<Sheet>,
    pub particles: Vec<ParticleSpec>,
    pub effects: Vec<EffectSpec>,
}

/// Где что лежит: смещения в системной области по именам.
#[derive(Debug, Clone, Default)]
pub struct Built {
    pub bytes: Vec<u8>,
    pub effects: BTreeMap<String, usize>,
    pub emitters: BTreeMap<String, usize>,
    pub particles: BTreeMap<String, usize>,
    pub sheets: BTreeMap<String, usize>,
    /// Смещения в графической области: где лежат пиксели листа.
    pub pixels: BTreeMap<String, (usize, usize)>,
}

struct Memory {
    system: Vec<u8>,
}

impl Memory {
    fn alloc(&mut self, length: usize) -> usize {
        let at = self.system.len().next_multiple_of(16);
        self.system.resize(at + length.next_multiple_of(16), 0);
        at
    }

    fn put(&mut self, at: usize, bytes: &[u8]) {
        self.system[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn u16(&mut self, at: usize, value: u16) {
        self.put(at, &value.to_le_bytes());
    }

    fn u32(&mut self, at: usize, value: u32) {
        self.put(at, &value.to_le_bytes());
    }

    fn pointer(&mut self, at: usize, target: usize) {
        self.put(at, &(SYSTEM_BASE + target as u64).to_le_bytes());
    }

    fn text(&mut self, text: &str) -> usize {
        let at = self.alloc(text.len() + 1);
        self.put(at, text.as_bytes());
        at
    }

    fn list(&mut self, at: usize, array: usize, count: usize, capacity: usize) {
        self.pointer(at, array);
        self.u16(at + 8, count as u16);
        self.u16(at + 10, capacity as u16);
    }

    /// Массив указателей на объекты и список при нём; пустой список — без массива.
    fn pointers(&mut self, at: usize, items: &[usize], capacity: usize) {
        if items.is_empty() && capacity == 0 {
            return;
        }
        let array = self.alloc(capacity.max(items.len()).max(1) * 8);
        for (index, &item) in items.iter().enumerate() {
            self.pointer(array + index * 8, item);
        }
        self.list(at, array, items.len(), capacity.max(items.len()));
    }

    /// Словарь: значения (список указателей @0x30) и хеши имён (список u32 @0x20), по возрастанию хеша.
    fn dictionary(&mut self, mut items: Vec<(String, usize)>) -> usize {
        items.sort_by_key(|(name, _)| hash_name(name));
        let at = self.alloc(0x40);
        let objects: Vec<usize> = items.iter().map(|(_, object)| *object).collect();
        self.pointers(at + 0x30, &objects, objects.len());
        let array = self.alloc(items.len().max(1) * 4);
        for (index, (name, _)) in items.iter().enumerate() {
            self.u32(array + index * 4, hash_name(name));
        }
        self.list(at + 0x20, array, items.len(), items.len());
        at
    }
}

fn pages_flags(size: usize) -> u32 {
    if size == 0 {
        return 0x4000_0000;
    }
    let pages = (size / 0x1000) as u32;
    assert!(pages < 16, "образец мал");
    let mirrored = (0..4).fold(0u32, |acc, bit| acc | ((pages >> bit) & 1) << (27 - bit));
    0x4000_0000 | mirrored | 3
}

/// Размер данных листа DXT5: блоки 4×4 по 16 байт, ступени подряд.
pub fn dxt5_bytes(width: usize, height: usize, levels: usize) -> usize {
    (0..levels)
        .map(|k| (width >> k).max(1).div_ceil(4) * (height >> k).max(1).div_ceil(4) * 16)
        .sum()
}

/// Собирает ядро по описанию.
pub fn build(spec: &Spec) -> Built {
    let mut m = Memory { system: Vec::new() };
    let root = m.alloc(0x60);
    assert_eq!(root, 0);
    let mut built = Built::default();

    // Листы: описание в системной области, пиксели — в графической.
    let mut graphics: Vec<u8> = Vec::new();
    let mut sheet_items = Vec::new();
    for sheet in &spec.sheets {
        let object = m.alloc(0x80);
        let name = m.text(sheet.name);
        m.pointer(object + 0x28, name);
        m.u16(object + 0x50, sheet.width);
        m.u16(object + 0x52, sheet.height);
        m.u16(object + 0x54, 1);
        m.u16(object + 0x56, sheet.width);
        m.u32(object + 0x58, DXT5);
        m.system[object + 0x5D] = sheet.levels;
        let bytes = dxt5_bytes(usize::from(sheet.width), usize::from(sheet.height), usize::from(sheet.levels));
        let at = graphics.len().next_multiple_of(16);
        graphics.resize(at, 0);
        graphics.extend((0..bytes).map(|k| sheet.fill.wrapping_add(k as u8)));
        m.put(object + 0x70, &(GRAPHICS_BASE + at as u64).to_le_bytes());
        built.sheets.insert(sheet.name.to_owned(), object);
        built.pixels.insert(sheet.name.to_owned(), (at, bytes));
        sheet_items.push((sheet.name.to_owned(), object));
    }

    // Правила эффектов заводятся первыми: частица может рождать другое правило.
    for effect in &spec.effects {
        let object = m.alloc(0x3C0);
        let name = m.text(effect.name);
        m.pointer(object + 0x20, name);
        m.pointer(object + 0x28, root);
        m.u32(object + 0x10, 1);
        built.effects.insert(effect.name.to_owned(), object);
    }

    // Эмиттеры и частицы: один объект на имя, счётчик ссылок — 1 + число событий.
    let mut emitter_uses: BTreeMap<&str, u32> = BTreeMap::new();
    let mut particle_uses: BTreeMap<&str, u32> = BTreeMap::new();
    for effect in &spec.effects {
        for &(emitter, particle) in &effect.events {
            *emitter_uses.entry(emitter).or_default() += 1;
            *particle_uses.entry(particle).or_default() += 1;
        }
    }
    for (&name, &uses) in &emitter_uses {
        let object = m.alloc(0x630);
        let text = m.text(name);
        m.pointer(object + 0x20, text);
        m.u32(object + 0x10, 1 + uses);
        built.emitters.insert(name.to_owned(), object);
    }
    for (&name, &uses) in &particle_uses {
        let spec = spec
            .particles
            .iter()
            .find(|candidate| candidate.name == name)
            .unwrap_or_else(|| panic!("частица {name} не описана"));
        let object = m.alloc(0x240);
        let text = m.text(name);
        m.pointer(object + 0x120, text);
        m.u32(object + 0x10, 1 + uses);
        m.u32(object + 0x118, spec.frames.0);
        m.u32(object + 0x11C, spec.frames.1);
        if let Some(animation) = spec.animation {
            let behaviour = m.alloc(0xD0);
            m.u32(behaviour + 8, ANIMATE_HASH);
            m.put(behaviour + 0xC4, &animation.last.to_le_bytes());
            m.system[behaviour + 0xC8] = animation.loop_mode;
            m.system[behaviour + 0xCD] = animation.scaled;
            m.pointers(object + 0x128, &[behaviour], 0);
            m.pointers(object + 0x148, &[behaviour], 0);
        }
        let mut vars = Vec::new();
        if let Some(sheet) = spec.sheet {
            let var = m.alloc(0x40);
            m.u32(var + 0x10, hash_name(DIFFUSE));
            m.system[var + 0x14] = 6;
            let texture = *built.sheets.get(sheet).unwrap_or_else(|| panic!("лист {sheet} не описан"));
            m.pointer(var + 0x28, texture);
            let label = m.text(sheet);
            m.pointer(var + 0x30, label);
            m.u32(var + 0x38, hash_name(&sheet.to_lowercase()));
            vars.push(var);
        }
        if spec.null_var {
            let var = m.alloc(0x40);
            m.u32(var + 0x10, hash_name("bumptex"));
            m.system[var + 0x14] = 6;
            vars.push(var);
        }
        m.pointers(object + 0x1F0, &vars, 0);
        if let Some(target) = spec.spawns {
            let effect = *built.effects.get(target).unwrap_or_else(|| panic!("эффект {target} не описан"));
            m.pointer(object + 0x20 + 0x58, effect);
        }
        if spec.model {
            let model = m.alloc(0x40);
            let rows = m.alloc(0x30);
            m.pointer(rows + 0x18, model);
            m.list(object + 0x210, rows, 1, 1);
        }
        built.particles.insert(name.to_owned(), object);
    }

    // События: массив указателей ёмкостью 32, как у настоящих правил.
    for effect in &spec.effects {
        let object = built.effects[effect.name];
        let mut events = Vec::new();
        for (index, &(emitter, particle)) in effect.events.iter().enumerate() {
            let event = m.alloc(0x70);
            m.u32(event + 0x08, index as u32);
            let emitter_label = m.text(emitter);
            let particle_label = m.text(particle);
            m.pointer(event + 0x30, emitter_label);
            m.pointer(event + 0x38, particle_label);
            m.pointer(event + 0x40, built.emitters[emitter]);
            m.pointer(event + 0x48, built.particles[particle]);
            events.push(event);
        }
        m.pointers(object + 0x38, &events, 32);
    }

    // Словари и корень.
    let textures = m.dictionary(sheet_items);
    let effects = m.dictionary(built.effects.iter().map(|(name, &o)| (name.clone(), o)).collect());
    let emitters = m.dictionary(built.emitters.iter().map(|(name, &o)| (name.clone(), o)).collect());
    let particles = m.dictionary(built.particles.iter().map(|(name, &o)| (name.clone(), o)).collect());
    m.pointer(root + 0x20, textures);
    m.pointer(root + 0x38, particles);
    m.pointer(root + 0x48, effects);
    m.pointer(root + 0x50, emitters);
    let root_name = m.text("core");
    m.pointer(root + 0x10, root_name);

    let system_size = m.system.len().next_multiple_of(0x1000);
    m.system.resize(system_size, 0);
    let graphics_size = graphics.len().next_multiple_of(0x1000);
    graphics.resize(graphics_size, 0);
    let header = Header {
        system_flags: pages_flags(system_size),
        graphics_flags: pages_flags(graphics_size),
        system_size,
        graphics_size,
        version: 68,
        declared_version: 68,
    };
    let mut data = m.system;
    data.extend_from_slice(&graphics);
    built.bytes = Resource::from_parts(header, data).to_file_bytes().unwrap();
    built
}

/// Ядро для проверок: след с двумя событиями (дым и сам след), лист 4×4-кадров с анимацией, правило, которое
/// рождает другое, правило с моделью.
pub fn sample() -> Built {
    let mut tracer = ParticleSpec::new("tracer", Some("ptfx_tracer"));
    tracer.frames = (3, 3);
    let smoke = ParticleSpec::new("tracer_smoke", Some("ptfx_smoke"));
    let mut blood = ParticleSpec::new("blood_dust", Some("ptfx_spray"));
    blood.animation = Some(Animation {
        last: 12,
        loop_mode: 1,
        scaled: 0,
    });
    blood.frames = (1, 2);
    let mut fires = ParticleSpec::new("fires", Some("ptfx_tracer"));
    fires.spawns = Some("tracer");
    let mut shell = ParticleSpec::new("shell", Some("ptfx_smoke"));
    shell.model = true;
    let bare = ParticleSpec::new("bare", None);
    build(&Spec {
        sheets: vec![
            Sheet { name: "ptfx_tracer", width: 16, height: 16, levels: 3, fill: 7 },
            Sheet { name: "ptfx_smoke", width: 16, height: 8, levels: 2, fill: 40 },
            Sheet { name: "ptfx_spray", width: 32, height: 32, levels: 4, fill: 90 },
            Sheet { name: "ptfx_unused", width: 8, height: 8, levels: 1, fill: 200 },
        ],
        particles: vec![tracer, smoke, blood, fires, shell, bare],
        effects: vec![
            EffectSpec { name: "tracer", events: vec![("tracer_smoke", "tracer_smoke"), ("tracer", "tracer")] },
            EffectSpec { name: "blood", events: vec![("blood", "blood_dust"), ("blood_extra", "blood_dust")] },
            EffectSpec { name: "fires", events: vec![("fires", "fires")] },
            EffectSpec { name: "shells", events: vec![("shell", "shell")] },
            EffectSpec { name: "plain", events: vec![("bare", "bare")] },
        ],
    })
}
