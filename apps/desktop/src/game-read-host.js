import { fileURLToPath } from "node:url";
import path from "node:path";
import { trackedWorker } from "./worker-census.js";
import { resourceEnvironment } from "./recolor-build-host.js";
import * as runtimePaths from "./runtime-paths.js";
import { appLog } from "./app-log.js";
import * as provisioner from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { onHibernate } from "./hibernation-hooks.js";
import { composeRow, moduleLabel, traceFileOf, traceSinkFor, traceWanted, wallNow } from "./game-read-trace.js";
import { rustReaderFor } from "./rust-readers.js";

export const GAME_READ_OUT_OF_MEMORY =
  "Файлы вашей игры не прочитались: не хватило памяти. Обычно так бывает с тяжёлым редуксом. "
  + "Astral при этом не вылетает и попробует снова при следующем открытии.";
export const CLOTHING_READER_IDLE_MS = 300000;
/*
 * Читатели анимаций (`animations/animation-reads.js`: список, дорожки, позы — один поток) живут долго только по выключателю `ASTRAL_ANIMATION_READER_IDLE` (18.11.2026; по умолчанию выключено —
 * поток закрывается через 60 с простоя, как раньше). Замер в настоящем Electron (отчёт 19, раздел 24): повторный вход во вкладку анимаций 622–628 мс, из них запуск потока 510–519 мс и
 * чтение 95–101 мс; с живым потоком остаётся чтение. Цена — память воркера до пяти минут простоя (не мерена).
 */
export const ANIMATION_READER_IDLE_MS = 300000;
export const ANIMATION_READER_IDLE_VARIABLE = "ASTRAL_ANIMATION_READER_IDLE";
const ANIMATION_IDLE_ON = new Set(["1", "on", "true", "yes"]);

const sourceFolder = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceFolder, "..", "..", "..");
const CLOTHING_READER_FILE = /\/clothing-(?:character|ahead|models|list-reader)\.js$/;
const ANIMATION_READER_FILE = /\/animations\/animation-reads\.js$/;
const STOPPED_PREFIX = "Чтение файлов игры остановилось: ";

export function readerIdleMs(module, env = process.env) {
  if (CLOTHING_READER_FILE.test(String(module))) return CLOTHING_READER_IDLE_MS;
  if (ANIMATION_READER_FILE.test(String(module)) && ANIMATION_IDLE_ON.has(String(env?.[ANIMATION_READER_IDLE_VARIABLE] ?? "").trim().toLowerCase())) return ANIMATION_READER_IDLE_MS;
  return undefined;
}

function abortFailure() {
  return Object.assign(new Error("Операция отменена."), { name: "AbortError", code: "ABORT_ERR" });
}

function failureFrom(reply) {
  return Object.assign(new Error(reply.message), reply.code ? { code: reply.code } : {});
}

// --- детали хоста: вызов, очередь, таймер простоя, запуск потока ----------------

// Запись об одном вызове: колбэки, подписка на отмену и её снятие.
function newJob(resolve, reject, onProgress, signal, abort) {
  return {
    resolve,
    reject,
    onProgress,
    signal,
    abort,
    unwatch() {
      signal?.removeEventListener("abort", abort);
    },
  };
}

// Журнал вызовов в полёте: номера по порядку выдачи и записи по номерам.
function createLedger() {
  const entries = new Map();
  let issued = 0;

  return {
    get size() {
      return entries.size;
    },
    issue() {
      issued += 1;
      return issued;
    },
    add(id, job) {
      entries.set(id, job);
    },
    find(id) {
      return entries.get(id);
    },
    forget(id) {
      entries.delete(id);
    },
    // Вызов закончен ответом: убрать запись и снять подписку на отмену.
    discharge(id) {
      const job = entries.get(id);
      entries.delete(id);
      job.unwatch();
    },
    // `kind` — класс отказа для строки трассы (только у вызовов с трассой).
    rejectAll(text, kind) {
      const batch = [...entries.values()];
      entries.clear();
      for (const job of batch) {
        job.unwatch();
        job.closeTrace?.(kind);
        job.reject(new Error(text));
      }
    },
  };
}

function createIdleClock(ms, onExpire) {
  let timer = null;
  return {
    hold() {
      clearTimeout(timer);
      timer = null;
    },
    arm() {
      clearTimeout(timer);
      timer = setTimeout(onExpire, ms);
      timer.unref?.();
    },
  };
}

