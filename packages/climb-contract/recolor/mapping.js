/*
 * Маппинг: цвет мест карты из мода маппинга — ферма, база байкеров,
 * разбитый самолёт, парковка сервера, хлам вокруг.
 *
 * Модели мода автор перекрасил в серое: листы `*_Base_color` A8R8G8B8 —
 * запечённые серые картинки, у многих моделей ещё ровный белый или чёрный
 * лист 2048². Перекраска — как у ангара: тон и насыщенность от цвета места
 * при светлоте пикселя (`colour.js` → `tintPixel`), опора — 75-й процентиль
 * яркости каждого листа (`ref` в описи): основная плоскость листа получает
 * ровно выбранный цвет, тени темнее. Ровный лист перекрашивается ровным
 * цветом без разбора пикселей. Листы игры (стёкла, двери, окна) не
 * трогаются.
 *
 * Какие файлы к какому месту — опись (`scripts/lib/mapping-locations.mjs`
 * при подготовке набора): новое место добавляется описанием и
 * перегенерацией, редактор берёт список мест отсюда.
 *
 * Эмблема — своя картинка на любом месте, которое ставит игра (ферма, база
 * байкеров, самолёт): как у завода, плашкой с картинкой — своя модель, свой
 * архетип, своя карта (`compile-emblem-plates`). Место эмблемы — точка и
 * нормаль поверхности в сцене своего места; в мир её переводит начало сцены
 * (`scenes[].origin` описи).
 *
 * Облик места (ТЗ 10.10.2026, задача 16: «изначально чтобы были стандартные
 * здания, а не с модом сразу. Для всех»): `stock` — как в игре (штатные
 * здания, файлы мода места в игру не едут; так у всех мест по умолчанию),
 * `mod` — как в моде (серые модели автора), `colour` — модели мода своим
 * цветом. Работы схемы 1 (до 10.10) открываются как были: их «как в моде»
 * осталось «как в моде».
 *
 * Парковка (ТЗ 17.10.2026; владелец: «пофиксить в маппинге парковку, чтобы
 * была стандартная и можно было её редактировать… а мод перенеси в
 * шаблон»): модель мода у парковки — своя модель сервера 5RP вместо штатной,
 * в одиночной игре её нет. Место стоит на штатной парковке игры
 * (`stockEdit` — файлы игры и листы стен, `prepare-mapping-stock.mjs`): «как в
 * игре» — штатная, свой цвет — её бетон и стены своим тоном (файлы игры
 * игрока с правкой), «как в моде» — модель 5RP, её ставит шаблон «Парковка
 * 5RP».
 */

import { normalizeRecolourHex } from "./colour.js";
import { decalPlacement, normalizeDecalAngle } from "./decal.js";
import {
  EMBLEM_ASSET,
  emblemDecal,
  emblemPlateFiles,
  emblemPlateName,
  emblemPlateOffset,
  emblemSignature,
  emblemsLostInCode,
  hasEmblems,
  normalizeEmblemList,
  readyEmblems,
  shareableEmblems,
} from "./emblems.js";
import { finishSignature, normalizeFinishFields } from "./finish.js";
import MAPPING_INVENTORY from "./inventory/mapping.js";
import MAPPING_STOCK from "./inventory/mapping-stock.js";
import { normalizePlaceItems, placeItemsSignature } from "./place-item-looks.js";
import { hasPlaceModels, joinLostInCode, normalizePlaceModels, placeModelsLostInCode, placeModelsSignatureField } from "./place-models.js";

export { MAPPING_INVENTORY, MAPPING_STOCK };

/* 2 — облик «как в игре» (`stock`) у всех мест по умолчанию. */
export const MAPPING_PROJECT_SCHEMA = 2;
/*
 * Облик места: как в игре, как в моде, свой цвет — и отделка (узор, картинка,
 * градиент, ТЗ 17.10.2026): её несёт только место, где модели игры красятся
 * на месте (`stockEdit`, парковка); у остальных мест отделка встаёт «своим
 * цветом».
 */
