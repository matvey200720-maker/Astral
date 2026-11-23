import path from "node:path";
import * as crypto from "node:crypto";
import * as nodeFs from "node:fs";
import * as fsp from "node:fs/promises";
import * as chunks from "./restore-point-chunks.js";
import * as chain from "./native-restore-chain.js";

const BLOCK_BYTES = 8 * 1024 * 1024;
const NO_GATE_MESSAGE = "buildChainIndex: нужны ворота простоя диска (housekeeping-gate).";

export const CHAIN_INDEX_FILE = "chain.v2.json";
export const CHAIN_INDEX_VERSION = 2;

const TEMP_HEAD = `${CHAIN_INDEX_FILE}.`;
const TEMP_TAIL = ".tmp";
// Поля, взятые у точки как есть; остальное в отпечатке считается по диску.
const COPIED_FIELDS = ["id", "createdAt", "before", "after"];
// Совпадение этих полей отпечатка позволяет не читать копию заново.
const REUSE_KEYS = ["before", "after", "packed", "backupBytes", "mtimeMs", "createdAt"];
// Опись пишется после каждой дочитанной копии (в том числе нечитаемой), но не после пропусков.
const SAVES_AFTER = new Set(["read"]);

// Результат задания или запасное значение, если оно отказало.
async function attempt(job, fallback) {
  try {
    return await job();
  } catch {
    return fallback;
  }
}

function indexPath(root) {
  return path.join(root, CHAIN_INDEX_FILE);
}

function isUsableIndex(value) {
  if (!value) return false;
  return Array.isArray(value.points) && value.version === CHAIN_INDEX_VERSION;
}

export async function readChainIndex(root) {
  const loaded = await Promise.resolve()
    .then(() => fsp.readFile(indexPath(root), "utf8"))
    .then(JSON.parse)
    .catch(() => null);
  return isUsableIndex(loaded) ? loaded : null;
}

// Имя временного файла рядом с описью: «<файл>.<uuid>.tmp».
const tempNameIn = (root) => path.join(root, `${TEMP_HEAD}${crypto.randomUUID()}${TEMP_TAIL}`);

async function fillTemp(handle, index) {
  const text = JSON.stringify(index, null, 1);
  await handle.writeFile(text);
  await handle.sync();
}

export async function writeChainIndex(root, index, hooks = {}) {
  const parents = { recursive: true };
  await fsp.mkdir(root, parents);
  const tempPath = tempNameIn(root);
  const handle = await fsp.open(tempPath, "w");
  await fillTemp(handle, index).finally(() => handle.close());
  const target = indexPath(root);
  await hooks.beforeRename?.(tempPath);
  await fsp.rename(tempPath, target);
}

function isOrphanName(name) {
  return name.startsWith(TEMP_HEAD) && name.endsWith(TEMP_TAIL) && name.length > TEMP_HEAD.length + TEMP_TAIL.length;
}

// Все удаления запускаются разом; отказ одного выходит наружу, остальные уже в пути.
async function sweepOrphans(root) {
  const names = await attempt(() => fsp.readdir(root), []);
  const stale = names.filter(isOrphanName);
  const removals = stale.map((name) => {
    const target = path.join(root, name);
    return fsp.rm(target, { force: true });
  });
  await Promise.all(removals);
}

const failureText = (failure) => String(failure?.message || failure);

function byTimeThenId(a, b) {
  return String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);
}

// Отпечаток точки: что о ней известно без чтения копии.
async function fingerprintOf(point) {
  const print = Object.fromEntries(COPIED_FIELDS.map((field) => [field, point[field]]));
  print.packed = Boolean(point.packed);
  let target = point.backupPath;
  if (print.packed) {
    target = chunks.packedManifestPath(point.backupPath);
  }
  const info = await attempt(() => fsp.stat(target), null);
  const measured = info ? { backupBytes: info.size, mtimeMs: info.mtimeMs } : { backupBytes: null, mtimeMs: null };
  return { ...print, ...measured };
}

function isStillValid(earlier, print) {
  if (!earlier?.verified) return false;
  return REUSE_KEYS.every((key) => earlier[key] === print[key]);
}

