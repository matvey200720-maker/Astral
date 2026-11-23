/*
 * Чернила блэкворка на ногах под штанами и на кожаной руке перчаток (03.11.2026, владелец: «блэкворк на ноги должен накладываться и тогда, когда надеты штаны … красятся ноги, а не ткань штанов»; 05.11.2026: «чернила
 * лежат на шортах чёрным пятном — только кожа тела, ни на какую ткань»).
 *
 * Ловушка: у моделей `lowr_*` вторая развёртка (зоны тату) у ткани та же, что у ноги под ней, поэтому слой зоны с такой сетки ложился бы чернилами и на штанину, и на шорты, и на резинку трусов. Признака «кожа» в самой модели игры
 * нет: у вещи один материал `ped`, а цвет вершин (`colours`) у кожи и у ткани один и тот же. Кожа определяется положением: у трусов и шорт ниже подола лежит голая нога — те же вершины до долей миллиметра, у ткани
 * они расходятся. `bareLegSkin` берёт такие общие вершины двух моделей и строит по ним поверхность ноги (треугольники трусов, у которых общие все три вершины), `skinTriangles` оставляет у любой нижней одежды только
 * треугольники, у которых все три вершины лежат на этой поверхности, и полоску кромки подола (две вершины на коже, третья — край ткани не дальше 2,5 см). Ткань на поверхности не лежит: она отстоит от ноги, а у штанин,
 * что отстоят меньше всего, — на сантиметры. Цвет ткани в расчёт не идёт: первая версия брала «полосу бедра под подолом» по цвету текстуры и по 12 см от кожи, и бежевые карго-шорты (штаны №15) получали чернила на ткань.
 *
 * Чистый JS: работает в главном процессе, в окне и в тестах.
 */

import { TATTOO_ZONES, zoneUv } from "./tattoo-zones.js";

/* Какие зоны — ноги, и с какого V начинается голая нога: выше — подол трусов (ткань идёт до V 0,21, обмер 03.11.2026). */
const LEG_ZONES = new Set(TATTOO_ZONES.filter((zone) => zone.key.endsWith("-leg")).map((zone) => zone.key));
export const LEG_SKIN_FROM_V = 0.2;

/* Вершина лежит на ноге, если ближе 1,5 мм к её поверхности: у ноги штанов они лежат на ней до float, а ткань отстоит на сантиметры. Клетка поиска вдвое больше. */
const MATCH = 0.0015;
const CELL = 0.003;
/* Клетка сетки треугольников: треугольник записывается в каждую клетку, которую задевает его коробка, расширенная на `MATCH` (или на `HEM_REACH`). */
const SURFACE_CELL = 0.02;
/*
 * Кромка подола: у трусов и шорт между кольцом ткани на краю и первым кольцом кожи лежит полоска ноги в сантиметр-два — без неё под подолом оставалась нерасписанная кожа. Такой треугольник берётся, когда две его вершины
 * на коже, а третья — край ткани не дальше 2,5 см от кожи. Штанина, что отстоит дальше (карго-шорты №15: 4 см и больше), и всё, что выше кромки, не берётся.
 */
const HEM_REACH = 0.025;

/** Сетка точек с клеткой `cell`: `add(x, y, z)` и `near(x, y, z, reach)` — есть ли точка не дальше `reach` (не больше клетки). */
function pointGrid(cell = CELL) {
  const cells = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  const around = (value) => Math.floor(value / cell);
  return {
    add(x, y, z) {
      const id = key(around(x), around(y), around(z));
      const bucket = cells.get(id);
      if (bucket) bucket.push(x, y, z);
      else cells.set(id, [x, y, z]);
    },
    near(x, y, z, reach = MATCH) {
      const [i, j, k] = [around(x), around(y), around(z)];
      for (let di = -1; di <= 1; di += 1)
        for (let dj = -1; dj <= 1; dj += 1)
          for (let dk = -1; dk <= 1; dk += 1) {
            const bucket = cells.get(key(i + di, j + dj, k + dk));
            if (!bucket) continue;
            for (let at = 0; at < bucket.length; at += 3)
              if ((bucket[at] - x) ** 2 + (bucket[at + 1] - y) ** 2 + (bucket[at + 2] - z) ** 2 <= reach * reach) return true;
          }
      return false;
    },
    get size() {
      return cells.size;
    },
  };
}

