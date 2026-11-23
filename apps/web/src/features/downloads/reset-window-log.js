/*
 * Сброс 12.10: что окно делает после «Вернуть GTA V без модов» — подготовка
 * игры и профиль, — строкой в журнал приложения, рядом со строкой главного
 * процесса о фазах самого сброса (`apps/desktop/src/reset-timing.js`).
 * Строка служебная, как и прочие строки журнала. Журнала нет (браузер,
 * проверки) — молчим: замер не должен ронять очередь.
 */
const bridge = () =>
  typeof window === "undefined" ? null : (window.modovik ?? null);

export function logResetWindowStep(ms) {
  try {
    const write = bridge()?.writeAppLog;
    if (typeof write !== "function") return;
    const seconds = (Math.max(0, Number(ms) || 0) / 1000)
      .toFixed(1)
      .replace(".", ",");
    void Promise.resolve(
      write({
        level: "info",
        source: "install",
        message: `reset-target: окно — подготовка игры и профиль ${seconds} с`,
      }),
    ).catch(() => {});
  } catch {
    /* Журнал не должен ронять очередь. */
  }
}

/** Часы шагов окна: `const done = resetWindowClock(); …; done();`. */
export function resetWindowClock(clock = Date.now) {
  const started = clock();
  return () => logResetWindowStep(clock() - started);
}
