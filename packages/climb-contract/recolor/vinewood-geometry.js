/*
 * Геометрия букв надписи на холме — общая у кадра окна и установщика.
 *
 * Буква приходит маской (растр глифа, его рисует окно шрифтом Windows):
 *   1. контуры маски — «бегущими квадратами» по порогу альфы, с точкой на
 *      ребре по линейной интерполяции (края букв гладкие, а не ступенькой);
 *   2. упрощение Дугласа — Пекера с допуском в долях пикселя;
 *   3. внешние контуры и дырки («О», «А», «8») — по знаку площади и
 *      вложенности, треугольники — «ушами» с мостами к дыркам (earcut);
 *   4. лицо, спинка и торцы — тонкий лист металла, как у букв игры.
 * Всё детерминировано: одна маска — одна сетка, и в кадре, и в игре.
 */

const EPSILON = 1e-9;

/* ------------------------------------------------------------------ *
 * Контуры маски
 * ------------------------------------------------------------------ */

/**
 * Контуры маски `{ alpha: Uint8Array|Uint8ClampedArray (по пикселю), width,
 * height }` по порогу `threshold` (0…255): `[[x, y, …]]` — замкнутые
 * ломаные в пикселях (y вниз). Внешние контуры — против часовой стрелки
 * в осях «y вверх» (положительная площадь после переворота), дырки — по.
 */
export function traceMask(mask, { threshold = 128 } = {}) {
  const { width, height } = mask;
  const value = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask.alpha[y * width + x]);
  /* Узлы сетки — центры пикселей; клетка (x, y) — между узлами x…x+1, y…y+1. */
  const inside = (x, y) => value(x, y) >= threshold;
  const cut = (a, b) => {
    const span = b - a;
    return Math.abs(span) < EPSILON ? 0.5 : Math.min(1, Math.max(0, (threshold - a) / span));
  };
  /* Точки на рёбрах клеток: ключ ребра → точка. */
  const edgePoint = (x, y, side) => {
    /* side: 0 — верх (x…x+1, y), 1 — право (x+1, y…y+1), 2 — низ (x…x+1, y+1), 3 — лево (x, y…y+1). */
    if (side === 0) return [x + cut(value(x, y), value(x + 1, y)), y];
    if (side === 1) return [x + 1, y + cut(value(x + 1, y), value(x + 1, y + 1))];
    if (side === 2) return [x + cut(value(x, y + 1), value(x + 1, y + 1)), y + 1];
    return [x, y + cut(value(x, y), value(x, y + 1))];
  };
  const edgeKey = (x, y, side) => {
    if (side === 0) return `h${x},${y}`;
    if (side === 2) return `h${x},${y + 1}`;
    if (side === 1) return `v${x + 1},${y}`;
    return `v${x},${y}`;
  };
  /*
   * Отрезки клетки по её коду (углы: 1 — левый верх, 2 — правый верх,
   * 4 — правый низ, 8 — левый низ). Отрезок идёт так, чтобы «внутри»
   * оставалось слева при обходе в осях «y вниз» — тогда внешние контуры
   * выходят по часовой (в «y вниз»), а после переворота y — против.
   */
  const SEGMENTS = {
    1: [[3, 0]],
    2: [[0, 1]],
    3: [[3, 1]],
    4: [[1, 2]],
    5: [[3, 0], [1, 2]],
    6: [[0, 2]],
    7: [[3, 2]],
    8: [[2, 3]],
    9: [[2, 0]],
    10: [[0, 1], [2, 3]],
    11: [[2, 1]],
    12: [[1, 3]],
    13: [[1, 0]],
    14: [[0, 3]],
  };
  const next = new Map();
  const points = new Map();
  for (let y = -1; y < height; y += 1)
    for (let x = -1; x < width; x += 1) {
      const code = (inside(x, y) ? 1 : 0) | (inside(x + 1, y) ? 2 : 0) | (inside(x + 1, y + 1) ? 4 : 0) | (inside(x, y + 1) ? 8 : 0);
      let segments = SEGMENTS[code];
      if (!segments) continue;
      /* Седло: середина клетки решает, соединены ли диагональные углы. */
      if (code === 5 || code === 10) {
        const centre = (value(x, y) + value(x + 1, y) + value(x + 1, y + 1) + value(x, y + 1)) / 4;
        if (centre >= threshold) segments = code === 5 ? [[3, 2], [1, 0]] : [[0, 3], [2, 1]];
      }
      for (const [from, to] of segments) {
        const a = edgeKey(x, y, from);
        const b = edgeKey(x, y, to);
        if (!points.has(a)) points.set(a, edgePoint(x, y, from));
        if (!points.has(b)) points.set(b, edgePoint(x, y, to));
        next.set(a, b);
      }
    }
  const contours = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let key = start;
    for (let guard = 0; guard < next.size + 1 && key && !seen.has(key); guard += 1) {
      seen.add(key);
      const [px, py] = points.get(key);
      ring.push(px + 0.5, py + 0.5);
      key = next.get(key);
    }
    if (ring.length >= 6) contours.push(ring);
  }
  return contours;
}

