/*
 * Здания из игры — общая система мастерской: «Мегамолл» (Davis Mega Mall)
 * и «Ашан / Икея» (You Tool в пустыне Гранд-Сенора).
 *
 * Основа — штатное здание из игры самого игрока (опись — `inventory/<место>.js`,
 * `scripts/lib/building-set.mjs`). Всё по умолчанию «Стандарт»: ставить
 * нечего, «Применить» снимает файлы Astral. Человек сам выбирает, что
 * поменять:
 *
 *   здание целиком и его части (стены, крыша, отделка, навесы, земля) —
 *     свой цвет с эффектами (`colour-effects.js`), узор, картинка, градиент
 *     (`finish.js`): листы игры правятся на месте;
 *   четыре стороны фасада — цвет (с рельефом стены) или свой баннер:
 *     плашка на всю сторону (`compile-emblem-plates`), картинка вписывается
 *     по рекомендуемому размеру (`buildingSidePixels`) сама;
 *   надпись — свой текст вместо названия (в острова листа надписи или
 *     плашкой, если своей надписи у здания нет);
 *   таблички — текст и цвет в острова своих листов;
 *   эмблемы и надписи — общая система мест (`emblems.js`, задача 1 ТЗ
 *     04.10.2026): до восьми своих картинок и восьми надписей плашками в
 *     любом месте, у каждой своё место, размер, поворот и прозрачность.
 *     Прежние три «логотипа» (`logos`) открываются первыми эмблемами.
 *
 * Дальние планы — общей системой LOD: облик частей тоном, стороны,
 * эмблемы, надписи, название и таблички — картинкой по плоскости (`overlays`).
 */

import { normalizeRecolourHex } from "./colour.js";
import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import { decalPlacement, normalizeDecalAngle } from "./decal.js";
import {
  EMBLEM_LIMIT,
  emblemAssets,
  emblemDecal,
  emblemSignature,
  emblemsLostInCode,
  hasEmblems,
  normalizeEmblemList,
  readyEmblems,
  shareableEmblems,
} from "./emblems.js";
import {
  BUILDING_WALL_LIMIT,
  BUILDING_WALL_OFFSET,
  BUILDING_WALL_WARN,
  buildingWallDecal,
  buildingWallIdentity,
  buildingWallOffset,
  buildingWallTexture,
  normalizeBuildingWall,
  normalizeBuildingWalls,
} from "./building-walls.js";
import { finishSignature, normalizeFinishFields } from "./finish.js";
import MEGAMALL_INVENTORY from "./inventory/megamall.js";
import YOUTOOL_INVENTORY from "./inventory/youtool.js";
import { normalizePlaceItems, placeItemPlaced, placeItemWorld, placeItemsKnown, placeItemsSignature } from "./place-item-looks.js";
import { BUILDING_ITEM_RULES, itemRuleOf } from "./scene-item-rules.js";
import { hasPlaceModels, joinLostInCode, normalizePlaceModels, placeModelsLostInCode, placeModelsSignatureField } from "./place-models.js";

export { MEGAMALL_INVENTORY, YOUTOOL_INVENTORY };
export { BUILDING_WALL_LIMIT, BUILDING_WALL_OFFSET, BUILDING_WALL_WARN, buildingWallDecal, buildingWallIdentity, buildingWallOffset, buildingWallTexture, normalizeBuildingWall, normalizeBuildingWalls };

export const BUILDING_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/* Описи мест: id набора → опись. */
export const BUILDING_INVENTORIES = Object.freeze({ megamall: MEGAMALL_INVENTORY, youtool: YOUTOOL_INVENTORY });
export const BUILDING_SET_IDS = Object.freeze(Object.keys(BUILDING_INVENTORIES));
export const buildingInventory = (place) => BUILDING_INVENTORIES[place] || null;

/*
 * Вещи здания по одной (ТЗ 27.10.2026: «Удалить» и облик предмета): у здания с описью карт района (`inventory/place-item-data.js`, пока Мегамолл) каждая вещь сцены —
 * запись сущности в картах игры. Убираются вещи, что не оболочка (оболочка — постройка, земля, парковка: у них стены, крыша, отделка и вывески, без них здания нет);
 * облик (своя модель, цвет, картинка) ставится вещи с файлом модели в описи. Номер вещи — номер сцены (`mesh.entity`).
 */
const modelsOf = new Map();
function modelTable(place) {
  if (!modelsOf.has(place)) {
    const objects = buildingInventory(place)?.scenes?.[0]?.objects;
    modelsOf.set(place, new Map((objects?.items || []).map(([entity, model]) => [entity, objects.models[model].name])));
  }
  return modelsOf.get(place);
}
/** Модель вещи здания `place` по номеру сцены. */
export const buildingItemModel = (place, entity) => modelTable(place).get(entity);
const removableOf = new Map();
function removableTable(place) {
  if (!removableOf.has(place))
    removableOf.set(
      place,
      new Set(placeItemPlaced(place).filter((entity) => modelTable(place).has(entity) && !itemRuleOf(BUILDING_ITEM_RULES, modelTable(place).get(entity))?.structure)),
    );
  return removableOf.get(place);
}
/** Можно ли убрать вещь здания: есть опись мест вещей, и вещь не оболочка. */
export const buildingRemovable = (place, entity) => removableTable(place).has(entity);
/** Есть ли у здания «Удалить» и облик предмета. */
export const buildingItemsKnown = (place) => placeItemsKnown(place);
/** Сколько вещей здания убирается по одной. */
export const buildingRemovableCount = (place) => removableTable(place).size;

/*
 * Вывеска, чьё «Убрать» убирает сами вещи (ТЗ 14.11.2026): «Флаги на столбах» Ашана — полотнища на столбах, а не только лист
 * текстуры; плашка цветом оставила бы их стоять (в редакторе их не видно, в игре они на крыше). Ключ — вывеска, значение —
 * какие вещи места она убирает (по имени модели).
 */
const SIGN_HIDES_ITEMS = Object.freeze({ youtool: Object.freeze({ flags: /^cs4_02_youtool_flag\d+_s$/ }) });

/** Вывеска `signId` в режиме «Убрать» убирает вещи места (а не красит лист плашкой). */
export const buildingSignHidesItems = (place, signId) => Boolean(SIGN_HIDES_ITEMS[place]?.[signId]);

/** Вещи, что убирают вывески места в режиме «Убрать»: номера, по возрастанию. */
export function buildingSignHiddenItems(place, input) {
  const rules = SIGN_HIDES_ITEMS[place];
  if (!rules || !buildingItemsKnown(place)) return [];
  const project = normalizeBuildingProject(place, input);
  const keys = new Set();
  for (const [signId, pattern] of Object.entries(rules)) {
    if (project.signs?.[signId]?.mode !== "hidden") continue;
    for (const entity of placeItemPlaced(place)) if (buildingRemovable(place, entity) && pattern.test(buildingItemModel(place, entity))) keys.add(entity);
  }
  return [...keys].sort((a, b) => a - b);
}

/** Все убранные вещи работы: убранные по одной в «Предметах» и убранные вывесками — один список, без повторов. */
export function buildingAllRemoved(place, input) {
  const project = normalizeBuildingProject(place, input);
  return [...new Set([...project.removed, ...buildingSignHiddenItems(place, project)])].sort((a, b) => a - b);
}

/** Убранные вещи работы: `[{ entity, model, position }]` — где в мире стояла и какой модели; установщик по ним ищет сущность в картах игры. */
export function buildingRemovedPlaces(place, input) {
  return buildingAllRemoved(place, input).map((entity) => ({ entity, model: buildingItemModel(place, entity), position: placeItemWorld(place, entity, place) }));
}
const placeOf = (place) => buildingInventory(place)?.building || null;

/* ------------------------------------------------------------------ *
 * Словари
 * ------------------------------------------------------------------ */

export const BUILDING_PARTS = Object.freeze([
  Object.freeze({ id: "walls", label: "Стены" }),
  /* Фирменные стены — свой цвет магазина (у You Tool — оранжевые рамы). */
  Object.freeze({ id: "accent", label: "Фирменные стены" }),
  Object.freeze({ id: "roof", label: "Крыша" }),
  Object.freeze({ id: "trim", label: "Отделка и металл" }),
  Object.freeze({ id: "awnings", label: "Навесы" }),
  Object.freeze({ id: "ground", label: "Парковка и земля" }),
]);
export const BUILDING_PART_IDS = Object.freeze(BUILDING_PARTS.map((part) => part.id));
/* Части, что идут за «зданием целиком», пока у них нет своего облика. */
const FOLLOWS_BUILDING = Object.freeze(["walls", "accent", "roof", "trim", "awnings"]);

export const BUILDING_SURFACE_MODES = Object.freeze(["standard", "colour", "pattern", "image", "gradient"]);

/*
 * Подъём тёмного при покраске здания своим цветом (05.10.2026, владелец:
 * «покрасил Мегамолл полностью в синий, но часть текстур осталась чёрной»).
 * Тон кладётся по светотени листа, и чёрная волна над фасадом Мегамолла,
 * чёрные простенки витрин и тёмные панели оставались чёрными — у них
 * яркость ноль. С подъёмом самый тёмный пиксель листа получает 55 %
 * светлоты выбранного цвета: здание целиком того цвета, рисунок листа
 * виден оттенками, чёрных пятен нет. Одно число у кадра и установщика.
 */
export const BUILDING_TINT_LIFT = 0.55;

/*
 * Грязь поверх стен и крыши. Чёрная «волна» над фасадом Мегамолла и тёмные
 * пятна на стенах — не лист стены, а наклейки-потёки (`im_wall_overlay03`,
 * `im_walloverlay04`, у You Tool — `db_walloverlay02` и `rsl_vc_roof_0002`)
 * из общих словарей города: перекрасить их нельзя — посерели бы стены по
 * всему штату. Покрашенная часть здания (стены или крыша — не «Стандарт»)
 * их теряет: в моделях места треугольники наклеек сводятся в точку, файл
 * той же длины. Иначе краска легла бы под тёмные пятна грязи.
 *
 * 05.10.2026 (владелец: «покрасил Ашан в синий, часть текстур не
 * покрасилась и вылезает поверх»): у You Tool поверх стен лежат ещё потёки
 * бетона (`mw_leaking_conct_02`, 2300 м²), ржавчина (`rsn_et_ruststain002b`,
 * 720 м²) и подтёки (`rsn_id1_21_mh_drips2`, 420 м²) — белёсые и рыжие
 * полосы закрывали краску на всех корпусах. Они уходят вместе с грязью
 * стен; разводы на металле крыши — с отделкой; пятна, трещины, грязь и
 * мусор парковки — с землёй (разметка остаётся).
 */
export const BUILDING_GRIME = Object.freeze([
  Object.freeze({ part: "walls", texture: /wall_?overlay|leaking|ruststain|drips|_(?:ss|bv)overlay/ }),
  Object.freeze({ part: "roof", texture: /(?:^|_)roof_\d|_vc_roof/ }),
  Object.freeze({ part: "trim", texture: /grime_bridges|stackmarkings/ }),
  Object.freeze({ part: "ground", texture: /parking_splats|parking_blends|ground_overlay|ground_cracks|glue_dirt|litter/ }),
]);

/** Чью грязь несёт наклейка с листом `texture`: часть здания (`walls`, `roof`, `trim`, `ground`) или `null`. */
export function grimePartOf(texture) {
  const name = String(texture || "").toLowerCase();
  return BUILDING_GRIME.find((item) => item.texture.test(name))?.part || null;
}

