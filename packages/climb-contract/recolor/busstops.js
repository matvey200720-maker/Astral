/*
 * «Остановки» — облик автобусных остановок всей карты (задача 5 ТЗ 06.10.2026).
 *
 * Остановки GTA V — реквизит игры (`inventory/busstops.js`,
 * `scripts/prepare-busstops.mjs`): три навеса (`prop_busstop_02/04/05`) и
 * знак (`prop_bus_stop_sign`), всего около полусотни на карте. Листы зашиты в
 * сами модели (копии высокой чёткости — в `+hifr.ytd` рядом), других вещей у
 * этих файлов нет: правка остановки видна только на остановках и сразу на
 * всех остановках этого вида.
 *
 * У остановки части — каркас со скамьёй и крышей, рекламный щит, стёкла и
 * светильник. У части — облик:
 *   standard — «Стандарт», как в игре;
 *   colour   — свой цвет эффектом мастерской (цвет, градиент, радуга,
 *              перелив, линия): рисунок и светотень листа остаются;
 *   flat     — «Без текстуры»: ровный цвет, рисунок листа убран;
 *   pattern  — узор каталога, image — своя картинка, gradient — градиент
 *              (общая система отделки, `finish.js`).
 * И прозрачность всей остановки — от 10 до 100 %: в игре это прозрачный
 * шейдер игры (`normal_spec_alpha`, корзина прозрачных) и альфа листа.
 *
 * Работа: облик «Все остановки» (`all`) и у каждого вида — свой, если
 * включён (`types[вид].own`). Исходный облик — «Стандарт»: ставить нечего,
 * «Применить» снимает установку.
 *
 * Гифка на постере (задача 6 ТЗ 17.10.2026, вечер): картинка постера может
 * быть гифкой (`image.animation` — лист кадров). Шейдер постера
 * (`emissive_speclum`) не несёт параметров развёртки `globalAnimUV0/1`, и клип
 * развёртки на штатную модель остановки ничего не двинул бы, поэтому живая
 * гифка — плашка по геометрии постера (его две стороны, на сантиметр впереди)
 * на каждой остановке вида; на самом листе постера лежит первый кадр
 * (`busStopPlate`, `busStopLiveState`).
 *
 * Будки (задача 11 ТЗ 18.10.2026): в той же работе — парковочные будки «24 HRS.
 * PARK» (`booths`, `busstop-booths.js`): две штатные модели игры, облик «Обе»
 * и свой у каждой, ставятся тем же ходом, что остановки. Остановок их облик не
 * касается, и наоборот: «Все остановки» будок не красят.
 */

import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import {
  applyBoothsPreset,
  applyBoothsStandard,
  boothsAreStock,
  boothsHavePictures,
  boothsImageAssets,
  boothsSignature,
  normalizeBooths,
  shareableBooths,
} from "./busstop-booths.js";
import { finishImageAssets, finishSignature, normalizeFinishFields } from "./finish.js";
import { GIF_SURFACE_PROFILES, gifSurfaceBudget } from "./gif-surface.js";
import BUSSTOP_PLATES from "./inventory/busstop-plates.js";
import BUSSTOPS_INVENTORY from "./inventory/busstops.js";
import { placeModelIntoFirstCell } from "./place-models.js";

export { BUSSTOPS_INVENTORY };

export const BUSSTOPS_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/* Виды остановок — по описи; имена — для окна. */
const TYPE_LABELS = Object.freeze({
  classic: { label: "Навес со скамьёй", note: "Классический навес: стекло, реклама, скамья" },
  lit: { label: "Навес с подсветкой", note: "Светильник под крышей и световой щит" },
  city: { label: "Городской навес", note: "Узкий навес центра города" },
  sign: { label: "Знак остановки", note: "Столб со знаком, без навеса" },
});
export const BUSSTOP_TYPES = Object.freeze(
  BUSSTOPS_INVENTORY.types.map((type) =>
    Object.freeze({
      id: type.id,
      model: type.model,
      label: TYPE_LABELS[type.id]?.label || type.model,
      note: TYPE_LABELS[type.id]?.note || "",
      placements: type.placements,
      parts: Object.freeze([...new Set(type.sheets.map((sheet) => sheet.part))]),
    }),
  ),
);
export const BUSSTOP_TYPE_IDS = Object.freeze(BUSSTOP_TYPES.map((type) => type.id));
export const findBusStopType = (id) => BUSSTOP_TYPES.find((type) => type.id === id) || null;

