/*
 * Каналы вкладки «DLSS 5» (задача 4 ТЗ 04.10.2026): что стоит, установка и
 * снятие (`reshade-installer.js`). С ТЗ 08.10 (задача 2) пакет едет в
 * составе Astral — выбора папки пакета больше нет. Корень игры для GTA 5 RP,
 * если окно его не знает, — путь к игре из RAGE MP. Регистрация берёт всё
 * параметрами — так её проверяет тест без Electron.
 */

import { rageGamePath } from "./launcher-game-paths.js";
import { ensureLoadersAtRoot, retireLoadersAtRoot } from "./loaders-on-demand.js";
import {
  applyReshade,
  readReshadeState,
  removeReshade,
} from "./reshade-installer.js";

/* Корень игры: из окна (найденная установка), иначе — из RAGE MP. */
async function withGameRoot(input, findRage) {
  if (input?.gameRoot) return input;
  const gameRoot = await findRage().catch(() => null);
  return gameRoot ? { ...input, gameRoot } : input;
}

export function registerReshadeIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  findRage = rageGamePath,
}) {
  handleIpc(IPC.RESHADE_READ, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readReshadeState(
        await withGameRoot(safeInput(input), findRage),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.RESHADE_APPLY, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return applyReshade(
        await withGameRoot(safeInput(input), findRage),
        storage.stateDir,
        {
          /* Нет ASI-прокси в корне игры — Astral ставит свою пару загрузчиков (`loaders-on-demand.js`). */
          ensureGameLoader: (gameRoot) => ensureLoadersAtRoot({ gameRoot, stateDir: storage.stateDir }),
        },
      );
    }),
  );

  handleIpc(IPC.RESHADE_REMOVE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      const value = await withGameRoot(safeInput(input), findRage);
      const result = await removeReshade(value, storage.stateDir);
      /* ReShade снят — если пара больше никому не нужна, она уходит (только наша; 23.11.2026). */
      if (value?.gameRoot) await retireLoadersAtRoot({ gameRoot: value.gameRoot, stateDir: storage.stateDir });
      return result;
    }),
  );
}
