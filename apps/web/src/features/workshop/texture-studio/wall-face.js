/*
 * Стена под щелчком (ТЗ ведущей 18.10.2026, 3Б): человек щёлкает по кадру — студия
 * открывается не на всю часть здания, а на ту стену, по которой он щёлкнул: связную
 * плоскую группу треугольников вокруг попадания.
 *
 * Модуль чистый — без three и без DOM, на плоских массивах (тесты идут на
 * придуманных сетках):
 *
 *   positions — вершины в мире, метры, по три числа на вершину;
 *   uvs       — развёртка, по два числа на вершину (нет — стена без развёртки);
 *   index     — индексы треугольников (нет — вершины идут подряд по три);
 *   seed      — номер треугольника под курсором;
 *   facing    — куда смотрит глаз (нормаль попадания, развёрнутая к глазу): стена
 *               разворачивается лицом к нему.
 *
 * Группа: треугольники одной плоскости с затравкой (нормаль не дальше ~10°, плоскость не
 * дальше `PLANE_TOLERANCE` метров) и с той же раскладкой листа (масштаб и поворот листа на
 * метр стены — как у затравки, сдвиг — с точностью до целой плитки), связанные с ней цепочкой
 * касаний: габариты соседей сходятся ближе `GAP`. Панели фасада, что не делят ни рёбер, ни
 * вершин, остаются одной стеной; панель с другой раскладкой листа — другая стена; кривая
 * стена не уезжает по шагу, ступенька фасада и стена за углом в группу не попадают.
 *
 * Развёртка в плоскость: ось «вверх» — мировая Z, спроецированная на плоскость
 * (у пола и крыши — север), «вправо» — вверх × нормаль, то есть как её видит глаз.
 * Рамка группы в этих осях — размер стены в метрах. Лист на стене лежит
 * аффинно (`u = a·s + b·t + c`, `v = d·s + e·t + f`): коэффициенты — по затравке, потом
 * уточняются по всем вершинам; плитка (развёртка вне 0..1) от целых сдвигов у соседних
 * сеток не страдает — их приводят к одному. Лист не аффинный (стена с изгибом, трапеция) —
 * `null`: честнее открыть студию на всём листе, чем на кривой развёртке.
 */

/** Нормали ближе этого угла (косинус 10°) — одна плоскость. */
export const NORMAL_COS = Math.cos((10 * Math.PI) / 180);
/** Группа не уходит от плоскости затравки дальше стольких метров. */
export const PLANE_TOLERANCE = 0.12;
/** Не больше стольких треугольников в одной стене: фасад целого квартала — не стена. */
export const MAX_WALL_TRIANGLES = 24000;
/** Вершины ближе миллиметра — одна. */
const WELD = 1000;
/** Сколько треугольников стены рисует заливка в кадре. */
export const FILL_TRIANGLES = 6000;
/** Развёртка отклоняется от аффинной дальше этого (в долях листа) — стена не берётся. */
export const UV_TOLERANCE = 0.02;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => {
  const size = length(a);
  return size > 1e-12 ? scale(a, 1 / size) : [0, 0, 0];
};

const point = (positions, vertex) => [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];

/** Число треугольников сетки. */
export const triangleCount = (positions, index = null) => (index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9));

/* Вершины треугольника: из индекса или подряд. */
function cornersOf(index, triangle) {
  return index ? [index[triangle * 3], index[triangle * 3 + 1], index[triangle * 3 + 2]] : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
}

/** Нормаль треугольника (единичная) и его площадь. */
function faceOf(positions, corners) {
  const [a, b, c] = corners.map((vertex) => point(positions, vertex));
  const normal = cross(sub(b, a), sub(c, a));
  const twice = length(normal);
  return { normal: twice > 1e-12 ? scale(normal, 1 / twice) : null, area: twice / 2, centre: scale([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]], 1 / 3) };
}

