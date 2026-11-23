// Сжатие плиток большой карты в блоки BC1/BC3, цепочка мип-уровней и файл DDS (legacy-заголовок).
// Модуль самодостаточен: соседей и модулей Node не требует.

// Блок 4×4: точек, каналов цвета, чисел в блоке (RGBA).
const POINTS = 16;
const CHANNELS = 3;
const BLOCK_LEN = 64;

const MAGIC = 0x20534444;
const HEADER = 128;
const CUTOUT_ALPHA = 128;
const GHOST_WEIGHT = 0.015625;
const FIRM_WEIGHT = 0.25;
// Растяжение каналов R, G, B при поиске главной оси (корень из веса канала).
const STRETCH = Float64Array.of(1.4142135623730951, 2, 1);

// <таблицы>
// Таблицы перенесены скриптом из vector-map-dds.data.json.
const EXPAND5 = Uint8Array.from([
  0, 8, 16, 24, 33, 41, 49, 57, 66, 74, 82, 90, 99, 107, 115, 123, 132, 140, 148, 156, 165, 173,
  181, 189, 198, 206, 214, 222, 231, 239, 247, 255,
]);
const EXPAND6 = Uint8Array.from([
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 65, 69, 73, 77, 81, 85, 89, 93, 97,
  101, 105, 109, 113, 117, 121, 125, 130, 134, 138, 142, 146, 150, 154, 158, 162, 166, 170, 174,
  178, 182, 186, 190, 195, 199, 203, 207, 211, 215, 219, 223, 227, 231, 235, 239, 243, 247, 251,
  255,
]);
const NEAREST5 = Uint8Array.from([
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11,
  11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 13, 13, 13, 14, 14, 14, 14,
  14, 14, 14, 14, 15, 15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17,
  17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 20, 20, 20,
  20, 20, 20, 20, 20, 20, 21, 21, 21, 21, 21, 21, 21, 21, 22, 22, 22, 22, 22, 22, 22, 22, 23, 23,
  23, 23, 23, 23, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 24, 25, 25, 25, 25, 25, 25, 25, 25, 26,
  26, 26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  29, 29, 29, 29, 29, 29, 29, 29, 30, 30, 30, 30, 30, 30, 30, 30, 31, 31, 31, 31,
]);
const NEAREST6 = Uint8Array.from([
  0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8,
  8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14,
  14, 15, 15, 15, 15, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20,
  20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25, 25, 25, 26, 26,
  26, 26, 27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30, 30, 30, 31, 31, 31, 31, 32, 32,
  32, 32, 32, 33, 33, 33, 33, 34, 34, 34, 34, 35, 35, 35, 35, 36, 36, 36, 36, 37, 37, 37, 37, 38,
  38, 38, 38, 39, 39, 39, 39, 40, 40, 40, 40, 41, 41, 41, 41, 42, 42, 42, 42, 43, 43, 43, 43, 44,
  44, 44, 44, 45, 45, 45, 45, 46, 46, 46, 46, 47, 47, 47, 47, 48, 48, 48, 48, 48, 49, 49, 49, 49,
  50, 50, 50, 50, 51, 51, 51, 51, 52, 52, 52, 52, 53, 53, 53, 53, 54, 54, 54, 54, 55, 55, 55, 55,
  56, 56, 56, 56, 57, 57, 57, 57, 58, 58, 58, 58, 59, 59, 59, 59, 60, 60, 60, 60, 61, 61, 61, 61,
  62, 62, 62, 62, 63, 63,
]);
const MATCH5 = Uint8Array.from([
  0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1, 2, 2, 1, 2, 1, 2, 2,
  2, 2, 2, 2, 2, 3, 2, 3, 2, 3, 3, 2, 2, 4, 3, 3, 3, 3, 3, 3, 3, 4, 3, 4, 4, 2, 3, 5, 4, 3, 4, 3,
  4, 4, 4, 4, 4, 4, 5, 3, 4, 5, 4, 5, 5, 4, 5, 4, 5, 5, 5, 5, 5, 5, 5, 6, 5, 6, 5, 6, 6, 5, 6, 5,
  6, 6, 6, 6, 6, 6, 6, 7, 6, 7, 6, 7, 7, 6, 6, 8, 7, 7, 7, 7, 7, 7, 7, 8, 7, 8, 8, 6, 7, 9, 8, 7,
  8, 7, 8, 8, 8, 8, 8, 8, 9, 7, 8, 9, 8, 9, 9, 8, 9, 8, 9, 9, 9, 9, 9, 9, 9, 10, 9, 10, 9, 10, 10,
  9, 10, 9, 10, 10, 10, 10, 10, 10, 10, 11, 10, 11, 10, 11, 11, 10, 10, 12, 11, 11, 11, 11, 11, 11,
  11, 12, 11, 12, 12, 10, 11, 13, 12, 11, 12, 11, 12, 12, 12, 12, 12, 12, 13, 11, 12, 13, 12, 13,
  13, 12, 13, 12, 13, 13, 13, 13, 13, 13, 13, 14, 13, 14, 13, 14, 14, 13, 14, 13, 14, 14, 14, 14,
  14, 14, 14, 15, 14, 15, 14, 15, 15, 14, 14, 16, 15, 15, 15, 15, 15, 15, 15, 16, 15, 16, 16, 14,
  15, 17, 16, 15, 16, 15, 16, 16, 16, 16, 16, 16, 17, 15, 16, 17, 16, 17, 17, 16, 17, 16, 17, 17,
  17, 17, 17, 17, 17, 18, 17, 18, 17, 18, 18, 17, 18, 17, 18, 18, 18, 18, 18, 18, 18, 19, 18, 19,
  18, 19, 19, 18, 18, 20, 19, 19, 19, 19, 19, 19, 19, 20, 19, 20, 20, 18, 19, 21, 20, 19, 20, 19,
  20, 20, 20, 20, 20, 20, 21, 19, 20, 21, 20, 21, 21, 20, 21, 20, 21, 21, 21, 21, 21, 21, 21, 22,
  21, 22, 21, 22, 22, 21, 22, 21, 22, 22, 22, 22, 22, 22, 22, 23, 22, 23, 22, 23, 23, 22, 22, 24,
  23, 23, 23, 23, 23, 23, 23, 24, 23, 24, 24, 22, 23, 25, 24, 23, 24, 23, 24, 24, 24, 24, 24, 24,
  25, 23, 24, 25, 24, 25, 25, 24, 25, 24, 25, 25, 25, 25, 25, 25, 25, 26, 25, 26, 25, 26, 26, 25,
  26, 25, 26, 26, 26, 26, 26, 26, 26, 27, 26, 27, 26, 27, 27, 26, 26, 28, 27, 27, 27, 27, 27, 27,
  27, 28, 27, 28, 28, 26, 27, 29, 28, 27, 28, 27, 28, 28, 28, 28, 28, 28, 29, 27, 28, 29, 28, 29,
  29, 28, 29, 28, 29, 29, 29, 29, 29, 29, 29, 30, 29, 30, 29, 30, 30, 29, 30, 29, 30, 30, 30, 30,
  30, 30, 30, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 31, 31,
]);
const MATCH6 = Uint8Array.from([
  0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 2, 1, 2, 2, 1, 2, 2, 2, 3, 2, 3, 3, 2, 3, 3, 3, 4, 3, 4, 4, 3,
  4, 4, 4, 5, 4, 5, 5, 4, 5, 5, 5, 6, 5, 6, 6, 5, 6, 6, 6, 7, 6, 7, 7, 6, 7, 7, 7, 8, 7, 8, 8, 7,
  8, 8, 8, 9, 8, 9, 9, 8, 9, 9, 9, 10, 9, 10, 10, 9, 10, 10, 10, 11, 10, 11, 11, 10, 11, 11, 11,
  12, 11, 12, 12, 11, 12, 12, 12, 13, 12, 13, 13, 12, 13, 13, 13, 14, 13, 14, 14, 13, 14, 14, 14,
  15, 16, 11, 14, 16, 15, 15, 16, 13, 16, 14, 15, 17, 15, 18, 16, 16, 17, 15, 15, 20, 17, 16, 17,
  17, 17, 18, 17, 18, 18, 17, 18, 18, 18, 19, 18, 19, 19, 18, 19, 19, 19, 20, 19, 20, 20, 19, 20,
  20, 20, 21, 20, 21, 21, 20, 21, 21, 21, 22, 21, 22, 22, 21, 22, 22, 22, 23, 22, 23, 23, 22, 23,
  23, 23, 24, 23, 24, 24, 23, 24, 24, 24, 25, 24, 25, 25, 24, 25, 25, 25, 26, 25, 26, 26, 25, 26,
  26, 26, 27, 26, 27, 27, 26, 27, 27, 27, 28, 27, 28, 28, 27, 28, 28, 28, 29, 28, 29, 29, 28, 29,
  29, 29, 30, 29, 30, 30, 29, 30, 30, 30, 31, 32, 27, 30, 32, 31, 31, 32, 29, 32, 30, 31, 33, 31,
  34, 32, 32, 33, 31, 31, 36, 33, 32, 33, 33, 33, 34, 33, 34, 34, 33, 34, 34, 34, 35, 34, 35, 35,
  34, 35, 35, 35, 36, 35, 36, 36, 35, 36, 36, 36, 37, 36, 37, 37, 36, 37, 37, 37, 38, 37, 38, 38,
  37, 38, 38, 38, 39, 38, 39, 39, 38, 39, 39, 39, 40, 39, 40, 40, 39, 40, 40, 40, 41, 40, 41, 41,
  40, 41, 41, 41, 42, 41, 42, 42, 41, 42, 42, 42, 43, 42, 43, 43, 42, 43, 43, 43, 44, 43, 44, 44,
  43, 44, 44, 44, 45, 44, 45, 45, 44, 45, 45, 45, 46, 45, 46, 46, 45, 46, 46, 46, 47, 48, 43, 46,
  48, 47, 47, 48, 45, 48, 46, 47, 49, 47, 50, 48, 48, 49, 47, 47, 52, 49, 48, 49, 49, 49, 50, 49,
  50, 50, 49, 50, 50, 50, 51, 50, 51, 51, 50, 51, 51, 51, 52, 51, 52, 52, 51, 52, 52, 52, 53, 52,
  53, 53, 52, 53, 53, 53, 54, 53, 54, 54, 53, 54, 54, 54, 55, 54, 55, 55, 54, 55, 55, 55, 56, 55,
  56, 56, 55, 56, 56, 56, 57, 56, 57, 57, 56, 57, 57, 57, 58, 57, 58, 58, 57, 58, 58, 58, 59, 58,
  59, 59, 58, 59, 59, 59, 60, 59, 60, 60, 59, 60, 60, 60, 61, 60, 61, 61, 60, 61, 61, 61, 62, 61,
  62, 62, 61, 62, 62, 62, 63, 62, 63, 63, 62, 63, 63,
]);
const SHARE = Float64Array.from([
  0, 1, 0.3333333333333333, 0.6666666666666666,
]);
const FORMATS = {
  bc1: { bytes: 8, fourcc: 827611204 },
  bc1a: { bytes: 8, fourcc: 827611204 },
  bc3: { bytes: 16, fourcc: 894720068 },
};
// </таблицы>

