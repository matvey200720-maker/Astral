//! Карты `.ymap` (метаданные RSC7): карта с коробками модификатора таймцикла,
//! собранная с нуля, и правка значений огней LOD на месте в паре карт.

use crate::error::{Error, Result};
use crate::hash::joaat_case;
use crate::meta_graph::{self, Read};
use crate::mlo;
use crate::resource::{Resource, HEADER_BYTES, RSC7_MAGIC, SYSTEM_BASE};

/// Коробка модификатора таймцикла (`CTimeCycleModifier`).
#[derive(Debug, Clone, PartialEq)]
pub struct TimeCycleBox {
    pub modifier: String,
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub percentage: f32,
    pub range: f32,
    pub start_hour: u32,
    pub end_hour: u32,
}

/// Рамки потоковой загрузки и сущностей, пишутся в карту как есть.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Extents {
    pub streaming_min: [f32; 3],
    pub streaming_max: [f32; 3],
    pub entities_min: [f32; 3],
    pub entities_max: [f32; 3],
}

/// Правка одного огня LOD: заданные поля меняются, остальные остаются.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LodEdit {
    pub index: usize,
    pub falloff: Option<f32>,
    pub falloff_exponent: Option<f32>,
    pub corona_intensity: Option<u8>,
    pub intensity: Option<u8>,
    pub colour: Option<[u8; 3]>,
}

/// Имя структуры, поля или значения в метаданных: joaat по буквам как написаны.
pub fn meta_name(name: &str) -> u32 {
    joaat_case(name)
}

// ---------------------------------------------------------------------------
// Схема карты: текст, из которого строится таблица структур.
// ---------------------------------------------------------------------------

/// Строка `@имя ключ unk8 размер` открывает структуру, следующие строки — её поля
/// `имя:смещение:тип[:ключ[:флаг]]`. Поле `_` — описание элемента массива, оно стоит перед самим массивом.
const SCHEMA_TEXT: &str = r"
@rage__fwInstancedMapData 1836780118 768 48
ImapLink:8:hash
_:0:struct:3120863088
PropInstanceList:16:array
_:0:struct:2085051229
GrassInstanceList:32:array
@CLODLight 2325189228 768 136
_:0:struct:3805007828
direction:8:array
_:0:f32
falloff:24:array
_:0:f32
falloffExponent:40:array
_:0:u32
timeAndStateFlags:56:array
_:0:u32
hash:72:array
_:0:u8
coneInnerAngle:88:array
_:0:u8
coneOuterAngleOrCapExt:104:array
_:0:u8
coronaIntensity:120:array
@CDistantLODLight 2820908419 768 48
_:0:struct:3805007828
position:8:array
_:0:u32
RGBI:24:array
numStreetLights:40:u16
category:42:u16
@CBlockDesc 2015795449 768 72
version:0:u32
flags:4:u32
name:8:chars
exportedBy:24:chars
owner:40:chars
time:56:chars
@CMapData 3448101671 1024 512
name:8:hash
parent:12:hash
flags:16:u32
contentFlags:20:u32
streamingExtentsMin:32:vec3
streamingExtentsMax:48:vec3
entitiesExtentsMin:64:vec3
entitiesExtentsMax:80:vec3
_:0:pointer
entities:96:array
_:0:struct:372253349
containerLods:112:array
_:0:struct:975711773
boxOccluders:128:array::4
_:0:struct:2741784237
occludeModels:144:array::4
_:0:hash
physicsDictionaries:160:array
instancedData:176:struct:4048164286
_:0:struct:1733268304
timeCycleModifiers:224:array
_:0:struct:1860713439
carGenerators:240:array
LODLightsSOA:256:struct:2276214072
DistantLODLightsSOA:392:struct:2033467892
block:440:struct:3072355914
@CTimeCycleModifier 2683420777 1024 64
name:8:hash
minExtents:16:vec3
maxExtents:32:vec3
percentage:48:f32
range:52:f32
startHour:56:u32
endHour:60:u32
";

/// Тип записи схемы; число — как оно лежит в файле.
#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u8)]
enum Dtype {
    Struct = 0x05,
    Pointer = 0x07,
    U8 = 0x11,
    U16 = 0x13,
    U32 = 0x15,
    F32 = 0x21,
    Vec3 = 0x33,
    Chars = 0x44,
    Hash = 0x4a,
    Array = 0x52,
}

const DTYPE_NAMES: [(&str, Dtype); 10] = [
    ("struct", Dtype::Struct),
    ("pointer", Dtype::Pointer),
    ("u8", Dtype::U8),
    ("u16", Dtype::U16),
    ("u32", Dtype::U32),
    ("f32", Dtype::F32),
    ("vec3", Dtype::Vec3),
    ("chars", Dtype::Chars),
    ("hash", Dtype::Hash),
    ("array", Dtype::Array),
];

/// Имя записи-описания элемента массива.
const ITEM_NAME: u32 = 0x100;

/// Запись структуры в том виде, как она ложится в таблицу.
struct Record {
    name: u32,
    offset: u32,
    dtype: Dtype,
    unk9: u8,
    described: i16,
    key: u32,
}

