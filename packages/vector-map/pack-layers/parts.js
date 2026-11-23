// Геометрический «нижний этаж» разборщика слоёв пака: деление групп на основу
// и слой поверх радара, связные куски, их признаки, контуры и мелкие помощники.
// Горячие пути (ключи вершин, куски, контуры, признаки) — плотные циклы по плоским массивам.

// Группа не выше этой высоты — основа (радар), строго выше — слой поверх него.
export const PACK_OVERLAY_FROM = 12.95;

const GRID_STEP = 8;
const GRID_SHIFT = 65536;
const GRID_ROW = 262144;
const CELL_STRIDE = 100003;
const TWO_PI = 2 * Math.PI;
const TINT_CEILING = 0.35 * 255;
const DOT = { maxLong: 60, ratio: 1.15, minFill: 0.7, maxFill: 0.86, solidity: 0.93, minTris: 6 };

// ---------- сетка вершин и союз-поиск ----------

// Две вершины — одна, если совпали ячейки сетки в одну восьмую метра.
export function vertexKey(x, y) {
  const col = Math.round(x * GRID_STEP + GRID_SHIFT);
  return col * GRID_ROW + Math.round(y * GRID_STEP + GRID_SHIFT);
}

// Корень множества с укорачиванием пути; индекс вне массива корня не имеет.
function rootOf(parent, start) {
  if (parent[start] === undefined) return undefined;
  let i = start;
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

// Корнем объединения становится меньший из двух корней.
function mergeRoots(parent, a, b) {
  const ra = rootOf(parent, a);
  const rb = rootOf(parent, b);
  if (ra === undefined || rb === undefined) return;
  parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
}

// Группы по корням: внутри по возрастанию, сами группы — по первому элементу.
function collectGroups(parent) {
  const slot = new Int32Array(parent.length).fill(-1);
  const groups = [];
  for (let i = 0; i < parent.length; i++) {
    const root = rootOf(parent, i);
    if (slot[root] >= 0) {
      groups[slot[root]].push(i);
    } else {
      slot[root] = groups.length;
      groups.push([i]);
    }
  }
  return groups;
}

// Союз-поиск на count элементах (дробный count усекается, отрицательный — RangeError).
export function unionFind(count) {
  const parent = new Int32Array(count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  return {
    find: (i) => rootOf(parent, i),
    join: (a, b) => mergeRoots(parent, a, b),
    groups: () => collectGroups(parent),
  };
}

// Вершина (x, y) треугольника tri: первый встретивший её запоминается, остальные склеиваются с ним.
function linkCorner(owner, parent, tri, x, y) {
  const key = vertexKey(x, y);
  const first = owner.get(key) ?? -1;
  if (first < 0) owner.set(key, tri);
  else mergeRoots(parent, tri, first);
}

// Связные куски: треугольники с общей вершиной (по ключу) — один кусок.
export function componentsOf(positions) {
  const count = positions.length / 6;
  const parent = new Int32Array(count);
  const size = parent.length;
  for (let i = 0; i < size; i++) parent[i] = i;
  const owner = new Map();
  for (let tri = 0, at = 0; tri < size; tri += 1, at += 6) {
    linkCorner(owner, parent, tri, positions[at], positions[at + 1]);
    linkCorner(owner, parent, tri, positions[at + 2], positions[at + 3]);
    linkCorner(owner, parent, tri, positions[at + 4], positions[at + 5]);
  }
  const pieces = collectGroups(parent);
  // Неполный хвост получает номер, но ни с чем не склеивается.
  const whole = Math.floor(count);
  return count > whole ? pieces.concat([[whole]]) : pieces;
}

// ---------- оболочка и повёрнутая рамка ----------

const byRow = (p, q) => p[0] - q[0] || p[1] - q[1];

// Направление от точки a к точке b.
const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

// Поворот o→a→b: знак — сторона, модуль — удвоенная площадь.
function turn(o, a, b) {
  const ux = a[0] - o[0];
  const uy = a[1] - o[1];
  return ux * (b[1] - o[1]) - uy * (b[0] - o[0]);
}

// Цепочка Эндрю по порядку (или в обратном порядке) обхода; последняя точка отбрасывается.
function sweepChain(sorted, backwards) {
  const n = sorted.length;
  const chain = new Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const p = sorted[backwards ? n - 1 - i : i];
    while (top > 1 && turn(chain[top - 2], chain[top - 1], p) <= 0) top -= 1;
    chain[top] = p;
    top += 1;
  }
  return chain.slice(0, top - 1);
}

export function hull(points) {
  const sorted = points.slice().sort(byRow);
  return sorted.length < 3 ? sorted : sweepChain(sorted, false).concat(sweepChain(sorted, true));
}

// Рамка из двух точек (или одной): нулевая толщина вдоль отрезка.
function segmentRect(a, b) {
  const end = b ?? a;
  const dx = end[0] - a[0];
  const dy = end[1] - a[1];
  return { long: Math.hypot(dx, dy), short: 0, angle: Math.atan2(dy, dx), cx: (a[0] + end[0]) / 2, cy: (a[1] + end[1]) / 2 };
}

// Точка кольца или оболочки, которая не массив: разбор по образцу (или отказ на пустом месте).
function splitAt(list, at) {
  const [x, y] = list[at];
  return [x, y];
}

// Вершины как пары [x, y]: настоящие массивы идут как есть, остальные разбирает образец по порядку.
function toPairs(vertices) {
  return vertices.every(Array.isArray) ? vertices : vertices.map((_, at) => splitAt(vertices, at));
}

// Рамка, повёрнутая на угол ребра: [площадь, угол, cos, sin, u0, u1, v0, v1] записываются в frame.
function framedBy(frame, pairs, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let lowU = Infinity,
    highU = -Infinity,
    lowV = Infinity,
    highV = -Infinity;
  for (let j = 0; j < pairs.length; j++) {
    const x = pairs[j][0];
    const y = pairs[j][1];
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    lowU = u < lowU ? u : lowU;
    highU = u > highU ? u : highU;
    lowV = v < lowV ? v : lowV;
    highV = v > highV ? v : highV;
  }
  frame[0] = (highU - lowU) * (highV - lowV);
  frame[1] = angle;
  frame[2] = cos;
  frame[3] = sin;
  frame[4] = lowU;
  frame[5] = highU;
  frame[6] = lowV;
  frame[7] = highV;
}

// Рамка наименьшей площади по готовой оболочке.
function rectOfHull(outline) {
  const n = outline.length;
  if (n < 3) return segmentRect(outline[0] ?? [0, 0], outline[1]);
  const pairs = toPairs(outline);
  let best = new Float64Array(8);
  let cand = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    framedBy(cand, pairs, heading(outline[i], outline[i + 1 < n ? i + 1 : 0]));
    // первое ребро побеждает всегда, следующие — только при строго меньшей площади
    if (i > 0 && !(cand[0] < best[0])) continue;
    const spare = best;
    best = cand;
    cand = spare;
  }
  const [, angle, c, s, u0, u1, v0, v1] = best;
  const width = u1 - u0;
  const height = v1 - v0;
  const wide = width >= height;
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  return {
    long: wide ? width : height,
    short: wide ? height : width,
    angle: wide ? angle : angle + Math.PI / 2,
    cx: uc * c - vc * s,
    cy: uc * s + vc * c,
  };
}

