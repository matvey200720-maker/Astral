// Попадание по подписям донора (инструмент «Подписи») и меткам вики Majestic.
import { labelMeshData, majesticMarkAt, meshLabelAt } from "@modovik/vector-map";
import { POINTS } from "./numbers.js";

const setOf = (item) => item.group || "own";

// Ключи подписей донора, заменённых собственной меткой того же набора
export const replacedKeys = (items, group) =>
  new Set(
    items
      .filter((other) => Boolean(other.replaces) && setOf(other) === group)
      .flatMap((other) => [].concat(other.replaces)),
  );

// Метка с картинкой донора может отвечать на нажатие, если она включена, свободна и набор не скрыт
function answersPicks(markers, item) {
  if (!item.mesh || item.enabled === false || item.locked) return false;
  const blockers = [markers.hiddenGroups, markers.lockedGroups];
  return !blockers.some((groups) => groups?.includes?.(setOf(item)) === true);
}

// Метка с картинкой донора и её подпись под точкой: { item, set, mesh, key } или null
export function meshHitAt(env, { x, y }) {
  const { markers } = env.config;
  if (!markers?.enabled || !env.onMeshPick) return null;
  const reach = env.tolerance * POINTS.meshReach;
  // метки перебираются от последней к первой
  return markers.items.reduceRight((found, item) => {
    if (found || !answersPicks(markers, item)) return found;
    const hit = meshLabelAt(labelMeshData(item.mesh), x, y, reach, replacedKeys(markers.items, setOf(item)));
    return hit ? { item, set: setOf(item), mesh: item.mesh, key: hit.key } : null;
  }, null);
}

// Метка вики (точка или зона) под точкой
export function majesticHitAt(env, { x, y }) {
  if (!env.onMajesticPick) return null;
  const reach = env.tolerance * POINTS.majesticReach;
  return majesticMarkAt(env.config.majestic, x, y, reach) ?? null;
}
