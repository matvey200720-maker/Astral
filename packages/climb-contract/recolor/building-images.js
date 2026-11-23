/*
 * Картинки плашек зданий — одна арифметика у кадра окна и у установщика.
 *
 * Сторона фасада едет в игру плашкой на всю стену (`compile-emblem-plates`):
 *   «Свой баннер» — картинка человека, подогнанная под пропорцию стены
 *     (`fitImagePixels`: заполнить — без искажений, лишнее обрезается;
 *     вписать — целиком, поля цветом фона; растянуть — по стене);
 *   «Покрасить» — цвет с эффектом (`colourEffectAt`) поверх рельефа
 *     штатной стены (`sideColourPixels`): яркость листа стены той же
 *     плотностью, что у игры, — панели, швы и кирпич остаются видны, и
 *     сторона выглядит покрашенной, а не заклеенной.
 */

import { colourEffectAt, normalizeColourEffect } from "./colour-effects.js";
import { hexBytes } from "./colour.js";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* Билинейная выборка (края — прижаты; `wrap` — повтор). */
function sample(image, u, v, out, wrap = false) {
  const x = u * image.width - 0.5;
  const y = v * image.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  const pick = (px, py) => {
    const cx = wrap ? ((px % image.width) + image.width) % image.width : clamp(px, 0, image.width - 1);
    const cy = wrap ? ((py % image.height) + image.height) % image.height : clamp(py, 0, image.height - 1);
    return (cy * image.width + cx) * 4;
  };
  for (const [dx, dy, weight] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ]) {
    const at = pick(x0 + dx, y0 + dy);
    for (let channel = 0; channel < 4; channel += 1) out[channel] += image.rgba[at + channel] * weight;
  }
  return out;
}

/*
 * Уменьшение больше чем вдвое — средним по клеткам (без ряби), дальше —
 * билинейно: картинка 4000 px на плашку 2048 не «мылится» и не рябит.
 */
function reduce(image, width, height) {
  const kx = image.width / width;
  const ky = image.height / height;
  if (kx < 2 && ky < 2) return image;
  const stepX = Math.max(1, Math.floor(kx / 1.5));
  const stepY = Math.max(1, Math.floor(ky / 1.5));
  const w = Math.max(1, Math.floor(image.width / stepX));
  const h = Math.max(1, Math.floor(image.height / stepY));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let j = 0; j < stepY; j += 1)
        for (let i = 0; i < stepX; i += 1) {
          const at = ((y * stepY + j) * image.width + (x * stepX + i)) * 4;
          for (let channel = 0; channel < 4; channel += 1) sum[channel] += image.rgba[at + channel];
        }
      const at = (y * w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) out[at + channel] = sum[channel] / (stepX * stepY);
    }
  return { rgba: out, width: w, height: h };
}

/**
 * Картинка человека в плашку `width × height` (RGBA): `fit` — `cover`
 * (заполнить, лишнее обрезается поровну), `contain` (вписать, поля — цвет
 * `background`), `stretch` (растянуть по стене). Пропорции картинки при
 * `cover` и `contain` не искажаются: `aspect` — пропорция самой стены в
 * метрах (лист плашки — степени двойки и растянется на стену по ней).
 */
export function fitImagePixels(image, width, height, { fit = "cover", background = "#101010", aspect: wallAspect = null } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  const fill = hexBytes(background);
  const target = wallAspect > 0 ? wallAspect : width / height;
  const aspect = image.width / Math.max(1, image.height);
  /* Окно картинки, что ложится на плашку (доли картинки) и куда (доли плашки). */
  let src = [0, 0, 1, 1];
  let dst = [0, 0, 1, 1];
  if (fit === "cover") {
    if (aspect > target) {
      const share = target / aspect;
      src = [(1 - share) / 2, 0, (1 + share) / 2, 1];
    } else {
      const share = aspect / target;
      src = [0, (1 - share) / 2, 1, (1 + share) / 2];
    }
  } else if (fit === "contain") {
    if (aspect > target) {
      const share = target / aspect;
      dst = [0, (1 - share) / 2, 1, (1 + share) / 2];
    } else {
      const share = aspect / target;
      dst = [(1 - share) / 2, 0, (1 + share) / 2, 1];
    }
  }
  const visibleWidth = Math.max(1, Math.round((dst[2] - dst[0]) * width));
  const visibleHeight = Math.max(1, Math.round((dst[3] - dst[1]) * height));
  const source = reduce(image, Math.max(1, visibleWidth / (src[2] - src[0])), Math.max(1, visibleHeight / (src[3] - src[1])));
  const colour = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const s = (x + 0.5) / width;
      const t = (y + 0.5) / height;
      out[at] = fill[0];
      out[at + 1] = fill[1];
      out[at + 2] = fill[2];
      out[at + 3] = 255;
      if (s < dst[0] || s > dst[2] || t < dst[1] || t > dst[3]) continue;
      const u = src[0] + ((s - dst[0]) / (dst[2] - dst[0])) * (src[2] - src[0]);
      const v = src[1] + ((t - dst[1]) / (dst[3] - dst[1])) * (src[3] - src[1]);
      sample(source, u, v, colour);
      const alpha = colour[3] / 255;
      for (let channel = 0; channel < 3; channel += 1) out[at + channel] = colour[channel] * alpha + fill[channel] * (1 - alpha);
    }
  return out;
}

