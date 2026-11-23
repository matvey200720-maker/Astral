/*
 * Сборка растительности вне главного процесса (фикс 1 ТЗ 07.10.2026).
 *
 * План растительности — это сборка пакета целиком: склады поставки
 * (784 МБ «Реалистичных деревьев»), чтение сотен архивов игры, тысячи
 * словарей. Прежде всё, кроме перекраски файлов, шло в главном потоке, и
 * на работе владельца он стоял 78–140 с: окно не отвечало, Windows
 * закрывала Astral («вылет при установке растительности»).
 *
 * Теперь сборка идёт в своём потоке (`vegetation-build-host-worker.js`):
 * он открывает склады и игру, заводит пул потоков перекраски и пишет пакет
 * на диск. Главный поток только пересылает ход в окно и ждёт ответ.
 *
 * Поток упал или кончилась память — ошибка словами, игра не тронута: план
 * ничего в игру не пишет.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { startBuildTask } from "./build-process.js";
import { rememberSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { vegetationResourceRoot } from "./vegetation-build.js";
import { engineScratchRoot, removeEngineScratch } from "./engine-run.js";
import { engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable } from "./native-engine-rust.js";
import { vegetationEngineEnabled } from "./vegetation-engine-build.js";
import { appLog } from "./app-log.js";

const WORKER_URL = new URL("./vegetation-build-host-worker.js", import.meta.url);

/* Отказ отмены: причина, которую дал сигнал, или «Отменено». */
const abortError = (signal) =>
  signal?.reason instanceof Error ? signal.reason : Object.assign(new Error("Отменено."), { name: "AbortError" });

/*
 * Черновики пакета (`packages/.build-<uuid>`), брошенные снятой или упавшей сборкой (18.11.2026). Свой черновик сборка убирает
 * в `finally`, но снятый процесс до него не доходит: до 7,4 ГБ лежали час, до фоновой уборки. Пока в этом приложении не идёт ни
 * одна сборка растительности, любой черновик — брошенный: он уходит перед новой сборкой и сразу после конца прежней.
 */
const DRAFT_NAME = /^\.build-[0-9a-f-]{36}$/i;
const runningBuilds = new Map();
let draftSweep = Promise.resolve(0);

export async function removeVegetationDrafts(stateDir) {
  if (!stateDir) return 0;
  const packages = path.join(stateDir, "recolor", "vegetation", "packages");
  const entries = await fs.readdir(packages, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !DRAFT_NAME.test(entry.name)) continue;
    /* С повторами: процесс сборки снят только что и мог ещё не отпустить файлы. */
    await fs.rm(path.join(packages, entry.name), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).then(
      () => (removed += 1),
      () => {},
    );
  }
  return removed;
}

/* Уборки идут одна за другой: новая сборка ждёт ту, что началась после конца прежней. */
const sweepDrafts = (stateDir) =>
  (draftSweep = draftSweep.then(async () => {
    const removed = await removeVegetationDrafts(stateDir).catch(() => 0);
    if (removed) appLog.record({ level: "info", source: "vegetation", message: `Растительность: убрано брошенных черновиков пакета — ${removed}` });
    return removed;
  }));

/* Куча потока: сборка держит в ней только описи — байты живут в буферах. */
const HEAP_LIMIT_MB = 2048;

export const VEGETATION_OUT_OF_MEMORY =
  "Не хватило памяти на сборку растительности. Закройте тяжёлые программы (браузер, игру) или отключите «Реалистичные деревья» и нажмите «Применить» ещё раз.";

function failureOf(error, code = null) {
  if (error?.code === "ERR_WORKER_OUT_OF_MEMORY") return new Error(VEGETATION_OUT_OF_MEMORY);
  const reason = String(error?.message || error || "").trim();
  const tail = code ? ` (код ${code})` : "";
  return new Error(
    reason
      ? `Сборка растительности остановилась: ${reason}`
      : `Сборка растительности остановилась${tail} — нажмите «Применить» ещё раз.`,
  );
}

/**
 * Пакет растительности в отдельном потоке: тот же ответ, что у
 * `buildVegetationPackage` (`{ setId, manifest, packageRoot, project, summary }`).
 * `composed` — `Map` файлов других работ Astral (`astralSetFiles`),
 * `stores` — хранилища стоящей растительности.
 */
export async function buildVegetationOffThread(
  { project, stateDir, gameRoot, composed = new Map(), stores = [], container = null },
  { onProgress = null, workerUrl = WORKER_URL, keysDirectory = undefined, resourceRoot = undefined, heapLimitMb = HEAP_LIMIT_MB, compile = null, signal = null, engineExecutable = undefined } = {},
) {
  /* Первое событие хода — сразу, до запуска процесса сборки и открытия складов: процент в окне идёт с первой секунды. */
  onProgress?.({ step: "vegetation", phase: "start", fraction: 0 });
  /* Счёт идущих сборок — до первого ожидания: уборка черновиков не должна застать чужой живой. */
  const draftsKey = stateDir ? path.resolve(stateDir).toLowerCase() : "";
  const alone = !runningBuilds.get(draftsKey);
  runningBuilds.set(draftsKey, (runningBuilds.get(draftsKey) || 0) + 1);
  try {
    if (alone) await sweepDrafts(stateDir);
    return await buildOffThread({ project, stateDir, gameRoot, composed, stores, container }, { onProgress, workerUrl, keysDirectory, resourceRoot, heapLimitMb, compile, signal, engineExecutable });
  } finally {
    const left = (runningBuilds.get(draftsKey) || 1) - 1;
    if (left > 0) runningBuilds.set(draftsKey, left);
    else {
      runningBuilds.delete(draftsKey);
      /* Отказ, отмена, сбой — черновик снятой сборки уходит сразу; ответ окну этого не ждёт. */
      void sweepDrafts(stateDir);
    }
  }
}