export const MAPPING_FINISH_MODES = Object.freeze(["pattern", "image", "gradient"]);
export const MAPPING_MODES = Object.freeze(["stock", "mod", "colour", ...MAPPING_FINISH_MODES]);
/** Облик места красит штатные модели (свой цвет или отделка). */
export const mappingModePaints = (mode) => mode === "colour" || MAPPING_FINISH_MODES.includes(mode);
export const MAPPING_CONTAINER = MAPPING_INVENTORY.container;

/*
 * Облик вещей мест (ТЗ 27.10.2026, «Предметы»): номер вещи сцены повторяется у разных мест, поэтому ключ вещи в работе — основание места плюс номер сцены.
 * Только места, что ставит игра: у них вещи — записи карт района (`placements`); парковку 5RP и хлам «props» ставит сервер.
 */
export const MAPPING_ITEM_BASE = Object.freeze({ farm: 1000, bikers: 2000, plane: 3000 });
export const mappingItemKey = (location, entity) => (MAPPING_ITEM_BASE[location] && Number.isInteger(entity) && entity > 0 && entity < 1000 ? MAPPING_ITEM_BASE[location] + entity : 0);
/** Место и номер вещи сцены по ключу вещи в работе: `{ location, entity }` или `null`. */
export function mappingItemAt(key) {
  const base = Math.floor(Number(key) / 1000) * 1000;
  const location = Object.keys(MAPPING_ITEM_BASE).find((id) => MAPPING_ITEM_BASE[id] === base);
  return location && key - base > 0 ? { location, entity: key - base } : null;
}
/* Модель вещи по ключу: у штатной сцены места, вещи с записью карты (`placements`). */
const ITEM_MODEL = new Map();
for (const scene of MAPPING_STOCK.scenes) {
  const placed = MAPPING_INVENTORY.mapping.locations.find((location) => location.id === scene.id)?.placements?.length || 0;
  for (const [entity, model] of scene.objects?.items || []) {
    const key = mappingItemKey(scene.id, entity);
    if (key && entity <= placed) ITEM_MODEL.set(key, scene.objects.models[model].name);
  }
}
export const mappingItemModel = (key) => ITEM_MODEL.get(key);
/** Номера вещей сцены места в ключах вещей работы (вещей без записи карты нет). */
export const mappingItemKeys = (location) => [...ITEM_MODEL.keys()].filter((key) => mappingItemAt(key)?.location === location);
const NAME_LIMIT = 60;

/* Районы мест для подписи. */
const DISTRICTS = Object.freeze({
  DESRT: "Пустыня Гранд-Сенора",
  WINDF: "Ветряная ферма Рона",
  SANDY: "Сэнди-Шорс",
  HARMO: "Хармони",
});

/* Что красит свой цвет штатного места: `{ files: [{ name, at }], sheets: { лист: { ref } } }` или `null`. */
function stockEditOf(id) {
  const edit = MAPPING_STOCK.scenes.find((scene) => scene.id === id)?.edit;
  if (!edit) return null;
  return Object.freeze({
    files: Object.freeze(edit.files.map((file) => Object.freeze({ ...file }))),
    /* Листы районных словарей (кромка крыши, стена): красятся своей копией внутри модели — опора и где лежит исходный лист. */
    copies: Object.freeze(Object.fromEntries(Object.entries(edit.copies || {}).map(([name, item]) => [name.toLowerCase(), Object.freeze({ ...item })]))),
    /* Места штатных моделей в картах игры — для дальней прорисовки. */
    placements: Object.freeze((edit.placements || []).map((place) => Object.freeze({ ...place }))),
    sheets: Object.freeze(Object.fromEntries(Object.entries(edit.sheets).map(([name, item]) => [name.toLowerCase(), Object.freeze({ ...item })]))),
  });
}

