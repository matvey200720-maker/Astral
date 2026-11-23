/*
 * Лист надписи дирижабля в облике работы (ТЗ 11.10.2026) — одна функция на
 * кадр, обложку и установку.
 *
 * Надпись рисует общая система надписей (`renderEmblemText`: тот же холст,
 * что у эмблем и летающего лого), своя картинка — из хранилища окна, строка
 * под надписью — той же надписью меньше (`airshipTaglineText`). Пиксели
 * ложатся в разметку листа игры договором (`paintAirshipSign`): фон —
 * цвет оболочки, полосы и пояс — цвет полос. «Как в игре» листа не рисует:
 * его берут из игры игрока.
 *
 * Без three.js: модуль везёт и очередь установки, а ей кадр ни к чему.
 */

import {
  AIRSHIP_SIGN_SIZE,
  airshipTaglineText,
  normalizeAirshipsProject,
  paintAirshipSign,
} from "@modovik/climb-contract/recolor/airships";
import { emblemTextFilled } from "@modovik/climb-contract/recolor/emblems";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { ensureEmblemFont, renderEmblemText } from "../emblem/emblem-items.js";
import { BLIMP_SUBJECT, airshipFailure } from "./airships-failure-copy.js";

/* Картинка надписи — не больше 1024 px по длинной стороне: место надписи на листе — 440 × 118. */
const PICTURE_SIDE = 1024;

/** Пиксели картинки или холста, вписанные в `side`: `{ rgba, width, height }` или `null`. */
export function pixelsOf(source, width, height, side = PICTURE_SIDE) {
  if (typeof document === "undefined" || !source || !width || !height) return null;
  const scale = Math.min(1, side / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  let context = null;
  try {
    context = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    context = null;
  }
  if (!context) return null;
  context.drawImage(source, 0, 0, w, h);
  const data = context.getImageData(0, 0, w, h)?.data;
  return data ? { rgba: new Uint8ClampedArray(data), width: w, height: h } : null;
}

/** Отпечаток листа: всё, от чего он зависит. «Как в игре» — `"game"`. */
export function airshipSignKey(input) {
  const project = normalizeAirshipsProject(input);
  const blimp = project.blimp;
  if (blimp.sign === "game") return "game";
  const lettered = blimp.sign === "text" || blimp.sign === "image";
  return JSON.stringify([
    blimp.sign,
    blimp.body,
    blimp.stripe,
    blimp.sign === "text" ? blimp.text : null,
    blimp.sign === "image" ? blimp.image?.asset || "" : null,
    lettered ? airshipTaglineText(project) : null,
  ]);
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob).catch(() => null);
  if (typeof Image !== "function" || typeof URL?.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/*
 * Пиксели надписи общей системы надписей. `strict` — для установки:
 * недорисованный лист в игру не едет; `subject` — чья надпись в ошибке
 * (`airships-failure-copy.js`: дирижабль, лого или текстура вида).
 */
export async function textPixels(text, strict = false, subject = BLIMP_SUBJECT) {
  if (!text || !emblemTextFilled(text)) return null;
  if (text.font === "custom") {
    const ready = await ensureEmblemFont(text.fontAsset).catch(() => false);
    if (!ready && strict) throw new Error(airshipFailure("font", subject));
  }
  const drawn = renderEmblemText(text);
  const pixels = drawn ? pixelsOf(drawn.canvas, drawn.canvas.width, drawn.canvas.height) : null;
  if (!pixels && strict) throw new Error(airshipFailure("text", subject));
  return pixels;
}

/* Пиксели картинки из хранилища окна (не больше 1024 px по длинной стороне). */
export async function imagePixels(asset, strict = false, subject = BLIMP_SUBJECT) {
  const blob = asset ? await getWorkshopAsset(asset).catch(() => null) : null;
  const image = blob ? await decodeImage(blob) : null;
  const pixels = image ? pixelsOf(image, image.naturalWidth || image.width, image.naturalHeight || image.height) : null;
  image?.close?.();
  if (!pixels && strict) throw new Error(airshipFailure("picture", subject));
  return pixels;
}

/**
 * Пиксели надписи (или картинки) и строки под ней: `{ sign, tagline }`;
 * `null` — «как в игре», рисовать нечего.
 */
export async function airshipSignPictures(input, { strict = false } = {}) {
  const project = normalizeAirshipsProject(input);
  const blimp = project.blimp;
  if (blimp.sign === "game") return null;
  let sign = null;
  if (blimp.sign === "text") sign = await textPixels(blimp.text, strict);
  else if (blimp.sign === "image") sign = await imagePixels(blimp.image?.asset, strict);
  const line = blimp.sign === "text" || blimp.sign === "image" ? airshipTaglineText(project) : null;
  const tagline = line ? await textPixels(line, strict) : null;
  return { sign, tagline };
}

/** Лист 512 × 256 в облике работы: `{ rgba, width, height }`; `null` — «как в игре». */
export async function airshipSignSheet(input, options = {}) {
  const project = normalizeAirshipsProject(input);
  const pictures = await airshipSignPictures(project, options);
  if (!pictures) return null;
  const { width, height } = AIRSHIP_SIGN_SIZE;
  return { rgba: paintAirshipSign(project, { ...pictures, width, height }), width, height };
}
