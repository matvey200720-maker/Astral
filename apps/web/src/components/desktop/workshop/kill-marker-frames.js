/*
 * Кадры знака на килле — в окне.
 *
 * Одна и та же картинка нужна дважды: холстами — предпросмотру, чтобы
 * показать, как знак выскочит над прицелом, и байтами — установщику, чтобы
 * собрать из них текстуры `astral_kill_NN` в hud_reticle.ytd. Обе формы
 * берутся из одних кадров: разъедься они — человек увидел бы в окне одно,
 * а в игре другое.
 *
 * Кадр — квадрат 256×256 с прозрачными полями, картинка вписана целиком.
 * Значок рисуется контуром приложения, эмодзи — системным шрифтом этого
 * компьютера (в поставке Astral чужих эмодзи нет), надпись — жирным шрифтом
 * с обводкой, своя картинка — из файла человека. Гифка, анимированный WebP и
 * APNG разбираются по кадрам (`ImageDecoder`), до тридцати двух кадров: у
 * длинной гифки кадры прореживаются по времени, и её круг длится столько же.
 *
 * Своя картинка живёт в хранилище мастерской (IndexedDB) под отпечатком
 * своих кадров: так её находит и черновик после перезапуска, и сохранённая
 * работа, а код работы её не везёт — картинка — это файл человека.
 */

import {
  KILL_MARKER_EDGE,
  KILL_MARKER_MAX_FRAMES,
  killMarkerSourceKey,
  normalizeFrameDelays,
} from "@modovik/kill-effects";
import { IMPACT_PICTURE_SHAPES } from "@modovik/ptfx-studio/pictures.js";
import { getWorkshopAsset, putWorkshopAsset } from "./workshop-assets.js";
import { tr } from "../../../locales/ui.js";

const EDGE = KILL_MARKER_EDGE;
const ASSET_PREFIX = "kill-marker:";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
/* Поле вокруг картинки в кадре: знак не должен упираться в край текстуры —
   иначе сглаживание на повороте обрезает его по квадрату. */
const INSET = 0.06;

export const KILL_MARKER_FILE_TYPES = Object.freeze([
  "image/png",
  "image/gif",
  "image/webp",
  "image/jpeg",
]);

/* Значки сверх набора эффектов попадания: корона, огонь и прицел — их чаще
   всего ставят на килл. Поле то же, 24×24, чтобы рисовались одинаково. */
const KILL_GLYPHS = Object.freeze({
  crown: {
    fill: [
      "M3 7.5l4.6 4.1L12 4l4.4 7.6L21 7.5 19.3 17H4.7z",
      "M4.7 18.4h14.6v2.1H4.7z",
    ],
    stroke: [],
    detail: [],
  },
  flame: {
    fill: [
      "M12 2c.9 3.9-3.2 5.6-3.2 9.6A3.2 3.2 0 0 0 12 14.8a3.2 3.2 0 0 0 3.2-3.2c0-1.6-.8-2.8-1.5-3.7 2.8 1.4 4.8 4.2 4.8 7.3A6.5 6.5 0 0 1 12 21.7a6.5 6.5 0 0 1-6.5-6.5C5.5 9.6 11 7.3 12 2z",
    ],
    stroke: [],
    detail: [],
  },
  crosshair: {
    fill: [],
    stroke: [
      "M12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6z",
      "M12 2v5.4M12 16.6V22M2 12h5.4M16.6 12H22",
    ],
    detail: [],
    strokeWidth: 2.2,
  },
});

const glyphOf = (id) => KILL_GLYPHS[id] || IMPACT_PICTURE_SHAPES[id] || IMPACT_PICTURE_SHAPES.skull;

