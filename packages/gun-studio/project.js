import { normalizeDecorations } from "./decorations.js";
import { ownMagazineMode, projectOwnFit } from "./own-fit.js";
import { findPattern, PATTERN_IDS } from "./patterns.js";
import {
  MODEL_MATERIAL_TINT,
  MODEL_MATERIALS,
  MODEL_XRAY_GLOW,
  normalizeModelMaterial,
} from "@modovik/rage-drawable/material-pixels";

export { MODEL_MATERIAL_TINT, MODEL_MATERIALS, normalizeModelMaterial };
export const MODEL_GLOW = MODEL_XRAY_GLOW;

const freeze = Object.freeze;

// ---- Константы и таблицы ----

export const PROJECT_SCHEMA_VERSION = 2;
export const MAX_STICKERS = 12;
export const MAX_STICKER_TEXT = 40;
export const PATTERN_COLOURS = 4;
export const MAX_DETACHED_MATERIALS = 16;
export const MAX_DETACHED_PIECES = 64;
export const MAX_PROJECT_ATTACHMENTS = 8;
export const TEXTURE_SIZES = freeze([256, 512, 1024, 2048]);
export const LAYER_KINDS = freeze(["paint", "image", "text", "fill", "pattern", "shade"]);
export const TEXT_FONT_IDS = freeze(["sans", "serif", "mono", "stencil", "script", "gothic"]);

export const GLOW_GAME_MODES = freeze([
  { id: "always", label: { ru: "Всегда" } },
  { id: "night", label: { ru: "Ночью" } },
  { id: "off", label: { ru: "Нет" } },
]);

export const BLEND_GROUPS = freeze(
  [
    ["normal", "Обычные", "Normal"],
    ["darken", "Затемнение", "Darken"],
    ["lighten", "Осветление", "Lighten"],
    ["contrast", "Контраст", "Contrast"],
    ["inversion", "Разница", "Inversion"],
    ["component", "Цвет", "Component"],
  ].map(([id, ru, en]) => ({ id, label: { ru, en } })),
);

// id, группа, подпись ru, подпись en, подсказка ru
export const BLEND_MODES = freeze(
  [
    ["source-over", "normal", "Обычный", "Normal", "Слой просто лежит сверху"],
    ["darken", "darken", "Замена тёмным", "Darken", "Остаётся более тёмный из двух цветов"],
    ["multiply", "darken", "Умножение", "Multiply", "Грязь, тени, копоть — белое исчезает"],
    ["color-burn", "darken", "Затемнение основы", "Color burn", "Густой, выжженный цвет в тенях"],
    ["lighten", "lighten", "Замена светлым", "Lighten", "Остаётся более светлый из двух цветов"],
    ["screen", "lighten", "Экран", "Screen", "Светлит, чёрное исчезает"],
    ["color-dodge", "lighten", "Осветление основы", "Color dodge", "Яркие блики и накал"],
    ["lighter", "lighten", "Линейный осветлитель", "Add", "Складывает свет — неон и свечение"],
    ["overlay", "contrast", "Перекрытие", "Overlay", "Узор ложится на металл, не пряча его фактуру"],
    ["soft-light", "contrast", "Мягкий свет", "Soft light", "Тонкая тонировка поверх фактуры"],
    ["hard-light", "contrast", "Жёсткий свет", "Hard light", "Резкий контрастный рисунок"],
    ["difference", "inversion", "Разница", "Difference", "Кислотные, вывернутые цвета"],
    ["exclusion", "inversion", "Исключение", "Exclusion", "Как разница, но мягче"],
    ["hue", "component", "Цветовой тон", "Hue", "Меняет только оттенок"],
    ["saturation", "component", "Насыщенность", "Saturation", "Меняет только сочность цвета"],
    ["color", "component", "Цветность", "Colour", "Перекрашивает, сохраняя светотень"],
    ["luminosity", "component", "Яркость", "Luminosity", "Переносит только светлоту"],
  ].map(([id, group, ru, en, hint]) => ({ id, group, label: { ru, en }, hint: { ru: hint } })),
);

export const MODEL_SCALE = freeze({ min: 0.5, max: 2, standard: 1 });
export const MODEL_OPACITY = freeze({ min: 0.1, max: 1, standard: 1 });
export const MODEL_MATERIAL_OPACITY = freeze({ glass: 0.35, xray: 0.8 });

const BLEND_IDS = new Set(BLEND_MODES.map((mode) => mode.id));
const GLOW_MODE_IDS = new Set(GLOW_GAME_MODES.map((mode) => mode.id));
const EFFECT_MODES = ["gradient", "rainbow", "shimmer"];
const EFFECT_DIRECTIONS = ["along", "across", "height"];

const MAX_LAYERS_PER_MATERIAL = 48;
const DEFAULT_FILL = "#2b2f36";
const DEFAULT_FONT_NAME = "Свой шрифт";
const PATTERN_FALLBACK = freeze(["#1f2a1c", "#4b5b36", "#8a8f5c", "#c9c29a"]);

const FONT_ASSET = /^workshop-font:[0-9a-f]{64}$/;
const TATTOO_KEY = /^[a-z0-9_.-]{1,64}:[a-z0-9_.-]{1,80}$/;
const LINK_ID = /^link-[a-z0-9]{1,12}$/;
const STORED_ID = /^[a-z]{2,12}-[a-z0-9]{1,12}$/;
const BONE_NAME = /^\w{1,48}$/;
const COMPONENT_NAME = /^COMPONENT_[A-Z0-9_]{1,80}$/;
const LOOK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const BUILT_IN_SOURCE = /^emblem:/;

