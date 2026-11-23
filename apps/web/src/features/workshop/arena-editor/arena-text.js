/*
 * Слова, числа и облик кадра редактора арены — отдельно от компонентов: их
 * берут кадр, колонка правок и обложка.
 *
 * Облик листа в кадре повторяет установщик (`recolor-arenas.js`):
 *   «Стандарт» — лист как в игре (GTA5RP) или как у сервера (Majestic);
 *   свой цвет — тоном по светотени листа (у плашки — ровным цветом), эффект
 *     — полосой цветов вдоль развёртки листа;
 *   узор и картинка — общей отделкой по развёртке, как в листе; своя
 *     картинка на стенах, полу и потолке Majestic — проекцией на каждую стену
 *     (`arena-finish-walls.js`, договор `finish-walls.js`), как своя сетка
 *     установщика: без светотени листа, стекло и свет — как на сервере;
 *   своя картинка в местах (экраны, таблички, логотипы, плакаты) и свой цвет
 *     знаков выхода — составным листом (`arena-composites.js`): та же
 *     функция, что у установщика;
 *   «Убрать» — поверхности нет;
 *   наклейки-затенения (шейдер decal_dirt) — тёмным с прозрачностью по листу,
 *     как в игре; затенение под креслами уходит вместе с ним в установщике.
 */

