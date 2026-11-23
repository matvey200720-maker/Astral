/*
 * Поставленные арены, собранные старой версией (пересобранные модели зала Majestic): подготовка игры находит их при запуске
 * (`placesMigration.rebuiltShells`), мастерская арены показывает над панелью строку с кнопками «Пересобрать безопасно» и «Снять»
 * (`RebuiltArenaBanner.jsx`). Хранится в памяти окна: после «Пересобрать безопасно» или «Снять» запись гасится.
 */
import { useSyncExternalStore } from "react";

let works = [];
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

/** Запомнить работы `[{ set, modId, names }]`; только «Арена»: у других наборов своих кнопок нет. */
export function setRebuiltArenas(next) {
  works = (Array.isArray(next) ? next : []).filter(
    (work) => work?.set === "arenas",
  );
  emit();
}

/** Подготовка игры нашла работы: запомнить их (строка в мастерской) и сказать человеку (`announce(имена работ через запятую)`). */
export function announceRebuiltArenas(works, announce, nameOf) {
  setRebuiltArenas(works);
  announce((Array.isArray(works) ? works : []).map(nameOf).join(", "));
}

/** Ключ записи установки арены (тот же, что у «Моих работ» и очереди «Применить»). */
export const ARENA_INSTALL_KEY = "astral.arenas.install.v1";

/**
 * Сторож запуска (21.11.2026, перед открытым релизом): арена, поставленная до 20.11.2026 (альфа beta.108 и раньше), держит в игре пересобранные модели зала, и клиент
 * Majestic на них вылетает («Invalid asset», `abort()`). Сообщение и строка в мастерской человека не останавливали: игра падала, пока он сам не откроет редактор.
 * Теперь найденную подготовкой игры работу «Арена» сторож снимает сам тем же откатом, что кнопка «Снять арену»; проект остаётся в «Моих работах» — «Применить»
 * соберёт его заново безопасным способом. Не вышло (игра открыта, записи установки нет, откат не прошёл) — прежнее поведение: сообщение и строка с кнопками.
 *
 * `works` — `[{ set, modId, names }]` из подготовки игры; `readRecord(key)` и `rollback(key)` — запись установки и её снятие (по умолчанию — окна).
 * Ответ: `{ removed: true }` или `{ removed: false, reason: "none" | "no-record" | "failed", error? }`.
 */
export async function removeRebuiltArenas(works, { readRecord, rollback, key = ARENA_INSTALL_KEY } = {}) {
  const arenas = (Array.isArray(works) ? works : []).filter((work) => work?.set === "arenas");
  if (!arenas.length) return { removed: false, reason: "none" };
  let record = null;
  try {
    record = readRecord?.(key) ?? null;
  } catch {
    record = null;
  }
  if (!record) return { removed: false, reason: "no-record" };
  try {
    if (!(await rollback(key))) return { removed: false, reason: "no-record" };
  } catch (error) {
    return { removed: false, reason: "failed", error };
  }
  clearRebuiltArenas();
  return { removed: true };
}

/**
 * Что делает окно, когда подготовка игры нашла такие арены: сторож снимает работу и говорит об этом (`notices.rebuiltArenaRemoved`); не вышло — сообщение
 * и строка с кнопками. Откат по записи грузится своим куском окна (`load`), в главный кусок он не попадает.
 */
export function guardRebuiltArenas(works, { nameOf, notices, showNotice, load = () => import("../useInstallRecord.js") }) {
  return load()
    .then((records) => removeRebuiltArenas(works, { readRecord: records.readInstallRecord, rollback: records.rollbackInstallRecordAndRefresh }))
    .catch(() => ({ removed: false }))
    .then((guard) => {
      if (guard.removed) showNotice(notices.rebuiltArenaRemoved(works.map(nameOf).join(", ")));
      else announceRebuiltArenas(works, (names) => showNotice(notices.rebuiltArenaShells(names)), nameOf);
    });
}

/** Погасить строку: арену пересобрали или сняли. */
export function clearRebuiltArenas() {
  if (!works.length) return;
  works = [];
  emit();
}

export const rebuiltArenas = () => works;

/** Есть ли в игре арена, собранная старым способом (хук окна). */
export function useRebuiltArenas() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => works,
    () => works,
  );
}
