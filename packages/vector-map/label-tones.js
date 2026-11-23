// Цвета подписей на карте: замер яркости фона под рамкой подписи и выбор цвета по контрасту (WCAG).

function deepFreeze(value) {
  for (const inner of Object.values(value)) {
    if (typeof inner === "object") deepFreeze(inner);
  }
  return Object.freeze(value);
}

const LIMITS = deepFreeze({
  size: 12,
  calmSpread: 0.3,
  lightBelow: 0.3,
  saturatedAbove: 0.2,
  bins: 64,
  minAlpha: 128,
  sampleArea: 2400,
  stride: 4,
});

// Светлая и тёмная подпись: куда сдвигать основу, какие доли пробовать, чем обводить.
const RAMPS = deepFreeze({
  light: { target: 255, shifts: [0.82, 0.9, 0.95], neutral: "#ffffff", ring: [0, 0.84], ringNeutral: "#05070b" },
  dark: { target: 0, shifts: [0.74, 0.82, 0.9], neutral: "#11151c", ring: [255, 0.9], ringNeutral: "#ffffff" },
});

// Цвет пака: оттенок меняется как можно меньше.
const KEPT = deepFreeze({ goal: 3, edgeGoal: 4.5, shifts: [0.12, 0.22, 0.32], lightAbove: 0.18, rings: [0.86, 0.9] });
const LABEL_GOAL = 7;

// Яркость канала в линейном свете; читается по ключу — самому значению канала.
const LINEAR = new Float64Array(256).map((_, v) =>
  v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4,
);
const WEIGHTS = [0.2126, 0.7152, 0.0722];

export function relativeLuminance(r, g, b) {
  const terms = [r, g, b].map((channel, k) => WEIGHTS[k] * LINEAR[channel]);
  return terms.reduce((sum, term) => sum + term);
}

// Цвет #rrggbb (решётка необязательна) как [r, g, b] либо null.
function parseColor(value) {
  const digits = String(value || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(digits)) return null;
  return Array.from(digits.match(/../g), (pair) => Number.parseInt(pair, 16));
}

export function toneLuminance(hex) {
  const rgb = parseColor(hex);
  return rgb === null ? 1 : relativeLuminance(...rgb);
}

export function contrastRatio(a, b) {
  const [bright, dim] = [Math.max, Math.min].map((pick) => pick(a, b) + 0.05);
  return bright / dim;
}

function hexByte(value) {
  return value.toString(16).padStart(2, "0");
}

// Сдвиг цвета к цели (255 — белый, 0 — чёрный) на долю d.
function shiftColor(rgb, target, d) {
  return "#" + rgb.map((c) => hexByte(Math.round(c + (target - c) * d))).join("");
}

function shiftAll(rgb, target, shares) {
  return shares.map((d) => shiftColor(rgb, target, d));
}

function isSaturated(rgb) {
  const [dim, bright] = rgb.reduce(([lo, hi], c) => [Math.min(lo, c), Math.max(hi, c)], [255, 0]);
  return (bright - dim) / 255 > LIMITS.saturatedAbove;
}

function numberOr(value, fallback) {
  return Number(value) || fallback;
}

function toneRecord(fill, stroke, halo) {
  return { fill, stroke, halo };
}

export function labelToneBox(label, width) {
  const size = numberOr(label.size, LIMITS.size);
  const margin = size * 0.2 * 2;
  const angle = (numberOr(label.rotation, 0) * Math.PI) / 180;
  const gaps = (label.lines?.length || 1) - 1;
  const boxH = size + gaps * numberOr(label.lineStep, size * 1.12) + margin;
  const boxW = margin + Math.max(size, numberOr(width, 0));
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)].map(Math.abs);
  const [dx, dy] = [
    [cos, sin],
    [sin, cos],
  ].map(([p, q]) => (boxW * p + boxH * q) / 2);
  const around = (center, half) => [center - half, center + half];
  const [x0, x1] = around(label.x, dx);
  const [y0, y1] = around(label.y, dy);
  return { x0, y0, x1, y1 };
}

function textRows(label) {
  if (label.lines?.length) return label.lines.map(String);
  return [label.value ? String(label.value) : ""];
}

export function labelToneWidth(label) {
  const size = numberOr(label.size, LIMITS.size);
  const spacing = numberOr(label.letterSpacing, 0);
  const widthOf = (text) => {
    const gaps = Math.max(text.length - 1, 0);
    return text.length * size * 0.6 + gaps * spacing;
  };
  return Math.max(...textRows(label).map(widthOf));
}

function* stepsOf(from, to, step) {
  let v = from;
  while (v < to) {
    yield v;
    v += step;
  }
}

