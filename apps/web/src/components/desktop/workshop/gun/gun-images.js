import { tr } from "../../../../locales/ui.js";
import * as workshop from "../workshop-assets.js";
import * as emblemKit from "./gun-emblems.js";
import * as canvasKit from "./gun-canvas.js";

/* ---------- Источник картинки проекта -> элемент Image ---------- */

export const resolveGunImage = (source) => {
  const address = asText(source);
  return address === ""
    ? Promise.reject(REFUSALS.noPicture())
    : pictureMemo.obtain(address, pickPictureLoader(address));
};

const pickPictureLoader = (address) =>
  PICTURE_LOADERS.find(([prefix]) => address.startsWith(prefix))?.[1] ?? loadPlainAddress;

async function loadPlainAddress(address) {
  return canvasKit.loadImage(address);
}

async function loadEmblemPicture(address) {
  // разметку рисуем отдельной задачей: React в этот момент может быть занят отрисовкой
  await nextTask();
  const markup = emblemKit.emblemMarkup(address);
  return markup
    ? pictureFromBlob(new Blob([markup], { type: "image/svg+xml" }))
    : Promise.reject(REFUSALS.noEmblem());
}

async function loadWorkPicture(address) {
  const blob = await workshop.getWorkshopAsset(storeKey(workHash(address)));
  return blob ? pictureFromBlob(blob) : Promise.reject(REFUSALS.noWorkPicture());
}

// Адрес блоба живёт только на время загрузки: отзываем и после успеха, и после ошибки.
async function pictureFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  return decodeFrom(url).finally(() => URL.revokeObjectURL(url));
}

function decodeFrom(url) {
  const picture = new Image();
  const outcome = new Promise((resolve, reject) => {
    Object.assign(picture, {
      onload: () => resolve(picture),
      onerror: () => reject(REFUSALS.unreadable()),
    });
  });
  picture.src = url;
  return outcome;
}

const nextTask = () => new Promise((wake) => setTimeout(wake));

/* ---------- Файлы, растры и обложки в хранилище мастерской ---------- */

export async function storeGunImageFile(file) {
  const prepared = await workshop.prepareWorkshopAsset(file, { extensions: IMAGE_EXTENSIONS });
  const { hash, name } = prepared.metadata;
  await workshop.putWorkshopAsset(storeKey(hash), prepared.blob);
  const source = GUN_ASSET_PREFIX + hash;
  pictureMemo.forget(source);
  return { source, name: withoutExtension(name) };
}

export const storeGunRaster = (canvas) =>
  blobOfCanvas(canvas, "image/png").then((blob) => (blob ? putAsGunAsset(blob) : Promise.reject(REFUSALS.noRaster())));

export async function readGunAsset(source) {
  const hash = workHash(asText(source));
  return hash === null ? null : workshop.getWorkshopAsset(storeKey(hash));
}

export async function storeGunThumbnail(sceneCanvas, { width = COVER_WIDTH } = {}) {
  if (!hasWidth(sceneCanvas)) return "";
  const blob = await scaledSnapshot(sceneCanvas, width, COVER_QUALITY);
  return blob ? putAsGunAsset(blob) : "";
}

async function putAsGunAsset(blob) {
  const hash = await digestHex(blob);
  await workshop.putWorkshopAsset(storeKey(hash), blob);
  return `${GUN_ASSET_PREFIX}${hash}`;
}

async function digestHex(blob) {
  const bytes = await blob.arrayBuffer();
  const { subtle } = globalThis.crypto;
  let hex = "";
  for (const byte of new Uint8Array(await subtle.digest("SHA-256", bytes))) hex += HEX_PAIRS[byte];
  return hex;
}

/* ---------- Холсты ---------- */

const makeCanvas = (width, height) => Object.assign(document.createElement("canvas"), { width, height });
const contextOf = (canvas) => canvas.getContext("2d");

function penOf(canvas) {
  const pen = contextOf(canvas);
  if (!pen) throw new TypeError("2D context is not available");
  return pen;
}

