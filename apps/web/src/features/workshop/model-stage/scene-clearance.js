/*
 * Картинка поверх деталей стены и в кадре (задача 11 ТЗ 10.10.2026).
 *
 * Плашка с картинкой стоит в нескольких сантиметрах от стены, а кирпич,
 * наличник, пилястра или водосток выступают дальше — и закрывали её. В игре
 * установщик выносит плашку перед ними по граням моделей HD места
 * (`clearPlates`, `recolor-lod.js`); кадр выносит её той же функцией
 * договора (`decalClearance`) по граням своей сцены — плашка в кадре стоит
 * там же, где в игре.
 */

import { decalClearance } from "@modovik/climb-contract/recolor/decal";

const cache = new WeakMap();

/*
 * Грани сцены одним массивом (по 9 чисел), в осях сцены. Части, которые
 * кадр прячет вместо плашки (`cover:<место>` — объёмные буквы под своей
 * надписью), выносу не мешают: в игре их на месте плашки тоже нет.
 */
export function sceneTriangles(asset) {
  if (!asset?.meshes?.length) return new Float32Array(0);
  if (cache.has(asset)) return cache.get(asset);
  let count = 0;
  const meshes = asset.meshes.filter((mesh) => {
    const group = String(asset.materials?.[mesh.material]?.group || "");
    if (group.startsWith("cover:") || !mesh.positions || !mesh.indices) return false;
    count += Math.floor(mesh.indices.length / 3);
    return true;
  });
  const out = new Float32Array(count * 9);
  let at = 0;
  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    for (let index = 0; index + 2 < indices.length; index += 3)
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = indices[index + corner] * 3;
        out[at] = positions[vertex];
        out[at + 1] = positions[vertex + 1];
        out[at + 2] = positions[vertex + 2];
        at += 3;
      }
  }
  cache.set(asset, out);
  return out;
}

/** Отступ плашки кадра от стены: свой `offset` и вынос перед деталями, м. */
export function sceneOffset(asset, decal, offset) {
  const triangles = sceneTriangles(asset);
  return triangles.length ? offset + decalClearance(decal, triangles, { offset }) : offset;
}
