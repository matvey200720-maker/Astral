// Клиентская сторона спячки окна: перед сном собираем то, что переживёт
// перезагрузку (память разделов и части), после пробуждения раскладываем
// это обратно и сообщаем лаунчеру, что проснулись.

import { seedStageViews, stageViewsSnapshot } from "./stage-views.js";
import * as sectionMemory from "../../section-memory.js";

export const ENTRY_BYTES = 2 * 1024 * 1024;
export const INPUT_HOLD_MS = 30000;

// Сколько всего памяти разделов берём в один снимок.
const MEMORY_BYTES = 6 * ENTRY_BYTES;
// Самое глубокое допустимое место (счёт идёт от верхнего значения).
const DEEPEST = 32;
const INPUT_EVENTS = ["pointermove", "pointerdown", "wheel", "keydown"];
const LISTEN_OPTIONS = { capture: true, passive: true };
const FIXED_WEIGHT = { number: 8, boolean: 8, undefined: 4 };

// Холостая функция одна на все случаи: ею же отвечает запуск, который ничего не подписал.
const swallow = () => {};

// Выполнить задачу, сбой превратив в undefined.
const attempt = (task) => {
  try {
    return task();
  } catch {
    return undefined;
  }
};

// Дети контейнера, которых читаем сразу при входе в него; null — это не
// массив, не Map и не Set.
function eagerItems(node) {
  if (Array.isArray(node)) {
    return Array.from({ length: node.length }, (_, at) => at)
      .filter((at) => at in node)
      .map((at) => node[at]);
  }
  if (node instanceof Map) return Array.from(node).flat();
  return node instanceof Set ? Array.from(node) : null;
}

// Вес значения в байтах; -1 — слишком тяжёлое или не поддающееся подсчёту.
// Обход в глубину по порядку: на первом отказе он встаёт, и геттеры после
// этого места уже не читаются.
function weigh(root, limit) {
  let spent = 0;
  const onPath = new Set();
  const pay = (cost) =>
    cost < 0 || spent > limit ? false : ((spent += cost), true);

  const visit = (node, depth) => {
    if (depth > DEEPEST) return false;
    const kind = typeof node;
    if (kind in FIXED_WEIGHT) return pay(FIXED_WEIGHT[kind]);
    if (node === null) return pay(4);
    if (kind === "string") return pay(node.length * 2 + 2);
    if (kind !== "object" || onPath.has(node)) return false;
    if (node instanceof Date) return pay(8);
    if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) {
      return pay(node.byteLength);
    }

    const items = eagerItems(node);
    const proto = Object.getPrototypeOf(node);
    if (items === null && proto !== Object.prototype && proto !== null) {
      return false;
    }
    onPath.add(node);
    // Значение свойства читаем только после того, как приняли вес ключа.
    const whole =
      items?.every((item) => visit(item, depth + 1)) ??
      Object.keys(node).every(
        (key) => pay(2 * key.length) && visit(node[key], depth + 1),
      );
    onPath.delete(node);
    return whole;
  };

  return visit(root, 0) && spent <= limit ? spent : -1;
}

// ---- Состояние клиента -------------------------------------------------

const toggleInputListeners = (method, handler) => {
  for (const type of INPUT_EVENTS)
    window[method](type, handler, LISTEN_OPTIONS);
};

async function takeSnapshot(bridge) {
  try {
    const got = await bridge.take();
    if (got?.version === 1) {
      sectionMemory.seedSectionMemory(
        Array.isArray(got.memory) ? got.memory : [],
      );
      seedStageViews(got.parts?.cameras);
      return got;
    }
  } catch {
    // Сбой чтения или раскладки: пробуждение идёт без снимка.
  }
  return null;
}

