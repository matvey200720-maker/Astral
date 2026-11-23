import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fingerprintSha256, rememberSha256 } from "./file-fingerprint.js";
import { resolveInside } from "./manifest.js";
import { throwIfAborted } from "./runtime-guard.js";
import { paceDownload } from "./download-pacing.js";
import { renameWithRetry } from "./engine-state.js";
import {
  CAREFUL_MIN_BYTES,
  DISK_BLOCK_BYTES,
  carefulReadFlags,
  carefulWrite,
  carefulWriteFlags,
  createBlockWriter,
  diskMemoryIsLow,
  diskTurn,
} from "./disk-care.js";
import { WORKER_MIN_BYTES, copyFileOffThread } from "./copy-off-thread.js";

export const PACKAGE_FILE_DEFAULTS = Object.freeze({
  minFileBytes: 64 * 1024 * 1024,
  connections: 6,
  blockBytes: 4 * 1024 * 1024,
  blockRetries: 4,
  retryDelayMs: 800,
  stallTimeoutMs: 30000,
  writeBytes: DISK_BLOCK_BYTES,
  carefulBytes: CAREFUL_MIN_BYTES,
});

const SPACE_RESERVE_BYTES = 64 * 1024 * 1024;
const HIRE_POLL_MS = 250;
const BLOCK_PROGRESS_MS = 100;
const SIZE_MESSAGE = "Пакет превышает допустимый размер.";
const NETWORK_MARKERS = [
  "fetch failed",
  "terminated",
  "other side closed",
  "socket hang up",
  "econnreset",
  "econnrefused",
  "etimedout",
  "eai_again",
  "enotfound",
  "enetunreach",
  "epipe",
  "und_err",
];

const defaultFetch = (url, init) => fetch(url, init);
const UNSUPPORTED = Symbol("range-unsupported");

// ---------- Ошибки и их распознавание ----------

function sizeError() {
  return new Error(SIZE_MESSAGE);
}

function resetError(message) {
  return Object.assign(new Error(message), { code: "ECONNRESET" });
}

const stalledError = () => resetError("fetch failed: данные не приходят слишком долго");
const cutShortError = () => resetError("fetch failed: поток оборвался раньше конца");
const httpError = (file, status) => new Error(`Не удалось скачать ${file.source}: HTTP ${status}`);

function isNetworkError(error) {
  if (error?.name === "AbortError") return false;
  const haystack = [error?.message, error?.code, error?.cause?.code, error?.cause?.message]
    .join(" ")
    .toLowerCase();
  return NETWORK_MARKERS.some((marker) => haystack.includes(marker));
}

function isRetryableBlockError(error) {
  if (error?.name === "AbortError") return false;
  if (isNetworkError(error)) return true;
  return /HTTP (?:5\d\d|429)/.test(String(error?.message));
}

// ---------- Мелкие помощники ----------

async function removeQuietly(file) {
  await fs.rm(file, { force: true }).catch(() => {});
}

async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

const stagingName = (destination) => `${destination}.${process.pid}.${randomUUID()}.download`;

function connectionCount(setting) {
  const raw = typeof setting === "function" ? setting() : setting;
  return Math.max(1, Math.floor(Number(raw) || 1));
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === "*" ? null : Number(match[3]) };
}

function rangeHeaders(range) {
  return { Accept: "application/octet-stream", Range: range, "Accept-Encoding": "identity" };
}

