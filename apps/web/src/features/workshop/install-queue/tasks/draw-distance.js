/*
 * «Дальность прорисовки» в игру (задача 7 ТЗ 06.10.2026): свой пакет движка —
 * модификатор таймцикла `AstralDrawDistance` и карта с его коробкой на всю
 * карту. Ползунок вкладки только выбирает; работа очереди ставит пакет с
 * выбранной дальностью и цветом стены, «Как в игре» — снимает его.
 *
 * Запись установки — одна (`OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY`): мод
 * пакета (`layerModId`), дальность и цвет стены; «Как в игре» её стирает.
 */

import { OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY } from "@modovik/optimizer/layer-ids.js";
import { normalizeDrawDistance } from "@modovik/optimizer/draw-distance.js";
import { applyOptimizationLayer, planOptimizationLayer } from "../../../../api.js";
import { forgetInstallRecord, readInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";

/** Что стоит в игре: `{ distance, look }`; без установки — «Как в игре». */
export function installedDrawDistance() {
  const record = readInstallRecord(OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY);
  if (!record?.layerModId) return normalizeDrawDistance({});
  return normalizeDrawDistance({ distance: record.distance, look: record.look });
}

/**
 * Поставить дальность (`distance: null` — «Как в игре», пакет снимается).
 * `{ result, unchanged? }`.
 */
export async function installDrawDistance({ settings, report = null }) {
  const target = normalizeDrawDistance(settings);
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const plan = await planOptimizationLayer({ drawDistance: target, gameRoot: game.path });
  report?.({ step: "compose" });
  const result = await applyOptimizationLayer({ gameRoot: game.path, planId: plan.planId });
  if (target.distance === null || !result?.layerModId) forgetInstallRecord(OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY);
  else
    await rememberInstallRecord(
      OPTIMIZATION_DRAW_DISTANCE_RECORD_KEY,
      { layerModId: result.layerModId },
      { editor: "optimization-draw-distance", distance: target.distance, look: target.look, gameRoot: game.path, files: result.files ?? plan.files },
      { report },
    );
  return { result, unchanged: result?.status === "unchanged" };
}
