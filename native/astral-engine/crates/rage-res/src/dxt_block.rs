//! BC1/BC2/BC3 (DXT1/3/5) — кодировщик `packages/dds/block-codec.js` байт в байт.
//!
//! Тот же кодировщик по главной оси блока с одним шагом наименьших квадратов
//! и таблицами точного попадания для ровной заливки. Разбора здесь нет: на
//! 3617 текстурах игры JS разбирал блоки быстрее (0,9 против 1,16 с). Формулы,
//! порядок операций с `f64`, строгие сравнения (при равенстве побеждает
//! первый) и округления JS повторены дословно: `Math.round` — половинки
//! вверх, `| 0` — дробь к нулю. Совпадение с JS держит тест эквивалентности.

/// Формат блоков: DXT1 (8 байт, альфа порогом), DXT3 (16, альфа четырьмя
/// битами), DXT5 (16, альфа восемью ступенями).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Dxt1,
    Dxt3,
    Dxt5,
}

impl Format {
    pub fn parse(name: &str) -> Option<Format> {
        match name {
            "DXT1" => Some(Format::Dxt1),
            "DXT3" => Some(Format::Dxt3),
            "DXT5" => Some(Format::Dxt5),
            _ => None,
        }
    }

    fn block_bytes(self) -> usize {
        if self == Format::Dxt1 {
            8
        } else {
            16
        }
    }
}

/// `Math.round` для неотрицательных: ближайшее, половинки вверх.
fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `x < 0 ? 0 : x > 255 ? 255 : x | 0` — `| 0` режет дробь к нулю.
fn clamp255(value: f64) -> i32 {
    if value < 0.0 {
        0
    } else if value > 255.0 {
        255
    } else {
        value as i32
    }
}

fn to565(r: i32, g: i32, b: i32) -> i32 {
    ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}

fn third(n: i32) -> f64 {
    n as f64 / 3.0
}

/// Таблица точного попадания одного канала (5 или 6 бит): пара концов,
/// чья треть палитры ближе всего к каждому значению 0…255.
fn match_table(bits: u32) -> [u8; 512] {
    let levels = 1i32 << bits;
    let expand = |q: i32| if bits == 5 { (q << 3) | (q >> 2) } else { (q << 2) | (q >> 4) };
    let mut table = [0u8; 512];
    for target in 0..256i32 {
        let mut best = i32::MAX;
        let mut high = 0;
        while high < levels {
            let a = expand(high);
            let mut low = 0;
            while low < levels {
                let b = expand(low);
                let interpolated = (2 * a + b + 1) / 3;
                let error = (interpolated - target).abs();
                if error < best {
                    best = error;
                    table[(target * 2) as usize] = high as u8;
                    table[(target * 2 + 1) as usize] = low as u8;
                    if error == 0 {
                        break;
                    }
                }
                low += 1;
            }
            if best == 0 {
                break;
            }
            high += 1;
        }
    }
    table
}

const WEIGHTS: [f64; 4] = [0.0, 1.0, 1.0 / 3.0, 2.0 / 3.0];

/// Таблицы точного попадания — один раз на процесс, как у JS при загрузке модуля.
fn match_tables() -> &'static ([u8; 512], [u8; 512]) {
    static TABLES: std::sync::OnceLock<([u8; 512], [u8; 512])> = std::sync::OnceLock::new();
    TABLES.get_or_init(|| (match_table(5), match_table(6)))
}

struct Encoder {
    match5: &'static [u8; 512],
    match6: &'static [u8; 512],
    /// RGB учитываемых пикселей блока дробными.
    pixels: [f64; 48],
}

/// Итог подбора палитры: ошибка и индексы (по два бита на пиксель).
struct Match {
    error: f64,
    indices: u32,
}

impl Encoder {
    fn new() -> Encoder {
        let (match5, match6) = match_tables();
        Encoder { match5, match6, pixels: [0.0; 48] }
    }

