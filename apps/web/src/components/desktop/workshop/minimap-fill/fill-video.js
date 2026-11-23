/*
 * Своё видео для заливки полосы HP или брони (задача 8 ТЗ 05.10.2026).
 *
 * Игре нужен не ролик, а лист кадров: компилятор кладёт его в minimap.gfx
 * растром, и полоса показывает кадр за кадром (`fillVideoTimeline`). Поэтому
 * окно само превращает файл человека в лист PNG под предел мини-карты —
 * «автосжатие»: сперва кадры снимаются один раз в лучшем виде (30 кадров в
 * секунду, до трёх секунд, 192 точки в длину), потом лесенка сжатия
 * убавляет частоту, длительность, длину и число цветов, пока лист не
 * уложится в предел. Что пришлось убавить, окно говорит словами.
 *
 * Читается всё, что умеет показать окно: MP4 (H.264), WebM, MOV — через
 * <video>, GIF, анимированный WebP и APNG — через `ImageDecoder`.
 */

import { MINIMAP_FILL_VIDEO } from "@modovik/minimap-contract";
import { tr } from "../../../../locales/ui.js";

export const FILL_VIDEO_ACCEPT =
  "video/mp4,video/webm,video/quicktime,image/gif,image/webp,image/png,image/apng";
/* Ролик целиком в память не грузится — кадры берутся с диска поиском. */
const MAX_FILE_BYTES = 512 * 1024 * 1024;
/* Лист уходит в главный процесс одной картинкой (предел — 1 МБ). */
export const FILL_SHEET_MAX_BYTES = 900 * 1024;
/* Высота кадра: полоса в игре — 6–10 точек экрана, двенадцать — с запасом. */
const FRAME_HEIGHT = 12;

/*
 * Лесенка сжатия: первая ступень, что уложилась в предел, и уходит в
 * игру. Кадров не больше 90, точек листа — не больше `maxPixels`.
 */
export const FILL_VIDEO_LADDER = Object.freeze([
  Object.freeze({ fps: 30, seconds: 3, width: 192, levels: 256 }),
  Object.freeze({ fps: 24, seconds: 3, width: 192, levels: 256 }),
  Object.freeze({ fps: 20, seconds: 3, width: 192, levels: 64 }),
  Object.freeze({ fps: 15, seconds: 3, width: 160, levels: 64 }),
  Object.freeze({ fps: 15, seconds: 2, width: 160, levels: 32 }),
  Object.freeze({ fps: 12, seconds: 2, width: 128, levels: 32 }),
  Object.freeze({ fps: 10, seconds: 2, width: 128, levels: 16 }),
  Object.freeze({ fps: 10, seconds: 1.5, width: 96, levels: 16 }),
]);

const canvasOf = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

/*
 * Откуда брать кадр: `band` — полоса из середины кадра в пропорции полосы
 * (видно сам ролик, а не размазанные полосы), `squeeze` — кадр целиком,
 * сжатый в полосу.
 */
function sourceRect(width, height, aspect, fit) {
  if (fit === "squeeze") return { x: 0, y: 0, width, height };
  const bandHeight = width / aspect;
  if (bandHeight <= height)
    return { x: 0, y: (height - bandHeight) / 2, width, height: bandHeight };
  const bandWidth = height * aspect;
  return { x: (width - bandWidth) / 2, y: 0, width: bandWidth, height };
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      reject(new Error(tr("Видео не перематывается — возможно, файл повреждён.")));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = time;
  });
}

/* Кадры ролика через <video>: `count` кадров через `step` секунд. */
async function captureVideo(file, { count, step, draw, onProgress }) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () =>
        reject(new Error(tr("Окно не читает это видео. Возьмите MP4 (H.264) или WebM.")));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const frames = Math.max(1, Math.min(count, Math.floor(duration / step) || 1));
    for (let index = 0; index < frames; index += 1) {
      await seek(video, Math.min(Math.max(0, duration - 0.001), index * step));
      draw(video, video.videoWidth, video.videoHeight, index);
      onProgress?.((index + 1) / frames);
    }
    return { frames, duration };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/* Кадры гифки или анимированной картинки через ImageDecoder — по времени. */
