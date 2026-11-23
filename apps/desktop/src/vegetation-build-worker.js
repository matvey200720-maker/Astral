/*
 * Поток сборки растительности (`vegetation-build-pool.js`): получает файл
 * работы и что с ним сделать, отдаёт собранный файл и его SHA-256.
 *
 * Облик работы и склад «Сэнди» поток собирает сам, один раз, из того же
 * проекта и того же склада поставки, что и главный процесс: файл выходит
 * тем же байт в байт, где бы его ни собрали (`vegetation-build.js`).
 */

import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { createVegetationContext, openGreenSandy, processVegetationJob } from "./vegetation-build.js";
import "./native-block-codec.js";

const ready = (async () => createVegetationContext(workerData.project, workerData.sandy ? await openGreenSandy() : null))();
/* Ошибка подготовки — ответом на первую же работу, а не падением потока. */
ready.catch(() => {});

/*
 * Буфер уходит в главный процесс без копии, только если он весь — этот
 * файл; иначе (маленький Buffer живёт в общем пуле) — своей копией.
 */
const owned = (bytes) => bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;

parentPort.on("message", async ({ id, job, bytes }) => {
  try {
    const context = await ready;
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = processVegetationJob(job, input, context);
    const out = result.bytes ? (owned(result.bytes) ? result.bytes : new Uint8Array(result.bytes)) : null;
    const sha256 = out ? createHash("sha256").update(out).digest("hex") : null;
    parentPort.postMessage(
      { id, result: { bytes: out, sha256, kinds: result.kinds, counts: result.counts } },
      out ? [out.buffer] : [],
    );
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