/* Части остановки. */
export const BUSSTOP_PARTS = Object.freeze([
  Object.freeze({ id: "frame", label: "Каркас и скамья", colour: "#2f80ed" }),
  Object.freeze({ id: "poster", label: "Реклама", colour: "#f2c94c" }),
  Object.freeze({ id: "glass", label: "Стекло", colour: "#9fd3ff" }),
  Object.freeze({ id: "light", label: "Светильник", colour: "#fff4d6" }),
]);
export const BUSSTOP_PART_IDS = Object.freeze(BUSSTOP_PARTS.map((part) => part.id));

export const BUSSTOP_SURFACE_MODES = Object.freeze(["standard", "colour", "flat", "pattern", "image", "gradient"]);
export const BUSSTOP_SURFACE_LABELS = Object.freeze({
  standard: "Стандарт",
  colour: "Свой цвет",
  flat: "Без текстуры",
  pattern: "Узор",
  image: "Картинка",
  gradient: "Градиент",
});
/* Прозрачность всей остановки, %: 100 — как в игре. */
export const BUSSTOP_OPACITY = Object.freeze({ min: 10, max: 100, standard: 100 });

/**
 * Потолок яркости пикселя листа каркаса и светильника до таблицы тона (одна арифметика у установщика и у окна): на листах остановок лежит светлая люминесцентная панель
 * (`prop_busstop_2`, `prop_busstop_5`) — окошко на торце короба и потолочный светильник; таблица тона сводила её в светлую лаванду (11.11.2026, снимок владельца: «белое окошко и
 * белый прямоугольник на крыше»). С потолком панель получает цвет работы.
 */
export const BUSSTOP_HIGHLIGHT_CAP = 0.6;
/** Части, к которым потолок относится: каркас и светильник (плакат — рисунок, его светлое остаётся светлым). */
export const BUSSTOP_CAPPED_PARTS = Object.freeze(["frame", "light"]);

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return BUSSTOP_OPACITY.standard;
  return Math.round(Math.min(BUSSTOP_OPACITY.max, Math.max(BUSSTOP_OPACITY.min, number)));
}

function normalizeSurface(part, input) {
  const source = plain(input);
  const colour = BUSSTOP_PARTS.find((item) => item.id === part)?.colour || "#808080";
  return {
    mode: choice(source.mode, BUSSTOP_SURFACE_MODES, "standard"),
    look: normalizeColourEffect(lookOf(source), { colour, colour2: "#ffffff", direction: "height" }),
    ...normalizeFinishFields(source),
  };
}

/* Облик одной остановки: части и прозрачность. */
function normalizeLook(input) {
  const source = plain(input);
  return {
    parts: Object.fromEntries(BUSSTOP_PART_IDS.map((id) => [id, normalizeSurface(id, plain(source.parts)[id])])),
    opacity: clampOpacity(source.opacity),
  };
}

export function normalizeBusStopsProject(input) {
  const source = plain(input);
  const types = plain(source.types);
  return {
    schema: BUSSTOPS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    all: normalizeLook(source.all),
    types: Object.fromEntries(
      BUSSTOP_TYPE_IDS.map((id) => {
        const item = plain(types[id]);
        return [id, { own: item.own === true, ...normalizeLook(item) }];
      }),
    ),
    booths: normalizeBooths(source.booths),
  };
}

export const createBusStopsProject = () => normalizeBusStopsProject({});
export const serializeBusStopsProject = (project) => JSON.stringify(normalizeBusStopsProject(project));

export function parseBusStopsProject(text) {
  try {
    return normalizeBusStopsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createBusStopsProject();
  }
}

/** Облик вида, который уйдёт в игру: свой, если включён, иначе общий. */
export function busStopLookOf(input, typeId) {
  const project = normalizeBusStopsProject(input);
  const own = project.types[typeId];
  return own?.own ? { parts: own.parts, opacity: own.opacity } : project.all;
}

const surfaceIsStock = (surface) => surface.mode === "standard";
const lookIsStock = (look, typeId) => {
  const parts = findBusStopType(typeId)?.parts || BUSSTOP_PART_IDS;
  return look.opacity >= BUSSTOP_OPACITY.max && parts.every((part) => surfaceIsStock(look.parts[part]));
};

