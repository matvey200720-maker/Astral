/*
 * Форма зоны: ширина линии, высота стенки (задача 23 ТЗ 18.10.2026, «Зоны — ширина, высота, неон»).
 *
 * Зона мода — тонкая лента по рельефу (зелёные зоны, линии бизвара, ВЗХ и порта: сантиметры шириной) или
 * плоская заливка участка (запретные). Из той же сетки Astral делает свою:
 *
 *   — ширина: лента становится нужной ширины. Сетка мода — набор треугольников без разбора на звенья (у зелёной
 *     ленты звено в метры, у обвода — в сантиметры), поэтому ось ленты ищется по соседям вершины по рёбрам
 *     треугольников: кольца растут, пока облако не вытянется вдоль ленты; его среднее лежит на оси, главная ось
 *     разброса идёт вдоль ленты, поперёк — край. Вершина уходит от оси на половину ширины в свою сторону. Высота не
 *     меняется — лента идёт по рельефу;
 *   — высота: лента вытягивается вверх — крышка на этой высоте и стенки по краям (у ленты это стенка
 *     толщиной в ширину ленты; у заливки — коробка участка). Стенки двусторонние: зона — прозрачная
 *     оболочка, её видно и снаружи, и изнутри.
 *
 * Чистая функция над массивами: её берут кадр редактора (сетка сцены) и установщик (сетка модели мода) — в игру
 * уходит ровно то, что видно в кадре. Свою развёртку (эффект цвета) строит вызывающий: здесь только форма.
 */

/* Сварка вершин: 1 мм. */
const WELD = 1000;
/* Соседи для оси ленты — кольца по рёбрам: не больше стольких, не меньше стольких вершин и облако вытянуто не меньше чем так. */
const MAX_RINGS = 6;
const MIN_NEIGHBOURS = 6;
const ELONGATED = 3;

/**
 * Форма зоны из сетки мода.
 *
 * `source` — `{ positions: Float32Array (x, y, z), indices: Uint32Array|number[] }`; `width` — нужная ширина
 * ленты, м (`null` — не менять ширину: запретные зоны и «ширина как в моде»); `height` — высота стенки, м (0 —
 * без стенки). Ответ — `{ positions, indices, ground, cap, walls }`: сначала лента (`ground` индексов), затем
 * крышка (`cap` индексов) и стенки (`walls` — отрезков по краю, у каждого обе намотки).
 */
