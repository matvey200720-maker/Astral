/*
 * Проверка фильма мини-карты при запуске (`apps/desktop/src/minimap-film-repair.js`).
 *
 * Живёт в стартовом куске, поэтому здесь только вопрос к главному процессу: он отвечает из отметки, пока архив игры не менялся.
 * Всё, что чинит (проекты мастерской, очередь, сборка мини-карты), подгружается, только если есть что чинить, — у всех, кто опцию
 * «HP по всему экрану» не включал, это один дешёвый вопрос.
 */

import { useEffect, useRef } from "react";
import { checkMinimapFilm } from "../../../api.js";
import { detectLegacyGame } from "./game-root.js";

/* После старта: чтение записи из архива не должно спорить с первыми экранами. */
const CHECK_DELAY_MS = 20_000;

export async function runMinimapFilmCheck({ notify } = {}) {
  const gameRoot = await detectLegacyGame();
  if (!gameRoot) return null;
  const answer = await checkMinimapFilm({ gameRoot });
  if (answer?.state === "damaged") {
    const { enqueueMinimapFilmRepair } = await import("./tasks/minimap-film-repair.js");
    enqueueMinimapFilmRepair({ gameRoot, notify });
    return answer;
  }
  /* Формат экрана игры сменился после установки — карта уехала: своё решение и своя работа, тоже без вопросов. */
  const { checkMinimapScreen } = await import("./tasks/minimap-screen-apply.js");
  await checkMinimapScreen({ gameRoot, notify });
  return answer;
}

/** Один раз за запуск окна; сбой проверки молчит: она ничего не меняла и повторится при следующем запуске. */
export function useMinimapFilmRepair({ active, notify }) {
  const asked = useRef(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => {
    if (!active || asked.current) return undefined;
    asked.current = true;
    const timer = globalThis.setTimeout(() => {
      runMinimapFilmCheck({ notify: (text, tone) => notifyRef.current?.(text, tone) }).catch(() => {});
    }, CHECK_DELAY_MS);
    return () => globalThis.clearTimeout(timer);
  }, [active]);
}
