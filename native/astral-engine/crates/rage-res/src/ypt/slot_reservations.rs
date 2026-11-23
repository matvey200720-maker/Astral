//! Слоты Astral в ядре эффектов игрока: `slotReservations` режима `ypt-texture-patch` помощника.
//!
//! Мастерская «Попадания и трейсеры» пишет след в правила `astral_tracer_NNN` (и прежде попадание в
//! `astral_impact_NNN`). Слот строится из ядра, которое уже лежит у игрока: двоичная копия правила-донора (эмиттеры,
//! частицы, физика, эволюции), один эмиттер — тот, чьи частицы рисуют лист слота, свои имена, лист слота из DDS запроса,
//! кадры частицы на сетку этого листа, вставка в словари по хешу имени. Штатные объекты не трогаются вовсе: слот получает
//! собственные эмиттер и частицы, а не делит штатные (иначе пришлось бы править счётчики ссылок штатных правил).
//!
//! Правила копии (сняты с настоящего ядра Legacy): у эмиттера и частицы счётчик ссылок `1 + число событий, которые на них
//! ссылаются` (у слота — 2), у правила эффекта — 1; ёмкость массива событий (32) сохраняется, событие одно и с номером 0;
//! словари стоят по возрастанию хеша имени в нижнем регистре.
//!
//! Что в этом файле: проверка заказа, постройка слотов в образе (`apply`) и проверки перечитанного файла (`verify_*`).
//! Опись записей до и после, чужие хеши и допущенные дефекты графа — `vanilla`; запись файла и чтение — у вызывающего
//! (`Structure::into_file`, `Image::parse`).

use std::collections::{HashMap, HashSet};

use super::image::{
    Image, EFFECT_NAME, EMITTER_NAME, PARTICLE_NAME, ROOT_EFFECTS, ROOT_EMITTERS, ROOT_PARTICLES, ROOT_TEXTURES,
    TEXTURE_NAME,
};
use super::names::hash_name;
use super::structure::{
    EffectCopy, EffectNames, Kind, Structure, TextureSpec, EFFECT_EVENTS, EVENT_EMITTER, EVENT_EMITTER_NAME,
    EVENT_PARTICLE, EVENT_PARTICLE_NAME, PARTICLE_VARS, VAR_KIND, VAR_KIND_TEXTURE, VAR_TEXTURE, VAR_TEXTURE_HASH,
    VAR_TEXTURE_NAME,
};
use crate::dds;
use crate::error::{Error, Result};
use crate::resource_graph::Segment;
use crate::texture::Format;

/// Счётчик ссылок объекта правила (правило эффекта, эмиттер, частица).
pub const REF_COUNT: usize = 0x10;
/// Частица: кадры листа (первый и последний допустимые).
pub const PARTICLE_FRAME_MIN: usize = 0x118;
pub const PARTICLE_FRAME_MAX: usize = 0x11C;
/// Хеш типа поведения «лист кадров» и его поля.
pub const ANIMATE_TEXTURE: u32 = 0xECA8_4C1E;
pub const ANIMATE_LAST_FRAME: usize = 0xC4;
pub const ANIMATE_LOOP_MODE: usize = 0xC8;
pub const ANIMATE_SCALED: usize = 0xCD;
/// Списки поведений частицы: все, начальные, обновление, завершение обновления, рисование.
const BEHAVIOUR_LISTS: [usize; 5] = [0x128, 0x138, 0x148, 0x158, 0x168];
const BEHAVIOUR_TYPE: usize = 8;

/// Больше слотов за раз помощник не строит.
pub const MAX_RESERVATIONS: usize = 32;
/// Сетка кадров листа: не больше стороны.
pub const MAX_SHEET_EDGE: i32 = 16;
const ASTRAL_PREFIX: &str = "astral_";

