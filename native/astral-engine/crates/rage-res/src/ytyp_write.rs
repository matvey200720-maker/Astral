//! Файл типов `.ytyp` из базовых архетипов (`CBaseArchetypeDef`): запись и чтение.
//!
//! Контейнер RSC7 версии 2, одна системная страница 0x2000, графической области
//! нет. Форма узкая: без расширений, временных и MLO-архетипов, составных типов
//! и зависимостей. Всё, что шире, читатель отклоняет словами, а не пропускает.

use crate::{
    error::{Error, Result},
    resource::{Resource, SYSTEM_BASE},
    ymap_write::meta_name,
};

/// Рисуемый тип ассета (значение перечисления `eAssetType`).
pub const ASSET_TYPE_DRAWABLE: i32 = 2;

// ---------------------------------------------------------------- устройство формата

/// Размеры частей страницы.
mod space {
    pub const PAGE: usize = 0x2000;
    pub const HEAD: usize = 112;
    pub const PAGE_BLOCK: usize = 1040;
    pub const ROOT: usize = 80;
    pub const RECORD: usize = 144;
    /// Блоки данных: корень, архетипы, указатели на архетипы.
    pub const BLOCKS: usize = 3;
    pub const ENUM_DESC: usize = 32;
    pub const ENUM_VALUES: usize = 48;
}

/// Смещения в заголовке Meta.
mod meta_at {
    pub const VFT: usize = 0x00;
    pub const VERSION: usize = 0x04;
    pub const PAGES: usize = 0x08;
    pub const MAGIC: usize = 0x10;
    pub const MARK: usize = 0x14;
    pub const ROOT_NO: usize = 0x1c;
    pub const STRUCTS: usize = 0x20;
    pub const ENUMS: usize = 0x28;
    pub const TABLE: usize = 0x30;
    pub const STRUCT_COUNT: usize = 0x48;
    pub const ENUM_COUNT: usize = 0x4a;
    pub const BLOCK_COUNT: usize = 0x4c;
}

/// Смещения в корне `CMapTypes` и в записи `CBaseArchetypeDef`.
mod at {
    pub mod root {
        pub const EXTENSIONS_COUNT: usize = 16;
        pub const ARRAY: usize = 24;
        pub const COUNT: usize = 32;
        pub const CAPACITY: usize = 34;
        pub const NAME: usize = 40;
        pub const COMPOSITES_COUNT: usize = 72;
    }
    pub mod record {
        pub const EXTENSIONS_COUNT: usize = 128;
    }
}

/// Метки и ключи формата.
mod tag {
    pub const VFT: u32 = 0x405b_c808;
    pub const MAGIC: u32 = 0x5052_4430;
    pub const MARK: u16 = 0x79;
    /// Хеш «инфо массива» в таблице полей — просто число.
    pub const ARRAY_INFO: u32 = 0x100;
    /// Тип блока «блок указателей» в таблице блоков — тоже число.
    pub const POINTER_BLOCK: u32 = 7;
    pub const ENUM_KEY: u32 = 0x6f39_632c;
}

/// Типы данных записи поля.
mod dtype {
    pub const HASH: u8 = 0x4a;
    pub const STRUCT: u8 = 0x05;
    pub const POINTER: u8 = 0x07;
    pub const ARRAY: u8 = 0x52;
    pub const U32: u8 = 0x15;
    pub const F32: u8 = 0x21;
    pub const VEC3: u8 = 0x33;
    pub const ENUM: u8 = 0x62;
}

/// Слова отказов.
mod words {
    pub const EMPTY_LIST: &str = "Файл типов нужен хотя бы с одним архетипом.";
    pub const TOO_BIG: &str = "Файл типов больше одной страницы: на несколько страниц пока не пишется.";
    pub const NO_ROOT: &str = "Файл типов без корня.";
    pub const NO_BLOCK_TABLE: &str = "Файл типов без таблицы блоков.";
    pub const NO_BLOCK_ADDRESS: &str = "Блок типов без адреса.";
    pub const ROOT_NOT_MAP_TYPES: &str = "Корень файла типов — не CMapTypes.";
    pub const NO_ARRAY: &str = "Файл типов без массива архетипов.";
    pub const NO_ARCHETYPE_BLOCK: &str = "Указатель архетипа без блока.";
    pub const ROOT_EXTENDED: &str = "Файл типов с расширениями или составными типами пока не читается.";
    pub const NOT_BASE_ARCHETYPE: &str = "В файле типов есть не базовый архетип (временной или MLO): пока не читается.";
    pub const ARCHETYPE_EXTENDED: &str = "Архетип с расширениями пока не переносится.";
}

// ---------------------------------------------------------------- архетип

