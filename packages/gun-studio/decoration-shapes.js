/*
 * Построители сеток украшений ствола — общие кирпичи для цветов, лозы,
 * брелоков и голограмм (задача 13 ТЗ 10.10.2026; объём — задача 6 ТЗ
 * 11.10.2026, утро).
 *
 * Владелец 11.10: «цветочки должны быть трёхмерными», «лоза должна обвивать
 * ган». Поэтому лепесток и лист здесь — не плоская полоска, а изогнутая
 * поверхность: поднимается от середины, загибается по длине (у лилии —
 * наружу, у тюльпана — внутрь), ложбинкой поперёк и складкой по жилке
 * (`sheet`). Стебель лозы — трубка по пространственной кривой с переносом
 * рамки (`pipe`): без скручивания на витках вокруг ствола.
 *
 * Сетка копится в построителе (`builder`): вершины с нормалью и развёрткой,
 * треугольники лицом туда, куда смотрят нормали (`oriented`, как у
 * украшений, проверенных в игре 10.10). Части (`part`) — куски сетки со
 * своей точкой крепления: лоза длиннее детали ствола, и каждая её часть
 * держится за свою кость модели (хост `decorate-drawable`).
 *
 * Цвет — клетка листа 32×32 (`decorationTexture` в `decorations.js`):
 *   слева (столбцы 0–15)        — основной цвет, по высоте от тени к свету;
 *   справа сверху (16–31, 0–15) — второй цвет;
 *   справа снизу — четыре клетки 8×8: тёмный (точки кубика), зелень листьев
 *   и стеблей (с тенью), золото (середины, тычинки) и белый.
 * Клетки по 8 точек — два блока DXT5: цвета не смешиваются и на мипах.
 *
 * Чистая арифметика: модуль читают окно, Astral Desktop и тесты.
 */

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
export const TAU = Math.PI * 2;

/* ------------------------------ лист ------------------------------ */

/** Основной цвет: `shade` 0 — тень (верх листа), 1 — свет. */
export const MAIN = (shade = 0.6) => [0.25, 0.06 + clamp(shade, 0, 1) * 0.88];
export const ACCENT = [0.75, 0.25];
export const DARK = [0.625, 0.625];
/** Зелень листьев и стеблей цветов — своя, не цвет человека. */
export const LEAF = (shade = 0.6) => [0.875, (16.5 + clamp(shade, 0, 1) * 7) / 32];
export const GOLD = [0.625, 0.875];
export const WHITE = [0.875, 0.875];

export const LEAF_GREEN = "#3f8f3a";
export const GOLD_COLOUR = "#ffc83d";

/* ---------------------------- вектора ---------------------------- */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a, fallback = [0, 0, 1]) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 1e-12 ? [a[0] / length, a[1] / length, a[2] / length] : [...fallback];
};
/* Перпендикуляр к `a` (любой, но всегда один и тот же для одного `a`). */
export const perpendicular = (a) => unit(cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
const faceNormal = (a, b, c) => cross(sub(b, a), sub(c, a));

/* --------------------------- построитель --------------------------- */

/**
 * Сетка: `vertex(p, n, uv)` → номер, `triangle(a, b, c)`, `part(anchor)` —
 * начать новую часть с точкой крепления. `parts()` — части с диапазонами
 * вершин и индексов (последняя тянется до конца).
 */
export function builder() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const marks = [];
  const vertex = (p, n, uv) => {
    positions.push(p[0], p[1], p[2]);
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    normals.push(n[0] / length, n[1] / length, n[2] / length);
    uvs.push(uv[0], uv[1]);
    return positions.length / 3 - 1;
  };
  const triangle = (a, b, c) => indices.push(a, b, c);
  const part = (anchor) => marks.push({ anchor: [...anchor], vertex: positions.length / 3, index: indices.length });
  const parts = () =>
    marks.map((mark, at) => {
      const next = marks[at + 1];
      const vertexEnd = next ? next.vertex : positions.length / 3;
      const indexEnd = next ? next.index : indices.length;
      return { anchor: mark.anchor, vertex: mark.vertex, vertices: vertexEnd - mark.vertex, index: mark.index, indices: indexEnd - mark.index };
    });
  return { positions, normals, uvs, indices, vertex, triangle, part, parts };
}

