/*
 * Карантин «Сбросить GTA до стандартной»: лишнее из папки игры не стирается,
 * а переезжает в папку данных Astral и может вернуться кнопкой «Вернуть
 * убранные файлы».
 *
 *   <root>/<сеанс>/ledger.json   — что откуда взято, сколько, когда;
 *   <root>/<сеанс>/files/<путь>  — сами файлы, по их путям от корня игры.
 *
 * Опись пишется до переноса и после каждого: оборванный перенос (выключили
 * компьютер, файл заняла игра) не теряет, что уже уехало. Перенос — сменой
 * имени, если папка данных на том же диске, иначе копия, сверка размера и
 * только потом удаление исходника; до первого байта проверяется, хватит ли
 * места на диске данных.
 *
 * Возврат не затирает: если на прежнем месте уже лежит файл (Steam вернул
 * штатный при проверке, человек поставил новый мод), он остаётся, а
 * отложенный ждёт в карантине и называется конфликтом.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { posixRelative } from "./stock-rules.js";

export const LEDGER = "ledger.json";
export const LEDGER_SCHEMA = "astral-stock-quarantine/1";
/* Ещё в карантине: «pending» — перенос оборвался, файл мог успеть уехать (возврат смотрит по месту). */
const KEPT_STATES = new Set(["moved", "conflict", "pending"]);
const SESSION = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/;

const exists = (file) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

function inside(root, relative) {
  const clean = posixRelative(relative);
  /* `:` в имени на Windows быть не может — это диск («C:») или поток NTFS. */
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":")))
    throw new Error(`Путь вне папки: ${relative}`);
  const base = path.resolve(root);
  const full = path.resolve(base, ...clean.split("/"));
  const diff = path.relative(base, full);
  if (!diff || diff.startsWith("..") || path.isAbsolute(diff)) throw new Error(`Путь вне папки: ${relative}`);
  return full;
}

const sameRoot = (left, right) => path.resolve(String(left || "")).toLowerCase() === path.resolve(String(right || "")).toLowerCase();

async function writeLedger(directory, ledger) {
  const file = path.join(directory, LEDGER);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(ledger, null, 2));
  await fs.rename(temporary, file);
}

async function readLedger(directory) {
  const ledger = JSON.parse(await fs.readFile(path.join(directory, LEDGER), "utf8"));
  if (ledger?.schema !== LEDGER_SCHEMA || !Array.isArray(ledger.items)) throw new Error("Опись карантина повреждена.");
  return ledger;
}

async function filesUnder(directory) {
  const out = [];
  async function visit(current, prefix) {
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(current, entry.name), relative);
      else if (entry.isFile()) out.push(relative);
    }
  }
  await visit(directory, "");
  return out;
}

async function sizeOf(target) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const relative of await filesUnder(target)) total += (await fs.stat(path.join(target, relative))).size;
  return total;
}

async function removeEmptyDirs(directory, keepRoot = true) {
  let empty = true;
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && (await removeEmptyDirs(path.join(directory, entry.name), false))) continue;
    empty = false;
  }
  if (empty && !keepRoot) await fs.rmdir(directory).catch(() => {});
  return empty;
}

/*
 * Перенос файла или папки. Тот же диск — смена имени. Другой — копия рядом
 * с местом назначения, сверка размера, смена имени копии, и только после
 * этого исходник удаляется: на полпути оборванная копия не выдаётся за
 * перенесённую, а исходник цел.
 */
export async function moveEntry(from, to, { rename = fs.rename } = {}) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  if (await exists(to)) throw Object.assign(new Error(`Место занято: ${to}`), { code: "EEXIST" });
  try {
    await rename(from, to);
    return "renamed";
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
  }
  const stage = `${to}.astral-copy-${randomUUID().slice(0, 8)}`;
  const expected = await sizeOf(from);
  await fs.cp(from, stage, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  if ((await sizeOf(stage)) !== expected) {
    await fs.rm(stage, { recursive: true, force: true });
    throw new Error(`Копия не сошлась по размеру: ${from}`);
  }
  await fs.rename(stage, to);
  await fs.rm(from, { recursive: true, force: true });
  return "copied";
}

const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

async function freeBytes(directory) {
  try {
    const info = await fs.statfs(directory);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return Infinity;
  }
}

/**
 * Уносит лишнее в карантин.
 * @param {object} input
 * @param {string} input.root папка карантина в данных Astral
 * @param {string} input.gameRoot
 * @param {string} [input.targetId]
 * @param {Array<{ path: string, type?: string, files?: number, bytes?: number, kind?: string }>} input.units
 */
