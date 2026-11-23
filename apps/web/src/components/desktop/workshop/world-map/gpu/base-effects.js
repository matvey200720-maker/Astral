import { atlasSize, normalizeAtlas, vectorBaseStyle } from "@modovik/vector-map";

const WATER_BLUR_CEILING = 48;
const GLOW_BLUR_CEILING = 90;
const NEUTRAL_FILTER = 100;
const FILTER_FIELDS = ["brightness", "contrast", "saturation"];
// Половины ширины обводки при отдалении, в точках: магистрали 1,5, дороги 1.
const ROAD_HALF_POINTS = { freeway: 0.75, roads: 0.5 };

const numberOr = (value, fallback) => Number(value ?? fallback);

// Чего проход эффектов не умеет: любая истина оставляет кусок растру.
const GPU_BLOCKERS = [
  (base) => base.reliefOn,
  (base, style) => style.biomes > 0,
  (base, style) => style.relief > 0,
  (base, style) => style.casing > 0,
  (base, style) => style.freewayCasing,
  (base) => numberOr(base.tintOpacity, 0) > 0,
  (base) => numberOr(base.grain, 0) > 0,
  (base) => FILTER_FIELDS.some((field) => numberOr(base[field], NEUTRAL_FILTER) !== NEUTRAL_FILTER),
];

const beyondGpu = (base, style) => GPU_BLOCKERS.some((blocks) => blocks(base, style));

function waterBlurOf(smooth, scale) {
  const sigma = Math.min(WATER_BLUR_CEILING, Math.max(0, smooth * 70 * scale));
  return sigma >= 1 ? sigma : 0;
}

function glowBlurOf(glow, scale) {
  return glow > 0 ? Math.min(GLOW_BLUR_CEILING, glow * 160 * scale) / 2 : 0;
}

// 1,2 пикселя обводки в единицах мира: 1,2 умножить на мир в одном пикселе (1 / масштаб).
function outlineWorldOf(width, scale) {
  return width > 0 ? Math.max(1.2 * (1 / scale), width * 6) : 0;
}

// Пока карта отдалена, растр обводит магистрали и дороги: половины ширины в единицах мира.
const roadHalves = (scale) =>
  Object.fromEntries(
    Object.entries(ROAD_HALF_POINTS).map(([kind, points]) => [kind, points / scale]),
  );

const roadHalfOf = (scale) => (scale < 1 ? roadHalves(scale) : null);

export function effectsStyle(base, scale) {
  const style = base && scale > 0 ? vectorBaseStyle(base) : null;
  if (style === null || beyondGpu(base, style)) return null;

  const effects = { style };
  effects.waterBlur = waterBlurOf(style.waterSmooth, scale);
  effects.glowBlur = glowBlurOf(style.glow, scale);
  effects.outlineWorld = outlineWorldOf(style.outlineWidth, scale);
  effects.glowColour = style.glowColor;
  effects.roadHalfWorld = roadHalfOf(scale);
  return effects;
}

const gaussianAt = (shift, spread) => Math.exp(-(shift * shift) / spread);

function kernelOf(sigma) {
  const radius = Math.ceil(3 * sigma);
  const spread = sigma * sigma * 2;
  const weights = new Float32Array(1 + radius);
  weights.forEach((_, shift) => {
    weights[shift] = gaussianAt(shift, spread);
  });

  const addSide = (sum, weight, shift) => (shift === 0 ? weight : sum + 2 * weight);
  const total = weights.reduce(addSide, 0);
  weights.forEach((weight, shift) => {
    weights[shift] = weight / total;
  });
  return { radius, weights };
}

// Гауссово ядро: вес сдвига k, боковые считаются дважды. Порядок округлений важен.
export const blurKernel = (sigma) => (sigma > 0 ? kernelOf(sigma) : null);

// Строковый first при сложении с числом только растёт ("0" -> "03" -> "033"...): страховка от
// бесконечного цикла. Настоящие циклы со строкой кончаются за несколько шагов.
const stillBounded = (value) => typeof value !== "string" || value.length < 64;

// Одно ребро: u, v начала и u, v конца по смещениям вершин в data.
function writeEdge(buffer, to, data, from, next) {
  buffer[to] = data[from];
  buffer[to + 1] = data[from + 1];
  buffer[to + 2] = data[next];
  buffer[to + 3] = data[next + 1];
}

// Рёбра треугольников суши: по три ребра на треугольник (0→1, 1→2, 2→0), по четыре числа на ребро.
export function landEdges(data, landGroups) {
  const groups = [...landGroups];
  const vertexTotal = groups.reduce((sum, group) => sum + group.count, 0);
  const buffer = new Float32Array(4 * vertexTotal);

  let written = 0;
  groups.forEach((group) => {
    const end = group.first + group.count;
    let triangle = group.first;
    while (triangle + 2 < end && stillBounded(triangle)) {
      const at = triangle * 2;
      writeEdge(buffer, written, data, at, at + 2);
      writeEdge(buffer, written + 4, data, at + 2, at + 4);
      writeEdge(buffer, written + 8, data, at + 4, at);
      written += 12;
      triangle += 3;
    }
  });

  const filled = buffer.subarray(0, written);
  return { data: filled, count: written / 4 };
}

export const worldSize = (atlas) => {
  const size = atlasSize(normalizeAtlas(atlas));
  return { width: size.width, height: size.height };
};
