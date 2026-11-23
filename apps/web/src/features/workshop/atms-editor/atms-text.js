/*
 * Слова и облик кадра редактора «Банкоматы» — отдельно от компонентов: их
 * берут кадр, колонка правок, шаблоны и обложка.
 *
 * Облик материала в кадре повторяет установщик (`recolor-atms.js`):
 *   корпус и рамка настенных — металл листа × цвет столбца палитры (как
 *     шейдер игры `*_tnt`), свой цвет — тем же расчётом столбцов
 *     (`atmColumnColour`); у тумбы — тоном листа;
 *   панель — общей отделкой (свой цвет эффектом, «Без текстуры», узор,
 *     картинка, градиент);
 *   экран, вывеска, полоса — тоном листа, ровным цветом или своей картинкой
 *     в островах места (составной лист — `atms-composites.js`);
 *   свечение — экран и вывеска светятся сами, сила — как множитель шейдера.
 *
 * Слова с числом — функцией по языку окна: склонение у языков своё.
 */

import * as THREE from "three";
import {
  ATM_GLOW,
  ATM_PARTS,
  ATM_SURFACE_LABELS,
  ATM_TYPES,
  atmColumnColour,
  atmLookOf,
  atmSurfaceIsStock,
  atmSurfaceModes,
  changedAtmCount,
  changedAtmTypes,
  findAtmPart,
  findAtmType,
  normalizeAtmsProject,
} from "@modovik/climb-contract/recolor/atms";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { surfaceLook } from "../building-editor/building-text.js";
import { currentUiLanguage, tr } from "../../../locales/ui.js";

export const ATMS_SCENE_URL = "/assets/workshop/atms/atms.bin";

/* Быстрые цвета: штатные тона банкоматов и яркие для своих. */
export const ATM_SWATCHES = Object.freeze([
  "#4471d8",
  "#ea3c41",
  "#3ae464",
  "#f4f5f7",
  "#c9ccd1",
  "#8a8f96",
  "#2b2f36",
  "#15171b",
  "#d4a72c",
  "#9b51e0",
  "#e8590c",
  "#0b5cab",
]);

/* Вкладки сверху: все банкоматы или одна модель. Подписи переводятся при отрисовке. */
export const TARGET_IDS = Object.freeze(["all", ...ATM_TYPES.map((type) => type.id)]);
export const targetOptions = () => [
  { value: "all", label: tr("Все") },
  ...ATM_TYPES.map((type) => ({ value: type.id, label: tr(type.short) })),
];
export const targetLabel = (target) => (target === "all" ? tr("Все банкоматы") : tr(findAtmType(target)?.label || target));
export const partLabel = (id) => tr(findAtmPart(id)?.label || id);

/** Облики части для выбора (Select): `[[режим, подпись]]` на языке окна. */
export const surfaceModeOptions = (partId) => atmSurfaceModes(partId).map((mode) => [mode, tr(ATM_SURFACE_LABELS[mode])]);

/** Какие части у вкладки: «Все» — все части, модель — свои. */
export function partsOfTarget(target) {
  if (target === "all") return ATM_PARTS.map((part) => part.id);
  return ATM_PARTS.map((part) => part.id).filter((id) => findAtmType(target)?.parts.includes(id));
}

/** У каких моделей нет части — подсказка общей правки («у тумбы рамки нет»). */
export const typesWithoutPart = (part) => ATM_TYPES.filter((type) => !type.parts.includes(part));

/** Светится ли у вкладки что-нибудь (экран и вывеска на светящемся шейдере). */
export const targetGlows = (target) => (target === "all" ? ATM_TYPES.some((type) => type.glows) : Boolean(findAtmType(target)?.glows));

export const percentText = (value) => `${Math.round(value)} %`;

/** Облик, который правит взятая вкладка: свой у модели, если включён, иначе общий. */
export function editedLook(project, target) {
  const normal = normalizeAtmsProject(project);
  if (target === "all") return normal.all;
  return atmLookOf(normal, target);
}

/** Свой облик модели ещё не заведён — правка заведёт его копией общего. */
export const targetFollowsAll = (project, target) => target !== "all" && !normalizeAtmsProject(project).types[target]?.own;

/* ------------------------------------------------------------------ *
 * Слова с числом
 * ------------------------------------------------------------------ */

