import { useCallback, useLayoutEffect, useRef } from "react";

// Ссылка одна на всё время жизни компонента, а зовётся последний записанный обработчик.
// Так тяжёлые части под memo (плитки, полки пресетов) не пересоздаются из-за стрелок,
// которые меняются каждую отрисовку (перф-правка редактора эффектов, 24.09.2026, 082230af4).
// Образец для useSingleFlight. Звать во время отрисовки нельзя: обработчик пишется после
// фиксации, поэтому в отрисовке и в layout-эффектах детей виден ещё прежний.
const useStableHandler = (handler) => {
  const box = useRef(handler);
  // Зовём как метод держателя: this обычной функции-обработчика — сам держатель.
  const stable = useCallback((...args) => {
    return box.current?.(...args);
  }, []);
  useLayoutEffect(() => {
    box.current = handler;
  });
  return stable;
};

export default useStableHandler;
