import {
  minimapWidgetHalfExtent,
  minimapIconRect,
  clampMinimapWidgetCenter,
} from "../minimap-layout.js";

// Магнит к центру в редакторе мини-карты: центр элемента тянется к центру соседней
// полосы и к центру карты. Порог считается в точках экрана, не в долях радара.

export const MINIMAP_SNAP_THRESHOLD = 6;

// К каким полосам тянется элемент; порядок списка — старшинство.
// Обычный объект с прототипом: «constructor» и «toString» дают TypeError при обходе.
const PEER_BARS = Object.fromEntries([
  ["healthNumber", ["healthBar"]],
  ["armorNumber", ["armorBar"]],
  ["healthIcon", ["healthBar", "armorBar"]],
  ["armorIcon", ["armorBar", "healthBar"]],
  ["healthBar", ["armorBar"]],
  ["armorBar", ["healthBar"]],
]);

// Ось и поперечная ей: вертикальная линия x тянется по y и наоборот.
const AXES = [
  { name: "x", cross: "y" },
  { name: "y", cross: "x" },
];

// Как считать половину коробки по концу идентификатора.
const BOX_RULES = [
  ["Bar", (widget, scale) => minimapWidgetHalfExtent(widget, scale)],
  ["Icon", (widget) => {
    const { width, height } = minimapIconRect(widget);
    return { x: width / 2, y: height / 2 };
  }],
];

const LINE_TOLERANCE = 1e-6;
const BASE_THICKNESS = 8;
const GUIDE_NUMBERS = ["at", "from", "to"];

const closeEnough = (a, b) => LINE_TOLERANCE >= Math.abs(a - b);

// Толщина полосы относительно 8; ложное или нечисловое значение — как 8.
const thicknessScale = (config) =>
  (Number(config?.effects?.barThickness) || BASE_THICKNESS) / BASE_THICKNESS;

const centreLines = () => AXES.map(({ name }) => ({ axis: name, at: 0.5, from: 0, to: 1 }));

// Линия через центр полосы по каждой оси, вдоль всей её коробки.
function barLines(bar, scale) {
  const half = minimapWidgetHalfExtent(bar, scale);
  return AXES.map(({ name, cross }) => ({
    axis: name,
    at: bar[name],
    from: bar[cross] - half[cross],
    to: bar[cross] + half[cross],
  }));
}

export function minimapSnapTargets(config, id) {
  const widgets = config?.layout?.widgets;
  const scale = thicknessScale(config);
  const fromBars = (PEER_BARS[id] ?? []).flatMap((name) => {
    const bar = widgets?.[name];
    return bar?.visible ? barLines(bar, scale) : [];
  });
  return [...fromBars, ...centreLines()];
}

// Цель оси, ближайшая к координате в пределах порога: при равенстве — первая в списке.
function pullOnAxis(targets, axis, coordinate, radar, threshold) {
  if (!(radar > 0) || !Number.isFinite(coordinate)) return null;
  const reachable = [...targets]
    .filter((target) => target.axis === axis)
    .map((target) => ({ target, gap: Math.abs(coordinate - target.at) * radar }))
    .filter(({ gap }) => gap <= threshold);
  const best = reachable.reduce((top, one) => (one.gap < top.gap ? one : top), reachable[0]);
  return best === undefined ? null : best.target;
}

// Половина коробки элемента в долях радара.
function halfBoxOf(id, widget, scale) {
  const rule = BOX_RULES.find(([suffix]) => id.endsWith(suffix));
  if (rule !== undefined) return rule[1](widget, scale);
  const halfOf = (size) => (Number(size) || 0) / 2;
  return { x: halfOf(widget?.width), y: halfOf(widget?.height) };
}

// Линия рисуется, только если центр после зажима действительно лёг на цель;
// её протяжённость растёт до всех целей той же оси на той же высоте.
function guideFor({ name, cross }, pull, centre, half, targets) {
  if (pull === null || !closeEnough(centre[name], pull.at)) return null;
  const sameLine = [...targets].filter(
    (target) => target.axis === name && closeEnough(target.at, pull.at),
  );
  return {
    axis: name,
    at: pull.at,
    from: Math.min(centre[cross] - half[cross], ...sameLine.map((line) => line.from)),
    to: Math.max(centre[cross] + half[cross], ...sameLine.map((line) => line.to)),
  };
}

export function minimapSnapPlace(request) {
  const { config, id, point, pixels } = request;
  const threshold = request.threshold === undefined ? MINIMAP_SNAP_THRESHOLD : request.threshold;
  const targets = request.targets === undefined ? minimapSnapTargets(config, id) : request.targets;
  const widget = config.layout.widgets[id];
  const scale = id.endsWith("Bar") ? thicknessScale(config) : 1;

  const pulls = AXES.map(({ name }) => {
    const radar = Number(pixels?.[name === "x" ? "width" : "height"]) || 0;
    return request.free ? null : pullOnAxis(targets, name, point[name], radar, threshold);
  });
  const wanted = (pull, given) => (pull === null ? given : pull.at);
  const centre = clampMinimapWidgetCenter(
    widget,
    wanted(pulls[0], point.x),
    wanted(pulls[1], point.y),
    scale,
  );

  if (pulls.every((pull) => pull === null)) return { x: centre.x, y: centre.y, guides: [] };
  const half = halfBoxOf(id, widget, scale);
  const guides = AXES.map((axis, at) => guideFor(axis, pulls[at], centre, half, targets));
  return { x: centre.x, y: centre.y, guides: guides.filter((guide) => guide !== null) };
}

const sameGuide = (a, b) =>
  a.axis === b.axis && GUIDE_NUMBERS.every((field) => closeEnough(a[field], b[field]));

export function sameMinimapGuides(left, right) {
  return (
    left === right ||
    (left.length === right.length && left.every((guide, at) => sameGuide(guide, right[at])))
  );
}
