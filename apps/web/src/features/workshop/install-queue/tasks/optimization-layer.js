/*
 * Слой оптимизации в игру: трава, мусор, полки, частицы, следы, таймцикл.
 *
 * План собирает слой в главном процессе (из файлов игры игрока и описи
 * `resources/optimization`), установка ставит ровно собранное пакетом
 * движка. Прежняя версия того же слоя уходит тем же движением.
 *
 * Запись установки — мод слоя (`layerModId`): переключатель раздела и
 * корзина библиотеки снимают его как любой мод движка.
 */

import { optimizationLayerRecordKey } from "@modovik/optimizer/layers.js";
import { applyOptimizationLayer, planOptimizationLayer } from "../../../../api.js";
import { forgetInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

/**
 * @param {{ layer: string, report?: Function }} input
 * @returns {Promise<{ result: object, plan: object, record: object|null }>}
 */
export async function installOptimizationLayer({ layer, report = null }) {
  const key = optimizationLayerRecordKey(layer);
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const plan = await planOptimizationLayer({ layer, gameRoot: game.path });
  const result = await applyOptimizationLayer({ layer, gameRoot: game.path, planId: plan.planId });
  const record = await rememberInstallRecord(
    key,
    { layerModId: result?.layerModId },
    { editor: "optimization", layer, gameRoot: game.path, files: result?.files || plan.files },
    { report },
  );
  if (!record) forgetInstallRecord(key);
  return { result, plan, record };
}
