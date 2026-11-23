//! Метаданные RAGE (`.ymap`, `.ytyp`), которые `meta_graph` уже разложил в граф узлов: заголовок и сущности карты,
//! огни, опись заголовка, словарь типов с помещениями (MLO) и одна запись — `add_models`.
//!
//! Поля ищутся по хешу имени в схеме самого файла, а не по фиксированным смещениям. Недобор данных (счётчик
//! больше узла, слот без ссылки) молча укорачивает список; ошибка бывает, только когда скалярное поле выходит
//! за байты узла или в схеме нет нужной записи.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::HashSet;

use crate::error::{Error, Result};
use crate::hash::{joaat, joaat_case};
use crate::meta_graph::{self, Entry, Graph, Link, Node, NodeId, Read, StructDef};
use crate::meta_graph::{ARRAYINFO, POINTER_BLOCK, T_ARRAY, T_STRUCTURE};

// ---------------------------------------------------------------------------------------------------------------
// Тексты отказов
// ---------------------------------------------------------------------------------------------------------------

const OUTSIDE_NODE: &str = "Поле вне узла метаданных.";
const OUTSIDE_GRAPH: &str = "Узел метаданных вне графа.";
const UNKNOWN_BLOCK: &str = "Тип узла метаданных не описан в файле.";
const NO_ELEMENT_INFO: &str = "Массив без описания элементов.";
const UNKNOWN_ELEMENT: &str = "Элемент массива не описан в файле.";
const NO_INSTANCED: &str = "Карта без instancedData.";
const NO_INTERIOR: &str = "В словаре нет нужного помещения.";
const ONLY_LIMBO: &str = "В помещении нет комнат, кроме нулевой.";
const NO_BASE_DEF: &str = "Нет описания CBaseArchetypeDef.";
const NO_ENTITY_DEF: &str = "Нет описания CEntityDef.";
const LIST_WITHOUT_ARRAY: &str = "Список помещения без массива: такой файл пока не поддерживается.";
const NO_SAMPLE_LIST: &str = "У комнаты нет списка сущностей-образца для записи.";
const WRITE_OUTSIDE: &str = "Поле вне узла при записи помещения.";
const LIST_COUNTER: &str = "Счётчик списка вне узла.";
const ROOM_COUNTER: &str = "Счётчик комнаты вне узла.";

fn refuse(text: &str) -> Error {
    Error::broken(text)
}

fn no_field(name: &str) -> Error {
    Error::broken(format!("В метаданных нет поля {name}."))
}

// ---------------------------------------------------------------------------------------------------------------
// Вид на узел: структура, начало элемента, поиск полей и чтение значений
// ---------------------------------------------------------------------------------------------------------------

/// Где нашлось поле: структура-хозяин, номер записи в ней и место в байтах узла.
struct Slot<'a> {
    owner: &'a StructDef,
    index: usize,
    pos: usize,
}

/// Поле-массив: заявленное число элементов и узел, на который ведёт ссылка (если ведёт).
struct ArrayHead {
    count: usize,
    target: Option<NodeId>,
}

/// Список указателей в том виде, в каком его правит `add_models`.
struct Pointers {
    owner: NodeId,
    at: usize,
    members: Vec<NodeId>,
    backed: bool,
}

/// Узел графа вместе с описанием его структуры; `origin` — начало элемента внутри узла (у элемента массива
/// структур оно не нулевое, смещения полей отсчитываются от него).
#[derive(Clone, Copy)]
struct View<'a> {
    read: &'a Read,
    id: NodeId,
    node: &'a Node,
    def: &'a StructDef,
    origin: usize,
}

/// Правила поиска: прямое поле побеждает одноимённое во вложенной структуре; поля-структуры по имени не ищутся.
fn resolve<'a>(read: &'a Read, def: &'a StructDef, origin: usize, name: u32) -> Option<Slot<'a>> {
    let plain = |e: &Entry| e.name == name && e.name != ARRAYINFO && e.dtype != T_STRUCTURE;
    let within = |e: &Entry| e.dtype == T_STRUCTURE && e.name != ARRAYINFO;
    def.entries
        .iter()
        .position(plain)
        .map(|index| Slot { owner: def, index, pos: origin + def.entries[index].offset as usize })
        .or_else(|| {
            def.entries.iter().filter(|e| within(e)).find_map(|e| {
                let inner = read.schema.struct_ref(e.ref_key)?;
                resolve(read, inner, origin + e.offset as usize, name)
            })
        })
}

/// Четыре байта с позиции `at` как слово (длина куска проверена вызывающим).
fn word_of(chunk: &[u8], at: usize) -> u32 {
    let quad: [u8; 4] = chunk[at..at + 4].try_into().expect("четыре байта");
    u32::from_le_bytes(quad)
}

fn bits3(chunk: &[u8]) -> [f32; 3] {
    std::array::from_fn(|i| f32::from_bits(word_of(chunk, 4 * i)))
}

impl<'a> View<'a> {
    fn open(read: &'a Read, id: NodeId) -> Result<Self> {
        let node = read.graph.nodes.get(id).ok_or_else(|| refuse(OUTSIDE_GRAPH))?;
        let def = read.schema.struct_named(node.block).ok_or_else(|| refuse(UNKNOWN_BLOCK))?;
        Ok(View { read, id, node, def, origin: 0 })
    }

    fn root(read: &'a Read) -> Result<Self> {
        Self::open(read, read.graph.root)
    }

