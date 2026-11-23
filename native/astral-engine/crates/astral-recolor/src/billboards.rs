//! «Билборды»: листы щитов в облике работы (16.11.2026, работа «Astral быстрее», помощник `sets-engine`).
//!
//! Прежняя сборка — `paintBillboardFile` (`apps/desktop/src/recolor-billboards-paint.js`) в потоках JS: у «одной картинки на все щиты» 720
//! файлов, 916 листов и около 2500 картинок щитов, 315 с процессора (замер 16.11.2026 на тестовом ПК, `scripts/probe-sets-build.mjs`),
//! из них 84 с — картинки щитов (`fitImagePixels`, `sample`), 80 с — укладка картинки в лист (`samplePicture`, `forEachBoardTexel`), 52 с —
//! сжатие DXT и deflate в `native/astral-rs`. Здесь то же самое одним процессом: файл читается из архивов игры, листы красятся, блоки
//! сжимаются и файл пишется на диск; результат — тот же байт в байт (`scripts/probe-billboards-engine.mjs`).
//!
//! Арифметика — те же выражения в том же порядке, что у JS (`packages/climb-contract/recolor/billboards.js`, `building-images.js`):
//!
//! * [`fit_image`] — `fitImagePixels` (вместе с `reduce` и билинейной `sample`);
//! * [`picture`] — `billboardPicture` для видов «Своя картинка» (в том числе кадрирование), «Ровный цвет» и «Градиент» и яркость облика;
//! * [`place_picture`], [`shade_region`] — `placeBillboardPicture` и `shadeBillboardRegion` по трём углам щита на листе;
//! * [`payload_keeping`] — `texturePayload` с оригиналом: пережимаются только тронутые блоки 4×4, остальные остаются байтами игры;
//! * [`process_file`] — файл целиком; [`build`] — задания несколькими потоками.
//!
//! Чего движок не делает (такой файл — `fallback`, его собирает приложение прежним кодом): рисунок облика поверх щита и гифка. Какой лист
//! под какой щит, что значит облик работы и размер места щита на листе (`Math.hypot` у V8 и libm расходятся в последнем бите) считает
//! приложение и присылает числами; числа с плавающей точкой — битами `f64`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use rage_res::drawable::{self, FileKind};
use rage_res::dxt_block::{self, Format};
use rage_res::resource::Resource;
use rage_res::texture::{self, TextureRef};
use sha2::{Digest, Sha256};

use crate::build::Shelf;
use crate::dictionary::{open_resource, pack_patched, unique_refs, Clock, LEVEL_FALLBACK_BYTES};
use crate::roads::clamp8;
use crate::sheet;

/// Заголовок RSC7.
const HEADER_BYTES: usize = 16;

/// Картинка RGBA без сжатия.
#[derive(Clone, Debug)]
pub struct Image {
    pub rgba: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

/// Как картинка ложится на щит (`fit` облика).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fit {
    /// Заполнить: лишнее по краям обрезается поровну.
    Cover,
    /// Вписать целиком, поля — цвет фона.
    Contain,
    /// Растянуть по щиту.
    Stretch,
}

/// Что облик кладёт на щит.
#[derive(Clone, Debug)]
pub enum Paint {
    /// «Как в игре» (или своя картинка без картинки): меняется только яркость рекламы игры.
    Shade,
    /// Ровный цвет.
    Colour([u8; 3]),
    /// Градиент: вправо (`down == false`) или вниз.
    Gradient { from: [u8; 3], to: [u8; 3], down: bool },
    /// Своя картинка (`source` — номер в списке картинок); `zoom` и `pan_*` — кадрирование «Заполнить».
    Image { source: usize, fit: Fit, background: [u8; 3], zoom: f64, pan_x: f64, pan_y: f64 },
}

/// Облик щита: что кладём и яркость, %.
#[derive(Clone, Debug)]
pub struct Look {
    pub paint: Paint,
    pub brightness: f64,
}

/// Место щита на листе: рамка `clip` и три угла `map` (доли листа) и размер места в пикселях `size`
/// (`billboardPixels`: его считает приложение).
#[derive(Clone, Copy, Debug)]
pub struct Entry {
    pub clip: [f64; 4],
    pub map: [[f64; 2]; 3],
    pub size: [usize; 2],
}

/// Щит на листе: его облик (номер в списке обликов), пропорция щита в метрах и место.
#[derive(Clone, Copy, Debug)]
pub struct Item {
    pub look: usize,
    pub aspect: f64,
    pub entry: Entry,
}

/// Лист в файле: имя, размер по описи и щиты на нём (по порядку).
#[derive(Clone, Debug)]
pub struct SheetJob {
    pub name: String,
    pub width: usize,
    pub height: usize,
    pub items: Vec<Item>,
}

/// `Math.round`: половинки вверх, и для отрицательных тоже (`Math.round(-2.5) === -2`).
fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// Билинейная выборка с прижатыми краями (`sample` из `building-images.js`, без повтора).
fn sample(image: &Image, u: f64, v: f64, out: &mut [f64; 4]) {
    let x = u * image.width as f64 - 0.5;
    let y = v * image.height as f64 - 0.5;
    let x0 = x.floor();
    let y0 = y.floor();
    let fx = x - x0;
    let fy = y - y0;
    *out = [0.0; 4];
    let taps = [(0.0, 0.0, (1.0 - fx) * (1.0 - fy)), (1.0, 0.0, fx * (1.0 - fy)), (0.0, 1.0, (1.0 - fx) * fy), (1.0, 1.0, fx * fy)];
    for (dx, dy, weight) in taps {
        let cx = (x0 + dx).clamp(0.0, (image.width - 1) as f64) as usize;
        let cy = (y0 + dy).clamp(0.0, (image.height - 1) as f64) as usize;
        let at = (cy * image.width + cx) * 4;
        for channel in 0..4 {
            out[channel] += f64::from(image.rgba[at + channel]) * weight;
        }
    }
}

