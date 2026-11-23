//! Собранное в памяти ядро эффектов для проверок правок правил и кадров и команды `ypt-patch`.
//!
//! Открыто (скрыто из документации), чтобы им пользовались и тесты команд движка; в поставке не используется.
//!
//! Одно правило эффекта `tracer` с одним событием, эмиттер `tracer` (свойство размера со своим
//! кадром), частица `tracer` с поведениями размера и цвета, лист `ptfx_tracer` 128×256 (пропорция 2).
//! Смещения — по `docs/rust-rewrite/ypt-schema.md`.

use super::names::hash_name;
use crate::resource::{Header, Resource, GRAPHICS_BASE, SYSTEM_BASE};

pub const SIZE_HASH: u32 = 0x38B6_0240;
pub const COLOUR_HASH: u32 = 0x164A_EA72;
pub const AGE_HASH: u32 = 0xF5B3_3BAA;

/// Имена свойств, которые правки ищут по хешу.
pub const SIZE_SCALAR: &str = "ptxEmitterRule:m_sizeScalarKFP";
pub const TBLR: &str = "ptxu_Size:m_tblrScalarKFP";
pub const WHD_MAX: &str = "ptxu_Size:m_whdMaxKFP";
pub const WHD_MIN: &str = "ptxu_Size:m_whdMinKFP";
pub const RGBA_MIN: &str = "ptxu_Colour:m_rgbaMinKFP";
pub const RGBA_MAX: &str = "ptxu_Colour:m_rgbaMaxKFP";
pub const ZOOM: &str = "ptxEffectRule:m_zoomScalarKFP";
pub const TINT_MIN: &str = "ptxEffectRule:m_colourTintMinKFP";

/// Где что лежит в собранном образце: смещения в системной области.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct Map {
    pub effect: usize,
    pub event: usize,
    pub emitter: usize,
    pub particle: usize,
    pub size: usize,
    pub colour: usize,
    pub evolution_frames: usize,
}

pub struct Core {
    pub bytes: Vec<u8>,
    pub map: Map,
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

    fn f32(&mut self, at: usize, value: f32) {
        self.put(at, &value.to_le_bytes());
    }

    fn pointer(&mut self, at: usize, target: usize) {
        self.put(at, &(SYSTEM_BASE + target as u64).to_le_bytes());
    }

    fn graphics_pointer(&mut self, at: usize, target: usize) {
        self.put(at, &(GRAPHICS_BASE + target as u64).to_le_bytes());
    }

    fn text(&mut self, text: &str) -> usize {
        let at = self.alloc(text.len() + 1);
        self.put(at, text.as_bytes());
        at
    }

    /// Список L64 в `at`: массив, число и ёмкость.
    fn list(&mut self, at: usize, array: usize, count: usize) {
        self.pointer(at, array);
        self.u16(at + 8, count as u16);
        self.u16(at + 10, count as u16);
    }

    /// Массив указателей на объекты и список при нём.
    fn pointers(&mut self, at: usize, items: &[usize]) {
        let array = self.alloc(items.len().max(1) * 8);
        for (index, &item) in items.iter().enumerate() {
            self.pointer(array + index * 8, item);
        }
        self.list(at, array, items.len());
    }

    /// Свойство с ключами в `at` (0x90): хеш имени и кадры `(время, значение)` с обратными длинами отрезков.
    fn property(&mut self, at: usize, name: &str, frames: &[(f32, [f32; 4])]) {
        self.u32(at, 0x0100_0000);
        self.u32(at + 0x68, hash_name(name));
        if frames.is_empty() {
            return;
        }
        let array = self.alloc(frames.len() * 0x20);
        let mut previous = -1.0f32;
        for (index, &(time, value)) in frames.iter().enumerate() {
            let inverse = if index == 0 {
                0.0
            } else {
                1.0 / (time - previous)
            };
            previous = time;
            let frame = array + index * 0x20;
            for (k, number) in [time, inverse, 0.0, 0.0].into_iter().enumerate() {
                self.f32(frame + k * 4, number);
            }
            for (k, number) in value.into_iter().enumerate() {
                self.f32(frame + 0x10 + k * 4, number);
            }
        }
        self.list(at + 0x70, array, frames.len());
    }

    /// Словарь: значения (список указателей @0x30) и хеши их имён (список u32 @0x20), по возрастанию хеша.
    fn dictionary(&mut self, items: &[usize], names: &[&str]) -> usize {
        let at = self.alloc(0x40);
        self.pointers(at + 0x30, items);
        let array = self.alloc(names.len().max(1) * 4);
        for (index, name) in names.iter().enumerate() {
            self.u32(array + index * 4, hash_name(name));
        }
        self.list(at + 0x20, array, names.len());
        at
    }
}

/// Описание листа образца: размеры, формат (FourCC как число) и число ступеней.
#[derive(Debug, Clone, Copy)]
pub struct SheetShape {
    pub width: u16,
    pub height: u16,
    pub four_cc: u32,
    pub levels: u8,
}

