// Переезд точек отката вслед за кэшем: копия, размещение, слияние и уборка.
// Порядок вызова ведёт «Хранилище»; здесь только строительные блоки и замок записи.
import fs from "node:fs/promises";
import path from "node:path";
import * as crypto from "node:crypto";
import * as bufferedCopy from "@modovik/install-engine/buffered-copy.js";
import * as scope from "@modovik/install-engine/operation-scope.js";

export const RESTORE_POINTS_DIRECTORY = path.join("backups", "native-rpf");
export const RESTORE_POINTS_MOVING_MESSAGE =
  "Astral переносит точки отката в папку кэша. Дождитесь окончания и повторите.";
export const UNFINISHED_POINT_JOURNALS = Object.freeze([
  "library-removal-journal.json",
  "squash-journal.json"
]);
export const MOVED_MARKER = "moved.json";
export const RESTORE_POINT_COMMANDS = Object.freeze(
  new Set(["install-rpf-patch", "compose-rpf", "restore-rpf-point"])
);

const WRITING_MESSAGE = "Дождитесь окончания установки — потом перенесите кэш.";
const CODE_MOVING = "ASTRAL_RESTORE_POINTS_MOVING";
const CODE_BUSY = "ASTRAL_RESTORE_POINTS_BUSY";
const CODE_MISMATCH = "ASTRAL_RESTORE_POINTS_MISMATCH";
const GIB = 1024 ** 3;

const ignore = () => undefined;
const yes = () => true;
const no = () => false;

// ---------------------------------------------------------------- замок записи

const lock = { moving: false, writers: 0 };

function refusal(code, text) {
  const error = new Error(text);
  error.code = code;
  return error;
}

function assertIdle() {
  if (lock.moving) throw refusal(CODE_MOVING, RESTORE_POINTS_MOVING_MESSAGE);
}

// Задача идёт под замком; что бы ни случилось, замок отпускается и память операций устаревает.
async function runUnder(task, release) {
  let outcome;
  try {
    outcome = await task();
  } finally {
    release();
    scope.invalidateOperation();
  }
  return outcome;
}

export function restorePointsMoving() {
  return lock.moving;
}

export function restorePointWritersBusy() {
  return lock.writers > 0;
}

export async function asRestorePointWriter(task) {
  assertIdle();
  lock.writers += 1;
  const leave = () => {
    lock.writers -= 1;
  };
  return runUnder(task, leave);
}

export async function whileMovingRestorePoints(task, options = {}) {
  const busy = options.busy === undefined ? () => "" : options.busy;
  assertIdle();
  const reason = busy() || (lock.writers > 0 && WRITING_MESSAGE);
  if (reason) throw refusal(CODE_BUSY, reason);
  lock.moving = true;
  function finish() {
    lock.moving = false;
  }
  return runUnder(task, finish);
}

export function restorePointsGuard(writing) {
  function busy() {
    return writing() ? WRITING_MESSAGE : "";
  }
  return (task) => whileMovingRestorePoints(task, { busy });
}

// ------------------------------------------------------------------- пути

export function restorePointsFolder(cacheRoot) {
  return path.join(cacheRoot, RESTORE_POINTS_DIRECTORY);
}

export function restorePointsRootIn(cacheRoot) {
  const folder = restorePointsFolder(cacheRoot);
  return path.join(folder, "restore-points");
}

// ------------------------------------------------------------ малые помощники

function gigabytes(bytes) {
  const digits = bytes < 10 * GIB ? 2 : 1;
  const value = (bytes / GIB).toFixed(digits);
  return value.replace(".", ",");
}

