/*
 * Сетка своих моделей «Дирижаблей» (`airship-models.js`): векторы, части
 * модели и тела, из которых они собраны (ТЗ 11.10.2026, ночь, задача 3:
 * «реалистичные модели для вкладки дирижабля»).
 *
 * Тела — сетки по двум параметрам (`surface`): протяжки по плавной кривой
 * со своим сечением (`sweepAlong` — туловище, шея, хвост, лапы, рога,
 * перья), тела вращения, лоскуты по четырём краям (перепонки крыльев,
 * плавники). Нормали — гладкие: разностью соседних точек самой формы, а не
 * сетки, поэтому полосы одного тела (спина, брюхо) стыкуются без шва света.
 * Двусторонние листы (перепонка, перо) — две сетки: лицом вверх и лицом
 * вниз.
 *
 * Обход треугольников — против часовой, если смотреть на лицевую сторону
 * (как у плашек эмблем и украшений фонарей, проверенных в игре). Оси — как у
 * игры: метры, Z вверх, нос +Y, правый борт +X.
 *
 * Чистые функции без Node и DOM.
 */

/* ------------------------------------------------------------------ *
 * Векторы
 * ------------------------------------------------------------------ */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => {
  const size = length(a);
  return size > 1e-12 ? scale(a, 1 / size) : [0, 0, 1];
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
/* Плавная ступень 0 → 1 между `a` и `b` (у `a > b` — в обратную сторону). */
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mirrorX = ([x, y, z]) => [-x, y, z];
/* Точка по сумме: `base + Σ vectors[i]·k[i]`. */
export const along = (base, ...terms) => {
  let out = base;
  for (let index = 0; index + 1 < terms.length; index += 2) out = add(out, scale(terms[index], terms[index + 1]));
  return out;
};
/* ------------------------------------------------------------------ *
 * Часть модели
 * ------------------------------------------------------------------ */

/*
 * Сетка одной части. `flexOf(точка) → 0…1` — доля «местного» движения у
 * вершины (по месту, а не по части: одна точка в двух частях движется
 * одинаково); не задана — ноль.
 */
export function createMesh() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const flex = [];
  const mesh = {
    positions,
    normals,
    uvs,
    indices,
    flex,
    flexOf: null,
    vertex(point, normal, uv) {
      positions.push(point[0], point[1], point[2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(uv[0], uv[1]);
      flex.push(mesh.flexOf ? clamp01(mesh.flexOf(point)) : 0);
      return positions.length / 3 - 1;
    },
    triangle(a, b, c) {
      indices.push(a, b, c);
    },
    get count() {
      return positions.length / 3;
    },
  };
  return mesh;
}

/* Доля движения — у всех частей модели разом. */
export function flexAll(meshes, flexOf) {
  for (const mesh of Object.values(meshes)) if (mesh) mesh.flexOf = flexOf;
}

/* Развёртка: постоянная `[u, v]` или функция от аргументов. */
const uvAt = (uv, ...args) => (typeof uv === "function" ? uv(...args) : uv);

/* ------------------------------------------------------------------ *
 * Плоские грани
 * ------------------------------------------------------------------ */

/* Плоский треугольник с нормалью грани (у перепонок, граней фонарика). */
export function flatTriangle(mesh, a, b, c, uv) {
  const normal = unit(cross(sub(b, a), sub(c, a)));
  mesh.triangle(mesh.vertex(a, normal, uvAt(uv, a, normal)), mesh.vertex(b, normal, uvAt(uv, b, normal)), mesh.vertex(c, normal, uvAt(uv, c, normal)));
}

/* Двусторонняя перепонка: веер треугольников `[a, b, c]` — каждый двумя гранями. */
export function membrane(mesh, triangles, uv) {
  for (const [a, b, c] of triangles) {
    flatTriangle(mesh, a, b, c, uv);
    flatTriangle(mesh, a, c, b, uv);
  }
}

/* Ящик по двум углам — шесть граней лицом наружу; `uv(точка, нормаль)` или постоянная. */
export function boxFaces(mesh, [min, max], uv) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const quad = (a, b, c, d) => {
    flatTriangle(mesh, a, b, c, uv);
    flatTriangle(mesh, a, c, d, uv);
  };
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
}

/* ------------------------------------------------------------------ *
 * Сетка по двум параметрам
 * ------------------------------------------------------------------ */

const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9;

/*
 * Сетка `rows × cols` клеток: `at(i, j)` — точка (i = 0…rows, j = 0…cols).
 * Нормаль — cross(∂P/∂i, ∂P/∂j) (у `flip` — обратная), обход — лицом к
 * нормали. `wrap` — сетка замкнута по j (точка cols — та же, что 0, но своя
 * вершина: развёртка у шва своя). `normal(i, j)` — своя нормаль (протяжка
 * считает её по сечению, а не по сетке: полосы тела без шва света); у
 * вырожденной точки (полюс, конец иглы) — средняя соседнего ряда.
 * `uv(i, j, точка)` или постоянная. Ответ — номера вершин `[i][j]`.
 */
export function surface(mesh, rows, cols, at, { wrap = false, uv = [0.5, 0.5], flip = false, normal = null } = {}) {
  const grid = [];
  for (let i = 0; i <= rows; i += 1) {
    const row = [];
    for (let j = 0; j <= cols; j += 1) row.push(wrap && j === cols ? row[0] : at(i, j));
    grid.push(row);
  }
  const raw = grid.map((row, i) =>
    row.map((point, j) => {
      if (normal) {
        const own = normal(i, j, point);
        if (own) return flip ? scale(own, -1) : own;
      }
      const di = sub(grid[Math.min(rows, i + 1)][j], grid[Math.max(0, i - 1)][j]);
      const dj = wrap ? sub(row[(j + 1) % cols], row[(j - 1 + cols) % cols]) : sub(row[Math.min(cols, j + 1)], row[Math.max(0, j - 1)]);
      const n = cross(di, dj);
      return flip ? scale(n, -1) : n;
    }),
  );
  const good = (n) => length(n) > 1e-10;
  const normals = raw.map((row, i) =>
    row.map((n, j) => {
      if (good(n)) return unit(n);
      const pole = grid[i].every((point) => near(point, grid[i][0]));
      for (const k of [i + 1, i - 1, i + 2, i - 2]) {
        if (k < 0 || k > rows) continue;
        if (!pole && good(raw[k][j])) return unit(raw[k][j]);
        const sum = raw[k].reduce((acc, m, index) => (good(m) && !(wrap && index === cols) ? add(acc, unit(m)) : acc), [0, 0, 0]);
        if (good(sum)) return unit(sum);
      }
      return [0, 0, 1];
    }),
  );
  const ids = grid.map((row, i) => row.map((point, j) => mesh.vertex(point, normals[i][j], uvAt(uv, i, j, point))));
  for (let i = 0; i < rows; i += 1)
    for (let j = 0; j < cols; j += 1) {
      const [pa, pb, pc, pd] = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      const [a, b, c, d] = [ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]];
      if (!near(pa, pb) && !near(pb, pc) && !near(pa, pc)) {
        if (flip) mesh.triangle(a, c, b);
        else mesh.triangle(a, b, c);
      }
      if (!near(pa, pc) && !near(pc, pd) && !near(pa, pd)) {
        if (flip) mesh.triangle(a, d, c);
        else mesh.triangle(a, c, d);
      }
    }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Кривые
 * ------------------------------------------------------------------ */

/* Сплайн Кэтмелла — Рома по составляющим (точки — массивы любой длины). */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((value, axis) => 0.5 * (2 * value + (-p0[axis] + p2[axis]) * t + (2 * p0[axis] - 5 * value + 4 * p2[axis] - p3[axis]) * t2 + (-p0[axis] + 3 * value - 3 * p2[axis] + p3[axis]) * t3));
}

