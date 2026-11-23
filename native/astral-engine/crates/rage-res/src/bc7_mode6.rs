//! Быстрый кодер BC7, пишущий блоки только режимом 6: один отрезок в пространстве
//! RGBA, по 7 бит на канал, один общий младший бит у каждой опорной точки и 16 ступеней
//! между точками.
//!
//! Главная ось блока ищется степенным методом, пиксели проецируются на неё, потом один
//! раз пересчитываются концы по выбранным ступеням. Это порт кодера на JS: порядок
//! операций и правила округления сохранены, расчёт идёт в `f64` и в целых.

/// Целый пиксель блока.
type Px = [i32; 4];
/// Точка пространства RGBA до округления.
type Pt = [f64; 4];

/// Веса шестнадцати ступеней (из 64).
const LEVELS: [i32; 16] = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

/// Кодирует кадр в блоки по 16 байт: ряды блоков идут сверху вниз.
pub fn encode_bc7(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let [across, down] = [width, height].map(|side| side.div_ceil(4).max(1));
    // Недостающий край блока повторяет последний пиксель строки и столбца.
    let gather = |bx: usize, by: usize| -> [Px; 16] {
        std::array::from_fn(|k| {
            let sx = (bx * 4 + k % 4).min(width - 1);
            let sy = (by * 4 + k / 4).min(height - 1);
            let at = (sy * width + sx) * 4;
            [0, 1, 2, 3].map(|c| i32::from(rgba[at + c]))
        })
    };
    (0..down)
        .flat_map(|by| (0..across).map(move |bx| (bx, by)))
        .flat_map(|(bx, by)| pack(&solve(&gather(bx, by))))
        .collect()
}

/// Подбор для одного блока: коды двух концов, их общие биты, ступени и ошибка.
struct Candidate {
    codes: [[i32; 4]; 2],
    parity: [i32; 2],
    steps: [usize; 16],
    miss: i64,
}

fn dot4(a: [f64; 4], b: [f64; 4]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).reduce(|s, v| s + v).unwrap_or(0.0)
}

/// Точка в 7-битные коды и общий бит. Выигрывает чётность с меньшей ошибкой, при
/// равенстве — нулевая. Округление «половина вверх» совпадает с JS: единственный
/// отрицательный случай, -0.5, всё равно зажимается к нулю.
fn snap_end(point: &Pt) -> ([i32; 4], i32) {
    let tries = [0, 1].map(|parity: i32| {
        let shown = point.map(|v| v.clamp(0.0, 255.0));
        let codes = shown.map(|v| ((v - f64::from(parity)) / 2.0).round().clamp(0.0, 127.0) as i32);
        let miss = codes
            .iter()
            .zip(shown)
            .map(|(&c, v)| {
                let off = f64::from(c * 2 + parity) - v;
                off * off
            })
            .reduce(|s, e| s + e)
            .unwrap_or(0.0);
        (codes, miss)
    });
    let odd_wins = tries[1].1 < tries[0].1;
    (tries[usize::from(odd_wins)].0, i32::from(odd_wins))
}

/// По готовым концам выбирает каждому пикселю ступень с наименьшей ошибкой по четырём
/// каналам; при равенстве берётся меньшая ступень.
fn nearest_steps(px: &[Px; 16], codes: &[[i32; 4]; 2], parity: &[i32; 2]) -> ([usize; 16], i64) {
    let ends: [[i32; 4]; 2] = std::array::from_fn(|e| codes[e].map(|c| c * 2 + parity[e]));
    let palette: [Px; 16] = LEVELS.map(|w| std::array::from_fn(|c| ((64 - w) * ends[0][c] + w * ends[1][c] + 32) >> 6));
    let mut steps = [0usize; 16];
    let mut total = 0i64;
    for (pixel, slot) in px.iter().zip(&mut steps) {
        let (best, miss) = palette
            .iter()
            .enumerate()
            .map(|(k, entry)| (k, entry.iter().zip(pixel).map(|(a, b)| i64::from(a - b).pow(2)).sum::<i64>()))
            .min_by_key(|&(_, miss)| miss)
            .unwrap_or((0, 0));
        *slot = best;
        total += miss;
    }
    (steps, total)
}