// Простые вопросы к диску: ответ «да/нет» либо пустой список, если спросить не вышло.
async function probeOk(task, fallback) {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

function exists(target) {
  return probeOk(async () => {
    await fs.access(target);
    return true;
  }, false);
}

function entriesOf(directory) {
  return probeOk(() => fs.readdir(directory, { withFileTypes: true }), []);
}

function namesIn(directory) {
  return probeOk(() => fs.readdir(directory), []);
}

function eraseTree(target) {
  return fs.rm(target, { recursive: true, force: true });
}

async function eraseTreeQuietly(target) {
  await eraseTree(target).catch(ignore);
}

async function eraseFile(file) {
  await fs.rm(file, { force: true }).catch(ignore);
}

// По очереди, по одному: следующий шаг начинается, когда прежний закончился.
async function inOrder(list, step) {
  for (const item of list) await step(item);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw bufferedCopy.abortError(signal);
}

// Метка прежнего переезда: JSON с массивом files; всё прочее меткой не считается.
function readMovedMarker(directory) {
  return probeOk(async () => {
    const text = await fs.readFile(path.join(directory, MOVED_MARKER), "utf8");
    const files = JSON.parse(text)?.files;
    return Array.isArray(files) ? files : null;
  }, null);
}

async function writeMovedMarker(from, movedTo, files) {
  const staged = path.join(from, `${MOVED_MARKER}.${crypto.randomUUID()}.tmp`);
  const movedAt = new Date().toISOString();
  const body = JSON.stringify({ movedTo, movedAt, files });
  await fs.writeFile(staged, body, "utf8");
  await fs.rename(staged, path.join(from, MOVED_MARKER));
}

// Пустые папки уходят снизу вверх; rmdir зовётся на каждой папке, непустая просто не поддаётся.
async function removeEmptyDirectories(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => null);
  if (entries === null) return;
  const subfolders = entries.filter((entry) => entry.isDirectory());
  for (const folder of subfolders) {
    await removeEmptyDirectories(path.join(directory, folder.name));
  }
  await fs.rmdir(directory).catch(ignore);
}

function splitEntries(entries, relative) {
  const folders = [];
  const files = [];
  for (const entry of entries) {
    const inner = relative === "" ? entry.name : path.join(relative, entry.name);
    if (entry.isDirectory()) folders.push(inner);
    else if (entry.isFile()) files.push(inner);
  }
  return { folders, files };
}

// Опись обычных файлов: папки обходятся в глубину, из подпапок первой берётся последняя; результат по алфавиту строк.
async function listFiles(root) {
  const found = [];
  async function visit(relative) {
    const here = path.join(root, relative);
    const entries = await fs.readdir(here, { withFileTypes: true }).catch((error) => {
      if (relative === "" && error.code === "ENOENT") return null;
      throw error;
    });
    if (entries === null) return;
    const { folders, files } = splitEntries(entries, relative);
    found.push(...files);
    const reversed = [...folders].reverse();
    for (const folder of reversed) await visit(folder);
  }
  await visit("");
  found.sort();
  return found;
}