/* Площадь ломаной (по формуле шнурка), знак — направление обхода. */
export function ringArea(ring) {
  let sum = 0;
  for (let at = 0, count = ring.length; at < count; at += 2) {
    const next = (at + 2) % count;
    sum += ring[at] * ring[next + 1] - ring[next] * ring[at + 1];
  }
  return sum / 2;
}

/** Упрощение замкнутой ломаной (Дуглас — Пекер) с допуском `tolerance`. */
export function simplifyRing(ring, tolerance = 0.6) {
  const count = ring.length / 2;
  if (count <= 4) return ring.slice();
  /* Опорные точки — самая дальняя пара: замкнутое кольцо режется на две дуги. */
  let first = 0;
  let second = 0;
  let best = -1;
  for (let at = 0; at < count; at += 1) {
    const dx = ring[at * 2] - ring[0];
    const dy = ring[at * 2 + 1] - ring[1];
    const distance = dx * dx + dy * dy;
    if (distance > best) {
      best = distance;
      second = at;
    }
  }
  const keep = new Uint8Array(count);
  keep[first] = 1;
  keep[second] = 1;
  const point = (index) => [ring[(index % count) * 2], ring[(index % count) * 2 + 1]];
  const limit = tolerance * tolerance;
  const stack = [
    [first, second],
    [second, first + count],
  ];
  while (stack.length) {
    const [from, to] = stack.pop();
    if (to - from < 2) continue;
    const [ax, ay] = point(from);
    const [bx, by] = point(to);
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    let farthest = -1;
    let distance = -1;
    for (let index = from + 1; index < to; index += 1) {
      const [px, py] = point(index);
      let d;
      if (length < EPSILON) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const cross = (px - ax) * dy - (py - ay) * dx;
        d = (cross * cross) / length;
      }
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (distance > limit) {
      keep[farthest % count] = 1;
      stack.push([from, farthest], [farthest, to]);
    }
  }
  const out = [];
  for (let at = 0; at < count; at += 1) if (keep[at]) out.push(ring[at * 2], ring[at * 2 + 1]);
  return out.length >= 6 ? out : ring.slice();
}

/**
 * Многоугольники с дырками из контуров: `[{ outer: ring, holes: [ring] }]`
 * в осях «y вверх» (внешний — против часовой, дырки — по часовой).
 * Крошечные кольца (площадь меньше `minArea`) отбрасываются.
 */
