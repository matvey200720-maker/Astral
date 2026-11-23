/*
 * Тяжёлая работа главного процесса — в потоках-работниках
 * (ТЗ 06.10.2026, вечер, задача 1).
 *
 * Главный процесс Electron — это ещё и окно: пока его поток занят, окно не
 * перетаскивается, не сворачивается и не отвечает системе. А «Применить»
 * оружия, одежды и тату запекало текстуры прямо в нём: попиксельные циклы,
 * сжатие DXT всей цепочки mip на JS (до шестнадцати текстур 2048² — по
 * 0,2 с каждая), сжатие моделей zlib. Здесь эта работа уходит в потоки:
 *
 *   • пул поднимается лениво, на первой задаче, и засыпает (потоки
 *     завершаются) через 15 с без работы — в простое Astral не держит
 *     лишних потоков и не тратит на них память. Минута была долгой (ОЗУ,
 *     бета 15.10.2026): простаивающий поток не собирает свой мусор, и пул
 *     держал в главном процессе сотни мегабайт после «Применить», а
 *     «Применить» подряд с паузами меньше минуты не давали ему уснуть вовсе
 *     (замер на Mac, Electron 43, сборка воды ×4 с паузой 20 с: главный
 *     процесс рос 422 → 497 МБ и держал 431 МБ в простое; с 15 с — 398 МБ
 *     на четвёртой и 243 МБ в простое). Поднять поток заново — доли
 *     секунды на «Применить» в десятки секунд;
 *   • потоков — ядра минус два, не больше четырёх: окну и движку остаётся
 *     своё;
 *   • задача отменяется (`signal`): поток, который её считает, завершается и
 *     поднимается заново для следующих;
 *   • поток не поднялся или упал — задача считается здесь же тем же кодом
 *     (`heavy-work-jobs.js`): медленнее, но установка не ломается.
 *
 * Задачи — чистые функции «байты на входе — байты на выходе»; большие
 * буферы передаются без копии (`transfer`).
 */

import os from "node:os";
import { trackedWorker } from "./worker-census.js";
import { onHibernate } from "./hibernation-hooks.js";

const WORKER_URL = new URL("./heavy-work-worker.js", import.meta.url);
const IDLE_MS = 15_000;

export function heavyWorkPoolSize(env = process.env) {
  const forced = Number.parseInt(env.ASTRAL_HEAVY_WORKERS ?? "", 10);
  if (Number.isInteger(forced) && forced >= 0) return Math.min(forced, 16);
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 2));
}

const abortError = () => Object.assign(new Error("Операция отменена."), { name: "AbortError", code: "ABORT_ERR" });

