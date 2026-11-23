//! Декларация вершины RAGE: раскладка семантик и чтение компонентов.

use crate::error::{Error, Result};

/// Список «имя = значение» одного типа: так записаны и семантики, и коды типов.
macro_rules! codes {
    ($ty:ty; $($name:ident = $value:expr),+ $(,)?) => {
        $(pub const $name: $ty = $value;)+
    };
}

codes!(
    usize;
    POSITION = 0,
    BLEND_WEIGHTS = 1,
    BLEND_INDICES = 2,
    NORMAL = 3,
    COLOUR0 = 4,
    COLOUR1 = 5,
    UV0 = 6,
    UV1 = 7,
);

codes!(
    u8;
    HALF2 = 1,
    FLOAT = 2,
    HALF4 = 3,
    FLOAT2 = 5,
    FLOAT3 = 6,
    FLOAT4 = 7,
    UBYTE4 = 8,
    COLOUR = 9,
    RGBA8_SNORM = 10,
);

const SEMANTICS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Element {
    pub offset: usize,
    pub type_code: u8,
    pub size: usize,
}

#[derive(Debug, Clone, Default)]
pub struct Layout {
    slots: [Option<Element>; SEMANTICS],
    pub stride: usize,
}

impl Layout {
    pub fn get(&self, semantic: usize) -> Option<Element> {
        match self.slots.get(semantic) {
            Some(slot) => *slot,
            None => None,
        }
    }
}

/// Размер элемента по коду типа; для неопределённых кодов — 0.
fn type_size(code: u8) -> usize {
    let by_size: [(usize, &[u8]); 4] = [
        (4, &[HALF2, FLOAT, UBYTE4, COLOUR, RGBA8_SNORM]),
        (8, &[HALF4, FLOAT2]),
        (12, &[FLOAT3]),
        (16, &[FLOAT4]),
    ];
    by_size
        .iter()
        .find(|(_, codes)| codes.contains(&code))
        .map_or(0, |&(size, _)| size)
}

/// Раскладка для описания: код типа, которого формат не знает, получает элемент нулевого
/// размера, а смещения за ним не сдвигаются. Годится показать содержимое декларации, но не
/// читать по ней вершины: для чтения есть `layout`.
pub fn layout_lenient(flags: u32, types: u64) -> Layout {
    let mut result = Layout::default();
    let present = (0..SEMANTICS).filter(|&semantic| flags >> semantic & 1 != 0);
    for semantic in present {
        let type_code = (types >> (semantic * 4) & 0xf) as u8;
        let size = type_size(type_code);
        result.slots[semantic] = Some(Element {
            offset: result.stride,
            type_code,
            size,
        });
        result.stride += size;
    }
    result
}

/// Раскладка для чтения вершин. Код типа, которого формат не знает, отказывает: элемент
/// нулевого размера сдвинул бы все смещения за ним.
pub fn layout(flags: u32, types: u64) -> Result<Layout> {
    let found = layout_lenient(flags, types);
    let unknown = (0..SEMANTICS).find_map(|semantic| found.get(semantic).filter(|e| e.size == 0));
    match unknown {
        Some(element) => Err(Error::broken(format!(
            "Неизвестный тип данных вершины: код {}.",
            element.type_code
        ))),
        None => Ok(found),
    }
}

pub fn half_to_float(bits: u16) -> f32 {
    let sign = u32::from(bits >> 15);
    let exponent = u32::from(bits >> 10 & 0x1f);
    let fraction = u32::from(bits & 0x3ff);
    if exponent == 0 {
        let magnitude = fraction as f32 / 16_777_216.0;
        return if sign == 1 { -magnitude } else { magnitude };
    }
    if exponent == 31 {
        return if fraction == 0 {
            f32::from_bits(sign << 31 | 0x7f80_0000)
        } else {
            f32::NAN
        };
    }
    f32::from_bits(sign << 31 | (exponent + 112) << 23 | fraction << 13)
}

/// Ширина одного компонента в байтах; `None` для кодов, которые не читаются.
fn component_width(type_code: u8) -> Option<usize> {
    match type_code {
        FLOAT | FLOAT2 | FLOAT3 | FLOAT4 => Some(4),
        HALF2 | HALF4 => Some(2),
        UBYTE4 | COLOUR | RGBA8_SNORM => Some(1),
        _ => None,
    }
}

/// Один компонент из `chunk` по коду типа.
fn decode_component(type_code: u8, chunk: &[u8]) -> f32 {
    match type_code {
        HALF2 | HALF4 => half_to_float(u16::from_le_bytes([chunk[0], chunk[1]])),
        UBYTE4 | COLOUR => f32::from(chunk[0]) / 255.0,
        RGBA8_SNORM => (f32::from(chunk[0] as i8) / 127.0).max(-1.0),
        _ => f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]),
    }
}

