/*
 * Своя картинка следа на экране (задача 3 ТЗ 04.10.2026).
 *
 * Файл человека вписывается целиком в квадрат 256×256 на прозрачном фоне —
 * сторона капли игры, `SCREEN_HITS_EDGE`. Из квадрата маску делает договор
 * (`screenHitsMask`): форму — по прозрачности, рисунок — по яркости; цвет у
 * следа в игре один, его задаёт «Цвет». Квадрат лежит в хранилище
 * мастерской под отпечатком SHA-256 — по нему его находят черновик, работа
 * и установщик (он разбирает квадрат заново и сам строит ту же маску).
 */

import { SCREEN_HITS_EDGE } from "@modovik/kill-effects/screen-hits.js";
import { READBACK, context2d } from "../../../components/desktop/workshop/canvas-surface.js";
import { getWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";

const ASSET_PREFIX = "screen-hit:";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const SCREEN_HIT_PICTURE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function blankCanvas() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_HITS_EDGE;
  canvas.height = SCREEN_HITS_EDGE;
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
      if (!blob) return reject(new Error("Картинка следа не собралась"));
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
function squareOf(image, { fit = true } = {}) {
  const canvas = blankCanvas();
  const context = context2d(canvas, READBACK);
  if (!context) throw new Error("Картинку негде подготовить: нет холста");
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = fit ? Math.min(SCREEN_HITS_EDGE / width, SCREEN_HITS_EDGE / height) : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  context.clearRect(0, 0, SCREEN_HITS_EDGE, SCREEN_HITS_EDGE);
  context.drawImage(image, Math.round((SCREEN_HITS_EDGE - w) / 2), Math.round((SCREEN_HITS_EDGE - h) / 2), w, h);
  return { canvas, rgba: context.getImageData(0, 0, SCREEN_HITS_EDGE, SCREEN_HITS_EDGE).data };
}

const cache = new Map();

/** Файл человека → `{ asset, name, rgba }`; квадрат — в хранилище мастерской. */
export async function importScreenHitPicture(file) {
  if (!file) throw new Error("Выберите картинку");
  if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 16 МБ — возьмите поменьше");
  if (file.type && !SCREEN_HIT_PICTURE_TYPES.includes(String(file.type).toLowerCase())) throw new Error("Нужна картинка: PNG, JPG, WebP или GIF");
  const url = URL.createObjectURL(file);
  try {
    const { canvas, rgba } = squareOf(await loadImage(url));
    const bytes = await canvasPngBytes(canvas);
    const asset = await sha256Hex(bytes);
    const name = String(file.name || tr("картинка")).slice(0, 80);
    await putWorkshopAsset(`${ASSET_PREFIX}${asset}`, new Blob([bytes], { type: "image/png" }));
    const picture = { asset, name, rgba };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Своя картинка по отпечатку — `{ asset, rgba }` или `null`, если её нет на этом компьютере. */
export async function screenHitPicture(asset) {
  if (!asset) return null;
  if (cache.has(asset)) return cache.get(asset);
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const { rgba } = squareOf(await loadImage(url), { fit: false });
    const picture = { asset, rgba };
    cache.set(asset, picture);
    return picture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Квадрат своей картинки для установщика — PNG base64 или `null`. */
export async function screenHitPicturePng(asset) {
  if (!asset) return null;
  const blob = await getWorkshopAsset(`${ASSET_PREFIX}${asset}`);
  if (!blob) return null;
  return base64Of(new Uint8Array(await blob.arrayBuffer()));
}
