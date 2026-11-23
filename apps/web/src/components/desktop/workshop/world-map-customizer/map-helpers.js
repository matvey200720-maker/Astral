// Чистые помощники панели: подпись ряда, имя шрифта, шапка выбранного,
// правила «какой инструмент правит объект», проверки при чтении из памяти.
import { MARKER_CATEGORY_MAP, isUserGroup, mapEmblemFont } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { findObject } from "../world-map-editing.js";
import { MAP_PAGES } from "../world-map/MapPanel.jsx";
import {
  ERASER_MAX,
  ERASER_MIN,
  SHAPE_DEFAULT,
  TEXT_STYLE_DEFAULT,
  TOOL_IDS,
} from "./panel-data.js";

const LINE_BREAKS = new RegExp(`[\n\r${String.fromCharCode(8232, 8233)}]`);

const isAsciiDigit = (code) => code >= 48 && code <= 57;

// «АЗС №15» -> «АЗС №16»: растёт последнее число в конце строки
export function nextLabel(value) {
  const text = value == null ? "" : String(value);
  const tailAt = text.search(/\s*$/);
  let digitsAt = tailAt;
  while (digitsAt > 0 && isAsciiDigit(text.charCodeAt(digitsAt - 1))) digitsAt -= 1;
  if (digitsAt === tailAt || LINE_BREAKS.test(text.slice(0, digitsAt))) return text;
  const digits = text.slice(digitsAt, tailAt);
  const grown = String(Number(digits) + 1).padStart(digits.length, "0");
  return text.slice(0, digitsAt) + grown + text.slice(tailAt);
}

// Подпись шрифта в списке и в уведомлении
export function fontNameOf(asset) {
  const base = String(asset?.name || "")
    .replace(/\.[^.]*$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 48);
  return base || tr("Свой шрифт");
}

const kindWord = {
  zone: () => tr("Зона"),
  stroke: () => tr("Мазок"),
};

function pickHeadLabel(selection, object) {
  const fixed = kindWord[selection?.kind];
  if (fixed) return fixed();
  if (selection?.kind === "marker") {
    const plain = MARKER_CATEGORY_MAP[object?.category]?.glyph === "none";
    return plain ? tr("Подпись") : tr("Значок");
  }
  if (object?.kind === "text") return tr("Надпись");
  return object?.schedule ? tr("Расписание") : tr("Картинка");
}

// Шапка панели справа, когда показан выбранный объект
export function selectionHead(selection, object, onBack) {
  return {
    label: pickHeadLabel(selection, object),
    note: tr("Правка выбранного — Esc или щелчок мимо снимают выбор"),
    back: { label: tr("Снять выбор"), onClick: onBack },
  };
}

const belongsToSet = (object) => Boolean(object.group) && !isUserGroup(object.group);
const hasNoGlyph = (object) => MARKER_CATEGORY_MAP[object.category]?.glyph === "none";

const EDIT_TOOL_RULES = {
  zone: (object) => (belongsToSet(object) ? "areas" : "zones"),
  marker: (object) => (hasNoGlyph(object) || belongsToSet(object) ? "labels" : "markers"),
  stroke: () => "brush",
  emblem: (object) => {
    if (object.schedule) return "schedule";
    return object.kind === "text" ? "text" : "images";
  },
};

// Какой инструмент правит этот объект («Изменить», строка в «Слоях»)
export function toolForObject(config, target) {
  const object = findObject(config, target);
  const rule = object && EDIT_TOOL_RULES[target.kind];
  return rule ? rule(object) : "select";
}

const PICK_TOOL_BY_KIND = {
  zone: "zones",
  marker: "markers",
  stroke: "select",
};

// Инструмент, на котором щелчок по строке «Слоёв» оставляет выбор как есть
export function layerPickTool(config, target) {
  const direct = PICK_TOOL_BY_KIND[target.kind];
  if (direct) return direct;
  const object = findObject(config, target);
  if (object?.schedule) return "schedule";
  return object?.kind === "image" ? "images" : "text";
}

const oneLine = (text) => String(text).replace(/\n/g, " ");

// Название объекта для строки «Изменить выбранное»
export function layerRowTitle(object) {
  const written = typeof object.text === "string" ? oneLine(object.text) : "";
  if (written) return written;
  if (object.name) return object.name;
  return object.kind === "image" ? tr("Картинка") : tr("Выбранный объект");
}

const MENU_WORDS = {
  zone: () => tr("Зона"),
  marker: () => tr("Точка"),
  stroke: () => tr("Мазок"),
};

function menuWord(target, object) {
  const fixed = MENU_WORDS[target.kind];
  if (fixed) return fixed();
  return object.kind === "text" ? tr("Надпись") : tr("Картинка");
}

function menuName(target, object) {
  if (target.kind === "emblem") {
    return object.kind === "text" ? oneLine(object.text || "") : "";
  }
  return object.name || "";
}

// Заголовок меню объекта: «Зона «Порт»»
export function menuTitle(target, object) {
  const name = menuName(target, object).slice(0, 40);
  const word = menuWord(target, object);
  return name ? `${word} «${name}»` : word;
}

// Проверки при чтении из памяти редактора: годное значение или undefined
export const memoryRules = {
  tool: (value) => (TOOL_IDS.includes(value) ? value : undefined),
  mapPage: (value) => (typeof value === "string" && value in MAP_PAGES ? value : undefined),
  setPage: (value) => {
    const fits = typeof value === "string" && (value === "home" || value.startsWith("set:"));
    return fits ? value : undefined;
  },
  eraser: (value) => (Number.isFinite(value) ? clampEraser(Math.round(value)) : undefined),
  flag: (value) => (typeof value === "boolean" ? value : undefined),
  label: (value) => (typeof value === "string" ? value.slice(0, 64) : undefined),
  shape: (value) => (value && typeof value === "object" ? { ...SHAPE_DEFAULT, ...value } : undefined),
  text: (value) => {
    if (!value || typeof value !== "object") return undefined;
    const merged = { ...TEXT_STYLE_DEFAULT, ...value };
    merged.font = mapEmblemFont(merged.font);
    return merged;
  },
};

export const clampEraser = (size) => Math.min(ERASER_MAX, Math.max(ERASER_MIN, size));

export function pickedRule(config) {
  return (value) => {
    if (!Array.isArray(value)) return undefined;
    return value.filter((target) => target?.kind && target?.id && findObject(config, target));
  };
}

export function categoryRule(config) {
  const known = config.markers?.categories || {};
  return (value) => (typeof value === "string" && Object.hasOwn(known, value) ? value : undefined);
}

export const sameTarget = (a, b) => a.kind === b.kind && a.id === b.id;

export const toTarget = (kind, id) => ({ kind, id });

export const roundPoint = (world) => ({ x: Math.round(world.x), y: Math.round(world.y) });

// Строка пробелов по краям и ведущие переводы строки печатного текста
export const trimPrinted = (text) => text.replace(/\s+$/, "").replace(/^\n+/, "");
