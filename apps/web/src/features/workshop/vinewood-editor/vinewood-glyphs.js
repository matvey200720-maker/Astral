/*
 * Маски букв надписи на холме — окно рисует их шрифтом Windows.
 *
 * Буква — отдельный холст: знак по центру, базовая линия и высота
 * заглавных (по «H» того же шрифта) — общие у всех букв слова, края
 * чернил по X — свои. Маску (альфа) и её мерки договор превращает в
 * контур и сетку (`vinewood.js`) — в кадре и, картинкой PNG, у
 * установщика: буквы в игре те же, что в кадре.
 */

import { VINEWOOD_FONT_CUSTOM, vinewoodFont } from "@modovik/climb-contract/recolor/vinewood";
import { isEmblemFontReady } from "../emblem/emblem-fonts.js";
import { ownFontStack, prepareOwnFonts } from "../emblem/own-font.js";

/*
 * Шрифт слова: шрифт набора или свой (ключ файла в работе). Свой, ещё не добравшийся до набора шрифтов документа,
 * отличается от готового (`ready`): маски и высота заглавных, снятые с запасного, под ключом готового не лежат.
 */
function faceOf(project) {
  if (project.font === VINEWOOD_FONT_CUSTOM && project.fontAsset)
    return { id: `custom:${project.fontAsset}`, family: ownFontStack(project.fontAsset, vinewoodFont("classic").family), weight: 400, ready: isEmblemFontReady(project.fontAsset) };
  return { ...vinewoodFont(project.font), ready: true };
}

const SIZE = 256;
const THRESHOLD = 128;

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

/* Знак на холсте: `{ alpha, width, height, baseline, ink, top }` или `null`. */
function drawGlyph(char, font) {
  const width = Math.round(SIZE * 1.9);
  const height = Math.round(SIZE * 1.55);
  const baseline = Math.round(SIZE * 1.25);
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context) return null;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.font = `${font.weight} ${SIZE}px ${font.family}`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(char, width / 2, baseline);
  const data = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  let x0 = width;
  let x1 = 0;
  let top = height;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const value = data[(y * width + x) * 4 + 3];
      alpha[y * width + x] = value;
      if (value >= THRESHOLD) {
        if (x < x0) x0 = x;
        if (x + 1 > x1) x1 = x + 1;
        if (y < top) top = y;
      }
    }
  /* Холст отпускается сразу: в масках живёт только альфа. */
  canvas.width = 0;
  canvas.height = 0;
  return { alpha, width, height, baseline, ink: x1 > x0 ? [x0, x1] : null, top };
}

const capCache = new Map();
/* Высота заглавных шрифта — по «H»: от верха чернил до базовой линии. */
function capHeight(font) {
  const key = `${font.weight} ${font.family} ${font.ready}`;
  if (capCache.has(key)) return capCache.get(key);
  const glyph = drawGlyph("H", font);
  const cap = glyph?.ink ? glyph.baseline - glyph.top : 0;
  if (cap > 0) capCache.set(key, cap);
  return cap;
}

/* Последние слова: кадр и подсказка высоты букв берут одни маски. */
const maskCache = new Map();
const MASK_CACHE_SIZE = 4;

/**
 * Маски слова работы: `{ glyphs: [{ char, aspect }], masks: [маска|null] }`
 * (у пробела маски нет) или `null`, если холста в окне нет (тесты) или
 * шрифт не нарисовал ни одной буквы.
 */
export function vinewoodGlyphMasks(project) {
  const font = faceOf(project);
  const key = `${font.id}|${font.ready}|${project.text || ""}`;
  if (maskCache.has(key)) return maskCache.get(key);
  const result = drawWord(project, font);
  if (result) {
    maskCache.set(key, result);
    if (maskCache.size > MASK_CACHE_SIZE) maskCache.delete(maskCache.keys().next().value);
  }
  return result;
}

function drawWord(project, font) {
  const cap = capHeight(font);
  if (!cap) return null;
  const chars = [...(project.text || "")];
  const masks = [];
  const glyphs = [];
  for (const char of chars) {
    if (char === " ") {
      masks.push(null);
      glyphs.push({ char, aspect: 0 });
      continue;
    }
    const glyph = drawGlyph(char, font);
    if (!glyph?.ink) {
      /* Знака нет в шрифте — пробелом, а не пустой буквой. */
      masks.push(null);
      glyphs.push({ char: " ", aspect: 0 });
      continue;
    }
    const mask = { alpha: glyph.alpha, width: glyph.width, height: glyph.height, cap, baseline: glyph.baseline, ink: glyph.ink };
    masks.push(mask);
    glyphs.push({ char, aspect: (glyph.ink[1] - glyph.ink[0]) / cap });
  }
  return glyphs.some((glyph) => glyph.char !== " ") ? { glyphs, masks } : null;
}

/* Маска → PNG (белый знак по альфе) base64. */
async function maskBase64(mask) {
  const canvas = canvasOf(mask.width, mask.height);
  const context = context2d(canvas);
  if (!context) throw new Error("Букву надписи не собрать в этом окне.");
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4).fill(255);
  for (let at = 0; at < mask.alpha.length; at += 1) rgba[at * 4 + 3] = mask.alpha[at];
  context.putImageData(new ImageData(rgba, mask.width, mask.height), 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Букву надписи не собрать в этом окне.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/**
 * Маски для главного процесса: `{ "glyph:<n>": { data, cap, baseline, ink } }`
 * (PNG с альфой) — по знаку слова, пробелы пропускаются.
 */
export async function vinewoodGlyphImages(project) {
  /* Свой шрифт — в набор шрифтов документа до масок: в игру уедет выбранный, не запасной. */
  await prepareOwnFonts(project.fontAsset);
  const result = vinewoodGlyphMasks(project);
  if (!result) throw new Error("Буквы надписи не нарисовать в этом окне — откройте редактор в Astral.");
  const out = {};
  for (const [index, mask] of result.masks.entries()) {
    if (!mask) continue;
    out[`glyph:${index}`] = { data: await maskBase64(mask), cap: mask.cap, baseline: mask.baseline, ink: mask.ink };
  }
  return out;
}
