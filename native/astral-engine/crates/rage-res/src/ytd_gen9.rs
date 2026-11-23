//! Словари текстур gen9 (GTA V Enhanced, ресурс версии 5): перевод из Legacy, чтение и проверка.
//!
//! Пиксели переходят как есть, служебные поля заполняются так, как их заполняет хост. Размещение в файле —
//! по порядку хешей и выравниванию 16; страницы раскладывает `resource_graph::pack_pages`.

use miniz_oxide::deflate::compress_to_vec;

use crate::{
    error::{Error, Result},
    hash::joaat,
    resource::{Resource, GRAPHICS_BASE, SYSTEM_BASE, VERSION_YTD, VERSION_YTD_ENHANCED},
    resource_graph::{pack_pages, sized, Pages, MAX_RESOURCE_PAGES},
    texture::Format,
    ytd_edit::{align16, first_refusal, offsets as root_at, require, rsc_file, sizes},
    ytd_write::{later_repeats, limit, read_entries, Entry, Fields, Image},
};

pub const TEXTURE_BYTES: usize = 0x80;
pub const COMPRESSION_LEVEL: u8 = 9;

// ---------------------------------------------------------------------------------------------
// Форматы и счёт блоков
// ---------------------------------------------------------------------------------------------

/// Код gen9 по формату Legacy; два формата Legacy делят один код.
const FORMAT_CODES: [(Format, u8); 11] = [
    (Format::Dxt1, 71),
    (Format::Dxt3, 74),
    (Format::Dxt5, 77),
    (Format::Ati1, 80),
    (Format::Ati2, 83),
    (Format::Bc7, 98),
    (Format::A8R8G8B8, 87),
    (Format::X8R8G8B8, 87),
    (Format::A8, 65),
    (Format::A8B8G8R8, 28),
    (Format::L8, 61),
];

fn code_of(format: Format) -> u8 {
    FORMAT_CODES
        .iter()
        .find(|(known, _)| *known == format)
        .map(|&(_, code)| code)
        .expect("все форматы Legacy есть в таблице")
}

/// Коды блочных форматов: блок покрывает 4 пикселя по строке.
const BLOCK_CODES: [u8; 7] = [71, 74, 77, 80, 83, 98, 99];

/// Байт на блок: группы кодов с одним размером. Остальным кодам достаётся 8.
const BLOCK_BYTES: [(&[u8], u32); 4] = [
    (&[71, 80], 8),
    (&[74, 77, 83, 98, 99], 16),
    (&[28, 87], 4),
    (&[65, 61], 1),
];

fn block_bytes(code: u8) -> u32 {
    BLOCK_BYTES
        .iter()
        .find(|(codes, _)| codes.contains(&code))
        .map_or(8, |&(_, bytes)| bytes)
}

pub fn is_block_compressed(format: u8) -> bool {
    BLOCK_CODES.contains(&format)
}

/// Пикселей по строке в одном блоке.
fn pixels_per_block(code: u8) -> u32 {
    if is_block_compressed(code) {
        4
    } else {
        1
    }
}

/// Ближайшая степень двойки не ниже `value`; выше 2^31 берётся наибольшее u32.
fn pow2_at_least(value: u32) -> u32 {
    value.checked_next_power_of_two().unwrap_or(u32::MAX)
}

/// Блоки всех ступеней по правилу gen9: при нескольких ступенях размеры округляются до степени двойки.
pub fn block_count(format: u8, width: u32, height: u32, depth: u32, mips: u32) -> u32 {
    let pixels = pixels_per_block(format);
    let start = |side: u32| if mips > 1 { pow2_at_least(side.max(1)) } else { side.max(1) };
    let (w, h, d) = (start(width), start(height), start(depth));
    let blocks_in = |side: u32| side.div_ceil(pixels).max(1);
    let halved = |side: u32, level: u32| side.checked_shr(level).unwrap_or(0).max(1);
    (0..mips).fold(0u32, |total, level| {
        let level_blocks = blocks_in(halved(w, level)).saturating_mul(blocks_in(halved(h, level))).saturating_mul(d);
        total.saturating_add(level_blocks)
    })
}

// ---------------------------------------------------------------------------------------------
// Перевод
// ---------------------------------------------------------------------------------------------

/// Раскладка системной области.
mod layout {
    use crate::ytd_edit::sizes;

    pub const MAP: usize = 1040;
    pub const FIRST_OBJECT: usize = sizes::ROOT + MAP;
    /// Встроенный блок SRV внутри объекта текстуры.
    pub const SRV: usize = 0x58;
    pub const SRV_VFT: u64 = 0x1_406b_77d8;
}

