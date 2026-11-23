/*
 * Готовые текстуры большой карты — процедурные и бесшовные.
 *
 * Раппорт повторяется по штату без стыков, а в поставке нет ни одной чужой
 * картинки: всё считается из детерминированного шума, поэтому текстура
 * одинакова в окне редактора, в плитках для игры и в тесте.
 */

import { clamp01 } from "./color.js";

/* ------------------------------------------------------------------------ */
/* Текстуры                                                                  */
/* ------------------------------------------------------------------------ */

/*
 * Готовые текстуры карты.
 *
 * Все — процедурные и бесшовные: раппорт повторяется по штату без стыков, а
 * в поставке нет ни одной чужой картинки. `relief` — серая фактура вокруг
 * середины яркости: с «контрастным» и «мягким» наложением она даёт рельеф, не
 * меняя общей яркости карты. `lines` — рисунок линиями на прозрачном: его
 * красят своим цветом и кладут обычным наложением или осветлением.
 */
export const MAP_TEXTURES = Object.freeze([
  Object.freeze({
    id: "paper",
    label: "Бумага",
    kind: "relief",
    blend: "multiply",
    opacity: 70,
    scale: 4,
  }),
  Object.freeze({
    id: "grain",
    label: "Зерно",
    kind: "relief",
    blend: "overlay",
    opacity: 55,
    scale: 6,
  }),
  Object.freeze({
    id: "canvas",
    label: "Холст",
    kind: "relief",
    blend: "overlay",
    opacity: 60,
    scale: 10,
  }),
  Object.freeze({
    id: "carbon",
    label: "Карбон",
    kind: "relief",
    blend: "overlay",
    opacity: 65,
    scale: 24,
  }),
  Object.freeze({
    id: "concrete",
    label: "Бетон",
    kind: "relief",
    blend: "soft-light",
    opacity: 80,
    scale: 4,
  }),
  Object.freeze({
    id: "camo",
    label: "Камуфляж",
    kind: "relief",
    blend: "soft-light",
    opacity: 70,
    scale: 4,
  }),
  Object.freeze({
    id: "hillshade",
    label: "Рельеф",
    kind: "relief",
    blend: "overlay",
    opacity: 60,
    scale: 3,
  }),
  Object.freeze({
    id: "marble",
    label: "Мрамор",
    kind: "relief",
    blend: "soft-light",
    opacity: 75,
    scale: 3,
  }),
  Object.freeze({
    id: "brushed",
    label: "Металл",
    kind: "relief",
    blend: "overlay",
    opacity: 50,
    scale: 6,
  }),
  Object.freeze({
    id: "leather",
    label: "Кожа",
    kind: "relief",
    blend: "overlay",
    opacity: 55,
    scale: 12,
  }),
  Object.freeze({
    id: "topo",
    label: "Изолинии",
    kind: "lines",
    blend: "screen",
    opacity: 35,
    scale: 4,
  }),
  Object.freeze({
    id: "grid",
    label: "Сетка",
    kind: "lines",
    blend: "screen",
    opacity: 30,
    scale: 8,
  }),
  Object.freeze({
    id: "hex",
    label: "Соты",
    kind: "lines",
    blend: "screen",
    opacity: 30,
    scale: 10,
  }),
  Object.freeze({
    id: "dots",
    label: "Точки",
    kind: "lines",
    blend: "screen",
    opacity: 35,
    scale: 16,
  }),
  Object.freeze({
    id: "scanlines",
    label: "Строки",
    kind: "lines",
    blend: "multiply",
    opacity: 40,
    scale: 12,
  }),
  Object.freeze({
    id: "hatch",
    label: "Штрих",
    kind: "lines",
    blend: "screen",
    opacity: 22,
    scale: 12,
  }),
  Object.freeze({
    id: "diamonds",
    label: "Ромбы",
    kind: "lines",
    blend: "screen",
    opacity: 26,
    scale: 10,
  }),
  Object.freeze({
    id: "waves",
    label: "Волны",
    kind: "lines",
    blend: "screen",
    opacity: 28,
    scale: 8,
  }),
]);

