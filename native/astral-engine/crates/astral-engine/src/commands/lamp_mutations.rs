//! Правки света фонаря: разбор списка из JSON запроса, применение к записи
//! света с проверкой пределов и точная сверка готового света с правкой.
//!
//! Модуль библиотечный, команд у него нет; им пользуются `lamp_plan`,
//! `lamp_patch`, `lamp_verify`, а остальные `lamp_*` берут только `refuse`.
//! Поля правки описаны одной таблицей: разбор, запись и сверка читают её же.

use serde_json::Value as Json;

type Outcome<T> = crate::error::Result<T>;
type Lamp = rage_res::lamp_light::Light;

/// Правка одного света: набор заданных полей, пара флагов, отпечаток «до»
/// и номер света в списке огней фрагмента.
pub(super) struct Mutation {
    edits: Vec<Edit>,
    flags_value: Option<u32>,
    flags_mask: Option<u32>,
    pub(super) expected_fingerprint: String,
    pub(super) light_index: usize,
}

/// Разбор значения `lampHdMutations`: порядок запроса сохраняется.
pub(super) fn mutations_of(value: Option<&Json>) -> Outcome<Vec<Mutation>> {
    let items = match value {
        Some(Json::Array(items)) => items,
        _ => return Err(refuse("Нет правок света")),
    };
    if !matches!(items.len(), 1..=MAX_MUTATIONS) {
        return Err(refuse("Число правок вне 1…256"));
    }
    // Ошибка поля любого элемента побеждает повтор номера.
    let parsed = items
        .iter()
        .map(Mutation::from_json)
        .collect::<Outcome<Vec<_>>>()?;
    let mut numbers: Vec<usize> = parsed.iter().map(|one| one.light_index).collect();
    numbers.sort_unstable();
    if numbers.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(refuse("Номер света в плане повторяется"));
    }
    Ok(parsed)
}

/// Записывает заданные поля в порядке таблицы; первая ошибка прерывает работу, и свет остаётся прежним
/// (раньше уже записанные поля оставались: правка шла по самому свету, а не по копии).
pub(super) fn apply(light: &mut rage_res::lamp_light::Light, mutation: &Mutation) -> Outcome<()> {
    let mut staged = *light;
    mutation
        .edits
        .iter()
        .try_for_each(|edit| edit.write(&mut staged))?;
    flag_pair(mutation)?
        .into_iter()
        .for_each(|(value, mask)| staged.flags = (staged.flags & !mask) | value);
    *light = staged;
    Ok(())
}

/// Пара флагов правки: значение и маска вместе (или ни одного), маска не нулевая, значение внутри маски.
/// Эту проверку делает и сверка (`assert_applied`): раньше `lamp-verify` пропускал одиночный ключ или значение вне маски,
/// которые `lamp-plan` и `lamp-patch` отклоняли (хост C# отказывает так же: «flagsValue and ownedFlagsMask must be provided together»).
fn flag_pair(mutation: &Mutation) -> Outcome<Option<(u32, u32)>> {
    match (mutation.flags_value, mutation.flags_mask) {
        (None, None) => Ok(None),
        (Some(value), Some(mask)) if mask != 0 && value & !mask == 0 => Ok(Some((value, mask))),
        (Some(_), Some(_)) => Err(refuse("Флаги вне своей маски")),
        _ => Err(refuse("Флаги и маска — вместе")),
    }
}

/// Каждое заданное поле света обязано совпасть с правкой до бита; пара флагов сначала проверяется как при применении.
pub(super) fn assert_applied(
    light: &rage_res::lamp_light::Light,
    mutation: &Mutation,
) -> Outcome<()> {
    let flags_hold = match flag_pair(mutation)? {
        Some((value, mask)) => light.flags & mask == value,
        None => true,
    };
    let fields_hold = mutation.edits.iter().all(|edit| edit.holds_in(light));
    if flags_hold && fields_hold {
        return Ok(());
    }
    Err(refuse("Правка не легла в свет точно"))
}

/// Ровно 64 байта и все они шестнадцатеричные ASCII-цифры любого регистра.
pub(super) fn is_sha256(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == SHA256_LEN && bytes.iter().all(u8::is_ascii_hexdigit)
}

/// Один и тот же существующий файл под разным написанием пути: регистр букв на Windows, `..`, ссылки. Сравнение строк
/// путей этого не видит: результат `LAMP.YFT` рядом со входом `lamp.yft` перезаписывал вход.
pub(super) fn is_same_file(first: &std::path::Path, second: &std::path::Path) -> bool {
    let (first, second) = (
        std::fs::canonicalize(first).ok(),
        std::fs::canonicalize(second).ok(),
    );
    first.zip(second).is_some_and(|(left, right)| left == right)
}

