//! Текстуры, зашитые во фрагмент (`.yft`): какие словари читаются и когда фрагмент остаётся как в игре.

use std::collections::HashSet;

use crate::error::{Error, Result};
use crate::resource::{Resource, VERSION_FRAGMENT};
use crate::texture::Format;

/// Описание текстуры внутри фрагмента и место её данных в теле ресурса.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Texture {
    pub name: String,
    /// Смещение описания в теле.
    pub object: usize,
    /// Указатель на данные, как он записан в описании.
    pub data_pointer: u64,
    pub width: u16,
    pub height: u16,
    pub stride: u16,
    /// Глубина как записана: у плоской текстуры 1, у объёмной больше (такую хост не режет).
    pub depth: u16,
    pub levels: u8,
    pub format: Format,
    /// Смещение данных в теле.
    pub data_at: usize,
    /// Сколько байт занимают данные всех ступеней.
    pub payload_len: usize,
}

/// Текстуры фрагмента и признак «ткань или бьющиеся стёкла».
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fragment {
    pub textures: Vec<Texture>,
    pub cloth_or_glass: bool,
}

/// Смещения полей, снятые с настоящих фрагментов игры.
mod place {
    /// Корень фрагмента: основная рисовалка и рисовалка ткани.
    pub const DRAWABLE: usize = 0x30;
    pub const CLOTH_DRAWABLE: usize = 0xf8;
    /// Корень: список тканей (указатель, число, ёмкость) и число бьющихся окон.
    pub const CLOTH_LIST: usize = 0x60;
    pub const GLASS_COUNT: usize = 0xe0;
    /// Рисовалка: группа шейдеров; группа: словарь текстур.
    pub const DRAWABLE_SHADERS: usize = 0x10;
    pub const SHADERS_DICTIONARY: usize = 0x08;
    /// Словарь: список указателей на описания (`pointer_list`).
    pub const DICTIONARY_LIST: usize = 0x30;
    /// Описание текстуры.
    pub const NAME: usize = 0x28;
    pub const WIDTH: usize = 0x50;
    pub const HEIGHT: usize = 0x52;
    pub const DEPTH: usize = 0x54;
    pub const STRIDE: usize = 0x56;
    pub const FORMAT: usize = 0x58;
    pub const LEVELS: usize = 0x5D;
    pub const DATA: usize = 0x70;
}

/// Версии ресурса, которые хост читает как фрагмент: основная (162) и старая у деталей машин (160).
const FRAGMENT_VERSIONS: [u32; 2] = [VERSION_FRAGMENT, 160];

const MSG_NO_ROOT: &str = "Корень фрагмента недоступен.";
const MSG_NO_NAME: &str = "У текстуры фрагмента нет имени.";
const MSG_NO_DATA: &str = "У текстуры фрагмента нет данных.";

/// Описания текстур одной рисовалки; без цепочки указателей их нет.
fn descriptions(res: &Resource, drawable: usize) -> Result<Vec<usize>> {
    let dictionary = res
        .pointer_at(drawable + place::DRAWABLE_SHADERS)
        .and_then(|group| res.pointer_at(group + place::SHADERS_DICTIONARY));
    let Some(dictionary) = dictionary else {
        return Ok(Vec::new());
    };
    let list = res.pointer_list(dictionary + place::DICTIONARY_LIST)?;
    let Some(first) = res.at(list.entries) else {
        return Ok(Vec::new());
    };
    Ok((0..usize::from(list.count))
        .filter_map(|index| res.pointer_at(first + 8 * index))
        .collect())
}

/// Длина данных всех ступеней: верхняя — шаг строки на высоту, каждая следующая — четверть предыдущей с
/// отбрасыванием дроби. Так её считает хост; счёт по блокам (`ytd_write::payload_bytes`) даёт больше, когда в
/// цепочке есть ступени меньше блока 4x4.
fn quarter_chain(stride: u16, height: u16, levels: u8) -> usize {
    let mut length = usize::from(stride) * usize::from(height);
    (0..levels)
        .map(|_| {
            let step = length;
            length /= 4;
            step
        })
        .sum()
}

