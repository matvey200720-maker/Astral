/*
 * «Интерьеры» снаружи — заправки и фасады магазинов (второй заход задачи 3
 * ТЗ 10.10.2026).
 *
 * Место «снаружи» — станция (скопление колонок игры) или магазин (экземпляр
 * помещения на карте). У места свои модели квартала — навес, киоск,
 * площадка, вывеска, фасад: их архетипы игра ставит только здесь (опись
 * `inventory/shops-outside.js`, `scripts/prepare-shop-outside.mjs`). Листы
 * своих моделей места — по частям:
 *   walls  — стены, колонны, фасад;
 *   roof   — навес над колонками, козырёк, крыша;
 *   ground — площадка, бордюры, ступени;
 *   signs  — вывески, логотипы, подсветка (листы со свечением и вывесок).
 * Облик части — как у стен помещения: «Стандарт», свой цвет (эффект
 * мастерской), «Без текстуры», узор, своя картинка, градиент.
 *
 * Облик места — один на вид мест («все заправки», «все 24/7 снаружи»:
 * `kinds[вид]`) или свой у места (`places[место]`, `own`). Колонки — свой
 * облик (корпус и табло): один на все станции (`pumps.all`). Свой облик
 * колонок у станции (копия модели колонки под своим именем) с 17.10.2026
 * не ставится: сервер заправки может узнавать колонку по модели, а одна
 * станция в работе тянула за собой копию на каждую. Станции в `pumps.stations`
 * прежних работ читаются и отбрасываются (`normalizeShopsOutside`).
 *
 * Эмблемы и надписи на фасадах и вывесках — общая система мест мастерской
 * (`emblems.js`): у каждой своё место (`location` — место снаружи), точка и
 * нормаль стены в координатах сцены места; в игре — своя плашка
 * (`compile-emblem-plates`) с типами, картой и манифестом набора.
 *
 * Названия заправок (17.10.2026, `names`) — плашки-вывески: надпись на
 * сплошном фоне цвета вывески (`text.backdrop`) и пропорций грани вывески
 * (`text.ratio`), стоят перед гранью вывески станции и закрывают старую
 * надпись целиком. Своим списком (до `OUTSIDE_NAME_LIMIT`), чтобы не делить
 * предел обычных эмблем; в игре — теми же плашками (`compile-emblem-plates`).
 *
 * Номера АЗС GTA5RP сервер не публикует: станции — все скопления колонок
 * игры, окно пишет это прямо.
 */

import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import { decalPlacement, normalizeDecalAngle } from "./decal.js";
import {
  EMBLEM_ASSET,
  EMBLEM_LIMIT,
  emblemAssets,
  emblemDecal,
  emblemPlateFiles,
  emblemPlateModels,
  emblemPlateName,
  emblemPlateOffset,
  emblemSignature,
  emblemsLostInCode,
  hasEmblems,
  normalizeEmblemList,
  readyEmblems,
  shareableEmblems,
} from "./emblems.js";
import { finishImageAssets, finishSignature, normalizeFinishFields } from "./finish.js";
import OUTSIDE from "./inventory/shops-outside.js";
import { SHOP_INTERIORS } from "./shops-catalog.js";

export const SHOPS_OUTSIDE_INVENTORY = OUTSIDE;

/* Части места снаружи — по листам своих моделей. */
export const OUTSIDE_PARTS = Object.freeze(
  [
    { id: "walls", label: "Стены", note: "Стены, колонны и фасад", colour: "#d8d2c4" },
    { id: "roof", label: "Навес и крыша", note: "Навес над колонками, козырёк и крыша", colour: "#efede8" },
    { id: "ground", label: "Площадка", note: "Площадка, бордюры и ступени у входа", colour: "#8a8178" },
    { id: "signs", label: "Вывески и подсветка", note: "Вывески, логотипы и световые полосы", colour: "#e30613" },
  ].map((item) => Object.freeze(item)),
);
export const OUTSIDE_PART_IDS = Object.freeze(OUTSIDE_PARTS.map((item) => item.id));

