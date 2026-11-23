/* Геометрия отделения общего куска развёртки на листе материала оружия.
   Доли листа: 0..1 по каждой оси (v растёт вниз). Клетка — 1/512 листа.
   Состояние живёт только в объекте раскладки { islands, owners }. */

/* ---------- общие помощники ---------- */

// числа от start до stop (не включая) с шагом step; пустой при NaN
function* range(start, stop, step = 1) {
  for (let n = start; n < stop; n += step) yield n;
}

const cross = (ax, ay, bx, by) => ax * by - bx * ay;

const clampCell = (n) => Math.min(Math.max(n, 0), GRID - 1);

const centerOf = (cell) => (cell + 0.5) / GRID;

const ascending = (a, b) => a - b;

// наименьшая степень двойки не меньше значения, но не меньше 4
const pow2 = (value, side = 4) => (side < value ? pow2(value, side * 2) : side);

const emptyBox = () => [Infinity, Infinity, -Infinity, -Infinity];

// рамка растёт по четырём краям: два минимума, два максимума
const EDGE_PICKS = [Math.min, Math.min, Math.max, Math.max];

const growBox = (box, edges) => {
  EDGE_PICKS.forEach((pick, k) => {
    box[k] = pick(box[k], edges[k]);
  });
};

// «достаточно» клеток: не меньше порога по штукам и по доле от всех
const meets = ({ cells, ratio }, count, total) => count >= cells && count / total >= ratio;

const credit = (owners, cell) => {
  if (owners[cell] < OWNER_CAP) owners[cell] += 1;
};

const release = (owners, cell) => {
  if (owners[cell] > 0) owners[cell] -= 1;
};

// остров по ключу: null и undefined вместо раскладки дают «нет», любая другая без islands — ошибку
const lookup = (layout, key) => (layout == null ? undefined : layout.islands.get(key));

/* ---------- клетки под треугольником ---------- */

// шесть чисел развёртки треугольника t; чего нет, то undefined
const cornersOf = (uvs, t) => {
  const at = t * 6;
  return [0, 1, 2, 3, 4, 5].map((k) => uvs[at + k]);
};

const boundsOf = ([u0, v0, u1, v1, u2, v2]) => [
  Math.min(u0, u1, u2),
  Math.min(v0, v1, v2),
  Math.max(u0, u1, u2),
  Math.max(v0, v1, v2),
];

// диапазон клеток по оси: [первая, последняя], границы включены
const cellSpan = (...coords) => [
  clampCell(Math.floor(Math.min(...coords) * GRID)),
  clampCell(Math.ceil(Math.max(...coords) * GRID)),
];

function leavesTriangle(w0, w1) {
  if (w0 < 0) return true;
  if (w1 < 0) return true;
  return w0 + w1 > 1;
}

/* Клетки, чей центр лежит в треугольнике. onCell(номер, строго):
   «строго» — центр не на ребре (ребро делят два соседних треугольника). */
function scanTriangle(corners, onCell) {
  const [u0, v0, u1, v1, u2, v2] = corners;
  const area = cross(u1 - u0, v1 - v0, u2 - u0, v2 - v0);
  if (!area) return;

  const clear = (w) => w > INNER_EPS;
  const [colFirst, colLast] = cellSpan(u0, u1, u2);
  const [rowFirst, rowLast] = cellSpan(v0, v1, v2);
  for (const row of range(rowFirst, rowLast + 1)) {
    const v = centerOf(row);
    for (const col of range(colFirst, colLast + 1)) {
      const u = centerOf(col);
      const w0 = cross(u1 - u, v1 - v, u2 - u, v2 - v) / area;
      const w1 = cross(u2 - u, v2 - v, u0 - u, v0 - v) / area;
      if (leavesTriangle(w0, w1)) continue;
      onCell(row * GRID + col, clear(w0) && clear(w1) && w0 + w1 < 1 - INNER_EPS);
    }
  }
}

const strictCellsOf = (corners) => {
  const found = [];
  scanTriangle(corners, (cell, strict) => strict && found.push(cell));
  return found;
};

/* ---------- раскладка островов ---------- */

