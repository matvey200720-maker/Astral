/*
 * Рисунок на полотне «Билбордов» картинкой (задача 3 ТЗ 17.10.2026).
 *
 * Шаги рисунка (`look.drawing.ops`, договор `billboard-drawing.js`) окно
 * проигрывает на холсте браузера: штрих кисти — линией со скруглёнными
 * концами (мягкость — размытием края, непрозрачность — у штриха целиком,
 * без наслоения внутри штриха), ластик — тем же штрихом «стирая»,
 * заливка — по самому рисунку (прозрачное — одна область, контур её
 * держит), надпись — шрифтом окна. Тот же холст — в кадре окна и в
 * «Применить» (`drawingPngBase64`): что видно, то и уедет в игру.
 *
 * Холсты кэшируются по шагам: новый штрих дорисовывается на копии
 * прежнего холста, а «Отменить» берёт холст короче из кэша.
 */

import { billboardDrawingFontAssets, billboardDrawingHas, billboardDrawingKey } from "@modovik/climb-contract/recolor/billboards";
import { isEmblemFontReady } from "../emblem/emblem-fonts.js";
import { ownFontStack, prepareOwnFonts } from "../emblem/own-font.js";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";

/* Шрифты надписи: семейства окна (Electron на Windows), без загрузки из сети. */
export const DRAWING_FONT_STACKS = Object.freeze({
  sans: '"Segoe UI", "Inter", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Courier New", monospace',
  display: 'Impact, "Arial Black", sans-serif',
});

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

/** Размытие края кисти (px холста): жёсткая — без размытия, мягкая — до четверти размера. */
export const brushBlur = (size, hardness) => Math.max(0, ((100 - hardness) / 100) * size * 0.25);

/* Путь штриха: точки подряд; одна точка — кружок. */
function tracePath(context, points) {
  context.beginPath();
  context.moveTo(points[0], points[1]);
  if (points.length === 2) context.lineTo(points[0] + 0.01, points[1]);
  for (let at = 2; at + 1 < points.length; at += 2) context.lineTo(points[at], points[at + 1]);
}

/**
 * Штрих на слой: кисть или ластик. `scratch` — холст того же размера для
 * штриха целиком (непрозрачность и мягкость — у штриха, а не у каждого
 * отрезка).
 */
export function paintStroke(layer, scratch, op) {
  const sketch = context2d(scratch);
  if (!sketch) return;
  sketch.clearRect(0, 0, scratch.width, scratch.height);
  sketch.lineCap = "round";
  sketch.lineJoin = "round";
  sketch.lineWidth = op.size;
  const [r, g, b] = op.tool === "eraser" ? [0, 0, 0] : hexBytes(op.colour);
  sketch.strokeStyle = `rgb(${r}, ${g}, ${b})`;
  tracePath(sketch, op.points);
  sketch.stroke();
  layer.save();
  layer.globalAlpha = op.opacity / 100;
  layer.globalCompositeOperation = op.tool === "eraser" ? "destination-out" : "source-over";
  const blur = brushBlur(op.size, op.hardness);
  if (blur > 0.3) layer.filter = `blur(${blur.toFixed(2)}px)`;
  layer.drawImage(scratch, 0, 0);
  layer.restore();
}

/**
 * Заливка по рисунку: область, связная с точкой `(x, y)`, где цвет (с
 * прозрачностью) отличается от цвета точки не больше допуска, — цветом
 * заливки. Пиксели меняются на месте; ответ — сколько залито.
 */
export function floodFill(rgba, width, height, x, y, [r, g, b], tolerance) {
  const seed = (y * width + x) * 4;
  const target = [rgba[seed], rgba[seed + 1], rgba[seed + 2], rgba[seed + 3]];
  const limit = Math.round((tolerance / 100) * 255);
  /* Прозрачные пиксели — одна область, какой бы цвет ни лежал под нулевой альфой. */
  const same = (at) => {
    if (target[3] === 0 && rgba[at + 3] <= limit) return true;
    return (
      Math.abs(rgba[at] - target[0]) <= limit &&
      Math.abs(rgba[at + 1] - target[1]) <= limit &&
      Math.abs(rgba[at + 2] - target[2]) <= limit &&
      Math.abs(rgba[at + 3] - target[3]) <= limit
    );
  };
  if (target[0] === r && target[1] === g && target[2] === b && target[3] === 255) return 0;
  const seen = new Uint8Array(width * height);
  const stack = [x, y];
  let filled = 0;
  while (stack.length) {
    const py = stack.pop();
    const px = stack.pop();
    let left = px;
    while (left > 0 && !seen[py * width + left - 1] && same((py * width + left - 1) * 4)) left -= 1;
    let right = px;
    while (right < width - 1 && !seen[py * width + right + 1] && same((py * width + right + 1) * 4)) right += 1;
    for (let cx = left; cx <= right; cx += 1) {
      const index = py * width + cx;
      if (seen[index]) continue;
      seen[index] = 1;
      const at = index * 4;
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
      filled += 1;
      for (const ny of [py - 1, py + 1]) {
        if (ny < 0 || ny >= height) continue;
        const next = ny * width + cx;
        if (!seen[next] && same(next * 4)) stack.push(cx, ny);
      }
    }
  }
  return filled;
}

