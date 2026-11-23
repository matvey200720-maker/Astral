import { REPEAT_METRES } from "./text-style.js";
import { normalizeWorldMap } from "../model.js";
import { atlasState, markerItemsCached, zoneItemsCached } from "./caches.js";
import { strokeItems } from "./strokes.js";
import { declutterLabels, labelKey, repeatKey, withOwners } from "./labels.js";
import { majesticMarkItems } from "../majestic-marks.js";
import { baseFilter, round, zoomResponse } from "./geometry.js";
import { emblemItems } from "./emblems.js";
import {
  baseImageItem,
  gridItems,
  schematicItems,
  templateTileItems,
  tileItems,
  tintItems,
} from "./base-items.js";
import { labelMeshItems } from "../label-mesh.js";

const NEAR_UNITS = 160;
const CIRCLE_PREFIX = "marker-circle-";

// Виды подписей сцены; порядок — порядок поиска под точкой.
const LABEL_KINDS = ["marker", "zone"];
const LABEL_ID = /^(marker|zone)-label-/;
const layerNameOf = (kind) => `${kind}-labels`;
const prefixOf = (kind) => `${kind}-label-`;

const byId = (wanted) => (entry) => entry.id === wanted;
const sizeOf = ({ width, height }) => ({ width, height });
const anchorOf = ({ x, y }) => ({ x, y });
const product = (...factors) => factors.reduce((running, factor) => running * factor);
const apart = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Устойчивая сортировка по таблице ключей [чтение, направление]: значения считаются один раз
// на предмет, а в сравнении первая ненулевая разность решает.
function orderBy(items, keys) {
  const columns = keys.map(([read]) => items.map((item) => read(item)));
  const ways = keys.map(([, way]) => way);
  return items
    .map((item, at) => at)
    .sort((i, j) => {
      for (let col = 0; col < columns.length; col += 1) {
        const column = columns[col];
        const gap = ways[col] > 0 ? column[i] - column[j] : column[j] - column[i];
        if (gap) return gap;
      }
      return 0;
    })
    .map((at) => items[at]);
}

// ---------------------------------------------------------------------------
// Рамка текста подписи

const WIDTH_FACTORS = [
  [0.54, 0.58],
  [0.66, 0.72],
];

const givenLines = (item) => item.lines?.length && item.lines;

function longerOf(best, line) {
  return best.length < line.length ? line : best;
}

function factorFor(longest, family) {
  const capital = longest === longest.toLocaleUpperCase("ru");
  return WIDTH_FACTORS[Number(capital)][Number(String(family || "").startsWith("Inter"))];
}

export const sceneTextBox = (item) => {
  const lines = givenLines(item) || [String(item.value)];
  const longest = lines.reduce(longerOf, "");
  const factor = factorFor(longest, item.family);
  const width = item.fitSpacing
    ? item.fitSpacing
    : product(Math.max(1, longest.length), item.size, factor) +
      product(item.letterSpacing || 0, Math.max(0, longest.length - 1));
  const height =
    product(item.size, 1.05) + product(lines.length - 1, item.lineStep || product(item.size, 1.12));
  const box = anchorOf(item);
  box.width = width;
  box.height = height;
  box.rotation = item.rotation || 0;
  box.origin = item.origin || anchorOf(item);
  return box;
};

// Рамка считается один раз на предмет и дальше не пересчитывается.
export const TEXT_BOXES = new WeakMap();

export const cachedTextBox = (item) => {
  if (!TEXT_BOXES.has(item)) TEXT_BOXES.set(item, sceneTextBox(item));
  return TEXT_BOXES.get(item);
};

// ---------------------------------------------------------------------------
// Готовая сцена: подпись по объекту и под точкой

export const sceneLabelOf = (scene, target) => {
  if (!target) return null;
  const kind = target.kind === "zone" ? "zone" : "marker";
  const wanted = `${prefixOf(kind)}${target.id}`;
  return scene?.layers?.find(byId(layerNameOf(kind)))?.items?.find(byId(wanted)) ?? null;
};

const layerItems = (scene, kind) =>
  scene?.layers?.find(byId(layerNameOf(kind)))?.items || [];

function* topDown(items) {
  for (let at = items.length; at-- > 0; ) yield items[at];
}

