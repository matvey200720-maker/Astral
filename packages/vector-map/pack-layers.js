import { PACK_GLYPHS } from "./pack-overlays.js";
import { attachHalos, extractIcons, pairPoints } from "./pack-layers/shapes.js";
import { pairShadows } from "./pack-layers/shadows.js";
import { darkTint, overlayParts } from "./pack-layers/parts.js";
import { packMasks, partsMask, sameSilhouette } from "./pack-layers/silhouettes.js";
import { extractLines, joinCorners } from "./pack-layers/lines.js";
import { extractLabels } from "./pack-layers/text.js";

export { PACK_OVERLAY_FROM } from "./pack-layers/parts.js";
export { normalizeLabelText } from "./pack-layers/text.js";
export { packBaseGeometry, packHasLayers } from "./pack-layers/base.js";

/** Пороги разбора в одном месте. */
const TUNING = Object.freeze({
  quarterLetters: 2,
  iconLetters: 3,
  outlineShare: 0.12,
  numberSigns: Object.freeze(["N", "Н", "М", "M"]),
});

/** Пути значков пака: имя без приставки «pack-», круг не берётся. */
function collectIconPaths() {
  const table = {};
  for (const [name, path] of Object.entries(PACK_GLYPHS)) {
    if (name !== "pack-dot") table[name.replace(/^pack-/, "")] = path;
  }
  return table;
}

export const PACK_ICON_PATHS = Object.freeze(collectIconPaths());

/* ---------- округления и схемы ответа ---------- */

const roundTo = (scale) => (value) => Math.round(value * scale) / scale;
const [tenth, hundredth] = [10, 100].map(roundTo);
const keep = (value) => value;

const LABEL_RULES = { text: keep, x: tenth, y: tenth, height: tenth, width: tenth, angle: tenth, color: keep, conf: Math.round };
const POINT_RULES = {
  number: keep,
  x: tenth,
  y: tenth,
  radius: tenth,
  color: keep,
  dx: tenth,
  dy: tenth,
  height: tenth,
  width: tenth,
  labelColor: keep,
};
const ICON_RULES = { x: tenth, y: tenth, size: tenth, glyph: keep, color: keep };
const wholePair = (pair) => [0, 1].map((axis) => Math.round(pair[axis]));
const ZONE_RULES = {
  points: (points) => points.map(wholePair),
  open: keep,
  line: keep,
  fill: keep,
  color: keep,
  alpha: hundredth,
  width: tenth,
};

/** Объект ответа по схеме «поле → правило округления». */
const carve = (rules, item) => Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, rule(item[key])]));

/* ---------- числа ---------- */

const ascending = (a, b) => a - b;
const middleOf = (values) => values.toSorted(ascending).at(Math.floor(values.length / 2));

function peak(values) {
  let top = -Infinity;
  for (const value of values) top = Math.max(top, value);
  return top;
}

/** Треугольников в кусках: у куска с тенью тень добавляется удвоением. */
function weighed(parts) {
  let sum = 0;
  for (const part of parts) sum += part.tris.length * (part.shadow ? 2 : 1);
  return sum;
}

const levelOf = ({ parts }) => parts[0].group.height;

/* ---------- тень и отделка ---------- */

/** Тень значка или подписи без отделки: нужна у половины кусков и больше. */
function partsShadow(parts) {
  const hits = [];
  for (const { shadow } of parts) if (shadow) hits.push(shadow);
  if (!hits.length || hits.length * 2 < parts.length) return {};
  const shift = (axis) => tenth(middleOf(hits.map((hit) => hit[axis])));
  return { shadow: { color: hits[0].color, dx: shift("dx"), dy: shift("dy") } };
}

/** Цвет той группы, чьи куски отделки занимают больше площади (при равенстве — первая). */
function heaviestColor(parts) {
  const totals = new Map();
  for (const { group, area } of parts) totals.set(group.color, (totals.get(group.color) ?? 0) + area);
  let top = null;
  for (const entry of totals) if (!top || entry[1] > top[1]) top = entry;
  return top[0];
}