fn texture(res: &Resource, object: usize) -> Result<Texture> {
    let name = res
        .cstring(res.u64(object + place::NAME)?)
        .ok_or_else(|| Error::broken(MSG_NO_NAME))?;
    let width = res.u16(object + place::WIDTH)?;
    let height = res.u16(object + place::HEIGHT)?;
    let depth = res.u16(object + place::DEPTH)?;
    let stride = res.u16(object + place::STRIDE)?;
    let code = res.u32(object + place::FORMAT)?;
    let levels = res.u8(object + place::LEVELS)?;
    let format = Format::from_code(code).ok_or_else(|| {
        Error::broken(format!("Текстура {name}: формат 0x{code:x} не поддержан."))
    })?;
    let data_pointer = res.u64(object + place::DATA)?;
    let data_at = res
        .at(data_pointer)
        .ok_or_else(|| Error::broken(MSG_NO_DATA))?;
    let payload_len = quarter_chain(stride, height, levels);
    Ok(Texture {
        name,
        object,
        data_pointer,
        width,
        height,
        stride,
        depth,
        levels,
        format,
        data_at,
        payload_len,
    })
}

/// Ткань или бьющиеся стёкла: у фрагмента своя физика, которую не правят.
fn is_cloth_or_glass(res: &Resource, root: usize) -> Result<bool> {
    let cloth_drawable = res.pointer_at(root + place::CLOTH_DRAWABLE).is_some();
    let cloths = res.pointer_list(root + place::CLOTH_LIST)?;
    let has_cloths = res.at(cloths.entries).is_some() && cloths.count > 0;
    let has_glass = res.u16(root + place::GLASS_COUNT)? > 0;
    Ok(cloth_drawable || has_cloths || has_glass)
}

/// Текстуры фрагмента в порядке обхода: основная рисовалка, затем рисовалка ткани. Описание, встреченное
/// дважды, берётся один раз; любая ошибка чтения описания отменяет весь список.
pub fn read(res: &Resource) -> Result<Fragment> {
    if !FRAGMENT_VERSIONS.contains(&res.version()) {
        return Err(Error::version(format!(
            "Это не фрагмент Legacy (версия ресурса {}).",
            res.version()
        )));
    }
    let root = res.root().ok_or_else(|| Error::broken(MSG_NO_ROOT))?;
    let mut seen = HashSet::new();
    let mut textures = Vec::new();
    for slot in [place::DRAWABLE, place::CLOTH_DRAWABLE] {
        let Some(drawable) = res.pointer_at(root + slot) else {
            continue;
        };
        for object in descriptions(res, drawable)? {
            if seen.insert(object) {
                textures.push(texture(res, object)?);
            }
        }
    }
    Ok(Fragment {
        textures,
        cloth_or_glass: is_cloth_or_glass(res, root)?,
    })
}

/// Новое описание и данные одной текстуры, найденной `read`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub texture: Texture,
    pub width: u16,
    pub height: u16,
    pub stride: u16,
    pub levels: u8,
    pub format: Format,
    pub payload: Vec<u8>,
}

/// Числовые поля описания и их размер в байтах: ширина, высота, шаг, формат, ступени.
const SCALARS: [(usize, usize); 5] = [
    (place::WIDTH, 2),
    (place::HEIGHT, 2),
    (place::STRIDE, 2),
    (place::FORMAT, 4),
    (place::LEVELS, 1),
];

/// Описание целиком занимает столько байт от своего начала; в системной части они стоят на границах по 8 байт.
const DESCRIPTION_SPAN: usize = 0x78;
const DESCRIPTION_ALIGN: usize = 8;

/// Число из байтов, младший первый.
fn little_endian(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .rev()
        .fold(0, |acc, &byte| (acc << 8) | u64::from(byte))
}

