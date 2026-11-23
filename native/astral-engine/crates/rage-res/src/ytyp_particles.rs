//! Частицы ламп в файле типов `.ytyp`: снять с архетипов эффекты с заданным префиксом и добавить новые.
//!
//! Работает как команда хоста `lamp-studio-ytyp`: файл читается в граф (`meta_graph`), у каждого
//! архетипа из массива `extensions` убираются частицы `CExtensionDefParticleEffect`, чей `fxName`
//! начинается с префикса, потом по запросам добавляются новые, и граф пишется обратно. Поля ищутся
//! по именам из схемы самого файла: у разных видов архетипов смещения свои.

use std::collections::HashMap;

use crate::error::{Error, Result};
use crate::hash::joaat_case;
use crate::meta_graph::{
    self, Entry, Graph, Link, Node, NodeId, Read, StructDef, POINTER_BLOCK, STRING_BLOCK,
};

/// Структура частицы в схеме файла.
const FX_STRUCT: &str = "CExtensionDefParticleEffect";
/// Тип записи схемы «указатель на строку».
const STR_PTR: u8 = 0x44;
/// Тип записи схемы «вложенная структура» и глубина, глубже которой вложенность не разбирается.
const NESTED: u8 = 0x05;
const NESTING_LIMIT: usize = 16;

/// Тексты отказов, общие для нескольких мест.
mod said {
    pub const OUTSIDE_FIELD: &str = "Поле вне узла метаданных.";
    pub const OUTSIDE_POINTER: &str = "Указатель вне узла метаданных.";
    pub const OUTSIDE_COUNTER: &str = "Счётчик вне узла метаданных.";
}

fn key(name: &str) -> u32 {
    joaat_case(name)
}

// ---------------------------------------------------------------------------
// Поля структур по именам
// ---------------------------------------------------------------------------

/// Какое поле искать и что сказать, если у блока нет описания или в описании нет поля.
struct FieldRef {
    undescribed: &'static str,
    name: &'static str,
    absent: &'static str,
}

const ROOT_LIST: FieldRef = FieldRef {
    undescribed: "Корень без описания.",
    name: "archetypes",
    absent: "В корне нет архетипов.",
};
const OWNER_NAME: FieldRef = FieldRef {
    undescribed: "Архетип без описания.",
    name: "name",
    absent: "В архетипе нет имени.",
};
const OWNER_EXTENSIONS: FieldRef = FieldRef {
    undescribed: "Архетип без описания.",
    name: "extensions",
    absent: "В архетипе нет расширений.",
};
const FX_NAME: FieldRef = FieldRef {
    undescribed: "Частица без описания.",
    name: "fxName",
    absent: "У частицы нет fxName.",
};

/// Смещение поля в узле `node` по схеме его блока.
fn field_of(read: &Read, node: NodeId, wanted: &FieldRef) -> Result<usize> {
    let def = read
        .schema
        .struct_named(read.graph.nodes[node].block)
        .ok_or_else(|| Error::broken(wanted.undescribed))?;
    offset_in(def, wanted.name).ok_or_else(|| Error::broken(wanted.absent))
}

fn offset_in(def: &StructDef, name: &str) -> Option<usize> {
    def.field(key(name))
        .map(|entry| usize::try_from(entry.offset).unwrap_or(usize::MAX))
}

fn bytes_of(node: &Node, at: usize, len: usize) -> Option<&[u8]> {
    node.bytes.get(at..)?.get(..len)
}

fn word32(node: &Node, at: usize) -> Option<u32> {
    let raw = bytes_of(node, at, 4)?;
    Some(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]))
}

fn word64(node: &Node, at: usize) -> Option<u64> {
    let mut raw = [0u8; 8];
    raw.copy_from_slice(bytes_of(node, at, 8)?);
    Some(u64::from_le_bytes(raw))
}

/// Кладёт `raw` в `bytes` по смещению; не умещается — отказ с заданным текстом.
fn store(bytes: &mut [u8], at: usize, raw: &[u8], refusal: &'static str) -> Result<()> {
    bytes
        .get_mut(at..)
        .and_then(|rest| rest.get_mut(..raw.len()))
        .map(|room| room.copy_from_slice(raw))
        .ok_or_else(|| Error::broken(refusal))
}

/// Массив указателей на `items`: узел из нулей и по ссылке на слот.
fn pointer_array(graph: &mut Graph, items: &[NodeId]) -> NodeId {
    graph.push(Node {
        block: POINTER_BLOCK,
        bytes: vec![0; items.len() * 8],
        links: items
            .iter()
            .enumerate()
            .map(|(slot, &item)| Link { at: slot * 8, target: Some(item) })
            .collect(),
    })
}

// ---------------------------------------------------------------------------
// Проверка запроса
// ---------------------------------------------------------------------------

/// Смещение частицы от начала координат архетипа (метры модели) и номер кости.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub bone: u32,
}

fn inside_model(point: &Point) -> bool {
    point.bone <= 0xFFFF
        && [point.x, point.y, point.z]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 64.0)
}