/** Части, чья грязь уходит: покрашенные (не «Стандарт»). */
export function buildingGrimeHidden(input, place) {
  const project = normalizeBuildingProject(place, input);
  const hidden = new Set();
  for (const { part } of BUILDING_GRIME) {
    const settings = buildingPartSettings(project, place, part);
    if (settings && settings.mode !== "standard") hidden.add(part);
  }
  return hidden;
}
export const BUILDING_PART_MODES = Object.freeze(["building", ...BUILDING_SURFACE_MODES]);
export const BUILDING_MODE_LABELS = Object.freeze({
  building: "Как всё здание",
  standard: "Стандарт",
  colour: "Свой цвет",
  pattern: "Узор",
  image: "Картинка",
  gradient: "Градиент",
});

export const BUILDING_SIDE_IDS = Object.freeze(["front", "right", "rear", "left"]);
export const BUILDING_SIDE_MODES = Object.freeze(["standard", "colour", "banner"]);
export const BUILDING_SIDE_MODE_LABELS = Object.freeze({ standard: "Стандарт", colour: "Покрасить", banner: "Свой баннер" });
export const BUILDING_FITS = Object.freeze(["cover", "contain", "stretch"]);
export const BUILDING_FIT_LABELS = Object.freeze({ cover: "Заполнить", contain: "Вписать", stretch: "Растянуть" });
/*
 * Щиты на крыше (задача 5 ТЗ 04.10.2026): каждая сторона щита — «Стандарт»
 * (пустые панели игры) или своё фото плашкой перед гранью.
 */
export const BUILDING_BILLBOARD_MODES = Object.freeze(["standard", "image"]);
export const BUILDING_BILLBOARD_MODE_LABELS = Object.freeze({ standard: "Стандарт", image: "Своё фото" });
/* Плашек щитов у места не больше (имена в доверии пакета). */
export const BUILDING_BILLBOARD_COUNT = 8;

export const BUILDING_TEXT_MODES = Object.freeze(["standard", "text", "hidden"]);
export const BUILDING_TEXT_MODE_LABELS = Object.freeze({ standard: "Стандарт", text: "Свой текст", hidden: "Убрать" });
export const BUILDING_TEXT_BACKGROUNDS = Object.freeze(["clear", "colour"]);
export const BUILDING_TEXT_BACKGROUND_LABELS = Object.freeze({ clear: "Только буквы", colour: "Плашка цветом" });
export const BUILDING_TEXT_STYLES = Object.freeze(["classic", "flat", "neon"]);
export const BUILDING_TEXT_STYLE_LABELS = Object.freeze({ classic: "Объёмные", flat: "Плоские", neon: "Неон" });

/*
 * Шрифты надписей — системные шрифты Windows (Astral их не возит): кадр и
 * «Применить» рисуют текст одним холстом окна, главный процесс получает
 * картинку.
 */
export const BUILDING_FONTS = Object.freeze([
  Object.freeze({ id: "block", label: "Рубленый", family: "Impact, 'Arial Black', sans-serif", weight: 400 }),
  Object.freeze({ id: "wide", label: "Широкий", family: "'Arial Black', 'Segoe UI Black', sans-serif", weight: 900 }),
  Object.freeze({ id: "modern", label: "Современный", family: "Bahnschrift, 'Segoe UI', sans-serif", weight: 700 }),
  Object.freeze({ id: "serif", label: "С засечками", family: "Georgia, 'Times New Roman', serif", weight: 700 }),
  Object.freeze({ id: "script", label: "Рукописный", family: "'Segoe Script', 'Brush Script MT', cursive", weight: 700 }),
  Object.freeze({ id: "mono", label: "Моноширинный", family: "Consolas, 'Courier New', monospace", weight: 700 }),
]);
export const BUILDING_FONT_IDS = Object.freeze(BUILDING_FONTS.map((font) => font.id));
export const buildingFont = (id) => BUILDING_FONTS.find((font) => font.id === id) || BUILDING_FONTS[0];

/*
 * Свой шрифт человека (ТЗ 23.10.2026, п. F): у надписи `font: "custom"` и ключ файла в хранилище окна. Файла в работе
 * нет — он лежит на этом компьютере; буквы окно рисует картинкой, в игру едет она. Ключ остаётся в надписи и когда
 * выбран шрифт набора: свой можно вернуть одним нажатием.
 */
export const BUILDING_FONT_CUSTOM = "custom";
const BUILDING_FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;

/** Ключи своих шрифтов во всей работе (надписи названия, табличек, плашек): по одному, в порядке встречи. */
export function buildingFontAssets(project) {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.font === BUILDING_FONT_CUSTOM && BUILDING_FONT_ASSET.test(String(node.fontAsset || ""))) found.add(node.fontAsset);
    Object.values(node).forEach(walk);
  };
  walk(project);
  return [...found];
}

/* Работа без своих шрифтов: надписи со своим шрифтом — шрифтом по умолчанию, ключей файлов нет. */
function withoutOwnFonts(node) {
  if (Array.isArray(node)) return node.map(withoutOwnFonts);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = withoutOwnFonts(value);
  if ("fontAsset" in out) {
    if (out.font === BUILDING_FONT_CUSTOM) out.font = "block";
    delete out.fontAsset;
    delete out.fontName;
  }
  return out;
}

export const BUILDING_TEXT_LIMIT = 40;
/* Плашки эмблем и надписей места (`_logo_N` — имя прежних логотипов). */
export const BUILDING_LOGO_COUNT = EMBLEM_LIMIT;
/* Плашки поверх объёмных букв (названия и табличек-моделей) — не больше. */
export const BUILDING_COVER_COUNT = 6;
/*
 * Плашки мест надписи и табличек (`buildingTextPlates`): когда у острова
 * листа цели разошлись (буквы на стене — своим текстом, пилон — как в
 * игре), каждое место рисует своя плашка. Не больше.
 */
export const BUILDING_MARK_COUNT = 64;
export const BUILDING_LOGO_SIZE = Object.freeze([1, 30]);
export const BUILDING_TITLE_SIZE = Object.freeze([1, 20]);

/*
 * Широкая стена — панелями (задача 6Б ТЗ 18.10.2026): главный фасад Мегамолла
 * 73 м, а одна плашка стороны — лист не больше 2048 px по длинной стороне
 * (28 px на метр). Своя картинка стены шире `BUILDING_PANEL_FROM_PIXELS`
 * ложится панелями: стена делится на куски по ~15 м, у каждого — своя плашка
 * с листом `buildingPanelPlateSize`; итог — в разрешении картинки. Стена
 * уже 30 м и сторона с рамкой баннера (уступ) остаются одной плашкой.
 */
export const BUILDING_PANEL_METRES = 15;
export const BUILDING_PANELS_FROM_METRES = 30;
export const BUILDING_PANEL_MAX = 8;
export const BUILDING_PANEL_FROM_PIXELS = 2048;
/* Длинная сторона листа одной панели, px: пять панелей Мегамолла 2048 × 1024 — те же ~10 Мпикс, что и 8178 × 1389 холста студии. */
export const BUILDING_PANEL_PLATE_SIDE = 2048;
/*
 * Стык панелей, м: соседние панели заходят друг на друга на столько с каждой стороны шва. Положение плашек в файле
 * округляется до миллиметра (`buildingPlates`), и впритык две плашки могли разойтись на миллиметр — штатная стена
 * просвечивала бы волосяной щелью. Заход в 2 мм — меньше пикселя листа (137 px/м), глазом не виден.
 */
export const BUILDING_PANEL_SEAM = 0.002;

const IMAGE_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;

/* Имена своих плашек в игре: у каждого места свои — наборы снимаются порознь. */
export function buildingPlateNames(place) {
  const prefix = `astral_${place}`;
  return Object.freeze({
    types: `${prefix}_marks`,
    map: `${prefix}_marks_map`,
    side: (id) => `${prefix}_side_${id}`,
    /* Панель широкой стены: `astral_megamall_side_front_p1` … */
    sidePanel: (id, index) => `${prefix}_side_${id}_p${index + 1}`,
    billboard: (index) => `${prefix}_bill_${index + 1}`,
    logo: (index) => `${prefix}_logo_${index + 1}`,
    /* Своя картинка у стены (3В ТЗ 18.10.2026): одна плашка на стену. */
    wall: (index) => `${prefix}_wall_${index + 1}`,
    title: `${prefix}_title`,
    cover: (index) => `${prefix}_cover_${index + 1}`,
    mark: (index) => `${prefix}_mark_${String(index + 1).padStart(2, "0")}`,
  });
}

/** Все файлы, что может привезти пакет плашек места (доверие пакета). */
export function buildingPlateFiles(place) {
  const names = buildingPlateNames(place);
  const plates = [
    ...BUILDING_SIDE_IDS.map((id) => names.side(id)),
    /* Панели широких стен (у Мегамолла — фасад и задняя сторона по пять). */
    ...BUILDING_SIDE_IDS.flatMap((id) => (buildingSidePanels(place, id)?.panels || []).map((panel) => panel.name)),
    ...Array.from({ length: BUILDING_BILLBOARD_COUNT }, (_, index) => names.billboard(index)),
    ...Array.from({ length: BUILDING_LOGO_COUNT }, (_, index) => names.logo(index)),
    ...Array.from({ length: BUILDING_WALL_LIMIT }, (_, index) => names.wall(index)),
    names.title,
    ...Array.from({ length: BUILDING_COVER_COUNT }, (_, index) => names.cover(index)),
    ...Array.from({ length: BUILDING_MARK_COUNT }, (_, index) => names.mark(index)),
  ];
  return Object.freeze([
    ...plates.map((name) => `${name}.ydr`),
    `${names.types}.ytyp`,
    `${names.map}.ymap`,
    /* Дальние копии плашек своей моделью (фикс 1 ТЗ 06.10.2026, падение 30.10.2026). */
    ...plates.map((name) => `${name}_far.ydr`),
    `${names.map}_lod.ymap`,
    "_manifest.ymf",
  ]);
}

/* ------------------------------------------------------------------ *
 * Опись
 * ------------------------------------------------------------------ */

/** Стороны места: `[{ id, label, normal, right, point, centre, width, height, pixels }]`. */
export const buildingSides = (place) => placeOf(place)?.sides || [];
export const buildingSide = (place, id) => buildingSides(place).find((side) => side.id === id) || null;

/** Стороны щитов на крыше: `[{ id, board, label, point, normal, width, height, pixels }]`. */
export const buildingBillboards = (place) => (placeOf(place)?.billboards || []).slice(0, BUILDING_BILLBOARD_COUNT);
export const buildingBillboard = (place, id) => buildingBillboards(place).find((item) => item.id === id) || null;
/** Таблички места: `[{ id, label, text, lines, background, regions }]`. */
export const buildingSigns = (place) => placeOf(place)?.signs || [];
/** Надпись места: `{ kind: "islands" | "plate", text, label, regions?, plate? }`. */
export const buildingTitle = (place) => placeOf(place)?.title || null;

/**
 * Части, что есть у этого здания (у Мегамолла нет «фирменных стен»): лист
 * хоть одной грани этой части есть в описи.
 */
export function buildingPlaceParts(place) {
  const textures = placeOf(place)?.textures || [];
  return BUILDING_PARTS.filter((part) => textures.some((record) => record.areas?.[part.id] > 0 || record.groups?.includes(part.id)));
}

/**
 * Плашки поверх объёмных букв места: `[{ key, group, index, id, label,
 * point, normal, width, height, erase? }]` — надпись (`kind: "cover"`) и
 * таблички с местами букв. `index` — номер плашки места (имя модели в игре).
 * `erase` — буквы игры уходят из модели (`{ model, file, at, textures, box }`,
 * рамка в метрах сцены), плашка — только буквы человека.
 */
