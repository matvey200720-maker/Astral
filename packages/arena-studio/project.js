// Проект арены: значения по умолчанию, нормализация любого входа, эмблемы и посадка модели.

import {
  arenaSurface,
  ARENA_SURFACES,
  DEFAULT_SURFACE_ID,
  STAND_ROWS,
  STAND_SECTORS,
  STAR_RADIUS,
} from "./layout.js";

export const ARENA_SCHEMA_VERSION = 1;

const LIMIT = { decals: 48, name: 80, decalId: 40, hallSource: 400, pieceKey: 80 };
const PROJECT_NAME = "Моя арена";
const TOO_MANY = "Больше 48 эмблем арена не несёт";
const NOT_A_PROJECT = "Это не проект арены";
const TOO_NEW = "Проект сделан в более новой версии Astral — обнови приложение";

const frozen = Object.freeze;
const idsOf = (list) => list.map(({ id }) => id);

export const CHAIR_MODES = frozen(["stock", "preset", "custom", "hidden"]);
export const STAR_MODES = frozen(["stock", "shape", "texture", "model", "hidden"]);
export const HALL_VENUES = frozen(["astral", "stadium", "bowl", "garage", "folder"]);

const makePreset = (id, ru, en, back, seatHeight, width, depth, legs) =>
  frozen({ id, labels: { ru, en }, back, seatHeight, width, depth, legs });

export const CHAIR_PRESETS = frozen([
  makePreset("stadium", "Стадионное", "Stadium seat", 0.52, 0.44, 0.5, 0.54, "shell"),
  makePreset("bench", "Скамья", "Bench", 0, 0.42, 0.62, 0.44, "block"),
  makePreset("stool", "Табурет", "Stool", 0, 0.62, 0.36, 0.36, "pole"),
  makePreset("throne", "Кресло VIP", "VIP chair", 0.78, 0.46, 0.62, 0.62, "block"),
]);

const PRESET_IDS = idsOf(CHAIR_PRESETS);
export const CHAIR_PRESET_IDS = [...PRESET_IDS];

const blendMode = (id, ru, en) => ({ id, labels: { ru, en } });

export const BLEND_MODES = frozen([
  blendMode("normal", "Обычный", "Normal"),
  blendMode("multiply", "Умножение", "Multiply"),
  blendMode("screen", "Экран", "Screen"),
  blendMode("additive", "Свечение", "Additive"),
]);
const BLEND_IDS = idsOf(BLEND_MODES);

const makeBookmark = (id, ru, en, position, target, fov, showcase = false) =>
  frozen({
    id,
    labels: { ru, en },
    ...(showcase ? { showcase: true } : {}),
    position,
    target,
    fov,
  });

export const CAMERA_BOOKMARKS = frozen([
  makeBookmark("corner", "У борта", "At the boards corner", [8.6, 1.7, 8.6], [-9, 1.5, -4], 60, true),
  makeBookmark("rows", "Между рядами", "Between the rows", [2.7, 4.7, 15.6], [14.9, 3.4, -1.3], 56, true),
  makeBookmark("front", "Амфитеатр", "The amphitheatre", [0, 1.7, 10.8], [0, 4.2, -19.4], 55, true),
  makeBookmark("ring", "На арене", "On the floor", [0, 1.75, 9.4], [0, 1.2, 0], 62, true),
  makeBookmark("overview", "Обзор", "Overview", [0, 9.2, 17.2], [0, 0.6, -1.5], 54),
  makeBookmark("stands", "С трибуны", "From the stands", [12.5, 6.2, 12.5], [0, 0.6, 0], 52),
  makeBookmark("top", "Сверху", "Top down", [0, 34, 0.01], [0, 0, 0], 44),
  makeBookmark("board", "К щитам", "At the boards", [0, 3.4, 6], [0, 2.2, 13], 55),
]);

export const SHOWCASE_BOOKMARKS = frozen(CAMERA_BOOKMARKS.filter(({ showcase }) => showcase));
const BOOKMARK_IDS = idsOf(CAMERA_BOOKMARKS);

export function cameraBookmark(id) {
  return CAMERA_BOOKMARKS[BOOKMARK_IDS.indexOf(id)] ?? CAMERA_BOOKMARKS[0];
}

// Замороженная таблица значений: имена ключей одной строкой, значения списком в том же порядке.
const defaults = (names, values) =>
  frozen(Object.fromEntries(names.split(" ").map((name, at) => [name, values[at]])));

