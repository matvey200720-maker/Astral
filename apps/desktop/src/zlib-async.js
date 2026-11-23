/*
 * zlib мимо главного потока (ТЗ 06.10.2026, вечер, задача 1).
 *
 * `deflateRawSync` уровня 9 на ресурсе модели в десяток мегабайт — полсекунды
 * главного потока (замер на ПК владельца: 456 мс на 12 МБ), и окно на это
 * время замирает. Асинхронный zlib Node считает то же самое в пуле потоков
 * libuv — байт в байт тот же результат.
 */

import zlib from "node:zlib";

export const deflateRawAsync = (bytes, options = {}) =>
  new Promise((resolve, reject) => zlib.deflateRaw(bytes, options, (error, out) => (error ? reject(error) : resolve(out))));

export const inflateRawAsync = (bytes, options = {}) =>
  new Promise((resolve, reject) => zlib.inflateRaw(bytes, options, (error, out) => (error ? reject(error) : resolve(out))));