export function createHeavyWork({ size = heavyWorkPoolSize(), workerUrl = WORKER_URL, idleMs = IDLE_MS, inline = null } = {}) {
  const workers = new Set();
  const idle = [];
  const queue = [];
  const running = new Map();
  let nextId = 1;
  let idleTimer = null;
  let broken = false;

  const runInline = async (task) => {
    const jobs = inline || (await import("./heavy-work-jobs.js")).HEAVY_JOBS;
    const job = jobs[task.name];
    if (!job) throw new Error(`Нет тяжёлой задачи «${task.name}».`);
    return job(task.payload);
  };

  function scheduleSleep() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (running.size || queue.length || !workers.size) return;
    idleTimer = setTimeout(() => {
      for (const worker of [...workers]) void worker.terminate().catch(() => {});
      workers.clear();
      idle.length = 0;
    }, idleMs);
    idleTimer.unref?.();
  }

  function spawnWorker() {
    let worker;
    try {
      worker = trackedWorker("heavy-work", workerUrl);
    } catch {
      broken = true;
      return null;
    }
    worker.unref?.();
    /* Поток, упавший до первого ответа, — не поднимается вовсе (нет файла
       работника в сборке, нет `worker_threads`): дальше всё считается здесь. */
    let answered = false;
    worker.on("message", (message) => {
      answered = true;
      const task = running.get(message.id);
      if (!task) return;
      if (message.progress !== undefined) {
        task.onProgress?.(message.progress);
        return;
      }
      running.delete(message.id);
      task.cleanup();
      if (message.error) task.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else task.resolve(message.result);
      release(worker);
    });
    const fail = (error) => {
      workers.delete(worker);
      const index = idle.indexOf(worker);
      if (index >= 0) idle.splice(index, 1);
      for (const [id, task] of running)
        if (task.worker === worker) {
          running.delete(id);
          task.cleanup();
          if (task.cancelled) continue;
          /* Поток упал посреди задачи — она считается здесь же. */
          runInline(task).then(task.resolve, task.reject);
        }
      if (error && !answered) broken = true;
      if (broken) for (const task of queue.splice(0)) runInline(task).then(task.resolve, task.reject);
      else pump();
    };
    worker.on("error", (error) => fail(error));
    worker.on("exit", () => fail(null));
    workers.add(worker);
    return worker;
  }

  function release(worker) {
    if (!workers.has(worker)) return;
    idle.push(worker);
    pump();
    scheduleSleep();
  }

  function dispatch(worker, task) {
    task.worker = worker;
    running.set(task.id, task);
    worker.ref?.();
    try {
      worker.postMessage({ id: task.id, name: task.name, payload: task.payload }, task.transfer || []);
    } catch (error) {
      /* Задача не ушла (буфер нельзя передать, payload не клонируется): ошибка — вызывающему, поток снова свободен.
         Раньше задача оставалась в `running`, а поток — ссылкой на цикл событий: процесс не завершался. */
      running.delete(task.id);
      task.cleanup();
      task.reject(error);
      release(worker);
    }
  }

  function pump() {
    while (queue.length) {
      let worker = idle.pop();
      if (!worker && workers.size < size && !broken) worker = spawnWorker();
      if (!worker) {
        /* Потоки не поднимаются вовсе — очередь считается здесь же. */
        if (broken && !workers.size) for (const task of queue.splice(0)) runInline(task).then(task.resolve, task.reject);
        break;
      }
      dispatch(worker, queue.shift());
    }
    for (const worker of idle) worker.unref?.();
  }

  /**
   * `run(name, payload, { transfer, signal, onProgress })` → результат задачи.
   */
  function run(name, payload, { transfer = [], signal = null, onProgress = null } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    clearTimeout(idleTimer);
    idleTimer = null;
    return new Promise((resolve, reject) => {
      const task = { id: nextId++, name, payload, transfer, onProgress, resolve, reject, worker: null, cancelled: false, cleanup: () => {} };
      if (size < 1 || broken) {
        runInline(task).then(resolve, reject);
        return;
      }
      if (signal) {
        const onAbort = () => {
          task.cancelled = true;
          const at = queue.indexOf(task);
          if (at >= 0) queue.splice(at, 1);
          if (running.has(task.id)) {
            running.delete(task.id);
            /* Считающий поток останавливается: следующий поднимется заново. */
            void task.worker?.terminate().catch(() => {});
          }
          reject(abortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        task.cleanup = () => signal.removeEventListener("abort", onAbort);
      }
      queue.push(task);
      pump();
    });
  }

  return {
    run,
    /** Сколько потоков живо (для тестов и замеров). */
    get size() {
      return workers.size;
    },
    /** Сколько задач в работе и в очереди. */
    get jobs() {
      return running.size + queue.length;
    },
    async close() {
      clearTimeout(idleTimer);
      idleTimer = null;
      /* Закрываемые потоки выводятся из простоя до ожидания: выход одного из них
         запускает `pump`, а тот снимает ссылку с простаивающих — и их выход не
         придёт, ожидание оборвётся (`node --test`, скрипты). Каждый держим ссылкой
         до выхода. */
      const closing = [...workers];
      idle.length = 0;
      await Promise.all(closing.map((worker) => {
        worker.ref?.();
        return worker.terminate().catch(() => {});
      }));
      workers.clear();
    },
  };
}

/* Один пул на процесс. */
export const heavyWork = createHeavyWork();

/* Спячка окна: пул закрывается сразу; пока считает — спячка ждёт. */
onHibernate("heavy-work", {
  busy: () => (heavyWork.jobs ? `тяжёлая работа: ${heavyWork.jobs}` : null),
  sleep: () => heavyWork.close(),
});
