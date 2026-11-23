/*
 * Каналы неба: чистая база из игры, текстуры луны и звёзд, облачные шапки,
 * план и применение.
 *
 * Отдельный модуль по той же причине, что у большой карты и воды: `main.js`
 * отвечает за жизненный цикл окна, а не за то, из чего складывается пресет
 * неба. Чтение базы и текстур в игру не пишет, поэтому предохранитель Legacy
 * получает только применение. Регистрация принимает всё, что ей нужно,
 * параметрами — так её можно проверить тестом, не поднимая Electron.
 */

import {
  applyTimecycleCustomization,
  planTimecycleCustomization,
  putSkyRainbow,
  readSkyBases,
  readSkySources,
  takeSkySourceFromGame,
} from "./timecycle-customizer.js";
import { readSkyTextures } from "./sky-textures.js";
import { readCloudHats, readCloudHatTexture } from "./cloud-hats.js";
import { inspectSkyRainbow } from "./sky-rainbow.js";

export function registerTimecycleIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  runtimeGuard,
}) {
  handleIpc(IPC.WORKSHOP_READ_TIMECYCLE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readSkyBases(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_SKY_TEXTURES, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readSkyTextures(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_CLOUD_HATS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readCloudHats(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_CLOUD_HAT_TEXTURE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readCloudHatTexture(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_TIMECYCLE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planTimecycleCustomization(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  /* Радуга отдельно от неба: «Откатить» в редакторе снимает и её, а
     поставленную прежней версией окно переставляет. Пишет в игру — поэтому
     под тем же предохранителем, что и установка неба. */
  handleIpc(IPC.WORKSHOP_SKY_RAINBOW, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return putSkyRainbow(
        value,
        nativeContext(),
        storage.stateDir,
        runtimeGuard,
      );
    }),
  );

  /* Какие радуги стоят и какой схемой — только чтение описи. */
  handleIpc(IPC.WORKSHOP_SKY_RAINBOW_STATUS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return inspectSkyRainbow(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  /* Небо, которое уже стоит в игре (NVE, coreFx, сборка сервера): список
     найденного и небо выбранного проектом редактора. Только чтение. */
  handleIpc(IPC.WORKSHOP_SKY_SOURCES, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readSkySources(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_SKY_SOURCE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return takeSkySourceFromGame(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_TIMECYCLE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyTimecycleCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        runtimeGuard,
      );
    }),
  );
}
