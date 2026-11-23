/*
 * Только кисти перчаток (19.10, правило владельца про обложки одежды: «перчатки — две кисти к зрителю»; 24.10 ночью — «без рук, плеч и шеи,
 * голой кожи предплечья нет»). Мод перчаток лежит в `uppr` и нередко несёт всю руку, а то и торс; обложке нужны кисти — пальцы, ладонь и
 * манжета, если она на предплечье.
 *
 * Кисть отделяет плоскость запястья: перпендикулярна предплечью, проходит через запястье, пальцы — по ту сторону, куда смотрит `WRIST_AXIS`.
 * Модели `uppr` стоят в одной позе привязки (мужской и женский скелет `mp_[mf]_freemode_01`), поэтому у плоскости есть запасные числа
 * (`WRIST_POINT`, замер по пятнадцати моделям трёх модов: запястье у левой руки (0,49; 0,006; −0,047), в пределах сантиметра у всех). У модели
 * с весами точка запястья берётся из неё самой: там, где вес кисти (кости 42–64 и 71–93 в скелете педа) переходит в вес предплечья
 * (41/65 и 70/94). Мод без весов (авторы нередко «запекают» сетку без привязки) режется по запасным числам. Треугольники, что плоскость
 * пересекает, разрезаются по ней — край ровный, без зубцов; атрибуты вершин в разрезе интерполируются.
 *
 * Кожа предплечья в кадр не идёт. Что в кадре кожа, а что перчатка, решает текстура мода: эталон кожи — цвет на плече и верхней части руки,
 * куда перчатка не достаёт; треугольник — «не кожа», если цвет текстуры в его середине дальше от эталона, чем разброс самого эталона.
 *   • У запястья «не кожа» (длинная перчатка, рукав) — плоскость уходит назад по предплечью до конца этой «не кожи» (слоями по сантиметру,
 *     не дальше `cuffMax`).
 *   • У запястья кожа, а перчатка начинается чуть выше (узкая полоска кожи над манжетой) — плоскость поднимается до начала перчатки (не дальше
 *     `lift`), а кожные треугольники в первых двух сантиметрах над плоскостью снимаются: край перчатки чистый.
 *   • Перчатки нет (голая кисть с кольцами, браслет) — ровно по запястью.
 * Без картинки расцветки манжеты нет — кадр режется ровно по запястью.
 *
 * `null`, если кистей нет, оторвать их не от чего или остаётся слишком мало треугольников: обложка остаётся прежней. Вырезанное помечено
 * `handsCut` — второй раз вещь не режется.
 */

/** Кости кисти и пальцев по номеру в скелете педа. */
export const HAND_JOINTS = Object.freeze(
  new Set([
    ...Array.from({ length: 23 }, (_, index) => 42 + index),
    ...Array.from({ length: 23 }, (_, index) => 71 + index),
  ]),
);
/** Предплечье и его ролл — манжета у запястья. */
export const CUFF_JOINTS = Object.freeze(new Set([41, 65, 70, 94]));

const norm = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
/* Запястье левой руки (x > 0) и направление «предплечье → пальцы», в пространстве файла (Y вверх, вперёд — +Z); правая — зеркально по X. */
export const WRIST_POINT = Object.freeze([0.49, 0.006, -0.047]);
export const WRIST_AXIS = Object.freeze(norm([0.5, -0.865, 0.11]));

/* Сколько вершин у границы кисти и предплечья нужно, чтобы доверять точке запястья из весов, а не запасной. */
const MIN_BOUNDARY = 8;
const PER_VERTEX = { positions: 3, normals: 3, uvs: 2, uvs1: 2, colours: 4 };
const MIN_TRIANGLES = 24;
/* Кожа плеча — эталон: плечо и верх руки лежат дальше от запястья, чем эта длина вдоль оси. */
const SKIN_REFERENCE_FROM = 0.22;
/* Слой манжеты, метры; сколько сантиметров над плоскостью чистятся кожные треугольники. */
const LAYER = 0.01;
const PEEL_BAND = 0.02;
const MIN_REFERENCE = 12;
const MIN_LAYER = 3;

