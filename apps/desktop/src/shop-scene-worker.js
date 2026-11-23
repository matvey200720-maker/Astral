import * as threads from "node:worker_threads";
import * as shopScene from "./recolor-shops-scene.js";
import "./native-block-codec.js";

// Тело потока: одна сборка сцены и ровно одно сообщение родителю.

const failureText = (failure) => String(failure?.message || failure);

// Родителю уходит копия нужного отрезка: исходные байты остаются целыми в потоке.
function cutOut(bytes) {
  const { byteOffset, byteLength } = bytes;
  return bytes.buffer.slice(byteOffset, byteOffset + byteLength);
}

function deliver(answer) {
  const bytes = answer.bytes;
  if (!bytes) {
    threads.parentPort.postMessage({ result: { reason: answer.reason || "" } });
    return;
  }
  const buffer = cutOut(bytes);
  threads.parentPort.postMessage({ result: { buffer, report: answer.report ?? null } }, [buffer]);
}

const finished = (async () => {
  try {
    deliver(await shopScene.buildShopSceneBytes(threads.workerData));
  } catch (failure) {
    threads.parentPort.postMessage({ error: failureText(failure) });
  }
})();

await finished;
