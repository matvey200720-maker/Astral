/*
 * Слова и облик кадра редактора «Интерьеры» — отдельно от компонентов: их
 * берут кадр, колонка правок, шаблоны и обложка.
 *
 * Облик листа в кадре повторяет установщик (`recolor-shops.js`):
 *   «Как в игре» — лист как в игре игрока;
 *   свой цвет — тоном по светотени листа, эффект — полосой вдоль развёртки
 *     (`surfaceLook` зданий — та же арифметика, что у их установщика);
 *   блеск (ТЗ 12.10.2026, задача 2) — чистота листа той же арифметикой,
 *     что у установщика (`shops-shine.js` → шейдер кадра `uRcClean`), глянец
 *     и зеркало — гладкостью материала (блик кадра — студийный).
 * Лист поверхности кадр узнаёт по записи материала сцены (`surface`): сцену
 * собирает `scripts/prepare-shops.mjs` теми же листами, что правит установщик.
 */

import * as THREE from "three";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { shownPlaceModels } from "@modovik/climb-contract/recolor/place-models";
import {
  SHOP_CATEGORIES,
  SHOP_INTERIOR_LIST,
  SHOP_SOURCES,
  SHOP_SURFACES,
  changedShopInteriors,
  normalizeShopsProject,
  shopHiddenItems,
  shopInterior,
  shopShine,
  shopSurfacesOf,
  shopSwappedItems,
} from "@modovik/climb-contract/recolor/shops";
import { OUTSIDE_KINDS, OUTSIDE_SURFACE_MODES, changedOutsidePlaces, outsidePlacesOf, pumpsChanged, shopOutsidePlace } from "@modovik/climb-contract/recolor/shops-outside";
import { surfaceLook } from "../building-editor/building-text.js";
import { currentUiLanguage, tr } from "../../../locales/ui.js";

/* Быстрые цвета: светлые и тёмные отделки и яркие для своих. */
export const SHOP_SWATCHES = Object.freeze([
  "#f4f2ec",
  "#d8d2c4",
  "#9a958c",
  "#4a4744",
  "#1b1b1e",
  "#c9a27a",
  "#8a5a36",
  "#2f80ed",
  "#27ae60",
  "#f2c94c",
  "#e30613",
  "#9b51e0",
]);

/* Отделка мест снаружи (фасады, навесы, колонки): цвет, «Без текстуры», узор, картинка, градиент — изнутри только цвет и блеск (решение владельца 12.10.2026). */
const OUTSIDE_MODE_LABELS = Object.freeze({ standard: "Как в игре", colour: "Свой цвет", flat: "Без текстуры", pattern: "Узор", image: "Картинка", gradient: "Градиент" });
/** Режимы отделки частей места снаружи — `[[режим, подпись]]`, подписи переводом в месте отрисовки. */
export const outsideModeOptions = () => OUTSIDE_SURFACE_MODES.map((mode) => [mode, tr(OUTSIDE_MODE_LABELS[mode])]);

export const surfaceLabel = (id) => SHOP_SURFACES.find((item) => item.id === id)?.label || id;
export const categoryLabel = (id) => SHOP_CATEGORIES.find((item) => item.id === id)?.label || id;

/*
 * Слово при числе: «1 магазин», «3 магазина», «9 магазинов». Три формы — одна, «две-четыре» и «пять и больше»; форму выбирает правило
 * множественного числа языка окна (у en, de, fr форм две, и категория `other` берёт третью; у pl «21» — уже «много»).
 */
const pluralRules = {};
export function plural(count, [one, few, many]) {
  const language = currentUiLanguage();
  const rules = (pluralRules[language] ||= new Intl.PluralRules(language));
  return { one, few, many }[rules.select(count)] || many;
}
/** Шаблон словаря со вставками: `fill(tr("Облик «{0}» — {1}"), a, b)`. */
export const fill = (template, ...values) => String(template).replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));

export const placesText = (count) => `${count} ${plural(count, [tr("место"), tr("места"), tr("мест")])} на карте`;

/** Подпись помещения с местом: «24/7 — 9 мест на карте». */
export function interiorLine(interior) {
  const count = interior?.instances?.length || 0;
  return count ? placesText(count) : tr("в игре не расставлено");
}

/* Основа слова для сравнения подписей: «Барбершопы» и «Барбершоп», «Тату-салоны» и «Тату-салон». */
const stems = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[\s:·,()]+/)
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 5));

/**
 * Подпись помещения на кнопке меню над кадром: «Одежда · Binco», «Банки ·
 * Fleeca». Раздел не повторяется, если помещение уже им названо: «24/7», а
 * не «Магазины 24/7 · 24/7»; «Ammu-Nation с тиром», «Барбершоп».
 */
