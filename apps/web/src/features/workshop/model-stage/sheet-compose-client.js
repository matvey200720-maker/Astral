import { composeSheetPixels } from "./sheet-compose.js";

const FALLBACK_TEXT = "sheet-compose-worker";

// Связь с потоком: сам поток (undefined: ещё не пробовали, null: нет и не будет),
// счётчик сообщений и таблица ждущих.
const link = { thread: undefined, serial: 0, calls: new Map() };

const deferred = () => {
  const call = {};
  call.promise = new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));
  return call;
};

const outcomeOf = (reply) => (reply.error ? ["reject", new Error(reply.error)] : ["resolve", reply.out]);

function deliver(reply) {
  const call = link.calls.get(reply.id);
  if (!call) return;
  link.calls.delete(reply.id);
  const [method, value] = outcomeOf(reply);
  call[method](value);
}

// Сбой потока: ждущие получают отказ, потока больше нет.
function collapse(event) {
  for (const call of link.calls.values()) call.reject(new Error(event.message || FALLBACK_TEXT));
  link.calls.clear();
  link.thread = null;
}

function openThread() {
  if (typeof Worker !== "function") return null;
  try {
    return Object.assign(new Worker(new URL("./sheet-compose-worker.js", import.meta.url), { type: "module" }), {
      onmessage: (event) => deliver(event.data || {}),
      onerror: collapse,
    });
  } catch {
    return null;
  }
}

const currentThread = () => (link.thread === undefined ? (link.thread = openThread()) : link.thread);

function ask(thread, jobs) {
  const id = ++link.serial;
  const call = deferred();
  link.calls.set(id, call);
  try {
    thread.postMessage({ id, jobs });
  } catch (failure) {
    call.reject(failure); // запись в таблице остаётся, поток тоже
  }
  return call.promise;
}

const computeHere = (jobs) => jobs.map(composeSheetPixels);

function dispatch(jobs) {
  const thread = currentThread();
  if (thread === null) return Promise.resolve(computeHere(jobs));
  return ask(thread, jobs).catch(() => computeHere(jobs));
}

export function composeSheetsAsync(jobs) {
  return jobs.length ? dispatch(jobs) : Promise.resolve([]);
}
