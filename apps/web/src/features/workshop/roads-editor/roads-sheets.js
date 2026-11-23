/*
 * Листы «Дорог» из игры игрока: плитки шаблонов (`RoadsPresets.jsx`), основа студии (`roadPartSheetBitmap`) и
 * общий читатель листов `loadRoadSheet`. Кадр читает листы своей сцены сам — `roads-scene.js`.
 *
 * Лист читает Astral Desktop из архивов игры игрока (`loadSceneImage`; в поставке Astral листов нет),
 * красит его та же функция, что у установщика (`roadSheetPixels` контракта): цвет, эффекты, «Без
 * текстуры», узор, градиент, своя текстура, яркость, линии разметки в асфальте и краска бордюров.
 *
 * У каждой поверхности плитки — пара листов: вблизи (как у машины) и его дальний план (`_lod`, 128 px).
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { normalizeRoadsProject, roadFinishSource, roadSheetPixels } from "@modovik/climb-contract/recolor/roads";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { createByteBudgetCache } from "./byte-budget-cache.js";

const GTXD = "x64g.rpf:levels/gta5/generic/gtxd.rpf";
/* Главный словарь дорог игра берёт из пакета Rockstar patchday2ng. */
const GLOBAL_ROADS = "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/generic/gtxd.rpf/globalroads.ytd";
const LOD_ROADS = `${GTXD}/globalroadslods.ytd`;
/*
 * Листы переходов, цветной краски и парковки лежат не в общих словарях, а в
 * словарях районов: зебра — в `cs3_07_ground` (Блейн), цветные полосы — в
 * `cs1_05_roads`, парковка — в `bt1_04_detail`. Пути — как их отдаёт перепись
 * игры (`texture-census.js`); не нашлись у игрока — этого куска в кадре нет.
 */
const CS3_07 = "x64s.rpf:levels/gta5/_hills/country_03/cs3_07.rpf";
const CS1_05_ROADS = "x64q.rpf:levels/gta5/_hills/country_01/cs1_05.rpf/cs1_05_roads.ytd";
const BT1_04_DETAIL = "x64l.rpf:levels/gta5/_citye/sunset/bt1_04.rpf/bt1_04_detail.ytd";
const AP1_01_A_LOD = "x64l.rpf:levels/gta5/_cityw/airport_01/ap1_01_a.rpf/ap1_01_a_lod.ytd";

/* Поверхности кадра: часть работы и листы вблизи и вдали. */
export const ROAD_STAGE_SHEETS = Object.freeze({
  asphalt: Object.freeze({
    part: "asphalt",
    near: { game: GLOBAL_ROADS, texture: "im_road_006", size: 512 },
    far: { game: LOD_ROADS, texture: "im_road_006_lod", size: 128 },
  }),
  markings: Object.freeze({
    part: "markings",
    near: { game: GLOBAL_ROADS, texture: "im_roadmarkings02im_roadmarkings02_a", size: 512 },
    far: { game: LOD_ROADS, texture: "im_roadmarkings02_lodim_roadmarkings02_lod_a", size: 128 },
  }),
  /* Переход: зебра на листе асфальта (`kind: "crossing"` — разбор ищет полосы). */
  crossing: Object.freeze({
    part: "asphalt",
    kind: "crossing",
    near: { game: `${CS3_07}/cs3_07_ground.ytd`, texture: "im_road_crossing_003", size: 512 },
    far: { game: `${CS3_07}/cs3_07_lod.ytd`, texture: "im_road_crossing_003_lod", size: 128 },
  }),
  /* Стоп-линия, надпись, значки: лист атласа с надписями. */
  stops: Object.freeze({
    part: "markings",
    near: { game: GLOBAL_ROADS, texture: "im_roadmarkings07im_roadmarkings07_a", size: 512 },
    far: { game: AP1_01_A_LOD, texture: "im_roadmarkings07_lodim_roadmarkings07_a", size: 128 },
  }),
  /* Цветная краска: синие, красные и зелёные полосы. Вдали — тот же лист мельче: у него нет дальнего плана с альфой. */
  coloured: Object.freeze({
    part: "markings",
    near: { game: CS1_05_ROADS, texture: "im_ggroadmarkings01im_ggroadmarkings01_a", size: 256 },
    far: { game: CS1_05_ROADS, texture: "im_ggroadmarkings01im_ggroadmarkings01_a", size: 128 },
  }),
  /* Парковка: линии парковочных мест; дальнего плана нет — тот же лист мельче. */
  parking: Object.freeze({
    part: "markings",
    kind: "parking",
    near: { game: BT1_04_DETAIL, texture: "im_carparkmarkings01im_carparkmarkings01_a", size: 512 },
    far: { game: BT1_04_DETAIL, texture: "im_carparkmarkings01im_carparkmarkings01_a", size: 128 },
  }),
  kerb: Object.freeze({
    part: "sidewalk",
    near: { game: GLOBAL_ROADS, texture: "im_kerbs03", size: 512 },
    far: { game: LOD_ROADS, texture: "im_kerbs03_lod", size: 128 },
  }),
  sidewalk: Object.freeze({
    part: "sidewalk",
    near: { game: GLOBAL_ROADS, texture: "im_sidewalk003", size: 512 },
    far: { game: LOD_ROADS, texture: "im_sidewalk003_lod", size: 128 },
  }),
  dirt: Object.freeze({
    part: "dirt",
    near: { game: `${GTXD}/desertnorthgrp.ytd`, texture: "cs_rsl_aa_dirttrack1", size: 512 },
    far: { game: `${GTXD}/desertnorthgrplod.ytd`, texture: "cs_rsl_aa_dirttrack1_lod", size: 128 },
  }),
});
export const ROAD_STAGE_KEYS = Object.freeze(Object.keys(ROAD_STAGE_SHEETS));

