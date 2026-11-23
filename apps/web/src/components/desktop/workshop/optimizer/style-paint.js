// Окно-клиент потока краски «Стиля мира»: одно задание — один ответ.
// Нет потока (или он упал) — отказ, и вкладка красит кадр у себя.

// Всё состояние модуля в одном месте: подмена потока, сам поток, метка аварии,
// последний выданный номер и ждущие задания.
const hub = { factory: null, worker: null, dead: false, issued: 0, waiting: new Map() };

const PLATFORM_PARTS = ["Worker", "OffscreenCanvas", "createImageBitmap"];

const isGlobalFunction = (name) => typeof globalThis[name] === "function";

export const stylePaintAvailable = () =>
  !hub.dead && (typeof hub.factory === "function" || PLATFORM_PARTS.every(isGlobalFunction));

const openWorker = () =>
  new Worker(new URL("./style-paint-worker.js", import.meta.url), { type: "module" });

// Ответ потока: ждущему заданию уходит остальное содержимое или ошибка.
function settle(event) {
  const { id, error, ...fields } = event?.data ?? {};
  const entry = hub.waiting.get(id);
  if (entry !== undefined) {
    hub.waiting.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(fields);
  }
}

function collapse() {
  const { worker: lost, waiting } = hub;
  Object.assign(hub, { dead: true, worker: null });
  lost?.terminate?.();
  waiting.forEach((entry) => entry.reject(new Error("worker")));
  waiting.clear();
}

function spawn() {
  const made = typeof hub.factory === "function" ? hub.factory() : openWorker();
  return Object.assign(made, { onmessage: settle, onerror: collapse });
}

// Завести задание: номер, ожидание и обещание, которое оно закроет.
function register() {
  let entry;
  const promise = new Promise((resolve, reject) => {
    entry = { resolve, reject };
  });
  const id = ++hub.issued;
  hub.waiting.set(id, entry);
  return { id, entry, promise };
}

function send(id, job) {
  (hub.worker ??= spawn()).postMessage({ id, ...job });
}

export function stylePaint(job) {
  if (!stylePaintAvailable()) return Promise.reject(new Error("no worker"));
  const { id, entry, promise } = register();
  try {
    send(id, job);
  } catch (error) {
    hub.dead = true;
    entry.reject(error);
  }
  return promise;
}

// Для проверок: подмена потока. Прежний поток не останавливается,
// ждущие задания остаются без ответа, номера заданий не сбрасываются.
export function setStylePaintWorkerFactory(make) {
  const factory = typeof make === "function" ? make : null;
  Object.assign(hub, { factory, worker: null, dead: false });
  hub.waiting.clear();
}