function weightsOf(skin, vertex, joints) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot += 1)
    if (joints.has(skin.joints[vertex * 4 + slot])) sum += skin.weights[vertex * 4 + slot];
  return sum;
}

/** Плоскость запястья стороны `side` (−1 или 1): `{ point, axis }`. */
export function planeOf(side, point) {
  return {
    point: [side * point[0], point[1], point[2]],
    axis: [side * WRIST_AXIS[0], WRIST_AXIS[1], WRIST_AXIS[2]],
  };
}

/** Расстояние от точки `(x, y, z)` до плоскости вдоль оси: «+» — на стороне пальцев. */
const heightAbove = (plane, x, y, z) =>
  (x - plane.point[0]) * plane.axis[0] + (y - plane.point[1]) * plane.axis[1] + (z - plane.point[2]) * plane.axis[2];

/** Точка запястья у модели с весами: среднее вершин, где вес кисти — около половины; `null`, если таких мало. */
function wristFromWeights(meshes, side) {
  const sum = [0, 0, 0];
  let count = 0;
  for (const mesh of meshes) {
    const total = mesh.positions.length / 3;
    for (let vertex = 0; vertex < total; vertex += 1) {
      const x = mesh.positions[vertex * 3];
      if ((x < 0 ? -1 : 1) !== side) continue;
      const hand = weightsOf(mesh.skin, vertex, HAND_JOINTS);
      if (hand < 0.3 || hand > 0.7) continue;
      if (weightsOf(mesh.skin, vertex, CUFF_JOINTS) < 0.2) continue;
      for (let axis = 0; axis < 3; axis += 1) sum[axis] += mesh.positions[vertex * 3 + axis];
      count += 1;
    }
  }
  if (count < MIN_BOUNDARY) return null;
  return [sum[0] / count, sum[1] / count, sum[2] / count].map((value, axis) => (axis === 0 ? Math.abs(value) : value));
}

/** Цвет текстуры в точке `(u, v)`: `[r, g, b]` или `null` (прозрачный пиксель). Текстура повторяется, строка 0 — сверху (как у съёмщика). */
function sampleOf(picture, u, v) {
  const x = Math.min(picture.width - 1, Math.floor((u - Math.floor(u)) * picture.width));
  const y = Math.min(picture.height - 1, Math.floor((v - Math.floor(v)) * picture.height));
  const at = (y * picture.width + x) * 4;
  return picture.rgba[at + 3] < 128 ? null : [picture.rgba[at], picture.rgba[at + 1], picture.rgba[at + 2]];
}

/** Середина треугольника `at` меша: `{ side, height, colour }` — сторона, высота над плоскостью своей стороны и цвет текстуры в середине. */
function middleOf(mesh, at, planes, picture) {
  const [a, b, c] = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
  const mid = (array, size, k) => (array[a * size + k] + array[b * size + k] + array[c * size + k]) / 3;
  const x = mid(mesh.positions, 3, 0);
  const side = x < 0 ? -1 : 1;
  const height = heightAbove(planes[side], x, mid(mesh.positions, 3, 1), mid(mesh.positions, 3, 2));
  const colour = mesh.uvs && picture ? sampleOf(picture, mid(mesh.uvs, 2, 0), mid(mesh.uvs, 2, 1)) : null;
  return { side, height, colour };
}

