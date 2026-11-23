import { scheduleBoardItems } from "../schedule-board.js";
import { alpha, round } from "./geometry.js";
import { FONT_FAMILIES, WEIGHTS, capHeightOf, customFontFamily, fontFamilyOf } from "./text-style.js";

export const EMBLEM_LINE_STEP = 1.18;
const [IMAGE_GLOW_DIVISOR, TEXT_GLOW_DIVISOR, TEXT_OUTLINE_DIVISOR, MIN_ADVANCE] = [400, 220, 500, 0.05];

// --- стиль надписи: четыре правила, по одному на поле ---------------------

function familyRule(emblem) {
  const own = emblem.font === "custom" && emblem.fontAssetId;
  if (own) return customFontFamily(emblem.fontAssetId);
  return FONT_FAMILIES[emblem.font] || FONT_FAMILIES.golos;
}

function valueRule(emblem) {
  const text = emblem.text;
  return text ? String(text) : "";
}

const weightRule = (emblem) => WEIGHTS[emblem.weight] || WEIGHTS.black;
const spacingRule = (emblem) => emblem.letterSpacing || 0;

export function emblemTextStyle(emblem) {
  return { value: valueRule(emblem), family: familyRule(emblem), weight: weightRule(emblem), spacing: spacingRule(emblem) };
}

export function emblemTextLines(emblem) {
  const text = emblem?.text;
  return (text === undefined || text === null ? "" : String(text)).split("\n");
}

export const APPROXIMATE_ADVANCE = 0.62;

const guessAdvance = (style) => APPROXIMATE_ADVANCE * Math.max(1, style.value.length);

// Ширина строки на кегль: ответ замера, если он больше нуля, иначе число знаков на приближённый шаг.
export function measureAdvance(style, textAdvance) {
  const answer = typeof textAdvance === "function" ? textAdvance(style) : 0;
  return answer > 0 ? { advance: answer, measured: true } : { advance: guessAdvance(style), measured: false };
}

// Самая широкая строка (первая из равных) и признак «все строки измерены».
class Widest {
  constructor(first) {
    this.advance = 0;
    this.line = first;
    this.measured = true;
  }

  see(result, line) {
    if (result.advance > this.advance) {
      this.advance = result.advance;
      this.line = line;
    }
    if (!result.measured) this.measured = false;
  }
}

export function emblemTextMetrics(emblem, textAdvance = null) {
  const [style, lines] = [emblemTextStyle(emblem), emblemTextLines(emblem)];
  const top = new Widest(lines[0]);
  for (const line of lines) {
    // Пустая строка меряется пробелом, чтобы замер не вернул «пусто»; в результат идёт настоящая.
    top.see(measureAdvance({ ...style, value: line || " " }, textAdvance), line);
  }
  const metrics = { lines, widest: top.line };
  metrics.advance = Math.max(top.advance, MIN_ADVANCE);
  metrics.measured = top.measured;
  metrics.height = lines.length * EMBLEM_LINE_STEP;
  return metrics;
}

export const emblemTextAdvance = (emblem, textAdvance = null) => emblemTextMetrics(emblem, textAdvance).advance;

// --- предметы ---------------------------------------------------------------

// Доля опорной длины, округлённая до тысячных: whole * percent / per.
const share = (whole, percent, per) => round(whole * percent / per);

const isMulti = (metrics) => metrics.lines.length > 1;
const fitSize = (width, metrics) => round(width / metrics.advance);

// Радиус рамки больше радиуса картинки на толщину рамки; у квадратной картинки он остаётся нулём.
const outerRadius = (radius, frame) => {
  if (!(radius > 0)) return 0;
  return round(radius + frame);
};

function glowOf(emblem, base, divisor) {
  if (!(emblem.glow > 0)) return null;
  return { color: emblem.glowColor, size: share(base, emblem.glow, divisor) };
}

// [x, y, width, height]: центр сдвинут на половину сторон, высота округлена по пропорции.
function pictureBox(center, width, aspect) {
  const height = round(width / aspect);
  return [round(center.x - width / 2), round(center.y - height / 2), width, height];
}

// Поля предметов идут по таблицам: порядок ключей задаёт таблица, значения — список в том же порядке.
const FRAME_KEYS = ["kind", "id", "x", "y", "width", "height", "radius", "fill", "opacity", "rotation", "origin", "glow"];
const IMAGE_KEYS = ["kind", "id", "href", "x", "y", "width", "height", "radius", "fit", "opacity", "rotation", "origin", "preserveAspectRatio", "glow"];