/**
 * Баннер стороны — до краёв своей рамки (`side.banner.rect`, доли плашки,
 * t сверху вниз): у прямоугольной стены рамка — вся плашка, у стены уступом
 * — самая большая часть стены (опись). Вне рамки плашка прозрачна, внутри
 * картинка целиком, без обрезки маской. Плашка `width × height` (RGBA).
 */
export function sideBannerPixels(image, width, height, side, { fit = "cover", background = "#101010" } = {}) {
  const rect = side?.banner?.rect;
  if (!rect) return fitImagePixels(image, width, height, { fit, background, aspect: side.width / side.height });
  const x0 = Math.round(rect[0] * width);
  const y0 = Math.round(rect[1] * height);
  const x1 = Math.max(x0 + 1, Math.round(rect[2] * width));
  const y1 = Math.max(y0 + 1, Math.round(rect[3] * height));
  const inner = fitImagePixels(image, x1 - x0, y1 - y0, { fit, background, aspect: side.banner.width / Math.max(0.01, side.banner.height) });
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = y0; y < y1; y += 1) out.set(inner.subarray((y - y0) * (x1 - x0) * 4, (y - y0 + 1) * (x1 - x0) * 4), (y * width + x0) * 4);
  return out;
}

/*
 * Яркость рельефа: средняя по листу — опора, тексель темнее — тень, светлее —
 * блик (в пределах 0,45…1,35 — без чёрных провалов и пересветов).
 */
function reliefLuma(relief) {
  let sum = 0;
  const count = relief.width * relief.height;
  for (let at = 0; at < relief.rgba.length; at += 4) sum += 0.2126 * relief.rgba[at] + 0.7152 * relief.rgba[at + 1] + 0.0722 * relief.rgba[at + 2];
  return Math.max(8, sum / Math.max(1, count));
}

/**
 * Цвет стороны с эффектом: `look` — эффект работы (`along` — вдоль стены,
 * `across`/`height` — снизу вверх); `relief` — лист штатной стены
 * `{ rgba, width, height, repeat, vertical: [у низа, у верха], swap }`
 * (опись стороны: сколько раз лист ложится по ширине стены и какой кусок
 * атласа стоит по высоте) или `null` — ровная краска. Плашка `width ×
 * height` (RGBA, непрозрачная).
 */
export function sideColourPixels(input, width, height, { relief = null } = {}) {
  const look = normalizeColourEffect(input);
  const out = new Uint8ClampedArray(width * height * 4);
  const mean = relief ? reliefLuma(relief) : 1;
  const repeat = Math.max(0.05, relief?.repeat || 1);
  const [bottom, top] = relief?.vertical || [1, 0];
  const steps = 128;
  const strip = Array.from({ length: steps }, (_, index) => colourEffectAt(look, index / (steps - 1)));
  const texel = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const s = (x + 0.5) / width;
      const t = 1 - (y + 0.5) / height;
      let share = look.direction === "along" ? s : t;
      if (look.mode === "line") share = (share * 8) % 1;
      const colour = strip[Math.min(steps - 1, Math.round(share * (steps - 1)))];
      let factor = 1;
      if (relief) {
        const across = (s * repeat) % 1;
        const along = top + (bottom - top) * (1 - t);
        sample(relief, relief.swap ? along : across, relief.swap ? across : along, texel, true);
        const value = 0.2126 * texel[0] + 0.7152 * texel[1] + 0.0722 * texel[2];
        factor = clamp(0.35 + 0.65 * (value / mean), 0.45, 1.35);
      }
      const at = (y * width + x) * 4;
      out[at] = clamp(colour[0] * factor, 0, 255);
      out[at + 1] = clamp(colour[1] * factor, 0, 255);
      out[at + 2] = clamp(colour[2] * factor, 0, 255);
      out[at + 3] = 255;
    }
  return out;
}

/**
 * Размер листа плашки стороны: степени двойки по пропорции стены, длинная
 * сторона — 2048 (меньше — если картинка меньше), короткая — не меньше 64.
 */
