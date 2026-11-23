/*
 * Рисунок групповой метки для окна: карточка каталога, кадр и обложка (задача 21 ТЗ 18.10.2026).
 *
 * Метку собирает то же правило, что у установщика (`@modovik/minimap-contract/group-markers`):
 *   как в игре — лист из игры игрока (`readGroupMarkers` отдаёт его картинкой);
 *   свой цвет  — тот же лист, `recolourMark` — тем же кодом, что перекрасит его в игре;
 *   картинка   — вписана целиком по центру листа (как `fitted` у установщика), вокруг прозрачно;
 *   надпись    — то же, что картинка: окно рисует слова PNG-ом (`renderGroupMarkerText`);
 *   убрать     — метки нет.
 * Отделка (размер, обводка или свечение, прозрачность, тонировка картинки) — поверх, тем же `finishMark`, что у
 * установщика: на листах, не на накладках радара.
 * Игры под окном нет (браузер, песочница) — рисунок нарисован Astral очерком листа Rockstar, и
 * кадр об этом говорит: правило поставки.
 */

import { GROUP_MARKER_DEFAULT_COLOUR, finishMark, hasGroupMarkerFinish, recolourMark } from "@modovik/minimap-contract/group-markers";
import { READBACK, context2d } from "../../../components/desktop/workshop/canvas-surface.js";

function blankCanvas(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Картинка из PNG base64 → Image (или `null`). */
export function loadPngImage(png) {
  if (!png || typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = `data:image/png;base64,${png}`;
  });
}

/*
 * Пропорции рисунка метки: как у самого крупного из её листов; у накладки радара листов нет — габарит штатной
 * накладки (`box`, точки экрана) из чтения игры, а нет его — квадрат.
 */
export function markAspect(mark, box = null) {
  if (mark.overlay) return box?.width && box?.height ? { width: box.width, height: box.height } : { width: 1, height: 1 };
  const target = [...mark.targets].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return { width: target.width, height: target.height };
}

export function markSize(mark, edge, box = null) {
  const { width, height } = markAspect(mark, box);
  const long = Math.max(width, height);
  return { width: Math.max(1, Math.round((edge * width) / long)), height: Math.max(1, Math.round((edge * height) / long)) };
}

/*
 * Нарисованный очерк на случай, когда листа из игры нет: знак «Внимание» — треугольник, остальные —
 * кольцо; чтобы кадр жил и без игры, но не выдавал нарисованное за лист Rockstar.
 */
function drawnStock(mark, canvas) {
  const context = context2d(canvas, READBACK);
  if (!context) return null;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, Math.min(width, height) * 0.08);
  context.strokeStyle = "#000000";
  context.fillStyle = "#ffffff";
  if (mark.id === "warning" || mark.id === "overlay-supplies") {
    const pad = width * 0.1;
    context.beginPath();
    context.moveTo(width / 2, pad);
    context.lineTo(width - pad, height - pad);
    context.lineTo(pad, height - pad);
    context.closePath();
    context.stroke();
    context.fill();
    context.fillStyle = "#000000";
    context.fillRect(width / 2 - width * 0.05, height * 0.36, width * 0.1, height * 0.28);
    context.fillRect(width / 2 - width * 0.05, height * 0.7, width * 0.1, height * 0.08);
  } else {
    const radius = Math.min(width, height) * 0.42;
    context.beginPath();
    context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    context.arc(width / 2, height / 2, radius * 0.78, 0, Math.PI * 2, true);
    context.fill("evenodd");
  }
  return canvas;
}

