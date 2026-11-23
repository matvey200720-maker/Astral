/*
 * «Интерьеры» — облик магазинов и заведений изнутри (задача 3 ТЗ 10.10.2026).
 *
 * Магазин одного вида в GTA V — одно помещение игры (`shops-catalog.js`),
 * расставленное по карте экземплярами. Работа держит облик каждого
 * помещения (`interiors[<помещение>]`):
 *
 *   surfaces — стены, пол и потолок, прилавок, полки, мебель, банкоматы
 *              с автоматами и холодильниками: «Как в игре» или свой цвет
 *              (эффект мастерской) и блеск (`shine`: как в игре, чистая,
 *              глянец, зеркало — `shops-shine.js`).
 *
 * ТЗ 12.10.2026, задача 2 (владелец): «в интерьерах — только цвет пола,
 * стен, потолка и самого интерьера, полок, магазинчиков, банкоматов …
 * текстурки менять не нужно, это получается плохо … и убирать текстуры —
 * тоже убери, чтобы ничего не пропадало». Узоры, свои картинки, «Без
 * текстуры», убранные и заменённые вещи прежних работ при открытии
 * отпадают: «Без текстуры» становится своим цветом, остальное — как в игре.
 * Поля `hidden`, `removed`, `swaps` облика остались (их читает установщик),
 * но всегда пусты.
 *
 * В игре облик помещения — правка его файлов (листы оболочки и список
 * сущностей интерьера, `apps/desktop/src/recolor-shops.js`), поэтому он
 * ложится на все экземпляры сразу: все девять 24/7, все шесть Fleeca.
 * Исходный облик — «Стандарт» (всё как в игре): ставить нечего,
 * «Применить» снимает установку.
 *
 * Свои модели (ТЗ 11.10.2026, вечер, задача 1) — один список работы
 * `models` (`place-models.js`), сцена модели — помещение изнутри (`shop247`:
 * оси помещения, модель встаёт сущностью его MLO — во все магазины вида) или
 * место снаружи (`shop247-1961_3745`: начало сцены места, своя карта).
 *
 * 12.10.2026 улицу из окна убрали (владелец: «редактировать только внутри»),
 * 17.10.2026 (ТЗ, вечер, задача 5) владелец просит вернуть покраску снаружи
 * — фасады и вывески, заправки: часть «снаружи» (`shops-outside.js`) снова
 * правится в окне целиком. Колонки заправок — один облик на все станции
 * (копию колонки на станцию окно больше не ставит: сервер может узнавать
 * колонку по модели). Изнутри по-прежнему только цвет и блеск.
 */

import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import SHOPS_INVENTORY from "./inventory/shops.js";
import { hasPlaceModels, joinLostInCode, normalizePlaceModels, placeModelsLostInCode, placeModelsSignatureField } from "./place-models.js";
import { SHOP_CATEGORIES, SHOP_INTERIORS, SHOP_ITEM_GROUP_IDS, SHOP_ITEM_GROUPS, SHOP_SOURCES, SHOP_SURFACE_IDS, SHOP_SURFACES, shopCategorySource } from "./shops-catalog.js";
import { shopKitsOf, shopModelBox, shopSwapFit, shopSwapPair, shopSwapTargets } from "./shops-kits.js";
import { normalizeShopLight, shopLightIsStock, shopLightSignature } from "./shops-light.js";
import { SHOP_SHINE_IDS, SHOP_SHINES, shopShine } from "./shops-shine.js";
import {
  normalizeShopsOutside,
  outsideEmblemDecals,
  outsideHasImages,
  outsideImageAssets,
  outsideIsStock,
  outsideSignature,
  shareableOutside,
  shopOutsidePlace,
  stockOutside,
} from "./shops-outside.js";

export { SHOPS_INVENTORY, SHOP_CATEGORIES, SHOP_INTERIORS, SHOP_ITEM_GROUPS, SHOP_ITEM_GROUP_IDS, SHOP_SOURCES, SHOP_SURFACES, SHOP_SURFACE_IDS, shopCategorySource };
export { shopKitsOf, shopSwapFit, shopSwapPair, shopSwapTargets };
export { SHOP_SHINE_IDS, SHOP_SHINES, shopShine };
export { SHOP_LIGHT_INTENSITY, SHOP_LIGHT_MODES, SHOP_LIGHT_SWATCHES, normalizeShopLight, shopLightCount, shopLightIsStock, shopLightModels, shopLightMutations } from "./shops-light.js";

