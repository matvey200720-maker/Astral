// Один общий потолок скорости на все загрузки процесса.
// Шкала занимается синхронно при вызове, поэтому параллельные соединения не превышают потолок.

const BYTES_PER_MEGABYTE = 1048576;
const TOLERANCE_MS = 500;

function abortError(signal) {
  return Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
    code: 'ABORT_ERR',
    cause: signal.reason,
  });
}

// Один ждущий кусок. Кончается ровно раз: таймером, пробуждением или отменой.
class ChunkHold {
  isOpen = true;

  constructor(delayMs, signal, roster) {
    this.signal = signal;
    this.roster = roster;
    this.finished = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.onAbort = () => this.cancel();
    this.timer = setTimeout(() => this.release(), delayMs);
    roster.add(this);
    signal?.addEventListener?.('abort', this.onAbort, { once: true });
  }

  release() {
    if (this.close()) {
      this.signal?.removeEventListener?.('abort', this.onAbort);
      this.resolve();
    }
  }

  // Однократная подписка снята сама; время куска на шкале остаётся (контракт).
  cancel() {
    if (this.close()) this.reject(abortError(this.signal));
  }

  close() {
    const wasOpen = this.isOpen;
    if (wasOpen) {
      this.isOpen = false;
      clearTimeout(this.timer);
      this.roster.delete(this);
    }
    return wasOpen;
  }
}

// Шкала хранится как момент часов, когда кончится занятое время:
// долг = horizon − часы, поэтому он сам убывает с ходом часов.
class PacingLine {
  ceiling = null;

  horizon = 0;

  holds = new Set();

  clock = () => performance.now();

  rewind() {
    this.horizon = this.clock();
  }

  setCeiling(ceiling) {
    this.ceiling = ceiling;
    this.rewind();
    for (const hold of this.holds) hold.release();
  }

  // Ложное значение — настоящие часы. Не функция тоже запоминается и падает уже здесь (контракт).
  setClock(now) {
    this.clock = now || (() => performance.now());
    this.rewind();
  }

  // Занимает шкалу и отвечает, сколько куску ждать. Простой запаса не копит: шкала
  // начинается не раньше «сейчас», и без ожидания проходят те же 0,5 с потолка,
  // что и сразу после установки потолка.
  book(bytes) {
    const moment = this.clock();
    this.horizon = Math.max(this.horizon, moment) + (bytes / this.ceiling) * 1000;
    return this.horizon - moment - TOLERANCE_MS;
  }
}

const line = new PacingLine();

export function setDownloadLimitMbps(value) {
  const megabytes = Number(value);
  const isUsable = Number.isFinite(megabytes) && megabytes > 0;
  line.setCeiling(isUsable ? megabytes * BYTES_PER_MEGABYTE : null);
}

export function downloadLimitBytes() {
  return line.ceiling;
}

export function setDownloadPacingClock(now) {
  line.setClock(now);
}

export async function paceDownload(bytes, { signal = null } = {}) {
  if (signal?.aborted) throw abortError(signal);
  if (line.ceiling !== null && bytes > 0) {
    const delay = line.book(bytes);
    if (delay > 0) await new ChunkHold(delay, signal, line.holds).finished;
  }
}

async function* streamChunks(body) {
  const reader = body.getReader();
  let step = await reader.read();
  while (!step.done) {
    yield step.value;
    step = await reader.read();
  }
}

export async function readResponsePaced(response, { signal = null } = {}) {
  if (line.ceiling === null || !response.body?.getReader) {
    return Buffer.from(await response.arrayBuffer());
  }
  // Читатель намеренно не отменяется и не освобождается при ошибке (контракт).
  const parts = [];
  for await (const chunk of streamChunks(response.body)) {
    await paceDownload(chunk.length, { signal });
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}