export const MAPPING_LOCATIONS = Object.freeze(
  MAPPING_INVENTORY.mapping.locations.map((location) =>
    Object.freeze({
      id: location.id,
      title: location.title,
      description: location.description,
      districtLabel: DISTRICTS[location.district] || "",
      files: Object.freeze([...location.files]),
      placed: location.placed,
      scene: MAPPING_INVENTORY.scenes.find((scene) => scene.id === location.id)?.url || "",
      /* Штатное место из игры игрока (`prepare-mapping-stock.mjs`); у места,
         которого в обычной игре нет, — пусто. */
      stockScene: MAPPING_STOCK.scenes.find((scene) => scene.id === location.id)?.url || "",
      /* Свой цвет — на штатных моделях (парковка, ТЗ 17.10.2026): файлы игры
         и листы стен с опорой; у прочих мест свой цвет — у моделей мода. */
      stockEdit: stockEditOf(location.id),
    }),
  ),
);

export const MAPPING_TEXTURES = Object.freeze(MAPPING_INVENTORY.mapping.textures.map((item) => Object.freeze({ ...item })));

export const findMappingLocation = (id) => MAPPING_LOCATIONS.find((location) => location.id === id) || null;

/* ------------------------------------------------------------------ *
 * Эмблема
 * ------------------------------------------------------------------ */

/* Места, куда можно поставить эмблему: их ставит игра, и у них есть место
   по умолчанию (`mapping.decals` описи). */
export const MAPPING_EMBLEM_LOCATIONS = Object.freeze(
  MAPPING_LOCATIONS.filter((location) => location.placed && MAPPING_INVENTORY.mapping.decals?.[location.id]).map((location) => location.id),
);
export const MAPPING_EMBLEM_SIZE = Object.freeze([0.5, 20]);
const MAPPING_EMBLEM_SIZE_DEFAULT = 3;

/* Плашка эмблемы в мире: имена набора — свои, не завода. */
export const MAPPING_PLATE = Object.freeze({
  model: "astral_mapping_emblem",
  types: "astral_mapping_marks",
  map: "astral_mapping_marks_map",
  lodDist: 300,
});
/* Файлы плашек по числу эмблем: модель на каждую, типы, карта, манифест. */
export const mappingPlateFiles = (count = 1) => emblemPlateFiles(MAPPING_PLATE, count);
export const MAPPING_PLATE_FILES = Object.freeze(mappingPlateFiles(1));

/** Место эмблемы по умолчанию у места `locationId`: `{ point, normal }`. */
export function mappingDefaultDecal(locationId) {
  const place = MAPPING_INVENTORY.mapping.decals?.[locationId];
  return place ? { point: [...place.point], normal: [...place.normal] } : null;
}

const finiteVector = (value, fallback) =>
  Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)) && Math.abs(Number(item)) < 1e5)
    ? value.map((item) => Math.round(Number(item) * 1000) / 1000)
    : [...fallback];

function normalizeEmblem(input) {
  const source = plain(input);
  const asset = EMBLEM_ASSET.test(String(source.asset || "")) ? source.asset : "";
  const location = MAPPING_EMBLEM_LOCATIONS.includes(source.location) ? source.location : MAPPING_EMBLEM_LOCATIONS[0] || "";
  const fallback = mappingDefaultDecal(location) || { point: [0, 0, 2], normal: [0, -1, 0] };
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
    size: Number.isFinite(size)
      ? Math.round(Math.min(MAPPING_EMBLEM_SIZE[1], Math.max(MAPPING_EMBLEM_SIZE[0], size)) * 10) / 10
      : MAPPING_EMBLEM_SIZE_DEFAULT,
    opacity: clampNumber(source.opacity, [0, 100], 100),
    angle: normalizeDecalAngle(source.angle),
  };
}

export const MAPPING_BRIGHTNESS = Object.freeze([50, 150]);

/* Цвет места по умолчанию, если человек включит «свой цвет». */
const DEFAULT_COLOURS = Object.freeze({
  farm: "#9c5a3c",
  bikers: "#3b3f46",
  plane: "#8d949c",
  carpark: "#6b7280",
  props: "#7a5230",
});

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampNumber = (value, [low, high], fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(high, Math.max(low, number))) : fallback;
};

/* Облик места по умолчанию — как в игре; у работы схемы 1 места без облика
   были «как в моде». */
