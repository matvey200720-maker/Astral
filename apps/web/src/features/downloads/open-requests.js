import { useEffect, useRef } from "react";

/*
 * Просьба открыть «Загрузки» из глубины окна (задача 1 ТЗ 08.10, вечер).
 *
 * Панель «В процессе» больше не открывается сама: установка идёт, человек
 * остаётся там, где был, а ход виден на самой кнопке («Идёт установка…»).
 * Подробности он открывает сам — кнопкой на рейке или нажатием на занятую
 * кнопку. В редакторе мастерской рейка спрятана, и без второго пути до
 * подробностей было бы не добраться. Кнопки живут глубоко в страницах, а
 * панель — у оболочки, поэтому между ними один слушатель, а не проброс
 * через двадцать редакторов.
 */
const listeners = new Set();

/** Открыть «Загрузки». `false` — открыть некому (тесты, окно без оболочки). */
export function requestDownloadsPanel() {
  for (const listener of listeners) listener();
  return listeners.size > 0;
}

/** Оболочка: открывать панель по просьбе. */
export function useDownloadsRequests(open) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const listener = () => latest.current?.();
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
}
