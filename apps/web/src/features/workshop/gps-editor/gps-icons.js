/*
 * Значок метки: рисунок для кадра и своя картинка.
 *
 * В игре значок метки — белый силуэт с тёмным контуром в листе значков, и
 * игра красит его умножением в цвет метки. Кадр делает так же: силуэт —
 * значок из вашей игры (`readGps` отдаёт клетку листа картинкой), готовый
 * силуэт Astral (`GPS_MARKER_ICONS`) или своя картинка, сведённая к силуэту
 * тем же правилом, что у установщика (`gps-customizer.js`, `pictureCell`):
 * непрозрачное — белое, вокруг — контур в три точки чёрным.
 *
 * Своя картинка лежит квадратом PNG в хранилище мастерской под отпечатком
 * SHA-256 — по нему её находят черновик, работа и установщик.
 */

import { GPS_MARKER_ICONS } from "@modovik/minimap-contract/gps";
import { READBACK, context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import { getWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";

const ASSET_PREFIX = "gps-icon:";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SQUARE = 128;
export const GPS_ICON_PICTURE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/*
 * Значок игры очерком — только на случай, когда игры под окном нет (браузер,
 * песочница): крест-цветок с кругом посередине, как клетка листа Rockstar.
 * Кадр об этом говорит.
 */
const DRAWN_STOCK_PATH =
  "M32 4l8 9v11h11l9 8-9 8H40v11l-8 9-8-9V40H13l-9-8 9-8h11V13zM32 22a10 10 0 1 0 0 20 10 10 0 0 0 0-20z";

function blankCanvas(size) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Картинку не прочитать — выберите PNG, JPG или WebP"));
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
      if (!blob) return reject(new Error("Картинка значка не собралась"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function base64Of(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/* Картинка → квадрат: вписана целиком по центру, вокруг — прозрачно. */
function squareOf(image) {
  const canvas = blankCanvas(SQUARE);
  const context = context2d(canvas, READBACK);
  if (!context) throw new Error("Картинку негде подготовить: нет холста");
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(SQUARE / width, SQUARE / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  context.clearRect(0, 0, SQUARE, SQUARE);
  context.drawImage(image, Math.round((SQUARE - w) / 2), Math.round((SQUARE - h) / 2), w, h);
  return canvas;
}

/*
 * Силуэт значка 64×64 из квадрата картинки — то же правило, что у
 * установщика: картинка в 52 точки с полем 6, непрозрачное (> 96) — белое,
 * в трёх точках вокруг — чёрное.
 */
function silhouetteOf(source) {
  const size = 64;
  const inner = 52;
  const work = blankCanvas(size);
  const context = context2d(work, READBACK);
  if (!context) return null;
  context.clearRect(0, 0, size, size);
  context.drawImage(source, 6, 6, inner, inner);
  const pixels = context.getImageData(0, 0, size, size);
  const alpha = new Uint8Array(size * size);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels.data[i * 4 + 3];
  const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size && alpha[y * size + x] > 96;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      if (inside(x, y)) {
        pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = pixels.data[at + 3] = 255;
        continue;
      }
      let ring = false;
      for (let dy = -3; dy <= 3 && !ring; dy += 1) for (let dx = -3; dx <= 3 && !ring; dx += 1) if (dx * dx + dy * dy <= 9 && inside(x + dx, y + dy)) ring = true;
      pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = 0;
      pixels.data[at + 3] = ring ? 255 : 0;
    }
  context.putImageData(pixels, 0, 0);
  return work;
}

const cache = new Map();

/** Файл человека → `{ asset, name, silhouette }`; квадрат — в хранилище мастерской. */
export async function importGpsIconPicture(file) {
  if (!file) throw new Error("Выберите картинку");
  if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 16 МБ — возьмите поменьше");
  if (file.type && !GPS_ICON_PICTURE_TYPES.includes(String(file.type).toLowerCase())) throw new Error("Нужна картинка: PNG, JPG, WebP или GIF");
  const url = URL.createObjectURL(file);
  try {
    const canvas = squareOf(await loadImage(url));
    const bytes = await canvasPngBytes(canvas);
    const asset = await sha256Hex(bytes);
    const name = String(file.name || tr("картинка")).slice(0, 80);
    await putWorkshopAsset(`${ASSET_PREFIX}${asset}`, new Blob([bytes], { type: "image/png" }));
    const picture = { asset, name, silhouette: silhouetteOf(canvas) };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Своя картинка по отпечатку — `{ asset, silhouette }` или `null`, если её нет на этом компьютере. */
export async function gpsIconPicture(asset) {
  if (!asset) return null;
  if (cache.has(asset)) return cache.get(asset);
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const picture = { asset, silhouette: silhouetteOf(await loadImage(url)) };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Квадрат своей картинки для установщика — PNG base64 или `null`. */
export async function gpsIconPicturePng(asset) {
  if (!asset) return null;
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  return base64Of(new Uint8Array(await blob.arrayBuffer()));
}

/* Силуэт готового значка: контур — путь SVG в квадрате 64×64. Один холст на путь и размер: силуэт
   только читается (`drawImage`), а плитки значков спрашивали его заново на каждый шаг палитры. */
const silhouettes = new Map();
function pathSilhouette(path, size) {
  const key = `${size}|${path}`;
  if (silhouettes.has(key)) return silhouettes.get(key);
  const canvas = blankCanvas(size);
  const context = context2d(canvas);
  if (!context || typeof Path2D === "undefined") return null;
  const scale = size / 64;
  const shape = new Path2D(path);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.lineJoin = "round";
  context.lineWidth = 5;
  context.strokeStyle = "#000000";
  context.fillStyle = "#ffffff";
  context.stroke(shape);
  context.fill(shape, "evenodd");
  silhouettes.set(key, canvas);
  return canvas;
}

/**
 * Значок метки в цвете метки — так, как его покажет игра: силуэт × цвет.
 * `stockImage` — клетка значка из игры (Image) или `null`; `picture` — своя
 * картинка (`{ silhouette }`). Возвращает холст `size`×`size` или `null`.
 */
export function markerIconCanvas({ icon = "stock", color = "#a44cf2", stockImage = null, picture = null, size = 64 }) {
  const canvas = blankCanvas(size);
  const context = context2d(canvas);
  if (!context) return null;
  return paintMarkerIcon(context, { icon, color, stockImage, picture, size }) ? canvas : null;
}

/**
 * Тот же значок — на готовом холсте `size`×`size` (плитка значка рисует в свой холст, не заводя новых
 * на каждый шаг палитры). Холст очищается. `false` — рисовать нечего.
 */
export function paintMarkerIcon(context, { icon = "stock", color = "#a44cf2", stockImage = null, picture = null, size = 64 }) {
  let silhouette = null;
  if (icon === "custom") silhouette = picture?.silhouette || null;
  else if (icon === "stock") silhouette = stockImage || pathSilhouette(DRAWN_STOCK_PATH, size);
  else {
    const preset = GPS_MARKER_ICONS.find((item) => item.id === icon);
    silhouette = preset?.path ? pathSilhouette(preset.path, size) : null;
  }
  if (!silhouette) silhouette = pathSilhouette(DRAWN_STOCK_PATH, size);
  if (!silhouette) return false;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.drawImage(silhouette, 0, 0, size, size);
  /* Умножение красит белое в цвет метки, чёрный контур остаётся чёрным;
     вторым проходом возвращается прозрачность силуэта. */
  context.globalCompositeOperation = "multiply";
  context.fillStyle = color;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(silhouette, 0, 0, size, size);
  context.globalCompositeOperation = "source-over";
  return true;
}

/** Картинка значка игры из PNG base64 → Image (или `null`). */
export function loadStockIcon(png) {
  if (!png || typeof Image === "undefined") return Promise.resolve(null);
  return loadImage(`data:image/png;base64,${png}`).catch(() => null);
}
