/*
 * Своя голограмма на стволе (задача 6 ТЗ 11.10.2026, утро).
 *
 * Владелец: «голограмму какую-то человек свою может, хочет трёхмерную
 * добавить». Картинка человека или надпись становится объёмной фигурой по
 * своему контуру — как летающее лого над городом и звезда арены
 * (`climb-contract/recolor/arena-star.js`): маска клеток по прозрачности,
 * лицо и спинка — прямоугольники клеток, бока — по контуру. Два вида:
 *   • «Объёмная фигура» — непрозрачная, в цветах картинки (надпись — своим
 *     цветом), шейдер `default`;
 *   • «Светящаяся» — полупрозрачная и светится сама: висит над стволом на
 *     луче из маленького излучателя, по ней бегут строки развёртки, шейдер
 *     `emissive` с `emissive_alpha.sps` (как светящиеся метки залазов).
 * Фигура лежит над поверхностью («Лежит» — лицом наружу) или стоит на ней
 * («Стоит» — ребром к стволу, лицом вбок, читается сбоку).
 *
 * ОДНИ И ТЕ ЖЕ ТОЧКИ. Окно рисует картинку или надпись в квадрат 256×256 и
 * отдаёт PNG; маска и лист текстуры считаются здесь по пикселям этого PNG —
 * в кадре и у Astral Desktop они совпадают до бита. Лист 128×128: картинка
 * — в квадрат 112×112 сверху посередине, внизу — полоса луча (полупрозрачная)
 * и полоса излучателя (сплошная).
 */

import { builder, circleOutline, facet, oriented, prism } from "./decoration-shapes.js";

export const HOLOGRAM_PNG_SIZE = 256;
export const HOLOGRAM_TEXTURE_SIZE = 128;
const BOX = Object.freeze({ x: 8, y: 0, size: 112 });
const BEAM_ROWS = [112, 120];
const EMITTER_ROWS = [120, 128];
export const HOLOGRAM_BEAM_UV = Object.freeze([0.5, 116 / 128]);
export const HOLOGRAM_EMITTER_UV = Object.freeze([0.5, 124 / 128]);

export const HOLOGRAM_QUALITY = Object.freeze({
  high: Object.freeze({ cells: Object.freeze([48, 40, 32, 24, 16]), limit: 5000, emitter: 12 }),
  low: Object.freeze({ cells: Object.freeze([24, 16, 12, 8]), limit: 1200, emitter: 6 }),
});

/* Клетка заполнена, если картинка в ней непрозрачна хотя бы наполовину. */
const COVER = 128;

/**
 * Маска картинки: `{ cols, rows, filled, crop }` — пустые поля обрезаны,
 * по длинной стороне `cells` клеток; `crop` — доли картинки, легшие в маску
 * (v — сверху вниз). Пустая картинка — `null`.
 */