/** Раскладка листа соседней панели отличается от затравки больше этой доли — другая стена. */
export const MAPPING_TOLERANCE = 0.05;
/** Сдвиг листа соседней панели — целое число плиток с точностью до этой доли плитки. */
export const OFFSET_TOLERANCE = 0.03;

/**
 * Раскладка листа на треугольнике, в осях стены (`origin`, `right`, `up`): `{ a, b, c, d, e, f }`
 * (`u = a·s + b·t + c`, `v = d·s + e·t + f`) или `null` (треугольник вырожден по листу или по плоскости).
 */
function triangleSheet(positions, uvs, corners, origin, basis) {
  const rows = corners.map((vertex) => {
    const offset = sub(point(positions, vertex), origin);
    return [dot(offset, basis.right), dot(offset, basis.up), uvs[vertex * 2], uvs[vertex * 2 + 1]];
  });
  const [p0, p1, p2] = rows;
  const ds1 = p1[0] - p0[0];
  const dt1 = p1[1] - p0[1];
  const ds2 = p2[0] - p0[0];
  const dt2 = p2[1] - p0[1];
  const fu = solve2(ds1, dt1, ds2, dt2, p1[2] - p0[2], p2[2] - p0[2]);
  const fv = solve2(ds1, dt1, ds2, dt2, p1[3] - p0[3], p2[3] - p0[3]);
  if (!fu || !fv) return null;
  return { a: fu[0], b: fu[1], c: p0[2] - fu[0] * p0[0] - fu[1] * p0[1], d: fv[0], e: fv[1], f: p0[3] - fv[0] * p0[0] - fv[1] * p0[1] };
}

/** Та же раскладка листа, что у `base`: масштаб и поворот — в пределах `MAPPING_TOLERANCE`, сдвиг — на целые плитки. */
function sameSheet(base, other) {
  const unit = Math.max(Math.abs(base.a), Math.abs(base.b), Math.abs(base.d), Math.abs(base.e), 1e-6);
  const near = (x, y) => Math.abs(x - y) <= unit * MAPPING_TOLERANCE;
  if (!near(base.a, other.a) || !near(base.b, other.b) || !near(base.d, other.d) || !near(base.e, other.e)) return false;
  const wrapped = (x, y) => {
    const shift = x - y;
    return Math.abs(shift - Math.round(shift)) <= OFFSET_TOLERANCE;
  };
  return wrapped(base.c, other.c) && wrapped(base.f, other.f);
}

/** Панели одного фасада сходятся, не касаясь вершинами: зазор до стольких метров не разрывает стену. */
export const GAP = 0.08;
/** Ячейка пространственной сетки поиска соседей, метры. */
const CELL = 0.5;

/**
 * Треугольники связной плоской группы вокруг `seed`: `{ triangles, normal, origin }`
 * или `null` (затравка вырожденная). `triangles` — номера в порядке обхода.
 *
 * Группа собирается в два шага. Сначала — кандидаты: все треугольники сетки в той же плоскости
 * (нормаль не дальше ~10°, плоскость не дальше `PLANE_TOLERANCE`). Потом — связность: к группе
 * присоединяются кандидаты, чьи габариты, раздутые на `GAP`, пересекаются с габаритами уже
 * взятого. Так стена из россыпи панелей, что не делят ни рёбер, ни вершин (у зданий игры это
 * обычное дело), остаётся одной стеной, а соседняя плоскость за уступом и стена за углом — нет.
 */
