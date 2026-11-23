/*
 * Пул потоков для сборок, где файлы друг от друга не зависят (задача 6 ТЗ
 * 07.10.2026: «Дороги» — полторы тысячи словарей карты, каждый разжать,
 * перекрасить листы и сжать заново). Устроен как пул растительности
 * (`vegetation-build-pool.js`), но без её склада: поток получает файл и
 * задание, отдаёт собранные байты и их отпечаток.
 *
 * Поток, который не поднялся или упал, ломает только пул: сборка доделывает
 * оставшееся в своём потоке тем же кодом (`WorkerPoolBroken`).
 */

import os from "node:os";
import { trackedWorker } from "./worker-census.js";

/** Пул сломан (поток не поднялся или упал) — остальное собирается без него. */
export class WorkerPoolBroken extends Error {}

/**
 * Потоков сборки на `cores` логических процессоров: половина, не больше `max` (04.11.2026, «комфортно даже на слабых компьютерах»). Было «ядра минус одно»: на
 * восьми потоках шесть потоков сборки занимали три четверти машины, и окну, игре и браузеру человека доставалась четверть. Замер (план «растительность как в моде», первый
 * уровень сжатия, потоки процессора 0–7 — «4 ядра, 8 потоков»): шесть потоков — 49 с и 215 с процессора, четыре — 50–56 с и 188–200 с (пик ОЗУ −20 %), два — 72 с и 171 с.
 * На 16 потоках этого ноутбука потолок `max` (шесть) остаётся прежним: 6 потоков — 40 с, 4 — 42–45 с.
 */
export function buildWorkerCount(cores, max = 6) {
  return Math.max(1, Math.min(max, Math.floor(cores / 2)));
}

/*
 * Потоки сборки — ещё и по свободной памяти (18.11.2026). Замер на ПК владельца (16 логических процессоров, 15,7 ГБ):
 * сборка растительности шестью потоками за ~30 с забрала 1,8 ГБ — доступная память упала с 3114 до 1296 МБ. На машине,
 * где свободно 2–3 ГБ, это подкачка на диск: лагает и окно, и всё остальное. Каждому потоку — `POOL_MEMORY_PER_WORKER`
 * сверх запаса `POOL_MEMORY_RESERVE` (окну, системе и самой сборке); меньше двух потоков память не делает — иначе
 * сборка на слабом ПК шла бы вчетверо дольше. Считается один раз, перед стартом сборки.
 */
const MIB = 1024 * 1024;
export const POOL_MEMORY_RESERVE = 1536 * MIB;
export const POOL_MEMORY_PER_WORKER = 400 * MIB;
const POOL_MIN_BY_MEMORY = 2;

/** Сколько потоков позволяет свободная память `freeBytes`; не число — предела нет. */
export function workersByMemory(freeBytes) {
  if (!Number.isFinite(freeBytes)) return Infinity;
  return Math.max(POOL_MIN_BY_MEMORY, Math.floor((freeBytes - POOL_MEMORY_RESERVE) / POOL_MEMORY_PER_WORKER));
}

/**
 * Сколько потоков: половина логических процессоров, не больше `max` (`buildWorkerCount`). Переменная окружения
 * `envName` (число) — своё число; `0` — без потоков.
 */
export function workerPoolSize(envName, options = {}) {
  return workerPoolPlan(envName, options).size;
}

/**
 * Расчёт размера пула с числами для журнала: `{ size, byCores, freeMb, forced }`. `freeBytes` — свободная память
 * (по умолчанию — системы сейчас; `Infinity` — не учитывать).
 */
export function workerPoolPlan(envName, { max = 6, env = process.env, cores = null, freeBytes = os.freemem() } = {}) {
  const available = cores ?? (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length);
  const byCores = buildWorkerCount(available, max);
  const freeMb = Number.isFinite(freeBytes) ? Math.floor(freeBytes / MIB) : null;
  const forced = Number.parseInt(env[envName] ?? "", 10);
  if (Number.isInteger(forced) && forced >= 0) return { size: Math.min(forced, 16), byCores, freeMb, forced: true };
  return { size: Math.max(1, Math.min(byCores, workersByMemory(freeBytes))), byCores, freeMb, forced: false };
}

/* Байты уходят в поток без копии, только если буфер весь — этот файл. */
const transferable = (bytes) => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : new Uint8Array(bytes));

/**
 * Пул на одну сборку: `run(job, bytes)` → ответ потока (байты файла пул
 * забирает себе), `close()` — после сборки. `null`, если потоков ноль.
 */
export function createWorkerPool({ url, workerData = {}, size, label = "сборки" }) {
  if (!(size >= 1)) return null;
  const workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map();
  let nextId = 1;
  let broken = null;
  let closing = false;

  const fail = (error) => {
    if (broken || closing) return;
    broken = new WorkerPoolBroken(`Потоки ${label} остановились: ${String(error?.message || error)}`);
    for (const task of pending.values()) task.reject(broken);
    pending.clear();
    for (const task of queue.splice(0)) task.reject(broken);
  };
  const dispatch = (worker, task) => {
    pending.set(task.id, task);
    worker.postMessage({ id: task.id, job: task.job, bytes: task.bytes }, [task.bytes.buffer]);
  };
  const release = (worker) => {
    const next = queue.shift();
    if (next) dispatch(worker, next);
    else idle.push(worker);
  };

  for (let index = 0; index < size; index += 1) {
    let worker;
    try {
      worker = trackedWorker(`pool:${label}`, url, { workerData });
    } catch (error) {
      fail(error);
      break;
    }
    worker.on("message", (message) => {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error));
      else
        task.resolve({
          ...message.result,
          bytes: message.result?.bytes
            ? Buffer.from(message.result.bytes.buffer, message.result.bytes.byteOffset, message.result.bytes.byteLength)
            : null,
        });
      release(worker);
    });
    worker.on("error", (error) => fail(error));
    worker.on("exit", (code) => {
      if (code !== 0) fail(new Error(`поток вышел с кодом ${code}`));
    });
    workers.push(worker);
    idle.push(worker);
  }

  return {
    size: workers.length,
    run(job, bytes) {
      if (broken) return Promise.reject(broken);
      return new Promise((resolve, reject) => {
        const task = { id: nextId++, job, bytes: transferable(bytes), resolve, reject };
        const worker = idle.pop();
        if (worker) dispatch(worker, task);
        else queue.push(task);
      });
    },
    async close() {
      closing = true;
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
    },
  };
}