export function hologramMask(rgba, width, height, cells = 48) {
  if (!rgba || !width || !height) return null;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (rgba[(y * width + x) * 4 + 3] >= COVER) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const factor = cells / Math.max(boxWidth, boxHeight);
  const cols = Math.max(1, Math.round(boxWidth * factor));
  const rows = Math.max(1, Math.round(boxHeight * factor));
  const filled = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const y0 = top + Math.floor((row * boxHeight) / rows);
    const y1 = Math.max(y0 + 1, top + Math.floor(((row + 1) * boxHeight) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = left + Math.floor((col * boxWidth) / cols);
      const x1 = Math.max(x0 + 1, left + Math.floor(((col + 1) * boxWidth) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += rgba[(y * width + x) * 4 + 3];
      if (sum / ((y1 - y0) * (x1 - x0)) >= COVER) filled[row * cols + col] = 1;
    }
  }
  return { cols, rows, filled, crop: { u0: left / width, v0: top / height, u1: (right + 1) / width, v1: (bottom + 1) / height } };
}

/* Прямоугольники заполненных клеток: жадное слияние строк и столбцов. */
function rectangles({ cols, rows, filled }) {
  const used = new Uint8Array(cols * rows);
  const out = [];
  for (let row = 0; row < rows; row += 1)
    for (let col = 0; col < cols; col += 1) {
      const at = row * cols + col;
      if (!filled[at] || used[at]) continue;
      let end = col + 1;
      while (end < cols && filled[row * cols + end] && !used[row * cols + end]) end += 1;
      let last = row + 1;
      grow: while (last < rows) {
        for (let c = col; c < end; c += 1) if (!filled[last * cols + c] || used[last * cols + c]) break grow;
        last += 1;
      }
      for (let r = row; r < last; r += 1) for (let c = col; c < end; c += 1) used[r * cols + c] = 1;
      out.push({ c0: col, r0: row, c1: end, r1: last });
    }
  return out;
}

/*
 * Фигура по маске в своих осях: длинная сторона — 1, низ — на нуле, ось — по
 * середине ширины, лицо — к +z, толщина `depth`. `place(p)`/`turn(n)` —
 * куда фигура встаёт в осях украшения.
 */
function figure(mesh, mask, { depth, place, turn }) {
  const cell = 1 / Math.max(mask.cols, mask.rows);
  const { cols, rows, filled, crop } = mask;
  const x = (col) => (col - cols / 2) * cell;
  const y = (row) => (rows - row) * cell;
  const front = depth / 2;
  const back = -depth / 2;
  const tex = (u, v) => [(BOX.x + u * BOX.size) / HOLOGRAM_TEXTURE_SIZE, (BOX.y + v * BOX.size) / HOLOGRAM_TEXTURE_SIZE];
  const u = (col) => crop.u0 + (col / cols) * (crop.u1 - crop.u0);
  const v = (row) => crop.v0 + (row / rows) * (crop.v1 - crop.v0);
  const quad = (corners, normal, uvs) => {
    const n = turn(normal);
    const ids = corners.map((point, index) => mesh.vertex(place(point), n, uvs[index]));
    oriented(mesh, ids[0], ids[1], ids[2]);
    oriented(mesh, ids[0], ids[2], ids[3]);
  };
  for (const rect of rectangles(mask)) {
    const [xa, xb, yb, yt] = [x(rect.c0), x(rect.c1), y(rect.r1), y(rect.r0)];
    const [ua, ub, vb, vt] = [u(rect.c0), u(rect.c1), v(rect.r1), v(rect.r0)];
    quad([[xa, yb, front], [xb, yb, front], [xb, yt, front], [xa, yt, front]], [0, 0, 1], [tex(ua, vb), tex(ub, vb), tex(ub, vt), tex(ua, vt)]);
    /* Спинка — зеркалом: с обратной стороны картинка читается не задом наперёд. */
    quad([[xb, yb, back], [xa, yb, back], [xa, yt, back], [xb, yt, back]], [0, 0, -1], [tex(ua, vb), tex(ub, vb), tex(ub, vt), tex(ua, vt)]);
  }
  const at = (col, row) => (col >= 0 && row >= 0 && col < cols && row < rows ? filled[row * cols + col] : 0);
  const centre = (col, row) => tex(u(col + 0.5), v(row + 0.5));
  /* Бока по контуру: соседняя клетка пуста — грань наружу, отрезками. */
  for (let row = 0; row < rows; row += 1)
    for (const dr of [-1, 1]) {
      let col = 0;
      while (col < cols) {
        if (!at(col, row) || at(col, row + dr)) {
          col += 1;
          continue;
        }
        let end = col + 1;
        while (end < cols && at(end, row) && !at(end, row + dr)) end += 1;
        const yy = dr < 0 ? y(row) : y(row + 1);
        const [uvA, uvB] = [centre(col, row), centre(end - 1, row)];
        quad([[x(col), yy, front], [x(end), yy, front], [x(end), yy, back], [x(col), yy, back]], [0, dr < 0 ? 1 : -1, 0], [uvA, uvB, uvB, uvA]);
        col = end;
      }
    }
  for (let col = 0; col < cols; col += 1)
    for (const dc of [-1, 1]) {
      let row = 0;
      while (row < rows) {
        if (!at(col, row) || at(col + dc, row)) {
          row += 1;
          continue;
        }
        let end = row + 1;
        while (end < rows && at(col, end) && !at(col + dc, end)) end += 1;
        const xx = dc < 0 ? x(col) : x(col + 1);
        const [uvT, uvB] = [centre(col, row), centre(col, end - 1)];
        quad([[xx, y(end), back], [xx, y(end), front], [xx, y(row), front], [xx, y(row), back]], [dc, 0, 0], [uvB, uvB, uvT, uvT]);
        row = end;
      }
    }
  return { width: cols * cell, height: rows * cell };
}

/**
 * Голограмма в осях украшения (z — нормаль поверхности, единица — размер):
 * в построитель `mesh`. `pixels` — `{ rgba, width, height }` PNG окна.
 * `false` — в картинке нет фигуры.
 */
export function hologramLocalMesh(mesh, decoration, pixels, lod = "high") {
  const quality = HOLOGRAM_QUALITY[lod] || HOLOGRAM_QUALITY.high;
  const sizeCm = Math.max(0.1, decoration.size);
  const depth = decoration.depth / 10 / sizeCm;
  const glow = decoration.variant === "glow";
  const lift = glow ? Math.max(decoration.lift / 10 / sizeCm, 0.06) : decoration.lift / 10 / sizeCm;
  const stand = decoration.pose === "stand";
  for (const cells of quality.cells) {
    const mask = hologramMask(pixels?.rgba, pixels?.width, pixels?.height, cells);
    if (!mask) return false;
    const trial = builder();
    const shape = { w: 0, h: 0 };
    const place = (p) => (stand ? [p[2], p[0], p[1] + lift] : [p[0], p[1] - shape.h / 2, p[2] + depth / 2 + lift]);
    const turn = (n) => (stand ? [n[2], n[0], n[1]] : n);
    /* Высота фигуры нужна раньше, чем она построена: считается по маске. */
    const cell = 1 / Math.max(mask.cols, mask.rows);
    shape.h = mask.rows * cell;
    shape.w = mask.cols * cell;
    figure(trial, mask, { depth, place, turn });
    if (glow) hologramStand(trial, { stand, lift, width: shape.w, height: shape.h, depth, segments: quality.emitter });
    if (trial.positions.length / 3 > quality.limit && cells !== quality.cells.at(-1)) continue;
    /* Перенос в общий построитель. */
    const base = mesh.positions.length / 3;
    for (let index = 0; index < trial.positions.length / 3; index += 1)
      mesh.vertex(trial.positions.slice(index * 3, index * 3 + 3), trial.normals.slice(index * 3, index * 3 + 3), trial.uvs.slice(index * 2, index * 2 + 2));
    for (const index of trial.indices) mesh.indices.push(base + index);
    return true;
  }
  return false;
}

/*
 * Излучатель на поверхности и луч к фигуре — у светящейся голограммы:
 * шестигранная шайба цветом излучателя и полупрозрачные грани луча.
 */
function hologramStand(mesh, { stand, lift, width, height, depth, segments }) {
  const puck = 0.035;
  prism(mesh, { outline: circleOutline(0.16, segments), centre: [0, 0, puck / 2], depth: puck, uv: HOLOGRAM_EMITTER_UV, sideUv: HOLOGRAM_EMITTER_UV });
  if (lift <= puck + 0.02) return;
  const r = 0.11;
  const beam = { double: true };
  if (stand) {
    facet(mesh, [0, -r, puck], [0, r, puck], [0, width / 2, lift], HOLOGRAM_BEAM_UV, beam);
    facet(mesh, [0, -r, puck], [0, width / 2, lift], [0, -width / 2, lift], HOLOGRAM_BEAM_UV, beam);
    facet(mesh, [-r, 0, puck], [r, 0, puck], [depth / 2, 0, lift], HOLOGRAM_BEAM_UV, beam);
    facet(mesh, [-r, 0, puck], [depth / 2, 0, lift], [-depth / 2, 0, lift], HOLOGRAM_BEAM_UV, beam);
    return;
  }
  const low = [[-r, -r], [r, -r], [r, r], [-r, r]];
  const high = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
  for (let side = 0; side < 4; side += 1) {
    const next = (side + 1) % 4;
    const a = [...low[side], puck];
    const b = [...low[next], puck];
    const c = [...high[next], lift];
    const d = [...high[side], lift];
    facet(mesh, a, b, c, HOLOGRAM_BEAM_UV, beam);
    facet(mesh, a, c, d, HOLOGRAM_BEAM_UV, beam);
  }
}

/* ------------------------------ лист ------------------------------ */

const rgbOf = (hex) => [1, 3, 5].map((offset) => Number.parseInt(String(hex).slice(offset, offset + 2), 16) || 0);

/*
 * Картинка в квадрат `size` (вписать, по середине) — усреднение по площади
 * с весом прозрачности: края не темнеют. Чистая арифметика: в окне и у
 * Astral Desktop — одни и те же числа.
 */
export function fitRgba(source, width, height, size) {
  const out = new Float64Array(size * size * 4);
  const factor = Math.min(size / width, size / height);
  const w = width * factor;
  const h = height * factor;
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  for (let ty = 0; ty < size; ty += 1)
    for (let tx = 0; tx < size; tx += 1) {
      /* Клетка цели в пикселях источника. */
      const sx0 = (tx - ox) / factor;
      const sx1 = (tx + 1 - ox) / factor;
      const sy0 = (ty - oy) / factor;
      const sy1 = (ty + 1 - oy) / factor;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let sy = Math.max(0, Math.floor(sy0)); sy < Math.min(height, Math.ceil(sy1)); sy += 1) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = Math.max(0, Math.floor(sx0)); sx < Math.min(width, Math.ceil(sx1)); sx += 1) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const at = (sy * width + sx) * 4;
          const alpha = source[at + 3] / 255;
          r += source[at] * alpha * weight;
          g += source[at + 1] * alpha * weight;
          b += source[at + 2] * alpha * weight;
          a += alpha * weight;
          area += weight;
        }
      }
      const at = (ty * size + tx) * 4;
      if (a > 0) {
        out[at] = r / a;
        out[at + 1] = g / a;
        out[at + 2] = b / a;
      }
      out[at + 3] = area > 0 ? (a / ((sx1 - sx0) * (sy1 - sy0))) * 255 : 0;
    }
  return out;
}