struct StructDef {
    name: u32,
    key: u32,
    unk8: u32,
    size: u32,
    records: Vec<Record>,
}

fn number<T: std::str::FromStr>(word: &str) -> T {
    word.parse().unwrap_or_else(|_| panic!("схема карты: не число {word:?}"))
}

fn parse_record(line: &str, position: usize) -> Record {
    let mut parts = line.split(':');
    let name = match parts.next() {
        Some("_") => ITEM_NAME,
        Some(text) => meta_name(text),
        None => unreachable!("строка не пуста"),
    };
    let offset = number(parts.next().unwrap_or("0"));
    let dtype_word = parts.next().unwrap_or_default();
    let dtype = DTYPE_NAMES
        .iter()
        .find(|(word, _)| *word == dtype_word)
        .map(|&(_, dtype)| dtype)
        .unwrap_or_else(|| panic!("схема карты: нет типа {dtype_word:?}"));
    let mut optional = |default: &str| parts.next().filter(|word| !word.is_empty()).unwrap_or(default).to_string();
    let key = number(&optional("0"));
    let unk9 = number(&optional("0"));
    // Описание элемента стоит прямо перед своим массивом.
    let described = if dtype == Dtype::Array { position as i16 - 1 } else { 0 };
    Record { name, offset, dtype, unk9, described, key }
}

fn parse_schema() -> Vec<StructDef> {
    let mut defs: Vec<StructDef> = Vec::new();
    for line in SCHEMA_TEXT.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(head) = line.strip_prefix('@') {
            let mut parts = head.split(' ');
            let name = meta_name(parts.next().unwrap_or_default());
            let mut next = || number(parts.next().unwrap_or("0"));
            let (key, unk8, size) = (next(), next(), next());
            defs.push(StructDef { name, key, unk8, size, records: Vec::new() });
        } else if let Some(def) = defs.last_mut() {
            def.records.push(parse_record(line, def.records.len()));
        }
    }
    defs
}

// ---------------------------------------------------------------------------
// Разметка тела и сборка карты.
// ---------------------------------------------------------------------------

const META_VTABLE: u32 = 0x405b_c808;
const META_MAGIC: u32 = 0x5052_4430;
const GRAPHICS_FLAGS: u32 = 0x2000_0000;
const RESOURCE_VERSION: u32 = 2;
const STRINGS_BLOCK: u32 = 0x10;
const BOX_BYTES: usize = 64;
const MAP_BYTES: usize = 512;

const MSG_NO_BOX: &str = "Карта модификатора: нужна хотя бы одна коробка.";
const MSG_MANY_BOXES: &str = "Карта модификатора: коробок больше 65535.";
const MSG_HUGE: &str = "Карта модификатора больше самой большой страницы.";
const MSG_LONG_TEXT: &str = "Карта модификатора: строка длиннее 65535 байт.";

/// Где что лежит в теле: смещения до строк постоянны, после коробок всё сдвигается на их число.
struct Layout {
    boxes: usize,
    strings_len: usize,
}

impl Layout {
    const PAGES: usize = 0x70;
    const STRUCTS: usize = 0x480;
    const RECORDS: usize = 0x540;
    const BLOCKS: usize = 0x960;
    const MAP: usize = 0x990;
    const BOXES: usize = 0xb90;
    /// Блок `CBlockDesc` внутри `CMapData` и смещения трёх его строковых полей.
    const DESC: usize = 440;
    const DESC_TEXTS: [usize; 3] = [8, 24, 56];

    fn new(boxes: usize, texts: &[&str; 3]) -> Layout {
        Layout { boxes, strings_len: texts.iter().map(|text| text.len() + 1).sum() }
    }

    fn strings(&self) -> usize {
        Self::BOXES + BOX_BYTES * self.boxes
    }

    /// Наименьшая страница `0x2000 << s`, в которую всё помещается.
    fn page(&self) -> Option<usize> {
        let used = self.strings() + self.strings_len;
        (0..16).map(|shift| 0x2000usize << shift).find(|&page| page >= used)
    }
}

/// Указатель внутри блока данных: номер блока с единицы и смещение в нём.
fn data_pointer(block: u64, offset: usize) -> u64 {
    block | (offset as u64) << 12
}

/// Строитель тела ресурса: каждый шаг пишет свою часть, всё не записанное остаётся нулём.
struct Builder {
    bytes: Vec<u8>,
    layout: Layout,
}

impl Builder {
    fn new(layout: Layout, page: usize) -> Builder {
        Builder { bytes: vec![0; page], layout }
    }

    fn put(&mut self, at: usize, data: &[u8]) -> &mut Self {
        self.bytes[at..at + data.len()].copy_from_slice(data);
        self
    }

    fn u16(&mut self, at: usize, value: u16) -> &mut Self {
        self.put(at, &value.to_le_bytes())
    }

    fn u32(&mut self, at: usize, value: u32) -> &mut Self {
        self.put(at, &value.to_le_bytes())
    }

