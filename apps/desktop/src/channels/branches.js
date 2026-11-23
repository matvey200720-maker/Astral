import fs from "node:fs";
import path from "node:path";

const FALLBACK_BRANCH = "beta";
const PROGRAMS_FOLDER = "Programs";
const PARENT = "..";
const EXECUTABLE_SEGMENTS = ["app", "Astral.exe"];
const MANIFEST_SEGMENTS = ["beta", "manifest.json"];
// Поля манифеста, которые переживают разбор, в порядке выдачи после channel.
const MANIFEST_EXTRAS = ["version", "build", "sequence"];

const meta = (product, folder, uninstallKey) => Object.freeze({ product, folder, uninstallKey });

// Обычный объект на всю жизнь модуля: поиск по имени из прототипа обязан находить встроенное.
export const BRANCH_META = Object.freeze({
  release: meta("Astral", "Astral", "Astral"),
  beta: meta("Astral Beta", "Astral Beta", "AstralBeta"),
  alpha: meta("Astral Alpha", "Astral Alpha", "AstralAlpha"),
});

export const BRANCHES = Object.freeze(Object.keys(BRANCH_META));

export const SHARED_USER_DATA_NAME = "Astral";
export const LEGACY_BETA_USER_DATA_NAME = "Astral Beta";

const metaOf = (channel) => BRANCH_META[channel] || BRANCH_META[FALLBACK_BRANCH];

// Первый непустой ответ из цепочки источников; источники зовутся лениво.
function firstAnswer(probes) {
  for (const probe of probes) {
    const answer = probe();
    if (answer) return answer;
  }
  return null;
}

export function isBranch(value) {
  return BRANCHES.some((name) => name === value);
}

export function productNameFor(channel) {
  return metaOf(channel).product;
}

export function installRootOf(executablePath) {
  return path.resolve(path.dirname(executablePath), PARENT);
}

export function programsDirectory(localAppData) {
  return path.join(localAppData, PROGRAMS_FOLDER);
}

export function branchRoot(localAppData, channel) {
  return path.join(programsDirectory(localAppData), metaOf(channel).folder);
}

export function sharedUserDataPath(appData) {
  return path.join(appData, SHARED_USER_DATA_NAME);
}

export function branchByFolder(root) {
  // Windows не различает регистр имён папок.
  const wanted = path.basename(root).toLowerCase();
  return BRANCHES.find((name) => BRANCH_META[name].folder.toLowerCase() === wanted) ?? null;
}

function parseManifestFile(root, fsImpl) {
  try {
    const file = path.join(root, ...MANIFEST_SEGMENTS);
    return JSON.parse(fsImpl.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

const isManifestDocument = (value) => (
  typeof value === "object" && value !== null && isBranch(value.channel)
);

export function readBranchManifest(root, fsImpl = fs) {
  const document = parseManifestFile(root, fsImpl);
  if (!isManifestDocument(document)) return null;
  const extras = MANIFEST_EXTRAS
    .filter((key) => document[key] !== undefined)
    .map((key) => [key, document[key]]);
  return Object.fromEntries([["channel", document.channel], ...extras]);
}

export function readOwnBranch({ executablePath = process.execPath, fsImpl = fs } = {}) {
  const root = installRootOf(executablePath);
  return firstAnswer([
    () => branchByFolder(root),
    () => readBranchManifest(root, fsImpl)?.channel,
    () => FALLBACK_BRANCH,
  ]);
}

const textOrNull = (value) => (typeof value === "string" ? value : null);
const labelOrNull = (value) => (value == null ? null : String(value));
const integerOrNull = (value) => (Number.isSafeInteger(value) ? value : null);

// Запись об установке ветки или null, если исполняемого файла на месте нет.
function describeInstall(channel, localAppData, fsImpl) {
  const root = branchRoot(localAppData, channel);
  const executablePath = path.join(root, ...EXECUTABLE_SEGMENTS);
  const present = fsImpl.existsSync(executablePath);
  if (!present) return null;
  const details = readBranchManifest(root, fsImpl) ?? {};
  return {
    channel,
    root,
    executablePath,
    version: textOrNull(details.version),
    build: labelOrNull(details.build),
    sequence: integerOrNull(details.sequence),
  };
}

export function discoverInstalls({ localAppData, fsImpl = fs } = {}) {
  if (!localAppData) return [];
  const describe = (channel) => describeInstall(channel, localAppData, fsImpl);
  return BRANCHES.map(describe).filter(Boolean);
}

// Результат неудачного переименования: текст сообщения, а без него — сама ошибка строкой.
function describeFailure(failure) {
  const message = failure?.message;
  return String(message ? message : failure);
}

function attemptRename(fsImpl, from, to) {
  try {
    fsImpl.renameSync(from, to);
  } catch (failure) {
    return { moved: false, reason: "failed", error: describeFailure(failure) };
  }
  return { moved: true, reason: "moved" };
}

export function migrateLegacyUserData({ appData, fsImpl = fs } = {}) {
  const places = {
    legacy: path.join(appData, LEGACY_BETA_USER_DATA_NAME),
    shared: sharedUserDataPath(appData),
  };
  const exists = (target) => fsImpl.existsSync(target);
  // Предусловия проверяются по порядку: прежняя папка, затем общая.
  const refusals = [
    [() => !exists(places.legacy), "no-legacy"],
    [() => exists(places.shared), "shared-exists"],
  ];
  const refusal = refusals.find(([blocked]) => blocked());
  if (refusal) return { moved: false, reason: refusal[1] };
  return attemptRename(fsImpl, places.legacy, places.shared);
}
