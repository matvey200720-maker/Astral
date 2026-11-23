/*
 * Многоугольники — в треугольники (слои большой карты на радаре, задача 28).
 *
 * Радар рисует только треугольники, поэтому зона, обведённая контуром, и
 * буква подписи должны стать ими. Внешние пакеты здесь не нужны: нужен
 * разбор простого многоугольника с отверстиями, и его делает «срезание
 * ушей» — самая старая и самая устойчивая из тактик. Ухо — треугольник из
 * трёх соседних вершин, который лежит внутри контура и не накрывает чужих
 * вершин; срезали ухо — контур стал короче на одну вершину. Отверстие
 * присоединяется к внешнему контуру мостом из самой правой его точки, после
 * чего контур со всеми отверстиями — снова один многоугольник.
 *
 * Модуль чистый: на входе плоские массивы X, Y, на выходе индексы троек.
 */

/* Узел кольца: вершина с соседями. */
function makeNode(index, x, y) {
  return { index, x, y, prev: null, next: null, steiner: false };
}

function insertNode(index, x, y, last) {
  const node = makeNode(index, x, y);
  if (!last) {
    node.prev = node;
    node.next = node;
  } else {
    node.next = last.next;
    node.prev = last;
    last.next.prev = node;
    last.next = node;
  }
  return node;
}

function removeNode(node) {
  node.next.prev = node.prev;
  node.prev.next = node.next;
}

/** Удвоенная площадь со знаком по кольцу точек `data[start..end)` (X, Y подряд). */
function signedArea(data, start, end) {
  let sum = 0;
  for (let at = start, back = end - 2; at < end; at += 2) {
    sum += (data[back] - data[at]) * (data[at + 1] + data[back + 1]);
    back = at;
  }
  return sum;
}

function linkedList(data, start, end, clockwise) {
  let last = null;
  if (clockwise === signedArea(data, start, end) > 0) {
    for (let at = start; at < end; at += 2) last = insertNode(at / 2, data[at], data[at + 1], last);
  } else {
    for (let at = end - 2; at >= start; at -= 2) last = insertNode(at / 2, data[at], data[at + 1], last);
  }
  if (last && same(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

const same = (a, b) => a.x === b.x && a.y === b.y;

/* Удвоенная площадь треугольника p, q, r со знаком (положительная — «по часовой»). */
const area = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

function sign(value) {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/* Убирает совпавшие и лежащие на одной прямой вершины. */
function filterPoints(start, end = null) {
  if (!start) return start;
  let stop = end || start;
  let node = start;
  let again;
  do {
    again = false;
    if (!node.steiner && (same(node, node.next) || area(node.prev, node, node.next) === 0)) {
      removeNode(node);
      node = stop = node.prev;
      if (node === node.next) break;
      again = true;
    } else {
      node = node.next;
    }
  } while (again || node !== stop);
  return stop;
}

function onSegment(p, q, r) {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

function intersects(p1, q1, p2, q2) {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py)
  );
}

function isEar(ear) {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;
  if (area(a, b, c) >= 0) return false; // угол «наружу» — не ухо
  const x0 = Math.min(a.x, b.x, c.x);
  const y0 = Math.min(a.y, b.y, c.y);
  const x1 = Math.max(a.x, b.x, c.x);
  const y1 = Math.max(a.y, b.y, c.y);
  let node = c.next;
  while (node !== a) {
    if (
      node.x >= x0 &&
      node.x <= x1 &&
      node.y >= y0 &&
      node.y <= y1 &&
      pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, node.x, node.y) &&
      area(node.prev, node, node.next) >= 0
    )
      return false;
    node = node.next;
  }
  return true;
}

function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a, b) {
  let node = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (node.y > py !== node.next.y > py && node.next.y !== node.y && px < ((node.next.x - node.x) * (py - node.y)) / (node.next.y - node.y) + node.x)
      inside = !inside;
    node = node.next;
  } while (node !== a);
  return inside;
}

function intersectsPolygon(a, b) {
  let node = a;
  do {
    if (
      node.index !== a.index &&
      node.next.index !== a.index &&
      node.index !== b.index &&
      node.next.index !== b.index &&
      intersects(node, node.next, a, b)
    )
      return true;
    node = node.next;
  } while (node !== a);
  return false;
}