export const CHAIR_DEFAULTS = defaults("mode preset rows hiddenSectors frame seat model", [
  "stock",
  "stadium",
  4,
  frozen([]),
  "#20242e",
  "#b3202f",
  null,
]);

export const STAR_DEFAULTS = defaults("mode points innerRatio radius rotation colour rim glow texture model", [
  "stock",
  5,
  0.42,
  STAR_RADIUS,
  0,
  "#e8c66a",
  "#141821",
  32,
  null,
  null,
]);

export const GRADING_DEFAULTS = defaults(
  "floor walls lowerWalls ceiling stands accent exposure contrast saturation temperature tint lightColour lightIntensity ambient haze",
  [
    "#3a3f4a",
    "#2a2f3c",
    "#2a2f3c",
    "#20242f",
    "#2c313d",
    "#e8c66a",
    100,
    100,
    100,
    0,
    0,
    "#ffffff",
    100,
    42,
    18,
  ],
);

export const CAMERA_DEFAULTS = defaults("mode bookmark speed hour", ["orbit", "corner", 8, 12]);

export const HALL_DEFAULTS = defaults("venue source pieces", ["astral", null, frozen({})]);

// Счётчик номеров эмблем — единственное состояние модуля; значение не проверяется.
let sequence = 0;

const nextDecalId = () => {
  sequence += 1;
  return `decal-${sequence.toString(36)}`;
};

export function resetArenaSequence(value = 0) {
  sequence = value;
}

const scaleFor = (places) => Number(`1e${places}`);

// Число в отрезок: не конечное даёт нижнюю границу, знак нуля сохраняется.
const clampTo = (value, lo, hi) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
};

const roundTo = (value, places) =>
  places === null ? value : Math.round(value * scaleFor(places)) / scaleFor(places);

const ranged = (value, lo, hi, places = 0) => roundTo(clampTo(value, lo, hi), places);

const text = (value, limit = LIMIT.name) => String(value ?? "").substring(0, limit);

const isHexColour = (word) =>
  word.length === 7 &&
  word.startsWith("#") &&
  [...word.slice(1)].every((digit) => !Number.isNaN(parseInt(digit, 16)));

const colour = (value, fallback) => {
  const word = String(value || "");
  return isHexColour(word) ? word.toLowerCase() : fallback;
};

const oneOf = (value, list, fallback) => {
  const word = String(value);
  return list.includes(word) ? word : fallback;
};

const copyOrNull = (value) => (value ? { ...value } : null);

const pictureOf = (entry, label) =>
  entry?.source ? { name: text(entry.name || label), source: String(entry.source) } : null;

// Обходчик схем: ключ → читатель(значение, запасное из таблицы по умолчанию, весь вход).
const walk = (schema, input = {}, fallbacks = {}) =>
  Object.fromEntries(
    Object.entries(schema).map(([key, read]) => [key, read(input[key], fallbacks[key], input)]),
  );

const plain = (value) => text(value);
const exact = (lo, hi, places) => (value) => ranged(value, lo, hi, places);
const bounded = (lo, hi, places) => (value, fallback) => ranged(value ?? fallback, lo, hi, places);
const choice = (list) => (value, fallback) => oneOf(value, list, fallback);
const hex = (value, fallback) => colour(value, fallback);
const placement = (slot) => (value) => (value ? createModelPlacement({ ...value, slot }) : null);
const section = (schema, fallbacks) => (value) => walk(schema, value, fallbacks);

const DECAL_SCHEMA = {
  name: plain,
  surface: (value) => (arenaSurface(value) ? String(value) : DEFAULT_SURFACE_ID),
  u: exact(0, 1, 4),
  v: exact(0, 1, 4),
  width: exact(0.1, 30, 3),
  aspect: exact(0.05, 20, 4),
  rotation: exact(-180, 180, 2),
  opacity: exact(0, 100, 0),
  blend: (value) => oneOf(value, BLEND_IDS, "normal"),
  tint: (value) => colour(value, "#ffffff"),
  source: (value) => value || null,
};

const PLACEMENT_SCHEMA = {
  name: plain,
  slot: (value) => String(value),
  scale: exact(0.001, 1000, 5),
  offset: (value) => [0, 1, 2].map((at) => ranged(value?.[at] ?? 0, -50, 50, 4)),
  rotationX: exact(-180, 180, 2),
  rotationY: exact(-180, 180, 2),
  lift: exact(-1, 3, 3),
  size: copyOrNull,
  fitted: copyOrNull,
  triangles: (value) => Math.max(0, Math.round(Number(value) || 0)),
  url: (value) => value || null,
};