// Каналы 5-6-5 по порядку R, G, B: положение и размер кода в 16-битном цвете, таблицы на канал.
const SHIFT = [11, 5, 0];
const MASK = [31, 63, 31];
const EXPAND = [EXPAND5, EXPAND6, EXPAND5];
const NEAREST = [NEAREST5, NEAREST6, NEAREST5];
const MATCH = [MATCH5, MATCH6, MATCH5];
// Усечение канала до кода без округления (режим bc1a).
const CUT = [3, 2, 3];

// Вес точки в режиме bc3: альфа / 255; у невидимой точки — малая доля.
const ALPHA_WEIGHT = Float64Array.from({ length: 256 }, (_, alpha) => (alpha === 0 ? GHOST_WEIGHT : alpha / 255));
// Шаг альфа-палитры (0…7) → трёхбитный код.
const STEP_CODE = Uint8Array.of(1, 7, 6, 5, 4, 3, 2, 0);

const f64 = (size) => new Float64Array(size);
const i32 = (size) => new Int32Array(size);

// Рабочая память блока 4×4. Два буфера байт: новый блок сравнивается с предыдущим закодированным.
const SLOTS = [new Uint8Array(BLOCK_LEN), new Uint8Array(BLOCK_LEN)];
const SLOT_WORDS = SLOTS.map((slot) => new Uint32Array(slot.buffer));
// Слова блока на запись, шесть байт альфа-индексов двумя 24-битными половинами, номера видимых точек.
const [WORDS, LANES, SEEN] = [i32(4), i32(2), i32(POINTS)];
// Точки блока подряд (R, G, B), их веса, растянутые отклонения от среднего, средний цвет, главная ось.
const [SAMPLE, LOAD, DEV, MEAN, AXIS] = [f64(48), f64(POINTS), f64(48), f64(3), f64(3)];
// Пробные цвета для перевода в код.
const [TRIAL, TRIAL_B] = [f64(3), f64(3)];
// Уже проверенные пары концов в текущем блоке.
const TRIED = i32(8);
let triedCount = 0;

