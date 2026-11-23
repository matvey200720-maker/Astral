import { WORLD_MAP_LIMITS, choice, clamp, color, decimal, flag, number, text } from "./values.js";
import {
  DEFAULT_ZONES,
  LEGACY_ZONE_LOOK,
  ZONE_FILL_MODES,
  ZONE_STROKE_ALIGNS,
  groupList,
  groupStyleMap,
  labelFontOf,
  titleMap,
} from "./defaults.js";
import { ZONE_LINES, ZONE_SHAPE_IDS } from "../shapes.js";
import { upgradeMajesticCircle } from "../label-sets.js";

const COORD_LIMIT = 20000;
const LABEL_SHIFT_LIMIT = 4000;
const MAJESTIC_CIRCLES = "majestic-circles";

const isObject = (value) => Boolean(value) && typeof value === "object";
const asObject = (value) => (isObject(value) ? value : {});
const whole = (value, low, high, fallback) => Math.round(clamp(value, low, high, fallback));
// Конечное число проходит как есть, остальное — через `number`.
const coordOf = (raw) => (typeof raw === "number" && Number.isFinite(raw) ? raw : number(raw, null));

// ---------------------------------------------------------------------------
// Записи читаются по таблицам: строка — [ключ, вид чтения, параметры...].
// Все строки записи читаются одним обходчиком в порядке таблицы; готовые значения
// ложатся в ячейки по номеру строки, а объект результата собирается из ячеек.
// ---------------------------------------------------------------------------
const TEXT = 0; // [ключ, TEXT, предел, запасное]
const TEXT_AT = 1; // как TEXT, но запасное — функция номера записи (строится, только если текст пуст)
const COLOUR = 2; // [ключ, COLOUR, запасное]
const FLAG = 3; // [ключ, FLAG, запасное]
const COLOUR_IF_SET = 4; // истинное сырое значение — цвет или null, ложное — null
const CHOICE = 5; // [ключ, CHOICE, список, запасное]
const CUSTOM = 6; // [ключ, CUSTOM, читатель(запись, ячейки, номер строки)]: поле читает сам читатель

// Нет значения, которое можно заранее посчитать (запасное зависит от номера записи или поле читает читатель).
const NONE = Symbol("none");

// Чтение поля по ключу: у каждого поля свой доступ к свойству (так движок держит быстрые обращения).
const FIELD = {
  id: (src) => src.id,
  group: (src) => src.group,
  name: (src) => src.name,
  hint: (src) => src.hint,
  color: (src) => src.color,
  fillColor: (src) => src.fillColor,
  enabled: (src) => src.enabled,
  locked: (src) => src.locked,
  label: (src) => src.label,
  shape: (src) => src.shape,
  line: (src) => src.line,
  fill: (src) => src.fill,
  halo: (src) => src.halo,
};

// Одна ячейка по виду чтения; raw — уже прочитанное значение поля, src нужен только для повторного чтения.
const convert = (plan, at, raw, src, index) => {
  const { kinds, first, second, getters } = plan;
  switch (kinds[at]) {
    case TEXT:
      return text(raw, second[at], first[at]);
    case TEXT_AT:
      return text(raw, null, first[at]) ?? second[at](index);
    case COLOUR:
      return color(raw, first[at]);
    case FLAG:
      return flag(raw, first[at]);
    case COLOUR_IF_SET:
      return raw ? color(getters[at](src), null) : null;
    default:
      return choice(raw, first[at], second[at]);
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
    readers: rows.map((row) => (row[1] === CUSTOM ? row[2] : null)),
    fixed: [],
  };
  // Отсутствующее поле даёт одно и то же значение: считаем его один раз тем же преобразованием.
  plan.fixed = rows.map((row, at) =>
    row[1] === CUSTOM || row[1] === TEXT_AT ? NONE : convert(plan, at, undefined, {}, undefined),
  );
  return plan;
};

const slotsOf = (rows) => Object.fromEntries(rows.map((row, at) => [row[0], at]));

const readRows = (plan, src, index) => {
  const { getters, readers, fixed } = plan;
  const cells = new Array(getters.length);
  for (let at = 0; at < getters.length; at += 1) {
    if (readers[at] !== null) {
      cells[at] = readers[at](src, cells, at);
      continue;
    }
    const raw = getters[at](src);
    cells[at] = raw === undefined && fixed[at] !== NONE ? fixed[at] : convert(plan, at, raw, src, index);
  }
  return cells;
};

