/*
 * Клиент рабочего потока студии (ТЗ 18.10.2026, Session 1, задача 6):
 * `runHeavy(op, request)` отдаёт ответ потока; нет потока (тесты, окно без
 * `Worker`) или он упал — операция идёт здесь же, в главном потоке. Поток
 * один на окно: заводится при первом запросе и гасится, когда студию закрыли
 * (`closeHeavy`). Буферы запроса уходят передачей: после вызова они пусты —
 * вызывающий копирует то, что ему ещё нужно.
 */

import { runHeavyOp } from "./heavy-ops.js";

let worker = null;
let broken = false;
let serial = 0;
const waiting = new Map();

function startWorker() {
  if (broken) return null;
  if (worker) return worker;
  if (typeof Worker !== "function" || /jsdom/i.test(globalThis.navigator?.userAgent || "")) {
    broken = true;
    return null;
  }
  try {
    worker = new Worker(new URL("./studio-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, ok, answer, error } = event.data || {};
      const entry = waiting.get(id);
      waiting.delete(id);
      if (!entry) return;
      if (ok) entry.resolve(answer);
      else entry.reject(new Error(error || "Операция студии не удалась."));
    };
    worker.onerror = () => {
      broken = true;
      worker?.terminate();
      worker = null;
      /* Что не вернулось из упавшего потока — считается здесь заново. */
      for (const entry of waiting.values()) entry.retry();
      waiting.clear();
    };
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

/** Выполнить `op` в потоке (или здесь): `Promise` с ответом без поля `transfer`. */
export function runHeavy(op, request) {
  const thread = startWorker();
  const here = () => {
    const { transfer, ...answer } = runHeavyOp(op, request);
    void transfer;
    return answer;
  };
  if (!thread) return Promise.resolve().then(here);
  /* Копия, чтобы упавший поток не унёс единственную: передача опустошает буфер. */
  const copy = {};
  const transfer = [];
  for (const [key, value] of Object.entries(request)) {
    if (value && value.buffer instanceof ArrayBuffer) {
      const clone = new value.constructor(value);
      copy[key] = clone;
      transfer.push(clone.buffer);
    } else copy[key] = value;
  }
  return new Promise((resolve, reject) => {
    serial += 1;
    const id = serial;
    waiting.set(id, { resolve, reject, retry: () => Promise.resolve().then(here).then(resolve, reject) });
    thread.postMessage({ id, op, request: copy }, transfer);
  });
}

/** Студию закрыли: поток гасится. */
export function closeHeavy() {
  worker?.terminate();
  worker = null;
  broken = false;
  waiting.clear();
}
