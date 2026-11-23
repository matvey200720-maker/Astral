import { PACK_OVERLAY_FROM, separateLayers } from "./parts.js";

// В позициях группы на каждый треугольник приходится шесть чисел: x и y трёх вершин.
const NUMBERS_PER_TRIANGLE = 6;

const triangleCount = (groups) => {
  let total = 0;
  for (const { positions } of groups) total += positions.length / NUMBERS_PER_TRIANGLE;
  return total;
};

const withBase = (geometry, base) => {
  const replaced = { groups: base, triangles: triangleCount(base) };
  return { ...geometry, ...replaced };
};

// Группа считается слоем, если она выше порога и в ней есть хотя бы одно число позиций.
const isLayer =
  (from) =>
  ({ height, positions }) =>
    height > from && positions.length;

/**
 * Копия геометрии пака без слоёв поверх радара. Если групп нет — то же значение.
 */
export const packBaseGeometry = (geometry, from = PACK_OVERLAY_FROM) =>
  geometry?.groups ? withBase(geometry, separateLayers(geometry, from).base) : geometry;

/**
 * Есть ли у геометрии хотя бы одна непустая группа выше порога.
 */
export const packHasLayers = (geometry, from = PACK_OVERLAY_FROM) => geometry?.groups?.some(isLayer(from)) === true;
