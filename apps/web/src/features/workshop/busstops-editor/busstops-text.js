/*
 * Слова и облик кадра редактора «Остановки» — отдельно от компонентов: их
 * берут кадр, колонка правок, шаблоны и обложка.
 *
 * Облик листа в кадре повторяет установщик (`recolor-busstops.js`):
 *   «Стандарт» — лист как в игре игрока;
 *   свой цвет — тоном по светотени листа, эффект — полосой вдоль развёртки
 *     (`surfaceLook` зданий — та же арифметика, что у их установщика);
 *   «Без текстуры» — ровный цвет, альфа листа (стекло) остаётся;
 *   узор, картинка, градиент — общей отделкой по развёртке;
 *   прозрачность — альфа × прозрачность остановки, как у прозрачных
 *     шейдеров игры.
 */

import * as THREE from "three";
import {
  BUSSTOP_CAPPED_PARTS,
  BUSSTOP_HIGHLIGHT_CAP,
  BUSSTOP_OPACITY,
  BUSSTOP_PARTS,
  BUSSTOP_SURFACE_LABELS,
  BUSSTOP_SURFACE_MODES,
  BUSSTOP_TYPES,
  BUSSTOP_TYPE_IDS,
  busStopLiveState,
  busStopLookOf,
  busStopPlate,
  normalizeBusStopsProject,
} from "@modovik/climb-contract/recolor/busstops";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { surfaceLook } from "../building-editor/building-text.js";
import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

export const BUSSTOPS_SCENE_URL = "/assets/workshop/busstops/busstops.bin";

/* Быстрые цвета: штатные тона остановок и яркие для своих. */
export const BUSSTOP_SWATCHES = Object.freeze([
  "#f4f5f7",
  "#c9ccd1",
  "#8a8f96",
  "#3a3f47",
  "#15171b",
  "#2f80ed",
  "#0b5cab",
  "#27ae60",
  "#f2c94c",
  "#e8590c",
  "#e30613",
  "#9b51e0",
]);

/* Вкладки сверху: все остановки или один вид. Подписи — короткие. */
const SHORT_LABELS = Object.freeze({ classic: "Со скамьёй", lit: "С подсветкой", city: "Городской", sign: "Знак" });
export const TARGET_OPTIONS = Object.freeze([
  { value: "all", label: "Все" },
  ...BUSSTOP_TYPES.map((type) => ({ value: type.id, label: SHORT_LABELS[type.id] || type.label })),
]);
export const targetLabel = (target) => (target === "all" ? tr("Все остановки") : tr(BUSSTOP_TYPES.find((type) => type.id === target)?.label || target));

export const SURFACE_MODE_OPTIONS = Object.freeze(BUSSTOP_SURFACE_MODES.map((mode) => [mode, BUSSTOP_SURFACE_LABELS[mode]]));
export const partLabel = (id) => BUSSTOP_PARTS.find((part) => part.id === id)?.label || id;

/* Какие части у вида: у знака — только каркас, светильник — у навеса с подсветкой. */
export function partsOfTarget(target) {
  if (target === "all") return BUSSTOP_PARTS.map((part) => part.id);
  return BUSSTOP_PARTS.map((part) => part.id).filter((id) => BUSSTOP_TYPES.find((type) => type.id === target)?.parts.includes(id));
}

/* У каких видов есть часть — подсказка общей правки. */
export function typesWithPart(part) {
  return BUSSTOP_TYPES.filter((type) => type.parts.includes(part)).map((type) => tr(type.label));
}

export const percentText = (value) => `${Math.round(value)} %`;

/** Облик, который правит взятая вкладка: свой у вида, если включён, иначе общий. */
export function editedLook(project, target) {
  const normal = normalizeBusStopsProject(project);
  if (target === "all") return normal.all;
  return busStopLookOf(normal, target);
}

/** Своя правка вида ещё не заведена — правка заведёт её копией общего облика. */
export const targetFollowsAll = (project, target) => target !== "all" && !normalizeBusStopsProject(project).types[target]?.own;

