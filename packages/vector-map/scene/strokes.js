import { curvePath, flattenCurve } from "../stroke-curve.js";
import { alpha, pathFrom, round } from "./geometry.js";

const DASHED_FACTORS = [2.6, 2.4];
const DOT_LENGTH = 0.001;
const DOT_GAP_FACTOR = 2.1;
const BLUR_DIVISOR = 260;
const HEAD_REACH = 1.5;
const HEAD_SCALE = 3.4;
const HEAD_FLOOR = 6;
const HEAD_HALF = 0.62;
const HEAD_INSET = 0.55;
const CURVE_FLATNESS = 0.05;
const END_ONLY = ["end"];
const BOTH_ENDS = ["end", "start"];
const LOOK_KEYS = ["opacity", "blur", "blend"];

// --- малые помощники над точками {x, y} ------------------------------------

const gap = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};
const copyOf = (points) => [...points];
const reversedCopy = (points) => copyOf(points).reverse();
const nudge = (x, y, dx, dy, by) => ({ x: x + dx * by, y: y + dy * by });
const pair = (x, y) => ({ x: round(x), y: round(y) });
const tidy = (point) => pair(point.x, point.y);
const unit = (to, from, length) => [(to.x - from.x) / length, (to.y - from.y) / length];
const sized = (x, y, width, height) => ({ x: round(x), y: round(y), width: round(width), height: round(height) });
const stepX = (a, b, share) => a.x + share * (b.x - a.x);
const stepY = (a, b, share) => a.y + share * (b.y - a.y);
const along = (a, b, share) => pair(stepX(a, b, share), stepY(a, b, share));

// Рамка списка точек. Проверяется только левый край (так было и раньше), а каждое сравнение читает поле заново.
export function boundsOf(points) {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of points) {
    left = point.x < left ? point.x : left;
    top = point.y < top ? point.y : top;
    right = point.x > right ? point.x : right;
    bottom = point.y > bottom ? point.y : bottom;
  }
  if (!Number.isFinite(left)) return null;
  return sized(left, top, right - left, bottom - top);
}

export function strokeDash(line, width) {
  switch (line) {
    case "dashed":
      return DASHED_FACTORS.map((factor) => round(width * factor));
    case "dotted":
      return [DOT_LENGTH, round(width * DOT_GAP_FACTOR)];
    default:
      return null;
  }
}

// Первая точка с конца, отстоящая от острия не меньше чем на полторы толщины.
function lookBack(line, tip, width) {
  let at = line.length - 1;
  while (--at >= 0) {
    if (gap(tip, line[at]) >= width * HEAD_REACH) return line[at];
  }
  return null;
}

// Наконечник на конце ломаной (при atStart — на начале): три вершины и вставка линии.
export function arrowHead(points, atStart, width) {
  const line = atStart ? reversedCopy(points) : points;
  const last = line.length - 1;
  const tip = line[last];
  const origin = lookBack(line, tip, width);
  if (origin === null) return null;

  const [ux, uy] = unit(tip, origin, gap(tip, origin));
  const size = Math.max(width * HEAD_SCALE, HEAD_FLOOR);
  const half = size * HEAD_HALF;
  const base = nudge(tip.x, tip.y, ux, uy, -size);
  const wings = [nudge(base.x, base.y, -uy, ux, half), nudge(base.x, base.y, uy, -ux, half)];
  return { points: [tidy(tip), tidy(wings[0]), tidy(wings[1])], inset: size * HEAD_INSET };
}

// Укорачивает ломаную у конца (при atStart — у начала): целые отрезки уходят, последний подрезается.
export function trimLine(points, atStart, inset) {
  const line = copyOf(points);
  if (atStart) line.reverse();
  let rest = inset;
  for (; line.length > 2; line.pop()) {
    const reach = gap(line[line.length - 1], line[line.length - 2]);
    if (reach > rest) break;
    rest = rest - reach;
  }

  const last = line.length - 1;
  const span = gap(line[last], line[last - 1]) || 1;
  line[last] = along(line[last - 1], line[last], Math.max(0, span - rest) / span);
  if (atStart) line.reverse();
  return line;
}

export function strokeArrowParts(points, width, arrow) {
  // Слово сравнивается строго, без приведения типов: «START» и массив из «end» стрелкой не считаются.
  const ends = arrow === "end" ? END_ONLY : arrow === "both" ? BOTH_ENDS : null;
  if (!ends) return { line: points, heads: [] };
  const heads = ends.map((end) => [end, arrowHead(points, end === "start", width)]);
  const line = heads.reduce((now, [end, head]) => (head ? trimLine(now, end === "start", head.inset) : now), points);
  return { line, heads };
}

// --- предметы штриха -------------------------------------------------------

const linePath = (id, bounds, d, stroke, strokeWidth) => ({
  kind: "path",
  id,
  bounds,
  d,
  fill: null,
  stroke,
  strokeWidth,
  lineCap: "round",
  lineJoin: "round",
});

const headPath = (id, bounds, d, fill) => ({ kind: "path", id, bounds, d, fill, stroke: null, lineJoin: "round" });

// Пунктир (если есть) встаёт перед прозрачностью, размытием и режимом.
function dress(item, look, dash) {
  if (dash) item.dash = dash;
  LOOK_KEYS.forEach((key, k) => {
    item[key] = look[k];
  });
  return item;
}

const blurOf = (stroke, width) => {
  if (!(stroke.softness > 0)) return 0;
  return round(width * stroke.softness / BLUR_DIVISOR);
};

// Прозрачность, размытие, режим наложения — общие у линии и её наконечников.
const lookOf = (stroke, width) => [alpha(stroke.opacity), blurOf(stroke, width), stroke.blend !== "normal" ? stroke.blend : null];

const isDrawn = (stroke, target) => stroke.enabled && stroke.target === target && !(stroke.points.length < 2);

// Точки мазка в единицах сцены и толщина: все точки проецируются раньше толщины.
const projectWith = (projector) => (point) => projector.point(point);
const traceOf = (stroke, projector) => [stroke.points.map(projectWith(projector)), projector.length(stroke.size)];

function traceD(line, curved) {
  if (curved) return curvePath(line);
  return pathFrom(line, false);
}

function drawn(stroke, projected, width) {
  const arrowed = stroke.arrow === "end" ? true : stroke.arrow === "both";
  const [asCurve, path] = [stroke.curve && !arrowed, stroke.curve && arrowed ? flattenCurve(projected, CURVE_FLATNESS) : projected];
  const look = lookOf(stroke, width);
  const [{ line, heads }, dash] = [strokeArrowParts(path, width, stroke.arrow), strokeDash(stroke.line, width)];

  const main = dress(linePath(`stroke-${stroke.id}`, boundsOf(line), traceD(line, asCurve), stroke.color, width), look, dash);
  const tips = heads
    .filter(([, head]) => head)
    .map(([end, head]) =>
      dress(headPath(`stroke-${stroke.id}-head-${end}`, boundsOf(head.points), pathFrom(head.points, true), stroke.color), look, null),
    );
  return [main, ...tips];
}

function strokePieces(stroke, projector) {
  const [projected, width] = traceOf(stroke, projector);
  return width <= 0 ? [] : drawn(stroke, projected, width);
}

function* eachPiece(config, projector, target) {
  for (const stroke of config.paint.items) {
    if (isDrawn(stroke, target)) yield* strokePieces(stroke, projector);
  }
}

export function strokeItems(config, projector, target) {
  return config.paint.enabled ? [...eachPiece(config, projector, target)] : [];
}
