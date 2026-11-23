/*
 * Запекание бороды-модели в лист штатной бороды (Ц3в, Б2, 16.11.2026): плоский рисунок на развёртке кожи головы (UV0), как у листов `mp_fm_faov_beard_NNN`.
 *
 * Голова и борода-вещь стоят в одном пространстве модели персонажа. Для каждого пикселя листа берётся точка на коже головы по её развёртке, из неё вдоль нормали (чуть вглубь и наружу
 * на `reach`) пускается луч в сетки бороды; до `layers` попаданий складываются спереди назад по альфе текстуры бороды. Что у бороды нашлось над кожей — рисунок листа; что не нашлось (длинная борода ниже
 * подбородка, усы вне головы) — `outside`. Цвет по образцу штатных листов: почти чёрный тёмно-красный тон (`tone`), форма — в альфе; саму краску ставит палитра волос игры.
 *
 * Чистый JS без зависимостей: работает в главном процессе, в потоке и в тестах. Сетки — `{ positions: Float32Array xyz, uvs: Float32Array uv, indices }`; текстура бороды — `{ width, height, rgba }` или `null`
 * (без текстуры борода считается сплошной).
 */

/* Штатные листы бород: тон покрытых пикселей (измерено по `mp_fm_faov_beard_000`, `001`, `005`: 24,11,11). */
export const BEARD_TONE = Object.freeze([24, 11, 11]);

const EPSILON = 1e-9;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const point = (array, index) => [array[index * 3], array[index * 3 + 1], array[index * 3 + 2]];

/* Нормали вершин: нормали граней, взвешенные площадью. */
function vertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]];
    const normal = cross(sub(point(positions, b), point(positions, a)), sub(point(positions, c), point(positions, a)));
    for (const vertex of [a, b, c]) {
      normals[vertex * 3] += normal[0];
      normals[vertex * 3 + 1] += normal[1];
      normals[vertex * 3 + 2] += normal[2];
    }
  }
  for (let at = 0; at < normals.length; at += 3) {
    const size = Math.hypot(normals[at], normals[at + 1], normals[at + 2]) || 1;
    normals[at] /= size;
    normals[at + 1] /= size;
    normals[at + 2] /= size;
  }
  return normals;
}

/* Сетка треугольников головы по развёртке: в каждой ячейке [0,1]² — номера треугольников, чьи рамки её задевают. */
function uvGrid(head, cells) {
  const grid = Array.from({ length: cells * cells }, () => []);
  for (let tri = 0; tri * 3 + 2 < head.indices.length; tri += 1) {
    const ids = [head.indices[tri * 3], head.indices[tri * 3 + 1], head.indices[tri * 3 + 2]];
    const us = ids.map((id) => head.uvs[id * 2]);
    const vs = ids.map((id) => head.uvs[id * 2 + 1]);
    const [x0, x1] = [Math.floor(Math.min(...us) * cells), Math.floor(Math.max(...us) * cells)];
    const [y0, y1] = [Math.floor(Math.min(...vs) * cells), Math.floor(Math.max(...vs) * cells)];
    for (let y = Math.max(0, y0); y <= Math.min(cells - 1, y1); y += 1)
      for (let x = Math.max(0, x0); x <= Math.min(cells - 1, x1); x += 1) grid[y * cells + x].push(tri);
  }
  return grid;
}

/* Бородa одним списком треугольников: вершины, развёртка, текстура, площадь и вес «сколько рисунка» (площадь × средняя альфа). */
function beardTriangles(meshes) {
  const triangles = [];
  for (const mesh of meshes || []) {
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
      const corners = ids.map((id) => point(mesh.positions, id));
      const area = length(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]))) / 2;
      if (area < EPSILON) continue;
      const uvs = ids.map((id) => [mesh.uvs?.[id * 2] ?? 0, mesh.uvs?.[id * 2 + 1] ?? 0]);
      triangles.push({ corners, uvs, texture: mesh.texture || null, area, weight: 0, landed: 0 });
    }
  }
  return triangles;
}

