/*
 * Слова, числа и облик кадра редактора зданий («Мегамолл», «Ашан / Икея») —
 * отдельно от компонентов: их берут кадр, колонка правок и обложка.
 *
 * Облик листа в кадре повторяет установщик (`recolor-buildings.js`):
 *   «Стандарт» — лист как в игре игрока;
 *   свой цвет — тоном по светотени листа, эффект — полосой цветов вдоль
 *     развёртки листа;
 *   узор, картинка, градиент — общей отделкой по развёртке, как в листе;
 *   надпись и таблички со своим текстом — составным листом
 *     (`building-art.js`): та же функция `placeImageInIslands`, что у
 *     установщика;
 *   стороны, логотипы и надпись-плашка — плашками перед стеной, как в игре.
 */

import * as THREE from "three";
import {
  BUILDING_BILLBOARD_MODE_LABELS,
  BUILDING_BILLBOARD_MODES,
  BUILDING_FIT_LABELS,
  BUILDING_FITS,
  BUILDING_FONTS,
  BUILDING_MODE_LABELS,
  BUILDING_PART_MODES,
  BUILDING_PARTS,
  BUILDING_SIDE_MODE_LABELS,
  BUILDING_SIDE_MODES,
  BUILDING_SURFACE_MODES,
  BUILDING_TEXT_BACKGROUND_LABELS,
  BUILDING_TEXT_BACKGROUNDS,
  BUILDING_TEXT_MODE_LABELS,
  BUILDING_TEXT_MODES,
  BUILDING_TEXT_STYLE_LABELS,
  BUILDING_TEXT_STYLES,
  BUILDING_TINT_LIFT,
  buildingGrimeHidden,
  buildingGroupErased,
  buildingPartSettings,
  buildingSheetPart,
  grimePartOf,
  buildingSide,
} from "@modovik/climb-contract/recolor/buildings";
import { colourEffectStrip, normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { finishRepeats } from "@modovik/climb-contract/recolor/finish";

/* Быстрые цвета: штатные тона торговых центров и яркие для своих вывесок. */
export const BUILDING_SWATCHES = Object.freeze([
  "#f2f2f2",
  "#d9d2c3",
  "#9aa0a6",
  "#3a3f47",
  "#15171b",
  "#0058a3",
  "#2f6fd6",
  "#ffda1a",
  "#e30613",
  "#e8590c",
  "#78be20",
  "#7a1fa2",
]);

export const PART_IDS = Object.freeze(BUILDING_PARTS.map((part) => part.id));
export const partLabel = (id) => BUILDING_PARTS.find((part) => part.id === id)?.label || id;

export const SURFACE_MODE_OPTIONS = Object.freeze(BUILDING_SURFACE_MODES.map((mode) => [mode, BUILDING_MODE_LABELS[mode]]));
export const PART_MODE_OPTIONS = Object.freeze(BUILDING_PART_MODES.map((mode) => [mode, BUILDING_MODE_LABELS[mode]]));
export const SIDE_MODE_OPTIONS = Object.freeze(BUILDING_SIDE_MODES.map((mode) => ({ value: mode, label: BUILDING_SIDE_MODE_LABELS[mode] })));
export const FIT_OPTIONS = Object.freeze(BUILDING_FITS.map((fit) => ({ value: fit, label: BUILDING_FIT_LABELS[fit] })));
export const BILLBOARD_MODE_OPTIONS = Object.freeze(BUILDING_BILLBOARD_MODES.map((mode) => ({ value: mode, label: BUILDING_BILLBOARD_MODE_LABELS[mode] })));
export const TEXT_MODE_OPTIONS = Object.freeze(BUILDING_TEXT_MODES.map((mode) => [mode, BUILDING_TEXT_MODE_LABELS[mode]]));
export const TEXT_STYLE_OPTIONS = Object.freeze(BUILDING_TEXT_STYLES.map((style) => ({ value: style, label: BUILDING_TEXT_STYLE_LABELS[style] })));
export const TEXT_BACKGROUND_OPTIONS = Object.freeze(BUILDING_TEXT_BACKGROUNDS.map((value) => ({ value, label: BUILDING_TEXT_BACKGROUND_LABELS[value] })));
export const FONT_OPTIONS = Object.freeze(BUILDING_FONTS.map((font) => [font.id, font.label]));

const decimal = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");
export const metresText = (value) => `${decimal(value)} м`;
/* «100 %» — с неразрывным пробелом (п. 18 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;
export const degreesText = (value) => `${Math.round(value)}°`;
export const pixelsText = ([width, height]) => `${width} × ${height} px`;
export const aspectText = (width, height) => `${decimal(width / Math.max(0.01, height))} : 1`;

/* ------------------------------------------------------------------ *
 * Облик листа в кадре
 * ------------------------------------------------------------------ */

const luma = (hex) => {
  const value = parseInt(String(hex || "#808080").slice(1), 16);
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
};

/*
 * Полоса эффекта по развёртке листа — как у установщика: «вдоль» — по u,
 * «поперёк» — по v, «снизу вверх» — по 1 − v; у «линии» — шесть полос на лист.
 */
const strips = new Map();
function stripTexture(input) {
  const look = normalizeColourEffect(input);
  const key = JSON.stringify(look);
  if (strips.has(key)) return strips.get(key);
  const steps = 64;
  const line = colourEffectStrip(look, steps);
  const count = line.length / 4;
  const rgba = new Uint8Array(steps * 4);
  for (let index = 0; index < steps; index += 1) {
    const t = (index + 0.5) / steps;
    const share = look.mode === "line" ? (t * 6) % 1 : t;
    const along = look.direction === "height" ? 1 - share : share;
    const from = Math.min(count - 1, Math.round(along * (count - 1))) * 4;
    rgba.set(line.subarray(from, from + 4), index * 4);
    rgba[index * 4 + 3] = 255;
  }
  const vertical = look.direction === "across" || look.direction === "height";
  const texture = new THREE.DataTexture(rgba, vertical ? 1 : steps, vertical ? steps : 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  if (strips.size > 48) strips.delete(strips.keys().next().value);
  strips.set(key, texture);
  return texture;
}

/* Облик поверхности части: стандарт, тон, эффект или отделка. */
export function surfaceLook(item, info, finishTexture) {
  if (!item || item.mode === "standard") return { colour: info.colour };
  if (item.mode === "colour") {
    const look = normalizeColourEffect(item.look);
    /* Подъём тёмного — как у установщика (`BUILDING_TINT_LIFT`): чёрные
       полосы листа становятся тёмным оттенком цвета, а не пятном. */
    if (look.mode === "solid") return { colour: info.colour, tint: { colour: look.colour, ref: 0.5, brightness: 1, lift: BUILDING_TINT_LIFT } };
    return { colour: "#8a8a8a", finish: { texture: stripTexture(look), mode: "uv", uv: [1, 1, 0, 0], shade: 1, ref: 0.5, lift: BUILDING_TINT_LIFT } };
  }
  const repeats = finishRepeats(item);
  return {
    colour: info.colour,
    finish: finishTexture ? { texture: finishTexture, mode: "uv", uv: [repeats, repeats, 0, 0], shade: item.shade / 100, ref: Math.max(0.05, luma(info.colour)) } : null,
  };
}

/* Чья отделка у части: своя или «как всё здание» — здания. */
export const finishKeyOf = (project, partId) => (project.parts?.[partId]?.mode === "building" ? "building" : partId);

/**
 * Облик материала сцены кадра: `finishes` — текстуры отделки (`{ building,
 * walls, … }`), `composites` — составные листы (`Map` имя листа →
 * текстура: надпись и таблички со своим текстом).
 */
export function buildingFrameLook(project, place, info, { finishes = {}, composites = null } = {}) {
  const group = info.group;
  if (PART_IDS.includes(group)) {
    /* Лист, общий у частей, — облик части, где его больше, как у установщика. */
    const part = buildingSheetPart(place, info.name, group);
    const settings = buildingPartSettings(project, place, part);
    return surfaceLook(settings, info, finishes[finishKeyOf(project, part)] || null);
  }
  /* Потёки грязи поверх покрашенной части — уходят, как у установщика. */
  if (group === "grime") {
    const part = grimePartOf(info.name);
    if (part && buildingGrimeHidden(project, place).has(part)) return { colour: info.colour, visible: false };
    return { colour: info.colour };
  }
  if (group === "title" || String(group).startsWith("sign:")) {
    const item = group === "title" ? project.title : project.signs?.[group.slice(5)];
    if (item?.mode === "hidden") return { colour: info.colour, visible: false };
    /* Объёмные буквы, что работа убирает из модели (DAVIS MEGA MALL), — как
       у установщика: на их месте только плашка своих букв. */
    if (buildingGroupErased(project, place, group)) return { colour: info.colour, visible: false };
    /* Буквы-модели «Стандарт» — с листом своей части: в игре лист у них
       общий со стеной или отделкой и красится вместе с ней. */
    if (info.base && PART_IDS.includes(info.base) && (!item || item.mode === "standard")) {
      const settings = buildingPartSettings(project, place, info.base);
      return surfaceLook(settings, info, finishes[finishKeyOf(project, info.base)] || null);
    }
    /* Составной лист — один на лист игры: в нём текст всех надписей и
       табличек этого листа (у атласа вывесок их несколько). */
    const texture = composites?.get?.(info.name) || null;
    return texture ? { colour: "#ffffff", texture } : { colour: info.colour };
  }
  return { colour: info.colour };
}

/*
 * Насколько ближе обычной посадки встаёт камера у зданий из игры (ТЗ 41-А,
 * 20.10.2026: «Мегамолл и Ашан/Икея — при входе ближе, обложки тоже, сейчас они
 * кажутся очень далёкими»). Доля от посаженного расстояния: меньше — ближе.
 * Здания стоят на большой площадке, и вид «всё в кадре» мельчит само здание.
 */
export const BUILDING_ENTRY_ZOOM = Object.freeze({ megamall: 0.5, youtool: 0.55 });
export const BUILDING_COVER_ZOOM = Object.freeze({ megamall: 0.66, youtool: 0.8 });

/** Вид кадра редактора при входе — здание крупнее, чем «всё в кадре». */
export const buildingEntryZoom = (place) => BUILDING_ENTRY_ZOOM[place] ?? 0.7;

/** Рамка снимка: здание со стороны главного фасада, чуть сбоку и сверху.
 *  Без React: ею снимает и окно-съёмщик обложек частей. `close` — обложка и плитка
 *  «Готовых видов»: здание крупнее, края площадки могут уйти за кадр (`crop`). */
export function buildingShowcaseFrame(place, { close = false } = {}) {
  const side = buildingSide(place, "front");
  const normal = side?.normal || [0, -1, 0];
  return (asset) => {
    const shell = asset.parts.find((item) => item.id === "walls");
    const view = { yaw: Math.atan2(normal[0], -normal[1]) + 0.45, pitch: 0.42 };
    return {
      bounds: shell?.bounds || asset.bounds,
      ground: true,
      view: close ? { ...view, zoom: BUILDING_COVER_ZOOM[place] ?? 0.7 } : view,
      ...(close ? { crop: true } : {}),
    };
  };
}
