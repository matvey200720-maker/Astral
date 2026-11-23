/*
 * Сборка «Дорог» вне главного процесса (задача 6 ТЗ 07.10.2026).
 *
 * План дорог — сборка пакета целиком: перепись карты (оглавления сотни
 * архивов), чтение до полутора тысяч словарей и перекраска их листов. В
 * главном потоке окно стояло бы минутами (урок растительности, фикс 1 ТЗ
 * 07.10.2026), поэтому сборка идёт в своём потоке
 * (`roads-build-host-worker.js`): он открывает игру, заводит пул потоков
 * перекраски и пишет пакет на диск. Главный поток только пересылает ход в
 * окно и ждёт ответ.
 *
 * Поток упал или кончилась память — ошибка словами, игра не тронута: план
 * ничего в игру не пишет.
 */

import path from "node:path";
import { startBuildTask } from "./build-process.js";
import { rememberSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { engineScratchRoot, removeEngineScratch } from "./engine-run.js";
import { engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable } from "./native-engine-rust.js";
import { roadsEngineEnabled } from "./roads-engine-build.js";

const WORKER_URL = new URL("./roads-build-host-worker.js", import.meta.url);

/* Отказ отмены: причина, которую дал сигнал, или «Отменено». */
const abortError = (signal) =>
  signal?.reason instanceof Error ? signal.reason : Object.assign(new Error("Отменено."), { name: "AbortError" });
const HEAP_LIMIT_MB = 2048;

export const ROADS_OUT_OF_MEMORY = "Не хватило памяти на сборку дорог. Закройте тяжёлые программы (браузер, игру) и нажмите «Применить» ещё раз.";

function failureOf(error, code = null) {
  if (error?.code === "ERR_WORKER_OUT_OF_MEMORY") return new Error(ROADS_OUT_OF_MEMORY);
  const reason = String(error?.message || error || "").trim();
  const tail = code ? ` (код ${code})` : "";
  return new Error(reason ? `Сборка дорог остановилась: ${reason}` : `Сборка дорог остановилась${tail} — нажмите «Применить» ещё раз.`);
}

/**
 * Пакет дорог в отдельном потоке: тот же ответ, что у `buildRoadsPackage`.
 * `images` — свои картинки отделки из окна (`{ finishes: { <ключ>: { data } } }`).
 */
export async function buildRoadsOffThread(
  { project, stateDir, gameRoot, images = null, container = null, composed = null },
  { onProgress = null, workerUrl = WORKER_URL, keysDirectory = undefined, heapLimitMb = HEAP_LIMIT_MB, signal = null, engineExecutable = undefined } = {},
) {
  const keys = keysDirectory === undefined ? await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport }) : keysDirectory;
  /* Движок сборки (`roads-engine-build.js`): словари собирает он, потоки JS — запасной путь. `engineExecutable: null` — без движка (тесты). */
  const executable =
    engineExecutable !== undefined ? engineExecutable : roadsEngineEnabled() ? resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) }) : null;
  /* Корень рабочих папок движка назначается здесь: снятый поток до своего `finally` не доходит, и убрать за ним нечем, если не знать, где оно лежит. */
  const engineScratch = engineScratchRoot("roads-build");
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
      worker = startBuildTask("roads-build", workerUrl, {
        workerData: { project, stateDir, gameRoot, images, keysDirectory: keys || "", engine: executable ? { executable } : null, engineScratch, ...(container ? { container } : {}), ...(composed?.length ? { composed } : {}) },
        heapLimitMb,
        /* Память сборки и пакет лежат в папке состояния: по ней — медленный ли диск (тормоз записи сборки, `build-process.js`). */
        place: stateDir || null,
      });
    } catch (error) {
      reject(failureOf(error));
      return;
    }
    worker.on("message", (message) => {
      if (message?.progress) onProgress?.(message.progress);
      else if (message?.enginePid !== undefined) enginePid = settled ? 0 : Number(message.enginePid) || 0;
      else if (message?.error) settle(reject, new Error(message.error));
      else if (message?.result) settle(resolve, message.result);
    });
    worker.on("error", (error) => settle(reject, failureOf(error)));
    worker.on("exit", (code) => settle(reject, failureOf(null, code || null)));
    /* Отмена: поток снимается сразу; ответ — отказ «Отменено». */
    const onAbort = () => {
      settle(reject, abortError(signal));
      worker.terminate().catch(() => {});
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => removeEngineScratch(engineScratch)); /* убрано и при отмене, и при сбое, и после ответа: окну отвечаем, когда папок уже нет; с повторами — процесс снят только что */
  /* Отпечатки файлов пакета известны — движку не нужно перечитывать гигабайты
     (память отпечатков у каждого потока своя). */
  for (const file of built.payloadFiles || [])
    await rememberSha256(path.join(built.packageRoot, "payload", file.name), file.sha256).catch(() => {});
  return built;
}