/* 2 — второй заход (задача 3 ТЗ 10.10.2026): снаружи — заправки и фасады (`outside`). */
export const SHOPS_PROJECT_SCHEMA = 2;
const NAME_LIMIT = 60;

/* Помещения описи — в порядке каталога; чего нет в описи этой версии, того нет и здесь. */
const byId = new Map(SHOPS_INVENTORY.interiors.map((item) => [item.id, item]));
export const SHOP_INTERIOR_LIST = Object.freeze(SHOP_INTERIORS.map((item) => byId.get(item.id)).filter(Boolean));
export const SHOP_INTERIOR_LIST_IDS = Object.freeze(SHOP_INTERIOR_LIST.map((item) => item.id));
export const shopInterior = (id) => byId.get(id) || null;
export const shopInteriorsOf = (category) => SHOP_INTERIOR_LIST.filter((item) => item.category === category);

/* Поверхность изнутри — как в игре или свой цвет (ТЗ 12.10.2026, задача 2: текстур больше нет). */
export const SHOP_SURFACE_MODES = Object.freeze(["standard", "colour"]);
export const SHOP_SURFACE_LABELS = Object.freeze({
  standard: "Как в игре",
  colour: "Свой цвет",
});

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

function normalizeSurface(surfaceId, input) {
  const source = plain(input);
  const colour = SHOP_SURFACES.find((item) => item.id === surfaceId)?.colour || "#9a958c";
  return {
    /* «Без текстуры» прежних работ — тот же цвет, но по светотени листа; узор и картинка — как в игре. */
    mode: source.mode === "flat" ? "colour" : choice(source.mode, SHOP_SURFACE_MODES, "standard"),
    look: normalizeColourEffect(lookOf(source), { colour, colour2: "#ffffff", direction: "height" }),
    shine: choice(source.shine, SHOP_SHINE_IDS, "game"),
  };
}

/** Облик одного помещения: поверхности и свет ламп (убранных и заменённых вещей больше нет). */
export function normalizeShopLook(interiorId, input) {
  const source = plain(input);
  return {
    surfaces: Object.fromEntries(SHOP_SURFACE_IDS.map((id) => [id, normalizeSurface(id, plain(source.surfaces)[id])])),
    /* Свет ламп помещения (ТЗ 17.10.2026): цвет и сила; «как в игре» — ничего не едет. */
    light: normalizeShopLight(source.light),
    hidden: [],
    removed: [],
    swaps: {},
  };
}

export function normalizeShopsProject(input) {
  const source = plain(input);
  const interiors = plain(source.interiors);
  return {
    schema: SHOPS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    interiors: Object.fromEntries(SHOP_INTERIOR_LIST_IDS.map((id) => [id, normalizeShopLook(id, interiors[id])])),
    /* Снаружи: места (станции и фасады магазинов) и колонки заправок (`shops-outside.js`). */
    outside: normalizeShopsOutside(source.outside),
    /* Свои модели (ТЗ 11.10.2026, вечер, задача 1): изнутри и снаружи одним списком. */
    models: normalizePlaceModels(source.models),
  };
}

/**
 * Сцена своей модели: `{ inside: помещение }` — сцена помещения (оси его
 * MLO, общие для всех магазинов вида), `{ outside: место }` — сцена места
 * снаружи (её начало в мире — `scene.origin`), `null` — сцены нет.
 */
export function shopModelScene(scene) {
  const interior = shopInterior(String(scene || ""));
  if (interior?.scene && interior.ytyp?.at && interior.mlo) return { inside: interior };
  const place = shopOutsidePlace(String(scene || ""));
  return place?.scene?.origin ? { outside: place } : null;
}

export const createShopsProject = () => normalizeShopsProject({});
export const serializeShopsProject = (project) => JSON.stringify(normalizeShopsProject(project));

export function parseShopsProject(text) {
  try {
    return normalizeShopsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createShopsProject();
  }
}

/** Облик помещения в работе (нормализованный). */
export const shopLookOf = (input, interiorId) => normalizeShopsProject(input).interiors[interiorId] || normalizeShopLook(interiorId, {});

