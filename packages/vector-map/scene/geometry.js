import { DEFAULT_ATLAS, atlasAspect, normalizeAtlas, worldToMap } from "../projection.js";

export const SCENE_WIDTH = 1000;

const GRAIN = 1000;
const ZOOM_EXPONENT = -0.68;
const ZOOM_FLOOR = 1;
const ZOOM_CEIL = 40;
const OUTLINE_SPAN = 900;
const OUTLINE_FALLBACK = "#04060a";

// Тысячные, половина вверх; у малых отрицательных выходит -0.
export function round(amount) {
  return Math.round(amount * GRAIN) / GRAIN;
}

const bound = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const alpha = (percent) => bound(Number(percent) / 100, 0, 1);

export const zoomResponse = (level) => bound(Number(level) || 1, ZOOM_FLOOR, ZOOM_CEIL) ** ZOOM_EXPONENT;

// Три состояния набора: обводки нет (подпись как есть), «ноль» (убрать), положительная (нарисовать).
const OUTLINE_RULES = {
  absent: (label) => label,
  cleared: (label) => ({ ...label, stroke: null, strokeWidth: 0 }),
  drawn: (label, own) => ({
    ...label,
    stroke: own.outlineColor || OUTLINE_FALLBACK,
    strokeWidth: round(label.size * own.outline / OUTLINE_SPAN),
  }),
};

const outlineState = (own) =>
  own?.outline === null ? "absent" : own?.outline === undefined ? "absent" : own.outline > 0 ? "drawn" : "cleared";

export const withOwnOutline = (label, own) => OUTLINE_RULES[outlineState(own)](label, own);

export function createProjector(atlas = DEFAULT_ATLAS) {
  const sheet = normalizeAtlas(atlas);
  const size = [SCENE_WIDTH, SCENE_WIDTH / atlasAspect(sheet)];
  const perUnit = SCENE_WIDTH / (sheet.columns * sheet.tileUnits);
  const toScene = (world) => {
    const mapped = worldToMap(world, sheet);
    return { x: round(mapped.u * size[0]), y: round(mapped.v * size[1]) };
  };
  const toLength = (units) => round((Number(units) || 0) * perUnit);
  return { width: size[0], height: size[1], atlas: sheet, point: toScene, length: toLength };
}

// Дыры списка пропускаются (reduce), индексы остальных сохраняются: у первой точки «M», у прочих «L».
export function pathFrom(points, close) {
  const body = points.reduce((text, point, at) => `${text}${at ? "L" : "M"}${point.x} ${point.y}`, "");
  return close ? `${body}Z` : body;
}

// Управляющие точки Catmull-Rom по одной оси (числа соседних узлов):
// разность, деление на 6, затем два умножения слева направо.
const lead = (back, here, there, tension) => round(here + ((there - back) / 6) * tension * 2);
const trail = (here, there, front, tension) => round(there - ((front - here) / 6) * tension * 2);

// Окно из четырёх соседних точек (back, here, there, front) едет по контуру;
// узлы в строку идут неокруглёнными.
export function smoothPath(points, close, tension = 0.5) {
  const total = points.length;
  return total < 3 ? pathFrom(points, close) : cubicChain(points, total, close, tension);
}

function cubicChain(points, total, close, tension) {
  const start = points[0];
  const reach = close ? total : total - 1;
  let back = points[close ? total - 1 : 0];
  let here = start;
  let there = points[1];
  let front = points[2];
  let d = `M${start.x} ${start.y}`;
  for (let at = 0; at < reach; at++) {
    d += `C${lead(back.x, here.x, there.x, tension)} ${lead(back.y, here.y, there.y, tension)}`;
    d += ` ${trail(here.x, there.x, front.x, tension)} ${trail(here.y, there.y, front.y, tension)}`;
    d += ` ${there.x} ${there.y}`;
    back = here;
    here = there;
    there = front;
    front = close ? points[(at + 3) % total] : points[Math.min(at + 3, total - 1)];
  }
  return close ? `${d}Z` : d;
}

export function project(projector, points) {
  function place(point) {
    return projector.point(point);
  }
  return points.map(place);
}

// Части фильтра в порядке применения: [поле основы, имя функции CSS].
// Поле читается в проверке и, если оно не 100, ещё раз в делении.
const FILTER_PARTS = [
  ["brightness", "brightness"],
  ["contrast", "contrast"],
  ["saturation", "saturate"],
];

export const baseFilter = (base) =>
  FILTER_PARTS.reduce(
    (parts, [field, fn]) => (base[field] === 100 ? parts : parts.concat(`${fn}(${base[field] / 100})`)),
    [],
  ).join(" ") || "none";