/// Уменьшение больше чем вдвое — средним по клеткам (`reduce`). `None` — картинка годится как есть.
fn reduce(image: &Image, width: f64, height: f64) -> Option<Image> {
    let kx = image.width as f64 / width;
    let ky = image.height as f64 / height;
    if kx < 2.0 && ky < 2.0 {
        return None;
    }
    let step_x = ((kx / 1.5).floor()).max(1.0) as usize;
    let step_y = ((ky / 1.5).floor()).max(1.0) as usize;
    let w = ((image.width as f64 / step_x as f64).floor()).max(1.0) as usize;
    let h = ((image.height as f64 / step_y as f64).floor()).max(1.0) as usize;
    let mut out = vec![0u8; w * h * 4];
    let cells = (step_x * step_y) as f64;
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0.0f64; 4];
            for j in 0..step_y {
                for i in 0..step_x {
                    let at = ((y * step_y + j) * image.width + (x * step_x + i)) * 4;
                    for channel in 0..4 {
                        sum[channel] += f64::from(image.rgba[at + channel]);
                    }
                }
            }
            let at = (y * w + x) * 4;
            for channel in 0..4 {
                out[at + channel] = clamp8(sum[channel] / cells);
            }
        }
    }
    Some(Image { rgba: out, width: w, height: h })
}

/// Картинка человека в `width × height` (RGBA): `fitImagePixels`. `aspect` — пропорция щита в метрах.
pub fn fit_image(image: &Image, width: usize, height: usize, fit: Fit, background: [u8; 3], aspect: f64) -> Vec<u8> {
    let mut out = vec![0u8; width * height * 4];
    let fill = background.map(f64::from);
    let target = if aspect > 0.0 { aspect } else { width as f64 / height as f64 };
    let own = image.width as f64 / (image.height as f64).max(1.0);
    let mut src = [0.0, 0.0, 1.0, 1.0];
    let mut dst = [0.0, 0.0, 1.0, 1.0];
    match fit {
        Fit::Cover => {
            if own > target {
                let share = target / own;
                src = [(1.0 - share) / 2.0, 0.0, (1.0 + share) / 2.0, 1.0];
            } else {
                let share = own / target;
                src = [0.0, (1.0 - share) / 2.0, 1.0, (1.0 + share) / 2.0];
            }
        }
        Fit::Contain => {
            if own > target {
                let share = target / own;
                dst = [0.0, (1.0 - share) / 2.0, 1.0, (1.0 + share) / 2.0];
            } else {
                let share = own / target;
                dst = [(1.0 - share) / 2.0, 0.0, (1.0 + share) / 2.0, 1.0];
            }
        }
        Fit::Stretch => {}
    }
    let visible_width = js_round((dst[2] - dst[0]) * width as f64).max(1.0);
    let visible_height = js_round((dst[3] - dst[1]) * height as f64).max(1.0);
    let reduced = reduce(image, (visible_width / (src[2] - src[0])).max(1.0), (visible_height / (src[3] - src[1])).max(1.0));
    let source = reduced.as_ref().unwrap_or(image);
    let mut colour = [0.0f64; 4];
    for y in 0..height {
        for x in 0..width {
            let at = (y * width + x) * 4;
            let s = (x as f64 + 0.5) / width as f64;
            let t = (y as f64 + 0.5) / height as f64;
            out[at] = background[0];
            out[at + 1] = background[1];
            out[at + 2] = background[2];
            out[at + 3] = 255;
            if s < dst[0] || s > dst[2] || t < dst[1] || t > dst[3] {
                continue;
            }
            let u = src[0] + ((s - dst[0]) / (dst[2] - dst[0])) * (src[2] - src[0]);
            let v = src[1] + ((t - dst[1]) / (dst[3] - dst[1])) * (src[3] - src[1]);
            sample(source, u, v, &mut colour);
            let alpha = colour[3] / 255.0;
            for channel in 0..3 {
                out[at + channel] = clamp8(colour[channel] * alpha + fill[channel] * (1.0 - alpha));
            }
        }
    }
    out
}

/// Окно картинки при «Заполнить» с кадрированием: `[x0, y0, x1, y1]` в долях картинки (`billboardCropWindow`).
fn crop_window(zoom: f64, pan_x: f64, pan_y: f64, image_aspect: f64, target_aspect: f64) -> [f64; 4] {
    let (mut w, mut h) = if image_aspect > target_aspect { (target_aspect / image_aspect, 1.0) } else { (1.0, image_aspect / target_aspect) };
    let zoom = zoom / 100.0;
    w /= zoom;
    h /= zoom;
    let cx = 0.5 + (pan_x / 100.0) * ((1.0 - w) / 2.0);
    let cy = 0.5 + (pan_y / 100.0) * ((1.0 - h) / 2.0);
    [cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0]
}

