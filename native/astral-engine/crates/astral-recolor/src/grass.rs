//! Цвет травы с её рисунком: ядра `packages/climb-contract/recolor/grass-colour.js` байт в байт.
//!
//! Сборка растительности «свой цвет» — последняя тяжёлая сборка на JS: 3243 файла, 6,6 ГБ, у
//! потоков JS на `grass-colour.js` уходит 29 % процессорного времени. Здесь живут чистые функции
//! над байтами — их зовёт JS через нативный модуль `native/astral-rs` (`@modovik/native-rs`,
//! `grassKernels`). Порядок сборки остаётся в JS: какой лист красить, каким цветом, в каком месте
//! мира, — решает приложение, а сюда приходят байты листа или блоков и числа облика.
//!
//! Граница проходит по циклам над пикселями, а не по одному пикселю: вызов `napi` на пиксель
//! дороже самого пикселя. Ядра:
//!
//! * [`recolour_grass`] — `recolourGrass`: лист RGBA целиком;
//! * [`blocks_weights`] и [`blocks_shift`] — `recolourDistantBlocks`: сжатый лист DXT1/3/5, опорные
//!   цвета блоков (`distantWeights`, `distantShift`, `pack565`, порядок опорных DXT1);
//! * [`rgba_weights`] и [`rgba_shift`] — `recolourDistantSand`: тот же атлас раскодированным;
//! * [`instance_colours`] — `grassInstanceColour` пачкой (по одному через `napi` выходит дороже JS).
//!
//! Цвет травы в точке (`colourAt`) считает приложение: между двумя половинами ядра дальнего плана
//! JS обходит блоки, которые тронуты, спрашивает цвет и складывает цели в таблицу (`targets`),
//! а ядру отдаёт номера целей по блокам (`slots`, `-1` — блок не трогать).
//!
//! # Одинаковость с JS
//!
//! * Порядок действий и сложений тот же, что в JS: числа JS — `f64`, значения `Float32Array` —
//!   `f32` в тех же местах (веса, цвета атласа); `Math.round` — [`js_round`], запись в
//!   `Uint8ClampedArray` — [`clamp8`].
//! * Синус, косинус и арктангенс у V8 свои, и они разные у разных сборок V8: Node 24 (V8 13) считает
//!   по `fdlibm`, а Electron 43 (V8 15) расходится с ним у 3 % синусов и косинусов и у 18 %
//!   арктангенсов; системная `libm` Rust расходится с обоими. Поэтому ядро этих трёх функций не
//!   считает: ему нужны значения, и их считает JS в том же процессе, где считался бы эталон
//!   ([`Oracle`], три вызова ядра: спросить арктангенсы → спросить углы → ответить). Совпадает с
//!   JS любой V8 — по построению. Порт `fdlibm` в [`v8`] остаётся для тестов на образцах,
//!   снятых с Node, и для движка без JS; `Math.hypot` V8 — чистая арифметика, её порт совпал с
//!   Node 24 и Electron 43 на миллионах аргументов, и этого хватает ядрам.

/* Эталон — JS и `fdlibm`: `!(x <= y)` не то же, что `x > y` для нечисла, коэффициенты `fdlibm` — как в исходнике V8. */
#![allow(clippy::neg_cmp_op_on_partial_ord, clippy::manual_clamp, clippy::excessive_precision, clippy::approx_constant, clippy::too_many_arguments)]

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

use crate::bc7::js_round;
use crate::roads::clamp8;

/// Причина отказа ядра: вход не тот, что у JS-пути, — вызывающий считает на JS.
pub type Fail = &'static str;

/// Отказ «шум»: у листа почти нет повторов цвета, память ответов не помогает, а таблицы JS дороже счёта
/// на JS. Это не сбой: вызывающий считает на JS, ядро в следующий раз берётся снова.
pub const DECLINED: Fail = "слишком много разных цветов: считает JS";

/* ------------------------------------------------------------------ *
 * Математика V8
 * ------------------------------------------------------------------ */

/// `Math.sin`, `Math.cos`, `Math.atan2` и `Math.hypot` так, как их считает V8.
///
/// Порт `fdlibm` (FreeBSD msun) из `src/base/ieee754.cc` V8 — те же коэффициенты, те же скобки.
/// Область: `sin`/`cos` — `|x| ≤ 12` (у `fdlibm` дальше идёт другая редукция аргумента, она не
/// нужна: у травы угол в пределах ±3,65); `atan2`/`hypot` — конечные аргументы.
pub mod v8 {
    /// Предел аргумента `sin`/`cos` этого порта.
    pub const TRIG_LIMIT: f64 = 12.0;

    #[inline]
    fn high(x: f64) -> i32 {
        (x.to_bits() >> 32) as u32 as i32
    }

    #[inline]
    fn low(x: f64) -> u32 {
        x.to_bits() as u32
    }

    #[inline]
    fn with_words(high: u32, low: u32) -> f64 {
        f64::from_bits((u64::from(high) << 32) | u64::from(low))
    }

    const S1: f64 = -1.66666666666666324348e-01;
    const S2: f64 = 8.33333333332248946124e-03;
    const S3: f64 = -1.98412698298579493134e-04;
    const S4: f64 = 2.75573137070700676789e-06;
    const S5: f64 = -2.50507602534068634195e-08;
    const S6: f64 = 1.58969099521155010221e-10;

    const C1: f64 = 4.16666666666666019037e-02;
    const C2: f64 = -1.38888888888741095749e-03;
    const C3: f64 = 2.48015872894767294178e-05;
    const C4: f64 = -2.75573143513906633035e-07;
    const C5: f64 = 2.08757232129817482790e-09;
    const C6: f64 = -1.13596475577881948265e-11;

    /// `sin` на `[-π/4, π/4]` с хвостом `y` (`iy == 0` — хвоста нет).
    fn kernel_sin(x: f64, y: f64, iy: i32) -> f64 {
        let ix = high(x) & 0x7fff_ffff;
        if ix < 0x3e40_0000 && (x as i32) == 0 {
            return x;
        }
        let z = x * x;
        let v = z * x;
        let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
        if iy == 0 {
            x + v * (S1 + z * r)
        } else {
            x - ((z * (0.5 * y - v * r) - y) - v * S1)
        }
    }

    /// `cos` на `[-π/4, π/4]` с хвостом `y`.
    fn kernel_cos(x: f64, y: f64) -> f64 {
        let ix = high(x) & 0x7fff_ffff;
        if ix < 0x3e40_0000 && (x as i32) == 0 {
            return 1.0;
        }
        let z = x * x;
        let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
        if ix < 0x3fd3_3333 {
            1.0 - (0.5 * z - (z * r - x * y))
        } else {
            let qx = if ix > 0x3fe9_0000 { 0.28125 } else { with_words((ix - 0x0020_0000) as u32, 0) };
            let iz = 0.5 * z - qx;
            let a = 1.0 - qx;
            a - (iz - (z * r - x * y))
        }
    }

    const INVPIO2: f64 = 6.36619772367581382433e-01;
    const PIO2_1: f64 = 1.57079632673412561417e+00;
    const PIO2_1T: f64 = 6.07710050650619224932e-11;
    const PIO2_2: f64 = 6.07710050630396597660e-11;
    const PIO2_2T: f64 = 2.02226624879595063154e-21;
    const PIO2_3: f64 = 2.02226624871116645580e-21;
    const PIO2_3T: f64 = 8.47842766036889956997e-32;
    /// Старшие слова `n·π/2`, `n = 1…8`.
    const NPIO2_HW: [i32; 8] = [0x3ff9_21fb, 0x4009_21fb, 0x4012_d97c, 0x4019_21fb, 0x401f_6a7a, 0x4022_d97c, 0x4025_fdbb, 0x4029_21fb];

    /// Аргумент по модулю `π/2`: четверть `n` и остаток `y0 + y1` (`__ieee754_rem_pio2`, `|x| ≤ 12`).
    fn rem_pio2(x: f64) -> (i32, f64, f64) {
        let hx = high(x);
        let ix = hx & 0x7fff_ffff;
        if ix <= 0x3fe9_21fb {
            return (0, x, 0.0);
        }
        if ix < 0x4002_d97c {
            return if hx > 0 {
                let mut z = x - PIO2_1;
                if ix != 0x3ff9_21fb {
                    let y0 = z - PIO2_1T;
                    (1, y0, (z - y0) - PIO2_1T)
                } else {
                    z -= PIO2_2;
                    let y0 = z - PIO2_2T;
                    (1, y0, (z - y0) - PIO2_2T)
                }
            } else {
                let mut z = x + PIO2_1;
                if ix != 0x3ff9_21fb {
                    let y0 = z + PIO2_1T;
                    (-1, y0, (z - y0) + PIO2_1T)
                } else {
                    z += PIO2_2;
                    let y0 = z + PIO2_2T;
                    (-1, y0, (z - y0) + PIO2_2T)
                }
            };
        }
        /* Среднего размера (до 2^19·π/2): четверть из `n`, редукция в три приёма по точности. */
        let t = x.abs();
        let n = (t * INVPIO2 + 0.5) as i32;
        let fnn = f64::from(n);
        let mut r = t - fnn * PIO2_1;
        let mut w = fnn * PIO2_1T;
        let mut y0;
        if n < 32 && ix != NPIO2_HW[(n - 1) as usize] {
            y0 = r - w;
        } else {
            let j = ix >> 20;
            y0 = r - w;
            let mut i = j - ((high(y0) >> 20) & 0x7ff);
            if i > 16 {
                let t2 = r;
                w = fnn * PIO2_2;
                r = t2 - w;
                w = fnn * PIO2_2T - ((t2 - r) - w);
                y0 = r - w;
                i = j - ((high(y0) >> 20) & 0x7ff);
                if i > 49 {
                    let t3 = r;
                    w = fnn * PIO2_3;
                    r = t3 - w;
                    w = fnn * PIO2_3T - ((t3 - r) - w);
                    y0 = r - w;
                }
            }
        }
        let y1 = (r - y0) - w;
        if hx < 0 {
            (-n, -y0, -y1)
        } else {
            (n, y0, y1)
        }
    }

