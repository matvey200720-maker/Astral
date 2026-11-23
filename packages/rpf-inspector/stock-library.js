/*
 * Библиотека штатных версий игры (А10, шаг 1; `REDUX-SYSTEM-1011.md` §5, §9; решения ведущей 11.11.2026).
 *
 * Версия игры — ключ `buildKeyOf` (хвост `dlclist.xml` и число `dlc_patch`). Для каждой версии папка `<корень библиотеки>/<ключ>/`:
 *
 *   update.json.gz  — отпечаток ВСЕГО штатного `update.rpf` (путь, размер, sha256 содержимого; формат `catalog:baseline`);
 *   base.json.gz    — записи базовых архивов (`common.rpf`, `x64a.rpf … x64w.rpf`) ТОЛЬКО по запрошенным путям и только тем, чего нет в
 *                     `update.rpf`: «по запросу плюс пути маршрутов», а не полный снимок на десятки гигабайт. Пути приведены к виду, в котором
 *                     автор кладёт их в свой `update.rpf`: `common.rpf/data/ui/hudcolor.dat` → `common/data/ui/hudcolor.dat`,
 *                     `x64b.rpf/data/…` → `x64/data/…`. Уже снятые пути не читаются заново (кэш по ключу версии и пути);
 *   meta.json       — ключ, `dlclist`, число `dlc_patch`, дата, откуда снято, статус `ready`.
 *
 * Файлов Rockstar в библиотеке нет: только пути, размеры и sha256. Источник — чистая копия игры игрока, только чтение: основа после
 * перебазирования (`resource.compositionBase`), а если её нет — копия первой подготовки (`update-update.rpf.original.rpf`).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildKeyOf } from "./anatomy.js";
import { BASELINE_SCHEMA, buildPackBaseline, entryContentHash, readBaseline, writeBaseline } from "./baseline.js";

export const STOCK_LIBRARY_SCHEMA = 1;
export const STOCK_FILES = Object.freeze({ meta: "meta.json", update: "update.json.gz", base: "base.json.gz" });
const DLCLIST_PATH = "common/data/dlclist.xml";
/** Базовые архивы игры, из которых путь `x64/…` берёт запись: `x64a.rpf … x64w.rpf`. */
const X64_ARCHIVE = /^x64[a-z]\.rpf$/i;

const lower = (value) => String(value ?? "").split("\\").join("/").toLowerCase();
const exists = (file) => stat(file).then(() => true, () => false);

/** Ключ версии как имя папки: буквы, цифры, `+`, `_`, `-`, `.`. */
export const folderOfKey = (key) => String(key).replace(/[^a-z0-9+_.-]/gi, "_");

/** Отпечаток файла потоком: sha256 и размер (чистая копия `update.rpf` — около двух гигабайт). */
export async function fileFingerprint(file, signal = null) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    if (signal?.aborted) throw signal.reason || new Error("Отменено.");
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

/**
 * Чистая копия для библиотеки: `resource` — запись `update/update.rpf` состояния цели. Основа после перебазирования (`compositionBase`)
 * главнее копии первой подготовки: после обновления игры копия первой подготовки — прежняя версия (`cache-housekeeping.js`).
 * `{ kind, file }`; `null` — ни одного файла на месте.
 */
export async function stockSourceOf(resource, { stateDir = "", targetKey = "", has = exists } = {}) {
  const candidates = [
    ["compositionBase", resource?.compositionBase?.exists ? resource.compositionBase.path : null],
    ["original", resource?.original?.exists ? resource.original.path : null],
    ["firstCopy", stateDir && targetKey ? path.join(stateDir, "bases", targetKey, "update-update.rpf.original.rpf") : null],
  ];
  for (const [kind, file] of candidates) if (file && (await has(file))) return { kind, file };
  return null;
}

/**
 * Куда в базовых архивах смотреть запись `update.rpf`-пути: `common/…` — `common.rpf`; `x64/…` — один из `x64a.rpf … x64w.rpf`. Остальное
 * (`dlc_patch/…`, `update/…`, `x64/patch/…` в самом `update.rpf`) — не база: `null`.
 */