/// Кусок картинки по окну (доли) — целыми пикселями, не меньше пикселя (`cropImage`).
fn crop_image(image: &Image, window: [f64; 4]) -> Image {
    let [x0, y0, x1, y1] = window;
    let (iw, ih) = (image.width as f64, image.height as f64);
    let left = js_round(x0 * iw).min(iw - 1.0).max(0.0) as usize;
    let top = js_round(y0 * ih).min(ih - 1.0).max(0.0) as usize;
    let width = js_round((x1 - x0) * iw).min((image.width - left) as f64).max(1.0) as usize;
    let height = js_round((y1 - y0) * ih).min((image.height - top) as f64).max(1.0) as usize;
    let mut rgba = vec![0u8; width * height * 4];
    for y in 0..height {
        let from = ((top + y) * image.width + left) * 4;
        rgba[y * width * 4..(y + 1) * width * 4].copy_from_slice(&image.rgba[from..from + width * 4]);
    }
    Image { rgba, width, height }
}

/// Яркость `look.brightness` % поверх готовой картинки: `clampByte(канал × фактор)`.
fn brighten(rgba: &mut [u8], brightness: f64) {
    let factor = brightness / 100.0;
    if factor == 1.0 {
        return;
    }
    for pixel in rgba.chunks_exact_mut(4) {
        for channel in 0..3 {
            pixel[channel] = clamp8(f64::from(pixel[channel]) * factor);
        }
    }
}

/// Картинка щита `width × height` (`billboardPicture` без рисунка и гифки). `None` — у облика картинки нет («Как в игре»).
pub fn picture(look: &Look, sources: &[Image], width: usize, height: usize, aspect: f64) -> Option<Vec<u8>> {
    let mut rgba = match &look.paint {
        Paint::Shade => return None,
        Paint::Image { source, fit, background, zoom, pan_x, pan_y } => {
            let image = sources.get(*source)?;
            let cropped = *zoom != 100.0 || *pan_x != 0.0 || *pan_y != 0.0;
            if *fit == Fit::Cover && cropped {
                let target = if aspect > 0.0 { aspect } else { width as f64 / height as f64 };
                let window = crop_window(*zoom, *pan_x, *pan_y, image.width as f64 / (image.height as f64).max(1.0), target);
                fit_image(&crop_image(image, window), width, height, Fit::Stretch, [16, 16, 16], aspect)
            } else {
                fit_image(image, width, height, *fit, *background, aspect)
            }
        }
        Paint::Colour([r, g, b]) => {
            let mut rgba = vec![255u8; width * height * 4];
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[..3].copy_from_slice(&[*r, *g, *b]);
            }
            rgba
        }
        Paint::Gradient { from, to, down } => {
            let mut rgba = vec![255u8; width * height * 4];
            for y in 0..height {
                for x in 0..width {
                    let t = if *down { (y as f64 + 0.5) / height as f64 } else { (x as f64 + 0.5) / width as f64 };
                    let at = (y * width + x) * 4;
                    for channel in 0..3 {
                        let (a, b) = (f64::from(from[channel]), f64::from(to[channel]));
                        rgba[at + channel] = clamp8(a + (b - a) * t);
                    }
                }
            }
            rgba
        }
    };
    brighten(&mut rgba, look.brightness);
    Some(rgba)
}

/// Доли щита `(s, t)` точки листа `(u, v)` по трём углам (`boardSpace`).
struct BoardSpace {
    a: [f64; 2],
    e1: [f64; 2],
    e2: [f64; 2],
    det: f64,
}

impl BoardSpace {
    fn of(map: &[[f64; 2]; 3]) -> Option<Self> {
        let [a, b, c] = *map;
        let e1 = [b[0] - a[0], b[1] - a[1]];
        let e2 = [c[0] - a[0], c[1] - a[1]];
        let det = e1[0] * e2[1] - e1[1] * e2[0];
        (det.abs() >= 1e-12).then_some(Self { a, e1, e2, det })
    }

    fn at(&self, u: f64, v: f64) -> (f64, f64) {
        let du = u - self.a[0];
        let dv = v - self.a[1];
        ((du * self.e2[1] - dv * self.e2[0]) / self.det, (self.e1[0] * dv - self.e1[1] * du) / self.det)
    }
}

/// Тексели листа, что рисуют щит: обход рамки `clip` с долями щита (`forEachBoardTexel`).
fn for_each_board_texel(width: usize, height: usize, entry: &Entry, mut visit: impl FnMut(usize, f64, f64)) {
    let Some(space) = BoardSpace::of(&entry.map) else { return };
    let (w, h) = (width as f64, height as f64);
    let x0 = (entry.clip[0] * w).floor().max(0.0) as usize;
    let y0 = (entry.clip[1] * h).floor().max(0.0) as usize;
    let x1 = (entry.clip[2] * w).ceil().min(w).max(0.0) as usize;
    let y1 = (entry.clip[3] * h).ceil().min(h).max(0.0) as usize;
    /* Полтекселя запаса у края: фильтрация листа не тянет в щит соседний рисунок. */
    let slack = 0.75 / w.max(h);
    for y in y0..y1 {
        for x in x0..x1 {
            let (s, t) = space.at((x as f64 + 0.5) / w, (y as f64 + 0.5) / h);
            if s < -slack || s > 1.0 + slack || t < -slack || t > 1.0 + slack {
                continue;
            }
            visit((y * width + x) * 4, s.max(0.0).min(1.0), t.max(0.0).min(1.0));
        }
    }
}

