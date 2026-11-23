/*
 * Коррекции цвета студии (ТЗ 18.10.2026, Session 1, задача 6): уровни,
 * кривые, цветовой тон/насыщенность, цветовой баланс, яркость/контраст,
 * чёрно-белое, инверсия, порог, постеризация. Чистые функции над RGBA
 * (`Uint8ClampedArray`, правятся на месте): корректирующий слой зовёт их над
 * тем, что под ним, а кисть коррекции и окно «Коррекция» — над выделением.
 *
 * Покрасочные таблицы (`lutLevels`, `lutCurves`, …) возвращают `Uint8Array(256)`
 * — по ним же коррекция считается и в рабочем потоке. `mask` (маска
 * выделения или слоя, `selection.js`) — доля применения пикселя: край
 * выделения не рвётся.
 */

const clamp255 = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Уровни: вход `[inLow, inHigh]`, середина `gamma`, выход `[outLow, outHigh]`. */
export function lutLevels({ inLow = 0, inHigh = 255, gamma = 1, outLow = 0, outHigh = 255 } = {}) {
  const lut = new Uint8Array(256);
  const span = Math.max(1, inHigh - inLow);
  const inverse = 1 / Math.max(0.01, gamma);
  for (let at = 0; at < 256; at += 1) {
    const unit = clamp01((at - inLow) / span) ** inverse;
    lut[at] = Math.round(clamp255(outLow + unit * (outHigh - outLow)));
  }
  return lut;
}

/**
 * Кривая через точки `[[вход, выход], …]` плавным монотонным сплайном
 * (Фритч — Карлсон): без «волн» между точками, как у кривых редакторов.
 */
export function lutCurves(points) {
  const list = (Array.isArray(points) && points.length >= 2 ? points : [[0, 0], [255, 255]]).map(([x, y]) => [clamp255(x), clamp255(y)]).sort((a, b) => a[0] - b[0]);
  const xs = list.map((point) => point[0]);
  const ys = list.map((point) => point[1]);
  const count = xs.length;
  const slopes = [];
  for (let at = 0; at < count - 1; at += 1) slopes.push((ys[at + 1] - ys[at]) / Math.max(1e-6, xs[at + 1] - xs[at]));
  const tangent = new Array(count).fill(0);
  tangent[0] = slopes[0];
  tangent[count - 1] = slopes[count - 2];
  for (let at = 1; at < count - 1; at += 1) tangent[at] = slopes[at - 1] * slopes[at] <= 0 ? 0 : (slopes[at - 1] + slopes[at]) / 2;
  for (let at = 0; at < count - 1; at += 1) {
    if (Math.abs(slopes[at]) < 1e-9) {
      tangent[at] = 0;
      tangent[at + 1] = 0;
      continue;
    }
    const a = tangent[at] / slopes[at];
    const b = tangent[at + 1] / slopes[at];
    const size = Math.hypot(a, b);
    if (size > 3) {
      tangent[at] = (3 * a * slopes[at]) / size;
      tangent[at + 1] = (3 * b * slopes[at]) / size;
    }
  }
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    if (value <= xs[0]) lut[value] = Math.round(ys[0]);
    else if (value >= xs[count - 1]) lut[value] = Math.round(ys[count - 1]);
    else {
      let segment = 0;
      while (value > xs[segment + 1]) segment += 1;
      const h = xs[segment + 1] - xs[segment];
      const t = (value - xs[segment]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      const y = (2 * t3 - 3 * t2 + 1) * ys[segment] + (t3 - 2 * t2 + t) * h * tangent[segment] + (-2 * t3 + 3 * t2) * ys[segment + 1] + (t3 - t2) * h * tangent[segment + 1];
      lut[value] = Math.round(clamp255(y));
    }
  }
  return lut;
}

/** Яркость и контраст (−100…100): как у редакторов — контраст вокруг середины, яркость — сдвигом. */
export function lutBrightnessContrast({ brightness = 0, contrast = 0 } = {}) {
  const lut = new Uint8Array(256);
  const shift = (brightness / 100) * 127;
  const slope = contrast >= 0 ? 1 + (contrast / 100) * 4 : 1 + contrast / 100;
  for (let at = 0; at < 256; at += 1) lut[at] = Math.round(clamp255((at - 127.5) * slope + 127.5 + shift));
  return lut;
}

export function lutThreshold({ level = 128 } = {}) {
  const lut = new Uint8Array(256);
  for (let at = 0; at < 256; at += 1) lut[at] = at >= level ? 255 : 0;
  return lut;
}

export function lutPosterize({ levels = 4 } = {}) {
  const lut = new Uint8Array(256);
  const steps = Math.max(2, Math.round(levels));
  for (let at = 0; at < 256; at += 1) lut[at] = Math.round((Math.min(steps - 1, Math.floor((at / 256) * steps)) / (steps - 1)) * 255);
  return lut;
}

export const lutInvert = () => Uint8Array.from({ length: 256 }, (_, at) => 255 - at);

/* ------------------------------------------------------------------ *
 * Цветовое пространство: тон / насыщенность / светлота
 * ------------------------------------------------------------------ */

