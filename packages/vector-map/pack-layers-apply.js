import { shapePoints } from "./shapes.js";
import { hueOf, looksBroken, packCategories, vocabularyFix } from "./pack-layers/categories.js";
import { normalizeWorldMap, WORLD_MAP_LIMITS } from "./model.js";

export const MOD_LAYER_GROUPS = Object.freeze({
  labels: "mod-labels",
  points: "mod-points",
  icons: "mod-icons",
  zones: "mod-zones",
  lines: "mod-lines",
  areas: "mod-areas",
});

/** Числа разбора в одном месте, по смыслу. */
const RULES = Object.freeze({
  letterWidth: Object.freeze({ golos: 1.07, inter: 0.99 }),
  font: Object.freeze({ golosAbove: 1.08, spaceWeight: 0.35 }),
  fit: Object.freeze({ widthTolerance: 0.15 }),
  doubtfulBelow: 70,
  stroke: Object.freeze({ metersPerWidth: 9 }),
  icon: Object.freeze({ fill: 0.92 }),
  defaultFillOpacity: 60,
  circle: Object.freeze({ minPoints: 12, minRadius: 10, spread: 0.08 }),
});

const MOD = "mod-";
const BUCKETS = ["labels", "points", "icons", "zones"];
const ZONE_NAMES = Object.freeze({ areas: "Заливка", lines: "Линия", zones: "Зона" });

/* ---------- малые помощники ---------- */

const roundTo = (scale) => (value) => Math.round(Number(value) * scale) / scale;
const tenth = roundTo(10);
const ascending = (a, b) => a - b;
const middleOf = (values) => values.toSorted(ascending).at(Math.floor(values.length / 2));
const groupOf = (item) => String(item.group || "");
const isOwn = (item) => !groupOf(item).startsWith(MOD);
const notMod = (key) => !key.startsWith(MOD);
const scrub = (table) => Object.fromEntries(Object.keys(table).filter(notMod).map((key) => [key, table[key]]));
const strokeOf = (width) => Math.max(0.1, tenth(Math.max(width, 1) / RULES.stroke.metersPerWidth));
const toPoint = ([x, y]) => ({ x, y });
const offsetOf = (dx, dy) => ({ x: tenth(dx), y: tenth(dy) });

function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  return [lo, hi];
}

/** Не больше limit точек: равномерная выборка по номерам. */
function* evenly(points, limit) {
  const step = points.length / limit;
  for (let k = 0; k < limit; k += 1) yield points[Math.floor(k * step)];
}

/** Таблица «ключ → как получить → когда нужен» и один обходчик для записей маркеров и зон. */
const assemble = (rows, raw, facts) =>
  Object.fromEntries(rows.filter(([, , when]) => !when || when(raw, facts)).map(([key, get]) => [key, get(raw, facts)]));

/* ---------- шрифт и ширина подписей ---------- */

/** «Число букв» самой длинной строки: непробельные знаки и по 0.35 за пробельный. */
function letterUnits(text) {
  const lines = String(text).split("\n");
  const widest = Math.max(...lines.map((line) => line.length));
  const longest = lines.find((line) => line.length === widest);
  const solid = longest.replace(/\s/g, "").length;
  return solid + (longest.length - solid) * RULES.font.spaceWeight;
}

const letterRatio = (text, width, height) => width / Math.max(letterUnits(text), 1) / Math.max(height, 0.1);

/** Шрифт на всю карту: по медианному отношению исходных подписей. */
function fontOf(labels) {
  const ratios = labels.flatMap((label) => {
    const ratio = letterRatio(label.text, label.width, label.height);
    return Number.isFinite(ratio) && ratio > 0 ? [ratio] : [];
  });
  return (ratios.length ? middleOf(ratios) : 0) > RULES.font.golosAbove ? "golos" : "inter";
}

/* ---------- круг ---------- */