    fn match_palette(&self, used: u32, opaque: bool, c0: i32, c1: i32, bound: f64) -> Match {
        let r0 = (c0 >> 11) & 0x1f;
        let g0 = (c0 >> 5) & 0x3f;
        let b0 = c0 & 0x1f;
        let r1 = (c1 >> 11) & 0x1f;
        let g1 = (c1 >> 5) & 0x3f;
        let b1 = c1 & 0x1f;
        let p0r = (r0 << 3) | (r0 >> 2);
        let p0g = (g0 << 2) | (g0 >> 4);
        let p0b = (b0 << 3) | (b0 >> 2);
        let p1r = (r1 << 3) | (r1 >> 2);
        let p1g = (g1 << 2) | (g1 >> 4);
        let p1b = (b1 << 3) | (b1 >> 2);
        let four = opaque || c0 > c1;
        let p2r = if four { third(2 * p0r + p1r + 1) } else { (p0r + p1r) as f64 / 2.0 };
        let p2g = if four { third(2 * p0g + p1g + 1) } else { (p0g + p1g) as f64 / 2.0 };
        let p2b = if four { third(2 * p0b + p1b + 1) } else { (p0b + p1b) as f64 / 2.0 };
        let p3r = third(p0r + 2 * p1r + 1);
        let p3g = third(p0g + 2 * p1g + 1);
        let p3b = third(p0b + 2 * p1b + 1);
        let (p0r, p0g, p0b) = (p0r as f64, p0g as f64, p0b as f64);
        let (p1r, p1g, p1b) = (p1r as f64, p1g as f64, p1b as f64);
        let mut error = 0.0f64;
        let mut indices = 0u32;
        for index in 0..16u32 {
            if (used >> index) & 1 == 0 {
                indices |= 3 << (index << 1);
                continue;
            }
            let at = (index * 3) as usize;
            let r = self.pixels[at];
            let g = self.pixels[at + 1];
            let b = self.pixels[at + 2];
            let mut dr = r - p0r;
            let mut dg = g - p0g;
            let mut db = b - p0b;
            let d0 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            dr = r - p1r;
            dg = g - p1g;
            db = b - p1b;
            let d1 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            dr = r - p2r;
            dg = g - p2g;
            db = b - p2b;
            let d2 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            /* Победитель без ветвлений, как в JS (`matchPalette`): строго ближе каждого цвета перед ним. */
            let near1 = (d1 < d0) as usize;
            let near2 = ((d2 < d0) & (d2 < d1)) as usize;
            let mut best = near2 * 2 + (1 - near2) * near1;
            let mut dist = [d0, d1, d2, 0.0f64];
            if four {
                dr = r - p3r;
                dg = g - p3g;
                db = b - p3b;
                let d3 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
                let near3 = ((d3 < d0) & (d3 < d1) & (d3 < d2)) as usize;
                best = near3 * 3 + (1 - near3) * best;
                dist[3] = d3;
            }
            let distance = dist[best];
            let best = best as u32;
            error += distance;
            if error >= bound {
                return Match { error, indices: 0 };
            }
            indices |= best << (index << 1);
        }
        Match { error, indices }
    }

