/*
 * Расписание обновлений 3D-вида студии (ТЗ 44В, 21.10.2026).
 *
 * Обновление окна — не одна копия холста: у кадров, что собирают листы из картинки, это десятки миллисекунд основного
 * потока. Расписание держит три правила, вынесенные из компонента, чтобы их можно было проверить без WebGL:
 *  • не чаще раза в `gap()` мс;
 *  • запуск — в простое потока (`requestIdleCallback`, потолок — три интервала), а не поперёк движений кисти;
 *  • пока обновление ждёт, второе не заводится: исполнитель читает холст в момент запуска, то есть самое свежее;
 *    `schedule(true)` — конец мазка, отмена, слои — снимает ожидание и запускает сразу.
 */

const browserTimers = () => ({
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
  requestIdle: typeof window.requestIdleCallback === "function" ? (fn, options) => window.requestIdleCallback(fn, options) : null,
  cancelIdle: (id) => window.cancelIdleCallback?.(id),
});

/**
 * @param {{ run: () => void, gap: () => number, now?: () => number, timers?: object }} options
 */
export function createFloatPacer({ run, gap, now = () => performance.now(), timers = browserTimers() }) {
  let timer = 0;
  let idle = 0;
  let last = -Infinity;

  function cancel() {
    if (timer) timers.clearTimer(timer);
    if (idle) timers.cancelIdle?.(idle);
    timer = 0;
    idle = 0;
  }

  function fire() {
    timer = 0;
    idle = 0;
    run();
    last = now();
  }

  return {
    /** Поставить обновление; `urgent` — сразу, снимая ожидающее. */
    schedule(urgent = false) {
      if (timer || idle) {
        if (!urgent) return;
        cancel();
      }
      const wait = urgent ? 0 : Math.max(0, gap() - (now() - last));
      timer = timers.setTimer(() => {
        timer = 0;
        if (urgent || !timers.requestIdle) fire();
        else idle = timers.requestIdle(fire, { timeout: gap() * 3 });
      }, wait);
    },
    /** Снять ожидающее обновление (окно закрылось, текстура сменилась). */
    cancel,
    get pending() {
      return Boolean(timer || idle);
    },
  };
}