/* Форма по числу: славянские — три формы, en и de — две, fr — две (единственное для 0 и 1). */
function form(count, forms) {
  if (forms.fr) return count === 0 || count === 1 ? forms[0] : forms[1];
  if (forms.length === 2) return count === 1 ? forms[0] : forms[1];
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (forms.pl && count === 1) return forms[0];
  if (mod10 === 1 && mod100 !== 11 && !forms.pl) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
const polish = (forms) => Object.assign([...forms], { pl: true });
const french = (forms) => Object.assign([...forms], { fr: true });
const ATM_WORDS = Object.freeze({
  ru: ["банкомат", "банкомата", "банкоматов"],
  uk: ["банкомат", "банкомати", "банкоматів"],
  en: ["ATM", "ATMs"],
  de: ["Geldautomat", "Geldautomaten"],
  pl: polish(["bankomat", "bankomaty", "bankomatów"]),
  fr: french(["distributeur", "distributeurs"]),
});
const language = () => (ATM_WORDS[currentUiLanguage()] ? currentUiLanguage() : "ru");

/** «38 банкоматов» на языке окна. */
export const atmsCountText = (count) => `${count} ${form(count, ATM_WORDS[language()])}`;

const CHANGE_TEXT = Object.freeze({
  ru: (count) => `Изменится ${atmsCountText(count)} по всему миру.`,
  uk: (count) => `Зміниться ${atmsCountText(count)} по всьому світу.`,
  en: (count) => `${atmsCountText(count)} will change across the whole map.`,
  de: (count) => `${atmsCountText(count)} ändern sich auf der ganzen Karte.`,
  pl: (count) => `Zmieni się ${atmsCountText(count)} na całej mapie.`,
  fr: (count) => `${atmsCountText(count)} ${count === 0 || count === 1 ? "sera modifié" : "seront modifiés"} sur toute la carte.`,
});
/** «Изменится 121 банкомат по всему миру.» */
export const atmsChangeText = (count) => CHANGE_TEXT[language()](count);

const ON_MAP_TEXT = Object.freeze({
  ru: (count, inside) => `На карте — ${atmsCountText(count)}${inside ? `, из них ${inside} в помещениях` : ""}.`,
  uk: (count, inside) => `На мапі — ${atmsCountText(count)}${inside ? `, з них ${inside} у приміщеннях` : ""}.`,
  en: (count, inside) => `On the map: ${atmsCountText(count)}${inside ? `, ${inside} of them indoors` : ""}.`,
  de: (count, inside) => `Auf der Karte: ${atmsCountText(count)}${inside ? `, davon ${inside} in Innenräumen` : ""}.`,
  pl: (count, inside) => `Na mapie: ${atmsCountText(count)}${inside ? `, w tym ${inside} we wnętrzach` : ""}.`,
  fr: (count, inside) => `Sur la carte\u00a0: ${atmsCountText(count)}${inside ? `, dont ${inside} à l’intérieur` : ""}.`,
});
/** «На карте — 38 банкоматов, из них 18 в помещениях.» */
export const atmsOnMapText = (count, inside = 0) => ON_MAP_TEXT[language()](count, inside);

/** Строка состояния кадра: что ставится и сколько банкоматов это заденет. */
export function atmsPlanText(project) {
  const normal = normalizeAtmsProject(project);
  const changed = changedAtmTypes(normal);
  if (!changed.length) return tr("Сейчас всё как в игре — ставить нечего.");
  const own = ATM_TYPES.filter((type) => normal.types[type.id]?.own).map((type) => tr(type.label));
  return [atmsChangeText(changedAtmCount(normal)), own.length ? `${tr("Свой облик")}: ${own.join(", ")}.` : ""].filter(Boolean).join(" ");
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
/* Свечение экрана и вывески в кадре при 100 %: игра светит их сама. */
const GLOW_STRENGTH = 0.45;

/**
 * Облик материала сцены: `info.type` — модель, `info.group` — часть
 * (`fixed` — как в игре), `info.column` — столбец палитры у металла.
 * `finishes` — текстуры отделки панели по ключу `<модель|all>:panel`,
 * `composites` — составные листы со своими картинками (`<модель>:<лист>`).
 */
export function atmFrameLook(project, info, { finishes = {}, composites = null } = {}) {
  const normal = normalizeAtmsProject(project);
  const look = atmLookOf(normal, info.type);
  const emission = info.emissive ? GLOW_STRENGTH * (look.glow / ATM_GLOW.standard) : 0;
  const composite = composites?.get?.(`${info.type}:${info.name}`) || null;
  const base = composite ? { texture: composite } : {};
  if (info.column != null) {
    const multiply = atmColumnColour(info.type, info.column, look) || info.palette;
    return { colour: info.colour, multiply, emission };
  }
  const part = info.group;
  const surface = look.parts[part];
  if (part === "fixed" || !surface || atmSurfaceIsStock(surface)) return { colour: info.colour, ...base, emission };
  const kind = findAtmPart(part)?.kind;
  if (kind === "finish") {
    if (surface.mode === "flat") return { ...flatLook(normalizeColourEffect(surface.look).colour, info), ...base, emission };
    const followsAll = !normal.types[info.type]?.own;
    return { ...surfaceLook(surface, info, finishes[`${followsAll ? "all" : info.type}:panel`] || null), ...base, emission };
  }
  if (surface.mode === "flat") return { ...flatLook(surface.colour, info), emission };
  /* Стекло: оттенок нужной силы (шейдер игры непрозрачный — «прозрачность» — сила оттенка). */
  if (kind === "glass") return { colour: info.colour, ...base, tint: { colour: surface.colour, ref: 0.5, brightness: 1, lift: TINT_LIFT, strength: surface.strength / 100 }, emission };
  if (surface.mode === "colour") return { colour: info.colour, ...base, tint: { colour: surface.colour, ref: 0.5, brightness: 1, lift: TINT_LIFT }, emission };
  /* Своя картинка или текст: составной лист; пока он собирается — лист как в игре. */
  return composite ? { colour: "#ffffff", texture: composite, emission } : { colour: info.colour, emission };
}

/** Ключи текстур отделки панели, что нужны работе: `<модель|all>:panel` → облик панели. */
export function finishSurfaces(project) {
  const normal = normalizeAtmsProject(project);
  const out = { "all:panel": normal.all.parts.panel };
  for (const type of ATM_TYPES) if (normal.types[type.id]?.own && type.parts.includes("panel")) out[`${type.id}:panel`] = normal.types[type.id].parts.panel;
  return out;
}

/** Номер части сцены модели (порядок описи): модели стоят в ряд. */
export const sceneTypeIndex = (target) => ATM_TYPES.findIndex((type) => type.id === target);
