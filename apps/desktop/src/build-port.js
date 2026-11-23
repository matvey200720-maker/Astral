/*
 * Сторона скрипта сборки (`build-process.js`): данные и порт к главному
 * процессу — одинаково в потоке (`worker_threads`) и в своём процессе
 * (`utilityProcess`: `process.parentPort`).
 *
 * `port` — `postMessage(message)`, `on("message", fn)`, `off("message", fn)`;
 * `fn` получает само сообщение, как у `parentPort` потока.
 */

import { isMainThread, parentPort, workerData } from "node:worker_threads";

export async function openBuildPort({ upstream = process.parentPort } = {}) {
  if (!isMainThread && parentPort) return { data: workerData, port: parentPort };
  if (!upstream) throw new Error("Скрипт сборки запущен не из Astral: нет связи с главным процессом.");
  const wrapped = new Map();
  const port = {
    postMessage: (message) => upstream.postMessage(message),
    on(type, listener) {
      const wrapper = (event) => listener(event?.data);
      wrapped.set(listener, wrapper);
      upstream.on(type, wrapper);
      return port;
    },
    off(type, listener) {
      const wrapper = wrapped.get(listener);
      if (wrapper) upstream.off(type, wrapper);
      wrapped.delete(listener);
      return port;
    },
  };
  const data = await new Promise((resolve) => {
    const first = (event) => {
      if (!event?.data || !("workerData" in event.data)) return;
      upstream.off("message", first);
      resolve(event.data.workerData);
    };
    upstream.on("message", first);
    upstream.postMessage({ buildPortReady: true });
  });
  return { data, port };
}
