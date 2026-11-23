/*
 * Разметка выделения: загрузка файла `.selmap` по записи сцены в кэш на диске (ТЗ владельца 26.10.2026, раздел D: «клиент качает один раз на версию
 * сцены; ETag/sha256; пока файл едет с ассетами, потом CDN без правок клиента»).
 *
 * Запись сцены в манифесте — `{ url, bytes, sha256, version }` (`scripts/lib/selection-markup.mjs`, `selectionEntry`). Окно само читает файл, что едет
 * в поставке (`/assets/…`, путь без хоста: там нет сети и кэша). Адрес на CDN окно присылает сюда:
 *
 *   — адрес обязан быть https на хост из списка хостов пакетов (в разработке — любой https или http на localhost), без логина, путь `….selmap`;
 *   — кэш — `<хранилище>/selection-markup/<sha256>.selmap`: новая версия сцены — новый sha256 — новый файл; одна и та же версия качается один раз;
 *   — скачанное сверяется с `bytes` и `sha256` записи; файл из кэша тоже (порченый стирается и качается заново);
 *   — сжатие (deflate или brotli) снимает Node, окну уходит тело — `decodeSelmapParts` читает его в потоке;
 *   — одновременные вызовы за один файл делят один запрос; кэш не больше `SELECTION_CACHE_LIMIT` файлов, старые уходят первыми.
 * Без сети и без файла в кэше — ошибка `SelectionLoadError`; окно тогда остаётся на запасном пути (остров сетки).
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { SELMAP_VERSION, unpackSelmapFile } from "@modovik/climb-contract/selection";

/* Файл разметки сцены в сотни килобайт; предел щедрый, но не гигабайт. */
export const SELECTION_FILE_LIMIT = 4 * 1024 * 1024;
export const SELECTION_BODY_LIMIT = 32 * 1024 * 1024;
export const SELECTION_CACHE_LIMIT = 48;
const FETCH_TIMEOUT_MS = 20_000;
const SHA256 = /^[0-9a-f]{64}$/;

export class SelectionLoadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SelectionLoadError";
    this.code = code;
  }
}

const refuse = (code, message) => new SelectionLoadError(code, message);

const INFLATE = Object.freeze({
  deflate: (bytes) => new Uint8Array(zlib.inflateSync(bytes, { maxOutputLength: SELECTION_BODY_LIMIT })),
  brotli: (bytes) => new Uint8Array(zlib.brotliDecompressSync(bytes, { maxOutputLength: SELECTION_BODY_LIMIT })),
});

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Запись сцены, проверенная: `{ url, bytes, sha256, version }`. Адрес — на хосте из списка (`allowedHosts`; `null` — в разработке любой https),
 * http — только localhost при `allowInsecureLocalhost`.
 */
