//! Разбор краски дорожного листа на группы — `packages/climb-contract/recolor/road-paint.js` байт в байт.
//!
//! Формулы, порядок операций, точность (`f32` там, где у JS `Float32Array`, `f64` в остальном) и
//! строгие сравнения повторены дословно: карта краски обязана совпасть с JS на каждом текселе,
//! иначе лист в игре разойдётся с кадром мастерской.

/// Часть листа дороги.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Part {
    Asphalt,
    Dirt,
    Sidewalk,
    Markings,
}

/// Особый вид листа: зебра переходов или разметка парковок.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Plain,
    Crossing,
    Parking,
}

/// Групп краски: осевая, края, переходы, стоп-линии, цветная, парковка.
pub const GROUPS: usize = 6;

const YELLOW_HUE: (f64, f64) = (26.0, 72.0);
const YELLOW_SATURATION: f64 = 0.36;
const WHITE_SATURATION: f64 = 0.26;

/// `Math.round` для неотрицательных чисел сборки: половинки вверх.
pub(crate) fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// Светлота тексела 0…1 — выражение JS слева направо.
#[inline]
pub(crate) fn luma_of(r: f64, g: f64, b: f64) -> f64 {
    (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
}

/// Тон 0…360, насыщенность и яркость HSV 0…1 (`paintHsv`).
pub(crate) fn paint_hsv(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let v = max / 255.0;
    let s = if max == 0.0 { 0.0 } else { d / max };
    let mut h = 0.0;
    if d != 0.0 {
        if max == r {
            h = ((g - b) / d + if g < b { 6.0 } else { 0.0 }) * 60.0;
        } else if max == g {
            h = ((b - r) / d + 2.0) * 60.0;
        } else {
            h = ((r - g) / d + 4.0) * 60.0;
        }
    }
    (h, s, v)
}

/// Цвет краски пикселя: 1 жёлтая, 2 белая, 3 цветная, 0 — не краска (`colourClassOf`).
fn colour_class(r: u8, g: u8, b: u8, atlas: bool, floor: f64) -> u8 {
    let (r, g, b) = (f64::from(r), f64::from(g), f64::from(b));
    let max = if r > g {
        if r > b {
            r
        } else {
            b
        }
    } else if g > b {
        g
    } else {
        b
    };
    let min = if r < g {
        if r < b {
            r
        } else {
            b
        }
    } else if g < b {
        g
    } else {
        b
    };
    let d = max - min;
    if max / 255.0 < floor {
        return 0;
    }
    let s = if max == 0.0 { 0.0 } else { d / max };
    if s < WHITE_SATURATION {
        return 2;
    }
    let mut h = 0.0;
    if d != 0.0 {
        if max == r {
            h = ((g - b) / d + if g < b { 6.0 } else { 0.0 }) * 60.0;
        } else if max == g {
            h = ((b - r) / d + 2.0) * 60.0;
        } else {
            h = ((r - g) / d + 4.0) * 60.0;
        }
    }
    let yellow_floor = if atlas { 0.26 } else { YELLOW_SATURATION };
    if h >= YELLOW_HUE.0 && h <= YELLOW_HUE.1 && s >= yellow_floor {
        return 1;
    }
    if s >= 0.45 {
        return 3;
    }
    0
}

/// Индексы со сдвигом «по кругу»: `(((at + shift) % size) + size) % size`.
fn wrapped(count: usize, size: usize, shift: i64) -> Vec<usize> {
    let size = size as i64;
    (0..count as i64)
        .map(|at| (at + shift).rem_euclid(size) as usize)
        .collect()
}

/// Среднее по окну (2r + 1)² с оборачиванием (`boxBlur`): суммы — `f64`, запись — `f32`.
fn box_blur(source: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let window = (2 * radius + 1) as f64;
    let reach = radius as i64;
    let columns_add = wrapped(width, width, reach + 1);
    let columns_drop = wrapped(width, width, -reach);
    let rows_add = wrapped(height, height, reach + 1);
    let rows_drop = wrapped(height, height, -reach);
    let mut tmp = vec![0f32; source.len()];
    let mut out = vec![0f32; source.len()];
    for y in 0..height {
        let row = y * width;
        let mut sum = 0f64;
        for x in -reach..=reach {
            sum += f64::from(source[row + x.rem_euclid(width as i64) as usize]);
        }
        for x in 0..width {
            tmp[row + x] = (sum / window) as f32;
            sum += f64::from(source[row + columns_add[x]]) - f64::from(source[row + columns_drop[x]]);
        }
    }
    let mut column = vec![0f64; width];
    for y in -reach..=reach {
        let row = y.rem_euclid(height as i64) as usize * width;
        for x in 0..width {
            column[x] += f64::from(tmp[row + x]);
        }
    }
    for y in 0..height {
        let row = y * width;
        let add = rows_add[y] * width;
        let drop = rows_drop[y] * width;
        for x in 0..width {
            out[row + x] = (column[x] / window) as f32;
            column[x] += f64::from(tmp[add + x]) - f64::from(tmp[drop + x]);
        }
    }
    out
}

/// Порог Оцу по светлоте 0…1 (`otsu`).
fn otsu(values: &[f64]) -> f64 {
    let mut histogram = [0f64; 64];
    let mut count = 0f64;
    for &value in values {
        let slot = (value * 64.0).floor().min(63.0);
        histogram[slot as usize] += 1.0;
        count += 1.0;
    }
    if count == 0.0 {
        return 0.5;
    }
    let mut sum_all = 0f64;
    for (index, &weight) in histogram.iter().enumerate() {
        sum_all += index as f64 * weight;
    }
    let mut weight_back = 0f64;
    let mut sum_back = 0f64;
    let mut best = 0f64;
    let mut threshold = 32f64;
    for (index, &weight) in histogram.iter().enumerate() {
        weight_back += weight;
        if weight_back == 0.0 {
            continue;
        }
        let weight_front = count - weight_back;
        if weight_front == 0.0 {
            break;
        }
        sum_back += index as f64 * weight;
        let gap = sum_back / weight_back - (sum_all - sum_back) / weight_front;
        let between = weight_back * weight_front * (gap * gap);
        if between > best {
            best = between;
            threshold = index as f64 + 1.0;
        }
    }
    threshold / 64.0
}

/// Разброс значений вокруг среднего (`spread` в `crossingBars`).
fn spread(values: &[f32]) -> f64 {
    let length = values.len() as f64;
    let mean = values.iter().fold(0f64, |sum, &value| sum + f64::from(value)) / length;
    values.iter().fold(0f64, |sum, &value| {
        let gap = f64::from(value) - mean;
        sum + gap * gap
    }) / length
}

/// Полосы зебры (`crossingBars`): помечает кандидатов белой краской (2).
fn crossing_bars(luma: &[f32], opaque: &[u8], width: usize, height: usize, candidate: &mut [u8]) {
    let sample: Vec<f64> = (0..luma.len())
        .step_by(7)
        .filter(|&index| opaque[index] != 0)
        .map(|index| f64::from(luma[index]))
        .collect();
    let threshold = otsu(&sample);
    let (mut high, mut low, mut high_count, mut low_count) = (0f64, 0f64, 0f64, 0f64);
    for &value in &sample {
        if value >= threshold {
            high += value;
            high_count += 1.0;
        } else {
            low += value;
            low_count += 1.0;
        }
    }
    if high_count == 0.0 || low_count == 0.0 || high / high_count - low / low_count < 0.14 {
        return;
    }
    let mut by_column = vec![0f32; width];
    let mut by_row = vec![0f32; height];
    for index in 0..luma.len() {
        if opaque[index] != 0 && f64::from(luma[index]) >= threshold {
            by_column[index % width] += 1.0;
            by_row[index / width] += 1.0;
        }
    }
    for value in &mut by_column {
        *value = (f64::from(*value) / height as f64) as f32;
    }
    for value in &mut by_row {
        *value = (f64::from(*value) / width as f64) as f32;
    }
    let vertical = spread(&by_column) >= spread(&by_row);
    let profile = if vertical { &by_column } else { &by_row };
    let length = profile.len();
    let scale = length as f64;
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut at = 0;
    while at < length {
        if f64::from(profile[at]) < 0.5 {
            at += 1;
            continue;
        }
        let mut end = at;
        while end + 1 < length && f64::from(profile[end + 1]) >= 0.5 {
            end += 1;
        }
        runs.push((at, end));
        at = end + 1;
    }
    /* Близкие полосы с щелью меньше полутора процентов листа — одна полоса. */
    let mut joined: Vec<(usize, usize)> = Vec::new();
    for run in runs {
        match joined.last_mut() {
            Some(last) if (run.0 - last.1) as f64 <= scale * 0.015 => last.1 = run.1,
            _ => joined.push(run),
        }
    }
    let bars: Vec<(usize, usize)> = joined
        .into_iter()
        .filter(|&(from, to)| {
            let size = (to - from + 1) as f64;
            size >= scale * 0.025 && size <= scale * 0.3
        })
        .collect();
    let covered: usize = bars.iter().map(|&(from, to)| to - from + 1).sum();
    if bars.len() < 2 || covered as f64 > scale * 0.62 {
        return;
    }
    let across_count = if vertical { height } else { width };
    for &(from, to) in &bars {
        for across in 0..across_count {
            for along in from..=to {
                let index = if vertical { across * width + along } else { along * width + across };
                if opaque[index] != 0 {
                    candidate[index] = 2;
                }
            }
        }
    }
}

/// Карта краски листа: по текселю 0 — не краска, 1…6 — группа; `present` — маска групп листа.
pub struct Paint {
    pub groups: Vec<u8>,
    pub present: u32,
}

impl Paint {
    pub fn painted(&self) -> bool {
        self.present != 0
    }
}

/// Карта краски листа RGBA (`roadPaintGroups`).
pub fn road_paint_groups(rgba: &[u8], width: usize, height: usize, part: Part, kind: Kind, lod: bool) -> Paint {
    let total = width * height;
    let atlas = part == Part::Markings;
    let small = lod || width.min(height) <= 128;
    let mut groups = vec![0u8; total];
    let mut counts = [0usize; GROUPS];
    let mut luma = vec![0f32; total];
    let mut opaque = vec![0u8; total];
    let alpha_floor = if atlas { 24 } else { 128 };
    for index in 0..total {
        let at = index * 4;
        luma[index] = luma_of(f64::from(rgba[at]), f64::from(rgba[at + 1]), f64::from(rgba[at + 2])) as f32;
        opaque[index] = u8::from(rgba[at + 3] >= alpha_floor);
    }
    /* Кандидаты: цвет краски и — у листа асфальта — «ярче окружения». */
    let mut candidate = vec![0u8; total];
    let floor = if atlas {
        0.38
    } else if small {
        0.45
    } else {
        0.52
    };
    if atlas {
        for index in 0..total {
            if opaque[index] != 0 {
                let at = index * 4;
                candidate[index] = colour_class(rgba[at], rgba[at + 1], rgba[at + 2], true, floor);
            }
        }
    } else if kind == Kind::Crossing {
        crossing_bars(&luma, &opaque, width, height, &mut candidate);
    } else {
        let least_radius: f64 = if small { 3.0 } else { 6.0 };
        let radius = least_radius.max(js_round(width.min(height) as f64 * 0.05)) as usize;
        let local = box_blur(&luma, width, height, radius);
        let margin = if small { 0.05 } else { 0.09 };
        for index in 0..total {
            if opaque[index] == 0 || f64::from(luma[index]) - f64::from(local[index]) < margin {
                continue;
            }
            let at = index * 4;
            candidate[index] = colour_class(rgba[at], rgba[at + 1], rgba[at + 2], false, floor);
        }
    }

    /* Пятна: связные компоненты по краске, пыль — прочь. */
    let dust: f64 = if small { 4.0 } else { 10.0 };
    let least = dust.max(js_round(total as f64 * if atlas { 0.00005 } else { 0.00008 }));
    let mut seen = vec![0u8; total];
    let mut stack = vec![0usize; total];
    let mut members = vec![0usize; total];
    let long_side = width.max(height) as f64;
    let reach = if small { 1 } else { 2 };
    for start in 0..total {
        if candidate[start] == 0 || seen[start] != 0 {
            continue;
        }
        let mut top = 0;
        stack[top] = start;
        top += 1;
        seen[start] = 1;
        let mut size = 0usize;
        let (mut min_x, mut max_x, mut min_y, mut max_y) = (width, 0usize, height, 0usize);
        let colour = candidate[start];
        while top > 0 {
            top -= 1;
            let index = stack[top];
            members[size] = index;
            size += 1;
            let x = index % width;
            let y = index / width;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            let from_y = y.saturating_sub(reach);
            let to_y = if y + reach < height { y + reach } else { height - 1 };
            let from_x = x.saturating_sub(reach);
            let to_x = if x + reach < width { x + reach } else { width - 1 };
            for ny in from_y..=to_y {
                let row = ny * width;
                for nx in from_x..=to_x {
                    let next = row + nx;
                    if candidate[next] == colour && seen[next] == 0 {
                        seen[next] = 1;
                        stack[top] = next;
                        top += 1;
                    }
                }
            }
        }
        if (size as f64) < least {
            continue;
        }
        let w = max_x - min_x + 1;
        let h = max_y - min_y + 1;
        let longest = w.max(h) as f64;
        let elongated = longest / (w.min(h).max(1) as f64) >= 4.0;
        let vertical = h >= w;
        let fill = size as f64 / (w * h) as f64;
        let thickness = size as f64 / longest;
        let group: u8 = if kind == Kind::Parking {
            6
        } else if kind == Kind::Crossing {
            3
        } else if atlas {
            let mut group = if elongated && vertical && longest >= long_side * 0.25 {
                match colour {
                    3 => 5,
                    1 => 1,
                    _ => 2,
                }
            } else if elongated && !vertical && longest >= long_side * 0.25 {
                4
            } else if size as f64 >= least.max(total as f64 * 0.0003) {
                if colour == 3 {
                    5
                } else {
                    4
                }
            } else {
                continue;
            };
            if colour == 3 {
                group = 5;
            }
            group
        } else {
            let line = elongated
                && fill >= 0.4
                && thickness >= if small { 1.0 } else { 6.0 }
                && longest >= long_side * if small { 0.12 } else { 0.06 };
            let sign = !elongated && fill >= 0.4 && size as f64 >= total as f64 * 0.002;
            if !line && !sign {
                continue;
            }
            if colour == 3 {
                5
            } else if sign {
                4
            } else if colour == 1 {
                1
            } else {
                2
            }
        };
        for &member in &members[..size] {
            groups[member] = group;
        }
        counts[usize::from(group) - 1] += size;
    }

    /* Кромка: тексель рядом с краской, светлее покрытия, но ниже порога, — тоже краска. У атласа кромка — альфа листа. */
    if !atlas {
        let mut grown = groups.clone();
        for index in 0..total {
            if groups[index] != 0 || opaque[index] == 0 {
                continue;
            }
            let x = index % width;
            let mut best = 0u8;
            if x > 0 && groups[index - 1] != 0 {
                best = groups[index - 1];
            }
            if x < width - 1 && groups[index + 1] != 0 {
                best = groups[index + 1];
            }
            if index >= width && groups[index - width] != 0 {
                best = groups[index - width];
            }
            if index + width < total && groups[index + width] != 0 {
                best = groups[index + width];
            }
            if best != 0 && f64::from(luma[index]) >= 0.28 {
                grown[index] = best;
            }
        }
        for index in 0..total {
            if grown[index] != 0 && groups[index] == 0 {
                groups[index] = grown[index];
                counts[usize::from(grown[index]) - 1] += 1;
            }
        }
    }
    let present = counts
        .iter()
        .enumerate()
        .fold(0u32, |mask, (index, &count)| if count != 0 { mask | (1 << index) } else { mask });
    Paint { groups, present }
}
