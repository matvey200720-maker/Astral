// Части вещи сцены: деление на предметы, «какая часть под щелчком», память сцены и фоновый поток.
import { cutItemParts } from "./item-part-cut.js";

const AXES = [0, 1, 2];
const WELD = 0.002;
const KEY_WIDTH = 65536;
const CELL_STRIDE = [1, 4096, 16777216];
const POINT_BUDGET = 400000;
const BATCH_LIMIT = 120000;
const IDLE_WAIT = 1500;

export const PART_GAP = 0.2;

// Сдвиги ключа к «впередсмотрящим» соседним ячейкам; остальные из 26 обходятся с другой стороны.
const FORWARD_SHIFTS = [-1, 0, 1]
  .flatMap((dz) =>
    [-1, 0, 1].flatMap((dy) =>
      [-1, 0, 1].map((dx) => dx * CELL_STRIDE[0] + dy * CELL_STRIDE[1] + dz * CELL_STRIDE[2]),
    ),
  )
  .filter((shift) => shift > 0);

// ───────────────────────── деление вещи на части ─────────────────────────

// Непересекающиеся множества; корень — наименьший номер множества, этим пользуются нумераторы.
function disjoint(size) {
  const up = new Int32Array(size).map((_, at) => at);
  const root = (start) => {
    let top = start;
    while (up[top] !== top) top = up[top];
    let at = start;
    while (at !== top) {
      const next = up[at];
      up[at] = top;
      at = next;
    }
    return top;
  };
  const join = (a, b) => {
    const ra = root(a);
    const rb = root(b);
    if (ra === rb) return false;
    up[Math.max(ra, rb)] = Math.min(ra, rb);
    return true;
  };
  return { root, join };
}

const usable = (mesh) => Boolean(mesh?.positions?.length) && (mesh.indices?.length ?? 0) >= 3;
const facesIn = (mesh) => Math.floor(mesh.indices.length / 3);
const lists = (size) => Array.from({ length: size }, () => []);
// Список не массив — TypeError (у строки и объекта с длиной нет filter).
const onlyUsable = (meshes) => (meshes || []).filter(usable);

// «Суп» треугольников: девять чисел на треугольник подряд по сеткам списка (нет вершины — NaN).
function triangleSoup(meshes) {
  const lot = onlyUsable(meshes);
  const counts = lot.map(facesIn);
  const total = counts.reduce((sum, faces) => sum + faces, 0);
  const soup = new Float64Array(total * 9);
  let out = 0;
  lot.forEach(({ positions, indices }, m) => {
    for (let slot = 0; slot < counts[m] * 3; slot += 1) {
      const base = indices[slot] * 3;
      soup[out] = positions[base];
      soup[out + 1] = positions[base + 1];
      soup[out + 2] = positions[base + 2];
      out += 3;
    }
  });
  return { lot, counts, total, soup };
}

// Наименьший угол по всем вершинам всех сеток (даже не вошедшим в треугольники), минус отступ.
function lowestCorner(lot, pad) {
  const low = Array(3).fill(Infinity);
  for (const { positions } of lot) {
    const whole = positions.length - (positions.length % 3);
    for (let at = 0; at < whole; at += 1) {
      if (positions[at] < low[at % 3]) low[at % 3] = positions[at];
    }
  }
  return low.map((value) => value - pad);
}

const snapToWeld = (value, origin) => Math.round((value - origin) / WELD);
const fitsKey = (n) => n >= 0 && n < KEY_WIDTH;

// Ключ склеенной вершины; null, если координат нет. Дальше 131 м от начала ключ — строка.
function weldKey(soup, at, floor) {
  const x = snapToWeld(soup[at], floor[0]);
  const y = snapToWeld(soup[at + 1], floor[1]);
  const z = snapToWeld(soup[at + 2], floor[2]);
  if (Number.isNaN(x + y + z)) return null;
  return fitsKey(x) && fitsKey(y) && fitsKey(z) ? (z * KEY_WIDTH + y) * KEY_WIDTH + x : `${x},${y},${z}`;
}