/*
 * Плавная кривая через точки `[x, y, z, …]` (лишние составляющие — радиусы
 * и прочее — тоже плавно): `at(t)` по доле длины (t = 0…1 — равные метры),
 * `tangent(t)`, `length`. Длина меряется по первым трём составляющим.
 */
export function curve(points, { samples = 24 } = {}) {
  const dense = [];
  const count = points.length;
  for (let index = 0; index + 1 < count; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p3 = points[Math.min(count - 1, index + 2)];
    for (let step = 0; step < samples; step += 1) dense.push(catmull(p0, points[index], points[index + 1], p3, step / samples));
  }
  dense.push(points[count - 1].slice());
  const lengths = [0];
  for (let index = 1; index < dense.length; index += 1) lengths.push(lengths[index - 1] + length(sub(dense[index], dense[index - 1])));
  const total = lengths[lengths.length - 1];
  const at = (t) => {
    const want = clamp01(t) * total;
    let low = 0;
    let high = lengths.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (lengths[middle] <= want) low = middle;
      else high = middle;
    }
    const span = lengths[high] - lengths[low];
    const k = span > 1e-12 ? (want - lengths[low]) / span : 0;
    return dense[low].map((value, axis) => lerp(value, dense[high][axis], k));
  };
  const tangent = (t) => {
    const step = Math.min(0.004, 0.25 / Math.max(1, total));
    const a = at(Math.max(0, t - step));
    const b = at(Math.min(1, t + step));
    return unit(sub(b, a));
  };
  return { at, tangent, length: total };
}