/// Отказы чтения DDS, у которых у помощника свои исключения (текст сообщения несёт вид отказа).
pub const DDS_MAGIC: &str = "Invalid DDS magic!";
pub const DDS_SHORT: &str = "Unable to read beyond the end of the stream.";
pub const DDS_FORMAT: &str = "Unknown DDS format.";
/// Отказ помощника на листе, чьи данные после записи читаются иначе, чем заявлено (проверка конца записи).
pub const STRUCTURE_CHANGED: &str = "YPT structure changed while applying texture patches.";
/// Лист с данными длины помощника, короче длины «по блокам»: помощник его строит, движок пока нет. Команда превращает это
/// сообщение в отказ `NotInEngine`, и запрос уходит помощнику.
pub const SHEET_HELPER_LAYOUT: &str =
    "YPT new sheet in the helper layout (small levels without a block) is not in the engine yet; the helper writes it.";

/// Сетка кадров листа слота (как в `ptxclipregions.dat`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Sheet {
    pub columns: i32,
    pub rows: i32,
}

/// Кадры частицы слота: первый кадр и, если у донора есть анимация листа, последний кадр, режим повтора и растяжение на
/// жизнь частицы.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Frames {
    pub min: i32,
    pub max: i32,
    pub last: Option<i32>,
    pub loop_mode: Option<i32>,
    pub scaled_over_life: Option<bool>,
}

/// Заказ слота: имя правила (эффект, эмиттер и частицы носят одно имя), имя листа, донор из ядра игрока.
/// Пустые поля — как `null` у помощника.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Reservation {
    pub effect: Option<String>,
    pub texture: Option<String>,
    pub donor_effect: Option<String>,
    pub donor_particle: Option<String>,
    pub sheet: Option<Sheet>,
    pub frames: Option<Frames>,
}

/// Что вышло из одного слота (`slotReservations.reserved[]` ответа).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservedSlot {
    pub effect: String,
    pub texture: String,
    pub donor_effect: String,
    pub donor_emitter: String,
    pub donor_particle: String,
    pub donor_texture: String,
    pub dropped_emitters: usize,
    pub width: u32,
    pub height: u32,
    pub levels: u32,
    /// Имя формата в записи помощника: `D3DFMT_DXT5`.
    pub format: String,
    pub columns: i32,
    pub rows: i32,
    pub frame_min: u32,
    pub frame_max: u32,
    pub last_frame: Option<i32>,
}

/// DDS листов слотов по имени листа (верхний регистр).
pub type Payloads = HashMap<String, Vec<u8>>;

fn broken(text: impl Into<String>) -> Error {
    Error::broken(text)
}

fn text(value: &Option<String>) -> &str {
    value.as_deref().unwrap_or_default()
}

/// `^astral_[a-z0-9_]{1,56}$` (как у регулярного выражения помощника: перевод строки в конце допускается).
fn is_slot_name(name: &str) -> bool {
    let body = name.strip_suffix('\n').unwrap_or(name);
    body.strip_prefix(ASTRAL_PREFIX).is_some_and(|rest| {
        (1..=56).contains(&rest.len()) && rest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    })
}

