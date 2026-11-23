/*
 * Опись штатной GTA V: формат, проверка и где её взять.
 *
 * Сервер раздаёт не файлы игры, а только их опись (решение владельца и
 * CLAUDE.md: содержимое Rockstar на наш CDN не кладём; имена, размеры и
 * хеши — не содержимое). Опись — на сборку игры и магазин: Steam, Epic и
 * Rockstar Games Launcher кладут немного разные файлы (`steam_api64.dll`,
 * `.egstore`), а каждое обновление игры меняет архивы.
 *
 *   index.json — оглавление: какая опись к какому GTA5.exe;
 *   <id>.json  — сама опись (можно `.json.gz`).
 *
 * Какая опись подходит игре, решает sha256 исполняемого файла: он свой у
 * каждой сборки и магазина, и подставить чужую опись по номеру версии нельзя.
 * Формат и как её обновлять после выхода патча — `docs/STOCK-RESET.md`,
 * генератор — `scripts/stock-manifest.mjs`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { posixRelative } from "./stock-rules.js";

export const MANIFEST_SCHEMA = "astral-stock-manifest/1";
export const INDEX_SCHEMA = "astral-stock-index/1";
/* Сколько байт начала файла хеширует быстрая сверка (`head`). */
export const HEAD_BYTES = 1024 * 1024;
export const STORES = Object.freeze(["Steam", "Epic", "Rockstar"]);
export const EDITIONS = Object.freeze(["Legacy", "Enhanced"]);
/* Где сервер держит опись: статикой рядом с сайтом (`docs/STOCK-RESET.md`). */
export const REMOTE_PATH = "/stock-manifests/";

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;

function parseJsonBytes(raw) {
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function safeRelative(value) {
  const relative = posixRelative(value);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":")))
    return null;
  if (/^[a-z]:/i.test(relative)) return null;
  return relative;
}

/**
 * Опись в проверенном виде или ошибка словами. Пути — относительные, внутри
 * папки игры, без повторов (без учёта регистра: Windows их не различает).
 */
export function validateManifest(value) {
  if (!value || value.schema !== MANIFEST_SCHEMA) throw new Error("Опись не того формата.");
  if (!ID.test(String(value.id || ""))) throw new Error("У описи нет имени.");
  if (!EDITIONS.includes(value.edition)) throw new Error("Опись: неизвестное издание.");
  if (!STORES.includes(value.store)) throw new Error("Опись: неизвестный магазин.");
  if (!Array.isArray(value.files) || !value.files.length) throw new Error("Опись пуста.");
  const seen = new Set();
  const files = value.files.map((item) => {
    const relative = safeRelative(item?.path);
    if (!relative) throw new Error(`Опись: плохой путь ${item?.path}`);
    const key = relative.toLowerCase();
    if (seen.has(key)) throw new Error(`Опись: путь дважды — ${relative}`);
    seen.add(key);
    if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error(`Опись: размер ${relative}`);
    if (!HEX64.test(String(item.sha256 || ""))) throw new Error(`Опись: sha256 ${relative}`);
    if (item.head !== undefined && !HEX64.test(String(item.head))) throw new Error(`Опись: head ${relative}`);
    return { path: relative, size: item.size, sha256: item.sha256, ...(item.head ? { head: item.head } : {}) };
  });
  const exe = files.find((item) => item.path.toLowerCase() === String(value.exe || "").toLowerCase());
  if (!exe) throw new Error("Опись: нет исполняемого файла игры.");
  return {
    schema: MANIFEST_SCHEMA,
    id: value.id,
    game: "gta5",
    edition: value.edition,
    store: value.store,
    exe: exe.path,
    exeVersion: String(value.exeVersion || ""),
    buildId: value.buildId ? String(value.buildId) : null,
    generatedAt: String(value.generatedAt || ""),
    headBytes: Number.isSafeInteger(value.headBytes) ? value.headBytes : HEAD_BYTES,
    files,
    nonStock: Array.isArray(value.nonStock) ? value.nonStock.filter((rule) => typeof (rule?.pattern ?? rule) === "string") : [],
    ignore: Array.isArray(value.ignore) ? value.ignore.filter((rule) => typeof rule === "string") : [],
  };
}

