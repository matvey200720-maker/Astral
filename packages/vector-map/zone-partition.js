// Деление плоскости между зонами без перекрытий: сетка по сторонам прямоугольников,
// клетка достаётся меньшей зоне, затем обходятся контуры по рёбрам сетки.
// Общая граница двух зон строится один раз и достаётся обеим как одна ломаная.
// Точки внутри — пары [x, y].

const NONE = -1;

const RULES = Object.freeze({
  shortLink: 100,
  cutRatio: 0.25,
  cutPasses: 2,
  flatCeiling: 900,
  areaDivisor: 300,
  growth: 1.6,
  rounds: 24,
});

// Направления обхода (ось y вниз): 0 вправо, 1 вниз, 2 влево, 3 вверх.
// Для каждого — шаг вершины и клетки по правую и левую руку от выходящего ребра.
const HEADINGS = [
  { step: [1, 0], right: [0, 0], left: [0, -1] },
  { step: [0, 1], right: [-1, 0], left: [0, 0] },
  { step: [-1, 0], right: [-1, -1], left: [-1, 0] },
  { step: [0, -1], right: [0, -1], left: [-1, -1] },
];

// Соседи клетки: слева, справа, сверху, снизу.
// Поворот по тому, лежат ли справа и слева впереди клетки куска: [справа][слева].
const TURN_BY_SIDES = [
  [1, 1],
  [0, 3],
];

