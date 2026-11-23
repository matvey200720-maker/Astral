import { tr } from "../../../locales/ui.js";
import { mapText } from "./world-map/map-copy.js";
import {
  boxOfPoints,
  DEFAULT_BRUSH,
  DEFAULT_MAP_FONT,
  emblemTextAdvance,
  emblemTextMetrics,
  fitStrokeCurve,
  mapObjectId,
  MARKER_CATEGORY_MAP,
  normalizeWorldMap,
  polygonCentroid,
  shapePoints,
  strokeLine,
  WORLD_MAP_LIMITS,
} from "@modovik/vector-map";

// ---------------------------------------------------------------------------
// Таблицы и мелкие помощники

// Вид объекта -> раздел проекта. Обычный объект (не без прототипа): имена вроде
// `toString` проходят проверку «вид известен» и дальше бросают TypeError.
const SECTION_OF = Object.freeze(
  Object.fromEntries([
    ["zone", "zones"],
    ["marker", "markers"],
    ["stroke", "paint"],
    ["emblem", "emblems"],
  ]),
);
const KINDS_IN_ORDER = Object.keys(SECTION_OF);
const ZONE_PALETTE = "ff5d72 6ea8ff ffb454 5fd6a8 c69bff 4fd8e8 ff7ad9 ffe066"
  .split(" ")
  .map((hex) => `#${hex}`);
const STROKE_NAME_KEY = Object.fromEntries([
  ["free", "Мазок {n}"],
  ["line", "Линия {n}"],
  ["arrow", "Стрелка {n}"],
  ["arrows", "Стрелка {n}"],
]);

// Поля мазка, которые берутся из кисти как есть (по порядку).
const BRUSH_FIELDS = "color size opacity softness blend target".split(" ");

const LAYER_FORMAT = "astral-world-map-layer";
const LAYER_VERSION = 1;
const EMBLEM_MIN_WIDTH = 60;
const EMBLEM_MAX_WIDTH = 12000;
const ROTATE_STEP = 15;
const RING_FACTOR = 3.2;
const ZONE_REACH = 1.4;
const MARKER_REACH = 1.6;

export const HIT_LAYER_ORDER = Object.freeze("emblems markers zones paint".split(" "));
export const DRAFT_MIN_POINTS = 3;
export const SHAPE_MIN_SIDE = 40;
export const DRAW_MODE_STROKES = Object.freeze(
  Object.fromEntries(
    [
      ["free", "free", "none"],
      ["line", "line", "none"],
      ["arrow", "line", "end"],
      ["arrows", "line", "both"],
    ].map(([mode, kind, arrow]) => [mode, Object.freeze({ kind, arrow })]),
  ),
);

function declined(config) {
  return { config, selection: null };
}

function accepted(config, kind, id) {
  return { config, selection: { kind, id } };
}

// Копия проекта, где раздел `name` заменён «его поля + то, что вернул change(раздел)».
function rewriteSection(config, name, change) {
  const section = config[name];
  return { ...config, [name]: { ...section, ...change(section) } };
}

function rewriteItems(config, name, transform) {
  return rewriteSection(config, name, (section) => ({ items: transform(section.items) }));
}

function addItem(config, name, item) {
  return rewriteItems(config, name, (items) => [...items, item]);
}

function finitePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
}

// Минимум и максимум координаты `axis` по списку точек.
function extentOf(list, axis) {
  return [...list].reduce(
    ([low, high], entry) => [Math.min(low, entry[axis]), Math.max(high, entry[axis])],
    [Infinity, -Infinity],
  );
}

// Рамка ломаной запоминается по самому массиву точек (горячий путь hitTest).
const frameCache = new WeakMap();

function measureFrame(points) {
  const [minX, maxX] = extentOf(points, "x");
  const [minY, maxY] = extentOf(points, "y");
  return { minX, maxX, minY, maxY };
}

function frameOf(points) {
  if (!frameCache.has(points)) frameCache.set(points, measureFrame(points));
  return frameCache.get(points);
}

function farFromFrame(frame, world, reach) {
  return [
    world.x < frame.minX - reach,
    world.x > frame.maxX + reach,
    world.y < frame.minY - reach,
    world.y > frame.maxY + reach,
  ].includes(true);
}

// Градусы: целое в диапазоне -180…180.

function wrapDegrees(degrees) {
  const shifted = (degrees + 180) % 360;
  const positive = (shifted + 360) % 360;
  return Math.round(positive - 180);
}

function snapDegrees(degrees, snap) {
  return snap ? Math.round(degrees / ROTATE_STEP) * ROTATE_STEP : degrees;
}

function bearingFrom(center, target) {
  return (Math.atan2(target.y - center.y, target.x - center.x) * 180) / Math.PI;
}

function perWorldUnit(projector) {
  return projector.length(1000) / 1000 || 1;
}