export function createDecal({
  name = "Эмблема",
  surface = DEFAULT_SURFACE_ID,
  u = 0.5,
  v = 0.5,
  width = 2.4,
  aspect = 1,
  rotation = 0,
  opacity = 100,
  blend = "normal",
  tint = "#ffffff",
  source = null,
} = {}) {
  const id = nextDecalId();
  const fields = walk(DECAL_SCHEMA, { name, surface, u, v, width, aspect, rotation, opacity, blend, tint, source });
  return { id, ...fields, visible: true, locked: false };
}

export function createModelPlacement({
  name = "Своя модель",
  slot = "chair",
  scale = 1,
  offset = [0, 0, 0],
  rotationX = 0,
  rotationY = 0,
  lift = 0,
  size = null,
  fitted = null,
  triangles = 0,
  url = null,
} = {}) {
  return walk(PLACEMENT_SCHEMA, { name, slot, scale, offset, rotationX, rotationY, lift, size, fitted, triangles, url });
}

// Эмблема заново из источника: номер счётчика тратит createDecal, идентификатор выбирается после него.
const settled = (source, pickId) => {
  const base = createDecal(source);
  return { ...base, id: pickId(), visible: source?.visible !== false, locked: Boolean(source?.locked) };
};

// Находит эмблему по строгому id и отдаёт действию список и позицию; без совпадения — notFound.
const withDecal = (project, id, notFound, act) => {
  const list = project.decals;
  const at = list.findIndex((item) => item.id === id);
  return at < 0 ? notFound : act(list, at);
};

export function addDecal(project, decal) {
  if (project.decals.length >= LIMIT.decals) throw new Error(TOO_MANY);
  project.decals.push(decal);
  return decal;
}

export const updateDecal = (project, id, patch) =>
  withDecal(project, id, null, (list, at) => {
    const merged = { ...list[at], ...patch };
    list[at] = settled(merged, () => merged.id);
    return list[at];
  });

export const removeDecal = (project, id) =>
  withDecal(project, id, false, (list, at) => {
    list.splice(at, 1);
    return true;
  });

export const moveDecal = (project, id, direction) =>
  withDecal(project, id, false, (list, at) => {
    const to = at + (direction === "up" ? 1 : -1);
    if (to < 0 || to >= list.length) return false;
    [list[at], list[to]] = [list[to], list[at]];
    return true;
  });

const SECTOR_IDS = Array.from({ length: STAND_SECTORS }, (_, at) => at);

const sectorList = (value) => {
  if (!Array.isArray(value)) return [];
  const picked = value.map((item) => Math.round(Number(item)));
  return SECTOR_IDS.filter((sector) => picked.includes(sector));
};

const CHAIR_SCHEMA = {
  mode: choice(CHAIR_MODES),
  preset: choice(PRESET_IDS),
  rows: bounded(0, STAND_ROWS, 0),
  hiddenSectors: sectorList,
  frame: hex,
  seat: hex,
  model: placement("chair"),
};

const STAR_SCHEMA = {
  mode: choice(STAR_MODES),
  points: bounded(3, 12, 0),
  innerRatio: bounded(0.1, 0.9, 3),
  radius: bounded(0.5, 11, 3),
  rotation: bounded(-180, 180, 2),
  colour: hex,
  rim: hex,
  glow: bounded(0, 100, 0),
  texture: (value) => pictureOf(value, "Текстура"),
  model: placement("star"),
};

const GRADING_SCHEMA = {
  floor: hex,
  walls: hex,
  lowerWalls: (value, fallback, raw) => colour(value, colour(raw.walls, fallback)),
  ceiling: hex,
  stands: hex,
  accent: hex,
  exposure: bounded(40, 180, 0),
  contrast: bounded(40, 180, 0),
  saturation: bounded(0, 200, 0),
  temperature: bounded(-100, 100, 0),
  tint: bounded(-100, 100, 0),
  lightColour: hex,
  lightIntensity: bounded(0, 200, 0),
  ambient: bounded(0, 100, 0),
  haze: bounded(0, 100, 0),
};

const CAMERA_SCHEMA = {
  mode: choice(["orbit", "fly"]),
  bookmark: choice(BOOKMARK_IDS),
  speed: bounded(1, 40, 0),
  hour: bounded(0, 24, null),
};

const PIECE_CHARS = new Set([..."abcdefghijklmnopqrstuvwxyz0123456789_+-"]);

const isPieceKey = (key) =>
  key.length > 0 && key.length <= LIMIT.pieceKey && [...key].every((ch) => PIECE_CHARS.has(ch));

