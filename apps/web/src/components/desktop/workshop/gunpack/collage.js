import { paintWorkshopMatte, WORKSHOP_MATTE_LIFTED_BASE } from "@modovik/gfx/workshop-matte";
import { trimmedBounds, layoutCollage, COVER_SAFE } from "./collage-layout.js";
import { SHOT_BACKGROUNDS } from "./gunpack-scene.js";

export { packRows } from "./collage-layout.js";

/* ---------- цвет ---------- */

export function colourLuminance(hex) {
  const channels = readHexTriplet(String(hex || ""));
  if (channels === null) return 0;
  return channels.reduce((sum, channel, i) => sum + LUMA_WEIGHTS[i] * (channel / 255), 0);
}

export function needsBackdropLight(darkShare, backgroundColour) {
  const dimBackdrop = colourLuminance(backgroundColour) < BACKDROP_DIM_LIMIT;
  return dimBackdrop && darkShare > DARK_SHARE_LIMIT;
}

// «#rrggbb» или «rrggbb» целиком; всё остальное — null.
function readHexTriplet(text) {
  const body = text[0] === "#" ? text.slice(1) : text;
  if (body.length !== 6) return null;
  const channels = [];
  for (let at = 0; at < 6; at += 2) {
    const high = hexDigit(body[at]);
    const low = hexDigit(body[at + 1]);
    if (high < 0 || low < 0) return null;
    channels.push(high * 16 + low);
  }
  return channels;
}

function hexDigit(char) {
  return HEX_DIGITS.indexOf(char.toLowerCase());
}

/* ---------- чтение кадра ---------- */

export async function isBlankFrame(bytes) {
  if (!bytes || !bytes.length) return true;
  const bitmap = await decodePng(bytes);
  try {
    const pixels = readPixels(bitmap);
    return opaqueBox(pixels, bitmap.width, bitmap.height) === null;
  } finally {
    closeBitmap(bitmap);
  }
}

function decodePng(bytes) {
  return createImageBitmap(new Blob([bytes], { type: "image/png" }));
}

// Рисует картинку на холсте её размера и отдаёт сырые байты пикселей RGBA.
function readPixels(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

function closeBitmap(bitmap) {
  if (typeof bitmap.close === "function") bitmap.close();
}

// Считает непрозрачные точки выборки по столбцам и по строкам.
function tallyOpaque(pixels, width, height) {
  const perColumn = new Array(width).fill(0);
  const perRow = new Array(height).fill(0);
  const hop = SAMPLE_STEP * 4;
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    let seen = 0;
    for (let x = 0, at = y * width * 4 + 3; x < width; x += SAMPLE_STEP, at += hop) {
      if (pixels[at] < OPAQUE_ALPHA) continue;
      perColumn[x] += 1;
      seen += 1;
    }
    perRow[y] = seen;
  }
  return [perColumn, perRow];
}

// Рамка ствола: границы по столбцам и строкам плюс запас на шаг выборки.
function opaqueBox(pixels, width, height) {
  const [perColumn, perRow] = tallyOpaque(pixels, width, height);
  const across = trimmedBounds(perColumn);
  const down = trimmedBounds(perRow);
  if (!across || !down) return null;
  const [left, right] = across;
  const [top, bottom] = down;
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left + SAMPLE_STEP),
    height: Math.max(1, bottom - top + SAMPLE_STEP),
  };
}

function isDarkPixel(pixels, at) {
  return (LUMA_RED * pixels[at] + LUMA_GREEN * pixels[at + 1] + LUMA_BLUE * pixels[at + 2]) / 255 < DARK_PIXEL_LIMIT;
}

// Доля тёмных точек среди непрозрачных внутри рамки.
function darkShareIn(pixels, width, height, box) {
  const yEnd = Math.min(height, box.y + box.height);
  const xEnd = Math.min(width, box.x + box.width);
  const hop = SAMPLE_STEP * 4;
  let solid = 0;
  let dark = 0;
  for (let y = box.y; y < yEnd; y += SAMPLE_STEP) {
    for (let x = box.x, at = (y * width + box.x) * 4; x < xEnd; x += SAMPLE_STEP, at += hop) {
      if (pixels[at + 3] < OPAQUE_ALPHA) continue;
      solid += 1;
      if (isDarkPixel(pixels, at)) dark += 1;
    }
  }
  return solid ? dark / solid : 0;
}

/* ---------- сборка листа ---------- */

// Картинки, которые надо закрыть при любом выходе из сборки.
class BitmapKeeper {
  constructor() {
    this.held = new Set();
  }

  hold(bitmap) {
    this.held.add(bitmap);
    return bitmap;
  }

  discard(bitmap) {
    if (this.held.delete(bitmap)) closeBitmap(bitmap);
  }

  release({ quiet = false } = {}) {
    const queue = [...this.held];
    this.held.clear();
    for (const bitmap of queue) {
      if (!quiet) {
        closeBitmap(bitmap);
        continue;
      }
      try {
        closeBitmap(bitmap);
      } catch {
        // закрытие не должно прятать исходную ошибку
      }
    }
  }
}