const labelRef = (id) => {
  const hit = LABEL_ID.exec(id);
  return hit && { kind: hit[1], id: id.slice(hit[0].length) };
};

// Точка (пара) вокруг центра pin на заданный угол в градусах: строки матрицы поворота.
function turnAround(offset, pin, degrees) {
  const turn = (-(degrees || 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const rows = [
    [cos, -sin],
    [sin, cos],
  ];
  return rows.map((row, axis) => pin[axis] + row[0] * offset[0] + row[1] * offset[1]);
}

// Рамка запомненной подписи на её нынешнем месте: размеры и точка поворота берутся из памяти.
class LabelFrame {
  constructor(item) {
    const box = cachedTextBox(item);
    this.item = item;
    this.size = [box.width, box.height];
    this.pin = [box.origin.x, box.origin.y];
  }

  reach(pad) {
    const { item, pin, size } = this;
    return Math.hypot(item.x - pin[0], item.y - pin[1]) + Math.hypot(...size) / 2 + pad;
  }

  contains(point, pad) {
    const reach = this.reach(pad);
    const offset = [point.x - this.pin[0], point.y - this.pin[1]];
    if (offset.some((gap) => Math.abs(gap) > reach)) return false;
    const along = turnAround(offset, this.pin, this.item.rotation);
    const centre = [this.item.x, this.item.y];
    return !along.some((value, axis) => Math.abs(value - centre[axis]) > this.size[axis] / 2 + pad);
  }
}

function* labelHits(scene, point, pad) {
  for (const kind of LABEL_KINDS) {
    for (const item of topDown(layerItems(scene, kind))) {
      if (item.kind !== "text" || !new LabelFrame(item).contains(point, pad)) continue;
      const ref = labelRef(String(item.id));
      if (ref) yield ref;
    }
  }
}

export const sceneLabelAt = (scene, point, pad = 0) =>
  labelHits(scene, point, pad).next().value ?? null;

// ---------------------------------------------------------------------------
// Чтение контекста: что за подложка и откуда берутся плитки

function listAt(context, key) {
  return Array.isArray(context[key]) ? context[key] : [];
}

// Шаги идут в порядке чтений контекста; каждый видит уже найденное (got).
const BACKDROP_STEPS = [
  ["tiles", (got, context) => listAt(context, "tiles")],
  ["landTiles", (got, context) => listAt(context, "landTiles")],
  [
    "template",
    (got, context, sourceIs) =>
      (sourceIs("template") ? context.template?.image && context.template : null) || null,
  ],
  [
    "templateTiles",
    (got, context) => {
      if (!got.template || !context.templateTiles) return null;
      return Array.isArray(got.template.tiles) ? got.template.tiles : null;
    },
  ],
  [
    "baseImage",
    (got, context, sourceIs) => {
      if (sourceIs("image") && context.baseImage) return context.baseImage;
      return got.template && !got.templateTiles ? got.template.image : null;
    },
  ],
  ["processed", (got, context) => Boolean(context.baseProcessed)],
  [
    "modMap",
    (got, context, sourceIs) =>
      sourceIs("template") && Boolean(context.template) && !context.template.image,
  ],
  [
    "vector",
    (got, context) =>
      got.modMap ||
      (Boolean(context.vectorBase) && !got.template && !got.baseImage && got.tiles.length === 0),
  ],
  [
    "raster",
    (got, context) => {
      if (!got.processed || !context.baseRaster) return null;
      return got.baseImage || got.tiles.length > 0 || got.vector ? context.baseRaster : null;
    },
  ],
  ["waiting", (got, context) => got.modMap && !got.raster && !context.templateTiles],
];

function readBackdrop(project, context) {
  const sourceIs = (name) => project.base.source === name;
  const got = {};
  for (const [name, derive] of BACKDROP_STEPS) got[name] = derive(got, context, sourceIs);
  return got;
}

const sceneSource = (backdrop) => {
  if (backdrop.template || backdrop.modMap) return "template";
  if (backdrop.baseImage) return "image";
  return backdrop.tiles.length > 0 || (backdrop.vector && backdrop.raster) ? "game" : "schematic";
};

function windowScaleOf(context) {
  const positive = Number(context.windowScale) > 0;
  return positive ? Number(context.windowScale) : null;
}

// Плитки сцены: остаются с именем и рамкой, лишние поля заменяются на null.
const GAME_TILE_KEYS = ["name", "rect", "format", "levels", "width"];
const LAND_TILE_KEYS = ["name", "href", "rect", "format", "levels", "width"];
const AS_IS_KEYS = new Set(["name", "rect"]);

const copyKeys = (tile, keys) =>
  Object.fromEntries(keys.map((key) => [key, AS_IS_KEYS.has(key) ? tile[key] : tile[key] || null]));

const trimTiles = (list, keys) =>
  list.filter((tile) => tile?.name && tile?.rect).map((tile) => copyKeys(tile, keys));

// ---------------------------------------------------------------------------
// Подписи: повторы, расстановка, закреплённые

const RANK_THEN_SIZE = [
  [(label) => label.rank ?? 1, 1],
  [(label) => label.size || 0, -1],
];

// Предел расстояния для пары «уже оставленная, текущая».
function repeatLimit(near, far, declutter) {
  return (held, label) => {
    if (!held.fixed && !label.fixed) return near;
    const sameGroup = Boolean(held.group) && held.group === label.group;
    return !declutter || sameGroup ? 0 : far;
  };
}

function admit(crowd, key, label, limitOf) {
  const held = crowd.get(key);
  if (held === undefined) {
    crowd.set(key, [label]);
    return true;
  }
  if (held.some((other) => apart(other, label) < limitOf(other, label))) return false;
  held.push(label);
  return true;
}

function dropRepeats({ labels, projector, shrink, declutter }) {
  const limitOf = repeatLimit(NEAR_UNITS * shrink, projector.length(REPEAT_METRES), declutter);
  const crowd = new Map();
  const alive = new Set(
    orderBy(labels, RANK_THEN_SIZE).filter((label) =>
      admit(crowd, repeatKey(label), label, limitOf),
    ),
  );
  return withOwners(labels.filter((label) => alive.has(label)));
}

const circleIds = (shapes) =>
  new Set(
    shapes
      .filter((shape) => shape.id.startsWith(CIRCLE_PREFIX))
      .map((shape) => shape.id.slice(CIRCLE_PREFIX.length)),
  );

// Ярус подписи: регионы и служебные (-1), точки с кружком (0), остальные (1).
function tierOf(label, circles) {
  if (label.rank <= 0) return -1;
  return circles.has(label.id.slice(prefixOf("marker").length)) ? 0 : 1;
}

const priorityKeys = (circles) => [
  [(label) => tierOf(label, circles), 1],
  [(label) => Number(Boolean(label.fixed)), 1],
  [(label) => (label.fixed ? label.size || 0 : 0), -1],
];

// Порядок расстановки: ранг -1, ранг 0, подписи зон, ранг 1, ранг больше 1.
const SHELVES = [
  (rank) => rank === -1,
  (rank) => rank === 0,
  null,
  (rank) => rank === 1,
  (rank) => rank > 1,
];

const lineUp = (sorted, zoneLabels) =>
  SHELVES.flatMap((fits) => (fits ? sorted.filter((label) => fits(label.rank)) : zoneLabels));

const freshLayout = (markers, projector) => ({
  blockers: new Map(),
  moved: new Map(),
  lifted: markers.lifted,
  bounds: sizeOf(projector),
});

function arrangeLabels({ markerLabels, zoneLabels, markers, projector }) {
  const circles = circleIds(markers.shapes);
  const order = lineUp(orderBy(markerLabels, priorityKeys(circles)), zoneLabels);
  const layout = freshLayout(markers, projector);
  const kept = declutterLabels(order, layout);
  const relocate = (label) => {
    const shift = layout.moved.get(label.id);
    return shift ? { ...label, ...shift } : label;
  };
  const settle = (list) => list.filter((label) => kept.has(label.id)).map(relocate);
  return {
    zoneLabels: settle(zoneLabels),
    markerLabels: withOwners(settle(markerLabels)),
    dropped: order
      .filter((label) => !kept.has(label.id))
      .map((label) => ({ ...label, blockedBy: layout.blockers.get(label.id) })),
  };
}

const pinnedLast = (labels) => [
  ...labels.filter((label) => !label.fixed),
  ...labels.filter((label) => label.fixed),
];

const keysOfLabels = (labels) => labels.map((label) => labelKey(label.value));

function planLabels(project, projector, picked) {
  const { zones, markers, shrink } = picked;
  const taken = new Set(keysOfLabels(markers.labels));
  const zoneKeys = keysOfLabels(zones.labels);
  const ownZones = zones.labels.filter((label, at) => !taken.has(zoneKeys[at]));
  const declutter = project.markers.declutter;
  const spaced = dropRepeats({ labels: markers.labels, projector, shrink, declutter });
  const plan = declutter
    ? arrangeLabels({ markerLabels: spaced, zoneLabels: ownZones, markers, projector })
    : { zoneLabels: ownZones, markerLabels: spaced, dropped: [] };
  return { ...plan, markerLabels: pinnedLast(plan.markerLabels) };
}

// Запись об убранной подписи: общие поля всегда, поля стиля — только у подписей с цветом.
const nullish = (value) => value ?? null;
const orNull = (value) => value || null;
const same = (value) => value;
const DROPPED_FIELDS = [
  ["id", same],
  ["value", same],
  ["x", same],
  ["y", same],
  ["rank", nullish],
  ["size", nullish],
  ["fixed", Boolean],
  ["group", orNull],
  ["blockedBy", nullish],
];

const styleFields = (label) => [
  ["tone", label.tone],
  ...(label.keepHue ? [["keepHue", true]] : []),
  ["family", label.family],
  ["weight", label.weight],
  ["letterSpacing", label.letterSpacing],
  ...(label.lines?.length > 1 ? [["lines", label.lines], ["lineStep", label.lineStep]] : []),
  ...(label.rotation ? [["rotation", label.rotation]] : []),
];

function droppedRecord(label) {
  const record = {};
  for (const [key, shape] of DROPPED_FIELDS) record[key] = shape(label[key]);
  if (!label.tone) return record;
  for (const [key, value] of styleFields(label)) record[key] = value;
  return record;
}

// ---------------------------------------------------------------------------
// Слои сцены

const seaFill = (projector, color) =>
  Object.assign({ id: "sea-fill", kind: "rect" }, { x: 0, y: 0 }, sizeOf(projector), { fill: color });

const uncovered = ({ baseImage, tiles, templateTiles, vector, raster }) =>
  !baseImage && tiles.length === 0 && !templateTiles && !(vector && raster);

function seaItems({ project, projector, backdrop }) {
  const wanted = backdrop.waiting || uncovered(backdrop);
  return !project.base.bare && wanted ? [seaFill(projector, project.base.sea)] : [];
}

// Кусок приближения кладётся поверх растра: [поле рамки, сторона сцены].
const DETAIL_BOX = [
  ["u", "width"],
  ["v", "height"],
  ["width", "width"],
  ["height", "height"],
];

function detailItem(context, projector) {
  const href = context.baseDetail.href;
  const [x, y, width, height] = DETAIL_BOX.map(([side, axis]) =>
    round(context.baseDetail.rect[side] * projector[axis]),
  );
  return { kind: "image", id: "base-detail", href, x, y, width, height, preserveAspectRatio: "none" };
}

const withDetail = (items, context, projector) =>
  context.baseDetail?.href && context.baseDetail.rect
    ? [...items, detailItem(context, projector)]
    : items;

// Первая подходящая подложка: [условие, предметы]; иначе схема штата.
const BASE_RULES = [
  [({ backdrop }) => backdrop.waiting, () => []],
  [
    ({ backdrop }) => backdrop.raster,
    ({ backdrop, context, projector }) =>
      withDetail(baseImageItem(backdrop.raster, projector), context, projector),
  ],
  [
    ({ backdrop }) => backdrop.templateTiles,
    ({ backdrop, projector }) => templateTileItems(backdrop.templateTiles, projector),
  ],
  [
    ({ backdrop }) => backdrop.baseImage,
    ({ backdrop, projector }) => baseImageItem(backdrop.baseImage, projector),
  ],
  [
    ({ backdrop }) => backdrop.tiles.length > 0,
    ({ backdrop, projector }) => tileItems(backdrop.tiles, projector),
  ],
];

function baseItemsOf(frame) {
  const rule = BASE_RULES.find(([applies]) => applies(frame));
  return rule ? rule[1](frame) : schematicItems(frame.project, frame.projector);
}

// Дотяжка резкости: только плиткам игры и только без своего куска приближения.
const baseSettings = ({ project, context, backdrop }) => ({
  filter: backdrop.processed ? "none" : baseFilter(project.base),
  sharpen:
    Boolean(context.sharpenBase) && backdrop.tiles.length > 0 && !backdrop.modMap && !context.baseDetail,
});

// План слоёв в порядке отрисовки: идентификатор, необязательные поля перед items, предметы.
const LAYER_PLAN = [
  { id: "sea", items: seaItems },
  { id: "base", extra: baseSettings, items: baseItemsOf },
  {
    id: "tint",
    items: ({ project, projector, backdrop }) =>
      backdrop.processed ? [] : tintItems(project, projector),
  },
  { id: "paint", items: ({ project, projector }) => strokeItems(project, projector, "map") },
  { id: "grid", items: ({ project, projector }) => gridItems(project, projector) },
  { id: "zone-fills", items: ({ zones }) => zones.fills },
  {
    id: "zone-glows",
    extra: ({ zones }) => ({ blur: zones.glowBlur }),
    items: ({ zones }) => zones.glows,
  },
  { id: "zones", items: ({ zones }) => zones.shapes },
  { id: "majestic-zones", items: ({ majestic }) => majestic.zones },
  { id: "markers", items: ({ markers }) => markers.shapes },
  { id: "majestic-points", items: ({ majestic }) => majestic.points },
  {
    id: "label-mesh",
    items: ({ project, projector }) => labelMeshItems(project.markers, projector),
  },
  { id: "zone-labels", items: ({ labels }) => labels.zoneLabels },
  { id: "marker-labels", items: ({ labels }) => labels.markerLabels },
  {
    id: "emblems",
    items: ({ project, projector, context: { assets, textAdvance } }) =>
      emblemItems(project, projector, assets, textAdvance),
  },
  { id: "paint-top", items: ({ project, projector }) => strokeItems(project, projector, "top") },
];

function makeLayer(plan, frame) {
  const layer = { id: plan.id, kind: "group" };
  if (plan.extra) Object.assign(layer, plan.extra(frame));
  layer.items = plan.items(frame);
  return layer;
}

// Предметы зон и меток из памяти; сжатие, цвета и масштаб окна читаются из контекста здесь.
class Picker {
  constructor(project, context, projector) {
    this.project = project;
    this.context = context;
    this.projector = projector;
    this.shrink = zoomResponse(context.zoom);
    this.tones = context.labelTones || null;
    this.scale = null;
  }

  zones() {
    const { project, projector, shrink, tones, context: { textAdvance } } = this;
    return zoneItemsCached(project, projector, shrink, tones, textAdvance);
  }

  markers() {
    this.scale = windowScaleOf(this.context);
    const { project, projector, shrink, tones, scale, context: { assets, zoom } } = this;
    return markerItemsCached(project, projector, shrink, assets, zoom, tones, scale);
  }

  majestic() {
    return majesticMarkItems(this.project.majestic, this.projector);
  }
}

export function buildMapScene(config, context = {}) {
  const project = normalizeWorldMap(config);
  const state = atlasState(context.atlas);
  const { projector } = state;
  const backdrop = readBackdrop(project, context);
  const picker = new Picker(project, context, projector);
  const zones = picker.zones();
  const markers = picker.markers();
  const majestic = picker.majestic();
  const labels = planLabels(project, projector, { zones, markers, shrink: picker.shrink });
  const frame = { project, context, projector, backdrop, zones, markers, majestic, labels };
  const scene = { ...sizeOf(projector), atlas: state.atlas };
  scene.source = sceneSource(backdrop);
  scene.tiles = trimTiles(backdrop.tiles, GAME_TILE_KEYS);
  scene.landTiles = trimTiles(backdrop.landTiles, LAND_TILE_KEYS);
  scene.droppedLabels = labels.dropped.map(droppedRecord);
  if (picker.scale !== null) scene.windowScale = picker.scale;
  scene.layers = LAYER_PLAN.map((plan) => makeLayer(plan, frame));
  return scene;
}
