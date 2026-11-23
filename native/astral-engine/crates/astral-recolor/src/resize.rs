//! Картинка в другой размер — `resizeRgba` из `apps/desktop/src/vegetation-build.js` байт в байт.
//!
//! Вдвое усреднением, пока исходник больше нужного хотя бы вдвое по обеим сторонам, дальше —
//! билинейно. Уменьшение вдвое — `downsample` из `packages/dds/index.js`: окно каждой точки —
//! прямоугольник исходных, цвет усредняется с весом альфы, альфа — обычное среднее; последняя
//! точка ряда забирает всё до края, чтобы нечётная сторона не теряла ряд или столбец. Среднее —
//! `Math.round(сумма / вес)`: суммы и веса целые, деление у `f64` одно, округление — половина вверх.

use crate::bc7::js_round as round;
use crate::roads::clamp8 as to_u8_clamped;

/// `Math.max(a, b)`: нечисло — нечисло, у двух нулей побеждает `+0`.
pub(crate) fn max2(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() {
            b
        } else {
            a
        }
    } else if a > b {
        a
    } else {
        b
    }
}

/// `Math.min(a, b)`: нечисло — нечисло, у двух нулей побеждает `-0`.
pub(crate) fn min2(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else if a < b {
        a
    } else {
        b
    }
}

/// `Math.round` и запись в `Uint8ClampedArray` одним шагом: `to_u8_clamped(round(value))`. Меньше половины (и
/// отрицательное) — нуль, иначе `value + 0,5` с обрезанием: для `value >= 0,5` сумма округляется только в сторону верной
/// целой части.
fn round_to_byte(value: f64) -> u8 {
    if value < 0.5 {
        return 0;
    }
    ((value + 0.5) as u32).min(255) as u8
}

/// Окна исходных по одной оси: `[от, до)` для каждой выходной точки (`halvingWindows`).
fn halving_windows(size: usize) -> Vec<(usize, usize)> {
    let half = size >> 1;
    let slots = half.max(1);
    (0..slots)
        .map(|slot| {
            let first = slot * 2;
            (first, if slot + 1 < slots { first + 2 } else { size.max(first + 1) })
        })
        .collect()
}

/// `Math.round(сумма / вес)`. Сумма не больше `255 · вес`; при весе до 1020 (окно 2×2) вместо деления — умножение
/// на обратное с запасом `1e-9`, как у `halveByPairs` в `packages/dds/index.js`: на всех парах «вес, сумма» этого
/// диапазона (132 782 070 пар) итог совпадает с делением.
fn average(sum: u64, weight: u64) -> u8 {
    if weight <= 1020 {
        let inverse = 1.0 / weight as f64;
        return to_u8_clamped((sum as f64 * inverse + 0.500_000_000_1) as u32 as f64);
    }
    to_u8_clamped(round(sum as f64 / weight as f64))
}

/// Уменьшение вдвое при чётных сторонах (`halveByPairs`): каждое окно — ровно 2×2, суммы помещаются в `u32`.
fn halve_even(source: &[u8], width: usize, height: usize) -> Vec<u8> {
    let (half_width, half_height) = (width / 2, height / 2);
    let mut out = vec![0u8; half_width * half_height * 4];
    for (y, row) in out.chunks_exact_mut(half_width * 4).enumerate() {
        let upper = &source[(2 * y * width) * 4..(2 * y * width + width) * 4];
        let lower = &source[((2 * y + 1) * width) * 4..((2 * y + 1) * width + width) * 4];
        for ((above, below), target) in upper.chunks_exact(8).zip(lower.chunks_exact(8)).zip(row.chunks_exact_mut(4)) {
            let weights = [u32::from(above[3]), u32::from(above[7]), u32::from(below[3]), u32::from(below[7])];
            let alpha: u32 = weights.iter().sum();
            /* Альфа — `Math.round(сумма / 4)`: половина вверх. */
            target[3] = ((alpha + 2) >> 2) as u8;
            if alpha > 0 {
                let inverse = 1.0 / f64::from(alpha);
                for channel in 0..3 {
                    let sum = weights[0] * u32::from(above[channel]) + weights[1] * u32::from(above[4 + channel]) + weights[2] * u32::from(below[channel]) + weights[3] * u32::from(below[4 + channel]);
                    target[channel] = (f64::from(sum) * inverse + 0.500_000_000_1) as u32 as u8;
                }
            }
        }
    }
    out
}