/// Выборка картинки щита: среднее по клетке, если картинка крупнее места на листе, иначе билинейно (`samplePicture`).
#[allow(clippy::too_many_arguments)]
fn sample_picture(picture: &[u8], pw: usize, ph: usize, s: f64, t: f64, step_s: f64, step_t: f64, out: &mut [f64; 3]) {
    let fx = s * pw as f64 - 0.5;
    let fy = t * ph as f64 - 0.5;
    let reach_x = ((step_s * pw as f64) / 2.0).floor().max(0.0);
    let reach_y = ((step_t * ph as f64) / 2.0).floor().max(0.0);
    *out = [0.0; 3];
    let pixel = |x: f64, y: f64| -> usize {
        let cx = x.max(0.0).min((pw - 1) as f64) as usize;
        let cy = y.max(0.0).min((ph - 1) as f64) as usize;
        (cy * pw + cx) * 4
    };
    if reach_x > 0.0 || reach_y > 0.0 {
        let cx = js_round(fx);
        let cy = js_round(fy);
        let mut count = 0.0f64;
        let mut y = cy - reach_y;
        while y <= cy + reach_y {
            let mut x = cx - reach_x;
            while x <= cx + reach_x {
                let at = pixel(x, y);
                for channel in 0..3 {
                    out[channel] += f64::from(picture[at + channel]);
                }
                count += 1.0;
                x += 1.0;
            }
            y += 1.0;
        }
        for channel in out.iter_mut() {
            *channel /= count;
        }
        return;
    }
    let x0 = fx.floor();
    let y0 = fy.floor();
    let wx = fx - x0;
    let wy = fy - y0;
    let taps = [(0.0, 0.0, (1.0 - wx) * (1.0 - wy)), (1.0, 0.0, wx * (1.0 - wy)), (0.0, 1.0, (1.0 - wx) * wy), (1.0, 1.0, wx * wy)];
    for (dx, dy, weight) in taps {
        let at = pixel(x0 + dx, y0 + dy);
        for channel in 0..3 {
            out[channel] += f64::from(picture[at + channel]) * weight;
        }
    }
}

/// Картинку щита — в лист на месте (`placeBillboardPicture`, без рисунка поверх): тексели вне рамки щита остаются как были, альфа — 255.
pub fn place_picture(base: &mut [u8], width: usize, height: usize, entry: &Entry, picture: &[u8], pw: usize, ph: usize) {
    let step_s = 1.0 / entry.size[0] as f64;
    let step_t = 1.0 / entry.size[1] as f64;
    let mut colour = [0.0f64; 3];
    for_each_board_texel(width, height, entry, |at, s, t| {
        sample_picture(picture, pw, ph, s, t, step_s, step_t, &mut colour);
        base[at] = clamp8(colour[0]);
        base[at + 1] = clamp8(colour[1]);
        base[at + 2] = clamp8(colour[2]);
        base[at + 3] = 255;
    });
}

/// Яркость рекламы игры на месте щита (`shadeBillboardRegion`).
pub fn shade_region(base: &mut [u8], width: usize, height: usize, entry: &Entry, brightness: f64) {
    let factor = brightness / 100.0;
    if factor == 1.0 {
        return;
    }
    for_each_board_texel(width, height, entry, |at, _, _| {
        for channel in 0..3 {
            base[at + channel] = clamp8(f64::from(base[at + channel]) * factor);
        }
    });
}

/// Облик щита на листе (`paintBillboardOnSheet`): яркость рекламы игры или картинка на месте щита.
pub fn paint_item(base: &mut [u8], width: usize, height: usize, item: &Item, looks: &[Look], sources: &[Image], stages: &Stages) {
    let Some(look) = looks.get(item.look) else { return };
    let from = Instant::now();
    if matches!(look.paint, Paint::Shade) {
        shade_region(base, width, height, &item.entry, look.brightness);
        Stages::add(&stages.place, from);
        return;
    }
    let [w, h] = item.entry.size;
    let picture = picture(look, sources, w, h, item.aspect);
    Stages::add(&stages.picture, from);
    let from = Instant::now();
    if let Some(picture) = picture {
        place_picture(base, width, height, &item.entry, &picture, w, h);
    }
    Stages::add(&stages.place, from);
}

/* ------------------------------------------------------------------ *
 * Лист в файл: `texturePayload` с оригиналом
 * ------------------------------------------------------------------ */

/// Маска изменённых текселей первого уровня (`changedMask`).
fn changed_mask(rgba: &[u8], original: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut mask = vec![0u8; width * height];
    for (index, flag) in mask.iter_mut().enumerate() {
        let at = index * 4;
        if rgba[at..at + 4] != original[at..at + 4] {
            *flag = 1;
        }
    }
    mask
}

/// Маска уровнем ниже: тексель изменён, если изменён любой из четырёх под ним (`halveMask`).
fn halve_mask(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let w = (width >> 1).max(1);
    let h = (height >> 1).max(1);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut any = 0;
            'cells: for dy in 0..2 {
                for dx in 0..2 {
                    let sx = (x * 2 + dx).min(width - 1);
                    let sy = (y * 2 + dy).min(height - 1);
                    any = mask[sy * width + sx];
                    if any != 0 {
                        break 'cells;
                    }
                }
            }
            out[y * w + x] = any;
        }
    }
    out
}

