/*
 * Кому нужна пара `dinput8.dll` + `RageOpenV.asi` (23.11.2026, слово владельца: «ставить пару только когда человек сам
 * ставит мегамолл или ReShade и все нужные для этой пары моды»).
 *
 * Прямая схема (`update/update.rpf`, `update/x64/dlcpacks/astral_*`) игре загрузчика не требует
 * (`astral-layer.js`); он нужен пакетам, которые кладут файлы в `mods`/`newmods`. Манифест такого пакета не говорит
 * `requiresLoader: false`, а область записи у него не корень игры.
 *
 * Здесь нет ни импортов, ни ввода-вывода: файл читают и манифест (`manifest.js`), и запись установки (`stage-package.js`),
 * и приложение (`apps/desktop/src/loaders-on-demand.js`).
 */

/** Пакету нужна пара: `requiresLoader` не `false` и область не корень игры (как условие окна в `install-plan.js`). */
export function manifestNeedsLoader(manifest) {
  return manifest?.requiresLoader !== false && manifest?.scope !== "game-root";
}

/* Адаптеры, которым плагин нужен всегда: игра должна увидеть `newmods`-VFS. */
const LOADER_ADAPTERS = new Set(["rageopenv-loose", "managed-addon-dlc"]);
/* Файл записи установки лежит в `mods`/`newmods` — читает его только плагин архивов. */
const MODS_PATH = /^(?:new)?mods[\\/]/i;

/**
 * Запись установки держит пару. Явная пометка `needsLoader` решает сама (её пишет движок с 23.11.2026); у прежних записей
 * без пометки — по адаптеру и по путям файлов (`resources` — список целей записи): `mods`/`newmods` без плагина игра не читает.
 */
export function recordNeedsLoader(record) {
  if (!record || typeof record !== "object") return false;
  if (typeof record.needsLoader === "boolean") return record.needsLoader;
  if (LOADER_ADAPTERS.has(String(record.adapter || ""))) return true;
  return Array.isArray(record.resources) && record.resources.some((target) => MODS_PATH.test(String(target)));
}
