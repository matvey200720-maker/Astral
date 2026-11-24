/*
 * «Одна запись вместо двух» по каналам (19.11.2026, `launcher_app/docs/INSTALL-ONE-WRITE-1911.md`).
 *
 * Собранный `update.rpf` в игру переносится, а не копируется (`ASTRAL_INSTALL_MOVE_BUILD`, ядро —
 * `@modovik/install-engine/transactions.js: shouldMove`). Архив после установки равен прежнему
 * пути байт в байт (перенос — то же переименование того же файла), стенды обрыва, «Починить» и запуск игры пройдены.
 * В альфе включено с 19.11.2026; в бете и релизе — с 23.11.2026 (слово владельцев лиду 1: «Да, включай»; причина выключенного
 * умолчания в записке названа не была — «по итогам альфы решает ведущая»; разбор — `docs/INSTALL-MOVE-RELEASE-2311.md`).
 * Сборка на другом томе, чем игра, переименованию не поддаётся и идёт копией, как раньше.
 *
 * Слово в окружении (`off`, `0`, `1`) сильнее умолчания канала. Видимых человеку строк здесь нет.
 */

import { MOVE_BUILD_ENV } from "@modovik/install-engine/transactions.js";

/** Каналы, где перенос сборки включён по умолчанию. */
export const MOVE_BUILD_CHANNELS = Object.freeze(["alpha", "beta", "release"]);

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyMoveBuildDefault({ channel, env = process.env } = {}) {
  if (!MOVE_BUILD_CHANNELS.includes(channel)) return null;
  if (String(env[MOVE_BUILD_ENV] ?? "").trim() !== "") return null;
  env[MOVE_BUILD_ENV] = "1";
  return "1";
}