/** Границы проекции всех точек кусков на ось (строгие сравнения). */
function spread(parts, project) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { points } of parts) {
    for (const [x, y] of points) {
      const t = project(x, y);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  return [lo, hi];
}

/** Отделка подписи — либо обводка со всех сторон, либо тень со сдвигом. */
function decorLook(label) {
  const [c, s] = [Math.cos(label.box.angle), Math.sin(label.box.angle)];
  const axes = [(x, y) => x * c + y * s, (x, y) => -x * s + y * c];
  const letters = label.parts.filter((part) => !label.decor.includes(part));
  const [along, across] = axes.map((project) => {
    const [a0, a1] = spread(letters, project);
    const [b0, b1] = spread(label.decor, project);
    return { lead: Math.abs(b0 - a0) > Math.abs(b1 - a1) ? b0 - a0 : b1 - a1, drift: b0 - a0 + (b1 - a1) };
  });
  const color = heaviestColor(label.decor);
  const limit = TUNING.outlineShare * label.height;
  if ([along, across].every(({ drift }) => Math.abs(drift) < limit)) return { halo: color };
  const [dx, dy] = [[c, -s], [s, c]].map(([p, q]) => tenth(along.lead * p + across.lead * q));
  return { shadow: { color, dx, dy } };
}

/* ---------- описание объектов ответа ---------- */

const describers = {
  labels: (label) => ({ ...carve(LABEL_RULES, label), level: levelOf(label), ...(label.decor?.length ? decorLook(label) : partsShadow(label.parts)) }),
  points: (point) => carve(POINT_RULES, point),
  zones: (zone) => ({ ...carve(ZONE_RULES, zone), level: levelOf(zone) }),
  icons: (icon) => ({ ...carve(ICON_RULES, icon), ...partsShadow(icon.parts) }),
};

/* ---------- шаги разбора ---------- */

/** Силуэты значков паков строятся один раз за сессию. */
let iconMasks = null;
const iconSilhouettes = () => (iconMasks ??= packMasks(PACK_ICON_PATHS));

/** Подпись на деле значок: тёмный квартал из двух знаков или короткое чтение с силуэтом значка. */
function looksLikeIcon(label) {
  const size = String(label.text).match(/\S/g)?.length ?? 0;
  if (size <= TUNING.quarterLetters && darkTint(label.color)) return true;
  return size <= TUNING.iconLetters && Boolean(sameSilhouette(partsMask(label.parts), iconSilhouettes()));
}

function partition(list, test) {
  const hits = [];
  const misses = [];
  list.forEach((item) => (test(item) ? hits : misses).push(item));
  return [hits, misses];
}

const isSign = ({ text }) => text.startsWith("№") || TUNING.numberSigns.includes(text);

/** Точка лежит у знака «№»: по x в полуширине и высоте подписи, по y в высоте. */
function atSign(point, label) {
  const offset = [point.x - label.x, point.y - label.y].map(Math.abs);
  const room = [label.width / 2 + label.height, label.height];
  return offset.every((distance, axis) => distance <= room[axis]);
}

/** Круглый знак «№» похож на точку: точка без номера у такой подписи — часть подписи. */
function foldSigns(points, labels) {
  const hosts = labels.filter(isSign);
  const lost = new Set();
  for (const point of points) {
    const host = point.number ? undefined : hosts.find((label) => atSign(point, label));
    if (!host) continue;
    host.parts.push(...point.parts);
    lost.add(point);
  }
  return points.filter((point) => lost.has(point) === false);
}

function separate(ctx) {
  ctx.parts = pairShadows(overlayParts(ctx.geometry)).parts;
  const total = ctx.parts.length;
  ctx.onProgress?.({ stage: "parts", done: total, total });
}

async function readText(ctx) {
  const { parts, recognize, onProgress, debug } = ctx;
  ctx.read = recognize ? await extractLabels(parts, recognize, { onProgress, debug }) : { labels: [], rest: parts };
}

function takeIcons(ctx) {
  const [icons, labels] = partition(ctx.read.labels, looksLikeIcon);
  ctx.labels = labels;
  ctx.rest = ctx.read.rest.concat(...icons.map((label) => label.parts));
}

function traceLines(ctx) {
  const { zones, rest } = extractLines(attachHalos(ctx.labels, ctx.rest));
  Object.assign(ctx, joinCorners(ctx.labels, zones, rest));
  const order = new Map(ctx.zones.map((zone) => [zone, peak(zone.parts.map((part) => part.groupIndex))]));
  ctx.zones = ctx.zones.toSorted((a, b) => order.get(a) - order.get(b));
}

function matchPoints(ctx) {
  const { points, labels, rest } = pairPoints(ctx.labels, ctx.rest);
  Object.assign(ctx, { labels, rest, points: foldSigns(points, labels) });
}

function cutIcons(ctx) {
  Object.assign(ctx, extractIcons(ctx.rest));
}

const COUNTED = ["labels", "points", "zones", "icons"];

function summarize(ctx) {
  const counts = Object.fromEntries(COUNTED.map((kind) => [kind, ctx[kind].length]));
  const covered = COUNTED.flatMap((kind) => ctx[kind]).reduce((sum, item) => sum + weighed(item.parts), 0);
  const stats = {
    parts: ctx.parts.length,
    triangles: weighed(ctx.parts),
    shadows: ctx.parts.reduce((n, part) => n + Number(Boolean(part.shadow)), 0),
    ...counts,
    glyphs: Object.keys(ctx.glyphs).length,
    covered,
  };
  ctx.answer = {
    ...Object.fromEntries(COUNTED.map((kind) => [kind, ctx[kind].map(describers[kind])])),
    glyphs: ctx.glyphs,
    stats,
  };
}

const PIPELINE = [separate, readText, takeIcons, traceLines, matchPoints, cutIcons, summarize];

export async function splitPackLayers(geometry, options = {}) {
  const ctx = {
    geometry,
    recognize: options.recognize ?? null,
    onProgress: options.onProgress ?? null,
    debug: options.debug ?? null,
  };
  for (const step of PIPELINE) await step(ctx);
  return ctx.answer;
}