/** Проверка «кожа ли это» по эталону (середины треугольников далеко от запястья); `null`, если эталона не набралось. */
function skinTest(meshes, planes, picture) {
  const reference = [];
  for (const mesh of meshes)
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const { height, colour } = middleOf(mesh, at, planes, picture);
      if (colour && height <= -SKIN_REFERENCE_FROM) reference.push(colour);
    }
  if (reference.length < MIN_REFERENCE) return null;
  const mean = [0, 1, 2].map((channel) => reference.reduce((sum, colour) => sum + colour[channel], 0) / reference.length);
  const distance = (colour) => Math.hypot(colour[0] - mean[0], colour[1] - mean[1], colour[2] - mean[2]);
  const spread = reference.reduce((sum, colour) => sum + distance(colour), 0) / reference.length;
  const limit = Math.max(48, spread * 2.5);
  return (colour) => distance(colour) <= limit;
}

/**
 * Куда сдвинуть плоскость запястья (метры вдоль оси, «+» — к пальцам) и есть ли у модели перчатка у запястья: `{ shift, glove }`.
 * Слои по сантиметру считаются по серединам треугольников; слой «не кожа», если так у половины его треугольников (не меньше трёх).
 */
export function wristShift({ meshes, planes, picture, cuffMax = 0.2, lift = 0.03 }) {
  const isSkin = skinTest(meshes, planes, picture);
  if (!isSkin) return { shift: 0, glove: false };
  const below = Math.ceil(cuffMax / LAYER);
  const total = below + Math.ceil(lift / LAYER) + 3;
  const layers = Array.from({ length: total }, () => ({ all: 0, glove: 0 }));
  for (const mesh of meshes)
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const { height, colour } = middleOf(mesh, at, planes, picture);
      if (!colour) continue;
      const layer = Math.floor((height + cuffMax) / LAYER);
      if (layer < 0 || layer >= total) continue;
      layers[layer].all += 1;
      if (!isSkin(colour)) layers[layer].glove += 1;
    }
  const verdict = (layer) => (layers[layer].all < MIN_LAYER ? null : layers[layer].glove / layers[layer].all >= 0.5);
  if (verdict(below) === true) {
    let length = 0;
    for (let layer = below - 1; layer >= 0 && verdict(layer) === true; layer -= 1) length = (below - layer) * LAYER;
    return { shift: -length, glove: true };
  }
  const reach = Math.ceil(lift / LAYER);
  for (let layer = below + 1; layer <= below + reach; layer += 1) if (verdict(layer) === true) return { shift: (layer - below) * LAYER, glove: true };
  /* Перчатка выше `lift`, но есть (у голой кисти слои выше запястья — кожа с редкими кольцами): плоскость не двигается, кожа в полосе остаётся. */
  return { shift: 0, glove: false };
}

/** Часть меша `mesh` с высотой `≥ shift` над плоскостью своей стороны; треугольники на границе разрезаны. `null` — ничего не осталось. */
function clipMesh(mesh, planes, shift) {
  const keys = Object.entries(PER_VERTEX).filter(([key]) => mesh[key]);
  const pick = new Map(); // исходная вершина → новый индекс
  const out = Object.fromEntries(keys.map(([key]) => [key, []]));
  const indices = [];
  let next = 0;
  const copy = (vertex) => {
    if (pick.has(vertex)) return pick.get(vertex);
    for (const [key, size] of keys) for (let k = 0; k < size; k += 1) out[key].push(mesh[key][vertex * size + k]);
    pick.set(vertex, next);
    return next++;
  };
  const between = (a, b, k) => {
    for (const [key, size] of keys)
      for (let j = 0; j < size; j += 1) out[key].push(mesh[key][a * size + j] * (1 - k) + mesh[key][b * size + j] * k);
    return next++;
  };
  const heightOf = (vertex, plane) =>
    heightAbove(plane, mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]) - shift;
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    const tri = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
    /* Сторона треугольника — по его середине: у кисти все три вершины на одной стороне. */
    const side = (mesh.positions[tri[0] * 3] + mesh.positions[tri[1] * 3] + mesh.positions[tri[2] * 3]) / 3 < 0 ? -1 : 1;
    const t = tri.map((vertex) => heightOf(vertex, planes[side]));
    if (t[0] >= 0 && t[1] >= 0 && t[2] >= 0) {
      indices.push(copy(tri[0]), copy(tri[1]), copy(tri[2]));
      continue;
    }
    if (t[0] < 0 && t[1] < 0 && t[2] < 0) continue;
    /* Отсечение многоугольника плоскостью (Сазерленд — Ходжман): вершина — исходная или точка на ребре. */
    const polygon = [];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = edge;
      const b = (edge + 1) % 3;
      if (t[a] >= 0) polygon.push(copy(tri[a]));
      if (t[a] >= 0 !== t[b] >= 0) polygon.push(between(tri[a], tri[b], t[a] / (t[a] - t[b])));
    }
    for (let k = 1; k + 1 < polygon.length; k += 1) indices.push(polygon[0], polygon[k], polygon[k + 1]);
  }
  if (!indices.length) return null;
  const cut = { ...mesh, indices: next > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices) };
  delete cut.skin;
  cut.skinned = false;
  for (const [key] of keys) cut[key] = Float32Array.from(out[key]);
  return cut;
}