const surfaceIsStock = (surface) => surface.mode === "standard" && (surface.shine || "game") === "game";
export const shopLookIsStock = (look) => SHOP_SURFACE_IDS.every((id) => surfaceIsStock(look.surfaces[id])) && shopLightIsStock(look.light);

/** Все помещения как в игре: ставить нечего. */
export function shopsProjectIsStock(input) {
  const project = normalizeShopsProject(input);
  return Object.values(project.interiors).every(shopLookIsStock) && outsideIsStock(project.outside) && !hasPlaceModels(project.models);
}

/** Помещения, чей облик уходит в игру. */
export const changedShopInteriors = (input) =>
  Object.entries(normalizeShopsProject(input).interiors)
    .filter(([, look]) => !shopLookIsStock(look))
    .map(([id]) => id);

/* Что из облика поверхности меняет файлы. Блеск — только когда не «как в игре»: отпечаток прежних работ прежний. */
function surfaceSignature(surface) {
  const shine = surface.shine && surface.shine !== "game" ? { shine: surface.shine } : {};
  if (surface.mode === "standard") return shine.shine ? { mode: "standard", ...shine } : null;
  return { mode: surface.mode, look: surface.look, ...shine };
}

/** Отпечаток для очереди «Применить»: тот же облик помещений — тот же отпечаток. */
export function shopsProjectSignature(input) {
  const project = normalizeShopsProject(input);
  const interiors = Object.fromEntries(
    Object.entries(project.interiors)
      .filter(([, look]) => !shopLookIsStock(look))
      .map(([id, look]) => [
        id,
        {
          /* Прилавок, полки, мебель (задача 5 ТЗ 11.10.2026) — только когда правятся: отпечаток прежних работ прежний. */
          surfaces: Object.fromEntries(
            SHOP_SURFACES.map((surface) => [surface.id, surfaceSignature(look.surfaces[surface.id])]).filter(([, signature], index) => signature || !SHOP_SURFACES[index].items),
          ),
          hidden: look.hidden,
          removed: look.removed,
          /* Свет — только когда правится: отпечаток прежних работ прежний. */
          ...(shopLightIsStock(look.light) ? {} : { light: shopLightSignature(look.light) }),
        },
      ]),
  );
  /* Без правок снаружи и своих моделей отпечаток — прежний: поставленные работы первого захода не пересобираются. */
  const models = placeModelsSignatureField(project.models);
  if (outsideIsStock(project.outside) && !models.models) return JSON.stringify(interiors);
  return JSON.stringify({ interiors, ...(outsideIsStock(project.outside) ? {} : { outside: outsideSignature(project.outside) }), ...models });
}

/** Облик помещения «Стандарт»: всё как в игре; свои цвета панель помнит. */
export function stockShopLook(look) {
  return {
    ...look,
    surfaces: Object.fromEntries(SHOP_SURFACE_IDS.map((id) => [id, { ...look.surfaces[id], mode: "standard", shine: "game" }])),
    light: { ...look.light, mode: "standard" },
    hidden: [],
    removed: [],
    swaps: {},
  };
}

/** «Стандарт» всей работы: все помещения как в игре. */
export function applyShopsStandard(input) {
  const project = normalizeShopsProject(input);
  return { ...project, interiors: Object.fromEntries(Object.entries(project.interiors).map(([id, look]) => [id, stockShopLook(look)])), outside: stockOutside(project.outside) };
}

export const resetShopsProject = (input) => ({ ...createShopsProject(), name: normalizeShopsProject(input).name });

/* Картинки человека в код не едут: картинки — только у мест снаружи. */
export function shareableShopsProject(input) {
  const project = normalizeShopsProject(input);
  return { ...project, outside: shareableOutside(project.outside), models: [] };
}

export function shopsLostInCode(input) {
  const project = normalizeShopsProject(input);
  return joinLostInCode(outsideHasImages(project.outside) ? "свои картинки (остаются на этом компьютере)" : "", placeModelsLostInCode(project.models));
}

/** Свои картинки работы, которые нужны установщику (`Map` ключ → имя): изнутри картинок нет — только у мест снаружи. */
export function shopsImageAssets(input) {
  return new Map(outsideImageAssets(normalizeShopsProject(input).outside));
}

