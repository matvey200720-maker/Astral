// Потолок скорости записи копий: свой писатель на одну копию и общий на весь процесс.

const BYTES_PER_MEGABYTE = 1048576;
// Общая лента позволяет записи забежать вперёд не более чем на это время.
const SHARED_HEADROOM_MS = 100;

let ceilingBytes = null;

const monotonicNow = () => performance.now();

function timerSleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

// МБ/с из настроек -> байты в секунду; нет положительного конечного числа — потолка нет.
function toBytesPerSecond(value) {
  const wholeMegabytes = Math.floor(Number(value));
  return Number.isFinite(wholeMegabytes) && wholeMegabytes > 0 ? wholeMegabytes * BYTES_PER_MEGABYTE : null;
}

// Общая лента: положение, раньше которого следующий кусок записать нельзя.
const sharedTape = {
  position: 0,
  restart() {
    this.position = 0;
  },
  // Занимает на ленте время под кусок и возвращает, сколько ждать.
  claim(bytes, cap, current) {
    this.position = Math.max(this.position, current - SHARED_HEADROOM_MS) + (bytes / cap) * 1000;
    return this.position - current - SHARED_HEADROOM_MS;
  },
};

// Свой писатель: средняя скорость считается с начала именно этой копии.
class PacedWriter {
  #limit;
  #now;
  #sleep;
  #origin;
  #written = 0;
  #sleptMs = 0;

  constructor(limit, now, sleep) {
    this.#limit = limit;
    this.#now = now;
    this.#sleep = sleep;
    this.#origin = now();
  }

  get limit() {
    return this.#limit;
  }

  get written() {
    return this.#written;
  }

  async wrote(bytes) {
    this.#written += bytes;
    if (!this.#limit) return;

    const allowedMs = (this.#written / this.#limit) * 1000;
    // Подставные часы не двигаются во сне: проспанное считается как прошедшее.
    const now = this.#now;
    const elapsedMs = Math.max(now() - this.#origin, this.#sleptMs);
    const debtMs = allowedMs - elapsedMs;
    if (debtMs > 0) {
      this.#sleptMs += debtMs;
      const sleep = this.#sleep;
      await sleep(debtMs);
    }
  }
}

// Публичный вид писателя: читаемые свойства-геттеры и метод wrote.
function readOnlyView(readers, wrote) {
  const view = {};
  for (const [name, read] of Object.entries(readers)) {
    Object.defineProperty(view, name, { get: read, enumerable: true });
  }
  view.wrote = wrote;
  return view;
}

// Кто слушает смену потолка: поток большой копии узнаёт о ней посреди копии (`copy-off-thread.js`).
const ceilingListeners = new Set();

export function setCopyWriteLimitMbps(value) {
  ceilingBytes = toBytesPerSecond(value);
  // Любая установка потолка начинает общую ленту заново.
  sharedTape.restart();
  for (const listener of ceilingListeners) listener(ceilingBytes);
}

/** Подписка на смену потолка; возвращает отписку. */
export function onCopyWriteLimitChange(listener) {
  ceilingListeners.add(listener);
  return () => ceilingListeners.delete(listener);
}

export function copyWriteLimitBytes() {
  return ceilingBytes;
}

export function createWritePacer(limit = ceilingBytes, { now = monotonicNow, sleep = timerSleep } = {}) {
  const writer = new PacedWriter(limit, now, sleep);
  return readOnlyView(
    { limit: () => writer.limit, written: () => writer.written },
    (bytes) => writer.wrote(bytes),
  );
}

export function sharedWritePacer({ now = monotonicNow, sleep = timerSleep } = {}) {
  return readOnlyView({ limit: () => ceilingBytes }, async (bytes) => {
    const cap = ceilingBytes;
    if (!cap || !(bytes > 0)) return;

    const waitMs = sharedTape.claim(bytes, cap, now());
    if (waitMs > 0) await sleep(waitMs);
  });
}