function bitmapPixels(image) {
  const width = image.width;
  const height = image.height;
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, width, height).data;
  return { rgba: new Uint8ClampedArray(data.buffer.slice(0)), width, height };
}

/*
 * Пиксели листа (RGBA) — по разу на окно, но не навсегда: кэш ограничен бюджетом в байтах, самый давний уходит
 * первым (как у `scene-textures.js`). Вытеснение безопасно: текстуры строятся копиями пикселей.
 */
const ROAD_SHEET_BUDGET_BYTES = 96 * 1024 * 1024;
const pixels = createByteBudgetCache(ROAD_SHEET_BUDGET_BYTES, (sheet) => sheet.rgba.byteLength);

/** Пиксели листа кадра `{ rgba, width, height }` или `null` (листа нет: браузер без Astral). */
export function loadRoadSheet(entry, size = entry.size) {
  const key = `${entry.game}|${entry.texture}|${size}`;
  return pixels.get(key, () =>
    loadSceneImage({ game: entry.game, texture: entry.texture }, size)
      .then((image) => (image ? bitmapPixels(image) : null))
      .catch(() => null),
  );
}

/**
 * Основа студии у части дорог (задача 6Б ТЗ 18.10.2026): главный лист этой части из
 * игры игрока картинкой (`ImageBitmap`) или `null` — листа нет (браузер без Astral Desktop).
 */
export async function roadPartSheetBitmap(part, size = 512) {
  const key = ROAD_STAGE_SHEETS[part] ? part : ROAD_STAGE_KEYS.find((item) => ROAD_STAGE_SHEETS[item].part === part && !ROAD_STAGE_SHEETS[item].kind);
  const sheet = key ? await loadRoadSheet(ROAD_STAGE_SHEETS[key].near, size) : null;
  return sheet ? createImageBitmap(new ImageData(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height)) : null;
}

/** Листы вида кадра (`near` или `far`): `{ <поверхность>: пиксели | null }`, пока грузятся — `null`. */
export function useRoadSheets(view = "near", size = null) {
  const [sheets, setSheets] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all(ROAD_STAGE_KEYS.map((key) => loadRoadSheet(ROAD_STAGE_SHEETS[key][view], size || ROAD_STAGE_SHEETS[key][view].size))).then((list) => {
      if (!cancelled) setSheets(Object.fromEntries(ROAD_STAGE_KEYS.map((key, index) => [key, list[index]])));
    });
    return () => {
      cancelled = true;
    };
  }, [view, size]);
  return sheets;
}

/* Своя картинка отделки (из хранилища окна) — пикселями, не больше 1024 px; кэш ограничен бюджетом. */
const FINISH_IMAGE_BUDGET_BYTES = 64 * 1024 * 1024;
const images = createByteBudgetCache(FINISH_IMAGE_BUDGET_BYTES, (sheet) => sheet.rgba.byteLength);
function loadFinishImage(asset) {
  return images.get(asset, () =>
    getWorkshopAsset(asset)
      .then((blob) => (blob ? createImageBitmap(blob, { resizeWidth: 1024, resizeQuality: "medium" }).catch(() => createImageBitmap(blob)) : null))
      .then((bitmap) => {
        if (!bitmap) return null;
        const sheet = bitmapPixels(bitmap);
        bitmap.close?.();
        return sheet;
      })
      .catch(() => null),
  );
}

/** Свои картинки работы для кадра: `Map` ключ → пиксели. */
export function useRoadFinishImages(project) {
  const assets = useMemo(
    () =>
      Object.values(normalizeRoadsProject(project).parts)
        .filter((surface) => surface.mode === "image" && surface.image?.asset)
        .map((surface) => surface.image.asset)
        .sort()
        .join("|"),
    [project],
  );
  const [loaded, setLoaded] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const list = assets ? assets.split("|") : [];
    Promise.all(list.map((asset) => loadFinishImage(asset))).then((answers) => {
      if (!cancelled) setLoaded(new Map(list.map((asset, index) => [asset, answers[index]]).filter(([, sheet]) => sheet)));
    });
    return () => {
      cancelled = true;
    };
  }, [assets]);
  return loaded;
}

/**
 * Пиксели поверхности кадра в облике работы (или как в игре): та же
 * функция, что у установщика. `project` — нормализованная работа.
 */
export function roadStagePixels(key, sheet, project, finishImages = new Map()) {
  if (!sheet) return null;
  const { part, kind = null } = ROAD_STAGE_SHEETS[key];
  const surface = project.parts[part];
  const image = surface?.mode === "image" && surface.image?.asset ? finishImages.get(surface.image.asset) : null;
  const source = surface ? roadFinishSource(surface, image) : null;
  return roadSheetPixels(sheet.rgba, sheet.width, sheet.height, part, project, { source, kind }) || sheet.rgba;
}

export function dataTexture({ rgba, width, height }) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  /* Развёртка как у игры: первая строка картинки — верх листа. */
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
