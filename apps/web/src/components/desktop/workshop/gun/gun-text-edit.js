import { decalBasis } from "./gun-decals.js";
import { layerFont } from "./gun-canvas.js";

// Надпись на холсте рисуется кеглем 160: от него считаются поля и высота.
const GLYPH_SIZE = 160;
const SIDE_PADDING = 64;
const CANVAS_HEIGHT = Math.round(GLYPH_SIZE * 1.45);
const MAX_CANVAS_WIDTH = 2048;
const EMPTY_CAPTION_WIDTH = GLYPH_SIZE;

const DEFAULT_STICKER_SIZE = 18;
const MIN_SPAN = 0.0001;

const FONT_STYLES = ["italic", "oblique"];
// Знаки конца строки, которые «.» в регулярках JS не захватывает (числом, чтобы не плодить escape).
const LINE_BREAK_CODES = new Set([10, 13, 0x2028, 0x2029]);

function hasLineBreak(text) {
  for (let at = 0; at < text.length; at += 1) {
    if (LINE_BREAK_CODES.has(text.charCodeAt(at))) return true;
  }
  return false;
}

const isBlank = (ch) => ch === " " || ch === "\t";
const isDigit = (ch) => ch >= "0" && ch <= "9";

function skipWhile(text, from, test) {
  let at = from;
  while (at < text.length && test(text[at])) at += 1;
  return at;
}

/**
 * Строка шрифта холста: [italic|oblique ] [вес ]NNpx семейство.
 * Возвращает части или null, если строка не подошла.
 */
function scanFont(text) {
  let at = 0;
  let style = "normal";
  const word = FONT_STYLES.find((candidate) => text.startsWith(candidate));
  if (word) {
    const next = skipWhile(text, word.length, isBlank);
    if (next > word.length) {
      style = word;
      at = next;
    }
  }

  let weight = "400";
  const weightEnd = skipWhile(text, at, isDigit);
  if (weightEnd > at && isBlank(text[weightEnd])) {
    weight = text.slice(at, weightEnd);
    at = skipWhile(text, weightEnd, isBlank);
  }

  const sizeEnd = skipWhile(text, at, isDigit);
  if (sizeEnd === at || !text.startsWith("px", sizeEnd)) return null;

  const gapStart = sizeEnd + 2;
  const familyStart = skipWhile(text, gapStart, isBlank);
  if (familyStart === gapStart) return null;

  const tail = text.slice(familyStart);
  let family;
  if (tail === "") {
    // один пробел из группы остаётся семейству, если иначе его не осталось бы
    if (familyStart - gapStart < 2) return null;
    family = text[familyStart - 1];
  } else if (hasLineBreak(tail)) {
    return null;
  } else {
    family = tail;
  }
  return { family, weight, style };
}

export function cssFontOf(font) {
  const parts = scanFont(font ? String(font) : "");
  return parts ?? { family: "sans-serif", weight: "400", style: "normal" };
}

// Холст для измерения: undefined — ещё не пробовали, null — его нет (запоминается навсегда).
let measuringContext;

function getMeasuringContext() {
  if (measuringContext === undefined) {
    try {
      measuringContext = document.createElement("canvas").getContext("2d") || null;
    } catch {
      measuringContext = null;
    }
  }
  return measuringContext;
}

export function gunTextLayout(sticker) {
  const context = getMeasuringContext();
  if (!context) return null;

  const font = layerFont(sticker, GLYPH_SIZE);
  context.font = font;
  const caption = String(sticker?.text || "").trim();

  const measured = Math.ceil(context.measureText(caption).width || EMPTY_CAPTION_WIDTH);
  const width = Math.min(MAX_CANVAS_WIDTH, Math.max(1, measured + SIDE_PADDING));

  const outline = Number(sticker?.outline) || 0;
  const rim = (outline / 100) * Math.max(width, CANVAS_HEIGHT);

  return {
    width: width + 2 * rim,
    height: CANVAS_HEIGHT + 2 * rim,
    size: GLYPH_SIZE,
    stroke: 0,
    ...cssFontOf(font),
  };
}

// Знаки (по ширине, по высоте) для углов по кругу с левого верхнего.
const CORNER_SIGNS = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
const AXES = ["x", "y", "z"];

export function gunTextCorners(sticker, aspect, modelLength) {
  const anchor = sticker?.anchor;
  const normal = sticker?.normal;
  if (!anchor || !normal) return null;

  const { tangent: right, bitangent: up } = decalBasis(normal, sticker.rotation || 0);
  const halfWidth = Math.max(MIN_SPAN, ((sticker.size || DEFAULT_STICKER_SIZE) / 100) * modelLength) / 2;
  const halfHeight = halfWidth * aspect;
  const mirror = sticker.flip ? -1 : 1;

  return CORNER_SIGNS.map(([sx, sy]) => {
    const corner = {};
    for (const axis of AXES) {
      corner[axis] = anchor[axis] + right[axis] * halfWidth * sx * mirror + up[axis] * halfHeight * sy;
    }
    return corner;
  });
}
