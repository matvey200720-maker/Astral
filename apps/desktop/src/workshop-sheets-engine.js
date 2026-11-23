/*
 * Оболочка команды движка `read-workshop-textures` (этап 2 «3D на Rust», шаг A5): читатель листов `workshop-textures.js` зовёт её, когда окно просит блоки
 * (`blocks: true` и непустой `accept` — включён выключатель `astral.sheets.bcn.v1`), и берёт у движка контейнер ASB1 на пачку вместо своего пути JS.
 * Спецификация входа и ответа — `docs/perf/speed-3d-rust/asb1-format.md`, раздел 11; описание команды — `docs/perf/speed-3d-rust/read-workshop-textures-engine.md`.
 *
 * Свой экземпляр резидентного движка. Читатель живёт в потоке чтения игры (`game-read-host.js`) и в сервере стенда (`apps/web/vite.config.js` зовёт его прямо в своём
 * процессе), и там нет главного процесса с общим резидентом: мост `callNativeEngine` из потока — это вызов главного потока, а в стенде его нет вовсе. Поэтому модуль
 * поднимает сам `astral-engine serve` (`createRustEngineService`, тот же управляющий код, что у главного процесса) и зовёт команду напрямую. Из этого следует:
 *   — регистрировать команду в чужих списках (`RUST_COMMANDS`, `RUST_SERVE_COMMANDS`, `commands` и ветку аргументов в `native-engine.js`) не нужно;
 *   — контейнер по умолчанию лежит файлом в хранилище движка (`store: "file"`, папка — `ASTRAL_ENGINE_ASSETS_DIR` его `serve`, рядом с кэшем листов): замер на синтетике дал файл
 *     216 мс против канала данных 339 мс на холодном заходе. Канал (`ASTRAL_SHEETS_ENGINE_CHANNEL=1`): движок держит ответ в памяти и отдаёт по HTTP (`container.url`), оболочка
 *     поднимает его токеном (случайные 32 байта в hex в `ASTRAL_ENGINE_HTTP_TOKEN`), забирает контейнер одним `GET` с заголовком `X-Astral-Engine-Token`; нет адреса, 404, ошибка
 *     `fetch` — файл (команда зовётся ещё раз с `store: "file"`). Размер сверяется всегда, sha256 — по просьбе (`verify`, `ASTRAL_SHEETS_ENGINE_VERIFY=1`); границы записей проверяет разбор пачки;
 *   — в стенде и в потоке один и тот же код; сеанс движка (открытые архивы и таблица разобранных ресурсов) живёт в его процессе между пачками захода.
 *
 * Когда движка нет. Выключатель `ASTRAL_RUST_SHEETS=0` (или `off`, `false`, `no`), общие выключатели движка (`ASTRAL_RUST_ENGINE`, `ASTRAL_RUST_SERVE`), нет файла движка —
 * путь JS. «Команды нет» (готовый движок в git её не знает, пока его не пересоберут) выясняется один раз за сеанс читателя: первая же ошибка «Unsupported native command»,
 * отсутствие файла или невозможность запуска выключает путь до конца сеанса без записи в журнал. Любая другая ошибка пачки — только эта пачка отвечается читателем JS
 * (счётчик `fallbacks` в `timings`); повторные падения процесса гасит сам управляющий код (не больше трёх за минуту, дальше он отказывает сразу).
 *
 * Где лежит движок: `ASTRAL_SHEETS_ENGINE_EXE` (только не в поставке — для стенда и проверок, `prebuilt` подменять не нужно), затем места приложения (`resolveRustExecutable`:
 * `resources/native/astral-engine.exe` в поставке, `native/astral-engine/prebuilt`, `native/publish`, `native/astral-engine/target/…` в дереве разработчика).
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRustExecutable, rustEngineEnabled } from "./native-engine-rust.js";
import { createRustEngineService, rustServeEnabled } from "./rust-engine-service.js";
import { appPackaged, appResourcesPath } from "./runtime-paths.js";

export const SHEETS_ENGINE_COMMAND = "read-workshop-textures";
/* Пачка из 96 листов с холодной игры идёт секунды; дольше — процесс завис, его снимает управляющий код, а пачка отвечается читателем JS. */
export const SHEETS_ENGINE_TIMEOUT_MS = 120_000;
/* Остатки рабочих папок вызовов (процесс умер посреди пачки) старше этого срока убираются при первом вызове сеанса. */
const STALE_WORK_MS = 10 * 60 * 1000;

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SWITCHED_OFF = new Set(["0", "off", "false", "no"]);
const NO_COMMAND = /Unsupported native command/i;
const HEX64 = /^[0-9a-f]{64}$/;
/* Адрес контейнера на канале данных движка: петля, порт, `/a/<sha256>`. Чужой адрес из ответа не берётся. */
const CHANNEL_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/a\/([0-9a-f]{64})$/;
const TOKEN_HEADER = "X-Astral-Engine-Token";
/* Забрать контейнер с канала не дольше этого: дальше — запасной путь файлом. */
export const SHEETS_ENGINE_FETCH_TIMEOUT_MS = 15_000;