/// Лист образца по умолчанию: 128×256, `DXT1`, одна ступень, 16 384 байта данных.
pub const DEFAULT_SHEET: SheetShape = SheetShape {
    width: 128,
    height: 256,
    four_cc: 0x3154_5844,
    levels: 1,
};

/// Ядро с правилом `tracer`; `texture` — класть ли лист и пиксели.
pub fn core(texture: bool) -> Core {
    core_with(texture, DEFAULT_SHEET)
}

/// Ядро, у которого лист `ptfx_tracer` описан другой раскладкой (например, 16×8, `DXT5`, четыре ступени: по блокам 192
/// байта, как считает помощник — 170): данные в графической области те же 16 384 байта, лист занимает их начало.
pub fn core_with(texture: bool, sheet: SheetShape) -> Core {
    let mut m = Memory { system: Vec::new() };
    let root = m.alloc(0x60);
    assert_eq!(root, 0);

    // Поведения частицы.
    let size = m.alloc(0x280);
    m.u32(size + 8, SIZE_HASH);
    let whd_min = size + 0x30;
    let whd_max = size + 0xC0;
    let tblr = size + 0x150;
    let tblr_vel = size + 0x1E0;
    m.property(whd_min, WHD_MIN, &[(0.0, [0.1, 0.2, 0.0, 0.0])]);
    m.property(
        whd_max,
        WHD_MAX,
        &[(0.0, [0.2, 0.4, 0.0, 0.0]), (1.0, [0.1, 0.1, 0.0, 0.0])],
    );
    m.property(
        tblr,
        TBLR,
        &[(0.0, [1.0, 1.0, 0.5, 0.5]), (1.0, [2.0, 2.0, 0.25, 0.25])],
    );
    m.property(tblr_vel, "ptxu_Size:m_tblrVelScalarKFP", &[]);
    m.pointers(size + 0x10, &[whd_min, whd_max, tblr, tblr_vel]);
    m.system[size + 0x274] = 1;

    let colour = m.alloc(0x1F0);
    m.u32(colour + 8, COLOUR_HASH);
    let rgba_min = colour + 0x30;
    let rgba_max = colour + 0xC0;
    m.property(
        rgba_min,
        RGBA_MIN,
        &[(0.0, [1.0, 0.6, 0.2, 0.5]), (1.0, [0.5, 0.3, 0.1, 0.0])],
    );
    m.property(rgba_max, RGBA_MAX, &[(0.0, [1.0, 0.6, 0.2, 1.0])]);
    m.pointers(colour + 0x10, &[rgba_min, rgba_max]);

    let age = m.alloc(0x30);
    m.u32(age + 8, AGE_HASH);

    // Частица.
    let particle = m.alloc(0x240);
    let particle_name = m.text("tracer");
    m.pointer(particle + 0x120, particle_name);
    m.pointers(particle + 0x128, &[size, colour]);
    m.pointers(particle + 0x138, &[age]);
    m.pointers(particle + 0x148, &[size]);

    let (texture_at, var) = if texture {
        let var = m.alloc(0x40);
        m.system[var + 0x14] = 6;
        let name = m.text("ptfx_tracer");
        m.pointer(var + 0x30, name);
        m.pointers(particle + 0x1F0, &[var]);
        (name, var)
    } else {
        (0, 0)
    };
    let _ = (texture_at, var);

    // Эмиттер: десять встроенных свойств, размер — первое.
    let emitter = m.alloc(0x630);
    let emitter_name = m.text("tracer");
    m.pointer(emitter + 0x20, emitter_name);
    m.property(
        emitter + 0x78,
        SIZE_SCALAR,
        &[(0.0, [1.0, 1.0, 1.0, 100.0])],
    );
    m.property(
        emitter + 0x78 + 0x90,
        "ptxEmitterRule:m_spawnRateOverTimeKFP",
        &[(0.0, [5.0, 5.0, 5.0, 0.0])],
    );

    // Список эволюций события: размер с кадрами LOD.
    let evolution = m.alloc(0x40);
    let properties = m.alloc(0x18);
    let sets = m.alloc(0x30 * 2);
    // первый набор — не LOD, второй — LOD
    for (index, lod) in [0u8, 1].into_iter().enumerate() {
        let set = sets + index * 0x30;
        m.u32(set + 0x20, index as u32);
        m.system[set + 0x24] = lod;
        let keys = m.alloc(0x20 * 2);
        for k in 0..2 {
            let frame = keys + k * 0x20;
            m.f32(frame, k as f32);
            m.f32(frame + 4, if k == 0 { 0.0 } else { 1.0 });
            m.f32(frame + 0x10, 10.0 + index as f32 + k as f32);
        }
        m.list(set, keys, 2);
    }
    m.list(properties, sets, 2);
    m.u32(properties + 0x10, hash_name(SIZE_SCALAR));
    m.list(evolution + 0x10, properties, 1);

    // Событие и правило эффекта.
    let event = m.alloc(0x70);
    m.pointer(event + 0x18, evolution);
    m.pointer(event + 0x40, emitter);
    m.pointer(event + 0x48, particle);
    let effect = m.alloc(0x3C0);
    let effect_name = m.text("tracer");
    m.pointer(effect + 0x20, effect_name);
    m.pointers(effect + 0x38, &[event]);
    m.f32(effect + 0xAC, 0.0);
    m.f32(effect + 0xB0, 0.0);
    m.property(effect + 0xC0, TINT_MIN, &[(0.0, [1.0, 1.0, 1.0, 1.0])]);
    m.property(
        effect + 0xC0 + 0x90 * 2,
        ZOOM,
        &[(0.0, [1.0, 1.0, 1.0, 1.0]), (1.0, [2.0, 2.0, 2.0, 2.0])],
    );

    // Словари и корень.
    let effects = m.dictionary(&[effect], &["tracer"]);
    let emitters = m.dictionary(&[emitter], &["tracer"]);
    let particles = m.dictionary(&[particle], &["tracer"]);
    m.pointer(root + 0x38, particles);
    m.pointer(root + 0x48, effects);
    m.pointer(root + 0x50, emitters);
    let root_name = m.text("core");
    m.pointer(root + 0x10, root_name);

    let mut graphics = Vec::new();
    if texture {
        let dictionary = m.alloc(0x40);
        let object = m.alloc(0x80);
        let name = m.text("ptfx_tracer");
        m.pointer(object + 0x28, name);
        m.u16(object + 0x50, sheet.width);
        m.u16(object + 0x52, sheet.height);
        m.u16(object + 0x54, 1);
        m.u32(object + 0x58, sheet.four_cc);
        m.system[object + 0x5D] = sheet.levels;
        graphics = (0..16384usize)
            .map(|i| (i as u8).wrapping_mul(31).wrapping_add(7))
            .collect();
        m.graphics_pointer(object + 0x70, 0);
        m.pointers(dictionary + 0x30, &[object]);
        let hashes = m.alloc(4);
        m.u32(hashes, hash_name("ptfx_tracer"));
        m.list(dictionary + 0x20, hashes, 1);
        m.pointer(root + 0x20, dictionary);
    }

    let system_size = m.system.len().next_multiple_of(0x1000);
    m.system.resize(system_size, 0);
    let graphics_size = graphics.len().next_multiple_of(0x1000);
    graphics.resize(graphics_size, 0);
    let header = Header {
        system_flags: flags_for(system_size),
        graphics_flags: flags_for(graphics_size),
        system_size,
        graphics_size,
        version: 68,
        declared_version: 68,
    };
    let mut data = m.system;
    data.extend_from_slice(&graphics);
    let bytes = Resource::from_parts(header, data).to_file_bytes().unwrap();
    Core {
        bytes,
        map: Map {
            effect,
            event,
            emitter,
            particle,
            size,
            colour,
            evolution_frames: sets,
        },
    }
}

