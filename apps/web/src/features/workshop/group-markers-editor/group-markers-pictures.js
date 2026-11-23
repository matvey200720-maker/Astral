/*
 * Своя картинка групповой метки (задача 21 ТЗ 18.10.2026): файл человека → PNG с прозрачностью.
 *
 * Картинка уменьшается до 512 точек по длинной стороне (в игре лист метки — от 32 до 256), хранится
 * PNG в хранилище мастерской под отпечатком SHA-256 и по нему находится в черновике, работе и у
 * установщика; установщик сверяет байты с отпечатком и вписывает картинку в каждый лист метки
 * (`group-markers-customizer.js`).
 *
 * Гифка: лист ytd — одна картинка, анимации у такой метки в игре нет; берётся первый кадр, а окно
 * говорит об этом словами (`animated`). У накладки радара (спрайт Scaleform) кадры играют: гифка разбирается на
 * кадры (`ImageDecoder` окна, до GROUP_MARKER_GIF_LIMITS.frames, сторона кадра до GROUP_MARKER_GIF_LIMITS.edge) и
 * ложится лентой — PNG, кадры друг под другом, — рядом с первым кадром; задержки каждого кадра едут в работе.
 */

import { GROUP_MARKER_GIF_LIMITS, cleanGroupMarkerText, groupMarkerAssets } from "@modovik/minimap-contract/group-markers";
import { READBACK, context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import { getWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";
import { prepareOwnFonts } from "../emblem/own-font.js";
import { applyGroupMarkerFont } from "./group-markers-fonts.js";

const ASSET_PREFIX = "group-marker:";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EDGE = 512;
export const GROUP_MARKER_PICTURE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(tr("Картинку не прочитать — выберите PNG, JPG, WebP или GIF")));
    image.src = src;
  });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canvasPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error(tr("Картинка метки не собралась")));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function base64Of(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/* Кадров у гифки: разбор блоков файла (дескрипторы изображений `2C`); больше одного — гифка движется. */
export function gifFrameCount(bytes) {
  if (!bytes || bytes.length < 14 || String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== "GIF") return 0;
  const skipSubBlocks = (from) => {
    let at = from;
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * (1 << ((bytes[10] & 7) + 1));
  let frames = 0;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) break;
    if (block === 0x21) at = skipSubBlocks(at + 2);
    else if (block === 0x2c) {
      frames += 1;
      const flags = bytes[at + 9];
      at += 10;
      if (flags & 0x80) at += 3 * (1 << ((flags & 7) + 1));
      at = skipSubBlocks(at + 1);
    } else break;
  }
  return frames;
}

const cache = new Map();
const frameCache = new Map();
const MAX_DECODE_FRAMES = 300;

/*
 * Кадры гифки окном: `{ canvases, delays }` — до GROUP_MARKER_GIF_LIMITS.frames кадров, сторона не больше
 * GROUP_MARKER_GIF_LIMITS.edge; кадров больше предела — соседние сливаются (задержки складываются). Окно без
 * `ImageDecoder` или гифка, что не разобралась, — `null`: останется первый кадр.
 */
async function decodeGifFrames(file) {
  if (typeof ImageDecoder === "undefined") return null;
  let decoder = null;
  try {
    decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: "image/gif" });
    await decoder.tracks.ready;
    const total = Math.min(MAX_DECODE_FRAMES, decoder.tracks.selectedTrack?.frameCount || 0);
    if (total < 2) return null;
    const decoded = [];
    let size = null;
    for (let index = 0; index < total; index += 1) {
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        const width = image.displayWidth || image.codedWidth;
        const height = image.displayHeight || image.codedHeight;
        if (!size) {
          const scale = Math.min(1, GROUP_MARKER_GIF_LIMITS.edge / Math.max(width, height));
          size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
        }
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = context2d(canvas, READBACK);
        if (!context) return null;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, size.width, size.height);
        decoded.push({ canvas, delay: Math.max(GROUP_MARKER_GIF_LIMITS.minDelay, Math.round((image.duration || 100_000) / 1000)) });
      } finally {
        image.close?.();
      }
    }
    const count = Math.min(GROUP_MARKER_GIF_LIMITS.frames, decoded.length);
    const canvases = [];
    const delays = [];
    for (let index = 0; index < count; index += 1) {
      const from = Math.floor((index * decoded.length) / count);
      const to = Math.floor(((index + 1) * decoded.length) / count);
      canvases.push(decoded[from].canvas);
      delays.push(Math.min(GROUP_MARKER_GIF_LIMITS.maxDelay, decoded.slice(from, Math.max(from + 1, to)).reduce((sum, item) => sum + item.delay, 0)));
    }
    return { canvases, delays };
  } catch {
    return null;
  } finally {
    decoder?.close?.();
  }
}

