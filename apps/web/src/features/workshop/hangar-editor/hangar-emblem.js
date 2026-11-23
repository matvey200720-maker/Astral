/*
 * Эмблема ангара — картинка человека в хранилище окна.
 *
 * Картинка живёт там же, где свои картинки других редакторов (IndexedDB
 * мастерской, `workshop-assets.js`), под своим отпечатком:
 * `hangar-emblem:<sha256>`. В работе — только этот ключ, имя и размер:
 * работа остаётся лёгкой строкой, а одна и та же картинка не копится в
 * хранилище дважды. В код для друга картинка не едет — у него встанет
 * ангар без эмблемы, о чём код и говорит.
 *
 * В главный процесс картинка уходит base64-строкой (`images.emblems[asset].data`,
 * `emblem-items.js`) — вход канала проходит через JSON, как у залазов и знака
 * на килле.
 */

import { useEffect, useState } from "react";
import {
  getWorkshopAsset,
  prepareWorkshopAsset,
  putWorkshopAsset,
} from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";

/*
 * Что принимается. Картинка любого из этих форматов и размера (до 64 МБ
 * файла) приводится к безопасному виду сама (`safeImage`): не больше
 * 2048 px по длинной стороне, PNG (если есть прозрачность) или JPEG, файл до
 * 8 МБ. Так в игру не уходит ни огромная, ни «странная» картинка — дальше
 * её всё равно ужимают сборщики (лист 512² DXT5 звезды, плашки эмблем), но
 * уже из ровного PNG/JPEG.
 */
export const HANGAR_EMBLEM_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "avif"]);
export const HANGAR_EMBLEM_ACCEPT = "image/png,image/jpeg,image/webp,image/bmp,image/gif,image/avif";
const STORED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_STORED_BYTES = 8 * 1024 * 1024;
export const SAFE_IMAGE_SIDE = 2048;

/*
 * Картинка, что хранится ужатой до `SAFE_IMAGE_SIDE` (эмблемы и всё, что едет
 * плашкой), и картинка широкой стены здания (задача 6Б ТЗ 18.10.2026): Мега
 * Молл — 8178 × 1389, в игру она идёт панелями (`buildingSideUsesPanels`),
 * поэтому хранится до 8192 px и 20 МБ (`WALL_IMAGE_LIMIT` главного процесса).
 */
export const STORED_IMAGE_LIMITS = Object.freeze({ side: SAFE_IMAGE_SIDE, bytes: MAX_STORED_BYTES });
export const WALL_IMAGE_LIMITS = Object.freeze({ side: 8192, bytes: 20 * 1024 * 1024 });

/* Картинка → растр (с поворотом по EXIF у фото с телефона) или `null`. */
async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      /* формат, которого браузер не знает, — пробуем через <img> */
    }
  }
  if (typeof Image === "undefined" || typeof URL?.createObjectURL !== "function") return null;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Картинка не читается — нужен PNG, JPEG, WebP, BMP, GIF или AVIF."));
    };
    image.src = url;
  });
}

const sizeOf = (image) => ({ width: image?.naturalWidth || image?.width || 0, height: image?.naturalHeight || image?.height || 0 });

