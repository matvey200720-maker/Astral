/*
 * Контур выбранного для 3D-кадров (18.10.2026, поправка ведущей к задаче 2:
 * «подсветка поверх вида, а не вместо него — кромка по силуэту и рёбрам»).
 *
 * Контур — это рёбра сетки, у которых «нечётно» граней: кромка полотна, край
 * стены, угол коробки. Рёбра, которыми грани сходятся плавно, и рёбра внутри
 * сплошной поверхности — внутренние, их нет. Грани у ребра собираются по
 * направлению нормали в кучки (грани в пределах угла излома — одна кучка);
 * ребро — контур, если в какой-то кучке грань одна (или нечётное число):
 *
 *   — край односторонней поверхности: одна грань → контур;
 *   — плавный шов внутри: две грани одной кучки → не контур;
 *   — излом (угол коробки): две кучки по одной грани → контур;
 *   — край ткани, нарисованной с двух сторон (две совпавшие грани спинами
 *     друг к другу): две кучки по одной грани → контур; шов внутри такой
 *     ткани — по две грани в каждой кучке → не контур.
 *
 * Чистая функция над сетками three.js без WebGL: её читает слой подсветки
 * (`selection-highlight.js`) и тест. Отрезки — в мире (`matrixWorld` сетки),
 * парами концов подряд: `[x1, y1, z1, x2, y2, z2, …]`.
 *
 * Скорость (задача 10Б 18.10.2026: «все предметы» зала — 780 тысяч треугольников, прежде 1,3 с на выбор): вершины
 * склеиваются в номера один раз на вершину (а не строкой на каждый угол каждой грани), ребро — числом из двух
 * номеров, а не склеенной строкой: тот же результат в несколько раз быстрее.
 */

import * as THREE from "three";

/* Точность склейки вершин: миллиметр — рёбра соседних частей модели сходятся до него. */
const QUANT = 1000;
/* Грани одного ребра больше этого — не считаем (мусор модели), ребро берётся как контур. */
const MAX_FACES = 8;
/* Ребро — пара номеров вершин одним числом: номеров меньше 2^26, пара — меньше 2^52 (целое без потерь). */
const EDGE_SPAN = 67_108_864;

const corner = new THREE.Vector3();

/*
 * Склейка вершин по миллиметру без строк (перф щелчка по предмету арены, 26.10.2026: ключ-строка на каждую вершину и поиск по ней
 * стоили заметную долю выбора): три целых → номер в таблице с открытой адресацией, память — три `Int32Array`.
 * `add(x, y, z)` отдаёт номер склеенной вершины, `size` — сколько их стало.
 */
function createWeld(capacity) {
  let span = 16;
  while (span < capacity * 2) span *= 2;
  const mask = span - 1;
  const table = new Int32Array(span).fill(-1);
  const coords = new Int32Array(Math.max(1, capacity) * 3);
  let size = 0;
  return {
    add(x, y, z) {
      let at = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
      for (;;) {
        const id = table[at];
        if (id < 0) {
          table[at] = size;
          coords[size * 3] = x;
          coords[size * 3 + 1] = y;
          coords[size * 3 + 2] = z;
          size += 1;
          return size - 1;
        }
        if (coords[id * 3] === x && coords[id * 3 + 1] === y && coords[id * 3 + 2] === z) return id;
        at = (at + 1) & mask;
      }
    },
  };
}

/**
 * @param {THREE.Mesh[]} meshes
 * @param {object} [options]
 * @param {number[][]} [options.rects] — только треугольники, чья середина развёртки внутри
 *   этих прямоугольников `[u0, v0, u1, v1]` (остров листа: контур места, а не листа)
 * @param {number} [options.crease] — угол излома, градусы (по умолчанию 55)
 * @returns {Float32Array}
 */