export const minRect = (points) => rectOfHull(hull(points));

// Площадь петли со знаком (против часовой — плюс).
export function ringArea(ring) {
  const n = ring.length;
  if (!(n > 0)) return 0; // цикл не выполняется: нет числовой длины или она не положительна
  return Array.isArray(ring) ? areaOfArray(ring) : areaOfLike(ring, n);
}

// Кольцо — настоящий массив: каждая точка читается один раз, следом по кругу.
function areaOfArray(ring) {
  const n = ring.length;
  let [x1, y1] = ring[0];
  let twice = 0;
  for (let i = 1; i <= n; i++) {
    const at = i < n ? i : 0;
    const pair = Array.isArray(ring[at]) ? ring[at] : splitAt(ring, at);
    const x2 = pair[0];
    const y2 = pair[1];
    twice += x1 * y2 - x2 * y1;
    x1 = x2;
    y1 = y2;
  }
  return twice / 2;
}

// Любой другой массивоподобный вход (строка, объект с длиной): чтение по индексу, пары — образцом.
function areaOfLike(ring, n) {
  let twice = 0;
  for (let at = 0; at < n; at++) {
    const [x1, y1] = splitAt(ring, at);
    const [x2, y2] = splitAt(ring, (at + 1) % n);
    twice += x1 * y2 - x2 * y1;
  }
  return twice / 2;
}

// Тёмный, но с тоном (кварталы GNEV); первый знак отбрасывается всегда.
export function darkTint(hex) {
  const rgb = parseInt(String(hex).slice(1), 16);
  const channels = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
  const brightest = Math.max(...channels);
  return brightest > 0 && brightest < TINT_CEILING && (brightest - Math.min(...channels)) / brightest >= 0.25;
}

