/*
 * Поток разбора сцен 3D-кадров (`scene-asset.js`, ТЗ 06.10.2026, вечер).
 * Распаковка zlib и разбор вершин сцены в несколько мегабайт занимали поток
 * окна на сотни миллисекунд — ровно в момент открытия редактора. Здесь они
 * идут в своём потоке; массивы вершин уходят окну без копии.
 */

import { footprintDistances, sceneBoxOf } from "./edge-field.js";
import { assembleScene, decodeSceneParts } from "./scene-asset.js";

/* Буферы частей сцены (`decodeSceneParts`): сетки, модели с копиями и их матрицы — копий-описаний в частях нет, разворачивать нечего. */
const buffersOf = (parts) => {
  const list = [];
  for (const mesh of [...parts.meshes, ...(parts.models || [])])
    for (const key of ["positions", "normals", "uvs", "indices", "colours", "uvs1", "matrices"]) {
      const array = mesh[key];
      if (array?.buffer && !list.includes(array.buffer)) list.push(array.buffer);
    }
  if (parts.footprint?.metres?.buffer) list.push(parts.footprint.metres.buffer);
  return list;
};

self.onmessage = (event) => {
  const { id, buffer, footprint: wanted = false, field } = event.data;
  /* Поле для сцены, что уже разобрана (`scene-asset.js`, `withFootprint`): вершины пришли копией. */
  if (field) {
    try {
      const result = footprintDistances(field.meshes, field.box);
      self.postMessage({ id, field: result }, result ? [result.metres.buffer] : []);
    } catch (error) {
      self.postMessage({ id, error: String(error?.message || error) });
    }
    return;
  }
  try {
    const parts = decodeSceneParts(new Uint8Array(buffer));
    /* Поле контура по рамке сцены — для мягкого края (`edge-fade.js`, 22.10.2026), только по просьбе кадра: в окне на
       закрытой ×4 оно держало вход до 70 мс, здесь — 10–40 мс потока. Копии моделей разворачиваются здесь же (только в этом потоке) и дальше не едут. */
    const box = wanted ? sceneBoxOf(parts.bounds) : null;
    const footprint = box ? footprintDistances(assembleScene(parts).meshes, box) : null;
    if (footprint) parts.footprint = footprint;
    self.postMessage({ id, asset: parts }, buffersOf(parts));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
