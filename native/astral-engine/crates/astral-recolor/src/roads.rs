//! Пиксели листа дороги по облику работы — `roadSheetPixels` из
//! `packages/climb-contract/recolor/roads.js` байт в байт.
//!
//! Облик приходит уже разобранным (`Look`): нормализацию работы, шаблоны и плитки узоров считает
//! приложение — здесь только арифметика над текселями. Запись в лист повторяет
//! `Uint8ClampedArray`: за пределами 0…255 — край, половинки — к чётному.

// Сравнения и пределы записаны так же, как в JS (`!(k > 0)`, `Math.min(…, Math.max(…))`): по ним сверяют перенос строка в строку.
#![allow(clippy::neg_cmp_op_on_partial_ord, clippy::manual_clamp)]

use crate::paint::{js_round, luma_of, paint_hsv, road_paint_groups, Kind, Paint, Part, GROUPS};

/// Запись числа в `Uint8ClampedArray`.
#[inline]
pub(crate) fn clamp8(value: f64) -> u8 {
    if value.is_nan() || value <= 0.0 {
        0
    } else if value >= 255.0 {
        255
    } else {
        value.round_ties_even() as u8
    }
}

/// Что работа делает с краской группы (`markingState` и `groupIsStock`).
#[derive(Clone, Debug)]
pub struct GroupState {
    /// Группа как в игре: ни цвета, ни яркости, ни «Скрыть», ни общих правок.
    pub stock: bool,
    pub hidden: bool,
    pub colour: Option<[f64; 3]>,
    pub bright: f64,
    pub wear: f64,
}

/// Разметка работы: состояния шести групп по порядку `ROAD_GROUP_IDS`.
#[derive(Clone, Debug)]
pub struct Markings {
    /// Вся разметка как в игре (`roadMarkingsAreStock`).
    pub stock: bool,
    /// Маска групп, которые работа меняет (`changedGroupMask`).
    pub mask: u32,
    pub groups: [GroupState; GROUPS],
}

/// Как часть красится.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceMode {
    /// «Стандарт»: лист игры, только яркость.
    Standard,
    /// Свой ровный цвет по светотени листа.
    Colour,
    /// «Без текстуры»: ровный цвет.
    Flat,
    /// Узор, градиент или своя картинка плиткой.
    Finish,
}

/// Облик части (`project.parts[часть]`), числа уже посчитаны приложением.
#[derive(Clone, Debug)]
pub struct Surface {
    /// Часть как в игре (`roadSurfaceIsStock`).
    pub stock: bool,
    pub mode: SurfaceMode,
    /// `Number(brightness) / 100` — множитель «Стандарта».
    pub standard_k: f64,
    /// Цвет «Без текстуры» (`mode == Flat`) или ровный свой цвет (`mode == Colour`).
    pub colour: Option<[f64; 3]>,
    /// Повторов плитки на лист (`finishRepeats`).
    pub repeats: f64,
    /// Доля светотени листа под плиткой (`shade / 100`).
    pub share: f64,
    /// `(Number(brightness) || 100) / 100`.
    pub bright: f64,
}

/// Источник отделки части (`roadFinishSource`).
#[derive(Clone, Debug)]
pub enum Source {
    Tile { rgba: Vec<u8>, size: usize, clamp: bool },
    Image { rgba: Vec<u8>, width: usize, height: usize, wrap: bool },
}

/// Облик работы целиком.
#[derive(Clone, Debug)]
pub struct Look {
    pub asphalt: Surface,
    pub dirt: Surface,
    pub sidewalk: Surface,
    pub asphalt_source: Option<Source>,
    pub dirt_source: Option<Source>,
    pub sidewalk_source: Option<Source>,
    pub markings: Markings,
}

impl Look {
    fn surface(&self, part: Part) -> Option<(&Surface, Option<&Source>)> {
        match part {
            Part::Asphalt => Some((&self.asphalt, self.asphalt_source.as_ref())),
            Part::Dirt => Some((&self.dirt, self.dirt_source.as_ref())),
            Part::Sidewalk => Some((&self.sidewalk, self.sidewalk_source.as_ref())),
            Part::Markings => None,
        }
    }
}

/// Этой арифметики у движка нет (эффект цвета с синусом, отделка без источника): лист собирает приложение.
#[derive(Debug)]
pub struct Unsupported;

/// `((value % period) + period) % period` — остаток JS, знак делимого.
#[inline]
fn js_mod(value: f64, period: f64) -> f64 {
    ((value % period) + period) % period
}