export async function composeCollage(shots, options = {}) {
  // Настройки разбираются на входе, до кадров: null вторым аргументом — TypeError сразу.
  const settings = readSettings(options);
  const keeper = new BitmapKeeper();
  try {
    const frames = await measureFrames(shots, keeper);
    if (frames.length === 0) throw new Error(EMPTY_SHEETS_TEXT);
    const sheet = drawSheet(frames, settings);
    keeper.release();
    return await encodePng(sheet);
  } catch (failure) {
    keeper.release({ quiet: true });
    throw failure;
  }
}

function readSettings(options) {
  return {
    backgroundId: settingOr(options.backgroundId, CATALOG_BACKGROUND),
    width: settingOr(options.width, COVER_SIZE.width),
    height: settingOr(options.height, COVER_SIZE.height),
  };
}

async function encodePng(canvas) {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

// Итоговый холст: фон, затем стволы по раскладке соседа.
function drawSheet(frames, { backgroundId, width, height }) {
  const backdrop = findBackdrop(backgroundId);
  const lifted = frames.some((frame) => needsBackdropLight(frame.darkShare, backdrop.color));
  const sheet = new OffscreenCanvas(width, height);
  const context = sheet.getContext("2d");
  paintBackdrop(context, backdrop, width, height, lifted);
  const { placed } = layoutCollage(frameSizes(frames), { width, height, safe: COVER_SAFE });
  for (const spot of placed) {
    const { bitmap, box } = frames[spot.index];
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, spot.x, spot.y, spot.w, spot.h);
  }
  return sheet;
}

// Каждый кадр обрабатывается целиком до следующего.
async function measureFrames(shots, keeper) {
  const kept = [];
  for (const shot of shots) {
    const frame = await measureShot(shot, keeper);
    if (frame !== null) kept.push(frame);
  }
  return kept;
}

// Пустой кадр закрывается сразу и в раскладку не попадает.
async function measureShot(shot, keeper) {
  const bitmap = keeper.hold(await decodePng(shot.bytes));
  const pixels = readPixels(bitmap);
  const box = opaqueBox(pixels, bitmap.width, bitmap.height);
  if (box === null) {
    keeper.discard(bitmap);
    return null;
  }
  const darkShare = darkShareIn(pixels, bitmap.width, bitmap.height, box);
  return { bitmap, box, darkShare, length: Number(shot.length) || 0 };
}

// Средняя из известных длин (больше нуля); если известных нет — 1.
function meanKnownLength(frames) {
  const known = frames.map((frame) => frame.length).filter((length) => length > 0);
  return known.length > 0 ? known.reduce((sum, length) => sum + length, 0) / known.length : 1;
}

// Размеры кадров в метрах: ширина — длина ствола (неизвестная — средняя), высота по рамке.
function frameSizes(frames) {
  const mean = meanKnownLength(frames);
  return frames.map(({ length, box }) => {
    const metres = length || mean;
    return { width: metres, height: (metres * box.height) / box.width };
  });
}

function settingOr(value, fallback) {
  return value === undefined ? fallback : value;
}

function findBackdrop(id) {
  const byId = (wanted) => SHOT_BACKGROUNDS.find((entry) => entry.id === wanted);
  return byId(id) ?? byId(CATALOG_BACKGROUND);
}

function paintBackdrop(context, backdrop, width, height, lifted) {
  const painter = BACKDROP_PAINTERS.find((candidate) => candidate.fits(backdrop));
  if (painter) painter.paint(context, backdrop, width, height, lifted);
}

/* ---------- таблицы и константы ---------- */

const BACKDROP_PAINTERS = [
  {
    fits: (backdrop) => backdrop.matte,
    paint: (context, backdrop, width, height, lifted) => {
      paintWorkshopMatte(context, width, height, lifted ? { base: WORKSHOP_MATTE_LIFTED_BASE } : {});
    },
  },
  {
    fits: (backdrop) => backdrop.color,
    paint: (context, backdrop, width, height) => {
      context.fillStyle = backdrop.color;
      context.fillRect(0, 0, width, height);
    },
  },
];

export const COVER_SIZE = Object.freeze({ width: 1200, height: 675 });
export const CATALOG_BACKGROUND = "transparent";

const EMPTY_SHEETS_TEXT = "На кадрах стволов нет ни одного ствола: рендер дал пустые листы.";
const HEX_DIGITS = "0123456789abcdef";
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const LUMA_WEIGHTS = [LUMA_RED, LUMA_GREEN, LUMA_BLUE];
const SAMPLE_STEP = 2;
const OPAQUE_ALPHA = 40;
const DARK_PIXEL_LIMIT = 0.2;
const DARK_SHARE_LIMIT = 0.25;
const BACKDROP_DIM_LIMIT = 0.3;