/**
 * Тот же построитель, но вершины — в своей рамке: `origin`, оси `x`, `y`,
 * `z` (ортонормированные, правая тройка) и `scale`. Так цветок, собранный «лицом
 * к +z», встаёт на лозу лицом наружу.
 */
export function framed(mesh, { origin = [0, 0, 0], x = [1, 0, 0], y = [0, 1, 0], z = [0, 0, 1], scale: k = 1 } = {}) {
  const map = (p) => [x[0] * p[0] + y[0] * p[1] + z[0] * p[2], x[1] * p[0] + y[1] * p[1] + z[1] * p[2], x[2] * p[0] + y[2] * p[1] + z[2] * p[2]];
  return {
    ...mesh,
    vertex: (p, n, uv) => mesh.vertex(add(origin, scale(map(p), k)), map(n), uv),
  };
}

/* Треугольник по вершинам с нормалями: лицом туда же, куда они смотрят. */
export function oriented(mesh, a, b, c) {
  const at = (index) => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
  const n = faceNormal(at(a), at(b), at(c));
  let facing = 0;
  for (const index of [a, b, c])
    facing += n[0] * mesh.normals[index * 3] + n[1] * mesh.normals[index * 3 + 1] + n[2] * mesh.normals[index * 3 + 2];
  if (facing < 0) mesh.triangle(a, c, b);
  else mesh.triangle(a, b, c);
}

/* Плоский треугольник с нормалью грани; `double` — и изнанка. */
export function facet(mesh, a, b, c, uv, { double = false } = {}) {
  const n = faceNormal(a, b, c);
  const uvA = Array.isArray(uv[0]) ? uv[0] : uv;
  const uvB = Array.isArray(uv[0]) ? uv[1] : uv;
  const uvC = Array.isArray(uv[0]) ? uv[2] : uv;
  mesh.triangle(mesh.vertex(a, n, uvA), mesh.vertex(b, n, uvB), mesh.vertex(c, n, uvC));
  if (double) {
    const back = [-n[0], -n[1], -n[2]];
    mesh.triangle(mesh.vertex(a, back, uvA), mesh.vertex(c, back, uvC), mesh.vertex(b, back, uvB));
  }
}

/* --------------------------- поверхности --------------------------- */

/* Ширина лепестка и листа по длине (0 — основание, 1 — кончик). */
export const SHAPES = Object.freeze({
  /* Острый кончик: ромашка, лилия, лист. */
  pointed: (t) => Math.sin(Math.PI * t) ** 0.75,
  /* Широкий у кончика и круглый: роза, тюльпан. */
  rounded: (t) => Math.sin(Math.PI * t) ** 0.35 * (0.55 + 0.45 * t),
  /* Тупой кончик с вырезом: сакура. */
  notched: (t) => Math.sin(Math.PI * (0.1 + 0.8 * t)) ** 0.5,
  /* Лист плюща: широкий у основания. */
  ivy: (t) => Math.sin(Math.PI * t ** 0.8) ** 0.6,
  /* Лист остролиста: зубцы по краю. */
  holly: (t) => Math.sin(Math.PI * t) ** 0.7 * (0.82 + 0.25 * Math.abs(Math.sin(3 * Math.PI * t)) ** 3),
});