/// Цвет краски: свой тон по светлоте краски игры (`lineColour`).
fn line_colour(r: f64, g: f64, b: f64, target: [f64; 3], wear: f64) -> [f64; 3] {
    let luma = luma_of(r, g, b);
    let k = (luma / 0.75).min(1.25);
    let f = 1.0 + (k - 1.0) * wear;
    [target[0] * f, target[1] * f, target[2] * f]
}

/// Краска игры без смены цвета: износ подтягивает светлоту к свежей краске (`flattenPaint`).
fn flatten_paint(r: f64, g: f64, b: f64, wear: f64) -> [f64; 3] {
    let luma = luma_of(r, g, b);
    if luma < 0.04 {
        return [r, g, b];
    }
    let scale = 1.0 + ((0.78 / luma).min(2.2) - 1.0) * (1.0 - wear);
    [r * scale, g * scale, b * scale]
}

/// Одна точка краски в облике группы (`paintAt`): цвет берётся у листа игры, пишется в `out`.
#[inline]
fn paint_at(out: &mut [u8], rgba: &[u8], at: usize, state: &GroupState) {
    let (mut r, mut g, mut b) = (f64::from(rgba[at]), f64::from(rgba[at + 1]), f64::from(rgba[at + 2]));
    if let Some(target) = state.colour {
        [r, g, b] = line_colour(r, g, b, target, state.wear);
    } else if state.wear < 1.0 {
        [r, g, b] = flatten_paint(r, g, b, state.wear);
    }
    out[at] = clamp8(r * state.bright);
    out[at + 1] = clamp8(g * state.bright);
    out[at + 2] = clamp8(b * state.bright);
}

/// Лист-атлас с разметкой по настройкам (`roadMarkingsPixels` с готовой картой краски).
fn markings_pixels(rgba: &[u8], markings: &Markings, groups: &[u8]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for (index, &group) in groups.iter().enumerate() {
        if group == 0 {
            continue;
        }
        let at = index * 4;
        let state = &markings.groups[usize::from(group) - 1];
        if state.hidden {
            out[at + 3] = 0;
        } else {
            paint_at(&mut out, rgba, at, state);
        }
    }
    out
}

/// Полосы вместо точек и завитков (`keepLongStripes`): правит `mask` на месте, ответ — текселей в полосах.
fn keep_long_stripes(mask: &mut [u8], width: usize, height: usize) -> usize {
    let total = mask.len();
    let least = 16f64.max(js_round(total as f64 * 0.0004));
    let mut stack = vec![0usize; total];
    let mut members: Vec<usize> = Vec::new();
    let mut lines = 0usize;
    for start in 0..total {
        if mask[start] != 1 {
            continue;
        }
        let mut top = 0;
        let mut size = 0usize;
        stack[top] = start;
        top += 1;
        mask[start] = 2;
        members.clear();
        let (mut min_x, mut max_x, mut min_y, mut max_y) = (width, 0usize, height, 0usize);
        while top > 0 {
            top -= 1;
            let index = stack[top];
            members.push(index);
            size += 1;
            let x = index % width;
            let y = index / width;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            if x > 0 && mask[index - 1] == 1 {
                mask[index - 1] = 2;
                stack[top] = index - 1;
                top += 1;
            }
            if x < width - 1 && mask[index + 1] == 1 {
                mask[index + 1] = 2;
                stack[top] = index + 1;
                top += 1;
            }
            if index >= width && mask[index - width] == 1 {
                mask[index - width] = 2;
                stack[top] = index - width;
                top += 1;
            }
            if index + width < total && mask[index + width] == 1 {
                mask[index + width] = 2;
                stack[top] = index + width;
                top += 1;
            }
        }
        let long = (max_y - min_y + 1) as f64 >= height as f64 * 0.2 || (max_x - min_x + 1) as f64 >= width as f64 * 0.2;
        let keep = if size as f64 >= least && long { 3 } else { 0 };
        for &index in &members {
            mask[index] = keep;
        }
        if keep != 0 {
            lines += size;
        }
    }
    for value in mask.iter_mut() {
        *value = u8::from(*value == 3);
    }
    lines
}

/// Краска бордюров в листе тротуара (`roadKerbPaintMask`): 1 — жёлтая полоса, 2 — красная.
struct KerbPaint {
    mask: Vec<u8>,
    painted: bool,
    yellow: bool,
}

