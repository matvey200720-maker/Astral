//! Запись PNG/JPEG и чтение PNG/JPEG/WebP в RGBA (8 бит на канал).

use std::borrow::Cow;
use std::fmt::Display;
use std::io::Cursor;

use crate::error::{Error, Result};

const MSG_SIZE: &str = "Размер пикселей не сходится с размерами.";
const OPAQUE: u8 = 255;

#[derive(Debug, Clone)]
pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Отказ с текстом «что: причина».
fn refusal(what: &str, cause: impl Display) -> Error {
    Error::argument(format!("{what}: {cause}"))
}

/// Из записей по `stride` байт собирает RGBA: `pick` выдаёт один пиксель.
fn repack(pixels: &[u8], stride: usize, pick: impl Fn(&[u8]) -> [u8; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pixels.len() / stride * 4);
    for chunk in pixels.chunks_exact(stride) {
        out.extend_from_slice(&pick(chunk));
    }
    out
}

fn opaque_rgb(px: &[u8]) -> [u8; 4] {
    [px[0], px[1], px[2], OPAQUE]
}

fn gray_pixel(shade: u8, alpha: u8) -> [u8; 4] {
    [shade, shade, shade, alpha]
}

/// RGBA без четвёртого канала.
fn drop_alpha(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        rgb.extend_from_slice(&px[..3]);
    }
    rgb
}

fn check_len(width: u32, height: u32, rgba: &[u8]) -> Result<()> {
    let expected = u64::from(width) * u64::from(height) * 4;
    (rgba.len() as u64 == expected)
        .then_some(())
        .ok_or_else(|| Error::argument(MSG_SIZE))
}

pub fn encode(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    encode_with(width, height, rgba, png::Compression::Fast)
}

/// Пишет PNG 8 бит на канал в `out`; ошибку кодировщика отдаёт как есть.
fn write_png(
    out: &mut Vec<u8>,
    size: [u32; 2],
    color: png::ColorType,
    compression: png::Compression,
    data: &[u8],
) -> std::result::Result<(), png::EncodingError> {
    let mut encoder = png::Encoder::new(out, size[0], size[1]);
    encoder.set_color(color);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(compression);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(data)?;
    writer.finish()
}

pub fn encode_with(
    width: u32,
    height: u32,
    rgba: &[u8],
    compression: png::Compression,
) -> Result<Vec<u8>> {
    check_len(width, height, rgba)?;
    let opaque = rgba.iter().skip(3).step_by(4).all(|&a| a == OPAQUE);
    let (color, data): (png::ColorType, Cow<[u8]>) = if opaque {
        (png::ColorType::Rgb, Cow::Owned(drop_alpha(rgba)))
    } else {
        (png::ColorType::Rgba, Cow::Borrowed(rgba))
    };
    let mut out = Vec::new();
    write_png(&mut out, [width, height], color, compression, &data)
        .map_err(|e| refusal("PNG не записан", e))?;
    Ok(out)
}

/// Размер картинки в u16 или отказ с этим текстом.
fn fit_u16(value: u32, message: &'static str) -> Result<u16> {
    u16::try_from(value).map_err(|_| Error::argument(message))
}

pub fn encode_jpeg(width: u32, height: u32, rgba: &[u8], quality: u8) -> Result<Vec<u8>> {
    check_len(width, height, rgba)?;
    let (wide, high) = (
        fit_u16(width, "Картинка шире 65535.")?,
        fit_u16(height, "Картинка выше 65535.")?,
    );
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, quality.clamp(1, 100));
    if quality <= 90 {
        encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_2_2);
    }
    let encoded = encoder.encode(&drop_alpha(rgba), wide, high, jpeg_encoder::ColorType::Rgb);
    encoded.map_err(|e| refusal("JPEG не записан", e))?;
    Ok(out)
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47])
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8])
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
}

type Reader = fn(&[u8]) -> Result<Decoded>;

