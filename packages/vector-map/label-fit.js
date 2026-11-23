// Подпись зоны внутри зоны: полюс недоступности контура, наибольший кегль для рамки текста
// и выбор лучшей раскладки (прямая строка, две строки, строка вдоль главной оси).
// Точки внутри — пары [x, y]; рёбра — пары «текущая вершина, предыдущая».

export const LABEL_LINE_STEP = 1.12;

const BOX = { height: 0.82, padding: 0.14 };
const POLE = { precision: 0.25, steps: 4000 };
const AXIS = { ratio: 2, tilt: [12, 65] };
const SHIFTS = [-1, 1, -2, 2];
// Соседние клетки по порядку: (−, −), (+, −), (−, +), (+, +).
const QUADRANTS = [0, 1, 2, 3].map((k) => [k % 2 ? 1 : -1, k > 1 ? 1 : -1]);

const orDefault = (value, fallback) => (value === undefined ? fallback : value);
const square = (v) => v * v;
const between = (value, [low, high]) => value > low && value < high;

const swap = (list, i, j) => {
  const [taken] = list.splice(j, 1, list[i]);
  list[i] = taken;
};

// Векторные помощники: порядок слагаемых в каждой сумме важен для последнего бита.
const sub = ([ax, ay], [bx, by]) => [ax - bx, ay - by];
const dot = ([ax, ay], [bx, by]) => ax * bx + ay * by;
const wedge = ([ax, ay], [bx, by]) => ax * by - bx * ay;
const toPair = ({ x, y }) => [x, y];

// Рёбра кольца: [вершина, предыдущая вершина]; у первой вершины предыдущая — последняя.
const ringEdges = (ring) => ring.map((vertex, i) => [vertex, ring[(i + ring.length - 1) % ring.length]]);

// Луч вправо от точки p пересекает ребро a-b.
const flips = (p, a, b) => (a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];

// Квадрат расстояния от точки до отрезка a-b.
const segmentSq = (point, a, b) => {
  const along = sub(b, a);
  const t = dot(sub(point, a), along) / dot(along, along);
  const foot = [a, [a[0] + along[0] * t, a[1] + along[1] * t], b][Number(t > 0) + Number(t > 1)];
  return dot(sub(point, foot), sub(point, foot));
};

// Контур: кольцо, рёбра, проверка попадания и расстояние со знаком (внутри плюс).
const contour = (ring) => {
  const edges = ringEdges(ring);
  const holds = (point) => edges.reduce((inside, [a, b]) => inside !== flips(point, a, b), false);
  const signed = (point) => {
    const nearest = edges.reduce((least, [a, b]) => Math.min(least, segmentSq(point, a, b)), Infinity);
    return Math.sqrt(nearest) * (holds(point) ? 1 : -1);
  };
  return { ring, edges, holds, signed };
};

// Очередь по reach: наверху наибольший; при равенстве родитель остаётся выше.
const lift = (heap, at) => {
  const parent = (at - 1) >> 1;
  if (at === 0 || heap[parent].reach >= heap[at].reach) return;
  swap(heap, parent, at);
  lift(heap, parent);
};

const sink = (heap, at) => {
  const kids = [2 * at + 1, 2 * at + 2].filter((k) => k < heap.length);
  const largest = kids.reduce((top, k) => (heap[k].reach > heap[top].reach ? k : top), at);
  if (largest === at) return;
  swap(heap, at, largest);
  sink(heap, largest);
};

const enqueue = (heap, cell) => lift(heap, heap.push(cell) - 1);

const dequeue = (heap) => {
  swap(heap, 0, heap.length - 1);
  const top = heap.pop();
  sink(heap, 0);
  return top;
};

function* drain(heap, budget) {
  for (let used = 0; used < budget && heap.length; used += 1) yield dequeue(heap);
}

function* ticks(from, to, step) {
  for (let v = from; v < to; v += step) yield v;
}

// Клетка поиска: центр, полусторона, расстояние от центра и верхняя оценка для всей клетки.
const cellAt = (field, center, half) => {
  const distance = field.signed(center);
  return Object.assign({ at: center, half }, { distance, reach: distance + half * Math.SQRT2 });
};

const better = (held, candidate) => (candidate.distance > held.distance ? candidate : held);

// Середина по площади (шнуровка) либо null при нулевой площади.
const areaCenter = (edges) => {
  const [area, sx, sy] = edges.reduce(
    ([sum, mx, my], [a, b]) => {
      const w = wedge(a, b);
      return [sum + w, mx + (a[0] + b[0]) * w, my + (a[1] + b[1]) * w];
    },
    [0, 0, 0],
  );
  return area ? [sx / (3 * area), sy / (3 * area)] : null;
};

const extent = (values) => values.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity]);

