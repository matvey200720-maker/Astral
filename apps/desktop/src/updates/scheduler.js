// Расписание проверок обновлений: когда звать run, как разбрасывать моменты и как отступать после неудач.

const MINUTE = 60_000;

const BASE = {
  firstDelayMs: 5000,
  intervalMs: 60 * MINUTE,
  jitterMs: 10 * MINUTE,
  focusStaleMs: 10 * MINUTE,
  focusDelayMs: 3000,
  backoffMs: [5 * MINUTE, 15 * MINUTE, 60 * MINUTE],
};

// Настоящий таймер не держит процесс живым.
const quietTimer = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return typeof handle.unref === 'function' ? handle.unref() : handle;
};

// Повторяемая ошибка - состояние службы с phase "error" и error.retryable.
const asksToRetry = (state) => state?.phase === 'error' && Boolean(state.error?.retryable);

class Cadence {
  #cfg;
  #pending;
  #enabled = false;
  #inRun = false;
  #lastAt = 0;
  #misses = 0;

  constructor(cfg) {
    this.#cfg = cfg;
  }

  get misses() {
    return this.#misses;
  }

  get inRun() {
    return this.#inRun;
  }

  begin() {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#plan(this.#cfg.firstDelayMs);
  }

  end() {
    this.#enabled = false;
    const handle = this.#pending;
    this.#pending = undefined;
    if (handle !== undefined) this.#cfg.clearTimer(handle);
  }

  focused() {
    const stale = this.#cfg.now() - this.#lastAt >= this.#cfg.focusStaleMs;
    if (this.#ready() && stale) this.#plan(this.#cfg.focusDelayMs);
  }

  reconnected() {
    if (this.#ready() && this.#misses > 0) this.#plan(this.#cfg.focusDelayMs);
  }

  #ready() {
    return this.#enabled && !this.#inRun;
  }

  #plan(ms) {
    const previous = this.#pending;
    if (previous !== undefined) this.#cfg.clearTimer(previous);
    this.#pending = this.#cfg.setTimer(() => this.#fire(), Math.max(0, ms));
  }

  #nextDelay(failed) {
    const { intervalMs, jitterMs, backoffMs, random } = this.#cfg;
    if (!failed) {
      this.#misses = 0;
      return intervalMs + (random() * 2 - 1) * jitterMs;
    }
    const step = backoffMs.at(Math.min(this.#misses, backoffMs.length - 1));
    this.#misses += 1;
    return step;
  }

  async #fire() {
    this.#pending = undefined;
    if (!this.#ready()) return;
    this.#inRun = true;
    const failed = await new Promise((resolve) => {
      resolve(this.#cfg.run());
    }).then(asksToRetry, () => true);
    this.#inRun = false;
    this.#lastAt = this.#cfg.now();
    const delay = this.#nextDelay(failed);
    if (this.#enabled) this.#plan(delay);
  }
}

export function createScheduler(options) {
  const {
    run,
    now = Date.now,
    setTimer = quietTimer,
    clearTimer = clearTimeout,
    random = Math.random,
    ...rest
  } = options;
  const cadence = new Cadence({ ...BASE, ...stripUndefined(rest), run, now, setTimer, clearTimer, random });
  return {
    start: () => cadence.begin(),
    stop: () => cadence.end(),
    notifyFocus: () => cadence.focused(),
    notifyOnline: () => cadence.reconnected(),
    failures: () => cadence.misses,
    isRunning: () => cadence.inRun,
  };
}

// Явное undefined в параметрах считается «не задано».
function stripUndefined(source) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
}
