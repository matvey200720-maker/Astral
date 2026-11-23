//! «Стили мира»: пять способов перекрасить кадр RGBA8 (рисованный, комикс,
//! мультяшный, акварель, ретро).
//!
//! Арифметика целочисленная (`i32`), поэтому итог одинаков до байта и совпадает с
//! правилом окна лаунчера; менять краску можно только вместе с окном и с версией
//! стадий текстур движка. Красим копии, готовый цвет кладём в первые `w × h`
//! пикселей буфера, альфа остаётся как была.

use crate::error::{Error, Result};

/// Имена стилей в порядке «в списках окна»: общая приставка плюс слово.
macro_rules! style_names {
    ($($id:ident = $word:literal),+ $(,)?) => {
        $(pub const $id: &str = concat!("style-", $word);)+
        pub const STYLES: [&str; 5] = [$($id),+];
    };
}

style_names! {
    PAINTED = "painted",
    COMIC = "comic",
    CARTOON = "cartoon",
    WATERCOLOR = "watercolor",
    RETRO = "retro",
}

type Px = [u8; 4];

/// Альфа ниже этого значения — «дыра» вырезного кадра.
const SEEN: u8 = 128;

#[derive(Clone, Copy, PartialEq)]
enum Look {
    Painted,
    Comic,
    Cartoon,
    Watercolor,
    Retro,
}

impl Look {
    fn parse(name: &str) -> Option<Look> {
        let order = [Look::Painted, Look::Comic, Look::Cartoon, Look::Watercolor, Look::Retro];
        STYLES.iter().position(|known| *known == name).map(|at| order[at])
    }

    /// Параметры общей схемы «сгладить, подтянуть тона, усилить цвет, обвести».
    fn recipe(self) -> Option<Recipe> {
        let fill = |blurs, wide_edge, levels, slope, gain, lift_mid, edge: (i32, i32), wrap_line| Recipe {
            blurs,
            wide_edge,
            levels,
            slope,
            gain,
            lift_mid,
            edge_floor: edge.0,
            edge_gain: edge.1,
            wrap_line,
        };
        match self {
            Look::Painted => Some(fill(1, false, 8, 3, 288, false, (20, 40), false)),
            Look::Comic => Some(fill(1, true, 5, 64, 340, false, (30, 72), true)),
            Look::Cartoon => Some(fill(2, false, 6, 2, 410, true, (28, 30), false)),
            Look::Watercolor => Some(fill(3, false, 8, 2, 250, false, (8, 44), false)),
            Look::Retro => None,
        }
    }
}

struct Recipe {
    blurs: usize,
    /// Контур считается по ещё раз сглаженному кадру.
    wide_edge: bool,
    levels: i32,
    slope: i32,
    gain: i32,
    /// Середина диапазона слегка приподнимается перед ступенями.
    lift_mid: bool,
    edge_floor: i32,
    edge_gain: i32,
    /// Сила линии берётся по модулю 256.
    wrap_line: bool,
}

pub fn is_style(name: &str) -> bool {
    Look::parse(name).is_some()
}

/// Красит кадр на месте. `detail == None` — подробность по размеру кадра.
pub fn style(rgba: &mut [u8], width: usize, height: usize, name: &str, detail: Option<i32>) -> Result<()> {
    let look = Look::parse(name).ok_or_else(|| Error::argument(format!("Unknown texture style: {name}")))?;
    let fits = width.min(height) > 0 && rgba.len() >= width * height * 4;
    fits.then_some(()).ok_or_else(|| Error::argument("Frame size does not match its sides."))?;
    let amount = match detail {
        Some(given) => given,
        None => detail_for(width, height),
    };
    let cutout = is_cutout(rgba) && {
        fill_hidden(rgba, width, height);
        true
    };
    let scene = Scene { w: width, h: height, amount, cutout };
    let colors = match look.recipe() {
        Some(recipe) => scene.paint(look, &recipe, rgba),
        None => scene.retro(rgba),
    };
    for (pixel, color) in rgba.chunks_exact_mut(4).zip(colors) {
        pixel[..3].copy_from_slice(&color);
    }
    Ok(())
}