/// Все уровни листа из нового первого, где пережаты только тронутые блоки 4×4, а остальные — байты игры на каждом уровне
/// (`texturePayload` с `original` и `originalData`). `None` — уровни не сошлись с длиной (у JS это отказ).
pub fn payload_keeping(format: Format, width: usize, height: usize, levels: usize, rgba: Vec<u8>, original: &[u8], original_data: &[u8]) -> Option<Vec<u8>> {
    let block_bytes = if format == Format::Dxt1 { 8 } else { 16 };
    let mut out = original_data.to_vec();
    let mut mask = changed_mask(&rgba, original, width, height);
    let mut level = (rgba, width, height);
    let mut offset = 0;
    for index in 0..levels {
        let length = dxt_block::blocks_len(format, level.1, level.2);
        if offset + length > out.len() {
            return None;
        }
        let touched_any = mask.iter().any(|&flag| flag != 0);
        if touched_any {
            let mut encoded = vec![0u8; length];
            dxt_block::encode_blocks(format, &level.0, level.1, level.2, &mut encoded);
            let columns = level.1.div_ceil(4).max(1);
            let rows = level.2.div_ceil(4).max(1);
            for by in 0..rows {
                for bx in 0..columns {
                    let mut touched = false;
                    'block: for y in by * 4..level.2.min(by * 4 + 4) {
                        for x in bx * 4..level.1.min(bx * 4 + 4) {
                            if mask[y * level.1 + x] != 0 {
                                touched = true;
                                break 'block;
                            }
                        }
                    }
                    if touched {
                        let at = (by * columns + bx) * block_bytes;
                        out[offset + at..offset + at + block_bytes].copy_from_slice(&encoded[at..at + block_bytes]);
                    }
                }
            }
        }
        offset += length;
        if index + 1 < levels {
            mask = halve_mask(&mask, level.1, level.2);
            level = sheet::halve(&level.0, level.1, level.2);
        }
    }
    (offset == out.len()).then_some(out)
}

/* ------------------------------------------------------------------ *
 * Файл целиком
 * ------------------------------------------------------------------ */

/// Время потоков по этапам (наносекунды, суммой по потокам), которых нет у `Clock`.
#[derive(Default)]
pub struct Stages {
    /// Картинки щитов (`billboardPicture`).
    pub picture: AtomicU64,
    /// Укладка картинки и яркость в лист.
    pub place: AtomicU64,
    /// Лист в файл: маска и пережатие тронутых блоков (`texturePayload`).
    pub payload: AtomicU64,
}

impl Stages {
    fn add(stage: &AtomicU64, from: Instant) {
        stage.fetch_add(u64::try_from(from.elapsed().as_nanos()).unwrap_or(u64::MAX), Ordering::Relaxed);
    }

    /// Этапы в миллисекундах потоков.
    pub fn report(&self) -> [(&'static str, u64); 3] {
        let ms = |stage: &AtomicU64| stage.load(Ordering::Relaxed) / 1_000_000;
        [("pictureMs", ms(&self.picture)), ("placeMs", ms(&self.place)), ("payloadMs", ms(&self.payload))]
    }
}

/// Итог файла.
pub enum FileOutcome {
    /// Файл с новыми листами: байты, имена легших листов (в порядке данных файла), сколько листов покрашено, листы, которых в файле нет.
    Built { bytes: Vec<u8>, textures: Vec<String>, sheets: usize, missing: Vec<String> },
    /// Ни один лист не правился.
    Unchanged { missing: Vec<String> },
    /// Файл собирает приложение прежним кодом.
    Fallback(String),
}

/// Вид файла по расширению (`kindOf`): `Some(None)` — словарь.
fn kind_of(file_name: &str) -> Option<Option<FileKind>> {
    match file_name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "ytd" => Some(None),
        "ydr" => Some(Some(FileKind::Ydr)),
        "ydd" => Some(Some(FileKind::Ydd)),
        "yft" => Some(Some(FileKind::Yft)),
        _ => None,
    }
}

/// Листы файла в порядке чтения: словарь — как есть, модель — встроенные листы всех её моделей подряд.
fn read_refs(res: &Resource, kind: Option<FileKind>) -> Result<Vec<TextureRef>, String> {
    let Some(kind) = kind else {
        return texture::read_dictionary(res).map_err(|error| error.to_string());
    };
    let model = drawable::open_model(res, Some(kind)).map_err(|error| error.to_string())?;
    let mut refs = Vec::new();
    for entry in &model.entries {
        let (_, _, embedded) = drawable::read_materials(res, entry.at).map_err(|error| error.to_string())?;
        refs.extend(embedded);
    }
    Ok(refs)
}

fn dxt_format(format: texture::Format) -> Option<Format> {
    match format {
        texture::Format::Dxt1 => Some(Format::Dxt1),
        texture::Format::Dxt3 => Some(Format::Dxt3),
        texture::Format::Dxt5 => Some(Format::Dxt5),
        _ => None,
    }
}

fn fallback(reason: impl Into<String>) -> FileOutcome {
    FileOutcome::Fallback(reason.into())
}

