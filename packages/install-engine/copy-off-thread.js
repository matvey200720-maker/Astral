import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { abortError, copyThroughBuffer } from "./buffered-copy.js";
import { copyWriteLimitBytes, onCopyWriteLimitChange } from "./write-pacing.js";
import { noteDiskOp } from "./disk-profile.js";
import { addDiskThrottleStats, diskRestEnabled, diskRestFactor, onDiskRestChange, onDiskRestFactorChange } from "./disk-care.js";

export const WORKER_MIN_BYTES = 16 * 1024 * 1024;

const MIB = 1024 * 1024;
const FORCE_STOP_MS = 5000;
const NO_ANSWER_TEXT = "Поток копии закрылся без ответа.";
const DEFAULT_WORKER_URL = new URL("./copy-worker.js", import.meta.url);

const ignore = () => {};

/*
 * Потолок записи и отдых диска — потоку копии на лету (13.11.2026, «Быстрая установка»): раньше поток брал потолок один
 * раз при старте, и кнопка, нажатая посреди копии двух гигабайт, до конца этой копии не действовала.
 */
const liveRuns = new Set();
const currentLimits = () => {
  const ceiling = copyWriteLimitBytes();
  return { writeLimitMbps: ceiling === null ? 0 : Math.floor(ceiling / MIB), rest: diskRestEnabled(), restFactor: diskRestFactor() };
};
const tellLiveRuns = () => {
  for (const run of liveRuns) run.tell({ limits: currentLimits() });
};
onCopyWriteLimitChange(tellLiveRuns);
onDiskRestChange(tellLiveRuns);
onDiskRestFactorChange(tellLiveRuns);

// Большие копии идут по одной: каждая ждёт, пока освободится хвост очереди.
let queueTail = Promise.resolve();
// Порядок в очереди — порядок вызовов, даже если stat позднего вызова вернулся раньше:
// решение «мелкая или большая» каждого вызова закрывается по цепочке.
let lastDecision = Promise.resolve();

function joinBigCopyQueue() {
  const turn = queueTail;
  let release;
  queueTail = new Promise((resolve) => {
    release = resolve;
  });
  return { turn, release };
}

function deferred() {
  const parts = {};
  parts.promise = new Promise((resolve, reject) => {
    parts.resolve = resolve;
    parts.reject = reject;
  });
  return parts;
}

// Прореживание хода: следующий отчёт не раньше nextDueAt; первый кусок и «скопировано всё» — всегда.
// Нечисловой интервал или total глушат ход, как и сравнения с мусором.
class ProgressMeter {
  constructor(onProgress, total, intervalMs) {
    this.onProgress = onProgress;
    this.total = total;
    this.spacing = Number(intervalMs);
    this.nextDueAt = -Infinity;
    this.copied = 0;
  }

  advance(bytes) {
    this.copied += bytes;
    if (!this.onProgress) {
      return;
    }
    const now = performance.now();
    const spaced = !Number.isNaN(this.spacing) && now >= this.nextDueAt;
    if (this.copied >= this.total || spaced) {
      this.nextDueAt = now + this.spacing;
      this.onProgress(this.copied, this.total);
    }
  }
}

// Копия в этом же потоке: отпечаток по каждому куску, ход по интервалу.
async function copyHere({ source, destination, signal, durable, flags, onProgress, reportIntervalMs }, total) {
  const hash = createHash("sha256");
  const meter = new ProgressMeter(onProgress, total, reportIntervalMs);
  const absorb = (chunk) => {
    hash.update(chunk);
    meter.advance(chunk.length);
  };
  await copyThroughBuffer(source, destination, { onChunk: absorb, flags, durable, signal });
  return { sha256: hash.digest("hex") };
}

function startWorker(workerUrl, workerData) {
  try {
    return new Worker(workerUrl, { workerData });
  } catch {
    return null;
  }
}

function failureToError(failure) {
  const error = new Error(failure?.message || NO_ANSWER_TEXT);
  if (failure?.code) {
    error.code = failure.code;
  }
  if (failure?.name) {
    error.name = failure.name;
  }
  return error;
}