/*
 * Рамки вдоль кривой: `count + 1` штук `{ t, centre, extra, forward, side,
 * up }` (side × forward = up, как X × Y = Z), без закрутки — переносом бока
 * с рамки на рамку. Первый бок — перпендикуляр к ходу в сторону `side`.
 */
export function curveFrames(path, count, side = [1, 0, 0], { from = 0, to = 1 } = {}) {
  const out = [];
  let current = side;
  for (let index = 0; index <= count; index += 1) {
    const t = lerp(from, to, index / count);
    const point = path.at(t);
    const forward = path.tangent(t);
    current = unit(sub(current, scale(forward, dot(current, forward))));
    if (length(current) < 1e-6) current = unit(cross(forward, Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    out.push({ t, centre: point.slice(0, 3), extra: point.slice(3), forward, side: current, up: unit(cross(current, forward)) });
  }
  return out;
}

/*
 * Протяжка по рамкам: сечение `section(рамка, угол) → [вбок, вверх]` (угол
 * в радианах: 0 — бок, π/2 — верх). Полоса `[from, to]` (радианы) — часть
 * обхвата; вся — 0…2π (замкнуто). Нормаль — по сечению и соседним рамкам
 * (полосы одного тела стыкуются без шва света). Наружу — у угла, растущего
 * от бока к верху, и рамок от хвоста к голове.
 */
export function sweepAlong(mesh, frames, section, { segments = 16, from = 0, to = Math.PI * 2, uv = [0.5, 0.5], flip = false } = {}) {
  const closed = Math.abs(to - from - Math.PI * 2) < 1e-9;
  const angleOf = (j) => lerp(from, to, j / segments);
  const point = (index, angle) => {
    const frame = frames[Math.max(0, Math.min(frames.length - 1, index))];
    const [x, z] = section(frame, angle);
    return add(add(frame.centre, scale(frame.side, x)), scale(frame.up, z));
  };
  const rows = frames.length - 1;
  const normal = (i, j) => {
    const angle = angleOf(j);
    const delta = 0.02;
    const di = sub(point(Math.min(rows, i + 1), angle), point(Math.max(0, i - 1), angle));
    const dj = sub(point(i, angle + delta), point(i, angle - delta));
    const n = cross(di, dj);
    return length(n) > 1e-10 ? unit(n) : null;
  };
  return surface(mesh, rows, segments, (i, j) => point(i, angleOf(j)), { wrap: closed, uv: (i, j, p) => uvAt(uv, i, j, p, frames[i], angleOf(j)), flip, normal });
}

/* Эллипс сечения с поперечными радиусами из `extra` рамки: `[rx, rz]` (или один радиус). */
export const ellipseSection = (frame, angle) => {
  const [rx, rz = rx] = frame.extra;
  return [rx * Math.cos(angle), rz * Math.sin(angle)];
};

/*
 * Труба по плавной кривой: точки `[x, y, z, r]` (радиус в каждой), `rings`
 * колец, `segments` по кругу. Конец с радиусом 0 — игла (полюс). `uv(t,
 * угол)` или постоянная; `side` — начальный бок рамок; `flat` — сечение
 * сплюснуто вдоль бока (лезвие шипа).
 */
export function tubeCurve(mesh, points, { rings = 12, segments = 8, uv = [0.5, 0.5], side = null, flat = 1 } = {}) {
  const path = curve(points);
  const start = path.tangent(0);
  const hint = side || (Math.abs(start[2]) < 0.9 ? cross(start, [0, 0, 1]) : [1, 0, 0]);
  const frames = curveFrames(path, rings, unit(hint));
  return sweepAlong(mesh, frames, (frame, angle) => [frame.extra[0] * Math.cos(angle) * flat, frame.extra[0] * Math.sin(angle)], {
    segments,
    uv: (i, j, p, frame, angle) => uvAt(uv, frame.t, angle / (Math.PI * 2)),
  });
}

/*
 * Лоскут по четырём краям (Кунс): `c0(b)`, `c1(b)` — края при a = 0 и 1,
 * `d0(a)`, `d1(a)` — при b = 0 и 1; углы общие. Перепонка между пальцами
 * крыла, плавник между лучами.
 */
export function coons(c0, c1, d0, d1) {
  const p00 = c0(0);
  const p01 = c0(1);
  const p10 = c1(0);
  const p11 = c1(1);
  return (a, b) => {
    const ruled = add(add(scale(c0(b), 1 - a), scale(c1(b), a)), add(scale(d0(a), 1 - b), scale(d1(a), b)));
    const corners = add(add(scale(p00, (1 - a) * (1 - b)), scale(p10, a * (1 - b))), add(scale(p01, (1 - a) * b), scale(p11, a * b)));
    return sub(ruled, corners);
  };
}

/* Ломаная как функция доли длины: точки `[x, y, z]`. */
export function polyline(points) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) lengths.push(lengths[index - 1] + length(sub(points[index], points[index - 1])));
  const total = lengths[lengths.length - 1];
  return (t) => {
    const want = clamp01(t) * total;
    for (let index = 1; index < points.length; index += 1)
      if (want <= lengths[index] || index === points.length - 1) {
        const span = lengths[index] - lengths[index - 1];
        return mix(points[index - 1], points[index], span > 1e-12 ? (want - lengths[index - 1]) / span : 0);
      }
    return points[points.length - 1];
  };
}