export function buildingCovers(place) {
  const out = [];
  const title = buildingTitle(place);
  if (title?.kind === "cover") for (const cover of title.covers || []) out.push({ ...cover, key: `cover:title:${cover.id}`, group: "title" });
  for (const sign of buildingSigns(place)) for (const cover of sign.covers || []) out.push({ ...cover, key: `cover:sign:${sign.id}:${cover.id}`, group: `sign:${sign.id}` });
  return out.slice(0, BUILDING_COVER_COUNT).map((cover, index) => ({ ...cover, index }));
}

/* Надпись или табличка работы по группе (`title`, `sign:<id>`). */
const textOfGroup = (project, group) => (group === "title" ? project.title : project.signs[group.slice(5)]);

/* ------------------------------------------------------------------ *
 * Куда пишет человек: цели надписи и табличек
 * ------------------------------------------------------------------ */

/*
 * Один остров листа у Rockstar рисует несколько мест: буквы MEGA MALL на
 * двух стенах здания и на пилоне у дороги, CARSON SELF STORAGE — на трёх
 * стенах и на двух пилонах. Правка острова меняла все места разом —
 * владелец 04.10: «вписываю текст — он меняется на табличке и ещё пишется
 * на самом Мегамолле». Подготовка делит места острова на цели (`targets`
 * описи); у каждой цели свой текст. Первая цель надписи — инструмент
 * «Надпись», остальные — «Таблички». Источник без целей в описи — одна
 * цель на все места, как раньше.
 */
const TITLE_TARGET = "title";

/**
 * Цели текста места: `[{ id, source, label, tool, primary, lines, vertical,
 * defaults, places: [{ regionIndex, placeIndex, texture, island, point,
 * normal, width, height }] }]`. `source` — `title` или `sign:<id>` (чей
 * остров листа).
 */
export function buildingTextTargets(place) {
  const out = [];
  const add = (sourceKey, source, defaults, isTitle) => {
    const regions = source.regions || [];
    const targets = source.targets?.length ? source.targets : [{ id: isTitle ? TITLE_TARGET : source.id, label: source.label, places: null }];
    targets.forEach((target, index) => {
      const places = [];
      regions.forEach((region, regionIndex) =>
        (region.places || []).forEach((spot, placeIndex) => {
          if (target.places && !target.places.includes(`${regionIndex}:${placeIndex}`)) return;
          places.push({
            regionIndex,
            placeIndex,
            texture: region.texture,
            island: region.islands[spot.island] || region.islands[0],
            islandIndex: Math.max(0, region.islands.indexOf(region.islands[spot.island] || region.islands[0])),
            point: spot.point,
            normal: spot.normal,
            width: spot.width,
            height: spot.height,
          });
        }),
      );
      out.push({
        id: isTitle && index === 0 ? TITLE_TARGET : target.id,
        source: sourceKey,
        label: target.label || source.label,
        tool: isTitle && index === 0 ? "title" : "signs",
        primary: index === 0,
        split: targets.length > 1,
        lines: source.lines || 1,
        vertical: Boolean(source.vertical),
        defaults,
        places,
      });
    });
  };
  const title = buildingTitle(place);
  if (title?.kind === "islands") add(TITLE_TARGET, title, { ...title, lines: 1 }, true);
  for (const sign of buildingSigns(place)) if (sign.regions?.length) add(`sign:${sign.id}`, sign, sign, false);
  return out;
}

/** Настройки цели в работе: надпись — `project.title`, остальные — `project.signs[id]`. */
export const buildingTargetSettings = (project, target) => (target.id === TITLE_TARGET ? project.title : project.signs[target.id]);

/*
 * Своя надпись одного места таблички (задача 10 ТЗ 10.10.2026): у цели
 * много мест (флаги и таблички Ашана, таблички складов Мегамолла), и каждое
 * может получить свой текст — ключ `<цель>@<область>:<место>`. Без своей
 * записи место берёт текст цели. Разошедшиеся места рисуют свои плашки
 * (`textSourcePlans` → `plates`), как разошедшиеся цели.
 */
export const buildingSignPlaceKey = (targetId, spot) => `${targetId}@${spot.regionIndex}:${spot.placeIndex}`;

/** Текст места: своя запись (`project.signPlaces`) или текст цели. */
export const buildingSpotSettings = (project, target, spot) => project.signPlaces?.[buildingSignPlaceKey(target.id, spot)] || buildingTargetSettings(project, target);

/*
 * Как рисовать каждый источник: `atlas` — у всех его целей один облик, и он
 * ложится в остров листа (как раньше); `plates` — облики разошлись: остров
 * листа очищается (у листа с прозрачностью), а каждое место рисует своя
 * плашка — штатным куском листа, своим текстом или ничем.
 */
function textSourcePlans(project, place) {
  const textures = new Map((placeOf(place)?.textures || []).map((record) => [record.name, record]));
  const bySource = new Map();
  for (const target of buildingTextTargets(place)) bySource.set(target.source, [...(bySource.get(target.source) || []), target]);
  return [...bySource].map(([key, targets]) => {
    const settings = targets.map((target) => buildingTargetSettings(project, target));
    /* Облик — по каждому месту: своя надпись места разводит источник по плашкам. */
    const signatures = targets.flatMap((target, index) =>
      (target.places.length ? target.places.map((spot) => buildingSpotSettings(project, target, spot)) : [settings[index]]).map((item) => JSON.stringify(item ? textSignature(item) : "standard")),
    );
    const texture = targets.flatMap((target) => target.places)[0]?.texture;
    const opaque = /DXT1|BC1/i.test(String(textures.get(texture)?.format || ""));
    return { key, targets, settings, opaque, mode: signatures.every((value) => value === signatures[0]) ? "atlas" : "plates" };
  });
}

/** Источники, где облики целей разошлись (`plates`): `Set` ключей `title`, `sign:<id>`. */
export function buildingSplitSources(input, place) {
  const project = normalizeBuildingProject(place, input);
  return new Set(textSourcePlans(project, place).filter((plan) => plan.mode === "plates").map((plan) => plan.key));
}

/*
 * Острова, что уходят из листа: «Убрать» у источника одним обликом и
 * острова источников, разошедшихся по плашкам (у листа с прозрачностью —
 * их места рисуют плашки). `[{ key, texture, islands, opaque, colour }]`.
 */
export function buildingClearedRegions(input, place) {
  const project = normalizeBuildingProject(place, input);
  const out = [];
  const sources = new Map([
    [TITLE_TARGET, buildingTitle(place)?.kind === "islands" ? buildingTitle(place).regions : []],
    ...buildingSigns(place).map((sign) => [`sign:${sign.id}`, sign.regions || []]),
  ]);
  for (const plan of textSourcePlans(project, place)) {
    const regions = sources.get(plan.key) || [];
    const hidden = plan.mode === "atlas" && plan.settings[0]?.mode === "hidden";
    /* Вывеска, чьё «Убрать» убирает вещи (флаги), лист не красит: полотнищ уже нет. */
    if (hidden && plan.key.startsWith("sign:") && buildingSignHidesItems(place, plan.key.slice("sign:".length))) continue;
    const split = plan.mode === "plates" && !plan.opaque;
    if (!hidden && !split) continue;
    for (const region of regions)
      out.push({ key: plan.key, texture: region.texture, islands: region.islands, opaque: plan.opaque, colour: hidden ? plan.settings[0].backgroundColour : "#000000" });
  }
  return out;
}

/**
 * Плашки мест разошедшихся источников: `[{ key, kind, target, settings,
 * texture, island, lines, vertical, point, normal, width, height, colour }]`.
 * `kind`: `restore` — штатный кусок листа (место «Стандарт», остров очищен),
 * `text` — свой текст, `blank` — «Убрать» у листа без прозрачности (плашка
 * цветом). Картинку `text` рисует окно (`key`).
 */
export function buildingTextPlates(input, place) {
  const project = normalizeBuildingProject(place, input);
  const out = [];
  for (const plan of textSourcePlans(project, place)) {
    if (plan.mode !== "plates") continue;
    plan.targets.forEach((target) => {
      for (const spot of target.places) {
        const settings = buildingSpotSettings(project, target, spot);
        const stock = !settings || textIsStock(settings);
        const kind = stock ? (plan.opaque ? null : "restore") : settings.mode === "hidden" ? (plan.opaque ? "blank" : null) : "text";
        if (!kind) continue;
        out.push({
          key: `mark:${target.id}:${spot.regionIndex}:${spot.placeIndex}`,
          kind,
          target: target.id,
          source: plan.key,
          settings: stock ? null : settings,
          texture: spot.texture,
          island: spot.island,
          lines: settings && kind === "text" ? islandTextLines(settings, target.lines, target, spot) : null,
          vertical: target.vertical,
          opaque: plan.opaque,
          point: spot.point,
          normal: spot.normal,
          width: spot.width,
          height: spot.height,
          colour: settings?.backgroundColour || "#000000",
        });
      }
    });
  }
  return out.slice(0, BUILDING_MARK_COUNT);
}

/* Строки места: у вывески из нескольких строк по островам — строка острова. */
function islandTextLines(settings, lineCount, target, spot) {
  const islands = new Set(target.places.map((place) => place.islandIndex));
  const split = (lineCount || 1) > 1 && islands.size === lineCount;
  return split ? [settings.lines[spot.islandIndex] || ""] : settings.lines;
}

/**
 * Рекомендуемый размер картинки стороны, px: 2048 по длинной стороне
 * (предел листа плашки), другая — по пропорции стены.
 */
export function buildingSidePixels(place, id) {
  const side = buildingSide(place, id);
  return side?.pixels || [2048, 512];
}

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampNumber = (value, [low, high], fallback, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
};
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);
/* Текст надписи без управляющих символов (перевод строки — разделитель строк). */
const cleanText = (value, limit = BUILDING_TEXT_LIMIT) =>
  [...String(value ?? "")]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, limit);

function normalizeImage(input) {
  const source = plain(input);
  const asset = IMAGE_ASSET.test(String(source.asset || "")) ? source.asset : "";
  return {
    asset,
    name: asset ? String(source.name || "").slice(0, 80) : "",
    width: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.width) || 1))) : 0,
    height: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.height) || 1))) : 0,
  };
}

const SURFACE_COLOURS = Object.freeze({ building: "#d9d2c3", walls: "#d9d2c3", accent: "#c0392b", roof: "#5a5d63", trim: "#30343a", awnings: "#c0392b", ground: "#3d4046" });

function normalizeSurface(id, input, modes, fallbackMode) {
  const source = plain(input);
  return {
    mode: choice(source.mode, modes, fallbackMode),
    look: normalizeColourEffect(lookOf(source), { colour: SURFACE_COLOURS[id] || "#808080", colour2: "#ffffff", direction: "height" }),
    ...normalizeFinishFields(source),
  };
}

