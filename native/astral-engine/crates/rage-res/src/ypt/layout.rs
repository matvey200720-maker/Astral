//! Карта длин объектов ядра `core.ypt`: по какому адресу начинается объект, массив или строка и сколько
//! байт они занимают. Обход идёт от корня по схеме; чего в карте нет, то писатель переносит блоками целиком.
//!
//! Схема записана данными: у каждого вида объекта есть список действий («строка по слоту», «ссылка на
//! объект», «список», «ключевые свойства»), а один обходчик исполняет их по очереди.

use std::collections::hash_map::Entry;
use std::collections::{HashMap, VecDeque};

use super::rules::{EFFECT_KEYFRAME_PROPS, KEYFRAME_PROP_LENGTH};
use super::{
    read, DICTIONARY_VALUES, EFFECT_EVENTS, EFFECT_EVOLUTIONS, EFFECT_NAME, EMITTER_RULE_NAME,
    EVENT_EVOLUTIONS, LIST_EFFECT_RULES, LIST_EMITTER_RULES, LIST_PARTICLE_RULES, LIST_TEXTURES,
    PARTICLE_RULE_NAME, ROOT_NAME,
};
use crate::drawable::geometry_extents;
use crate::error::{Error, Result};
use crate::resource::Resource;

pub const ROOT: usize = 0x60;
pub const DICTIONARY: usize = 0x40;
pub const EFFECT: usize = 0x3C0;
pub const EVENT: usize = 0x70;
pub const EMITTER: usize = 0x630;
pub const PARTICLE: usize = 0x240;
pub const DOMAIN: usize = 0x280;
pub const EVOLUTION_LIST: usize = 0x40;
pub const BIAS_LINK: usize = 0x58;
pub const DRAWABLE: usize = 0x30;
pub const SHADER_VAR_VECTOR: usize = 0x40;
pub const SHADER_VAR_TEXTURE: usize = 0x40;
pub const SHADER_VAR_KEYFRAME: usize = 0x50;

/// Хеш типа поведения и длина его объекта.
pub const BEHAVIOURS: &[(u32, usize)] = &[
    (0xF5B3_3BAA, 0x30),
    (0xD63D_9F1B, 0x170),
    (0x6C07_19BC, 0x30),
    (0x1EE6_4552, 0x280),
    (0x38B6_0240, 0x280),
    (0x052B_1293, 0x170),
    (0x64E5_D702, 0xD0),
    (0x928A_1C45, 0x170),
    (0xECA8_4C1E, 0xD0),
    (0x164A_EA72, 0x1F0),
    (0x68FA_73F5, 0x70),
    (0x38B6_3978, 0xF0),
    (0x0544_C710, 0x550),
    (0x6232_E25A, 0x40),
    (0x8F3B_6036, 0x180),
    (0xA35C_721F, 0x170),
    (0xB77F_ED19, 0x280),
    (0x25AC_9437, 0xC0),
    (0xC573_77F8, 0xF0),
    (0xA05D_A63E, 0x430),
    (0xD459_4BEF, 0x40),
    (0xA2D6_DC3F, 0x50),
    (0xDF22_9542, 0x50),
];

/// Сколько встроенных ключевых свойств лежит в поведении с `+0x30` подряд; у типов вне таблицы их нет.
const BUILT_IN_PROPS: &[(u32, usize)] = &[
    (0xD63D_9F1B, 2),
    (0x1EE6_4552, 4),
    (0x38B6_0240, 4),
    (0x052B_1293, 2),
    (0x64E5_D702, 1),
    (0x928A_1C45, 2),
    (0xECA8_4C1E, 1),
    (0x164A_EA72, 3),
    (0x38B6_3978, 1),
    (0x0544_C710, 9),
    (0x8F3B_6036, 2),
    (0xA35C_721F, 2),
    (0xB77F_ED19, 4),
    (0x25AC_9437, 1),
    (0xC573_77F8, 1),
    (0xA05D_A63E, 7),
];

#[derive(Debug, Default)]
pub struct Lengths {
    pub objects: HashMap<usize, usize>,
    pub conflicts: Vec<usize>,
    pub name_hashes: Vec<usize>,
}

/// Вид объекта, который ставят в очередь обхода.
#[derive(Clone, Copy)]
enum Shape {
    Root,
    Header,
    RuleDict,
    TextureDict,
    ModelDict,
    Texture,
    Model,
    ShaderGroup,
    Shader,
    LevelList,
    LevelModel,
    Geometry,
    VertexBuffer,
    IndexBuffer,
    Effect,
    Event,
    Emitter,
    Domain,
    Particle,
    Evolutions,
    Behaviour { len: usize, props: usize },
    VarVector,
    VarTexture,
    VarKeyframe,
}

/// Чем считать ёмкость массива и сколько его слотов обходить.
#[derive(Clone, Copy)]
enum By {
    Count,
    Capacity,
}

/// Что делать с каждым элементом списка.
#[derive(Clone, Copy)]
enum Each {
    Nothing,
    /// Элемент — указатель на объект заданного вида.
    Link(Shape),
    /// Элемент — указатель на ключевое свойство.
    Prop,
    /// Элемент — указатель на поведение; вид выбирает хеш `+8`.
    Behaviour,
    /// Элемент — указатель на переменную шейдера; вид выбирает байт `+0x14`.
    Variable,
    /// Элемент лежит в массиве сам; действия отсчитываются от его адреса.
    Inline(&'static [Op]),
}

/// Список L64: где лежит заголовок, шаг элемента и что делать с его слотами.
#[derive(Clone, Copy)]
struct Spec {
    at: usize,
    stride: usize,
    size: By,
    walk: By,
    each: Each,
}

impl Spec {
    const fn array(at: usize, stride: usize) -> Spec {
        Spec {
            at,
            stride,
            size: By::Capacity,
            walk: By::Capacity,
            each: Each::Nothing,
        }
    }

    const fn over(self, walk: By, each: Each) -> Spec {
        Spec { walk, each, ..self }
    }