// Тип и качество уходят в toBlob как есть: без качества третий аргумент не передаётся вовсе.
function blobOfCanvas(canvas, ...encoding) {
  return new Promise((deliver) => {
    canvas.toBlob(deliver, ...encoding);
  });
}

async function scaledSnapshot(scene, widthCap, quality) {
  const ratio = Math.min(1, widthCap / scene.width);
  const size = [scene.width, scene.height].map((side) => Math.max(1, Math.round(side * ratio)));
  const canvas = makeCanvas(...size);
  penOf(canvas).drawImage(scene, 0, 0, ...size);
  return blobOfCanvas(canvas, "image/webp", quality);
}

/* ---------- Надпись ---------- */

export function textArtwork(spec = {}) {
  const { text = "", font = "sans", fontAsset = "" } = spec;
  const label = asText(text).trim();
  if (label === "" || typeof document === "undefined") return null;

  const ownFont = (font === "custom" && fontAsset) || "";
  const key = [font, ownFont, label].map(String).join("|");
  return labelCache.get(key) ?? makeLabel({ key, label, font, fontAsset, ownFont });
}

function makeLabel({ key, label, font, fontAsset, ownFont }) {
  const face = canvasKit.layerFont({ font, fontAsset }, LABEL_KEGL);
  const width = labelWidth(face, label);
  if (width === null) return null;

  const canvas = paintLabel(label, face, width);
  canvas.astralKey = `text:${key}`;
  // со своим шрифтом, который ещё не загрузился, холст не запоминаем: выйдет запасным шрифтом
  if (ownFont === "" || fontIsLoaded(face)) labelCache.put(key, canvas);
  return canvas;
}

// Ширину меряем на пробном холсте; нет контекста — надписи не будет вовсе.
function labelWidth(face, label) {
  const probe = contextOf(document.createElement("canvas"));
  if (!probe) return null;
  probe.font = face;
  const raw = Math.ceil(probe.measureText(label).width || LABEL_KEGL);
  return clamp(raw + LABEL_PADDING, 1, LABEL_MAX_WIDTH);
}

function paintLabel(label, face, width) {
  const canvas = makeCanvas(width, LABEL_HEIGHT);
  const style = { font: face, textAlign: "center", textBaseline: "middle", fillStyle: "#ffffff" };
  Object.assign(penOf(canvas), style).fillText(label, width / 2, LABEL_HEIGHT / 2, width);
  return canvas;
}

function fontIsLoaded(face) {
  const fonts = document.fonts;
  return Boolean(fonts && typeof fonts.check === "function" && fonts.check(face));
}

/* ---------- Наклейка: трафарет, тон, кайма ---------- */

export function stickerArtwork(image, options = {}) {
  const { tint = "", outline = 0, outlineColour = "#ffffff", stencil = 0, stencilInvert = false } = options;
  if (!image) return null;

  const art = image.astralKey || image.src || "";
  const key = [art, tint, outline, outlineColour, stencil, stencilInvert].map(String).join("|");
  const look = { tint, outline, outlineColour, stencil, stencilInvert };
  return stickerCache.get(key) ?? stickerCache.put(key, composeSticker(image, look));
}

function composeSticker(image, look) {
  const { dims, border } = plateGeometry(image, look.outline);
  const result = makeCanvas(dims[0] + border * 2, dims[1] + border * 2);
  const resultPen = penOf(result);
  const plate = makeCanvas(...dims);
  const platePen = penOf(plate);
  platePen.drawImage(image, 0, 0, ...dims);

  const stenciled = look.stencil > 0;
  const finishing = [
    [stenciled, () => carveStencil(platePen, dims, look.stencil, look.stencilInvert)],
    [Boolean(look.tint), () => flood(platePen, look.tint, dims)],
  ];
  for (const [applies, run] of finishing) {
    if (applies) run();
  }

  if (border > 0) {
    // силуэт для каймы берём с заготовки, только если на ней уже есть трафарет
    const rim = silhouette(stenciled ? plate : image, look.outlineColour, dims);
    for (const [x, y] of ringPoints(border, RIM_COPIES)) resultPen.drawImage(rim, x, y);
  }

  resultPen.drawImage(plate, border, border);
  return result;
}

