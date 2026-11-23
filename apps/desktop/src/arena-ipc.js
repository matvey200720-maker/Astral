/*
 * Каналы установки арены.
 *
 * Отдельный модуль по той же причине, что у воды и ганпаков: `main.js`
 * отвечает за жизненный цикл окна, а не за то, как папка мода превращается в
 * слой `astral_arena.rpf`. Зависимости приходят параметрами — модуль не трогает
 * Electron напрямую и проверяется без него; сам конвейер живёт в
 * `arena-customizer.js` и в трасте install-engine.
 */

import path from "node:path";

import { assertInstallRuntimeSafe } from "./install-safety.js";
import { createArenaCustomizerService } from "./arena-customizer.js";
import { createArenaHallProvider } from "./arena-hall-model.js";
import { readArenaModHall } from "./arena-mod-hall.js";
import { extractRpfEntries, inspectYtd } from "./rpf-composer.js";
import { callNativeEngine } from "./native-engine.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { discoverGames } from "@modovik/game-discovery";

/* GLB уходит в окно голым ArrayBuffer: Buffer у structured clone превращается
   в объект с полями, и загрузчик модели его не поймёт. */
function binaryResult(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

export function registerArenaIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  nativeContext,
  findGame,
  dialog,
  operations = null,
  catalogPackages = null,
}) {
  /* Сервис один на процесс: внутри него сериализация установок и снятий —
     две параллельные записи в update.rpf не должны существовать в природе. */
  const service = createArenaCustomizerService({
    storageOptions: installOptions,
    findGame,
    assertRuntimeSafe: assertInstallRuntimeSafe,
    /* Фазы пересборки уходят в окно: без них «Применить» молчит десятки
       секунд, и это выглядит как зависание. */
    onProgress: (status) => operations?.report(status),
    /* Опись словарей текстур мода: имена текстур показываются в диалоге.
       Helper требует папку игры даже для чтения одиночного файла; берётся
       любая найденная копия. Старый helper без режима ytd-inspect даёт
       предупреждение по словарю, а не отказ описи. */
    inspectYtd: async (input) => {
      const game = (await discoverGames()).find((item) => item?.path);
      if (!game) throw new Error("Установка GTA V не найдена.");
      return inspectYtd({
        ...input,
        gameRoot: game.path,
        edition: game.edition || "Legacy",
      });
    },
  });

  /*
   * Поставщик настоящего зала ленивый и один на процесс: он трогает диск и
   * нативный движок только когда человек впервые просит зал из игры, а общий
   * экземпляр даёт всем запросам один кэш и одну очередь сборки.
   */
  let hallProvider = null;
  const hall = async () => {
    if (!hallProvider) {
      const { stateDir } = await installOptions();
      hallProvider = createArenaHallProvider({
        cacheRoot: path.join(stateDir, "arena-editor", "hall-models"),
        /* Мастерскую открывают до выбора установки, а `findGame` без id
           бросает. Для чтения зала годится любая найденная копия игры. */
        findGame: async (targetId) =>
          targetId
            ? findGame(targetId)
            : (await discoverGames()).find((game) => game?.path) || null,
        extractEntries: extractRpfEntries,
        convertModels: (input) =>
          callNativeEngine("convert-models", input, nativeContext()),
        inspectYtyp: (input) =>
          callNativeEngine("inspect-interior-ytyp", input, nativeContext()),
        /* Листает зашифрованный архив только этот вызов, и ключи ему нужны
           явно: нативный хост сам их в Steam-сборке не находит. Извлечение
           ходит через rpf-хелпер, а тот добывает ключи своей проверенной
           связкой (см. rpf-composer). */
        listEntries: async (input) => {
          const support = await provisionArchiveSupport({ stateDir });
          return callNativeEngine(
            "list-archive-entries",
            { ...input, keys: support.directory },
            nativeContext(),
          );
        },
      });
    }
    return hallProvider;
  };

  handleIpc(IPC.WORKSHOP_ARENA_HALL_MANIFEST, (event, input) =>
    trusted(event, async () => {
      const {
        targetId = null,
        venue = "bowl",
        source = null,
      } = safeInput(input) || {};
      return (await hall()).manifest({ targetId, venue, source });
    }),
  );

  handleIpc(IPC.WORKSHOP_ARENA_HALL_PIECE, (event, input) =>
    trusted(event, async () => {
      const {
        targetId = null,
        venue = "bowl",
        index,
        source = null,
      } = safeInput(input) || {};
      const piece = await (
        await hall()
      ).piece({
        targetId,
        venue,
        index,
        source,
      });
      return piece?.glb ? { ...piece, glb: binaryResult(piece.glb) } : piece;
    }),
  );

  /*
   * Зал арены мода для редактора (25.10.2026): пакет арены качается доверенным путём каталога (подпись, sha256, хосты), зал
   * собирается из файлов мода поверх зала игры — окну уходят сцена и листы (`arena-mod-hall.js`). Игра нужна: зал — её модели.
   */
  handleIpc(IPC.WORKSHOP_ARENA_MOD_HALL, (event, input) =>
    trusted(event, async () => {
      if (!catalogPackages) throw new Error("Каталог недоступен в этой сборке.");
      const storage = await installOptions();
      const trust = catalogPackages();
      const game = (await discoverGames()).find((item) => item?.path);
      /* Зал Majestic — из папки сервера: игра ему не нужна (`arena-mod-hall.js`). */
      if (!game && safeInput(input)?.server !== "majestic") throw new Error("Установка GTA V не найдена.");
      const support = await provisionArchiveSupport({ stateDir: storage.stateDir });
      return readArenaModHall(safeInput(input), nativeContext(), {
        stateDir: storage.stateDir,
        downloadsDir: storage.downloadsDir,
        publicKey: await trust.publicKey(),
        allowedHosts: trust.allowedHosts,
        allowInsecureLocalhost: trust.allowInsecureLocalhost,
        source: { root: game?.path || "", keys: support.directory },
        cacheRoot: path.join(storage.stateDir, "arena-editor", "mod-hall"),
      });
    }),
  );

  /* Папка с файлами арены, вынутыми из игры, — источник самого зала, а не
     мода: её выбирают, чтобы УВИДЕТЬ арену, а не чтобы её установить. Поэтому
     канал отдельный от выбора папки мода, и заголовок диалога другой. */
  handleIpc(IPC.WORKSHOP_CHOOSE_ARENA_HALL_FOLDER, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Выберите папку с файлами арены (.ytyp, .ydr, .ytd)",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : { source: result.filePaths[0] };
    }),
  );

  handleIpc(IPC.WORKSHOP_CHOOSE_ARENA_SOURCE, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Выберите папку мода арены",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : { source: result.filePaths[0] };
    }),
  );

  handleIpc(IPC.WORKSHOP_INSPECT_ARENA_SOURCE, (event, input) =>
    trusted(event, () => service.inspectSource(safeInput(input))),
  );

  handleIpc(IPC.WORKSHOP_PLAN_ARENA, (event, input) =>
    trusted(event, () => service.planInstall(safeInput(input))),
  );

  handleIpc(IPC.WORKSHOP_APPLY_ARENA, (event, input) =>
    trusted(event, () => service.applyInstall(safeInput(input))),
  );

  handleIpc(IPC.WORKSHOP_REMOVE_ARENA, (event, input) =>
    trusted(event, () => service.removeInstall(safeInput(input))),
  );
}