/* Отделка поверх готового рисунка — теми же пикселями, что получит лист в игре. */
function finished(canvas, edit) {
  if (!canvas || !hasGroupMarkerFinish(edit)) return canvas;
  const context = context2d(canvas, READBACK);
  if (!context) return canvas;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  finishMark(pixels.data, canvas.width, canvas.height, edit);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Метка в облике правки → холст `edge` по длинной стороне или `null` (убрана).
 * `stockImage` — лист из игры (Image) или `null`; `picture` — своя картинка `{ image, frames? }` или `null` (у гифки
 * накладки радара `frames` — кадры холстами, `frame` — какой нарисовать); `box` — габарит накладки радара.
 * `drawn` — рисунок нарисован Astral, а не взят из игры.
 */
export function composeMark({ mark, edit = null, stockImage = null, picture = null, edge = 128, box = null, frame = 0 }) {
  const mode = edit?.mode || "stock";
  if (mode === "hidden") return { canvas: null, drawn: false };
  const { width, height } = markSize(mark, edge, box);
  const canvas = blankCanvas(width, height);
  if (!canvas) return { canvas: null, drawn: false };
  const context = context2d(canvas, READBACK);
  if (!context) return { canvas: null, drawn: false };
  const withFinish = (done) => (mark.overlay ? done : finished(done, edit));
  if (mode === "image" || mode === "text") {
    const source = picture?.frames?.length ? picture.frames[frame % picture.frames.length] : picture?.image || null;
    if (!source) return { canvas: withFinish(drawnStock(mark, canvas)), drawn: true };
    const imageWidth = source.naturalWidth || source.width;
    const imageHeight = source.naturalHeight || source.height;
    const scale = Math.min(width / imageWidth, height / imageHeight);
    const w = Math.max(1, Math.round(imageWidth * scale));
    const h = Math.max(1, Math.round(imageHeight * scale));
    context.imageSmoothingQuality = "high";
    context.drawImage(source, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
    return { canvas: withFinish(canvas), drawn: false };
  }
  let drawn = false;
  if (stockImage) {
    context.imageSmoothingEnabled = false;
    context.drawImage(stockImage, 0, 0, width, height);
  } else {
    drawnStock(mark, canvas);
    drawn = true;
  }
  if (mode === "colour") {
    const pixels = context.getImageData(0, 0, width, height);
    recolourMark(pixels.data, edit?.color || GROUP_MARKER_DEFAULT_COLOUR);
    context.putImageData(pixels, 0, 0);
  }
  return { canvas: withFinish(canvas), drawn };
}

/**
 * Спрайт кадра: метка и под ней подпись расстояния — как над миром в игре. Холст — размером с
 * содержимое, метка по центру, подпись под ней белым с тёмной обводкой.
 */
export function markSpriteCanvas({ markCanvas, text, edge = 128 }) {
  if (typeof document === "undefined") return null;
  const family = typeof getComputedStyle === "function" ? getComputedStyle(document.body).fontFamily || "sans-serif" : "sans-serif";
  const fontSize = Math.round(edge * 0.34);
  const measure = blankCanvas(8, 8)?.getContext("2d");
  if (!measure) return null;
  measure.font = `600 ${fontSize}px ${family}`;
  const textWidth = Math.ceil(measure.measureText(text).width);
  const gap = Math.round(edge * 0.06);
  const markWidth = markCanvas?.width || 0;
  const markHeight = markCanvas?.height || 0;
  const pad = Math.round(edge * 0.08);
  const width = Math.max(markWidth, textWidth) + pad * 2;
  const height = (markCanvas ? markHeight + gap : 0) + fontSize + pad * 2;
  const canvas = blankCanvas(width, height);
  const context = canvas?.getContext("2d");
  if (!context) return null;
  if (markCanvas) context.drawImage(markCanvas, Math.round((width - markWidth) / 2), pad);
  context.font = `600 ${fontSize}px ${family}`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.lineWidth = Math.max(3, fontSize * 0.2);
  context.strokeStyle = "rgba(0, 0, 0, 0.85)";
  const y = pad + (markCanvas ? markHeight + gap : 0);
  context.strokeText(text, width / 2, y);
  context.fillStyle = "#ffffff";
  context.fillText(text, width / 2, y);
  return canvas;
}
