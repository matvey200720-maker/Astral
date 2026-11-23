import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as rpfCore from "@modovik/rpf7";
import * as rpf from "@modovik/rpf7/node";
import * as decorations from "@modovik/clothing/decorations";
import * as taxonomy from "@modovik/clothing/taxonomy";
import * as clothingNames from "@modovik/clothing/names";

const FILE_BUDGET = 60000;
const ARCHIVE_BUDGET = 400;
const NAMED_FILE_CEILING = 4 * 1024 * 1024;
const CACHE_VERSION = 2;
const MAX_COLORS = 26;
const FIXED_PLACES = ["C:\\RAGEMP", "C:\\Games\\RAGEMP", "D:\\RAGEMP", "D:\\Games\\RAGEMP"];

// ---------------------------------------------------------------- места клиента

export function rageRoots(env = process.env) {
  const programFiles = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const customDir = env.ASTRAL_RAGEMP_DIR;
  const gta5rp = path.win32.join(programFiles, "GTA5RP");
  const places = [customDir, ...FIXED_PLACES, gta5rp, path.win32.join(gta5rp, "RAGEMP")];
  const appData = env.LOCALAPPDATA;
  return [...places, ...(appData ? [path.win32.join(appData, "RAGEMP")] : [])].filter(Boolean);
}

// ------------------------------------------------------------ папки серверов

async function isDirectory(full) {
  try {
    const info = await fs.stat(full);
    return info.isDirectory();
  } catch {
    // папка исчезла между чтением списка и stat
    return false;
  }
}

// Из списка путей остаются папки; проверяются по одной, по порядку.
async function keepDirectories(candidates) {
  const kept = [];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) kept.push(candidate);
  }
  return kept;
}

async function subfoldersOf(base) {
  let names;
  try {
    names = await fs.readdir(base);
  } catch {
    return [];
  }
  return keepDirectories(names.map((name) => path.join(base, name)));
}

export async function serverFolders(roots) {
  const seen = new Set();
  for (const root of roots) {
    const folders = await subfoldersOf(path.join(root, "client_resources"));
    folders.forEach((folder) => seen.add(folder));
  }
  return Array.from(seen);
}

// ------------------------------------------------------------ обход файлов

// Файлы папки в порядке readdir, вложенные папки — на месте встречи.
async function* descend(dir, budget) {
  let listing;
  try {
    listing = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of listing) {
    if (!(budget.left > 0)) break;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* descend(full, budget);
    } else if (dirent.isFile()) {
      budget.left -= 1;
      yield full;
    }
  }
}

const walkFiles = (root) => descend(root, { left: FILE_BUDGET });

async function tryOpen(file) {
  try {
    return { handle: await fs.open(file, "r") };
  } catch {
    return null;
  }
}

// Первые четыре байта файла совпадают с сигнатурой RPF7?
async function startsWithMagic(handle) {
  const head = Buffer.alloc(4);
  const { bytesRead } = await handle.read(head, 0, 4, 0);
  return bytesRead === 4 && head.readUInt32LE(0) === rpfCore.RPF7_MAGIC;
}

// «Не архив» — только когда файл не открылся; сбой чтения или закрытия выходит наружу.
async function hasRpf7Magic(file) {
  const opened = await tryOpen(file);
  if (!opened) return false;
  return startsWithMagic(opened.handle).finally(() => opened.handle.close());
}

// ------------------------------------------------------- разбор содержимого

function leafOf(lowerPath) {
  return lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
}

function folderOf(entryPath) {
  return entryPath.slice(0, entryPath.lastIndexOf("/") + 1);
}

function decodeUtf8(bytes) {
  return Buffer.from(bytes).toString("utf8");
}

function isOverlayListName(lowerPath) {
  const leaf = leafOf(lowerPath);
  return leaf.includes("overlay") && leaf.endsWith(".xml");
}

function textBetween(body, tag) {
  const opening = `<${tag}>`;
  const from = body.indexOf(opening);
  if (from >= 0) {
    const start = from + opening.length;
    const end = body.indexOf(`</${tag}>`, start);
    if (end >= 0) return body.slice(start, end);
  }
  return null;
}