/** Круг, если вершины и середины звеньев лежат на одном расстоянии от центра рамки. */
function circleOf(points) {
  const [x0, x1] = extent(points.map((p) => p[0]));
  const [y0, y1] = extent(points.map((p) => p[1]));
  const center = [(x0 + x1) / 2, (y0 + y1) / 2];
  const samples = points.flatMap((p, at) => {
    const q = points[(at + 1) % points.length];
    return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]];
  });
  const radii = samples.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
  let total = 0;
  for (const value of radii) total += value;
  const r = total / radii.length;
  const [low, high] = extent(radii);
  const { minRadius, spread } = RULES.circle;
  return r >= minRadius && high - low <= spread * r ? { x: center[0], y: center[1], r } : null;
}

/** Рамка круга для замкнутой зоны без заливки, если она круглая. */
function roundBox(raw) {
  if (raw.open || raw.fill || raw.points.length < RULES.circle.minPoints) return null;
  const circle = circleOf(raw.points);
  if (!circle) return null;
  const [x, y, w] = [circle.x, circle.y, 2 * circle.r].map((value) => Math.round(value));
  return { x, y, w, h: w, rotation: 0 };
}

/* ---------- записи: таблицы полей ---------- */

const LABEL_ROWS = [
  ["id", (_, f) => f.id],
  ["group", (_, f) => f.group],
  ["category", () => "place"],
  ["name", (_, f) => f.text],
  ["x", (r) => tenth(r.x)],
  ["y", (r) => tenth(r.y)],
  ["dot", () => false],
  ["label", () => true],
  ["textHeight", (r) => tenth(r.height)],
  ["textWidth", (r) => tenth(r.width), (_, f) => f.lines.length === 1 && f.near],
  ["rotation", (r) => tenth(r.angle)],
  ["labelColor", (r) => r.color, (_, f) => f.tinted],
  ["caps", () => true, (_, f) => f.capital],
];

const POINT_ROWS = [
  ["id", (_, f) => f.id],
  ["group", (_, f) => f.group],
  ["category", () => "point"],
  ["name", (r, f) => (f.numbered ? r.number : `Точка ${f.ordinal}`)],
  ["x", (r) => tenth(r.x)],
  ["y", (r) => tenth(r.y)],
  ["dot", () => true],
  ["label", (_, f) => f.numbered],
  ["color", (r) => r.color, (_, f) => !f.red],
  ["labelColor", (r) => r.labelColor || null, (_, f) => !f.red],
  ["dotRadius", (r) => Math.max(1, tenth(r.radius))],
  ["labelOffset", (r) => offsetOf(r.dx, r.dy), (_, f) => f.numbered],
  ["textHeight", (r) => tenth(r.height), (_, f) => f.numbered],
  ["textWidth", (r) => tenth(r.width), (_, f) => f.numbered],
];

const ICON_ROWS = [
  ["id", (_, f) => f.id],
  ["group", (_, f) => f.group],
  ["category", (_, f) => f.entry.category || "landmark"],
  ["name", (_, f) => `Значок ${f.ordinal}`],
  ["x", (r) => tenth(r.x)],
  ["y", (r) => tenth(r.y)],
  ["dot", () => true],
  ["label", () => false],
  ["glyph", (r) => `${MOD}${r.glyph}`],
  ["iconMeters", (r) => Math.max(4, tenth(r.size / RULES.icon.fill))],
];

const ZONE_ROWS = [
  ["id", (_, f) => f.id],
  ["group", (_, f) => f.group],
  ["name", (_, f) => `${ZONE_NAMES[f.kind]} ${f.ordinal}`],
  ["color", (r) => r.color],
  ["fillColor", (r) => r.color],
  ["enabled", () => true],
  ["label", () => false],
  ["open", () => true, (r) => r.open],
  ["line", (r) => r.line],
  ["fill", (r) => Boolean(r.fill)],
  ["width", (r, f) => (f.kind === "areas" ? 0 : strokeOf(r.width))],
  ["shape", () => "circle", (_, f) => f.box],
  ["box", (_, f) => f.box, (_, f) => f.box],
  ["points", (_, f) => f.points],
];