export const MAP_TEXTURE_MAP = Object.freeze(
  Object.fromEntries(MAP_TEXTURES.map((item) => [item.id, item])),
);

/** Сторона готовой текстуры: раппорт один к одному ложится на плитку игры. */
export const MAP_TEXTURE_SIDE = 512;

/* Детерминированный шум: одна и та же текстура в окне, в экспорте и в тесте. */
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Значение шума с периодом `period` узлов: края раппорта сходятся. */
function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (value) => ((value % period) + period) % period;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Фрактальный шум 0..1, бесшовный на раппорте. */
function fbm(u, v, basePeriod, octaves, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum +=
      valueNoise(u * period, v * period, period, seed + octave) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

const RELIEF = Object.freeze({
  paper: (u, v) => {
    const fibre = fbm(u * 1, v * 4, 8, 4, 11);
    const blotch = fbm(u, v, 3, 3, 17);
    const speck = hash2(Math.floor(u * 512), Math.floor(v * 512), 23);
    return (
      0.72 + (fibre - 0.5) * 0.3 + (blotch - 0.5) * 0.22 + (speck - 0.5) * 0.1
    );
  },
  grain: (u, v) => {
    const fine = hash2(Math.floor(u * 512), Math.floor(v * 512), 31);
    const soft = fbm(u, v, 64, 2, 37);
    return 0.5 + (fine - 0.5) * 0.55 + (soft - 0.5) * 0.35;
  },
  canvas: (u, v) => {
    const threads = 64;
    const warp = Math.sin(u * threads * Math.PI * 2);
    const weft = Math.sin(v * threads * Math.PI * 2);
    const noise = fbm(u, v, 32, 2, 41);
    return 0.5 + warp * weft * 0.28 + (noise - 0.5) * 0.2;
  },
  carbon: (u, v) => {
    const cells = 8;
    const cx = Math.floor(u * cells);
    const cy = Math.floor(v * cells);
    const fx = u * cells - cx;
    const fy = v * cells - cy;
    /* Шахматка из косых градиентов — плетение углеволокна. */
    const twill = (cx + cy) % 2 === 0 ? fx : fy;
    const ridge = Math.abs(((twill * 4) % 1) - 0.5) * 2;
    return 0.3 + ridge * 0.4;
  },
  concrete: (u, v) => {
    const blotch = fbm(u, v, 4, 5, 53);
    const pit = hash2(Math.floor(u * 256), Math.floor(v * 256), 59);
    return 0.5 + (blotch - 0.5) * 0.7 - (pit > 0.965 ? 0.22 : 0);
  },
  camo: (u, v) => {
    const value = fbm(u, v, 3, 3, 61);
    const other = fbm(u, v, 5, 2, 67);
    if (value > 0.58) return 0.74;
    if (other > 0.56) return 0.28;
    return 0.5;
  },
  hillshade: (u, v) => {
    /*
     * Отмывка рельефа: шум считается высотой, а свет падает с северо-запада,
     * как на бумажных картах. Шаг производной задан в долях раппорта, а не в
     * точках: рельеф один и тот же на любой стороне текстуры.
     */
    const step = 1 / 256;
    const east = fbm(u + step, v, 3, 4, 83) - fbm(u - step, v, 3, 4, 83);
    const south = fbm(u, v + step, 3, 4, 83) - fbm(u, v - step, 3, 4, 83);
    return 0.5 + (east + south) * 5.5;
  },
  marble: (u, v) => {
    const warp = fbm(u, v, 4, 4, 89);
    const vein = Math.abs(Math.sin((u * 3 + warp * 2.4) * Math.PI * 2));
    const cloud = fbm(u, v, 6, 3, 97);
    return 0.34 + Math.pow(vein, 0.35) * 0.36 + (cloud - 0.5) * 0.18;
  },
  brushed: (u, v) => {
    /* Строка — независимая случайная полоса, плавная вдоль хода шлифовки. */
    const row = Math.floor(v * 512);
    const period = 6;
    const x = u * period;
    const x0 = Math.floor(x);
    const from = hash2(x0 % period, row, 101);
    const to = hash2((x0 + 1) % period, row, 101);
    const streak = from + (to - from) * smooth(x - x0);
    const fine = hash2(Math.floor(u * 512), row, 103);
    return 0.5 + (streak - 0.5) * 0.5 + (fine - 0.5) * 0.12;
  },
  leather: (u, v) => {
    /* Ячеистый шум: складки лежат там, где до двух ближайших точек одинаково
       далеко. Решётка заворачивается — раппорт бесшовный. */
    const cells = 10;
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let nearest = Infinity;
    let second = Infinity;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const gx = (((cx + dx) % cells) + cells) % cells;
        const gy = (((cy + dy) % cells) + cells) % cells;
        const px = cx + dx + hash2(gx, gy, 107);
        const py = cy + dy + hash2(gx, gy, 109);
        const gap = Math.hypot(px - x, py - y);
        if (gap < nearest) {
          second = nearest;
          nearest = gap;
        } else if (gap < second) second = gap;
      }
    }
    const crease = clamp01((second - nearest) / 0.22);
    const pore = hash2(Math.floor(u * 512), Math.floor(v * 512), 113);
    return 0.3 + smooth(crease) * 0.4 + (pore - 0.5) * 0.08;
  },
});