    /// `Math.sin`; вне `|x| ≤ 12` и для нечисла — `NaN` (область порта).
    pub fn sin(x: f64) -> f64 {
        if !(x.abs() <= TRIG_LIMIT) {
            return f64::NAN;
        }
        let ix = high(x) & 0x7fff_ffff;
        if ix <= 0x3fe9_21fb {
            return kernel_sin(x, 0.0, 0);
        }
        let (n, y0, y1) = rem_pio2(x);
        match n & 3 {
            0 => kernel_sin(y0, y1, 1),
            1 => kernel_cos(y0, y1),
            2 => -kernel_sin(y0, y1, 1),
            _ => -kernel_cos(y0, y1),
        }
    }

    /// `Math.cos`; вне `|x| ≤ 12` и для нечисла — `NaN`.
    pub fn cos(x: f64) -> f64 {
        if !(x.abs() <= TRIG_LIMIT) {
            return f64::NAN;
        }
        let ix = high(x) & 0x7fff_ffff;
        if ix <= 0x3fe9_21fb {
            return kernel_cos(x, 0.0);
        }
        let (n, y0, y1) = rem_pio2(x);
        match n & 3 {
            0 => kernel_cos(y0, y1),
            1 => -kernel_sin(y0, y1, 1),
            2 => -kernel_cos(y0, y1),
            _ => kernel_sin(y0, y1, 1),
        }
    }

    const ATAN_HI: [f64; 4] = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
    const ATAN_LO: [f64; 4] = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
    const AT: [f64; 11] = [
        3.33333333333329318027e-01,
        -1.99999999998764832476e-01,
        1.42857142725034663711e-01,
        -1.11111104054623557880e-01,
        9.09088713343650656196e-02,
        -7.69187620504482999495e-02,
        6.66107313738753120669e-02,
        -5.83357013379057348645e-02,
        4.97687799461593236017e-02,
        -3.65315727442169155270e-02,
        1.62858201153657823623e-02,
    ];

    /// `atan` из `fdlibm` (конечный `x`).
    fn atan(x: f64) -> f64 {
        let hx = high(x);
        let ix = hx & 0x7fff_ffff;
        let mut x = x;
        let id: i32;
        if ix >= 0x4410_0000 {
            /* |x| ≥ 2^66 */
            return if hx > 0 { ATAN_HI[3] + ATAN_LO[3] } else { -ATAN_HI[3] - ATAN_LO[3] };
        }
        if ix < 0x3fdc_0000 {
            /* |x| < 0,4375 */
            if ix < 0x3e40_0000 {
                /* |x| < 2^-27: `huge + x > one`, значит `x` как есть */
                return x;
            }
            id = -1;
        } else {
            x = x.abs();
            if ix < 0x3ff3_0000 {
                if ix < 0x3fe6_0000 {
                    id = 0;
                    x = (2.0 * x - 1.0) / (2.0 + x);
                } else {
                    id = 1;
                    x = (x - 1.0) / (x + 1.0);
                }
            } else if ix < 0x4003_8000 {
                id = 2;
                x = (x - 1.5) / (1.0 + 1.5 * x);
            } else {
                id = 3;
                x = -1.0 / x;
            }
        }
        let z = x * x;
        let w = z * z;
        let s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
        let s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
        if id < 0 {
            x - x * (s1 + s2)
        } else {
            let at = id as usize;
            let z = ATAN_HI[at] - ((x * (s1 + s2) - ATAN_LO[at]) - x);
            if hx < 0 {
                -z
            } else {
                z
            }
        }
    }

    /// `Math.atan2(y, x)`; для нечисла и бесконечностей — `NaN` (область порта).
    pub fn atan2(y: f64, x: f64) -> f64 {
        const TINY: f64 = 1.0e-300;
        const PI_O_2: f64 = 1.5707963267948965580e+00;
        const PI: f64 = 3.1415926535897931160e+00;
        const PI_LO: f64 = 1.2246467991473531772e-16;
        if !x.is_finite() || !y.is_finite() {
            return f64::NAN;
        }
        let hx = high(x);
        let lx = low(x);
        let ix = hx & 0x7fff_ffff;
        let hy = high(y);
        let ly = low(y);
        let iy = hy & 0x7fff_ffff;
        if (hx.wrapping_sub(0x3ff0_0000) as u32 | lx) == 0 {
            return atan(y);
        }
        let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
        if (iy as u32 | ly) == 0 {
            return match m {
                0 | 1 => y,
                2 => PI + TINY,
                _ => -PI - TINY,
            };
        }
        if (ix as u32 | lx) == 0 {
            return if hy < 0 { -PI_O_2 - TINY } else { PI_O_2 + TINY };
        }
        let k = (iy - ix) >> 20;
        let z;
        let mut m = m;
        if k > 60 {
            z = PI_O_2 + 0.5 * PI_LO;
            m &= 1;
        } else if hx < 0 && k < -60 {
            z = 0.0;
        } else {
            z = atan((y / x).abs());
        }
        match m {
            0 => z,
            1 => -z,
            2 => PI - (z - PI_LO),
            _ => (z - PI_LO) - PI,
        }
    }

    /// `Math.hypot(a, b)`: масштаб по большему и сложение Кэхэна (`MathHypot` в `builtins/math.tq`).
    pub fn hypot(a: f64, b: f64) -> f64 {
        if a.is_nan() || b.is_nan() {
            return f64::NAN;
        }
        let values = [a.abs(), b.abs()];
        let mut max = 0.0f64;
        for value in values {
            if value > max {
                max = value;
            }
        }
        if max == f64::INFINITY {
            return f64::INFINITY;
        }
        if max == 0.0 {
            return 0.0;
        }
        let mut sum = 0.0f64;
        let mut compensation = 0.0f64;
        for value in values {
            let n = value / max;
            let summand = n * n - compensation;
            let preliminary = sum + summand;
            compensation = (preliminary - sum) - summand;
            sum = preliminary;
        }
        sum.sqrt() * max
    }
}

/* ------------------------------------------------------------------ *
 * Откуда ядро берёт синус, косинус и арктангенс
 * ------------------------------------------------------------------ */

/// Как ядро получает `sin`, `cos` и `atan2`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Порт `fdlibm` из [`v8`] — как в Node 24. Для тестов на образцах и для движка без JS.
    Port,
    /// Спросить арктангенсы: ядро записывает нужные `atan2(y, x)`, ответы ложные, результат не нужен.
    AskAtan,
    /// Спросить углы: арктангенсы уже из таблицы, ядро записывает нужные синус и косинус.
    AskAngles,
    /// Ответить: всё из таблиц, которые посчитал JS (`Math.atan2`, `Math.sin`, `Math.cos`).
    Answer,
}

impl Mode {
    /// Код режима на границе JS: 0…3.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Port),
            1 => Some(Self::AskAtan),
            2 => Some(Self::AskAngles),
            3 => Some(Self::Answer),
            _ => None,
        }
    }
}

/// Быстрый хэш для ключей из двоичных слов `f64`.
#[derive(Default)]
struct BitsHasher(u64);

impl Hasher for BitsHasher {
    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.write_u64(u64::from(*byte));
        }
    }

    fn write_u64(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    fn finish(&self) -> u64 {
        (self.0 ^ (self.0 >> 29)).wrapping_mul(0x9e37_79b9_7f4a_7c15)
    }
}

type Bits = BuildHasherDefault<BitsHasher>;

/// Источник `sin`, `cos`, `atan2` для ядер и записная книжка того, что им нужно.
pub struct Oracle {
    mode: Mode,
    atan: HashMap<(u64, u64), f64, Bits>,
    angles: HashMap<u64, (f64, f64), Bits>,
    asked_atan: Vec<f64>,
    seen_atan: HashSet<(u64, u64), Bits>,
    asked_angles: Vec<f64>,
    seen_angles: HashSet<u64, Bits>,
    missing: bool,
}

impl Oracle {
    fn with(mode: Mode) -> Self {
        Self {
            mode,
            atan: HashMap::default(),
            angles: HashMap::default(),
            asked_atan: Vec::new(),
            seen_atan: HashSet::default(),
            asked_angles: Vec::new(),
            seen_angles: HashSet::default(),
            missing: false,
        }
    }

    /// Считает порт `fdlibm`.
    pub fn port() -> Self {
        Self::with(Mode::Port)
    }

    /// Первый вызов из трёх: записывает, какие арктангенсы нужны.
    pub fn asking_atan() -> Self {
        Self::with(Mode::AskAtan)
    }

    /// Таблицы JS: `atan_args` — пары `(y, x)` подряд, `atan_values` — их `Math.atan2`; `angles`,
    /// `sines`, `cosines` — углы и `Math.sin`, `Math.cos` от них. Режим — `AskAngles` или `Answer`.
    pub fn with_tables(mode: Mode, atan_args: &[f64], atan_values: &[f64], angles: &[f64], sines: &[f64], cosines: &[f64]) -> Result<Self, Fail> {
        if atan_args.len() != atan_values.len() * 2 || angles.len() != sines.len() || angles.len() != cosines.len() {
            return Err("таблицы значений разной длины");
        }
        let mut oracle = Self::with(mode);
        for (pair, value) in atan_args.chunks_exact(2).zip(atan_values) {
            oracle.atan.insert((pair[0].to_bits(), pair[1].to_bits()), *value);
        }
        for ((angle, sin), cos) in angles.iter().zip(sines).zip(cosines) {
            oracle.angles.insert(angle.to_bits(), (*sin, *cos));
        }
        Ok(oracle)
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Нужные `atan2`: пары `(y, x)` подряд, без повторов, в порядке первого вопроса.
    pub fn asked_atan(&self) -> &[f64] {
        &self.asked_atan
    }

    /// Нужные углы для `sin` и `cos`, без повторов.
    pub fn asked_angles(&self) -> &[f64] {
        &self.asked_angles
    }

    /// Ответ-таблица не нашла значения (в режиме ответа): результат ядра верить нельзя.
    pub fn failure(&self) -> Option<Fail> {
        self.missing.then_some("в таблице нет нужного синуса, косинуса или арктангенса")
    }

    /// `Math.atan2(y, x)`.
    fn atan2(&mut self, y: f64, x: f64) -> f64 {
        let key = (y.to_bits(), x.to_bits());
        match self.mode {
            Mode::Port => v8::atan2(y, x),
            Mode::AskAtan => {
                if self.seen_atan.insert(key) {
                    self.asked_atan.extend([y, x]);
                }
                0.0
            }
            Mode::AskAngles | Mode::Answer => self.atan.get(&key).copied().unwrap_or_else(|| {
                self.missing = true;
                f64::NAN
            }),
        }
    }

    /// `(Math.sin(angle), Math.cos(angle))`.
    fn sin_cos(&mut self, angle: f64) -> (f64, f64) {
        let key = angle.to_bits();
        match self.mode {
            Mode::Port => (v8::sin(angle), v8::cos(angle)),
            Mode::AskAtan => (0.0, 0.0),
            Mode::AskAngles => {
                if self.seen_angles.insert(key) {
                    self.asked_angles.push(angle);
                }
                (0.0, 0.0)
            }
            Mode::Answer => self.angles.get(&key).copied().unwrap_or_else(|| {
                self.missing = true;
                (f64::NAN, f64::NAN)
            }),
        }
    }
}

/* ------------------------------------------------------------------ *
 * Числа JS
 * ------------------------------------------------------------------ */

/// `Math.max(a, b)`: нечисло — нечисло, у двух нулей побеждает `+0`.
#[inline]
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() {
            b
        } else {
            a
        }
    } else if b > a {
        b
    } else {
        a
    }
}

