/*
 * Каналы прострелов: план и применение.
 *
 * Отдельный модуль по той же причине, что у фонарей и неба: `main.js`
 * отвечает за жизненный цикл окна, а не за то, из чего собираются
 * прострелы. План только читает файлы набора и опись движка; применение
 * идёт под предохранителем Legacy (игра закрыта, папка подтверждена, копии
 * update.rpf в mods нет) и в рамке замка мастерской
 * (`WORKSHOP_APPLY_WALLBANG` в `workshop-operations.js`). Снимаются
 * прострелы корзиной библиотеки — как мод движка, по `layerModId` записи.
 */

import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { createWallbangService } from "./wallbang-customizer.js";

export function registerWallbangIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  operations = null,
  runtimeGuard = legacyRuntimeGuard("прострелов", "Прострелы"),
}) {
  let servicePromise;
  const service = () => {
    if (!servicePromise)
      servicePromise = installOptions().then(({ stateDir }) =>
        createWallbangService({
          stateDir,
          /* Фазы пересборки уходят в окно: без них «Применить» молчит
             десятки секунд, и это выглядит как зависание. */
          onProgress: (status) => operations?.report(status),
        }),
      );
    return servicePromise;
  };

  handleIpc(IPC.WORKSHOP_PLAN_WALLBANG, (event, input) =>
    trusted(event, async () => (await service()).plan(safeInput(input))),
  );

  handleIpc(IPC.WORKSHOP_APPLY_WALLBANG, (event, input) =>
    trusted(event, async () =>
      (await service()).apply(safeInput(input), {
        assertRuntimeSafety: runtimeGuard.assertRuntimeSafety,
      }),
    ),
  );
}