/** Снять кожные треугольники у самого края (первые `PEEL_BAND` метров над плоскостью `shift`): перчатка начинается чисто, без полоски кожи. */
function peelSkin(mesh, planes, shift, picture, isSkin) {
  const kept = [];
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    const { height, colour } = middleOf(mesh, at, planes, picture);
    if (colour && height - shift < PEEL_BAND && isSkin(colour)) continue;
    kept.push(mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]);
  }
  return kept.length ? { ...mesh, indices: mesh.indices.constructor.from(kept) } : null;
}

/**
 * @param {object} drawable — модель вещи (`readDrawable`); меши с `skin` дают точку запястья из весов
 * @param {object} [options]
 * @param {{ width: number, height: number, rgba: Uint8Array }} [options.picture] — расцветка: по ней находится манжета на предплечье
 * @param {number} [options.cuffMax] — до какой длины манжеты (метры) искать не кожу назад от запястья, по умолчанию 0,2
 * @param {number} [options.lift] — на сколько (метры) плоскость может подняться к пальцам, если перчатка начинается выше запястья, по умолчанию 0,03
 */
export function handsOnly(drawable, { picture = null, cuffMax = 0.2, lift = 0.03 } = {}) {
  if (drawable?.handsCut) return drawable;
  const meshes = drawable?.meshes;
  if (!meshes?.length || !meshes.every((mesh) => mesh.positions?.length && mesh.indices?.length)) return null;
  const skinned = meshes.every((mesh) => mesh.skin);
  const planes = {
    [-1]: planeOf(-1, (skinned && wristFromWeights(meshes, -1)) || WRIST_POINT),
    [1]: planeOf(1, (skinned && wristFromWeights(meshes, 1)) || WRIST_POINT),
  };
  const { shift, glove } = picture ? wristShift({ meshes, planes, picture, cuffMax, lift }) : { shift: 0, glove: false };
  const isSkin = glove ? skinTest(meshes, planes, picture) : null;
  const out = [];
  let triangles = 0;
  for (const mesh of meshes) {
    let cut = clipMesh(mesh, planes, shift);
    if (cut && isSkin) cut = peelSkin(cut, planes, shift, picture, isSkin);
    if (!cut) continue;
    out.push(cut);
    triangles += cut.indices.length / 3;
  }
  if (triangles < MIN_TRIANGLES || !out.length) return null;
  return { ...drawable, meshes: out, handsCut: true };
}

/** Убрать веса с вершин: после выреза кистей они больше не нужны и не должны ехать в кадр. */
export function withoutSkin(drawable) {
  if (!drawable?.meshes?.some((mesh) => mesh.skin)) return drawable;
  return {
    ...drawable,
    meshes: drawable.meshes.map(({ skin: _skin, ...mesh }) => mesh),
  };
}