// Рамка: ключ оси, границы, запасное. Читается всегда, но берётся только у фигуры не `free` и только объектом.
const BOX_AXES = [
  ["x", -COORD_LIMIT, COORD_LIMIT, 0],
  ["y", -COORD_LIMIT, COORD_LIMIT, 0],
  ["w", 20, 40000, 400],
  ["h", 20, 40000, 400],
  ["rotation", -180, 180, 0],
];

const boxOf = (src, cells, at) => {
  const raw = src?.box;
  if (cells[at - 1] === "free" || !isObject(raw)) return null;
  const [x, y, w, h, rotation] = BOX_AXES.map(([axis, low, high, fallback]) => whole(raw[axis], low, high, fallback));
  return { x, y, w, h, rotation };
};

// Толщина: null, undefined и пустая строка — «общая» (каждая проверка читает поле заново).
const WIDTH_UNSET = [null, undefined, ""];

const strokeWidthOf = (src) => {
  for (let at = 0; at < WIDTH_UNSET.length; at += 1) if (src?.width === WIDTH_UNSET[at]) return null;
  return decimal(src.width, 0, 24, DEFAULT_ZONES.strokeWidth);
};

// Сдвиг подписи по оси: незаданное значение даёт один и тот же результат, его считаем один раз.
const SHIFT_BLANK = clamp(undefined, -LABEL_SHIFT_LIMIT, LABEL_SHIFT_LIMIT, 0);
const shiftOf = (raw) => (raw === undefined ? SHIFT_BLANK : clamp(raw, -LABEL_SHIFT_LIMIT, LABEL_SHIFT_LIMIT, 0));

// Поле сдвига читается заново для каждой оси.
const labelShiftOf = (src) => {
  const x = shiftOf(src?.labelOffset?.x);
  const y = shiftOf(src?.labelOffset?.y);
  return { x, y };
};

// Вид зоны как фигуры; строки идут в порядке чтения (толщина читается раньше линии).
const LOOK_ROWS = [
  ["shape", CHOICE, ZONE_SHAPE_IDS, "free"],
  ["box", CUSTOM, boxOf],
  ["width", CUSTOM, strokeWidthOf],
  ["line", CHOICE, ZONE_LINES, "solid"],
  ["fill", FLAG, true],
  ["halo", FLAG, false],
];

const ITEM_ROWS = [
  ["id", TEXT_AT, 64, (index) => `zone-${index}`],
  ["group", TEXT, 40, ""],
  ["name", TEXT_AT, WORLD_MAP_LIMITS.nameLength, (index) => `Зона ${index + 1}`],
  ["hint", TEXT, WORLD_MAP_LIMITS.textLength, ""],
  ["color", COLOUR, "#ff5d72"],
  ["fillColor", COLOUR_IF_SET],
  ["enabled", FLAG, true],
  ["locked", FLAG, false],
  ["label", FLAG, true],
  ["labelOffset", CUSTOM, labelShiftOf],
  ...LOOK_ROWS,
];

const LOOK_PLAN = planOf(LOOK_ROWS);
const ITEM_PLAN = planOf(ITEM_ROWS);
const LOOK_AT = slotsOf(LOOK_ROWS);
const ITEM_AT = slotsOf(ITEM_ROWS);

export const normalizePoints = (value, fallback = []) => {
  const list = (Array.isArray(value) ? value : fallback).slice(0, WORLD_MAP_LIMITS.zonePoints);
  const entries = Array.isArray(list) ? list : [...list];
  const points = [];
  for (let at = 0; at < entries.length; at += 1) {
    const point = entries[at];
    const x = coordOf(point?.x);
    const y = coordOf(point?.y);
    if (x === null || y === null) continue;
    points.push({
      x: Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, x)),
      y: Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, y)),
    });
  }
  return points;
};

export const normalizeZoneLook = (value) => {
  const cells = readRows(LOOK_PLAN, value ?? {});
  const box = cells[LOOK_AT.box];
  return {
    shape: box ? cells[LOOK_AT.shape] : "free",
    box,
    line: cells[LOOK_AT.line],
    fill: cells[LOOK_AT.fill],
    width: cells[LOOK_AT.width],
    halo: cells[LOOK_AT.halo],
  };
};

