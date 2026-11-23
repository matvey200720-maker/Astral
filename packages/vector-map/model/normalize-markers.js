import {
  WORLD_MAP_LIMITS,
  number,
  clamp,
  color,
  flag,
  text,
  markerName,
  worldSize,
  decimal,
  choice,
} from "./values.js";
import {
  DEFAULT_MARKER_SECTION,
  DEFAULT_MARKER_OUTLINE,
  DEFAULT_MARKER_GLOW,
  OWN_GLYPH_LIMITS,
  GROUP_OUTLINE_MAX,
  LABEL_WEIGHTS,
  labelFontOf,
  groupList,
  titleMap,
  groupStyleMap,
} from "./defaults.js";
import { MARKER_CATEGORIES } from "../catalog.js";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";

const COORD_LIMIT = 20000;
const LABEL_SHIFT_LIMIT = 4000;
const MESH_EDITS_MAX = 4000;
const GLYPH_PATH_CHARS = "MLZ0123456789 .-";
const HEX_DIGITS = "0123456789abcdefABCDEF";
const CATEGORY_WEIGHTS = ["bold", "black"];
const ITEM_WEIGHTS = ["", ...LABEL_WEIGHTS];
// Собственная обводка подписи не задана, если сырое значение — одно из этих (каждая проверка читает поле заново).
const OUTLINE_UNSET = [null, undefined, ""];

const isObject = (value) => Boolean(value) && typeof value === "object";
const tenths = (value) => Math.round(value * 10) / 10;
const whole = (value, low, high, fallback) => Math.round(clamp(value, low, high, fallback));
const isDigit = (code) => code >= 48 && code <= 57;
const boolOrNull = (value) => (typeof value === "boolean" ? value : null);
// Конечное число проходит как есть, остальное — через `number`.
const coordOf = (raw) => (typeof raw === "number" && Number.isFinite(raw) ? raw : number(raw, null));

// ---------------------------------------------------------------------------
// Записи читаются по таблицам: строка — [ключ, вид чтения, параметры...].
// Один обходчик читает строки в порядке таблицы и кладёт готовые значения в ячейки
// по номеру строки; объект результата собирается из ячеек.
// ---------------------------------------------------------------------------
const TEXT = 0; // [ключ, TEXT, предел, запасное]
const TEXT_AT = 1; // [ключ, TEXT_AT, предел, запасное(номер)]: запасное строится, только если текст пуст
const NAME_AT = 2; // [ключ, NAME_AT, запасное(номер)]: имя точки в несколько строк
const FLAG = 3; // [ключ, FLAG, запасное]
const COLOUR_IF_SET = 4; // истинное сырое значение — цвет или null, ложное — null
const ROUNDED = 5; // [ключ, ROUNDED, мин, макс, запасное]: округлённое целое
const ROUNDED_IF_SET = 6; // как ROUNDED, но ложное сырое значение даёт null
const TENTHS = 7; // [ключ, TENTHS, мин, макс, запасное]: один знак после запятой
const WORLD_SIZE = 8; // [ключ, WORLD_SIZE, мин, макс]
const CHOICE = 9; // [ключ, CHOICE, список, запасное]
const COLOUR = 10; // [ключ, COLOUR, запасное]
const VIA = 11; // [ключ, VIA, функция]: значение поля проходит через функцию одного аргумента
const FLAG_BY = 12; // [ключ, FLAG_BY, запасное(описание)]: запасное берётся из описания категории (читает readCategory)
const COLOUR_BY = 13; // [ключ, COLOUR_BY, запасное(описание)]
const ROUNDED_BY = 14; // [ключ, ROUNDED_BY, мин, макс, запасное(описание)]
const CHOICE_BY = 15; // [ключ, CHOICE_BY, список, запасное(описание)]
const CUSTOM = 16; // [ключ, CUSTOM, читатель(запись, ячейки, номер строки, контекст)]: поле читает сам читатель

