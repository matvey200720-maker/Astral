// Опись ганпака: из плоского списка файлов архива — варианты, стволы, обвесы, незнакомые модели.

import { identifyWeaponModel } from "@modovik/rpf-inspector/weapon-identity";
import { attachmentName, describeWeaponSlot } from "@modovik/rpf-inspector";
import { ROLE_ORDER, WEAPON_FILE, fileName, fileRole, modelOfFile } from "./roles.js";
import { slangFor } from "./slang.js";

export const HIDDEN_ATTACHMENT_BYTES = 4096;

const ATTACHMENT_WORDS = [
  "barrel", "supp", "scope", "sight", "sights", "flsh", "flash", "afgrip",
  "grip", "muzzle", "comp", "stock", "rail", "clip", "drum",
];
const ATTACHMENT_TAIL = new RegExp(`_(?:${ATTACHMENT_WORDS.join("|")})(?:_|\\d|$)`);

const DLC_FOLDER = /^(?:patchday\d+[a-z]*|(?:mp|sp)[a-z0-9_]+)$/i;
const ARCHIVE_SEGMENT = /\.rpf$/i;
const SERVICE_FOLDERS = new Set([
  "stream", "streams", "ydr", "ytd", "model", "models", "texture", "textures",
  "weapon", "weapons", "gun", "guns", "file", "files", "x64", "levels", "gta5",
  "cdimages", "dlcpacks", "update", "mods",
]);

const WEAPON_FILE_NAME = /^w_[a-z]{2}_/;
const PACK_EXTENSION = /\.(?:zip|7z|rar|oiv)$/i;
const TEXTURE_PATH = /\.ytd$/i;

const byLocale = (a, b) => a.localeCompare(b);
const sizeOf = (file) => Number(file.size) || 0;
const sumBytes = (entries) => entries.reduce((sum, entry) => sum + entry.size, 0);

export function isAttachmentModel(identity) {
  if (identity.kind === "attachment") return true;
  return identity.kind === "unknown" && ATTACHMENT_TAIL.test(identity.model);
}

export function anchorOf(path) {
  const segments = String(path || "").split("/");
  const archiveAt = segments.findIndex((segment) => ARCHIVE_SEGMENT.test(segment));
  if (archiveAt < 0) {
    const folders = segments.slice(0, -1);
    while (folders.length > 0 && SERVICE_FOLDERS.has(folders.at(-1).toLowerCase())) folders.pop();
    return { anchor: folders.join("/"), dlcpack: null, archive: null };
  }
  const folders = segments.slice(0, archiveAt);
  const dlcpack = folders.length > 0 && DLC_FOLDER.test(folders.at(-1)) ? folders.pop() : null;
  return {
    anchor: folders.join("/"),
    dlcpack,
    archive: segments.slice(0, archiveAt + 1).join("/"),
  };
}

// --- Записи стволов, обвесов и незнакомых моделей.

function weaponFileEntry(file, name, model) {
  const entry = { path: file.path, name, role: fileRole(file.path, model), size: sizeOf(file) };
  if (file.version !== undefined) entry.version = file.version;
  if (file.renamedFrom) entry.renamedFrom = file.renamedFrom;
  return entry;
}

// Сравнение размеров намеренно обычное: строки сравниваются как строки.
function dropCopies(files) {
  const kept = new Map();
  const duplicates = new Set();
  for (const file of files) {
    const name = fileName(file.path);
    const earlier = kept.get(name);
    if (!earlier) {
      kept.set(name, file);
    } else {
      duplicates.add(name);
      if (file.size > earlier.size) kept.set(name, file);
    }
  }
  return { kept, duplicates: [...duplicates] };
}

const roleRank = (role) => ROLE_ORDER.indexOf(role);

function weaponKind(roles) {
  if (roles.includes("model") || roles.includes("model-hi")) return "model";
  const isRetexture = roles.includes("texture") || roles.includes("texture-hi") || roles.includes("camo");
  return isRetexture ? "retexture" : "parts";
}

function weaponRecord(identityModel, files) {
  const slot = describeWeaponSlot(identityModel);
  const { kept, duplicates } = dropCopies(files);
  const entries = [...kept]
    .map(([name, file]) => weaponFileEntry(file, name, slot.model))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || byLocale(a.name, b.name));
  const roles = [...new Set(entries.map((entry) => entry.role))];
  return {
    key: slot.model,
    model: slot.model,
    weaponId: slot.weaponId,
    name: slot.name,
    slang: slangFor(slot.weaponId),
    family: slot.family,
    slot: slot.slot,
    subcategory: slot.subcategory,
    shelf: slot.shelf,
    known: slot.known,
    kind: weaponKind(roles),
    files: entries,
    roles,
    bytes: sumBytes(entries),
    duplicates,
  };
}