// Треугольники с общей склеенной вершиной (в пределах одной сетки) — одно множество.
function weldTriangles({ counts, total, soup, floor }) {
  const tied = disjoint(total);
  let first = 0;
  for (const faces of counts) {
    const seen = new Map();
    for (let slot = first * 3; slot < (first + faces) * 3; slot += 1) {
      const key = weldKey(soup, slot * 3, floor);
      if (key === null) continue;
      const g = Math.floor(slot / 3);
      const owner = seen.get(key);
      if (owner === undefined) seen.set(key, g);
      else tied.join(owner, g);
    }
    first += faces;
  }
  return tied;
}

// Остров = множество; номера по порядку первого треугольника, то есть по возрастанию корней.
function numberIslands(model, tied) {
  const roots = Int32Array.from({ length: model.total }, (_, g) => tied.root(g));
  const rank = new Int32Array(model.total);
  let count = 0;
  roots.forEach((root, g) => {
    rank[g] = count;
    if (root === g) count += 1;
  });
  model.label = roots.map((root) => rank[root]);
  model.count = count;
}

function boxIslands(model) {
  const { soup, label, count } = model;
  const lo = new Float64Array(count * 3).fill(Infinity);
  const hi = new Float64Array(count * 3).fill(-Infinity);
  for (let at = 0; at < soup.length; at += 1) {
    const slot = label[Math.floor(at / 9)] * 3 + (at % 3);
    if (soup[at] < lo[slot]) lo[slot] = soup[at];
    if (soup[at] > hi[slot]) hi[slot] = soup[at];
  }
  model.lo = lo;
  model.hi = hi;
}

// Острова, чьи рамки по каждой оси не дальше gap друг от друга; обход по возрастанию x.
function neighboursOf({ lo, hi, count, gap }) {
  const near = lists(count);
  const order = [...Array(count).keys()].sort((a, b) => (lo[a * 3] > lo[b * 3]) - (lo[a * 3] < lo[b * 3]));
  const closeOn = (a, b, axis) =>
    lo[a * 3 + axis] - hi[b * 3 + axis] <= gap && lo[b * 3 + axis] - hi[a * 3 + axis] <= gap;
  order.forEach((a, s) => {
    for (let t = s + 1; t < count && lo[order[t] * 3] - hi[a * 3] <= gap; t += 1) {
      const b = order[t];
      if (closeOn(a, b, 1) && closeOn(a, b, 2)) {
        near[a].push(b);
        near[b].push(a);
      }
    }
  });
  return near;
}

// Рамки — шесть чисел: три нижних, три верхних.
const paddedBox = (lo, hi, island, pad) => {
  const at = island * 3;
  return [lo[at] - pad, lo[at + 1] - pad, lo[at + 2] - pad, hi[at] + pad, hi[at + 1] + pad, hi[at + 2] + pad];
};
const holdsPoint = (box, x, y, z) =>
  x >= box[0] && x <= box[3] && y >= box[1] && y <= box[4] && z >= box[2] && z <= box[5];
const meetsBox = (box, other) =>
  other[0] <= box[3] && other[3] >= box[0] && other[1] <= box[4] && other[4] >= box[1] && other[2] <= box[5] && other[5] >= box[2];

function insideZone(zone, x, y, z) {
  for (const box of zone) if (holdsPoint(box, x, y, z)) return true;
  return false;
}

// Рамка треугольника g во временном буфере (не переживает следующего вызова).
const scratchBox = new Float64Array(6);
function triangleBox(soup, g) {
  scratchBox.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let at = g * 9; at < g * 9 + 9; at += 1) {
    const axis = at % 3;
    if (soup[at] < scratchBox[axis]) scratchBox[axis] = soup[at];
    if (soup[at] > scratchBox[axis + 3]) scratchBox[axis + 3] = soup[at];
  }
  return scratchBox;
}

