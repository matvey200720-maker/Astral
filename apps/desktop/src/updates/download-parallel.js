/*
 * Параллельная загрузка большого файла: несколько соединений `Range` сразу.
 *
 * Тестер с дальнего канала (Германия) получает мегабайт в секунду на одно
 * соединение, а база — сотни мегабайт. Одно соединение упирается в задержку и
 * потери на пути, несколько — складываются.
 *
 *   — больше 32 МБ → до 6 соединений (`planParts`), в куске не меньше 16 МБ: файл в 40 МБ
 *     идёт двумя соединениями, а не шестью по 6 МБ;
 *   — куски режутся на блоки (`planBlocks`, не больше 48 на файл), и каждое соединение берёт
 *     следующий блок своим запросом `Range: bytes=<с>-<по>`;
 *   — блоки приходят не по порядку, но в файл и в хэш ложатся строго по порядку: один файл
 *     `<файл>.part`, запись подряд, начало всегда целое;
 *   — в памяти не больше блока на соединение и не больше ~48 МБ, буферы ходят по кругу;
 *   — обрыв внутри блока докачивается с места; прерванная загрузка продолжается с конца
 *     `.part`, начало перечитывается ради хэша один раз;
 *   — сервер Range не понял (ответил `200` на запрос диапазона) — ошибка
 *     `NO_RANGE`: звонящий качает целиком одним потоком.
 *
 * Раньше у каждого соединения был свой файл, а в конце они склеивались: база писалась на
 * диск дважды (стенд 31.10.2026, файл 1 ГБ: 2048 МБ записи, 1024 МБ чтения, 9222 записи
 * по 64–256 КБ; `scripts/perf/ram/disk-download-bench.mjs`). Один общий файл с разных мест
 * писать нельзя: NTFS дописывает нулями всё до места записи, и это те же лишние гигабайты.
 *
 * Запись бережная (`disk-care.js`): сквозь кэш системы, очередью и с отдыхом диска.
 * Сверяет хэш с подписанным звонящий (клиент: `fetchBase`).
 *
 * Билет на файл общий у всех соединений. Погас — свежий нужен один, а не по одному на
 * блок: два обновления подряд гасили бы билеты друг друга, поэтому обновление
 * делится между ними (`sharedRefresh`).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CAREFUL_MIN_BYTES, DISK_BLOCK_BYTES, carefulReadFlags, carefulWrite, carefulWriteFlags, diskTurn, writeFully } from "@modovik/install-engine/disk-care.js";
import { renameWhenFree } from "../atomic-file.js";
import { DownloadError, abortableSleep, downloadFailure, readBody, retryWaitMs, sizeOf, speedMeter, statusError } from "./download.js";

const MIB = 1024 * 1024;

export const PARALLEL_DEFAULTS = Object.freeze({
  /* Сколько соединений самое большее. */
  connections: 6,
  /* Файл не больше этого качается одним потоком. */
  threshold: 32 * MIB,
  /* Меньше этого на соединение не бывает. */
  minPart: 16 * MIB,
  /* Блок одного запроса и память на соединение: не меньше этого, если блоков и так не слишком много (`MAX_BLOCKS`). */
  blockBytes: 8 * MIB,
});

/* На файл не больше стольких запросов: у сервера билет на 64 запроса и окно 120 запросов в минуту на сеть (`backend/internal/services/edge/beta.go`), и с запасом на повторы.
   Поэтому в большом файле блок крупнее. */
const MAX_BLOCKS = 48;
/* Сколько памяти самое большее держат блоки: при крупных блоках соединений меньше. */
const MEMORY_CAP_BYTES = 48 * MIB;

/** Свежий билет только что выдан другим блоком — второго подряд не просим. */
const REFRESH_GRACE_MS = 2_000;

/**
 * Куски `[{ index, start, end, length }]` (границы включительно, как в `Range`), их число — число
 * соединений, или `null` — файл качать одним потоком.
 */