// Перебор клеток от крупных к мелким с отсечением по верхней оценке.
function searchPole(field, [[minX, maxX], [minY, maxY]], precision) {
  const [width, height] = [maxX - minX, maxY - minY];
  const side = Math.min(width, height);
  const half = side / 2;
  const middle = cellAt(field, [minX + width / 2, minY + height / 2], 0);
  const mass = areaCenter(field.edges);
  let best = better(mass ? cellAt(field, mass, 0) : middle, middle);

  const queue = [];
  for (const x of ticks(minX, maxX, side)) {
    for (const y of ticks(minY, maxY, side)) enqueue(queue, cellAt(field, [x + half, y + half], half));
  }
  for (const cell of drain(queue, POLE.steps)) {
    best = better(best, cell);
    if (cell.reach - best.distance <= precision) continue;
    const quarter = cell.half / 2;
    QUADRANTS.forEach(([sx, sy]) => {
      enqueue(queue, cellAt(field, [cell.at[0] + sx * quarter, cell.at[1] + sy * quarter], quarter));
    });
  }
  return { x: best.at[0], y: best.at[1], distance: Math.max(0, best.distance) };
}

const poleOf = (field, precision) => {
  const bounds = [0, 1].map((axis) => extent(field.ring.map((p) => p[axis])));
  const [[minX, maxX], [minY, maxY]] = bounds;
  return Math.min(maxX - minX, maxY - minY) > 0
    ? searchPole(field, bounds, precision)
    : { x: minX, y: minY, distance: 0 };
};

export const poleOfInaccessibility = (polygon, precision = 0.5) =>
  poleOf(contour([...polygon].map(toPair)), precision);

export const splitLabel = (text) => {
  const value = String(text || "");
  const cuts = Array.from({ length: Math.max(0, value.length - 2) }, (_, k) => k + 1);
  const halvesAt = (at) => [value.slice(0, value[at] === "-" ? at + 1 : at), value.slice(at + 1)].map((s) => s.trim());
  const longest = (pair) => Math.max(...pair.map((s) => s.length));
  return cuts
    .filter((at) => " -".includes(value[at]))
    .map(halvesAt)
    .filter((pair) => pair.every(Boolean))
    .reduce((best, pair) => (best && longest(best) <= longest(pair) ? best : pair), null);
};

// Поворот точки вокруг начала на угол.
const turnAround = (origin, angle) => {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return (point) => {
    const [dx, dy] = sub(point, origin);
    return [origin[0] + dx * cos - dy * sin, origin[1] + dx * sin + dy * cos];
  };
};

// Рёбра с длиной и серединой; нулевые отбрасываются.
const weightedEdges = (ring) =>
  ringEdges(ring)
    .map(([b, a]) => ({ len: Math.hypot(...sub(b, a)), mid: a.map((v, k) => (v + b[k]) / 2) }))
    .filter(({ len }) => len);

// Угол и вытянутость по моментам рёбер относительно их взвешенной середины.
const axisOf = (parts, total) => {
  const center = [0, 1].map((k) => parts.reduce((sum, { mid, len }) => sum + mid[k] * len, 0) / total);
  const [sxx, syy, sxy] = parts.reduce(
    ([a, b, c], { mid, len }) => {
      const [dx, dy] = sub(mid, center);
      return [a + dx * dx * len, b + dy * dy * len, c + dx * dy * len];
    },
    [0, 0, 0],
  );
  const diff = sxx - syy;
  const mean = (sxx + syy) / 2;
  const root = Math.sqrt(square(diff / 2) + square(sxy));
  const doubled = (v) => 2 * v;
  return { angle: Math.atan2(doubled(sxy), diff) / 2, ratio: Math.sqrt((mean + root) / Math.max(1e-9, mean - root)) };
};

const principalAxis = (ring) => {
  const parts = weightedEdges(ring);
  const total = parts.reduce((sum, { len }) => sum + len, 0);
  return total ? axisOf(parts, total) : { angle: 0, ratio: 1 };
};

// Один шаг среза Лян — Барски: окно [lo, hi] либо null, если отрезок вышел из рамки.
const narrow = (window, [p, q]) => {
  if (window === null) return null;
  const [lo, hi] = window;
  const t = q / p;
  if (p === 0) return q > 0 ? window : null;
  if (p < 0) return t > hi ? null : [t > lo ? t : lo, hi];
  if (p > 0) return t < lo ? null : [lo, t < hi ? t : hi];
  return window;
};

// Отрезок a-b заходит внутрь рамки [left, right, top, bottom].
const cutsInterior = (a, b, [left, right, top, bottom]) => {
  const [dx, dy] = sub(b, a);
  const clips = [[-dx, a[0] - left], [dx, right - a[0]], [-dy, a[1] - top], [dy, bottom - a[1]]];
  const window = clips.reduce(narrow, [0, 1]);
  return window !== null && window[1] > window[0];
};

