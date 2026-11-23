/*
 * Рисунок на полотне «Билбордов» (задача 3 ТЗ 17.10.2026): кисть, ластик,
 * заливка и текст прямо на щите или баннере.
 *
 * В работе рисунок — шагами (`ops`), а не картинкой: шаг — штрих кисти
 * или ластика, заливка, надпись. Так «Отменить» и «Вернуть» редактора
 * снимают и возвращают по штриху, а «Мои работы» хранят рисунок вместе с
 * работой. Холст рисунка — свой размер (`size`, пиксели): полотно щита в
 * его пропорции, длинная сторона — `BILLBOARD_DRAWING_SIDE`. Координаты
 * шагов — целые пиксели этого холста.
 *
 * Картинкой рисунок делает окно (холст браузера: кисть с мягкостью,
 * надпись шрифтом окна), и в игру он едет своей картинкой с прозрачностью
 * — ключ `billboardDrawingKey`, тот же у кадра и у «Применить». Пределы
 * держат работу лёгкой строкой: черновик редактора живёт в хранилище окна.
 */

import { normalizeRecolourHex } from "./colour.js";

/** Длинная сторона холста рисунка (px). */
export const BILLBOARD_DRAWING_SIDE = 1024;
/* Пределы рисунка: шагов, чисел точек в штрихе и во всём рисунке, букв надписи. */
export const BILLBOARD_DRAWING_LIMITS = Object.freeze({ ops: 400, strokeNumbers: 4000, totalNumbers: 40000, text: 80 });
export const BILLBOARD_DRAWING_TOOLS = Object.freeze(["brush", "eraser", "fill", "text"]);
export const BILLBOARD_DRAWING_FONTS = Object.freeze(["sans", "serif", "mono", "display"]);
/* Свой шрифт человека (ТЗ 23.10.2026, п. F): у шага-надписи `font: "custom"` и ключ файла в хранилище окна; рисунок окно делает картинкой. */
export const BILLBOARD_DRAWING_FONT_CUSTOM = "custom";
const FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;
/* Кисть: размер (px холста), жёсткость и непрозрачность (%), допуск заливки (%), кегль надписи (px). */
export const BILLBOARD_BRUSH = Object.freeze({
  size: Object.freeze({ min: 1, max: 300, standard: 24 }),
  hardness: Object.freeze({ min: 0, max: 100, standard: 80 }),
  opacity: Object.freeze({ min: 5, max: 100, standard: 100 }),
  tolerance: Object.freeze({ min: 0, max: 100, standard: 20 }),
  textSize: Object.freeze({ min: 8, max: 600, standard: 96 }),
});

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampInt = (value, { min, max, standard }) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : standard;
};

/** Пустой рисунок. */
export const emptyBillboardDrawing = () => ({ size: [0, 0], ops: [] });

/** Холст рисунка для полотна пропорции `aspect` (ширина к высоте). */
export function billboardDrawingSize(aspect) {
  const ratio = Number(aspect) > 0 ? Number(aspect) : 2;
  return ratio >= 1
    ? [BILLBOARD_DRAWING_SIDE, Math.max(16, Math.round(BILLBOARD_DRAWING_SIDE / ratio))]
    : [Math.max(16, Math.round(BILLBOARD_DRAWING_SIDE * ratio)), BILLBOARD_DRAWING_SIDE];
}

