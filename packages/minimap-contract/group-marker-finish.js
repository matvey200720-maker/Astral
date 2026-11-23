/*
 * Отделка групповой метки (дополнение владельца 19.10.2026): размер рисунка внутри листа, прозрачность,
 * обводка или свечение, тонировка картинки. Одно и то же правило считают окно (предпросмотр на холсте) и
 * установщик (лист метки в игре), поэтому оно живёт в договоре и работает на «сырых» пикселях RGBA.
 *
 * Размер — масштаб рисунка внутри листа: меньше — вокруг прозрачные поля, больше — рисунок вылезает за края
 * листа и обрезается ими. Размер, с которым метку рисует сервер или скрипт игры, файлом листа не меняется.
 *
 * Правка — объект с необязательными полями (в работе хранится только то, что отличается от умолчаний):
 *   scale   — размер рисунка, % (10…150, по умолчанию 100);
 *   opacity — непрозрачность, % (5…100, по умолчанию 100);
 *   outline — `{ kind: "outline" | "glow", color, width }`: обводка рисунка или свечение вокруг него; ширина — в
 *             256-х долях короткой стороны листа (1…16), поэтому у листов разного размера вид один и тот же;
 *   tint    — цвет, на который умножается картинка (у картинки; у текста цвет свой, у штатной метки — «свой цвет»).
 *
 * Порядок: тонировка → размер → обводка/свечение → непрозрачность. Обводке нужно место: пока она включена,
 * рисунок уменьшается ровно настолько, чтобы она целиком уместилась в листе.
 */

export const GROUP_MARKER_FINISH_LIMITS = Object.freeze({
  scale: Object.freeze({ min: 10, max: 150, step: 1, fallback: 100 }),
  opacity: Object.freeze({ min: 5, max: 100, step: 1, fallback: 100 }),
  outline: Object.freeze({ min: 1, max: 16, step: 1, fallback: 4 }),
});
export const GROUP_MARKER_OUTLINE_KINDS = Object.freeze(["outline", "glow"]);
export const GROUP_MARKER_OUTLINE_COLOUR = "#000000";

const HEX = /^#[0-9a-f]{6}$/i;
const clampInt = (value, { min, max }, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Поля отделки из чего угодно: только отличающиеся от умолчаний, в порядке `scale, opacity, outline, tint`. */
export function normalizeFinish(input) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  const scale = source.scale === undefined ? 100 : clampInt(source.scale, GROUP_MARKER_FINISH_LIMITS.scale, 100);
  if (scale !== 100) out.scale = scale;
  const opacity = source.opacity === undefined ? 100 : clampInt(source.opacity, GROUP_MARKER_FINISH_LIMITS.opacity, 100);
  if (opacity !== 100) out.opacity = opacity;
  const outline = source.outline && typeof source.outline === "object" ? source.outline : null;
  if (outline && GROUP_MARKER_OUTLINE_KINDS.includes(outline.kind))
    out.outline = {
      kind: outline.kind,
      color: HEX.test(String(outline.color || "")) ? String(outline.color).toLowerCase() : GROUP_MARKER_OUTLINE_COLOUR,
      width: clampInt(outline.width, GROUP_MARKER_FINISH_LIMITS.outline, GROUP_MARKER_FINISH_LIMITS.outline.fallback),
    };
  if (HEX.test(String(source.tint || ""))) out.tint = String(source.tint).toLowerCase();
  return out;
}

/** Есть ли в правке хоть что-то из отделки. */
export const hasGroupMarkerFinish = (edit) => Object.keys(normalizeFinish(edit)).length > 0;

/** Только поля отделки правки — то, что договор хранит рядом с видом метки. */
export const groupMarkerFinishOf = (edit) => normalizeFinish(edit);

const rgbOf = (value) => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));

/* Расстояние (в точках) от каждой точки до ближайшей «внутренней» — точный евклидов, два прохода Фельценшвальба. */
function distanceToInside(inside, width, height) {
  const INF = 1e20;
  const grid = new Float64Array(width * height);
  for (let at = 0; at < grid.length; at += 1) grid[at] = inside[at] ? 0 : INF;
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const pass = (length, read, write) => {
    for (let at = 0; at < length; at += 1) f[at] = read(at);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < length; q += 1) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k -= 1;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < length; q += 1) {
      while (z[k + 1] < q) k += 1;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let at = 0; at < length; at += 1) write(at, d[at]);
  };
  for (let x = 0; x < width; x += 1)
    pass(
      height,
      (y) => grid[y * width + x],
      (y, value) => {
        grid[y * width + x] = value;
      },
    );
  for (let y = 0; y < height; y += 1)
    pass(
      width,
      (x) => grid[y * width + x],
      (x, value) => {
        grid[y * width + x] = value;
      },
    );
  for (let at = 0; at < grid.length; at += 1) grid[at] = Math.sqrt(grid[at]);
  return grid;
}

