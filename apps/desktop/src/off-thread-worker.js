/* Поток-однодневка `off-thread.js`: одна функция модуля и её ответ. */

import { parentPort, workerData } from "node:worker_threads";
import "./native-block-codec.js";

const { moduleUrl, exportName, args } = workerData;
try {
  const module = await import(moduleUrl);
  const result = await module[exportName](...(args || []));
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
