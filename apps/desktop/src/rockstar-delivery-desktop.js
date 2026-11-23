/*
 * Доставка модов в копию из Rockstar Games Launcher в главном процессе
 * (задача 7): модуль `rockstar-delivery.js` с зависимостями Electron,
 * обёртка регистрации каналов и каналы окна. main.js остаётся оглавлением:
 * здесь всё, что нужно ему знать о способах доставки.
 *
 * У способа «Моды при запуске игры» архив с модами, пока игра закрыта, ждёт
 * рядом с игрой, а в игре — оригинал Rockstar. Пока Astral пишет в игру или
 * сверяет её файлы, архив с модами должен стоять на своём месте: обёртка
 * стоит на самой регистрации каналов (`handleIpc`), поэтому мимо неё запись
 * в игру не пройдёт ни из одного модуля.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { RETURN_BLOCKER_NAMES } from "@modovik/install-engine/rockstar-mode/environment.js";
import { createModeLog, modeLogFile } from "@modovik/install-engine/rockstar-mode/log.js";
import { addCustomInstallation, discoverGames, removeCustomInstallation } from "@modovik/game-discovery";
import { broadcastRockstarCopyProgress, broadcastRockstarDelivery } from "./broadcast.js";
import { runningProcessNames, runningProcesses } from "./game-processes.js";
import { runningElevated } from "./elevation.js";
import { createAgentManager } from "./rockstar-mode/agent-manager.js";
import { listAllProcesses, killProcessesByName } from "./rockstar-mode/process-tools.js";
import { GAME_PROCESS_NAMES } from "./rockstar-mode/process-watch.js";
import { agentCommand, createAgentStartup } from "./rockstar-mode/scheduler.js";
import { resolveNativeExecutable } from "./native-engine.js";
import { ROCKSTAR_WRITE_CHANNEL_KEYS, createRockstarDelivery } from "./rockstar-delivery.js";
import { registerRockstarDeliveryIpc } from "./rockstar-delivery-ipc.js";
import { GAME_WRITING_CHANNELS } from "./workshop-operations.js";

/**
 * `projectRoot` и `installOptions` — функции: main.js задаёт их ниже по
 * файлу, а модуль создаётся сразу после границы IPC. `{ delivery,
 * handleIpc, register }`.
 */
export function createDesktopRockstarDelivery({ app, IPC, findGame, handleIpc, projectRoot, installOptions }) {
  const nativeExecutable = () => {
    try {
      return resolveNativeExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, projectRoot: projectRoot() });
    } catch {
      return null;
    }
  };
  /* Журнал режима — один файл на окно и агента (`%LOCALAPPDATA%\Astral\rockstar-mode`). */
  const modeLog = createModeLog({ file: modeLogFile(), src: "window" });
  /* Фоновый агент: тот же Astral.exe с флагом; запуск при входе — задача планировщика. */
  const agent = createAgentManager({
    command: agentCommand({ execPath: process.execPath, packaged: app.isPackaged, appPath: app.isPackaged ? "" : app.getAppPath() }),
    startup: createAgentStartup(),
    log: (scope, code, data, detail) => modeLog.write(scope, code, data, detail),
  });
  /* Папка игры пишется без прав администратора? Проба — создать и убрать пустой файл. */
  const canWriteWithoutAdmin = async (gameRoot) => {
    const probe = path.join(gameRoot, "update", `.astral-probe-${process.pid}.tmp`);
    try {
      await fs.writeFile(probe, "");
      await fs.rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  };
  const delivery = createRockstarDelivery({
    stateDir: async () => (await installOptions()).stateDir,
    findGame,
    listGames: () => discoverGames(),
    gameRunning: async () => (await runningProcessNames(GAME_PROCESS_NAMES)).length > 0,
    /* Хозяин режима решает «вернуть файлы» по настоящей игре: застрявшая заглушка BattlEye возврат не держит. */
    gameStateTtlMs: 1500,
    realGameRunning: async () => (await runningProcessNames(["GTA5.exe", "GTA5_Enhanced.exe"])).length > 0,
    listGameProcesses: (names) => runningProcesses(names?.length ? names : GAME_PROCESS_NAMES),
    nativeExecutable,
    addCustomInstallation,
    removeCustomInstallation,
    broadcast: (event) => broadcastRockstarDelivery(event),
    agent,
    modeLog,
    listProcesses: () => listAllProcesses(),
    killProcesses: () => killProcessesByName(RETURN_BLOCKER_NAMES),
    canWriteWithoutAdmin,
    silentRegistration: () => runningElevated(),
  });
  const wrapped = delivery.wrapHandle(
    handleIpc,
    [...ROCKSTAR_WRITE_CHANNEL_KEYS, ...Object.keys(GAME_WRITING_CHANNELS)].map((key) => IPC[key]),
  );
  /* Подмена, прерванная выключением ПК, чинится в сторону оригинала Rockstar;
     дозор игры поднимается у копий со способом «Моды при запуске игры». */
  /* Фоновый агент (`--rockstar-agent`) чинит сам: окна у него нет, и подмена у него своя. */
  if (!process.argv.includes("--rockstar-agent")) app.whenReady().then(() => delivery.recover().catch(() => {}));
  app.on("before-quit", () => delivery.stop());
  return {
    delivery,
    agent,
    handleIpc: wrapped,
    register: ({ trusted, safeInput, dialog, operations }) =>
      registerRockstarDeliveryIpc({ IPC, handleIpc: wrapped, trusted, safeInput, delivery, dialog, sendProgress: broadcastRockstarCopyProgress, operations }),
  };
}
