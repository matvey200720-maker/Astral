import { BLEND_MODES, choice, clamp, color, decimal, flag, text } from "./values.js";
import {
  BASE_COLOR_KEYS,
  BASE_DECIMALS,
  BASE_OPTIONAL_COLORS,
  BASE_RANGES,
  BASE_RENDER_MODES,
  DEFAULT_BASE,
  RETIRED_TEMPLATES,
  TEXTURE_IDS,
  hiddenLayers,
} from "./defaults.js";
import { MAP_COLOR_ROLE_IDS, MAP_PALETTE_LIMIT } from "../palette.js";
import { MAP_TEMPLATE_MAP } from "../map-templates.js";

const SOURCES = ["game", "image", "schematic", "template"];
const PACK_LAYER_STATES = ["", "pending", "split"];
const BLEND_CHOICES = ["normal", ...BLEND_MODES];
const TEXTURE_CHOICES = ["none", "image", ...TEXTURE_IDS];

const ROLE_OVERRIDES_MAX = MAP_PALETTE_LIMIT + 2;
const PALETTE_ENTRIES_MAX = 40;
const PALETTE_KEY_MAX = 24;
const DOUBTFUL_MAX = 400;

const isObject = (value) => Boolean(value) && typeof value === "object";

// Ключ правки палитры: строчная латинская буква, затем буквы, цифры и дефис, всего 1…24 знака.
const isPaletteKey = (key) => {
  if (key.length < 1 || key.length > PALETTE_KEY_MAX) return false;
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    const lower = code >= 97 && code <= 122;
    if (!lower && (i === 0 || !((code >= 48 && code <= 57) || code === 45))) return false;
  }
  return true;
};

export const normalizeRoleOverrides = (value) => {
  const rows = [];
  if (!Array.isArray(value)) return rows;
  const taken = new Set();
  for (const entry of value) {
    const hex = color(entry?.color, null);
    if (hex === null || !MAP_COLOR_ROLE_IDS.includes(entry.role) || taken.has(hex)) continue;
    taken.add(hex);
    rows.push({ color: hex, role: entry.role });
    if (rows.length >= ROLE_OVERRIDES_MAX) break;
  }
  return rows;
};

export const normalizePackOrigin = (value) => {
  if (!isObject(value)) return null;
  const modId = text(value.modId, "", 120);
  const partId = text(value.partId, "", 120);
  return modId && partId ? { modId, partId, title: text(value.title, "", 80) } : null;
};

export const normalizePaletteMap = (value) => {
  const map = {};
  if (!isObject(value) || Array.isArray(value)) return map;
  for (const [key, raw] of Object.entries(value).slice(0, PALETTE_ENTRIES_MAX)) {
    const hex = isPaletteKey(key) ? color(raw, null) : null;
    if (hex !== null) map[key] = hex;
  }
  return map;
};

const doubtfulIds = (list) =>
  [...new Set(list.map((item) => text(item, "", 64)).filter(Boolean))].slice(0, DOUBTFUL_MAX);

// Шаблон: сначала замена снятого, потом проверка по карте шаблонов; сырое поле читается заново на каждом шаге.
const templateOf = (src) => {
  const resolved = () => RETIRED_TEMPLATES[src.templateId] || src.templateId;
  return MAP_TEMPLATE_MAP[resolved()] ? resolved() : "";
};

const assetRow = (key) => [key, (src) => (src[key] ? text(src[key], "", 128) : "")];
const choiceRow = (key, list, fallback) => [key, (src) => choice(src[key], list, fallback)];
const flagRow = (key) => {
  const fallback = DEFAULT_BASE[key];
  return [key, (src) => flag(src[key], fallback)];
};
const colourRow = (key) => {
  const fallback = DEFAULT_BASE[key];
  return [key, (src) => color(src[key], fallback)];
};
const optionalColourRow = (key) => [key, (src) => color(src[key], "")];
const roundedRow = ([key, [low, high]]) => {
  const fallback = DEFAULT_BASE[key];
  return [key, (src) => Math.round(clamp(src[key], low, high, fallback))];
};
const decimalRow = ([key, [low, high]]) => {
  const fallback = DEFAULT_BASE[key];
  return [key, (src) => decimal(src[key], low, high, fallback)];
};

// Поля результата по порядку; значения читаются из источника ровно в этом порядке.
const BASE_ROWS = [
  choiceRow("source", SOURCES, "game"),
  assetRow("imageAssetId"),
  ["packOrigin", (src) => normalizePackOrigin(src.packOrigin)],
  ["packLayers", (src) => (src.packOrigin ? choice(src.packLayers, PACK_LAYER_STATES, "") : "")],
  ["packDoubtful", (src) => (src.packOrigin && Array.isArray(src.packDoubtful) ? doubtfulIds(src.packDoubtful) : [])],
  ["templateId", templateOf],
  choiceRow("tintBlend", BLEND_CHOICES, DEFAULT_BASE.tintBlend),
  flagRow("recolor"),
  flagRow("gridLabels"),
  ["roleOverrides", (src) => normalizeRoleOverrides(src.roleOverrides)],
  choiceRow("textureId", TEXTURE_CHOICES, "none"),
  assetRow("textureAssetId"),
  choiceRow("textureBlend", BLEND_CHOICES, DEFAULT_BASE.textureBlend),
  ...BASE_COLOR_KEYS.map(colourRow),
  ...BASE_OPTIONAL_COLORS.map(optionalColourRow),
  choiceRow("render", BASE_RENDER_MODES, "auto"),
  ["hidden", (src) => [...new Set([...hiddenLayers(src.hidden), "water"])]],
  ["paletteMap", (src) => normalizePaletteMap(src.paletteMap)],
  flagRow("reliefOn"),
  ["bare", () => true],
  flagRow("reliefContours"),
  flagRow("volumeBuildings"),
  ...Object.entries(BASE_RANGES).map(roundedRow),
  ...Object.entries(BASE_DECIMALS).map(decimalRow),
];

export const normalizeBase = (value) => {
  const src = isObject(value) ? value : {};
  const base = {};
  for (const [key, build] of BASE_ROWS) base[key] = build(src);
  if (base.source === "template" && !base.templateId) base.source = "game";
  return base;
};