/* Цвет и альфа текстуры бороды в точке развёртки (ближайший пиксель, с повтором). Без текстуры — сплошной. */
function sampleTexture(texture, u, v) {
  if (!texture?.rgba) return [255, 255, 255, 255];
  const x = Math.min(texture.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * texture.width)));
  const y = Math.min(texture.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * texture.height)));
  const at = (y * texture.width + x) * 4;
  return [texture.rgba[at], texture.rgba[at + 1], texture.rgba[at + 2], texture.rgba[at + 3]];
}

/* Вес треугольника: площадь × средняя альфа текстуры по трём точкам (центр и две стороны): что за часть бороды в нём «настоящая». */
function weighTriangles(triangles) {
  for (const tri of triangles) {
    const probes = [
      [(tri.uvs[0][0] + tri.uvs[1][0] + tri.uvs[2][0]) / 3, (tri.uvs[0][1] + tri.uvs[1][1] + tri.uvs[2][1]) / 3],
      [(tri.uvs[0][0] * 2 + tri.uvs[1][0]) / 3, (tri.uvs[0][1] * 2 + tri.uvs[1][1]) / 3],
      [(tri.uvs[1][0] * 2 + tri.uvs[2][0]) / 3, (tri.uvs[1][1] * 2 + tri.uvs[2][1]) / 3],
    ];
    const alpha = probes.reduce((sum, [u, v]) => sum + sampleTexture(tri.texture, u, v)[3], 0) / probes.length / 255;
    tri.weight = tri.area * alpha;
  }
}

/* Пространственная сетка бороды: 3D-ячейки с номерами треугольников, чьи рамки их задевают. */
function spaceGrid(triangles, cells) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles)
    for (const corner of tri.corners)
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], corner[axis]);
        high[axis] = Math.max(high[axis], corner[axis]);
      }
  const size = [0, 1, 2].map((axis) => Math.max((high[axis] - low[axis]) / cells, 1e-6));
  const slots = new Map();
  const cellOf = (value, axis) => Math.min(cells - 1, Math.max(0, Math.floor((value - low[axis]) / size[axis])));
  triangles.forEach((tri, id) => {
    const from = [0, 1, 2].map((axis) => cellOf(Math.min(...tri.corners.map((corner) => corner[axis])), axis));
    const to = [0, 1, 2].map((axis) => cellOf(Math.max(...tri.corners.map((corner) => corner[axis])), axis));
    for (let z = from[2]; z <= to[2]; z += 1)
      for (let y = from[1]; y <= to[1]; y += 1)
        for (let x = from[0]; x <= to[0]; x += 1) {
          const key = (z * cells + y) * cells + x;
          if (!slots.has(key)) slots.set(key, []);
          slots.get(key).push(id);
        }
  });
  return { low, high, cells, cellOf, slots };
}

/* Номера треугольников бороды, чьи ячейки задевает рамка отрезка луча. */
function nearTriangles(space, from, to, stamp, mark) {
  const found = [];
  const min = [0, 1, 2].map((axis) => space.cellOf(Math.min(from[axis], to[axis]), axis));
  const max = [0, 1, 2].map((axis) => space.cellOf(Math.max(from[axis], to[axis]), axis));
  for (let z = min[2]; z <= max[2]; z += 1)
    for (let y = min[1]; y <= max[1]; y += 1)
      for (let x = min[0]; x <= max[0]; x += 1) {
        const list = space.slots.get((z * space.cells + y) * space.cells + x);
        if (!list) continue;
        for (const id of list) {
          if (stamp[id] === mark) continue;
          stamp[id] = mark;
          found.push(id);
        }
      }
  return found;
}