fn kerb_paint_mask(original: &[u8], width: usize, height: usize) -> KerbPaint {
    let total = width * height;
    let mut yellow = vec![0u8; total];
    let mut red = vec![0u8; total];
    for index in 0..total {
        let at = index * 4;
        if original[at + 3] < 128 {
            continue;
        }
        let (h, s, v) = paint_hsv(f64::from(original[at]), f64::from(original[at + 1]), f64::from(original[at + 2]));
        /* `roadLineKind(…, 2) === "yellow"`: насыщенная, тон 26…72°, яркость от 0,4. */
        if s >= 0.36 && (26.0..=72.0).contains(&h) && v >= 0.4 {
            yellow[index] = 1;
        } else if s >= 0.5 && (h <= 14.0 || h >= 340.0) && v >= 0.3 {
            red[index] = 1;
        }
    }
    let yellows = keep_long_stripes(&mut yellow, width, height);
    let reds = keep_long_stripes(&mut red, width, height);
    let mask: Vec<u8> = (0..total)
        .map(|index| {
            if yellow[index] != 0 {
                1
            } else if red[index] != 0 {
                2
            } else {
                0
            }
        })
        .collect();
    let floor = total as f64 * 0.005;
    KerbPaint {
        mask,
        painted: (yellows + reds) as f64 >= floor,
        yellow: yellows as f64 >= floor,
    }
}

/// Яркость части поверх листа игры (`roadBrightnessPixels` над копией листа).
fn brightness_pixels(rgba: &[u8], k: f64) -> Vec<u8> {
    let mut out = rgba.to_vec();
    if !(k > 0.0) || k == 1.0 {
        return out;
    }
    for at in (0..out.len()).step_by(4) {
        out[at] = clamp8(f64::from(out[at]) * k);
        out[at + 1] = clamp8(f64::from(out[at + 1]) * k);
        out[at + 2] = clamp8(f64::from(out[at + 2]) * k);
    }
    out
}

/// Средняя светлота видимых текселей листа, каждый третий (`sheetMean`).
fn sheet_mean(rgba: &[u8]) -> f64 {
    let mut sum = 0f64;
    let mut count = 0f64;
    for at in (0..rgba.len()).step_by(12) {
        if rgba[at + 3] < 128 {
            continue;
        }
        sum += luma_of(f64::from(rgba[at]), f64::from(rgba[at + 1]), f64::from(rgba[at + 2]));
        count += 1.0;
    }
    (if count != 0.0 { sum / count } else { 0.4 }).max(0.04)
}

/// Накладка — лист с прозрачным: больше 5 % текселей прозрачнее половины (`roadSheetIsOverlay`).
fn sheet_is_overlay(rgba: &[u8]) -> bool {
    let mut clear = 0f64;
    let mut count = 0f64;
    for at in (3..rgba.len()).step_by(12) {
        count += 1.0;
        if rgba[at] < 128 {
            clear += 1.0;
        }
    }
    count > 0.0 && clear / count > 0.05
}

/// Выборка из плитки с повтором, билинейно (`sampleTile`).
fn sample_tile(tile: &[u8], size: usize, s: f64, t: f64) -> [f64; 3] {
    let scale = size as f64;
    let x = js_mod(s, 1.0) * scale - 0.5;
    let y = js_mod(t, 1.0) * scale - 0.5;
    let x0 = x.floor();
    let y0 = y.floor();
    let fx = x - x0;
    let fy = y - y0;
    let mut out = [0f64; 3];
    for dy in 0..2 {
        for dx in 0..2 {
            let px = js_mod(x0 + f64::from(dx), scale) as usize;
            let py = js_mod(y0 + f64::from(dy), scale) as usize;
            let w = (if dx == 1 { fx } else { 1.0 - fx }) * (if dy == 1 { fy } else { 1.0 - fy });
            let at = (py * size + px) * 4;
            out[0] += f64::from(tile[at]) * w;
            out[1] += f64::from(tile[at + 1]) * w;
            out[2] += f64::from(tile[at + 2]) * w;
        }
    }
    out
}

