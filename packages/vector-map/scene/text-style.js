import { MAP_FONTS, customLabelFontKey, isCustomLabelFont } from "../map-fonts.js";

export const READABLE_PX = 10;
export const FLOOR_REACH = 2.5;
export const REPEAT_METRES = 300;

const PERMANENT_FAMILIES = [
  ["astral", "Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"],
  ["stock", "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"],
  ["condensed", "'Arial Narrow', 'Roboto Condensed', 'Segoe UI', sans-serif"],
  ["wide", "'Trebuchet MS', 'Segoe UI', Arial, sans-serif"],
  ["display", "'Impact', 'Haettenschweiler', 'Arial Black', sans-serif"],
  ["mono", "'JetBrains Mono', 'Consolas', monospace"],
  ["heavy", "'Montserrat', 'Segoe UI', 'Helvetica Neue', 'Arial Black', Arial, sans-serif"],
];

// Постоянные гарнитуры, затем по записям MAP_FONTS: совпавший id перезапишет значение на прежнем месте.
export const FONT_FAMILIES = Object.freeze(
  Object.fromEntries(PERMANENT_FAMILIES.concat(MAP_FONTS.map(({ id, family }) => [id, family]))),
);

export const WEIGHTS = Object.freeze({ regular: 400, bold: 700, black: 900 });
export const OWN_WEIGHTS = Object.freeze({ regular: 400, semibold: 600, bold: 700, black: 900 });

export const CAP_HEIGHTS = Object.freeze({
  golos: 0.7,
  inter: 0.728,
  astral: 0.728,
  manrope: 0.72,
  unbounded: 0.75,
  jetbrains: 0.73,
  montserrat: 0.7,
});

const CAP_HEIGHT_DEFAULT = 0.72;
const ASTRAL_BLACK_WEIGHT = 800;

// Пары «обычный, плотный» для labelWeight.
const CUSTOM_PAIR = [400, 700];
const ASTRAL_PAIR = [600, 700];
const COMMON_PAIR = [WEIGHTS.bold, WEIGHTS.black];

export const fontFamilyOf = (id, fallback = FONT_FAMILIES.astral) =>
  isCustomLabelFont(id) ? customFontFamily(customLabelFontKey(id)) : FONT_FAMILIES[id] || fallback;

export const labelWeight = (font, heavy) => {
  const pair = isCustomLabelFont(font) ? CUSTOM_PAIR : font === "astral" ? ASTRAL_PAIR : COMMON_PAIR;
  return pair[heavy ? 1 : 0];
};

export const ownLabelWeight = (own, font, heavy) => {
  if (!OWN_WEIGHTS[own?.weight]) return labelWeight(font, heavy);
  return own.weight === "black" && font === "astral" ? ASTRAL_BLACK_WEIGHT : OWN_WEIGHTS[own.weight];
};

export const capHeightOf = (font) => CAP_HEIGHTS[font] || CAP_HEIGHT_DEFAULT;

export const fixedTier = (height) => (height >= 70 ? 0 : height >= 26 ? 1 : 2);

const HEX_PAIRS = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, "0"));

// Две шестнадцатеричные цифры; выход за 0…255, NaN и бесконечности печатаются как есть.
const pairOf = (n) => HEX_PAIRS[n] ?? n.toString(16).padStart(2, "0");

const digitOf = (code) => {
  if (code >= 48 && code <= 57) return code - 48;
  const lower = code | 32;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
};

// Цвет «#rrggbb» (решётка необязательна) как число 0xRRGGBB; -1, если запись негодная.
const colorBits = (value) => {
  const text = value ? String(value) : "";
  const from = text.charCodeAt(0) === 35 ? 1 : 0;
  if (text.length - from !== 6) return -1;
  let bits = 0;
  for (let at = from; at < text.length; at++) {
    const digit = digitOf(text.charCodeAt(at));
    if (digit < 0) return -1;
    bits = bits * 16 + digit;
  }
  return bits;
};

const shade = (channel, target, share) => pairOf(Math.round(channel + (target - channel) * share));

export const mixTone = (hex, target, share, fallback) => {
  const bits = colorBits(hex);
  if (bits < 0) return fallback;
  const red = shade(bits >> 16, target, share);
  const green = shade((bits >> 8) & 255, target, share);
  const blue = shade(bits & 255, target, share);
  return `#${red}${green}${blue}`;
};

const TINT_RULES = [
  [255, 0.62, "#ffffff"],
  [0, 0.58, "#1f2633"],
];

export const tintLabel = (hex, lightMap) => {
  const [target, share, fallback] = TINT_RULES[lightMap ? 1 : 0];
  return mixTone(hex, target, share, fallback);
};

const unit = (bits, shift) => ((bits >> shift) & 255) / 255;

export const luminance = (hex) => {
  const bits = colorBits(hex);
  return bits < 0 ? 1 : unit(bits, 16) * 0.2126 + unit(bits, 8) * 0.7152 + unit(bits, 0) * 0.0722;
};

export const customFontFamily = (assetId) => {
  const key = (assetId ? String(assetId) : "").replace(/[^A-Za-z0-9_-]/g, "");
  return `'astral-font-${key}', ${FONT_FAMILIES.golos}`;
};