/// Файл щитов `file_name` под работу (`paintBillboardFile`).
pub fn process_file(raw: &[u8], file_name: &str, sheets: &[SheetJob], looks: &[Look], sources: &[Image], stages: &Stages, clock: &Clock) -> FileOutcome {
    let Some(kind) = kind_of(file_name) else {
        return fallback("вид файла не словарь и не модель");
    };
    if raw.len() < HEADER_BYTES {
        return fallback("файл короче заголовка");
    }
    let parse_from = Instant::now();
    let mut res = match open_resource(raw) {
        Ok(res) if res.complete => res,
        Ok(_) => return fallback("данные ресурса короче заявленных"),
        Err(error) => return fallback(error.to_string()),
    };
    let refs = match read_refs(&res, kind) {
        Ok(refs) => refs,
        Err(reason) => return fallback(reason),
    };
    Clock::add(&clock.parse, parse_from);
    if refs.iter().any(|item| item.complete && (!item.name.is_ascii() || item.name.bytes().all(|byte| byte.is_ascii_digit()))) {
        return fallback("имя листа вне ASCII или из одних цифр");
    }
    /* Листы по имени строчными: у модели повтор по месту данных отбрасывается (первый остаётся), как у `resourceRefs`; позднее имя заменяет раннее. */
    let mut seen_places = HashSet::new();
    let mut by_name: HashMap<String, &TextureRef> = HashMap::new();
    for item in refs.iter().filter(|item| kind.is_none() || seen_places.insert(item.data_at)) {
        by_name.insert(item.name.to_ascii_lowercase(), item);
    }

    let mut replacements: Vec<(String, Arc<Vec<u8>>)> = Vec::new();
    let mut missing = Vec::new();
    let mut painted = 0usize;
    for job in sheets {
        let Some(item) = by_name.get(&job.name).filter(|item| item.complete) else {
            missing.push(job.name.clone());
            continue;
        };
        if item.width as usize != job.width || item.height as usize != job.height {
            return fallback(format!("лист {} не того размера, что в описи", item.name));
        }
        let (Some(format), Some(data_at), Some(first)) = (item.format.and_then(dxt_format), item.data_at, item.spans.first().copied()) else {
            return fallback(format!("лист {} в формате, который движок не пишет", item.name));
        };
        let (Ok(stored), Ok(whole)) = (res.bytes(data_at + first.offset, first.bytes), res.bytes(data_at, item.bytes)) else {
            return fallback(format!("лист {} выходит за данные", item.name));
        };
        let from = Instant::now();
        let decoded = sheet::decode_blocks(format, stored, job.width, job.height);
        Clock::add(&clock.decode, from);
        let Some(original) = decoded else {
            return fallback(format!("блоки листа {} не разобрались", item.name));
        };
        let mut rgba = original.clone();
        for entry in &job.items {
            paint_item(&mut rgba, job.width, job.height, entry, looks, sources, stages);
        }
        let from = Instant::now();
        let built = payload_keeping(format, job.width, job.height, item.levels as usize, rgba, &original, whole);
        Stages::add(&stages.payload, from);
        let Some(bytes) = built else {
            return fallback(format!("уровни листа {} не сошлись с длиной", item.name));
        };
        match replacements.iter_mut().find(|(name, _)| *name == item.name) {
            Some(slot) => slot.1 = Arc::new(bytes),
            None => replacements.push((item.name.clone(), Arc::new(bytes))),
        }
        painted += 1;
    }
    if painted == 0 {
        return FileOutcome::Unchanged { missing };
    }
    let replaced: HashSet<String> = replacements.iter().map(|(name, _)| name.to_ascii_lowercase()).collect();
    let textures: Vec<String> =
        unique_refs(&refs).into_iter().filter(|(item, _)| replaced.contains(&item.name.to_ascii_lowercase())).map(|(item, _)| item.name.clone()).collect();
    match pack_patched(raw, &mut res, &refs, &replacements, Some(LEVEL_FALLBACK_BYTES), clock) {
        Ok(bytes) => FileOutcome::Built { bytes, textures, sheets: painted, missing },
        Err(reason) => fallback(reason),
    }
}

/* ------------------------------------------------------------------ *
 * Задания потоками
 * ------------------------------------------------------------------ */

/// Одно задание: файл `name` лежит в игре по месту `at` (или файлом `file` на диске — стенды и тесты без игры), готовый — в `output`.
pub struct Job {
    pub name: String,
    pub at: String,
    pub file: Option<PathBuf>,
    pub output: PathBuf,
    pub sheets: Vec<SheetJob>,
}

