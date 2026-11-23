/*
 * Оболочка команды движка `build-world-place-scene` («3D на Rust», этап 4, зоны мира): сцену места по координатам (то, что собирает `buildWorldPlaceBytes`) собирает движок —
 * чтение и разбор моделей в пуле потоков, расстановка, склейка, кодирование `ARS1` и запись файла кэша. Описание команды — `native/astral-engine/crates/astral-engine/src/commands/world_place_scene.rs`.
 *
 * Включается переменной `ASTRAL_RUST_PLACE_SCENE=1` (по умолчанию выключено). Любой отказ — «команды нет», сбой движка, не тот ответ, `fallback` (модель обвода не разобралась) —
 * это путь JS: `build()` бросает исключение или отвечает `{ fallback }`, а хозяин (`world-place-host.js`) собирает место прежним потоком. «Команды нет» и «движка нет» выключают путь
 * до конца сеанса. Ключ кэша сцены, окно и файл на диске те же, что у пути JS: сцена лежит в `cacheFile`, куда её пишет движок (запись атомарна), байты через Desktop не идут.
 *
 * Оглавление игры по-прежнему строит JS (`openGameIndex`, поток): оболочка шлёт движку отпечатки архивов (`gameIndexStamps`), и он читает файл оглавления, только если он свежий;
 * иначе отвечает `{ stale: true }`, оболочка обновляет файл потоком (`buildIndex`) и спрашивает ещё раз. Таблицу карт, имён файлов типов и родства словарей оболочка кладёт файлом
 * рядом с кэшем (имя — по отпечатку текста, лишние старые файлы убираются). Описание зон обвода (`ZONES`) идёт в запросе: список зон один, у JS.
 *
 * Вызов — через мост движка (`callNativeEngine`): резидентный процесс общий с остальными чтениями, открытые архивы не дублируются. Проверкам и стенду мост подменяют (`call`).
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const WORLD_PLACE_ENGINE_COMMAND = "build-world-place-scene";
const SWITCHED_ON = new Set(["1", "on", "true", "yes"]);
/* Старый движок команды не знает, движка нет или он выключен: путь до конца сеанса выключен. */
const NO_ENGINE = /Unsupported native command|astral-engine\.exe\) is not built|Astral engine is switched off|ENGINE_UNAVAILABLE/i;
/* Остатки запросов прежних сеансов (процесс умер посреди сборки) старше этого срока убираются. */
const STALE_REQUEST_MS = 10 * 60 * 1000;

let requestSerial = 0;

/** Включён ли путь движка для сцены места: `ASTRAL_RUST_PLACE_SCENE=1`. */
export function worldPlaceEngineEnabled(env = process.env) {
  return SWITCHED_ON.has(String(env?.ASTRAL_RUST_PLACE_SCENE ?? "").trim().toLowerCase());
}

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Ответ движка в нужном виде: `{ file, bytes, report, timings }`, `{ empty }` или `{ fallback }`; иначе — исключение. */
function checkedAnswer(answer, cacheFile) {
  if (answer?.empty === true) return { empty: true };
  if (typeof answer?.fallback === "string") return { fallback: answer.fallback };
  const sameFile = typeof answer?.file === "string" && path.resolve(answer.file).toLowerCase() === path.resolve(cacheFile).toLowerCase();
  if (!sameFile || !Number.isInteger(answer?.bytes) || answer.bytes < 1) throw failure("PLACE_BAD_REPLY", "Движок не назвал файл сцены места.");
  const timings = answer.timings && typeof answer.timings === "object" ? answer.timings : null;
  return { file: cacheFile, bytes: answer.bytes, report: answer.report && typeof answer.report === "object" ? answer.report : null, timings };
}

async function defaultStamps(gameRoot) {
  const { gameIndexStamps } = await import("./game-file-index.js");
  return gameIndexStamps(gameRoot);
}

async function defaultCall(command, input, context) {
  const { callNativeEngine } = await import("./native-engine.js");
  return callNativeEngine(command, input, context);
}

/**
 * Экземпляр оболочки (один на процесс, `defaultWorldPlaceEngine`); параметры нужны проверкам и стенду: `call(command, { request }, context)` — вызов команды (по умолчанию —
 * мост), `stamps(gameRoot)` — отпечатки архивов игры, `env()` — окружение.
 *
 *   `available()` — можно ли пробовать путь движка (выключатель, не выключен ли он на сеанс);
 *   `build(task, { buildIndex })` — одна сборка: `{ file, bytes, report, timings }`, `{ empty: true }`, `{ fallback }` или исключение. `task` — как у пути JS плюс `cacheFile`;
 *   `noteFailure(error)` — что сделать с ошибкой: «команды нет» выключает путь на сеанс (`true`), остальное — только эту сборку;
 *   `stats()`, `reset()` — для проверок и замеров.
 */
