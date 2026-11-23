import fs from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setNativeFastInstall, setNativeModeWriteLimit, setNativeReadLimit, setNativeWriteLimit } from "./native-engine.js";
import { setBackgroundGentle, setBackgroundIoGentle } from "./child-priority.js";
import { setNativeRestorePointsRoot } from "./native-restore-chain.js";
import { runOffThread } from "./off-thread.js";
import {
  BUDGET_AUTO,
  BUDGET_OPTIONS,
  RECENT_USE_MS,
  budgetFromSettings,
  budgetLimits,
  budgetShortfall,
  modStores,
  planEviction,
} from "./storage-budget.js";
import { STORAGE_KINDS } from "./storage-census.js";
import {
  copyRestorePoints,
  mergeAbsentRestorePoints,
  placeRestorePoints,
  removeTransferredRestorePoints,
  restorePointsFolder,
  restorePointsRootIn,
  settleRestorePointsSiblings,
  sweepLeftoverRestorePoints,
  undoPlaceRestorePoints,
  whileMovingRestorePoints,
} from "./restore-points-move.js";
import {
  autoReadLimitMbps,
  autoWriteLimitMbps,
  diskKind,
  knownDiskPlaces,
  onDiskProfileChange,
  openDiskProfiles,
  probeDisk,
  probeIsDue,
} from "@modovik/install-engine/disk-profile.js";
import { carefulWriteFlags, setDiskRest, setDiskRestFactor } from "@modovik/install-engine/disk-care.js";
import { followInstallMode } from "./disk-governor-follow.js";
import { setCopyWriteLimitMbps } from "@modovik/install-engine/write-pacing.js";
import { setDownloadLimitMbps } from "@modovik/install-engine/download-pacing.js";
import { relocateState } from "@modovik/install-engine/state-paths.js";
import { readStateShared, relocateStateFile } from "@modovik/install-engine/engine-state.js";

export const CACHE_LIMIT_OPTIONS = Object.freeze([2147483648, 10737418240, 16106127360, 26843545600, 42949672960]);
export const DEFAULT_DOWNLOAD_LIMIT_MBPS = 100;
export const DEFAULT_WRITE_LIMIT_MBPS = 250;
/*
 * Потолок чтения обычного режима на быстром диске (18.11.2026). Прежде быстрый диск читался без потолка вовсе, а читает
 * установка больше, чем пишет: замер на ПК владельца — мод в мегабайты это 3,85 ГБ записи и 5,0 ГБ чтения, диск занят
 * в среднем 43 % с пиками до 100 % и очередью до 22. Медленному диску — прежняя половина измеренной скорости чтения.
 */
export const DEFAULT_READ_LIMIT_MBPS = 500;
export const DOWNLOAD_LIMIT_OPTIONS = Object.freeze([0, 5, 10, 25, 50, 100]);
export const IDLE_EVICT_MS = 1209600000;

const SETTINGS_FILE = "storage-settings.json";
const PROFILES_FILE = "disk-profiles.json";
const MARKER_NAME = ".astral-cache.json";
const MARKER_BODY = { product: "Astral", purpose: "installer-storage", version: 1 };
const NEW_CACHE_FOLDER = "Astral Cache";
const OWN_NAMES = [
  MARKER_NAME,
  "downloads",
  "backups",
  "engine-assets",
  "logs",
  "rpf-keys",
  "game-index.json",
  "world-index.json",
  "qa-workshop",
];
const JUNK_NAMES = new Set(["desktop.ini", "thumbs.db", ".ds_store"]);
const UUID_TEXT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WORK_FOLDER = new RegExp(`^\\.(?:transfer|previous)-${UUID_TEXT}$`, "i");
const SIBLING_TAIL = new RegExp(`^\\.(?:transfer|previous)-${UUID_TEXT}$`, "i");
const MARKER_TEMP = /^\.astral-cache\.json\..+\.tmp$/i;
const PINNED_PATHS = ["backups/native-rpf", "backups/game-locations.json", "logs", "rpf-keys"];
const PINNED_IN_BACKUPS = ["native-rpf", "game-locations.json"];
const LEGACY_NAMES = [
  "install-state.json",
  "transactions",
  "payloads",
  "bases",
  "loader-cache",
  "loader-packages",
  "game-locations.json",
];
const COPY_CHUNK = 1048576;
const SIZE_MEMORY_MS = 30000;
const RELOCATE_WAIT_MS = 10000;
const GAME_WRITE_RESERVE = 2147483648;
const HISTORY_LIMIT = 8;
const REUSE_TOLERANCE_MS = 2;
const STRIPPED_KINDS = ["downloads", "engineAssets", "chromiumCache", "updates"];
const GAME_PARTS = ["original", "copyStore", "rebases", "composites", "restorePoints", "dlc"];
const IDLE_KINDS = new Set(["derived", "workPackages"]);

const MSG = {
  moveBusy: "Дождитесь завершения переноса данных.",
  moveRunning: "Перенос данных уже выполняется.",
  clearWhileMoving: "Нельзя очистить кэш во время переноса.",
  keepKind: "Этот вид Astral сам не освобождает: он нужен для отката.",
  badFast: "Выбрано неподдерживаемое значение «Быстрой установки».",
  badDownload: "Выбран неподдерживаемый предел скорости загрузки.",
  badBudget: "Выбран неподдерживаемый бюджет хранилища.",
  badLimit: "Выбран неподдерживаемый лимит хранилища.",
  nested: "Новая папка кэша не может быть вложена в текущую.",
  installing: "Дождитесь окончания установки — потом перенесите кэш.",
  foreign: "Выбранная папка Astral Cache уже содержит другие файлы.",
  cancelled: "Перенос данных отменён.",
  links: "Кэш Astral не может содержать символические ссылки.",
  verify: "Astral не удалось проверить перенесённый файл резервной копии.",
  racedMove: "Кэш перенесли, пока переезжали точки.",
};

const NEVER = () => false;
const noop = () => {};

// ---------- пути и мелкие операции с диском ----------

function sameFolder(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function tailInside(root, candidate) {
  const tail = path.relative(root, candidate);
  if (tail === "") return null;
  const escapes = path.isAbsolute(tail) || tail === ".." || tail.startsWith(`..${path.sep}`);
  return escapes ? null : tail;
}

function isInside(parent, child) {
  return tailInside(parent, child) !== null;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function entryExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function rmQuiet(target) {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    // уборка не обязана удаваться
  }
}

async function rmdirQuiet(target) {
  try {
    await fs.rmdir(target);
  } catch {
    // папка не пуста или уже убрана
  }
}

function absoluteOrNull(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  return path.resolve(value);
}

function distinctFolders(list) {
  const firstSpelling = new Map();
  for (const folder of list) {
    const key = folder.toLowerCase();
    if (!firstSpelling.has(key)) firstSpelling.set(key, folder);
  }
  return [...firstSpelling.values()];
}

function cancelledError() {
  return Object.assign(new Error(MSG.cancelled), { name: "AbortError" });
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

async function writeAtomically(file, text, withFolder) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  if (withFolder) await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, text, "utf8");
  await fs.rename(temp, file);
}

function freeBytesOf(folder) {
  return fs
    .statfs(folder)
    .then((stats) => Number(stats.bavail) * Number(stats.bsize))
    .catch(() => null);
}

async function nearestExisting(start) {
  if (await pathExists(start)) return start;
  const parent = path.dirname(start);
  return parent === start ? start : nearestExisting(parent);
}

async function createTargetFolder(destination) {
  const outcome = await fs.mkdir(destination, { recursive: true }).then(
    () => null,
    (error) => ({ error }),
  );
  if (outcome === null) return;
  const { error } = outcome;
  if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
  const nearest = await nearestExisting(path.dirname(destination));
  const wrapped = new Error(`Windows не даёт Astral создавать папки в «${nearest}» (${error.message})`, {
    cause: error,
  });
  throw Object.assign(wrapped, { code: error.code, path: nearest });
}

// ---------- настройки ----------

function pickLimit(parsed, valueKey, chosenKey, options, fallback) {
  const value = parsed[valueKey];
  const chosen = parsed[chosenKey] === true;
  const usable = options.includes(value) && !(value === 0 && !chosen);
  return usable ? [value, chosen] : [fallback, false];
}

const downloadPair = (parsed) =>
  pickLimit(parsed, "downloadLimitMbps", "downloadLimitChosen", DOWNLOAD_LIMIT_OPTIONS, DEFAULT_DOWNLOAD_LIMIT_MBPS);
const field = (key, initial, read) => ({ key, initial, read });