/* Части колонки: корпус (с ним — урны, воздух и стойка станции) и табло сверху. */
export const PUMP_PARTS = Object.freeze(
  [
    { id: "body", label: "Корпус", note: "Корпус колонки; урны, воздух и стойка станции — этим же обликом", colour: "#c9c4b8" },
    { id: "display", label: "Табло", note: "Табло с ценой и брендом сверху, светится ночью", colour: "#2f80ed" },
  ].map((item) => Object.freeze(item)),
);
export const PUMP_PART_IDS = Object.freeze(PUMP_PARTS.map((item) => item.id));

export const OUTSIDE_SURFACE_MODES = Object.freeze(["standard", "colour", "flat", "pattern", "image", "gradient"]);

/* Места описи: станции и магазины. */
export const SHOP_OUTSIDE_PLACES = Object.freeze(OUTSIDE.places);
const byId = new Map(SHOP_OUTSIDE_PLACES.map((place) => [place.id, place]));
export const shopOutsidePlace = (id) => byId.get(id) || null;
export const SHOP_PUMPS = Object.freeze(OUTSIDE.pumps);
export const shopPump = (id) => SHOP_PUMPS.find((pump) => pump.id === id || pump.model === id) || null;

/* Виды мест: заправки и помещения каталога, у которых есть места снаружи. */
export const OUTSIDE_KINDS = Object.freeze(["gas", ...SHOP_INTERIORS.map((item) => item.id).filter((id) => SHOP_OUTSIDE_PLACES.some((place) => place.kind === id))]);
export const outsidePlacesOf = (kind) => SHOP_OUTSIDE_PLACES.filter((place) => place.kind === kind);
export const outsideKindLabel = (kind) => (kind === "gas" ? "Заправки" : SHOP_INTERIORS.find((item) => item.id === kind)?.label || kind);
export const GAS_STATIONS = Object.freeze(outsidePlacesOf("gas"));

/* Бренды станций и магазинов — по листам их вывесок. */
export const OUTSIDE_BRANDS = Object.freeze({ xero: "Xero", ltd: "LTD", ron: "RON", globe: "Globe Oil", 247: "24/7" });

/* ------------------------------------------------------------------ *
 * Эмблемы и надписи на фасадах
 * ------------------------------------------------------------------ */

/* Плашки эмблем «Интерьеров»: имена набора — свои. */
export const SHOPS_PLATE = Object.freeze({ model: "astral_shops_emblem", types: "astral_shops_marks", map: "astral_shops_marks_map", lodDist: 200 });
export const shopsPlateFiles = (count = 1) => emblemPlateFiles(SHOPS_PLATE, count);
/* Названия заправок — до сорока плашек сверх шестнадцати эмблем и надписей. */
export const OUTSIDE_NAME_LIMIT = 40;
export const SHOPS_PLATE_LIMIT = EMBLEM_LIMIT + OUTSIDE_NAME_LIMIT;
/** Все файлы плашек, что набор вправе привезти (строгая проверка пакета). */
export const SHOPS_PLATE_NAMES = Object.freeze([...emblemPlateModels(SHOPS_PLATE.model, SHOPS_PLATE_LIMIT), ...emblemPlateFiles(SHOPS_PLATE, 1).filter((name) => !name.endsWith(".ydr"))]);
/* Высота эмблемы, м. */
export const OUTSIDE_EMBLEM_SIZE = Object.freeze([0.3, 12]);
const EMBLEM_SIZE_DEFAULT = 2;
/* Место новой эмблемы, пока её не поставили на стену: над серединой места. */
export const outsideDefaultDecal = () => ({ point: [0, 0, 3], normal: [0, -1, 0] });

const finiteVector = (value, fallback) =>
  Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)) && Math.abs(Number(item)) < 1e4)
    ? value.map((item) => Math.round(Number(item) * 1000) / 1000)
    : [...fallback];
const clampNumber = (value, [low, high], fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(high, Math.max(low, number))) : fallback;
};