// ---------- контуры куска ----------

// Вершины (по ключу сетки) и направленные рёбра с подсчётом повторов.
class EdgeGraph {
  constructor() {
    this.slotOf = new Map(); // ключ вершины -> номер вершины
    this.keyOf = [];
    this.spots = []; // номер вершины -> первые встреченные [x, y]
    this.heads = []; // номер вершины -> последнее добавленное ребро из неё
    this.from = [];
    this.to = [];
    this.seen = [];
    this.chained = []; // следующее ребро из той же вершины
  }

  vertexAt(positions, at) {
    const x = positions[at];
    const y = positions[at + 1];
    const key = vertexKey(x, y);
    const known = this.slotOf.get(key);
    if (known !== undefined) return known;
    const slot = this.spots.length;
    this.slotOf.set(key, slot);
    this.keyOf.push(key);
    this.spots.push([x, y]);
    this.heads.push(-1);
    return slot;
  }

  between(a, b) {
    const { to, chained } = this;
    let e = this.heads[a];
    while (e >= 0 && to[e] !== b) e = chained[e];
    return e;
  }

  tally(a, b) {
    const known = this.between(a, b);
    if (known >= 0) {
      this.seen[known] += 1;
      return;
    }
    this.from.push(a);
    this.to.push(b);
    this.seen.push(1);
    this.chained.push(this.heads[a]);
    this.heads[a] = this.to.length - 1;
  }
}

// Треугольник в книгу рёбер: без повторных вершин и не вырожденный, против часовой.
function addTriangle(graph, positions, p) {
  const a = graph.vertexAt(positions, p);
  const b = graph.vertexAt(positions, p + 2);
  const c = graph.vertexAt(positions, p + 4);
  if (a === b || b === c || a === c) return;
  const winding = turn(graph.spots[a], graph.spots[b], graph.spots[c]);
  if (Math.abs(winding) < 1e-9) return;
  if (winding > 0) {
    graph.tally(a, b);
    graph.tally(b, c);
    graph.tally(c, a);
  } else {
    graph.tally(a, c);
    graph.tally(c, b);
    graph.tally(b, a);
  }
}

// После ребра `edge`: единственное свободное или самый правый поворот (-1 — свободных нет).
function rightmostAfter(graph, leaving, used, edge) {
  const { spots, from, to } = graph;
  const list = leaving[to[edge]];
  if (list === undefined) return -1;
  let free = 0,
    only = -1;
  for (const e of list) {
    if (used[e] === 0) {
      only = free === 0 ? e : only;
      free += 1;
    }
  }
  if (free < 2) return only;
  const here = spots[to[edge]];
  const behind = spots[from[edge]];
  const back = heading(here, behind);
  let pick = -1,
    pickSwing = 0;
  for (const e of list) {
    if (used[e] !== 0) continue;
    const ahead = spots[to[e]];
    let swing = heading(here, ahead) - back;
    while (swing <= 0) swing += TWO_PI;
    if (pick < 0 || swing < pickSwing) {
      pick = e;
      pickSwing = swing;
    }
  }
  return pick;
}

// Точки петли, начатой ребром `first`; вершина с ключом NaN не равна самой себе.
function followLoop(graph, leaving, used, first, budget) {
  const { spots, from, to, keyOf } = graph;
  const start = from[first];
  const closable = keyOf[start] === keyOf[start];
  const route = [spots[start]];
  used[first] = 1;
  for (let edge = first; !(closable && to[edge] === start) && budget-- > 0; ) {
    route.push(spots[to[edge]]);
    edge = rightmostAfter(graph, leaving, used, edge);
    if (edge < 0) break;
    used[edge] = 1;
  }
  return route;
}

// Петли по граничным рёбрам: начала — в порядке появления, рёбра из вершины — по номерам.
function traceLoops(graph) {
  const { spots, from, to, seen } = graph;
  const leaving = new Array(spots.length);
  const starts = [];
  let count = 0;
  for (let e = 0; e < to.length; e++) {
    const back = graph.between(to[e], from[e]);
    // граница — ребро, у которого больше копий, чем у обратного
    if (seen[e] > (back < 0 ? 0 : seen[back])) {
      count += 1;
      if (leaving[from[e]] === undefined) {
        leaving[from[e]] = [];
        starts.push(from[e]);
      }
      leaving[from[e]].push(e);
    }
  }
  const used = new Uint8Array(to.length);
  const loops = [];
  for (const start of starts) {
    for (const first of leaving[start]) {
      if (used[first] !== 0) continue;
      const route = followLoop(graph, leaving, used, first, count + 2);
      if (route.length >= 3) loops.push(route);
    }
  }
  return loops;
}

