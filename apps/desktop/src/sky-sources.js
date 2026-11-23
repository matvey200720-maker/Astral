/*
 * Небо, которое уже стоит в игре (ТЗ 17.10.2026, вечер, задача 3): «Взять из
 * своей игры».
 *
 * У игрока бывает чужой графический пакет — NaturalVision Evolved, coreFx,
 * QuantV, сборка сервера. Его таймцикл лежит там, где игра его прочтёт:
 *
 *   update/update.rpf                      — поставлен прямо в игру;
 *   mods/update/update.rpf, mods/update.rpf — слой OpenIV;
 *   update/x64/dlcpacks/<не Rockstar>/dlc.rpf — дополнение.
 *
 * Модуль только читает: архивы открываются на чтение, ничего в игру и в
 * приложение не копируется. Из найденных файлов собирается проект редактора
 * неба (`importSkyBundleFromMod`) — шаблон, который человек берёт в
 * мастерскую. Метки пакета — из его собственных файлов (`recognizeSkyPack`).
 *
 * `open` подставляется в тестах: настоящие архивы весят гигабайты.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import {
  importSkyBundleFromMod,
  recognizeSkyPack,
  skyEntryKind,
  skyPackAuthor,
  xmlHeadComments,
} from "@modovik/timecycle";

/* Файл неба вдвое больше самого большого настоящего — уже не файл неба. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const HEAD_CHARS = 4096;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
/* Дополнения Rockstar и свои пакеты Astral — не чужое небо. */
const ROCKSTAR_PACK = /^(?:mp|patch)[a-z0-9_]*$/i;
const OWN_PACK = /^astral_/i;
const MODS_LAYERS = Object.freeze(["mods/update/update.rpf", "mods/update.rpf"]);

/* Ключи архивов: приложение передаёт папку ArchiveFix, читалка — готовый набор. */
async function resolveKeys(keys) {
  if (typeof keys !== "string" || !keys.trim()) return keys || null;
  return keysFromDirectory(keys).catch(() => null);
}

const slash = (value) => String(value).replace(/\\/g, "/");
const exists = (file) =>
  fs.stat(file).then(
    (stat) => stat.isFile(),
    () => false,
  );

/** Где искать небо: `[{ id, kind, file, folder }]` — только то, что есть на диске. */
export async function skySourceCandidates(gameRoot) {
  const found = [];
  const update = path.join(gameRoot, "update", "update.rpf");
  if (await exists(update)) found.push({ id: "live", kind: "live", file: update, folder: null });
  for (const relative of MODS_LAYERS) {
    const file = path.join(gameRoot, ...relative.split("/"));
    if (await exists(file)) found.push({ id: `mods:${relative}`, kind: "mods", file, folder: null });
  }
  const dlcRoot = path.join(gameRoot, "update", "x64", "dlcpacks");
  const folders = await fs.readdir(dlcRoot, { withFileTypes: true }).catch(() => []);
  for (const folder of folders) {
    if (!folder.isDirectory() || ROCKSTAR_PACK.test(folder.name) || OWN_PACK.test(folder.name)) continue;
    const file = path.join(dlcRoot, folder.name, "dlc.rpf");
    if (await exists(file)) found.push({ id: `dlc:${folder.name}`, kind: "dlc", file, folder: folder.name });
  }
  return found;
}

const textOf = (bytes) => Buffer.from(bytes).toString("utf8");

/** Что лежит в архиве: записи неба по видам и метки автора. */
async function scanArchive(archive) {
  const entries = { timecycle: new Map(), weather: null, clouds: null, cloudKeyframes: null, visualSettings: null, setup: null };
  for (const entry of archive.entries || []) {
    if (entry.kind === "directory") continue;
    const kind = skyEntryKind(entry.path);
    if (kind) {
      if (kind.kind === "timecycle") entries.timecycle.set(kind.name, entry.path);
      else entries[kind.kind] ||= entry.path;
      continue;
    }
    if (!entries.setup && /^setup2\.xml$/i.test(slash(entry.path))) entries.setup = entry.path;
  }
  const texts = [];
  const names = [];
  let author = null;
  const readHead = async (entryPath) => {
    if (!entryPath) return "";
    try {
      return textOf(await archive.read(entryPath)).slice(0, HEAD_CHARS);
    } catch {
      return "";
    }
  };
  const visual = await readHead(entries.visualSettings);
  if (visual) {
    texts.push(visual);
    author = skyPackAuthor(visual);
  }
  const firstWeather = [...entries.timecycle.values()][0];
  if (firstWeather) texts.push(...xmlHeadComments(await readHead(firstWeather)));
  const setup = await readHead(entries.setup);
  if (setup) names.push(setup);
  return { entries, texts, names, author };
}