export function rgbToHsl(r, g, b) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0);
  else if (max === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p, q, t) {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

export function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3) * 255, hueToRgb(p, q, h) * 255, hueToRgb(p, q, h - 1 / 3) * 255];
}

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* ------------------------------------------------------------------ *
 * Применение
 * ------------------------------------------------------------------ */

/* Таблицы по виду коррекции; у остальных (тон, баланс, ч/б) — расчёт по пикселю. */
export function lutOf(kind, params) {
  switch (kind) {
    case "levels":
      return lutLevels(params);
    case "curves":
      return lutCurves(params.points);
    case "brightness-contrast":
      return lutBrightnessContrast(params);
    case "threshold":
      return lutThreshold(params);
    case "posterize":
      return lutPosterize(params);
    case "invert":
      return lutInvert();
    default:
      return null;
  }
}

/** Коррекция выведена в тождество (ничего не меняет)? Тогда слой можно не считать. */
export function adjustIsIdentity(kind, params) {
  switch (kind) {
    case "levels":
      return params.inLow === 0 && params.inHigh === 255 && params.gamma === 1 && params.outLow === 0 && params.outHigh === 255;
    case "curves":
      return params.points.every(([x, y]) => x === y);
    case "hue-saturation":
      return !params.hue && !params.saturation && !params.lightness;
    case "color-balance":
      return [...params.shadows, ...params.midtones, ...params.highlights].every((value) => !value);
    case "brightness-contrast":
      return !params.brightness && !params.contrast;
    default:
      return false;
  }
}

/**
 * Применить коррекцию к RGBA на месте. `region` — `{ x, y, width, height }`
 * куска (по умолчанию весь холст), `mask` — маска выделения на весь холст.
 * Прозрачность пикселей не трогается.
 */
export function applyAdjustment(rgba, width, height, kind, params, { mask = null, region = null } = {}) {
  const x0 = Math.max(0, region?.x ?? 0);
  const y0 = Math.max(0, region?.y ?? 0);
  const x1 = Math.min(width, x0 + (region?.width ?? width));
  const y1 = Math.min(height, y0 + (region?.height ?? height));
  const lut = lutOf(kind, params);
  let pixel;
  if (lut) {
    pixel = (px) => {
      px[0] = lut[px[0]];
      px[1] = lut[px[1]];
      px[2] = lut[px[2]];
    };
  } else if (kind === "hue-saturation") {
    const hueShift = params.hue / 360;
    const saturation = params.saturation / 100;
    const lightness = params.lightness / 100;
    pixel = (px) => {
      const [h, s, l] = rgbToHsl(px[0], px[1], px[2]);
      const nextS = clamp01(saturation >= 0 ? s + (1 - s) * saturation : s * (1 + saturation));
      const nextL = clamp01(lightness >= 0 ? l + (1 - l) * lightness : l * (1 + lightness));
      const [r, g, b] = hslToRgb((h + hueShift + 1) % 1, nextS, nextL);
      px[0] = r;
      px[1] = g;
      px[2] = b;
    };
  } else if (kind === "color-balance") {
    pixel = (px) => {
      const l = luma(px[0], px[1], px[2]);
      const shadows = clamp01(1 - 2 * l);
      const highlights = clamp01(2 * l - 1);
      const midtones = 1 - shadows - highlights;
      for (let channel = 0; channel < 3; channel += 1) px[channel] = clamp255(px[channel] + ((params.shadows[channel] * shadows + params.midtones[channel] * midtones + params.highlights[channel] * highlights) / 100) * 127);
    };
  } else if (kind === "black-white") {
    const total = params.red + params.green + params.blue || 100;
    pixel = (px) => {
      const grey = clamp255((px[0] * params.red + px[1] * params.green + px[2] * params.blue) / total);
      px[0] = grey;
      px[1] = grey;
      px[2] = grey;
    };
  } else return false;
  const px = new Uint8ClampedArray(3);
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const weight = mask ? mask.data[y * width + x] / 255 : 1;
      if (weight <= 0) continue;
      const at = (y * width + x) * 4;
      px[0] = rgba[at];
      px[1] = rgba[at + 1];
      px[2] = rgba[at + 2];
      pixel(px);
      if (weight >= 1) {
        rgba[at] = px[0];
        rgba[at + 1] = px[1];
        rgba[at + 2] = px[2];
      } else {
        rgba[at] = rgba[at] + (px[0] - rgba[at]) * weight;
        rgba[at + 1] = rgba[at + 1] + (px[1] - rgba[at + 1]) * weight;
        rgba[at + 2] = rgba[at + 2] + (px[2] - rgba[at + 2]) * weight;
      }
    }
  return true;
}

/** Названия коррекций для окна (по-русски; переводятся при отрисовке). */
export const ADJUST_LABELS = Object.freeze({
  levels: "Уровни",
  curves: "Кривые",
  "hue-saturation": "Цветовой тон / насыщенность",
  "color-balance": "Цветовой баланс",
  "brightness-contrast": "Яркость / контраст",
  "black-white": "Чёрно-белое",
  invert: "Инверсия",
  threshold: "Порог",
  posterize: "Постеризация",
});