function launchReadThread(config) {
  const { module, native, log, context, runtime, heapLimitMb, workerUrl, trace } = config;
  const workerData = Object.fromEntries([
    ["module", module],
    ["native", typeof native === "function"],
    ["logs", typeof log === "function"],
    ["context", typeof context === "function" ? context() : context],
  ]);
  /* Трасса чтений (`game-read-trace.js`): поток знает о ней только из этого поля; без трассы данных потока нет ни лишнего ключа. */
  if (trace) workerData.trace = true;
  const env = Object.assign({}, process.env, resourceEnvironment(), runtime());
  return trackedWorker("game-read", workerUrl, {
    workerData,
    env,
    resourceLimits: { maxOldGenerationSizeMb: heapLimitMb },
  });
}

// Хост одного потока чтения: почтовый ящик с очередью вызовов и таймером простоя.
export function createGameReadHost(options = {}) {
  const option = (key, fallback) => (options[key] === undefined ? fallback() : options[key]);
  const { module } = options;
  const heapLimitMb = option("heapLimitMb", () => 1536);
  const idleMs = option("idleMs", () => 60000);
  const workerUrl = option("workerUrl", () => new URL("./game-read-worker.js", import.meta.url));
  const native = option("native", () => null);
  const log = option("log", () => null);
  const runtime = option("runtime", () => runtimePaths.workerRuntimeEnvironment);
  const context = option("context", () => null);
  const launchConfig = { module, native, log, context, runtime, heapLimitMb, workerUrl };
  const label = moduleLabel(module);
  /* Трасса (`game-read-trace.js`): `options.trace` — `true`, `false` или `{ file, enabled, flushMs }`; без него решает ASTRAL_READ_TRACE. Решение — на каждый запуск потока: у потока без трассы
     вызовы идут как раньше, без меток времени и без лишних сообщений. */
  const tracing = () => (options.trace === undefined ? traceWanted() : Boolean(options.trace) && options.trace.enabled !== false);
  const awaiting = new Map();
  const announce = (kind, file) =>
    appLog.record({
      level: kind === "failed" ? "warn" : "info",
      source: "read-trace",
      message: kind === "failed" ? `Трасса чтений игры: не удалось дописать ${file}` : `Трасса чтений игры: ${file}`,
    });
  const writeRow = (row) => traceSinkFor(options.trace?.file ?? traceFileOf(), { note: announce, flushMs: options.trace?.flushMs }).push(row);
  const ledger = createLedger();
  const idle = createIdleClock(idleMs, stop);
  let current = null;

  function stop() {
    idle.hold();
    const gone = current;
    current = null;
    if (gone?.traceState) flushAwaiting(gone);
    gone?.terminate().catch(() => {});
  }

  function restIfIdle() {
    if (ledger.size > 0 || !current) return;
    idle.arm();
  }

  // Поток забывается, только если он всё ещё текущий.
  function detach(thread) {
    if (current !== thread) return false;
    current = null;
    return true;
  }

  function ensureThread(traced) {
    if (current) return current;
    const created = launchReadThread(traced ? { ...launchConfig, trace: true } : launchConfig);
    if (traced) created.traceState = { bornAt: wallNow(), readyAt: null, launchMs: null, sent: 0 };
    current = created;
    created.on("message", (message) => {
      dispatch(created, message);
    });
    created.on("error", (error) => {
      crashed(created, error);
    });
    created.on("exit", (code) => {
      exited(created, code);
    });
    return created;
  }

  function crashed(thread, error) {
    if (!detach(thread)) return;
    const outOfMemory = error?.code === "ERR_WORKER_OUT_OF_MEMORY";
    const text = outOfMemory
      ? GAME_READ_OUT_OF_MEMORY
      : STOPPED_PREFIX + String(error?.message || error || "поток закрылся");
    ledger.rejectAll(text, outOfMemory ? "WORKER_OOM" : "WORKER_CRASH");
    if (thread.traceState) flushAwaiting(thread);
  }

  function exited(thread, code) {
    if (!detach(thread)) return;
    if (ledger.size > 0) ledger.rejectAll(`${STOPPED_PREFIX}код ${code}`, "WORKER_EXIT");
    if (thread.traceState) flushAwaiting(thread);
  }

  function cancelJob(id) {
    const job = ledger.find(id);
    if (!job) return;
    ledger.forget(id);
    job.closeTrace?.("ABORT_ERR");
    job.reject(abortFailure());
    if (ledger.size === 0) stop();
  }

  // Нативный вызов потока: ответ уходит спустя те же три шага микрозадач.
  async function replyToNative(thread, nativeCall) {
    const { id, command, input } = nativeCall;
    await null;
    let reply;
    try {
      reply = { id, result: await native(command, input) };
    } catch (error) {
      const failure = { message: String(error?.message || error), code: error?.code ?? null };
      reply = { id, error: failure };
    }
    await null;
    try {
      thread.postMessage({ nativeReply: reply });
    } catch {
      // поток уже закрыт
    }
  }

  function settleReply(id, progress, error, result) {
    const job = id ? ledger.find(id) : undefined;
    if (!job) return;
    const call = job.trace;
    if (progress !== undefined) {
      if (call) call.progress += 1;
      job.onProgress?.(progress);
      return;
    }
    if (call) {
      call.recvAt = wallNow();
      call.ok = !error;
      call.error = error ? "Error" : undefined;
      awaiting.set(call.id, call);
    }
    ledger.discharge(id);
    const verdict = error ? ["reject", failureFrom(error)] : ["resolve", result];
    job[verdict[0]](verdict[1]);
    restIfIdle();
  }

  // Строка трассы вызова: данные хоста плюс хвост от потока (если он дошёл).
  function writeCall(call, tail) {
    awaiting.delete(call.id);
    writeRow(composeRow(call, tail, call.thread.traceState));
  }

  // Вызов закончился без ответа потока (отмена, поток упал): строка только с данными хоста.
  function closeWithout(call, kind) {
    call.recvAt = wallNow();
    call.ok = false;
    call.error = kind;
    writeCall(call, null);
  }

  // Ответ пришёл, а хвоста нет (поток остановлен до него): строка без полей потока.
  function flushAwaiting(thread) {
    for (const call of [...awaiting.values()]) if (call.thread === thread) writeCall(call, null);
  }

  // Сообщения трассы потока: «готов» (запуск потока) и хвост вызова. Остальное — обычный путь.
  function traceMessage(thread, message) {
    const state = thread.traceState;
    if (message?.ready) {
      state.readyAt = wallNow();
      state.launchMs = state.readyAt - state.bornAt;
      return true;
    }
    const tail = message?.trace;
    if (!tail) return false;
    const call = awaiting.get(tail.id);
    if (call) writeCall(call, tail);
    return true;
  }

  // Начало вызова с трассой: метки хоста; сообщение потоку остаётся таким же, как без трассы.
  function beginTrace(id, thread, exportName, transfer, enteredAt, keys) {
    const state = thread.traceState;
    const job = ledger.find(id);
    const call = {
      id,
      thread,
      module: label,
      exportName,
      enteredAt: keys?.enteredAt ?? enteredAt,
      keysMs: keys?.keysMs,
      first: state.sent === 0,
      transfer: Boolean(transfer),
      concurrent: ledger.size,
      progress: 0,
      sentAt: wallNow(),
      recvAt: 0,
      ok: undefined,
      error: undefined,
    };
    state.sent += 1;
    job.trace = call;
    job.closeTrace = (kind) => closeWithout(call, kind);
  }

  function dispatch(thread, message) {
    if (thread.traceState && traceMessage(thread, message)) return;
    const { log: entry, nativeCall, id, progress, error, result } = message ?? {};
    if (entry) {
      log?.(entry);
      return;
    }
    if (nativeCall) {
      replyToNative(thread, nativeCall);
      return;
    }
    settleReply(id, progress, error, result);
  }

  function enlist(signal, onProgress, resolve, reject) {
    const id = ledger.issue();
    const job = newJob(resolve, reject, onProgress, signal, () => cancelJob(id));
    signal?.addEventListener("abort", job.abort, { once: true });
    ledger.add(id, job);
    return id;
  }

  function callWithTools(exportName, args, toolsAt, callOptions = {}) {
    const transfer = callOptions.transfer === undefined ? false : callOptions.transfer;
    const progressAt = callOptions.progressAt === undefined ? null : callOptions.progressAt;
    const onProgress = callOptions.onProgress === undefined ? null : callOptions.onProgress;
    const signal = callOptions.signal === undefined ? null : callOptions.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortFailure());
        return;
      }
      idle.hold();
      const traced = current ? Boolean(current.traceState) : tracing();
      const enteredAt = traced ? wallNow() : 0;
      const thread = ensureThread(traced);
      const id = enlist(signal, onProgress, resolve, reject);
      if (traced) beginTrace(id, thread, exportName, transfer, enteredAt, callOptions.traceKeys);
      thread.postMessage({ id, exportName, args, toolsAt, transfer, progressAt });
    });
  }

  function call(exportName, ...args) {
    return callWithTools(exportName, args, null);
  }

  function running() {
    return current !== null;
  }

  function jobs() {
    return ledger.size;
  }

  return { call, callWithTools, close: stop, running, jobs };
}