export function interiorTitle(interior) {
  const label = interior?.label || "Помещение";
  const category = categoryLabel(interior?.category);
  const own = new Set(stems(label));
  /* Сравнение — по русским подписям описи, вывод — переводом (данные модуля переводятся в месте отрисовки). */
  return stems(category).some((stem) => own.has(stem)) ? tr(label) : `${tr(category)} · ${tr(label)}`;
}

/*
 * Пункты меню выбора помещения над кадром: разделы — заголовками групп,
 * помещения — пунктами с числом мест. Раздел без помещений в этой версии
 * описи не показывается. Снаружи (17.10.2026) у каждого вида — пункт «… —
 * снаружи», у заправок — «Станции снаружи»; помещение изнутри подписано
 * «— внутри» (кроме LTD при заправке).
 */
export function interiorMenuOptions(project = null) {
  const changed = new Set(project ? changedShopInteriors(project) : []);
  const options = [];
  /* Снаружи: виды мест, у которых что-то меняется (колонки — общий облик, у заправок). */
  const outsideChanged = new Set(project ? changedOutsidePlaces(project.outside).map((id) => shopOutsidePlace(id)?.kind) : []);
  if (project && pumpsChanged(project.outside)) outsideChanged.add("gas");
  const outside = (kind, label) => {
    const count = outsidePlacesOf(kind).length;
    return {
      value: `out:${kind}`,
      label,
      description: `${kind === "gas" ? tr("колонки, навесы, киоски, вывески") : tr("фасад и вывески")} · ${count} ${plural(count, [tr("место"), tr("места"), tr("мест")])}${outsideChanged.has(kind) ? tr(" · есть изменения") : ""}`,
    };
  };
  /* Источники (штатные, потом «Проекты»): пока он один — переключателя нет, разделы идут как шли. */
  const sources = SHOP_SOURCES.filter((source) => SHOP_CATEGORIES.some((category) => category.source === source.id && SHOP_INTERIOR_LIST.some((item) => item.category === category.id)));
  for (const category of SHOP_CATEGORIES) {
    const interiors = SHOP_INTERIOR_LIST.filter((item) => item.category === category.id);
    if (!interiors.length) continue;
    if (options.length) options.push({ separator: true });
    const source = sources.length > 1 ? SHOP_SOURCES.find((item) => item.id === category.source) : null;
    options.push({ heading: source ? `${tr(source.label)} · ${tr(category.label)}` : tr(category.label) });
    if (category.id === "gas" && OUTSIDE_KINDS.includes("gas")) options.push(outside("gas", tr("Станции снаружи")));
    for (const interior of interiors) {
      options.push({
        value: interior.id,
        label: category.id === "gas" ? tr(interior.label) : fill(tr("{0} — внутри"), tr(interior.label)),
        description: `${interiorLine(interior)}${changed.has(interior.id) ? tr(" · есть изменения") : ""}`,
      });
      if (category.id !== "gas" && OUTSIDE_KINDS.includes(interior.id)) options.push(outside(interior.id, fill(tr("{0} — снаружи"), tr(interior.label))));
    }
  }
  return options;
}

/* ------------------------------------------------------------------ *
 * Облик листа в кадре
 * ------------------------------------------------------------------ */

