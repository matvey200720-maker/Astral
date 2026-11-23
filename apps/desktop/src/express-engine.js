/*
 * Мост экспресс-установки своего dlc (16.11.2026, работа «Astral быстрее»): функция
 * `engine(command, request, { signal, args, onProgress })`, которую ждёт `packages/install-engine/express-dlc.js`.
 *
 * Один запуск движка на команду, запрос — файлом (`--request`), ответ — один JSON в stdout, ход — строки
 * `{"progress":…}` в stderr. Команды: `layout-rpf-plan`, `build-rpf-dlc`, `seal-rpf-dlc`, `verify-rpf-dlc`,
 * `release-rpf-dlc`, `cancel-rpf-dlc`, `compose-rpf` (дозапись со слоем), `switch-rpf-layers`, `settle-rpf-journals`.
 *
 * Чем отличается от общего моста (`native-engine.js`):
 *   - выключатели движка `ASTRAL_ENGINE_NEWDLC`, `ASTRAL_ENGINE_APPEND`, `ASTRAL_ENGINE_LAYERS` ставятся словом модуля
 *     только этому процессу: у остальных установок всё по-прежнему;
 *   - отмена — слово `cancel` в stdin движка: он сам убирает недостроенное (`onCancel: "remove"`). Процесс снимается,
 *     только если не вышел за `cancelGraceMs`;
 *   - короткие команды (план, сверка длины, дозапись на килобайты, смена слоя, разбор журналов) идут в обычном
 *     приоритете: иначе они ждут за чужой записью на диске (замер сильного ПК 15.11: дозапись 79 КБ — 67 с в фоне).
 *
 * Нигде не зовётся, пока вызывающий не включит экспресс-путь (`ASTRAL_ENGINE_EXPRESS_DLC=<модули>`, по умолчанию выключен).
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { lowerBackgroundPriority } from "./child-priority.js";

export const EXPRESS_CANCEL_GRACE_MS = 8000;

/** Долгие команды экспресс-пути: пишут или читают архив целиком. Приоритет процесса ниже обычного, пока «Быстрая установка» выключена. */
export const EXPRESS_BACKGROUND_COMMANDS = Object.freeze(new Set(["build-rpf-dlc", "seal-rpf-dlc", "verify-rpf-dlc", "release-rpf-dlc"]));

/** Команды, что пишут архив на диск: к ним идёт потолок записи из «Хранилища». */
export const EXPRESS_WRITE_LIMITED_COMMANDS = Object.freeze(new Set(["build-rpf-dlc", "seal-rpf-dlc"]));

const abortError = (signal) => {
  const error = new Error("Express dlc: cancelled.");
  error.name = "AbortError";
  error.code = "CANCELLED";
  if (signal?.reason !== undefined) error.reason = signal.reason;
  return error;
};

/**
 * Окружение процесса движка для экспресс-установки модуля `moduleName`. «Быстрая установка» снимает фоновый приоритет
 * ввода-вывода целиком; без неё в фоне остаются только длинные записи.
 */
export function expressEngineEnvironment(moduleName, { env = process.env, fastInstall = false } = {}) {
  const word = String(moduleName ?? "").trim();
  if (!word) throw new Error("Экспресс-установка: не названо слово модуля.");
  const next = { ...env, ASTRAL_ENGINE_NEWDLC: word, ASTRAL_ENGINE_APPEND: word, ASTRAL_ENGINE_LAYERS: word, ASTRAL_ENGINE_NG: "native" };
  delete next.ASTRAL_ENGINE_BACKGROUND_IO;
  delete next.ASTRAL_ENGINE_SMALL_WRITES_FOREGROUND;
  if (fastInstall) next.ASTRAL_ENGINE_BACKGROUND_IO = "0";
  else next.ASTRAL_ENGINE_SMALL_WRITES_FOREGROUND = "1";
  return next;
}