/* Квадрат расстояния от точки `p` до треугольника `a b c` (Эриксон, «Real-Time Collision Detection», 5.1.5). */
function triangleDistanceSq(px, py, pz, a, b, c) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const apx = px - a[0];
  const apy = py - a[1];
  const apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const closest = (x, y, z) => (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
  if (d1 <= 0 && d2 <= 0) return closest(a[0], a[1], a[2]);
  const bpx = px - b[0];
  const bpy = py - b[1];
  const bpz = pz - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return closest(b[0], b[1], b[2]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return closest(a[0] + abx * t, a[1] + aby * t, a[2] + abz * t);
  }
  const cpx = px - c[0];
  const cpy = py - c[1];
  const cpz = pz - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return closest(c[0], c[1], c[2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return closest(a[0] + acx * t, a[1] + acy * t, a[2] + acz * t);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return closest(b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t);
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return closest(a[0] + abx * v + acx * w, a[1] + aby * v + acy * w, a[2] + abz * v + acz * w);
}

/** Поверхность из треугольников: `add(a, b, c)` — вершины `[x, y, z]`, `near(x, y, z, reach)` — лежит ли точка не дальше `reach` от какого-то треугольника. */
function surfaceGrid(reach = MATCH) {
  const cells = new Map();
  const triangles = [];
  const around = (value) => Math.floor(value / SURFACE_CELL);
  return {
    add(a, b, c) {
      const id = triangles.length;
      triangles.push([a, b, c]);
      const low = [0, 1, 2].map((axis) => Math.min(a[axis], b[axis], c[axis]) - reach);
      const high = [0, 1, 2].map((axis) => Math.max(a[axis], b[axis], c[axis]) + reach);
      for (let i = around(low[0]); i <= around(high[0]); i += 1)
        for (let j = around(low[1]); j <= around(high[1]); j += 1)
          for (let k = around(low[2]); k <= around(high[2]); k += 1) {
            const key = `${i},${j},${k}`;
            const bucket = cells.get(key);
            if (bucket) bucket.push(id);
            else cells.set(key, [id]);
          }
    },
    near(x, y, z) {
      const bucket = cells.get(`${around(x)},${around(y)},${around(z)}`);
      if (!bucket) return false;
      for (const id of bucket) {
        const [a, b, c] = triangles[id];
        if (triangleDistanceSq(x, y, z, a, b, c) <= reach * reach) return true;
      }
      return false;
    },
    get size() {
      return triangles.length;
    },
  };
}

/* Вершины ноги `drawable` с V не меньше `from`: `[x, y, z]` подряд. */
function legVertices(drawable, from) {
  const out = [];
  for (const mesh of drawable?.meshes || []) {
    if (!mesh.positions || !mesh.uvs1) continue;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      const place = zoneUv(mesh.uvs1[vertex * 2], mesh.uvs1[vertex * 2 + 1]);
      if (!place || !LEG_ZONES.has(TATTOO_ZONES[place.zone].key) || place.v < from) continue;
      out.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
    }
  }
  return out;
}

/**
 * Голая нога по двум штатным нижним моделям (трусы и шорты, обе в одной позе): точки, где их вершины совпадают, — кожа, а не ткань. `null` — общих точек нет (модели не из одного тела: ноги не найти).
 * Результат — `{ has(x, y, z) }`: точка лежит на голой ноге — совпадает с общей вершиной или лежит на поверхности из треугольников трусов, у которых общие все три вершины (между кольцами вершин тоже кожа).
 */
export function bareLegSkin(first, second) {
  const known = pointGrid();
  const mine = legVertices(first, LEG_SKIN_FROM_V);
  for (let at = 0; at < mine.length; at += 3) known.add(mine[at], mine[at + 1], mine[at + 2]);
  const skin = pointGrid();
  const other = legVertices(second, LEG_SKIN_FROM_V);
  for (let at = 0; at < other.length; at += 3)
    if (known.near(other[at], other[at + 1], other[at + 2])) skin.add(other[at], other[at + 1], other[at + 2]);
  if (!skin.size) return null;
  /* Поверхность: треугольники первой модели, у которых все три вершины — общие (кожа подтверждена обеими моделями). */
  const surface = surfaceGrid();
  const hem = surfaceGrid(HEM_REACH);
  for (const mesh of first?.meshes || []) {
    if (!mesh.positions || !mesh.indices) continue;
    const { positions, indices } = mesh;
    const point = (vertex) => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    const shared = new Map();
    const onSkin = (vertex) => {
      if (!shared.has(vertex)) shared.set(vertex, skin.near(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]));
      return shared.get(vertex);
    };
    for (let at = 0; at + 2 < indices.length; at += 3)
      if (onSkin(indices[at]) && onSkin(indices[at + 1]) && onSkin(indices[at + 2])) {
        surface.add(point(indices[at]), point(indices[at + 1]), point(indices[at + 2]));
        hem.add(point(indices[at]), point(indices[at + 1]), point(indices[at + 2]));
      }
  }
  return { has: (x, y, z) => skin.near(x, y, z) || surface.near(x, y, z), close: (x, y, z) => hem.near(x, y, z) };
}