// Читает тело ответа кусками; сторож тишины и отмена закрывают чтение.
async function pumpBody(body, { signal, stallTimeoutMs }, onChunk) {
  const reader = body.getReader();
  const watchStall = Number.isFinite(stallTimeoutMs) && stallTimeoutMs > 0;
  let stalled = false;
  let timer = null;
  const closeReader = () => {
    reader.cancel().catch(() => {});
  };
  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  signal?.addEventListener("abort", closeReader, { once: true });
  if (signal?.aborted) closeReader();
  try {
    for (;;) {
      if (signal?.aborted) break;
      if (watchStall) {
        timer = setTimeout(() => {
          stalled = true;
          closeReader();
        }, stallTimeoutMs);
      }
      let step;
      try {
        step = await reader.read();
      } finally {
        disarm();
      }
      if (step.done) break;
      await paceDownload(step.value.length, { signal });
      await onChunk(step.value);
    }
  } catch (error) {
    closeReader();
    throw error;
  } finally {
    disarm();
    signal?.removeEventListener("abort", closeReader);
  }
  if (stalled) throw stalledError();
  throwIfAborted(signal);
}

function sleepAbortable(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

// Ожидание перемен: будится явно или по таймеру.
class Wakeups {
  #waiters = new Set();

  wake() {
    const waiters = [...this.#waiters];
    this.#waiters.clear();
    for (const wake of waiters) wake();
  }

  wait(ms) {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.#waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.#waiters.add(finish);
    });
  }
}

// ---------- Файл, в который пишется загрузка ----------

class DownloadSink {
  constructor({ filePath, resumed, careful, bufferBytes, signal, place, startBytes }) {
    this.filePath = filePath;
    this.resumed = resumed;
    this.careful = careful;
    this.startBytes = startBytes;
    this.diskBytes = 0;
    this.bufferBytes = bufferBytes;
    this.signal = signal;
    this.place = place;
    this.handle = null;
    this.writer = null;
    this.closed = false;
  }

  async open() {
    const mode = this.resumed ? "a" : "wx";
    const flags = this.careful ? carefulWriteFlags(mode) : mode;
    this.handle = await fs.open(this.filePath, flags);
    this.writer = createBlockWriter(this.handle, {
      bufferBytes: this.bufferBytes,
      careful: this.careful,
      signal: this.signal,
      place: this.place,
    });
  }

  // Сколько байт уже на диске, считается по изменению pending писателя.
  get writtenBytes() {
    return this.startBytes + this.diskBytes;
  }

  async append(chunk) {
    const before = this.writer.pending;
    await this.writer.append(chunk);
    this.diskBytes += before + chunk.length - this.writer.pending;
  }

  async flush() {
    const before = this.writer.pending;
    await this.writer.flush();
    this.diskBytes += before - this.writer.pending;
  }

  // Блок режима блоков пишется напрямую; накопленное в буфере уходит раньше, чтобы порядок байт сохранился.
  async writeBlock(block) {
    await this.flush();
    await carefulWrite(this.handle, block, { signal: this.signal, place: this.place });
    this.diskBytes += block.length;
  }

  async seal() {
    await this.flush();
    if (this.careful) await this.handle.datasync();
    await this.handle.close();
    this.closed = true;
  }

  async dropHandle() {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close().catch(() => {});
  }
}

// ---------- Одна загрузка файла ----------

class PackageDownload {
  constructor({ file, targetUrl, destination, signal, budget, onBytes, parallel, fetchImpl, carry }) {
    this.file = file;
    this.targetUrl = targetUrl;
    this.destination = destination;
    this.signal = signal;
    this.budget = budget;
    this.onBytes = onBytes;
    this.fetchImpl = fetchImpl;
    this.carry = carry;
    this.settings = { ...PACKAGE_FILE_DEFAULTS, ...parallel };
    this.knownSize = Number.isSafeInteger(file.size) && file.size > 0 ? file.size : 0;
    this.expectedHash = file.sha256;
    this.partPath = this.expectedHash ? `${destination}.${this.expectedHash}.part` : null;
    this.careful = this.knownSize > 0 && this.knownSize >= this.settings.carefulBytes;
    this.offset = 0;
    this.hash = null;
    this.sink = null;
  }