export function wallTriangles(positions, index, seed, { uvs = null, facing = null, limit = MAX_WALL_TRIANGLES, gap = GAP } = {}) {
  const count = triangleCount(positions, index);
  if (!(seed >= 0 && seed < count)) return null;
  const first = faceOf(positions, cornersOf(index, seed));
  if (!first.normal) return null;
  /* Раскладка листа затравки — по ней сверяются остальные (нет развёртки — сверять нечего). */
  const basis = uvs ? wallBasis(first.normal, facing) : null;
  const seedSheet = uvs ? triangleSheet(positions, uvs, cornersOf(index, seed), first.centre, basis) : null;
  if (uvs && !seedSheet) return null;
  /* Кандидаты и их габариты. */
  const candidates = [];
  const boxes = new Map();
  for (let triangle = 0; triangle < count; triangle += 1) {
    const corners = cornersOf(index, triangle);
    const face = triangle === seed ? first : faceOf(positions, corners);
    if (!face.normal) continue;
    if (dot(face.normal, first.normal) < NORMAL_COS) continue;
    if (Math.abs(dot(sub(face.centre, first.centre), first.normal)) > PLANE_TOLERANCE) continue;
    if (seedSheet && triangle !== seed) {
      const sheet = triangleSheet(positions, uvs, corners, first.centre, basis);
      if (!sheet || !sameSheet(seedSheet, sheet)) continue;
    }
    const points = corners.map((vertex) => point(positions, vertex));
    const box = [
      Math.min(points[0][0], points[1][0], points[2][0]) - gap,
      Math.min(points[0][1], points[1][1], points[2][1]) - gap,
      Math.min(points[0][2], points[1][2], points[2][2]) - gap,
      Math.max(points[0][0], points[1][0], points[2][0]) + gap,
      Math.max(points[0][1], points[1][1], points[2][1]) + gap,
      Math.max(points[0][2], points[1][2], points[2][2]) + gap,
    ];
    boxes.set(triangle, box);
    candidates.push(triangle);
  }
  /* Сетка поиска: ячейка → кандидаты, чей габарит её задевает. */
  const cells = new Map();
  const cellsOf = (box) => {
    const keys = [];
    for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[3] / CELL); x += 1)
      for (let y = Math.floor(box[1] / CELL); y <= Math.floor(box[4] / CELL); y += 1)
        for (let z = Math.floor(box[2] / CELL); z <= Math.floor(box[5] / CELL); z += 1) keys.push(`${x}:${y}:${z}`);
    return keys;
  };
  for (const triangle of candidates) {
    for (const key of cellsOf(boxes.get(triangle))) {
      const list = cells.get(key);
      if (list) list.push(triangle);
      else cells.set(key, [triangle]);
    }
  }
  const overlaps = (a, b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
  const taken = new Set([seed]);
  const queue = [seed];
  const triangles = [];
  for (let at = 0; at < queue.length && triangles.length < limit; at += 1) {
    const current = queue[at];
    triangles.push(current);
    const box = boxes.get(current);
    for (const key of cellsOf(box))
      for (const next of cells.get(key) || []) {
        if (taken.has(next) || !overlaps(box, boxes.get(next))) continue;
        taken.add(next);
        queue.push(next);
      }
  }
  return { triangles, normal: first.normal, origin: first.centre };
}