impl Texture {
    /// Числовые поля в порядке `SCALARS`.
    fn scalars(&self) -> [u64; 5] {
        [
            self.width.into(),
            self.height.into(),
            self.stride.into(),
            self.format.code().into(),
            self.levels.into(),
        ]
    }

    /// Стоят ли в теле на смещении `at` описание с теми же числовыми полями и тем же указателем данных.
    fn is_described_at(&self, body: &[u8], at: usize) -> bool {
        let pointer = at + place::DATA;
        little_endian(&body[pointer..pointer + 8]) == self.data_pointer
            && SCALARS
                .iter()
                .zip(self.scalars())
                .all(|(&(slot, size), want)| {
                    little_endian(&body[at + slot..at + slot + size]) == want
                })
    }
}

impl Change {
    fn scalars(&self) -> [u64; 5] {
        [
            self.width.into(),
            self.height.into(),
            self.stride.into(),
            self.format.code().into(),
            self.levels.into(),
        ]
    }

    /// Пишет новые поля в описание на `at`, а данные — туда, где они лежали раньше; остаток прежней длины зануляется.
    fn write_at(&self, body: &mut [u8], at: usize) {
        for (&(slot, size), value) in SCALARS.iter().zip(self.scalars()) {
            body[at + slot..at + slot + size].copy_from_slice(&value.to_le_bytes()[..size]);
        }
        let old = &self.texture;
        let region = &mut body[old.data_at..old.data_at + old.payload_len];
        region.fill(0);
        region[..self.payload.len()].copy_from_slice(&self.payload);
    }
}

/// Место описания каждой правки в системной части: ровно одно подходящее на правку.
fn locate(body: &[u8], system: usize, changes: &[&Change]) -> Option<Vec<usize>> {
    let distinct: HashSet<u64> = changes.iter().map(|c| c.texture.data_pointer).collect();
    if distinct.len() < changes.len() {
        return None;
    }
    changes
        .iter()
        .map(|change| {
            let mut hits = (0..)
                .step_by(DESCRIPTION_ALIGN)
                .take_while(|at| at + DESCRIPTION_SPAN <= system)
                .filter(|&at| change.texture.is_described_at(body, at));
            let first = hits.next()?;
            hits.next().is_none().then_some(first)
        })
        .collect()
}

