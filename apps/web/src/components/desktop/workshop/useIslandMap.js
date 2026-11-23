import { useEffect, useRef, useState } from "react";

/*
 * Остров Кайо-Перико из игры игрока для «Большой карты» (задача 34, 19.10.2026).
 *
 * Читается при открытии карты (задача 42Б: остров — часть основной карты, отдельного инструмента нет) один раз
 * за жизнь редактора. `status`: idle — не просили, loading, ready, missing
 * (нет приложения или игры), failed (игра есть, а фильма острова в ней нет).
 *
 * Чтение не привязано к одному запуску эффекта: в строгом режиме React эффект запускается, снимается
 * и запускается снова, а второй запуск видит, что остров уже просили, — ответ первого обязан
 * дойти до состояния, иначе редактор, открытый сразу на «Кайо-Перико», вечно «читает остров».
 * Отбрасывается ответ только тогда, когда редактора уже нет.
 */
const IDLE = Object.freeze({ status: "idle", gfx: null, palette: [] });

export function useIslandMap(enabled, load) {
  const [island, setIsland] = useState(IDLE);
  const asked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    setIsland({ status: "loading", gfx: null, palette: [] });
    Promise.resolve(load ? load("") : null)
      .then((result) => {
        if (!mounted.current) return;
        setIsland(
          result?.gfx
            ? { status: "ready", gfx: result.gfx, palette: Array.isArray(result.palette) ? result.palette : [] }
            : { status: "missing", gfx: null, palette: [] },
        );
      })
      .catch(() => {
        if (mounted.current) setIsland({ status: "failed", gfx: null, palette: [] });
      });
  }, [enabled, load]);
  return island;
}
