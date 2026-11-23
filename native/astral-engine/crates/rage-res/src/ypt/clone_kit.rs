//! Приёмы для клонов эффектов поверх образа структуры: кадры свойств, свойства эмиттеров и областей, поведения
//! частиц, списки эволюций (чтение в модель и запись обратно новыми массивами).
//!
//! Все смещения — в системной области образа; схема — `docs/rust-rewrite/ypt-schema.md`.

use super::image::{FRAME_BYTES, KEY_LIST, PROP_BYTES, PROP_HASH};
use super::structure::Structure;
use crate::error::{Error, Result};
use crate::resource_graph::{Address, Segment};

/// Свойства эмиттера: десять встроенных подряд.
pub const EMITTER_PROPS: usize = 0x78;
pub const EMITTER_PROP_COUNT: usize = 10;
/// Области эмиттера: создания, цели, притяжения.
pub const EMITTER_DOMAINS: [usize; 3] = [0x38, 0x48, 0x58];
/// Свойства области: положение, поворот, внешний размер, внутренний размер.
pub const DOMAIN_PROPS: [usize; 4] = [0x18, 0xA8, 0x138, 0x1C8];
/// Область цели: первое свойство — положение (точка прицела).
pub const EMITTER_TARGET: usize = 0x48;
pub const EMITTER_ONE_SHOT: usize = 0x628;
/// Счётчик ссылок эмиттера и частицы.
pub const REF_COUNT: usize = 0x10;
/// Списки поведений частицы: все, инициализации, обновления, завершения обновления, отрисовки.
pub const PARTICLE_BEHAVIOURS: [usize; 5] = [0x128, 0x138, 0x148, 0x158, 0x168];
pub const PARTICLE_FRAME_MIN: usize = 0x118;
pub const PARTICLE_FRAME_MAX: usize = 0x11C;
/// Поведение: хеш вида, список свойств.
pub const BEHAVIOUR_TYPE: usize = 8;
pub const BEHAVIOUR_PROPS: usize = 0x10;

pub const TYPE_COLOUR: u32 = 0x164A_EA72;
pub const TYPE_LIGHT: u32 = 0x0544_C710;
pub const TYPE_ZCULL: u32 = 0xA35C_721F;
pub const TYPE_ANIMATE_TEXTURE: u32 = 0xECA8_4C1E;

/// Поля поведения «цвет»: свойства цвета и свечения.
pub const COLOUR_RGBA_MIN: usize = 0x30;
pub const COLOUR_RGBA_MAX: usize = 0xC0;
pub const COLOUR_EMISSIVE: usize = 0x150;
/// Поля поведения «свет»: четыре свойства цвета.
pub const LIGHT_COLOUR_PROPS: [usize; 4] = [0x30, 0xC0, 0x270, 0x300];
/// Поля поведения «гашение по высоте»: режим и пространство.
pub const ZCULL_MODE: usize = 0x158;
pub const ZCULL_SPACE: usize = 0x15C;
/// Поля поведения «анимация листа»: последний кадр, режим повтора, случайность, растяжение на жизнь.
pub const ANIMATE_LAST_FRAME: usize = 0xC4;
pub const ANIMATE_LOOP_MODE: usize = 0xC8;
pub const ANIMATE_RANDOMISED: usize = 0xCC;
pub const ANIMATE_SCALED: usize = 0xCD;