/** Значок знака: белая заливка его цветом и тёмная кайма, как у эффектов. */
export function killMarkerIconSvg(id, colour = "#ffffff", size = EDGE) {
  const shape = glyphOf(id);
  const view = 24;
  const margin = view * INSET * 2;
  const scale = size / (view + margin * 2);
  const offset = margin * scale;
  const rim =
    'stroke="#000000" stroke-opacity="0.6" stroke-linejoin="round" stroke-linecap="round"';
  const width = shape.strokeWidth || 2.4;
  const paths = (list, attributes) =>
    (list || []).map((d) => `<path d="${d}" ${attributes}/>`).join("");
  const rule = shape.fillRule ? ` fill-rule="${shape.fillRule}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">` +
    paths(shape.fill, `fill="none" ${rim} stroke-width="3"`) +
    paths(shape.stroke, `fill="none" ${rim} stroke-width="${width + 3}"`) +
    paths(shape.fill, `fill="${colour}"${rule}`) +
    paths(
      shape.stroke,
      `fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`,
    ) +
    paths(shape.detail, 'fill="#000000" fill-opacity="0.6"') +
    "</g></svg>"
  );
}

function blankFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = EDGE;
  canvas.height = EDGE;
  return canvas;
}

const frameContext = (canvas) =>
  canvas.getContext("2d", { willReadFrequently: true });

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(tr("Картинка не читается")));
    image.src = source;
  });
}

async function iconFrame(source) {
  const svg = killMarkerIconSvg(source.icon, source.colour);
  const image = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
  const canvas = blankFrame();
  frameContext(canvas)?.drawImage(image, 0, 0, EDGE, EDGE);
  return canvas;
}

const EMOJI_FONT =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const TEXT_FONT = '"Segoe UI", "Arial Black", Arial, sans-serif';

/* Строка по центру кадра, вписанная в поле: кегль подбирается по ширине
   и высоте набора, а не ставится числом. */
function fitText(context, text, family, weight) {
  const room = EDGE * (1 - INSET * 2);
  let size = room;
  context.font = `${weight} ${size}px ${family}`;
  const measure = () => {
    const metrics = context.measureText(text);
    const height =
      (metrics.actualBoundingBoxAscent || size * 0.8) +
      (metrics.actualBoundingBoxDescent || size * 0.2);
    return { width: metrics.width, height, metrics };
  };
  let { width, height } = measure();
  const fit = Math.min(room / Math.max(1, width), room / Math.max(1, height), 1);
  size = Math.max(8, Math.floor(size * fit));
  context.font = `${weight} ${size}px ${family}`;
  const { metrics } = measure();
  const ascent = metrics.actualBoundingBoxAscent || size * 0.8;
  const descent = metrics.actualBoundingBoxDescent || size * 0.2;
  const left = metrics.actualBoundingBoxLeft || 0;
  const right = metrics.actualBoundingBoxRight || metrics.width;
  return {
    size,
    x: EDGE / 2 - (right - left) / 2 + left,
    y: EDGE / 2 + (ascent - descent) / 2,
  };
}

function emojiFrame(source) {
  const canvas = blankFrame();
  const context = frameContext(canvas);
  if (!context) return canvas;
  const place = fitText(context, source.emoji, EMOJI_FONT, "400");
  context.textBaseline = "alphabetic";
  context.fillText(source.emoji, place.x, place.y);
  return canvas;
}

function textFrame(source) {
  const canvas = blankFrame();
  const context = frameContext(canvas);
  if (!context) return canvas;
  const place = fitText(context, source.text, TEXT_FONT, "900");
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.lineWidth = Math.max(4, place.size * 0.14);
  context.strokeStyle = source.outline;
  context.strokeText(source.text, place.x, place.y);
  context.fillStyle = source.colour;
  context.fillText(source.text, place.x, place.y);
  return canvas;
}

/* ------------------------------------------------ своя картинка и гифка */

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/*
 * Какие кадры гифки оставить: не больше тридцати двух, равномерно по
 * времени, а задержка оставленного кадра — сумма задержек тех, что он
 * заменил. Круг гифки длится столько же, сколько в оригинале.
 */
