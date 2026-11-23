//! Запись BC7 режима 6 — `packages/dds/bc7-encode.js` байт в байт.
//!
//! Режим 6 — один отрезок цвета на блок 4×4: две опорные точки RGBA по 7 бит и общему младшему
//! биту у каждой, 16 ступеней между ними. Кодировщик: главная ось блока степенным методом,
//! проекция, подбор ступеней и одно уточнение концов по ступеням. Порядок действий и сложений —
//! как у JS: итог обязан совпасть до бита, иначе плитка воды у движка и у приложения разойдётся.

/// Веса ступеней режима 6 (четыре бита на пиксель).
const WEIGHTS: [i32; 16] = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

/// `Math.round`: к ближайшему целому, ровно половина — вверх.
pub(crate) fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

fn clamp_byte(value: f64) -> f64 {
    if value < 0.0 {
        0.0
    } else if value > 255.0 {
        255.0
    } else {
        value
    }
}

/// Код канала опорной точки при младшем бите `bit` (`quantizeEndpoint`).
fn channel_code(value: f64, bit: i32) -> i32 {
    let code = js_round((clamp_byte(value) - f64::from(bit)) / 2.0);
    if code < 0.0 {
        0
    } else if code > 127.0 {
        127
    } else {
        code as i32
    }
}

/// Опорная точка RGBA → 7 бит на канал в `out` и общий младший бит: из двух вариантов бита — тот, что ближе.
fn quantize_endpoint(point: &[f64; 4], out: &mut [i32]) -> i32 {
    let mut best = f64::INFINITY;
    let mut best_bit = 0;
    for bit in 0..2 {
        let mut error = 0.0;
        for &channel in point {
            let value = clamp_byte(channel);
            let restored = f64::from((channel_code(channel, bit) << 1) | bit);
            error += (restored - value) * (restored - value);
        }
        if error < best {
            best = error;
            best_bit = bit;
        }
    }
    for (slot, &channel) in out.iter_mut().zip(point) {
        *slot = channel_code(channel, best_bit);
    }
    best_bit
}

/// Рабочие массивы блока.
struct Work {
    codes: [i32; 8],
    bits: [i32; 2],
    palette: [i32; 64],
    indices: [i32; 16],
}

/// Ступени отрезка и лучшая ступень каждого пикселя; возвращает ошибку (`assignIndices`).
fn assign_indices(pixels: &[i32; 64], work: &mut Work) -> i64 {
    for step in 0..16 {
        let weight = WEIGHTS[step];
        for channel in 0..4 {
            let a = (work.codes[channel] << 1) | work.bits[0];
            let b = (work.codes[4 + channel] << 1) | work.bits[1];
            work.palette[step * 4 + channel] = ((64 - weight) * a + weight * b + 32) >> 6;
        }
    }
    let mut total = 0i64;
    for pixel in 0..16 {
        let mut best = i64::MAX;
        let mut best_step = 0;
        let at = pixel * 4;
        for step in 0..16 {
            let p = step * 4;
            let dr = i64::from(work.palette[p] - pixels[at]);
            let dg = i64::from(work.palette[p + 1] - pixels[at + 1]);
            let db = i64::from(work.palette[p + 2] - pixels[at + 2]);
            let da = i64::from(work.palette[p + 3] - pixels[at + 3]);
            let error = dr * dr + dg * dg + db * db + da * da;
            if error < best {
                best = error;
                best_step = step as i32;
            }
        }
        work.indices[pixel] = best_step;
        total += best;
    }
    total
}

/// Концы отрезка по ступеням пикселей — наименьшие квадраты (`refitEndpoints`).
fn refit_endpoints(pixels: &[i32; 64], indices: &[i32; 16], low: &mut [f64; 4], high: &mut [f64; 4]) -> bool {
    let (mut aa, mut ab, mut bb) = (0.0f64, 0.0f64, 0.0f64);
    let mut ax = [0.0f64; 4];
    let mut bx = [0.0f64; 4];
    for pixel in 0..16 {
        let t = f64::from(WEIGHTS[indices[pixel] as usize]) / 64.0;
        let s = 1.0 - t;
        aa += s * s;
        ab += s * t;
        bb += t * t;
        for channel in 0..4 {
            ax[channel] += s * f64::from(pixels[pixel * 4 + channel]);
            bx[channel] += t * f64::from(pixels[pixel * 4 + channel]);
        }
    }
    let det = aa * bb - ab * ab;
    if det.abs() < 1e-6 {
        return false;
    }
    for channel in 0..4 {
        low[channel] = (ax[channel] * bb - bx[channel] * ab) / det;
        high[channel] = (bx[channel] * aa - ax[channel] * ab) / det;
    }
    true
}

