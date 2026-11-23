/*
 * Арена в файлах: облик выбранного сервера — GTA 5 RP или Majestic.
 *
 * Основа — стандартная арена (схема 2, ТЗ 03.10.2026): у GTA 5 RP — штатные
 * файлы игры игрока (адреса в описи, читаются из его игры), у Majestic —
 * файлы стандартной арены сервера (`resources/recolor/arenas/majestic/`).
 * Пакет везёт только файлы, где что-то поменялось; всё «Стандарт» — пакета
 * нет вовсе, «Применить» снимает установку.
 *
 * Правка листа — по его группе (опись):
 *   поверхности (фасад, пол, стены, потолок) — тон по светотени листа
 *     (`tintTable`, у плашки 4×4 — заливка), эффект — полосой цветов по
 *     развёртке, узор и картинка — общей отделкой (`finish-bake.js`); своя
 *     картинка на стенах, полу и потолке Majestic — не в лист, а своей сеткой
 *     с развёрткой проекцией на каждую стену (`recolor-arena-walls.js`);
 *   места картинок (экраны, таблички, логотипы, плакаты) — своя картинка в
 *     острова листа включённых мест (`placeImageInIslands`: размер, поворот,
 *     сдвиг, фон), свой цвет — тоном, «убрать» — прозрачный лист;
 *   знаки выхода — зелёное в свой цвет (`recolourGreen`);
 *   спрайты GTA5RP — всегда прозрачные листы наклеек (переключателя нет с
 *     05.10.2026); затенение под креслами у своего пола — прочь из модели.
 * Каждая правка ложится и в HD-копию листа (`+hi.ytd`, `+hidr.ytd`): игра
 * подменяет лист на неё вблизи, и без неё правка пропадала бы у самой стены.
 *
 * Сущности интерьера GTA5RP (`v_int_62.ytyp`, штатный файл с правкой на
 * месте): автоматы, банкоматы, паркоматы, наклейки колы, кресла «Убрать» и
 * вещи, убранные по одной («Предметы зала», `settings.removed`) —
 * дальностью прорисовки 1 см; другая модель кресла — новым архетипом
 * сущности; звезда — своей моделью на месте реквизита шоу. Цвет банкоматов —
 * их моделью (`prop_atm_02`): так они перекрасятся по всему штату.
 *
 * Эмблема на фасаде — плашкой нативного хоста (`compile-emblem-plates`),
 * дальний фасад — общей системой LOD (`recolor-lod.js`).
 *
 * Сторож: модель без группы шейдеров в пакет не едет (`unsafeDrawables`) —
 * такие «пустышки» роняли GTA при входе в зал.
 */

import zlib from "node:zlib";
import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { hexBytes, normalizeColourEffect } from "@modovik/climb-contract/recolor";
import { placementTransform } from "@modovik/climb-contract/recolor/placement";
import { emblemTextFilled } from "@modovik/climb-contract/recolor/emblems";
import {
  ARENA_CLOTH_LOD,
  ARENA_CLOTH_TEXTURE,
  ARENA_CLOTH_TYPES,
  ARENA_PLATE,
  ARENA_SEAT_SHADOWS,
  ARENA_SLOTS,
  ARENA_SURFACES,
  arenaChairLift,
  arenaChairVariants,
  arenaActiveCovers,
  arenaClothJobs,
  arenaClothLodLayers,
  arenaCoverErasures,
  arenaCoverPicture,
  arenaCoverPlates,
  arenaEmblemPlates,
  arenaOutsideLayers,
  arenaOverlaySheet,
  arenaPanelAtlas,
  arenaPanelFacePicture,
  arenaPanelPicture,
  arenaPanelPlates,
  arenaPanelsAnimated,
  arenaScene,
  arenaSeatShadowsHidden,
  arenaServerInventory,
  arenaSignFaces,
  arenaSignMesh,
  arenaSignPicture,
  arenaSlotSheetOp,
  arenaPanelSheetOp,
  arenasProjectIsStock,
  normalizeArenasProject,
} from "@modovik/climb-contract/recolor/arenas";
import { encodeDds, resample } from "@modovik/dds";
import { arenaStarModel } from "@modovik/climb-contract/recolor/arena-star";
import { ARENA_OBJECT_KEY_SPAN, arenaObjectInterior, arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { activeArenaReplacements, activeArenaSigns, fitReplacementMesh } from "@modovik/climb-contract/recolor/arena-replace";
import { ARENA_ITEM_GROUP_LIMIT, arenaItemArchetype, arenaItemCopies, arenaItemCopyName, arenaItemFrame, arenaItemModelKey, arenaItemPlace, arenaItemSource } from "@modovik/climb-contract/recolor/arena-item-looks";
import { arenaEntityKeys, arenaItemParts, arenaRemovedParts } from "@modovik/climb-contract/recolor/arena-item-parts";
import { PART_VERTEX_LIMIT, cutParts, elementMeshes, elementProjectedMesh, modelFrame, partMesh, partPlane, projectPartUvs, withBackFaces } from "./recolor-arena-parts.js";
import { itemElementFront, itemElementIsland, itemElementMeshesPlaced, itemElementProjectedIsland, itemElementProjection } from "@modovik/climb-contract/recolor/item-elements";
import { readMloEntities } from "./recolor-shops.js";
import { isArenaScreenPlateGroup } from "@modovik/climb-contract/recolor/arena-screens";
import { arenaScreenPlatesEnabled, layScreenPlate, roundedBox } from "./recolor-arena-screens.js";
import { PLACE_MODEL_HALLS, normalizePlaceModel, placeModelCellPixels, placeModelInHall, placeModelIntoFirstCell, placeModelSolid, placeModelUnitMesh } from "@modovik/climb-contract/recolor/place-models";
import { patchTypesForPlace, readMapEntities } from "./place-isolation.js";
import { buildArenaModSheets } from "./recolor-arena-mod.js";
import { finishSource } from "./finish-bake.js";
import { finishWallMetres } from "@modovik/climb-contract/recolor/finish";
import { FINISH_WALL_SURFACES, arenaSurfaceProjected } from "@modovik/climb-contract/recolor/finish-walls";
import { collapseFaces, isFinishWallModel, projectedSurfaceMeshes, surfaceFaces } from "./recolor-arena-walls.js";
import { separateSurfaceSheets } from "./recolor-arena-surfaces.js";
import { applyRoomWalls, roomWallPlan } from "./recolor-room-walls.js";
import { buildEmblemPlates } from "./recolor-emblem.js";
import { hideGrimeDecals } from "./recolor-grime.js";
import { ANIMATED_ARCHETYPE_FLAGS, ARENA_STAR_CLIPS, buildArenaStar } from "./recolor-arena-star.js";
import { buildLodFiles, createLookField, createSurfaceSampler, joaatName, nearPlateTriangles } from "./recolor-lod.js";
import { bakeFile, inflateRaw, kindOf, rawDdsOf, resourceRefs, sheetPixels } from "./recolor-sheets.js";
import { placeImageInIslands } from "@modovik/climb-contract/recolor/arena-slots";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { deflateRaw } from "@modovik/native-rs";
import { arenaPanelRotation } from "@modovik/climb-contract/recolor/arena-panels";
import { buildPlaceModels, compilePlaceModel, placeModelSheet, placeModelShader } from "./recolor-place-models.js";
import { guardActive, guardServerModels } from "./arena-shell-guard.js";

/* Сущность не видна дальше 1 см — «Убрать» без правки комнат и порталов. */
const HIDDEN_LOD = 0.01;

/* Модели без группы шейдеров («пустышки») игра Legacy 3889 не переживает (ACCESS_VIOLATION по адресу 0x18, дамп 03.10.2026): проверка — `model-guard-check.js`, её же берёт сторож установки каталога. */
import { unsafeDrawables } from "./model-guard-check.js";
export { unsafeDrawables };

/* ------------------------------------------------------------------ *
 * Облик листа
 * ------------------------------------------------------------------ */

const isPlate = (record) => Math.max(record?.width || 0, record?.height || 0) <= 8;

/*
 * Нижний порог яркости крупных поверхностей зала Majestic (21.11.2026). Чисто чёрный лист (#000000) в игре не отвечает на свет: чёрные
 * стены, потолок и пол «пропадают» в тёмном зале (чёрное на чёрном), а у общей штукатурки пропадает и перегородка. Авторы арен Majestic
 * берут не чёрный, а тёмно-серый: средняя яркость листов их стен, полов и потолков 10–15 из 255 (alliance: `wall_basecolor` и `wall_main_basecolor` 13,
 * потолок и главный лист 10, panika: `tiles08b_diffuse` 15), с рисунком листа (5 % самых тёмных пикселей ≤ 9, 95 % ≤ 16). Берём 13.
 * Цвет темнее порога поднимается до порога с сохранением оттенка; рисунок листа остаётся (тон по светотени листа, не заливка).
 * `ASTRAL_ARENA_MIN_LUMA=0` отключает (число 0–255 — свой порог).
 */
export const MIN_SURFACE_LUMA = 13;
const lumaOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export function minSurfaceLuma() {
  const raw = process.env.ASTRAL_ARENA_MIN_LUMA;
  if (raw === undefined || raw === "") return MIN_SURFACE_LUMA;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : MIN_SURFACE_LUMA;
}
/** `{ colour, lifted }`: цвет не темнее порога по яркости (оттенок тот же; чёрный — нейтральный графит). */
export function liftColour(colour, minLuma = minSurfaceLuma()) {
  const bytes = hexBytes(colour);
  const luma = lumaOf(bytes);
  if (!minLuma || luma >= minLuma) return { colour, lifted: false };
  const scaled = luma < 0.5 ? [minLuma, minLuma, minLuma] : bytes.map((value) => value * (minLuma / luma));
  const out = scaled.map((value) => Math.max(0, Math.min(255, Math.round(value))));
  return { colour: `#${out.map((value) => value.toString(16).padStart(2, "0")).join("")}`, lifted: true };
}

/*
 * Что делать с листом описи: `{ flat }`, `{ tint }`, `{ strip }`,
 * `{ finish }`, `{ transparent }`, `{ recolour }`, `{ image, islands,
 * transform }` или `null` (лист как в основе).
 */
export function arenaTextureOp(server, settings, record, { panelsOnSheets = false, sheetKeys = null } = {}) {
  if (!record || record.role !== "diffuse") return null;
  const group = record.group;
  if (ARENA_SURFACES.includes(group)) {
    const item = settings[group];
    if (!item || item.mode === "standard") return null;
    /* Наложения (наклейки, свет, маски) — как в основе: облик поверхности в них не ложится. */
    if (arenaOverlaySheet(record)) return null;
    /* Своя картинка на стенах, полу и потолке Majestic — своей сеткой поверх стен (`buildArenaFinishWalls`), лист как на сервере. */
    if (arenaSurfaceProjected(server, group, item)) return null;
    if (item.mode === "colour") {
      if (item.look.mode !== "solid") return { strip: item.look };
      /* Majestic: крупные поверхности не темнее порога (чёрное на чёрном в игре невидимо); фасад не красится вовсе. */
      /* Фасад и площадь снаружи — не зал: порог яркости им не нужен (чёрная плита у здания видна). */
      const raised = guardActive(server) && group !== "facade" && group !== "plaza" ? liftColour(item.look.colour) : { colour: item.look.colour, lifted: false };
      /* Поднятый цвет — на среднюю яркость листа (`ref: "mean"`): иначе светлый лист штукатурки при опоре 0,5 вышел бы заметно светлее порога. */
      return isPlate(record) ? { flat: hexBytes(raised.colour) } : { tint: raised.colour, ...(raised.lifted ? { ref: "mean" } : {}) };
    }
    return { finish: item };
  }
  /* Места картинок: у места — элементы со своим видом или общим (задача 10). */
  if (ARENA_SLOTS.includes(group)) {
    const whole = arenaSlotSheetOp(server, settings, record);
    /* Majestic: свои картинки полотен — пикселями листа, а не вшитой плашкой (`arena-shell-guard.js`). */
    const own = panelsOnSheets ? arenaPanelSheetOp(server, settings, record, { keys: sheetKeys }) : null;
    if (!own) return whole;
    return whole ? { base: whole, layers: own.layers } : own;
  }
  /*
   * Листы фасада GTA5RP снаружи (задача 6): в одном листе места разных
   * разделов (у `brand01` — надпись, логотип и флаги стел) — каждое своим
   * слоем по своим островам. «Убрать» логотип — стереть его фактурой панели.
   */
  if (group === "outside") {
    const layers = arenaOutsideLayers(settings, record, server);
    return layers.length ? { layers } : null;
  }
  if (group === "exits") return settings.exits?.mode === "colour" ? { recolour: settings.exits.colour } : null;
  if (group === "lights") return settings.lights?.mode === "colour" ? (isPlate(record) ? { flat: hexBytes(settings.lights.colour) } : { tint: settings.lights.colour }) : null;
  if (group === "seats") return settings.seats?.mode === "colour" ? (isPlate(record) ? { flat: hexBytes(settings.seats.colour) } : { tint: settings.seats.colour }) : null;
  if (group === "atms") return settings.objects?.atms === "colour" ? { tint: settings.objects.atmsColour } : null;
  if (group === "decals") return settings.sprites?.decals === "hide" ? { transparent: true } : null;
  if (group === "cola") return settings.sprites?.cola === "hide" ? { transparent: true } : null;
  return null;
}

/* Важность правки, если лист в описи у нескольких групп (общий атлас). */
const opRank = (op) => (!op ? 0 : op.image ? 5 : op.transparent ? 4 : op.recolour ? 3 : op.finish || op.strip ? 2 : 1);

/* ------------------------------------------------------------------ *
 * Сущности интерьера
 * ------------------------------------------------------------------ */

/*
 * Сущности интерьера в распакованном ресурсе типов: смещение каждой
 * `CEntityDef` (128 байт) у первого интерьера файла. Разметка Meta —
 * как у `scripts/lib/rage-meta.mjs` (CodeWalker `MetaTypes.cs`).
 */
const MLO_ARCHETYPE = 0x10506455;
function interiorEntities(resource) {
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const rootBlockIndex = view.getInt32(rootAt + 0x1c, true);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ nameHash: view.getUint32(at, true), dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? { at: block.dataAt + Number((pointer >> 12n) & 0xfffffn), structure: block.nameHash } : null;
  };
  const pointers = (at) => {
    const count = view.getUint16(at + 8, true);
    const list = count ? resolve(view.getBigUint64(at, true)) : null;
    const out = [];
    for (let index = 0; index < count && list; index += 1) {
      const item = resolve(view.getBigUint64(list.at + index * 8, true));
      if (item) out.push(item);
    }
    return out;
  };
  const root = blocks[rootBlockIndex - 1];
  const archetypes = pointers(root.dataAt + 24);
  const mlo = archetypes.find((item) => item.structure === MLO_ARCHETYPE);
  if (!mlo) throw new Error("В типах интерьера нет интерьера.");
  return {
    entities: pointers(mlo.at + 152).map((item) => item.at),
    /* Архетипы файла по хешу имени (`CBaseArchetypeDef`, имя — +88). */
    archetypes: new Map(archetypes.filter((item) => item.structure !== MLO_ARCHETYPE).map((item) => [view.getUint32(item.at + 88, true), item.at])),
  };
}

/** Словарь листов архетипов типов интерьера: `хеш имени архетипа → хеш его словаря` (для проверок: копия смотрит на свой словарь). */
export function interiorArchetypeDictionaries(bytes) {
  const resource = openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
  const { archetypes } = interiorEntities(resource);
  return new Map([...archetypes].map(([hash, at]) => [hash >>> 0, resource.view.getUint32(at + 92, true) >>> 0]));
}

/**
 * Правка сущностей интерьера на месте: `edits` — `[{ index, archetype?,
 * lodDist?, position?, lift? }]` (`lift` — сдвиг по Z от прежнего места),
 * `archetypeEdits` — `[{ name, flags?, clipDictionary?, bbMin?, bbMax?,
 * bsCentre?, bsRadius? }]` (архетип ищется по хешу имени). Ресурс
 * сжимается заново с прежним заголовком.
 */