const boxFits = (field, frame) => {
  const [left, right, top, bottom] = frame;
  const corners = [[top, [left, right]], [bottom, [right, left]]].flatMap(([y, xs]) => xs.map((x) => [x, y]));
  const crossing = ([cur, prev]) => cutsInterior(prev, cur, frame);
  return corners.every(field.holds) && !field.edges.some(crossing);
};

// Делит отрезок [lo, hi] пополам rounds раз, оставляя в lo то, что проходит проверку.
const bisect = (lo, hi, ok, rounds) =>
  Array.from({ length: rounds }).reduce(([a, b]) => {
    const mid = (a + b) / 2;
    return ok(mid) ? [mid, b] : [a, mid];
  }, [lo, hi])[0];

const halfSpan = (perSize, size, inset) => {
  const scaled = (k) => size * k;
  return scaled(perSize) / 2 + scaled(BOX.padding) + inset;
};

const biggestSize = (field, [cx, cy], perSize, inset, limit) => {
  const fits = (size) => {
    const [hw, hh] = perSize.map((per) => halfSpan(per, size, inset));
    return boxFits(field, [cx - hw, cx + hw, cy - hh, cy + hh]);
  };
  const floor = limit * 0.02;
  return fits(floor) ? (fits(limit) ? limit : bisect(floor, limit, fits, 16)) : 0;
};

// Лучшее место для горизонтальной рамки: полюс и сдвиги вдоль строки.
const layoutHorizontal = (ring, perSize, inset) => {
  const field = contour(ring);
  const pole = poleOf(field, POLE.precision);
  const limit = (2 * pole.distance) / perSize[1];
  const sizeAt = (x) => biggestSize(field, [x, pole.y], perSize, inset, limit);
  const challengers = SHIFTS.map((shift) => pole.x + shift * pole.distance * 0.6).filter((x) => field.holds([x, pole.y]));
  const leader = challengers.reduce(
    (held, x) => {
      const size = sizeAt(x);
      return size > held.size * 1.04 ? { x, size } : held;
    },
    { x: pole.x, size: sizeAt(pole.x) },
  );
  return pole.distance > 0 && leader.size > 0 ? { x: leader.x, y: pole.y, size: leader.size } : null;
};

// Раскладка формы: наклонная форма считается в повёрнутом контуре, место возвращается назад.
const placeForm = (ring, { width, height, angle }, inset) => {
  if (!angle) return layoutHorizontal(ring, [width, height], inset);
  const origin = ring[0];
  const placed = layoutHorizontal(ring.map(turnAround(origin, -angle)), [width, height], inset);
  const [x, y] = placed ? turnAround(origin, angle)([placed.x, placed.y]) : [];
  return placed && { x, y, size: placed.size };
};

const makeForm = (lines, width, height, angle, penalty) => ({ lines, width, height, angle, penalty });

export const zoneLabelVariants = (polygon, text, measure, options = {}) => {
  const inset = orDefault(options.inset, 0);
  if ([!polygon, !text, polygon?.length < 3].some(Boolean)) return [];

  const straight = measure(text);
  const halves = splitLabel(text);
  const twoLines = halves && Math.max(...halves.map((line) => measure(line)));
  const ring = [...polygon].map(toPair);
  const axis = principalAxis(ring);
  const along = axis.ratio > AXIS.ratio && between(Math.abs((axis.angle * 180) / Math.PI), AXIS.tilt);

  return [
    makeForm(null, straight, BOX.height, 0, 1),
    halves && makeForm(halves, twoLines, BOX.height + LABEL_LINE_STEP, 0, 0.9),
    along && makeForm(null, straight, BOX.height, axis.angle, 0.85),
  ]
    .filter(Boolean)
    .map((form) => [form, placeForm(ring, form, inset)])
    .filter(([, spot]) => spot)
    .map(([form, { x, y, size }]) => {
      const { angle, lines, penalty } = form;
      return { x, y, angle, size, lines, penalty };
    });
};

const pickPlacement = ({ x, y, angle, size, lines }) => ({ x, y, angle, size, lines });

export const chooseZoneLabel = (variants, wanted = Infinity) => {
  const list = [...variants];
  const direct = list.find((v) => !v.angle && !v.lines && v.size >= wanted);
  const score = (v) => Math.min(v.size, wanted) * v.penalty;
  if (direct) return pickPlacement(direct);
  const best = list.reduce((leader, v) => (score(v) > score(leader) ? v : leader), list[0]);
  return list.length ? pickPlacement(best) : null;
};

export const fitZoneLabel = (polygon, text, measure, options = {}) => {
  const [inset, wanted] = [orDefault(options.inset, 0), orDefault(options.wanted, Infinity)];
  const variants = zoneLabelVariants(polygon, text, measure, { inset });
  return chooseZoneLabel(variants, wanted);
};

export const labelLineBox = (lines) => {
  const count = lines ? lines.length : 1;
  return { lines: count, height: BOX.height + (lines ? (count - 1) * LABEL_LINE_STEP : 0) };
};
