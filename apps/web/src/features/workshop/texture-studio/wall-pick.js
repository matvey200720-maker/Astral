/*
 * Стена по попаданию в кадр (3Б ТЗ 18.10.2026): сетка и номер треугольника под
 * курсором (`hit.mesh`, `hit.faceIndex`, их даёт `orbit-stage.js`) → стена
 * (`wall-face.js`) с положениями вершин в мире. Кадр рисует сцену пачками по
 * материалу и части — стена берётся внутри пачки, то есть внутри той же части.
 *
 * Здесь three только как источник атрибутов (`position`, `uv`, `index`,
 * `matrixWorld`); сам разбор — чистый, в `wall-face.js`.
 */

import { wallFace } from "./wall-face.js";

const isIdentity = (elements) => !elements || elements.every((value, at) => value === (at % 5 === 0 ? 1 : 0));

/** Стена под попаданием `hit` или `null` (не сетка сцены, нет развёртки, лист не аффинный). */
export function wallFromHit(hit) {
  const mesh = hit?.mesh;
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  const uv = geometry?.getAttribute?.("uv");
  if (!position || !uv || !Number.isInteger(hit.faceIndex)) return null;
  mesh.updateWorldMatrix?.(true, false);
  const elements = mesh.matrixWorld?.elements;
  const world = !isIdentity(elements);
  const positions = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    if (world) {
      positions[vertex * 3] = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
      positions[vertex * 3 + 1] = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
      positions[vertex * 3 + 2] = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
    } else {
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;
    }
  }
  const uvs = new Float32Array(uv.count * 2);
  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    uvs[vertex * 2] = uv.getX(vertex);
    uvs[vertex * 2 + 1] = uv.getY(vertex);
  }
  const wall = wallFace({ positions, uvs, index: geometry.index ? geometry.index.array : null, seed: hit.faceIndex, facing: hit.normal || null });
  if (!wall) return null;
  /* Запись материала — как её видит редактор (`match(info)` у поверхности). */
  return { ...wall, part: hit.part, material: hit.material, info: hit.info || null };
}
