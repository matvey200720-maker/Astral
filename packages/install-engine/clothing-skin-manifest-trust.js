import { createHash } from "node:crypto";

export const LOCAL_CLOTHING_SKIN_TRUST = Symbol("local-clothing-skin-package");
export const CLOTHING_SKIN_DLC_TARGET = "update/x64/dlcpacks/astral_clothing/dlc.rpf";
export const CLOTHING_SKIN_CAPABILITIES = Object.freeze(["direct-clothing-dlc-v1", "rpf-container-entry-v1"]);
export const CLOTHING_SKIN_FOLDERS = Object.freeze([
  "mp_m_freemode_01",
  "mp_m_freemode_01_p",
  "mp_m_freemode_01_male_freemode_mplts",
]);

const STREAM_ARCHIVE = "astral_stream_00.rpf";
const MIN_FILE_BYTES = 16;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_VARIANT = 999;

const TEXTURE_FILE = /^((?:p_)?[a-z]{3,5})_diff_([0-9]{3})_[a-z](?:_[a-z]{1,8})?\.ytd$/;
const COMPONENT = /^(?:p_)?[a-z]{3,5}$/;
const PACKAGE_ID = /^local-clothing-skin-([0-9a-f]{12})$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

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
  "clothingSkin",
  "files",
];
const SKIN_KEYS = ["schemaVersion", "component", "variant", "sourceDigest"];
const FILE_KEYS = ["source", "target", "action", "entry", "size", "sha256"];

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

function hasExactKeys(value, names) {
  const wanted = new Set(names);
  const own = Object.keys(value);
  return own.length === wanted.size && own.every((key) => wanted.has(key));
}

// Сравнение «по записи JSON»: регистр и состав важны, форма значения — нет.
function sameJson(actual, expected) {
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

export function clothingSkinEntry(entry) {
  const [archive, folder, file, ...deeper] = String(entry || "").split("/");
  if (archive !== STREAM_ARCHIVE || deeper.length > 0 || !CLOTHING_SKIN_FOLDERS.includes(folder)) {
    return null;
  }
  const parts = TEXTURE_FILE.exec(file);
  return parts ? { folder, component: parts[1], variant: Number(parts[2]) } : null;
}

export function clothingSkinSlot(component, variant) {
  return `clothing-male-${component}-${String(variant).padStart(3, "0")}`;
}

export function clothingSkinSourceDigest(files) {
  const lines = files.map((file) => `${file.entry}\n${file.sha256}`).sort();
  const hash = createHash("sha256");
  // Дыры разреженного набора уходят в конец и дают пустые строки на своих местах, как при склейке через «\n».
  for (let index = 0; index < lines.length; index += 1) {
    hash.update(`${index === 0 ? "" : "\n"}${lines[index] ?? ""}`, "utf8");
  }
  return hash.digest("hex");
}

// Проверки идут по порядку и лениво: первая неудача останавливает перебор.
function* manifestFindings(manifest, edition) {
  yield String(edition || "").toLowerCase() === "legacy";
  yield isPlainObject(manifest) && hasExactKeys(manifest, MANIFEST_KEYS);

  const skin = manifest.clothingSkin;
  yield isPlainObject(skin) && hasExactKeys(skin, SKIN_KEYS);
  yield skin.schemaVersion === 1;
  yield typeof skin.component === "string" && COMPONENT.test(skin.component);
  yield Number.isInteger(skin.variant) && skin.variant >= 0 && skin.variant <= MAX_VARIANT;

  const idParts = typeof manifest.id === "string" ? PACKAGE_ID.exec(manifest.id) : null;
  yield idParts !== null;
  const suffix = idParts[1];
  yield manifest.version === `1.0.0-${suffix}`;
  yield typeof manifest.name === "string" && manifest.name.trim() !== "" && manifest.name.length <= MAX_NAME_LENGTH;

  yield sameJson(manifest.editions, ["Legacy"]);
  yield manifest.scope === "game-root";
  yield manifest.adapter === "rpf-entry";
  yield manifest.requiresLoader === false;
  yield manifest.gameplayChanges === false;
  yield sameJson(manifest.capabilities, CLOTHING_SKIN_CAPABILITIES);
  yield sameJson(manifest.slots, [clothingSkinSlot(skin.component, skin.variant)]);

  const { files } = manifest;
  yield Array.isArray(files) && files.length === 1;
  const [file] = files;
  yield isPlainObject(file) && hasExactKeys(file, FILE_KEYS);
  yield file.target === CLOTHING_SKIN_DLC_TARGET;
  yield file.action === "import";

  const parsed = clothingSkinEntry(file.entry);
  yield parsed !== null && parsed.component === skin.component && parsed.variant === skin.variant;
  // Строковый метод вызывается без проверки типа: запись-массив даёт TypeError, как у прежнего кода.
  yield file.source === `payload/${file.entry.split("/").pop()}`;
  yield Number.isInteger(file.size) && file.size >= MIN_FILE_BYTES && file.size <= MAX_FILE_BYTES;
  yield SHA256_HEX.test(file.sha256);

  const digest = clothingSkinSourceDigest(files);
  yield skin.sourceDigest === `sha256:${digest}`;
  yield suffix === digest.slice(0, 12);
}

export function isLocalClothingSkinManifest(manifest, edition) {
  for (const passed of manifestFindings(manifest, edition)) {
    if (!passed) {
      return false;
    }
  }
  return true;
}