// Отпечаток файла чтением с диска; перед каждым чтением проверяется отмена.
async function digestOf(file, size, signal) {
  const handle = await fs.open(file, "r");
  try {
    const hash = crypto.createHash("sha256");
    const bufferSize = Math.max(65536, Math.min(bufferedCopy.COPY_BUFFER_BYTES, size));
    const buffer = Buffer.alloc(bufferSize);
    let bytesRead = -1;
    while (bytesRead) {
      throwIfAborted(signal);
      const chunk = await handle.read(buffer, 0, buffer.length, null);
      bytesRead = chunk.bytesRead;
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await handle.close().catch(ignore);
  }
}

function mismatchOf(relative) {
  const text = `Копия точки отката на новом месте не совпала с оригиналом (${relative}). Точки остались на прежнем месте.`;
  return refusal(CODE_MISMATCH, text);
}

function noRoomFor(into, wanted, free) {
  const disk = path.parse(into).root || into;
  const needText = `нужно ${gigabytes(wanted)} ГБ, свободно ${gigabytes(free)} ГБ.`;
  const text = `Недостаточно места на диске ${disk} для точек отката: ${needText}`;
  return refusal("ENOSPC", text);
}

// Опись точки лежит строго по пути restore-points/<имя>/restore.json.
function isManifestPath(relative) {
  const pieces = relative.split(path.sep);
  const shaped = pieces.length === 3;
  return shaped && pieces[0] === "restore-points" && pieces[2] === "restore.json";
}

async function refuseOccupied(into) {
  const taken = await exists(into);
  if (taken) throw new Error(`Рабочая папка переезда точек уже есть: ${into}`);
}

// Один источник: размер, узел жёсткой ссылки (если файл не один) и времена.
async function statSource(from, relative) {
  const source = path.join(from, relative);
  const stat = await fs.stat(source, { bigint: true });
  const multipleLinks = Number(stat.nlink) > 1;
  const inode = multipleLinks ? `${stat.dev}:${stat.ino}` : null;
  const accessed = new Date(Number(stat.atimeMs));
  const modified = new Date(Number(stat.mtimeMs));
  const size = Number(stat.size);
  return { relative, source, size, inode, accessed, modified };
}

function sourceNeed(item, twins) {
  return item.inode && twins.has(item.inode) ? 0 : item.size;
}

// Обмер источника: размеры, жёсткие ссылки и то, что придётся занять на новом месте.
async function measureSources(from, names, twins) {
  const items = [];
  for (const relative of names) items.push(await statSource(from, relative));
  let totalBytes = 0;
  let needed = 0;
  for (const item of items) {
    totalBytes += item.size;
    needed += sourceNeed(item, twins);
  }
  return { items, totalBytes, needed };
}

function freeBytesOf(stat) {
  return Number(stat.bavail) * Number(stat.bsize);
}

async function ensureRoom(into, statfs, needed, reserveBytes) {
  const stat = await statfs(into);
  const free = freeBytesOf(stat);
  const wanted = needed + reserveBytes;
  if (free < wanted) throw noRoomFor(into, wanted, free);
}

// Проба ссылки: встала — тот же том, и места считать не нужно.
async function probeLink(linked, first, into) {
  const probe = path.join(into, `.link-probe-${crypto.randomUUID()}`);
  const stood = await linked(first, probe);
  if (stood) await fs.rm(probe, { force: true });
  return stood;
}

async function rewriteOneManifest(into, relative, rewrite) {
  const target = path.join(into, relative);
  const loaded = await fs.readFile(target, "utf8").then((text) => ({ value: JSON.parse(text) })).catch(() => null);
  if (loaded === null) return;
  const changed = rewrite(loaded.value);
  if (!changed) return;
  const staged = `${target}.${crypto.randomUUID()}.tmp`;
  const body = `${JSON.stringify(changed, null, 2)}\n`;
  await fs.writeFile(staged, body, "utf8");
  await fs.rename(staged, target);
}

// Описи правятся уже в копии: новый файл рядом и подмена записи.
async function rewriteManifests(into, names, rewrite) {
  const manifests = names.filter(isManifestPath);
  await inOrder(manifests, (relative) => rewriteOneManifest(into, relative, rewrite));
}

// ------------------------------------------------------------------- копия

// Общее состояние одной копии: двойники, отпечатки путей, счёт байтов и куда сообщать о ходе.
function makeCopyContext(options) {
  const { totalBytes, onProgress, signal, linkFile, twins } = options;
  const ctx = { signal, twins, prints: new Map(), copiedBytes: 0 };
  function advance(item, bytes) {
    ctx.copiedBytes += bytes;
    onProgress?.({ copiedBytes: ctx.copiedBytes, totalBytes, file: item.relative });
  }
  function linked(existing, created) {
    return linkFile(existing, created).then(yes, no);
  }
  ctx.advance = advance;
  ctx.linked = linked;
  return ctx;
}

// Отпечаток двойника в кэше: известный берётся, иначе сверяются оригинал и ссылка.
async function twinDigest(ctx, item, copyPath) {
  const known = ctx.prints.get(copyPath);
  if (known) return known;
  const original = await digestOf(item.source, item.size, ctx.signal);
  const duplicate = await digestOf(item.target, item.size, ctx.signal);
  const matches = original === duplicate;
  if (!matches) throw mismatchOf(item.relative);
  ctx.prints.set(copyPath, original);
  return original;
}

// Способы положить файл; каждый отвечает null, если ему здесь нечего делать.
async function shareCacheCopy(ctx, item) {
  const copyPath = item.inode ? ctx.twins.get(item.inode) : null;
  if (!copyPath) return null;
  const linked = await ctx.linked(copyPath, item.target);
  if (!linked) return null;
  const digest = await twinDigest(ctx, item, copyPath);
  ctx.advance(item, item.size);
  return { digest, remember: false };
}

async function sameFileNode(source, target) {
  const before = await fs.stat(source, { bigint: true });
  const after = await fs.stat(target, { bigint: true });
  const sameDevice = before.dev === after.dev;
  const sameInode = before.ino === after.ino;
  return sameDevice && sameInode;
}

async function linkToSource(ctx, item) {
  const linked = await ctx.linked(item.source, item.target);
  if (!linked) return null;
  const same = await sameFileNode(item.source, item.target);
  if (!same) throw mismatchOf(item.relative);
  ctx.advance(item, item.size);
  return { digest: null, remember: true };
}

async function copyBytes(ctx, item) {
  const hash = crypto.createHash("sha256");
  function onChunk(chunk) {
    hash.update(chunk);
    ctx.advance(item, chunk.length);
  }
  const options = { flags: "wx", durable: true, signal: ctx.signal, onChunk };
  await bufferedCopy.copyThroughBuffer(item.source, item.target, options);
  const streamed = hash.digest("hex");
  const reread = await digestOf(item.target, item.size, ctx.signal);
  const matches = reread === streamed;
  if (!matches) throw mismatchOf(item.relative);
  await fs.utimes(item.target, item.accessed, item.modified).catch(ignore);
  return { digest: streamed, remember: true };
}

// Первый способ, который сработал, кладёт файл; остальные не зовутся.
async function placeFile(ctx, job) {
  const shared = await shareCacheCopy(ctx, job);
  if (shared) return shared;
  const linked = await linkToSource(ctx, job);
  if (linked) return linked;
  return copyBytes(ctx, job);
}

function rememberPlaced(ctx, job, outcome) {
  if (job.inode) ctx.twins.set(job.inode, job.target);
  if (outcome.digest) ctx.prints.set(job.target, outcome.digest);
}

async function placeOneItem(ctx, into, signal, files, item) {
  throwIfAborted(signal);
  const target = path.join(into, item.relative);
  const job = { ...item, target };
  await fs.mkdir(path.dirname(job.target), { recursive: true });
  const outcome = await placeFile(ctx, job);
  if (outcome.remember) rememberPlaced(ctx, job, outcome);
  files.push({ relative: job.relative, size: job.size, sha256: outcome.digest });
}

export const copyRestorePoints = scope.writesStore(async function copyRestorePoints(options) {
  const { from, into } = options;
  const signal = options.signal === undefined ? null : options.signal;
  const onProgress = options.onProgress === undefined ? null : options.onProgress;
  const rewrite = options.rewrite === undefined ? null : options.rewrite;
  const linkFile = options.linkFile === undefined ? fs.link : options.linkFile;
  const statfs = options.statfs === undefined ? fs.statfs : options.statfs;
  const reserveBytes = options.reserveBytes === undefined ? 268435456 : options.reserveBytes;
  const twins = options.twins === undefined ? new Map() : options.twins;

  const allNames = await listFiles(from);
  const names = allNames.filter((name) => name !== MOVED_MARKER);
  const journal = names.find((name) => UNFINISHED_POINT_JOURNALS.includes(name));
  if (journal) {
    const busy = refusal(CODE_BUSY, WRITING_MESSAGE);
    busy.journal = journal;
    throw busy;
  }
  await refuseOccupied(into);
  if (!names.length) return { files: [], bytes: 0 };

  const measured = await measureSources(from, names, twins);
  const { items, totalBytes, needed } = measured;
  const ctx = makeCopyContext({ totalBytes, onProgress, signal, linkFile, twins });
  const files = [];

  try {
    await fs.mkdir(into, { recursive: true });
    const sameVolume = await probeLink(ctx.linked, items[0].source, into);
    const needsRoom = !sameVolume && statfs !== null;
    if (needsRoom) await ensureRoom(into, statfs, needed, reserveBytes);

    await inOrder(items, (item) => placeOneItem(ctx, into, signal, files, item));
    if (rewrite) await rewriteManifests(into, names, rewrite);
  } catch (error) {
    await eraseTreeQuietly(into);
    throw error;
  }
  return { files, bytes: totalBytes };
});

// ------------------------------------------------------------- размещение

export const placeRestorePoints = scope.writesStore(async function placeRestorePoints(into, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  const taken = await exists(to);
  const aside = taken ? `${to}.previous-${crypto.randomUUID()}` : null;
  if (taken) await fs.rename(to, aside);
  try {
    await fs.rename(into, to);
  } catch (error) {
    if (taken) await fs.rename(aside, to).catch(ignore);
    throw error;
  }
  return { to, aside };
});

export const undoPlaceRestorePoints = scope.writesStore(async function undoPlaceRestorePoints(options) {
  const { to, aside } = options;
  await eraseTree(to);
  if (aside) await fs.rename(aside, to);
});

// ---------------------------------------------------------------- слияние

async function moveInto(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  return fs.rename(source, destination);
}

async function moveOneMissing(loser, winner, bucket, relative) {
  const destination = path.join(winner, bucket, relative);
  const already = await exists(destination);
  if (already) return;
  await moveInto(path.join(loser, bucket, relative), destination);
}

// Куски и якоря встают по тем же относительным путям; что у победителя уже есть, не трогается.
async function moveMissingFiles(loser, winner, bucket) {
  const relatives = await listFiles(path.join(loser, bucket));
  await inOrder(relatives, (relative) => moveOneMissing(loser, winner, bucket, relative));
}

async function settleOneFolder(loser, winner, lostPoints, folder, settled) {
  const landing = path.join(winner, "restore-points", folder.name);
  const already = await exists(landing);
  if (already) return;
  await moveInto(path.join(lostPoints, folder.name), landing);
  settled.push(folder.name);
}

export const mergeAbsentRestorePoints = scope.writesStore(async function mergeAbsentRestorePoints(loser, winner) {
  const namedLoser = typeof loser === "string" && loser;
  if (!namedLoser || !(await exists(loser))) return [];
  const hasMarker = await readMovedMarker(loser);
  if (hasMarker) {
    await eraseTree(loser);
    return [];
  }

  const lostPoints = path.join(loser, "restore-points");
  const lostEntries = await entriesOf(lostPoints);
  const lostFolders = lostEntries.filter((entry) => entry.isDirectory());
  const settled = [];
  await inOrder(lostFolders, (folder) => settleOneFolder(loser, winner, lostPoints, folder, settled));
  if (settled.length > 0) await inOrder(["chunks", "anchors"], (bucket) => moveMissingFiles(loser, winner, bucket));
  await eraseTree(loser);
  return settled;
});

// ---------------------------------------------- удаление перенесённого

export const removeTransferredRestorePoints = scope.writesStore(async function removeTransferredRestorePoints(
  from,
  files,
  options = {}
) {
  const movedTo = options.movedTo === undefined ? "" : options.movedTo;
  if (!files.length) return undefined;
  const relatives = files.map((file) => file.relative);
  await writeMovedMarker(from, movedTo, relatives);

  await inOrder(relatives, (relative) => eraseFile(path.join(from, relative)));
  const folderEntries = await entriesOf(from);
  const folders = folderEntries.filter((entry) => entry.isDirectory());
  await inOrder(folders, (folder) => removeEmptyDirectories(path.join(from, folder.name)));

  const leftover = await namesIn(from);
  const onlyMarkerLeft = leftover.length === 1 && leftover[0] === MOVED_MARKER;
  if (onlyMarkerLeft) {
    await fs.rm(path.join(from, MOVED_MARKER), { force: true });
    await fs.rmdir(from).catch(ignore);
  }
  return undefined;
});

// ---------------------------------------------------- уборка остатков

// Запись метки годится, если это непустая строка, не абсолютный путь и без звена «..».
function isRemovableEntry(entry) {
  const usable = typeof entry === "string" && entry !== "" && !path.isAbsolute(entry);
  return usable && !entry.split(/[\\/]/).some((piece) => piece === "..");
}

// Убирает файлы, названные в метке прежнего переезда, и саму метку; сколько убрано.
async function removeMarkedFiles(from, marked) {
  const doomed = marked.filter(isRemovableEntry);
  await inOrder(doomed, (entry) => eraseFile(path.join(from, entry)));
  await fs.rm(path.join(from, MOVED_MARKER), { force: true });
  return doomed.length;
}

// Остаток переносится ещё раз: копия во временную папку, слияние на место, затем уборка источника.
async function transferLeftovers(from, to, rest) {
  const workDir = `${to}.transfer-${crypto.randomUUID()}`;
  const copied = await copyRestorePoints({ from, into: workDir, ...rest });
  async function onMergeFailure(error) {
    await eraseTreeQuietly(workDir);
    throw error;
  }
  const kept = await mergeAbsentRestorePoints(workDir, to).catch(onMergeFailure);
  await removeTransferredRestorePoints(from, copied.files, { movedTo: to });
  return kept;
}

export const sweepLeftoverRestorePoints = scope.writesStore(async function sweepLeftoverRestorePoints(options) {
  const { from, to, ...rest } = options;
  const marked = await readMovedMarker(from);
  const removed = marked ? await removeMarkedFiles(from, marked) : 0;
  await removeEmptyDirectories(from);
  const remaining = await listFiles(from);
  if (remaining.length > 0) {
    const kept = await transferLeftovers(from, to, rest);
    return { removed, kept };
  }
  await eraseTreeQuietly(from);
  return { removed, kept: [] };
});

// Соседи главной папки точек: рабочие копии прерванных переездов и отложенное прежнее.
const SIBLING_PATTERN = /^(transfer|previous)-[0-9a-f-]{36}$/i;

async function settleOneSibling(parent, prefix, to, folder) {
  const matchable = folder.name.startsWith(prefix);
  const found = matchable ? SIBLING_PATTERN.exec(folder.name.slice(prefix.length)) : null;
  if (!found) return;
  const sibling = path.join(parent, folder.name);
  const isTransfer = found[1].toLowerCase() === "transfer";
  if (isTransfer) await eraseTreeQuietly(sibling);
  else await mergeAbsentRestorePoints(sibling, to).catch(() => []);
}

export const settleRestorePointsSiblings = scope.writesStore(async function settleRestorePointsSiblings(to) {
  const parent = path.dirname(to);
  const prefix = `${path.basename(to)}.`;
  const entries = await entriesOf(parent);
  const folders = entries.filter((entry) => entry.isDirectory());
  await inOrder(folders, (folder) => settleOneSibling(parent, prefix, to, folder));
});

// -------------------------------------------------------- подбор точек

function reportMoved(result, log) {
  if (!result?.moved) return;
  const size = gigabytes(result.bytes);
  log({ level: "info", message: `Точки отката переехали в папку кэша: файлов ${result.files}, ${size} ГБ.` });
}

function reportSwept(result, log) {
  const swept = result?.swept;
  if (!(swept?.removed || swept?.kept?.length)) return;
  const sweptText = `убрано файлов ${swept.removed}, к живым встали ${swept.kept.length}.`;
  log({ level: "info", message: `Остатки точек в папке по умолчанию: ${sweptText}` });
}

export function scheduleRestorePointsAdoption(options) {
  const { adopt } = options;
  const log = options.log === undefined ? () => {} : options.log;
  const delayMs = options.delayMs === undefined ? 90000 : options.delayMs;
  const retryMs = options.retryMs === undefined ? 600000 : options.retryMs;
  const attempts = options.attempts === undefined ? 6 : options.attempts;
  const timers = options.timers === undefined ? { setTimeout } : options.timers;

  let attemptsLeft = attempts;
  function arm(ms) {
    timers.setTimeout(tick, ms)?.unref?.();
  }

  async function tick() {
    attemptsLeft -= 1;
    try {
      const result = await adopt();
      reportMoved(result, log);
      reportSwept(result, log);
    } catch (error) {
      const waiting = [CODE_BUSY, CODE_MOVING].includes(error?.code);
      log({ level: waiting ? "info" : "warn", message: `Точки отката не переехали: ${error?.message || error}` });
      if (waiting && attemptsLeft > 0) arm(retryMs);
    }
  }

  arm(delayMs);
}