function normalizeSide(input) {
  const source = plain(input);
  const opacity = Number(source.opacity);
  const mode = choice(source.mode, BUILDING_SIDE_MODES, "standard");
  /* Баннер — чистое полотно до краёв стены (05.10.2026, владелец: «баннер
     ложится обрезанным»): надпись, таблички и дыра под объёмными буквами
     поверх него — только если человек сам включил их переключателем
     (`signsSet`). У цвета стены вывески по-прежнему поверх. */
  const signsSet = source.signsSet === true;
  return {
    mode,
    look: normalizeColourEffect(lookOf(source), { colour: "#2f6fd6", colour2: "#ffffff", direction: "along" }),
    relief: source.relief !== false,
    image: normalizeImage(source.image),
    fit: choice(source.fit, BUILDING_FITS, "cover"),
    background: normalizeRecolourHex(source.background, "#101010"),
    opacity: Number.isFinite(opacity) ? Math.round(Math.min(100, Math.max(10, opacity))) : 100,
    /* Надпись и таблички этой стены — поверх плашки (печатью на её листе). */
    signs: mode === "banner" && !signsSet ? false : source.signs !== false,
    ...(signsSet ? { signsSet: true } : {}),
  };
}

/* Сторона щита на крыше: своё фото, как его вписать, цвет полей. */
function normalizeBillboard(input) {
  const source = plain(input);
  return {
    mode: choice(source.mode, BUILDING_BILLBOARD_MODES, "standard"),
    image: normalizeImage(source.image),
    fit: choice(source.fit, BUILDING_FITS, "cover"),
    background: normalizeRecolourHex(source.background, "#101010"),
  };
}

function normalizeText(input, defaults) {
  const source = plain(input);
  const lineCount = Math.max(1, defaults.lines || 1);
  const rawLines = Array.isArray(source.lines) ? source.lines : String(source.text ?? defaults.text ?? "").split("\n");
  const lines = Array.from({ length: lineCount }, (_, index) => cleanText(rawLines[index] ?? ""));
  return {
    mode: choice(source.mode, BUILDING_TEXT_MODES, "standard"),
    lines,
    font: source.font === BUILDING_FONT_CUSTOM && BUILDING_FONT_ASSET.test(String(source.fontAsset || "")) ? BUILDING_FONT_CUSTOM : choice(source.font, BUILDING_FONT_IDS, defaults.font || "block"),
    ...(BUILDING_FONT_ASSET.test(String(source.fontAsset || "")) ? { fontAsset: source.fontAsset, fontName: String(source.fontName ?? "").trim().slice(0, 60) } : {}),
    style: choice(source.style, BUILDING_TEXT_STYLES, defaults.style || "classic"),
    colour: normalizeRecolourHex(source.colour, defaults.colour || "#f2f2f2"),
    outline: normalizeRecolourHex(source.outline, defaults.outline || "#1a1a1a"),
    background: choice(source.background, BUILDING_TEXT_BACKGROUNDS, defaults.background === "colour" ? "colour" : "clear"),
    backgroundColour: normalizeRecolourHex(source.backgroundColour, defaults.backgroundColour || "#1f3a93"),
  };
}

/* Место на стене (метры сцены): точка с запасом и нормаль. */
function normalizePlace(source, fallback) {
  const point =
    Array.isArray(source.point) && source.point.length === 3 && source.point.every(Number.isFinite)
      ? source.point.map((value) => Math.min(600, Math.max(-600, Number(value))))
      : [...fallback.point];
  const raw = Array.isArray(source.normal) && source.normal.length === 3 && source.normal.every(Number.isFinite) ? source.normal : fallback.normal;
  const length = Math.hypot(...raw) || 1;
  return {
    point: point.map((value) => Math.round(value * 100) / 100),
    normal: raw.map((value) => Math.round((value / length) * 1000) / 1000),
  };
}

/* Логотип по умолчанию: место описи, второй и третий — левее и правее. */
function logoFallback(place, index) {
  const decal = placeOf(place)?.decal || { point: [0, 0, 6], normal: [0, -1, 0] };
  if (!index) return decal;
  const [nx, ny] = decal.normal;
  const right = [-ny, nx];
  const shift = index === 1 ? -12 : 12;
  return { point: [decal.point[0] + right[0] * shift, decal.point[1] + right[1] * shift, decal.point[2]], normal: decal.normal };
}

/**
 * Место новой эмблемы или надписи — середина главного фасада, чуть выше
 * середины стены (широкая надпись не вылезает за угол): `{ point, normal }`.
 * Без описи сторон — место эмблемы описи.
 */
export const buildingEmblemPlace = (place) => {
  const front = buildingSide(place, "front");
  if (!front) {
    const { point, normal } = logoFallback(place, 0);
    return { point: [...point], normal: [...normal] };
  }
  const lift = Math.round(front.height * 0.15 * 100) / 100;
  return { point: [front.point[0], front.point[1], Math.round((front.point[2] + lift) * 100) / 100], normal: [...front.normal] };
};

/* Эмблема или надпись места: картинка, место на стене, высота, прозрачность, поворот. */
function normalizeBuildingEmblem(place, input) {
  const source = plain(input);
  const opacity = Number(source.opacity);
  return {
    ...normalizeImage(source),
    ...normalizePlace(source, buildingEmblemPlace(place)),
    size: clampNumber(source.size, BUILDING_LOGO_SIZE, 6),
    opacity: Number.isFinite(opacity) ? Math.round(Math.min(100, Math.max(0, opacity))) : 100,
    angle: normalizeDecalAngle(source.angle),
  };
}

/*
 * Список эмблем работы. Прежние работы (до 05.10.2026) держали три
 * логотипа `logos` — их картинки становятся первыми эмблемами на своих местах.
 */
function buildingEmblemSource(place, source) {
  if (Array.isArray(source.emblems)) return source;
  const logos = Array.isArray(source.logos) ? source.logos : [];
  return {
    emblems: logos
      .map((logo, index) => ({ logo: plain(logo), index }))
      .filter(({ logo }) => IMAGE_ASSET.test(String(logo.asset || "")))
      .map(({ logo, index }) => ({ ...logo, kind: "image", ...normalizePlace(logo, logoFallback(place, index)) })),
  };
}

/* Надпись-плашка (у здания без своей надписи): место и высота строки. */
function normalizeTitlePlace(place, input) {
  const title = buildingTitle(place);
  const source = plain(input);
  if (title?.kind !== "plate") return {};
  return {
    ...normalizePlace(source, title.plate || logoFallback(place, 0)),
    size: clampNumber(source.size, BUILDING_TITLE_SIZE, title.plate?.size || 4),
  };
}

export function createBuildingProject(place) {
  return normalizeBuildingProject(place, {});
}

/*
 * Своя надпись вместо букв MEGA MALL на стенах Мегамолла снята по слову
 * владельца (05.10.2026: «функционал „надпись Мегамолл на стенах здания“
 * убери — он не нужен»). Буквы на стенах остаются как в игре; свой текст на
 * стенах — инструментом «Текст» (общая система надписей), пилон у дороги —
 * в «Табличках», объёмные буквы DAVIS MEGA MALL — в «Надписи».
 */
const RETIRED_TITLES = new Set(["megamall"]);

/** Снята ли своя надпись места вместо штатных букв на стенах. */
export const buildingTitleRetired = (place) => RETIRED_TITLES.has(place);

/** Работа места в порядке; лишние поля отбрасываются молча. */
function buildingItemsOf(place, source) {
  if (!buildingItemsKnown(place)) return { removed: [], items: [] };
  const removed = [...new Set((Array.isArray(source.removed) ? source.removed : []).filter((entity) => Number.isInteger(entity) && buildingRemovable(place, entity)))].sort((a, b) => a - b);
  return { removed, items: normalizePlaceItems(place, source.items, { modelOf: (entity) => buildingItemModel(place, entity), removed }) };
}

export function normalizeBuildingProject(place, input) {
  const source = plain(input);
  const parts = {};
  for (const id of BUILDING_PART_IDS)
    parts[id] = normalizeSurface(id, plain(source.parts)[id], BUILDING_PART_MODES, FOLLOWS_BUILDING.includes(id) ? "building" : "standard");
  const sides = {};
  for (const id of BUILDING_SIDE_IDS) sides[id] = normalizeSide(plain(source.sides)[id]);
  const billboards = {};
  for (const board of buildingBillboards(place)) billboards[board.id] = normalizeBillboard(plain(source.billboards)[board.id]);
  const titleDefaults = buildingTitle(place) || { text: "" };
  /*
   * Таблички — по целям (места острова делятся на цели, см.
   * `buildingTextTargets`). Работа до 05.10.2026 знала одну табличку на
   * все места: цель без своей записи берёт запись источника — так прежняя
   * работа открывается тем же обликом, а разводит её уже человек.
   */
  const signs = {};
  const sourceSigns = plain(source.signs);
  for (const sign of buildingSigns(place)) {
    const targets = sign.targets?.length ? sign.targets : [{ id: sign.id }];
    for (const target of targets) signs[target.id] = normalizeText(sourceSigns[target.id] ?? sourceSigns[sign.id], sign);
  }
  const titleStyle = { style: "classic", colour: "#f0a8a8", outline: "#3a1f1f", ...titleDefaults, lines: 1 };
  /* Цели надписи кроме стен (пилон у дороги) брали прежнюю общую надпись;
     у снятой надписи стен (`RETIRED_TITLES`) она туда не переезжает. */
  for (const target of (buildingTitle(place)?.targets || []).slice(1))
    signs[target.id] = normalizeText(sourceSigns[target.id] ?? (RETIRED_TITLES.has(place) ? undefined : source.title), titleStyle);
  /* Свои надписи мест таблички (задача 10): только места целей описи. */
  const signPlaces = {};
  const sourcePlaces = plain(source.signPlaces);
  for (const target of buildingTextTargets(place)) {
    if (target.places.length < 2) continue;
    for (const spot of target.places) {
      const key = buildingSignPlaceKey(target.id, spot);
      const raw = sourcePlaces[key];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) signPlaces[key] = normalizeText(raw, target.source === TITLE_TARGET ? titleStyle : target.defaults);
    }
  }
  const emblems = normalizeEmblemList(buildingEmblemSource(place, source), (raw) => normalizeBuildingEmblem(place, raw));
  return {
    schema: BUILDING_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    building: normalizeSurface("building", source.building, BUILDING_SURFACE_MODES, "standard"),
    parts,
    sides,
    billboards,
    title: {
      ...normalizeText(source.title, { style: "classic", colour: "#f0a8a8", outline: "#3a1f1f", ...titleDefaults }),
      ...normalizeTitlePlace(place, source.title),
      ...(RETIRED_TITLES.has(place) ? { mode: "standard" } : {}),
    },
    signs,
    signPlaces,
    emblems,
    /* Своя картинка у стены (3В ТЗ 18.10.2026): плашкой по стене, из студии. */
    walls: normalizeBuildingWalls(source.walls),
    /* Свои модели (ТЗ 11.10.2026, вечер, задача 1). */
    models: normalizePlaceModels(source.models),
    /* Убранные по одной вещи и облик вещей (ТЗ 27.10.2026): только у здания с описью карт района. */
    ...buildingItemsOf(place, source),
  };
}

export const serializeBuildingProject = (place, project) => JSON.stringify(normalizeBuildingProject(place, project));

