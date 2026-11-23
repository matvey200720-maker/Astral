import { useCallback, useLayoutEffect, useRef } from "react";

/*
 * Одна операция на ключ за раз.
 *
 * «Установить» на странице мода срабатывает после полёта карточки в загрузки,
 * а установка облачного мода ещё ждёт грант и план. Второй щелчок за это
 * время запускал вторую такую же установку: проверка «уже в очереди» читала
 * очередь, в которую первая ещё не легла, и мод вставал в неё дважды, а
 * скачивание засчитывалось каталогу два раза.
 *
 * Вызов с ключом, операция по которому ещё идёт, ничего не делает и отдаёт
 * `undefined`. Ключ освобождается, как только операция закончилась — удачно
 * или нет, — так что «Повторить» после отказа работает. Ссылка на обёртку
 * постоянная, зовётся последняя переданная функция (как `useStableHandler`).
 */
export default function useSingleFlight(operation, keyOf, onRepeat) {
  const latest = useRef(operation);
  const keyRef = useRef(keyOf);
  const repeatRef = useRef(onRepeat);
  const running = useRef(new Set());
  useLayoutEffect(() => {
    latest.current = operation;
    keyRef.current = keyOf;
    repeatRef.current = onRepeat;
  });
  return useCallback(async (...args) => {
    const key = keyRef.current(...args);
    if (running.current.has(key)) {
      repeatRef.current?.(...args);
      return undefined;
    }
    running.current.add(key);
    try {
      return await latest.current(...args);
    } finally {
      running.current.delete(key);
    }
  }, []);
}
