// Доставка одного файла релиза: докачка, повторы, ход загрузки, хэш готового файла.
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fsp from 'node:fs/promises';
import {
  CAREFUL_MIN_BYTES,
  DISK_BLOCK_BYTES,
  carefulReadFlags,
  carefulWriteFlags,
  createBlockWriter,
  diskTurn,
} from '@modovik/install-engine/disk-care.js';
import { paceDownload } from '@modovik/install-engine/download-pacing.js';
import { renameWhenFree } from '../atomic-file.js';

const SMALL_BUFFER_BYTES = 1024 * 1024;
const RETRY_BASE_MS = 400;
const RETRY_CAP_MS = 30000;
const SPEED_WINDOW_MS = 3000;
const TICKET_CODE = 'BETA_TICKET_INVALID';

const noop = () => {};
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DownloadError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    const { retryable = false, status = null } = options;
    Object.assign(this, { name: 'DownloadError', code, retryable, status });
  }
}

const cancelled = () => new DownloadError('ABORTED', 'загрузка отменена');
const networkError = (message) => new DownloadError('NO_NETWORK', message, { retryable: true });
const serverError = (message, status = null) => new DownloadError('SERVER', message, { retryable: true, status });

export const retryWaitMs = (attempt) => Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));

export function abortableSleep(sleep, ms, signal) {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  const unhook = new AbortController();
  const interrupted = once(signal, 'abort', { signal: unhook.signal }).then(() => undefined, () => undefined);
  const finished = Promise.resolve(sleep(ms)).then(() => undefined);
  return Promise.race([finished, interrupted]).finally(() => unhook.abort());
}

export const sizeOf = (file) => fsp.stat(file).then((info) => info.size, () => 0);

