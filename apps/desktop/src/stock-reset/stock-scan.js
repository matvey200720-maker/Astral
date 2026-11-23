/*
 * Сверка папки игры с описью штатной GTA V («Сбросить GTA до стандартной»).
 *
 * Работает в потоке (`stock-scan-worker.js`), не в главном процессе: обход
 * папки и хеши архивов в десятки гигабайт — это минуты чтения диска.
 *
 * Быстро там, где можно:
 *   • размер не тот — файл изменён, читать его незачем;
 *   • размер тот — сверяется хеш первого мегабайта (`head`): у архива RPF там
 *     оглавление, и любая правка OpenIV его меняет;
 *   • полная сверка (`mode: "full"`) читает файл целиком и сверяет sha256;
 *   • хеш помнится по размеру и времени файла (`cache`): повторная сверка
 *     того же не перечитывает.
 *
 * Лишнее (файлы, которых нет в описи) считается лишним только при описи,
 * которой можно верить: она от того же GTA5.exe и в папке есть почти всё,
 * что она перечисляет. Иначе лишним называется только то, что заведомо
 * принесли моды (`stock-rules.js`), — оглавление, собранное не для этой
 * игры, не должно унести в карантин полпапки.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRules, posixRelative } from "./stock-rules.js";
import { HEAD_BYTES, findManifest } from "./stock-manifest.js";

/* Доверие описи: столько файлов из неё должно найтись в папке. */
export const TRUST_PRESENT_SHARE = 0.9;
export const TRUST_MIN_FILES = 20;
/* Сколько строк каждого списка уходит в окно (итоги считаются по всем). */
export const LIST_LIMIT = 400;

const EXECUTABLES = Object.freeze({ Legacy: "GTA5.exe", Enhanced: "GTA5_Enhanced.exe" });

export async function hashHead(file, bytes = HEAD_BYTES) {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
  } finally {
    await handle.close();
  }
}

export function hashFile(file, onBytes = () => {}) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
    stream.on("data", (chunk) => {
      hash.update(chunk);
      onBytes(chunk.length);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Все файлы под `root`: относительный путь `/`, размер и время. Ссылки не проходятся. */
export async function walkGame(root) {
  const files = [];
  const links = [];
  async function visit(directory, prefix) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) links.push(relative);
      else if (entry.isDirectory()) await visit(full, relative);
      else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) files.push({ path: relative, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
      }
    }
  }
  await visit(path.resolve(root), "");
  return { files, links };
}

/*
 * Что уносить целиком. Папка, в которой всё лишнее (`mods/`, папка ENB,
 * добавленный DLC-пакет), уходит одной строкой и одним переносом; файл
 * рядом со штатными — сам по себе.
 */
