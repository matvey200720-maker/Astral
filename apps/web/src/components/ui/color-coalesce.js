import { useEffect, useState } from "react";

// Одна правка за кадр: первая уходит сразу, накопленные — последней в начале следующего кадра.

const framesExist = () => typeof requestAnimationFrame === "function";
const askFrame = (run) => globalThis.requestAnimationFrame?.(run) ?? 0;
const dropFrame = (id) => {
  globalThis.cancelAnimationFrame?.(id);
};

/**
 * Движок живёт отдельно от отрисовки: хук хранит его в состоянии и только
 * показывает `draft`. «Окно кадра» открыто, пока `frame` не ноль.
 */
function createEngine(setDraft, handler) {
  let waiting = null;

  const deliver = (value) => {
    engine.handler?.(value);
  };
  const shut = () => {
    if (engine.frame !== 0) dropFrame(engine.frame);
    engine.frame = 0;
  };
  const onFrame = () => {
    engine.frame = 0;
    if (waiting === null) return;
    const last = waiting;
    waiting = null;
    setDraft(null);
    deliver(last);
    engine.frame = askFrame(onFrame);
  };

  const engine = {
    commit(value) {
      shut();
      waiting = null;
      setDraft(null);
      deliver(value);
    },
    dispose() {
      shut();
      if (waiting === null) return;
      const last = waiting;
      waiting = null;
      deliver(last);
    },
    flush() {
      if (waiting === null) return;
      shut();
      onFrame();
      shut();
    },
    frame: 0,
    handler,
    input(value) {
      if (!framesExist()) {
        deliver(value);
        return;
      }
      if (engine.frame !== 0) {
        waiting = value;
        setDraft(value);
        return;
      }
      deliver(value);
      engine.frame = askFrame(onFrame);
    },
  };

  return engine;
}

export function useFrameCoalescedChange(onChange) {
  const [draft, setDraft] = useState(null);
  const [engine] = useState(() => createEngine(setDraft, onChange));

  // Обработчик читается в момент отдачи правки, а не в момент input.
  useEffect(() => {
    engine.handler = onChange;
  });
  useEffect(() => () => engine.dispose(), [engine]);

  return {
    draft,
    input: (value) => engine.input(value),
    commit: (value) => engine.commit(value),
    flush: () => engine.flush(),
  };
}