/*
 * Линия рисунка: `distanceToLine` — в точках текстуры, `halfWidth` — в точках
 * стороны 512, для которой толщины и подобраны.
 *
 * Текстура побольше нужна плиткам побольше, и линия обязана занимать на карте
 * то же место, а не истончаться вчетверо: полуширина растёт вместе со стороной
 * (`unit`). Кромка сглаживания при этом остаётся в три четверти точки — за
 * этим большая сторона и берётся. Растёт именно видимая полуширина — середина
 * кромки, — иначе постоянная кромка съедала бы у крупной линии пятую часть
 * толщины. На стороне 512 формула даёт ровно прежний рисунок.
 */
const EDGE = 0.75;
const line = (distanceToLine, halfWidth, unit = 1) =>
  clamp01(0.5 - (distanceToLine - (halfWidth + EDGE / 2) * unit) / EDGE);

const unitOf = (side) => Math.max(1, side / MAP_TEXTURE_SIDE);

const nearPeriod = (value, period) => {
  const offset = ((value % period) + period) % period;
  return Math.min(offset, period - offset);
};

const LINES = Object.freeze({
  topo: (u, v, side) => {
    const height = fbm(u, v, 3, 3, 71) * 9;
    const band = height - Math.floor(height);
    /* Ширина линии в точках раппорта: градиент шума переводит долю полосы в
       расстояние до изолинии. */
    const step = 1 / side;
    const gradient =
      Math.hypot(
        fbm(u + step, v, 3, 3, 71) - fbm(u - step, v, 3, 3, 71),
        fbm(u, v + step, 3, 3, 71) - fbm(u, v - step, 3, 3, 71),
      ) *
      9 *
      0.5;
    const gap = Math.min(band, 1 - band) / Math.max(gradient, 1e-6);
    return line(gap, 0.6, unitOf(side));
  },
  grid: (u, v, side) => {
    const minor = side / 8;
    const major = side / 2;
    const unit = unitOf(side);
    const x = u * side;
    const y = v * side;
    const thin =
      line(Math.min(nearPeriod(x, minor), nearPeriod(y, minor)), 0.5, unit) *
      0.55;
    const bold = line(
      Math.min(nearPeriod(x, major), nearPeriod(y, major)),
      1.1,
      unit,
    );
    return Math.max(thin, bold);
  },
  hex: (u, v, side) => {
    /*
     * Шестиугольная решётка повторяется прямоугольником 1×√3, и в квадрат он
     * целое число раз не ложится. Семь колонок на четыре таких прямоугольника
     * расходятся с квадратом на один процент — соты остаются правильными на
     * глаз, а раппорт бесшовным.
     */
    const columns = 7;
    const rows = 4;
    const height = Math.sqrt(3);
    const x = u * columns;
    const y = v * rows * height;
    /* Ближайший центр — из двух смещённых прямоугольных решёток. */
    const ax = (x % 1) - 0.5;
    const ay = (y % height) - height / 2;
    const bx = ((x + 0.5) % 1) - 0.5;
    const by = ((y + height / 2) % height) - height / 2;
    const first = ax * ax + ay * ay < bx * bx + by * by;
    const gx = Math.abs(first ? ax : bx);
    const gy = Math.abs(first ? ay : by);
    /* Расстояние до грани шестиугольника с «шириной» в единицу. */
    const edge = 0.5 - Math.max(gx, gx * 0.5 + gy * (height / 2));
    return line((edge * side) / columns, 0.7, unitOf(side));
  },
  dots: (u, v, side) => {
    const cells = 16;
    const fx = (u * cells) % 1;
    const fy = (v * cells) % 1;
    const radius = Math.hypot(fx - 0.5, fy - 0.5) * (side / cells);
    return clamp01(1 - (radius - side / cells / 5) / 0.9);
  },
  scanlines: (u, v, side) => {
    const period = side / 64;
    const offset = (v * side) % period;
    return offset < period / 2 ? 1 : 0;
  },
  hatch: (u, v, side) => {
    /* Период делит сторону нацело — штрих сходится на стыке раппорта. */
    const period = side / 16;
    const gap = nearPeriod((u + v) * side, period) / Math.SQRT2;
    return line(gap, 0.5, unitOf(side));
  },
  diamonds: (u, v, side) => {
    const period = side / 8;
    const gap =
      Math.min(
        nearPeriod((u + v) * side, period),
        nearPeriod((u - v) * side, period),
      ) / Math.SQRT2;
    return line(gap, 0.55, unitOf(side));
  },
  waves: (u, v, side) => {
    const period = side / 12;
    const crests = 3;
    const swing = side / 40;
    const phase = u * crests * Math.PI * 2;
    /* Расстояние до синусоиды — по нормали, иначе на склонах линия толще. */
    const slope = ((swing * crests * Math.PI * 2) / side) * Math.cos(phase);
    const gap =
      nearPeriod(v * side - swing * Math.sin(phase), period) /
      Math.hypot(1, slope);
    return line(gap, 0.55, unitOf(side));
  },
});

