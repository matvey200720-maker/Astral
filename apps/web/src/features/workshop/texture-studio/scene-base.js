/*
 * Основа холста студии из листа игры (ТЗ 18.10.2026, Session 1, задача 6):
 * лист по имени в сцене редактора (`scene.bin`) → его запись (`game`,
 * `texture`) → картинка листа из GTA V игрока (`loadSceneImage`, читает
 * Astral Desktop). Студия кладёт её слоем «Основа» — холст не пустой, на нём
 * то, что сейчас лежит на поверхности. Картинка отдаётся копией: кадр кэша
 * сцены студия не трогает и не закрывает.
 *
 * Без Astral Desktop (браузер) и без листа в игре — `null`: студия начинает с
 * ровного тона поверхности.
 */

import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { surfaceRegion } from "./uv-region.js";

/** Лист записи сцены независимой картинкой или `null`. */
export async function entryBitmap(entry, size = 1024) {
  if (!entry) return null;
  const image = await loadSceneImage(entry, size).catch(() => null);
  return image ? createImageBitmap(image).catch(() => null) : null;
}

/** Лист `texture` сцены `scene` (адрес `scene.bin`) независимой картинкой или `null`. */
export async function sceneSheetBitmap(scene, texture, size = 1024) {
  if (!scene || !texture) return null;
  const asset = await loadSceneAsset(scene).catch(() => null);
  const entry = asset?.textures?.find((item) => item.texture === texture) || null;
  return entryBitmap(entry, size);
}

/* Лист материала: штатный (`vanilla`) или тот, что он несёт сам. */
const sheetSlot = (info) => (Number.isInteger(info.vanilla) ? info.vanilla : Number.isInteger(info.texture) ? info.texture : null);

/*
 * Материалы сцены, что отобрала поверхность (`match(info, index, parts)`), — от
 * самого «тяжёлого» (больше всего граней в сцене) к лёгкому. `parts` — номера
 * частей сцены, где материал стоит (для вкладок вида; `match` их знает).
 */
function rankedMaterials(asset, match) {
  const weight = new Map();
  const parts = new Map();
  for (const mesh of asset.meshes || []) {
    weight.set(mesh.material, (weight.get(mesh.material) || 0) + (mesh.indices?.length || 0));
    if (!parts.has(mesh.material)) parts.set(mesh.material, new Set());
    parts.get(mesh.material).add(mesh.part);
  }
  return asset.materials
    .map((info, index) => ({ info, index }))
    .filter(({ info, index }) => match(info, index, parts.get(index) || new Set()))
    .sort((a, b) => (weight.get(b.index) || 0) - (weight.get(a.index) || 0));
}

/**
 * Основа поверхности из листа игры её материалов (задача 6Б ТЗ 18.10.2026):
 * `match(info, index, parts)` отбирает материалы сцены этой поверхности (как их
 * отбирает облик редактора — по группе, листу, части; `parts` — номера частей
 * сцены, где материал стоит), основа — штатный лист
 * (`info.vanilla`) того, у кого больше всего граней: он и есть лицо поверхности.
 * `null` — подходящего материала или листа игры нет (браузер без Astral Desktop).
 */
export async function materialSheetBitmap(scene, match, size = 1024) {
  if (!scene || typeof match !== "function") return null;
  const asset = await loadSceneAsset(scene).catch(() => null);
  if (!asset?.materials || !asset.textures) return null;
  for (const { info } of rankedMaterials(asset, match)) {
    const slot = sheetSlot(info);
    const bitmap = slot != null ? await entryBitmap(asset.textures[slot], size) : null;
    if (bitmap) return bitmap;
  }
  return null;
}

/**
 * Лист материала `index` сцены (штатный, `vanilla`, или собственный) независимой картинкой или
 * `null` (3Б ТЗ 18.10.2026): у выбранной стены свой материал, и лист у неё — его, а не «лицо»
 * всей части.
 */
export async function materialIndexBitmap(scene, index, size = 1024) {
  if (!scene || !Number.isInteger(index)) return null;
  const asset = await loadSceneAsset(scene).catch(() => null);
  const info = asset?.materials?.[index];
  const slot = info ? sheetSlot(info) : null;
  return slot != null ? entryBitmap(asset.textures?.[slot], size) : null;
}

/**
 * Область листа, что занимает поверхность (задача 3 ТЗ 18.10.2026): рамка развёртки
 * её сеток на листе «лица» поверхности — `[u0, v0, u1, v1]` в долях листа — или
 * `null`, если поверхность занимает почти весь лист (или сцены нет). Студия
 * открывается на этой области, а не на всём листе (`uv-region.js`).
 */
export async function materialSheetRegion(scene, match) {
  if (!scene || typeof match !== "function") return null;
  const asset = await loadSceneAsset(scene).catch(() => null);
  if (!asset?.materials || !asset.meshes) return null;
  const ranked = rankedMaterials(asset, match);
  const face = ranked.find(({ info }) => sheetSlot(info) != null);
  if (!face) return null;
  const sheet = sheetSlot(face.info);
  const indexes = new Set(ranked.filter(({ info }) => sheetSlot(info) === sheet).map(({ index }) => index));
  return surfaceRegion(asset.meshes.filter((mesh) => indexes.has(mesh.material)));
}
