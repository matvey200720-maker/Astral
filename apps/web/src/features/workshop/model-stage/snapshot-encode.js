/*
 * Кодирование снимка в WebP — в своём потоке (`snapshot-encode-worker.js`, оптимизация ночи 12.10.2026): `toBlob` окна сначала читал холст в
 * главном потоке — 190 мс на полку обложек. Битмап уходит в поток без копии. Нет потока или он не ответил — кодирует окно, как прежде.
 *
 * Отдельный лёгкий модуль: снимок работы (`works/work-covers.js`) зовут и редакторы без 3D-кадра — тянуть им `scene-snapshot.js` незачем.
 */

import { drawCover } from "./snapshot-draw.js";

let encoder = null;
let encodeId = 0;
const encoding = new Map();
const ENCODE_LIMIT_MS = 4000;

function encodeWorker() {
  if (encoder !== null) return encoder;
  encoder = false;
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function" || /jsdom/i.test(globalThis.navigator?.userAgent || "")) return encoder;
  try {
    const worker = new Worker(new URL("./snapshot-encode-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, url } = event.data || {};
      encoding.get(id)?.(typeof url === "string" ? url : null);
      encoding.delete(id);
    };
    worker.onerror = () => {
      encoder = false;
      for (const done of encoding.values()) done(null);
      encoding.clear();
    };
    encoder = worker;
  } catch {
    encoder = false;
  }
  return encoder;
}

function offThread(worker, bitmap, options) {
  const id = ++encodeId;
  return Promise.race([
    new Promise((resolve) => {
      encoding.set(id, resolve);
      worker.postMessage({ id, bitmap, ...options }, [bitmap]);
    }),
    new Promise((resolve) =>
      setTimeout(() => {
        encoding.delete(id);
        resolve(null);
      }, ENCODE_LIMIT_MS),
    ),
  ]);
}

/**
 * Битмап → WebP-адрес: в хранилище и в память идёт строка в десятки КБ.
 * `box` — кусок битмапа `[x, y, w, h]`, `size` — размер картинки `[w, h]`, `place` — куда кадр ложится в ней (поля — его цветом); без них картинка как есть.
 */
export async function encodeBitmapWebp(bitmap, { quality = 0.9, box = null, size = null, place = null } = {}) {
  const worker = encodeWorker();
  if (worker) {
    const url = await offThread(worker, bitmap, { quality, box, size, place }).catch(() => null);
    /* Битмап ушёл в поток (передан без копии) — второй попытки окном нет. */
    return typeof url === "string" && url.startsWith("data:image/") ? url : null;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  /* Среда без холста (тесты) — снимок не сохраняется. */
  if (!context) return null;
  const from = box || [0, 0, bitmap.width, bitmap.height];
  const to = size || [from[2], from[3]];
  canvas.width = to[0];
  canvas.height = to[1];
  drawCover(context, bitmap, { from, to, place });
  bitmap.close?.();
  let url = null;
  try {
    /* jsdom холст не кодирует вовсе: `toBlob` там не отвечает. */
    const asynchronous =
      typeof canvas.toBlob === "function" &&
      typeof FileReader === "function" &&
      !/jsdom/i.test(globalThis.navigator?.userAgent || "");
    const blob = asynchronous
      ? await Promise.race([
          new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality)),
          new Promise((resolve) => setTimeout(() => resolve(null), ENCODE_LIMIT_MS)),
        ])
      : null;
    url = blob
      ? await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        })
      : canvas.toDataURL("image/webp", quality);
  } catch {
    url = null;
  }
  canvas.width = 0;
  canvas.height = 0;
  return typeof url === "string" && url.startsWith("data:image/") ? url : null;
}
