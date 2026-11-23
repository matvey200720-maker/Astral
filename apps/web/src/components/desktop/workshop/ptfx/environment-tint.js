import { parseColour, applyFamilyTint } from "@modovik/ptfx-studio";

// Перекраска листа семейства вне главного потока. Нет потока или он упал — тот же счёт
// делается здесь, пиксели те же.

const openWorker = () =>
  new Worker(new URL("./environment-tint-worker.js", import.meta.url), { type: "module" });

const colourOf = (settings) =>
  settings.remove === true ? [0, 0, 0] : parseColour(settings.tint);

// Счёт на месте: тот же цикл, что у потока.
const recolour = (source, settings, format) =>
  applyFamilyTint(source.rgba, settings, { format });

// То же для ждущего задания: результат или ошибка уходят в его обещание.
function recolourHere({ resolve, reject, source, settings, format }) {
  try {
    resolve(recolour(source, settings, format));
  } catch (error) {
    reject(error);
  }
}

// Ответ потока по исходу: исходника нет — считаем здесь и забываем, что лист там лежит.
const REPLY_OUTCOMES = {
  again: (lane, job) => {
    lane.known.delete(job.key);
    recolourHere(job);
  },
  failed: (lane, job, reply) => job.reject(new Error(reply.error)),
  done: (lane, job, reply) => job.resolve(reply.rgba),
};

function onReply(lane, event) {
  const reply = event?.data ?? {};
  const job = lane.waiting.get(reply.id);
  if (job === undefined) return;
  lane.waiting.delete(reply.id);
  const outcome = reply.error === "source" ? "again" : reply.error ? "failed" : "done";
  REPLY_OUTCOMES[outcome](lane, job, reply);
}

function stopWorker(lane) {
  lane.worker?.terminate?.();
  lane.worker = null;
}

// Забыть всё, что связано с потоком; вернуть ждавшие задания.
function forgetAll(lane) {
  const stranded = Array.from(lane.waiting.values());
  lane.waiting.clear();
  lane.known.clear();
  return stranded;
}

function onCrash(lane) {
  lane.gone = true;
  stopWorker(lane);
  forgetAll(lane).forEach(recolourHere);
}

function spawn(lane) {
  const made = openWorker();
  made.onmessage = (event) => onReply(lane, event);
  made.onerror = () => onCrash(lane);
  return made;
}

// Сообщение потоку; лист уходит один раз на ключ — копией, с передачей буфера.
function transmit(lane, id, job, rgb) {
  const { key, source, settings, format } = job;
  const firstTime = !lane.known.has(key);
  const copy = firstTime ? new Uint8ClampedArray(source.rgba) : null;
  const message = { id, key, format, rgb, settings };
  if (firstTime) message.rgba = copy;
  lane.worker ??= spawn(lane);
  lane.worker.postMessage(message, firstTime ? [copy.buffer] : []);
  lane.known.add(key);
}

function dispatch(lane, key, source, settings, format) {
  if (lane.gone) {
    return Promise.resolve().then(() => recolour(source, settings, format));
  }
  let rgb;
  try {
    rgb = colourOf(settings);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const id = ++lane.counter;
    const job = { resolve, reject, key, source, settings, format };
    lane.waiting.set(id, job);
    try {
      transmit(lane, id, job, rgb);
    } catch {
      lane.gone = true;
      lane.waiting.delete(id);
      recolourHere(job);
    }
  });
}

export function createSheetTinter() {
  const lane = {
    gone: typeof Worker !== "function",
    worker: null,
    counter: 0,
    waiting: new Map(),
    known: new Set(),
  };
  return {
    tint: (key, source, settings, format) => dispatch(lane, key, source, settings, format),
    dispose: () => {
      stopWorker(lane);
      forgetAll(lane);
    },
  };
}
