/*
 * Фоновый агент режима Rockstar (05.11.2026): `Astral.exe --rockstar-agent`.
 *
 * Запускается задачей планировщика при входе в Windows (`scheduler.js`) или
 * окном Astral при включении режима. Окна и интерфейса у него нет — это
 * главный процесс Electron без `BrowserWindow`; `main.js` отдаёт ему управление
 * в самом начале запуска, ДО запроса прав администратора, замка единственного
 * экземпляра, беты и окна: агент не зовёт UAC при каждом входе в систему.
 *
 * Что делает:
 *   — занимает канал управления (он же замок единственного экземпляра);
 *   — при старте чинит последствия сбоя (выключили ПК посреди сессии): это
 *     происходит при входе в систему, окно Astral открывать не нужно;
 *   — следит за процессами игры (нативный хост, 50 мс) и подставляет моды в
 *     момент запуска, возвращает чистые файлы после выхода (`host.js`);
 *   — пишет сердцебиение (`agent.json`) и журнал режима;
 *   — выходит, когда ни у одной игры нет способа с агентом («Автоматически»):
 *     у ручного способа агента нет, им занимается окно (14.11.2026).
 *
 * Где лежат настройки, он узнаёт из `agent-config.json` в папке режима: окно
 * записывает туда папку состояния движка (`stateDir`) при включении и при
 * каждом своём старте — агент не поднимает хранилище и не знает про окно.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createModeLog, modeHome, modeLogFile } from "@modovik/install-engine/rockstar-mode/log.js";
import { createModeSession } from "@modovik/install-engine/rockstar-mode/session.js";
import { RETURN_BLOCKER_NAMES } from "@modovik/install-engine/rockstar-mode/environment.js";
import { askAgent, agentPipeName, serveAgentControl } from "./agent-control.js";
import { createModeHost } from "./host.js";
import { agentRoots, enabledRoots, readDeliverySettings } from "./settings.js";
import { swapRelsOf } from "./originals.js";
import { createProcessWatcher, watchNamesFor } from "./process-watch.js";
import { killProcessesByName, listAllProcesses, listNamedProcesses } from "./process-tools.js";

export const AGENT_CONFIG_FILE = "agent-config.json";
export const AGENT_HEARTBEAT_FILE = "agent.json";
/* Агент живым считается, если сердцебиение моложе этого. */
export const HEARTBEAT_FRESH_MS = 60_000;
const NOT_STUB = ["GTA5.exe", "GTA5_Enhanced.exe"];

const atomicWrite = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stage = `${file}.${process.pid}.stage`;
  await fs.writeFile(stage, JSON.stringify(value, null, 2));
  await fs.rename(stage, file);
};

/** Настройки агента: `{ stateDir }` или `null`. */
export async function readAgentConfig(home = modeHome()) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(home, AGENT_CONFIG_FILE), "utf8"));
    return value && typeof value.stateDir === "string" && value.stateDir ? value : null;
  } catch {
    return null;
  }
}

/** Окно говорит агенту, где настройки. Пишется только при изменении. */
export async function writeAgentConfig(config, home = modeHome()) {
  const before = await readAgentConfig(home);
  if (before?.stateDir === config.stateDir) return false;
  await atomicWrite(path.join(home, AGENT_CONFIG_FILE), { version: 1, ...config });
  return true;
}

/** Сердцебиение агента: `{ alive, pid, status, ... }`; `alive` — запись свежая и процесс жив. */
export async function readAgentHeartbeat(home = modeHome(), { now = Date.now, alive = defaultAlive } = {}) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(home, AGENT_HEARTBEAT_FILE), "utf8"));
    const fresh = now() - Date.parse(value.at || 0) < HEARTBEAT_FRESH_MS;
    return { ...value, alive: Boolean(fresh && Number.isInteger(value.pid) && alive(value.pid)) };
  } catch {
    return { alive: false };
  }
}

function defaultAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Запустить агента внутри этого процесса. Возвращает после запуска (процесс
 * живёт дальше за счёт канала и дозора). `{ exitReason }` — сразу, если
 * запуск не нужен (агент уже есть).
 *
 * @param {object} options
 * @param {{ exit: (code: number) => void, on: Function, isPackaged: boolean }} options.app
 * @param {() => string | null} [options.nativeExecutable]
 */
