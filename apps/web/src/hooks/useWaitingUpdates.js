/*
 * Новая версия ждущего компонента ставится сама (А10, шаг 3; решения ведущей 11.11.2026): компонент «целиком», у которого после обновления игры Rockstar
 * изменили файл, движок на новую основу не накладывает (`stock-guard.js`) и ждёт, пока в каталоге появится его новый релиз. Как только релиз мода в каталоге
 * отличается от того, с которого ставили (`origin.releaseId`, а если его нет — от `refusedRelease`), либо сказать нельзя (нет ни того, ни другого), окно ставит
 * его тем же путём, что кнопка «Установить» (`install` оболочки: грант на скачивание, план, очередь) — тихо, без вопросов: только ждущие, только когда игра не
 * запущена, одна попытка на релиз.
 *
 * Установка идёт через очередь, поэтому исход видит оболочка, а не этот хук: она помечает строку очереди (`waitingAuto`), говорит «поставили новую версию» только после
 * успеха, а отказ движка «в каталоге пока прежняя версия» (`waiting-same-version`) принимает молча — без уведомления и строки «Не удалось»; движок запомнил отказанный
 * релиз, «Библиотека» скажет об этом, а следующая попытка будет, когда выйдет другой релиз.
 */

import { useEffect, useRef, useState } from "react";
import { workshopGameRunning } from "../api.js";
import { waitingUpdatePlan } from "../features/library/waiting-mods.js";

/** Через сколько проверить ещё раз, если игра была запущена. */
export const RECHECK_MS = 60_000;

export function useWaitingUpdates({ removed, mods, install, ready = false, gameRunning = workshopGameRunning, recheckMs = RECHECK_MS }) {
  const tried = useRef(new Set());
  const [tick, setTick] = useState(0);
  const latest = useRef(null);
  latest.current = { install, gameRunning };

  useEffect(() => {
    if (!ready || typeof latest.current.install !== "function") return undefined;
    const { auto } = waitingUpdatePlan({ removed, mods, tried: tried.current });
    if (!auto.length) return undefined;
    let cancelled = false;
    let timer = 0;
    (async () => {
      if (await latest.current.gameRunning()) {
        /* Игра открыта — писать в её архивы нельзя: проверим позже. */
        if (!cancelled) timer = window.setTimeout(() => setTick((value) => value + 1), recheckMs);
        return;
      }
      for (const row of auto) {
        if (cancelled) return;
        const key = `${row.item.modId}:${row.mod.releaseId}`;
        if (tried.current.has(key)) continue;
        tried.current.add(key);
        await latest.current.install(row.mod, { waitingAuto: true });
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [removed, mods, ready, tick, recheckMs]);
}