// Чтение поля по ключу: у каждого поля свой доступ к свойству (так движок держит быстрые обращения).
const FIELD = {
  id: (src) => src.id,
  group: (src) => src.group,
  category: (src) => src.category,
  name: (src) => src.name,
  enabled: (src) => src.enabled,
  locked: (src) => src.locked,
  label: (src) => src.label,
  dot: (src) => src.dot,
  circle: (src) => src.circle,
  color: (src) => src.color,
  iconAssetId: (src) => src.iconAssetId,
  scale: (src) => src.scale,
  circleRadius: (src) => src.circleRadius,
  outline: (src) => src.outline,
  glow: (src) => src.glow,
  rotation: (src) => src.rotation,
  textHeight: (src) => src.textHeight,
  textWidth: (src) => src.textWidth,
  dotRadius: (src) => src.dotRadius,
  iconMeters: (src) => src.iconMeters,
  font: (src) => src.font,
  weight: (src) => src.weight,
  labelColor: (src) => src.labelColor,
  labelScale: (src) => src.labelScale,
  labelOutlineColor: (src) => src.labelOutlineColor,
  caps: (src) => src.caps,
  glyph: (src) => src.glyph,
  mesh: (src) => src.mesh,
  shadow: (src) => src.shadow,
  showLabel: (src) => src.showLabel,
  showDot: (src) => src.showDot,
  showCircle: (src) => src.showCircle,
  showBadge: (src) => src.showBadge,
  width: (src) => src.width,
  strength: (src) => src.strength,
};

// Нет значения, которое можно заранее посчитать (запасное зависит от контекста или поле читает читатель).
const NONE = Symbol("none");
const CONTEXT_KINDS = [TEXT_AT, NAME_AT, CUSTOM, FLAG_BY, COLOUR_BY, ROUNDED_BY, CHOICE_BY];

// Одна ячейка по виду чтения; raw — уже прочитанное значение поля, src нужен только для повторного чтения,
// ctx — номер записи или описание категории.
const convert = (plan, at, raw, src, ctx) => {
  const { kinds, first, second, third, getters } = plan;
  switch (kinds[at]) {
    case TEXT:
      return text(raw, second[at], first[at]);
    case TEXT_AT:
      return text(raw, null, first[at]) ?? second[at](ctx);
    case NAME_AT:
      return markerName(raw, null) ?? first[at](ctx);
    case FLAG:
      return flag(raw, first[at]);
    case COLOUR:
      return color(raw, first[at]);
    case COLOUR_IF_SET:
      return raw ? color(getters[at](src), null) : null;
    case ROUNDED:
      return whole(raw, first[at], second[at], third[at]);
    case ROUNDED_IF_SET:
      return raw ? whole(getters[at](src), first[at], second[at], third[at]) : null;
    case TENTHS:
      return tenths(clamp(raw, first[at], second[at], third[at]));
    case WORLD_SIZE:
      return worldSize(raw, first[at], second[at]);
    case CHOICE:
      return choice(raw, first[at], second[at]);
    default:
      return first[at](raw);
  }
};

// Доступ к полю обязателен для каждой строки, кроме тех, где поле читает сам читатель.
const accessorOf = (row) => {
  const getter = FIELD[row[0]] ?? null;
  if (getter === null && row[1] !== CUSTOM) throw new Error(`Нет доступа к полю "${row[0]}"`);
  return getter;
};

const planOf = (rows) => {
  const plan = {
    kinds: rows.map((row) => row[1]),
    getters: rows.map(accessorOf),
    first: rows.map((row) => row[2]),
    second: rows.map((row) => row[3]),
    third: rows.map((row) => row[4]),
    readers: rows.map((row) => (row[1] === CUSTOM ? row[2] : null)),
    fixed: [],
  };
  // Отсутствующее поле даёт одно и то же значение: считаем его один раз тем же преобразованием.
  plan.fixed = rows.map((row, at) =>
    CONTEXT_KINDS.includes(row[1]) ? NONE : convert(plan, at, undefined, {}, undefined),
  );
  return plan;
};

const slotsOf = (rows) => Object.fromEntries(rows.map((row, at) => [row[0], at]));

const readRows = (plan, src, ctx) => {
  const { getters, readers, fixed } = plan;
  const cells = new Array(getters.length);
  for (let at = 0; at < getters.length; at += 1) {
    if (readers[at] !== null) {
      cells[at] = readers[at](src, cells, at, ctx);
      continue;
    }
    const raw = getters[at](src);
    cells[at] = raw === undefined && fixed[at] !== NONE ? fixed[at] : convert(plan, at, raw, src, ctx);
  }
  return cells;
};

// ----- обводка и свечение значка -----

