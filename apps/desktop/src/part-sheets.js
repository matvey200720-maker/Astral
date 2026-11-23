import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { blankCandidates } from "./arena-blank.js";

const SIZE_LIMIT = 64 * 1024 * 1024;
const RESOURCE_NAME = /\.(?:ytd|ydr|yft|ydd)$/i;
const GLOBAL_DICTIONARIES = "x64g.rpf:levels/gta5/generic/gtxd.rpf";
const GLOBAL_PROBE = `${GLOBAL_DICTIONARIES}/_`;

// Оглавления папок игры живут столько же, сколько модуль: ключ «<id игры>|<папка>».
const folderIndexes = new Map();

const FAILED = Symbol("parse failed");
const noValue = () => null;
const swallow = () => {};
const emptyList = () => [];
const identity = (value) => value;
const oversize = (bytes) => !bytes || bytes.length > SIZE_LIMIT;
const copyOrNull = (bytes) => (bytes ? new Uint8Array(bytes) : null);
const byHdLast = (a, b) => isHdCopy(a) - isHdCopy(b);

function lowerName(value) {
  return String(value || "").toLowerCase();
}

function lastSegment(address) {
  return address.slice(address.lastIndexOf("/") + 1);
}

/** Разбор файла игры: сбой превращается в метку, а не в исключение. */
function tryParse(texturesOfBytes, bytes, address) {
  try {
    return texturesOfBytes(bytes, lastSegment(address));
  } catch {
    return FAILED;
  }
}

async function releaseGame(game) {
  await game.close?.().catch(swallow);
}
const isFolderDictionary = (address) => address.endsWith(".ytd") && !/\+hi(?:dr)?\.ytd$/.test(address);
const isHdCopy = (file) => Number(/\+hi/i.test(file.name));
const embeddedOf = (drawable) => drawable.embeddedTextures ?? [];
const named = (refs, name) => refs.find((ref) => ref.name.toLowerCase() === name);

// --- ключ листа и набор готовых листов ---

export function sheetKey(entry) {
  let key = "";
  if (entry.game) key = `game:${entry.game}/${entry.texture}`;
  else if (entry.set) key = `set:${entry.set}/${entry.resource}/${entry.texture}`;
  return key.toLowerCase();
}

export function sheetCacheName(key, extension = "webp") {
  const digest = createHash("sha1").update(String(key)).digest("hex");
  return `${digest}.${extension}`;
}

export function sheetCacheReader(dir) {
  if (!dir) return null;
  const fileFor = (key, extension) => path.join(dir, sheetCacheName(key, extension));
  return async (key) => {
    const bytes = await fs.readFile(fileFor(key)).catch(noValue);
    if (bytes) return new Uint8Array(bytes);
    const marker = await fs.stat(fileFor(key, "none")).catch(noValue);
    return marker ? false : null;
  };
}

// --- листы ресурса и файлы мода ---

function embeddedTexturesOf(resource) {
  const model = readDrawable(resource, { inflateRaw: inflateResource });
  return model.drawables.flatMap(embeddedOf);
}

export function resourceTextures(bytes, fileName) {
  const resource = openResourceWith(bytes, inflateResource);
  return /\.ytd$/i.test(fileName) ? readTextureDictionary(resource) : embeddedTexturesOf(resource);
}

/** Байты файла мода: свои, а если их нет (null/undefined) — через read, когда он функция. */
async function bytesOfFile(file) {
  const own = file.bytes;
  if (own !== null && own !== undefined) return own;
  if (typeof file.read !== "function") return null;
  return await file.read();
}

async function refsOfModFile(file) {
  try {
    const bytes = await bytesOfFile(file);
    if (!bytes?.length) return null;
    return resourceTextures(new Uint8Array(bytes), file.name);
  } catch {
    return null;
  }
}

async function* modFileRefs(files) {
  for (const file of files) {
    if (!RESOURCE_NAME.test(file.name)) continue;
    const refs = await refsOfModFile(file);
    if (refs) yield* refs;
  }
}

