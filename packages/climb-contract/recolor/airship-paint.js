/*
 * Лист своих моделей «Дирижаблей» (ТЗ 11.10.2026, ночь, задача 3:
 * «реалистичные модели»): вместо плоских клеток цвета — нарисованные
 * кодом куски кожи, перьев, перепонок, металла и ткани.
 *
 * Лист 1024 × 1024 делится на куски `region` — прямоугольники степени
 * двойки, выровненные по своему размеру (кусок 256 px начинается на
 * кратном 256), и на клетки плоского цвета 32 × 32 в углу `cells` (зубы,
 * корзина, огни — что мелко). Развёртка куска отступает от его края на
 * несколько пикселей, а поле отступа закрашено тем же рисунком: уровни
 * мипов до куска в пиксель не тянут цвет соседа.
 *
 * Рисунок куска — чистая функция `(u, v, out)` от долей куска (u, v в
 * 0…1, тот же параметр, что у развёртки сетки): её же зовёт лист картинки
 * (`paintAirshipSkin`), когда у модели лого или своя текстура, — спина
 * дракона с лого остаётся в чешуе. Случайное — хешем от целых: одинаковый
 * вход даёт одинаковые байты.
 */

import { hexBytes } from "./colour.js";

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (value) => value - Math.floor(value);

/* ------------------------------------------------------------------ *
 * Шум
 * ------------------------------------------------------------------ */

