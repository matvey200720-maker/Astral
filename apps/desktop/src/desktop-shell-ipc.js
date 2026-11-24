/*
 * Бытовые мосты рабочего стола: поиск и выбор установки GTA V, выбор
 * распакованного пакета, буфер обмена и внешние ссылки.
 *
 * Отдельный модуль по той же причине, что у хранилища: `main.js` отвечает за
 * жизненный цикл окна, а не за системные диалоги и переходы наружу. Канал
 * OPEN_APPS_SETTINGS остаётся в `main.js` — вместе с остальными явными
 * windows-мостами его стережёт тест на исходник. Диалоги, shell и буфер
 * приходят параметрами: модуль не импортирует Electron и проверяется тестом
 * без него.
 */

import { addCustomInstallation, discoverGames } from "@modovik/game-discovery";
import { appLog } from "./app-log.js";
import { openUrl } from "./elevation.js";
import { noteGameFiles } from "./game-files-facts.js";

export function registerDesktopShellIpc({
  IPC,
  handleIpc,
  trusted,
  dialog,
  shell,
  clipboard,
  markGames = async (games) => games,
}) {
  /* «Искать снова» нажимает человек, который только что поставил или
     перенёс игру: ответ из памяти реестра тут был бы враньём. */
  handleIpc(IPC.DETECT_GAMES, (event) =>
    trusted(event, async () => {
      const games = await discoverGames({ fresh: true });
      /* Версия игры и размер update.rpf — в «Логи», один раз на папку
         (`game-files-facts.js`); ответ окну не ждёт. */
      void noteGameFiles(games, (entry) => appLog.record(entry)).catch(() => {});
      /* `loadersNeeded` для панели «Игра» (`loaders-on-demand.js`): нет — игры отдаются как есть. */
      return await markGames(games).catch(() => games);
    }),
  );

  handleIpc(IPC.CHOOSE_GAME, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Выберите папку GTA V",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      return addCustomInstallation(result.filePaths[0], "Rockstar");
    }),
  );

  handleIpc(IPC.CHOOSE_PACKAGE, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Выберите распакованный пакет Astral",
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    }),
  );

  handleIpc(IPC.COPY_TEXT, (event, value) =>
    trusted(event, () => {
      clipboard.writeText(String(value || ""));
      return true;
    }),
  );

  handleIpc(IPC.OPEN_EXTERNAL, (event, value) =>
    trusted(event, () => {
      const target = new URL(value);
      if (!["http:", "https:"].includes(target.protocol)) {
        throw new Error("Unsupported URL");
      }
      return openUrl(shell, target.toString());
    }),
  );

  /* Системное удаление приложения — из той же семьи, что «открыть ссылку» и
     «скопировать текст»: Astral передаёт человека операционной системе и
     дальше в это не вмешивается. В `main.js` этот обработчик оставался
     последним написанным вручную. */
  handleIpc(IPC.OPEN_APPS_SETTINGS, (event) =>
    trusted(event, () => {
      if (process.platform !== "win32") {
        throw new Error("System app removal is only available on Windows");
      }
      return shell.openExternal("ms-settings:appsfeatures");
    }),
  );
}