/// Поля объекта текстуры gen9.
mod field {
    pub const BLOCKS: usize = 0x08;
    pub const BLOCK_STRIDE: usize = 0x0C;
    pub const FLAGS: usize = 0x10;
    pub const WIDTH: usize = 0x18;
    pub const HEIGHT: usize = 0x1A;
    pub const DEPTH: usize = 0x1C;
    pub const DIMENSION: usize = 0x1E;
    pub const FORMAT: usize = 0x1F;
    pub const TILE_MODE: usize = 0x20;
    pub const LEVELS: usize = 0x22;
    pub const NAME: usize = super::root_at::OBJECT_NAME;
    pub const SRV: usize = 0x30;
    pub const DATA: usize = 0x38;
    pub const USAGE: usize = 0x40;
    pub const UNKNOWN_44: usize = 0x44;
}

/// Флаги обычной текстуры; цель скрипта (имя начинается с `script_rt_`) добавляет один бит.
const FLAGS_PLAIN: u32 = 0x0026_0208;
const SCRIPT_TARGET_BIT: u32 = 0x20;
const SCRIPT_TARGET_PREFIX: &[u8] = b"script_rt_";
/// Графические флаги gen9 несут версию 5 в старшем полубайте.
const GRAPHICS_TOP: u32 = VERSION_YTD_ENHANCED << 28;

/// Записи Legacy, упорядоченные по хешу, и то, как они лягут в файл gen9.
struct Conversion {
    entries: Vec<Entry>,
}

struct Plan {
    list: usize,
    hashes: usize,
    names: Vec<usize>,
    system: Pages,
    graphics: Pages,
}

impl Conversion {
    /// Записи словаря Legacy; `None`, если в корне нет ни одной текстуры.
    fn open(legacy: &[u8]) -> Result<Option<Conversion>> {
        let res = Resource::parse(legacy)?;
        let version = res.version();
        first_refusal([(
            version != VERSION_YTD,
            Error::version(format!("Это не словарь текстур Legacy (версия {version}).")),
        )])?;
        let root = require(res.root(), "Корень словаря текстур недоступен.")?;
        if res.u16(root + root_at::ROOT_LIST_COUNT)? == 0 {
            return Ok(None);
        }
        Conversion::new(read_entries(legacy)?).map(Some)
    }

    fn new(mut entries: Vec<Entry>) -> Result<Conversion> {
        first_refusal([(
            entries.is_empty() || entries.len() > limit::TEXTURES,
            Error::argument("A texture dictionary takes 1 to 4096 textures."),
        )])?;
        let repeats = later_repeats(entries.iter().map(|entry| entry.name.as_str()));
        if let Some(second) = repeats.iter().position(|&repeated| repeated) {
            return Err(Error::argument(format!(
                "Texture '{}' is listed twice (names are case-insensitive).",
                entries[second].name
            )));
        }
        // Блоки при нескольких ступенях считаются по размерам, округлённым до степени двойки, а данные Legacy
        // лежат без округления: такой словарь собрать нельзя, его отдают хосту.
        if let Some(odd) = entries.iter().find(|entry| {
            entry.levels > 1 && [entry.width, entry.height, entry.depth].iter().any(|&side| !side.max(1).is_power_of_two())
        }) {
            return Err(Error::argument(format!(
                "Текстура {}: {}x{}x{} при {} ступенях не степень двойки, такой словарь gen9 пока не собирается.",
                odd.name, odd.width, odd.height, odd.depth.max(1), odd.levels
            )));
        }
        entries.sort_by_cached_key(|entry| joaat(&entry.name));
        Ok(Conversion { entries })
    }

    /// Флаги объекта: обычные или у цели скрипта.
    fn flags_of(entry: &Entry) -> u32 {
        let name = entry.name.as_bytes();
        let script = name
            .get(..SCRIPT_TARGET_PREFIX.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(SCRIPT_TARGET_PREFIX));
        FLAGS_PLAIN | (SCRIPT_TARGET_BIT * u32::from(script))
    }

    /// Число блоков всех ступеней по правилу gen9; глубина берётся как записана (нуль считается за единицу).
    fn blocks_of(entry: &Entry) -> u32 {
        let dims = [entry.width, entry.height, entry.depth].map(u32::from);
        block_count(code_of(entry.format), dims[0], dims[1], dims[2], u32::from(entry.levels))
    }

    fn plan(&self) -> Result<Plan> {
        let count = self.entries.len();
        let list = layout::FIRST_OBJECT + TEXTURE_BYTES * count;
        let hashes = align16(list + 8 * count);
        let names_from = align16(hashes + 4 * count);
        let (names, names_end) = self.entries.iter().fold((Vec::new(), names_from), |(mut at, end), entry| {
            at.push(end);
            (at, align16(end + entry.name.len() + 1))
        });
        let system = pack_pages(&[names_end], 0, MAX_RESOURCE_PAGES)?;
        let chunks: Vec<usize> = self.entries.iter().map(|e| e.payload.len().max(1)).collect();
        let graphics = pack_pages(&chunks, GRAPHICS_TOP, MAX_RESOURCE_PAGES - system.count)?;
        Ok(Plan { list, hashes, names, system, graphics })
    }