/* Луч и треугольник (Мёллер–Трумбор): расстояние вдоль луча и барицентры, либо `null`. */
function hitTriangle(origin, direction, tri) {
  const edge1 = sub(tri.corners[1], tri.corners[0]);
  const edge2 = sub(tri.corners[2], tri.corners[0]);
  const pvec = cross(direction, edge2);
  const det = dot(edge1, pvec);
  if (Math.abs(det) < EPSILON) return null;
  const inv = 1 / det;
  const tvec = sub(origin, tri.corners[0]);
  const u = dot(tvec, pvec) * inv;
  if (u < 0 || u > 1) return null;
  const qvec = cross(tvec, edge1);
  const v = dot(direction, qvec) * inv;
  if (v < 0 || u + v > 1) return null;
  return { t: dot(edge2, qvec) * inv, u, v };
}

/**
 * Лист бороды: `{ rgba, width, height, coverage, outside }`.
 * `head` — кожа головы (`positions`, `uvs`, `indices`), `beard.meshes` — сетки бороды с текстурами; `size` — сторона листа (512), `reach` — как далеко над кожей ищем бороду, `back` — как глубоко под кожей
 * (борода, чуть вросшая в голову), `layers` — сколько слоёв прядей складываем на пиксель, `samples` — подвыборка на пиксель (n×n), `tone` — тон покрытых пикселей.
 * `coverage` — доля листа с рисунком (у штатных 2–12 %), `outside` — доля бороды (площадь × альфа), не попавшая на голову: длинная борода ниже подбородка, 0…1.
 */