/** Все остановки как в игре (будки не в счёт). */
export const busStopsOnlyAreStock = (input) => BUSSTOP_TYPE_IDS.every((id) => lookIsStock(busStopLookOf(input, id), id));

/** Остановки и будки как в игре: ставить нечего. */
export const busStopsProjectIsStock = (input) => busStopsOnlyAreStock(input) && boothsAreStock(normalizeBusStopsProject(input).booths);

/* Что из облика части меняет файлы. */
function surfaceSignature(surface) {
  if (surface.mode === "standard") return null;
  if (surface.mode === "colour" || surface.mode === "flat") return { mode: surface.mode, look: surface.look };
  return finishSignature(surface) || { mode: surface.mode };
}

/** Отпечаток остановок без будок: по нему узнают готовый вид остановок. */
export function busStopsOnlySignature(input) {
  return JSON.stringify(
    Object.fromEntries(
      BUSSTOP_TYPE_IDS.map((id) => {
        const look = busStopLookOf(input, id);
        const parts = findBusStopType(id)?.parts || BUSSTOP_PART_IDS;
        return [id, { opacity: look.opacity, parts: Object.fromEntries(parts.map((part) => [part, surfaceSignature(look.parts[part])])) }];
      }),
    ),
  );
}

/**
 * Отпечаток для очереди «Применить»: тот же облик остановок и будок — тот же
 * отпечаток. Будки как в игре в отпечаток не входят: у работ, что их не трогали,
 * он тот же, что был до будок.
 */
export function busStopsProjectSignature(input) {
  const booths = boothsSignature(normalizeBusStopsProject(input).booths);
  return booths ? JSON.stringify({ ...JSON.parse(busStopsOnlySignature(input)), booths }) : busStopsOnlySignature(input);
}

/** «Стандарт» остановок: все остановки как в игре; цвета, узоры и картинки помнятся, будки — как есть. */
export function applyBusStopsOnlyStandard(input) {
  const project = normalizeBusStopsProject(input);
  const stock = (look) => ({
    ...look,
    opacity: BUSSTOP_OPACITY.standard,
    parts: Object.fromEntries(BUSSTOP_PART_IDS.map((id) => [id, { ...look.parts[id], mode: "standard" }])),
  });
  return {
    ...project,
    all: stock(project.all),
    types: Object.fromEntries(BUSSTOP_TYPE_IDS.map((id) => [id, { ...stock(project.types[id]), own: false }])),
  };
}

/** «Стандарт»: остановки и будки как в игре; цвета, узоры и картинки помнятся. */
export function applyBusStopsStandard(input) {
  const project = applyBusStopsOnlyStandard(input);
  return { ...project, booths: applyBoothsStandard(project.booths) };
}

/** «Стандарт» будок: будки как в игре, остановки — как есть. */
export function applyBusStopsBoothsStandard(input) {
  const project = normalizeBusStopsProject(input);
  return { ...project, booths: applyBoothsStandard(project.booths) };
}

export const resetBusStopsProject = (input) => ({ ...createBusStopsProject(), name: normalizeBusStopsProject(input).name });

/* Картинки человека в код не едут: часть с картинкой становится «Стандартом». */
export function shareableBusStopsProject(input) {
  const project = normalizeBusStopsProject(input);
  const strip = (look) => ({
    ...look,
    parts: Object.fromEntries(
      BUSSTOP_PART_IDS.map((id) => {
        const surface = look.parts[id];
        return [id, surface.mode === "image" ? { ...surface, mode: "standard", image: { ...surface.image, asset: null, name: "" } } : surface];
      }),
    ),
  });
  return {
    ...project,
    all: strip(project.all),
    types: Object.fromEntries(BUSSTOP_TYPE_IDS.map((id) => [id, { ...project.types[id], ...strip(project.types[id]) }])),
    booths: shareableBooths(project.booths),
  };
}

export function busStopsLostInCode(input) {
  const project = normalizeBusStopsProject(input);
  const looks = [project.all, ...Object.values(project.types)];
  return looks.some((look) => Object.values(look.parts).some((surface) => surface.mode === "image" && surface.image?.asset)) || boothsHavePictures(project.booths)
    ? "свои картинки (остаются на этом компьютере)"
    : "";
}

/* ------------------------------------------------------------------ *
 * Гифка на постере: живая плашка по геометрии постера
 * ------------------------------------------------------------------ */