/// 16 байт блока (`writeBlock`). Якорный пиксель (первый) обязан иметь старший бит ступени 0:
/// иначе концы меняются местами, а ступени — на зеркальные.
fn write_block(out: &mut [u8], mut codes: [i32; 8], mut bits: [i32; 2], mut indices: [i32; 16]) {
    if indices[0] >= 8 {
        for channel in 0..4 {
            codes.swap(channel, 4 + channel);
        }
        bits.swap(0, 1);
        for index in &mut indices {
            *index = 15 - *index;
        }
    }
    out.fill(0);
    let mut bit = 0usize;
    let mut put = |value: i32, count: usize| {
        for index in 0..count {
            if (value >> index) & 1 == 1 {
                out[bit >> 3] |= 1 << (bit & 7);
            }
            bit += 1;
        }
    };
    put(1 << 6, 7);
    for channel in 0..4 {
        put(codes[channel], 7);
        put(codes[4 + channel], 7);
    }
    put(bits[0], 1);
    put(bits[1], 1);
    for (pixel, &index) in indices.iter().enumerate() {
        put(index, if pixel == 0 { 3 } else { 4 });
    }
}

/// Блок 4×4 (`pixels` — 64 значения RGBA) → 16 байт BC7 режима 6 (`encodeBlock`).
fn encode_block(pixels: &[i32; 64], out: &mut [u8]) {
    let mut mean = [0.0f64; 4];
    for pixel in 0..16 {
        for channel in 0..4 {
            mean[channel] += f64::from(pixels[pixel * 4 + channel]) / 16.0;
        }
    }

    /* Главная ось — степенным методом по ковариации. */
    let mut cov = [0.0f64; 16];
    for pixel in 0..16 {
        for i in 0..4 {
            let di = f64::from(pixels[pixel * 4 + i]) - mean[i];
            for j in i..4 {
                cov[i * 4 + j] += di * (f64::from(pixels[pixel * 4 + j]) - mean[j]);
            }
        }
    }
    for i in 0..4 {
        for j in 0..i {
            cov[i * 4 + j] = cov[j * 4 + i];
        }
    }
    let mut axis = [1.0f64, 1.0, 1.0, 0.25];
    let mut next = [0.0f64; 4];
    for _ in 0..8 {
        let mut length = 0.0f64;
        for i in 0..4 {
            next[i] = cov[i * 4] * axis[0] + cov[i * 4 + 1] * axis[1] + cov[i * 4 + 2] * axis[2] + cov[i * 4 + 3] * axis[3];
            length += next[i] * next[i];
        }
        let length = length.sqrt();
        if length < 1e-9 {
            break;
        }
        for i in 0..4 {
            axis[i] = next[i] / length;
        }
    }
    let mut t_min = f64::INFINITY;
    let mut t_max = f64::NEG_INFINITY;
    for pixel in 0..16 {
        let mut t = 0.0f64;
        for channel in 0..4 {
            t += (f64::from(pixels[pixel * 4 + channel]) - mean[channel]) * axis[channel];
        }
        if t < t_min {
            t_min = t;
        }
        if t > t_max {
            t_max = t;
        }
    }
    let mut low = [0.0f64; 4];
    let mut high = [0.0f64; 4];
    for channel in 0..4 {
        low[channel] = mean[channel] + axis[channel] * t_min;
        high[channel] = mean[channel] + axis[channel] * t_max;
    }

    let mut work = Work { codes: [0; 8], bits: [0; 2], palette: [0; 64], indices: [0; 16] };
    work.bits[0] = quantize_endpoint(&low, &mut work.codes[..4]);
    work.bits[1] = quantize_endpoint(&high, &mut work.codes[4..]);
    let mut best = assign_indices(pixels, &mut work);
    let mut best_indices = work.indices;
    let mut best_codes = work.codes;
    let mut best_bits = work.bits;

    /* Одно уточнение концов по найденным ступеням. */
    if best > 0 && refit_endpoints(pixels, &work.indices, &mut low, &mut high) {
        work.bits[0] = quantize_endpoint(&low, &mut work.codes[..4]);
        work.bits[1] = quantize_endpoint(&high, &mut work.codes[4..]);
        let error = assign_indices(pixels, &mut work);
        if error < best {
            best = error;
            best_indices = work.indices;
            best_codes = work.codes;
            best_bits = work.bits;
        }
    }
    let _ = best;
    write_block(out, best_codes, best_bits, best_indices);
}