/**
 * Только кожа ног у нижней одежды `drawable` (штаны, шорты, трусы, мод): треугольники зон ног, у которых все три вершины лежат на голой ноге `skin` (`bareLegSkin`), и полоска кромки подола — две вершины на коже,
 * третья — край ткани не дальше `HEM_REACH` от неё. Ткань штанины, резинка и всё, что отстоит от ноги, в чернила не идёт: чернила красят кожу, а не одежду. Сетки и веса не правятся: собирается новый список индексов.
 * `null` — кожи на вещи нет (штаны до пола).
 */
export function skinTriangles(drawable, skin) {
  if (!drawable?.meshes?.length || !skin) return null;
  const meshes = [];
  for (const mesh of drawable.meshes) {
    if (!mesh.positions || !mesh.indices || !mesh.uvs1) continue;
    const { positions, uvs1, indices } = mesh;
    const vertices = positions.length / 3;
    /* 0 — не нога, 1 — нога (ткань), 2 — кожа. */
    const kind = new Uint8Array(vertices);
    const zone = new Int8Array(vertices).fill(-1);
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const place = zoneUv(uvs1[vertex * 2], uvs1[vertex * 2 + 1]);
      if (!place || !LEG_ZONES.has(TATTOO_ZONES[place.zone].key)) continue;
      zone[vertex] = place.zone;
      kind[vertex] = skin.has(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]) ? 2 : 1;
    }
    const kept = [];
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const corners = [indices[at], indices[at + 1], indices[at + 2]];
      if (zone[corners[0]] !== zone[corners[1]] || zone[corners[0]] !== zone[corners[2]]) continue;
      const onSkin = corners.filter((corner) => kind[corner] === 2).length;
      if (onSkin === 3) kept.push(...corners);
      else if (onSkin === 2 && skin.close) {
        /* Кромка подола: третья вершина — край ткани не дальше `HEM_REACH` от кожи. */
        const edge = corners.find((corner) => kind[corner] !== 2);
        if (kind[edge] === 1 && skin.close(positions[edge * 3], positions[edge * 3 + 1], positions[edge * 3 + 2])) kept.push(...corners);
      }
    }
    if (kept.length) meshes.push({ ...mesh, indices: new indices.constructor(kept) });
  }
  return meshes.length ? { ...drawable, meshes } : null;
}