export async function moveToQuarantine({ root, gameRoot, targetId = null, units, now = () => new Date(), rename = fs.rename }) {
  const game = path.resolve(gameRoot);
  const plan = [];
  for (const unit of units || []) {
    const live = inside(game, unit.path);
    const stat = await fs.lstat(live).catch(() => null);
    if (!stat || stat.isSymbolicLink()) continue;
    plan.push({ unit, live, bytes: Number(unit.bytes) || (await sizeOf(live)) });
  }
  if (!plan.length) return { sessionId: null, moved: [], failed: [] };
  await fs.mkdir(root, { recursive: true });
  /* Другой диск — копия: места должно хватить на всё, что поедет копией. */
  const [gameDev, rootDev] = await Promise.all([fs.stat(game).then((s) => s.dev), fs.stat(root).then((s) => s.dev)]);
  if (gameDev !== rootDev) {
    const needed = plan.reduce((sum, item) => sum + item.bytes, 0);
    const free = await freeBytes(root);
    if (free < needed + 256 * 1024 * 1024)
      throw Object.assign(new Error("Не хватает места на диске данных Astral для карантина."), { code: "ENOSPC", needed, free });
  }
  const created = now();
  const sessionId = `${stamp(created)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(root, sessionId);
  const ledger = {
    schema: LEDGER_SCHEMA,
    id: sessionId,
    gameRoot: game,
    targetId,
    createdAt: created.toISOString(),
    items: plan.map(({ unit, bytes }) => ({
      path: posixRelative(unit.path),
      type: unit.type === "dir" ? "dir" : "file",
      kind: unit.kind || "other",
      files: Number(unit.files) || 1,
      bytes,
      state: "pending",
    })),
  };
  await fs.mkdir(path.join(directory, "files"), { recursive: true });
  await writeLedger(directory, ledger);
  const moved = [];
  const failed = [];
  for (const [index, { live }] of plan.entries()) {
    const item = ledger.items[index];
    try {
      await moveEntry(live, inside(path.join(directory, "files"), item.path), { rename });
      item.state = "moved";
      moved.push(item.path);
    } catch (error) {
      item.state = "failed";
      item.error = error?.code || String(error?.message || error).slice(0, 200);
      failed.push({ path: item.path, error: item.error });
    }
    await writeLedger(directory, ledger);
  }
  if (!moved.length) await fs.rm(directory, { recursive: true, force: true });
  return { sessionId: moved.length ? sessionId : null, moved, failed };
}

/** Сеансы карантина (для этой игры, если `gameRoot` задан), новые сверху. */
export async function listQuarantine({ root, gameRoot = null }) {
  const sessions = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !SESSION.test(entry.name)) continue;
    try {
      const ledger = await readLedger(path.join(root, entry.name));
      if (gameRoot && !sameRoot(ledger.gameRoot, gameRoot)) continue;
      const kept = ledger.items.filter((item) => KEPT_STATES.has(item.state));
      if (!kept.length) continue;
      sessions.push({
        id: ledger.id,
        gameRoot: ledger.gameRoot,
        createdAt: ledger.createdAt,
        items: kept.map(({ path: relative, type, kind, files, bytes, state }) => ({ path: relative, type, kind, files, bytes, state })),
        files: kept.reduce((sum, item) => sum + item.files, 0),
        bytes: kept.reduce((sum, item) => sum + item.bytes, 0),
      });
    } catch {}
  }
  return sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Возвращает отложенное на прежние места. Занятое место не затирается.
 * @returns {Promise<{ returned: string[], conflicts: string[], failed: Array, remaining: number }>}
 */
export async function restoreFromQuarantine({ root, sessionId, gameRoot = null, rename = fs.rename }) {
  if (!SESSION.test(String(sessionId || ""))) throw new Error("Нет такого карантина.");
  const directory = path.join(root, sessionId);
  const ledger = await readLedger(directory);
  if (gameRoot && !sameRoot(ledger.gameRoot, gameRoot)) throw new Error("Этот карантин от другой папки игры.");
  const game = path.resolve(ledger.gameRoot);
  const stored = path.join(directory, "files");
  const returned = [];
  const conflicts = [];
  const failed = [];
  for (const item of ledger.items) {
    if (!KEPT_STATES.has(item.state)) continue;
    const from = inside(stored, item.path);
    /* Папка возвращается по файлам: что уже есть на месте, остаётся. */
    const pieces = item.type === "dir" ? (await filesUnder(from)).map((relative) => `${item.path}/${relative}`) : [item.path];
    let left = 0;
    for (const piece of pieces) {
      const source = inside(stored, piece);
      const destination = inside(game, piece);
      if (!(await exists(source))) continue;
      if (await exists(destination)) {
        conflicts.push(piece);
        left += 1;
        continue;
      }
      try {
        await moveEntry(source, destination, { rename });
        returned.push(piece);
      } catch (error) {
        failed.push({ path: piece, error: error?.code || String(error?.message || error).slice(0, 200) });
        left += 1;
      }
    }
    if (item.type === "dir") await removeEmptyDirs(from, false);
    item.state = left ? "conflict" : "returned";
    await writeLedger(directory, ledger);
  }
  const remaining = ledger.items.filter((item) => KEPT_STATES.has(item.state)).length;
  /* Всё вернулось и под `files` не осталось ни одного файла — сеанс убирается. */
  if (!remaining && !(await filesUnder(stored)).length) await fs.rm(directory, { recursive: true, force: true });
  else await removeEmptyDirs(stored);
  return { returned, conflicts, failed, remaining };
}