// сетки, у которых есть и развёртка, и номера островов
function* usablePieces(pieces) {
  for (const { key, uvs, islands } of pieces || []) {
    if (uvs && islands) yield [key, uvs, islands];
  }
}

function* trianglesOf(numbers, uvs) {
  for (const t of range(0, numbers.length)) yield [numbers[t], cornersOf(uvs, t)];
}

function islandFor(table, mesh, number) {
  const key = `${mesh}:${number}`;
  if (!table.has(key)) {
    const [cells, inner] = [new Set(), new Set()];
    table.set(key, { key, mesh, island: number, box: emptyBox(), cells, inner, folds: 0, tiled: false });
  }
  return table.get(key);
}

// клетка попала в остров; строго внутренняя клетка во второй раз — наложение
function settle(island, cell, strict) {
  island.cells.add(cell);
  if (!strict) return;
  island.folds += Number(island.inner.has(cell));
  island.inner.add(cell);
}

function sealIsland(island, owners) {
  Object.assign(island, { inner: null, tiled: boxTiled(island.box) });
  island.cells.forEach((cell) => credit(owners, cell));
}

export function islandLayout(pieces) {
  const islands = new Map();
  for (const [mesh, uvs, numbers] of usablePieces(pieces)) {
    for (const [number, corners] of trianglesOf(numbers, uvs)) {
      const island = islandFor(islands, mesh, number);
      growBox(island.box, boundsOf(corners));
      scanTriangle(corners, (cell, strict) => settle(island, cell, strict));
    }
  }
  const owners = new Uint16Array(GRID * GRID);
  islands.forEach((island) => sealIsland(island, owners));
  return { islands, owners };
}

export const islandFolded = (layout, key) => {
  const island = lookup(layout, key);
  return Boolean(island) && !island.tiled && meets(OVERLAP_RULE, island.folds || 0, island.cells.size);
};

export function islandShared(layout, key) {
  const island = lookup(layout, key);
  if (!(island && !island.tiled && island.cells.size > 0)) return false;

  const crowdedCount = () => [...island.cells].filter((cell) => layout.owners[cell] > 1).length;
  return islandFolded(layout, key) || meets(OVERLAP_RULE, crowdedCount(), island.cells.size);
}

/* ---------- прямоугольники в точках листа и поиск места ---------- */

const axisSpan = (lo, hi, size) => {
  const pad = Math.ceil(PAD * size / GRID);
  const start = Math.max(Math.floor(lo * size) - pad, 0);
  return [start, Math.min(size, Math.ceil(hi * size) + pad) - start];
};

export const islandRect = (box, width, height) => {
  const [x, w] = axisSpan(box[0], box[2], width);
  const [y, h] = axisSpan(box[1], box[3], height);
  return { x, y, w, h };
};

// клеток нужно куску в точках: сам кусок, одна на округление и по полю с каждой стороны
const cellsFor = (points, sheet) => Math.ceil((points * GRID) / sheet) + SEARCH_MARGIN;

const pointOfCell = (cell, sheet) => Math.ceil(((cell + PAD) * sheet) / GRID);

const degenerate = (rect) => rect.w <= 0 || rect.h <= 0;

// размеры куска для каждого размера пробы, которые вообще помещаются в сетку
function* sizeCandidates(from, width, height, scales) {
  for (const scale of scales) {
    const [w, h] = [from.w, from.h].map((side) => Math.max(1, Math.round(side * scale)));
    const kw = cellsFor(w, width);
    const kh = cellsFor(h, height);
    if (kw <= GRID && kh <= GRID) yield { w, h, kw, kh };
  }
}

/* Пустой прямоугольник клеток ищется по суммам с префиксами, чтобы не гонять
   полный перебор на каждый размер. Счёт владельцев читается сразу и целиком
   (не перебираемый owners — ошибка). Возвращает функцию (kw, kh) → [col, row] | null,
   первое место «построчно сверху». */