/// Отказ с общим хвостом, по которому мост студии уводит команду к хосту.
pub(super) fn refuse(what: &str) -> crate::error::EngineError {
    crate::error::EngineError::argument([what, HOST_TAIL].concat())
}

const MAX_MUTATIONS: usize = 256;
const SHA256_LEN: usize = 64;
const HOST_TAIL: &str = ": пока на хосте.";

// ---------------------------------------------------------------------------
// Разбор одной правки.
// ---------------------------------------------------------------------------

impl Mutation {
    fn from_json(item: &Json) -> Outcome<Self> {
        let light_index = item
            .get("lightIndex")
            .and_then(narrow::<usize>)
            .ok_or_else(|| refuse("Номер света"))?;
        let expected_fingerprint = match item.get("expectedFingerprint").and_then(Json::as_str) {
            Some(text) if is_sha256(text) => text.to_owned(),
            _ => return Err(refuse("Отпечаток света")),
        };
        // Поля читаются строго по таблице: первая же ошибка побеждает.
        let edits = FIELDS
            .iter()
            .map(|(key, shape)| shape.read(item, key))
            .collect::<Outcome<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect();
        Ok(Self {
            edits,
            flags_value: flag_word(item, "flagsValue")?,
            flags_mask: flag_word(item, "ownedFlagsMask")?,
            expected_fingerprint,
            light_index,
        })
    }
}

/// Целое из JSON, помещающееся в узкий тип; иначе `None`.
fn narrow<T: TryFrom<u64>>(raw: &Json) -> Option<T> {
    raw.as_u64().and_then(|number| T::try_from(number).ok())
}

/// Значение ключа без `null`: и отсутствие, и `null` значат «не трогать».
fn present<'a>(item: &'a Json, key: &str) -> Option<&'a Json> {
    match item.get(key) {
        Some(Json::Null) | None => None,
        found => found,
    }
}

fn flag_word(item: &Json, key: &str) -> Result<Option<u32>, crate::error::EngineError> {
    match present(item, key) {
        None => Ok(None),
        Some(raw) => narrow::<u32>(raw)
            .map(Some)
            .ok_or_else(|| refuse("Флаги правки")),
    }
}

/// Цвет: объект с каналами `r`, `g`, `b`, каждый целый 0…255.
fn color_of(raw: &Json) -> Option<[u8; 3]> {
    let mut rgb = [0u8; 3];
    for (slot, key) in rgb.iter_mut().zip(["r", "g", "b"]) {
        *slot = raw.get(key).and_then(narrow::<u8>)?;
    }
    Some(rgb)
}

// ---------------------------------------------------------------------------
// Таблица полей.
// ---------------------------------------------------------------------------

type ColorAt = fn(&mut Lamp) -> &mut [u8; 3];
type RealAt = fn(&mut Lamp) -> &mut f32;
type ByteAt = fn(&mut Lamp) -> &mut u8;

/// Что за поле и где оно лежит в свете.
#[derive(Clone, Copy)]
enum Shape {
    Color(ColorAt),
    Real { at: RealAt, lo: f32, hi: f32 },
    Byte(ByteAt),
}

/// Заданная правка поля: значение вместе с тем, куда его класть.
#[derive(Clone, Copy)]
enum Edit {
    Color(ColorAt, [u8; 3]),
    Real {
        at: RealAt,
        lo: f32,
        hi: f32,
        value: f32,
    },
    Byte(ByteAt, u8),
}

impl Shape {
    const fn real(lo: f32, hi: f32, at: RealAt) -> Self {
        Shape::Real { at, lo, hi }
    }

    /// Что стоит под ключом: нет правки, правка или отказ своего вида.
    fn read(self, item: &Json, key: &str) -> Outcome<Option<Edit>> {
        let Some(raw) = present(item, key) else {
            return Ok(None);
        };
        let edit = match self {
            Shape::Color(at) => color_of(raw)
                .map(|rgb| Edit::Color(at, rgb))
                .ok_or_else(|| refuse("Цвет правки")),
            Shape::Real { at, lo, hi } => raw
                .as_f64()
                .map(|number| Edit::Real {
                    at,
                    lo,
                    hi,
                    value: number as f32,
                })
                .ok_or_else(|| refuse("Число правки")),
            Shape::Byte(at) => narrow::<u8>(raw)
                .map(|byte| Edit::Byte(at, byte))
                .ok_or_else(|| refuse("Байт правки")),
        };
        edit.map(Some)
    }
}

