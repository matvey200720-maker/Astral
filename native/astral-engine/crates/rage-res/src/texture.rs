//! Словарь текстур RAGE: описания без копирования пикселей и декодирование уровня в RGBA.

use crate::error::{Error, Kind, Result};
use crate::resource::{Resource, VERSION_YTD, VERSION_YTD_ENHANCED};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Dxt1,
    Dxt3,
    Dxt5,
    Ati1,
    Ati2,
    Bc7,
    A8R8G8B8,
    X8R8G8B8,
    A8,
    A8B8G8R8,
    L8,
}

/// Как формат хранит пиксели: блоками 4×4 или по пикселю.
#[derive(Clone, Copy)]
enum Storage {
    Block(usize),
    Pixel(usize),
}

/// Строка таблицы форматов: вариант, код в файле, имя, раскладка.
const FORMATS: [(Format, u32, &str, Storage); 11] = [
    (Format::Dxt1, 0x3154_5844, "DXT1", Storage::Block(8)),
    (Format::Dxt3, 0x3354_5844, "DXT3", Storage::Block(16)),
    (Format::Dxt5, 0x3554_5844, "DXT5", Storage::Block(16)),
    (Format::Ati1, 0x3149_5441, "ATI1", Storage::Block(8)),
    (Format::Ati2, 0x3249_5441, "ATI2", Storage::Block(16)),
    (Format::Bc7, 0x2037_4342, "BC7", Storage::Block(16)),
    (Format::A8R8G8B8, 21, "A8R8G8B8", Storage::Pixel(4)),
    (Format::X8R8G8B8, 22, "X8R8G8B8", Storage::Pixel(4)),
    (Format::A8, 28, "A8", Storage::Pixel(1)),
    (Format::A8B8G8R8, 32, "A8B8G8R8", Storage::Pixel(4)),
    (Format::L8, 50, "L8", Storage::Pixel(1)),
];

