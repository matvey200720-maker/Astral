/*
 * Сборка места мира вне главного процесса (ТЗ 01.11.2026: зоны на настоящих зданиях): чтение сотен файлов игры и склейка миллионов вершин — в потоке со
 * своим пределом кучи, как у «Интерьеров» (`shop-scene-host.js`). Кончилась память — падает поток, а кадр отвечает «не собралось» словами.
 *
 * Поток один на всё приложение: ноутбук владельца греется, а человек листает зоны быстрее, чем они собираются. Очередь короткая: пролистанное отменяется
 * (`skipped`), и собирается то, на чём человек остановился; идущая сборка доводится до конца — её сцена ляжет в кэш и пригодится при возврате.
 */
import fs from "node:fs/promises";
import { trackedWorker } from "./worker-census.js";
import { resourceEnvironment } from "./recolor-build-host.js";
import { workerRuntimeEnvironment } from "./runtime-paths.js";
import { defaultWorldPlaceEngine } from "./world-place-engine.js";

const WORKER_URL = new URL("./world-place-worker.js", import.meta.url);
const HEAP_LIMIT_MB = 3072;
/* Сколько просьб ждёт за идущей: прежние, что не дождались, отменяются. */
const QUEUE_LIMIT = 1;

function runWorker(task, { workerUrl, heapLimitMb }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
      void worker?.terminate().catch(() => {});
    };
    try {
      worker = trackedWorker("world-place", workerUrl, {
        workerData: { origin: task.origin, reach: task.reach, outline: task.outline || "", zonesRoot: task.zonesRoot || "", gameRoot: task.gameRoot, keys: task.keys || "", indexFile: task.indexFile || "", ...(task.indexOnly ? { indexOnly: true } : {}) },
        env: { ...process.env, ...resourceEnvironment(), ...workerRuntimeEnvironment() },
        resourceLimits: { maxOldGenerationSizeMb: heapLimitMb },
      });
    } catch (error) {
      reject(error);
      return;
    }
    worker.on("message", (message) => {
      if (message?.error) settle(reject, new Error(message.error));
      else if (message?.result?.indexed) settle(resolve, { indexed: true });
      else if (message?.result?.buffer) settle(resolve, { bytes: new Uint8Array(message.result.buffer), report: message.result.report });
      else if (message?.result) settle(resolve, { reason: message.result.reason });
    });
    worker.on("error", (error) => {
      if (error?.code === "ERR_WORKER_OUT_OF_MEMORY") settle(resolve, { outOfMemory: true });
      else settle(reject, error);
    });
    worker.on("exit", (code) => settle(reject, new Error(`Сборка места остановилась (код ${code}).`)));
  });
}

/**
 * Очередь сборок: `build(task)` → `{ bytes, report }`, `{ reason }`, `{ outOfMemory: true }` или `{ skipped: true }` (пролистано, собирается другое).
 * `run` — сама сборка: подменяют тесты.
 */
export function createWorldPlaceQueue({ run }) {
  let busy = false;
  const waiting = [];
  const next = () => {
    if (busy) return;
    const job = waiting.shift();
    if (!job) return;
    busy = true;
    run(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        busy = false;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      while (waiting.length > QUEUE_LIMIT) waiting.shift().resolve({ skipped: true });
      next();
    });
}

const fileBytes = async (file) => (await fs.stat(file).catch(() => null))?.size ?? -1;

/**
 * Одна сборка: движок (`world-place-engine.js`, за выключателем `ASTRAL_RUST_PLACE_SCENE=1`), а при любом его отказе — поток JS. `engine` — оболочка движка, `worker(task)` — поток
 * JS (`{ bytes, report }`, `{ reason }`, `{ outOfMemory }`, а с `indexOnly` — `{ indexed }`), `size(файл)` — размер файла или −1. Ответ движка — `{ file, bytes, report, timings }`
 * (сцена уже лежит в `task.cacheFile`) или `{ empty: true }`; `{ fallback }`, отказ и пропавший файл — путь JS.
 */
export function createPlaceRunner({ engine, worker, size = fileBytes }) {
  return async function run(task) {
    if (task.cacheFile && engine.available()) {
      try {
        const answer = await engine.build(task, { buildIndex: (indexTask) => worker({ ...indexTask, indexOnly: true }) });
        if (answer.empty) return { empty: true };
        if (answer.file && (await size(answer.file)) === answer.bytes) return answer;
      } catch (error) {
        engine.noteFailure(error);
      }
    }
    return worker(task);
  };
}

const queue = createWorldPlaceQueue({
  run: createPlaceRunner({ engine: defaultWorldPlaceEngine(), worker: (task) => runWorker(task, { workerUrl: WORKER_URL, heapLimitMb: HEAP_LIMIT_MB }) }),
});

/** Сборка места в потоке: одна за раз, см. `createWorldPlaceQueue`. */
export const buildWorldPlaceOffThread = (task) => queue(task);