// Точка `from` не дальше `limit` от точки `to`.
function within(from, to, limit) {
  return Math.hypot(from.x - to.x, from.y - to.y) <= limit;
}

// cos и sin угла, заданного в градусах.
function rotationParts(degrees) {
  const turn = (degrees * Math.PI) / 180;
  return { cos: Math.cos(turn), sin: Math.sin(turn) };
}

// Точка, смещённая от центра на (dx, dy) в осях, повёрнутых на turn.
function rotatedFrom(center, turn, dx, dy) {
  return {
    x: center.x + dx * turn.cos - dy * turn.sin,
    y: center.y + dx * turn.sin + dy * turn.cos,
  };
}

const around = (x, y, radius) => ({
  minX: x - radius,
  maxX: x + radius,
  minY: y - radius,
  maxY: y + radius,
});

// ---------------------------------------------------------------------------
// Геометрия попадания

// Луч вправо от точки пересекает ребро a–b?

// X-координата ребра a–b на высоте y.
function edgeXAt(y, a, b) {
  return ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
}

// Луч вправо от точки пересекает ребро a–b?
function crossesRay(point, a, b) {
  if (a.y > point.y === b.y > point.y) return false;
  return point.x < edgeXAt(point.y, a, b);
}

export function pointInPolygon(point, polygon) {
  const total = polygon.length;
  let inside = false;
  let at = total;
  while (at > 0) {
    at -= 1;
    const back = at === 0 ? total - 1 : at - 1;
    if (crossesRay(point, polygon[at], polygon[back])) inside = !inside;
  }
  return inside;
}

export function projectOnSegment(point, a, b) {
  const step = { x: b.x - a.x, y: b.y - a.y };
  const lengthSq = step.x * step.x + step.y * step.y;
  if (lengthSq) {
    const along = ((point.x - a.x) * step.x + (point.y - a.y) * step.y) / lengthSq;
    const t = Math.max(0, Math.min(1, along));
    const nearest = { x: a.x + step.x * t, y: a.y + step.y * t };
    return { distance: Math.hypot(point.x - nearest.x, point.y - nearest.y), t, point: nearest };
  }
  const distance = Math.hypot(point.x - a.x, point.y - a.y);
  return { distance, t: 0 };
}

export function strokeDistance(points, world) {
  if (!points || !points.length) return Infinity;
  if (points.length === 1) return Math.hypot(points[0].x - world.x, points[0].y - world.y);

  const list = Array.isArray(points) ? points : Array.from(points);
  return list.reduce((best, next, at) => {
    if (at === 0) return best;
    const gap = projectOnSegment(world, list[at - 1], next).distance;
    return gap < best ? gap : best;
  }, Infinity);
}

export function strokeReaches(item, world, reach) {
  const line = strokeLine(item);
  return (
    line.length > 0 &&
    !farFromFrame(frameOf(line), world, reach) &&
    strokeDistance(line, world) <= reach
  );
}

// Черновик зоны и вершины/рёбра выбранной зоны

export function duplicatesLastDraftPoint(draft, world, tolerance) {
  return Array.isArray(draft) && draft.length > 0 && within(draft.at(-1), world, tolerance);
}

export function closesDraft(draft, world, tolerance) {
  const enough = Array.isArray(draft) && draft.length >= DRAFT_MIN_POINTS;
  return enough && within(draft[0], world, tolerance);
}

// Лучшее (позднее при равенстве) из кандидатов `[номер, расстояние]` в пределах допуска.
function closestWithin(candidates, tolerance) {
  const best = candidates.reduce(
    (state, [index, gap]) => (gap <= state.limit ? { limit: gap, index } : state),
    { limit: tolerance, index: -1 },
  );
  return best.index;
}

function vertexGaps(zone, world) {
  return Array.from(zone.points.entries(), ([index, vertex]) => [
    index,
    Math.hypot(vertex.x - world.x, vertex.y - world.y),
  ]);
}

export function hitZoneVertex(zone, world, tolerance) {
  return zone ? closestWithin(vertexGaps(zone, world), tolerance) : -1;
}

export function hitZoneEdge(zone, world, tolerance) {
  if (!zone || zone.points.length < 2) return -1;
  const ring = zone.points;
  const edgeCount = ring.length - (zone.open ? 1 : 0);
  const gaps = Array.from({ length: edgeCount }, (_, edge) => [
    edge,
    projectOnSegment(world, ring[edge], ring[(edge + 1) % ring.length]).distance,
  ]);
  return closestWithin(gaps, tolerance);
}

// ---------------------------------------------------------------------------
// hitTest: у каждого слоя свой проб, «верхний» — последний в списке

// Спрятанный набор не берётся никогда; закреплённый (сам или набором) — без includeLocked.
function canGrab(section, item, includeLocked) {
  const group = item.group || "own";
  const hidden = (section.hiddenGroups || []).includes(group);
  if (hidden) return false;
  if (includeLocked) return true;
  if (item.locked) return false;
  return !(section.lockedGroups || []).includes(group);
}