/// Уменьшение вдвое (`downsample`): новая картинка и её размер.
pub(crate) fn halve(source: &[u8], width: usize, height: usize) -> (Vec<u8>, usize, usize) {
    if width % 2 == 0 && height % 2 == 0 {
        return (halve_even(source, width, height), width / 2, height / 2);
    }
    let columns = halving_windows(width);
    let rows = halving_windows(height);
    let mut out = vec![0u8; columns.len() * rows.len() * 4];
    let mut at = 0;
    for &(top, bottom) in &rows {
        for &(left, right) in &columns {
            let (mut r, mut g, mut b, mut a) = (0u64, 0u64, 0u64, 0u64);
            for row in top..bottom {
                for pixel in source[(row * width + left) * 4..(row * width + right) * 4].chunks_exact(4) {
                    let opacity = u64::from(pixel[3]);
                    a += opacity;
                    r += opacity * u64::from(pixel[0]);
                    g += opacity * u64::from(pixel[1]);
                    b += opacity * u64::from(pixel[2]);
                }
            }
            if a > 0 {
                out[at] = average(r, a);
                out[at + 1] = average(g, a);
                out[at + 2] = average(b, a);
            }
            let covered = (right.saturating_sub(left) * bottom.saturating_sub(top)) as u64;
            out[at + 3] = if covered > 0 { average(a, covered) } else { 0 };
            at += 4;
        }
    }
    (out, columns.len(), rows.len())
}

/// Исходная точка выходной по одной оси: две соседние и доля второй (`sx`, `x0`, `x1`, `fx` из `resizeRgba`).
struct Tap {
    first: usize,
    second: usize,
    fraction: f64,
    rest: f64,
}

fn taps(from: usize, to: usize) -> Vec<Tap> {
    let size = from as f64;
    (0..to)
        .map(|at| {
            let source = max2(0.0, min2(size - 1.0, ((at as f64 + 0.5) * size) / to as f64 - 0.5));
            let first = source as usize; /* source >= 0: обрезание — это floor */
            let fraction = source - first as f64;
            Tap { first, second: (from - 1).min(first + 1), fraction, rest: 1.0 - fraction }
        })
        .collect()
}

/// Билинейный пересчёт в `out` (`next_width × next_height × 4`). Доли по осям считаются один раз на столбец и ряд —
/// это те же числа, что у JS на каждой точке.
fn bilinear(current: &[u8], w: usize, h: usize, next_width: usize, next_height: usize, out: &mut [u8]) {
    let columns = taps(w, next_width);
    let rows = taps(h, next_height);
    for (row, target_row) in rows.iter().zip(out.chunks_exact_mut(next_width * 4)) {
        let upper = &current[row.first * w * 4..(row.first + 1) * w * 4];
        let lower = &current[row.second * w * 4..(row.second + 1) * w * 4];
        for (column, target) in columns.iter().zip(target_row.chunks_exact_mut(4)) {
            for c in 0..4 {
                let top = f64::from(upper[column.first * 4 + c]) * column.rest + f64::from(upper[column.second * 4 + c]) * column.fraction;
                let bottom = f64::from(lower[column.first * 4 + c]) * column.rest + f64::from(lower[column.second * 4 + c]) * column.fraction;
                target[c] = round_to_byte(top * row.rest + bottom * row.fraction);
            }
        }
    }
}