const edgeSquared = (soup, at, p, q) =>
  AXES.reduce((sum, axis) => {
    const d = soup[at + p * 3 + axis] - soup[at + q * 3 + axis];
    return sum + d * d;
  }, 0);
const longestEdge = (soup, g) =>
  Math.sqrt(Math.max(edgeSquared(soup, g * 9, 0, 1), edgeSquared(soup, g * 9, 1, 2), edgeSquared(soup, g * 9, 2, 0)));
const stepsFor = (edge, spacing) => Math.max(1, Math.ceil(edge / spacing));

// Для островов с соседями: зона (раздутые рамки соседей) и треугольники, что до неё достают.
function pickTriangles(model, near) {
  const { soup, label, lo, hi, gap } = model;
  const members = near.map((friends) => (friends.length ? [] : null));
  label.forEach((island, g) => members[island]?.push(g));
  return near.flatMap((friends, island) => {
    if (!friends.length) return [];
    const zone = friends.map((friend) => paddedBox(lo, hi, friend, gap));
    const picked = members[island].filter((g) => {
      const box = triangleBox(soup, g);
      return zone.some((area) => meetsBox(area, box));
    });
    return [{ island, zone, picked, edges: picked.map((g) => longestEdge(soup, g)) }];
  });
}

// Шаг точек: gap / 2, а когда точек по оценке больше предела — крупнее, но не больше gap.
function chooseSpacing(jobs, gap) {
  const estimate = jobs
    .flatMap((job) => job.edges)
    .reduce((sum, edge) => {
      const n = stepsFor(edge, gap / 2);
      return sum + ((n + 1) * (n + 2)) / 2;
    }, 0);
  return estimate > POINT_BUDGET ? Math.min(gap, (gap / 2) * Math.sqrt(estimate / POINT_BUDGET)) : gap / 2;
}

// Точки треугольника g: строка за строкой решётка I + J <= n.
function walkLattice(soup, g, n, emit) {
  const at = g * 9;
  let i = 0;
  let j = 0;
  while (i <= n) {
    const u = i / n;
    const v = j / n;
    const w = 1 - u - v;
    emit(
      soup[at] * w + soup[at + 3] * u + soup[at + 6] * v,
      soup[at + 1] * w + soup[at + 4] * u + soup[at + 7] * v,
      soup[at + 2] * w + soup[at + 5] * u + soup[at + 8] * v,
    );
    if (i + j < n) {
      j += 1;
    } else {
      i += 1;
      j = 0;
    }
  }
}

// Точки поверхности внутри зон, без повторов в пределах острова.
function sampleSurface({ soup, floor }, jobs, spacing) {
  const half = spacing / 2;
  const snap = (value, axis) => Math.round((value - floor[axis]) / half);
  const cloud = { xs: [], ys: [], zs: [], owner: [] };
  for (const { island, zone, picked, edges } of jobs) {
    const taken = new Set();
    const keep = (x, y, z) => {
      if (!insideZone(zone, x, y, z)) return;
      const key = (snap(z, 2) * KEY_WIDTH + snap(y, 1)) * KEY_WIDTH + snap(x, 0);
      if (taken.has(key)) return;
      taken.add(key);
      cloud.xs.push(x);
      cloud.ys.push(y);
      cloud.zs.push(z);
      cloud.owner.push(island);
    };
    picked.forEach((g, nth) => walkLattice(soup, g, stepsFor(edges[nth], spacing), keep));
  }
  return cloud;
}