/* Номер вызова — на весь процесс: рабочие папки разных экземпляров в одной папке кэша не должны совпасть. */
let workSerial = 0;
const wordOf = (value) => String(value ?? "").trim().toLowerCase();

/** Не выключен ли путь движка для листов: `ASTRAL_RUST_SHEETS` (по умолчанию включён), общие выключатели движка и резидентного режима. */
export function sheetsEngineEnabled(env = process.env) {
  return !SWITCHED_OFF.has(wordOf(env?.ASTRAL_RUST_SHEETS)) && rustEngineEnabled(env) && rustServeEnabled(env);
}

/** Файл движка для листов или `null`. */
export function locateSheetsEngine(env = process.env, context = null) {
  const place = context ?? { packaged: appPackaged(), resourcesPath: appResourcesPath(), projectRoot: PROJECT_ROOT };
  const given = String(env?.ASTRAL_SHEETS_ENGINE_EXE ?? "").trim();
  if (given && !place.packaged && existsSync(given)) return given;
  return resolveRustExecutable(place);
}

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Ответ движка в нужном виде: `{ sha256, bytes }` контейнера и список отложенных листов. */
function checkedReply(result) {
  const sha256 = result?.container?.sha256;
  const bytes = result?.container?.bytes;
  if (typeof sha256 !== "string" || !HEX64.test(sha256) || !Number.isInteger(bytes) || bytes < 1) throw failure("SHEETS_BAD_REPLY", "Движок не назвал контейнер пачки.");
  const deferred = result?.deferred;
  if (!Array.isArray(deferred)) throw failure("SHEETS_BAD_REPLY", "Движок не назвал отложенные листы.");
  const seen = new Set();
  for (const item of deferred) {
    if (!Number.isInteger(item?.index) || item.index < 0 || typeof item.reason !== "string" || seen.has(item.index)) throw failure("SHEETS_BAD_REPLY", "Список отложенных листов движка не годится.");
    seen.add(item.index);
  }
  const store = result.container.store === "memory" || result.container.store === "file" ? result.container.store : null;
  const url = typeof result.container.url === "string" ? result.container.url : null;
  return { sha256, bytes, store, url, deferred, timings: result?.timings && typeof result.timings === "object" ? result.timings : null };
}

/**
 * Экземпляр оболочки (один на процесс или поток читателя, см. `defaultSheetsEngine`). Параметры нужны проверкам: `locate`, `createService`, `env`.
 *
 *   `available()` — можно ли пробовать путь движка (выключатели, файл, не выключен ли он на сеанс);
 *   `run({ request, cacheDir })` — одна пачка: `{ container: Uint8Array, deferred, timings, callMs, readMs }` или исключение;
 *   `noteFailure(error)` — что сделать с ошибкой: «команды нет» выключает путь на сеанс (`true`), остальное — только эта пачка (`false`);
 *   `stats()`, `reset()` — для проверок и замеров.
 */