/// Слова-хеши образца, которые выглядят указателями (значение в диапазоне адресов области): положение в системной
/// области и значение. У ядер из `update.rpf` так выглядит вид поведения «модель» `0x6232E25A`.
pub struct RangeWords {
    pub property_graphics: (usize, u32),
    pub property_system: (usize, u32),
    pub leaf_graphics: (usize, u32),
}

impl RangeWords {
    pub fn all(&self) -> [(usize, u32); 3] {
        [self.property_graphics, self.property_system, self.leaf_graphics]
    }
}

/// Ядро с листом (`core(true)`), у которого три слова-хеша лежат в диапазоне адресов: хеш имени свойства (пустого
/// пятого слота правила эффекта) в графической области, хеш имени другого пустого слота в системной и хеш листа
/// переменной шейдера в графической. Схема объектов знает их положение, значение по виду от указателя не отличить.
pub fn core_with_range_hashes() -> (Core, RangeWords) {
    let core = core(true);
    let mut res = Resource::parse(&core.bytes).expect("образец читается");
    let list = res.pointer_at(core.map.particle + 0x1F0).expect("список переменных частицы");
    let var = res.pointer_at(list).expect("переменная листа");
    let words = RangeWords {
        property_graphics: (core.map.effect + 0xC0 + 0x90 + 0x68, GRAPHICS_BASE as u32 + 0x1000),
        property_system: (core.map.effect + 0xC0 + 0x90 * 3 + 0x68, SYSTEM_BASE as u32 + 0x300),
        leaf_graphics: (var + 0x38, GRAPHICS_BASE as u32 + 0x2000),
    };
    for (at, value) in words.all() {
        res.data_mut()[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }
    let bytes = res.to_file_bytes().expect("образец пишется");
    (Core { bytes, map: core.map }, words)
}

/// Флаги страниц для области из страниц по 0x1000: `count` страниц веса 1 при сдвиге 3 (0x200 << 3 = 0x1000).
fn flags_for(size: usize) -> u32 {
    if size == 0 {
        return 0x4000_0000;
    }
    let pages = (size / 0x1000) as u32;
    assert!(pages < 16, "образец мал");
    let mirrored = (0..4).fold(0u32, |acc, bit| acc | ((pages >> bit) & 1) << (27 - bit));
    0x4000_0000 | mirrored | 3
}
