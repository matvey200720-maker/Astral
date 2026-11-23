//! Чтение DDS для словарей текстур GTA V Legacy: DXT1/3/5, ATI1/2 и A8R8G8B8.

use crate::error::Error;
use crate::error::Result;
use crate::texture::Format;
use crate::ytd_write::payload_bytes;

/// Список «имя = значение» одного типа: так записаны числовые пределы и смещения заголовка.
macro_rules! limits {
    ($ty:ty; $($name:ident = $value:expr),+ $(,)?) => {
        $(const $name: $ty = $value;)+
    };
}

limits!(u32; HEADER_SIZE = 124, MAX_SIDE = 8192, MAX_LEVELS = 12, LONG_CHAIN_LEVELS = 14, FLAG_MIPMAPS = 0x2_0000, PIXEL_RGB = 0x40);
limits!(usize; HEADER_BYTES = 128, DX10_BYTES = 20);

const MAGIC: &[u8; 4] = b"DDS ";
const ARGB_MASKS: [u32; 4] = [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dds {
    pub width: u32,
    pub height: u32,
    pub levels: u8,
    pub format: Format,
    pub payload: Vec<u8>,
}

/// Слово заголовка (u32, little-endian) по смещению.
fn field(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(std::array::from_fn(|i| bytes[offset + i]))
}

/// Пять сжатых форматов в порядке DXT1, DXT3, DXT5, ATI1, ATI2, каждый под своим ключом.
fn compressed<K>(keys: [K; 5]) -> [(K, Format); 5] {
    let [dxt1, dxt3, dxt5, ati1, ati2] = keys;
    [
        (dxt1, Format::Dxt1),
        (dxt3, Format::Dxt3),
        (dxt5, Format::Dxt5),
        (ati1, Format::Ati1),
        (ati2, Format::Ati2),
    ]
}

fn lookup<K: PartialEq>(key: K, table: [(K, Format); 5]) -> Option<Format> {
    table
        .into_iter()
        .find(|(known, _)| *known == key)
        .map(|(_, format)| format)
}

fn format_from_dxgi(code: u32) -> Option<Format> {
    lookup(code, compressed([71, 74, 77, 80, 83]))
}

fn format_from_fourcc(code: &[u8]) -> Option<Format> {
    let names = [b"DXT1", b"DXT3", b"DXT5", b"ATI1", b"ATI2"].map(|name| name.as_slice());
    lookup(code, compressed(names))
}

/// Формат из расширенного заголовка DX10.
fn dx10_format(bytes: &[u8]) -> Result<Format> {
    if bytes.len() < HEADER_BYTES + DX10_BYTES {
        return Err(Error::texture("DDS DX10: обрезан заголовок."));
    }
    if field(bytes, 140) > 1 {
        return Err(Error::texture("DDS с массивом текстур не поддерживается."));
    }
    let dxgi = field(bytes, 128);
    format_from_dxgi(dxgi)
        .ok_or_else(|| Error::texture(format!("DDS формат DXGI {dxgi} не поддерживается.")))
}

/// Несжатый формат: только 32-битный A8R8G8B8 с масками ARGB.
fn argb_format(bytes: &[u8]) -> Result<Format> {
    let masks = [92, 96, 100, 104].map(|at| field(bytes, at));
    if field(bytes, 88) == 32 && masks == ARGB_MASKS {
        return Ok(Format::A8R8G8B8);
    }
    Err(Error::texture(
        "DDS без сжатия: нужен 32-битный A8R8G8B8 с масками ARGB.",
    ))
}

/// Формат и смещение данных.
fn detect_format(bytes: &[u8]) -> Result<(Format, usize)> {
    let fourcc = &bytes[84..88];
    if fourcc == b"DX10" {
        let format = dx10_format(bytes)?;
        return Ok((format, HEADER_BYTES + DX10_BYTES));
    }
    if let Some(format) = format_from_fourcc(fourcc) {
        return Ok((format, HEADER_BYTES));
    }
    if fourcc == [0; 4] && field(bytes, 80) & PIXEL_RGB != 0 {
        return argb_format(bytes).map(|format| (format, HEADER_BYTES));
    }
    Err(Error::texture(format!(
        "DDS формат {:?} не поддерживается: нужен DXT1/DXT3/DXT5, ATI1/ATI2 или BC1–BC5.",
        String::from_utf8_lossy(fourcc)
    )))
}

/// Ширина и высота; обе от 1 до `MAX_SIDE`.
fn dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    let (width, height) = (field(bytes, 16), field(bytes, 12));
    let in_range = |side: u32| (1..=MAX_SIDE).contains(&side);
    if in_range(width) && in_range(height) {
        Ok((width, height))
    } else {
        Err(Error::texture("DDS: размеры вне 1–8192."))
    }
}