// Обводка и свечение различаются только именем и пределами «силы»: строки у них одинаковые.
const decorationOf = (strengthKey, low, high, base) => {
  const plan = planOf([
    ["enabled", FLAG, true],
    [strengthKey, ROUNDED, low, high, base[strengthKey]],
    ["effect", CUSTOM, (src) => normalizeColourEffect(src.effect, base.effect)],
  ]);
  return (value) => {
    if (!isObject(value)) return null;
    const [enabled, strength, effect] = readRows(plan, value);
    return { enabled, [strengthKey]: strength, effect };
  };
};

const outlineOf = decorationOf("width", 2, 40, DEFAULT_MARKER_OUTLINE);
const glowOf = decorationOf("strength", 0, 100, DEFAULT_MARKER_GLOW);

export const normalizeMarkerOutline = (value) => outlineOf(value);
export const normalizeMarkerGlow = (value) => glowOf(value);

const shadowShift = (shift) => tenths(clamp(shift, -60, 60, 0));

export const normalizeShadow = (value) => {
  const hex = isObject(value) ? color(value.color, null) : null;
  if (hex === null) return null;
  return { color: hex, dx: shadowShift(value.dx), dy: shadowShift(value.dy) };
};

// ----- правки подписей донора -----

// Ключ: [-]N_[-]M[-K], где N и M — 1…6 цифр, K — 1…3 цифры. Возвращает конец числа или -1.
const numberEnd = (s, from, maxDigits) => {
  const start = s[from] === "-" ? from + 1 : from;
  let end = start;
  while (end < s.length && end - start < maxDigits && isDigit(s.charCodeAt(end))) end += 1;
  return end > start ? end : -1;
};

const isMeshKey = (s) => {
  const firstEnd = numberEnd(s, 0, 6);
  if (firstEnd < 0 || s[firstEnd] !== "_") return false;
  const secondEnd = numberEnd(s, firstEnd + 1, 6);
  if (secondEnd < 0) return false;
  if (secondEnd === s.length) return true;
  if (s[secondEnd] !== "-") return false;
  const tailStart = secondEnd + 1;
  let tailEnd = tailStart;
  while (tailEnd < s.length && tailEnd - tailStart < 3 && isDigit(s.charCodeAt(tailEnd))) tailEnd += 1;
  return tailEnd > tailStart && tailEnd === s.length;
};

// Цвет перекраски подписи: ровно «#» и шесть шестнадцатеричных цифр.
const isStrictHex = (s) => s.length === 7 && s[0] === "#" && [...s.slice(1)].every((ch) => HEX_DIGITS.includes(ch));

const TINT_FIELDS = ["color", "outlineColor"];

const tintOf = (entry) => {
  const tint = {};
  for (const field of TINT_FIELDS) {
    if (isStrictHex(String(entry?.[field] || ""))) tint[field] = String(entry[field]).toLowerCase();
  }
  return Object.keys(tint).length > 0 ? tint : null;
};

// Каждая часть правок возвращает значение или null, если правок нет (ничего не выделяется зря).
const hiddenKeysOf = (value) => {
  if (!Array.isArray(value?.meshHidden)) return null;
  const keys = [...new Set(value.meshHidden.map(String).filter(isMeshKey))].slice(0, MESH_EDITS_MAX);
  return keys.length > 0 ? keys : null;
};

const tintedOf = (value) => {
  if (!(value?.meshTints && typeof value.meshTints === "object")) return null;
  const tints = {};
  let found = false;
  Object.entries(value.meshTints)
    .filter(([key]) => isMeshKey(key))
    .slice(0, MESH_EDITS_MAX)
    .forEach(([key, entry]) => {
      const tint = tintOf(entry);
      if (tint) {
        tints[key] = tint;
        found = true;
      }
    });
  return found ? tints : null;
};

const replacedOf = (value) => {
  const raw = value?.replaces;
  return raw && isMeshKey(String(raw)) ? String(value.replaces) : "";
};

// Правки донора или null, когда их нет вовсе.
const collectMeshEdits = (value) => {
  const meshHidden = hiddenKeysOf(value);
  const meshTints = tintedOf(value);
  const replaces = replacedOf(value);
  if (!meshHidden && !meshTints && !replaces) return null;
  return { ...(meshHidden && { meshHidden }), ...(meshTints && { meshTints }), ...(replaces && { replaces }) };
};

export const meshEdits = (value) => collectMeshEdits(value) ?? {};

// ----- свои значки с карты мода -----

const isGlyphId = (id) =>
  id.length >= 1 &&
  id.length <= 24 &&
  [...id].every((ch, at) => {
    const code = ch.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || isDigit(code) || (at > 0 && code === 45);
  });