/* Ровный цвет листом 1×1: «Без текстуры» у мест снаружи (изнутри его нет с ТЗ 12.10.2026). */
const solids = new Map();
function solidTexture(hex) {
  if (solids.has(hex)) return solids.get(hex);
  const value = parseInt(String(hex).slice(1), 16);
  const texture = new THREE.DataTexture(new Uint8Array([(value >> 16) & 255, (value >> 8) & 255, value & 255, 255]), 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  if (solids.size > 32) solids.delete(solids.keys().next().value);
  solids.set(hex, texture);
  return texture;
}

/**
 * Облик материала сцены помещения: `look` — облик помещения в работе,
 * `info` — запись материала (`surface` — стена, пол, потолок, вещь или
 * ничего), `finishes` — текстуры отделки поверхностей по их id (снаружи).
 */
export function shopFrameLook(look, info, { finishes = {} } = {}) {
  /* Свечение — множитель шейдера игры (сцена из игры, задача 5 ТЗ 11.10.2026). */
  const emission = info.emissive ? (info.emission ?? 0.6) : 0;
  /* Зеркало: отражения игры у кадра нет — гладкий металл отражает студию. */
  if (info.mirror) return { colour: "#aeb6bc", map: false, roughness: 0.06, metalness: 0.92 };
  /* Затенение `decal_dirt` (тени под полками, грязь) — как у игры: темнит то, что под ним. */
  if (info.dirt) return { colour: info.colour, dirt: 1 };
  const surface = info.surface ? look?.surfaces?.[info.surface] : null;
  if (!surface) return { colour: info.colour, emission };
  /* Блеск: чистый лист — тем же расчётом, что у установщика; глянец и зеркало — гладкий материал. */
  const shine = shopShine(surface.shine);
  const shineLook = {
    ...(shine.clean ? { clean: { amount: shine.clean, lift: shine.lift } } : {}),
    ...(shine.roughness !== null ? { roughness: shine.roughness, metalness: shine.id === "mirror" ? 0.12 : 0.04, room: true, roomIntensity: shine.reflection } : {}),
  };
  if (surface.mode === "standard") return { colour: info.colour, emission, ...shineLook };
  /* Места снаружи (`shops-outside-text.js`) — ещё и «Без текстуры», узор, картинка, градиент. */
  if (surface.mode === "flat") {
    const colour = normalizeColourEffect(surface.look).colour;
    return { colour: info.colour, finish: { texture: solidTexture(colour), mode: "uv", uv: [1, 1, 0, 0], shade: 0, ref: 0.5 }, emission, ...shineLook };
  }
  /* Свой цвет — тоном по светотени листа, эффект — полосой вдоль развёртки (как у зданий). */
  return { ...surfaceLook(surface, info, finishes[info.surface] || null), emission, ...shineLook };
}

/* Поверхность вещи: прилавок, полки, мебель, техника — у помещения, где её листы правятся. */
const ITEM_SURFACES = Object.freeze({ counter: "counter", shelves: "shelves", furniture: "furniture", atm: "equipment", vending: "equipment", fridges: "equipment" });

/** Поверхность «Цвета и блеска» вещи помещения (номер сущности) или `null`. */
export function itemSurfaceOf(interiorId, index) {
  const item = shopInterior(interiorId)?.items.find((entry) => entry.index === index);
  const surface = ITEM_SURFACES[item?.group];
  return surface && shopSurfacesOf(interiorId).some((entry) => entry.id === surface) ? surface : null;
}

/** Видимые части сцены: все, кроме убранных вещей (`null` — все). */
export function visibleParts(asset, project, interiorId) {
  if (!asset) return null;
  /* Заменённая вещь в кадре — коробкой новой модели (`swapBoxes`), прежней модели нет. */
  const hidden = new Set([...shopHiddenItems(project, interiorId), ...shopSwappedItems(project, interiorId)].map((item) => item.index));
  if (!hidden.size) return null;
  return asset.parts.map((part, index) => (hidden.has(part.entity) ? -1 : index)).filter((index) => index >= 0);
}

/** Строка состояния кадра: что ставится (помещения изнутри, места и колонки снаружи, свои модели). */
export function shopsPlanText(project) {
  const normalized = normalizeShopsProject(project);
  const changed = changedShopInteriors(normalized);
  const models = shownPlaceModels(normalized.models).length;
  const outside = changedOutsidePlaces(normalized.outside).length;
  const tail = [
    outside ? fill(tr("снаружи — {0}"), `${outside} ${plural(outside, [tr("место"), tr("места"), tr("мест")])}`) : "",
    pumpsChanged(normalized.outside) ? tr("колонки заправок") : "",
    models ? fill(tr("свои модели — {0}"), models) : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!changed.length) return tail ? fill(tr("Помещения как в игре; в игру уедут: {0}."), tail) : tr("Все помещения как в игре — ставить нечего.");
  const names = changed.map((id) => tr(shopInterior(id)?.label || id));
  const more = names.length > 4 ? fill(tr(" и ещё {0}"), names.length - 4) : "";
  return fill(tr("В игру уедут: {0}."), `${names.slice(0, 4).join(", ")}${more}${tail ? `; ${tail}` : ""}`);
}

/**
 * Строка состояния кадра помещения со своими моделями: в игре они встают в само
 * помещение — во все его места на карте сразу (сцена — в осях помещения).
 */
export function shopModelsText(interior, count) {
  const places = interior?.instances?.length || 0;
  const label = tr(interior?.label || "помещение");
  return places > 1
    ? fill(tr("Своих моделей здесь: {0}. В игре они встают в само помещение — во все «{1}» сразу ({2})."), count, label, placesText(places))
    : fill(tr("Своих моделей здесь: {0}. В игре они встают в само помещение — во все «{1}» сразу на карте."), count, label);
}
