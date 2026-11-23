// Иконки стволов из игры игрока: страница «Оружие» меню паузы, вырезанная на машине игрока
// и сохранённая в кэше приложения (<stateDir>/weapon-icons).
import fs from "node:fs/promises";
import * as crypto from "node:crypto";
import path from "node:path";
import * as rpf from "@modovik/rpf7/node";
import * as gunIcons from "@modovik/gun-studio/game-icons";
import * as identity from "@modovik/rpf-inspector/weapon-identity";
import * as provisioner from "./loader-provisioner.js";
import * as layers from "./optimization-layers.js";
import * as offThread from "./off-thread.js";

export const WEAPON_ICONS_VERSION = 1;
export const FAILURE_GENERATION = 2;
export const MAX_FILM_BYTES = 2 ** 24;
export const MAX_DICTIONARY_BYTES = 96 * 2 ** 20;

const CACHE_FOLDER = "weapon-icons";
const GAME_ARCHIVES = ["update/update.rpf", "x64b.rpf"];
const ARCHIVE_LABEL_TABLE = "update/update.rpf=update";

function archiveLabels() {
  const entries = ARCHIVE_LABEL_TABLE.split(" ").map((pair) => pair.split("="));
  return new Map(entries);
}

const ARCHIVE_LABELS = archiveLabels();
const ICON_ID = /^WEAPON_[A-Z0-9_]{1,48}$/;
const FAILURE_WINDOW_MS = 86_400_000;
const NEWEST_SETS_KEPT = 2;

// Идущие счёты: папка набора -> общее обещание (параллельные вызовы делят один счёт).
const building = new Map();

// ---------- набор на диске ----------

function ensureDir(dir) {
  return fs.mkdir(dir, { recursive: true });
}

function wipe(target) {
  return fs.rm(target, { recursive: true, force: true });
}

function setLayout(stateDir, key) {
  const segments = [stateDir, CACHE_FOLDER, key];
  const base = path.join(segments[0], segments[1]);
  const dir = path.join(base, segments[2]);
  return { key, base, dir };
}

async function describeArchive(resolved, name) {
  let info;
  try {
    info = await fs.stat(path.join(resolved, ...name.split("/")));
  } catch {
    return null;
  }
  const size = info.size;
  const modified = Math.floor(info.mtimeMs);
  return `${name}:${size}:${modified}`;
}

/** Ключ набора по состоянию архивов игры; null, если нет ни одного из них. */
async function archiveSetKey(root) {
  const resolved = path.resolve(root);
  const described = [];
  for (const name of GAME_ARCHIVES) described.push(await describeArchive(resolved, name));
  const anyFound = described.some((part) => part !== null);
  if (!anyFound) return null;
  const parts = described.map((part, at) => part ?? `${GAME_ARCHIVES[at]}:-`);
  const text = ["v" + WEAPON_ICONS_VERSION, ...parts].join("|");
  const hex = crypto.createHash("sha256").update(text).digest("hex");
  return hex.slice(0, 16);
}

/** Свёртка по записям индекса: файлы иконок читаются по очереди, отсутствующие пропускаются. */
async function gatherIcons(dir, index) {
  const listed = index.icons || [];
  const entries = [...listed];
  const found = [];

  async function collect(remaining) {
    if (remaining.length === 0) return;
    const [entry, ...rest] = remaining;
    if (ICON_ID.test(entry.id)) {
      const bytes = await fs.readFile(path.join(dir, entry.id + ".png")).catch(() => null);
      if (bytes) found.push({ id: entry.id, png: new Uint8Array(bytes), width: entry.width, height: entry.height });
    }
    await collect(rest);
  }

  await collect(entries);
  if (found.length !== listed.length) throw new Error("В кэше иконок не хватает файлов.");
  const missing = index.missing || [];
  const source = index.source || "";
  return { icons: found, missing, source, cached: true };
}

async function loadSet(layout) {
  try {
    const text = await fs.readFile(path.join(layout.dir, "index.json"), "utf8");
    const index = JSON.parse(text);
    return await gatherIcons(layout.dir, index);
  } catch {
    return null;
  }
}