    /// Объект текстуры gen9 по записи Legacy; указатели приходят готовыми.
    fn put_object(image: &mut Image, entry: &Entry, own: usize, name_at: usize, data_at: usize) {
        let code = code_of(entry.format);
        let legacy_usage = u32::from_le_bytes(entry.object[0x40..0x44].try_into().expect("четыре байта"));
        let srv_at = own + layout::SRV;

        // Числа: заголовок объекта.
        image.put32(own + 4, 1);
        image.put32(own + field::BLOCKS, Self::blocks_of(entry));
        image.put32(own + field::BLOCK_STRIDE, block_bytes(code));
        image.put32(own + field::FLAGS, Self::flags_of(entry));
        image.put16(own + field::WIDTH, entry.width);
        image.put16(own + field::HEIGHT, entry.height);
        image.put16(own + field::DEPTH, entry.depth);
        image.put(own + field::DIMENSION, &[1, code, 0xFF, 0, entry.levels, 0x28]);
        image.put16(own + 0x26, 1);
        image.put32(own + field::USAGE, legacy_usage & 0x1F);
        image.put32(own + field::UNKNOWN_44, 2);

        // Указатели на имя, встроенный SRV и данные.
        let pointers = [
            (field::NAME, SYSTEM_BASE + name_at as u64),
            (field::SRV, SYSTEM_BASE + srv_at as u64),
            (field::DATA, GRAPHICS_BASE + data_at as u64),
        ];
        pointers.iter().for_each(|&(at, value)| image.put64(own + at, value));

        // Встроенный SRV: таблица, размерность (3D у глубины больше 1) и две заглушки.
        image.put64(srv_at, layout::SRV_VFT);
        image.put16(srv_at + 0x10, if entry.depth > 1 { 0x61 } else { 0x41 });
        image.put16(srv_at + 0x12, 0xFFFF);
        image.put32(srv_at + 0x14, 0xFFFF_FFFF);
    }

    /// Тело файла: системная область, затем графическая.
    fn render(&self, plan: &Plan) -> Image {
        let graphics_at = plan.system.size;
        let mut image = Image::zeroed(graphics_at + plan.graphics.size);
        let count = self.entries.len() as u16;
        put_root(&mut image, (plan.system.count as u8, plan.graphics.count as u8));
        image.put64(root_at::ROOT_HASHES, SYSTEM_BASE + plan.hashes as u64);
        image.put64(root_at::ROOT_LIST, SYSTEM_BASE + plan.list as u64);
        for at in [0x28, 0x2A, root_at::ROOT_LIST_COUNT, root_at::ROOT_LIST_COUNT + 2] {
            image.put16(at, count);
        }
        for (slot, entry) in self.entries.iter().enumerate() {
            let own = layout::FIRST_OBJECT + TEXTURE_BYTES * slot;
            let data_at = plan.graphics.starts[slot];
            Self::put_object(&mut image, entry, own, plan.names[slot], data_at);
            image.put64(plan.list + 8 * slot, SYSTEM_BASE + own as u64);
            image.put32(plan.hashes + 4 * slot, joaat(&entry.name));
            image.put(plan.names[slot], entry.name.as_bytes());
            image.put(graphics_at + data_at, &entry.payload);
        }
        image
    }

    /// Готовый файл gen9, сжатый заданным уровнем.
    fn emit(&self, level: u8) -> Result<Vec<u8>> {
        let plan = self.plan()?;
        let packed = compress_to_vec(self.render(&plan).bytes(), level);
        Ok(rsc_file(VERSION_YTD_ENHANCED, plan.system.flags, plan.graphics.flags, packed))
    }
}

/// Корень и блок-карта; `pages` — число страниц системной и графической областей.
fn put_root(image: &mut Image, pages: (u8, u8)) {
    image.put32(4, 1);
    image.put64(root_at::ROOT_PAGES, SYSTEM_BASE + sizes::ROOT as u64);
    image.put32(0x18, 1);
    image.put(sizes::ROOT + 8, &[pages.0, pages.1]);
}

/// Словарь без текстур: корень и блок-карта, графической области нет.
fn empty_dictionary(level: u8) -> Result<Vec<u8>> {
    let (flags, size) = sized(layout::FIRST_OBJECT, 0)?;
    let mut image = Image::zeroed(size);
    put_root(&mut image, (1, 0));
    Ok(rsc_file(VERSION_YTD_ENHANCED, flags, GRAPHICS_TOP, compress_to_vec(image.bytes(), level)))
}

/// Словарь gen9 из словаря Legacy, сжатие уровня по умолчанию.
pub fn convert(legacy: &[u8]) -> Result<Vec<u8>> {
    convert_with_level(legacy, COMPRESSION_LEVEL)
}

