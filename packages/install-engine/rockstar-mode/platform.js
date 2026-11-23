/*
 * Откуда копия игры и что из этого следует для режима Rockstar (14.11.2026).
 *
 * `rockstarLauncher` описи (`@modovik/game-discovery`) узнаёт копию из
 * Rockstar Games Launcher по тому, чего у неё нет: `steam_api64.dll` лежит у
 * Steam, папка `.egstore` — у Epic. Фоновый агент описи не видит (он читает
 * только настройки режима), поэтому окно записывает ответ в настройки при
 * включении режима, а для записей прежних версий здесь тот же вывод по папке.
 *
 *   platform — `rockstar` | `steam` | `epic` | `other` (вторая папка Astral и всё
 *              неопознанное);
 *   needed   — лаунчер этой копии сам сверяет файлы и возвращает свои (сейчас
 *              только Rockstar Games Launcher): моды надо убрать из игры быстро
 *              и прятать, пока игра закрыта;
 *   linked   — вторая папка Astral (`astral-linked-copy.json`): режим у неё не
 *              включается, моды ставятся в неё напрямую.
 */

import { existsSync } from "node:fs";
import path from "node:path";

export const PLATFORMS = Object.freeze(["rockstar", "steam", "epic", "other"]);

const has = (folder, name) => {
  try {
    return existsSync(path.join(folder, name));
  } catch {
    return false;
  }
};

/** Платформа по записи описи (`store`, `rockstarLauncher`, `linkedCopy`). */
export function platformOfGame(game) {
  if (!game) return "other";
  if (game.rockstarLauncher) return "rockstar";
  if (game.linkedCopy) return "other";
  const store = String(game.store || "").toLowerCase();
  return store === "steam" || store === "epic" ? store : "other";
}

/** Платформа по папке игры — для записей настроек без неё (до 14.11.2026). */
export function platformOfFolder(gameRoot) {
  const folder = path.resolve(String(gameRoot || ""));
  if (has(folder, "astral-linked-copy.json"))
    return { platform: "other", needed: false, linked: true };
  if (has(folder, "steam_api64.dll"))
    return { platform: "steam", needed: false, linked: false };
  if (has(folder, ".egstore"))
    return { platform: "epic", needed: false, linked: false };
  return { platform: "rockstar", needed: true, linked: false };
}
