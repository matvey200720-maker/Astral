/*
 * Какие слои оптимизации стоят в игре — по записям установки.
 *
 * Запись кладёт очередь применения (`tasks/optimization-layer.js`): мод
 * слоя (`layerModId`) и папка игры. Библиотека показывает по ним строки и
 * снимает слой корзиной; раздел — переключатель во «включено».
 */

import {
  OPTIMIZATION_LAYER_IDS,
  OPTIMIZATION_SET_RECORD_KEY,
  optimizationLayerRecordKey,
} from "@modovik/optimizer/layer-ids.js";
import { TEXTURE_LEVEL_LAYERS } from "@modovik/optimizer/texture-levels.js";

function readRecord(storage, key) {
  try {
    const record = JSON.parse(storage?.getItem(key) || "null");
    return typeof record?.layerModId === "string" && record.layerModId
      ? record
      : null;
  } catch {
    return null;
  }
}

/**
 * Слои оптимизации, что стоят в игре, — id в порядке раздела: набор (запись `OPTIMIZATION_SET_RECORD_KEY`) и прежние
 * записи слоёв. Без ступеней «Ухудшения текстур»: у них свой пакет, а работа «Оптимизация» (в «Моих работах» и в
 * сборке) несёт только слои набора — тот же список, что у `normalizeOptimizationDomain`.
 */
export function installedOptimizationLayerIds(storage = globalThis.localStorage) {
  if (!storage) return [];
  const set = readRecord(storage, OPTIMIZATION_SET_RECORD_KEY);
  const standing = new Set(Array.isArray(set?.layers) ? set.layers.map(String) : []);
  for (const { layerId } of installedOptimizationLayers(storage)) standing.add(layerId);
  return OPTIMIZATION_LAYER_IDS.filter((layerId) => standing.has(layerId) && !TEXTURE_LEVEL_LAYERS.includes(layerId));
}

/** Моды движка, что держат слои оптимизации: набор и прежние пакеты слоёв — id установок для сборки. */
export function optimizationLayerModIds(storage = globalThis.localStorage) {
  if (!storage) return [];
  const ids = new Set();
  const set = readRecord(storage, OPTIMIZATION_SET_RECORD_KEY);
  if (set) ids.add(set.layerModId);
  for (const { record } of installedOptimizationLayers(storage)) ids.add(record.layerModId);
  return [...ids];
}

/** Запись набора слоёв, если он стоит: одна установка на все слои, снимается одним модом. */
export function installedOptimizationSet(storage = globalThis.localStorage) {
  return storage ? readRecord(storage, OPTIMIZATION_SET_RECORD_KEY) : null;
}

/** Записи слоёв прежнего вида (каждый слой своим пакетом): `[{ layerId, key, record }]` в порядке раздела. Слоёв набора здесь нет: что стоит в игре, отвечает `installedOptimizationLayerIds`. */
export function installedOptimizationLayers(storage = globalThis.localStorage) {
  if (!storage) return [];
  return OPTIMIZATION_LAYER_IDS.map((layerId) => {
    const key = optimizationLayerRecordKey(layerId);
    return { layerId, key, record: readRecord(storage, key) };
  }).filter((item) => item.record);
}