function normalizeOp(input, [width, height], budget) {
  const source = plain(input);
  const tool = BILLBOARD_DRAWING_TOOLS.includes(source.tool) ? source.tool : null;
  if (!tool) return null;
  const colour = normalizeRecolourHex(source.colour, "#ffffff");
  const x = (value, limit) => Math.min(limit, Math.max(0, Math.round(Number(value) || 0)));
  if (tool === "brush" || tool === "eraser") {
    const raw = Array.isArray(source.points) ? source.points : [];
    const count = Math.min(raw.length - (raw.length % 2), BILLBOARD_DRAWING_LIMITS.strokeNumbers, budget.left - (budget.left % 2));
    if (count < 2) return null;
    const points = [];
    for (let at = 0; at < count; at += 2) points.push(x(raw[at], width), x(raw[at + 1], height));
    budget.left -= points.length;
    return {
      tool,
      ...(tool === "brush" ? { colour } : {}),
      size: clampInt(source.size, BILLBOARD_BRUSH.size),
      hardness: clampInt(source.hardness, BILLBOARD_BRUSH.hardness),
      opacity: clampInt(source.opacity, BILLBOARD_BRUSH.opacity),
      points,
    };
  }
  if (tool === "fill") return { tool, colour, x: x(source.x, width - 1), y: x(source.y, height - 1), tolerance: clampInt(source.tolerance, BILLBOARD_BRUSH.tolerance) };
  /* Надпись — одной строкой: переводы строк и служебные знаки — пробелами. */
  const text = [...String(source.text ?? "")]
    .map((char) => (char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .slice(0, BILLBOARD_DRAWING_LIMITS.text);
  if (!text.trim()) return null;
  return {
    tool,
    colour,
    x: x(source.x, width),
    y: x(source.y, height),
    text,
    size: clampInt(source.size, BILLBOARD_BRUSH.textSize),
    ...(source.font === BILLBOARD_DRAWING_FONT_CUSTOM && FONT_ASSET.test(String(source.fontAsset || ""))
      ? { font: BILLBOARD_DRAWING_FONT_CUSTOM, fontAsset: source.fontAsset }
      : { font: BILLBOARD_DRAWING_FONTS.includes(source.font) ? source.font : "sans" }),
    bold: source.bold === true,
  };
}

/** Рисунок полотна: холст и шаги в пределах. Без холста или шагов — пустой. */
export function normalizeBillboardDrawing(input) {
  const source = plain(input);
  const size = Array.isArray(source.size) ? source.size.map((value) => Math.round(Number(value) || 0)) : [0, 0];
  if (!(size[0] >= 16 && size[1] >= 16 && size[0] <= 2048 && size[1] <= 2048)) return emptyBillboardDrawing();
  const budget = { left: BILLBOARD_DRAWING_LIMITS.totalNumbers };
  const ops = [];
  for (const item of Array.isArray(source.ops) ? source.ops : []) {
    if (ops.length >= BILLBOARD_DRAWING_LIMITS.ops) break;
    const op = normalizeOp(item, size, budget);
    if (op) ops.push(op);
  }
  return ops.length ? { size, ops } : emptyBillboardDrawing();
}

/** Свои шрифты шагов-надписей рисунка: ключи файлов в хранилище окна (по одному). */
export const billboardDrawingFontAssets = (drawing) => [...new Set((drawing?.ops || []).filter((op) => op.font === BILLBOARD_DRAWING_FONT_CUSTOM && op.fontAsset).map((op) => op.fontAsset))];

/** На полотне есть рисунок. */
export const billboardDrawingHas = (drawing) => Boolean(drawing?.ops?.length);

/** Сколько ещё влезет в рисунок: шагов и чисел точек. */
export function billboardDrawingRoom(drawing) {
  const used = (drawing?.ops || []).reduce((sum, op) => sum + (op.points?.length || 0), 0);
  return { ops: BILLBOARD_DRAWING_LIMITS.ops - (drawing?.ops?.length || 0), numbers: BILLBOARD_DRAWING_LIMITS.totalNumbers - used };
}

/* FNV-1a, два 32-битных прохода с разной затравкой: ключ картинки рисунка — 16 знаков. */
function fingerprint(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** Ключ картинки рисунка среди своих картинок работы: тот же рисунок — тот же ключ. Пустой — "". */
export function billboardDrawingKey(drawing) {
  const normalized = normalizeBillboardDrawing(drawing);
  return billboardDrawingHas(normalized) ? `billboard-drawing:${fingerprint(JSON.stringify(normalized))}` : "";
}

export const isBillboardDrawingKey = (key) => typeof key === "string" && key.startsWith("billboard-drawing:");

/** Рисунок с ещё одним шагом (сверх пределов шаг не ложится или ложится обрезанным — ответ `null`). */
export function addBillboardDrawingOp(drawing, op, size) {
  const base = billboardDrawingHas(drawing) ? drawing : { size, ops: [] };
  const alone = normalizeOp(op, base.size, { left: BILLBOARD_DRAWING_LIMITS.strokeNumbers });
  if (!alone) return null;
  const next = normalizeBillboardDrawing({ size: base.size, ops: [...base.ops, op] });
  if (next.ops.length !== base.ops.length + 1) return null;
  return (next.ops.at(-1).points?.length || 0) === (alone.points?.length || 0) ? next : null;
}