// Имя файла из записи content.xml: без «диск:/» и ведущих косых.
function listedName(body) {
  return (textBetween(body, "filename") ?? "")
    .trim()
    .replace(/^[^:/]+:\//, "")
    .replace(/^\/+/, "");
}

// Имена файлов коллекций, которые content.xml помечает как PED_OVERLAY_FILE.
function overlayFilesListed(contentText) {
  const names = [];
  let open = contentText.indexOf("<Item>", 0);
  while (open >= 0) {
    const close = contentText.indexOf("</Item>", open);
    if (close < 0) break;
    const body = contentText.slice(open + 6, close);
    const cursor = close + 7;
    const name = (textBetween(body, "fileType") ?? "").trim() === "PED_OVERLAY_FILE" ? listedName(body) : "";
    if (name) names.push(name);
    open = contentText.indexOf("<Item>", cursor);
  }
  return names;
}

// Пути файлов коллекций тату: сперва по имени, затем из content.xml; без повторов.
async function collectionPaths(archive) {
  const listing = [...archive.entries];
  const lowers = listing.map((entry) => entry.path.toLowerCase());
  const present = new Set(lowers);
  const small = (entry) => entry.kind === "binary" && entry.size <= NAMED_FILE_CEILING;
  const wanted = new Set(lowers.filter((lower, at) => small(listing[at]) && isOverlayListName(lower)));
  const contentLists = listing.filter((entry) => leafOf(entry.path.toLowerCase()) === "content.xml");
  for (const entry of contentLists) {
    const listed = overlayFilesListed(decodeUtf8(await archive.read(entry.path)));
    listed
      .map((name) => (folderOf(entry.path) + name).toLowerCase())
      .filter((target) => present.has(target))
      .forEach((target) => wanted.add(target));
  }
  return Array.from(wanted);
}

// Запись о вещи при первой встрече её файла: поля предмета в порядке заявки.
function newThing(info) {
  const item = Object.fromEntries([
    ["folder", info.folder],
    ["collection", info.collection || null],
    ["component", info.component],
    ["drawable", info.drawable],
    ["gender", info.gender],
    ["prop", info.prop],
    ["modelSuffix", null],
    ["race", null],
  ]);
  return { item, letters: new Set(), hasModel: false };
}

// Что за файл вещи: «model», «color» (диффузная текстура) или null — файл не засчитывается.
function clothingKind(info) {
  if (info.role === "model") return "model";
  return info.role === "texture" && info.textureKind === "diffuse" ? "color" : null;
}

// Накопитель одного прохода по папке сервера.
function createHarvest() {
  const things = new Map();
  const pictures = new Map();
  const collections = [];
  const problems = [];

  function noteClothing(info) {
    if (!info || !info.component || !Number.isInteger(info.drawable)) return;
    const kind = clothingKind(info);
    if (kind === null) return;
    const key = `${info.folder}|${info.component}|${info.drawable}`;
    if (!things.has(key)) things.set(key, newThing(info));
    const thing = things.get(key);
    const { item } = thing;
    if (kind === "model") {
      thing.hasModel = true;
      if (!item.modelSuffix && info.modelSuffix) item.modelSuffix = info.modelSuffix;
    } else {
      thing.letters.add(info.letter);
      if (!item.race && info.race) item.race = info.race;
    }
  }

  // Коллекции тату архива; что успело разобраться до сбоя, то остаётся.
  async function readCollections(archive) {
    for (const target of await collectionPaths(archive)) {
      const text = decodeUtf8(await archive.read(target));
      const parsed = decorations.parseDecorationCollection(text);
      if (parsed) collections.push(parsed);
    }
  }

  async function absorb(archive, label) {
    try {
      await readCollections(archive);
    } catch (error) {
      problems.push({ file: label, code: error.code || "TATTOO_BROKEN" });
    }
    archive.entries.forEach((entry) => {
      const isPicture = entry.path.toLowerCase().endsWith(".ytd");
      if (isPicture) pictures.set(entry.path, label);
      noteClothing(clothingNames.parseClothingPath(entry.path));
    });
  }

  function clothingItems() {
    const withModels = Array.from(things.values()).filter((thing) => thing.hasModel);
    return withModels.map(({ item, letters }) => ({ ...item, textures: Math.min(MAX_COLORS, Math.max(1, letters.size)) }));
  }

  function tattooRecords() {
    let unpictured = 0;
    const records = collections.flatMap((collection) => {
      const linked = decorations.linkDecorationTextures(decorations.tattoosOf(collection), pictures.keys());
      return [...linked].flatMap((tattoo) => {
        if (tattoo.entry) return [{ ...tattoo, collection: collection.name, archive: pictures.get(tattoo.entry) }];
        unpictured += 1;
        return [];
      });
    });
    if (unpictured) problems.push({ code: "TATTOO_NO_PICTURE", count: unpictured });
    return records;
  }

  function describe(directory, archives) {
    const items = clothingItems();
    const tattoos = tattooRecords();
    const words = [...new Set(items.map((item) => item.collection).filter(Boolean)), ...collections.map((collection) => collection.name)];
    return Object.fromEntries([
      ["directory", directory],
      ["server", taxonomy.serverOfText(words.filter(Boolean).join(" "))],
      ["archives", archives],
      ["items", items],
      ["tattoos", tattoos],
      ["problems", problems],
    ]);
  }

  return { problems, absorb, describe };
}

// Один архив папки: открыть (сбой — запись о проблеме), разобрать, закрыть при любом исходе.
async function absorbFile(file, label, keys, harvest) {
  let archive;
  try {
    archive = await rpf.openRpfFile(file, { keys });
  } catch (error) {
    harvest.problems.push({ file: label, code: error.code || "RPF_BROKEN" });
    return;
  }
  try {
    await harvest.absorb(archive, label);
  } finally {
    await archive.close?.();
  }
}

export async function scanServerFolder(directory, options = {}) {
  const keys = options.keys === undefined ? null : options.keys;
  const harvest = createHarvest();
  let archives = 0;
  for await (const file of walkFiles(directory)) {
    if (archives >= ARCHIVE_BUDGET) break;
    if (await hasRpf7Magic(file)) {
      archives += 1;
      await absorbFile(file, path.relative(directory, file), keys, harvest);
    }
  }
  return harvest.describe(directory, archives);
}

// ------------------------------------------------------------ кэш оглавления

async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

async function folderStamp(folder) {
  const digest = createHash("sha256");
  for await (const file of walkFiles(folder)) {
    const info = await statOrNull(file);
    if (info !== null) digest.update(`${path.relative(folder, file)}|${info.size}|${info.mtimeMs}\n`);
  }
  return digest.digest("hex").slice(0, 24);
}

async function loadCache(file, stamp) {
  try {
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    const fresh = record?.version === CACHE_VERSION && record.stamp === stamp;
    return fresh ? record : null;
  } catch {
    return null;
  }
}

function cacheNameOf(folder) {
  const digest = createHash("sha256").update(folder.toLowerCase()).digest("hex");
  return digest.slice(0, 16);
}

// Оглавление одной папки сервера: из кэша либо заново (и тогда кэш пишется); пустой результат не кэшируется.
// Ответ — список из одного результата либо пустой.
async function inspectFolder(folder, stateDir, keys) {
  const stamp = await folderStamp(folder);
  const cacheFile = path.join(stateDir, "server-clothing", `${cacheNameOf(folder)}.json`);
  const cached = await loadCache(cacheFile, stamp);
  if (cached) return [cached.result];
  const fresh = await scanServerFolder(folder, { keys });
  const empty = !fresh.items.length && !fresh.tattoos.length && !fresh.problems.length;
  if (empty) return [];
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify({ version: CACHE_VERSION, stamp, result: fresh }));
  return [fresh];
}

export async function listServerClothing(options = {}) {
  const { stateDir } = options;
  const keysDirectory = options.keysDirectory === undefined ? null : options.keysDirectory;
  const roots = options.roots === undefined ? rageRoots() : options.roots;
  const keys = keysDirectory ? await rpf.keysFromDirectory(keysDirectory).catch(() => null) : null;
  const folders = await serverFolders(roots);
  const found = [];
  for (const folder of folders) found.push(...(await inspectFolder(folder, stateDir, keys)));
  return { servers: found.filter((entry) => entry.items.length || entry.tattoos?.length) };
}
