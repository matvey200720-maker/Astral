/*
 * Каналы фонарей: лампы из игры, план и применение.
 *
 * Отдельный модуль по той же причине, что у неба и эффектов: `main.js`
 * отвечает за жизненный цикл окна, а не за то, из чего собираются фонари.
 * Чтение в игру не пишет; применение идёт под предохранителем Legacy (игра
 * закрыта, папка подтверждена, копии update.rpf в mods нет) и в рамке замка
 * мастерской (`WORKSHOP_APPLY_LAMPS` в `workshop-operations.js`).
 */

import {
  applyLampStudio,
  createLampBaseCache,
  planLampStudio,
} from "./lamp-studio.js";
import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { createEffectsReader } from "./game-read-host.js";
import { healEngineLayer } from "./engine-layer-heal.js";
import { discoverGames } from "@modovik/game-discovery";

const findLampGame = () => discoverGames();

export function registerLampStudioIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  runtimeGuard = legacyRuntimeGuard("фонарей", "Фонари"),
  /* Опись ламп и правила частиц читаются из игры один раз на её состояние:
     повторный вход в редактор — без ожидания. Параметром — для теста. */
  baseCache = createLampBaseCache(),
}) {
  /* База из игры — в своём потоке с пределом памяти: редукс роняет поток, а не Astral (18.10). */
  const readBaseOffThread = createEffectsReader(new URL("./lamp-studio.js", import.meta.url).href, "readLampStudioBase", nativeContext);
  const healLampLayer = async (value, stateDir) => {
    try {
      const root = String(value?.gameRoot || "").toLowerCase().replaceAll("\\", "/").replace(/\/+$/, "");
      const game = (await findLampGame()).find((item) => String(item.path || "").toLowerCase().replaceAll("\\", "/").replace(/\/+$/, "") === root);
      if (!game) return;
      await healEngineLayer({ gameRoot: game.path, targetId: game.id, edition: game.edition, stateDir, reason: "уборки (перед фонарями)", assertRuntimeSafety: async () => runtimeGuard?.(game.path) });
    } catch {
      /* Сверка не вышла — фонари ставятся как раньше. */
    }
  };
  handleIpc(IPC.WORKSHOP_READ_LAMPS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return baseCache.get(safeInput(input), storage.stateDir, (request) =>
        readBaseOffThread(request, storage.stateDir),
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_LAMPS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planLampStudio(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_LAMPS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      /* Пакет моделей фонарей — мод движка: если перемотка уборки вернула update.rpf без него, слой пересобирается до записи (`engine-layer-heal.js`). */
      await healLampLayer(value, storage.stateDir);
      return applyLampStudio(value, nativeContext(), storage.stateDir, runtimeGuard);
    }),
  );
}