// --- реестр: один поток на модуль читателя -----------------------------------

const hosts = new Map();

function engineDefaults() {
  const packaged = runtimePaths.appPackaged();
  const resourcesPath = runtimePaths.appResourcesPath();
  return { packaged, resourcesPath, projectRoot };
}

function withoutFunctions(source) {
  const isPlain = ([, value]) => typeof value !== "function";
  return Object.fromEntries(Object.entries(source).filter(isPlain));
}

function plainContext(nativeContext) {
  const given = typeof nativeContext === "function" ? nativeContext() : null;
  if (given) return withoutFunctions(given);
  return engineDefaults();
}

function registerHost(module, nativeContext) {
  const host = createGameReadHost({
    module,
    idleMs: readerIdleMs(module),
    native: (command, input) => {
      const nativeSide = typeof nativeContext === "function" ? nativeContext() : engineDefaults();
      return callNativeEngine(command, input, nativeSide);
    },
    context: () => plainContext(nativeContext),
    log: (entry) => appLog.record(entry),
  });
  const routed = withRustReaders(module, host, nativeContext);
  hosts.set(module, routed);
  return routed;
}

/*
 * Подмена читателя на команду движка (`rust-readers.js`, `ASTRAL_RUST_READERS`): вызов пары «модуль + экспорт», для которой включён переходник, уходит в поток переходника (свой хост
 * на его модуль), остальные — в свой поток, как были. Выключено — одна проверка переменной окружения на вызов, сообщение потоку то же.
 */