/* RGBA (прямая альфа, 0…255) → плавающие 0…1 с предумноженным цветом. */
function premultiplied(rgba, count) {
  const out = new Float32Array(count * 4);
  for (let at = 0; at < count * 4; at += 4) {
    const alpha = rgba[at + 3] / 255;
    out[at] = (rgba[at] / 255) * alpha;
    out[at + 1] = (rgba[at + 1] / 255) * alpha;
    out[at + 2] = (rgba[at + 2] / 255) * alpha;
    out[at + 3] = alpha;
  }
  return out;
}

/* Масштаб вокруг центра листа: билинейно, при уменьшении — со сглаживанием выборкой n×n в точке. */
function scaled(source, width, height, factor) {
  const out = new Float32Array(width * height * 4);
  const n = factor < 1 ? Math.min(4, Math.ceil(1 / factor)) : 1;
  const cx = width / 2;
  const cy = height / 2;
  const sample = (sx, sy, into) => {
    const x = sx - 0.5;
    const y = sy - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    for (let dy = 0; dy < 2; dy += 1)
      for (let dx = 0; dx < 2; dx += 1) {
        const px = x0 + dx;
        const py = y0 + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        const at = (py * width + px) * 4;
        into[0] += source[at] * weight;
        into[1] += source[at + 1] * weight;
        into[2] += source[at + 2] * weight;
        into[3] += source[at + 3] * weight;
      }
  };
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      sum[0] = sum[1] = sum[2] = sum[3] = 0;
      for (let sy = 0; sy < n; sy += 1)
        for (let sx = 0; sx < n; sx += 1) sample(cx + (x + (sx + 0.5) / n - cx) / factor, cy + (y + (sy + 0.5) / n - cy) / factor, sum);
      const at = (y * width + x) * 4;
      out[at] = sum[0] / (n * n);
      out[at + 1] = sum[1] / (n * n);
      out[at + 2] = sum[2] / (n * n);
      out[at + 3] = sum[3] / (n * n);
    }
  return out;
}

/**
 * Лист метки с отделкой. `rgba` — прямая альфа, 4 байта на точку; правится на месте и возвращается (так же,
 * как `recolourMark`). `finish` — правка метки или только её поля отделки.
 */
export function finishMark(rgba, width, height, finish) {
  const spec = normalizeFinish(finish);
  if (!Object.keys(spec).length) return rgba;
  const count = width * height;
  if (spec.tint) {
    const [tr, tg, tb] = rgbOf(spec.tint);
    for (let at = 0; at < count * 4; at += 4) {
      rgba[at] = Math.round((rgba[at] * tr) / 255);
      rgba[at + 1] = Math.round((rgba[at + 1] * tg) / 255);
      rgba[at + 2] = Math.round((rgba[at + 2] * tb) / 255);
    }
  }
  const edge = Math.min(width, height);
  const pad = spec.outline ? (spec.outline.width / 256) * edge : 0;
  const factor = ((spec.scale || 100) / 100) * (spec.outline ? Math.max(0.2, (edge - 2 * pad) / edge) : 1);
  let pixels = premultiplied(rgba, count);
  if (Math.abs(factor - 1) > 1e-6) pixels = scaled(pixels, width, height, factor);
  if (spec.outline) {
    const inside = new Uint8Array(count);
    let any = false;
    for (let at = 0; at < count; at += 1)
      if (pixels[at * 4 + 3] >= 0.5) {
        inside[at] = 1;
        any = true;
      }
    if (any) {
      const radius = Math.max(0.5, pad);
      const distance = distanceToInside(inside, width, height);
      const [or, og, ob] = rgbOf(spec.outline.color);
      for (let at = 0; at < count; at += 1) {
        const away = distance[at];
        if (away > radius + 1) continue;
        const layer =
          spec.outline.kind === "glow" ? Math.max(0, 1 - away / (radius + 1)) ** 2 : Math.min(1, Math.max(0, radius + 0.5 - away));
        if (layer <= 0) continue;
        const own = pixels[at * 4 + 3];
        const behind = layer * (1 - own);
        pixels[at * 4] += (or / 255) * behind;
        pixels[at * 4 + 1] += (og / 255) * behind;
        pixels[at * 4 + 2] += (ob / 255) * behind;
        pixels[at * 4 + 3] = own + behind;
      }
    }
  }
  const opacity = (spec.opacity || 100) / 100;
  for (let at = 0; at < count; at += 1) {
    const alpha = pixels[at * 4 + 3];
    const target = at * 4;
    if (alpha <= 1e-6) {
      rgba[target] = rgba[target + 1] = rgba[target + 2] = rgba[target + 3] = 0;
      continue;
    }
    rgba[target] = Math.round(Math.min(1, pixels[at * 4] / alpha) * 255);
    rgba[target + 1] = Math.round(Math.min(1, pixels[at * 4 + 1] / alpha) * 255);
    rgba[target + 2] = Math.round(Math.min(1, pixels[at * 4 + 2] / alpha) * 255);
    rgba[target + 3] = Math.round(Math.min(1, alpha * opacity) * 255);
  }
  return rgba;
}