// Путь слоя или null: непустой, не длиннее предела и только из допустимых знаков.
const layerPathOf = (layer) => {
  const path = String(layer?.path || "");
  const fits = path.length > 0 && path.length <= OWN_GLYPH_LIMITS.pathLength;
  return fits && [...path].every((ch) => GLYPH_PATH_CHARS.includes(ch)) ? path : null;
};

const LAYER_PLAN = planOf([
  ["color", COLOUR, "#ffffff"],
  ["alpha", CUSTOM, (src) => Math.round(clamp(src.alpha, 0, 1, 1) * 100) / 100],
]);

const glyphLayersOf = (glyph) => {
  const layers = [];
  if (!Array.isArray(glyph?.layers)) return layers;
  glyph.layers.slice(0, OWN_GLYPH_LIMITS.layers).forEach((layer) => {
    const path = layerPathOf(layer);
    if (path === null) return;
    const [tint, alpha] = readRows(LAYER_PLAN, layer);
    layers.push({ path, color: tint, alpha });
  });
  return layers;
};

export const normalizeGlyphs = (value) => {
  const glyphs = {};
  if (!isObject(value) || Array.isArray(value)) return glyphs;
  Object.entries(value)
    .slice(0, OWN_GLYPH_LIMITS.glyphs)
    .forEach(([id, glyph]) => {
      if (!isGlyphId(id)) return;
      const layers = glyphLayersOf(glyph);
      if (layers.length > 0) glyphs[id] = { layers, main: whole(glyph.main, 0, layers.length - 1, 0) };
    });
  return glyphs;
};

// ----- категории каталога -----

// Запись пустая, когда настроек категории нет во входе: читаются только отсутствующие поля.
const NO_FIELDS = Object.freeze({});

// Строки категории: запасные значения берутся из описания категории каталога (контекст строки).
const CATEGORY_ROWS = [
  ["enabled", FLAG, true],
  ["color", COLOUR_BY, (cat) => cat.color],
  ["showLabel", FLAG_BY, (cat) => cat.labelShown !== false],
  ["showDot", FLAG_BY, (cat) => cat.dot !== false],
  ["showCircle", FLAG_BY, (cat) => Boolean(cat.circle)],
  ["showBadge", FLAG_BY, (cat) => Boolean(cat.badge)],
  ["labelScale", ROUNDED_BY, 40, 400, (cat) => cat.label?.scale ?? 100],
  ["labelColor", COLOUR_BY, (cat) => cat.label?.color || ""],
  ["weight", CHOICE_BY, CATEGORY_WEIGHTS, (cat) => cat.label?.weight || "bold"],
  [
    // без своей разрядки и без значения во входе (нет поля или сохранённый null) — null
    // («общая разрядка точек»), иначе число
    "spacing",
    CUSTOM,
    (item, cells, at, cat) =>
      item.spacing == null && cat.label?.spacing == null
        ? null
        : whole(item.spacing, 0, 80, cat.label?.spacing ?? 0),
  ],
  ["iconAssetId", TEXT, 96, ""],
];

const CATEGORY_PLAN = planOf(CATEGORY_ROWS);
const CATEGORY_AT = slotsOf(CATEGORY_ROWS);

// Обходчик категорий: те же строки, но запасное значение берётся из описания категории.
// Пустая замороженная запись (настроек нет) не читается: её поля заведомо не заданы.
const readCategory = (item, cat) => {
  const { kinds, first, second, third, getters, readers, fixed } = CATEGORY_PLAN;
  const cells = new Array(getters.length);
  const blank = item === NO_FIELDS;
  for (let at = 0; at < getters.length; at += 1) {
    if (readers[at] !== null) {
      cells[at] = readers[at](item, cells, at, cat);
      continue;
    }
    const raw = blank ? undefined : getters[at](item);
    switch (kinds[at]) {
      case FLAG_BY:
        cells[at] = flag(raw, first[at](cat));
        break;
      case COLOUR_BY:
        cells[at] = color(raw, first[at](cat));
        break;
      case ROUNDED_BY:
        cells[at] = whole(raw, first[at], second[at], third[at](cat));
        break;
      case CHOICE_BY:
        cells[at] = choice(raw, first[at], second[at](cat));
        break;
      default:
        cells[at] = raw === undefined ? fixed[at] : convert(CATEGORY_PLAN, at, raw, item, cat);
    }
  }
  return cells;
};