export function sidePlateSize(widthMetres, heightMetres, longest = 2048) {
  const powerOfTwo = (value) => 2 ** Math.round(Math.log2(Math.max(1, value)));
  const aspect = widthMetres / Math.max(0.01, heightMetres);
  if (aspect >= 1) return [longest, clamp(powerOfTwo(longest / aspect), 64, longest)];
  return [clamp(powerOfTwo(longest * aspect), 64, longest), longest];
}

/**
 * Остров листа — прямой картинкой, как его видно спереди: `base` — лист
 * (`{ rgba, width, height }`), `island` — опись (`rect`, `swap`, `flipU`,
 * `flipV`, `aspect`). Обратная к раскладке `placeImageInIslands`: что
 * человек видит на стене, то и вырезается.
 */
export function islandImage(base, island, { longest = 512 } = {}) {
  const [u0, v0, u1, v1] = island.rect;
  const spanX = Math.max(1, (u1 - u0) * base.width);
  const spanY = Math.max(1, (v1 - v0) * base.height);
  const aspect = island.aspect > 0 ? island.aspect : island.swap ? spanY / spanX : spanX / spanY;
  const width = Math.max(4, Math.round(aspect >= 1 ? Math.min(longest, island.swap ? spanY : spanX) : Math.min(longest, island.swap ? spanY : spanX) ));
  const height = Math.max(4, Math.round(width / Math.max(0.05, aspect)));
  const out = new Uint8ClampedArray(width * height * 4);
  const texel = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const p = (x + 0.5) / width;
      const q = (y + 0.5) / height;
      const along = island.swap ? q : p;
      const across = island.swap ? p : q;
      const s = island.flipU ? 1 - along : along;
      const t = island.flipV ? 1 - across : across;
      sample(base, u0 + s * (u1 - u0), v0 + t * (v1 - v0), texel);
      out.set(texel, (y * width + x) * 4);
    }
  return { rgba: out, width, height };
}

/**
 * Картинка поверх плашки в прямоугольнике `rect` — `[s0, t0, s1, t1]`
 * долями плашки (t сверху вниз), с прозрачностью картинки. Правит `rgba`.
 */
export function printOnPlate(rgba, width, height, rect, image) {
  const x0 = Math.max(0, Math.floor(rect[0] * width));
  const y0 = Math.max(0, Math.floor(rect[1] * height));
  const x1 = Math.min(width, Math.ceil(rect[2] * width));
  const y1 = Math.min(height, Math.ceil(rect[3] * height));
  const spanX = (rect[2] - rect[0]) * width;
  const spanY = (rect[3] - rect[1]) * height;
  if (spanX < 1 || spanY < 1) return rgba;
  const colour = [0, 0, 0, 0];
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const u = (x + 0.5 - rect[0] * width) / spanX;
      const v = (y + 0.5 - rect[1] * height) / spanY;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      sample(image, u, v, colour);
      const alpha = colour[3] / 255;
      if (alpha <= 0.01) continue;
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = rgba[at + channel] + (colour[channel] - rgba[at + channel]) * alpha;
    }
  return rgba;
}

/* Биты маски стороны из base64 (окно и главный процесс читают одинаково). */
const maskBitsCache = new Map();
function maskBits(mask) {
  if (maskBitsCache.has(mask.bits)) return maskBitsCache.get(mask.bits);
  const text = typeof atob === "function" ? atob(mask.bits) : Buffer.from(mask.bits, "base64").toString("latin1");
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  if (maskBitsCache.size > 32) maskBitsCache.clear();
  maskBitsCache.set(mask.bits, bytes);
  return bytes;
}

/** Есть ли стена в точке плашки (`s`, `t` — доли, t сверху вниз). Без маски — везде. */
export function sideMaskAt(mask, s, t) {
  if (!mask?.bits || !mask.cols || !mask.rows) return true;
  const x = Math.min(mask.cols - 1, Math.max(0, Math.floor(s * mask.cols)));
  const y = Math.min(mask.rows - 1, Math.max(0, Math.floor(t * mask.rows)));
  const index = y * mask.cols + x;
  return (maskBits(mask)[index >> 3] & (0x80 >> (index & 7))) !== 0;
}

/**
 * Верх синей стены Мегамолла (`mask.top`, ТЗ 26.10.2026): на стойках стена кончается ниже, чем между ними, и лист плашки над
 * низким местом прозрачен — картинка повторяет верх стены, а не висит над стойкой. `top` — `{ width, z: [низ, верх плашки],
 * steps: [[от, до, верх стены]] }` (метры от левого края плашки / метры сцены); `[from, to]` — доли ширины, что занимает лист
 * (панель широкой стены). Край смягчён: пиксель на границе берёт долю по высоте. Правит `rgba`.
 */
