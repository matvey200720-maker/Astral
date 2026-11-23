import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import * as gxt from "@modovik/clothing/gxt2";
import * as rage from "@modovik/rage-drawable";
import * as rpf from "@modovik/rpf7/node";
import * as vectorMap from "@modovik/vector-map";
import * as provisioner from "./loader-provisioner.js";
import * as layers from "./optimization-layers.js";

const ARCHIVES = "x64e.rpf x64a.rpf x64b.rpf".split(" ");
const TILES_PREFIX = "x64e.rpf:levels/gta5/minimap.rpf/";
const ATLAS_FILE = "x64a.rpf:data/tune/minimap.ymt";
const ZONE_NAMES_FILE = "x64b.rpf:data/lang/russian_rel.rpf/global.gxt2";
const CACHE_FOLDER = "world-map-geometry";
const HEADER_TAG = "h2";
const KEEP_FRESH = 2;
const GRID_SIDE = 12;
const TILE_LIMIT = 128;
const ZONE_NAME_MAX = 80;

// Идущие сборки: путь файла кэша → обещание ответа.
const buildsInFlight = new Map();

// Сбой асинхронной попытки даёт запасное значение.
async function settleTo(task, fallback) {
  try {
    return await task();
  } catch {
    return fallback;
  }
}

function rootOf(input) {
  const given = String(input?.gameRoot || "");
  if (!path.isAbsolute(given)) throw new Error("Укажите папку GTA V.");
  return path.resolve(given);
}

// «имя:размер:время» архива.
async function statOfArchive(root, name) {
  const info = await fs.stat(path.join(root, name));
  return `${name}:${info.size}:${Math.floor(info.mtimeMs)}`;
}

// «имя:размер:время» архива или null, если его нет.
function archiveStamp(root, name) {
  return settleTo(() => statOfArchive(root, name), null);
}

// Отпечаток состояния игры; null — нет главного архива.
async function fingerprintOf(root) {
  const [main, ...others] = ARCHIVES;
  const mainStamp = await archiveStamp(root, main);
  if (mainStamp === null) return null;
  const rest = [];
  for (const name of others) rest.push((await archiveStamp(root, name)) ?? `${name}:-`);
  const head = ["v" + vectorMap.RADAR_GEOMETRY_VERSION, HEADER_TAG, mainStamp];
  return [...head, ...rest].join("|");
}

function keyOf(stamp) {
  const hex = crypto.createHash("sha256").update(stamp).digest("hex");
  return hex.slice(0, 16);
}

// Файл кэша одного состояния игры. Устройство файла:
// [uint32 длина заголовка][JSON-заголовок][двоичная геометрия].
function encodeCacheFile(answer) {
  const { atlas, tiles, triangles, zoneNames, geometry } = answer;
  const head = Buffer.from(JSON.stringify({ atlas, tiles, triangles, zoneNames }), "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32LE(head.length, 0);
  return Buffer.concat([size, head, Buffer.from(geometry)]);
}

function decodeCacheFile(bytes) {
  const headerLength = bytes.readUInt32LE(0);
  const headEnd = 4 + headerLength;
  const header = JSON.parse(bytes.subarray(4, headEnd).toString("utf8"));
  const geometry = new Uint8Array(bytes.subarray(headEnd));
  return { header, geometry };
}

function cacheSlot(stateDir, key) {
  const dir = path.join(stateDir, CACHE_FOLDER);
  const file = path.join(dir, `${key}.bin`);
  return { dir, file };
}

async function readSlot(slot) {
  const { header, geometry } = decodeCacheFile(await fs.readFile(slot.file));
  return vectorMap.decodeRadarGeometry(geometry) ? { ...header, geometry, cached: true } : null;
}

function loadSlot(slot) {
  return settleTo(() => readSlot(slot), null);
}

async function saveSlot(slot, answer) {
  await fs.mkdir(slot.dir, { recursive: true });
  const bytes = encodeCacheFile(answer);
  const temp = `${slot.file}.${process.pid}.tmp`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, slot.file);
}

// Возраст файла кэша по времени изменения.
async function probeAge(slot, name) {
  const info = await fs.stat(path.join(slot.dir, name));
  return { name, time: info.mtimeMs };
}