  async run() {
    if (this.knownSize > this.budget.maxFileBytes || this.budget.total + this.knownSize > this.budget.maxTotalBytes) {
      throw sizeError();
    }
    throwIfAborted(this.signal);
    await this.pickResumePoint();

    let outcome;
    try {
      outcome = await this.transfer();
    } catch (error) {
      await this.keepOrDiscard(error);
      throw error;
    }
    return this.complete(outcome);
  }

  // З-3: откуда продолжать и каков хэш уже лежащего начала.
  async pickResumePoint() {
    const { carry, partPath, file } = this;
    if (partPath) {
      const stat = await statOrNull(partPath);
      if (stat?.isFile() && stat.size > 0 && (!file.size || stat.size < file.size)) {
        this.offset = stat.size;
        this.hash = await this.hashOfStart(stat.size);
      }
    }
    if (!this.hash && this.offset === 0 && file.sha256) this.hash = createHash("sha256");
    if (carry) carry.hash = null;
  }

  async hashOfStart(offset) {
    const { carry, partPath } = this;
    if (carry?.hash && carry.bytes === offset) return carry.hash;
    const hash = createHash("sha256");
    const handle = await fs.open(partPath, carefulReadFlags());
    let total = 0;
    try {
      const buffer = Buffer.allocUnsafe(Math.min(DISK_BLOCK_BYTES, offset));
      while (total < offset) {
        const length = Math.min(buffer.length, offset - total);
        const { bytesRead } = await diskTurn(() => handle.read(buffer, 0, length, null), {
          signal: this.signal,
          measure: { kind: "read", bytes: length, place: partPath },
        });
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
        total += bytesRead;
      }
    } finally {
      await handle.close();
    }
    if (total === offset) return hash;
    await removeQuietly(partPath);
    this.offset = 0;
    return null;
  }

  // З-4: выбор способа.
  async transfer() {
    const connections = connectionCount(this.settings.connections);
    const wantsBlocks =
      this.knownSize > 0 && this.knownSize - this.offset >= this.settings.minFileBytes && connections > 1;
    if (wantsBlocks) {
      const blocks = await new BlockTransfer(this).run();
      if (blocks) return blocks;
    }
    return this.singleStream();
  }

  async openSink(offset) {
    const resumed = offset > 0;
    const sink = new DownloadSink({
      filePath: resumed ? this.partPath : stagingName(this.destination),
      resumed,
      careful: this.careful,
      bufferBytes: this.knownSize > 0 ? Math.min(this.settings.writeBytes, this.knownSize) : this.settings.writeBytes,
      signal: this.signal,
      place: this.destination,
      startBytes: offset,
    });
    await sink.open();
    this.sink = sink;
  }