/// Число ступеней: из заголовка, если там есть признак цепочки, иначе одна.
fn level_count(bytes: &[u8], cap: u32) -> Result<u32> {
    let declared = match field(bytes, 8) & FLAG_MIPMAPS {
        0 => 1,
        _ => field(bytes, 28).max(1),
    };
    if declared > cap {
        return Err(Error::texture(format!("DDS: больше {cap} ступеней.")));
    }
    Ok(declared)
}

pub fn parse(bytes: &[u8]) -> Result<Dds> {
    parse_with(bytes, false, MAX_LEVELS)
}

/// Как [`parse`], но цепочка может быть полной до 8192 пикселей, то есть до 14 ступеней (у листа 4096 пикселей их 13).
/// Так листы модели надписи читает хост: он требует именно полную цепочку и стороны до 8192.
pub fn parse_long_chain(bytes: &[u8]) -> Result<Dds> {
    parse_with(bytes, false, LONG_CHAIN_LEVELS)
}

/// Как [`parse`], но принимает и данные «как у прежнего помощника»: мелкие ступени без округления до блока 4×4
/// (`Format::helper_total_bytes`). Так приложение отдаёт DDS ядру эффектов (`yptTextureDds` в `ypt-textures.js`), и так
/// лежат два листа ядра игры с неквадратной цепочкой, `ptfx_blood_spurt` и `ptfx_insects_rgb`: у них последняя ступень
/// нулевой высоты. Длина обязана быть одной из двух; сверку с листом ядра делает писатель (сверка 16.11.2026).
pub fn parse_helper_layout(bytes: &[u8]) -> Result<Dds> {
    parse_with(bytes, true, MAX_LEVELS)
}