export function patchInteriorEntities(bytes, edits, archetypeEdits = []) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const { entities, archetypes } = interiorEntities(resource);
  const view = resource.view;
  for (const edit of edits) {
    const at = entities[edit.index];
    if (at === undefined) throw new Error(`В интерьере нет сущности ${edit.index}.`);
    if (edit.expect !== undefined && view.getUint32(at + 8, true) !== edit.expect >>> 0)
      throw new Error(`Сущность ${edit.index} интерьера — не та модель: файл игры другой версии.`);
    if (edit.archetype !== undefined) view.setUint32(at + 8, edit.archetype >>> 0, true);
    if (edit.lodDist !== undefined) view.setFloat32(at + 76, edit.lodDist, true);
    if (edit.position) edit.position.forEach((value, axis) => view.setFloat32(at + 32 + axis * 4, value, true));
    if (edit.lift) view.setFloat32(at + 40, view.getFloat32(at + 40, true) + edit.lift, true);
  }
  for (const edit of archetypeEdits) {
    const at = archetypes.get(edit.name >>> 0);
    if (at === undefined) throw new Error("В типах интерьера нет архетипа звезды: файл игры другой версии.");
    if (edit.flags !== undefined) view.setUint32(at + 12, edit.flags >>> 0, true);
    for (const [field, offset] of [
      ["bbMin", 32],
      ["bbMax", 48],
      ["bsCentre", 64],
    ])
      if (edit[field]) edit[field].forEach((value, axis) => view.setFloat32(at + offset + axis * 4, value, true));
    if (edit.bsRadius !== undefined) view.setFloat32(at + 80, edit.bsRadius, true);
    if (edit.clipDictionary !== undefined) view.setUint32(at + 96, edit.clipDictionary >>> 0, true);
  }
  const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return out;
}

/* ------------------------------------------------------------------ *
 * Дальний фасад
 * ------------------------------------------------------------------ */

/* Облик дальнего фасада: тон цвета работы; «Стандарт» — дальний фасад штатный. */
function facadeLodOp(settings) {
  const item = settings.facade;
  if (item.mode === "standard") return null;
  if (item.mode === "colour") return { kind: "tint", colour: item.look.colour };
  /* Узор издалека — его первый цвет, картинка — подкраска картинки или
     серый: дальняя модель — пятно, рисунка на ней не видно. */
  if (item.mode === "pattern") return { kind: "tint", colour: item.pattern?.colours?.[0] || "#8a8a8a" };
  return { kind: "tint", colour: item.image?.tint || "#8a8a8a" };
}

/* Модели фасада места из игры: `[{ placement, drawable }]` (штатные — для поля и мест вдали). */
async function facadeDrawables(server, game) {
  const drawables = new Map();
  const out = [];
  const gta5rp = arenaServerInventory("gta5rp")?.facade || [];
  for (const placement of arenaServerInventory(server)?.facade || []) {
    const at = placement.at || gta5rp.find((item) => item.model === placement.model)?.at;
    if (!at) continue;
    if (!drawables.has(at)) {
      const bytes = await game.read(at).catch(() => null);
      let drawable = null;
      try {
        drawable = bytes ? readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: kindOf(at) }).drawables[0] || null : null;
      } catch {
        drawable = null;
      }
      drawables.set(at, drawable);
    }
    const drawable = drawables.get(at);
    if (drawable) out.push({ placement, drawable });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Места снаружи вдали (задача 11 ТЗ 10.10.2026)
 * ------------------------------------------------------------------ */

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vunit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length ? a.map((value) => value / length) : null;
};
/* Y-вверх читателя моделей → Z-вверх игры. */
const toGameAxes = (x, y, z) => [x, -z, y];

/*
 * Грани листа `texture` у моделей фасада в мире: `[{ world, uv, normal }]`;
 * нормаль — по нормалям вершин (куда грань смотрит снаружи), а не по обходу.
 */
function sheetTriangles(items, texture) {
  const out = [];
  for (const { placement, drawable } of items) {
    const place = placementTransform(placement);
    const turn = placementTransform({ ...placement, position: [0, 0, 0] });
    for (const mesh of drawable.meshes || []) {
      if (String(mesh.material?.textures?.diffuse || "").toLowerCase() !== texture || !mesh.uvs) continue;
      for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
        const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
        const world = ids.map((id) => place(toGameAxes(mesh.positions[id * 3], mesh.positions[id * 3 + 1], mesh.positions[id * 3 + 2])));
        const facing = mesh.normals
          ? ids.reduce(
              (sum, id) => {
                const n = turn(toGameAxes(mesh.normals[id * 3], mesh.normals[id * 3 + 1], mesh.normals[id * 3 + 2]));
                return [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]];
              },
              [0, 0, 0],
            )
          : null;
        const winding = vcross(vsub(world[1], world[0]), vsub(world[2], world[0]));
        const normal = facing && vdot(winding, facing) < 0 ? winding.map((value) => -value) : winding;
        out.push({ world, uv: ids.map((id) => [mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]]), normal });
      }
    }
  }
  return out;
}

/*
 * Где в мире остров листа: грани, чья развёртка в его прямоугольнике, —
 * кусками (у трёх стел один лист — три места). `[{ point, normal, width,
 * height }]` — в осях наложений дальнего листа (`paintOverlays`).
 */