/// Вырезной кадр: прозрачных точек (альфа < 128) от 3 %, видимых от 0,5 %,
/// а полупрозрачная середина (32…223) занимает не больше 40 %. Смотрит на весь
/// срез; хвост короче 4 байт не в счёт.
pub fn is_cutout(rgba: &[u8]) -> bool {
    let pixels = rgba.chunks_exact(4);
    let total = pixels.len();
    let count_alpha = |wanted: fn(u8) -> bool| pixels.clone().filter(|p| wanted(p[3])).count();
    let hidden = count_alpha(|a| a < SEEN);
    let middle = count_alpha(|a| (32..=223).contains(&a));
    let thresholds = [(hidden, (total * 3).div_ceil(100)), (total - hidden, total.div_ceil(200))];
    total > 0 && middle <= total * 2 / 5 && thresholds.iter().all(|&(have, need)| have >= need)
}

/// Восемь соседей точки.
const AROUND: [(isize, isize); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];

/// Индексы восьми соседей точки `i` с заворотом краёв; при узкой стороне один и тот
/// же пиксель может выпасть несколько раз, и каждое попадание считается.
fn neighbours(i: usize, w: usize, h: usize) -> impl Iterator<Item = usize> {
    let (x, y) = (i % w, i / w);
    AROUND.iter().map(move |&(dx, dy)| ((y + h).wrapping_add_signed(dy) % h) * w + (x + w).wrapping_add_signed(dx) % w)
}

/// Среднее (с округлением половины вверх) по тем соседям, чей цвет уже известен.
fn known_mean(rgba: &[u8], known: &[bool], near: impl Iterator<Item = usize>) -> Option<[u8; 3]> {
    let (sum, hits) = near.filter(|&j| known[j]).fold(([0u32; 3], 0u32), |(acc, n), j| {
        (std::array::from_fn(|k| acc[k] + u32::from(rgba[j * 4 + k])), n + 1)
    });
    (hits > 0).then(|| sum.map(|s| ((s + hits / 2) / hits) as u8))
}

/// Продолжает цвет под вырезом волнами от видимых точек: на каждой волне краску
/// получают скрытые точки, у которых уже есть окрашенный сосед. Альфа не трогается;
/// если скрытых нет или скрыто всё, кадр остаётся как есть.
pub fn fill_hidden(rgba: &mut [u8], width: usize, height: usize) {
    let mut known: Vec<bool> = (0..width * height).map(|i| rgba[i * 4 + 3] >= SEEN).collect();
    let mut wave: Vec<usize> = (0..known.len())
        .filter(|&i| !known[i] && neighbours(i, width, height).any(|j| known[j]))
        .collect();
    while !wave.is_empty() {
        let paint: Vec<(usize, [u8; 3])> = wave
            .iter()
            .filter_map(|&i| known_mean(rgba, &known, neighbours(i, width, height)).map(|color| (i, color)))
            .collect();
        for &(i, color) in &paint {
            rgba[i * 4..i * 4 + 3].copy_from_slice(&color);
            known[i] = true;
        }
        wave = paint.iter().flat_map(|&(i, _)| neighbours(i, width, height)).filter(|&j| !known[j]).collect();
        wave.sort_unstable();
        wave.dedup();
    }
}

/// Шкала от 0 на стороне `from` до 256 на стороне `from + over`.
fn ramp256(side: i32, from: i32, over: i32) -> i32 {
    (((side - from) * 256) / over).clamp(0, 256)
}

/// Подробность по меньшей стороне: от 0 на стороне 4 до 256 на стороне 32.
pub fn detail_for(width: usize, height: usize) -> i32 {
    ramp256(width.min(height) as i32, 4, 28)
}