function attachmentRecord(model, files) {
  const entries = files
    .map((file) => ({
      path: file.path,
      name: fileName(file.path),
      role: TEXTURE_PATH.test(file.path) ? "texture" : "model",
      size: sizeOf(file),
    }))
    .sort((a, b) => byLocale(a.name, b.name));
  const models = entries.filter((entry) => entry.role === "model");
  return {
    model,
    name: attachmentName(model),
    files: entries,
    bytes: sumBytes(entries),
    hidden: models.length > 0 && models.every((entry) => entry.size <= HIDDEN_ATTACHMENT_BYTES),
  };
}

function unknownRecord(model, files) {
  return { model, files: files.map((file) => fileName(file.path)).sort() };
}

// --- Вариант: файлы раскладываются по полкам, полка собирается в записи.

function shelveFiles(files) {
  const shelves = { weapons: new Map(), attachments: new Map(), unknown: new Map() };
  for (const file of files) {
    const identity = identifyWeaponModel(modelOfFile(file.path));
    let shelf = shelves.weapons;
    if (isAttachmentModel(identity)) shelf = shelves.attachments;
    else if (identity.kind === "unknown") shelf = shelves.unknown;
    const group = shelf.get(identity.model);
    if (group) group.push(file);
    else shelf.set(identity.model, [file]);
  }
  return shelves;
}

const recordsOf = (shelf, makeRecord) => [...shelf].map(([model, files]) => makeRecord(model, files));

function variantLabel(key, name) {
  const lastSegment = key.split("/").filter(Boolean).at(-1);
  // Имя пака нужно только при пустом ключе; не строка там падает TypeError.
  return (lastSegment || name || "").replace(PACK_EXTENSION, "");
}

function buildVariant({ key, files, dlcpacks, archives }, name) {
  const shelves = shelveFiles(files);
  return {
    key,
    label: variantLabel(key, name),
    dlcpacks: [...dlcpacks].sort(),
    archives: [...archives].sort(),
    weapons: recordsOf(shelves.weapons, weaponRecord).sort((a, b) => (
      byLocale(a.family, b.family) || a.name.localeCompare(b.name, "ru")
    )),
    attachments: recordsOf(shelves.attachments, attachmentRecord).sort((a, b) => byLocale(a.model, b.model)),
    unknown: recordsOf(shelves.unknown, unknownRecord).sort((a, b) => byLocale(a.model, b.model)),
    files: files.length,
    bytes: files.reduce((sum, file) => sum + sizeOf(file), 0),
  };
}

const newDraft = (key) => ({ key, files: [], dlcpacks: new Set(), archives: new Set() });

function addToDraft(draft, file, place) {
  draft.files.push(file);
  if (place.dlcpack !== null) draft.dlcpacks.add(place.dlcpack);
  if (place.archive !== null) draft.archives.add(place.archive);
}

// Варианты отдельно, только если какая-то модель лежит сразу в нескольких якорях.
function draftVariants(files) {
  const perAnchor = new Map();
  const whole = newDraft("");
  const anchorsOfModel = new Map();
  let modelInSeveralAnchors = false;

  for (const file of files) {
    const place = anchorOf(file.path);
    if (!perAnchor.has(place.anchor)) perAnchor.set(place.anchor, newDraft(place.anchor));
    addToDraft(perAnchor.get(place.anchor), file, place);
    addToDraft(whole, file, place);

    const model = modelOfFile(file.path);
    const anchors = anchorsOfModel.get(model) ?? new Set();
    anchors.add(place.anchor);
    anchorsOfModel.set(model, anchors);
    if (anchors.size > 1) modelInSeveralAnchors = true;
  }

  if (modelInSeveralAnchors) return [...perAnchor.values()].sort((a, b) => byLocale(a.key, b.key));
  if (files.length === 0) return [];
  if (perAnchor.size === 1) whole.key = [...perAnchor.keys()][0];
  return [whole];
}

export function gunpackInventory(files, { name = "" } = {}) {
  const weaponFiles = (files || []).filter((file) => (
    WEAPON_FILE_NAME.test(fileName(file.path)) && WEAPON_FILE.test(file.path)
  ));
  const variants = draftVariants(weaponFiles).map((draft) => buildVariant(draft, name));
  return {
    variants,
    weaponFiles: weaponFiles.length,
    total: variants.reduce((sum, variant) => sum + variant.weapons.length, 0),
  };
}