export async function modTextureIndex(files = [], { wanted = null } = {}) {
  const ordered = [...files].sort(byHdLast);
  const index = new Map();
  for await (const ref of modFileRefs(ordered)) {
    const key = ref.name.toLowerCase();
    const filteredOut = Boolean(wanted) && !wanted.has(key);
    if (!filteredOut && !index.has(key)) index.set(key, ref);
  }
  return index;
}

export async function modNamesOf({ files = [], wanted = null }) {
  const filter = wanted ? new Set(wanted) : null;
  const index = await modTextureIndex(files, { wanted: filter });
  return Array.from(index.keys());
}

const drawablesOf = (bytes) => {
  const model = readDrawable(openResourceWith(new Uint8Array(bytes), inflateResource), { inflateRaw: inflateResource });
  return model.drawables;
};

function modelIsBlank(bytes) {
  try {
    const drawables = drawablesOf(bytes);
    if (!drawables.length) return false;
    for (const drawable of drawables) {
      if (drawable.meshes?.length) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function blankModelsOf({ files = [] }) {
  const names = [];
  for (const file of blankCandidates(files)) {
    const bytes = await bytesOfFile(file);
    if (bytes?.length && modelIsBlank(bytes)) names.push(file.name.toLowerCase());
  }
  return names.sort();
}

// --- читатель игры «по частям»: вложенные архивы лежат отдельными файлами под корнем ---

function* archiveCuts(parts) {
  for (let end = parts.length - 1; end >= 1; end -= 1) {
    if (parts[end - 1].endsWith(".rpf")) yield end;
  }
}

function entryIndexOf(archive) {
  archive.index ??= new Map(archive.entries.map((entry) => [entry.path.toLowerCase(), entry]));
  return archive.index;
}

async function closeArchive(promise) {
  const archive = await promise;
  await archive?.close?.().catch(swallow);
}

class PartsReader {
  #root;

  #keys;

  #opened = new Map();

  constructor(root, keys) {
    this.id = path.resolve(root);
    this.#root = root;
    this.#keys = keys;
    Object.assign(this, {
      reachable: async (address) => (await this.#archiveOf(address)) !== null,
      read: async (address) => this.#readEntry(address),
      list: async (address) => this.#listFolder(address),
      close: async () => this.#closeAll(),
    });
  }

  #open(file) {
    let pending = this.#opened.get(file);
    if (pending === undefined) {
      pending = openRpfFile(file, { keys: this.#keys, name: path.basename(file) }).catch(noValue);
      this.#opened.set(file, pending);
    }
    return pending;
  }

  async #isFile(file) {
    const info = await fs.stat(file).catch(noValue);
    return info?.isFile() === true;
  }

  // Архив адреса: самый длинный существующий «…/имя.rpf» вдоль пути, иначе целый файл метки.
  async #locate(address) {
    const pieces = String(address).split(":");
    const label = pieces[0];
    const rest = pieces[1] ?? "";
    const parts = rest.split("/");
    for (const end of archiveCuts(parts)) {
      const file = path.join(this.#root, label, ...parts.slice(0, end));
      const inner = parts.slice(end).join("/");
      if (await this.#isFile(file)) return { file, inner };
    }
    const whole = path.join(this.#root, label);
    return (await this.#isFile(whole)) ? { file: whole, inner: rest } : null;
  }

  async #archiveOf(address) {
    const hit = await this.#locate(address);
    if (!hit) return null;
    const archive = await this.#open(hit.file);
    return archive ? { archive, inner: hit.inner } : null;
  }

  async #readEntry(address) {
    const found = await this.#archiveOf(address);
    if (found === null) return null;
    const entry = entryIndexOf(found.archive).get(found.inner.toLowerCase());
    if (!entry) return null;
    return new Uint8Array(await found.archive.read(entry.path));
  }

  async #listFolder(address) {
    const found = await this.#archiveOf(`${address}/_`);
    if (found === null) return [];
    const prefix = found.inner.slice(0, -1).toLowerCase();
    const files = found.archive.entries.filter((entry) => entry.kind !== "directory");
    const addresses = [];
    for (const entry of files) {
      const name = entry.path.toLowerCase();
      const rest = name.slice(prefix.length);
      if (name.startsWith(prefix) && !rest.includes("/")) addresses.push(`${address}/${rest}`);
    }
    return addresses;
  }

  async #closeAll() {
    const pending = Array.from(this.#opened.values());
    this.#opened.clear();
    await Promise.all(pending.map(closeArchive));
  }
}

export function gamePartsReader(root, keys) {
  return new PartsReader(root, keys);
}

async function keysOf(keysDirectory) {
  if (!keysDirectory) return null;
  return keysFromDirectory(keysDirectory).catch(noValue);
}

export async function gameBytesOf({ root, keysDirectory = null, at }) {
  const keys = await keysOf(keysDirectory);
  const game = gamePartsReader(root, keys);
  try {
    const bytes = await game.read(at).then(identity, noValue);
    return copyOrNull(bytes);
  } finally {
    await releaseGame(game);
  }
}

// --- листы сцены: источники по очереди (мод, готовый набор, игра, набор файлов) ---

function webpEncoder(size) {
  return async (ref) => {
    const decoded = decodeTextureRef(ref, { maxSize: size });
    const { width, height, rgba } = decoded;
    const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const pipeline = sharp(pixels, { raw: { width, height, channels: 4 } });
    const encoded = pipeline.webp({ quality: 84, alphaQuality: 90, effort: 3 });
    return new Uint8Array(await encoded.toBuffer());
  };
}

async function readGameFile(game, address) {
  return game?.read(address).catch(noValue);
}

async function cachedBytes(cached, key) {
  return cached(key).catch(noValue);
}

async function listFolder(game, folder) {
  const listed = await game?.list(folder).catch(emptyList);
  return listed ?? [];
}

/** Листы файла игры: читается и разбирается один раз на адрес за вызов. */
function parsedOnce(scene, address) {
  if (!scene.parsedAt.has(address)) scene.parsedAt.set(address, parseGameFile(scene, address));
  return scene.parsedAt.get(address);
}

async function parseGameFile(scene, address) {
  const { game, texturesOfBytes } = scene;
  const bytes = await readGameFile(game, address);
  if (oversize(bytes)) return [];
  const refs = tryParse(texturesOfBytes, bytes, address);
  return refs === FAILED ? [] : refs;
}

async function* parsedFolderFiles(scene, addresses) {
  const { game, texturesOfBytes } = scene;
  for (const address of addresses) {
    const bytes = await readGameFile(game, address);
    if (oversize(bytes)) continue;
    const refs = tryParse(texturesOfBytes, bytes, address);
    if (refs !== FAILED) yield { address, refs };
  }
}

/** Имя листа → адрес файла папки (при совпадении имён первый по сортировке побеждает). */
async function buildFolderIndex(scene, folder) {
  const listed = await listFolder(scene.game, folder);
  const byName = new Map();
  for await (const { address, refs } of parsedFolderFiles(scene, listed.filter(isFolderDictionary).sort())) {
    for (const ref of refs) {
      const name = ref.name.toLowerCase();
      byName.has(name) || byName.set(name, address);
    }
  }
  return byName;
}

async function folderIndexOf(scene, folder) {
  const { game } = scene;
  const cacheKey = game.id ? `${game.id}|${folder}` : null;
  if (cacheKey !== null && folderIndexes.has(cacheKey)) return folderIndexes.get(cacheKey);
  const byName = await buildFolderIndex(scene, folder);
  if (cacheKey !== null) folderIndexes.set(cacheKey, byName);
  return byName;
}

function folderOfAddress(address) {
  const cut = address.lastIndexOf("/");
  return cut >= 0 ? address.slice(0, cut) : address.slice(0, -1);
}

async function findInGame(scene, address, name) {
  const own = named(await parsedOnce(scene, address), name);
  if (own) return own;
  let where;
  for (const place of [folderOfAddress(address), GLOBAL_DICTIONARIES]) {
    where = (await folderIndexOf(scene, place)).get(name);
    if (where !== undefined) break;
  }
  if (where === undefined) return null;
  return named(await parsedOnce(scene, where), name) ?? null;
}

async function findInSet(scene, entry, name) {
  const { setRoot, texturesOfBytes } = scene;
  const folder = await setRoot(entry.set);
  const file = path.join(folder, entry.resource);
  const bytes = await fs.readFile(file).catch(noValue);
  if (!bytes) return null;
  try {
    return named(texturesOfBytes(new Uint8Array(bytes), entry.resource), name) ?? null;
  } catch {
    return null;
  }
}

async function encodeEntry(encodeSheet, key, ref, from) {
  try {
    const bytes = await encodeSheet(ref);
    return { kind: "ready", sheet: { key, bytes, from }, viaMod: from === "mod" };
  } catch {
    return { kind: "lost", keys: [key] };
  }
}

const SKIP = { kind: "skip" };

async function viaMod(scene, entry, key, name) {
  const { mod, encodeSheet } = scene;
  const ref = mod.get(name);
  return ref ? encodeEntry(encodeSheet, key, ref, "mod") : undefined;
}

async function viaCache(scene, entry, key) {
  const { cached } = scene;
  if (!entry.game || !cached) return undefined;
  const ready = await cachedBytes(cached, key);
  if (ready === false) return SKIP;
  if (!(ready?.length > 0)) return undefined;
  return { kind: "ready", sheet: { key, bytes: ready, from: "cache" }, viaMod: false };
}

async function viaGame(scene, entry, key, name) {
  const { game, encodeSheet } = scene;
  if (!entry.game || !game) return undefined;
  const ref = await findInGame(scene, entry.game, name);
  return ref ? encodeEntry(encodeSheet, key, ref, "game") : undefined;
}

async function viaSet(scene, entry, key, name) {
  const { setRoot, encodeSheet } = scene;
  if (!entry.set || !setRoot) return undefined;
  const ref = await findInSet(scene, entry, name);
  return ref ? encodeEntry(encodeSheet, key, ref, "set") : undefined;
}

const SOURCES = [viaMod, viaCache, viaGame, viaSet];

/** Ключи пропажи для листа, который не нашёлся нигде. */
async function lostKeys(game, entry, key) {
  const lost = [];
  if (entry.game) {
    const archiveThere = await game?.reachable(entry.game);
    const dictionariesThere = archiveThere && await game?.reachable(GLOBAL_PROBE);
    if (!dictionariesThere) lost.push(key);
  }
  if (entry.set) lost.push(key);
  return lost;
}

/** Ответ на одну запись сцены: пропуск, готовый лист или ключи пропажи. */
async function resolveEntry(scene, entry) {
  const key = sheetKey(entry);
  const name = lowerName(entry.texture);
  if (key === "" || name === "") return SKIP;
  for (const source of SOURCES) {
    const verdict = await source(scene, entry, key, name);
    if (verdict) return verdict;
  }
  return { kind: "lost", keys: await lostKeys(scene.game, entry, key) };
}

export async function sceneSheets({
  textures = [],
  mod = new Map(),
  game = null,
  setRoot = null,
  cached = null,
  size = 512,
  texturesOfBytes = resourceTextures,
  encodeSheet = webpEncoder(size),
}) {
  const scene = { mod, game, setRoot, cached, texturesOfBytes, encodeSheet, parsedAt: new Map() };
  const result = { sheets: [], missing: [], fromMod: 0 };
  for (const entry of textures) {
    const outcome = await resolveEntry(scene, entry);
    if (outcome.kind === "ready") {
      result.sheets.push(outcome.sheet);
      if (outcome.viaMod) result.fromMod += 1;
    } else if (outcome.kind === "lost") {
      result.missing.push(...outcome.keys);
    }
  }
  return result;
}

export async function sceneSheetsOf({
  textures = [],
  files = [],
  root = "",
  keysDirectory = null,
  setRoots = {},
  size = 512,
}) {
  const names = textures.map((entry) => lowerName(entry.texture));
  const mod = await modTextureIndex(files, { wanted: new Set(names) });
  const keys = await keysOf(keysDirectory);
  const game = gamePartsReader(root, keys);
  try {
    const scene = { textures, mod, game, size };
    scene.setRoot = async (set) => setRoots?.[set] ?? null;
    scene.cached = sheetCacheReader(process.env.ASTRAL_GAME_SHEETS || "");
    return await sceneSheets(scene);
  } finally {
    await releaseGame(game);
  }
}