// Правка детали зала; null, если ни одно из пяти полей не сработало.
function pieceEdit(key, edit) {
  const hidden = Boolean(edit?.hidden);
  const tint = colour(edit?.tint, null);
  const model = placement(`hall:${key}`)(edit?.model);
  const texture = pictureOf(edit?.texture, "Картинка");
  const solid = Boolean(edit?.solid);
  return hidden || tint || model || texture || solid ? { hidden, tint, model, texture, solid } : null;
}

// Присваивание по ключу обычное, намеренно: ключ __proto__ меняет прототип, а не становится ключом.
const readPieces = (value) => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((pieces, [rawKey, edit]) => {
    const key = rawKey.toLowerCase();
    const entry = isPieceKey(key) ? pieceEdit(key, edit) : null;
    if (entry) pieces[key] = entry;
    return pieces;
  }, {});
};

const HALL_SCHEMA = {
  venue: choice(HALL_VENUES),
  source: (value) => (value ? text(value, LIMIT.hallSource) : null),
  pieces: readPieces,
};

const readDecals = (list) =>
  Array.isArray(list)
    ? Array.from(list.slice(0, LIMIT.decals), (item) =>
        settled(item, () => String(item?.id || "").substring(0, LIMIT.decalId) || nextDecalId()),
      )
    : [];

const PROJECT_SCHEMA = {
  schema: () => ARENA_SCHEMA_VERSION,
  name: (value) => text(value || PROJECT_NAME),
  chairs: section(CHAIR_SCHEMA, CHAIR_DEFAULTS),
  star: section(STAR_SCHEMA, STAR_DEFAULTS),
  grading: section(GRADING_SCHEMA, GRADING_DEFAULTS),
  decals: readDecals,
  camera: section(CAMERA_SCHEMA, CAMERA_DEFAULTS),
  hall: (value) => walk(HALL_SCHEMA, value ?? {}, HALL_DEFAULTS),
};

export function normalizeArenaProject(raw = {}) {
  return walk(PROJECT_SCHEMA, raw);
}

// Новый проект — это нормализованный пустой вход с одним лишь именем.
export const createArenaProject = (patch = {}) => normalizeArenaProject({ name: patch.name });

export const serializeArenaProject = (project) => JSON.stringify(normalizeArenaProject(project), null, 2);

const looksLikeProject = (data) => Boolean(data) && typeof data === "object";
const madeLater = (data) => Boolean(data.schema) && Number(data.schema) > ARENA_SCHEMA_VERSION;

export function parseArenaProject(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const refusal = !looksLikeProject(data) ? NOT_A_PROJECT : madeLater(data) ? TOO_NEW : null;
  if (refusal) throw new Error(refusal);
  return normalizeArenaProject(data);
}

const differs = (part, base, keys) => keys.some((key) => part[key] !== base[key]);

// Что в проекте изменено: три раздела — флагами, остальное — числами.
const CHANGE_TESTS = {
  chairs: ({ chairs }) =>
    differs(chairs, CHAIR_DEFAULTS, ["mode", "rows", "frame", "seat"]) || chairs.hiddenSectors.length > 0,
  star: ({ star }) =>
    differs(star, STAR_DEFAULTS, ["mode", "points", "innerRatio", "radius", "rotation", "colour", "rim", "glow"]) ||
    Boolean(star.texture) ||
    Boolean(star.model),
  grading: ({ grading }) => differs(grading, GRADING_DEFAULTS, Object.keys(GRADING_DEFAULTS)),
};

export function arenaProjectStats(project) {
  const normal = normalizeArenaProject(project);
  const flags = Object.fromEntries(Object.entries(CHANGE_TESTS).map(([key, test]) => [key, test(normal)]));
  const counts = { decals: normal.decals.length, hall: Object.keys(normal.hall.pieces).length };
  const surfaces = new Set(normal.decals.map(({ surface }) => surface)).size;
  const flagged = Object.values(flags).filter(Boolean).length;
  return { ...flags, ...counts, surfaces, changes: flagged + counts.decals + counts.hall };
}

export const projectIsEmpty = (project) => arenaProjectStats(project).changes === 0;

export function surfaceUsage(project) {
  const tally = new Map();
  for (const { surface } of normalizeArenaProject(project).decals) {
    tally.set(surface, (tally.get(surface) ?? 0) + 1);
  }
  return ARENA_SURFACES.map(({ id, labels, panels }) => ({ id, labels, panels, count: tally.get(id) ?? 0 }));
}