/// `Math.min(a, b)`: нечисло — нечисло, у двух нулей побеждает `-0`.
#[inline]
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_positive() {
            b
        } else {
            a
        }
    } else if b < a {
        b
    } else {
        a
    }
}

/// `clamp` из `grass-colour.js`: за краем — край, нечисло проходит как есть.
#[inline]
fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}

/* ------------------------------------------------------------------ *
 * Цвет
 * ------------------------------------------------------------------ */

const DARK: f64 = 0.04;
const MAX_RELATIVE: f64 = 2.5;
const HUE_KEEP: f64 = 0.35;
const MAX_TURN: f64 = 0.45;
const TWO_PI: f64 = 2.0 * std::f64::consts::PI;

/// Предел угла цели: угол `grassTarget` — `atan2`, то есть в пределах ±π; с поворотом пикселя
/// (до 0,45) синус и косинус остаются в области порта [`v8`].
const TARGET_ANGLE_LIMIT: f64 = 3.2;

/// Цель цвета травы (`grassTarget`): `gain`, `angle`, `saturation`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Target {
    pub gain: f64,
    pub angle: f64,
    pub saturation: f64,
}

/// Средняя трава листа (`grassReference().result()`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reference {
    pub y: f64,
    pub angle: f64,
    pub saturation: f64,
}

/// Цель и средняя трава годятся ядру: числа конечные, углы в области порта (иначе — JS).
fn supported(target: &Target, reference_angle: f64, reference_saturation: f64) -> Result<(), Fail> {
    if !(target.gain.is_finite() && target.saturation.is_finite() && target.angle.abs() <= TARGET_ANGLE_LIMIT) {
        return Err("цель цвета вне области ядра");
    }
    if !(reference_angle.abs() <= 4.0 && reference_saturation.is_finite()) {
        return Err("средняя трава вне области ядра");
    }
    Ok(())
}

#[inline]
fn luma_of(r: f64, g: f64, b: f64) -> f64 {
    0.299 * r + 0.587 * g + 0.114 * b
}

/// sRGB 0…1 → (Y, Cb, Cr) по BT.601 (`toYcc`).
#[inline]
fn to_ycc(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let y = luma_of(r, g, b);
    (y, (b - y) * 0.564, (r - y) * 0.713)
}

/// Яркость и цветоразность → sRGB 0…1 в пределах (`fromYcc`).
fn from_ycc(y: f64, cb: f64, cr: f64) -> [f64; 3] {
    if y >= 1.0 {
        return [1.0, 1.0, 1.0];
    }
    if y <= 0.0 {
        return [0.0, 0.0, 0.0];
    }
    let delta = [1.402 * cr, -0.344136 * cb - 0.714136 * cr, 1.772 * cb];
    let mut scale = 1.0;
    for d in delta {
        if d > 1e-9 {
            scale = js_min(scale, (1.0 - y) / d);
        } else if d < -1e-9 {
            scale = js_min(scale, y / -d);
        }
    }
    [y + delta[0] * scale, y + delta[1] * scale, y + delta[2] * scale]
}

fn wrap_angle(angle: f64) -> f64 {
    if !angle.is_finite() {
        return angle;
    }
    let mut value = angle;
    while value > std::f64::consts::PI {
        value -= TWO_PI;
    }
    while value < -std::f64::consts::PI {
        value += TWO_PI;
    }
    value
}

/// Пиксель травы в цвете цели — `shiftGrass`: `[r, g, b]` 0…1.
fn shift_grass(oracle: &mut Oracle, r: f64, g: f64, b: f64, target: &Target, reference_angle: f64, reference_saturation: f64, luma_scale: f64) -> [f64; 3] {
    let (y, cb, cr) = to_ycc(r, g, b);
    let next_y = y * target.gain * luma_scale;
    let chroma = v8::hypot(cb, cr);
    let relative = clamp(chroma / js_max(y, DARK) / reference_saturation, 0.0, MAX_RELATIVE);
    let turn = if chroma > 1e-4 { clamp(wrap_angle(oracle.atan2(cr, cb) - reference_angle) * HUE_KEEP, -MAX_TURN, MAX_TURN) } else { 0.0 };
    let angle = target.angle + turn;
    let next_chroma = target.saturation * relative * next_y;
    let (sin, cos) = oracle.sin_cos(angle);
    from_ycc(next_y, next_chroma * cos, next_chroma * sin)
}

/// sRGB 0…1 → (тон в градусах, насыщенность, светлота) (`rgbToHsl` из `colour.js`).
fn rgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = js_max(js_max(r, g), b);
    let min = js_min(js_min(r, g), b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

/// Насколько пиксель — трава, 0…1 (`grassWeight`).
fn grass_weight(h: f64, s: f64) -> f64 {
    if s < 0.03 || h < 55.0 || h > 185.0 {
        return 0.0;
    }
    let hue = if h < 75.0 {
        (h - 55.0) / 20.0
    } else if h > 165.0 {
        (185.0 - h) / 20.0
    } else {
        1.0
    };
    let sat = if s < 0.1 { (s - 0.03) / 0.07 } else { 1.0 };
    hue * sat
}

/// Насколько пиксель — песок или сухая трава, 0…1 (`sandWeight`).
fn sand_weight(h: f64, s: f64, l: f64) -> f64 {
    if s < 0.1 || l < 0.14 || l > 0.9 || h < 14.0 || h > 66.0 {
        return 0.0;
    }
    let hue = if h < 22.0 {
        (h - 14.0) / 8.0
    } else if h > 58.0 {
        (66.0 - h) / 8.0
    } else {
        1.0
    };
    let sat = if s < 0.17 { (s - 0.1) / 0.07 } else { 1.0 };
    let light = if l < 0.2 {
        (l - 0.14) / 0.06
    } else if l > 0.84 {
        (0.9 - l) / 0.06
    } else {
        1.0
    };
    hue * sat * light
}

/// Копилка средней травы (`grassReference`): веса и взвешенные Y, Cb, Cr по порядку добавления.
/// Среднюю по ней считает [`Sums::reference`] — в JS это `result()` с `Math.atan2`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Sums {
    pub weight: f64,
    pub sum_y: f64,
    pub sum_cb: f64,
    pub sum_cr: f64,
}

impl Sums {
    fn add(&mut self, r: f64, g: f64, b: f64, w: f64) {
        if w <= 0.0 {
            return;
        }
        let (y, cb, cr) = to_ycc(r, g, b);
        self.weight += w;
        self.sum_y += y * w;
        self.sum_cb += cb * w;
        self.sum_cr += cr * w;
    }

    /// `grassReference().result()`: `None`, если травы не было.
    pub fn reference(&self, oracle: &mut Oracle) -> Option<Reference> {
        if self.weight <= 0.0 {
            return None;
        }
        let y = self.sum_y / self.weight;
        let cb = self.sum_cb / self.weight;
        let cr = self.sum_cr / self.weight;
        Some(Reference { y, angle: oracle.atan2(cr, cb), saturation: js_max(0.02, v8::hypot(cb, cr) / js_max(y, DARK)) })
    }
}

/* ------------------------------------------------------------------ *
 * Память ответов по цвету
 * ------------------------------------------------------------------ */

/// Ответы по ключу. Цвета в листе повторяются (у листов мода разных цветов — около 4 % от числа
/// пикселей, у опорных цветов блоков — около 5 %), а ответ ядра — чистая функция цвета и чисел
/// вызова: посчитанное один раз берётся из памяти, и байты те же, что при счёте заново. Ключ —
/// любое число меньше 2^63; ответов в памяти не больше [`MEMO_LIMIT`], дальше считается заново.
struct Memo<V> {
    /// Ключ (со сдвигом на единицу: нуль — пустое место) и ответ рядом: одна проба — одна линия кэша.
    slots: Vec<(u64, V)>,
    mask: usize,
    used: usize,
    /// Последний спрошенный или записанный ответ: подряд идущие одинаковые цвета берутся без пробы.
    last: (u64, V),
    asked: u32,
    answered: u32,
    /// Лист без повторов цвета (шум): память только мешает — после пробы вопросов она выключается.
    off: bool,
}

const MEMO_START: usize = 1 << 10;
/// Мест в памяти не больше этого: таблица остаётся в кэше процессора.
const MEMO_LIMIT: usize = 1 << 17;
/// Столько вопросов — и, если из них отвечено из памяти меньше четверти, память выключается.
const MEMO_PROBE: u32 = 1 << 14;

impl<V: Copy + Default> Memo<V> {
    fn new() -> Self {
        Self { slots: vec![(0, V::default()); MEMO_START], mask: MEMO_START - 1, used: 0, last: (0, V::default()), asked: 0, answered: 0, off: false }
    }

    #[inline]
    fn start(&self, key: u64) -> usize {
        ((key.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40) as usize) & self.mask
    }

    /// Повторов нет, память выключена (см. [`MEMO_PROBE`]).
    fn is_off(&self) -> bool {
        self.off
    }

    #[inline]
    fn get(&mut self, key: u64) -> Option<V> {
        if self.off {
            return None;
        }
        let tag = key + 1;
        if self.last.0 == tag {
            return Some(self.last.1);
        }
        self.asked += 1;
        let mut at = self.start(key);
        let answer = loop {
            let (found, value) = self.slots[at];
            if found == tag {
                self.last = (tag, value);
                break Some(value);
            }
            if found == 0 {
                break None;
            }
            at = (at + 1) & self.mask;
        };
        self.answered += u32::from(answer.is_some());
        if self.asked == MEMO_PROBE && self.answered * 4 < MEMO_PROBE {
            self.off = true;
        }
        answer
    }