export function sampleFrames(delays) {
  /* Задержки — как их понимает браузер (`normalizeFrameDelays`): короче
     20 мс — сотая доля секунды. */
  const all = delays.map((delay) => {
    const numeric = Number(delay);
    return Number.isFinite(numeric) && numeric >= 20
      ? Math.min(Math.round(numeric), 5000)
      : 100;
  });
  if (all.length <= KILL_MARKER_MAX_FRAMES)
    return all.map((delay, index) => ({ index, delay }));
  return sampledIndices(all.length).map((from, slot, list) => {
    const to = list[slot + 1] ?? all.length;
    return {
      index: from,
      delay: Math.min(
        5000,
        all.slice(from, to).reduce((sum, delay) => sum + delay, 0),
      ),
    };
  });
}

/* Номера оставленных кадров из `count`: равномерно, первый — всегда. */
function sampledIndices(count) {
  if (count <= KILL_MARKER_MAX_FRAMES)
    return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: KILL_MARKER_MAX_FRAMES }, (_, slot) =>
    Math.floor((slot * count) / KILL_MARKER_MAX_FRAMES),
  );
}

/* Общая рамка кадров по непрозрачному: поля вокруг картинки — пустое место
   в текстуре, и после обрезки знак крупнее при том же размере. */
function contentBounds(canvases) {
  let left = EDGE;
  let top = EDGE;
  let right = -1;
  let bottom = -1;
  for (const canvas of canvases) {
    const context = frameContext(canvas);
    const data = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) continue;
    for (let y = 0; y < canvas.height; y += 1)
      for (let x = 0; x < canvas.width; x += 1)
        if (data[(y * canvas.width + x) * 4 + 3] > 8) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
  }
  if (right < left || bottom < top) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function framed(sources, width, height) {
  /* Сначала — вписать каждый кадр в квадрат как есть, затем обрезать всё по
     общей рамке содержимого и вписать ещё раз: картинка не прыгает между
     кадрами, а поля уходят. */
  const scale = Math.min(EDGE / width, EDGE / height);
  const drawn = sources.map((source) => {
    const canvas = blankFrame();
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    frameContext(canvas)?.drawImage(source, (EDGE - w) / 2, (EDGE - h) / 2, w, h);
    return canvas;
  });
  const bounds = contentBounds(drawn);
  if (!bounds) return drawn;
  const room = EDGE * (1 - INSET * 2);
  const fit = Math.min(room / bounds.width, room / bounds.height);
  return drawn.map((canvas) => {
    const result = blankFrame();
    const w = bounds.width * fit;
    const h = bounds.height * fit;
    frameContext(result)?.drawImage(
      canvas,
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
      (EDGE - w) / 2,
      (EDGE - h) / 2,
      w,
      h,
    );
    return result;
  });
}

/* Кадров в файле больше этого не разбирается: гифка на несколько тысяч
   кадров — это видео, и ждать её разбора человеку незачем. */
const MAX_DECODED_FRAMES = 1500;

async function decodeAnimated(file) {
  const Decoder = globalThis.ImageDecoder;
  if (typeof Decoder !== "function") return null;
  const type = String(file.type || "").toLowerCase();
  const supported = await Promise.resolve(Decoder.isTypeSupported?.(type)).catch(
    () => false,
  );
  if (!supported) return null;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type });
  const kept = [];
  try {
    await decoder.tracks.ready;
    const count = Math.min(
      MAX_DECODED_FRAMES,
      Math.max(1, decoder.tracks.selectedTrack?.frameCount || 1),
    );
    /* Длительности знает только декодер, поэтому разбираются все кадры, а
       в памяти остаются только те, что уйдут в знак. */
    const wanted = new Set(sampledIndices(count));
    const delays = [];
    for (let index = 0; index < count; index += 1) {
      const { image } = await decoder.decode({ frameIndex: index });
      delays.push((image.duration || 100_000) / 1000);
      if (wanted.has(index)) kept.push(image);
      else image.close?.();
    }
    const width = kept[0].displayWidth || kept[0].codedWidth;
    const height = kept[0].displayHeight || kept[0].codedHeight;
    const picked = sampleFrames(delays);
    return {
      canvases: framed(kept, width, height),
      delays: picked.map((item) => item.delay),
    };
  } finally {
    for (const image of kept) image.close?.();
    decoder.close?.();
  }
}

