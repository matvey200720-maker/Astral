/*
 * Каналы редактора «Животные» (05.11.2026). Список и модель животного — чтение: игра и файлы человека не меняются; оно идёт в
 * потоке чтения игры (`animal-reads.js`), главный процесс только передаёт запрос и ответ. План собирает пакет в том же потоке
 * (`animals-build.js`), «Применить» идёт под предохранителем Legacy (игра закрыта, папка подтверждена, копии `update.rpf` в
 * `mods` нет) и в рамке замка мастерской (`WORKSHOP_APPLY_ANIMALS` в `workshop-operations.js`). Снимаются животные корзиной
 * библиотеки — как мод движка, по `layerModId` записи.
 */

import { legacyRuntimeGuard } from "../legacy-runtime-guard.js";
import { createGameReader } from "../game-read-host.js";
import { createAnimalsService } from "./animals-customizer.js";

export function registerAnimalsIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  nativeContext,
  operations = null,
  runtimeGuard = legacyRuntimeGuard("животных", "Животные"),
}) {
  const reads = (module, name) => createGameReader(new URL(module, import.meta.url).href, name, nativeContext);
  const list = reads("./animal-reads.js", "listAnimals");
  const read = reads("./animal-reads.js", "readAnimal");
  const build = reads("./animals-build.js", "buildAnimalsPackage");
  const run = (reader) => (event, input) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      return reader(safeInput(input), stateDir);
    });

  handleIpc(IPC.ANIMALS_LIST, run(list));
  handleIpc(IPC.ANIMALS_READ, run(read));

  let servicePromise;
  const service = () => {
    if (!servicePromise)
      servicePromise = installOptions().then(({ stateDir }) =>
        createAnimalsService({
          stateDir,
          build: (request) => build(request, stateDir),
          /* Фазы пересборки уходят в окно: без них «Применить» молчит десятки секунд, и это выглядит как зависание. */
          onProgress: (status) => operations?.report(status),
        }),
      );
    return servicePromise;
  };

  handleIpc(IPC.WORKSHOP_PLAN_ANIMALS, (event, input) => trusted(event, async () => (await service()).plan(safeInput(input))));

  handleIpc(IPC.WORKSHOP_APPLY_ANIMALS, (event, input) =>
    trusted(event, async () =>
      (await service()).apply(safeInput(input), {
        assertRuntimeSafety: runtimeGuard.assertRuntimeSafety,
      }),
    ),
  );
}