/// Итог задания.
pub enum Done {
    Built { bytes: usize, sha256: String, textures: Vec<String>, sheets: usize, missing: Vec<String> },
    Unchanged { missing: Vec<String> },
    /// Файла по этому месту в игре нет.
    Missing,
    /// Файл собирает приложение прежним кодом.
    Fallback(String),
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

/// Пишет файл рядом под временным именем и переименовывает.
fn write_atomic(target: &Path, bytes: &[u8], tag: usize) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut name = target.as_os_str().to_owned();
    name.push(format!(".{}-{tag}.tmp", std::process::id()));
    let scratch = PathBuf::from(name);
    let written = fs::File::create(&scratch).and_then(|mut file| file.write_all(bytes));
    if let Err(error) = written {
        fs::remove_file(&scratch).ok();
        return Err(error.to_string());
    }
    match fs::rename(&scratch, target) {
        Ok(()) => Ok(()),
        Err(error) => {
            fs::remove_file(&scratch).ok();
            if target.is_file() {
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn build_one(job: &Job, index: usize, shelf: &Shelf, looks: &[Look], sources: &[Image], stages: &Stages, clock: &Clock) -> Done {
    let read_from = Instant::now();
    let raw = match &job.file {
        Some(file) => fs::read(file).ok(),
        None => shelf.read(&job.at),
    };
    Clock::add(&clock.read, read_from);
    let Some(raw) = raw else { return Done::Missing };
    match process_file(&raw, &job.name, &job.sheets, looks, sources, stages, clock) {
        FileOutcome::Fallback(reason) => Done::Fallback(reason),
        FileOutcome::Unchanged { missing } => Done::Unchanged { missing },
        FileOutcome::Built { bytes, textures, sheets, missing } => {
            let write_from = Instant::now();
            let done = match write_atomic(&job.output, &bytes, index) {
                Ok(()) => Done::Built { bytes: bytes.len(), sha256: hex(&Sha256::digest(&bytes)), textures, sheets, missing },
                Err(reason) => Done::Fallback(format!("запись файла: {reason}")),
            };
            Clock::add(&clock.write, write_from);
            done
        }
    }
}

/// Файлы щитов `threads` потоками; итоги — в порядке заданий, рядом — время потоков по этапам. `tick` зовётся после каждого задания с
/// числом готовых, `stop` — спросить об отмене (остальные задания отдаются как `Fallback`).
#[allow(clippy::too_many_arguments)]
pub fn build(
    jobs: &[Job],
    shelf: &Shelf,
    looks: &[Look],
    sources: &[Image],
    threads: usize,
    tick: &(dyn Fn(usize) + Sync),
    stop: &(dyn Fn() -> bool + Sync),
) -> (Vec<Done>, Clock, Stages) {
    let clock = Clock::default();
    let stages = Stages::default();
    let count = jobs.len();
    let next = AtomicUsize::new(0);
    let finished = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<Done>>> = (0..count).map(|_| Mutex::new(None)).collect();
    let lane = || loop {
        let index = next.fetch_add(1, Ordering::Relaxed);
        if index >= count {
            break;
        }
        let done = if stop() { Done::Fallback("отменено".to_owned()) } else { build_one(&jobs[index], index, shelf, looks, sources, &stages, &clock) };
        if let Ok(mut slot) = slots[index].lock() {
            *slot = Some(done);
        }
        tick(finished.fetch_add(1, Ordering::Relaxed) + 1);
    };
    thread::scope(|scope| {
        for _ in 0..threads.clamp(1, count.max(1)) {
            scope.spawn(lane);
        }
    });
    let done = slots
        .into_iter()
        .map(|slot| slot.into_inner().ok().flatten().unwrap_or_else(|| Done::Fallback("поток сборки остановился".to_owned())))
        .collect();
    (done, clock, stages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient_image(width: usize, height: usize) -> Image {
        let mut rgba = vec![0u8; width * height * 4];
        for y in 0..height {
            for x in 0..width {
                let at = (y * width + x) * 4;
                rgba[at] = (x * 255 / width.max(1)) as u8;
                rgba[at + 1] = (y * 255 / height.max(1)) as u8;
                rgba[at + 2] = 90;
                rgba[at + 3] = if x == 0 { 100 } else { 255 };
            }
        }
        Image { rgba, width, height }
    }

    #[test]
    fn js_round_takes_half_up_even_below_zero() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
        assert_eq!(js_round(0.499_999_999_999_999_94), 0.0);
        assert_eq!(js_round(-0.2), 0.0);
    }

    #[test]
    fn a_picture_of_the_board_size_stays_inside_it_and_the_edges_are_clamped() {
        let image = gradient_image(8, 4);
        let out = fit_image(&image, 6, 3, Fit::Stretch, [16, 16, 16], 2.0);
        assert_eq!(out.len(), 6 * 3 * 4);
        assert!(out.chunks_exact(4).all(|pixel| pixel[3] == 255), "альфа картинки щита непрозрачна");
    }

    #[test]
    fn contain_leaves_the_background_around_the_image() {
        let image = gradient_image(4, 4);
        /* Квадратная картинка на щит 2:1: поля слева и справа цветом фона. */
        let out = fit_image(&image, 8, 4, Fit::Contain, [1, 2, 3], 2.0);
        assert_eq!(&out[..4], &[1, 2, 3, 255]);
        assert_eq!(&out[7 * 4..7 * 4 + 4], &[1, 2, 3, 255]);
        assert_ne!(&out[3 * 4..3 * 4 + 3], &[1, 2, 3], "середина — картинка");
    }

    #[test]
    fn a_big_image_is_reduced_by_cells_before_sampling() {
        let image = gradient_image(64, 64);
        assert!(reduce(&image, 8.0, 8.0).is_some());
        assert!(reduce(&image, 40.0, 40.0).is_none());
        let reduced = reduce(&image, 8.0, 8.0).unwrap();
        /* kx = 8: клетка floor(8 / 1.5) = 5, 64 / 5 = 12 клеток. */
        assert_eq!((reduced.width, reduced.height), (12, 12));
    }

    #[test]
    fn the_crop_window_is_centred_without_zoom_and_pan() {
        let window = crop_window(100.0, 0.0, 0.0, 2.0, 1.0);
        assert_eq!(window, [0.25, 0.0, 0.75, 1.0]);
        let zoomed = crop_window(200.0, 100.0, 0.0, 1.0, 1.0);
        assert_eq!(zoomed, [0.5, 0.25, 1.0, 0.75]);
        let image = gradient_image(8, 8);
        let cropped = crop_image(&image, zoomed);
        assert_eq!((cropped.width, cropped.height), (4, 4));
    }

    #[test]
    fn a_degenerate_board_frame_paints_nothing() {
        let entry = Entry { clip: [0.0, 0.0, 1.0, 1.0], map: [[0.0, 0.0], [0.5, 0.5], [1.0, 1.0]], size: [4, 4] };
        let mut base = vec![7u8; 8 * 8 * 4];
        place_picture(&mut base, 8, 8, &entry, &[255; 4 * 4 * 4], 4, 4);
        assert!(base.iter().all(|&byte| byte == 7));
        shade_region(&mut base, 8, 8, &entry, 50.0);
        assert!(base.iter().all(|&byte| byte == 7));
    }

    #[test]
    fn placing_a_picture_writes_opaque_texels_inside_the_frame_only() {
        /* Щит — левая половина листа 8 × 4 (углы: лево-верх, право-верх, лево-низ). */
        let entry = Entry { clip: [0.0, 0.0, 0.5, 1.0], map: [[0.0, 0.0], [0.5, 0.0], [0.0, 1.0]], size: [4, 4] };
        let mut base = vec![0u8; 8 * 4 * 4];
        for pixel in base.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[10, 20, 30, 40]);
        }
        let picture = vec![200u8; 4 * 4 * 4];
        place_picture(&mut base, 8, 4, &entry, &picture, 4, 4);
        assert_eq!(&base[..4], &[200, 200, 200, 255]);
        assert_eq!(&base[3 * 4..3 * 4 + 4], &[200, 200, 200, 255]);
        assert_eq!(&base[4 * 4..4 * 4 + 4], &[10, 20, 30, 40], "правее рамки лист как был");
    }

    #[test]
    fn shading_scales_the_colour_and_keeps_the_alpha() {
        let entry = Entry { clip: [0.0, 0.0, 1.0, 1.0], map: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]], size: [2, 2] };
        let mut base = vec![100u8, 200, 250, 77, 100, 200, 250, 77, 100, 200, 250, 77, 100, 200, 250, 77];
        shade_region(&mut base, 2, 2, &entry, 150.0);
        assert_eq!(&base[..4], &[150, 255, 255, 77]);
        let mut same = base.clone();
        shade_region(&mut same, 2, 2, &entry, 100.0);
        assert_eq!(same, base, "яркость 100 % лист не трогает");
    }

