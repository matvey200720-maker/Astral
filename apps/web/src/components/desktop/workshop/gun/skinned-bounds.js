import * as THREE from "three";

/*
 * Габарит скинованной сетки в позе (31.10.2026, ТЗ лида: «settleSkins и габариты»).
 *
 * `settleSkins` (gun-scene.js) на каждую загрузку персонажа ставит кости в позу кадра 0 и считает границы скинованных сеток: рамка «весь рост» и камера берут их через
 * `Box3.setFromObject`. `SkinnedMesh.computeBoundingBox()` и `computeBoundingSphere()` three проходят по вершинам ДВАЖДЫ и на каждой вершине у каждого из четырёх весов заново
 * перемножают матрицы кости (`bone.matrixWorld × boneInverse`, 16 умножений), поэтому у персонажа в сотню тысяч вершин это ≈ 25–30 мс на смену при ×4 — на каждую смену вещи.
 *
 * Здесь те же числа за один проход: матрица каждой кости считается один раз на сетку (костей около двух сотен), вершина — по тем же формулам three (`applyBoneTransform`:
 * точка в системе привязки → сумма весов × матрица кости → обратно), без выделений на вершину; скинованные точки откладываются в общий буфер, второй проход по нему даёт
 * сферу как у обычной сетки three (центр — середина габарита, радиус — до самой дальней точки; она охватывает все точки). Габарит совпадает с three до погрешности двойной точности —
 * его берёт рамка (`Box3.setFromObject`), поэтому рамка и камера не двигаются; сфера нужна только отсечению и лучу, а у `SkinnedMesh` three считается нарастающим `expandByPoint` (иная, тоже охватывающая).
 *
 * Сетка, которую так не посчитать (морфы, чередующиеся атрибуты, нет весов), возвращает `false` — вызывающий считает методами three, как раньше.
 */

const bone = new THREE.Matrix4();
const MAX_INFLUENCES = 4;
/** Общий буфер скинованных точек: растёт по самой большой сетке и живёт в модуле. */
let scratch = new Float64Array(3 * 4096);

/** Плоская запись аффинной матрицы: три строки по четыре числа (столбцовый порядок three → построчный). */
function rows(matrix, target, offset) {
  const e = matrix.elements;
  target[offset] = e[0];
  target[offset + 1] = e[4];
  target[offset + 2] = e[8];
  target[offset + 3] = e[12];
  target[offset + 4] = e[1];
  target[offset + 5] = e[5];
  target[offset + 6] = e[9];
  target[offset + 7] = e[13];
  target[offset + 8] = e[2];
  target[offset + 9] = e[6];
  target[offset + 10] = e[10];
  target[offset + 11] = e[14];
}

/** Читатель плоского атрибута: массив, шаг и множитель нормализации (целые веса 0…255 / 0…65535). `null` — так не прочесть. */
function plain(attribute, items) {
  if (!attribute || attribute.isInterleavedBufferAttribute || attribute.itemSize !== items) return null;
  const array = attribute.array;
  let scale = 1;
  if (attribute.normalized) {
    if (array instanceof Uint8Array) scale = 1 / 255;
    else if (array instanceof Uint16Array) scale = 1 / 65535;
    else if (array instanceof Int8Array) scale = 1 / 127;
    else if (array instanceof Int16Array) scale = 1 / 32767;
    else return null;
  }
  return { array, scale };
}

/**
 * Пересчитать `mesh.boundingBox` и `mesh.boundingSphere` скинованной сетки в нынешней позе костей — теми же числами, что дали бы `computeBoundingBox()` и `computeBoundingSphere()` three.
 * Кости и их матрицы мира должны быть обновлены (`updateMatrixWorld(true)`). `false` — сетку так не посчитать (ничего не тронуто).
 */
export function computeSkinnedBounds(mesh) {
  const geometry = mesh.geometry;
  const skeleton = mesh.skeleton;
  if (!geometry || !skeleton || geometry.morphAttributes?.position?.length) return false;
  const position = plain(geometry.getAttribute("position"), 3);
  const index = plain(geometry.getAttribute("skinIndex"), MAX_INFLUENCES);
  const weight = plain(geometry.getAttribute("skinWeight"), MAX_INFLUENCES);
  if (!position || !index || !weight || index.scale !== 1) return false;
  const count = geometry.getAttribute("position").count;
  if (count === 0) return false;

  const bones = skeleton.bones.length;
  const palette = new Float64Array(bones * 12);
  for (let at = 0; at < bones; at += 1) {
    const inverse = skeleton.boneInverses[at];
    const world = skeleton.bones[at]?.matrixWorld;
    if (!inverse || !world) return false;
    bone.multiplyMatrices(world, inverse);
    rows(bone, palette, at * 12);
  }
  const bind = new Float64Array(12);
  const unbind = new Float64Array(12);
  rows(mesh.bindMatrix, bind, 0);
  rows(mesh.bindMatrixInverse, unbind, 0);

  if (scratch.length < count * 3) scratch = new Float64Array(count * 3);
  const points = scratch;
  const p = position.array;
  const ix = index.array;
  const w = weight.array;
  const wScale = weight.scale;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = p[vertex * 3];
    const y = p[vertex * 3 + 1];
    const z = p[vertex * 3 + 2];
    /* Точка в системе привязки. */
    const bx = bind[0] * x + bind[1] * y + bind[2] * z + bind[3];
    const by = bind[4] * x + bind[5] * y + bind[6] * z + bind[7];
    const bz = bind[8] * x + bind[9] * y + bind[10] * z + bind[11];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < MAX_INFLUENCES; k += 1) {
      const weightK = w[vertex * 4 + k] * wScale;
      if (weightK === 0) continue;
      const m = ix[vertex * 4 + k] * 12;
      sx += weightK * (palette[m] * bx + palette[m + 1] * by + palette[m + 2] * bz + palette[m + 3]);
      sy += weightK * (palette[m + 4] * bx + palette[m + 5] * by + palette[m + 6] * bz + palette[m + 7]);
      sz += weightK * (palette[m + 8] * bx + palette[m + 9] * by + palette[m + 10] * bz + palette[m + 11]);
    }
    /* Обратно из системы привязки. */
    const rx = unbind[0] * sx + unbind[1] * sy + unbind[2] * sz + unbind[3];
    const ry = unbind[4] * sx + unbind[5] * sy + unbind[6] * sz + unbind[7];
    const rz = unbind[8] * sx + unbind[9] * sy + unbind[10] * sz + unbind[11];
    points[vertex * 3] = rx;
    points[vertex * 3 + 1] = ry;
    points[vertex * 3 + 2] = rz;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rz < minZ) minZ = rz;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
    if (rz > maxZ) maxZ = rz;
  }

  mesh.boundingBox = (mesh.boundingBox || new THREE.Box3()).set(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let farthest = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const dx = points[vertex * 3] - cx;
    const dy = points[vertex * 3 + 1] - cy;
    const dz = points[vertex * 3 + 2] - cz;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance > farthest) farthest = distance;
  }
  mesh.boundingSphere = (mesh.boundingSphere || new THREE.Sphere()).set(new THREE.Vector3(cx, cy, cz), Math.sqrt(farthest));
  return true;
}
