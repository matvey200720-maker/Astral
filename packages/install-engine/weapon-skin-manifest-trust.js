import { createHash } from "node:crypto";
import { defaultMagazineModel, weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { defaultAttachmentEntries } from "@modovik/rpf-inspector/weapon-attachments";

export const LOCAL_WEAPON_SKIN_TRUST = Symbol("local-weapon-skin-package");
export const WEAPON_SKIN_DLC_TARGET = "update/x64/dlcpacks/astral_weapons/dlc.rpf";
export const WEAPON_SKIN_CAPABILITIES = Object.freeze(["direct-weapon-dlc-v1", "rpf-container-entry-v1"]);
export const WEAPON_SKIN_MASK_CAPABILITIES = Object.freeze([...WEAPON_SKIN_CAPABILITIES, "rpf-delete-v1"]);
export const WEAPON_SKIN_MODEL = /^w_[a-z]{2}_[a-z0-9_]{1,60}$/;

const ARCHIVE_PREFIX = "astral_stream.rpf/";
const MIN_FILE_BYTES = 16;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_IMPORTS = 16;
const MAX_NAME_LENGTH = 120;

const PACKAGE_ID = /^local-weapon-skin-([0-9a-f]{12})$/;
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
  "weaponSkin",
  "files",
];
const SKIN_KEYS = ["schemaVersion", "model", "sourceDigest"];
const IMPORT_KEYS = ["source", "target", "action", "entry", "size", "sha256"];
const MASK_KEYS = ["target", "action", "entry", "allowMissing"];

const withArchive = (name) => `${ARCHIVE_PREFIX}${name}`;
const uniqueInOrder = (items) => [...new Set(items)];

// Файл штатного магазина: <М>.ydr, <М>+hi.ytd, <М>_hi.ydr и так далее.
function belongsToMagazine(name, magazine) {
  return magazine !== null && [`${magazine}.`, `${magazine}+`, `${magazine}_hi.`].some((start) => name.startsWith(start));
}

export function weaponSkinEntries(model) {
  const magazine = defaultMagazineModel(model);
  const weapon = weaponByModel(model);
  const names = [
    `${model}.ytd`,
    `${model}+hi.ytd`,
    ...(magazine ? [`${magazine}.ytd`, `${magazine}+hi.ytd`] : []),
    `${model}.ydr`,
    `${model}_hi.ydr`,
    ...(magazine ? [`${magazine}.ydr`] : []),
    ...(weapon ? defaultAttachmentEntries(weapon.id) : []),
  ];
  return uniqueInOrder(names.map(withArchive));
}

export function weaponSkinMaskEntries(model, written = []) {
  const skip = new Set(written);
  const magazine = defaultMagazineModel(model);
  const weapon = weaponByModel(model);
  // Общие обвесы (прицел, ствол) могут быть у нескольких стволов: маской снесли бы чужой скин.
  const sharedParts = weapon
    ? defaultAttachmentEntries(weapon.id)
        .filter((name) => !belongsToMagazine(name, magazine))
        .map(withArchive)
    : [];
  const models = [
    `${model}.ydr`,
    `${model}_hi.ydr`,
    ...(magazine ? [`${magazine}.ydr`, `${magazine}_hi.ydr`] : []),
  ].map(withArchive);
  const left = [...models, ...weaponSkinEntries(model)].filter(
    (entry) => !skip.has(entry) && !sharedParts.includes(entry),
  );
  return uniqueInOrder(left);
}

export function weaponSkinSourceDigest(files) {
  // Дыры разреженного набора уходят в конец и дают пустые строки на своих местах, как при склейке через «\n».
  const [first, ...rest] = files.map((file) => `${file.entry}\n${file.sha256}`).sort();
  const hash = createHash("sha256").update(`${first ?? ""}`, "utf8");
  for (const line of rest) {
    hash.update("\n", "utf8").update(`${line ?? ""}`, "utf8");
  }
  return hash.digest("hex");
}

// Прототип манифеста не проверяется: годится любой объект, не массив.
const isObjectRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Набор собственных перечислимых ключей совпадает со списком (сравнение отсортированных списков).
function hasExactKeys(value, names) {
  const own = Object.keys(value).sort();
  const wanted = [...names].sort();
  return own.length === wanted.length && own.every((key, index) => key === wanted[index]);
}