function emptyRectFinder(owners) {
  const counts = [...owners];
  const stride = GRID + 1;
  const sums = new Int32Array(stride * stride);
  for (const row of range(0, GRID)) {
    let running = 0;
    for (const col of range(0, GRID)) {
      running += counts[row * GRID + col] ? 1 : 0;
      sums[(row + 1) * stride + col + 1] = sums[row * stride + col + 1] + running;
    }
  }
  const busy = (col, row, kw, kh) =>
    sums[(row + kh) * stride + col + kw] -
    sums[row * stride + col + kw] -
    sums[(row + kh) * stride + col] +
    sums[row * stride + col];

  return (kw, kh) => {
    for (const row of range(0, GRID - kh + 1)) {
      for (const col of range(0, GRID - kw + 1)) {
        if (!busy(col, row, kw, kh)) return [col, row];
      }
    }
    return null;
  };
}

export const placeBox = (layout, box, width, height, scales = PROBE_SCALES) => {
  const from = layout && box ? islandRect(box, width, height) : null;
  if (!from || degenerate(from)) return null;

  const finder = emptyRectFinder(layout.owners);
  for (const { w, h, kw, kh } of sizeCandidates(from, width, height, scales)) {
    const spot = finder(kw, kh);
    if (spot) {
      const to = { x: pointOfCell(spot[0], width), y: pointOfCell(spot[1], height), w, h };
      return { from, to };
    }
  }
  return null;
};

export const freePlace = (layout, key, width, height, scales = PROBE_SCALES) => {
  const island = lookup(layout, key);
  return island && !island.tiled ? placeBox(layout, island.box, width, height, scales) : null;
};

/* ---------- перенос точек развёртки ---------- */

// одна ось: отношение размеров, затем сдвиг от начала, затем сумма и деление на лист
function shiftAxis(value, sheet, src, dst) {
  const ratio = dst.size / src.size;
  const offset = value * sheet - src.start;
  return (dst.start + offset * ratio) / sheet;
}

const spanOf = (rect, start, size) => ({ start: rect[start], size: rect[size] });

function warp(record, u, v, srcName, dstName) {
  const {
    size: [width, height],
  } = record;
  const [src, dst] = [record[srcName], record[dstName]];
  return [
    shiftAxis(u, width, spanOf(src, 'x', 'w'), spanOf(dst, 'x', 'w')),
    shiftAxis(v, height, spanOf(src, 'y', 'h'), spanOf(dst, 'y', 'h')),
  ];
}

export const mapUv = (record, u, v) => warp(record, u, v, 'from', 'to');

export const unmapUv = (record, u, v) => warp(record, u, v, 'to', 'from');

/* ---------- занятость клеток ---------- */

// клетки по одной оси: [первая, за последней); пустой отрезок даёт одну клетку
function axisCells(origin, length, sheet) {
  const scaled = (n) => (n * GRID) / sheet;
  const first = clampCell(Math.floor(scaled(origin)));
  const last = clampCell(Math.ceil(scaled(origin + length)));
  return [first, Math.max(last, first + 1)];
}

function* rectCells(rect, width, height) {
  const [colFrom, colTo] = axisCells(rect.x, rect.w, width);
  const [rowFrom, rowTo] = axisCells(rect.y, rect.h, height);
  for (const row of range(rowFrom, rowTo)) {
    for (const col of range(colFrom, colTo)) yield row * GRID + col;
  }
}

export const reserveRect = (layout, rect, width, height, visit = null) => {
  if (!(layout && rect)) return;
  const { owners } = layout;
  for (const cell of rectCells(rect, width, height)) {
    credit(owners, cell);
    visit?.(cell);
  }
};

export function moveIsland(layout, key, record) {
  const island = lookup(layout, key);
  if (!island) return;

  island.cells.forEach((cell) => release(layout.owners, cell));
  const landed = new Set();
  island.cells = landed;
  const {
    to,
    size: [sheetW, sheetH],
  } = record;
  reserveRect(layout, to, sheetW, sheetH, (cell) => landed.add(cell));

  const [low, high] = [island.box.slice(0, 2), island.box.slice(2)];
  island.box = [...mapUv(record, ...low), ...mapUv(record, ...high)];
}

/* ---------- часть большого острова около мазка ---------- */

export const detachReach = (brushSize = DEFAULT_BRUSH) => {
  const size = Math.max(Number(brushSize) || DEFAULT_BRUSH, 1);
  const radius = (size / 100) * 0.5;
  return Math.max(radius * REACH_FACTOR, REACH_FLOOR);
};

