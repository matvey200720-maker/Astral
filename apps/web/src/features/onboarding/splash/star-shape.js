/*
 * Знак Astral для заставки «Контур» (15.11.2026): контуры и разбор на точки.
 *
 * Те же кривые, что в `assets/Astral-mark.svg` и в статичном знаке окна (`apps/desktop/src/window-load.js`). Знак — две фигуры
 * из кубических кривых: четыре луча (восемь кривых, концы лучей — на границах каждой второй) и росчерк под ними. Заставка
 * обводит луч за лучом, поэтому ей нужна длина контура и точка на нём — их считает этот файл, без SVG и без холста.
 */

import {
  STAR_BOX,
  STAR_D,
  STAR_SW,
  STAR_TIPS,
  STAR_VIEWBOX,
} from "./star-glyph.js";

export { STAR_BOX, STAR_D, STAR_SW, STAR_TIPS, STAR_VIEWBOX };

const SAMPLES = 14;
const NUMBER = /-?\d+(?:\.\d+)?/g;

/** Кубические кривые пути вида «M x y C … C … Z»: начало и список по шесть чисел. */
export function parseCubics(d) {
  const [start, ...curves] = d.replace(/Z$/, "").split("C");
  const [x0, y0] = start.replace("M", "").match(NUMBER).map(Number);
  return {
    start: [x0, y0],
    curves: curves.map((curve) => curve.match(NUMBER).map(Number)),
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function cubicPoint(p0, c, t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    w[0] * p0[0] + w[1] * c[0] + w[2] * c[2] + w[3] * c[4],
    w[0] * p0[1] + w[1] * c[1] + w[2] * c[3] + w[3] * c[5],
  ];
}

/**
 * Путь точками: `xs`, `ys` и накопленная длина `at` у каждой, полная длина `total`, длина на конце каждой кривой `ends`.
 * Длина — сумма хорд (по четырнадцать на кривую): от настоящей длины SVG отличается меньше процента.
 */
export function flatten(d, samples = SAMPLES) {
  const { start, curves } = parseCubics(d);
  const xs = [start[0]];
  const ys = [start[1]];
  const at = [0];
  const ends = [];
  let from = start;
  for (const curve of curves) {
    for (let step = 1; step <= samples; step += 1) {
      const [x, y] = cubicPoint(from, curve, step / samples);
      const last = at.length - 1;
      xs.push(x);
      ys.push(y);
      at.push(at[last] + Math.hypot(x - xs[last], y - ys[last]));
    }
    ends.push(at[at.length - 1]);
    from = [curve[4], curve[5]];
  }
  return { xs, ys, at, ends, total: at[at.length - 1] };
}

/** Точка на пути на длине `length` (за пределами — крайняя). */
export function pointAt(path, length) {
  const { xs, ys, at } = path;
  const wanted = Math.min(path.total, Math.max(0, length));
  let low = 0;
  let high = at.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (at[middle] <= wanted) low = middle;
    else high = middle;
  }
  const span = at[high] - at[low] || 1;
  const share = (wanted - at[low]) / span;
  return [lerp(xs[low], xs[high], share), lerp(ys[low], ys[high], share)];
}

/** Точки пути от длины `from` до длины `to`, плоским списком `[x, y, x, y, …]`: чем рисовать кусок контура. */
export function slice(path, from, to) {
  const { xs, ys, at } = path;
  const lo = Math.max(0, from);
  const hi = Math.min(path.total, to);
  if (hi <= lo) return [];
  const out = [...pointAt(path, lo)];
  for (let i = 0; i < at.length; i += 1) {
    if (at[i] > lo && at[i] < hi) out.push(xs[i], ys[i]);
  }
  out.push(...pointAt(path, hi));
  return out;
}

let cache = null;

/** Знак, разобранный один раз: лучи, росчерк и длины на концах лучей (`marks`: 0, 2-я, 4-я, 6-я, 8-я кривая). */
export function starPaths() {
  if (!cache) {
    const body = flatten(STAR_D);
    const swoosh = flatten(STAR_SW);
    const marks = [0, body.ends[1], body.ends[3], body.ends[5], body.ends[7]];
    cache = { body, swoosh, marks };
  }
  return cache;
}

/** Длина обведённого контура, когда уровень хода равен `level` (0…1): узлы — на концах лучей, между ними — равномерно. */
export function lengthAtLevel(level, marks = starPaths().marks) {
  const scaled = Math.max(0, Math.min(1, level)) * 4;
  const index = Math.min(3, Math.floor(scaled));
  return lerp(marks[index], marks[index + 1], scaled - index);
}