/// Правило эффекта: свойства (пять встроенных подряд), длительности, отсечение, дальность LOD.
pub const EFFECT_PROPS: usize = 0xC0;
pub const EFFECT_PROP_COUNT: usize = 5;
pub const EFFECT_DURATION_MIN: usize = 0x78;
pub const EFFECT_DURATION_MAX: usize = 0x7C;
pub const EFFECT_PLAYBACK_MIN: usize = 0x80;
pub const EFFECT_PLAYBACK_MAX: usize = 0x84;
pub const EFFECT_VIEWPORT_RADIUS: usize = 0xA0;
pub const EFFECT_CULL_FADE: usize = 0xA4;
pub const EFFECT_CULL_DIST: usize = 0xA8;
pub const EFFECT_LOD_MIN: usize = 0xAC;
pub const EFFECT_LOD_MAX: usize = 0xB0;
pub const EFFECT_EVOLUTIONS: usize = 0x48;
/// Событие: списки эволюций и поля доли времени, темпа и масштаба.
pub const EVENT_EVOLUTIONS: usize = 0x18;
pub const EVENT_START: usize = 0x10;
pub const EVENT_END: usize = 0x14;
pub const EVENT_PLAYBACK_MIN: usize = 0x50;
pub const EVENT_PLAYBACK_MAX: usize = 0x54;
pub const EVENT_ZOOM_MIN: usize = 0x58;
pub const EVENT_ZOOM_MAX: usize = 0x5C;

const EVOLUTION_NAMES: usize = 0;
const EVOLUTION_PROPS: usize = 0x10;
const EVOLUTION_MAP: usize = 0x28;
const EVOLUTION_BYTES: usize = 0x40;
const NAME_STRIDE: usize = 0x18;
const PROP_STRIDE: usize = 0x18;
const FRAMES_STRIDE: usize = 0x30;
const MAP_STRIDE: usize = 0x10;

/// Хеш имени свойства (RAGE, регистр букв ASCII не важен).
pub fn prop_hash(name: &str) -> u32 {
    super::names::hash_name(name)
}

fn sys(offset: usize) -> Address {
    Address {
        segment: Segment::System,
        offset,
    }
}

// ---------------------------------------------------------------------------------------------
// Кадры
// ---------------------------------------------------------------------------------------------

/// Кадр свойства: время (время, обратная длина отрезка, 0, 0) и значение.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Key {
    pub time: [f32; 4],
    pub value: [f32; 4],
}

impl Key {
    fn to_bytes(self) -> [u8; FRAME_BYTES] {
        let mut out = [0u8; FRAME_BYTES];
        for (k, number) in self.time.into_iter().chain(self.value).enumerate() {
            out[k * 4..k * 4 + 4].copy_from_slice(&number.to_le_bytes());
        }
        out
    }
}

fn read4(s: &Structure, at: usize) -> Result<[f32; 4]> {
    Ok([s.f32(at)?, s.f32(at + 4)?, s.f32(at + 8)?, s.f32(at + 12)?])
}

/// Кадры списка с заголовком в `header`.
pub fn read_keys(s: &Structure, header: usize) -> Result<Vec<Key>> {
    let list = s.list(header)?;
    let Some(array) = list.array else {
        return Ok(Vec::new());
    };
    (0..list.count)
        .map(|k| -> Result<Key> {
            let at = array + k * FRAME_BYTES;
            Ok(Key {
                time: read4(s, at)?,
                value: read4(s, at + 16)?,
            })
        })
        .collect()
}

/// Кадры свойства `prop`.
pub fn prop_keys(s: &Structure, prop: usize) -> Result<Vec<Key>> {
    read_keys(s, prop + KEY_LIST)
}

/// Заменяет кадры списка новым массивом; число и ёмкость — длина нового списка.
pub fn put_keys(s: &mut Structure, header: usize, keys: &[Key]) -> Result<()> {
    if keys.is_empty() {
        return s.set_list(header, None, 0, 0);
    }
    let bytes: Vec<u8> = keys.iter().flat_map(|key| key.to_bytes()).collect();
    let array = s.alloc(bytes, &[]);
    s.set_list(header, Some(array), keys.len(), keys.len())
}

/// Значение каждого кадра списка — на месте; отдаёт число кадров.
pub fn map_values(
    s: &mut Structure,
    header: usize,
    change: &mut dyn FnMut([f32; 4]) -> [f32; 4],
) -> Result<usize> {
    let list = s.list(header)?;
    let Some(array) = list.array else {
        return Ok(0);
    };
    for k in 0..list.count {
        let at = array + k * FRAME_BYTES + 16;
        let value = change(read4(s, at)?);
        let bytes: Vec<u8> = value.iter().flat_map(|number| number.to_le_bytes()).collect();
        s.put(at, &bytes)?;
    }
    Ok(list.count)
}