/**
 * Лепесток или лист — изогнутая поверхность. Ось выходит из `base` по
 * `forward`, поднимаясь к `up` на `rise` (радианы) и загибаясь по длине на
 * `bend` (на всю длину: плюс — к `up`, минус — обратно вниз, как кончик у
 * лилии). Поперёк — ложбинка `cup` (края выше жилки на долю полуширины) и
 * складка по жилке `fold`. `notch` — вырез на тупом кончике (доля длины).
 * Сетка `rows` × `cols`, гладкие нормали; `double` — лицо и изнанка своими
 * вершинами. `uv(t)` — клетка листа по длине (свет к кончику).
 */
export function sheet(
  mesh,
  { base, forward, up, length, width, rise = 0, bend = 0, cup = 0, fold = 0, notch = 0, shape = SHAPES.pointed, rows = 6, cols = 4, uv = () => MAIN(0.7), double = true },
) {
  const f = unit(forward);
  const u0 = unit(sub(up, scale(f, dot(up, f))), perpendicular(f));
  const side = unit(cross(u0, f));
  const step = length / rows;
  /* Жилка: точки по длине и нормаль лепестка в каждой. */
  const spine = [base];
  const inner = [];
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const angle = rise + bend * t;
    inner.push(add(scale(f, -Math.sin(angle)), scale(u0, Math.cos(angle))));
    if (row < rows) {
      const middle = rise + bend * ((row + 0.5) / rows);
      spine.push(add(spine[row], scale(add(scale(f, Math.cos(middle)), scale(u0, Math.sin(middle))), step)));
    }
  }
  const grid = [];
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const half = (width / 2) * Math.max(0, shape(t));
    const line = [];
    for (let col = 0; col <= cols; col += 1) {
      const s = cols ? -1 + (2 * col) / cols : 0;
      let point = add(spine[row], add(scale(side, s * half), scale(inner[row], (cup * s * s + fold * Math.abs(s)) * half)));
      /* Вырез: середина тупого кончика утоплена к основанию. */
      if (notch && row === rows) point = sub(point, scale(unit(sub(spine[rows], spine[rows - 1])), notch * length * (1 - Math.abs(s))));
      line.push(point);
    }
    grid.push(line);
  }
  /* Гладкая нормаль: поперёк × вдоль, лицом к внутренней стороне лепестка. */
  const normalAt = (row, col) => {
    const along = sub(grid[Math.min(rows, row + 1)][col], grid[Math.max(0, row - 1)][col]);
    const across = sub(grid[row][Math.min(cols, col + 1)], grid[row][Math.max(0, col - 1)]);
    let n = cross(across, along);
    if (Math.hypot(...n) < 1e-14) n = inner[row];
    n = unit(n, inner[row]);
    return dot(n, inner[row]) < 0 ? scale(n, -1) : n;
  };
  const layers = double ? [1, -1] : [1];
  for (const facing of layers) {
    const ids = grid.map((line, row) => line.map((point, col) => mesh.vertex(point, scale(normalAt(row, col), facing), uv(row / rows, col / Math.max(1, cols)))));
    for (let row = 0; row < rows; row += 1)
      for (let col = 0; col < cols; col += 1) {
        const a = ids[row][col];
        const b = ids[row + 1][col];
        const c = ids[row + 1][col + 1];
        const d = ids[row][col + 1];
        oriented(mesh, a, b, c);
        oriented(mesh, a, c, d);
      }
  }
}

/**
 * Трубка по кривой: кольца `sides` граней с переносом рамки (без
 * скручивания на витках). `radius(i)` — радиус у точки `i`. `from`/`to` —
 * какой кусок кривой строить (рамка — по всей кривой: куски стыкуются без
 * шва); `caps` — закрыть концы веером.
 */
export function pipeFrames(path) {
  const frames = [];
  let normal = null;
  for (let index = 0; index < path.length; index += 1) {
    const prev = path[Math.max(0, index - 1)];
    const next = path[Math.min(path.length - 1, index + 1)];
    const tangent = unit(sub(next, prev), frames.at(-1)?.tangent || [1, 0, 0]);
    if (!normal) normal = perpendicular(tangent);
    else normal = unit(sub(normal, scale(tangent, dot(normal, tangent))), perpendicular(tangent));
    frames.push({ tangent, normal, binormal: cross(tangent, normal) });
  }
  return frames;
}

