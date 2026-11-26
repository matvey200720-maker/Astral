import { useEffect, useRef } from "react";

/*
 * Оболочка держит один цикл возобновления отложенных установок (`deferred-resume.js`). Здесь только крючок: сам цикл и список
 * едут отдельным куском (бюджет `main-*.js`). `shell` — свежее состояние оболочки на каждую отрисовку.
 */
export function useDeferredResume(shell) {
  const latest = useRef(shell);
  latest.current = shell;
  useEffect(() => {
    let stop = null;
    let gone = false;
    import("./deferred-resume.js").then(
      (part) => {
        if (!gone) stop = part.startDeferredResume(latest);
      },
      () => {},
    );
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
}
