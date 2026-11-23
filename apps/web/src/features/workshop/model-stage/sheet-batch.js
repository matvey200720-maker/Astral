// Пачка листов сцены: приходы копятся и раз в кадр уходят обработчику одним обращением
// вместе со списком материалов, которые смотрят на пришедшие листы. После «тихой минуты»
// делается один полный проход, чтобы итог не зависел от очерёдности прихода.

function nextFrame(run) {
  if (typeof requestAnimationFrame !== "function") return setTimeout(run, 16);
  return requestAnimationFrame(run);
}

// Умолчания подставляются вместо undefined; null остаётся как есть.
const HOOK_DEFAULTS = {
  onSettle: null,
  settleMs: 160,
  alive: () => true,
  schedule: nextFrame,
  timer(run, ms) {
    return setTimeout(run, ms);
  },
  clear(handle) {
    clearTimeout(handle);
  },
};

// Порядок виден снаружи: так перечисляются свойства объекта пачки.
const FACE_METHODS = ["use", "arrive", "setWholeLook", "forgetScene", "idle", "release", "settleNow"];

class SheetBatch {
  constructor(hooks) {
    this.hooks = hooks;
    this.looks = new Map(); // лист → материалы, которые на него смотрят
    this.pending = new Set(); // пришедшие, ещё не отданные листы
    this.waiters = [];
    this.frame = 0;
    this.quietHandle = null; // null — таймера нет, любая другая ручка (даже 0) — есть
    this.wholeLook = false;
    this.onFrame = this.onFrame.bind(this);
    this.onQuiet = this.onQuiet.bind(this);
  }

  get busy() {
    return [this.frame, this.pending.size, this.quietHandle !== null].some(Boolean);
  }

  // Пришедшие листы ещё не отданы обработчику (ждут кадра): облик материалов их пока не видит. Тихая минута не в счёт — к ней всё уже стоит на месте.
  get flushing() {
    return this.pending.size > 0 || Boolean(this.frame);
  }

  use(key, index) {
    if (!key) return;
    if (!this.looks.has(key)) this.looks.set(key, new Set());
    this.looks.get(key).add(index);
  }

  arrive(key) {
    this.pending.add(key);
    this.frame ||= this.hooks.schedule(this.onFrame) || 1;
  }

  setWholeLook(value) {
    this.wholeLook = Boolean(value);
  }

  // Индексы материалов уходят вместе со сценой; остаются отрицательные и не числа.
  forgetScene() {
    this.wholeLook = false;
    this.looks = new Map(
      [...this.looks].map(([key, indexes]) => [key, new Set([...indexes].filter((index) => !(index >= 0)))]),
    );
    this.dropQuiet();
    this.checkIdle();
  }

  idle() {
    const ticket = new Promise((resolve) => this.waiters.push(resolve));
    this.checkIdle();
    return ticket;
  }

  release() {
    this.pending.clear();
    this.frame = 0;
    this.dropQuiet();
    this.checkIdle();
  }

  // Материалы пришедших листов по порядку прихода; null, если какой-то лист неизвестен.
  materialsOf(keys) {
    const lists = keys.map((key) => this.looks.get(key));
    return lists.includes(undefined) ? null : new Set(lists.flatMap((list) => [...list]));
  }

  checkIdle() {
    if (this.busy) return;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  dropQuiet() {
    if (this.quietHandle === null) return;
    this.hooks.clear(this.quietHandle);
    this.quietHandle = null;
  }

  restartQuiet() {
    this.dropQuiet();
    this.quietHandle = this.hooks.timer(this.onQuiet, this.hooks.settleMs);
  }

  onFrame() {
    this.frame = 0;
    const keys = Array.from(this.pending);
    this.pending.clear();
    if (keys.length > 0 && this.hooks.alive()) this.deliver(keys);
    this.checkIdle();
  }

  deliver(keys) {
    const only = this.wholeLook ? null : this.materialsOf(keys);
    const concluded = this.hooks.onFlush({ only, keys });
    // полный проход уже обошёл всё; частичный подтверждается итоговым; обработчик, что подвёл итог сам (`true`), тишины не ждёт
    if (only === null || concluded === true) this.dropQuiet();
    else if (this.hooks.onSettle) this.restartQuiet();
  }

  // Итог сейчас, не дожидаясь тишины: ждать нечего (все листы ответили, а последний ответ листа не принёс — он не пришёл, и пачки не было).
  // Только когда итог ещё предстоит (идёт тихая минута) и пришедшие листы уже отданы.
  settleNow() {
    if (this.quietHandle === null || this.pending.size > 0 || this.frame) return false;
    this.dropQuiet();
    if (this.hooks.alive()) this.hooks.onSettle();
    this.checkIdle();
    return true;
  }

  onQuiet() {
    this.quietHandle = null;
    if (this.hooks.alive() && this.pending.size === 0) this.hooks.onSettle();
    this.checkIdle();
  }
}

export function createSheetBatch(options) {
  const hooks = { onFlush: options.onFlush };
  for (const [name, fallback] of Object.entries(HOOK_DEFAULTS)) {
    const given = options[name];
    hooks[name] = given === undefined ? fallback : given;
  }
  const batch = new SheetBatch(hooks);
  const face = Object.fromEntries(FACE_METHODS.map((name) => [name, (first, second) => batch[name](first, second)]));
  return Object.defineProperties(face, {
    waiting: { enumerable: true, get: () => batch.pending.size },
    busy: { enumerable: true, get: () => batch.busy },
    flushing: { enumerable: true, get: () => batch.flushing },
  });
}
