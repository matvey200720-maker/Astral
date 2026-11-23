import {
  BLEND_MODES,
  WORLD_MAP_LIMITS,
  choice,
  clamp,
  color,
  decimal,
  flag,
  multiline,
  number,
  text,
} from "./values.js";
import { EMBLEM_FONTS, titleMap } from "./defaults.js";
import { DEFAULT_MAP_FONT, mapEmblemFont } from "../map-fonts.js";
import { normalizeScheduleBoard, scheduleBoardLayout } from "../schedule-board.js";

const COORD_LIMIT = 20000;
const EMBLEM_CAP = WORLD_MAP_LIMITS.emblems;
const NAME_CAP = WORLD_MAP_LIMITS.nameLength;
const KINDS = ["image", "text"];
const FITS = ["contain", "cover"];
const WEIGHTS = ["regular", "bold", "black"];
const BLENDS = ["normal", ...BLEND_MODES];
const WHITE = "#ffffff";
const NO_FIELDS = Object.freeze({});
// Цвет, который color() вернул бы без изменений
const SETTLED_COLOR = /^#[0-9a-f]{6}$/;

// Виды полей. Первые пять читаются независимо от остальной записи.
const INT = 0; // зажим, потом округление
const COLOR = 1;
const TEXT = 2;
const FLAG = 3;
const PICK = 4; // значение возвращается как передано, если оно в списке
const SIMPLE_KINDS = 5;
const TEXT_AT = 6; // запасное лежит в контексте записи (зависит от места надписи)
const BOARDLESS_TEXT = 7; // читается, только если табло нет и сырое значение истинно
const OWN_FONT_TEXT = 8; // читается, только если шрифт строго custom и сырое значение истинно
const CAPTION = 9; // подпись: только у вида text
const ASPECT = 10; // у табло — из его раскладки
const FONT = 11;

// Контекст надписи
const CTX_ID = 0;
const CTX_KIND = 1;
const CTX_BOARD = 2;

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

// Вид, положение (x, y) и табло читаются раньше таблицы и вставляются в результат отдельно
const EMBLEM_ROWS = [
  field("id", (s) => s.id, TEXT_AT, CTX_ID, 64),
  field("group", (s) => s.group, TEXT, "", 40),
  field("assetId", (s) => s.assetId, BOARDLESS_TEXT, "", 128),
  field("text", (s) => s.text, CAPTION, "UZI"),
  field("width", (s) => s.width, INT, 1400, 60, 12000),
  field("aspect", (s) => s.aspect, ASPECT, 1, 0.2, 5),
  field("fit", (s) => s.fit, PICK, "contain", FITS),
  field("radius", (s) => s.radius, INT, 0, 0, 50),
  field("frame", (s) => s.frame, INT, 0, 0, 20),
  field("frameColor", (s) => s.frameColor, COLOR, WHITE),
  field("rotation", (s) => s.rotation, INT, 0, -180, 180),
  field("opacity", (s) => s.opacity, INT, 100, 0, 100),
  field("blend", (s) => s.blend, PICK, "normal", BLENDS),
  field("flip", (s) => s.flip, FLAG, false),
  field("color", (s) => s.color, COLOR, WHITE),
  field("font", (s) => s.font, FONT),
  field("fontAssetId", (s) => s.fontAssetId, OWN_FONT_TEXT, "", 128),
  field("fontName", (s) => s.fontName, OWN_FONT_TEXT, "", NAME_CAP),
  field("weight", (s) => s.weight, PICK, "black", WEIGHTS),
  field("letterSpacing", (s) => s.letterSpacing, INT, 0, -20, 60),
  field("outline", (s) => s.outline, INT, 0, 0, 100),
  field("outlineColor", (s) => s.outlineColor, COLOR, "#04060a"),
  field("glow", (s) => s.glow, INT, 0, 0, 100),
  field("glowColor", (s) => s.glowColor, COLOR, WHITE),
  field("enabled", (s) => s.enabled, FLAG, true),
  field("locked", (s) => s.locked, FLAG, false),
];

const readField = (row, source, context) => {
  switch (row[2]) {
    case TEXT_AT:
      return text(row[1](source), context[row[3]], row[4]);
    case BOARDLESS_TEXT:
      return context[CTX_BOARD] === null && row[1](source) ? text(row[1](source), "", row[4]) : "";
    case OWN_FONT_TEXT:
      return source.font === "custom" && row[1](source) ? text(row[1](source), "", row[4]) : "";
    case CAPTION:
      return context[CTX_KIND] === "text" ? multiline(row[1](source), row[3]) : "";
    case ASPECT:
      return context[CTX_BOARD] === null
        ? decimal(row[1](source), row[4], row[5], row[3])
        : scheduleBoardLayout(context[CTX_BOARD]).aspect;
    case FONT:
      return choice(mapEmblemFont(row[1](source)), EMBLEM_FONTS, DEFAULT_MAP_FONT);
    default: {
      const raw = row[1](source);
      return raw === undefined ? row[6] : convert(row, raw);
    }
  }
};

const coordinate = (n) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, n));

export const normalizeEmblemItem = (value, index) => {
  const source = value ?? NO_FIELDS;
  const kind = choice(source.kind, KINDS, "text");
  const x = number(source.x, null);
  const y = number(source.y, null);
  if (x === null || y === null) return null;
  const board = kind === "image" && source.schedule ? normalizeScheduleBoard(source.schedule) : null;
  const context = [`emblem-${index}`, kind, board];
  const v = new Array(EMBLEM_ROWS.length);
  for (let i = 0; i < EMBLEM_ROWS.length; i += 1) v[i] = readField(EMBLEM_ROWS[i], source, context);
  return {
    id: v[0],
    group: v[1],
    kind,
    assetId: v[2],
    schedule: board,
    text: v[3],
    x: coordinate(x),
    y: coordinate(y),
    width: v[4],
    aspect: v[5],
    fit: v[6],
    radius: v[7],
    frame: v[8],
    frameColor: v[9],
    rotation: v[10],
    opacity: v[11],
    blend: v[12],
    flip: v[13],
    color: v[14],
    font: v[15],
    fontAssetId: v[16],
    fontName: v[17],
    weight: v[18],
    letterSpacing: v[19],
    outline: v[20],
    outlineColor: v[21],
    glow: v[22],
    glowColor: v[23],
    enabled: v[24],
    locked: v[25],
  };
};

export const normalizeEmblems = (value) => {
  const source = value && typeof value === "object" ? value : NO_FIELDS;
  const groupTitles = titleMap(source.groupTitles);
  const items = [];
  if (Array.isArray(source.items)) {
    const list = source.items.slice(0, EMBLEM_CAP);
    for (let i = 0; i < list.length; i += 1) {
      const emblem = normalizeEmblemItem(list[i], i);
      if (emblem !== null) items.push(emblem);
    }
  }
  return { groupTitles, items };
};