    fn put(&mut self, key: u64, value: V) {
        if self.off {
            return;
        }
        let tag = key + 1;
        self.last = (tag, value);
        if self.used * 2 >= self.slots.len() {
            if self.slots.len() >= MEMO_LIMIT {
                return;
            }
            self.grow();
        }
        let mut at = self.start(key);
        loop {
            let found = self.slots[at].0;
            if found == 0 || found == tag {
                self.used += usize::from(found == 0);
                self.slots[at] = (tag, value);
                return;
            }
            at = (at + 1) & self.mask;
        }
    }

    fn grow(&mut self) {
        let size = self.slots.len() * 2;
        let old = std::mem::replace(&mut self.slots, vec![(0, V::default()); size]);
        self.mask = size - 1;
        self.used = 0;
        for (tag, value) in old {
            if tag != 0 {
                self.put(tag - 1, value);
            }
        }
        self.last = (0, V::default());
    }
}

/// `байт / 255` для всех байтов (`f64`): то же деление, что в JS, готовой таблицей.
fn byte_units() -> [f64; 256] {
    let mut units = [0.0; 256];
    for (byte, unit) in units.iter_mut().enumerate() {
        *unit = byte as f64 / 255.0;
    }
    units
}

/// То же, но через `Float32Array`: значение округлено до `f32` и снова `f64`.
fn byte_units_f32() -> [f64; 256] {
    let mut units = byte_units();
    for unit in &mut units {
        *unit = f64::from(*unit as f32);
    }
    units
}

#[inline]
fn rgb_key(pixel: &[u8]) -> u32 {
    (u32::from(pixel[0]) << 16) | (u32::from(pixel[1]) << 8) | u32::from(pixel[2])
}

/* ------------------------------------------------------------------ *
 * Лист RGBA: `recolourGrass`
 * ------------------------------------------------------------------ */

/// Трава листа в цвете цели (`recolourGrass`). `Ok(None)` — травы на листе нет (JS отдаёт тот же
/// массив); иначе — новые байты листа той же длины, альфа та же.
pub fn recolour_grass(rgba: &[u8], target: &Target, oracle: &mut Oracle) -> Result<Option<Vec<u8>>, Fail> {
    if rgba.len() % 4 != 0 {
        return Err("длина листа не кратна четырём");
    }
    supported(target, 0.0, 1.0)?;
    let units = byte_units();
    let count = rgba.len() / 4;
    let asking = matches!(oracle.mode(), Mode::AskAtan | Mode::AskAngles);
    let mut weights = vec![0f32; count];
    let mut sum = Sums::default();
    let mut known: Memo<f64> = Memo::new();
    /* В режимах вопросов второй обход листа не нужен: хватит разных цветов с травой и их весов. */
    let mut distinct: Vec<(u32, f32)> = Vec::new();
    for (index, pixel) in rgba.chunks_exact(4).enumerate() {
        if index & 0x3fff == 0x3fff && known.is_off() {
            return Err(DECLINED);
        }
        let (r, g, b) = (units[usize::from(pixel[0])], units[usize::from(pixel[1])], units[usize::from(pixel[2])]);
        let key = u64::from(rgb_key(pixel));
        let weight = known.get(key).unwrap_or_else(|| {
            let (h, s, _) = rgb_to_hsl(r, g, b);
            let weight = grass_weight(h, s);
            known.put(key, weight);
            if asking && weight as f32 > 0.0 {
                distinct.push((key as u32, weight as f32));
            }
            weight
        });
        weights[index] = weight as f32;
        sum.add(r, g, b, weight);
    }
    let Some(reference) = sum.reference(oracle) else { return Ok(None) };
    supported(target, reference.angle, reference.saturation)?;
    let mut shifted: Memo<[u8; 3]> = Memo::new();
    let mut shift_colour = |oracle: &mut Oracle, key: u32, weight: f64| -> [u8; 3] {
        shifted.get(u64::from(key)).unwrap_or_else(|| {
            let (r, g, b) = (units[(key >> 16) as usize & 255], units[(key >> 8) as usize & 255], units[key as usize & 255]);
            let [nr, ng, nb] = shift_grass(oracle, r, g, b, target, reference.angle, reference.saturation, 1.0);
            let bytes = [
                clamp8(js_round((r + (nr - r) * weight) * 255.0)),
                clamp8(js_round((g + (ng - g) * weight) * 255.0)),
                clamp8(js_round((b + (nb - b) * weight) * 255.0)),
            ];
            shifted.put(u64::from(key), bytes);
            bytes
        })
    };
    if asking {
        for (key, weight) in distinct {
            shift_colour(oracle, key, f64::from(weight));
        }
        /* Вопросы записаны; сам лист в этом режиме не нужен. */
        return Ok(Some(Vec::new()));
    }
    let mut out = rgba.to_vec();
    for (index, pixel) in rgba.chunks_exact(4).enumerate() {
        let weight = f64::from(weights[index]);
        if weight <= 0.0 {
            continue;
        }
        out[index * 4..index * 4 + 3].copy_from_slice(&shift_colour(oracle, rgb_key(pixel), weight));
    }
    Ok(Some(out))
}

/* ------------------------------------------------------------------ *
 * Атласы дальнего плана: веса и сдвиг
 * ------------------------------------------------------------------ */

/// Веса песка и травы у каждого пикселя (или опорного цвета блока) и две средние — травы и песка
/// (`distantWeights`). Веса — `Float32Array`: так их хранит JS.
#[derive(Clone, Debug, Default)]
pub struct Weights {
    pub grass: Vec<f32>,
    pub sandy: Vec<f32>,
    /// Суммы средней травы и средней песка: среднюю из них считает JS (`Math.atan2`), см. [`Sums::reference`].
    pub grass_sum: Sums,
    pub sand_sum: Sums,
}

impl Weights {
    /// Нет ни травы, ни песка (у JS `distantWeights` без обеих средних).
    fn is_empty(&self) -> bool {
        self.grass_sum.weight <= 0.0 && self.sand_sum.weight <= 0.0
    }
}

/// Веса по `count` цветам — `distantWeights`. `colour_at(i)` — ключ цвета (одинаковый цвет — одинаковый
/// ключ) и сам цвет 0…1, уже как в `Float32Array` (значение `f32` как `f64`).
fn distant_weights(count: usize, greens: bool, sand: bool, may_decline: bool, colour_at: impl Fn(usize) -> (u32, [f64; 3])) -> Result<Weights, Fail> {
    let mut grass = vec![0f32; count];
    let mut sandy = vec![0f32; count];
    let mut grass_sum = Sums::default();
    let mut sand_sum = Sums::default();
    let mut known: Memo<(f64, f64)> = Memo::new();
    for index in 0..count {
        if may_decline && index & 0x3fff == 0x3fff && known.is_off() {
            return Err(DECLINED);
        }
        let (key, [r, g, b]) = colour_at(index);
        let (green, dry) = known.get(u64::from(key)).unwrap_or_else(|| {
            let (h, s, l) = rgb_to_hsl(r, g, b);
            let answer = (if greens { grass_weight(h, s) } else { 0.0 }, if sand { sand_weight(h, s, l) } else { 0.0 });
            known.put(u64::from(key), answer);
            answer
        });
        if green >= dry && green > 0.0 {
            grass[index] = green as f32;
            grass_sum.add(r, g, b, green);
        } else if dry > 0.0 {
            sandy[index] = dry as f32;
            sand_sum.add(r, g, b, dry);
        }
    }
    Ok(Weights { grass, sandy, grass_sum, sand_sum })
}

/// Веса, пришедшие обратно из JS ко второй половине ядра.
#[derive(Clone, Copy)]
pub struct WeightsIn<'a> {
    pub grass: &'a [f32],
    pub sandy: &'a [f32],
    pub grass_ref: Option<Reference>,
    pub sand_ref: Option<Reference>,
}

/// Ответ сдвига точки по цвету и цели: проверочное число — веса точки (ответ верен при тех же весах).
#[derive(Clone, Copy, Default)]
struct Shifted {
    check: u64,
    found: bool,
    colour: [f64; 3],
}

/// Всё, что нужно сдвигу точки атласа: веса, цели, множитель яркости песка и память ответов.
struct Shifter<'a> {
    weights: WeightsIn<'a>,
    targets: &'a [Target],
    /// `clamp(albedo / max(sandRef.y, DARK), 0.25, 1.6)` — у песка яркость приводится к траве.
    sand_scale: Option<f64>,
    known: Memo<Shifted>,
}

impl<'a> Shifter<'a> {
    fn new(weights: WeightsIn<'a>, targets: &'a [Target], albedo: f64) -> Result<Self, Fail> {
        for target in targets {
            supported(target, 0.0, 1.0)?;
        }
        for reference in [weights.grass_ref, weights.sand_ref].into_iter().flatten() {
            supported(&Target { gain: 1.0, angle: 0.0, saturation: 1.0 }, reference.angle, reference.saturation)?;
        }
        let sand_scale = weights.sand_ref.map(|sand| clamp(albedo / js_max(sand.y, DARK), 0.25, 1.6));
        Ok(Self { weights, targets, sand_scale, known: Memo::new() })
    }