/** Хеш двух целых и зерна → 0…1. */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x632be5ab, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Плавный шум 0…1; `period` — повтор по x (кусок замкнут по кругу: купол, оболочка). */
export function noise(x, y, seed = 0, period = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wx0 = period ? ((ix % period) + period) % period : ix;
  const wx1 = period ? (((ix + 1) % period) + period) % period : ix + 1;
  const a = hash2(wx0, iy, seed);
  const b = hash2(wx1, iy, seed);
  const c = hash2(wx0, iy + 1, seed);
  const d = hash2(wx1, iy + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

/** Сумма октав шума 0…1 (`period` — повтор по x у первой октавы, целый). */
export function fbm(x, y, seed = 0, octaves = 3, period = 0) {
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * noise(x * frequency, y * frequency, seed + octave * 101, period * frequency);
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / weight;
}

/**
 * Круглые точки (ракушки, крапины): в каждой клетке сетки — точка с
 * вероятностью `density`, своим местом и радиусом до `radius` (доля
 * клетки). Ответ — покрытие 0…1 с мягким краем. `period` — повтор по x.
 */
export function dots(x, y, seed = 0, density = 0.5, radius = 0.35, period = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let cover = 0;
  /* Точка целиком в своей клетке (сдвиг ≤ 0,3, радиус ≤ 0,2) — соседей не смотреть. */
  const reach = radius <= 0.2 ? 0 : 1;
  for (let dy = -reach; dy <= reach; dy += 1)
    for (let dx = -reach; dx <= reach; dx += 1) {
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = period ? ((cx % period) + period) % period : cx;
      if (hash2(wx, cy, seed) > density) continue;
      const px = cx + 0.5 + (hash2(wx, cy, seed + 1) - 0.5) * 0.6;
      const py = cy + 0.5 + (hash2(wx, cy, seed + 2) - 0.5) * 0.6;
      const r = radius * (0.45 + 0.55 * hash2(wx, cy, seed + 3));
      const d = Math.hypot(x - px, y - py);
      cover = Math.max(cover, smooth(r, r * 0.6, d));
    }
  return cover;
}

/* ------------------------------------------------------------------ *
 * Цвет
 * ------------------------------------------------------------------ */

const RGB = new Map();
/** `#rrggbb` → `[r, g, b]` (кэш: цвета модели читаются на каждый пиксель). */
export function rgb(hex) {
  let value = RGB.get(hex);
  if (!value) {
    value = Object.freeze(hexBytes(hex));
    RGB.set(hex, value);
  }
  return value;
}

/** `out` = смесь цветов `a` и `b` (`[r, g, b]`) в доле `t`, умноженная на `k`. */
export function blend(out, a, b, t, k = 1) {
  out[0] = (a[0] + (b[0] - a[0]) * t) * k;
  out[1] = (a[1] + (b[1] - a[1]) * t) * k;
  out[2] = (a[2] + (b[2] - a[2]) * t) * k;
  return out;
}

/** `out` += (цвет − `out`)·t. */
export function over(out, colour, t) {
  out[0] += (colour[0] - out[0]) * t;
  out[1] += (colour[1] - out[1]) * t;
  out[2] += (colour[2] - out[2]) * t;
  return out;
}

/** Светлее/темнее, сохраняя оттенок: k > 1 — к белому, k < 1 — к чёрному. */
export function tone([r, g, b], k) {
  if (k <= 1) return [r * k, g * k, b * k];
  const t = Math.min(1, k - 1);
  return [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t];
}

/* Яркость 0…1 (для выбора светлого или тёмного рисунка поверх). */
export const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* ------------------------------------------------------------------ *
 * Лист
 * ------------------------------------------------------------------ */

export const ATLAS_SIZE = 1024;
/* Клетки плоского цвета: угол листа 256 × 256, клетка 32 × 32 — 64 цвета. */
const CELLS = Object.freeze({ x: 768, y: 768, size: 256, cell: 32 });

/*
 * Лист модели: `uv(hex)` — середина клетки цвета; `region(id, [x, y, w,
 * h], paint, inset)` — кусок с рисунком, ответ — `(u, v) → [U, V]` (доли
 * листа, с отступом от края куска). `paint()` — RGBA всего листа.
 */
export function createAtlas() {
  const colours = [];
  const regions = [];
  const perRow = CELLS.size / CELLS.cell;
  const atlas = {
    uv(hex) {
      const value = String(hex).toLowerCase();
      let index = colours.indexOf(value);
      if (index < 0) {
        if (colours.length >= perRow * perRow) throw new Error("Листу модели не хватило клеток цвета.");
        index = colours.length;
        colours.push(value);
      }
      return [(CELLS.x + ((index % perRow) + 0.5) * CELLS.cell) / ATLAS_SIZE, (CELLS.y + (Math.floor(index / perRow) + 0.5) * CELLS.cell) / ATLAS_SIZE];
    },
    region(id, rect, paint, inset = 4) {
      const [x, y, w, h] = rect;
      for (const value of rect) if (!Number.isInteger(value)) throw new Error(`Кусок листа ${id}: не целые пиксели.`);
      if (x < 0 || y < 0 || x + w > ATLAS_SIZE || y + h > ATLAS_SIZE) throw new Error(`Кусок листа ${id} вне листа.`);
      if (x < CELLS.x + CELLS.size && x + w > CELLS.x && y < CELLS.y + CELLS.size && y + h > CELLS.y) throw new Error(`Кусок листа ${id} задевает клетки цвета.`);
      for (const other of regions)
        if (x < other.x + other.w && x + w > other.x && y < other.y + other.h && y + h > other.y) throw new Error(`Куски листа ${id} и ${other.id} накрывают друг друга.`);
      const region = { id, x, y, w, h, paint, inset };
      regions.push(region);
      const x0 = x + inset;
      const y0 = y + inset;
      const sx = w - inset * 2;
      const sy = h - inset * 2;
      return (u, v) => [(x0 + clamp01(u) * sx) / ATLAS_SIZE, (y0 + clamp01(v) * sy) / ATLAS_SIZE];
    },
    /** Куски листа (для проверок): `[{ id, rect }]`. */
    get regions() {
      return regions.map((item) => ({ id: item.id, rect: [item.x, item.y, item.w, item.h] }));
    },
    /*
     * RGBA листа. `size` — сторона в пикселях: 1024 — лист игры; кадр окна
     * берёт тот же рисунок вдвое меньше (512) — развёртка в долях, куски и
     * отступы сжимаются вместе с листом.
     */
    paint(size = ATLAS_SIZE) {
      const k = size / ATLAS_SIZE;
      if (!(k > 0 && k <= 1) || !Number.isInteger(CELLS.cell * k)) throw new Error(`Лист модели ${size} px не делится на клетки.`);
      const rgba = new Uint8ClampedArray(size * size * 4);
      /* Пустое — серое: развёртка мимо куска не светит чёрным. */
      rgba.fill(128);
      for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
      const cell = CELLS.cell * k;
      colours.forEach((hex, index) => {
        const [r, g, b] = rgb(hex);
        const cx = (CELLS.x + (index % perRow) * CELLS.cell) * k;
        const cy = (CELLS.y + Math.floor(index / perRow) * CELLS.cell) * k;
        for (let y = cy; y < cy + cell; y += 1)
          for (let x = cx; x < cx + cell; x += 1) {
            const at = (y * size + x) * 4;
            rgba[at] = r;
            rgba[at + 1] = g;
            rgba[at + 2] = b;
          }
      });
      const out = [0, 0, 0];
      for (const region of regions) {
        const [x0, y0, w, h, inset] = [region.x * k, region.y * k, region.w * k, region.h * k, region.inset * k];
        const sx = w - inset * 2;
        const sy = h - inset * 2;
        for (let y = y0; y < y0 + h; y += 1) {
          const v = clamp01((y + 0.5 - y0 - inset) / sy);
          for (let x = x0; x < x0 + w; x += 1) {
            region.paint(clamp01((x + 0.5 - x0 - inset) / sx), v, out);
            const at = (y * size + x) * 4;
            rgba[at] = out[0];
            rgba[at + 1] = out[1];
            rgba[at + 2] = out[2];
          }
        }
      }
      return { width: size, height: size, rgba };
    },
  };
  return atlas;
}

/* ------------------------------------------------------------------ *
 * Чешуя внахлёст
 * ------------------------------------------------------------------ */

/*
 * Чешуйки рядами вдоль `s` (к хвосту) со сдвигом через ряд на полшага по
 * `t`: у каждой — эллипс радиусами `rs`, `rt` (в шагах ряда), сидит
 * основанием к голове. Сверху лежит ближняя к голове чешуйка, видна у
 * каждой её задняя часть до свободной кромки. Ответ в `cell`: `row`, `col`,
 * `d` — 0 в середине … 1 у кромки, `shadow` — тень кромки чешуйки над ней
 * (0…1), `gap` — точка между чешуйками. `period` — число чешуек по кругу
 * (кусок замкнут).
 */
export function scaleAt(s, t, cell, { rs = 0.78, rt = 0.66, period = 0 } = {}) {
  const base = Math.floor(s);
  let best = null;
  let shadow = 0;
  for (let row = base - 1; row <= base + 1; row += 1) {
    const offset = (row & 1) * 0.5;
    const middle = Math.round(t - offset);
    for (let col = middle - 1; col <= middle + 1; col += 1) {
      const ds = (s - row) / rs;
      const dt = (t - (col + offset)) / rt;
      const d = Math.sqrt(ds * ds + dt * dt);
      if (d <= 1) {
        if (!best || row < best.row || (row === best.row && d < best.d)) best = { row, col, d, ds, dt };
      }
    }
  }
  if (best) {
    /* Тень от кромки ряда над видимой чешуйкой (ближе к голове). */
    const row = best.row - 1;
    const offset = (row & 1) * 0.5;
    const middle = Math.round(t - offset);
    for (let col = middle - 1; col <= middle + 1; col += 1) {
      const ds = (s - row) / rs;
      const dt = (t - (col + offset)) / rt;
      const d = Math.sqrt(ds * ds + dt * dt);
      if (d > 1 && d < 1.22) shadow = Math.max(shadow, 1 - (d - 1) / 0.22);
    }
  }
  cell.row = best ? best.row : base;
  cell.col = best ? (period ? ((best.col % period) + period) % period : best.col) : 0;
  cell.d = best ? best.d : 1;
  cell.ds = best ? best.ds : 1;
  cell.dt = best ? best.dt : 0;
  cell.shadow = shadow;
  cell.gap = !best;
  return cell;
}

/* ------------------------------------------------------------------ *
 * Рисунки
 * ------------------------------------------------------------------ */

/*
 * Чешуя рептилии (спина и бока дракона): ряды `rows` вдоль u, `around`
 * чешуек по v. Цвет — `colour`, к краям полосы (к брюху) — к `belly`, по
 * хребту — темнее; у каждой чешуйки свой оттенок, свет к середине, тёмная
 * кромка и тень от соседней. `blotch` — крупные пятна (0…1).
 */
export function reptileScales({ colour, belly, rows = 140, around = 26, seed = 1, ridge = 0.5, blotch = 0.5, flankBelly = 0.35 }) {
  const top = rgb(colour);
  const low = rgb(belly);
  const dark = tone(top, 0.55);
  const cell = {};
  return (u, v, out) => {
    scaleAt(u * rows, v * around, cell);
    const random = hash2(cell.row, cell.col, seed);
    /* Полоса по хребту темнее, к краям — к цвету брюха. */
    const fromRidge = Math.abs(v - ridge) * 2;
    const flank = smooth(0.62, 1, fromRidge) * flankBelly;
    blend(out, top, dark, (1 - smooth(0, 0.35, fromRidge)) * 0.45);
    over(out, low, flank);
    /* Крупные пятна — темнее. */
    const spots = fbm(u * 18, v * 5, seed + 7, 3);
    const k0 = 1 - blotch * 0.28 * smooth(0.5, 0.72, spots);
    if (cell.gap) {
      out[0] *= 0.42 * k0;
      out[1] *= 0.42 * k0;
      out[2] *= 0.42 * k0;
      return out;
    }
    /* Своя чешуйка: свет у середины, край темнее, блик у кромки. */
    const dome = 1 - cell.d * cell.d;
    let k = (0.78 + 0.32 * dome + (random - 0.5) * 0.16) * k0;
    k *= 1 - 0.38 * smooth(0.84, 1, cell.d);
    k *= 1 - 0.42 * cell.shadow;
    const shine = smooth(0.55, 0.85, cell.ds) * (1 - smooth(0.85, 0.98, cell.d)) * 0.12;
    out[0] = out[0] * k + 255 * shine;
    out[1] = out[1] * k + 255 * shine;
    out[2] = out[2] * k + 255 * shine;
    return out;
  };
}

/*
 * Щитки брюха (поперечные пластины): `rows` пластин вдоль u, по v — по
 * обхвату брюха. Светлый цвет `belly`, стыки темнее, к бокам — к `colour`.
 */
export function bellyPlates({ belly, colour, rows = 90, seed = 2, sideColour = 0.3 }) {
  const pale = rgb(belly);
  const side = rgb(colour);
  return (u, v, out) => {
    const s = u * rows;
    const row = Math.floor(s);
    const f = s - row;
    const random = hash2(row, 0, seed);
    const edge = Math.abs(v - 0.5) * 2;
    blend(out, pale, side, smooth(0.55, 1, edge) * sideColour);
    /* Пластина: выпуклая к середине, стык — тёмная линия, тень под задней кромкой. */
    const curve = f + 0.18 * edge * edge;
    const g = curve - Math.floor(curve);
    let k = 0.86 + 0.18 * Math.sin(g * Math.PI) + (random - 0.5) * 0.08;
    k *= 1 - 0.45 * smooth(0.9, 1, g);
    k *= 1 - 0.25 * (1 - smooth(0, 0.12, g));
    /* Мелкие морщины поперёк. */
    k *= 0.95 + 0.05 * noise(u * 400, v * 30, seed + 3);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/* Расстояние от точки до отрезка (в плоскости). */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/*
 * Перепонка крыла в плане: `box` — рамка (|x| a0…a1, y b0…b1, м; u — по
 * |x|, v — от b1 к b0), `bones` — кости в плане `[[x0, y0, x1, y1] …]`,
 * `centre` — запястье. Кожа цвета `colour`: у костей темнее и плотнее, к
 * кромке тоньше и светлее; волокна веером от запястья, у костей —
 * ветвистые жилки, поперёк волокон — мелкие морщины.
 */
export function wingMembrane({ colour, box, bones, centre, seed = 3 }) {
  const base = rgb(colour);
  const vein = tone(base, 0.52);
  const thin = tone(base, 1.25);
  return (u, v, out) => {
    const x = lerp(box.a0, box.a1, u);
    const y = lerp(box.b1, box.b0, v);
    let near = Infinity;
    for (const [ax, ay, bx, by] of bones) near = Math.min(near, segmentDistance(x, y, ax, ay, bx, by));
    blend(out, base, thin, smooth(0.4, 3.0, near) * 0.5);
    const dx = x - centre[0];
    const dy = y - centre[1];
    const angle = Math.atan2(dy, dx);
    const rho = Math.hypot(dx, dy);
    const warp = noise(rho * 0.5, angle * 3, seed);
    const streak = Math.abs(noise(angle * 34 + warp * 3, rho * 0.3, seed + 1) - 0.5);
    const fibres = smooth(0.06, 0, streak) * smooth(0.5, 2.5, rho) * 0.42;
    const capillary = Math.abs(noise(x * 4.2 + warp * 2, y * 4.2, seed + 2) - 0.5);
    const veins = smooth(0.03, 0, capillary) * (1 - smooth(0.2, 1.2, near)) * 0.35;
    over(out, vein, Math.min(0.8, fibres + veins));
    const wrinkle = 0.95 + 0.05 * Math.sin(rho * 10 + noise(angle * 12, rho, seed + 3) * 5);
    const shade = (0.93 + 0.07 * noise(x * 1.3, y * 1.3, seed + 4)) * (1 - 0.3 * smooth(0.45, 0.05, near));
    out[0] *= wrinkle * shade;
    out[1] *= wrinkle * shade;
    out[2] *= wrinkle * shade;
    return out;
  };
}

/* Рог или коготь: u — от основания к концу, v — по кругу; у основания — кольца и темнее, к концу — светлый. */
export function hornGradient({ base, tip, rings = 16, seed = 4 }) {
  const root = rgb(base);
  const end = rgb(tip);
  return (u, v, out) => {
    blend(out, root, end, smooth(0.15, 0.95, u));
    const ring = 0.5 + 0.5 * Math.sin(u * rings * Math.PI * 2 + noise(v * 6, u * 4, seed, 6) * 2);
    const k = (1 - 0.22 * (1 - u) * ring) * (0.92 + 0.08 * noise(u * 30, v * 12, seed + 1, 12));
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/*
 * Глаз: u, v — передняя полусфера кругом (середина — 0,5; 0,5). Радужка
 * цвета `iris` со светлыми лучами к зрачку, зрачок — щелью (`slit` —
 * ширина щели к высоте, 1 — круглый), тёмная кайма, блик.
 */
export function eyeIris({ iris, slit = 0.28, seed = 5 }) {
  const glow = rgb(iris);
  const bright = tone(glow, 1.45);
  const deep = tone(glow, 0.45);
  return (u, v, out) => {
    const x = (u - 0.5) * 2;
    const y = (v - 0.5) * 2;
    const r = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    blend(out, bright, glow, smooth(0.15, 0.75, r));
    over(out, deep, smooth(0.7, 0.98, r));
    const rays = 0.85 + 0.15 * noise(angle * 6, r * 9, seed, 0);
    out[0] *= rays;
    out[1] *= rays;
    out[2] *= rays;
    /* Зрачок — вертикальная щель. */
    const pupil = Math.hypot(x / Math.max(0.05, slit * 0.42), y / 0.62);
    const black = smooth(1.05, 0.9, pupil);
    out[0] *= 1 - black * 0.96;
    out[1] *= 1 - black * 0.96;
    out[2] *= 1 - black * 0.96;
    /* Блик. */
    const spark = smooth(0.16, 0.06, Math.hypot(x + 0.32, y + 0.36));
    over(out, [255, 255, 255], spark * 0.85);
    return out;
  };
}

/*
 * Перо (маховое, кроющее, хвостовое): u — от основания к концу, v — поперёк
 * (0,5 — стержень). Цвет от `base` к `tip`, бородки косыми штрихами к
 * концу, светлый стержень, край темнее, редкие расщепы бородок.
 */
export function featherVane({ base, tip, shaft = "#fff2c8", barbs = 46, seed = 6, edgeDark = 0.22 }) {
  const root = rgb(base);
  const end = rgb(tip);
  const rachis = rgb(shaft);
  return (u, v, out) => {
    const across = (v - 0.5) * 2;
    blend(out, root, end, smooth(0.05, 1, u));
    const slant = u * barbs - Math.abs(across) * barbs * 0.32;
    const stripe = 0.5 + 0.5 * Math.cos(slant * Math.PI * 2);
    const split = smooth(0.82, 0.92, noise(u * 9, across * 3, seed));
    let k = 0.9 + 0.1 * stripe - split * 0.25;
    k *= 1 - edgeDark * smooth(0.7, 1, Math.abs(across));
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    over(out, rachis, smooth(0.07, 0.02, Math.abs(across)) * 0.75);
    return out;
  };
}

/*
 * Огонь на конце пера (светится): u — от начала огня к концу, v — поперёк.
 * От `base` к `flame` и почти белому вдоль стержня, языки шумом.
 */
export function flameTip({ base, flame, seed = 7 }) {
  const root = rgb(base);
  const hot = rgb(flame);
  const white = tone(hot, 1.6);
  return (u, v, out) => {
    const across = Math.abs(v - 0.5) * 2;
    const tongue = noise(u * 7, across * 3, seed) * 0.5 + noise(u * 17, across * 6, seed + 1) * 0.25;
    blend(out, root, hot, smooth(0, 0.55, u + tongue * 0.4));
    over(out, white, smooth(0.55, 0.05, across + tongue * 0.5) * smooth(0.1, 0.7, u));
    const k = 0.86 + 0.14 * tongue;
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/*
 * Мелкие перья внахлёст (тело птицы, кроющие крыла): ряды вдоль u,
 * `around` по v; у каждого пёрышка — светлый край и бородки; цвет — от
 * `from` к `to` по u (голова золотая, спина красная).
 */
export function softFeathers({ from, to, rows = 70, around = 22, seed = 8, lightEdge = 0.18, period = 0, mixAt = [0, 1] }) {
  const a = rgb(from);
  const b = rgb(to);
  const cell = {};
  return (u, v, out) => {
    scaleAt(u * rows, v * around, cell, { rs: 0.9, rt: 0.62, period });
    const random = hash2(cell.row, cell.col, seed);
    blend(out, a, b, smooth(mixAt[0], mixAt[1], u + (random - 0.5) * 0.06));
    if (cell.gap) {
      out[0] *= 0.6;
      out[1] *= 0.6;
      out[2] *= 0.6;
      return out;
    }
    const barbs = 0.92 + 0.08 * Math.cos((cell.dt * 6 + cell.ds * 2) * Math.PI);
    let k = (0.84 + 0.2 * (1 - cell.d * cell.d) + (random - 0.5) * 0.14) * barbs;
    k *= 1 - 0.4 * cell.shadow;
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    /* Светлая кромка пёрышка. */
    over(out, tone(out, 1.3), smooth(0.78, 0.97, cell.d) * lightEdge * 4);
    return out;
  };
}

/*
 * Кожа кита (спина и бока): u — от головы к хвосту, v — по обхвату полосы
 * (0 и 1 — к брюху). Тёмная спина `colour` с пятнами и шрамами, бока к
 * `belly` с рваной границей, у головы — ракушки.
 */
export function whaleSkin({ colour, belly, seed = 9, barnacles = 0.12 }) {
  const top = rgb(colour);
  const low = rgb(belly);
  const scar = tone(top, 1.35);
  return (u, v, out) => {
    const fromRidge = Math.abs(v - 0.5) * 2;
    const warp = fbm(u * 9, v * 4, seed, 3);
    blend(out, top, low, smooth(0.66, 0.98, fromRidge + (warp - 0.5) * 0.35) * 0.9);
    const mottle = 0.86 + 0.24 * fbm(u * 40, v * 12, seed + 1, 3);
    out[0] *= mottle;
    out[1] *= mottle;
    out[2] *= mottle;
    /* Шрамы — тонкие светлые штрихи вдоль тела. */
    const streak = Math.abs(noise(u * 6, v * 70, seed + 2) - 0.5);
    over(out, scar, smooth(0.02, 0, streak) * smooth(0.6, 0.85, noise(u * 3, v * 9, seed + 3)) * 0.6);
    /* Ракушки — светлые скопления у головы. */
    if (u < barnacles * 1.6) {
      const patch = smooth(0.45, 0.7, noise(u * 30, v * 8, seed + 4)) * smooth(barnacles * 1.6, 0, u);
      over(out, [214, 210, 196], dots(u * 260, v * 90, seed + 5, 0.55, 0.42) * patch * 0.85);
    }
    return out;
  };
}

/*
 * Горло и брюхо кита: продольные складки (`grooves` по обхвату), тёмные
 * бороздки в светлом `belly`; от подбородка до пупка (`until` по u), дальше
 * гладкое брюхо; пятна.
 */
export function whaleThroat({ belly, colour, grooves = 26, until = 0.55, seed = 10 }) {
  const pale = rgb(belly);
  const dark = rgb(colour);
  return (u, v, out) => {
    const edge = Math.abs(v - 0.5) * 2;
    blend(out, pale, dark, smooth(0.7, 1, edge + (noise(u * 30, v * 6, seed) - 0.5) * 0.3) * 0.75);
    const fade = smooth(until + 0.06, until - 0.04, u + (noise(v * 20, 0, seed + 1) - 0.5) * 0.08);
    const g = fract(v * grooves + noise(u * 14, v * 3, seed + 2) * 0.6);
    const groove = smooth(0.2, 0, Math.abs(g - 0.5) - 0.3) * fade;
    let k = 1 - 0.5 * groove;
    k *= 0.9 + 0.12 * fbm(u * 60, v * 20, seed + 3, 2);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    /* Тёмные крапины на светлом. */
    over(out, tone(dark, 0.8), dots(u * 220, v * 70, seed + 4, 0.2, 0.2) * 0.45);
    return out;
  };
}

/*
 * Плавник кита: u — от корня к концу, v — по обхвату сечения (0…0,5 —
 * верх, 0,5…1 — низ). Верх — пёстрый `colour` со светлыми пятнами, низ —
 * светлый `belly`; кромка в мелких бугорках и ракушках.
 */
export function whaleFin({ colour, belly, seed = 11, pale = 0.35 }) {
  const top = rgb(colour);
  const low = rgb(belly);
  return (u, v, out) => {
    const underside = Math.sin(v * Math.PI * 2) < 0;
    const patch = fbm(u * 6, v * 8, seed, 3);
    if (underside) blend(out, low, top, smooth(0.6, 0.85, patch) * 0.4);
    else blend(out, top, low, smooth(0.5, 0.8, patch) * pale);
    const k = 0.88 + 0.16 * fbm(u * 30, v * 24, seed + 1, 2);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    const barnacle = dots(u * 70, v * 40, seed + 2, 0.12, 0.38) * (0.3 + 0.7 * smooth(0.5, 1, u));
    over(out, [220, 216, 204], barnacle * 0.7);
    return out;
  };
}

/*
 * Купол медузы (светится): u — по кругу (повтор `lobes`), v — от макушки к
 * кромке. Цвет `colour`, к кромке светлее и к `rim`; радиальные каналы,
 * четыре подковы гонад у макушки, крапины.
 */
export function jellyBell({ colour, rim, gonad, lobes = 16, seed = 12 }) {
  const body = rgb(colour);
  const edge = rgb(rim);
  const organ = rgb(gonad);
  return (u, v, out) => {
    blend(out, tone(body, 0.8), body, smooth(0, 0.5, v));
    over(out, edge, smooth(0.72, 1, v) * 0.55);
    /* Каналы: от макушки к кромке, у кромки ветвятся. */
    const around = u * lobes;
    const canal = Math.abs(fract(around + 0.5) - 0.5);
    const branch = Math.abs(fract(around * 2 + noise(v * 8, around, seed, lobes) * 0.4) - 0.5);
    const lines = smooth(0.05, 0.012, canal) * smooth(0.12, 0.3, v) + smooth(0.05, 0.015, branch) * smooth(0.6, 0.85, v) * 0.6;
    over(out, tone(edge, 1.2), lines * 0.45);
    /* Гонады — четыре подковы. */
    const quarter = fract(u * 4) - 0.5;
    const ring = Math.hypot(quarter * 1.2, (v - 0.26) * 2.4);
    const horseshoe = smooth(0.06, 0.02, Math.abs(ring - 0.3)) * smooth(0.0, 0.08, v);
    over(out, organ, horseshoe * 0.7);
    /* Крапины. */
    over(out, tone(edge, 1.3), dots(u * 220, v * 36, seed + 1, 0.35, 0.2, 220) * 0.35);
    const k = 0.9 + 0.12 * noise(u * 60, v * 10, seed + 2, 60);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/* Ротовая лопасть медузы: u — вдоль, v — поперёк; оборки темнее у середины и светлее по кромке. */
export function jellyArm({ colour, edge, seed = 13 }) {
  const body = rgb(colour);
  const rim = rgb(edge);
  return (u, v, out) => {
    const across = Math.abs(v - 0.5) * 2;
    blend(out, tone(body, 0.75), body, smooth(0, 0.6, across));
    over(out, rim, smooth(0.75, 1, across) * 0.6);
    const k = 0.85 + 0.2 * noise(u * 40, across * 8, seed);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/* Простой ход цвета вдоль u (щупальца, язык пламени, стебель): от `from` к `to`, с лёгким шумом. */
export function gradient({ from, to, seed = 14, grain = 0.08, bands = null }) {
  const a = rgb(from);
  const b = rgb(to);
  return (u, v, out) => {
    blend(out, a, b, bands ? smooth(bands[0], bands[1], u) : u);
    const k = 1 - grain + grain * 2 * noise(u * 40, v * 8, seed);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/*
 * Ткань: цвет `colourAt(u, v) → [r, g, b]` с переплетением, поперечными
 * швами полотнищ (`seams` по v), лентами по u (`tapes`, сдвиг `tapeShift`:
 * 0 — ленты на полуцелых долях клина), копотью у нижнего края (`scorch`),
 * подрубкой по краям (`hem`). `period` — сколько повторов шума по u (кусок
 * замкнут по кругу: оболочка).
 */
export function fabric({ colourAt, tapes = 0, tapeShift = 0.5, tapeColour = "#2b2b2e", seams = 0, sheen = 0.12, seed = 15, scorch = 0, hem = 0, period = 9 }) {
  const tape = rgb(tapeColour);
  return (u, v, out) => {
    const [r, g, b] = colourAt(u, v);
    out[0] = r;
    out[1] = g;
    out[2] = b;
    const weave = 0.965 + 0.035 * Math.sin(u * Math.PI * 2 * 220) * Math.sin(v * 900);
    let k = weave * (1 - sheen + sheen * 2 * noise(u * period, v * 4, seed, period));
    if (seams) k *= 1 - 0.16 * smooth(0.045, 0, 0.5 - Math.abs(fract(v * seams) - 0.5));
    if (hem) k *= 1 - 0.22 * smooth(hem, hem * 0.4, Math.min(u, 1 - u, v, 1 - v));
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    if (tapes) over(out, tape, smooth(0.035, 0.012, Math.abs(fract(u * tapes + tapeShift) - 0.5)) * 0.85);
    if (scorch) over(out, [40, 28, 20], smooth(1 - scorch, 1, v) * 0.6);
    return out;
  };
}

/* Плетёная корзина: косое плетение лозы. */
export function wicker({ colour = "#8a5a2b", seed = 16, weaves = 28 }) {
  const cane = rgb(colour);
  return (u, v, out) => {
    const a = u * weaves;
    const b = v * weaves * 0.5;
    const cell = (Math.floor(a) + Math.floor(b)) & 1;
    const fa = fract(a);
    const fb = fract(b);
    const strand = cell ? Math.sin(fa * Math.PI) : Math.sin(fb * Math.PI);
    const k = (0.55 + 0.5 * strand) * (0.9 + 0.2 * hash2(Math.floor(a), Math.floor(b), seed));
    out[0] = cane[0] * k;
    out[1] = cane[1] * k;
    out[2] = cane[2] * k;
    return out;
  };
}

/*
 * Металл корпуса в плане: u, v — квадрат корпуса (середина — ось). Кольцевые
 * швы, радиальные листы, заклёпки, шлифовка по кругу.
 */
export function metalHull({ colour, rings = 7, sectors = 24, seed = 17 }) {
  const base = rgb(colour);
  return (u, v, out) => {
    const x = (u - 0.5) * 2;
    const y = (v - 0.5) * 2;
    const r = Math.hypot(x, y);
    const angle = Math.atan2(y, x) / (Math.PI * 2) + 0.5;
    const brushed = 0.92 + 0.08 * noise(angle * 400, r * 6, seed, 400);
    const sheen = 0.9 + 0.18 * Math.cos(angle * Math.PI * 4 + 0.8);
    let k = brushed * sheen;
    const ring = Math.abs(fract(r * rings) - 0.5);
    k *= 1 - 0.3 * smooth(0.06, 0.02, 0.5 - ring);
    const sector = Math.abs(fract(angle * sectors) - 0.5);
    k *= 1 - 0.22 * smooth(0.05, 0.015, 0.5 - sector) * smooth(0.2, 0.3, r);
    const rivet = Math.hypot(fract(angle * sectors * 3) - 0.5, (fract(r * rings) - 0.1) * 6);
    k *= 1 - 0.25 * smooth(0.18, 0.1, rivet);
    out[0] = base[0] * k;
    out[1] = base[1] * k;
    out[2] = base[2] * k;
    return out;
  };
}

/* Бумага фонарика: волокна, светлее к середине (там пламя), темнее у рамки. */
export function paper({ colour, seed = 18 }) {
  const base = rgb(colour);
  return (u, v, out) => {
    const fibre = 0.92 + 0.08 * noise(u * 90, v * 12, seed) + 0.04 * noise(u * 300, v * 300, seed + 1);
    const centre = 1.06 - 0.22 * Math.max(Math.abs(u - 0.5) * 2, 0) ** 2 - 0.12 * Math.abs(v - 0.6);
    const k = fibre * centre;
    out[0] = base[0] * k;
    out[1] = base[1] * k;
    out[2] = base[2] * k;
    return out;
  };
}

/*
 * Шерсть (тело льва у грифона): u — вдоль тела, v — по обхвату полосы (0,5
 * — хребет). Волоски — штрихами вдоль u, по хребту темнее, к брюху светлее.
 */
export function fur({ colour, seed = 50, strands = 160, around = 30 }) {
  const base = rgb(colour);
  const deep = tone(base, 0.62);
  const pale = tone(base, 1.3);
  return (u, v, out) => {
    const fromRidge = Math.abs(v - 0.5) * 2;
    blend(out, deep, base, smooth(0, 0.4, fromRidge));
    over(out, pale, smooth(0.7, 1, fromRidge) * 0.4);
    const warp = noise(u * 6, v * 3, seed) * 2;
    const hairs = 0.82 + 0.26 * noise(u * strands, v * around * 4 + warp, seed + 1);
    const tufts = 0.94 + 0.08 * noise(u * 30, v * 10, seed + 2);
    out[0] *= hairs * tufts;
    out[1] *= hairs * tufts;
    out[2] *= hairs * tufts;
    return out;
  };
}

/*
 * Прядь гривы, усы, кисточка хвоста: u — от корня к концу, v — поперёк.
 * Волоски вдоль пряди, от `from` у корня к `to` на конце, края темнее.
 */
export function hairStrands({ from, to, seed = 51 }) {
  const root = rgb(from);
  const tip = rgb(to);
  return (u, v, out) => {
    const across = Math.abs(v - 0.5) * 2;
    blend(out, root, tip, smooth(0.15, 1, u));
    const strand = 0.74 + 0.36 * noise(v * 42, u * 3, seed);
    const k = strand * (1 - 0.3 * smooth(0.6, 1, across));
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
}

/*
 * Покров грифона вдоль тела (u — от головы к хвосту): голова — белые
 * пёрышки `head`, шея и грудь — перья `wings`, с середины тела — шерсть льва
 * `colour`; переходы — мягкие (перья «вползают» в шерсть).
 */
export function griffinCoat({ head, wings, colour, seed = 52, rows = 64, around = 26, headTo = 0.17, furFrom = 0.46 }) {
  const feathers = softFeathers({ from: head, to: wings, rows, around, seed, mixAt: [headTo - 0.05, headTo + 0.03] });
  const coat = fur({ colour, seed: seed + 1 });
  const a = [0, 0, 0];
  return (u, v, out) => {
    const t = smooth(furFrom - 0.04, furFrom + 0.08, u + (noise(v * 12, u * 20, seed + 2) - 0.5) * 0.06);
    if (t <= 0) return feathers(u, v, out);
    if (t >= 1) return coat(u, v, out);
    feathers(u, v, a);
    coat(u, v, out);
    out[0] = a[0] + (out[0] - a[0]) * t;
    out[1] = a[1] + (out[1] - a[1]) * t;
    out[2] = a[2] + (out[2] - a[2]) * t;
    return out;
  };
}