/** Плашка на сантиметр впереди каждой стороны постера, м. */
export const BUSSTOP_PLATE_OFFSET = 0.01;

/**
 * Геометрия постера вида и его места на карте или `null` (у знака постера
 * нет): `{ model, shader, lod, positions, normals, uvs, indices, stops }` —
 * сетка постера (оси игры, Z вверх, развёртка 0…1 по листу), дальность
 * архетипа и `stops` — `[x, y, z, qx, qy, qz, qw]` остановок вида.
 */
export const busStopPlate = (typeId) => BUSSTOP_PLATES[typeId] || null;

/** Постер — гифка: картинка с кадрами. */
export const busStopPosterIsGif = (surface) => surface?.mode === "image" && Boolean(surface.image?.asset) && Boolean(surface.image?.animation);

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Сетка плашки вида: постер (`busStopPlate`) — каждая его сторона сдвинута
 * на `BUSSTOP_PLATE_OFFSET` по своей нормали (по геометрии стороны,
 * направленной туда же, куда нормали вершин), развёртка постера растянута на
 * весь лист кадра и сжата в первую клетку атласа (`animation`). Оси —
 * модели остановки: плашка встаёт сущностью в точке остановки с её же
 * поворотом. `{ positions, normals, uvs, indices }` (Float32Array) или
 * `null`, если у вида нет постера.
 */
export function busStopPlateMesh(typeId, animation) {
  const plate = busStopPlate(typeId);
  if (!plate) return null;
  const count = plate.positions.length / 3;
  const point = (index) => plate.positions.slice(index * 3, index * 3 + 3);
  const positions = new Float32Array(plate.positions.length);
  const normals = new Float32Array(plate.positions.length);
  /* Сторона — связная часть: вершины, соединённые треугольниками (у постера их две, по четырёхугольнику). */
  const side = new Array(count).fill(-1);
  const firstTriangle = [];
  for (let at = 0; at < plate.indices.length; at += 3) {
    const corners = [plate.indices[at], plate.indices[at + 1], plate.indices[at + 2]];
    let id = corners.map((corner) => side[corner]).find((value) => value >= 0);
    if (id === undefined) {
      id = firstTriangle.length;
      firstTriangle.push(corners);
    }
    for (const corner of corners) side[corner] = id;
  }
  firstTriangle.forEach((triangle, id) => {
    const [a, b, c] = triangle.map(point);
    let normal = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const length = Math.hypot(...normal) || 1;
    normal = normal.map((value) => value / length);
    const members = [...Array(count).keys()].filter((index) => side[index] === id);
    const given = members.reduce((sum, index) => [0, 1, 2].map((axis) => sum[axis] + plate.normals[index * 3 + axis]), [0, 0, 0]);
    if (normal[0] * given[0] + normal[1] * given[1] + normal[2] * given[2] < 0) normal = normal.map((value) => -value);
    for (const index of members)
      for (let axis = 0; axis < 3; axis += 1) {
        positions[index * 3 + axis] = plate.positions[index * 3 + axis] + normal[axis] * BUSSTOP_PLATE_OFFSET;
        normals[index * 3 + axis] = normal[axis];
      }
  });
  /* Развёртка постера — по всему листу кадра: края постера (у «подсвеченного» вида в полупикселе от края) — края кадра. */
  const uvs = new Float32Array(plate.uvs.length);
  const range = [0, 1].map((axis) => {
    const values = plate.uvs.filter((_, at) => at % 2 === axis);
    return [Math.min(...values), Math.max(...values)];
  });
  for (let at = 0; at < uvs.length; at += 2)
    for (const axis of [0, 1]) uvs[at + axis] = (plate.uvs[at + axis] - range[axis][0]) / Math.max(1e-6, range[axis][1] - range[axis][0]);
  const unit = { positions, normals, uvs, indices: Uint32Array.from(plate.indices) };
  return animation ? placeModelIntoFirstCell(unit, animation) : unit;
}

/*
 * Какие виды играют гифку: у вида с постером, чей облик — гифка, плашка
 * ставится на каждую его остановку; видов с живой плашкой — не больше
 * `GIF_SURFACE_PROFILES.busstops.maxLive`. Состояние вида: `"live"` или
 * `"limit"` (первый кадр на листе). Ответ: `{ states: Map(вид → состояние),
 * live: [вид], stops: число остановок живых видов }`.
 */
