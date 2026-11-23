import {
  BLEND_MODES,
  WORLD_MAP_LIMITS,
  choice,
  clamp,
  color,
  flag,
  number,
  text,
} from "./values.js";
import {
  DEFAULT_BRUSH,
  DEFAULT_PAINT,
  STROKE_ARROWS,
  STROKE_KINDS,
  STROKE_LINES,
  titleMap,
} from "./defaults.js";
import { isCurvePoints } from "../stroke-curve.js";

const COORD_LIMIT = 20000;
const POINT_CAP = WORLD_MAP_LIMITS.strokePoints;
const STROKE_CAP = WORLD_MAP_LIMITS.strokes;
const BLENDS = ["normal", ...BLEND_MODES];
const TARGETS = ["map", "top"];
const BRUSH_ARROWS = ["end", "both"];
const PAINT_ENABLED = DEFAULT_PAINT.enabled;
const NO_FIELDS = Object.freeze({});
const NO_CONTEXT = Object.freeze([]);
// Цвет, который color() вернул бы без изменений
const SETTLED_COLOR = /^#[0-9a-f]{6}$/;

// Виды полей. Первые пять читаются независимо от остальной записи.
const INT = 0; // зажим, потом округление
const COLOR = 1;
const TEXT = 2;
const FLAG = 3;
const PICK = 4; // значение возвращается как передано, если оно в списке
const SIMPLE_KINDS = 5;
const TEXT_AT = 6; // запасное лежит в контексте записи (зависит от места мазка)
const CURVE = 7; // флаг кривой: только у вольного мазка с числом точек 3n + 1

// Контекст мазка
const CTX_ID = 0;
const CTX_NAME = 1;
const CTX_KIND = 2;
const CTX_POINTS = 3;

// Простое поле по готовому значению. Для незаданного поля (undefined) результат не зависит
// от записи, поэтому он считается один раз при сборке таблицы. Короткие пути — для значений,
// которые помощники вернули бы как есть (число строго внутри границ, готовый цвет).
const convert = (row, raw) => {
  switch (row[2]) {
    case INT:
      return typeof raw === "number" && raw > row[4] && raw < row[5]
        ? Math.round(raw)
        : Math.round(clamp(raw, row[4], row[5], row[3]));
    case COLOR:
      return typeof raw === "string" && SETTLED_COLOR.test(raw) ? raw : color(raw, row[3]);
    case TEXT:
      return text(raw, row[3], row[4]);
    case FLAG:
      return flag(raw, row[3]);
    default:
      return choice(raw, row[4], row[3]);
  }
};

// Строка таблицы: [ключ, читатель поля, вид, запасное, предел 1, предел 2, значение незаданного поля].
// Порядок строк — порядок чтений входа и порядок ключей результата.
const field = (key, read, kind, fallback, first, second) => {
  const row = [key, read, kind, fallback, first, second, undefined];
  if (kind < SIMPLE_KINDS) row[6] = convert(row, undefined);
  return row;
};

const STROKE_ROWS = [
  field("id", (s) => s.id, TEXT_AT, CTX_ID, 64),
  field("group", (s) => s.group, TEXT, "", 40),
  field("name", (s) => s.name, TEXT_AT, CTX_NAME, WORLD_MAP_LIMITS.nameLength),
  field("color", (s) => s.color, COLOR, DEFAULT_BRUSH.color),
  field("size", (s) => s.size, INT, DEFAULT_BRUSH.size, 4, 4000),
  field("opacity", (s) => s.opacity, INT, DEFAULT_BRUSH.opacity, 0, 100),
  field("softness", (s) => s.softness, INT, DEFAULT_BRUSH.softness, 0, 100),
  field("blend", (s) => s.blend, PICK, "normal", BLENDS),
  field("target", (s) => s.target, PICK, "map", TARGETS),
  field("line", (s) => s.line, PICK, "solid", STROKE_LINES),
  field("arrow", (s) => s.arrow, PICK, "none", STROKE_ARROWS),
  field("curve", (s) => s.curve, CURVE),
  field("enabled", (s) => s.enabled, FLAG, true),
  field("locked", (s) => s.locked, FLAG, false),
];