// Лучшая пара концов: ошибка, старший и младший конец, индексы точек; плюс индексы последней проверенной пары.
const BEST = f64(5);
const [ERR, HI, LO, BITS, SPARE] = [0, 1, 2, 3, 4];

const snap = (value) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));
// Треть пути от «ближнего» конца к «дальнему» (bias — поправка округления при разжатии).
const blend = (near, far, bias) => (2 * near + far + bias) / 3;
// Значение канала c в 16-битном цвете.
const channel = (code, c) => EXPAND[c][(code >> SHIFT[c]) & MASK[c]];

// Ближайший по значению 16-битный код для цвета из трёх чисел.
const nearestCode = (v) => (NEAREST[0][snap(v[0])] << 11) | (NEAREST[1][snap(v[1])] << 5) | NEAREST[2][snap(v[2])];

// Расстояние между цветами (r, g, b) и (pr, pg, pb) с весами каналов 2, 4, 1.
function gap(r, g, b, pr, pg, pb) {
  const x = r - pr;
  const y = g - pg;
  const z = b - pb;
  return x * x * 2 + y * y * 4 + z * z;
}

// Ошибка пары с одним цветом на оба конца: все индексы 0.
function measureSingle(code, limit) {
  const r0 = channel(code, 0);
  const g0 = channel(code, 1);
  const b0 = channel(code, 2);
  let error = 0;
  for (let i = 0; i < POINTS; i++) {
    error += LOAD[i] * gap(SAMPLE[i * 3], SAMPLE[i * 3 + 1], SAMPLE[i * 3 + 2], r0, g0, b0);
    if (error >= limit) return error;
  }
  BEST[SPARE] = 0;
  return error;
}

// Ошибка пары разных концов (палитра из четырёх цветов); индексы точек остаются в BEST[SPARE].
function measurePalette(high, low, limit) {
  const e0r = channel(high, 0);
  const e0g = channel(high, 1);
  const e0b = channel(high, 2);
  const e1r = channel(low, 0);
  const e1g = channel(low, 1);
  const e1b = channel(low, 2);
  const e2r = blend(e0r, e1r, 0);
  const e2g = blend(e0g, e1g, 0);
  const e2b = blend(e0b, e1b, 0);
  const e3r = blend(e1r, e0r, 0);
  const e3g = blend(e1g, e0g, 0);
  const e3b = blend(e1b, e0b, 0);
  let error = 0;
  let bits = 0;
  for (let i = 0; i < POINTS; i++) {
    const o = i * 3;
    const b = SAMPLE[o + 2];
    const r = SAMPLE[o];
    const g = SAMPLE[o + 1];
    const d0 = gap(r, g, b, e0r, e0g, e0b);
    const d1 = gap(r, g, b, e1r, e1g, e1b);
    const d2 = gap(r, g, b, e2r, e2g, e2b);
    const d3 = gap(r, g, b, e3r, e3g, e3b);
    // Заменяет лучший только строго меньшее расстояние: при ничьей остаётся меньший индекс.
    let nearest = d0;
    let pick = 0;
    if (d1 < nearest) {
      nearest = d1;
      pick = 1;
    }
    if (d2 < nearest) {
      nearest = d2;
      pick = 2;
    }
    if (d3 < nearest) {
      nearest = d3;
      pick = 3;
    }
    error += LOAD[i] * nearest;
    if (error >= limit) return error;
    bits |= pick << (i * 2);
  }
  BEST[SPARE] = bits;
  return error;
}

const measure = (high, low, limit) => (high === low ? measureSingle(high, limit) : measurePalette(high, low, limit));

// Новый лучший: пара концов, её ошибка и индексы, посчитанные последней проверкой.
const promote = (error, high, low) => {
  BEST[ERR] = error;
  BEST[HI] = high;
  BEST[LO] = low;
  BEST[BITS] = BEST[SPARE];
};