const categoryOf = (item, cat) => {
  const cells = readCategory(item, cat);
  return {
    enabled: cells[CATEGORY_AT.enabled],
    color: cells[CATEGORY_AT.color],
    showLabel: cells[CATEGORY_AT.showLabel],
    showDot: cells[CATEGORY_AT.showDot],
    showCircle: cells[CATEGORY_AT.showCircle],
    showBadge: cells[CATEGORY_AT.showBadge],
    labelScale: cells[CATEGORY_AT.labelScale],
    labelColor: cells[CATEGORY_AT.labelColor],
    weight: cells[CATEGORY_AT.weight],
    spacing: cells[CATEGORY_AT.spacing],
    iconAssetId: cells[CATEGORY_AT.iconAssetId],
  };
};

export const normalizeCategories = (value) => {
  const source = isObject(value) ? value : {};
  const categories = {};
  for (const cat of MARKER_CATEGORIES) categories[cat.id] = categoryOf(source[cat.id] || NO_FIELDS, cat);
  return categories;
};

// ----- точка -----

// Сдвиг подписи по оси: незаданное значение даёт один и тот же результат, его считаем один раз.
const SHIFT_BLANK = clamp(undefined, -LABEL_SHIFT_LIMIT, LABEL_SHIFT_LIMIT, 0);
const shiftOf = (raw) => (raw === undefined ? SHIFT_BLANK : clamp(raw, -LABEL_SHIFT_LIMIT, LABEL_SHIFT_LIMIT, 0));

// Поле сдвига читается заново для каждой оси.
const labelShiftOf = (src) => {
  const x = shiftOf(src.labelOffset?.x);
  const y = shiftOf(src.labelOffset?.y);
  return { x, y };
};

// Собственная обводка подписи: null, пока сырое значение не задано или не число.
const labelOutlineOf = (src) => {
  for (let at = 0; at < OUTLINE_UNSET.length; at += 1) if (src.labelOutline === OUTLINE_UNSET[at]) return null;
  if (!Number.isFinite(Number(src.labelOutline))) return null;
  return Math.round(clamp(src.labelOutline, 0, GROUP_OUTLINE_MAX, 0));
};

const ITEM_ROWS = [
  ["id", TEXT_AT, 64, (index) => `marker-${index}`],
  ["group", TEXT, 40, ""],
  ["category", TEXT, 32, "landmark"],
  ["name", NAME_AT, (index) => `Точка ${index + 1}`],
  ["enabled", FLAG, true],
  ["locked", FLAG, false],
  ["label", FLAG, true],
  ["dot", FLAG, true],
  ["circle", FLAG, false],
  ["color", COLOUR_IF_SET],
  ["iconAssetId", TEXT, 96, ""],
  ["scale", ROUNDED, 40, 240, 100],
  ["circleRadius", ROUNDED_IF_SET, 40, 4000, 320],
  ["labelOffset", CUSTOM, labelShiftOf],
  ["outline", VIA, normalizeMarkerOutline],
  ["glow", VIA, normalizeMarkerGlow],
  ["rotation", TENTHS, -180, 180, 0],
  ["textHeight", WORLD_SIZE, 2, 600],
  ["textWidth", WORLD_SIZE, 2, 6000],
  ["dotRadius", WORLD_SIZE, 1, 400],
  ["iconMeters", WORLD_SIZE, 4, 800],
  ["font", VIA, (raw) => labelFontOf(raw)],
  ["weight", CHOICE, ITEM_WEIGHTS, ""],
  ["labelColor", COLOUR_IF_SET],
  ["labelScale", ROUNDED, 10, 300, 100],
  ["labelOutline", CUSTOM, labelOutlineOf],
  ["labelOutlineColor", COLOUR_IF_SET],
  ["caps", VIA, boolOrNull],
  ["glyph", TEXT, 24, ""],
  ["mesh", TEXT, 48, ""],
  ["meshEdits", CUSTOM, collectMeshEdits],
  ["shadow", VIA, normalizeShadow],
];

const ITEM_PLAN = planOf(ITEM_ROWS);
const ITEM_AT = slotsOf(ITEM_ROWS);

