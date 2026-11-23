/*
 * Листы для сцены попаданий: свои листы брызг и листы из игры игрока.
 *
 * Свой лист — та самая текстура, которая уедет в игру: её рисует общая
 * функция (`bloodSheetSvg` в `@modovik/ptfx-studio`), а здесь она только
 * растрируется браузером. Нарисуй окно свой лист отдельно — человек
 * настраивал бы одно, а получал другое; поэтому здесь нет ни одной кривой,
 * только загрузка SVG.
 *
 * Лист из игры — кадры настоящих листов ядра игрока (`readPtfxBase().impact.
 * sheets`): кровяная пыль, струи, дым, звёзды, цветы. Их приносит главный
 * процесс ужатыми до превью, и сцена рисует частицу тем же листом, что
 * рисует игра, — умноженным на цвет частицы, как делает шейдер.
 *
 * Загрузка асинхронная (браузер растрирует SVG и PNG через `Image`), а
 * рисовать сцену надо каждый кадр. Поэтому листы кэшируются по ключу, а те,
 * кто их ждёт, подписываются на готовность.
 */

import { bloodSheetSvg, findBloodSheet } from "@modovik/ptfx-studio";
import { context2d } from "./effects-preview.js";
import { setPngSource } from "../../../utils/png-source.js";

/* Сторона кадра своего листа в окне. Лист 512×512 на 4×4 — это 128 на кадр;
   больше в окне не нужно, а память на каждый оттенок кэша не бесконечна. */
const FRAME = 96;

const sheets = new Map();
const listeners = new Set();
const tinted = new Map();
/* Листы игры: что принесла база и что из них уже растрировано. */
let provided = new Map();
const gameSheets = new Map();

