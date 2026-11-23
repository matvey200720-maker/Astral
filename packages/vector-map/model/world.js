import { LABEL_SYSTEM, normalizeSections } from "./sections.js";
import { WORLD_MAP_SCHEMA_VERSION as SCHEMA_VERSION } from "./values.js";
import * as defaults from "./defaults.js";
import * as packs from "../map-templates.js";
import { MARKER_CATEGORIES } from "../catalog.js";
import { DEFAULT_MAP_ZOOM } from "../mapzoom.js";

export { LABEL_SYSTEM };

const { MAP_TEMPLATE_LABELS, MAP_TEMPLATE_MAP } = packs;

// Цвета и ширины, которые подстройка считает «своими, из готовых пар»: их можно менять под вид карты.
export const PRESET_LABEL_COLORS = new Set("|#11151c|#1f2633|#eef2fb|#ffffff".split("|"));
export const PRESET_OUTLINE_COLORS = new Set("#ffffff #04060a".split(" "));
export const PRESET_OUTLINE_WIDTHS = new Set("0 40 70 78".split(" ").map(Number));
export const PRESET_OUTLINES = Object.freeze(Object.fromEntries([["light", 0], ["dark", 40]]));
// Категории точек без значка: у них подпись — единственное, что видно.
export const LABEL_ONLY_CATEGORIES = Object.freeze(
  MARKER_CATEGORIES.flatMap((category) => (category.glyph === "none" ? [category.id] : [])),
);

const EMPTY = Object.freeze({});
const LIGHT_LIMIT = 0.55;

// Светлота цвета

const hexDigit = (code) => {
  if (code >= 48 && code <= 57) return code - 48;
  const lowered = code | 32;
  return lowered >= 97 && lowered <= 102 ? lowered - 87 : -1;
};

// Три канала 0…255 из «#rrggbb» или «rrggbb»; иначе null.
const hexChannels = (word) => {
  const start = word.charCodeAt(0) === 35 ? 1 : 0;
  if (word.length - start !== 6) return null;
  const channels = [0, 0, 0];
  for (let at = 0; at < 3; at++) {
    const high = hexDigit(word.charCodeAt(start + at * 2));
    const low = hexDigit(word.charCodeAt(start + at * 2 + 1));
    if (high < 0 || low < 0) return null;
    channels[at] = high * 16 + low;
  }
  return channels;
};

export const luma = (hex) => {
  const channels = hexChannels(hex ? String(hex) : "");
  if (!channels) return 0;
  return 0.2126 * (channels[0] / 255) + 0.7152 * (channels[1] / 255) + 0.0722 * (channels[2] / 255);
};

// Вид готовой карты; нет записи или вида — тёмная.
const packLook = (id) => MAP_TEMPLATE_MAP[id]?.look || "dark";

export const styleLook = (base) => {
  const painted = base.recolor;
  if (!painted) return base.source === "template" ? packLook(base.templateId) : "dark";
  return luma(base.land) > LIGHT_LIMIT ? "light" : "dark";
};

// Подстройка подписей под светлоту карты

const lowerKey = (value) => String(value || "").toLowerCase();
const presetTest = (set, key = (value) => value) => (value) => set.has(key(value));
const isLabelColor = presetTest(PRESET_LABEL_COLORS, lowerKey);
const isOutlineColor = presetTest(PRESET_OUTLINE_COLORS, lowerKey);
const isOutlineWidth = presetTest(PRESET_OUTLINE_WIDTHS);
const isCondensed = (value) => value === "condensed";

// [поле, подходит ли значение, новое значение по паре и виду]
const MARKER_COLOR_RULES = [
  ["labelColor", isLabelColor, (pair) => pair.markers.labelColor],
  ["labelOutlineColor", isOutlineColor, (pair) => pair.markers.labelOutlineColor],
];
const MARKER_SHAPE_RULES = [
  ["labelOutline", isOutlineWidth, (pair, look) => PRESET_OUTLINES[look] ?? 0],
  ["font", isCondensed, () => "astral"],
];
const ZONE_RULES = [
  ["labelColor", isLabelColor, (pair) => pair.zones.labelColor],
  ["labelOutline", isOutlineWidth, () => 0],
  ["font", isCondensed, () => "astral"],
];

const applyRules = (target, rules, pair, look) => {
  for (let at = 0; at < rules.length; at++) {
    const rule = rules[at];
    if (rule[1](target[rule[0]])) target[rule[0]] = rule[2](pair, look);
  }
  return target;
};

// Категории без значка: на светлой карте берут цвет пары, на любой другой — пустой («как у общей подписи»).
const relabelPlain = (copy, label) => {
  for (const id of LABEL_ONLY_CATEGORIES) {
    const entry = copy[id];
    if (entry && isLabelColor(entry.labelColor)) copy[id] = { ...entry, labelColor: label };
  }
  return copy;
};

const relabel = (config, pair, look) => {
  const markers = applyRules({ ...config.markers }, MARKER_COLOR_RULES, pair, look);
  markers.categories = relabelPlain({ ...markers.categories }, look === "light" ? pair.markers.labelColor : "");
  applyRules(markers, MARKER_SHAPE_RULES, pair, look);
  const zones = applyRules({ ...config.zones }, ZONE_RULES, pair, look);
  const result = { ...config };
  result.markers = markers;
  result.zones = zones;
  return result;
};

export const withLabelLook = (config, look) => {
  const pair = MAP_TEMPLATE_LABELS[look];
  return pair ? relabel(config, pair, look) : config;
};

export const mapStyleActive = (config) => {
  const base = config?.base;
  return Boolean(base?.recolor) && base.source !== "schematic";
};

// Проект из любого входа

// Вид для проекта старой системы подписей: готовая карта говорит сама, иначе — по перекраске и суше.
const legacyLook = (base) => (base.source === "template" ? packLook(base.templateId) : styleLook(base));

export const normalizeWorldMap = (value) => {
  const source = typeof value === "object" && value !== null ? value : EMPTY;
  const project = normalizeSections(source);
  return source.labelSystem === LABEL_SYSTEM ? project : withLabelLook(project, legacyLook(project.base));
};

// Заготовка проекта с готовой формой: разделы — свежие копии заводских значений.
const blankProject = () => ({
  schemaVersion: SCHEMA_VERSION,
  template: "original",
  base: null,
  zones: null,
  markers: null,
  paint: null,
  emblems: null,
  export: null,
  zoom: null,
  pauseMap: null,
  radar: null,
});

export const createWorldMapConfig = (patch = {}) => {
  const factory = blankProject();
  factory.base = { ...defaults.DEFAULT_BASE };
  factory.zones = { ...defaults.DEFAULT_ZONES };
  factory.markers = { ...defaults.DEFAULT_MARKER_SECTION };
  factory.paint = { ...defaults.DEFAULT_PAINT };
  factory.emblems = { ...defaults.DEFAULT_EMBLEMS };
  factory.export = { ...defaults.DEFAULT_EXPORT };
  factory.zoom = { ...DEFAULT_MAP_ZOOM };
  factory.pauseMap = { ...defaults.DEFAULT_PAUSE_MAP };
  factory.radar = { ...defaults.DEFAULT_RADAR };
  return normalizeWorldMap({ ...factory, ...patch });
};