export function checkSelectionEntry(input, { allowedHosts = null, allowInsecureLocalhost = false } = {}) {
  const entry = input && typeof input === "object" ? input : {};
  let url;
  try {
    url = new URL(String(entry.url || ""));
  } catch {
    throw refuse("url", "Адрес файла разметки не читается.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const secure = url.protocol === "https:" || (url.protocol === "http:" && local && allowInsecureLocalhost);
  if (!secure) throw refuse("url", "Файл разметки берётся только по https.");
  if (url.username || url.password) throw refuse("url", "В адресе файла разметки не должно быть логина.");
  if (Array.isArray(allowedHosts) && !allowedHosts.includes(url.hostname.toLowerCase())) throw refuse("host", `Хост «${url.hostname}» не в списке хостов Astral.`);
  if (!/\.selmap$/i.test(url.pathname)) throw refuse("url", "Адрес файла разметки должен вести на .selmap.");
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > SELECTION_FILE_LIMIT) throw refuse("bytes", "Размер файла разметки не по форме.");
  if (!SHA256.test(String(entry.sha256 || ""))) throw refuse("sha256", "У файла разметки нет sha256.");
  if (entry.version !== SELMAP_VERSION) throw refuse("version", `Версия разметки ${entry.version} не поддерживается (ждём ${SELMAP_VERSION}).`);
  return { url, bytes: entry.bytes, sha256: entry.sha256, version: entry.version };
}

async function readCached(file, entry) {
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch {
    return null;
  }
  if (bytes.length === entry.bytes && sha256Of(bytes) === entry.sha256) {
    const now = new Date();
    await fs.utimes(file, now, now).catch(() => {});
    return new Uint8Array(bytes);
  }
  await fs.rm(file, { force: true }).catch(() => {});
  return null;
}

async function download(entry, { fetchImpl, allowedHosts, allowInsecureLocalhost }) {
  let response;
  try {
    response = await fetchImpl(entry.url.href, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/octet-stream" } });
  } catch (error) {
    throw refuse("network", `Файл разметки не скачался: ${error?.message || "нет связи"}.`);
  }
  if (!response.ok) throw refuse("network", `Файл разметки не скачался: ответ ${response.status}.`);
  /* После перенаправления хост всё ещё должен быть из списка. */
  if (response.url) checkSelectionEntry({ ...entry, url: response.url }, { allowedHosts, allowInsecureLocalhost });
  const announced = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(announced) && announced > SELECTION_FILE_LIMIT) throw refuse("bytes", "Файл разметки больше предела.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== entry.bytes) throw refuse("bytes", `Файл разметки ${bytes.length} байт, в манифесте ${entry.bytes}.`);
  if (sha256Of(bytes) !== entry.sha256) throw refuse("sha256", "Файл разметки не совпал с sha256 манифеста.");
  return bytes;
}

async function prune(cacheDir) {
  let names;
  try {
    names = (await fs.readdir(cacheDir)).filter((name) => /^[0-9a-f]{64}\.selmap$/.test(name));
  } catch {
    return;
  }
  if (names.length <= SELECTION_CACHE_LIMIT) return;
  const dated = await Promise.all(names.map(async (name) => ({ name, time: (await fs.stat(path.join(cacheDir, name)).catch(() => null))?.mtimeMs ?? 0 })));
  dated.sort((a, b) => b.time - a.time);
  for (const { name } of dated.slice(SELECTION_CACHE_LIMIT)) await fs.rm(path.join(cacheDir, name), { force: true }).catch(() => {});
}

/* Что качается прямо сейчас: sha256 → промис, чтобы два окна кадра не качали один файл дважды. */
const inFlight = new Map();

/**
 * Тело `.selmap` по записи сцены: `{ body: Uint8Array, source: "cache" | "network", sha256 }`.
 * `cacheDir` — папка кэша (создаётся); `fetchImpl` — `fetch` (тест подставляет свой).
 */
export async function loadSelectionMarkup(input,{ cacheDir, allowedHosts = null, allowInsecureLocalhost = false, fetchImpl = globalThis.fetch } = {}) {
  const entry = checkSelectionEntry(input, { allowedHosts, allowInsecureLocalhost });
  if (!cacheDir) throw refuse("cache", "Не задана папка кэша разметки.");
  const key = `${path.resolve(cacheDir)}|${entry.sha256}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const work = (async () => {
    const file = path.join(cacheDir, `${entry.sha256}.selmap`);
    let packed = await readCached(file, entry);
    let source = "cache";
    if (!packed) {
      source = "network";
      packed = await download(entry, { fetchImpl, allowedHosts, allowInsecureLocalhost });
      await fs.mkdir(cacheDir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, packed);
      await fs.rename(temp, file);
      await prune(cacheDir);
    }
    let body;
    try {
      body = unpackSelmapFile(packed, INFLATE);
    } catch (error) {
      await fs.rm(file, { force: true }).catch(() => {});
      throw refuse("format", `Файл разметки не распаковался: ${error?.message || "сжатие"}.`);
    }
    return { body, source, sha256: entry.sha256 };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}