/** Шрифт надписи для холста. */
export const drawingFont = (op) =>
  `${op.bold ? "700" : "400"} ${op.size}px ${op.font === "custom" && op.fontAsset ? ownFontStack(op.fontAsset, DRAWING_FONT_STACKS.sans) : DRAWING_FONT_STACKS[op.font] || DRAWING_FONT_STACKS.sans}`;

/** Дождаться своих шрифтов рисунка: холст пишет ими только после того, как они в наборе шрифтов документа. */
export const prepareDrawingFonts = (drawing) => prepareOwnFonts(...billboardDrawingFontAssets(drawing));

/* Шаг в отпечатке холста: свой шрифт, ещё не добравшийся до документа, отличается от готового — холст с запасным в запас не ложится под ключом готового. */
const stepKey = (op) => (op.font === "custom" && op.fontAsset ? `${JSON.stringify(op)}${isEmblemFontReady(op.fontAsset) ? "+" : "-"}` : JSON.stringify(op));

/* Один шаг на слой. */
function applyOp(layer, scratch, op, width, height) {
  if (op.tool === "brush" || op.tool === "eraser") return paintStroke(layer, scratch, op);
  if (op.tool === "fill") {
    const image = layer.getImageData(0, 0, width, height);
    floodFill(image.data, width, height, op.x, op.y, hexBytes(op.colour), op.tolerance);
    layer.putImageData(image, 0, 0);
    return;
  }
  layer.save();
  layer.font = drawingFont(op);
  layer.textAlign = "center";
  layer.textBaseline = "middle";
  const [r, g, b] = hexBytes(op.colour);
  layer.fillStyle = `rgb(${r}, ${g}, ${b})`;
  layer.fillText(op.text, op.x, op.y);
  layer.restore();
}

/* Кэш холстов: по рисунку — список шагов (строками) и холст после них. */
const rendered = [];
const CACHE_SIZE = 8;

/**
 * Холст рисунка (`HTMLCanvasElement`, размер — `drawing.size`) или `null`
 * (окно без холста, пустой рисунок). Новые шаги дорисовываются на копии
 * самого длинного холста из кэша, чьи шаги — начало этих.
 */
export function drawingCanvas(drawing) {
  if (!billboardDrawingHas(drawing)) return null;
  const [width, height] = drawing.size;
  const steps = drawing.ops.map(stepKey);
  let best = null;
  for (const item of rendered) {
    if (item.width !== width || item.height !== height || item.steps.length > steps.length) continue;
    if (!item.steps.every((step, at) => step === steps[at])) continue;
    if (!best || item.steps.length > best.steps.length) best = item;
  }
  if (best && best.steps.length === steps.length) {
    rendered.splice(rendered.indexOf(best), 1);
    rendered.push(best);
    return best.canvas;
  }
  const canvas = canvasOf(width, height);
  const layer = context2d(canvas);
  const scratch = canvasOf(width, height);
  if (!layer || !scratch) return null;
  if (best) layer.drawImage(best.canvas, 0, 0);
  for (let at = best ? best.steps.length : 0; at < drawing.ops.length; at += 1) applyOp(layer, scratch, drawing.ops[at], width, height);
  rendered.push({ width, height, steps, canvas });
  while (rendered.length > CACHE_SIZE) rendered.shift();
  return canvas;
}

/** Рисунок пикселями с прозрачностью: `{ rgba, width, height }` или `null`. */
export function drawingPixels(drawing) {
  const canvas = drawingCanvas(drawing);
  const context = context2d(canvas);
  if (!context) return null;
  return { rgba: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/** Картинка рисунка для «Применить»: PNG base64 или `null`. */
export async function drawingPngBase64(drawing) {
  /* Свой шрифт — в набор шрифтов документа до холста: в картинке для игры не должно оказаться запасного. */
  await prepareDrawingFonts(drawing);
  const canvas = drawingCanvas(drawing);
  if (!canvas) return null;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Ключ картинки рисунка (договор) — для кэша кадра. */
export const drawingKeyOf = (drawing) => billboardDrawingKey(drawing);