export function boundaryLoops(positions, tris) {
  const graph = new EdgeGraph();
  for (const tri of tris) addTriangle(graph, positions, tri * 6);
  return traceLoops(graph);
}

// ---------- признаки куска ----------

export function describePart(group, tris, groupIndex) {
  const { positions: P } = group;
  const points = [];
  let area = 0,
    mx = 0,
    my = 0;
  for (const tri of tris) {
    const p = tri * 6;
    const bx = P[p + 2],
      ax = P[p],
      qx = P[p + 4];
    const ay = P[p + 1],
      by = P[p + 3],
      qy = P[p + 5];
    const part = Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2;
    area += part;
    mx += ((ax + bx + qx) / 3) * part;
    my += ((ay + by + qy) / 3) * part;
    points.push([ax, ay], [bx, by], [qx, qy]);
  }
  // границы — отдельным проходом по готовым вершинам, строгими сравнениями
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const x = points[i][0];
    const y = points[i][1];
    x1 = x > x1 ? x : x1;
    y1 = y > y1 ? y : y1;
    x0 = x < x0 ? x : x0;
    y0 = y < y0 ? y : y0;
  }
  const outline = hull(points);
  const hullArea = Math.abs(ringArea(outline));
  const { long, short, angle, cx: rx, cy: ry } = rectOfHull(outline);
  const box = long * short;
  const bounds = { x0, y0, x1, y1 };
  const shape = { long, short, angle, rx, ry };
  const ratios = { fill: box ? area / box : 0, solidity: hullArea ? Math.min(1, area / hullArea) : 0 };
  const cx = area ? mx / area : (x0 + x1) / 2;
  const cy = area ? my / area : (y0 + y1) / 2;
  return { group, groupIndex, tris, area, cx, cy, ...bounds, ...shape, ...ratios, points };
}

// ---------- основа и слой поверх радара ----------

// Новый Float32Array из выбранных треугольников; выбрана вся группа — тот же массив.
function pickTriangles(points, tris) {
  const size = tris.length * 6;
  if (size === points.length) return points;
  if (tris.length) points.subarray(0, 0); // не типизированный массив — отказ здесь
  const out = new Float32Array(size);
  let to = 0;
  for (const tri of tris) {
    for (let from = tri * 6, end = from + 6; from < end; from++) out[to++] = points[from];
  }
  return out;
}

// Подгруппа из выбранных треугольников: вся группа — она сама, иначе копия.
function carve(group, tris) {
  if (tris.length * 6 === group.positions.length) return group;
  return { ...group, positions: pickTriangles(group.positions, tris) };
}

// Площадь и рамка (по Math.min/Math.max) куска из треугольников tris.
function blockStats(positions, tris) {
  let area = 0,
    lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity;
  for (const tri of tris) {
    const p = tri * 6;
    const bx = positions[p + 2],
      ax = positions[p],
      qx = positions[p + 4];
    const ay = positions[p + 1],
      by = positions[p + 3],
      qy = positions[p + 5];
    area += Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2;
    lowX = Math.min(lowX, ax, bx, qx);
    highX = Math.max(highX, ax, bx, qx);
    lowY = Math.min(lowY, ay, by, qy);
    highY = Math.max(highY, ay, by, qy);
  }
  return { area, w: highX - lowX, h: highY - lowY };
}

// Треугольники «залитых кварталов» среди своих треугольников тёмной группы.
function filledBlocks(positions, own) {
  const moved = new Set();
  for (const piece of componentsOf(pickTriangles(positions, own))) {
    const tris = piece.map((k) => own[k]);
    const { area, w, h } = blockStats(positions, tris);
    if (Math.max(w, h) >= 40 && area / Math.max(w * h, 1e-6) >= 0.3) tris.forEach((tri) => moved.add(tri));
  }
  return moved;
}

// Ключи вершин основы: пары (x, y) подряд по массиву, неполная последняя пара не берётся.
function addPairKeys(keys, positions) {
  let i = 0;
  while (i + 1 < positions.length) {
    keys.add(vertexKey(positions[i], positions[i + 1]));
    i += 2;
  }
}