/// Правила для префикса: каждое должно выполняться.
const PREFIX_RULES: [fn(&str) -> bool; 3] = [
    |p| (4..=40).contains(&p.len()),
    |p| p.starts_with(|c: char| c.is_ascii_alphabetic()),
    |p| p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
];

/// Запрос после приведения имён к виду, в котором они хранятся в файле.
struct Vetted<'r> {
    archetype: String,
    fx: String,
    request: &'r Request,
}

/// Правило запроса: условие нарушения и отказ. Проверяются по порядку, побеждает первое.
type Rule = (fn(&Vetted<'_>, &str) -> bool, &'static str);

fn archetype_misfit(v: &Vetted<'_>, _: &str) -> bool {
    !(1..=64).contains(&v.archetype.len())
        || !v
            .archetype
            .bytes()
            .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_'))
}

fn fx_unprefixed(v: &Vetted<'_>, prefix: &str) -> bool {
    !v.fx.starts_with(prefix)
}

fn counts_out_of_range(v: &Vetted<'_>, _: &str) -> bool {
    !(1..=4).contains(&v.request.points.len()) || !(1..=100).contains(&v.request.probability)
}

fn point_outside(v: &Vetted<'_>, _: &str) -> bool {
    !v.request.points.iter().all(inside_model)
}

const REQUEST_RULES: [Rule; 4] = [
    (archetype_misfit, "Имя архетипа не годится."),
    (fx_unprefixed, "Эффект без префикса."),
    (counts_out_of_range, "Точки или вероятность вне пределов."),
    (point_outside, "Точка частицы вне модели или кость вне диапазона."),
];

/// Запрос на один архетип: эффект, вероятность (1…100) и от одной до четырёх точек.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub archetype: String,
    pub fx_name: String,
    pub probability: u32,
    pub points: Vec<Point>,
}

/// Возвращает префикс в нижнем регистре и проверенные запросы.
fn vet<'r>(prefix: &str, requests: &'r [Request]) -> Result<(String, Vec<Vetted<'r>>)> {
    let prefix = prefix.trim();
    if !PREFIX_RULES.iter().all(|holds| holds(prefix)) {
        return Err(Error::argument("Префикс частиц не годится."));
    }
    let prefix = prefix.to_ascii_lowercase();
    let vetted = requests
        .iter()
        .map(|request| {
            let vetted = Vetted {
                archetype: request.archetype.trim().to_ascii_lowercase(),
                fx: request.fx_name.trim().to_ascii_lowercase(),
                request,
            };
            match REQUEST_RULES.iter().find(|(broken, _)| broken(&vetted, &prefix)) {
                Some(&(_, refusal)) => Err(Error::argument(refusal)),
                None => Ok(vetted),
            }
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((prefix, vetted))
}

// ---------------------------------------------------------------------------
// Новые частицы
// ---------------------------------------------------------------------------

/// Поля частицы в порядке, в котором проверяется их наличие в схеме.
const PARTICLE_FIELDS: [&str; 8] = [
    "name",
    "offsetPosition",
    "offsetRotation",
    "boneTag",
    "scale",
    "probability",
    "color",
    "fxName",
];

/// Смещения полей частицы в схеме файла, в порядке `PARTICLE_FIELDS`.
fn particle_offsets(def: &StructDef) -> Result<[usize; 8]> {
    let mut found = [0usize; 8];
    for (slot, name) in found.iter_mut().zip(PARTICLE_FIELDS) {
        *slot = offset_in(def, name)
            .ok_or_else(|| Error::broken(format!("У частицы нет поля {name}.")))?;
    }
    Ok(found)
}

/// Узел частицы: нулевой буфер размера структуры, поля по смещениям, `fxName` — ссылкой на строку.
fn particle_node(
    def: &StructDef,
    offsets: [usize; 8],
    owner_hash: u32,
    probability: u32,
    point: &Point,
    fx: NodeId,
) -> Result<Node> {
    let [name, position, rotation, bone, scale, chance, color, fx_at] = offsets;
    let floats = |list: &[f32]| -> Vec<u8> { list.iter().flat_map(|v| v.to_le_bytes()).collect() };
    let writes: [(usize, Vec<u8>); 7] = [
        (name, owner_hash.to_le_bytes().to_vec()),
        (position, floats(&[point.x, point.y, point.z])),
        (rotation, floats(&[0.0, 0.0, 0.0, 1.0])),
        (bone, point.bone.to_le_bytes().to_vec()),
        (scale, floats(&[1.0])),
        (chance, probability.to_le_bytes().to_vec()),
        (color, vec![0xFF; 4]),
    ];
    let mut bytes = vec![0u8; def.size as usize];
    writes
        .iter()
        .try_for_each(|(at, raw)| store(&mut bytes, *at, raw, said::OUTSIDE_FIELD))?;
    Ok(Node {
        block: key(FX_STRUCT),
        bytes,
        links: vec![Link { at: fx_at, target: Some(fx) }],
    })
}

// ---------------------------------------------------------------------------
// Рабочая сессия над файлом
// ---------------------------------------------------------------------------

/// Архетип файла и его список расширений.
struct Owner {
    node: NodeId,
    /// Хеш имени из поля `name` узла.
    hash: u32,
    /// Смещение поля `extensions` в узле архетипа.
    slot: usize,
    /// Элементы расширений в порядке слотов.
    list: Vec<NodeId>,
    dirty: bool,
}

fn owner_at(read: &Read, id: NodeId) -> Result<Owner> {
    let node = &read.graph.nodes[id];
    let name_at = field_of(read, id, &OWNER_NAME)?;
    let slot = field_of(read, id, &OWNER_EXTENSIONS)?;
    let hash = word32(node, name_at).ok_or_else(|| Error::broken(said::OUTSIDE_FIELD))?;

    let array = node
        .links
        .iter()
        .find(|link| link.at == slot)
        .and_then(|link| link.target);
    let mut cells: Vec<&Link> = array
        .map(|array| read.graph.nodes[array].links.iter().collect())
        .unwrap_or_default();
    cells.sort_by_key(|link| link.at);
    let list = cells.iter().filter_map(|link| link.target).collect();
    Ok(Owner { node: id, hash, slot, list, dirty: false })
}

/// Все непустые архетипы массива `archetypes` корня в порядке ссылок.
fn collect_owners(read: &Read) -> Result<Vec<Owner>> {
    let root = read.graph.root;
    let at = field_of(read, root, &ROOT_LIST)?;
    let array = read.graph.nodes[root]
        .links
        .iter()
        .find(|link| link.at == at)
        .and_then(|link| link.target);
    array
        .map(|array| read.graph.nodes[array].links.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|link| link.target)
        .map(|id| owner_at(read, id))
        .collect()
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.as_bytes()
        .get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix.as_bytes()))
}