function put(item, names, values) {
  names.forEach((name, at) => {
    item[name] = values[at];
  });
  return item;
}

// pic: размеры картинки, радиус, рамка, центр и свечение — общее у рамки и самой картинки.
function frameItem(emblem, pic) {
  const widened = pic.box.map((side, at) => round(at < 2 ? side - pic.frame : side + pic.frame * 2));
  return put({}, FRAME_KEYS, [
    "rect",
    `emblem-frame-${emblem.id}`,
    ...widened,
    outerRadius(pic.radius, pic.frame),
    emblem.frameColor,
    alpha(emblem.opacity),
    emblem.rotation,
    pic.center,
    pic.glow,
  ]);
}

function imageItem(emblem, href, pic) {
  const picture = put({}, IMAGE_KEYS, [
    "image",
    `emblem-${emblem.id}`,
    href,
    ...pic.box,
    pic.radius,
    emblem.fit,
    alpha(emblem.opacity),
    emblem.rotation,
    pic.center,
    emblem.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet",
    pic.frame > 0 ? null : pic.glow,
  ]);
  return Object.assign(picture, emblem.blend !== "normal" ? { blend: emblem.blend } : null, emblem.flip ? { flip: true } : null);
}

const hrefOf = (assets, emblem) => assets?.[emblem.assetId];

function imagePieces(emblem, center, width, assets) {
  const href = hrefOf(assets, emblem);
  if (!href) return [];

  const box = pictureBox(center, width, emblem.aspect);
  const radius = share(Math.min(width, box[3]), emblem.radius, 100);
  const frame = share(width, emblem.frame, 100);
  const pic = { box, radius, frame, center, glow: glowOf(emblem, width, IMAGE_GLOW_DIVISOR) };
  const pieces = [];
  if (frame > 0) pieces.push(frameItem(emblem, pic));
  pieces.push(imageItem(emblem, href, pic));
  return pieces;
}

// Поля текстового предмета идут группами; необязательные группы вставляются между ними.
const TEXT_HEAD = ["kind", "id", "x", "y", "value"];
const TEXT_MULTI = ["lines", "lineStep"];
const TEXT_SIZE = ["size", "fitWidth"];
const TEXT_TAIL = ["fill", "family", "weight", "letterSpacing", "anchor", "baseline", "opacity", "rotation", "stroke", "strokeWidth", "glow"];

function textPieces(emblem, center, width, textAdvance) {
  const [style, metrics] = [emblemTextStyle(emblem), emblemTextMetrics(emblem, textAdvance)];
  const size = fitSize(width, metrics);
  const multiline = isMulti(metrics);

  const item = put({}, TEXT_HEAD, ["text", `emblem-${emblem.id}`, center.x, center.y, multiline ? metrics.widest : emblem.text]);
  if (multiline) put(item, TEXT_MULTI, [metrics.lines, round(size * EMBLEM_LINE_STEP)]);
  put(item, TEXT_SIZE, [size, width]);
  if (metrics.measured || multiline) item.measured = true;
  return [
    put(item, TEXT_TAIL, [
      emblem.color,
      style.family,
      style.weight,
      share(size, emblem.letterSpacing, 100),
      "middle",
      "middle",
      alpha(emblem.opacity),
      emblem.rotation,
      emblem.outline > 0 ? emblem.outlineColor : null,
      share(size, emblem.outline, TEXT_OUTLINE_DIVISOR),
      glowOf(emblem, size, TEXT_GLOW_DIVISOR),
    ]),
  ];
}

// Табло берёт гарнитуру по id шрифта; запасная здесь golos, а не astral.
const boardFamily = (id) => fontFamilyOf(id, FONT_FAMILIES.golos);

function piecesOf(emblem, projector, tools) {
  const [center, width] = [projector.point(emblem), projector.length(emblem.width)];
  if (emblem.schedule) return scheduleBoardItems(emblem, projector, tools.assets, tools.helpers);
  return emblem.kind === "image"
    ? imagePieces(emblem, center, width, tools.assets)
    : textPieces(emblem, center, width, tools.textAdvance);
}

function* eachPiece(config, projector, tools) {
  for (const emblem of config.emblems.items) {
    yield* emblem.enabled ? piecesOf(emblem, projector, tools) : [];
  }
}

const toolsFor = (assets, textAdvance) => ({
  assets,
  textAdvance,
  helpers: { family: boardFamily, cap: capHeightOf, advance: textAdvance },
});

export function emblemItems(config, projector, assets, textAdvance = null) {
  return [...eachPiece(config, projector, toolsFor(assets, textAdvance))];
}