/// Базовый архетип: значения ложатся в файл как есть, без проверок.
#[derive(Debug, Clone, PartialEq)]
pub struct BaseArchetype {
    pub name: u32,
    pub asset_name: u32,
    pub lod_dist: f32,
    pub flags: u32,
    pub special_attribute: u32,
    pub bb_min: [f32; 3],
    pub bb_max: [f32; 3],
    pub bs_centre: [f32; 3],
    pub bs_radius: f32,
    pub hd_texture_dist: f32,
    pub texture_dictionary: u32,
    pub clip_dictionary: u32,
    pub drawable_dictionary: u32,
    pub physics_dictionary: u32,
    pub asset_type: i32,
}

impl BaseArchetype {
    /// Архетип с типовыми значениями; имена хешируются без приведения регистра.
    pub fn with_defaults(name: &str, asset: &str) -> Self {
        BaseArchetype {
            name: meta_name(name),
            asset_name: meta_name(asset),
            lod_dist: 60.0,
            flags: 0,
            special_attribute: 0,
            bb_min: [0.0; 3],
            bb_max: [0.0; 3],
            bs_centre: [0.0; 3],
            bs_radius: 0.0,
            hd_texture_dist: 15.0,
            texture_dictionary: 0,
            clip_dictionary: 0,
            drawable_dictionary: 0,
            physics_dictionary: 0,
            asset_type: ASSET_TYPE_DRAWABLE,
        }
    }
}

/// Поле записи как 32-разрядное слово: одно и то же значение читается и пишется побитово.
trait Bits {
    fn bits(&self) -> u32;
    fn set_bits(&mut self, raw: u32);
}

impl Bits for u32 {
    fn bits(&self) -> u32 {
        *self
    }
    fn set_bits(&mut self, raw: u32) {
        *self = raw;
    }
}

impl Bits for i32 {
    fn bits(&self) -> u32 {
        *self as u32
    }
    fn set_bits(&mut self, raw: u32) {
        *self = raw as i32;
    }
}

impl Bits for f32 {
    fn bits(&self) -> u32 {
        self.to_bits()
    }
    fn set_bits(&mut self, raw: u32) {
        *self = f32::from_bits(raw);
    }
}

type Project = fn(&mut BaseArchetype) -> &mut dyn Bits;

/// Описатель записи `CBaseArchetypeDef`: смещение слова и поле структуры, которое в нём лежит.
/// По нему идут и запись, и чтение.
const WORDS: [(usize, Project); 21] = [
    (8, |a| &mut a.lod_dist),
    (12, |a| &mut a.flags),
    (16, |a| &mut a.special_attribute),
    (32, |a| &mut a.bb_min[0]),
    (36, |a| &mut a.bb_min[1]),
    (40, |a| &mut a.bb_min[2]),
    (48, |a| &mut a.bb_max[0]),
    (52, |a| &mut a.bb_max[1]),
    (56, |a| &mut a.bb_max[2]),
    (64, |a| &mut a.bs_centre[0]),
    (68, |a| &mut a.bs_centre[1]),
    (72, |a| &mut a.bs_centre[2]),
    (80, |a| &mut a.bs_radius),
    (84, |a| &mut a.hd_texture_dist),
    (88, |a| &mut a.name),
    (92, |a| &mut a.texture_dictionary),
    (96, |a| &mut a.clip_dictionary),
    (100, |a| &mut a.drawable_dictionary),
    (104, |a| &mut a.physics_dictionary),
    (108, |a| &mut a.asset_type),
    (112, |a| &mut a.asset_name),
];

// ---------------------------------------------------------------- таблицы структур и перечисления

/// Строка таблицы полей: имя («» — служебная запись массива), смещение,
/// тип данных, номер записи типа элементов, ключ типа.
struct Row {
    name: &'static str,
    offset: i32,
    kind: u8,
    link: u16,
    key: u32,
}

impl Row {
    const fn plain(name: &'static str, offset: i32, kind: u8) -> Row {
        Row { name, offset, kind, link: 0, key: 0 }
    }

    /// Массив, чьи элементы описаны записью `link` этой же структуры.
    const fn array(name: &'static str, offset: i32, link: u16) -> Row {
        Row { name, offset, kind: dtype::ARRAY, link, key: 0 }
    }

    /// Запись «инфо массива»: тип элементов и, для составных, ключ типа.
    const fn info(kind: u8, key: u32) -> Row {
        Row { name: "", offset: 0, kind, link: 0, key }
    }

    fn hash(&self) -> u32 {
        if self.name.is_empty() {
            tag::ARRAY_INFO
        } else {
            meta_name(self.name)
        }
    }
}

struct StructDef {
    name: &'static str,
    key: u32,
    unk8: u32,
    size: i32,
    rows: &'static [Row],
}

const MAP_TYPES_ROWS: &[Row] = &[
    Row::info(dtype::POINTER, 0),
    Row::array("extensions", 8, 0),
    Row::info(dtype::POINTER, 0),
    Row::array("archetypes", 24, 2),
    Row::plain("name", 40, dtype::HASH),
    Row::info(dtype::HASH, 0),
    Row::array("dependencies", 48, 5),
    Row::info(dtype::STRUCT, 0x46ad_6dff),
    Row::array("compositeEntityTypes", 64, 7),
];

