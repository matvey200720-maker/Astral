/*
 * Фильтры студии (ТЗ 18.10.2026, Session 1, задача 6): размытие, размытие в
 * движении, резкость, шум, пикселизация, сдвиг. Чистые функции над RGBA
 * (`Uint8ClampedArray`, правятся на месте) — их зовёт рабочий поток студии
 * (`studio-worker.js`), чтобы окно не подвисало на листе 8089 × 1280, и тесты.
 *
 * Размытие и резкость считаются по пикселям с предумноженной прозрачностью:
 * край рисунка на прозрачном не «темнеет» чёрной каймой. `mask` — маска
 * выделения: пиксель получает долю результата по её значению.
 */

export const FILTER_KINDS = Object.freeze(["blur", "motion-blur", "sharpen", "noise", "pixelate", "shift"]);
export const FILTER_LABELS = Object.freeze({
  blur: "Размытие",
  "motion-blur": "Размытие в движении",
  sharpen: "Резкость",
  noise: "Шум",
  pixelate: "Пикселизация",
  shift: "Сдвиг",
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* Пределы параметров: окно и рабочий поток читают одно и то же. */
export const FILTER_LIMITS = Object.freeze({
  blur: { radius: [0.5, 100] },
  "motion-blur": { distance: [1, 200], angle: [-180, 180] },
  sharpen: { amount: [1, 500], radius: [0.5, 50] },
  noise: { amount: [1, 100] },
  pixelate: { size: [2, 256] },
  shift: { x: [-8192, 8192], y: [-8192, 8192] },
});

/** Параметры фильтра: числа в пределах, остальное по умолчанию. */
export function normalizeFilterParams(kind, input = {}) {
  const limits = FILTER_LIMITS[kind] || {};
  const defaults = { blur: { radius: 4 }, "motion-blur": { distance: 20, angle: 0 }, sharpen: { amount: 100, radius: 1.5 }, noise: { amount: 20, mono: false, seed: 1 }, pixelate: { size: 8 }, shift: { x: 0, y: 0 } }[kind] || {};
  const out = { ...defaults };
  for (const [key, range] of Object.entries(limits)) {
    const value = Number(input?.[key]);
    out[key] = Number.isFinite(value) ? clamp(value, range[0], range[1]) : defaults[key];
  }
  if (kind === "noise") {
    out.mono = Boolean(input?.mono);
    out.seed = Math.round(Number.isFinite(Number(input?.seed)) ? Number(input.seed) : 1);
  }
  return out;
}

/**
 * Сколько пикселей вокруг куска нужно фильтру, чтобы край куска не искажался
 * (размытие смотрит на соседей): окно берёт кусок с таким запасом.
 */
export function filterPadding(kind, input = {}) {
  const params = normalizeFilterParams(kind, input);
  if (kind === "blur" || kind === "sharpen") return Math.ceil(params.radius * 3) + 2;
  if (kind === "motion-blur") return Math.ceil(params.distance / 2) + 2;
  return 0;
}

/* ------------------------------------------------------------------ *
 * Размытие «коробкой»: три прохода ≈ гаусс
 * ------------------------------------------------------------------ */

function boxPass(from, to, width, height, radius, horizontal) {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const stride = horizontal ? 4 : width * 4;
  const lineStep = horizontal ? width * 4 : 4;
  const window = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStep;
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let at = -radius; at <= radius; at += 1) sum += from[base + clamp(at, 0, length - 1) * stride + channel];
      for (let at = 0; at < length; at += 1) {
        to[base + at * stride + channel] = sum / window;
        sum += from[base + clamp(at + radius + 1, 0, length - 1) * stride + channel] - from[base + clamp(at - radius, 0, length - 1) * stride + channel];
      }
    }
  }
}

/** Предумноженная копия RGBA в `Float32Array`. */
function premultiplied(rgba) {
  const out = new Float32Array(rgba.length);
  for (let at = 0; at < rgba.length; at += 4) {
    const alpha = rgba[at + 3] / 255;
    out[at] = rgba[at] * alpha;
    out[at + 1] = rgba[at + 1] * alpha;
    out[at + 2] = rgba[at + 2] * alpha;
    out[at + 3] = rgba[at + 3];
  }
  return out;
}

function unpremultiplied(float, rgba) {
  for (let at = 0; at < rgba.length; at += 4) {
    const alpha = clamp(float[at + 3], 0, 255) / 255;
    rgba[at + 3] = float[at + 3];
    if (alpha <= 0) {
      rgba[at] = 0;
      rgba[at + 1] = 0;
      rgba[at + 2] = 0;
    } else {
      rgba[at] = float[at] / alpha;
      rgba[at + 1] = float[at + 1] / alpha;
      rgba[at + 2] = float[at + 2] / alpha;
    }
  }
}

/** Размытие радиусом `radius` px (дробный радиус — вклад последнего прохода); результат — предумноженный `Float32Array`. */
export function blurPremultiplied(rgba, width, height, radius) {
  let source = premultiplied(rgba);
  let target = new Float32Array(source.length);
  const box = Math.max(1, Math.round(radius / 1.7));
  for (let pass = 0; pass < 3; pass += 1) {
    boxPass(source, target, width, height, box, true);
    boxPass(target, source, width, height, box, false);
  }
  target = null;
  return source;
}