pub fn convert_with_level(legacy: &[u8], level: u8) -> Result<Vec<u8>> {
    match Conversion::open(legacy)? {
        Some(conversion) => conversion.emit(level),
        None => empty_dictionary(level),
    }
}

// ---------------------------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Gen9Texture {
    pub name: String,
    pub width: u16,
    pub height: u16,
    pub depth: u16,
    pub dimension: u8,
    pub format: u8,
    pub tile_mode: u8,
    pub levels: u8,
    pub block_count: u32,
    pub block_stride: u32,
    pub flags: u32,
    pub usage: u32,
    pub unknown_44h: u32,
    pub srv_dimension: u16,
    pub payload: Vec<u8>,
}

/// Файл gen9 после разбора и проверки версии: список указателей на объекты текстур.
/// У пустого словаря сам список не проверяется.
struct Roster {
    res: Resource,
    at: usize,
    count: usize,
}

impl Roster {
    /// Разобранный файл с проверенной версией; список указателей ещё не читается.
    fn parsed(bytes: &[u8]) -> Result<Resource> {
        let res = Resource::parse(bytes)?;
        let version = res.version();
        first_refusal([(
            version != VERSION_YTD_ENHANCED,
            Error::version(format!("Это не словарь текстур gen9 (версия {version}).")),
        )])?;
        Ok(res)
    }

    fn open(bytes: &[u8]) -> Result<Roster> {
        Roster::of(Roster::parsed(bytes)?)
    }

    fn of(res: Resource) -> Result<Roster> {
        let root = require(res.root(), "Корень словаря текстур недоступен.")?;
        let list = res.pointer_list(root + root_at::ROOT_LIST)?;
        if list.count == 0 {
            return Ok(Roster { res, at: 0, count: 0 });
        }
        let at = require(res.at(list.entries), "Список текстур словаря недоступен.")?;
        Ok(Roster { res, at, count: usize::from(list.count) })
    }

    fn object(&self, slot: usize) -> Result<usize> {
        require(self.res.pointer_at(self.at + slot * 8), "Указатель на текстуру пуст.")
    }

    fn texture(&self, slot: usize) -> Result<Gen9Texture> {
        let res = &self.res;
        let f = Fields { res, at: self.object(slot)? };
        let name = require(res.cstring(f.u64(field::NAME)?), "У текстуры нет имени.")?;
        let (width, height, depth) = (f.u16(field::WIDTH)?, f.u16(field::HEIGHT)?, f.u16(field::DEPTH)?);
        let (dimension, format) = (f.u8(field::DIMENSION)?, f.u8(field::FORMAT)?);
        let (tile_mode, levels) = (f.u8(field::TILE_MODE)?, f.u8(field::LEVELS)?);
        let (blocks, block_stride) = (f.u32(field::BLOCKS)?, f.u32(field::BLOCK_STRIDE)?);
        let (flags, usage, unknown_44h) = (f.u32(field::FLAGS)?, f.u32(field::USAGE)?, f.u32(field::UNKNOWN_44)?);
        let srv = res
            .at(f.u64(field::SRV)?)
            .ok_or_else(|| Error::broken(format!("Текстура {name} без SRV.")))?;
        let data = res
            .at(f.u64(field::DATA)?)
            .ok_or_else(|| Error::broken(format!("Текстура {name} без данных.")))?;
        Ok(Gen9Texture {
            srv_dimension: res.u16(srv + 16)?,
            payload: res.bytes(data, blocks as usize * block_stride as usize)?.to_vec(),
            name,
            width,
            height,
            depth,
            dimension,
            format,
            tile_mode,
            levels,
            block_count: blocks,
            block_stride,
            flags,
            usage,
            unknown_44h,
        })
    }
}

/// Все текстуры словаря gen9 в порядке списка файла.
pub fn read_textures(bytes: &[u8]) -> Result<Vec<Gen9Texture>> {
    let roster = Roster::open(bytes)?;
    (0..roster.count).map(|slot| roster.texture(slot)).collect()
}

// ---------------------------------------------------------------------------------------------
// Проверка
// ---------------------------------------------------------------------------------------------

/// Указатель внутри области `[base, base + size)` и кратный 16.
fn lands_aligned(pointer: u64, base: u64, size: usize) -> bool {
    pointer
        .checked_sub(base)
        .is_some_and(|offset| offset < size as u64 && offset % 16 == 0)
}

