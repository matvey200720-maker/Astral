/*
 * Фоновый поток плиток большой карты.
 *
 * Принимает задания `world-map-tile-runner.js` и отвечает тем же номером.
 * Большие массивы уезжают и возвращаются передачей владения, без копии:
 * копировать шестьдесят мегабайт на каждую плитку — это и есть та пауза,
 * от которой поток заведён.
 */

import { encodeTile, processBaseTile } from "./world-map-pixels.js";

self.onmessage = (event) => {
  const { id, type, job } = event.data || {};
  try {
    if (type === "base") {
      const result = processBaseTile(job);
      self.postMessage({ id, result }, [result.data.buffer]);
      return;
    }
    if (type === "encode") {
      self.postMessage({ id, result: encodeTile(job) });
      return;
    }
    throw new Error(`Неизвестное задание потока плиток: ${type}`);
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