function zoneIsHit(section, zone, world, tolerance, rules) {
  if (!zone.enabled) return false;
  if (zone.points.length < (zone.open ? 2 : 3)) return false;
  if (!canGrab(section, zone, rules.includeLocked)) return false;
  if (farFromFrame(frameOf(zone.points), world, rules.reach)) return false;

  if (!zone.open && !rules.outline && pointInPolygon(world, zone.points)) return true;
  if (zone.points.some((vertex) => within(vertex, world, tolerance))) return true;
  return Boolean(rules.outline || zone.open) && hitZoneEdge(zone, world, rules.reach) >= 0;
}

function probeZones(config, world, tolerance, options) {
  const section = config.zones;
  if (!section.enabled) return null;
  const rules = {
    reach: tolerance * ZONE_REACH,
    includeLocked: Boolean(options.includeLocked),
    outline: Boolean(options.outline),
  };
  const hits = (candidate) => zoneIsHit(section, candidate, world, tolerance, rules);
  const at = section.items.findLastIndex(hits);
  return at < 0 ? null : { kind: "zone", id: section.items[at].id };
}

// Расстояние до метки (может быть NaN) либо undefined, если метка не кандидат.
function markerGap(section, item, world, reach, includeLocked) {
  if (Math.abs(item.x - world.x) > reach || Math.abs(item.y - world.y) > reach) return undefined;
  if (!item.enabled || !canGrab(section, item, includeLocked)) return undefined;
  const category = section.categories[item.category] || section.categories.landmark;
  if (!category || !category.enabled) return undefined;
  const gap = Math.hypot(item.x - world.x, item.y - world.y);
  return gap > reach ? undefined : gap;
}

function probeMarkers(config, world, tolerance, options) {
  const section = config.markers;
  if (!section.enabled) return null;
  const reach = tolerance * MARKER_REACH;
  const includeLocked = Boolean(options.includeLocked);

  // Первый кандидат берётся всегда, дальше — только строго более близкие.
  const nearest = section.items.reduce(
    (best, item) => {
      const gap = markerGap(section, item, world, reach, includeLocked);
      if (gap === undefined) return best;
      return best.item === null || gap < best.gap ? { item, gap } : best;
    },
    { item: null, gap: Infinity },
  );
  return nearest.item ? { kind: "marker", id: nearest.item.id } : null;
}

function probePaint(config, world, tolerance, options) {
  const section = config.paint;
  if (!section.enabled) return null;
  const includeLocked = Boolean(options.includeLocked);
  const stroke = section.items.findLast((item) => {
    if (!item.enabled || (item.locked && !includeLocked)) return false;
    return strokeReaches(item, world, item.size / 2 + tolerance);
  });
  return stroke ? { kind: "stroke", id: stroke.id } : null;
}

function emblemHalfHeight(item, halfWidth, textAdvance) {
  if (item.kind === "image") return halfWidth / (item.aspect || 1);
  const advance = emblemTextAdvance(item, textAdvance);
  const lines = emblemTextMetrics(item, textAdvance).height;
  return ((item.width / advance) * lines) / 2;
}

// Смещение точки вдоль и поперёк надписи (оси повёрнуты вместе с ней).

function emblemOffsets(item, world) {
  const [dx, dy] = [world.x - item.x, world.y - item.y];
  const { cos, sin } = rotationParts(item.rotation || 0);
  return [dx * cos - dy * sin, -dx * sin - dy * cos];
}

function emblemIsHit(item, world, tolerance, options) {
  if (!item.enabled || (item.locked && !options.includeLocked)) return false;
  const halfWidth = item.width / 2;
  const halfHeight = emblemHalfHeight(item, halfWidth, options.textAdvance);
  const [along, across] = emblemOffsets(item, world);
  const limits = [
    [along, halfWidth],
    [across, halfHeight],
  ];
  return limits.every(([offset, half]) => Math.abs(offset) <= half + tolerance);
}

function probeEmblems(config, world, tolerance, options) {
  const settings = { includeLocked: Boolean(options.includeLocked), textAdvance: options.textAdvance };
  const emblem = config.emblems.items.findLast((item) =>
    emblemIsHit(item, world, tolerance, settings),
  );
  return emblem ? { kind: "emblem", id: emblem.id } : null;
}

const LAYER_PROBES = new Map([
  ["zones", probeZones],
  ["markers", probeMarkers],
  ["paint", probePaint],
  ["emblems", probeEmblems],
]);

export function hitTest(config, layer, world, tolerance, prefer = null, options = {}) {
  const probe = LAYER_PROBES.get(layer);
  if (probe) return probe(config, world, tolerance, options);
  if (layer !== "all") return null;

  const rest = HIT_LAYER_ORDER.filter((name) => name !== prefer);
  const order = HIT_LAYER_ORDER.includes(prefer) ? [prefer, ...rest] : HIT_LAYER_ORDER;
  return order.reduce(
    (found, name) => found || hitTest(config, name, world, tolerance, null, options),
    null,
  );
}

