// Значки, точки и зоны с карт паков сообщества: пути значков и наборы для каталога.
import PACK_DATA from "./pack-overlays.json" with { type: "json" };
import { shapePoints } from "./shapes.js";
import { glyphPath } from "./glyphs.js";

const METERS_PER_SCENE_UNIT = 9;
const ZONE_NAME_LIMIT = 48;
const FALLBACK_STROKE_METERS = 15;
const FALLBACK_FILL_OPACITY = 100;
const NUMBERED_MARK = "[номер";
const PACK_PREFIX = "pack-";
const HINT_GLUE = " · ";
const LABEL_STYLE = { font: "golos", weight: "black" };
const LABELLED_GLYPHS = new Set(["dot", "spray"]);
const VIEW_BY_SET = new Map([["mcl-territories", "city"]]);

// Правки наборов по id: поверх набора ложатся поля patch; rename меняет начало названия зоны,
// dropWord отбрасывает зоны, в названии которых есть слово.
const EDITS = new Map(Object.entries({
  "mcl-territories": {
    patch: {
      title: "Территории МЦЛ",
    },
  },
  "redux-sites": {
    patch: {
      title: "Арены ВЗХ, Стройки и Контов",
      hint: "Три арены мероприятий GTA 5 RP: ВЗХ у ТЭЦ, Стройка в пустыне, Конты в порту — рамка и граница, с карты COMPETITIVE V2 REDUX",
    },
    rename: ["БИЗВАР · стройка в пустыне", "СТРОЙКА · пустыня"],
  },
  "redux-events": {
    patch: {
      title: "Зоны ВЗП",
      hint: "Карты войны семей GTA 5 RP: Мусорка, Байкерка, Нефть и Центр в Миррор-Парке (бывает реже) — с карты COMPETITIVE V2 REDUX",
    },
    dropWord: "ангар",
  },
  "redux-site-points": {
    patch: {
      title: "Спавны на аренах",
      hint: "По девять точек на аренах ВЗХ, Стройки и Контов — по словам автора Redux, спавны хаммеров",
      category: "events",
    },
  },
}));

// Существительное для имени точки без номера, по глифу набора
const NOUNS = new Map(Object.entries({
  truck: "Грузовик",
  "truck-box": "Грузовик",
  jeep: "Джип",
  "case-x": "Чемодан",
  spray: "Баллончик",
  dot: "Точка",
}));

// Полка каталога зон по категории набора
const ZONE_SHELF = new Map(Object.entries({
  "crime-majestic": "mcl",
  "crime-gta5rp": "gta5rp",
  events: "events",
}));

// --- общие помощники ---

const roundTo = (digits) => (value) => Math.round(Number(value) * 10 ** digits) / 10 ** digits;
const tenths = roundTo(1);

// Запись из значений нужных полей, прогнанных через fn
const mapFields = (record, keys, fn) => Object.fromEntries(keys.map((key) => [key, fn(record[key])]));

const whenSet = (value, fn) => (value == null ? null : fn(value));

// Схема записи: [ключ, как получить значение, когда ключ нужен]; обходчик собирает объект по порядку схемы.
const assemble = (schema, ctx) =>
  Object.fromEntries(
    schema.filter(([, , needed]) => !needed || needed(ctx)).map(([key, read]) => [key, read(ctx)]),
  );

const copyFields = (...keys) => keys.map((key) => [key, ({ set }) => set[key]]);

// Начало записи точки и зоны: идентификатор по номеру и группа
const ENTITY_HEAD = [
  ["id", ({ set, n }) => `${set.id}-${n}`],
  ["group", ({ set }) => set.id],
];

// Начало карточки набора
const SET_HEAD = [...copyFields("id", "title", "hint", "source"), ["server", ({ set }) => set.server || "any"]];

// Правка набора по id: сам набор с наложенными полями и описание правки
const applyEdit = (source) => {
  const edit = EDITS.get(source.id);
  return { set: edit ? { ...source, ...edit.patch } : source, edit };
};

// --- значки ---