/** Что известно о подписи до сборки её маркера. */
function labelFacts(raw, at, entry, run) {
  const text = vocabularyFix(raw.text).text;
  const ratio = letterRatio(text, raw.width, raw.height);
  return {
    id: `mod-label-${at + 1}`,
    group: `${MOD_LAYER_GROUPS.labels}-${entry.key}`,
    text,
    lines: text.split("\n"),
    near: Math.abs(ratio / RULES.letterWidth[run.font] - 1) <= RULES.fit.widthTolerance,
    tinted: hueOf(raw.color) !== null,
    capital: text === text.toLocaleUpperCase("ru"),
  };
}

/** «Проверить»: уверенность ниже порога или текст похож на сломанный. */
function auditLabel(raw, facts, run) {
  const unsure = Number.isFinite(raw.conf) ? raw.conf < RULES.doubtfulBelow : false;
  if (unsure || looksBroken(facts.text)) run.ledger.doubtful.push(facts.id);
}

const pointFacts = (raw, at, entry) => ({
  id: `mod-point-${at + 1}`,
  group: `${MOD_LAYER_GROUPS.points}-${entry.key}`,
  ordinal: at + 1,
  numbered: Boolean(raw.number),
  red: hueOf(raw.color)?.id === "red",
});

const iconFacts = (raw, at, entry) => ({
  id: `mod-icon-${at + 1}`,
  group: MOD_LAYER_GROUPS.icons + (entry.key ? `-${entry.key}` : ""),
  ordinal: at + 1,
  entry,
});

const MARKER_KINDS = {
  labels: { rows: LABEL_ROWS, facts: labelFacts, audit: auditLabel, style: (run) => ({ font: run.font, weight: "black" }) },
  points: { rows: POINT_ROWS, facts: pointFacts, style: () => ({ font: "golos", weight: "black" }) },
  icons: { rows: ICON_ROWS, facts: iconFacts, accepts: (raw, run) => run.known.has(raw.glyph) },
};

/* ---------- накопитель ---------- */

function openLedger(start) {
  const own = { markers: start.markers.items.filter(isOwn), zones: start.zones.items.filter(isOwn) };
  return {
    own,
    room: { markers: WORLD_MAP_LIMITS.markers - own.markers.length, zones: WORLD_MAP_LIMITS.zones - own.zones.length },
    counts: Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])),
    dropped: { markers: 0, zones: 0 },
    fresh: { markers: [], zones: [] },
    titles: { markers: {}, zones: {} },
    styles: { markers: {}, zones: {} },
    kinds: {},
    alphas: [],
    doubtful: [],
  };
}

/** Есть ли место в разделе; если нет — запись об отброшенном. */
function hasRoom(ledger, section) {
  const free = ledger.room[section] > 0;
  if (!free) ledger.dropped[section] += 1;
  return free;
}

function commit(ledger, section, bucket, item) {
  ledger.room[section] -= 1;
  ledger.counts[bucket] += 1;
  ledger.fresh[section].push(item);
}

/* ---------- шаги ---------- */

function writeMarkers(run, kind) {
  const spec = MARKER_KINDS[kind];
  const { ledger } = run;
  run.layers[kind].forEach((raw, at) => {
    if (spec.accepts && !spec.accepts(raw, run)) return;
    const entry = run.cats[kind][at];
    const facts = spec.facts(raw, at, entry, run);
    ledger.titles.markers[facts.group] = entry.title;
    if (spec.style) ledger.styles.markers[facts.group] = spec.style(run);
    spec.audit?.(raw, facts, run);
    if (hasRoom(ledger, "markers")) commit(ledger, "markers", kind, assemble(spec.rows, raw, facts));
  });
}

/** Путь значка, самый длинный из слоёв, считается главным. */
function mainLayer({ layers }) {
  const sizes = layers.map(({ path }) => path.length);
  return sizes.indexOf(Math.max(...sizes));
}

function registerGlyphs(run) {
  const entries = Object.entries(run.source?.glyphs || {});
  const added = entries.map(([id, glyph]) => [`${MOD}${id}`, { layers: glyph.layers, main: mainLayer(glyph) }]);
  run.glyphs = Object.assign({}, run.start.markers.glyphs, Object.fromEntries(added));
  run.known = new Set(entries.map(([id]) => id));
}

