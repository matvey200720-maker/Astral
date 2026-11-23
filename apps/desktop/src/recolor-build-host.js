/*
 * Сборка наборов мастерской (места: Завод, Ангар, Маппинг, Мегамолл, Ашан,
 * Вайнвуд, Остановки, Зоны, Арена) вне главного процесса (фикс 1 ТЗ
 * 07.10.2026).
 *
 * План набора — это сборка его пакета: чтение игры, перекраска словарей,
 * дальние планы (`recolor-lod.js` растеризует каждый треугольник LOD-модели
 * по её атласу), плашки. На стенде проверки всех разделов наблюдатель
 * главного потока поймал план «Маппинга» на `buildLodFiles` → `rasterTriangle`
 * → `pick`: окно стояло 10 + 6 + 5 + 4 + 3 с подряд. Теперь та же сборка идёт
 * в своём потоке (`recolor-build-host-worker.js`), а главный поток только
 * ждёт ответ и выполняет для потока вызовы нативного хоста — у моста окна
 * своя очередь, и вызовы в неё идут отсюда, как раньше.
 *
 * Поток упал или кончилась память — ошибка словами, игра не тронута: план
 * в игру ничего не пишет.
 */

import path from "node:path";
import { trackedWorker } from "./worker-census.js";
import { rememberSha256 } from "@modovik/install-engine/file-fingerprint.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { engineScratchRoot, removeEngineScratch } from "./engine-run.js";

const WORKER_URL = new URL("./recolor-build-host-worker.js", import.meta.url);
const HEAP_LIMIT_MB = 2048;

/* Отказ отмены: причина, которую дал сигнал, или «Отменено». */
const abortError = (signal) =>
  signal?.reason instanceof Error ? signal.reason : Object.assign(new Error("Отменено."), { name: "AbortError" });

export const RECOLOR_OUT_OF_MEMORY =
  "Не хватило памяти на сборку набора. Закройте тяжёлые программы (браузер, игру) и нажмите «Применить» ещё раз.";

/*
 * Ресурсы поставки поток ищет по переменным окружения: у потока Electron
 * может не быть `process.resourcesPath`, а у главного процесса он есть.
 */
export function resourceEnvironment(env = process.env, resourcesPath = process.resourcesPath) {
  if (!resourcesPath) return {};
  const at = (folder) => path.join(resourcesPath, folder);
  return {
    ...(env.ASTRAL_RECOLOR_RESOURCES ? {} : { ASTRAL_RECOLOR_RESOURCES: at("recolor") }),
    ...(env.ASTRAL_RECOLOR_LOD ? {} : { ASTRAL_RECOLOR_LOD: at("recolor-lod") }),
    ...(env.ASTRAL_RECOLOR_LOCAL ? {} : { ASTRAL_RECOLOR_LOCAL: at("recolor-local") }),
  };
}

function failureOf(error, code = null) {
  if (error?.code === "ERR_WORKER_OUT_OF_MEMORY") return new Error(RECOLOR_OUT_OF_MEMORY);
  const reason = String(error?.message || error || "").trim();
  return new Error(
    reason ? `Сборка набора остановилась: ${reason}` : `Сборка набора остановилась${code ? ` (код ${code})` : ""} — нажмите «Применить» ещё раз.`,
  );
}

/**
 * Пакет набора в отдельном потоке — тот же ответ, что у
 * `buildRecolorPackage`. `compile(command, input)` — нативный хост через
 * мост главного процесса; `held` — `Map` файлов, что везут другие наборы.
 * `signal` — отмена: поток снимается сразу, ответ — отказ «Отменено» (`AbortError`).
 */
export async function buildRecolorOffThread(
  { setId, input, stateDir, images = null, held = null, over = null, neighbours = null, gameRoot },
  { compile = null, workerUrl = WORKER_URL, keysDirectory = undefined, heapLimitMb = HEAP_LIMIT_MB, signal = null } = {},
) {
  if (signal?.aborted) throw abortError(signal);
  const keys = keysDirectory === undefined ? await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport }) : keysDirectory;
  if (signal?.aborted) throw abortError(signal);
  /* Рабочая папка движка сборки (`billboards-engine-build.js`) назначается здесь: поток, снятый отменой, не дойдёт до своего `finally`, и убрать за ним
     нечем, если не знать, где оно лежит. */
  const engineScratch = engineScratchRoot("recolor-engine");
  /* Движок отменяется только словом в stdin: когда сборку снимают целиком, его процесс снимается здесь по номеру (как у дорог и растительности).
     Поток обнуляет номер, когда движок вышел сам, — на освободившемся номере мог поселиться чужой процесс. */
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
  let built;
  try {
    built = await new Promise((resolve, reject) => {
      let settled = false;
      let worker;
      let onAbort = null;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        if (onAbort) signal?.removeEventListener("abort", onAbort);
        if (fn === reject) stopEngine();
        fn(value);
        void worker?.terminate().catch(() => {});
      };
      try {
        worker = trackedWorker("recolor-build", workerUrl, {
          workerData: {
            setId,
            input,
            stateDir,
            images,
            held: held ? [...held] : null,
            over: over ? [...over] : null,
            neighbours: neighbours ? [...neighbours] : null,
            gameRoot,
            keysDirectory: keys || "",
            engineScratch,
            /* Без хоста (тесты, стенды) поток ведёт себя, как прежний путь без `compile`. */
            hasCompile: typeof compile === "function",
          },
          env: { ...process.env, ...resourceEnvironment() },
          resourceLimits: { maxOldGenerationSizeMb: heapLimitMb },
        });
      } catch (error) {
        reject(failureOf(error));
        return;
      }
      /* Отмена: процесс движка и поток снимаются сразу; ответ — отказ «Отменено». */
      onAbort = () => settle(reject, abortError(signal));
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      worker.on("message", (message) => {
        if (message?.enginePid !== undefined) enginePid = settled ? 0 : Number(message.enginePid) || 0;
        else if (message?.compile) {
          const { id, command, input: payload } = message.compile;
          Promise.resolve()
            .then(() => {
              if (typeof compile !== "function") throw new Error("Нативный хост недоступен.");
              return compile(command, payload);
            })
            .then(
              (result) => worker.postMessage({ compiled: { id, result } }),
              (error) => worker.postMessage({ compiled: { id, error: String(error?.message || error) } }),
            )
            .catch(() => {});
        } else if (message?.error) settle(reject, new Error(message.error));
        else if (message?.result) settle(resolve, message.result);
      });
      worker.on("error", (error) => settle(reject, failureOf(error)));
      worker.on("exit", (code) => settle(reject, failureOf(null, code || null)));
    });
  } finally {
    /* Рабочая папка движка — убрана и при отмене, и при сбое: поток сам до своей уборки не дошёл (с повторами: процесс движка снят только что, `removeEngineScratch`). */
    await removeEngineScratch(engineScratch);
  }
  /* Отпечатки файлов пакета — в память главного процесса (у потока своя). */
  for (const file of built.payloadFiles || [])
    await rememberSha256(path.join(built.packageRoot, "payload", file.name), file.sha256).catch(() => {});
  return built;
}
