import { colourEffectAt, normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";

const BOX_KEYS = ["x", "y", "width", "height"];
const LINE_KEYS = ["x1", "y1", "x2", "y2"];
const STOP_COLOUR = 1;
const [RAMP_SEGMENTS, LINE_BANDS] = [8, 4];

// Значения по порядку ключей -> объект с этими ключами.
const keyed = (keys, values) => Object.fromEntries(keys.map((key, at) => [key, values[at]]));

// Рамка примитива: способ считать по виду; всё незнакомое читается как прямоугольник.
const BOX_RECIPES = new Map([
  ["circle", (item) => [item.x - item.r, item.y - item.r, item.r * 2, item.r * 2]],
  ["glyph", (item) => [0, 0, item.box, item.box]],
]);
const asRectangle = (item) => [item.x, item.y, item.width, item.height];

// Отрезок градиента по оси краски; всё незнакомое идёт сверху вниз.
const LINE_RECIPES = new Map([
  ["x", (box) => [box.x, box.y, box.x + box.width, box.y]],
  ["-y", (box) => [box.x, box.y + box.height, box.x, box.y]],
]);
const topDown = (box) => [box.x, box.y, box.x, box.y + box.height];

const axisOf = (direction) => {
  switch (direction) {
    case "along":
      return "x";
    case "height":
      return "-y";
    default:
      return "y";
  }
};

const hexByte = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

const rampStops = (fx) =>
  Array.from({ length: RAMP_SEGMENTS + 1 }, (_, at) => {
    const t = at / RAMP_SEGMENTS;
    return [Math.round(1000 * t) / 1000, `#${colourEffectAt(fx, t).map((channel) => hexByte(channel)).join("")}`];
  });

// Четыре полосы, цвета чередуются; у каждой полосы две остановки — начало и конец.
const lineStops = ({ colour, colour2 }) =>
  [colour, colour2, colour, colour2].flatMap((tone, band) => [
    [band / LINE_BANDS, tone],
    [(band + 1) / LINE_BANDS, tone],
  ]);

const settle = (effect, colour) => normalizeColourEffect(effect, { colour });

export const effectPaint = (effect, fallback = "#ffffff") => {
  const fx = settle(effect, fallback);
  return fx.mode === "solid"
    ? fx.colour
    : { dir: axisOf(fx.direction), stops: (fx.mode === "line" ? lineStops : rampStops)(fx) };
};

export const isGradientPaint = (paint) => Boolean(paint) && typeof paint === "object" && Array.isArray(paint.stops);

const leadColour = (paint) => (isGradientPaint(paint) ? paint.stops[0]?.[STOP_COLOUR] : paint);

export const paintColour = (paint, fallback = "#ffffff") => leadColour(paint) || fallback;

export const paintBox = (item) => keyed(BOX_KEYS, (BOX_RECIPES.get(item.kind) ?? asRectangle)(item));

export const paintLine = (paint, box) => keyed(LINE_KEYS, (LINE_RECIPES.get(paint.dir) ?? topDown)(box));