export async function sha256File(file, { onProgress, signal, chunkBytes = DISK_BLOCK_BYTES } = {}) {
  const { size } = await fsp.stat(file);
  const careful = size >= CAREFUL_MIN_BYTES;
  const handle = await fsp.open(file, careful ? carefulReadFlags() : 'r');
  const buffer = Buffer.allocUnsafe(Math.min(Math.max(1, chunkBytes), Math.max(size, 1)));
  const hash = createHash('sha256');

  const pull = async () => {
    if (signal?.aborted) throw new DownloadError('ABORTED', 'проверка отменена');
    const read = () => handle.read(buffer, 0, buffer.length, null);
    try {
      return (careful ? await diskTurn(read, { signal }) : await read()).bytesRead;
    } catch (error) {
      if (signal?.aborted && error?.code === 'ABORT_ERR') throw new DownloadError('ABORTED', 'проверка отменена');
      throw error;
    }
  };

  let total = 0;
  let got;
  try {
    while ((got = await pull()) > 0) {
      hash.update(buffer.subarray(0, got));
      total += got;
      onProgress?.(total);
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest('hex'), size: total };
}

// Код из JSON-тела ответа; читается копия, сам ответ остаётся целым.
const bodyCode = (response) => Promise.resolve()
  .then(() => response.clone().json())
  .then((data) => (typeof data?.code === 'string' ? data.code : ''), () => '');

// Таблица «статус -> ошибка»: первое подошедшее правило.
const STATUS_RULES = [
  [(s, c) => s === 403 && c === TICKET_CODE, () => ['TICKET', 'билет на файл погас', true]],
  [(s) => s === 429, () => ['TICKET', 'лимит запросов по билету', true]],
  [(s) => s === 401 || s === 403, (s, c) => ['AUTH', `доступ отклонён (${c || s})`, false]],
  [(s) => s === 404, () => ['NOT_FOUND', 'файл не найден', false]],
  [(s) => s >= 500, (s) => ['SERVER', `сервер ответил ${s}`, true]],
  [() => true, (s) => ['SERVER', `неожиданный ответ ${s}`, false]],
];

export async function statusError(response) {
  const { status } = response;
  const code = [401, 403].includes(status) ? await bodyCode(response) : '';
  const rule = STATUS_RULES.find(([matches]) => matches(status, code));
  const [errorCode, message, retryable] = rule[1](status, code);
  return new DownloadError(errorCode, message, { retryable, status });
}

// Счётчик скорости: отсчёт - пара «время, накопленные байты».
class SpeedWindow {
  #now;
  #marks = [];

  constructor(now) {
    this.#now = now;
  }

  add(accumulated) {
    const at = this.#now();
    const marks = this.#marks;
    marks.push({ at, accumulated });
    while (marks.length > 2 && at - marks[0].at > SPEED_WINDOW_MS) marks.shift();
  }

  rate() {
    const marks = this.#marks;
    if (marks.length < 2) return 0;
    const first = marks[0];
    const last = marks.at(-1);
    const span = last.at - first.at;
    return span > 0 ? ((last.accumulated - first.accumulated) * 1000) / span : 0;
  }
}

export function speedMeter(now) {
  const window = new SpeedWindow(now);
  return { add: (accumulated) => window.add(accumulated), bytesPerSecond: () => window.rate() };
}

export function downloadFailure(error, signal) {
  if (error instanceof DownloadError) return error;
  if (signal?.aborted) return cancelled();
  if (error?.code === 'ENOSPC') return new DownloadError('DISK_FULL', 'на диске не осталось места');
  return networkError(error?.message || 'нет связи');
}

const STALL = Symbol('stall');
const ABORT = Symbol('abort');

// Ждёт кусок, но не дольше срока тишины и не дольше отмены.
function nextStep(reader, abortWait, stallMs) {
  let timer;
  const racers = [reader.read(), abortWait];
  if (stallMs) racers.push(new Promise((resolve) => { timer = setTimeout(resolve, stallMs, STALL); }));
  return Promise.race(racers).finally(() => clearTimeout(timer));
}

export async function readBody(response, { signal, stallTimeoutMs, onChunk, onClosed } = {}) {
  const reader = response.body.getReader();
  const stallMs = Number.isFinite(stallTimeoutMs) && stallTimeoutMs > 0 ? stallTimeoutMs : 0;
  let unhook = noop;
  const abortWait = signal ? new Promise((resolve) => {
    const listener = () => resolve(ABORT);
    signal.addEventListener('abort', listener, { once: true });
    unhook = () => signal.removeEventListener('abort', listener);
  }) : new Promise(noop);

  try {
    if (signal?.aborted) return { silent: false };
    for (;;) {
      const step = await nextStep(reader, abortWait, stallMs);
      if (step === ABORT || step.done) return { silent: false };
      if (step === STALL) return { silent: true };
      await paceDownload(step.value.byteLength, { signal });
      await onChunk?.(step.value);
    }
  } finally {
    unhook();
    reader.cancel().catch(noop);
    await onClosed?.();
  }
}

// Начало Content-Range вида «bytes 1000-2999/3000»; не разобрать - null.
function rangeStart(header) {
  if (typeof header !== 'string') return null;
  const [unit, span = ''] = header.trim().split(/\s+/);
  const first = span.split('-')[0];
  return unit.toLowerCase() === 'bytes' && /^\d+$/.test(first) ? Number(first) : null;
}

function totalFromLength(response, start) {
  const length = Number(response.headers.get('content-length'));
  return length > 0 && Number.isFinite(length) ? start + length : null;
}

// Параметры без явных undefined поверх значений по умолчанию.
const withDefaults = (defaults, given) => ({
  ...defaults,
  ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)),
});