export function groupExtras(extras, others) {
  const totals = new Map();
  const extraCount = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const parents = (relative) => {
    const parts = relative.split("/");
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/").toLowerCase());
  };
  for (const item of extras)
    for (const dir of parents(item.path)) {
      bump(totals, dir);
      bump(extraCount, dir);
    }
  for (const relative of others) for (const dir of parents(relative)) bump(totals, dir);
  const pure = (dir) => totals.get(dir) > 0 && totals.get(dir) === extraCount.get(dir);
  const units = new Map();
  for (const item of extras) {
    const dirs = parents(item.path);
    const top = dirs.find(pure);
    const key = top || item.path.toLowerCase();
    const unitPath = top ? item.path.split("/").slice(0, top.split("/").length).join("/") : item.path;
    const unit = units.get(key) || { path: unitPath, type: top ? "dir" : "file", files: 0, bytes: 0, kinds: {} };
    unit.files += 1;
    unit.bytes += item.size;
    unit.kinds[item.kind] = (unit.kinds[item.kind] || 0) + 1;
    units.set(key, unit);
  }
  return [...units.values()]
    .map(({ kinds, ...unit }) => ({
      ...unit,
      kind: Object.entries(kinds).sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
}

/**
 * Сверка. Вход переносится копией (поток), поэтому всё — простые значения.
 *
 * @param {object} input
 * @param {string} input.gameRoot
 * @param {object|null} input.manifest проверенная опись (`validateManifest`) или `null`
 * @param {string} [input.manifestStatus] почему описи нет: missing | unavailable
 * @param {string[]} [input.astralPaths] файлы, в которых сейчас лежат моды Astral
 * @param {"quick"|"full"} [input.mode]
 * @param {Record<string, object>} [input.cache] память хешей прошлой сверки
 */
export async function scanStockGame(input, { onProgress = () => {} } = {}) {
  const { gameRoot, manifest = null, mode = "quick" } = input;
  const cache = { ...(input.cache || {}) };
  const rules = createRules(manifest);
  const astralSet = new Set((input.astralPaths || []).map((item) => posixRelative(item).toLowerCase()));
  onProgress({ phase: "walk" });
  const { files, links } = await walkGame(gameRoot);
  const onDisk = new Map(files.map((item) => [item.path.toLowerCase(), item]));
  const stock = new Map((manifest?.files || []).map((item) => [item.path.toLowerCase(), item]));

  const present = manifest ? manifest.files.filter((item) => onDisk.has(item.path.toLowerCase())).length : 0;
  const trusted = Boolean(
    manifest && manifest.files.length >= TRUST_MIN_FILES && present / manifest.files.length >= TRUST_PRESENT_SHARE,
  );

  const astral = [];
  const extras = [];
  const others = [];
  const toCheck = [];
  let ignored = 0;
  let unknown = 0;
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (rules.astral(file.path) || astralSet.has(lower)) {
      astral.push(file.path);
      others.push(file.path);
      continue;
    }
    const expected = stock.get(lower);
    if (expected) {
      toCheck.push({ file, expected });
      others.push(file.path);
      continue;
    }
    if (rules.ignored(file.path)) {
      ignored += 1;
      others.push(file.path);
      continue;
    }
    const kind = rules.nonStock(file.path) || (trusted ? "other" : null);
    if (kind) extras.push({ ...file, kind });
    else {
      unknown += 1;
      others.push(file.path);
    }
  }

  const modified = [];
  const headBytes = manifest?.headBytes || HEAD_BYTES;
  const totalBytes = toCheck.reduce(
    (sum, { file, expected }) => sum + (file.size !== expected.size ? 0 : mode === "full" ? file.size : Math.min(file.size, headBytes)),
    0,
  );
  let doneBytes = 0;
  let done = 0;
  const report = () => onProgress({ phase: "hash", done, total: toCheck.length, bytesDone: doneBytes, bytesTotal: totalBytes });
  report();
  let lastReport = Date.now();
  for (const { file, expected } of toCheck) {
    done += 1;
    if (file.size !== expected.size) {
      modified.push({ path: file.path, reason: "size", size: file.size, expectedSize: expected.size });
      continue;
    }
    const key = file.path.toLowerCase();
    const remembered = cache[key]?.size === file.size && cache[key]?.mtimeMs === file.mtimeMs ? cache[key] : null;
    const memo = remembered || { size: file.size, mtimeMs: file.mtimeMs };
    const full = path.join(gameRoot, ...file.path.split("/"));
    try {
      if (expected.head) {
        memo.head ||= await hashHead(full, headBytes);
        doneBytes += Math.min(file.size, headBytes);
        if (memo.head !== expected.head) {
          modified.push({ path: file.path, reason: "content", size: file.size, expectedSize: expected.size });
          cache[key] = memo;
          continue;
        }
      }
      if (mode === "full") {
        memo.sha256 ||= await hashFile(full, (bytes) => {
          doneBytes += bytes;
          if (Date.now() - lastReport > 250) {
            lastReport = Date.now();
            report();
          }
        });
        if (memo.sha256 !== expected.sha256)
          modified.push({ path: file.path, reason: "content", size: file.size, expectedSize: expected.size });
      }
      cache[key] = memo;
    } catch (error) {
      modified.push({ path: file.path, reason: "unreadable", size: file.size, expectedSize: expected.size, error: error?.code || "read" });
    }
    if (Date.now() - lastReport > 250) {
      lastReport = Date.now();
      report();
    }
  }
  report();

  const missing = (manifest?.files || [])
    .filter((item) => !onDisk.has(item.path.toLowerCase()) && !astralSet.has(item.path.toLowerCase()))
    .map((item) => ({ path: item.path, size: item.size }));
  const units = groupExtras(extras, others);
  const extraBytes = units.reduce((sum, unit) => sum + unit.bytes, 0);
  return {
    gameRoot: path.resolve(gameRoot),
    mode,
    scannedAt: new Date().toISOString(),
    manifest: manifest
      ? { status: trusted ? "matched" : "untrusted", id: manifest.id, edition: manifest.edition, store: manifest.store, exeVersion: manifest.exeVersion }
      : { status: input.manifestStatus || "missing" },
    totals: {
      files: files.length,
      stock: manifest?.files.length || 0,
      checked: toCheck.length,
      modified: modified.length,
      missing: missing.length,
      extraUnits: units.length,
      extraFiles: extras.length,
      extraBytes,
      astral: astral.length,
      ignored,
      unknown,
      links: links.length,
    },
    modified: modified.slice(0, LIST_LIMIT),
    missing: missing.slice(0, LIST_LIMIT),
    extras: units.slice(0, LIST_LIMIT),
    /* Полный список единиц переноса — только для главного процесса (план). */
    allExtras: units,
    cache,
  };
}

/**
 * Полная сверка от папки игры: хеш GTA5.exe → опись → сверка. Так её зовёт поток.
 * @param {object} input `scanStockGame` + `edition`, `store`, `executable`, `sources` для `findManifest`
 */
export async function runStockScan(input, { onProgress = () => {}, fetchImpl = globalThis.fetch } = {}) {
  const exeName = input.executable || EXECUTABLES[input.edition] || EXECUTABLES.Legacy;
  const exePath = path.join(input.gameRoot, exeName);
  onProgress({ phase: "exe" });
  let exeSha256 = null;
  try {
    const stat = await fs.stat(exePath);
    const key = exeName.toLowerCase();
    const memo = input.cache?.[key];
    exeSha256 = memo?.size === stat.size && memo?.mtimeMs === Math.round(stat.mtimeMs) && memo.sha256 ? memo.sha256 : await hashFile(exePath);
    input = { ...input, cache: { ...(input.cache || {}), [key]: { ...(memo || {}), size: stat.size, mtimeMs: Math.round(stat.mtimeMs), sha256: exeSha256 } } };
  } catch {}
  onProgress({ phase: "manifest" });
  const found = exeSha256
    ? await findManifest({ exeSha256, store: input.store, ...(input.sources || {}), fetchImpl })
    : { status: "missing" };
  const result = await scanStockGame(
    { ...input, manifest: found.manifest || null, manifestStatus: found.status },
    { onProgress },
  );
  return { ...result, exe: { name: exeName, sha256: exeSha256 } };
}
