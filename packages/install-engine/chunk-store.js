/*
 * Общее хранилище кусков для всех копий архивов игры (31.10.2026, «Место Astral»).
 *
 * Было: каждая точка отката, основа и сборка — целый файл на два гигабайта, у
 * владельца 33,5 ГБ копий. А отличаются они на мегабайты. Замер на его файлах
 * (только чтение, docs/storage/chunk-store-2026-10-31.md): нарезка по содержимому
 * (тот же gear-хеш, кусок около мегабайта) — соседняя копия добавляет 4–50 МБ;
 * те же копии фиксированными кусками (64 КБ, 1 и 4 МБ) не совпадают почти нигде:
 * запись в RPF сдвигает данные, и каждая копия снова весит почти два гигабайта.
 *
 * Как устроено:
 *
 *   <копия>.chunks.json       — опись рядом с прежним местом файла: размер,
 *                               отпечаток, куски по порядку, время файла,
 *                               путь к кладовой (`store`, относительный: кэш
 *                               переезжает целиком);
 *   native-rpf/chunks/ab/<sha256>
 *                             — кладовая: кусок лежит один раз на все описи;
 *   native-rpf/anchors/<sha256>.rpf + .json
 *                             — якорь: чистый оригинал update.rpf (жёсткая ссылка
 *                               на `update-update.rpf.original.rpf`, места не
 *                               занимает) и его нарезка. Что есть в якоре, в
 *                               кладовую не кладётся: так все копии — это один
 *                               оригинал и мегабайты правок, а не оригинал плюс
 *                               вторая его копия кусками. Жёсткая ссылка держит
 *                               байты, даже если файл основы заменили: подмена у
 *                               нас идёт переименованием.
 *
 * Живой якорь (01.11.2026, обратная разница): та же жёсткая ссылка, но на живой
 * архив игры (`ensureLiveAnchor`). Что лежит в живых архивах, в кэше больше не
 * хранится: на диске остаются только куски оригинала, которых в игре уже нет, и
 * описи. Подмена архива у всех наших писателей (движок, хост, транзакция) идёт
 * переименованием, поэтому ссылка держит прежние байты и после неё: снимать разницу
 * до записи не нужно, а писателя, который про неё забудет, быть не может. Следующий
 * проход (`retireAnchors`) кладёт нужные куски ушедшего архива в кладовую и только
 * потом отпускает ссылку. Правку на месте (OpenIV, проверка файлов в магазине) ловит
 * сверка sha256 каждого куска при чтении; такая копия не собирается честно, а не
 * собирается криво. Другой том — ссылка рядом с игрой (`homeInGame`).
 *
 * Правила надёжности:
 *
 *   • куски не меняются никогда (имя — их sha256); пишутся `.stage`, сброс на
 *     диск, переименование. Обрыв оставляет лишний кусок, но не битую копию;
 *   • опись появляется только после того, как весь файл собран обратно из
 *     кладовой и совпал по sha256 куска и всего файла (`packFile`). Файл уходит
 *     только после описи. До этого момента любой сбой оставляет целый файл;
 *   • файл и опись могут лежать вместе (файл собрали обратно): главный — файл;
 *   • сборка обратно (`thawFile`, `writePackedFile`) сверяет отпечаток и только
 *     потом переименовывает; испорченное в игру и в основы не попадёт;
 *   • уборка убирает кусок, только если его не назвала ни одна опись, а не
 *     прочитанная опись останавливает её (`sweepChunks`).
 *
 * Запись идёт одним потоком на процесс: упаковка и уборка не перебивают друг
 * друга (`withStoreLock`).
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { CAREFUL_MIN_BYTES, carefulWriteFlags, diskTurn, throttledOp, writeFully } from "./disk-care.js";
import { noteDiskOp } from "./disk-profile.js";
import { invalidateOperation } from "./operation-scope.js";
import { CUT_GEAR, CUT_MASK, CUT_MAX, CUT_MIN } from "./chunk-cut.js";
import { HASHER_MIN_BYTES, openChunkHasher } from "./chunk-hash-off-thread.js";

export const CHUNKS_FOLDER = "chunks";
export const ANCHORS_FOLDER = "anchors";
export const PACKED_SUFFIX = ".chunks.json";
const SCHEMA = 1;

/* Нарезка по содержимому: средний кусок ~1 МБ, от 256 КБ до 4 МБ (`chunk-cut.js`). */
const MIN_CHUNK = CUT_MIN;
const MAX_CHUNK = CUT_MAX;
const MASK = CUT_MASK;
const GEAR = CUT_GEAR;

/* Блок чтения: на каждом — проверка «занято» и потолок скорости. */
const READ_BYTES = 8 * 1024 * 1024;
/* Нарезка уступает циклу событий через каждые 256 КБ: окно не ждёт счёта. */
const SLICE_BYTES = 256 * 1024;
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));
const HASH = /^[a-f0-9]{64}$/;

export const packedManifestPath = (file) => `${file}${PACKED_SUFFIX}`;
export const chunkPath = (chunksRoot, sha) => path.join(chunksRoot, sha.slice(0, 2), sha);
export const anchorsRoot = (chunksRoot) => path.join(path.dirname(chunksRoot), ANCHORS_FOLDER);
/* Какие живые архивы держат якоря: чтобы собрать копию, когда куска не нашлось (`refreshLiveAnchors`). */
const LIVE_REGISTER = "live-archives.json";
/* Якорь рядом с игрой (кэш на другом томе) называет свой файл сам. */
const anchorFileOf = (root, index) => (typeof index.file === "string" && path.isAbsolute(index.file) ? index.file : path.join(root, `${index.sha256}.rpf`));