/// Правка файла: исходное чтение, рабочая копия графа, архетипы и пул строк-узлов.
struct Session<'r> {
    read: &'r Read,
    graph: Graph,
    owners: Vec<Owner>,
    /// Одинаковый текст делит один узел строки.
    texts: HashMap<String, NodeId>,
}

impl<'r> Session<'r> {
    fn open(read: &'r Read) -> Result<Self> {
        Ok(Session {
            read,
            graph: read.graph.clone(),
            owners: collect_owners(read)?,
            texts: HashMap::new(),
        })
    }

    fn intern(&mut self, text: &str) -> NodeId {
        if let Some(&id) = self.texts.get(text) {
            return id;
        }
        let id = self.graph.push(Node {
            block: STRING_BLOCK,
            bytes: [text.as_bytes(), &[0]].concat(),
            links: Vec::new(),
        });
        self.texts.insert(text.to_owned(), id);
        id
    }

    /// Частица ли это, и начинается ли её эффект с префикса. Нулевой и нечитаемый указатели
    /// считаются пустым эффектом: такая частица остаётся.
    fn is_doomed(&self, id: NodeId, prefix: &str) -> Result<bool> {
        let node = &self.read.graph.nodes[id];
        if node.block != key(FX_STRUCT) {
            return Ok(false);
        }
        let fx_at = field_of(self.read, id, &FX_NAME)?;
        let pointer = word64(node, fx_at).ok_or_else(|| Error::broken(said::OUTSIDE_POINTER))?;
        let fx = self.read.string_at(pointer).unwrap_or_default();
        Ok(starts_with_ignore_case(&fx, prefix))
    }

    /// Убирает из списков архетипов частицы, чей эффект начинается с префикса.
    fn strip(&mut self, prefix: &str) -> Result<()> {
        for index in 0..self.owners.len() {
            let verdicts = self.owners[index]
                .list
                .iter()
                .map(|&id| self.is_doomed(id, prefix).map(|doomed| (id, doomed)))
                .collect::<Result<Vec<_>>>()?;
            let owner = &mut self.owners[index];
            owner.dirty = verdicts.iter().any(|&(_, doomed)| doomed);
            owner.list = verdicts
                .into_iter()
                .filter_map(|(id, doomed)| (!doomed).then_some(id))
                .collect();
        }
        Ok(())
    }

    /// Строковое поле узла `id`: указатель в байтах заменяется ссылкой на узел строки.
    fn relink_string(&mut self, id: NodeId, base: usize, entry: &Entry) -> Result<()> {
        let at = usize::try_from(entry.offset).ok().and_then(|inside| base.checked_add(inside)).unwrap_or(usize::MAX);
        let pointer =
            word64(&self.graph.nodes[id], at).ok_or_else(|| Error::broken(said::OUTSIDE_POINTER))?;
        if pointer == 0 {
            return Ok(());
        }
        let text = self
            .read
            .string_at(pointer)
            .ok_or_else(|| Error::broken("Строка по указателю не читается."))?;
        let target = self.intern(&text);
        let node = &mut self.graph.nodes[id];
        node.bytes[at..at + 8].fill(0);
        node.links.push(Link { at, target: Some(target) });
        Ok(())
    }