    #[test]
    fn only_touched_blocks_are_recompressed_on_every_level() {
        /* Лист 8 × 8 DXT1, четыре уровня: 32 + 8 + 8 + 8 байт; игра — 0xAA, правка — один тексель в углу. */
        let original_data = vec![0xAAu8; 56];
        let original = vec![50u8; 8 * 8 * 4];
        let mut rgba = original.clone();
        rgba[..4].copy_from_slice(&[255, 0, 0, 255]);
        let out = payload_keeping(Format::Dxt1, 8, 8, 4, rgba, &original, &original_data).expect("уровни сошлись");
        assert_eq!(out.len(), 56);
        assert_ne!(&out[..8], &[0xAA; 8], "первый блок первого уровня пережат");
        assert_eq!(&out[8..32], &[0xAA; 24], "остальные блоки первого уровня — байты игры");
        assert_ne!(&out[32..40], &[0xAA; 8], "уровень ниже тронут: единственный блок");
    }

    #[test]
    fn a_payload_that_does_not_fit_the_levels_is_refused() {
        let original = vec![0u8; 8 * 8 * 4];
        assert!(payload_keeping(Format::Dxt1, 8, 8, 4, original.clone(), &original, &vec![0u8; 48]).is_none());
        assert!(payload_keeping(Format::Dxt1, 8, 8, 4, original.clone(), &original, &vec![0u8; 64]).is_none());
    }

    #[test]
    fn the_stock_look_has_no_picture_and_a_colour_look_is_a_flat_sheet() {
        let shade = Look { paint: Paint::Shade, brightness: 100.0 };
        assert!(picture(&shade, &[], 4, 4, 1.0).is_none());
        let colour = Look { paint: Paint::Colour([1, 2, 3]), brightness: 100.0 };
        let out = picture(&colour, &[], 2, 2, 1.0).unwrap();
        assert!(out.chunks_exact(4).all(|pixel| pixel == [1, 2, 3, 255]));
        let dim = Look { paint: Paint::Colour([100, 200, 250]), brightness: 50.0 };
        assert_eq!(&picture(&dim, &[], 1, 1, 1.0).unwrap()[..4], &[50, 100, 125, 255]);
    }

    #[test]
    fn a_gradient_runs_by_texel_centres() {
        let look = Look { paint: Paint::Gradient { from: [0, 0, 0], to: [255, 255, 255], down: false }, brightness: 100.0 };
        let out = picture(&look, &[], 4, 1, 1.0).unwrap();
        /* t = 0,125 · 0,375 · 0,625 · 0,875 → 31,875 · 95,625 · 159,375 · 223,125. */
        assert_eq!([out[0], out[4], out[8], out[12]], [32, 96, 159, 223]);
        let down = Look { paint: Paint::Gradient { from: [0, 0, 0], to: [255, 255, 255], down: true }, brightness: 100.0 };
        let out = picture(&down, &[], 1, 2, 1.0).unwrap();
        assert_eq!([out[0], out[4]], [64, 191]);
    }
}