function normalizeLocation(id, input, legacy = false) {
  const source = plain(input);
  /* Отделку несёт место со штатными моделями (парковка): остальным её поля не нужны, а режим — свой цвет. */
  const finishable = Boolean(findMappingLocation(id)?.stockEdit);
  const mode = MAPPING_MODES.includes(source.mode) ? source.mode : legacy ? "mod" : "stock";
  return {
    mode: MAPPING_FINISH_MODES.includes(mode) && !finishable ? "colour" : mode,
    colour: normalizeRecolourHex(source.colour, DEFAULT_COLOURS[id] || "#808080"),
    brightness: clampNumber(source.brightness, MAPPING_BRIGHTNESS, 100),
    ...(finishable ? normalizeFinishFields(source) : {}),
  };
}

export function createMappingProject() {
  return normalizeMappingProject({});
}

/** Приводит работу в порядок; места, которых в описи нет, отбрасываются. */
export function normalizeMappingProject(input) {
  const source = plain(input);
  const locations = plain(source.locations);
  const legacy = Number.isFinite(Number(source.schema)) && Number(source.schema) < 2;
  return {
    schema: MAPPING_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    locations: Object.fromEntries(MAPPING_LOCATIONS.map((location) => [location.id, normalizeLocation(location.id, locations[location.id], legacy)])),
    emblems: normalizeEmblemList(source, normalizeEmblem),
    /* Свои модели (ТЗ 11.10.2026, вечер, задача 1): у каждой — своё место (`scene`). */
    models: normalizePlaceModels(source.models),
    /* Облик вещей мест — своя модель, цвет или картинка (ТЗ 27.10.2026). */
    items: normalizePlaceItems("mapping", source.items, { modelOf: mappingItemModel }),
  };
}

export const serializeMappingProject = (project) => JSON.stringify(normalizeMappingProject(project));

export function parseMappingProject(text) {
  try {
    return normalizeMappingProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createMappingProject();
  }
}

/** Отпечаток «Применить»: цвет места «как в моде» и «как в игре» в игру не едет. */
export function mappingProjectSignature(input) {
  const project = normalizeMappingProject(input);
  return JSON.stringify({
    ...Object.fromEntries(
      Object.entries(project.locations).map(([id, item]) => [
        id,
        item.mode === "colour" ? { colour: item.colour, brightness: item.brightness } : finishSignature(item) || item.mode,
      ]),
    ),
    ...emblemSignature(project.emblems, (item) => ({
      asset: item.asset,
      location: item.location,
      point: item.point,
      normal: item.normal,
      size: item.size,
      opacity: item.opacity,
      angle: item.angle,
    })),
    ...placeModelsSignatureField(project.models),
    ...(project.items.length ? { items: placeItemsSignature(project.items) } : {}),
  });
}

export function mappingProjectIsMod(input) {
  const project = normalizeMappingProject(input);
  return Object.values(project.locations).every((item) => item.mode === "mod") && !hasEmblems(project.emblems) && !hasPlaceModels(project.models) && !project.items.length;
}

/** «Стандарт»: все места как в игре и эмблем нет — ставить нечего. */
export function mappingProjectIsStock(input) {
  const project = normalizeMappingProject(input);
  return Object.values(project.locations).every((item) => item.mode === "stock") && !hasEmblems(project.emblems) && !hasPlaceModels(project.models) && !project.items.length;
}

/** Сколько мест с моделями мода (как в моде или своим цветом). */
export const mappingModCount = (input) =>
  Object.values(normalizeMappingProject(input).locations).filter((item) => item.mode !== "stock").length;

/* Код для друга: своя картинка живёт в окне автора и в код не едет. */
export function shareableMappingProject(input) {
  const project = normalizeMappingProject(input);
  return { ...project, emblems: shareableEmblems(project.emblems), models: [], items: [] };
}

export function mappingLostInCode(input) {
  const project = normalizeMappingProject(input);
  return joinLostInCode(
    emblemsLostInCode(project.emblems) ? "эмблемы-картинки (остаются на этом компьютере)" : "",
    placeModelsLostInCode(project.models),
    project.items.length ? "свои модели, цвета и картинки вещей (остаются на этом компьютере)" : "",
  );
}

