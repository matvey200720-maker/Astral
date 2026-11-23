/*
 * Сборка документа студии (ТЗ 18.10.2026, Session 1, задача 6): слои снизу
 * вверх на плоский холст `flat` размера документа — с режимом смешивания,
 * непрозрачностью и маской каждого. Собирается любой кусок (`rect`): мазок
 * кистью пересобирает только то место, где лёг, а не весь лист 8089 × 1280.
 *
 * Режимы смешивания — настоящие режимы холста (16 штук, `document.js`): их
 * считает браузер. Растровый слой без маски кладётся прямо; слою с маской и
 * слою из рисунка (надпись, фигура, заливка, картинка) сперва собирается
 * отдельный «лист» (`scratch`) — режим ложится на готовый слой, а не на
 * каждый его штрих. Корректирующий слой читает то, что собрано под ним,
 * правит пиксели (`adjust.js`) и кладёт обратно в долю своей непрозрачности.
 *
 * Большие холсты (лист 8178 × 1389 — 45 МБ на слой) нельзя брать источником
 * `drawImage` на каждую точку мазка: браузер делает снимок буфера, и следующая
 * запись в него копирует все 45 МБ (замер: точка кисти 13 мс вместо 0,1).
 * Поэтому небольшой кусок (до мегапикселя) слой отдаёт через `getImageData` в
 * маленький холст из пула — точка стоит размер куска, а не размер листа.
 */

import { blendOperation } from "./engine/document.js";
import { applyAdjustment, adjustIsIdentity } from "./engine/adjust.js";
import { gradientEndpoints } from "./engine/fill.js";
import { clampRect, createSurface, maskKey } from "./raster-store.js";
import { ownFontStack } from "../emblem/own-font.js";

/* Шрифты надписей: системные (своих начертаний студия не возит). */
export const TEXT_FONT_STACKS = Object.freeze({
  sans: '600 {size}px "Segoe UI", "Inter", system-ui, sans-serif',
  serif: '700 {size}px Georgia, "Times New Roman", serif',
  mono: '700 {size}px Consolas, "Cascadia Mono", "Courier New", monospace',
  stencil: '400 {size}px Stencil, "Stencil Std", Impact, "Arial Black", sans-serif',
  script: 'italic 700 {size}px "Segoe Script", "Brush Script MT", "Segoe Print", cursive',
  block: '900 {size}px "Arial Black", "Segoe UI Black", Impact, sans-serif',
});
export const textFont = (layer) =>
  layer.font === "custom" && layer.fontAsset
    ? `700 ${layer.size}px ${ownFontStack(layer.fontAsset, '"Segoe UI", system-ui, sans-serif')}`
    : (TEXT_FONT_STACKS[layer.font] || TEXT_FONT_STACKS.sans).replace("{size}", String(layer.size));
const LINE_HEIGHT = 1.2;
/* Кусок до мегапикселя собирается карманами, больше — обычным `drawImage` (одно снятие снимка на весь лист). */
const PIECE_PIXELS = 1024 * 1024;

const rgba = (hex, alpha = 1) => {
  const value = Number.parseInt(String(hex || "#000000").slice(1), 16) || 0;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/** Строки надписи и её размеры (для рамки выделения слоя): `{ lines, width, height }`. */
export function measureText(context, layer) {
  context.font = textFont(layer);
  const lines = String(layer.value || "").split("\n");
  const width = Math.max(1, ...lines.map((line) => context.measureText(line).width));
  return { lines, width, height: lines.length * layer.size * LINE_HEIGHT };
}

function paintText(context, layer) {
  if (!layer.value) return;
  const { lines, width } = measureText(context, layer);
  context.save();
  context.translate(layer.x, layer.y);
  context.rotate((layer.rotate * Math.PI) / 180);
  context.font = textFont(layer);
  context.fillStyle = rgba(layer.colour);
  context.textBaseline = "top";
  context.textAlign = layer.align;
  const shift = layer.align === "center" ? width / 2 : layer.align === "right" ? width : 0;
  lines.forEach((line, index) => context.fillText(line, shift, index * layer.size * LINE_HEIGHT));
  context.restore();
}

/* Стрелка: линия и наконечник из двух крыльев. */
function paintArrow(context, layer) {
  const { x1, y1, x2, y2, strokeWidth } = layer;
  const head = Math.max(strokeWidth * 3, 12);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  context.stroke();
}

function paintShape(context, layer) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = layer.strokeWidth;
  context.strokeStyle = rgba(layer.stroke);
  const x = Math.min(layer.x1, layer.x2);
  const y = Math.min(layer.y1, layer.y2);
  const width = Math.abs(layer.x2 - layer.x1);
  const height = Math.abs(layer.y2 - layer.y1);
  if (layer.shape === "line" || layer.shape === "arrow") {
    if (layer.strokeWidth > 0) {
      if (layer.shape === "arrow") paintArrow(context, layer);
      else {
        context.beginPath();
        context.moveTo(layer.x1, layer.y1);
        context.lineTo(layer.x2, layer.y2);
        context.stroke();
      }
    }
  } else {
    context.beginPath();
    if (layer.shape === "ellipse") context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    else context.rect(x, y, width, height);
    if (layer.fill) {
      context.fillStyle = rgba(layer.fill);
      context.fill();
    }
    if (layer.strokeWidth > 0) context.stroke();
  }
  context.restore();
}