const SETTINGS_FIELDS = [
  field("version", () => 1, () => 1),
  field("cacheEnabled", () => true, (parsed) => parsed.cacheEnabled !== false),
  field(
    "cacheLimitBytes",
    () => 2147483648,
    (parsed) => (CACHE_LIMIT_OPTIONS.includes(parsed.cacheLimitBytes) ? parsed.cacheLimitBytes : 2147483648),
  ),
  /* «Быстрая установка» (13.11.2026, решение владельца) заменила список пределов записи и «Беречь диск при установке»:
     прежние поля файла (writeLimitMbps, writeLimitChosen, gentleInstall) не читаются и уходят при первой записи. */
  field("fastInstall", () => false, (parsed) => parsed.fastInstall === true),
  /* Плашку первой установки человек уже видел и ответил на неё (или закрыл). */
  field("fastInstallOffered", () => false, (parsed) => parsed.fastInstallOffered === true),
  field("downloadLimitMbps", () => DEFAULT_DOWNLOAD_LIMIT_MBPS, (parsed) => downloadPair(parsed)[0]),
  field("downloadLimitChosen", () => false, (parsed) => downloadPair(parsed)[1]),
  field("budget", () => BUDGET_AUTO, (parsed) => budgetFromSettings(parsed)),
  field("customCacheRoot", () => null, (parsed) => absoluteOrNull(parsed.customCacheRoot)),
  field(
    "previousCacheRoots",
    () => [],
    (parsed) =>
      Array.isArray(parsed.previousCacheRoots)
        ? parsed.previousCacheRoots
            .filter((entry) => absoluteOrNull(entry) !== null)
            .map((entry) => path.resolve(entry))
            .slice(0, HISTORY_LIMIT)
        : [],
  ),
  field("relocatedFor", () => null, (parsed) => absoluteOrNull(parsed.relocatedFor)),
  field("restorePointsCacheRoot", () => null, (parsed) => absoluteOrNull(parsed.restorePointsCacheRoot)),
];

const parseSettings = (parsed) => Object.fromEntries(SETTINGS_FIELDS.map(({ key, read }) => [key, read(parsed)]));
const defaultSettings = () => Object.fromEntries(SETTINGS_FIELDS.map(({ key, initial }) => [key, initial()]));

function decodeSettings(text) {
  try {
    return parseSettings(JSON.parse(text));
  } catch {
    return defaultSettings();
  }
}

function loadSettingsSync(file) {
  try {
    return decodeSettings(readFileSync(file, "utf8"));
  } catch {
    return defaultSettings();
  }
}

async function loadSettings(file) {
  let text = null;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return defaultSettings();
  }
  return decodeSettings(text);
}

// ---------- скорость установки: два режима ----------

/*
 * «Быстрая установка» (13.11.2026, решение владельца). Выключена — обычный режим: тормоз записи работает всегда, на
 * любом диске (половина измеренной скорости, не выше DEFAULT_WRITE_LIMIT_MBPS), после большой операции диск отдыхает.
 * Включена — сняты потолки записи и чтения и отдых диска. Кнопка снимает тормоз с диска, а не с интернета: скорость
 * загрузки — своя настройка. Смена режима действует сразу, и посреди идущей установки тоже: копии читают потолок на
 * каждом куске, потоку большой копии его передаёт copy-off-thread.js; процессу движка, который уже пишет, потолок не
 * сменить — он действует со следующего вызова движка.
 *
 * Фоновый приоритет — в обоих режимах (18.11.2026, слово владельца: «быстрая установка быстрее не устанавливает, но диск
 * нагружает… всё начинает лагать»): движок пишет с фоновым приоритетом ввода-вывода и процессора, процессы сборки наборов
 * идут «ниже обычного» (`child-priority.js`). Прежде «Быстрая» снимала и его: на быстром диске потолок 250 МБ/с по времени
 * не различим (замеры 15.11, `docs/INSTALL-SPEED.md`), то есть времени кнопка там не давала, а компьютер лагал сильнее.
 */
function pushWriteLimit(value) {
  setNativeWriteLimit(value);
  setCopyWriteLimitMbps(value);
}

const normalWrite = (places) => autoWriteLimitMbps(places, { ceiling: DEFAULT_WRITE_LIMIT_MBPS });
const normalRead = (places) => autoReadLimitMbps(places, { ceiling: DEFAULT_READ_LIMIT_MBPS });

/* Регулятор диска ходит за режимом тем же входом, каким режим ставит потолки писателям. Сбой регулятора режим не трогает. */
function followGovernor(active, places, base) {
  try {
    followInstallMode({
      active,
      places,
      base,
      apply: { write: pushWriteLimit, read: setNativeReadLimit, rest: setDiskRestFactor },
    });
  } catch {
    /* регулятор — добавка к режиму: без него всё идёт как до него */
  }
}

const SPEED_MODES = {
  fast: {
    apply(places) {
      pushWriteLimit(0);
      setNativeModeWriteLimit(0);
      setNativeReadLimit(0);
      setDiskRest(false);
      /* Фоновый приоритет процессора остаётся: «Быстрая» снимает потолки, отдых и низкую ступень диска, а не уважение к остальным программам. */
      setNativeFastInstall(false);
      setBackgroundGentle(true);
      setBackgroundIoGentle(false);
      /* Регулятор диска (`disk-governor.js`): в «Быстрой» выключен, потолки и отдых — как их только что поставил режим. */
      followGovernor(false, places, { writeMbps: 0, readMbps: 0 });
    },
    shown: () => ({ effectiveWrite: 0, effectiveRead: 0 }),
  },
  normal: {
    apply(places) {
      const base = { writeMbps: normalWrite(places), readMbps: normalRead(places) };
      pushWriteLimit(base.writeMbps);
      /* Короткие записи идут по потолку режима, а не по долям регулятора диска. */
      setNativeModeWriteLimit(base.writeMbps);
      setNativeReadLimit(base.readMbps);
      setDiskRest(true);
      setNativeFastInstall(false);
      setBackgroundGentle(true);
      /* Движок, помощник RPF и сборки наборов — на низкой ступени ввода-вывода (`child-priority.js`). */
      setBackgroundIoGentle(true);
      /* Регулятор диска: потолки выше — «обычная скорость»; когда диск занят больше цели, регулятор опускает их, а отдых после больших операций растёт. */
      followGovernor(true, places, base);
    },
    shown: (places) => ({ effectiveWrite: normalWrite(places), effectiveRead: normalRead(places) }),
  },
};

const modeFor = (settings) => SPEED_MODES[settings?.fastInstall === true ? "fast" : "normal"];
const placesOf = (root) => [root, ...knownDiskPlaces()];

/** Применить режим скорости установки ко всем писателям процесса. Стендам — тот же вход, что у приложения. */
export function applyInstallSpeed(settings, places = knownDiskPlaces()) {
  modeFor(settings).apply(places);
}

function applyLimits(settings, root) {
  applyInstallSpeed(settings, placesOf(root));
}

const reportedLimits = (settings, root) => modeFor(settings).shown(placesOf(root));

// ---------- описи точек отката и состояние движка ----------

function manifestRewriter(newRoot, priorRoots) {
  const roots = distinctFolders(priorRoots).filter((folder) => !sameFolder(folder, newRoot));
  const relocated = (value) => {
    if (typeof value !== "string" || !path.isAbsolute(value)) return null;
    const hit = roots.map((root) => tailInside(root, value)).find((tail) => tail !== null);
    return hit === undefined ? null : path.join(newRoot, hit);
  };
  return function rewrite(manifest) {
    if (!manifest || typeof manifest !== "object") return null;
    const patch = relocated(manifest.patch);
    const listed = Array.isArray(manifest.archives);
    const archives = listed
      ? manifest.archives.map((entry) => {
          const backupPath = relocated(entry?.backupPath);
          return backupPath === null ? entry : { ...entry, backupPath };
        })
      : null;
    const archivesMoved = listed && archives.some((entry, index) => entry !== manifest.archives[index]);
    if (patch === null && !archivesMoved) return null;
    return {
      ...manifest,
      ...(patch === null ? {} : { patch }),
      ...(listed ? { archives } : {}),
    };
  };
}

function legacyTarget(text, legacyRoot, backupsDir) {
  if (!path.isAbsolute(text)) return null;
  const tail = tailInside(legacyRoot, text);
  if (tail === null) return null;
  return LEGACY_NAMES.includes(tail.split(path.sep)[0]) ? path.join(backupsDir, tail) : null;
}

function rewriteLegacyPaths(value, legacyRoot, backupsDir) {
  let count = 0;
  const pending = value && typeof value === "object" ? [value] : [];
  while (pending.length > 0) {
    const node = pending.pop();
    for (const [key, child] of Object.entries(node)) {
      const moved = typeof child === "string" ? legacyTarget(child, legacyRoot, backupsDir) : null;
      if (moved !== null) {
        node[key] = moved;
        count += 1;
      } else if (child && typeof child === "object") {
        pending.push(child);
      }
    }
  }
  return count;
}

function* installedEntries(state) {
  for (const target of Object.values(state?.targets || {})) {
    for (const item of target?.installed || []) yield item;
  }
}

async function modTitles(root) {
  const state = await readStateShared(path.join(root, "backups")).catch(() => null);
  const titles = new Map();
  for (const item of installedEntries(state)) {
    if (item?.modId) titles.set(item.modId, String(item.origin?.title || item.modId));
  }
  return titles;
}

// ---------- обход, обмер и копирование ----------

async function listFolder(folder, forgiving) {
  try {
    return await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (forgiving && error?.code === "ENOENT") return [];
    throw error;
  }
}

function entryKind(entry) {
  if (entry.isSymbolicLink()) return "link";
  if (entry.isDirectory()) return "dir";
  return entry.isFile() ? "file" : null;
}

