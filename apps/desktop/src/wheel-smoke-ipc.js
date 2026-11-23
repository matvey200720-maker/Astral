/*
 * Каналы «Дыма из-под колёс»: дым игры и дрифт-машина для кадра, план и
 * применение.
 *
 * Отдельный модуль по той же причине, что у фонарей и эффектов: `main.js`
 * отвечает за жизненный цикл окна, а не за то, из чего собирается дым.
 * Чтение в игру не пишет; применение идёт под предохранителем Legacy (игра
 * закрыта, папка подтверждена, копии update.rpf в mods нет) и в рамке замка
 * мастерской (`WORKSHOP_APPLY_WHEEL_SMOKE` в `workshop-operations.js`).
 */

import {
  applyWheelSmoke,
  createWheelSmokeBaseCache,
  planWheelSmoke,
} from "./wheel-smoke.js";
import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { createEffectsReader, createGameReader } from "./game-read-host.js";

export function registerWheelSmokeIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  runtimeGuard = legacyRuntimeGuard("настройки автомобиля", "Настройка автомобиля"),
  /* Правила-доноры и их листы читаются из игры один раз на её состояние:
     повторный вход в редактор — без ожидания. Параметром — для теста. */
  baseCache = createWheelSmokeBaseCache(),
}) {
  /* База из игры — в своём потоке с пределом памяти: редукс роняет поток, а не Astral (18.10). */
  const readBaseOffThread = createEffectsReader(new URL("./wheel-smoke.js", import.meta.url).href, "readWheelSmokeBase", nativeContext);
  handleIpc(IPC.WORKSHOP_READ_WHEEL_SMOKE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return baseCache.get(safeInput(input), storage.stateDir, (request) =>
        readBaseOffThread(request, storage.stateDir),
      );
    }),
  );

  /* Машина кадра — дрифт-версия из игры игрока, только чтение; разбор
     модели — в своём потоке (`readWheelSmokeCar(input, stateDir, tools)`). */
  const readCarOffThread = createGameReader(new URL("./wheel-smoke-car.js", import.meta.url).href, "readWheelSmokeCar", nativeContext, {
    argsOf: (request, context, stateDir) => [request, stateDir],
    toolsAt: 2,
  });
  if (IPC.WORKSHOP_READ_WHEEL_SMOKE_CAR)
    handleIpc(IPC.WORKSHOP_READ_WHEEL_SMOKE_CAR, (event, input) =>
      trusted(event, async () => {
        const storage = await installOptions();
        return readCarOffThread(safeInput(input), storage.stateDir);
      }),
    );

  handleIpc(IPC.WORKSHOP_PLAN_WHEEL_SMOKE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planWheelSmoke(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_WHEEL_SMOKE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyWheelSmoke(value, nativeContext(), storage.stateDir, runtimeGuard);
    }),
  );
}