function writeZones(run) {
  const { ledger } = run;
  const limit = WORLD_MAP_LIMITS.zonePoints;
  run.layers.zones.forEach((raw, at) => {
    if (!hasRoom(ledger, "zones")) return;
    const entry = run.cats.zones[at];
    const kind = [["areas", raw.fill], ["lines", raw.open]].find(([, flag]) => flag)?.[0] ?? "zones";
    const group = `${MOD_LAYER_GROUPS[kind]}-${entry.key}`;
    ledger.titles.zones[group] = entry.title;
    ledger.kinds[group] = kind;
    if (raw.fill) ledger.alphas.push(raw.alpha);
    const box = roundBox(raw);
    const picked = raw.points.length > limit ? [...evenly(raw.points, limit)] : raw.points;
    const points = box ? shapePoints("circle", box) : picked.map(toPoint);
    if (points.length < 3 - Number(Boolean(raw.open))) return;
    const facts = { id: `mod-zone-${at + 1}`, group, kind, ordinal: at + 1, box, points };
    commit(ledger, "zones", "zones", assemble(ZONE_ROWS, raw, facts));
  });
}

const STAGES = [
  (run) => {
    run.font = fontOf(run.layers.labels);
  },
  (run) => {
    run.cats = packCategories(run.source || {}, { title: run.start.base.packOrigin?.title || "" });
  },
  (run) => writeMarkers(run, "labels"),
  (run) => writeMarkers(run, "points"),
  registerGlyphs,
  (run) => writeMarkers(run, "icons"),
  writeZones,
];

/** Раздел проекта после применения: свои объекты, затем новые; названия и стили прежней нарезки заменены. */
const refreshed = (original, extra, { own, fresh, titles, styles }) => ({
  ...original,
  ...extra,
  items: [...own, ...fresh],
  groupTitles: { ...scrub(original.groupTitles), ...titles },
  groupStyles: { ...scrub(original.groupStyles), ...styles },
});

/** Вид набора зон по роду; у заливок — со своей прозрачностью. */
const zoneLook = (kind, opacity) =>
  Object.fromEntries([
    ["fillMode", "flat"],
    ["fillOpacity", kind === "areas" ? opacity : 0],
    ...(kind === "areas" ? [["strokeWidth", 0]] : []),
    ["strokeAlign", "center"],
    ["glow", 0],
  ]);

function finish(run) {
  const { start, ledger } = run;
  const opacity = ledger.alphas.length ? Math.round(middleOf(ledger.alphas) * 100) : RULES.defaultFillOpacity;
  const looks = {};
  for (const group of Object.keys(ledger.kinds)) looks[group] = zoneLook(ledger.kinds[group], opacity);
  const next = normalizeWorldMap({
    ...start,
    base: { ...start.base, packLayers: "split", packDoubtful: ledger.doubtful },
    markers: refreshed(
      start.markers,
      { glyphs: run.glyphs },
      { own: ledger.own.markers, fresh: ledger.fresh.markers, titles: ledger.titles.markers, styles: ledger.styles.markers },
    ),
    zones: refreshed(start.zones, {}, { own: ledger.own.zones, fresh: ledger.fresh.zones, titles: ledger.titles.zones, styles: looks }),
  });
  return { config: next, counts: ledger.counts, dropped: ledger.dropped, doubtful: next.base.packDoubtful.length };
}

/** Рабочее состояние применения: проект после первого прохода нормализатора, слои и накопитель. */
const openRun = (start, layers) => ({
  start,
  source: layers,
  ledger: openLedger(start),
  layers: Object.fromEntries(BUCKETS.map((bucket) => [bucket, layers?.[bucket] || []])),
});

export function applyPackLayers(config, layers) {
  const run = openRun(normalizeWorldMap(config), layers);
  STAGES.forEach((stage) => stage(run));
  return finish(run);
}
