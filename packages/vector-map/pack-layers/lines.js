// Зоны и линии редактора из кусков геометрии пака: заливки, кольца-обводки,
// ломаные (сплошные и пунктирные), стопки рамок и сшивка уголков рамок.
import { boundaryLoops, isDot, ringArea, unionFind } from "./parts.js";
import { GLYPH_MAX } from "./text.js";

const AXES = [0, 1];
const TRI_CORNERS = [0, 2, 4];
const BOX_SIDES = ["x0", "y0", "x1", "y1"];
const MIDDLE_SIDES = [
  ["x0", "x1"],
  ["y0", "y1"],
];
const FILL_ZONE = { alpha: 0.99, long: 20, fill: 0.25 };
const RING_ZONE = { long: 40, fill: 0.35, innerArea: 0.4, innerPerimeter: 0.7, frameFill: 0.08, frameArea: 3 };
const CORNER = { reach: 3, longShare: 0.3, maxFill: 0.45, maxText: 2 };

// ---------- точки, векторы и мелочи ----------

const delta = (p, q, axis) => p[axis] - q[axis];
const sub = (a, b) => AXES.map((axis) => delta(a, b, axis));
const norm = (v) => Math.hypot(v[0], v[1]);
const dist = (a, b) => norm(sub(b, a));
const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
const cross = (u, v) => u[0] * v[1] - u[1] * v[0];

// Единичный вектор; нулевой остаётся нулевым.
const unit = (v) => {
  const len = norm(v) || 1;
  return v.map((c) => c / len);
};

// Верхняя медиана: элемент с номером «целая часть от половины длины».
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return values.length ? sorted[Math.floor(values.length / 2)] : 0;
};

// Целые числа от lo до hi включительно, лениво.
function* between(lo, hi) {
  for (let n = lo; n <= hi; n++) yield n;
}

const cellName = (gx, gy) => `${gx},${gy}`;
const colorName = (group) => `${group.color}|${group.alpha}`;

// Имена клеток 3×3 вокруг (gx, gy): внешний цикл по x, внутренний по y.
function* around(gx, gy) {
  for (const ix of between(gx - 1, gx + 1)) {
    for (const iy of between(gy - 1, gy + 1)) yield cellName(ix, iy);
  }
}

const addTo = (buckets, key, item) => {
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(item);
};

const appendAll = (target, items) => {
  for (const item of items) target.push(item);
};

// Периметр замкнутого контура: звенья суммируются по порядку.
const perimeter = (ring) => ring.reduce((sum, p, i) => sum + dist(p, ring[(i + 1) % ring.length]), 0);

const boxOf = (points) => {
  const [[x0, x1], [y0, y1]] = AXES.map((axis) => {
    const values = points.map((p) => p[axis]);
    return [values.reduce((lo, v) => Math.min(lo, v), Infinity), values.reduce((hi, v) => Math.max(hi, v), -Infinity)];
  });
  return { x0, y0, x1, y1 };
};

const boxArea = (box) => (box.x1 - box.x0) * (box.y1 - box.y0);

// Наибольший сдвиг одной из четырёх границ рамки.
const boxShift = (a, b) => Math.max(...BOX_SIDES.map((side) => Math.abs(a[side] - b[side])));

const isShort = (part) => part.tris.length <= 8;
const isThin = (part) => (part.short > 0 ? part.long >= 2.5 * part.short : part.long > 2);

// ---------- упрощение ломаной ----------

// Самая далёкая от хорды from→to точка между концами: { index, dist }.
function farthest(points, from, to) {
  const [[ax, ay], [bx, by]] = [points[from], points[to]];
  const [dx, dy] = [bx - ax, by - ay];
  const span = Math.hypot(dx, dy);
  const offset =
    span > 1e-9
      ? ([px, py]) => Math.abs(dy * px - dx * py + bx * ay - by * ax) / span
      : ([px, py]) => Math.hypot(px - ax, py - ay);
  const inner = Array.from({ length: to - from - 1 }, (_, k) => points[from + 1 + k]);
  return inner.reduce(
    (best, point, k) => {
      const d = offset(point);
      return d > best.dist ? { index: from + 1 + k, dist: d } : best;
    },
    { index: -1, dist: -1 },
  );
}