  // З-5: один поток.
  async singleStream() {
    const { file, settings } = this;
    const resuming = this.offset > 0;
    const headers = { Accept: "application/octet-stream" };
    if (resuming) {
      headers.Range = `bytes=${this.offset}-`;
      headers["Accept-Encoding"] = "identity";
    }
    const response = await this.fetchImpl(this.targetUrl, { redirect: "error", headers, signal: this.signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw httpError(file, response.status);
    }

    if (resuming) {
      const range = parseContentRange(response.headers.get("content-range"));
      if (!(response.status === 206 && range && range.start === this.offset)) {
        this.offset = 0;
        this.hash = file.sha256 ? createHash("sha256") : null;
      }
    }
    const offset = this.offset;
    const declared = offset + Number(response.headers.get("content-length") || 0) || this.knownSize;
    if (declared > this.budget.maxFileBytes) {
      await response.body.cancel().catch(() => {});
      throw sizeError();
    }

    await this.openSink(offset);
    const { sink, budget, hash } = this;
    budget.total += offset;
    let fileBytes = offset;
    await pumpBody(response.body, { signal: this.signal, stallTimeoutMs: settings.stallTimeoutMs }, async (chunk) => {
      fileBytes += chunk.length;
      budget.total += chunk.length;
      if (fileBytes > budget.maxFileBytes || budget.total > budget.maxTotalBytes) throw sizeError();
      hash?.update(chunk);
      await sink.append(chunk);
      this.onBytes?.(fileBytes, declared, offset);
    });
    if (declared > 0 && fileBytes < declared) throw cutShortError();
    await sink.seal();
    return { fileBytes, declared };
  }

  // З-9: что делать с начатым файлом при ошибке.
  async keepOrDiscard(error) {
    const sink = this.sink;
    if (!sink) return;
    const cancelled = error?.name === "AbortError" || this.signal?.aborted === true;
    if (!sink.closed) {
      if (!cancelled) await sink.flush().catch(() => {});
      await sink.dropHandle();
    }
    const keepable =
      Boolean(this.expectedHash) && !cancelled && error?.message !== SIZE_MESSAGE && sink.writtenBytes > 0;
    if (!keepable) {
      await removeQuietly(sink.filePath);
      if (cancelled && this.partPath) await removeQuietly(this.partPath);
      return;
    }
    if (sink.filePath !== this.partPath) {
      try {
        await fs.rename(sink.filePath, this.partPath);
      } catch {
        await removeQuietly(sink.filePath);
        return;
      }
    }
    if (this.carry && sink.writer.pending === 0) {
      this.carry.hash = this.hash;
      this.carry.bytes = sink.writtenBytes;
    }
  }

  // З-7: сверка хэша и постановка на место.
  async complete({ fileBytes, declared }) {
    const { sink, file, hash } = this;
    const digest = hash ? hash.digest("hex") : null;
    if (file.sha256 && digest !== file.sha256) {
      await removeQuietly(sink.filePath);
      throw new Error(`Контрольная сумма загруженного файла не совпала: ${file.source}`);
    }
    try {
      await renameWithRetry(sink.filePath, this.destination);
    } catch (error) {
      await removeQuietly(sink.filePath);
      throw error;
    }
    if (this.partPath && sink.filePath !== this.partPath) await removeQuietly(this.partPath);
    if (digest) await rememberSha256(this.destination, digest);
    return { fileBytes, declared };
  }
}

// ---------- Загрузка блоками на нескольких соединениях ----------

class BlockTransfer {
  constructor(download) {
    this.d = download;
    const { settings } = download;
    const size = download.knownSize;
    this.size = size;
    this.offset = download.offset;
    const blockBytes = Number(settings.blockBytes);
    this.blockBytes = blockBytes > 0 && Number.isFinite(blockBytes) ? Math.floor(blockBytes) : PACKAGE_FILE_DEFAULTS.blockBytes;
    this.count = Math.ceil((size - this.offset) / this.blockBytes);
    this.nextIndex = 1;
    this.nextToWrite = 0;
    this.ready = new Map();
    this.drainChain = Promise.resolve();
    this.live = 0;
    this.received = this.offset;
    this.lastReport = 0;
    this.firstError = null;
    this.wakeups = new Wakeups();
    this.inner = new AbortController();
    this.runs = [];
    this.unreadProbe = null;
  }

  get innerSignal() {
    return this.inner.signal;
  }

  blockRange(index) {
    const start = this.offset + index * this.blockBytes;
    const end = Math.min(start + this.blockBytes, this.size) - 1;
    return { start, end };
  }

  // Возвращает результат загрузки или null, если сервер не понимает Range.
  async run() {
    const { d } = this;
    const { signal } = d;
    const relay = () => this.inner.abort(signal.reason);
    if (signal?.aborted) relay();
    else signal?.addEventListener("abort", relay, { once: true });
    try {
      const probe = await this.probe();
      if (probe === UNSUPPORTED) return null;
      this.unreadProbe = probe;
      return await this.transferAll(probe);
    } finally {
      signal?.removeEventListener("abort", relay);
      // Ответ пробы, который так и не начали читать, закрывается.
      if (this.unreadProbe) await this.unreadProbe.body.cancel().catch(() => {});
      this.unreadProbe = null;
    }
  }