export function pipe(mesh, path, { radius, sides = 6, uv = ACCENT, frames = null, from = 0, to = path.length - 1, caps = [false, false] }) {
  if (to - from < 1) return;
  const rings = frames || pipeFrames(path);
  const radiusAt = typeof radius === "function" ? radius : () => radius;
  const ids = [];
  for (let index = from; index <= to; index += 1) {
    const { normal, binormal } = rings[index];
    const r = radiusAt(index);
    const ring = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * TAU;
      const n = add(scale(normal, Math.cos(angle)), scale(binormal, Math.sin(angle)));
      ring.push(mesh.vertex(add(path[index], scale(n, r)), n, typeof uv === "function" ? uv(index, side) : uv));
    }
    ids.push(ring);
  }
  for (let index = 0; index < ids.length - 1; index += 1)
    for (let side = 0; side < sides; side += 1) {
      const a = ids[index][side];
      const b = ids[index + 1][side];
      const c = ids[index + 1][(side + 1) % sides];
      const d = ids[index][(side + 1) % sides];
      oriented(mesh, a, b, c);
      oriented(mesh, a, c, d);
    }
  for (const [end, at, sign] of [
    [caps[0], from, -1],
    [caps[1], to, 1],
  ]) {
    if (!end) continue;
    const { tangent } = rings[at];
    const n = scale(tangent, sign);
    const tip = mesh.vertex(add(path[at], scale(n, radiusAt(at) * 0.6)), n, typeof uv === "function" ? uv(at, 0) : uv);
    const r = radiusAt(at);
    const { normal, binormal } = rings[at];
    const ring = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * TAU;
      const radial = add(scale(normal, Math.cos(angle)), scale(binormal, Math.sin(angle)));
      ring.push(mesh.vertex(add(path[at], scale(radial, r)), unit(add(radial, n)), typeof uv === "function" ? uv(at, side) : uv));
    }
    for (let side = 0; side < sides; side += 1) oriented(mesh, tip, ring[side], ring[(side + 1) % sides]);
  }
}

/* Шар (ягода, пыльник, бутон): кольца по широте, полюса — вершинами. */
export function sphere(mesh, centre, radius, { rings = 4, segments = 8, uv = ACCENT, stretch = 1, axis = [0, 0, 1] } = {}) {
  const z = unit(axis);
  const x = perpendicular(z);
  const y = cross(z, x);
  const at = (n) => add(centre, add(add(scale(x, n[0] * radius), scale(y, n[1] * radius)), scale(z, n[2] * radius * stretch)));
  const along = (n) => add(add(scale(x, n[0]), scale(y, n[1])), scale(z, n[2]));
  const top = mesh.vertex(at([0, 0, 1]), z, uv);
  const bottom = mesh.vertex(at([0, 0, -1]), scale(z, -1), uv);
  const grid = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const phi = (ring / (rings + 1)) * Math.PI;
    const row = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (segment / segments) * TAU;
      const n = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
      row.push(mesh.vertex(at(n), along([n[0], n[1], n[2] / stretch]), uv));
    }
    grid.push(row);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    oriented(mesh, top, grid[0][segment], grid[0][next]);
    oriented(mesh, bottom, grid[rings - 1][next], grid[rings - 1][segment]);
  }
  for (let ring = 0; ring < rings - 1; ring += 1)
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      oriented(mesh, grid[ring][segment], grid[ring + 1][segment], grid[ring + 1][next]);
      oriented(mesh, grid[ring][segment], grid[ring + 1][next], grid[ring][next]);
    }
}

