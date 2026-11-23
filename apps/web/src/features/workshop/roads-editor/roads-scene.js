/*
 * Кусок карты в кадре «Дорог» (задача 13 ТЗ 18.10.2026, поздний вечер): сцена — настоящие модели игры
 * (перекрёсток в Davis, грунтовка за Сэнди-Шорс; `scripts/prepare-roads-scene.mjs`), а правка
 * ложится на их настоящие листы. Какие листы сцены — дороги, решает семейство листа по имени
 * (`roadTextureFamily` контракта — тот же разбор, что у установщика): асфальт, переход, разметка,
 * тротуар и бордюр, грунтовка. Каждый такой лист читается из игры игрока, красится той же
 * функцией, что в установщике (`roadSheetPixels`), и встаёт в кадр на место своего родного: у
 * земли с четырьмя слоями — на место слоя. Всё остальное в кадре (здания, трава, камни,
 * кустарник) показывает свои родные листы, как в игре.
 *
 * Дальний вид (`far`) — те же листы, что видны издалека (`_lod`): их адрес выводится из адреса
 * листа вблизи; не нашёлся у игрока — вдали остаётся лист вблизи.
 */

import { useEffect, useMemo, useState } from "react";
import { normalizeRoadsProject, roadFinishSource, roadSheetPixels, roadTextureFamily } from "@modovik/climb-contract/recolor/roads";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { fillStandInSheets, standInExtraSheets } from "./road-stand-in.js";
import { dataTexture, loadRoadSheet, useRoadFinishImages } from "./roads-sheets.js";

/* Размеры листов: вблизи — как у машины, вдали — дальний план. Обложка плитки полки берёт мельче. */
export const ROAD_SHEET_SIZE = Object.freeze({ near: 512, far: 128 });
/* Листы всего остального в кадре (здания, земля, кустарник) — фон, им хватает вдвое мельче: сотня листов района не давит на память. */
export const SCENERY_SHEET_SIZE = 256;

const sheetKey = (entry) => `${entry.game}|${entry.texture}`;
const GLOBAL_ROADS = /\/globalroads\.ytd$/;
const LOD_ROADS = "x64g.rpf:levels/gta5/generic/gtxd.rpf/globalroadslods.ytd";

/**
 * Дальний лист для листа вблизи: `{ game, texture }` или `null`. Общий словарь дорог держит дальние
 * планы в `globalroadslods`, словарь района `X.ytd` — в `Xlod.ytd` рядом; листы, встроенные в модель
 * (`*.ydr`), дальнего плана рядом не имеют. Склеенное имя DXT5 (цвет + альфа) вдали склеено так же.
 */
export function roadFarEntry(entry) {
  const name = String(entry.texture || "");
  const glued = /^(.+?)\1(?:_a)?$/.exec(name);
  const texture = glued ? `${glued[1]}_lod${glued[1]}_lod_a` : `${name}_lod`;
  if (GLOBAL_ROADS.test(entry.game)) return { game: LOD_ROADS, texture };
  if (/\.ytd$/.test(entry.game)) return { game: entry.game.replace(/\.ytd$/, "lod.ytd"), texture };
  return null;
}

/**
 * Листы-дороги сцены: `[{ key, entry, part, kind }]` — собственный лист материала и слои земли
 * (маски слоёв — не листы краски и сюда не входят). У листа без семейства — не дорога — записи нет.
 */
export function roadSceneSheets(asset) {
  if (!asset) return [];
  const seen = new Map();
  const take = (slot) => {
    const entry = Number.isInteger(slot) ? asset.textures?.[slot] : null;
    if (!entry?.texture || !entry.game) return;
    const key = sheetKey(entry);
    if (seen.has(key)) return;
    const family = roadTextureFamily(entry.texture);
    if (family) seen.set(key, { key, entry: { game: entry.game, texture: entry.texture }, part: family.part, kind: family.kind || null });
  };
  for (const material of asset.materials || []) {
    take(material.texture);
    for (const slot of material.terrain?.layers || []) take(slot);
  }
  return [...seen.values()];
}

/** Ключ листа у номера в таблице сцены: `slot → key` (только дороги). */
function slotKeys(asset, list) {
  const wanted = new Set(list.map((item) => item.key));
  const slots = new Map();
  (asset.textures || []).forEach((entry, slot) => {
    if (entry?.game && entry?.texture && wanted.has(sheetKey(entry))) slots.set(slot, sheetKey(entry));
  });
  return slots;
}

/**
 * Пиксели листов-дорог для вида `view`: `Map key → { rgba, width, height } | null` (`null` — игры нет или лист не
 * нашёлся). Вдали сначала дальний лист, не нашёлся — лист вблизи.
 */
