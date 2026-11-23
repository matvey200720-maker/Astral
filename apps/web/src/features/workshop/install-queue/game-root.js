/*
 * Куда ставим: папка GTA V Legacy.
 *
 * Один и тот же поиск лежал четырьмя копиями — в окнах мини-карты, прицела,
 * большой карты и в редакторе залазов. Копии успели разойтись: одна проверяла
 * издание у выбранной вручную папки, другая нет, третья звала подготовку игры
 * и упиралась в чужой загрузчик. Теперь дорога одна.
 *
 * Сначала игра, выбранная в окне, затем вторая папка игры из Rockstar Games
 * Launcher (задача 2 ТЗ 07.10.2026: моды живут в ней — оригинал лаунчер
 * Rockstar откатывает), затем первая найденная установка Legacy, затем выбор
 * папки руками. Готовность
 * «к модам» здесь не спрашивается: она про ASI-загрузчик для папки `mods`, а
 * мастерская пишет прямой схемой слоя Astral — в настоящий `update.rpf`.
 */

import { chooseGameInstallation, detectInstallations } from "../../../api.js";

const isLegacy = (item) =>
  String(item?.edition || "Legacy").toLowerCase() === "legacy";

/* Выбранная в окне игра (`modovik-game-target`, DesktopShell). */
function selectedTargetId() {
  try {
    return globalThis.localStorage?.getItem("modovik-game-target") || "";
  } catch {
    return "";
  }
}

const folderKey = (folder) =>
  String(folder || "")
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .toLowerCase();

/**
 * Вторая папка игры вместо её оригинала (бета 15.10, Dympi: «написано, что
 * установлено, а в игре пусто»). Выбор игры запоминается в окне и переживал
 * сборку второй папки: моды шли в оригинал Rockstar, лаунчер Rockstar их
 * откатывал, а лаунчер сервера запускал игру из второй папки, где их не было.
 * Вторая папка существует только для модов — у оригинала, у которого она
 * есть, моды ставятся в неё.
 */
export function preferLinkedCopy(installations = [], item = null) {
  if (!item?.path || item.linkedCopy) return item;
  return (
    installations.find(
      (other) => other?.linkedCopy && folderKey(other.linkedCopy.source) === folderKey(item.path),
    ) || item
  );
}

/** Игра окна при запуске и после поиска: запомненная или первая, у оригинала со второй папкой — вторая. */
export function resolveGameTarget(installations = [], id = "") {
  return preferLinkedCopy(installations, installations.find((item) => item?.id === id) || installations[0] || null);
}

/** Куда ставить из найденного: выбранная (её вторая папка, если есть), вторая папка, первая Legacy. */
export function pickLegacy(installations = [], selected = selectedTargetId()) {
  const legacy = installations.filter((item) => item?.path && isLegacy(item));
  const chosen = legacy.find((item) => selected && item.id === selected);
  if (chosen) return preferLinkedCopy(legacy, chosen);
  return legacy.find((item) => item.linkedCopy) || legacy[0] || null;
}

/**
 * Найденная установка Legacy — без окна выбора папки: для того, что ищется
 * само, пока человек ничего не просил (вещи из игры в «Виде» мастерской).
 * @returns {Promise<string>} путь к игре или пусто
 */
export async function detectLegacyGame() {
  return pickLegacy(await detectInstallations())?.path || "";
}

/**
 * @param {string} [known] уже известная папка — тогда поиска не будет
 * @returns {Promise<string>} путь к игре
 * @throws если человек закрыл выбор или выбрал не Legacy
 */
export async function locateLegacyGame(known = "") {
  if (known) return known;
  const found = await detectLegacyGame();
  if (found) return found;
  const chosen = await chooseGameInstallation();
  const path = chosen?.path || chosen?.game?.path || "";
  if (!path)
    throw new Error("Папка GTA V Legacy не выбрана — устанавливать некуда.");
  if (!isLegacy(chosen?.game || chosen))
    throw new Error("Выберите установку GTA V Legacy для Majestic или GTA5RP.");
  return path;
}

/** То же, но вместе с целью установки: движку нужен `targetId`. */
export async function locateLegacyTarget() {
  const found = pickLegacy(await detectInstallations());
  if (found?.path) return { path: found.path, id: found.id };
  const chosen = await chooseGameInstallation();
  const game = chosen?.game || chosen;
  if (!game?.path)
    throw new Error("Папка GTA V Legacy не выбрана — устанавливать некуда.");
  if (!isLegacy(game))
    throw new Error("Выберите установку GTA V Legacy для Majestic или GTA5RP.");
  return { path: game.path, id: game.id };
}
