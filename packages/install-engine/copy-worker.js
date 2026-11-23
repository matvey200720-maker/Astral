import { createHash } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { copyThroughBuffer } from "./buffered-copy.js";
import { setCopyWriteLimitMbps } from "./write-pacing.js";
import { setDiskSampleSink } from "./disk-profile.js";
import { diskThrottleStats, setDiskRest, setDiskRestFactor } from "./disk-care.js";

const SAMPLE_BATCH_SIZE = 16;

// Если workerData не объект, разбор падает с TypeError: поток не должен стартовать без параметров.
const {
  source,
  destination,
  durable = false,
  flags = "w",
  total,
  reportIntervalMs,
  reports,
  writeLimitMbps,
  rest = true,
  restFactor = 1,
} = workerData;

// Потолок записи и отдых диска: при старте и на лету, когда их меняют посреди копии.
function applyLimits(limits) {
  setCopyWriteLimitMbps(limits.writeLimitMbps);
  setDiskRest(limits.rest !== false);
  setDiskRestFactor(limits.restFactor ?? 1);
}

// Описание отказа: каждое поле берётся из исключения, а при его отсутствии — из запасного значения.
const FAILURE_FIELDS = {
  message: (error) => String(error),
  code: () => null,
  name: () => null,
};

function describeFailure(error) {
  const fields = Object.entries(FAILURE_FIELDS).map(([field, fallback]) => [field, error?.[field] ?? fallback(error)]);
  return Object.fromEntries(fields);
}

// Единственные формы сообщений родителю.
const OUTGOING = {
  samples: (items) => ({ diskSamples: items }),
  progress: (copied, outOf) => ({ progress: { copied, total: outOf } }),
  throttle: (stats) => ({ diskThrottle: stats }),
  done: (sha256) => ({ done: sha256 }),
  failure: (error) => ({ error: describeFailure(error) }),
};

const post = (message) => parentPort.postMessage(message);

// Замеры диска копятся пачками по 16; остаток уходит только при успешной копии.
class SampleBatch {
  #pending = [];

  add(sample) {
    this.#pending.push(sample);
    if (this.#pending.length >= SAMPLE_BATCH_SIZE) {
      this.flush();
    }
  }

  flush() {
    if (this.#pending.length > 0) {
      post(OUTGOING.samples(this.#pending));
      this.#pending = [];
    }
  }
}

// Ход: сообщение шлётся, когда скопировано всё или вышла пауза; нечисловые значения глушат ход.
function progressReporter() {
  if (!reports) {
    return () => {};
  }
  const spacing = Number(reportIntervalMs);
  const spacingUsable = !Number.isNaN(spacing);
  let copied = 0;
  let quietUntil = -Infinity;
  return (chunkBytes) => {
    copied += chunkBytes;
    const now = performance.now();
    if (copied >= total || (spacingUsable && now >= quietUntil)) {
      quietUntil = now + spacing;
      post(OUTGOING.progress(copied, total));
    }
  };
}

// Обработчик куска: отпечаток считается по прочитанным байтам, ход уходит до записи куска.
function chunkHandler(hash, reportProgress) {
  return (chunk) => {
    hash.update(chunk);
    reportProgress(chunk.length);
  };
}

async function copyAndReport() {
  const cancellation = new AbortController();
  const onParentMessage = (message) => {
    if (message?.abort) {
      cancellation.abort();
    }
    if (message?.limits) {
      applyLimits(message.limits);
    }
  };
  parentPort.on("message", onParentMessage);

  const hash = createHash("sha256");
  const samples = new SampleBatch();
  setDiskSampleSink((kind, bytes, ms, place) => samples.add([kind, bytes, ms, place]));

  try {
    await copyThroughBuffer(source, destination, {
      signal: cancellation.signal,
      flags,
      durable,
      onChunk: chunkHandler(hash, progressReporter()),
    });
    samples.flush();
    if (process.env.ASTRAL_DISK_THROTTLE) {
      post(OUTGOING.throttle(diskThrottleStats()));
    }
    post(OUTGOING.done(hash.digest("hex")));
  } catch (error) {
    post(OUTGOING.failure(error));
  } finally {
    // Без слушателя порт не держит поток: он завершается сам с кодом 0.
    parentPort.off("message", onParentMessage);
  }
}

applyLimits({ writeLimitMbps, rest, restFactor });
await copyAndReport();