    fn node_by(&self, id: NodeId) -> Result<&'a Node> {
        self.read.graph.nodes.get(id).ok_or_else(|| refuse(OUTSIDE_GRAPH))
    }

    fn locate(&self, name: &str) -> Result<Slot<'a>> {
        resolve(self.read, self.def, self.origin, joaat_case(name)).ok_or_else(|| no_field(name))
    }

    /// Вложенная структура по имени записи (тип «структура»); нет записи или её типа — `None`.
    fn substruct(&self, name: &str) -> Option<View<'a>> {
        let hash = joaat_case(name);
        let entry = self.def.entries.iter().find(|e| e.name == hash && e.dtype == T_STRUCTURE)?;
        let def = self.read.schema.struct_ref(entry.ref_key)?;
        Some(View { def, origin: self.origin + entry.offset as usize, ..*self })
    }

    // --- скаляры по позиции

    fn bytes_at(&self, pos: usize, len: usize) -> Result<&'a [u8]> {
        self.node.bytes.get(pos..pos + len).ok_or_else(|| refuse(OUTSIDE_NODE))
    }

    fn word_at(&self, pos: usize) -> Result<u32> {
        self.bytes_at(pos, 4).map(|b| word_of(b, 0))
    }

    fn half_at(&self, pos: usize) -> Result<u16> {
        let pair: [u8; 2] = self.bytes_at(pos, 2)?.try_into().expect("два байта");
        Ok(u16::from_le_bytes(pair))
    }

    fn vec_at<const N: usize>(&self, pos: usize) -> Result<[f32; N]> {
        let chunk = self.bytes_at(pos, 4 * N)?;
        Ok(std::array::from_fn(|i| f32::from_bits(word_of(chunk, 4 * i))))
    }

    // --- скаляры по имени поля

    fn word(&self, name: &str) -> Result<u32> {
        self.word_at(self.locate(name)?.pos)
    }

    fn int(&self, name: &str) -> Result<i32> {
        self.word(name).map(|w| w as i32)
    }

    fn float(&self, name: &str) -> Result<f32> {
        self.word(name).map(f32::from_bits)
    }

    fn vec3(&self, name: &str) -> Result<[f32; 3]> {
        self.vec_at(self.locate(name)?.pos)
    }

    fn vec4(&self, name: &str) -> Result<[f32; 4]> {
        self.vec_at(self.locate(name)?.pos)
    }

    /// Число элементов массива-поля (`u16` через 8 байт от начала поля).
    fn count(&self, name: &str) -> Result<u16> {
        self.half_at(self.locate(name)?.pos + 8)
    }

    /// Строка по 64-битному указателю поля.
    fn text(&self, name: &str) -> Result<Option<String>> {
        let chunk = self.bytes_at(self.locate(name)?.pos, 8)?;
        let pointer = u64::from(word_of(chunk, 0)) | u64::from(word_of(chunk, 4)) << 32;
        Ok(self.read.string_at(pointer))
    }

    /// Ключ структуры узла (читатели записей берут его как «поле» без отказа).
    fn key(&self) -> Result<u32> {
        Ok(self.def.key)
    }

    fn is_instance(&self) -> Result<bool> {
        Ok(self.def.key == MLO_INSTANCE_KEY)
    }

    /// Помещение читается целиком, только если структура узла — помещение.
    fn interior(&self) -> Result<Option<Mlo>> {
        if self.def.key == MLO_ARCHETYPE_KEY {
            Mlo::load(self).map(Some)
        } else {
            Ok(None)
        }
    }

    // --- массивы

    fn array_at(&self, pos: usize) -> Result<ArrayHead> {
        let count = usize::from(self.half_at(pos + 8)?);
        let target = self.node.links.iter().find(|l| l.at == pos).and_then(|l| l.target);
        Ok(ArrayHead { count, target })
    }

    /// Массив указателей: слот определяется смещением ссылки; пустой слот пропускается.
    fn pointers(&self, name: &str) -> Result<Pointers> {
        let slot = self.locate(name)?;
        let head = self.array_at(slot.pos)?;
        let members = match head.target.map(|id| self.node_by(id)).transpose()? {
            None => Vec::new(),
            Some(array) => {
                // при повторе слота верна первая ссылка: обходим с конца, ранняя запись перекроет позднюю
                let by_slot: HashMap<usize, Option<NodeId>> = array.links.iter().rev().map(|l| (l.at, l.target)).collect();
                (0..head.count).filter_map(|s| by_slot.get(&(s * 8)).copied().flatten()).collect()
            }
        };
        Ok(Pointers { owner: self.id, at: slot.pos, members, backed: head.target.is_some() })
    }

    /// Массив структур: описание элемента стоит в схеме прямо перед полем.
    fn elements(&self, name: &str) -> Result<Vec<View<'a>>> {
        let slot = self.locate(name)?;
        let head = self.array_at(slot.pos)?;
        let Some(target) = head.target else {
            return Ok(Vec::new());
        };
        let is_array = slot.owner.entries[slot.index].dtype == T_ARRAY;
        let info = slot
            .index
            .checked_sub(1)
            .map(|i| &slot.owner.entries[i])
            .filter(|e| is_array && e.name == ARRAYINFO)
            .ok_or_else(|| refuse(NO_ELEMENT_INFO))?;
        let def = self.read.schema.struct_ref(info.ref_key).ok_or_else(|| refuse(UNKNOWN_ELEMENT))?;
        let array = self.node_by(target)?;
        let size = def.size as usize;
        let whole = array.bytes.len().checked_div(size).map_or(0, |n| n.min(head.count));
        Ok((0..whole).map(|k| View { id: target, node: array, def, origin: k * size, ..*self }).collect())
    }

    /// Каждый элемент массива структур, прочитанный `load`.
    fn rows<T>(&self, name: &str, load: fn(&View<'a>) -> Result<T>) -> Result<Vec<T>> {
        self.elements(name)?.iter().map(load).collect()
    }

    /// Каждая сущность массива указателей, прочитанная `load`.
    fn members<T>(&self, name: &str, load: fn(&View<'a>) -> Result<T>) -> Result<Vec<T>> {
        self.pointers(name)?
            .members
            .into_iter()
            .map(|id| View::open(self.read, id).and_then(|v| load(&v)))
            .collect()
    }

    /// Целые куски скалярного массива; недобор укорачивает список.
    fn chunks(&self, name: &str, width: usize) -> Result<Vec<&'a [u8]>> {
        let head = self.array_at(self.locate(name)?.pos)?;
        let data: &'a [u8] = match head.target {
            Some(id) => &self.node_by(id)?.bytes,
            None => &[],
        };
        Ok(data.chunks_exact(width).take(head.count).collect())
    }

    fn words(&self, name: &str) -> Result<Vec<u32>> {
        Ok(self.chunks(name, 4)?.into_iter().map(|c| word_of(c, 0)).collect())
    }

    fn floats(&self, name: &str) -> Result<Vec<f32>> {
        Ok(self.chunks(name, 4)?.into_iter().map(|c| f32::from_bits(word_of(c, 0))).collect())
    }

    fn octets(&self, name: &str) -> Result<Vec<u8>> {
        Ok(self.chunks(name, 1)?.into_iter().map(|c| c[0]).collect())
    }

    /// Точки по `stride` байт на точку (читаются первые 12).
    fn points(&self, name: &str, stride: usize) -> Result<Vec<[f32; 3]>> {
        Ok(self.chunks(name, stride)?.into_iter().map(bits3).collect())
    }
}

