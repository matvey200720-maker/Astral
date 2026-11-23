/*
 * Каналы эффектов попадания, килл-эффекта и следа на экране.
 *
 * Отдельный модуль по той же причине, что у неба и большой карты: `main.js`
 * отвечает за жизненный цикл окна, а не за состав частиц. Оба редактора —
 * одна и та же тройка чтение/план/применение над ptfx-ассетами и различаются
 * только предохранителем, поэтому живут вместе. Регистрация принимает всё,
 * что ей нужно, параметрами — так её можно проверить тестом, не поднимая
 * Electron.
 */

import {
  applyPtfxCustomization,
  planPtfxCustomization,
} from "./ptfx-customizer.js";
import { createPtfxBaseCache } from "./ptfx-base-cache.js";
import { createEffectsReader } from "./game-read-host.js";
import { resolveRpfHelperExecutable } from "./rpf-composer.js";
import {
  applyKillEffectCustomization,
  planKillEffectCustomization,
  readKillEffectState,
} from "./kill-effect-customizer.js";
import { applyScreenHits, planScreenHits, readScreenHitsState } from "./screen-hits-customizer.js";

export function registerPtfxIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  ptfxGuard,
  killEffectGuard,
  screenHitsGuard = killEffectGuard,
  /* Кэш базы — параметром, чтобы тест регистрации не поднимал помощника. */
  ptfxBaseCache = createPtfxBaseCache({
    helperExecutable: () => resolveRpfHelperExecutable(),
  }),
}) {
  /* База из игры — в своём потоке с пределом памяти: редукс роняет поток, а не Astral (18.10). */
  const readBaseOffThread = createEffectsReader(new URL("./ptfx-customizer.js", import.meta.url).href, "readPtfxBase", nativeContext);
  /* База эффектов читается из игры один раз на её состояние
     (`ptfx-base-cache.js`): повторный вход в редактор — без ожидания. */
  handleIpc(IPC.WORKSHOP_READ_PTFX, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return ptfxBaseCache.get(safeInput(input), storage.stateDir, (request) =>
        readBaseOffThread(request, storage.stateDir),
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_PTFX, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planPtfxCustomization(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_PTFX, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyPtfxCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        ptfxGuard,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_READ_KILL_EFFECT, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readKillEffectState(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_KILL_EFFECT, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planKillEffectCustomization(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_KILL_EFFECT, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyKillEffectCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        killEffectGuard,
      );
    }),
  );

  /* Эффекты попадания на экране: та же тройка над visualsettings.dat и
     graphics.ytd игрока (`screen-hits-customizer.js`). */
  handleIpc(IPC.WORKSHOP_READ_SCREEN_HITS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readScreenHitsState(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_SCREEN_HITS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planScreenHits(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_SCREEN_HITS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyScreenHits(value, nativeContext(), storage.stateDir, screenHitsGuard);
    }),
  );
}