function plateGeometry(image, outline) {
  const natural = [image.naturalWidth || image.width, image.naturalHeight || image.height];
  const shrink = Math.min(1, STICKER_LIMIT / Math.max(1, ...natural));
  const dims = natural.map((side) => Math.max(1, Math.round(side * shrink)));
  const border = Math.round(Math.max(...dims) * (outline / 100));
  return { dims, border };
}

function flood(pen, colour, dims) {
  Object.assign(pen, { globalCompositeOperation: "source-in", fillStyle: colour });
  pen.fillRect(0, 0, ...dims);
}

function silhouette(source, colour, dims) {
  const canvas = makeCanvas(...dims);
  const pen = penOf(canvas);
  pen.drawImage(source, 0, 0, ...dims);
  flood(pen, colour, dims);
  return canvas;
}

// Трафарет: прозрачность растёт от нуля до единицы в полосе ±6 ступеней яркости у порога.
const featherShare = (gap) => clamp((gap + 6) / 12, 0, 1);

function carveStencil(pen, dims, level, lightMode) {
  const frame = pen.getImageData(...ORIGIN, ...dims);
  const data = frame.data;
  const cut = (level / 100) * 255;
  const side = lightMode ? 1 : -1;
  for (let at = 0, end = data.length; at < end; at += 4) {
    const luma = 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];
    data[at + 3] = Math.round(data[at + 3] * featherShare(side * (luma - cut)));
  }
  pen.putImageData(frame, ...ORIGIN);
}

const ringPoints = (radius, count) =>
  Array.from({ length: count }, (_, k) => {
    const turn = (k / count) * 2 * Math.PI;
    return [Math.cos(turn), Math.sin(turn)].map((unit) => radius + unit * radius);
  });

/* ---------- Миниатюры стволов и вещей ---------- */

export async function storeModelThumbnail(model, sceneCanvas) {
  if (!model || !hasWidth(sceneCanvas)) return "";
  const blob = await scaledSnapshot(sceneCanvas, MODEL_THUMB_WIDTH, MODEL_THUMB_QUALITY);
  return blob ? persistThumb(model, blob, { wait: true }) : "";
}

export async function storeModelThumbnailBlob(model, blob) {
  return model && blob ? persistThumb(model, blob, { wait: true }) : "";
}

// Единственная синхронная: адрес отдаём сразу, запись идёт следом, её ошибка не важна.
export function keepModelThumbnailBlob(model, blob) {
  return model && blob ? persistThumb(model, blob, { wait: false }) : "";
}

// wait: ждать запись и отдать адрес после неё; иначе отдать адрес сразу, а запись молча довести.
function persistThumb(model, blob, { wait }) {
  const writing = workshop.putWorkshopAsset(thumbKey(model), blob);
  if (wait) return writing.then(() => blobAddress(blob));
  writing.catch(noop);
  return blobAddress(blob);
}

export async function forgetModelThumbnail(model) {
  await workshop.deleteWorkshopAsset(thumbKey(model));
}

export async function readModelThumbnail(model) {
  const blob = await attempt(() => workshop.getWorkshopAsset(thumbKey(model)), null);
  return blob ? blobAddress(blob) : "";
}

export async function storedModelThumbnails(models) {
  requireList(models);
  const present = await sharedKeySweep();
  const found = new Set();
  for (const model of models) {
    if (present.has(thumbKey(model))) found.add(model);
  }
  return found;
}

export async function readModelThumbnails(models) {
  requireList(models);
  const keys = models.map(thumbKey);
  const blobs = await attempt(() => workshop.getWorkshopAssets(keys), null);
  const urls = new Map();
  if (blobs === null) return urls;

  models.forEach((model, at) => {
    const blob = blobs.get(keys[at]);
    if (blob) urls.set(model, blobAddress(blob));
  });
  return urls;
}

