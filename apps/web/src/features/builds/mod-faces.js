import { coverFor, hasOwnCover, usesMapMedia, usesWeaponMedia } from "../../utils/catalogMedia.js";
import { workshopPreviewFor } from "../../workshop-visuals.js";
import { modPicture } from "../library/mod-picture.js";

const FACES_KEY = "astral.builds.mod-faces.v1";
const FACES_LIMIT = 2000;

const isFilled = (value) => typeof value === "string" && value !== "";

const textOrEmpty = (value) => (typeof value === "string" ? value : "");

// Любой сбой хранилища (нет, бросает при доступе, чтении или записи) превращается в запасное значение.
function attempt(job, fallback) {
  try {
    return job();
  } catch {
    return fallback;
  }
}

export function readModFaces() {
  const parsed = attempt(() => JSON.parse(globalThis.localStorage.getItem(FACES_KEY)), null);
  const plain = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  return plain ? parsed : {};
}

// Раздел: catalogSection, а если он пуст или не строка — category (только строкой).
function sectionOf(mod) {
  return isFilled(mod.catalogSection) ? mod.catalogSection : textOrEmpty(mod.category);
}

// Известный мод: запись есть, это не заготовка загрузки и не пропавший.
function isKnownMod(mod) {
  return Boolean(mod) && !mod.pending && !mod.missing;
}

function isSame(prior, cover, section, slot) {
  return Boolean(prior) && prior.cover === cover && prior.section === section && prior.slot === slot;
}

// Пары «id → фото» только для известных каталогу модов, чьё фото нового или изменилось.
function* changedFaces(ids, modsById, known) {
  for (const id of ids) {
    const mod = modsById.get(id);
    if (!isKnownMod(mod)) continue;
    const cover = hasOwnCover(mod) ? coverFor(mod) : "";
    const section = sectionOf(mod);
    const slot = textOrEmpty(mod.catalogSlot);
    if (!(cover || section || slot) || isSame(known?.[id], cover, section, slot)) continue;
    yield [id, { cover, section, slot }];
  }
}

function keepNewest(record) {
  const pairs = Object.entries(record);
  return pairs.length > FACES_LIMIT ? Object.fromEntries(pairs.slice(-FACES_LIMIT)) : record;
}

export function rememberModFaces(ids, modsById, known = readModFaces()) {
  const fresh = Array.from(changedFaces(ids, modsById, known));
  if (fresh.length === 0) return known;
  const merged = { ...known };
  for (const [id, face] of fresh) merged[id] = face;
  const result = keepNewest(merged);
  attempt(() => globalThis.localStorage.setItem(FACES_KEY, JSON.stringify(result)), undefined);
  return result;
}

function addFace(entry, face) {
  const copy = { ...entry };
  for (const [from, to] of FACE_TO_ENTRY) {
    if (isFilled(face[from])) copy[to] = face[from];
  }
  return copy;
}

export function withRememberedFace(entry, face) {
  return face ? addFace(entry, face) : entry;
}

export function hasModPhoto(mod) {
  return !!modPicture(mod);
}

// Снимок слота мастерской: слот главнее раздела, оба берутся только непустыми строками.
function slotSnapshot(mod) {
  const section = [mod.catalogSection, mod.category].find(isFilled) ?? "";
  const slot = textOrEmpty(mod.catalogSlot);
  return section || slot ? workshopPreviewFor(section, slot) : "";
}

export function modPhoto(mod) {
  return mod ? modPicture(mod) || slotSnapshot(mod) : "";
}

export function modTileLook(mod) {
  const wholeFrame = !!mod && (usesWeaponMedia(mod) || usesMapMedia(mod));
  return { cover: modPhoto(mod), fit: wholeFrame ? "contain" : "auto" };
}

// Поле памяти → поле записи мода; порядок строк — порядок добавленных ключей.
const FACE_TO_ENTRY = [
  ["cover", "cover"],
  ["section", "catalogSection"],
  ["slot", "catalogSlot"],
];
