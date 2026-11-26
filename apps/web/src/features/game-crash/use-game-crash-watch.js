import { useEffect, useRef } from "react";
import { desktopHost } from "../../api.js";

/* Слова уведомления (шесть языков) нужны только после падения: хук живёт в оболочке, а у главного куска окна бюджет
   (verify-web-architecture). Грузятся при первом показе. */
const loadCopy = () =>
  import("../../components/desktop/settings/game-crash-copy.js");

/*
 * Падение игры в оболочке (ТЗ владельца 11.11.2026): короткое ненавязчивое уведомление ОДИН раз, когда человек
 * открыл Astral после падения.
 *
 * Уведомление — обычная всплывашка оболочки, не окно поверх игры: пока окно Astral не в фокусе, ничего не
 * показывается и ждёт возвращения фокуса. Показанные падения помечаются в приложении (`markGameCrashesNoticed`):
 * перезапуск окна их не повторяет.
 */
const FIRST_LOOK_MS = 4000;

export function useGameCrashWatch({ language, notify }) {
  const latest = useRef({ language, notify });
  latest.current = { language, notify };

  useEffect(() => {
    const host = desktopHost();
    if (typeof host?.listGameCrashes !== "function") return undefined;
    let alive = true;
    let busy = false;
    const check = async () => {
      if (busy || !alive || document.hasFocus?.() === false) return;
      busy = true;
      try {
        const { crashes = [], unnoticed = [] } = await host.listGameCrashes();
        if (!alive || unnoticed.length === 0) return;
        const { gameCrashCopyFor } = await loadCopy();
        if (!alive) return;
        const newest = crashes
          .filter((crash) => unnoticed.includes(crash.id))
          .sort((a, b) => b.t - a.t)[0];
        const { language: current, notify: say } = latest.current;
        const copy = gameCrashCopyFor(current);
        if (newest)
          say(copy.notice(copy.where[newest.where] || copy.where.unknown));
        await host.markGameCrashesNoticed(unnoticed);
      } catch {
        // уведомление необязательно: журнал ведётся и без него
      } finally {
        busy = false;
      }
    };
    const timer = setTimeout(check, FIRST_LOOK_MS);
    const unsubscribe = host.onGameCrash?.(() => void check());
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      unsubscribe?.();
    };
  }, []);
}
