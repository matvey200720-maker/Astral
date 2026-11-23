import fs from "node:fs/promises";
import path from "node:path";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { explainForeignArchive } from "./foreign-archive.js";

const UPDATE_DEVICE = "update:/";
const COMMON_DEVICE = "common:/";
const FOREIGN_CODE = "ASTRAL_FOREIGN_ARCHIVE";
const STALE_HOST_PHRASE = "compressed using an unsupported compression method";
const CONSEQUENCE =
  "эффекты и трассеры Astral на него не лягут. Верните оригинал — проверка файлов игры в Steam, " +
  "Epic Games или Rockstar Games Launcher, затем поставьте сборку из каталога Astral.";

export const CORE_ARCHIVES = Object.freeze(["ptfx.rpf", "ptfx_hi.rpf", "ptfx_lo.rpf"]);

export function coreEntry(archive) {
  return `${UPDATE_DEVICE}x64/patch/data/effects/${archive}/core.ypt`;
}

// Общее приведение пути: ложное — пусто, косые вперёд, нижний регистр.
function canonical(value) {
  return (value ? String(value) : "").replaceAll("\\", "/").toLowerCase();
}

export function updateInner(entry) {
  return canonical(entry).replace(/^update:\/+/, "");
}

const RPF_BOUNDARY = ".rpf/";

export function containerOf(inner) {
  const boundaryAt = inner.lastIndexOf(RPF_BOUNDARY);
  return boundaryAt < 0 ? "" : inner.substring(0, boundaryAt + RPF_BOUNDARY.length - 1);
}

const lastSegment = (inner) => inner.split("/").pop();

// Сколько последних сегментов совпадает: считаем с конца и ищем первое расхождение.
function sharedTail(left, right) {
  const backwardsLeft = left.split("/").reverse();
  const backwardsRight = right.split("/").reverse();
  const firstDifference = backwardsLeft.findIndex((segment, at) => segment !== backwardsRight[at]);
  return firstDifference < 0 ? backwardsLeft.length : firstDifference;
}

function* innerTexts(text, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  for (const match of text.matchAll(pattern)) yield match[1];
}

// Приведение имени из content.xml по шагам: косые вперёд и нижний регистр, обрезка, %platform%.
const NAME_STEPS = [canonical, (name) => name.trim(), (name) => name.replaceAll("%platform%", "x64")];

// Путь внутри update.rpf или null, если имя не с устройства update:/.
function updateDevicePath(text) {
  const name = NAME_STEPS.reduce((current, step) => step(current), text);
  return name.startsWith(UPDATE_DEVICE) ? updateInner(name) : null;
}

const PLAIN_ITEM = /<item(?:\s[^>]*)?>([^<]*)<\/item\s*>/gi;
const RECORD_PATTERNS = {
  rpf: /<filetype>\s*rpf_file\s*<\/filetype>/i,
  name: /<filename>([^<]*)<\/filename>/i,
  off: /<disabled\s+value\s*=\s*"true"/i,
};

function readRecord(record) {
  const named = RECORD_PATTERNS.name.exec(record);
  return {
    rpf: RECORD_PATTERNS.rpf.test(record),
    inner: named ? updateDevicePath(named[1]) : null,
    off: RECORD_PATTERNS.off.test(record),
  };
}

export function mountedArchives(xml) {
  const text = String(xml || "");
  const enabled = new Set(
    [...innerTexts(text, "filesToEnable")]
      .flatMap((section) => [...section.matchAll(PLAIN_ITEM)].map((hit) => updateDevicePath(hit[1])))
      .filter((inner) => inner !== null),
  );
  // Читается только первый блок dataFiles.
  const [catalog = ""] = innerTexts(text, "dataFiles");
  const live = [...innerTexts(catalog, "item")]
    .map(readRecord)
    .filter(({ rpf, inner, off }) => rpf && inner !== null && (!off || enabled.has(inner)));
  return new Set(live.map(({ inner }) => inner));
}

// Критерии порядка копий: подключённые раньше, затем длиннее общий хвост пути, затем по алфавиту.
const COPY_CRITERIA = [
  (left, right) => Number(Boolean(right.mounted)) - Number(Boolean(left.mounted)),
  (left, right) => right.tail - left.tail,
  (left, right) => left.inner.localeCompare(right.inner),
];
const orderedBy = (criteria) => (left, right) =>
  criteria.reduce((verdict, compare) => verdict || compare(left, right), 0);