    fn encode_color_block(&mut self, block: &[u8; 64], output: &mut [u8], opaque: bool) {
        let mut used = 0u32;
        let mut count = 0i32;
        let (mut min_r, mut min_g, mut min_b) = (255i32, 255i32, 255i32);
        let (mut max_r, mut max_g, mut max_b) = (0i32, 0i32, 0i32);
        let (mut sum_r, mut sum_g, mut sum_b) = (0i32, 0i32, 0i32);
        for index in 0..16usize {
            let at = index << 2;
            if !opaque && block[at + 3] < 128 {
                continue;
            }
            used |= 1 << index;
            count += 1;
            let r = block[at] as i32;
            let g = block[at + 1] as i32;
            let b = block[at + 2] as i32;
            self.pixels[index * 3] = r as f64;
            self.pixels[index * 3 + 1] = g as f64;
            self.pixels[index * 3 + 2] = b as f64;
            if r < min_r {
                min_r = r;
            }
            if g < min_g {
                min_g = g;
            }
            if b < min_b {
                min_b = b;
            }
            if max_r < r {
                max_r = r;
            }
            if max_g < g {
                max_g = g;
            }
            if max_b < b {
                max_b = b;
            }
            sum_r += r;
            sum_g += g;
            sum_b += b;
        }
        if count == 0 {
            output[..8].copy_from_slice(&[0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
            return;
        }

        // Ось блока и проекция на неё.
        let (mut low_r, mut low_g, mut low_b) = (min_r, min_g, min_b);
        let (mut high_r, mut high_g, mut high_b) = (max_r, max_g, max_b);
        let axis_r = max_r - min_r;
        let axis_g = max_g - min_g;
        let axis_b = max_b - min_b;
        if axis_r * axis_r + axis_g * axis_g + axis_b * axis_b != 0 {
            let mut low_t = 0x4000_0000i32;
            let mut high_t = -1i32;
            for index in 0..16usize {
                if (used >> index) & 1 == 0 {
                    continue;
                }
                let at = index << 2;
                let r = block[at] as i32;
                let g = block[at + 1] as i32;
                let b = block[at + 2] as i32;
                let t = (r - min_r) * axis_r + (g - min_g) * axis_g + (b - min_b) * axis_b;
                if t < low_t {
                    low_t = t;
                    low_r = r;
                    low_g = g;
                    low_b = b;
                }
                if high_t < t {
                    high_t = t;
                    high_r = r;
                    high_g = g;
                    high_b = b;
                }
            }
        }

        // Один шаг наименьших квадратов по индексам палитры этих концов.
        let end_c0 = to565(high_r, high_g, high_b);
        let end_c1 = to565(low_r, low_g, low_b);
        let ends = self.match_palette(used, opaque, end_c0, end_c1, f64::INFINITY);
        let (mut a2, mut ab, mut b2) = (0.0f64, 0.0f64, 0.0f64);
        let (mut ax_r, mut ax_g, mut ax_b) = (0.0f64, 0.0f64, 0.0f64);
        let (mut bx_r, mut bx_g, mut bx_b) = (0.0f64, 0.0f64, 0.0f64);
        for index in 0..16u32 {
            if (used >> index) & 1 == 0 {
                continue;
            }
            let w = WEIGHTS[((ends.indices >> (index << 1)) & 3) as usize];
            let a = 1.0 - w;
            a2 += a * a;
            ab += a * w;
            b2 += w * w;
            let at = (index * 3) as usize;
            let r = self.pixels[at];
            let g = self.pixels[at + 1];
            let b = self.pixels[at + 2];
            ax_r += a * r;
            bx_r += w * r;
            ax_g += a * g;
            bx_g += w * g;
            ax_b += a * b;
            bx_b += w * b;
        }
        let determinant = a2 * b2 - ab * ab;
        let mut fit_c0 = end_c0;
        let mut fit_c1 = end_c1;
        if determinant.abs() >= 1e-6 {
            fit_c1 = to565(
                clamp255((ax_r * b2 - bx_r * ab) / determinant),
                clamp255((ax_g * b2 - bx_g * ab) / determinant),
                clamp255((ax_b * b2 - bx_b * ab) / determinant),
            );
            fit_c0 = to565(
                clamp255((bx_r * a2 - ax_r * ab) / determinant),
                clamp255((bx_g * a2 - ax_g * ab) / determinant),
                clamp255((bx_b * a2 - ax_b * ab) / determinant),
            );
        }

        let punch_through = !opaque && count < 16;
        let (mut c0, mut c1) = order_codes(fit_c0, fit_c1, punch_through);
        let mut error = ends.error;
        let mut indices = ends.indices;
        if c0 != end_c0 || c1 != end_c1 {
            let fitted = self.match_palette(used, opaque, c0, c1, f64::INFINITY);
            error = fitted.error;
            indices = fitted.indices;
        }
        if error > 0.0 {
            let average_r = (js_round(sum_r as f64 / count as f64) * 2.0) as usize;
            let average_g = (js_round(sum_g as f64 / count as f64) * 2.0) as usize;
            let average_b = (js_round(sum_b as f64 / count as f64) * 2.0) as usize;
            let (flat_c0, flat_c1) = order_codes(
                ((self.match5[average_r] as i32) << 11) | ((self.match6[average_g] as i32) << 5) | self.match5[average_b] as i32,
                ((self.match5[average_r + 1] as i32) << 11) | ((self.match6[average_g + 1] as i32) << 5) | self.match5[average_b + 1] as i32,
                punch_through,
            );
            if flat_c0 != c0 || flat_c1 != c1 {
                let flat = self.match_palette(used, opaque, flat_c0, flat_c1, error);
                if flat.error < error {
                    c0 = flat_c0;
                    c1 = flat_c1;
                    indices = flat.indices;
                }
            }
        }
        output[0] = (c0 & 0xff) as u8;
        output[1] = ((c0 >> 8) & 0xff) as u8;
        output[2] = (c1 & 0xff) as u8;
        output[3] = ((c1 >> 8) & 0xff) as u8;
        output[4..8].copy_from_slice(&indices.to_le_bytes());
    }
}

/// Порядок кодов задаёт режим палитры (как `orderCodes`).
fn order_codes(c0: i32, c1: i32, punch_through: bool) -> (i32, i32) {
    let mut high = c0;
    let mut low = c1;
    if punch_through {
        if high > low {
            high = c1;
            low = c0;
        }
        if high == low && low < 0xffff {
            low += 1;
        }
    } else if high <= low {
        if high == low {
            low = if high == 0 { 0 } else { high - 1 };
        } else {
            high = c1;
            low = c0;
        }
    }
    (high, low)
}

/// Альфа DXT5: концы — максимум и минимум, восемь ступеней, ближайшая
/// (при равенстве — меньший номер).
fn encode_alpha_block(block: &[u8; 64], output: &mut [u8]) {
    let mut min = 255u8;
    let mut max = 0u8;
    let mut at = 3;
    while at < 64 {
        let alpha = block[at];
        if alpha < min {
            min = alpha;
        }
        if alpha > max {
            max = alpha;
        }
        at += 4;
    }
    let a0 = max as f64;
    let a1 = min as f64;
    output[0] = max;
    output[1] = min;
    if max == min {
        output[2..8].fill(0);
        return;
    }
    let v = [
        (6.0 * a0 + a1) / 7.0,
        (5.0 * a0 + 2.0 * a1) / 7.0,
        (4.0 * a0 + 3.0 * a1) / 7.0,
        (3.0 * a0 + 4.0 * a1) / 7.0,
        (2.0 * a0 + 5.0 * a1) / 7.0,
        (a0 + 6.0 * a1) / 7.0,
    ];
    let mut low = 0u32;
    let mut high = 0u32;
    for index in 0..16u32 {
        let alpha = block[((index << 2) + 3) as usize];
        /* Ближайшая из восьми ступеней без ветвлений: первая из равных побеждает, как в цепочке «<». */
        let value = alpha as f64;
        let distances = [
            a0 - value,
            value - a1,
            (v[0] - value).abs(),
            (v[1] - value).abs(),
            (v[2] - value).abs(),
            (v[3] - value).abs(),
            (v[4] - value).abs(),
            (v[5] - value).abs(),
        ];
        let mut best = 0usize;
        let mut best_distance = distances[0];
        for step in 1..8usize {
            let nearer = distances[step] < best_distance;
            best = if nearer { step } else { best };
            best_distance = if nearer { distances[step] } else { best_distance };
        }
        let best = best as u32;
        if index < 8 {
            low |= best << (index * 3);
        } else {
            high |= best << ((index - 8) * 3);
        }
    }
    output[2] = (low & 0xff) as u8;
    output[3] = ((low >> 8) & 0xff) as u8;
    output[4] = ((low >> 16) & 0xff) as u8;
    output[5] = (high & 0xff) as u8;
    output[6] = ((high >> 8) & 0xff) as u8;
    output[7] = ((high >> 16) & 0xff) as u8;
}

fn encode_sharp_alpha_block(block: &[u8; 64], output: &mut [u8]) {
    let mut index = 0;
    while index < 16 {
        let low = block[index * 4 + 3] >> 4;
        let high = block[(index + 1) * 4 + 3] >> 4;
        output[index / 2] = low | (high << 4);
        index += 2;
    }
}

/// Пиксели блока 4×4; края достраиваются повтором.
fn read_block(rgba: &[u8], width: usize, height: usize, block_x: usize, block_y: usize, out: &mut [u8; 64]) {
    /* Блок целиком внутри картинки — четыре строки по 16 байт. */
    if block_x + 4 <= width && block_y + 4 <= height {
        for y in 0..4 {
            let source = ((block_y + y) * width + block_x) * 4;
            out[y * 16..y * 16 + 16].copy_from_slice(&rgba[source..source + 16]);
        }
        return;
    }
    for y in 0..4 {
        let source_y = (block_y + y).min(height - 1);
        for x in 0..4 {
            let source_x = (block_x + x).min(width - 1);
            let source = (source_y * width + source_x) * 4;
            let target = (y * 4 + x) * 4;
            out[target..target + 4].copy_from_slice(&rgba[source..source + 4]);
        }
    }
}

/// Длина блоков картинки в байтах.
pub fn blocks_len(format: Format, width: usize, height: usize) -> usize {
    1.max(width.div_ceil(4)) * 1.max(height.div_ceil(4)) * format.block_bytes()
}

/// RGBA → сжатые блоки (`encodeBlocks`) в `output` длиной `blocks_len`.
/// `rgba` — ровно `width × height × 4`.
pub fn encode_blocks(format: Format, rgba: &[u8], width: usize, height: usize, output: &mut [u8]) {
    let blocks_x = 1.max(width.div_ceil(4));
    let blocks_y = 1.max(height.div_ceil(4));
    let block_bytes = format.block_bytes();
    let mut encoder = Encoder::new();
    let mut block = [0u8; 64];
    let mut previous = [0u8; 64];
    let mut previous_offset: Option<usize> = None;
    let mut offset = 0;
    for block_y in 0..blocks_y {
        for block_x in 0..blocks_x {
            read_block(rgba, width, height, block_x * 4, block_y * 4, &mut block);
            match previous_offset {
                /* Блок, повторивший прошлый, сжимается так же — его байты копируются. */
                Some(from) if block == previous => output.copy_within(from..from + block_bytes, offset),
                _ => {
                    let target = &mut output[offset..offset + block_bytes];
                    match format {
                        Format::Dxt5 => {
                            encode_alpha_block(&block, &mut target[..8]);
                            encoder.encode_color_block(&block, &mut target[8..], true);
                        }
                        Format::Dxt3 => {
                            encode_sharp_alpha_block(&block, &mut target[..8]);
                            encoder.encode_color_block(&block, &mut target[8..], true);
                        }
                        Format::Dxt1 => encoder.encode_color_block(&block, target, false),
                    }
                    previous = block;
                    previous_offset = Some(offset);
                }
            }
            offset += block_bytes;
        }
    }
}