  // Проба проверяет только запрос и заголовки; тело блока 0 читает первый работник.
  async probe() {
    try {
      return await this.requestBlock(0, true);
    } catch (error) {
      if (isRetryableBlockError(error)) return null;
      throw error;
    }
  }

  report(force = false) {
    const now = Date.now();
    if (!force && now - this.lastReport < BLOCK_PROGRESS_MS) return;
    this.lastReport = now;
    this.d.onBytes?.(Math.min(this.received, this.size), this.size, this.offset);
  }

  async requestBlock(index, isProbe = false) {
    const { d } = this;
    const { start, end } = this.blockRange(index);
    const response = await d.fetchImpl(d.targetUrl, {
      redirect: "error",
      headers: rangeHeaders(`bytes=${start}-${end}`),
      signal: this.innerSignal,
    });
    if (isProbe && response.status === 200 && response.ok && response.body) {
      await response.body.cancel().catch(() => {});
      return UNSUPPORTED;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw httpError(d.file, response.status);
    }
    const range = parseContentRange(response.headers.get("content-range"));
    const exact =
      response.status === 206 &&
      range !== null &&
      range.start === start &&
      range.end === end &&
      (range.total === null || range.total === this.size);
    if (!exact) {
      await response.body.cancel().catch(() => {});
      throw new Error(`Не удалось скачать ${d.file.source}: сервер вернул не тот блок`);
    }
    return response;
  }

  // Читает тело уже принятого ответа в буфер блока.
  async readBlock(index, response) {
    const { d } = this;
    const { start, end } = this.blockRange(index);
    const length = end - start + 1;
    const block = Buffer.allocUnsafe(length);
    let filled = 0;
    await pumpBody(response.body, { signal: this.innerSignal, stallTimeoutMs: d.settings.stallTimeoutMs }, (chunk) => {
      if (filled + chunk.length > length) throw cutShortError();
      block.set(chunk, filled);
      filled += chunk.length;
      this.received += chunk.length;
      this.report();
    });
    if (filled !== length) throw cutShortError();
    return block;
  }