export function createSheetsEngine({
  locate = locateSheetsEngine,
  createService = createRustEngineService,
  env = () => process.env,
  timeoutMs = SHEETS_ENGINE_TIMEOUT_MS,
  verify = null,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  let off = null;
  let executable;
  let service = null;
  let swept = false;
  /* Токен канала данных этого экземпляра: движок поднимает канал, только когда токен есть в окружении его `serve` (не короче 32 знаков). */
  const token = randomBytes(32).toString("hex");
  /* Хранилище движка (`ASTRAL_ENGINE_ASSETS_DIR` его `serve`): сюда он кладёт контейнер, когда не на полку; задаётся первым вызовом, рядом с кэшем листов. */
  let assetsDir = null;
  const counters = { calls: 0, served: 0, failures: 0, http: 0, files: 0, retries: 0 };
  /* sha256 контейнера сверяется по просьбе (`verify: true` или `ASTRAL_SHEETS_ENGINE_VERIFY=1`): файл лежит в своей папке вызова, пишется целиком и переименовывается, а хеш пачки в несколько мегабайт — заметная доля ответа (замер). Размер сверяется всегда, а разбор записей (`sheetFromBatch`) проверяет и границы. */
  /* Канал данных включается `ASTRAL_SHEETS_ENGINE_CHANNEL=1` (по умолчанию выключен: замер 15.11.2026 — файл 216 мс против канала 339 мс на холодном заходе): без него движок кладёт контейнер файлом в своё хранилище, читатель читает файл. Канал понадобится, когда контейнер будет забирать само окно. */
  const channelOn = () => wordOf(env()?.ASTRAL_SHEETS_ENGINE_CHANNEL) === "1";
  const verifies = () => (verify === null ? wordOf(env()?.ASTRAL_SHEETS_ENGINE_VERIFY) === "1" : verify === true);

  /* Окружение процесса движка: без `ASTRAL_SHEETS_TIMINGS` — строку `timings.jsonl` пишет читатель (с блоком `engine`), а не сам движок. */
  const engineEnv = () => {
    const { ASTRAL_SHEETS_TIMINGS: _unused, ASTRAL_ENGINE_HTTP_TOKEN: _foreign, ...rest } = env();
    /* Токен — только если канал включён: он и поднимает канал данных в процессе движка. */
    return { ...rest, ...(channelOn() ? { ASTRAL_ENGINE_HTTP_TOKEN: token } : {}), ...(assetsDir ? { ASTRAL_ENGINE_ASSETS_DIR: assetsDir } : {}) };
  };

  const exe = () => {
    if (executable === undefined) executable = locate(env()) ?? null;
    return executable;
  };

  /* Путь выключен на сеанс: процесс, поднятый ради него, больше не нужен (он ушёл бы сам по простою через 5 минут). */
  function disable(reason) {
    off = reason;
    service?.stop?.({ planned: true });
    service = null;
  }

  function available() {
    if (off) return false;
    if (!sheetsEngineEnabled(env())) return false;
    if (!exe()) {
      disable("no-engine");
      return false;
    }
    return true;
  }

  function noteFailure(error) {
    counters.failures += 1;
    const text = String(error?.message ?? error ?? "");
    const code = String(error?.code ?? "");
    if (NO_COMMAND.test(text)) {
      disable("no-command");
      return true;
    }
    /* Файла нет или не запускается: путь выключен, остаток сеанса идёт читателем. */
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENGINE_UNAVAILABLE") {
      disable(code === "ENGINE_UNAVAILABLE" ? "unavailable" : "no-engine");
      return true;
    }
    return false;
  }

  /** Остатки рабочих папок прежних сеансов: рядом с кэшем листов, `engine/<pid>-<номер>`. */
  async function sweep(base) {
    try {
      const now = Date.now();
      for (const name of await fs.readdir(base)) {
        const dir = path.join(base, name);
        const stat = await fs.stat(dir).catch(() => null);
        if (stat && now - stat.mtimeMs > STALE_WORK_MS) await fs.rm(dir, { recursive: true, force: true });
      }
    } catch {
      /* папки нет или не читается — убирать нечего */
    }
  }

  /** Контейнер с канала данных одним `GET` (так он освобождается в памяти движка) или `null`: нет адреса, чужой адрес, не 200, не тот размер, ошибка, срок. */
  async function takeFromChannel(reply) {
    const found = CHANNEL_URL.exec(reply.url ?? "");
    if (!found || found[2] !== reply.sha256 || typeof fetchImpl !== "function") return null;
    const known = service?.httpPort;
    if (known && Number(found[1]) !== known) return null;
    try {
      const response = await fetchImpl(reply.url, { headers: { [TOKEN_HEADER]: token }, signal: AbortSignal.timeout(SHEETS_ENGINE_FETCH_TIMEOUT_MS) });
      if (response.status !== 200) {
        await response.body?.cancel?.().catch(() => {});
        return null;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length === reply.bytes ? bytes : null;
    } catch {
      return null;
    }
  }

  /** Контейнер файлом из хранилища движка (после чтения файл убирается) или `null`. */
  async function takeFile(reply) {
    if (!assetsDir) return null;
    const file = path.join(assetsDir, reply.sha256);
    try {
      const bytes = await fs.readFile(file);
      void fs.rm(file, { force: true }).catch(() => {});
      return bytes.length === reply.bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) : null;
    } catch {
      return null;
    }
  }

  async function run({ request, cacheDir }) {
    const executableFile = exe();
    if (!executableFile) throw failure("ENOENT", "Файла движка нет.");
    const base = path.join(cacheDir, "engine");
    assetsDir ??= path.join(base, "assets");
    service ??= createService({ env: engineEnv });
    if (!swept) {
      swept = true;
      void sweep(base);
    }
    const work = path.join(base, `${process.pid}-${(workSerial += 1)}`);
    counters.calls += 1;
    const stages = { prepMs: 0, callMs: 0, readMs: 0, verifyMs: 0 };
    /* Одна команда: файл запроса в рабочей папке вызова, строка процессу, ответ. `--assets-dir` не передаётся: хранилище — настройка `serve` (ASTRAL_ENGINE_ASSETS_DIR), иначе `url` файла на канале отвечал бы 404. */
    const call = async (body, name) => {
      const prepAt = performance.now();
      await fs.mkdir(work, { recursive: true });
      const requestFile = path.join(work, name);
      await fs.writeFile(requestFile, JSON.stringify(body));
      const began = performance.now();
      stages.prepMs += began - prepAt;
      /* Без канала данных процесс движка настройку хранилища из окружения не читает (её берёт только поднятый канал) и писал бы в хранилище по умолчанию, в папку данных Astral:
         папку называет сама команда (`--assets-dir`). С каналом хранилище — `ASTRAL_ENGINE_ASSETS_DIR` процесса: канал отдаёт файлы только из него, и `--assets-dir` не передаётся. */
      const argv = [SHEETS_ENGINE_COMMAND, "--request", requestFile, ...(channelOn() ? [] : ["--assets-dir", assetsDir])];
      const answer = await service.request(executableFile, argv, { timeoutMs });
      stages.callMs += performance.now() - began;
      const response = answer?.response;
      if (response?.ok !== true) throw failure(response?.error?.code ?? "SHEETS_ENGINE_REFUSED", String(response?.error?.message ?? `Движок отказал (код ${answer?.exitCode ?? "?"}).`));
      return checkedReply(response.result);
    };
    try {
      let reply = await call(channelOn() ? request : { ...request, store: "file" }, "request.json");
      let via = "http";
      const readAt = performance.now();
      let bytes = channelOn() ? await takeFromChannel(reply) : null;
      /* Нет адреса, 404 или ошибка: контейнер в хранилище (или движок без полки) — читаем файл; на полке он уже мог уйти — зовём команду ещё раз и просим файл. */
      if (!bytes && reply.store !== "memory") {
        via = "file";
        bytes = await takeFile(reply);
      }
      if (!bytes) {
        counters.retries += 1;
        via = "file";
        reply = await call({ ...request, store: "file" }, "retry.json");
        bytes = await takeFile(reply);
      }
      stages.readMs = performance.now() - readAt;
      if (!bytes) throw failure("SHEETS_BAD_CONTAINER", "Контейнер пачки не получен ни с канала, ни из хранилища движка.");
      if (verifies()) {
        const verifyAt = performance.now();
        if (createHash("sha256").update(bytes).digest("hex") !== reply.sha256) throw failure("SHEETS_BAD_CONTAINER", "Контейнер пачки не совпал с ответом движка по sha256.");
        stages.verifyMs = performance.now() - verifyAt;
      }
      counters.served += 1;
      counters[via === "http" ? "http" : "files"] += 1;
      return { container: bytes, deferred: reply.deferred, timings: reply.timings, via, store: reply.store, ...stages };
    } finally {
      void fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    available,
    run,
    noteFailure,
    stats: () => ({ ...counters, off }),
    /** Для проверок: забыть выключение, найденный файл и процесс (его закрывает владелец сервиса). */
    reset() {
      off = null;
      executable = undefined;
      swept = false;
      service?.stop?.({ planned: true });
      service = null;
    },
  };
}

let shared = null;

/** Экземпляр процесса или потока читателя: один, поднимается по первому вызову. */
export function defaultSheetsEngine() {
  shared ??= createSheetsEngine();
  return shared;
}

/** Для проверок: убрать общий экземпляр (и его процесс). */
export function forgetDefaultSheetsEngine() {
  shared?.reset();
  shared = null;
}
