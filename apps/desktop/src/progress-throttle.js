// Прореживание потока шагов установки: обычные шаги склеиваются в окно,
// важные (смена фазы или признака отмены, 99 % и выше, complete) уходят сразу.

export const PROGRESS_INTERVAL_MS = 100;

const URGENT_PERCENT = 99;
const FINAL_PHASE = "complete";

// «Шаг нельзя задерживать». Сравнение идёт с последним отправленным шагом;
// правила проверяются по порядку, первое сработавшее решает.
const URGENCY_RULES = [
  (step, last) => !last,
  (step, last) => step.phase !== last.phase,
  (step, last) => step.cancellable !== last.cancellable,
  (step) => step.phase === FINAL_PHASE,
  (step) => Number(step.percent) >= URGENT_PERCENT,
];

const isUrgent = (step, lastSent) => URGENCY_RULES.some((rule) => rule(step, lastSent));

// Сколько мс осталось до конца окна. NaN (кривой интервал) остаётся NaN.
const msUntilWindowEnds = (intervalMs, nowMs, sentAt) => intervalMs - (nowMs - sentAt);

class ProgressThrottle {
  #io;
  #state = {
    lastStep: null,
    lastAt: -Infinity,
    queuedStep: undefined,
    timer: null,
  };
  #fire = () => this.flush();

  constructor(io) {
    this.#io = io;
  }

  accept(progress) {
    const state = this.#state;
    if (isUrgent(progress, state.lastStep)) {
      this.#disarm();
      this.#forgetQueued();
      this.#deliver(progress);
      return;
    }

    state.queuedStep = progress;
    const { now, intervalMs } = this.#io;
    const wait = msUntilWindowEnds(intervalMs, now(), state.lastAt);
    const windowOver = wait <= 0;
    if (windowOver) {
      this.flush();
    } else {
      this.#armOnce(wait);
    }
  }

  flush() {
    this.#disarm();
    // Отложенным считается только истинное значение шага: ложный (0, "", false) отправлять нечего.
    const { queuedStep } = this.#state;
    if (!queuedStep) {
      return;
    }
    this.#forgetQueued();
    this.#deliver(queuedStep);
  }

  cancel() {
    this.#disarm();
    this.#forgetQueued();
  }

  #deliver(step) {
    const { send, now } = this.#io;
    this.#state.lastStep = step;
    this.#state.lastAt = now();
    send(step);
  }

  #forgetQueued() {
    this.#state.queuedStep = undefined;
  }

  // Остаток считается один раз: пока таймер стоит, следующие шаги его не уточняют.
  // Ручка, которая ложна (0, undefined), таймером не считается.
  #armOnce(wait) {
    const { setTimer } = this.#io;
    if (!this.#state.timer) {
      this.#state.timer = setTimer(this.#fire, wait);
    }
  }

  #disarm() {
    const { clearTimer } = this.#io;
    if (this.#state.timer) {
      clearTimer(this.#state.timer);
    }
    this.#state.timer = null;
  }
}

export function createProgressThrottle(send, options = {}) {
  const {
    intervalMs = PROGRESS_INTERVAL_MS,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options;
  const throttle = new ProgressThrottle({ send, intervalMs, now, setTimer, clearTimer });

  return Object.assign(throttle.accept.bind(throttle), {
    flush: throttle.flush.bind(throttle),
    cancel: throttle.cancel.bind(throttle),
  });
}