function* triangleBounds(uvs, count) {
  for (const t of range(0, count)) yield [t, boundsOf(cornersOf(uvs, t))];
}

// треугольник, чья рамка ближе всех к точке (меньший номер при равенстве)
function nearestTriangle(uvs, count, u, v) {
  let best = Infinity;
  let found = -1;
  for (const [t, [minU, minV, maxU, maxV]] of triangleBounds(uvs, count)) {
    const distance = Math.max(minU - u, 0, u - maxU) + Math.max(minV - v, 0, v - maxV);
    if (distance < best) [best, found] = [distance, t];
  }
  return found;
}

// ключ вершины → номера треугольников с этой вершиной (по возрастанию)
function trianglesByVertex(keys, count) {
  const groups = new Map();
  for (const slot of range(0, count * 3)) {
    const id = keys[slot];
    const list = groups.get(id) ?? [];
    list.push(Math.floor(slot / 3));
    groups.set(id, list);
  }
  return groups;
}

// очередь обхода в ширину: перебирается по мере роста, повторов не пускает
class Frontier {
  constructor(seed) {
    this.items = [seed];
    this.known = new Set(this.items);
  }

  offer(t) {
    if (this.known.has(t)) return;
    this.known.add(t);
    this.items.push(t);
  }

  *[Symbol.iterator]() {
    for (let at = 0; at < this.items.length; at += 1) yield this.items[at];
  }
}

export const partTriangles = (options) => {
  const { uvs, keys, u, v } = options;
  const { start = -1, reach = 0 } = options;
  const { length } = uvs;
  const count = Math.floor(length / 6);
  if (!(count > 0)) return [];

  const inReach = (t) => {
    if (!(reach > 0)) return true;
    const [minU, minV, maxU, maxV] = boundsOf(cornersOf(uvs, t));
    return [maxU >= u - reach, minU <= u + reach, maxV >= v - reach, minV <= v + reach].every(Boolean);
  };

  const groups = trianglesByVertex(keys, count);
  const seed = start >= 0 && start < count ? start : nearestTriangle(uvs, count, u, v);
  const frontier = new Frontier(seed);
  const [covered, taken] = [new Set(), []];

  for (const t of frontier) {
    if (!inReach(t)) continue;
    const inner = strictCellsOf(cornersOf(uvs, t));
    const clash = inner.some((cell) => covered.has(cell));
    if (clash) continue;
    inner.forEach((cell) => covered.add(cell));
    taken.push(t);
    for (const corner of range(0, 3)) {
      const linked = groups.get(keys[t * 3 + corner]);
      linked?.forEach((next) => frontier.offer(next));
    }
  }
  return taken.sort(ascending);
};

/* ---------- рамка и признак «плитка» ---------- */

export const trianglesBox = (uvs) => {
  const box = emptyBox();
  for (const at of range(1, uvs.length, 2)) {
    const [u, v] = [uvs[at - 1], uvs[at]];
    growBox(box, [u, v, u, v]);
  }
  return box;
};

export function boxTiled([u0, v0, u1, v1]) {
  const outside = [u0 < -TILE_SLACK, v0 < -TILE_SLACK, u1 > 1 + TILE_SLACK, v1 > 1 + TILE_SLACK];
  return outside.some(Boolean);
}

/* ---------- отрезки номеров треугольников ---------- */

export const packTriangles = (list) =>
  [...list].sort(ascending).reduce((ranges, n) => {
    const tail = ranges.at(-1);
    const end = tail && tail[0] + tail[1];
    if (!tail || n > end) ranges.push([n, 1]);
    else if (n === end) tail[1] += 1;
    return ranges;
  }, []);

export function* unpackTriangles(ranges) {
  const source = ranges ?? [];
  for (const piece of source) {
    const [first, amount] = piece;
    let step = 0;
    while (step < amount) {
      yield first + step;
      step += 1;
    }
  }
}

/* ---------- картинки кусков на один лист ---------- */

// «полки»: куски слева направо, не влезло — новая полка ниже
class ShelfCursor {
  constructor(width, gap) {
    this.width = width;
    this.gap = gap;
    this.x = gap;
    this.y = gap;
    this.shelf = 0;
  }