export async function runRockstarAgent({
  app,
  nativeExecutable = () => null,
  env = process.env,
  version = "",
  exe = process.execPath,
  /* Источники процессов (подменяются в тестах): все процессы, процессы по именам, закрытие по именам. */
  processes = { listAll: listAllProcesses, listNamed: listNamedProcesses, kill: killProcessesByName },
} = {}) {
  const home = modeHome(env);
  const log = createModeLog({ file: modeLogFile(env), src: "agent" });
  const write = (...args) => log.write(...args);
  let control;
  try {
    control = await serveAgentControl({
      name: agentPipeName(env),
      handle: async (command) => handleCommand(command),
    });
  } catch (error) {
    if (error?.code === "EADDRINUSE" && (await askAgent({ cmd: "ping" }, { name: agentPipeName(env) }))) {
      await write("agent", "second-instance", { pid: process.pid });
      app.exit(0);
      return { exitReason: "already-running" };
    }
    await write("agent", "control-failed", null, error?.message || error);
    app.exit(1);
    return { exitReason: "control-failed" };
  }

  const stateDir = async () => (await readAgentConfig(home))?.stateDir || null;
  const roots = async () => {
    const dir = await stateDir();
    return dir ? enabledRoots(await readDeliverySettings(dir)) : [];
  };
  /* Агенту нужны только игры со способом «Автоматически»; ручные ведёт окно (или тот же агент, пока он жив по другой игре). */
  const hasWork = async () => agentRoots(await roots()).length > 0;
  const sessions = new Map();
  const sessionFor = (gameRoot, method) => {
    const key = `${gameRoot}|${method}`;
    if (!sessions.has(key)) {
      sessions.set(
        key,
        createModeSession({
          gameRoot,
          listRels: async () => swapRelsOf(await stateDir(), gameRoot),
          listProcesses: () => processes.listAll(),
          log: write,
        }),
      );
    }
    return sessions.get(key);
  };

  const startedAt = new Date().toISOString();
  const heartbeat = async ({ status, armed }) => atomicWrite(path.join(home, AGENT_HEARTBEAT_FILE), { pid: process.pid, status, armed, at: new Date().toISOString(), startedAt, version, exe }).catch(() => {});
  const host = createModeHost({
    roots,
    sessionFor,
    gameAlive: async () => (await processes.listNamed(NOT_STUB)).length > 0,
    log: write,
    emit: () => {},
    heartbeat,
    killBlockers: () => processes.kill(RETURN_BLOCKER_NAMES),
  });
  const watcher = createProcessWatcher({
    names: watchNamesFor(await roots()),
    nativeExecutable,
    listRunning: (names) => processes.listNamed(names),
    onStart: (info) => void host.onGameStart(info),
    onExit: (info) => void host.onGameExit(info),
    onKind: (kind) => void write("agent", "watcher", { kind }),
  });

  async function shutdown(reason) {
    watcher.stop();
    host.stop();
    await write("agent", "stopped", { reason });
    await control.close().catch(() => {});
    await fs.rm(path.join(home, AGENT_HEARTBEAT_FILE), { force: true }).catch(() => {});
    app.exit(0);
  }

  async function handleCommand(command) {
    switch (command?.cmd) {
      case "ping":
        return { pid: process.pid, startedAt };
      case "status":
        return { pid: process.pid, startedAt, watcher: watcher.kind(), ...host.status() };
      case "stop":
        /* Ответ уходит до выхода; файлы игры агент не трогает: новая копия примет сессию по журналу. */
        setTimeout(() => void shutdown("stop-command"), 50);
        return { stopping: true };
      case "arm-now":
        return host.armNow();
      case "disarm-now":
        await host.disarmNow();
        return {};
      default:
        throw Object.assign(new Error("unknown-command"), { code: "unknown-command" });
    }
  }

  if (!(await hasWork())) {
    await write("agent", "nothing-to-do", { pid: process.pid });
    await shutdown("no-roots");
    return { exitReason: "no-roots" };
  }
  await write("agent", "started", { pid: process.pid, exe, version });
  await host.start();
  watcher.start();
  /* Режим выключили везде (или все игры перешли на ручной способ) — агент не висит впустую; список имён дозора следует за играми. */
  let empty = 0;
  setInterval(async () => {
    const now = await roots();
    empty = agentRoots(now).length ? 0 : empty + 1;
    watcher.setNames(watchNamesFor(now));
    if (empty >= 2) await shutdown("mode-off");
  }, 10_000).unref?.();
  app.on?.("before-quit", () => {
    watcher.stop();
    host.stop();
  });
  return { exitReason: null, host, watcher };
}