export function bakeBeardSheet({ head, beard, size = 512, reach = 0.035, back = 0.01, layers = 4, samples = 2, tone = BEARD_TONE }) {
  const triangles = beardTriangles(beard?.meshes);
  weighTriangles(triangles);
  const rgba = new Uint8ClampedArray(size * size * 4);
  if (!triangles.length || !head?.indices?.length) return { rgba, width: size, height: size, coverage: 0, outside: triangles.length ? 1 : 0 };

  const normals = vertexNormals(head.positions, head.indices);
  const cells = 64;
  const grid = uvGrid(head, cells);
  const space = spaceGrid(triangles, 24);
  const stamp = new Int32Array(triangles.length).fill(-1);
  let mark = 0;
  const texel = 1 / size;
  const shares = Math.max(1, Math.floor(samples));
  const lumaOf = (color) => (0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]) / 255;
  let covered = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let alphaSum = 0;
      let lumaSum = 0;
      for (let sy = 0; sy < shares; sy += 1) {
        for (let sx = 0; sx < shares; sx += 1) {
          const u = (x + (sx + 0.5) / shares) * texel;
          const v = (y + (sy + 0.5) / shares) * texel;
          const cell = grid[Math.min(cells - 1, Math.floor(v * cells)) * cells + Math.min(cells - 1, Math.floor(u * cells))];
          let headTri = -1;
          let weights = null;
          for (const tri of cell) {
            const ids = [head.indices[tri * 3], head.indices[tri * 3 + 1], head.indices[tri * 3 + 2]];
            const a = [head.uvs[ids[0] * 2], head.uvs[ids[0] * 2 + 1]];
            const b = [head.uvs[ids[1] * 2], head.uvs[ids[1] * 2 + 1]];
            const c = [head.uvs[ids[2] * 2], head.uvs[ids[2] * 2 + 1]];
            const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
            if (Math.abs(det) < EPSILON) continue;
            const w0 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / det;
            const w1 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / det;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
            headTri = tri;
            weights = [w0, w1, w2, ids];
            break;
          }
          if (headTri < 0) continue;
          const ids = weights[3];
          const origin3 = [0, 1, 2].map((axis) => weights[0] * head.positions[ids[0] * 3 + axis] + weights[1] * head.positions[ids[1] * 3 + axis] + weights[2] * head.positions[ids[2] * 3 + axis]);
          const normal3 = [0, 1, 2].map((axis) => weights[0] * normals[ids[0] * 3 + axis] + weights[1] * normals[ids[1] * 3 + axis] + weights[2] * normals[ids[2] * 3 + axis]);
          const normalSize = length(normal3) || 1;
          const direction = normal3.map((value) => value / normalSize);
          const start = origin3.map((value, axis) => value - direction[axis] * back);
          const end = origin3.map((value, axis) => value + direction[axis] * reach);
          mark += 1;
          const hits = [];
          for (const id of nearTriangles(space, start, end, stamp, mark)) {
            const found = hitTriangle(start, direction, triangles[id]);
            if (found && found.t >= 0 && found.t <= back + reach) hits.push({ ...found, id });
          }
          if (!hits.length) continue;
          hits.sort((left, right) => right.t - left.t);
          /* Луч, попавший точно в общее ребро двух треугольников, даёт два попадания на одной глубине: это одна поверхность. */
          const surfaces = hits.filter((hit, order) => order === 0 || Math.abs(hit.t - hits[order - 1].t) > 1e-6);
          /* Спереди назад: дальше от кожи — ближе к зрителю, значит сперва самые далёкие. */
          let remain = 1;
          let alpha = 0;
          let luma = 0;
          for (const hit of surfaces.slice(0, layers)) {
            const tri = triangles[hit.id];
            const uv = [0, 1].map((axis) => (1 - hit.u - hit.v) * tri.uvs[0][axis] + hit.u * tri.uvs[1][axis] + hit.v * tri.uvs[2][axis]);
            const color = sampleTexture(tri.texture, uv[0], uv[1]);
            const strength = (color[3] / 255) * remain;
            alpha += strength;
            luma += strength * lumaOf(color);
            remain *= 1 - color[3] / 255;
            tri.landed += 1 / (shares * shares);
            if (remain < 0.02) break;
          }
          alphaSum += alpha;
          lumaSum += luma;
        }
      }
      const alpha = alphaSum / (shares * shares);
      if (alpha <= 0.004) continue;
      const mean = lumaSum / Math.max(alphaSum, EPSILON);
      /* Яркость рисунка бороды ведёт тон листа: тёмные пряди темнее, светлые светлее; общий тон — как у штатных. */
      const scale = Math.min(1.6, Math.max(0.6, 0.6 + mean * 1.2));
      const at = (y * size + x) * 4;
      rgba[at] = Math.min(255, tone[0] * scale);
      rgba[at + 1] = Math.min(255, tone[1] * scale);
      rgba[at + 2] = Math.min(255, tone[2] * scale);
      rgba[at + 3] = Math.round(Math.min(1, alpha) * 255);
      covered += 1;
    }
  }

  /* «Не вошло на голову»: какая часть веса бороды получила хотя бы один луч. Треугольник считается вошедшим пропорционально числу попаданий (одно попадание — один пиксель листа). */
  const total = triangles.reduce((sum, tri) => sum + tri.weight, 0);
  const pixelArea = headPixelArea(head, size);
  let landedWeight = 0;
  for (const tri of triangles) landedWeight += tri.weight * Math.min(1, (tri.landed * pixelArea) / Math.max(tri.area, EPSILON));
  return { rgba, width: size, height: size, coverage: covered / (size * size), outside: total > EPSILON ? Math.max(0, Math.min(1, 1 - landedWeight / total)) : 0 };
}

/* Площадь кожи головы на один пиксель листа: площадь всех треугольников головы, делённая на их площадь на развёртке в пикселях. Грубо: хватает, чтобы сравнить «сколько кожи накрыл луч» с площадью треугольника бороды. */
function headPixelArea(head, size) {
  let area3 = 0;
  let areaUv = 0;
  for (let at = 0; at + 2 < head.indices.length; at += 3) {
    const ids = [head.indices[at], head.indices[at + 1], head.indices[at + 2]];
    const corners = ids.map((id) => point(head.positions, id));
    area3 += length(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]))) / 2;
    const [a, b, c] = ids.map((id) => [head.uvs[id * 2], head.uvs[id * 2 + 1]]);
    areaUv += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  return areaUv > EPSILON ? area3 / (areaUv * size * size) : 0;
}