/// Форматы в порядке проверки подписи: (узнаёт ли подпись, читалка).
const READERS: [(fn(&[u8]) -> bool, Reader); 3] = [
    (is_png, decode_png),
    (is_jpeg, decode_jpeg),
    (is_webp, decode_webp),
];

pub fn decode(bytes: &[u8]) -> Result<Decoded> {
    let Some((_, read)) = READERS.iter().find(|(knows, _)| knows(bytes)) else {
        return Err(Error::argument("Картинка не PNG, не JPEG и не WebP."));
    };
    read(bytes)
}

/// RGBA из кадра PNG после `normalize_to_color8`.
fn png_rgba(color: png::ColorType, pixels: &[u8]) -> Result<Vec<u8>> {
    use png::ColorType as C;
    let rgba = match color {
        C::Rgba => pixels.to_vec(),
        C::Rgb => repack(pixels, 3, opaque_rgb),
        C::Grayscale => repack(pixels, 1, |g| gray_pixel(g[0], OPAQUE)),
        C::GrayscaleAlpha => repack(pixels, 2, |ga| gray_pixel(ga[0], ga[1])),
        C::Indexed => return Err(Error::argument("PNG с палитрой не развёрнут.")),
    };
    Ok(rgba)
}

fn decode_png(bytes: &[u8]) -> Result<Decoded> {
    let failed = |e: png::DecodingError| refusal("PNG не прочитан", e);
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(failed)?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buffer).map_err(failed)?;
    Ok(Decoded {
        width: frame.width,
        height: frame.height,
        rgba: png_rgba(frame.color_type, &buffer[..frame.buffer_size()])?,
    })
}

/// RGBA из пикселей JPEG в заявленном формате.
fn jpeg_rgba(format: jpeg_decoder::PixelFormat, pixels: &[u8]) -> Vec<u8> {
    use jpeg_decoder::PixelFormat as F;
    match format {
        F::RGB24 => repack(pixels, 3, opaque_rgb),
        F::L8 => repack(pixels, 1, |g| gray_pixel(g[0], OPAQUE)),
        F::L16 => repack(pixels, 2, |pair| gray_pixel(pair[0], OPAQUE)),
        F::CMYK32 => repack(pixels, 4, |cmyk| {
            let key = u32::from(cmyk[3]);
            let scaled = |c: u8| (u32::from(c) * key / 255) as u8;
            [scaled(cmyk[0]), scaled(cmyk[1]), scaled(cmyk[2]), OPAQUE]
        }),
    }
}

fn decode_jpeg(bytes: &[u8]) -> Result<Decoded> {
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    let pixels = decoder
        .decode()
        .map_err(|e| refusal("JPEG не прочитан", e))?;
    let Some(info) = decoder.info() else {
        return Err(Error::argument("JPEG без заголовка."));
    };
    Ok(Decoded {
        width: u32::from(info.width),
        height: u32::from(info.height),
        rgba: jpeg_rgba(info.pixel_format, &pixels),
    })
}

