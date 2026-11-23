import { useEffect, useRef } from "react";

/*
 * Просьба открыть мод в «Библиотеке» из «Настроек › Логи» (журнал падений игры, ТЗ 11.11.2026).
 *
 * Раздел падений живёт в окне настроек, а страницы и переход — у оболочки; как и у «Загрузок»
 * (`features/downloads/open-requests.js`), между ними один слушатель, а не проброс через настройки.
 */
const listeners = new Set();

/** Открыть мод `{ modId, catalogModId }` в Библиотеке. `false` — открыть некому (тесты, окно без оболочки). */
export function requestLibraryMod(target) {
  for (const listener of listeners) listener(target);
  return listeners.size > 0;
}

/** Оболочка: открывать Библиотеку по просьбе. */
export function useLibraryRequests(open) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const listener = (target) => latest.current?.(target);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
}
