/*
 * Каналы FiveM resource: выбор папки resources, план, применение, откат,
 * открытие путей и папки проекта.
 *
 * Отдельный модуль по той же причине, что у установщика: `main.js` отвечает
 * за жизненный цикл окна, а не за раскладку архива по серверу. Единственное,
 * что остаётся в `main.js`, — флаги занятости операции: на них смотрит
 * обработчик закрытия окна, поэтому сюда они приходят готовым замком
 * `operationGate`, а не переезжают. Остальное модуль получает параметрами и
 * проверяется тестом, не поднимая Electron.
 */

import path from "node:path";
import {
  applyFiveMResource,
  planFiveMResource,
  resolveFiveMResourcePath,
  rollbackFiveMResource,
} from "./workshop-resource.js";
import { syncWorkshopProjectFolder } from "./workshop-project-folder.js";

export function registerWorkshopResourceIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  dialog,
  shell,
  userDataDir,
  onProgress,
  operationGate,
}) {
  const workshopStorage = () => {
    const root = path.join(userDataDir(), "workshop");
    return {
      backupRoot: path.join(root, "backups"),
      recordsRoot: path.join(root, "install-records"),
      projectsRoot: path.join(root, "projects"),
    };
  };

  /* Папка resources — только та, что человек выбрал в диалоге главного
     процесса: путь из окна — ввод, а не разрешение заменить папку
     `<любая папка>\<имя>` на диске (например, «Автозагрузку»). */
  const chosenRoots = new Set();
  const rootKey = (value) => {
    const resolved = path.resolve(String(value || ""));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const workshopArchiveInput = (input) => {
    const resourcesRoot = String(input?.resourcesRoot || "");
    if (!resourcesRoot || !chosenRoots.has(rootKey(resourcesRoot))) {
      throw new Error("Выберите папку resources FiveM заново.");
    }
    return {
      archive: input?.archive,
      resourceName: String(input?.resourceName || ""),
      resourcesRoot,
    };
  };

  handleIpc(IPC.WORKSHOP_CHOOSE_RESOURCE_ROOT, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Выберите папку resources вашего FiveM-сервера",
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Использовать эту папку",
      });
      if (result.canceled || !result.filePaths?.[0]) return null;
      chosenRoots.add(rootKey(result.filePaths[0]));
      return result.filePaths[0];
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_RESOURCE, (event, input) =>
    trusted(event, () => planFiveMResource(workshopArchiveInput(input))),
  );

  handleIpc(IPC.WORKSHOP_APPLY_RESOURCE, (event, input) =>
    trusted(event, async () => {
      if (operationGate.isBusy()) {
        throw new Error("Другая операция Мастерской уже выполняется.");
      }
      operationGate.begin();
      try {
        return await applyFiveMResource(workshopArchiveInput(input), {
          ...workshopStorage(),
          onProgress,
        });
      } finally {
        operationGate.end();
      }
    }),
  );

  handleIpc(IPC.WORKSHOP_ROLLBACK_RESOURCE, (event, input) =>
    trusted(event, async () => {
      if (operationGate.isBusy()) {
        throw new Error("Другая операция Мастерской уже выполняется.");
      }
      operationGate.begin();
      try {
        return await rollbackFiveMResource(
          { installId: String(input?.installId || "") },
          { ...workshopStorage(), onProgress },
        );
      } finally {
        operationGate.end();
      }
    }),
  );

  handleIpc(IPC.WORKSHOP_OPEN_PATH, (event, input) =>
    trusted(event, async () => {
      const target = await resolveFiveMResourcePath(safeInput(input), {
        recordsRoot: workshopStorage().recordsRoot,
      });
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return true;
    }),
  );

  handleIpc(IPC.WORKSHOP_OPEN_PROJECT_FOLDER, (event, input) =>
    trusted(event, async () => {
      const result = await syncWorkshopProjectFolder(
        {
          archive: input?.archive,
          projectId: String(input?.projectId || ""),
          projectName: String(input?.projectName || ""),
          target: String(input?.target || ""),
          moduleIds: Array.isArray(input?.moduleIds)
            ? input.moduleIds.map(String)
            : [],
          assetCount: Number(input?.assetCount || 0),
        },
        { projectsRoot: workshopStorage().projectsRoot },
      );
      const error = await shell.openPath(result.projectPath);
      if (error) throw new Error(error);
      return result;
    }),
  );
}