// Границы числовых полей при правке. Таблицы — обычные объекты, и это сохранено намеренно: ключ правки
// с именем из прототипа (constructor, toString…) находится в таблице и роняет правку TypeError, как и раньше.
const LAYER_RANGES = {
  opacity: [0, 100],
  x: [-100, 200],
  y: [-50, 150],
  scale: [1, 400],
  rotation: [-180, 180],
  size: [1, 200],
  outlineWidth: [0, 20],
  seed: [0, 999],
  contrast: [0, 200],
  glow: [0, 100],
};
const PATTERN_SCALE_RANGE = [10, 400];

const STICKER_RANGES = {
  size: [1, 100],
  rotation: [-180, 180],
  wear: [0, 100],
  opacity: [0, 100],
  outline: [0, 20],
  stencil: [0, 100],
};

// Общие поля узора, которые переходят на все слои одной связи.
const LINKED_KEYS = new Set([
  "pattern", "colours", "scale", "rotation", "seed", "contrast", "x", "y", "source", "blend", "opacity",
]);

// ---- Счётчик номеров ----

let sequence = 0;

export function resetLayerSequence(value = 0) {
  sequence = value;
}

function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${sequence.toString(36)}`;
}

// Сохранённый номер «обгоняет» счётчик, чтобы новый слой не занял имя из прочитанной работы.
function advanceSequence(id) {
  const number = parseInt(id.slice(id.lastIndexOf("-") + 1), 36);
  if (number > sequence) sequence = number;
}

// ---- Общие приведения ----

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const toNumber = (value) => {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : number;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, toNumber(value)));
const ranged = (value, fallback, min, max) =>
  value === undefined ? fallback : clamp(value, min, max);
const clip = (value, max) => `${value ?? ""}`.slice(0, max);
const named = (value, fallback, max = 80) => (value === undefined ? fallback : clip(value, max));
const blendOr = (value, fallback = "source-over") => (BLEND_IDS.has(value) ? value : fallback);
const roundTo = (value, factor) => Math.round(value * factor) / factor;
const isOwnSource = (source) => (source ? !BUILT_IN_SOURCE.test(String(source)) : false);
const isDataUrl = (source) => typeof source === "string" && source.startsWith("data:");
const hasControlChars = (text) =>
  [...text].some((char) => {
    const code = char.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
// Целое в границах или null.
const wholeIn = (value, min, max) => {
  const number = Number(value);
  const inside = Number.isSafeInteger(number) && Math.min(Math.max(number, min), max) === number;
  return inside ? number : null;
};

export function colour(value, fallback = "#ffffff") {
  const text = String(value);
  return HEX_COLOUR.test(text) ? text.toLowerCase() : fallback;
}

const IMAGE_SOURCE_FORMS = [
  /^asset:[a-z0-9:_-]{1,160}$/,
  /^emblem:[a-z0-9-]{1,48}$/,
  /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/,
  /^blob:[^\n]{1,512}$/,
  /^https?:\/\/[^\n]{1,2048}$/,
];

export function imageSource(value) {
  const text = String(value);
  return IMAGE_SOURCE_FORMS.some((form) => form.test(text)) ? text : null;
}

// Схема полей: ключ -> «как привести значение». Одна функция-обходчик собирает запись по схеме.
const num = (fallback, min, max, whole = false) => (value) => {
  const number = ranged(value, fallback, min, max);
  return whole ? Math.round(number) : number;
};
const ink = (fallback) => (value) => colour(value, fallback);

function readFields(params, schema) {
  return Object.fromEntries(
    Object.entries(schema).map(([key, read]) => [key, read(params[key])]),
  );
}

// ---- Слои ----

const LAYER_DEFAULTS = {
  visible: true,
  locked: false,
  opacity: 100,
  blend: "source-over",
  clip: false,
  glow: 0,
  mask: null,
  maskEnabled: true,
};

const baseLayer = (kind, name) => ({ id: nextId(kind), kind, name, ...LAYER_DEFAULTS });

// Свой шрифт: годный файл и имя до 60 знаков; иначе null.
function customFace(fontAsset, fontName) {
  if (typeof fontAsset !== "string" || !FONT_ASSET.test(fontAsset)) return null;
  return { font: "custom", fontAsset, fontName: clip(fontName || DEFAULT_FONT_NAME, 60) };
}

function fourColours(list) {
  return PATTERN_FALLBACK.map((spare, place) => colour(list[place], spare));
}

function attachLink(layer, link) {
  if (typeof link !== "string" || !LINK_ID.test(link)) return layer;
  layer.link = link;
  advanceSequence(link);
  return layer;
}

const IMAGE_FIELDS = {
  x: num(50, -100, 200),
  y: num(50, -50, 150),
  scale: num(30, 1, 400),
  rotation: num(0, -180, 180),
};
const TEXT_FIELDS = {
  size: num(18, 1, 200),
  colour: ink("#ffffff"),
  outline: ink("#000000"),
  outlineWidth: num(0, 0, 20),
  x: num(50, -50, 150),
  y: num(50, -50, 150),
  rotation: num(0, -180, 180),
};
const SHADE_FIELDS = {
  opacity: num(85, 0, 100),
  blend: (value) => blendOr(value, "overlay"),
  contrast: num(100, 0, 200),
};
const PATTERN_FIELDS = {
  scale: num(100, 10, 400),
  rotation: num(0, -180, 180),
  seed: num(0, 0, 999, true),
  contrast: num(100, 0, 200),
};

export function createPaintLayer(name = "Роспись") {
  return { ...baseLayer("paint", clip(name, 80)), data: null };
}

export function createImageLayer(params = {}) {
  const { source, tile, tattoo, link } = params;
  const layer = {
    ...baseLayer("image", named(params.name, "Картинка")),
    source: source || null,
    tile: Boolean(tile),
    ...readFields(params, IMAGE_FIELDS),
  };
  if (typeof tattoo === "string" && TATTOO_KEY.test(tattoo)) layer.tattoo = tattoo;
  return attachLink(layer, link);
}

export function createTextLayer(params = {}) {
  const { value, font, fontAsset, fontName } = params;
  const face =
    font === "custom"
      ? (customFace(fontAsset, fontName) ?? { font: "sans" })
      : { font: `${font ?? ""}` || "sans" };
  return {
    ...baseLayer("text", named(params.name, "Надпись")),
    value: named(value, "ASTRAL", 120),
    ...face,
    ...readFields(params, TEXT_FIELDS),
  };
}

// Эффект заливки; `fill` — цвет самой заливки, запасной для цветов эффекта.
export function fillEffect(description, fill = DEFAULT_FILL) {
  if (!isRecord(description) || !EFFECT_MODES.includes(description.mode)) return null;
  const base = colour(fill, DEFAULT_FILL);
  const turn = Number(description.shift);
  return {
    mode: description.mode,
    colour: colour(description.colour, base),
    colour2: colour(description.colour2, "#ffffff"),
    direction: EFFECT_DIRECTIONS.includes(description.direction) ? description.direction : "along",
    shift: Number.isFinite(turn) ? Math.round(((turn % 360) + 360) % 360) : 0,
  };
}

export function createFillLayer(params = {}) {
  const fill = colour(params.colour, DEFAULT_FILL);
  return {
    ...baseLayer("fill", named(params.name, "Заливка")),
    colour: fill,
    effect: fillEffect(params.effect, fill),
  };
}

export function createShadeLayer(params = {}) {
  return {
    ...baseLayer("shade", named(params.name, "Светотень")),
    ...readFields(params, SHADE_FIELDS),
  };
}

export function createPatternLayer(params = {}) {
  const entry = findPattern(params.pattern) ?? findPattern(PATTERN_IDS[0]);
  const given = params.colours;
  const layer = {
    ...baseLayer("pattern", named(params.name, "Узор")),
    pattern: entry.id,
    colours: given ? fourColours(Array.isArray(given) ? given : []) : [...entry.colours],
    ...readFields(params, PATTERN_FIELDS),
  };
  return attachLink(layer, params.link);
}

export function createLayerLink() {
  return nextId("link");
}

// ---- Деталь, наклейка, потёртость, проект ----

const MATERIAL_FIELDS = { width: num(512, 16, 4096), height: num(512, 16, 4096) };
const WEAR_FIELDS = { amount: num(0, 0, 100), seed: num(0, 0, 999, true) };
const AXES = ["x", "y", "z"];

const axisValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? roundTo(number, 1e5) : 0;
};

function readPoint(value) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(AXES.map((axis) => [axis, axisValue(source[axis])]));
}

function readNormal(value) {
  const point = readPoint(value);
  const length = Math.hypot(...Object.values(point));
  if (length === 0) return { x: 0, y: 0, z: 1 };
  return Object.fromEntries(AXES.map((axis) => [axis, roundTo(point[axis] / length, 1e5)]));
}

const stickerText = (value) => clip(`${value ?? ""}`.trim(), MAX_STICKER_TEXT);

const STICKER_FIELDS = {
  anchor: readPoint,
  normal: readNormal,
  size: num(18, 1, 100),
  rotation: num(0, -180, 180),
  flip: Boolean,
  wear: num(0, 0, 100),
  tint: ink(""),
  outline: num(0, 0, 20),
  outlineColour: ink("#ffffff"),
  opacity: num(100, 0, 100),
  blend: (value) => blendOr(value),
  stencil: num(0, 0, 100),
  stencilInvert: Boolean,
};

export function createMaterial(params = {}) {
  return { name: clip(params.name, 80), ...readFields(params, MATERIAL_FIELDS), layers: [] };
}

export function createSticker(params = {}) {
  const { font, fontAsset, fontName } = params;
  const face =
    (font === "custom" ? customFace(fontAsset, fontName) : null) ??
    { font: TEXT_FONT_IDS.includes(font) ? font : "sans" };
  return {
    id: nextId("sticker"),
    name: named(params.name, "Наклейка"),
    source: imageSource(params.source),
    text: stickerText(params.text),
    ...face,
    ...readFields(params, STICKER_FIELDS),
    visible: true,
  };
}

export function createWear(params = {}) {
  return readFields(params, WEAR_FIELDS);
}

// ---- Модель: размер, непрозрачность, материал, цвет, свечение ----

export function glowGameMode(value) {
  return GLOW_MODE_IDS.has(value) ? value : "always";
}

function normalizeModelNumber(value, limits, precision) {
  const number = Number(value);
  if (!Number.isFinite(number)) return limits.standard;
  return roundTo(Math.min(limits.max, Math.max(limits.min, number)), precision);
}

export const normalizeModelScale = (value) => normalizeModelNumber(value, MODEL_SCALE, 100);
export const normalizeModelOpacity = (value) => normalizeModelNumber(value, MODEL_OPACITY, 100);
export const normalizeModelGlow = (value) => normalizeModelNumber(value, MODEL_GLOW, 10);
export const normalizeModelTint = (value) => colour(value, "");

// Поля проекта, которые читаются и пишутся одним приведением, и их значения у нового проекта.
const MODEL_NORMALIZERS = {
  glowGame: glowGameMode,
  skinOff: (value) => value === true,
  modelScale: normalizeModelScale,
  modelOpacity: normalizeModelOpacity,
  modelMaterial: normalizeModelMaterial,
  modelTint: normalizeModelTint,
  modelGlow: normalizeModelGlow,
  ownFit: projectOwnFit,
  ownMagazine: ownMagazineMode,
};
const MODEL_DEFAULTS = {
  glowGame: "always",
  skinOff: false,
  modelScale: MODEL_SCALE.standard,
  modelOpacity: MODEL_OPACITY.standard,
  modelMaterial: "standard",
  modelTint: "",
  modelGlow: MODEL_GLOW.standard,
  ownFit: null,
  ownMagazine: "hide",
};
// Поля, которые меняют вид самой модели (цвет и свечение не считаются).
const MODEL_LOOK_KEYS = ["modelScale", "modelOpacity", "modelMaterial"];

const BLANK_BODY = {
  template: "",
  chroma: "",
  materials: null,
  stickers: [],
  decorations: [],
  wear: null,
  ...MODEL_DEFAULTS,
  attachments: {},
  attachmentLooks: {},
};

export function createGunProject({ name, modelId, materials = [] } = {}) {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: named(name, "Мой ган"),
    modelId: clip(modelId, 80),
    ...structuredClone(BLANK_BODY),
    materials: materials.map((material) => createMaterial(material)),
    wear: createWear(),
  };
}

export function modelTintOf(project) {
  return (
    normalizeModelTint(project?.modelTint) ||
    MODEL_MATERIAL_TINT[normalizeModelMaterial(project?.modelMaterial)] ||
    ""
  );
}

const differsFromDefault = (project, key) =>
  MODEL_NORMALIZERS[key](project?.[key]) !== MODEL_DEFAULTS[key];

export const projectTouchesScale = (project) => differsFromDefault(project, "modelScale");

export function projectTouchesModel(project) {
  return MODEL_LOOK_KEYS.some((key) => differsFromDefault(project, key));
}

// ---- Свечение в игре ----

const isShown = (item) => item.visible !== false;
const glowOf = (layer) => {
  const glow = Number(layer.glow);
  return glow > 0 ? glow : 0;
};
const strongestGlow = (material) =>
  material.layers.reduce((top, layer) => (isShown(layer) ? Math.max(top, glowOf(layer)) : top), 0);

export function gameGlowRequest(project, textureNameOf) {
  const mode = glowGameMode(project?.glowGame);
  const lit =
    mode === "off"
      ? []
      : (project?.materials ?? [])
          .map((material) => [material, strongestGlow(material)])
          .filter(([, power]) => power > 0);
  return lit.map(([material, power]) => ({
    texture: textureNameOf(material.name),
    mode,
    intensity: roundTo(0.5 + (3.5 * Math.min(power, 100)) / 100, 100),
  }));
}

export function glowingLayers(project) {
  return (project?.materials ?? []).reduce(
    (sum, material) => sum + material.layers.filter((layer) => isShown(layer) && glowOf(layer) > 0).length,
    0,
  );
}

// ---- Отделённые куски развёртки ----

const numbersIn = (list, count, min, max) => {
  if (!Array.isArray(list) || list.length !== count) return null;
  const numbers = list.map(Number);
  return numbers.every((number) => number >= min && number <= max) ? numbers : null;
};

function readRect(value) {
  if (value === null || typeof value !== "object") return null;
  const sides = [
    ["x", 0],
    ["y", 0],
    ["w", 1],
    ["h", 1],
  ].map(([side, min]) => [side, wholeIn(value[side], min, 16384)]);
  return sides.some(([, side]) => side === null) ? null : Object.fromEntries(sides);
}

function readPart(value) {
  if (value === null || typeof value !== "object") return null;
  const of = wholeIn(value.of, 0, 10_000_000);
  const spans = value.triangles;
  if (of === null || !Array.isArray(spans) || spans.length === 0 || spans.length > 4096) return null;
  const triangles = spans.map((span) =>
    Array.isArray(span) ? [wholeIn(span[0], 0, 10_000_000), wholeIn(span[1], 1, Infinity)] : null,
  );
  if (triangles.some((pair) => pair === null || pair.includes(null))) return null;
  const total = triangles.reduce((sum, [, count]) => sum + count, 0);
  return total > 200_000 ? null : { of, triangles };
}

function readPiece(value) {
  if (value === null || typeof value !== "object") return null;
  const parts = {
    mesh: wholeIn(value.mesh, 0, 4096),
    island: wholeIn(value.island, 0, 10_000_000),
    box: numbersIn(value.box, 4, -1, 2),
    from: readRect(value.from),
    to: readRect(value.to),
    size: numbersIn(value.size, 2, 1, 16384),
  };
  if (Object.values(parts).includes(null) || !parts.size.every(Number.isInteger)) return null;
  if (value.part === undefined) return parts;
  const part = readPart(value.part);
  return part ? { ...parts, part } : null;
}

export function normalizeDetached(value) {
  if (!isRecord(value)) return {};
  const kept = Object.entries(value)
    .slice(0, MAX_DETACHED_MATERIALS)
    .filter(([name, list]) => name.length >= 1 && name.length <= 96 && !hasControlChars(name) && Array.isArray(list))
    .map(([name, list]) => {
      const taken = new Set();
      const pieces = list
        .slice(0, MAX_DETACHED_PIECES)
        .map(readPiece)
        .filter((piece) => {
          if (!piece) return false;
          const key = `${piece.mesh}:${piece.island}`;
          return taken.has(key) ? false : Boolean(taken.add(key));
        });
      return [name, pieces];
    })
    .filter(([, pieces]) => pieces.length > 0);
  return Object.fromEntries(kept);
}

export function projectTouchesDetached(project) {
  return Object.keys(normalizeDetached(project?.detached)).length > 0;
}

// ---- «Красить только вещь»: отметка человека ----

export const MAX_ITEM_ONLY_PARTS = 2000;
const ITEM_PART_KEY = /^\d{1,3}:\d{1,5}$/;

/**
 * Отметка «красить только здесь» (16.11.2026): лист → ключи частей вещи «номер сетки в записи материала : номер острова» (`gun/item-mask.js`). Лист без отметки в карту не входит;
 * отметка, которой нечем стать (плохой ключ), отбрасывается. Пустой список — «человек отметил: вещи на этом листе нет» — не хранится: отметки нет, решает догадка.
 */
export function normalizeItemOnly(value) {
  if (!isRecord(value)) return {};
  const kept = Object.entries(value)
    .slice(0, MAX_DETACHED_MATERIALS)
    .filter(([name, list]) => name.length >= 1 && name.length <= 96 && !hasControlChars(name) && Array.isArray(list))
    .map(([name, list]) => [name, [...new Set(list.filter((key) => typeof key === "string" && ITEM_PART_KEY.test(key)))].slice(0, MAX_ITEM_ONLY_PARTS)])
    .filter(([, keys]) => keys.length > 0);
  return Object.fromEntries(kept);
}

export function projectTouchesItemOnly(project) {
  return Object.keys(normalizeItemOnly(project?.itemOnly)).length > 0;
}

// ---- Обвесы ----

function componentOf(raw) {
  const name = String(raw).trim().toUpperCase();
  return COMPONENT_NAME.test(name) ? name : null;
}

export function normalizeProjectAttachments(value) {
  if (!isRecord(value)) return {};
  const mounted = Object.entries(value)
    .filter(([bone]) => BONE_NAME.test(bone))
    .map(([bone, raw]) => [bone, componentOf(raw)])
    .filter(([, component]) => component !== null);
  return Object.fromEntries(mounted.slice(0, MAX_PROJECT_ATTACHMENTS));
}

export function projectTouchesAttachments(project) {
  return Object.keys(normalizeProjectAttachments(project?.attachments)).length > 0;
}

export function normalizeProjectAttachmentLooks(value, attachments) {
  if (!isRecord(value)) return {};
  const mounted = normalizeProjectAttachments(attachments);
  const looks = Object.entries(value)
    .filter(([bone, raw]) => Object.hasOwn(mounted, bone) && typeof raw === "string")
    .map(([bone, raw]) => [bone, raw.trim()])
    .filter(([, id]) => LOOK_ID.test(id));
  return Object.fromEntries(looks);
}

export function projectTouchesAttachmentLooks(project) {
  const looks = normalizeProjectAttachmentLooks(project?.attachmentLooks, project?.attachments);
  return Object.keys(looks).length > 0;
}

// Что в проекте зависит от обвесов и кусков: как читать из любого источника.
const MOUNT_FIELDS = [
  ["attachments", (source) => normalizeProjectAttachments(source.attachments)],
  [
    "attachmentLooks",
    (source, done) => normalizeProjectAttachmentLooks(source.attachmentLooks, done.attachments),
  ],
  ["detached", (source) => normalizeDetached(source.detached)],
  ["itemOnly", (source) => normalizeItemOnly(source.itemOnly)],
];

// ---- Списки с номерами: слои и наклейки ----

const indexOfId = (list, id) => (list ? list.findIndex((item) => item.id === id) : -1);

function takeAt(list, at) {
  const [taken] = at < 0 ? [] : list.splice(at, 1);
  return taken ?? null;
}

// Переставить элемент на позицию `to` (позиция считается уже без самого элемента).
function relocate(list, from, to) {
  list.splice(to, 0, ...list.splice(from, 1));
}

// Сдвиг: позиция и шаг складываются обычным сложением, результат зажимается в границы списка.
function slideBy(list, at, step) {
  const to = Math.max(0, Math.min(list.length - 1, at + step));
  if (to !== at) relocate(list, at, to);
}

function* probesFrom(at, direction, length) {
  for (let probe = at + direction; probe >= 0 && probe < length; probe += direction) yield probe;
}

// ---- Поиск, добавление, удаление, перемещение, копирование слоёв ----

export function findMaterial(project, name) {
  return project?.materials?.find((material) => material.name === name) ?? null;
}

function requireMaterial(project, name) {
  const material = findMaterial(project, name);
  if (!material) throw new Error(`В модели нет материала «${name}».`);
  return material;
}

function assertRoom(layers) {
  if (layers.length >= MAX_LAYERS_PER_MATERIAL) {
    throw new Error(`На один материал нельзя положить больше ${MAX_LAYERS_PER_MATERIAL} слоёв.`);
  }
}

// Стопка детали и позиция слоя в ней (-1, если слоя нет).
function layerSlot(project, materialName, layerId) {
  const { layers } = requireMaterial(project, materialName);
  return { layers, at: layers.findIndex((layer) => layer.id === layerId) };
}

export function findLayer(project, materialName, layerId) {
  return findMaterial(project, materialName)?.layers?.find((layer) => layer.id === layerId) ?? null;
}

export function addLayer(project, materialName, layer) {
  const { layers } = requireMaterial(project, materialName);
  assertRoom(layers);
  if (!LAYER_KINDS.includes(layer?.kind)) {
    throw new Error(`Неизвестный вид слоя: ${layer?.kind}`);
  }
  layers.unshift(layer);
  return layer;
}

export function removeLayer(project, materialName, layerId) {
  const { layers, at } = layerSlot(project, materialName, layerId);
  return takeAt(layers, at);
}

export function moveLayer(project, materialName, layerId, step) {
  const { layers, at } = layerSlot(project, materialName, layerId);
  if (at >= 0) slideBy(layers, at, step);
  return project;
}

export function duplicateLayer(project, materialName, layerId) {
  const { layers, at } = layerSlot(project, materialName, layerId);
  if (at < 0) return null;
  assertRoom(layers);
  const original = layers[at];
  const copy = structuredClone(original);
  delete copy.link;
  delete copy.tattoo;
  copy.id = nextId(copy.kind);
  copy.name = clip(`${original.name} — копия`, 80);
  layers.splice(at, 0, copy);
  return copy;
}

// ---- Правка слоя ----

const setText = (key, max) => (layer, value) => {
  layer[key] = clip(value, max);
};
const setFlag = (key) => (layer, value) => {
  layer[key] = Boolean(value);
};
const setColour = (key) => (layer, value) => {
  layer[key] = colour(value, layer[key]);
};

const LAYER_SETTERS = new Map([
  ["blend", (layer, value) => { layer.blend = blendOr(value); }],
  ["colour", setColour("colour")],
  ["outline", setColour("outline")],
  ["colours", (layer, value) => { layer.colours = fourColours(Array.isArray(value) ? value : []); }],
  ["effect", (layer, value) => { layer.effect = fillEffect(value, layer.colour); }],
  ["pattern", (layer, value) => { if (findPattern(value)) layer.pattern = value; }],
  ["name", setText("name", 80)],
  ["value", setText("value", 120)],
  ["mask", (layer, value) => { layer.mask = imageSource(value); }],
  ...["visible", "locked", "clip", "maskEnabled", "tile"].map((key) => [key, setFlag(key)]),
]);

function patchLayerField(layer, key, value) {
  if (key === "id" || key === "kind") return;
  const range = LAYER_RANGES[key];
  if (range) {
    const bounds = key === "scale" && layer.kind === "pattern" ? PATTERN_SCALE_RANGE : range;
    const number = clamp(value, ...bounds);
    layer[key] = key === "seed" ? Math.round(number) : number;
    return;
  }
  const setter = LAYER_SETTERS.get(key);
  if (setter) setter(layer, value);
  else layer[key] = value;
}

export function updateLayer(project, materialName, layerId, patch) {
  const { layers, at } = layerSlot(project, materialName, layerId);
  if (at < 0) return null;
  for (const [key, value] of Object.entries(patch ?? {})) patchLayerField(layers[at], key, value);
  return layers[at];
}

export function updateLinkedLayer(project, materialName, layerId, patch) {
  const layer = updateLayer(project, materialName, layerId, patch);
  if (!layer?.link) return layer;
  const shared = Object.entries(patch ?? {}).filter(([key]) => LINKED_KEYS.has(key));
  const twins = project.materials
    .flatMap((material) => material.layers)
    .filter((other) => other !== layer && other.link === layer.link);
  for (const twin of twins) {
    for (const [key, value] of shared) patchLayerField(twin, key, value);
  }
  return layer;
}

// ---- Наклейки ----

export function addSticker(project, sticker) {
  if (!project.stickers) project.stickers = [];
  if (project.stickers.length >= MAX_STICKERS) {
    throw new Error(`Больше ${MAX_STICKERS} наклеек не помещается.`);
  }
  if (!sticker?.source && !sticker?.text) throw new Error("У наклейки нет ни картинки, ни надписи.");
  project.stickers.push(sticker);
  return sticker;
}

const stickerFlag = (key) => (sticker, value) => {
  sticker[key] = Boolean(value);
};

// Шрифт: обычный стирает свой файл; «custom» принимается, только если годный файл есть в правке или уже у наклейки.
function setStickerFont(sticker, value, patch) {
  if (TEXT_FONT_IDS.includes(value)) {
    sticker.font = value;
    delete sticker.fontAsset;
    delete sticker.fontName;
    return;
  }
  if (value !== "custom") return;
  const face =
    customFace(patch.fontAsset, patch.fontName || sticker.fontName) ??
    customFace(sticker.fontAsset, sticker.fontName);
  if (face) Object.assign(sticker, face);
}

const STICKER_SETTERS = new Map([
  ["anchor", (sticker, value) => { sticker.anchor = readPoint(value); }],
  ["normal", (sticker, value) => { sticker.normal = readNormal(value); }],
  ["flip", stickerFlag("flip")],
  ["visible", stickerFlag("visible")],
  ["stencilInvert", stickerFlag("stencilInvert")],
  ["blend", (sticker, value) => { sticker.blend = blendOr(value); }],
  ["name", (sticker, value) => { sticker.name = clip(value, 80); }],
  ["tint", (sticker, value) => { sticker.tint = value ? colour(value, "") : ""; }],
  ["outlineColour", (sticker, value) => { sticker.outlineColour = colour(value, sticker.outlineColour); }],
  ["source", (sticker, value) => { sticker.source = imageSource(value) ?? sticker.source; }],
  [
    "text",
    (sticker, value) => {
      // Пустая надпись допустима, только пока у наклейки есть картинка.
      const text = stickerText(value);
      if (text || sticker.source) sticker.text = text;
    },
  ],
  ["font", setStickerFont],
]);

export function updateSticker(project, stickerId, patch) {
  const sticker = (project.stickers ?? []).find((item) => item.id === stickerId);
  if (!sticker) return null;
  for (const [key, value] of Object.entries(patch ?? {})) {
    const range = STICKER_RANGES[key];
    if (range) sticker[key] = clamp(value, ...range);
    else STICKER_SETTERS.get(key)?.(sticker, value, patch);
  }
  return sticker;
}

export function removeSticker(project, stickerId) {
  const list = project.stickers;
  return takeAt(list, indexOfId(list, stickerId));
}

export function moveSticker(project, stickerId, step) {
  const list = project.stickers;
  const at = indexOfId(list, stickerId);
  if (at >= 0) slideBy(list, at, step);
  return project;
}

// Сдвиг среди «своих»: читается только знак шага; чужие наклейки перепрыгиваются.
export function moveStickerAmong(project, stickerId, step, fits) {
  const list = project.stickers;
  const at = indexOfId(list, stickerId);
  if (at < 0) return project;
  const direction = Math.sign(step);
  if (Number.isNaN(direction)) {
    relocate(list, at, 0);
    return project;
  }
  for (const probe of probesFrom(at, direction, list.length)) {
    if (fits(list[probe])) {
      relocate(list, at, probe);
      break;
    }
  }
  return project;
}

// ---- Пустота, текстуры, сводка ----

const hasPositiveWear = (project) => Number(project.wear?.amount) > 0;

export function projectIsEmpty(project) {
  if (!project) return true;
  const touched = [
    () => (project.materials ?? []).some((material) => material.layers.length > 0),
    () => (project.stickers?.length ?? 0) > 0,
    () => normalizeDecorations(project.decorations).length > 0,
    () => hasPositiveWear(project),
    () => projectTouchesModel(project),
    () => projectTouchesAttachments(project),
  ];
  return !touched.some((check) => check());
}

export function projectTouchesTextures(project) {
  if (!project) return false;
  return (
    project.skinOff === true ||
    (project.materials ?? []).some((material) => material.layers.some(isShown)) ||
    (project.stickers ?? []).some(isShown) ||
    hasPositiveWear(project)
  );
}

export function projectStats(project) {
  const filled = (project?.materials ?? []).filter((material) => material.layers.length > 0);
  const countLayers = (matches) =>
    filled.reduce((sum, material) => sum + material.layers.filter(matches).length, 0);
  const wear = Number(project?.wear?.amount);
  return {
    materials: filled.map((material) => material.name),
    materialCount: filled.length,
    layers: countLayers(() => true),
    painted: countLayers((layer) => layer.kind === "paint"),
    stickers: project?.stickers?.length ?? 0,
    decorations: normalizeDecorations(project?.decorations).length,
    wear: Number.isNaN(wear) ? 0 : wear,
    glowing: glowingLayers(project),
  };
}

// ---- Запись ----

// Что снимается при записи без растров: правило возвращает правку записи или null.
const RASTER_SCRUBS = {
  layer: [
    (layer) => (layer.kind === "paint" ? { data: null } : null),
    (layer) => (layer.kind === "image" && isDataUrl(layer.source) ? { source: null } : null),
    (layer) => (layer.mask ? { mask: null } : null),
  ],
  sourced: [(entry) => (isDataUrl(entry.source) ? { source: null } : null)],
};

// Правила читают запись и при записи с растрами: пустое место (null) вместо слоя бросает TypeError.
function writeEntry(entry, includeRaster, scrubs) {
  const patches = scrubs.map((scrub) => scrub(entry));
  return Object.assign({ ...entry }, ...(includeRaster ? [] : patches));
}

export function serializeGunProject(project, { includeRaster = true } = {}) {
  const record = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: project.name,
    modelId: project.modelId,
    template: project.template ?? "",
    chroma: project.chroma ?? "",
    materials: project.materials.map((material) => ({
      name: material.name,
      width: material.width,
      height: material.height,
      layers: material.layers.map((layer) => writeEntry(layer, includeRaster, RASTER_SCRUBS.layer)),
    })),
    stickers: (project.stickers ?? []).map((sticker) =>
      writeEntry(sticker, includeRaster, RASTER_SCRUBS.sourced),
    ),
    decorations: normalizeDecorations(project.decorations).map((item) =>
      writeEntry({ ...item, source: item.source ?? null }, includeRaster, RASTER_SCRUBS.sourced),
    ),
    wear: { amount: 0, seed: 0, ...(isRecord(project.wear) ? project.wear : {}) },
  };
  for (const [key, normalize] of Object.entries(MODEL_NORMALIZERS)) record[key] = normalize(project[key]);

  // Обвесы, их виды и куски пишутся, только когда они есть.
  const mounted = {};
  for (const [key, read] of MOUNT_FIELDS) {
    mounted[key] = read(project, mounted);
    if (Object.keys(mounted[key]).length > 0) record[key] = mounted[key];
  }
  return [JSON.stringify(record, null, 2), ""].join("\n");
}

// ---- Чтение ----

// Обычный объект: имя вида из прототипа (toString, __proto__…) находит чужую функцию и ломает чтение.
const LAYER_BUILDERS = Object.fromEntries(
  LAYER_KINDS.map((kind, place) => [
    kind,
    [createPaintLayer, createImageLayer, createTextLayer, createFillLayer, createPatternLayer, createShadeLayer][place],
  ]),
);

// Общие поля слоя, которые восстанавливаются из записи поверх фабрики (в таком порядке).
const LAYER_RESTORE = [
  ["visible", (record) => record.visible !== false],
  ["locked", (record) => Boolean(record.locked)],
  ["clip", (record) => Boolean(record.clip)],
  ["opacity", (record) => (record.opacity == null ? 100 : clamp(record.opacity, 0, 100))],
  ["blend", (record) => blendOr(record.blend)],
  ["glow", (record) => (record.glow == null ? 0 : clamp(record.glow, 0, 100))],
  ["mask", (record) => imageSource(record.mask)],
  ["maskEnabled", (record) => record.maskEnabled !== false],
  ["name", (record, layer) => clip(record.name || layer.name, 80)],
];
const KIND_RESTORE = new Map([
  ["paint", [["data", (record) => record.data || null]]],
  ["image", [["source", (record) => imageSource(record.source)]]],
]);

// Годный id из записи сохраняется, и счётчик обгоняет его номер.
function keepStoredId(target, record) {
  const id = record?.id;
  if (typeof id !== "string" || !STORED_ID.test(id)) return;
  target.id = id;
  advanceSequence(id);
}

function readLayer(record) {
  const build = LAYER_BUILDERS[record?.kind];
  if (!build) return null;
  const layer = build({ ...record });
  keepStoredId(layer, record);
  const restore = [...LAYER_RESTORE, ...(KIND_RESTORE.get(record.kind) ?? [])];
  for (const [key, read] of restore) layer[key] = read(record, layer);
  return layer;
}

function readSticker(record) {
  const sticker = createSticker(record);
  keepStoredId(sticker, record);
  sticker.visible = record?.visible !== false;
  return sticker;
}

function readMaterial(entry) {
  const material = createMaterial(entry);
  material.layers = [...(entry.layers || [])].map(readLayer).filter(Boolean);
  return material;
}

// Как читается каждое поле проекта (кроме имени и модели); порядок чтения — порядок счётчика номеров.
const PROJECT_READERS = [
  ["template", (raw) => clip(raw.template, 48)],
  ["chroma", (raw) => clip(raw.chroma, 48)],
  ["materials", (raw) => [...(raw.materials || [])].map(readMaterial)],
  [
    "stickers",
    (raw) =>
      (raw.stickers ? [...raw.stickers].slice(0, MAX_STICKERS) : [])
        .map(readSticker)
        .filter((sticker) => sticker.source || sticker.text),
  ],
  ["decorations", (raw) => normalizeDecorations(raw.decorations)],
  ["wear", (raw) => createWear(raw.wear ?? {})],
  ...Object.entries(MODEL_NORMALIZERS).map(([key, normalize]) => [key, (raw) => normalize(raw[key])]),
  ...MOUNT_FIELDS,
];

export function parseGunProject(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!isRecord(raw)) throw new Error("Проект покраски повреждён.");
  const version = Number(raw.schemaVersion);
  if (version !== 1 && version !== 2) {
    throw new Error(`Проект покраски сделан в другой версии редактора (${raw.schemaVersion}).`);
  }
  const project = createGunProject({ name: raw.name, modelId: raw.modelId });
  for (const [key, read] of PROJECT_READERS) project[key] = read(raw, project);
  return project;
}

// ---- Приведение к материалам другой модели ----

export function reconcileMaterials(project, models) {
  const stored = project.materials;
  const matched = new Set();
  const resolved = new Map();
  for (const model of models) {
    const old = stored.find((material) => material.name === model.name);
    if (old) matched.add(old);
    const next = old
      ? { ...old, width: model.width, height: model.height }
      : createMaterial(model);
    resolved.set(next.name, next);
  }
  return {
    project: { ...project, materials: models.map((model) => resolved.get(model.name)).filter(Boolean) },
    orphaned: stored.filter((material) => !matched.has(material) && material.layers.length > 0),
  };
}

// ---- Ссылки на картинки и код работы ----

function* pictureRefs(project) {
  for (const material of project?.materials ?? []) {
    for (const layer of material.layers) {
      if (layer.kind === "paint") yield layer.data;
      if (layer.kind === "image") yield layer.source;
      yield layer.mask;
    }
  }
  for (const sticker of project?.stickers ?? []) yield sticker.source;
  for (const decoration of project?.decorations ?? []) yield decoration.source;
}

export function projectImageSources(project) {
  return [...new Set([...pictureRefs(project)].filter(Boolean))];
}

// Правила снятия для кода работы: что совпало, что это стоит и убирается ли запись целиком.
const LAYER_LOSS_RULES = [
  { hits: (layer) => Boolean(layer.mask), costs: { paint: 1 }, scrub: (layer) => { layer.mask = null; } },
  { hits: (layer) => layer.kind === "paint" && Boolean(layer.data), costs: { paint: 1 } },
  { hits: (layer) => layer.kind === "paint", removes: true },
  { hits: (layer) => layer.kind === "image" && isOwnSource(layer.source), costs: { images: 1 }, removes: true },
];
const PICTURE_LOSS_RULES = [
  { hits: (item) => isOwnSource(item.source), costs: { images: 1 }, removes: true },
];

function sift(items, rules, lost) {
  return items.filter((item) => {
    const matched = rules.filter((rule) => rule.hits(item));
    for (const rule of matched) {
      rule.scrub?.(item);
      for (const [kind, price] of Object.entries(rule.costs ?? {})) lost[kind] += price;
    }
    return !matched.some((rule) => rule.removes);
  });
}

export function shareableGunProject(project) {
  const copy = structuredClone(project);
  const lost = { paint: 0, images: 0 };
  for (const material of copy.materials ?? []) {
    material.layers = sift(material.layers, LAYER_LOSS_RULES, lost);
  }
  copy.stickers = sift(copy.stickers ?? [], PICTURE_LOSS_RULES, lost);
  copy.decorations = sift(copy.decorations ?? [], PICTURE_LOSS_RULES, lost);
  return { project: copy, lost };
}
