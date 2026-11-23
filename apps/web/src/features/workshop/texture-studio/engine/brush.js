/*
 * Кисть студии (ТЗ 18.10.2026, Session 1, задача 6): кончик (размер ×
 * жёсткость), расстановка мазков по ломаной с шагом, и пиксельные мазки для
 * инструментов, что читают то, что под кистью: штамп, восстанавливающая
 * кисть, осветлитель/затемнитель, размытие/резкость/палец. Простая краска и
 * ластик рисует холст окна (`paint-surface.js`) тем же кончиком; всё
 * остальное — функции здесь над RGBA (`Uint8ClampedArray`), чистые.
 *
 * Кончик — маска `0…255` размера `size × size`: до доли `hardness` радиуса
 * целиком, дальше плавный спад до нуля на краю.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = (t) => t * t * (3 - 2 * t);

/** Кончик кисти: `Uint8ClampedArray(size × size)`, `hardness` — 0…100 (%). */
export function brushTip(size, hardness = 80) {
  const side = Math.max(1, Math.round(size));
  const tip = new Uint8ClampedArray(side * side);
  const radius = side / 2;
  const hard = clamp(hardness / 100, 0, 1) * radius;
  for (let y = 0; y < side; y += 1)
    for (let x = 0; x < side; x += 1) {
      const distance = Math.hypot(x + 0.5 - radius, y + 0.5 - radius);
      if (distance >= radius) continue;
      const alpha = distance <= hard ? 1 : 1 - smooth((distance - hard) / Math.max(1e-6, radius - hard));
      tip[y * side + x] = Math.round(alpha * 255);
    }
  return tip;
}

/**
 * Места мазков вдоль отрезка `from → to` с шагом `spacing` px. `carry` —
 * расстояние от последнего мазка до начала отрезка (мазки идут ровно, как бы
 * ни дробили движение мыши); `null` — начало мазка: первый мазок встаёт в
 * `from`. Ответ — `{ points, carry }` (`carry` — до конца отрезка).
 */
export function dabsAlong(from, to, spacing, carry = null) {
  const step = Math.max(0.5, spacing);
  const points = [];
  let since = carry;
  if (since === null) {
    points.push([from[0], from[1]]);
    since = 0;
  }
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (!length) return { points, carry: since };
  let at = step - since;
  while (at <= length) {
    points.push([from[0] + (dx * at) / length, from[1] + (dy * at) / length]);
    at += step;
  }
  return { points, carry: length - (at - step) };
}

/** Шаг между мазками — доля размера кисти (мягкая кисть — чаще). */
export const brushSpacing = (size, hardness) => Math.max(1, size * (hardness >= 90 ? 0.12 : 0.08));

/* ------------------------------------------------------------------ *
 * Пиксельные мазки
 * ------------------------------------------------------------------ */

/* Куда лёг мазок: пересечение кончика с холстом (`null` — мимо). */
function footprint(width, height, cx, cy, side) {
  const x0 = Math.round(cx - side / 2);
  const y0 = Math.round(cy - side / 2);
  const gx0 = Math.max(0, x0);
  const gy0 = Math.max(0, y0);
  const gx1 = Math.min(width, x0 + side);
  const gy1 = Math.min(height, y0 + side);
  return gx1 > gx0 && gy1 > gy0 ? { x0, y0, gx0, gy0, gx1, gy1 } : null;
}

/* Вес пикселя в мазке: кончик × сила × выделение. */
function weightAt(tip, side, selection, width, x, y, x0, y0, strength) {
  const alpha = tip[(y - y0) * side + (x - x0)] / 255;
  if (!alpha) return 0;
  return alpha * strength * (selection ? selection.data[y * width + x] / 255 : 1);
}

/**
 * Краска: цвет `[r, g, b]` мазком с силой `strength` (0…1). Прозрачность
 * холста растёт, как у обычной кисти: верхний слой поверх нижнего.
 * Ответ — рамка тронутого `{ x, y, width, height }` или `null`.
 */