impl Format {
    fn row(self) -> &'static (Format, u32, &'static str, Storage) {
        FORMATS
            .iter()
            .find(|row| row.0 == self)
            .expect("все форматы в таблице")
    }

    pub fn from_code(code: u32) -> Option<Self> {
        FORMATS.iter().find(|row| row.1 == code).map(|row| row.0)
    }

    pub fn code(self) -> u32 {
        self.row().1
    }

    pub fn name(self) -> &'static str {
        self.row().2
    }

    /// Размер уровня по правилу прежнего помощника: сжатые без выравнивания до блока.
    pub fn helper_level_bytes(self, width: usize, height: usize) -> usize {
        match self.row().3 {
            Storage::Block(block) => width * height * block / 16,
            Storage::Pixel(_) => self.level_bytes(width, height),
        }
    }

    pub fn helper_total_bytes(self, width: u32, height: u32, levels: u32) -> usize {
        (0..levels)
            .map(|k| {
                let side = |full: u32| full.checked_shr(k).unwrap_or(0) as usize;
                self.helper_level_bytes(side(width), side(height))
            })
            .sum()
    }

    /// Размер уровня по блокам 4×4 (минимум один блок) или по пикселям.
    pub fn level_bytes(self, width: usize, height: usize) -> usize {
        match self.row().3 {
            Storage::Block(block) => width.div_ceil(4).max(1) * height.div_ceil(4).max(1) * block,
            Storage::Pixel(size) => width * height * size,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Span {
    pub offset: usize,
    pub bytes: usize,
}

#[derive(Debug, Clone)]
pub struct TextureRef {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub levels: u32,
    pub format: Option<Format>,
    pub format_code: u32,
    pub bytes: usize,
    pub complete: bool,
    pub data_at: Option<usize>,
    pub spans: Vec<Span>,
}

#[derive(Debug, Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub level: u32,
    pub rgba: Vec<u8>,
}

impl Image {
    pub fn has_transparency(&self) -> bool {
        self.rgba.chunks_exact(4).any(|pixel| pixel[3] < 255)
    }
}

const MAX_ENTRIES: u16 = 4096;
const LIST_AT: usize = 0x30;

/// Сторона уровня k: целая часть деления на 2^k, не меньше единицы. Для k >= 32
/// получается 1 одинаково в debug и release.
fn level_side(full: u32, k: u32) -> u32 {
    shifted_side(full, k).max(1)
}

/// То же без нижней границы: ноль, когда сторона сдвинута целиком.
fn shifted_side(full: u32, k: u32) -> u32 {
    full.checked_shr(k).unwrap_or(0)
}

/// Уровни текстуры подряд, от крупного к мелкому.
fn level_spans(format: Format, width: u32, height: u32, levels: u32) -> Vec<Span> {
    let mut offset = 0;
    (0..levels)
        .map(|k| {
            let bytes =
                format.level_bytes(level_side(width, k) as usize, level_side(height, k) as usize);
            let span = Span { offset, bytes };
            offset += bytes;
            span
        })
        .collect()
}

/// Читает описание одной текстуры; `None` — запись без имени или размеров.
fn read_texture(res: &Resource, object: usize) -> Result<Option<TextureRef>> {
    let name_pointer = res.u64(object + 0x28)?;
    let width = u32::from(res.u16(object + 0x50)?);
    let height = u32::from(res.u16(object + 0x52)?);
    let depth = u32::from(res.u16(object + 0x54)?);
    let levels = u32::from(res.u8(object + 0x5D)?);
    let format_code = res.u32(object + 0x58)?;

    let name = res.cstring(name_pointer).filter(|name| !name.is_empty());
    let Some(name) = name.filter(|_| width != 0 && height != 0 && levels != 0) else {
        return Ok(None);
    };
    let data_at = res.pointer_at(object + 0x70);
    let format = Format::from_code(format_code);
    let spans = format.map_or_else(Vec::new, |f| level_spans(f, width, height, levels));
    let bytes = spans.iter().map(|span| span.bytes).sum();
    let complete = format.is_some()
        && data_at
            .and_then(|at| at.checked_add(bytes))
            .is_some_and(|end| end <= res.len());
    Ok(Some(TextureRef {
        name,
        width,
        height,
        depth: depth.max(1),
        levels,
        format,
        format_code,
        bytes,
        complete,
        data_at,
        spans,
    }))
}

pub fn read_dictionary_at(res: &Resource, dictionary_at: Option<usize>) -> Result<Vec<TextureRef>> {
    let Some(dictionary) = dictionary_at else {
        return Ok(Vec::new());
    };
    let list = res.pointer_list(dictionary + LIST_AT)?;
    if list.count > MAX_ENTRIES {
        return Err(Error::broken(
            "Словарь текстур заявляет слишком много записей.",
        ));
    }
    let Some(entries) = res.at(list.entries) else {
        return Ok(Vec::new());
    };
    let mut found = Vec::new();
    for index in 0..usize::from(list.count) {
        if let Some(object) = res.pointer_at(entries + index * 8) {
            found.extend(read_texture(res, object)?);
        }
    }
    Ok(found)
}

pub fn read_dictionary(res: &Resource) -> Result<Vec<TextureRef>> {
    match res.version() {
        VERSION_YTD_ENHANCED => Err(Error::new(
            Kind::Enhanced,
            "Словарь текстур из GTA V Enhanced: Astral читает Legacy.",
        )),
        VERSION_YTD => read_dictionary_at(res, res.root()),
        other => Err(Error::version(format!(
            "Это не словарь текстур Legacy (версия {other})."
        ))),
    }
}

pub fn decode(
    res: &Resource,
    texture: &TextureRef,
    level: Option<u32>,
    max_size: Option<u32>,
) -> Result<Image> {
    decode_with(res, texture, level, max_size, decode_pixels)
}

/// То же, но блоки DXT распаковываются так, как это делает JS (`texture_js`): сборщики сцен берут пиксели и средние цвета листов,
/// а у JS промежуточные цвета и альфа округляются к ближайшему, у `decode` — вниз.
pub fn decode_js(
    res: &Resource,
    texture: &TextureRef,
    level: Option<u32>,
    max_size: Option<u32>,
) -> Result<Image> {
    decode_with(res, texture, level, max_size, crate::texture_js::decode_pixels)
}

fn decode_with(
    res: &Resource,
    texture: &TextureRef,
    level: Option<u32>,
    max_size: Option<u32>,
    pixels: fn(Format, &[u8], usize, usize) -> Result<Vec<u8>>,
) -> Result<Image> {
    let Some(format) = texture.format else {
        return Err(Error::texture(format!(
            "Текстура {}: формат не поддерживается.",
            texture.name
        )));
    };
    if !texture.complete {
        return Err(Error::texture(format!(
            "Текстура {}: байты обрезаны, файл повреждён.",
            texture.name
        )));
    }

    let Some(last) = texture.levels.checked_sub(1) else {
        return Err(Error::texture(format!(
            "Текстура {}: нет ни одного уровня.",
            texture.name
        )));
    };
    let mut chosen = level.unwrap_or(0);
    if let (None, Some(limit)) = (level, max_size) {
        while chosen < last
            && shifted_side(texture.width, chosen).max(shifted_side(texture.height, chosen)) > limit
        {
            chosen += 1;
        }
    }
    let chosen = chosen.min(last);
    let width = level_side(texture.width, chosen);
    let height = level_side(texture.height, chosen);

    let Some(span) = texture.spans.get(chosen as usize).copied() else {
        return Err(Error::texture(format!(
            "Текстура {}: уровень {} не описан.",
            texture.name, chosen
        )));
    };
    let start = texture.data_at.unwrap_or(0) + span.offset;
    let data = res.bytes(start, span.bytes)?;
    Ok(Image {
        width,
        height,
        level: chosen,
        rgba: pixels(format, data, width as usize, height as usize)?,
    })
}

/// Блок 4×4 в RGBA (шаг строки 16 байт).
fn block_to_rgba(format: Format, block: &[u8], tile: &mut [u8; 64]) {
    match format {
        Format::Dxt1 => bcdec_rs::bc1(block, tile, 16),
        Format::Dxt3 => bcdec_rs::bc2(block, tile, 16),
        Format::Dxt5 => bcdec_rs::bc3(block, tile, 16),
        Format::Bc7 => bcdec_rs::bc7(block, tile, 16),
        Format::Ati1 => {
            let mut grey = [0u8; 16];
            bcdec_rs::bc4(block, &mut grey, 4, false);
            for (pixel, value) in tile.chunks_exact_mut(4).zip(grey) {
                pixel.copy_from_slice(&[value, value, value, 255]);
            }
        }
        _ => {
            let mut pairs = [0u8; 32];
            bcdec_rs::bc5(block, &mut pairs, 8, false);
            for (pixel, rg) in tile.chunks_exact_mut(4).zip(pairs.chunks_exact(2)) {
                let x = f32::from(rg[0]) / 127.5 - 1.0;
                let y = f32::from(rg[1]) / 127.5 - 1.0;
                let z = ((1.0 - x * x - y * y).max(0.0).sqrt() + 1.0) * 127.5;
                pixel.copy_from_slice(&[rg[0], rg[1], z.round() as u8, 255]);
            }
        }
    }
}

/// Один несжатый пиксель из байтов файла в RGBA.
fn pixel_to_rgba(format: Format, raw: &[u8]) -> [u8; 4] {
    match format {
        Format::A8R8G8B8 => [raw[2], raw[1], raw[0], raw[3]],
        Format::X8R8G8B8 => [raw[2], raw[1], raw[0], 255],
        Format::A8B8G8R8 => [raw[0], raw[1], raw[2], raw[3]],
        Format::A8 => [255, 255, 255, raw[0]],
        _ => [raw[0], raw[0], raw[0], 255],
    }
}

pub fn decode_pixels(format: Format, data: &[u8], width: usize, height: usize) -> Result<Vec<u8>> {
    let needed = format.level_bytes(width, height);
    if data.len() < needed {
        return Err(Error::texture(format!(
            "Текстуре {width}\u{d7}{height} {} нужно {needed} байт, пришло {}.",
            format.name(),
            data.len()
        )));
    }
    if width == 0 || height == 0 {
        return Ok(Vec::new());
    }

    match format.row().3 {
        Storage::Pixel(size) => Ok(data
            .chunks_exact(size)
            .take(width * height)
            .flat_map(|raw| pixel_to_rgba(format, raw))
            .collect()),
        Storage::Block(size) => {
            let columns = width.div_ceil(4);
            let mut rgba = vec![0u8; width * height * 4];
            let mut tile = [0u8; 64];
            for (index, block) in data
                .chunks_exact(size)
                .take(columns * height.div_ceil(4))
                .enumerate()
            {
                block_to_rgba(format, block, &mut tile);
                let (left, top) = ((index % columns) * 4, (index / columns) * 4);
                let visible_columns = (width - left).min(4);
                for row in 0..(height - top).min(4) {
                    let target = ((top + row) * width + left) * 4;
                    rgba[target..target + visible_columns * 4]
                        .copy_from_slice(&tile[row * 16..row * 16 + visible_columns * 4]);
                }
            }
            Ok(rgba)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::Header;
    use crate::ytd_write::{write, NewTexture};

    const SIZE: usize = 16 * 1024;

    fn hex(bytes: &[u8]) -> String {
        bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn pixels(format: Format, data: &[u8], w: usize, h: usize) -> String {
        hex(&decode_pixels(format, data, w, h).unwrap())
    }

    fn resource_of(version: u32, data: Vec<u8>) -> Resource {
        let header = Header {
            system_flags: ((version >> 4) << 28) | (2 << 17),
            graphics_flags: (version & 0xf) << 28,
            system_size: data.len(),
            graphics_size: 0,
            version,
            declared_version: version,
        };
        Resource::from_parts(header, data)
    }

    /// Словарь версии 13: массив с 0x100, объекты по 0x90 с 0x200, имена с 0x1000, данные с 0x2000.
    struct Dict(Vec<u8>);

    impl Dict {
        fn new(count: u16) -> Self {
            let mut dict = Dict(vec![0; SIZE]);
            dict.q(0x30, 0x5000_0100);
            dict.h(0x38, count);
            dict.h(0x3A, count);
            dict
        }
        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.0[at..at + bytes.len()].copy_from_slice(bytes);
        }
        fn h(&mut self, at: usize, v: u16) {
            self.put(at, &v.to_le_bytes());
        }
        fn q(&mut self, at: usize, v: u64) {
            self.put(at, &v.to_le_bytes());
        }
        /// Текстура номер `slot`; имя `None` оставляет указатель нулевым.
        fn texture(
            &mut self,
            slot: usize,
            name: Option<&[u8]>,
            w: u16,
            h: u16,
            levels: u8,
            code: u32,
        ) -> usize {
            let object = 0x200 + slot * 0x90;
            self.q(0x100 + slot * 8, 0x5000_0000 + object as u64);
            if let Some(name) = name {
                let at = 0x1000 + slot * 0x400;
                self.q(object + 0x28, 0x5000_0000 + at as u64);
                self.put(at, name);
            }
            self.h(object + 0x50, w);
            self.h(object + 0x52, h);
            self.h(object + 0x54, 1);
            self.put(object + 0x58, &code.to_le_bytes());
            self.0[object + 0x5D] = levels;
            self.q(object + 0x70, 0x5000_0000 + 0x2000 + slot as u64 * 0x100);
            object
        }
        fn res(&self) -> Resource {
            resource_of(13, self.0.clone())
        }
        fn read(&self) -> Result<Vec<TextureRef>> {
            read_dictionary(&self.res())
        }
    }

    const DXT1: u32 = 0x3154_5844;

    fn only(dict: &Dict) -> TextureRef {
        let mut all = dict.read().unwrap();
        assert_eq!(all.len(), 1);
        all.remove(0)
    }

    #[test]
    fn codes_and_names() {
        let table = [
            (Format::Dxt1, 0x3154_5844, "DXT1"),
            (Format::Dxt3, 0x3354_5844, "DXT3"),
            (Format::Dxt5, 0x3554_5844, "DXT5"),
            (Format::Ati1, 0x3149_5441, "ATI1"),
            (Format::Ati2, 0x3249_5441, "ATI2"),
            (Format::Bc7, 0x2037_4342, "BC7"),
            (Format::A8R8G8B8, 0x15, "A8R8G8B8"),
            (Format::X8R8G8B8, 0x16, "X8R8G8B8"),
            (Format::A8, 0x1c, "A8"),
            (Format::A8B8G8R8, 0x20, "A8B8G8R8"),
            (Format::L8, 0x32, "L8"),
        ];
        for (format, code, name) in table {
            assert_eq!((format.code(), format.name()), (code, name));
            assert_eq!(Format::from_code(code), Some(format));
        }
        for code in [
            0,
            1,
            20,
            23,
            29,
            33,
            0x3154_5845,
            0x3349_5441,
            0x7e3f_ffff,
            u32::MAX,
        ] {
            assert_eq!(Format::from_code(code), None, "{code:#x}");
        }
    }

    #[test]
    fn level_sizes() {
        assert_eq!(Format::Dxt1.level_bytes(256, 256), 32768);
        assert_eq!(Format::Dxt5.level_bytes(256, 256), 65536);
        assert_eq!(Format::Dxt1.level_bytes(1, 1), 8);
        assert_eq!(Format::A8R8G8B8.level_bytes(4, 2), 32);
        assert_eq!(Format::L8.level_bytes(3, 3), 9);
        for (w, h, level, helper) in [
            (0, 0, 8, 0),
            (1, 1, 8, 0),
            (1, 0, 8, 0),
            (2, 2, 8, 2),
            (3, 3, 8, 4),
            (5, 5, 32, 12),
            (9, 3, 24, 13),
            (255, 255, 32768, 32512),
        ] {
            assert_eq!(Format::Dxt1.level_bytes(w, h), level, "{w}x{h}");
            assert_eq!(Format::Dxt1.helper_level_bytes(w, h), helper, "{w}x{h}");
        }
        for (w, h, level, helper) in [
            (0, 0, 16, 0),
            (1, 1, 16, 1),
            (4, 1, 16, 4),
            (5, 5, 64, 25),
            (9, 3, 48, 27),
            (255, 255, 65536, 65025),
        ] {
            assert_eq!(Format::Bc7.level_bytes(w, h), level);
            assert_eq!(Format::Dxt5.helper_level_bytes(w, h), helper);
        }
        for format in [Format::A8R8G8B8, Format::X8R8G8B8, Format::A8B8G8R8] {
            assert_eq!(
                (format.level_bytes(0, 0), format.level_bytes(3, 3)),
                (0, 36)
            );
            assert_eq!(format.helper_level_bytes(9, 3), 108);
        }
        assert_eq!(
            (
                Format::A8.level_bytes(1, 0),
                Format::L8.helper_level_bytes(9, 3)
            ),
            (0, 27)
        );
    }

    #[test]
    fn helper_totals() {
        use Format::*;
        let cases = [
            (Dxt5, 1024, 512, 11, 699_050),
            (Dxt5, 1024, 1024, 11, 1_398_101),
            (Dxt1, 1024, 1024, 11, 699_050),
            (Dxt1, 1024, 512, 11, 349_525),
            (Dxt1, 256, 256, 9, 43_690),
            (Dxt1, 4, 4, 3, 10),
            (Dxt1, 1, 1, 1, 0),
            (Dxt1, 8, 8, 40, 42),
            (Dxt5, 8, 8, 40, 85),
            (Dxt1, 512, 512, 0, 0),
            (Dxt1, 0, 0, 3, 0),
            (Dxt1, 65535, 65535, 1, 2_147_418_112),
            (Dxt5, 65535, 65535, 1, 4_294_836_225),
            (A8R8G8B8, 8, 8, 40, 340),
            (A8R8G8B8, 65535, 65535, 1, 17_179_344_900),
            (L8, 4, 4, 3, 21),
        ];
        for (format, w, h, levels, total) in cases {
            assert_eq!(
                format.helper_total_bytes(w, h, levels),
                total,
                "{format:?} {w}x{h} l{levels}"
            );
        }
        assert_eq!(Dxt5.level_bytes(1, 1), 16);
        // Блочный счёт на 38 байт больше.
        let blocks: usize = (0..11)
            .map(|k| Dxt5.level_bytes(1024 >> k, (512usize >> k).max(1)))
            .sum();
        assert_eq!(blocks, 699_088);
    }

    #[test]
    fn solid_and_gradient_dxt1() {
        let red = [0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0];
        assert_eq!(
            pixels(Format::Dxt1, &red, 4, 4),
            ["ff 00 00 ff"; 16].join(" ")
        );
        let line = "ff 00 00 ff 00 00 ff ff aa 00 55 ff 55 00 aa ff";
        let ramp = [0x00, 0xF8, 0x1F, 0x00, 0xE4, 0xE4, 0xE4, 0xE4];
        assert_eq!(pixels(Format::Dxt1, &ramp, 4, 4), [line; 4].join(" "));
        let clear = [0x1F, 0x00, 0x00, 0xF8, 0xE4, 0, 0, 0];
        let got = decode_pixels(Format::Dxt1, &clear, 4, 4).unwrap();
        assert_eq!(
            hex(&got[..16]),
            "00 00 ff ff ff 00 00 ff 80 00 80 ff 00 00 00 00"
        );
        assert_eq!(
            pixels(Format::Dxt1, &[red.as_slice(), &[0; 8]].concat(), 4, 4),
            ["ff 00 00 ff"; 16].join(" ")
        );
        assert_eq!(pixels(Format::Dxt1, &red, 1, 1), "ff 00 00 ff");
    }

    #[test]
    fn other_block_formats() {
        let mut dxt3 = vec![0xFF; 8];
        dxt3.extend([0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0]);
        assert_eq!(&pixels(Format::Dxt3, &dxt3, 4, 4)[..11], "ff 00 00 ff");
        let mut dxt5 = vec![0x80, 0x40, 0, 0, 0, 0, 0, 0];
        dxt5.extend([0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0]);
        assert_eq!(
            pixels(Format::Dxt5, &dxt5, 4, 4),
            ["ff 00 00 80"; 16].join(" ")
        );
        assert_eq!(
            pixels(Format::Ati1, &[0x80, 0, 0, 0, 0, 0, 0, 0], 4, 4),
            ["80 80 80 ff"; 16].join(" ")
        );
        let mut ati2 = vec![0x80, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(
            pixels(Format::Ati2, &ati2, 4, 4),
            ["80 ff 80 ff"; 16].join(" ")
        );
        ati2[0] = 0xFF;
        assert_eq!(
            pixels(Format::Ati2, &ati2, 4, 4),
            ["ff ff 80 ff"; 16].join(" ")
        );
        assert_eq!(
            pixels(Format::Bc7, &[0; 16], 4, 4),
            ["00 00 00 00"; 16].join(" ")
        );
        assert_eq!(
            pixels(Format::Bc7, &[0xFF; 16], 4, 4),
            ["ff ff ff ff"; 16].join(" ")
        );
        let mode6 = [&[0x40u8][..], &[0; 15]].concat();
        assert_eq!(
            pixels(Format::Bc7, &mode6, 4, 4),
            ["00 00 00 00"; 16].join(" ")
        );
    }

    #[test]
    fn uncompressed_swizzle() {
        assert_eq!(pixels(Format::A8R8G8B8, &[3, 2, 1, 4], 1, 1), "01 02 03 04");
        assert_eq!(pixels(Format::X8R8G8B8, &[3, 2, 1, 0], 1, 1), "01 02 03 ff");
        assert_eq!(pixels(Format::A8B8G8R8, &[1, 2, 3, 4], 1, 1), "01 02 03 04");
        assert_eq!(pixels(Format::A8, &[7], 1, 1), "ff ff ff 07");
        assert_eq!(pixels(Format::L8, &[9], 1, 1), "09 09 09 ff");
    }

    #[test]
    fn short_data_is_refused() {
        assert!(decode_pixels(Format::Dxt1, &[0; 4], 4, 4).is_err());
        let cases = [
            (
                Format::A8R8G8B8,
                6,
                2,
                1,
                "Текстуре 2\u{d7}1 A8R8G8B8 нужно 8 байт, пришло 6.",
            ),
            (
                Format::Dxt1,
                4,
                4,
                4,
                "Текстуре 4\u{d7}4 DXT1 нужно 8 байт, пришло 4.",
            ),
            (
                Format::Dxt1,
                0,
                4,
                4,
                "Текстуре 4\u{d7}4 DXT1 нужно 8 байт, пришло 0.",
            ),
            (
                Format::Dxt5,
                16,
                8,
                4,
                "Текстуре 8\u{d7}4 DXT5 нужно 32 байт, пришло 16.",
            ),
        ];
        for (format, have, w, h, text) in cases {
            let error = decode_pixels(format, &vec![0; have], w, h).unwrap_err();
            assert_eq!((error.kind, error.message.as_str()), (Kind::Texture, text));
        }
    }

    #[test]
    fn edges_are_cropped_and_empty_sizes_are_empty() {
        let red = [0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0];
        let blue = [0x1F, 0x00, 0x1F, 0x00, 0, 0, 0, 0];
        let data = [red, blue, red, blue].concat();
        let got = decode_pixels(Format::Dxt1, &data, 5, 3).unwrap();
        assert_eq!(got.len(), 60);
        let row = "ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff 00 00 ff ff";
        assert_eq!(hex(&got[..20]), row);
        assert_eq!(hex(&got[40..60]), row);
        assert!(decode_pixels(Format::Dxt1, &red, 0, 0).unwrap().is_empty());
        assert!(decode_pixels(Format::Dxt1, &red, 4, 0).unwrap().is_empty());
        assert!(decode_pixels(Format::A8R8G8B8, &[], 0, 5)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn dictionary_gate_by_version() {
        let message = |version| {
            let error = read_dictionary(&resource_of(version, vec![0; 0x100])).unwrap_err();
            (error.kind, error.message)
        };
        assert_eq!(
            message(46),
            (
                Kind::Version,
                "Это не словарь текстур Legacy (версия 46).".into()
            )
        );
        assert_eq!(
            message(5),
            (
                Kind::Enhanced,
                "Словарь текстур из GTA V Enhanced: Astral читает Legacy.".into()
            )
        );
        assert!(read_dictionary(&resource_of(13, vec![0; 0x100]))
            .unwrap()
            .is_empty());
        assert!(read_dictionary_at(&resource_of(13, vec![0; 0x100]), None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn entry_count_ceiling_and_null_pointers() {
        let error = Dict::new(4097).read().unwrap_err();
        assert_eq!(
            (error.kind, error.message.as_str()),
            (
                Kind::Broken,
                "Словарь текстур заявляет слишком много записей."
            )
        );
        assert!(Dict::new(4096).read().unwrap().is_empty());
        let mut none = Dict::new(3);
        none.q(0x30, 0);
        assert!(none.read().unwrap().is_empty());
    }

    #[test]
    fn unusable_textures_are_skipped() {
        let cases: [(Option<&[u8]>, u16, u16, u8); 5] = [
            (None, 4, 4, 1),
            (Some(b""), 4, 4, 1),
            (Some(b"x"), 0, 4, 1),
            (Some(b"x"), 4, 0, 1),
            (Some(b"x"), 4, 4, 0),
        ];
        for (name, w, h, levels) in cases {
            let mut dict = Dict::new(1);
            dict.texture(0, name, w, h, levels, DXT1);
            assert!(dict.read().unwrap().is_empty());
        }
        let mut dict = Dict::new(2);
        dict.texture(1, Some(b"second"), 4, 4, 1, DXT1);
        dict.q(0x100, 0);
        assert_eq!(only(&dict).name, "second");
        let mut dict = Dict::new(2);
        dict.texture(0, Some(b"first"), 4, 4, 1, DXT1);
        dict.q(0x108, 0x5000_0000 + SIZE as u64 + 8);
        assert_eq!(only(&dict).name, "first");
    }

    #[test]
    fn description_fields() {
        let mut dict = Dict::new(1);
        let object = dict.texture(0, Some(b"d7"), 4, 4, 1, DXT1);
        dict.h(object + 0x54, 7);
        let got = only(&dict);
        assert_eq!(
            (got.depth, got.bytes, got.complete, got.data_at),
            (7, 8, true, Some(0x2000))
        );
        dict.h(object + 0x54, 0);
        assert_eq!(only(&dict).depth, 1);

        let mut dict = Dict::new(1);
        dict.texture(0, Some(b"fmt"), 4, 4, 3, 0x1234_5678);
        let got = only(&dict);
        assert_eq!(
            (got.format, got.format_code, got.bytes, got.complete),
            (None, 0x1234_5678, 0, false)
        );
        assert!(got.spans.is_empty());

        let mut dict = Dict::new(1);
        let object = dict.texture(0, Some(b"nodata"), 8, 8, 4, Format::Dxt5.code());
        dict.q(object + 0x70, 0);
        let got = only(&dict);
        let spans: Vec<_> = got.spans.iter().map(|s| (s.offset, s.bytes)).collect();
        assert_eq!(spans, [(0, 64), (64, 16), (80, 16), (96, 16)]);
        assert_eq!((got.bytes, got.complete, got.data_at), (112, false, None));
    }

    #[test]
    fn completeness_is_checked_against_the_whole_resource() {
        for (extra, complete) in [(0, true), (1, false)] {
            let mut dict = Dict::new(1);
            let object = dict.texture(0, Some(b"fit"), 8, 8, 4, DXT1);
            dict.q(object + 0x70, 0x5000_0000 + (SIZE - 56 + extra) as u64);
            let got = only(&dict);
            assert_eq!((got.bytes, got.complete), (56, complete));
        }
    }

    #[test]
    fn names_are_cut_and_repaired() {
        let mut dict = Dict::new(1);
        dict.texture(0, Some(&[b'n'; 300]), 4, 4, 1, DXT1);
        assert_eq!(only(&dict).name.len(), 256);
        let mut dict = Dict::new(1);
        dict.texture(0, Some(&[0xD0, 0x9F, 0xFF, 0x7A]), 4, 4, 1, DXT1);
        assert_eq!(only(&dict).name, "\u{41f}\u{fffd}z");
    }

    #[test]
    fn reads_past_the_end_are_errors() {
        let mut dict = Dict::new(1);
        dict.texture(0, Some(b"edge"), 4, 4, 1, DXT1);
        dict.q(0x100, 0x5000_0000 + (SIZE - 0x20) as u64);
        let error = dict.read().unwrap_err();
        assert_eq!(error.message, "Чтение за концом данных ресурса.");
    }

    #[test]
    fn huge_pictures_are_described_but_incomplete() {
        let mut dict = Dict::new(1);
        dict.texture(0, Some(b"huge"), 65535, 65535, 12, Format::Dxt5.code());
        let got = only(&dict);
        assert_eq!((got.bytes, got.complete), (5_726_622_720, false));
        assert_eq!(
            (got.spans[0].bytes, got.spans[1].offset),
            (4_294_967_296, 4_294_967_296)
        );
        assert_eq!(got.spans[11].offset, 5_726_621_696);
    }

    #[test]
    fn deep_chains_read_the_same_in_every_profile() {
        let mut dict = Dict::new(1);
        dict.texture(0, Some(b"deep"), 4, 4, 32, DXT1);
        assert_eq!(only(&dict).bytes, 256);
        let mut dict = Dict::new(1);
        dict.texture(0, Some(b"deeper"), 4, 4, 33, DXT1);
        assert_eq!(only(&dict).bytes, 33 * 8);
        let mut dict = Dict::new(1);
        dict.texture(0, Some(b"deepest"), 4, 4, 255, DXT1);
        assert_eq!(only(&dict).bytes, 255 * 8);
    }

    fn written() -> (Resource, Vec<TextureRef>) {
        let red_block = [0x00, 0xF8, 0x00, 0xF8, 0, 0, 0, 0];
        let red: Vec<u8> = (0..4).flat_map(|_| red_block).collect();
        let mut payload = red[..32].to_vec();
        payload.extend(std::iter::repeat_n(red_block, 3).flatten());
        let textures = [
            NewTexture {
                name: "red8".into(),
                width: 8,
                height: 8,
                format: Format::Dxt1,
                levels: 4,
                payload,
            },
            NewTexture {
                name: "noise5".into(),
                width: 5,
                height: 3,
                format: Format::A8R8G8B8,
                levels: 1,
                payload: (0..60).map(|n| (n * 7 + 2) as u8).collect(),
            },
            NewTexture {
                name: "l8tex".into(),
                width: 4,
                height: 4,
                format: Format::L8,
                levels: 2,
                payload: (0..20)
                    .map(|n| if n < 16 { n } else { 0x10 + (n - 16) })
                    .collect(),
            },
        ];
        let res = Resource::parse(&write(&textures).unwrap()).unwrap();
        let all = read_dictionary(&res).unwrap();
        (res, all)
    }

    fn pick<'a>(all: &'a [TextureRef], name: &str) -> &'a TextureRef {
        all.iter().find(|t| t.name == name).unwrap()
    }

    #[test]
    fn written_dictionary_reads_back() {
        let (_, all) = written();
        assert_eq!(all.len(), 3);
        let l8 = pick(&all, "l8tex");
        assert_eq!((l8.bytes, l8.levels, l8.format_code), (20, 2, 0x32));
        assert_eq!(
            l8.spans
                .iter()
                .map(|s| (s.offset, s.bytes))
                .collect::<Vec<_>>(),
            [(0, 16), (16, 4)]
        );
        assert_eq!(pick(&all, "noise5").bytes, 60);
        let red = pick(&all, "red8");
        assert_eq!((red.bytes, red.depth, red.complete), (56, 1, true));
        assert_eq!(
            red.spans.iter().map(|s| s.bytes).collect::<Vec<_>>(),
            [32, 8, 8, 8]
        );
    }

    #[test]
    fn level_selection() {
        let (res, all) = written();
        let red = pick(&all, "red8");
        let shape = |level: Option<u32>, limit: Option<u32>| {
            let image = decode(&res, red, level, limit).unwrap();
            assert!(!image.has_transparency());
            assert_eq!(image.rgba.len(), (image.width * image.height * 4) as usize);
            (image.width, image.level)
        };
        assert_eq!(shape(None, None), (8, 0));
        assert_eq!(shape(Some(1), None), (4, 1));
        assert_eq!(shape(Some(3), None), (1, 3));
        assert_eq!(shape(Some(9), None), (1, 3));
        assert_eq!(shape(Some(u32::MAX), None), (1, 3));
        assert_eq!(shape(None, Some(4)), (4, 1));
        assert_eq!(shape(None, Some(3)), (2, 2));
        assert_eq!(shape(None, Some(8)), (8, 0));
        assert_eq!(shape(None, Some(0)), (1, 3));
        assert_eq!(shape(None, Some(u32::MAX)), (8, 0));
        assert_eq!(shape(Some(0), Some(2)), (8, 0));
        assert_eq!(
            &decode(&res, red, Some(3), None).unwrap().rgba[..],
            &[255, 0, 0, 255]
        );
    }

    #[test]
    fn decoded_pictures() {
        let (res, all) = written();
        let l8 = decode(&res, pick(&all, "l8tex"), None, None).unwrap();
        assert_eq!((l8.width, l8.height, l8.level), (4, 4, 0));
        assert_eq!(hex(&l8.rgba[..8]), "00 00 00 ff 01 01 01 ff");
        let small = decode(&res, pick(&all, "l8tex"), Some(1), None).unwrap();
        assert_eq!(hex(&small.rgba[..8]), "10 10 10 ff 11 11 11 ff");
        let noise = decode(&res, pick(&all, "noise5"), None, None).unwrap();
        assert_eq!((noise.width, noise.height), (5, 3));
        assert_eq!(hex(&noise.rgba[..4]), "10 09 02 17");
        assert_eq!(noise.rgba.len(), 60);
        assert!(noise.has_transparency());
    }

    #[test]
    fn decode_refusals() {
        let (res, all) = written();
        let mut broken = pick(&all, "red8").clone();
        broken.format = None;
        assert_eq!(
            decode(&res, &broken, None, None).unwrap_err().message,
            "Текстура red8: формат не поддерживается."
        );
        let mut broken = pick(&all, "red8").clone();
        broken.complete = false;
        let error = decode(&res, &broken, None, None).unwrap_err();
        assert_eq!(
            (error.kind, error.message.as_str()),
            (
                Kind::Texture,
                "Текстура red8: байты обрезаны, файл повреждён."
            )
        );
        let mut broken = pick(&all, "red8").clone();
        broken.data_at = Some(res.len() + 100);
        assert_eq!(
            decode(&res, &broken, None, None).unwrap_err().message,
            "Чтение за концом данных ресурса."
        );
        let mut start = pick(&all, "red8").clone();
        start.data_at = None;
        assert_eq!(decode(&res, &start, None, None).unwrap().width, 8);
    }

    #[test]
    fn zero_levels_are_an_error() {
        let (res, all) = written();
        let mut broken = pick(&all, "red8").clone();
        broken.levels = 0;
        let error = decode(&res, &broken, None, None).unwrap_err();
        assert_eq!(error.message, "Текстура red8: нет ни одного уровня.");
    }

    #[test]
    fn spans_shorter_than_levels_are_an_error() {
        let (res, all) = written();
        let mut broken = pick(&all, "red8").clone();
        broken.spans.truncate(1);
        let error = decode(&res, &broken, Some(2), None).unwrap_err();
        assert_eq!(error.message, "Текстура red8: уровень 2 не описан.");
    }

    #[test]
    fn levels_from_33_work_the_same_in_debug_and_release() {
        assert_eq!(level_side(1024, 31), 1);
        assert_eq!(level_side(1024, 32), 1);
        assert_eq!(level_side(1024, 200), 1);
        assert_eq!(shifted_side(1024, 32), 0);
        let spans = level_spans(Format::Dxt1, 8, 8, 40);
        assert_eq!(spans.len(), 40);
        assert!(spans[3..].iter().all(|s| s.bytes == spans[3].bytes));
        let (res, all) = written();
        let mut deep = pick(&all, "red8").clone();
        deep.levels = 40;
        deep.spans = level_spans(deep.format.unwrap(), deep.width, deep.height, 40);
        deep.complete = true;
        let image = decode(&res, &deep, Some(39), None);
        assert!(image.is_err() || image.unwrap().width == 1);
    }

    fn sample(path: &str) -> Vec<u8> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/host-port");
        std::fs::read(root.join(path)).unwrap()
    }

    #[test]
    fn mixed_sample_file() {
        let res = Resource::parse(&sample("ytd/samples/sample_mixed.ytd")).unwrap();
        let all = read_dictionary(&res).unwrap();
        assert_eq!(all.len(), 3);
        let normal = pick(&all, "w_mix_normal");
        assert_eq!(
            (normal.width, normal.format, normal.bytes, normal.data_at),
            (32, Some(Format::Ati2), 1360, Some(8192))
        );
        let spans: Vec<_> = normal.spans.iter().map(|s| (s.offset, s.bytes)).collect();
        assert_eq!(spans, [(0, 1024), (1024, 256), (1280, 64), (1344, 16)]);
        let spec = pick(&all, "w_mix_spec");
        assert_eq!(
            (spec.format, spec.bytes, spec.data_at),
            (Some(Format::Ati1), 680, Some(16384))
        );
        let alpha = pick(&all, "w_mix_alpha");
        assert_eq!(
            (alpha.width, alpha.height, alpha.format, alpha.bytes),
            (16, 8, Some(Format::Dxt5), 160)
        );
    }

    #[test]
    fn other_resources_are_not_dictionaries() {
        let res = resource_of(46, vec![0; SIZE]);
        assert_eq!(read_dictionary(&res).unwrap_err().kind, Kind::Version);
        assert!(read_dictionary(&resource_of(13, vec![0; SIZE]))
            .unwrap()
            .is_empty());
    }
}