async function decodeStill(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return {
      canvases: framed([image], image.naturalWidth || image.width, image.naturalHeight || image.height),
      delays: [100],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasPng = (canvas) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(tr("Кадр не сжался")))),
      "image/png",
    );
  });

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/**
 * Файл человека → знак: `{ source, sequence }`. Картинка ложится в
 * хранилище мастерской под отпечатком своих кадров и дальше находится по
 * нему — в черновике, в сохранённой работе, после перезапуска.
 */
export async function importKillMarkerFile(file) {
  if (!file) throw new Error(tr("Выберите картинку или гифку"));
  if (file.size > MAX_FILE_BYTES)
    throw new Error(tr("Файл больше 16 МБ — возьмите поменьше"));
  if (file.type && !KILL_MARKER_FILE_TYPES.includes(String(file.type).toLowerCase()))
    throw new Error(tr("Нужна картинка: PNG, GIF, WebP или JPG"));
  const decoded = (await decodeAnimated(file).catch(() => null)) || (await decodeStill(file));
  const blobs = await Promise.all(decoded.canvases.map(canvasPng));
  const frames = await Promise.all(blobs.map(blobBase64));
  const joined = new TextEncoder().encode(`${frames.join("|")}#${decoded.delays.join(",")}`);
  const asset = await sha256Hex(joined);
  const record = {
    name: String(file.name || "картинка").slice(0, 80),
    delays: decoded.delays,
    frames,
  };
  await putWorkshopAsset(
    `${ASSET_PREFIX}${asset}`,
    new Blob([JSON.stringify(record)], { type: "application/json" }),
  );
  const source = {
    kind: "image",
    asset,
    name: record.name,
    frames: frames.length,
    animated: frames.length > 1,
  };
  const sequence = { key: killMarkerSourceKey(source), canvases: decoded.canvases, delays: decoded.delays, frames };
  cache.set(sequence.key, sequence);
  return { source, sequence };
}

async function imageSequence(source) {
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${source.asset}`);
  if (!blob) return null;
  const record = JSON.parse(await blob.text());
  const canvases = [];
  for (const frame of record.frames || []) {
    const image = await loadImage(`data:image/png;base64,${frame}`);
    const canvas = blankFrame();
    frameContext(canvas)?.drawImage(image, 0, 0, EDGE, EDGE);
    canvases.push(canvas);
  }
  return { canvases, delays: normalizeFrameDelays(record.delays), frames: record.frames };
}

/* Кадры по ключу картинки: одинаковый рисунок — одни и те же холсты. */
const cache = new Map();
const CACHE_LIMIT = 24;

/**
 * Кадры картинки знака: `{ key, canvases, delays, frames }` (`frames` —
 * PNG base64 для установщика) или `null`, если своей картинки на этом
 * компьютере нет (хранилище окна очищено, работа перенесена без него).
 */
export async function killMarkerSequence(source) {
  const key = killMarkerSourceKey(source);
  if (cache.has(key)) return cache.get(key);
  let sequence;
  if (source.kind === "image") {
    const found = await imageSequence(source);
    if (!found) return null;
    sequence = { key, ...found };
  } else {
    const canvas =
      source.kind === "emoji"
        ? emojiFrame(source)
        : source.kind === "text"
          ? textFrame(source)
          : await iconFrame(source);
    sequence = { key, canvases: [canvas], delays: [100], frames: null };
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, sequence);
  return sequence;
}

/** Кадры для установщика — PNG base64 с задержками. */
export async function killMarkerInstallFrames(sequence) {
  if (!sequence?.canvases?.length) return [];
  const frames =
    sequence.frames ||
    (await Promise.all(sequence.canvases.map(async (canvas) => blobBase64(await canvasPng(canvas)))));
  return frames.map((data, index) => ({
    data,
    mime: "image/png",
    delay: sequence.delays[index] ?? 100,
  }));
}
