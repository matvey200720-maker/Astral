/*
 * Поток сборки «Дорог» (`roads-build-pool` в `recolor-roads.js`): получает
 * словарь игры, отдаёт собранный словарь и его SHA-256.
 *
 * Облик работы поток собирает сам, один раз, из той же работы и тех же
 * картинок, что и сборка без потоков: словарь выходит тем же байт в байт,
 * где бы его ни собрали (`roads-build.js`).
 */

import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { createRoadsContext, processRoadsDictionary } from "./roads-build.js";
import "./native-block-codec.js";

let context = null;
let failure = null;
try {
  context = createRoadsContext(workerData.project, new Map(workerData.images || []));
} catch (error) {
  failure = String(error?.message || error);
}

/* Буфер уходит без копии, только если он весь — этот словарь. */
const owned = (bytes) => bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;

parentPort.on("message", ({ id, job, bytes }) => {
  try {
    if (failure) throw new Error(failure);
    const result = processRoadsDictionary(bytes, job.name, context);
    const out = result.bytes ? (owned(result.bytes) ? result.bytes : new Uint8Array(result.bytes)) : null;
    const sha256 = out ? createHash("sha256").update(out).digest("hex") : null;
    parentPort.postMessage({ id, result: { bytes: out, sha256, textures: result.textures, skipped: result.skipped, sheets: result.sheets } }, out ? [out.buffer] : []);
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