async function withArchive(open, file, keys, work) {
  const archive = await open(file, { keys });
  try {
    return await work(archive);
  } finally {
    await archive.close?.().catch(() => {});
  }
}

/** Источник по результату разбора архива; без неба — `null`. */
function describe(candidate, scanned) {
  const weathers = scanned.entries.timecycle.size;
  const weather = Boolean(scanned.entries.weather);
  const clouds = Boolean(scanned.entries.clouds || scanned.entries.cloudKeyframes);
  if (!weathers && !weather && !clouds) return null;
  return {
    id: candidate.id,
    kind: candidate.kind,
    pack: recognizeSkyPack({
      texts: scanned.texts,
      names: [...scanned.names, candidate.folder || ""],
    }),
    author: scanned.author,
    folder: candidate.folder,
    weathers,
    weather,
    clouds,
  };
}

/**
 * Найденное небо: `[{ id, kind, pack, author, folder, weathers, weather,
 * clouds }]`. `pack` — узнанный пакет (`{ id, label }`) или `null`; `author` —
 * метка из `visualsettings.dat`; без метки пакет называется по месту. Архивы,
 * которые не открылись или без неба, пропускаются, а не роняют список.
 */
export async function listSkySources({ gameRoot, keys, open = openRpfFile }) {
  const sources = [];
  const resolved = await resolveKeys(keys);
  for (const candidate of await skySourceCandidates(gameRoot)) {
    try {
      const scanned = await withArchive(open, candidate.file, resolved, (archive) => scanArchive(archive));
      const source = describe(candidate, scanned);
      if (source) sources.push(source);
    } catch {
      /* Архив не открылся — это не небо, о котором стоит говорить. */
    }
  }
  return sources;
}

/** Файлы неба архива: `[{ name, text }]`, как их читает мод-импорт. */
async function readSourceFiles(archive, scanned) {
  const files = [];
  let total = 0;
  const take = async (name, entryPath) => {
    if (!entryPath) return;
    const bytes = Buffer.from(await archive.read(entryPath));
    if (bytes.length > MAX_FILE_BYTES) return;
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new RangeError("Файлы неба неправдоподобно велики.");
    files.push({ name, text: bytes.toString("utf8") });
  };
  for (const [name, entryPath] of scanned.entries.timecycle) await take(name, entryPath);
  await take("weather.xml", scanned.entries.weather);
  await take("clouds.xml", scanned.entries.clouds);
  await take("cloudkeyframes.xml", scanned.entries.cloudKeyframes);
  return files;
}

/** Имя проекта: узнанный пакет, метка автора, папка дополнения или место. */
export function skySourceName(source) {
  return (
    source.pack?.label ||
    source.author ||
    source.folder ||
    (source.kind === "mods" ? "Слой OpenIV" : "Небо вашей игры")
  );
}

/**
 * Берёт небо найденного источника проектом редактора. `liveFiles` —
 * `[{ name, text }]` из `update.rpf` в чистом виде (без прежней установки
 * Astral), если вызывающий их уже прочитал: тогда «живое» небо берётся из
 * них, а не из архива. Открывается только нужный архив. Возвращает `{ source,
 * project, weathers, skipped, parts, lost }`; нечего брать — отказ словами.
 */
export async function takeSkySource({ gameRoot, keys, id, open = openRpfFile, liveFiles = null }) {
  const candidate = (await skySourceCandidates(gameRoot)).find((item) => item.id === id);
  if (!candidate) throw new Error("Этого неба в игре больше нет — обновите список.");
  const read = await withArchive(open, candidate.file, await resolveKeys(keys), async (archive) => {
    const scanned = await scanArchive(archive);
    return { scanned, files: candidate.kind === "live" && liveFiles ? liveFiles : await readSourceFiles(archive, scanned) };
  });
  const source = describe(candidate, read.scanned);
  if (!source) throw new Error("Этого неба в игре больше нет — обновите список.");
  const imported = importSkyBundleFromMod(read.files, { name: skySourceName(source) });
  if (!imported) throw new Error("В этом пакете нет неба, которое редактор смог бы взять.");
  return { source, ...imported };
}