/// Мелкая фактура: полная от стороны 128, треть на 64, нет ниже 32.
fn fine_texture(width: usize, height: usize) -> i32 {
    ramp256(width.min(height) as i32, 32, 96)
}

// ---------------------------------------------------------------------------
// Цвет и тон
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Tint([i32; 3]);

impl Tint {
    fn of(px: Px) -> Tint {
        Tint([px[0], px[1], px[2]].map(i32::from))
    }

    fn luma(self) -> i32 {
        (self.0.iter().zip([54, 183, 19]).map(|(c, k)| c * k).sum::<i32>() + 128) >> 8
    }

    fn each(self, f: impl Fn(i32) -> i32) -> Tint {
        Tint(self.0.map(f))
    }

    fn lifted(self, by: i32) -> Tint {
        self.each(|c| c + by)
    }

    /// Запас до белого сверху и до чёрного снизу.
    fn headroom(self) -> (i32, i32) {
        let top = self.0.iter().copied().max().unwrap_or(0);
        let bottom = self.0.iter().copied().min().unwrap_or(0);
        (255 - top, bottom)
    }

    /// Сдвиг яркости, не выводящий ни один канал за 0…255.
    fn within(self, shift: i32) -> i32 {
        let (up, down) = self.headroom();
        shift.clamp(-down, up)
    }

    /// Усиление насыщенности слабеет в пределах 48 от чёрного и белого.
    fn boost(self, gain: i32) -> i32 {
        if gain <= 256 {
            return gain;
        }
        let (up, down) = self.headroom();
        let share = [up, down].into_iter().filter(|&room| room < 48).map(|room| room * 256 / 48).fold(256, i32::min);
        256 + (((gain - 256) * share) >> 8)
    }

    fn vivid(self, lum: i32, gain: i32) -> Tint {
        let boost = self.boost(gain);
        self.each(|c| (lum + (((c - lum) * boost) >> 8)).clamp(0, 255))
    }

    /// Смесь к цвету `target` на долю `m` из 255.
    fn toward(self, target: [i32; 3], m: i32) -> Tint {
        Tint(std::array::from_fn(|k| mix(self.0[k], target[k], m)))
    }

    /// Тёмная версия собственного цвета: `(c × num) >> 8`, смешанная на долю `m`.
    fn darker(self, num: i32, m: i32) -> Tint {
        self.each(|c| mix(c, (c * num) >> 8, m))
    }

    fn bytes(self) -> [u8; 3] {
        self.0.map(|c| c.clamp(0, 255) as u8)
    }
}

fn mix(a: i32, b: i32, m: i32) -> i32 {
    a + (((b - a) * m) + 127) / 255
}

/// Сглаженная лестница из `levels` ступеней; `slope` — резкость перехода.
fn band(y: i32, levels: i32, slope: i32) -> i32 {
    // Положение в «клетках по 256»: целая часть и остаток (оба неотрицательны).
    let scaled = y * (levels - 1);
    let (cell, rest) = (scaled.div_euclid(256), scaled.rem_euclid(256));
    let blend = ease((rest - 128) * slope + 128);
    (cell * 256 + blend) * 255 / ((levels - 1) * 256)
}

/// Сглаженная ступенька: `raw` зажимается в 0…256, затем `3t² - 2t³` в долях 256.
fn ease(raw: i32) -> i32 {
    let t = raw.clamp(0, 256);
    (768 * t * t - 2 * t * t * t) >> 16
}

fn point_hash(x: i32, y: i32, seed: i32) -> i32 {
    let seeded = [(x, 374_761_393u32), (y, 668_265_263), (seed, 2_147_483_647)]
        .iter()
        .fold(0u32, |sum, &(v, k)| sum.wrapping_add((v as u32).wrapping_mul(k)));
    let stirred = (seeded ^ (seeded >> 13)).wrapping_mul(1_274_126_177);
    i32::from(((stirred ^ (stirred >> 16)) & 255) as u8)
}