/**
 * Лист голограммы 128×128 `{ width, height, rgba }`: картинка (надпись — в
 * цвет украшения; у светящейся — всё в цвет, с прозрачностью и строками
 * развёртки), под ней полосы луча и излучателя.
 */
export function hologramTexture(pixels, decoration) {
  const size = HOLOGRAM_TEXTURE_SIZE;
  const rgba = new Uint8Array(size * size * 4);
  const glow = decoration.variant === "glow";
  const tint = glow || !decoration.source;
  const colour = rgbOf(decoration.colour);
  const accent = rgbOf(decoration.accent);
  const opacity = glow ? decoration.opacity / 100 : 1;
  const fitted = pixels?.rgba ? fitRgba(pixels.rgba, pixels.width, pixels.height, BOX.size) : new Float64Array(BOX.size * BOX.size * 4);
  const set = (x, y, [r, g, b], a) => {
    const at = (y * size + x) * 4;
    rgba[at] = Math.round(Math.min(255, Math.max(0, r)));
    rgba[at + 1] = Math.round(Math.min(255, Math.max(0, g)));
    rgba[at + 2] = Math.round(Math.min(255, Math.max(0, b)));
    rgba[at + 3] = Math.round(Math.min(255, Math.max(0, a)));
  };
  for (let y = 0; y < BEAM_ROWS[0]; y += 1)
    for (let x = 0; x < size; x += 1) {
      const inside = x >= BOX.x && x < BOX.x + BOX.size && y >= BOX.y && y < BOX.y + BOX.size;
      if (!inside) {
        set(x, y, glow ? colour : accent, 0);
        continue;
      }
      const at = ((y - BOX.y) * BOX.size + (x - BOX.x)) * 4;
      let rgb = [fitted[at], fitted[at + 1], fitted[at + 2]];
      let alpha = fitted[at + 3];
      if (tint) {
        const light = Math.max(rgb[0], rgb[1], rgb[2]) / 255;
        const keep = 0.35 + 0.65 * light;
        rgb = colour.map((value) => value * keep);
      }
      if (glow) {
        alpha *= opacity;
        /* Строки развёртки: каждая четвёртая — прозрачнее. */
        if (y % 4 === 3) alpha *= 0.55;
        if (alpha < 1) rgb = colour;
      }
      set(x, y, rgb, alpha);
    }
  if (!glow) bleed(rgba, size, BEAM_ROWS[0], accent);
  for (let y = BEAM_ROWS[0]; y < BEAM_ROWS[1]; y += 1)
    for (let x = 0; x < size; x += 1) set(x, y, glow ? colour : accent, glow ? 110 * opacity : 255);
  for (let y = EMITTER_ROWS[0]; y < EMITTER_ROWS[1]; y += 1) for (let x = 0; x < size; x += 1) set(x, y, accent, 255);
  return { width: size, height: size, rgba };
}

