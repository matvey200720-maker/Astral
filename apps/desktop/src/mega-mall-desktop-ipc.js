/*
 * Настольная обвязка редактора мега-молла.
 *
 * `mega-mall-editor-ipc.js` регистрирует каналы, но требует собранные
 * адаптер установки и поставщик геометрии зданий. Раньше их собирал
 * `main.js` — а он отвечает за жизненный цикл окна, а не за то, из каких
 * хелперов складывается превью молла. Сборка переезжает сюда целиком: модуль
 * знает про rpf-хелперы и нативный движок, а от `main.js` получает только
 * то, что живёт у него, — хранилище, диалоги и проверенный поиск игры.
 */

import { registerMegaMallEditorIpc } from "./mega-mall-editor-ipc.js";
import { createMegaMallInstallAdapter } from "./mega-mall-install-adapter.js";
import { createMegaMallBuildingModelProvider } from "./mega-mall-building-model.js";
import { createMegaMallSectionProvider } from "./mega-mall-section-model.js";
import { extractRpfEntries, runStreetLightRpfHelper } from "./rpf-composer.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { assertInstallRuntimeSafe } from "./install-safety.js";
import { callNativeEngine } from "./native-engine.js";
import { compileWithGameDonor } from "./game-donor.js";
import { appLog } from "./app-log.js";
import { discoverGames } from "@modovik/game-discovery";

export function registerMegaMallDesktopIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  desktopStorage,
  dialog,
  fs,
  findGame,
  nativeContext,
}) {
  registerMegaMallEditorIpc({
    IPC,
    handleIpc,
    trusted,
    safeInput,
    desktopStorage,
    dialog,
    fs,
    installAdapter: createMegaMallInstallAdapter({
      storageOptions: () => desktopStorage().installOptions(),
      findGame,
      assertRuntimeSafe: assertInstallRuntimeSafe,
      /* Донор из игры добавляет `compileWithGameDonor`, как у плашки эмблемы. Выключатель выключен — запрос уходит как был. */
      compileOverlay: async (input) => {
        const { stateDir } = await desktopStorage().installOptions();
        return compileWithGameDonor("compile-mega-mall-overlay", input, {
          stateDir,
          context: nativeContext(),
          call: callNativeEngine,
          provision: provisionArchiveSupport,
          log: (entry) => appLog.record(entry),
        });
      },
    }),
    createBuildingModels: ({ cacheRoot }) =>
      createMegaMallBuildingModelProvider({
        cacheRoot,
        /* Превью открывают из мастерской, где установка ещё не выбрана, и
           `findGame` без id бросает исключение. Для чтения геометрии подойдёт
           любая найденная копия игры — берём первую. */
        findGame: async (targetId) =>
          targetId
            ? findGame(targetId)
            : (await discoverGames()).find((game) => game?.path) || null,
        extractEntries: extractRpfEntries,
        convertModel: (input) =>
          callNativeEngine("convert-model", input, nativeContext()),
        /* Пакетная конвертация: словари текстур хост читает один раз на всю
           партию, а не заново на каждую модель. Комната интерьера — восемь
           моделей с одним словарём, и это разница в 5,5 раза на конвертации. */
        convertModels: (input) =>
          callNativeEngine("convert-models", input, nativeContext()),
        /* Фрагменты знают, где у них лампы: читаем LightAttributes тем же
           хелпером, что и редактор фонарей. */
        inspectLights: async ({ inputFile, gameRoot }) => {
          const result = await runStreetLightRpfHelper({
            mode: "lamp-inspect",
            gameRoot,
            edition: "Legacy",
            inputFile,
          });
          return result?.inventory || null;
        },
      }),
    /* Секция карты целиком — Davis Mega Mall со всеми деталями и
       LOD-подменами. Листает зашифрованные архивы нативный хост, и ключи
       ему нужны явно (в Steam-сборке он их сам не находит); распаковка
       идёт через rpf-хелпер с его проверенной связкой ключей. */
    createSectionModels: ({ cacheRoot, stateDir }) => {
      /* Набор ключей проверяется один раз на провайдер, а не на каждый
         листинг: индекс пропов листает два десятка архивов подряд, и сверка
         52 МБ ArchiveFix перед каждым съедала секунды впустую. */
      let support = null;
      const archiveSupport = () => {
        if (!support) {
          support = provisionArchiveSupport({ stateDir });
          support.catch(() => {
            support = null;
          });
        }
        return support;
      };
      return createMegaMallSectionProvider({
        cacheRoot,
        findGame: async (targetId) =>
          targetId
            ? findGame(targetId)
            : (await discoverGames()).find((game) => game?.path) || null,
        extractEntries: extractRpfEntries,
        listEntries: async (input) => {
          const { directory } = await archiveSupport();
          return callNativeEngine(
            "list-archive-entries",
            { ...input, keys: directory },
            nativeContext(),
          );
        },
        inspectMapFiles: (input) =>
          callNativeEngine("inspect-map-files", input, nativeContext()),
        convertScene: (input) =>
          callNativeEngine("convert-scene", input, nativeContext()),
      });
    },
  });
}