export function ringsToPolygons(rings, { minArea = 4 } = {}) {
  const flipped = rings.map((ring) => {
    const out = new Array(ring.length);
    for (let at = 0; at < ring.length; at += 2) {
      out[at] = ring[at];
      out[at + 1] = -ring[at + 1];
    }
    return out;
  });
  const items = flipped.map((ring) => ({ ring, area: ringArea(ring) })).filter((item) => Math.abs(item.area) >= minArea);
  /* Глубина вложенности: чётная — внешний контур, нечётная — дырка. */
  const contains = (ring, x, y) => {
    let inside = false;
    for (let at = 0, j = ring.length - 2; at < ring.length; j = at, at += 2) {
      const xi = ring[at];
      const yi = ring[at + 1];
      const xj = ring[j];
      const yj = ring[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const sample = (ring) => {
    /* Точка чуть внутри первого ребра — для проверки вложенности. */
    const [ax, ay, bx, by] = [ring[0], ring[1], ring[2], ring[3]];
    return [(ax + bx) / 2, (ay + by) / 2];
  };
  const depth = items.map((item) => {
    const [x, y] = sample(item.ring);
    return items.reduce((sum, other) => sum + (other !== item && Math.abs(other.area) > Math.abs(item.area) && contains(other.ring, x, y) ? 1 : 0), 0);
  });
  const polygons = [];
  items.forEach((item, index) => {
    if (depth[index] % 2) return;
    const outer = item.area > 0 ? item.ring : reverseRing(item.ring);
    polygons.push({ outer, holes: [], area: Math.abs(item.area), depth: depth[index] });
  });
  items.forEach((item, index) => {
    if (!(depth[index] % 2)) return;
    const [x, y] = sample(item.ring);
    /* Дырка — в самом тесном внешнем контуре, что её содержит. */
    let owner = null;
    for (const polygon of polygons) if (polygon.depth === depth[index] - 1 && contains(polygon.outer, x, y) && (!owner || polygon.area < owner.area)) owner = polygon;
    if (owner) owner.holes.push(item.area < 0 ? item.ring : reverseRing(item.ring));
  });
  return polygons.map(({ outer, holes }) => ({ outer, holes }));
}

export function reverseRing(ring) {
  const out = new Array(ring.length);
  for (let at = 0, count = ring.length / 2; at < count; at += 1) {
    out[at * 2] = ring[(count - 1 - at) * 2];
    out[at * 2 + 1] = ring[(count - 1 - at) * 2 + 1];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Треугольники: уши с мостами к дыркам (по мотивам mapbox/earcut, ISC)
 * ------------------------------------------------------------------ */

function node(index, x, y) {
  return { i: index, x, y, prev: null, next: null, steiner: false };
}

function insertNode(index, x, y, last) {
  const item = node(index, x, y);
  if (!last) {
    item.prev = item;
    item.next = item;
  } else {
    item.next = last.next;
    item.prev = last;
    last.next.prev = item;
    last.next = item;
  }
  return item;
}

function removeNode(item) {
  item.next.prev = item.prev;
  item.prev.next = item.next;
}

const equals = (a, b) => a.x === b.x && a.y === b.y;
const area = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

function linkedList(data, start, end, dim, clockwise) {
  let last = null;
  let sum = 0;
  for (let at = start, j = end - dim; at < end; j = at, at += dim) sum += (data[j] - data[at]) * (data[at + 1] + data[j + 1]);
  if (clockwise === sum > 0) for (let at = start; at < end; at += dim) last = insertNode(at / dim, data[at], data[at + 1], last);
  else for (let at = end - dim; at >= start; at -= dim) last = insertNode(at / dim, data[at], data[at + 1], last);
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  let p = start;
  let again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== end);
  return end;
}

function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

function isEar(ear) {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;
  if (area(a, b, c) >= 0) return false;
  let p = ear.next.next;
  while (p !== ear.prev) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

function sign(value) {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
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

function intersectsPolygon(a, b) {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a, b) {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next.y > py && p.next.y !== p.y && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}

function isValidDiagonal(a, b) {
  return (
    a.next.i !== b.i &&
    a.prev.i !== b.i &&
    !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
  );
}

function splitPolygon(a, b) {
  const a2 = node(a.i, a.x, a.y);
  const b2 = node(b.i, b.x, b.y);
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
  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i, p.i, b.i);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function splitEarcut(start, triangles) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
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
  while (ear.prev !== ear.next) {
    const prev = ear.prev;
    const next = ear.next;
    if (isEar(ear)) {
      triangles.push(prev.i, ear.i, next.i);
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
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

function sectorContainsSector(m, p) {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function findHoleBridge(hole, outerNode) {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m = null;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;
  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

function eliminateHole(hole, outerNode) {
  const bridge = findHoleBridge(hole, outerNode);
  if (!bridge) return outerNode;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

/**
 * Треугольники многоугольника с дырками: `data` — `[x, y, x, y, …]`,
 * `holeIndices` — с какой вершины начинается каждая дырка. Ответ — номера
 * вершин тройками.
 */
export function earcut(data, holeIndices = [], dim = 2) {
  const hasHoles = holeIndices.length > 0;
  const outerLength = hasHoles ? holeIndices[0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLength, dim, true);
  const triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  if (hasHoles) {
    const queue = [];
    for (let at = 0; at < holeIndices.length; at += 1) {
      const start = holeIndices[at] * dim;
      const end = at < holeIndices.length - 1 ? holeIndices[at + 1] * dim : data.length;
      const list = linkedList(data, start, end, dim, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort((a, b) => a.x - b.x);
    for (const hole of queue) outerNode = eliminateHole(hole, outerNode);
  }
  earcutLinked(outerNode, triangles, 0);
  return triangles;
}

/** Треугольники многоугольника `{ outer, holes }`: `{ points: [x, y, …], indices }`. */
export function triangulatePolygon(polygon) {
  const points = [...polygon.outer];
  const holes = [];
  for (const hole of polygon.holes || []) {
    holes.push(points.length / 2);
    points.push(...hole);
  }
  return { points, indices: earcut(points, holes) };
}

/* ------------------------------------------------------------------ *
 * Лист металла
 * ------------------------------------------------------------------ */

/**
 * Сетка буквы — тонкий лист: `polygons` в своих единицах (`unit` — метров
 * в единице), `thickness` — толщина в метрах. Плоскость буквы — XZ (Z
 * вверх, лицо смотрит в −Y, как у плашек), начало — середина низа буквы.
 * Ответ: `{ positions, normals, uvs, indices }` (развёртка — метры по X и
 * Z: лист металла кладёт окно или установщик).
 */
export function sheetMesh(polygons, { unit = 1, thickness = 0.12, originX = 0, originY = 0, sides = true } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const half = thickness / 2;
  const push = (x, y, z, nx, ny, nz, u, v) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  for (const polygon of polygons) {
    const { points, indices: triangles } = triangulatePolygon(polygon);
    const toWorld = (at) => [(points[at * 2] - originX) * unit, (points[at * 2 + 1] - originY) * unit];
    const count = points.length / 2;
    /* Лицо (−Y) и спинка (+Y): обход лица — против часовой, глядя на него. */
    const front = [];
    const back = [];
    for (let at = 0; at < count; at += 1) {
      const [x, z] = toWorld(at);
      front.push(push(x, -half, z, 0, -1, 0, x, z));
      back.push(push(x, half, z, 0, 1, 0, -x, z));
    }
    /* Треугольники earcut — против часовой в осях (x, z): так их и видит
       зритель у лица (−Y); у спинки обход обратный. Лицевая грань в игре —
       против часовой, если смотреть на неё (как у плашек эмблем). */
    for (let at = 0; at < triangles.length; at += 3) {
      const [a, b, c] = [triangles[at], triangles[at + 1], triangles[at + 2]];
      indices.push(front[a], front[b], front[c]);
      indices.push(back[a], back[c], back[b]);
    }
    if (!sides) continue;
    /* Торцы по каждому кольцу: нормаль — наружу от буквы. */
    for (const ring of [polygon.outer, ...(polygon.holes || [])]) {
      const ringCount = ring.length / 2;
      let along = 0;
      for (let at = 0; at < ringCount; at += 1) {
        const next = (at + 1) % ringCount;
        const ax = (ring[at * 2] - originX) * unit;
        const az = (ring[at * 2 + 1] - originY) * unit;
        const bx = (ring[next * 2] - originX) * unit;
        const bz = (ring[next * 2 + 1] - originY) * unit;
        const length = Math.hypot(bx - ax, bz - az);
        if (length < EPSILON) continue;
        /* Кольцо против часовой (наружный контур) — наружу смотрит правая нормаль. */
        const nx = (bz - az) / length;
        const nz = -(bx - ax) / length;
        const a0 = push(ax, -half, az, nx, 0, nz, along, 0);
        const a1 = push(ax, half, az, nx, 0, nz, along, thickness);
        const b0 = push(bx, -half, bz, nx, 0, nz, along + length, 0);
        const b1 = push(bx, half, bz, nx, 0, nz, along + length, thickness);
        indices.push(a0, b1, b0, a0, a1, b1);
        along += length;
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

/** Рамка сетки: `{ min: [x, y, z], max: [x, y, z] }`. */
export function meshBounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < mesh.positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[at + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[at + axis]);
    }
  return { min, max };
}

/** Сетки подряд — одной: номера вершин сдвигаются. */
export function mergeMeshes(meshes) {
  let vertices = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    vertices += mesh.positions.length / 3;
    indexCount += mesh.indices.length;
  }
  const out = { positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3), uvs: new Float32Array(vertices * 2), indices: new Uint32Array(indexCount) };
  let vertexAt = 0;
  let indexAt = 0;
  for (const mesh of meshes) {
    out.positions.set(mesh.positions, vertexAt * 3);
    out.normals.set(mesh.normals, vertexAt * 3);
    out.uvs.set(mesh.uvs, vertexAt * 2);
    for (let at = 0; at < mesh.indices.length; at += 1) out.indices[indexAt + at] = mesh.indices[at] + vertexAt;
    vertexAt += mesh.positions.length / 3;
    indexAt += mesh.indices.length;
  }
  return out;
}

/**
 * Сетка в мире: поворот вокруг Z на `yaw` (радианы), сдвиг `offset`.
 * Нормали поворачиваются вместе с сеткой; развёртка — как была.
 */
export function placeMesh(mesh, { yaw = 0, offset = [0, 0, 0], scale = 1 } = {}) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let at = 0; at < mesh.positions.length; at += 3) {
    const x = mesh.positions[at] * scale;
    const y = mesh.positions[at + 1] * scale;
    positions[at] = x * cos - y * sin + offset[0];
    positions[at + 1] = x * sin + y * cos + offset[1];
    positions[at + 2] = mesh.positions[at + 2] * scale + offset[2];
    const nx = mesh.normals[at];
    const ny = mesh.normals[at + 1];
    normals[at] = nx * cos - ny * sin;
    normals[at + 1] = nx * sin + ny * cos;
    normals[at + 2] = mesh.normals[at + 2];
  }
  return { positions, normals, uvs: mesh.uvs, indices: mesh.indices };
}