// Кандидат в соревновании: большее число — конец 0, меньшее — конец 1; побеждает строго меньшая ошибка.
function offer(a, b) {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  for (let t = 0; t < triedCount; t++) if (TRIED[t * 2] === high && TRIED[t * 2 + 1] === low) return;
  TRIED[triedCount * 2] = high;
  TRIED[triedCount * 2 + 1] = low;
  triedCount += 1;
  const error = measure(high, low, BEST[ERR]);
  if (error < BEST[ERR]) promote(error, high, low);
}

// Код канала c для цели «точка палитры на трети пути»: старший (shift 0) или младший (shift 1) конец пары.
const matchCode = (c, shift) => MATCH[c][snap(MEAN[c]) * 2 + shift] << SHIFT[c];

// Первый кандидат: пара кодов, чья треть-точка палитры ближе всего к среднему цвету.
function offerMean() {
  offer(matchCode(0, 0) | matchCode(1, 0) | matchCode(2, 0), matchCode(0, 1) | matchCode(1, 1) | matchCode(2, 1));
}

// Цвет на расстоянии t от среднего вдоль оси, переведённый в ближайший код.
function codeAlongAxis(t) {
  for (let c = 0; c < CHANNELS; c++) TRIAL[c] = MEAN[c] + (AXIS[c] * t) / STRETCH[c];
  return nearestCode(TRIAL);
}

// Строка матрицы (m0, m1, m2) на вектор (v0, v1, v2).
const rowDot = (m0, m1, m2, v0, v1, v2) => m0 * v0 + m1 * v1 + m2 * v2;
const mag = Math.abs;
const peak = (a, b, c) => Math.max(mag(a), mag(b), mag(c));

// Кандидат по главной оси цветов блока (степенной метод на ковариации в растянутом пространстве).
function offerAxis(floor) {
  const mean0 = MEAN[0];
  let sxx = 0;
  let sxy = 0;
  const mean1 = MEAN[1];
  let sxz = 0;
  let syy = 0;
  const mean2 = MEAN[2];
  let syz = 0;
  let szz = 0;
  for (let i = 0; i < POINTS; i++) {
    const x = (SAMPLE[i * 3] - mean0) * STRETCH[0];
    const y = (SAMPLE[i * 3 + 1] - mean1) * STRETCH[1];
    const z = (SAMPLE[i * 3 + 2] - mean2) * STRETCH[2];
    DEV[i * 3] = x;
    DEV[i * 3 + 1] = y;
    DEV[i * 3 + 2] = z;
    const wx = LOAD[i] * x;
    const wy = LOAD[i] * y;
    const wz = LOAD[i] * z;
    szz = szz + wz * z;
    syz = syz + wy * z;
    sxz = sxz + wx * z;
    syy = syy + wy * y;
    sxy = sxy + wx * y;
    sxx = sxx + wx * x;
  }
  // Начальный вектор — столбец матрицы с наибольшей диагональю (при равенстве — первый).
  const lead = sxx >= syy && sxx >= szz ? 0 : syy >= szz ? 1 : 2;
  let v0 = lead === 0 ? sxx : lead === 1 ? sxy : sxz;
  let v1 = lead === 0 ? sxy : lead === 1 ? syy : syz;
  let v2 = lead === 0 ? sxz : lead === 1 ? syz : szz;
  for (let step = 0; step < 6; step++) {
    const n0 = rowDot(sxx, sxy, sxz, v0, v1, v2);
    const n1 = rowDot(sxy, syy, syz, v0, v1, v2);
    const n2 = rowDot(sxz, syz, szz, v0, v1, v2);
    const norm = peak(n0, n1, n2);
    if (norm > 1e-12) {
      v0 = n0 / norm;
      v1 = n1 / norm;
      v2 = n2 / norm;
    } else break;
  }
  const length = Math.hypot(v0, v1, v2);
  if (!(length > 1e-12)) return;
  AXIS[0] = v0 / length;
  AXIS[1] = v1 / length;
  AXIS[2] = v2 / length;
  let bottom = Infinity;
  let top = -Infinity;
  for (let pass = 0; pass < 2 && bottom === Infinity; pass++) {
    const need = pass === 0 ? floor : 0;
    for (let i = 0; i < POINTS; i++) {
      if (!(LOAD[i] >= need)) continue;
      const along = rowDot(DEV[i * 3], DEV[i * 3 + 1], DEV[i * 3 + 2], AXIS[0], AXIS[1], AXIS[2]);
      bottom = Math.min(bottom, along);
      top = Math.max(top, along);
    }
  }
  offer(codeAlongAxis(top), codeAlongAxis(bottom));
}

// Уточнение концов наименьшими квадратами по индексам лучшего кандидата (до двух раз).
function refineEnds() {
  let gained = true;
  for (let round = 0; round < 2 && BEST[ERR] > 0 && gained; round++) {
    const before = BEST[ERR];
    const indices = BEST[BITS];
    let nearR = 0;
    let nearG = 0;
    let nearB = 0;
    const share = SHARE;
    let farR = 0;
    let farG = 0;
    let farB = 0;
    const load = LOAD;
    let near2 = 0;
    let cross = 0;
    let far2 = 0;
    const sample = SAMPLE;
    for (let i = 0; i < POINTS; i++) {
      const o = i * 3;
      const t = share[(indices >>> (i * 2)) & 3];
      const wNear = load[i] * (1 - t);
      const wFar = load[i] * t;
      nearR = nearR + wNear * sample[o];
      farR = farR + wFar * sample[o];
      nearG = nearG + wNear * sample[o + 1];
      farG = farG + wFar * sample[o + 1];
      nearB = nearB + wNear * sample[o + 2];
      farB = farB + wFar * sample[o + 2];
      near2 = near2 + wNear * (1 - t);
      cross = cross + wNear * t;
      far2 = far2 + wFar * t;
    }
    const det = near2 * far2 - cross * cross;
    if (1e-9 > Math.abs(det)) break;
    TRIAL[0] = (nearR * far2 - farR * cross) / det;
    TRIAL[1] = (nearG * far2 - farG * cross) / det;
    TRIAL[2] = (nearB * far2 - farB * cross) / det;
    TRIAL_B[0] = (farR * near2 - nearR * cross) / det;
    TRIAL_B[1] = (farG * near2 - nearG * cross) / det;
    TRIAL_B[2] = (farB * near2 - nearB * cross) / det;
    offer(nearestCode(TRIAL), nearestCode(TRIAL_B));
    gained = BEST[ERR] < before;
  }
}