    const fn sized_by_count(self) -> Spec {
        Spec {
            size: By::Count,
            ..self
        }
    }
}

#[derive(Clone, Copy)]
enum Op {
    /// Строка по слоту.
    Text(usize),
    /// Слот — указатель на объект.
    Link(usize, Shape),
    /// Слот — указатель на массив известной длины.
    Block(usize, usize),
    List(Spec),
    /// Словарь правил корня: сам словарь, значения своего вида, массив указателей.
    Rules(usize, Shape),
    /// Ключевые свойства подряд с шагом `0x90`; `whole` — вместе со своим блоком.
    Props {
        first: usize,
        count: usize,
        whole: bool,
    },
    /// Слот массива указателей на свойства, ёмкость u16 лежит в заголовке рядом.
    FramePointers(usize),
    /// Слот — указатель на модель; буферы геометрии записываются сразу.
    ModelLink(usize),
    /// Буферы геометрии самой модели.
    Extents,
}

const NAME_HASH: usize = 0x68;
const KEYS: Spec = Spec::array(0x70, 0x20);
const HASHES: Spec = Spec::array(0x20, 4);

const ROOT_OPS: &[Op] = &[
    Op::Text(ROOT_NAME),
    Op::Link(LIST_TEXTURES, Shape::TextureDict),
    Op::Link(0x30, Shape::ModelDict),
    Op::Link(0x08, Shape::Header),
    Op::Rules(LIST_EFFECT_RULES, Shape::Effect),
    Op::Rules(LIST_EMITTER_RULES, Shape::Emitter),
    Op::Rules(LIST_PARTICLE_RULES, Shape::Particle),
];

const RULE_DICT_OPS: &[Op] = &[Op::List(HASHES)];

const TEXTURE_DICT_OPS: &[Op] = &[
    Op::List(HASHES),
    Op::List(Spec::array(DICTIONARY_VALUES, 8).over(By::Capacity, Each::Link(Shape::Texture))),
];

const MODEL_DICT_OPS: &[Op] = &[
    Op::List(HASHES),
    Op::List(Spec::array(DICTIONARY_VALUES, 8).over(By::Capacity, Each::Link(Shape::Model))),
];

const TEXTURE_OPS: &[Op] = &[Op::Text(0x28)];

const MODEL_OPS: &[Op] = &[
    Op::Text(0xA8),
    Op::Link(0x10, Shape::ShaderGroup),
    Op::Link(0x50, Shape::LevelList),
    Op::Link(0x58, Shape::LevelList),
    Op::Link(0x60, Shape::LevelList),
    Op::Link(0x68, Shape::LevelList),
    Op::Extents,
];

const SHADER_GROUP_OPS: &[Op] = &[
    Op::Link(0x08, Shape::TextureDict),
    Op::List(Spec::array(0x10, 8).over(By::Capacity, Each::Link(Shape::Shader))),
];

const LEVEL_LIST_OPS: &[Op] = &[Op::List(
    Spec::array(0, 8).over(By::Capacity, Each::Link(Shape::LevelModel)),
)];

const GEOMETRY_OPS: &[Op] = &[
    Op::Link(0x18, Shape::VertexBuffer),
    Op::Link(0x38, Shape::IndexBuffer),
];

const VERTEX_BUFFER_OPS: &[Op] = &[Op::Block(0x30, 0x10)];

const EFFECT_OPS: &[Op] = &[
    Op::List(Spec::array(EFFECT_EVENTS, 8).sized_by_count().over(By::Count, Each::Link(Shape::Event))),
    Op::Link(EFFECT_EVOLUTIONS, Shape::Evolutions),
    Op::Props {
        first: EFFECT_KEYFRAME_PROPS,
        count: 5,
        whole: false,
    },
    Op::FramePointers(0x390),
    Op::Text(EFFECT_NAME),
];

const EVENT_OPS: &[Op] = &[
    Op::Text(0x30),
    Op::Text(0x38),
    Op::Link(0x40, Shape::Emitter),
    Op::Link(0x48, Shape::Particle),
    Op::Link(EVENT_EVOLUTIONS, Shape::Evolutions),
];

const EMITTER_OPS: &[Op] = &[
    Op::Text(EMITTER_RULE_NAME),
    Op::Link(0x38, Shape::Domain),
    Op::Link(0x48, Shape::Domain),
    Op::Link(0x58, Shape::Domain),
    Op::Props {
        first: 0x78,
        count: 10,
        whole: false,
    },
    Op::FramePointers(0x618),
];

const DOMAIN_OPS: &[Op] = &[
    Op::Props {
        first: 0x18,
        count: 4,
        whole: true,
    },
    Op::List(Spec::array(0x260, 8).over(By::Count, Each::Prop)),
];

const PARTICLE_OPS: &[Op] = &[
    Op::Text(PARTICLE_RULE_NAME),
    Op::Text(0x1B8),
    Op::Text(0x1C0),
    Op::Text(0x80),
    Op::Text(0xF0),
    Op::List(Spec::array(0x128, 8).over(By::Count, Each::Behaviour)),
    Op::List(Spec::array(0x138, 8).over(By::Count, Each::Behaviour)),
    Op::List(Spec::array(0x148, 8).over(By::Count, Each::Behaviour)),
    Op::List(Spec::array(0x158, 8).over(By::Count, Each::Behaviour)),
    Op::List(Spec::array(0x168, 8).over(By::Count, Each::Behaviour)),
    Op::List(Spec::array(0x1F0, 8).over(By::Count, Each::Variable)),
    Op::List(Spec::array(0x188, BIAS_LINK).over(
        By::Count,
        Each::Inline(&[Op::List(Spec::array(0x40, 4))]),
    )),
    Op::List(Spec::array(0x210, DRAWABLE).over(
        By::Count,
        Each::Inline(&[Op::Text(0x10), Op::ModelLink(0x18)]),
    )),
];

const BEHAVIOUR_TAIL: &[Op] = &[Op::List(Spec::array(0x10, 8).over(By::Count, Each::Prop))];

const EVOLUTION_OPS: &[Op] = &[
    Op::List(Spec::array(0x00, 0x18).over(By::Count, Each::Inline(&[Op::Text(0)]))),
    Op::List(Spec::array(0x28, 0x10).over(By::Count, Each::Inline(&[Op::Block(8, 0x18)]))),
    Op::List(Spec::array(0x10, 0x18).over(
        By::Count,
        Each::Inline(&[Op::List(Spec::array(0, 0x30).over(
            By::Count,
            Each::Inline(&[Op::List(Spec::array(0, 0x20))]),
        ))]),
    )),
];

const VAR_TEXTURE_OPS: &[Op] = &[Op::Text(0x30)];
const VAR_KEYFRAME_OPS: &[Op] = &[Op::List(Spec::array(0x28, 0x20))];

impl Shape {
    fn recipe(self) -> &'static [Op] {
        match self {
            Shape::Root => ROOT_OPS,
            Shape::RuleDict => RULE_DICT_OPS,
            Shape::TextureDict => TEXTURE_DICT_OPS,
            Shape::ModelDict => MODEL_DICT_OPS,
            Shape::Texture => TEXTURE_OPS,
            Shape::Model => MODEL_OPS,
            Shape::ShaderGroup => SHADER_GROUP_OPS,
            Shape::LevelList => LEVEL_LIST_OPS,
            Shape::VertexBuffer => VERTEX_BUFFER_OPS,
            Shape::Effect => EFFECT_OPS,
            Shape::Event => EVENT_OPS,
            Shape::Emitter => EMITTER_OPS,
            Shape::Domain => DOMAIN_OPS,
            Shape::Particle => PARTICLE_OPS,
            Shape::Evolutions => EVOLUTION_OPS,
            Shape::VarTexture => VAR_TEXTURE_OPS,
            Shape::VarKeyframe => VAR_KEYFRAME_OPS,
            Shape::Header
            | Shape::IndexBuffer
            | Shape::VarVector
            | Shape::Shader
            | Shape::LevelModel
            | Shape::Geometry
            | Shape::Behaviour { .. } => &[],
        }
    }
}

