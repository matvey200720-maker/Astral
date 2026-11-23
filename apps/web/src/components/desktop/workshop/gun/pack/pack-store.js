/*
 * Какие стволы в ганпаке человека. Покраска каждого — в его черновике (`gun-drafts.js`), здесь только порядок: список — это и порядок раскладки на экране «Ганпак».
 * Кадры покраски для экрана лежат в хранилище картинок мастерской под своим началом ключа: уборка снимков `gun:` их не трогает (`gun-asset-gc.js`), а хватает их на замену при следующей правке.
 */

import { deleteWorkshopAsset, getWorkshopAsset, listWorkshopAssetKeys, putWorkshopAsset } from "../../workshop-assets.js";

const KEY = "astral.gun-pack.v1";
const PAINT_KEY = "astral.gun-pack-paint.v1";
const RESET_KEY = "astral.gun-pack-reset.v1";
/* Пак не бывает пустым с порога: карабин уже в кадре, и видно, как устроен экран (владелец, 02.11.2026). */
export const STARTER_SLOT = "carbine-rifle";

function readJson(key, fallback, storage) {
  try {
    const value = JSON.parse(storage?.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value, storage) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище закрыто — список проживёт до закрытия окна */
  }
}

export function readPackSlots(known = null, storage = globalThis.localStorage) {
  const value = readJson(KEY, null, storage);
  const slots = Array.isArray(value?.slots) ? value.slots.map(String) : [];
  const kept = [...new Set(slots)].filter((slot) => slot && (!known || known(slot)));
  return kept.length || (known && !known(STARTER_SLOT)) ? kept : [STARTER_SLOT];
}

export const writePackSlots = (slots, storage = globalThis.localStorage) => writeJson(KEY, { slots }, storage);

/**
 * Откатанные стволы: «ствол → ключи памяти установки», чей скин снимет следующая установка ганпака. Откат ничего не трогает в игре сам — он только помнит, что человек вернул ствол к стандартному.
 * Метку гасит правка этого ствола (студия) и снятие скина (установка пака).
 */
export function readPackResets(storage = globalThis.localStorage) {
  const value = readJson(RESET_KEY, {}, storage);
  const out = {};
  for (const [slot, keys] of Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})) {
    const list = Array.isArray(keys) ? [...new Set(keys.map(String).filter(Boolean))] : [];
    if (slot && list.length) out[slot] = list;
  }
  return out;
}

export function markPackReset(slot, keys, storage = globalThis.localStorage) {
  const list = [...new Set((keys || []).map(String).filter(Boolean))];
  if (!slot || !list.length) return;
  writeJson(RESET_KEY, { ...readPackResets(storage), [slot]: list }, storage);
}

export function clearPackReset(slot, storage = globalThis.localStorage) {
  const all = readPackResets(storage);
  if (!(slot in all)) return;
  delete all[slot];
  writeJson(RESET_KEY, all, storage);
}

/* FNV-1a: подпись считается при входе на экран и после правки, поэтому без зависимостей и без асинхронности. */
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/* Подпись черновика: покраска на экране годна, пока он тот же. Черновик весит килобайты. */
export function projectStamp(project) {
  return hashText(JSON.stringify({ ...project, name: "", updatedAt: "", createdAt: "" }));
}

/**
 * Подпись того, что видно на холстах деталей: слои, наклейки, потёртость, отделённые куски развёртки, свой скин модели. Правка без этого (обвес, размер, название) кадр покраски не меняет —
 * его не снимают заново, а переписывают на нём только подпись черновика (`restampPackPaint`).
 */
export function paintStamp(project) {
  return hashText(
    JSON.stringify([(project.materials || []).map((material) => [material.name, material.layers]), project.stickers || [], project.wear || null, project.detached || null, project.skinOff === true]),
  );
}

const paintPrefix = (slot) => `gun-pack:${slot}:`;
const paintKey = (slot, material) => `${paintPrefix(slot)}${encodeURIComponent(material)}`;

async function dropPaintFiles(slot) {
  for (const key of await listWorkshopAssetKeys(paintPrefix(slot))) await deleteWorkshopAsset(key).catch(() => {});
}

/** Кадры покраски ствола: `paint` — `Map<деталь, холст>`, снятые со студии вместе с наклейками; `stamp` — подпись черновика, с которого их сняли. */
export async function savePackPaint(slot, stamp, paint, storage = globalThis.localStorage) {
  const all = readJson(PAINT_KEY, {}, storage);
  await dropPaintFiles(slot);
  const materials = [];
  for (const [material, canvas] of paint) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob) continue;
    await putWorkshopAsset(paintKey(slot, material), blob);
    materials.push(material);
  }
  writeJson(PAINT_KEY, { ...all, [slot]: { stamp, materials } }, storage);
}

/** Кадры покраски ствола, если они сняты с этого же черновика: `Map<деталь, ImageBitmap>`, иначе `null`. */
export async function readPackPaint(slot, stamp, storage = globalThis.localStorage) {
  const record = readJson(PAINT_KEY, {}, storage)[slot];
  if (!record || record.stamp !== stamp) return null;
  const out = new Map();
  for (const material of record.materials || []) {
    const blob = await getWorkshopAsset(paintKey(slot, material)).catch(() => null);
    /* Кадра нет — пусть покраску соберёт черновик: неполный набор показал бы деталь голой. */
    if (!blob) return null;
    out.set(material, await createImageBitmap(blob, { colorSpaceConversion: "none" }));
  }
  return out;
}

/** Те же кадры, другой черновик: правка не тронула холсты, и записанный кадр остаётся годным — меняется только подпись, без перекодирования. */
export function restampPackPaint(slot, stamp, storage = globalThis.localStorage) {
  const all = readJson(PAINT_KEY, {}, storage);
  if (!all[slot]) return false;
  writeJson(PAINT_KEY, { ...all, [slot]: { ...all[slot], stamp } }, storage);
  return true;
}

export async function forgetPackPaint(slot, storage = globalThis.localStorage) {
  const all = readJson(PAINT_KEY, {}, storage);
  if (slot in all) {
    delete all[slot];
    writeJson(PAINT_KEY, all, storage);
  }
  await dropPaintFiles(slot);
}
