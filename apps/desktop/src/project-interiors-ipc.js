/*
 * Каналы «Интерьеров проектов» (ТЗ 17.10.2026, вечер, задача 10): источники
 * игрока, каталог интерьеров проекта.
 *
 * Только чтение: источники — папки игрока, из которых ничего не копируется и
 * в которые ничего не пишется. Регистрация принимает всё, что ей нужно,
 * параметрами — так её можно проверить тестом, не поднимая Electron.
 */

import { addProjectSource, readProjectState, removeProjectSource } from "./project-interiors/actions.js";
import { cancelFetch, fetchPack, readCdnState, removeFetched } from "./project-interiors/cdn.js";
import { createGameReader } from "./game-read-host.js";

export function registerProjectInteriorsIpc({ IPC, handleIpc, trusted, safeInput, installOptions, dialog, catalogPackages = null }) {
  const stateDirOf = async () => (await installOptions()).stateDir;

  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_STATE, (event, input) =>
    trusted(event, async () => readProjectState(safeInput(input), await stateDirOf())),
  );

  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_ADD_SOURCE, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const gameRoot = String(value?.gameRoot || "");
      return addProjectSource(value, await stateDirOf(), {
        gameRoot,
        chooseFolder: async (project) => {
          const result = await dialog.showOpenDialog({
            title: project === "majestic" ? "Выберите папку с интерьерами Majestic" : "Выберите папку с интерьерами GTA 5 РП",
            properties: ["openDirectory"],
          });
          return result.canceled ? null : result.filePaths[0];
        },
      });
    }),
  );

  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_REMOVE_SOURCE, (event, input) =>
    trusted(event, async () => removeProjectSource(safeInput(input), await stateDirOf())),
  );

  /* Каталог проекта: обход папок и паков, разбор типов и карт — в потоке читателя, а не в главном процессе (правило 6 `docs/3D.md`;
     26.10.2026: сканирование двенадцати паков Majestic шло в главном процессе и держало окно на «Читаем интерьеры…»). */
  const readCatalogOffThread = createGameReader(new URL("./project-interiors/catalog.js", import.meta.url).href, "readCatalog", null, {
    argsOf: (request, context, stateDir) => [request, stateDir],
    toolsAt: 2,
  });
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_CATALOG, (event, input) =>
    trusted(event, async () => readCatalogOffThread(safeInput(input), await stateDirOf())),
  );

  /* Кадр интерьера: сцена из файлов игрока и листы к ней. Только чтение —
     в своём потоке с пределом памяти, как сцена «Магазинов» (она росла в
     главном процессе на гигабайт в секунду, 18.10). */
  const readProjectScene = createGameReader(new URL("./project-interiors/scene.js", import.meta.url).href, "readProjectScene", null, {
    argsOf: (request, context, stateDir) => [request, stateDir],
    toolsAt: 2,
  });
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_SCENE, (event, input) =>
    trusted(event, async () => readProjectScene(safeInput(input), await stateDirOf())),
  );

  /* Листы интерьера: архивы игры и словари читаются и разбираются в потоке читателя, ответ — WebP (байты переносятся). */
  const readProjectSheetsOffThread = createGameReader(new URL("./project-interiors/sheets.js", import.meta.url).href, "readProjectSheets", null, {
    argsOf: (request, context, stateDir) => [request, stateDir],
    toolsAt: 2,
  });
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_SHEETS, (event, input) =>
    trusted(event, async () => readProjectSheetsOffThread(safeInput(input), await stateDirOf())),
  );

  /*
   * Пакеты интерьеров с CDN Astral (решение владельца 17.10.2026, вечер): окно
   * называет проект и пак и присылает манифест с адресом из гранта облака;
   * подпись, хосты и sha256 файлов проверяет скачивание, путь выбирает
   * главный процесс (`project-interiors/cdn.js`).
   */
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_STATE, (event, input) =>
    trusted(event, async () => readCdnState(safeInput(input), await stateDirOf())),
  );
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_FETCH, (event, input) =>
    trusted(event, async () => {
      if (!catalogPackages) throw new Error("Каталог недоступен в этой сборке.");
      const trust = catalogPackages();
      return fetchPack(safeInput(input), await stateDirOf(), {
        publicKey: await trust.publicKey(),
        allowedHosts: trust.allowedHosts,
        allowInsecureLocalhost: trust.allowInsecureLocalhost,
      });
    }),
  );
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_CANCEL, (event, input) => trusted(event, async () => cancelFetch(safeInput(input))));
  handleIpc(IPC.WORKSHOP_PROJECT_INTERIORS_CDN_REMOVE, (event, input) =>
    trusted(event, async () => removeFetched(safeInput(input), await stateDirOf())),
  );
}