/// Тело ресурса (без сжатия) с новыми описаниями и данными текстур: поля описания и байты данных пишутся на прежние
/// места, остальное остаётся как в игре. `None` — не вышло: нет системной части, данные длиннее прежних или за
/// телом, менять нечего, описание не нашлось или их два на одни данные.
pub fn patch_body(res: &Resource, changes: &[Change]) -> Option<Vec<u8>> {
    let head = &res.header;
    let body = res.data();
    if head.system_size == 0 || body.len() < head.system_size + head.graphics_size {
        return None;
    }
    let mut pending: Vec<&Change> = Vec::new();
    for change in changes {
        let old = &change.texture;
        let end = old.data_at.checked_add(old.payload_len)?;
        if change.payload.len() > old.payload_len || end > body.len() {
            return None;
        }
        let untouched =
            body[old.data_at..end] == change.payload[..] && change.scalars() == old.scalars();
        if !untouched {
            pending.push(change);
        }
    }
    if pending.is_empty() {
        return None;
    }
    let spots = locate(body, head.system_size, &pending)?;
    let mut patched = body.to_vec();
    for (change, at) in pending.iter().zip(spots) {
        change.write_at(&mut patched, at);
    }
    Some(patched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::resource::Header;

    const SYSTEM: u64 = 0x5000_0000;
    const GRAPHICS: u64 = 0x6000_0000;
    const DXT1_CODE: u32 = 0x3154_5844;
    const A8R8G8B8_CODE: u32 = 21;

    fn put16(body: &mut [u8], at: usize, value: u16) {
        body[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put32(body: &mut [u8], at: usize, value: u32) {
        body[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn put64(body: &mut [u8], at: usize, value: u64) {
        body[at..at + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn header(version: u32) -> Header {
        Header {
            system_flags: 0xA800_0004,
            graphics_flags: 0x5800_0004,
            system_size: 0x2000,
            graphics_size: 0x2000,
            version,
            declared_version: 0xFFFF_FFFF,
        }
    }

    /// Описание текстуры по смещению `at`: весь блок сначала обнуляется.
    #[allow(clippy::too_many_arguments)]
    fn describe(
        body: &mut [u8],
        at: usize,
        name_at: usize,
        sides: (u16, u16, u16),
        (code, levels): (u32, u8),
        data: u64,
    ) {
        body[at..at + 0x78].fill(0);
        put64(body, at + 0x28, SYSTEM + name_at as u64);
        put16(body, at + 0x50, sides.0);
        put16(body, at + 0x52, sides.1);
        put16(body, at + 0x54, 1);
        put16(body, at + 0x56, sides.2);
        put32(body, at + 0x58, code);
        body[at + 0x5D] = levels;
        put64(body, at + 0x70, data);
    }

    fn name(body: &mut [u8], at: usize, text: &str) {
        body[at..at + text.len()].copy_from_slice(text.as_bytes());
        body[at + text.len()] = 0;
    }

    /// Рисовалка по смещению `drawable`: группа шейдеров, словарь, список и `count` записей.
    fn chain(body: &mut [u8], drawable: usize, dictionary: usize, entries: &[usize]) {
        let group = dictionary - 0x100;
        let list = dictionary + 0x100;
        put64(body, drawable + 0x10, SYSTEM + group as u64);
        put64(body, group + 0x08, SYSTEM + dictionary as u64);
        put64(body, dictionary + 0x30, SYSTEM + list as u64);
        put16(body, dictionary + 0x38, entries.len() as u16);
        for (index, entry) in entries.iter().enumerate() {
            put64(body, list + 8 * index, SYSTEM + *entry as u64);
        }
    }

    /// Фрагмент: основная рисовалка с двумя текстурами (`tex_alpha`, `tex_beta`), остальное пусто.
    fn plain() -> Vec<u8> {
        let mut body = vec![0u8; 0x4000];
        name(&mut body, 0x1000, "tex_alpha");
        name(&mut body, 0x1020, "tex_beta");
        put64(&mut body, 0x30, SYSTEM + 0x400);
        chain(&mut body, 0x400, 0x600, &[0x800, 0x900]);
        describe(
            &mut body,
            0x800,
            0x1000,
            (64, 64, 32),
            (DXT1_CODE, 3),
            GRAPHICS,
        );
        describe(
            &mut body,
            0x900,
            0x1020,
            (16, 8, 64),
            (A8R8G8B8_CODE, 1),
            GRAPHICS + 0x1000,
        );
        body
    }

    /// Рисовалка ткани (`root + 0xf8`) со своим словарём из двух текстур.
    fn add_cloth_drawable(body: &mut [u8]) {
        name(body, 0x1040, "cloth_alpha");
        name(body, 0x1060, "cloth_beta");
        put64(body, 0xf8, SYSTEM + 0xa00);
        chain(body, 0xa00, 0xc00, &[0xe00, 0xf00]);
        describe(
            body,
            0xe00,
            0x1040,
            (64, 64, 32),
            (DXT1_CODE, 3),
            GRAPHICS + 0x1800,
        );
        describe(
            body,
            0xf00,
            0x1060,
            (16, 8, 64),
            (A8R8G8B8_CODE, 1),
            GRAPHICS + 0x1c00,
        );
    }

    fn resource(body: &[u8]) -> Resource {
        Resource::from_parts(header(162), body.to_vec())
    }

    fn names(fragment: &Fragment) -> Vec<&str> {
        fragment.textures.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn the_main_drawable_gives_its_textures_with_places_and_sizes() {
        let fragment = read(&resource(&plain())).unwrap();
        assert_eq!(names(&fragment), ["tex_alpha", "tex_beta"]);
        assert!(!fragment.cloth_or_glass);
        assert_eq!(
            fragment.textures[0],
            Texture {
                name: "tex_alpha".to_owned(),
                object: 0x800,
                data_pointer: GRAPHICS,
                width: 64,
                height: 64,
                stride: 32,
                levels: 3,
                format: Format::Dxt1,
                depth: 1,
                data_at: 0x2000,
                payload_len: 2688,
            }
        );
        assert_eq!(
            fragment.textures[1],
            Texture {
                name: "tex_beta".to_owned(),
                object: 0x900,
                data_pointer: GRAPHICS + 0x1000,
                width: 16,
                height: 8,
                stride: 64,
                levels: 1,
                format: Format::A8R8G8B8,
                depth: 1,
                data_at: 0x3000,
                payload_len: 512,
            }
        );
    }

    #[test]
    fn the_data_length_is_the_quarter_chain_of_the_top_level() {
        // 64x512 DXT5, десять ступеней: после 4x4 блоки не делятся, а длина данных всё равно считается
        // «каждая ступень — четверть предыдущей» (так её считает хост): 43690, а не 43792 по блокам.
        let mut body = plain();
        describe(
            &mut body,
            0x900,
            0x1020,
            (64, 512, 64),
            (0x3554_5844, 10),
            GRAPHICS + 0x1000,
        );
        let texture = &read(&resource(&body)).unwrap().textures[1];
        assert_eq!(texture.payload_len, 43690);
        assert_eq!(
            crate::ytd_write::payload_bytes(Format::Dxt5, 64, 512, 10),
            43792,
            "по блокам было бы иначе"
        );
        // Ступень в один байт и меньше обнуляется в цепочке: 1 байт на строку, четыре ступени.
        describe(
            &mut body,
            0x900,
            0x1020,
            (16, 8, 16),
            (0x3554_5844, 3),
            GRAPHICS + 0x1000,
        );
        assert_eq!(
            read(&resource(&body)).unwrap().textures[1].payload_len,
            16 * 8 + 16 * 8 / 4 + 16 * 8 / 16
        );
    }

    #[test]
    fn the_cloth_drawable_adds_its_own_descriptions_after_the_main_ones() {
        let mut body = plain();
        add_cloth_drawable(&mut body);
        let fragment = read(&resource(&body)).unwrap();
        assert_eq!(
            names(&fragment),
            ["tex_alpha", "tex_beta", "cloth_alpha", "cloth_beta"]
        );
        // Ткань — признак сама по себе, даже без списка тканей.
        assert!(fragment.cloth_or_glass);
    }

    #[test]
    fn a_description_met_twice_is_taken_once() {
        let mut body = plain();
        // Рисовалка ткани смотрит в тот же словарь, что и основная.
        put64(&mut body, 0xf8, SYSTEM + 0xa00);
        put64(&mut body, 0xa00 + 0x10, SYSTEM + 0x500);
        let fragment = read(&resource(&body)).unwrap();
        assert_eq!(names(&fragment), ["tex_alpha", "tex_beta"]);
        assert!(fragment.cloth_or_glass);
    }

    #[test]
    fn a_cloth_list_or_glass_windows_keep_the_fragment() {
        let mut cloths = plain();
        put64(&mut cloths, 0x60, SYSTEM + 0x1800);
        put16(&mut cloths, 0x68, 1);
        put16(&mut cloths, 0x6a, 1);
        assert!(read(&resource(&cloths)).unwrap().cloth_or_glass);
        // Список без записей — не ткань.
        put16(&mut cloths, 0x68, 0);
        assert!(!read(&resource(&cloths)).unwrap().cloth_or_glass);

        let mut glass = plain();
        put64(&mut glass, 0xd8, SYSTEM + 0x1900);
        put16(&mut glass, 0xe0, 3);
        put16(&mut glass, 0xe2, 3);
        assert!(read(&resource(&glass)).unwrap().cloth_or_glass);
        // Число окон считается и без указателя на них.
        put64(&mut glass, 0xd8, 0);
        assert!(read(&resource(&glass)).unwrap().cloth_or_glass);
        put16(&mut glass, 0xe0, 0);
        assert!(!read(&resource(&glass)).unwrap().cloth_or_glass);
    }

    #[test]
    fn a_fragment_without_a_drawable_or_a_dictionary_has_no_textures() {
        let mut none = plain();
        put64(&mut none, 0x30, 0);
        let fragment = read(&resource(&none)).unwrap();
        assert_eq!(
            (fragment.textures.len(), fragment.cloth_or_glass),
            (0, false)
        );

        let mut bare = plain();
        put64(&mut bare, 0x400 + 0x10, 0);
        assert!(read(&resource(&bare)).unwrap().textures.is_empty());

        let mut no_dictionary = plain();
        put64(&mut no_dictionary, 0x500 + 0x08, 0);
        assert!(read(&resource(&no_dictionary)).unwrap().textures.is_empty());
    }

    #[test]
    fn the_depth_of_a_volume_texture_is_kept_as_written() {
        let mut body = plain();
        put16(&mut body, 0x800 + 0x54, 4);
        put16(&mut body, 0x900 + 0x54, 0);
        let fragment = read(&resource(&body)).unwrap();
        assert_eq!(
            fragment
                .textures
                .iter()
                .map(|t| t.depth)
                .collect::<Vec<_>>(),
            [4, 0]
        );
    }

    /// Правка: новые стороны, шаг, ступени и данные текстуры `index` фрагмента.
    fn change(
        fragment: &Fragment,
        index: usize,
        sides: (u16, u16, u16),
        levels: u8,
        payload: Vec<u8>,
    ) -> Change {
        let texture = fragment.textures[index].clone();
        Change {
            format: texture.format,
            texture,
            width: sides.0,
            height: sides.1,
            stride: sides.2,
            levels,
            payload,
        }
    }

    /// Тело с узором в данных первой текстуры (2688 байт с графики, 0x2000).
    fn patterned() -> Vec<u8> {
        let mut body = plain();
        for (i, byte) in body[0x2000..0x2000 + 2688].iter_mut().enumerate() {
            *byte = (i % 251) as u8 + 1;
        }
        body
    }

    #[test]
    fn a_change_rewrites_the_description_and_the_data_in_place() {
        let body = patterned();
        let before = resource(&body);
        let fragment = read(&before).unwrap();
        // 64x64 DXT1 с тремя ступенями -> 32x32 с двумя: 16*32 + 16*32/4 байт.
        let payload = vec![7u8; 640];
        let patched = patch_body(
            &before,
            &[change(&fragment, 0, (32, 32, 16), 2, payload.clone())],
        )
        .unwrap();
        assert_eq!(patched.len(), body.len());
        // Описание: новые стороны, шаг и ступени; формат и указатель те же.
        let description = &patched[0x800..0x800 + 0x78];
        assert_eq!(
            u16::from_le_bytes([description[0x50], description[0x51]]),
            32
        );
        assert_eq!(
            u16::from_le_bytes([description[0x52], description[0x53]]),
            32
        );
        assert_eq!(
            u16::from_le_bytes([description[0x56], description[0x57]]),
            16
        );
        assert_eq!(description[0x5D], 2);
        // Данные: новые байты с начала прежних, хвост прежней длины обнулён.
        assert_eq!(patched[0x2000..0x2000 + 640], payload[..]);
        assert!(patched[0x2000 + 640..0x2000 + 2688]
            .iter()
            .all(|&byte| byte == 0));
        // Прочее — как было: меняются только поля описания и область данных.
        let mut expected = body.clone();
        expected[0x800 + 0x50..0x800 + 0x52].copy_from_slice(&32u16.to_le_bytes());
        expected[0x800 + 0x52..0x800 + 0x54].copy_from_slice(&32u16.to_le_bytes());
        expected[0x800 + 0x56..0x800 + 0x58].copy_from_slice(&16u16.to_le_bytes());
        expected[0x800 + 0x5D] = 2;
        expected[0x2000..0x2000 + 640].copy_from_slice(&payload);
        expected[0x2000 + 640..0x2000 + 2688].fill(0);
        assert!(patched == expected, "тело разошлось с ожидаемым");
        // И читается заново: новые числа у той же текстуры.
        let again = read(&Resource::from_parts(header(162), patched)).unwrap();
        assert_eq!(
            (
                again.textures[0].width,
                again.textures[0].stride,
                again.textures[0].levels,
                again.textures[0].payload_len
            ),
            (32, 16, 2, 640)
        );
        assert_eq!(again.textures[1], fragment.textures[1]);
    }

    #[test]
    fn a_change_that_cannot_be_written_in_place_gives_nothing() {
        let body = patterned();
        let before = resource(&body);
        let fragment = read(&before).unwrap();
        let same = |index: usize| {
            let texture = &fragment.textures[index];
            let at = texture.data_at;
            change(
                &fragment,
                index,
                (texture.width, texture.height, texture.stride),
                texture.levels,
                body[at..at + texture.payload_len].to_vec(),
            )
        };
        // Ничего не меняется.
        assert_eq!(patch_body(&before, &[same(0), same(1)]), None);
        // Данные длиннее прежних.
        let longer = change(&fragment, 0, (64, 64, 32), 3, vec![1u8; 2689]);
        assert_eq!(patch_body(&before, &[longer]), None);
        // Описание с такими полями и указателем не нашлось.
        let mut lost = change(&fragment, 0, (32, 32, 16), 2, vec![7u8; 640]);
        lost.texture.width = 128;
        assert_eq!(patch_body(&before, &[lost]), None);
        // Две правки на одни данные.
        let twice = [
            change(&fragment, 0, (32, 32, 16), 2, vec![7u8; 640]),
            change(&fragment, 0, (16, 16, 8), 1, vec![9u8; 128]),
        ];
        assert_eq!(patch_body(&before, &twice), None);
        // Правка за пределами тела.
        let mut outside = change(&fragment, 0, (32, 32, 16), 2, vec![7u8; 640]);
        outside.texture.data_at = 0x3fff;
        assert_eq!(patch_body(&before, &[outside]), None);
        // Без системной части править нечего.
        let mut head = header(162);
        head.system_size = 0;
        let bare = Resource::from_parts(head, body.clone());
        let ok = change(&fragment, 0, (32, 32, 16), 2, vec![7u8; 640]);
        assert_eq!(patch_body(&bare, &[ok]), None);
    }

    #[test]
    fn the_older_fragment_version_of_vehicle_parts_is_read_the_same_way() {
        // Детали машин (`vehiclemods`) лежат во фрагментах версии 160; хост читает их как фрагменты.
        let fragment = read(&Resource::from_parts(header(160), plain())).unwrap();
        assert_eq!(names(&fragment), ["tex_alpha", "tex_beta"]);
    }

    #[test]
    fn what_is_not_a_fragment_is_refused() {
        let body = plain();
        for version in [165, 13, 0] {
            let error = read(&Resource::from_parts(header(version), body.clone())).unwrap_err();
            assert_eq!(error.kind, Kind::Version, "{version}");
        }
    }

    #[test]
    fn one_unreadable_description_cancels_the_whole_list() {
        let mut format = plain();
        put32(&mut format, 0x900 + 0x58, 999);
        let error = read(&resource(&format)).unwrap_err();
        assert_eq!(error.kind, Kind::Broken);

        let mut no_data = plain();
        put64(&mut no_data, 0x900 + 0x70, 0);
        assert_eq!(read(&resource(&no_data)).unwrap_err().kind, Kind::Broken);

        let mut no_name = plain();
        put64(&mut no_name, 0x800 + 0x28, 0);
        assert_eq!(read(&resource(&no_name)).unwrap_err().kind, Kind::Broken);
    }
}