export function stampColour(rgba, width, height, cx, cy, tip, side, colour, strength = 1, selection = null) {
  const area = footprint(width, height, cx, cy, side);
  if (!area) return null;
  for (let y = area.gy0; y < area.gy1; y += 1)
    for (let x = area.gx0; x < area.gx1; x += 1) {
      const weight = weightAt(tip, side, selection, width, x, y, area.x0, area.y0, strength);
      if (!weight) continue;
      const at = (y * width + x) * 4;
      const under = rgba[at + 3] / 255;
      const out = weight + under * (1 - weight);
      for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = out > 0 ? (colour[channel] * weight + rgba[at + channel] * under * (1 - weight)) / out : 0;
      rgba[at + 3] = out * 255;
    }
  return { x: area.gx0, y: area.gy0, width: area.gx1 - area.gx0, height: area.gy1 - area.gy0 };
}

/** Ластик: непрозрачность пикселя уменьшается на вес мазка. */
export function stampErase(rgba, width, height, cx, cy, tip, side, strength = 1, selection = null) {
  const area = footprint(width, height, cx, cy, side);
  if (!area) return null;
  for (let y = area.gy0; y < area.gy1; y += 1)
    for (let x = area.gx0; x < area.gx1; x += 1) {
      const weight = weightAt(tip, side, selection, width, x, y, area.x0, area.y0, strength);
      if (!weight) continue;
      const at = (y * width + x) * 4 + 3;
      rgba[at] = rgba[at] * (1 - weight);
    }
  return { x: area.gx0, y: area.gy0, width: area.gx1 - area.gx0, height: area.gy1 - area.gy0 };
}

/**
 * Штамп: пиксели из `source` (того же размера) со сдвигом `(dx, dy)`
 * ложатся мазком. Восстанавливающая кисть (`heal`) ещё подтягивает средний
 * цвет и светлоту взятого к тому, что под мазком: заплатка не выделяется
 * пятном.
 */
export function stampClone(rgba, source, width, height, cx, cy, tip, side, offset, strength = 1, selection = null, heal = false) {
  const area = footprint(width, height, cx, cy, side);
  if (!area) return null;
  const sx = Math.round(offset[0]);
  const sy = Math.round(offset[1]);
  let shift = [0, 0, 0];
  if (heal) {
    const mean = (data, ox, oy) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = area.gy0; y < area.gy1; y += 4)
        for (let x = area.gx0; x < area.gx1; x += 4) {
          const px = clamp(x + ox, 0, width - 1);
          const py = clamp(y + oy, 0, height - 1);
          const at = (py * width + px) * 4;
          if (data[at + 3] < 8) continue;
          r += data[at];
          g += data[at + 1];
          b += data[at + 2];
          count += 1;
        }
      return count ? [r / count, g / count, b / count] : null;
    };
    const target = mean(rgba, 0, 0);
    const taken = mean(source, sx, sy);
    if (target && taken) shift = [target[0] - taken[0], target[1] - taken[1], target[2] - taken[2]];
  }
  for (let y = area.gy0; y < area.gy1; y += 1)
    for (let x = area.gx0; x < area.gx1; x += 1) {
      const weight = weightAt(tip, side, selection, width, x, y, area.x0, area.y0, strength);
      if (!weight) continue;
      const px = x + sx;
      const py = y + sy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const from = (py * width + px) * 4;
      const at = (y * width + x) * 4;
      const alpha = (source[from + 3] / 255) * weight;
      if (!alpha) continue;
      const under = rgba[at + 3] / 255;
      const out = alpha + under * (1 - alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const taken = clamp(source[from + channel] + shift[channel], 0, 255);
        rgba[at + channel] = out > 0 ? (taken * alpha + rgba[at + channel] * under * (1 - alpha)) / out : 0;
      }
      rgba[at + 3] = out * 255;
    }
  return { x: area.gx0, y: area.gy0, width: area.gx1 - area.gx0, height: area.gy1 - area.gy0 };
}

/**
 * Осветлитель / затемнитель: `amount` — −1…1 (минус — темнее). Свет
 * двигается по тонам: тени и света держатся слабее середины, как у
 * редакторов (`range`: `midtones` по умолчанию, `shadows`, `highlights`).
 */
