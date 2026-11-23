/*
 * Журнал падений игры: сборка из частей (ТЗ владельца 11.11.2026, docs/GAME-CRASH-LOG.md).
 *
 *   scan.js     — улики → падения (журнал Windows, журналы Majestic и RAGE MP, модули GTA V) + виновный мод;
 *   store.js    — не больше 10 падений на диске, метка последней проверки, «человеку уже показывали»;
 *   journal.js  — запись `kind: "game-crash"` в журнал приложения и текстовый отчёт;
 *   watch.js    — когда проверять (выход игры, старт лаунчера);
 *   ipc.js      — вкладка «Логи» (список, «Проверить сейчас», «Сохранить отчёт»).
 *
 * Только чтение чужих журналов и папки игры. Игру, Majestic и RAGE MP модуль не запускает.
 */
import { createCrashStore } from "./store.js";
import { scanGameCrashes, sizeLabel } from "./scan.js";
import { journalEntry, reportText } from "./journal.js";
import { startGameCrashWatch } from "./watch.js";
import { GAME_PROCESS_PATTERN } from "./wer.js";
import { runningProcessesMatching } from "../game-processes.js";

const GTA_PROCESS = /^(?:gta5(?:_enhanced|_be)?|playgtav)\.exe$/i;
const COMPANION = /^ragemp_/i;

/** Какие процессы игры и клиентов сейчас запущены (один `tasklist`). */
export async function defaultRunning() {
  const rows = await runningProcessesMatching(GAME_PROCESS_PATTERN);
  return { game: rows.filter((row) => GTA_PROCESS.test(row.name)), companions: rows.filter((row) => COMPANION.test(row.name)).map((row) => row.name) };
}

/**
 * Поднимает журнал падений. Зависимости главного процесса приходят параметрами: `installOptions()` — где лежит состояние
 * движка, `discoverGames()` — папки GTA V, `onNew(records)` — окно узнаёт о новых падениях.
 */
export function startGameCrashJournal({
  userData,
  appLog,
  appVersion = "",
  installOptions,
  discoverGames,
  onNew = () => {},
  running = defaultRunning,
  now = Date.now,
  env = process.env,
  timers = globalThis,
  watch = true,
  scan = scanGameCrashes,
} = {}) {
  const store = createCrashStore({ userData, now });

  /* Проверка одна за раз: частые нажатия «Проверить сейчас» и совпавший выход игры не запускают параллельные `wevtutil` и работников (`busy`). */
  let scanning = false;
  const quickExitsLogged = new Set();
  async function scanNow(request = {}) {
    if (scanning) return { records: store.list(), added: 0, problems: [], busy: true, windowsFailed: false };
    scanning = true;
    try {
      return await scanOnce(request);
    } finally {
      scanning = false;
    }
  }

  async function scanOnce({ sinceMs, via = "manual", companions = [] } = {}) {
    let stateDir = "";
    let gameRoots = [];
    try {
      stateDir = (await installOptions?.())?.stateDir || "";
    } catch {
      // состояние установки недоступно — мод не определится, падение всё равно запишется
    }
    try {
      gameRoots = ((await discoverGames?.()) || []).map((game) => game.path).filter(Boolean);
    } catch {
      // папки игры не нашлись — журналы модулей GTA V пропускаются
    }
    const result = await scan({ sinceMs, via, now, env, stateDir, gameRoots, companions });
    const fresh = [];
    for (const record of result.records) {
      const outcome = store.upsert(record);
      if (outcome.isNew) {
        fresh.push(outcome.record);
        appLog?.record?.(journalEntry(outcome.record));
      }
    }
    for (const quick of result.quickExits || []) {
      if (quickExitsLogged.has(quick.t)) continue;
      quickExitsLogged.add(quick.t);
      /* Время выхода — в самой строке: проверка при каждом старте лаунчера читает stub.log заново, и выход двухдневной давности без времени читался как свежий (17.11.2026). */
      const moment = new Date(quick.t).toISOString().slice(0, 16).replace("T", " ");
      const dumps = (quick.crashLogs || []).slice(0, 3).map((file) => `${file.name} (${sizeLabel(file.size)})`);
      appLog?.record?.({
        level: "warn",
        source: "game-crash",
        message: `Игра закрылась ${moment} UTC через ${quick.seconds} с после запуска из Rockstar Launcher (код выхода ${quick.code}), записи о падении в Windows нет: так выглядит окно ошибки самой игры (ERR_…) или закрытие человеком${dumps.length ? `. В папке CrashLogs игры за это время: ${dumps.join(", ")}` : ""}`,
      });
    }
    if (result.problems.length) appLog?.record?.({ level: "warn", source: "game-crash", message: `Журнал падений: ${result.problems.join("; ")}` });
    if (fresh.length) onNew(fresh);
    return { records: store.list(), added: fresh.length, problems: result.problems, busy: false, windowsFailed: result.windowsFailed === true };
  }

  appLog?.registerSource?.({
    id: "game-crashes",
    label: "Падения игры (отчёт)",
    read: () => reportText(store.list(), { appVersion, now: now() }),
  });

  const watcher = watch
    ? startGameCrashWatch({
        running,
        scan: (request) => scanNow(request),
        checkedAt: () => store.checkedAt,
        markChecked: (ms) => store.setCheckedAt(ms),
        now,
        timers,
        onProblem: (error) => appLog?.record?.({ level: "warn", source: "game-crash", message: `Журнал падений: ${String(error?.message || error).slice(0, 160)}` }),
      })
    : null;

  return {
    store,
    scanNow,
    nudge: () => watcher?.nudge(),
    list: () => store.list(),
    unnoticed: () => store.unnoticed(),
    markNoticed: (ids) => store.markNoticed(ids),
    report: (id) => reportText(id ? store.list().filter((record) => record.id === id) : store.list(), { appVersion, now: now() }),
    stop: () => watcher?.stop(),
  };
}
