import { choice, clamp, color, flag, text, WORLD_MAP_SCHEMA_VERSION as SCHEMA_VERSION } from "./values.js";
import { SERVER_PROFILE_IDS as SERVERS } from "./defaults.js";
import { TEMPLATE_IDS } from "./templates.js";
import * as baseKit from "./normalize-base.js";
import * as zoneKit from "./normalize-zones.js";
import * as markerKit from "./normalize-markers.js";
import * as drawKit from "./normalize-draw.js";
import * as emblemKit from "./normalize-emblems.js";
import * as gameKit from "./normalize-game.js";
import * as blipKit from "../blip-icons.js";
import * as zoomKit from "../mapzoom.js";
import { MAJESTIC_CATALOG as CATALOG, MAJESTIC_DEFAULTS, MAJESTIC_LIMITS } from "../majestic-catalog.js";

// Поколение системы подписей: сборка пишет его в проект, а не читает из источника.
export const LABEL_SYSTEM = 2;

// Пустой «источник» только для чтения: свежий {} на каждый вызов не нужен.
const NOTHING = Object.freeze({});
const isRecord = (value) => typeof value === "object" && value !== null;
const recordAt = (holder, key) => (holder[key] && typeof holder[key] === "object" ? holder[key] : NOTHING);

// Память по ссылке: раздел-объект → (нормализатор → результат).
export const sectionMemo = new WeakMap();
// Всё, что уже вышло из какого-либо нормализатора раздела, повторно не проверяется.
export const sectionOutputs = new WeakSet();

export const memoSection = (input, normalize) => {
  if (!isRecord(input)) return normalize(input);
  if (sectionOutputs.has(input)) return input;
  const known = sectionMemo.get(input);
  if (known !== undefined) {
    // результат может быть и undefined: тогда решает has
    const cached = known.get(normalize);
    if (cached !== undefined || known.has(normalize)) return cached;
  }
  const result = normalize(input);
  if (isRecord(result)) sectionOutputs.add(result);
  if (known === undefined) sectionMemo.set(input, new Map().set(normalize, result));
  else known.set(normalize, result);
  return result;
};

// Состояние шаблона разметки

const NAME_LENGTH = 40;
const NAMES_PER_LIST = 64;
const LOOK_ENTRIES = 32;
const LOOK_KEY_LENGTH = 32;
const SIDES = ["zones", "markers"];

// Что из значений вида остаётся: конечные числа, булевы и строки.
const LOOK_ACCEPTS = { number: Number.isFinite, boolean: () => true, string: () => true };

export const markupLookValue = (value) => {
  const accepts = LOOK_ACCEPTS[typeof value];
  if (!accepts || !accepts(value)) return undefined;
  return typeof value === "string" ? value.slice(0, NAME_LENGTH) : value;
};

const toName = (item) => text(item, "", NAME_LENGTH);

const nameList = (list) => {
  if (!Array.isArray(list)) return [];
  const names = list.map(toName);
  return names.filter((name) => name !== "").slice(0, NAMES_PER_LIST);
};

const nameGroup = (source) => {
  const group = {};
  for (const side of SIDES) group[side] = nameList(source?.[side]);
  return group;
};

const lookView = (source) => {
  if (!isRecord(source)) return {};
  const view = {};
  for (const [key, raw] of Object.entries(source).slice(0, LOOK_ENTRIES)) {
    const kept = markupLookValue(raw);
    if (kept !== undefined) view[key.slice(0, LOOK_KEY_LENGTH)] = kept;
  }
  return view;
};

export const normalizeMarkupState = (value) => {
  if (!isRecord(value)) return null;
  const state = {};
  for (const key of ["placed", "shown"]) state[key] = nameGroup(value[key]);
  state.look = {};
  for (const side of SIDES) state.look[side] = lookView(value.look?.[side]);
  return state;
};

// Majestic

const MARKS_LIMIT = 4000;
const CATEGORY_IDS = new Set(Array.from(CATALOG, (entry) => entry.id));

// «категория:p12» (точка) или «категория:z3» (зона): имя из 3–16 латинских букв, номер из 1–5 цифр.
export const MAJESTIC_MARK_KEY = new RegExp(["^([A-Za-z]{3,16})", ":", "[pz]", "\\d{1,5}$"].join(""));

const snapFive = (number) => Math.round(number / 5) * 5;

// Число в границах из MAJESTIC_LIMITS по имени поля.
const limited = (value, key, fallback) => {
  const range = MAJESTIC_LIMITS[key];
  return clamp(value, range[0], range[1], fallback);
};

// Цвет поля: пустое значение даёт пусто, чтение поля — дважды, если оно истинно.
const toneReader = (key) => (holder) => (holder[key] ? color(holder[key], "") : "");