const BASE_ARCHETYPE_ROWS: &[Row] = &[
    Row::plain("lodDist", 8, dtype::F32),
    Row::plain("flags", 12, dtype::U32),
    Row::plain("specialAttribute", 16, dtype::U32),
    Row::plain("bbMin", 32, dtype::VEC3),
    Row::plain("bbMax", 48, dtype::VEC3),
    Row::plain("bsCentre", 64, dtype::VEC3),
    Row::plain("bsRadius", 80, dtype::F32),
    Row::plain("hdTextureDist", 84, dtype::F32),
    Row::plain("name", 88, dtype::HASH),
    Row::plain("textureDictionary", 92, dtype::HASH),
    Row::plain("clipDictionary", 96, dtype::HASH),
    Row::plain("drawableDictionary", 100, dtype::HASH),
    Row::plain("physicsDictionary", 104, dtype::HASH),
    Row { name: "assetType", offset: 108, kind: dtype::ENUM, link: 0, key: 0x76ba_f7c7 },
    Row::plain("assetName", 112, dtype::HASH),
    Row::info(dtype::POINTER, 0),
    Row::array("extensions", 120, 15),
];

const STRUCTS: [StructDef; 2] = [
    StructDef { name: "CMapTypes", key: 0x9b80_46d4, unk8: 768, size: 80, rows: MAP_TYPES_ROWS },
    StructDef { name: "CBaseArchetypeDef", key: 0x8fba_daa4, unk8: 1024, size: 144, rows: BASE_ARCHETYPE_ROWS },
];

const ENUM_NAME: &str = "rage__fwArchetypeDef__eAssetType";
const ENUM_VALUES: [(&str, i32); 5] = [
    ("ASSET_TYPE_UNINITIALIZED", 0),
    ("ASSET_TYPE_FRAGMENT", 1),
    ("ASSET_TYPE_DRAWABLE", 2),
    ("ASSET_TYPE_DRAWABLEDICTIONARY", 3),
    ("ASSET_TYPE_ASSETLESS", 4),
];

// ---------------------------------------------------------------- запись

/// Указатель «блок | смещение << 12» на данные внутри блока таблицы блоков.
fn packed(block_no: u64, offset: usize) -> u64 {
    block_no | (offset as u64) << 12
}

fn round16(len: usize) -> usize {
    len.next_multiple_of(16)
}

/// Куда в страницу что лечь: части файла идут друг за другом.
struct Floor {
    struct_table: usize,
    struct_rows: [usize; 2],
    enum_desc: usize,
    enum_values: usize,
    blocks: usize,
    root: usize,
    archetypes: usize,
    pointers: usize,
    end: usize,
}

impl Floor {
    fn plan(count: usize) -> Floor {
        let mut top = space::HEAD + space::PAGE_BLOCK;
        let mut take = |len: usize| {
            top += len;
            top - len
        };
        let struct_table = take(32 * STRUCTS.len());
        let struct_rows = STRUCTS.each_ref().map(|def| take(16 * def.rows.len()));
        let enum_desc = take(space::ENUM_DESC);
        let enum_values = take(space::ENUM_VALUES);
        let blocks = take(16 * space::BLOCKS);
        let root = take(space::ROOT);
        let archetypes = take(space::RECORD * count);
        let pointers = take(round16(8 * count));
        Floor { struct_table, struct_rows, enum_desc, enum_values, blocks, root, archetypes, pointers, end: top }
    }
}

/// Одна запись числа в страницу.
enum Op {
    Half(usize, u16),
    Word(usize, u32),
    Long(usize, u64),
    /// Указатель на место внутри этой же области.
    Link(usize, usize),
}

struct Page(Vec<u8>);

impl Page {
    fn apply(&mut self, op: &Op) {
        let (at, bytes) = match *op {
            Op::Half(at, v) => (at, v.to_le_bytes().to_vec()),
            Op::Word(at, v) => (at, v.to_le_bytes().to_vec()),
            Op::Long(at, v) => (at, v.to_le_bytes().to_vec()),
            Op::Link(at, target) => (at, (SYSTEM_BASE + target as u64).to_le_bytes().to_vec()),
        };
        self.0[at..at + bytes.len()].copy_from_slice(&bytes);
    }
}

fn header_ops(floor: &Floor) -> Vec<Op> {
    use meta_at as m;
    vec![
        Op::Word(m::VFT, tag::VFT),
        Op::Word(m::VERSION, 1),
        Op::Link(m::PAGES, space::HEAD),
        Op::Word(m::MAGIC, tag::MAGIC),
        Op::Half(m::MARK, tag::MARK),
        Op::Word(m::ROOT_NO, 1),
        Op::Link(m::STRUCTS, floor.struct_table),
        Op::Link(m::ENUMS, floor.enum_desc),
        Op::Link(m::TABLE, floor.blocks),
        Op::Half(m::STRUCT_COUNT, STRUCTS.len() as u16),
        Op::Half(m::ENUM_COUNT, 1),
        Op::Half(m::BLOCK_COUNT, space::BLOCKS as u16),
        // Страничный блок: одна страница.
        Op::Word(space::HEAD + 8, 1),
    ]
}

