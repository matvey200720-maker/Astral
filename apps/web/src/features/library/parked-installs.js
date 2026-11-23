/*
 * Работы мастерской, снятые проверкой файлов игры (задача 2 ТЗ 10.10.2026).
 *
 * После проверки целостности в Steam (обновления игры, лаунчера проекта со
 * своей копией update.rpf) модов Astral в игре нет. Моды движка — каталог и
 * работы-слои — движок сам переносит в «снятые» (`profile.parked`); работы,
 * поставленные нативным хостом (мини-карта, прицел, небо…), окно узнаёт по
 * цепочке точек отката: точка «откреплена» (`detached`) — архив вернули к
 * тому, что было до неё.
 *
 * Записи установок при этом не трогаются: в них путь патча и всё, что нужно,
 * чтобы поставить работу снова, — а проект и «Мои работы» живут своей жизнью.
 * Здесь лишь набор того, что снято (`modIds`, `points`): полка и редакторы
 * не показывают такие установки стоящими в игре (`readWorkshopInstallUnits`),
 * а «Установить снова» берёт их из тех же записей.
 */

export const PARKED_INSTALLS_KEY = "astral.workshop.parked.v1";

const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : []);

export function readParkedInstalls(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(PARKED_INSTALLS_KEY) || "null");
    return { modIds: new Set(list(value?.modIds)), points: new Set(list(value?.points)), at: value?.at || null };
  } catch {
    return { modIds: new Set(), points: new Set(), at: null };
  }
}

function writeParkedInstalls(storage, { modIds, points }) {
  try {
    if (!modIds.size && !points.size) storage?.removeItem(PARKED_INSTALLS_KEY);
    else
      storage?.setItem(
        PARKED_INSTALLS_KEY,
        JSON.stringify({ modIds: [...modIds].sort(), points: [...points].sort(), at: new Date().toISOString() }),
      );
    return true;
  } catch {
    return false;
  }
}

/** Снята ли установка (единица полки `readWorkshopInstallUnits`). */
export function isParkedUnit(unit, parked = readParkedInstalls()) {
  if (unit?.kind === "mod") return parked.modIds.has(unit.modId);
  if (unit?.kind === "native") return parked.points.has(unit.restorePointId);
  return false;
}

/**
 * Моды движка, снятые проверкой файлов, — как их называет движок
 * (`profile.parked`): этот список — правда, окно его просто держит.
 * Возвращает, изменилось ли что-то.
 */
export function syncParkedMods(modIds, storage = globalThis.localStorage) {
  const parked = readParkedInstalls(storage);
  const next = new Set(list([...(modIds || [])]));
  if (next.size === parked.modIds.size && [...next].every((id) => parked.modIds.has(id))) return false;
  return writeParkedInstalls(storage, { modIds: next, points: parked.points });
}

/** Точки работ хоста, ушедшие из игры с проверкой файлов. */
export function parkPoints(points, storage = globalThis.localStorage) {
  const parked = readParkedInstalls(storage);
  const before = parked.points.size;
  for (const point of list([...(points || [])])) parked.points.add(point);
  return parked.points.size !== before && writeParkedInstalls(storage, parked);
}

/** Работы снова в игре (поставлены заново или сняты совсем). */
export function unparkPoints(points, storage = globalThis.localStorage) {
  const parked = readParkedInstalls(storage);
  let changed = false;
  for (const point of list([...(points || [])])) changed = parked.points.delete(point) || changed;
  return changed && writeParkedInstalls(storage, parked);
}

/**
 * Какие точки работ хоста ушли из игры: по ответу `getLibraryStatus` —
 * откреплённые (`detached`). Неизвестные (`unknown`) — нет: архив мог
 * поменять OpenIV, и работы тогда на месте.
 */
export function detachedPoints(status) {
  return (status?.native?.items || []).filter((item) => item?.state === "detached").map((item) => item.id);
}
