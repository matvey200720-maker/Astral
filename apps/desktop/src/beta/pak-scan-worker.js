/*
 * Поток проверки pak (`pak-scan.js`): один проход `scanPak` и ответ. Грузит
 * только пакет pak, без остального главного процесса.
 */
import { parentPort, workerData } from "node:worker_threads";
import { scanPak } from "@modovik/beta-pak";

try {
  const result = await scanPak(workerData.filePath, Buffer.from(workerData.key), workerData.options);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: { message: String(error?.message || error), code: error?.code || "" } });
}
