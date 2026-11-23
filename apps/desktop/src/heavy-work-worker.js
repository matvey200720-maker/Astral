/*
 * Поток-работник пула тяжёлой работы (`heavy-work.js`): берёт задачу по
 * имени из `heavy-work-jobs.js`, считает и возвращает результат. Большой
 * результат (байты) уходит без копии.
 */

import { parentPort } from "node:worker_threads";
import { HEAVY_JOBS } from "./heavy-work-jobs.js";
import "./native-block-codec.js";

const transferOf = (value) =>
  value instanceof Uint8Array && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength ? [value.buffer] : [];

parentPort.on("message", async ({ id, name, payload }) => {
  try {
    const job = HEAVY_JOBS[name];
    if (!job) throw new Error(`Нет тяжёлой задачи «${name}».`);
    const result = await job(payload, (progress) => parentPort.postMessage({ id, progress }));
    parentPort.postMessage({ id, result }, transferOf(result));
  } catch (error) {
    parentPort.postMessage({ id, error: { message: String(error?.message || error), code: error?.code || "" } });
  }
});