import * as THREE from "three";
import {
  ARENA_MODE_LABELS,
  ARENA_SEAT_SHADOWS,
  ARENA_SECTION_LABELS,
  ARENA_SERVERS,
  ARENA_SLOTS,
  ARENA_STANDARD_LABELS,
  ARENA_STAR_ANIMATIONS,
  ARENA_STAR_ANIMATION_LABELS,
  ARENA_STAR_STANDS,
  ARENA_STAR_STAND_LABELS,
  ARENA_SURFACES,
  ARENA_SURFACE_MODES,
  ARENA_VIEWS,
  MAJESTIC_CENTRE_EMBLEM,
  arenaChairVariants,
  arenaCoverHidden,
  arenaCovers,
  arenaElementOwn,
  arenaOverlaySheet,
  arenaPlazaEnabled,
  arenaSeatShadowsHidden,
  arenaSectionModes,
  arenaServerInventory,
  arenaSlotSheetOp,
} from "@modovik/climb-contract/recolor/arenas";
import { ARENA_SCREEN_OVERLAYS } from "@modovik/climb-contract/recolor/arena-panels";
import { colourEffectStrip, normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { finishRepeats, finishWallMetres } from "@modovik/climb-contract/recolor/finish";
import { arenaSurfaceProjected, finishWallMaterial, finishWallTile } from "@modovik/climb-contract/recolor/finish-walls";

export { ARENA_SECTION_LABELS };

export const ARENA_SERVER_OPTIONS = Object.freeze(ARENA_SERVERS.map((item) => Object.freeze({ value: item.id, label: item.label })));
export const ARENA_VIEW_OPTIONS = Object.freeze(ARENA_VIEWS.map((item) => Object.freeze({ value: item.id, label: item.label })));

/* Быстрые цвета: тёмные залы, цвета серверов и яркие для своих арен. */
export const ARENA_SWATCHES = Object.freeze([
  "#f2f2f2",
  "#9aa0a6",
  "#3a3f47",
  "#15171b",
  "#2f6fd6",
  "#1f3a8a",
  "#7a1fa2",
  "#c2185b",
  "#b3262e",
  "#e8590c",
  "#f2c94c",
  "#2f9e44",
]);

const modeLabel = (server, mode) => (mode === "standard" ? ARENA_STANDARD_LABELS[server] : ARENA_MODE_LABELS[mode]);

/** Режимы поверхности (фасад, пол, стены, потолок) — `[[режим, подпись]]` для `FinishField`. */
export const surfaceModeOptions = (server) => ARENA_SURFACE_MODES.map((mode) => [mode, modeLabel(server, mode)]);

/** Режимы раздела у сервера — `[[режим, подпись]]` для `Select`. */
export const sectionModeOptions = (server, id) => arenaSectionModes(server, id).map((mode) => [mode, modeLabel(server, mode)]);

export const STAR_STAND_OPTIONS = Object.freeze(ARENA_STAR_STANDS.map((id) => [id, ARENA_STAR_STAND_LABELS[id]]));
export const STAR_ANIMATION_OPTIONS = Object.freeze(ARENA_STAR_ANIMATIONS.map((id) => Object.freeze({ value: id, label: ARENA_STAR_ANIMATION_LABELS[id] })));


const decimal = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");
/* «100 %» — с неразрывным пробелом: число и знак не расходятся по строкам (`design-qa.md`, п. 18). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;
export const metresText = (value) => `${decimal(value)} м`;
export const centimetresText = (value) => `${Math.round(value)} см`;
export const speedText = (value) => `× ${decimal(value)}`;
export const degreesText = (value) => `${Math.round(value)}°`;
export const scaleText = (value) => `${Math.round(value * 100)}\u00a0%`;
export const offsetText = (value) => `${Math.round(value * 100)}\u00a0%`;

/* ------------------------------------------------------------------ *
 * Облик листа в кадре
 * ------------------------------------------------------------------ */

/* Части сцены кресел — модели вариантов: они красятся как кресла. */
const CHAIR_GROUPS = new Set(arenaChairVariants().map((item) => item.id));
const SURFACES = new Set(ARENA_SURFACES);
const SLOTS = new Set(ARENA_SLOTS);

/*
 * Наклейки-затенения GTA5RP (шейдер decal_dirt): лист без прозрачности, игра
 * берёт из него только силу затемнения (красный канал) с альфой вершин. Кадр
 * рисовал их непрозрачной картинкой — чёрными полосами под креслами (05.10.2026).
 * Сила — средняя альфа вершин в моделях игры (255 → 1).
 */
const DIRT_DECALS = new Map([
  ["tl_v_stadium_ao", 1],
  ["xj_v_stad_shad02", 0.6],
  ["gz_v_white256", 0.25],
]);
const seatShadows = (server) => new Set((ARENA_SEAT_SHADOWS[server] || []).flatMap((item) => item.textures));

const luma = (hex) => {
  const value = parseInt(String(hex || "#808080").slice(1), 16);
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
};

/*
 * Полоса эффекта по развёртке листа — как `stripPixels` установщика:
 * «вдоль» — по u, «поперёк» — по v, «снизу вверх» — по 1 − v; у «линии» —
 * шесть полос на лист.
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

/* Плашка — лист без своей картинки в сцене (ровный цвет). */
const isPlate = (info) => info.texture == null;
/*
 * Светящиеся материалы (экраны, знаки выхода) светятся и в кадре. Сила — из шейдера
 * игры (`emissiveMultiplier`, у зала 1…8: плафон 3, афиши 6, экраны 8), как у дирижаблей
 * (`airships-art.js`): корень из множителя, не выше 1,1. Сцена без силы (Majestic,
 * версия 1) светится прежним 0,75.
 */
export const glowEmission = (multiplier) => Math.min(1.1, 0.35 * Math.sqrt(multiplier));
const glow = (info) => (info.emissive ? { emission: info.glow > 0 ? glowEmission(info.glow) : 0.75 } : {});

/*
 * Маска точек поверх экранов Majestic (`ARENA_SCREEN_OVERLAYS`: табло, длинные экраны, ТВ, мониторы). В игре это вырез
 * (`cutout.sps`): тёмная сетка закрывает две трети экрана, а в дырах светится картинка с силой ×20…55 — свет
 * пересвечивает сетку, и экран читается светлым. Кадр без HDR держит свечение до 1,1 (`glowEmission`), и сетка во всю
 * силу гасила картинку до трети яркости (владелец 31.10.2026: «картинка светлая, а на экране чёрная»). Здесь она —
 * зерно светодиодов в треть силы. Своя плашка полотна встаёт над маской (`arenaPanelFaces`) — на ней сетки нет.
 */
const SCREEN_GRAIN = new Set(ARENA_SCREEN_OVERLAYS);
const SCREEN_GRAIN_OPACITY = 0.3;

/*
 * Маску точек щелчок проходит насквозь — к экрану под ней (`through`, как наклейки и стекло; владелец 01.11.2026: «тыкаю посередине — „Экран“, в угол —
 * „Корпус“»): лист маски у длинных экранов и ТВ в группе деталей, и попадание в её точки открывало корпус, а не экран. Сцена загружена — материалы
 * помечаются один раз, кэш сцены это переживает.
 */
export function throughScreenGrain(loaded) {
  for (const info of loaded?.materials || []) if (SCREEN_GRAIN.has(info.name)) info.through = true;
  return loaded;
}

function surfaceLook(server, group, item, info, finishTexture) {
  if (item.mode === "standard") return { colour: info.colour };
  /* Своя картинка на стенах, полу и потолке Majestic — проекцией по стенам сцены (`planes`): лист своей сетки в игре — картинка целиком, без
     светотени листа сервера. Стекло и светящиеся полосы картинку не берут. */
  if (arenaSurfaceProjected(server, group, item)) {
    if (!finishWallMaterial(info)) return { colour: info.colour };
    const tile = finishWallTile(finishWallMetres(item), item.image?.width && item.image?.height ? item.image.width / item.image.height : 1);
    return { colour: info.colour, finish: finishTexture ? { texture: finishTexture, mode: "plane", tile, shade: 0, ref: 0.5 } : null };
  }
  const plate = isPlate(info);
  if (item.mode === "colour") {
    const look = normalizeColourEffect(item.look);
    if (look.mode === "solid") return plate ? { colour: look.colour, map: false } : { colour: info.colour, tint: { colour: look.colour, ref: 0.5, brightness: 1 } };
    return { colour: "#8a8a8a", finish: { texture: stripTexture(look), mode: "uv", uv: [1, 1, 0, 0], shade: 1, ref: 0.5 } };
  }
  const repeats = finishRepeats(item);
  return {
    colour: info.colour,
    finish: finishTexture
      ? { texture: finishTexture, mode: "uv", uv: [repeats, repeats, 0, 0], shade: item.shade / 100, ref: plate ? 0.5 : Math.max(0.05, luma(info.colour)) }
      : null,
  };
}

function tinted(info, colour) {
  return isPlate(info) ? { colour, map: false } : { colour: info.colour, tint: { colour, ref: 0.5, brightness: 1 } };
}

/* Запись листа раздела в описи сервера — по разделу и имени листа (кэш). */
const slotRecords = new Map();
function slotRecord(server, group, name) {
  const key = `${server}|${group}|${name}`;
  if (!slotRecords.has(key)) slotRecords.set(key, (arenaServerInventory(server)?.textures || []).find((record) => record.group === group && record.name === name) || null);
  return slotRecords.get(key);
}

const hexOf = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

/*
 * Место картинок в кадре — той же операцией листа, что у установщика
 * (`arenaSlotSheetOp`): элементы места со своим видом и общим. Тон и
 * «Убрать» — материалом, картинка и слои — составным листом.
 */
function slotLook(server, group, settings, info, composites) {
  const record = slotRecord(server, group, info.name) || { group, name: info.name, islands: [], width: info.texture == null ? 4 : 512, height: 512 };
  const op = arenaSlotSheetOp(server, settings, record);
  if (!op) return { colour: info.colour, ...glow(info) };
  if (op.transparent) return { colour: info.colour, visible: false };
  if (op.tint || op.flat) return { ...tinted(info, op.tint || hexOf(op.flat)), ...glow(info) };
  const texture = composites?.get?.(info.name) || null;
  return texture ? { colour: "#ffffff", texture, ...glow(info) } : { colour: info.colour, ...glow(info) };
}

/* Полотно у арки со своим видом: свой лист, свой тон или штатный лист. */
function clothLook(settings, info, composites) {
  const item = settings.outBanners;
  if (!item?.places?.cloth || !arenaElementOwn(item, info.element)) return null;
  const look = item.elements[info.element];
  if (look.mode === "colour") return tinted(info, look.colour);
  const texture = composites?.get?.(`${info.name}|${info.element}`) || null;
  if ((look.mode === "image" || look.mode === "text") && texture) return { colour: "#ffffff", texture };
  /* «Стандарт» у полотна при общем виде раздела — штатный лист полотна. */
  return item.mode === "standard" && look.mode === "standard" ? null : { colour: info.colour };
}

/**
 * Облик материала сцены кадра арены: `server` — какой сервер в кадре,
 * `finishes` — текстуры отделки поверхностей (`{ facade, floor, walls,
 * ceiling }`), `composites` — составные листы (`Map` имя листа → текстура:
 * своя картинка в местах, знаки выхода своим цветом), `decals` — эмблема на
 * фасаде для шейдера.
 */
export function arenaFrameLook(project, server, info, { finishes = {}, composites = null, decals = null, replaced = null } = {}) {
  const settings = project[server];
  /* Модель сервера, заменённая своей или убранная (Majestic), — не видна: на её месте своя;
     буквы домика со своей надписью — тоже (на их месте — плашки надписи). */
  if (info.file && (replaced?.has(info.file) || replaced?.has(`${info.file}|${info.name}`))) return { colour: info.colour, visible: false };
  /* Мониторы и другие модели с общим листом: материал в сцене свой у каждой модели (`model`). */
  if (info.model && replaced?.has(`${info.model}.ydr`)) return { colour: info.colour, visible: false };
  if (SCREEN_GRAIN.has(info.name)) return { colour: info.colour, opacity: SCREEN_GRAIN_OPACITY };
  const group = CHAIR_GROUPS.has(info.group) ? "seats" : info.group;
  /* Эмблема лежит на фасаде и на площади (Majestic): плашка в мире не зависит от того, чей лист под ней, — наклейка в кадре ложится на все листы площади. */
  const own = (group === "facade" || (group === "plaza" && arenaPlazaEnabled())) && decals?.length && !info.decal ? { decals } : {};
  /* Эмблема в центре зала Majestic — наклейка оболочки на полу: её лист — место «Эмблем зала». */
  if (server === "majestic" && info.name === MAJESTIC_CENTRE_EMBLEM.record.name) {
    const centre = settings.logos ? slotLook(server, MAJESTIC_CENTRE_EMBLEM.section, settings, info, composites) : null;
    if (centre && (centre.texture || centre.visible === false)) return centre;
  }
  if (group === "star") return settings.star?.mode === "standard" || !settings.star ? { colour: info.colour } : { colour: info.colour, visible: false };
  /* Объёмные буквы, щит и знак над входом: заменены или убраны — их нет (на
     их месте — своя плашка), иначе — как часть, из которой они вырезаны. */
  if (group.startsWith("cover:")) {
    if (arenaCoverHidden(project, server, group.slice("cover:".length))) return { colour: info.colour, visible: false };
    return arenaFrameLook(project, server, { ...info, group: info.base || "facade" }, { finishes, composites, decals });
  }
  if (SURFACES.has(group)) {
    /* Площадь: красятся только листы земли блока из описи (плита, бордюры, ступени); общие городские листы сцены — трава, бетон, асфальт, разметка — в игре штатные, и в кадре тоже. */
    if (group === "plaza" && (!settings.plaza || !slotRecord(server, "plaza", info.name))) return { colour: info.colour, ...own };
    /* Наложения поверх поверхности (наклейки, свет, маски) — как в основе, как у установщика (задача 11 ТЗ 17.10.2026). */
    if (!settings[group] || arenaOverlaySheet(slotRecord(server, group, info.name))) return { colour: info.colour, ...own };
    return { ...surfaceLook(server, group, settings[group], info, finishes[group] || null), ...own };
  }
  if (SLOTS.has(group)) return settings[group] ? slotLook(server, group, settings, info, composites) : { colour: info.colour, ...glow(info) };
  /* Листы фасада снаружи с местами (надпись, логотип, баннеры) — составным листом;
     полотно у арки со своим видом — своим (задача 10). */
  if (group === "outside") {
    const cloth = info.element ? clothLook(settings, info, composites) : null;
    if (cloth) return cloth;
    const texture = composites?.get?.(info.name) || null;
    return texture ? { colour: "#ffffff", texture } : { colour: info.colour };
  }
  if (group === "exits") {
    const texture = settings.exits?.mode === "colour" ? composites?.get?.(info.name) : null;
    return texture ? { colour: "#ffffff", texture, ...glow(info) } : { colour: info.colour, ...glow(info) };
  }
  if (group === "decals") return settings.sprites?.decals === "hide" ? { colour: info.colour, visible: false } : { colour: info.colour };
  if (group === "cola") return settings.sprites?.cola === "hide" ? { colour: info.colour, visible: false } : { colour: info.colour };
  if (group === "vending" || group === "parking") return settings.objects?.[group] === "hide" ? { colour: info.colour, visible: false } : { colour: info.colour, ...glow(info) };
  if (group === "atms") {
    const mode = settings.objects?.atms;
    if (mode === "hide") return { colour: info.colour, visible: false };
    return mode === "colour" ? tinted(info, settings.objects.atmsColour) : { colour: info.colour, ...glow(info) };
  }
  if (group === "seats") {
    const item = settings.seats;
    if (!item || item.mode === "standard") return { colour: info.colour };
    if (item.mode === "hidden") return { colour: info.colour, visible: false };
    return tinted(info, item.colour);
  }
  if (group === "lights") return settings.lights?.mode === "colour" ? { ...tinted(info, settings.lights.colour), ...glow(info) } : { colour: info.colour, ...glow(info) };
  if (DIRT_DECALS.has(info.name)) {
    /* Затенение под креслами уходит у своего пола и без стадионных кресел — как в игре. */
    if (seatShadows(server).has(info.name) && arenaSeatShadowsHidden(project, server)) return { colour: info.colour, visible: false };
    return { colour: "#000000", dirt: DIRT_DECALS.get(info.name) };
  }
  return { colour: info.colour, ...glow(info) };
}

/* ------------------------------------------------------------------ *
 * Камера
 * ------------------------------------------------------------------ */

/**
 * Взгляд на звезду изнутри: глаз — на прямой от центра зала к звезде, на
 * расстоянии, где фигура заполняет кадр (но не ближе центра: дальше —
 * стены), смотрит на её середину.
 */
/*
 * Надпись Maze Bank Arena и логотипы снаружи GTA5RP живут над главным входом
 * (объёмные буквы, щит, знак) и на стелах площади: камера подходит ко входу,
 * к стеле или показывает всю арену.
 */
export const ARENA_SIGN_SECTIONS = new Set(["mazeSign", "outLogos"]);
export const ARENA_SIGN_VIEWS = Object.freeze([
  Object.freeze({ value: "portal", label: "Вход" }),
  Object.freeze({ value: "stela", label: "Стела" }),
  Object.freeze({ value: "all", label: "Вся арена" }),
]);
const SIGN_FOCUS = new Set(ARENA_SIGN_VIEWS.map((item) => item.value));
/** Куда смотрит камера после правки раздела: свой выбор у надписи — остаётся. */
export const arenaSignFocus = (current) => (SIGN_FOCUS.has(current) ? current : "portal");

/**
 * Главный вход снаружи: середина объёмных мест (буквы, щит, знак) по описи и
 * сторона, куда они смотрят. `{ centre, yaw }` или `null`.
 */
export function arenaPortalFocus(server) {
  const covers = arenaCovers(server);
  if (!covers.length) return null;
  const low = Math.min(...covers.map((entry) => entry.cover.point[2] - entry.cover.height / 2));
  const high = Math.max(...covers.map((entry) => entry.cover.point[2] + entry.cover.height / 2));
  const main = covers.reduce((best, entry) => (entry.cover.width * entry.cover.height > best.cover.width * best.cover.height ? entry : best));
  const [nx, ny] = main.cover.normal;
  return { centre: [main.cover.point[0], main.cover.point[1], (low + high) / 2], yaw: Math.atan2(nx, -ny) };
}

/**
 * Стела площади снаружи (надпись Maze Bank Arena и логотип под ней): её
 * стороны — треугольники листа надписи, чья развёртка лежит в областях этих
 * мест (развёртка у стел повторяется — треугольник сдвигается в свою клетку
 * листа). Из сторон всех стел берётся та, что смотрит на камеру по умолчанию
 * (`yaw`) и стоит с её стороны. Ответ — `{ centre, yaw }` для кадра или
 * `null`, если стел в сцене нет.
 */
export function arenaStelaFocus(asset, inventory, yaw = 0) {
  const record = inventory?.textures?.find((item) => item.group === "outside" && item.regions?.some((region) => region.section === "mazeSign"));
  if (!asset?.meshes || !record) return null;
  const rects = record.regions.filter((region) => ARENA_SIGN_SECTIONS.has(region.section)).flatMap((region) => region.islands.map((island) => island.rect));
  const sides = new Map();
  for (const mesh of asset.meshes) {
    if (asset.materials[mesh.material]?.name !== record.name || !mesh.uvs) continue;
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
      const us = ids.map((index) => mesh.uvs[index * 2]);
      const vs = ids.map((index) => mesh.uvs[index * 2 + 1]);
      const du = Math.floor(Math.min(...us) + 0.01);
      const dv = Math.floor(Math.min(...vs) + 0.01);
      const inRect = ([u0, v0, u1, v1]) => Math.min(...us) - du >= u0 - 0.01 && Math.max(...us) - du <= u1 + 0.01 && Math.min(...vs) - dv >= v0 - 0.01 && Math.max(...vs) - dv <= v1 + 0.01;
      if (!rects.some(inRect)) continue;
      const centre = [0, 1, 2].map((axis) => ids.reduce((sum, index) => sum + mesh.positions[index * 3 + axis], 0) / 3);
      const normal = [0, 1].map((axis) => ids.reduce((sum, index) => sum + mesh.normals[index * 3 + axis], 0));
      if (Math.hypot(...normal) < 0.3) continue;
      /* Сторона стелы: клетка 10 м и четверть горизонта, куда смотрит грань. */
      const key = `${Math.round(centre[0] / 10)},${Math.round(centre[1] / 10)},${Math.round(Math.atan2(normal[0], -normal[1]) / (Math.PI / 2))}`;
      const side = sides.get(key) || { sum: [0, 0, 0], normal: [0, 0], count: 0 };
      centre.forEach((value, axis) => (side.sum[axis] += value));
      side.normal[0] += normal[0];
      side.normal[1] += normal[1];
      side.count += 1;
      sides.set(key, side);
    }
  }
  if (!sides.size) return null;
  const look = [Math.sin(yaw), -Math.cos(yaw)];
  const middle = asset.bounds ? [0, 1].map((axis) => (asset.bounds.min[axis] + asset.bounds.max[axis]) / 2) : [0, 0];
  let best = null;
  for (const side of sides.values()) {
    const centre = side.sum.map((value) => value / side.count);
    const facing = Math.hypot(...side.normal) || 1;
    const away = [centre[0] - middle[0], centre[1] - middle[1]];
    const reach = Math.hypot(...away) || 1;
    const score = (side.normal[0] * look[0] + side.normal[1] * look[1]) / facing + (away[0] * look[0] + away[1] * look[1]) / reach;
    if (!best || score > best.score) best = { score, centre, yaw: Math.atan2(side.normal[0], -side.normal[1]) };
  }
  return { centre: best.centre, yaw: best.yaw };
}

export function arenaStarFocus(view, star, settings, standHeight = 0) {
  if (!view || !star) return null;
  const eye = view.eye;
  const target = [star.point[0], star.point[1], star.point[2] + standHeight + settings.size / 2];
  const delta = target.map((value, axis) => value - eye[axis]);
  const length = Math.hypot(...delta) || 1;
  const distance = Math.min(length, Math.max(3, settings.size * 1.9 + 1.5));
  const share = 1 - distance / length;
  const from = eye.map((value, axis) => value + delta[axis] * share);
  const look = target.map((value, axis) => value - from[axis]);
  const span = Math.hypot(...look) || 1;
  return {
    eye: from,
    yaw: Math.atan2(look[0], look[1]),
    pitch: Math.asin(Math.max(-1, Math.min(1, look[2] / span))),
    fov: 52,
  };
}
