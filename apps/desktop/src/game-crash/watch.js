/*
 * Когда ловить падение (ТЗ владельца 11.11.2026):
 *
 *   а) лаунчер открыт, процесс игры завершился → через ~20 с и ещё раз через ~60 с (отчёт Windows пишется с задержкой)
 *      проверяем новые события и журналы с момента запуска игры;
 *   б) лаунчер был закрыт → при старте (через ~25 с, чтобы не мешать запуску) ищем падения с прошлой проверки, не старше
 *      семи дней; метка проверки хранится в своих данных (`store.checkedAt`).
 *
 * Опрос процессов: пока игры нет — раз в 45 с (один `tasklist`), пока она идёт — раз в 5 с. Чаще не опрашиваем. Окно,
 * вернувшее внимание, и сообщение «игра запущена» от спячки (`onGameRunning`) подталкивают опрос сразу.
 */

export const IDLE_MS = 45 * 1000;
export const ACTIVE_MS = 5 * 1000;
export const SETTLE_MS = Object.freeze([20 * 1000, 60 * 1000]);
export const STARTUP_DELAY_MS = 25 * 1000;
export const MAX_LOOKBACK_MS = 7 * 24 * 3600 * 1000;
export const NUDGE_GAP_MS = 3000;
const MIN_LOOKBACK_MS = 5 * 60 * 1000;
const SESSION_SLACK_MS = 3 * 60 * 1000;

export function startGameCrashWatch({
  running,
  scan,
  checkedAt = () => 0,
  markChecked = () => {},
  now = Date.now,
  timers = globalThis,
  idleMs = IDLE_MS,
  activeMs = ACTIVE_MS,
  settleMs = SETTLE_MS,
  startupDelayMs = STARTUP_DELAY_MS,
  onProblem = () => {},
} = {}) {
  let stopped = false;
  let busy = false;
  let timer = null;
  let session = null;
  let lastNudge = -Infinity;
  const pending = new Set();

  const later = (ms, action) => {
    const handle = timers.setTimeout(() => {
      pending.delete(handle);
      if (!stopped) action();
    }, ms);
    handle?.unref?.();
    pending.add(handle);
    return handle;
  };

  const runScan = async (sinceMs, via, companions = []) => {
    if (busy || stopped) return;
    busy = true;
    const startedAt = now();
    try {
      const result = await scan({ sinceMs, via, companions });
      /* Метка «проверено» двигается, только если проверка была: журнал Windows отказал или проверка уже шла — падения этого периода ещё не искались. */
      if (!result?.windowsFailed && !result?.busy) markChecked(startedAt);
    } catch (error) {
      onProblem(error);
    } finally {
      busy = false;
    }
  };

  /* При старте: от прошлой проверки (не раньше семи дней назад и не меньше пяти минут). */
  const startupScan = () => {
    const last = Number(checkedAt()) || 0;
    const sinceMs = last > 0 ? Math.min(MAX_LOOKBACK_MS, Math.max(MIN_LOOKBACK_MS, now() - last + SESSION_SLACK_MS)) : MAX_LOOKBACK_MS;
    return runScan(sinceMs, "startup");
  };

  /* Игра завершилась: смотрим события с момента её запуска, дважды. */
  const afterExit = (closed) => {
    const sinceMs = Math.min(MAX_LOOKBACK_MS, Math.max(MIN_LOOKBACK_MS, now() - closed.startedAt + SESSION_SLACK_MS));
    const companions = [...closed.companions];
    settleMs.forEach((delay, at) => later(delay, () => runScan(sinceMs, at === 0 ? "exit" : "exit-late", companions)));
  };

  const schedule = (ms) => {
    if (stopped) return;
    timers.clearTimeout(timer);
    pending.delete(timer);
    timer = later(ms, tick);
  };

  async function tick() {
    let seen = { game: [], companions: [] };
    try {
      seen = await running();
    } catch (error) {
      onProblem(error);
    }
    const playing = seen.game.length > 0;
    if (playing) {
      session = session || { startedAt: now(), companions: new Set() };
      for (const name of seen.companions) session.companions.add(name);
    } else if (session) {
      const closed = session;
      session = null;
      afterExit(closed);
    }
    schedule(playing ? activeMs : idleMs);
  }

  later(startupDelayMs, () => void startupScan());
  later(Math.min(idleMs, startupDelayMs), () => void tick());

  return {
    /** Подтолкнуть опрос (окно вернулось, спячка нашла игру). */
    nudge() {
      if (stopped) return;
      /* Окно мигает фокусом чаще, чем нужен опрос процессов: не чаще раза в три секунды. */
      if (now() - lastNudge < NUDGE_GAP_MS) return;
      lastNudge = now();
      timers.clearTimeout(timer);
      pending.delete(timer);
      void tick();
    },
    /** Проверка по просьбе человека («Проверить сейчас»). */
    async scanNow(sinceMs = MAX_LOOKBACK_MS) {
      await runScan(sinceMs, "manual", session ? [...session.companions] : []);
    },
    isBusy: () => busy,
    stop() {
      stopped = true;
      for (const handle of pending) timers.clearTimeout(handle);
      pending.clear();
    },
  };
}
