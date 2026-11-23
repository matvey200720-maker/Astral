import { splitItemParts } from "./item-parts.js";
import { cutItemParts } from "./item-part-cut.js";

// Деление по близости, затем вырезка по месту вещи (если оно известно).
function partsOf(meshes, place, gap) {
  const pieces = splitItemParts(meshes, { gap });
  return cutItemParts(meshes, pieces, place);
}

const solveEntity = ({ key, place, meshes }, gap) => ({ key, parts: partsOf(meshes, place, gap) });

// Уникальные буферы диапазонов в порядке обхода: у части сначала runs, затем own.
function rangeBuffers(solved) {
  const parts = solved.flatMap((entity) => entity.parts);
  const seen = new Set();
  for (const part of parts) {
    seen.add(part.runs.buffer);
    if (part.own) seen.add(part.own.buffer);
  }
  return Array.from(seen);
}

const scope = self;

// Данные события разбираются без защиты: без них ответа нет, как и прежде.
scope.onmessage = ({ data: { id, entities, gap } }) => {
  try {
    const solved = entities.map((entity) => solveEntity(entity, gap));
    scope.postMessage({ id, entities: solved }, rangeBuffers(solved));
  } catch (thrown) {
    scope.postMessage({ id, error: String(thrown?.message || thrown) });
  }
};