/* Кадры друг под другом одним холстом — лента, что уезжает в установщик. */
function stripCanvas(canvases) {
  const strip = document.createElement("canvas");
  strip.width = canvases[0].width;
  strip.height = canvases[0].height * canvases.length;
  const context = context2d(strip, READBACK);
  canvases.forEach((canvas, index) => context.drawImage(canvas, 0, index * canvas.height));
  return strip;
}

/** Файл человека → `{ asset, name, animated, width, height, image, strip?, frames?, delays? }`; PNG — в хранилище мастерской. */
export async function importGroupMarkerPicture(file) {
  if (!file) throw new Error(tr("Выберите картинку"));
  if (file.size > MAX_FILE_BYTES) throw new Error(tr("Файл больше 16 МБ — возьмите поменьше"));
  if (file.type && !GROUP_MARKER_PICTURE_TYPES.includes(String(file.type).toLowerCase())) throw new Error(tr("Нужна картинка: PNG, JPG, WebP или GIF"));
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isGif = String.fromCharCode(head[0], head[1], head[2]) === "GIF";
  const count = isGif ? gifFrameCount(new Uint8Array(await file.arrayBuffer())) : 0;
  const gif = count > 1 ? await decodeGifFrames(file) : null;
  const url = URL.createObjectURL(file);
  try {
    const source = await loadImage(url);
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = context2d(canvas, READBACK);
    if (!context) throw new Error(tr("Картинку негде подготовить: нет холста"));
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const bytes = await canvasPngBytes(canvas);
    const asset = await sha256Hex(bytes);
    const name = String(file.name || tr("картинка")).slice(0, 80);
    await putWorkshopAsset(`${ASSET_PREFIX}${asset}`, new Blob([bytes], { type: "image/png" }));
    const picture = { asset, name, animated: count > 1, width: canvas.width, height: canvas.height, image: canvas };
    if (gif) {
      const stripBytes = await canvasPngBytes(stripCanvas(gif.canvases));
      picture.strip = await sha256Hex(stripBytes);
      await putWorkshopAsset(`${ASSET_PREFIX}${picture.strip}`, new Blob([stripBytes], { type: "image/png" }));
      picture.frames = gif.canvases;
      picture.delays = gif.delays;
      frameCache.set(picture.strip, gif.canvases);
    }
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/*
 * Надпись вместо метки → PNG (дополнение владельца 19.10.2026): слова своим шрифтом и цветом на прозрачном фоне,
 * обрезанные по краю букв, — установщик получает её как любую свою картинку (шрифты — дело окна) и вписывает в лист
 * метки; размер, обводка и прозрачность — отделка, она ложится поверх (`finishMark`). Одна и та же надпись даёт один
 * и тот же файл на этом компьютере, поэтому отпечаток стабилен.
 */
const TEXT_FONT_PX = 160;
const TEXT_MAX_WIDTH = 1600;
const TEXT_MARGIN = 2;

/** Надпись `{ text, font, color }` → `{ asset, name, width, height, image }`; PNG — в хранилище мастерской. */
export async function renderGroupMarkerText({ text, font, color, fontAsset = "" }) {
  /* Свой шрифт — в набор шрифтов документа до холста: в картинку метки не должен лечь запасной. */
  await prepareOwnFonts(fontAsset);
  const lines = cleanGroupMarkerText(text).split("\n");
  if (!lines.join("").trim()) throw new Error(tr("Напишите надпись"));
  const probe = document.createElement("canvas");
  const measure = context2d(probe, READBACK);
  if (!measure) throw new Error(tr("Надпись негде нарисовать: нет холста"));
  applyGroupMarkerFont(measure, font, TEXT_FONT_PX, fontAsset);
  const widest = Math.max(1, ...lines.map((line) => measure.measureText(line).width));
  /* Длинную строку уменьшаем, чтобы холст не раздувался: в лист всё равно вписывается целиком. */
  const size = Math.max(24, Math.min(TEXT_FONT_PX, (TEXT_FONT_PX * TEXT_MAX_WIDTH) / widest));
  const lineHeight = Math.round(size * 1.25);
  const pad = Math.ceil(size * 0.2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((widest * size) / TEXT_FONT_PX) + pad * 2;
  canvas.height = lineHeight * lines.length + pad * 2;
  const context = context2d(canvas, READBACK);
  if (!context) throw new Error(tr("Надпись негде нарисовать: нет холста"));
  applyGroupMarkerFont(context, font, size, fontAsset);
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((line, index) => context.fillText(line, canvas.width / 2, pad + lineHeight * (index + 0.5)));
  /* Обрезка по буквам: в лист надпись вписывается по самой надписи, а не по запасу вокруг. */
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let top = canvas.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1)
    for (let x = 0; x < canvas.width; x += 1)
      if (data[(y * canvas.width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) throw new Error(tr("Надпись не нарисовалась — другой шрифт или цвет?"));
  const width = right - left + 1 + TEXT_MARGIN * 2;
  const height = bottom - top + 1 + TEXT_MARGIN * 2;
  const trimmed = document.createElement("canvas");
  trimmed.width = width;
  trimmed.height = height;
  context2d(trimmed, READBACK)?.drawImage(canvas, left - TEXT_MARGIN, top - TEXT_MARGIN, width, height, 0, 0, width, height);
  const bytes = await canvasPngBytes(trimmed);
  const asset = await sha256Hex(bytes);
  const name = lines.join(" ").slice(0, 80);
  await putWorkshopAsset(`${ASSET_PREFIX}${asset}`, new Blob([bytes], { type: "image/png" }));
  const picture = { asset, name, animated: false, width, height, image: trimmed };
  cache.set(asset, picture);
  return picture;
}

/** Своя картинка по отпечатку — `{ asset, image }` или `null`, если её нет на этом компьютере. */
export async function groupMarkerPicture(asset) {
  if (!asset) return null;
  if (cache.has(asset)) return cache.get(asset);
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const picture = { asset, name: "", animated: false, width: image.naturalWidth, height: image.naturalHeight, image };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Кадры гифки из ленты по отпечатку ленты и числу кадров — холсты, или `null`, если ленты нет на этом компьютере. */
export async function groupMarkerFrames(strip, count) {
  if (!strip || !Number.isInteger(count) || count < 2) return null;
  if (frameCache.has(strip)) return frameCache.get(strip);
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${strip}`);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const height = Math.floor(image.naturalHeight / count);
    if (!height) return null;
    const canvases = [];
    for (let index = 0; index < count; index += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = height;
      context2d(canvas, READBACK)?.drawImage(image, 0, index * height, image.naturalWidth, height, 0, 0, image.naturalWidth, height);
      canvases.push(canvas);
    }
    frameCache.set(strip, canvases);
    return canvases;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PNG своей картинки для установщика — base64 или `null`. */
export async function groupMarkerPicturePng(asset) {
  if (!asset) return null;
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  return base64Of(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Свои картинки работы для установщика: отпечаток → PNG base64 (первые кадры и — у накладки радара — ленты гифок);
 * `missing` — каких нет на этом компьютере.
 */
export async function groupMarkerPicturesFor(work) {
  const pictures = {};
  const missing = [];
  for (const asset of groupMarkerAssets(work).keys()) {
    const png = await groupMarkerPicturePng(asset).catch(() => null);
    if (png) pictures[asset] = png;
    else missing.push(asset);
  }
  return { pictures, missing };
}