/** Оси стены: `up` — мировая Z вдоль плоскости (у пола и крыши — север), `right = up × нормаль`. */
export function wallBasis(normal, facing = null) {
  let n = normal;
  /* Нормаль смотрит к глазу: стена видна лицом, а не изнанкой. */
  if (facing && dot(n, facing) < 0) n = scale(n, -1);
  const world = Math.abs(n[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0];
  const up = unit(sub(world, scale(n, dot(world, n))));
  const right = unit(cross(up, n));
  return { normal: n, up, right };
}

/* Решение 2×2: [[p, q], [r, s]] · x = [m, n]. */
function solve2(p, q, r, s, m, n) {
  const det = p * s - q * r;
  if (Math.abs(det) < 1e-14) return null;
  return [(m * s - q * n) / det, (p * n - m * r) / det];
}

/**
 * Лист на стене: `{ a, b, c, d, e, f, error }` — `u = a·s + b·t + c`, `v = d·s + e·t + f`
 * (`s`, `t` — метры по осям стены от угла) — или `null`, если развёртка не аффинная.
 * `samples` — `[s, t, u, v]` по углам треугольников; первые три — затравка.
 */
export function fitSheet(samples) {
  if (samples.length < 3) return null;
  /* Затравка: три угла дают коэффициенты точно. */
  const [p0, p1, p2] = samples;
  const ds1 = p1[0] - p0[0];
  const dt1 = p1[1] - p0[1];
  const ds2 = p2[0] - p0[0];
  const dt2 = p2[1] - p0[1];
  const fu = solve2(ds1, dt1, ds2, dt2, p1[2] - p0[2], p2[2] - p0[2]);
  const fv = solve2(ds1, dt1, ds2, dt2, p1[3] - p0[3], p2[3] - p0[3]);
  if (!fu || !fv) return null;
  let [a, b] = fu;
  let [d, e] = fv;
  let c = p0[2] - a * p0[0] - b * p0[1];
  let f = p0[3] - d * p0[0] - e * p0[1];
  /* Все углы — к одной развёртке: целые сдвиги листа (соседние сетки, плитка) не в счёт. */
  const aligned = samples.map(([s, t, u, v]) => {
    const fitU = a * s + b * t + c;
    const fitV = d * s + e * t + f;
    return [s, t, u + Math.round(fitU - u), v + Math.round(fitV - v)];
  });
  /* Уточнение по всем углам — наименьшие квадраты по трём неизвестным на каждую ось. */
  let sss = 0;
  let sst = 0;
  let ss = 0;
  let stt = 0;
  let st = 0;
  const n = aligned.length;
  const rhs = { u: [0, 0, 0], v: [0, 0, 0] };
  for (const [s, t, u, v] of aligned) {
    sss += s * s;
    sst += s * t;
    ss += s;
    stt += t * t;
    st += t;
    rhs.u[0] += s * u;
    rhs.u[1] += t * u;
    rhs.u[2] += u;
    rhs.v[0] += s * v;
    rhs.v[1] += t * v;
    rhs.v[2] += v;
  }
  const solve3 = (m) => {
    const M = [
      [sss, sst, ss],
      [sst, stt, st],
      [ss, st, n],
    ];
    const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const D = det3(M);
    if (Math.abs(D) < 1e-12) return null;
    return [0, 1, 2].map((column) => det3(M.map((row, at) => row.map((value, k) => (k === column ? m[at] : value)))) / D);
  };
  const lu = solve3(rhs.u);
  const lv = solve3(rhs.v);
  if (lu && lv) {
    [a, b, c] = lu;
    [d, e, f] = lv;
  }
  let error = 0;
  for (const [s, t, u, v] of aligned) error = Math.max(error, Math.abs(a * s + b * t + c - u), Math.abs(d * s + e * t + f - v));
  if (!(error <= UV_TOLERANCE)) return null;
  return { a, b, c, d, e, f, error };
}

/**
 * Стена по затравке: `{ triangles, basis, origin, width, height, sheet, uvBounds, boundary, fill, shape, depth }`
 * или `null` (нет развёртки, не аффинный лист, вырожденная затравка).
 * `boundary` — рёбра кромки группы в мире (`[x1, y1, z1, x2, y2, z2, …]`) — для контура в кадре,
 * `fill` — положения её треугольников (по девять чисел) — для заливки,
 * `shape` — все треугольники стены в метрах стены от левого нижнего угла рамки (`[s, t]` по три угла,
 * по шесть чисел на треугольник) — контур для картинки на стену (3В),
 * `depth` — `{ front, back }`: насколько вперёд (по нормали) и назад от плоскости затравки стена
 * отходит у самых крайних своих вершин, м (плоскость допускает отклонение `PLANE_TOLERANCE`).
 */
export function wallFace({ positions, uvs, index = null, seed, facing = null, limit = MAX_WALL_TRIANGLES }) {
  if (!uvs) return null;
  const found = wallTriangles(positions, index, seed, { uvs, facing, limit });
  if (!found) return null;
  const basis = wallBasis(found.normal, facing);
  /* Рамка группы в осях стены: начало — левый нижний угол. */
  let s0 = Infinity;
  let s1 = -Infinity;
  let t0 = Infinity;
  let t1 = -Infinity;
  const project = (vertex) => {
    const offset = sub(point(positions, vertex), found.origin);
    return [dot(offset, basis.right), dot(offset, basis.up)];
  };
  for (const triangle of found.triangles)
    for (const vertex of cornersOf(index, triangle)) {
      const [s, t] = project(vertex);
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  const width = s1 - s0;
  const height = t1 - t0;
  if (!(width > 0.05 && height > 0.05)) return null;
  /* Контур стены в метрах рамки и глубина её вершин по нормали. */
  const shape = new Float32Array(found.triangles.length * 6);
  let front = 0;
  let back = 0;
  found.triangles.forEach((triangle, at) =>
    cornersOf(index, triangle).forEach((vertex, corner) => {
      const [s, t] = project(vertex);
      shape[at * 6 + corner * 2] = s - s0;
      shape[at * 6 + corner * 2 + 1] = t - t0;
      const deep = dot(sub(point(positions, vertex), found.origin), basis.normal);
      front = Math.max(front, deep);
      back = Math.min(back, deep);
    }),
  );
  /* Углы с развёрткой: затравка первой. */
  const order = [found.triangles[0], ...found.triangles.slice(1)];
  const samples = [];
  for (const triangle of order)
    for (const vertex of cornersOf(index, triangle)) {
      const [s, t] = project(vertex);
      samples.push([s - s0, t - t0, uvs[vertex * 2], uvs[vertex * 2 + 1]]);
    }
  const sheet = fitSheet(samples);
  if (!sheet) return null;
  /* Рамка развёртки (в листах, не свёрнутая): сколько плиток накрывает стена. */
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([s, t]) => [sheet.a * s + sheet.b * t + sheet.c, sheet.d * s + sheet.e * t + sheet.f]);
  const us = corners.map((corner) => corner[0]);
  const vs = corners.map((corner) => corner[1]);
  const uvBounds = { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
  /* Кромка: рёбра, что принадлежат ровно одному треугольнику группы (по сшитым вершинам). */
  const key = (vertex) => {
    const p = point(positions, vertex);
    return `${Math.round(p[0] * WELD)}:${Math.round(p[1] * WELD)}:${Math.round(p[2] * WELD)}`;
  };
  const seen = new Map();
  for (const triangle of found.triangles) {
    const corners3 = cornersOf(index, triangle);
    for (let side = 0; side < 3; side += 1) {
      const from = corners3[side];
      const to = corners3[(side + 1) % 3];
      const a = key(from);
      const b = key(to);
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = seen.get(edge);
      if (entry) entry.count += 1;
      else seen.set(edge, { count: 1, from, to });
    }
  }
  const boundary = [];
  for (const { count, from, to } of seen.values()) if (count === 1) boundary.push(...point(positions, from), ...point(positions, to));
  /* Заливка для кадра: положения треугольников группы (не больше `FILL_TRIANGLES`). */
  const shown = found.triangles.slice(0, FILL_TRIANGLES);
  const fill = new Float32Array(shown.length * 9);
  shown.forEach((triangle, at) => {
    cornersOf(index, triangle).forEach((vertex, corner) => {
      fill.set(point(positions, vertex), at * 9 + corner * 3);
    });
  });
  return {
    triangles: found.triangles,
    basis,
    origin: [found.origin[0] + basis.right[0] * s0 + basis.up[0] * t0, found.origin[1] + basis.right[1] * s0 + basis.up[1] * t0, found.origin[2] + basis.right[2] * s0 + basis.up[2] * t0],
    width,
    height,
    sheet,
    uvBounds,
    boundary: Float32Array.from(boundary),
    fill,
    shape,
    depth: { front, back },
  };
}

/** Сколько плиток листа накрывает стена: `{ across, down, count }`. */
export function wallTiles(wall) {
  const { u0, u1, v0, v1 } = wall.uvBounds;
  const across = Math.max(1, Math.ceil(u1 - 1e-6) - Math.floor(u0 + 1e-6));
  const down = Math.max(1, Math.ceil(v1 - 1e-6) - Math.floor(v0 + 1e-6));
  return { across, down, count: across * down };
}