/// Умножает X и Y значения каждого кадра.
pub fn scale_xy(s: &mut Structure, header: usize, factor: f32) -> Result<usize> {
    map_values(s, header, &mut |v| [v[0] * factor, v[1] * factor, v[2], v[3]])
}

/// Умножает X, Y и Z (три оси) или только X и Y (две).
pub fn scale_axes(s: &mut Structure, header: usize, factor: f32, axes: usize) -> Result<usize> {
    if axes == 2 {
        return scale_xy(s, header, factor);
    }
    map_values(s, header, &mut |v| [v[0] * factor, v[1] * factor, v[2] * factor, v[3]])
}

/// Хеш имени свойства по смещению свойства.
pub fn hash_of(s: &Structure, prop: usize) -> Result<u32> {
    s.u32(prop + PROP_HASH)
}

/// Свойства по смещениям, чьё имя — `hash`.
pub fn with_hash(s: &Structure, props: &[usize], hash: u32) -> Result<Vec<usize>> {
    let mut found = Vec::new();
    for &prop in props {
        if hash_of(s, prop)? == hash && !found.contains(&prop) {
            found.push(prop);
        }
    }
    Ok(found)
}

// ---------------------------------------------------------------------------------------------
// Свойства и поведения
// ---------------------------------------------------------------------------------------------

/// Десять встроенных свойств эмиттера.
pub fn emitter_props(emitter: usize) -> Vec<usize> {
    (0..EMITTER_PROP_COUNT)
        .map(|k| emitter + EMITTER_PROPS + k * PROP_BYTES)
        .collect()
}

/// Свойства трёх областей эмиттера (создания, цели, притяжения), у каждой по четыре; пустые области опускаются.
pub fn domain_props(s: &Structure, emitter: usize) -> Vec<usize> {
    EMITTER_DOMAINS
        .iter()
        .filter_map(|&at| s.pointer(emitter + at))
        .flat_map(|domain| DOMAIN_PROPS.iter().map(move |&at| domain + at))
        .collect()
}

/// Свойства эмиттера и его областей.
pub fn owned_props(s: &Structure, emitter: usize) -> Vec<usize> {
    let mut props = emitter_props(emitter);
    props.extend(domain_props(s, emitter));
    props
}

/// Положение области цели эмиттера (точка прицела), если область есть.
pub fn target_position(s: &Structure, emitter: usize) -> Option<usize> {
    s.pointer(emitter + EMITTER_TARGET)
        .map(|domain| domain + DOMAIN_PROPS[0])
}

/// Пять встроенных свойств правила эффекта.
pub fn effect_props(effect: usize) -> Vec<usize> {
    (0..EFFECT_PROP_COUNT)
        .map(|k| effect + EFFECT_PROPS + k * PROP_BYTES)
        .collect()
}

/// Поведения частицы без повторов, в порядке списков.
pub fn behaviours(s: &Structure, particle: usize) -> Result<Vec<usize>> {
    let mut found = Vec::new();
    for at in PARTICLE_BEHAVIOURS {
        for behaviour in s.objects(s.list(particle + at)?) {
            if !found.contains(&behaviour) {
                found.push(behaviour);
            }
        }
    }
    Ok(found)
}

pub fn behaviour_type(s: &Structure, behaviour: usize) -> Result<u32> {
    s.u32(behaviour + BEHAVIOUR_TYPE)
}

/// Свойства поведения по его списку указателей.
pub fn behaviour_props(s: &Structure, behaviour: usize) -> Result<Vec<usize>> {
    Ok(s.objects(s.list(behaviour + BEHAVIOUR_PROPS)?))
}

// ---------------------------------------------------------------------------------------------
// Эволюции
// ---------------------------------------------------------------------------------------------

/// Набор кадров одной эволюции у свойства (запись по 0x30): номер, признак LOD, байты записи и массив кадров.
#[derive(Debug, Clone)]
pub struct Evolved {
    pub id: i32,
    pub lod: u8,
    pub raw: [u8; FRAMES_STRIDE],
    pub keys: Option<Address>,
}