const withPackPrefix = (glyphs) => {
  const table = glyphs || {};
  return Object.freeze(Object.fromEntries(Object.keys(table).map((name) => [PACK_PREFIX + name, table[name]])));
};

export const PACK_GLYPHS = withPackPrefix(PACK_DATA.glyphs);
export const PACK_GLYPH_HALOS = withPackPrefix(PACK_DATA.glyphHalos);

const fromTable = (table) => (name) => table[name];
const GLYPH_SOURCES = [glyphPath, fromTable(PACK_GLYPHS)];
const haloOf = fromTable(PACK_GLYPH_HALOS);

export const markerGlyph = (name) => {
  for (const lookup of GLYPH_SOURCES) {
    const path = lookup(name);
    if (path) return path;
  }
  return null;
};

export const markerGlyphHalo = (name) => haloOf(name) || null;

// --- наборы точек ---

// Места значений в строке данных
const NUMBERED_COLUMNS = ["name", "x", "y", "size", "dx", "dy", "textHeight"];
const PLAIN_COLUMNS = ["x", "y", "size"];

const POINT_FIELDS = [
  ...ENTITY_HEAD,
  ["category", ({ isDot, glyph }) => (isDot ? "point" : `${PACK_PREFIX}${glyph}`)],
  ["name", ({ name }) => String(name)],
  ["hint", ({ set }) => (set.source && `С карты ${set.source}`) || ""],
  ["x", ({ x }) => tenths(x)],
  ["y", ({ y }) => tenths(y)],
  ["dot", () => true],
  ["color", ({ set }) => set.color || null],
  ["label", ({ numbered }) => numbered],
  ["dotRadius", ({ size }) => tenths(size / 2), ({ isDot }) => isDot],
  ["iconMeters", ({ size }) => tenths(size), ({ isDot }) => !isDot],
  ["labelOffset", ({ dx, dy }) => mapFields({ x: dx, y: dy }, ["x", "y"], tenths), ({ numbered }) => numbered],
  ["textHeight", ({ textHeight }) => tenths(textHeight), ({ numbered }) => numbered],
  ["labelColor", ({ set }) => set.labelColor, ({ numbered, set }) => numbered && set.labelColor],
];

// Читает строку набора: колонки по таблице мест, имя безномерной точки — существительное и номер
function pointReader(set) {
  const { glyph } = set;
  const numbered = (set.itemFormat || "").startsWith(NUMBERED_MARK);
  const noun = NOUNS.get(glyph) ?? NOUNS.get("dot");
  const columns = numbered ? NUMBERED_COLUMNS : PLAIN_COLUMNS;
  return (row, index) => {
    const cells = Object.fromEntries(columns.map((column, at) => [column, row[at]]));
    const base = { set, glyph, numbered, isDot: glyph === "dot", n: index + 1, name: `${noun} ${index + 1}` };
    return assemble(POINT_FIELDS, { ...base, ...cells });
  };
}

const MARKER_SET_FIELDS = [
  ...SET_HEAD,
  ["category", ({ set }) => set.category || "icons"],
  ["view", () => "fit"],
  ["style", ({ set }) => (LABELLED_GLYPHS.has(set.glyph) ? Object.freeze({ ...LABEL_STYLE }) : null)],
  ["count", ({ set }) => `${set.items.length} шт.`],
  [
    "items",
    ({ set }) => {
      const read = pointReader(set);
      return () => set.items.map(read);
    },
  ],
];

const makeMarkerSet = (source) => Object.freeze(assemble(MARKER_SET_FIELDS, applyEdit(source)));

export const OVERLAY_MARKER_SETS = Object.freeze(Array.from(PACK_DATA.markerSets || [], (set) => makeMarkerSet(set)));

// --- наборы зон ---