// «Ровный блок»: цвета всех точек равны цвету точки 0 (альфа не смотрится).
const isFlat = (block) => {
  for (let p = 4; p < BLOCK_LEN; p += 4) if (block[p] !== block[0] || block[p + 1] !== block[1] || block[p + 2] !== block[2]) return false;
  return true;
};

// Точки блока в SAMPLE и LOAD, средний цвет в MEAN (суммы по точкам в порядке номеров).
function gatherSamples(block, weighted) {
  let mass = 0;
  for (let i = 0; i < POINTS; i++) {
    LOAD[i] = weighted ? ALPHA_WEIGHT[block[i * 4 + 3]] : 1;
    mass += LOAD[i];
    SAMPLE[i * 3] = block[i * 4];
    SAMPLE[i * 3 + 1] = block[i * 4 + 1];
    SAMPLE[i * 3 + 2] = block[i * 4 + 2];
  }
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0; i < POINTS; i++) {
    red += LOAD[i] * SAMPLE[i * 3];
    green += LOAD[i] * SAMPLE[i * 3 + 1];
    blue += LOAD[i] * SAMPLE[i * 3 + 2];
  }
  MEAN[0] = red / mass;
  MEAN[1] = green / mass;
  MEAN[2] = blue / mass;
}

// Цветовой блок BC1: два слова (концы, индексы) — в WORDS[at] и WORDS[at + 1].
function fitColors(block, weighted, at) {
  gatherSamples(block, weighted);
  BEST[ERR] = Infinity;
  BEST[HI] = -1;
  BEST[LO] = -1;
  triedCount = 0;
  offerMean();
  if (BEST[ERR] > 0 && !isFlat(block)) {
    offerAxis(weighted ? FIRM_WEIGHT : 0);
    refineEnds();
  }
  WORDS[at] = BEST[HI] | (BEST[LO] << 16);
  WORDS[at + 1] = BEST[BITS];
}

// Альфа-блок BC3: два слова (max и min, затем 48 бит индексов по 3 бита на точку).
function fitAlpha(block) {
  let top = block[3];
  let bottom = top;
  for (let i = 1; i < POINTS; i++) {
    const alpha = block[i * 4 + 3];
    if (alpha > top) top = alpha;
    if (alpha < bottom) bottom = alpha;
  }
  const range = top - bottom;
  LANES[0] = 0;
  LANES[1] = 0;
  for (let i = 0; range > 0 && i < POINTS; i++) {
    const rise = block[i * 4 + 3] - bottom;
    LANES[i >> 3] |= STEP_CODE[Math.round((rise * 7) / range)] << ((i & 7) * 3);
  }
  WORDS[0] = top | (bottom << 8) | ((LANES[0] & 0xffff) << 16);
  WORDS[1] = (LANES[0] >>> 16) | (LANES[1] << 8);
}

// 16-битный код цвета точки i усечением каналов до 5-6-5 (без округления).
const cutCode = (block, i) =>
  ((block[i * 4] >> CUT[0]) << SHIFT[0]) | ((block[i * 4 + 1] >> CUT[1]) << SHIFT[1]) | (block[i * 4 + 2] >> CUT[2]);

// Квадрат расстояния между цветами (целые и половинки — порядок сложения не важен).
const sqGap = (r, g, b, pr, pg, pb) => (r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);

// Середина отрезка по значениям одного канала.
const halfSum = (start, end) => start * 0.5 + end * 0.5;