/// Один уровень RGBA → байты BC7 (16 байт на блок 4×4, `encodeBc7`). Края меньше блока повторяют
/// последний пиксель. `rgba` — ровно `width × height × 4`.
pub fn encode(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let blocks_wide = width.div_ceil(4).max(1);
    let blocks_high = height.div_ceil(4).max(1);
    let mut out = vec![0u8; blocks_wide * blocks_high * 16];
    let mut pixels = [0i32; 64];
    for by in 0..blocks_high {
        for bx in 0..blocks_wide {
            for y in 0..4 {
                for x in 0..4 {
                    let sx = (width - 1).min(bx * 4 + x);
                    let sy = (height - 1).min(by * 4 + y);
                    let source = (sy * width + sx) * 4;
                    let target = (y * 4 + x) * 4;
                    for channel in 0..4 {
                        pixels[target + channel] = i32::from(rgba[source + channel]);
                    }
                }
            }
            let at = (by * blocks_wide + bx) * 16;
            encode_block(&pixels, &mut out[at..at + 16]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_res::texture::{decode_pixels, Format};

    #[test]
    fn rounding_is_half_up_like_math_round() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(2.4999), 2.0);
        assert_eq!(js_round(-0.5), 0.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(-1.51), -2.0);
        /* Сумма с половиной здесь округлилась бы до единицы; `Math.round` даёт ноль. */
        assert_eq!(js_round(0.499_999_999_999_999_94), 0.0);
    }

    #[test]
    fn a_flat_block_is_mode_six_and_decodes_to_the_same_colour() {
        let rgba: Vec<u8> = [40u8, 90, 200, 255].iter().copied().cycle().take(64).collect();
        let block = encode(&rgba, 4, 4);
        assert_eq!(block.len(), 16);
        assert_eq!(block[0] & 0x7f, 0x40, "младшие семь бит — режим 6");
        let back = decode_pixels(Format::Bc7, &block, 4, 4).expect("блок читается");
        for pixel in back.chunks_exact(4) {
            for (got, want) in pixel.iter().zip([40u8, 90, 200, 255]) {
                assert!(got.abs_diff(want) <= 1, "{got} против {want}");
            }
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// Тот же счётчик, что в образцах JS: `state = (state * 1103515245 + 12345) & 0x7fffffff`, байт — биты 16–23.
    struct Noise(u32);

    impl Noise {
        fn next(&mut self) -> u8 {
            self.0 = self.0.wrapping_mul(1_103_515_245).wrapping_add(12_345) & 0x7fff_ffff;
            ((self.0 >> 16) & 0xff) as u8
        }
    }

    /* Образцы сняты с `encodeBc7` из packages/dds/bc7-encode.js: блоки обязаны совпасть до бита. */

    #[test]
    fn a_two_axis_ramp_matches_the_js_encoder() {
        let mut rgba = Vec::with_capacity(8 * 8 * 4);
        for y in 0..8u8 {
            for x in 0..8u8 {
                rgba.extend_from_slice(&[10 + x * 6, 40 + y * 5, 90 + x * 3 + y * 2, 255]);
            }
        }
        assert_eq!(
            hex(&encode(&rgba, 8, 8)),
            "40c2c39269d1feff40c741d952ea82eb40c8c69299e9feff40c741d952ea82eb40c203348ae1feff40c741d952ea82eb40c80634baf9feff40c741d952ea82eb"
        );
    }

    #[test]
    fn a_level_smaller_than_a_block_repeats_its_last_pixel_like_the_js_encoder() {
        let rgba = [200u8, 10, 10, 255, 10, 200, 10, 255];
        assert_eq!(hex(&encode(&rgba, 2, 1)), "c04e87c92c14fe7f0000000000000000");
    }

    #[test]
    fn noise_and_a_fog_like_gradient_match_the_js_encoder() {
        let mut noise = Noise(12_345);
        let rgba: Vec<u8> = (0..12 * 8 * 4).map(|_| noise.next()).collect();
        assert_eq!(
            hex(&encode(&rgba, 12, 8)),
            "40df8d45b5b8ef8e774efa21b60ddd1dc05969809f9e50640422acd55a4cfe0840f48a0f2092fb916ae8594c5730f68ac03484461d378c1849e0872932ae44f9c07466f2ffa8fd8dfd56006869066ad6c00b996d28ed417555667c776289320f"
        );
        /* Счётчик идёт дальше: по два числа на точку — красный и альфа. */
        let mut fog = Vec::with_capacity(8 * 8 * 4);
        for y in 0..8u8 {
            for x in 0..8u8 {
                let red = 1 + x * 5 + (noise.next() & 3);
                let alpha = 120 + y * 9 + (noise.next() & 1);
                fog.extend_from_slice(&[red, 27 + x * 6 + y, 33 + x * 5 + y * 2, alpha]);
            }
        }
        assert_eq!(
            hex(&encode(&fog, 8, 8)),
            "c040a281816c7ac9208452a875da97fd40c52443d29478c9308552b894daa7fcc040e2a1a17c9cdc206452a775dab7fc40c56463f2a49cdc308452a875dab7fc"
        );
    }
}