/** Эмблемы и надписи на фасадах, что уходят в игру (картинки — установщику). */
export const shopsEmblemDecals = (input) => outsideEmblemDecals(normalizeShopsProject(input).outside);

/**
 * Номера сущностей помещения, что уходят из игры: вещи убранных групп и
 * убранные по одной. `[{ index, model, group }]` по возрастанию номера.
 */
export function shopHiddenItems(input, interiorId) {
  const look = shopLookOf(input, interiorId);
  const interior = shopInterior(interiorId);
  const groups = new Set(look.hidden);
  const removed = new Set(look.removed);
  return (interior?.items || []).filter((item) => groups.has(item.group) || removed.has(item.index)).sort((a, b) => a.index - b.index);
}

/** Рамка модели вещи или каталога замены: `{ min, max, bz, size }` (м, в осях модели) или `null`. */
export function shopModelSize(model) {
  const box = shopModelBox(model);
  return box ? { ...box, bz: box.min[2], size: box.max.map((value, axis) => Math.round((value - box.min[axis]) * 1000) / 1000) } : null;
}

/**
 * Заменённые вещи помещения: `[{ index, model, to, group, fit }]`. С ТЗ
 * 12.10.2026 (задача 2) замен у помещений нет — список всегда пуст; функцию
 * читают кадр и установщик.
 */
export function shopSwappedItems(input, interiorId) {
  const look = shopLookOf(input, interiorId);
  return (shopInterior(interiorId)?.items || [])
    .filter((item) => look.swaps[item.index])
    .map((item) => {
      const to = look.swaps[item.index];
      return { ...item, to, fit: shopSwapFit(item.model, to, shopSwapPair(item.model, to) || {}) };
    })
    .filter((item) => item.fit);
}

/** Вещи помещения группы: `[{ index, model, group, room }]`. */
export const shopGroupItems = (interiorId, groupId) => (shopInterior(interiorId)?.items || []).filter((item) => item.group === groupId);

/** Группы вещей помещения, что у него есть (в порядке каталога), с числом вещей. */
export function shopGroupsOf(interiorId) {
  const items = shopInterior(interiorId)?.items || [];
  return SHOP_ITEM_GROUPS.map((group) => ({ ...group, count: items.filter((item) => item.group === group.id).length })).filter((group) => group.count);
}

/** Поверхности, что есть у помещения: стены, пол, потолок — всегда, части-вещи — где их листы меняет оно одно. */
export const shopSurfacesOf = (interiorId) => {
  const interior = shopInterior(interiorId);
  return SHOP_SURFACES.filter((surface) => !surface.items || interior?.surfaces?.[surface.id]?.length);
};

/* ------------------------------------------------------------------ *
 * Один облик — на несколько помещений
 * ------------------------------------------------------------------ */

/** Облик помещения `fromId` — на помещения `toIds`: цвет и блеск всех поверхностей. */
export function copyShopLook(input, fromId, toIds) {
  const project = normalizeShopsProject(input);
  const from = project.interiors[fromId];
  if (!from) return project;
  const interiors = { ...project.interiors };
  for (const id of toIds) {
    if (id === fromId || !interiors[id]) continue;
    /* Свет ламп у помещения остаётся своим: на другие помещения едут цвет и блеск поверхностей. */
    interiors[id] = normalizeShopLook(id, { surfaces: from.surfaces, light: interiors[id].light });
  }
  return { ...project, interiors };
}

/* ------------------------------------------------------------------ *
 * Готовые облики
 * ------------------------------------------------------------------ */

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "height", width: 2, shift: 0 });
/* Поверхность готового облика: свой цвет (или как в игре — `null`) и блеск. */
const paint = (hex, shine = "game") => (hex ? { mode: "colour", look: solid(hex), shine } : { mode: "standard", shine });

/*
 * Готовый облик — цвет и блеск поверхностей помещения (ТЗ 12.10.2026,
 * задача 2: только цвет и «плитка — яркая, как будто бы зеркалила, идеально
 * чистая»). Ложится на взятое помещение; поверхности, которых у помещения
 * нет, пропускаются.
 */