// Блок BC1 с прозрачной точкой: концы по самой длинной оси видимых точек, индекс 3 — прозрачная.
function fitCutout(block) {
  let seen = 0;
  for (let i = 0; i < POINTS; i++) if (block[i * 4 + 3] >= CUTOUT_ALPHA) SEEN[seen++] = i;
  if (seen === 0) {
    WORDS[0] = 0;
    WORDS[1] = -1;
    return;
  }
  let axis = 0;
  let widest = -1;
  for (let c = 0; c < CHANNELS; c++) {
    let lo = 255;
    let hi = 0;
    for (let k = 0; k < seen; k++) {
      const v = block[SEEN[k] * 4 + c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > widest) {
      widest = hi - lo;
      axis = c;
    }
  }
  let first = SEEN[0];
  let last = SEEN[0];
  for (let k = 1; k < seen; k++) {
    const along = block[SEEN[k] * 4 + axis];
    if (along < block[first * 4 + axis]) first = SEEN[k];
    if (along > block[last * 4 + axis]) last = SEEN[k];
  }
  let end0 = cutCode(block, first);
  let end1 = cutCode(block, last);
  if (end0 > end1) {
    const swapCode = end0;
    end0 = end1;
    end1 = swapCode;
    const swapAt = first;
    first = last;
    last = swapAt;
  }
  // Цвета начала и конца отрезка и его середина (по полным цветам точек, не по усечённым кодам).
  const sr = block[first * 4];
  const er = block[last * 4];
  const mr = halfSum(sr, er);
  const sg = block[first * 4 + 1];
  const eg = block[last * 4 + 1];
  const mg = halfSum(sg, eg);
  const sb = block[first * 4 + 2];
  const eb = block[last * 4 + 2];
  const mb = halfSum(sb, eb);
  let bits = 0;
  for (let i = 0; i < POINTS; i++) {
    let pick = 3;
    if (block[i * 4 + 3] >= CUTOUT_ALPHA) {
      const o = i * 4;
      const r = block[o];
      const g = block[o + 1];
      const b = block[o + 2];
      let best = sqGap(r, g, b, sr, sg, sb);
      pick = 0;
      const toEnd = sqGap(r, g, b, er, eg, eb);
      if (toEnd < best) {
        best = toEnd;
        pick = 1;
      }
      if (sqGap(r, g, b, mr, mg, mb) < best) pick = 2;
    }
    bits |= pick << (i * 2);
  }
  WORDS[0] = end0 | (end1 << 16);
  WORDS[1] = bits;
}

const hasCutout = (block) => {
  for (let i = 0; i < POINTS; i++) if (block[i * 4 + 3] < CUTOUT_ALPHA) return true;
  return false;
};

// Кодировщики блока: пишут слова в WORDS и возвращают их число.
const codeSolid = (block) => {
  fitColors(block, false, 0);
  return 2;
};
const codeCutout = (block) => {
  if (!hasCutout(block)) return codeSolid(block);
  fitCutout(block);
  return 2;
};
const codeAlpha = (block) => {
  fitAlpha(block);
  fitColors(block, true, 2);
  return 4;
};
// Режим определяется самим значением формата (не его приведением к строке).
const BLOCK_CODERS = new Map([
  ["bc1a", codeCutout],
  ["bc3", codeAlpha],
]);

const isByteArray = (pixels) => pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray;

// Блок 4×4 из картинки; край повторяется. Числа приводятся к байту присваиванием в Uint8Array.
function loadBlock(slot, pixels, wordsOf, width, height, blockX, blockY, whole) {
  const into = SLOTS[slot];
  if (whole && blockX * 4 + 3 < width && blockY * 4 + 3 < height) {
    // Целые размеры и блок целиком внутри картинки: четыре строки по 4 точки подряд.
    if (wordsOf) {
      // Байтовый массив с выравниванием: точка — одно 32-битное слово.
      const target = SLOT_WORDS[slot];
      for (let y = 0; y < 4; y++) {
        const at = (blockY * 4 + y) * width + blockX * 4;
        for (let x = 0; x < 4; x++) target[y * 4 + x] = wordsOf[at + x];
      }
      return;
    }
    const origin = (blockY * 4 * width + blockX * 4) * 4;
    for (let y = 0; y < 4; y++) {
      const from = origin + y * width * 4;
      for (let k = 0; k < 16; k++) into[y * 16 + k] = pixels[from + k];
    }
    return;
  }
  let row = 0;
  for (let n = 0; n < 16; n++) {
    if ((n & 3) === 0) row = Math.min(height - 1, blockY * 4 + (n >> 2)) * width;
    const o = (row + Math.min(width - 1, blockX * 4 + (n & 3))) * 4;
    for (let c = 0; c < 4; c++) into[n * 4 + c] = pixels[o + c];
  }
}

// Точки байтового массива как 32-битные слова (если выравнивание и длина позволяют), иначе null.
const wordsOfPixels = (pixels) =>
  isByteArray(pixels) && pixels.length % 4 === 0 && pixels.byteOffset % 4 === 0
    ? new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length >> 2)
    : null;

const differs = (a, b) => {
  for (let i = 15; i >= 0; i--) if (a[i] !== b[i]) return true;
  return false;
};

const unknownFormat = (format) => {
  throw new Error(`Неизвестный формат сжатия: ${format}`);
};
const blocksAcross = (size) => Math.max(1, Math.ceil(size / 4));

export function compressLevel(pixels, width, height, format = "bc1") {
  const spec = FORMATS[format] ?? unknownFormat(format);
  const cols = blocksAcross(width);
  const total = cols * blocksAcross(height);
  const out = new Uint8Array(total * spec.bytes);
  const sink = new DataView(out.buffer);
  const code = BLOCK_CODERS.get(format) ?? codeSolid;
  const whole = Number.isInteger(width) && Number.isInteger(height);
  const wordsOf = wordsOfPixels(pixels);
  let slot = 0;
  let wordCount = 0;
  for (let n = 0, blockX = 0, blockY = 0; n < total; n++) {
    loadBlock(slot, pixels, wordsOf, width, height, blockX, blockY, whole);
    // Блок, побайтно равный предыдущему закодированному, берёт его выход без пересчёта.
    if (n === 0 || differs(SLOT_WORDS[slot], SLOT_WORDS[slot ^ 1])) {
      wordCount = code(SLOTS[slot]);
      slot ^= 1;
    }
    for (let w = 0; w < wordCount; w++) sink.setInt32(n * spec.bytes + w * 4, WORDS[w], true);
    if (++blockX === cols) {
      blockX = 0;
      blockY += 1;
    }
  }
  return out;
}

export function mipChain(pixels, width, height) {
  const chain = [];
  for (let level = { pixels, width, height }; ; level = downsample(level.pixels, level.width, level.height)) {
    chain.push(level);
    if (!(level.width > 1 || level.height > 1)) return chain;
  }
}

const halve = (size) => Math.max(1, size >> 1);
const tapAt = (row, col) => (row + col) * 4;
const alphaAt = (pixels, offset) => pixels[offset + 3];