// Одновременные вопросы делят один обход ключей; закончился — следующий начнёт новый.
function sharedKeySweep() {
  if (keySweep === null) {
    const run = attempt(() => workshop.listWorkshopAssetKeys(THUMB_PREFIX), []).then((keys) => new Set(keys));
    run.then(() => {
      keySweep = null;
    });
    keySweep = run;
  }
  return keySweep;
}

function requireList(models) {
  if (!Array.isArray(models)) throw new TypeError("models must be an array");
}

/* ---------- Мелкие помощники ---------- */

function asText(value) {
  return value ? String(value) : "";
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function storeKey(hash) {
  return `gun:${hash}`;
}

function thumbKey(model) {
  return THUMB_PREFIX + asText(model).replace(/[^\w+-]/g, "");
}

// хеш картинки работы из адреса `asset:gun:<хеш>`; для чужого адреса null
function workHash(address) {
  return address.startsWith(GUN_ASSET_PREFIX) ? address.slice(GUN_ASSET_PREFIX.length) : null;
}

function withoutExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

const hasWidth = (scene) => Boolean(scene && scene.width);
const blobAddress = (blob) => URL.createObjectURL(blob);
const noop = () => {};

// Выполнить задачу; при отказе (в том числе синхронном) вернуть запасное значение.
async function attempt(task, fallback) {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

/* ---------- Память окна и константы ---------- */

// Загрузки картинок по адресу: одно обещание на адрес, отказ из памяти уходит.
class PictureMemo {
  #entries = new Map();

  obtain(address, load) {
    const known = this.#entries.get(address);
    if (known) return known;

    const run = load(address);
    this.#entries.set(address, run);
    run.then(undefined, () => {
      if (this.#entries.get(address) === run) this.#entries.delete(address);
    });
    return run;
  }

  forget(address) {
    this.#entries.delete(address);
  }
}

// Кэш с вытеснением по порядку добавления: обращения порядок не меняют.
class AgeLimitedCache extends Map {
  constructor(limit) {
    super();
    this.limit = limit;
  }

  put(key, value) {
    if (this.size > this.limit) {
      const [oldest] = this.keys();
      this.delete(oldest);
    }
    this.set(key, value);
    return value;
  }
}

export const GUN_ASSET_PREFIX = "asset:gun:";
const EMBLEM_PREFIX = "emblem:";
const THUMB_PREFIX = "gunthumb3:";

const IMAGE_EXTENSIONS = new Set("png jpg jpeg webp".split(" "));
const ORIGIN = [0, 0];
const HEX_PAIRS = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, "0"));

const COVER_WIDTH = 480;
const COVER_QUALITY = 0.86;
const MODEL_THUMB_WIDTH = 320;
const MODEL_THUMB_QUALITY = 0.82;

const LABEL_KEGL = 160;
const LABEL_PADDING = 64;
const LABEL_HEIGHT = Math.round(LABEL_KEGL * 1.45);
const LABEL_MAX_WIDTH = 2048;
const STICKER_LIMIT = 512;
const RIM_COPIES = 24;

// Тексты отказов переводятся в момент отказа, поэтому здесь функции, а не готовые ошибки.
const REFUSALS = {
  noPicture: () => new Error(tr("Нет картинки.")),
  noEmblem: () => new Error(tr("Такой эмблемы нет.")),
  noWorkPicture: () => new Error(tr("Картинка работы не найдена на этом компьютере.")),
  unreadable: () => new Error(tr("Не удалось прочитать картинку.")),
  noRaster: () => new Error(tr("Растр не сохранился.")),
};

const PICTURE_LOADERS = [
  [EMBLEM_PREFIX, loadEmblemPicture],
  [GUN_ASSET_PREFIX, loadWorkPicture],
];

const pictureMemo = new PictureMemo();
const labelCache = new AgeLimitedCache(32);
const stickerCache = new AgeLimitedCache(64);
let keySweep = null;