class HibernationState {
  #parts = new Map();
  #woke = null;
  #running = false;
  #lastInput = -Infinity;
  #noteInput = () => {
    this.#lastInput = performance.now();
  };

  register(name, provider) {
    this.#parts.set(name, provider);
    return () => {
      // позднюю чужую запись под тем же именем не трогаем
      if (this.#parts.get(name) === provider) this.#parts.delete(name);
    };
  }

  collect() {
    const memory = [];
    const dropped = [];
    let used = 0;
    // Память разделов не защищаем от сбоев: пусть падает громко.
    for (const entry of sectionMemory.sectionMemoryEntries()) {
      const weight = weigh(entry[1], ENTRY_BYTES);
      if (weight >= 0 && used + weight <= MEMORY_BYTES) {
        memory.push(entry);
        used += weight;
      } else dropped.push(entry[0]);
    }

    // Части, наоборот, не должны ломать друг друга.
    const parts = {};
    for (const [name, provider] of this.#parts) {
      attempt(() => {
        const data = provider.snapshot?.();
        if (data !== undefined && weigh(data, ENTRY_BYTES) >= 0) {
          parts[name] = data;
        }
      });
    }
    return { version: 1, memory, parts, dropped };
  }

  busy(now = performance.now()) {
    if (this.#lastInput + INPUT_HOLD_MS > now) return "ввод в окне";
    for (const [name, provider] of this.#parts) {
      const reason = attempt(() => provider.busy?.());
      if (reason) return `${name}: ${reason}`;
    }
    return null;
  }

  start(bridge) {
    // Признак ставим сразу: если ниже что-то упадёт, повторный запуск не
    // навесит всё ещё раз поверх.
    if (!bridge?.onPrepare || this.#running) return swallow;
    this.#running = true;
    this.register("cameras", { snapshot: stageViewsSnapshot });
    toggleInputListeners("addEventListener", this.#noteInput);

    const offBridge = bridge.onPrepare(async ({ token } = {}) => {
      const busy = this.busy();
      if (busy) {
        await bridge.ready({ token, busy }).catch(swallow);
        return;
      }
      const snapshot = attempt(() => this.collect()) ?? null;
      // Если снимок не доехал, хотя бы отметимся без него.
      await bridge
        .ready({ token, snapshot })
        .catch(() => bridge.ready({ token }).catch(swallow));
    });
    return () => {
      this.#running = false;
      toggleInputListeners("removeEventListener", this.#noteInput);
      offBridge?.();
    };
  }

  async prime(options) {
    const { bridge, location, history } = options;
    const query = attempt(() => new URLSearchParams(location.search));
    if (query?.get("hibernation") !== "1" || !bridge?.take) return null;

    // Флаг убираем из адреса ещё до того, как забрали снимок.
    query.delete("hibernation");
    const search = query.toString();
    const address = () =>
      location.pathname + (search ? "?" + search : "") + location.hash;
    attempt(() => history.replaceState(history.state, "", address()));

    const snap = await takeSnapshot(bridge);
    // Проснулись и при неудачном take: окно должно знать про пробуждение.
    this.#woke = snap ?? { version: 1, memory: [], parts: {}, empty: true };
    return snap;
  }

  isWoke() {
    return this.#woke !== null;
  }

  restored(name) {
    return this.#woke?.parts?.[name];
  }

  finish(bridge) {
    const woken = this.#woke;
    this.#woke = null;
    if (woken) bridge?.woke?.().catch(swallow);
  }

  reset() {
    this.#parts.clear();
    this.#woke = null;
    this.#running = false;
    this.#lastInput = -Infinity;
  }
}

const state = new HibernationState();

// ---- Наружный интерфейс ------------------------------------------------

export const plainSize = (value, limit = ENTRY_BYTES) => weigh(value, limit);
export const registerHibernationState = (name, provider) =>
  state.register(name, provider);
export const collectHibernationSnapshot = () => state.collect();
export const hibernationBusy = (now = performance.now()) => state.busy(now);
export const startHibernationClient = (bridge = window.modovik?.hibernation) =>
  state.start(bridge);

export async function primeHibernation({
  bridge = window.modovik?.hibernation,
  location = window.location,
  history = window.history,
} = {}) {
  return state.prime({ bridge, location, history });
}

export const wokeFromHibernation = () => state.isWoke();
export const restoredPart = (name) => state.restored(name);
export const finishHibernationRestore = (
  bridge = window.modovik?.hibernation,
) => state.finish(bridge);
export const resetHibernationClient = () => state.reset();