// Круг Majestic старого проекта (без поля halo) обновляется до чтения остальных полей.
const isStaleCircle = (raw) => raw?.group === MAJESTIC_CIRCLES && raw.halo === undefined;

export const normalizeZoneItem = (raw, index) => {
  const rec = isStaleCircle(raw) ? upgradeMajesticCircle(raw) : raw;
  const points = normalizePoints(rec?.points);
  const open = rec?.open === true;
  const needed = open ? 2 : 3;
  if (points.length < needed) return null;
  const cells = readRows(ITEM_PLAN, rec, index);
  const box = cells[ITEM_AT.box];
  const zone = {
    id: cells[ITEM_AT.id],
    group: cells[ITEM_AT.group],
    name: cells[ITEM_AT.name],
    hint: cells[ITEM_AT.hint],
    color: cells[ITEM_AT.color],
    fillColor: cells[ITEM_AT.fillColor],
    enabled: cells[ITEM_AT.enabled],
    locked: cells[ITEM_AT.locked],
    label: cells[ITEM_AT.label],
    labelOffset: cells[ITEM_AT.labelOffset],
    shape: box ? cells[ITEM_AT.shape] : "free",
    box,
    line: cells[ITEM_AT.line],
    fill: cells[ITEM_AT.fill],
    width: cells[ITEM_AT.width],
    halo: cells[ITEM_AT.halo],
    points,
  };
  return open ? { open, ...zone } : zone;
};

// Читатели полей раздела: (сырое значение, запасное) → готовое значение.
const flagOf = () => (raw, fallback) => flag(raw, fallback);
const wholeOf = (low, high) => (raw, fallback) => whole(raw, low, high, fallback);
const decimalOf = (low, high) => (raw, fallback) => decimal(raw, low, high, fallback);
const choiceOf = (list) => (raw, fallback) => choice(raw, list, fallback);
const withoutFallback = (convert) => (raw) => convert(raw);

// [ключ, читатель, откуда запасное]: LOOK — по виду раздела (старый или новый), иначе заводское значение.
const LOOK = "look";
const SECTION_ROWS = [
  ["enabled", flagOf()],
  ["template", (raw, fallback) => text(raw, fallback, 32)],
  ["fillMode", choiceOf(ZONE_FILL_MODES), LOOK],
  ["fillOpacity", wholeOf(0, 100), LOOK],
  ["strokeAlign", choiceOf(ZONE_STROKE_ALIGNS), LOOK],
  ["strokeWidth", decimalOf(0, 16), LOOK],
  ["strokeOpacity", wholeOf(0, 100)],
  ["glow", wholeOf(0, 100), LOOK],
  ["labels", flagOf()],
  ["labelSize", decimalOf(4, 48)],
  ["labelColor", (raw, fallback) => color(raw, fallback)],
  ["labelTint", flagOf()],
  ["labelAuto", flagOf()],
  ["font", (raw, fallback) => labelFontOf(raw, fallback)],
  ["hiddenGroups", withoutFallback(groupList)],
  ["groupOrder", withoutFallback(groupList)],
  ["groupTitles", withoutFallback(titleMap)],
  ["groupStyles", withoutFallback(groupStyleMap)],
  ["lockedGroups", withoutFallback(groupList)],
  ["labelOutline", wholeOf(0, 100)],
];

export const normalizeZones = (value) => {
  const source = asObject(value);
  const lookDefaults = ZONE_FILL_MODES.includes(source.fillMode) ? DEFAULT_ZONES : LEGACY_ZONE_LOOK;
  const items = [];
  if (Array.isArray(source.items)) {
    source.items.slice(0, WORLD_MAP_LIMITS.zones).forEach((raw, index) => {
      const zone = normalizeZoneItem(raw, index);
      if (zone) items.push(zone);
    });
  }
  const section = {};
  for (const [key, read, origin] of SECTION_ROWS) {
    section[key] = read(source[key], (origin === LOOK ? lookDefaults : DEFAULT_ZONES)[key]);
  }
  section.items = items;
  return section;
};