function sameJson(actual, expected) {
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

const isFileSize = (size) => Number.isInteger(size) && size >= MIN_FILE_BYTES && size <= MAX_FILE_BYTES;

// Импорт — всё, что не «delete» строго (в том числе null и записи с другим регистром действия).
const isMaskAction = (file) => file?.action === "delete";

// Проверки по порядку; общий разбор складывается в ctx для следующих.
const GATES = [
  ({ edition }) => String(edition || "").toLowerCase() === "legacy",

  (ctx) => isObjectRecord(ctx.manifest) && hasExactKeys(ctx.manifest, MANIFEST_KEYS),

  (ctx) => {
    const skin = ctx.manifest.weaponSkin;
    if (!isObjectRecord(skin) || !hasExactKeys(skin, SKIN_KEYS) || skin.schemaVersion !== 1) {
      return false;
    }
    ctx.skin = skin;
    ctx.model = skin.model;
    return typeof skin.model === "string" && WEAPON_SKIN_MODEL.test(skin.model);
  },

  (ctx) => {
    const { id, version, name } = ctx.manifest;
    const idParts = typeof id === "string" ? PACKAGE_ID.exec(id) : null;
    if (idParts === null) {
      return false;
    }
    ctx.idSuffix = idParts[1];
    return (
      version === `1.0.0-${ctx.idSuffix}` &&
      typeof name === "string" &&
      name.trim() !== "" &&
      name.length <= MAX_NAME_LENGTH
    );
  },

  ({ manifest, model }) =>
    sameJson(manifest.editions, ["Legacy"]) &&
    manifest.scope === "game-root" &&
    manifest.adapter === "rpf-entry" &&
    manifest.requiresLoader === false &&
    manifest.gameplayChanges === false &&
    sameJson(manifest.slots, [`weapon-${model}`]),

  (ctx) => {
    const { files, capabilities } = ctx.manifest;
    if (!Array.isArray(files)) {
      return false;
    }
    ctx.masks = files.filter(isMaskAction);
    ctx.imports = files.filter((file) => !isMaskAction(file));
    const expected = ctx.masks.length > 0 ? WEAPON_SKIN_MASK_CAPABILITIES : WEAPON_SKIN_CAPABILITIES;
    return sameJson(capabilities, expected) && ctx.imports.length >= 1 && ctx.imports.length <= MAX_IMPORTS;
  },

  ({ imports, model }) => {
    const allowed = new Set(weaponSkinEntries(model));
    const taken = new Set();
    for (const file of imports) {
      if (!isObjectRecord(file) || !hasExactKeys(file, IMPORT_KEYS)) {
        return false;
      }
      const { entry } = file;
      if (file.target !== WEAPON_SKIN_DLC_TARGET || file.action !== "import") {
        return false;
      }
      if (!allowed.has(entry) || taken.has(entry)) {
        return false;
      }
      taken.add(entry);
      if (file.source !== `payload/${entry.slice(ARCHIVE_PREFIX.length)}`) {
        return false;
      }
      if (!isFileSize(file.size) || !SHA256_HEX.test(file.sha256)) {
        return false;
      }
    }
    return true;
  },

  ({ masks, imports, model }) => {
    // Каждую допустимую запись можно замаскировать не больше одного раза.
    const allowed = new Set(weaponSkinMaskEntries(model, imports.map((file) => file.entry)));
    return masks.every(
      (mask) =>
        isObjectRecord(mask) &&
        hasExactKeys(mask, MASK_KEYS) &&
        mask.target === WEAPON_SKIN_DLC_TARGET &&
        mask.allowMissing === true &&
        allowed.delete(mask.entry),
    );
  },

  ({ skin, imports, idSuffix }) => {
    const digest = weaponSkinSourceDigest(imports);
    return skin.sourceDigest === `sha256:${digest}` && idSuffix === digest.slice(0, 12);
  },
];

export function isLocalWeaponSkinManifest(manifest, edition) {
  const ctx = { manifest, edition };
  return GATES.every((gate) => gate(ctx));
}