/* Купол: середина цветка. */
export function dome(mesh, { radius = 0.13, height = 0.07, centre = [0, 0, 0], uv = ACCENT, rings = 3, segments = 12 }) {
  const ringPoints = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * (Math.PI / 2);
    const r = radius * Math.cos(phi);
    const z = height * Math.sin(phi);
    const points = [];
    for (let k = 0; k < segments; k += 1) {
      const a = (k / segments) * TAU;
      const p = [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a), centre[2] + z];
      const n = [(Math.cos(phi) * Math.cos(a)) / radius, (Math.cos(phi) * Math.sin(a)) / radius, Math.sin(phi) / height];
      points.push(mesh.vertex(p, n, uv));
    }
    ringPoints.push(points);
  }
  for (let ring = 0; ring < rings; ring += 1)
    for (let k = 0; k < segments; k += 1) {
      const a = ringPoints[ring][k];
      const b = ringPoints[ring][(k + 1) % segments];
      const c = ringPoints[ring + 1][(k + 1) % segments];
      const d = ringPoints[ring + 1][k];
      oriented(mesh, a, b, c);
      oriented(mesh, a, c, d);
    }
}

/* Тор: колечко и звенья брелока. `axis` — ось кольца. */
export function torus(mesh, { centre, major, minor, axis = "x", uv = ACCENT, segments = 14, sides = 6 }) {
  const frame = axis === "x" ? [[0, 1, 0], [0, 0, 1], [1, 0, 0]] : axis === "y" ? [[0, 0, 1], [1, 0, 0], [0, 1, 0]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [u, v, w] = frame;
  const grid = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * TAU;
    const ring = [];
    const radial = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
    for (let j = 0; j < sides; j += 1) {
      const b = (j / sides) * TAU;
      const n = [radial[0] * Math.cos(b) + w[0] * Math.sin(b), radial[1] * Math.cos(b) + w[1] * Math.sin(b), radial[2] * Math.cos(b) + w[2] * Math.sin(b)];
      const p = [centre[0] + radial[0] * major + n[0] * minor, centre[1] + radial[1] * major + n[1] * minor, centre[2] + radial[2] * major + n[2] * minor];
      ring.push(mesh.vertex(p, n, uv));
    }
    grid.push(ring);
  }
  for (let i = 0; i < segments; i += 1)
    for (let j = 0; j < sides; j += 1) {
      const a = grid[i][j];
      const b = grid[(i + 1) % segments][j];
      const c = grid[(i + 1) % segments][(j + 1) % sides];
      const d = grid[i][(j + 1) % sides];
      oriented(mesh, a, b, c);
      oriented(mesh, a, c, d);
    }
}

/*
 * Выдавленный контур (сердце, звезда брелока, подставка голограммы): лицо и
 * изнанка плоские, бока — по контуру. `outline` — точки против часовой.
 */
export function prism(mesh, { outline, centre, depth, uv = MAIN(0.7), sideUv = MAIN(0.35) }) {
  const front = centre[2] + depth / 2;
  const back = centre[2] - depth / 2;
  const at = ([x, y], z) => [centre[0] + x, centre[1] + y, z];
  const middle = outline.reduce((sum, [x, y]) => [sum[0] + x / outline.length, sum[1] + y / outline.length], [0, 0]);
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    facet(mesh, at(middle, front), at(a, front), at(b, front), uv);
    facet(mesh, at(middle, back), at(b, back), at(a, back), uv);
    facet(mesh, at(a, back), at(b, back), at(b, front), sideUv);
    facet(mesh, at(a, back), at(b, front), at(a, front), sideUv);
  }
}

export const circleOutline = (radius, count) =>
  Array.from({ length: count }, (_, index) => [Math.cos((index / count) * TAU) * radius, Math.sin((index / count) * TAU) * radius]);

/* ------------------------- псевдослучайность ------------------------- */

/*
 * Детерминированный разброс (листья лозы чуть разные по размеру и наклону):
 * целочисленный хеш, без тригонометрии — в окне и в Astral Desktop одно и
 * то же до бита.
 */
export function jitter(seed) {
  let value = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 4294967296;
}