    /// Все строковые указатели узлов исходного графа становятся ссылками: старая таблица строк
    /// после пересборки файла не сохраняется, в файл попадают только строки со ссылками.
    fn relink_strings(&mut self) -> Result<()> {
        let read = self.read;
        for id in 0..read.graph.nodes.len() {
            let block = self.graph.nodes[id].block;
            if matches!(block, STRING_BLOCK | POINTER_BLOCK) {
                continue;
            }
            let Some(def) = read.schema.struct_named(block) else {
                continue;
            };
            // Узел массива структур держит все элементы подряд: строки есть у каждого.
            let size = usize::try_from(def.size).unwrap_or(0);
            let elements = if size == 0 { 1 } else { (self.graph.nodes[id].bytes.len() / size).max(1) };
            for element in 0..elements {
                self.relink_struct(id, def, element * size, 0)?;
            }
        }
        Ok(())
    }

    /// Строковые поля структуры с началом `base` в узле `id`, в том числе во вложенных структурах.
    fn relink_struct(&mut self, id: NodeId, def: &StructDef, base: usize, depth: usize) -> Result<()> {
        for entry in &def.entries {
            match entry.dtype {
                STR_PTR => self.relink_string(id, base, entry)?,
                NESTED if entry.name != meta_graph::ARRAYINFO && depth < NESTING_LIMIT => {
                    let Some(inner) = self.read.schema.struct_ref(entry.ref_key) else { continue };
                    let inside = usize::try_from(entry.offset).unwrap_or(usize::MAX);
                    self.relink_struct(id, inner, base.saturating_add(inside), depth + 1)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Добавляет частицы по запросам; возвращает число добавленных и имена не найденных архетипов.
    fn add(&mut self, def: &StructDef, requests: &[Vetted<'_>]) -> Result<(usize, Vec<String>)> {
        // При повторе имени побеждает последний архетип файла.
        let by_hash: HashMap<u32, usize> = self
            .owners
            .iter()
            .enumerate()
            .map(|(index, owner)| (owner.hash, index))
            .collect();
        let mut added = 0;
        let mut missing = Vec::new();
        for vetted in requests {
            let Some(&index) = by_hash.get(&key(&vetted.archetype)) else {
                missing.push(vetted.archetype.clone());
                continue;
            };
            let fx = self.intern(&vetted.fx);
            let offsets = particle_offsets(def)?;
            let request = vetted.request;
            for point in &request.points {
                let node = particle_node(
                    def,
                    offsets,
                    key(&vetted.archetype),
                    request.probability,
                    point,
                    fx,
                )?;
                let id = self.graph.push(node);
                self.owners[index].list.push(id);
            }
            self.owners[index].dirty = true;
            added += request.points.len();
        }
        Ok((added, missing))
    }

    /// Пересобирает массив расширений изменённого архетипа и его счётчики.
    fn rewrite_extensions(&mut self, index: usize) -> Result<()> {
        let Owner { node, slot, ref list, .. } = self.owners[index];
        let total = u16::try_from(list.len()).map_err(|_| Error::argument("Слишком много расширений."))?;
        let holder = &mut self.graph.nodes[node];
        holder.links.retain(|link| link.at != slot);
        for delta in [8, 10] {
            store(
                &mut holder.bytes,
                slot.saturating_add(delta),
                &total.to_le_bytes(),
                said::OUTSIDE_COUNTER,
            )?;
        }
        if !list.is_empty() {
            let array = pointer_array(&mut self.graph, list);
            self.graph.nodes[node].links.push(Link { at: slot, target: Some(array) });
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<u8>> {
        for index in 0..self.owners.len() {
            if self.owners[index].dirty {
                self.rewrite_extensions(index)?;
            }
        }
        meta_graph::write(&self.read.schema, &self.graph)
    }
}

/// Итог: новый файл, число архетипов в нём, число добавленных частиц и незнакомые архетипы запросов.
#[derive(Debug, Clone, PartialEq)]
pub struct Patched {
    pub bytes: Vec<u8>,
    pub archetypes: usize,
    pub added: usize,
    pub missing: Vec<String>,
}

/// Снимает со всех архетипов `.ytyp` частицы с префиксом и добавляет частицы по запросам.
pub fn patch(input: &[u8], prefix: &str, requests: &[Request]) -> Result<Patched> {
    let (prefix, vetted) = vet(prefix, requests)?;
    let read = meta_graph::read(input)?;
    let mut session = Session::open(&read)?;
    session.strip(&prefix)?;
    session.relink_strings()?;

    let particle = read
        .schema
        .struct_named(key(FX_STRUCT))
        .ok_or_else(|| Error::argument("В схеме нет частицы."))?;
    let (added, missing) = session.add(particle, &vetted)?;
    let archetypes = session.owners.len();
    Ok(Patched { bytes: session.finish()?, archetypes, added, missing })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use crate::meta_graph::{Schema, ARRAYINFO};

    const T_PTR: u8 = 0x07;
    const T_ARRAY: u8 = 0x52;
    const T_HASH: u8 = 0x4a;
    const T_U32: u8 = 0x15;
    const T_F32: u8 = 0x21;
    const T_VEC3: u8 = 0x33;

    const BASE: &str = "CBaseArchetypeDef";
    const TIMED: &str = "CTimeArchetypeDef";
    const LIGHT: &str = "CExtensionDefLightEffect";

    fn entry(name: &str, offset: i32, dtype: u8) -> Entry {
        Entry { name: key(name), offset, dtype, unk9: 0, ref_index: -1, ref_key: 0 }
    }

    fn info(dtype: u8, ref_key: &str) -> Entry {
        Entry { name: ARRAYINFO, offset: 0, dtype, unk9: 0, ref_index: -1, ref_key: key(ref_key) }
    }

    fn sdef(name: &str, size: u32, entries: Vec<Entry>) -> StructDef {
        StructDef { name: key(name), key: key(&format!("{name}#key")), unk8: 0, size, entries }
    }

    /// Схема файла типов из описания: пять структур со своими смещениями.
    fn schema() -> Schema {
        let root = sdef(
            "CMapTypes",
            80,
            vec![info(T_PTR, BASE), entry("archetypes", 24, T_ARRAY), entry("name", 40, T_HASH)],
        );
        let base = sdef(
            BASE,
            144,
            vec![
                entry("name", 8, T_HASH),
                entry("comment", 16, STR_PTR),
                info(T_PTR, "CExtensionDef"),
                entry("extensions", 120, T_ARRAY),
            ],
        );
        let timed = sdef(
            TIMED,
            176,
            vec![
                entry("comment", 24, STR_PTR),
                entry("name", 8, T_HASH),
                info(T_PTR, "CExtensionDef"),
                entry("extensions", 136, T_ARRAY),
            ],
        );
        let particle = sdef(
            FX_STRUCT,
            96,
            vec![
                entry("name", 8, T_HASH),
                entry("offsetPosition", 16, T_VEC3),
                entry("offsetRotation", 32, 0x34),
                entry("boneTag", 48, T_U32),
                entry("scale", 52, T_F32),
                entry("probability", 56, T_U32),
                entry("color", 76, T_U32),
                entry("fxName", 80, STR_PTR),
            ],
        );
        let light = sdef(LIGHT, 48, vec![entry("name", 8, T_HASH), entry("desc", 24, STR_PTR)]);
        Schema { structs: vec![root, base, timed, light, particle], enums: vec![] }
    }

    enum Ext {
        Particle(&'static str, [f32; 3], u32, u32),
        Light(Option<&'static str>),
    }

    fn put(bytes: &mut [u8], at: usize, raw: &[u8]) {
        bytes[at..at + raw.len()].copy_from_slice(raw);
    }

    fn text_node(graph: &mut Graph, text: &str) -> NodeId {
        graph.push(Node { block: STRING_BLOCK, bytes: [text.as_bytes(), &[0]].concat(), links: vec![] })
    }

    /// Файл типов: (имя, временной ли, комментарий, расширения).
    fn build(archs: &[(&str, bool, Option<&str>, Vec<Ext>)]) -> Vec<u8> {
        let schema = schema();
        let mut g = Graph::default();
        let mut root_bytes = vec![0u8; 80];
        put(&mut root_bytes, 32, &(archs.len() as u16).to_le_bytes());
        put(&mut root_bytes, 34, &(archs.len() as u16).to_le_bytes());
        put(&mut root_bytes, 40, &key("test_types").to_le_bytes());
        let root = g.push(Node { block: key("CMapTypes"), bytes: root_bytes, links: vec![] });
        let mut ids = vec![];
        for (name, timed, comment, exts) in archs {
            let (size, comment_at, ext_at, block) = if *timed { (176, 24, 136, key(TIMED)) } else { (144, 16, 120, key(BASE)) };
            let mut bytes = vec![0u8; size];
            put(&mut bytes, 8, &key(name).to_le_bytes());
            let id = g.push(Node { block, bytes, links: vec![] });
            if let Some(text) = comment {
                let s = text_node(&mut g, text);
                g.nodes[id].links.push(Link { at: comment_at, target: Some(s) });
            }
            if !exts.is_empty() {
                let mut elements = vec![];
                for ext in exts {
                    let (block, b, fx_at, text) = match ext {
                        Ext::Particle(fx, pos, bone, prob) => {
                            let mut b = vec![0u8; 96];
                            put(&mut b, 8, &key(name).to_le_bytes());
                            for (i, v) in pos.iter().enumerate() {
                                put(&mut b, 16 + i * 4, &v.to_le_bytes());
                            }
                            put(&mut b, 44, &1.0f32.to_le_bytes());
                            put(&mut b, 48, &bone.to_le_bytes());
                            put(&mut b, 52, &1.0f32.to_le_bytes());
                            put(&mut b, 56, &prob.to_le_bytes());
                            put(&mut b, 76, &u32::MAX.to_le_bytes());
                            (key(FX_STRUCT), b, 80, Some(*fx))
                        }
                        Ext::Light(desc) => {
                            let mut b = vec![0u8; 48];
                            put(&mut b, 8, &key(name).to_le_bytes());
                            (key(LIGHT), b, 24, *desc)
                        }
                    };
                    let element = g.push(Node { block, bytes: b, links: vec![] });
                    if let Some(text) = text {
                        let s = text_node(&mut g, text);
                        g.nodes[element].links.push(Link { at: fx_at, target: Some(s) });
                    }
                    elements.push(element);
                }
                let n = elements.len();
                let array = pointer_array(&mut g, &elements);
                put(&mut g.nodes[id].bytes, ext_at + 8, &(n as u16).to_le_bytes());
                put(&mut g.nodes[id].bytes, ext_at + 10, &(n as u16).to_le_bytes());
                g.nodes[id].links.push(Link { at: ext_at, target: Some(array) });
            }
            ids.push(id);
        }
        let array = pointer_array(&mut g, &ids);
        g.nodes[root].links.push(Link { at: 24, target: Some(array) });
        let names: Vec<u32> = schema.structs.iter().map(|s| s.name).collect();
        meta_graph::write_with_structs(&schema, &g, Some(&names)).unwrap()
    }

    fn fixture() -> Vec<u8> {
        build(&[
            (
                "prop_a",
                false,
                Some("note A"),
                vec![
                    Ext::Light(Some("light desc")),
                    Ext::Particle("astral_lamp_x", [1.0, 2.0, 3.0], 11, 70),
                    Ext::Particle("other_fx", [4.0, 5.0, 6.0], 12, 80),
                    Ext::Particle("Astral_Lamp_Y", [7.0, 8.0, 9.0], 13, 90),
                ],
            ),
            ("prop_b", false, None, vec![]),
            ("prop_c", true, Some("note C"), vec![Ext::Particle("astral_lamp_z", [0.5, 0.25, 0.125], 29567, 100), Ext::Light(None)]),
        ])
    }

    fn good() -> Request {
        Request {
            archetype: "prop_b".into(),
            fx_name: "astral_lamp_new".into(),
            probability: 70,
            points: vec![Point { x: 1.9, y: 0.0, z: 9.1, bone: 29567 }],
        }
    }

    /// Расширения каждого архетипа результата: (хеш архетипа, [(блок, эффект или описание)]).
    fn extensions_of(bytes: &[u8]) -> Vec<(u32, Vec<(u32, Option<String>)>)> {
        let read = meta_graph::read(bytes).unwrap();
        let owners = collect_owners(&read).unwrap();
        owners
            .iter()
            .map(|a| {
                let items = a
                    .list
                    .iter()
                    .map(|&id| {
                        let node = &read.graph.nodes[id];
                        let at = if node.block == key(FX_STRUCT) { 80 } else { 24 };
                        (node.block, read.string_at(word64(node, at).unwrap()))
                    })
                    .collect();
                (a.hash, items)
            })
            .collect()
    }

    #[test]
    fn request_rules_match_the_host() {
        let prefix = "astral_lamp_";
        let accepted = |request: Request| {
            matches!(patch(b"junk", prefix, &[request]), Err(ref e) if e.kind == Kind::Broken)
        };
        let mut request = good();
        request.archetype = "prop_streetlight_01".into();
        request.fx_name = "astral_lamp_fx".into();
        assert!(accepted(request.clone()));

        let mut far = request.clone();
        far.points[0].x = 65.0;
        assert!(!accepted(far));
        let mut foreign = request.clone();
        foreign.fx_name = "other_fx".into();
        assert!(!accepted(foreign));
        let mut silent = request;
        silent.probability = 0;
        assert!(!accepted(silent));
    }

    #[test]
    fn request_texts_are_normalised_and_checked_in_order() {
        let reason = |prefix: &str, request: Request| patch(b"junk", prefix, &[request]).unwrap_err().message;
        let mut r = good();
        assert_eq!(reason("abc", r.clone()), "Префикс частиц не годится.");
        assert_eq!(reason("ab\u{a0}cd", r.clone()), "Префикс частиц не годится.");
        assert_eq!(reason("\u{a0}astral_lamp_\u{a0}", r.clone()), "Ресурс короче заголовка RSC7.");
        r.archetype = "Prop-A".into();
        r.fx_name = "nofx".into();
        r.probability = 0;
        assert_eq!(reason("astral_lamp_", r.clone()), "Имя архетипа не годится.");
        r.archetype = " PROP_A\u{a0}".into();
        assert_eq!(reason("astral_lamp_", r.clone()), "Эффект без префикса.");
        r.fx_name = "ASTRAL_LAMP_A".into();
        assert_eq!(reason("astral_lamp_", r.clone()), "Точки или вероятность вне пределов.");
        r.probability = 50;
        r.points[0].z = f32::NAN;
        assert_eq!(reason("astral_lamp_", r.clone()), "Точка частицы вне модели или кость вне диапазона.");
        r.points[0] = Point { x: 64.0, y: -64.0, z: -0.0, bone: 65535 };
        assert_eq!(reason("astral_lamp_", r.clone()), "Ресурс короче заголовка RSC7.");
        r.points[0].bone = 65536;
        assert_eq!(reason("astral_lamp_", r), "Точка частицы вне модели или кость вне диапазона.");
    }

    #[test]
    fn fixture_is_the_documented_file() {
        let file = fixture();
        assert_eq!(file.len(), 623);
        assert_eq!(
            sha256_hex(&file),
            "37e82bf49703c1b22cf8d4e16ad61731143ccb7c8d3ae8fedff5b0bd313c855f"
        );
    }

    #[test]
    fn removal_drops_only_particles_with_the_prefix() {
        let patched = patch(&fixture(), "astral_lamp_", &[]).unwrap();
        assert_eq!((patched.archetypes, patched.added), (3, 0));
        assert!(patched.missing.is_empty());
        assert_eq!(patched.bytes.len(), 527);
        assert_eq!(
            sha256_hex(&patched.bytes),
            "daaadc56d95bfdd26763c85eb0ddb27775184a54071717346c42653f7b2837ae"
        );
        let read = meta_graph::read(&patched.bytes).unwrap();
        assert_eq!(read.strings(), ["note A", "light desc", "other_fx", "note C"]);
        // Регистр префикса не важен.
        assert_eq!(patch(&fixture(), "ASTRAL_", &[]).unwrap().bytes, patched.bytes);
        // Пробелы по краям обрезаются, снимается одна частица.
        let one = patch(&fixture(), "  astral_lamp_x  ", &[]).unwrap();
        assert_eq!(one.bytes.len(), 598);
    }

    #[test]
    fn a_rebuilt_file_differs_from_the_input_even_when_nothing_is_removed() {
        let patched = patch(&fixture(), "zzzz_", &[]).unwrap();
        assert_eq!(patched.bytes.len(), 620);
        assert_eq!(
            sha256_hex(&patched.bytes),
            "6af5a07bf77bbfd5f63ab70bd7455898de8633807c1361623d4078f4fb806d4e"
        );
    }

    #[test]
    fn a_request_adds_one_particle_per_point() {
        let patched = patch(&fixture(), "astral_lamp_", &[good()]).unwrap();
        assert_eq!((patched.archetypes, patched.added), (3, 1));
        assert_eq!(patched.bytes.len(), 578);
        assert_eq!(
            sha256_hex(&patched.bytes),
            "6bfbc8b9223d0f3687c45f5f5861655dbf0a819ec2c56d030acd8f4cfa8a192c"
        );
        let read = meta_graph::read(&patched.bytes).unwrap();
        let added = read
            .graph
            .nodes
            .iter()
            .find(|n| n.block == key(FX_STRUCT) && word32(n, 8) == Some(key("prop_b")))
            .unwrap();
        let mut expected = vec![0u8; 96];
        put(&mut expected, 8, &key("prop_b").to_le_bytes());
        put(&mut expected, 16, &1.9f32.to_le_bytes());
        put(&mut expected, 24, &9.1f32.to_le_bytes());
        put(&mut expected, 44, &1.0f32.to_le_bytes());
        put(&mut expected, 48, &29567u32.to_le_bytes());
        put(&mut expected, 52, &1.0f32.to_le_bytes());
        put(&mut expected, 56, &70u32.to_le_bytes());
        put(&mut expected, 76, &u32::MAX.to_le_bytes());
        // Указатель на строку эффекта: блок 2 (номер с единицы), смещение 27.
        put(&mut expected, 80, &(2u64 | (27 << 12)).to_le_bytes());
        assert_eq!(added.bytes, expected);
        let blocks = extensions_of(&patched.bytes);
        assert_eq!(blocks[1].1.len(), 1);
        assert_eq!(blocks[1].1[0].1.as_deref(), Some("astral_lamp_new"));
        assert_eq!(blocks[0].1.len(), 2);
    }

    #[test]
    fn requests_use_the_last_archetype_with_that_hash_and_report_missing_ones() {
        let mut one = good();
        one.archetype = " PROP_A ".into();
        one.fx_name = " ASTRAL_Lamp_NEW ".into();
        let mut ghost = good();
        ghost.archetype = " Missing_One".into();
        let patched = patch(&fixture(), "astral_lamp_", &[one, ghost]).unwrap();
        assert_eq!(patched.added, 1);
        assert_eq!(patched.missing, ["missing_one"]);
        let blocks = extensions_of(&patched.bytes);
        let names: Vec<_> = blocks[0].1.iter().map(|(_, text)| text.clone()).collect();
        assert_eq!(names, [Some("light desc".to_string()), Some("other_fx".to_string()), Some("astral_lamp_new".to_string())]);
    }

    #[test]
    fn an_archetype_loses_its_array_when_nothing_is_left() {
        let patched = patch(&fixture(), "astral_lamp_z", &[]).unwrap();
        // У `prop_c` остался свет; у `prop_a` частицы целы.
        let blocks = extensions_of(&patched.bytes);
        assert_eq!(blocks[2].1.len(), 1);
        assert_eq!(blocks[0].1.len(), 4);
        let lone = build(&[("prop_a", false, None, vec![Ext::Particle("astral_lamp_k", [0.0; 3], 1, 10)])]);
        let patched = patch(&lone, "astral_lamp_", &[]).unwrap();
        assert!(extensions_of(&patched.bytes)[0].1.is_empty());
    }

    #[test]
    fn schema_without_a_particle_struct_is_refused_after_the_strings_are_read() {
        let mut broken = schema();
        broken.structs.retain(|s| s.name != key(FX_STRUCT));
        let mut g = Graph::default();
        g.push(Node { block: key("CMapTypes"), bytes: vec![0; 80], links: vec![] });
        let names: Vec<u32> = broken.structs.iter().map(|s| s.name).collect();
        let file = meta_graph::write_with_structs(&broken, &g, Some(&names)).unwrap();
        let error = patch(&file, "astral_lamp_", &[]).unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (Kind::Argument, "В схеме нет частицы."));
    }

    #[test]
    fn root_without_archetypes_field_is_refused() {
        let toy = Schema { structs: vec![sdef("Root", 8, vec![])], enums: vec![] };
        let g = Graph { nodes: vec![Node { block: key("Root"), bytes: vec![0; 8], links: vec![] }], root: 0 };
        let file = meta_graph::write(&toy, &g).unwrap();
        let error = patch(&file, "astral_lamp_", &[good()]).unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (Kind::Broken, "В корне нет архетипов."));
    }

    const TAG: &str = "CTagDef";
    const INNER: &str = "CTagInner";
    const T_STRUCTURE: u8 = 0x05;

    /// Файл типов с одним архетипом и встроенным массивом из трёх структур: у каждой своя строка и вложенная структура со строкой.
    fn tagged_file(labels: [&str; 3], notes: [&str; 3]) -> Vec<u8> {
        let mut schema = schema();
        let root_def = schema.structs.iter_mut().find(|s| s.name == key("CMapTypes")).unwrap();
        root_def.entries.push(info(T_STRUCTURE, TAG));
        root_def.entries.push(entry("tags", 48, T_ARRAY));
        let inner = Entry { name: key("inner"), offset: 24, dtype: T_STRUCTURE, unk9: 0, ref_index: -1, ref_key: key(INNER) };
        schema.structs.push(sdef(TAG, 32, vec![entry("name", 8, T_HASH), entry("label", 16, STR_PTR), inner]));
        schema.structs.push(sdef(INNER, 8, vec![entry("note", 0, STR_PTR)]));

        let mut g = Graph::default();
        let mut root_bytes = vec![0u8; 80];
        put(&mut root_bytes, 32, &1u16.to_le_bytes());
        put(&mut root_bytes, 34, &1u16.to_le_bytes());
        put(&mut root_bytes, 40, &key("test_types").to_le_bytes());
        put(&mut root_bytes, 56, &3u16.to_le_bytes());
        put(&mut root_bytes, 58, &3u16.to_le_bytes());
        let root = g.push(Node { block: key("CMapTypes"), bytes: root_bytes, links: vec![] });
        let mut archetype = vec![0u8; 144];
        put(&mut archetype, 8, &key("prop_t").to_le_bytes());
        let archetype = g.push(Node { block: key(BASE), bytes: archetype, links: vec![] });
        let list = pointer_array(&mut g, &[archetype]);
        let tags = g.push(Node { block: key(TAG), bytes: vec![0; 96], links: vec![] });
        for i in 0..3 {
            let label = text_node(&mut g, labels[i]);
            let note = text_node(&mut g, notes[i]);
            g.nodes[tags].links.push(Link { at: i * 32 + 16, target: Some(label) });
            g.nodes[tags].links.push(Link { at: i * 32 + 24, target: Some(note) });
        }
        g.nodes[root].links.push(Link { at: 24, target: Some(list) });
        g.nodes[root].links.push(Link { at: 48, target: Some(tags) });
        let names: Vec<u32> = schema.structs.iter().map(|s| s.name).collect();
        meta_graph::write_with_structs(&schema, &g, Some(&names)).unwrap()
    }

    #[test]
    fn strings_in_every_element_of_an_inline_array_and_in_nested_structs_survive_a_patch() {
        let labels = ["first label", "second label", "third label"];
        let notes = ["note one", "note two", "note three"];
        let source = tagged_file(labels, notes);
        let patched = patch(&source, "astral_lamp_", &[good()]).unwrap();
        let read = meta_graph::read(&patched.bytes).unwrap();
        let tags = read.graph.nodes.iter().find(|n| n.block == key(TAG)).expect("массив тегов остался");
        assert_eq!(tags.bytes.len(), 96);
        let text_at = |at: usize| read.string_at(word64(tags, at).unwrap());
        for i in 0..3 {
            assert_eq!(text_at(i * 32 + 16).as_deref(), Some(labels[i]), "метка {i}");
            assert_eq!(text_at(i * 32 + 24).as_deref(), Some(notes[i]), "вложенная строка {i}");
        }
    }
}