fn decode_webp(bytes: &[u8]) -> Result<Decoded> {
    let failed = |e: image_webp::DecodingError| refusal("WebP не прочитан", e);
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(bytes)).map_err(failed)?;
    let ((width, height), has_alpha) = (decoder.dimensions(), decoder.has_alpha());
    let Some(size) = decoder.output_buffer_size() else {
        return Err(Error::argument("WebP слишком велик."));
    };
    let mut pixels = vec![0; size];
    decoder.read_image(&mut pixels).map_err(failed)?;
    if !has_alpha {
        pixels = repack(&pixels, 3, opaque_rgb);
    }
    Ok(Decoded {
        width,
        height,
        rgba: pixels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use png::{BitDepth, ColorType};

    const SAMPLE: [u8; 16] = *b"\xff\0\0\xff\0\xff\0\x80\0\0\xff\xff\n\x14\x1e\0";

    /// Байты из записи «255 0x1f …»: числа десятичные или с `0x`, разделители любые.
    fn octets(text: &str) -> Vec<u8> {
        let number = |item: &str| match item.strip_prefix("0x") {
            Some(hex) => u8::from_str_radix(hex, 16),
            None => item.parse(),
        };
        text.split(|c: char| c == ',' || c.is_whitespace())
            .filter(|item| !item.is_empty())
            .map(|item| number(item).unwrap())
            .collect()
    }

    /// Текст отказа; заодно проверяет, что отказ — «неверный аргумент».
    fn refuse<T: std::fmt::Debug>(outcome: Result<T>) -> String {
        let failure = outcome.unwrap_err();
        assert_eq!(failure.kind, Kind::Argument);
        failure.message
    }

    /// Картинка «Г64» из описания.
    fn g64() -> Vec<u8> {
        let mut pixels = Vec::with_capacity(64 * 64 * 4);
        for y in 0..64u32 {
            for x in 0..64u32 {
                pixels.extend([4 * x, 4 * y, 4 * (x ^ y), 255].map(|v| v as u8));
            }
        }
        pixels
    }

    /// Картинка «Д16».
    fn d16() -> Vec<u8> {
        let mut pixels = Vec::new();
        for i in 0..256u32 {
            pixels.extend_from_slice(&[(16 * (i % 16)) as u8, 100, 200, 255]);
        }
        pixels
    }

    /// Описание PNG-файла для проверки чтения.
    struct Spec<'a> {
        color: ColorType,
        depth: BitDepth,
        width: u32,
        palette: Option<&'a [u8]>,
        trns: Option<&'a [u8]>,
    }

    impl<'a> Spec<'a> {
        fn new(color: ColorType, depth: BitDepth, width: u32) -> Self {
            Spec {
                color,
                depth,
                width,
                palette: None,
                trns: None,
            }
        }

        fn with_palette(self, palette: &'a [u8]) -> Self {
            Spec {
                palette: Some(palette),
                ..self
            }
        }

        fn with_trns(self, trns: &'a [u8]) -> Self {
            Spec {
                trns: Some(trns),
                ..self
            }
        }

        /// Однострочный PNG с этими данными.
        fn file(&self, data: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            let mut enc = png::Encoder::new(&mut out, self.width, 1);
            enc.set_color(self.color);
            enc.set_depth(self.depth);
            if let Some(palette) = self.palette {
                enc.set_palette(palette);
            }
            if let Some(trns) = self.trns {
                enc.set_trns(trns);
            }
            let mut writer = enc.write_header().unwrap();
            writer.write_image_data(data).unwrap();
            writer.finish().unwrap();
            out
        }

        fn read(&self, data: &[u8]) -> Vec<u8> {
            decode(&self.file(data)).unwrap().rgba
        }
    }

    fn plain(color: ColorType, depth: BitDepth, width: u32, data: &[u8]) -> Vec<u8> {
        Spec::new(color, depth, width).read(data)
    }

    #[test]
    fn png_round_trip_keeps_pixels() {
        let back = decode(&encode(2, 2, &SAMPLE).unwrap()).unwrap();
        assert_eq!(
            (back.width, back.height, back.rgba.as_slice()),
            (2, 2, &SAMPLE[..])
        );
    }

    #[test]
    fn opaque_png_round_trips_as_rgb() {
        let px = octets("1 2 3 255 4 5 6 255");
        let file = encode(2, 1, &px).unwrap();
        let header = &file[16..33];
        assert_eq!(file.len(), 75);
        assert_eq!(&file[24..26], &[8, 2]);
        assert_eq!(
            header,
            octets("0 0 0 2 0 0 0 1 8 2 0 0 0 0x7b 0x40 0xe8 0xdd")
        );
        assert_eq!(decode(&file).unwrap().rgba, px);
    }

    #[test]
    fn png_known_bytes() {
        let file = encode(2, 2, &SAMPLE).unwrap();
        assert_eq!((file.len(), file[25]), (86, 6));
        assert_eq!(
            sha256_hex(&file),
            "a5b344c96bb1eeb75d66c6d5976a348cb4567477c8c816eb2cef5253c41eff46"
        );
        assert_eq!(encode(1, 1, &[9, 8, 7, 254]).unwrap()[25], 6);

        let rgb = octets(
            "0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a  0 0 0 0x0d 0x49 0x48 0x44 0x52
             0 0 0 1  0 0 0 1  8 2 0 0 0  0x90 0x77 0x53 0xde
             0 0 0 0x0f 0x49 0x44 0x41 0x54  0x78 0x01 0x01 0x04 0 0xfb 0xff 0 1 2 3
             0 0x0e 0 0x07 0x2d 0xa2 0x33 0xec  0 0 0 0 0x49 0x45 0x4e 0x44 0xae 0x42 0x60 0x82",
        );
        let rgba = octets(
            "0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a  0 0 0 0x0d 0x49 0x48 0x44 0x52
             0 0 0 1  0 0 0 1  8 6 0 0 0  0x1f 0x15 0xc4 0x89
             0 0 0 0x10 0x49 0x44 0x41 0x54  0x78 0x01 0x01 0x05 0 0xfa 0xff 0 1 2 3 4
             0 0x19 0 0x0b 0xb9 0xb0 0xe3 0xeb  0 0 0 0 0x49 0x45 0x4e 0x44 0xae 0x42 0x60 0x82",
        );
        for (pixel, expected) in [([1, 2, 3, 255], rgb), ([1, 2, 3, 4], rgba)] {
            assert_eq!(encode(1, 1, &pixel).unwrap(), expected);
        }
    }

    #[test]
    fn png_write_refusals() {
        let zero_width = "PNG не записан: Zero width not allowed";
        for (width, height, pixels) in [(0, 0, &[][..]), (0, 5, &[][..])] {
            assert_eq!(refuse(encode(width, height, pixels)), zero_width);
        }
        for (width, height, len) in [(2, 2, 4), (1, 1, 8)] {
            assert_eq!(refuse(encode(width, height, &vec![0; len])), MSG_SIZE);
        }
    }

    #[test]
    #[allow(deprecated)]
    fn png_compression_levels() {
        let pic = g64();
        let table = [
            (
                png::Compression::Fast,
                7233,
                "edab8304b9b73de948da4033ad26be72f81ae6eb052b94db6d3cced8e690c1b3",
            ),
            (
                png::Compression::Default,
                601,
                "d0456747567122b6c4e35f58a21c7dbb9d08d7b8717b076226854003b3555bc3",
            ),
            (
                png::Compression::Best,
                551,
                "89cde6e0b78615c9d3c85c4d04fd7634e283b5e861cf04c185573d3249c81519",
            ),
        ];
        for (level, len, digest) in table {
            let file = encode_with(64, 64, &pic, level).unwrap();
            assert_eq!((file.len(), sha256_hex(&file).as_str()), (len, digest));
        }
        let fast = encode_with(64, 64, &pic, png::Compression::Fast).unwrap();
        assert_eq!(fast, encode(64, 64, &pic).unwrap());
        assert_eq!(decode(&fast).unwrap().rgba, pic);
        for level in [png::Compression::Huffman, png::Compression::Rle] {
            assert_eq!(encode_with(64, 64, &pic, level).unwrap().len(), 12420);
        }

        let mut alpha = pic;
        alpha
            .chunks_exact_mut(4)
            .step_by(7)
            .for_each(|px| px[3] = 100);
        let file = encode(64, 64, &alpha).unwrap();
        assert_eq!(file.len(), 9716);
        assert_eq!(
            sha256_hex(&file),
            "224814fec3d08b35cd121e878b8149c13b2b542d4b18c4469e5c2dbb74dae6ea"
        );
    }

    #[test]
    fn jpeg_round_trip_stays_close() {
        let pic = d16();
        let file = encode_jpeg(16, 16, &pic, 95).unwrap();
        assert_eq!(&file[..2], &[0xff, 0xd8]);
        let back = decode(&file).unwrap();
        assert_eq!((back.width, back.height), (16, 16));
        let worst = back
            .rgba
            .iter()
            .zip(&pic)
            .map(|(a, b)| a.abs_diff(*b))
            .max();
        assert!(worst.unwrap() < 40, "{worst:?}");
        assert_eq!(
            &back.rgba[..12],
            octets("1 100 201 255 15 100 199 255 32 100 199 255")
        );
    }

    #[test]
    fn jpeg_quality_table() {
        let pic = d16();
        let table = [
            (
                1u8,
                631usize,
                "6b66835914d403936e77b9b3cf8be47cd6652e687cc6cb3c75ad49c370ae3f43",
            ),
            (
                50,
                642,
                "eda833e3710feef242aba7bd9f246f7b44a6a7d3803bf9a0b63a71cf9839485b",
            ),
            (
                90,
                657,
                "56d560aee074ccf756d145788743ad451afc86e14d7c16ef7acfa74ba8010dd2",
            ),
            (
                91,
                687,
                "335a992fa7728fc05fa01317f1fb469d5a4b5b7568a63c2f3a42a82548a0def4",
            ),
            (
                95,
                698,
                "b097a1c3b704bb7324f68c06c0a514f283292668f00397deff840aba1e11fd9f",
            ),
            (
                100,
                755,
                "214236b5fd353ea849b1ab785ed32188fe26159b53de5f57b091e0855d661880",
            ),
        ];
        for (quality, len, digest) in table {
            let file = encode_jpeg(16, 16, &pic, quality).unwrap();
            assert_eq!(file.len(), len, "q{quality}");
            assert_eq!(sha256_hex(&file), digest, "q{quality}");
            assert!(file.ends_with(&[0xff, 0xd9]));
            let sof = file.windows(2).position(|w| w == [0xff, 0xc0]).unwrap();
            let sampling = if quality <= 90 { 0x22 } else { 0x11 };
            assert_eq!(file[sof + 11], sampling);
        }
        for (given, same_as) in [(0, 1), (255, 100)] {
            assert_eq!(
                encode_jpeg(16, 16, &pic, given).unwrap(),
                encode_jpeg(16, 16, &pic, same_as).unwrap()
            );
        }
    }

    #[test]
    fn jpeg_header_and_limits() {
        let file = encode_jpeg(2, 2, &SAMPLE, 90).unwrap();
        assert_eq!(file.len(), 741);
        assert_eq!(
            sha256_hex(&file),
            "ffe243dd6b28589bbd2e8a27976d4e0994519993065bedaba7650000b52885a9"
        );
        assert_eq!(
            &file[..24],
            octets("0xff 0xd8 0xff 0xe0 0 0x10 0x4a 0x46 0x49 0x46 0 1 2 0 0 1 0 1 0 0 0xff 0xc0 0 0x11")
        );
        assert_eq!(refuse(encode_jpeg(2, 2, &[0; 4], 90)), MSG_SIZE);
        let wide = vec![0; 65536 * 4];
        let refusals = [
            (encode_jpeg(65536, 1, &wide, 90), "Картинка шире 65535."),
            (encode_jpeg(1, 65536, &wide, 90), "Картинка выше 65535."),
            (
                encode_jpeg(0, 0, &[], 90),
                "JPEG не записан: Image dimensions must be non zero: 0x0",
            ),
        ];
        for (outcome, text) in refusals {
            assert_eq!(refuse(outcome), text);
        }
        assert_eq!(
            encode_jpeg(65535, 1, &wide[..65535 * 4], 90).unwrap().len(),
            17011
        );
        assert_eq!(
            encode_jpeg(1, 1, &[10, 20, 30, 0], 90).unwrap(),
            encode_jpeg(1, 1, &[10, 20, 30, 255], 90).unwrap()
        );
    }

    #[test]
    fn unknown_picture_is_refused() {
        let msg = "Картинка не PNG, не JPEG и не WebP.";
        let inputs: [&[u8]; 4] = [
            b"not a picture at all",
            &[],
            b"RIFF\0\0\0\0WEBP",
            b"RIFF\0\0\0\0WAVEfmt ",
        ];
        for bytes in inputs {
            assert_eq!(refuse(decode(bytes)), msg);
        }
    }

    #[test]
    fn broken_pictures_report_the_decoder() {
        let eof = "PNG не прочитан: unexpected end of file";
        let file = encode(2, 2, &SAMPLE).unwrap();
        let truncated = [
            octets("0x89 0x50 0x4e 0x47"),
            octets("0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a"),
            file[..file.len() - 10].to_vec(),
            file[..20].to_vec(),
        ];
        for bytes in &truncated {
            assert_eq!(refuse(decode(bytes)), eof);
        }
        let mut bad = file.clone();
        bad[50] ^= 0x55;
        let shown = refuse(decode(&bad));
        assert!(shown.starts_with("PNG не прочитан: CRC error"), "{shown}");

        let mut tiny = b"RIFF\0\0\0\0WEBP".to_vec();
        tiny.push(0);
        let others = [
            (
                octets("0xff 0xd8"),
                "JPEG не прочитан: failed to fill whole buffer",
            ),
            (
                octets("0xff 0xd8 0xff 0xe0 0 1 2"),
                "JPEG не прочитан: invalid JPEG format: encountered APP(0) with invalid length 1",
            ),
            (
                tiny,
                "WebP не прочитан: IO Error: failed to fill whole buffer",
            ),
        ];
        for (bytes, text) in &others {
            assert_eq!(&refuse(decode(bytes)), text);
        }
    }

    #[test]
    fn png_color_types() {
        use BitDepth as D;
        use ColorType as C;
        let rows = [
            (
                C::Grayscale,
                D::Eight,
                2,
                "10 200",
                "10 10 10 255 200 200 200 255",
            ),
            (
                C::GrayscaleAlpha,
                D::Eight,
                2,
                "10 20 200 100",
                "10 10 10 20 200 200 200 100",
            ),
            (C::Rgb, D::Eight, 1, "1 2 3", "1 2 3 255"),
            (
                C::Rgb,
                D::Sixteen,
                1,
                "0x12 0x34 0x56 0x78 0x9a 0xbc",
                "0x12 0x56 0x9a 255",
            ),
            (
                C::Rgba,
                D::Sixteen,
                1,
                "0x12 0x34 0x56 0x78 0x9a 0xbc 0xde 0xf0",
                "0x12 0x56 0x9a 0xde",
            ),
            (
                C::Grayscale,
                D::Sixteen,
                1,
                "0x80 0x01",
                "0x80 0x80 0x80 255",
            ),
            (
                C::GrayscaleAlpha,
                D::Sixteen,
                1,
                "0x11 0x22 0x33 0x44",
                "0x11 0x11 0x11 0x33",
            ),
        ];
        for (color, depth, width, data, want) in rows {
            let got = plain(color, depth, width, &octets(data));
            assert_eq!(got, octets(want), "{color:?} {depth:?}");
        }
        // Малые глубины: серые уровни растягиваются на 0..=255.
        let levels = |depth, width, data: &[u8]| -> Vec<u8> {
            let rgba = plain(C::Grayscale, depth, width, data);
            assert!(rgba
                .chunks(4)
                .all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
            rgba.chunks(4).map(|p| p[0]).collect()
        };
        assert_eq!(
            levels(D::One, 8, &[0b1010_0000]),
            octets("255 0 255 0 0 0 0 0")
        );
        assert_eq!(levels(D::Two, 4, &[0b0001_1011]), [0x00, 0x55, 0xaa, 0xff]);
        assert_eq!(levels(D::Four, 2, &[0x0f]), [0x00, 0xff]);
    }

    #[test]
    fn png_transparency_and_palette() {
        use BitDepth as D;
        use ColorType as C;
        let palette = octets("10 20 30 40 50 60");
        let grays = octets("0 0 0 1 1 1 2 2 2 3 3 3");
        let rgb_key = Spec::new(C::Rgb, D::Eight, 1).with_trns(&[0, 1, 0, 2, 0, 3]);
        let indexed = Spec::new(C::Indexed, D::Eight, 2).with_palette(&palette);
        let alpha = Spec::new(C::Indexed, D::Eight, 2)
            .with_palette(&palette)
            .with_trns(&[5]);
        let two_bit = Spec::new(C::Indexed, D::Two, 4).with_palette(&grays);

        assert_eq!(rgb_key.read(&[1, 2, 3]), [1, 2, 3, 0]);
        let wanted = [
            (&indexed, "40 50 60 255 10 20 30 255"),
            (&alpha, "40 50 60 255 10 20 30 5"),
        ];
        for (spec, pixels) in wanted {
            assert_eq!(spec.read(&[1, 0]), octets(pixels));
        }
        assert_eq!(
            two_bit.read(&[0b0001_1011]),
            octets("0 0 0 255 1 1 1 255 2 2 2 255 3 3 3 255")
        );
    }

    fn jpeg_of(data: &[u8], color: jpeg_encoder::ColorType, w: u16, h: u16) -> Vec<u8> {
        let mut out = Vec::new();
        let encoder = jpeg_encoder::Encoder::new(&mut out, 100);
        encoder.encode(data, w, h, color).unwrap();
        out
    }

    #[test]
    fn jpeg_pixel_formats() {
        use jpeg_encoder::ColorType as C;
        let gray: Vec<u8> = (0..64u8).map(|i| i * 4).collect();
        let back = decode(&jpeg_of(&gray, C::Luma, 8, 8)).unwrap();
        assert_eq!((back.width, back.height), (8, 8));
        for (i, px) in back.rgba.chunks(4).enumerate().take(3) {
            let v = (i * 4) as u8;
            assert_eq!(px, [v, v, v, 255]);
        }

        let cmyk = [200u8, 100, 50, 128].repeat(64);
        let first = |data: &[u8]| decode(&jpeg_of(data, C::Cmyk, 8, 8)).unwrap().rgba[..4].to_vec();
        assert_eq!(first(&cmyk), [100, 50, 25, 255]);
        assert_eq!(first(&[255; 256]), [255; 4]);
    }

    fn webp_of(data: &[u8], color: image_webp::ColorType, w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let encoder = image_webp::WebPEncoder::new(&mut out);
        encoder.encode(data, w, h, color).unwrap();
        out
    }

    #[test]
    fn webp_variants() {
        use image_webp::ColorType as C;
        let back = decode(&webp_of(&SAMPLE, C::Rgba8, 2, 2)).unwrap();
        assert_eq!(
            (back.width, back.height, back.rgba.as_slice()),
            (2, 2, &SAMPLE[..])
        );
        let rows = [
            ("1 2 3 4 5 6", C::Rgb8, 2, "1 2 3 255 4 5 6 255"),
            ("77", C::L8, 1, "77 77 77 255"),
            ("77 5 9 6", C::La8, 2, "77 77 77 5 9 9 9 6"),
        ];
        for (data, color, width, want) in rows {
            let file = webp_of(&octets(data), color, width, 1);
            assert_eq!(decode(&file).unwrap().rgba, octets(want));
        }
        let file = webp_of(&SAMPLE, C::Rgba8, 2, 2);
        assert!(refuse(decode(&file[..file.len() - 4])).starts_with("WebP не прочитан"));
    }

    #[test]
    fn png_circle_keeps_hidden_colour() {
        let back = decode(&encode(2, 2, &SAMPLE).unwrap()).unwrap();
        assert_eq!(&back.rgba[12..], &[10, 20, 30, 0]);
    }
}