/// Выборка из картинки, растянутой на [0, 1]² (`sampleImage`).
fn sample_image(rgba: &[u8], width: usize, height: usize, s: f64, t: f64, repeat: bool) -> [f64; 3] {
    let clamp01 = |value: f64| {
        if value < 0.0 {
            0.0
        } else if value > 1.0 {
            1.0
        } else {
            value
        }
    };
    let u = if repeat { js_mod(s, 1.0) } else { clamp01(s) };
    let v = if repeat { js_mod(t, 1.0) } else { clamp01(t) };
    let x = (u * width as f64).floor().max(0.0).min(width as f64 - 1.0) as usize;
    let y = ((1.0 - v) * height as f64).floor().max(0.0).min(height as f64 - 1.0) as usize;
    let at = (y * width + x) * 4;
    [f64::from(rgba[at]), f64::from(rgba[at + 1]), f64::from(rgba[at + 2])]
}

/// Цвет отделки в точке листа (`sampleSource`).
fn sample_source(source: &Source, s: f64, t: f64) -> [f64; 3] {
    match source {
        Source::Tile { rgba, size, clamp } => {
            let pin = |value: f64| if *clamp { value.max(0.0).min(0.999) } else { value };
            sample_tile(rgba, *size, pin(s), pin(t))
        }
        Source::Image { rgba, width, height, wrap } => sample_image(rgba, *width, *height, s, 1.0 - t, *wrap),
    }
}

/// Облик части в пикселях листа (`roadSurfacePixels`).
fn surface_pixels(rgba: &[u8], width: usize, height: usize, surface: &Surface, source: Option<&Source>) -> Result<Vec<u8>, Unsupported> {
    if surface.mode == SurfaceMode::Standard {
        return Ok(brightness_pixels(rgba, surface.standard_k));
    }
    if surface.mode != SurfaceMode::Finish && surface.colour.is_none() {
        /* Свой цвет с эффектом (градиент, радуга, перелив, линия) считает приложение. */
        return Err(Unsupported);
    }
    let mut out = vec![0u8; rgba.len()];
    let mean = sheet_mean(rgba);
    let bright = surface.bright;
    for y in 0..height {
        for x in 0..width {
            let at = (y * width + x) * 4;
            let (r, g, b) = (f64::from(rgba[at]), f64::from(rgba[at + 1]), f64::from(rgba[at + 2]));
            let k = luma_of(r, g, b) / mean;
            let [cr, cg, cb] = match (surface.mode, surface.colour, source) {
                (SurfaceMode::Flat, Some(colour), _) => colour,
                (SurfaceMode::Colour, Some(colour), _) => {
                    let f = k.min(2.2);
                    [colour[0] * f, colour[1] * f, colour[2] * f]
                }
                (SurfaceMode::Finish, _, Some(source)) => {
                    let s = ((x as f64 + 0.5) / width as f64) * surface.repeats;
                    let t = ((y as f64 + 0.5) / height as f64) * surface.repeats;
                    let sample = sample_source(source, s, t);
                    let f = 1.0 + (k.min(1.6) - 1.0) * surface.share;
                    [sample[0] * f, sample[1] * f, sample[2] * f]
                }
                _ => [r, g, b],
            };
            out[at] = clamp8(cr * bright);
            out[at + 1] = clamp8(cg * bright);
            out[at + 2] = clamp8(cb * bright);
            out[at + 3] = rgba[at + 3];
        }
    }
    Ok(out)
}

/// «Скрыть разметку» на сплошном листе: линия закрашивается тем же асфальтом со стороны (`inpaintRoadLines`).
fn inpaint_road_lines(base: &[u8], mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let total = mask.len();
    let mut out = base.to_vec();
    let mut seen = vec![0u8; total];
    let mut stack = vec![0usize; total];
    let mut members: Vec<usize> = Vec::new();
    let (wide, tall) = (width as i64, height as i64);
    for start in 0..total {
        if mask[start] == 0 || seen[start] != 0 {
            continue;
        }
        let mut top = 0;
        stack[top] = start;
        top += 1;
        seen[start] = 1;
        members.clear();
        let (mut min_x, mut max_x, mut min_y, mut max_y) = (width, 0usize, height, 0usize);
        while top > 0 {
            top -= 1;
            let index = stack[top];
            members.push(index);
            let x = index % width;
            let y = index / width;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            if x > 0 && mask[index - 1] != 0 && seen[index - 1] == 0 {
                seen[index - 1] = 1;
                stack[top] = index - 1;
                top += 1;
            }
            if x < width - 1 && mask[index + 1] != 0 && seen[index + 1] == 0 {
                seen[index + 1] = 1;
                stack[top] = index + 1;
                top += 1;
            }
            if y > 0 && mask[index - width] != 0 && seen[index - width] == 0 {
                seen[index - width] = 1;
                stack[top] = index - width;
                top += 1;
            }
            if y < height - 1 && mask[index + width] != 0 && seen[index + width] == 0 {
                seen[index + width] = 1;
                stack[top] = index + width;
                top += 1;
            }
        }
        let vertical = max_y - min_y >= max_x - min_x;
        let span = (if vertical { max_x - min_x + 3 } else { max_y - min_y + 3 }) as i64;
        for &index in &members {
            let x = (index % width) as i64;
            let y = (index / width) as i64;
            let mut from = None;
            for sign in [1i64, -1] {
                let sx = if vertical { (x + sign * span).rem_euclid(wide) } else { x };
                let sy = if vertical { y } else { (y + sign * span).rem_euclid(tall) };
                let candidate = (sy * wide + sx) as usize;
                if mask[candidate] == 0 {
                    from = Some(candidate);
                    break;
                }
            }
            let Some(from) = from else { continue };
            out[index * 4] = base[from * 4];
            out[index * 4 + 1] = base[from * 4 + 1];
            out[index * 4 + 2] = base[from * 4 + 2];
        }
    }
    out
}

