// Размер окна сцены: один ResizeObserver на корень, свежие числа попадают в состояние,
// только если ширина или высота сменились.
import { useReducer, useEffect } from "react";

const sizeOf = ({ contentRect: { width, height } }) => ({ width, height });
const blankSize = () => ({ width: 0, height: 0 });

// Подписка на узел; attach возвращает отписку (или undefined, если наблюдать нечем)
class SizeWatch {
  observer = null;

  constructor(report) {
    this.report = report;
  }

  attach(node) {
    const Observer = globalThis.ResizeObserver;
    if (!node || typeof Observer !== "function") return undefined;
    this.observer = new Observer((entries) => {
      entries.map(sizeOf).forEach((size) => this.report(size));
    });
    this.observer.observe(node);
    return this.detach;
  }

  detach = () => this.observer.disconnect();
}

// Те же числа - то же состояние (перерисовки нет)
function settleSize(prev, next) {
  if (prev.width !== next.width) return next;
  return prev.height === next.height ? prev : next;
}

export function useStageWindow(rootRef) {
  const [size, report] = useReducer(settleSize, undefined, blankSize);
  useEffect(() => new SizeWatch(report).attach(rootRef.current), [rootRef]);
  return size;
}