const BRUSH_ROWS = [
  field("color", (s) => s.color, COLOR, DEFAULT_BRUSH.color),
  field("size", (s) => s.size, INT, DEFAULT_BRUSH.size, 4, 4000),
  field("opacity", (s) => s.opacity, INT, DEFAULT_BRUSH.opacity, 0, 100),
  field("softness", (s) => s.softness, INT, DEFAULT_BRUSH.softness, 0, 100),
  field("smoothing", (s) => s.smoothing, INT, DEFAULT_BRUSH.smoothing, 0, 100),
  field("blend", (s) => s.blend, PICK, DEFAULT_BRUSH.blend, BLENDS),
  field("target", (s) => s.target, PICK, DEFAULT_BRUSH.target, TARGETS),
  field("line", (s) => s.line, PICK, DEFAULT_BRUSH.line, STROKE_LINES),
  field("arrow", (s) => s.arrow, PICK, DEFAULT_BRUSH.arrow, BRUSH_ARROWS),
];

const readField = (row, source, context) => {
  const kind = row[2];
  if (kind === TEXT_AT) return text(row[1](source), context[row[3]], row[4]);
  if (kind === CURVE) {
    return context[CTX_KIND] === "free" && flag(row[1](source), false) && isCurvePoints(context[CTX_POINTS]);
  }
  const raw = row[1](source);
  return raw === undefined ? row[6] : convert(row, raw);
};

// Значения всех строк таблицы по порядку
const readRows = (rows, source, context) => {
  const values = new Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) values[i] = readField(rows[i], source, context);
  return values;
};

const asSource = (value) => (value && typeof value === "object" ? value : NO_FIELDS);

const coordinate = (n) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, n));

export const normalizeStrokePoints = (value) => {
  const kept = [];
  if (!Array.isArray(value)) return kept;
  const entries = value.slice(0, POINT_CAP);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry == null) continue;
    const x = number(entry.x, null);
    const y = number(entry.y, null);
    if (x === null || y === null) continue;
    kept.push({ x: coordinate(x), y: coordinate(y) });
  }
  return kept;
};

export const normalizeStrokeItem = (value, index) => {
  const source = value ?? NO_FIELDS;
  const points = normalizeStrokePoints(source.points);
  if (points.length < 2) return null;
  const kind = choice(source.kind, STROKE_KINDS, "free");
  const v = readRows(STROKE_ROWS, source, [`stroke-${index}`, `Мазок ${index + 1}`, kind, points]);
  return {
    id: v[0],
    group: v[1],
    name: v[2],
    color: v[3],
    size: v[4],
    opacity: v[5],
    softness: v[6],
    blend: v[7],
    target: v[8],
    line: v[9],
    arrow: v[10],
    kind,
    curve: v[11],
    enabled: v[12],
    locked: v[13],
    points,
  };
};

export const normalizeBrush = (value) => {
  const v = readRows(BRUSH_ROWS, asSource(value), NO_CONTEXT);
  return {
    color: v[0],
    size: v[1],
    opacity: v[2],
    softness: v[3],
    smoothing: v[4],
    blend: v[5],
    target: v[6],
    line: v[7],
    arrow: v[8],
  };
};

export const normalizePaint = (value) => {
  const source = asSource(value);
  const enabled = flag(source.enabled, PAINT_ENABLED);
  const brush = normalizeBrush(source.brush);
  const groupTitles = titleMap(source.groupTitles);
  const items = [];
  if (Array.isArray(source.items)) {
    const list = source.items.slice(0, STROKE_CAP);
    for (let i = 0; i < list.length; i += 1) {
      const stroke = normalizeStrokeItem(list[i], i);
      if (stroke !== null) items.push(stroke);
    }
  }
  return { enabled, brush, groupTitles, items };
};