// Вид набора: без заливки (fill: false) — плоский контур по центру линии, иначе перекраска с обводкой внутрь
const LOOK_FIELDS = [
  ["fillMode", ({ flat }) => (flat ? "flat" : "recolor")],
  ["fillOpacity", ({ flat, raw }) => (flat ? 0 : raw.fillOpacity ?? FALLBACK_FILL_OPACITY)],
  ["strokeAlign", ({ flat }) => (flat ? "center" : "inside")],
  [
    "strokeWidth",
    ({ raw }) => tenths((raw.width_m || FALLBACK_STROKE_METERS) / METERS_PER_SCENE_UNIT),
    ({ flat }) => !flat,
  ],
  ["glow", () => 0],
];

const makeLook = (raw) => Object.freeze(assemble(LOOK_FIELDS, { raw, flat: raw.fill === false }));

const isShaped = (zone) => [zone.shape, zone.box].every(Boolean) && zone.shape !== "free";

const roundBox = (box) => ({
  ...mapFields(box, ["x", "y", "w", "h"], Math.round),
  rotation: Math.round(box.rotation || 0),
});

// Точки зоны: у фигурной — от соседа по округлённой рамке, у свободной — округлённые пары данных
const roundedPair = (pair) => Object.fromEntries(["x", "y"].map((axis, at) => [axis, Math.round(pair[at])]));

const zonePoints = ({ zone, shaped, box }) => {
  if (!shaped) return zone.points.map(roundedPair);
  return shapePoints(zone.shape, box);
};

const ZONE_FIELDS = [
  ...ENTITY_HEAD,
  ["name", ({ zone, n, rename }) => rename(String(zone.name || `Зона ${n}`)).slice(0, ZONE_NAME_LIMIT)],
  [
    "hint",
    ({ zone, set }) => [[zone.source, set.source].find(Boolean), zone.district].filter(Boolean).join(HINT_GLUE),
  ],
  ["color", ({ zone }) => zone.color],
  ["enabled", () => true],
  ["label", ({ zone }) => zone.label === true],
  ["shape", ({ zone, shaped }) => (shaped ? zone.shape : "free")],
  ["box", ({ box }) => box, ({ shaped }) => shaped],
  ["line", ({ zone, rawLook }) => zone.line || rawLook.line || "solid"],
  ["fill", ({ zone, rawLook }) => zone.fill ?? rawLook.fill ?? true],
  [
    "width",
    ({ zone, rawLook }) =>
      whenSet(zone.width_m ?? rawLook.width_m, (meters) => tenths(meters / METERS_PER_SCENE_UNIT)),
  ],
  ["points", zonePoints],
];

// Шаги правки зон: переименование начала названия и отбор по слову
const renamerOf = (rename) => {
  if (!rename) return (name) => name;
  const [from, to] = rename;
  return (name) => (name.startsWith(from) ? to + name.slice(from.length) : name);
};

const keeperOf = (dropWord) => {
  if (!dropWord) return () => true;
  return (zone) => !String(zone.name || "").toLowerCase().includes(dropWord);
};

// Зоны набора: нумерация идёт по оставшимся после отбора
function zoneReader(set, rawLook, edit) {
  const rename = renamerOf(edit?.rename);
  const keep = keeperOf(edit?.dropWord);
  return () =>
    set.zones.filter(keep).map((zone, index) => {
      const shaped = isShaped(zone);
      const box = shaped ? roundBox(zone.box) : null;
      return assemble(ZONE_FIELDS, { set, rawLook, zone, n: index + 1, shaped, box, rename });
    });
}

const ZONE_SET_FIELDS = [
  ...SET_HEAD,
  ["category", ({ set }) => ZONE_SHELF.get(set.category) ?? "events"],
  ["view", ({ set }) => VIEW_BY_SET.get(set.id) ?? "state"],
  ["look", ({ rawLook }) => makeLook(rawLook)],
  ["zones", ({ set, rawLook, edit }) => zoneReader(set, rawLook, edit)],
];

const makeZoneSet = (source) => {
  const { set, edit } = applyEdit(source);
  return Object.freeze(assemble(ZONE_SET_FIELDS, { set, edit, rawLook: set.look || {} }));
};

export const OVERLAY_ZONE_SETS = Object.freeze(Array.from(PACK_DATA.zoneSets || [], (set) => makeZoneSet(set)));