/* ------------------------------------------------------------------ *
 * Облик листа в кадре
 * ------------------------------------------------------------------ */

/* Ровный цвет листом 1×1: «Без текстуры» с альфой листа (стекло). */
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

/* Свечение частей в кадре: щит и светильник в игре светятся сами. */
const GLOW = Object.freeze({ poster: 0.25, light: 0.6 });

/**
 * Облик материала сцены: `info.type` — вид остановки, `info.group` — часть.
 * `finishes` — текстуры отделки по ключу `<вид|all>:<часть>`.
 */
export function busStopFrameLook(project, info, { finishes = {} } = {}) {
  const look = busStopLookOf(project, info.type);
  const part = info.group;
  const surface = look.parts[part];
  const opacity = Math.min(1, look.opacity / BUSSTOP_OPACITY.max);
  const emission = GLOW[part] || 0;
  let result;
  if (surface?.mode === "flat") {
    const colour = normalizeColourEffect(surface.look).colour;
    result = { colour: info.colour, finish: { texture: solidTexture(colour), mode: "uv", uv: [1, 1, 0, 0], shade: 0, ref: 0.5 } };
  } else {
    const followsAll = !normalizeBusStopsProject(project).types[info.type]?.own;
    result = surfaceLook(surface, info, finishes[`${followsAll ? "all" : info.type}:${part}`] || null);
    /* Потолок яркости листа до тона — тот же, что у установщика (`BUSSTOP_HIGHLIGHT_CAP`): светлая панель листа каркаса и светильника в окне получает цвет работы, как в игре. */
    if (result.tint && BUSSTOP_CAPPED_PARTS.includes(part)) result = { ...result, tint: { ...result.tint, cap: BUSSTOP_HIGHLIGHT_CAP } };
  }
  return { ...result, opacity, emission };
}

/** Ключи текстур отделки, которые нужны работе: `<вид|all>:<часть>` → облик части. */
export function finishSurfaces(project) {
  const normal = normalizeBusStopsProject(project);
  const out = {};
  for (const part of BUSSTOP_PARTS) out[`all:${part.id}`] = normal.all.parts[part.id];
  for (const type of BUSSTOP_TYPES) if (normal.types[type.id]?.own) for (const part of type.parts) out[`${type.id}:${part}`] = normal.types[type.id].parts[part];
  return out;
}

/** Строка состояния кадра: что ставится. */
export function busStopsPlanText(project) {
  const normal = normalizeBusStopsProject(project);
  const own = BUSSTOP_TYPES.filter((type) => normal.types[type.id]?.own).map((type) => tr(type.label));
  const opacity = normal.all.opacity < BUSSTOP_OPACITY.max ? trFill("Прозрачность всех — {0} %.", normal.all.opacity) : "";
  return [own.length ? trFill("Свой облик: {0}.", own.join(", ")) : "", opacity].filter(Boolean).join(" ");
}

/** Номер части сцены вида (порядок описи): виды стоят в ряд. */
export const sceneTypeIndex = (target) => BUSSTOP_TYPES.findIndex((type) => type.id === target);

/**
 * Что будет с гифкой постера у взятой вкладки (`busStopLiveState`): играет
 * плашкой на каждой остановке вида (вкладка «Все» — на всех видах с постером)
 * или стоит первым кадром. Пусто, если у вкладки постер не гифка.
 */
export function busStopGifNote(project, target) {
  const { states, live } = busStopLiveState(project);
  const ids = (target === "all" ? BUSSTOP_TYPE_IDS : [target]).filter((id) => states.has(id));
  if (!ids.length) return "";
  const playing = ids.filter((id) => live.includes(id));
  if (!playing.length) return tr("Гифка стоит первым кадром: видов с живой плашкой уже предел.");
  const stops = playing.reduce((sum, id) => sum + busStopPlate(id).stops.length, 0);
  return trFill("Гифка играет: живая плашка встанет перед постером на каждой остановке — видов: {0}, остановок: {1} (по одной на точку карты: копии остановки в картах-вариантах не считаются). На листе постера, вблизи и издалека, — первый кадр.", playing.length, stops);
}