function isValidDiagonal(a, b) {
  return (
    a.next.index !== b.index &&
    a.prev.index !== b.index &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
      (same(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
  );
}

function splitPolygon(a, b) {
  const a2 = makeNode(a.index, a.x, a.y);
  const b2 = makeNode(b.index, b.x, b.y);
  const an = a.next;
  const bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

function cureLocalIntersections(start, triangles) {
  let node = start;
  do {
    const a = node.prev;
    const b = node.next.next;
    if (!same(a, b) && intersects(a, node, node.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.index, node.index, b.index);
      removeNode(node);
      removeNode(node.next);
      node = start = b;
    }
    node = node.next;
  } while (node !== start);
  return filterPoints(node);
}

function splitEarcut(start, triangles) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.index !== b.index && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, 0);
        earcutLinked(c, triangles, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function earcutLinked(ear, triangles, pass) {
  if (!ear) return;
  let stop = ear;
  let prev;
  let next;
  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;
    if (isEar(ear)) {
      triangles.push(prev.index, ear.index, next.index);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) earcutLinked(filterPoints(ear), triangles, 1);
      else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles);
        earcutLinked(ear, triangles, 2);
      } else if (pass === 2) splitEarcut(ear, triangles);
      break;
    }
  }
}

function getLeftmost(start) {
  let node = start;
  let leftmost = start;
  do {
    if (node.x < leftmost.x || (node.x === leftmost.x && node.y < leftmost.y)) leftmost = node;
    node = node.next;
  } while (node !== start);
  return leftmost;
}

function sectorContainsSector(m, p) {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function findHoleBridge(hole, outer) {
  let node = outer;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let bridge = null;
  do {
    if (hy <= node.y && hy >= node.next.y && node.next.y !== node.y) {
      const x = node.x + ((hy - node.y) * (node.next.x - node.x)) / (node.next.y - node.y);
      if (x <= hx && x > qx) {
        qx = x;
        bridge = node.x < node.next.x ? node : node.next;
        if (x === hx) return bridge;
      }
    }
    node = node.next;
  } while (node !== outer);
  if (!bridge) return null;
  const stop = bridge;
  const mx = bridge.x;
  const my = bridge.y;
  let tanMin = Infinity;
  node = bridge;
  do {
    if (hx >= node.x && node.x >= mx && hx !== node.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, node.x, node.y)) {
      const tan = Math.abs(hy - node.y) / (hx - node.x);
      if (locallyInside(node, hole) && (tan < tanMin || (tan === tanMin && (node.x > bridge.x || (node.x === bridge.x && sectorContainsSector(bridge, node)))))) {
        bridge = node;
        tanMin = tan;
      }
    }
    node = node.next;
  } while (node !== stop);
  return bridge;
}