function withRustReaders(module, host, nativeContext) {
  const callWithTools = (exportName, args, toolsAt, callOptions) => {
    const adapter = rustReaderFor(module, exportName);
    const target = adapter ? hostFor(adapter, nativeContext) : host;
    return callOptions === undefined ? target.callWithTools(exportName, args, toolsAt) : target.callWithTools(exportName, args, toolsAt, callOptions);
  };
  return { ...host, callWithTools, call: (exportName, ...args) => callWithTools(exportName, args, null) };
}

function hostFor(module, nativeContext) {
  const known = hosts.get(module);
  if (known !== undefined && known !== null) return known;
  return registerHost(module, nativeContext);
}

export { hostFor as gameReadHostFor };

onHibernate("game-read", {
  busy() {
    let total = 0;
    for (const host of hosts.values()) total += host.jobs();
    return total > 0 ? `чтение игры: ${total}` : null;
  },
  sleep() {
    for (const host of hosts.values()) host.close();
  },
});

// --- читатели ----------------------------------------------------------------

function defaultArgsOf(request, context, stateDir) {
  return [request, context, stateDir];
}

export function createGameReader(module, exportName, nativeContext, options = {}) {
  const argsOf = options.argsOf === undefined ? defaultArgsOf : options.argsOf;
  const toolsAt = options.toolsAt === undefined ? 3 : options.toolsAt;
  const host = hostFor(module, nativeContext);
  return async (request, stateDir, extra) => {
    /* Трасса (`game-read-trace.js`): время проверки ключей и вход в обёртку; без трассы вызов хоста — как был, без метки времени. */
    const entered = traceWanted() ? wallNow() : 0;
    const keys = await provisioner.archiveKeysDirectory({
      keys: request?.keys,
      stateDir,
      provision: provisioner.provisionArchiveSupport,
    });
    const input = { ...request, ...(keys ? { keys } : {}) };
    const args = argsOf(input, plainContext(nativeContext), stateDir, extra);
    if (entered) return host.callWithTools(exportName, args, toolsAt, { traceKeys: { enteredAt: entered, keysMs: wallNow() - entered } });
    return host.callWithTools(exportName, args, toolsAt);
  };
}

export function createEffectsReader(module, exportName, nativeContext) {
  return createGameReader(module, exportName, nativeContext);
}