async function* walkTree(root, skip, forgiving) {
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    yield { kind: "enter", rel };
    const entries = await listFolder(path.join(root, rel), rel !== "" && forgiving);
    const subfolders = [];
    for (const entry of entries) {
      const entryRel = path.join(rel, entry.name);
      if (skip(entryRel, rel === "")) continue;
      const kind = entryKind(entry);
      if (kind === "dir") subfolders.push(entryRel);
      else if (kind !== null) yield { kind, rel: entryRel, name: entry.name };
    }
    stack.push(...subfolders);
  }
}

function cacheSkip(entryRel, atRoot) {
  const name = path.basename(entryRel);
  const service = name.toLowerCase() === MARKER_NAME || WORK_FOLDER.test(name);
  if (atRoot && service) return true;
  return PINNED_PATHS.includes(entryRel.split(path.sep).join("/").toLowerCase());
}

const EMPTY_GAUGE = Object.freeze({ bytes: 0, shared: 0, files: 0 });

class InodeLedger {
  #slots = new Map();
  files = 0;

  note(stat) {
    this.files += 1;
    const key = `${stat.dev}:${stat.ino}`;
    const slot = this.#slots.get(key);
    if (slot) slot.names += 1;
    else this.#slots.set(key, { size: Number(stat.size), links: Number(stat.nlink), names: 1 });
  }

  gauge() {
    const totals = { bytes: 0, shared: 0, files: this.files };
    for (const { size, links, names } of this.#slots.values()) {
      totals[names >= links ? "bytes" : "shared"] += size;
    }
    return totals;
  }
}

async function measureTree(root, skip) {
  const ledger = new InodeLedger();
  for await (const item of walkTree(root, skip ?? NEVER, true)) {
    if (item.kind !== "file") continue;
    const stat = await fs.stat(path.join(root, item.rel), { bigint: true }).catch(() => null);
    if (stat !== null) ledger.note(stat);
  }
  return ledger.gauge();
}

async function firstLeftoverMatch(candidates, rel, stat) {
  for (const place of candidates) {
    const found = await fs.stat(path.join(place, rel), { bigint: true }).catch(() => null);
    const alike = found && found.size === stat.size;
    if (alike && Math.abs(Number(found.mtimeMs - stat.mtimeMs)) < REUSE_TOLERANCE_MS) return path.join(place, rel);
  }
  return null;
}

async function adoptLeftover(candidates, rel, stat, destination) {
  const leftover = await firstLeftoverMatch(candidates, rel, stat);
  if (leftover === null) return false;
  return fs.rename(leftover, destination).then(
    () => true,
    () => false,
  );
}

async function withHandle(handle, work) {
  try {
    return await work(handle);
  } finally {
    await handle.close();
  }
}

async function* chunksOf(input, buffer, signal) {
  for (let position = 0; ; ) {
    assertNotAborted(signal);
    const { bytesRead } = await input.read(buffer, 0, COPY_CHUNK, position);
    if (bytesRead === 0) return;
    yield { bytesRead, position };
    position += bytesRead;
  }
}

async function copyBytes({ from, to, stat, buffer, signal, onChunk }) {
  const input = await fs.open(from, "r");
  await withHandle(input, async () => {
    const output = await fs.open(to, "wx");
    await withHandle(output, async () => {
      for await (const { bytesRead, position } of chunksOf(input, buffer, signal)) {
        await output.write(buffer, 0, bytesRead, position);
        onChunk(bytesRead);
      }
      await output.utimes(stat.atime, stat.mtime).catch(noop);
    });
  });
}

async function copyOneFile({ item, source, target, buffer, linkFile, twins, reusable, signal, meter }) {
  const from = path.join(source, item.rel);
  const to = path.join(target, item.rel);
  const stat = await fs.stat(from, { bigint: true });
  const twinKey = `${stat.dev}:${stat.ino}`;
  const shared = stat.nlink > 1n;
  const attempts = [
    ["twin", () => tryTwinLink({ shared, twins, twinKey, linkFile, to })],
    ["leftover", () => tryLeftover({ reusable, item, stat, to, meter })],
    ["bytes", () => copyThroughBuffer({ item, from, to, stat, buffer, signal, meter })],
  ];
  let used = null;
  for (const [how, run] of attempts) {
    if (await run()) {
      used = how;
      break;
    }
  }
  if (used !== "twin" && shared) twins.set(twinKey, to);
  meter?.fileDone();
}

async function tryTwinLink({ shared, twins, twinKey, linkFile, to }) {
  if (!shared) return false;
  if (!twins.has(twinKey)) return false;
  return linkFile(twins.get(twinKey), to).then(
    () => true,
    () => false,
  );
}

async function tryLeftover({ reusable, item, stat, to, meter }) {
  if (reusable.length === 0) return false;
  if (!(await adoptLeftover(reusable, item.rel, stat, to))) return false;
  meter?.advance(Number(stat.size), item.name);
  return true;
}

async function copyThroughBuffer({ item, from, to, stat, buffer, signal, meter }) {
  const onChunk = (count) => meter?.advance(count, item.name);
  await copyBytes({ from, to, stat, buffer, signal, onChunk });
  return true;
}

async function copyTree({ source, target, skip = NEVER, linkFile, twins, reusable, signal, meter }) {
  const buffer = Buffer.allocUnsafe(COPY_CHUNK);
  for await (const item of walkTree(source, skip, false)) {
    switch (item.kind) {
      case "enter":
        assertNotAborted(signal);
        await fs.mkdir(path.join(target, item.rel), { recursive: true });
        break;
      case "link":
        throw new Error(MSG.links);
      default:
        await copyOneFile({ item, source, target, buffer, linkFile, twins, reusable, signal, meter });
    }
  }
}

async function renamedWithoutCopy(from, to) {
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    return false;
  }
}

async function carryFolder(from, to, temp, linkFile) {
  await copyTree({ source: from, target: temp, linkFile, twins: new Map(), reusable: [] });
  await fs.rename(temp, to);
  await fs.rm(from, { recursive: true, force: true });
}

async function carryFile(from, to, temp) {
  await fs.copyFile(from, temp, constants.COPYFILE_EXCL);
  const original = await fs.stat(from);
  const copy = await fs.stat(temp);
  if (original.size !== copy.size) {
    await fs.rm(temp, { force: true }).catch(noop);
    throw new Error(MSG.verify);
  }
  await fs.rename(temp, to);
  await fs.rm(from, { force: true });
}

async function moveEntry(from, to, isFolder, linkFile) {
  if (await renamedWithoutCopy(from, to)) return;
  const temp = `${to}.migration-${randomUUID()}`;
  await (isFolder ? carryFolder(from, to, temp, linkFile) : carryFile(from, to, temp));
}

// ---------- подготовка корня кэша: шаги по порядку ----------

const PREPARE_STEPS = ["makeFolders", "collectStrays", "returnOwnFiles", "stampMarker", "absorbLegacy"];

class RootPreparer {
  constructor(env) {
    this.env = env;
    this.ready = new Map();
    this.line = Promise.resolve();
  }

  async ensure(root, force = false) {
    const key = root.toLowerCase();
    if (!force && this.ready.has(key)) {
      await this.ready.get(key);
      if (await pathExists(path.join(root, "backups"))) return;
    }
    const job = this.line.then(() => this.build(root));
    this.line = job.catch(noop);
    this.ready.set(key, job);
    try {
      await job;
    } catch (error) {
      if (this.ready.get(key) === job) this.ready.delete(key);
      throw error;
    }
  }

  async build(root) {
    const folders = { root, downloads: path.join(root, "downloads"), backups: path.join(root, "backups") };
    for (const step of PREPARE_STEPS) await this[step](folders);
  }

  async makeFolders({ root, downloads, backups }) {
    for (const folder of [root, downloads, backups]) await fs.mkdir(folder, { recursive: true });
  }

  async collectStrays({ root, downloads }) {
    const { linkFile } = this.env;
    const listing = await fs.readdir(root, { withFileTypes: true });
    const strays = listing.filter((entry) => {
      const ours = OWN_NAMES.includes(entry.name.toLowerCase()) || WORK_FOLDER.test(entry.name);
      return !ours && !entry.isSymbolicLink();
    });
    for (const entry of strays) {
      const target = path.join(downloads, entry.name);
      if (!(await entryExists(target))) {
        await moveEntry(path.join(root, entry.name), target, entry.isDirectory(), linkFile);
      }
    }
  }

  async returnOne(name, root, downloads) {
    const carried = path.join(downloads, name);
    const info = await fs.lstat(carried).catch(() => null);
    if (info === null || info.isSymbolicLink()) return;
    const home = path.join(root, name);
    const action = (await entryExists(home)) ? rmQuiet(carried) : fs.rename(carried, home).catch(noop);
    await action;
  }

  async returnOwnFiles({ root, downloads }) {
    for (const name of OWN_NAMES) await this.returnOne(name, root, downloads);
  }

  async stampMarker({ root }) {
    const file = path.join(root, MARKER_NAME);
    const wanted = JSON.stringify(MARKER_BODY, null, 2);
    const current = await fs
      .readFile(file, "utf8")
      .then((text) => JSON.stringify(JSON.parse(text), null, 2))
      .catch(() => null);
    if (current !== wanted) await fs.writeFile(file, wanted, "utf8");
  }