pub fn read_components(vertex: &[u8], element: Element, out: &mut [f32]) -> bool {
    let Some(width) = component_width(element.type_code) else {
        return false;
    };
    // Переполнение при расчёте конца чтения — такой же отказ, как выход за вершину.
    let end = out
        .len()
        .checked_mul(width)
        .and_then(|bytes| element.offset.checked_add(bytes));
    let Some(raw) = end.and_then(|end| vertex.get(element.offset..end)) else {
        return false;
    };
    for (value, chunk) in out.iter_mut().zip(raw.chunks_exact(width)) {
        *value = decode_component(element.type_code, chunk);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(offset: usize, type_code: u8, size: usize) -> Element {
        Element {
            offset,
            type_code,
            size,
        }
    }

    fn floats(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    /// Читает `count` компонентов; `None`, когда чтение отказало (и `out` цел).
    fn read(bytes: &[u8], offset: usize, code: u8, count: usize) -> Option<Vec<f32>> {
        let mut out = vec![9.0; count];
        let ok = read_components(bytes, el(offset, code, 0), &mut out);
        if !ok {
            assert!(out.iter().all(|&v| v == 9.0), "out тронут при отказе");
        }
        ok.then_some(out)
    }

    /// Сверяет результат `read` с ожидаемым (`None` — отказ).
    fn expect_read(bytes: &[u8], code: u8, count: usize, expected: Option<&[f32]>) {
        assert_eq!(read(bytes, 0, code, count).as_deref(), expected);
    }

    /// Строка «ключ значение, ключ значение, …» из шестнадцатеричных пар.
    fn hex_pairs(text: &str) -> Vec<(u16, u32)> {
        text.split(',')
            .map(|pair| {
                let (bits, expected) = pair.trim().split_once(' ').unwrap();
                (
                    u16::from_str_radix(bits, 16).unwrap(),
                    u32::from_str_radix(expected, 16).unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn read_whose_end_overflows_is_refused() {
        let bytes = floats(&[1.0, 2.0, 3.0]);
        assert_eq!(read(&bytes, usize::MAX - 1, FLOAT, 2), None);
        assert_eq!(read(&bytes, usize::MAX, HALF2, 2), None);
        assert_eq!(read(&bytes, 4, FLOAT, 2), Some(vec![2.0, 3.0]));
    }

    #[test]
    fn layout_offsets_accumulate_in_semantic_order() {
        let flags = 1 << POSITION | 1 << NORMAL | 1 << UV0;
        let types = u64::from(FLOAT3) | u64::from(FLOAT3) << 12 | u64::from(FLOAT2) << 24;
        let l = layout(flags, types).unwrap();
        for (semantic, offset) in [(POSITION, 0), (NORMAL, 12), (UV0, 24)] {
            assert_eq!(l.get(semantic).unwrap().offset, offset);
        }
        assert_eq!(l.stride, 32);
        assert!(l.get(UV1).is_none());
    }

    #[test]
    fn layout_every_type_code() {
        let sizes = [0, 4, 4, 8, 0, 8, 12, 16, 4, 4, 4, 0, 0, 0, 0, 0];
        for (code, size) in sizes.into_iter().enumerate() {
            match size {
                // Неизвестный код ломал бы все смещения за ним: раскладка отказывает.
                0 => {
                    let error = layout(1, code as u64).unwrap_err();
                    assert_eq!(
                        (error.kind, error.message),
                        (
                            crate::error::Kind::Broken,
                            format!("Неизвестный тип данных вершины: код {code}.")
                        ),
                        "код {code}"
                    );
                }
                size => {
                    let l = layout(1, code as u64).unwrap();
                    assert_eq!(l.stride, size, "код {code}");
                    assert_eq!(l.get(0), Some(el(0, code as u8, size)));
                }
            }
        }
    }

    #[test]
    fn layout_lenient_describes_every_code() {
        let sizes = [0, 4, 4, 8, 0, 8, 12, 16, 4, 4, 4, 0, 0, 0, 0, 0];
        for (code, size) in sizes.into_iter().enumerate() {
            let l = layout_lenient(1, code as u64);
            assert_eq!(l.stride, size, "код {code}");
            assert_eq!(l.get(0), Some(el(0, code as u8, size)));
        }
        // неопределённый тип: элемент есть, смещение не сдвигает
        let l = layout_lenient(0b10101, 6 | 4 << 8 | 8 << 16);
        let expected = [(0, el(0, 6, 12)), (2, el(12, 4, 0)), (4, el(12, 8, 4))];
        for (semantic, element) in expected {
            assert_eq!(l.get(semantic), Some(element));
        }
        assert_eq!(l.stride, 16);
    }

    #[test]
    fn layout_masks_and_defaults() {
        let nothing = |l: &Layout| (0..16).all(|i| l.get(i).is_none());
        let l = layout(0, 0).unwrap();
        assert!(nothing(&l));
        assert_eq!(l.stride, 0);

        let l = layout(0xFFFF, 0x7777_7777_7777_7777).unwrap();
        assert_eq!((l.stride, l.get(15)), (256, Some(el(240, 7, 16))));

        let l = layout(0xFFFF_0001, 6).unwrap();
        assert_eq!(l.stride, 12);
        assert!([16, 99].iter().all(|&i| l.get(i).is_none()));

        let l = Layout::default();
        assert_eq!(l.stride, 0);
        assert!(nothing(&l));
    }

    #[test]
    fn layout_mixed_semantics() {
        let flags = 1 | 1 << 3 | 1 << 4 | 1 << 6 | 1 << 7;
        let types = 6 | 6 << 12 | 9 << 16 | 1 << 24 | 5 << 28;
        let l = layout(flags, types).unwrap();
        assert_eq!(l.stride, 40);
        let expected = [
            (0, el(0, 6, 12)),
            (3, el(12, 6, 12)),
            (4, el(24, 9, 4)),
            (6, el(28, 1, 4)),
            (7, el(32, 5, 8)),
        ];
        for (semantic, element) in expected {
            assert_eq!(l.get(semantic), Some(element));
        }

        // неопределённый тип посреди раскладки: отказ, а не элемент нулевого размера
        let error = layout(0b10101, 6 | 4 << 8 | 8 << 16).unwrap_err();
        assert_eq!(error.message, "Неизвестный тип данных вершины: код 4.");
        // тот же неизвестный код у семантики, которой нет во флагах, раскладку не портит
        let l = layout(0b10001, 6 | 4 << 8 | 8 << 16).unwrap();
        assert_eq!(l.get(0), Some(el(0, 6, 12)));
        assert_eq!(l.get(4), Some(el(12, 8, 4)));
        assert_eq!(l.stride, 16);
    }

    #[test]
    fn halves() {
        let table = hex_pairs(
            "0000 00000000, 8000 80000000, 3c00 3f800000, bc00 bf800000, c000 c0000000, \
             7bff 477fe000, 0001 33800000, 03ff 387fc000, 0400 38800000, 7c00 7f800000, \
             fc00 ff800000, 7e00 7fc00000, 7c01 7fc00000, ffff 7fc00000, 3555 3eaaa000, \
             0200 38000000, 8001 b3800000, 5640 42c80000",
        );
        assert_eq!(table.len(), 18);
        for (bits, expected) in table {
            assert_eq!(half_to_float(bits).to_bits(), expected, "{bits:#06x}");
        }
        assert_eq!(half_to_float(0x7bff), 65504.0);
        assert!((half_to_float(0x3555) - 0.33325195).abs() < 1e-6);
    }

    #[test]
    fn float_components() {
        expect_read(
            &floats(&[1.0, -2.5, 3.25]),
            FLOAT3,
            3,
            Some(&[1.0, -2.5, 3.25]),
        );
        let mut bytes = vec![0; 4];
        bytes.extend(floats(&[0.5, 1.5]));
        assert_eq!(read(&bytes, 4, FLOAT2, 2), Some(vec![0.5, 1.5]));
        expect_read(&floats(&[1., 2., 3., 4.]), FLOAT4, 2, Some(&[1.0, 2.0]));
        expect_read(&floats(&[1.0]), FLOAT, 4, None);
        expect_read(&[0; 12], FLOAT2, 3, Some(&[0.0; 3]));
    }

    #[test]
    fn half_and_byte_components() {
        expect_read(
            &[0x00, 0x3c, 0x00, 0xc0, 0x00, 0x38, 0xff, 0x7b],
            HALF4,
            4,
            Some(&[1.0, -2.0, 0.5, 65504.0]),
        );
        expect_read(&[0x00, 0x3c, 0x00, 0xc0], HALF2, 3, None);
        expect_read(&[0x00, 0x3c, 0x00, 0xc0], HALF2, 2, Some(&[1.0, -2.0]));
        let bytes = [0xff, 0x00, 0x33, 0x80];
        expect_read(&bytes, UBYTE4, 4, Some(&[1.0, 0.0, 0.2, 0.5019608]));
        expect_read(&bytes, COLOUR, 3, Some(&[1.0, 0.0, 0.2]));
        expect_read(&[255, 0, 51, 255], COLOUR, 4, Some(&[1.0, 0.0, 0.2, 1.0]));
        expect_read(&[1], COLOUR, 4, None);
        expect_read(
            &[0x7f, 0x80, 0x81, 0x00],
            RGBA8_SNORM,
            4,
            Some(&[1.0, -1.0, -1.0, 0.0]),
        );
        expect_read(
            &[0xff, 0x01, 0xc0, 0x40],
            RGBA8_SNORM,
            4,
            Some(&[-0.007874016, 0.007874016, -0.503937, 0.503937]),
        );
        expect_read(
            &[1, 2, 3, 4, 5, 6],
            UBYTE4,
            5,
            Some(&[
                0.003921569,
                0.007843138,
                0.011764706,
                0.015686275,
                0.019607844,
            ]),
        );
    }

    #[test]
    fn refusals() {
        for code in [4, 0, 11] {
            assert_eq!(read(&[0; 16], 0, code, 1), None, "код {code}");
        }
        expect_read(&[1, 2, 3], FLOAT, 1, None);
        assert_eq!(read(&[1, 2, 3, 4], 2, FLOAT, 1), None);
        expect_read(&[1, 2, 3, 4], FLOAT, 0, Some(&[]));
        expect_read(&[1, 2, 3, 4], 4, 0, None);
    }
}
