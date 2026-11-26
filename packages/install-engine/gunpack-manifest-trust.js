import { createHash } from "node:crypto";
import {
  WEAPON_SKIN_CAPABILITIES,
  WEAPON_SKIN_DLC_TARGET,
  WEAPON_SKIN_MODEL,
} from "./weapon-skin-manifest-trust.js";

export const LOCAL_GUNPACK_TRUST = Symbol("local-gunpack-package");
export const GUNPACK_DLC_TARGET = WEAPON_SKIN_DLC_TARGET;
export const GUNPACK_CAPABILITIES = WEAPON_SKIN_CAPABILITIES;
export const GUNPACK_MODEL = WEAPON_SKIN_MODEL;

const WEAPONS_ARCHIVE = "astral_stream.rpf";
const MIN_FILE_BYTES = 16;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MODELS = 160;
const MAX_FILES = 400;
const MAX_NAME_LENGTH = 120;

const MODEL_EXTENSION = /\.(?:ydr|ytd)$/;
const AFTER_MODEL = /[_+0-9]/;
const WEAPON_FILE = /^w_[a-z]{2}_[a-z0-9_+]{1,80}\.(?:ydr|ytd)$/;
const PACKAGE_ID = /^local-gunpack-([0-9a-f]{12})$/;
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
  "gunpack",
  "files",
];
const PACK_KEYS = ["schemaVersion", "models", "sourceDigest"];
const FILE_KEYS = ["source", "target", "action", "entry", "size", "sha256"];

// Прототип здесь не проверяется: годится любой объект, не массив.
const isObjectRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isCountedList = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max;

const isOwnEnumerable = (value, name) => Object.prototype.propertyIsEnumerable.call(value, name);

function hasExactKeys(value, names) {
  return Object.keys(value).length === names.length && names.every((name) => isOwnEnumerable(value, name));
}