// Режимы поиска копий: каждый выбирает итог из упорядоченного списка; неназванное значение работает как "any".
const RELOCATE_MODES = new Map([
  [
    "mounted",
    (copies) => {
      const live = copies.filter((copy) => copy.mounted);
      return live.length > 1 ? { ambiguous: live.map((copy) => copy.inner) } : live[0];
    },
  ],
]);
const takeFirstCopy = (copies) => copies[0];

export function createEntryLocator({ entries, mounts = new Set(), commonHas = async () => null }) {
  const known = new Set();
  for (const entry of entries) known.add(canonical(entry));

  function relocated(standard, exclude = []) {
    const wanted = updateInner(standard);
    const hidden = new Set([wanted, ...exclude.map((item) => updateInner(item))]);
    const fileName = lastSegment(wanted);
    const isOtherPlace = (inner) => !hidden.has(inner);
    const isSameFile = (inner) => lastSegment(inner) === fileName;
    const isNotAddOn = (inner) => !inner.startsWith("dlc_patch/");
    const describe = (inner) => {
      const container = containerOf(inner);
      return { inner, container, mounted: mounts.has(container), tail: sharedTail(inner, wanted) };
    };
    return [...known]
      .filter(isOtherPlace)
      .filter(isSameFile)
      .filter(isNotAddOn)
      .map(describe)
      .sort(orderedBy(COPY_CRITERIA))
      .map(({ inner, container, mounted }) => ({ inner, container, mounted }));
  }

  function firstKnown(alternatives) {
    for (const candidate of alternatives) {
      const inner = updateInner(candidate);
      if (known.has(inner)) return inner;
    }
    return null;
  }

  function find(standard, { alternatives = [], relocate = "none", exclude = [] } = {}) {
    const own = updateInner(standard);
    if (known.has(own)) return { entry: UPDATE_DEVICE + own, how: "standard" };
    const fallback = firstKnown(alternatives);
    if (fallback !== null) return { entry: UPDATE_DEVICE + fallback, how: "alternative" };
    if (relocate === "none") return null;

    const settle = RELOCATE_MODES.get(relocate) ?? takeFirstCopy;
    const outcome = settle(relocated(standard, [...alternatives, ...exclude]));
    if (outcome === undefined) return null;
    if (outcome.ambiguous) return outcome;
    return { entry: UPDATE_DEVICE + outcome.inner, how: "relocated", mounted: outcome.mounted };
  }

  async function dataFile(standard) {
    const own = updateInner(standard);
    if (known.has(own)) return { entry: UPDATE_DEVICE + own, how: "standard" };
    if (!own.startsWith("common/")) return null;
    const rest = own.slice("common/".length);
    // Строгое false — «в common.rpf точно нет»; null и прочее — пусть читает хост.
    if ((await commonHas(rest)) === false) return null;
    return { entry: COMMON_DEVICE + rest, how: "common" };
  }

  return {
    known: true,
    has(entry) {
      return known.has(updateInner(entry));
    },
    mounts,
    relocated,
    find,
    dataFile,
  };
}

async function openWithKeys(file, keys) {
  const keySet = keys ? await keysFromDirectory(keys) : null;
  return openRpfFile(file, { keys: keySet });
}

// Открытие без исключений: { archive } или null, если открыть (или собрать путь) не вышло.
async function tryOpen(open, root, parts, keys) {
  try {
    return { archive: await open(path.join(root, ...parts), keys) };
  } catch {
    return null;
  }
}

const closeQuietly = (archive) => archive.close?.().catch(() => {});

async function readMounts(archive) {
  try {
    return mountedArchives(Buffer.from(await archive.read("content.xml")));
  } catch {
    return new Set();
  }
}

// Папки и вложенные архивы (kind "directory") в опись не идут — только пути файлов.
const SKIPPED_KINDS = new Set(["directory"]);
const isFileEntry = (item) => !SKIPPED_KINDS.has(item.kind);
const pathOfEntry = (item) => item.path;

async function snapshotOf(archive) {
  const entries = archive.entries.filter(isFileEntry).map(pathOfEntry);
  return { entries, mounts: await readMounts(archive) };
}

export async function locateEffectEntries({ gameRoot, keys }, { open = openWithKeys } = {}) {
  if (!gameRoot) return null;

  async function commonHas(inner) {
    const opened = await tryOpen(open, gameRoot, ["common.rpf"], keys);
    if (opened === null) return null;
    const { archive: common } = opened;
    return Promise.resolve()
      .then(() => common.entries.some((item) => canonical(item.path) === inner))
      .catch(() => null)
      .finally(() => closeQuietly(common));
  }

  const opened = await tryOpen(open, gameRoot, ["update", "update.rpf"], keys);
  if (opened === null) return null;
  const { archive } = opened;
  const { entries, mounts } = await snapshotOf(archive).finally(() => closeQuietly(archive));
  return createEntryLocator({ entries, mounts, commonHas });
}

