//! Правила JS для текстов игры: какие знаки считаются пробелами, как
//! читаются числа (`Number`, `parseFloat`), куда `Math.round` относит половину
//! и в каком порядке встают строки после `sort()` без сравнителя.
//!
//! Модуль чистый: без ввода-вывода и состояния, отказ — `None`.

use std::cmp::Ordering;

// ---------- числа ----------

/// Основание по записи `0x` / `0o` / `0b` в начале текста.
fn radix_of(text: &str) -> Option<u32> {
    match text.get(..2)? {
        "0x" | "0X" => Some(16),
        "0o" | "0O" => Some(8),
        "0b" | "0B" => Some(2),
        _ => None,
    }
}

/// Число из цифр основания (2, 8 или 16), как `Number("0x…")` в JS: точное значение
/// округляется один раз — к ближайшему представимому, ничья к чётному; не влезающее —
/// бесконечность. Основание — степень двойки, поэтому цифры просто дописывают биты:
/// в `top` копятся старшие значащие биты (до 64), а всё, что не поместилось, остаётся
/// счётчиком отброшенных разрядов и признаком «среди них была единица».
fn radix_digits_value(digits: &str, radix: u32) -> Option<f64> {
    let width = radix.trailing_zeros();
    let mut top = 0u64;
    let mut dropped = 0usize;
    let mut lost = false;
    let mut count = 0usize;
    for ch in digits.chars() {
        let digit = u64::from(ch.to_digit(radix)?);
        if top.leading_zeros() >= width {
            top = (top << width) | digit;
        } else {
            // В `top` уже не меньше 61 значащего бита: дальше пишем только «хвост».
            dropped += width as usize;
            lost |= digit != 0;
        }
        count += 1;
    }
    if count == 0 {
        return None;
    }
    // `u64 as f64` округляет к ближайшему, ничья к чётному. Потерянные единицы
    // склеиваются в младший разряд `top`: он заведомо ниже позиции округления (53-й
    // бит), и потому ничья превращается в «больше половины» ровно тогда, когда внизу
    // что-то было. Порядок восстанавливается степенью двойки: точно, а при переполнении
    // получается бесконечность.
    let rounded = (top | u64::from(lost)) as f64;
    let exponent = i32::try_from(dropped).unwrap_or(i32::MAX);
    Some(rounded * 2f64.powi(exponent))
}

/// Слово `Infinity` со знаком или без; регистр важен, остального текста быть не должно.
fn signed_infinity(text: &str) -> Option<f64> {
    match text {
        "Infinity" | "+Infinity" => Some(f64::INFINITY),
        "-Infinity" => Some(f64::NEG_INFINITY),
        _ => None,
    }
}

/// `Number(text)`: `None` — NaN, бесконечности отдаются как есть.
pub fn js_number(text: &str) -> Option<f64> {
    let body = match js_trim(text) {
        "" => return Some(0.0),
        other => other,
    };
    if let Some(radix) = radix_of(body) {
        return radix_digits_value(&body[2..], radix);
    }
    if let Some(infinite) = signed_infinity(body) {
        return Some(infinite);
    }
    // Годятся только цифры ASCII и `+ - . e E`; остальное разбор Rust принял бы за своё.
    let plain = body
        .bytes()
        .all(|byte| byte.is_ascii_digit() || b"+-.eE".contains(&byte));
    if plain {
        body.parse().ok()
    } else {
        None
    }
}

/// Где мы в записи числа при чтении `parseFloat`.
#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Whole,
    Fraction,
    ExponentMark,
    ExponentSign,
    ExponentDigits,
}

/// Сколько знаков в начале `raw` составляют десятичное число (0 — ни одного).
/// Принятый конец сдвигается только на цифрах и на точке после цифр; `e`, знак
/// порядка и точка без цифр вокруг ждут следующую цифру.
fn decimal_prefix_len(raw: &[u8]) -> usize {
    let mut stage = Stage::Whole;
    let mut mantissa_digits = false;
    let mut accepted = 0;
    for (at, &byte) in raw.iter().enumerate() {
        stage = match (stage, byte) {
            (Stage::Whole | Stage::Fraction, b'0'..=b'9') => {
                mantissa_digits = true;
                accepted = at + 1;
                stage
            }
            (Stage::Whole, b'.') => {
                if mantissa_digits {
                    accepted = at + 1;
                }
                Stage::Fraction
            }
            (Stage::Whole | Stage::Fraction, b'e' | b'E') if mantissa_digits => Stage::ExponentMark,
            (Stage::ExponentMark, b'+' | b'-') => Stage::ExponentSign,
            (Stage::ExponentMark | Stage::ExponentSign | Stage::ExponentDigits, b'0'..=b'9') => {
                accepted = at + 1;
                Stage::ExponentDigits
            }
            _ => break,
        };
    }
    accepted
}

/// `Number.parseFloat(text)`: самый длинный начальный кусок-десятичное число.
pub fn js_parse_float(text: &str) -> Option<f64> {
    let rest = text.trim_start_matches(is_js_space);
    let (sign, unsigned) = match rest.as_bytes().first() {
        Some(b'+' | b'-') => rest.split_at(1),
        _ => ("", rest),
    };
    if unsigned.starts_with("Infinity") {
        let direction = if sign == "-" { -1.0 } else { 1.0 };
        return Some(direction * f64::INFINITY);
    }
    match decimal_prefix_len(unsigned.as_bytes()) {
        0 => None,
        used => rest[..sign.len() + used].parse().ok(),
    }
}

// ---------- пробелы, длины, порядок ----------

/// Порядок строк по единицам UTF-16 (как у `Array.prototype.sort()` по умолчанию).
pub fn cmp_utf16(left: &str, right: &str) -> Ordering {
    let mut units = left.encode_utf16().zip(right.encode_utf16());
    let first_difference = units.find(|(l, r)| l != r);
    match first_difference {
        Some((l, r)) => l.cmp(&r),
        // Общая часть равна: короче — меньше.
        None => left
            .encode_utf16()
            .count()
            .cmp(&right.encode_utf16().count()),
    }
}

/// `Math.round`: половина уходит вверх. В отличие от JS, из (−0.5; 0) выходит
/// `+0.0`, а явный `-0.0` остаётся собой.
pub fn js_round(value: f64) -> f64 {
    // Остаток считается точно, поэтому 0.49999999999999994 не округляется вверх,
    // как это случилось бы при `floor(x + 0.5)`.
    let down = value.floor();
    if value - down >= 0.5 {
        down + 1.0
    } else {
        down
    }
}

/// Пробельные знаки по версии JS (`trim`, `\s`): пробелы Юникода без U+0085, плюс U+FEFF.
pub fn is_js_space(c: char) -> bool {
    c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')
}

/// Срез без JS-пробелов с обоих краёв.
pub fn js_trim(text: &str) -> &str {
    let mut kept = text.char_indices().filter(|&(_, c)| !is_js_space(c));
    let first = kept.next();
    match (first, kept.next_back().or(first)) {
        (Some((from, _)), Some((at, last))) => &text[from..at + last.len_utf8()],
        _ => "",
    }
}

/// Длина строки в единицах UTF-16.
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

#[cfg(test)]
mod tests;