// Точки по ячейкам со стороной gap; острова с точками не дальше gap склеиваются в `merged`.
function linkClosePoints({ floor, gap }, cloud, groups, merged) {
  const { xs, ys, zs, owner } = cloud;
  const cellCoord = (value, axis) => Math.floor((value - floor[axis]) / gap) + 1;
  const ids = new Map();
  const cellKeys = [];
  const cellOf = Int32Array.from(xs, (x, p) => {
    const key = cellCoord(x, 0) * CELL_STRIDE[0] + cellCoord(ys[p], 1) * CELL_STRIDE[1] + cellCoord(zs[p], 2) * CELL_STRIDE[2];
    if (!ids.has(key)) {
      ids.set(key, cellKeys.length);
      cellKeys.push(key);
    }
    return ids.get(key);
  });
  // Точки одной ячейки лежат подряд в items[starts[c] .. starts[c + 1]).
  const starts = new Int32Array(cellKeys.length + 1);
  cellOf.forEach((cell) => {
    starts[cell + 1] += 1;
  });
  for (let c = 0; c < cellKeys.length; c += 1) starts[c + 1] += starts[c];
  const fill = starts.slice(0, -1);
  const items = new Int32Array(xs.length);
  cellOf.forEach((cell, p) => {
    items[fill[cell]] = p;
    fill[cell] += 1;
  });
  const limit = gap * gap;
  const coords = [xs, ys, zs];
  const apartSquared = (a, b) => {
    let sum = 0;
    for (const line of coords) {
      const d = line[a] - line[b];
      sum += d * d;
    }
    return sum;
  };
  let separate = groups;
  // true, когда склеено всё.
  const meet = (a, b) => {
    if (owner[a] === owner[b]) return false;
    if (apartSquared(a, b) > limit || !merged.join(owner[a], owner[b])) return false;
    separate -= 1;
    return separate === 1;
  };
  const scan = (a, b) => {
    for (let i = starts[a]; i < starts[a + 1]; i += 1) {
      for (let k = a === b ? i + 1 : starts[b]; k < starts[b + 1]; k += 1) {
        if (meet(items[i], items[k])) return true;
      }
    }
    return false;
  };
  const visit = (cell) => {
    if (scan(cell, cell)) return true;
    for (const shift of FORWARD_SHIFTS) {
      const other = ids.get(cellKeys[cell] + shift);
      if (other !== undefined && scan(cell, other)) return true;
    }
    return false;
  };
  cellKeys.some((_, cell) => visit(cell));
}

function mergeNearby(model, merged) {
  const jobs = pickTriangles(model, neighboursOf(model));
  if (jobs.length === 0) return;
  linkClosePoints(model, sampleSurface(model, jobs, chooseSpacing(jobs, model.gap)), jobs.length, merged);
}

// Острова -> части (в порядке первой встречи), диапазоны треугольников, рамки, сортировка по середине.
function composeParts({ lot, counts, label, count, lo, hi }, merged) {
  const roots = Int32Array.from({ length: count }, (_, island) => merged.root(island));
  const rank = new Int32Array(count);
  let partCount = 0;
  roots.forEach((root, island) => {
    rank[island] = partCount;
    if (root === island) partCount += 1;
  });
  const partOf = roots.map((root) => rank[root]);
  const tails = Array.from({ length: partCount }, () => ({
    faces: 0,
    mesh: -1,
    end: 0,
    spans: [],
    low: [Infinity, Infinity, Infinity],
    high: [-Infinity, -Infinity, -Infinity],
  }));
  partOf.forEach((part, island) => {
    const { low, high } = tails[part];
    for (const axis of AXES) {
      low[axis] = Math.min(low[axis], lo[island * 3 + axis]);
      high[axis] = Math.max(high[axis], hi[island * 3 + axis]);
    }
  });
  let g = 0;
  lot.forEach((mesh, m) => {
    for (let face = 0; face < counts[m]; face += 1, g += 1) {
      const tail = tails[partOf[label[g]]];
      tail.faces += 1;
      if (tail.mesh === m && tail.end === face) tail.spans[tail.spans.length - 1] = face + 1;
      else tail.spans.push(mesh.meshIndex, face, face + 1);
      tail.mesh = m;
      tail.end = face + 1;
    }
  });
  return tails
    .map((tail) => ({ tail, centi: AXES.map((axis) => Math.round(((tail.low[axis] + tail.high[axis]) / 2) * 100)) }))
    .sort((a, b) => a.centi[0] - b.centi[0] || a.centi[1] - b.centi[1] || a.centi[2] - b.centi[2])
    .map(({ tail }, index) => ({
      index,
      triangles: tail.faces,
      runs: Int32Array.from(tail.spans),
      min: tail.low,
      max: tail.high,
    }));
}