// Что делать с сообщением потока; ключи разбираются в этом порядке.
const MESSAGE_HANDLERS = {
  diskThrottle: (run, stats) => addDiskThrottleStats(stats),
  diskSamples: (run, samples) => {
    for (const [kind, bytes, ms, place] of samples) {
      noteDiskOp(kind, bytes, ms, place);
    }
  },
  progress: (run, { copied, total }) => {
    if (typeof run.onProgress === "function") {
      run.onProgress(copied, total);
    }
  },
  done: (run, sha256) => {
    if (typeof sha256 === "string" && sha256 !== "") {
      run.verdict = { sha256 };
    }
  },
  error: (run, failure) => {
    if (failure) {
      run.verdict = { failure };
    }
  },
};

// Один запущенный поток копии: итог — последний из ответов done/error, отмена и принудительная остановка.
class WorkerRun {
  constructor(worker, { signal, onProgress }) {
    this.worker = worker;
    this.signal = signal;
    this.onProgress = onProgress;
    this.verdict = null;
    this.cancelled = false;
    this.killTimer = null;
    this.outcome = deferred();
  }

  // Сообщение потоку; поток, который уже закрылся, его не получит — это не ошибка.
  tell(message) {
    try {
      this.worker.postMessage(message);
    } catch {
      /* порт закрыт */
    }
  }

  start() {
    liveRuns.add(this);
    this.signal?.addEventListener?.("abort", this.requestStop, { once: true });
    this.worker.on("message", this.receive);
    this.worker.on("error", this.crashed);
    this.worker.once("exit", this.finish);
    return this.outcome.promise;
  }

  requestStop = () => {
    this.cancelled = true;
    this.worker.postMessage({ abort: true });
    this.killTimer = setTimeout(() => this.worker.terminate().catch(ignore), FORCE_STOP_MS);
  };

  receive = (message) => {
    if (message === null || typeof message !== "object") {
      return;
    }
    for (const [key, handle] of Object.entries(MESSAGE_HANDLERS)) {
      if (message[key] != null) {
        handle(this, message[key]);
      }
    }
  };

  // Событие ошибки потока значимо, только пока ответа ещё не было.
  crashed = (exception) => {
    if (this.verdict === null) {
      this.verdict = {
        failure: { message: exception?.message, code: exception?.code ?? null, name: exception?.name ?? null },
      };
    }
  };

  finish = () => {
    liveRuns.delete(this);
    clearTimeout(this.killTimer);
    this.signal?.removeEventListener?.("abort", this.requestStop);
    if (this.verdict?.sha256) {
      this.outcome.resolve({ sha256: this.verdict.sha256 });
    } else if (this.cancelled) {
      this.outcome.reject(abortError(this.signal));
    } else {
      this.outcome.reject(failureToError(this.verdict?.failure));
    }
  };
}

export async function copyFileOffThread(source, destination, options = {}) {
  // Параметры null дают TypeError именно здесь: null не заменяется умолчанием.
  const signal = options.signal ?? null;
  if (signal?.aborted) {
    throw abortError(signal);
  }
  const {
    durable = false,
    flags = "w",
    onProgress = null,
    reportIntervalMs = 50,
    workerUrl = DEFAULT_WORKER_URL,
  } = options;

  const earlierCalls = lastDecision;
  let decided;
  lastDecision = new Promise((resolve) => {
    decided = resolve;
  });

  let size;
  let place = null;
  try {
    ({ size } = await stat(source));
    if (size >= WORKER_MIN_BYTES) {
      await earlierCalls;
      place = joinBigCopyQueue();
    }
  } finally {
    decided();
  }

  const job = { source, destination, signal, durable, flags, onProgress, reportIntervalMs };
  if (place === null) {
    return copyHere(job, size);
  }

  try {
    await place.turn;
    if (signal?.aborted) {
      throw abortError(signal);
    }
    const reports = typeof onProgress === "function";
    const worker = startWorker(workerUrl, {
      source,
      destination,
      durable,
      flags,
      total: reports ? size : 0,
      reports,
      reportIntervalMs,
      ...currentLimits(),
    });
    if (worker === null) {
      return await copyHere(job, size);
    }
    return await new WorkerRun(worker, job).start();
  } finally {
    place.release();
  }
}