/*
 * Непрозрачная фигура: прозрачные точки берут цвет соседей (на краю
 * клетки фильтр текстуры не тянет тёмное), потом весь лист — сплошной.
 */
function bleed(rgba, size, rows, fallback) {
  const known = new Uint8Array(size * rows);
  for (let index = 0; index < size * rows; index += 1) known[index] = rgba[index * 4 + 3] >= 128 ? 1 : 0;
  for (let pass = 0; pass < 12; pass += 1) {
    const next = known.slice();
    let changed = false;
    for (let y = 0; y < rows; y += 1)
      for (let x = 0; x < size; x += 1) {
        const index = y * size + x;
        if (known[index]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= rows || !known[ny * size + nx]) continue;
          const at = (ny * size + nx) * 4;
          r += rgba[at];
          g += rgba[at + 1];
          b += rgba[at + 2];
          count += 1;
        }
        if (!count) continue;
        rgba[index * 4] = Math.round(r / count);
        rgba[index * 4 + 1] = Math.round(g / count);
        rgba[index * 4 + 2] = Math.round(b / count);
        next[index] = 1;
        changed = true;
      }
    known.set(next);
    if (!changed) break;
  }
  for (let index = 0; index < size * rows; index += 1) {
    if (!known[index]) [rgba[index * 4], rgba[index * 4 + 1], rgba[index * 4 + 2]] = fallback;
    rgba[index * 4 + 3] = 255;
  }
}