const readOn = (item) => flag(item.on, false);
const readColor = toneReader("color");
const readFill = (item) => snapFive(limited(item.fill, "fill", 100));
const readLine = (item) => snapFive(limited(item.line, "line", 100));
const readIcon = (item) => snapFive(limited(item.icon, "icon", 100));
const readInk = toneReader("ink");

// Поля читаются в порядке ключей результата: on, color, fill, line, icon, ink.
const categoryOf = (item) => ({
  on: readOn(item),
  color: readColor(item),
  fill: readFill(item),
  line: readLine(item),
  icon: readIcon(item),
  ink: readInk(item),
});

// Запись метки или null, если метка ничего не меняет.
const markEntry = (mark) => {
  const hidden = mark?.hidden === true;
  const raw = mark?.color;
  const tone = raw ? color(mark.color, "") : "";
  if (hidden) return tone ? { hidden, color: tone } : { hidden };
  return tone ? { color: tone } : null;
};

export const normalizeMajesticMarks = (value) => {
  const marks = {};
  if (!isRecord(value) || Array.isArray(value)) return marks;
  const all = Object.entries(value);
  const pairs = all.length > MARKS_LIMIT ? all.slice(0, MARKS_LIMIT) : all;
  for (const [key, mark] of pairs) {
    if (!CATEGORY_IDS.has(MAJESTIC_MARK_KEY.exec(key)?.[1])) continue;
    const entry = markEntry(mark);
    if (entry) marks[key] = entry;
  }
  return marks;
};

export const normalizeMajestic = (value) => {
  const source = isRecord(value) ? value : NOTHING;
  const own = recordAt(source, "categories");
  const size = Math.round(limited(source.size, "size", MAJESTIC_DEFAULTS.size));
  const fill = snapFive(limited(source.fill, "fill", MAJESTIC_DEFAULTS.fill));
  const majestic = { size, fill, marks: normalizeMajesticMarks(source.marks), categories: {} };
  for (const entry of CATALOG) majestic.categories[entry.id] = categoryOf(recordAt(own, entry.id));
  return majestic;
};

// Сборка разделов проекта

// Нормализаторы по ключам проекта; функции берутся один раз, их ссылки — ключи памяти.
const NORMALIZE = {
  markupState: normalizeMarkupState,
  base: baseKit.normalizeBase,
  zones: zoneKit.normalizeZones,
  markers: markerKit.normalizeMarkers,
  paint: drawKit.normalizePaint,
  emblems: emblemKit.normalizeEmblems,
  export: gameKit.normalizeExport,
  zoom: zoomKit.normalizeMapZoom,
  pauseMap: gameKit.normalizePauseMap,
  radar: gameKit.normalizeRadar,
  majestic: normalizeMajestic,
  blipIcons: blipKit.normalizeBlipIcons,
};

// Шаблон проекта: любой из шаблонов вида или «custom».
const templateOf = (value) => (value === "custom" ? value : choice(value, TEMPLATE_IDS, "black"));

// Поля источника читаются по одному разу и в порядке ключей проекта, каждое прямо перед своей
// нормализацией: исключение обрывает сборку, и дальше поля остаются нетронутыми.
export const normalizeSections = (source) => {
  const template = templateOf(source.template);
  const server = choice(source.server, SERVERS, "custom");
  const markup = text(source.markup, "", NAME_LENGTH);
  const markupState = memoSection(source.markupState, NORMALIZE.markupState);
  const base = memoSection(source.base, NORMALIZE.base);
  const zones = memoSection(source.zones, NORMALIZE.zones);
  const markers = memoSection(source.markers, NORMALIZE.markers);
  const paint = memoSection(source.paint, NORMALIZE.paint);
  const emblems = memoSection(source.emblems, NORMALIZE.emblems);
  const exported = memoSection(source.export, NORMALIZE.export);
  const zoom = memoSection(source.zoom, NORMALIZE.zoom);
  const pauseMap = memoSection(source.pauseMap, NORMALIZE.pauseMap);
  const radar = memoSection(source.radar, NORMALIZE.radar);
  const majestic = memoSection(source.majestic, NORMALIZE.majestic);
  const blipIcons = memoSection(source.blipIcons, NORMALIZE.blipIcons);
  return {
    schemaVersion: SCHEMA_VERSION,
    labelSystem: LABEL_SYSTEM,
    template,
    server,
    markup,
    markupState,
    base,
    zones,
    markers,
    paint,
    emblems,
    export: exported,
    zoom,
    pauseMap,
    radar,
    majestic,
    blipIcons,
  };
};