/// Зерно бумаги из трёх масштабов шума, диапазон -382…382.
fn grain(x: i32, y: i32) -> i32 {
    (0..3).map(|octave| point_hash(x >> octave, y >> octave, octave + 1)).sum::<i32>() - 382
}

fn grain_paper(x: usize, y: usize, strength: i32, fine: i32) -> i32 {
    (((grain(x as i32, y as i32) * strength) >> 10) * fine) >> 8
}

/// Линия контура: порог, усиление, затем доля подробности.
fn stroke(e: i32, floor: i32, gain: i32, detail: i32) -> i32 {
    ((((e - floor) * gain) >> 4).clamp(0, 255) * detail) >> 8
}

fn running_total(hist: &[i64; 256]) -> [i64; 256] {
    let mut run = 0;
    hist.map(|n| {
        run += n;
        run
    })
}

/// Диапазон яркости текстуры (процентили 2 и 98) и сила постеризации по нему.
struct Tone {
    floor: i32,
    spread: i32,
    crisp: i32,
}

impl Tone {
    fn from_hist(hist: &Histogram) -> Tone {
        let totals = running_total(&hist.bins);
        let percentile = |percent: i64| totals.iter().position(|run| run * 100 >= hist.total * percent).unwrap_or(255) as i32;
        let floor = percentile(2);
        let spread = percentile(98) - floor;
        Tone { floor, spread, crisp: (((spread - 16) * 256) / 48).clamp(0, 256) }
    }

    /// Положение яркости внутри диапазона, 0…255.
    fn locate(&self, lum: i32) -> i32 {
        match self.spread {
            s if s > 0 => (((lum - self.floor) * 255) / s).clamp(0, 255),
            _ => 0,
        }
    }

    /// Яркость, соответствующая ступени `level` (шкала 0…255 внутри диапазона).
    fn aim(&self, level: i32) -> i32 {
        self.floor + level * self.spread / 255
    }

    /// Сдвиг яркости `lum` к ступени `level`.
    fn nudge(&self, lum: i32, level: i32) -> i32 {
        match self.crisp {
            0 => 0,
            crisp => ((self.aim(level) - lum) * crisp) >> 8,
        }
    }
}

/// Счётчики яркости 0…255 и общий вес.
struct Histogram {
    bins: [i64; 256],
    total: i64,
}

impl Histogram {
    fn add(&mut self, level: i32, weight: i64) {
        self.bins[level as usize] += weight;
        self.total += weight;
    }

    /// Яркости всех полных пикселей копии; с `visible_only` дыры пропускаются.
    fn of(cells: &[Px], visible_only: bool) -> Histogram {
        let mut hist = Histogram { bins: [0; 256], total: 0 };
        for p in cells.iter().filter(|p| !visible_only || p[3] >= SEEN) {
            hist.add(Tint::of(*p).luma(), 1);
        }
        hist
    }
}

// ---------------------------------------------------------------------------
// Сглаживание и контур
// ---------------------------------------------------------------------------

fn before(i: usize, n: usize) -> usize {
    (i + n - 1) % n
}

fn after(i: usize, n: usize) -> usize {
    (i + 1) % n
}

/// Все точки кадра по строкам: `(строка, столбец)`.
fn grid(h: usize, w: usize) -> impl Iterator<Item = (usize, usize)> {
    (0..h).flat_map(move |y| (0..w).map(move |x| (y, x)))
}