// Канал ch четырёх исходных точек (смещения p, q, r, s), умноженный на их альфы (wp, wq, wr, ws); сумма слева направо.
const weightedSum = (pixels, ch, p, q, r, s, wp, wq, wr, ws) =>
  pixels[p + ch] * wp + pixels[q + ch] * wq + pixels[r + ch] * wr + pixels[s + ch] * ws;

export function downsample(pixels, width, height) {
  const outW = halve(width);
  const outH = halve(height);
  const out = new Uint8ClampedArray(outW * outH * 4);
  let at = 0;
  for (let y = 0; y < outH; y++) {
    const upper = Math.min(height - 1, 2 * y) * width;
    const lower = Math.min(height - 1, 2 * y + 1) * width;
    for (let x = 0; x < outW; x++, at += 4) {
      // Точки: верх-лево, верх-право, низ-лево, низ-право.
      const left = Math.min(width - 1, 2 * x);
      const right = Math.min(width - 1, 2 * x + 1);
      const p = tapAt(upper, left);
      const q = tapAt(upper, right);
      const r = tapAt(lower, left);
      const s = tapAt(lower, right);
      const wp = alphaAt(pixels, p);
      const wq = alphaAt(pixels, q);
      const wr = alphaAt(pixels, r);
      const ws = alphaAt(pixels, s);
      const alpha = wp + wq + wr + ws;
      out[at + 3] = alpha / 4;
      if (alpha > 0) {
        out[at] = weightedSum(pixels, 0, p, q, r, s, wp, wq, wr, ws) / alpha;
        out[at + 1] = weightedSum(pixels, 1, p, q, r, s, wp, wq, wr, ws) / alpha;
        out[at + 2] = weightedSum(pixels, 2, p, q, r, s, wp, wq, wr, ws) / alpha;
      }
    }
  }
  return { pixels: out, width: outW, height: outH };
}

// Подмешивание цвета ближайших видимых соседей под прозрачные точки (две волны); массив меняется на месте.
// Стадия точки: 0 — пусто (прозрачна, ещё не заполнена), 1 — видима, 1 + n — заполнена в волне n.
const NEAR = i32(4);

// Точка со стадией stage уже видима к волне wave (у номера за краем массива стадии нет — не видима).
const ready = (stage, wave) => stage > 0 && stage <= wave;

// Соседи точки i (слева, справа, сверху, снизу), уже видимые к волне wave: индексы в NEAR, возвращает их число.
function visibleNeighbours(stage, i, width, count, wave) {
  const x = i % width;
  let found = 0;
  if (x > 0 && ready(stage[i - 1], wave)) NEAR[found++] = i - 1;
  if (x < width - 1 && ready(stage[i + 1], wave)) NEAR[found++] = i + 1;
  if (i >= width && ready(stage[i - width], wave)) NEAR[found++] = i - width;
  if (i < count - width && ready(stage[i + width], wave)) NEAR[found++] = i + width;
  return found;
}

// Среднее значение канала c у первых found соседей из NEAR.
function neighbourMean(pixels, c, found) {
  let sum = 0;
  for (let m = 0; m < found; m++) sum += pixels[NEAR[m] * 4 + c];
  return sum / found;
}

// Стадии точек по альфе: видима — альфа «истинна» в смысле JavaScript (не 0, NaN, undefined, null, пустая строка).
// Число точек count берётся как есть (может быть дробным), прозрачные считаются по значению альфы; их число — в hiddenCount.
let hiddenCount = 0;
function classify(pixels, count) {
  const stage = new Uint8Array(count);
  hiddenCount = 0;
  for (let i = 0; i < count; i++) {
    if (pixels[i * 4 + 3]) stage[i] = 1;
    else hiddenCount += 1;
  }
  return stage;
}

function bleedColor(pixels, width, height) {
  const count = width * height;
  const stage = classify(pixels, count);
  if (!hiddenCount || hiddenCount === count) return;
  for (let wave = 1; wave <= 2; wave++) {
    for (let i = 0; i < count; i++) {
      if (stage[i]) continue;
      const found = visibleNeighbours(stage, i, width, count, wave);
      if (found === 0) continue;
      for (let c = 0; c < CHANNELS; c++) pixels[i * 4 + c] = neighbourMean(pixels, c, found);
      stage[i] = wave + 1;
    }
  }
}

const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
// Байт точки в несжатом файле (B, G, R, A) ← номер числа в исходной точке.
const SWAP = [2, 1, 0, 3];

// Несжатый уровень: B, G, R, A на точку; размер — длина самого массива.
function packRgba8(pixels) {
  const out = new Uint8Array(pixels.length);
  if (LITTLE_ENDIAN && isByteArray(pixels) && pixels.length % 4 === 0 && pixels.byteOffset % 4 === 0) {
    const from = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length >> 2);
    const into = new Uint32Array(out.buffer);
    // Слова независимы, порядок обхода не важен.
    for (let i = from.length; i-- > 0; ) {
      into[i] = (from[i] & 0xff00ff00) | ((from[i] & 0xff) << 16) | ((from[i] >>> 16) & 0xff);
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] = pixels[i - (i & 3) + SWAP[i & 3]];
  return out;
}

// Уровень → байты: для каждого формата свой упаковщик (bc3 и bc1a сначала подмешивают цвет).
const bleedThenCompress = (format) => (level) => {
  bleedColor(level.pixels, level.width, level.height);
  return compressLevel(level.pixels, level.width, level.height, format);
};
const LEVEL_PACKERS = {
  rgba8: (level) => packRgba8(level.pixels),
  bc1: (level) => compressLevel(level.pixels, level.width, level.height, "bc1"),
  bc1a: bleedThenCompress("bc1a"),
  bc3: bleedThenCompress("bc3"),
};
const EXPLICIT_FORMATS = ["bc3", "bc1a", "rgba8"];
// Маски A8R8G8B8 по порядку R, G, B, A.
const RGBA8_MASKS = [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];