export function busStopLiveState(input) {
  const keep = input && typeof input === "object";
  if (keep && LIVE_STATES.has(input)) return LIVE_STATES.get(input);
  const project = normalizeBusStopsProject(input);
  const candidates = [];
  const states = new Map();
  for (const id of BUSSTOP_TYPE_IDS) {
    if (!busStopPlate(id)?.stops.length) continue;
    if (busStopPosterIsGif(busStopLookOf(project, id).parts.poster)) candidates.push({ key: id });
  }
  const budget = gifSurfaceBudget("busstops", candidates);
  for (const id of budget.live) states.set(id, "live");
  for (const { key } of budget.still) states.set(key, "limit");
  const state = {
    states,
    live: budget.live,
    stops: budget.live.reduce((sum, id) => sum + busStopPlate(id).stops.length, 0),
    limit: GIF_SURFACE_PROFILES.busstops.maxLive,
  };
  if (keep) LIVE_STATES.set(input, state);
  return state;
}
const LIVE_STATES = new WeakMap();

/** Свои картинки работы, которые нужны установщику (`Map` ключ → имя): облик всех и заведённые облики видов. */
export function busStopsImageAssets(input) {
  const project = normalizeBusStopsProject(input);
  const looks = [project.all, ...BUSSTOP_TYPE_IDS.filter((id) => project.types[id].own).map((id) => project.types[id])];
  const assets = finishImageAssets(looks.flatMap((look) => Object.values(look.parts)));
  for (const [key, name] of boothsImageAssets(project.booths)) assets.set(key, name);
  return assets;
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "height", width: 2, shift: 0 });
const surface = (mode, extra = {}) => ({ mode, ...extra });

export const BUSSTOPS_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Остановки Rockstar", all: {} },
    {
      id: "blue",
      label: "Синие остановки",
      description: "Синий каркас, реклама и стекло — как в игре",
      all: { parts: { frame: surface("colour", { look: solid("#2f80ed") }) } },
    },
    {
      id: "white",
      label: "Белые без текстуры",
      description: "Ровный белый каркас, без рисунка листа",
      all: { parts: { frame: surface("flat", { look: solid("#f4f5f7") }) } },
    },
    {
      id: "black",
      label: "Чёрные без рекламы",
      description: "Чёрный каркас, щит — ровным тёмным",
      all: { parts: { frame: surface("colour", { look: solid("#1b1d22") }), poster: surface("flat", { look: solid("#16181c") }) } },
    },
    {
      id: "ghost",
      label: "Полупрозрачные",
      description: "Вся остановка на 40 % — сквозь неё видно улицу",
      all: { opacity: 40 },
    },
    {
      id: "rainbow",
      label: "Радужные",
      description: "Каркас радугой снизу вверх",
      all: { parts: { frame: surface("colour", { look: { mode: "rainbow", colour: "#ff0000", colour2: "#ffffff", direction: "height", width: 2, shift: 0 } }) } },
    },
  ].map((item) => Object.freeze(item)),
);

/** Работа с готовым видом: облик всех остановок, свои облики видов выключены. */
export function applyBusStopsPreset(input, presetId) {
  const project = normalizeBusStopsProject(input);
  const preset = BUSSTOPS_PRESETS.find((item) => item.id === presetId);
  if (!preset) return project;
  const stock = applyBusStopsOnlyStandard(project);
  const all = normalizeLook({
    ...stock.all,
    ...preset.all,
    parts: Object.fromEntries(BUSSTOP_PART_IDS.map((id) => [id, { ...stock.all.parts[id], ...(preset.all.parts?.[id] || {}) }])),
  });
  return normalizeBusStopsProject({ ...stock, all });
}

/** Готовый вид остановок, с которым работа совпадает (будки не в счёт), или `null`. */
export function matchingBusStopsPreset(input) {
  const current = busStopsOnlySignature(input);
  return BUSSTOPS_PRESETS.find((item) => busStopsOnlySignature(applyBusStopsPreset(input, item.id)) === current)?.id || null;
}

/** Работа с готовым видом будок: остановки — как есть. */
export function applyBusStopsBoothsPreset(input, presetId) {
  const project = normalizeBusStopsProject(input);
  return { ...project, booths: applyBoothsPreset(project.booths, presetId) };
}