const NEIGHBOUR_STEPS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// Отсортированные значения одной оси: все нижние и верхние стороны без повторов (0 и -0 — одно значение).
function axisStops(rects, lowKey, highKey) {
  const seen = new Set();
  for (const rect of rects) {
    seen.add(rect[lowKey]);
    seen.add(rect[highKey]);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function indexMap(stops) {
  const map = new Map();
  stops.forEach((value, k) => map.set(value, k));
  return map;
}

function* between(from, to) {
  for (let v = from; v < to; v += 1) yield v;
}

// Пара номеров: колонки (или строки), которые занимает прямоугольник.
function spanOf(rect, lowKey, highKey, indexOf) {
  return [indexOf.get(rect[lowKey]), indexOf.get(rect[highKey])];
}

// Сетка по всем сторонам прямоугольников: клетка (col, row) имеет номер row * cols + col.
class Grid {
  constructor(rects) {
    this.xs = axisStops(rects, "minX", "maxX");
    this.ys = axisStops(rects, "minY", "maxY");
    this.cols = this.xs.length - 1;
    this.rows = this.ys.length - 1;
    this.colAt = indexMap(this.xs);
    this.rowAt = indexMap(this.ys);
  }

  get isEmpty() {
    return this.cols < 1 || this.rows < 1;
  }

  cellAt(col, row) {
    const inside = col >= 0 && col < this.cols && row >= 0 && row < this.rows;
    return inside ? row * this.cols + col : NONE;
  }

  cellArea(cell) {
    const col = cell % this.cols;
    const row = (cell - col) / this.cols;
    return (this.xs[col + 1] - this.xs[col]) * (this.ys[row + 1] - this.ys[row]);
  }

  neighbours(cell) {
    const col = cell % this.cols;
    const row = (cell - col) / this.cols;
    return NEIGHBOUR_STEPS.map(([dc, dr]) => this.cellAt(col + dc, row + dr)).filter((next) => next !== NONE);
  }

  // Номера клеток внутри прямоугольника: строки сверху вниз, в строке слева направо.
  *cellsOf(rect) {
    const [col0, col1] = spanOf(rect, "minX", "maxX", this.colAt);
    const [row0, row1] = spanOf(rect, "minY", "maxY", this.rowAt);
    for (const row of between(row0, row1)) {
      for (const col of between(col0, col1)) yield row * this.cols + col;
    }
  }
}

function collectRects(zones) {
  const perZone = zones.map((zone, index) =>
    [...(zone.cells || [])].map(({ minX, minY, maxX, maxY }) => ({ minX, minY, maxX, maxY, zone: index })),
  );
  return perZone.flat();
}

function rectArea({ minX, minY, maxX, maxY }) {
  const width = maxX - minX;
  return width * (maxY - minY);
}

function zoneAreas(count, rects) {
  const areas = new Array(count).fill(0);
  for (const rect of rects) areas[rect.zone] += rectArea(rect);
  return areas;
}

// Клетка достаётся свободной, либо зоне меньшей площади, либо при равенстве — стоящей раньше в списке.
function outranks(zone, holder, areas) {
  if (holder === NONE) return true;
  const [mine, theirs] = [areas[zone], areas[holder]];
  return mine < theirs || (mine === theirs && zone < holder);
}

function assignOwners(grid, rects, areas) {
  const owner = new Int32Array(grid.cols * grid.rows).fill(NONE);
  for (const rect of rects) {
    for (const cell of grid.cellsOf(rect)) {
      owner[cell] = outranks(rect.zone, owner[cell], areas) ? rect.zone : owner[cell];
    }
  }
  return owner;
}

// Куски: клетки одного владельца, соседние по рёбрам; площадь копится в порядке снятия со стека.
function labelPieces(grid, owner) {
  const label = new Int32Array(owner.length).fill(NONE);
  const pieces = [];
  for (const [seed, zone] of owner.entries()) {
    if (zone === NONE || label[seed] !== NONE) continue;
    const id = pieces.length;
    const stack = [seed];
    let area = 0;
    label[seed] = id;
    while (stack.length > 0) {
      const cell = stack.pop();
      area += grid.cellArea(cell);
      for (const next of grid.neighbours(cell)) {
        if (owner[next] !== zone || label[next] !== NONE) continue;
        label[next] = id;
        stack.push(next);
      }
    }
    pieces.push({ zone, area, seed });
  }
  return { label, pieces };
}

// Главный кусок зоны: наибольшей площади, при равенстве — открытый раньше.
function mainPieces(pieces, zoneCount) {
  const best = new Array(zoneCount).fill(NONE);
  for (const [id, { zone, area }] of pieces.entries()) {
    if (best[zone] === NONE || area > pieces[best[zone]].area) best[zone] = id;
  }
  return best;
}

// Наружный контур куска: записи [i, j, главный кусок слева от выходящего ребра].
function* walkOutline(grid, mainLabel, piece, seed) {
  const startI = seed % grid.cols;
  const startJ = (seed - startI) / grid.cols;
  const cap = 4 * (grid.cols + 1) * (grid.rows + 1);
  const labelAt = (i, j) => {
    const cell = grid.cellAt(i, j);
    return cell === NONE ? NONE : mainLabel[cell];
  };
  let [i, j] = [startI, startJ];
  let heading = 0;
  for (let steps = 1; ; steps += 1) {
    const { step, right, left } = HEADINGS[heading];
    yield [i, j, labelAt(i + left[0], j + left[1])];
    i += step[0];
    j += step[1];
    const rightIn = labelAt(i + right[0], j + right[1]) === piece;
    const leftIn = labelAt(i + left[0], j + left[1]) === piece;
    heading = (heading + TURN_BY_SIDES[Number(rightIn)][Number(leftIn)]) % 4;
    if ((i === startI && j === startJ && heading === 0) || steps >= cap) return;
  }
}

// Режет кольцо там, где меняется сосед; без разрезов получается одна замкнутая цепь.
function splitChains(ring, grid) {
  const count = ring.length;
  const world = ([i, j]) => [grid.xs[i], grid.ys[j]];
  const cuts = ring.flatMap((entry, k) => (entry[2] !== ring[(k + count - 1) % count][2] ? [k] : []));
  if (cuts.length === 0) return [{ neighbor: ring[0][2], closed: true, points: ring.map(world) }];
  const twice = ring.concat(ring);
  const ends = [...cuts.slice(1), cuts[0]];
  return cuts.map((from, t) => {
    const span = (ends[t] - from + count) % count || count;
    return { neighbor: ring[from][2], closed: false, points: twice.slice(from, from + span + 1).map(world) };
  });
}

// ---- упрощение цепи ---------------------------------------------------------------

// Точки на одной вертикали или горизонтали с последней оставленной и следующей исходной уходят.
function dropStraight(pts) {
  let anchor = pts[0];
  return pts.filter((pt, k) => {
    if (k === 0 || k === pts.length - 1) return true;
    const aligned = [0, 1].some((axis) => [pt, pts[k + 1]].every((q) => q[axis] === anchor[axis]));
    if (!aligned) anchor = pt;
    return !aligned;
  });
}

// Угол между двумя короткими звеньями заменяется двумя точками на четверти звеньев.
function cutCorners(pts) {
  return pts.flatMap((pt, k) => {
    if (k === 0 || k === pts.length - 1) return [pt];
    const around = [pts[k - 1], pts[k + 1]];
    const short = around.every((other) => Math.hypot(pt[0] - other[0], pt[1] - other[1]) <= RULES.shortLink);
    if (!short) return [pt];
    return around.map((other) => pt.map((c, axis) => c + (other[axis] - c) * RULES.cutRatio));
  });
}

function triangleArea(a, b, c) {
  const [u0, u1] = [b[0] - a[0], b[1] - a[1]];
  const [v0, v1] = [c[0] - a[0], c[1] - a[1]];
  return Math.abs(u0 * v1 - v0 * u1) / 2;
}

// Вершины с площадью треугольника меньше порога уходят по одной, начиная с наименьшей (при равенстве — первой).
function dropFlat(pts, flat) {
  const n = pts.length;
  const before = Int32Array.from({ length: n }, (_, k) => k - 1);
  const after = Int32Array.from({ length: n }, (_, k) => k + 1);
  const alive = new Uint8Array(n).fill(1);
  const area = new Float64Array(n).fill(Infinity);
  const measure = (k) => {
    if (k > 0 && k < n - 1) area[k] = triangleArea(pts[before[k]], pts[k], pts[after[k]]);
  };
  pts.forEach((_, k) => measure(k));

  const weakest = () => area.reduce((found, a, k) => (a < flat && (found === NONE || a < area[found]) ? k : found), NONE);
  for (let k = weakest(); k !== NONE; k = weakest()) {
    const [prev, next] = [before[k], after[k]];
    alive[k] = 0;
    area[k] = Infinity;
    after[prev] = next;
    before[next] = prev;
    measure(prev);
    measure(next);
  }
  return pts.filter((_, k) => alive[k]);
}

function simplifyChain({ points, closed }, flat) {
  const work = closed ? [...points, points[0]] : points;
  const smoothed = Array.from({ length: RULES.cutPasses }).reduce((acc) => cutCorners(acc), dropStraight(work));
  const result = dropFlat(smoothed, flat);
  return closed ? result.slice(0, -1) : result;
}

// Общая цепь двух зон узнаётся по ключу: номера кусков, крайние точки, число точек.
function chainKey(piece, { points, neighbor }) {
  const ends = [points[0], points.at(-1)].map(([x, y]) => `${x},${y}`).sort();
  return [Math.min(piece, neighbor), Math.max(piece, neighbor), ...ends, points.length].join("|");
}

// Куски, главные куски зон и метка клетки: номер главного куска или NONE.
function analyse(grid, owner, zoneCount) {
  const { label, pieces } = labelPieces(grid, owner);
  const mainOf = mainPieces(pieces, zoneCount);
  const mainSet = new Set(mainOf);
  const mainLabel = label.map((id) => (mainSet.has(id) ? id : NONE));
  return { pieces, mainOf, mainLabel };
}

function tableOf(ids, valueOf) {
  return new Map(ids.map((id) => [id, valueOf(id)]));
}

// Точки общей цепи берутся из памяти, если порог тот же: у второй зоны — в обратном порядке.
function chainPoints(shared, piece, chain, flat) {
  const key = chainKey(piece, chain);
  const known = shared.get(key);
  if (known?.flat === flat) return known.piece === piece ? known.points : [...known.points].reverse();
  const points = simplifyChain(chain, flat);
  shared.set(key, { flat, piece, points });
  return points;
}

const roundedRing = (ring) => ring.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));

