/*
 * Контуры глифа: точки TrueType (`{ x, y, on }`, кривые второго порядка с
 * неявными точками между двумя опорами) → сегменты, утолщение и перевод в
 * систему шрифтов Scaleform (кегль 256, базовая линия 0, ось Y вниз).
 *
 * Сегмент — `{ x, y }` (прямая) или `{ cx, cy, x, y }` (кривая с опорой);
 * у контура — точка начала и сегменты до неё же.
 */

/** Точки TrueType одного контура → `{ start, segments }` (`null` — пустой контур). */
export function contourSegments(points) {
  const count = points.length;
  if (count < 2) return null;
  /* Начало — точка на кривой; если таких нет — середина двух первых опор. */
  let first = points.findIndex((point) => point.on);
  let start;
  if (first < 0) {
    start = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    first = 0;
  } else start = { x: points[first].x, y: points[first].y };
  const segments = [];
  let control = null;
  const ordered = [];
  for (let index = 1; index <= count; index += 1) ordered.push(points[(first + index) % count]);
  if (!points[first].on) ordered.unshift(points[first]);
  for (const point of ordered) {
    if (point.on) {
      segments.push(control ? { cx: control.x, cy: control.y, x: point.x, y: point.y } : { x: point.x, y: point.y });
      control = null;
    } else if (control) {
      const mid = { x: (control.x + point.x) / 2, y: (control.y + point.y) / 2 };
      segments.push({ cx: control.x, cy: control.y, x: mid.x, y: mid.y });
      control = point;
    } else control = point;
  }
  if (control) segments.push({ cx: control.x, cy: control.y, x: start.x, y: start.y });
  const last = segments[segments.length - 1];
  if (last && (Math.abs(last.x - start.x) > 1e-6 || Math.abs(last.y - start.y) > 1e-6)) segments.push({ x: start.x, y: start.y });
  return segments.length ? { start, segments } : null;
}

/* Узлы контура подряд (опоры кривых тоже): по ним считаются нормали. */
function nodesOf(contour) {
  const nodes = [{ x: contour.start.x, y: contour.start.y }];
  for (const segment of contour.segments) {
    if ("cx" in segment) nodes.push({ x: segment.cx, y: segment.cy, control: true });
    nodes.push({ x: segment.x, y: segment.y });
  }
  nodes.pop(); /* последний = первый */
  return nodes;
}

function area(nodes) {
  let sum = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const a = nodes[index];
    const b = nodes[(index + 1) % nodes.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function inside(point, nodes) {
  let hit = false;
  for (let index = 0, prev = nodes.length - 1; index < nodes.length; prev = index, index += 1) {
    const a = nodes[index];
    const b = nodes[prev];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Утолщение (`amount` > 0) или утоньшение (< 0) контуров на `amount`
 * единиц: каждый узел сдвигается по средней нормали двух соседних рёбер —
 * у внешнего контура наружу, у дыры (буква «О») — внутрь неё. Внешний он
 * или дыра — по вложенности в другие контуры глифа.
 */
export function emboldenContours(contours, amount) {
  if (!amount) return contours;
  const all = contours.map(nodesOf);
  return contours.map((contour, index) => {
    const nodes = all[index];
    if (nodes.length < 3) return contour;
    const depth = all.reduce((sum, other, k) => (k !== index && other.length > 2 && inside(nodes.find((node) => !node.control) || nodes[0], other) ? sum + 1 : sum), 0);
    const hole = depth % 2 === 1;
    const ccw = area(nodes) > 0;
    /* Сдвиг влево по ходу контура: внутрь при обходе против часовой. */
    const towardsInterior = hole;
    const left = towardsInterior === ccw;
    const moved = nodes.map((node, k) => {
      const prev = nodes[(k - 1 + nodes.length) % nodes.length];
      const next = nodes[(k + 1) % nodes.length];
      const normal = (a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        return left ? { x: -dy / length, y: dx / length } : { x: dy / length, y: -dx / length };
      };
      const n1 = normal(prev, node);
      const n2 = normal(node, next);
      let mx = n1.x + n2.x;
      let my = n1.y + n2.y;
      const length = Math.hypot(mx, my);
      if (length < 1e-6) {
        mx = n2.x;
        my = n2.y;
      } else {
        /* Острый угол — не дальше полутора сдвигов (обрезка «усов»). */
        const cos = Math.max(0.35, length / 2);
        mx = (mx / length) * Math.min(1.5, 1 / cos);
        my = (my / length) * Math.min(1.5, 1 / cos);
      }
      return { x: node.x + mx * amount, y: node.y + my * amount, control: node.control };
    });
    let at = 0;
    const start = moved[at++];
    const segments = contour.segments.map((segment) => {
      if ("cx" in segment) {
        const control = moved[at++];
        const end = moved[at++ % moved.length];
        return { cx: control.x, cy: control.y, x: end.x, y: end.y };
      }
      const end = moved[at++ % moved.length];
      return { x: end.x, y: end.y };
    });
    return { start: { x: start.x, y: start.y }, segments };
  });
}

/**
 * Перевод контуров: точка `(x, y)` шрифта → `(x·scaleX + y·scale·skew + dx,
 * −y·scale + dy)`. `scaleX` — ширина букв (по умолчанию как высота),
 * `skew` — наклон: тангенс угла, верх буквы уходит вправо.
 */
export function placeContours(contours, { scale = 1, scaleX = scale, skew = 0, dx = 0, dy = 0 } = {}) {
  const lean = scale * skew;
  const px = (x, y) => x * scaleX + y * lean + dx;
  const py = (y) => -y * scale + dy;
  return contours.map((contour) => ({
    start: { x: px(contour.start.x, contour.start.y), y: py(contour.start.y) },
    segments: contour.segments.map((segment) =>
      "cx" in segment
        ? { cx: px(segment.cx, segment.cy), cy: py(segment.cy), x: px(segment.x, segment.y), y: py(segment.y) }
        : { x: px(segment.x, segment.y), y: py(segment.y) },
    ),
  }));
}

/** Рамка контуров `[x0, y0, x1, y1]` или `null`. */
export function contoursBounds(contours) {
  let box = null;
  const add = (x, y) => {
    if (!box) box = [x, y, x, y];
    else {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  };
  for (const contour of contours) {
    add(contour.start.x, contour.start.y);
    for (const segment of contour.segments) {
      if ("cx" in segment) add(segment.cx, segment.cy);
      add(segment.x, segment.y);
    }
  }
  return box;
}