export function zonePress(config, world, tolerance, prefer = null) {
  const grab = hitTest(config, "zones", world, tolerance, prefer, { outline: true });
  const under = hitTest(config, "zones", world, tolerance, prefer);
  return { grab, under };
}

// ---------------------------------------------------------------------------
// Объекты проекта: поиск, правка, перенос, удаление

export function findObject(config, selection) {
  const items = selection ? config[SECTION_OF[selection.kind]].items : [];
  return items.find((item) => item.id === selection.id) ?? null;
}

export function patchObject(config, selection, patch) {
  if (!selection) return config;
  const isTarget = (item) => item.id === selection.id;
  const patched = (item) => (isTarget(item) ? { ...item, ...patch } : item);
  return rewriteItems(config, SECTION_OF[selection.kind], (items) => items.map(patched));
}

const isPolyline = (kind) => kind === "zone" || kind === "stroke";

const shiftXY = (spot, dx, dy) => ({ x: spot.x + dx, y: spot.y + dy });

// Поля, которые меняются при переносе: точки (и рамка) у зоны и мазка, x и y у остальных.
function movedFields(target, kind, dx, dy) {
  if (!isPolyline(kind)) return shiftXY(target, dx, dy);
  const fields = { points: target.points.map((p) => shiftXY(p, dx, dy)) };
  if (target.box) fields.box = { ...target.box, ...shiftXY(target.box, dx, dy) };
  return fields;
}

function movedConfig(config, selection, target, delta) {
  const dx = delta.x;
  const dy = delta.y;
  return patchObject(config, selection, movedFields(target, selection.kind, dx, dy));
}

export function moveObject(config, selection, delta) {
  const target = findObject(config, selection);
  return target ? movedConfig(config, selection, target, delta) : config;
}

export function removeObject(config, selection) {
  const name = selection ? SECTION_OF[selection.kind] : undefined;
  if (!name) return config;
  return rewriteItems(config, name, (items) => items.filter((item) => item.id !== selection.id));
}

// Правка вершины делает фигуру своей: рамка и имя фигуры сбрасываются.
function ownShape(zone) {
  if (!zone.shape || zone.shape === "free") return zone;
  return { ...zone, shape: "free", box: null };
}

// Заменяет зоны с данным id результатом change(зона).
function changeZones(config, zoneId, change) {
  return rewriteItems(config, "zones", (items) =>
    items.map((zone) => (zone.id === zoneId ? change(zone) : zone)),
  );
}

const withPoints = (zone, points) => ({ ...ownShape(zone), points });

function withInserted(list, index, item) {
  const copy = [...list];
  copy.splice(index, 0, item);
  return copy;
}

export function moveZoneVertex(config, zoneId, index, world) {
  const relocate = (point, at) => (at === index ? { x: world.x, y: world.y } : point);
  const edit = (zone) => withPoints(zone, zone.points.map(relocate));
  return changeZones(config, zoneId, edit);
}

export function insertZoneVertex(config, zoneId, edge, world) {
  const edit = (zone) => {
    const added = { x: world.x, y: world.y };
    return withPoints(zone, withInserted(zone.points, edge + 1, added));
  };
  return changeZones(config, zoneId, edit);
}

export function removeZoneVertex(config, zoneId, index) {
  const edit = (zone) => {
    if (zone.points.length <= 3) return zone;
    const kept = zone.points.filter((_, at) => at !== index);
    return withPoints(zone, kept);
  };
  return changeZones(config, zoneId, edit);
}

function pointOnCircle(world, radius, angle) {
  const [x, y] = [
    [world.x, Math.cos],
    [world.y, Math.sin],
  ].map(([origin, trig]) => Math.round(origin + trig(angle) * radius));
  return { x, y };
}

const angleOfStep = (at, sides) => (at / sides) * Math.PI * 2 - Math.PI / 2;

export function zoneAround(world, radius = 420, sides = 7) {
  const steps = Array.from({ length: sides }, (_, at) => at);
  return steps.map((at) => pointOnCircle(world, radius, angleOfStep(at, sides)));
}

// ---------------------------------------------------------------------------
// Новые объекты

function describeCategory(patch) {
  const category = patch.category || "landmark";
  return { category, title: MARKER_CATEGORY_MAP[category]?.title };
}

export function addMarker(config, world, patch = {}) {
  const id = mapObjectId("marker");
  const { category, title } = describeCategory(patch);
  const marker = Object.fromEntries([
    ["id", id],
    ["category", category],
    ["name", patch.name || title || tr("Новая точка")],
    ["x", Math.round(world.x)],
    ["y", Math.round(world.y)],
    ["enabled", true],
    ["label", true],
    ["dot", true],
    ["circle", Boolean(patch.circle)],
    ["color", patch.color || null],
    ["scale", 100],
    ["circleRadius", null],
    ["labelOffset", { x: 0, y: 0 }],
  ]);
  return accepted(addItem(config, "markers", marker), "marker", id);
}

