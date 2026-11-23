/*
 * Своя картинка на мини-карте (задача 1 ТЗ 17.10.2026): файл человека →
 * лист кадров PNG в пределах мини-карты (`MINIMAP_OVERLAY_LIMITS`).
 *
 * Анимированный GIF (а с ним APNG и анимированный WebP) разбирает по кадрам
 * `ImageDecoder` окна — кадры уже сложены, как их показывает браузер; без
 * него GIF разбирает свой декодер (`gif-frames.js`). Кадров больше 48 —
 * соседние склеиваются, круг той же длины. Кадры ложатся сеткой (почти
 * квадрат), сторона кадра — до 512 точек, лист — до 512×512 точек: растры
 * фильма мини-карты игра держит в памяти всё время, пока виден радар.
 * Не уложился PNG в 900 КБ — лист мельчает, пока не уложится: так
 * картинка пройдёт и хранилище проекта, и установку (1 МБ на файл).
 */

import { MINIMAP_OVERLAY_LIMITS } from "@modovik/minimap-contract";
import { decodeGif, isGif } from "../../../../features/workshop/models/gif-frames.js";
import { tr } from "../../../../locales/ui.js";

export const OVERLAY_PICTURE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const OVERLAY_SHEET_MAX_BYTES = 900 * 1024;
const ANIMATED = new Set(["image/gif", "image/webp", "image/png", "image/apng"]);
/* Кадр без задержки браузеры держат 100 мс — так же и здесь. */
const DEFAULT_DELAY = 100;

const canvasOf = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

/* Кадры файла: `{ width, height, count, delays, draw(index, context, x, y, w, h), close }`. */
async function readFrames(file, bytes) {
  const type = String(file.type || "").toLowerCase();
  const Decoder = globalThis.ImageDecoder;
  if (typeof Decoder === "function" && ANIMATED.has(type)) {
    let decoder = null;
    try {
      if (await Decoder.isTypeSupported(type)) {
        decoder = new Decoder({ data: bytes, type });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        const count = Math.max(1, track?.frameCount || 1);
        if (track?.animated && count > 1) {
          const delays = [];
          let width = 0;
          let height = 0;
          for (let index = 0; index < count; index += 1) {
            const { image } = await decoder.decode({ frameIndex: index });
            width ||= image.displayWidth || image.codedWidth;
            height ||= image.displayHeight || image.codedHeight;
            delays.push(Math.round((image.duration || 0) / 1000) || DEFAULT_DELAY);
            image.close();
          }
          const open = decoder;
          return {
            width,
            height,
            count,
            delays,
            async draw(index, context, x, y, w, h) {
              const { image } = await open.decode({ frameIndex: index });
              context.drawImage(image, x, y, w, h);
              image.close();
            },
            close: () => open.close(),
          };
        }
        decoder.close();
        decoder = null;
      }
    } catch {
      decoder?.close?.();
    }
  }
  if (isGif(bytes)) {
    const gif = decodeGif(bytes);
    if (gif.frames.length > 1) {
      const scratch = canvasOf(gif.width, gif.height);
      return {
        width: gif.width,
        height: gif.height,
        count: gif.frames.length,
        delays: gif.frames.map((frame) => frame.delay || DEFAULT_DELAY),
        async draw(index, context, x, y, w, h) {
          scratch.getContext("2d").putImageData(new ImageData(gif.frames[index].rgba, gif.width, gif.height), 0, 0);
          context.drawImage(scratch, x, y, w, h);
        },
        close: () => {},
      };
    }
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type || "image/png" }));
  return {
    width: bitmap.width,
    height: bitmap.height,
    count: 1,
    delays: [],
    async draw(index, context, x, y, w, h) {
      context.drawImage(bitmap, x, y, w, h);
    },
    close: () => bitmap.close?.(),
  };
}

/**
 * Какие кадры файла берутся в лист и сколько держится каждый: не больше
 * `MINIMAP_OVERLAY_LIMITS.frames`, лишние склеиваются с соседями.
 */
export function pickOverlayFrames(count, delays) {
  const limit = MINIMAP_OVERLAY_LIMITS.frames;
  if (count <= limit) return { indices: Array.from({ length: count }, (_, index) => index), delays: [...delays] };
  const indices = [];
  const merged = [];
  for (let slot = 0; slot < limit; slot += 1) {
    const from = Math.floor((slot * count) / limit);
    const to = Math.floor(((slot + 1) * count) / limit);
    indices.push(from);
    let sum = 0;
    for (let index = from; index < to; index += 1) sum += delays[index] || DEFAULT_DELAY;
    merged.push(sum);
  }
  return { indices, delays: merged };
}

/** Размер кадра в пределах мини-карты: сторона и лист. */
export function fitOverlayFrame(width, height, frames, shrink = 1) {
  const L = MINIMAP_OVERLAY_LIMITS;
  const scale =
    Math.min(1, L.frameSide[1] / Math.max(width, height), Math.sqrt(L.sheetPixels / (width * height * frames))) * shrink;
  return {
    frameWidth: Math.max(L.frameSide[0], Math.floor(width * scale)),
    frameHeight: Math.max(L.frameSide[0], Math.floor(height * scale)),
  };
}

const pngOf = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(tr("Лист кадров не сохранился.")))), "image/png"),
  );

/**
 * Файл человека → `{ blob, image }`: `blob` — лист кадров PNG, `image` — то,
 * что ложится в проект (`frameWidth`, `frameHeight`, `frames`, `columns`,
 * `delays`, `name`).
 */
export async function prepareOverlayPicture(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let source;
  try {
    source = await readFrames(file, bytes);
  } catch {
    throw new Error(tr("Картинка не открылась. Возьмите PNG, JPG, WebP или GIF."));
  }
  try {
    const picked = pickOverlayFrames(source.count, source.delays);
    const frames = picked.indices.length;
    const columns = Math.ceil(Math.sqrt(frames));
    const rows = Math.ceil(frames / columns);
    for (let attempt = 0, shrink = 1; attempt < 6; attempt += 1, shrink *= 0.8) {
      const { frameWidth, frameHeight } = fitOverlayFrame(source.width, source.height, frames, shrink);
      const canvas = canvasOf(columns * frameWidth, rows * frameHeight);
      const context = canvas.getContext("2d");
      for (const [slot, index] of picked.indices.entries())
        await source.draw(index, context, (slot % columns) * frameWidth, Math.floor(slot / columns) * frameHeight, frameWidth, frameHeight);
      const blob = await pngOf(canvas);
      if (blob.size > OVERLAY_SHEET_MAX_BYTES) continue;
      return {
        blob,
        image: {
          frameWidth,
          frameHeight,
          frames,
          columns,
          delays: frames > 1 ? picked.delays : [],
          name: String(file.name || "").slice(0, 80),
        },
      };
    }
    throw new Error(tr("Картинка слишком пёстрая для мини-карты: возьмите поменьше или с меньшим числом кадров."));
  } finally {
    source.close?.();
  }
}