  // Первая попытка может взять уже принятый ответ; повторы всегда спрашивают сервер заново.
  async fetchWithRetries(index, firstResponse = null) {
    const { settings } = this.d;
    const attempts = Math.max(1, Number(settings.blockRetries) || 1);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = attempt === 1 && firstResponse !== null ? firstResponse : await this.requestBlock(index);
        return await this.readBlock(index, response);
      } catch (error) {
        if (attempt >= attempts || this.innerSignal.aborted || !isRetryableBlockError(error)) throw error;
        await sleepAbortable(settings.retryDelayMs * attempt, this.innerSignal);
        throwIfAborted(this.innerSignal);
      }
    }
  }

  windowBytes() {
    const connections = connectionCount(this.d.settings.connections);
    return this.blockBytes * connections * (diskMemoryIsLow() ? 1 : 2);
  }

  // Принятые блоки кладутся в файл и хэш строго по порядку.
  deliver(index, block) {
    this.ready.set(index, block);
    const step = this.drainChain.then(async () => {
      while (this.ready.has(this.nextToWrite)) {
        const next = this.ready.get(this.nextToWrite);
        this.ready.delete(this.nextToWrite);
        this.d.hash?.update(next);
        await this.d.sink.writeBlock(next);
        this.nextToWrite += 1;
        this.wakeups.wake();
      }
    });
    this.drainChain = step;
    return step;
  }

  fail(error) {
    if (this.firstError === null && error?.name !== "AbortError") this.firstError = error;
    this.inner.abort();
    this.wakeups.wake();
  }

  async worker(probeResponse, withProbe) {
    try {
      if (withProbe && probeResponse) {
        this.unreadProbe = null;
        await this.deliver(0, await this.fetchWithRetries(0, probeResponse));
      }
      for (;;) {
        if (this.innerSignal.aborted) return;
        if (this.live > connectionCount(this.d.settings.connections) && this.live > 1) return;
        const index = this.nextIndex;
        if (index >= this.count) return;
        if (!(await this.waitForWindow(index))) return;
        if (this.nextIndex !== index) continue;
        this.nextIndex += 1;
        throwIfAborted(this.d.signal);
        const block = await this.fetchWithRetries(index);
        await this.deliver(index, block);
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.live -= 1;
      this.wakeups.wake();
    }
  }

  // Ждёт, пока блок не окажется в окне отставания от записи; false - если остановились.
  async waitForWindow(index) {
    for (;;) {
      if (this.innerSignal.aborted) return false;
      const { start } = this.blockRange(index);
      const written = this.offset + this.nextToWrite * this.blockBytes;
      if (start - written < this.windowBytes()) return true;
      await this.wakeups.wait(HIRE_POLL_MS);
    }
  }

  hire(probeResponse, first) {
    this.live += 1;
    this.runs.push(this.worker(probeResponse, first));
  }

  async transferAll(probeResponse) {
    const { d } = this;
    throwIfAborted(d.signal);
    await d.openSink(this.offset);
    d.budget.total += this.offset;
    const wanted = () => connectionCount(d.settings.connections);

    const initial = Math.min(wanted(), this.count);
    for (let i = 0; i < initial; i += 1) this.hire(probeResponse, i === 0);
    const timer = setInterval(() => {
      while (!this.innerSignal.aborted && this.nextIndex < this.count && this.live < wanted()) {
        this.hire(null, false);
      }
    }, HIRE_POLL_MS);
    try {
      // Работники могут добавляться таймером, поэтому ждём, пока список не перестанет расти.
      for (let seen = 0; seen < this.runs.length; seen = this.runs.length) {
        await Promise.all(this.runs.slice(seen));
      }
    } finally {
      clearInterval(timer);
    }
    while (this.firstError === null && !this.innerSignal.aborted && this.nextToWrite < this.count) {
      await this.wakeups.wait(HIRE_POLL_MS);
    }
    if (this.firstError !== null) throw this.firstError;
    throwIfAborted(d.signal);
    if (this.innerSignal.aborted) throw new DOMException("This operation was aborted", "AbortError");
    this.report(true);
    d.budget.total += this.size - this.offset;
    await d.sink.seal();
    return { fileBytes: this.size, declared: this.size };
  }
}

// ---------- Публичный интерфейс ----------

export async function fetchPackageFile({
  file,
  targetUrl,
  destination,
  signal,
  budget,
  onBytes,
  parallel = {},
  fetchImpl = defaultFetch,
  carry = null,
}) {
  return new PackageDownload({ file, targetUrl, destination, signal, budget, onBytes, parallel, fetchImpl, carry }).run();
}

export async function fetchPackageFileWithRetry(options, { retries = 2, delayMs = 1500, onRetry = null } = {}) {
  const carry = { hash: null, bytes: 0 };
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchPackageFile({ ...options, carry });
    } catch (error) {
      if (!(attempt < retries) || options.signal?.aborted || !isNetworkError(error)) throw error;
      const retryNumber = attempt + 1;
      if (onRetry) onRetry(retryNumber);
      await pauseBeforeRetry(delayMs * retryNumber, options.signal);
    }
  }
}

function pauseBeforeRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (!(ms > 0)) {
      resolve();
      return;
    }
    let timer = null;
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Загрузка отменена."), { name: "AbortError" }));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function localCopyOf(file, { payloadsRoot, downloadsRoot, packageId, destination }) {
  const sha256 = file.sha256;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  const skip = path.resolve(destination);
  for await (const candidate of localCandidates(file, { payloadsRoot, downloadsRoot, packageId })) {
    if (path.resolve(candidate) === skip) continue;
    const stat = await statOrNull(candidate);
    if (!stat?.isFile()) continue;
    if (Number.isInteger(file.size) && stat.size !== file.size) continue;
    if ((await fingerprintSha256(candidate)) === sha256) return candidate;
  }
  return null;
}