/**
 * Эмблемы на местах: `[{ id, asset, location, point, normal, width, height,
 * opacity, angle }]` в метрах сцены своего места.
 */
export function mappingEmblemDecals(input) {
  return readyEmblems(normalizeMappingProject(input).emblems)
    .filter((item) => item.location)
    .map((item) => emblemDecal(item, { location: item.location }));
}

/**
 * Плашки эмблем в мире: место в координатах игры (сцена места + её начало),
 * обратный кватернион сущности, размер — для `compile-emblem-plates`.
 */
export function mappingEmblemPlates(input) {
  const out = [];
  for (const decal of mappingEmblemDecals(input)) {
    const origin = MAPPING_INVENTORY.scenes.find((scene) => scene.id === decal.location)?.origin;
    if (!origin) continue;
    const place = decalPlacement(decal, { offset: emblemPlateOffset(out.length) });
    out.push({
      id: decal.id,
      asset: decal.asset,
      name: emblemPlateName(MAPPING_PLATE.model, out.length),
      position: place.position.map((value, axis) => Math.round((value + origin[axis]) * 1000) / 1000),
      rotation: place.rotation,
      size: place.size,
      lodDist: MAPPING_PLATE.lodDist,
      opacity: decal.opacity,
    });
  }
  return out;
}

/** Сколько мест перекрашено (свой цвет или отделка). */
export const mappingChangedCount = (input) =>
  Object.values(normalizeMappingProject(input).locations).filter((item) => mappingModePaints(item.mode)).length;

/**
 * Тон места на листе: `{ colour, ref, brightness }` или `null` (как в игре или как в моде).
 * `ref` — опорная яркость листа из описи.
 */
export function mappingTint(input, locationId, ref = 0.5) {
  const project = normalizeMappingProject(input);
  const settings = project.locations[locationId];
  if (!settings || settings.mode !== "colour") return null;
  return { colour: settings.colour, ref: Math.max(0.02, Number(ref) || 0.5), brightness: settings.brightness / 100 };
}

/**
 * Тон листа стен штатного места (парковка, ТЗ 17.10.2026): `{ colour, ref,
 * brightness }` или `null` — место не своим цветом, лист не из стен или у
 * места свой цвет — у моделей мода.
 */
export function mappingStockTint(input, locationId, sheet) {
  const edit = findMappingLocation(locationId)?.stockEdit;
  const record = edit?.sheets[String(sheet || "").toLowerCase()] || edit?.copies[String(sheet || "").toLowerCase()];
  return record ? mappingTint(input, locationId, record.ref) : null;
}

/**
 * Отделка листа стен штатного места (парковка, ТЗ 17.10.2026): `{ settings,
 * ref }` — настройки отделки места и опорная яркость листа — или `null`
 * (место без отделки или лист не из стен).
 */
export function mappingStockFinish(input, locationId, sheet) {
  const edit = findMappingLocation(locationId)?.stockEdit;
  const record = edit?.sheets[String(sheet || "").toLowerCase()] || edit?.copies[String(sheet || "").toLowerCase()];
  const settings = normalizeMappingProject(input).locations[locationId];
  return record && MAPPING_FINISH_MODES.includes(settings?.mode) ? { settings, ref: record.ref } : null;
}

/** Места, где свой цвет или отделка красят штатные модели игры: им нужна игра игрока. */
export const mappingStockEdits = (input) => {
  const project = normalizeMappingProject(input);
  return MAPPING_LOCATIONS.filter((location) => location.stockEdit && mappingModePaints(project.locations[location.id]?.mode));
};
export const mappingStockEdited = (input) => mappingStockEdits(input).length > 0;