export function baseTargetOf(entryPath) {
  const entry = lower(entryPath);
  if (entry.startsWith("common/")) return { archive: "common", inner: entry.slice("common/".length) };
  if (entry.startsWith("x64/") && !entry.startsWith("x64/patch/") && !entry.startsWith("x64/astral/")) return { archive: "x64", inner: entry.slice("x64/".length) };
  return null;
}

/**
 * Список путей из текста: по строке на путь, `#` — комментарий; JSON-массив строк; либо реестр импорта (`state/import-registry.json`) —
 * тогда берутся пути записей привязок (`bindings`), кроме наших контейнеров `x64/astral/`.
 */
export function pathsFromText(text) {
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed)) return clean(parsed);
    if (parsed?.bindings && typeof parsed.bindings === "object") {
      const paths = [];
      for (const binding of Object.values(parsed.bindings)) for (const row of binding?.entries ?? []) if (row?.entry) paths.push(row.entry);
      return clean(paths);
    }
    if (Array.isArray(parsed?.paths)) return clean(parsed.paths);
  }
  return clean(raw.split(/\r?\n/).map((line) => line.replace(/#.*$/, "")));
}

function clean(list) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const entry = lower(value).trim();
    if (!entry || entry.startsWith("x64/astral/") || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.sort();
}

const textOf = (bytes) => new TextDecoder("utf-8").decode(bytes);

/** Прочитать базу из файла, если он есть и годится; иначе пустая. */
async function readBaseOrEmpty(file) {
  try {
    return await readBaseline(file);
  } catch {
    return { schema: BASELINE_SCHEMA, source: { name: "base archives", size: 0, label: "" }, entries: [], problems: [] };
  }
}

async function readMeta(file) {
  try {
    const meta = JSON.parse(await readFile(file, "utf8"));
    return meta?.schema === STOCK_LIBRARY_SCHEMA ? meta : null;
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  const staged = `${file}.${process.pid}.stage`;
  await writeFile(staged, `${JSON.stringify(value, null, 2)}\n`);
  await rename(staged, file);
}

/**
 * Записи базовых архивов игры по путям. `wanted` — пути вида `common/…` и `x64/…`; ответ: `{ rows, missing }`. `rows[].archive` — архив
 * (`common.rpf`, `x64b.rpf`), откуда запись снята. Архивы открываются по очереди и закрываются; x64-архив читается, пока не найден
 * каждый запрошенный путь.
 */
export async function readBaseEntries({ gameRoot, wanted, open, keys, signal = null, onArchive = null, hash = entryContentHash }) {
  const rows = [];
  const found = new Set();
  const groups = { common: new Map(), x64: new Map() };
  const unmapped = [];
  for (const entryPath of wanted) {
    const target = baseTargetOf(entryPath);
    if (!target) unmapped.push(entryPath);
    else groups[target.archive].set(target.inner, entryPath);
  }
  const files = (await readdir(gameRoot).catch(() => [])).sort();
  const scan = async (archiveName, group) => {
    if (!group.size) return;
    const pending = new Map(group);
    const names = archiveName === "common" ? files.filter((file) => lower(file) === "common.rpf") : files.filter((file) => X64_ARCHIVE.test(file));
    for (const name of names) {
      if (!pending.size) break;
      if (signal?.aborted) throw signal.reason || new Error("Отменено.");
      onArchive?.(name);
      let archive = null;
      try {
        archive = await open(path.join(gameRoot, name), { keys });
        const byPath = new Map(archive.entries.filter((entry) => entry.kind !== "directory").map((entry) => [lower(entry.path), entry]));
        for (const [inner, original] of [...pending]) {
          const entry = byPath.get(inner);
          if (!entry) continue;
          const bytes = await archive.read(entry.path);
          rows.push({ path: original, size: bytes.length, sha256: hash(bytes, { resource: entry.kind === "resource" }), archive: lower(name) });
          found.add(original);
          pending.delete(inner);
        }
      } finally {
        await archive?.close?.();
      }
    }
  };
  await scan("common", groups.common);
  await scan("x64", groups.x64);
  const missing = wanted.filter((entryPath) => !found.has(entryPath) && !unmapped.includes(entryPath));
  return { rows: rows.sort((left, right) => left.path.localeCompare(right.path)), missing, unmapped };
}

/**
 * Снять версию в библиотеку. `updateFile` — чистая копия `update.rpf` (только чтение), `gameRoot` — папка игры с базовыми архивами,
 * `paths` — запрошенные пути (`pathsFromText`), `open` — читатель RPF (`openRpfFile` из `@modovik/rpf7/node`).
 * Ответ: `{ dir, key, meta, built: { update, base }, added, known, missing, unmapped }`.
 */
export async function snapshotStockLibrary({
  updateFile,
  source = { kind: "file" },
  gameRoot = "",
  keys = null,
  paths = [],
  libraryRoot,
  label = "",
  force = false,
  open,
  signal = null,
  onProgress = null,
  now = () => new Date(),
}) {
  if (typeof open !== "function") throw new Error("Нужен читатель RPF (`open`).");
  if (!updateFile || !(await exists(updateFile))) throw new Error("Чистая копия update.rpf не найдена: снимать библиотеке не с чего.");
  const fingerprint = await fileFingerprint(updateFile, signal);
  const archive = await open(updateFile, { keys });
  let dir = "";
  let key = "";
  let build = null;
  try {
    const dlclist = archive.entries.find((entry) => lower(entry.path) === DLCLIST_PATH);
    if (!dlclist) throw new Error("В update.rpf нет common/data/dlclist.xml: ключ версии игры назвать нечем.");
    build = buildKeyOf({
      dlclistText: textOf(await archive.read(dlclist.path)),
      paths: archive.entries.filter((entry) => entry.kind !== "directory").map((entry) => entry.path),
    });
    key = build.key;
    if (!key) throw new Error("dlclist.xml не назвал ни одного пака: ключ версии пуст.");
    dir = path.join(libraryRoot, folderOfKey(key));
    await mkdir(dir, { recursive: true });
    const metaFile = path.join(dir, STOCK_FILES.meta);
    const before = await readMeta(metaFile);
    const updateJson = path.join(dir, STOCK_FILES.update);
    const sameSource = before?.status === "ready" && before.source?.sha256 === fingerprint.sha256 && (await exists(updateJson));
    let updateBaseline = null;
    let builtUpdate = false;
    if (sameSource && !force) {
      updateBaseline = await readBaseline(updateJson);
    } else {
      updateBaseline = await buildPackBaseline(archive, { name: "update.rpf", size: fingerprint.size, label, onProgress, signal });
      await writeBaseline(updateJson, updateBaseline);
      builtUpdate = true;
    }
    const inUpdate = new Set(updateBaseline.entries.map((row) => lower(row.path)));
    const baseJson = path.join(dir, STOCK_FILES.base);
    /* Базовые архивы обновлениями не меняются: уже снятые пути не читаются заново (кэш по ключу версии и пути); `force` — с чистого листа. */
    const baseBefore = force ? { entries: [], problems: [] } : await readBaseOrEmpty(baseJson);
    const known = new Set(baseBefore.entries.map((row) => lower(row.path)));
    const knownMissing = new Set(force ? [] : (before?.base?.missing ?? []).map(lower));
    const requested = paths.map(lower);
    const wanted = requested.filter((entryPath) => !inUpdate.has(entryPath) && !known.has(entryPath) && !knownMissing.has(entryPath) && baseTargetOf(entryPath));
    const read = wanted.length
      ? await readBaseEntries({ gameRoot, wanted, open, keys, signal })
      : { rows: [], missing: [], unmapped: [] };
    const rows = [...baseBefore.entries, ...read.rows].sort((left, right) => left.path.localeCompare(right.path));
    const missing = [...new Set([...knownMissing, ...read.missing])].sort();
    await writeBaseline(baseJson, { schema: BASELINE_SCHEMA, source: { name: "base archives", size: 0, label: String(label || "") }, entries: rows, problems: baseBefore.problems ?? [] });
    const stamp = now().toISOString();
    const meta = {
      schema: STOCK_LIBRARY_SCHEMA,
      status: "ready",
      key,
      dlclistTail: build.dlclistTail,
      dlcPatchPacks: build.dlcPatchPacks,
      createdAt: before?.createdAt ?? stamp,
      updatedAt: stamp,
      label: String(label || before?.label || ""),
      /* Откуда снято: вид копии, размер и sha256 — без пути (в нём имя пользователя). */
      source: { kind: source.kind || "file", name: path.basename(updateFile), size: fingerprint.size, sha256: fingerprint.sha256 },
      update: { entries: updateBaseline.entries.length, problems: updateBaseline.problems?.length ?? 0, file: STOCK_FILES.update },
      base: { entries: rows.length, file: STOCK_FILES.base, missing },
    };
    await writeJson(metaFile, meta);
    return {
      dir,
      key,
      meta,
      built: { update: builtUpdate, base: read.rows.length > 0 },
      added: read.rows.map((row) => row.path),
      known: requested.filter((entryPath) => inUpdate.has(entryPath) || known.has(entryPath)),
      missing: read.missing,
      unmapped: [...requested.filter((entryPath) => !baseTargetOf(entryPath) && !inUpdate.has(entryPath))],
    };
  } finally {
    await archive.close?.();
  }
}

/**
 * Прочитанная библиотека одной версии: `shaOf(path)` — sha256 штатной записи (в `update.rpf` — она главнее базового архива), `entryOf`, `has`.
 * Нет `meta.json` со статусом `ready` — `null`.
 */
export async function readStockLibrary(dir) {
  const meta = await readMeta(path.join(dir, STOCK_FILES.meta));
  if (meta?.status !== "ready") return null;
  const update = await readBaseline(path.join(dir, STOCK_FILES.update));
  const base = (await exists(path.join(dir, STOCK_FILES.base))) ? await readBaseline(path.join(dir, STOCK_FILES.base)) : { entries: [] };
  const rows = new Map();
  for (const row of base.entries) rows.set(lower(row.path), row);
  for (const row of update.entries) rows.set(lower(row.path), row);
  let names = null;
  return {
    meta,
    dir,
    entryOf: (entryPath) => rows.get(lower(entryPath)) ?? null,
    shaOf: (entryPath) => rows.get(lower(entryPath))?.sha256 ?? null,
    has: (entryPath) => rows.has(lower(entryPath)),
    /** Строки для `createStockLibrary({ baseline })`: сначала базовые архивы, поверх них `update.rpf`. */
    rows: () => [...base.entries, ...update.entries],
    /** Записи внутри архива/папки `prefix` (`x64/levels/gta5/minimap.rpf`): `[{ path, sha256 }]`. */
    under: (prefix) => {
      const head = `${lower(prefix).replace(/\/+$/, "")}/`;
      return [...rows.values()].filter((row) => lower(row.path).startsWith(head)).map((row) => ({ path: lower(row.path), sha256: row.sha256 }));
    },
    /** Все имена файлов библиотеки (строчными, без пути): для сверки «одноимённые штатные». */
    basenames: () => (names ||= new Set([...rows.keys()].map((entryPath) => entryPath.slice(entryPath.lastIndexOf("/") + 1)))),
  };
}

/** Библиотека версии по ключу из корня библиотеки (`null` — версии нет или она не `ready`). */
export const openStockVersion = (libraryRoot, key) => readStockLibrary(path.join(libraryRoot, folderOfKey(key)));

/** Какие версии лежат в корне библиотеки: `[{ key, status, updatedAt }]`. */
export async function listStockVersions(libraryRoot) {
  const out = [];
  for (const name of await readdir(libraryRoot).catch(() => [])) {
    const meta = await readMeta(path.join(libraryRoot, name, STOCK_FILES.meta));
    if (meta) out.push({ key: meta.key, status: meta.status, updatedAt: meta.updatedAt, dir: path.join(libraryRoot, name) });
  }
  return out.sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
}