export function createWorldPlaceEngine({ call = defaultCall, stamps = defaultStamps, data = () => import("./world-place-engine-data.js"), env = () => process.env } = {}) {
  let off = null;
  let swept = false;
  const counters = { calls: 0, served: 0, stale: 0, fallbacks: 0, empties: 0, failures: 0 };
  /* Данные для запроса (таблица мира и зоны обводов) грузятся по первому запросу. Таблица: текст и отпечаток считаются один раз на процесс, файл — один на папку кэша. */
  let loaded = null;
  let table = null;
  const dataOf = () => (loaded ??= data());
  const tableOf = async () => {
    if (!table) {
      const text = (await dataOf()).worldTableText();
      table = { text, name: `world-place-table-${createHash("sha256").update(text).digest("hex").slice(0, 12)}.json` };
    }
    return table;
  };

  function available() {
    return !off && worldPlaceEngineEnabled(env());
  }

  function noteFailure(error) {
    counters.failures += 1;
    const text = `${error?.message ?? error ?? ""} ${error?.code ?? ""}`;
    /* Файла движка нет: сбой запуска (`spawn … ENOENT`), а не отсутствие игры или кэша. */
    const notStarted = error?.code === "ENOENT" && String(error?.syscall ?? "").startsWith("spawn");
    if (NO_ENGINE.test(text) || notStarted) {
      off = "no-engine";
      return true;
    }
    return false;
  }

  /** Файл таблицы мира рядом с кэшем сцен; нет или не тот размер — пишется заново, чужие таблицы прежних версий убираются. */
  async function ensureTable(root) {
    const { text, name } = await tableOf();
    const file = path.join(root, name);
    const have = await fs.stat(file).catch(() => null);
    if (have?.size === Buffer.byteLength(text)) return file;
    await fs.mkdir(root, { recursive: true });
    const temp = `${file}.${process.pid}-${(requestSerial += 1)}.tmp`;
    await fs.writeFile(temp, text);
    await fs.rename(temp, file);
    for (const other of await fs.readdir(root).catch(() => [])) if (/^world-place-table-[0-9a-f]{12}\.json$/.test(other) && other !== name) await fs.rm(path.join(root, other), { force: true }).catch(() => {});
    return file;
  }

  /** Остатки прежних сеансов: файлы запросов (папка `engine`) и недописанные сцены движка (`*.shop-stage` рядом с кэшем): процесс умер посреди записи. */
  async function sweep(directory, only = null) {
    try {
      const now = Date.now();
      for (const name of await fs.readdir(directory)) {
        if (only && !only.test(name)) continue;
        const file = path.join(directory, name);
        const stat = await fs.stat(file).catch(() => null);
        if (stat && now - stat.mtimeMs > STALE_REQUEST_MS) await fs.rm(file, { force: true });
      }
    } catch {
      /* папки нет — убирать нечего */
    }
  }

  async function bodyOf(task, stampMap, tableFile) {
    const plan = Array.isArray(task.plan) ? task.plan : null;
    const outline = String(task.outline || "");
    const zonesRoot = String(task.zonesRoot || "");
    /* Потоков чтения и разбора: по умолчанию движок берёт половину ядер; `ASTRAL_PLACE_ENGINE_THREADS` — для замеров. */
    const threads = Number.parseInt(env()?.ASTRAL_PLACE_ENGINE_THREADS ?? "", 10);
    return {
      origin: task.origin,
      reach: task.reach,
      ...(plan ? { plan } : {}),
      ...(Number.isFinite(task.top) ? { top: task.top } : {}),
      outline,
      ...(outline && zonesRoot ? { outlineZones: (await dataOf()).outlineZonesFor(outline), zonesRoot } : {}),
      gameRoot: task.gameRoot,
      keys: task.keys || "",
      indexFile: task.indexFile,
      stamps: stampMap,
      tableFile,
      cacheFile: task.cacheFile,
      ...(threads > 0 ? { threads } : {}),
    };
  }

  async function ask(task, tableFile, directory) {
    const stampMap = await stamps(task.gameRoot);
    const requestFile = path.join(directory, `${process.pid}-${(requestSerial += 1)}.json`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(requestFile, JSON.stringify(await bodyOf(task, stampMap, tableFile)));
    try {
      return await call(WORLD_PLACE_ENGINE_COMMAND, { request: requestFile }, {});
    } finally {
      void fs.rm(requestFile, { force: true }).catch(() => {});
    }
  }

  async function build(task, { buildIndex } = {}) {
    if (!task?.cacheFile || !task?.indexFile || !path.isAbsolute(task.cacheFile)) throw failure("PLACE_BAD_TASK", "Для сборки движком нужны файл кэша и файл оглавления.");
    counters.calls += 1;
    const root = path.dirname(task.cacheFile);
    const directory = path.join(root, "engine");
    if (!swept) {
      swept = true;
      void sweep(directory);
      void sweep(root, /.shop-stage$/);
    }
    const tableFile = await ensureTable(root);
    let answer = await ask(task, tableFile, directory);
    if (answer?.stale === true) {
      counters.stale += 1;
      if (typeof buildIndex !== "function") throw failure("PLACE_STALE_INDEX", "Оглавление игры устарело, обновить его нечем.");
      await buildIndex(task);
      answer = await ask(task, tableFile, directory);
      if (answer?.stale === true) throw failure("PLACE_STALE_INDEX", "Оглавление игры устарело и после обновления.");
    }
    const checked = checkedAnswer(answer, task.cacheFile);
    if (checked.fallback) counters.fallbacks += 1;
    else if (checked.empty) counters.empties += 1;
    else counters.served += 1;
    return checked;
  }

  return {
    available,
    build,
    noteFailure,
    stats: () => ({ ...counters, off }),
    /** Для проверок: забыть выключение и найденное. */
    reset() {
      off = null;
      swept = false;
      table = null;
      loaded = null;
    },
  };
}

let shared = null;

/** Экземпляр процесса: один, поднимается по первому вызову. */
export function defaultWorldPlaceEngine() {
  shared ??= createWorldPlaceEngine();
  return shared;
}

/** Для проверок: убрать общий экземпляр. */
export function forgetDefaultWorldPlaceEngine() {
  shared?.reset();
  shared = null;
}
