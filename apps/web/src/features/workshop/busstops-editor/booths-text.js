/*
 * Слова и облик кадра «Будок» в редакторе «Остановки» (задача 11 ТЗ
 * 18.10.2026) — отдельно от компонентов: их берут кадр, колонка правок,
 * шаблоны и обложка.
 *
 * Облик материала в кадре повторяет установщик (`recolor-busstop-booths.js`):
 *   корпус, козырёк и рамы — лист × цвет столбца палитры (как шейдер игры),
 *     свой цвет — тем же расчётом столбцов (`boothColumnColour`);
 *   крыша и пол — общей отделкой (свой цвет эффектом, «Без текстуры», узор,
 *     картинка, градиент);
 *   надписи и листки — тоном листа, ровным цветом или своей картинкой в
 *     островах места (составной лист — `booths-composites.js`);
 *   стёкла — оттенком нужной силы.
 */

import * as THREE from "three";
import { atmSurfaceIsStock } from "@modovik/climb-contract/recolor/atms";
import {
  BOOTH_PARTS,
  BOOTH_SURFACE_LABELS,
  BOOTH_TYPES,
  boothColumnColour,
  boothLookOf,
  boothSurfaceModes,
  changedBoothCount,
  changedBoothTypes,
  findBoothPart,
  findBoothType,
  normalizeBooths,
} from "@modovik/climb-contract/recolor/busstop-booths";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { surfaceLook } from "../building-editor/building-text.js";
import { currentUiLanguage, tr } from "../../../locales/ui.js";

export const BOOTHS_SCENE_URL = "/assets/workshop/busstops/booths.bin";

/* Быстрые цвета: штатные тона будок и яркие для своих. */
export const BOOTH_SWATCHES = Object.freeze([
  "#4560a8",
  "#9d3b3f",
  "#bdbdbd",
  "#f4f5f7",
  "#c9ccd1",
  "#666666",
  "#2a2c31",
  "#15171b",
  "#d4a72c",
  "#2fb8ff",
  "#9b51e0",
  "#e30613",
]);

/* Вкладки сверху: обе будки или одна. Подписи переводятся при отрисовке. */
export const BOOTH_TARGET_IDS = Object.freeze(["all", ...BOOTH_TYPES.map((type) => type.id)]);
export const boothTargetOptions = () => [{ value: "all", label: tr("Обе") }, ...BOOTH_TYPES.map((type) => ({ value: type.id, label: tr(type.label) }))];
export const boothTargetLabel = (target) => (target === "all" ? tr("Обе будки") : tr(findBoothType(target)?.label || target));
export const boothPartLabel = (id) => tr(findBoothPart(id)?.label || id);

/** Облики части для выбора (Select): `[[режим, подпись]]` на языке окна. */
export const boothSurfaceModeOptions = (partId) => boothSurfaceModes(partId).map((mode) => [mode, tr(BOOTH_SURFACE_LABELS[mode])]);

/** Какие части у вкладки: «Обе» — все части, будка — свои. */
export function boothPartsOfTarget(target) {
  if (target === "all") return BOOTH_PARTS.map((part) => part.id);
  return BOOTH_PARTS.map((part) => part.id).filter((id) => findBoothType(target)?.parts.includes(id));
}

export const percentText = (value) => `${Math.round(value)} %`;

/** Облик, который правит взятая вкладка: свой у будки, если включён, иначе общий. */
export function boothEditedLook(booths, target) {
  const normal = normalizeBooths(booths);
  if (target === "all") return normal.all;
  return boothLookOf(normal, target);
}

/** Свой облик будки ещё не заведён — правка заведёт его копией общего. */
export const boothFollowsAll = (booths, target) => target !== "all" && !normalizeBooths(booths).types[target]?.own;

/* ------------------------------------------------------------------ *
 * Слова с числом
 * ------------------------------------------------------------------ */

