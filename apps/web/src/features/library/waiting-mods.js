/*
 * Компоненты, которые после обновления игры ждут новой версии (А10, шаг 3): движок снял их с причиной `waiting-for-version` (`stock-guard.js`), окно показывает
 * их в «Библиотеке» строкой с причиной и, когда в каталоге есть мод, ставит новую версию само (`useWaitingUpdates`) или по кнопке «Обновить».
 */

export const WAITING_REASON = "waiting-for-version";
export const isWaiting = (item) => item?.reason === WAITING_REASON;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Мод каталога за ждущим компонентом: по `origin.catalogModId`, иначе по id самого мода. */
export function catalogModOf(item, mods) {
  const wanted = [item?.origin?.catalogModId, item?.modId].filter(Boolean);
  const list = Array.isArray(mods) ? mods : [];
  for (const id of wanted) {
    const found = list.find((mod) => mod?.id === id);
    if (found) return found;
  }
  return null;
}

/* Идентификатор релиза в нижнем регистре или пусто. */
const releaseOf = (value) => (UUID.test(String(value || "")) ? String(value).toLowerCase() : "");

/**
 * Вышла ли в каталоге версия новее той, что ждёт: релиз мода (`releaseId`) отличается от релиза, с которого ставили (`origin.releaseId`), а если при установке его не
 * записали — от релиза, которому движок отказал (`refusedRelease`: в нём был прежний файл, `stock-guard.js`). Релиз, которому уже отказали, не новее.
 * Нет ни того, ни другого — `null`: сказать наверняка нельзя, окно пробует один раз тихо, а кнопка «Обновить» есть.
 */
export function newerRelease(item, mod) {
  const now = releaseOf(mod?.releaseId);
  if (!now) return false;
  const refused = releaseOf(item?.refusedRelease);
  if (refused === now) return false;
  const was = releaseOf(item?.origin?.releaseId) || refused;
  return was ? was !== now : null;
}

/** Каталог пока отдаёт тот самый релиз, которому движок уже отказал, — строка «в каталоге пока прежняя версия». */
export const refusedInCatalog = (item, mod) => Boolean(releaseOf(item?.refusedRelease) && releaseOf(item?.refusedRelease) === releaseOf(mod?.releaseId));

/**
 * Тихая попытка поставить новую версию ждущего компонента (`useWaitingUpdates`) упёрлась в «в каталоге пока прежняя версия» (`waiting-same-version`, `stock-guard.js`):
 * очередь принимает отказ молча — без уведомления и строки «Не удалось». Попытка человека (кнопка «Обновить») тихой не бывает.
 */
export const isQuietRefusal = (queueItem, failure) => Boolean(queueItem?.waitingAuto === true && failure?.kind === "waiting-same-version");

/** Как называть компонент в строке: название при установке, иначе id. */
export const waitingTitle = (item) => String(item?.origin?.title || item?.modId || "");

/**
 * Что показать и что поставить само. `rows` — по ждущему компоненту: `{ item, mod, title, canUpdate, newer, refused }`; `auto` — те, чей релиз в каталоге новее или
 * неизвестно, новее ли (`null`), и которые ещё не пробовали (`tried` — ключи `modId:releaseId`): одна тихая попытка на релиз, а отказ движка запоминается.
 */
export function waitingUpdatePlan({ removed, mods, tried = new Set() }) {
  const rows = (Array.isArray(removed) ? removed : []).filter(isWaiting).map((item) => {
    const mod = catalogModOf(item, mods);
    const newer = mod ? newerRelease(item, mod) : false;
    return { item, mod, title: waitingTitle(item), canUpdate: Boolean(mod && newer !== false), newer, refused: refusedInCatalog(item, mod) };
  });
  const auto = rows.filter((row) => row.mod && row.newer !== false && !tried.has(`${row.item.modId}:${row.mod.releaseId}`));
  return { rows, auto };
}