    fn u64(&mut self, at: usize, value: u64) -> &mut Self {
        self.put(at, &value.to_le_bytes())
    }

    fn system_pointer(&mut self, at: usize, target: usize) -> &mut Self {
        self.u64(at, SYSTEM_BASE + target as u64)
    }

    fn vec3(&mut self, at: usize, value: [f32; 3]) -> &mut Self {
        let packed: Vec<u8> = value.iter().flat_map(|part| part.to_le_bytes()).collect();
        self.put(at, &packed)
    }

    /// Заголовок Meta и блок страниц.
    fn header(&mut self, struct_count: usize) -> &mut Self {
        self.u32(0, META_VTABLE).u32(4, 1).system_pointer(8, Layout::PAGES);
        self.u32(16, META_MAGIC).u16(20, 0x79).u32(28, 1);
        self.system_pointer(32, Layout::STRUCTS).system_pointer(48, Layout::BLOCKS);
        self.u16(72, struct_count as u16).u16(76, 3);
        // Одна системная страница.
        self.put(Layout::PAGES + 8, &[1])
    }

    /// Таблица структур и их записи.
    fn schema(&mut self, defs: &[StructDef]) -> &mut Self {
        let mut records_at = Layout::RECORDS;
        for (k, def) in defs.iter().enumerate() {
            let row = Layout::STRUCTS + 32 * k;
            self.u32(row, def.name).u32(row + 4, def.key).u32(row + 8, def.unk8);
            self.system_pointer(row + 16, records_at).u32(row + 24, def.size);
            self.u16(row + 30, def.records.len() as u16);
            for (i, record) in def.records.iter().enumerate() {
                let at = records_at + 16 * i;
                self.u32(at, record.name).u32(at + 4, record.offset);
                self.put(at + 8, &[record.dtype as u8, record.unk9]);
                self.put(at + 10, &record.described.to_le_bytes()).u32(at + 12, record.key);
            }
            records_at += 16 * def.records.len();
        }
        self
    }

    /// Таблица блоков: карта, коробки, строки.
    fn block_table(&mut self) -> &mut Self {
        let blocks = [
            (meta_name("CMapData"), MAP_BYTES, Layout::MAP),
            (meta_name("CTimeCycleModifier"), BOX_BYTES * self.layout.boxes, Layout::BOXES),
            (STRINGS_BLOCK, self.layout.strings_len, self.layout.strings()),
        ];
        for (k, (name, size, at)) in blocks.into_iter().enumerate() {
            let row = Layout::BLOCKS + 16 * k;
            self.u32(row, name).u32(row + 4, size as u32).system_pointer(row + 8, at);
        }
        self
    }

    /// `CMapData`: имя, рамки, ссылка на коробки.
    fn map_data(&mut self, name: &str, extents: &Extents) -> &mut Self {
        let count = self.layout.boxes as u16;
        self.u32(Layout::MAP + 8, meta_name(name));
        let frames = [
            (32, extents.streaming_min),
            (48, extents.streaming_max),
            (64, extents.entities_min),
            (80, extents.entities_max),
        ];
        for (offset, frame) in frames {
            self.vec3(Layout::MAP + offset, frame);
        }
        self.u64(Layout::MAP + 224, data_pointer(2, 0));
        self.u16(Layout::MAP + 232, count).u16(Layout::MAP + 234, count)
    }

    /// Строки подряд; блок описания ссылается на каждую и хранит её длину (u16, длиннее 65535 байт строки отклоняются раньше).
    fn strings(&mut self, texts: &[&str; 3]) -> &mut Self {
        let base = self.layout.strings();
        let mut at = base;
        for (text, field) in texts.iter().zip(Layout::DESC_TEXTS) {
            self.put(at, text.as_bytes());
            let desc = Layout::MAP + Layout::DESC + field;
            let length = text.len() as u16;
            self.u64(desc, data_pointer(3, at - base)).u16(desc + 8, length).u16(desc + 10, length);
            at += text.len() + 1;
        }
        self
    }

    fn boxes(&mut self, boxes: &[TimeCycleBox]) -> &mut Self {
        for (k, one) in boxes.iter().enumerate() {
            let at = Layout::BOXES + BOX_BYTES * k;
            // Имя модификатора сводится к нижнему регистру только по ASCII.
            self.u32(at + 8, meta_name(&one.modifier.to_ascii_lowercase()));
            self.vec3(at + 16, one.min).vec3(at + 32, one.max);
            self.put(at + 48, &one.percentage.to_le_bytes()).put(at + 52, &one.range.to_le_bytes());
            self.u32(at + 56, one.start_hour).u32(at + 60, one.end_hour);
        }
        self
    }

    /// Файл целиком: заголовок RSC7 и сжатая системная страница.
    fn finish(&self) -> Vec<u8> {
        let page = self.bytes.len();
        let system_flags = 0x0800_0000 | (page.trailing_zeros() - 9);
        let mut file: Vec<u8> = [RSC7_MAGIC, RESOURCE_VERSION, system_flags, GRAPHICS_FLAGS]
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect();
        debug_assert_eq!(file.len(), HEADER_BYTES);
        file.extend(miniz_oxide::deflate::compress_to_vec(&self.bytes, 6));
        file
    }
}