function islandFrames(triangles, rect) {
  const slack = 0.002;
  const inside = triangles.filter(({ uv }) => {
    const u = (uv[0][0] + uv[1][0] + uv[2][0]) / 3;
    const v = (uv[0][1] + uv[1][1] + uv[2][1]) / 3;
    return u >= rect[0] - slack && u <= rect[2] + slack && v >= rect[1] - slack && v <= rect[3] + slack;
  });
  const centres = inside.map(({ world }) => world.reduce((sum, point) => sum.map((value, axis) => value + point[axis] / 3), [0, 0, 0]));
  const root = inside.map((_, index) => index);
  const find = (index) => (root[index] === index ? index : (root[index] = find(root[index])));
  for (let i = 0; i < inside.length; i += 1)
    for (let j = i + 1; j < inside.length; j += 1) if (Math.hypot(...vsub(centres[i], centres[j])) < 3) root[find(i)] = find(j);
  const pieces = new Map();
  inside.forEach((triangle, index) => {
    const key = find(index);
    pieces.set(key, [...(pieces.get(key) || []), triangle]);
  });
  const out = [];
  for (const list of pieces.values()) {
    const normal = vunit(list.reduce((total, triangle) => total.map((value, axis) => value + triangle.normal[axis]), [0, 0, 0]));
    if (!normal) continue;
    const helper = Math.abs(normal[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    const right = vunit(vcross(helper, normal));
    const up = vcross(normal, right);
    const points = list.flatMap((triangle) => triangle.world);
    const along = (axis) => points.map((point) => vdot(point, axis));
    const [s, t, h] = [along(right), along(up), along(normal)];
    const width = Math.max(...s) - Math.min(...s);
    const height = Math.max(...t) - Math.min(...t);
    if (width < 0.1 || height < 0.1) continue;
    const sMid = (Math.max(...s) + Math.min(...s)) / 2;
    const tMid = (Math.max(...t) + Math.min(...t)) / 2;
    const hMid = h.reduce((total, value) => total + value, 0) / h.length;
    out.push({ point: [0, 1, 2].map((axis) => right[axis] * sMid + up[axis] * tMid + normal[axis] * hMid), normal, width, height });
  }
  return out;
}

/* Картинка места вдали — как его видно спереди: тот же вид, что в листе вблизи. */
function overlayPicture(layer, pictures, aspect) {
  const longest = 256;
  const [width, height] = aspect >= 1 ? [longest, Math.max(8, Math.round(longest / aspect))] : [Math.max(8, Math.round(longest * aspect)), longest];
  const rgba = new Uint8ClampedArray(width * height * 4);
  const image = layer.image ? pictures[layer.image] || null : null;
  if (layer.image && !image) return null;
  placeImageInIslands(rgba, width, height, [{ rect: [0, 0, 1, 1], swap: false, flipU: false, flipV: false, aspect }], image, layer.transform);
  return { rgba, width, height };
}

/* Острова мест снаружи без полотен у арок (у них свои дальние модели). */
const outsideRegions = (record) => (record.regions || []).filter((region) => !(region.section === "outBanners" && region.place === "cloth"));

/*
 * Места снаружи со своим видом — и вдали (задача 11): плакат шоу, полотна
 * с игроками, флаги и полоса MAZE BANK ARENA стел, логотип на стелах. Вблизи
 * их вид — в листах фасада (`arenaOutsideLayers`), а вдали игра рисует
 * дальний лист фасада со штатным рисунком. Теперь вид каждого острова
 * ложится на дальние листы наложением по своему месту в мире (как своя
 * надпись над входом), «Убрать» — стиранием тоном вокруг. Полотна у арок —
 * своими дальними моделями (`finishClothLod`).
 */
function outsideOverlays(server, settings, items, pictures) {
  const overlays = [];
  for (const record of arenaServerInventory(server)?.textures || []) {
    if (record.group !== "outside") continue;
    const regions = outsideRegions(record);
    const layers = regions.length ? arenaOutsideLayers(settings, { ...record, regions }, server) : [];
    if (!layers.length) continue;
    const triangles = sheetTriangles(items, record.name.toLowerCase());
    for (const layer of layers)
      for (const island of layer.islands)
        for (const frame of islandFrames(triangles, island.rect)) {
          if (layer.clear) overlays.push({ ...frame, erase: true, reach: 2 });
          const image = overlayPicture(layer, pictures, frame.width / frame.height);
          if (image) overlays.push({ ...frame, image, reach: 2 });
        }
  }
  return overlays;
}

/*
 * Дальний фасад: тон работы и наложения по плоскости (`overlays` —
 * объёмные буквы, щит и знак над входом: их место стирается тоном стены
 * вокруг, своя надпись или эмблема ложится поверх; места снаружи со своим
 * видом — `outsideOverlays`), чтобы издалека фасад выглядел так же, как
 * вблизи.
 */
async function buildFacadeLod(server, settings, { game, lod, overlays = [], files = [], pictures = {} }) {
  if (!lod || !game) return null;
  const tint = facadeLodOp(settings);
  /* Ровный цвет вдали — тоном; эффект, узор, картинка — переносом листа HD
     (`transfer`): вдали тот же рисунок фасада, а не один его цвет (фикс 1
     ТЗ 06.10.2026: с километра фасад был плоским первым цветом градиента). */
  const solid = settings.facade?.mode === "colour" && normalizeColourEffect(settings.facade.look).mode === "solid";
  const op = tint && !solid ? { kind: "transfer", fallback: tint.colour } : tint;
  const outside = (arenaServerInventory(server)?.textures || []).some(
    (record) => record.group === "outside" && outsideRegions(record).length && arenaOutsideLayers(settings, { ...record, regions: outsideRegions(record) }, server).length,
  );
  if (!op && !overlays.length && !outside) return null;
  const records = new Map((arenaServerInventory(server)?.textures || []).filter((record) => record.group === "facade").map((record) => [record.name, record]));
  const sampler = op?.kind === "transfer" ? createSurfaceSampler({ game, files, records }) : null;
  if (sampler) await sampler.prepare();
  const items = await facadeDrawables(server, game);
  const field = createLookField();
  for (const { placement, drawable } of items) field.addDrawable(drawable, placement, () => 0, sampler ? sampler.colourOf : null);
  const all = outside ? [...overlays, ...outsideOverlays(server, settings, items, pictures)] : overlays;
  return buildLodFiles({ lod, game, field, ops: [op], overlays: all });
}

/*
 * Модель фасада места: правленая из пакета (по имени файла), иначе из игры.
 * У Majestic места фасада без адреса берут адрес штатной модели GTA 5 RP.
 */
function facadeReader(files, game) {
  const gta5rp = arenaServerInventory("gta5rp")?.facade || [];
  return async (placement) => {
    const at = placement.at || gta5rp.find((item) => item.model === placement.model)?.at;
    if (!at) return null;
    const name = String(at).split("/").pop().toLowerCase();
    const built = files.find((file) => file.name.toLowerCase() === name);
    return built ? built.bytes : game.read(at).catch(() => null);
  };
}

/* ------------------------------------------------------------------ *
 * Полотна у арок по одному (задача 10)
 * ------------------------------------------------------------------ */

/* Вид полотна на его листе: картинка или свой текст в обе половины, тон или штатный лист. */
function clothOp(job, islands) {
  const look = job.look;
  if ((look.mode === "image" && look.image?.asset) || (look.mode === "text" && emblemTextFilled(look.text))) return { image: job.image, islands, transform: look.transform };
  if (look.mode === "colour") return { tint: look.colour };
  return null;
}

/* Лист словаря игры по адресу: `{ bytes, ref }`; нет — `null`. */
async function gameSheet(game, at, fileName, texture) {
  const bytes = await game.read(at).catch(() => null);
  if (!bytes) return null;
  const ref = resourceRefs(new Uint8Array(bytes), fileName).refs.find((item) => item.name.toLowerCase() === texture && item.complete);
  return ref ? { bytes, ref } : null;
}

/*
 * Дальняя модель каждого полотна: родитель его сущности в карте квартала
 * (`ARENA_CLOTH_LOD.maps`) — `Map` хеш архетипа полотна → хеш архетипа
 * дальней модели. Карта игрока не та — пусто (вдали полотно — как было).
 */
async function clothLodParents(game) {
  const parentBytes = await game.read(ARENA_CLOTH_LOD.maps.parent).catch(() => null);
  if (!parentBytes) return new Map();
  const parentName = joaatName(path.posix.basename(ARENA_CLOTH_LOD.maps.parent, ".ymap")) >>> 0;
  const parents = readMapEntities(new Uint8Array(parentBytes)).entities;
  const out = new Map();
  for (const at of ARENA_CLOTH_LOD.maps.hd) {
    const bytes = await game.read(at).catch(() => null);
    if (!bytes) continue;
    const map = readMapEntities(new Uint8Array(bytes));
    if (map.parent !== parentName) continue;
    for (const entity of map.entities) {
      const parent = entity && entity.parentIndex >= 0 ? parents[entity.parentIndex] : null;
      if (parent) out.set(entity.archetype, parent.archetype);
    }
  }
  return out;
}

/*
 * Полотна со своим видом: у каждого — свой словарь `astral_arenas_bNN.ytd`
 * из двух листов: `xj_v_fameorshamebanner` (с HD-копии стадиона, чтобы
 * копия была не мягче штатной вблизи) и дальний `sp1_10_banners_lod` (его
 * видом обе половины полотен). Архетип полотна в типах района смотрит на
 * словарь сразу; архетип дальней модели — после сборки LOD набора
 * (`lodRebind`: те же типы правит и LOD). `{ files, patches, lodRebind }`.
 */
async function buildClothFiles({ project, inventory, game, pictures, compile, stateDir }) {
  const jobs = arenaClothJobs(project);
  if (!jobs.length) return { files: [], patches: [], lodRebind: new Map() };
  if (typeof compile !== "function") throw new Error("Сборщик словарей полотен не подключён — обновите Astral.");
  const record = (inventory.textures || []).find((item) => item.group === "outside" && item.name === ARENA_CLOTH_TEXTURE);
  const region = record?.regions?.find((item) => item.section === "outBanners" && item.place === "cloth");
  const sourceAt = record?.hd?.at || record?.at;
  const sourceName = record?.hd?.file || record?.file;
  if (!record || !region || !sourceAt) throw new Error("Листа полотен у арок нет в описи арены — обновите Astral.");
  const near = await gameSheet(game, sourceAt, sourceName, ARENA_CLOTH_TEXTURE);
  if (!near) throw new Error(`Лист ${ARENA_CLOTH_TEXTURE} не прочитался из ${sourceName} — полотна у арок не собрать.`);
  const typesBytes = await game.read(ARENA_CLOTH_TYPES.at).catch(() => null);
  if (!typesBytes) throw new Error(`Типы района ${ARENA_CLOTH_TYPES.name} не прочитались из игры.`);
  /* Дальний лист и дальние модели: нет их — полотно вдали как было, вблизи — своё. */
  const far = await gameSheet(game, ARENA_CLOTH_LOD.at, ARENA_CLOTH_LOD.file, ARENA_CLOTH_LOD.texture);
  const parents = far ? await clothLodParents(game) : new Map();

  const staging = path.join(stateDir || process.cwd(), "recolor", "arenas", "cloths", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const source = path.join(staging, sourceName);
    await fs.writeFile(source, near.bytes);
    const farSource = path.join(staging, ARENA_CLOTH_LOD.file);
    if (far) await fs.writeFile(farSource, far.bytes);
    /* Лист полотна видом работы — DDS в формате и с цепочкой mip листа игры. */
    const sheetDds = async (ref, op, file) => {
      const rgba = op ? sheetPixels(ref, op, { images: pictures }) : null;
      const pixels = rgba || decodeTextureRef(ref, { level: 0 }).rgba;
      await fs.writeFile(file, Buffer.from(encodeDds({ width: ref.width, height: ref.height, format: ref.format, mipLevels: ref.levels, rgba: new Uint8ClampedArray(pixels) })));
      return file;
    };
    const dictionaries = [];
    for (const job of jobs) {
      const textures = [
        { name: ARENA_CLOTH_TEXTURE, dds: await sheetDds(near.ref, clothOp(job, region.islands), path.join(staging, `${job.txd}.dds`)), source, from: ARENA_CLOTH_TEXTURE },
      ];
      if (far && parents.has(joaatName(job.model) >>> 0))
        textures.push({
          name: ARENA_CLOTH_LOD.texture,
          dds: await sheetDds(far.ref, clothOp(job, ARENA_CLOTH_LOD.islands), path.join(staging, `${job.txd}_lod.dds`)),
          source: farSource,
          from: ARENA_CLOTH_LOD.texture,
        });
      dictionaries.push({ name: job.txd, textures });
    }
    const request = path.join(staging, "request.json");
    const output = path.join(staging, "out");
    await fs.writeFile(request, JSON.stringify({ format: "astral.pack-textures", version: 1, dictionaries }));
    await compile("pack-textures", { input: request, output });
    const files = [];
    for (const job of jobs) files.push({ name: `${job.txd}.ytd`, bytes: await fs.readFile(path.join(output, `${job.txd}.ytd`)) });
    /* Архетип полотна — на свой словарь; модель и место остаются игры. */
    const rebind = new Map(jobs.map((job) => [joaatName(job.model) >>> 0, joaatName(job.txd) >>> 0]));
    const patched = patchTypesForPlace(new Uint8Array(typesBytes), { rebind });
    if (!patched.bytes || patched.patched !== jobs.length)
      throw new Error(`В типах района нашлось ${patched.patched} полотен из ${jobs.length} — карта игры не та, полотна не собраны.`);
    files.push({ name: ARENA_CLOTH_TYPES.name, bytes: patched.bytes });
    const lodRebind = new Map();
    for (const job of jobs) {
      const parent = parents.get(joaatName(job.model) >>> 0);
      if (far && parent != null) lodRebind.set(parent >>> 0, joaatName(job.txd) >>> 0);
    }
    return { files, patches: [{ file: ARENA_CLOTH_TYPES.name, cloths: jobs.map((job) => job.cloth), far: lodRebind.size }], lodRebind };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Полотна вдали после сборки LOD набора: архетипы дальних моделей полотен
 * со своим видом — на их словари (типы берутся у LOD набора, если он их
 * правил), общий вид раздела — в обеих половинах дальнего листа игры
 * (`sp1_10_lod.ytd`, тоже поверх LOD набора). `files` правится на месте.
 */
async function finishClothLod({ files, patches, settings, server, game, pictures, lodRebind }) {
  const take = async (name, at) => {
    const index = files.findIndex((file) => file.name === name);
    return index >= 0 ? { index, bytes: files[index].bytes } : { index: -1, bytes: await game.read(at).catch(() => null) };
  };
  const put = (name, index, bytes) => {
    if (index >= 0) files[index] = { name, bytes };
    else files.push({ name, bytes });
  };
  if (lodRebind.size) {
    const types = await take(ARENA_CLOTH_LOD.types.name, ARENA_CLOTH_LOD.types.at);
    const patched = types.bytes ? patchTypesForPlace(new Uint8Array(types.bytes), { rebind: lodRebind }) : null;
    if (patched?.bytes) {
      put(ARENA_CLOTH_LOD.types.name, types.index, patched.bytes);
      patches.push({ file: ARENA_CLOTH_LOD.types.name, clothLods: patched.patched });
    }
  }
  const layers = server === "gta5rp" ? arenaClothLodLayers(settings, server) : [];
  if (!layers.length) return;
  const sheet = await take(ARENA_CLOTH_LOD.file, ARENA_CLOTH_LOD.at);
  if (!sheet.bytes) return;
  const baked = await bakeFile(sheet.bytes, ARENA_CLOTH_LOD.file, (texture) => (texture === ARENA_CLOTH_LOD.texture ? { layers } : null), { images: pictures });
  if (!baked.textures.length) return;
  put(ARENA_CLOTH_LOD.file, sheet.index, baked.bytes);
  patches.push({ file: ARENA_CLOTH_LOD.file, clothLodSheet: true });
}

/* ------------------------------------------------------------------ *
 * Полотна по одному (ТЗ 11.10.2026, ночь, задача 2)
 * ------------------------------------------------------------------ */

/*
 * Свой вид полотна — своей плашкой поверх него, а не в общем листе: кусок
 * листа у Rockstar общий у многих полотен (`arena-panels.js` договора).
 * Плашка — модель-картинка того же сборщика, что «Модели» мест
 * (`buildPlaceModels`): сторона полотна — плашка в сантиметре от ткани лицом
 * наружу (`arenaPanelFaces`), картинка — `arenaPanelPicture` (как в кадре).
 * Зал GTA 5 RP — помещение игры (`v_int_62`): плашки встают его сущностями в
 * ту комнату, где висят (`compile-mlo-models`), основа — уже правленный
 * набором файл помещения (кресла, звезда). `hall()` — помещение зала
 * (`arenaHallInterior` главного процесса).
 *
 * Залы Majestic (ТЗ 12.10.2026, задача 4: «на каждый мониторчик — своя
 * фотография») — помещения сервера, их типов у Astral нет: плашки
 * вшиваются геометрией в модель главного зала (`PLACE_MODEL_HALLS`, как
 * «Модели»), основа — модель зала, уже правленная набором (листы экранов и
 * стен), или из поставки. Живой картинки там нет — у зала сервера нет клипов.
 * Изогнутый экран — по плашке на грань, каждой своя доля картинки.
 * `null` — своих полотен нет.
 */
const PANEL_SET = "arenapanels";
/* Мелкое полотно (планшет, монитор, картина) — листом 256 px: 64 плашки держит модель зала Majestic. */
const SMALL_PANEL = 1.5;
const SMALL_PANEL_SIDE = 256;

/* Картинка стороны не больше `side` по длинной стороне. */
function shrinkPixels(pixels, side) {
  const long = Math.max(pixels.width, pixels.height);
  if (long <= side) return pixels;
  const width = Math.max(1, Math.round((pixels.width * side) / long));
  const height = Math.max(1, Math.round((pixels.height * side) / long));
  return { rgba: new Uint8ClampedArray(resample(new Uint8ClampedArray(pixels.rgba), pixels.width, pixels.height, width, height)), width, height };
}

async function buildArenaPanelFiles({ project, server, files, pictures, compile, stateDir, hall, resources = new Map(), inventory = null, entityKeys = null }) {
  /* `entityKeys` — у Majestic: только эти полотна и только сущностями помещения зала (`classifyHallPanels`), вшивки в модель зала нет. */
  const plates = arenaPanelPlates(project, server).filter((plate) => !plate.over && (!entityKeys || entityKeys.has(plate.key)));
  if (!plates.length) return null;
  const hallScene = `${server}-inside`;
  /* Сущностями помещения — своя сцена «полотна»: у сцены «внутри» Majestic правила зала (вшивка), а здесь вшивки нет. */
  const scene = entityKeys ? `${hallScene}-panels` : hallScene;
  const origin = arenaScene(server, "inside")?.origin || null;
  if (!origin) throw new Error("Сцены зала арены нет в этой версии Astral.");
  const own = (name) => files.find((file) => file.name.toLowerCase() === String(name).toLowerCase()) || null;
  let interior = null;
  let hallModel = null;
  const grafted = Boolean(PLACE_MODEL_HALLS[hallScene]) && !entityKeys;
  if (entityKeys) {
    const made = majesticPanelRoom(server, inventory, origin);
    if (!made) throw new Error("Типов помещения главного зала Majestic нет в наборе Astral — обновите Astral.");
    const { room, instance } = made;
    interior = { file: room.ytyp, mlo: room.mlo, instance, read: own(room.ytyp) ? async () => own(room.ytyp).bytes : async () => resources.get(`${server}/${room.ytyp}`) || null };
  } else if (grafted) {
    const rules = PLACE_MODEL_HALLS[hallScene];
    hallModel = { file: rules.file, read: async () => own(rules.file)?.bytes || resources.get(rules.resource) || null };
  } else {
    const room = typeof hall === "function" ? hall() : null;
    if (!room) throw new Error("Помещение зала арены не нашлось в игре — подключите GTA V и нажмите «Применить» ещё раз.");
    interior = { ...room, read: own(room.file) ? async () => own(room.file).bytes : room.read };
  }
  const shown = new Map();
  const items = [];
  const remember = (pixels) => {
    const asset = `hangar-emblem:${createHash("sha256").update(Buffer.from(pixels.rgba.buffer, pixels.rgba.byteOffset, pixels.rgba.byteLength)).digest("hex")}`;
    shown.set(asset, pixels);
    return asset;
  };
  for (const plate of plates) {
    const picture = plate.image ? pictures?.[plate.image] : null;
    if (plate.image && !picture) throw new Error(`${plate.label}: картинка не пришла — нажмите «Применить» ещё раз.`);
    /* Гифка — лист кадров в рамку полотна и клип развёртки (живая плашка «Моделей»); у Majestic — первым кадром. */
    const live = arenaPanelsAnimated(server) && plate.look.mode === "image" && plate.look.image?.animation;
    const atlas = live ? arenaPanelAtlas(plate.look, picture, plate.panel) : null;
    const pixels = atlas || arenaPanelPicture(plate.look, picture, plate.panel);
    const whole = atlas ? remember(pixels) : null;
    for (const face of plate.faces) {
      /* Грань изогнутого экрана — своя доля картинки; мелкое полотно вшитым в зал — листом поменьше. */
      let facePixels = atlas ? pixels : arenaPanelFacePicture(pixels, face);
      if (grafted && Math.max(face.width, face.height) < SMALL_PANEL) facePixels = shrinkPixels(facePixels, SMALL_PANEL_SIDE);
      const asset = whole || remember(facePixels);
      items.push({
        id: `m${items.length + 1}`,
        label: plate.label,
        asset,
        shape: "plate",
        scene,
        position: face.point,
        rotation: arenaPanelRotation(face),
        size: Math.max(face.width, face.height),
        width: atlas ? atlas.frame[0] : facePixels.width,
        height: atlas ? atlas.frame[1] : facePixels.height,
        ...(atlas ? { animation: atlas.animation } : {}),
        opacity: 100,
        /* Экраны в зале светятся — и своя картинка на них тоже. */
        glow: plate.section === "screens" ? 30 : 0,
        motion: "none",
        distance: 150,
      });
    }
  }
  return buildPlaceModels(PANEL_SET, items, {
    pictures: shown,
    origin: (id) => (id === scene ? origin : null),
    interior: (id) => (id === scene ? interior : null),
    ...(hallModel ? { hall: (id) => (id === scene ? hallModel : null) } : {}),
    compile,
    stateDir,
  });
}

/* ------------------------------------------------------------------ *
 * Замена моделей сервера (Majestic, ТЗ 11.10.2026, ночь, задача 2)
 * ------------------------------------------------------------------ */

/*
 * «Своя модель» — файл `.ydr` под именем модели сервера: сетка своей
 * модели (картинка формой или модель из файла — как у «Моделей» мест),
 * вписанная в рамку прежней в её осях (`fitReplacementMesh`), лист — DXT5
 * со всеми мипами, без движения. Игра ставит её во все места прежней.
 * «Убрать» — прежняя модель, у которой все треугольники сведены в точку.
 * `sources` — картинки и сетки замен из окна (`decodePlaceModelImages`).
 */
const REPLACE_SOLID_SIDE = 512;

function replacementUnit(model, picture, mesh) {
  if (model.shape === "mesh") return placeModelUnitMesh(model, { mesh });
  if (model.shape === "solid") {
    const scale = Math.min(1, REPLACE_SOLID_SIDE / Math.max(picture.width, picture.height));
    const width = Math.max(1, Math.round(picture.width * scale));
    const height = Math.max(1, Math.round(picture.height * scale));
    const rgba = scale < 1 ? new Uint8ClampedArray(resample(new Uint8ClampedArray(picture.rgba), picture.width, picture.height, width, height)) : picture.rgba;
    return placeModelSolid(arenaStarModel, rgba, width, height, model.depth);
  }
  return placeModelUnitMesh(model);
}

/*
 * Своя модель (картинка формой или сетка из файла) одним файлом `<name>.ydr`, вписанная в рамку `bounds` в осях модели
 * (`fitReplacementMesh`: `scale`, `turn` — из `entry`). Общее у замены моделей сервера и у облика вещи зала. Ответ — `{ bytes, bounds }`; `bounds` — где
 * встала сетка в осях модели (для архетипа; вершины в файле лежат там же — сдвиг оси кости шаблона вычтен второй сборкой). `label` — как зовут вещь в отказах, `side` — предел стороны листа (по умолчанию — как у «Моделей» мест).
 */
export async function compileFittedModel({ name, model, bounds, entry, sources, compile, work, label, side, adjust = null }) {
  const picture = model.shape === "mesh" ? (model.texture ? sources?.pictures?.get(model.texture) : null) || REPLACE_GREY : sources?.pictures?.get(model.asset);
  if (!picture) throw new Error(`«${label}»: картинка своей модели не пришла — нажмите «Применить» ещё раз.`);
  const unit = replacementUnit(model, picture, sources?.meshes?.get(model.asset) || null);
  if (!unit) throw new Error(`«${label}»: в картинке нет фигуры для «Объёма» — возьмите картинку с прозрачным фоном или другую форму.`);
  let fitted = fitReplacementMesh(entry?.kind === "colour" ? flatColourUvs(unit) : unit, bounds, entry);
  /* `adjust` — своя расстановка сетки (плита перед экраном: `recolor-arena-screens.js`); `null` в ответе — ставить нечего. */
  if (adjust) {
    fitted = adjust(fitted);
    if (!fitted) return null;
  }
  /* Хост берёт сетку только в пределах ±256 м от оси (`StarModelCommands.cs`, `star_model.rs`: `MaxExtent`, `REACH`); вторая сборка сдвигает её на ось кости — отсюда запас. Отказ словами вместо «must fit within 256 m». */
  let reach = 0;
  for (const value of fitted.positions) reach = Math.max(reach, Math.abs(value));
  if (reach > STAR_MESH_REACH)
    throw new Error(`«${label}»: вещь уходит от своей оси дальше ${Math.floor(STAR_MESH_REACH)} м (до ${Math.ceil(reach)} м) — установщик не соберёт для неё копию. Верните её к игре и нажмите «Применить» ещё раз.`);
  return compileMeshModel({ name, model, mesh: fitted, picture, compile, work, label, side });
}

/* Дальше от оси модели хост сетку не соберёт (до 06.11.2026 — 40 м, у вещей Majestic до 92 м); запас 0,5 м — на сдвиг оси кости второй сборки. */
const STAR_MESH_REACH = 255.5;

/*
 * «Цвет» вещи: лист у сетки одноцветный (с клеткой стекла справа — тогда развёртка уже в 0,25 / 0,75), а развёртка вещи игры идёт с повтором листа
 * (u, v в десятки, 06.11.2026 у владельца — до 32). Хост принимает развёртку только в 0…1 («Star mesh normals or uvs are out of range»): повтору
 * одноцветного листа всё равно, берётся дробная часть.
 */
function flatColourUvs(mesh) {
  if (mesh.uvs.every((value) => value >= 0 && value <= 1)) return mesh;
  return { ...mesh, uvs: Float32Array.from(mesh.uvs, (value) => value - Math.floor(value)) };
}

/*
 * Сетка `mesh` (уже в осях модели, с рамкой `bounds`) одним файлом `<name>.ydr` со своим листом `picture`; шейдер — по облику `model` (прозрачность,
 * свечение). Вершины в файле лежат там же, где в сетке: сдвиг оси кости шаблона вычитается второй сборкой. Ответ — `{ bytes, bounds }`.
 */
async function compileMeshModel({ name, model, mesh, picture, compile, work, label, side }) {
  const sheet = placeModelSheet(picture, model.opacity, side);
  const look = placeModelShader(model, picture);
  await fs.mkdir(work, { recursive: true });
  const texture = path.join(work, "sheet.dds");
  await fs.writeFile(texture, sheet.dds, { flag: "wx" });
  const request = path.join(work, "model.json");
  const round5 = (value) => Math.round(value * 1e5) / 1e5 + 0;
  /*
   * Хост ставит сетку на место кости шаблона (`pivot` в ответе) — у «Моделей»
   * мест на него сдвигается сущность, а здесь сущность сервера не наша:
   * сдвиг вычитается из вершин, и модель встаёт ровно в рамку прежней.
   */
  const ask = (shift) =>
    JSON.stringify({
      format: "astral.compile-star-model",
      version: 1,
      name,
      clipDictionary: null,
      texture,
      textureSha256: `sha256:${createHash("sha256").update(sheet.dds).digest("hex")}`,
      width: sheet.width,
      height: sheet.height,
      lodDist: 200,
      shader: look.shader,
      ...(look.emissive !== undefined ? { emissive: look.emissive } : {}),
      mesh: {
        positions: Array.from(mesh.positions, (value, index) => round5(value - (shift[index % 3] || 0))),
        normals: Array.from(mesh.normals, round5),
        uvs: Array.from(mesh.uvs, round5),
        parts: new Array(mesh.positions.length / 3).fill(0),
        indices: Array.from(mesh.indices),
      },
      motion: null,
    });
  await fs.writeFile(request, ask([0, 0, 0]));
  const output = path.join(work, "out");
  const first = await compile("compile-star-model", { input: request, output });
  const pivot = Array.isArray(first?.pivot) ? first.pivot.map(Number) : [0, 0, 0];
  const moved = pivot.some((value) => Math.abs(value) > 1e-5);
  if (moved) {
    await fs.rm(output, { recursive: true, force: true });
    await fs.writeFile(request, ask(pivot));
    await compile("compile-star-model", { input: request, output });
  }
  const bytes = await fs.readFile(path.join(output, `${name}.ydr`)).catch(() => null);
  if (!bytes?.length) throw new Error(`«${label}»: сборка своей модели не дала файла модели.`);
  /* Рамка — сетка в осях модели (вершины в файле лежат со сдвигом на ось кости: итоговое место — вершина + ось); ось нужна пересадке в чужую модель. */
  return { bytes, bounds: mesh.bounds };
}

async function buildArenaReplacements({ server, settings, files, resources, sources, compile, stateDir, onlyHidden = false, onSkipped = null }) {
  const all = activeArenaReplacements(server, settings.replace);
  /* Своя модель вместо серверной меняет строение файла с именем сервера — у Majestic не пишется; «Убрать» остаётся. */
  const active = onlyHidden ? all.filter(({ entry }) => entry.mode === "hidden") : all;
  if (all.length > active.length) onSkipped?.(all.length - active.length);
  if (!active.length) return [];
  const out = [];
  const staging = path.join(stateDir || ".", "recolor", "arenas", "replace", randomUUID());
  try {
    for (const { entry, replacement } of active) {
      const name = `${replacement.model}.ydr`;
      if (entry.mode === "hidden") {
        const base = files.find((file) => file.name.toLowerCase() === name)?.bytes || resources.get(`${server}/${name}`);
        if (!base) throw new Error(`Модели «${replacement.label}» нет в наборе Astral — обновите Astral.`);
        const textures = new Set();
        for (const drawable of readDrawable(openResourceWith(new Uint8Array(base), inflateRaw), { inflateRaw, kind: "ydr" }).drawables)
          for (const mesh of drawable.meshes) if (mesh.material?.textures?.diffuse) textures.add(String(mesh.material.textures.diffuse).toLowerCase());
        const cleaned = hideGrimeDecals(base, textures);
        out.push({ name, bytes: cleaned.bytes || Buffer.from(base), hidden: true });
        continue;
      }
      if (typeof compile !== "function") throw new Error("Сборщик своих моделей не подключён — обновите Astral.");
      const { bytes } = await compileFittedModel({ name: replacement.model, model: entry.model, bounds: replacement.bounds, entry, sources, compile, work: path.join(staging, replacement.model), label: replacement.label });
      out.push({ name, bytes });
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Облик вещей зала (ТЗ 27.10.2026, «Предметы»)
 * ------------------------------------------------------------------ */

/*
 * Вещь зала со своей моделью или картинкой — и у штатной модели игры. Файл штатной модели общий для всей карты и не правится: вещь зала — запись
 * сущности в типах помещения, и она переводится на свою копию модели:
 *
 *   • копия (`arenaItemCopyName`) — модель из своей модели или картинки, вписанная в рамку прежней в её осях (`compileFittedModel`, лист
 *     поменьше: копий до шестнадцати, а файлов пакета — 16 МБ), новым файлом набора Astral;
 *   • её архетип — в типах помещения (`compile-mlo-models`): так сборщик положит архетип в тот же файл, где стоит вещь, и сам заведёт для него сущность —
 *     её прячет дальность 1 см, как «Удалить»;
 *   • сущности вещей группы смотрят на копию (`patchInteriorEntities`): место, поворот и размер записи те же, остальные вещи той же модели и остальная
 *     карта не меняются. Хеш модели записи сверяется — чужой файл типов отказ, а не правка мимо.
 *
 * Группа, что стоит в нескольких залах Majestic, получает копию на каждый зал: у каждого зала свои типы, и архетип с тем же именем в двух типах
 * игре ни к чему. Типы залов — уже правленные (убранные вещи), основа — они же.
 */
/*
 * Листы элементов со своей картинкой или цветом (`kind: "elements"`): цвет — тоном по светотени листа (`tint`, как «Цвет» всей вещи), картинка —
 * правка `placeImageInIslands` — картинка в остров развёртки элемента в файле
 * модели (`itemElementIsland`, та же функция у превью окна), подгонка элемента, вокруг картинки лист как был (`background: "keep"`). Элемента
 * нет среди диффузных листов модели или картинка не пришла — отказ словами, а не тихий пропуск.
 */
function elementSheetOps(model, elements, diffuse, pictures, place, kind = "ydr") {
  const ops = new Map();
  /* Рамка всей вещи — у обёртки та же, что у кадра (рамка всех сеток вещи). */
  let frame;
  const frameOf = () => (frame === undefined ? (frame = modelFrame(model, place)) : frame);
  /* Картинки на элементах с проекцией (развёртка в точку у плоского, изрезанная у объёмной вещи — обёртка): им лист не правится, а ставится
     своя сетка с проекцией (`projectedElements`). */
  const projected = [];
  for (const element of elements || []) {
    if (!diffuse.has(element.texture)) throw new Error(`Листа «${element.texture}» нет в модели предмета: файл игры другой версии — выберите элемент ещё раз.`);
    /* Свой цвет — лист тоном по своей светотени, как «Цвет» всей вещи: средний пиксель листа — ровно этот цвет. */
    if (element.colour) {
      ops.set(element.texture, { tint: element.colour, ref: "mean" });
      continue;
    }
    const image = pictures?.get(element.picture.asset);
    if (!image) throw new Error(`Картинка на «${element.texture}» не пришла — нажмите «Применить» ещё раз.`);
    const meshes = itemElementMeshesPlaced(elementMeshes(model, element.texture), place);
    /* Обёртка — только у .ydr: у фрагмента .yft своя сетка элемента не встанет, картинка ложится по развёртке, как в кадре (`wrap`). */
    if ((element.around && kind === "ydr") || itemElementProjection(meshes, { front: itemElementFront(place), frame: frameOf(), wrap: kind === "ydr" })) {
      projected.push({ element, image });
      continue;
    }
    const island = itemElementIsland(meshes);
    if (!island) throw new Error(`У листа «${element.texture}» нет развёртки — картинку на него не положить.`);
    ops.set(element.texture, { image, islands: [island], transform: { fit: element.fit, background: "keep" } });
  }
  return { ops, projected };
}

/* Сторона листа картинки на элементе с проекцией: экран и стена — метры, 512 точек на них мало (монитор фестиваля — 11 м). */
const PROJECTED_SHEET_SIDE = 1024;

/*
 * Картинки на элементах с развёрткой в точку (владелец 01.11.2026: монитор фестиваля Majestic — ровный серый цвет вместо картинки): грань «blocking»-листа
 * берёт один тексель, и картинка, вписанная в лист, легла бы одним цветом. Как облик части вещи (`buildPartCopy`): треугольники листа элемента сведены в
 * точку на всех ступенях (`hideGrimeDecals`), а на их месте — своя сетка элемента в осях модели с развёрткой проекцией на его плоскость
 * (`elementProjectedMesh` — та же плоскость, что у кадра) и листом-картинкой целиком в пропорции плоскости (подгонка элемента, поля — чёрные, как в
 * кадре), пересаженная в копию (`graft-drawable`). Ответ — байты модели. Так же — изрезанная развёртка объёмной вещи (золото кубка, владелец
 * 01.11.2026: «не исправил наложения фотографии на кубок»): своя сетка элемента обёрткой вокруг оси вещи (`itemElementWrap` договора).
 */
async function projectedElements({ name, bytes, model, projected, place, compile, work, kind }) {
  if (kind !== "ydr") throw new Error("Это фрагмент игры, а развёртка его листа — в точку: картинку на этот элемент не положить. Поставьте её на другой элемент или «Картинкой вместо предмета».");
  const cut = hideGrimeDecals(bytes, projected.map((item) => item.element.texture));
  await fs.mkdir(work, { recursive: true });
  let target = path.join(work, "cut.ydr");
  await fs.writeFile(target, cut.bytes || bytes);
  for (const [index, { element, image }] of projected.entries()) {
    const built = elementProjectedMesh(model, element.texture, place, element.around === true);
    if (!built) throw new Error(`Листа «${element.texture}» нет в модели предмета: файл игры другой версии — выберите элемент ещё раз.`);
    if (built.mesh.positions.length / 3 > PART_VERTEX_LIMIT) throw new Error(`У элемента «${element.texture}» слишком подробная сетка для своей картинки.`);
    const { aspect } = built.plane;
    const side = PROJECTED_SHEET_SIDE;
    const [width, height] = aspect >= 1 ? [side, Math.max(8, Math.round(side / aspect))] : [Math.max(8, Math.round(side * aspect)), side];
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
    placeImageInIslands(rgba, width, height, [itemElementProjectedIsland(built.plane)], image, { fit: element.fit, background: "keep" });
    const donorName = `${name}_e${index + 1}`;
    const step = path.join(work, `element-${index + 1}`);
    /* Тонкое полотно (экран, плакат) видно с обеих сторон, а шейдер своей модели односторонний. */
    const mesh = built.plane.flat ? withBackFaces(built.mesh) : built.mesh;
    const donorModel = await compileMeshModel({ name: donorName, model: { shape: "mesh", opacity: 100, glow: 0 }, mesh, picture: { rgba, width, height }, compile, work: step, label: element.texture, side });
    const donor = path.join(step, "donor.ydr");
    await fs.writeFile(donor, donorModel.bytes);
    const request = path.join(step, "graft.json");
    const output = path.join(step, "graft", `${name}.ydr`);
    await fs.writeFile(request, JSON.stringify({ format: "astral.graft-drawable", version: 1, target, donor, diffuse: [`${donorName}_star`] }));
    await compile("graft-drawable", { input: request, output });
    target = output;
  }
  const out = await fs.readFile(target).catch(() => null);
  if (!out?.length) throw new Error(`Картинка на элементе не села в модель «${name}».`);
  return out;
}

/*
 * Своя картинка на стенах, полу и потолке зала Majestic (владелец 01.11.2026: «картинкой на каждую стену, а не мелкой плиткой»): в каждой модели
 * зала из набора (оболочки и потолки, `isFinishWallModel`) грани поверхности сводятся в точку, а на их месте — своя сетка с развёрткой проекцией
 * на стены и листом-картинкой (`recolor-arena-walls.js`, договор `finish-walls.js` — те же функции у кадра). Лист — картинка отделки с подкраской
 * (`finishSource`), глухая: прозрачное — чёрным, как у кадра. Модели правятся поверх уже собранных листов, полотна зала встают уже на них.
 */
async function buildArenaFinishWalls({ server, settings, inventory, files, resources, images, compile, stateDir, report, patches }) {
  const surfaces = FINISH_WALL_SURFACES.filter((surface) => arenaSurfaceProjected(server, surface, settings[surface]));
  if (!surfaces.length) return;
  if (typeof compile !== "function") throw new Error("Сборщик своих моделей не подключён — обновите Astral.");
  const sheets = new Map(
    surfaces.map((surface) => [
      surface,
      new Set((inventory.textures || []).filter((record) => record.group === surface && record.role === "diffuse" && !arenaOverlaySheet(record)).map((record) => record.name.toLowerCase())),
    ]),
  );
  const pictures = new Map(surfaces.map((surface) => [surface, opaquePicture(finishSource(settings[surface], images))]));
  const staging = path.join(stateDir || ".", "recolor", "arenas", "walls", randomUUID());
  report.finishWalls = [];
  try {
    for (const model of (inventory.files || []).filter(isFinishWallModel)) {
      const at = files.findIndex((file) => file.name.toLowerCase() === model.toLowerCase());
      const base = at >= 0 ? files[at].bytes : resources.get(`${server}/${model}`);
      if (!base) {
        report.missing.push(model);
        continue;
      }
      const faces = surfaceFaces(base, model, sheets);
      const built = surfaces
        .filter((surface) => faces.has(surface))
        .map((surface) => ({ surface, ...projectedSurfaceMeshes(faces.get(surface), finishWallMetres(settings[surface]), pictures.get(surface).width / pictures.get(surface).height) }));
      if (!built.some((item) => item.meshes.length)) continue;
      /* Вырез — ровно грани стен с картинкой: ступени, плинтусы и ламели остаются как на сервере. */
      const cut = collapseFaces(base, built.flatMap((item) => item.faces.map((face) => faces.get(item.surface).refs[face])));
      const work = path.join(staging, model.replace(/\.ydr$/i, ""));
      await fs.mkdir(work, { recursive: true });
      let target = path.join(work, "cut.ydr");
      await fs.writeFile(target, cut);
      const done = [];
      let donors = 0;
      for (const { surface, ...item } of built) {
        if (!item.meshes.length) continue;
        for (const mesh of item.meshes) {
          donors += 1;
          const donorName = `${model.replace(/\.ydr$/i, "")}_f${donors}`;
          const step = path.join(work, `walls-${donors}`);
          const donor = await compileMeshModel({ name: donorName, model: { shape: "mesh", opacity: 100, glow: 0 }, mesh, picture: pictures.get(surface), compile, work: step, label: model, side: PROJECTED_SHEET_SIDE });
          const donorFile = path.join(step, "donor.ydr");
          await fs.writeFile(donorFile, donor.bytes);
          const request = path.join(step, "graft.json");
          const output = path.join(step, "graft", model);
          await fs.writeFile(request, JSON.stringify({ format: "astral.graft-drawable", version: 1, target, donor: donorFile, diffuse: [`${donorName}_star`] }));
          await compile("graft-drawable", { input: request, output });
          target = output;
        }
        done.push({ surface, walls: item.walls, vertices: item.meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0) });
      }
      const bytes = await fs.readFile(target).catch(() => null);
      if (!bytes?.length) throw new Error(`Картинка на стенах не села в модель «${model}».`);
      if (at >= 0) files[at].bytes = bytes;
      else files.push({ name: model, bytes });
      patches.push({ file: model, finishWalls: done.map((item) => item.surface) });
      report.finishWalls.push(...done.map((item) => ({ file: model, ...item })));
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/* Картинка отделки глухой: в листе своей сетки прозрачного нет (кадр берёт у картинки только цвет, прозрачное у него — чёрное). */
function opaquePicture(source) {
  const rgba = new Uint8ClampedArray(source.rgba);
  for (let at = 0; at < rgba.length; at += 4) {
    if (!rgba[at + 3]) rgba[at] = rgba[at + 1] = rgba[at + 2] = 0;
    rgba[at + 3] = 255;
  }
  return { rgba, width: source.width, height: source.height };
}

/*
 * «Цвет» штатной модели с перекраской её листов: копия модели — файл `.ydr` из игры (или набора Astral) с перекрашенными встроенными листами, а листы,
 * что модель берёт из общего словаря, — в своём словаре копии `<копия>.ytd` (архетип копии смотрит на словарь с тем же именем). Перекрашиваются
 * диффузные листы: тон по светотени, рисунок остаётся; нормали и блеск идут как были. Откуда брать модель и словари — опись
 * `arena-item-sources.js` (`scripts/prepare-arena-item-sources.mjs`). `null` — файла у игрока нет: вызывающий откатывается к одноцветной сетке.
 */
export async function buildPaintedCopy({ name, colour, source, readAt, work, compile, kind = "ydr", elements = null, pictures = null, place = null }) {
  /* `colour` — `null`: копия без перекраски (основа облика по частям) — листы из общих словарей едут в словарь копии байт в байт.
     `elements` — картинки на листах элементов (`kind: "elements"`, `item-elements.js`); `pictures` — их пиксели по ключу картинки; `place` — как
     стоит в мире первая вещь группы (`arenaItemPlace`): по ней у картинки верх, как в кадре. */
  const model = await readAt(source[0]);
  if (!model?.length) return null;
  const { drawables, refs } = resourceRefs(new Uint8Array(model), `model.${kind}`);
  const diffuse = new Set();
  const wanted = new Set();
  for (const drawable of drawables)
    for (const mesh of drawable.meshes)
      for (const [slot, value] of Object.entries(mesh.material?.textures || {})) {
        if (!value) continue;
        wanted.add(String(value).toLowerCase());
        if (slot === "diffuse") diffuse.add(String(value).toLowerCase());
      }
  const embedded = new Set(refs.map((ref) => ref.name.toLowerCase()));
  const { ops: elementOps, projected } = elementSheetOps(model, elements, diffuse, pictures, place, kind);
  /* Что делать с листом: картинка элемента, перекраска «Цвета» или ничего (лист едет как был). */
  /* «Цвет» всей вещи — тем же правилом, что у элемента: средний пиксель каждого листа становится выбранным цветом (опора — средняя яркость листа). */
  const opOf = (texture) => elementOps.get(texture) || (colour && diffuse.has(texture) ? { tint: colour, ref: "mean" } : null);
  const tinted = (texture) => Boolean(opOf(texture));
  const baked = await bakeFile(model, `model.${kind}`, (texture) => opOf(texture));
  const missing = [...wanted].filter((texture) => !embedded.has(texture));
  const bytes = projected.length ? await projectedElements({ name, bytes: baked.bytes, model, projected, place, compile, work: path.join(work, "projected"), kind }) : baked.bytes;
  const files = [{ name: `${name}.${kind}`, bytes }];
  if (!missing.length) return { files, painted: baked.textures.length, shared: 0 };

  /* Листы из общих словарей — в словарь копии; нет листа в перечисленных словарях — файл игры другой версии. */
  const found = new Map();
  await fs.mkdir(work, { recursive: true });
  for (const [index, at] of source[1].entries()) {
    const bytes = await readAt(at);
    if (!bytes?.length) return null;
    const file = path.join(work, `dictionary${index}.ytd`);
    await fs.writeFile(file, bytes);
    for (const ref of resourceRefs(new Uint8Array(bytes), "dictionary.ytd").refs) if (!found.has(ref.name.toLowerCase())) found.set(ref.name.toLowerCase(), { ref, file });
  }
  const textures = [];
  for (const texture of missing) {
    const hit = found.get(texture);
    if (!hit) return null;
    const dds = path.join(work, `${texture.replace(/[^a-z0-9_.+-]/g, "_")}.dds`);
    /* Диффузный лист перекрашивается или берёт картинку элемента (декод, правка, запись); остальные — нормали, блеск, общие `env_…` — едут байт в байт,
       без пересжатия (ATI2 `encodeDds` не пишет). */
    const op = opOf(texture);
    const raw = op ? null : rawDdsOf(hit.ref);
    if (raw) await fs.writeFile(dds, raw);
    else {
      const rgba = op ? sheetPixels(hit.ref, op) : new Uint8ClampedArray(decodeTextureRef(hit.ref, { level: 0 }).rgba);
      await fs.writeFile(dds, Buffer.from(encodeDds({ width: hit.ref.width, height: hit.ref.height, format: hit.ref.format, mipLevels: hit.ref.levels, rgba })));
    }
    textures.push({ name: texture, dds, source: hit.file, from: texture });
  }
  const request = path.join(work, "pack.json");
  const output = path.join(work, "pack");
  await fs.writeFile(request, JSON.stringify({ format: "astral.pack-textures", version: 1, dictionaries: [{ name, textures }] }));
  await compile("pack-textures", { input: request, output });
  const dictionary = await fs.readFile(path.join(output, `${name}.ytd`)).catch(() => null);
  if (!dictionary?.length) throw new Error(`Сборка листов копии «${name}» не дала словаря.`);
  files.push({ name: `${name}.ytd`, bytes: dictionary });
  return { files, painted: baked.textures.length + textures.filter((item) => tinted(item.name)).length, shared: textures.length };
}

/* Коллизия, зашитая в сам `.ydr` (`gtaDrawable`: указатель на границу на `+0xC8`; у моделей без неё — ноль). `null` — коллизии нет. */
const EMBEDDED_BOUND_AT = 0xc8;
export function embeddedBound(bytes) {
  const resource = openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
  const pointer = resource.view.getBigUint64(EMBEDDED_BOUND_AT, true);
  if (!pointer) return null;
  const at = Number(pointer & 0x0fffffffn);
  /* Вид границы — байт на +0x10 (3 — геометрия, 10 — составная и т. д.); вместе с ним сверяется, что граница та же. */
  return { at, type: resource.view.getUint8(at + 0x10) };
}

/*
 * Коллизия прежней вещи у копии со своей моделью или картинкой: копия строится на основе файла прежней модели (его геометрия сведена в точку, всё
 * остальное — в том числе зашитая коллизия — на месте), а собранная своя сетка пересаживается в него (`graft-drawable`). Игрок не проходит сквозь
 * кубок, как и сквозь штатный. Нет файла прежней модели или в нём нет коллизии — `null`: копия остаётся как собрана (коллизии у неё нет).
 */
export async function keepOriginalCollision({ name, built, source, readAt, work, compile }) {
  const original = source ? await readAt(source[0]) : null;
  if (!original?.length || !embeddedBound(original)) return null;
  const { drawables } = resourceRefs(new Uint8Array(original), "model.ydr");
  const diffuse = new Set();
  for (const drawable of drawables) for (const mesh of drawable.meshes) if (mesh.material?.textures?.diffuse) diffuse.add(String(mesh.material.textures.diffuse).toLowerCase());
  const hidden = hideGrimeDecals(original, diffuse);
  await fs.mkdir(work, { recursive: true });
  const target = path.join(work, "target.ydr");
  const donor = path.join(work, "donor.ydr");
  await fs.writeFile(target, hidden.bytes || Buffer.from(original));
  await fs.writeFile(donor, built);
  const request = path.join(work, "graft.json");
  const output = path.join(work, "graft", `${name}.ydr`);
  await fs.writeFile(request, JSON.stringify({ format: "astral.graft-drawable", version: 1, target, donor, diffuse: [`${name}_star`] }));
  await compile("graft-drawable", { input: request, output });
  const bytes = await fs.readFile(output).catch(() => null);
  if (!bytes?.length || !embeddedBound(bytes)) throw new Error(`Своя сетка не села на модель с прежней коллизией для «${name}».`);
  return { bytes };
}

const ITEM_SHEET_SIDE = 512;
const ITEM_LOD = 150;

/* Лист 4 × 4 одного цвета (`#rrggbb`): облик «Цвет» части. */
function colourPicture(colour) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
  const rgba = new Uint8ClampedArray(64);
  for (let at = 0; at < 64; at += 4) rgba.set([r, g, b, 255], at);
  return { rgba, width: 4, height: 4 };
}

/*
 * Облик по частям одной копией (`recolor-arena-parts.js`): основа — прежняя модель (листы из общих словарей — в словарь копии, `buildPaintedCopy`
 * без цвета), треугольники всех частей `parts` (группы облика с `part`) сведены в точку, облик каждой части собран своей моделью в осях модели и
 * пересажен в копию (`graft-drawable`); убранная часть (`kind: "removed"`) — только вырез, без новой сетки. Нет файла прежней модели или части в нём —
 * отказ словами: накладка поверх целой модели оставила бы
 * прежнюю часть видимой под новой. Ответ — `{ files, bounds, parts, removed, shared }`; первый файл — `<name>.ydr`. Общий у вещей зала и вещей мест
 * (`recolor-place-items.js`): `source` — `[место модели, [места словарей]]`.
 */
export async function buildPartCopy({ name, parts, modelName, frame, source, readAt, sources, compile, work }) {
  const title = (group, index) => group.part.label || `${index + 1}`;
  if (!source) throw new Error(`У модели «${modelName}» нет файла в описи Astral — облик на её часть не поставить. Поставьте облик на всю вещь.`);
  const base = await buildPaintedCopy({ name, colour: null, source, readAt, work: path.join(work, "base"), compile });
  if (!base) throw new Error(`Файл модели «${modelName}» не прочитался — подключите GTA V и нажмите «Применить» ещё раз.`);
  const original = base.files[0].bytes;
  const boxes = parts.map((group) => group.part.box);
  const meshes = parts.map((group, index) => {
    const mesh = partMesh(original, group.part.box);
    if (!mesh) throw new Error(`Части «${title(group, index)}» нет в модели «${modelName}»: файл игры другой версии — выберите часть ещё раз.`);
    if (mesh.positions.length / 3 > PART_VERTEX_LIMIT) throw new Error(`У части «${title(group, index)}» слишком подробная сетка для своего облика.`);
    return mesh;
  });
  const cut = cutParts(original, boxes);
  await fs.mkdir(work, { recursive: true });
  let target = path.join(work, "cut.ydr");
  await fs.writeFile(target, cut.bytes || Buffer.from(original));
  const min = [...frame.min];
  const max = [...frame.max];
  for (const [index, group] of parts.entries()) {
    if (group.kind === "removed") continue;
    const donorName = `${name}_p${index + 1}`;
    const step = path.join(work, `part-${index + 1}`);
    const label = title(group, index);
    let built;
    if (group.kind === "model") {
      built = await compileFittedModel({ name: donorName, model: group.model, bounds: { min: group.part.box[0], max: group.part.box[1] }, entry: group, sources, compile, work: step, label, side: ITEM_SHEET_SIDE });
    } else {
      const plane = partPlane(meshes[index]);
      let picture;
      let mesh = meshes[index];
      if (group.kind === "colour") picture = colourPicture(group.colour || "#8a8a8a");
      else {
        picture = sources?.pictures?.get(group.model.asset);
        if (!picture) throw new Error(`«${label}»: картинка не пришла — нажмите «Применить» ещё раз.`);
        const animation = group.model.animation;
        mesh = projectPartUvs(mesh, animation ? (picture.width / animation.columns) / (picture.height / animation.rows) : picture.width / picture.height, plane);
        if (animation) mesh = { ...mesh, ...placeModelIntoFirstCell(mesh, animation, placeModelCellPixels(animation, picture)) };
      }
      /* Тонкое полотнище (баннер, плакат) видно с обеих сторон, а шейдер своей модели односторонний. */
      if (plane?.flat) mesh = withBackFaces(mesh);
      built = await compileMeshModel({ name: donorName, model: group.kind === "colour" ? { shape: "mesh", opacity: 100, glow: 0 } : group.model, mesh, picture, compile, work: step, label, side: ITEM_SHEET_SIDE });
    }
    const donor = path.join(step, "donor.ydr");
    await fs.writeFile(donor, built.bytes);
    const request = path.join(step, "graft.json");
    const output = path.join(step, "graft", `${name}.ydr`);
    await fs.writeFile(request, JSON.stringify({ format: "astral.graft-drawable", version: 1, target, donor, diffuse: [`${donorName}_star`] }));
    await compile("graft-drawable", { input: request, output });
    target = output;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], built.bounds.min[axis]);
      max[axis] = Math.max(max[axis], built.bounds.max[axis]);
    }
  }
  const bytes = await fs.readFile(target).catch(() => null);
  if (!bytes?.length) throw new Error(`Облик частей не сел в модель «${modelName}».`);
  return { files: [{ name: `${name}.ydr`, bytes }, ...base.files.slice(1)], bounds: { min, max }, parts: parts.map(title), removed: cut.removed, shared: base.shared };
}

/*
 * Две плиты «картинка → объём» на местах аирдропов (способ Б2, решение ведущей 20.11.2026; включатель `ASTRAL_ARENA_SLABS=1`, по умолчанию выключено).
 * Владелец ставил «Своя картинка» на аирдроп: в зале появлялась плита с его картинкой (кадры 21 и 24 разбора). В защитной сборке Majestic типы помещения сервера
 * не правятся, поэтому плиты пропали. Б2 возвращает только их: копия вещи (новый архетип в типах помещения, как у вещей до 20.11) и перенаправление слова
 * архетипа у двух сущностей аирдропа; всё остальное в `mazearena_int_<n>.ytyp` — основа набора 09.10 (сверка `scripts/lib/ytyp-append-check.mjs`).
 * Вещи с цветом, дивана, будки и экраны в эту сборку не идут.
 */
export const ARENA_SLAB_MODELS = Object.freeze(["mj_ma_int3_rm3_airdrop_main_prop"]);
/* Умолчание плит Б2 одной строкой: `false` — выключено (плиты за `ASTRAL_ARENA_SLABS=1`), `true` — включено (выключить можно `ASTRAL_ARENA_SLABS=0`).
   Включают, когда владелец подтвердил заходом, что плиты на месте и стена цела (arena9, 20.11.2026). */
export const ARENA_SLABS_DEFAULT = false;
export const slabsEnabledFrom = (value, fallback = ARENA_SLABS_DEFAULT) => (value === "1" ? true : value === "0" ? false : fallback);
export const arenaSlabsEnabled = () => slabsEnabledFrom(process.env.ASTRAL_ARENA_SLABS);
export function arenaSlabGroups(server, groups = []) {
  const objects = arenaObjects(server);
  if (!objects) return [];
  return groups.filter((group) => group?.kind === "picture" && group.keys?.length && group.keys.every((key) => ARENA_SLAB_MODELS.includes(objects.models[objects.byKey.get(key)?.model]?.name)));
}

/*
 * Плита «картинка → объём» перед экраном (arena10, 21.11.2026; включатель `ASTRAL_ARENA_SCREEN_PLATES=1`, по умолчанию выключено).
 * Группа «картинка», все вещи которой — экраны (`@modovik/climb-contract/recolor/arena-screens`, один список имён). Экран остаётся серверным,
 * плита встаёт отдельной дописанной сущностью зала без перенаправления (`recolor-arena-screens.js`).
 */
export function arenaScreenPlateGroups(server, groups = []) {
  return groups.filter((group) => isArenaScreenPlateGroup(server, group));
}

/* Группы безопасной сборки в одном порядке для сборщика и проверки (имена копий идут по этому порядку): сначала плиты Б2, потом плиты перед экранами. */
export function arenaSafeItemGroups(server, items = [], { slabs = false, plates = false } = {}) {
  const slab = slabs ? arenaSlabGroups(server, items) : [];
  const plate = plates ? arenaScreenPlateGroups(server, items) : [];
  return [...slab, ...plate];
}

/* Комнаты помещения в его осях, кроме внешней «limbo» (у типа Majestic рамка самого MLO-архетипа пустая, рамки только у комнат): `[{ min, max }]`.
   Так же комнату выбирает хост `compile-mlo-models` (`rage_res::mlo::nearest_box`: рамка комнаты ближе всех к точке сущности, при равенстве — с меньшим номером). */
export function interiorRoomBoxes(bytes) {
  const resource = openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const rootBlockIndex = view.getInt32(rootAt + 0x1c, true);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ nameHash: view.getUint32(at, true), dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? { at: block.dataAt + Number((pointer >> 12n) & 0xfffffn), structure: block.nameHash } : null;
  };
  const root = blocks[rootBlockIndex - 1];
  const count = view.getUint16(root.dataAt + 24 + 8, true);
  const list = count ? resolve(view.getBigUint64(root.dataAt + 24, true)) : null;
  for (let index = 0; index < count && list; index += 1) {
    const item = resolve(view.getBigUint64(list.at + index * 8, true));
    if (item?.structure !== MLO_ARCHETYPE) continue;
    const roomCount = view.getUint16(item.at + 168 + 8, true);
    const rooms = roomCount ? resolve(view.getBigUint64(item.at + 168, true)) : null;
    if (!rooms) return [];
    const boxes = [];
    for (let room = 0; room < roomCount; room += 1) {
      const at = rooms.at + room * 112;
      const floats = (offset) => [0, 1, 2].map((axis) => view.getFloat32(at + offset + axis * 4, true));
      boxes.push({ min: floats(32), max: floats(48) });
    }
    return boxes.length > 1 ? boxes.slice(1) : boxes;
  }
  return [];
}

export async function buildArenaItems({ server, settings, files, resources, sources, compile, stateDir, hall, inventory, patches, game, guarded = false, unexpressed = null, slabsOnly = false, slabs = true, plates = false, report = null }) {
  const groups = slabsOnly ? arenaSafeItemGroups(server, settings.items || [], { slabs, plates }) : settings.items || [];
  const plateGroups = new Set(plates ? arenaScreenPlateGroups(server, groups) : []);
  if (!groups.length) return;
  if (typeof compile !== "function") throw new Error("Сборщик своих моделей не подключён — обновите Astral.");
  const objects = arenaObjects(server);
  if (!objects) return;

  /* Помещения зала сервера: номер → { file, mlo, read }; у GTA 5 RP — одно, у Majestic — три зала. */
  const rooms = new Map();
  if (server === "majestic") {
    for (const item of inventory.mlos || []) rooms.set(item.interior, { file: item.ytyp, mlo: item.mlo, read: async () => resources.get(`${server}/${item.ytyp}`) || null });
  } else {
    const room = typeof hall === "function" ? hall() : null;
    if (!room) throw new Error("Помещение зала арены не нашлось в игре — подключите GTA V и нажмите «Применить» ещё раз.");
    rooms.set(0, room);
  }

  const own = (name) => files.findIndex((file) => file.name.toLowerCase() === String(name).toLowerCase());
  let skippedItems = null;
  let skippedPlates = null;
  const plateReport = [];
  /* Типы помещения до копий: сущности (место и поворот экрана) и объём зала — для плиты перед экраном. */
  const roomStates = new Map();
  const roomState = async (interior) => {
    if (!roomStates.has(interior)) {
      const room = rooms.get(interior);
      const at = own(room.file);
      const base = at >= 0 ? files[at].bytes : await room.read();
      if (!base?.length) throw new Error(`Файл помещения ${room.file} не прочитался — подключите GTA V и нажмите «Применить» ещё раз.`);
      const entities = readMloEntities(base).get(room.mlo >>> 0) || [...readMloEntities(base).values()][0] || [];
      roomStates.set(interior, { entities, rooms: interiorRoomBoxes(base) });
    }
    return roomStates.get(interior);
  };
  const staging = path.join(stateDir || ".", "recolor", "arenas", "items", randomUUID());
  /* Что едет в зал: номер → [{ name (копия), group, keys, model }]. */
  const byRoom = new Map();
  try {
    /* Копии: облик на всю модель — копия на группу; облик по частям — копия на набор частей (несколько частей вещи — одна копия). */
    const copies = arenaItemCopies(groups);
    if (copies.length > ARENA_ITEM_GROUP_LIMIT) throw new Error(`Разных обликов у вещей зала — ${copies.length}, больше ${ARENA_ITEM_GROUP_LIMIT}: верните часть вещей или частей к игре.`);
    for (const [copyIndex, copy] of copies.entries()) {
      const group = groups[copy.group ?? copy.parts[0]];
      const first = objects.byKey.get(copy.keys[0]);
      const modelName = first ? arenaItemModelKey(server, first.key, objects.models[first.model].name) : null;
      const frame = modelName ? arenaItemFrame(server, modelName) : null;
      if (!frame) throw new Error(`У модели «${modelName || copy.keys[0]}» нет рамки в описи Astral — обновите Astral.`);
      /* Что ждём в записи: у Majestic имя модели — имя архетипа, у GTA 5 RP опись помнит хеш архетипа (имя там — слепок сцены). */
      const expect = server === "majestic" ? joaatName(modelName) : arenaItemArchetype(server, modelName);
      if (expect === undefined) throw new Error(`У модели «${modelName}» нет архетипа в описи Astral — обновите Astral.`);
      const label = group.model?.label || group.model?.name || group.part?.label || modelName;
      /* «Цвет» штатной или серверной модели: листы модели перекрашиваются (место модели — в описи); нет её у игрока — одноцветная сетка предмета. */
      const paint = !copy.parts.length && group.kind === "colour" && group.colour ? arenaItemSource(server, modelName) : null;
      /* Majestic: «цвет» вещи без файла её модели в наборе собирался копией из сетки окна (одна картинка-лист вместо материалов, без коллизии: стекло
         непрозрачно или прозрачно не там, сквозь вещь проходят — замечания владельца 20.11.2026, кресла и будка). Лучше оставить вещь как есть и сказать словами. */
      if (guarded && !copy.parts.length && group.kind === "colour" && group.colour && !paint) {
        (skippedItems ||= []).push({ keys: copy.keys, model: modelName });
        continue;
      }
      const readOriginal = async (at) => (at.startsWith("resource:") ? resources.get(`${server}/${at.slice("resource:".length)}`) || null : game ? game.read(at).catch(() => null) : null);
      /* Копия строится из файла прежней модели без её частей (коврики у перил — отдельный предмет, `arena-item-parts.js`): сущность смотрит на копию, и частей на ней нет — как в кадре. */
      const readAt = async (at) => {
        const bytes = await readOriginal(at);
        const part = bytes ? arenaItemParts(server).find((item) => item.file === String(at).split("/").pop().toLowerCase()) : null;
        return part ? hideGrimeDecals(bytes, part.sheets).bytes || bytes : bytes;
      };
      const keysByRoom = new Map();
      for (const key of copy.keys) {
        const interior = arenaObjectInterior(key);
        keysByRoom.set(interior, [...(keysByRoom.get(interior) || []), key]);
      }
      for (const [interior, keys] of [...keysByRoom].sort((a, b) => a[0] - b[0])) {
        if (!rooms.has(interior)) throw new Error(`Типов помещения зала (интерьер ${interior}) нет в наборе Astral — обновите Astral.`);
        const name = arenaItemCopyName(server, copyIndex, interior);
        let bounds = frame;
        let plate = null;
        if (copy.parts.length) {
          const built = await buildPartCopy({ name, parts: copy.parts.map((index) => groups[index]), modelName, frame, source: arenaItemSource(server, modelName), readAt, sources, compile, work: path.join(staging, name) });
          files.push(...built.files);
          bounds = built.bounds;
          patches.push({ file: `${name}.ydr`, itemParts: built.parts, cut: built.removed, shared: built.shared });
        } else if (group.kind === "elements") {
          /* Картинка на элементах: копия прежней модели с её сеткой, шейдерами и коллизией, листы элементов — своей картинкой по развёртке. */
          const source = arenaItemSource(server, modelName);
          if (!source) throw new Error(`У модели «${modelName}» нет файла в описи Astral — картинку на её элемент не положить. Поставьте «Свою картинку» на весь предмет.`);
          /* Верх картинки — по первой вещи группы, как в кадре (`item-element-objects.js`): копия одна на всю группу. */
          const place = arenaItemPlace(server, group.keys[0]);
          const built = await buildPaintedCopy({ name, colour: null, source, readAt, work: path.join(staging, name), compile, elements: group.elements, pictures: sources?.pictures, place });
          if (!built) throw new Error(`Файл модели «${modelName}» не прочитался — подключите GTA V и нажмите «Применить» ещё раз.`);
          files.push(...built.files);
          patches.push({ file: `${name}.ydr`, itemElements: group.elements.map((element) => element.texture), shared: built.shared });
        } else {
          const painted = paint ? await buildPaintedCopy({ name, colour: group.colour, source: paint, readAt, work: path.join(staging, name), compile }) : null;
          if (painted) {
            files.push(...painted.files);
            patches.push({ file: `${name}.ydr`, itemPaint: group.colour, shared: painted.shared });
          } else if (plateGroups.has(group)) {
            /* Плита перед экраном: экран остаётся серверным, плита — отдельная дописанная сущность зала, сетка уже в осях помещения (`recolor-arena-screens.js`). */
            const room = await roomState(interior);
            const entity = room.entities[keys[0] % ARENA_OBJECT_KEY_SPAN];
            if (!entity) throw new Error(`В помещении ${rooms.get(interior).file} нет сущности ${keys[0] % ARENA_OBJECT_KEY_SPAN}: файл игры другой версии.`);
            if (entity.archetype !== expect >>> 0) throw new Error(`Сущность ${keys[0] % ARENA_OBJECT_KEY_SPAN} помещения ${rooms.get(interior).file} — не «${modelName}»: файл игры другой версии.`);
            const hasOffset = Array.isArray(group.offset) && group.offset.some((value) => Math.abs(value) > 1e-6);
            let laid = null;
            const built = await compileFittedModel({
              name,
              model: group.model,
              bounds: frame,
              entry: group,
              sources,
              compile,
              work: path.join(staging, name),
              label,
              side: ITEM_SHEET_SIDE,
              adjust: (fitted) => {
                laid = layScreenPlate({ fitted, frame, entity, rooms: room.rooms, hasOffset });
                return laid ? laid.mesh : null;
              },
            });
            if (!built) {
              (skippedPlates ||= []).push({ keys, model: modelName });
              continue;
            }
            files.push({ name: `${name}.ydr`, bytes: built.bytes });
            bounds = built.bounds;
            plate = { keys, model: modelName, source: laid.source, centre: laid.centre.map((value) => Math.round(value * 100) / 100), box: roundedBox(built.bounds) };
            patches.push({ file: `${name}.ydr`, itemPlate: plate.source, plateBox: plate.box });
          } else {
            const built = await compileFittedModel({ name, model: group.model, bounds: frame, entry: group, sources, compile, work: path.join(staging, name), label, side: ITEM_SHEET_SIDE });
            /* Коллизия прежней вещи — если файл прежней модели есть и в нём она зашита (опись мест — та же, что у «Цвета»). */
            const kept = await keepOriginalCollision({ name, built: built.bytes, source: arenaItemSource(server, modelName), readAt, work: path.join(staging, `${name}-collision`), compile });
            files.push({ name: `${name}.ydr`, bytes: kept ? kept.bytes : built.bytes });
            bounds = built.bounds;
            patches.push({ file: `${name}.ydr`, itemCollision: kept ? "прежняя" : "нет", ...(paint ? { itemPaintFallback: "нет файла модели у игрока" } : {}) });
          }
        }
        const list = byRoom.get(interior) || [];
        list.push({ name, keys, expect, bounds, plate });
        byRoom.set(interior, list);
      }
    }

    for (const [interior, copies] of [...byRoom].sort((a, b) => a[0] - b[0])) {
      const room = rooms.get(interior);
      const at = own(room.file);
      const base = at >= 0 ? files[at].bytes : await room.read();
      if (!base?.length) throw new Error(`Файл помещения ${room.file} не прочитался — подключите GTA V и нажмите «Применить» ещё раз.`);
      const before = [...(readMloEntities(base).get(room.mlo >>> 0) || [...readMloEntities(base).values()][0] || [])];
      /* Архетипы копий — в типы помещения; сборщик заводит и сущность на каждую — её место в комнате, где стоит первая вещь группы. */
      const work = path.join(staging, "mlo", String(interior));
      const basePath = path.join(work, "base", room.file);
      await fs.mkdir(path.dirname(basePath), { recursive: true });
      await fs.writeFile(basePath, base);
      const request = path.join(work, "request.json");
      const models = copies.map((copy) => {
        const entity = before[copy.keys[0] % ARENA_OBJECT_KEY_SPAN];
        if (!entity) throw new Error(`В помещении ${room.file} нет сущности ${copy.keys[0] % ARENA_OBJECT_KEY_SPAN}: файл игры другой версии.`);
        const round4 = (value) => Math.round(value * 1e4) / 1e4 + 0;
        return { name: copy.name, lodDist: ITEM_LOD, bbMin: copy.bounds.min.map(round4), bbMax: copy.bounds.max.map(round4), flags: 0, position: entity.position, entityFlags: 32 };
      });
      await fs.writeFile(request, JSON.stringify({ format: "astral.compile-mlo-models", version: 1, base: basePath, ...(room.mlo ? { mlo: room.mlo } : {}), models }));
      const output = path.join(work, "out", room.file);
      await compile("compile-mlo-models", { input: request, output });
      const compiled = await fs.readFile(output).catch(() => null);
      if (!compiled?.length) throw new Error(`Копии вещей не встали в помещение ${room.file}.`);

      /* Сущности вещей — на копии; свои сущности копий — прочь с глаз (дальность 1 см). */
      const after = readMloEntities(compiled).get(room.mlo >>> 0) || [...readMloEntities(compiled).values()][0] || [];
      const edits = [];
      for (const copy of copies) {
        const hash = joaatName(copy.name);
        const added = after.findIndex((entity, index) => index >= before.length && entity.archetype === hash);
        if (added < 0) throw new Error(`Сущность копии «${copy.name}» не нашлась в помещении ${room.file}.`);
        /* Плита перед экраном: сущность копии остаётся видимой (дальность `ITEM_LOD`), сущность экрана не перенаправляется — стена на месте. */
        if (copy.plate) {
          plateReport.push({ ...copy.plate, copy: copy.name, entity: added, interior });
          continue;
        }
        edits.push({ index: added, lodDist: HIDDEN_LOD, expect: hash });
        for (const key of copy.keys) edits.push({ index: key % ARENA_OBJECT_KEY_SPAN, archetype: hash, expect: copy.expect });
      }
      const bytes = edits.length ? patchInteriorEntities(compiled, edits) : compiled;
      if (at >= 0) files[at] = { name: room.file, bytes };
      else files.push({ name: room.file, bytes });
      patches.push({ file: room.file, items: copies.reduce((sum, copy) => sum + copy.keys.length, 0), copies: copies.map((copy) => copy.name), plates: copies.filter((copy) => copy.plate).length, interiors: [interior] });
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  if (report && (plateReport.length || skippedPlates?.length))
    report.safeModels = { ...(report.safeModels || {}), ...(plateReport.length ? { screenPlates: plateReport } : {}), ...(skippedPlates?.length ? { screenPlatesSkipped: skippedPlates } : {}) };
  if (skippedPlates?.length && unexpressed) unexpressed.screenPlates = skippedPlates.length;
  if (skippedItems?.length && unexpressed) {
    unexpressed.items = skippedItems.length;
    patches.push({ file: "items-no-source", skipped: skippedItems.map((item) => item.model) });
  }
}

/* Серый лист 4 × 4: своя модель из файла без своего листа. */
const REPLACE_GREY = Object.freeze({ rgba: new Uint8ClampedArray(64).fill(184).map((value, index) => (index % 4 === 3 ? 255 : value)), width: 4, height: 4 });

/* ------------------------------------------------------------------ *
 * Надпись на домике (Majestic, ТЗ 12.10.2026)
 * ------------------------------------------------------------------ */

/*
 * Своя надпись домика — в его же модели (файл под именем модели сервера,
 * как у замен). У стенда буквы сервера (`spec.texture`, плашка на букву)
 * сводятся в точку; у домика Cube World буквы — чужая модель, их закрывает
 * брусок. Грани надписи (`arenaSignFaces` → `arenaSignMesh`, картинка —
 * `arenaSignPicture`) собираются одной статичной моделью общего сборщика
 * своих моделей (`compilePlaceModel`: лист DXT5, шейдер со свечением и
 * прозрачностью по картинке) и вшиваются в модель домика
 * (`graft-drawable`). Сборщик ставит сетку на ось кости шаблона (`pivot`) —
 * вшивается она со сдвигом назад, и грани встают ровно на место.
 * «Убрать» — только сведённые буквы. `base` — модель домика (правленая
 * набором или из поставки).
 */
const SIGN_MODEL_NAME = "astral_arenas_sign";
const SIGN_ASSET = `hangar-emblem:${"0".repeat(64)}`;

export async function buildArenaSign({ sign, spec, base, picture, compile, stateDir, name }) {
  const cleaned = spec.texture ? hideGrimeDecals(base, [spec.texture]) : { bytes: Buffer.from(base), removed: 0 };
  if (!cleaned.bytes) throw new Error("Буквы надписи домика не нашлись в его модели — обновите Astral.");
  if (sign.mode === "hidden") return { bytes: cleaned.bytes, letters: cleaned.removed };
  if (typeof compile !== "function") throw new Error("Сборщик своих моделей не подключён — обновите Astral.");
  if (!picture) throw new Error("Надпись на домике не пришла — нажмите «Применить» ещё раз.");
  const faces = arenaSignFaces(spec, sign);
  const pixels = arenaSignPicture(picture, faces[0], spec.kind === "board" ? sign.background : null);
  /* Запись своей модели — только ради листа и шейдера: сетка уже в осях домика. */
  const item = normalizePlaceModel({ asset: SIGN_ASSET, shape: "plate", width: pixels.width, height: pixels.height, opacity: 100, glow: sign.glow, motion: "none", distance: 120 });
  const work = path.join(stateDir || ".", "recolor", "arenas", "sign", randomUUID());
  try {
    const built = await compilePlaceModel(item, {
      name: SIGN_MODEL_NAME,
      picture: pixels,
      mesh: arenaSignMesh(faces),
      motion: false,
      animation: false,
      sheetSide: 1024,
      compile,
      workDir: path.join(work, "plates"),
    });
    const target = path.join(work, "base", name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, cleaned.bytes);
    const request = path.join(work, "graft.json");
    const output = path.join(work, "out", name);
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.graft-drawable",
        version: 1,
        target,
        donor: built.files[0].path,
        diffuse: [`${SIGN_MODEL_NAME}_star`],
        offset: built.pivot.map((value) => Math.round(-(value || 0) * 10000) / 10000 + 0),
      }),
    );
    await compile("graft-drawable", { input: request, output });
    const bytes = await fs.readFile(output).catch(() => null);
    if (!bytes?.length) throw new Error("Надпись не встала в модель домика.");
    return { bytes, letters: cleaned.removed };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}


/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/*
 * Правки по файлам: `{ имя файла → { at, server, ops: Map(лист → правка) } }`.
 * HD-копия листа получает ту же правку под своим именем файла.
 */
/*
 * Полотна со своей картинкой у Majestic: какие выражаются пикселями листа, что уже есть в модели или словаре (остров листа, `arenaPanelSheetOp`),
 * а какие нет (у места нет листа с островами: плакаты команд — один атлас без карты островов). Полотна на одном острове делят его (`shared`).
 * `{ onSheets: [ключи], unexpressed: [ключи], shared: [[ключи]] }`.
 */
export function splitPanelsBySheet(server, project, settings, inventory) {
  const onSheets = [];
  const unexpressed = [];
  const targets = new Map();
  for (const plate of arenaPanelPlates(project, server)) {
    const own = Boolean(settings?.[plate.section]?.elements?.[plate.key]);
    const panel = plate.panel;
    const record = own && panel?.texture && panel.island >= 0 ? (inventory.textures || []).find((item) => item.group === plate.section && item.name === panel.texture && item.islands?.[panel.island]) : null;
    if (!record) {
      unexpressed.push(plate.key);
      continue;
    }
    onSheets.push(plate.key);
    const key = `${record.file}/${record.name}#${panel.island}`;
    targets.set(key, [...(targets.get(key) || []), plate.key]);
  }
  return { onSheets, unexpressed, shared: [...targets.values()].filter((keys) => keys.length > 1) };
}

/*
 * Полотна со своей картинкой у Majestic: ПЛАШКОЙ-СУЩНОСТЬЮ помещения зала (новая модель с новым именем и запись в типах `mazearena_int_<n>.ytyp`,
 * как у предметов зала: клиент Majestic такое принимает, заход arena3 20.11.2026) или пикселями листа (запасной путь, `splitPanelsBySheet`).
 * В сущность идёт полотно, все грани которого лежат в главном зале (`PLACE_MODEL_HALLS`, `placeModelInHall`) и у зала есть типы помещения
 * в наборе (`inventory.mlos`); остальные — листом, а чего листом не выразить, называется словами. Выключатель `PANELS_AS_ENTITIES`.
 */
/* По умолчанию выключено (заход arena6 20.11.2026: картинки на сущностях владелец не увидел, а на листах в arena5 видел; вместе с ними была зависшая игра на дальней камере — причина не разделена): `ASTRAL_ARENA_PANELS=entities`. */
const panelsAsEntities = () => process.env.ASTRAL_ARENA_PANELS === "entities";

/* Помещение главного зала Majestic для плашек-сущностей: файл типов, MLO и экземпляр (положение зала в мире); `null`, если его нет в наборе. */
export function majesticPanelRoom(server, inventory, start) {
  const rules = PLACE_MODEL_HALLS[`${server}-inside`];
  const interior = Number(/_int([0-9]+)_shell/.exec(rules?.file || "")?.[1]);
  const room = (inventory?.mlos || []).find((item) => item.interior === interior);
  if (!rules || !room) return null;
  return { rules, room, instance: { position: rules.position.map((value, axis) => value + (start?.[axis] || 0)), rotation: rules.rotation } };
}

export function classifyHallPanels(server, project, settings, inventory) {
  const rules = PLACE_MODEL_HALLS[`${server}-inside`];
  const hasRoom = Boolean(majesticPanelRoom(server, inventory, [0, 0, 0]));
  const entities = [];
  const rest = [];
  for (const plate of arenaPanelPlates(project, server)) {
    const inside = panelsAsEntities() && hasRoom && !plate.over && plate.faces.every((face) => placeModelInHall(rules, { shape: "plate", position: face.point, rotation: arenaPanelRotation(face), size: Math.max(face.width, face.height), width: face.width, height: face.height }));
    (inside ? entities : rest).push(plate.key);
  }
  const sheets = splitPanelsBySheet(server, project, settings, inventory);
  const onSheets = sheets.onSheets.filter((key) => rest.includes(key));
  const keys = new Set(onSheets);
  return {
    entities,
    onSheets,
    unexpressed: sheets.unexpressed.filter((key) => rest.includes(key)),
    shared: sheets.shared.map((group) => group.filter((key) => keys.has(key))).filter((group) => group.length > 1),
  };
}

/*
 * У Majestic лист штукатурки стен (`wall_plaster_white_output`) лежит и на перегородках, потолке, стойках и боксах (в описи он числится и у групп
 * поверхностей, и у «деталей»): красить его цветом стен значит красить и их (заход arena5: перегородка «Sector Racing» стала чёрной и «пропала»).
 * Такие листы остаются штатными; `file/имя` листов, у которых поверхность делит лист с деталями.
 */
export function sheetsSharedWithDetails(inventory) {
  const details = new Set((inventory.textures || []).filter((record) => record.group === "details").map((record) => `${record.file}/${record.name}`));
  return new Set((inventory.textures || []).filter((record) => ARENA_SURFACES.includes(record.group) && details.has(`${record.file}/${record.name}`)).map((record) => `${record.file}/${record.name}`));
}

/*
 * Листы, которые у Majestic делят несколько поверхностей зала (штукатурка стен лежит и на потолке, мрамор пола — на стенах): раздельный
 * облик им нужен лист-копией под каждую поверхность, а это новые листы в модели — клиент её не примет. Здесь — имена листов, где у
 * поверхностей разный облик и победит один (самый сильный, при равенстве — первый по описи).
 */
export function sharedSurfaceSheets(server, settings, inventory) {
  const byName = new Map();
  for (const record of inventory.textures || []) {
    if (!ARENA_SURFACES.includes(record.group) || arenaOverlaySheet(record)) continue;
    const op = arenaTextureOp(server, settings, record);
    if (!op) continue;
    const key = `${record.file}/${record.name}`;
    const known = byName.get(key) || new Map();
    known.set(record.group, JSON.stringify(op));
    byName.set(key, known);
  }
  return [...byName].filter(([, groups]) => new Set(groups.values()).size > 1).map(([key]) => key);
}

function opsByFile(server, settings, inventory, options = {}) {
  const byFile = new Map();
  /* Листы поверхностей, что делят с «деталями» зала (перегородки, стойки): цвет стен на них не ложится (`sheetsSharedWithDetails`). */
  const skip = options.skipSheets || null;
  /* Фасад арены (листы `sp1_10_*`): у Majestic не красится (21.11: вблизи покрасить нечем, вдали одного цвета без ближнего — видимый дефект). */
  const skipFacade = Boolean(options.skipFacade);
  const add = (file, at, name, op) => {
    const entry = byFile.get(file) || { at, ops: new Map() };
    const known = entry.ops.get(name);
    if (opRank(op) > opRank(known)) entry.ops.set(name, op);
    byFile.set(file, entry);
  };
  for (const record of inventory.textures || []) {
    if (skip && ARENA_SURFACES.includes(record.group) && skip.has(`${record.file}/${record.name}`)) continue;
    if (skipFacade && record.group === "facade") continue;
    const op = arenaTextureOp(server, settings, record, options);
    if (!op) continue;
    add(record.file, record.at || null, record.name, op);
    if (record.hd?.file) add(record.hd.file, record.hd.at || null, record.name, op);
  }
  return byFile;
}

/**
 * Файлы арены под работу. `resources` — файлы набора (`<сервер>/<имя>` →
 * байты), `game` — чтение игры игрока (штатные файлы GTA5RP, интерьер,
 * дальний фасад), `pictures` — свои картинки `{ emblems (Map по asset), screens, signs,
 * logos, posters, star }` (RGBA), `images` — картинки отделки.
 * `{ files, patches, report, lodReport? }`.
 */
/*
 * Правка поверх поставленного мода арены (16.10): мод каталога кладёт свои
 * `v_62_*`, `sp1_10_stadium.ytd`… в update.rpf, а пакет мест с работой
 * грузится после него — собранная из штатного файла работа закрывала бы
 * мод. Поэтому основой файла с тем же именем, что у поставленного мода
 * (`over`: имя строчными → `{ at, owner }`), служит копия мода в игре, как у
 * растительности (`astralSetFiles`). Снимут правку — останется мод, снимут
 * мод — работу пересоберут из игры.
 */
async function overInstalledMods(game, resources, server, over) {
  if (!over?.size || !game) return { game, resources, used: new Map() };
  const used = new Map();
  const fromMod = async (name) => {
    const own = over.get(name);
    if (!own) return null;
    const bytes = await game.read(own.at).catch(() => null);
    if (bytes) used.set(name, own.owner || "");
    return bytes;
  };
  const read = async (at) => (await fromMod(String(at).split("/").pop().toLowerCase())) || game.read(at);
  const own = new Map(resources);
  for (const key of resources.keys()) {
    if (!key.startsWith(`${server}/`)) continue;
    const bytes = await fromMod(key.split("/").pop().toLowerCase());
    if (bytes) own.set(key, new Uint8Array(bytes));
  }
  return { game: { ...game, read }, resources: own, used };
}

export async function buildArenaFiles(input, stock, { game: stockGame = null, pictures = {}, images = new Map(), compile = null, stateDir = "", lod = null, hall = null, replacements = null, over = null } = {}) {
  const project = normalizeArenasProject(input);
  if (arenasProjectIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  const server = project.server;
  const { game, resources, used } = await overInstalledMods(stockGame, stock, server, over);
  const settings = project[server];
  const inventory = arenaServerInventory(server);
  if (!inventory) throw new Error(`Арены сервера ${server} нет в этой версии Astral.`);
  const stockBase = inventory.base === "stock";
  if (stockBase && !game) throw new Error("Арена GTA 5 RP собирается из файлов вашей игры — подключите GTA V.");
  const sources = new Map();
  const sourceOf = (item) => {
    const key = JSON.stringify([item.mode, item.pattern, item.image]);
    if (!sources.has(key)) sources.set(key, finishSource(item, images));
    return sources.get(key);
  };

  const files = [];
  const patches = [];
  const report = { server, base: inventory.base, changed: 0, skippedTextures: 0, missing: [] };
  /* Сервер, чьи модели клиент сверяет со своими (Majestic): пересобранные модели с именами сервера не пишутся (`arena-shell-guard.js`),
     внешность — перекраской листов, что уже есть в модели; что так не выразить — в `unexpressed`, человеку словами. */
  const guarded = guardActive(server);
  const unexpressed = {};

  /* Общие листы поверхностей с разным обликом — своими копиями у каждой
     поверхности (задача 11 ТЗ 17.10.2026): у зала Majestic штукатурка стен
     лежит и на потолке, и на стойках, и узор стен ложился на них. Без
     сборщика моделей (проверки без нативного хоста) — как прежде, на месте. */
  /* Majestic: свои картинки полотен — плашкой-сущностью зала, а где нельзя — пикселями листа (запасной путь); остальное словами. */
  const panelPlan = guarded && PLACE_MODEL_HALLS[`${server}-inside`] ? classifyHallPanels(server, project, settings, inventory) : null;
  /* Общие листы (штукатурка стен лежит ещё на перегородке, потолке и стойках) красятся целиком, как в заходе arena5, который владелец назвал «в целом нормально»; «частично штатные, частично чёрные» (arena7) он отверг. */
  /* Листы света (светящиеся плафоны, накладки, лампы) красит только раздел «Подсветка»: цвет стен, потолка и пола на них не ложится (у Majestic лампы игры остаются серверными). */
  const lightSheets = guarded ? new Set((inventory.textures || []).filter((record) => record.group === "lights").map((record) => `${record.file}/${record.name}`)) : null;
  const byFile = opsByFile(server, settings, inventory, { panelsOnSheets: guarded, sheetKeys: panelPlan ? new Set(panelPlan.onSheets) : null, skipSheets: lightSheets });
  /* Цвета крупных поверхностей, поднятые до порога яркости, — в отчёт и человеку словами. */
  const lifted = [];
  if (guarded) for (const group of ["walls", "ceiling", "floor"]) {
    const item = settings[group];
    if (item?.mode !== "colour" || item.look?.mode !== "solid") continue;
    const result = liftColour(item.look.colour);
    if (result.lifted) lifted.push({ group, from: item.look.colour, to: result.colour });
  }
  /* Покраска стен комнат GTA 5 RP (3б): лист комнаты — своей правкой поверх общей по арене. */
  if (server === "gta5rp") {
    const rooms = roomWallPlan(settings.shellPaint);
    const painted = applyRoomWalls(byFile, rooms.plan, inventory.files || []);
    if (painted.length || rooms.uncovered.length) report.rooms = { painted, uncovered: rooms.uncovered };
  }
  let surfaceBases = new Map();
  /* Опыт arena6s: раздельные листы поверхностей разрешены (модель получает листы-копии под поверхности, геометрии те же); по умолчанию выключено. */
  const separateSurfaces = guarded && process.env.ASTRAL_ARENA_SEPARATE_SURFACES === "1";
  if (guarded && !separateSurfaces) {
    const conflicts = sharedSurfaceSheets(server, settings, inventory);
    if (conflicts.length) unexpressed.surfaces = conflicts;
  }
  if (!stockBase && (!guarded || separateSurfaces) && typeof compile === "function") {
    const records = inventory.textures || [];
    const separated = await separateSurfaceSheets({
      server,
      byFile,
      resources,
      compile,
      stateDir,
      opOf: (surface, sheet) => arenaTextureOp(server, settings, records.find((record) => record.group === surface && record.name === sheet) || null),
      restOf: (sheet, separated) =>
        records
          .filter((record) => record.name === sheet && !separated.includes(record.group))
          .map((record) => arenaTextureOp(server, settings, record))
          .reduce((best, op) => (opRank(op) > opRank(best) ? op : best), null),
    });
    surfaceBases = separated.bases;
    if (separated.report.sheets.length) report.surfaceSheets = separated.report;
  }

  /* Листы: основа — штатный файл из игры (GTA5RP) или файл сервера. */
  for (const [name, entry] of byFile) {
    let base = null;
    if (stockBase) base = entry.at ? await game.read(entry.at).catch(() => null) : null;
    else base = surfaceBases.get(name) || resources.get(`${server}/${name}`) || (entry.at && game ? await game.read(entry.at).catch(() => null) : null);
    if (!base) {
      /* Двойник «+hi» берётся из игры игрока; без чтения игры (проверки, предпросмотр) его нет — это не пропажа файла набора. */
      if (!game && name.toLowerCase().includes("+hi")) (report.hdWithoutGame ||= []).push(name);
      else report.missing.push(name);
      continue;
    }
    const baked = await bakeFile(base, name, (texture) => entry.ops.get(texture) || null, { images: pictures, sources: sourceOf });
    report.skippedTextures += baked.skipped;
    if (!baked.textures.length) continue;
    report.changed += 1;
    patches.push({ file: name, textures: baked.textures });
    files.push({ name, bytes: baked.bytes });
  }

  /* Своя картинка на стенах, полу и потолке Majestic — своей сеткой в моделях зала, поверх собранных листов. */
  if (guarded) {
    const wanted = FINISH_WALL_SURFACES.filter((surface) => arenaSurfaceProjected(server, surface, settings[surface]));
    if (wanted.length) unexpressed.finishWalls = wanted;
  } else if (!stockBase) await buildArenaFinishWalls({ server, settings, inventory, files, resources, images, compile, stateDir, report, patches });

  /* Затенение под креслами GTA5RP (`ARENA_SEAT_SHADOWS`): у своего пола, без
     кресел и с другой моделью кресла его треугольники сводятся в точку в
     модели пола фойе — пол под креслами такой же, как вокруг. */
  if (stockBase && arenaSeatShadowsHidden(project)) {
    const folder = String(inventory.interior?.ytyp || "").replace(/[^/]+$/, "");
    report.shadows = 0;
    for (const shadow of ARENA_SEAT_SHADOWS[server] || []) {
      const already = files.find((file) => file.name === shadow.file);
      const base = already ? already.bytes : folder ? await game.read(`${folder}${shadow.file}`).catch(() => null) : null;
      if (!base) {
        report.missing.push(shadow.file);
        continue;
      }
      const cleaned = hideGrimeDecals(base, shadow.textures);
      if (!cleaned.bytes) continue;
      report.shadows += cleaned.removed;
      if (already) already.bytes = cleaned.bytes;
      else files.push({ name: shadow.file, bytes: cleaned.bytes });
      patches.push({ file: shadow.file, shadows: [...shadow.textures] });
    }
  }

  /*
   * Части вещей зала, убранные работой (`arena-item-parts.js`: коврики и тень под ними в модели перил `v_62_barrier01.ydr`): сущность одна, поэтому часть уходит
   * из самой модели — её треугольники сводятся в точку, как тень под креслами. Перила, лежащие в той же модели, не задеты: сводятся только листы части. Убрана
   * сама вещь (её сущность) — модель уже не показывается, файл не правится.
   */
  if (stockBase && server === "gta5rp") {
    const folder = String(inventory.interior?.ytyp || "").replace(/[^/]+$/, "");
    const gone = new Set(settings.removed || []);
    report.parts = 0;
    for (const part of arenaRemovedParts(server, settings.removed)) {
      if (gone.has(part.entity)) continue;
      const already = files.find((file) => file.name === part.file);
      const base = already ? already.bytes : folder ? await game.read(`${folder}${part.file}`).catch(() => null) : null;
      if (!base) {
        report.missing.push(part.file);
        continue;
      }
      const cleaned = hideGrimeDecals(base, part.sheets);
      if (!cleaned.bytes) continue;
      report.parts += cleaned.removed;
      if (already) already.bytes = cleaned.bytes;
      else files.push({ name: part.file, bytes: cleaned.bytes });
      patches.push({ file: part.file, parts: [...part.sheets] });
    }
  }

  /* Объёмные места над главным входом GTA5RP (буквы MAZE BANK ARENA, щит
     PANIC, знак Maze Bank), что работа заменяет или убирает: их
     треугольники сводятся в точку в моделях игры — по листу и рамке места
     (середина треугольника в метрах сцены «снаружи»). */
  if (stockBase) {
    const origin = inventory.origins?.outside || [0, 0, 0];
    report.covers = 0;
    for (const { key, erase } of arenaCoverErasures(project)) {
      const already = files.find((file) => file.name === erase.file);
      const base = already ? already.bytes : erase.at ? await game.read(erase.at).catch(() => null) : null;
      if (!base) {
        report.missing.push(erase.file);
        continue;
      }
      const toWorld = placementTransform(erase.placement);
      const within = (centre) => {
        const point = toWorld(centre);
        return point.every((value, axis) => value - origin[axis] >= erase.box.min[axis] && value - origin[axis] <= erase.box.max[axis]);
      };
      const cleaned = hideGrimeDecals(base, erase.textures, { within });
      if (!cleaned.bytes) continue;
      report.covers += cleaned.removed;
      if (already) already.bytes = cleaned.bytes;
      else files.push({ name: erase.file, bytes: cleaned.bytes });
      patches.push({ file: erase.file, cover: key });
    }
  }

  /* Звезда: своя картинка — своей моделью на месте реквизита шоу. */
  let star = null;
  if (server === "gta5rp" && settings.star?.mode === "image" && pictures.star && inventory.star) {
    star = await buildArenaStar({
      settings: settings.star,
      image: pictures.star,
      star: inventory.star,
      rotation: inventory.interior?.rotation,
      name: inventory.star.model,
      compile,
      stateDir,
    });
    files.push(...star.files);
    patches.push({ file: `${inventory.star.model}.ydr`, star: true, animated: star.animated });
  }

  /* Сущности интерьера GTA5RP: кресла, автоматы, наклейки колы, звезда. */
  if (server === "gta5rp" && inventory.interior?.ytyp) {
    const edits = [];
    const hide = (list) => {
      for (const index of list || []) edits.push({ index, lodDist: HIDDEN_LOD });
    };
    const seats = settings.seats;
    const variant = arenaChairVariants().find((item) => item.id === seats?.model);
    if (seats?.mode === "hidden") hide(inventory.interior.chairs.entities);
    else if (variant && variant.archetype !== inventory.interior.chairs.model) {
      /* Низ другой модели — на полу: у стадионного кресла начало в середине
         сиденья, у остальных — у пола. */
      const lift = arenaChairLift(variant.id);
      for (const index of inventory.interior.chairs.entities)
        edits.push({ index, archetype: joaatName(variant.archetype), expect: joaatName(inventory.interior.chairs.model), ...(lift ? { lift } : {}) });
    }
    if (settings.objects?.vending === "hide") hide(inventory.interior.vending?.entities);
    if (settings.objects?.atms === "hide") hide(inventory.interior.atms?.entities);
    if (settings.objects?.parking === "hide") hide(inventory.interior.parking?.entities);
    if (settings.sprites?.cola === "hide") hide(inventory.interior.cola?.entities);
    /* Вещи зала, убранные по одной (ТЗ 43Б): запись сущности этой вещи в интерьере, а не модель у всех её мест. Части вещей (коврики у перил) — не сущности: их
       убирает следующий шаг из самой модели. */
    hide(arenaEntityKeys(server, settings.removed));
    if (settings.star?.mode === "hidden" && inventory.star) hide([inventory.star.entity]);
    /* Своя звезда: сущность — на место звезды (ось фигуры — на её середину),
       архетип — рамка с движением, флаги и словарь клипов. */
    const archetypeEdits = [];
    if (star && inventory.star) {
      const local = inventory.star.local;
      edits.push({ index: inventory.star.entity, position: [local[0] - star.pivot[0], local[1] - star.pivot[1], local[2]] });
      const { min, max } = star.bounds;
      const centre = min.map((value, axis) => (value + max[axis]) / 2);
      archetypeEdits.push({
        name: joaatName(inventory.star.model),
        bbMin: min,
        bbMax: max,
        bsCentre: centre,
        bsRadius: Math.hypot(...max.map((value, axis) => value - centre[axis])),
        flags: star.animated ? ANIMATED_ARCHETYPE_FLAGS : 0,
        clipDictionary: star.animated ? joaatName(ARENA_STAR_CLIPS) : 0,
      });
    }
    if (edits.length || archetypeEdits.length) {
      const bytes = await game.read(inventory.interior.ytyp);
      if (!bytes) throw new Error("Файл интерьера арены не прочитался из игры.");
      files.push({ name: "v_int_62.ytyp", bytes: patchInteriorEntities(bytes, edits, archetypeEdits) });
      patches.push({ file: "v_int_62.ytyp", entities: edits.length, archetypes: archetypeEdits.length });
    }
  }

  /*
   * Вещи Majestic, убранные по одной (ТЗ 27.10.2026): запись сущности в типах помещения зала из набора (`mazearena_int_<n>.ytyp`) —
   * дальность прорисовки 1 см, как у GTA 5 RP. Файлы моделей не трогаются: вещь той же модели в других местах зала на месте. Номер вещи — интерьер ×
   * 100000 + номер сущности; хеш модели сверяется, чужой файл — отказ, а не правка мимо.
   */
  if (server === "majestic" && settings.removed?.length && (!guarded || process.env.ASTRAL_ARENA_YTYP === "1")) {
    const objects = arenaObjects(server);
    const rooms = new Map((inventory.mlos || []).map((item) => [item.interior, item]));
    const byInterior = new Map();
    for (const key of settings.removed) {
      const item = objects?.byKey.get(key);
      if (!item) continue;
      const interior = arenaObjectInterior(key);
      const edits = byInterior.get(interior) || [];
      edits.push({ index: key % ARENA_OBJECT_KEY_SPAN, lodDist: HIDDEN_LOD, expect: joaatName(objects.models[item.model].name) });
      byInterior.set(interior, edits);
    }
    for (const [interior, edits] of [...byInterior].sort((a, b) => a[0] - b[0])) {
      const room = rooms.get(interior);
      const own = room ? files.findIndex((item) => item.name.toLowerCase() === room.ytyp.toLowerCase()) : -1;
      const base = own >= 0 ? files[own].bytes : room ? resources.get(`${server}/${room.ytyp}`) : null;
      if (!base) throw new Error(`Типов помещения зала Majestic (интерьер ${interior}) нет в наборе Astral — обновите Astral.`);
      const bytes = patchInteriorEntities(base, edits);
      if (own >= 0) files[own].bytes = bytes;
      else files.push({ name: room.ytyp, bytes });
      patches.push({ file: room.ytyp, entities: edits.length, interiors: [interior] });
    }
  }

  /* Вещи зала со своей моделью или картинкой (ТЗ 27.10.2026): сущности — на копию модели, типы — уже правленные (убранное, звезда). */
  /* Защитное умолчание Majestic (альфа, 20.11.2026): типы помещения сервера (`mazearena_int_<n>.ytyp`) не правятся — ни предметы зала, ни «убрать». Серверный
     файл мы заменяем копией набора от 09.10, а правка сущностей — единственное, что у нас не доказано заходами (стена по ракурсу, зависание дальней камеры в arena6).
     Включить для проверки: `ASTRAL_ARENA_YTYP=1`. */
  const ytypEdits = !guarded || process.env.ASTRAL_ARENA_YTYP === "1";
  /* Б2: в защитной сборке — только две плиты на местах аирдропов (`ASTRAL_ARENA_SLABS=1`). */
  /* arena10 (21.11.2026): к плитам Б2 — плита «картинка → объём» перед экраном зала (экран остаётся серверным), . */
  const slabGroups = guarded && !ytypEdits && arenaSlabsEnabled() ? arenaSlabGroups(server, settings.items || []) : [];
  const plateGroups = guarded && !ytypEdits && arenaScreenPlatesEnabled() ? arenaScreenPlateGroups(server, settings.items || []) : [];
  if (!ytypEdits && ((settings.items || []).length || (settings.removed || []).length)) unexpressed.itemsAll = (settings.items || []).length + (settings.removed || []).length - slabGroups.length - plateGroups.length;
  if (ytypEdits || slabGroups.length || plateGroups.length) await buildArenaItems({ server, settings, files, resources, sources: replacements, compile, stateDir, hall, inventory, patches, game, guarded, unexpressed, slabsOnly: !ytypEdits, slabs: slabGroups.length > 0, plates: plateGroups.length > 0, report });
  if (slabGroups.length) report.safeModels = { ...(report.safeModels || {}), slabs: slabGroups.flatMap((group) => group.keys) };
  /* Majestic: цвет фасада вдали (запечённый дальний слой) и листы вблизи ложатся, но вблизи клиент рисует собственные файлы сервера (разбор 20.11.2026) — человеку словами, что вблизи фасад остаётся серверным. */
  if (guarded && settings.facade && settings.facade.mode && settings.facade.mode !== "standard") unexpressed.facade = 1;

  /* Полотна по одному со своим видом — плашками-сущностями помещения зала (поверх кресел и звезды), у Majestic — в модели зала. */
  /* Полотна у Majestic вшиваются в модель зала (`PLACE_MODEL_HALLS`): строение модели меняется, клиент её не примет. */
  if (panelPlan) {
    if (panelPlan.unexpressed.length) unexpressed.panels = panelPlan.unexpressed.length;
    if (panelPlan.shared.length) unexpressed.sharedIslands = panelPlan.shared.length;
    if (panelPlan.onSheets.length || panelPlan.entities.length) report.safeModels = { ...(report.safeModels || {}), onSheets: panelPlan.onSheets, sharedIslands: panelPlan.shared, entities: panelPlan.entities };
  }
  {
    const panels = panelPlan && !panelPlan.entities.length ? null : await buildArenaPanelFiles({ project, server, files, pictures, compile, stateDir, hall, resources, ...(panelPlan ? { inventory, entityKeys: new Set(panelPlan.entities) } : {}) });
    if (panels) {
      for (const file of panels.files) {
        const at = files.findIndex((item) => item.name.toLowerCase() === file.name.toLowerCase());
        if (at >= 0) files.splice(at, 1);
        files.push(file);
      }
      patches.push({ file: "panels", panels: panels.report.models });
    }
  }

  /* Модели сервера своими (Majestic): файлом модели под её именем — поверх правки её листов. */
  for (const file of await buildArenaReplacements({ server, settings, files, resources, sources: replacements, compile, stateDir, onlyHidden: guarded, onSkipped: (count) => (unexpressed.replacements = count) })) {
    const at = files.findIndex((item) => item.name.toLowerCase() === file.name.toLowerCase());
    if (at >= 0) files.splice(at, 1);
    files.push({ name: file.name, bytes: file.bytes });
    patches.push({ file: file.name, replaced: file.hidden ? "hidden" : "model" });
  }

  /* Своя надпись на домике (Majestic): в модели домика — поверх правки её листов. */
  for (const { id, sign, spec, replacement } of activeArenaSigns(server, settings.replace)) {
    if (guarded) {
      unexpressed.signs = (unexpressed.signs || 0) + 1;
      continue;
    }
    const name = `${replacement.model}.ydr`;
    const at = files.findIndex((item) => item.name.toLowerCase() === name);
    const base = at >= 0 ? files[at].bytes : resources.get(`${server}/${name}`);
    if (!base) throw new Error(`Модели «${replacement.label}» нет в наборе Astral — обновите Astral.`);
    const built = await buildArenaSign({ sign, spec, base, picture: pictures[`sign:${id}`] || null, compile, stateDir, name });
    if (at >= 0) files.splice(at, 1);
    files.push({ name, bytes: built.bytes });
    patches.push({ file: name, sign: sign.mode, letters: built.letters });
  }

  /* Полотна у арок со своим видом — свои словари и ссылки типов района. */
  let lodRebind = new Map();
  if (stockBase) {
    const cloths = await buildClothFiles({ project, inventory, game, pictures, compile, stateDir });
    files.push(...cloths.files);
    patches.push(...cloths.patches);
    lodRebind = cloths.lodRebind;
  }

  /* Эмблемы на фасаде и своё на месте объёмных букв, щита и знака над
     входом — плашками нативного хоста, одним вызовом (одни типы и карта). */
  const emblemPlates = arenaEmblemPlates(project).map((plate) => {
    const image = pictures.emblems?.get(plate.asset);
    if (!image) throw new Error("Картинка эмблемы не пришла — выберите её ещё раз.");
    return { ...plate, image };
  });
  const coverPlates = arenaCoverPlates(project).map((plate) => {
    const picture = pictures[plate.image];
    if (!picture) throw new Error(`${plate.section === "mazeSign" ? "Надпись Maze Bank Arena" : "Картинка логотипа снаружи"} не пришла — нажмите «Применить» ещё раз.`);
    return { ...plate, image: arenaCoverPicture(plate.look, picture, plate.decal) };
  });
  /* Файлы — по именам плашек (эмблем и мест над входом), типы, карта, манифест. */
  const plates = [...emblemPlates, ...coverPlates];
  /* Перед деталями фасада (арки, пилястры, карнизы) — по граням моделей HD
     места; убранные буквы над входом — уже из правленых моделей пакета. */
  const near = plates.length && game ? await nearPlateTriangles(plates, inventory.facade || [], facadeReader(files, game)) : null;
  const plate = plates.length
    ? await buildEmblemPlates({ plates, compile, stateDir, set: "arenas", names: { types: ARENA_PLATE.types, map: ARENA_PLATE.map }, far: { lod, game }, near })
    : [];
  if (plate.length) {
    files.push(...plate);
    patches.push({ file: "emblem", plate: true, covers: coverPlates.map((item) => item.key) });
  }

  /* Дальний фасад: тон и место объёмных букв, щита и знака над входом. */
  const origin = inventory.origins?.outside || [0, 0, 0];
  const toWorld = (point) => point.map((value, axis) => value + origin[axis]);
  const overlays = [
    ...arenaActiveCovers(project).map((entry) => ({ point: toWorld(entry.cover.point), normal: entry.cover.normal, width: entry.cover.width, height: entry.cover.height, erase: true, reach: 2 })),
    ...coverPlates.map((plate) => ({ point: toWorld(plate.decal.point), normal: plate.decal.normal, width: plate.decal.width, height: plate.decal.height, image: plate.image, reach: 2 })),
  ];
  let lodReport = null;
  const lodBuilt = await buildFacadeLod(server, settings, { game, lod, overlays, files, pictures });
  if (lodBuilt?.files?.length) {
    const names = new Set(lodBuilt.files.map((file) => file.name));
    for (let index = files.length - 1; index >= 0; index -= 1) if (names.has(files[index].name)) files.splice(index, 1);
    files.push(...lodBuilt.files);
    patches.push({ file: "lod", lod: true, files: [...names] });
    lodReport = lodBuilt.report;
  }
  /* Полотна вдали: дальние модели своих полотен — на их словари, общий вид — в дальний лист. */
  if (stockBase && game) await finishClothLod({ files, patches, settings, server, game, pictures, lodRebind });

  /* Арена мода (25.10.2026): правки листов мода — на файлы поставленного мода, под теми же именами (`recolor-arena-mod.js`). */
  if (project.mod) {
    const modSheets = await buildArenaModSheets({ mod: project.mod, over, game: stockGame, built: files, pictures });
    for (const file of modSheets.files) {
      const at = files.findIndex((item) => item.name === file.name);
      if (at >= 0) files[at] = file;
      else files.push(file);
    }
    patches.push(...modSheets.patches);
    if (modSheets.files.length || modSheets.report.missing.length) report.mod = modSheets.report;
  }

  /* Последний рубеж Majestic: модель с именем сервера и не штатным строением — штатной с перекраской листов (`arena-shell-guard.js`). */
  if (guarded) {
    await guardServerModels({ server, files, patches, stock, byFile, images: pictures, sources: sourceOf, report, allowAddedSheets: separateSurfaces });
    if (Object.keys(unexpressed).length) report.safeModels = { ...(report.safeModels || {}), unexpressed };
    if (lifted.length) report.safeModels = { ...(report.safeModels || {}), lifted };
  }
  /* Сторож краша: модель без группы шейдеров в игру не едет. */
  const unsafe = unsafeDrawables(files);
  if (unsafe.length) throw new Error(`Модель без шейдеров не поедет в игру (уронила бы её): ${unsafe.join(", ")}.`);
  /* Какие файлы собраны поверх мода и чьего. */
  if (used.size) report.over = [...used].map(([name, owner]) => ({ name, owner }));
  return { files, patches, report, ...(lodReport ? { lodReport } : {}) };
}
