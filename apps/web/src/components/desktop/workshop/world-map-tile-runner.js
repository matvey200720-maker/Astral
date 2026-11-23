/*
 * Исполнитель пиксельной работы над плитками большой карты.
 *
 * Работа идёт в фоновом потоке, чтобы окно во время установки оставалось
 * живым: полоса двигалась, часы шли, а «Не отвечает» в заголовке не появлялось.
 * Поток — удобство, а не условие: там, где его нет (тесты, среда без
 * `Worker`) или где он не поднялся, те же функции выполняются прямо в окне,
 * уступая ему между заданиями.
 */

import { encodeTile, processBaseTile } from "./world-map-pixels.js";

const INLINE = Object.freeze({ base: processBaseTile, encode: encodeTile });

/** Даёт окну перерисоваться между тяжёлыми заданиями. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

function startWorker() {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./world-map-tile-worker.js", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }
}

export function createTileRunner() {
  let worker = startWorker();
  let sequence = 0;
  const pending = new Map();

  const runInline = async (type, job) => {
    await breathe();
    return INLINE[type](job);
  };

  /*
   * Поток упал (не загрузился скрипт, кончилась память) — задания, которые
   * ждали ответа, доделываются в окне, и дальше работа идёт там же. Задание
   * хранится в том виде, в каком его можно повторить: массив, отданный потоку
   * насовсем, в окне уже пуст.
   */
  const abandonWorker = () => {
    if (!worker) return;
    worker.terminate();
    worker = null;
    for (const [, entry] of pending)
      runInline(entry.type, entry.job).then(entry.resolve, entry.reject);
    pending.clear();
  };

  if (worker) {
    worker.onmessage = (event) => {
      const { id, result, error } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      abandonWorker();
    };
  }

  /**
   * @param {"base"|"encode"} type
   * @param {object} job задание в виде, пригодном для повтора в окне
   * @param {(job: object) => {job: object, transfer: Transferable[]}} [ship]
   *   что именно уезжает в поток: по умолчанию само задание, копией
   */
  const run = (type, job, ship = null) => {
    if (!worker) return runInline(type, job);
    return new Promise((resolve, reject) => {
      sequence += 1;
      pending.set(sequence, { type, job, resolve, reject });
      try {
        const shipped = ship ? ship(job) : { job, transfer: [] };
        worker.postMessage(
          { id: sequence, type, job: shipped.job },
          shipped.transfer,
        );
      } catch {
        abandonWorker();
      }
    });
  };

  return {
    /**
     * Обработанная подложка плитки (`processBaseTile`). Пиксели плитки игрока
     * остаются у редактора для предпросмотра — в поток уезжает их копия, зато
     * без второго копирования на границе потоков.
     */
    processBase(job) {
      return run("base", job, (original) => {
        const data = new Uint8ClampedArray(original.pixels.data);
        return {
          job: { ...original, pixels: { ...original.pixels, data } },
          transfer: [data.buffer],
        };
      });
    },
    /** Сжатая плитка строкой base64 (`encodeTile`). */
    encode(job) {
      return run("encode", job);
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const [, entry] of pending)
        entry.reject(new Error("Сборка плиток карты прервана."));
      pending.clear();
    },
  };
}