function trimTopProfile(rgba, width, height, top, [from, to] = [0, 1]) {
  const [bottom, ceiling] = top.z;
  const rowHeight = (ceiling - bottom) / height;
  for (let x = 0; x < width; x += 1) {
    const u = (from + ((x + 0.5) / width) * (to - from)) * top.width;
    const step = top.steps.find((entry) => u >= entry[0] && u < entry[1]) || top.steps.at(-1);
    const wall = step[2];
    if (wall >= ceiling) continue;
    for (let y = 0; y < height; y += 1) {
      /* Высота центра строки (сверху вниз) и доля строки ниже верха стены. */
      const z = ceiling - (y + 0.5) * rowHeight;
      const share = Math.min(1, Math.max(0, (wall - (z - rowHeight / 2)) / rowHeight));
      if (share >= 1) break;
      const at = (y * width + x) * 4 + 3;
      rgba[at] = Math.round(rgba[at] * share);
    }
  }
}

/**
 * Плашка стороны — строго по стене (05.10.2026): там, где у стороны нет
 * стены (маска описи `side.mask` — грани плоскости стены), пиксели
 * прозрачны, и цвет или баннер не торчат над низкой крышей и за углом.
 * Край смягчён на пиксель (выборка 2×2 внутри пикселя): без лесенки по
 * клеткам маски. Правит `rgba`.
 */
export function maskSidePlate(rgba, width, height, mask, [from, to] = [0, 1]) {
  if (!mask?.bits || !mask.cols || !mask.rows) return rgba;
  if (mask.top) trimTopProfile(rgba, width, height, mask.top, [from, to]);
  const bits = maskBits(mask);
  const cell = (value, count, span) => Math.min(count - 1, Math.max(0, Math.floor((value / span) * count)));
  /* Клетки маски для двух выборок на пиксель по каждой оси; `[from, to]` — доли
     ширины стены, что занимает плашка (панель широкой стены: кусок маски). */
  const columns = new Int32Array(width * 2);
  const across = (x) => (from + ((x / width) * (to - from))) * mask.cols;
  for (let x = 0; x < width; x += 1) {
    columns[x * 2] = Math.min(mask.cols - 1, Math.max(0, Math.floor(across(x + 0.25))));
    columns[x * 2 + 1] = Math.min(mask.cols - 1, Math.max(0, Math.floor(across(x + 0.75))));
  }
  const has = (row, column) => {
    const index = row * mask.cols + column;
    return (bits[index >> 3] & (0x80 >> (index & 7))) !== 0;
  };
  for (let y = 0; y < height; y += 1) {
    const rowA = cell(y + 0.25, mask.rows, height);
    const rowB = cell(y + 0.75, mask.rows, height);
    for (let x = 0; x < width; x += 1) {
      const c0 = columns[x * 2];
      const c1 = columns[x * 2 + 1];
      const inside = has(rowA, c0) + has(rowA, c1) + has(rowB, c0) + has(rowB, c1);
      if (inside === 4) continue;
      const at = (y * width + x) * 4 + 3;
      rgba[at] = Math.round((rgba[at] * inside) / 4);
    }
  }
  return rgba;
}

/**
 * Панель широкой стены — кусок целой картинки стены `wall` (`{ rgba, width,
 * height }`) по долям ширины `[s0, s1]`, растянутый на лист панели `width ×
 * height` (RGBA, непрозрачный). Маску стены по куску накладывает вызывающий
 * (`maskSidePlate(…, [s0, s1])`).
 */
export function wallPanelPixels(wall, [s0, s1], width, height) {
  const x0 = Math.max(0, Math.min(wall.width - 1, Math.round(s0 * wall.width)));
  const x1 = Math.max(x0 + 1, Math.min(wall.width, Math.round(s1 * wall.width)));
  const piece = new Uint8ClampedArray((x1 - x0) * wall.height * 4);
  for (let row = 0; row < wall.height; row += 1) piece.set(wall.rgba.subarray((row * wall.width + x0) * 4, (row * wall.width + x1) * 4), row * (x1 - x0) * 4);
  return fitImagePixels({ rgba: piece, width: x1 - x0, height: wall.height }, width, height, { fit: "stretch" });
}

/**
 * Дыра в плашке стороны (`rect` — доли плашки, t сверху вниз): пиксели
 * прозрачны — сквозь плашку видны объёмные буквы за ней или своя плашка
 * поверх них. На пиксель шире: фильтрация листа не оставляет каймы.
 */
export function clearOnPlate(rgba, width, height, rect) {
  const x0 = Math.max(0, Math.floor(rect[0] * width) - 1);
  const y0 = Math.max(0, Math.floor(rect[1] * height) - 1);
  const x1 = Math.min(width, Math.ceil(rect[2] * width) + 1);
  const y1 = Math.min(height, Math.ceil(rect[3] * height) + 1);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) rgba[(y * width + x) * 4 + 3] = 0;
  return rgba;
}