async function* copyBlocks(point) {
  if (!point.packed) {
    const streamOptions = { highWaterMark: BLOCK_BYTES };
    yield* nodeFs.createReadStream(point.backupPath, streamOptions);
    return;
  }
  const manifest = await chunks.readPackedManifest(point.backupPath);
  yield* chunks.packedReadStream(manifest, chain.pointChunksRoot(point.directory));
}

// Хеш копии блок за блоком под присмотром ворот. Остановка — не ошибка.
async function digestCopy(point, gate) {
  const hash = crypto.createHash("sha256");
  for await (const block of copyBlocks(point)) {
    const stop = gate.mustStop();
    if (stop) return { halted: true, reason: stop };
    hash.update(block);
    if (typeof gate.pace === "function") {
      await gate.pace(block.length);
    }
  }
  return { halted: false, sha256: hash.digest("hex") };
}

// Вердикт по точке: skipped — копии нет, read — копию дочитали (или не смогли), halted — ворота велели стоять.
async function appraise(point, print, gate) {
  const entryFor = (verified, status, backupSha256, extra) => ({
    ...print,
    verified,
    status,
    backupSha256,
    ...extra,
  });
  if (!point.backup) {
    const skipStatus = point.engine ? "engine-step" : "no-copy";
    return { kind: "skipped", entry: entryFor(false, skipStatus, null) };
  }
  try {
    const { halted, reason, sha256 } = await digestCopy(point, gate);
    if (halted) return { kind: "halted", reason };
    const status = sha256 === point.before ? "ok" : "mismatch";
    return { kind: "read", entry: entryFor(true, status, sha256) };
  } catch (failure) {
    return { kind: "read", entry: entryFor(false, "unreadable", null, { error: failureText(failure) }) };
  }
}

// Один проход по точкам: накопленные записи и запись описи на диск.
function makePass(root, gameRoot, hooks) {
  const points = [];

  const stamp = () => new Date().toISOString();
  const snapshot = (complete) => ({ version: CHAIN_INDEX_VERSION, complete, gameRoot, updatedAt: stamp(), points });
  const save = (complete) => writeChainIndex(root, snapshot(complete), hooks);

  // Одна точка: либо взята из прежней описи, либо оценена заново. Вернёт вердикт-остановку или null.
  async function consider(point, earlier, gate) {
    const print = await fingerprintOf(point);
    const known = earlier.get(point.id);
    const verdict = isStillValid(known, print) ? { kind: "reused", entry: known } : await appraise(point, print, gate);
    if (verdict.kind !== "halted") {
      points.push(verdict.entry);
      if (SAVES_AFTER.has(verdict.kind)) await save(false);
    }
    return verdict.kind === "halted" ? verdict : null;
  }

  async function run(ordered, earlier, gate) {
    const total = ordered.length;
    let halt = null;
    for (let at = 0; at < total && halt === null; at += 1) {
      halt = await consider(ordered[at], earlier, gate);
    }
    await save(halt === null);
    const done = points.length;
    if (halt === null) return { status: "complete", done, total, points };
    return { status: "paused", reason: halt.reason, done, total, points };
  }

  return { run };
}

// Ворота не дали начать: причина и сколько ждать (если сказано).
function notStarted(permit) {
  return { status: "waiting", reason: permit.reason, waitMs: permit.waitMs ?? null, done: 0, total: 0, points: [] };
}

export async function buildChainIndex(options) {
  const { root, gameRoot, gate } = options;
  const hooks = options.hooks === undefined ? {} : options.hooks;
  if (!gate) {
    throw new Error(NO_GATE_MESSAGE);
  }
  const permit = await gate.mayStart();
  if (!permit.ok) return notStarted(permit);

  await sweepOrphans(root);
  const prior = await readChainIndex(root);
  const earlier = new Map(prior ? prior.points.map((entry) => [entry.id, entry]) : []);
  const found = await chain.readRestorePoints(root, gameRoot);
  const ordered = [...found].sort(byTimeThenId);

  return makePass(root, gameRoot, hooks).run(ordered, earlier, gate);
}