export function partitionZones(zones, options = {}) {
  const { limit = 96 } = options;
  const rects = collectRects(zones);
  if (rects.length === 0) return {};
  const grid = new Grid(rects);
  if (grid.isEmpty) return {};

  const owner = assignOwners(grid, rects, zoneAreas(zones.length, rects));
  const { pieces, mainOf, mainLabel } = analyse(grid, owner, zones.length);
  const mains = mainOf.filter((id) => id !== NONE);
  const outlines = tableOf(mains, (id) => {
    const ring = Array.from(walkOutline(grid, mainLabel, id, pieces[id].seed));
    return splitChains(ring, grid);
  });
  const base = tableOf(mains, (id) => Math.min(RULES.flatCeiling, pieces[id].area / RULES.areaDivisor));
  const growth = tableOf(mains, () => 1);

  // Порог площади цепи: у общей границы — меньшая база при большем множителе.
  const flatOf = (piece, neighbor) => {
    const sides = neighbor === NONE ? [piece] : [piece, neighbor];
    return Math.min(...sides.map((id) => base.get(id))) * Math.max(...sides.map((id) => growth.get(id)));
  };

  // Кольца всех главных кусков с общей памятью цепей, заново на каждый вызов.
  const ringsNow = () => {
    const shared = new Map();
    return mains.map((piece) =>
      outlines.get(piece).flatMap((chain) => {
        const points = chainPoints(shared, piece, chain, flatOf(piece, chain.neighbor));
        return chain.closed ? points : points.slice(0, -1);
      }),
    );
  };

  // В каждом круге сначала проверяются все кольца, потом растут множители тех, что длиннее предела.
  Array.from({ length: RULES.rounds }).some(() => {
    const current = ringsNow();
    const longer = mains.filter((_, k) => current[k].length > limit);
    longer.forEach((piece) => growth.set(piece, growth.get(piece) * RULES.growth));
    return longer.length === 0;
  });
  const rings = ringsNow();

  const result = {};
  for (const [zone, piece] of mainOf.entries()) {
    if (piece !== NONE) result[zones[zone].id] = roundedRing(rings[mains.indexOf(piece)]);
  }
  return result;
}