export function splitItemParts(meshes, options = {}) {
  const { gap = PART_GAP } = options;
  const model = triangleSoup(meshes);
  if (!model.lot.length) return [];
  // Порог не положительный (0, минус, null, NaN) — по близости не склеиваем.
  const proximity = gap > 0;
  model.gap = gap;
  model.floor = lowestCorner(model.lot, proximity ? gap : 0);
  numberIslands(model, weldTriangles(model));
  boxIslands(model);
  const merged = disjoint(model.count);
  if (proximity && model.count > 1) mergeNearby(model, merged);
  return composeParts(model, merged);
}

// Есть ли среди троек «сетка, от, до» та, что содержит треугольник face сетки mesh.
function covers(spans, mesh, face) {
  let at = 0;
  while (at + 3 <= spans.length && !(spans[at] === mesh && face >= spans[at + 1] && face < spans[at + 2])) at += 3;
  return at + 3 <= spans.length;
}

export const partAt = (parts, meshIndex, faceIndex) => {
  if (!parts || ![meshIndex, faceIndex].every(Number.isInteger)) return -1;
  for (const part of parts) {
    if (covers(part.own || part.runs, meshIndex, faceIndex)) return part.index;
  }
  return -1;
};

// ───────────────────────── память сцены и поток ─────────────────────────

const scenes = new WeakMap();

// Сетки вещей сцены, их части и вещи, ждущие поток.
class SceneStore {
  constructor(meshes) {
    this.byKey = new Map();
    this.parts = new Map();
    this.waiting = new Set();
    meshes.forEach(({ entity, positions, indices }, meshIndex) => {
      if (!Number.isInteger(entity)) return;
      if (!this.byKey.has(entity)) this.byKey.set(entity, []);
      this.byKey.get(entity).push({ meshIndex, positions, indices });
    });
  }

  static of(asset) {
    if (!scenes.has(asset)) scenes.set(asset, new SceneStore(asset.meshes));
    return scenes.get(asset);
  }

  needs(key) {
    return ![this.parts, this.waiting].some((book) => book.has(key));
  }

  // Окно делит вещь само.
  computeHere(key, place) {
    const meshes = this.byKey.get(key);
    this.parts.set(key, cutItemParts(meshes, splitItemParts(meshes), place));
    return this.parts.get(key);
  }

  // Частей в памяти нет: вещи нет — [], ждёт поток — null, иначе просим поток или считаем сами.
  fetch(key, place) {
    if (!this.byKey.has(key)) return [];
    if (this.waiting.has(key)) return null;
    if (!channel.open()) return this.computeHere(key, place);
    channel.post(this, [{ key, place }]);
    return null;
  }
}

const snapshot = (mesh) => ({ ...mesh, positions: mesh.positions.slice(), indices: mesh.indices.slice() });

// Один поток частей на окно: сообщения, ответы, версия, подписчики.
class PartsChannel {
  constructor() {
    this.worker = null;
    this.broken = false;
    this.serial = 0;
    this.jobs = new Map();
    this.version = 0;
    this.listeners = new Set();
  }

  open() {
    if (this.worker) return this.worker;
    if (this.broken || typeof Worker === "undefined") return null;
    try {
      this.worker = new Worker(new URL("./item-parts-worker.js", import.meta.url), { type: "module" });
    } catch {
      this.broken = true;
      return null;
    }
    this.worker.onmessage = (event) => this.receive(event);
    this.worker.onerror = () => this.fail();
    return this.worker;
  }

