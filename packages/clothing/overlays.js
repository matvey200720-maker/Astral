// Наложения педа (тату): узнавание словаря по пути, пол по имени, рисунок на коже и кадр обложки.

import { isClothingPath } from "./names.js";
import { shrink } from "./pictures.js";
import { TATTOO_SKIN } from "./shot-request.js";

const DICTIONARY_EXT = ".ytd";
const TXD_NAME_LIMIT = 64;
const WEAPON_PREFIX = "w_";
const OVERLAY_PREFIXES = ["mp_", "fm_"];
const TATTOO_MARKS = ["tat_", "tattoo_"];
const OVERLAY_CONTAINERS = ["_overlays.rpf", "ped_mp_overlay_txds.rpf"];
const LEAF_SHARE = 0.66;
const BACKDROP = [11, 11, 11, 255];
const OPAQUE = 255;

const isNameChar = (char) =>
  (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "_";

function isTxdName(name) {
  return name.length >= 1 && name.length <= TXD_NAME_LIMIT && [...name].every(isNameChar);
}

// «mp_»/«fm_» и хотя бы один знак после.
function overlayPrefixed(name) {
  return OVERLAY_PREFIXES.some((prefix) => name.startsWith(prefix)) && name.length > 3;
}

// После приставки где-нибудь стоит «tat_» или «tattoo_», а за ним есть хоть один знак.
function tattooNamed(name) {
  if (!overlayPrefixed(name)) return false;
  for (let at = 3; at < name.length; at += 1) {
    if (TATTOO_MARKS.some((mark) => name.startsWith(mark, at) && name.length > at + mark.length)) {
      return true;
    }
  }
  return false;
}

function insideOverlayContainer(folders) {
  return folders.some((folder) => {
    const lower = folder.toLowerCase();
    return OVERLAY_CONTAINERS.some((tail) => lower.endsWith(tail));
  });
}

// Шаги узнавания по порядку: первый отказ решает, проверки дальше не идут.
const DISQUALIFIERS = [
  ({ txd }) => !isTxdName(txd),
  ({ txd }) => txd.startsWith(WEAPON_PREFIX),
  ({ text }) => isClothingPath(text),
];

// Любой из признаков делает словарь наложением.
const OVERLAY_SIGNS = [
  ({ txd }) => tattooNamed(txd),
  ({ folders }) => insideOverlayContainer(folders),
  ({ txd, tattooPost }) => Boolean(tattooPost) && overlayPrefixed(txd),
];

function describePath(path) {
  const text = String(path || "").replaceAll("\\", "/");
  const folders = text.split("/");
  const file = folders.pop().toLowerCase();
  return { text, folders, file };
}

export function overlayOfPath(path, { tattooPost = false } = {}) {
  const { text, folders, file } = describePath(path);
  if (!file.endsWith(DICTIONARY_EXT)) return null;

  const facts = { text, folders, txd: file.slice(0, -DICTIONARY_EXT.length), tattooPost };
  if (DISQUALIFIERS.some((rejects) => rejects(facts))) return null;
  return OVERLAY_SIGNS.some((sign) => sign(facts)) ? { txd: facts.txd, path: text } : null;
}

// Пол по имени: отдельная часть «f»/«m» или текст «_female»/«_male»; женское важнее.
const GENDER_MARKS = [
  { gender: "female", part: "f", text: "_female" },
  { gender: "male", part: "m", text: "_male" },
];

export function overlayGender(txd) {
  const name = String(txd || "").toLowerCase();
  const parts = name.split("_");
  const found = GENDER_MARKS.find(({ part, text }) => parts.includes(part) || name.includes(text));
  return found ? found.gender : null;
}

// Канал итога по номеру байта: альфа всегда непрозрачна, цвет смешан с кожей по альфе своей точки.
function skinChannel(rgba, index) {
  const channel = index % 4;
  if (channel === 3) return OPAQUE;
  const alpha = rgba[index - channel + 3] / 255;
  return Math.round(rgba[index] * alpha + TATTOO_SKIN[channel] * (1 - alpha));
}

export function overlayOnSkin(picture) {
  const { width, height, rgba } = picture;
  const out = new Uint8Array(width * height * 4).map((_, index) => skinChannel(rgba, index));
  return { width, height, rgba: out };
}

// Пары «точка кадра ← точка листа» построчно, без обрезки краёв: выход за строку
// переносит точку на соседнюю, выход за массив отбрасывается при записи.
function* leafPlacements(leaf, frameWidth, left, top) {
  for (let y = 0; y < leaf.height; y += 1) {
    for (let x = 0; x < leaf.width; x += 1) {
      yield [((top + y) * frameWidth + left + x) * 4, (y * leaf.width + x) * 4];
    }
  }
}

export function overlayCover(picture, { width = 1200, height = 675 } = {}) {
  const leaf = shrink(overlayOnSkin(picture), Math.round(height * LEAF_SHARE));
  const frame = new Uint8Array(width * height * 4).map((_, index) => BACKDROP[index % 4]);

  const left = Math.round((width - leaf.width) / 2);
  const top = Math.round((height - leaf.height) / 2);
  for (const [target, source] of leafPlacements(leaf, width, left, top)) {
    for (let channel = 0; channel < 4; channel += 1) {
      frame[target + channel] = leaf.rgba[source + channel];
    }
  }
  return { width, height, rgba: frame };
}