/// Накладка в асфальте (`roadOverlayPixels`): краска — в облике группы, остальное — облик асфальта.
fn overlay_pixels(
    rgba: &[u8],
    width: usize,
    height: usize,
    surface: &Surface,
    source: Option<&Source>,
    markings: &Markings,
    paint: &Paint,
) -> Result<Vec<u8>, Unsupported> {
    let recoloured = if surface.stock { None } else { Some(surface_pixels(rgba, width, height, surface, source)?) };
    let mut out = rgba.to_vec();
    for index in 0..width * height {
        let at = index * 4;
        if rgba[at + 3] == 0 {
            continue;
        }
        let group = paint.groups[index];
        if group != 0 {
            let state = &markings.groups[usize::from(group) - 1];
            if state.hidden {
                out[at + 3] = 0;
            } else {
                paint_at(&mut out, rgba, at, state);
            }
        } else if let Some(recoloured) = &recoloured {
            out[at] = recoloured[at];
            out[at + 1] = recoloured[at + 1];
            out[at + 2] = recoloured[at + 2];
        }
    }
    Ok(out)
}

/// Тротуар с бордюром (`roadSidewalkPixels`).
fn sidewalk_pixels(
    rgba: &[u8],
    width: usize,
    height: usize,
    surface: &Surface,
    source: Option<&Source>,
    markings: &Markings,
) -> Result<Option<Vec<u8>>, Unsupported> {
    let centre = &markings.groups[0];
    if surface.stock && centre.stock {
        return Ok(None);
    }
    let paint = kerb_paint_mask(rgba, width, height);
    if surface.stock && !paint.yellow {
        return Ok(None);
    }
    let mut base = if surface.stock { rgba.to_vec() } else { surface_pixels(rgba, width, height, surface, source)? };
    if !paint.painted {
        return Ok(Some(base));
    }
    let mut hide = vec![0u8; paint.mask.len()];
    let mut hidden = false;
    for (index, &kind) in paint.mask.iter().enumerate() {
        let at = index * 4;
        if kind == 2 {
            base[at] = rgba[at];
            base[at + 1] = rgba[at + 1];
            base[at + 2] = rgba[at + 2];
        } else if kind == 1 {
            if centre.hidden {
                hide[index] = 1;
                hidden = true;
            } else {
                paint_at(&mut base, rgba, at, centre);
            }
        }
    }
    Ok(Some(if hidden { inpaint_road_lines(&base, &hide, width, height) } else { base }))
}