/// Сглаживание `[1 2 1]` по горизонтали, затем по вертикали, края заворачиваются;
/// промежуточный итог 8-битный. Первое чтение — слева от точки (0, 0).
fn soften<const N: usize>(fetch: impl Fn(usize) -> [u8; N], w: usize, h: usize) -> Vec<[u8; N]> {
    let tri = |a: [u8; N], b: [u8; N], c: [u8; N]| -> [u8; N] {
        std::array::from_fn(|k| ((i32::from(a[k]) + 2 * i32::from(b[k]) + i32::from(c[k]) + 2) >> 2) as u8)
    };
    let across: Vec<[u8; N]> = grid(h, w).map(|(y, x)| tri(fetch(y * w + before(x, w)), fetch(y * w + x), fetch(y * w + after(x, w)))).collect();
    grid(h, w)
        .map(|(y, x)| tri(across[before(y, h) * w + x], across[y * w + x], across[after(y, h) * w + x]))
        .collect()
}

/// Откуда читает сглаживание: сам буфер кадра (первый проход) или готовая копия.
enum Source<'a> {
    Bytes(&'a [u8]),
    Cells(&'a [Px]),
}

impl Source<'_> {
    fn count(&self) -> usize {
        match self {
            Source::Bytes(bytes) => bytes.len() / 4,
            Source::Cells(cells) => cells.len(),
        }
    }

    fn pixel(&self, i: usize) -> Px {
        match self {
            Source::Bytes(bytes) => {
                let at = i * 4;
                [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]
            }
            Source::Cells(cells) => cells[i],
        }
    }
}

/// Сглаженная копия той же длины: за кадром нули, альфа прежняя.
fn blur(src: Source, w: usize, h: usize) -> Vec<Px> {
    let colors = soften(
        |i| {
            let [r, g, b, _] = src.pixel(i);
            [r, g, b]
        },
        w,
        h,
    );
    let mut out = vec![[0u8; 4]; src.count()];
    for (i, (slot, c)) in out.iter_mut().zip(&colors).enumerate() {
        *slot = [c[0], c[1], c[2], src.pixel(i)[3]];
    }
    out
}

/// Вес соседей по линии `[1 2 1]` для разностей Собеля.
const TAP_WEIGHT: [i32; 3] = [1, 2, 1];

