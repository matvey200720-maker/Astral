/*
 * Части вещей зала в кадре (слово владельца 30.10.2026: «не могу удалить ковры»). Сцена кадра метит сетки номером сущности помещения; коврики у перил лежат в той же
 * сущности, что и перила (одна модель игры, `arena-item-parts.js`), поэтому кадр при загрузке сцены перенумеровывает их сетки: у части свой номер, и выбор, подсветка,
 * «Найти в зале», «Удалить» и скрытие в кадре работают с ней как с любой вещью. Сцена остаётся прежней (новый объект), перенумерация — только в окне.
 */

import { arenaItemParts } from "@modovik/climb-contract/recolor/arena-item-parts";

/** Сцена кадра, где сетки частей вещей несут номер части (`mesh.entity`), а номер вещи, чья она, — в `mesh.partOf`. Нет частей — та же сцена. */
export function splitArenaParts(asset, server) {
  const parts = arenaItemParts(server);
  if (!parts.length || !asset?.meshes || !asset.materials) return asset;
  let changed = false;
  const meshes = asset.meshes.map((mesh) => {
    const sheet = String(asset.materials[mesh.material]?.name || "").toLowerCase();
    const part = parts.find((item) => item.entity === mesh.entity && item.sheets.includes(sheet));
    if (!part) return mesh;
    changed = true;
    return { ...mesh, entity: part.key, partOf: part.entity };
  });
  return changed ? { ...asset, meshes } : asset;
}

/** Номера вещей `keys` и их частей: у вещи со своим обликом или убранной в кадре нет ни её самой, ни её ковриков. */
export function withParts(server, keys) {
  const list = [...keys];
  const parts = arenaItemParts(server).filter((part) => list.includes(part.entity)).map((part) => part.key);
  return parts.length ? [...new Set([...list, ...parts])] : list;
}