function normalizeOutsideEmblem(input) {
  const source = input && typeof input === "object" ? input : {};
  const asset = EMBLEM_ASSET.test(String(source.asset || "")) ? source.asset : "";
  const location = byId.has(source.location) ? source.location : SHOP_OUTSIDE_PLACES[0]?.id || "";
  const fallback = outsideDefaultDecal();
  const normal = finiteVector(source.normal, fallback.normal);
  const size = Number(source.size);
  return {
    asset,
    name: asset ? String(source.name || "").slice(0, 80) : "",
    width: asset ? clampNumber(source.width, [1, 8192], 1) : 0,
    height: asset ? clampNumber(source.height, [1, 8192], 1) : 0,
    location,
    point: finiteVector(source.point, fallback.point),
    normal: Math.hypot(...normal) > 0.1 ? normal : [...fallback.normal],
    size: Number.isFinite(size) ? Math.round(Math.min(OUTSIDE_EMBLEM_SIZE[1], Math.max(OUTSIDE_EMBLEM_SIZE[0], size)) * 10) / 10 : EMBLEM_SIZE_DEFAULT,
    opacity: clampNumber(source.opacity, [0, 100], 100),
    angle: normalizeDecalAngle(source.angle),
  };
}

/* Название заправки — надпись-плашка: тот же разбор места, что у эмблемы, и грань вывески (`sign`), на которую она встала. */
function normalizeOutsideName(input) {
  const source = input && typeof input === "object" ? input : {};
  return { ...normalizeOutsideEmblem(source), sign: String(source.sign || "").replace(/[^a-z0-9:_-]/gi, "").slice(0, 24) };
}

/**
 * Эмблемы и названия на местах: `[{ id, asset, location, point, normal, width, height, opacity, angle }]`
 * в метрах сцены места; название — с `id` вида `n:e1`, чтобы не сойтись с эмблемой.
 */
export const outsideEmblemDecals = (outside) => {
  const known = (item) => item.location && byId.get(item.location)?.scene?.origin;
  return [
    ...readyEmblems(outside?.emblems || [])
      .filter(known)
      .map((item) => emblemDecal(item, { location: item.location })),
    ...readyEmblems(outside?.names || [])
      .filter(known)
      .map((item) => emblemDecal(item, { id: `n:${item.id}`, location: item.location })),
  ];
};

/** Картинки эмблем и названий, что нужны установщику (ключи хранилища окна). */
export const outsideEmblemAssets = (outside) => emblemAssets([...(outside?.emblems || []), ...(outside?.names || [])]);

/**
 * Плашки эмблем в мире: место — сцена места плюс её начало, обратный
 * кватернион сущности, размер — для `compile-emblem-plates`.
 */
