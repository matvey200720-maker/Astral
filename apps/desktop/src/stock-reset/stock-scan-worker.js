/* Поток сверки папки игры с описью (`stock-scan.js`): ход — сообщениями, ответ — последним. */

import { parentPort, workerData } from "node:worker_threads";
import { runStockScan } from "./stock-scan.js";

try {
  const result = await runStockScan(workerData, {
    onProgress: (progress) => parentPort.postMessage({ progress }),
  });
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