/// Карта с одним осмысленным блоком — коробками модификатора таймцикла.
pub fn timecycle_map(
    name: &str,
    extents: Extents,
    boxes: &[TimeCycleBox],
    exported_by: &str,
    time: &str,
) -> Result<Vec<u8>> {
    if boxes.is_empty() {
        return Err(Error::argument(MSG_NO_BOX));
    }
    if boxes.len() > usize::from(u16::MAX) {
        return Err(Error::argument(MSG_MANY_BOXES));
    }
    let texts = [name, exported_by, time];
    if texts.iter().any(|text| text.len() > usize::from(u16::MAX)) {
        return Err(Error::argument(MSG_LONG_TEXT));
    }
    let layout = Layout::new(boxes.len(), &texts);
    let page = layout.page().ok_or_else(|| Error::argument(MSG_HUGE))?;

    let defs = parse_schema();
    let mut builder = Builder::new(layout, page);
    builder
        .header(defs.len())
        .schema(&defs)
        .block_table()
        .map_data(name, &extents)
        .strings(&texts)
        .boxes(boxes);
    Ok(builder.finish())
}

// ---------------------------------------------------------------------------
// Огни LOD на месте.
// ---------------------------------------------------------------------------

/// Столбец SOA-структуры: где искать массив и сколько байт на огонь.
struct Column {
    soa: &'static str,
    array: &'static str,
    stride: usize,
}

const FALLOFF: Column = Column { soa: "LODLightsSOA", array: "falloff", stride: 4 };
const EXPONENT: Column = Column { soa: "LODLightsSOA", array: "falloffExponent", stride: 4 };
const CORONA: Column = Column { soa: "LODLightsSOA", array: "coronaIntensity", stride: 1 };
const COLOURS: Column = Column { soa: "DistantLODLightsSOA", array: "RGBI", stride: 4 };

/// В каком из двух файлов пары лежит столбец; число — место в массиве сторон.
#[derive(Clone, Copy)]
enum Half {
    Lod = 0,
    Distant = 1,
}

/// Что записать в ячейку: готовые байты или слово `RGBI` с заменёнными частями.
enum Payload {
    Raw(Vec<u8>),
    Recolour { intensity: Option<u8>, colour: Option<[u8; 3]> },
}

/// Место элемента в теле файла.
struct Spot {
    in_body: usize,
}

/// Файл пары: исходное чтение (значения «до правок») и тело, которое правится.
struct Side {
    read: Read,
    resource: Resource,
}

impl Side {
    fn open(read: Read, bytes: &[u8]) -> Result<Side> {
        Ok(Side { read, resource: Resource::parse(bytes)? })
    }

    fn locate(&self, column: &Column, index: usize) -> Result<Spot> {
        let found = mlo::soa_array(&self.read, column.soa, column.array)?;
        let Some((node, count)) = found.filter(|&(_, count)| count > 0) else {
            return Err(Error::broken(format!("В карте нет массива {}.", column.array)));
        };
        if index >= count {
            return Err(Error::broken(format!("Огонь {index} вне массива {}.", column.array)));
        }
        let origin = self
            .read
            .origins
            .get(node)
            .copied()
            .flatten()
            .ok_or_else(|| Error::broken("Узел огней вне тела файла."))?;
        let in_node = index * column.stride;
        if in_node + column.stride > self.read.graph.nodes[node].bytes.len() {
            return Err(Error::broken("Элемент огня вне узла."));
        }
        let in_body = origin + in_node;
        if in_body + column.stride > self.resource.data().len() {
            return Err(Error::broken("Элемент огня вне тела файла."));
        }
        Ok(Spot { in_body })
    }

    /// Слово `RGBI` огня, каким оно лежит в теле сейчас: прежние правки этого огня уже в нём.
    fn current_word(&self, index: usize) -> Result<u32> {
        let spot = self.locate(&COLOURS, index)?;
        let four = self
            .resource
            .data()
            .get(spot.in_body..spot.in_body + 4)
            .ok_or_else(|| Error::broken("Элемент огня вне тела файла."))?;
        let four: [u8; 4] = four.try_into().map_err(|_| Error::broken("Элемент огня: четыре байта."))?;
        Ok(u32::from_le_bytes(four))
    }

    fn apply(&mut self, column: &Column, index: usize, payload: Payload) -> Result<()> {
        let bytes = match payload {
            Payload::Raw(bytes) => bytes,
            Payload::Recolour { intensity, colour } => {
                recolour(self.current_word(index)?, intensity, colour).to_le_bytes().to_vec()
            }
        };
        let spot = self.locate(column, index)?;
        self.resource.data_mut()[spot.in_body..spot.in_body + bytes.len()].copy_from_slice(&bytes);
        Ok(())
    }
}