export async function downloadFile(options) {
  const cfg = withDefaults({
    size: null,
    resumable: true,
    rangeBase: 0,
    expectRange: false,
    onProgress: noop,
    onRetry: noop,
    progressIntervalMs: 250,
    stallTimeoutMs: 30000,
    maxAttempts: 8,
    sleep: defaultSleep,
    now: Date.now,
  }, options);
  const { fetchPart, refresh, target, signal } = cfg;
  const { size, resumable, rangeBase, expectRange } = cfg;
  const { onProgress, onRetry, progressIntervalMs, stallTimeoutMs } = cfg;
  const { maxAttempts, sleep, now } = cfg;

  const part = `${target}.part`;
  const run = { received: 0, resumedFrom: 0, attempt: 1, total: size };
  const wipePart = async () => {
    await fsp.rm(part, { force: true });
    run.received = 0;
  };
  const abortIfCancelled = () => {
    if (signal?.aborted) throw cancelled();
  };

  let meter = speedMeter(now);
  let lastEmit = 0;
  const emit = (force) => {
    if (!force) {
      const at = now();
      if (at - lastEmit < progressIntervalMs) return;
      lastEmit = at;
    }
    const bytesPerSec = meter.bytesPerSecond();
    const left = run.total === null ? null : run.total - run.received;
    onProgress({
      received: run.received,
      total: run.total,
      bytesPerSec,
      etaSec: left !== null && bytesPerSec > 0 ? left / bytesPerSec : null,
      attempt: run.attempt,
      resumedFrom: run.resumedFrom,
    });
  };

  // Проверка ответа до записи: что делать с частью и можно ли писать дальше.
  async function vetResponse(response) {
    const { status } = response;
    if (!response.ok) {
      const error = await statusError(response);
      response.body?.cancel().catch(noop);
      throw error;
    }
    if (!response.body) throw serverError('ответ без тела', status);
    if (expectRange && status !== 206) throw new DownloadError('NO_RANGE', 'сервер не отдаёт диапазоны', { status });
    if (run.received > 0 && status !== 206) {
      await wipePart();
      return;
    }
    if (run.received === 0 && !expectRange) return;
    if (rangeStart(response.headers.get('content-range')) === rangeBase + run.received) return;
    await wipePart();
    throw serverError('сервер вернул не тот кусок', status);
  }

  // Запись тела в .part блоками; ошибки записи и сбор итога - после закрытия потока.
  async function storeBody(response) {
    const start = run.received;
    run.total = size ?? totalFromLength(response, start);
    const careful = run.total !== null && run.total >= CAREFUL_MIN_BYTES;
    const mode = start > 0 ? 'a' : 'w';
    const bufferBytes = careful ? DISK_BLOCK_BYTES : Math.min(SMALL_BUFFER_BYTES, run.total ?? SMALL_BUFFER_BYTES);
    const handle = await fsp.open(part, careful ? carefulWriteFlags(mode) : mode);
    const writer = createBlockWriter(handle, { bufferBytes, careful, signal });
    meter = speedMeter(now);

    const accept = async (chunk) => {
      await writer.append(chunk);
      run.received += chunk.byteLength;
      if (run.total !== null && run.received > run.total) throw new DownloadError('SIZE_MISMATCH', 'файл больше ожидаемого');
      meter.add(run.received);
      emit(false);
    };

    const problems = [];
    const outcome = await readBody(response, { signal, stallTimeoutMs, onChunk: accept }).catch((error) => {
      problems.push(error);
      return { silent: false };
    });
    await writer.flush().catch((error) => problems.push(error));
    await handle.close().catch(noop);
    if (problems.length > 0) throw problems[0];
    return outcome;
  }

  // Один заход: запрос, проверка, запись. Возвращается, когда файл целиком на месте.
  async function pullOnce() {
    abortIfCancelled();
    const response = await fetchPart(run.received, signal);

    if (response.status === 416) {
      if (size !== null && run.received === size) return;
      await wipePart();
      throw serverError('кусок за концом файла', 416);
    }
    await vetResponse(response);

    const outcome = await storeBody(response);
    abortIfCancelled();
    if (outcome.silent) throw networkError('данные не приходят слишком долго');
    emit(true);
    if (run.total !== null && run.received !== run.total) throw networkError('поток оборвался раньше конца');
  }

  // Пауза перед повтором: сообщение, новый билет, ожидание, перечитывание принятого.
  async function prepareRetry(failure) {
    const waitMs = retryWaitMs(++run.attempt);
    onRetry({ attempt: run.attempt, maxAttempts, waitMs, code: failure.code });
    if (refresh && failure.code === 'TICKET') await refresh();
    await abortableSleep(sleep, waitMs, signal);
    await (resumable ? sizeOf(part).then((bytes) => { run.received = bytes; }) : wipePart());
  }

  if (resumable) {
    run.received = await sizeOf(part);
    if (size !== null && run.received > size) await wipePart();
  } else {
    await wipePart();
  }
  run.resumedFrom = run.received;
  if (run.received > 0) emit(true);

  for (;;) {
    const failure = await pullOnce().then(() => null, (raw) => downloadFailure(raw, signal));
    if (failure === null) break;
    if (!failure.retryable || run.attempt >= maxAttempts) throw failure;
    await prepareRetry(failure);
  }

  await renameWhenFree(part, target);
  return { received: run.received };
}