async function datedCopies(slot) {
  const names = (await fs.readdir(slot.dir)).filter((name) => name.endsWith(".bin"));
  const probes = await Promise.allSettled(names.map((name) => probeAge(slot, name)));
  const dated = [];
  for (const probe of probes) {
    if (probe.status === "fulfilled") dated.push(probe.value);
  }
  dated.sort((a, b) => b.time - a.time);
  return dated;
}

// Оставляет самые свежие копии и только что записанную; ошибки не важны.
function tidySlot(slot) {
  return settleTo(async () => {
    const dated = await datedCopies(slot);
    const keep = new Set(dated.slice(0, KEEP_FRESH).map((item) => item.name));
    keep.add(path.basename(slot.file));
    const stale = dated.filter((item) => !keep.has(item.name));
    await Promise.allSettled(stale.map(async (item) => fs.rm(path.join(slot.dir, item.name), { force: true })));
  });
}

function tileName(cell) {
  return `minimap_${Math.floor(cell / GRID_SIDE)}_${cell % GRID_SIDE}.ydd`;
}

// Плитки радара подряд, строка за строкой, пока не набралось предельное число.
async function collectTiles(reader) {
  const tiles = [];
  const total = GRID_SIDE * GRID_SIDE;
  for (let cell = 0; cell < total && tiles.length < TILE_LIMIT; cell += 1) {
    const name = tileName(cell);
    const bytes = await reader.read(TILES_PREFIX + name);
    if (bytes) tiles.push({ name, bytes: new Uint8Array(bytes) });
  }
  return tiles;
}

function namedZone(table, district) {
  const name = table.get(district.zoneCode);
  return name ? [district.zoneCode, name.slice(0, ZONE_NAME_MAX)] : null;
}

async function readZoneNames(reader) {
  const raw = await reader.read(ZONE_NAMES_FILE).catch(() => null);
  if (!raw) return null;
  const table = gxt.parseGxt2(new Uint8Array(raw));
  const entries = [];
  for (const district of vectorMap.WORLD_DISTRICTS) {
    const entry = namedZone(table, district);
    if (entry) entries.push(entry);
  }
  return entries.length ? Object.fromEntries(entries) : null;
}

async function gatherWith(reader) {
  const tiles = await collectTiles(reader);
  if (!tiles.length) return null;
  const parsed = vectorMap.parseRadarTiles(tiles, { readDrawable: rage.readDrawable, inflateRaw: rpf.inflateRawNode });
  if (!parsed.triangles) return null;

  const ymt = await reader.read(ATLAS_FILE);
  const atlas = ymt ? vectorMap.readMinimapAtlas(new Uint8Array(ymt)) : null;
  const zoneNames = await readZoneNames(reader);
  const geometry = vectorMap.encodeRadarGeometry(parsed);
  const { tiles: parsedTiles, triangles } = parsed;
  return { atlas, tiles: parsedTiles, triangles, zoneNames, geometry };
}

async function gatherFromGame(root, keys) {
  const reader = layers.createGameReader(root, keys);
  try {
    return await gatherWith(reader);
  } finally {
    await reader.close();
  }
}

async function buildAnswer(root, slot, keysDirectory) {
  const keysPath = await keysDirectory().catch(() => null);
  if (!keysPath) return null;
  const keys = await rpf.keysFromDirectory(keysPath);
  const gathered = await gatherFromGame(root, keys);
  if (!gathered) return null;
  await saveSlot(slot, gathered);
  await tidySlot(slot);
  return Object.assign({}, gathered, { cached: false });
}

// Общая сборка на файл кэша: второй вызов получает то же обещание.
function joinOrBuild(slot, root, keysDirectory) {
  const key = slot.file;
  if (buildsInFlight.has(key)) return buildsInFlight.get(key);
  const forget = () => buildsInFlight.delete(key);
  const started = buildAnswer(root, slot, keysDirectory).finally(forget);
  buildsInFlight.set(key, started);
  return started;
}

function defaultKeysDirectory(input, stateDir) {
  return () => provisioner.archiveKeysDirectory({ keys: input?.keys, stateDir });
}

export async function readWorldMapGeometry(input = {}, stateDir, options = {}) {
  const keysDirectory = options.keysDirectory === undefined ? defaultKeysDirectory(input, stateDir) : options.keysDirectory;
  const root = rootOf(input);
  const stamp = await fingerprintOf(root);
  if (stamp === null) return null;
  const slot = cacheSlot(stateDir, keyOf(stamp));
  const cached = await loadSlot(slot);
  return cached || joinOrBuild(slot, root, keysDirectory);
}
