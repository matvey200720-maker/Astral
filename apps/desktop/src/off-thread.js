/*
 * Тяжёлый счёт главного процесса — в поток (фикс 1 ТЗ 07.10.2026).
 *
 * Чистая функция модуля (вход и ответ переносятся копией) выполняется в
 * потоке-однодневке: главный поток окна не стоит, пока она считает.
 * Поток не поднялся (нет `worker_threads`, сборка без файла) — функция
 * выполняется здесь же: медленнее для окна, но с тем же ответом.
 *
 *   await runOffThread(new URL("./weapon-icons.js", import.meta.url), "renderWeaponIconsFromGame", [root, keys, ids])
 */

import os from "node:os";
import { trackedWorker } from "./worker-census.js";

const WORKER_URL = new URL("./off-thread-worker.js", import.meta.url);

/*
 * Потолок кучи потока. Прежние 1536 МБ были одинаковы для всех: у человека с
 * 32 ГБ памяти поток упирался в них раньше, чем в память машины (его счёт
 * считает и внешние буферы). Четверть оперативной памяти, но не меньше прежних
 * 1,5 ГБ и не больше 4 ГБ: потолок нужен от бесконечного счёта, а не от честной
 * работы.
 */
export function defaultHeapLimitMb(totalBytes = os.totalmem()) {
  const quarter = Math.floor(totalBytes / (1024 * 1024) / 4);
  return Math.max(1536, Math.min(4096, quarter));
}

export function runOffThread(moduleUrl, exportName, args = [], { heapLimitMb = defaultHeapLimitMb(), workerUrl = WORKER_URL } = {}) {
  const href = String(moduleUrl instanceof URL ? moduleUrl.href : moduleUrl);
  const inline = async () => (await import(href))[exportName](...args);
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
      worker = trackedWorker(`off-thread:${exportName}`, workerUrl, {
        workerData: { moduleUrl: href, exportName, args },
        resourceLimits: { maxOldGenerationSizeMb: heapLimitMb },
      });
    } catch {
      inline().then(resolve, reject);
      return;
    }
    worker.on("message", (message) => {
      if (message && "error" in message) settle(reject, new Error(message.error));
      else settle(resolve, message?.result);
    });
    worker.on("error", (error) =>
      settle(reject, error?.code === "ERR_WORKER_OUT_OF_MEMORY" ? new Error("Не хватило памяти — закройте тяжёлые программы и повторите.") : error),
    );
    worker.on("exit", (code) => settle(reject, new Error(`Поток счёта остановился (код ${code}).`)));
  });
}