export function parseBuildingProject(place, text) {
  try {
    return normalizeBuildingProject(place, typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createBuildingProject(place);
  }
}

/* ------------------------------------------------------------------ *
 * Облик
 * ------------------------------------------------------------------ */

/** Облик части: своя настройка или «как всё здание». */
export function buildingPartSettings(input, place, partId) {
  const project = normalizeBuildingProject(place, input);
  const part = project.parts[partId];
  if (!part) return null;
  const settings = part.mode === "building" ? project.building : part;
  /* «Картинка» выбрана, а файл не загружен (или ключ не прошёл разбор): красить
     нечем — часть остаётся «Стандартом», как стороны и щиты без картинки. Кадр
     редактора в этом состоянии и так рисует штатное здание; установщик
     отказывал «Своя картинка отделки не пришла» (журнал 14.10.2026, Мегамолл). */
  return settings.mode === "image" && !settings.image?.asset ? { ...settings, mode: "standard" } : settings;
}

/** Часть, чьих граней у листа описи больше (из частей здания), или `null`. */
export function buildingDominantPart(record) {
  let best = null;
  for (const [group, area] of Object.entries(record?.areas || {})) if (BUILDING_PART_IDS.includes(group) && (!best || area > best.area)) best = { group, area };
  if (best) return best.group;
  return (record?.groups || []).find((group) => BUILDING_PART_IDS.includes(group)) || null;
}

/*
 * Чей облик у листа `texture` в игре (задача 11 ТЗ 17.10.2026, «наложение
 * текстур выходит за пределы»): лист игры один на все свои грани, и если его
 * делят части здания (у Мегамолла атлас `sc1_22_t_page6` — стены 274 м²,
 * крыша и отделка по 46 м²), установщик красит его обликом части, где его
 * больше. Кадр рисует так же: иначе покрашенная крыша в кадре оставалась бы
 * штатной в игре, а покрашенные стены уводили бы в игре и куски крыши.
 * Лист одной части или без описи — `group` как есть.
 */
export function buildingSheetPart(place, texture, group) {
  if (!BUILDING_PART_IDS.includes(group)) return group;
  const record = (buildingInventory(place)?.building?.textures || []).find((item) => item.role === "diffuse" && item.name === String(texture || "").toLowerCase());
  return buildingDominantPart(record) || group;
}

/* Текст надписи или таблички задан (хоть одна строка не пуста). */
const hasText = (item) => item.lines.some((line) => line.trim());

const surfaceIsStock = (item) => item.mode === "standard";
const sideIsStock = (item) => item.mode === "standard" || (item.mode === "banner" && !item.image.asset);
const textIsStock = (item) => item.mode === "standard" || (item.mode === "text" && !hasText(item));
const billboardIsStock = (item) => !item || item.mode === "standard" || !item.image.asset;

/** Всё здание «Стандарт»: ставить нечего, «Применить» снимает файлы Astral. */
export function buildingProjectIsStock(place, input) {
  const project = normalizeBuildingProject(place, input);
  if (BUILDING_PART_IDS.some((id) => !surfaceIsStock(buildingPartSettings(project, place, id)))) return false;
  if (BUILDING_SIDE_IDS.some((id) => buildingSide(place, id) && !sideIsStock(project.sides[id]))) return false;
  if (Object.values(project.billboards).some((item) => !billboardIsStock(item))) return false;
  if (buildingTitle(place) && !textIsStock(project.title)) return false;
  if (Object.values(project.signs).some((item) => !textIsStock(item))) return false;
  if (Object.values(project.signPlaces || {}).some((item) => !textIsStock(item))) return false;
  if (hasEmblems(project.emblems)) return false;
  if (project.walls.length) return false;
  if (hasPlaceModels(project.models)) return false;
  if (project.removed.length || project.items.length) return false;
  return true;
}

function surfaceSignature(item) {
  if (item.mode === "standard") return "standard";
  if (item.mode === "colour") return { mode: "colour", look: item.look };
  return finishSignature(item) || { mode: item.mode };
}

/* Группы, чьи буквы закрывает плашка цветом (буквы игры остаются за ней). */
const opaqueCoverGroups = (place) => new Set(buildingCovers(place).filter((cover) => !cover.erase).map((cover) => cover.group));

/* `opaque` — плашка всегда цветом (буквы игры закрыты плашкой, лист без прозрачности). */
function textSignature(item, withPlace = false, opaque = false) {
  if (textIsStock(item)) return "standard";
  if (item.mode === "hidden") return opaque ? { hidden: item.backgroundColour } : "hidden";
  const out = { lines: item.lines, font: item.font, ...(item.font === BUILDING_FONT_CUSTOM ? { fontAsset: item.fontAsset } : {}), style: item.style, colour: item.colour, outline: item.outline, background: item.background };
  if (item.background === "colour" || opaque) out.backgroundColour = item.backgroundColour;
  if (withPlace && item.point) Object.assign(out, { point: item.point, normal: item.normal, size: item.size });
  return out;
}

/** Отпечаток для очереди «Применить»: всё, что меняет файлы. */
export function buildingProjectSignature(place, input) {
  const project = normalizeBuildingProject(place, input);
  const parts = {};
  for (const id of BUILDING_PART_IDS) parts[id] = surfaceSignature(buildingPartSettings(project, place, id));
  const sides = {};
  for (const id of BUILDING_SIDE_IDS) {
    const item = project.sides[id];
    if (sideIsStock(item) || !buildingSide(place, id)) continue;
    sides[id] =
      item.mode === "colour"
        ? { mode: "colour", look: item.look, relief: item.relief, opacity: item.opacity, signs: item.signs }
        : { mode: "banner", image: item.image.asset, fit: item.fit, background: item.background, opacity: item.opacity, signs: item.signs };
  }
  const covered = opaqueCoverGroups(place);
  const signs = {};
  for (const [id, item] of Object.entries(project.signs)) {
    const signature = textSignature(item, false, covered.has(`sign:${id}`));
    if (signature !== "standard") signs[id] = signature;
  }
  /* Свои надписи мест — только у работ, где они есть: прежние отпечатки те же. */
  const signPlaces = {};
  for (const [key, item] of Object.entries(project.signPlaces || {})) signPlaces[key] = textSignature(item, false, covered.has(`sign:${key.split("@")[0]}`));
  const emblems = emblemSignature(project.emblems, (item) => ({ asset: item.asset, point: item.point, normal: item.normal, size: item.size, opacity: item.opacity, angle: item.angle }));
  /* Щиты — только у работ с фото: прежние отпечатки не меняются. */
  const billboards = {};
  for (const [id, item] of Object.entries(project.billboards)) if (!billboardIsStock(item)) billboards[id] = { image: item.image.asset, fit: item.fit, background: item.background };
  /* Стены с картинкой — только у работ, где они есть: прежние отпечатки те же. */
  const walls = project.walls.map((item) => ({ id: item.id, asset: item.asset, point: item.point, normal: item.normal, angle: item.angle, metres: item.metres }));
  return JSON.stringify({
    place,
    parts,
    sides,
    title: buildingTitle(place) ? textSignature(project.title, true, covered.has("title")) : "standard",
    signs,
    ...(Object.keys(signPlaces).length ? { signPlaces } : {}),
    ...emblems,
    ...(walls.length ? { walls } : {}),
    ...(Object.keys(billboards).length ? { billboards } : {}),
    ...placeModelsSignatureField(project.models),
    /* Убранные вещи и облик вещей — только если они есть: у прежних работ отпечаток тот же. */
    ...(project.removed.length ? { removed: project.removed } : {}),
    ...(project.items.length ? { items: placeItemsSignature(project.items) } : {}),
  });
}

/** «Как было»: всё «Стандарт» (имя работы остаётся). */
export function resetBuildingProject(place, input) {
  const project = normalizeBuildingProject(place, input);
  return { ...createBuildingProject(place), name: project.name };
}

/**
 * Кнопка «Стандарт»: всё как в игре одним шагом. Тексты, цвета и картинки
 * помнятся — режимы становятся «Стандарт», эмблемы и надписи снимаются.
 */
export function applyBuildingStandard(place, input) {
  const project = normalizeBuildingProject(place, input);
  const parts = {};
  for (const id of BUILDING_PART_IDS) parts[id] = { ...project.parts[id], mode: FOLLOWS_BUILDING.includes(id) ? "building" : "standard" };
  const sides = {};
  for (const id of BUILDING_SIDE_IDS) sides[id] = { ...project.sides[id], mode: "standard" };
  const billboards = {};
  for (const [id, item] of Object.entries(project.billboards)) billboards[id] = { ...item, mode: "standard" };
  const signs = {};
  for (const [id, item] of Object.entries(project.signs)) signs[id] = { ...item, mode: "standard" };
  return {
    ...project,
    building: { ...project.building, mode: "standard" },
    parts,
    sides,
    billboards,
    title: { ...project.title, mode: "standard" },
    signs,
    signPlaces: {},
    emblems: [],
    walls: [],
    /* «Стандарт» — всё как в игре: и убранные вещи, и облик вещей снимаются. */
    removed: [],
    items: [],
  };
}

/* Код для друга: свои картинки живут в окне автора и в код не едут. */
export function shareableBuildingProject(place, input) {
  const project = normalizeBuildingProject(place, input);
  const sides = {};
  for (const [id, item] of Object.entries(project.sides))
    sides[id] = item.mode === "banner" ? { ...item, mode: "standard", image: { asset: "", name: "", width: 0, height: 0 } } : item;
  const strip = (item) => (item.mode === "image" ? { ...item, mode: "standard", image: { ...item.image, asset: null, name: "" } } : item);
  const parts = {};
  for (const [id, item] of Object.entries(project.parts)) parts[id] = strip(item);
  const billboards = {};
  for (const [id, item] of Object.entries(project.billboards)) billboards[id] = { ...item, mode: "standard", image: { asset: "", name: "", width: 0, height: 0 } };
  return withoutOwnFonts({
    ...project,
    building: strip(project.building),
    parts,
    sides,
    billboards,
    emblems: shareableEmblems(project.emblems),
    /* Картинка стены — своя картинка автора: в код она не едет. */
    walls: [],
    models: [],
    items: [],
  });
}

export function buildingLostInCode(place, input) {
  const project = normalizeBuildingProject(place, input);
  const lost =
    emblemsLostInCode(project.emblems) ||
    project.walls.length > 0 ||
    Object.values(project.sides).some((item) => item.mode === "banner" && item.image.asset) ||
    Object.values(project.billboards).some((item) => !billboardIsStock(item)) ||
    [project.building, ...Object.values(project.parts)].some((item) => item.mode === "image" && item.image?.asset);
  return joinLostInCode(
    lost ? "свои картинки (остаются на этом компьютере)" : "",
    buildingFontAssets({ ...project, emblems: [] }).length ? "свой шрифт (остаётся на этом компьютере)" : "",
    placeModelsLostInCode(project.models),
    project.items.length ? "свои модели, цвета и картинки вещей (остаются на этом компьютере)" : "",
  );
}

/* ------------------------------------------------------------------ *
 * Плашки в мире
 * ------------------------------------------------------------------ */

/** Начало сцены места в мире: место в кадре + начало = место в игре. */
export const buildingOrigin = (place) => placeOf(place)?.origin || [0, 0, 0];

/** Дальность плашек — как у основной модели: пропадают вместе со зданием. */
export const buildingPlateLodDist = (place) => Math.max(60, Math.min(2000, placeOf(place)?.lodDist || 150));

/**
 * Сторона-наклейка для кадра и плашки: `{ point, normal, width, height,
 * opacity }` в метрах сцены или `null`, если сторона «Стандарт».
 */
export function buildingSideDecal(input, place, id) {
  const project = normalizeBuildingProject(place, input);
  const side = buildingSide(place, id);
  const item = project.sides[id];
  if (!side || sideIsStock(item)) return null;
  return { point: side.point, normal: side.normal, width: side.width, height: side.height, angle: 0, opacity: item.opacity / 100 };
}

/**
 * Панели широкой стены: `{ count, width, height, panels: [{ index, key, name,
 * s0, s1 }] }` (`s0`…`s1` — доли ширины стороны слева направо, глядя на неё) или
 * `null`, если стена уже 30 м или у стороны своя рамка баннера (уступ).
 */
export function buildingSidePanels(place, id) {
  const side = buildingSide(place, id);
  if (!side || side.banner || side.width < BUILDING_PANELS_FROM_METRES) return null;
  const count = Math.min(BUILDING_PANEL_MAX, Math.max(2, Math.round(side.width / BUILDING_PANEL_METRES)));
  const names = buildingPlateNames(place);
  return {
    count,
    width: Math.round((side.width / count) * 1000) / 1000,
    height: side.height,
    panels: Array.from({ length: count }, (_, index) => ({ index, key: `side:${id}:${index + 1}`, name: names.sidePanel(id, index), s0: index / count, s1: (index + 1) / count })),
  };
}

/** Ложится ли баннер этой стороны панелями: своя картинка шире `BUILDING_PANEL_FROM_PIXELS`, и стена делится. */
export function buildingSideUsesPanels(input, place, id) {
  const project = normalizeBuildingProject(place, input);
  const item = project.sides[id];
  return Boolean(item?.mode === "banner" && item.image.asset && item.image.width > BUILDING_PANEL_FROM_PIXELS && buildingSidePanels(place, id));
}

/**
 * Размер листа панели: степени двойки по пропорции куска стены, длинная
 * сторона — `BUILDING_PANEL_PLATE_SIDE`, короткая — не больше нужной (вниз до
 * степени двойки: пикселей не больше, чем у холста студии).
 */
export function buildingPanelPlateSize(place, id) {
  const panels = buildingSidePanels(place, id);
  if (!panels) return null;
  const powerOfTwo = (value) => 2 ** Math.floor(Math.log2(Math.max(1, value)));
  const aspect = panels.width / Math.max(0.01, panels.height);
  const longest = BUILDING_PANEL_PLATE_SIDE;
  return aspect >= 1 ? [longest, Math.min(longest, Math.max(64, powerOfTwo(longest / aspect)))] : [Math.min(longest, Math.max(64, powerOfTwo(longest * aspect))), longest];
}

/**
 * Декали панелей стороны для кадра и плашек: `[{ key, name, point, normal,
 * width, height, angle, opacity, s0, s1 }]` в метрах сцены; пусто, если баннер
 * ложится одной плашкой.
 */
export function buildingSidePanelDecals(input, place, id) {
  if (!buildingSideUsesPanels(input, place, id)) return [];
  const project = normalizeBuildingProject(place, input);
  const side = buildingSide(place, id);
  const layout = buildingSidePanels(place, id);
  const n = side.normal;
  const right = [-n[1], n[0], 0];
  return layout.panels.map((panel) => {
    /* Шов — только между панелями: крайние панели у углов не удлиняются. */
    const before = panel.index > 0 ? BUILDING_PANEL_SEAM : 0;
    const after = panel.index < layout.count - 1 ? BUILDING_PANEL_SEAM : 0;
    const shift = ((panel.s0 + panel.s1) / 2 - 0.5) * side.width + (after - before) / 2;
    /* В десятки микрометров, не в миллиметр: плоскости соседних панелей совпадают (см. `buildingPlates`). */
    const point = side.point.map((value, axis) => Math.round((value + right[axis] * shift) * 1e5) / 1e5);
    return { ...panel, point, normal: side.normal, width: Math.round((side.width / layout.count + before + after) * 1e5) / 1e5, height: side.height, angle: 0, opacity: project.sides[id].opacity / 100 };
  });
}

/**
 * Сторона щита на крыше со своим фото — для кадра и плашки: `{ point, normal,
 * width, height, angle, opacity }` в метрах сцены или `null` («Стандарт»).
 */
export function buildingBillboardDecal(input, place, id) {
  const project = normalizeBuildingProject(place, input);
  const board = buildingBillboard(place, id);
  if (!board || billboardIsStock(project.billboards[id])) return null;
  return { point: board.point, normal: board.normal, width: board.width, height: board.height, angle: 0, opacity: 1 };
}

/* Отступ плашки щита от грани, м: стороны щита стоят в 16 см спиной друг к другу. */
export const BUILDING_BILLBOARD_OFFSET = 0.04;
/* Плашка поверх объёмных букв — перед плашкой стороны (см. `buildingPlates`). */
export const BUILDING_COVER_OFFSET = 0.06;
/* Дальше этого перед плоскостью плашки (м) место букв стоит впереди плашки стороны: дыры в ней нет (`buildingSidePrints`). */
export const BUILDING_COVER_BEHIND = 0.05;

/**
 * Надпись и таблички, что стоят на стене стороны, — для печати поверх её
 * плашки: `[{ group, regionIndex, islandIndex, island, texture, rect }]`,
 * `rect` — `[s0, t0, s1, t1]` долями плашки (t сверху вниз). Место на
 * стене стороны — грань смотрит туда же, лежит у её плоскости (до 1 м за
 * плашкой) и в её прямоугольнике; кусочки букв (место меньше пятой части
 * самого крупного места своего острова) не печатаются. Убранные надпись и
 * таблички — тоже.
 */
export function buildingSidePrints(input, place, id) {
  const project = normalizeBuildingProject(place, input);
  const side = buildingSide(place, id);
  const item = project.sides[id];
  if (!side || sideIsStock(item) || item.signs === false) return [];
  const n = side.normal;
  const right = [-n[1], n[0], 0];
  const out = [];
  /* Разошедшиеся источники рисуют свои плашки перед плашкой стороны —
     печатать их места на стороне незачем. */
  const plans = new Map(textSourcePlans(project, place).map((plan) => [plan.key, plan]));
  const settingsOf = (key, fallback) => {
    const plan = plans.get(key);
    if (!plan) return fallback;
    return plan.mode === "atlas" ? plan.settings[0] : "split";
  };
  const groups = [
    ["title", settingsOf("title", project.title), buildingTitle(place)?.kind === "islands" ? buildingTitle(place).regions : []],
    ...buildingSigns(place).map((sign) => [`sign:${sign.id}`, settingsOf(`sign:${sign.id}`, project.signs[sign.id]), sign.regions]),
  ];
  for (const [group, settings, regions] of groups) {
    if (settings === "split" || settings?.mode === "hidden") continue;
    (regions || []).forEach((region, regionIndex) => {
      /* Самое крупное место каждого острова — мерка: место меньше пятой его
         части — кусочек букв, а не табличка. */
      const largest = new Map();
      for (const spot of region.places || []) largest.set(spot.island, Math.max(largest.get(spot.island) || 0, spot.width * spot.height));
      for (const spot of region.places || []) {
        if (spot.normal[0] * n[0] + spot.normal[1] * n[1] + spot.normal[2] * n[2] < 0.9) continue;
        const d = [0, 1, 2].map((axis) => spot.point[axis] - side.point[axis]);
        const depth = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
        if (depth < -1 || depth > 0.5) continue;
        const island = region.islands[spot.island] || region.islands[0];
        if (!island || spot.width < 0.8 || spot.height < 0.3) continue;
        if (spot.width * spot.height < (largest.get(spot.island) || 0) * 0.2) continue;
        const s = (d[0] * right[0] + d[1] * right[1]) / side.width + 0.5;
        const t = d[2] / side.height + 0.5;
        const halfW = spot.width / side.width / 2;
        const halfH = spot.height / side.height / 2;
        const rect = [s - halfW, 1 - (t + halfH), s + halfW, 1 - (t - halfH)];
        if (rect[2] <= 0 || rect[0] >= 1 || rect[3] <= 0 || rect[1] >= 1) continue;
        out.push({ group, regionIndex, islandIndex: region.islands.indexOf(island), island, texture: region.texture, rect: rect.map((value) => Math.round(value * 10000) / 10000) });
      }
    });
  }
  /* Объёмные буквы у плоскости стены (за плашкой стороны) — дыра в плашке:
     сквозь неё видны буквы игры или своя плашка поверх них. Буквы перед
     плашкой (рамка над входом выступает на 2 м) видны и так. DAVIS MEGA MALL
     стоят в 14…31 см перед стеной, плашка — в 6: дыры у них нет, плашка идёт
     и под буквами, и подложка под надписью красится вместе со стороной (ТЗ
     29.10.2026: через дыру светилась штатная стена — бирюзовая или цвета «Стен»). */
  for (const cover of buildingCovers(place)) {
    /* Убранные из модели буквы (`erase`): за плашкой стороны их больше нет. */
    if (cover.erase && !textIsStock(textOfGroup(project, cover.group))) continue;
    if (cover.normal[0] * n[0] + cover.normal[1] * n[1] + cover.normal[2] * n[2] < 0.9) continue;
    const d = [0, 1, 2].map((axis) => cover.point[axis] - side.point[axis]);
    const depth = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (depth < -1 || depth > BUILDING_COVER_BEHIND) continue;
    const rect = coverRectOnSide(cover, side);
    if (rect[2] <= 0 || rect[0] >= 1 || rect[3] <= 0 || rect[1] >= 1) continue;
    out.push({ group: cover.group, hole: true, rect: rect.map((value) => Math.round(value * 10000) / 10000) });
  }
  return out;
}

/* Рамка объёмных букв на плашке стороны: `[s0, t0, s1, t1]` долями плашки (t сверху вниз). */
function coverRectOnSide(cover, side) {
  const n = side.normal;
  const right = [-n[1], n[0], 0];
  const d = [0, 1, 2].map((axis) => cover.point[axis] - side.point[axis]);
  const s = (d[0] * right[0] + d[1] * right[1]) / side.width + 0.5;
  const t = d[2] / side.height + 0.5;
  const halfW = cover.width / side.width / 2;
  const halfH = cover.height / side.height / 2;
  return [s - halfW, 1 - (t + halfH), s + halfW, 1 - (t - halfH)];
}

/**
 * Рамка объёмных букв `cover` на листе плашки стороны `id` — для проверок подложки под надписью: `[s0, t0, s1, t1]` долями плашки
 * (t сверху вниз) или `null`, если стороны нет.
 */
export function buildingCoverRect(place, id, cover) {
  const side = buildingSide(place, id);
  return side ? coverRectOnSide(cover, side).map((value) => Math.round(value * 10000) / 10000) : null;
}

/**
 * Стены со своей картинкой для кадра, плашек и дальних планов: `[{ id, key, asset, point,
 * normal, width, height, angle, opacity }]` в метрах сцены, по порядку списка.
 */
export const buildingWallDecals = (input, place) => normalizeBuildingProject(place, input).walls.map(buildingWallDecal);

/**
 * Эмблемы и надписи работы для кадра и плашек: `[{ id, kind, asset, point,
 * normal, width, height, opacity, angle }]` в метрах сцены — готовые (с
 * картинкой), по порядку списка.
 */
export function buildingEmblemDecals(input, place) {
  const project = normalizeBuildingProject(place, input);
  return readyEmblems(project.emblems).map((item) => emblemDecal(item, { kind: item.kind }));
}

/* Отступ плашки эмблемы от стены, м: перед плашкой стороны (6 см) и мест
   надписей (9 см); каждая следующая — на сантиметр дальше. */
export const buildingEmblemOffset = (index) => Math.round((0.12 + index * 0.01) * 1000) / 1000;

/**
 * Плашки работы в мире — для `compile-emblem-plates`: `[{ key, name,
 * position, rotation, size, lodDist, opacity }]`. `key` — чья картинка
 * (`side:<id>`, `logo:<n>`, `title`); `aspect` надписи-плашки — пропорция
 * её картинки (её рисует окно).
 */
export function buildingPlates(input, place, { titleAspect = 4 } = {}) {
  const project = normalizeBuildingProject(place, input);
  const origin = buildingOrigin(place);
  const names = buildingPlateNames(place);
  const lodDist = buildingPlateLodDist(place);
  const out = [];
  const add = (key, name, decal, offset, extra = null) => {
    const placed = decalPlacement(decal, { offset });
    /* Плашки сторон — в десятки микрометров, остальные — в миллиметр: соседние панели стены лежат в одной плоскости с точностью до
       0,01 мм, и заход панелей в 4 мм перекрывает щель при любом взгляде вдоль стены (при миллиметре плоскости расходились на 0,8 мм,
       и под взглядом 13 : 1 край одной панели проскакивал мимо края другой). */
    const scale = key.startsWith("side:") ? 1e5 : 1000;
    out.push({
      key,
      name,
      position: placed.position.map((value, axis) => Math.round((value + origin[axis]) * scale) / scale),
      rotation: placed.rotation,
      size: placed.size,
      lodDist,
      opacity: decal.opacity ?? 1,
      ...(extra || {}),
    });
  };
  for (const id of BUILDING_SIDE_IDS) {
    /* Широкая стена с картинкой выше 2048 px — панелями, каждая своей плашкой (задача 6Б). */
    const panels = buildingSidePanelDecals(project, place, id);
    if (panels.length) {
      for (const panel of panels) add(panel.key, panel.name, panel, 0);
      continue;
    }
    const decal = buildingSideDecal(project, place, id);
    if (decal) add(`side:${id}`, names.side(id), decal, 0);
  }
  /* Щиты на крыше: имя плашки — по месту щита в описи (не по порядку фото). */
  buildingBillboards(place).forEach((board, index) => {
    const decal = buildingBillboardDecal(project, place, board.id);
    if (decal) add(`billboard:${board.id}`, names.billboard(index), decal, BUILDING_BILLBOARD_OFFSET);
  });
  const title = buildingTitle(place);
  if (title?.kind === "plate" && !textIsStock(project.title) && project.title.mode === "text") {
    const height = project.title.size;
    add("title", names.title, { point: project.title.point, normal: project.title.normal, width: Math.round(height * titleAspect * 100) / 100, height, angle: 0, opacity: 1 }, 0.1);
  }
  /* Плашки поверх объёмных букв: место описи уже на 3 см перед буквами, и
     ещё 6 см — перед плашкой стороны. Иначе покрашенная сторона закрывала
     их: в игре «ВХОД» You Tool был виден только с краю, где плоскости плашек
     расходятся на сантиметр (проверка в игре 05.10.2026). */
  for (const job of buildingCoverJobs(project, place)) add(job.key, names.cover(job.cover.index), { ...job.cover, angle: 0, opacity: 1 }, BUILDING_COVER_OFFSET);
  /* Места разошедшихся надписей и табличек: на 9 см перед гранью — перед
     плашкой стороны (6 см), чтобы покрашенная сторона их не закрывала. */
  buildingTextPlates(project, place).forEach((mark, index) =>
    add(mark.key, names.mark(index), { point: mark.point, normal: mark.normal, width: mark.width, height: mark.height, angle: 0, opacity: 1 }, 0.09),
  );
  /* Своя картинка у стены: плашка прилегает к стене (`hug`) — детали, что стоят перед ней, остаются перед плашкой. */
  project.walls.forEach((wall, index) => {
    add(`wall:${wall.id}`, names.wall(index), buildingWallDecal(wall), buildingWallOffset(index), { hug: true });
    out[out.length - 1].asset = wall.asset;
  });
  /* Эмблемы и надписи — плашками под именами прежних логотипов. */
  buildingEmblemDecals(project, place)
    .slice(0, BUILDING_LOGO_COUNT)
    .forEach((decal, index) => {
      add(`emblem:${decal.id}`, names.logo(index), decal, buildingEmblemOffset(index));
      out[out.length - 1].asset = decal.asset;
    });
  return out;
}

/**
 * Плашки поверх объёмных букв, что нужны работе: `[{ key, group, cover,
 * settings, hidden, erase, lines, aspect }]`. Свой текст — буквами на
 * плашке цветом (плашка непрозрачна: она закрывает буквы игры), «Убрать» —
 * плашка одним цветом. У букв, что уходят из модели (`erase`), плашка —
 * буквы человека с фоном на его выбор, а «Убрать» плашки не ставит.
 * Картинку плашки рисует окно (`key`).
 */
export function buildingCoverJobs(input, place) {
  const project = normalizeBuildingProject(place, input);
  const jobs = [];
  for (const cover of buildingCovers(place)) {
    const settings = textOfGroup(project, cover.group);
    if (!settings || textIsStock(settings)) continue;
    if (cover.erase && settings.mode === "hidden") continue;
    const sign = cover.group === "title" ? buildingTitle(place) : buildingSigns(place).find((item) => `sign:${item.id}` === cover.group);
    jobs.push({
      key: cover.key,
      group: cover.group,
      cover,
      settings,
      hidden: settings.mode === "hidden",
      erase: Boolean(cover.erase),
      lines: sign?.lines || 1,
      aspect: Math.round((cover.width / Math.max(0.1, cover.height)) * 1000) / 1000,
    });
  }
  return jobs;
}

/**
 * Лежит ли объёмная надпись `cover` на стороне `side` перед её плашкой: смотрит туда же, стоит у плоскости стены (до метра
 * за плашкой и до полуметра перед ней) и попадает в её прямоугольник.
 */
function coverOnSide(cover, side) {
  const n = side.normal;
  if (cover.normal[0] * n[0] + cover.normal[1] * n[1] + cover.normal[2] * n[2] < 0.9) return false;
  const d = [0, 1, 2].map((axis) => cover.point[axis] - side.point[axis]);
  const depth = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  if (depth < -1 || depth > 0.5) return false;
  const right = [-n[1], n[0], 0];
  const along = d[0] * right[0] + d[1] * right[1];
  return Math.abs(along) < (side.width + cover.width) / 2 && Math.abs(d[2]) < (side.height + cover.height) / 2;
}

/**
 * Баннер — чистое полотно (ТЗ 26.10.2026, Хелпер 19): плашка стороны лежит вплотную к стене (6 см), и объёмные буквы игры
 * на ней (DAVIS MEGA MALL, 14…31 см перед стеной) стояли бы поверх картинки. Раньше плашку выносили вперёд перед ними
 * (до 76 см) — картинка парила, и на углах оставалась щель. Теперь у стороны со своей картинкой, у которой «надпись и
 * таблички поверх» выключено, буквы уходят из модели; включил — буквы остаются, как в игре.
 */
function coverUnderBanner(project, place, cover) {
  return BUILDING_SIDE_IDS.some((id) => {
    const item = project.sides[id];
    const side = buildingSide(place, id);
    return Boolean(side) && item.mode === "banner" && Boolean(item.image.asset) && item.signs === false && coverOnSide(cover, side);
  });
}

/**
 * Объёмные буквы, что работа убирает из моделей игры: `[{ key, group,
 * cover, erase }]` — у мест `erase` со своим текстом или «Убрать», а также
 * под баннером стороны без вывесок поверх (`coverUnderBanner`).
 */
export function buildingCoverErasures(input, place) {
  const project = normalizeBuildingProject(place, input);
  return buildingCovers(place)
    .filter((cover) => cover.erase && (!textIsStock(textOfGroup(project, cover.group) || { mode: "standard" }) || coverUnderBanner(project, place, cover)))
    .map((cover) => ({ key: cover.key, group: cover.group, cover, erase: cover.erase }));
}

/** Убирает ли работа объёмные буквы группы (`title`, `sign:<id>`) из модели. */
export function buildingGroupErased(input, place, group) {
  return buildingCoverErasures(input, place).some((item) => item.group === group);
}

/**
 * Рейки крепления штатных букв (DAVIS MEGA MALL), что уходят из модели, пока буквы остаются на покрашенной стороне (ТЗ 29.10.2026): плашка
 * стороны лежит вплотную (6 см), а рейки — грани листа стены в 1,5…12,5 см перед стеной (`erase.also` с `maxHeight`) — торчат перед ней штатным
 * цветом стены и светят сквозь просветы между буквами: подложка под надписью красилась бы не вся. Вместе с буквами рейки уходят и так
 * (`buildingCoverErasures`) — здесь только те места, где буквы остаются. `[{ key, group, cover, erase }]`.
 */
export function buildingCoverRails(input, place) {
  const project = normalizeBuildingProject(place, input);
  const erased = new Set(buildingCoverErasures(project, place).map((item) => item.key));
  return buildingCovers(place)
    .filter((cover) => cover.erase?.also?.some((extra) => extra.maxHeight) && !erased.has(cover.key))
    .filter((cover) =>
      BUILDING_SIDE_IDS.some((id) => {
        const side = buildingSide(place, id);
        return Boolean(side) && !sideIsStock(project.sides[id]) && coverOnSide(cover, side);
      }),
    )
    .map((cover) => ({ key: cover.key, group: cover.group, cover, erase: cover.erase }));
}

/** Картинки работы (ключи хранилища окна) — что уедет главному процессу. */
export function buildingImageAssets(input, place) {
  const project = normalizeBuildingProject(place, input);
  const out = {};
  for (const id of BUILDING_SIDE_IDS) {
    const item = project.sides[id];
    if (item.mode === "banner" && item.image.asset && buildingSide(place, id)) out[`side:${id}`] = item.image.asset;
  }
  for (const [id, item] of Object.entries(project.billboards)) if (!billboardIsStock(item)) out[`billboard:${id}`] = item.image.asset;
  const emblems = emblemAssets(project.emblems);
  if (emblems.length) out.emblems = emblems;
  /* Картинки стен — до 2048 px (лист плашки), не эмблемы: у эмблем потолок 1024. */
  const walls = [...new Set(project.walls.map((item) => item.asset))];
  if (walls.length) out.walls = walls;
  return out;
}

/** Тексты, что окно рисует картинкой: надпись и таблички со своим текстом. */
export function buildingTextJobs(input, place) {
  const project = normalizeBuildingProject(place, input);
  const jobs = [];
  /* Источник, разошедшийся по плашкам, в остров листа текста не пишет —
     его места рисуют плашки (`buildingTextPlates`). */
  const plans = new Map(textSourcePlans(project, place).map((plan) => [plan.key, plan]));
  const settingsOf = (key, fallback) => {
    const plan = plans.get(key);
    if (!plan) return fallback;
    return plan.mode === "atlas" ? plan.settings[0] : null;
  };
  const title = buildingTitle(place);
  const titleSettings = settingsOf(TITLE_TARGET, project.title);
  if (title && titleSettings?.mode === "text" && hasText(titleSettings)) jobs.push({ key: "title", settings: titleSettings, regions: title.regions || [] });
  for (const sign of buildingSigns(place)) {
    const item = settingsOf(`sign:${sign.id}`, project.signs[sign.id]);
    if (item?.mode === "text" && hasText(item)) jobs.push({ key: `sign:${sign.id}`, settings: item, regions: sign.regions || [], lines: sign.lines || 1, vertical: Boolean(sign.vertical) });
  }
  return jobs;
}

/*
 * Слова строки на языке окна подставляет вызывающий: пакет своих языков не знает (`words`).
 *   say(шаблон, ...вставки) — перевод шаблона с `{0}` и подстановка;
 *   name(слово)             — перевод названия части, стороны, таблички;
 *   lower(слово, первая)    — слово с маленькой буквы в середине фразы: всё слово или (`первая`) только первая буква, остальное как есть
 *                             («буквы DAVIS MEGA MALL»); у немецкого существительные остаются с большой.
 * По умолчанию — русский, как был.
 */
const planFill = (text, ...values) => text.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));