export function addZone(config, points, name, look = {}) {
  if (points.length < 3) return declined(config);
  const owned = config.zones.items.length;
  if (owned >= WORLD_MAP_LIMITS.zones) return declined(config);

  const id = mapObjectId("zone");
  const shape = look.shape && look.shape !== "free" ? look.shape : "free";
  const zone = Object.fromEntries([
    ["id", id],
    ["name", name || mapText("Зона {n}", { n: owned + 1 })],
    ["color", look.color || ZONE_PALETTE[owned % ZONE_PALETTE.length]],
    ["enabled", true],
    ["label", look.label ?? true],
    ["labelOffset", { x: 0, y: 0 }],
    ["shape", shape],
    ["box", shape === "free" ? null : look.box || null],
    ["line", look.line || "solid"],
    ["fill", look.fill ?? true],
    ["width", look.width ?? null],
    ["points", points],
  ]);
  return accepted(addItem(config, "zones", zone), "zone", id);
}

export function addShapeZone(config, shape, box, look = {}) {
  const tooSmall = !box || box.w < SHAPE_MIN_SIDE || box.h < SHAPE_MIN_SIDE;
  if (tooSmall) return declined(config);
  const labelled = { ...look, label: look.label ?? false, shape, box };
  return addZone(config, shapePoints(shape, box), look.name, labelled);
}

const isShaped = (zone) => Boolean(zone && zone.shape && zone.shape !== "free");
const sizedBox = (box) => {
  const [w, h] = ["w", "h"].map((side) => Math.max(SHAPE_MIN_SIDE, box[side]));
  return { ...box, w, h };
};

// Рамка и точки фигуры заменяются; extra — что ещё записать в зону (например, имя фигуры).
function patchShape(config, selection, shape, box, extra) {
  return patchObject(config, selection, { ...extra, box, points: shapePoints(shape, box) });
}

// Новая рамка зоны: старая, поверх неё правка; стороны округляются и не меньше минимума.
function resizedBox(zone, box) {
  const side = (given, old) => Math.max(SHAPE_MIN_SIDE, Math.round(given ?? old()));
  return {
    ...zone.box,
    ...box,
    w: side(box.w, () => zone.box.w),
    h: side(box.h, () => zone.box.h),
  };
}

export function resizeZoneShape(config, selection, box) {
  const zone = findObject(config, selection);
  if (!isShaped(zone)) return config;
  return patchShape(config, selection, zone.shape, resizedBox(zone, box), {});
}

function reshapeInto(config, selection, zone, shape) {
  const box = zone.box || boxOfPoints(zone.points);
  return box ? patchShape(config, selection, shape, sizedBox(box), { shape }) : config;
}

export function reshapeZone(config, selection, shape) {
  const zone = findObject(config, selection);
  if (!zone) return config;
  const toFree = shape === "free";
  return toFree
    ? patchObject(config, selection, { shape: "free", box: null })
    : reshapeInto(config, selection, zone, shape);
}

const CORNER_SIGNS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

// Рамка на экране: центр, размеры, поворот, четыре угла и ручка поворота над верхней стороной.
function screenFrame(center, width, height, rotation, handleGap) {
  const turn = rotationParts(rotation || 0);
  const [halfX, halfY] = [width / 2, height / 2];
  return {
    center,
    width,
    height,
    rotation: rotation || 0,
    corners: CORNER_SIGNS.map(([sx, sy]) => rotatedFrom(center, turn, sx * halfX, sy * halfY)),
    rotate: rotatedFrom(center, turn, 0, -halfY - handleGap),
  };
}

export function zoneShapeBox(zone, projector, handleGap = 0) {
  if (!zone || !zone.box) return null;
  const { box } = zone;
  const center = projector.point({ x: box.x, y: box.y });
  const width = projector.length(box.w);
  const height = projector.length(box.h);
  return screenFrame(center, width, height, box.rotation, handleGap);
}

// Вектор (dx, dy) в осях рамки, повёрнутой на turn.
function inBoxAxes(dx, dy, turn) {
  return [dx * turn.cos + dy * turn.sin, -dx * turn.sin + dy * turn.cos];
}

function squareUp(axes) {
  const side = Math.max(...axes.map((value) => Math.abs(value)));
  return axes.map((value) => Math.sign(value || 1) * side);
}

