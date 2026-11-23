/*
 * Процессы для режима Rockstar (05.11.2026): список всех процессов (снимок
 * `tasklist`) и закрытие процессов Rockstar перед возвратом файлов (способ
 * «как ReplaceX»).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runningProcessesMatching, runningProcesses } from "../game-processes.js";

const execFileAsync = promisify(execFile);

/** Все процессы: `[{ name, pid }]`. */
export const listAllProcesses = (options) => runningProcessesMatching(/./, options);

/** Какие из имён запущены: `[{ name, pid }]`. */
export const listNamedProcesses = (names, options) => runningProcesses(names, options);

/**
 * Закрыть процессы по именам (`taskkill /F /T`), кроме самого Astral.
 * Возвращает, сколько закрыто. Ошибки процессов, что уже вышли, — не ошибки.
 */
export async function killProcessesByName(names, { run = execFileAsync, self = process.pid, list = listNamedProcesses } = {}) {
  let killed = 0;
  for (const item of await list(names)) {
    if (!item.pid || item.pid === self) continue;
    try {
      await run("taskkill.exe", ["/F", "/T", "/PID", String(item.pid)], { windowsHide: true });
      killed += 1;
    } catch {
      /* уже вышел или защищён */
    }
  }
  return killed;
}