function eliminateHole(hole, outer) {
  const bridge = findHoleBridge(hole, outer);
  if (!bridge) return outer;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

function eliminateHoles(data, holeIndices, outer) {
  const queue = [];
  for (let i = 0; i < holeIndices.length; i += 1) {
    const start = holeIndices[i] * 2;
    const end = i < holeIndices.length - 1 ? holeIndices[i + 1] * 2 : data.length;
    const list = linkedList(data, start, end, false);
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const hole of queue) outer = eliminateHole(hole, outer);
  return outer;
}

/**
 * Треугольники многоугольника с отверстиями.
 *
 * @param {ArrayLike<number>} data X и Y подряд: сперва внешний контур, затем
 *   отверстия одно за другим
 * @param {number[]} [holeIndices] номера ВЕРШИН (не чисел), с которых
 *   начинаются отверстия
 * @returns {number[]} номера вершин по три на треугольник
 */
export function triangulate(data, holeIndices = []) {
  const hasHoles = holeIndices.length > 0;
  const outerLength = hasHoles ? holeIndices[0] * 2 : data.length;
  let outer = linkedList(data, 0, outerLength, true);
  const triangles = [];
  if (!outer || outer.next === outer.prev) return triangles;
  if (hasHoles) outer = eliminateHoles(data, holeIndices, outer);
  earcutLinked(outer, triangles, 0);
  return triangles;
}

/* ———————————————————— контуры со вложенностью ———————————————————— */

/** Лежит ли точка внутри контура (чётность пересечений). */
function inside(loop, x, y) {
  let hit = false;
  for (let at = 0, back = loop.length - 2; at < loop.length; back = at, at += 2) {
    const ax = loop[at];
    const ay = loop[at + 1];
    const bx = loop[back];
    const by = loop[back + 1];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

function loopBox(loop) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let at = 0; at < loop.length; at += 2) {
    x0 = Math.min(x0, loop[at]);
    x1 = Math.max(x1, loop[at]);
    y0 = Math.min(y0, loop[at + 1]);
    y1 = Math.max(y1, loop[at + 1]);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Контуры с отверстиями — в треугольники.
 *
 * Контур внутри нечётного числа других — отверстие ближайшего из них, во
 * всех остальных случаях — отдельный остров (правило «чёт-нечет»: так же
 * рисует заливку и сама карта). Контуры короче трёх точек отбрасываются.
 *
 * @param {ArrayLike<number>[]} loops контуры: плоские X, Y; замыкать вручную не нужно
 * @returns {{ points: Float64Array, triangles: number[], islands: number }}
 *   `points` — все вершины контуров подряд, `triangles` — номера вершин по три
 */
export function triangulateLoops(loops) {
  const rings = [];
  for (const loop of loops) {
    let count = loop.length;
    if (count >= 4 && loop[0] === loop[count - 2] && loop[1] === loop[count - 1]) count -= 2;
    if (count < 6) continue;
    const ring = Array.from(loop).slice(0, count);
    rings.push({ ring, box: loopBox(ring), parent: -1, depth: 0, offset: 0 });
  }
  /* Вложенность: контур в кольце его первой вершиной. Охват — по рамке, дальше
     точка в контуре; ближайший владелец — самый вложенный из охватывающих. */
  for (let i = 0; i < rings.length; i += 1) {
    const { ring, box } = rings[i];
    const x = ring[0];
    const y = ring[1];
    let best = -1;
    let bestArea = Infinity;
    let depth = 0;
    for (let j = 0; j < rings.length; j += 1) {
      if (i === j) continue;
      const other = rings[j];
      if (x < other.box.x0 || x > other.box.x1 || y < other.box.y0 || y > other.box.y1) continue;
      if (box.x0 < other.box.x0 || box.x1 > other.box.x1 || box.y0 < other.box.y0 || box.y1 > other.box.y1) continue;
      if (!inside(other.ring, x, y)) continue;
      depth += 1;
      const size = (other.box.x1 - other.box.x0) * (other.box.y1 - other.box.y0);
      if (size < bestArea) {
        bestArea = size;
        best = j;
      }
    }
    rings[i].depth = depth;
    rings[i].parent = best;
  }
  const points = [];
  const triangles = [];
  let islands = 0;
  for (let i = 0; i < rings.length; i += 1) {
    if (rings[i].depth % 2) continue;
    islands += 1;
    const holes = rings.filter((item, at) => at !== i && item.depth % 2 === 1 && item.parent === i);
    const data = [...rings[i].ring];
    const holeIndices = [];
    for (const hole of holes) {
      holeIndices.push(data.length / 2);
      data.push(...hole.ring);
    }
    const base = points.length / 2;
    for (const value of data) points.push(value);
    for (const index of triangulate(data, holeIndices)) triangles.push(base + index);
  }
  return { points: Float64Array.from(points), triangles, islands };
}

/** Удвоенная площадь треугольника по номерам вершин — для проверок и отсева выродков. */
export function trianglesArea(points, triangles) {
  let sum = 0;
  for (let at = 0; at < triangles.length; at += 3) {
    const a = triangles[at] * 2;
    const b = triangles[at + 1] * 2;
    const c = triangles[at + 2] * 2;
    sum += Math.abs((points[b] - points[a]) * (points[c + 1] - points[a + 1]) - (points[c] - points[a]) * (points[b + 1] - points[a + 1])) / 2;
  }
  return sum;
}
