import { useEffect, useRef } from "react";

import { publishQueueProgress, readQueueProgress } from "./live-progress.js";

/*
 * Ползунок прогресса для операций очереди, у которых нет своих событий
 * прогресса: удаление и сброс из каталога, и всё в демо-режиме. Установка
 * вне демо двигает ползунок событиями главного процесса и здесь не трогается.
 *
 * Идёт, только пока есть что двигать. Раньше интервал жил всегда: пустая
 * очередь будила окно четыре раза в секунду на каждом экране, в том числе
 * свёрнутое (Т-14). Двигает первую живую строку: строки «Не удалось» ждут
 * «Повторить» и в очереди не участвуют.
 *
 * Вне демо шаг идёт в склад хода (`live-progress.js`), а не в очередь
 * оболочки: четыре шага в секунду были четырьмя перерисовками всего окна на
 * время удаления (задача 1 ТЗ 08.10, вечер). Демо-режим доводит строку до
 * 100 % и по ним же её закрывает (`DesktopShell`), поэтому там — по-старому.
 */
const STEP_MS = 240;

/*
 * Кого двигает окно само, когда событий хода нет: удаление и сброс — и установка одежды из каталога (владелец 18.11.2026: «проценты есть, но
 * они иногда пропадают»). Замененка идёт отдельным вызовом главного процесса без `operationId` строки очереди, и событие хода до неё не доходит:
 * строка стояла на «0 %». Ровный ход доводит её до 92 %, остаток ставит итог.
 */
const movesByItself = (item) => item.operation !== "install" || Boolean(item.clothingChoice || item.tattooSetChoice);

export function useSimulatedProgress({ queue, setQueue, demoMode }) {
  const moving = queue.some(
    (item) => !item.failed && (demoMode || movesByItself(item)),
  );
  const latest = useRef(queue);
  latest.current = queue;
  useEffect(() => {
    if (!moving) return undefined;
    const cap = demoMode ? 100 : 92;
    const step = demoMode ? 4 : 2;
    const timer = setInterval(() => {
      if (!demoMode) {
        const current = latest.current.find((item) => !item.failed);
        if (!current || !movesByItself(current)) return;
        const now =
          readQueueProgress(current.queueId)?.progress ?? current.progress ?? 0;
        if (now >= cap) return;
        publishQueueProgress(current.queueId, {
          progress: Math.min(cap, now + step),
        });
        return;
      }
      setQueue((previous) => {
        const index = previous.findIndex((item) => !item.failed);
        const current = previous[index];
        if (!current || current.progress >= cap) return previous;
        const progress = Math.min(cap, current.progress + step);
        return previous.map((item, at) =>
          at === index ? { ...item, progress } : item,
        );
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [demoMode, moving, setQueue]);
}