fn parse_with(bytes: &[u8], helper_layout: bool, levels_cap: u32) -> Result<Dds> {
    if bytes.len() < HEADER_BYTES || &bytes[..4] != MAGIC || field(bytes, 4) != HEADER_SIZE {
        return Err(Error::texture("Файл не DDS: нет заголовка."));
    }
    let (format, data_start) = detect_format(bytes)?;
    if field(bytes, 24) > 1 {
        return Err(Error::texture("Объёмные DDS не поддерживаются."));
    }
    let (width, height) = dimensions(bytes)?;
    let levels = level_count(bytes, levels_cap)?;
    let payload = &bytes[data_start..];
    let expected = payload_bytes(format, width as usize, height as usize, levels as usize);
    let helper_length = format.helper_total_bytes(width, height, levels);
    if payload.len() != expected && !(helper_layout && payload.len() == helper_length) {
        return Err(Error::texture(format!(
            "DDS: данных {} байт, для {width}×{height} и {levels} ступеней {} нужно {expected}.",
            payload.len(),
            format.name()
        )));
    }
    Ok(Dds {
        levels: levels as u8,
        width,
        height,
        format,
        payload: payload.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;

    struct Head {
        fourcc: [u8; 4],
        width: u32,
        height: u32,
        mips: u32,
        flags: u32,
        depth: u32,
        pixel_flags: u32,
    }

    fn head(fourcc: &[u8; 4], width: u32, height: u32, mips: u32) -> Head {
        Head {
            fourcc: *fourcc,
            width,
            height,
            mips,
            flags: 0x21007,
            depth: 0,
            pixel_flags: 0,
        }
    }

    fn put(buf: &mut [u8], at: usize, value: u32) {
        buf[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn build(h: &Head) -> Vec<u8> {
        let mut out = vec![0u8; 128];
        out[..4].copy_from_slice(b"DDS ");
        for (at, value) in [
            (4, 124),
            (8, h.flags),
            (12, h.height),
            (16, h.width),
            (24, h.depth),
            (28, h.mips),
            (80, h.pixel_flags),
        ] {
            put(&mut out, at, value);
        }
        out[84..88].copy_from_slice(&h.fourcc);
        out
    }

    fn with_data(h: &Head, data: &[u8]) -> Vec<u8> {
        let mut out = build(h);
        out.extend_from_slice(data);
        out
    }

    fn dx10(dxgi: u32, array: u32, width: u32, height: u32, data: usize) -> Vec<u8> {
        let mut out = build(&head(b"DX10", width, height, 1));
        out.extend([0u8; 20]);
        put(&mut out, 128, dxgi);
        put(&mut out, 140, array);
        out.resize(148 + data, 0xaa);
        out
    }

    fn argb(width: u32, height: u32, mips: u32, pixel_flags: u32, data: Vec<u8>) -> Vec<u8> {
        let mut h = head(&[0; 4], width, height, mips);
        h.pixel_flags = pixel_flags;
        let mut out = build(&h);
        put(&mut out, 88, 32);
        for (at, mask) in [92, 96, 100, 104].into_iter().zip(ARGB_MASKS) {
            put(&mut out, at, mask);
        }
        out.extend(data);
        out
    }

    fn fail(bytes: &[u8]) -> String {
        let e = parse(bytes).unwrap_err();
        assert_eq!(e.kind, Kind::Texture);
        e.message
    }

    /// `fail` для файла с заголовком `h` и `len` нулевых байт данных.
    fn fail_with(h: &Head, len: usize) -> String {
        fail(&with_data(h, &vec![0; len]))
    }

    /// Ширина, высота, число ступеней и длина данных разобранного файла.
    fn shape(d: &Dds) -> (u32, u32, u8, usize) {
        (d.width, d.height, d.levels, d.payload.len())
    }

    const UNSUPPORTED_TAIL: &str =
        "не поддерживается: нужен DXT1/DXT3/DXT5, ATI1/ATI2 или BC1–BC5.";

    #[test]
    fn four_cc_formats() {
        let cases = [
            (b"DXT1", Format::Dxt1, 32),
            (b"DXT3", Format::Dxt3, 64),
            (b"DXT5", Format::Dxt5, 64),
            (b"ATI1", Format::Ati1, 32),
            (b"ATI2", Format::Ati2, 64),
        ];
        for (code, format, size) in cases {
            let d = parse(&with_data(&head(code, 8, 8, 1), &vec![0xaa; size])).unwrap();
            assert_eq!((shape(&d), d.format), ((8, 8, 1, size), format));
        }
    }

    #[test]
    fn mip_count_rules() {
        let mut h = head(b"DXT1", 16, 16, 5);
        h.flags = 0x1007;
        assert_eq!(parse(&with_data(&h, &[0; 128])).unwrap().levels, 1);
        let h = head(b"DXT1", 16, 16, 0);
        assert_eq!(parse(&with_data(&h, &[0; 128])).unwrap().levels, 1);
        let h = head(b"DXT1", 16, 16, 12);
        let d = parse(&with_data(&h, &[0; 240])).unwrap();
        assert_eq!((d.levels, d.payload.len()), (12, 240));
        let h = head(b"DXT1", 16, 16, 13);
        assert_eq!(fail_with(&h, 240), "DDS: больше 12 ступеней.");
        let h = head(b"DXT1", 16, 16, 3);
        let size = payload_bytes(Format::Dxt1, 16, 16, 3);
        let d = parse(&with_data(&h, &vec![1; size])).unwrap();
        assert_eq!(shape(&d), (16, 16, 3, size));
    }

    /// Лист модели надписи 4096 × 512 имеет полную цепочку из 13 ступеней: обычный разбор её отказывает, длинный берёт до 14
    /// (полная цепочка листа 8192), а текст отказа называет свой предел.
    #[test]
    fn a_long_chain_is_read_up_to_fourteen_levels() {
        let size = payload_bytes(Format::Dxt1, 4096, 512, 13);
        let word = with_data(&head(b"DXT1", 4096, 512, 13), &vec![3; size]);
        assert_eq!(fail(&word), "DDS: больше 12 ступеней.");
        let d = parse_long_chain(&word).unwrap();
        assert_eq!(shape(&d), (4096, 512, 13, size));
        let full = payload_bytes(Format::Dxt1, 8192, 8192, 14);
        let biggest = parse_long_chain(&with_data(&head(b"DXT1", 8192, 8192, 14), &vec![0; full])).unwrap();
        assert_eq!((biggest.levels, biggest.payload.len()), (14, full));
        let h = head(b"DXT1", 16, 16, 15);
        assert_eq!(parse_long_chain(&with_data(&h, &[0; 240])).unwrap_err().message, "DDS: больше 14 ступеней.");
        // Всё остальное — как у `parse`: размер данных обязан сойтись.
        let short = with_data(&head(b"DXT1", 4096, 512, 13), &vec![3; size - 8]);
        assert!(parse_long_chain(&short).is_err());
    }

    #[test]
    fn size_limits() {
        let d = parse(&with_data(&head(b"DXT1", 1, 1, 1), &[0; 8])).unwrap();
        assert_eq!(d.payload.len(), 8);
        let big = head(b"DXT1", 8192, 8192, 1);
        let d = parse(&with_data(&big, &vec![0; 33_554_432])).unwrap();
        assert_eq!(d.payload.len(), 33_554_432);
        for (w, h) in [(8193, 4), (0, 4), (4, 0)] {
            assert_eq!(
                fail_with(&head(b"DXT1", w, h, 1), 8),
                "DDS: размеры вне 1–8192."
            );
        }
    }

    /// DDS ядру эффектов приложение собирает с мелкими ступенями без округления до блока (`yptTextureDds`);
    /// так же лежат `ptfx_blood_spurt` и `ptfx_insects_rgb` в ядре игры. Обычный разбор такой файл не принимал
    /// («нужно 699088» при 699050), и движок отказывал именно этим листам (сверка 16.11.2026).
    #[test]
    fn helper_layout_is_taken_only_when_asked_for() {
        // DXT5 16×8, четыре ступени: по блокам 192 байта, без округления 170 (последняя ступень 2×1 — два байта).
        let h = head(b"DXT5", 16, 8, 4);
        let by_blocks = payload_bytes(Format::Dxt5, 16, 8, 4);
        let by_pixels = Format::Dxt5.helper_total_bytes(16, 8, 4);
        assert_eq!((by_blocks, by_pixels), (192, 170));
        let odd = with_data(&h, &vec![3; by_pixels]);
        assert_eq!(
            fail(&odd),
            "DDS: данных 170 байт, для 16×8 и 4 ступеней DXT5 нужно 192."
        );
        let taken = parse_helper_layout(&odd).unwrap();
        assert_eq!(shape(&taken), (16, 8, 4, 170));
        // Обычная длина проходит обоими разборами; любая третья отказывает и тем, и другим.
        let usual = with_data(&h, &vec![3; by_blocks]);
        assert_eq!(shape(&parse(&usual).unwrap()), (16, 8, 4, 192));
        assert_eq!(shape(&parse_helper_layout(&usual).unwrap()), (16, 8, 4, 192));
        let neither = with_data(&h, &vec![3; 171]);
        assert!(parse(&neither).is_err() && parse_helper_layout(&neither).is_err());
    }

    #[test]
    fn depth_and_payload_size() {
        let mut h = head(b"DXT1", 4, 4, 1);
        h.depth = 2;
        assert_eq!(fail_with(&h, 8), "Объёмные DDS не поддерживаются.");
        h.depth = 1;
        let d = parse(&with_data(&h, &[0; 8])).unwrap();
        assert_eq!(d.payload, vec![0; 8]);
        let h = head(b"DXT1", 4, 4, 1);
        for n in [9usize, 7, 3] {
            assert_eq!(
                fail_with(&h, n),
                format!("DDS: данных {n} байт, для 4×4 и 1 ступеней DXT1 нужно 8.")
            );
        }
    }

    #[test]
    fn broken_headers() {
        let msg = "Файл не DDS: нет заголовка.";
        let good = || with_data(&head(b"DXT1", 4, 4, 1), &[0; 8]);
        assert_eq!(fail(&[]), msg);
        assert_eq!(fail(&[0; 127]), msg);
        let mut b = good();
        put(&mut b, 4, 123);
        assert_eq!(fail(&b), msg);
        let mut b = good();
        b[0] = b'X';
        assert_eq!(fail(&b), msg);
        assert_eq!(fail(b"not a dds file, 29 chars long"), msg);
    }

    #[test]
    fn unsupported_four_cc() {
        let shown = |code: &[u8; 4]| fail(&with_data(&head(code, 4, 4, 1), &[0; 8]));
        let expected = |name: &str| format!("DDS формат \"{name}\" {UNSUPPORTED_TAIL}");
        assert_eq!(shown(b"BC7 "), expected("BC7 "));
        assert_eq!(shown(b"DXT2"), expected("DXT2"));
        assert_eq!(
            shown(&[0xff, 0xfe, 0x80, 0x41]),
            expected("\u{fffd}\u{fffd}\u{fffd}A")
        );
        assert_eq!(shown(&[0; 4]), expected("\\0\\0\\0\\0"));
        let mut alpha_only = head(&[0; 4], 4, 4, 1);
        alpha_only.pixel_flags = 1;
        assert_eq!(fail_with(&alpha_only, 64), expected("\\0\\0\\0\\0"));
    }

    #[test]
    fn dx10_formats() {
        let cases = [
            (71, Format::Dxt1, 32),
            (74, Format::Dxt3, 64),
            (77, Format::Dxt5, 64),
            (80, Format::Ati1, 32),
            (83, Format::Ati2, 64),
        ];
        for (dxgi, format, size) in cases {
            let d = parse(&dx10(dxgi, 0, 8, 8, size)).unwrap();
            assert_eq!((d.format, d.payload.len()), (format, size));
        }
        for dxgi in [72, 81, 84, 98, 28, 0] {
            assert_eq!(
                fail(&dx10(dxgi, 0, 8, 8, 64)),
                format!("DDS формат DXGI {dxgi} не поддерживается.")
            );
        }
        for array in [0, 1] {
            let d = parse(&dx10(77, array, 8, 8, 64)).unwrap();
            assert_eq!(d.format, Format::Dxt5);
        }
        for array in [2, 6] {
            assert_eq!(
                fail(&dx10(77, array, 8, 8, 64)),
                "DDS с массивом текстур не поддерживается."
            );
        }
        let mut short = build(&head(b"DX10", 8, 8, 1));
        short.extend([0; 10]);
        assert_eq!(fail(&short), "DDS DX10: обрезан заголовок.");
        assert_eq!(
            fail(&dx10(77, 0, 8, 8, 0)),
            "DDS: данных 0 байт, для 8×8 и 1 ступеней DXT5 нужно 64."
        );
    }

    #[test]
    fn uncompressed_argb() {
        let ramp = |n: usize| (0..n).map(|i| i as u8).collect::<Vec<_>>();
        let d = parse(&argb(2, 2, 2, 0x41, ramp(20))).unwrap();
        assert_eq!((shape(&d), d.format), ((2, 2, 2, 20), Format::A8R8G8B8));
        assert_eq!(d.payload[..4], [0, 1, 2, 3]);
        let sizes = [
            (argb(2, 2, 1, 0x40, ramp(16)), 16),
            (argb(2, 2, 1, 0x41 | 0x80000, ramp(16)), 16),
            (argb(3, 5, 3, 0x41, ramp(72)), 72),
        ];
        for (file, size) in sizes {
            assert_eq!(parse(&file).unwrap().payload.len(), size);
        }
        let d = parse(&argb(1, 1, 1, 0x41, vec![1, 2, 3, 4])).unwrap();
        assert_eq!(d.payload, vec![1, 2, 3, 4]);
        let d = parse(&argb(4, 4, 2, 0x41, ramp(80))).unwrap();
        assert_eq!(d.payload.len(), payload_bytes(Format::A8R8G8B8, 4, 4, 2));
    }

    #[test]
    fn uncompressed_with_wrong_masks_or_depth() {
        let msg = "DDS без сжатия: нужен 32-битный A8R8G8B8 с масками ARGB.";
        let broken = |edits: &[(usize, u32)]| {
            let mut file = argb(2, 2, 1, 0x41, vec![0; 16]);
            for &(at, value) in edits {
                put(&mut file, at, value);
            }
            fail(&file)
        };
        assert_eq!(broken(&[(104, 0)]), msg);
        assert_eq!(broken(&[(88, 24)]), msg);
        assert_eq!(broken(&[(92, 0x0000_00ff), (100, 0x00ff_0000)]), msg);
        let rgb_without_flag = {
            let mut b = argb(16, 16, 1, 0, vec![0; 16 * 16 * 4]);
            b[80] = 0;
            b
        };
        assert!(parse(&rgb_without_flag).is_err());
    }

    #[test]
    fn dds_equals_itself() {
        let d = parse(&with_data(&head(b"DXT1", 4, 4, 1), &[7; 8])).unwrap();
        assert_eq!(d, d.clone());
    }

    #[test]
    fn encoder_output_reads_back_in_game_order() {
        let rgba: Vec<u8> = (0..16).flat_map(|_| [10, 20, 30, 40]).collect();
        let file = crate::dds_build::encode_dds(4, 4, "A8R8G8B8", 2, &rgba).unwrap();
        assert_eq!(file.len(), 208);
        let d = parse(&file).unwrap();
        assert_eq!(d.format, Format::A8R8G8B8);
        assert_eq!(d.payload[..4], [30, 20, 10, 40]);
        assert_eq!(d.payload.len(), payload_bytes(Format::A8R8G8B8, 4, 4, 2));
    }
}