  wrap() {
    this.x = this.gap;
    this.y += this.shelf + this.gap;
    this.shelf = 0;
  }

  place({ w, h }) {
    if (this.x + w + this.gap > this.width) this.wrap();
    const spot = { x: this.x, y: this.y };
    this.x += w + this.gap;
    this.shelf = Math.max(this.shelf, h);
    return spot;
  }

  get height() {
    return pow2(this.y + this.shelf + this.gap);
  }
}

function* doubling(first, limit) {
  for (let width = first; width <= limit; width *= 2) yield width;
}

function* shrinkSteps() {
  for (let scale = 1; scale >= SHRINK_STOP; scale *= SHRINK_STEP) yield scale;
}

// укладка по порядку order на лист заданной ширины; places — в порядке входа
function layOut(fitted, order, width, gap) {
  const cursor = new ShelfCursor(width, gap);
  const places = [];
  order.forEach((index) => {
    places[index] = cursor.place(fitted[index]);
  });
  const height = cursor.height;
  return { width, height, places, area: width * height };
}

// из годных ширин — лист с наименьшей площадью (при равенстве первый)
function tightestSheet(fitted, order, margin, maxSide, gap) {
  return [...doubling(pow2(margin), maxSide)]
    .map((width) => layOut(fitted, order, width, gap))
    .filter((sheet) => !(sheet.height > maxSide))
    .reduce((best, sheet) => (!best || sheet.area < best.area ? sheet : best), null);
}

export const packCrops = (sizes, { maxSide = SHEET_SIDE, gap = SHEET_GAP } = {}) => {
  const total = sizes?.length;
  if (!total) return null;

  const descendingBy = (pick) => (a, b) => pick(sizes[b]) - pick(sizes[a]);
  const [taller, wider] = [descendingBy((piece) => piece.h), descendingBy((piece) => piece.w)];
  const order = Array.from(sizes.keys()).sort((a, b) => taller(a, b) || wider(a, b));

  for (const scale of shrinkSteps()) {
    const shrink = (side) => Math.max(1, Math.ceil(side * scale));
    const fitted = sizes.map(({ w, h }) => ({ w: shrink(w), h: shrink(h) }));
    const widest = fitted.reduce((wide, piece) => Math.max(wide, piece.w), -Infinity);
    const sheet = tightestSheet(fitted, order, widest + 2 * gap, maxSide, gap);
    if (sheet) {
      const { width, height, places } = sheet;
      return { width, height, scale, places };
    }
  }
  return null;
};

/* ---------- константы ---------- */

const sealed = (...list) => Object.freeze(list);

const GRID = 512;
const PAD = 2;
const MIN_SCALE = 0.25;
const WHOLE_SCALES = sealed(1, 0.75, 0.5);
const SMALL_SCALES = sealed(0.35, 0.25);
const SPLIT_BASE = 2 ** 20;
const MAX_PARTS = 32;
const MAX_VERTICES = 6000;

const PROBE_SCALES = [...WHOLE_SCALES, ...SMALL_SCALES];
const OVERLAP_RULE = { cells: 4, ratio: 0.05 };
const SEARCH_MARGIN = 1 + 2 * PAD;
const OWNER_CAP = 65535;
const INNER_EPS = 0.000001;
const TILE_SLACK = 0.002;
const DEFAULT_BRUSH = 8;
const REACH_FACTOR = 1.5;
const REACH_FLOOR = 16 / GRID;
const SHEET_SIDE = 1024;
const SHEET_GAP = 2;
const SHRINK_STEP = 0.8;
const SHRINK_STOP = 0.05;

export {
  GRID as DETACH_GRID,
  PAD as DETACH_PAD,
  MIN_SCALE as DETACH_MIN_SCALE,
  WHOLE_SCALES as DETACH_WHOLE_SCALES,
  SMALL_SCALES as DETACH_SMALL_SCALES,
  SPLIT_BASE as DETACH_SPLIT_BASE,
  MAX_PARTS as DETACH_MAX_PARTS,
  MAX_VERTICES as DETACH_MAX_VERTICES,
};