/// Добор до границы в 16 байт.
fn pad16(len: usize) -> usize {
    (16 - len % 16) % 16
}

struct Walker<'a> {
    res: &'a Resource,
    found: Lengths,
    queue: VecDeque<(usize, Shape)>,
}

impl Walker<'_> {
    /// Записывает отрезок; `true`, если адрес был свободен.
    fn record(&mut self, at: usize, len: usize) -> bool {
        match self.found.objects.entry(at) {
            Entry::Vacant(slot) => {
                slot.insert(len);
                true
            }
            Entry::Occupied(mut slot) => {
                if *slot.get() != len {
                    self.found.conflicts.push(at);
                    let bigger = len.max(*slot.get());
                    slot.insert(bigger);
                }
                false
            }
        }
    }

    fn object(&mut self, at: usize, shape: Shape) -> Result<()> {
        let len = self.length(at, shape)?;
        if self.record(at, len) {
            self.queue.push_back((at, shape));
        }
        Ok(())
    }

    fn length(&self, at: usize, shape: Shape) -> Result<usize> {
        Ok(match shape {
            Shape::Root => ROOT,
            Shape::Header => 0x10,
            Shape::RuleDict | Shape::TextureDict | Shape::ModelDict => DICTIONARY,
            Shape::Texture => 0x90,
            Shape::Model => 0xD0,
            Shape::ShaderGroup => 0x40,
            Shape::Shader => 0x30,
            Shape::LevelList => 0x10,
            Shape::LevelModel => self.level_model_len(at)?,
            Shape::Geometry => self.geometry_len(at)?,
            Shape::VertexBuffer => 0x80,
            Shape::IndexBuffer => 0x60,
            Shape::Effect => EFFECT,
            Shape::Event => EVENT,
            Shape::Emitter => EMITTER,
            Shape::Domain => DOMAIN,
            Shape::Particle => PARTICLE,
            Shape::Evolutions => EVOLUTION_LIST,
            Shape::Behaviour { len, .. } => len,
            Shape::VarVector => SHADER_VAR_VECTOR,
            Shape::VarTexture => SHADER_VAR_TEXTURE,
            Shape::VarKeyframe => SHADER_VAR_KEYFRAME,
        })
    }

    /// Длина геометрии: 152 байта и две на кость, у моделей с кучей костей ещё 8.
    fn geometry_len(&self, at: usize) -> Result<usize> {
        let bones = match self.res.pointer_at(at + 0x68) {
            Some(_) => usize::from(self.res.u16(at + 0x72)?),
            None => 0,
        };
        Ok(152 + 2 * bones + if bones > 4 { 8 } else { 0 })
    }

    /// Длина модели уровня: заголовок, три таблицы и сами геометрии, каждая с выравниванием.
    fn level_model_len(&self, at: usize) -> Result<usize> {
        let n = usize::from(self.res.u16(at + 0x10)?);
        let mut len = 48 + 2 * n;
        len += if n == 1 { 6 } else { pad16(len) };
        len += 8 * n;
        len += pad16(len);
        len += 32 * (n + usize::from(n > 1));
        if let Some(geometries) = self.res.pointer_at(at + 0x08) {
            for slot in 0..n {
                if let Some(geometry) = self.res.pointer_at(geometries + slot * 8) {
                    len += pad16(len);
                    len += self.geometry_len(geometry)?;
                }
            }
        }
        Ok(len)
    }

    fn visit(&mut self, at: usize, shape: Shape) -> Result<()> {
        match shape {
            Shape::Shader => self.shader(at),
            Shape::LevelModel => self.level_model(at),
            Shape::Geometry => self.geometry(at),
            Shape::Behaviour { props, .. } => {
                self.props(at + 0x30, props, true)?;
                self.run(BEHAVIOUR_TAIL, at)
            }
            other => self.run(other.recipe(), at),
        }
    }

    fn run(&mut self, ops: &[Op], base: usize) -> Result<()> {
        for op in ops {
            match *op {
                Op::Text(offset) => self.text(base + offset),
                Op::Link(offset, shape) => {
                    if let Some(target) = self.res.pointer_at(base + offset) {
                        self.object(target, shape)?;
                    }
                }
                Op::Block(offset, len) => {
                    if let Some(target) = self.res.pointer_at(base + offset) {
                        self.record(target, len);
                    }
                }
                Op::List(spec) => self.list(&spec, base)?,
                Op::Rules(offset, shape) => self.rules(base + offset, shape)?,
                Op::Props {
                    first,
                    count,
                    whole,
                } => self.props(base + first, count, whole)?,
                Op::FramePointers(offset) => self.frame_pointers(base + offset)?,
                Op::ModelLink(offset) => {
                    if let Some(model) = self.res.pointer_at(base + offset) {
                        self.object(model, Shape::Model)?;
                        self.extents(model)?;
                    }
                }
                Op::Extents => self.extents(base)?,
            }
        }
        Ok(())
    }

    /// Строка по слоту: до первого нуля в первых 256 байтах; без нуля или за концом данных её нет.
    fn text(&mut self, slot: usize) {
        let Some(start) = self.res.pointer_at(slot) else {
            return;
        };
        let end = self.res.data()[start..]
            .iter()
            .take(256)
            .position(|&byte| byte == 0);
        if let Some(end) = end {
            self.record(start, end + 1);
        }
    }

    fn list(&mut self, spec: &Spec, base: usize) -> Result<()> {
        let head = self.res.pointer_list(base + spec.at)?;
        let Some(array) = self.res.at(head.entries) else {
            return Ok(());
        };
        let amount = |by: By| {
            usize::from(match by {
                By::Count => head.count,
                By::Capacity => head.capacity,
            })
        };
        self.record(array, amount(spec.size) * spec.stride);
        if matches!(spec.each, Each::Nothing) {
            return Ok(());
        }
        for slot in 0..amount(spec.walk) {
            self.element(&spec.each, array + slot * spec.stride)?;
        }
        Ok(())
    }

    fn element(&mut self, each: &Each, at: usize) -> Result<()> {
        match *each {
            Each::Nothing => {}
            Each::Link(shape) => {
                if let Some(target) = self.res.pointer_at(at) {
                    self.object(target, shape)?;
                }
            }
            Each::Prop => {
                if let Some(target) = self.res.pointer_at(at) {
                    self.property(target, true)?;
                }
            }
            Each::Behaviour => {
                let Some(target) = self.res.pointer_at(at) else {
                    return Ok(());
                };
                let hash = self.res.u32(target + 8)?;
                if let Some(&(_, len)) = BEHAVIOURS.iter().find(|(known, _)| *known == hash) {
                    let props = BUILT_IN_PROPS
                        .iter()
                        .find(|(known, _)| *known == hash)
                        .map_or(0, |&(_, count)| count);
                    self.object(target, Shape::Behaviour { len, props })?;
                }
            }
            Each::Variable => {
                let Some(target) = self.res.pointer_at(at) else {
                    return Ok(());
                };
                let shape = match self.res.u8(target + 0x14)? {
                    2 | 4 => Shape::VarVector,
                    6 => Shape::VarTexture,
                    7 => Shape::VarKeyframe,
                    _ => return Ok(()),
                };
                self.object(target, shape)?;
            }
            Each::Inline(ops) => self.run(ops, at)?,
        }
        Ok(())
    }

    fn rules(&mut self, slot: usize, shape: Shape) -> Result<()> {
        let Some(dictionary) = self.res.pointer_at(slot) else {
            return Ok(());
        };
        self.object(dictionary, Shape::RuleDict)?;
        let head = self.res.pointer_list(dictionary + DICTIONARY_VALUES)?;
        if let Some(array) = self.res.at(head.entries) {
            for index in 0..usize::from(head.count) {
                if let Some(value) = self.res.pointer_at(array + index * 8) {
                    self.object(value, shape)?;
                }
            }
            self.record(array, usize::from(head.capacity) * 8);
        }
        Ok(())
    }

    /// Ключевое свойство: слово-хеш имени и ключи; `whole` — ещё и сам блок свойства.
    fn property(&mut self, at: usize, whole: bool) -> Result<()> {
        if whole {
            self.record(at, KEYFRAME_PROP_LENGTH);
        }
        self.found.name_hashes.push(at + NAME_HASH);
        self.list(&KEYS, at)
    }

    fn props(&mut self, first: usize, count: usize, whole: bool) -> Result<()> {
        for index in 0..count {
            self.property(first + index * KEYFRAME_PROP_LENGTH, whole)?;
        }
        Ok(())
    }

    /// Массив указателей на свойства: читается только слот, ёмкость — отдельным u16 рядом.
    fn frame_pointers(&mut self, list: usize) -> Result<()> {
        let Some(array) = self.res.pointer_at(list) else {
            return Ok(());
        };
        let capacity = usize::from(self.res.u16(list + 0xA)?);
        self.record(array, capacity * 8);
        for slot in 0..capacity {
            if let Some(target) = self.res.pointer_at(array + slot * 8) {
                self.property(target, true)?;
            }
        }
        Ok(())
    }

    fn extents(&mut self, model: usize) -> Result<()> {
        for (at, len) in geometry_extents(self.res, model)? {
            self.record(at, len);
        }
        Ok(())
    }

    fn level_model(&mut self, at: usize) -> Result<()> {
        let n = usize::from(self.res.u16(at + 0x10)?);
        let Some(geometries) = self.res.pointer_at(at + 0x08) else {
            return Ok(());
        };
        for slot in 0..n {
            if let Some(geometry) = self.res.pointer_at(geometries + slot * 8) {
                self.object(geometry, Shape::Geometry)?;
            }
        }
        Ok(())
    }

    fn geometry(&mut self, at: usize) -> Result<()> {
        self.run(GEOMETRY_OPS, at)?;
        if let Some(bones) = self.res.pointer_at(at + 0x68) {
            let count = usize::from(self.res.u16(at + 0x72)?);
            self.record(bones, count * 2);
        }
        Ok(())
    }

    /// Шейдер: параметры по 16 байт на параметр, у векторов следом идут блоки по 16 байт; у текстур слот с объектом.
    fn shader(&mut self, at: usize) -> Result<()> {
        let Some(params) = self.res.pointer_at(at) else {
            return Ok(());
        };
        let count = usize::from(self.res.u8(at + 0x10)?);
        let kinds = (0..count)
            .map(|k| self.res.u8(params + k * 16))
            .collect::<Result<Vec<u8>>>()?;
        let blocks: usize = kinds.iter().map(|&kind| usize::from(kind)).sum();
        let len = count * 16 + blocks * 16 + count * 4;
        if len > 0 {
            self.record(params, len);
        }
        for (k, _) in kinds.iter().enumerate().filter(|(_, &kind)| kind == 0) {
            if let Some(texture) = self.res.pointer_at(params + k * 16 + 8) {
                self.object(texture, Shape::Texture)?;
            }
        }
        Ok(())
    }
}