// Треугольники группы: [лежащие на основе, свои].
function splitByRadar(positions, radarKeys) {
  const total = Math.floor(positions.length / 6);
  const lies = (at) => radarKeys.has(vertexKey(positions[at], positions[at + 1]));
  const recolor = [];
  const own = [];
  for (let tri = 0; tri < total; tri++) {
    const at = tri * 6;
    (lies(at) && lies(at + 2) && lies(at + 4) ? recolor : own).push(tri);
  }
  return [recolor, own];
}

export function separateLayers(geometry, from = PACK_OVERLAY_FROM) {
  const result = { base: [], overlay: [] };
  if (!geometry?.groups) return result;
  const [...list] = geometry.groups;
  const radar = list.filter((group) => !(group.height > from));
  const radarKeys = new Set();
  radar.forEach(({ positions }) => addPairKeys(radarKeys, positions));
  list.forEach((group, groupIndex) => {
    if (!(group.height > from)) {
      result.base.push(group);
      return;
    }
    let [recolor, own] = splitByRadar(group.positions, radarKeys);
    if (own.length && darkTint(group.color)) {
      const moved = filledBlocks(group.positions, own);
      recolor = [...recolor, ...moved].sort((a, b) => a - b);
      own = own.filter((tri) => !moved.has(tri));
    }
    if (recolor.length) result.base.push(carve(group, recolor));
    if (own.length) result.overlay.push({ group: carve(group, own), groupIndex });
  });
  return result;
}

export function overlayParts(geometry, from = PACK_OVERLAY_FROM) {
  const parts = [];
  for (const { group, groupIndex } of separateLayers(geometry, from).overlay) {
    for (const tris of componentsOf(group.positions)) parts.push(describePart(group, tris, groupIndex));
  }
  return parts;
}

// ---------- помощники соседей ----------

// Просвет между отрезками [aLo, aHi] и [bLo, bHi] на одной оси (аргументы — в порядке чтения).
const slack = (aLo, bHi, bLo, aHi) => Math.max(0, aLo - bHi, bLo - aHi);

// Расстояние между рамками по осям.
export function boxGap(a, b) {
  return Math.hypot(slack(a.x0, b.x1, b.x0, a.x1), slack(a.y0, b.y1, b.y0, a.y1));
}

// Сетка поиска соседей по рамкам.
export function boxGrid(items, cell) {
  const buckets = new Map();
  let repeats = false; // рамка попала в одну корзину дважды (ключи клеток совпали)
  items.forEach((box, index) => {
    const gx0 = Math.floor(box.x0 / cell);
    const gy0 = Math.floor(box.y0 / cell);
    const gx1 = Math.floor(box.x1 / cell);
    const gy1 = Math.floor(box.y1 / cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = gx * CELL_STRIDE + gy;
        const bucket = buckets.get(key);
        if (bucket === undefined) {
          buckets.set(key, [index]);
        } else {
          repeats = repeats || bucket[bucket.length - 1] === index;
          bucket.push(index);
        }
      }
    }
  });
  // Номера рамок из клеток вокруг box, без повторов, в порядке добавления.
  const markable = Array.isArray(items);
  const marks = new Int32Array(markable ? items.length : 0);
  let stamp = 0;
  let depth = 0;
  const near = (box, reach, visit) => {
    const gx0 = Math.floor((box.x0 - reach) / cell);
    const gy0 = Math.floor((box.y0 - reach) / cell);
    const gx1 = Math.floor((box.x1 + reach) / cell);
    const gy1 = Math.floor((box.y1 + reach) / cell);
    const single = gx0 === gx1 && gy0 === gy1 && !repeats;
    // вложенный вызов из visit не должен портить метки внешнего: у него свой набор
    const seen = single || (depth === 0 && markable) ? null : new Set();
    const mine = single || seen ? 0 : ++stamp;
    depth += 1;
    try {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const bucket = buckets.get(gx * CELL_STRIDE + gy);
          if (bucket === undefined) continue;
          for (let i = 0; i < bucket.length; i++) {
            const index = bucket[i];
            if (!single) {
              if (seen ? seen.has(index) : marks[index] === mine) continue;
              if (seen) seen.add(index);
              else marks[index] = mine;
            }
            visit(index);
          }
        }
      }
    } finally {
      depth -= 1;
    }
  };
  return { near };
}

// Залитый кружок: условия проверяются по порядку, первое ложное обрывает.
export function isDot(part) {
  return (
    part.long <= DOT.maxLong &&
    part.short > 0 &&
    part.long <= DOT.ratio * part.short &&
    part.fill >= DOT.minFill &&
    part.fill <= DOT.maxFill &&
    part.solidity >= DOT.solidity &&
    part.tris.length >= DOT.minTris
  );
}
