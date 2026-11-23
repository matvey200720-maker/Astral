/*
 * Наклейка на стене — эмблема или надпись, которую двигают по стенам.
 *
 * Место наклейки — точка стены и её нормаль (куда стена «смотрит»): так её
 * ставит щелчок в 3D-кадре. Картинка стоит прямо, если смотреть на стену:
 * «вправо» — поперёк нормали и вертикали, «вверх» — по вертикали (у пола и
 * крыши — по оси Y). Одна арифметика у кадра (шейдер через матрицу) и у
 * установщика (тексели листа по точке и нормали из развёртки).
 *
 * Поворот наклейки — `angle` в градусах вокруг нормали (против часовой
 * стрелки, если смотреть на стену): его крутят колесом-поворотом в кадре
 * редактора эмблемы, и та же рамка уезжает в листы и в плашку.
 */

const normalize = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Толщина наклейки: сколько метров по нормали от стены она ещё ложится. */
export const DECAL_DEPTH = 0.6;

/** Поворот наклейки к −180…180°, по 1°. */
export function normalizeDecalAngle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const wrapped = ((((number + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped) || 0;
}

/**
 * Оси наклейки по нормали стены: `{ normal, right, up }`; `angle` —
 * поворот вокруг нормали в градусах (против часовой, если смотреть на стену).
 */
export function decalBasis(normalInput, angle = 0) {
  const normal = normalize(normalInput);
  const helper = Math.abs(normal[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const right = normalize(cross(helper, normal));
  const up = cross(normal, right);
  const radians = ((Number(angle) || 0) * Math.PI) / 180;
  if (!radians) return { normal, right, up };
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return {
    normal,
    right: [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s],
    up: [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s],
  };
}

/**
 * Точка мира → место на наклейке `[s, t, глубина]`: s и t — доли ширины и
 * высоты (0…1 — на наклейке), глубина — доли `DECAL_DEPTH`.
 * `decal` — `{ point, normal, width, height, angle? }` (метры, градусы).
 */
export function decalLocal(point, decal) {
  const { normal, right, up } = decalBasis(decal.normal, decal.angle);
  const d = [point[0] - decal.point[0], point[1] - decal.point[1], point[2] - decal.point[2]];
  return [dot(d, right) / decal.width + 0.5, dot(d, up) / decal.height + 0.5, dot(d, normal) / DECAL_DEPTH];
}

/**
 * Та же проекция строками матрицы 4×4 (по строкам) — для шейдера кадра:
 * `M · (x, y, z, 1) = (s, t, глубина, 1)`.
 */
export function decalMatrixRows(decal) {
  const { normal, right, up } = decalBasis(decal.normal, decal.angle);
  const p = decal.point;
  return [
    [right[0] / decal.width, right[1] / decal.width, right[2] / decal.width, 0.5 - dot(p, right) / decal.width],
    [up[0] / decal.height, up[1] / decal.height, up[2] / decal.height, 0.5 - dot(p, up) / decal.height],
    [normal[0] / DECAL_DEPTH, normal[1] / DECAL_DEPTH, normal[2] / DECAL_DEPTH, -dot(p, normal) / DECAL_DEPTH],
    [0, 0, 0, 1],
  ];
}

/** Лежит ли наклейка на этом месте стены (нормали стены и наклейки согласны). */
export function decalCovers(local, surfaceNormal, decal) {
  if (local[0] < 0 || local[0] > 1 || local[1] < 0 || local[1] > 1 || Math.abs(local[2]) > 1) return false;
  return dot(normalize(surfaceNormal), decalBasis(decal.normal).normal) > 0.5;
}

/* Кватернион поворота по матрице (строки × столбцы), метод Шеппарда. */
function quaternionFromMatrix(m) {
  const trace = m[0][0] + m[1][1] + m[2][2];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    return [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  }
  if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    return [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  }
  const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
  return [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
}

/**
 * Место плашки-эмблемы в мире (нативный хост `compile-emblem-plates`):
 * плашка лежит в плоскости XZ модели лицом в −Y, поэтому её оси — «вправо»
 * (X), «к стене» (Y = −нормаль) и «вверх» (Z) наклейки. Сущность карты
 * хранит обратный кватернион (`placement.js`), он и возвращается.
 * `offset` — на сколько метров плашка отстоит от стены (без мерцания).
 * `{ position, rotation, size: [ширина, высота] }`.
 */
export function decalPlacement(decal, { offset = 0.03 } = {}) {
  const { normal, right, up } = decalBasis(decal.normal, decal.angle);
  const matrix = [
    [right[0], -normal[0], up[0]],
    [right[1], -normal[1], up[1]],
    [right[2], -normal[2], up[2]],
  ];
  const [x, y, z, w] = quaternionFromMatrix(matrix);
  const length = Math.hypot(x, y, z, w) || 1;
  const round = (value) => Math.round(value * 1e6) / 1e6;
  return {
    position: decal.point.map((value, axis) => round(value + normal[axis] * offset)),
    rotation: [-x / length, -y / length, -z / length, w / length].map((value) => round(value) + 0),
    size: [round(decal.width), round(decal.height)],
  };
}

/*
 * Нормаль стены под щелчком: стена — отвесная (наклейка стоит прямо, без
 * завала от неровной сетки), пол и потолок — ровно вверх или вниз. Стены
 * ангара повёрнуты к осям мира (корпус стоит под углом), поэтому к осям
 * нормаль не притягивается — только к вертикали.
 */
export function snapWallNormal(normal) {
  const [x, y, z] = normalize(normal);
  if (Math.abs(z) > 0.8) return [0, 0, Math.sign(z) || 1];
  const flat = Math.hypot(x, y) || 1;
  return [Math.round((x / flat) * 1000) / 1000, Math.round((y / flat) * 1000) / 1000, 0];
}

/* ------------------------------------------------------------------ *
 * Картинка поверх деталей стены (задача 11 ТЗ 10.10.2026)
 * ------------------------------------------------------------------ */

/** Насколько деталь стены может выступать, чтобы из-за неё выносили картинку, м. */
export const PLATE_CLEARANCE_DEPTH = 0.75;
/** Запас перед самой выступающей деталью, м. */
export const PLATE_CLEARANCE_MARGIN = 0.02;

/* Многоугольник точек `[s, t, h]` по одну сторону прямой `side(q) ≥ 0`. */
function clipBy(polygon, side) {
  const out = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const fa = side(a);
    const fb = side(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const k = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    }
  }
  return out;
}

/**
 * Сколько вынести картинку вперёд, чтобы её не закрывали детали стены, м.
 *
 * Плашка стоит в нескольких сантиметрах от стены, а кирпич, наличник,
 * пилястра или водосток выступают дальше — и закрывали картинку. Берётся
 * наибольший выступ граней, что смотрят вдоль картинки (не поперёк:
 * `facing` — косинус), в её прямоугольнике перед её плоскостью, и запас.
 * Грань, что выходит дальше `depth`, — уже не деталь, а балкон или
 * соседний корпус: из-за неё картинку не выносят.
 *
 * `frame` — `{ point, normal, right, up, width, height }` плоскости
 * картинки (`point` — середина); `triangles` — `[[x, y, z] × 3]` или
 * `Float32Array` по 9 чисел на треугольник, в тех же осях. 0 — выносить
 * не надо.
 */
export function plateClearance(frame, triangles, { margin = PLATE_CLEARANCE_MARGIN, depth = PLATE_CLEARANCE_DEPTH, facing = 0.3 } = {}) {
  const { point, normal, right, up } = frame;
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  const flat = triangles instanceof Float32Array || triangles instanceof Float64Array;
  const count = flat ? Math.floor(triangles.length / 9) : triangles.length;
  const corner = [0, 0, 0];
  const local = (x, y, z) => {
    corner[0] = x - point[0];
    corner[1] = y - point[1];
    corner[2] = z - point[2];
    return [dot(corner, right), dot(corner, up), dot(corner, normal)];
  };
  let best = 0;
  for (let index = 0; index < count; index += 1) {
    let a;
    let b;
    let c;
    if (flat) {
      const at = index * 9;
      a = [triangles[at], triangles[at + 1], triangles[at + 2]];
      b = [triangles[at + 3], triangles[at + 4], triangles[at + 5]];
      c = [triangles[at + 6], triangles[at + 7], triangles[at + 8]];
    } else [a, b, c] = triangles[index];
    const la = local(a[0], a[1], a[2]);
    const lb = local(b[0], b[1], b[2]);
    const lc = local(c[0], c[1], c[2]);
    /* Позади картинки, мимо её прямоугольника или далеко впереди — не деталь. */
    if (la[2] <= 0 && lb[2] <= 0 && lc[2] <= 0) continue;
    if (la[2] > depth && lb[2] > depth && lc[2] > depth) continue;
    if (Math.max(la[0], lb[0], lc[0]) < -halfWidth || Math.min(la[0], lb[0], lc[0]) > halfWidth) continue;
    if (Math.max(la[1], lb[1], lc[1]) < -halfHeight || Math.min(la[1], lb[1], lc[1]) > halfHeight) continue;
    const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (!length || Math.abs(dot(n, normal)) / length < facing) continue;
    let polygon = [la, lb, lc];
    polygon = clipBy(polygon, (q) => q[0] + halfWidth);
    polygon = clipBy(polygon, (q) => halfWidth - q[0]);
    polygon = clipBy(polygon, (q) => q[1] + halfHeight);
    polygon = clipBy(polygon, (q) => halfHeight - q[1]);
    if (!polygon.length) continue;
    const top = Math.max(...polygon.map((q) => q[2]));
    if (top <= 0 || top > depth) continue;
    if (top > best) best = top;
  }
  return best > 0 ? Math.round((best + margin) * 1000) / 1000 : 0;
}

/**
 * То же для наклейки `{ point, normal, width, height, angle? }`, что стоит
 * в `offset` метрах от стены: на сколько сверх `offset` её вынести.
 */
export function decalClearance(decal, triangles, { offset = 0, ...options } = {}) {
  const { normal, right, up } = decalBasis(decal.normal, decal.angle);
  const point = decal.point.map((value, axis) => value + normal[axis] * offset);
  return plateClearance({ point, normal, right, up, width: decal.width, height: decal.height }, triangles, options);
}
