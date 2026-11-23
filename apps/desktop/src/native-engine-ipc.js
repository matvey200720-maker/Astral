/*
 * Сырые мосты к нативному движку: здоровье, модели, текстуры и RPF-патчи.
 *
 * Отдельный модуль по той же причине, что у воды и хранилища: `main.js`
 * отвечает за жизненный цикл окна, а не за перечень команд нативного
 * хелпера. Все семь каналов — одна формула «проверенный вход →
 * callNativeEngine», и держать их лучше рядом друг с другом. Регистрация
 * принимает всё, что ей нужно, параметрами — так её можно проверить тестом,
 * не поднимая Electron.
 */

import path from "node:path";
import { discoverGames } from "@modovik/game-discovery";
import {
  callNativeEngine,
  engineAssetsOrigin,
  setNativeContextDefaults,
} from "./native-engine.js";

export function registerNativeEngineIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions = null,
  games = () => discoverGames(),
}) {
  /*
   * Сырые мосты с путями из окна (разбор безопасности 01.11.2026): окно
   * называет файл, куда движок пишет, и папку игры, в которую ставится патч.
   * Запись — только в кэш Astral, патч — только в найденную установку игры:
   * иначе окно (с правами Astral, часто администратора) писало бы .ytd/.glb/.png
   * в любую папку и RPF-патч в любую «игру».
   */
  const fold = (value) => {
    const resolved = path.resolve(String(value || ""));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const insideCache = async (input) => {
    if (typeof installOptions !== "function") throw new Error("Запись движка недоступна.");
    const { stateDir } = await installOptions();
    const root = fold(stateDir);
    const output = fold(input?.output);
    if (!stateDir || !output.startsWith(root + path.sep))
      throw new Error("Движок пишет только в кэш Astral.");
    return input;
  };
  const discoveredGame = async (input) => {
    const wanted = fold(input?.gameRoot);
    const list = await games();
    if (!input?.gameRoot || !list.some((game) => fold(game.path) === wanted))
      throw new Error("Установка GTA V не найдена. Выполните повторное сканирование.");
    return input;
  };
  /* Место нативного хоста — мосту по умолчанию: скин студии, вызванный с
     одним ходом записи (`{ onProgress }`), находит хост так же, как вызов с
     полным контекстом (04.10.2026). */
  setNativeContextDefaults(nativeContext());
  handleIpc(IPC.NATIVE_HEALTH, (event) =>
    trusted(event, () => callNativeEngine("health", {}, nativeContext())),
  );

  handleIpc(IPC.ENGINE_ASSETS_ORIGIN, (event) =>
    trusted(event, () => engineAssetsOrigin()),
  );

  handleIpc(IPC.NATIVE_CONVERT_MODEL, (event, input) =>
    trusted(event, () =>
      insideCache(safeInput(input)).then((value) =>
        callNativeEngine("convert-model", value, nativeContext()),
      ),
    ),
  );

  handleIpc(IPC.NATIVE_READ_MODEL_ARS2, (event, input) =>
    trusted(event, () =>
      callNativeEngine("read-model-ars2", safeInput(input), nativeContext()),
    ),
  );

  handleIpc(IPC.NATIVE_EXTRACT_TEXTURES, (event, input) =>
    trusted(event, () =>
      insideCache(safeInput(input)).then((value) =>
        callNativeEngine("extract-textures", value, nativeContext()),
      ),
    ),
  );

  handleIpc(IPC.NATIVE_RENAME_TEXTURE, (event, input) =>
    trusted(event, () =>
      insideCache(safeInput(input)).then((value) =>
        callNativeEngine("rename-texture", value, nativeContext()),
      ),
    ),
  );

  handleIpc(IPC.NATIVE_VALIDATE_RPF_PATCH, (event, input) =>
    trusted(event, () =>
      callNativeEngine("validate-rpf-patch", safeInput(input), nativeContext()),
    ),
  );

  handleIpc(IPC.NATIVE_INSTALL_RPF_PATCH, (event, input) =>
    trusted(event, () =>
      discoveredGame(safeInput(input)).then((value) =>
        callNativeEngine("install-rpf-patch", value, nativeContext()),
      ),
    ),
  );

  handleIpc(IPC.NATIVE_RESTORE_RPF_POINT, (event, input) =>
    trusted(event, () =>
      callNativeEngine("restore-rpf-point", safeInput(input), nativeContext()),
    ),
  );
}