export function zoneBoxFromCorner(box, corner, point, { projector, unproject, square = false }) {
  const turn = rotationParts(box.rotation);
  const fixed = box.corners[(corner + 2) % 4];
  const axes = inBoxAxes(point.x - fixed.x, point.y - fixed.y, turn);
  const [localX, localY] = square ? squareUp(axes) : axes;
  const middle = rotatedFrom(fixed, turn, localX / 2, localY / 2);
  const perWorld = perWorldUnit(projector);
  const centre = unproject(middle);
  const [w, h] = [localX, localY].map((local) => Math.round(Math.abs(local) / perWorld));
  const [x, y] = [centre.x, centre.y].map((coordinate) => Math.round(coordinate));
  return { w, h, x, y };
}

function fitTolerance(fit, settings) {
  if (fit.tolerance > 0) return fit.tolerance;
  return Math.max(1, settings.size * 0.04);
}

// Точки и признак кривой для мазка: прямая — два конца, рука — подгонка кривой.
function strokeTrace(straight, kept, fit, settings) {
  if (straight) return { points: [kept[0], kept.at(-1)], curve: false };
  const tolerance = fitTolerance(fit, settings);
  const fitted = fitStrokeCurve(kept, { tolerance, maxPoints: WORLD_MAP_LIMITS.strokePoints });
  const [first] = fitted.points;
  const single = fitted.points.length === 1;
  const padded = single ? [first, { x: first.x + 1, y: first.y }] : fitted.points;
  return { points: padded, curve: fitted.curve && padded === fitted.points };
}

export function addStroke(config, points, brush = {}, fit = {}, mode = "free") {
  const kept = finitePoints(points);
  if (kept.length === 0) return declined(config);

  const kinds = DRAW_MODE_STROKES[mode] || DRAW_MODE_STROKES.free;
  const settings = { ...DEFAULT_BRUSH, ...brush };
  const straight = kinds.kind === "line";
  const [first, last] = [kept[0], kept.at(-1)];
  const spanLength = Math.hypot(first.x - last.x, first.y - last.y);
  if (straight && spanLength < 1) {
    return { config, selection: null, tooShort: true };
  }
  const owned = config.paint.items.length;
  if (owned >= WORLD_MAP_LIMITS.strokes) return declined(config);

  const trace = strokeTrace(straight, kept, fit, settings);
  const id = mapObjectId("stroke");
  const name = mapText(STROKE_NAME_KEY[mode] || "Мазок {n}", { n: owned + 1 });
  const fromBrush = Object.fromEntries(BRUSH_FIELDS.map((field) => [field, settings[field]]));
  const tip = { arrow: kinds.arrow, kind: kinds.kind };
  const stroke = {
    id,
    name,
    ...fromBrush,
    line: settings.line || "solid",
    ...tip,
    curve: trace.curve,
    enabled: true,
    points: trace.points,
  };
  return accepted(addItem(config, "paint", stroke), "stroke", id);
}

export function eraseObjects(config, points, radius, { textAdvance = null } = {}) {
  const probe = (spot) => hitTest(config, "all", spot, radius, null, { outline: true, textAdvance });
  const touches = finitePoints(points).map(probe).filter(Boolean);
  const targets = [...new Map(touches.map((hit) => [`${hit.kind}:${hit.id}`, hit])).values()];
  if (targets.length === 0) return { config, removed: 0 };
  return { config: removeObjects(config, targets), removed: targets.length };
}

// ---------------------------------------------------------------------------
// Надписи и картинки

// Поля новой надписи по порядку: [имя, как получить из правки (p) и точки (w)].
const EMBLEM_FIELDS = [
  ["kind", (p) => p.kind || "text"],
  ["assetId", (p) => p.assetId || ""],
  ["text", (p) => p.text || "UZI"],
  ["x", (p, w) => Math.round(w.x)],
  ["y", (p, w) => Math.round(w.y)],
  ["width", (p) => p.width || 1400],
  ["rotation", (p) => p.rotation || 0],
  ["opacity", (p) => p.opacity ?? 100],
  ["color", (p) => p.color || "#ffffff"],
  ["font", (p) => p.font || DEFAULT_MAP_FONT],
  ["fontAssetId", (p) => p.fontAssetId || ""],
  ["fontName", (p) => p.fontName || ""],
  ["weight", (p) => p.weight || "black"],
  ["letterSpacing", (p) => p.letterSpacing || 0],
  ["outline", (p) => p.outline || 0],
  ["outlineColor", (p) => p.outlineColor || "#04060a"],
  ["glow", (p) => p.glow || 0],
  ["glowColor", (p) => p.glowColor || "#ffffff"],
  ["blend", () => "normal"],
  ["flip", () => false],
  ["enabled", () => true],
];

// Куда вставить надпись: целый номер в пределах списка либо в конец.
function insertionPoint(index, length) {
  return Number.isInteger(index) ? Math.max(0, Math.min(length, index)) : length;
}

