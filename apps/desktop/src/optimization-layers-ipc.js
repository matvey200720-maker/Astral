/*
 * Каналы слоёв оптимизации: план и включение.
 *
 * Канал включения один на все слои: замок мастерской называет запись
 * «Оптимизация», а какой слой едет — видно в очереди окна. Включение идёт
 * под предохранителем Legacy (игра закрыта, папка подтверждена). Снимается
 * слой корзиной библиотеки или переключателем — как мод движка.
 */

import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { createOptimizationService } from "./optimization-layers.js";
import { registerLayerRebuilder } from "./layer-works.js";

export function registerOptimizationLayersIpc({ IPC, handleIpc, trusted, safeInput, installOptions, nativeContext = () => ({}), operations = null }) {
  if (!IPC.WORKSHOP_PLAN_OPTIMIZATION_LAYER || !IPC.WORKSHOP_APPLY_OPTIMIZATION_LAYER) return;
  let servicePromise;
  const service = () => {
    if (!servicePromise)
      servicePromise = installOptions().then(({ stateDir }) =>
        createOptimizationService({
          stateDir,
          nativeContext,
          onProgress: (status) => operations?.report(status),
        }),
      );
    return servicePromise;
  };
  const guard = legacyRuntimeGuard("слоя оптимизации", "Оптимизация");
  /* Ступень «Ухудшения текстур» собирается заново поверх сменившихся
     словарей прямо в операции работы снизу (задача 3 ТЗ 10.10.2026). */
  registerLayerRebuilder("textures", async (work, context) => (await service()).rebuildTextures(work, context));

  handleIpc(IPC.WORKSHOP_PLAN_OPTIMIZATION_LAYER, (event, input) =>
    trusted(event, async () => (await service()).plan(safeInput(input))),
  );
  handleIpc(IPC.WORKSHOP_APPLY_OPTIMIZATION_LAYER, (event, input) =>
    trusted(event, async () =>
      (await service()).apply(safeInput(input), { assertRuntimeSafety: guard.assertRuntimeSafety }),
    ),
  );
}
