/*
 * Тяжёлая сборка набора — в своём процессе, а не в потоке главного (02.11.2026).
 *
 * Альфа 0.9.0-beta.90 у владельца: «Применить» дорог — главный процесс 2442 МБ
 * на пике и 1316 МБ после конца работы, куча JS из них — 119 МБ. Поток сборки
 * (`roads-build-host-worker.js`) и его пул перекраски — изоляты в том же
 * процессе: их кучи и буферы ложатся в память главного, а освобождённое
 * распределитель отдаёт системе не сразу и не всё (стенд 02.11: после
 * сборки дорог и 15 с простоя главный держал +410 МБ при куче 14 МБ). Свой
 * процесс (`utilityProcess` Electron) отдаёт всё разом, когда закрывается,
 * а в замере ресурсов он «служебный», не «главный».
 *
 * Ответ — объект с повадками `Worker`: события `message`, `error`, `exit`,
 * `postMessage`, `terminate`. Скрипт сборки берёт данные и порт из
 * `build-port.js` — тот же скрипт работает и потоком (тесты, Node без
 * Electron), и процессом.
 *
 * Вне главного процесса Electron (тесты, `ELECTRON_RUN_AS_NODE`) или с
 * `ASTRAL_BUILD_PROCESS=0` — поток, как прежде.
 */

import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { diskRestEnabled, diskRestFactor, onDiskRestChange, onDiskRestFactorChange } from "@modovik/install-engine/disk-care.js";
import { diskKind } from "@modovik/install-engine/disk-profile.js";
import { copyWriteLimitBytes, onCopyWriteLimitChange } from "@modovik/install-engine/write-pacing.js";
import { followInstallSpeed } from "./child-priority.js";
import { trackedTask, trackedWorker } from "./worker-census.js";
import { workerRuntimeEnvironment } from "./runtime-paths.js";

/* Хвост stderr процесса — по нему видно, что кончилась куча. */
const STDERR_TAIL = 8 * 1024;
const OUT_OF_MEMORY = /heap limit|out of memory|allocation failed/i;

/*
 * Потолок записи и отдых диска — сборке, при старте и на лету (18.11.2026): состояние тормоза живёт в модулях главного
 * процесса, у процесса сборки оно своё. Без этого сборка растительности писала гигабайты без потолка, включена «Быстрая
 * установка» или нет. `place` — папка, куда сборка пишет: по ней решается, медленный ли диск.
 */
const MIB = 1024 * 1024;
export function buildInstallSpeed(place = null) {
  const ceiling = copyWriteLimitBytes();
  return { writeLimitMbps: ceiling === null ? 0 : Math.max(1, Math.floor(ceiling / MIB)), rest: diskRestEnabled(), restFactor: diskRestFactor(), slow: place ? diskKind(place) === "slow" : false };
}

/* Смена режима — заданию: `tell(message)` шлёт её скрипту сборки. Ответ — отписка. */
function watchInstallSpeed(tell, place) {
  const send = () => {
    try {
      tell({ installSpeed: buildInstallSpeed(place) });
    } catch {
      /* задание уже закрыто */
    }
  };
  const stops = [onCopyWriteLimitChange(send), onDiskRestChange(send), onDiskRestFactorChange(send)];
  return () => {
    for (const stop of stops) stop();
  };
}

/** Есть ли у этого процесса `utilityProcess` (только главный процесс Electron). */
export function buildProcessAvailable({ env = process.env, utility = electron?.utilityProcess } = {}) {
  if (String(env.ASTRAL_BUILD_PROCESS ?? "").trim() === "0") return false;
  return typeof utility?.fork === "function";
}

/**
 * Запустить скрипт сборки `url` с данными `workerData`. `heapLimitMb` —
 * потолок кучи (у процесса — флаг V8, у потока — `resourceLimits`).
 * Кончилась куча — событие `error` с кодом `ERR_WORKER_OUT_OF_MEMORY`, как у потока.
 */
export function startBuildTask(
  label,
  url,
  {
    workerData = {},
    env = undefined,
    heapLimitMb = 2048,
    utility = electron?.utilityProcess,
    inProcess = buildProcessAvailable({ utility }),
    follow = followInstallSpeed,
    /* Папка, куда сборка пишет: для решения «диск медленный». */
    place = null,
  } = {},
) {
  /* Режим скорости установки едет с данными задания; скрипт сборки применяет его у себя (`build-install-speed.js`). */
  const data = { ...workerData, installSpeed: buildInstallSpeed(place) };
  if (!inProcess) {
    const worker = trackedWorker(label, url, {
      workerData: data,
      ...(env ? { env } : {}),
      resourceLimits: { maxOldGenerationSizeMb: heapLimitMb },
    });
    const stopWatching = watchInstallSpeed((message) => worker.postMessage(message), place);
    worker.once("exit", stopWatching);
    return worker;
  }

  const task = new EventEmitter();
  const child = utility.fork(fileURLToPath(url), [], {
    serviceName: `Astral ${label}`,
    execArgv: [`--max-old-space-size=${heapLimitMb}`],
    env: { ...(env || process.env), ...workerRuntimeEnvironment() },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  let exited = false;
  /* Приоритет процесса следует за «Быстрой установкой» (`child-priority.js`); номер процесса известен после запуска. */
  let unfollow = () => {};
  child.once("spawn", () => {
    if (!exited) unfollow = follow(child);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-STDERR_TAIL);
  });
  child.on("message", (message) => {
    /* Скрипт сначала говорит «готов» (слушатель стоит) — тогда ему уходят данные. */
    if (message?.buildPortReady) {
      child.postMessage({ workerData: data });
      return;
    }
    task.emit("message", message);
  });
  const stopWatching = watchInstallSpeed((message) => {
    if (!exited) child.postMessage(message);
  }, place);
  child.on("exit", (code) => {
    exited = true;
    unfollow();
    stopWatching();
    if (code !== 0 && OUT_OF_MEMORY.test(stderr))
      task.emit("error", Object.assign(new Error("Процесс сборки: не хватило памяти."), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    else if (code !== 0 && stderr.trim()) task.emit("error", new Error(stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400)));
    task.emit("exit", code);
  });
  task.postMessage = (message) => {
    if (!exited) child.postMessage(message);
  };
  task.terminate = async () => {
    if (!exited) child.kill();
  };
  return trackedTask(label, task);
}