function canvasOf(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/*
 * Есть ли в картинке прозрачность — по копии не больше 512 px на отдельном холсте для чтения. Чтение пикселей всего холста 2048 px держало главный поток 80–170 мс
 * (замер 31.10.2026); при уменьшении дырка в пиксель всё равно опускает альфу усреднённого пикселя ниже порога. Холста для чтения нет (тесты) — как раньше, по готовому холсту.
 */
function hasTransparency(image, width, height, fallback) {
  const scale = Math.min(1, 512 / Math.max(width, height));
  const probeWidth = Math.max(1, Math.round(width * scale));
  const probeHeight = Math.max(1, Math.round(height * scale));
  const probe = canvasOf(probeWidth, probeHeight);
  const reader = probe?.getContext?.("2d", { willReadFrequently: true });
  if (reader) reader.drawImage(image, 0, 0, probeWidth, probeHeight);
  const pixels = reader ? reader.getImageData(0, 0, probeWidth, probeHeight).data : fallback.getImageData(0, 0, width, height).data;
  for (let at = 3; at < pixels.length; at += 4) if (pixels[at] < 250) return true;
  return false;
}

/*
 * Фоновый поток картинки (`image-safe-worker.js`; владелец 31.10.2026: фото с телефона 2268 × 4032 — окно «ужасно пролагивало»):
 * разбор, уменьшение, проверка прозрачности и сжатие идут там, главный поток только ждёт ответа. Без `Worker` (тесты, старый
 * браузер), без `OffscreenCanvas` в потоке и при сбое — `null`, и картинку разбирает главный поток, как раньше.
 */
const work = { worker: null, seq: 0, pending: new Map() };

function imageWorker() {
  if (work.worker !== null) return work.worker;
  if (typeof Worker !== "function") return (work.worker = false);
  try {
    work.worker = new Worker(new URL("./image-safe-worker.js", import.meta.url), { type: "module" });
  } catch {
    return (work.worker = false);
  }
  work.worker.onmessage = (event) => {
    const { id, error, out } = event.data || {};
    const job = work.pending.get(id);
    if (!job) return;
    work.pending.delete(id);
    job.resolve(error ? null : out);
  };
  work.worker.onerror = () => {
    for (const job of work.pending.values()) job.resolve(null);
    work.pending.clear();
    work.worker = false;
  };
  return work.worker;
}

function imageJob(message) {
  const worker = imageWorker();
  if (!worker) return Promise.resolve(null);
  const id = (work.seq += 1);
  return new Promise((resolve) => {
    work.pending.set(id, { resolve });
    worker.postMessage({ id, ...message });
  });
}

/**
 * Пиксели картинки-файла не больше `side` по длинной стороне — `{ rgba, width, height }`, разобранные в фоновом потоке;
 * `null` — потока нет или он не справился (тогда пиксели читает тот, кто звал, сам).
 */
export const imageBlobPixels = (blob, side) => imageJob({ op: "pixels", blob, side });

/* Готовый файл копии: имя — прежнее с новым расширением. */
function convertedFile(file, blob, type) {
  const ext = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
  const base = String(file.name || tr("картинка")).replace(/\.[^.]+$/, "") || tr("картинка");
  const name = `${base}.${ext}`;
  return { file: typeof File === "function" ? new File([blob], name, { type }) : Object.assign(blob, { name }), ext };
}

/*
 * Безопасная копия картинки: `{ file, width, height, converted }`.
 * `converted` — `{ from: [w, h], to: [w, h], type }`, если картинку пришлось
 * уменьшить или перевести в другой формат.
 */
async function safeImage(file, extension, limits = STORED_IMAGE_LIMITS) {
  const done = await imageJob({ op: "safe", blob: file, extension, limits: { side: limits.side, bytes: limits.bytes } });
  if (done?.empty) throw new Error("Картинка пустая.");
  if (done?.tooLarge) throw new Error(`Картинка не ужимается до ${Math.round(limits.bytes / 1048576)} МБ — возьмите поменьше.`);
  if (done?.keep) return { file, width: done.width, height: done.height, converted: null };
  if (done?.blob) {
    const { file: safe, ext } = convertedFile(file, done.blob, done.type);
    return { file: safe, width: done.width, height: done.height, converted: { from: done.from, to: [done.width, done.height], type: ext.toUpperCase() } };
  }
  const image = await decodeImage(file);
  const { width, height } = sizeOf(image);
  if (!image) {
    /* Окно без растра (тесты): родной формат и размер идут как есть. */
    if (STORED_EXTENSIONS.has(extension) && Number(file.size || 0) <= limits.bytes) return { file, width: 0, height: 0, converted: null };
    throw new Error("Картинку не прочитать в этом окне.");
  }
  if (!width || !height) throw new Error("Картинка пустая.");
  const tooBig = Math.max(width, height) > limits.side;
  if (!tooBig && STORED_EXTENSIONS.has(extension) && Number(file.size || 0) <= limits.bytes) {
    image.close?.();
    return { file, width, height, converted: null };
  }
  const scale = Math.min(1, limits.side / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = canvasOf(outWidth, outHeight);
  const context = canvas?.getContext?.("2d");
  if (!context) throw new Error(`Картинку не уменьшить в этом окне — возьмите поменьше (до ${limits.side} px).`);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, outWidth, outHeight);
  const transparent = hasTransparency(image, outWidth, outHeight, context);
  image.close?.();
  /* Прозрачность есть — PNG (фигура звезды, логотип), нет — JPEG. */
  let type = transparent ? "image/png" : "image/jpeg";
  let blob = await canvasBlob(canvas, type, 0.92);
  if (!blob || blob.size > limits.bytes) {
    type = "image/webp";
    blob = await canvasBlob(canvas, type, 0.9);
  }
  if (!blob || blob.size > limits.bytes) throw new Error(`Картинка не ужимается до ${Math.round(limits.bytes / 1048576)} МБ — возьмите поменьше.`);
  const { file: safe, ext } = convertedFile(file, blob, type);
  return { file: safe, width: outWidth, height: outHeight, converted: { from: [width, height], to: [outWidth, outHeight], type: ext.toUpperCase() } };
}

/** Строка для человека: что стало с картинкой при загрузке, или `""`. */
export function convertedImageText(converted) {
  if (!converted) return "";
  const [fromW, fromH] = converted.from;
  const [toW, toH] = converted.to;
  const resized = fromW !== toW || fromH !== toH;
  return resized
    ? `Картинка уменьшена с ${fromW} × ${fromH} до ${toW} × ${toH} и сохранена в ${converted.type} — так она безопасна для игры.`
    : `Картинка переведена в ${converted.type} — так она безопасна для игры.`;
}

/**
 * Файл человека → эмблема в хранилище: `{ asset, name, width, height,
 * converted }`. Большая или «странная» картинка приводится к безопасному
 * виду сама; бросает понятной ошибкой только на нечитаемом файле.
 */
export async function saveHangarEmblem(file, limits = STORED_IMAGE_LIMITS) {
  if (Number(file?.size || 0) > MAX_INPUT_BYTES) throw new Error("Картинка больше 64 МБ — возьмите поменьше.");
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  if (!HANGAR_EMBLEM_EXTENSIONS.has(extension)) throw new Error("Нужна картинка: PNG, JPEG, WebP, BMP, GIF или AVIF.");
  const safe = await safeImage(file, extension, limits);
  const { blob, metadata } = await prepareWorkshopAsset(safe.file, { extensions: STORED_EXTENSIONS });
  let { width, height } = safe;
  if (!width || !height) ({ width, height } = sizeOf(await decodeImage(blob).catch(() => null)));
  if (!width || !height) throw new Error("Картинка пустая.");
  const asset = `hangar-emblem:${metadata.hash}`;
  await putWorkshopAsset(asset, blob);
  return { asset, name: safe.converted ? file.name : metadata.name, width, height, converted: safe.converted };
}

/** Картинка широкой стены здания (Мега Молл и другие): хранится до 8192 px и 20 МБ. */
export const saveWallImage = (file) => saveHangarEmblem(file, WALL_IMAGE_LIMITS);

/** Адрес картинки эмблемы для `<img>` и кадра; `""`, пока не прочитана. */
export function useHangarEmblemUrl(asset) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!asset) {
      setUrl("");
      return undefined;
    }
    let cancelled = false;
    let made = "";
    getWorkshopAsset(asset)
      .then((blob) => {
        if (cancelled || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [asset]);
  return url;
}