const brokenCopy = (message) => Object.assign(new Error(message), { code: "ASTRAL_STORED_COPY_BROKEN" });

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/* Файл надёжно: `.stage`, сброс на диск, переименование. */
async function writeDurably(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stage = `${file}.${randomUUID()}.stage`;
  const handle = await fs.open(stage, "wx");
  try {
    await writeFully(handle, typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await fs.rename(stage, file);
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
}

/** Опись упакованной копии или `null`. */
export async function readPackedManifest(file) {
  try {
    const manifest = JSON.parse(await fs.readFile(packedManifestPath(file), "utf8"));
    if (manifest?.schema !== SCHEMA || !Array.isArray(manifest.chunks) || !HASH.test(manifest.sha256 || "")) return null;
    return manifest;
  } catch {
    return null;
  }
}

/* Упаковка и уборка кусков — по одной: уборка не должна видеть кусок, на который опись ещё не написана. */
let storeQueue = Promise.resolve();
export function withStoreLock(work) {
  const job = storeQueue.then(work, work);
  storeQueue = job.then(
    () => {},
    () => {},
  );
  return job;
}

/*
 * Что уже есть в якорях. Читается на каждую операцию: якорей один-два, опись —
 * сотни килобайт, и держать её в памяти главного процесса незачем.
 */
export async function loadAnchors(chunksRoot) {
  const root = anchorsRoot(chunksRoot);
  const bySha = new Map();
  const list = [];
  for (const name of await fs.readdir(root).catch(() => [])) {
    if (!name.endsWith(".json") || name === LIVE_REGISTER) continue;
    try {
      const index = JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
      if (index?.schema !== SCHEMA || !HASH.test(index.sha256 || "") || !Array.isArray(index.chunks)) continue;
      const file = anchorFileOf(root, index);
      const stat = await fs.stat(file).catch(() => null);
      /* Файла нет — этот якорь не источник. Другого размера: у обычного якоря то же, у живого это правка на месте, и уцелевшие куски ещё можно прочитать. */
      if (!stat?.isFile()) continue;
      if (stat.size !== index.size && !index.live) continue;
      /* Живой архив правили на месте: читать можно (каждый кусок сверяется), рассчитывать на него нельзя. */
      const suspect = Boolean(index.live) && (stat.size !== index.size || Math.abs(stat.mtimeMs - Number(index.live.mtimeMs)) >= 1);
      list.push({ ...index, file, suspect });
      for (const [sha, size, offset] of index.chunks) bySha.set(sha, { file, size, offset, suspect, next: bySha.get(sha) || null });
    } catch {
      /* Битая опись якоря — этого якоря нет; куски из него не считаются лежащими. */
    }
  }
  return { bySha, list };
}

/* Кусок есть в якоре, на который можно рассчитывать. Подозрительный якорь читают, но куски из него в кладовой не экономят. */
function inAnchors(anchors, sha, size) {
  for (let spot = anchors.bySha.get(sha); spot; spot = spot.next) if (spot.size === size && !spot.suspect) return true;
  return false;
}

/* Кусок из якоря, сверенный по sha256: `true` — лежит в `buffer`. Живой архив могли поправить на месте, поэтому сверка всегда. */
async function readFromAnchors(anchors, sha, size, buffer, handles, check = null) {
  for (let spot = anchors.bySha.get(sha); spot; spot = spot.next) {
    if (spot.size !== size) continue;
    try {
      let handle = handles.get(spot.file);
      if (!handle) {
        handle = await fs.open(spot.file, "r");
        handles.set(spot.file, handle);
      }
      const { bytesRead } = await handle.read(buffer, 0, size, spot.offset);
      if (bytesRead !== size) continue;
      /* `check` — сверка в потоке счёта (`chunk-hash-off-thread.js`), байты уже в его буфере. */
      if (check ? await check(size, sha) : createHash("sha256").update(buffer.subarray(0, size)).digest("hex") === sha) return true;
    } catch {
      /* Якорь отпустили, пока читали: кусок уже в кладовой. */
    }
  }
  return false;
}

/*
 * Режет файл на куски и считает его отпечаток. `onPiece(кусок, sha, длина)` —
 * ждётся. Границы кусков постоянны: новые куски обязаны совпасть с лежащими у
 * людей с 10.10.2026. Ответ — `{ sha256, chunks }` или `{ busy: true }`.
 *
 * Упаковка идёт на главном процессе (ОЗУ и отзывчивость 15.10.2026): чтение —
 * одним буфером, кусок собирается в своём, счёт уступает циклу событий; замер
 * `scripts/perf/ram/pack-bench.mjs`: 2 ГБ — худшая задержка 8–13 мс, пик памяти
 * 85–90 МБ.
 */
async function cutFile(file, options = {}) {
  /* Большой файл режется и хэшируется в потоке (02.11.2026: 1 ГБ держал главный процесс 25 с). */
  const size = (await fs.stat(file).catch(() => null))?.size || 0;
  const hasher = size >= HASHER_MIN_BYTES ? await openChunkHasher(READ_BYTES) : null;
  if (!hasher) return cutFileHere(file, options);
  try {
    return await cutFileOffThread(file, hasher, options);
  } finally {
    await hasher.close();
  }
}

/*
 * Та же нарезка, счёт — в потоке: главный поток читает блок в общий буфер, поток отвечает
 * границами и хешами кусков. Байты куска главный поток собирает, только если они нужны
 * (`needBytes`: якорю нужна одна нарезка, кладовой — сами куски).
 */
async function cutFileOffThread(file, hasher, { isBusy = () => false, pace = null, onPiece = null, needBytes = true } = {}) {
  const chunks = [];
  const read = hasher.buffer;
  const piece = needBytes ? Buffer.allocUnsafe(MAX_CHUNK) : null;
  let length = 0;
  const take = (from, to) => {
    if (to <= from) return;
    if (piece) read.copy(piece, length, from, to);
    length += to - from;
  };
  const flush = async (sha) => {
    await onPiece?.(piece ? piece.subarray(0, length) : null, sha, length);
    chunks.push([sha, length]);
    length = 0;
  };
  const input = await fs.open(file, "r");
  try {
    for (;;) {
      if (isBusy()) return { busy: true };
      await throttledOp(read.length);
      const readStarted = performance.now();
      const { bytesRead } = await input.read(read, 0, read.length, null);
      if (!bytesRead) break;
      noteDiskOp("read", bytesRead, performance.now() - readStarted, file);
      if (pace) {
        await pace(bytesRead);
        if (isBusy()) return { busy: true };
      }
      const { ends, shas } = await hasher.cut(bytesRead);
      let start = 0;
      for (let index = 0; index < ends.length; index += 1) {
        take(start, ends[index]);
        await flush(shas[index]);
        start = ends[index];
      }
      take(start, bytesRead);
    }
  } finally {
    await input.close().catch(() => {});
  }
  const last = await hasher.cutEnd();
  if (length) await flush(last);
  return { sha256: await hasher.whole(), chunks };
}

async function cutFileHere(file, { isBusy = () => false, pace = null, onPiece = null } = {}) {
  const whole = createHash("sha256");
  const chunks = [];
  const read = Buffer.allocUnsafe(READ_BYTES);
  const piece = Buffer.allocUnsafe(MAX_CHUNK);
  let length = 0;
  let rolling = 0;
  let pieceHash = createHash("sha256");
  const take = (block, from, to) => {
    if (to <= from) return;
    block.copy(piece, length, from, to);
    pieceHash.update(block.subarray(from, to));
    length += to - from;
  };
  const flush = async () => {
    const sha = pieceHash.digest("hex");
    await onPiece?.(piece.subarray(0, length), sha, length);
    chunks.push([sha, length]);
    length = 0;
    rolling = 0;
    pieceHash = createHash("sha256");
  };
  const input = await fs.open(file, "r");
  try {
    for (;;) {
      if (isBusy()) return { busy: true };
      await throttledOp(read.length);
      const readStarted = performance.now();
      const { bytesRead } = await input.read(read, 0, read.length, null);
      if (!bytesRead) break;
      noteDiskOp("read", bytesRead, performance.now() - readStarted, file);
      if (pace) {
        await pace(bytesRead);
        if (isBusy()) return { busy: true };
      }
      const block = read.subarray(0, bytesRead);
      let start = 0;
      for (let slice = 0; slice < block.length; slice += SLICE_BYTES) {
        const end = Math.min(block.length, slice + SLICE_BYTES);
        whole.update(block.subarray(slice, end));
        for (let index = slice; index < end; index += 1) {
          rolling = ((rolling << 1) + GEAR[block[index]]) >>> 0;
          const size = length + (index - start + 1);
          if ((size >= MIN_CHUNK && (rolling & MASK) === 0) || size >= MAX_CHUNK) {
            take(block, start, index + 1);
            await flush();
            start = index + 1;
          }
        }
        take(block, start, end);
        start = end;
        if (end < block.length) await yieldToLoop();
      }
    }
  } finally {
    await input.close().catch(() => {});
  }
  if (length) await flush();
  return { sha256: whole.digest("hex"), chunks };
}

async function storeChunk(chunksRoot, sha, bytes) {
  const file = chunkPath(chunksRoot, sha);
  const known = await fs.stat(file).catch(() => null);
  /* Другого размера: обрыв старой версии или сбой диска. Такой кусок заменяется. */
  if (known?.size === bytes.length) return 0;
  await writeDurably(file, bytes);
  return bytes.length;
}

/*
 * Один проход по кускам описи: каждому `visit(байты, sha)`. Источник — якорь,
 * если кусок там есть, иначе файл куска. `verify` — сверять каждый кусок по
 * имени (упаковка перед удалением файла). Буфер один; байты живут до возврата.
 *
 * `hasher` — поток счёта (`openHasherFor`): сверка кусков идёт в нём, а каждый
 * пройденный кусок — в его отпечаток целого (`hasher.whole()` после прохода).
 */
async function openHasherFor(manifest) {
  if (!(Number(manifest?.size) >= HASHER_MIN_BYTES)) return null;
  const biggest = manifest.chunks.reduce((best, [, size]) => Math.max(best, Number(size) || 0), 1);
  return openChunkHasher(biggest + 1);
}

async function eachChunk(manifest, chunksRoot, visit, { verify = false, isBusy = () => false, pace = null, signal = null, hasher = null } = {}) {
  const anchors = await loadAnchors(chunksRoot);
  const handles = new Map();
  const biggest = manifest.chunks.reduce((best, [, size]) => Math.max(best, Number(size) || 0), 1);
  const buffer = hasher ? hasher.buffer : Buffer.allocUnsafe(biggest + 1);
  const check = hasher ? (size, sha) => hasher.check(size, sha, true) : null;
  const fromAnchor = (sha, size) => readFromAnchors(anchors, sha, size, buffer, handles, check);
  const fromFile = async (sha, size) => {
    const handle = await fs.open(chunkPath(chunksRoot, sha), "r").catch(() => null);
    if (!handle) return false;
    try {
      const { bytesRead } = await handle.read(buffer, 0, size + 1, 0);
      if (bytesRead !== size) return false;
    } finally {
      await handle.close().catch(() => {});
    }
    if (hasher && !verify) {
      await hasher.feed(size);
      return true;
    }
    if (hasher ? await check(size, sha) : !verify || createHash("sha256").update(buffer.subarray(0, size)).digest("hex") === sha) return true;
    /* Кусок не тот, что назван: следующая упаковка положит его заново. */
    await fs.rm(chunkPath(chunksRoot, sha), { force: true }).catch(() => {});
    return false;
  };
  let sinceCheck = 0;
  try {
    for (const [sha, size] of manifest.chunks) {
      if (signal?.aborted) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR", cause: signal.reason });
      if ((await fromAnchor(sha, size).catch(() => false)) || (await fromFile(sha, size))) {
        await visit(buffer.subarray(0, size), sha);
      } else {
        throw brokenCopy(`Кусок копии архива повреждён или пропал: ${sha.slice(0, 12)}.`);
      }
      sinceCheck += size;
      if (sinceCheck >= READ_BYTES) {
        if (isBusy()) return false;
        if (pace) {
          await pace(sinceCheck);
          if (isBusy()) return false;
        }
        sinceCheck = 0;
      }
    }
  } finally {
    for (const handle of handles.values()) await handle.close().catch(() => {});
  }
  return true;
}

/** Поток архива из кусков описи — для чтения записей без файла. Новый буфер на кусок. */
export function packedReadStream(manifest, chunksRoot) {
  async function* chunks() {
    const anchors = await loadAnchors(chunksRoot);
    const handles = new Map();
    try {
      for (const [sha, size] of manifest.chunks) {
        const bytes = Buffer.allocUnsafe(size);
        if (await readFromAnchors(anchors, sha, size, bytes, handles)) {
          yield bytes;
          continue;
        }
        const read = await fs.readFile(chunkPath(chunksRoot, sha)).catch(() => null);
        if (read?.length !== size) throw new Error("Кусок точки отката повреждён: размер не совпал.");
        yield read;
      }
    } finally {
      for (const handle of handles.values()) await handle.close().catch(() => {});
    }
  }
  return Readable.from(chunks());
}

async function chunksPresent(manifest, chunksRoot, anchors) {
  for (const [sha, size] of manifest.chunks) {
    if (inAnchors(anchors, sha, size)) continue;
    if ((await fs.stat(chunkPath(chunksRoot, sha)).catch(() => null))?.size !== size) return false;
  }
  return true;
}

/*
 * Файл собран обратно и стоит рядом с описью: тот самый, если размер, время и
 * номер записи те же, что запомнила сборка. Такой уходит без повторного чтения.
 */
const sameThawed = (manifest, stat) =>
  Boolean(manifest?.thawed) &&
  manifest.thawed.size === Number(stat.size) &&
  manifest.thawed.mtimeMs === Number(stat.mtimeMs) &&
  manifest.thawed.ino === String(stat.ino);

/**
 * Упаковать файл: куски — в кладовую, рядом — опись, файл — прочь (`keepFile` —
 * файл убирает вызывающий). `expectedSha256` — известный отпечаток: файл, что с
 * ним не совпал, не трогается. Ответ `{ packed, bytes, newBytes, reason? }`.
 *
 * Прежде чем файл уйдёт, всё читается обратно из кладовой: каждый кусок и весь
 * файл сверяются по sha256. Опись и удаление — только после этого.
 */
export async function packFile({ file, expectedSha256, chunksRoot, isBusy = () => false, pace = null, keepFile = false, store = null }) {
  const key = placeKey(file);
  try {
    const result = await withStoreLock(() => packFileLocked({ file, expectedSha256, chunksRoot, isBusy, pace, keepFile, store }));
    if (result.packed) packFailures.delete(key);
    else if (["hash-mismatch", "verify-failed"].includes(result.reason)) packFailures.set(key, (packFailures.get(key) || 0) + 1);
    return result;
  } catch (error) {
    packFailures.set(key, (packFailures.get(key) || 0) + 1);
    throw error;
  }
}

/*
 * Копия, которая дважды не упаковалась (не тот отпечаток, диск полон): до
 * следующего запуска её не трогаем. Иначе проход читал бы два гигабайта каждые
 * десять минут ради того же отказа. Она остаётся файлом — откату это не мешает.
 */
const packFailures = new Map();
export const packGaveUp = (file) => (packFailures.get(placeKey(file)) || 0) >= 2;

async function packFileLocked({ file, expectedSha256, chunksRoot, isBusy, pace, keepFile, store }) {
  const wanted = String(expectedSha256 || "").toLowerCase();
  if (!HASH.test(wanted)) return { packed: false, reason: "no-hash" };
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return { packed: false, reason: "no-copy" };
  const inode = await fs.stat(file, { bigint: true }).then((big) => big.ino, () => null);
  const earlier = await readPackedManifest(file);
  const anchors = await loadAnchors(chunksRoot);
  const finish = async () => {
    if (!keepFile) await fs.rm(file, { force: true, maxRetries: 8, retryDelay: 250 });
    invalidateOperation();
  };
  if (
    earlier?.sha256 === wanted &&
    sameThawed(earlier, { size: stat.size, mtimeMs: stat.mtimeMs, ino: inode }) &&
    (await chunksPresent(earlier, chunksRoot, anchors))
  ) {
    await finish();
    return { packed: true, bytes: stat.size, newBytes: 0, reused: true };
  }
  let newBytes = 0;
  /* Те же байты, что в якоре (сборка, лежащая в игре): нарезка известна, резать и класть нечего. Сверка ниже прочитает всё обратно. */
  const twin = anchors.list.find((anchor) => anchor.sha256 === wanted && anchor.size === stat.size && !anchor.suspect);
  const cut = twin
    ? { sha256: twin.sha256, chunks: twin.chunks.map(([sha, size]) => [sha, size]) }
    : await cutFile(file, {
        isBusy,
        pace,
        onPiece: async (bytes, sha, length) => {
          if (inAnchors(anchors, sha, length)) return;
          newBytes += await storeChunk(chunksRoot, sha, bytes);
        },
      });
  if (cut.busy) return { packed: false, reason: "busy", newBytes };
  if (cut.sha256 !== wanted) return { packed: false, reason: "hash-mismatch", newBytes };
  const manifest = {
    schema: SCHEMA,
    size: stat.size,
    sha256: wanted,
    chunks: cut.chunks,
    times: { mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs },
    /* Обрыв между описью и удалением: следующий проход узнает файл и не будет читать его снова. */
    thawed: { size: stat.size, mtimeMs: stat.mtimeMs, ino: String(inode) },
    ...(store ? { store } : {}),
  };
  if (!(await chunksPresent(manifest, chunksRoot, anchors))) return { packed: false, reason: "verify-failed", newBytes };
  /* Вторая сверка: то, что реально лежит на диске, а не то, что прошло через память. */
  const back = createHash("sha256");
  const hasher = await openHasherFor(manifest);
  let done;
  let backSha = "";
  try {
    done = await eachChunk(manifest, chunksRoot, hasher ? () => {} : (bytes) => void back.update(bytes), { verify: true, isBusy, pace, hasher });
    if (done) backSha = hasher ? await hasher.whole() : back.digest("hex");
  } catch (error) {
    if (error?.code !== "ASTRAL_STORED_COPY_BROKEN") throw error;
    return { packed: false, reason: "verify-failed", newBytes };
  } finally {
    await hasher?.close();
  }
  if (!done) return { packed: false, reason: "busy", newBytes };
  if (backSha !== wanted) return { packed: false, reason: "verify-failed", newBytes };
  await writeDurably(packedManifestPath(file), JSON.stringify(manifest));
  await finish();
  return { packed: true, bytes: stat.size, newBytes };
}

/**
 * Записать файл из описи в `destination` (сначала полностью, без переименования).
 * `onChunk(кусок)` — ход и отпечаток. Запись и чтение — как у большой копии
 * (`buffered-copy.js`): блоками, сквозь кэш системы, по одной на процесс.
 */
export async function writePackedFile({ manifest, chunksRoot, destination, onChunk = null, signal = null, flags = "wx", waiting = false, hasher = null }) {
  await reachChunks(manifest, chunksRoot);
  const careful = manifest.size >= CAREFUL_MIN_BYTES;
  const output = await fs.open(destination, careful ? carefulWriteFlags(flags) : flags);
  /* Человек ждёт этот файл прямо сейчас (`thawFile`): без отдыха диска между блоками. */
  const turn = careful && !waiting;
  const block = Buffer.allocUnsafe(Math.min(4 * 1024 * 1024, Math.max(64 * 1024, manifest.size)));
  let length = 0;
  const flush = async () => {
    if (!length) return;
    const piece = block.subarray(0, length);
    await (turn ? diskTurn(() => writeFully(output, piece)) : writeFully(output, piece));
    length = 0;
  };
  try {
    await eachChunk(
      manifest,
      chunksRoot,
      async (bytes) => {
        onChunk?.(bytes);
        let from = 0;
        while (from < bytes.length) {
          const take = Math.min(block.length - length, bytes.length - from);
          bytes.copy(block, length, from, from + take);
          length += take;
          from += take;
          if (length === block.length) await flush();
        }
      },
      { signal, hasher },
    );
    await flush();
    await output.sync();
  } finally {
    await output.close().catch(() => {});
  }
}

/*
 * Куска нет ни в кладовой, ни в якорях, на которые можно рассчитывать: живой архив
 * сменили снаружи (проверка файлов, обновление, OpenIV), а проход уборки ещё не дошёл.
 * Если в игре теперь те же байты (проверка файлов вернула оригинал), новый якорь их
 * найдёт; если нет — сборка откажет словами на первом же пропавшем куске.
 */
async function reachChunks(manifest, chunksRoot) {
  const anchors = await loadAnchors(chunksRoot);
  for (const [sha, size] of manifest.chunks) {
    if (inAnchors(anchors, sha, size)) continue;
    if ((await fs.stat(chunkPath(chunksRoot, sha)).catch(() => null))?.size === size) continue;
    await refreshLiveAnchors(chunksRoot);
    return;
  }
}

/* Кто и когда спрашивал файл: только что нужный файл уборка не упаковывает. */
const lastAsked = new Map();
const placeKey = (file) => path.resolve(String(file)).toLowerCase();
export const noteStoredUse = (file, now = Date.now()) => {
  if (lastAsked.size > 4096) lastAsked.clear();
  lastAsked.set(placeKey(file), now);
};
export const storedUseAt = (file) => lastAsked.get(placeKey(file)) || 0;
const thawing = new Map();

const chunksRootOf = (file, manifest, fallback) =>
  fallback || (typeof manifest?.store === "string" && manifest.store ? path.resolve(path.dirname(file), manifest.store) : null);

/**
 * Собрать файл из кусков на его месте. `false` — собирать нечего (файл на месте
 * или описи нет). Сверка sha256 до переименования; не сошлось — код
 * `ASTRAL_STORED_COPY_BROKEN`, на месте ничего не появится.
 */
export async function thawFile(file, { chunksRoot = null, expectedSha256 = "", signal = null } = {}) {
  if (await exists(file)) return false;
  const manifest = await readPackedManifest(file);
  if (!manifest) return false;
  const expected = String(expectedSha256 || "").toLowerCase();
  if (expected && expected !== manifest.sha256)
    throw brokenCopy("Опись копии архива говорит о другом файле, чем состояние Astral.");
  const root = chunksRootOf(file, manifest, chunksRoot);
  if (!root) throw brokenCopy("У описи копии архива нет кладовой.");
  const stage = `${file}.${randomUUID()}.stage`;
  const hash = createHash("sha256");
  /* Сверка кусков и отпечаток целого — в потоке счёта (02.11.2026): два прохода SHA-256 по 2 ГБ шли в главном процессе. */
  const hasher = await openHasherFor(manifest);
  try {
    await writePackedFile({ manifest, chunksRoot: root, destination: stage, onChunk: hasher ? null : (bytes) => hash.update(bytes), signal, waiting: true, hasher });
    const sha256 = hasher ? await hasher.whole() : hash.digest("hex");
    if (sha256 !== manifest.sha256) throw brokenCopy("Копия архива из кусков не совпала с отпечатком.");
    /* Время файла — прежнее: кто сравнивает копии по времени (`world-map-stock.js`), видит тот же порядок. */
    if (manifest.times?.mtimeMs) {
      const when = new Date(manifest.times.mtimeMs);
      await fs.utimes(stage, when, when).catch(() => {});
    }
    await fs.rename(stage, file);
  } finally {
    await hasher?.close();
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  const stat = await fs.stat(file);
  const inode = await fs.stat(file, { bigint: true }).then((big) => big.ino);
  await writeDurably(packedManifestPath(file), JSON.stringify({ ...manifest, thawed: { size: stat.size, mtimeMs: stat.mtimeMs, ino: String(inode) } }));
  /* Отпечаток только что сверен: следующей операции не нужно читать два гигабайта. */
  const { rememberSha256 } = await import("./file-fingerprint.js");
  await rememberSha256(file, manifest.sha256).catch(() => {});
  invalidateOperation();
  return true;
}

/**
 * Файл на диске или `false`. Единая точка для всех, кто читает копию: файла нет,
 * а опись есть — он собирается здесь, и только один раз, сколько бы ни спросили.
 * Испорченная копия — `false` с предупреждением: дальше работает обычная ветка
 * «копии нет» (`base-recovery.js`). Нехватка места и отмена — ошибка наружу: её
 * нельзя принять за «копии нет».
 */
export async function ensureStoredFile(file, { signal = null, expectedSha256 = "" } = {}) {
  if (typeof file !== "string" || !file) return false;
  noteStoredUse(file);
  if (await exists(file)) return true;
  if (!(await exists(packedManifestPath(file)))) return false;
  const key = placeKey(file);
  let job = thawing.get(key);
  if (!job) {
    job = thawFile(file, { signal, expectedSha256 }).finally(() => thawing.delete(key));
    thawing.set(key, job);
  }
  try {
    await job;
  } catch (error) {
    if (error?.code !== "ASTRAL_STORED_COPY_BROKEN") throw error;
    console.warn(`[astral-engine] Копия не собралась из кусков (${path.basename(file)}): ${error.message}`);
    return false;
  }
  noteStoredUse(file);
  return exists(file);
}

/** Размер копии: файл или опись. `null` — нет ни того, ни другого. */
export async function storedFileSize(file) {
  if (typeof file !== "string" || !file) return null;
  const stat = await fs.stat(file).catch(() => null);
  if (stat?.isFile()) return stat.size;
  const manifest = await readPackedManifest(file);
  return manifest ? manifest.size : null;
}

/** Когда снята копия: время исходного файла, а не сборки из кусков. */
export async function storedFileTimes(file) {
  const manifest = await readPackedManifest(file);
  if (manifest?.times) return manifest.times;
  const stat = await fs.stat(file).catch(() => null);
  return stat ? { mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs } : null;
}

/** Печать копии (размер и время) для сравнения: файл или опись; ради неё копия не собирается. */
export async function storedFileStamp(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (stat?.isFile()) return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  const manifest = await readPackedManifest(file);
  return manifest?.times ? { size: manifest.size, mtimeMs: Math.round(manifest.times.mtimeMs) } : null;
}

/** Убрать копию целиком: файл и опись. Куски заберёт уборка. */
export async function dropStoredFile(file) {
  await fs.rm(file, { force: true, maxRetries: 8, retryDelay: 250 }).catch(() => {});
  await fs.rm(packedManifestPath(file), { force: true }).catch(() => {});
  invalidateOperation();
}

/**
 * Якорь — чистый оригинал `source` (жёсткая ссылка и нарезка). Ссылка не встала
 * (другой том, том без ссылок) — `null`: копии лягут в кладовую целиком, просто
 * займут больше. Уже есть и смотрит на тот же файл — ничего не читается.
 */
export function ensureAnchor({ chunksRoot, source, isBusy = () => false, pace = null }) {
  return withStoreLock(() => ensureAnchorLocked({ chunksRoot, source, isBusy, pace }));
}

async function ensureAnchorLocked({ chunksRoot, source, isBusy, pace }) {
  const stat = await fs.stat(source, { bigint: true }).catch(() => null);
  if (!stat?.isFile()) return null;
  const root = anchorsRoot(chunksRoot);
  const { list } = await loadAnchors(chunksRoot);
  for (const anchor of list) {
    const held = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
    if (held && held.ino === stat.ino && held.dev === stat.dev) return { sha256: anchor.sha256, reused: true };
  }
  const offsets = [];
  let position = 0;
  const cut = await cutFile(source, {
    isBusy,
    pace,
    needBytes: false,
    onPiece: async (_bytes, sha, length) => {
      offsets.push([sha, length, position]);
      position += length;
    },
  });
  if (cut.busy) return { busy: true };
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${cut.sha256}.rpf`);
  const stage = `${file}.${randomUUID()}.stage`;
  try {
    await fs.link(source, stage);
    await fs.rename(stage, file);
  } catch {
    /* Том без жёстких ссылок или другой том. */
    await fs.rm(stage, { force: true }).catch(() => {});
    return null;
  }
  await writeDurably(path.join(root, `${cut.sha256}.json`), JSON.stringify({ schema: SCHEMA, sha256: cut.sha256, size: Number(stat.size), chunks: offsets }));
  return { sha256: cut.sha256, reused: false };
}

/**
 * Живой якорь: жёсткая ссылка на архив игры и его нарезка. Что лежит в нём, в кладовую
 * не кладётся, а уже лежащее заберёт `sweepChunks`, сверив байты. `homeInGame` — папка
 * рядом с игрой на случай, когда кэш на другом томе: ссылка возможна только в пределах
 * тома. Не встала нигде (FAT, нет прав) — `null`, и всё остаётся как без якоря: копии
 * лежат кусками целиком, чистый оригинал — файлом. Архив тот же, что при прошлом
 * проходе, — ничего не читается.
 */
export function ensureLiveAnchor(options) {
  return withStoreLock(() => ensureLiveAnchorLocked(options));
}

/* Архивы, на которые ссылка не встала: до перезапуска не пробуем и работой уборки не считаем. */
const liveAnchorsRefused = new Set();
export const liveAnchorRefused = (file) => liveAnchorsRefused.has(placeKey(file));

/* Ссылка, оставшаяся от обрыва, держала бы два гигабайта прежних байт. Идём под замком кладовой: своих таких сейчас нет. */
async function sweepAnchorStages(folder) {
  for (const name of await fs.readdir(folder).catch(() => [])) if (name.endsWith(".stage")) await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
}

async function ensureLiveAnchorLocked({ chunksRoot, source, homeInGame = null, isBusy = () => false, pace = null, linkFile = fs.link }) {
  const stat = await fs.stat(source, { bigint: true }).catch(() => null);
  if (!stat?.isFile()) return null;
  const { list } = await loadAnchors(chunksRoot);
  for (const anchor of list) {
    if (anchor.suspect) continue;
    const held = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
    if (!held || held.ino !== stat.ino || held.dev !== stat.dev) continue;
    /* Якорь снят с оригинала, когда архив был тем же файлом: теперь за ним нужно следить как за живым. */
    if (!anchor.live) {
      const { file: _file, suspect: _suspect, ...index } = anchor;
      await writeDurably(path.join(anchorsRoot(chunksRoot), `${anchor.sha256}.json`), JSON.stringify({ ...index, live: { path: source, mtimeMs: (await fs.stat(source)).mtimeMs } }));
    }
    return { sha256: anchor.sha256, file: anchor.file, reused: true };
  }
  /* Сначала ссылка: том без ссылок узнаётся до чтения двух гигабайт, а архив, сменённый пока читали, ссылка держит прежним. */
  const root = anchorsRoot(chunksRoot);
  await sweepAnchorStages(root);
  if (homeInGame) await sweepAnchorStages(homeInGame);
  let home = null;
  let stage = "";
  for (const candidate of [root, homeInGame]) {
    if (!candidate) continue;
    stage = path.join(candidate, `${randomUUID()}.stage`);
    try {
      await fs.mkdir(candidate, { recursive: true });
      await linkFile(source, stage);
      home = candidate;
      break;
    } catch {
      await fs.rm(stage, { force: true }).catch(() => {});
    }
  }
  if (!home) {
    if (homeInGame) await fs.rmdir(homeInGame).catch(() => {});
    liveAnchorsRefused.add(placeKey(source));
    return null;
  }
  liveAnchorsRefused.delete(placeKey(source));
  const offsets = [];
  let position = 0;
  let file = "";
  let cut;
  try {
    cut = await cutFile(stage, {
      isBusy,
      pace,
      needBytes: false,
      onPiece: async (_bytes, sha, length) => {
        offsets.push([sha, length, position]);
        position += length;
      },
    });
    if (cut.busy) return { busy: true };
    const after = await fs.stat(source, { bigint: true }).catch(() => null);
    /* Архив сменили, пока он читался: нарезка уже про другой файл. Следующий проход. */
    if (after?.ino !== stat.ino || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs) return { changed: true };
    file = path.join(home, home === root ? `${cut.sha256}.rpf` : `${cut.sha256}.bin`);
    await fs.rename(stage, file);
  } finally {
    await fs.rm(stage, { force: true }).catch(() => {});
    /* Пустой папке рядом с игрой оставаться незачем; непустую это не тронет. */
    if (home !== root && !file) await fs.rmdir(home).catch(() => {});
  }
  const mtimeMs = (await fs.stat(source)).mtimeMs;
  await writeDurably(
    path.join(root, `${cut.sha256}.json`),
    JSON.stringify({
      schema: SCHEMA,
      sha256: cut.sha256,
      size: Number(stat.size),
      chunks: offsets,
      live: { path: source, mtimeMs },
      ...(home === root ? {} : { file }),
    }),
  );
  /* Ссылка сменила время записи архива: отпечаток только что посчитан, второго чтения при запуске не будет (`file-fingerprint.js`). */
  const { rememberSha256 } = await import("./file-fingerprint.js");
  await rememberSha256(source, cut.sha256).catch(() => {});
  invalidateOperation();
  return { sha256: cut.sha256, file, reused: false };
}

/** Живые архивы для `refreshLiveAnchors`: `[{ path, homeInGame }]`. */
export async function rememberLiveArchives(chunksRoot, items) {
  await writeDurably(path.join(anchorsRoot(chunksRoot), LIVE_REGISTER), JSON.stringify({ schema: SCHEMA, items }));
}

/** Заново нарезать живые архивы, если их сменили. Для сборки, которая не нашла кусок, и для уборки. */
export async function refreshLiveAnchors(chunksRoot, options = {}) {
  const register = await fs
    .readFile(path.join(anchorsRoot(chunksRoot), LIVE_REGISTER), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);
  for (const item of register?.items || [])
    await ensureLiveAnchor({ chunksRoot, source: item.path, homeInGame: item.homeInGame || null, ...options }).catch((error) => {
      console.warn(`[astral-engine] Живой якорь не обновился: ${error?.message || error}`);
    });
}

/* Какие куски называют описи. `null` — опись не прочиталась: неизвестно, что ей нужно. */
async function wantedChunks(chunksRoot, manifests) {
  const wanted = new Set();
  for (const file of [...manifests, ...(await engineCopyManifests(chunksRoot))]) {
    try {
      const manifest = JSON.parse(await fs.readFile(file, "utf8"));
      for (const [sha] of manifest?.chunks || []) wanted.add(sha);
    } catch {
      return null;
    }
  }
  return wanted;
}

/**
 * Отпустить якоря, чьих файлов больше нет ни в игре, ни среди оригиналов (`keep` —
 * `dev:ino` тех, кто остаётся): архив подменили, ссылка держит прежние байты. Куски,
 * которые называют описи и которых нет в других якорях, — в кладовую, с сброса на диск
 * и сверкой; потом ссылка уходит. Обрыв оставляет якорь и лишние куски, следующий проход
 * продолжит с того же места. Кусок, который не совпал со своим sha256 (архив правили на
 * месте), взять неоткуда: он считается в `lost`, и такая копия при сборке откажет словами.
 */
export function retireAnchors(options) {
  return withStoreLock(() => retireAnchorsLocked(options));
}

async function retireAnchorsLocked({ chunksRoot, keep, manifests = [], isBusy = () => false, pace = null, dryRun = false }) {
  const report = { retired: [], storedBytes: 0, freedBytes: 0, lost: 0, skipped: null };
  const anchors = await loadAnchors(chunksRoot);
  const leaving = [];
  for (const anchor of anchors.list) {
    const held = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
    if (held && keep.has(`${held.dev}:${held.ino}`) && !anchor.suspect) continue;
    leaving.push({ anchor, links: held ? Number(held.nlink) : 1 });
  }
  if (!leaving.length) return report;
  const wanted = await wantedChunks(chunksRoot, manifests);
  if (!wanted) {
    report.skipped = "unreadable-manifest";
    return report;
  }
  const leavingFiles = new Set(leaving.map(({ anchor }) => anchor.file));
  const elsewhere = (sha, size) => {
    for (let spot = anchors.bySha.get(sha); spot; spot = spot.next) if (spot.size === size && !spot.suspect && !leavingFiles.has(spot.file)) return true;
    return false;
  };
  const buffer = Buffer.allocUnsafe(MAX_CHUNK + 1);
  for (const { anchor, links } of leaving) {
    if (dryRun) {
      report.retired.push(anchor.sha256);
      continue;
    }
    const handle = await fs.open(anchor.file, "r").catch(() => null);
    const stored = [];
    try {
      for (const [sha, size, offset] of anchor.chunks) {
        if (!wanted.has(sha) || elsewhere(sha, size) || size > MAX_CHUNK) continue;
        if ((await fs.stat(chunkPath(chunksRoot, sha)).catch(() => null))?.size === size) continue;
        if (isBusy()) {
          report.skipped = "busy";
          return report;
        }
        const read = handle ? await handle.read(buffer, 0, size, offset).catch(() => ({ bytesRead: 0 })) : { bytesRead: 0 };
        const piece = buffer.subarray(0, size);
        if (read.bytesRead !== size || createHash("sha256").update(piece).digest("hex") !== sha) {
          report.lost += 1;
          continue;
        }
        await writeDurably(chunkPath(chunksRoot, sha), piece);
        stored.push([sha, size]);
        report.storedBytes += size;
        if (pace) await pace(size);
      }
    } finally {
      await handle?.close().catch(() => {});
    }
    /* Сверка: то, что реально лежит на диске. Не сошлось — ссылка остаётся, следующий проход положит заново. */
    let solid = true;
    for (const [sha] of stored) {
      const back = await fs.readFile(chunkPath(chunksRoot, sha)).catch(() => null);
      if (back && createHash("sha256").update(back).digest("hex") === sha) continue;
      await fs.rm(chunkPath(chunksRoot, sha), { force: true }).catch(() => {});
      solid = false;
    }
    if (!solid) {
      report.skipped = "verify-failed";
      return report;
    }
    await fs.rm(anchor.file, { force: true, maxRetries: 8, retryDelay: 250 });
    await fs.rm(path.join(anchorsRoot(chunksRoot), `${anchor.sha256}.json`), { force: true });
    /* Папка рядом с игрой опустела — её в игре быть не должно. */
    if (path.dirname(anchor.file) !== anchorsRoot(chunksRoot)) await fs.rmdir(path.dirname(anchor.file)).catch(() => {});
    if (links === 1) report.freedBytes += anchor.size;
    report.retired.push(anchor.sha256);
  }
  invalidateOperation();
  return report;
}

/*
 * Описи копий вне точек: основы и сборки движка. Они лежат рядом с прежними
 * файлами, а уборка кусков обязана знать их все, кто бы её ни звал: кусок без
 * описи уходит. Кладовая — `<память движка>/native-rpf/chunks`.
 */
export async function engineCopyManifests(chunksRoot) {
  const backups = path.dirname(path.dirname(chunksRoot));
  const found = [];
  const collect = async (directory, depth) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue;
      const place = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.endsWith(PACKED_SUFFIX)) found.push(place);
      else if (entry.isDirectory() && depth > 0 && !entry.name.startsWith(".")) await collect(place, depth - 1);
    }
  };
  await collect(path.join(backups, "bases"), 2);
  await collect(path.join(backups, "payloads", "_rpf-composites"), 1);
  return found;
}

/**
 * Куски, на которые не ссылается ни одна опись, уходят; куски, что лежат и в
 * якоре, — тоже, если якорь их подтвердил байтами. Якорь, что больше никому не
 * нужен и не назван в `anchorsInUse`, уходит. `manifests` — описи точек; описи
 * основ и сборок находятся сами. `dryRun` — только посчитать.
 */
export function sweepChunks({ chunksRoot, manifests = [], dryRun = false, anchorsInUse = null }) {
  return withStoreLock(() => sweepChunksLocked({ chunksRoot, manifests, dryRun, anchorsInUse }));
}

async function sweepChunksLocked({ chunksRoot, manifests, dryRun, anchorsInUse }) {
  const wanted = await wantedChunks(chunksRoot, manifests);
  /* Опись не прочиталась — неизвестно, какие куски ей нужны: уборка кусков ждёт до следующего раза, а не угадывает. */
  if (!wanted) return { removed: 0, bytes: 0, skipped: true };
  const anchors = await loadAnchors(chunksRoot);
  let removed = 0;
  let bytes = 0;
  const check = Buffer.allocUnsafe(MAX_CHUNK + 1);
  /* Кусок уходит, только если его байты прямо сейчас читаются из якоря, на который можно рассчитывать. */
  const coveredByAnchor = async (sha, size) => {
    if (size > MAX_CHUNK) return false;
    for (let spot = anchors.bySha.get(sha); spot; spot = spot.next) {
      if (spot.size !== size || spot.suspect) continue;
      const handle = await fs.open(spot.file, "r").catch(() => null);
      if (!handle) continue;
      try {
        const { bytesRead } = await handle.read(check, 0, size, spot.offset);
        if (bytesRead === size && createHash("sha256").update(check.subarray(0, size)).digest("hex") === sha) return true;
      } catch {
        /* Этот якорь не читается — может, прочитается другой. */
      } finally {
        await handle.close().catch(() => {});
      }
    }
    return false;
  };
  for (const shard of await fs.readdir(chunksRoot).catch(() => [])) {
    const folder = path.join(chunksRoot, shard);
    for (const name of await fs.readdir(folder).catch(() => [])) {
      /* Обрыв при записи куска: пишут только под этим же замком, значит, никто его не допишет. */
      if (name.endsWith(".stage")) {
        if (!dryRun) await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
        continue;
      }
      const file = path.join(folder, name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) continue;
      if (wanted.has(name) && !(await coveredByAnchor(name, stat.size))) continue;
      if (!dryRun) await fs.rm(file, { force: true }).catch(() => {});
      removed += 1;
      bytes += stat.size;
    }
  }
  /* Якорь прежней версии игры: на него больше не смотрит ни одна опись. */
  if (anchorsInUse)
    for (const anchor of anchors.list) {
      if (anchorsInUse.has(anchor.sha256) || anchor.chunks.some(([sha]) => wanted.has(sha))) continue;
      const stat = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
      /* Больше одной ссылки — сам файл останется, места это не вернёт, но и вреда нет. */
      if (!dryRun) {
        await fs.rm(anchor.file, { force: true }).catch(() => {});
        await fs.rm(path.join(anchorsRoot(chunksRoot), `${anchor.sha256}.json`), { force: true }).catch(() => {});
        if (path.dirname(anchor.file) !== anchorsRoot(chunksRoot)) await fs.rmdir(path.dirname(anchor.file)).catch(() => {});
      }
      if (stat?.nlink === 1n) bytes += Number(stat.size);
    }
  return { removed, bytes, skipped: false };
}

/** Сколько весит кладовая кусков. */
export async function chunkStoreSize(chunksRoot) {
  let bytes = 0;
  for (const shard of await fs.readdir(chunksRoot).catch(() => []))
    for (const name of await fs.readdir(path.join(chunksRoot, shard)).catch(() => []))
      bytes += (await fs.stat(path.join(chunksRoot, shard, name)).catch(() => null))?.size || 0;
  return bytes;
}