/// Цвет и интенсивность в слове `RGBI`: старший байт — интенсивность, ниже красный, зелёный, синий.
fn recolour(word: u32, intensity: Option<u8>, colour: Option<[u8; 3]>) -> u32 {
    let [r, g, b] = colour.unwrap_or([(word >> 16) as u8, (word >> 8) as u8, word as u8]);
    let top = intensity.unwrap_or((word >> 24) as u8);
    u32::from_be_bytes([top, r, g, b])
}

/// Поля правки по порядку применения: в какой файл, в какой столбец и что писать.
fn edit_rows(edit: &LodEdit) -> [(Half, &'static Column, Option<Payload>); 4] {
    let float = |value: f32| Payload::Raw(value.to_le_bytes().to_vec());
    let touches_colour = edit.intensity.is_some() || edit.colour.is_some();
    [
        (Half::Lod, &FALLOFF, edit.falloff.map(float)),
        (Half::Lod, &EXPONENT, edit.falloff_exponent.map(float)),
        (Half::Lod, &CORONA, edit.corona_intensity.map(|value| Payload::Raw(vec![value]))),
        (
            Half::Distant,
            &COLOURS,
            touches_colour.then_some(Payload::Recolour { intensity: edit.intensity, colour: edit.colour }),
        ),
    ]
}

/// Правит значения огней LOD в паре карт (`lodlights_*` и `distlodlights_*`), размер тел не меняется.
pub fn edit_lod_pair(lod: &[u8], distant: &[u8], edits: &[LodEdit]) -> Result<(Vec<u8>, Vec<u8>)> {
    let lod_read = meta_graph::read(lod)?;
    let distant_read = meta_graph::read(distant)?;
    let mut sides = [Side::open(lod_read, lod)?, Side::open(distant_read, distant)?];

    for edit in edits {
        for (half, column, payload) in edit_rows(edit) {
            if let Some(payload) = payload {
                sides[half as usize].apply(column, edit.index, payload)?;
            }
        }
    }
    let [lod_side, distant_side] = sides;
    Ok((lod_side.resource.to_file_bytes()?, distant_side.resource.to_file_bytes()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use crate::meta_graph::{Link, Node};
    use crate::resource::deflate_zlib9;

    fn extents() -> Extents {
        Extents {
            streaming_min: [-40.0, -50.0, -30.0],
            streaming_max: [40.0, 50.0, 35.0],
            entities_min: [-10.0, -20.0, 0.0],
            entities_max: [10.0, 20.0, 5.0],
        }
    }

    fn tc_box(modifier: &str) -> TimeCycleBox {
        TimeCycleBox {
            modifier: modifier.to_string(),
            min: [-10.0, -20.0, 0.0],
            max: [10.0, 20.0, 5.0],
            percentage: 80.0,
            range: 30.0,
            start_hour: 6,
            end_hour: 18,
        }
    }

    fn typical() -> Vec<u8> {
        timecycle_map("ymap_tc", extents(), &[tc_box("TcBox")], "Astral", "06 October 2026 00:00").unwrap()
    }

    fn u32_at(data: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(data[at..at + 4].try_into().unwrap())
    }

    fn u16_at(data: &[u8], at: usize) -> u16 {
        u16::from_le_bytes(data[at..at + 2].try_into().unwrap())
    }

    fn broken(result: Result<(Vec<u8>, Vec<u8>)>) -> String {
        let error = result.unwrap_err();
        assert_eq!(error.kind, Kind::Broken);
        error.message
    }

    #[test]
    fn meta_names_match_the_codewalker_values() {
        let table = [
            ("CMapData", 3_545_841_574),
            ("minExtents", 1_731_020_657),
            ("CTimeCycleModifier", 1_733_268_304),
            ("CBlockDesc", 3_072_355_914),
            ("CLODLight", 2_276_214_072),
            ("CDistantLODLight", 2_033_467_892),
            ("rage__fwInstancedMapData", 4_048_164_286),
        ];
        for (text, hash) in table {
            assert_eq!(meta_name(text), hash, "{text}");
        }
    }

    #[test]
    fn meta_names_keep_the_case() {
        assert_eq!(meta_name(""), 0);
        assert_eq!(meta_name("\0"), 0);
        assert_eq!(meta_name("a"), 3_392_050_242);
        assert_eq!(meta_name("A"), 2_181_104_624);
        assert_eq!(meta_name("Карта"), 2_961_506_358);
        assert_eq!(meta_name(&"x".repeat(100)), 514_203_068);
    }

    #[test]
    fn a_timecycle_map_opens_and_keeps_its_box() {
        let file = typical();
        let resource = Resource::parse(&file).unwrap();
        assert_eq!(resource.header.version, 2);
        assert_eq!(resource.header.system_flags, 0x0800_0004);
        assert_eq!(resource.header.graphics_flags, 0x2000_0000);
        assert!(resource.root().is_some());
        assert_eq!(u32_at(resource.data(), 0), 0x405b_c808);
        assert_eq!(resource.data().len() % 0x2000, 0);
    }

    #[test]
    fn a_timecycle_map_has_the_documented_bytes() {
        let file = typical();
        assert_eq!(file.len(), 828);
        assert_eq!(
            sha256_hex(&file),
            "cbb63dde7e40af9d4d6f0e16fe078e66ff575417b8ae6f1cf79da13c22cd553b"
        );
        let body = Resource::parse(&file).unwrap();
        assert_eq!(
            sha256_hex(body.data()),
            "8d6fe492b7da567628946e6485759c18a3cea6acc2c78313cf209c80af889063"
        );
        assert_eq!(file[16..], miniz_oxide::deflate::compress_to_vec(body.data(), 6)[..]);
        assert_eq!(typical(), file);
    }

    #[test]
    fn a_timecycle_map_reads_back_as_a_graph() {
        let read = meta_graph::read(&typical()).unwrap();
        assert_eq!(read.schema.structs.len(), 6);
        assert!(read.schema.enums.is_empty());
        assert_eq!(read.graph.nodes.len(), 2);
        assert_eq!(read.graph.nodes[read.graph.root].bytes.len(), 512);
        assert_eq!(read.origins[1], Some(0xb90));
        assert_eq!(read.strings(), ["ymap_tc", "Astral", "06 October 2026 00:00"]);
    }

    #[test]
    fn a_timecycle_map_needs_a_box() {
        let error = timecycle_map("ymap_tc", extents(), &[], "Astral", "t").unwrap_err();
        assert_eq!(error.kind, Kind::Argument);
        assert_eq!(error.message, MSG_NO_BOX);
    }

    #[test]
    fn too_many_boxes_are_refused_and_the_limit_is_allowed() {
        let boxes = vec![tc_box("x"); 65_536];
        let error = timecycle_map("m", extents(), &boxes, "e", "t").unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (Kind::Argument, MSG_MANY_BOXES));
        let file = timecycle_map("m", extents(), &boxes[..65_535], "e", "t").unwrap();
        let resource = Resource::parse(&file).unwrap();
        assert_eq!(resource.header.system_flags, 0x0800_000e);
        assert_eq!(resource.header.system_size, 0x80_0000);
    }

    #[test]
    fn modifier_hashes_fold_only_ascii_case() {
        let hash_of = |modifier: &str| {
            let file = timecycle_map("m", extents(), &[tc_box(modifier)], "e", "t").unwrap();
            u32_at(Resource::parse(&file).unwrap().data(), Layout::BOXES + 8)
        };
        assert_eq!(hash_of("TcBox"), 1_139_625_236);
        assert_eq!(hash_of("tcbox"), 1_139_625_236);
        assert_eq!(hash_of("SOME_MODIFIER"), 958_566_171);
        assert_eq!(hash_of("ÄÖ"), 1_336_483_834);
        assert_eq!(hash_of("Ёж"), 1_976_517_047);
    }

    #[test]
    fn the_page_grows_with_the_used_size() {
        let flags_for = |name_len: usize, boxes: usize| {
            let list = vec![tc_box("x"); boxes];
            let file = timecycle_map(&"n".repeat(name_len), extents(), &list, "e", "t").unwrap();
            Resource::parse(&file).unwrap().header.system_flags
        };
        assert_eq!(flags_for(5163, 1), 0x0800_0004);
        assert_eq!(flags_for(5164, 1), 0x0800_0005);
        assert_eq!(flags_for(5099, 2), 0x0800_0004);
        assert_eq!(flags_for(5100, 2), 0x0800_0005);
        assert_eq!(flags_for(1, 1000), 0x0800_0008);
        assert_eq!(flags_for(1, 5000), 0x0800_000a);
    }

    #[test]
    fn strings_longer_than_sixteen_bits_are_refused_and_the_longest_fit_is_kept() {
        let refusal = "Карта модификатора: строка длиннее 65535 байт.";
        let long = "n".repeat(65_536);
        for (name, by, time) in [(&long[..], "e", "t"), ("n", &long[..], "t"), ("n", "e", &long[..])] {
            let refused = timecycle_map(name, extents(), &[tc_box("x")], by, time).unwrap_err();
            assert_eq!((refused.kind, refused.message.as_str()), (Kind::Argument, refusal));
        }
        let longest = "n".repeat(65_535);
        let file = timecycle_map(&longest, extents(), &[tc_box("x")], "e", "t").unwrap();
        let data = Resource::parse(&file).unwrap();
        assert_eq!(u16_at(data.data(), Layout::MAP + Layout::DESC + 16), 65_535);
    }

    #[test]
    fn odd_floats_are_written_as_they_are() {
        let odd = TimeCycleBox {
            modifier: "a".into(),
            min: [0.0, -0.0, f32::NAN],
            max: [f32::INFINITY, f32::NEG_INFINITY, f32::MIN_POSITIVE],
            percentage: f32::NAN,
            range: -1.5,
            start_hour: u32::MAX,
            end_hour: 25,
        };
        let file = timecycle_map("m3", extents(), &[odd], "e", "t").unwrap();
        let resource = Resource::parse(&file).unwrap();
        let data = resource.data();
        let at = Layout::BOXES;
        assert_eq!(data[at + 16..at + 28], [0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0, 0xc0, 0x7f]);
        assert_eq!(data[at + 32..at + 44], [0, 0, 0x80, 0x7f, 0, 0, 0x80, 0xff, 0, 0, 0x80, 0]);
        assert_eq!(data[at + 56..at + 64], [0xff, 0xff, 0xff, 0xff, 25, 0, 0, 0]);
    }

    #[test]
    fn an_empty_text_map_is_small_and_fixed() {
        let file = timecycle_map("", extents(), &[tc_box("")], "", "").unwrap();
        assert_eq!(file.len(), 769);
        assert_eq!(
            sha256_hex(&file),
            "4662f6c732925813ee7b81df9068cc467e3481d9a8733908f775df2f8bcbf08a"
        );
    }

    // --- правка огней на синтетической паре ---

    const ARRAYS_BLOCK: u32 = 0x7777_0001;

    fn floats(list: &[f32]) -> Vec<u8> {
        list.iter().flat_map(|x| x.to_le_bytes()).collect()
    }

    fn words(list: &[u32]) -> Vec<u8> {
        list.iter().flat_map(|x| x.to_le_bytes()).collect()
    }

    fn attach(graph: &mut meta_graph::Graph, at: usize, count: usize, bytes: Vec<u8>) {
        let id = graph.push(Node { block: ARRAYS_BLOCK, bytes, links: Vec::new() });
        let root = graph.root;
        graph.nodes[root].bytes[at + 8..at + 10].copy_from_slice(&(count as u16).to_le_bytes());
        graph.nodes[root].bytes[at + 10..at + 12].copy_from_slice(&(count as u16).to_le_bytes());
        graph.nodes[root].links.push(Link { at, target: Some(id) });
    }

    /// Три огня: у `lod` массивы огней, у `distant` — `RGBI`.
    fn pair(with_arrays: bool) -> (Vec<u8>, Vec<u8>) {
        let seed = TimeCycleBox { min: [0.0; 3], max: [1.0; 3], percentage: 1.0, range: 1.0, start_hour: 0, end_hour: 24, ..tc_box("x") };
        let base = timecycle_map("lod_syn", extents(), &[seed], "Astral", "t").unwrap();
        let read = meta_graph::read(&base).unwrap();
        let mut lod = read.graph.clone();
        let root = lod.root;
        lod.nodes[root].links.clear();
        lod.nodes[root].bytes[232..236].fill(0);
        lod.nodes[root].bytes[440..512].fill(0);
        let mut distant = lod.clone();
        if with_arrays {
            attach(&mut lod, 280, 3, floats(&[10.0, 20.0, 30.0]));
            attach(&mut lod, 296, 3, floats(&[1.0, 2.0, 3.0]));
            attach(&mut lod, 312, 3, words(&[0x100, 0x101, 0x102]));
            attach(&mut lod, 328, 3, words(&[0xAAAA_0000, 0xAAAA_0001, 0xAAAA_0002]));
            attach(&mut lod, 344, 3, vec![5, 6, 7]);
            attach(&mut lod, 360, 3, vec![50, 51, 52]);
            attach(&mut lod, 376, 3, vec![10, 20, 30]);
            attach(&mut distant, 416, 3, words(&[0xFF10_2030, 0x80AA_BBCC, 0]));
        }
        (
            meta_graph::write(&read.schema, &lod).unwrap(),
            meta_graph::write(&read.schema, &distant).unwrap(),
        )
    }

    fn body(file: &[u8]) -> Vec<u8> {
        Resource::parse(file).unwrap().data().to_vec()
    }

    fn falloffs(file: &[u8]) -> Vec<f32> {
        let read = meta_graph::read(file).unwrap();
        let (node, count) = mlo::soa_array(&read, "LODLightsSOA", "falloff").unwrap().unwrap();
        read.graph.nodes[node].bytes[..count * 4]
            .chunks(4)
            .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
            .collect()
    }

    fn rgbi(file: &[u8]) -> Vec<u32> {
        let read = meta_graph::read(file).unwrap();
        let (node, count) = mlo::soa_array(&read, "DistantLODLightsSOA", "RGBI").unwrap().unwrap();
        read.graph.nodes[node].bytes[..count * 4]
            .chunks(4)
            .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
            .collect()
    }

    fn edit(index: usize) -> LodEdit {
        LodEdit { index, ..LodEdit::default() }
    }

    #[test]
    fn an_edit_without_changes_keeps_the_body_and_swaps_the_compression() {
        let (lod, distant) = pair(true);
        let (new_lod, new_distant) = edit_lod_pair(&lod, &distant, &[]).unwrap();
        assert_eq!(body(&new_lod), body(&lod));
        assert_eq!(body(&new_distant), body(&distant));
        assert_eq!(new_lod[..16], lod[..16]);
        assert_eq!(new_lod[16..], deflate_zlib9(&body(&lod))[..]);
    }

    #[test]
    fn single_fields_land_in_their_arrays() {
        let (lod, distant) = pair(true);
        let one = |change: LodEdit| edit_lod_pair(&lod, &distant, &[change]).unwrap();

        let (new_lod, _) = one(LodEdit { falloff: Some(7.5), ..edit(1) });
        assert_eq!(falloffs(&new_lod), [10.0, 7.5, 30.0]);

        let (new_lod, _) = one(LodEdit { corona_intensity: Some(99), ..edit(0) });
        let read = meta_graph::read(&new_lod).unwrap();
        let (node, _) = mlo::soa_array(&read, "LODLightsSOA", "coronaIntensity").unwrap().unwrap();
        assert_eq!(read.graph.nodes[node].bytes[..3], [99, 20, 30]);

        let (_, new_distant) = one(LodEdit { intensity: Some(0x10), ..edit(0) });
        assert_eq!(rgbi(&new_distant), [0x1010_2030, 0x80AA_BBCC, 0]);

        let (_, new_distant) = one(LodEdit { colour: Some([1, 2, 3]), ..edit(1) });
        assert_eq!(rgbi(&new_distant), [0xFF10_2030, 0x8001_0203, 0]);
    }

    #[test]
    fn two_edits_of_one_light_accumulate_in_rgbi() {
        let (lod, distant) = pair(true);
        let run = |edits: &[LodEdit]| rgbi(&edit_lod_pair(&lod, &distant, edits).unwrap().1)[0];
        let colour = LodEdit { colour: Some([1, 2, 3]), ..edit(0) };
        let intensity = LodEdit { intensity: Some(9), ..edit(0) };
        assert_eq!(run(&[colour.clone(), intensity.clone()]), 0x0901_0203);
        assert_eq!(run(&[intensity, colour.clone()]), 0x0901_0203);
        let both = LodEdit { intensity: Some(9), ..colour };
        assert_eq!(run(&[both]), 0x0901_0203);
    }

    #[test]
    fn indexes_are_checked_per_array() {
        let (lod, distant) = pair(true);
        let run = |change: LodEdit| broken(edit_lod_pair(&lod, &distant, &[change]));
        assert_eq!(run(LodEdit { falloff: Some(1.0), ..edit(3) }), "Огонь 3 вне массива falloff.");
        assert_eq!(
            run(LodEdit { falloff_exponent: Some(1.0), ..edit(100) }),
            "Огонь 100 вне массива falloffExponent."
        );
        assert_eq!(
            run(LodEdit { corona_intensity: Some(1), ..edit(3) }),
            "Огонь 3 вне массива coronaIntensity."
        );
        assert_eq!(run(LodEdit { colour: Some([1; 3]), ..edit(3) }), "Огонь 3 вне массива RGBI.");
        assert_eq!(
            run(LodEdit { falloff: Some(1.0), ..edit(usize::MAX) }),
            "Огонь 18446744073709551615 вне массива falloff."
        );
        // Пустая правка индекс не проверяет.
        assert!(edit_lod_pair(&lod, &distant, &[edit(999)]).is_ok());
        // Ошибка в любой правке отменяет весь вызов.
        let good = LodEdit { falloff: Some(1.0), ..edit(0) };
        let bad = LodEdit { falloff: Some(1.0), ..edit(7) };
        assert_eq!(broken(edit_lod_pair(&lod, &distant, &[good, bad])), "Огонь 7 вне массива falloff.");
    }

    #[test]
    fn missing_arrays_are_reported_by_name() {
        let (lod, distant) = pair(false);
        let run = |change: LodEdit| broken(edit_lod_pair(&lod, &distant, &[change]));
        assert_eq!(run(LodEdit { falloff: Some(1.0), ..edit(0) }), "В карте нет массива falloff.");
        assert_eq!(
            run(LodEdit { falloff_exponent: Some(1.0), ..edit(0) }),
            "В карте нет массива falloffExponent."
        );
        assert_eq!(
            run(LodEdit { corona_intensity: Some(1), ..edit(0) }),
            "В карте нет массива coronaIntensity."
        );
        assert_eq!(run(LodEdit { intensity: Some(1), ..edit(0) }), "В карте нет массива RGBI.");
        assert!(edit_lod_pair(&lod, &distant, &[]).is_ok());
    }

    #[test]
    fn garbage_inputs_report_the_reader_errors() {
        let (lod, distant) = pair(true);
        assert_eq!(broken(edit_lod_pair(&[1, 2, 3], &distant, &[])), "Ресурс короче заголовка RSC7.");
        assert_eq!(broken(edit_lod_pair(&[0; 32], &distant, &[])), "Файл не является ресурсом RSC7.");
        assert_eq!(broken(edit_lod_pair(&lod[..40], &distant, &[])), "Чтение за концом данных ресурса.");
        let mut with_tail = lod.clone();
        with_tail.extend_from_slice(&[0xee; 5]);
        let clean = edit_lod_pair(&lod, &distant, &[]).unwrap();
        assert_eq!(edit_lod_pair(&with_tail, &distant, &[]).unwrap(), clean);
    }
}
