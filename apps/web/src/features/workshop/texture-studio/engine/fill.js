/*
 * Заливки студии (ТЗ 18.10.2026, Session 1, задача 6): «ведро» (заливка по
 * близости цвета, с допуском, связная или по всему холсту), градиент
 * (линейный и радиальный из 2–8 остановок с прозрачностью) и заливка
 * выделения. Чистые функции над RGBA (`Uint8ClampedArray`, правятся на
 * месте) — их зовёт окно и рабочий поток студии. `selection` — маска
 * выделения (`selection.js`) или `null` — «всё».
 */

import { magicWand } from "./selection.js";

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` → `[r, g, b]`. */
export function hexToRgb(hex) {
  const match = HEX.exec(String(hex || "")) || HEX.exec("#000000");
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;

/** Один пиксель поверх пикселя (`weight` — доля краски, 0…1). */
function blendOver(rgba, at, colour, weight, alpha = 1) {
  const top = weight * alpha;
  if (top <= 0) return;
  const under = rgba[at + 3] / 255;
  const out = top + under * (1 - top);
  for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = out > 0 ? (colour[channel] * top + rgba[at + channel] * under * (1 - top)) / out : 0;
  rgba[at + 3] = out * 255;
}

/**
 * Рамка маски: `{ x, y, width, height }` по значимым пикселям (быстрее общей
 * `maskBounds`: строка за строкой, выход по первому).
 */
function rectOfMask(mask) {
  const { width, height, data } = mask;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1)
      if (data[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * «Ведро»: заливает цветом `colour` (`[r, g, b]`) пиксели, близкие по цвету к
 * точке (допуск `tolerance` 0…255; `contiguous` — только связная область).
 * Ответ — рамка залитого или `null`.
 */
export function bucketFill(rgba, width, height, x, y, colour, { tolerance = 32, contiguous = true, opacity = 1, selection = null } = {}) {
  const region = magicWand(rgba, width, height, x, y, { tolerance, contiguous });
  const rect = rectOfMask(region);
  if (!rect) return null;
  for (let row = rect.y; row < rect.y + rect.height; row += 1)
    for (let col = rect.x; col < rect.x + rect.width; col += 1) {
      const pixel = row * width + col;
      if (!region.data[pixel]) continue;
      const weight = selection ? selection.data[pixel] / 255 : 1;
      if (weight <= 0) continue;
      blendOver(rgba, pixel * 4, colour, weight, opacity);
    }
  return rect;
}

/** Заливка всего выделения (или всего холста) цветом. Ответ — рамка. */
export function fillSelection(rgba, width, height, colour, { opacity = 1, selection = null } = {}) {
  const rect = selection ? rectOfMask(selection) : { x: 0, y: 0, width, height };
  if (!rect) return null;
  for (let row = rect.y; row < rect.y + rect.height; row += 1)
    for (let col = rect.x; col < rect.x + rect.width; col += 1) {
      const pixel = row * width + col;
      const weight = selection ? selection.data[pixel] / 255 : 1;
      if (weight > 0) blendOver(rgba, pixel * 4, colour, weight, opacity);
    }
  return rect;
}

/**
 * Кусок пикселей `rgba` (`width × height`, левый верхний угол куска на холсте
 * — `origin`) заливается цветом целиком; `selection` — маска ВСЕГО холста
 * шириной `canvasWidth`. Ответ — `true`.
 */
export function fillMaskRegion(rgba, width, height, colour, { opacity = 1, selection = null, origin = { x: 0, y: 0 }, canvasWidth = width } = {}) {
  for (let row = 0; row < height; row += 1)
    for (let col = 0; col < width; col += 1) {
      const weight = selection ? selection.data[(origin.y + row) * canvasWidth + origin.x + col] / 255 : 1;
      if (weight > 0) blendOver(rgba, (row * width + col) * 4, colour, weight, opacity);
    }
  return true;
}

/**
 * «Ведро» по готовой маске области `region` (маска ВСЕГО холста, из палочки):
 * цвет ложится на кусок `rgba` там, где область и выделение. `origin` —
 * где кусок на холсте.
 */
export function bucketRegion(rgba, width, height, region, colour, { opacity = 1, selection = null, origin = { x: 0, y: 0 } } = {}) {
  for (let row = 0; row < height; row += 1)
    for (let col = 0; col < width; col += 1) {
      const pixel = (origin.y + row) * region.width + origin.x + col;
      if (!region.data[pixel]) continue;
      const weight = (region.data[pixel] / 255) * (selection ? selection.data[pixel] / 255 : 1);
      if (weight > 0) blendOver(rgba, (row * width + col) * 4, colour, weight, opacity);
    }
  return true;
}

/* ------------------------------------------------------------------ *
 * Градиент
 * ------------------------------------------------------------------ */

/** Цвет градиента в доле `t`: `[r, g, b, a]` по остановкам `[{ at, colour, alpha }]` (по возрастанию). */
export function gradientAt(stops, t) {
  const list = stops?.length ? stops : [{ at: 0, colour: "#000000", alpha: 1 }, { at: 1, colour: "#ffffff", alpha: 1 }];
  if (t <= list[0].at) return [...hexToRgb(list[0].colour), (list[0].alpha ?? 1) * 255];
  const last = list[list.length - 1];
  if (t >= last.at) return [...hexToRgb(last.colour), (last.alpha ?? 1) * 255];
  let at = 0;
  while (t > list[at + 1].at) at += 1;
  const a = list[at];
  const b = list[at + 1];
  const k = (t - a.at) / Math.max(1e-6, b.at - a.at);
  const ca = hexToRgb(a.colour);
  const cb = hexToRgb(b.colour);
  return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k, ((a.alpha ?? 1) + ((b.alpha ?? 1) - (a.alpha ?? 1)) * k) * 255];
}

/**
 * Градиент от точки `from` к точке `to` (линейный) или от центра `from` с
 * радиусом до `to` (радиальный) поверх пикселей (`opacity` слоя — 0…1).
 * Ответ — рамка или `null`.
 */
export function gradientFill(rgba, width, height, from, to, stops, { kind = "linear", opacity = 1, selection = null } = {}) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const rect = selection ? rectOfMask(selection) : { x: 0, y: 0, width, height };
  if (!rect) return null;
  /* Цвета градиента — таблицей на 512 долей: расчёт на каждый пиксель листа в 10 млн точек не нужен. */
  const STEPS = 512;
  const table = Array.from({ length: STEPS + 1 }, (_, index) => gradientAt(stops, index / STEPS));
  for (let row = rect.y; row < rect.y + rect.height; row += 1)
    for (let col = rect.x; col < rect.x + rect.width; col += 1) {
      const pixel = row * width + col;
      const weight = selection ? selection.data[pixel] / 255 : 1;
      if (weight <= 0) continue;
      const px = col + 0.5 - from[0];
      const py = row + 0.5 - from[1];
      const t = kind === "radial" ? Math.hypot(px, py) / length : (px * dx + py * dy) / (length * length);
      const colour = table[Math.round(Math.min(1, Math.max(0, t)) * STEPS)];
      blendOver(rgba, pixel * 4, colour, weight, (colour[3] / 255) * opacity);
    }
  return rect;
}

/** Градиент слоя-заливки на весь холст, как выглядит под углом `angle` (°: 0 — слева направо, 90 — снизу вверх). */
export function gradientEndpoints(width, height, angle) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  const half = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { from: [cx - dx * half, cy - dy * half], to: [cx + dx * half, cy + dy * half] };
}