const keyOf = (style, uploadKey) =>
  `${style}:${style === "upload" ? uploadKey || "" : ""}`;

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Подписка на готовность листов: сцена и плитки перерисуются сами. */
export function onBloodSheetReady(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Холст листа брызг или `null`, пока он грузится.
 * `upload` — `{ dataUrl, key }` картинки человека для стиля «своя картинка».
 */
export function bloodSheetCanvas(style, upload = null) {
  const item = findBloodSheet(style);
  if (!item || item.game) return null;
  if (item.upload && !upload?.dataUrl) return null;
  const key = keyOf(style, upload?.key);
  const known = sheets.get(key);
  if (known) return known.canvas;
  if (typeof document === "undefined" || typeof Image === "undefined")
    return null;
  const columns = 4;
  const rows = 4;
  const canvas = document.createElement("canvas");
  canvas.width = FRAME * columns;
  canvas.height = FRAME * rows;
  /* Ключ самого листа: все листы одного размера, и кэш кадров без него
     отдавал бы сердечки вместо черепов — один раз нарисованный кадр всем. */
  const entry = { canvas: null, columns, rows, key };
  sheets.set(key, entry);
  let svg;
  try {
    svg = bloodSheetSvg(style, { upload: upload?.dataUrl });
  } catch {
    /* Стиль без картинки — не ошибка окна: плитка останется пустой. */
    return null;
  }
  const image = new Image();
  image.onload = () => {
    const context = context2d(canvas);
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    entry.canvas = canvas;
    notify();
  };
  image.onerror = () => sheets.delete(key);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return null;
}

/** Готовый лист со своей сеткой или `null`. */
export function bloodSheet(style, upload = null) {
  const canvas = bloodSheetCanvas(style, upload);
  if (!canvas) return null;
  const entry = sheets.get(keyOf(style, upload?.key));
  return { canvas, columns: entry.columns, rows: entry.rows, key: entry.key };
}

/**
 * Листы игры для сцены — как их принесла база: `{ имя: { png, columns,
 * rows } }`. Новая база сбрасывает растрированные листы и кадры.
 */
export function provideImpactSheets(source) {
  provided = new Map(
    Object.entries(source || {}).map(([name, sheet]) => [
      String(name).toLowerCase(),
      sheet,
    ]),
  );
  gameSheets.clear();
  tinted.clear();
  notify();
}

/** Есть ли у сцены листы игры вовсе. */
export const hasImpactSheets = () => provided.size > 0;

/*
 * Нейтральная копия листа — та же форма в оттенках серого. Так установщик
 * кладёт в ядро лист кровяной пыли: он несёт красный прямо в пикселях, и
 * синяя кровь на нём вышла бы чёрной. Яркость — старший канал, как там.
 */
function neutralize(canvas) {
  const context = context2d(canvas);
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.max(data[index], data[index + 1], data[index + 2]);
    data[index] = data[index + 1] = data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

/**
 * Лист игры по имени текстуры — `{ canvas, columns, rows, key }` или `null`,
 * пока грузится или когда базы нет. `neutral` — серая копия (лист кровяной
 * пыли для клона крови).
 */
export function gameSheet(name, { neutral = false } = {}) {
  const lower = String(name || "").toLowerCase();
  const source = provided.get(lower);
  if (!source?.png) return null;
  const key = `game:${lower}:${neutral ? "n" : "c"}`;
  const known = gameSheets.get(key);
  if (known) return known.canvas ? known : null;
  if (typeof document === "undefined" || typeof Image === "undefined")
    return null;
  const entry = {
    canvas: null,
    columns: Math.max(1, source.columns || 1),
    rows: Math.max(1, source.rows || 1),
    key,
  };
  gameSheets.set(key, entry);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || source.width || 1;
    canvas.height = image.naturalHeight || source.height || 1;
    const context = context2d(canvas);
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (neutral) neutralize(canvas);
    entry.canvas = canvas;
    notify();
  };
  image.onerror = () => gameSheets.delete(key);
  setPngSource(image, source.png);
  return null;
}

/* Оттенок в ключе кэша — с шагом в восемь: радуга рождает сотни оттенков, и
   без шага кэш кадров жил бы один кадр. */
const quantize = (channel) => Math.round(channel / 8) * 8;

/**
 * Один кадр листа, умноженный на цвет, — как это делает правило в игре.
 * `tint` — [r, g, b] 0…255 или `null` (кадр как есть).
 */
export function bloodSheetFrame(sheet, index, tint = null) {
  const source = sheet?.canvas;
  if (!source) return null;
  const columns = sheet.columns || 4;
  const rows = sheet.rows || 4;
  const frame =
    ((index % (columns * rows)) + columns * rows) % (columns * rows);
  const key = `${sheet.key || source.width}:${frame}:${
    tint ? tint.map(quantize).join(",") : "-"
  }`;
  const known = tinted.get(key);
  if (known) return known;
  /* Оттенков на палитре много, и каждый рождает кадры: без предела кэш
     растёт, пока цвет не отпустят. */
  if (tinted.size > 640) tinted.clear();
  const width = source.width / columns;
  const height = source.height / rows;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = context2d(canvas);
  if (!context) return null;
  context.drawImage(
    source,
    (frame % columns) * width,
    Math.floor(frame / columns) * height,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  if (tint) {
    context.globalCompositeOperation = "multiply";
    context.fillStyle = `rgb(${quantize(tint[0])}, ${quantize(tint[1])}, ${quantize(tint[2])})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    /* Умножение красит и прозрачное поле — альфа возвращается самим листом. */
    context.globalCompositeOperation = "destination-in";
    context.drawImage(
      source,
      (frame % columns) * width,
      Math.floor(frame / columns) * height,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }
  tinted.set(key, canvas);
  return canvas;
}

/*
 * Кадр для плитки выбора листа: у нарисованных брызг — середина всплеска, у
 * значка — первый кадр. `null`, пока лист грузится: плитка останется с
 * подписью, а перерисуется по подписке.
 */
export function bloodSheetThumbnail(style, colour = null, upload = null) {
  const item = findBloodSheet(style);
  if (!item || item.game) return null;
  const sheet = bloodSheet(style, upload);
  if (!sheet) return null;
  const frame = bloodSheetFrame(sheet, item.animated ? 6 : 0, colour);
  return frame ? frame.toDataURL("image/png") : null;
}