export function planParts(size, options = {}) {
  const { connections, threshold, minPart } = { ...PARALLEL_DEFAULTS, ...options };
  if (!Number.isSafeInteger(size) || size <= threshold) return null;
  const count = Math.min(connections, Math.floor(size / minPart));
  if (!(count >= 2)) return null;
  const step = Math.floor(size / count);
  return Array.from({ length: count }, (_, index) => {
    const start = index * step;
    const end = index === count - 1 ? size - 1 : start + step - 1;
    return { index, start, end, length: end - start + 1 };
  });
}

/** Блоки загрузки: куски, порезанные поровну, не длиннее `blockBytes` (в большом файле — длиннее, запросов не больше `MAX_BLOCKS`). Сплошные, по порядку. */
export function planBlocks(parts, blockBytes = PARALLEL_DEFAULTS.blockBytes) {
  const target = Math.max(blockBytes, Math.ceil((parts.at(-1).end + 1) / MAX_BLOCKS));
  const blocks = [];
  for (const part of parts) {
    const pieces = Math.max(1, Math.ceil(part.length / target));
    const step = Math.floor(part.length / pieces);
    for (let piece = 0; piece < pieces; piece += 1) {
      const start = part.start + piece * step;
      const end = piece === pieces - 1 ? part.end : start + step - 1;
      blocks.push({ start, end, length: end - start + 1 });
    }
  }
  return blocks;
}

/** Файлы прежней раскладки этого файла (свой файл на кусок). */
async function listParts(target) {
  const directory = path.dirname(target);
  const pattern = new RegExp(`^${path.basename(target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)\\.(\\d+)(\\.part)?$`);
  const names = await fs.readdir(directory).catch(() => []);
  return names.filter((name) => pattern.test(name)).map((name) => path.join(directory, name));
}

/** Убрать файлы прежней раскладки: их оставила загрузка старой версии, склеивать их больше некому. */
export async function removeParts(target) {
  await Promise.all((await listParts(target)).map((file) => fs.rm(file, { force: true })));
}

/** Билет обновляет один блок за раз; кто пришёл следом, берёт уже свежий. */
function sharedRefresh(refresh, now) {
  if (!refresh) return undefined;
  let running = null;
  let refreshedAt = -Infinity;
  return () => {
    if (running) return running;
    if (now() - refreshedAt < REFRESH_GRACE_MS) return Promise.resolve();
    running = (async () => {
      try {
        await refresh();
      } finally {
        refreshedAt = now();
        running = null;
      }
    })();
    return running;
  };
}

/** Хэш начала, что лежит с прошлого раза: читается один раз, до первого запроса. */
async function hashPrefix(file, length, hash, signal) {
  const handle = await fs.open(file, carefulReadFlags());
  try {
    const buffer = Buffer.allocUnsafeSlow(Math.min(length, PARALLEL_DEFAULTS.blockBytes));
    let read = 0;
    while (read < length) {
      if (signal?.aborted) throw new DownloadError("ABORTED", "загрузка отменена");
      const { bytesRead } = await diskTurn(() => handle.read(buffer, 0, Math.min(buffer.length, length - read), read));
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      read += bytesRead;
    }
    return read;
  } finally {
    await handle.close();
  }
}

/**
 * @param {{
 *   fetchRange: (start: number, end: number, signal?: AbortSignal) => Promise<Response>,
 *   refresh?: () => Promise<void>,
 *   target: string,
 *   size: number,
 *   parts: ReturnType<typeof planParts>,
 *   blockBytes?: number,
 *   onProgress?: (progress: { received: number, total: number, bytesPerSec: number, etaSec: number | null, attempt: number, resumedFrom: number }) => void,
 *   onRetry?: (retry: { attempt: number, maxAttempts: number, waitMs: number, code: string }) => void,
 *   onVerify?: (done: number) => void,
 *   stallTimeoutMs?: number,
 *   signal?: AbortSignal,
 *   maxAttempts?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 * }} options
 */