    /// Цвет точки атласа по весам: трава — своим рисунком, песок — к яркости травы (`distantShift`).
    /// `key` — ключ цвета точки (тот же цвет — тот же ключ). `Ok(None)` — точка не трава и не песок.
    fn shift(&mut self, oracle: &mut Oracle, key: u32, colour: [f64; 3], index: usize, slot: usize) -> Result<Option<[f64; 3]>, Fail> {
        let (green_weight, dry_weight) = (self.weights.grass[index], self.weights.sandy[index]);
        let check = (u64::from(green_weight.to_bits()) << 32) | u64::from(dry_weight.to_bits());
        let memo_key = ((slot as u64) << 32) | u64::from(key);
        if let Some(answer) = self.known.get(memo_key) {
            if answer.check == check {
                return Ok(answer.found.then_some(answer.colour));
            }
        }
        let [r, g, b] = colour;
        let (green, dry) = (f64::from(green_weight), f64::from(dry_weight));
        let target = &self.targets[slot];
        let answer = if green > 0.0 {
            let reference = self.weights.grass_ref.ok_or("веса травы без средней травы")?;
            let [nr, ng, nb] = shift_grass(oracle, r, g, b, target, reference.angle, reference.saturation, 1.0);
            Some([r + (nr - r) * green, g + (ng - g) * green, b + (nb - b) * green])
        } else if dry > 0.0 {
            let reference = self.weights.sand_ref.ok_or("веса песка без средней песка")?;
            let scale = self.sand_scale.ok_or("веса песка без средней песка")?;
            let [nr, ng, nb] = shift_grass(oracle, r, g, b, target, reference.angle, reference.saturation, scale);
            Some([r + (nr - r) * dry, g + (ng - g) * dry, b + (nb - b) * dry])
        } else {
            None
        };
        self.known.put(memo_key, Shifted { check, found: answer.is_some(), colour: answer.unwrap_or_default() });
        Ok(answer)
    }
}

/// Номера целей по точкам: `-1` — не трогать, иначе строка таблицы целей.
fn slot_of(slots: &[i32], index: usize, targets: usize) -> Result<Option<usize>, Fail> {
    let slot = slots[index];
    if slot < 0 {
        return Ok(None);
    }
    if slot as usize >= targets {
        return Err("номер цели вне таблицы");
    }
    Ok(Some(slot as usize))
}

/* ------------------------------------------------------------------ *
 * Сжатый лист DXT: `recolourDistantBlocks`
 * ------------------------------------------------------------------ */

/// Формат сжатого листа, который ядро правит прямо в блоках.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockFormat {
    Dxt1,
    Dxt3,
    Dxt5,
}

impl BlockFormat {
    /// Код формата на границе JS: 1, 3, 5.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            1 => Some(Self::Dxt1),
            3 => Some(Self::Dxt3),
            5 => Some(Self::Dxt5),
            _ => None,
        }
    }

    fn block_bytes(self) -> usize {
        if self == Self::Dxt1 {
            8
        } else {
            16
        }
    }

    /// Где в блоке два опорных цвета: у DXT3/5 им предшествует альфа.
    fn colour_offset(self) -> usize {
        if self == Self::Dxt1 {
            0
        } else {
            8
        }
    }
}

/// Блоков в уровне. `None` — байтов меньше, чем блоков (у JS это `null`).
fn block_count(format: BlockFormat, width: usize, height: usize, len: usize) -> Option<usize> {
    let count = width.div_ceil(4).max(1) * height.div_ceil(4).max(1);
    (len >= count * format.block_bytes()).then_some(count)
}

/// Каналы 565, расширенные до байта и поделённые на 255, как их хранит `Float32Array` (`unpack565`):
/// пять бит — красный и синий, шесть — зелёный.
struct Unpack565 {
    five: [f64; 32],
    six: [f64; 64],
}

impl Unpack565 {
    fn new() -> Self {
        let mut tables = Self { five: [0.0; 32], six: [0.0; 64] };
        for value in 0..32u32 {
            tables.five[value as usize] = f64::from((f64::from((value << 3) | (value >> 2)) / 255.0) as f32);
        }
        for value in 0..64u32 {
            tables.six[value as usize] = f64::from((f64::from((value << 2) | (value >> 4)) / 255.0) as f32);
        }
        tables
    }

    #[inline]
    fn colour(&self, value: u32) -> [f64; 3] {
        [self.five[((value >> 11) & 31) as usize], self.six[((value >> 5) & 63) as usize], self.five[(value & 31) as usize]]
    }
}

/// `pack565`: цвет 0…1 → 565, округление `Math.round`.
fn pack565(r: f64, g: f64, b: f64) -> u32 {
    let r5 = js_round(clamp(r, 0.0, 1.0) * 31.0) as i32;
    let g6 = js_round(clamp(g, 0.0, 1.0) * 63.0) as i32;
    let b5 = js_round(clamp(b, 0.0, 1.0) * 31.0) as i32;
    ((r5 << 11) | (g6 << 5) | b5) as u32
}