// Яркости видимых точек окна в порядке обхода: строки сверху вниз, внутри слева направо.
function* visibleLuminances({ data, width }, [left, top, right, bottom], step) {
  for (const y of stepsOf(top, bottom, step)) {
    for (const x of stepsOf(left, right, step)) {
      const at = LIMITS.stride * (y * width + x);
      if (data[at + 3] < LIMITS.minAlpha) continue;
      yield relativeLuminance(...Array.from({ length: 3 }, (_, k) => data[at + k]));
    }
  }
}

const strideFor = (area) => Math.max(Math.floor(Math.sqrt(area / LIMITS.sampleArea)), 1);
const binOf = (light) => Math.min(LIMITS.bins - 1, Math.floor(light * LIMITS.bins));

// Доля p точек: середина первой корзины, где накопленное число достигло порога.
function binQuantile(bins, count, p) {
  let seen = 0;
  const threshold = p * count;
  const hit = bins.findIndex((n) => (seen += n) >= threshold);
  return hit === -1 ? 1 : (hit + 0.5) / LIMITS.bins;
}

export function sampleLabelBackground(pixels, box, scale = 1) {
  const lower = (v) => Math.max(0, Math.floor(v * scale));
  const upper = (v, limit) => Math.min(limit, Math.ceil(v * scale));
  const bounds = [lower(box.x0), lower(box.y0), upper(box.x1, pixels.width), upper(box.y1, pixels.height)];
  const [left, top, right, bottom] = bounds;
  const [spanX, spanY] = [right - left, bottom - top];
  if (spanX <= 0 || spanY <= 0) return null;

  const lights = Array.from(visibleLuminances(pixels, bounds, strideFor(spanX * spanY)));
  const count = lights.length;
  if (count === 0) return null;

  const bins = Array.from({ length: LIMITS.bins }, (_, b) => lights.filter((light) => binOf(light) === b).length);
  const sum = lights.reduce((acc, light) => acc + light, 0);
  return { mean: sum / count, low: binQuantile(bins, count, 0.1), high: binQuantile(bins, count, 0.9), count };
}

// Развязка обоих выборов: без ореола, если края читаются и фон ровный; иначе ореол по тяжести.
function edgeContrast(fill, stats) {
  const own = toneLuminance(fill);
  return Math.min(...[stats.low, stats.high].map((side) => contrastRatio(own, side)));
}

function finishTone({ fill, stats, goal, stroke, halo: [gain, offset] }) {
  const edge = edgeContrast(fill, stats);
  const calm = stats.high - stats.low < LIMITS.calmSpread;
  if (edge >= goal && calm) return toneRecord(fill, null, 0);
  const severity = Math.min(Math.max((goal - edge) / goal, 0), 1);
  return toneRecord(fill, stroke(), Math.round((gain * severity + offset) * 1000) / 1000);
}

const readableOn = (stats, goal) => (color) => goal <= contrastRatio(toneLuminance(color), stats.mean);

export function chooseLabelTone(stats, base) {
  const rgb = parseColor(base);
  const ramp = stats.mean < LIMITS.lightBelow ? RAMPS.light : RAMPS.dark;
  const colored = Boolean(rgb) && isSaturated(rgb);
  const shifted = colored ? shiftAll(rgb, ramp.target, ramp.shifts) : [];
  const fill = [...shifted, ramp.neutral].find(readableOn(stats, LABEL_GOAL)) ?? ramp.neutral;
  const stroke = () => (colored ? shiftColor(rgb, ...ramp.ring) : ramp.ringNeutral);
  return finishTone({ fill, stats, goal: LABEL_GOAL, stroke, halo: [0.05, 0.04] });
}

export function chooseKeptTone(stats, base) {
  const rgb = parseColor(base);
  if (rgb === null) return chooseLabelTone(stats, base);
  const shifted = KEPT.shifts.flatMap((d) => [shiftColor(rgb, 255, d), shiftColor(rgb, 0, d)]);
  const fill = [base, ...shifted].find(readableOn(stats, KEPT.goal)) ?? base;
  const [toBlack, toWhite] = KEPT.rings;
  const stroke = () =>
    toneLuminance(fill) > KEPT.lightAbove ? shiftColor(rgb, 0, toBlack) : shiftColor(rgb, 255, toWhite);
  return finishTone({ fill, stats, goal: KEPT.edgeGoal, stroke, halo: [0.045, 0.055] });
}

// Цвет одной подписи по замеру фона под её рамкой; null, если фон не виден.
function toneFor(label, pixels, scale, measure) {
  const width = (measure && measure(label)) || labelToneWidth(label);
  const stats = sampleLabelBackground(pixels, labelToneBox(label, width), scale);
  if (stats === null) return null;
  return (label.keepHue ? chooseKeptTone : chooseLabelTone)(stats, label.tone);
}

export function labelTonesFromPixels(labels, pixels, options = {}) {
  const { scale = 1, measure = null } = options;
  const tones = {};
  for (const label of [...labels].filter((item) => item?.tone)) {
    const tone = toneFor(label, pixels, scale, measure);
    if (tone !== null) tones[label.id] = tone;
  }
  return tones;
}