fn struct_ops(floor: &Floor) -> Vec<Op> {
    STRUCTS
        .iter()
        .enumerate()
        .flat_map(|(i, def)| {
            let row = floor.struct_table + 32 * i;
            let rows_at = floor.struct_rows[i];
            let head = [
                Op::Word(row, meta_name(def.name)),
                Op::Word(row + 4, def.key),
                Op::Word(row + 8, def.unk8),
                Op::Link(row + 16, rows_at),
                Op::Word(row + 24, def.size as u32),
                Op::Half(row + 30, def.rows.len() as u16),
            ];
            let fields = def.rows.iter().enumerate().flat_map(move |(k, field)| {
                let at = rows_at + 16 * k;
                [
                    Op::Word(at, field.hash()),
                    Op::Word(at + 4, field.offset as u32),
                    Op::Half(at + 8, u16::from(field.kind)),
                    Op::Half(at + 10, field.link),
                    Op::Word(at + 12, field.key),
                ]
            });
            head.into_iter().chain(fields)
        })
        .collect()
}

fn enum_ops(floor: &Floor) -> Vec<Op> {
    let desc = floor.enum_desc;
    let head = [
        Op::Word(desc, meta_name(ENUM_NAME)),
        Op::Word(desc + 4, tag::ENUM_KEY),
        Op::Link(desc + 8, floor.enum_values),
        Op::Word(desc + 16, ENUM_VALUES.len() as u32),
    ];
    let values = ENUM_VALUES.iter().enumerate().flat_map(|(i, &(name, value))| {
        let at = floor.enum_values + 8 * i;
        [Op::Word(at, meta_name(name)), Op::Word(at + 4, value as u32)]
    });
    head.into_iter().chain(values).collect()
}

fn block_ops(floor: &Floor, count: usize) -> Vec<Op> {
    let rows = [
        (meta_name("CMapTypes"), space::ROOT, floor.root),
        (meta_name("CBaseArchetypeDef"), space::RECORD * count, floor.archetypes),
        (tag::POINTER_BLOCK, round16(8 * count), floor.pointers),
    ];
    rows.iter()
        .enumerate()
        .flat_map(|(i, &(name, len, at))| {
            let row = floor.blocks + 16 * i;
            [Op::Word(row, name), Op::Word(row + 4, len as u32), Op::Link(row + 8, at)]
        })
        .collect()
}

fn root_ops(floor: &Floor, name_hash: u32, count: usize) -> Vec<Op> {
    // Массив архетипов лежит в третьем блоке (блок указателей), со смещения 0.
    vec![
        Op::Long(floor.root + at::root::ARRAY, packed(3, 0)),
        Op::Half(floor.root + at::root::COUNT, count as u16),
        Op::Half(floor.root + at::root::CAPACITY, count as u16),
        Op::Word(floor.root + at::root::NAME, name_hash),
    ]
}

fn record_ops(floor: &Floor, archetypes: &[BaseArchetype]) -> Vec<Op> {
    let mut ops = Vec::with_capacity(archetypes.len() * (WORDS.len() + 1));
    for (i, item) in archetypes.iter().enumerate() {
        let record = floor.archetypes + space::RECORD * i;
        let mut copy = item.clone();
        ops.extend(WORDS.iter().map(|&(offset, project)| Op::Word(record + offset, project(&mut copy).bits())));
        // Адрес записи — во втором блоке (блок архетипов).
        ops.push(Op::Long(floor.pointers + 8 * i, packed(2, space::RECORD * i)));
    }
    ops
}

/// Заголовок RSC7 (версия 2, одна системная страница, графики нет) и сжатая область.
fn container(area: &[u8]) -> Vec<u8> {
    let mut file: Vec<u8> = [0x3743_5352u32, 2, 0x0800_0004, 0x2000_0000].iter().flat_map(|word| word.to_le_bytes()).collect();
    file.extend(miniz_oxide::deflate::compress_to_vec(area, 6));
    file
}

/// Собирает файл `.ytyp` из хеша имени файла и списка базовых архетипов.
pub fn base_types(name_hash: u32, archetypes: &[BaseArchetype]) -> Result<Vec<u8>> {
    if archetypes.is_empty() {
        return Err(Error::argument(words::EMPTY_LIST));
    }
    let count = archetypes.len();
    let floor = Floor::plan(count);
    if floor.end > space::PAGE {
        return Err(Error::argument(words::TOO_BIG));
    }
    let program = [
        header_ops(&floor),
        struct_ops(&floor),
        enum_ops(&floor),
        block_ops(&floor, count),
        root_ops(&floor, name_hash, count),
        record_ops(&floor, archetypes),
    ];
    let mut page = Page(vec![0u8; space::PAGE]);
    program.iter().flatten().for_each(|op| page.apply(op));
    Ok(container(&page.0))
}

// ---------------------------------------------------------------- чтение