export function missingEntry(entry) {
  return explainForeignArchive(new Error("Archive entry was not found: " + entry));
}

export function coreReadEntry(locator) {
  const [main, hi, lo] = CORE_ARCHIVES.map((archive) => coreEntry(archive));
  if (!locator) return { entry: main, how: "standard" };
  const direct = locator.find(main, { relocate: "mounted", exclude: [hi, lo] });
  return direct && !direct.ambiguous ? direct : locator.find(main, { alternatives: [hi, lo], relocate: "any" });
}

function foreignRefusal(message) {
  return Object.assign(new Error(message), { code: FOREIGN_CODE });
}

// Куда писать ядро одного качества: найденная запись или отказ словами.
function writeTargetFor(locator, standard, everyCore) {
  const found = locator.find(standard, { relocate: "mounted", exclude: everyCore });
  const lead = `Архив игры переделан другой сборкой: в update.rpf нет штатного ${updateInner(standard)}`;
  if (found && found.ambiguous) {
    throw foreignRefusal(
      `${lead}, а ядро эффектов лежит в нескольких подключённых архивах (${found.ambiguous.join(", ")}) — ` +
        `какое из них читает игра, не понять, и ${CONSEQUENCE}`,
    );
  }
  if (found) return found;
  const copies = locator.relocated(standard, everyCore);
  if (copies.length === 0) throw missingEntry(standard);
  const places = copies.map((copy) => copy.container || copy.inner).join(", ");
  throw foreignRefusal(
    `${lead}, а его копия лежит в ${places}, который игра не подключает (его нет в content.xml update.rpf), — ` +
      `запись туда в игре ничего не изменит, и ${CONSEQUENCE}`,
  );
}

export function coreWriteEntries(locator) {
  if (!locator) {
    return CORE_ARCHIVES.map((archive) => ({ archive, entry: coreEntry(archive), how: "standard" }));
  }
  const everyCore = CORE_ARCHIVES.map((archive) => coreEntry(archive));
  const resolved = CORE_ARCHIVES.map((archive) => ({
    archive,
    ...writeTargetFor(locator, coreEntry(archive), everyCore),
  }));
  // Одна копия на несколько качеств пишется один раз — под первым из них.
  return resolved.filter((target, at) => resolved.findIndex((other) => other.entry === target.entry) === at);
}

export function donorReadEntry(locator, item) {
  const standard = UPDATE_DEVICE + item.entry;
  if (!locator) return { entry: standard, how: "standard" };
  return locator.find(standard, {
    alternatives: (item.alternatives || []).map((entry) => UPDATE_DEVICE + entry),
    relocate: "any",
  });
}

export async function dataReadEntry(locator, standard) {
  if (!locator) return { entry: standard, how: "standard" };
  return locator.dataFile(standard);
}

export function isUnreadableEntry(error) {
  const text = error?.message ?? error ?? "";
  return String(text).toLowerCase().includes(STALE_HOST_PHRASE);
}

// Устройство записи → файл игры и путь внутри него (пустая приставка — запасной вариант).
const ARCHIVE_DEVICES = [
  {
    prefix: COMMON_DEVICE,
    file: ["common.rpf"],
    innerOf: (wanted) => wanted.slice(COMMON_DEVICE.length).replace(/^\/+/, ""),
  },
  { prefix: "", file: ["update", "update.rpf"], innerOf: (wanted) => updateInner(wanted) },
];

function placeOf(gameRoot, entry) {
  const wanted = canonical(entry);
  const device = ARCHIVE_DEVICES.find(({ prefix }) => wanted.startsWith(prefix));
  return { file: path.join(gameRoot, ...device.file), inner: device.innerOf(wanted) };
}

// Сложить байты на диск: сначала папка файла, потом сам файл.
function putOnDisk(output, bytes) {
  return fs.mkdir(path.dirname(output), { recursive: true }).then(() => fs.writeFile(output, bytes));
}

function copyOut(archive, inner, output) {
  return Promise.resolve()
    .then(() => archive.read(inner))
    .then((raw) => Buffer.from(raw))
    .then((bytes) => putOnDisk(output, bytes).then(() => bytes.length));
}

export async function readGameEntry({ gameRoot, keys, entry, output }, { open = openWithKeys } = {}) {
  const { file, inner } = placeOf(gameRoot, entry);
  const archive = await open(file, keys);
  return copyOut(archive, inner, output)
    .then((bytes) => ({ entry, output, bytes }))
    .finally(() => closeQuietly(archive));
}