/// Читатель записи: поля перечислены в порядке чтения (от него зависит, какая ошибка победит); у каждого —
/// метод вида `View` и его аргументы.
macro_rules! loader {
    ($record:ident from $view:ident { $($field:ident <- $read:ident($($arg:expr),*);)+ }) => {
        impl $record {
            fn load($view: &View<'_>) -> Result<Self> {
                Ok($record { $($field: $view.$read($($arg),*)?),+ })
            }
        }
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Карта: заголовок и сущности
// ---------------------------------------------------------------------------------------------------------------

/// Ключ структуры входа в помещение на карте.
pub const MLO_INSTANCE_KEY: u32 = 2_151_576_752;

#[derive(PartialEq, Clone, Debug)]
pub struct CEntity {
    pub is_mlo: bool,
    pub archetype_hash: u32,
    pub flags: u32,
    pub guid: u32,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub scale_xy: f32,
    pub scale_z: f32,
    pub parent_index: i32,
    pub lod_dist: f32,
    pub child_lod_dist: f32,
    pub num_children: u32,
    pub lod_level: i32,
    pub priority_level: i32,
    pub tint_value: u32,
}

loader!(CEntity from v {
    is_mlo <- is_instance();
    archetype_hash <- word("archetypeName");
    flags <- word("flags");
    guid <- word("guid");
    position <- vec3("position");
    rotation <- vec4("rotation");
    scale_xy <- float("scaleXY");
    scale_z <- float("scaleZ");
    parent_index <- int("parentIndex");
    lod_dist <- float("lodDist");
    child_lod_dist <- float("childLodDist");
    num_children <- word("numChildren");
    lod_level <- int("lodLevel");
    priority_level <- int("priorityLevel");
    tint_value <- word("tintValue");
});

#[derive(PartialEq, Clone, Debug)]
pub struct Ymap {
    pub name_hash: u32,
    pub parent_hash: u32,
    pub flags: u32,
    pub content_flags: u32,
    pub streaming_min: [f32; 3],
    pub streaming_max: [f32; 3],
    pub entities_min: [f32; 3],
    pub entities_max: [f32; 3],
    pub entities: Vec<CEntity>,
}

// сущности читаются раньше заголовка
loader!(Ymap from root {
    entities <- members("entities", CEntity::load);
    name_hash <- word("name");
    parent_hash <- word("parent");
    flags <- word("flags");
    content_flags <- word("contentFlags");
    streaming_min <- vec3("streamingExtentsMin");
    streaming_max <- vec3("streamingExtentsMax");
    entities_min <- vec3("entitiesExtentsMin");
    entities_max <- vec3("entitiesExtentsMax");
});

pub fn read_ymap(read: &Read) -> Result<Ymap> {
    View::root(read).and_then(|root| Ymap::load(&root))
}

// ---------------------------------------------------------------------------------------------------------------
// Огни
// ---------------------------------------------------------------------------------------------------------------

#[derive(Default, PartialEq, Clone, Debug)]
pub struct DistantLights {
    pub positions: Vec<[f32; 3]>,
    pub colours: Vec<u32>,
}

loader!(DistantLights from soa {
    positions <- points("position", 12);
    colours <- words("RGBI");
});

/// Дальние огни: нет структуры или у неё пустой `position` — пустой набор, и тогда `RGBI` не читается.
pub fn read_distant_lights(read: &Read) -> Result<DistantLights> {
    let Some(soa) = View::root(read)?.substruct("DistantLODLightsSOA") else {
        return Ok(DistantLights::default());
    };
    match soa.count("position")? {
        0 => Ok(DistantLights::default()),
        _ => DistantLights::load(&soa),
    }
}

#[derive(Default, PartialEq, Clone, Debug)]
pub struct LodLights {
    pub direction: Vec<[f32; 3]>,
    pub falloff: Vec<f32>,
    pub falloff_exponent: Vec<f32>,
    pub time_and_state_flags: Vec<u32>,
    pub hash: Vec<u32>,
    pub cone_inner_angle: Vec<u8>,
    pub cone_outer_angle_or_cap_ext: Vec<u8>,
    pub corona_intensity: Vec<u8>,
}

loader!(LodLights from soa {
    direction <- points("direction", 12);
    falloff <- floats("falloff");
    falloff_exponent <- floats("falloffExponent");
    time_and_state_flags <- words("timeAndStateFlags");
    hash <- words("hash");
    cone_inner_angle <- octets("coneInnerAngle");
    cone_outer_angle_or_cap_ext <- octets("coneOuterAngleOrCapExt");
    corona_intensity <- octets("coronaIntensity");
});

pub fn read_lod_lights(read: &Read) -> Result<LodLights> {
    match View::root(read)?.substruct("LODLightsSOA") {
        Some(soa) => LodLights::load(&soa),
        None => Ok(LodLights::default()),
    }
}

/// Узел массива поля `field` внутри структуры `soa_name` корня и число его элементов.
pub fn soa_array(read: &Read, soa_name: &str, field: &str) -> Result<Option<(NodeId, usize)>> {
    let root = View::root(read)?;
    let Some(soa) = root.substruct(soa_name) else {
        return Ok(None);
    };
    let head = root.array_at(soa.locate(field)?.pos)?;
    Ok(head.target.map(|node| (node, head.count)))
}

// ---------------------------------------------------------------------------------------------------------------
// Опись заголовка карты и таблица имён
// ---------------------------------------------------------------------------------------------------------------

/// Как печатается значение поля корня в описи.
#[derive(Clone, Copy)]
enum Show {
    Decimal,
    Hex,
    Triple,
    Count,
}

impl Show {
    fn render(self, root: &View, field: &str) -> Result<String> {
        Ok(match self {
            Show::Decimal => root.word(field)?.to_string(),
            Show::Hex => hex_word(root.word(field)?),
            Show::Count => root.count(field)?.to_string(),
            Show::Triple => {
                let chunk = root.bytes_at(root.locate(field)?.pos, 12)?;
                let words: Vec<String> = (0..3).map(|i| hex_word(word_of(chunk, 4 * i))).collect();
                words.join(",")
            }
        })
    }
}

const ENVELOPE_ROWS: [(&str, Show); 15] = [
    ("name", Show::Hex),
    ("parent", Show::Hex),
    ("flags", Show::Decimal),
    ("contentFlags", Show::Decimal),
    ("streamingExtentsMin", Show::Triple),
    ("streamingExtentsMax", Show::Triple),
    ("entitiesExtentsMin", Show::Triple),
    ("entitiesExtentsMax", Show::Triple),
    ("entities", Show::Count),
    ("containerLods", Show::Count),
    ("boxOccluders", Show::Count),
    ("occludeModels", Show::Count),
    ("physicsDictionaries", Show::Count),
    ("timeCycleModifiers", Show::Count),
    ("carGenerators", Show::Count),
];

/// Слова корня, которых нет в схеме: смещение и вид записи (шестнадцатеричная или десятичная).
const ENVELOPE_WORDS: [(&str, usize, bool); 8] = [
    ("unused0", 0, false),
    ("unused1", 4, false),
    ("unused2", 24, false),
    ("unused3", 28, false),
    ("unused4", 44, true),
    ("unused5", 60, true),
    ("unused6", 76, true),
    ("unused7", 92, true),
];

fn hex_word(word: u32) -> String {
    format!("0x{word:08X}")
}

pub fn lod_envelope(read: &Read) -> Result<BTreeMap<String, String>> {
    let root = View::root(read)?;
    let words = ENVELOPE_WORDS.iter().map(|&(key, at, hex)| {
        let word = root.word_at(at)?;
        Ok((key, if hex { hex_word(word) } else { word.to_string() }))
    });
    let rows = ENVELOPE_ROWS.iter().map(|&(key, show)| Ok((key, show.render(&root, key)?)));
    let mut out: BTreeMap<String, String> = words
        .chain(rows)
        .map(|entry| entry.map(|(key, text): (&str, String)| (key.to_string(), text)))
        .collect::<Result<_>>()?;

    let instanced = root.substruct("instancedData").ok_or_else(|| refuse(NO_INSTANCED))?;
    for (key, field) in [("propInstances", "PropInstanceList"), ("grassInstances", "GrassInstanceList")] {
        out.insert(key.to_string(), instanced.count(field)?.to_string());
    }

    // число уличных огней и категория бывают, только если у дальних огней есть позиции
    let street_and_category = match root.substruct("DistantLODLightsSOA") {
        Some(soa) if soa.count("position")? != 0 => {
            let street = soa.half_at(soa.locate("numStreetLights")?.pos)?;
            let category = soa.half_at(soa.locate("category")?.pos)?;
            Some((street.to_string(), category.to_string()))
        }
        _ => None,
    };
    let (street, category) = street_and_category.unwrap_or_else(|| ("absent".to_string(), "absent".to_string()));
    out.insert("distantNumStreetLights".to_string(), street);
    out.insert("distantCategory".to_string(), category);
    Ok(out)
}

/// Хеш нижнего регистра → строка из таблицы строк файла; при повторе остаётся первая.
pub fn name_index(read: &Read) -> HashMap<u32, String> {
    // с конца: при совпадении хешей последняя вставка перекрывает прежние, то есть выигрывает первая строка
    read.strings().into_iter().rev().map(|text| (joaat(&text), text)).collect()
}

/// Записи таблицы строк так, как их читает хост: первый байт записи берётся всегда, даже нулевой, дальше — до нуля или до
/// конца таблицы. После чётной серии нулей запись поэтому начинается с нуля, а пара нулей между записями — пустая запись.
/// Байты вне ASCII читаются знаком `?`, по знаку на байт.
fn table_entries(table: &[u8]) -> impl Iterator<Item = String> + '_ {
    let mut at = 0usize;
    std::iter::from_fn(move || {
        (at < table.len()).then(|| {
            let end = table[at + 1..].iter().position(|&byte| byte == 0).map_or(table.len(), |gap| at + 1 + gap);
            let entry = &table[at..end];
            at = end + 1;
            entry.iter().map(|&byte| if byte < 0x80 { char::from(byte) } else { '?' }).collect()
        })
    })
}

/// Хеш «по буквам как написано» → запись таблиц строк файла (все страницы таблицы). Так хост даёт имена архетипов карты:
/// регистр не меняется (имя со смешанным регистром не находится по хешу нижнего регистра, каким хешируют имена в игре),
/// списка штатных имён у него нет, при равных хешах остаётся первая запись, хеш 0 имени не получает. Правило выведено
/// опытами над хостом: `scripts/parity/ymap-names-lab.mjs`, `docs/speed-helpers/RW-32-YMAP-CLEAN-1811.md`.
pub fn exact_name_index(read: &Read) -> HashMap<u32, String> {
    let mut names = HashMap::new();
    for table in read.string_tables() {
        for entry in table_entries(table) {
            let hash = joaat_case(&entry);
            if hash != 0 {
                names.entry(hash).or_insert(entry);
            }
        }
    }
    names
}

// ---------------------------------------------------------------------------------------------------------------
// Словарь типов: сущности, комнаты, порталы, помещение
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct Entity {
    pub archetype_hash: u32,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub flags: u32,
    pub lod_dist: f32,
    pub parent_index: i32,
}

loader!(Entity from e {
    archetype_hash <- word("archetypeName");
    position <- vec3("position");
    rotation <- vec4("rotation");
    flags <- word("flags");
    lod_dist <- float("lodDist");
    parent_index <- int("parentIndex");
});

#[derive(PartialEq, Clone, Debug)]
pub struct EntitySet {
    pub name_hash: u32,
    pub entities: Vec<Entity>,
}

// сначала сущности набора, потом его имя
loader!(EntitySet from set {
    entities <- members("entities", Entity::load);
    name_hash <- word("name");
});

#[derive(PartialEq, Clone, Debug)]
pub struct Room {
    pub name: Option<String>,
    pub bb_min: [f32; 3],
    pub bb_max: [f32; 3],
    pub flags: u32,
    pub floor_id: i32,
    pub attached_objects: Vec<u32>,
}

loader!(Room from room {
    name <- text("name");
    bb_min <- vec3("bbMin");
    bb_max <- vec3("bbMax");
    flags <- word("flags");
    floor_id <- int("floorId");
    attached_objects <- words("attachedObjects");
});

#[derive(PartialEq, Clone, Debug)]
pub struct Portal {
    pub room_from: u32,
    pub room_to: u32,
    pub flags: u32,
    pub corners: Vec<[f32; 3]>,
    pub attached_objects: Vec<u32>,
}

loader!(Portal from portal {
    room_from <- word("roomFrom");
    room_to <- word("roomTo");
    flags <- word("flags");
    corners <- points("corners", 16);
    attached_objects <- words("attachedObjects");
});

#[derive(PartialEq, Clone, Debug)]
pub struct Mlo {
    pub rooms: Vec<Room>,
    pub portals: Vec<Portal>,
    pub entities: Vec<Entity>,
    pub entity_sets: Vec<EntitySet>,
}

loader!(Mlo from interior {
    rooms <- rows("rooms", Room::load);
    portals <- rows("portals", Portal::load);
    entities <- members("entities", Entity::load);
    entity_sets <- rows("entitySets", EntitySet::load);
});

/// Ключ структуры `CMloArchetypeDef`.
pub const MLO_ARCHETYPE_KEY: u32 = 937_664_754;

#[derive(PartialEq, Clone, Debug)]
pub struct Archetype {
    pub kind: u32,
    pub name_hash: u32,
    pub asset_hash: u32,
    pub lod_dist: f32,
    pub flags: u32,
    pub special_attribute: u32,
    pub bb_min: [f32; 3],
    pub bb_max: [f32; 3],
    pub bs_centre: [f32; 3],
    pub bs_radius: f32,
    pub hd_texture_dist: f32,
    pub asset_type: u32,
    pub texture_dictionary: u32,
    pub drawable_dictionary: u32,
    pub physics_dictionary: u32,
    pub clip_dictionary: u32,
    pub mlo: Option<Mlo>,
}

// помещение читается целиком раньше базовых полей
loader!(Archetype from a {
    kind <- key();
    mlo <- interior();
    name_hash <- word("name");
    asset_hash <- word("assetName");
    lod_dist <- float("lodDist");
    flags <- word("flags");
    special_attribute <- word("specialAttribute");
    bb_min <- vec3("bbMin");
    bb_max <- vec3("bbMax");
    bs_centre <- vec3("bsCentre");
    bs_radius <- float("bsRadius");
    hd_texture_dist <- float("hdTextureDist");
    asset_type <- word("assetType");
    texture_dictionary <- word("textureDictionary");
    drawable_dictionary <- word("drawableDictionary");
    physics_dictionary <- word("physicsDictionary");
    clip_dictionary <- word("clipDictionary");
});

#[derive(PartialEq, Clone, Debug)]
pub struct Ytyp {
    pub name_hash: u32,
    pub archetypes: Vec<Archetype>,
}

loader!(Ytyp from dictionary {
    name_hash <- word("name");
    archetypes <- members("archetypes", Archetype::load);
});

pub fn read_ytyp(read: &Read) -> Result<Ytyp> {
    View::root(read).and_then(|root| Ytyp::load(&root))
}

// ---------------------------------------------------------------------------------------------------------------
// Запись моделей в помещение
// ---------------------------------------------------------------------------------------------------------------

#[derive(PartialEq, Clone, Debug)]
pub struct NewModel {
    pub name: String,
    pub lod_dist: f32,
    pub bb_min: [f32; 3],
    pub bb_max: [f32; 3],
    pub flags: u32,
    pub clip_dictionary: Option<String>,
    pub position: [f32; 3],
    pub entity_flags: u32,
}

/// Значение поля нового узла.
enum Value {
    Word(u32),
    Float(f32),
    Triple([f32; 3]),
    Quad([f32; 4]),
}

impl Value {
    fn to_bytes(&self) -> Vec<u8> {
        let words: Vec<u32> = match self {
            Value::Word(w) => vec![*w],
            Value::Float(f) => vec![f.to_bits()],
            Value::Triple(v) => v.iter().map(|x| x.to_bits()).collect(),
            Value::Quad(v) => v.iter().map(|x| x.to_bits()).collect(),
        };
        words.iter().flat_map(|w| w.to_le_bytes()).collect()
    }
}

/// Новый узел структуры `def`: нули, в которые по смещениям из схемы кладутся поля. Поле, которого в схеме
/// нет, ложится по смещению 0.
fn stamp(def: &StructDef, fields: &[(&str, Value)]) -> Result<Node> {
    let mut bytes = vec![0u8; def.size as usize];
    fields.iter().try_for_each(|(name, value)| -> Result<()> {
        // Поля нет в схеме файла: его просто нет у этого вида структуры, писать некуда.
        let Some(entry) = def.field(joaat_case(name)) else { return Ok(()) };
        let pos = entry.offset as usize;
        let data = value.to_bytes();
        let target = bytes.get_mut(pos..pos + data.len()).ok_or_else(|| refuse(WRITE_OUTSIDE))?;
        target.copy_from_slice(&data);
        Ok(())
    })?;
    Ok(Node { block: def.name, bytes, links: Vec::new() })
}

fn archetype_node(def: &StructDef, m: &NewModel) -> Result<Node> {
    let hash = joaat_case(&m.name);
    let centre: [f32; 3] = std::array::from_fn(|i| (m.bb_min[i] + m.bb_max[i]) * 0.5);
    let [dx, dy, dz]: [f32; 3] = std::array::from_fn(|i| (m.bb_max[i] - centre[i]).powi(2));
    let radius = (dx + dy + dz).sqrt();
    let clip = m.clip_dictionary.as_deref().map_or(0, joaat_case);
    stamp(
        def,
        &[
            ("lodDist", Value::Float(m.lod_dist)),
            ("flags", Value::Word(m.flags)),
            ("bbMin", Value::Triple(m.bb_min)),
            ("bbMax", Value::Triple(m.bb_max)),
            ("bsCentre", Value::Triple(centre)),
            ("bsRadius", Value::Float(radius)),
            ("hdTextureDist", Value::Float(m.lod_dist.min(100.0))),
            ("name", Value::Word(hash)),
            ("textureDictionary", Value::Word(hash)),
            ("clipDictionary", Value::Word(clip)),
            ("assetType", Value::Word(2)),
            ("assetName", Value::Word(hash)),
            ("specialAttribute", Value::Word(0)),
            ("drawableDictionary", Value::Word(0)),
            ("physicsDictionary", Value::Word(0)),
        ],
    )
}

fn entity_node(def: &StructDef, m: &NewModel) -> Result<Node> {
    stamp(
        def,
        &[
            ("archetypeName", Value::Word(joaat_case(&m.name))),
            ("flags", Value::Word(m.entity_flags)),
            ("guid", Value::Word(joaat_case(&format!("/{}", m.name)))),
            ("position", Value::Triple(m.position)),
            ("rotation", Value::Quad([0.0, 0.0, 0.0, 1.0])),
            ("scaleXY", Value::Float(1.0)),
            ("scaleZ", Value::Float(1.0)),
            ("parentIndex", Value::Word(u32::MAX)),
            ("lodDist", Value::Float(m.lod_dist)),
            ("childLodDist", Value::Float(0.0)),
            ("lodLevel", Value::Word(5)),
            ("numChildren", Value::Word(0)),
            ("priorityLevel", Value::Word(0)),
            ("ambientOcclusionMultiplier", Value::Word(255)),
            ("artificialAmbientOcclusion", Value::Word(255)),
            ("tintValue", Value::Word(0)),
        ],
    )
}

/// Ссылка узла по смещению `at` ведёт на `target`: существующая запись меняется на месте, иначе дописывается.
fn hook(links: &mut Vec<Link>, at: usize, target: NodeId) {
    let index = links.iter().position(|l| l.at == at).unwrap_or_else(|| {
        links.push(Link { at, target: None });
        links.len() - 1
    });
    links[index].target = Some(target);
}

/// Вешает новый узел-массив на поле `at` узла `owner`: ссылка и число элементов (`u16`); ёмкость рядом не трогается.
fn attach_array(graph: &mut Graph, owner: NodeId, at: usize, array: Node, count: usize, complaint: &str) -> Result<()> {
    let id = graph.push(array);
    let host = &mut graph.nodes[owner];
    let counter = host.bytes.get_mut(at + 8..at + 10).ok_or_else(|| refuse(complaint))?;
    counter.copy_from_slice(&(count as u16).to_le_bytes());
    hook(&mut host.links, at, id);
    Ok(())
}

fn replace_pointers(graph: &mut Graph, list: &Pointers, members: &[NodeId]) -> Result<()> {
    if !list.backed {
        return Err(refuse(LIST_WITHOUT_ARRAY));
    }
    let array = Node {
        block: POINTER_BLOCK,
        bytes: vec![0u8; members.len() * 8],
        links: members.iter().enumerate().map(|(slot, &m)| Link { at: slot * 8, target: Some(m) }).collect(),
    };
    attach_array(graph, list.owner, list.at, array, members.len(), LIST_COUNTER)
}

/// Новое содержимое списка `u32` в поле комнаты.
struct WordList {
    owner: NodeId,
    at: usize,
    block: u32,
    values: Vec<u32>,
}

impl WordList {
    fn apply(self, graph: &mut Graph) -> Result<()> {
        let array = Node {
            block: self.block,
            bytes: self.values.iter().flat_map(|v| v.to_le_bytes()).collect(),
            links: Vec::new(),
        };
        attach_array(graph, self.owner, self.at, array, self.values.len(), ROOM_COUNTER)
    }
}

/// Блок узла, на который сейчас ссылается поле-массив комнаты.
fn payload_block(room: &View, pos: usize) -> Result<Option<u32>> {
    let head = room.array_at(pos)?;
    head.target.map(|id| room.node_by(id).map(|n| n.block)).transpose()
}

/// Словарь и помещение в нём, куда пойдут модели.
struct Target {
    archetypes: Pointers,
    interior: NodeId,
}

impl Target {
    /// Первое помещение словаря (с нужным именем, если оно задано).
    fn pick(read: &Read, wanted: Option<u32>) -> Result<Self> {
        let archetypes = View::root(read)?.pointers("archetypes")?;
        let interior = archetypes
            .members
            .iter()
            .map(|&id| {
                let v = View::open(read, id)?;
                let fits = v.def.key == MLO_ARCHETYPE_KEY && wanted.is_none_or(|w| v.word("name").ok() == Some(w));
                Ok(fits.then_some(id))
            })
            .find_map(Result::transpose)
            .unwrap_or_else(|| Err(refuse(NO_INTERIOR)))?;
        Ok(Target { archetypes, interior })
    }
}

/// Что остаётся от словаря и помещения после удаления прежних установок тех же имён.
struct Sweep {
    archetypes: Vec<NodeId>,
    entities: Pointers,
    kept_entities: Vec<NodeId>,
    dropped: Vec<u32>,
}

impl Sweep {
    fn plan(read: &Read, target: &Target, doomed: &HashSet<u32>) -> Result<Self> {
        // помещения не удаляются никогда, обычные архетипы — по имени
        let archetypes = target
            .archetypes
            .members
            .iter()
            .map(|&id| {
                let v = View::open(read, id)?;
                let removed = v.def.key != MLO_ARCHETYPE_KEY && doomed.contains(&v.word("name")?);
                Ok((!removed).then_some(id))
            })
            .filter_map(Result::transpose)
            .collect::<Result<Vec<_>>>()?;
        let entities = View::open(read, target.interior)?.pointers("entities")?;
        let verdicts = entities
            .members
            .iter()
            .map(|&id| Ok((id, doomed.contains(&View::open(read, id)?.word("archetypeName")?))))
            .collect::<Result<Vec<(NodeId, bool)>>>()?;
        let dropped = verdicts.iter().enumerate().filter(|(_, v)| v.1).map(|(i, _)| i as u32).collect();
        let kept_entities = verdicts.iter().filter(|v| !v.1).map(|v| v.0).collect();
        Ok(Sweep { archetypes, entities, kept_entities, dropped })
    }

    /// Списки `attachedObjects` комнат без удалённых сущностей: их номера пропадают, остальные сдвигаются вниз.
    /// Комнаты, у которых список не изменился, в результат не попадают.
    fn renumbered_rooms(&self, read: &Read, interior: NodeId) -> Result<Vec<WordList>> {
        let gone = &self.dropped;
        View::open(read, interior)?
            .elements("rooms")?
            .into_iter()
            .map(|room| -> Result<Option<WordList>> {
                let slot = room.locate("attachedObjects")?;
                let old = room.words("attachedObjects")?;
                let new: Vec<u32> = old
                    .iter()
                    .filter(|v| gone.binary_search(v).is_err())
                    .map(|&v| v - gone.partition_point(|&d| d < v) as u32)
                    .collect();
                if new == old {
                    return Ok(None);
                }
                let block = payload_block(&room, slot.pos)?.unwrap_or(0);
                Ok(Some(WordList { owner: room.id, at: slot.pos, block, values: new }))
            })
            .filter_map(Result::transpose)
            .collect()
    }
}

/// Описания структур, по которым строятся новые узлы.
struct Blueprints {
    archetype: StructDef,
    entity: StructDef,
}

impl Blueprints {
    fn fetch(read: &Read) -> Result<Self> {
        let named = |name: &str, complaint: &str| {
            read.schema.struct_named(joaat_case(name)).cloned().ok_or_else(|| refuse(complaint))
        };
        // порядок важен: сначала жалоба на базовый архетип
        let archetype = named("CBaseArchetypeDef", NO_BASE_DEF)?;
        let entity = named("CEntityDef", NO_ENTITY_DEF)?;
        Ok(Blueprints { archetype, entity })
    }
}

/// Комната для каждой модели: из комнат без нулевой берётся та, чья рамка ближе всего к точке модели.
fn seat_models(read: &Read, interior: NodeId, models: &[NewModel]) -> Result<Vec<usize>> {
    if models.is_empty() {
        return Ok(Vec::new());
    }
    let rooms = View::open(read, interior)?.elements("rooms")?;
    if rooms.len() < 2 {
        return Err(refuse(ONLY_LIMBO));
    }
    let boxes = rooms[1..]
        .iter()
        .map(|r| Ok((r.vec3("bbMin")?, r.vec3("bbMax")?)))
        .collect::<Result<Vec<_>>>()?;
    models
        .iter()
        .map(|model| {
            let number = 1 + nearest_box(&boxes, model.position);
            rooms[number].locate("attachedObjects")?;
            Ok(number)
        })
        .collect()
}

/// Рамка (номер среди `boxes`), ближайшая к точке; при равенстве — с меньшим номером.
fn nearest_box(boxes: &[([f32; 3], [f32; 3])], point: [f32; 3]) -> usize {
    let distance = |&(a, b): &([f32; 3], [f32; 3])| -> f32 {
        let gap: [f32; 3] = std::array::from_fn(|i| {
            let (lo, hi) = (a[i].min(b[i]), a[i].max(b[i]));
            let near = match point[i] {
                p if p < lo => lo,
                p if p > hi => hi,
                p => p,
            };
            point[i] - near
        });
        (gap[0] * gap[0] + gap[1] * gap[1] + gap[2] * gap[2]).sqrt()
    };
    let first = distance(&boxes[0]);
    boxes
        .iter()
        .enumerate()
        .skip(1)
        .fold((0, first), |(best, best_distance), (i, b)| {
            let d = distance(b);
            if d < best_distance {
                (i, d)
            } else {
                (best, best_distance)
            }
        })
        .0
}

/// Список `attachedObjects` выбранной комнаты с номером новой сущности в конце.
fn room_list_with(read: &Read, interior: NodeId, number: usize, entity_index: usize) -> Result<WordList> {
    let room = View::open(read, interior)?.elements("rooms")?[number];
    let slot = room.locate("attachedObjects")?;
    room.half_at(slot.pos + 8).map_err(|_| refuse(ROOM_COUNTER))?;
    // образец — узел, на который комната ссылается сейчас (опустевший список тоже годится)
    let block = payload_block(&room, slot.pos)?.ok_or_else(|| refuse(NO_SAMPLE_LIST))?;
    let mut values = room.words("attachedObjects")?;
    values.push(entity_index as u32);
    Ok(WordList { owner: room.id, at: slot.pos, block, values })
}

/// Дописывает в помещение новые модели (архетип и сущность на каждую), убрав прежние с теми же именами.
pub fn add_models(bytes: &[u8], wanted: Option<u32>, models: &[NewModel]) -> Result<Vec<u8>> {
    let mut read = meta_graph::read(bytes)?;
    let target = Target::pick(&read, wanted)?;

    let doomed: HashSet<u32> = models.iter().map(|m| joaat_case(&m.name)).collect();
    let sweep = Sweep::plan(&read, &target, &doomed)?;
    if !sweep.dropped.is_empty() {
        for list in sweep.renumbered_rooms(&read, target.interior)? {
            list.apply(&mut read.graph)?;
        }
    }

    // обязательное поле комнат и описания структур новых узлов
    View::open(&read, target.interior)?.locate("rooms")?;
    let blueprints = Blueprints::fetch(&read)?;
    let seats = seat_models(&read, target.interior, models)?;

    let made = models
        .iter()
        .map(|m| Ok((archetype_node(&blueprints.archetype, m)?, entity_node(&blueprints.entity, m)?)))
        .collect::<Result<Vec<_>>>()?;
    let (new_archetypes, new_entities): (Vec<NodeId>, Vec<NodeId>) = made
        .into_iter()
        .map(|(a, e)| (read.graph.push(a), read.graph.push(e)))
        .unzip();

    let archetype_ids = [sweep.archetypes.as_slice(), new_archetypes.as_slice()].concat();
    replace_pointers(&mut read.graph, &target.archetypes, &archetype_ids)?;
    let first_new = sweep.kept_entities.len();
    let entity_ids = [sweep.kept_entities.as_slice(), new_entities.as_slice()].concat();
    replace_pointers(&mut read.graph, &sweep.entities, &entity_ids)?;

    // номера новых сущностей — в списки выбранных комнат, по одной модели за раз
    seats.iter().enumerate().try_for_each(|(n, &number)| {
        room_list_with(&read, target.interior, number, first_new + n)?.apply(&mut read.graph)
    })?;

    meta_graph::write(&read.schema, &read.graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta_graph::Entry;
    use crate::placements::{self, ArchetypeFields, ArchetypeSpec, EntitySpec};

    /// Путь к файлу `.ytyp` из переменной окружения `MLO_SAMPLE`: печатает, что нашлось. Ничего не проверяет.
    #[test]
    #[ignore]
    fn mlo_sample() {
        let Ok(path) = std::env::var("MLO_SAMPLE") else {
            return;
        };
        let bytes = std::fs::read(path).expect("файл образца");
        let read = meta_graph::read(&bytes).expect("разбор метаданных");
        let ytyp = read_ytyp(&read).expect("словарь типов");
        println!("архетипов {} имя словаря {}", ytyp.archetypes.len(), ytyp.name_hash);
        for a in ytyp.archetypes.iter().filter_map(|a| a.mlo.as_ref()) {
            println!(
                "помещение: комнат {} порталов {} сущностей {} наборов {}",
                a.rooms.len(),
                a.portals.len(),
                a.entities.len(),
                a.entity_sets.len()
            );
        }
    }

    fn crate_spec(name: &str) -> ArchetypeSpec {
        ArchetypeSpec {
            name: name.into(),
            lod_dist: 150.0,
            bb_min: [-1.0, -2.0, 0.0],
            bb_max: [1.0, 2.0, 3.0],
            flags: 0,
            clip_dictionary: None,
        }
    }

    fn placed(index: usize) -> EntitySpec {
        EntitySpec {
            archetype: 0,
            position: [index as f32, 2.0 * index as f32, 5.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            lod_dist: 300.0,
            flags: 32,
            guid: None,
        }
    }

    fn map_read(entities: usize) -> Read {
        let list: Vec<EntitySpec> = (0..entities).map(placed).collect();
        let bytes = placements::compile_map("rym", &[crate_spec("pl_crate")], &list, "Astral", "t").unwrap();
        meta_graph::read(&bytes).unwrap()
    }

    #[test]
    fn a_compiled_map_reads_back_with_its_header_and_entities() {
        let ymap = read_ymap(&map_read(3)).unwrap();
        assert_eq!(ymap.name_hash, joaat_case("rym"));
        assert_eq!(ymap.content_flags, 1);
        assert_eq!(ymap.entities.len(), 3);
        assert_eq!(ymap.entities[2].position, [2.0, 4.0, 5.0]);
        assert!(ymap.entities.iter().all(|e| !e.is_mlo && e.parent_index == -1 && e.lod_level == 5));
        assert_eq!(ymap.entities_min, [-1.0, -2.0, 5.0]);
    }

    #[test]
    fn a_types_file_is_refused_as_a_map() {
        let types = placements::compile_archetype_types("t", &[], &[]).unwrap();
        let read = meta_graph::read(&types).unwrap();
        assert_eq!(read_ymap(&read).unwrap_err().message, "В метаданных нет поля entities.");
    }

    #[test]
    fn a_missing_node_or_struct_is_reported() {
        let mut read = map_read(1);
        read.graph.root = 99;
        assert_eq!(read_ymap(&read).unwrap_err().message, "Узел метаданных вне графа.");
        read.graph.root = 0;
        read.graph.nodes[0].block = 0x1234_5678;
        assert_eq!(read_ymap(&read).unwrap_err().message, "Тип узла метаданных не описан в файле.");
    }

    #[test]
    fn a_slot_count_larger_than_the_links_gives_the_linked_entities_only() {
        let mut read = map_read(3);
        read.graph.nodes[0].bytes[96 + 8..96 + 10].copy_from_slice(&65535u16.to_le_bytes());
        assert_eq!(read_ymap(&read).unwrap().entities.len(), 3);
        read.graph.nodes[0].bytes[96 + 8..96 + 10].copy_from_slice(&2u16.to_le_bytes());
        assert_eq!(read_ymap(&read).unwrap().entities.len(), 2);
    }

    #[test]
    fn a_field_in_a_nested_struct_stands_in_for_a_missing_one() {
        let mut read = map_read(1);
        for def in read.schema.structs.iter_mut().filter(|d| d.name == joaat_case("CMapData")) {
            def.entries.retain(|e| e.name != joaat_case("name"));
        }
        // имя карты читается из CBlockDesc.name: младшие 32 бита указателя строки
        assert_eq!(read_ymap(&read).unwrap().name_hash, 4);
    }

    #[test]
    fn a_field_past_the_node_end_is_refused() {
        let mut read = map_read(1);
        for def in read.schema.structs.iter_mut().filter(|d| d.name == joaat_case("CEntityDef")) {
            for e in def.entries.iter_mut().filter(|e| e.name == joaat_case("flags")) {
                e.offset = 126;
            }
        }
        assert_eq!(read_ymap(&read).unwrap_err().message, "Поле вне узла метаданных.");
    }

    #[test]
    fn a_map_without_lights_has_empty_light_lists_and_no_soa_arrays() {
        let read = map_read(1);
        assert_eq!(read_distant_lights(&read).unwrap(), DistantLights::default());
        assert_eq!(read_lod_lights(&read).unwrap(), LodLights::default());
        assert_eq!(soa_array(&read, "LODLightsSOA", "falloff").unwrap(), None);
        assert_eq!(soa_array(&read, "NoSuchSOA", "falloff").unwrap(), None);
        assert_eq!(soa_array(&read, "LODLightsSOA", "nope").unwrap_err().message, "В метаданных нет поля nope.");
    }

    #[test]
    fn the_envelope_has_all_keys_and_prints_words_in_the_documented_forms() {
        let read = map_read(3);
        let env = lod_envelope(&read).unwrap();
        assert_eq!(env.len(), 27);
        assert_eq!(env["entities"], "3");
        assert_eq!(env["contentFlags"], "1");
        assert_eq!(env["parent"], "0x00000000");
        assert_eq!(env["entitiesExtentsMin"], "0xBF800000,0xC0000000,0x40A00000");
        assert_eq!(env["distantCategory"], "absent");
        assert_eq!(env["distantNumStreetLights"], "absent");
        let mut broken = map_read(1);
        for def in broken.schema.structs.iter_mut().filter(|d| d.name == joaat_case("CMapData")) {
            def.entries.retain(|e| e.name != joaat_case("instancedData"));
        }
        assert_eq!(lod_envelope(&broken).unwrap_err().message, "Карта без instancedData.");
    }

    #[test]
    fn the_name_index_lowercases_the_hash_and_keeps_the_first_string() {
        let bytes = placements::compile_map("ABC", &[crate_spec("x")], &[placed(0)], "abc", "aBc").unwrap();
        let read = meta_graph::read(&bytes).unwrap();
        let index = name_index(&read);
        assert_eq!(index.len(), 1);
        assert_eq!(index[&joaat("abc")], "ABC");
        let types = placements::compile_archetype_types("t", &[], &[]).unwrap();
        assert!(name_index(&meta_graph::read(&types).unwrap()).is_empty());
    }

    #[test]
    fn table_entries_take_the_first_byte_of_an_entry_unconditionally() {
        let all = |table: &[u8]| table_entries(table).collect::<Vec<_>>();
        assert_eq!(all(b"ab\0cd\0"), ["ab", "cd"]);
        assert_eq!(all(b"ab\0\0cd\0"), ["ab", "\0cd"]);
        assert_eq!(all(b"ab\0\0\0cd\0"), ["ab", "\0", "cd"]);
        assert_eq!(all(b"ab\0\0\0\0cd\0"), ["ab", "\0", "\0cd"]);
        // нет нуля в конце таблицы: запись всё равно берётся
        assert_eq!(all(b"ab"), ["ab"]);
        assert!(all(b"").is_empty());
        // байты вне ASCII — по знаку вопроса на байт
        assert_eq!(all("zzq_é".as_bytes()), ["zzq_??"]);
        assert_eq!(all(&[b'a', 0xe9, 0xff, b'b', 0]), ["a??b"]);
    }

    #[test]
    fn the_exact_name_index_hashes_the_letters_as_written_and_never_names_hash_zero() {
        let bytes = placements::compile_map("ABC", &[crate_spec("x")], &[placed(0)], "abc", "aBc\0\0\0z").unwrap();
        let index = exact_name_index(&meta_graph::read(&bytes).unwrap());
        // «ABC», «abc», «aBc» — три разных хеша; запись «\0» (пара нулей в «aBc\0\0\0z») хеш 0 имени не даёт
        assert_eq!(index[&joaat_case("ABC")], "ABC");
        assert_eq!(index[&joaat_case("abc")], "abc");
        assert_eq!(index[&joaat_case("aBc")], "aBc");
        assert_eq!(index[&joaat_case("z")], "z");
        assert!(!index.contains_key(&0));
        // индекс нижнего регистра у ytyp и описи файлов карты остаётся прежним
        assert_eq!(name_index(&meta_graph::read(&bytes).unwrap())[&joaat("abc")], "ABC");
    }

    #[test]
    fn a_types_file_reads_back_archetypes_and_a_timed_one_keeps_its_base_fields() {
        let fields = |time| ArchetypeFields { special_attribute: 9, hd_texture_dist: 77.0, texture_dictionary: Some(0xABCD), time_flags: time };
        let types = placements::compile_archetype_types(
            "pl_types",
            &[crate_spec("pl_crate"), crate_spec("pl_lamp")],
            &[fields(None), fields(Some(0x0100_FC00))],
        )
        .unwrap();
        let ytyp = read_ytyp(&meta_graph::read(&types).unwrap()).unwrap();
        assert_eq!(ytyp.name_hash, joaat_case("pl_types"));
        assert_eq!(ytyp.archetypes.len(), 2);
        assert_eq!(ytyp.archetypes[0].kind, 2_411_387_556);
        assert_eq!(ytyp.archetypes[1].kind, 2_520_619_910);
        assert_eq!(ytyp.archetypes[0].texture_dictionary, 0xABCD);
        assert_eq!(ytyp.archetypes[0].bs_centre, [0.0, 0.0, 1.5]);
        assert!(ytyp.archetypes.iter().all(|a| a.mlo.is_none()));
    }

    // --- словарь с помещением, собранный вручную (схема помещения придумана: поля ищутся по именам) ---

    const ROOM_KEY: u32 = 0x1111_0001;
    const PORTAL_KEY: u32 = 0x1111_0002;
    const SET_KEY: u32 = 0x1111_0003;
    const WORDS_BLOCK: u32 = 0x4a;

    fn field(name: &str, offset: i32, dtype: u8, ref_key: u32) -> Entry {
        Entry { name: joaat_case(name), offset, dtype, unk9: 0, ref_index: 0, ref_key }
    }

    fn element_info(dtype: u8, ref_key: u32) -> Entry {
        Entry { name: ARRAYINFO, offset: 0, dtype, unk9: 0, ref_index: 0, ref_key }
    }

    fn define(name: &str, key: u32, size: u32, entries: Vec<Entry>) -> StructDef {
        StructDef { name: joaat_case(name), key, unk8: 1024, size, entries }
    }

    fn interior_structs() -> Vec<StructDef> {
        vec![
            define(
                "CMloArchetypeDef",
                MLO_ARCHETYPE_KEY,
                232,
                vec![
                    field("CBaseArchetypeDef", 0, T_STRUCTURE, 2_411_387_556),
                    element_info(0x07, 0),
                    field("entities", 152, T_ARRAY, 0),
                    element_info(T_STRUCTURE, ROOM_KEY),
                    field("rooms", 168, T_ARRAY, 0),
                    element_info(T_STRUCTURE, PORTAL_KEY),
                    field("portals", 184, T_ARRAY, 0),
                    element_info(T_STRUCTURE, SET_KEY),
                    field("entitySets", 200, T_ARRAY, 0),
                ],
            ),
            define(
                "CMloRoomDef",
                ROOM_KEY,
                112,
                vec![
                    field("name", 8, 0x44, 0),
                    field("bbMin", 32, 0x33, 0),
                    field("bbMax", 48, 0x33, 0),
                    field("flags", 76, 0x15, 0),
                    field("floorId", 84, 0x14, 0),
                    element_info(0x15, 0),
                    field("attachedObjects", 96, T_ARRAY, 0),
                ],
            ),
            define("CMloPortalDef", PORTAL_KEY, 64, vec![field("roomFrom", 8, 0x15, 0)]),
            define("CMloEntitySet", SET_KEY, 48, vec![field("name", 8, 0x4a, 0)]),
        ]
    }

    /// Три комнаты (нулевая, A: x∈[-4,0], B: x∈[0,4]); списки `attachedObjects` берутся из `attached`.
    fn interior_file(entity_names: &[&str], base_names: &[&str], attached: [Vec<u32>; 3]) -> Vec<u8> {
        let archetypes: Vec<ArchetypeSpec> = base_names.iter().map(|n| crate_spec(n)).collect();
        let fields: Vec<ArchetypeFields> = archetypes
            .iter()
            .map(|_| ArchetypeFields { special_attribute: 0, hd_texture_dist: 100.0, texture_dictionary: None, time_flags: None })
            .collect();
        let types = placements::compile_archetype_types("mlo_types", &archetypes, &fields).unwrap();
        let mut read = meta_graph::read(&types).unwrap();
        let map = meta_graph::read(&placements::compile_map("x", &[crate_spec("x")], &[placed(0)], "a", "b").unwrap()).unwrap();
        read.schema.merge(&map.schema);
        read.schema.structs.extend(interior_structs());
        let g = &mut read.graph;
        let root = g.root;

        let mut members: Vec<NodeId> = {
            let list = g.nodes[root].links.iter().find(|l| l.at == 24).and_then(|l| l.target);
            list.map_or_else(Vec::new, |p| g.nodes[p].links.iter().filter_map(|l| l.target).collect())
        };

        let mut entity_ids = Vec::new();
        for (i, name) in entity_names.iter().enumerate() {
            let mut b = vec![0u8; 128];
            b[8..12].copy_from_slice(&joaat_case(name).to_le_bytes());
            b[32..36].copy_from_slice(&(i as f32).to_le_bytes());
            entity_ids.push(g.push(Node { block: joaat_case("CEntityDef"), bytes: b, links: Vec::new() }));
        }
        let pointers = |g: &mut Graph, ids: &[NodeId]| {
            g.push(Node {
                block: POINTER_BLOCK,
                bytes: vec![0; ids.len() * 8],
                links: ids.iter().enumerate().map(|(s, &t)| Link { at: s * 8, target: Some(t) }).collect(),
            })
        };
        let entity_array = pointers(g, &entity_ids);

        let boxes: [([f32; 3], [f32; 3]); 3] = [([0.0; 3], [0.0; 3]), ([-4.0, -4.0, 0.0], [0.0, 4.0, 3.0]), ([0.0, -4.0, 0.0], [4.0, 4.0, 3.0])];
        let mut rooms = vec![0u8; 3 * 112];
        let mut room_links = Vec::new();
        for (i, (lo, hi)) in boxes.iter().enumerate() {
            for k in 0..3 {
                rooms[i * 112 + 32 + 4 * k..i * 112 + 36 + 4 * k].copy_from_slice(&lo[k].to_le_bytes());
                rooms[i * 112 + 48 + 4 * k..i * 112 + 52 + 4 * k].copy_from_slice(&hi[k].to_le_bytes());
            }
            if !attached[i].is_empty() {
                let n = attached[i].len() as u16;
                rooms[i * 112 + 104..i * 112 + 106].copy_from_slice(&n.to_le_bytes());
                rooms[i * 112 + 106..i * 112 + 108].copy_from_slice(&n.to_le_bytes());
                let list = g.push(Node {
                    block: WORDS_BLOCK,
                    bytes: attached[i].iter().flat_map(|v| v.to_le_bytes()).collect(),
                    links: Vec::new(),
                });
                room_links.push(Link { at: i * 112 + 96, target: Some(list) });
            }
        }
        let room_array = g.push(Node { block: joaat_case("CMloRoomDef"), bytes: rooms, links: room_links });

        let mut body = vec![0u8; 232];
        let hash = joaat_case("v_sample_int");
        body[88..92].copy_from_slice(&hash.to_le_bytes());
        body[112..116].copy_from_slice(&hash.to_le_bytes());
        for (at, count) in [(152usize, entity_names.len()), (168, 3)] {
            body[at + 8..at + 10].copy_from_slice(&(count as u16).to_le_bytes());
            body[at + 10..at + 12].copy_from_slice(&(count as u16).to_le_bytes());
        }
        let links = vec![
            Link { at: 152, target: Some(entity_array) },
            Link { at: 168, target: Some(room_array) },
        ];
        members.push(g.push(Node { block: joaat_case("CMloArchetypeDef"), bytes: body, links }));
        let list = pointers(g, &members);
        g.nodes[root].links.iter_mut().find(|l| l.at == 24).unwrap().target = Some(list);
        g.nodes[root].bytes[32..34].copy_from_slice(&(members.len() as u16).to_le_bytes());
        g.nodes[root].bytes[34..36].copy_from_slice(&(members.len() as u16).to_le_bytes());
        meta_graph::write(&read.schema, &read.graph).unwrap()
    }

    fn new_model(name: &str, x: f32) -> NewModel {
        NewModel {
            name: name.into(),
            lod_dist: 150.0,
            bb_min: [-1.0, -2.0, 0.0],
            bb_max: [1.0, 2.0, 3.0],
            flags: 0x20,
            clip_dictionary: None,
            position: [x, 0.0, 1.0],
            entity_flags: 32,
        }
    }

    fn interior_of(bytes: &[u8]) -> (Ytyp, Mlo) {
        let ytyp = read_ytyp(&meta_graph::read(bytes).unwrap()).unwrap();
        let mlo = ytyp.archetypes.iter().find_map(|a| a.mlo.clone()).unwrap();
        (ytyp, mlo)
    }

    #[test]
    fn the_interior_is_read_with_rooms_and_entities() {
        let (ytyp, mlo) = interior_of(&interior_file(&["keep_a", "keep_b"], &["base1"], [vec![], vec![], vec![0]]));
        assert_eq!(ytyp.archetypes.len(), 2);
        assert_eq!(ytyp.archetypes[1].kind, MLO_ARCHETYPE_KEY);
        assert_eq!(mlo.rooms.len(), 3);
        assert_eq!(mlo.rooms[2].attached_objects, vec![0]);
        assert_eq!(mlo.rooms[1].bb_max, [0.0, 4.0, 3.0]);
        assert_eq!(mlo.entities.len(), 2);
        assert!(mlo.portals.is_empty() && mlo.entity_sets.is_empty());
    }

    #[test]
    fn a_model_goes_to_the_nearest_room_and_is_numbered_after_the_old_entities() {
        let base = interior_file(&["keep_a", "keep_b"], &["base1"], [vec![], vec![], vec![0]]);
        let out = add_models(&base, None, &[new_model("pl_model", 2.0), new_model("other", 2.5)]).unwrap();
        let (ytyp, mlo) = interior_of(&out);
        assert_eq!(ytyp.archetypes.len(), 4);
        assert_eq!(ytyp.archetypes[2].name_hash, joaat_case("pl_model"));
        assert_eq!(ytyp.archetypes[2].asset_type, 2);
        assert_eq!(ytyp.archetypes[2].hd_texture_dist, 100.0);
        assert_eq!(mlo.entities.len(), 4);
        assert_eq!(mlo.entities[3].position, [2.5, 0.0, 1.0]);
        assert_eq!(mlo.rooms[2].attached_objects, vec![0, 2, 3]);
        // тот же вход — те же байты
        assert_eq!(add_models(&base, None, &[new_model("pl_model", 2.0), new_model("other", 2.5)]).unwrap(), out);
    }

    #[test]
    fn installing_again_replaces_the_old_model_and_shifts_room_indices() {
        let base = interior_file(&["keep_a", "pl_model", "keep_b"], &["base1", "pl_model"], [vec![], vec![1, 2], vec![0]]);
        let out = add_models(&base, None, &[new_model("pl_model", -2.0)]).unwrap();
        let (ytyp, mlo) = interior_of(&out);
        assert_eq!(ytyp.archetypes.iter().filter(|a| a.name_hash == joaat_case("pl_model")).count(), 1);
        assert_eq!(mlo.entities.len(), 3);
        assert_eq!(mlo.entities[2].archetype_hash, joaat_case("pl_model"));
        // сущность №1 удалена, №2 стала №1; новая (№2) попала в комнату A (она ближе к x = -2)
        assert_eq!(mlo.rooms[2].attached_objects, vec![0]);
        assert_eq!(mlo.rooms[1].attached_objects, vec![1, 2]);
    }

    #[test]
    fn add_models_refuses_unknown_interiors_and_rooms_without_a_list() {
        let base = interior_file(&["keep_a"], &["base1"], [vec![], vec![], vec![0]]);
        let err = |r: Result<Vec<u8>>| r.unwrap_err().message;
        assert_eq!(err(add_models(&base, Some(1), &[new_model("m", 0.0)])), "В словаре нет нужного помещения.");
        // комната A без списка attachedObjects
        assert_eq!(err(add_models(&base, None, &[new_model("m", -2.0)])), "У комнаты нет списка сущностей-образца для записи.");
        let map = placements::compile_map("m", &[crate_spec("x")], &[placed(0)], "a", "b").unwrap();
        assert_eq!(err(add_models(&map, None, &[])), "В метаданных нет поля archetypes.");
    }

    #[test]
    fn a_field_missing_from_the_schema_is_skipped_not_written_over_the_first_bytes() {
        let float = |name: &str, offset: i32| Entry { name: joaat_case(name), offset, dtype: 0x21, unk9: 0, ref_index: -1, ref_key: 0 };
        let def = StructDef { name: 7, key: 8, unk8: 0, size: 16, entries: vec![float("lodDist", 8)] };
        let node = stamp(&def, &[("lodDist", Value::Float(1.5)), ("flags", Value::Word(0xAABB_CCDD)), ("name", Value::Word(0x1122_3344))]).unwrap();
        assert_eq!(node.bytes[..8], [0u8; 8], "чужие поля не легли на начало структуры");
        assert_eq!(node.bytes[8..12], 1.5f32.to_le_bytes());
    }
}