export function addEmblem(config, world, patch = {}) {
  const current = config.emblems.items;
  if (current.length >= WORLD_MAP_LIMITS.emblems) return declined(config);

  const id = patch.id || mapObjectId("emblem");
  const emblem = Object.fromEntries([
    ["id", id],
    ...EMBLEM_FIELDS.map(([key, make]) => [key, make(patch, world)]),
  ]);
  if (patch.group) emblem.group = patch.group;
  if (patch.schedule) Object.assign(emblem, { schedule: patch.schedule, aspect: patch.aspect });

  const place = insertionPoint(patch.index, current.length);
  const items = [...current.slice(0, place), emblem, ...current.slice(place)];
  return accepted(rewriteSection(config, "emblems", () => ({ items })), "emblem", id);
}

function emblemHeight(emblem, width, textAdvance) {
  if (emblem.kind === "image") return width / (emblem.aspect || 1);
  const metrics = emblemTextMetrics(emblem, textAdvance);
  return (width / metrics.advance) * metrics.height;
}

export function emblemBox(emblem, projector, handleGap = 0, textAdvance = null) {
  const [center, width] = [projector.point(emblem), projector.length(emblem.width)];
  const height = emblemHeight(emblem, width, textAdvance);
  return screenFrame(center, width, height, emblem.rotation, handleGap);
}

export function hitEmblemHandle(box, point, radius, { ring = false } = {}) {
  if (within(box.rotate, point, radius)) return "rotate";

  const firstWithin = (limit) => box.corners.findIndex((spot) => within(spot, point, limit));
  const corner = firstWithin(radius);
  if (corner >= 0) return `corner-${corner}`;

  const outside = ring && !pointInPolygon(point, box.corners);
  const outer = outside ? firstWithin(radius * RING_FACTOR) : -1;
  return outer >= 0 ? `rotate-corner-${outer}` : null;
}

export function rotationFromDrag(box, start, point, startRotation, snap = false) {
  const toPoint = bearingFrom(box.center, point);
  const toStart = bearingFrom(box.center, start);
  return wrapDegrees(snapDegrees(startRotation + toPoint - toStart, snap));
}

export function emblemRotationFromPointer(box, point, snap = false) {
  return wrapDegrees(snapDegrees(bearingFrom(box.center, point) + 90, snap));
}

// Ширина кадра на сцене, при которой угол рамки приходится на курсор (пропорция сохраняется).

function sceneWidthFor(box, point) {
  const radius = Math.hypot(point.x - box.center.x, point.y - box.center.y);
  const ratio = box.height / Math.max(1e-6, box.width);
  return (2 * radius) / Math.sqrt(1 + ratio * ratio);
}

export function emblemWidthFromPointer(box, point, projector) {
  const scene = sceneWidthFor(box, point);
  const inWorld = scene / perWorldUnit(projector);
  return Math.round(Math.min(EMBLEM_MAX_WIDTH, Math.max(EMBLEM_MIN_WIDTH, inWorld)));
}

export function objectBounds(object, kind) {
  if (!object) return null;
  if (isPolyline(kind)) {
    const stroke = kind === "stroke";
    const line = stroke ? strokeLine(object) : object.points;
    const pad = stroke ? object.size / 2 : 0;
    const [lowX, highX] = extentOf(line, "x");
    const [lowY, highY] = extentOf(line, "y");
    return { minX: lowX - pad, maxX: highX + pad, minY: lowY - pad, maxY: highY + pad };
  }
  const radius = kind === "emblem" ? object.width / 2 : 400;
  return around(object.x, object.y, radius);
}

const copyShift = (spot, offset) => ({ x: spot.x + offset, y: spot.y - offset });

// Поля копии, которые отличаются от оригинала (имя и положение).
function copiedFields(kind, object, offset) {
  const named = (label) => mapText("{name} (копия)", { name: label });
  if (!isPolyline(kind)) {
    return {
      name: object.name ? named(object.name) : object.name,
      ...copyShift(object, offset),
    };
  }
  const fields = {
    name: named(object.name),
    points: object.points.map((p) => copyShift(p, offset)),
  };
  if (object.box) fields.box = { ...object.box, ...copyShift(object.box, offset) };
  return fields;
}

// Копия объекта в его раздел: общая часть duplicateObject и pasteObject.

// Копия объекта в его раздел: общая часть duplicateObject и pasteObject.
function appendCopy(config, kind, object, offset) {
  const id = mapObjectId(kind);
  const changes = copiedFields(kind, object, offset);
  const copy = Object.assign({}, object, { id }, changes, { locked: false });
  const next = addItem(config, SECTION_OF[kind], copy);
  return accepted(next, kind, id);
}

export function duplicateObject(config, selection, offset = 260) {
  const object = findObject(config, selection);
  return object ? appendCopy(config, selection.kind, object, offset) : { config, selection };
}

// Сдвиг, после которого середина рамки bounds ложится в точку at.
function centreOnto(bounds, at) {
  const middle = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  return { x: Math.round(at.x - middle.x), y: Math.round(at.y - middle.y) };
}

