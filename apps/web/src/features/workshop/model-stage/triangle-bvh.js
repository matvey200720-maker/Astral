/*
 * Ускорение луча по треугольникам одной неподвижной сетки (ТЗ 26.10.2026, перф щелчка и наведения: «луч ≈ 200 мс на ×4 — перебор
 * всех треугольников»). Лучи three.js перебирают каждый треугольник каждой сетки, чью коробку пересёк луч; у зала Majestic их 810 тысяч
 * в 1 760 сетках, и одно наведение на ×4 стоило 20–40 мс (профиль: `fromBufferAttribute`, `intersectTriangle`). Здесь — дерево коробок
 * (BVH) над треугольниками сетки: луч идёт по ветвям, что он пересёк, и считает только их листья.
 *
 * Чистые массивы, без three.js и без DOM: дерево строит поток (`ray-accel-worker.js`), а окно ходит по нему (`ray-accel.js`).
 *
 * Раскладка: узлы по порядку обхода в глубину, левый потомок — следующий за узлом, номер правого лежит в `links`:
 *   `bounds[i * 6 …]` — коробка узла (мин. x y z, макс. x y z);
 *   `links[i * 2]`    — у узла: номер правого потомка, у листа: с какого места `order` его треугольники;
 *   `links[i * 2 + 1]` — у листа: сколько у него треугольников (> 0), у узла 0.
 * `order` — номера треугольников сетки в порядке листьев.
 */

/** Сетки легче — перебор всех треугольников дешевле дерева: дерево для них не строится. */
export const MIN_ACCEL_TRIANGLES = 200;
/** Столько треугольников в листе и меньше. */
const LEAF = 8;

/**
 * @param {Float32Array} positions — вершины (x y z подряд)
 * @param {Uint16Array|Uint32Array} indices — тройки номеров вершин
 * @returns {{ bounds: Float32Array, links: Int32Array, order: Uint32Array, triangles: number } | null}
 */
export function buildTriangleBvh(positions, indices) {
  const count = Math.floor(indices.length / 3);
  if (count < MIN_ACCEL_TRIANGLES) return null;
  /* Коробка и середина каждого треугольника — один раз: дальше дерево работает с ними, а не с вершинами. */
  const box = new Float32Array(count * 6);
  const mid = new Float32Array(count * 3);
  for (let triangle = 0; triangle < count; triangle += 1) {
    const a = indices[triangle * 3] * 3;
    const b = indices[triangle * 3 + 1] * 3;
    const c = indices[triangle * 3 + 2] * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const x = positions[a + axis];
      const y = positions[b + axis];
      const z = positions[c + axis];
      const low = Math.min(x, y, z);
      const high = Math.max(x, y, z);
      box[triangle * 6 + axis] = low;
      box[triangle * 6 + 3 + axis] = high;
      mid[triangle * 3 + axis] = (low + high) / 2;
    }
  }
  const order = new Uint32Array(count);
  for (let triangle = 0; triangle < count; triangle += 1) order[triangle] = triangle;
  /* Узлов при делении пополам — не больше двух на лист; лист — от LEAF / 2 треугольников. */
  const capacity = Math.ceil(count / (LEAF / 2)) * 2 + 1;
  const bounds = new Float32Array(capacity * 6);
  const links = new Int32Array(capacity * 2);
  let nodes = 0;

  /* Серединное деление: порядок так, что до `at` — треугольники с серединой не правее серединной, после — не левее. */
  function select(from, to, at, axis) {
    let low = from;
    let high = to - 1;
    while (low < high) {
      const pivot = mid[order[(low + high) >> 1] * 3 + axis];
      let left = low;
      let right = high;
      while (left <= right) {
        while (mid[order[left] * 3 + axis] < pivot) left += 1;
        while (mid[order[right] * 3 + axis] > pivot) right -= 1;
        if (left <= right) {
          const held = order[left];
          order[left] = order[right];
          order[right] = held;
          left += 1;
          right -= 1;
        }
      }
      if (at <= right) high = right;
      else if (at >= left) low = left;
      else return;
    }
  }

  function grow(from, to) {
    const node = nodes;
    nodes += 1;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cz0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    let cz1 = -Infinity;
    for (let at = from; at < to; at += 1) {
      const triangle = order[at];
      const base = triangle * 6;
      if (box[base] < x0) x0 = box[base];
      if (box[base + 1] < y0) y0 = box[base + 1];
      if (box[base + 2] < z0) z0 = box[base + 2];
      if (box[base + 3] > x1) x1 = box[base + 3];
      if (box[base + 4] > y1) y1 = box[base + 4];
      if (box[base + 5] > z1) z1 = box[base + 5];
      const m = triangle * 3;
      if (mid[m] < cx0) cx0 = mid[m];
      if (mid[m] > cx1) cx1 = mid[m];
      if (mid[m + 1] < cy0) cy0 = mid[m + 1];
      if (mid[m + 1] > cy1) cy1 = mid[m + 1];
      if (mid[m + 2] < cz0) cz0 = mid[m + 2];
      if (mid[m + 2] > cz1) cz1 = mid[m + 2];
    }
    const at6 = node * 6;
    bounds[at6] = x0;
    bounds[at6 + 1] = y0;
    bounds[at6 + 2] = z0;
    bounds[at6 + 3] = x1;
    bounds[at6 + 4] = y1;
    bounds[at6 + 5] = z1;
    const size = to - from;
    /* Все середины в одной точке (мусорная сетка) — делить нечем: лист, как бы он ни был велик. */
    const spread = Math.max(cx1 - cx0, cy1 - cy0, cz1 - cz0);
    if (size <= LEAF || spread <= 0) {
      links[node * 2] = from;
      links[node * 2 + 1] = size;
      return node;
    }
    const axis = cx1 - cx0 >= cy1 - cy0 && cx1 - cx0 >= cz1 - cz0 ? 0 : cy1 - cy0 >= cz1 - cz0 ? 1 : 2;
    const half = from + (size >> 1);
    select(from, to, half, axis);
    grow(from, half);
    links[node * 2] = grow(half, to);
    links[node * 2 + 1] = 0;
    return node;
  }

  grow(0, count);
  return { bounds: bounds.slice(0, nodes * 6), links: links.slice(0, nodes * 2), order, triangles: count };
}

