/*
 * «Одна запись вместо двух» по каналам (19.11.2026, `launcher_app/docs/INSTALL-ONE-WRITE-1911.md`).
 *
 * Собранный `update.rpf` в игру переносится, а не копируется (`ASTRAL_INSTALL_MOVE_BUILD`, ядро —
 * `@modovik/install-engine/transactions.js: shouldMove`). В альфе это включено: архив после установки равен прежнему
 * пути байт в байт (перенос — то же переименование того же файла), стенды обрыва, «Починить» и запуск игры пройдены.
 * В бете и релизе выключатель не трогается — там по итогам альфы решает ведущая.
 *
 * Слово в окружении (`off`, `0`, `1`) сильнее умолчания канала. Видимых человеку строк здесь нет.
 */

import { MOVE_BUILD_ENV } from "@modovik/install-engine/transactions.js";

/** Канал, где перенос сборки включён по умолчанию. */
export const MOVE_BUILD_CHANNEL = "alpha";

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyMoveBuildDefault({ channel, env = process.env } = {}) {
  if (channel !== MOVE_BUILD_CHANNEL) return null;
  if (String(env[MOVE_BUILD_ENV] ?? "").trim() !== "") return null;
  env[MOVE_BUILD_ENV] = "1";
  return "1";
}