export const SHOPS_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Помещение Rockstar без правок", surfaces: {} },
    {
      id: "clean",
      label: "Идеально чисто",
      description: "Цвета игры, но без грязи и пятен — пол, стены и потолок как новые",
      surfaces: { walls: paint(null, "clean"), floor: paint(null, "clean"), ceiling: paint(null, "clean") },
    },
    {
      id: "gloss",
      label: "Глянцевый пол",
      description: "Пол игры чистый и блестит, стены чистые",
      surfaces: { walls: paint(null, "clean"), floor: paint(null, "gloss"), ceiling: paint(null, "clean") },
    },
    {
      id: "mirror",
      label: "Зеркальный пол",
      description: "Пол отражает зал, как только что вымытый кафель",
      surfaces: { walls: paint(null, "clean"), floor: paint(null, "mirror"), ceiling: paint(null, "clean") },
    },
    {
      id: "minimal",
      label: "Светлый минимализм",
      description: "Белые стены, светлый зеркальный пол, белые полки",
      surfaces: {
        walls: paint("#eeece6", "clean"),
        floor: paint("#f1ede4", "mirror"),
        ceiling: paint("#f7f6f2", "clean"),
        shelves: paint("#f4f2ec", "gloss"),
        counter: paint("#f4f2ec", "gloss"),
      },
    },
    {
      id: "loft",
      label: "Тёмный лофт",
      description: "Графитовые стены, тёмный глянцевый пол, чёрный потолок",
      surfaces: { walls: paint("#4a4744", "clean"), floor: paint("#2c2b2a", "gloss"), ceiling: paint("#1c1c1f"), counter: paint("#1b1b1e", "gloss") },
    },
    {
      id: "wood",
      label: "Тёплое дерево",
      description: "Тёплые стены, медовый пол с бликом, светлый потолок",
      surfaces: { walls: paint("#c9a27a", "clean"), floor: paint("#8a5a36", "gloss"), ceiling: paint("#efe4d2", "clean"), shelves: paint("#a0764c") },
    },
    {
      id: "premium",
      label: "Мрамор и золото",
      description: "Сливочные стены, зеркальный светлый пол, золотой прилавок",
      surfaces: {
        walls: paint("#efe6d2", "clean"),
        floor: paint("#ece8e3", "mirror"),
        ceiling: paint("#fbf8f1", "clean"),
        counter: paint("#c9a227", "gloss"),
        shelves: paint("#c9a227", "gloss"),
        equipment: paint("#1b1b1e", "gloss"),
      },
    },
    {
      id: "neon",
      label: "Неон",
      description: "Стены градиентом бирюзы и розового, чёрный зеркальный пол",
      surfaces: {
        walls: { mode: "colour", look: { mode: "gradient", colour: "#2ee6ff", colour2: "#ff2e97", direction: "along", width: 2, shift: 0 }, shine: "gloss" },
        floor: paint("#121216", "mirror"),
        ceiling: paint("#0d0d10"),
        equipment: paint("#ff2e97", "gloss"),
      },
    },
  ].map((item) => Object.freeze(item)),
);

/** Облик помещения с готовым обликом: его поверхности, остальные — как в игре. */
export function applyShopsPreset(input, interiorId, presetId) {
  const project = normalizeShopsProject(input);
  const preset = SHOPS_PRESETS.find((item) => item.id === presetId);
  const look = project.interiors[interiorId];
  if (!preset || !look) return project;
  const stock = stockShopLook(look);
  const next = normalizeShopLook(interiorId, {
    surfaces: Object.fromEntries(SHOP_SURFACE_IDS.map((id) => [id, { ...stock.surfaces[id], ...(preset.surfaces[id] || {}) }])),
    /* Готовый облик — поверхности; свет ламп остаётся, каким был. */
    light: look.light,
  });
  return { ...project, interiors: { ...project.interiors, [interiorId]: next } };
}

/** Готовый облик, с которым совпадает помещение, или `null`. */
export function matchingShopsPreset(input, interiorId) {
  const project = normalizeShopsProject(input);
  const current = JSON.stringify(lookSignature(project.interiors[interiorId]));
  return SHOPS_PRESETS.find((preset) => JSON.stringify(lookSignature(applyShopsPreset(project, interiorId, preset.id).interiors[interiorId])) === current)?.id || null;
}

function lookSignature(look) {
  if (!look) return null;
  return Object.fromEntries(SHOP_SURFACE_IDS.map((id) => [id, surfaceSignature(look.surfaces[id])]));
}
