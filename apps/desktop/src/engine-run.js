/*
 * Один запуск команды движка с запросом из файла (14.11.2026, работа «Astral быстрее»): `roads-build`, `rpf-listing`.
 *
 * Эти команды идут мимо резидентного движка и общей очереди (`native-engine.js`): они долгие, зовутся из задачи сборки (свой поток или
 * процесс, `build-process.js`) и ответ у них большой. Ход — строки `{"progress":…}` в stderr, ответ — один JSON в stdout.
 *
 * Движок отменяется только словом в stdin, поэтому номер его процесса отдаётся наверх (`onSpawn`): кто снимает задачу целиком, снимает и его.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lowerBackgroundPriority } from "./child-priority.js";

/**
 * Потоков движка на тяжёлую сборку. Половина логических процессоров, как у потоков JS (`buildWorkerCount`: «комфортно даже на слабых
 * ПК»), а на машине покрепче — все, кроме четырёх, но не больше двенадцати: движок идёт с приоритетом ниже обычного (`background`), и
 * окну, игре и браузеру процессор достаётся первым. На 8 потоках — 4, как и было; на 12 — 8; на 16 — 12 (замер 14.11.2026 на 16 потоках:
 * сборка словарей дорог в движке 43 с на шести потоках, 33 с на двенадцати). `envName` — переменная окружения со своим числом.
 */
export function engineBuildThreads({ env = process.env, cores = null, envName = "" } = {}) {
  const forced = Number.parseInt((envName && env[envName]) ?? "", 10);
  if (Number.isInteger(forced) && forced >= 1) return Math.min(forced, 32);
  const available = cores ?? os.availableParallelism();
  return Math.max(1, Math.min(12, Math.max(Math.floor(available / 2), available - 4)));
}

const abortError = (signal) => (signal?.reason instanceof Error ? signal.reason : Object.assign(new Error("Отменено."), { name: "AbortError" }));

/**
 * Запустить `executable argv…` и дождаться ответа: `result` из `{ ok: true, result }`. Отказ движка, ненулевой код и оборванный ответ —
 * ошибка со словами движка. `onProgress({ phase, done, total })` — ход, `onSpawn(pid)` — номер процесса при запуске и `onSpawn(0)`, когда процесс вышел (ответом, отказом или снят):
 * на освободившемся номере мог поселиться чужой процесс, и хозяин, что снимает сборку целиком по номеру, снял бы его. `signal` — отмена (процесс снимается).
 * `background` — приоритет процесса ниже обычного: долгая сборка занимает много потоков, а окну, игре и браузеру человека процессор
 * достаётся первым; ввод-вывод процесса при этом фоновый (`lowerBackgroundPriority`, `child-priority.js`).
 */
export function runEngineCommand(executable, argv, { onProgress = null, onSpawn = null, signal = null, background = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const child = spawn(executable, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let running = false;
    const exited = () => {
      if (!running) return;
      running = false;
      onSpawn?.(0);
    };
    if (child.pid) {
      running = true;
      onSpawn?.(child.pid);
    }
    /* И процессор, и ввод-вывод (18.11.2026): сборка читает архивы игры и пишет гигабайты готовых файлов. Приоритет не сменился — сборка идёт с обычным. */
    if (child.pid && background) lowerBackgroundPriority(child);
    const out = [];
    let tail = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => {
      tail += chunk.toString("utf8");
      const lines = tail.split(/\r?\n/);
      tail = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('{"progress"')) {
          stderr = `${stderr}${line}\n`.slice(-4096);
          continue;
        }
        try {
          const { progress } = JSON.parse(line);
          if (progress) onProgress?.({ phase: progress.phase, done: progress.copiedBytes, total: progress.totalBytes });
        } catch {
          /* оборванная строка хода — не ход */
        }
      }
    });
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      exited();
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      exited();
      if (signal?.aborted) return reject(abortError(signal));
      /* Ответ — один JSON; у части команд (`index-archive`) перед ним идут служебные строки: тогда берётся последняя строка-объект. */
      const text = Buffer.concat(out).toString("utf8");
      let answer = null;
      try {
        answer = JSON.parse(text);
      } catch {
        try {
          const lines = text.trim().split(/\r?\n/);
          answer = JSON.parse(lines.findLast((line) => line.startsWith("{")) ?? "");
        } catch {
          answer = null;
        }
      }
      if (code === 0 && answer?.ok === true && answer.result) return resolve(answer.result);
      reject(new Error(answer?.error?.message || stderr.trim() || `Движок вышел с кодом ${code}.`));
    });
  });
}

/**
 * Корень рабочих папок движка одной сборки — его назначает хозяин сборки (`roads-build-host.js`, `vegetation-build-host.js`), и путь идёт потоку в `workerData`.
 * Снятый поток до своего `finally` не доходит, и убрать за ним нечем, если не знать, где оно лежит.
 */
export const engineScratchRoot = (label) => path.join(os.tmpdir(), `astral-${label}-${randomUUID()}`);

/** Рабочая папка одного запуска движка: внутри корня хозяина (`parent`), без него — прямо во временной папке. */
export async function engineScratchDirectory(prefix, parent = "") {
  if (!parent) return fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, prefix));
}

/**
 * Убрать рабочую папку (корень хозяина). Процесс движка снят только что и мог ещё не отпустить файлы — Windows отказывает в удалении, пока он их держит, поэтому с
 * повторами. Сбой уборки сборку не роняет.
 */
export const removeEngineScratch = (directory) => fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(() => {});