async function listNames(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function* localCandidates(file, { payloadsRoot, downloadsRoot, packageId }) {
  yield path.join(payloadsRoot, packageId, file.sha256);
  for (const name of await listNames(payloadsRoot)) {
    if (name === packageId || name.startsWith("_")) continue;
    yield path.join(payloadsRoot, name, file.sha256);
  }
  for (const version of await listNames(path.join(downloadsRoot, packageId))) {
    let candidate;
    try {
      candidate = resolveInside(path.join(downloadsRoot, packageId, version), file.source);
    } catch {
      continue;
    }
    yield candidate;
  }
}

export async function placeLocalCopy(local, destination, expectedSha256 = "") {
  const staging = stagingName(destination);
  try {
    const { size } = await fs.stat(local);
    let copiedHash = null;
    if (process.platform === "win32" && size >= WORKER_MIN_BYTES) {
      const { sha256 } = await copyFileOffThread(local, staging);
      if (expectedSha256 && sha256 !== expectedSha256) {
        throw new Error("Контрольная сумма не совпала при копии файла пакета.");
      }
      copiedHash = sha256;
    } else {
      await fs.copyFile(local, staging, fsConstants.COPYFILE_FICLONE);
    }
    await renameWithRetry(staging, destination);
    if (copiedHash) await rememberSha256(destination, copiedHash).catch(() => {});
  } catch (error) {
    await removeQuietly(staging);
    throw error;
  }
}

function gigabytes(bytes) {
  const value = bytes / 1024 ** 3;
  return value >= 1 ? value.toFixed(1) : value.toFixed(2);
}

export async function assertDownloadSpace({ files, packageRoot, downloadsRoot, statfs = fs.statfs }) {
  let needed = 0;
  for (const file of files) {
    const target = resolveInside(packageRoot, file.source);
    const stat = await statOrNull(target);
    if (!stat?.isFile()) needed += Number(file.size) || 0;
  }
  if (needed === 0 || typeof statfs !== "function") return;

  await fs.mkdir(downloadsRoot, { recursive: true });
  let info;
  try {
    info = await statfs(downloadsRoot);
  } catch {
    return;
  }
  if (!info) return;
  const free = info.bavail * info.bsize;
  const required = needed + SPACE_RESERVE_BYTES;
  if (Number.isFinite(free) && free < required) {
    const root = path.parse(path.resolve(downloadsRoot)).root;
    throw new Error(
      `Недостаточно места на диске ${root} для загрузки: нужно ${gigabytes(required)} ГБ, свободно ${gigabytes(free)} ГБ.`,
    );
  }
}

export function createDownloadShare(files) {
  const known = files.map((file) => Number(file.size)).filter((size) => size > 0);
  const average = known.length > 0 ? known.reduce((sum, size) => sum + size, 0) / known.length : 1;
  const weights = new Map();
  for (const file of files) {
    const size = Number(file.size);
    weights.set(file.source, size > 0 ? size : average);
  }
  let totalWeight = 0;
  for (const weight of weights.values()) totalWeight += weight;
  if (!totalWeight) totalWeight = 1;

  const finished = new Set();
  let finishedWeight = 0;

  return {
    finish(source) {
      if (!weights.has(source) || finished.has(source)) return;
      finished.add(source);
      finishedWeight += weights.get(source);
    },
    fraction(inFlight) {
      let sum = finishedWeight;
      for (const [source, part] of inFlight) {
        if (finished.has(source)) continue;
        sum += (weights.get(source) ?? 0) * part;
      }
      const ratio = sum / totalWeight;
      return Number.isNaN(ratio) ? 0 : Math.min(1, Math.max(0, ratio));
    },
  };
}