const textureCache = new Map();

/**
 * Готовая текстура пикселями RGBA.
 *
 * Рельеф — серый и непрозрачный; линии — белые, рисунок лежит в альфе (цвет
 * им даёт `applyTextureLayer`). Считается один раз на сторону и живёт в
 * памяти: это полмегабайта на текстуру, а считать шум на каждое движение
 * ползунка — секунда.
 */
export function generateMapTexture(id, side = MAP_TEXTURE_SIDE) {
  const definition = MAP_TEXTURE_MAP[id];
  if (!definition) return null;
  const key = `${id}:${side}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const data = new Uint8ClampedArray(side * side * 4);
  const relief = RELIEF[id];
  const lines = LINES[id];
  let offset = 0;
  for (let y = 0; y < side; y += 1) {
    const v = (y + 0.5) / side;
    for (let x = 0; x < side; x += 1) {
      const u = (x + 0.5) / side;
      if (relief) {
        const value = Math.round(clamp01(relief(u, v, side)) * 255);
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
      } else {
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = Math.round(clamp01(lines(u, v, side)) * 255);
      }
      offset += 4;
    }
  }
  const texture = {
    id,
    kind: definition.kind,
    width: side,
    height: side,
    data,
  };
  textureCache.set(key, texture);
  return texture;
}
