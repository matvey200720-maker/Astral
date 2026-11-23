// Разбор пути файла одежды и обратная сборка игровых имён.

import { COMPONENT_NAMES, PEDS } from "./taxonomy.js";

const PROP_PREFIX = "p_";
const PROP_TAIL = "_p";
const NUMBER_WIDTH = 3;

const PED_NAME = /^(mp_[mf]_freemode_01)(_p)?(?:_(.+))?$/is;
const ARCHIVE_TAIL = ".rpf";
const PASSPORT_TAIL = ".ymt";
const MODEL_NAME = /^([a-z_]+)_(\d{3})(?:_([ur]))?\.ydd$/i;
const TEXTURE_NAME = /^([a-z_]+)_(diff|norm|normal|spec)_(\d{3})(?:_([a-z]))?(?:_([a-z]{3}))?\.ytd$/i;

const COMPONENTS = new Set(COMPONENT_NAMES);
const TEXTURE_KINDS = { diff: "diffuse", norm: "normal", normal: "normal", spec: "specular" };

const FOREIGN_PED_SHAPES = [
  "(?:a|s|g|u|hc)_[mfy]_[a-z0-9]+(?:_\\w+)?",
  "hc_\\w+",
  "csb?_\\w+",
  "ig_\\w+",
  "player_(?:zero|one|two)",
  "mp_[mfs]_(?!freemode_01)\\w+",
];
const FOREIGN_PED = new RegExp(`^(?:${FOREIGN_PED_SHAPES.join("|")})(?:${PROP_TAIL})?$`, "i");

const GENDER_FOLDERS = [
  ["male", /^(?:male|men|man|m|муж\p{L}*)$/iu],
  ["female", /^(?:female|women|woman|f|жен\p{L}*)$/iu],
];

function isPropComponent(component) {
  return component.startsWith(PROP_PREFIX);
}

function genderOfPed(ped) {
  return Object.keys(PEDS).find((gender) => PEDS[gender] === ped) ?? null;
}

function readPedName(name) {
  const match = PED_NAME.exec(name);
  if (!match) return null;
  const ped = match[1].toLowerCase();
  return {
    ped,
    gender: genderOfPed(ped),
    collection: match[3]?.toLowerCase() ?? null,
    prop: Boolean(match[2]),
  };
}

// Папка из «^» ближе всех к файлу, но считается папкой только для поиска педа.
function splitPath(value) {
  if (!value) return null;
  const parts = String(value).replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const last = parts.at(-1);
  const caret = last.lastIndexOf("^");
  const hasCaretFolder = caret > 0;
  return {
    path: parts.join("/"),
    file: hasCaretFolder ? last.slice(caret + 1) : last,
    caretFolder: hasCaretFolder ? last.slice(0, caret) : null,
    folders: parts.slice(0, -1),
  };
}

function findPedFolder({ folders, caretFolder }) {
  const nearestFirst = caretFolder === null ? folders.toReversed() : [caretFolder, ...folders.toReversed()];
  for (const name of nearestFirst) {
    if (!name.toLowerCase().endsWith(ARCHIVE_TAIL)) {
      const ped = readPedName(name);
      if (ped) return { ...ped, folder: name };
    }
  }
  return null;
}

function genderOfFolders(folders) {
  for (const name of folders.toReversed()) {
    const found = GENDER_FOLDERS.find(([, shape]) => shape.test(name));
    if (found) return found[0];
  }
  return null;
}

function readPassport(file) {
  if (!file.toLowerCase().endsWith(PASSPORT_TAIL)) return null;
  const owner = readPedName(file.slice(0, -PASSPORT_TAIL.length));
  if (!owner) return null;
  return {
    ped: owner.ped,
    gender: owner.gender,
    collection: owner.collection,
    role: "meta",
    prop: owner.prop,
  };
}

function readModel(file) {
  const match = MODEL_NAME.exec(file);
  const component = match?.[1].toLowerCase();
  if (!COMPONENTS.has(component)) return null;
  return {
    role: "model",
    component,
    prop: isPropComponent(component),
    drawable: Number(match[2]),
    modelSuffix: match[3]?.toLowerCase() ?? null,
  };
}

function readTexture(file) {
  const match = TEXTURE_NAME.exec(file);
  const component = match?.[1].toLowerCase();
  if (!COMPONENTS.has(component)) return null;
  return {
    role: "texture",
    component,
    prop: isPropComponent(component),
    drawable: Number(match[3]),
    textureKind: TEXTURE_KINDS[match[2].toLowerCase()],
    letter: match[4]?.toLowerCase() ?? "a",
    race: match[5]?.toLowerCase() ?? null,
  };
}

const ROLE_READERS = [readPassport, readModel, readTexture];

export function parseClothingPath(value) {
  const place = splitPath(value);
  if (!place) return null;

  const pedFolder = findPedFolder(place);
  const nearest = place.caretFolder ?? place.folders.at(-1);
  if (!pedFolder && nearest !== undefined && FOREIGN_PED.test(nearest)) return null;

  let details = null;
  for (const read of ROLE_READERS) {
    details ??= read(place.file);
  }
  if (!details) return null;

  const parsed = {
    path: place.path,
    file: place.file,
    folder: pedFolder?.folder ?? null,
    ped: pedFolder?.ped ?? null,
    gender: pedFolder ? pedFolder.gender : genderOfFolders(place.folders),
    collection: pedFolder?.collection ?? null,
    ...details,
  };
  // Игра ищет пропы только в папке «_p», поэтому проп из папки тела переезжает туда.
  if (pedFolder && !pedFolder.prop && details.component && details.prop) {
    parsed.folder = pedFolderName({
      gender: pedFolder.gender,
      prop: true,
      collection: pedFolder.collection,
    });
  }
  return parsed;
}

export function isClothingPath(value) {
  return parseClothingPath(value) !== null;
}

function paddedNumber(drawable) {
  return String(drawable).padStart(NUMBER_WIDTH, "0");
}

export function modelFileName({ component, drawable, modelSuffix }) {
  const tail = isPropComponent(component) ? "" : `_${modelSuffix || "u"}`;
  return `${component}_${paddedNumber(drawable)}${tail}.ydd`;
}

export function textureFileName({ component, drawable, letter, race }) {
  const tail = isPropComponent(component) ? "" : `_${race || "uni"}`;
  return `${component}_diff_${paddedNumber(drawable)}_${letter}${tail}.ytd`;
}

export function pedFolderName({ gender, prop, collection }) {
  const propTail = prop ? PROP_TAIL : "";
  const collectionTail = collection ? `_${collection}` : "";
  return `${PEDS[gender] || PEDS.male}${propTail}${collectionTail}`;
}