function sameJson(actual, expected) {
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

// Кандидат не приводится к строке: равенство строгое, startsWith приводит сам, длина — у самого кандидата
// (у не-строки она undefined, и хвостом считается всё имя с первого знака).
function stemBelongsTo(stem, model) {
  return stem === model || (stem.startsWith(model) && AFTER_MODEL.test(stem.slice(model.length).charAt(0)));
}

// Имя файла, которое локальный пакет вообще может нести (`w_xx_….ydr|ytd`, строчные, без точек в имени).
export const isGunpackLeaf = (name) => typeof name === "string" && WEAPON_FILE.test(name);

// Обвес (`w_at_…`). В подписанном каталожном пакете ствола обвесы едут без своего слота — слот один, у ствола; локальная копия такого пакета (смена размера,
// `catalog-model-scale.js`) несёт их так же, чтобы слоты и правила замены совпадали с установкой в 100 % (26.11.2026).
export const isGunpackAttachment = (name) => isGunpackLeaf(name) && name.startsWith("w_at_");

// Самая длинная модель из набора, которой принадлежит файл; при равной длине первая.
// Ложная находка ("" или 0) уступает любому следующему подходящему кандидату.
export function gunpackModelOfFile(name, models) {
  const stem = String(name || "").replace(MODEL_EXTENSION, "");
  let owner = null;
  for (const candidate of models) {
    if (stemBelongsTo(stem, candidate) && (!owner || candidate.length > owner.length)) {
      owner = candidate;
    }
  }
  return owner;
}

export function gunpackSourceDigest(files) {
  const lines = files.map((file) => `${file.entry}\n${file.sha256}`).sort();
  const hash = createHash("sha256");
  // entries() обходит и дыры разреженного набора: они дают пустые строки, как при склейке через «\n».
  for (const [index, line] of lines.entries()) {
    const text = line ?? "";
    hash.update(index === 0 ? text : `\n${text}`, "utf8");
  }
  return hash.digest("hex");
}

// Имя файла из записи «astral_stream.rpf/<имя>»; иначе null.
function fileNameInArchive(entry) {
  if (typeof entry !== "string") {
    return null;
  }
  const parts = entry.split("/");
  return parts.length === 2 && parts[0] === WEAPONS_ARCHIVE ? parts[1] : null;
}

// Проверка по стадиям; каждая стадия возвращает булево и накапливает то, что нужно следующим.
class GunpackReview {
  #manifest;
  #models = [];
  #idSuffix = "";

  constructor(manifest) {
    this.#manifest = manifest;
  }

  hasShape() {
    const manifest = this.#manifest;
    if (!isObjectRecord(manifest) || !hasExactKeys(manifest, MANIFEST_KEYS)) {
      return false;
    }
    const pack = manifest.gunpack;
    return isObjectRecord(pack) && hasExactKeys(pack, PACK_KEYS) && pack.schemaVersion === 1;
  }

  hasModels() {
    const { models } = this.#manifest.gunpack;
    if (!isCountedList(models, 1, MAX_MODELS)) {
      return false;
    }
    if (!models.every((model) => typeof model === "string" && GUNPACK_MODEL.test(model))) {
      return false;
    }
    const ascending = [...new Set(models)].sort();
    if (ascending.length !== models.length || models.some((model, index) => model !== ascending[index])) {
      return false;
    }
    this.#models = models;
    return true;
  }

  hasHeader() {
    const manifest = this.#manifest;
    const idParts = typeof manifest.id === "string" ? PACKAGE_ID.exec(manifest.id) : null;
    if (idParts === null) {
      return false;
    }
    this.#idSuffix = idParts[1];
    const { name } = manifest;
    return (
      manifest.version === `1.0.0-${this.#idSuffix}` &&
      typeof name === "string" &&
      name.trim() !== "" &&
      name.length <= MAX_NAME_LENGTH &&
      sameJson(manifest.editions, ["Legacy"]) &&
      manifest.scope === "game-root" &&
      manifest.adapter === "rpf-entry" &&
      manifest.requiresLoader === false &&
      manifest.gameplayChanges === false &&
      sameJson(manifest.capabilities, GUNPACK_CAPABILITIES) &&
      sameJson(
        manifest.slots,
        this.#models.map((model) => `weapon-${model}`),
      )
    );
  }

  // Модель-владелец файла; "" — обвес без своего слота; null, если файл не годится. Занятые имена копятся в claimed.
  #ownerOfFile(file, claimed) {
    if (!isObjectRecord(file) || !hasExactKeys(file, FILE_KEYS)) {
      return null;
    }
    if (file.target !== GUNPACK_DLC_TARGET || file.action !== "import") {
      return null;
    }
    const name = fileNameInArchive(file.entry);
    if (name === null || !WEAPON_FILE.test(name) || claimed.has(name)) {
      return null;
    }
    claimed.add(name);
    const owner = gunpackModelOfFile(name, this.#models) ?? (isGunpackAttachment(name) ? "" : null);
    if (owner === null || file.source !== `payload/${name}`) {
      return null;
    }
    const sizeFits = Number.isInteger(file.size) && file.size >= MIN_FILE_BYTES && file.size <= MAX_FILE_BYTES;
    return sizeFits && SHA256_HEX.test(file.sha256) ? owner : null;
  }

  hasFiles() {
    const { files } = this.#manifest;
    if (!isCountedList(files, 1, MAX_FILES)) {
      return false;
    }
    const claimed = new Set();
    const owners = new Set();
    const everyFileFits = files.every((file) => {
      const owner = this.#ownerOfFile(file, claimed);
      if (owner !== null) {
        owners.add(owner);
      }
      return owner !== null;
    });
    // Модель без единого файла оставила бы пустой слот и убрала бы чужой ствол без замены.
    return everyFileFits && this.#models.every((model) => owners.has(model));
  }

  hasDigest() {
    const digest = gunpackSourceDigest(this.#manifest.files);
    return this.#manifest.gunpack.sourceDigest === `sha256:${digest}` && this.#idSuffix === digest.slice(0, 12);
  }
}

export function isLocalGunpackManifest(manifest, edition) {
  if (String(edition || "").toLowerCase() !== "legacy") {
    return false;
  }
  const review = new GunpackReview(manifest);
  return review.hasShape() && review.hasModels() && review.hasHeader() && review.hasFiles() && review.hasDigest();
}
