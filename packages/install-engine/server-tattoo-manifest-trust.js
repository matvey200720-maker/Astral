import { createHash } from "node:crypto";
import { CLOTHING_SKIN_CAPABILITIES, CLOTHING_SKIN_DLC_TARGET } from "./clothing-skin-manifest-trust.js";

export const LOCAL_SERVER_TATTOO_TRUST = Symbol("local-server-tattoo-package");
export const SERVER_TATTOO_CAPABILITIES = CLOTHING_SKIN_CAPABILITIES;
export const SERVER_TATTOO_DLC_TARGET = CLOTHING_SKIN_DLC_TARGET;

const MIN_FILE_BYTES = 16;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_NAME = 160;
const ID_PREFIX = "local-server-tattoo-";
const SUFFIX_LENGTH = 12;

// Имя словаря: 1–64 знака; чужие виды (ствол, расцветка одежды) отсеиваются по началу имени.
const TXD_SHAPE = /^[a-z0-9][a-z0-9_]{0,63}$/;
const FOREIGN_TXD = /^(?:w_|(?:p_)?[a-z]{3,6}_(?:diff|norm|normal|spec)_[0-9]{3})/;
const TATTOO_LABEL = /^[A-Za-z0-9_.:-]{1,96}$/;
// У коллекции без nameHash имени нет: построитель пишет "", и такой пакет свой.
const COLLECTION_LABEL = /^[A-Za-z0-9_.:-]{0,96}$/;
const PACKAGE_ID = /^local-server-tattoo-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

// Порядок ключей манифеста на диске; по этим же спискам проверяется набор ключей.
const MANIFEST_KEYS = [
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "serverTattoo",
  "files",
];
const TATTOO_KEYS = ["schemaVersion", "collection", "name", "txd", "digest"];
const FILE_KEYS = ["source", "target", "action", "entry", "size", "sha256"];

// Неизменные поля любого манифеста тату.
const FIXED_FIELDS = Object.freeze({
  editions: Object.freeze(["Legacy"]),
  scope: "game-root",
  adapter: "rpf-entry",
  requiresLoader: false,
  gameplayChanges: false,
});

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

// Расставляет значения по списку ключей: порядок ключей берётся из списка, недостающие остаются undefined.
const arrange = (keys, values) => Object.fromEntries(keys.map((key) => [key, values[key]]));

function sameJson(actual, expected) {
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

const TXD_REFUSALS = [(name) => !TXD_SHAPE.test(name), (name) => FOREIGN_TXD.test(name)];

export function serverTattooTxd(value) {
  const name = String(value || "").toLowerCase();
  return TXD_REFUSALS.some((refuses) => refuses(name)) ? null : name;
}

export const serverTattooSlot = (txd) => `server-tattoo-${txd}`;

export const serverTattooEntry = (txd) => `astral_stream_00.rpf/${txd}.ytd`;

export function serverTattooDigest({ entry, sha256 }) {
  return createHash("sha256").update(`${entry}\n${sha256}`, "utf8").digest("hex");
}

export function serverTattooManifest({ tattoo, title, file }) {
  const txd = serverTattooTxd(tattoo?.txd);
  if (txd === null) {
    throw new Error("У тату нет годного имени словаря.");
  }
  const record = arrange(FILE_KEYS, {
    source: `payload/${txd}.ytd`,
    target: SERVER_TATTOO_DLC_TARGET,
    action: "import",
    entry: serverTattooEntry(txd),
    size: file.size,
    sha256: file.sha256,
  });
  const digest = serverTattooDigest(record);
  const stamp = digest.slice(0, SUFFIX_LENGTH);

  return arrange(MANIFEST_KEYS, {
    ...FIXED_FIELDS,
    editions: [...FIXED_FIELDS.editions],
    id: `${ID_PREFIX}${stamp}`,
    version: `1.0.0-${stamp}`,
    name: String(title || tattoo.name || txd).slice(0, MAX_PACKAGE_NAME),
    capabilities: [...SERVER_TATTOO_CAPABILITIES],
    slots: [serverTattooSlot(txd)],
    serverTattoo: arrange(TATTOO_KEYS, {
      schemaVersion: 1,
      collection: String(tattoo.collection || ""),
      name: String(tattoo.name || ""),
      txd,
      digest: `sha256:${digest}`,
    }),
    files: [record],
  });
}

// Узел подходит, если набор его ключей точно совпал со списком и каждое правило довольно значением.
function matchesRules(node, keyList, rules, root) {
  if (!isPlainObject(node)) {
    return false;
  }
  const present = new Set(Object.keys(node));
  if (present.size !== keyList.length || !keyList.every((key) => present.has(key))) {
    return false;
  }
  return Object.keys(rules).every((key) => rules[key](node[key], root));
}

const TATTOO_RULES = {
  schemaVersion: (value) => value === 1,
  collection: (value) => COLLECTION_LABEL.test(value),
  name: (value) => TATTOO_LABEL.test(value),
  txd: (value) => typeof value === "string" && serverTattooTxd(value) === value,
  // Отпечаток сверяется ниже, когда известен единственный файл пакета.
  digest: () => true,
};

const fileRules = (txd) => ({
  source: (value) => value === `payload/${txd}.ytd`,
  target: (value) => value === SERVER_TATTOO_DLC_TARGET,
  action: (value) => value === "import",
  entry: (value) => value === serverTattooEntry(txd),
  size: (value) => Number.isInteger(value) && value >= MIN_FILE_BYTES && value <= MAX_FILE_BYTES,
  sha256: (value) => SHA256_HEX.test(value),
});

// Порядок правил важен: сначала serverTattoo (из него берётся txd), потом всё, что на него ссылается.
const MANIFEST_RULES = {
  serverTattoo: (value) => matchesRules(value, TATTOO_KEYS, TATTOO_RULES),
  files: (value, root) =>
    Array.isArray(value) &&
    value.length === 1 &&
    matchesRules(value[0], FILE_KEYS, fileRules(root.serverTattoo.txd)),
  id: (value) => typeof value === "string" && PACKAGE_ID.test(value),
  version: (value, root) => value === `1.0.0-${root.id.slice(ID_PREFIX.length)}`,
  name: (value) => typeof value === "string" && value.trim() !== "" && value.length <= MAX_PACKAGE_NAME,
  editions: (value) => sameJson(value, FIXED_FIELDS.editions),
  scope: (value) => value === FIXED_FIELDS.scope,
  adapter: (value) => value === FIXED_FIELDS.adapter,
  requiresLoader: (value) => value === FIXED_FIELDS.requiresLoader,
  gameplayChanges: (value) => value === FIXED_FIELDS.gameplayChanges,
  capabilities: (value) => sameJson(value, SERVER_TATTOO_CAPABILITIES),
  slots: (value, root) => sameJson(value, [serverTattooSlot(root.serverTattoo.txd)]),
};

export function isLocalServerTattooManifest(manifest, edition) {
  if (String(edition || "").toLowerCase() !== "legacy") {
    return false;
  }
  if (!matchesRules(manifest, MANIFEST_KEYS, MANIFEST_RULES, manifest)) {
    return false;
  }
  const digest = serverTattooDigest(manifest.files[0]);
  return (
    manifest.serverTattoo.digest === `sha256:${digest}` &&
    manifest.id === `${ID_PREFIX}${digest.slice(0, SUFFIX_LENGTH)}`
  );
}