/* Форма по числу: славянские — три формы, en и de — две, у fr единственное и для 0. */
function form(count, forms) {
  if (forms.length === 2) return count === 1 || (forms.fr && count === 0) ? forms[0] : forms[1];
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (forms.pl && count === 1) return forms[0];
  if (mod10 === 1 && mod100 !== 11 && !forms.pl) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
const polish = (forms) => Object.assign([...forms], { pl: true });
const french = (forms) => Object.assign([...forms], { fr: true });
const BOOTH_WORDS = Object.freeze({
  ru: ["будка", "будки", "будок"],
  uk: ["будка", "будки", "будок"],
  en: ["booth", "booths"],
  de: ["Kassenhäuschen", "Kassenhäuschen"],
  pl: polish(["budka", "budki", "budek"]),
  fr: french(["cabine", "cabines"]),
});
const language = () => (BOOTH_WORDS[currentUiLanguage()] ? currentUiLanguage() : "ru");

/** «36 будок» на языке окна. */
export const boothsCountText = (count) => `${count} ${form(count, BOOTH_WORDS[language()])}`;

const ON_MAP_TEXT = Object.freeze({
  ru: (count) => (count ? `На карте — ${boothsCountText(count)}.` : "В описи карты их нет: будка встречается у серверов и в картах-модах."),
  uk: (count) => (count ? `На мапі — ${boothsCountText(count)}.` : "В описі мапи її немає: будка трапляється на серверах і в мапах-модах."),
  en: (count) => (count ? `On the map: ${boothsCountText(count)}.` : "Not in the map index: this booth shows up on servers and in map mods."),
  de: (count) => (count ? `Auf der Karte: ${boothsCountText(count)}.` : "Nicht im Karten-Index: dieses Häuschen kommt auf Servern und in Karten-Mods vor."),
  pl: (count) => (count ? `Na mapie: ${boothsCountText(count)}.` : "Nie ma jej w indeksie mapy: ta budka występuje na serwerach i w modach map."),
  fr: (count) => (count ? `Sur la carte\u00a0: ${boothsCountText(count)}.` : "Absente de l’index de la carte\u00a0: cette cabine existe sur des serveurs et dans des mods de cartes."),
});
/** «На карте — 36 будок.» или честное «в описи карты нет». */
export const boothsOnMapText = (count) => ON_MAP_TEXT[language()](count || 0);

const CHANGE_TEXT = Object.freeze({
  ru: (count) => `Изменится ${boothsCountText(count)} на карте.`,
  uk: (count) => `Зміниться ${boothsCountText(count)} на мапі.`,
  en: (count) => `${boothsCountText(count)} will change on the map.`,
  de: (count) => `${boothsCountText(count)} ändern sich auf der Karte.`,
  pl: (count) => `Zmieni się ${boothsCountText(count)} na mapie.`,
  fr: (count) => `Modifications sur la carte\u00a0: ${boothsCountText(count)}.`,
});
/** Строка состояния кадра: что ставится и сколько будок это заденет. */
export function boothsPlanText(booths) {
  const normal = normalizeBooths(booths);
  const changed = changedBoothTypes(normal);
  if (!changed.length) return tr("Будки сейчас как в игре — ставить нечего.");
  const own = BOOTH_TYPES.filter((type) => normal.types[type.id]?.own).map((type) => tr(type.label));
  const count = changedBoothCount(normal);
  return [count ? CHANGE_TEXT[language()](count) : "", own.length ? `${tr("Свой облик")}: ${own.join(", ")}.` : ""].filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ *
 * Облик материала в кадре
 * ------------------------------------------------------------------ */

/* Ровный цвет листом 1×1: «Без текстуры». */
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
const flatLook = (colour, info) => ({ colour: info.colour, finish: { texture: solidTexture(colour), mode: "uv", uv: [1, 1, 0, 0], shade: 0, ref: 0.5 } });

/* Подъём тёмного — как у установщика (`TINT_LIFT`). */
const TINT_LIFT = 0.2;

/**
 * Облик материала сцены: `info.type` — будка, `info.group` — часть (`fixed` —
 * как в игре), `info.column` — столбец палитры у стен, козырька и рам.
 * `finishes` — текстуры отделки крыши и пола по ключу `<будка|booths>:<часть>`,
 * `composites` — составные листы со своими картинками (`<будка>:<лист>`).
 */
export function boothFrameLook(booths, info, { finishes = {}, composites = null } = {}) {
  const normal = normalizeBooths(booths);
  const look = boothLookOf(normal, info.type);
  const composite = composites?.get?.(`${info.type}:${info.name}`) || null;
  const base = composite ? { texture: composite } : {};
  if (info.column != null) return { colour: info.colour, multiply: boothColumnColour(info.type, info.column, look) || info.palette };
  const part = info.group;
  const surface = look.parts[part];
  if (part === "fixed" || !surface || atmSurfaceIsStock(surface)) return { colour: info.colour, ...base };
  const kind = findBoothPart(part)?.kind;
  if (kind === "finish") {
    if (surface.mode === "flat") return flatLook(normalizeColourEffect(surface.look).colour, info);
    const followsAll = !normal.types[info.type]?.own;
    return surfaceLook(surface, info, finishes[`${followsAll ? "booths" : info.type}:${part}`] || null);
  }
  if (surface.mode === "flat") return flatLook(surface.colour, info);
  if (kind === "glass") return { colour: info.colour, ...base, tint: { colour: surface.colour, ref: 0.5, brightness: 1, lift: TINT_LIFT, strength: surface.strength / 100 } };
  if (surface.mode === "colour") return { colour: info.colour, ...base, tint: { colour: surface.colour, ref: 0.5, brightness: 1, lift: TINT_LIFT } };
  /* Своя картинка: составной лист; пока он собирается — лист как в игре. */
  return composite ? { colour: "#ffffff", texture: composite } : { colour: info.colour };
}

/** Ключи текстур отделки, что нужны работе: `<будка|booths>:<часть>` → облик части (крыша и пол). */
export function boothFinishSurfaces(booths) {
  const normal = normalizeBooths(booths);
  const out = {};
  for (const part of BOOTH_PARTS.filter((item) => item.kind === "finish")) out[`booths:${part.id}`] = normal.all.parts[part.id];
  for (const type of BOOTH_TYPES)
    if (normal.types[type.id]?.own)
      for (const part of BOOTH_PARTS.filter((item) => item.kind === "finish" && type.parts.includes(item.id))) out[`${type.id}:${part.id}`] = normal.types[type.id].parts[part.id];
  return out;
}

/** Номер части сцены будки (порядок описи): будки стоят в ряд. */
export const boothSceneIndex = (target) => BOOTH_TYPES.findIndex((type) => type.id === target);