impl Edit {
    fn write(self, light: &mut Lamp) -> Outcome<()> {
        match self {
            Edit::Color(at, rgb) => *at(light) = rgb,
            Edit::Byte(at, byte) => *at(light) = byte,
            Edit::Real { at, lo, hi, value } => {
                if !(value.is_finite() && (lo..=hi).contains(&value)) {
                    return Err(refuse("Значение света вне предела"));
                }
                *at(light) = value;
            }
        }
        Ok(())
    }

    /// Свет уже хранит это значение: числа сравниваются побитно, остальное равенством.
    fn holds_in(self, light: &Lamp) -> bool {
        // `Light` копируется, так что читать через тот же доступ можно с копии.
        let mut probe = *light;
        match self {
            Edit::Color(at, rgb) => *at(&mut probe) == rgb,
            Edit::Byte(at, byte) => *at(&mut probe) == byte,
            Edit::Real { at, value, .. } => at(&mut probe).to_bits() == value.to_bits(),
        }
    }
}

/// Порядок строк — порядок разбора и порядок записи.
const FIELDS: [(&str, Shape); 14] = [
    ("color", Shape::Color(|light| &mut light.color)),
    (
        "intensity",
        Shape::real(0.0, 100_000.0, |light| &mut light.intensity),
    ),
    (
        "falloff",
        Shape::real(0.01, 10_000.0, |light| &mut light.falloff),
    ),
    (
        "falloffExponent",
        Shape::real(0.01, 128.0, |light| &mut light.falloff_exponent),
    ),
    (
        "coronaIntensity",
        Shape::real(0.0, 10_000.0, |light| &mut light.corona_intensity),
    ),
    (
        "coronaSize",
        Shape::real(0.0, 10_000.0, |light| &mut light.corona_size),
    ),
    (
        "coronaZBias",
        Shape::real(-10_000.0, 10_000.0, |light| &mut light.corona_z_bias),
    ),
    (
        "volumeIntensity",
        Shape::real(0.0, 10_000.0, |light| &mut light.volume_intensity),
    ),
    (
        "volumeSizeScale",
        Shape::real(0.0, 10_000.0, |light| &mut light.volume_size_scale),
    ),
    (
        "volumeOuterColor",
        Shape::Color(|light| &mut light.volume_outer_color),
    ),
    (
        "volumeOuterIntensity",
        Shape::real(0.0, 10_000.0, |light| &mut light.volume_outer_intensity),
    ),
    (
        "volumeOuterExponent",
        Shape::real(0.01, 128.0, |light| &mut light.volume_outer_exponent),
    ),
    (
        "lightFadeDistance",
        Shape::Byte(|light| &mut light.light_fade_distance),
    ),
    (
        "volumetricFadeDistance",
        Shape::Byte(|light| &mut light.volumetric_fade_distance),
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{EngineError, Result};
    use rage_res::lamp_light::Light;
    use serde_json::json;
    use serde_json::Value;

    const FP: &str = "0123456789abcdefABCDEF0123456789abcdefABCDEF0123456789abcdefABCD";

    fn zero_light() -> Light {
        Light::decode(&[0u8; 0xa8]).unwrap()
    }

    /// Правка из JSON: один элемент списка с номером 3 и фиксированным отпечатком.
    fn one(fields: Value) -> Result<Mutation> {
        let mut item = json!({ "lightIndex": 3, "expectedFingerprint": FP });
        for (key, value) in fields.as_object().unwrap() {
            item[key] = value.clone();
        }
        mutations_of(Some(&json!([item]))).map(|mut list| list.remove(0))
    }

    fn text(error: EngineError) -> String {
        format!("{} | {}", error.code, error.message)
    }

    // --- три теста прежнего модуля, пересказанные через разбор JSON ---

    #[test]
    fn a_planned_intensity_outside_the_envelope_goes_to_the_host() {
        let mutation = one(json!({ "intensity": 200000 })).unwrap();
        assert!(apply(&mut zero_light(), &mutation).is_err());
    }

    #[test]
    fn flags_change_only_their_own_bits() {
        let mutation = one(json!({ "flagsValue": 0b0100, "ownedFlagsMask": 0b0111 })).unwrap();
        let mut light = zero_light();
        light.flags = 0b1010;
        apply(&mut light, &mutation).unwrap();
        assert_eq!(light.flags, 0b1100);
    }

    #[test]
    fn an_applied_mutation_passes_the_exact_check() {
        let mutation =
            one(json!({ "intensity": 40, "color": { "r": 80, "g": 210, "b": 255 } })).unwrap();
        let mut light = zero_light();
        apply(&mut light, &mutation).unwrap();
        assert_eq!(light.color, [80, 210, 255]);
        assert_eq!(light.intensity, 40.0);
        assert_eq!(assert_applied(&light, &mutation), Ok(()));
    }

    // --- пробы из раздела 3.5 описания ---

    #[test]
    fn an_apply_that_fails_leaves_the_light_untouched() {
        let mutation = one(json!({
            "color": { "r": 1, "g": 2, "b": 3 }, "intensity": 5.5, "falloff": 0
        }))
        .unwrap();
        let mut light = zero_light();
        let error = apply(&mut light, &mutation).unwrap_err();
        assert_eq!(
            text(error),
            "ArgumentException | Значение света вне предела: пока на хосте."
        );
        // Раньше уже записанные поля (цвет и яркость) оставались; теперь отказ ничего не меняет.
        assert_eq!(
            (light.color, light.intensity, light.falloff),
            ([0, 0, 0], 0.0, 0.0)
        );
        assert_eq!(light.falloff_exponent, 0.0);
    }

    #[test]
    fn probe_flags() {
        let mut light = zero_light();
        light.flags = 0b1010;
        let pair = one(json!({ "intensity": 5.5, "flagsValue": 1 })).unwrap();
        let error = apply(&mut light, &pair).unwrap_err();
        assert_eq!(
            text(error),
            "ArgumentException | Флаги и маска — вместе: пока на хосте."
        );
        // Раньше яркость, записанная до отказа по паре флагов, оставалась (5.5).
        assert_eq!((light.intensity, light.flags), (0.0, 0b1010));

        let mut light = zero_light();
        light.flags = 0b1010;
        let ok = one(json!({ "flagsValue": 0b0100, "ownedFlagsMask": 0b0111 })).unwrap();
        assert_eq!(apply(&mut light, &ok), Ok(()));
        assert_eq!(light.flags, 0b1100);

        let mut light = zero_light();
        light.flags = 0b1010;
        let clear = one(json!({ "flagsValue": 0, "ownedFlagsMask": 0b0111 })).unwrap();
        apply(&mut light, &clear).unwrap();
        assert_eq!(light.flags, 0b1000);

        let mut light = zero_light();
        light.flags = 0b1010;
        let outside = one(json!({ "flagsValue": 0b1000, "ownedFlagsMask": 0b0111 })).unwrap();
        let error = apply(&mut light, &outside).unwrap_err();
        assert_eq!(
            text(error),
            "ArgumentException | Флаги вне своей маски: пока на хосте."
        );
        assert_eq!(light.flags, 0b1010);

        let mask0 = one(json!({ "flagsValue": 0, "ownedFlagsMask": 0 })).unwrap();
        assert_eq!(
            text(apply(&mut zero_light(), &mask0).unwrap_err()),
            "ArgumentException | Флаги вне своей маски: пока на хосте."
        );
    }

    #[test]
    fn probe_minus_zero_and_empty() {
        let minus = one(json!({ "intensity": -0.0 })).unwrap();
        let mut light = zero_light();
        apply(&mut light, &minus).unwrap();
        assert_eq!(light.intensity.to_bits(), 0x8000_0000);
        assert_eq!(assert_applied(&light, &minus), Ok(()));
        let plus = one(json!({ "intensity": 0 })).unwrap();
        assert!(assert_applied(&light, &plus).is_err());

        let empty = one(json!({})).unwrap();
        let mut light = zero_light();
        light.intensity = 7.0;
        let before = light;
        apply(&mut light, &empty).unwrap();
        assert_eq!(light, before);
        assert_eq!(assert_applied(&light, &empty), Ok(()));
    }

    #[test]
    fn probe_assert_applied() {
        let mutation = one(json!({ "intensity": 0.1 })).unwrap();
        let mut light = zero_light();
        apply(&mut light, &mutation).unwrap();
        assert_eq!(assert_applied(&light, &mutation), Ok(()));
        light.intensity = f32::from_bits(light.intensity.to_bits() + 1);
        assert_eq!(
            text(assert_applied(&light, &mutation).unwrap_err()),
            "ArgumentException | Правка не легла в свет точно: пока на хосте."
        );
        // пара флагов проверяется как при применении: один ключ, маска 0 и значение вне маски — отказ (раньше проходили)
        let together = "ArgumentException | Флаги и маска — вместе: пока на хосте.";
        let value_only = one(json!({ "flagsValue": 123 })).unwrap();
        assert_eq!(
            text(assert_applied(&zero_light(), &value_only).unwrap_err()),
            together
        );
        let mask_only = one(json!({ "ownedFlagsMask": 123 })).unwrap();
        assert_eq!(
            text(assert_applied(&zero_light(), &mask_only).unwrap_err()),
            together
        );
        let outside_mask = "ArgumentException | Флаги вне своей маски: пока на хосте.";
        let zero = one(json!({ "flagsValue": 0, "ownedFlagsMask": 0 })).unwrap();
        assert_eq!(
            text(assert_applied(&zero_light(), &zero).unwrap_err()),
            outside_mask
        );
        let one_masked = one(json!({ "flagsValue": 1, "ownedFlagsMask": 0 })).unwrap();
        assert_eq!(
            text(assert_applied(&zero_light(), &one_masked).unwrap_err()),
            outside_mask
        );
        let outside = one(json!({ "flagsValue": 9, "ownedFlagsMask": 7 })).unwrap();
        let mut light = zero_light();
        light.flags = 9;
        assert_eq!(
            text(assert_applied(&light, &outside).unwrap_err()),
            outside_mask
        );
    }

    #[test]
    fn probe_light_is_168_bytes() {
        assert_eq!(std::mem::size_of::<Light>(), 168);
    }

    #[test]
    fn probe_refuse_and_sha() {
        assert_eq!(text(refuse("X")), "ArgumentException | X: пока на хосте.");
        assert_eq!(text(refuse("")), "ArgumentException | : пока на хосте.");
        let cases: [(String, bool); 11] = [
            (String::new(), false),
            ("a".repeat(63), false),
            ("a".repeat(64), true),
            ("A".repeat(64), true),
            (format!("{}F{}", "a".repeat(32), "0".repeat(31)), true),
            (format!("{}g", "a".repeat(63)), false),
            ("a".repeat(65), false),
            ("я".repeat(32), false),
            (format!("0x{}", "a".repeat(62)), false),
            (format!(" {}", "a".repeat(63)), false),
            (format!("{}\n", "a".repeat(63)), false),
        ];
        for (value, expected) in cases {
            assert_eq!(is_sha256(&value), expected, "{value:?}");
        }
        assert_eq!("я".repeat(32).len(), 64);
    }

    // --- список правок ---

    fn list(value: Value) -> Result<Vec<Mutation>> {
        mutations_of(Some(&value))
    }

    fn element(index: Value) -> Value {
        json!({ "lightIndex": index, "expectedFingerprint": FP })
    }

    #[test]
    fn list_shape_refusals() {
        let tail = "ArgumentException | ";
        for absent in [
            None,
            Some(json!(null)),
            Some(json!({})),
            Some(json!("x")),
            Some(json!(5)),
        ] {
            let error = mutations_of(absent.as_ref()).err().unwrap();
            assert_eq!(
                text(error),
                format!("{tail}Нет правок света: пока на хосте.")
            );
        }
        assert_eq!(
            text(list(json!([])).err().unwrap()),
            format!("{tail}Число правок вне 1…256: пока на хосте.")
        );
        // длина проверяется раньше элементов
        let junk = vec![json!({}); 257];
        assert_eq!(
            text(list(Value::Array(junk)).err().unwrap()),
            format!("{tail}Число правок вне 1…256: пока на хосте.")
        );
        let full: Vec<Value> = (0..256).map(|i| element(json!(i))).collect();
        assert_eq!(list(Value::Array(full)).unwrap().len(), 256);
        let over: Vec<Value> = (0..257).map(|i| element(json!(i))).collect();
        assert!(list(Value::Array(over)).is_err());
    }

    #[test]
    fn list_keeps_request_order_and_big_indices() {
        let result = list(json!([element(json!(7)), element(json!(2))])).unwrap();
        let indices: Vec<usize> = result.iter().map(|m| m.light_index).collect();
        assert_eq!(indices, [7, 2]);
        assert!(result.iter().all(|m| m.expected_fingerprint.len() == 64));
        let big = list(json!([element(json!(18446744073709551615u64))])).unwrap();
        assert_eq!(big[0].light_index, usize::MAX);
        // регистр отпечатка не меняется
        assert_eq!(big[0].expected_fingerprint, FP);
    }

    #[test]
    fn list_errors_come_before_the_duplicate_check() {
        let dup = list(json!([element(json!(0)), element(json!(0))]))
            .err()
            .unwrap();
        assert_eq!(
            dup.message,
            "Номер света в плане повторяется: пока на хосте."
        );
        let bad_after_dup = json!([
            element(json!(0)),
            element(json!(0)),
            { "lightIndex": 1, "expectedFingerprint": FP, "intensity": "x" }
        ]);
        assert_eq!(
            list(bad_after_dup).err().unwrap().message,
            "Число правки: пока на хосте."
        );
        let missing_fp = json!([element(json!(0)), { "lightIndex": 0 }]);
        assert_eq!(
            list(missing_fp).err().unwrap().message,
            "Отпечаток света: пока на хосте."
        );
    }

    #[test]
    fn index_and_fingerprint_forms() {
        let bad_index = |raw: Value| list(json!([element(raw)])).err().map(|e| e.message);
        let expected = Some("Номер света: пока на хосте.".to_owned());
        for raw in [
            json!(-1),
            json!(1.5),
            json!(1.0),
            json!("1"),
            json!(null),
            json!(true),
            json!([1]),
            json!({}),
        ] {
            assert_eq!(bad_index(raw.clone()), expected, "{raw}");
        }
        // числа с порядком и выше u64 разбираются как дробные и тоже не годятся
        for text in ["0e0", "1e3", "18446744073709551616"] {
            let raw: Value = serde_json::from_str(text).unwrap();
            assert_eq!(bad_index(raw), expected, "{text}");
        }
        for item in [json!([]), json!(null), json!("x"), json!(5), json!({})] {
            assert_eq!(list(json!([item])).err().map(|e| e.message), expected);
        }
        let fp = |raw: Value| {
            list(json!([{ "lightIndex": 0, "expectedFingerprint": raw }]))
                .err()
                .map(|e| e.message)
        };
        let expected = Some("Отпечаток света: пока на хосте.".to_owned());
        for raw in [
            json!(null),
            json!(5),
            json!(""),
            json!("a".repeat(63)),
            json!("a".repeat(65)),
            json!("g".repeat(64)),
            json!(format!(" {}", "a".repeat(63))),
        ] {
            assert_eq!(fp(raw.clone()), expected, "{raw}");
        }
        assert_eq!(
            list(json!([{ "lightIndex": 0 }])).err().map(|e| e.message),
            expected
        );
    }

    // --- границы чисел (таблица 5.2) ---

    const REAL_FIELDS: [(&str, f64, f64); 10] = [
        ("intensity", 0.0, 100000.0),
        ("falloff", 0.01, 10000.0),
        ("falloffExponent", 0.01, 128.0),
        ("coronaIntensity", 0.0, 10000.0),
        ("coronaSize", 0.0, 10000.0),
        ("coronaZBias", -10000.0, 10000.0),
        ("volumeIntensity", 0.0, 10000.0),
        ("volumeSizeScale", 0.0, 10000.0),
        ("volumeOuterIntensity", 0.0, 10000.0),
        ("volumeOuterExponent", 0.01, 128.0),
    ];

    /// Исход правки одного поля: разбор, затем применение к нулевому свету.
    fn outcome(key: &str, value: Value) -> &'static str {
        let mut item = element(json!(0));
        item[key] = value;
        match mutations_of(Some(&json!([item]))) {
            Err(error) if error.message == "Число правки: пока на хосте." => {
                "число"
            }
            Err(_) => "другое",
            Ok(list) => match apply(&mut zero_light(), &list[0]) {
                Ok(()) => "ok",
                Err(error) if error.message == "Значение света вне предела: пока на хосте." => {
                    "предел"
                }
                Err(_) => "другое",
            },
        }
    }

    #[test]
    fn numeric_bounds_match_the_table() {
        for (key, lo, hi) in REAL_FIELDS {
            let below = if lo == 0.0 { -0.0001 } else { lo - 0.001 };
            let below_tiny = if lo == 0.0 { -1e-30 } else { lo * 0.99999 };
            let above = if hi == 128.0 { hi + 0.001 } else { hi + 0.5 };
            let tiny_ok = if key == "coronaZBias" {
                "ok"
            } else {
                "предел"
            };
            let cells: Vec<(&str, Value, &str)> = vec![
                ("lo", json!(lo), "ok"),
                ("hi", json!(hi), "ok"),
                ("mid", json!((lo + hi) / 4.0), "ok"),
                ("below", json!(below), "предел"),
                ("below-tiny", json!(below_tiny), tiny_ok),
                ("above", json!(above), "предел"),
                ("above-just-f64", json!(hi * 1.00000000001), "ok"),
                ("huge", json!(1e30), "предел"),
                ("string", json!("1"), "число"),
                ("true", json!(true), "число"),
                ("array", json!([1]), "число"),
                ("object", json!({}), "число"),
                ("empty-string", json!(""), "число"),
            ];
            for (name, value, expected) in cells {
                assert_eq!(outcome(key, value), expected, "{key} {name}");
            }
            let overflow: Value = serde_json::from_str("1e39").unwrap();
            assert_eq!(outcome(key, overflow), "предел", "{key} overflow-f32");
        }
    }

    #[test]
    fn special_numbers() {
        let parse = |text: &str| -> Value {
            let value: Value = serde_json::from_str(text).unwrap();
            value
        };
        assert_eq!(outcome("intensity", parse("100000.0000001")), "ok");
        assert_eq!(outcome("falloffExponent", parse("128.0000001")), "ok");
        assert_eq!(outcome("intensity", parse("-0.0")), "ok");
        assert_eq!(outcome("intensity", parse("1e-45")), "ok");
        assert_eq!(outcome("falloff", parse("0.01")), "ok");
        assert_eq!(outcome("falloff", parse("0.0099999")), "предел");
        assert_eq!(outcome("falloff", parse("0.010000001")), "ok");
        assert_eq!(outcome("intensity", parse("4e1")), "ok");
        assert_eq!(outcome("intensity", parse("null")), "ok");
    }

    #[test]
    fn first_failing_field_wins() {
        let order = |fields: Value| one(fields).map(|m| apply(&mut zero_light(), &m)).unwrap();
        // порядок записи, а не порядок ключей запроса
        let both = order(json!({ "falloff": 99999, "intensity": 1000000000 }));
        assert_eq!(
            both.unwrap_err().message,
            "Значение света вне предела: пока на хосте."
        );
        // ошибки разбора побеждают ошибки предела
        assert_eq!(
            one(json!({ "intensity": 1000000000, "falloff": "x" }))
                .err()
                .unwrap()
                .message,
            "Число правки: пока на хосте."
        );
        // порядок разбора внутри элемента: color раньше volumeOuterColor и числа
        let tangled = json!({ "volumeOuterColor": {"r": 1}, "color": {"r": 999, "g": 0, "b": 0}, "intensity": "x" });
        assert_eq!(
            one(tangled).err().unwrap().message,
            "Цвет правки: пока на хосте."
        );
        // ошибка пары флагов появляется последней
        let flags_last = order(json!({ "flagsValue": 1, "intensity": 1000000000 }));
        assert_eq!(
            flags_last.unwrap_err().message,
            "Значение света вне предела: пока на хосте."
        );
        let flags_only = order(json!({ "flagsValue": 1 }));
        assert_eq!(
            flags_only.unwrap_err().message,
            "Флаги и маска — вместе: пока на хосте."
        );
    }

    #[test]
    fn colors_bytes_and_flag_words() {
        for key in ["color", "volumeOuterColor"] {
            let result = |raw: &str| {
                let value: Value = serde_json::from_str(raw).unwrap();
                one(json!({ key: value })).err().map(|e| e.message)
            };
            let refused = Some("Цвет правки: пока на хосте.".to_owned());
            for bad in [
                r#"{"g":1,"b":1}"#,
                r#"{"r":1,"b":1}"#,
                r#"{"r":1,"g":1}"#,
                r#"{"r":256,"g":0,"b":0}"#,
                r#"{"r":0,"g":256,"b":0}"#,
                r#"{"r":0,"g":0,"b":256}"#,
                r#"{"r":-1,"g":0,"b":0}"#,
                r#"{"r":1.5,"g":0,"b":0}"#,
                r#"{"r":1.0,"g":0,"b":0}"#,
                r#"{"r":"1","g":0,"b":0}"#,
                r#"{"r":null,"g":0,"b":0}"#,
                "[]",
                r#""x""#,
                "5",
                "{}",
                r#"{"R":1,"G":1,"B":1}"#,
                "true",
            ] {
                assert_eq!(result(bad), refused, "{key} {bad}");
            }
            for good in [
                r#"{"r":0,"g":128,"b":255}"#,
                r#"{"r":1,"g":2,"b":3,"x":4}"#,
                "null",
            ] {
                assert_eq!(result(good), None, "{key} {good}");
            }
        }
        for key in ["lightFadeDistance", "volumetricFadeDistance"] {
            let result = |raw: &str| {
                let value: Value = serde_json::from_str(raw).unwrap();
                one(json!({ key: value })).err().map(|e| e.message)
            };
            let refused = Some("Байт правки: пока на хосте.".to_owned());
            for bad in [
                "256",
                "-1",
                "1.5",
                "1.0",
                r#""1""#,
                "true",
                "18446744073709551615",
                "[1]",
            ] {
                assert_eq!(result(bad), refused, "{key} {bad}");
            }
            for good in ["0", "255", "null"] {
                assert_eq!(result(good), None, "{key} {good}");
            }
        }
        for key in ["flagsValue", "ownedFlagsMask"] {
            let result = |raw: &str| {
                let value: Value = serde_json::from_str(raw).unwrap();
                one(json!({ key: value })).err().map(|e| e.message)
            };
            let refused = Some("Флаги правки: пока на хосте.".to_owned());
            for bad in ["4294967296", "-1", "1.5", r#""1""#, "true"] {
                assert_eq!(result(bad), refused, "{key} {bad}");
            }
            for good in ["0", "4294967295", "null"] {
                assert_eq!(result(good), None, "{key} {good}");
            }
        }
    }

    #[test]
    fn flag_pairs_through_the_planner_path() {
        let plan = |fields: Value| {
            let mutation = one(fields).map_err(|e| e.message)?;
            let mut light = zero_light();
            light.flags = 1;
            apply(&mut light, &mutation).map_err(|e| e.message)
        };
        let together = "Флаги и маска — вместе: пока на хосте.".to_owned();
        let outside = "Флаги вне своей маски: пока на хосте.".to_owned();
        assert_eq!(plan(json!({})), Ok(()));
        assert_eq!(
            plan(json!({ "flagsValue": 5, "ownedFlagsMask": 7 })),
            Ok(())
        );
        assert_eq!(plan(json!({ "flagsValue": 1 })), Err(together.clone()));
        assert_eq!(plan(json!({ "ownedFlagsMask": 1 })), Err(together.clone()));
        assert_eq!(
            plan(json!({ "flagsValue": null, "ownedFlagsMask": 7 })),
            Err(together)
        );
        assert_eq!(
            plan(json!({ "flagsValue": null, "ownedFlagsMask": null })),
            Ok(())
        );
        assert_eq!(
            plan(json!({ "flagsValue": 1, "ownedFlagsMask": 0 })),
            Err(outside.clone())
        );
        assert_eq!(
            plan(json!({ "flagsValue": 0, "ownedFlagsMask": 0 })),
            Err(outside.clone())
        );
        assert_eq!(
            plan(json!({ "flagsValue": 8, "ownedFlagsMask": 7 })),
            Err(outside)
        );
        assert_eq!(
            plan(json!({ "flagsValue": 0, "ownedFlagsMask": 255 })),
            Ok(())
        );
        assert_eq!(
            plan(json!({ "flagsValue": 4294967295u64, "ownedFlagsMask": 4294967295u64 })),
            Ok(())
        );
    }

    #[test]
    fn all_fields_land_and_pass_the_exact_check() {
        let mutation = one(json!({
            "color": {"r":1,"g":2,"b":3}, "intensity": 4, "falloff": 5, "falloffExponent": 6,
            "coronaIntensity": 7, "coronaSize": 8, "coronaZBias": -9, "volumeIntensity": 10,
            "volumeSizeScale": 11, "volumeOuterColor": {"r":12,"g":13,"b":14},
            "volumeOuterIntensity": 15, "volumeOuterExponent": 16, "lightFadeDistance": 17,
            "volumetricFadeDistance": 18, "flagsValue": 5, "ownedFlagsMask": 7
        }))
        .unwrap();
        let mut light = zero_light();
        apply(&mut light, &mutation).unwrap();
        assert_eq!(light.color, [1, 2, 3]);
        assert_eq!(
            [
                light.intensity,
                light.falloff,
                light.falloff_exponent,
                light.corona_intensity,
                light.corona_size,
                light.corona_z_bias,
                light.volume_intensity,
                light.volume_size_scale,
                light.volume_outer_intensity,
                light.volume_outer_exponent
            ],
            [4.0, 5.0, 6.0, 7.0, 8.0, -9.0, 10.0, 11.0, 15.0, 16.0]
        );
        assert_eq!(light.volume_outer_color, [12, 13, 14]);
        assert_eq!(
            (light.light_fade_distance, light.volumetric_fade_distance),
            (17, 18)
        );
        assert_eq!(light.flags, 5);
        assert_eq!(assert_applied(&light, &mutation), Ok(()));
        // любое одно расхождение ловится
        let mut off = light;
        off.volumetric_fade_distance = 19;
        assert!(assert_applied(&off, &mutation).is_err());
        let mut off = light;
        off.volume_outer_color[2] = 0;
        assert!(assert_applied(&off, &mutation).is_err());
        let mut off = light;
        off.flags = 6;
        assert!(assert_applied(&off, &mutation).is_err());
        // чужие поля не трогаются
        assert_eq!(
            light.immutable_fingerprint(),
            zero_light().immutable_fingerprint()
        );
    }
}
