// Внимание к окну: из событий окна и powerMonitor складывается один снимок
// { visible, focused, minimized, locked, suspended, onBattery, thermal, speedLimit }.
// Он уходит странице при каждом изменении и отдаётся по запросу. Сам модуль ничего не останавливает.

// Что заявляет само событие окна; остальное берётся опросом (событие сильнее опроса).
// Порядок записей — порядок подписок на окно.
const WINDOW_EVENTS = new Map([
  ["focus", { focused: true }],
  ["blur", { focused: false }],
  ["show", { visible: true }],
  ["hide", { visible: false }],
  ["minimize", { minimized: true }],
  ["restore", { minimized: false, visible: true }],
]);

// Окно, о котором ничего не известно, считается видимым и в фокусе.
const UNWATCHED = { visible: true, focused: true, minimized: false };

const isDestroyed = (target) => typeof target.isDestroyed === "function" && Boolean(target.isDestroyed());

// isDestroyed у самого окна не оборачивается, а у webContents исключение значит «жив».
function contentsGone(contents) {
  try {
    return isDestroyed(contents);
  } catch {
    return false;
  }
}

// Ответ метода окна как булево; нет метода или он бросает — запасное значение.
function ask(win, method, fallback) {
  try {
    return typeof win[method] === "function" ? Boolean(win[method]()) : fallback;
  } catch {
    return fallback;
  }
}

// Методы окна спрашиваются в порядке isMinimized → isVisible → isFocused; ключи состояния — в порядке снимка.
function poll(win) {
  const minimized = ask(win, "isMinimized", false);
  const visible = ask(win, "isVisible", true);
  const focused = ask(win, "isFocused", false);
  return { visible, focused, minimized };
}

// Снимки равны, когда совпадают все поля свежего снимка.
const sameValues = (fresh, sent) => Object.keys(fresh).every((key) => fresh[key] === sent[key]);

// Одно наблюдаемое окно: запомненное состояние, последний отправленный снимок и свои подписки.
class WatchedWindow {
  #bindings = [];

  constructor(win) {
    this.win = win;
    this.state = poll(win);
    this.sent = null;
  }

  get shown() {
    return this.state.visible && !this.state.minimized;
  }

  get gone() {
    return isDestroyed(this.win);
  }

  apply(event) {
    this.state = { ...poll(this.win), ...WINDOW_EVENTS.get(event) };
  }

  attach(onEvent, onClosed) {
    const { win } = this;
    for (const event of WINDOW_EVENTS.keys()) {
      const handler = () => onEvent(event);
      win.on(event, handler);
      this.#bindings.push([event, handler]);
    }
    if (typeof win.once === "function") win.once("closed", onClosed);
  }

  detach() {
    const { win } = this;
    if (typeof win.removeListener !== "function") return;
    this.#bindings.forEach(([event, handler]) => win.removeListener(event, handler));
  }

  // Страница получает снимок, пока у окна есть живой webContents; сбой его isDestroyed — «не уничтожен».
  deliver(ipc, snapshot) {
    const contents = this.win.webContents;
    if (contents && !contentsGone(contents)) contents.send(ipc.WINDOW_ATTENTION, snapshot);
  }
}

// Правила событий powerMonitor: как событие меняет общее состояние системы.
const POWER_RULES = {
  suspend: (system) => system.set({ suspended: true }),
  resume: (system) => {
    system.set({ suspended: false });
    system.refresh();
  },
  "lock-screen": (system) => system.set({ locked: true }),
  "unlock-screen": (system) => system.set({ locked: false }),
  "on-battery": (system) => system.set({ onBattery: true }),
  "on-ac": (system) => system.set({ onBattery: false }),
  "thermal-state-change": (system, details) =>
    system.set({ thermal: typeof details === "string" ? details : String(details?.state || "") }),
  "speed-limit-change": (system, details) => {
    const limit = typeof details === "number" ? details : details?.limit;
    system.set({ speedLimit: Number.isFinite(limit) ? limit : 100 });
  },
};

// Общее состояние системы. Публичные поля — те, что попадают в снимок, в его порядке.
class SystemState {
  locked = false;
  suspended = false;
  onBattery = false;
  thermal = "";
  speedLimit = 100;
  #monitor = null;

