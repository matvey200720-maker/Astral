// Работа «когда окно свободно»: `requestIdleCallback` с потолком, а там, где его нет (тесты, старые окна), — короткий таймер. Возвращает отмену.
export function whenIdle(task, { timeout = 1500, fallback = 300 } = {}) {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(task, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, fallback);
  return () => window.clearTimeout(id);
}
