/*
 * Поток сборки места мира (`world-place-host.js`): то же, что `buildWorldPlaceBytes`, но в своей куче с пределом. Байты сцены уходят обратно передачей
 * буфера, без копии. С `indexOnly` поток только обновляет файл оглавления игры (`indexWorldPlaceGame`): перед тем как движок собирает место, его оглавление должно быть свежим.
 */
import { parentPort, workerData } from "node:worker_threads";
import { buildWorldPlaceBytes, indexWorldPlaceGame } from "./world-place-scene.js";
import "./native-block-codec.js";

try {
  if (workerData.indexOnly) {
    await indexWorldPlaceGame(workerData);
    parentPort.postMessage({ result: { indexed: true } });
  } else {
    const built = await buildWorldPlaceBytes(workerData);
    if (built.bytes) {
      const bytes = built.bytes;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      parentPort.postMessage({ result: { buffer, report: built.report ?? null } }, [buffer]);
    } else parentPort.postMessage({ result: { reason: built.reason || "" } });
  }
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