export function outlineSegments(meshes, { rects = null, crease = 55 } = {}) {
  const threshold = Math.cos((crease * Math.PI) / 180);
  const edges = new Map();
  /* Склеенные вершины всех сеток вызова: `x,y,z` в миллиметрах → номер. */
  let total = 0;
  for (const mesh of meshes) total += mesh.geometry.attributes.position?.count || 0;
  const joined = createWeld(total);
  const wrap = (value) => value - Math.floor(value);
  const inside = (u, v) => {
    const at = [wrap(u), wrap(v)];
    return rects.some((rect) => at[0] >= rect[0] - 0.002 && at[0] <= rect[2] + 0.002 && at[1] >= rect[1] - 0.002 && at[1] <= rect[3] + 0.002);
  };

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (!position) continue;
    const uv = geometry.attributes.uv;
    const index = geometry.index;
    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld;
    /* Спрятанные вещи пачки (`drawRange`, `orbit-stage setHiddenEntities`) не обводятся: следов от них нет. */
    const count = Math.min(index ? index.count : position.count, geometry.drawRange.start + geometry.drawRange.count);
    /* Вершины в мире — один раз на вершину, а не на каждый треугольник. */
    const world = new Float32Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      corner.fromBufferAttribute(position, vertex).applyMatrix4(matrix);
      world[vertex * 3] = corner.x;
      world[vertex * 3 + 1] = corner.y;
      world[vertex * 3 + 2] = corner.z;
    }
    const ids = new Int32Array(position.count);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      ids[vertex] = joined.add(Math.round(world[vertex * 3] * QUANT), Math.round(world[vertex * 3 + 1] * QUANT), Math.round(world[vertex * 3 + 2] * QUANT));
    }
    for (let face = 0; face + 2 < count; face += 3) {
      const a = index ? index.getX(face) : face;
      const b = index ? index.getX(face + 1) : face + 1;
      const c = index ? index.getX(face + 2) : face + 2;
      if (rects && uv) {
        const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
        const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
        if (!inside(u, v)) continue;
      }
      const ux = world[b * 3] - world[a * 3];
      const uy = world[b * 3 + 1] - world[a * 3 + 1];
      const uz = world[b * 3 + 2] - world[a * 3 + 2];
      const vx = world[c * 3] - world[a * 3];
      const vy = world[c * 3 + 1] - world[a * 3 + 1];
      const vz = world[c * 3 + 2] - world[a * 3 + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const size = Math.hypot(nx, ny, nz);
      if (size < 1e-12) continue;
      nx /= size;
      ny /= size;
      nz /= size;
      const keys = [ids[a], ids[b], ids[c]];
      const ends = [a, b, c];
      for (let side = 0; side < 3; side += 1) {
        const from = side;
        const to = (side + 1) % 3;
        if (keys[from] === keys[to]) continue;
        const id = keys[from] < keys[to] ? keys[from] * EDGE_SPAN + keys[to] : keys[to] * EDGE_SPAN + keys[from];
        let edge = edges.get(id);
        if (!edge) {
          edge = { from: ends[from], to: ends[to], world, normals: [] };
          edges.set(id, edge);
        }
        if (edge.normals.length < MAX_FACES) edge.normals.push(nx, ny, nz);
        else edge.overflow = true;
      }
    }
  }

  const out = [];
  for (const edge of edges.values()) {
    if (!edge.overflow) {
      /* Грани ребра — в кучки по направлению; нечётная кучка — контур. */
      const clusters = [];
      for (let at = 0; at < edge.normals.length; at += 3) {
        const n = [edge.normals[at], edge.normals[at + 1], edge.normals[at + 2]];
        const cluster = clusters.find((item) => item.n[0] * n[0] + item.n[1] * n[1] + item.n[2] * n[2] > threshold);
        if (cluster) cluster.count += 1;
        else clusters.push({ n, count: 1 });
      }
      if (!clusters.some((cluster) => cluster.count % 2 === 1)) continue;
    }
    const { world, from, to } = edge;
    out.push(world[from * 3], world[from * 3 + 1], world[from * 3 + 2], world[to * 3], world[to * 3 + 1], world[to * 3 + 2]);
  }
  return new Float32Array(out);
}