fn candidate(px: &[Px; 16], low: &Pt, high: &Pt) -> Candidate {
    let ((low_codes, low_parity), (high_codes, high_parity)) = (snap_end(low), snap_end(high));
    let (codes, parity) = ([low_codes, high_codes], [low_parity, high_parity]);
    let (steps, miss) = nearest_steps(px, &codes, &parity);
    Candidate { codes, parity, steps, miss }
}

/// Среднее блока и главная ось: восемь шагов степенного метода от `(1, 1, 1, 0.25)`.
fn principal_axis(px: &[Px; 16]) -> (Pt, Pt) {
    let mean: Pt = std::array::from_fn(|c| f64::from(px.iter().map(|p| p[c]).sum::<i32>()) / 16.0);
    let cov: [[f64; 4]; 4] = std::array::from_fn(|i| {
        std::array::from_fn(|j| {
            let (a, b) = (i.min(j), i.max(j));
            px.iter().fold(0.0, |sum, p| sum + (f64::from(p[a]) - mean[a]) * (f64::from(p[b]) - mean[b]))
        })
    });
    let walked = (0..8).try_fold([1.0, 1.0, 1.0, 0.25], |axis, _| {
        let next = cov.map(|row| dot4(row, axis));
        let length = dot4(next, next).sqrt();
        if length < 1e-9 {
            Err(axis)
        } else {
            Ok(next.map(|v| v / length))
        }
    });
    (mean, walked.unwrap_or_else(|stopped| stopped))
}

/// Накопители уточнения по наименьшим квадратам.
#[derive(Default)]
struct Moments {
    aa: f64,
    ab: f64,
    bb: f64,
    ax: [f64; 4],
    bx: [f64; 4],
}

fn solve(px: &[Px; 16]) -> Candidate {
    let (mean, axis) = principal_axis(px);
    let along: Vec<f64> = px
        .iter()
        .map(|p| (0..4).fold(0.0, |t, c| t + (f64::from(p[c]) - mean[c]) * axis[c]))
        .collect();
    let t_min = along.iter().copied().fold(f64::INFINITY, f64::min);
    let t_max = along.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let first = candidate(px, &point_on(&mean, &axis, t_min), &point_on(&mean, &axis, t_max));
    if first.miss == 0 {
        return first;
    }
    let m = px.iter().zip(&first.steps).fold(Moments::default(), |mut m, (p, &k)| {
        let t = f64::from(LEVELS[k]) / 64.0;
        let s = 1.0 - t;
        m.aa += s * s;
        m.ab += s * t;
        m.bb += t * t;
        for ((a, b), &v) in m.ax.iter_mut().zip(m.bx.iter_mut()).zip(p) {
            *a += s * f64::from(v);
            *b += t * f64::from(v);
        }
        m
    });
    let det = m.aa * m.bb - m.ab * m.ab;
    if det.abs() < 1e-6 {
        return first;
    }
    let low: Pt = std::array::from_fn(|c| (m.ax[c] * m.bb - m.bx[c] * m.ab) / det);
    let high: Pt = std::array::from_fn(|c| (m.bx[c] * m.aa - m.ax[c] * m.ab) / det);
    let second = candidate(px, &low, &high);
    if second.miss < first.miss {
        second
    } else {
        first
    }
}

/// Точка на оси: `mean + axis × t` по каналам.
fn point_on(mean: &Pt, axis: &Pt, t: f64) -> Pt {
    std::array::from_fn(|c| mean[c] + axis[c] * t)
}