/* ------------------------------------------------------------------ *
 * Простые тела (шар, фонарик, НЛО, самолёт)
 * ------------------------------------------------------------------ */

/*
 * Тело вращения вокруг оси Z через `centre`: профиль `[[r, z] …]` снизу
 * вверх (сверху вниз — лицом внутрь: подсветка изнутри оболочки), `segments`
 * по кругу, цвет полосы — `colourOf(сегмент, отрезок)`. Каждый кусок одного
 * цвета — своими вершинами (цвета не смешиваются), нормали — по профилю.
 * `skin` — `{ mesh, uv(отрезок, сегмент, угол 0|1, точка, индекс профиля) }`:
 * кусок, у которого `uv` отвечает развёрткой, ложится в `skin.mesh` с ней.
 */
export function lathe(mesh, palette, profile, { segments = 24, centre = [0, 0, 0], colourOf, from = 0, to = Math.PI * 2, skin = null }) {
  const normalAt = (index, angle) => {
    const prev = profile[Math.max(0, index - 1)];
    const next = profile[Math.min(profile.length - 1, index + 1)];
    const dr = next[0] - prev[0];
    const dz = next[1] - prev[1];
    /* Касательная профиля (dr, dz) → наружная нормаль (dz, −dr) в плоскости (r, z). */
    const [nr, nz] = [dz, -dr];
    return unit([Math.cos(angle) * nr, Math.sin(angle) * nr, nz]);
  };
  const point = (index, angle) => [centre[0] + profile[index][0] * Math.cos(angle), centre[1] + profile[index][0] * Math.sin(angle), centre[2] + profile[index][1]];
  for (let segment = 0; segment < segments; segment += 1) {
    const a0 = lerp(from, to, segment / segments);
    const a1 = lerp(from, to, (segment + 1) / segments);
    for (let band = 0; band + 1 < profile.length; band += 1) {
      const colour = colourOf(segment, band);
      const uv = Array.isArray(colour) ? colour : palette.uv(colour);
      const mapped = skin && skin.uv(band, segment, 0, point(band, a0), band);
      const target = mapped ? skin.mesh : mesh;
      const uvAtCorner = (index, corner, angle) => (mapped ? skin.uv(band, segment, corner, point(index, angle), index) : uv);
      const v00 = target.vertex(point(band, a0), normalAt(band, a0), uvAtCorner(band, 0, a0));
      const v01 = target.vertex(point(band, a1), normalAt(band, a1), uvAtCorner(band, 1, a1));
      const v10 = target.vertex(point(band + 1, a0), normalAt(band + 1, a0), uvAtCorner(band + 1, 0, a0));
      const v11 = target.vertex(point(band + 1, a1), normalAt(band + 1, a1), uvAtCorner(band + 1, 1, a1));
      /* Профиль идёт вверх, угол — против часовой сверху: лицо наружу. */
      target.triangle(v00, v01, v11);
      target.triangle(v00, v11, v10);
    }
  }
}