/** Что в дереве сошлось с сеткой: те же номера и ни один треугольник не потерян (тест и сторожевая проверка при получении). */
export function bvhFits(bvh, indices) {
  return Boolean(bvh) && bvh.triangles === Math.floor(indices.length / 3) && bvh.order instanceof Uint32Array && bvh.order.length === bvh.triangles;
}

const stack = new Int32Array(96);
/* Запас на округление: попадание ровно по кромке коробки (плоский пол — коробка нулевой толщины) не должно пропадать. */
const SLACK = 1e-5;

/**
 * Обход дерева лучом в осях сетки: `visit(triangle)` вызывается для каждого треугольника из листьев, чьи коробки луч пересёк
 * на отрезке `[0, reach]` (расстояния — вдоль `direction`, как он дан: у ненормированного луча — в его же единицах).
 *
 * @param {object} bvh — результат `buildTriangleBvh`
 * @param {number} ox @param {number} oy @param {number} oz — начало луча
 * @param {number} dx @param {number} dy @param {number} dz — направление
 * @param {number} reach — дальше этого не смотрим
 * @param {(triangle: number) => void} visit
 */
export function walkTriangleBvh(bvh, ox, oy, oz, dx, dy, dz, reach, visit) {
  const { bounds, links, order } = bvh;
  /* Деление на ноль даёт ±Infinity — плиточный тест ниже с ним работает (0 · Infinity = NaN отсекается сравнениями). */
  const ix = 1 / dx;
  const iy = 1 / dy;
  const iz = 1 / dz;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top];
    const base = node * 6;
    let near = 0;
    let far = reach;
    let t0 = (bounds[base] - ox) * ix;
    let t1 = (bounds[base + 3] - ox) * ix;
    if (t0 > t1) {
      const held = t0;
      t0 = t1;
      t1 = held;
    }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near - SLACK > far) continue;
    t0 = (bounds[base + 1] - oy) * iy;
    t1 = (bounds[base + 4] - oy) * iy;
    if (t0 > t1) {
      const held = t0;
      t0 = t1;
      t1 = held;
    }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near - SLACK > far) continue;
    t0 = (bounds[base + 2] - oz) * iz;
    t1 = (bounds[base + 5] - oz) * iz;
    if (t0 > t1) {
      const held = t0;
      t0 = t1;
      t1 = held;
    }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    if (near - SLACK > far) continue;
    const count = links[node * 2 + 1];
    if (count > 0) {
      const start = links[node * 2];
      for (let at = start; at < start + count; at += 1) visit(order[at]);
    } else {
      stack[top++] = links[node * 2];
      stack[top++] = node + 1;
    }
  }
}

/** Лента узлов дерева — для передачи между потоками без копии. */
export const bvhTransferList = (bvhs) => {
  const list = [];
  for (const bvh of bvhs) if (bvh) list.push(bvh.bounds.buffer, bvh.links.buffer, bvh.order.buffer);
  return list;
};
