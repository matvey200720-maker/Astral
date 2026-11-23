/*
 * «Поставить» из студии (ТЗ 18.10.2026, Session 1, задача 6): итог студии —
 * картинка, что уходит в хранилище окна как своя картинка поверхности
 * (`saveFinishImage`, ключ `finish-image:<sha256>`) — тем же путём, каким
 * поверхность берёт любую загруженную картинку. Редактор после этого пишет её
 * в работу так же, как после «Загрузить картинку»: установщик и кадр о
 * студии ничего не знают.
 *
 * Хранилище картинок берёт не больше 8 МБ: лист 8089 × 1280 в PNG бывает
 * тяжелее, и тогда он едет WebP — сперва почти без потерь, ниже — понемногу
 * ужимается, пока не влезет.
 */

import { saveFinishImage } from "../finish/finish-assets.js";

export const PLACE_LIMIT_BYTES = 7.5 * 1024 * 1024;

async function reencode(blob, type, quality) {
  const bitmap = await createImageBitmap(blob);
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return typeof canvas.convertToBlob === "function" ? canvas.convertToBlob({ type, quality }) : new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Итог студии в границах хранилища: тот же PNG, если влезает, иначе WebP с убывающим качеством. */
export async function fitForStorage(blob, limit = PLACE_LIMIT_BYTES) {
  if (blob.size <= limit) return { blob, name: "studio.png" };
  for (const quality of [0.98, 0.94, 0.9, 0.84, 0.78]) {
    /* Окно без кодека WebP или без холста: сжать нечем — дальше та же понятная ошибка. */
    const smaller = await reencode(blob, "image/webp", quality).catch(() => null);
    if (smaller && smaller.size <= limit) return { blob: smaller, name: "studio.webp" };
  }
  throw new Error("Картинка студии тяжелее 8 МБ даже в WebP — уменьшите холст или упростите рисунок.");
}

/**
 * Итог студии → своя картинка поверхности: `{ asset, name, width, height }`
 * (`saveFinishImage`).
 */
export async function placeStudioImage(blob, name = "studio") {
  const { blob: body, name: file } = await fitForStorage(blob);
  const upload = typeof File === "function" ? new File([body], file.replace(/^studio/, name), { type: body.type }) : Object.assign(body, { name: file });
  return saveFinishImage(upload);
}
