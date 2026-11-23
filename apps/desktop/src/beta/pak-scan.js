import { scanPak } from "@modovik/beta-pak";
import { trackedWorker } from "../worker-census.js";

/*
 * Проход проверки pak (packages/beta-pak, `scanPak`: ~295 МБ, 0,29 с одним
 * ядром) — в потоке-работнике (31.10.2026, холодный старт). Главный процесс
 * в это время импортирует локальный API (~0,6 с), и два дела идут разом, а не
 * друг за другом.
 *
 * Поток один на запуск и сразу завершается. Не поднялся или упал сам (а не
 * вернул вердикт о pak) — проход считается здесь же тем же кодом: медленнее,
 * но запуск не ломается. Вердикт «чужой ключ, правка, обрезка» поток
 * присылает сообщением, и он доходит до вызывающего как есть.
 *
 * Откат не молчит: `onFallback(причина)` — в журнал (guard.js пишет его в
 * журнал беты). Иначе закрытая сборка, где поток не открылся из asar, тихо
 * вернула бы прежние 0,3 с на главном потоке.
 */
export function scanPakOffThread(filePath, key, { onFallback, ...options } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const inline = (reason) => {
      settled = true;
      try {
        onFallback?.(reason);
      } catch {
        /* Журнал — не повод ронять запуск. */
      }
      scanPak(filePath, key, options).then(resolve, reject);
    };
    let worker;
    try {
      worker = trackedWorker("pak-scan", new URL("./pak-scan-worker.js", import.meta.url), {
        workerData: { filePath, key: Uint8Array.from(key), options },
      });
    } catch (error) {
      return inline(`поток не создан: ${error?.message || error}`);
    }
    worker.once("message", (message) => {
      settled = true;
      if (message.error) reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else resolve(message.result);
      void worker.terminate();
    });
    worker.once("error", (error) => {
      if (!settled) inline(`поток упал: ${error?.message || error}`);
    });
    worker.once("exit", (code) => {
      if (!settled) inline(`поток вышел без ответа, код ${code}`);
    });
  });
}