/*
 * Эллипсоид: `radii` по осям `axes` (по умолчанию X, Y, Z), гладкие
 * нормали. `uv` — постоянная или `uv(направление на единичной сфере в осях
 * эллипсоида)` (глаз: радужка на «переднем» полушарии).
 */
export function ellipsoid(mesh, palette, centre, radii, colour, { segments = 12, rings = 8, axes = null } = {}) {
  const fixed = typeof colour === "function" ? null : Array.isArray(colour) ? colour : palette.uv(colour);
  const [ax, ay, az] = axes || [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const rows = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = -Math.PI / 2 + (Math.PI * ring) / rings;
    const row = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (Math.PI * 2 * segment) / segments;
      const sphere = [Math.cos(phi) * Math.cos(theta), Math.cos(phi) * Math.sin(theta), Math.sin(phi)];
      const local = [sphere[0] * radii[0], sphere[1] * radii[1], sphere[2] * radii[2]];
      const point = add(centre, along([0, 0, 0], ax, local[0], ay, local[1], az, local[2]));
      const n = [sphere[0] / radii[0], sphere[1] / radii[1], sphere[2] / radii[2]];
      const normal = unit(along([0, 0, 0], ax, n[0], ay, n[1], az, n[2]));
      row.push(mesh.vertex(point, normal, fixed || colour(sphere)));
    }
    rows.push(row);
  }
  for (let ring = 0; ring < rings; ring += 1)
    for (let segment = 0; segment < segments; segment += 1) {
      const a = rows[ring][segment];
      const b = rows[ring][segment + 1];
      const c = rows[ring + 1][segment + 1];
      const d = rows[ring + 1][segment];
      if (ring > 0) mesh.triangle(a, b, c);
      if (ring < rings - 1) mesh.triangle(a, c, d);
    }
}

/* Базис поперёк направления `axis`: два единичных вектора. */
export function across(axis) {
  const helper = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const side = unit(cross(axis, helper));
  return [side, unit(cross(side, axis))];
}

