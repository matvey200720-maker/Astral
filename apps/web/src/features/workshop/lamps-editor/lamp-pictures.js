/*
 * Картинки частиц фонарей: плитки шаблонов и своя картинка человека.
 *
 * ПЛИТКИ ШАБЛОНОВ — кадры листов ядра самого игрока: та бабочка, лепесток,
 * лист, снежинка или огонёк, что полетит у лампы (`picture` шаблона в
 * `particles.js`). Текстур Rockstar в поставке нет — пока игра не прочитана,
 * плитка рисует силуэт своим пером.
 *
 * СВОЯ КАРТИНКА — файл человека, вписанный в квадрат 128×128 (лист частицы в
 * ядре — ровно такой, `CUSTOM_TEXTURE_EDGE`). У картинки без прозрачности
 * (фотография) края мягко гаснут кругом: квадратная фотография в воздухе
 * читалась бы открыткой, а не частицей. Готовый лист лежит в хранилище
 * мастерской под отпечатком SHA-256 — по нему его находят черновик,
 * сохранённая работа и установщик.
 */

import {
  BUTTERFLY_SHEET,
  BUTTERFLY_VARIANTS,
  CUSTOM_TEXTURE_EDGE,
  butterflySheet,
  hexToRgb,
} from "@modovik/street-light-contract/lamps";
import { READBACK, context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import { getWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";
import { setPngSource } from "../../../utils/png-source.js";

const ASSET_PREFIX = "lamp-particle:";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const LAMP_PICTURE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const hasDocument = () => typeof document !== "undefined";

function blankCanvas(width, height) {
  if (!hasDocument()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Картинку не прочитать — выберите PNG, JPG или WebP"));
    setPngSource(image, src);
  });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canvasPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("Лист картинки не собрался"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function base64Of(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/*
 * Файл → лист 128×128: вписан целиком по центру. Есть ли у картинки своя
 * прозрачность — по альфе её пикселей; нет — края гаснут мягким кругом.
 */
export function pictureSheet(image) {
  const edge = CUSTOM_TEXTURE_EDGE;
  const canvas = blankCanvas(edge, edge);
  const context = context2d(canvas, READBACK);
  if (!context) throw new Error("Картинку негде подготовить: нет холста");
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(edge / width, edge / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  context.clearRect(0, 0, edge, edge);
  context.drawImage(image, Math.round((edge - w) / 2), Math.round((edge - h) / 2), w, h);
  const pixels = context.getImageData(0, 0, edge, edge);
  const data = pixels.data;
  let transparent = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index] < 250) transparent += 1;
  /* Меньше пяти процентов прозрачного — это фотография без своей альфы. */
  if (transparent < (edge * edge) / 20) {
    const centre = (edge - 1) / 2;
    for (let y = 0; y < edge; y += 1)
      for (let x = 0; x < edge; x += 1) {
        const r = Math.hypot(x - centre, y - centre) / (edge / 2);
        const fade = r < 0.78 ? 1 : r > 1 ? 0 : 1 - (r - 0.78) / 0.22;
        const at = (y * edge + x) * 4 + 3;
        data[at] = Math.round(data[at] * fade * fade * (3 - 2 * fade));
      }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

/**
 * Файл человека → своя картинка частиц: `{ asset, name, canvas, key }`.
 * Лист кладётся в хранилище мастерской под отпечатком своих байт.
 */
export async function importLampPicture(file) {
  if (!file) throw new Error("Выберите картинку");
  if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 16 МБ — возьмите поменьше");
  if (file.type && !LAMP_PICTURE_TYPES.includes(String(file.type).toLowerCase()))
    throw new Error("Нужна картинка: PNG, JPG, WebP или GIF");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const canvas = pictureSheet(image);
    const bytes = await canvasPngBytes(canvas);
    const asset = await sha256Hex(bytes);
    const name = String(file.name || tr("картинка")).slice(0, 80);
    await putWorkshopAsset(`${ASSET_PREFIX}${asset}`, new Blob([bytes], { type: "image/png" }));
    const picture = { asset, name, canvas, key: asset };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const cache = new Map();

/** Своя картинка по отпечатку — `{ asset, canvas, key }` или `null`, если её нет на этом компьютере. */
export async function lampPicture(asset) {
  if (!asset) return null;
  if (cache.has(asset)) return cache.get(asset);
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = blankCanvas(CUSTOM_TEXTURE_EDGE, CUSTOM_TEXTURE_EDGE);
    const context = context2d(canvas);
    if (!context) return null;
    context.drawImage(image, 0, 0, CUSTOM_TEXTURE_EDGE, CUSTOM_TEXTURE_EDGE);
    const picture = { asset, canvas, key: asset };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Лист своей картинки для установщика — PNG base64 или `null`. */
export async function lampPicturePng(asset) {
  if (!asset) return null;
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  return base64Of(new Uint8Array(await blob.arrayBuffer()));
}

/* ---------- плитки шаблонов ---------- */

const sheetImages = new Map();

function sheetImage(sheet) {
  if (!sheet?.png || typeof Image === "undefined") return Promise.resolve(null);
  const known = sheetImages.get(sheet.png);
  if (known) return known;
  const promise = loadImage(sheet.png).catch(() => null);
  sheetImages.set(sheet.png, promise);
  return promise;
}

/* Кадр листа как холст — с перекраской крыльев, если она задана. */
function frameCanvas(image, sheet, frame, variantId) {
  const columns = Math.max(1, sheet.columns || 1);
  const rows = Math.max(1, sheet.rows || 1);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const cellW = Math.floor(width / columns);
  const cellH = Math.floor(height / rows);
  const column = frame % columns;
  const row = Math.floor(frame / columns) % rows;
  const canvas = blankCanvas(cellW, cellH);
  const context = context2d(canvas, READBACK);
  if (!context) return null;
  context.drawImage(image, column * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
  if (variantId) {
    const pixels = context.getImageData(0, 0, cellW, cellH);
    const recoloured = butterflySheet(pixels.data, cellW, cellH, { ...BUTTERFLY_SHEET, rows: 1, row: 0 }, BUTTERFLY_VARIANTS[variantId]);
    context.putImageData(new ImageData(new Uint8ClampedArray(recoloured.rgba), cellW, cellH), 0, 0);
  }
  return canvas;
}

/* Огонёк: радиальное свечение цвета шаблона. */
function glowCanvas(colour, size) {
  const canvas = blankCanvas(size, size);
  const context = context2d(canvas);
  if (!context) return null;
  const { r, g, b } = hexToRgb(colour);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(255,255,255,1)`);
  gradient.addColorStop(0.25, `rgba(${r},${g},${b},0.95)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}

/* Расстановка: три-четыре частицы по плитке, как они висят у лампы. */
const LAYOUTS = Object.freeze({
  one: [[0.5, 0.52, 0.78, -8]],
  three: [
    [0.3, 0.38, 0.52, -14],
    [0.68, 0.34, 0.46, 12],
    [0.5, 0.72, 0.5, 4],
  ],
});

/**
 * Картинка плитки шаблона на холсте `size × size` или `null`, если листа нет
 * (игра не прочитана) — тогда плитка рисует силуэт.
 */
export async function templatePictureCanvas(template, sheets, size = 96) {
  const picture = template?.picture;
  if (!picture || !hasDocument()) return null;
  const canvas = blankCanvas(size, size);
  const context = context2d(canvas);
  if (!context) return null;
  if (picture.glow) {
    const seed = [0.21, 0.73, 0.47, 0.12, 0.88, 0.35, 0.62, 0.95, 0.05, 0.54, 0.29, 0.81, 0.4, 0.67];
    const count = picture.count || 6;
    for (let index = 0; index < count; index += 1) {
      const x = seed[index % seed.length] * size;
      const y = seed[(index * 5 + 3) % seed.length] * size;
      const dot = (picture.small ? 0.16 : 0.26) * size * (0.7 + seed[(index * 3 + 1) % seed.length] * 0.6);
      const glow = glowCanvas(template.colour, 64);
      if (glow) context.drawImage(glow, x - dot / 2, y - dot / 2, dot, dot);
    }
    return canvas;
  }
  const sheet = sheets?.[picture.sheet];
  const image = await sheetImage(sheet);
  if (!image) return null;
  const frames = picture.frames;
  const layout = frames.length > 1 ? LAYOUTS.three : LAYOUTS.one;
  layout.forEach(([x, y, scale, angle], index) => {
    const frame = frames[index % frames.length];
    const variant = picture.variants ? picture.variants[index % picture.variants.length] : null;
    let cell = frameCanvas(image, sheet, frame, variant);
    if (!cell) return;
    if (picture.tint) {
      const tinted = blankCanvas(cell.width, cell.height);
      const tc = context2d(tinted);
      if (!tc) return;
      tc.drawImage(cell, 0, 0);
      tc.globalCompositeOperation = "multiply";
      tc.fillStyle = template.colour;
      tc.fillRect(0, 0, cell.width, cell.height);
      tc.globalCompositeOperation = "destination-in";
      tc.drawImage(cell, 0, 0);
      cell = tinted;
    }
    const w = size * scale;
    context.save();
    context.translate(x * size, y * size);
    context.rotate((angle * Math.PI) / 180);
    context.drawImage(cell, -w / 2, -w / 2, w, w);
    context.restore();
  });
  return canvas;
}
