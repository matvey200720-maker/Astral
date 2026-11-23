/*
 * Своя картинка человека → пиксели.
 *
 * Контракт залазов принимает картинку одним видом — `{ width, height, rgba }`,
 * — и не знает, откуда она взялась. Здесь единственное место, которое знает:
 * файл лежит в хранилище проекта, PNG и JPEG разбирает браузер, а DDS —
 * собственный кодек, потому что браузер про DXT не знает ничего.
 *
 * Любой отказ здесь — это `null`, а не исключение: картинка не открылась —
 * редактор рисует обычную стрелку и говорит об этом строкой в инспекторе.
 * Ронять окно из-за чужого файла нельзя, его приносят как раз тогда, когда
 * не уверены, что он подойдёт.
 */

import { decodeDds } from "@modovik/dds";
import {
  getWorkshopAsset,
  workshopBlobBytes,
} from "../../../components/desktop/workshop/workshop-assets.js";
import { context2d } from "../../../components/desktop/workshop/effects-preview.js";

/** Сторона, до которой ужимается принесённая картинка перед разбором. */
const MAX_SIDE = 1024;

/**
 * Размер картинки после ужатия: длинная сторона — не больше `max`, пропорции
 * те же. Прежде каждая сторона обрезалась до 1024 отдельно, и фотография
 * 4032×3024 ложилась в метку сплющенным квадратом 1024×1024.
 */
export function fitClimbImage(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const isDds = (asset) =>
  String(asset?.extension || "").toLowerCase() === "dds" ||
  /\.dds$/i.test(String(asset?.name || ""));

async function pixelsFromBitmap(blob) {
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  )
    return null;
  const bitmap = await createImageBitmap(blob);
  const { width, height } = fitClimbImage(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = context2d(canvas);
  if (!context) {
    bitmap.close?.();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const image = context.getImageData(0, 0, width, height);
  return { width, height, rgba: new Uint8ClampedArray(image.data) };
}

async function pixelsFromDds(blob) {
  const decoded = decodeDds(await workshopBlobBytes(blob));
  const level = decoded.levels[0];
  return level
    ? { width: level.width, height: level.height, rgba: level.rgba }
    : null;
}

/**
 * Пиксели файла проекта или `null`.
 *
 * `asset` — запись из `project.assets`; без неё и без ключа хранилища читать
 * нечего, и это обычное состояние «картинку ещё не принесли».
 */
export async function loadClimbImage(asset) {
  if (!asset?.storageKey) return null;
  try {
    const blob = await getWorkshopAsset(asset.storageKey);
    if (!blob) return null;
    return isDds(asset)
      ? await pixelsFromDds(blob)
      : await pixelsFromBitmap(blob);
  } catch {
    return null;
  }
}
