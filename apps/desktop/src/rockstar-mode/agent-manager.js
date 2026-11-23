/*
 * Агент режима Rockstar глазами окна Astral (05.11.2026): включить запуск при
 * входе в Windows, поднять агента сейчас, спросить, жив ли он, остановить —
 * в том числе перед обновлением лаунчера, пока файлы `app\` заняты агентом.
 *
 * Агент — тот же `Astral.exe` с флагом, поэтому обновлению он мешает так же,
 * как окно: хелпер ждёт выхода процесса с pid окна, а процесс агента держит
 * `app\`. `stopForUpdate` просит агента выйти и ждёт выхода (с потолком); сам
 * агент файлы игры при выходе не трогает, новая копия примет сессию по
 * журналу.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { modeHome } from "@modovik/install-engine/rockstar-mode/log.js";
import { agentPipeName, askAgent } from "./agent-control.js";
import { readAgentHeartbeat, writeAgentConfig } from "./agent.js";
import { AGENT_FLAG } from "./scheduler.js";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {object} options
 * @param {{ exe: string, args: string[] }} options.command  как запускать агента
 * @param {ReturnType<typeof import("./scheduler.js").createAgentStartup>} options.startup
 */
export function createAgentManager({ command, startup, env = process.env, ask = askAgent, spawn = nodeSpawn, wait = sleep, log = async () => {} }) {
  const name = () => agentPipeName(env);
  const home = () => modeHome(env);

  const ping = () => ask({ cmd: "ping" }, { name: name() });

  async function waitFor(predicate, ms, step = 150) {
    for (let waited = 0; waited <= ms; waited += step) {
      if (await predicate()) return true;
      await wait(step);
    }
    return false;
  }

  /* Планировщик и реестр спрашиваются не чаще раза в полминуты: окно опрашивает состояние каждые пару секунд. */
  let startupCache = { at: 0, value: null };
  const STARTUP_TTL_MS = 30_000;

  /** Состояние агента для окна: жив ли, как запускается, свежее ли сердцебиение. */
  async function state({ fresh = false } = {}) {
    if (fresh || Date.now() - startupCache.at > STARTUP_TTL_MS) startupCache = { at: Date.now(), value: await startup.query({ exe: command.exe }) };
    const [answer, beat] = await Promise.all([ping(), readAgentHeartbeat(home())]);
    return { alive: Boolean(answer), pid: answer?.pid ?? beat.pid ?? null, heartbeat: beat.alive, status: beat.status || null, startup: startupCache.value };
  }

  /** Команда агенту (`arm-now`, `disarm-now`, `status`). Ответ `{ ok, … }` или `null`, если агента нет. */
  const sendCommand = (cmd) => ask({ cmd }, { name: name(), timeoutMs: 5000 });

  /** Сказать агенту, где настройки (папка состояния движка). */
  const publish = ({ stateDir }) => writeAgentConfig({ stateDir }, home());

  /**
   * Поднять агента, если его нет: через задачу планировщика (повышенный, без
   * UAC), иначе тем же процессом, что окно. `true` — агент ответил.
   */
  async function ensureRunning({ viaTask = true } = {}) {
    if (await ping()) return true;
    if (viaTask && (await startup.start())) {
      if (await waitFor(async () => Boolean(await ping()), 4000)) return true;
    }
    try {
      const child = spawn(command.exe, command.args, { detached: true, stdio: "ignore", windowsHide: true });
      child.on?.("error", () => {});
      child.unref?.();
    } catch (error) {
      await log("agent", "spawn-failed", null, error?.message || error);
      return false;
    }
    return waitFor(async () => Boolean(await ping()), 6000);
  }

  /** Попросить агента выйти и дождаться выхода. `true` — агента больше нет. */
  async function stop({ waitMs = 8000 } = {}) {
    if (!(await ping())) return true;
    await ask({ cmd: "stop" }, { name: name() });
    return waitFor(async () => !(await ping()), waitMs);
  }

  /**
   * Лаунчер собирается обновляться: агент выходит, пока хелпер меняет `app\`.
   * Ждёт не дольше `waitMs`; не вышел — обновление идёт дальше (хелпер сам
   * увидит занятые файлы и откатится), а в журнал уходит запись.
   */
  async function stopForUpdate({ waitMs = 8000 } = {}) {
    const gone = await stop({ waitMs });
    if (!gone) await log("agent", "stop-for-update-timeout", { waitMs });
    return gone;
  }

  /** Включить режим: настройки агента, запуск при входе, запуск сейчас. */
  async function enable({ stateDir, canRunUnelevated = false }) {
    await publish({ stateDir });
    const registered = await startup.register({ exe: command.exe, args: command.args, canRunUnelevated });
    startupCache = { at: 0, value: null };
    await log("agent", "startup-registered", { via: registered.via, elevated: registered.elevated, declined: Boolean(registered.declined) }, registered.error || "");
    const running = await ensureRunning({ viaTask: registered.via === "task" });
    return { ...registered, running };
  }

  /** Выключить режим: запуск при входе снят, агент остановлен. */
  async function disable() {
    const removed = await startup.unregister();
    startupCache = { at: 0, value: null };
    const stopped = await stop();
    await log("agent", "startup-removed", { task: removed.task, runKey: removed.runKey, stopped }, removed.error || "");
    return { ...removed, stopped };
  }

  return { state, publish, ensureRunning, stop, stopForUpdate, enable, disable, ping, sendCommand, flag: AGENT_FLAG };
}