// Поля заголовка: пары (смещение, значение), все 32-битные.
function headerFields(format, levelCount, width, height, topBytes) {
  const raw = format === "rgba8";
  const chained = levelCount > 1;
  const fields = [
    [0, MAGIC],
    [4, 124],
    [8, (raw ? 0x100f : 0x81007) | (chained ? 0x20000 : 0)],
    [12, height],
    [16, width],
    [20, raw ? width * 4 : topBytes],
    [28, levelCount],
    [76, 32],
    [80, raw ? 0x41 : 4],
    [108, chained ? 0x401008 : 0x1000],
  ];
  if (raw) fields.push([88, 32], ...RGBA8_MASKS.map((mask, k) => [92 + k * 4, mask]));
  else fields.push([84, FORMATS[format].fourcc]);
  return fields;
}

export function encodeDds(pixels, width, height, options = {}) {
  const format = EXPLICIT_FORMATS.includes(options.format) ? options.format : "bc1";
  const levels = [{ pixels, width, height }];
  if (options.mipmaps !== false) levels.splice(0, 1, ...mipChain(pixels, width, height));
  const parts = levels.map(LEVEL_PACKERS[format]);
  const file = new Uint8Array(parts.reduce((size, part) => size + part.length, HEADER));
  const view = new DataView(file.buffer);
  for (const [offset, value] of headerFields(format, levels.length, width, height, parts[0].length)) {
    view.setUint32(offset, value, true);
  }
  parts.reduce((at, part) => {
    file.set(part, at);
    return at + part.length;
  }, HEADER);
  return file;
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const word = (view, offset) => view.getUint32(offset, true);
// Два бита с номером i из 32-битных индексов.
const twoBits = (indices, i) => (indices >>> (i * 2)) & 3;
const slotAt = (px, py, width) => (py * width + px) * 4;
const half = (view, offset) => view.getUint16(offset, true);
// 24 бита (три байта) младшим вперёд.
const lane = (view, at) => view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);

// Несжатый файл A8R8G8B8: B, G, R, A на точку → R, G, B, A.
function decodeRaw(view, width, height, hasAlpha) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (i & 3) === 3 && !hasAlpha ? 255 : view.getUint8(HEADER + i - (i & 3) + SWAP[i & 3]);
  }
  return { width, height, format: "rgba8", pixels };
}

// Палитра альфы bc3 по двум крайним значениям (8 значений либо 6 + 0 и 255).
function alphaRamp(a0, a1) {
  const parts = a0 > a1 ? 7 : 5;
  const ramp = [a0, a1];
  for (let k = 1; k < parts; k++) ramp.push(Math.round(((parts - k) * a0 + k * a1) / parts));
  return parts === 5 ? ramp.concat([0, 255]) : ramp;
}

// Палитра цветового блока: 4 цвета по (R, G, B); трёхцветный режим bc1 (color0 <= color1) даёт третий цвет — среднее.
function colorPalette(color0, color1, three) {
  const palette = [];
  for (let c = 0; c < CHANNELS; c++) {
    const a = channel(color0, c);
    const b = channel(color1, c);
    palette[c] = a;
    palette[3 + c] = b;
    palette[6 + c] = three ? Math.round((a + b) / 2) : blend(a, b, 1);
    palette[9 + c] = blend(b, a, 1);
  }
  return palette;
}

function decodeBlocks(view, width, height, isBc3) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const cols = Math.ceil(width / 4);
  const total = cols * Math.ceil(height / 4);
  for (let n = 0; n < total; n++) {
    const blockX = n % cols;
    const blockY = (n - blockX) / cols;
    const at = HEADER + n * (isBc3 ? 16 : 8);
    const body = isBc3 ? at + 8 : at;
    const color0 = half(view, body);
    const color1 = half(view, body + 2);
    const indices = word(view, body + 4);
    const three = !isBc3 && color0 <= color1;
    const palette = colorPalette(color0, color1, three);
    let ramp = null;
    if (isBc3) {
      ramp = alphaRamp(view.getUint8(at), view.getUint8(at + 1));
      LANES[0] = lane(view, at + 2);
      LANES[1] = lane(view, at + 5);
    }
    for (let i = 0; i < POINTS; i++) {
      const px = blockX * 4 + (i & 3);
      const py = blockY * 4 + (i >> 2);
      if (px >= width || py >= height) continue;
      const pick = twoBits(indices, i);
      const to = slotAt(px, py, width);
      if (three && pick === 3) pixels.fill(0, to, to + 4);
      else {
        for (let c = 0; c < CHANNELS; c++) pixels[to + c] = palette[pick * 3 + c];
        if (ramp) pixels[to + 3] = ramp[(LANES[i >> 3] >> ((i & 7) * 3)) & 7];
      }
    }
  }
  return { pixels, width, height, format: isBc3 ? "bc3" : "bc1" };
}

export function decodeDds(bytes) {
  const view = viewOf(bytes);
  if (word(view, 0) !== MAGIC) throw new Error("Это не DDS.");
  const height = word(view, 12);
  const width = word(view, 16);
  const flags = word(view, 80);
  if ((flags & 0x40) !== 0 && word(view, 88) === 32 && word(view, 92) === RGBA8_MASKS[0]) {
    return decodeRaw(view, width, height, (flags & 0x1) !== 0);
  }
  const fourcc = word(view, 84);
  const isBc3 = fourcc === FORMATS.bc3.fourcc;
  if (!isBc3 && fourcc !== FORMATS.bc1.fourcc) throw new Error("Поддерживаются только BC1, BC3 и A8R8G8B8.");
  return decodeBlocks(view, width, height, isBc3);
}
