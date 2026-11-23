//! Числа так, как их считает и пишет JS (V8): округление, `Math.hypot`, `toFixed`, `Number → строка`.
//!
//! Сборщики сцен в JS (`world-place-scene.js`, `recolor-shops-scene.js`) кладут в файл сцены `ARS1` числа, которые прошли через
//! эти функции; чтобы Rust дал **те же байты**, он повторяет их буквально. Сверка — векторы, снятые в Node 22 (V8 12.4),
//! `launcher_app/fixtures/ars1/parity/js-math.json`; `Math.hypot` на тех же входах проверен и на Electron 43 (V8 15.0).
//! Ничего из этого не зависит от системной математической библиотеки: тригонометрии здесь нет, только `+ − × ÷` и `sqrt`.

/// `Math.round`: вверх на половинке (−2,5 → −2, 2,5 → 3), −0 для `[−0,5; 0)`, NaN, ±∞ и ±0 как есть.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    if (-0.5..0.0).contains(&x) {
        return -0.0;
    }
    let floor = x.floor();
    if x - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `Math.max(low, Math.min(high, x))`: NaN остаётся NaN (у `f64::clamp` и `min`/`max` Rust он пропадает).
pub fn clamp(x: f64, low: f64, high: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    x.min(high).max(low)
}

/// `Math.hypot(...values)` V8 (`math.tq`, `MathHypot`): бесконечность побеждает NaN, нули дают +0, остальное — шкала по
/// наибольшему модулю и сумма Кэхэна. `f64::hypot` и `sqrt(Σ x²)` отличаются от него в 35–42 % чисел на последний бит.
pub fn hypot(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut max = 0.0f64;
    let mut not_a_number = false;
    for value in values {
        if value.is_nan() {
            not_a_number = true;
        } else if value.abs() > max {
            max = value.abs();
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if not_a_number {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut compensation = 0.0f64;
    for value in values {
        let n = value.abs() / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `Number.prototype.toString()` (ECMAScript, `Number::toString`): кратчайшие цифры, без показателя от 1e-6 до 1e21.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x == 0.0 {
        return "0".to_owned();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // Число знаков — по кратчайшей записи, которая читается обратно в то же число. Сами знаки — точное округление до стольких знаков:
    // на точной половинке оно берёт чётную (`Number::toString` велит чётную, а кратчайшая запись Rust — старшую: ...10.25 → «.2» у JS, «.3» у Rust).
    let shortest = format!("{:e}", x.abs());
    let count = shortest.split_once('e').map_or(1, |(mantissa, _)| {
        mantissa.chars().filter(|c| *c != '.').count()
    });
    let exact = format!("{:.*e}", count - 1, x.abs());
    let scientific = if exact.parse::<f64>() == Ok(x.abs()) {
        exact
    } else {
        shortest
    };
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().unwrap_or(0) + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let tail = format!("e{}{}", if e < 0 { '-' } else { '+' }, e.abs());
        if k == 1 {
            format!("{digits}{tail}")
        } else {
            format!("{}.{}{tail}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// `x.toFixed(digits)`: `digits` до 20; на точной половинке — **вверх по модулю** (`0.125.toFixed(2)` = `"0.13"`), у Rust `{:.2}` — к чётному.
pub fn to_fixed(x: f64, digits: usize) -> String {
    let digits = digits.min(20);
    if x.is_nan() {
        return "NaN".to_owned();
    }
    if x.abs() >= 1e21 {
        return number_to_string(x);
    }
    // Точное десятичное разложение с запасом знаков: решение берётся по первому отброшенному знаку (точная половинка даёт `5` и нули).
    let long = format!("{:.*}", digits + 25, x.abs());
    let (whole, fraction) = long.split_once('.').unwrap_or((&long, ""));
    let mut kept: Vec<u8> = whole.bytes().chain(fraction.bytes().take(digits)).collect();
    if fraction
        .as_bytes()
        .get(digits)
        .is_some_and(|next| *next >= b'5')
    {
        let mut at = kept.len();
        loop {
            if at == 0 {
                kept.insert(0, b'1');
                break;
            }
            at -= 1;
            if kept[at] == b'9' {
                kept[at] = b'0';
            } else {
                kept[at] += 1;
                break;
            }
        }
    }
    let split = kept.len() - digits;
    let text = String::from_utf8_lossy(&kept).into_owned();
    let (head, tail) = text.split_at(split);
    let number = if digits == 0 {
        head.to_owned()
    } else {
        format!("{head}.{tail}")
    };
    if x < 0.0 {
        format!("-{number}")
    } else {
        number
    }
}

/// `Number(Number(x).toFixed(digits))`: округление до знаков после запятой, как `round(value, digits)` сборщиков.
pub fn round_to(x: f64, digits: usize) -> f64 {
    to_fixed(x, digits).parse().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests;