export function validateIndex(value) {
  if (!value || value.schema !== INDEX_SCHEMA || !Array.isArray(value.manifests))
    throw new Error("Оглавление описей не того формата.");
  return value.manifests
    .filter(
      (item) =>
        ID.test(String(item?.id || "")) &&
        HEX64.test(String(item?.exeSha256 || "")) &&
        STORES.includes(item?.store) &&
        EDITIONS.includes(item?.edition) &&
        /^[a-z0-9][a-z0-9._-]*\.json(\.gz)?$/i.test(String(item?.file || "")),
    )
    .map((item) => ({
      id: item.id,
      edition: item.edition,
      store: item.store,
      exeVersion: String(item.exeVersion || ""),
      exeSha256: item.exeSha256,
      exeSize: Number(item.exeSize) || null,
      file: item.file,
      sha256: HEX64.test(String(item.sha256 || "")) ? item.sha256 : null,
    }));
}

/** Строка оглавления для описи (её пишет генератор). */
export function indexEntry(manifest, file, bytes) {
  const exe = manifest.files.find((item) => item.path === manifest.exe);
  return {
    id: manifest.id,
    edition: manifest.edition,
    store: manifest.store,
    exeVersion: manifest.exeVersion,
    exeSha256: exe.sha256,
    exeSize: exe.size,
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Подходящая строка оглавления: тот же GTA5.exe, тот же магазин, если он известен. */
export function pickIndexEntry(entries, { exeSha256, store } = {}) {
  const same = entries.filter((item) => item.exeSha256 === exeSha256);
  return same.find((item) => item.store === store) || same[0] || null;
}

async function readLocal(directory, name) {
  return fs.readFile(path.join(directory, name));
}

async function readRemote(origin, name, fetchImpl, timeoutMs) {
  const url = new URL(`${REMOTE_PATH}${name}`, origin);
  if (url.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(url.hostname))
    throw new Error("Опись берётся только по HTTPS.");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) throw new Error(`Сервер описей ответил ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Опись для игры с этим GTA5.exe. Где искать — по порядку: своя папка
 * (`ASTRAL_STOCK_MANIFESTS`, стенд и проверка), выкачанные раньше
 * (`cacheDir`), сервер (`origin`). Скачанная ложится в `cacheDir`: следующая
 * сверка обходится без сети, а после обновления игры у exe другой хеш, и
 * старая опись сама перестаёт подходить.
 *
 * @returns {Promise<{ status: "matched"|"missing"|"unavailable", manifest?: object, source?: string, error?: string }>}
 */
export async function findManifest({
  exeSha256,
  store,
  localDirs = [],
  cacheDir = null,
  origin = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
}) {
  const places = [
    ...localDirs.filter(Boolean).map((dir) => ({ kind: "local", read: (name) => readLocal(dir, name) })),
    ...(cacheDir ? [{ kind: "cache", read: (name) => readLocal(cacheDir, name) }] : []),
    ...(origin && fetchImpl ? [{ kind: "remote", read: (name) => readRemote(origin, name, fetchImpl, timeoutMs) }] : []),
  ];
  let lastError = null;
  let reached = false;
  for (const place of places) {
    let entries;
    try {
      entries = validateIndex(parseJsonBytes(await place.read("index.json")));
      reached = true;
    } catch (error) {
      if (error?.code !== "ENOENT") lastError = error;
      continue;
    }
    const entry = pickIndexEntry(entries, { exeSha256, store });
    if (!entry) continue;
    try {
      const bytes = await place.read(entry.file);
      if (entry.sha256 && createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
        throw new Error("Опись не сошлась с оглавлением.");
      const manifest = validateManifest(parseJsonBytes(bytes));
      const exe = manifest.files.find((item) => item.path === manifest.exe);
      if (exe.sha256 !== exeSha256) throw new Error("Опись от другой сборки игры.");
      if (place.kind === "remote" && cacheDir) await rememberManifest(cacheDir, entry, bytes).catch(() => {});
      return { status: "matched", manifest, source: place.kind };
    } catch (error) {
      lastError = error;
    }
  }
  if (!reached && lastError) return { status: "unavailable", error: String(lastError.message || lastError) };
  return { status: "missing", ...(lastError ? { error: String(lastError.message || lastError) } : {}) };
}

/* Скачанная опись — в свою папку, и своё оглавление рядом (одна строка на exe). */
async function rememberManifest(cacheDir, entry, bytes) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, entry.file), bytes);
  let entries = [];
  try {
    entries = validateIndex(JSON.parse(await fs.readFile(path.join(cacheDir, "index.json"), "utf8")));
  } catch {}
  const next = [...entries.filter((item) => item.exeSha256 !== entry.exeSha256), entry];
  await fs.writeFile(path.join(cacheDir, "index.json"), JSON.stringify({ schema: INDEX_SCHEMA, manifests: next }, null, 2));
}
