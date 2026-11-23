/*
 * Набор слоёв оптимизации в игру (задача 8, 05.10.2026).
 *
 * Все включённые слои всех карточек — одним пакетом движка: переключение
 * карточки (сколько бы в ней ни было слоёв) — одна пересборка update.rpf, а
 * выключение слоя — тот же набор без него, а не снятие корзиной библиотеки
 * (перемотка архива и повтор каждой работы мастерской сверху). Пустой набор
 * снимает оптимизацию из игры движком.
 *
 * Запись установки — одна на набор (`layerModId` и список слоёв); прежние
 * записи слоёв (каждый слой своим пакетом) набор заменяет: их пакеты уходят
 * той же установкой, записи забываются.
 */

import {
  OPTIMIZATION_LAYER_IDS,
  OPTIMIZATION_SET_RECORD_KEY,
  optimizationLayerRecordKey,
} from "@modovik/optimizer/layer-ids.js";
import { TEXTURE_LEVEL_LAYERS, textureStepOfLayers } from "@modovik/optimizer/texture-levels.js";
import { applyOptimizationLayer, planOptimizationLayer } from "../../../../api.js";
import { forgetInstallRecord, readInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";
import { refreshVegetation } from "./recolor.js";

/** Слои, что стоят сейчас: набором или прежними пакетами слоёв. */
export function installedOptimizationLayers() {
  const set = readInstallRecord(OPTIMIZATION_SET_RECORD_KEY);
  const layers = new Set(Array.isArray(set?.layers) ? set.layers.filter((layerId) => OPTIMIZATION_LAYER_IDS.includes(layerId)) : []);
  for (const layerId of OPTIMIZATION_LAYER_IDS) if (readInstallRecord(optimizationLayerRecordKey(layerId))) layers.add(layerId);
  return layers;
}

/* Остались ли записи слоёв прежнего вида (каждый слой своим пакетом). */
const legacyRecords = () => OPTIMIZATION_LAYER_IDS.some((layerId) => Boolean(readInstallRecord(optimizationLayerRecordKey(layerId))));

/**
 * Поставить набор из `layers` (все слои, что должны стоять). Тот же набор,
 * что стоит, ничего не пишет. `{ installed?, removed?, unchanged? }`.
 *
 * Ступеней «Ухудшения текстур» в наборе больше нет (задача 1 ТЗ 05.10.2026):
 * они ставятся своим пакетом. Прежняя ступень в наборе при его смене
 * переезжает в пакет той же ступенью (`keepTextures`), чтобы переключение
 * карточки не снимало текстуры молча.
 */
export async function installOptimizationSet({ layers, report = null, keepTextures = true, refresh = true }) {
  const target = [...new Set(layers)].filter((layerId) => OPTIMIZATION_LAYER_IDS.includes(layerId) && !TEXTURE_LEVEL_LAYERS.includes(layerId)).sort();
  const current = installedOptimizationLayers();
  const legacyTextures = textureStepOfLayers(current);
  if (target.length === current.size && target.every((layerId) => current.has(layerId)) && !legacyRecords()) return { unchanged: true };
  /* Прежняя ступень уезжает в пакет — растительность соберётся один раз,
     поверх пакета, а не дважды. */
  const outcome = await installSet(target, report, refresh && !(legacyTextures && keepTextures));
  if (legacyTextures && keepTextures) {
    const { installTextureStep } = await import("./textures.js");
    await installTextureStep({ step: legacyTextures, report });
  }
  return outcome;
}

async function installSet(target, report, refresh) {
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const plan = await planOptimizationLayer({ layers: target, gameRoot: game.path });
  const result = await applyOptimizationLayer({ gameRoot: game.path, planId: plan.planId });
  for (const layerId of OPTIMIZATION_LAYER_IDS) forgetInstallRecord(optimizationLayerRecordKey(layerId));
  /* Растительность собирает словари земли поверх набора: набор сменился —
     она собирается заново поверх нового (задача 10). */
  const withVegetation = async () => {
    if (!refresh) return result;
    const vegetation = await refreshVegetation("optimization", result, report);
    return vegetation ? { ...result, vegetation } : result;
  };
  if (!target.length || !result?.layerModId) {
    forgetInstallRecord(OPTIMIZATION_SET_RECORD_KEY);
    return { removed: true, result: await withVegetation() };
  }
  await rememberInstallRecord(
    OPTIMIZATION_SET_RECORD_KEY,
    { layerModId: result.layerModId },
    { editor: "optimization", layers: result.layers || target, gameRoot: game.path, files: result.files || plan.files },
    { report },
  );
  return { installed: true, result: await withVegetation() };
}