/// Прочитанный файл типов: хеш имени файла и базовые архетипы по порядку.
#[derive(Debug, Clone, PartialEq)]
pub struct TypesFile {
    pub name_hash: u32,
    pub archetypes: Vec<BaseArchetype>,
}

/// Отказать вызывающего, если условие не выполнено.
fn demand(holds: bool, otherwise: impl FnOnce() -> Error) -> Result<()> {
    if holds {
        Ok(())
    } else {
        Err(otherwise())
    }
}

/// Блок данных: хеш имени его типа и адрес в распакованной области.
struct Block {
    kind: u32,
    at: usize,
}

/// Файл с таблицей блоков данных: по номеру (с единицы) отдаёт тип блока и адрес.
struct Ledger {
    res: Resource,
    table: usize,
}

impl Ledger {
    /// Файл разобран, номер корня не нулевой, таблица блоков на месте; следом — блок корня.
    fn open(bytes: &[u8]) -> Result<(Ledger, Block)> {
        let res = Resource::parse(bytes)?;
        let root_no = res.u32(meta_at::ROOT_NO)?;
        demand(root_no != 0, || Error::broken(words::NO_ROOT))?;
        let table = res.at(res.u64(meta_at::TABLE)?).ok_or_else(|| Error::broken(words::NO_BLOCK_TABLE))?;
        let ledger = Ledger { res, table };
        let root = ledger.block(root_no)?;
        Ok((ledger, root))
    }

    fn block(&self, number: u32) -> Result<Block> {
        let row = self.table.saturating_add(16 * (number as usize).saturating_sub(1));
        let kind = self.res.u32(row)?;
        let at = self.res.at(self.res.u64(row + 8)?).ok_or_else(|| Error::broken(words::NO_BLOCK_ADDRESS))?;
        Ok(Block { kind, at })
    }

    /// Упакованный указатель «блок | смещение << 12»: блок по номеру и адрес со сдвигом.
    /// Номер 0 отказывает словами `none`.
    fn resolve(&self, packed: u64, none: &str) -> Result<Block> {
        let (number, shift) = (packed & 0xfff, packed >> 12);
        demand(number != 0, || Error::broken(none))?;
        let home = self.block(number as u32)?;
        Ok(Block { kind: home.kind, at: home.at.saturating_add(shift as usize) })
    }

    fn archetype(&self, slot: usize) -> Result<BaseArchetype> {
        let home = self.resolve(self.res.u64(slot)?, words::NO_ARCHETYPE_BLOCK)?;
        demand(home.kind == meta_name("CBaseArchetypeDef"), || Error::argument(words::NOT_BASE_ARCHETYPE))?;
        let extensions = self.res.u16(home.at.saturating_add(at::record::EXTENSIONS_COUNT))?;
        demand(extensions == 0, || Error::argument(words::ARCHETYPE_EXTENDED))?;
        let mut item = BaseArchetype::with_defaults("", "");
        for &(offset, project) in &WORDS {
            project(&mut item).set_bits(self.res.u32(home.at.saturating_add(offset))?);
        }
        Ok(item)
    }
}