/** Аргументы запуска команды: запрос, ключи, корень игры, корень точек отката, потолок записи, свои `args`. */
export function expressEngineArguments(command, requestFile, { keysDirectory, gameRoot, pointsRoot, writeLimitMbps = null, args = [] } = {}) {
  const argv = [command, "--request", requestFile];
  if (keysDirectory) argv.push("--keys", keysDirectory);
  if (gameRoot) argv.push("--game-root", gameRoot);
  if (pointsRoot) argv.push("--restore-points-root", pointsRoot);
  if (EXPRESS_WRITE_LIMITED_COMMANDS.has(command) && Number.isFinite(writeLimitMbps) && writeLimitMbps > 0)
    argv.push("--write-limit-mbps", String(writeLimitMbps));
  return [...argv, ...args];
}

/* Последняя строка stdout, похожая на JSON: движок отвечает одним объектом, но перед ним может оказаться мусор библиотек. */
function answerOf(text) {
  const lines = text.trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("{")) continue;
    try {
      return JSON.parse(lines[index]);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Собрать функцию движка для одной установки.
 *
 * `executable` — путь к `astral-engine`; `requestDir` — своя папка для файлов запросов (создаётся, файл запроса убирается после
 * ответа); `fastInstall` и `writeLimitMbps` — значениями или функциями (настройку человек может сменить между командами).
 * Остальное (`spawnProcess`, `lowerPriority`, `cancelGraceMs`) — для проверок.
 */
export function createExpressEngine({
  executable,
  moduleName,
  gameRoot,
  keysDirectory = null,
  pointsRoot = null,
  requestDir,
  fastInstall = false,
  writeLimitMbps = null,
  env = process.env,
  spawnProcess = spawn,
  lowerPriority = lowerBackgroundPriority,
  cancelGraceMs = EXPRESS_CANCEL_GRACE_MS,
} = {}) {
  if (!executable) throw new Error("Экспресс-установка: движок не найден.");
  if (!requestDir) throw new Error("Экспресс-установка: не названа папка запросов.");
  const read = (value) => (typeof value === "function" ? value() : value);
  let issued = 0;

  return async function engine(command, request, { signal = null, args = [], onProgress = null } = {}) {
    if (signal?.aborted) throw abortError(signal);
    issued += 1;
    const fast = read(fastInstall) === true;
    await fs.mkdir(requestDir, { recursive: true });
    const requestFile = path.join(requestDir, `${String(issued).padStart(4, "0")}-${command}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request ?? {}));
    try {
      return await new Promise((resolve, reject) => {
        const argv = expressEngineArguments(command, requestFile, { keysDirectory, gameRoot, pointsRoot, writeLimitMbps: read(writeLimitMbps), args });
        const child = spawnProcess(executable, argv, {
          env: expressEngineEnvironment(moduleName, { env, fastInstall: fast }),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        if (EXPRESS_BACKGROUND_COMMANDS.has(command) && !fast) lowerPriority(child);

        let out = "";
        let tail = "";
        let stderr = "";
        let cancelled = false;
        let graceTimer = null;
        child.stdout.on("data", (chunk) => {
          out = `${out}${chunk}`.slice(-(1 << 20));
        });
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
        /* Движок, который уже вышел, закрывает свой stdin: запись в него даёт ошибку потока, а не сбой установки. */
        child.stdin?.on?.("error", () => {});

        const onAbort = () => {
          cancelled = true;
          try {
            child.stdin?.write?.("cancel\n");
          } catch {
            /* stdin закрыт — остаётся снять процесс по сроку */
          }
          graceTimer = setTimeout(() => child.kill(), cancelGraceMs);
          graceTimer.unref?.();
        };
        const settle = () => {
          signal?.removeEventListener("abort", onAbort);
          if (graceTimer) clearTimeout(graceTimer);
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        child.on("error", (error) => {
          settle();
          reject(error);
        });
        child.on("close", (code) => {
          settle();
          if (cancelled) return reject(abortError(signal));
          const answer = answerOf(out);
          if (!answer) {
            const error = new Error(`${command}: движок не ответил, код ${code}. ${stderr.trim().slice(-300)}`.trim());
            error.code = "NoAnswer";
            return reject(error);
          }
          if (answer.ok !== true) {
            const error = new Error(`${command}: ${answer.error?.message ?? "отказ движка"}`);
            error.code = answer.error?.code || "EngineError";
            return reject(error);
          }
          resolve(answer.result);
        });
      });
    } finally {
      await fs.rm(requestFile, { force: true }).catch(() => {});
    }
  };
}