/** Всем местам — облик одного (кнопка «Так же у всех мест»). */
export function copyMappingLocationToAll(input, fromId) {
  const project = normalizeMappingProject(input);
  const source = project.locations[fromId];
  if (!source) return project;
  return normalizeMappingProject({
    ...project,
    locations: Object.fromEntries(Object.keys(project.locations).map((id) => [id, { ...source }])),
  });
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const preset = (id, label, description, colours, brightness = 100, location = null) =>
  Object.freeze({ id, label, description, colours: Object.freeze(colours), brightness, ...(location ? { location } : {}) });

/* `colours` — по местам; `*` — всем остальным; `null` — как в моде,
   `"stock"` — как в игре, `"keep"` — место как было. `location` — место,
   что показывает плитка шаблона. */
export const MAPPING_PRESETS = Object.freeze([
  preset("stock", "Стандарт GTA", "Все места как в обычной игре: штатные здания, мод не ставится.", { "*": "stock" }),
  preset("mod", "Как в моде", "Серые места, как у автора мода.", { "*": null }),
  /* Модель сервера 5RP вместо штатной парковки (ТЗ 17.10.2026: «а мод
     перенеси в шаблон»); остальные места как были. */
  preset(
    "carpark-5rp",
    "Парковка 5RP",
    "Модель парковки сервера 5RP вместо штатной. Её ставит сервер: в одиночной игре на месте парковки останется штатная.",
    { carpark: null, "*": "keep" },
    100,
    "carpark",
  ),
  preset("warm", "Тёплое дерево", "Ферма и трейлеры в тёплых древесных тонах.", {
    farm: "#9c5a3c",
    bikers: "#7a5230",
    plane: "#a08060",
    carpark: "#8d7b68",
    "*": "#7a5230",
  }),
  preset("desert", "Пустыня", "Выгоревший песок и ржавчина.", {
    farm: "#c2a878",
    bikers: "#b08a5a",
    plane: "#c9b38a",
    carpark: "#b8a68a",
    "*": "#9a6a3a",
  }),
  preset("red-barn", "Красный амбар", "Амбары красные, остальное — светлое.", {
    farm: "#9e2b25",
    bikers: "#d8d2c4",
    plane: "#d8d2c4",
    carpark: "#c9c4b8",
    "*": "#6d6a64",
  }),
  preset("bikers", "Байкерский", "Тёмные трейлеры, хром и чёрное.", {
    bikers: "#2b2d31",
    farm: "#4a4a4a",
    plane: "#3a3d42",
    carpark: "#2f3136",
    "*": "#1f2023",
  }),
  preset("pastel", "Пастель", "Светлые мягкие цвета — видно издалека.", {
    farm: "#e8c4b8",
    bikers: "#b8d8e8",
    plane: "#d8e8b8",
    carpark: "#e8e0b8",
    "*": "#d0c8e8",
  }, 110),
  preset("bright", "Яркий", "Каждое место своим сочным цветом.", {
    farm: "#e0402a",
    bikers: "#2f6bff",
    plane: "#ffb000",
    carpark: "#18a558",
    "*": "#9b5cff",
  }),
]);

export const findMappingPreset = (id) => MAPPING_PRESETS.find((item) => item.id === id) || null;

export function applyMappingPreset(input, presetId) {
  const project = normalizeMappingProject(input);
  const found = findMappingPreset(presetId);
  if (!found) return project;
  const locations = {};
  for (const [id, item] of Object.entries(project.locations)) {
    const colour = id in found.colours ? found.colours[id] : found.colours["*"];
    if (colour === "keep") locations[id] = { ...item };
    else if (colour === "stock") locations[id] = { ...item, mode: "stock" };
    else locations[id] = colour ? { mode: "colour", colour, brightness: found.brightness } : { ...item, mode: "mod" };
  }
  /* Готовый вид меняет цвета мест, эмблема остаётся. */
  return normalizeMappingProject({ ...project, locations });
}

export function matchingMappingPreset(input) {
  /* Узнаётся по цветам мест: эмблема готовым видом не задаётся. */
  const colours = (value) => {
    const signature = JSON.parse(mappingProjectSignature(value));
    delete signature.emblem;
    delete signature.emblems;
    return JSON.stringify(signature);
  };
  const own = colours(input);
  return MAPPING_PRESETS.find((item) => colours(applyMappingPreset(input, item.id)) === own)?.id || null;
}