// Дуглас — Пекер: отрезки ждут в стеке, помеченные точки остаются.
function thinOut(points, tolerance) {
  const keep = new Uint8Array(points.length);
  const last = points.length - 1;
  keep[0] = keep[last] = 1;
  for (const pending = [[0, last]]; pending.length; ) {
    const [from, to] = pending.pop();
    const far = farthest(points, from, to);
    if (far.dist > tolerance) {
      keep[far.index] = 1;
      pending.push([from, far.index], [far.index, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function simplify(points, tolerance) {
  return points.length <= 2 ? points.slice() : thinOut(points, tolerance);
}

// Вершина, сдвинутая вдоль биссектрисы `dir`, но не дальше 3 · distance.
const shiftAlong = (p, dir, normal, distance) => {
  const shift = Math.min(distance / Math.max(dot(dir, normal), 1e-6), 3 * distance);
  return AXES.map((axis) => p[axis] + dir[axis] * shift);
};

// Сдвиг контура внутрь на distance вдоль биссектрис (не дальше 3 · distance).
function inset(points, distance) {
  const n = points.length;
  if (n < 3 || distance <= 0) return points;
  const winding = points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % n];
    return sum + (x * ny - nx * y);
  }, 0);
  const side = winding > 0 ? 1 : -1;
  const normalOf = (from, to) => {
    const [ux, uy] = unit(sub(to, from));
    return [-uy * side, ux * side];
  };
  return points.map((p, i) => {
    const [n1, n2] = [normalOf(points[(i + n - 1) % n], p), normalOf(p, points[(i + 1) % n])];
    const bisector = AXES.map((axis) => n1[axis] + n2[axis]);
    const blen = norm(bisector);
    return blen < 1e-6 ? p : shiftAlong(p, bisector.map((c) => c / blen), n1, distance);
  });
}

// ---------- зоны из одного куска ----------

const zoneOf = (points, parts, { open = false, line = "solid", fill = false, width }) => ({
  points,
  open,
  line,
  fill,
  color: parts[0].group.color,
  alpha: parts[0].group.alpha,
  width,
  parts,
});

const closedRing = (ring) => [...ring, ring[0]];

const withArea = (ring) => ({ ring, area: Math.abs(ringArea(ring)) });
const largerFirst = (a, b) => b.area - a.area;

// Контуры куска от большего по модулю площади к меньшему.
const rankedLoops = (part) => boundaryLoops(part.group.positions, part.tris).map(withArea).sort(largerFirst);

// Полупрозрачная заливка (зона мероприятий).
function fillZone(part) {
  const wanted = part.group.alpha < FILL_ZONE.alpha && part.long >= FILL_ZONE.long && part.fill >= FILL_ZONE.fill;
  const [biggest] = wanted ? rankedLoops(part) : [];
  if (!biggest) return undefined;
  return zoneOf(simplify(closedRing(biggest.ring), 1).slice(0, -1), [part], { fill: true, width: 0 });
}

// Кольцо-обводка одним куском: полое или тонкая рамка.
function ringZone(part) {
  const [outer, inner] = part.long >= RING_ZONE.long && part.fill < RING_ZONE.fill ? rankedLoops(part) : [];
  if (!outer) return undefined;
  const second = inner !== undefined && inner.area >= RING_ZONE.innerArea * outer.area;
  const hollow = second && perimeter(inner.ring) >= RING_ZONE.innerPerimeter * perimeter(outer.ring);
  const frame = !second && part.fill < RING_ZONE.frameFill && outer.area >= RING_ZONE.frameArea * part.area;
  if (!hollow && !frame) return undefined;
  const width = part.area / Math.max(perimeter(outer.ring), 1);
  const rough = simplify(closedRing(outer.ring), Math.max(1, width * 0.5)).slice(0, -1);
  return zoneOf(inset(rough, width / 2), [part], { width });
}

// ---------- штрихи: классы толщины, копии ----------

// Толщина штриха для разбиения на классы.
function strokeWidth(part) {
  if (isShort(part)) return part.short;
  const P = part.group.positions;
  const heights = part.tris.flatMap((tri) => {
    const [a, b, c] = TRI_CORNERS.map((k) => [P[tri * 6 + k], P[tri * 6 + k + 1]]);
    const area = Math.abs(cross(sub(b, a), sub(c, a))) / 2;
    const longest = Math.max(...[[a, b], [b, c], [c, a]].map(([p, q]) => dist(p, q)));
    return area > 0 && longest > 0 ? [(2 * area) / longest] : [];
  });
  return median(heights) || part.short;
}

// Тонкая обводка не склеивается с толстой границей того же цвета.
function thicknessClasses(parts) {
  const ranked = parts.map((part) => [strokeWidth(part), part]).sort((a, b) => a[0] - b[0]);
  const classes = [];
  let limit = NaN; // верхняя граница текущего класса: втрое от толщины его первого штриха
  for (const [width, part] of ranked) {
    if (width <= limit) {
      classes.at(-1).push(part);
    } else {
      classes.push([part]);
      limit = 3 * Math.max(width, 0.05);
    }
  }
  return classes;
}

// Копия оставленного штриха: все четыре границы рамки в пределах допуска.
const isCopyOf = (part, other) => BOX_SIDES.every((side) => Math.abs(part[side] - other[side]) <= Math.max(0.75, other.short));

function findTwin(cells, part, gx, gy) {
  for (const name of around(gx, gy)) {
    const twin = (cells.get(name) ?? []).find((other) => isCopyOf(part, other));
    if (twin) return twin;
  }
  return null;
}

// Копии (рисунок повторён на соседних высотах) отделяются от «оставленных».
function splitCopies(parts) {
  const cells = new Map();
  const copies = new Map();
  const kept = [];
  [...parts]
    .sort((a, b) => b.area - a.area)
    .forEach((part) => {
      const [gx, gy] = MIDDLE_SIDES.map(([lo, hi]) => Math.floor((part[lo] + part[hi]) / 2 / 32));
      const twin = findTwin(cells, part, gx, gy);
      if (twin) {
        copies.get(twin).push(part);
        return;
      }
      kept.push(part);
      copies.set(part, []);
      addTo(cells, cellName(gx, gy), part);
    });
  return { kept, copies };
}

// ---------- сшивка штрихов ----------

// Опорные точки вдоль короткого штриха.
function alongStroke(part, step) {
  const half = Math.max(0, (part.long - part.short) / 2);
  const count = Math.max(2, Math.ceil((2 * half) / step));
  const heading = [Math.cos(part.angle), Math.sin(part.angle)];
  return Array.from({ length: count + 1 }, (_, at) => {
    const t = (2 * at) / count - 1;
    return [part.rx, part.ry].map((c, axis) => c + heading[axis] * half * t);
  });
}

// Опорные точки длинного куска: центры треугольников, по одному на ячейку.
function acrossStroke(part, thickness) {
  const cell = Math.max(1, thickness);
  const P = part.group.positions;
  const seen = new Set();
  return part.tris.flatMap((tri) => {
    const center = AXES.map((axis) => (P[tri * 6 + axis] + P[tri * 6 + 2 + axis] + P[tri * 6 + 4 + axis]) / 3);
    const name = cellName(...center.map((v) => Math.round(v / cell)));
    if (seen.has(name)) return [];
    seen.add(name);
    return [center];
  });
}

// Пары опорных точек не дальше reach друг от друга: [i, j, длина], j > i.
function* nearbyPairs(nodes, reach) {
  const buckets = new Map();
  const cellOf = ({ point }) => point.map((v) => Math.floor(v / reach));
  nodes.forEach((node, i) => addTo(buckets, cellName(...cellOf(node)), i));
  for (const [i, node] of nodes.entries()) {
    for (const name of around(...cellOf(node))) {
      for (const j of buckets.get(name) ?? []) {
        const length = j > i ? dist(node.point, nodes[j].point) : Infinity;
        if (length <= reach) yield [i, j, length];
      }
    }
  }
}

// Дерево кратчайших связей (Краскал): смежность и связные множества узлов.
function spanningForest(count, edges) {
  const sets = unionFind(count);
  const near = Array.from({ length: count }, () => []);
  edges.forEach(([a, b]) => {
    if (sets.find(a) === sets.find(b)) return;
    sets.join(a, b);
    near[a].push(b);
    near[b].push(a);
  });
  return { near, groups: sets.groups() };
}

// Соседи узла внутри множества, ещё не отмеченные в `seen`.
const freshNeighbours = (near, at, inside, seen) => near[at].filter((next) => inside.has(next) && !seen.has(next));

// Обход в глубину внутри `inside`: узлы по мере обнаружения с расстоянием вдоль рёбер.
function* discover(root, inside, near, nodes) {
  const found = new Set([root]);
  const stack = [[root, 0]];
  yield { node: root, dist: 0, via: -1 };
  while (stack.length) {
    const [at, base] = stack.pop();
    for (const next of freshNeighbours(near, at, inside, found)) {
      found.add(next);
      const away = base + dist(nodes[at].point, nodes[next].point);
      stack.push([next, away]);
      yield { node: next, dist: away, via: at };
    }
  }
}

const furthest = (found) => found.reduce((far, cur) => (far.dist < cur.dist ? cur : far));

// От конца обхода назад к началу по ссылкам `via`.
function* climb(via, node) {
  for (let at = node; at !== -1; at = via.get(at)) yield at;
}

// Узлы одной связной ветки в порядке снятия со стека.
function* popOrder(seed, inside, near, seen) {
  for (const stack = [seed]; stack.length; ) {
    const at = stack.pop();
    yield at;
    for (const next of freshNeighbours(near, at, inside, seen)) {
      seen.add(next);
      stack.push(next);
    }
  }
}

// Связные ветки множества узлов, в порядке первых узлов.
function branchesOf(inside, near) {
  const seen = new Set();
  return [...inside].flatMap((seed) => {
    if (seen.has(seed)) return [];
    seen.add(seed);
    return [new Set(popOrder(seed, inside, near, seen))];
  });
}

// Стволы линий: самый длинный путь множества, затем пути его веток (последняя ветка — первой).
function* trunksOf(inside, nodes, near, minLength) {
  if (inside.size < 2) return;
  const [seed] = inside;
  const start = furthest([...discover(seed, inside, near, nodes)]).node;
  const found = [...discover(start, inside, near, nodes)];
  const end = furthest(found);
  if (end.dist < minLength) return;
  const trunk = [...climb(new Map(found.map((d) => [d.node, d.via])), end.node)];
  yield trunk;
  trunk.forEach((n) => inside.delete(n));
  for (const branch of branchesOf(inside, near).reverse()) yield* trunksOf(branch, nodes, near, minLength);
}

// Линия, найденная при сшивке штрихов.
class StitchedLine {
  constructor(route, { members, covered, thickness, reach }) {
    const gapEnds = dist(route[0], route.at(-1));
    const closed = route.length > 6 && gapEnds <= reach * 1.2;
    const simple = simplify(route, Math.max(1.5, thickness * 0.75));
    const length = route.slice(1).reduce((sum, p, i) => sum + dist(route[i], p), closed ? gapEnds : 0);
    this.points = closed && simple.length > 3 ? simple.slice(0, -1) : simple;
    this.closed = closed && simple.length >= 3;
    this.dashed = members.length >= 3 && covered < 0.75 * length;
    this.width = thickness;
    this.members = members;
  }
}

const bodyWidth = (part) => (isShort(part) ? part.short : part.area / Math.max(part.long, 1));
const coverage = (part, thickness) => (isShort(part) ? part.long : part.area / Math.max(thickness, 0.1));

// Сшивка оставленных штрихов в линии.
function stitch(parts) {
  const thickness = Math.max(0.5, median(parts.map(bodyWidth)));
  const reach = Math.max(8, 4 * thickness, 1.6 * Math.min(median(parts.map((p) => p.long)), 60));
  const step = Math.max(reach / 2, 1);
  const nodes = parts.flatMap((part, owner) =>
    (isShort(part) ? alongStroke(part, step) : acrossStroke(part, thickness)).map((point) => ({ point, owner })),
  );
  const edges = [...nearbyPairs(nodes, reach)].sort((a, b) => a[2] - b[2]);
  const { near, groups } = spanningForest(nodes.length, edges);
  const minLength = Math.max(3 * thickness, 12);
  return groups.flatMap((group) => {
    const members = [...new Set(group.map((n) => nodes[n].owner))];
    const covered = members.reduce((sum, m) => sum + coverage(parts[m], thickness), 0);
    const trunks = [...trunksOf(new Set(group), nodes, near, minLength)];
    return trunks.map((trunk) => new StitchedLine(trunk.map((n) => nodes[n].point), { members, covered, thickness, reach }));
  });
}

// Один класс толщины одного цвета: линии в zones, не вошедшее — в rest.
function strokesToZones(parts, zones, rest) {
  const { kept, copies } = splitCopies(parts);
  const withCopies = (part) => [part, ...copies.get(part)];
  const lines = stitch(kept);
  const used = new Set(lines.flatMap((line) => line.members));
  kept.filter((_, i) => !used.has(i)).forEach((part) => appendAll(rest, withCopies(part)));
  lines.forEach((line) => {
    const lineParts = line.members.flatMap((m) => withCopies(kept[m]));
    const length = line.points.reduce((sum, p, i) => sum + (i ? dist(line.points[i - 1], p) : 0), 0);
    const crumb = !line.closed && length < Math.max(8, 3 * line.width);
    if (crumb) {
      appendAll(rest, lineParts);
    } else {
      const kind = line.dashed ? "dashed" : "solid";
      zones.push(zoneOf(line.points, lineParts, { open: !line.closed, line: kind, width: line.width }));
    }
  });
}

// ---------- стопки одинаковых рамок ----------

// Стопка замкнутых зон одного цвета с почти одинаковой рамкой.
class FrameStack {
  constructor(zone, box) {
    this.zone = { ...zone, parts: [...zone.parts] };
    this.outer = box;
    this.inner = box;
    this.widest = zone.width;
  }

  fits(zone, box) {
    const { color, fill, width } = this.zone;
    const room = Math.max(2, 3 * Math.max(zone.width, width));
    return color === zone.color && fill === zone.fill && boxShift(box, this.outer) <= room;
  }

  absorb(zone, box) {
    appendAll(this.zone.parts, zone.parts);
    if (boxArea(box) > boxArea(this.outer)) {
      this.zone.points = zone.points;
      this.outer = box;
    }
    if (boxArea(box) < boxArea(this.inner)) this.inner = box;
    this.widest = Math.max(this.widest, zone.width);
    const merged = 1 - (1 - this.zone.alpha) * (1 - zone.alpha);
    if (zone.fill) {
      this.zone.alpha = merged;
      return;
    }
    const { outer, inner } = this;
    const spread = Math.max(inner.x0 - outer.x0, inner.y0 - outer.y0, outer.x1 - inner.x1, outer.y1 - inner.y1);
    this.zone.width = Math.max(this.widest, spread);
    this.zone.alpha = Math.min(1, merged);
  }
}

// Открытые зоны идут как есть; замкнутые склеиваются в стопки на месте первой.
function stackFrames(zones) {
  const stacks = [];
  return zones
    .map((zone) => {
      if (zone.open) return zone;
      const box = boxOf(zone.points);
      const at = stacks.findIndex((s) => s.fits(zone, box));
      if (at < 0) {
        stacks.push(new FrameStack(zone, box));
        return stacks.at(-1).zone;
      }
      stacks[at].absorb(zone, box);
      return null;
    })
    .filter(Boolean);
}

// ---------- извлечение зон и линий ----------

const SINGLE_ZONES = [fillZone, ringZone];

// Куда отправить кусок: остаток, готовая зона или кандидат в штрихи.
function sieve(part) {
  if (isDot(part)) return ["rest", part];
  const zone = SINGLE_ZONES.reduce((found, make) => found ?? make(part), undefined);
  if (zone) return ["zone", zone];
  return part.long > GLYPH_MAX || isThin(part) ? ["stroke", part] : ["rest", part];
}

const SHELVES = {
  rest: (bins, part) => bins.rest.push(part),
  zone: (bins, zone) => bins.zones.push(zone),
  stroke: (bins, part) => addTo(bins.strokes, colorName(part.group), part),
};

export function extractLines(parts) {
  const bins = { rest: [], zones: [], strokes: new Map() };
  for (const part of parts) {
    const [kind, item] = sieve(part);
    SHELVES[kind](bins, item);
  }
  for (const list of bins.strokes.values()) {
    thicknessClasses(list).forEach((sameWidth) => strokesToZones(sameWidth, bins.zones, bins.rest));
  }
  return { zones: stackFrames(bins.zones), rest: bins.rest };
}

// ---------- уголки пунктирных рамок ----------

const isDashedOpen = (zone) => zone.open && zone.line === "dashed";
const endKey = (zoneAt, end) => `${zoneAt}:${end}`;

// Куски — копии одного уголка: цвет, центр и длина близки к первому.
const copiesOfCorner = (first, part) =>
  colorName(part.group) === colorName(first.group) &&
  dist([first.cx, first.cy], [part.cx, part.cy]) <= CORNER.reach &&
  Math.abs(part.long - first.long) <= CORNER.longShare * first.long;

const shortText = (label) => String(label.text).replace(/\s/g, "").length <= CORNER.maxText;
const candidateOf = (label, parts) => ({ label, parts });
const biggestPart = (parts) => parts.reduce((best, p) => (best.area < p.area ? p : best));

// Потерянные куски остатка: по кандидату на каждую группу копий одного уголка.
function looseCandidates(rest, colors) {
  const loose = rest.filter((part) => colors.has(colorName(part.group)) && part.fill < CORNER.maxFill && part.long <= 40);
  const taken = new Set();
  return loose.flatMap((part) => {
    if (taken.has(part)) return [];
    const copies = loose.filter((other) => !taken.has(other) && copiesOfCorner(part, other));
    copies.forEach((other) => taken.add(other));
    return [candidateOf(null, copies)];
  });
}

// Кандидаты в уголки: подписи-уголки («Г», «L», «7», «J»), затем потерянные куски.
function cornerCandidates(labels, rest, colors) {
  const cornerLabels = labels.filter((label) => shortText(label) && label.parts.every((p) => copiesOfCorner(label.parts[0], p)));
  return [...cornerLabels.map((label) => candidateOf(label, label.parts)), ...looseCandidates(rest, colors)];
}

// Концы пунктирных зон, подходящие уголку: { zoneAt, end, away }.
function endsNear(part, dashed) {
  if (part.fill >= CORNER.maxFill) return [];
  const center = [part.cx, part.cy];
  const thick = part.area / Math.max(part.long + part.short, 1);
  return dashed.flatMap((zone, zoneAt) => {
    const sameColor = zone.color === part.group.color && zone.alpha === part.group.alpha;
    const tooThick = thick > 2.5 * Math.max(zone.width, 0.5);
    const tooThin = thick < 0.3 * zone.width;
    if (!sameColor || tooThick || tooThin) return [];
    const limit = Math.max(8, 2 * median(zone.parts.map((p) => p.long)));
    return [0, 1]
      .map((end) => ({ zoneAt, end, away: dist(zone.points[end ? zone.points.length - 1 : 0], center) }))
      .filter((fit) => fit.away <= limit);
  });
}

// Второй конец для уголка: первый конец другой зоны, иначе другой конец той же зоны,
// если он тоже подходит и в зоне не меньше трёх точек.
function partnerOf(first, fits, dashed) {
  const sameZone = fits.find((fit) => fit.zoneAt === first.zoneAt && fit.end !== first.end);
  const roomy = dashed[first.zoneAt].points.length >= 3;
  return fits.find((fit) => fit.zoneAt !== first.zoneAt) ?? (roomy ? sameZone : undefined) ?? null;
}

// Пробует прикрепить уголок к концам зон; true — принят.
function attach(candidate, dashed, { links, tails }) {
  const part = biggestPart(candidate.parts);
  const fits = endsNear(part, dashed).sort((a, b) => a.away - b.away);
  if (!fits.length) return false;
  const first = fits[0];
  const second = partnerOf(first, fits, dashed);
  const [firstKey, secondKey] = [first, second].map((fit) => fit && endKey(fit.zoneAt, fit.end));
  if ([firstKey, secondKey].some((key) => key && (links.has(key) || tails.has(key)))) return false;
  const corner = { parts: candidate.parts, point: [part.cx, part.cy] };
  const joined = second ? [[firstKey, { to: second, corner }], [secondKey, { to: first, corner }]] : [];
  joined.forEach(([key, link]) => links.set(key, link));
  if (!second) tails.set(firstKey, corner);
  return true;
}

// Пересечение продолжений двух сторон; центр уголка, если стороны почти параллельны.
function crossing([a, b], [c, d], center) {
  const [u, v] = [sub(b, a), sub(d, c)];
  const turnBy = cross(u, v);
  if (Math.abs(turnBy) < 1e-6 * norm(u) * norm(v)) return center;
  const t = cross(sub(c, a), v) / turnBy;
  const hit = AXES.map((axis) => a[axis] + t * u[axis]);
  return dist(center, hit) <= Math.max(8, dist(b, c)) ? hit : center;
}

// Точка угла рамки: пересечение сторон, если оно рядом с центром уголка.
function cornerPoint(before, after, center) {
  const sides = [before.slice(-2), after.slice(0, 2)];
  return sides.some((side) => side.length < 2) ? center : crossing(...sides, center);
}

// Цепочки зон по ссылкам: от концов без ссылки, затем замкнутые циклы.
function chainsOf(dashed, { links, tails }) {
  const visited = new Set();
  const orient = (zoneAt, end) => (end ? dashed[zoneAt].points.slice().reverse() : dashed[zoneAt].points);

  // Звенья цепочки: зона, вход в неё и ссылка на выходе.
  function* legs(startAt, startEnd) {
    let [zoneAt, end] = [startAt, startEnd];
    for (;;) {
      visited.add(zoneAt);
      const link = links.get(endKey(zoneAt, 1 - end));
      yield { zoneAt, end, link };
      if (!link || link.to.zoneAt === startAt || visited.has(link.to.zoneAt)) return;
      ({ zoneAt, end } = link.to);
    }
  }

  const walk = (startAt, startEnd) => {
    const trip = [...legs(startAt, startEnd)];
    const head = tails.get(endKey(startAt, startEnd));
    const stretches = trip.flatMap(({ zoneAt, end, link }) => {
      const side = orient(zoneAt, end);
      const stop = link
        ? { point: cornerPoint(side, orient(link.to.zoneAt, link.to.end), link.corner.point), parts: link.corner.parts }
        : tails.get(endKey(zoneAt, 1 - end));
      const body = { points: side, parts: dashed[zoneAt].parts };
      return stop ? [body, { points: [stop.point], parts: stop.parts }] : [body];
    });
    const all = head ? [{ points: [head.point], parts: head.parts }, ...stretches] : stretches;
    const closed = Boolean(trip.at(-1).link) && trip.at(-1).link.to.zoneAt === startAt;
    const width = trip.reduce((widest, { zoneAt }) => Math.max(widest, dashed[zoneAt].width), -Infinity);
    return { ...dashed[startAt], points: all.flatMap((s) => s.points), open: !closed, width, parts: all.flatMap((s) => s.parts) };
  };

  const fromOpenEnds = dashed.flatMap((_, zoneAt) => {
    const free = [0, 1].find((end) => !links.has(endKey(zoneAt, end)));
    return visited.has(zoneAt) || free === undefined ? [] : [walk(zoneAt, free)];
  });
  const cycles = dashed.flatMap((_, zoneAt) => (visited.has(zoneAt) ? [] : [walk(zoneAt, 0)]));
  return [...fromOpenEnds, ...cycles];
}

// Сшивка при наличии пунктирных зон: untouched — то, что вернуть, если уголков нет.
function joinOnto(untouched, dashed) {
  const { labels, zones, rest } = untouched;
  const joints = { links: new Map(), tails: new Map() };
  const candidates = cornerCandidates(labels, rest, new Set(dashed.map(colorName)));
  const accepted = candidates.filter((candidate) => attach(candidate, dashed, joints));
  if (!joints.links.size && !joints.tails.size) return untouched;
  const usedLabels = new Set(accepted.map((c) => c.label).filter(Boolean));
  const usedParts = new Set(accepted.flatMap((c) => c.parts));
  const leftover = rest.filter((part) => !usedParts.has(part));
  const others = zones.filter((zone) => !isDashedOpen(zone));
  const kept = usedLabels.size ? labels.filter((label) => !usedLabels.has(label)) : labels;
  return { labels: kept, zones: [...chainsOf(dashed, joints), ...others], rest: leftover };
}

export function joinCorners(labels, zones, rest = []) {
  const dashed = zones.filter(isDashedOpen);
  const untouched = { labels, zones, rest };
  return dashed.length ? joinOnto(untouched, dashed) : untouched;
}