export async function loadRoadSceneSheets(list, view = "near", { size = null } = {}) {
  const near = size || ROAD_SHEET_SIZE.near;
  const far = size ? Math.min(size, ROAD_SHEET_SIZE.far) : ROAD_SHEET_SIZE.far;
  const answers = await Promise.all(
    list.map(async (item) => {
      if (view === "far") {
        const entry = roadFarEntry(item.entry);
        const sheet = entry ? await loadRoadSheet(entry, far) : null;
        if (sheet) return [item.key, { ...sheet, lod: true }];
      }
      return [item.key, await loadRoadSheet(item.entry, near)];
    }),
  );
  return new Map(answers);
}

/**
 * Листы в облике работы: `Map key → THREE.Texture` (освобождает тот, кто взял). Лист части, которую работа не
 * трогает, — как в игре (пиксели игры без правки): кадр не зависит от того, прочитал ли он этот лист родным путём.
 */
export function roadSceneTextures(list, sheets, project, finishImages = new Map()) {
  const normal = normalizeRoadsProject(project);
  const out = new Map();
  for (const item of list) {
    const sheet = sheets?.get(item.key);
    if (!sheet) continue;
    const surface = normal.parts[item.part];
    const image = surface?.mode === "image" && surface.image?.asset ? finishImages.get(surface.image.asset) : null;
    const source = surface ? roadFinishSource(surface, image) : null;
    const rgba = roadSheetPixels(sheet.rgba, sheet.width, sheet.height, item.part, normal, { source, kind: item.kind, lod: Boolean(sheet.lod) }) || sheet.rgba;
    out.set(item.key, dataTexture({ rgba: new Uint8ClampedArray(rgba), width: sheet.width, height: sheet.height }));
  }
  return out;
}

/** Облик материалов сцены: лист-дорога — работы, остальное — родной лист кадра (как в игре). */
export function roadSceneLook(asset, list, textures) {
  const keys = slotKeys(asset, list);
  const pick = (slot) => (Number.isInteger(slot) ? textures.get(keys.get(slot)) : undefined) || undefined;
  return (index, info) => {
    const look = { colour: info.colour, mapSize: SCENERY_SHEET_SIZE };
    const own = pick(info.texture);
    if (own) look.texture = own;
    if (info.terrain) {
      const layers = (info.terrain.layers || []).map(pick);
      if (layers.some(Boolean)) look.layers = layers;
    }
    return look;
  };
}

/** Облик, пока листы едут: родные листы кадра. */
export const nativeRoadLook = (index, info) => ({ colour: info.colour });

/**
 * Облик кадра для сцены `url`: `{ look, asset, missing }`. `missing` — листы-дороги есть, а игра их не отдала
 * (окно без Astral Desktop): тогда кадр рисует материалы средними цветами, и подпись говорит об этом.
 */
export function useRoadScene(url, project, view = "near") {
  const [asset, setAsset] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setAsset(null);
    Promise.resolve(loadSceneAsset(url))
      .then((value) => !cancelled && setAsset(value))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);
  const list = useMemo(() => roadSceneSheets(asset), [asset]);
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    if (!list.length) return undefined;
    loadRoadSceneSheets(list, view).then((sheets) => !cancelled && setLoaded({ list, view, sheets }));
    return () => {
      cancelled = true;
    };
  }, [list, view]);
  const finishImages = useRoadFinishImages(project);
  const sheets = loaded && loaded.list === list && loaded.view === view ? loaded.sheets : null;
  const textures = useMemo(() => (sheets ? roadSceneTextures(list, sheets, project, finishImages) : null), [list, sheets, project, finishImages]);
  useEffect(
    () => () => {
      if (textures) for (const texture of textures.values()) texture.dispose();
    },
    [textures],
  );
  const look = useMemo(() => (asset && textures ? roadSceneLook(asset, list, textures) : nativeRoadLook), [asset, list, textures]);
  const missing = Boolean(sheets) && list.length > 0 && textures.size === 0;
  return { look, asset, missing };
}

/**
 * Облик для обложки полки (без React): листы мельче, вид вблизи. `{ look, cache, release }` — `cache` ложится
 * в хранилище снимков, только если игра отдала все листы-дороги сцены (или `standIn` заменил недостающие).
 */
export async function prepareRoadSceneLook(url, project, { size = 256, standIn = false } = {}) {
  const asset = await loadSceneAsset(url);
  /* Обложка каталога без игры (`standIn`, ТЗ 24.10.2026, п. 5): листов игры нет — свои постановочные листы,
     и парковочный асфальт кадра — тоже (работа его не меняет). */
  const list = standIn ? [...roadSceneSheets(asset), ...standInExtraSheets(asset)] : roadSceneSheets(asset);
  const sheets = await loadRoadSceneSheets(list, "near", { size });
  if (standIn) fillStandInSheets(list, sheets);
  const textures = roadSceneTextures(list, sheets, project, new Map());
  return {
    look: roadSceneLook(asset, list, textures),
    cache: list.length > 0 && [...sheets.values()].every(Boolean),
    release: () => {
      for (const texture of textures.values()) texture.dispose();
    },
  };
}
