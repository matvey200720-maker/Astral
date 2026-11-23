/*
 * Какая арена открывается в редакторе (владелец, 30.10.2026): плитка мастерской — всегда штатная арена GTA 5 RP и Majestic.
 *
 * «Редактировать» у арены каталога кладёт мод в общий черновик редактора (`project.mod`), и раньше он оставался там навсегда:
 * плитка открывала зал мода, ждала его сборку, а без пакета показывала только отказ — вернуться к штатной арене было нельзя.
 * Теперь каталог отмечает открытый мод на время сеанса окна; черновик с модом без отметки и без правок — забытый, и мод из него уходит.
 * Правки листов остаются: их снимает только сам человек кнопкой «Штатная арена».
 */

import { arenaModIsStock } from "@modovik/climb-contract/recolor/arena-mod";

const OPENED_KEY = "astral.arenas.mod-open.v1";

/** Каталог открыл мод `id`: он живёт в редакторе, пока человек из него не вышел. */
export function rememberArenaModOpen(id) {
  try {
    window.sessionStorage.setItem(OPENED_KEY, String(id));
  } catch {
    /* приватный режим браузера — мод откроется, а плитка потом вернёт штатную арену */
  }
}

export function forgetArenaModOpen() {
  try {
    window.sessionStorage.removeItem(OPENED_KEY);
  } catch {
    /* сеанс недоступен — помнить нечего */
  }
}

function openedMod() {
  try {
    return window.sessionStorage.getItem(OPENED_KEY) || "";
  } catch {
    return "";
  }
}

/** Работа без мода: дальше она про штатную арену своего сервера. */
export function withoutArenaMod(project) {
  const { mod: _mod, ...rest } = project;
  return rest;
}

/** Убирает из черновика `storageKey` забытый мод. Зовётся до первого чтения черновика: кадра мода и шага отмены не будет. */
export function dropForgottenArenaMod(storageKey) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    const project = stored ? JSON.parse(stored) : null;
    if (!project?.mod || !arenaModIsStock(project.mod) || project.mod.id === openedMod()) return;
    window.localStorage.setItem(storageKey, JSON.stringify(withoutArenaMod(project)));
  } catch {
    /* черновик не читается — редактор сам начнёт с чистой работы */
  }
}