#[derive(Debug, Clone)]
pub struct EvolvedProp {
    pub hash: u32,
    pub blend: u32,
    pub frames: Vec<Evolved>,
}

/// Список эволюций в виде модели: имена и свойства с наборами кадров.
#[derive(Debug, Clone, Default)]
pub struct Evolution {
    pub names: Vec<String>,
    pub props: Vec<EvolvedProp>,
}

/// Адрес записи набора кадров `k` у свойства `prop` списка: для правок кадров на месте.
pub fn read_evolution(s: &Structure, list: usize) -> Result<Evolution> {
    let names_list = s.list(list + EVOLUTION_NAMES)?;
    let names = match names_list.array {
        Some(array) => (0..names_list.count)
            .map(|k| s.name(array + k * NAME_STRIDE).unwrap_or_default())
            .collect(),
        None => Vec::new(),
    };
    let props_list = s.list(list + EVOLUTION_PROPS)?;
    let mut props = Vec::new();
    if let Some(array) = props_list.array {
        for k in 0..props_list.count {
            let entry = array + k * PROP_STRIDE;
            let frames_list = s.list(entry)?;
            let mut frames = Vec::new();
            if let Some(items) = frames_list.array {
                for j in 0..frames_list.count {
                    let at = items + j * FRAMES_STRIDE;
                    let mut raw = [0u8; FRAMES_STRIDE];
                    raw.copy_from_slice(s.bytes(at, FRAMES_STRIDE)?);
                    frames.push(Evolved {
                        id: s.u32(at + 0x20)? as i32,
                        lod: s.u8(at + 0x24)?,
                        raw,
                        keys: s.pointer(at).map(sys),
                    });
                }
            }
            props.push(EvolvedProp {
                hash: s.u32(entry + 0x10)?,
                blend: s.u32(entry + 0x14)?,
                frames,
            });
        }
    }
    Ok(Evolution { names, props })
}

/// Адреса записей наборов кадров свойства списка эволюций (для правок значений на месте).
pub fn evolved_frames(s: &Structure, list: usize) -> Result<Vec<(u32, Vec<usize>)>> {
    let props_list = s.list(list + EVOLUTION_PROPS)?;
    let mut out = Vec::new();
    if let Some(array) = props_list.array {
        for k in 0..props_list.count {
            let entry = array + k * PROP_STRIDE;
            let frames_list = s.list(entry)?;
            let items = match frames_list.array {
                Some(items) => (0..frames_list.count)
                    .map(|j| items + j * FRAMES_STRIDE)
                    .collect(),
                None => Vec::new(),
            };
            out.push((s.u32(entry + 0x10)?, items));
        }
    }
    Ok(out)
}

/// Пустой список эволюций по образцу: байты образца, три списка пусты.
pub fn blank_evolution(s: &mut Structure, template: Option<[u8; EVOLUTION_BYTES]>) -> usize {
    let mut bytes = template.map_or_else(|| vec![0u8; EVOLUTION_BYTES], |bytes| bytes.to_vec());
    for at in [EVOLUTION_NAMES, EVOLUTION_PROPS, EVOLUTION_MAP] {
        bytes[at..at + 16].fill(0);
    }
    s.alloc(bytes, &[]).offset
}

/// Байты списка эволюций первого правила, у которого он есть: образец для новых списков.
pub fn evolution_template(s: &Structure, effects: &[usize]) -> Option<[u8; EVOLUTION_BYTES]> {
    effects.iter().find_map(|&effect| {
        let list = s.pointer(effect + EFFECT_EVOLUTIONS)?;
        let mut bytes = [0u8; EVOLUTION_BYTES];
        bytes.copy_from_slice(s.bytes(list, EVOLUTION_BYTES).ok()?);
        Some(bytes)
    })
}