pub fn lengths(res: &Resource) -> Result<Lengths> {
    let root = res
        .root()
        .ok_or_else(|| Error::broken("Корень ресурса недоступен."))?;
    let core = read(res)?;
    let mut walker = Walker {
        res,
        found: Lengths::default(),
        queue: VecDeque::new(),
    };
    walker.object(root, Shape::Root)?;
    for texture in &core.textures {
        if let Some(at) = texture.data_at.filter(|_| texture.bytes > 0) {
            walker.record(at, texture.bytes);
        }
    }
    while let Some((at, shape)) = walker.queue.pop_front() {
        walker.visit(at, shape)?;
    }
    Ok(walker.found)
}

#[cfg(test)]
mod tests {
    use super::super::export::fixture::{resource, Image};
    use super::*;
    use crate::error::Kind as Failure;

    const EOF: &str = "Чтение за концом данных ресурса.";
    const DXT1: u32 = 0x3154_5844;

    /// Куда указывает слот (смещение в данных).
    fn target(img: &Image, slot: usize) -> usize {
        let raw = u64::from_le_bytes(img.data[slot..slot + 8].try_into().unwrap());
        (raw - 0x5000_0000) as usize
    }

    fn measure(img: &Image) -> Lengths {
        lengths(&img.resource(68)).unwrap()
    }