/// Разбирает файл `.ytyp` с базовыми архетипами (свой и хоста).
pub fn read_base_types(bytes: &[u8]) -> Result<TypesFile> {
    let (ledger, root) = Ledger::open(bytes)?;
    let res = &ledger.res;
    demand(root.kind == meta_name("CMapTypes"), || Error::broken(words::ROOT_NOT_MAP_TYPES))?;
    let plain = res.u16(root.at + at::root::EXTENSIONS_COUNT)? == 0 && res.u16(root.at + at::root::COMPOSITES_COUNT)? == 0;
    demand(plain, || Error::argument(words::ROOT_EXTENDED))?;

    let name_hash = res.u32(root.at + at::root::NAME)?;
    let count = usize::from(res.u16(root.at + at::root::COUNT)?);
    let array = ledger.resolve(res.u64(root.at + at::root::ARRAY)?, words::NO_ARRAY)?;
    let archetypes = (0..count).map(|i| ledger.archetype(array.at.saturating_add(8 * i))).collect::<Result<Vec<_>>>()?;
    Ok(TypesFile { name_hash, archetypes })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;

    fn source(prefix: &str) -> Vec<BaseArchetype> {
        (0..3)
            .map(|i| {
                let letter = ["a", "b", "c"][i];
                let mut item = BaseArchetype::with_defaults(
                    &format!("{prefix}_{letter}"),
                    &format!("{prefix}_{letter}_asset"),
                );
                item.lod_dist = 100.0 + i as f32;
                item.bb_min = [-1.0, -2.0, -3.0 - i as f32];
                item.bb_max = [1.0, 2.0, 3.0];
                item.bs_radius = 4.5;
                item.texture_dictionary = meta_name(&format!("{prefix}_txd"));
                item.drawable_dictionary = meta_name(&format!("{prefix}_ydd"));
                item.physics_dictionary = if i == 1 { meta_name("phys") } else { 0 };
                item
            })
            .collect()
    }

    /// Файл с правкой распакованной области: (смещение, новые байты).
    fn patched(file: &[u8], edits: &[(usize, &[u8])]) -> Vec<u8> {
        let mut res = Resource::parse(file).unwrap();
        for (at, bytes) in edits {
            res.data_mut()[*at..*at + bytes.len()].copy_from_slice(bytes);
        }
        res.to_file_bytes().unwrap()
    }

    fn refusal(result: Result<TypesFile>) -> (Kind, String) {
        let e = result.unwrap_err();
        (e.kind, e.message)
    }

    #[test]
    fn a_types_file_reads_back_to_the_same_archetypes() {
        let items = source("src");
        let file = base_types(meta_name("src_types"), &items).unwrap();
        let back = read_base_types(&file).unwrap();
        assert_eq!(back.name_hash, meta_name("src_types"));
        assert_eq!(back.archetypes, items);
    }

    #[test]
    fn a_types_file_reads_back_with_a_single_archetype() {
        let one = vec![source("src").remove(0)];
        let file = base_types(meta_name("one_types"), &one).unwrap();
        assert_eq!(read_base_types(&file).unwrap().archetypes, one);
    }

    #[test]
    fn a_types_file_refuses_a_non_types_file() {
        assert!(read_base_types(&[0u8; 64]).is_err());
    }

    #[test]
    fn a_types_file_parses_with_its_archetypes() {
        let file = base_types(meta_name("src_types"), &source("src")).unwrap();
        let res = Resource::parse(&file).unwrap();
        let data = res.data();
        assert_eq!(res.root(), Some(0));
        assert_eq!(res.u32(0).unwrap(), 0x405b_c808);
        let table = (res.u64(0x30).unwrap() - SYSTEM_BASE) as usize;
        let root = (res.u64(table + 8).unwrap() - SYSTEM_BASE) as usize;
        assert_eq!(res.u32(root + 40).unwrap(), meta_name("src_types"));
        assert_eq!(data.len(), space::PAGE);
    }

    #[test]
    fn defaults_hash_names_case_sensitively() {
        let d = BaseArchetype::with_defaults("a", "a_asset");
        assert_eq!((d.name, d.asset_name), (0xca2e_9442, 0x78cf_88dd));
        assert_eq!((d.lod_dist, d.hd_texture_dist, d.asset_type), (60.0, 15.0, ASSET_TYPE_DRAWABLE));
        let upper = BaseArchetype::with_defaults("A", "a");
        assert_eq!((upper.name, upper.asset_name), (0x8201_03f0, 0xca2e_9442));
        let empty = BaseArchetype::with_defaults("", "");
        assert_eq!((empty.name, empty.asset_name), (0, 0));
    }

    #[test]
    fn a_three_archetype_file_has_fixed_bytes() {
        let file = base_types(meta_name("src_types"), &source("src")).unwrap();
        assert_eq!(file.len(), 559);
        assert_eq!(
            sha256_hex(&file),
            "393b4537a20db9c65813d4d8d68b6b19bc899e27340cd4b27bed6bd72af39988"
        );
        assert_eq!(&file[..16], &[0x52, 0x53, 0x43, 0x37, 2, 0, 0, 0, 4, 0, 0, 8, 0, 0, 0, 0x20]);
        let area = Resource::parse(&file).unwrap().data().to_vec();
        assert_eq!(
            sha256_hex(&area),
            "55fd65e4f385c814d470b262b92955233290e6391b0bbd621d2ea84b76b42fac"
        );
        // Указатели на архетипы: блок 2, смещение 144 * номер.
        let table = 0x6b0;
        assert_eq!(&area[table + 40..table + 44], &[0xe0, 0x08, 0x00, 0x50]);
        let ptr = |i: usize| u64::from_le_bytes(area[0x8e0 + 8 * i..0x8e8 + 8 * i].try_into().unwrap());
        assert_eq!([ptr(0), ptr(1), ptr(2)], [0x2, 0x90002, 0x120002]);
    }

    #[test]
    fn a_file_holds_up_to_forty_one_archetypes() {
        let make = |n: usize| -> Vec<BaseArchetype> {
            (0..n).map(|i| BaseArchetype::with_defaults(&format!("n{i}"), &format!("n{i}_asset"))).collect()
        };
        let too_big = "Файл типов больше одной страницы: на несколько страниц пока не пишется.";
        for n in [1usize, 2, 40, 41] {
            let items = make(n);
            let file = base_types(1, &items).unwrap();
            assert_eq!(read_base_types(&file).unwrap().archetypes, items, "n = {n}");
        }
        for n in [42usize, 43, 114, 115, 1000] {
            let e = base_types(1, &make(n)).unwrap_err();
            assert_eq!((e.kind, e.message.as_str()), (Kind::Argument, too_big), "n = {n}");
        }
        let e = base_types(1, &[]).unwrap_err();
        assert_eq!(e.message, "Файл типов нужен хотя бы с одним архетипом.");
    }

    #[test]
    fn odd_float_and_integer_values_survive_bit_for_bit() {
        let mut w = BaseArchetype::with_defaults("w", "w_asset");
        w.lod_dist = f32::NAN;
        w.flags = u32::MAX;
        w.bb_min = [f32::NEG_INFINITY, -0.0, f32::MIN];
        w.bs_centre = [1e-45, -1e-45, 3.5];
        w.bs_radius = -1.0;
        w.drawable_dictionary = 0x8000_0000;
        w.asset_type = i32::MIN;
        let file = base_types(u32::MAX, std::slice::from_ref(&w)).unwrap();
        let back = read_base_types(&file).unwrap();
        assert_eq!(back.name_hash, u32::MAX);
        let got = &back.archetypes[0];
        assert_eq!(got.lod_dist.to_bits(), 0x7fc0_0000);
        assert_eq!(got.bb_min.map(f32::to_bits), [4286578688, 2147483648, 4286578687]);
        assert_eq!(got.bs_centre.map(f32::to_bits), [1, 2147483649, 1080033280]);
        assert_eq!(got.asset_type, i32::MIN);
        // NaN не равен самому себе, поэтому и записи не равны.
        assert_ne!(got, &w);
    }

    #[test]
    fn broken_files_are_refused_with_their_own_words() {
        let file = base_types(meta_name("src_types"), &source("src")).unwrap();
        let (root, arch, ptrs) = (0x6e0, 0x730, 0x8e0);
        let argument = |text: &str| (Kind::Argument, text.to_string());
        let broken = |text: &str| (Kind::Broken, text.to_string());

        assert_eq!(refusal(read_base_types(&patched(&file, &[(28, &0u32.to_le_bytes())]))), broken(words::NO_ROOT));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(28, &2u32.to_le_bytes())]))), broken(words::ROOT_NOT_MAP_TYPES));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(28, &9u32.to_le_bytes())]))), broken(words::NO_BLOCK_ADDRESS));
        assert_eq!(
            refusal(read_base_types(&patched(&file, &[(28, &u32::MAX.to_le_bytes())]))),
            broken("Чтение за концом данных ресурса.")
        );
        assert_eq!(refusal(read_base_types(&patched(&file, &[(0x30, &[0u8; 8])]))), broken(words::NO_BLOCK_TABLE));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(root + 16, &[1, 0])]))), argument(words::ROOT_EXTENDED));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(root + 72, &[1, 0])]))), argument(words::ROOT_EXTENDED));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(root + 24, &[0u8; 8])]))), broken(words::NO_ARRAY));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(root + 32, &4u16.to_le_bytes())]))), broken(words::NO_ARCHETYPE_BLOCK));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(ptrs, &3u64.to_le_bytes())]))), argument(words::NOT_BASE_ARCHETYPE));
        assert_eq!(refusal(read_base_types(&patched(&file, &[(arch + 128, &[1, 0])]))), argument(words::ARCHETYPE_EXTENDED));

        // Эти поля читатель не смотрит.
        for edit in [(root + 34, &[0u8, 0][..]), (root + 8, &[0, 1, 0, 0x50, 0, 0, 0, 0][..]), (16, &[0u8; 4][..]), (0x20, &[0u8; 8][..])] {
            assert_eq!(read_base_types(&patched(&file, &[edit])).unwrap().archetypes.len(), 3);
        }
        // Файл другого вида (словарь текстур) корня не имеет.
        let ytd = crate::ytd_write::write(&[crate::ytd_write::NewTexture {
            name: "t".into(),
            width: 4,
            height: 4,
            format: crate::texture::Format::Dxt1,
            levels: 1,
            payload: vec![0; 8],
        }])
        .unwrap();
        assert_eq!(refusal(read_base_types(&ytd)), broken(words::NO_ROOT));
    }

    // ------------- проверки с файлами игры и хоста: без переменных выходят сразу

    use std::path::{Path, PathBuf};

    fn ytyp_files(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                ytyp_files(&path, out);
            } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("ytyp")) {
                out.push(path);
            }
        }
    }

    fn survey_list(var: &str) -> Vec<PathBuf> {
        let Ok(dir) = std::env::var(var) else { return Vec::new() };
        let mut files = Vec::new();
        ytyp_files(Path::new(&dir), &mut files);
        files.sort();
        files
    }

    #[test]
    #[ignore = "нужен каталог .ytyp игры: YTYP_SURVEY"]
    fn survey_types() {
        for path in survey_list("YTYP_SURVEY") {
            let shown = path.display();
            match std::fs::read(&path).map_err(Error::from).and_then(|b| read_base_types(&b)) {
                Ok(file) => println!("ok\t{}\t{shown}", file.archetypes.len()),
                Err(e) => println!("refused\t{e}\t{shown}"),
            }
        }
    }

    #[test]
    #[ignore = "нужен каталог .ytyp игры: YTYP_SURVEY"]
    fn survey_extensions() {
        use std::collections::BTreeMap;
        for path in survey_list("YTYP_SURVEY") {
            let Ok(bytes) = std::fs::read(&path) else { continue };
            let summary = || -> Result<(BTreeMap<u16, usize>, BTreeMap<u32, usize>)> {
                let (ledger, root) = Ledger::open(&bytes)?;
                let res = &ledger.res;
                let count = usize::from(res.u16(root.at + at::root::COUNT)?);
                let array = ledger.resolve(res.u64(root.at + at::root::ARRAY)?, words::NO_ARRAY)?;
                let (mut by_count, mut kinds) = (BTreeMap::new(), BTreeMap::new());
                for i in 0..count {
                    let record = ledger.resolve(res.u64(array.at + 8 * i)?, words::NO_ARCHETYPE_BLOCK)?;
                    let n = res.u16(record.at + at::record::EXTENSIONS_COUNT)?;
                    *by_count.entry(n).or_insert(0) += 1;
                    if n > 0 {
                        let list = ledger.resolve(res.u64(record.at + 120)?, "список расширений")?;
                        for k in 0..usize::from(n) {
                            let extension = ledger.resolve(res.u64(list.at + 8 * k)?, "расширение")?;
                            *kinds.entry(extension.kind).or_insert(0) += 1;
                        }
                    }
                }
                Ok((by_count, kinds))
            };
            match summary() {
                Ok((by_count, kinds)) => {
                    let counts: Vec<String> = by_count.iter().map(|(n, c)| format!("{c}x{n}")).collect();
                    let kinds: Vec<String> = kinds.iter().map(|(h, c)| format!("{h:#010x}x{c}")).collect();
                    println!("{}\tрасширения: [{}]\tтипы: [{}]", path.display(), counts.join(" "), kinds.join(" "));
                }
                Err(e) => println!("{}\tошибка: {e}", path.display()),
            }
        }
    }

    #[test]
    #[ignore = "нужен файл .ytyp: YTYP_DUMP"]
    fn dump_structs() {
        let Ok(path) = std::env::var("YTYP_DUMP") else { return };
        let bytes = std::fs::read(&path).unwrap();
        match read_base_types(&bytes) {
            Ok(file) => {
                println!("имя файла {:#010x}", file.name_hash);
                for item in &file.archetypes {
                    println!("{item:?}");
                }
            }
            Err(e) => println!("не читается: {e}"),
        }
        let res = Resource::parse(&bytes).unwrap();
        let table = (res.u64(0x30).unwrap() - SYSTEM_BASE) as usize;
        for i in 0..res.u16(0x4c).unwrap() as usize {
            let row = table + 16 * i;
            println!("блок {i}: имя {:#010x} длина {} адрес {:#x}", res.u32(row).unwrap(), res.u32(row + 4).unwrap(), res.u64(row + 8).unwrap());
        }
        let infos = (res.u64(0x20).unwrap() - SYSTEM_BASE) as usize;
        for s in 0..res.u16(0x48).unwrap() as usize {
            let row = infos + 32 * s;
            let fields = (res.u64(row + 16).unwrap() - SYSTEM_BASE) as usize;
            println!("структура {s}: имя {:#010x} размер {} полей {}", res.u32(row).unwrap(), res.u32(row + 24).unwrap(), res.u16(row + 30).unwrap());
            for k in 0..res.u16(row + 30).unwrap() as usize {
                let at = fields + 16 * k;
                println!(
                    "    поле {k}: имя {:#010x} смещение {} тип {:#04x} индекс {} ключ {:#010x}",
                    res.u32(at).unwrap(),
                    res.u32(at + 4).unwrap() as i32,
                    res.u8(at + 8).unwrap(),
                    res.u16(at + 10).unwrap(),
                    res.u32(at + 12).unwrap()
                );
            }
        }
    }

    #[test]
    #[ignore = "нужен файл .ytyp хоста: YTYP_READ"]
    fn read_host_ytyp() {
        let Ok(path) = std::env::var("YTYP_READ") else { return };
        let bytes = std::fs::read(&path).unwrap();
        println!("{:#?}", read_base_types(&bytes));
        let res = Resource::parse(&bytes).unwrap();
        std::fs::write(format!("{path}.system"), res.data()).unwrap();
    }

    #[test]
    #[ignore = "пишет файлы в каталог YTYP_DIR для сверки с хостом"]
    fn write_ytyp_host_check() {
        let Ok(dir) = std::env::var("YTYP_DIR") else { return };
        let dir = PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = base_types(meta_name("src_types"), &source("src")).unwrap();
        std::fs::write(dir.join("src.ytyp"), &src).unwrap();
        // Образец: те же параметры под именами copy_*, у copy_a свой словарь текстур.
        let mut copies = source("src");
        for (item, letter) in copies.iter_mut().zip(["a", "b", "c"]) {
            item.name = meta_name(&format!("copy_{letter}"));
            item.asset_name = meta_name(&format!("copy_{letter}_asset"));
        }
        copies[0].texture_dictionary = meta_name("copy_a_txd");
        let expected = base_types(meta_name("out_types"), &copies).unwrap();
        std::fs::write(dir.join("expected_out.ytyp"), &expected).unwrap();
    }
}