/** Строка того, что уедет в игру, — под кадром. */
export function buildingPlanText(input, place, words = {}) {
  const say = words.say || planFill;
  const name = words.name || ((text) => text);
  const lower = words.lower || ((text, first = false) => (first ? text.charAt(0).toLowerCase() + text.slice(1) : text.toLowerCase()));
  const project = normalizeBuildingProject(place, input);
  const label = name(buildingInventory(place)?.title || place);
  if (buildingProjectIsStock(place, project)) return say("{0}: здание как в игре — файлы Astral снимаются, ставить нечего.", label);
  const changed = [];
  const parts = BUILDING_PART_IDS.filter((id) => !surfaceIsStock(buildingPartSettings(project, place, id)));
  if (parts.length) changed.push(parts.map((id) => lower(name(BUILDING_PARTS.find((part) => part.id === id).label))).join(", "));
  const sides = BUILDING_SIDE_IDS.filter((id) => buildingSide(place, id) && !sideIsStock(project.sides[id]));
  if (sides.length) changed.push(say("стороны: {0}", sides.map((id) => lower(name(buildingSide(place, id).label))).join(", ")));
  const boards = Object.values(project.billboards).filter((item) => !billboardIsStock(item)).length;
  if (boards) changed.push(say("фото на щитах крыши ({0})", boards));
  if (buildingTitle(place) && !textIsStock(project.title)) changed.push(say("надпись"));
  /* Буквы названия (DAVIS MEGA MALL) — своим словом, остальное — таблички по местам. */
  const letters = buildingSigns(place).filter((sign) => sign.tool === "title");
  for (const sign of letters) if (project.signs[sign.id] && !textIsStock(project.signs[sign.id])) changed.push(lower(name(sign.label), true));
  const signs = Object.entries(project.signs).filter(([id, item]) => !letters.some((sign) => sign.id === id) && !textIsStock(item)).length;
  if (signs) changed.push(say("таблички ({0})", signs));
  const ready = readyEmblems(project.emblems);
  const images = ready.filter((item) => item.kind !== "text").length;
  const texts = ready.length - images;
  if (images) changed.push(say("эмблемы ({0})", images));
  if (texts) changed.push(say("надписи ({0})", texts));
  if (project.walls.length) changed.push(say("картинки на стенах ({0})", project.walls.length));
  return say("{0}: штатное здание игры и свой облик — {1}.", label, changed.join("; "));
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const colourOf = (colour, extra = {}) => ({ mode: "colour", look: { mode: "solid", colour, ...extra } });
const effectOf = (look) => ({ mode: "colour", look });
const textOf = (lines, extra = {}) => ({ mode: "text", lines: Array.isArray(lines) ? lines : [lines], ...extra });

/*
 * Готовые виды мест. Вид — частичная работа: что не названо, остаётся
 * «Стандарт» (вид начинается с чистого здания, имя работы помнится).
 */
const PRESETS = Object.freeze({
  megamall: Object.freeze([
    Object.freeze({ id: "standard", label: "Как в игре", description: "Штатный Davis Mega Mall", project: {} }),
    Object.freeze({
      id: "renovated",
      label: "Свежий ремонт",
      description: "Светлые стены, тёмный металл, бирюзовые навесы",
      project: { building: colourOf("#e6ddcc"), parts: { trim: colourOf("#2b2f36"), awnings: colourOf("#1b8a8f"), roof: colourOf("#6b6f76") } },
    }),
    Object.freeze({
      id: "neon",
      label: "Неоновая ночь",
      description: "Тёмный корпус и надпись неоном",
      project: {
        building: colourOf("#23252d"),
        parts: { awnings: colourOf("#7a1fa2") },
        title: textOf("MEGA MALL", { style: "neon", colour: "#ff3fa4", font: "wide" }),
        signs: { entrance: textOf("ENTRANCE", { style: "neon", colour: "#36e2ff", font: "modern", background: "colour", backgroundColour: "#101018" }) },
      },
    }),
    Object.freeze({
      id: "brick",
      label: "Красный кирпич",
      description: "Кирпичный корпус, кремовые навесы",
      project: { parts: { walls: colourOf("#9c4430"), trim: colourOf("#3a2a24"), awnings: colourOf("#e9dcc0") } },
    }),
    Object.freeze({
      id: "blue-banners",
      label: "Синий фасад",
      description: "Стороны градиентом поверх рельефа стены",
      project: {
        sides: {
          front: effectOf({ mode: "gradient", colour: "#1f3a93", colour2: "#2f80ed", direction: "along" }),
          rear: effectOf({ mode: "gradient", colour: "#2f80ed", colour2: "#1f3a93", direction: "along" }),
        },
        parts: { awnings: colourOf("#f2f2f2") },
      },
    }),
    Object.freeze({
      id: "rainbow",
      label: "Радужный молл",
      description: "Все четыре стороны радугой",
      project: {
        sides: Object.fromEntries(["front", "right", "rear", "left"].map((id, index) => [id, effectOf({ mode: "rainbow", colour: "#ff0000", direction: "along", shift: index * 90 })])),
        title: textOf("MEGA MALL", { style: "classic", colour: "#ffffff", outline: "#202020" }),
      },
    }),
    Object.freeze({
      id: "black-gold",
      label: "Чёрное золото",
      description: "Чёрный корпус и золотая надпись",
      project: {
        building: colourOf("#1b1b1d"),
        parts: { trim: colourOf("#c9a227"), awnings: colourOf("#c9a227") },
        title: textOf("MEGA MALL", { style: "classic", colour: "#e8c25a", outline: "#2a2008", font: "serif" }),
      },
    }),
  ]),
  /*
   * «Ашан / Икея» — гипермаркеты в фирменных цветах: название поверх букв
   * YOU TOOL (над входом и на пилоне), фирменные стены, флаги и таблички
   * по-русски. Логотипов в видах нет — свои картинки ставит человек.
   */
  youtool: Object.freeze([
    Object.freeze({ id: "standard", label: "Как в игре", description: "Штатный You Tool", project: {} }),
    Object.freeze({
      id: "ashan",
      label: "Ашан",
      description: "Белый корпус, красные рамы и название",
      project: youtoolBrand({ name: "АШАН", walls: "#f2f2f2", accent: "#e30613", trim: "#f2f2f2", letters: "#e30613", plate: "#ffffff", signs: ["#e30613", "#ffffff"], font: "wide" }),
    }),
    Object.freeze({
      id: "ikea",
      label: "Икея",
      description: "Синий корпус, жёлтое название",
      project: youtoolBrand({ name: "IKEA", walls: "#0058a3", accent: "#0058a3", trim: "#ffda1a", letters: "#0058a3", plate: "#ffda1a", signs: ["#ffda1a", "#0058a3"], font: "wide" }),
    }),
    Object.freeze({
      id: "leroy",
      label: "Леруа Мерлен",
      description: "Светлый корпус, зелёные рамы",
      project: youtoolBrand({ name: ["ЛЕРУА", "МЕРЛЕН"], walls: "#e6e6e3", accent: "#6ab023", trim: "#3d4046", letters: "#ffffff", plate: "#6ab023", signs: ["#6ab023", "#ffffff"], font: "modern" }),
    }),
    Object.freeze({
      id: "obi",
      label: "OBI",
      description: "Оранжевые рамы, белое название",
      project: youtoolBrand({ name: "OBI", walls: "#e9e9e9", accent: "#ff7d00", trim: "#3a3f47", letters: "#ffffff", plate: "#ff7d00", signs: ["#ff7d00", "#ffffff"], font: "block" }),
    }),
    Object.freeze({
      id: "metro",
      label: "METRO",
      description: "Тёмно-синий корпус и жёлтые рамы",
      project: youtoolBrand({ name: "METRO", walls: "#002d72", accent: "#ffe500", trim: "#ffe500", letters: "#002d72", plate: "#ffe500", signs: ["#002d72", "#ffe500"], font: "wide" }),
    }),
    Object.freeze({
      id: "castorama",
      label: "Castorama",
      description: "Белый корпус, синие рамы",
      project: youtoolBrand({ name: "CASTORAMA", walls: "#f4f4f4", accent: "#0078d7", trim: "#0078d7", letters: "#ffffff", plate: "#0078d7", signs: ["#0078d7", "#ffffff"], font: "modern" }),
    }),
  ]),
});

/*
 * Вид гипермаркета: стены, фирменные стены и отделка своими цветами,
 * название поверх букв YOU TOOL (`letters` — цвет букв, `plate` — плашки),
 * буквы над входом — «ВХОД», таблички парковки по-русски, флаги с названием.
 */
function youtoolBrand({ name, walls, accent, trim, letters, plate, signs: [signPlate, signLetters], font }) {
  const lines = Array.isArray(name) ? name : [name];
  const flat = (text, colour, backgroundColour, extra = {}) => textOf(text, { style: "flat", font, colour, outline: colour, background: "colour", backgroundColour, ...extra });
  return {
    parts: { walls: colourOf(walls), accent: colourOf(accent), trim: colourOf(trim) },
    title: flat(lines, letters, plate),
    signs: {
      letters: flat("ВХОД", letters, plate),
      entrance: flat("ВХОД", signLetters, signPlate),
      exit: flat("ВЫХОД", signLetters, signPlate),
      staff: flat("ПАРКОВКА ПЕРСОНАЛА", signLetters, signPlate),
      "keep-clear": flat("НЕ ЗАГОРАЖИВАТЬ", signLetters, signPlate),
      carts: flat("ТЕЛЕЖКИ", signLetters, signPlate),
      flags: flat(lines.join(" "), letters, plate),
    },
  };
}

/** Готовые виды места: `[{ id, label, description }]`. */
export const buildingPresets = (place) => PRESETS[place] || [];

/** Работа в облике вида: вид кладётся на чистое здание, имя остаётся. */
export function applyBuildingPreset(place, input, presetId) {
  const project = normalizeBuildingProject(place, input);
  const preset = buildingPresets(place).find((item) => item.id === presetId);
  if (!preset) return project;
  const base = createBuildingProject(place);
  const patch = preset.project || {};
  const merge = (target, source) => {
    const out = { ...target };
    for (const [key, value] of Object.entries(source || {})) out[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...(target?.[key] || {}), ...value } : value;
    return out;
  };
  const next = {
    ...base,
    name: project.name,
    building: merge(base.building, patch.building),
    parts: Object.fromEntries(Object.entries(base.parts).map(([id, part]) => [id, merge(part, patch.parts?.[id])])),
    sides: Object.fromEntries(Object.entries(base.sides).map(([id, side]) => [id, merge(side, patch.sides?.[id])])),
    title: merge(base.title, patch.title),
    signs: Object.fromEntries(Object.entries(base.signs).map(([id, sign]) => [id, merge(sign, patch.signs?.[id])])),
    /* Свои эмблемы и надписи вид не трогает: они — человека, а не вида. */
    emblems: project.emblems,
  };
  return normalizeBuildingProject(place, next);
}

/** Вид, с которым работа совпадает (без эмблем и надписей), или `null`. */
export function matchingBuildingPreset(place, input) {
  const project = normalizeBuildingProject(place, input);
  const strip = (value) => {
    const { emblem: _emblem, emblems: _emblems, ...rest } = JSON.parse(buildingProjectSignature(place, value));
    return JSON.stringify(rest);
  };
  const signature = strip(project);
  return buildingPresets(place).find((preset) => strip(applyBuildingPreset(place, project, preset.id)) === signature)?.id || null;
}