    fn core() -> Image {
        let mut img = Image::new();
        img.core();
        img
    }

    /// Текстура словаря DXT1 `side`×`side`; возвращает объект и адрес байтов ступеней.
    fn texture_object(img: &mut Image, name: &str, side: u16, levels: u8) -> (usize, usize) {
        let at = img.alloc(0x90);
        img.text(at + 0x28, name);
        img.word(at + 0x50, side);
        img.word(at + 0x52, side);
        img.word(at + 0x54, 1);
        img.dword(at + 0x58, DXT1);
        img.byte(at + 0x5D, levels);
        let data = img.alloc(4096);
        img.link(at + 0x70, data);
        (at, data)
    }

    /// Ключи свойства: список по `at + 0x70` с заданной ёмкостью.
    fn keys_for(img: &mut Image, property: usize, count: u16, capacity: u16) -> usize {
        let array = img.alloc(usize::from(capacity).max(1) * 0x20);
        img.list(property + 0x70, array, count, capacity);
        array
    }

    /// Эффект в корне; у частицы события есть имя, но самой ссылки на неё в словаре нет.
    fn effect_with_particle(img: &mut Image) -> (usize, usize) {
        let particle = img.particle("pa");
        let event = img.event(0, particle);
        let fx = img.effect("fx", &[event]);
        img.rule_dictionaries(&[fx], &[], &[]);
        (fx, particle)
    }

    #[test]
    fn constants_match_the_schema() {
        assert_eq!(
            [
                ROOT,
                DICTIONARY,
                EFFECT,
                EVENT,
                EMITTER,
                PARTICLE,
                DOMAIN,
                EVOLUTION_LIST,
                BIAS_LINK,
                DRAWABLE,
                SHADER_VAR_VECTOR,
                SHADER_VAR_TEXTURE,
                SHADER_VAR_KEYFRAME,
            ],
            [0x60, 0x40, 0x3C0, 0x70, 0x630, 0x240, 0x280, 0x40, 0x58, 0x30, 0x40, 0x40, 0x50]
        );
    }

    #[test]
    fn the_behaviour_table_lists_every_type_once() {
        assert_eq!(BEHAVIOURS.len(), 23);
        let mut hashes: Vec<u32> = BEHAVIOURS.iter().map(|&(hash, _)| hash).collect();
        hashes.sort_unstable();
        hashes.dedup();
        assert_eq!(hashes.len(), 23);
        assert_eq!(BEHAVIOURS[0], (0xF5B3_3BAA, 0x30));
        assert_eq!(BEHAVIOURS[11], (0x38B6_3978, 0xF0));
        assert_eq!(BEHAVIOURS[12], (0x0544_C710, 0x550));
        assert_eq!(BEHAVIOURS[22], (0xDF22_9542, 0x50));
        assert_eq!(BUILT_IN_PROPS.len(), 16);
        for &(hash, count) in BUILT_IN_PROPS {
            let (_, len) = BEHAVIOURS.iter().find(|(known, _)| *known == hash).unwrap();
            assert!(0x30 + count * KEYFRAME_PROP_LENGTH <= *len, "{hash:#x}");
        }
    }

    #[test]
    fn an_empty_result_prints_as_three_empty_collections() {
        assert_eq!(
            format!("{:?}", Lengths::default()),
            "Lengths { objects: {}, conflicts: [], name_hashes: [] }"
        );
    }

    #[test]
    fn a_minimal_core_has_the_root_and_the_texture_dictionary() {
        let found = measure(&core());
        let mut objects: Vec<_> = found.objects.iter().map(|(&at, &len)| (at, len)).collect();
        objects.sort_unstable();
        assert_eq!(objects, [(0, 0x60), (0x100, 0x40)]);
        assert!(found.conflicts.is_empty() && found.name_hashes.is_empty());
    }

    #[test]
    fn the_root_registers_its_header_name_and_model_dictionary() {
        let mut img = core();
        let header = img.alloc(0x10);
        img.link(0x08, header);
        img.text(0x10, "core_name");
        let models = img.alloc(0x40);
        img.link(0x30, models);
        let found = measure(&img);
        assert_eq!(found.objects[&header], 0x10);
        assert_eq!(found.objects[&target(&img, 0x10)], 10);
        assert_eq!(found.objects[&models], 0x40);
        assert_eq!(found.objects.len(), 5);
    }

    #[test]
    fn failures_come_in_a_fixed_order() {
        let error = lengths(&resource(13, Vec::new())).unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (Failure::Broken, "Корень ресурса недоступен."));

        let img = core();
        for version in [0, 13, 69, 165] {
            let error = lengths(&img.resource(version)).unwrap_err();
            assert_eq!(error.kind, Failure::Version);
            assert_eq!(
                error.message,
                format!("core.ypt версии {version} не поддерживается; ожидается Legacy 68.")
            );
        }