  set(patch) {
    Object.assign(this, patch);
  }

  fields() {
    return { ...this };
  }

  // Питание и температура читаются запросом; нет метода или он бросает — значение остаётся прежним.
  refresh() {
    this.#read("isOnBatteryPower", (value) => this.set({ onBattery: Boolean(value) }));
    this.#read("getCurrentThermalState", (value) => this.set({ thermal: String(value || "") }));
  }

  #read(method, store) {
    try {
      store(this.#monitor[method]());
    } catch {
      // оставляем прежнее значение
    }
  }

  // Подписывается один раз и только на объект с функцией on; подписки никогда не снимаются.
  connect(monitor, onChange) {
    if (this.#monitor || typeof monitor?.on !== "function") return;
    this.#monitor = monitor;
    this.refresh();
    for (const [event, rule] of Object.entries(POWER_RULES)) {
      monitor.on(event, (details) => {
        rule(this, details);
        onChange();
      });
    }
  }
}

class WindowAttention {
  #ipc;
  #monitor;
  #system = new SystemState();
  #watched = new Map();
  #listeners = new Set();

  constructor(ipc, monitor) {
    this.#ipc = ipc;
    this.#monitor = monitor;
  }

  #compose({ visible, focused, minimized }) {
    return { visible, focused, minimized, ...this.#system.fields() };
  }

  #snapshotOf(entry) {
    return this.#compose({ visible: entry.shown, focused: entry.state.focused, minimized: entry.state.minimized });
  }

  watch(win) {
    if (!win || isDestroyed(win) || this.#watched.has(win)) return;
    this.#system.connect(this.#monitor, () => this.#dispatchAll());
    const entry = new WatchedWindow(win);
    entry.sent = this.#snapshotOf(entry);
    this.#watched.set(win, entry);
    entry.attach(
      (event) => this.#onWindowEvent(win, event),
      () => this.#forget(win),
    );
  }

  #forget(win) {
    this.#watched.get(win)?.detach();
    this.#watched.delete(win);
  }

  #onWindowEvent(win, event) {
    this.#watched.get(win)?.apply(event);
    this.#dispatch(win);
  }

  // Изменившийся снимок записывается как отправленный, уходит странице и затем подписчикам.
  #dispatch(win) {
    const entry = this.#watched.get(win);
    if (!entry || entry.gone) return;
    const snapshot = this.#snapshotOf(entry);
    if (sameValues(snapshot, entry.sent)) return;
    entry.sent = snapshot;
    entry.deliver(this.#ipc, snapshot);
    for (const listener of [...this.#listeners]) listener(snapshot, win);
  }

  #dispatchAll() {
    [...this.#watched.keys()].forEach((win) => this.#dispatch(win));
  }

  register({ handleIpc, trusted }) {
    const answer = (event) => trusted(event, () => this.snapshotFor(event.sender));
    handleIpc(this.#ipc.WINDOW_ATTENTION_GET, answer);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshotFor(contents) {
    const entry = [...this.#watched.values()].find(({ win }) => win.webContents === contents);
    return entry ? this.#snapshotOf(entry) : this.#compose(UNWATCHED);
  }

  // Общий снимок: видно, если хоть одно окно видно и не свёрнуто; в фокусе — если хоть одно;
  // свёрнуто — если окна есть и свёрнуты все.
  current() {
    const entries = [...this.#watched.values()];
    const total = entries.reduce(
      (sum, { shown, state }) => ({
        visible: sum.visible || shown,
        focused: sum.focused || state.focused,
        minimized: sum.minimized && state.minimized,
      }),
      { visible: false, focused: false, minimized: entries.length > 0 },
    );
    return this.#compose(total);
  }
}

export function createWindowAttention({ IPC, powerMonitor = null }) {
  const attention = new WindowAttention(IPC, powerMonitor);
  return {
    watch: attention.watch.bind(attention),
    register: attention.register.bind(attention),
    subscribe: attention.subscribe.bind(attention),
    snapshotFor: attention.snapshotFor.bind(attention),
    current: attention.current.bind(attention),
  };
}
