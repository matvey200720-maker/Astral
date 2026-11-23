/*
 * Каналы набора инструментов.
 *
 * Отдельный модуль по той же причине, что у воды и растительности: `main.js`
 * отвечает за жизненный цикл окна, а не за то, какие поля принимает каждая
 * операция. Ни чтение состояния, ни поставка ничего не пишут в игру — проверки
 * запущенной GTA V здесь нет и не нужно.
 */

import { archiveSupportDirectory } from "./loader-provisioner.js";
import {
  provisionWorkshopTools,
  readWorkshopToolsStatus,
} from "./workshop-tools.js";

export function registerWorkshopToolsIpc({
  IPC,
  handleIpc,
  trusted,
  installOptions,
  shell,
}) {
  handleIpc(IPC.WORKSHOP_TOOLS_STATUS, (event) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readWorkshopToolsStatus({ stateDir: storage.stateDir });
    }),
  );

  handleIpc(IPC.WORKSHOP_TOOLS_PROVISION, (event) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return provisionWorkshopTools({ stateDir: storage.stateDir });
    }),
  );

  /* Путь не принимается, а вычисляется здесь же: «открой мне вот эту папку» из
     окна — это дыра, через которую окно открывает что угодно. Папка набора
     одна, и знает про неё main-процесс. */
  handleIpc(IPC.WORKSHOP_TOOLS_REVEAL, (event) =>
    trusted(event, async () => {
      const error = await shell.openPath(archiveSupportDirectory());
      if (error) throw new Error(error);
      return true;
    }),
  );
}
