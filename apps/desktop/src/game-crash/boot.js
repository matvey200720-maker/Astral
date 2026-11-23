/*
 * Запуск журнала падений игры из главного процесса одной строкой (`main.js` держит бюджет строк).
 * Журнал поднимается после первого окна; о новом падении окно узнаёт событием `GAME_CRASH_EVENT`.
 */
import { broadcastGameCrash } from "../broadcast.js";
import { onGameRunning } from "../hibernation-hooks.js";
import { releaseVersionFor } from "../updates/display-version.js";
import { startGameCrashJournal } from "./index.js";
import { setGameCrashJournal } from "./ipc.js";

export function bootGameCrashJournal({ app, appLog, discoverGames, installOptions }) {
  try {
    const journal = startGameCrashJournal({
      userData: app.getPath("userData"),
      appLog,
      /* Номер выпуска из манифеста (0.9.0-beta.N), а не 1.0.1 из package.json: он идёт в «Версия Astral» отчёта о падениях. */
      appVersion: releaseVersionFor(app.getPath("exe"), app.getVersion()),
      installOptions,
      discoverGames,
      onNew: (records) => broadcastGameCrash({ ids: records.map((record) => record.id) }),
    });
    setGameCrashJournal(journal);
    /* Окно вернулось в фокус или спячка нашла игру — опрос процессов не ждёт своего срока. */
    onGameRunning(() => journal.nudge());
    app.on("browser-window-focus", () => journal.nudge());
    app.on("before-quit", () => journal.stop());
    return journal;
  } catch (error) {
    appLog.record({ level: "warn", source: "game-crash", message: `Журнал падений не запущен: ${error?.message || error}` });
    return null;
  }
}