fn u16_at(bytes: &[u8], at: usize) -> u32 {
    u32::from(bytes[at]) | (u32::from(bytes[at + 1]) << 8)
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Опорные цвета всех блоков в 565, два на блок.
fn block_values(bytes: &[u8], format: BlockFormat, count: usize) -> Vec<u32> {
    let mut values = Vec::with_capacity(count * 2);
    for block in 0..count {
        let at = block * format.block_bytes() + format.colour_offset();
        values.push(u16_at(bytes, at));
        values.push(u16_at(bytes, at + 2));
    }
    values
}

/// Первая половина `recolourDistantBlocks`: веса опорных цветов и список тронутых блоков.
pub struct BlockWeights {
    pub weights: Weights,
    /// Блоки, у которых хоть один опорный цвет — трава или песок, по возрастанию.
    pub touched: Vec<u32>,
}

/// `Ok(None)` — JS ответил бы `null`: байтов меньше, чем блоков, или ни травы, ни песка нет.
pub fn blocks_weights(bytes: &[u8], format: BlockFormat, width: usize, height: usize, greens: bool, sand: bool) -> Result<Option<BlockWeights>, Fail> {
    let Some(count) = block_count(format, width, height, bytes.len()) else { return Ok(None) };
    let (values, tables) = (block_values(bytes, format, count), Unpack565::new());
    let weights = distant_weights(count * 2, greens, sand, false, |index| (values[index], tables.colour(values[index])))?;
    if weights.is_empty() {
        return Ok(None);
    }
    let touched = (0..count)
        .filter(|&block| (0..2).any(|end| weights.grass[block * 2 + end] > 0.0 || weights.sandy[block * 2 + end] > 0.0))
        .map(|block| block as u32)
        .collect();
    Ok(Some(BlockWeights { weights, touched }))
}

/// Вторая половина `recolourDistantBlocks`: новые байты блоков или `Ok(None)`, если ничего не
/// изменилось. `slots` — номер цели у каждого блока (`-1` — блок не трогать).
#[allow(clippy::too_many_arguments)]
pub fn blocks_shift(
    bytes: &[u8],
    format: BlockFormat,
    width: usize,
    height: usize,
    weights: WeightsIn,
    targets: &[Target],
    slots: &[i32],
    albedo: f64,
    oracle: &mut Oracle,
) -> Result<Option<Vec<u8>>, Fail> {
    let count = block_count(format, width, height, bytes.len()).ok_or("байтов меньше, чем блоков")?;
    if weights.grass.len() != count * 2 || weights.sandy.len() != count * 2 || slots.len() != count {
        return Err("веса или номера целей не по блокам");
    }
    let mut shifter = Shifter::new(weights, targets, albedo)?;
    let (values, tables) = (block_values(bytes, format, count), Unpack565::new());
    let block_bytes = format.block_bytes();
    let mut out = bytes[..count * block_bytes].to_vec();
    let mut changed = false;
    for block in 0..count {
        let Some(slot) = slot_of(slots, block, targets.len())? else { continue };
        let at = block * block_bytes + format.colour_offset();
        let (c0, c1) = (values[block * 2], values[block * 2 + 1]);
        let mut next = [c0, c1];
        for (end, value) in next.iter_mut().enumerate() {
            if let Some([nr, ng, nb]) = shifter.shift(oracle, *value, tables.colour(*value), block * 2 + end, slot)? {
                *value = pack565(nr, ng, nb);
            }
        }
        let [mut n0, mut n1] = next;
        let mut indices = u32_at(bytes, at + 4);
        if format == BlockFormat::Dxt1 {
            /* Режим блока DXT1 задаёт порядок опорных: c0 > c1 — четыре цвета, иначе три и
               прозрачный. Порядок сменился — опорные меняются местами вместе с индексами. */
            if c0 > c1 {
                if n0 == n1 && n0 < 0xffff {
                    n0 += 1;
                } else if n0 == n1 {
                    n1 -= 1;
                }
                if n0 < n1 {
                    std::mem::swap(&mut n0, &mut n1);
                    indices ^= 0x5555_5555;
                }
            } else if n0 > n1 {
                std::mem::swap(&mut n0, &mut n1);
                /* Три цвета: 0 ↔ 1, смесь (2) и прозрачный (3) — на месте. */
                let mut swapped = 0u32;
                for pixel in 0..16 {
                    let index = (indices >> (pixel * 2)) & 3;
                    swapped |= (if index < 2 { index ^ 1 } else { index }) << (pixel * 2);
                }
                indices = swapped;
            }
        }
        if n0 == c0 && n1 == c1 {
            continue;
        }
        out[at..at + 2].copy_from_slice(&(n0 as u16).to_le_bytes());
        out[at + 2..at + 4].copy_from_slice(&(n1 as u16).to_le_bytes());
        out[at + 4..at + 8].copy_from_slice(&indices.to_le_bytes());
        changed = true;
    }
    Ok(changed.then_some(out))
}

/* ------------------------------------------------------------------ *
 * Атлас раскодированным: `recolourDistantSand`
 * ------------------------------------------------------------------ */

/// Первая половина `recolourDistantSand`: веса точек листа и список тронутых (по возрастанию).
/// `Ok(None)` — ни травы, ни песка (JS отдаёт тот же массив).
pub fn rgba_weights(rgba: &[u8], greens: bool, sand: bool) -> Result<Option<BlockWeights>, Fail> {
    if rgba.len() % 4 != 0 {
        return Err("длина листа не кратна четырём");
    }
    let units = byte_units_f32();
    let count = rgba.len() / 4;
    let weights = distant_weights(count, greens, sand, true, |index| {
        let pixel = &rgba[index * 4..index * 4 + 4];
        (rgb_key(pixel), [units[usize::from(pixel[0])], units[usize::from(pixel[1])], units[usize::from(pixel[2])]])
    })?;
    if weights.is_empty() {
        return Ok(None);
    }
    let touched = (0..count).filter(|&index| weights.grass[index] > 0.0 || weights.sandy[index] > 0.0).map(|index| index as u32).collect();
    Ok(Some(BlockWeights { weights, touched }))
}

/// Вторая половина `recolourDistantSand`: новые пиксели или `Ok(None)`, если менять нечего.
pub fn rgba_shift(rgba: &[u8], weights: WeightsIn, targets: &[Target], slots: &[i32], albedo: f64, oracle: &mut Oracle) -> Result<Option<Vec<u8>>, Fail> {
    if rgba.len() % 4 != 0 {
        return Err("длина листа не кратна четырём");
    }
    let count = rgba.len() / 4;
    if weights.grass.len() != count || weights.sandy.len() != count || slots.len() != count {
        return Err("веса или номера целей не по пикселям");
    }
    let mut shifter = Shifter::new(weights, targets, albedo)?;
    let units = byte_units_f32();
    let mut out = rgba.to_vec();
    let mut changed = false;
    for (index, pixel) in rgba.chunks_exact(4).enumerate() {
        let Some(slot) = slot_of(slots, index, targets.len())? else { continue };
        let colour = [units[usize::from(pixel[0])], units[usize::from(pixel[1])], units[usize::from(pixel[2])]];
        let Some(next) = shifter.shift(oracle, rgb_key(pixel), colour, index, slot)? else { continue };
        let at = index * 4;
        out[at] = clamp8(js_round(next[0] * 255.0));
        out[at + 1] = clamp8(js_round(next[1] * 255.0));
        out[at + 2] = clamp8(js_round(next[2] * 255.0));
        changed = true;
    }
    Ok(changed.then_some(out))
}

/* ------------------------------------------------------------------ *
 * Травинки карты травы: `grassInstanceColour`
 * ------------------------------------------------------------------ */

/// Цвета экземпляров пачкой (`grassInstanceColour` на каждый): `instances` — байты `r, g, b` подряд,
/// `slots` — номер цели у каждого (`-1` — цвет как был), `sheet` — средний цвет листа модели травы,
/// `reference` — средняя травинка этой модели. Возвращает те же `r, g, b` подряд.
pub fn instance_colours(instances: &[u8], slots: &[i32], targets: &[Target], sheet: [f64; 3], reference: &Reference, oracle: &mut Oracle) -> Result<Vec<u8>, Fail> {
    if instances.len() % 3 != 0 || slots.len() != instances.len() / 3 {
        return Err("экземпляры и номера целей не сходятся");
    }
    for target in targets {
        supported(target, reference.angle, reference.saturation)?;
    }
    if !sheet.iter().all(|value| value.is_finite()) {
        return Err("лист модели вне области ядра");
    }
    let mut out = instances.to_vec();
    let mut known: Memo<[u8; 3]> = Memo::new();
    for (index, colour) in instances.chunks_exact(3).enumerate() {
        if index & 0x3fff == 0x3fff && known.is_off() {
            return Err(DECLINED);
        }
        let Some(slot) = slot_of(slots, index, targets.len())? else { continue };
        let key = ((slot as u64) << 24) | (u64::from(colour[0]) << 16) | (u64::from(colour[1]) << 8) | u64::from(colour[2]);
        let bytes = known.get(key).unwrap_or_else(|| {
            let base = [f64::from(colour[0]) / 255.0, f64::from(colour[1]) / 255.0, f64::from(colour[2]) / 255.0];
            let blade = [base[0] * sheet[0], base[1] * sheet[1], base[2] * sheet[2]];
            let shifted = shift_grass(oracle, blade[0], blade[1], blade[2], &targets[slot], reference.angle, reference.saturation, 1.0);
            let bytes = [0, 1, 2].map(|channel| clamp8(js_round(clamp(shifted[channel] / js_max(sheet[channel], 0.02), 0.0, 1.0) * 255.0)));
            known.put(key, bytes);
            bytes
        });
        out[index * 3..index * 3 + 3].copy_from_slice(&bytes);
    }
    Ok(out)
}

/* ------------------------------------------------------------------ *
 * Проба математики V8
 * ------------------------------------------------------------------ */

/// Значения порта: `Math.sin` (0), `Math.cos` (1) по одному аргументу, `Math.atan2(y, x)` (2) и
/// `Math.hypot(a, b)` (3) по паре. Сверка порта с `Math.*` в тестах; приложение проверяет по ней
/// только `hypot` — синус, косинус и арктангенс ядрам даёт JS, а не порт.
pub fn trig(kind: u32, input: &[f64]) -> Result<Vec<f64>, Fail> {
    match kind {
        0 => Ok(input.iter().map(|&x| v8::sin(x)).collect()),
        1 => Ok(input.iter().map(|&x| v8::cos(x)).collect()),
        2 | 3 => {
            if input.len() % 2 != 0 {
                return Err("пара аргументов неполная");
            }
            Ok(input.chunks_exact(2).map(|pair| if kind == 2 { v8::atan2(pair[0], pair[1]) } else { v8::hypot(pair[0], pair[1]) }).collect())
        }
        _ => Err("неизвестная функция пробы"),
    }
}

/* ------------------------------------------------------------------ *
 * Тесты на образцах, снятых с JS (`grass-colour.js`, ядра не подставлены)
 * ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len() / 2).map(|at| u8::from_str_radix(&text[at * 2..at * 2 + 2], 16).unwrap()).collect()
    }

    fn target((gain, angle, saturation): (f64, f64, f64)) -> Target {
        Target { gain, angle, saturation }
    }

    /// То же, что делает JS: три вызова ядра — спросить арктангенсы, спросить углы, ответить, — только
    /// значения таблиц считает порт. Результат обязан быть тот же, что у ядра, считающего порт прямо.
    fn through_tables<R>(run: impl Fn(&mut Oracle) -> R) -> R {
        let mut ask = Oracle::asking_atan();
        run(&mut ask);
        let args = ask.asked_atan().to_vec();
        let values: Vec<f64> = args.chunks_exact(2).map(|pair| v8::atan2(pair[0], pair[1])).collect();
        let mut ask = Oracle::with_tables(Mode::AskAngles, &args, &values, &[], &[], &[]).unwrap();
        run(&mut ask);
        let angles = ask.asked_angles().to_vec();
        let (sines, cosines): (Vec<f64>, Vec<f64>) = angles.iter().map(|&angle| (v8::sin(angle), v8::cos(angle))).unzip();
        let mut answer = Oracle::with_tables(Mode::Answer, &args, &values, &angles, &sines, &cosines).unwrap();
        let result = run(&mut answer);
        assert_eq!(answer.failure(), None, "таблицы полные");
        result
    }

    fn references(weights: &Weights) -> (Option<Reference>, Option<Reference>) {
        let mut port = Oracle::port();
        (weights.grass_sum.reference(&mut port), weights.sand_sum.reference(&mut port))
    }

    struct BlocksSample {
        format: BlockFormat,
        width: usize,
        height: usize,
        greens: bool,
        sand: bool,
        albedo: f64,
        target: (f64, f64, f64),
        before: &'static str,
        after: &'static str,
    }

    /* Углы цели с поворотом: аргумент, Math.sin, Math.cos (двоичные слова f64). */
    const ANGLES: [(u64, u64, u64); 20] = [
        (0xbfc299c0f7666667, 0xbfc289032ca8525d, 0x3fefa9a8118af538),
        (0x3ff724d170500000, 0x3fefc0c9e0dbcc8d, 0x3fbfbda752e80521),
        (0x4005b7db2b333333, 0x3fda7e9b23e39cbc, 0xbfed211284f94df7),
        (0x3fbb5ffbf2333334, 0x3fbb52a2d42dbb75, 0x3fefd13539a8da0c),
        (0x400647590b900000, 0x3fd659ded1b38b83, 0xbfedfc30fd109066),
        (0xbfb964d843cccccd, 0xbfb95a30639f33e3, 0x3fefd7bad5a80e0f),
        (0xc00057394a600000, 0xbfec810fe0e90180, 0xbfdd164630b8e750),
        (0xc004580f8c1b3333, 0xbfe2080ac620162b, 0xbfea6fa521b5ab43),
        (0xbff458d2f2066667, 0xbfee944421e258e6, 0x3fd2dbe202a031d6),
        (0xc006b8d3bd980000, 0xbfd2feda00407db1, 0xbfee8eda6d4b0400),
        (0xbff361c29f19999a, 0xbfedf4835af17f90, 0x3fd682e7e0b93e45),
        (0x400573c523d1999a, 0x3fdc6a96f5838322, 0xbfecac3a6c3b39c6),
        (0xbfafff727f333334, 0xbfaffa1db4d9caa3, 0x3feff001e2b1f516),
        (0xc001f7ff4d780000, 0xbfe8fa090a78af10, 0xbfe4010d61ba7adf),
        (0xc006b4b144533334, 0xbfd31e6dac7c3c2e, 0xbfee89edb4ac8b84),
        (0xbfd59f24520ccccd, 0xbfd53672fd35dc39, 0x3fee30ef14f13a00),
        (0x4002adf585700000, 0x3fe71a6a35bb40af, 0xbfe62434c42aa030),
        (0x3fe10f511f6ccccd, 0x3fe0435c0eff76c9, 0x3feb8f294a36b74e),
        (0xbfd4a902ac000000, 0xbfd44da06e95cc23, 0x3fee58d9a5c1a394),
        (0x400ac50c89ab3334, 0xbfca0261f5e9100a, 0xbfef5518a4beb30a),
    ];
    /* Цветоразность (cr, cb): Math.atan2(cr, cb) и Math.hypot(cb, cr). */
    const PAIRS: [(u64, u64, u64, u64); 28] = [
        (0xbfc08ccdcb999999, 0xbfc8f833b7666666, 0xc004733b9e7a0d32, 0x3fcdf4d125595b9a),
        (0xbfe143d512999999, 0x3fe2e8695c733333, 0xbfe7ae2cdb812aa4, 0x3fe99abb338dc6a0),
        (0x3fd28cf500333333, 0x3f74cd3493333333, 0x3ff8da3923deb481, 0x3fd28daf978ca3b5),
        (0xbfda0fbdb5999999, 0x3fe31abf650ccccd, 0xbfe327b30cf2932c, 0x3fe7201695f951d3),
        (0x3fdb8025dfcccccd, 0x3fb988b71acccccd, 0x3ff57bc059744608, 0x3fdc3b5324e170c0),
        (0x3fd55be11a000000, 0x3fe2b63cdda66666, 0x3fe09889fbb3f5bb, 0x3fe58b81797b4dd6),
        (0xbfdec49b13cccccc, 0x3fbdb2159f999999, 0xbff558350dbe3419, 0x3fdfa6a5cc92041f),
        (0x3fdd575b7ccccccc, 0xbfd931be73800000, 0x40023e0dc9e03c31, 0x3fe3563e9e7212ba),
        (0x3fd2a44b58999999, 0xbfd040fcb0800000, 0x40024d8f25f57aae, 0x3fd8bb8e70534501),
        (0x3fd3500772cccccd, 0x3fd0c5cdd74ccccd, 0x3feb61a4e469a986, 0x3fd9944bb569eb30),
        (0xbfd02f60db000000, 0x3faac5abec000000, 0xbff5ded672db8676, 0x3fd087053e2aa9a1),
        (0x3fa339a4accccccd, 0xbfca22e062333333, 0x4007ad8746cbd8b4, 0x3fca93117ff2f245),
        (0x3fda591feb000000, 0xbfd0470fa7b33333, 0x4000fe58f42b8335, 0x3fdef87fe47c7769),
        (0x3f8038b640000000, 0x3fa22d2b9a666666, 0x3fcc191f344126d7, 0x3fa29f942c0aa657),
        (0xbfdb5a12bbcccccd, 0xbfc27efc40333333, 0xbffe597781c141a3, 0x3fdcdf7c285aae01),
        (0x3fd61e30c8000000, 0x3fd63b0cc4800000, 0x3fe90d287e74c732, 0x3fdf5bfaaec4c5da),
        (0xbfe018efce199999, 0xbfd28d1b1ee66666, 0xc000bf944d2dbaab, 0x3fe2941d3633eb0b),
        (0xbfc5516850cccccd, 0x3fde3c708f4ccccc, 0xbfd5b0ea7a67caad, 0x3fe007a9f769eec0),
        (0x3fd470ff49cccccd, 0xbfc39de47b666666, 0x4000253a58661f58, 0x3fd6ac3b6efc27c8),
        (0x3fcf5b0028000000, 0xbfd8acd792b33333, 0x40049ac6d599d791, 0x3fdd3c073a45f346),
        (0xbf7100cf40000000, 0x3fc5a86ea0999999, 0xbf991e10e28cc3b6, 0x3fc5aa19b989a21d),
        (0xbfb7400ba4cccccd, 0x3fa844f95a666666, 0xbff16fb0091b384a, 0x3fba39f2dd6d863a),
        (0xbfd895adfd666666, 0xbf9bdb6db4cccccd, 0xbffa439305ce5bd2, 0x3fd8a571480d050d),
        (0x3fc2723e8ccccccd, 0xbfc810f407000000, 0x4003e6a96a447860, 0x3fce5288bd79d1aa),
        (0x0000000000000000, 0x0000000000000000, 0x0000000000000000, 0x0000000000000000),
        (0x0000000000000000, 0xbfd3333333333333, 0x400921fb54442d18, 0x3fd3333333333333),
        (0x3fd3333333333333, 0x0000000000000000, 0x3ff921fb54442d18, 0x3fd3333333333333),
        (0x3ee4f8b588e368f1, 0x3fe0000000000000, 0x3ef4f8b588d7667c, 0x3fe00000000dbe70),
    ];
    /* recolourGrass(лист, "#c0392b"): 16 пикселей. */
    const GRASS_IN: &str = "2c8437a4ca5b6451815d44ff2f6f18f05ba14dc7518256ff336d22e36fd41ef3568555ff3db225f9c35734e4547a2cff3a9f2c2ad4314c4f6a7849ff236d17a3";
    const GRASS_OUT: &str = "a52e0ea4ca5b6451815d44ff981f15f0be4738c78a4736ff8d251ae3ff4c4cf38e483afff42e14f9c35734e49d3135ffd32f162ad4314c4f88434cff961c0aa3";
    const GRASS_TARGET: (f64, f64, f64) = (0.8045448817574665, 1.9800666253728225, 0.7809359621255979);
    /* recolourDistantBlocks: формат, размер, режимы, albedo, цель, цвет в точке, блоки до и после (пусто — null). */
    const BLOCK_SAMPLES: [BlocksSample; 3] = [
        BlocksSample {
            format: BlockFormat::Dxt1,
            width: 32,
            height: 16,
            greens: true,
            sand: true,
            albedo: 0.2,
            target: (0.8045448817574665, 1.9800666253728225, 0.7809359621255979),
            before: "224407336906f165010369cb9a4c02460aa5ca93ef9ea67b8f6cb40604ce23ff01330133c1776e58262dc8dc52dcc7160aecaac4878a48857e6f84c47cdded034355e133198a3a4ea8eba8eb0af1a342e8bc85cb1fef8127555dce25f4599b44084b6225719dddbf623b08d4c26ac48969ec69ecb72c4c74fddbb3a66c23115509530955c911840d831ce8ec7a290b7404cd07b54fa3a4bb934f934fe4198809892c010c21477e0c4abc080c320d8ea4e4bb0b95e7b20cfdeb9d85c85c1d0d8649334933799dc0a4684429bceaf5167d08ddabd37fbb09e90942e60ad40d011e4134413bd174637ee444e444a2c3a311e7cb84bb171da572a7afccba4ccb9803",
            after: "05b964696906f1658078c7aa9a4c02460341e330ef9ea67bc1d2ea8a519b76aaa488a488c1776e58262dc8dc52dcc716469ae348878a4885c1583c773dccec5746e9c4b0198a3a4e25aa25aa0af1a3428250e2504fef946300e2136da10cce11084b6225719dddbfa250e598d62ad198c358c358b72c4c74fddb0fd46c231155085a07bac911840de260c1c83a685b31c158e2504fa3a4bb934f934fe4198809a2b180b021477e0c4099e3486758dbf10db3a150b2e759a885c8cee20d4c5c92a471a471799dc0a4c348c5a9eaf0423c08ddabd37fbb09e9e06809428158544bc498c3c8c431273e45d145d1a2c3a311a2508150171da572ccbad1fb1ddb8957",
        },
        BlocksSample {
            format: BlockFormat::Dxt5,
            width: 16,
            height: 16,
            greens: false,
            sand: true,
            albedo: 0.35,
            target: (1.0, -0.2836363782645893, 1.0915009567043612),
            before: "5ea958756e366bec0523280d292d23bf1ec7bfc2d0ff7401e61c6bd34281b4061efcec383d1081d0c6e305b5bf93ad8f5fc40296d145624e9c20d1163c2daba72409fd7f78d4b28d274c274ca13bf1d70ddb6cc4c449f52c6145a9eb9ad9905f545fa9831b822fd905c4c794779d09eaa453d535d7eb8971e7d9669d540849a7d8d1f3011cee20f6421b401c1953071fbee10e10df909bd4679b679bf25e6320323a7de0fa4b4d4d49ac489b2f88fa72c01caab31706e784dfa0e5086c7876a8ea2e97afc46dd03d695d463c9153e1fae715be5f8c813401e01bab9c4a71d75d6411d58544ef8eeac6bcc6bce73319775f398c8a2652c60e02f22b1984dd3930",
            after: "5ea958756e366bec0523280d292d23bf1ec7bfc2d0ff7401e61c6bd34281b4061efcec383d1081d0df2a9f4abf93ad8f5fc40296d145624e9c20d1163c2daba72409fd7f78d4b28d274c274ca13bf1d70ddb6cc4c449f52c61458dc39ad9905f545fa9831b822fd99f320d7c779d09eaa453d535d7eb8971e7d9669d540849a7d8d1f3011cee20f6421b401c1953071fbee10e10df909bd4392a392af25e6320323a7de0fa4b4d4d9c3a382a2f88fa72c01caab31706e784dfa0e5086c7876a8ea2e97afc46dd03d695d463c9153e1fae715be5f8c813401e01b98524a71d75d6411d58544ef8eeac6bcc6bce73319775f398c8a2652c60e02f22b1984dd3930",
        },
        BlocksSample {
            format: BlockFormat::Dxt3,
            width: 32,
            height: 4,
            greens: true,
            sand: false,
            albedo: 0.2,
            target: (1.0240685512664345, -1.8135446734491898, 0.614021348796245),
            before: "fabd8849ea7d83f7235d0445091ddf138757f7e8601c54ee4413c5d3a2700c2ec8f7793660757ff947d4e7cc9f8042e2ed3a0e451c2592e409f82bed9c97ad70ea6a33cf81ef429e891c891c818fc4cb41a0574e257f900a674428d4fabc15fe1ccd5ff0fc50b164eb936693574e17ebaf1b23e21a88e55cb92929f2b406804a",
            after: "fabd8849ea7d83f7091ea915091ddf138757f7e8601c54ee8703c5d3a2700c2ec8f7793660757ff947d4e7cc9f8042e2ed3a0e451c2592e409f82bed9c97ad70ea6a33cf81ef429eeb04eb04818fc4cb41a0574e257f900a674428d4fabc15fe1ccd5ff0fc50b164eb936693574e17ebaf1b23e21a88e55cb92929f2b406804a",
        },
    ];
    /* recolourDistantSand(лист 8×4, greens, sand, albedo 0,25). */
    const ATLAS_IN: &str = "3b9632ffc49462ff45406d336f6880ff45932dffb69452ff8c69b7407a7c6aff2f7038ffb29e5fff4bee0425606b62ff3b6f30ffc7956cff73a69edf72787dff418539ffb1b15aff28841390656876ff2d8221ffd19775ff27055c496b6f6fff447d25ffb69e74ff986bf43c756e7fff317324ffaf9f69ff6497523e676d80ff";
    const ATLAS_OUT: &str = "1687ffff05508eff45406d336f6880ff45932dff054b92ff8c69b740727f79ff2062bcff134a8bff64b9ff25606b6aff1e69b1ff095188ff73a69edf72787dff227bd9ffb1b15aff0074e490656876ff0375eaff085589ff27055c496b6f6fff107ccfff1c4b79ff986bf43c756e7fff0d6ac6ff1a4980ff4194dc3e676d80ff";
    const ATLAS_TARGET: (f64, f64, f64) = (1.0296803461166886, -0.7237059785420602, 0.8132165862758354);
    /* grassInstanceColour: 6 экземпляров, цель "#e67e22", лист (0,36; 0,42; 0,22). */
    const INSTANCES_IN: &str = "e745021aaabf1c6b02d07d11e6c6e8dfcd5d";
    const INSTANCES_OUT: &str = "ff3000d39b00955200ff6000ffcdf2ffae13";
    const INSTANCE_TARGET: (f64, f64, f64) = (1.2316377536018819, 2.3891372361383536, 0.5934171744546879);
    const INSTANCE_SHEET: [f64; 3] = [0.36, 0.42, 0.22];
    const INSTANCE_REFERENCE: (f64, f64, f64) = (0.1706244, -3.025661938315481, 0.3115674063226286);

    #[test]
    fn sin_and_cos_give_the_bits_of_math_sin_and_math_cos() {
        for (x, sin, cos) in ANGLES {
            assert_eq!(v8::sin(f64::from_bits(x)).to_bits(), sin, "sin({x:#x})");
            assert_eq!(v8::cos(f64::from_bits(x)).to_bits(), cos, "cos({x:#x})");
        }
    }

    #[test]
    fn atan2_and_hypot_give_the_bits_of_math_atan2_and_math_hypot() {
        for (cr, cb, atan2, hypot) in PAIRS {
            let (cr, cb) = (f64::from_bits(cr), f64::from_bits(cb));
            assert_eq!(v8::atan2(cr, cb).to_bits(), atan2, "atan2({cr}, {cb})");
            assert_eq!(v8::hypot(cb, cr).to_bits(), hypot, "hypot({cb}, {cr})");
        }
    }

    #[test]
    fn the_trig_probe_answers_per_function_and_refuses_odd_input() {
        assert_eq!(trig(0, &[0.5]).unwrap()[0].to_bits(), v8::sin(0.5).to_bits());
        assert_eq!(trig(2, &[1.0, 2.0, -1.0, 0.0]).unwrap().len(), 2);
        assert!(trig(3, &[1.0, 2.0, 3.0]).is_err(), "пара неполная");
        assert!(trig(9, &[1.0]).is_err());
        assert!(v8::sin(100.0).is_nan(), "вне области порта — NaN, а не неверное число");
    }

    #[test]
    fn grass_sheet_is_recoloured_like_recolour_grass() {
        let sheet = unhex(GRASS_IN);
        let out = recolour_grass(&sheet, &target(GRASS_TARGET), &mut Oracle::port()).unwrap().unwrap();
        assert_eq!(out, unhex(GRASS_OUT));
        assert_eq!(out.len(), sheet.len());
        assert_eq!(through_tables(|oracle| recolour_grass(&sheet, &target(GRASS_TARGET), oracle).unwrap()), Some(out), "через таблицы JS — те же байты");
        let grey = [90u8, 90, 90, 255, 200, 200, 200, 255];
        assert_eq!(recolour_grass(&grey, &target(GRASS_TARGET), &mut Oracle::port()).unwrap(), None, "травы нет — лист как был");
        assert!(recolour_grass(&[1, 2, 3], &target(GRASS_TARGET), &mut Oracle::port()).is_err(), "длина не кратна четырём");
    }

    /// Цвет травы в точке блока — как `colourAt` образца: пусто там, где `(x + y) % 11 == 2`.
    fn block_slots(sample: &BlocksSample, touched: &[u32], count: usize) -> Vec<i32> {
        let columns = sample.width.div_ceil(4).max(1);
        let mut slots = vec![-1i32; count];
        for &block in touched {
            let (bx, by) = (block as usize % columns, block as usize / columns);
            let (px, py) = ((sample.width - 1).min(bx * 4 + 2), (sample.height - 1).min(by * 4 + 2));
            if (px + py) % 11 != 2 {
                slots[block as usize] = 0;
            }
        }
        slots
    }

    #[test]
    fn distant_blocks_are_shifted_like_recolour_distant_blocks() {
        for sample in &BLOCK_SAMPLES {
            let before = unhex(sample.before);
            let found = blocks_weights(&before, sample.format, sample.width, sample.height, sample.greens, sample.sand).unwrap().expect("в образце есть трава или песок");
            let count = sample.width.div_ceil(4).max(1) * sample.height.div_ceil(4).max(1);
            let slots = block_slots(sample, &found.touched, count);
            let (grass_ref, sand_ref) = references(&found.weights);
            let weights = WeightsIn { grass: &found.weights.grass, sandy: &found.weights.sandy, grass_ref, sand_ref };
            let run = |oracle: &mut Oracle| blocks_shift(&before, sample.format, sample.width, sample.height, weights, &[target(sample.target)], &slots, sample.albedo, oracle).unwrap();
            let expected = (!sample.after.is_empty()).then(|| unhex(sample.after));
            assert_eq!(run(&mut Oracle::port()), expected, "{:?}: порт", sample.format);
            assert_eq!(through_tables(run), expected, "{:?}: таблицы JS", sample.format);
        }
    }

    #[test]
    fn blocks_without_grass_or_sand_and_short_blocks_answer_null_like_js() {
        let grey = [0x10u8, 0x84, 0x10, 0x84, 0, 0, 0, 0];
        assert_eq!(blocks_weights(&grey, BlockFormat::Dxt1, 4, 4, true, true).unwrap().map(|found| found.touched.len()), None);
        assert!(blocks_weights(&grey[..7], BlockFormat::Dxt1, 4, 4, true, true).unwrap().is_none(), "байтов меньше, чем блоков");
        assert_eq!(BlockFormat::from_code(5), Some(BlockFormat::Dxt5));
        assert_eq!(BlockFormat::from_code(2), None);
    }

    #[test]
    fn a_noise_sheet_is_declined_not_failed() {
        /* 40 тысяч пикселей почти без повторов цвета: память не помогает, ядро отказывается словами. */
        let noise: Vec<u8> = (0..40_000u32).flat_map(|at| [(at & 255) as u8, ((at >> 8) as u8).wrapping_mul(37).wrapping_add(at as u8 >> 1), (at.wrapping_mul(7) & 255) as u8, 255]).collect();
        assert_eq!(recolour_grass(&noise, &target(GRASS_TARGET), &mut Oracle::port()).err(), Some(DECLINED));
        assert_eq!(rgba_weights(&noise, true, true).err(), Some(DECLINED));
        /* Лист, где цвета повторяются, — берётся. */
        let sheet = unhex(GRASS_IN).repeat(4000);
        assert!(recolour_grass(&sheet, &target(GRASS_TARGET), &mut Oracle::port()).is_ok());
    }

    #[test]
    fn the_second_half_refuses_what_the_first_half_never_gave() {
        let before = unhex(BLOCK_SAMPLES[0].before);
        let found = blocks_weights(&before, BlockFormat::Dxt1, 32, 16, true, true).unwrap().unwrap();
        let (grass_ref, sand_ref) = references(&found.weights);
        let weights = WeightsIn { grass: &found.weights.grass, sandy: &found.weights.sandy, grass_ref, sand_ref };
        let targets = [target(BLOCK_SAMPLES[0].target)];
        let mut port = Oracle::port();
        assert!(blocks_shift(&before, BlockFormat::Dxt1, 32, 16, weights, &targets, &[0; 3], 0.2, &mut port).is_err(), "номеров не по блокам");
        assert!(blocks_shift(&before, BlockFormat::Dxt1, 32, 16, weights, &targets, &[7; 32], 0.2, &mut port).is_err(), "цели нет в таблице");
        let wild = [Target { gain: 1.0, angle: 9.0, saturation: 1.0 }];
        assert!(blocks_shift(&before, BlockFormat::Dxt1, 32, 16, weights, &wild, &[0; 32], 0.2, &mut port).is_err(), "угол вне области порта");
        /* Таблицы без нужного значения: ядро говорит об этом, а не отдаёт число. */
        let mut empty = Oracle::with_tables(Mode::Answer, &[], &[], &[], &[], &[]).unwrap();
        let slots = vec![0i32; 32];
        let _ = blocks_shift(&before, BlockFormat::Dxt1, 32, 16, weights, &targets, &slots, 0.2, &mut empty);
        assert!(empty.failure().is_some(), "в пустых таблицах ничего нет");
        assert!(Oracle::with_tables(Mode::Answer, &[1.0, 2.0], &[], &[], &[], &[]).is_err(), "таблицы разной длины");
    }

    #[test]
    fn a_decoded_atlas_is_shifted_like_recolour_distant_sand() {
        let atlas = unhex(ATLAS_IN);
        let found = rgba_weights(&atlas, true, true).unwrap().expect("в образце есть трава и песок");
        let mut slots = vec![-1i32; atlas.len() / 4];
        for &index in &found.touched {
            let (px, py) = (index as usize % 8, index as usize / 8);
            if (px * 3 + py) % 7 != 5 {
                slots[index as usize] = 0;
            }
        }
        let (grass_ref, sand_ref) = references(&found.weights);
        let weights = WeightsIn { grass: &found.weights.grass, sandy: &found.weights.sandy, grass_ref, sand_ref };
        let run = |oracle: &mut Oracle| rgba_shift(&atlas, weights, &[target(ATLAS_TARGET)], &slots, 0.25, oracle).unwrap();
        assert_eq!(run(&mut Oracle::port()), Some(unhex(ATLAS_OUT)), "порт");
        assert_eq!(through_tables(run), Some(unhex(ATLAS_OUT)), "таблицы JS");
        assert_eq!(rgba_weights(&[9, 9, 9, 255], true, true).unwrap().map(|found| found.touched.len()), None, "серое — ни травы, ни песка");
    }

    #[test]
    fn instance_colours_match_grass_instance_colour() {
        let instances = unhex(INSTANCES_IN);
        let reference = Reference { y: INSTANCE_REFERENCE.0, angle: INSTANCE_REFERENCE.1, saturation: INSTANCE_REFERENCE.2 };
        let out = instance_colours(&instances, &[0; 6], &[target(INSTANCE_TARGET)], INSTANCE_SHEET, &reference, &mut Oracle::port()).unwrap();
        assert_eq!(out, unhex(INSTANCES_OUT));
        let through = through_tables(|oracle| instance_colours(&instances, &[0; 6], &[target(INSTANCE_TARGET)], INSTANCE_SHEET, &reference, oracle).unwrap());
        assert_eq!(through, out, "таблицы JS");
        let mut slots = [0i32; 6];
        slots[2] = -1;
        let kept = instance_colours(&instances, &slots, &[target(INSTANCE_TARGET)], INSTANCE_SHEET, &reference, &mut Oracle::port()).unwrap();
        assert_eq!(&kept[6..9], &instances[6..9], "без цели — цвет как был");
        assert_eq!(&kept[..6], &out[..6]);
    }
}