/// `resizeRgba`: `out` — `next_width × next_height × 4` байт. Размеры положительные, исходник не короче
/// `width × height × 4`.
pub fn resize_rgba(rgba: &[u8], width: usize, height: usize, next_width: usize, next_height: usize, out: &mut [u8]) {
    let (mut w, mut h) = (width, height);
    let mut halved: Option<Vec<u8>> = None;
    while w >= next_width * 2 && h >= next_height * 2 {
        let (next, nw, nh) = halve(halved.as_deref().unwrap_or(rgba), w, h);
        halved = Some(next);
        w = nw;
        h = nh;
    }
    let current = halved.as_deref().unwrap_or(rgba);
    if w == next_width && h == next_height {
        out[..next_width * next_height * 4].copy_from_slice(&current[..next_width * next_height * 4]);
        return;
    }
    bilinear(current, w, h, next_width, next_height, out);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halving_windows_take_the_odd_edge_into_the_last_point() {
        assert_eq!(halving_windows(1), vec![(0, 1)]);
        assert_eq!(halving_windows(2), vec![(0, 2)]);
        assert_eq!(halving_windows(3), vec![(0, 3)]);
        assert_eq!(halving_windows(5), vec![(0, 2), (2, 5)]);
        assert_eq!(halving_windows(8), vec![(0, 2), (2, 4), (4, 6), (6, 8)]);
    }

    #[test]
    fn a_half_step_averages_with_alpha_as_the_weight_of_the_colour() {
        /* 2×2: два непрозрачных красных, один прозрачный зелёный (не в счёт цвета) и полупрозрачный синий. */
        let rgba = [255u8, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128];
        let mut out = [0u8; 4];
        resize_rgba(&rgba, 2, 2, 1, 1, &mut out);
        /* Вес цвета — альфа: красный 510, синий 128, сумма 638: R = 510·255 / 638 = 203,8 → 204. */
        assert_eq!(out[0], 204);
        assert_eq!(out[1], 0);
        assert_eq!(out[2], 51, "синий: 128 · 255 / 638 = 51,2");
        assert_eq!(out[3], 160, "альфа: 638 / 4 = 159,5 — половина вверх");
    }

    #[test]
    fn the_same_size_is_a_copy_and_a_bilinear_step_blends_neighbours() {
        let rgba: Vec<u8> = (0..4u8).flat_map(|index| [index * 60, 10, 20, 255]).collect();
        let mut same = vec![0u8; 16];
        resize_rgba(&rgba, 2, 2, 2, 2, &mut same);
        assert_eq!(same, rgba);
        /* Вверх 2×1 → 4×1: края держат цвет, середина — смесь. */
        let strip = [0u8, 0, 0, 255, 200, 100, 40, 255];
        let mut wide = vec![0u8; 16];
        resize_rgba(&strip, 2, 1, 4, 1, &mut wide);
        assert_eq!(&wide[..4], &[0, 0, 0, 255]);
        assert_eq!(&wide[12..], &[200, 100, 40, 255]);
        assert_eq!(&wide[4..7], &[50, 25, 10]);
    }

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len() / 2).map(|at| u8::from_str_radix(&text[at * 2..at * 2 + 2], 16).unwrap()).collect()
    }

    #[test]
    fn sheets_match_the_bytes_js_gave() {
        /* Образцы сняты с `greenTexturePayload` прежнего кода: чётные и нечётные стороны, вверх и вниз, не кратно двум. */
        for case in crate::resize_samples::RESIZE {
            let rgba = unhex(case.rgba);
            let mut out = vec![0u8; case.next_width * case.next_height * 4];
            resize_rgba(&rgba, case.width, case.height, case.next_width, case.next_height, &mut out);
            assert_eq!(out, unhex(case.expected), "{}×{} → {}×{}", case.width, case.height, case.next_width, case.next_height);
        }
    }

    #[test]
    fn the_even_fast_path_equals_the_general_windows() {
        /* Любая чётная картинка: быстрый путь 2×2 и общий путь по окнам дают те же байты. */
        let mut state = 0x2545_f491_u32;
        for (width, height) in [(2usize, 2usize), (4, 2), (8, 6), (16, 16), (30, 18)] {
            let rgba: Vec<u8> = (0..width * height * 4)
                .map(|at| {
                    state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                    if at % 4 == 3 && state & 0x700 == 0 { 0 } else { (state >> 16) as u8 }
                })
                .collect();
            let fast = halve_even(&rgba, width, height);
            let columns = halving_windows(width);
            let rows = halving_windows(height);
            let mut general = vec![0u8; columns.len() * rows.len() * 4];
            let mut at = 0;
            for &(top, bottom) in &rows {
                for &(left, right) in &columns {
                    let (mut r, mut g, mut b, mut a) = (0u64, 0u64, 0u64, 0u64);
                    for row in top..bottom {
                        for pixel in rgba[(row * width + left) * 4..(row * width + right) * 4].chunks_exact(4) {
                            let opacity = u64::from(pixel[3]);
                            a += opacity;
                            r += opacity * u64::from(pixel[0]);
                            g += opacity * u64::from(pixel[1]);
                            b += opacity * u64::from(pixel[2]);
                        }
                    }
                    if a > 0 {
                        for (slot, sum) in [r, g, b].into_iter().enumerate() {
                            general[at + slot] = to_u8_clamped(round(sum as f64 / a as f64));
                        }
                    }
                    general[at + 3] = to_u8_clamped(round(a as f64 / ((right - left) * (bottom - top)) as f64));
                    at += 4;
                }
            }
            assert_eq!(fast, general, "{width}×{height}");
        }
    }
}
