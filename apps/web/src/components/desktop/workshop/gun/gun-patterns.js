import { tr } from "../../../../locales/ui.js";
import * as core from "./gun-patterns-core.js";

export const createPatternCache = (options = {}) => {
  const { onReady } = options;
  const link = new ThreadLink();
  const desk = new Desk(link, onReady);

  const cache = {};
  cache.pattern = (layer, width, height, settings = {}) => {
    const { limit = SIDE_LIMIT } = settings;
    const size = core.patternResolution(width, height, limit);
    const key = core.patternKey(layer, size.width, size.height);
    return desk.serve(layer.id, patternOrder(key, layer, size));
  };
  cache.wear = (materialName, wear, width, height, settings = {}) => {
    const { limit = SIDE_LIMIT } = settings;
    if (!(wear?.amount > 0)) return null;
    const { width: w, height: h } = core.patternResolution(width, height, limit);
    const key = `wear|${wear.amount}|${wear.seed}|${w}|${h}`;
    return desk.serve(`wear:${materialName}`, wearOrder(key, wear, { width: w, height: h }));
  };
  cache.exact = async (type, params, width, height) => {
    const pixels = await link.run(type, params, width, height);
    return paint(pixels, width, height);
  };
  cache.forget = (slotId) => {
    desk.forget(slotId);
  };
  cache.dispose = () => {
    link.close();
    desk.reset();
  };
  return cache;
};

const orderOf = (key, type, params, size) => ({ key, type, params, width: size.width, height: size.height });

/* Шесть полей слоя уходят в расчёт в этом порядке; контраст по умолчанию 100. */
function patternOrder(key, layer, size) {
  const params = Object.fromEntries(PATTERN_FIELDS.map((field) => [field, layer[field]]));
  params.contrast = layer.contrast ?? 100;
  return orderOf(key, "pattern", params, size);
}

function wearOrder(key, { amount, seed }, size) {
  return orderOf(key, "wear", { amount, seed }, size);
}

/* Пиксели в холст. Без документа холста нет; без контекста или ImageData он остаётся пустым. */
function paint(pixels, width, height) {
  if (typeof document === "undefined") return null;
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  const canDraw = Boolean(context) && typeof ImageData !== "undefined";
  if (canDraw) context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

/* Рабочий поток: если не завёлся (или нет Worker), считаем прямо в окне. */
function openThread(link) {
  if (typeof Worker !== "function") return null;
  try {
    const thread = new Worker(new URL("./gun-pattern-worker.js", import.meta.url), { type: "module" });
    thread.onmessage = (event) => link.receive(event);
    thread.onerror = (event) => {
      event.preventDefault?.();
      link.abandon();
    };
    return thread;
  } catch {
    return null;
  }
}

/* Расчёт без потока: пауза в один такт, потом синхронно. */
const computeLater = (job) =>
  new Promise((release) => setTimeout(release, 0))
    .then(() => CALCULATORS[job.type](job.params, job.width, job.height))
    .then(job.resolve, job.reject);

class ThreadLink {
  constructor() {
    this.lastId = 0;
    this.waiting = new Map();
    this.thread = openThread(this);
  }

  run(type, params, width, height) {
    return new Promise((resolve, reject) => {
      this.dispatch({ type, params, width, height, resolve, reject });
    });
  }

  dispatch(job) {
    if (!this.thread) {
      computeLater(job);
      return;
    }
    const id = ++this.lastId;
    this.waiting.set(id, job);
    try {
      this.thread.postMessage({ id, type: job.type, params: job.params, width: job.width, height: job.height });
    } catch {
      this.abandon();
    }
  }

  receive(event) {
    const message = event.data ?? {};
    const job = this.waiting.get(message.id);
    if (!job) return;
    this.waiting.delete(message.id);
    if (message.error) {
      job.reject(new Error(message.error));
      return;
    }
    job.resolve(message.pixels);
  }

  /* Забираем всё, что ждало ответа, и очищаем список. */
  takeWaiting() {
    const jobs = [...this.waiting.values()];
    this.waiting.clear();
    return jobs;
  }

  /* Останавливаем поток навсегда; возвращает то, что ждало его ответа. */
  stopThread() {
    const { thread } = this;
    if (!thread) return null;
    thread.terminate();
    this.thread = null;
    return this.takeWaiting();
  }

  /* Поток упал: незаконченное досчитываем в окне. */
  abandon() {
    this.stopThread()?.forEach(computeLater);
  }

  close() {
    const unfinished = this.stopThread();
    if (!unfinished) return;
    for (const job of unfinished) job.reject(new Error(tr("Узоры закрыты.")));
  }
}

/* Кэш холстов, очереди слотов и память «что слот показывал последним». */
class Desk {
  constructor(link, onReady) {
    this.link = link;
    this.onReady = onReady;
    this.canvases = new Map();
    this.slots = new Map();
    this.shown = new Map();
  }

  /* Самая свежая запись: достаём и кладём в конец. */
  touch(key) {
    const entry = this.canvases.get(key);
    this.canvases.delete(key);
    this.canvases.set(key, entry);
    return entry;
  }

  lastShown(slotId) {
    return this.shown.get(slotId) ?? null;
  }

  serve(slotId, order) {
    if (!this.canvases.has(order.key)) {
      this.enqueue(slotId, order);
      return this.lastShown(slotId);
    }
    const entry = this.touch(order.key);
    if (!entry) return this.lastShown(slotId);
    this.shown.set(slotId, entry);
    return entry;
  }

  enqueue(slotId, order) {
    const slot = this.slots.get(slotId) ?? { busy: false, wanted: null };
    this.slots.set(slotId, slot);
    slot.wanted = order;
    this.pump(slotId, slot);
  }

  pump(slotId, slot) {
    const { wanted } = slot;
    if (slot.busy || !wanted) return;
    slot.wanted = null;
    if (!this.canvases.has(wanted.key)) this.launch(slotId, slot, wanted);
  }

  async launch(slotId, slot, { key, type, params, width, height }) {
    slot.busy = true;
    try {
      const pixels = await this.link.run(type, params, width, height);
      this.store(key, paint(pixels, width, height));
      const { onReady } = this;
      onReady?.();
    } catch {
      this.store(key, null);
    }
    slot.busy = false;
    if (this.slots.get(slotId) === slot) this.pump(slotId, slot);
  }

  store(key, canvas) {
    this.canvases.set(key, canvas);
    while (this.canvases.size > SHELF_SIZE) this.canvases.delete(this.canvases.keys().next().value);
  }

  forget(slotId) {
    this.slots.delete(slotId);
    this.shown.delete(slotId);
  }

  reset() {
    [this.canvases, this.slots, this.shown].forEach((table) => table.clear());
  }
}

const SIDE_LIMIT = 512;
const SHELF_SIZE = 40;
const PATTERN_FIELDS = ["pattern", "colours", "scale", "rotation", "seed"];

/* Обычный объект, а не Map: вид задания ищется как свойство. */
const CALCULATORS = { pattern: core.generatePattern, wear: core.generateWearMask };