async function buildOffThread(
  { project, stateDir, gameRoot, composed, stores, container },
  { onProgress, workerUrl, keysDirectory, resourceRoot, heapLimitMb, compile, signal, engineExecutable },
) {
  const keys = keysDirectory === undefined ? await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport }) : keysDirectory;
  /* Склады ищутся по пути ресурсов приложения — потокам его даёт окружение. */
  const resources = resourceRoot === undefined ? await vegetationResourceRoot() : resourceRoot;
  /* Движок сборки (`vegetation-engine-build.js`), за выключателем `ASTRAL_VEGETATION_ENGINE=1`: файлы с листами мода собирает он. `engineExecutable: null` — без него; `ASTRAL_VEGETATION_ENGINE_EXE` — свой движок (стенды). */
  const executable =
    engineExecutable !== undefined
      ? engineExecutable
      : vegetationEngineEnabled()
        ? process.env.ASTRAL_VEGETATION_ENGINE_EXE || resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) })
        : null;
  /* Корень рабочих папок движка назначается здесь: снятый поток до своего `finally` не доходит, и убрать за ним нечем, если не знать, где оно лежит. */
  const engineScratch = engineScratchRoot("vegetation-build");
  /* Движок отменяется только словом в stdin: когда сборку снимают целиком, его процесс снимается здесь по номеру. Поток обнуляет номер, когда движок вышел сам. */
  let enginePid = 0;
  const stopEngine = () => {
    if (!enginePid) return;
    try {
      process.kill(enginePid);
    } catch {
      /* процесс уже вышел */
    }
    enginePid = 0;
  };
  const built = await new Promise((resolve, reject) => {
    let settled = false;
    /* Ответ пришёл — сборка закрывается целиком (процесс сборки сам не выходит), её память уходит системе. */
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (fn === reject) stopEngine();
      fn(value);
      worker?.terminate().catch(() => {});
    };
    let worker;
    try {
      worker = startBuildTask("vegetation-build", workerUrl, {
        workerData: { project, stateDir, gameRoot, composed: [...composed], stores, keysDirectory: keys || "", engine: executable ? { executable } : null, engineScratch, ...(container ? { container } : {}) },
        env: { ...process.env, ...(resources ? { ASTRAL_VEGETATION_RESOURCES: resources } : {}) },
        heapLimitMb,
        /* Пакет пишется в папку состояния: по ней — медленный ли диск (тормоз записи сборки, `build-process.js`). */
        place: stateDir || null,
      });
    } catch (error) {
      reject(failureOf(error));
      return;
    }
    worker.on("message", (message) => {
      /* «В разнобой»: типы копий собирает нативный хост — его зовёт главный процесс по просьбе потока. */
      if (message?.compile) {
        const { id, command, input } = message.compile;
        Promise.resolve()
          .then(() => {
            if (typeof compile !== "function") throw new Error("Сборщик типов копий «В разнобой» не подключён — обновите Astral.");
            return compile(command, input);
          })
          .then(
            (result) => worker.postMessage({ compiled: { id, result: result ?? null } }),
            (error) => worker.postMessage({ compiled: { id, error: String(error?.message || error) } }),
          );
        return;
      }
      if (message?.progress) onProgress?.(message.progress);
      /* Строка для журнала от сборки (размер пула по памяти): пишет главный процесс — у сборки своего журнала нет. */
      else if (message?.note?.message) appLog.record({ level: "info", source: String(message.note.source || "workers"), message: String(message.note.message).slice(0, 300) });
      else if (message?.enginePid !== undefined) enginePid = settled ? 0 : Number(message.enginePid) || 0;
      else if (message?.error) settle(reject, new Error(message.error));
      else if (message?.result) settle(resolve, message.result);
    });
    worker.on("error", (error) => settle(reject, failureOf(error)));
    worker.on("exit", (code) => settle(reject, failureOf(null, code || null)));
    /* Отмена: поток снимается сразу, вместе с пулом потоков сборки; ответ — отказ «Отменено». */
    const onAbort = () => {
      settle(reject, abortError(signal));
      worker.terminate().catch(() => {});
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => removeEngineScratch(engineScratch)); /* убрано и при отмене, и при сбое, и после ответа: окну отвечаем, когда папок уже нет; с повторами — процесс снят только что */
  /* Отпечатки файлов пакета известны — движку не нужно перечитывать пакет
     (память отпечатков у каждого потока своя). */
  for (const file of built.payloadFiles || [])
    await rememberSha256(path.join(built.packageRoot, "payload", file.name), file.sha256).catch(() => {});
  /* Оценка по плану рядом с настоящим размером: по журналам людей видно, насколько ей можно верить (18.11.2026). */
  const megabytes = (bytes) => Math.round((Number(bytes) || 0) / (1024 * 1024));
  if (built.summary?.estimatedBytes > 0)
    appLog.record({
      level: "info",
      source: "vegetation",
      message: `Растительность: по плану ${megabytes(built.summary.estimatedBytes)} МБ, вышло ${megabytes(built.summary.bytes)} МБ`,
    });
  return built;
}