/* ------------------------------------------------------------------ *
 * Фильтры
 * ------------------------------------------------------------------ */

function blur(rgba, width, height, { radius }) {
  const result = blurPremultiplied(rgba, width, height, radius);
  unpremultiplied(result, rgba);
}

function sharpen(rgba, width, height, { amount, radius }) {
  const soft = blurPremultiplied(rgba, width, height, radius);
  const sharp = premultiplied(rgba);
  const gain = amount / 100;
  for (let at = 0; at < sharp.length; at += 4) {
    for (let channel = 0; channel < 3; channel += 1) sharp[at + channel] = sharp[at + channel] + (sharp[at + channel] - soft[at + channel]) * gain;
  }
  unpremultiplied(sharp, rgba);
}

function motionBlur(rgba, width, height, { distance, angle }) {
  const source = premultiplied(rgba);
  const out = new Float32Array(source.length);
  const steps = Math.max(1, Math.round(distance));
  const dx = Math.cos((angle * Math.PI) / 180);
  const dy = Math.sin((angle * Math.PI) / 180);
  const half = (steps - 1) / 2;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let step = 0; step < steps; step += 1) {
        const sx = clamp(Math.round(x + dx * (step - half)), 0, width - 1);
        const sy = clamp(Math.round(y + dy * (step - half)), 0, height - 1);
        const at = (sy * width + sx) * 4;
        r += source[at];
        g += source[at + 1];
        b += source[at + 2];
        a += source[at + 3];
      }
      const to = (y * width + x) * 4;
      out[to] = r / steps;
      out[to + 1] = g / steps;
      out[to + 2] = b / steps;
      out[to + 3] = a / steps;
    }
  unpremultiplied(out, rgba);
}

/* Равномерное псевдослучайное число по зерну: тест видит один и тот же шум. */
function random(seed) {
  let state = (seed | 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return ((state >>> 8) & 0xffffff) / 0x1000000;
  };
}

function noise(rgba, width, height, { amount, mono, seed }) {
  const next = random(seed);
  const range = (amount / 100) * 255;
  for (let at = 0; at < rgba.length; at += 4) {
    if (mono) {
      const grain = (next() - 0.5) * range;
      rgba[at] += grain;
      rgba[at + 1] += grain;
      rgba[at + 2] += grain;
    } else {
      rgba[at] += (next() - 0.5) * range;
      rgba[at + 1] += (next() - 0.5) * range;
      rgba[at + 2] += (next() - 0.5) * range;
    }
  }
}

function pixelate(rgba, width, height, { size }) {
  const cell = Math.max(2, Math.round(size));
  for (let y0 = 0; y0 < height; y0 += cell)
    for (let x0 = 0; x0 < width; x0 += cell) {
      const x1 = Math.min(width, x0 + cell);
      const y1 = Math.min(height, y0 + cell);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) {
          const at = (y * width + x) * 4;
          const alpha = rgba[at + 3] / 255;
          r += rgba[at] * alpha;
          g += rgba[at + 1] * alpha;
          b += rgba[at + 2] * alpha;
          a += rgba[at + 3];
        }
      const count = (x1 - x0) * (y1 - y0);
      const alpha = a / count / 255;
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) {
          const at = (y * width + x) * 4;
          rgba[at] = alpha > 0 ? r / count / alpha : 0;
          rgba[at + 1] = alpha > 0 ? g / count / alpha : 0;
          rgba[at + 2] = alpha > 0 ? b / count / alpha : 0;
          rgba[at + 3] = a / count;
        }
    }
}

/* Сдвиг по кругу: что ушло за край, возвращается с другой стороны (текстуры повторяются). */
function shift(rgba, width, height, { x, y }) {
  const dx = ((Math.round(x) % width) + width) % width;
  const dy = ((Math.round(y) % height) + height) % height;
  if (!dx && !dy) return;
  const copy = new Uint8ClampedArray(rgba);
  for (let row = 0; row < height; row += 1) {
    const sy = (row - dy + height) % height;
    for (let col = 0; col < width; col += 1) {
      const sx = (col - dx + width) % width;
      const to = (row * width + col) * 4;
      const from = (sy * width + sx) * 4;
      rgba[to] = copy[from];
      rgba[to + 1] = copy[from + 1];
      rgba[to + 2] = copy[from + 2];
      rgba[to + 3] = copy[from + 3];
    }
  }
}

const FILTERS = { blur, "motion-blur": motionBlur, sharpen, noise, pixelate, shift };

/**
 * Применить фильтр к RGBA на месте. `mask` — маска выделения на весь буфер:
 * пиксель получает долю результата по её значению (без маски — целиком).
 * Ответ — `true`, если фильтр известен.
 */
export function applyFilter(rgba, width, height, kind, input = {}, { mask = null } = {}) {
  const run = FILTERS[kind];
  if (!run) return false;
  const params = normalizeFilterParams(kind, input);
  const before = mask ? new Uint8ClampedArray(rgba) : null;
  run(rgba, width, height, params);
  if (mask) {
    for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
      const weight = mask.data[pixel] / 255;
      if (weight >= 1) continue;
      const at = pixel * 4;
      for (let channel = 0; channel < 4; channel += 1) rgba[at + channel] = before[at + channel] + (rgba[at + channel] - before[at + channel]) * weight;
    }
  }
  return true;
}
