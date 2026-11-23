import { useSyncExternalStore } from "react";

/*
 * Выбранный вариант карточки (редукс «под GTA 5 RP / под Majestic»): запоминается на группу вариантов (`domain.variant.group`) и
 * переживает перезапуск окна. Плитка каталога одна на группу и всегда ведёт на первую запись, а страница сама показывает ту
 * версию, которую человек выбрал в прошлый раз.
 *
 * Хранилище — удобство окна: если браузер не даёт писать (закрытое хранилище), выбор живёт в памяти до перезапуска.
 */

const STORAGE_KEY = "astral.card.variant.v1";

// Один замороженный «выбора нет»: по нему React видит, что ничего не менялось.
const NOTHING = "";

// Таблица «группа → id записи»; null, пока хранилище не читали.
let table = null;
const listeners = new Set();

function loadTable() {
  if (table) return table;
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
    table = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    table = {};
  }
  return table;
}

function saveTable() {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // не записалось — живёт в памяти до перезапуска
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Id записи, выбранной в группе; пусто, если человек ещё не выбирал. */
export function rememberedVariant(group) {
  if (!group) return NOTHING;
  const found = own(loadTable(), group) ? loadTable()[group] : NOTHING;
  return typeof found === "string" ? found : NOTHING;
}

/** Запомнить выбор; пустой id снимает выбор (вернётся вариант «по умолчанию»). */
export function rememberVariant(group, modId) {
  if (!group) return;
  const next = { ...loadTable() };
  if (modId) next[group] = String(modId);
  else delete next[group];
  table = next;
  saveTable();
  for (const listener of [...listeners]) listener();
}

/** Подписка окна на выбор группы: страница перерисуется, когда выбор поменяли. */
export function useRememberedVariant(group) {
  return useSyncExternalStore(
    subscribe,
    () => rememberedVariant(group),
    () => NOTHING,
  );
}

/** Только для тестов: забыть всё прочитанное и записанное. */
export function resetRememberedVariants() {
  table = null;
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // нечего убирать
  }
}