        let error = lengths(&Image::new().resource(68)).unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (Failure::Broken, "В core.ypt нет словаря текстур."));

        let mut img = core();
        img.word(0x100 + 0x30 + 8, 4097);
        let error = lengths(&img.resource(68)).unwrap_err();
        assert_eq!(error.message, "Словарь текстур заявляет слишком много записей.");

        let mut img = core();
        let many = img.effect("many", &[]);
        img.word(many + 0x38 + 8, 4097);
        img.rule_dictionaries(&[many], &[], &[]);
        let error = lengths(&img.resource(68)).unwrap_err();
        assert_eq!(error.message, "У правила «many» заявлено слишком много событий.");
    }

    #[test]
    fn strings_end_at_the_first_zero_inside_256_bytes() {
        let cases: Vec<(String, Option<usize>)> = vec![
            ("a".to_owned(), Some(2)),
            ("x".repeat(255), Some(256)),
            ("x".repeat(256), None),
        ];
        for (text, expected) in cases {
            let mut img = core();
            img.text(0x10, &text);
            let found = measure(&img);
            assert_eq!(found.objects.get(&target(&img, 0x10)).copied(), expected, "{}", text.len());
        }
        let mut img = core();
        let len = img.data.len();
        img.put(len - 3, b"ab\0");
        img.link(0x10, len - 3);
        assert_eq!(measure(&img).objects[&(len - 3)], 3);
        img.put(len - 3, b"abc");
        assert!(!measure(&img).objects.contains_key(&(len - 3)));
    }

    #[test]
    fn texture_dictionaries_take_arrays_by_capacity_and_payloads_by_size() {
        let mut img = Image::new();
        let (first, first_data) = texture_object(&mut img, "ptfx_a", 8, 1);
        let (second, second_data) = texture_object(&mut img, "ptfx_b", 16, 3);
        let (spare, _) = texture_object(&mut img, "ptfx_spare", 8, 1);
        let dictionary = img.alloc(0x40);
        let array = img.pointers(dictionary + 0x30, &[first, second], 8);
        img.link(array + 6 * 8, spare);
        let hashes = img.alloc(32);
        img.list(dictionary + 0x20, hashes, 2, 8);
        img.link(0x20, dictionary);
        let found = measure(&img);
        assert_eq!(found.objects[&dictionary], 0x40);
        assert_eq!(found.objects[&array], 0x40);
        assert_eq!(found.objects[&hashes], 0x20);
        for texture in [first, second, spare] {
            assert_eq!(found.objects[&texture], 0x90);
        }
        assert_eq!(found.objects[&target(&img, spare + 0x28)], 11);
        assert_eq!(found.objects[&first_data], 32);
        assert_eq!(found.objects[&second_data], 168);
    }

    #[test]
    fn an_effect_takes_events_by_count_and_only_the_keys_of_built_in_properties() {
        let mut img = core();
        let first = img.event(0, 0);
        let second = img.event(0, 0);
        let fx = img.effect("fx", &[first, second]);
        img.word(fx + 0x38 + 10, 5);
        let key_arrays = [
            keys_for(&mut img, fx + 0xC0, 2, 3),
            keys_for(&mut img, fx + 0xC0 + 0x90, 0, 0),
        ];
        img.rule_dictionaries(&[fx], &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&fx], 0x3C0);
        assert_eq!(found.objects[&target(&img, fx + 0x38)], 16);
        assert_eq!(found.objects[&first], 0x70);
        assert_eq!(found.objects[&second], 0x70);
        assert_eq!(found.objects[&target(&img, fx + 0x20)], 3);
        assert_eq!(found.objects[&key_arrays[0]], 0x60);
        assert_eq!(found.objects[&key_arrays[1]], 0);
        assert!(!found.objects.contains_key(&(fx + 0xC0)));
        let expected: Vec<usize> = (0..5).map(|k| fx + 0xC0 + k * 0x90 + 0x68).collect();
        assert_eq!(found.name_hashes, expected);
    }

    #[test]
    fn property_pointer_arrays_of_an_effect_use_their_own_capacity() {
        let mut img = core();
        let fx = img.effect("fx", &[]);
        let array = img.alloc(4 * 8);
        let first = img.alloc(0x90);
        let last = img.alloc(0x90);
        img.link(array, first);
        img.link(array + 3 * 8, last);
        img.link(fx + 0x390, array);
        img.word(fx + 0x39A, 4);
        let first_keys = keys_for(&mut img, first, 1, 2);
        img.rule_dictionaries(&[fx], &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&array], 0x20);
        assert_eq!(found.objects[&first], 0x90);
        assert_eq!(found.objects[&last], 0x90);
        assert_eq!(found.objects[&first_keys], 0x40);
        assert!(found.name_hashes.contains(&(first + 0x68)));
        assert!(found.name_hashes.contains(&(last + 0x68)));

        img.word(fx + 0x39A, 0);
        assert_eq!(measure(&img).objects[&array], 0);
        img.link(fx + 0x390, 0);
        assert!(!measure(&img).objects.contains_key(&array));
    }

    #[test]
    fn one_address_with_two_lengths_conflicts_and_keeps_the_bigger() {
        let mut img = core();
        let shared = img.alloc(0x630);
        img.text(shared + 0x120, "never");
        let event = img.event(shared, shared);
        let fx = img.effect("fx", &[event]);
        img.rule_dictionaries(&[fx], &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&shared], 0x630);
        assert_eq!(found.conflicts, [shared]);
        // обход идёт по первому виду (эмиттер): строка частицы не читается
        assert!(!found.objects.contains_key(&target(&img, shared + 0x120)));
    }

    #[test]
    fn equal_lengths_of_different_kinds_do_not_conflict() {
        let mut img = core();
        let evolutions = img.alloc(0x40);
        img.link(0x30, evolutions);
        let event = img.event(0, 0);
        img.link(event + 0x18, evolutions);
        let fx = img.effect("fx", &[event]);
        img.rule_dictionaries(&[fx], &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&evolutions], 0x40);
        assert!(found.conflicts.is_empty());
    }

    #[test]
    fn a_repeated_event_slot_adds_a_conflict_per_array_length() {
        let mut img = core();
        let shared = img.alloc(16);
        let mut effects = Vec::new();
        for (k, count) in [1u16, 2, 3, 1].into_iter().enumerate() {
            let fx = img.effect(&format!("fx{k}"), &[]);
            img.link(fx + 0x38, shared);
            img.word(fx + 0x38 + 8, count);
            effects.push(fx);
        }
        img.rule_dictionaries(&effects, &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&shared], 0x18);
        assert_eq!(found.conflicts, [shared, shared, shared]);
    }

    fn walker(res: &Resource) -> Walker<'_> {
        Walker {
            res,
            found: Lengths::default(),
            queue: VecDeque::new(),
        }
    }

    /// Модель уровня из `count` геометрий, у каждой `bones` костей.
    fn level_model(img: &mut Image, count: u16, bones: u16) -> usize {
        let model = img.alloc(0x40);
        let geometries = img.alloc(usize::from(count).max(1) * 8);
        for k in 0..usize::from(count) {
            let geometry = img.alloc(0xA0);
            img.link(geometry + 0x68, model);
            img.word(geometry + 0x72, bones);
            img.link(geometries + k * 8, geometry);
        }
        img.link(model + 8, geometries);
        img.word(model + 0x10, count);
        model
    }

    #[test]
    fn model_and_geometry_lengths_follow_the_formulas() {
        let geometry_lens = [0x98, 0x9E, 0xA0, 0xAA, 0xAC];
        let model_lens = [
            [0xF8, 0xFE, 0x100, 0x10A, 0x10C],
            [0x1E8, 0x1EE, 0x1F0, 0x20A, 0x20C],
            [0x2B8, 0x2BE, 0x2C0, 0x2EA, 0x2EC],
            [0x378, 0x37E, 0x380, 0x3BA, 0x3BC],
            [0x448, 0x44E, 0x450, 0x49A, 0x49C],
        ];
        for (n, row) in model_lens.iter().enumerate() {
            for (variant, bones) in [0u16, 3, 4, 5, 6].into_iter().enumerate() {
                let mut img = Image::new();
                let model = level_model(&mut img, n as u16 + 1, bones);
                let res = img.resource(68);
                let w = walker(&res);
                assert_eq!(w.level_model_len(model).unwrap(), row[variant], "n={} b={bones}", n + 1);
                let geometry = target(&img, target(&img, model + 8));
                assert_eq!(w.geometry_len(geometry).unwrap(), geometry_lens[variant]);
            }
        }
    }

    #[test]
    fn model_formula_edge_cases() {
        let mut img = Image::new();
        let model = level_model(&mut img, 2, 9);
        let geometries = target(&img, model + 8);
        let first = target(&img, geometries);
        img.link(first + 0x68, 0);
        let empty_slot = target(&img, geometries + 8);
        img.link(geometries + 8, 0);
        let res = img.resource(68);
        let w = walker(&res);
        assert_eq!(w.geometry_len(first).unwrap(), 0x98);
        assert_eq!(w.geometry_len(empty_slot).unwrap(), 152 + 18 + 8);
        // первая геометрия без костей, вторая выпала из массива: 176 + 152
        assert_eq!(w.level_model_len(model).unwrap(), 0x148);
        img.link(model + 8, 0);
        let res = img.resource(68);
        assert_eq!(walker(&res).level_model_len(model).unwrap(), 0xB0);
    }

    /// Шейдер с параметрами заданных видов; у текстур (вид 0) в слоте лежит объект.
    fn shader_object(img: &mut Image, kinds: &[u8]) -> (usize, usize) {
        let shader = img.alloc(0x30);
        let params = img.alloc(kinds.len().max(1) * 16 + 16);
        for (k, &kind) in kinds.iter().enumerate() {
            img.byte(params + k * 16, kind);
            if kind == 0 {
                let (texture, _) = texture_object(img, "tn", 4, 1);
                img.link(params + k * 16 + 8, texture);
            }
        }
        img.link(shader, params);
        img.byte(shader + 0x10, kinds.len() as u8);
        (shader, params)
    }

    #[test]
    fn shader_parameters_set_the_length_and_texture_slots() {
        for (kinds, expected) in [
            (vec![0u8, 2, 0], 0x5C),
            (vec![1, 1], 0x48),
            (vec![0], 0x14),
            (vec![255, 0], 0x1018),
        ] {
            let mut img = Image::new();
            let (shader, params) = shader_object(&mut img, &kinds);
            let res = img.resource(68);
            let mut w = walker(&res);
            w.shader(shader).unwrap();
            assert_eq!(w.found.objects[&params], expected, "{kinds:?}");
            let textures = kinds.iter().filter(|&&kind| kind == 0).count();
            let registered = w.found.objects.values().filter(|&&len| len == 0x90).count();
            assert_eq!(registered, textures, "{kinds:?}");
        }
        let mut img = Image::new();
        let (shader, params) = shader_object(&mut img, &[]);
        let res = img.resource(68);
        let mut w = walker(&res);
        w.shader(shader).unwrap();
        assert!(w.found.objects.is_empty(), "{params}");
        img.link(shader, 0);
        img.byte(shader + 0x10, 200);
        let res = img.resource(68);
        let mut w = walker(&res);
        w.shader(shader).unwrap();
        assert!(w.found.objects.is_empty());
    }

    #[test]
    fn behaviours_register_by_known_hash_with_their_properties() {
        let mut img = core();
        let (_, particle) = effect_with_particle(&mut img);
        let wind = img.alloc(0xF0);
        img.dword(wind + 8, 0x38B6_3978);
        let embedded_keys = keys_for(&mut img, wind + 0x30, 1, 2);
        let listed = img.alloc(0x90);
        img.pointers(wind + 0x10, &[listed], 3);
        let unknown = img.alloc(0x40);
        img.dword(unknown + 8, 0x1234_5678);
        let first_list = img.pointers(particle + 0x128, &[wind, unknown], 5);
        let later_list = img.pointers(particle + 0x168, &[unknown], 0);
        let found = measure(&img);
        assert_eq!(found.objects[&wind], 0xF0);
        assert_eq!(found.objects[&(wind + 0x30)], 0x90);
        assert_eq!(found.objects[&embedded_keys], 0x40);
        assert_eq!(found.objects[&target(&img, wind + 0x10)], 0x18);
        assert_eq!(found.objects[&listed], 0x90);
        assert_eq!(found.objects[&first_list], 0x28);
        assert_eq!(found.objects[&later_list], 8);
        assert!(!found.objects.contains_key(&unknown));
        assert_eq!(found.name_hashes.len(), 5 + 2);
        assert!(found.name_hashes.contains(&(wind + 0x30 + 0x68)));
        assert!(found.name_hashes.contains(&(listed + 0x68)));
    }

    #[test]
    fn shader_variables_register_only_the_known_types() {
        let mut img = core();
        let (_, particle) = effect_with_particle(&mut img);
        let mut vars = Vec::new();
        for kind in [2u8, 4, 6, 7, 3, 9] {
            let var = img.alloc(0x50);
            img.byte(var + 0x14, kind);
            vars.push(var);
        }
        img.text(vars[2] + 0x30, "ptfx_smoke");
        let items = img.alloc(0x80);
        img.list(vars[3] + 0x28, items, 1, 4);
        let array = img.pointers(particle + 0x1F0, &vars, 8);
        let found = measure(&img);
        assert_eq!(found.objects[&array], 0x40);
        for (var, len) in vars.iter().zip([0x40, 0x40, 0x40, 0x50]) {
            assert_eq!(found.objects[var], len);
        }
        assert!(!found.objects.contains_key(&vars[4]));
        assert!(!found.objects.contains_key(&vars[5]));
        assert_eq!(found.objects[&target(&img, vars[2] + 0x30)], 11);
        assert_eq!(found.objects[&items], 0x80);
    }

    #[test]
    fn bias_links_and_particle_models_register_their_arrays() {
        let mut img = core();
        let (_, particle) = effect_with_particle(&mut img);
        let links = img.alloc(4 * 0x58);
        let ids = img.alloc(0x14);
        img.list(links + 0x40, ids, 1, 5);
        img.list(particle + 0x188, links, 2, 4);
        let models = img.alloc(3 * 0x30);
        let model = img.alloc(0xD0);
        img.text(models + 0x10, "mesh");
        img.link(models + 0x18, model);
        img.text(models + 0x30 + 0x10, "other");
        img.list(particle + 0x210, models, 2, 3);
        let found = measure(&img);
        assert_eq!(found.objects[&links], 0x160);
        assert_eq!(found.objects[&ids], 0x14);
        assert_eq!(found.objects[&models], 0x90);
        assert_eq!(found.objects[&model], 0xD0);
        assert_eq!(found.objects[&target(&img, models + 0x10)], 5);
        assert_eq!(found.objects[&target(&img, models + 0x40)], 6);
    }

    #[test]
    fn an_evolution_map_points_inside_the_property_array_and_conflicts() {
        let mut img = core();
        let list = img.alloc(0x40);
        let names = img.alloc(4 * 0x18);
        img.text(names, "size");
        img.text(names + 0x18, "wind");
        img.list(list, names, 2, 4);
        let table = img.alloc(4 * 0x18);
        img.list(list + 0x10, table, 2, 4);
        let map = img.alloc(4 * 0x10);
        img.link(map + 8, table);
        img.link(map + 0x10 + 8, table + 0x18);
        img.list(list + 0x28, map, 2, 4);
        let fx = img.effect("fx", &[]);
        img.link(fx + 0x48, list);
        img.rule_dictionaries(&[fx], &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&list], 0x40);
        assert_eq!(found.objects[&names], 0x60);
        assert_eq!(found.objects[&map], 0x40);
        assert_eq!(found.objects[&table], 0x60);
        assert_eq!(found.objects[&(table + 0x18)], 0x18);
        assert_eq!(found.conflicts, [table]);
        assert_eq!(found.objects[&target(&img, names)], 5);
    }

    #[test]
    fn evolution_frames_and_keys_are_walked_by_count_with_capacity_arrays() {
        let mut img = core();
        let list = img.alloc(0x40);
        let table = img.alloc(0x18);
        let frames = img.alloc(2 * 0x30);
        let keys = img.alloc(3 * 0x20);
        img.list(frames, keys, 2, 3);
        img.list(table, frames, 1, 2);
        img.list(list + 0x10, table, 1, 1);
        let fx = img.effect("fx", &[]);
        img.link(fx + 0x48, list);
        img.rule_dictionaries(&[fx], &[], &[]);
        let found = measure(&img);
        assert_eq!(found.objects[&table], 0x18);
        assert_eq!(found.objects[&frames], 0x60);
        assert_eq!(found.objects[&keys], 0x60);
    }

    #[test]
    fn a_list_cut_off_by_the_end_of_the_data_is_an_error() {
        let mut img = core();
        let len = img.data.len();
        img.rule_dictionaries(&[len - 0x40], &[], &[]);
        let error = lengths(&img.resource(68)).unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (Failure::Broken, EOF));
    }

    #[test]
    fn a_dictionary_without_values_is_fine_and_one_at_the_end_is_not() {
        let mut img = core();
        let dictionary = img.alloc(0x40);
        img.link(0x48, dictionary);
        assert_eq!(measure(&img).objects.len(), 3);
        let len = img.data.len();
        img.link(0x48, len - 0x20);
        let error = lengths(&img.resource(68)).unwrap_err();
        assert_eq!(error.message, EOF);
    }

    #[test]
    fn declared_counts_above_4096_are_refused_before_the_walk() {
        let mut img = core();
        let list = img.alloc(0x40);
        img.word(list + 8, 4097);
        let fx = img.effect("fx", &[]);
        img.link(fx + 0x48, list);
        img.rule_dictionaries(&[fx], &[], &[]);
        let error = lengths(&img.resource(68)).unwrap_err();
        assert_eq!(error.kind, Failure::Broken);
        assert_eq!(error.message, "Список эволюций заявляет слишком много записей.");
    }

    #[test]
    fn an_array_registered_first_blocks_the_walk_of_an_equal_object() {
        for with_texture in [false, true] {
            let mut img = core();
            let fx = img.alloc(0x3C0);
            img.text(fx + 0x20, "fx");
            img.pointers(fx + 0x38, &[], 0);
            if with_texture {
                // 48×40 DXT1: ровно 0x3C0 байт ступеней, и лежат они там же, где правило
                let (texture, _) = texture_object(&mut img, "blocker", 4, 1);
                img.word(texture + 0x50, 48);
                img.word(texture + 0x52, 40);
                img.link(texture + 0x70, fx);
                img.pointers(target(&img, 0x20) + 0x30, &[texture], 0);
            }
            img.rule_dictionaries(&[fx], &[], &[]);
            let found = measure(&img);
            assert_eq!(found.objects[&fx], 0x3C0);
            assert!(found.conflicts.is_empty());
            let name_walked = found.objects.contains_key(&target(&img, fx + 0x20));
            assert_eq!(name_walked, !with_texture);
        }
    }

    #[test]
    fn a_model_with_too_many_levels_stops_the_walk() {
        let mut img = core();
        let model = img.alloc(0xD0);
        let level = img.alloc(0x10);
        let array = img.alloc(5000 * 8);
        img.list(level, array, 5000, 5000);
        img.link(model + 0x50, level);
        let dictionary = img.alloc(0x40);
        img.pointers(dictionary + 0x30, &[model], 0);
        img.link(0x30, dictionary);
        let error = lengths(&img.resource(68)).unwrap_err();
        assert_eq!(error.kind, Failure::Broken);
        assert_eq!(error.message, "Модель заявляет слишком много частей.");
    }

    #[test]
    fn graphics_pointers_are_numbered_after_the_system_area() {
        let mut img = core();
        let at = img.alloc(0x90);
        img.text(at + 0x28, "gfx");
        img.word(at + 0x50, 4);
        img.word(at + 0x52, 4);
        img.word(at + 0x54, 1);
        img.dword(at + 0x58, DXT1);
        img.byte(at + 0x5D, 1);
        let dictionary = target(&img, 0x20);
        img.pointers(dictionary + 0x30, &[at], 1);
        img.put(at + 0x70, &(0x6000_0000u64 + 0x1000).to_le_bytes());
        let mut data = img.data.clone();
        data.truncate(0x10000);
        let header = crate::resource::Header {
            system_flags: 0,
            graphics_flags: 0,
            system_size: 0x8000,
            graphics_size: 0x8000,
            version: 68,
            declared_version: 68,
        };
        let found = lengths(&Resource::from_parts(header, data)).unwrap();
        assert_eq!(found.objects[&0x9000], 8);
    }
}
