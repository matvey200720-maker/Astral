/*
 * Слова главного процесса в окне «Анимации» (ТЗ 29.10-d): ошибки чтения и установки приходят русскими строками без кода (оболочка
 * Electron оставляет только сообщение). Окно показывает их так: известная фраза — по словарю на языке окна; русская неизвестная —
 * как есть только в русском окне, на другом языке её нет (подробности остаются у разработчика в журнале, а вместо неё — запасная
 * фраза или пусто); не русская (код системы вроде `ENOSPC`) — как есть.
 */

import { currentUiLanguage, tr } from "../../../locales/ui.js";

const CYRILLIC = /[А-Яа-яЁё]/;

/** Сообщение ошибки без оболочки Electron: «Error invoking remote method '…': Error: …» → «…». */
export function messageOf(error) {
  return String(error?.message ?? error ?? "")
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
}

/** Фраза для окна по ошибке или строке главного процесса; `fallback` — когда на языке окна сказать нечем. */
export function mainProcessText(error, fallback = "") {
  const message = messageOf(error);
  if (!message) return fallback;
  const said = tr(message);
  if (said !== message) return said;
  return currentUiLanguage() === "ru" || !CYRILLIC.test(message) ? message : fallback;
}