/// Градиент Собеля: на точку берётся сильнейший из каналов R, G, B.
fn gradient(cells: &[Px], w: usize, h: usize) -> Vec<u8> {
    grid(h, w)
        .map(|(y, x)| {
            let (rows, cols) = ([before(y, h), y, after(y, h)], [before(x, w), x, after(x, w)]);
            let tap: [[Px; 3]; 3] = std::array::from_fn(|r| std::array::from_fn(|c| cells[rows[r] * w + cols[c]]));
            let strongest = (0..3).map(|ch| {
                let across: i32 = (0..3).map(|r| TAP_WEIGHT[r] * (i32::from(tap[r][2][ch]) - i32::from(tap[r][0][ch]))).sum();
                let down: i32 = (0..3).map(|c| TAP_WEIGHT[c] * (i32::from(tap[2][c][ch]) - i32::from(tap[0][c][ch]))).sum();
                (across.abs() + down.abs()) >> 2
            });
            strongest.fold(0, i32::max).min(255) as u8
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Покраска
// ---------------------------------------------------------------------------

struct Scene {
    w: usize,
    h: usize,
    amount: i32,
    cutout: bool,
}

/// Штриховка комикса: медиана яркости, активность контура и период штрихов.
struct Hatching {
    median: i32,
    activity: Vec<u8>,
    period: usize,
}

const COMIC_INK: [i32; 3] = [14, 12, 18];

/// Тона и цвет точки после общей схемы: яркость до и после сдвига.
struct Graded {
    tint: Tint,
    before: i32,
    after: i32,
}

impl Recipe {
    /// Сдвиг яркости к ступени, затем усиление насыщенности.
    fn grade(&self, base: Tint, tone: &Tone) -> Graded {
        let before = base.luma();
        let pos = tone.locate(before);
        let level = if self.lift_mid { (pos + ((pos * (255 - pos)) >> 11)).clamp(0, 255) } else { pos };
        let moved = base.lifted(base.within(tone.nudge(before, band(level, self.levels, self.slope))));
        let after = moved.luma();
        Graded { tint: moved.vivid(after, self.gain), before, after }
    }
}

/// Прямоугольный блок кадра `[x0, x1) × [y0, y1)`.
#[derive(Clone, Copy)]
struct Block {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}

impl Block {
    /// Блоки со стороной `side` по строкам; крайние могут быть меньше.
    fn tiles(w: usize, h: usize, side: usize) -> impl Iterator<Item = Block> {
        grid(h.div_ceil(side), w.div_ceil(side)).map(move |(r, c)| Block {
            x0: c * side,
            y0: r * side,
            x1: ((c + 1) * side).min(w),
            y1: ((r + 1) * side).min(h),
        })
    }

    /// Индексы пикселей блока в кадре шириной `w`.
    fn indices(self, w: usize) -> impl Iterator<Item = usize> {
        grid(self.y1 - self.y0, self.x1 - self.x0).map(move |(r, c)| (self.y0 + r) * w + self.x0 + c)
    }

    /// Среднее по блоку с округлением половины вверх.
    fn mean(self, rgba: &[u8], w: usize) -> Tint {
        let n = self.indices(w).count() as i32;
        let sum = self.indices(w).fold([0i32; 3], |acc, i| std::array::from_fn(|k| acc[k] + i32::from(rgba[i * 4 + k])));
        Tint(sum.map(|s| (s + n / 2) / n))
    }
}

/// Цвет блока ретро: яркость к ближайшей из восьми ступеней, цветоразность к кратным 28.
fn retro_color(mean: Tint, tone: &Tone) -> Tint {
    if tone.crisp == 0 {
        return mean;
    }
    let lum = mean.luma();
    let level = ((tone.locate(lum) * 7 + 127) / 255) * 255 / 7;
    let target = lum + tone.nudge(lum, level);
    let snap = |c: i32| ((c + 14 * c.signum()) / 28) * 28;
    let pulled = |channel: i32| {
        let diff = channel - lum;
        (target + diff + (((snap(diff) - diff) * tone.crisp) >> 8)).clamp(0, 255)
    };
    let (red, blue) = (pulled(mean.0[0]), pulled(mean.0[2]));
    Tint([red, ((target << 8) - 54 * red - 19 * blue) / 183, blue])
}

impl Scene {
    fn paint(&self, look: Look, rec: &Recipe, rgba: &[u8]) -> Vec<[u8; 3]> {
        let (w, h, amount) = (self.w, self.h, self.amount);
        let soft = (1..rec.blurs).fold(blur(Source::Bytes(rgba), w, h), |layer, _| blur(Source::Cells(&layer), w, h));
        let wide;
        let edge_source: &[Px] = if rec.wide_edge {
            wide = blur(Source::Cells(&soft), w, h);
            &wide
        } else {
            &soft
        };
        let edge = gradient(edge_source, w, h);
        let hist = Histogram::of(&soft, self.cutout);
        let tone = Tone::from_hist(&hist);
        let fine = if look == Look::Cartoon { 0 } else { (fine_texture(w, h) * amount) >> 8 };
        let hatching = (look == Look::Comic).then(|| {
            let median = running_total(&hist.bins)[..255].iter().position(|run| run * 2 >= hist.total).unwrap_or(255) as i32;
            let plane = |src: &[u8]| soften(|i| [src[i]], w, h).into_iter().map(|[v]| v).collect::<Vec<u8>>();
            Hatching { median, activity: plane(&plane(&edge)), period: if w.min(h) >= 96 { 4 } else { 3 } }
        });
        grid(h, w)
            .map(|(y, x)| {
                let i = y * w + x;
                let Graded { tint: graded, before: lum, after: lum_moved } = rec.grade(Tint::of(soft[i]), &tone);
                let mut ink = stroke(i32::from(edge[i]), rec.edge_floor, rec.edge_gain, amount);
                if rec.wrap_line {
                    ink &= 255;
                }
                let done = match look {
                    Look::Painted => {
                        let inked = graded.toward([46, 32, 26], ink);
                        let mut paper = grain_paper(x, y, 22, fine);
                        if paper < 0 {
                            paper = (paper * inked.luma().min(64)) >> 6;
                        }
                        inked.lifted(paper)
                    }
                    Look::Comic => {
                        let marks = hatching.as_ref().expect("штриховка комикса");
                        let in_shadow = lum + 30 < marks.median && marks.activity[i] >= 12;
                        let hatched = if fine > 0 && in_shadow && (x + y) % marks.period == 0 {
                            graded.toward(COMIC_INK, (130 * fine) >> 8)
                        } else {
                            graded
                        };
                        hatched.toward(COMIC_INK, ink)
                    }
                    Look::Cartoon => graded.darker(90, ink),
                    _ => {
                        let whiten = (36 * lum_moved.min(128)) >> 7;
                        let pale = graded.each(|c| c + (((255 - c) * whiten) >> 8));
                        pale.darker(150, ink).lifted(grain_paper(x, y, 18, fine))
                    }
                };
                done.bytes()
            })
            .collect()
    }

    /// Ретро: цвет усредняется блоками, яркость тянется к одной из восьми ступеней,
    /// а цветоразность — к кратным 28.
    fn retro(&self, rgba: &[u8]) -> Vec<[u8; 3]> {
        let (w, h) = (self.w, self.h);
        let side = [(128, 4), (64, 2)].iter().find(|&&(least, _)| w.min(h) >= least).map_or(1, |&(_, s)| s);
        let tiles: Vec<(Block, Tint)> = Block::tiles(w, h, side).map(|block| (block, block.mean(rgba, w))).collect();
        let mut hist = Histogram { bins: [0; 256], total: 0 };
        for (block, mean) in &tiles {
            let seen = block.indices(w).filter(|&i| !self.cutout || rgba[i * 4 + 3] >= SEEN).count();
            hist.add(mean.luma(), seen as i64);
        }
        let tone = Tone::from_hist(&hist);
        let mut out = vec![[0u8; 3]; w * h];
        for (block, mean) in &tiles {
            let color = retro_color(*mean, &tone).bytes();
            block.indices(w).for_each(|i| out[i] = color);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: usize, h: usize, rgb: [u8; 3], alpha: u8) -> Vec<u8> {
        (0..w * h).flat_map(|_| [rgb[0], rgb[1], rgb[2], alpha]).collect()
    }

    #[test]
    fn black_and_white_stay_themselves_under_every_style() {
        for name in STYLES {
            let mut black = vec![0, 0, 0, 255];
            style(&mut black, 1, 1, name, None).unwrap();
            assert_eq!(black, [0, 0, 0, 255], "{name}");
            let mut white = vec![255, 255, 255, 255];
            style(&mut white, 1, 1, name, None).unwrap();
            assert_eq!(white, [255, 255, 255, 255], "{name}");
        }
        assert_eq!(Tint([0, 0, 0]).luma(), 0);
        assert_eq!(Tint([255, 255, 255]).luma(), 255);
        assert_eq!(Tint([255, 0, 0]).luma(), 54);
        assert_eq!(point_hash(3, 5, 1), point_hash(3, 5, 1));
        assert!((0..=255).contains(&point_hash(-1, 7, 2)));
        assert!((0..=255).contains(&point_hash(12345, 678, 3)));
    }

    #[test]
    fn detail_grows_with_the_side() {
        assert_eq!(detail_for(4, 4), 0);
        assert_eq!(detail_for(32, 32), 256);
        assert_eq!(detail_for(4096, 4096), 256);
        assert_eq!(detail_for(5, 1000), 9);
        assert_eq!(detail_for(16, 16), 109);
    }

    #[test]
    fn unknown_style_and_bad_size_are_refused() {
        let mut frame = vec![0u8; 64];
        let err = style(&mut frame, 4, 4, "style-nope", None).unwrap_err();
        assert_eq!(err.to_string(), "Unknown texture style: style-nope");
        let err = style(&mut frame, 8, 8, PAINTED, None).unwrap_err();
        assert_eq!(err.to_string(), "Frame size does not match its sides.");
        assert!(style(&mut frame, 0, 4, COMIC, None).is_err());
        assert!(style(&mut frame, 4, 4, PAINTED, None).is_ok());
        assert!(!is_style("Style-Painted") && is_style(RETRO));
    }

    #[test]
    fn opaque_frame_is_not_a_cutout_and_a_leaf_frame_is() {
        assert!(!is_cutout(&vec![200u8; 16 * 16 * 4]));
        let mut leaves = vec![0u8; 16 * 16 * 4];
        for (i, pixel) in leaves.chunks_exact_mut(4).enumerate() {
            pixel[3] = if i % 3 == 0 { 255 } else { 0 };
        }
        assert!(is_cutout(&leaves));
        assert!(!is_cutout(&[]) && !is_cutout(&[0, 0, 0]));
    }

    #[test]
    fn hidden_colour_is_filled_from_visible_neighbours() {
        let mut frame = solid(3, 3, [90, 40, 10], 255);
        frame[16..20].copy_from_slice(&[0, 40, 10, 0]);
        fill_hidden(&mut frame, 3, 3);
        assert_eq!(&frame[16..20], &[90, 40, 10, 0]);
    }

    #[test]
    fn fill_rounds_halves_up_and_wraps_around_the_edges() {
        // сумма синего у соседей 340, это 42,5: уходит вверх
        let around = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [0, 0, 0], [13, 14, 15], [16, 17, 18], [19, 20, 22], [100, 101, 255]];
        let mut frame: Vec<u8> = around.iter().flat_map(|c| [c[0], c[1], c[2], 255]).collect();
        frame[19] = 0;
        fill_hidden(&mut frame, 3, 3);
        assert_eq!(&frame[16..20], &[21, 22, 43, 0]);
        // угол (0,0) берёт соседей с противоположных краёв
        let mut corner: Vec<u8> = (0..16).flat_map(|i| [i * 10, 60, 70, 255]).collect();
        corner[3] = 0;
        fill_hidden(&mut corner, 4, 4);
        assert_eq!(&corner[..4], &[75, 60, 70, 0]);
    }

    #[test]
    fn tail_changes_cutout_decision_but_not_the_tail_bytes() {
        let mut frame = solid(4, 4, [9, 8, 7], 255);
        frame.extend_from_slice(&[1, 2, 3, 0].repeat(6));
        let tail = frame[64..].to_vec();
        assert!(is_cutout(&frame));
        style(&mut frame, 4, 4, WATERCOLOR, None).unwrap();
        assert_eq!(&frame[64..], &tail[..]);
    }

    #[test]
    fn repeated_calls_are_deterministic_and_keep_alpha() {
        let mut a = (0..33 * 17 * 4).map(|i| (i * 37 % 251) as u8).collect::<Vec<_>>();
        for pixel in a.chunks_exact_mut(4) {
            pixel[3] = if pixel[0] % 5 == 0 { 0 } else { 255 };
        }
        let b = a.clone();
        for name in STYLES {
            let (mut x, mut y) = (a.clone(), b.clone());
            style(&mut x, 33, 17, name, Some(200)).unwrap();
            style(&mut y, 33, 17, name, Some(200)).unwrap();
            assert_eq!(x, y);
            assert!(x.chunks_exact(4).zip(a.chunks_exact(4)).all(|(p, q)| p[3] == q[3]));
        }
    }
}