export const normalizeMarkerItem = (value, index) => {
  const x = coordOf(value?.x);
  const y = coordOf(value?.y);
  if (x === null || y === null) return null;
  const cells = readRows(ITEM_PLAN, value, index);
  const item = {
    id: cells[ITEM_AT.id],
    group: cells[ITEM_AT.group],
    category: cells[ITEM_AT.category],
    name: cells[ITEM_AT.name],
    x: Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, x)),
    y: Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, y)),
    enabled: cells[ITEM_AT.enabled],
    locked: cells[ITEM_AT.locked],
    label: cells[ITEM_AT.label],
    dot: cells[ITEM_AT.dot],
    circle: cells[ITEM_AT.circle],
    color: cells[ITEM_AT.color],
    iconAssetId: cells[ITEM_AT.iconAssetId],
    scale: cells[ITEM_AT.scale],
    circleRadius: cells[ITEM_AT.circleRadius],
    labelOffset: cells[ITEM_AT.labelOffset],
    outline: cells[ITEM_AT.outline],
    glow: cells[ITEM_AT.glow],
    rotation: cells[ITEM_AT.rotation],
    textHeight: cells[ITEM_AT.textHeight],
    textWidth: cells[ITEM_AT.textWidth],
    dotRadius: cells[ITEM_AT.dotRadius],
    iconMeters: cells[ITEM_AT.iconMeters],
    font: cells[ITEM_AT.font],
    weight: cells[ITEM_AT.weight],
    labelColor: cells[ITEM_AT.labelColor],
    labelScale: cells[ITEM_AT.labelScale],
    labelOutline: cells[ITEM_AT.labelOutline],
    labelOutlineColor: cells[ITEM_AT.labelOutlineColor],
    caps: cells[ITEM_AT.caps],
    glyph: cells[ITEM_AT.glyph],
    mesh: cells[ITEM_AT.mesh],
    shadow: cells[ITEM_AT.shadow],
  };
  const edits = cells[ITEM_AT.meshEdits];
  if (edits === null) return item;
  // правки донора стоят между `mesh` и `shadow`
  const { shadow, ...head } = item;
  return { ...head, ...edits, shadow };
};

// ----- раздел -----

// Читатели полей раздела: (сырое значение, заводское запасное) → готовое значение.
const flagOf = () => (raw, fallback) => flag(raw, fallback);
const colourOf = () => (raw, fallback) => color(raw, fallback);
const roundedOf = (low, high) => (raw, fallback) => whole(raw, low, high, fallback);
const decimalOf = (low, high) => (raw, fallback) => decimal(raw, low, high, fallback);
const choiceOf = (list) => (raw, fallback) => choice(raw, list, fallback);
const withoutFallback = (convert) => (raw) => convert(raw);

const SECTION_ROWS = [
  ["enabled", flagOf()],
  ["icons", flagOf()],
  ["iconSize", decimalOf(6, 48)],
  ["font", (raw, fallback) => labelFontOf(raw, fallback)],
  ["hiddenGroups", withoutFallback(groupList)],
  ["groupOrder", withoutFallback(groupList)],
  ["groupTitles", withoutFallback(titleMap)],
  ["groupStyles", withoutFallback(groupStyleMap)],
  ["lockedGroups", withoutFallback(groupList)],
  ["labelSize", decimalOf(6, 64)],
  ["labelColor", colourOf()],
  ["labelAuto", flagOf()],
  ["labelOutline", roundedOf(0, 100)],
  ["labelOutlineColor", colourOf()],
  ["labelCase", choiceOf(["upper", "original"])],
  ["declutter", flagOf()],
  ["letterSpacing", roundedOf(0, 40)],
  ["dotSize", decimalOf(0, 40)],
  ["dotOpacity", roundedOf(0, 100)],
  ["circleStyle", choiceOf(["dashed", "solid", "none"])],
  ["circleRadius", roundedOf(40, 4000)],
  ["circleWidth", decimalOf(0.4, 16)],
  ["circleOpacity", roundedOf(0, 100)],
  ["categories", withoutFallback(normalizeCategories)],
  ["glyphs", withoutFallback(normalizeGlyphs)],
];

export const normalizeMarkers = (value) => {
  const source = isObject(value) ? value : {};
  const items = [];
  if (Array.isArray(source.items)) {
    source.items.slice(0, WORLD_MAP_LIMITS.markers).forEach((raw, index) => {
      const marker = normalizeMarkerItem(raw, index);
      if (marker) items.push(marker);
    });
  }
  const section = {};
  for (const [key, read] of SECTION_ROWS) section[key] = read(source[key], DEFAULT_MARKER_SECTION[key]);
  section.items = items;
  return section;
};