export function stampDodgeBurn(rgba, width, height, cx, cy, tip, side, amount, range = "midtones", selection = null) {
  const area = footprint(width, height, cx, cy, side);
  if (!area) return null;
  for (let y = area.gy0; y < area.gy1; y += 1)
    for (let x = area.gx0; x < area.gx1; x += 1) {
      const weight = weightAt(tip, side, selection, width, x, y, area.x0, area.y0, Math.abs(amount) * 0.25);
      if (!weight) continue;
      const at = (y * width + x) * 4;
      const l = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
      const tone = range === "shadows" ? 1 - l : range === "highlights" ? l : 1 - Math.abs(2 * l - 1) * 0.8;
      const push = weight * tone * (amount >= 0 ? 1 : -1);
      for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = push >= 0 ? rgba[at + channel] + (255 - rgba[at + channel]) * push : rgba[at + channel] * (1 + push);
    }
  return { x: area.gx0, y: area.gy0, width: area.gx1 - area.gx0, height: area.gy1 - area.gy0 };
}

/**
 * Размытие / резкость кистью: `amount` — 0…1; `mode`: `blur` (среднее
 * соседей 3×3 по весу мазка) или `sharpen` (усиление отличия от среднего).
 */
export function stampSoften(rgba, width, height, cx, cy, tip, side, amount, mode = "blur", selection = null) {
  const area = footprint(width, height, cx, cy, side);
  if (!area) return null;
  const copy = new Uint8ClampedArray(rgba);
  for (let y = area.gy0; y < area.gy1; y += 1)
    for (let x = area.gx0; x < area.gx1; x += 1) {
      const weight = weightAt(tip, side, selection, width, x, y, area.x0, area.y0, amount);
      if (!weight) continue;
      const sums = [0, 0, 0, 0];
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = clamp(x + dx, 0, width - 1);
          const py = clamp(y + dy, 0, height - 1);
          const from = (py * width + px) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += copy[from + channel];
          count += 1;
        }
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const mean = sums[channel] / count;
        const target = mode === "blur" || channel === 3 ? mean : copy[at + channel] + (copy[at + channel] - mean) * 1.5;
        rgba[at + channel] = copy[at + channel] + (target - copy[at + channel]) * weight;
      }
    }
  return { x: area.gx0, y: area.gy0, width: area.gx1 - area.gx0, height: area.gy1 - area.gy0 };
}

/**
 * Палец: цвет под кистью тянется вслед за ней. `pickup` — пиксели, что кисть
 * несёт (`Float32Array`, `side × side × 4`, прошлый мазок), `from`/`to` не
 * нужны: перенос идёт мазок за мазком. Ответ — `{ rect, pickup }`.
 */
export function stampSmudge(rgba, width, height, cx, cy, tip, side, strength, pickup = null, selection = null) {
  const area = footprint(width, height, cx, cy, side);
  if (!area) return { rect: null, pickup };
  const carried = pickup || new Float32Array(side * side * 4);
  const fresh = !pickup;
  for (let y = area.gy0; y < area.gy1; y += 1)
    for (let x = area.gx0; x < area.gx1; x += 1) {
      const local = ((y - area.y0) * side + (x - area.x0)) * 4;
      const at = (y * width + x) * 4;
      if (fresh) {
        for (let channel = 0; channel < 4; channel += 1) carried[local + channel] = rgba[at + channel];
        continue;
      }
      const weight = weightAt(tip, side, selection, width, x, y, area.x0, area.y0, strength);
      if (weight) for (let channel = 0; channel < 4; channel += 1) rgba[at + channel] = rgba[at + channel] + (carried[local + channel] - rgba[at + channel]) * weight;
      for (let channel = 0; channel < 4; channel += 1) carried[local + channel] = carried[local + channel] * (1 - strength * 0.5) + rgba[at + channel] * strength * 0.5;
    }
  return { rect: { x: area.gx0, y: area.gy0, width: area.gx1 - area.gx0, height: area.gy1 - area.gy0 }, pickup: carried };
}