export function outsideEmblemPlates(outside) {
  const out = [];
  /* Отступ от стены растёт по счёту плашек на одном месте: названия разных станций друг друга не отодвигают. */
  const onPlace = new Map();
  for (const decal of outsideEmblemDecals(outside)) {
    const origin = byId.get(decal.location).scene.origin;
    const rank = onPlace.get(decal.location) || 0;
    onPlace.set(decal.location, rank + 1);
    const place = decalPlacement(decal, { offset: emblemPlateOffset(rank) });
    out.push({
      id: decal.id,
      asset: decal.asset,
      name: emblemPlateName(SHOPS_PLATE.model, out.length),
      position: place.position.map((value, axis) => Math.round((value + origin[axis]) * 1000) / 1000),
      rotation: place.rotation,
      size: place.size,
      lodDist: SHOPS_PLATE.lodDist,
      opacity: decal.opacity,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Облик
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

function normalizeSurface(colour, input) {
  const source = plain(input);
  return {
    mode: choice(source.mode, OUTSIDE_SURFACE_MODES, "standard"),
    look: normalizeColourEffect(lookOf(source), { colour, colour2: "#ffffff", direction: "height" }),
    ...normalizeFinishFields(source),
  };
}

/** Облик места снаружи: части `walls`, `roof`, `ground`, `signs`. */
export function normalizeOutsideLook(input) {
  const parts = plain(plain(input).parts);
  return { parts: Object.fromEntries(OUTSIDE_PARTS.map((part) => [part.id, normalizeSurface(part.colour, parts[part.id])])) };
}

/** Облик колонок: корпус и табло. */
export function normalizePumpLook(input) {
  const parts = plain(plain(input).parts);
  return { parts: Object.fromEntries(PUMP_PARTS.map((part) => [part.id, normalizeSurface(part.colour, parts[part.id])])) };
}

const surfaceIsStock = (surface) => !surface || surface.mode === "standard";
export const outsideLookIsStock = (look) => OUTSIDE_PART_IDS.every((id) => surfaceIsStock(look?.parts?.[id]));
export const pumpLookIsStock = (look) => PUMP_PART_IDS.every((id) => surfaceIsStock(look?.parts?.[id]));

/* Что из облика поверхности меняет файлы. */
function surfaceSignature(surface) {
  if (!surface || surface.mode === "standard") return null;
  if (surface.mode === "colour" || surface.mode === "flat") return { mode: surface.mode, look: surface.look };
  return finishSignature(surface) || { mode: surface.mode };
}
const lookSignature = (look, ids) => JSON.stringify(Object.fromEntries(ids.map((id) => [id, surfaceSignature(look?.parts?.[id])])));
export const outsideLookSignature = (look) => lookSignature(look, OUTSIDE_PART_IDS);
export const pumpLookSignature = (look) => lookSignature(look, PUMP_PART_IDS);

/*
 * Часть работы «Интерьеров»: `{ kinds, places, pumps: { all, stations } }`.
 * Свой облик места и станции помнится, даже когда выключен (`own: false`):
 * включил снова — он на месте.
 */
export function normalizeShopsOutside(input) {
  const source = plain(input);
  const kinds = plain(source.kinds);
  const places = plain(source.places);
  const pumps = plain(source.pumps);
  const keep = (entries, valid, normalize, isStock) =>
    Object.fromEntries(
      Object.entries(entries)
        .filter(([id]) => valid(id))
        .map(([id, value]) => [id, { own: Boolean(plain(value).own), look: normalize(plain(value).look) }])
        .filter(([, value]) => value.own || !isStock(value.look))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  return {
    kinds: Object.fromEntries(OUTSIDE_KINDS.map((kind) => [kind, normalizeOutsideLook(kinds[kind])])),
    places: keep(places, (id) => byId.has(id), normalizeOutsideLook, outsideLookIsStock),
    /* Свои колонки станций сняты (17.10.2026): `stations` всегда пуст, колонки — общий облик. */
    pumps: {
      all: normalizePumpLook(pumps.all),
      stations: {},
    },
    /* Эмблемы и надписи на фасадах — общей системой мест. */
    emblems: normalizeEmblemList(source, normalizeOutsideEmblem),
    /* Названия заправок — надписи-плашки на вывесках, своим списком. */
    names: normalizeEmblemList({ emblems: (Array.isArray(source.names) ? source.names : []).map((item) => ({ ...plain(item), kind: "text" })) }, normalizeOutsideName, { limit: OUTSIDE_NAME_LIMIT }),
  };
}

/** Облик места в игре: свой, если включён, иначе — облик вида. */
export function outsideLookOf(outside, placeId) {
  const place = shopOutsidePlace(placeId);
  const own = outside?.places?.[placeId];
  if (own?.own) return own.look;
  return outside?.kinds?.[place?.kind] || normalizeOutsideLook({});
}

/** Облик колонок станции в игре: свой, если включён, иначе — общий. */
export function pumpLookOf(outside, stationId) {
  const own = outside?.pumps?.stations?.[stationId];
  return own?.own ? own.look : outside?.pumps?.all || normalizePumpLook({});
}

/** Места, чей облик снаружи уходит в игру. */
export const changedOutsidePlaces = (outside) => SHOP_OUTSIDE_PLACES.filter((place) => !outsideLookIsStock(outsideLookOf(outside, place.id))).map((place) => place.id);

/** Общий облик колонок меняет модели игры. */
export const pumpsChanged = (outside) => !pumpLookIsStock(outside?.pumps?.all);

/**
 * Станции со своими колонками — их колонкам нужна своя копия модели. С
 * 17.10.2026 таких нет (`pumps.stations` всегда пуст): остаётся для
 * установщика и сверок, которые читают этот список.
 */
export function ownPumpStations(outside) {
  const shared = pumpLookSignature(outside?.pumps?.all);
  return GAS_STATIONS.filter((station) => {
    const own = outside?.pumps?.stations?.[station.id];
    return own?.own && (station.pumps || []).length && pumpLookSignature(own.look) !== shared;
  }).map((station) => station.id);
}

/** Снаружи всё как в игре: ставить нечего. */
export const outsideIsStock = (outside) =>
  !changedOutsidePlaces(outside).length && !pumpsChanged(outside) && !ownPumpStations(outside).length && !hasEmblems(outside?.emblems || []) && !hasEmblems(outside?.names || []);

/* Названия — своим ключом `names` (без названий его нет: отпечаток прежних работ не меняется). */
function nameSignature(outside) {
  const ready = readyEmblems(outside?.names || []);
  return ready.length ? { names: ready.map((item) => ({ id: item.id, asset: item.asset, location: item.location, point: item.point, normal: item.normal, size: item.size, opacity: item.opacity, angle: item.angle })) } : {};
}

/** Отпечаток части «снаружи»: что уходит в игру. */
export function outsideSignature(outside) {
  return {
    places: Object.fromEntries(changedOutsidePlaces(outside).map((id) => [id, outsideLookSignature(outsideLookOf(outside, id))])),
    pumps: pumpsChanged(outside) ? pumpLookSignature(outside.pumps.all) : null,
    stations: Object.fromEntries(ownPumpStations(outside).map((id) => [id, pumpLookSignature(pumpLookOf(outside, id))])),
    ...emblemSignature(outside?.emblems || [], (item) => ({ asset: item.asset, location: item.location, point: item.point, normal: item.normal, size: item.size, opacity: item.opacity, angle: item.angle })),
    ...nameSignature(outside),
  };
}

/** Поверхности облика, что уходят в игру (для картинок и кода). */
export function outsideSurfacesInUse(outside) {
  const list = [];
  for (const id of changedOutsidePlaces(outside)) list.push(...Object.values(outsideLookOf(outside, id).parts));
  if (pumpsChanged(outside)) list.push(...Object.values(outside.pumps.all.parts));
  for (const id of ownPumpStations(outside)) list.push(...Object.values(pumpLookOf(outside, id).parts));
  return list;
}
export const outsideImageAssets = (outside) => finishImageAssets(outsideSurfacesInUse(outside));

/* Все поверхности части — и выключенные: картинки человека в код не едут. */
function mapSurfaces(outside, map) {
  const look = (value, ids) => ({ ...value, parts: Object.fromEntries(ids.map((id) => [id, map(value.parts[id])])) });
  const own = (entries, ids) => Object.fromEntries(Object.entries(entries).map(([id, value]) => [id, { ...value, look: look(value.look, ids) }]));
  return {
    kinds: Object.fromEntries(Object.entries(outside.kinds).map(([id, value]) => [id, look(value, OUTSIDE_PART_IDS)])),
    places: own(outside.places, OUTSIDE_PART_IDS),
    pumps: { all: look(outside.pumps.all, PUMP_PART_IDS), stations: own(outside.pumps.stations, PUMP_PART_IDS) },
    emblems: outside.emblems || [],
    names: outside.names || [],
  };
}
export const shareableOutside = (outside) => ({
  ...mapSurfaces(outside, (surface) => (surface.mode === "image" ? { ...surface, mode: "standard", image: { ...surface.image, asset: null, name: "" } } : surface)),
  emblems: shareableEmblems(outside.emblems || []),
  names: shareableEmblems(outside.names || []),
});
export function outsideHasImages(outside) {
  let found = emblemsLostInCode([...(outside?.emblems || []), ...(outside?.names || [])]);
  mapSurfaces(outside, (surface) => {
    if (surface.mode === "image" && surface.image?.asset) found = true;
    return surface;
  });
  return found;
}

/** «Стандарт» всего снаружи: части и колонки как в игре (цвета, узоры и картинки помнятся, свои облики выключаются), эмблем нет. */
export function stockOutside(outside) {
  const stock = mapSurfaces(outside, (surface) => ({ ...surface, mode: "standard" }));
  return {
    ...stock,
    emblems: [],
    names: [],
    places: Object.fromEntries(Object.entries(stock.places).map(([id, value]) => [id, { ...value, own: false }])),
    pumps: { ...stock.pumps, stations: Object.fromEntries(Object.entries(stock.pumps.stations).map(([id, value]) => [id, { ...value, own: false }])) },
  };
}

/* ------------------------------------------------------------------ *
 * Готовые облики снаружи
 * ------------------------------------------------------------------ */

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "height", width: 2, shift: 0 });
const colour = (hex) => ({ mode: "colour", look: solid(hex) });
const flat = (hex) => ({ mode: "flat", look: solid(hex) });
const pattern = (id, colours, scale = 100) => ({ mode: "pattern", pattern: { id, colours, scale } });

/*
 * Шаблон — облик частей места; у заправки — ещё и колонок. Ложится на
 * взятое место или на все места вида.
 */
export const OUTSIDE_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Модели и листы Rockstar без правок", parts: {}, pumps: {} },
    {
      id: "white-red",
      label: "Белый и красный",
      description: "Белые стены и навес, красные вывески и колонки",
      parts: { walls: flat("#f1efe9"), roof: flat("#f6f5f1"), signs: colour("#d8141c") },
      pumps: { body: colour("#d8141c"), display: flat("#f1efe9") },
    },
    {
      id: "graphite",
      label: "Графит",
      description: "Тёмные стены и навес, жёлтые вывески",
      parts: { walls: colour("#3a3b3f"), roof: flat("#26272a"), ground: pattern("concrete", ["#5c5b58", "#43423f", "#2b2a28"]), signs: colour("#f2c94c") },
      pumps: { body: colour("#2f3033"), display: colour("#f2c94c") },
    },
    {
      id: "green",
      label: "Зелёная станция",
      description: "Зелёный навес и вывески, светлые стены",
      parts: { walls: flat("#ecebe4"), roof: colour("#1f8a4c"), signs: colour("#27ae60") },
      pumps: { body: colour("#1f8a4c"), display: flat("#ecebe4") },
    },
    {
      id: "neon",
      label: "Неон",
      description: "Тёмные стены, вывески градиентом бирюзы и розового",
      parts: {
        walls: flat("#17171c"),
        roof: flat("#101014"),
        signs: { mode: "colour", look: { mode: "gradient", colour: "#2ee6ff", colour2: "#ff2e97", direction: "along", width: 2, shift: 0 } },
      },
      pumps: { body: flat("#17171c"), display: { mode: "colour", look: { mode: "gradient", colour: "#2ee6ff", colour2: "#ff2e97", direction: "along", width: 2, shift: 0 } } },
    },
    {
      id: "brick",
      label: "Кирпич и дерево",
      description: "Кирпичные стены, деревянный навес",
      parts: { walls: pattern("bricks", ["#8a4a32", "#5e2f22", "#c9bfb2"], 80), roof: pattern("planks", ["#8a5a36", "#5a3920", "#2a1a0f"]) },
      pumps: {},
    },
    {
      id: "blue",
      label: "Синяя классика",
      description: "Синий навес и колонки, белые стены",
      parts: { walls: flat("#f3f3f1"), roof: colour("#1f5fbf"), signs: colour("#2f80ed") },
      pumps: { body: colour("#1f5fbf"), display: flat("#f3f3f1") },
    },
  ].map((item) => Object.freeze(item)),
);

/** Облик места по шаблону (части, чего у шаблона нет, — «Стандарт»). */
export function outsidePresetLook(presetId, base = normalizeOutsideLook({})) {
  const preset = OUTSIDE_PRESETS.find((item) => item.id === presetId);
  if (!preset) return base;
  return normalizeOutsideLook({ parts: Object.fromEntries(OUTSIDE_PART_IDS.map((id) => [id, { ...base.parts[id], mode: "standard", ...(preset.parts[id] || {}) }])) });
}

/** Облик колонок по шаблону. */
export function pumpPresetLook(presetId, base = normalizePumpLook({})) {
  const preset = OUTSIDE_PRESETS.find((item) => item.id === presetId);
  if (!preset) return base;
  return normalizePumpLook({ parts: Object.fromEntries(PUMP_PART_IDS.map((id) => [id, { ...base.parts[id], mode: "standard", ...(preset.pumps[id] || {}) }])) });
}

/** Шаблон, с которым совпадает облик (части места), или `null`. */
export function matchingOutsidePreset(look) {
  const current = outsideLookSignature(look);
  return OUTSIDE_PRESETS.find((preset) => outsideLookSignature(outsidePresetLook(preset.id)) === current)?.id || null;
}