/// `^[a-z0-9_]{1,64}$`.
fn is_donor_name(name: &str) -> bool {
    let body = name.strip_suffix('\n').unwrap_or(name);
    (1..=64).contains(&body.len()) && body.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn upper_names(names: Vec<String>) -> HashSet<String> {
    names.into_iter().filter(|name| !name.is_empty()).map(|name| name.to_uppercase()).collect()
}

/// Проверка заказа до любой правки: имена, повторы, занятые имена, сетка и кадры.
pub fn validate(structure: &Structure, reservations: &[Reservation]) -> Result<()> {
    let effects = upper_names(structure.names(Kind::Effect)?);
    let emitters = upper_names(structure.names(Kind::Emitter)?);
    let particles = upper_names(structure.names(Kind::Particle)?);
    let textures = upper_names(structure.names(Kind::Texture)?);
    let mut slots: HashSet<String> = HashSet::new();
    let mut slot_textures: HashSet<String> = HashSet::new();
    for item in reservations {
        let (Some(sheet), Some(wanted)) = (item.sheet, item.frames) else {
            return Err(broken("YPT slot reservation is incomplete."));
        };
        let (effect, texture) = (text(&item.effect), text(&item.texture));
        if !is_slot_name(effect) || !is_slot_name(texture) {
            return Err(broken(format!(
                "YPT slot names must live in the astral_ namespace: {effect}/{texture}"
            )));
        }
        if !is_donor_name(text(&item.donor_effect)) || !is_donor_name(text(&item.donor_particle)) {
            return Err(broken(format!("YPT slot donor names are invalid: {effect}")));
        }
        if !slots.insert(effect.to_uppercase()) || !slot_textures.insert(texture.to_uppercase()) {
            return Err(broken(format!("YPT slot is reserved twice: {effect}")));
        }
        let key = effect.to_uppercase();
        if effects.contains(&key) || emitters.contains(&key) || particles.contains(&key) {
            return Err(broken(format!("YPT already contains rule {effect}.")));
        }
        if textures.contains(&texture.to_uppercase()) {
            return Err(broken(format!("YPT already contains texture {texture}.")));
        }
        if !(1..=MAX_SHEET_EDGE).contains(&sheet.columns) || !(1..=MAX_SHEET_EDGE).contains(&sheet.rows) {
            return Err(broken(format!("YPT slot sheet is out of range: {effect}")));
        }
        let cells = sheet.columns * sheet.rows;
        let bad_last = wanted.last.is_some_and(|last| last < 0 || last >= cells);
        let bad_loop = wanted.loop_mode.is_some_and(|mode| !(0..=8).contains(&mode));
        if wanted.min < 0 || wanted.max < wanted.min || wanted.max >= cells || bad_last || bad_loop {
            return Err(broken(format!("YPT slot frames do not fit its sheet: {effect}")));
        }
    }
    Ok(())
}

/// DDS листа слота: отказы с теми же текстами, что у помощника.
pub fn read_dds(bytes: &[u8], name: &str) -> Result<dds::Dds> {
    read_dds_with(bytes, name, false)
}

/// То же для DDS, который шлёт приложение подмене листа ядра (`yptTextureDds`): данные мелких ступеней без округления до
/// блока 4×4 принимаются наравне с длиной «по блокам»; сверку длины с листом ядра делает вызывающий.
pub fn read_app_dds(bytes: &[u8], name: &str) -> Result<dds::Dds> {
    read_dds_with(bytes, name, true)
}

fn read_dds_with(bytes: &[u8], name: &str, helper_layout: bool) -> Result<dds::Dds> {
    if !bytes.starts_with(b"DDS ") {
        return Err(broken(DDS_MAGIC));
    }
    if bytes.len() < 128 {
        return Err(broken(DDS_SHORT));
    }
    let parsed = if helper_layout { dds::parse_helper_layout(bytes) } else { dds::parse(bytes) };
    parsed.map_err(|error| {
        if error.message.starts_with("DDS формат") {
            Error::argument(DDS_FORMAT)
        } else {
            broken(format!("DDS could not be decoded: {name}"))
        }
    })
}

/// Годится ли DDS новому листу (слота или клона) так, как судит помощник. Данные нового листа лежат у него длиной
/// `Format::helper_total_bytes` (мелкие ступени без округления до блока 4×4); после записи он перечитывает лист и отказывает,
/// если вышло иначе («YPT structure changed …»):
///
/// * данных не столько (DDS «по блокам» с мелкими ступенями, у каждой — не меньше блока) — отказ;
/// * у цепочки есть ступень без данных (неквадратная цепочка дошла до нулевой высоты, у `DXT1` 1×1 — полбайта) — отказ;
/// * данных ровно столько, а раскладка отличается от «по блокам» — помощник такой лист строит, движок пока нет: сообщение
///   `SHEET_HELPER_LAYOUT` (команда отвечает `NotInEngine`, запрос уходит помощнику).
///
/// У листов без ступеней мельче блока обе длины равны, и такой DDS идёт как шёл.
pub fn check_new_sheet(image: &dds::Dds) -> Result<()> {
    let levels = u32::from(image.levels);
    let helper = image.format.helper_total_bytes(image.width, image.height, levels);
    let empty_level = (0..levels).any(|k| {
        let side = |full: u32| full.checked_shr(k).unwrap_or(0) as usize;
        image.format.helper_level_bytes(side(image.width), side(image.height)) == 0
    });
    if image.payload.len() != helper || empty_level {
        return Err(broken(STRUCTURE_CHANGED));
    }
    let by_blocks: usize = (0..levels)
        .map(|k| {
            let side = |full: u32| (full.checked_shr(k).unwrap_or(0) as usize).max(1);
            image.format.level_bytes(side(image.width), side(image.height))
        })
        .sum();
    if by_blocks != helper {
        return Err(broken(SHEET_HELPER_LAYOUT));
    }
    Ok(())
}

/// Шаг строки листа в описании: как его пишет помощник (блочные форматы — блоки строки, делённые на 4 байта).
fn stride_of(format: Format, width: u32) -> u16 {
    let wide = width as usize;
    let stride = match format {
        Format::Dxt1 | Format::Ati1 => wide.div_ceil(4) * 2,
        Format::Dxt3 | Format::Dxt5 | Format::Ati2 | Format::Bc7 => wide.div_ceil(4) * 4,
        Format::A8R8G8B8 | Format::X8R8G8B8 | Format::A8B8G8R8 => wide * 4,
        Format::A8 | Format::L8 => wide,
    };
    u16::try_from(stride).unwrap_or(u16::MAX)
}

/// Поведения частицы без повторов, в порядке пяти списков.
fn behaviours(structure: &Structure, particle: usize) -> Result<Vec<usize>> {
    let mut seen = Vec::new();
    for list in BEHAVIOUR_LISTS {
        for object in structure.objects(structure.list(particle + list)?) {
            if !seen.contains(&object) {
                seen.push(object);
            }
        }
    }
    Ok(seen)
}

fn animations(structure: &Structure, particle: usize) -> Result<Vec<usize>> {
    Ok(behaviours(structure, particle)?
        .into_iter()
        .filter(|&at| structure.u32(at + BEHAVIOUR_TYPE).is_ok_and(|hash| hash == ANIMATE_TEXTURE))
        .collect())
}

/// События правила по месту в массиве: пустые места — `None`; считаются первые `min(число, ёмкость)`.
fn event_slots(structure: &Structure, effect: usize) -> Result<Vec<Option<usize>>> {
    let list = structure.list(effect + EFFECT_EVENTS)?;
    let Some(array) = list.array else {
        return Ok(Vec::new());
    };
    Ok((0..list.count.min(list.capacity)).map(|k| structure.pointer(array + k * 8)).collect())
}

/// Слова ядра, за которые копия правила не идёт: всё, что ведёт в графическую область или на описание листа словаря.
/// Копия правила несёт события, эмиттеры и частицы с их поведениями, а листы и их пиксели остаются общими с донором:
/// у декалей и других поведений есть собственные ссылки на листы, не только переменные шейдера, и без этого в копию
/// уезжали бы мегабайты пикселей донора.
fn shared_words(structure: &Structure) -> Result<HashSet<usize>> {
    let descriptors: HashSet<usize> = structure
        .entries(Kind::Texture)?
        .into_iter()
        .filter_map(|entry| entry.object)
        .collect();
    let graph = structure.graph();
    let mut words = HashSet::new();
    for block in graph.blocks.iter().filter(|block| block.segment == Segment::System) {
        for slot in &block.slots {
            let shared = match slot.target.segment {
                Segment::Graphics => true,
                Segment::System => descriptors.contains(&slot.target.offset),
            };
            if shared {
                words.insert(block.start + slot.relative);
            }
        }
    }
    Ok(words)
}

/// Глубокая копия правила-донора: `Structure::copy_effect` с общими листами и графикой.
fn copy_donor(structure: &mut Structure, donor: usize) -> Result<EffectCopy> {
    let mut stops = structure.effect_stops(donor)?;
    stops.extend(shared_words(structure)?);
    let planted = structure.copy_subgraph(donor, &stops)?;
    let effect = planted
        .translate(donor)
        .ok_or_else(|| broken("Указатель вне блоков."))?;
    let events = structure.events(effect)?;
    let (emitters, particles) = structure.rules_of(&events);
    Ok(EffectCopy {
        effect,
        events,
        emitters,
        particles,
    })
}

fn slot_names(name: &str) -> EffectNames {
    EffectNames {
        effect: name.to_owned(),
        emitters: vec![name.to_owned()],
        particles: vec![name.to_owned()],
    }
}

/// Строит слоты в образе. Ядро уже проверено на словари (`vanilla::assert_dictionaries`); `payloads` — DDS листов.
pub fn apply(structure: &mut Structure, reservations: &[Reservation], payloads: &Payloads) -> Result<Vec<ReservedSlot>> {
    if reservations.is_empty() || reservations.len() > MAX_RESERVATIONS {
        return Err(broken(format!(
            "YPT slot reservation count must be between 1 and {MAX_RESERVATIONS}."
        )));
    }
    validate(structure, reservations)?;
    reservations.iter().map(|item| reserve(structure, item, payloads)).collect()
}

fn reserve(s: &mut Structure, item: &Reservation, payloads: &Payloads) -> Result<ReservedSlot> {
    let (slot, texture_name) = (text(&item.effect).to_owned(), text(&item.texture).to_owned());
    let (donor_effect, donor_particle) = (text(&item.donor_effect).to_owned(), text(&item.donor_particle).to_owned());
    let (sheet, wanted) = (item.sheet.unwrap_or_default(), item.frames.unwrap_or_default());

    // Донор: ровно одно правило с таким именем.
    let mut donors = Vec::new();
    for entry in s.entries(Kind::Effect)? {
        if let Some(object) = entry.object {
            if s.name_of(Kind::Effect, object).as_deref() == Some(donor_effect.as_str()) {
                donors.push(object);
            }
        }
    }
    let donor = match donors.as_slice() {
        [one] => *one,
        [] => return Err(broken(format!("YPT donor effect rule does not exist: {donor_effect}"))),
        _ => return Err(broken(format!("YPT donor effect rule is ambiguous: {donor_effect}"))),
    };

    // Основное событие донора: первое, где есть и эмиттер, и частица и частица названа как заказано.
    let donor_events = event_slots(s, donor)?;
    let primary_index = donor_events.iter().position(|event| {
        event.is_some_and(|event| {
            s.pointer(event + EVENT_PARTICLE).is_some()
                && s.pointer(event + EVENT_EMITTER).is_some()
                && s.name(event + EVENT_PARTICLE_NAME).as_deref() == Some(donor_particle.as_str())
        })
    });
    let Some(primary_index) = primary_index else {
        return Err(broken(format!(
            "YPT donor effect {donor_effect} does not emit particle rule {donor_particle}."
        )));
    };
    let donor_event = donor_events[primary_index].unwrap_or_default();
    let donor_emitter = s.name(donor_event + EVENT_EMITTER_NAME).unwrap_or_default();
    let donor_count = s.list(donor + EFFECT_EVENTS)?.count;

    // Двоичная копия донора; от неё остаётся одно событие — основное.
    let copy = copy_donor(s, donor)?;
    let copy_events = event_slots(s, copy.effect)?;
    let lost = |what: &str| broken(format!("YPT donor copy lost its {what}: {donor_effect}"));
    if copy_events.len() != donor_events.len() {
        return Err(broken(format!("YPT donor copy differs from its donor: {donor_effect}")));
    }
    let primary = copy_events[primary_index].ok_or_else(|| lost("emitter"))?;
    let emitter = s.pointer(primary + EVENT_EMITTER).ok_or_else(|| lost("emitter rule"))?;
    let particle = s.pointer(primary + EVENT_PARTICLE).ok_or_else(|| lost("particle rule"))?;
    s.set_events(copy.effect, &[primary])?;
    // Снятые события лежат в том же блоке: их указатели держали бы копии лишних правил донора.
    let gone: Vec<usize> = copy_events.iter().flatten().copied().filter(|&event| event != primary).collect();
    s.clear_events(&gone)?;
    let dropped = donor_count.saturating_sub(1);

    // Свои имена и счётчики ссылок.
    let own = EffectCopy {
        effect: copy.effect,
        events: vec![primary],
        emitters: vec![emitter],
        particles: vec![particle],
    };
    s.name_copy(&own, &slot_names(&slot))?;
    s.put_u32(copy.effect + REF_COUNT, 1)?;
    s.put_u32(emitter + REF_COUNT, 2)?;
    s.put_u32(particle + REF_COUNT, 2)?;

    // Лист частицы: диффузная переменная одна.
    let diffuse_hash = hash_name("diffusetex2");
    let mut diffuse: Option<usize> = None;
    let mut donor_texture = String::new();
    for variable in s.objects(s.list(particle + PARTICLE_VARS)?) {
        if s.u8(variable + VAR_KIND)? != VAR_KIND_TEXTURE {
            continue;
        }
        let drawn = s.pointer(variable + VAR_TEXTURE);
        if s.u32(variable + 0x10)? == diffuse_hash {
            if let Some(drawn) = drawn {
                if diffuse.is_some() {
                    return Err(broken(format!(
                        "YPT donor particle has several diffuse textures: {donor_particle}"
                    )));
                }
                diffuse = Some(variable);
                donor_texture = s
                    .name(variable + VAR_TEXTURE_NAME)
                    .or_else(|| s.name(drawn + TEXTURE_NAME))
                    .unwrap_or_default();
            }
        }
    }
    let diffuse = diffuse.ok_or_else(|| {
        broken(format!("YPT donor particle has no diffuse texture: {donor_particle}"))
    })?;
    let template = s.pointer(diffuse + VAR_TEXTURE).ok_or_else(|| lost("texture"))?;

    // Лист слота: метаданные — копия листа донора, пиксели и раскладка — из DDS заказа.
    let bytes = payloads
        .get(&texture_name.to_uppercase())
        .ok_or_else(|| broken(format!("YPT slot texture has no payload: {texture_name}")))?;
    let image = read_dds_with(bytes, &texture_name, true)?;
    if image.payload.is_empty() {
        return Err(broken(format!("DDS could not be decoded: {texture_name}")));
    }
    if image.width % sheet.columns as u32 != 0 || image.height % sheet.rows as u32 != 0 {
        return Err(broken(format!(
            "YPT slot texture does not divide into its sheet: {texture_name}"
        )));
    }
    // Данные листа помощник проверяет последними: после записи он перечитывает лист (`check_new_sheet`).
    check_new_sheet(&image)?;

    // Кадры частицы и анимация листа.
    s.put_u32(particle + PARTICLE_FRAME_MIN, wanted.min as u32)?;
    s.put_u32(particle + PARTICLE_FRAME_MAX, wanted.max as u32)?;
    let animated = animations(s, particle)?;
    let wants_animation = wanted.last.is_some() || wanted.loop_mode.is_some() || wanted.scaled_over_life.is_some();
    if wants_animation && animated.is_empty() {
        return Err(broken(format!(
            "YPT donor particle does not animate its sheet: {donor_particle}"
        )));
    }
    let cells = sheet.columns * sheet.rows;
    for &animation in &animated {
        if let Some(last) = wanted.last {
            s.put(animation + ANIMATE_LAST_FRAME, &last.to_le_bytes())?;
        }
        if let Some(mode) = wanted.loop_mode {
            s.put_u8(animation + ANIMATE_LOOP_MODE, mode as u8)?;
        }
        if let Some(scaled) = wanted.scaled_over_life {
            s.put_u8(animation + ANIMATE_SCALED, u8::from(scaled))?;
        }
        let last = s.u32(animation + ANIMATE_LAST_FRAME)? as i32;
        if last < 0 || last >= cells {
            return Err(broken(format!("YPT slot animation runs past its sheet: {slot}")));
        }
    }
    let last_frame = match animated.first() {
        Some(&animation) => Some(s.u32(animation + ANIMATE_LAST_FRAME)? as i32),
        None => None,
    };

    // Три словаря правил, затем лист.
    let slot_hash = hash_name(&slot);
    s.insert_entry(Kind::Effect, copy.effect, slot_hash)?;
    s.insert_entry(Kind::Emitter, emitter, slot_hash)?;
    s.insert_entry(Kind::Particle, particle, slot_hash)?;
    let texture_hash = hash_name(&texture_name.to_lowercase());
    if s.entries(Kind::Texture)?.iter().any(|entry| entry.hash == texture_hash) {
        return Err(broken(format!("YPT texture name hash is already taken: {texture_name}")));
    }
    let spec = TextureSpec {
        name: &texture_name,
        width: image.width as u16,
        height: image.height as u16,
        depth: 1,
        stride: stride_of(image.format, image.width),
        levels: image.levels,
        format: image.format.code(),
        pixels: &image.payload,
    };
    let created = s.add_texture(template, &spec)?;
    // Диффузная переменная копии рисует новый лист.
    s.set_system_pointer(diffuse + VAR_TEXTURE, Some(created))?;
    s.set_name(diffuse + VAR_TEXTURE_NAME, &texture_name)?;
    s.put_u32(diffuse + VAR_TEXTURE_HASH, texture_hash)?;

    Ok(ReservedSlot {
        effect: slot,
        texture: texture_name,
        donor_effect,
        donor_emitter,
        donor_particle,
        donor_texture,
        dropped_emitters: dropped,
        width: image.width,
        height: image.height,
        levels: u32::from(image.levels),
        format: format!("D3DFMT_{}", image.format.name()),
        columns: sheet.columns,
        rows: sheet.rows,
        frame_min: wanted.min as u32,
        frame_max: wanted.max as u32,
        last_frame,
    })
}

// ---------------------------------------------------------------------------------------------
// Проверки перечитанного файла
// ---------------------------------------------------------------------------------------------

/// Единственный элемент, как `Single`: пусто или больше одного — отказ с текстом помощника.
fn single(items: &[usize]) -> Result<usize> {
    match items {
        [one] => Ok(*one),
        [] => Err(Error::operation("Sequence contains no matching element")),
        _ => Err(Error::operation("Sequence contains more than one matching element")),
    }
}

fn named(image: &Image, objects: &[usize], at: usize, wanted: &str) -> Option<usize> {
    objects.iter().copied().find(|&object| image.name(object + at).as_deref() == Some(wanted))
}

/// События правила из перечитанного файла по месту в массиве.
fn image_events(image: &Image, effect: usize) -> Result<Vec<Option<usize>>> {
    let list = image.list(effect + EFFECT_EVENTS)?;
    let Some(array) = list.array else {
        return Ok(Vec::new());
    };
    Ok((0..list.count.min(list.capacity)).map(|k| image.pointer(array + k * 8)).collect())
}

/// Счётчики ссылок слотов: у правила эффекта 1, у эмиттера и частицы `1 + число событий, что на них ссылаются`.
pub fn verify_counts(image: &Image, slots: &[String]) -> Result<()> {
    let effects = image.dictionary(ROOT_EFFECTS).unwrap_or_default();
    let emitters = image.dictionary(ROOT_EMITTERS).unwrap_or_default();
    let particles = image.dictionary(ROOT_PARTICLES).unwrap_or_default();
    let (mut emitter_users, mut particle_users): (HashMap<usize, u32>, HashMap<usize, u32>) = Default::default();
    for &effect in &effects {
        for event in image_events(image, effect)?.into_iter().flatten() {
            if let Some(emitter) = image.pointer(event + EVENT_EMITTER).filter(|at| emitters.contains(at)) {
                *emitter_users.entry(emitter).or_default() += 1;
            }
            if let Some(particle) = image.pointer(event + EVENT_PARTICLE).filter(|at| particles.contains(at)) {
                *particle_users.entry(particle).or_default() += 1;
            }
        }
    }
    for slot in slots {
        let effect = named(image, &effects, EFFECT_NAME, slot)
            .ok_or_else(|| broken(format!("YPT slot effect rule is missing: {slot}")))?;
        let emitter = named(image, &emitters, EMITTER_NAME, slot)
            .ok_or_else(|| broken(format!("YPT slot emitter rule is missing: {slot}")))?;
        let particle = named(image, &particles, PARTICLE_NAME, slot)
            .ok_or_else(|| broken(format!("YPT slot particle rule is missing: {slot}")))?;
        let counted = |users: &HashMap<usize, u32>, at: usize| 1 + users.get(&at).copied().unwrap_or(0);
        if image.u32(effect + REF_COUNT)? != 1
            || image.u32(emitter + REF_COUNT)? != counted(&emitter_users, emitter)
            || image.u32(particle + REF_COUNT)? != counted(&particle_users, particle)
        {
            return Err(broken(format!("YPT slot reference counts are inconsistent: {slot}")));
        }
    }
    Ok(())
}

/// Слот после записи: одно событие со своими правилами, лист рисуется, кадры и анимация пережили сохранение.
pub fn verify_slot(image: &Image, item: &Reservation) -> Result<()> {
    let (slot, texture_name) = (text(&item.effect), text(&item.texture));
    let (sheet, wanted) = (item.sheet.unwrap_or_default(), item.frames.unwrap_or_default());
    let effects = image.dictionary(ROOT_EFFECTS).unwrap_or_default();
    let matching: Vec<usize> = effects
        .iter()
        .copied()
        .filter(|&effect| image.name(effect + EFFECT_NAME).as_deref() == Some(slot))
        .collect();
    let effect = single(&matching)?;
    let list = image.list(effect + EFFECT_EVENTS)?;
    let first = image_events(image, effect)?.first().copied().flatten();
    let Some(primary) = first.filter(|_| list.count == 1) else {
        return Err(broken(format!("YPT slot must keep exactly one emitter: {slot}")));
    };
    let emitter = image.pointer(primary + EVENT_EMITTER);
    let particle = image.pointer(primary + EVENT_PARTICLE);
    let own_names = image.name(primary + EVENT_EMITTER_NAME).as_deref() == Some(slot)
        && image.name(primary + EVENT_PARTICLE_NAME).as_deref() == Some(slot)
        && emitter.is_some_and(|at| image.name(at + EMITTER_NAME).as_deref() == Some(slot))
        && particle.is_some_and(|at| image.name(at + PARTICLE_NAME).as_deref() == Some(slot));
    if !own_names {
        return Err(broken(format!("YPT slot emitter does not point at its own rules: {slot}")));
    }
    let particle = particle.unwrap_or_default();
    let diffuse_hash = hash_name("diffusetex2");
    let mut diffuse = Vec::new();
    for variable in image.objects(image.list(particle + PARTICLE_VARS)?) {
        if image.u8(variable + VAR_KIND)? == VAR_KIND_TEXTURE
            && image.u32(variable + 0x10)? == diffuse_hash
            && image.pointer(variable + VAR_TEXTURE).is_some()
        {
            diffuse.push(variable);
        }
    }
    if diffuse.len() > 1 {
        return Err(Error::operation("Sequence contains more than one matching element"));
    }
    let Some(&diffuse) = diffuse.first() else {
        return Err(broken(format!("YPT slot particle lost its texture: {slot}")));
    };
    let textures = image.dictionary(ROOT_TEXTURES).unwrap_or_default();
    let texture = image.single_named(&textures, TEXTURE_NAME, texture_name)?;
    let draws = texture.is_some()
        && image.pointer(diffuse + VAR_TEXTURE) == texture
        && image.name(diffuse + VAR_TEXTURE_NAME).as_deref() == Some(texture_name)
        && image.u32(diffuse + VAR_TEXTURE_HASH)? == hash_name(&texture_name.to_lowercase());
    if !draws {
        return Err(broken(format!("YPT slot particle does not draw its texture: {slot}")));
    }
    if image.u32(particle + PARTICLE_FRAME_MIN)? != wanted.min as u32
        || image.u32(particle + PARTICLE_FRAME_MAX)? != wanted.max as u32
    {
        return Err(broken(format!("YPT slot frames did not survive the save: {slot}")));
    }
    let cells = sheet.columns * sheet.rows;
    let mut seen = Vec::new();
    for list in BEHAVIOUR_LISTS {
        for object in image.objects(image.list(particle + list)?) {
            if !seen.contains(&object) {
                seen.push(object);
            }
        }
    }
    for behaviour in seen {
        if image.u32(behaviour + BEHAVIOUR_TYPE)? != ANIMATE_TEXTURE {
            continue;
        }
        let last = image.u32(behaviour + ANIMATE_LAST_FRAME)? as i32;
        if wanted.last.is_some_and(|wanted| wanted != last) || last >= cells {
            return Err(broken(format!("YPT slot animation did not survive the save: {slot}")));
        }
    }
    Ok(())
}

/// Ключи описи, которые обязаны появиться от слотов: правило эффекта, эмиттер, частица, лист.
pub fn expected_keys(reservations: &[Reservation]) -> HashSet<String> {
    reservations
        .iter()
        .flat_map(|item| {
            let (slot, texture) = (text(&item.effect), text(&item.texture));
            [
                format!("effect:{slot}"),
                format!("emitter:{slot}"),
                format!("particle:{slot}"),
                format!("texture:{texture}"),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests;