  // Одно сообщение потоку; обещание кончается, когда ответ разобран (в том числе отклонён).
  post(store, rows) {
    this.serial += 1;
    const id = this.serial;
    return new Promise((resolve) => {
      const keys = rows.map((row) => row.key);
      const settle = () => {
        keys.forEach((key) => store.waiting.delete(key));
        resolve();
      };
      this.jobs.set(id, { store, settle });
      keys.forEach((key) => store.waiting.add(key));
      try {
        this.worker.postMessage({
          id,
          entities: rows.map(({ key, place }) => {
            const meshes = store.byKey.get(key).map(snapshot);
            return { key, place: place || null, meshes };
          }),
          gap: PART_GAP,
        });
      } catch {
        this.jobs.delete(id);
        settle();
      }
    });
  }

  accept(store, entities) {
    [...entities].forEach(({ key, parts }) => store.parts.set(key, parts));
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  receive(event) {
    const message = event?.data;
    const job = message ? this.jobs.get(message.id) : undefined;
    if (!job) return;
    this.jobs.delete(message.id);
    try {
      if (!message.error) this.accept(job.store, message.entities);
    } catch {
      // отклонённая задача молчит: версия и части остаются как были
    } finally {
      job.settle();
    }
  }

  fail() {
    this.broken = true;
    this.worker = null;
    const pending = [...this.jobs.values()];
    this.jobs.clear();
    pending.forEach((job) => job.settle());
  }
}

const channel = new PartsChannel();

export function itemPartsOf(asset, key, place = null) {
  const store = asset?.meshes && Number.isInteger(key) ? SceneStore.of(asset) : null;
  if (!store) return [];
  return store.parts.get(key) || store.fetch(key, place);
}

export const itemPartsVersion = () => channel.version;

export function subscribeItemParts(listener) {
  channel.listeners.add(listener);
  return () => channel.listeners.delete(listener);
}

// Вещи без частей и не из skip, самые тяжёлые первыми (равные — в порядке сцены).
const rankForWarming = (store, skip) =>
  [...store.byKey]
    .filter(([key]) => !store.parts.has(key) && !(skip && skip.has(key)))
    .map(([key, meshes]) => ({ key, weight: meshes.reduce((sum, mesh) => sum + facesIn(mesh), 0) }))
    .sort((a, b) => (a.weight < b.weight) - (a.weight > b.weight));

// Порции не больше BATCH_LIMIT треугольников; первая вещь порции входит всегда.
const packBatches = (rows) =>
  rows.reduce((batches, row) => {
    const last = batches[batches.length - 1];
    if (last && last.load + row.weight <= BATCH_LIMIT) {
      last.rows.push(row);
      last.load += row.weight;
    } else {
      batches.push({ rows: [row], load: row.weight });
    }
    return batches;
  }, []);

const noPlace = () => null;

export function warmItemParts(asset, options = {}) {
  const { skip = null, placeOf = noPlace } = options;
  let stopped = false;
  const cancel = () => {
    stopped = true;
    return true;
  };
  if (!asset?.meshes?.length || !channel.open()) return cancel;
  const store = SceneStore.of(asset);
  const batches = packBatches(rankForWarming(store, skip));
  // Порции идут по одной: следующая — после разбора ответа на предыдущую.
  const advance = async (at) => {
    if (at >= batches.length || stopped || channel.broken) return;
    const fresh = batches[at].rows.filter(({ key }) => store.needs(key));
    if (fresh.length) await channel.post(store, fresh.map((row) => ({ place: placeOf(row.key), key: row.key })));
    await advance(at + 1);
  };
  const start = () => advance(0);
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(start, { timeout: IDLE_WAIT });
  } else {
    setTimeout(start, 0);
  }
  return cancel;
}
