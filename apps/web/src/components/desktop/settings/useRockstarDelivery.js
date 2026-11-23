import { useCallback, useEffect, useRef, useState } from "react";
import { getRockstarDelivery, onRockstarDelivery } from "../../../api.js";
import { failureReason, humanFailure } from "../../../utils/installFailure.js";
import { rockstarDeliveryCopyFor } from "./rockstar-delivery-copy.js";
import { modeFailureText } from "./rockstar-mode-copy.js";
import { rootKey } from "./rockstar-facts.js";

/*
 * Состояние режима Rockstar для вкладки «Rockstar Games»: ответ
 * `getRockstarDelivery`, события главного процесса, занятость и отказ.
 *
 * Агент — отдельный процесс и окну событий не шлёт: пока режим включён (или
 * игра запущена и переключать нельзя — когда она закроется, событий не будет),
 * состояние спрашивается раз в три секунды. События подмены приходят от всех
 * игр сразу — у этой копии слышны только её собственные (npln 18.10: на
 * второй папке висел сбой подмены основы).
 *
 * Ответы приходят вразнобой: событие просит свежее состояние раньше, чем
 * вернулось действие, опрос уходит до клика и возвращается после него.
 * Применяется только ответ последнего запроса (`ticket`), а ответ на действие
 * отменяет все запросы, что были в полёте. Сбой опроса прежнее состояние не
 * стирает: «нет приложения» — это когда моста нет, а не когда один запрос не
 * дошёл.
 */

const REFRESH_MS = 3000;

/** Какие события дозора человеку нужно прочитать; остальные — это уже видно в строке состояния. */
const NOTED_EVENTS = new Set([
  "missed",
  "stale",
  "lost",
  "busy",
  "repaired",
  "repair-in-progress",
  "recovered",
  "rebuilt",
]);

/** События, после которых прежний сбой уже не про сегодняшнее состояние: подмена снова идёт как надо. */
const SETTLED_EVENTS = new Set([
  "live",
  "parked",
  "enabled",
  "direct",
  "recovered",
  "rebuilt",
]);

export default function useRockstarDelivery(target, language) {
  const targetId = target?.id || "";
  const targetPath = target?.path || "";
  const [status, setStatus] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const alive = useRef(true);
  const ticket = useRef(0);
  const pending = useRef(0);
  const live = useRef({ language, targetPath });
  live.current = { language, targetPath };

  const refresh = useCallback(async () => {
    if (!targetId) return null;
    ticket.current += 1;
    const mine = ticket.current;
    pending.current += 1;
    let next = null;
    let failed = false;
    try {
      next = await getRockstarDelivery({ targetId });
    } catch {
      failed = true;
    } finally {
      pending.current = Math.max(0, pending.current - 1);
    }
    if (alive.current && mine === ticket.current) {
      if (!failed) setStatus(next || null);
      setLoaded(true);
    }
    return failed ? null : next || null;
  }, [targetId]);

  useEffect(() => {
    alive.current = true;
    ticket.current += 1;
    pending.current = 0;
    setStatus(null);
    setLoaded(false);
    setError("");
    setNote("");
    refresh();
    const stopEvents = onRockstarDelivery((event) => {
      if (!alive.current) return;
      const { language: current, targetPath: path } = live.current;
      if (event?.gameRoot && rootKey(event.gameRoot) !== rootKey(path)) return;
      const text = rockstarDeliveryCopyFor(current);
      if (event?.kind === "error") {
        /* Сбой — предупреждением: что случилось и что нажать, а не зелёной строкой. */
        setNote("");
        setError(
          [
            text.events.error,
            event.message ? failureReason(event.message, current) : "",
          ]
            .filter(Boolean)
            .join(": ") + ` ${text.errorAdvice}`,
        );
      } else {
        if (SETTLED_EVENTS.has(event?.kind)) setError("");
        setNote(
          NOTED_EVENTS.has(event?.kind) ? text.events[event.kind] || "" : "",
        );
      }
      refresh();
    });
    return () => {
      alive.current = false;
      stopEvents();
    };
  }, [targetId, refresh]);

  const watching = status?.mode === "swap" || status?.gameRunning === true;
  useEffect(() => {
    if (!watching) return undefined;
    const timer = setInterval(() => {
      if (pending.current === 0) refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [watching, refresh]);

  /** Действие с занятостью и отказом по-человечески (код `ROCKSTAR_MODE_…` — фразой на языке). */
  const run = useCallback(async (key, task) => {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await task();
    } catch (failure) {
      setError(
        modeFailureText(failure, live.current.language) ||
          humanFailure(failure, live.current.language),
      );
    } finally {
      if (alive.current) setBusy("");
    }
  }, []);

  /** Ответ главного процесса на действие — новое состояние (пустой ответ — спросить заново). */
  const accept = useCallback(
    (next) => {
      if (next && typeof next === "object") {
        ticket.current += 1;
        setStatus(next);
        setLoaded(true);
      } else refresh();
    },
    [refresh],
  );

  return {
    status,
    loaded,
    busy,
    error,
    note,
    setError,
    setNote,
    refresh,
    run,
    accept,
  };
}
