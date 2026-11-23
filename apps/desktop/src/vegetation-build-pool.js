/*
 * Потоки сборки растительности (05.10.2026).
 *
 * Пустыня «как у мода» со всеми частями — полторы тысячи словарей, и каждый
 * надо разжать, перекрасить (DXT туда и обратно) и сжать заново. В одном
 * потоке это шесть-семь минут на быстром процессоре и четверть часа на
 * обычном, а файлы друг от друга не зависят. Здесь они расходятся по
 * потокам (`vegetation-build-worker.js`): ядра процессора минус одно — окну.
 *
 * Поток, который не поднялся или упал, ломает только пул: сборка доделывает
 * оставшееся в главном процессе тем же кодом (`VegetationPoolBroken`).
 */

import { trackedWorker } from "./worker-census.js";
import { workerPoolPlan, workerPoolSize } from "./worker-pool.js";

/** Пул сломан (поток не поднялся или упал) — остальное собирается без него. */
export class VegetationPoolBroken extends Error {}

const MAX_WORKERS = 6;

/**
 * Сколько потоков: половина логических процессоров, не больше шести (каждый держит
 * свой склад «Сэнди» и свои файлы в памяти; `buildWorkerCount` в `worker-pool.js`).
 * `ASTRAL_VEGETATION_WORKERS=0` — сборка в главном процессе, как прежде.
 */
export function vegetationPoolSize(env = process.env, cores = null, freeBytes = undefined) {
  return workerPoolSize("ASTRAL_VEGETATION_WORKERS", { max: MAX_WORKERS, env, cores, ...(freeBytes === undefined ? {} : { freeBytes }) });
}

/** Тот же расчёт с числами для журнала: `{ size, byCores, freeMb, forced }` (`workerPoolPlan`). */
export function vegetationPoolPlan(env = process.env, cores = null, freeBytes = undefined) {
  return workerPoolPlan("ASTRAL_VEGETATION_WORKERS", { max: MAX_WORKERS, env, cores, ...(freeBytes === undefined ? {} : { freeBytes }) });
}

/** Строка журнала о размере пула: по ней в журнале тестера видно, что сработало ограничение по памяти. */
export function vegetationPoolNote({ size, byCores, freeMb, forced }) {
  const threads = `${size} ${size === 1 ? "поток" : size >= 2 && size <= 4 ? "потока" : "потоков"}`;
  if (forced) return `сборка растительности: ${threads} (задано ASTRAL_VEGETATION_WORKERS)`;
  return `сборка растительности: ${threads} (свободно ${freeMb ?? "?"} МБ, по ядрам было бы ${byCores})`;
}

/* Байты уходят в поток без копии, только если буфер весь — этот файл. */
const transferable = (bytes) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : new Uint8Array(bytes);

/**
 * Пул на одну сборку: `run(job, bytes)` → `{ bytes, sha256, kinds, counts }`
 * (байты файла пул забирает себе), `close()` — после сборки. `null`, если
 * потоков ноль.
 */
export function createVegetationPool({ project, sandy, size = vegetationPoolSize() }) {
  if (size < 1) return null;
  const url = new URL("./vegetation-build-worker.js", import.meta.url);
  const workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map();
  let nextId = 1;
  let broken = null;
  let closing = false;

  const fail = (error) => {
    if (broken || closing) return;
    broken = new VegetationPoolBroken(`Потоки сборки растительности остановились: ${String(error?.message || error)}`);
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
      worker = trackedWorker("vegetation-pool", url, { workerData: { project, sandy: Boolean(sandy) } });
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
          bytes: message.result.bytes
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
