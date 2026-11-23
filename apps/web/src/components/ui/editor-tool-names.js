import { useSyncExternalStore } from "react";

/*
 * Названия в колонке инструментов: показаны или свёрнуты до значков.
 *
 * По умолчанию названия видны во всех редакторах (владелец, 24.10.2026): новый
 * человек должен с первого взгляда понять, «та ли это вкладка», не наводя мышь
 * на каждый значок. Кто уже знает редактор, сворачивает колонку до значков и
 * забирает место кадру. Выбор один на все редакторы и переживает перезапуск;
 * хранилище может быть недоступно (приватное окно, снимок превью) — тогда
 * просто названия.
 *
 * Узкое окно колонку сворачивает само, без выбора человека: при минимальном
 * окне приложения (1180 px) названия оставляли кадру 607 px из прежних 745, и
 * 192 px слева там дороже подписей. Порог 1240: от него кадр не уже 650.
 */

const KEY = "astral.editor-tools.icons";
const listeners = new Set();
let iconsOnly = read();

function read() {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setToolNamesHidden(next) {
  iconsOnly = Boolean(next);
  try {
    if (iconsOnly) globalThis.localStorage?.setItem(KEY, "1");
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* Не записалось — выбор живёт до перезапуска. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToolNamesHidden() {
  return useSyncExternalStore(subscribe, () => iconsOnly, () => false);
}

const NARROW = "(max-width: 1239px)";

function subscribeNarrow(listener) {
  const query = globalThis.matchMedia?.(NARROW);
  query?.addEventListener?.("change", listener);
  return () => query?.removeEventListener?.("change", listener);
}

export function useNarrowWindow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => Boolean(globalThis.matchMedia?.(NARROW)?.matches),
    () => false,
  );
}