/// Правило проверки объекта: нарушено ли оно, и текст отказа. Порядок правил — порядок проверок.
type ObjectRule = (fn(&Resource, usize) -> Result<bool>, &'static str);

const OBJECT_RULES: [ObjectRule; 5] = [
    (|_, object| Ok(object % 16 != 0), "Объект текстуры не выровнен по 16 байтам."),
    (
        |res, object| {
            let pointer = Fields { res, at: object }.u64(field::NAME)?;
            Ok(!lands_aligned(pointer, SYSTEM_BASE, res.header.system_size))
        },
        "Имя текстуры вне системной области или не выровнено.",
    ),
    (
        |res, object| {
            let pointer = Fields { res, at: object }.u64(field::SRV)?;
            Ok(pointer != SYSTEM_BASE + (object + layout::SRV) as u64)
        },
        "SRV текстуры не на месте встроенного блока.",
    ),
    (
        |res, object| {
            let pointer = Fields { res, at: object }.u64(field::DATA)?;
            Ok(!lands_aligned(pointer, GRAPHICS_BASE, res.header.graphics_size))
        },
        "Данные текстуры вне графической области или не выровнены.",
    ),
    (
        |res, object| {
            let f = Fields { res, at: object };
            let start = f.u64(field::DATA)?.saturating_sub(GRAPHICS_BASE);
            let bytes = u64::from(f.u32(field::BLOCKS)?) * u64::from(f.u32(field::BLOCK_STRIDE)?);
            Ok(start + bytes > res.header.graphics_size as u64)
        },
        "Данные текстуры выходят за графическую область.",
    ),
];

/// Проверка файла теми критериями, которыми проверяют выход перевода.
pub fn check(bytes: &[u8]) -> Result<()> {
    let res = Roster::parsed(bytes)?;
    first_refusal([(!res.complete, Error::broken("Словарь gen9 обрезан."))])?;
    let roster = Roster::of(res)?;
    for slot in 0..roster.count {
        let object = roster.object(slot)?;
        for (violated, text) in OBJECT_RULES {
            if violated(&roster.res, object)? {
                return Err(Error::broken(text));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use crate::ytd_write::{payload_bytes, write, NewTexture};

    /// Описание листа для испытаний.
    struct Sheet {
        name: String,
        side: u16,
        format: Format,
        levels: u8,
    }

    impl Sheet {
        fn texture(&self, seed: u8) -> NewTexture {
            let need = payload_bytes(self.format, usize::from(self.side), usize::from(self.side), usize::from(self.levels));
            NewTexture {
                name: self.name.clone(),
                width: self.side,
                height: self.side,
                format: self.format,
                levels: self.levels,
                payload: (0..need).map(|i| (i % 251) as u8 ^ seed).collect(),
            }
        }
    }

    fn legacy(sheets: &[Sheet]) -> Vec<u8> {
        let textures: Vec<NewTexture> = sheets.iter().enumerate().map(|(n, s)| s.texture(n as u8 * 17 + 3)).collect();
        write(&textures).unwrap()
    }

    fn sky_set() -> Vec<Sheet> {
        vec![
            Sheet { name: "sky_dome".into(), side: 64, format: Format::Dxt5, levels: 5 },
            Sheet { name: "script_rt_mirror".into(), side: 32, format: Format::A8R8G8B8, levels: 1 },
            Sheet { name: "ui_icon".into(), side: 16, format: Format::Dxt1, levels: 3 },
        ]
    }

    fn pick(list: &[Gen9Texture], name: &str) -> Gen9Texture {
        list.iter().find(|t| t.name == name).cloned().expect(name)
    }

    struct Shape {
        code: u8,
        size: [u32; 3],
        mips: u32,
        blocks: u32,
    }

    #[test]
    fn block_counts_over_shapes_grouped_by_format_family() {
        let shape = |code, size, mips, blocks| Shape { code, size, mips, blocks };
        let table = [
            // DXT1 (71): чистые степени двойки, не степени двойки, объёмные текстуры.
            shape(71, [128, 128, 1], 8, 1367),
            shape(71, [96, 96, 1], 2, 1280),
            shape(71, [96, 96, 1], 1, 576),
            shape(71, [4, 4, 1], 1, 1),
            shape(71, [1, 1, 1], 3, 3),
            shape(71, [5, 3, 1], 3, 4),
            shape(71, [32, 32, 4], 3, 336),
            shape(71, [32, 32, 3], 1, 192),
            shape(71, [3, 3, 3], 2, 8),
            shape(71, [2048, 2048, 1], 12, 349_527),
            // Нулевые размеры считаются единицей, нуль ступеней — нулём.
            shape(71, [0, 0, 0], 0, 0),
            shape(71, [0, 0, 0], 1, 1),
            shape(71, [0, 0, 0], 2, 2),
            // Остальные семейства: BC7 (99) похож на блочные, 28 и неизвестный 0 — по пикселю.
            shape(99, [128, 128, 1], 8, 1367),
            shape(28, [128, 128, 1], 8, 21845),
            shape(28, [5, 3, 1], 3, 42),
            shape(0, [128, 128, 1], 8, 21845),
        ];
        for Shape { code, size: [w, h, d], mips, blocks } in table {
            assert_eq!(block_count(code, w, h, d, mips), blocks, "код {code}, {w}x{h}x{d}, ступеней {mips}");
        }
        let wide = [
            (71, [1 << 31, 4, 1], 2, 805_306_368),
            (28, [u32::MAX, 1, 1], 1, u32::MAX),
            (28, [65535, 65535, 1], 1, 4_294_836_225),
            (71, [4, 4, 1], 40, 40),
        ];
        for (code, [w, h, d], mips, blocks) in wide {
            assert_eq!(block_count(code, w, h, d, mips), blocks);
        }
    }

    #[test]
    fn the_block_family_and_strides_follow_the_host_table() {
        let family: Vec<u8> = (0..=u8::MAX).filter(|&code| is_block_compressed(code)).collect();
        assert_eq!(family, BLOCK_CODES);
        let expected: [(u8, u32, u32); 12] = [
            (28, 4, 1),
            (61, 1, 1),
            (65, 1, 1),
            (71, 8, 4),
            (74, 16, 4),
            (77, 16, 4),
            (80, 8, 4),
            (83, 16, 4),
            (87, 4, 1),
            (98, 16, 4),
            (99, 16, 4),
            (3, 8, 1),
        ];
        for (code, stride, pixels) in expected {
            assert_eq!((block_bytes(code), pixels_per_block(code)), (stride, pixels), "код {code}");
        }
    }

    #[test]
    fn each_legacy_format_gets_its_gen9_code_and_keeps_its_bytes() {
        let wanted = [
            (Format::Dxt1, 71u8),
            (Format::Dxt3, 74),
            (Format::Dxt5, 77),
            (Format::Ati1, 80),
            (Format::Ati2, 83),
            (Format::Bc7, 98),
            (Format::A8R8G8B8, 87),
            (Format::X8R8G8B8, 87),
            (Format::A8, 65),
            (Format::A8B8G8R8, 28),
            (Format::L8, 61),
        ];
        let sheets: Vec<Sheet> = wanted
            .iter()
            .enumerate()
            .map(|(n, &(format, _))| Sheet { name: format!("fmt{n}"), side: 8, format, levels: 2 })
            .collect();
        let gen9 = convert(&legacy(&sheets)).unwrap();
        assert!(check(&gen9).is_ok());
        let back = read_textures(&gen9).unwrap();
        for (n, (sheet, (_, code))) in sheets.iter().zip(wanted).enumerate() {
            let got = pick(&back, &sheet.name);
            assert_eq!(got.format, code);
            assert_eq!(got.payload, sheet.texture(n as u8 * 17 + 3).payload);
        }
    }

    #[test]
    fn a_converted_set_carries_host_fields_and_the_legacy_bytes() {
        let sheets = sky_set();
        let source = legacy(&sheets);
        let back = read_textures(&convert(&source).unwrap()).unwrap();
        assert_eq!(back.len(), sheets.len());

        let dome = pick(&back, "sky_dome");
        assert_eq!((dome.width, dome.height, dome.levels, dome.format), (64, 64, 5, 77));
        assert_eq!((dome.block_count, dome.block_stride, dome.flags), (341, 16, 0x0026_0208));
        assert_eq!((dome.dimension, dome.tile_mode, dome.usage, dome.unknown_44h, dome.srv_dimension), (1, 0xFF, 0x16, 2, 0x41));

        let mirror = pick(&back, "script_rt_mirror");
        assert_eq!((mirror.flags, mirror.format, mirror.block_stride), (0x0026_0228, 87, 4));
        for entry in read_entries(&source).unwrap() {
            let got = pick(&back, &entry.name);
            assert_eq!(got.payload, entry.payload, "{}", entry.name);
            assert_eq!(got.block_count as usize * got.block_stride as usize, entry.payload.len());
        }
    }

    #[test]
    fn script_targets_are_found_by_a_case_blind_prefix() {
        let names: [&str; 8] =
            ["script_rt_a", "SCRIPT_RT_B", "Script_Rt_c", "script_rt", "script_rtx", "xscript_rt_d", " script_rt_e", "script_rt_"];
        let sheets: Vec<Sheet> = names.iter().map(|&name| Sheet { name: name.into(), side: 4, format: Format::Dxt1, levels: 1 }).collect();
        let back = read_textures(&convert(&legacy(&sheets)).unwrap()).unwrap();
        for name in names {
            let is_target = name.len() >= 10 && name[..10].eq_ignore_ascii_case("script_rt_");
            let want = FLAGS_PLAIN | if is_target { SCRIPT_TARGET_BIT } else { 0 };
            assert_eq!(pick(&back, name).flags, want, "{name}");
        }
    }

    #[test]
    fn the_file_is_a_version_5_resource_with_pointers_inside_their_segments() {
        let sheets = [
            Sheet { name: "tiles".into(), side: 32, format: Format::Dxt3, levels: 6 },
            Sheet { name: "rim".into(), side: 8, format: Format::Ati1, levels: 4 },
            Sheet { name: "mask".into(), side: 16, format: Format::L8, levels: 1 },
        ];
        let gen9 = convert(&legacy(&sheets)).unwrap();
        let res = Resource::parse(&gen9).unwrap();
        assert_eq!(res.version(), VERSION_YTD_ENHANCED);
        assert_eq!(res.u32(4).unwrap(), 1);
        let roster = Roster::of(res).unwrap();
        assert_eq!(roster.count, sheets.len());
        let objects: Vec<usize> = (0..roster.count).map(|slot| roster.object(slot).unwrap()).collect();
        assert!(objects.windows(2).all(|pair| pair[1] - pair[0] == TEXTURE_BYTES));
        for object in objects {
            let f = Fields { res: &roster.res, at: object };
            assert_eq!(f.u32(4).unwrap(), 1);
            assert_eq!(roster.res.pointer_at(object + field::SRV), Some(object + layout::SRV));
            assert!(roster.res.pointer_at(object + field::DATA).is_some());
        }
    }

    #[test]
    fn the_smallest_dictionary_has_the_known_text_and_file() {
        let payload: Vec<u8> = (0..8u8).map(|i| 1 + 7 * i).collect();
        let tiny = NewTexture { name: "a".into(), width: 4, height: 4, format: Format::Dxt1, levels: 1, payload };
        let gen9 = convert(&write(&[tiny]).unwrap()).unwrap();
        let got = &read_textures(&gen9).unwrap()[0];
        let text = "Gen9Texture { name: \"a\", width: 4, height: 4, depth: 1, dimension: 1, format: 71, tile_mode: 255, \
                    levels: 1, block_count: 1, block_stride: 8, flags: 2490888, usage: 22, unknown_44h: 2, \
                    srv_dimension: 65, payload: [1, 8, 15, 22, 29, 36, 43, 50] }";
        assert_eq!(format!("{got:?}"), text);
        assert_eq!((gen9.len(), sha256_hex(&gen9).as_str()), (177, "8f55c22d1965959341c694d0a54342cfce6dd8611193fc3a99ee46e4bf8bcf50"));
    }

    #[test]
    fn a_dictionary_with_no_textures_converts_to_the_minimal_file() {
        let mut res = Resource::parse(&legacy(&sky_set())).unwrap();
        res.data_mut()[root_at::ROOT_LIST_COUNT..][..2].fill(0);
        let gen9 = convert(&res.to_file_bytes().unwrap()).unwrap();
        assert_eq!(gen9.len(), 50);
        assert!(read_textures(&gen9).unwrap().is_empty());
        assert!(check(&gen9).is_ok());
    }

    #[test]
    fn conversion_refuses_what_it_cannot_carry() {
        let source = legacy(&sky_set());
        let gen9 = convert(&source).unwrap();
        let wrong_way = convert(&gen9).unwrap_err();
        assert_eq!((wrong_way.kind, wrong_way.message.as_str()), (Kind::Version, "Это не словарь текстур Legacy (версия 5)."));
        assert_eq!(read_textures(&source).unwrap_err().message, "Это не словарь текстур gen9 (версия 13).");

        // Объект второй записи получает имя первой: повтор находится на второй.
        let pair = legacy(&[
            Sheet { name: "abc".into(), side: 4, format: Format::Dxt1, levels: 1 },
            Sheet { name: "xyz".into(), side: 4, format: Format::Dxt1, levels: 1 },
        ]);
        let mut res = Resource::parse(&pair).unwrap();
        let list = res.at(res.u64(root_at::ROOT_LIST).unwrap()).unwrap();
        let objects: Vec<usize> = (0..2).map(|slot| res.pointer_at(list + slot * 8).unwrap()).collect();
        let first_name = res.u64(objects[0] + root_at::OBJECT_NAME).unwrap().to_le_bytes();
        res.data_mut()[objects[1] + root_at::OBJECT_NAME..][..8].copy_from_slice(&first_name);
        let clash = convert(&res.to_file_bytes().unwrap()).unwrap_err();
        assert_eq!(clash.kind, Kind::Argument);
        assert!(clash.message.ends_with("is listed twice (names are case-insensitive)."), "{}", clash.message);
    }

    #[test]
    fn the_check_walks_its_rules_in_order() {
        let gen9 = convert(&legacy(&sky_set())).unwrap();
        let first_object = |res: &Resource| {
            let list = res.at(res.u64(root_at::ROOT_LIST).unwrap()).unwrap();
            res.pointer_at(list).unwrap()
        };
        let field_of = |at: usize| {
            let res = Resource::parse(&gen9).unwrap();
            res.u64(first_object(&res) + at).unwrap()
        };
        let broken_by = |at: usize, value: u64| {
            let mut res = Resource::parse(&gen9).unwrap();
            let object = first_object(&res);
            res.data_mut()[object + at..][..8].copy_from_slice(&value.to_le_bytes());
            check(&res.to_file_bytes().unwrap()).unwrap_err().message
        };
        let name = "Имя текстуры вне системной области или не выровнено.";
        let srv = "SRV текстуры не на месте встроенного блока.";
        let data = "Данные текстуры вне графической области или не выровнены.";
        let cases = [
            (field::NAME, 0, name),
            (field::NAME, field_of(field::NAME) + 1, name),
            (field::SRV, field_of(field::SRV) + 16, srv),
            (field::SRV, 0, srv),
            (field::DATA, 0, data),
            (field::DATA, field_of(field::DATA) + 4, data),
            // Счётчик блоков и шаг блока лежат рядом: оба становятся максимальными.
            (field::BLOCKS, u64::MAX, "Данные текстуры выходят за графическую область."),
        ];
        for (at, value, text) in cases {
            assert_eq!(broken_by(at, value), text, "поле {at:#x}");
        }
        let mut cut = Resource::parse(&gen9).unwrap();
        cut.data_mut().truncate(9000);
        assert_eq!(check(&cut.to_file_bytes().unwrap()).unwrap_err().message, "Словарь gen9 обрезан.");
    }

    #[test]
    fn bodies_shorter_than_the_root_fail_in_the_documented_place() {
        let gen9 = convert(&legacy(&sky_set())).unwrap();
        let whole = Resource::parse(&gen9).unwrap();
        for len in [1usize, 57, 58] {
            let stub = Resource::from_parts(whole.header, whole.data()[..len].to_vec()).to_file_bytes().unwrap();
            // Проверка видит обрезанный файл раньше всего, чтение — нехватку байт корня.
            assert_eq!(check(&stub).unwrap_err().message, "Словарь gen9 обрезан.", "{len}");
            assert_eq!(read_textures(&stub).unwrap_err().message, "Чтение за концом данных ресурса.", "{len}");
        }
    }

    #[test]
    fn an_unchanged_payload_travels_byte_for_byte() {
        let source = Sheet { name: "keep".into(), side: 16, format: Format::Dxt3, levels: 5 }.texture(0x5A);
        let gen9 = convert(&write(std::slice::from_ref(&source)).unwrap()).unwrap();
        let got = read_textures(&gen9).unwrap();
        assert_eq!(got[0].payload, source.payload);
        assert!(is_block_compressed(got[0].format));
    }

    /// Счёт блоков на огромных размерах возвращает число, а не виснет и не паникует.
    #[test]
    fn block_count_of_enormous_sides_returns_in_every_build() {
        use std::sync::mpsc;
        use std::time::Duration;
        let cases = [
            ((71u8, (1u32 << 31) + 1, 4u32, 1u32, 2u32), 1_610_612_736u32),
            ((28, u32::MAX, 65535, 1, 1), u32::MAX),
        ];
        for ((code, w, h, d, mips), want) in cases {
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(block_count(code, w, h, d, mips));
            });
            let got = rx.recv_timeout(Duration::from_secs(5));
            assert_eq!(got, Ok(want), "block_count({code}, {w}, {h}, {d}, {mips})");
        }
    }

    /// Размеры не степень двойки при нескольких ступенях gen9 не переводит: заявленные блоки не сходятся с данными.
    #[test]
    fn non_power_of_two_sides_with_several_levels_are_refused() {
        let shapes = [(96u16, 96u16, 2u8), (100, 64, 3), (64, 40, 2)];
        for (width, height, levels) in shapes {
            let need = payload_bytes(Format::Dxt1, usize::from(width), usize::from(height), usize::from(levels));
            let texture = NewTexture {
                name: "npot_probe".into(),
                width,
                height,
                format: Format::Dxt1,
                levels,
                payload: vec![0x33; need],
            };
            let legacy = write(&[texture]).unwrap();
            let refused = convert(&legacy).expect_err("словарь с такими размерами не переводится");
            assert_eq!(refused.kind, Kind::Argument, "{width}x{height}x{levels}");
            assert!(refused.message.contains("npot_probe"), "{}", refused.message);
        }
        // Одна ступень и степени двойки идут как раньше.
        let ok = |width: u16, height: u16, levels: u8| {
            let need = payload_bytes(Format::Dxt1, usize::from(width), usize::from(height), usize::from(levels));
            let texture = NewTexture {
                name: "fine".into(),
                width,
                height,
                format: Format::Dxt1,
                levels,
                payload: vec![1; need],
            };
            convert(&write(&[texture]).unwrap()).is_ok()
        };
        assert!(ok(96, 96, 1));
        assert!(ok(64, 32, 4));
    }
}
