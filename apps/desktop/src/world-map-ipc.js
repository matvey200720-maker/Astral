/*
 * Каналы большой карты: чтение плиток, сессия экспорта, план и применение.
 *
 * Отдельный модуль по той же причине, что у прицела и мини-карты: `main.js`
 * отвечает за жизненный цикл окна, а не за шесть шагов конвейера карты.
 * Чтение плиток и подготовка сессии ничего не пишут в игру, поэтому
 * проверкой запущенной GTA V обложено только применение — как у остальных
 * редакторов. Регистрация принимает всё, что ей нужно, параметрами — так её
 * можно проверить тестом, не поднимая Electron.
 */

import {
  applyWorldMapCustomization,
  beginWorldMapExport,
  endWorldMapExport,
  planWorldMapCustomization,
  readIslandMap,
  readRadarTileColours,
  readWorldMapTiles,
  removeWorldMapCustomization,
  restoreStockWorldMap,
  stageWorldMapTile,
  stockWorldMapStatus,
} from "./world-map-customizer.js";
import { createGameReader } from "./game-read-host.js";

export function registerWorldMapIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  runtimeGuard,
  operations = null,
}) {
  /* Фазы движка уходят в окно: пересборка update.rpf идёт десятки секунд, и
     без них «Применить» молчит — это выглядит как зависание. */
  const guarded = {
    ...runtimeGuard,
    onProgress: (status) => operations?.report(status),
  };
  handleIpc(IPC.WORKSHOP_MAP_TILES, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readWorldMapTiles(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  /* Цвета векторных плиток радара: чтение, ничего не пишет. */
  handleIpc(IPC.WORKSHOP_MAP_RADAR_COLOURS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readRadarTileColours(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  /* Фильм острова Кайо-Перико из игры игрока: чистая основа и палитра заливок. */
  handleIpc(IPC.WORKSHOP_MAP_ISLAND, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readIslandMap(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  /* Векторная карта штата из игры: чтение, ничего не пишет. Первый разбор 65
     `.ydd` радара и сверка кэша `.bin` — в своём потоке с пределом памяти
     (класс A плана переписи, 18.10), а не в главном процессе. */
  const readWorldMapGeometry = createGameReader(new URL("./world-map-geometry.js", import.meta.url).href, "readWorldMapGeometry", null, {
    argsOf: (request, context, stateDir) => [request, stateDir],
    toolsAt: null,
  });
  handleIpc(IPC.WORKSHOP_MAP_GEOMETRY, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readWorldMapGeometry(safeInput(input), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_MAP_BEGIN, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return beginWorldMapExport(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_MAP_STAGE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return stageWorldMapTile(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_MAP_END, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return endWorldMapExport(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_MAP, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planWorldMapCustomization(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_MAP, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyWorldMapCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        guarded,
      );
    }),
  );

  /* Штатная карта: сверка ничего не пишет, возврат — та же транзакция
     движка, что и установка, с той же проверкой запущенной игры. */
  handleIpc(IPC.WORKSHOP_MAP_STOCK_STATUS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return stockWorldMapStatus(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_MAP_RESTORE_STOCK, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return restoreStockWorldMap(
        value,
        nativeContext(),
        storage.stateDir,
        guarded,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_REMOVE_MAP, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return removeWorldMapCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        guarded,
      );
    }),
  );
}