function paintFill(context, layer, width, height, rect) {
  if (!layer.gradient) {
    context.fillStyle = rgba(layer.colour);
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    return;
  }
  const { from, to } = gradientEndpoints(width, height, layer.gradient.angle);
  let gradient;
  if (layer.gradient.kind === "radial") {
    const radius = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
    gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(1, radius));
  } else gradient = context.createLinearGradient(from[0], from[1], to[0], to[1]);
  for (const stop of layer.gradient.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.at)), rgba(stop.colour, stop.alpha));
  context.fillStyle = gradient;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function paintImage(context, layer, bitmap) {
  if (!bitmap) return;
  context.save();
  context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  context.rotate((layer.rotate * Math.PI) / 180);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
  context.restore();
}

/**
 * Сборщик документа. `store` — хранилище холстов (`raster-store.js`),
 * `assets` — `Map` ключ картинки → `ImageBitmap` (что ещё едет, слоя не видно).
 */
export function createCompositor({ store, assets = new Map() }) {
  let flat = createSurface(store.width, store.height);
  let scratch = null;

  /* Маленькие холсты-«карманы»: слой, лист слоя, маска, кусок для экрана. Растут шагами по 128. */
  const pools = new Map();
  const pool = (name, width, height) => {
    let slot = pools.get(name);
    if (!slot || slot.width < width || slot.height < height) {
      const round = (value) => Math.ceil(value / 128) * 128;
      slot = createSurface(round(Math.max(width, slot?.width || 0)), round(Math.max(height, slot?.height || 0)));
      pools.set(name, slot);
    }
    return slot;
  };
  const isPiece = (area) => area.width * area.height <= PIECE_PIXELS;
  /* Кусок слоя `surface` в кармане: `{ canvas }`, откуда рисуют область `rect` от (0, 0). */
  const layerPiece = (name, surface, rect) => {
    const slot = pool(name, rect.width, rect.height);
    slot.context.putImageData(surface.context.getImageData(rect.x, rect.y, rect.width, rect.height), 0, 0);
    return slot;
  };

  const scratchFor = () => {
    if (!scratch || scratch.width < store.width || scratch.height < store.height) scratch = createSurface(store.width, store.height);
    return scratch;
  };

  /* Слой — рисунком на прозрачном листе `context` (с учётом общих координат документа). */
  function paintLayer(context, layer, doc, rect) {
    if (layer.type === "base" || layer.type === "raster") {
      const surface = store.has(layer.id) ? store.get(layer.id) : null;
      if (!surface) return;
      if (isPiece(rect)) {
        const slot = layerPiece("layer", surface, rect);
        context.drawImage(slot.canvas, 0, 0, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
      } else context.drawImage(surface.canvas, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
    } else if (layer.type === "image") paintImage(context, layer, assets.get(layer.asset));
    else if (layer.type === "text") paintText(context, layer);
    else if (layer.type === "shape") paintShape(context, layer);
    else if (layer.type === "fill") paintFill(context, layer, doc.width, doc.height, rect);
  }

  function maskWeights(layer, rect) {
    const piece = store.has(maskKey(layer.id)) ? store.read(maskKey(layer.id), rect) : null;
    if (!piece) return null;
    const out = new Uint8Array(piece.width * piece.height);
    for (let at = 0; at < out.length; at += 1) out[at] = piece.data[at * 4 + 3];
    return { width: piece.width, height: piece.height, data: out };
  }

  function applyAdjustLayer(context, layer, rect) {
    if (adjustIsIdentity(layer.kind, layer.params)) return;
    const image = context.getImageData(rect.x, rect.y, rect.width, rect.height);
    const adjusted = new Uint8ClampedArray(image.data);
    if (!applyAdjustment(adjusted, rect.width, rect.height, layer.kind, layer.params)) return;
    const mask = layer.mask ? maskWeights(layer, rect) : null;
    const k = layer.opacity / 100;
    const original = image.data;
    for (let at = 0; at < original.length; at += 4) {
      const weight = k * (mask ? mask.data[at / 4] / 255 : 1);
      if (weight <= 0) continue;
      for (let channel = 0; channel < 3; channel += 1) original[at + channel] += (adjusted[at + channel] - original[at + channel]) * weight;
    }
    context.putImageData(image, rect.x, rect.y);
  }

  /**
   * Собрать кусок `rect` документа `doc` в `flat` (весь, если `rect` пуст).
   * Ответ — собранный кусок.
   */
  function render(doc, rect = null) {
    if (!flat) return null;
    const area = clampRect(rect || { x: 0, y: 0, width: doc.width, height: doc.height }, doc.width, doc.height);
    if (!area) return null;
    const context = flat.context;
    context.save();
    context.beginPath();
    context.rect(area.x, area.y, area.width, area.height);
    context.clip();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(area.x, area.y, area.width, area.height);
    if (doc.background !== "transparent") {
      context.fillStyle = doc.background;
      context.fillRect(area.x, area.y, area.width, area.height);
    }
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      if (layer.type === "adjust") {
        applyAdjustLayer(context, layer, area);
        continue;
      }
      const operation = blendOperation(layer.blend);
      const direct = (layer.type === "raster" || layer.type === "base") && !layer.mask;
      if (direct) {
        context.globalAlpha = layer.opacity / 100;
        context.globalCompositeOperation = operation;
        paintLayer(context, layer, doc, area);
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
        continue;
      }
      const piece = isPiece(area);
      const sheet = piece ? pool("sheet", area.width, area.height) : scratchFor();
      const sheetContext = sheet.context;
      sheetContext.save();
      if (piece) {
        /* Лист — по размеру куска: слой рисуется со сдвигом, координаты документа остаются прежними. */
        sheetContext.setTransform(1, 0, 0, 1, 0, 0);
        sheetContext.clearRect(0, 0, sheet.width, sheet.height);
        sheetContext.translate(-area.x, -area.y);
      } else {
        sheetContext.beginPath();
        sheetContext.rect(area.x, area.y, area.width, area.height);
        sheetContext.clip();
        sheetContext.clearRect(area.x, area.y, area.width, area.height);
      }
      paintLayer(sheetContext, layer, doc, area);
      if (layer.mask && store.has(maskKey(layer.id))) {
        sheetContext.globalCompositeOperation = "destination-in";
        if (piece) {
          const slot = layerPiece("mask", store.get(maskKey(layer.id)), area);
          sheetContext.drawImage(slot.canvas, 0, 0, area.width, area.height, area.x, area.y, area.width, area.height);
        } else sheetContext.drawImage(store.get(maskKey(layer.id)).canvas, area.x, area.y, area.width, area.height, area.x, area.y, area.width, area.height);
      }
      sheetContext.restore();
      context.globalAlpha = layer.opacity / 100;
      context.globalCompositeOperation = operation;
      if (piece) context.drawImage(sheet.canvas, 0, 0, area.width, area.height, area.x, area.y, area.width, area.height);
      else context.drawImage(sheet.canvas, area.x, area.y, area.width, area.height, area.x, area.y, area.width, area.height);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    }
    context.restore();
    return area;
  }

  return {
    get flat() {
      return flat;
    },
    render,
    /**
     * Кусок собранного холста для экрана: `{ canvas, area }` — маленький
     * холст из кармана, откуда рисуют область `area` от (0, 0); `null`, если
     * кусок велик (экран тогда берёт весь холст). Карман общий: рисовать из
     * него нужно сразу, до следующего вызова.
     */
    piece(rect) {
      if (!flat) return null;
      const area = clampRect(rect, store.width, store.height);
      if (!area || !isPiece(area)) return null;
      const slot = layerPiece("view", flat, area);
      return { canvas: slot.canvas, area };
    },
    /** Документ стал другого размера: плоский холст и лист — заново. */
    resize() {
      flat = createSurface(store.width, store.height);
      scratch = null;
      pools.clear();
    },
    dispose() {
      flat = null;
      scratch = null;
      pools.clear();
    },
  };
}

/** Плоская картинка документа в PNG: `Blob` или `null`. */
export async function exportBlob(compositor, type = "image/png", quality = undefined) {
  const canvas = compositor.flat?.canvas;
  if (!canvas) return null;
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}