export function zoneShapeMesh(source, { width = null, height = 0 } = {}) {
  const { positions, indices } = source;
  /* 1. Сварка вершин по месту и треугольники по сваренным номерам. */
  const keys = new Map();
  const remap = new Int32Array(positions.length / 3);
  const welded = [];
  for (let vertex = 0; vertex < remap.length; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
    let id = keys.get(key);
    if (id === undefined) {
      id = keys.size;
      keys.set(key, id);
      welded.push(x, y, z);
    }
    remap[vertex] = id;
  }
  const count = keys.size;
  const triangles = [];
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = remap[indices[at]];
    const b = remap[indices[at + 1]];
    const c = remap[indices[at + 2]];
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }

  /* 2. Ширина: вершина — от оси ленты на половину ширины. */
  const points = Float64Array.from(welded);
  if (width !== null && width > 0) {
    /* Соседи по рёбрам треугольников: вершины звена и ближних звеньев — расстоянием их не взять (у зелёной ленты звено
       в метры, у обвода — в сантиметры). */
    const next = Array.from({ length: count }, () => new Set());
    for (let at = 0; at < triangles.length; at += 3)
      for (let side = 0; side < 3; side += 1) {
        const a = triangles[at + side];
        const b = triangles[at + ((side + 1) % 3)];
        next[a].add(b);
        next[b].add(a);
      }
    const moves = new Float64Array(count * 2);
    for (let id = 0; id < count; id += 1) {
      /* Кольца соседей, пока облако не вытянется вдоль ленты (или кольца не кончатся). */
      const seen = new Set([id]);
      let frontier = [id];
      let mx = 0;
      let my = 0;
      let xx = 0;
      let xy = 0;
      let yy = 0;
      let ratio = 0;
      for (let ring = 0; ring < MAX_RINGS; ring += 1) {
        const added = [];
        for (const from of frontier) for (const to of next[from]) if (!seen.has(to)) {
          seen.add(to);
          added.push(to);
        }
        if (!added.length) break;
        frontier = added;
        if (seen.size < MIN_NEIGHBOURS) continue;
        mx = 0;
        my = 0;
        for (const other of seen) {
          mx += points[other * 3];
          my += points[other * 3 + 1];
        }
        mx /= seen.size;
        my /= seen.size;
        xx = 0;
        xy = 0;
        yy = 0;
        for (const other of seen) {
          const ex = points[other * 3] - mx;
          const ey = points[other * 3 + 1] - my;
          xx += ex * ex;
          xy += ex * ey;
          yy += ey * ey;
        }
        const half = Math.hypot((xx - yy) / 2, xy);
        const major = (xx + yy) / 2 + half;
        const minor = Math.max(1e-12, (xx + yy) / 2 - half);
        ratio = Math.sqrt(major / minor);
        if (ratio >= ELONGATED) break;
      }
      if (ratio < 1.5) continue;
      /* Главная ось разброса — вдоль ленты; поперёк — вектор края. */
      const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
      const ax = -Math.sin(angle);
      const ay = Math.cos(angle);
      const side = (points[id * 3] - mx) * ax + (points[id * 3 + 1] - my) * ay;
      if (Math.abs(side) < 1e-4) continue;
      const push = width / 2 - Math.abs(side);
      moves[id * 2] = ax * Math.sign(side) * push;
      moves[id * 2 + 1] = ay * Math.sign(side) * push;
    }
    for (let id = 0; id < count; id += 1) {
      points[id * 3] += moves[id * 2];
      points[id * 3 + 1] += moves[id * 2 + 1];
    }
  }

  /* 3. Лента, крышка и стенки по краю. */
  const out = [];
  const outIndices = [];
  for (let id = 0; id < count; id += 1) out.push(points[id * 3], points[id * 3 + 1], points[id * 3 + 2]);
  for (const id of triangles) outIndices.push(id);
  const ground = outIndices.length;
  let cap = 0;
  let walls = 0;
  if (height > 0) {
    /* Край — ребро, у которого один треугольник. */
    const edges = new Map();
    const edgeKey = (a, b) => (a < b ? a * count + b : b * count + a);
    for (let at = 0; at < triangles.length; at += 3)
      for (let side = 0; side < 3; side += 1) {
        const a = triangles[at + side];
        const b = triangles[at + ((side + 1) % 3)];
        const key = edgeKey(a, b);
        const found = edges.get(key);
        if (found) found.count += 1;
        else edges.set(key, { a, b, count: 1 });
      }
    const top = (id) => count + id;
    for (let id = 0; id < count; id += 1) out.push(points[id * 3], points[id * 3 + 1], points[id * 3 + 2] + height);
    for (let at = 0; at < triangles.length; at += 3) outIndices.push(top(triangles[at]), top(triangles[at + 2]), top(triangles[at + 1]));
    cap = outIndices.length - ground;
    for (const { a, b, count: used } of edges.values()) {
      if (used !== 1) continue;
      /* Двусторонняя стенка: обе намотки. */
      outIndices.push(a, b, top(b), a, top(b), top(a), a, top(b), b, a, top(a), top(b));
      walls += 1;
    }
  }
  return { positions: Float32Array.from(out), indices: Uint32Array.from(outIndices), ground, cap, walls };
}

/** Рамка сетки: `{ min, max }` по трём осям. */
export function zoneMeshBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at + 2 < positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[at + axis]);
      max[axis] = Math.max(max[axis], positions[at + axis]);
    }
  return { min, max };
}