export async function downloadParallel({
  fetchRange,
  refresh,
  target,
  size,
  parts,
  blockBytes = PARALLEL_DEFAULTS.blockBytes,
  onProgress = () => {},
  onRetry = () => {},
  onVerify = () => {},
  progressIntervalMs = 250,
  stallTimeoutMs = 30_000,
  signal,
  maxAttempts = 8,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  /* Загрузка старой версии оставила куски отдельными файлами: склеивать их теперь некому. */
  await removeParts(target);
  const partial = `${target}.part`;
  let offset = await sizeOf(partial);
  if (offset > size) {
    await fs.rm(partial, { force: true });
    offset = 0;
  }
  let hash = crypto.createHash("sha256");
  if (offset > 0 && (await hashPrefix(partial, offset, hash, signal)) !== offset) {
    await fs.rm(partial, { force: true });
    offset = 0;
    hash = crypto.createHash("sha256");
  }
  const resumedFrom = offset;
  const plan = planBlocks(parts, blockBytes);
  const connections = Math.max(1, Math.min(parts.length, Math.max(2, Math.floor(MEMORY_CAP_BYTES / plan[0].length))));
  /* Блоки от конца того, что лежит на диске; первый может начинаться с середины. */
  const blocks = plan
    .filter((block) => block.end >= offset)
    .map((block) => {
      const start = Math.max(block.start, offset);
      return { start, end: block.end, length: block.end - start + 1, filled: 0, buffer: null };
    });
  const careful = size >= CAREFUL_MIN_BYTES;
  const handle = await fs.open(partial, careful ? carefulWriteFlags("a") : "a");

  const meter = speedMeter(now);
  let written = offset;
  let attempt = 1;
  let lastReport = 0;
  const report = (force = false) => {
    const time = now();
    if (!force && time - lastReport < progressIntervalMs) return;
    lastReport = time;
    let received = written;
    for (let index = head; index < blocks.length && index < nextBlock; index += 1) received += blocks[index].filled;
    meter.add(received);
    const speed = meter.bytesPerSecond();
    onProgress({ received, total: size, bytesPerSec: speed, etaSec: speed > 0 ? Math.max(0, (size - received) / speed) : null, attempt, resumedFrom });
  };

  /* Один отказ останавливает остальные блоки; непрерывное начало остаётся — продолжится в следующий раз. */
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });
  if (signal?.aborted) controller.abort();
  const stop = controller.signal;
  const sharedTicket = sharedRefresh(refresh, now);

  /* Буфер блока — из круга: новый на каждый блок был бы мусором на всю базу. Блок короче буфера пользуется его началом. */
  const freeBuffers = [];
  const takeBuffer = (length) => {
    const index = freeBuffers.findIndex((buffer) => buffer.length >= length);
    return index >= 0 ? freeBuffers.splice(index, 1)[0] : Buffer.allocUnsafeSlow(Math.max(length, Math.min(blockBytes, size)));
  };

  let head = 0;
  let nextBlock = 0;
  const waiters = [];
  const wake = () => waiters.splice(0).forEach((resolve) => resolve());
  stop.addEventListener("abort", wake, { once: true });

  /* Записать готовые блоки с головы: по одному, в файл и в хэш по порядку. */
  let draining = Promise.resolve();
  const writeOut = async (block, length) => {
    /* Хэш — ломтями между записями: блок целиком держал бы главный поток на десятки миллисекунд. */
    for (let at = 0; at < length; at += DISK_BLOCK_BYTES) {
      const piece = block.buffer.subarray(at, Math.min(length, at + DISK_BLOCK_BYTES));
      await (careful ? carefulWrite(handle, piece, { place: target }) : writeFully(handle, piece));
      hash.update(piece);
      written += piece.length;
    }
  };
  const drain = () =>
    (draining = draining.then(async () => {
      while (head < blocks.length && blocks[head].buffer && blocks[head].filled === blocks[head].length) {
        const block = blocks[head];
        await writeOut(block, block.length);
        freeBuffers.push(block.buffer);
        block.buffer = null;
        block.filled = 0;
        head += 1;
        wake();
      }
    }));

  /* Ответ на запрос блока с места `from`: он обязан быть `206` ровно оттуда. */
  async function receive(response, block, from) {
    if (response.status === 416) throw new DownloadError("SERVER", "кусок за концом файла", { retryable: true, status: 416 });
    if (!response.ok) throw await statusError(response);
    if (!response.body) throw new DownloadError("SERVER", "ответ без тела", { retryable: true });
    /* Кусок просили диапазоном, а сервер (или прокси по дороге) отдаёт файл целиком: этим путём не пройти. */
    if (response.status !== 206) throw new DownloadError("NO_RANGE", "сервер не отдаёт диапазоны", { status: response.status });
    const range = /^bytes (\d+)-/.exec(response.headers.get("content-range") ?? "");
    if (!range || Number(range[1]) !== from) {
      await response.body.cancel().catch(() => {});
      throw new DownloadError("SERVER", "сервер вернул не тот кусок", { retryable: true });
    }
    const { silent } = await readBody(response, {
      signal: stop,
      stallTimeoutMs,
      onChunk: (chunk) => {
        if (block.filled + chunk.length > block.length) throw new DownloadError("SIZE_MISMATCH", "файл больше ожидаемого");
        block.buffer.set(chunk, block.filled);
        block.filled += chunk.length;
        report();
      },
    });
    if (stop.aborted) throw new DownloadError("ABORTED", "загрузка отменена");
    if (silent) throw new DownloadError("NO_NETWORK", "данные не приходят слишком долго", { retryable: true });
  }

  /* Блок целиком в память: обрыв и погасший билет — повтор с того же байта, а не сначала. */
  async function fetchBlock(block) {
    block.buffer ??= takeBuffer(block.length);
    for (let tries = 1; ; ) {
      if (stop.aborted) throw new DownloadError("ABORTED", "загрузка отменена");
      try {
        const from = block.start + block.filled;
        await receive(await fetchRange(from, block.end, stop), block, from);
        if (block.filled === block.length) return;
        throw new DownloadError("NO_NETWORK", "поток оборвался раньше конца", { retryable: true });
      } catch (error) {
        const failure = downloadFailure(error, stop);
        if (!failure.retryable || tries >= maxAttempts) throw failure;
        tries += 1;
        attempt = Math.max(attempt, tries);
        const waitMs = retryWaitMs(tries);
        onRetry({ attempt: tries, maxAttempts, waitMs, code: failure.code });
        if (failure.code === "TICKET" && sharedTicket) await sharedTicket();
        await abortableSleep(sleep, waitMs, stop);
      }
    }
  }

  const worker = async () => {
    while (nextBlock < blocks.length) {
      if (stop.aborted) throw new DownloadError("ABORTED", "загрузка отменена");
      const index = nextBlock;
      nextBlock += 1;
      /* Не убегать вперёд отставшего блока: в памяти не больше блока на соединение. */
      while (index - head >= connections) {
        if (stop.aborted) throw new DownloadError("ABORTED", "загрузка отменена");
        await new Promise((resolve) => waiters.push(resolve));
      }
      await fetchBlock(blocks[index]);
      await drain();
      report();
    }
  };

  let finished = false;
  try {
    if (offset > 0) report(true);
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(connections, Math.max(1, blocks.length)) }, () =>
        worker().catch((error) => {
          /* Причину — до остановки: после неё любой отказ выглядел бы отменой. */
          const failure = downloadFailure(error, stop);
          controller.abort();
          throw failure;
        }),
      ),
    );
    await draining.catch(() => {});
    const failures = outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
    if (failures.length) throw failures.find((error) => error?.code !== "ABORTED") ?? failures[0];
    report(true);
    /* Всё прошло сквозь кэш системы: один сброс в конце держит кэш самого диска и запись о файле. */
    if (careful) await handle.datasync();
    finished = true;
  } finally {
    signal?.removeEventListener("abort", relay);
    stop.removeEventListener("abort", wake);
    /* Что успели принять сразу за непрерывным началом, — в файл: докачка продолжит с него. */
    if (!finished) {
      const block = blocks[head];
      if (block?.buffer && block.filled > 0) await writeOut(block, block.filled).catch(() => {});
    }
    await handle.close();
  }
  if (written !== size) {
    await fs.rm(partial, { force: true });
    throw new DownloadError("SIZE_MISMATCH", "собранный файл не того размера", { retryable: true });
  }
  onVerify(size);
  /* Дошедший файл сразу проверяет антивирус: на Windows переименование на это время падает с EPERM/EBUSY (atomic-file.js). */
  await renameWhenFree(partial, target);
  return { received: size, sha256: hash.digest("hex") };
}