/** Остаются два самых свежих набора и текущий; временные папки и файлы не трогаются. */
async function folderInfo(base, name) {
  let info;
  try {
    info = await fs.stat(path.join(base, name));
  } catch {
    return null;
  }
  if (!info.isDirectory()) return null;
  return { name, changed: info.mtimeMs };
}

async function trimSets(layout) {
  const { base, key } = layout;
  const names = await fs.readdir(base).catch(() => null);
  if (names === null) return;
  const candidates = names.filter((name) => !name.endsWith(".tmp"));
  const stats = candidates.map((name) => folderInfo(base, name));
  const freshFirst = (await Promise.all(stats)).filter(Boolean);
  freshFirst.sort((a, b) => b.changed - a.changed);
  const keepNames = freshFirst.slice(0, NEWEST_SETS_KEPT).map((item) => item.name);
  const keep = new Set([...keepNames, key]);
  for (const item of freshFirst) {
    if (!keep.has(item.name)) await wipe(path.join(base, item.name));
  }
}

/** Файлы набора по порядку: png иконок, затем индекс (он собирается после записи png). */
async function storeSet(layout, result) {
  const staging = `${layout.dir}.${process.pid}.tmp`;
  await ensureDir(layout.base);
  await wipe(staging);
  await ensureDir(staging);
  for (const icon of result.icons) {
    await fs.writeFile(path.join(staging, `${icon.id}.png`), icon.png);
  }
  const entries = result.icons.map((icon) => ({ id: icon.id, width: icon.width, height: icon.height }));
  const index = { version: WEAPON_ICONS_VERSION, source: result.source, icons: entries, missing: result.missing };
  await fs.writeFile(path.join(staging, "index.json"), JSON.stringify(index));
  await wipe(layout.dir);
  await fs.rename(staging, layout.dir);
  await trimSets(layout);
}

function failureStands(layout, moment) {
  const file = path.join(layout.base, `${layout.key}.failed.json`);
  return fs
    .readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .then((mark) => {
      const age = moment - Number(mark.at);
      const fresh = age >= 0 && age < FAILURE_WINDOW_MS;
      return mark.generation === FAILURE_GENERATION && fresh;
    })
    .catch(() => false);
}

// Отметка — лишь подсказка: её потеря не меняет исходный отказ.
// now() вызывается раньше построения текста причины: при падающем message/toString отметка пропадёт, но момент уже взят.
async function recordFailure(layout, error, now) {
  try {
    await ensureDir(layout.base);
    const mark = { generation: FAILURE_GENERATION, at: now(), reason: String(error?.message || error).slice(0, 300) };
    await fs.writeFile(path.join(layout.base, `${layout.key}.failed.json`), JSON.stringify(mark));
  } catch {
    // потеря отметки допустима
  }
}

/** Ответ для подмножества стволов; без подмножества — тот же объект. */
function pickWanted(result, wanted) {
  if (!wanted) return result;
  const icons = result.icons.filter((icon) => wanted.has(icon.id));
  const missing = result.missing.filter((id) => wanted.has(id));
  return { ...result, icons, missing };
}

// ---------- readWeaponIcons ----------

function allWeaponIds() {
  return identity.WEAPONS.map((weapon) => weapon.id);
}

async function renderAndStore(job, keysPath) {
  if (!keysPath) return null;
  const { layout, root, render, now } = job;
  const allIds = allWeaponIds();
  async function onFailure(error) {
    await recordFailure(layout, error, now);
    throw error;
  }
  const rendered = await render(path.resolve(root), keysPath, allIds).catch(onFailure);
  if (!rendered) return null;
  await storeSet(layout, rendered);
  return rendered;
}

function startBuild(job) {
  const lookup = job.keysDirectory().catch(() => undefined);
  return lookup.then((keysPath) => renderAndStore(job, keysPath));
}

function defaultKeysDirectory(stateDir) {
  return () => provisioner.archiveKeysDirectory({ stateDir });
}

