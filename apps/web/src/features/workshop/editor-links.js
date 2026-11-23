/*
 * Переход из одного редактора мастерской в другой — сразу к нужному органу
 * (17.10, ТЗ владельца, задача 9).
 *
 * Редактор мини-карты ведёт в «Большую карту» на выключатель «Большая карта
 * на мини-карте»: настройка живёт там (картинка радара — это плитки большой
 * карты), а искать её будут и в мини-карте. Редактор не знает, кто его открыл,
 * поэтому просьба уходит событием окна: её слушает `useWorkshopEditors` и
 * открывает слот поверх текущего редактора (выход вернёт назад), а к какому
 * органу прокрутить — кладётся на несколько секунд в память сессии, и
 * редактор слота читает её при открытии (`takeEditorFocus`). Не стирается
 * при чтении: студия при открытии собирается дважды (загрузка проекта), и
 * вторая сборка осталась бы без органа.
 */

export const WORKSHOP_OPEN_EDITOR_EVENT = "astral:workshop-open-editor";

const FOCUS_KEY = "astral.workshop.editor-focus.v1";
/* Просьба старше нескольких секунд — уже не этот переход: редактор,
   открытый позже сам, к органу не прыгает. */
const FOCUS_TTL_MS = 8_000;

function storage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

/** Попросить мастерскую открыть редактор слота `slotId` на органе `focus`. */
export function openWorkshopEditor({ slotId, focus = "" }) {
  if (typeof window === "undefined" || !slotId) return;
  window.dispatchEvent(
    new CustomEvent(WORKSHOP_OPEN_EDITOR_EVENT, { detail: { slotId, focus } }),
  );
}

/** Запомнить, к какому органу вести редактор слота при открытии. */
export function rememberEditorFocus(slotId, focus) {
  if (!focus) return;
  try {
    storage()?.setItem(FOCUS_KEY, JSON.stringify({ slotId, focus, at: Date.now() }));
  } catch {
    /* Память сессии недоступна — переход откроет редактор без прокрутки. */
  }
}

/** Орган, к которому только что просили вести редактор слота; пусто — нет. */
export function takeEditorFocus(slotId) {
  const memory = storage();
  if (!memory) return "";
  try {
    const raw = memory.getItem(FOCUS_KEY);
    if (!raw) return "";
    const value = JSON.parse(raw);
    if (value?.slotId !== slotId) return "";
    if (Date.now() - Number(value.at) > FOCUS_TTL_MS) {
      memory.removeItem(FOCUS_KEY);
      return "";
    }
    return String(value.focus || "");
  } catch {
    return "";
  }
}