  async absorbLegacy({ root, downloads, backups }) {
    const { legacyRoot, linkFile } = this.env;
    const legacy = legacyRoot ? path.resolve(legacyRoot) : null;
    if (!legacy || legacy === root) return;
    await fs.mkdir(downloads, { recursive: true });
    await fs.mkdir(backups, { recursive: true });
    await this.pullLegacyDownloads(legacy, downloads, linkFile);
    await this.pullLegacyState(legacy, backups, linkFile);
    await this.refreshLegacyState(legacy, backups);
  }

  async pullLegacyDownloads(legacy, downloads, linkFile) {
    const old = path.join(legacy, "downloads");
    const info = await fs.lstat(old).catch(() => null);
    if (!info?.isDirectory()) return;
    for (const entry of await fs.readdir(old, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(downloads, entry.name);
      if (await entryExists(target)) continue;
      await moveEntry(path.join(old, entry.name), target, entry.isDirectory(), linkFile);
    }
    await rmdirQuiet(old);
  }

  async pullLegacyState(legacy, backups, linkFile) {
    for (const name of LEGACY_NAMES) {
      const from = path.join(legacy, name);
      const target = path.join(backups, name);
      const info = await fs.lstat(from).catch(() => null);
      if (!info || info.isSymbolicLink() || (await entryExists(target))) continue;
      await moveEntry(from, target, info.isDirectory(), linkFile);
    }
  }

  async refreshLegacyState(legacy, backups) {
    const file = path.join(backups, "install-state.json");
    const text = await fs.readFile(file, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (text === null) return;
    const state = JSON.parse(text);
    if (rewriteLegacyPaths(state, legacy, backups) > 0) await writeAtomically(file, JSON.stringify(state, null, 2));
  }
}

// ---------- память размеров ----------

class SizeMemory {
  #entry = null;

  #alive(entry) {
    return entry.settledAt === null || Date.now() - entry.settledAt < SIZE_MEMORY_MS;
  }

  recall(key, supplier) {
    const kept = this.#entry;
    if (kept && kept.key === key && this.#alive(kept)) return kept.promise;
    const entry = { key, settledAt: null, promise: supplier() };
    this.#entry = entry;
    const markSettled = () => {
      entry.settledAt = Date.now();
    };
    const dropFailed = () => {
      if (this.#entry === entry) this.#entry = null;
    };
    entry.promise.then(markSettled, dropFailed);
    return entry.promise;
  }

  forget() {
    this.#entry = null;
  }
}

// ---------- осмотр папки назначения ----------

const isOwnTrace = (name) => OWN_NAMES.includes(name.toLowerCase()) || MARKER_TEMP.test(name) || WORK_FOLDER.test(name);

function classifyEntries(entries) {
  const names = entries.map((entry) => entry.name).filter((name) => !JUNK_NAMES.has(name.toLowerCase()));
  if (names.length === 0) return "empty";
  if (names.some((name) => name.toLowerCase() === MARKER_NAME)) return "own";
  return names.every(isOwnTrace) ? "own" : "foreign";
}

async function surveyTarget(destination, toDefault) {
  const parent = path.dirname(destination);
  const base = path.basename(destination).toLowerCase();
  const neighbours = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
  const isSibling = (entry) =>
    entry.isDirectory() &&
    entry.name.toLowerCase().startsWith(base) &&
    SIBLING_TAIL.test(entry.name.slice(base.length));
  const abandoned = neighbours.filter(isSibling).map((entry) => path.join(parent, entry.name));
  let state = "own";
  let entries = [];
  if (!toDefault) {
    const read = await fs.readdir(destination, { withFileTypes: true }).then(
      (list) => ({ list }),
      (error) => {
        if (error?.code !== "ENOENT") throw error;
        return null;
      },
    );
    entries = read === null ? [] : read.list;
    state = read === null ? "absent" : classifyEntries(entries);
  }
  const inner = entries
    .filter((entry) => WORK_FOLDER.test(entry.name) && entry.isDirectory())
    .map((entry) => path.join(destination, entry.name));
  const reusable = [...(state === "own" ? [destination] : []), ...abandoned, ...inner];
  return { state, entries, reusable, abandoned: [...abandoned, ...inner] };
}

function percentOf(done, total) {
  return total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;
}

async function readJsonList(file) {
  return fs
    .readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .then((parsed) => (Array.isArray(parsed) ? parsed : []))
    .catch(() => []);
}

// ---------- перенос кэша: стадии по порядку ----------

const MOVE_STAGES = [
  "outline",
  "measurePoints",
  "makeTarget",
  "readySource",
  "makeWork",
  "copyCache",
  "copyPoints",
  "refreshStateCopy",
  "readyWork",
  "place",
  "commit",
];

class CacheMove {
  constructor(env, destination, onProgress) {
    this.env = env;
    this.destination = destination;
    this.twins = new Map();
    this.bytesDone = 0;
    this.filesDone = 0;
    this.merged = [];
    this.setAside = [];
    this.placedNames = [];
    this.previousDir = null;
    this.work = null;
    this.committed = false;
    this.pointsPlaced = null;
    this.copied = null;
    this.tell = (patch) => {
      const live = env.session.moving;
      Object.assign(live, patch);
      live.percent = live.phase === "complete" ? 100 : percentOf(live.copiedBytes, live.totalBytes);
      onProgress?.({ ...live });
    };
    this.meter = {
      advance: (count, file) => {
        this.bytesDone += count;
        this.tell({ phase: "copying", copiedBytes: this.bytesDone, copiedFiles: this.filesDone, file });
      },
      fileDone: () => {
        this.filesDone += 1;
      },
    };
  }

  get signal() {
    return this.env.session.controller.signal;
  }

  async inspect() {
    const { env, destination } = this;
    const settings = await env.readSettings();
    const source = settings.customCacheRoot || env.defaultRoot;
    if (sameFolder(source, destination)) return true;
    if (isInside(source, destination) || isInside(destination, source)) throw new Error(MSG.nested);
    const running = await fs.readdir(path.join(source, "backups", "transactions")).catch(() => []);
    if (running.length > 0) throw new Error(MSG.installing);
    const toDefault = sameFolder(destination, env.defaultRoot);
    const pointsRoot = settings.restorePointsCacheRoot || env.defaultRoot;
    const pointsMove = !sameFolder(pointsRoot, destination);
    const survey = await surveyTarget(destination, toDefault);
    if (survey.state === "foreign" || (!pointsMove && !toDefault)) throw new Error(MSG.foreign);
    Object.assign(this, { settings, source, toDefault, pointsRoot, pointsMove, survey });
    this.created = survey.state === "absent";
    return false;
  }

  arm() {
    const { env, source, destination } = this;
    env.session.moving = {
      phase: "preparing",
      copiedBytes: 0,
      totalBytes: 0,
      percent: 0,
      sourcePath: source,
      destinationPath: destination,
    };
    env.session.controller = new AbortController();
  }

  async execute() {
    const { env } = this;
    if (await this.inspect()) return env.status();
    this.arm();
    try {
      for (const stage of MOVE_STAGES) await this[stage]();
      await this.tidyUp();
    } catch (error) {
      await this.rollBack();
      throw error;
    } finally {
      env.session.moving = null;
      env.session.controller = null;
    }
    return env.status();
  }

  outline() {
    const { env, destination, source, settings } = this;
    this.oldPoints = restorePointsFolder(this.pointsRoot);
    this.newPoints = restorePointsFolder(destination);
    const priors = [this.pointsRoot, source, ...settings.previousCacheRoots, env.defaultRoot];
    this.rewrite = manifestRewriter(destination, priors);
  }

  async measurePoints() {
    this.pointsGauge = EMPTY_GAUGE;
    if (!this.pointsMove) return;
    this.pointsGauge = await measureTree(this.oldPoints, null).catch((error) => {
      if (error?.code === "ENOENT") return EMPTY_GAUGE;
      throw error;
    });
  }

  makeTarget() {
    return createTargetFolder(this.destination);
  }

  async readySource() {
    const { env, source, settings } = this;
    await env.preparer.ensure(source);
    await env.relocatePaths(source, settings, Infinity);
  }

  async makeWork() {
    this.work = path.join(this.destination, `.transfer-${randomUUID()}`);
    await fs.mkdir(this.work, { recursive: true });
  }

  async copyCache() {
    const { env, source, work, pointsGauge } = this;
    const gauge = await measureTree(source, cacheSkip);
    this.tell({
      phase: "copying",
      copiedBytes: 0,
      totalBytes: gauge.bytes + gauge.shared + pointsGauge.bytes + pointsGauge.shared,
      copiedFiles: 0,
      totalFiles: gauge.files,
    });
    await copyTree({
      source,
      target: work,
      skip: cacheSkip,
      linkFile: env.linkFile,
      twins: this.twins,
      reusable: this.survey.reusable,
      signal: this.signal,
      meter: this.meter,
    });
    this.tell({ phase: "finalizing", copiedFiles: this.filesDone });
    assertNotAborted(this.signal);
  }

  async copyPoints() {
    if (!this.pointsMove) return;
    const { env } = this;
    const base = this.bytesDone;
    this.workPoints = restorePointsFolder(this.work);
    this.copied = await copyRestorePoints({
      from: this.oldPoints,
      into: this.workPoints,
      signal: this.signal,
      onProgress: ({ copiedBytes, file }) => this.tell({ phase: "copying", copiedBytes: base + copiedBytes, file }),
      rewrite: this.rewrite,
      linkFile: env.linkFile,
      statfs: env.statfs,
      twins: this.twins,
    });
    assertNotAborted(this.signal);
  }

  async refreshStateCopy() {
    const { source, destination } = this;
    const file = path.join(this.work, "backups", "install-state.json");
    const text = await fs.readFile(file, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (text === null) return;
    const state = JSON.parse(text);
    const moves = ["backups", "downloads"].map((name) => ({
      from: path.join(source, name),
      to: path.join(destination, name),
    }));
    const rewritten = await relocateState(state, moves, { except: [...PINNED_IN_BACKUPS] });
    if (rewritten) await fs.writeFile(file, JSON.stringify(state), "utf8");
  }

  readyWork() {
    return this.env.preparer.ensure(this.work, true);
  }

  place() {
    return this.toDefault ? this.placeIntoDefault() : this.replaceTarget();
  }

  async placeIntoDefault() {
    const { destination, work, copied } = this;
    if (copied && copied.files.length > 0) {
      this.pointsPlaced = await placeRestorePoints(this.workPoints, restorePointsFolder(destination));
    }
    const backupsHere = path.join(destination, "backups");
    await fs.mkdir(backupsHere, { recursive: true });
    const names = await fs.readdir(path.join(work, "backups")).catch(() => []);
    const movable = names.filter((name) => !PINNED_IN_BACKUPS.includes(name.toLowerCase()));
    const parts = [
      [path.join(work, "downloads"), path.join(destination, "downloads")],
      ...movable.map((name) => [path.join(work, "backups", name), path.join(backupsHere, name)]),
    ];
    for (const part of parts) await this.swapIn(part);
    await rmQuiet(work);
  }

  async swapIn([from, to]) {
    if (!(await pathExists(from))) return;
    const aside = (await pathExists(to)) ? `${to}.previous-${randomUUID()}` : null;
    if (aside) await fs.rename(to, aside);
    this.merged.push({ to, aside });
    await fs.rename(from, to);
  }

  async replaceTarget() {
    const { destination, work } = this;
    const fresh = await surveyTarget(destination, false);
    if (fresh.state === "foreign") throw new Error(MSG.foreign);
    this.previousDir = path.join(destination, `.previous-${randomUUID()}`);
    const displaced = fresh.entries.map((entry) => entry.name).filter((name) => !WORK_FOLDER.test(name));
    for (const name of displaced) await this.setAsideOne(name);
    for (const name of await fs.readdir(work)) await this.placeOne(name);
    await rmdirQuiet(work);
  }

  async setAsideOne(name) {
    if (this.setAside.length === 0) await fs.mkdir(this.previousDir, { recursive: true });
    await fs.rename(path.join(this.destination, name), path.join(this.previousDir, name));
    this.setAside.push(name);
  }

  async placeOne(name) {
    await fs.rename(path.join(this.work, name), path.join(this.destination, name));
    this.placedNames.push(name);
  }

  async commit() {
    const { env, settings, destination, source } = this;
    const points = this.pointsMove ? destination : settings.restorePointsCacheRoot;
    Object.assign(settings, {
      customCacheRoot: this.toDefault ? null : destination,
      previousCacheRoots: distinctFolders([source, ...settings.previousCacheRoots])
        .filter((folder) => !sameFolder(folder, destination))
        .slice(0, HISTORY_LIMIT),
      relocatedFor: destination,
      restorePointsCacheRoot: points && sameFolder(points, env.defaultRoot) ? null : points,
    });
    await env.writeSettings(settings);
    this.committed = true;
    env.announcePoints(settings);
    env.relocations.set(destination.toLowerCase(), Promise.resolve());
    await env.preparer.ensure(destination, true).catch(noop);
    env.forget();
    this.tell({ phase: "complete" });
  }

  async tidyUp() {
    if (this.pointsMove) await this.settlePoints();
    await this.dropLeftovers();
    if (sameFolder(this.source, this.env.defaultRoot)) await this.clearDefaultCache();
    else await this.leaveCustomCache(this.settings);
  }

  async settlePoints() {
    const { newPoints } = this;
    const losers = [
      () => this.pointsPlaced?.aside,
      () => this.setAside.includes("backups") && restorePointsFolder(this.previousDir),
    ];
    for (const pickLoser of losers) {
      const loser = pickLoser();
      if (loser) await mergeAbsentRestorePoints(loser, newPoints).catch(noop);
    }
    await settleRestorePointsSiblings(newPoints).catch(noop);
    await removeTransferredRestorePoints(this.oldPoints, this.copied.files, { movedTo: newPoints }).catch(noop);
  }

  async dropLeftovers() {
    const doomed = [
      ...(this.setAside.length > 0 ? [this.previousDir] : []),
      ...this.merged.map((entry) => entry.aside).filter(Boolean),
      ...this.survey.abandoned,
    ];
    for (const target of doomed) await rmQuiet(target);
  }

  async clearDefaultCache() {
    const { source } = this;
    const backups = path.join(source, "backups");
    await rmQuiet(path.join(source, "downloads"));
    const names = await fs.readdir(backups).catch(() => []);
    for (const name of names.filter((entry) => !PINNED_IN_BACKUPS.includes(entry.toLowerCase()))) {
      await rmQuiet(path.join(backups, name));
    }
    await fs.rm(path.join(source, MARKER_NAME), { force: true }).catch(noop);
    await rmdirQuiet(backups);
    await rmdirQuiet(source);
  }

  async sweepStrays(settings) {
    const { env } = this;
    const strays = restorePointsFolder(this.source);
    if (sameFolder(strays, this.oldPoints)) return true;
    try {
      const { linkFile, statfs } = env;
      await sweepLeftoverRestorePoints({
        from: strays,
        to: restorePointsFolder(settings.restorePointsCacheRoot || env.defaultRoot),
        rewrite: this.rewrite,
        linkFile,
        statfs,
      });
      return true;
    } catch {
      return false;
    }
  }

  async leaveCustomCache(settings) {
    const { source } = this;
    await this.mergeGameLocations().catch(noop);
    if (await this.sweepStrays(settings)) {
      await rmQuiet(source);
      return;
    }
    const backups = path.join(source, "backups");
    const keep = [
      [source, "backups"],
      [backups, "native-rpf"],
    ];
    for (const [folder, spared] of keep) {
      for (const name of await fs.readdir(folder).catch(() => [])) {
        if (name.toLowerCase() !== spared) await rmQuiet(path.join(folder, name));
      }
    }
  }

  async mergeGameLocations() {
    const movedFile = path.join(this.source, "backups", "game-locations.json");
    if (!(await pathExists(movedFile))) return;
    const incoming = await readJsonList(movedFile);
    const targetFile = path.join(this.env.defaultRoot, "backups", "game-locations.json");
    const current = await readJsonList(targetFile);
    const known = new Set(
      current.filter((entry) => entry?.path).map((entry) => String(entry.path).toLowerCase()),
    );
    const additions = [];
    for (const entry of incoming) {
      const key = entry?.path ? String(entry.path).toLowerCase() : null;
      if (key === null || known.has(key)) continue;
      known.add(key);
      additions.push(entry);
    }
    await writeAtomically(targetFile, JSON.stringify([...current, ...additions], null, 2));
  }

  async rollBack() {
    if (this.work) await rmQuiet(this.work);
    if (this.committed) return;
    if (this.pointsPlaced) await undoPlaceRestorePoints(this.pointsPlaced).catch(noop);
    if (this.toDefault) await this.undoMerge();
    else if (this.created) await rmQuiet(this.destination);
    else await this.undoReplace();
  }

  async undoMerge() {
    for (const { to, aside } of this.merged.slice().reverse()) {
      await rmQuiet(to);
      if (aside) await fs.rename(aside, to).catch(noop);
    }
  }

  async undoReplace() {
    const { destination, previousDir } = this;
    for (const name of this.placedNames.slice().reverse()) await rmQuiet(path.join(destination, name));
    for (const name of this.setAside.slice().reverse()) {
      await fs.rename(path.join(previousDir, name), path.join(destination, name)).catch(noop);
    }
    if (this.setAside.length > 0) await rmdirQuiet(previousDir);
  }
}

// ---------- разделы отчёта status() ----------

function tallyKinds(kinds) {
  const rows = Object.entries(kinds);
  let backupBytes = 0;
  for (const [name, row] of rows) {
    if (!STRIPPED_KINDS.includes(name)) backupBytes += row.bytes;
  }
  let everyFile = 0;
  for (const [, row] of rows) everyFile += row.files;
  return { backupBytes, backupFileCount: everyFile - kinds.downloads.files };
}

function describeGameBackups(kinds, sharedWithGame, wholeBytes) {
  const parts = {};
  for (const name of GAME_PARTS) parts[name] = { bytes: kinds[name].bytes };
  let bytes = 0;
  for (const name of GAME_PARTS) bytes += kinds[name].bytes;
  const modsBytes = (kinds.mods?.bytes || 0) + (kinds.works?.bytes || 0);
  return { bytes, parts, mods: { bytes: modsBytes }, shared: { bytes: sharedWithGame }, whole: { bytes: wholeBytes } };
}

function freeableByKind(units, canClearBrowser, now) {
  return units.reduce((totals, unit) => {
    if (STORAGE_KINDS[unit.kind] !== "A" || !(unit.freeable > 0)) return totals;
    if (!(now - unit.lastUsed >= RECENT_USE_MS)) return totals;
    if (unit.kind === "chromiumCache" && !canClearBrowser) return totals;
    totals[unit.kind] = (totals[unit.kind] || 0) + unit.freeable;
    return totals;
  }, {});
}

function nonNegativeNumber(source, key) {
  const parsed = Number(source?.[key]) || 0;
  return parsed < 0 ? 0 : parsed;
}

function workStores(units) {
  return units.reduce((ordered, unit) => {
    if (unit.kind !== "works") return ordered;
    const entry = { store: path.basename(unit.path), bytes: unit.bytes };
    const slot = ordered.findIndex((other) => other.bytes < entry.bytes);
    ordered.splice(slot === -1 ? ordered.length : slot, 0, entry);
    return ordered;
  }, []);
}

function describeBudget(parts) {
  const { settings, limits, snapshot, freeable, works, mods, shortfall } = parts;
  return {
    value: settings.budget,
    options: [...BUDGET_OPTIONS],
    mode: limits.mode,
    keepBytes: limits.keepBytes,
    evictableBytes: limits.evictableBytes,
    allowance: limits.allowance,
    limitBytes: limits.limitBytes,
    floorBytes: limits.floorBytes,
    usedBytes: snapshot.bytes,
    sharedWithGame: snapshot.sharedWithGame,
    kinds: snapshot.kinds,
    freeable,
    works,
    mods,
    shortfall,
  };
}

function limitSection(settings, root, speeds, diskFreeBytes, moving) {
  return Object.fromEntries([
    ["limitBytes", settings.cacheLimitBytes],
    ["limitOptions", [...CACHE_LIMIT_OPTIONS]],
    ["fastInstall", settings.fastInstall === true],
    ["fastInstallOffered", settings.fastInstallOffered === true],
    ["writeLimitEffectiveMbps", speeds.effectiveWrite],
    ["effectiveReadLimitMbps", speeds.effectiveRead],
    ["diskKind", diskKind(root)],
    ["downloadLimitMbps", settings.downloadLimitMbps],
    ["downloadLimitOptions", [...DOWNLOAD_LIMIT_OPTIONS]],
    ["diskFreeBytes", diskFreeBytes],
    ["moving", moving ? { ...moving } : null],
  ]);
}

// ---------- фабрика менеджера ----------

export function createStorageManager({
  configRoot,
  defaultCacheRoot,
  legacyStateRoot = null,
  restorePointsRoot = null,
  linkFile = fs.link,
  statfs = fs.statfs,
  pointsGuard = (task) => whileMovingRestorePoints(task),
  userDataRoot = null,
  updatesPlaces = null,
  clearChromiumCache = null,
  compactPoints = null,
  probeDelayMs = 30000,
  /* Событие «Быстрой установки» всем окнам: плашка первой установки и смена режима. */
  announceFastInstall = () => {},
  census = (input) => runOffThread(new URL("./storage-census.js", import.meta.url), "censusAstral", [input]),
}) {
  const settingsDir = path.resolve(configRoot);
  const defaultRoot = path.resolve(defaultCacheRoot);
  const settingsFile = path.join(settingsDir, SETTINGS_FILE);
  const session = { moving: null, controller: null };
  const sizes = new SizeMemory();
  const relocations = new Map();
  let probeChain = Promise.resolve();
  let roomLine = Promise.resolve();
  let unsubscribe = null;

  const activeRoot = (settings) => settings.customCacheRoot || defaultRoot;
  const pointsCacheOf = (settings) => settings.restorePointsCacheRoot || defaultRoot;
  const readSettings = () => loadSettings(settingsFile);
  const writeSettings = (settings) => writeAtomically(settingsFile, JSON.stringify(settings, null, 2), true);
  const forgetSizes = () => sizes.forget();

  function announcePoints(settings) {
    setNativeRestorePointsRoot(restorePointsRootIn(pointsCacheOf(settings)));
  }

  const bootSettings = loadSettingsSync(settingsFile);
  announcePoints(bootSettings);
  /* Корень кэша, по которому последний раз считали потолки: «Быстрая установка» ставит режим по нему сразу, до чтения настроек с диска. */
  let speedRoot = activeRoot(bootSettings);
  const applySpeed = (settings) => {
    speedRoot = activeRoot(settings);
    applyLimits(settings, speedRoot);
  };

  const env = {
    session,
    defaultRoot,
    legacyRoot: legacyStateRoot,
    linkFile,
    statfs,
    relocations,
    readSettings,
    writeSettings,
    announcePoints,
    forget: forgetSizes,
    status: () => status(),
    relocatePaths: (root, settings, waitMs) => relocatePaths(root, settings, waitMs),
    preparer: null,
  };
  env.preparer = new RootPreparer(env);

  // ---------- опись ----------

  async function censusInput(settings, root) {
    return {
      cacheRoot: root,
      pointsFolder: restorePointsRoot === "" ? null : restorePointsFolder(pointsCacheOf(settings)),
      userDataRoot,
      updates: updatesPlaces ? await updatesPlaces().catch(() => null) : null,
    };
  }

  async function gatherCensus(settings, root, remember) {
    let updates;
    const count = async () => {
      const input = await censusInput(settings, root);
      updates = input.updates;
      return census(input);
    };
    const snapshot = await (remember ? sizes.recall(root.toLowerCase(), count) : count());
    return { snapshot, updates };
  }

  // ---------- переписывание путей состояния ----------

  function formerRoots(settings, root) {
    const candidates = [...settings.previousCacheRoots, defaultRoot];
    return distinctFolders(candidates).filter((folder) => !sameFolder(folder, root));
  }

  async function rewriteStatePaths(root, settings) {
    try {
      if (settings.relocatedFor && sameFolder(settings.relocatedFor, root)) return;
      const former = formerRoots(settings, root);
      if (former.length === 0) return;
      const moves = former.flatMap((from) =>
        ["backups", "downloads"].map((name) => ({ from: path.join(from, name), to: path.join(root, name) })),
      );
      const result = await relocateStateFile({
        stateDir: path.join(root, "backups"),
        moves,
        except: [...PINNED_IN_BACKUPS],
      });
      if (result.pending) return;
      const fresh = await readSettings();
      if (activeRoot(fresh) !== root) return;
      await writeSettings(Object.assign(fresh, { relocatedFor: root }));
    } catch (error) {
      console.warn(`[astral-storage] Пути состояния после переноса кэша не переписаны: ${error?.message || error}`);
    }
  }

  function untilDeadlineOr(event, deadlineMs) {
    const gate = Promise.withResolvers();
    const timer = setTimeout(gate.resolve, deadlineMs);
    timer.unref?.();
    const release = () => clearTimeout(timer);
    return Promise.race([event, gate.promise]).then(
      (value) => {
        release();
        return value;
      },
      (error) => {
        release();
        throw error;
      },
    );
  }

  function relocatePaths(root, settings, waitMs) {
    const key = root.toLowerCase();
    if (!relocations.has(key)) relocations.set(key, rewriteStatePaths(root, settings));
    const job = relocations.get(key);
    return Number.isFinite(waitMs) ? untilDeadlineOr(job, RELOCATE_WAIT_MS) : job;
  }

  // ---------- отчёт ----------

  async function status() {
    const settings = await readSettings();
    const root = activeRoot(settings);
    await env.preparer.ensure(root);
    const { snapshot } = await gatherCensus(settings, root, true);
    const diskFreeBytes = await freeBytesOf(root);
    const titles = await modTitles(root);
    const kinds = snapshot.kinds;
    const usedBytes = kinds.downloads.bytes;
    const { backupBytes, backupFileCount } = tallyKinds(kinds);
    const gameBackups = describeGameBackups(kinds, snapshot.sharedWithGame, backupBytes);
    const limits = budgetLimits({ budget: settings.budget, census: snapshot, diskFreeBytes });
    const titled = (mod) => ({ ...mod, title: titles.get(mod.store) || mod.store });
    const freeable = freeableByKind(snapshot.units, Boolean(clearChromiumCache), Date.now());
    const works = workStores(snapshot.units);
    const mods = modStores(snapshot).map(titled);
    const shortfall = budgetShortfall({ census: snapshot, limits });
    const budget = describeBudget({
      settings,
      limits,
      snapshot,
      freeable,
      works,
      mods,
      shortfall: shortfall ? { ...shortfall, mods: shortfall.mods.map(titled) } : null,
    });
    const speeds = reportedLimits(settings, root);
    return {
      cacheEnabled: settings.cacheEnabled,
      cachePath: root,
      downloadsPath: path.join(root, "downloads"),
      backupsPath: path.join(root, "backups"),
      defaultCachePath: defaultRoot,
      isCustomPath: root !== defaultRoot,
      usedBytes,
      fileCount: kinds.downloads.files,
      backupBytes,
      backupFileCount,
      gameBackups,
      budget,
      ...limitSection(settings, root, speeds, diskFreeBytes, session.moving),
    };
  }

  // ---------- настройки: один помощник и таблица изменений ----------

  async function commitSetting(change, afterwards) {
    const settings = await readSettings();
    change(settings);
    await writeSettings(settings);
    return afterwards(settings);
  }

  function optionFrom(raw, options, message) {
    const value = Number(raw);
    if (!options.includes(value)) throw new Error(message);
    return value;
  }

  async function setEnabled(enabled) {
    if (session.moving) throw new Error(MSG.moveBusy);
    return commitSetting(
      (settings) => {
        settings.cacheEnabled = Boolean(enabled);
      },
      () => status(),
    );
  }

  /*
   * «Быстрая установка»: тормоз записи снят (true) или работает (false). Действует сразу, посреди установки тоже.
   *
   * Режим ставится до чтения настроек с диска, а ответ кнопке — только про скорость (18.11.2026). Прежде ответом была вся
   * сводка хранилища (`status()`: перепись кэша, свободное место): в покое кнопка ждала её 4,3 с, под сборкой
   * растительности — 32,7 с (журнал альфы 0.9.0-beta.108). Сводку окно читает само, своим запросом `status()`.
   */
  const speedAnswer = (settings) => {
    const root = activeRoot(settings);
    const speeds = reportedLimits(settings, root);
    return {
      fastInstall: settings.fastInstall === true,
      fastInstallOffered: settings.fastInstallOffered === true,
      writeLimitEffectiveMbps: speeds.effectiveWrite,
      effectiveReadLimitMbps: speeds.effectiveRead,
      diskKind: diskKind(root),
    };
  };

  /* Режим сменился — окна узнают (кнопка в «Загрузках» одна на все окна), потом короткий ответ про скорость. */
  const speedsChanged = (settings) => {
    announceFastInstall({ kind: "changed", enabled: settings.fastInstall === true });
    applySpeed(settings);
    return speedAnswer(settings);
  };

  /* `early` — режим, известный до записи настройки: он действует сразу. Настройка не записалась — режим возвращается к хранимому. */
  async function commitSpeed(change, early = null) {
    if (early !== null) {
      applyInstallSpeed({ fastInstall: early }, placesOf(speedRoot));
      announceFastInstall({ kind: "changed", enabled: early });
    }
    try {
      return await commitSetting(change, speedsChanged);
    } catch (error) {
      if (early !== null) await readSettings().then(speedsChanged, noop);
      throw error;
    }
  }

  async function setFastInstall(enabled) {
    if (typeof enabled !== "boolean") throw new Error(MSG.badFast);
    return commitSpeed((settings) => Object.assign(settings, { fastInstall: enabled }), enabled);
  }

  /*
   * Началась установка — из каталога, мастерской, любая. Пока человек не ответил на плашку первой установки, окну
   * уходит просьба её показать. Установку это не держит: «Применить» на плашке снимает тормоз уже идущей установке.
   */
  let offering = false;
  function offerFastInstall() {
    if (offering) return;
    offering = true;
    fastInstallOfferDue()
      .then((due) => {
        if (due) announceFastInstall({ kind: "offer" });
      })
      .catch(noop)
      .finally(() => {
        offering = false;
      });
  }

  /* Плашку первой установки показывать? Только пока человек на неё не ответил и «Быстрая установка» выключена. */
  async function fastInstallOfferDue() {
    const settings = await readSettings();
    return settings.fastInstall !== true && settings.fastInstallOffered !== true;
  }

  /* Ответ на плашку первой установки: «Применить» включает «Быструю установку»; после любого ответа плашки больше нет. */
  async function settleFastInstallOffer(fast) {
    if (typeof fast !== "boolean") throw new Error(MSG.badFast);
    return commitSpeed(
      (settings) => Object.assign(settings, { fastInstallOffered: true, ...(fast ? { fastInstall: true } : {}) }),
      fast ? true : null,
    );
  }

  async function setDownloadLimit(mbps) {
    const value = optionFrom(mbps, DOWNLOAD_LIMIT_OPTIONS, MSG.badDownload);
    return commitSetting(
      (settings) => Object.assign(settings, { downloadLimitMbps: value, downloadLimitChosen: true }),
      () => {
        setDownloadLimitMbps(value);
        return status();
      },
    );
  }

  async function setBudget(value) {
    const budget = value === BUDGET_AUTO ? BUDGET_AUTO : Number(value);
    if (!BUDGET_OPTIONS.includes(budget)) throw new Error(MSG.badBudget);
    return commitSetting(
      (settings) => Object.assign(settings, { budget }),
      async () => {
        forgetSizes();
        await makeRoom().catch(noop);
        return status();
      },
    );
  }

  async function setLimit(limitBytes) {
    const value = optionFrom(limitBytes, CACHE_LIMIT_OPTIONS, MSG.badLimit);
    return commitSetting(
      (settings) => {
        settings.cacheLimitBytes = value;
        settings.budget = budgetFromSettings({ cacheLimitBytes: value });
      },
      () => prune(),
    );
  }

  // ---------- скорость и пробы ----------

  async function probePass() {
    const settings = await readSettings();
    for (const place of placesOf(activeRoot(settings))) {
      if (!probeIsDue(place)) continue;
      await fs.mkdir(place, { recursive: true }).catch(noop);
      await probeDisk(place, { writeFlags: carefulWriteFlags("wx") }).catch(noop);
    }
    const fresh = await readSettings();
    applySpeed(fresh);
  }

  function probeDisks() {
    probeChain = probeChain.then(probePass);
    return probeChain;
  }

  const probeQuietly = () => {
    void probeDisks().catch(noop);
  };

  function onProfileEvent(event) {
    if (event?.places) {
      probeQuietly();
      return;
    }
    readSettings().then(applySpeed, noop);
  }

  async function applyStoredWriteLimit() {
    const settings = await readSettings();
    await openDiskProfiles(path.join(configRoot, PROFILES_FILE));
    applySpeed(settings);
    setDownloadLimitMbps(settings.downloadLimitMbps);
    unsubscribe?.();
    unsubscribe = onDiskProfileChange(onProfileEvent);
    const timer = setTimeout(probeQuietly, probeDelayMs);
    timer.unref?.();
  }

  // ---------- бюджет и вытеснение ----------

  async function evictUnits(units, root, updates) {
    let browserCleared = false;
    const clearBrowser = async () => {
      if (!clearChromiumCache) return false;
      if (!browserCleared) {
        browserCleared = true;
        await clearChromiumCache().catch(noop);
      }
      return true;
    };
    let freed = 0;
    for (const unit of units) {
      const handler = unit.kind === "chromiumCache" ? clearBrowser : () => removeFolderUnit(unit, root, updates);
      if (await handler()) freed += unit.freeable;
    }
    forgetSizes();
    return freed;
  }

  async function evictSelected(snapshot, root, updates, accepts) {
    const chosen = snapshot.units.filter(accepts);
    return chosen.length > 0 ? evictUnits(chosen, root, updates) : 0;
  }

  const ROOM_STEPS = [
    async () => (session.moving ? { freed: 0, shortfall: 0, keepDownloads: true, skipped: "moving" } : null),
    async (scene) => {
      scene.settings = await readSettings();
      scene.root = activeRoot(scene.settings);
      await env.preparer.ensure(scene.root);
    },
    async (scene) => {
      const { snapshot, updates } = await gatherCensus(scene.settings, scene.root, false);
      Object.assign(scene, { snapshot, updates });
      scene.diskFreeBytes = await freeBytesOf(scene.root);
    },
    async (scene) => {
      const { settings, snapshot, diskFreeBytes, incomingBytes, protect } = scene;
      scene.limits = budgetLimits({ budget: settings.budget, census: snapshot, diskFreeBytes });
      scene.outcome = planEviction({ census: snapshot, limits: scene.limits, incomingBytes, diskFreeBytes, protect });
    },
    async (scene) => {
      const { outcome, root, updates } = scene;
      scene.freed = outcome.plan.length > 0 ? await evictUnits(outcome.plan, root, updates) : 0;
    },
    async (scene) => {
      scene.shortfall = scene.outcome.shortfall;
      if (!(scene.shortfall > 0 && compactPoints)) return;
      const packed = await compactPoints(restorePointsRootIn(pointsCacheOf(scene.settings))).catch(() => null);
      const gained = nonNegativeNumber(packed, "bytes");
      scene.freed += gained;
      scene.shortfall = Math.max(0, scene.shortfall - gained);
      if (gained) forgetSizes();
    },
    async (scene) => {
      const { snapshot, limits, packageBytes } = scene;
      const room = limits.allowance - (snapshot.kinds.downloads?.bytes || 0) - packageBytes;
      scene.answer = {
        freed: scene.freed,
        shortfall: scene.shortfall,
        limitBytes: limits.limitBytes,
        keepDownloads: !(packageBytes > 0) || room >= packageBytes,
      };
    },
  ];

  async function roomJob(incomingBytes, packageBytes, protect) {
    const scene = { incomingBytes, packageBytes, protect };
    for (const step of ROOM_STEPS) {
      const early = await step(scene);
      if (early) return early;
    }
    return scene.answer;
  }

  function makeRoom({ incomingBytes = 0, packageBytes = 0, protect = () => false } = {}) {
    const run = roomLine.then(() => roomJob(incomingBytes, packageBytes, protect));
    roomLine = run.catch(noop);
    return run;
  }

  /*
   * Память сборки растительности — в пределах бюджета кэша сразу после сборки (18.11.2026, разбор журнала альфы
   * 0.9.0-beta.108: «после отказа 7,35 ГБ так и лежат в кэше, хотя лимит кэша 2 ГБ»). Обычное вытеснение (`makeRoom`)
   * щадит то, чем пользовались последние десять минут, и после плана само не зовётся: собранное лежало сверх предела
   * до следующей установки. Здесь — сразу и без поправки на свежесть: из `recolor/vegetation/content` уходят самые
   * старые файлы, пока кэш не уложится в предел. Файл со второй ссылкой (пакет плана, установленная работа) не
   * трогается: его удаление места не освободит, а плану он нужен.
   */
  async function trimBuildMemory() {
    const untouched = { freedBytes: 0, removed: 0 };
    if (session.moving) return untouched;
    const settings = await readSettings();
    const root = activeRoot(settings);
    forgetSizes();
    const { snapshot } = await gatherCensus(settings, root, false);
    const diskFreeBytes = await freeBytesOf(root);
    const limits = budgetLimits({ budget: settings.budget, census: snapshot, diskFreeBytes });
    const overFloor = limits.floorBytes && Number.isFinite(diskFreeBytes) ? limits.floorBytes - diskFreeBytes : 0;
    const over = Math.max(snapshot.bytes - limits.limitBytes, overFloor);
    if (!(over > 0)) return untouched;
    const directory = path.join(root, "backups", "recolor", "vegetation", "content");
    const candidates = [];
    for (const name of await fs.readdir(directory).catch(() => [])) {
      const file = path.join(directory, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile() && stat.nlink === 1) candidates.push({ file, size: stat.size, at: stat.mtimeMs });
    }
    candidates.sort((left, right) => left.at - right.at);
    let freedBytes = 0;
    let removed = 0;
    for (const item of candidates) {
      if (freedBytes >= over) break;
      const gone = await fs.rm(item.file).then(
        () => true,
        () => false,
      );
      if (!gone) continue;
      freedBytes += item.size;
      removed += 1;
    }
    if (removed) forgetSizes();
    return { freedBytes, removed };
  }

  async function evictIdle(now = Date.now()) {
    if (session.moving) return 0;
    const settings = await readSettings();
    const root = activeRoot(settings);
    const { snapshot, updates } = await gatherCensus(settings, root, false);
    return evictSelected(
      snapshot,
      root,
      updates,
      (unit) => IDLE_KINDS.has(unit.kind) && unit.freeable > 0 && now - unit.lastUsed >= IDLE_EVICT_MS,
    );
  }

  async function freeKind(kind) {
    if (STORAGE_KINDS[kind] !== "A") throw new Error(MSG.keepKind);
    if (session.moving) throw new Error(MSG.clearWhileMoving);
    const settings = await readSettings();
    const root = activeRoot(settings);
    const { snapshot, updates } = await gatherCensus(settings, root, false);
    const now = Date.now();
    const freedBytes = await evictSelected(
      snapshot,
      root,
      updates,
      (unit) => unit.kind === kind && unit.freeable > 0 && now - unit.lastUsed >= RECENT_USE_MS,
    );
    return { ...(await status()), freedBytes };
  }

  // ---------- точки отката: подбор ----------

  async function bringPointsHome(settings, root, pointsRoot) {
    const rewrite = manifestRewriter(root, [pointsRoot, ...settings.previousCacheRoots, defaultRoot]);
    const from = restorePointsFolder(pointsRoot);
    const to = restorePointsFolder(root);
    const into = `${to}.transfer-${randomUUID()}`;
    const copied = await copyRestorePoints({ from, into, rewrite, linkFile, statfs });
    const placed = copied.files.length > 0 ? await placeOrDiscard(into, to) : null;
    const fresh = await readSettings();
    if (activeRoot(fresh) !== root) {
      if (placed) await undoPlaceRestorePoints(placed).catch(noop);
      throw new Error(MSG.racedMove);
    }
    fresh.restorePointsCacheRoot = sameFolder(root, defaultRoot) ? null : root;
    await writeSettings(fresh);
    announcePoints(fresh);
    forgetSizes();
    const followUps = [
      placed?.aside ? () => mergeAbsentRestorePoints(placed.aside, to) : null,
      () => settleRestorePointsSiblings(to),
      () => removeTransferredRestorePoints(from, copied.files, { movedTo: to }),
    ];
    for (const followUp of followUps.filter(Boolean)) await followUp().catch(noop);
    return { files: copied.files.length, bytes: copied.bytes };
  }

  async function placeOrDiscard(into, to) {
    try {
      return await placeRestorePoints(into, to);
    } catch (error) {
      await rmQuiet(into);
      throw error;
    }
  }

  async function sweepDefaultPoints(settings, root, pointsRoot) {
    const defaultPoints = restorePointsFolder(defaultRoot);
    if (sameFolder(root, defaultRoot) || !(await pathExists(defaultPoints))) return null;
    const latest = await readSettings();
    const rewrite = manifestRewriter(root, [pointsRoot, ...settings.previousCacheRoots, defaultRoot]);
    const swept = await sweepLeftoverRestorePoints({
      from: defaultPoints,
      to: restorePointsFolder(pointsCacheOf(latest)),
      rewrite,
      linkFile,
      statfs,
    });
    forgetSizes();
    return swept;
  }

  async function runAdoption(plan) {
    const { settings, root, pointsRoot, needsMove } = plan;
    const transfer = needsMove ? await bringPointsHome(settings, root, pointsRoot) : null;
    const swept = await sweepDefaultPoints(settings, root, pointsRoot);
    return transfer ? { moved: true, swept, ...transfer } : { moved: false, swept };
  }

  async function adoptRestorePoints() {
    if (session.moving) return { moved: false, swept: null };
    const settings = await readSettings();
    const root = activeRoot(settings);
    const pointsRoot = pointsCacheOf(settings);
    const needsMove = !sameFolder(pointsRoot, root);
    const needsSweep =
      !needsMove && !sameFolder(root, defaultRoot) && (await pathExists(restorePointsFolder(defaultRoot)));
    if (!needsMove && !needsSweep) return { moved: false, swept: null };
    return pointsGuard(() => runAdoption({ settings, root, pointsRoot, needsMove }));
  }

  // ---------- перенос кэша, очистка, запуск ----------

  async function relocate(target, onProgress) {
    if (session.moving) throw new Error(MSG.moveRunning);
    const move = new CacheMove(env, target, onProgress);
    return pointsGuard(() => move.execute());
  }

  async function clear() {
    if (session.moving) throw new Error(MSG.clearWhileMoving);
    const root = activeRoot(await readSettings());
    await env.preparer.ensure(root);
    const downloads = path.join(root, "downloads");
    await fs.rm(downloads, { recursive: true, force: true });
    await fs.mkdir(downloads, { recursive: true });
    return statusAfterForgetting();
  }

  function statusAfterForgetting() {
    forgetSizes();
    return status();
  }

  async function concludeOperation(steps, answer) {
    for (const step of steps) {
      const pending = step();
      if (pending instanceof Promise) await pending;
    }
    return answer();
  }

  async function prune({ report = true } = {}) {
    return concludeOperation([() => makeRoom().catch(() => null), forgetSizes], () => (report ? status() : null));
  }

  async function installOptions() {
    const settings = await readSettings();
    const root = activeRoot(settings);
    await env.preparer.ensure(root);
    await relocatePaths(root, settings, RELOCATE_WAIT_MS);
    return {
      downloadsDir: path.join(root, "downloads"),
      stateDir: path.join(root, "backups"),
      retainDownloads: settings.cacheEnabled,
    };
  }

  async function startupUpkeep() {
    const adopted = await adoptRestorePoints();
    await makeRoom().catch(() => null);
    await evictIdle().catch(() => 0);
    return adopted;
  }

  return {
    status,
    forgetSizes,
    setEnabled,
    setFastInstall,
    fastInstallOfferDue,
    offerFastInstall,
    settleFastInstallOffer,
    setDownloadLimit,
    setBudget,
    makeRoom,
    makeRoomForGameWrite: () => makeRoom({ incomingBytes: GAME_WRITE_RESERVE }),
    settle() {
      forgetSizes();
      return makeRoom().catch(() => null);
    },
    evictIdle,
    trimBuildMemory,
    startupUpkeep,
    freeKind,
    applyStoredWriteLimit,
    probeDisks,
    setLimit,
    clear,
    prune,
    async moveToParent(parent, onProgress) {
      return relocate(path.join(path.resolve(parent), NEW_CACHE_FOLDER), onProgress);
    },
    reset: (onProgress) => relocate(defaultRoot, onProgress),
    adoptRestorePoints,
    cancelMove() {
      if (!session.moving) return { cancelled: false };
      session.controller.abort();
      return { cancelled: true };
    },
    installOptions,
  };
}

// Удаление одной единицы вытеснения, не привязанное к замыканию менеджера.
async function removeFolderUnit(unit, root, updates) {
  const target = path.resolve(unit.path);
  const places = new Set([...(updates?.stale || []), updates?.appOld].map((place) => String(place).toLowerCase()));
  if (!isInside(root, target) && !places.has(target.toLowerCase())) return false;
  await rmQuiet(target);
  if (unit.kind === "vegetationContent") await dropBuildIndexes(path.dirname(target));
  return true;
}

async function dropBuildIndexes(parent) {
  const names = await fs.readdir(parent).catch(() => []);
  for (const name of names.filter((entry) => entry.toLowerCase().startsWith("build-index"))) {
    await fs.rm(path.join(parent, name), { force: true }).catch(noop);
  }
}