function defaultRender(gamePath, keysPath, allIds) {
  return offThread.runOffThread(new URL(import.meta.url), "renderWeaponIconsFromGame", [gamePath, keysPath, allIds]);
}

// Разбор входа readWeaponIcons: путь к игре, список id и зависимости со своими умолчаниями.
function parsedRequest(request, options, stateDir) {
  const { gameRoot } = request;
  const ids = request.ids === undefined ? null : request.ids;
  const keysDirectory = options.keysDirectory === undefined ? defaultKeysDirectory(stateDir) : options.keysDirectory;
  const render = options.render === undefined ? defaultRender : options.render;
  const now = options.now === undefined ? Date.now : options.now;
  const root = String(gameRoot || "");
  return { root, ids, keysDirectory, render, now };
}

// Набор желаемых стволов (только подходящие по виду id); без списка — вся выдача.
function wantedIds(ids) {
  return ids ? new Set(ids.filter((item) => ICON_ID.test(String(item))).map(String)) : null;
}

export async function readWeaponIcons(request = {}, stateDir, options = {}) {
  const { root, ids, keysDirectory, render, now } = parsedRequest(request, options, stateDir);
  if (!path.isAbsolute(root)) throw new Error("Укажите папку GTA V.");
  const wanted = wantedIds(ids);

  const key = await archiveSetKey(root);
  if (key === null) return null;
  const layout = setLayout(stateDir, key);
  const cached = await loadSet(layout);
  if (cached) return pickWanted(cached, wanted);
  const moment = now();
  if (await failureStands(layout, moment)) return null;

  const dir = layout.dir;
  let running = building.get(dir);
  if (!running) {
    const job = { layout, root, keysDirectory, render, now };
    running = startBuild(job).finally(() => building.delete(dir));
    building.set(dir, running);
  }
  const result = await running;
  return result ? pickWanted(result, wanted) : null;
}

// ---------- счёт по читателю архивов ----------

/** Фильм и словарь страницы источника; null, если не влезают в потолки или не нашлись. */
async function pageBytes(reader, source) {
  const label = ARCHIVE_LABELS.get(source.archive) ?? source.archive;
  const filmRef = `${label}:${source.gfx}`;
  const dictionaryRef = `${label}:${source.ytd}`;

  const sizes = await Promise.all([reader.sizeOf(filmRef), reader.sizeOf(dictionaryRef)]);
  const limits = [MAX_FILM_BYTES, MAX_DICTIONARY_BYTES];
  const tooBig = limits.some((limit, at) => sizes[at] > limit);
  if (tooBig) return null;

  const [film, dictionary] = await Promise.all([reader.read(filmRef), reader.read(dictionaryRef)]);
  return film && dictionary ? { film, dictionary } : null;
}

async function renderSource(reader, source, ids) {
  const page = await pageBytes(reader, source);
  if (!page) return null;
  const gfx = new Uint8Array(page.film);
  const ytd = new Uint8Array(page.dictionary);
  const input = { gfx, ytd, ids, inflateRaw: rpf.inflateRawNode };
  const { icons, missing } = gunIcons.renderWeaponIcons(input);
  if (!icons.size) return null;
  const list = Array.from(icons, ([id, item]) => ({ id, ...item }));
  return { icons: list, missing, source: source.archive, cached: false };
}

export async function renderFromReader(reader, ids) {
  async function tryNext(sources) {
    if (sources.length === 0) return null;
    const [source, ...rest] = sources;
    const rendered = await renderSource(reader, source, ids);
    return rendered || tryNext(rest);
  }
  return tryNext([...gunIcons.WEAPON_ICON_SOURCES]);
}

export async function renderWeaponIconsFromGame(gameRoot, keysDirectory, ids) {
  const keys = await rpf.keysFromDirectory(keysDirectory);
  const reader = layers.createGameReader(gameRoot, keys);
  let outcome;
  try {
    outcome = await renderFromReader(reader, ids);
  } finally {
    await reader.close();
  }
  return outcome;
}