/// Новые пиксели листа части `part` по работе или `None` — лист как в игре (`roadSheetPixels`).
pub fn road_sheet_pixels(
    rgba: &[u8],
    width: usize,
    height: usize,
    part: Part,
    look: &Look,
    kind: Kind,
    lod: bool,
) -> Result<Option<Vec<u8>>, Unsupported> {
    let markings = &look.markings;
    let Some((surface, source)) = look.surface(part) else {
        if markings.stock {
            return Ok(None);
        }
        let paint = road_paint_groups(rgba, width, height, part, kind, lod);
        return Ok(if paint.present & markings.mask != 0 { Some(markings_pixels(rgba, markings, &paint.groups)) } else { None });
    };
    if part == Part::Sidewalk {
        return sidewalk_pixels(rgba, width, height, surface, source, markings);
    }
    if part != Part::Asphalt {
        return if surface.stock { Ok(None) } else { surface_pixels(rgba, width, height, surface, source).map(Some) };
    }
    if surface.stock && markings.stock {
        return Ok(None);
    }
    let paint = road_paint_groups(rgba, width, height, part, kind, lod);
    if sheet_is_overlay(rgba) {
        return if paint.painted() || !surface.stock {
            overlay_pixels(rgba, width, height, surface, source, markings, &paint).map(Some)
        } else {
            Ok(None)
        };
    }
    if !paint.painted() {
        return if surface.stock { Ok(None) } else { surface_pixels(rgba, width, height, surface, source).map(Some) };
    }
    /* Асфальт как в игре, а правка разметки этих групп не касается — лист не меняется. */
    if surface.stock && paint.present & markings.mask == 0 {
        return Ok(None);
    }
    let mut base = if surface.stock { rgba.to_vec() } else { surface_pixels(rgba, width, height, surface, source)? };
    let mut hide = vec![0u8; width * height];
    let mut hidden = false;
    for (index, &group) in paint.groups.iter().enumerate() {
        if group == 0 {
            continue;
        }
        let state = &markings.groups[usize::from(group) - 1];
        if state.hidden {
            hide[index] = 1;
            hidden = true;
        } else {
            paint_at(&mut base, rgba, index * 4, state);
        }
    }
    Ok(Some(if hidden { inpaint_road_lines(&base, &hide, width, height) } else { base }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_clamp_and_round_halves_to_even_like_uint8clampedarray() {
        assert_eq!(clamp8(-3.0), 0);
        assert_eq!(clamp8(f64::NAN), 0);
        assert_eq!(clamp8(300.0), 255);
        assert_eq!(clamp8(0.5), 0);
        assert_eq!(clamp8(1.5), 2);
        assert_eq!(clamp8(2.5), 2);
        assert_eq!(clamp8(254.5), 254);
        assert_eq!(clamp8(254.51), 255);
    }

    #[test]
    fn the_js_remainder_keeps_the_sign_of_the_period() {
        assert_eq!(js_mod(-0.25, 1.0), 0.75);
        assert_eq!(js_mod(2.5, 1.0), 0.5);
        assert_eq!(js_mod(-1.0, 4.0), 3.0);
    }

    fn stock_group() -> GroupState {
        GroupState { stock: true, hidden: false, colour: None, bright: 1.0, wear: 1.0 }
    }

    fn stock_surface() -> Surface {
        Surface { stock: true, mode: SurfaceMode::Standard, standard_k: 1.0, colour: None, repeats: 1.0, share: 0.7, bright: 1.0 }
    }

    fn stock_look() -> Look {
        Look {
            asphalt: stock_surface(),
            dirt: stock_surface(),
            sidewalk: stock_surface(),
            asphalt_source: None,
            dirt_source: None,
            sidewalk_source: None,
            markings: Markings { stock: true, mask: 0, groups: std::array::from_fn(|_| stock_group()) },
        }
    }

    #[test]
    fn a_stock_work_leaves_every_sheet_as_in_the_game() {
        let rgba = vec![90u8; 16 * 16 * 4];
        let look = stock_look();
        for part in [Part::Asphalt, Part::Dirt, Part::Sidewalk, Part::Markings] {
            assert!(road_sheet_pixels(&rgba, 16, 16, part, &look, Kind::Plain, false).unwrap().is_none());
        }
    }

    #[test]
    fn a_flat_colour_replaces_the_surface_and_keeps_the_alpha() {
        let mut rgba = vec![90u8; 8 * 8 * 4];
        rgba[3] = 17;
        let mut look = stock_look();
        look.dirt = Surface { stock: false, mode: SurfaceMode::Flat, colour: Some([10.0, 20.0, 30.0]), bright: 1.5, ..stock_surface() };
        let out = road_sheet_pixels(&rgba, 8, 8, Part::Dirt, &look, Kind::Plain, false).unwrap().unwrap();
        assert_eq!(&out[0..4], &[15, 30, 45, 17]);
        assert_eq!(&out[4..8], &[15, 30, 45, 90]);
    }

    #[test]
    fn a_colour_effect_without_a_solid_colour_is_left_to_the_application() {
        let rgba = vec![90u8; 8 * 8 * 4];
        let mut look = stock_look();
        look.dirt = Surface { stock: false, mode: SurfaceMode::Colour, colour: None, ..stock_surface() };
        assert!(road_sheet_pixels(&rgba, 8, 8, Part::Dirt, &look, Kind::Plain, false).is_err());
    }
}