/* Труба от `from` до `to`, радиусы на концах — `r0`, `r1` (конус при r1 = 0). */
export function tube(mesh, palette, from, to, r0, r1, colour, { segments = 8, caps = true } = {}) {
  const uv = Array.isArray(colour) ? colour : palette.uv(colour);
  const axis = unit(sub(to, from));
  const [side, up] = across(axis);
  const slope = (r0 - r1) / Math.max(1e-6, length(sub(to, from)));
  const ring = (centre, radius) => {
    const list = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (Math.PI * 2 * segment) / segments;
      const out = add(scale(side, Math.cos(angle)), scale(up, Math.sin(angle)));
      list.push(mesh.vertex(add(centre, scale(out, radius)), unit(add(out, scale(axis, slope))), uv));
    }
    return list;
  };
  const a = ring(from, r0);
  const b = ring(to, r1);
  /* Угол идёт от `side` к `up` — по часовой, если смотреть с конца оси:
     лицо наружу у треугольников (a, b′, a′) и (a, b, b′). */
  for (let segment = 0; segment < segments; segment += 1) {
    /* Конец иглой (радиус 0) — без вырожденных треугольников. */
    if (r0 > 1e-6) mesh.triangle(a[segment], b[segment + 1], a[segment + 1]);
    if (r1 > 1e-6) mesh.triangle(a[segment], b[segment], b[segment + 1]);
  }
  if (!caps) return;
  for (const [centre, radius, list, start] of [
    [from, r0, a, true],
    [to, r1, b, false],
  ]) {
    if (radius < 1e-4) continue;
    const middle = mesh.vertex(centre, start ? scale(axis, -1) : axis, uv);
    for (let segment = 0; segment < segments; segment += 1)
      if (start) mesh.triangle(middle, list[segment], list[segment + 1]);
      else mesh.triangle(middle, list[segment + 1], list[segment]);
  }
}

/*
 * Протяжка по хребту в плоскости YZ (самолёт с баннером): узлы `[[y, z, rx,
 * rz] …]` вдоль +Y, сечение — эллипс. Полосы `strips` — `[от, до, цвет]` в
 * градусах от правого борта к верху: у каждой свои вершины, нормали — по
 * эллипсу. Концы закрыты веером.
 */
export function sweep(mesh, palette, nodes, strips, { segments = 6 } = {}) {
  const frames = nodes.map((node, index) => {
    const prev = nodes[Math.max(0, index - 1)];
    const next = nodes[Math.min(nodes.length - 1, index + 1)];
    const forward = unit([0, next[0] - prev[0], next[1] - prev[1]]);
    const side = [1, 0, 0];
    return { centre: [0, node[0], node[1]], forward, side, up: unit(cross(side, forward)), rx: node[2], rz: node[3] };
  });
  const at = (frame, angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const point = add(frame.centre, add(scale(frame.side, c * frame.rx), scale(frame.up, s * frame.rz)));
    const normal = unit(add(scale(frame.side, c / Math.max(frame.rx, 1e-3)), scale(frame.up, s / Math.max(frame.rz, 1e-3))));
    return { point, normal };
  };
  for (const [from, to, colour] of strips) {
    const uv = palette.uv(colour);
    const degrees = (step) => from + ((to - from) * step) / segments;
    const rows = frames.map((frame) => {
      const row = [];
      for (let step = 0; step <= segments; step += 1) {
        const { point, normal } = at(frame, (degrees(step) * Math.PI) / 180);
        row.push(mesh.vertex(point, normal, uv));
      }
      return row;
    });
    for (let index = 0; index + 1 < rows.length; index += 1)
      for (let step = 0; step < segments; step += 1) {
        const a = rows[index][step];
        const b = rows[index][step + 1];
        const c = rows[index + 1][step + 1];
        const d = rows[index + 1][step];
        /* Угол растёт от борта к спине, хребет — к голове: лицо наружу. */
        mesh.triangle(a, c, b);
        mesh.triangle(a, d, c);
      }
    for (const [index, toward] of [
      [0, -1],
      [rows.length - 1, 1],
    ]) {
      const frame = frames[index];
      const ring = rows[index];
      const middle = mesh.vertex(frame.centre, scale(frame.forward, toward), uv);
      /* Угол сечения растёт от борта к спине — с головы это по часовой. */
      for (let step = 0; step < segments; step += 1)
        if (toward > 0) mesh.triangle(middle, ring[step + 1], ring[step]);
        else mesh.triangle(middle, ring[step], ring[step + 1]);
    }
  }
}