async function captureAnimatedImage(file, { count, step, draw, onProgress }) {
  const Decoder = globalThis.ImageDecoder;
  const type = String(file.type || "").toLowerCase();
  if (typeof Decoder !== "function" || !(await Promise.resolve(Decoder.isTypeSupported?.(type)).catch(() => false)))
    throw new Error(tr("Эту картинку окно не разбирает по кадрам. Возьмите GIF, WebP или видео."));
  const decoder = new Decoder({ data: await file.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    const total = Math.max(1, Math.min(1500, decoder.tracks.selectedTrack?.frameCount || 1));
    /* Кадр картинки на каждый момент листа: держится, пока не сменится. */
    let decoded = 0;
    let time = 0;
    let current = (await decoder.decode({ frameIndex: 0 })).image;
    let ends = (current.duration || 100_000) / 1e6;
    let frames = 0;
    for (let index = 0; index < count; index += 1) {
      const at = index * step;
      while (at >= ends && decoded + 1 < total) {
        decoded += 1;
        current.close?.();
        current = (await decoder.decode({ frameIndex: decoded })).image;
        time = ends;
        ends = time + (current.duration || 100_000) / 1e6;
      }
      if (at >= ends && decoded + 1 >= total && index > 0) break;
      draw(current, current.displayWidth || current.codedWidth, current.displayHeight || current.codedHeight, index);
      frames += 1;
      onProgress?.((index + 1) / count);
    }
    current.close?.();
    return { frames, duration: ends };
  } finally {
    decoder.close?.();
  }
}

/* Число уровней на канал: меньше уровней — лист сжимается лучше. */
function posterize(context, width, height, levels) {
  if (levels >= 256) return;
  const image = context.getImageData(0, 0, width, height);
  const step = 255 / (levels - 1);
  for (let offset = 0; offset < image.data.length; offset += 4)
    for (let channel = 0; channel < 3; channel += 1)
      image.data[offset + channel] = Math.round(Math.round(image.data[offset + channel] / step) * step);
  context.putImageData(image, 0, 0);
}

const pngOf = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(tr("Лист кадров не сохранился.")))), "image/png"),
  );

/**
 * Что лесенка убавила — частями: подпись под видео собирает панель на языке окна
 * (`minimap-lang.js`: `noteFps`, `noteSeconds`, `noteWidth`, `noteLevels`).
 */
export function describeFillCompression(rung, source) {
  const notes = [];
  if (rung.fps < 30) notes.push({ kind: "noteFps", value: rung.fps });
  if (source.duration > rung.seconds + 0.05) notes.push({ kind: "noteSeconds", value: rung.seconds });
  if (rung.width < 192) notes.push({ kind: "noteWidth", value: rung.width });
  if (rung.levels < 256) notes.push({ kind: "noteLevels", value: rung.levels });
  return notes;
}

/**
 * Файл → лист кадров для заливки. `aspect` — длина полосы к толщине (полоса
 * из середины кадра берётся в этой пропорции), `fit` — `band` или
 * `squeeze`. Ответ: `{ blob, video, notes }`; `video` — поля договора без
 * `assetId` (он появится, когда лист ляжет в проект).
 */
export async function prepareFillVideo(file, { aspect = 14, fit = "band", onProgress } = {}) {
  if (!file) throw new Error(tr("Файл не выбран."));
  if (file.size > MAX_FILE_BYTES) throw new Error(tr("Видео больше 512 МБ — возьмите короткий отрывок."));
  const best = FILL_VIDEO_LADDER[0];
  const step = 1 / best.fps;
  const count = Math.round(best.fps * best.seconds);
  /* Кадры в лучшем виде — один раз: ступени лесенки делаются из них. */
  const frames = canvasOf(best.width, FRAME_HEIGHT * count);
  const frameContext = frames.getContext("2d", { willReadFrequently: true });
  frameContext.imageSmoothingQuality = "high";
  const draw = (source, width, height, index) => {
    const rect = sourceRect(width, height, aspect, fit);
    frameContext.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, index * FRAME_HEIGHT, best.width, FRAME_HEIGHT);
  };
  const isVideo = String(file.type || "").startsWith("video/");
  const captured = await (isVideo ? captureVideo : captureAnimatedImage)(file, {
    count,
    step,
    draw,
    onProgress: (share) => onProgress?.(share * 0.85),
  });
  if (!captured.frames) throw new Error(tr("В файле не нашлось ни одного кадра."));
  const sourceSeconds = captured.frames / best.fps;
  for (const rung of FILL_VIDEO_LADDER) {
    const seconds = Math.min(rung.seconds, sourceSeconds);
    const total = Math.max(1, Math.min(MINIMAP_FILL_VIDEO.maxFrames, Math.round(seconds * rung.fps)));
    if (rung.width * FRAME_HEIGHT * total > MINIMAP_FILL_VIDEO.maxPixels) continue;
    const sheet = canvasOf(rung.width, FRAME_HEIGHT * total);
    const context = sheet.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingQuality = "high";
    for (let index = 0; index < total; index += 1) {
      /* Кадр лучшего снимка, ближайший по времени. */
      const from = Math.min(captured.frames - 1, Math.round((index / rung.fps) * best.fps));
      context.drawImage(frames, 0, from * FRAME_HEIGHT, best.width, FRAME_HEIGHT, 0, index * FRAME_HEIGHT, rung.width, FRAME_HEIGHT);
    }
    posterize(context, sheet.width, sheet.height, rung.levels);
    const blob = await pngOf(sheet);
    if (blob.size > FILL_SHEET_MAX_BYTES) continue;
    onProgress?.(1);
    return {
      blob,
      video: {
        frames: total,
        fps: rung.fps,
        width: rung.width,
        height: FRAME_HEIGHT,
        name: String(file.name || tr("видео")).slice(0, 80),
      },
      noteParts: describeFillCompression({ ...rung, seconds }, { duration: captured.duration }),
      bytes: blob.size,
    };
  }
  throw new Error(
    tr("Даже после сжатия видео не помещается в мини-карту (900 КБ): возьмите отрывок короче или спокойнее."),
  );
}