/// Прежние массивы списка, лежащие в одном блоке с самим списком (у копии хвост донора склеен с объектом в один
/// пробег), обнуляются вместе со своими указателями: новые массивы пишутся отдельно, а оставленный хвост хранил бы
/// слова-хеши, похожие на указатели, и указатели на уже ненужные массивы.
fn clear_old_tail(s: &mut Structure, list: usize) -> Result<()> {
    let home = s.graph().block_at(sys(list));
    for (field, stride) in [
        (EVOLUTION_NAMES, NAME_STRIDE),
        (EVOLUTION_PROPS, PROP_STRIDE),
        (EVOLUTION_MAP, MAP_STRIDE),
    ] {
        let old = s.list(list + field)?;
        let Some(array) = old.array.filter(|&array| array != list) else {
            continue;
        };
        if home.is_none() || s.graph().block_at(sys(array)) != home {
            continue;
        }
        let end = array + old.count.max(old.capacity) * stride;
        for word in (array..end).step_by(8) {
            s.set_pointer(word, None)?;
        }
    }
    Ok(())
}

/// Записывает модель в список эволюций `list`: новые массивы имён, свойств, наборов кадров и карты свойств
/// (по возрастанию хеша, при равных — в порядке свойств).
pub fn write_evolution(s: &mut Structure, list: usize, model: &Evolution) -> Result<()> {
    clear_old_tail(s, list)?;
    let names = if model.names.is_empty() {
        None
    } else {
        let mut pointers = Vec::new();
        for (k, name) in model.names.iter().enumerate() {
            pointers.push((k * NAME_STRIDE, s.new_string(name)));
        }
        Some(s.alloc(vec![0u8; model.names.len() * NAME_STRIDE], &pointers))
    };
    s.set_list(list + EVOLUTION_NAMES, names, model.names.len(), model.names.len())?;

    let mut props_bytes = vec![0u8; model.props.len() * PROP_STRIDE];
    let mut props_pointers = Vec::new();
    for (k, prop) in model.props.iter().enumerate() {
        let entry = k * PROP_STRIDE;
        props_bytes[entry + 0x10..entry + 0x14].copy_from_slice(&prop.hash.to_le_bytes());
        props_bytes[entry + 0x14..entry + 0x18].copy_from_slice(&prop.blend.to_le_bytes());
        let count = u16::try_from(prop.frames.len()).map_err(|_| Error::argument("Слишком много кадров."))?;
        props_bytes[entry + 8..entry + 10].copy_from_slice(&count.to_le_bytes());
        props_bytes[entry + 10..entry + 12].copy_from_slice(&count.to_le_bytes());
        if prop.frames.is_empty() {
            continue;
        }
        let mut frame_bytes = Vec::with_capacity(prop.frames.len() * FRAMES_STRIDE);
        let mut frame_pointers = Vec::new();
        for (j, frame) in prop.frames.iter().enumerate() {
            let mut raw = frame.raw;
            raw[0x20..0x24].copy_from_slice(&frame.id.to_le_bytes());
            raw[0x24] = frame.lod;
            match frame.keys {
                Some(keys) => frame_pointers.push((j * FRAMES_STRIDE, keys)),
                None => raw[0..8].fill(0),
            }
            frame_bytes.extend_from_slice(&raw);
        }
        let frames = s.alloc(frame_bytes, &frame_pointers);
        props_pointers.push((entry, frames));
    }
    let props = if model.props.is_empty() {
        None
    } else {
        Some(s.alloc(props_bytes, &props_pointers))
    };
    s.set_list(list + EVOLUTION_PROPS, props, model.props.len(), model.props.len())?;

    let map = match props {
        None => None,
        Some(array) => {
            let mut order: Vec<usize> = (0..model.props.len()).collect();
            order.sort_by_key(|&k| model.props[k].hash);
            let mut bytes = vec![0u8; order.len() * MAP_STRIDE];
            let mut pointers = Vec::new();
            for (place, &k) in order.iter().enumerate() {
                let at = place * MAP_STRIDE;
                bytes[at..at + 4].copy_from_slice(&model.props[k].hash.to_le_bytes());
                pointers.push((at + 8, sys(array.offset + k * PROP_STRIDE)));
            }
            Some(s.alloc(bytes, &pointers))
        }
    };
    s.set_list(list + EVOLUTION_MAP, map, model.props.len(), model.props.len())
}