/// Записывает блок: режим 6 (семь бит, число 64), концы по каналам, два общих бита,
/// индекс пикселя 0 в трёх битах и остальные по четыре. Биты идут младшим вперёд.
fn pack(best: &Candidate) -> [u8; 16] {
    // У пикселя 0 старший бит индекса обязан быть нулевым, иначе концы меняются местами.
    let flip = best.steps[0] >= 8;
    let pick = |pair: [[i32; 4]; 2]| if flip { [pair[1], pair[0]] } else { pair };
    let codes = pick(best.codes);
    let parity = if flip { [best.parity[1], best.parity[0]] } else { best.parity };
    let steps = best.steps.map(|s| if flip { 15 - s } else { s });
    let mut fields: Vec<(u128, u32)> = vec![(64, 7)];
    for c in 0..4 {
        fields.extend(codes.iter().map(|end| (end[c] as u128, 7)));
    }
    fields.extend(parity.iter().map(|&p| (p as u128, 1)));
    fields.push((steps[0] as u128, 3));
    fields.extend(steps[1..].iter().map(|&s| (s as u128, 4)));
    fields.iter().fold((0u128, 0u32), |(word, at), &(value, width)| (word | (value << at), at + width)).0.to_le_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(rgba: [u8; 4]) -> Vec<u8> {
        rgba.repeat(16)
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn flat_blocks_match_the_reference_bytes() {
        let cases: [([u8; 4], &str); 8] = [
            ([200, 100, 50, 255], "40325926cb64fe7f0000000000000000"),
            ([0, 0, 0, 255], "400000000000fe7f0000000000000000"),
            ([255, 255, 255, 255], "c0ffffffffffffff0100000000000000"),
            ([128, 128, 128, 255], "402010080402ff7f0000000000000000"),
            ([0, 0, 0, 0], "40000000000000000000000000000000"),
            ([17, 34, 51, 128], "c0442212d16880400000000000000000"),
            ([1, 1, 1, 1], "40000000000000800100000000000000"),
            ([129, 130, 131, 132], "c0603018140a85420000000000000000"),
        ];
        for (pixel, want) in cases {
            assert_eq!(hex(&encode_bc7(&flat(pixel), 4, 4)), want, "{pixel:?}");
        }
    }

    #[test]
    fn output_length_follows_the_block_grid() {
        let rgba = vec![7u8; 5 * 9 * 4];
        assert_eq!(encode_bc7(&rgba, 5, 9).len(), 2 * 3 * 16);
        assert_eq!(encode_bc7(&rgba[..4], 1, 1).len(), 16);
    }

    #[test]
    fn every_block_starts_with_the_mode_six_marker() {
        let mut state = 99u32;
        let noise: Vec<u8> = (0..12 * 8 * 4)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 24) as u8
            })
            .collect();
        let packed = encode_bc7(&noise, 12, 8);
        assert_eq!(packed.len(), 3 * 2 * 16);
        assert!(packed.chunks(16).all(|block| block[0] & 0x7f == 0x40));
    }

    #[test]
    fn edge_repeats_the_last_pixel_and_tail_bytes_are_ignored() {
        let mut state = 5u32;
        let small: Vec<u8> = (0..5 * 5 * 4)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 24) as u8
            })
            .collect();
        // то же 5x5, дополненное до 8x8 повтором последнего столбца и строки
        let mut padded = Vec::new();
        for y in 0..8usize {
            for x in 0..8usize {
                let at = (y.min(4) * 5 + x.min(4)) * 4;
                padded.extend_from_slice(&small[at..at + 4]);
            }
        }
        assert_eq!(encode_bc7(&small, 5, 5)[..16], encode_bc7(&padded, 8, 8)[..16]);
        let mut longer = small.clone();
        longer.extend_from_slice(&[9u8; 32]);
        assert_eq!(encode_bc7(&small, 5, 5), encode_bc7(&longer, 5, 5));
    }

    #[test]
    fn end_rounding_prefers_the_even_bit_on_ties() {
        assert_eq!(snap_end(&[0.0; 4]), ([0; 4], 0));
        assert_eq!(snap_end(&[1.0; 4]), ([0; 4], 1));
        assert_eq!(snap_end(&[255.0; 4]), ([127; 4], 1));
        assert_eq!(snap_end(&[-5.0, 300.0, 2.0, 3.0]).0[..2], [0, 127]);
    }

    #[test]
    #[should_panic]
    fn a_short_buffer_panics() {
        let _ = encode_bc7(&[0u8; 63], 4, 4);
    }
}