export function pasteObject(config, clip, at) {
  const { object, kind } = clip ?? {};
  if (!object || !kind) return declined(config);
  const made = appendCopy(config, kind, object, 0);
  const bounds = objectBounds(object, kind);
  if (!bounds || !at) return made;
  const moved = moveObject(made.config, made.selection, centreOnto(bounds, at));
  return { ...made, config: moved };
}

// ---------------------------------------------------------------------------
// Несколько объектов, обмен наборами, подгонка

export function moveObjects(config, targets, delta) {
  return [...(targets || [])].reduce((current, target) => {
    const kindless = typeof target === "object" && target !== null && !target.kind;
    if (!target || kindless) return current;
    const object = findObject(current, target);
    return object && !object.locked ? moveObject(current, target, delta) : current;
  }, config);
}

export function removeObjects(config, targets) {
  return [...(targets || [])].reduce((current, target) => removeObject(current, target), config);
}

const BOX_AXES = [
  ["minX", "maxX"],
  ["minY", "maxY"],
];

function overlaps(bounds, box) {
  return BOX_AXES.every(([low, high]) => bounds[low] <= box[high] && bounds[high] >= box[low]);
}

function markerBounds(item) {
  const { x, y } = item;
  return { minX: x, maxX: x, minY: y, maxY: y };
}

// Цели вида `kind` из раздела, чьи рамки пересекают рамку выделения.
function targetsInBox(section, kind, box) {
  if (!section || section.enabled === false) return [];
  const blocked = new Set([...(section.hiddenGroups || []), ...(section.lockedGroups || [])]);
  const selectable = (item) =>
    item.enabled !== false && !item.locked && !blocked.has(item.group || "own");
  const boundsOf = (item) => (kind === "marker" ? markerBounds(item) : objectBounds(item, kind));
  return section.items
    .filter(selectable)
    .filter((item) => overlaps(boundsOf(item), box))
    .map((item) => ({ kind, id: item.id }));
}

const spanBetween = (a, b) => [Math.min(a, b), Math.max(a, b)];

export function objectsInRect(config, rect) {
  const [minX, maxX] = spanBetween(rect.a.x, rect.b.x);
  const [minY, maxY] = spanBetween(rect.a.y, rect.b.y);
  const box = { minX, maxX, minY, maxY };
  return KINDS_IN_ORDER.flatMap((kind) => targetsInBox(config[SECTION_OF[kind]], kind, box));
}

export function exportLayer(config, layer) {
  const { items } = normalizeWorldMap(config)[layer];
  return { format: LAYER_FORMAT, version: LAYER_VERSION, layer, items };
}

function layerSource(payload) {
  if (payload && typeof payload === "object" && Array.isArray(payload.items)) return payload.items;
  return Array.isArray(payload) ? payload : null;
}

export function importLayer(config, layer, payload) {
  const source = layerSource(payload);
  if (source === null) throw new Error(tr("Файл не похож на набор объектов карты."));

  const section = { ...config[layer], items: source };
  const normalized = normalizeWorldMap({ ...config, [layer]: section });
  if (normalized[layer].items.length === 0) {
    throw new Error(tr("В файле не нашлось ни одного пригодного объекта."));
  }
  return normalized;
}

// Ширина и высота прямоугольника, описанного вокруг точек.
function boundsSides(points) {
  const [lowX, highX] = extentOf(points, "x");
  const [lowY, highY] = extentOf(points, "y");
  return [highX - lowX, highY - lowY];
}

const byId = (items, id) => items.find((item) => item.id === id);

// Сколько места под надпись в рамке зоны: картинка держит свою пропорцию, текст — 4 : 1.
function emblemRoom(emblem, [boxWidth, boxHeight]) {
  const aspect = emblem.kind === "image" ? emblem.aspect || 1 : 4;
  return Math.min(boxWidth, boxHeight * aspect);
}

export function fitEmblemToZone(config, emblemId, zoneId, fill = 0.7) {
  const emblem = byId(config.emblems.items, emblemId);
  const zone = byId(config.zones.items, zoneId);
  const incomplete = !emblem || !zone || zone.points.length < 3;
  if (incomplete) return config;

  const sides = boundsSides(zone.points);
  const centre = polygonCentroid(zone.points);
  const width = Math.round(Math.max(EMBLEM_MIN_WIDTH, emblemRoom(emblem, sides) * fill));
  const placement = { x: Math.round(centre.x), y: Math.round(centre.y), width, rotation: 0 };
  return patchObject(config, { kind: "emblem", id: emblemId }, placement);
}

export function textWidthFor(emblem, text, textAdvance = null) {
  const size = emblem.width / emblemTextAdvance(emblem, textAdvance);
  const blank = text === null || text === undefined || text === "";
  const next = emblemTextAdvance({ ...emblem, text: blank ? " " : text }, textAdvance);
  return Math.max(EMBLEM_MIN_WIDTH, Math.round(size * next));
}
