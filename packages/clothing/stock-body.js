// Целая фигура для кадра каталога: штатные части из игры, кожа и свои части мода поверх них.

import { clothingDrawable, colourPicture, combinedDrawable } from "./model.js";

const PEDS = "x64v.rpf:models/cdimages/streamedpeds_mp.rpf";
const VALENTINES =
  "update/x64/dlcpacks/mpvalentines2/dlc.rpf:x64/models/cdimages/mpvalentines2_male.rpf/mp_m_freemode_01_mp_m_valentines_02";

export const STOCK_BODY_PARTS = Object.freeze(
  [
    {
      name: "head",
      zone: "hd",
      component: "head",
      model: `${PEDS}/mp_headtargets/head_013_r.ydd`,
      texture: `${PEDS}/mp_headtargets/head_diff_013_a_chi.ytd`,
    },
    {
      name: "torso",
      zone: "up",
      component: "uppr",
      model: `${PEDS}/mp_m_freemode_01/uppr_015_r.ydd`,
      texture: `${PEDS}/mp_m_freemode_01/uppr_diff_015_a_whi.ytd`,
    },
    {
      name: "legs",
      zone: "lo",
      component: "lowr",
      model: `${VALENTINES}/lowr_001_r.ydd`,
      texture: `${VALENTINES}/lowr_diff_001_a_whi.ytd`,
    },
    {
      name: "feet",
      zone: "fe",
      component: "feet",
      model: `${PEDS}/mp_m_freemode_01/feet_005_r.ydd`,
      texture: `${PEDS}/mp_m_freemode_01/feet_diff_005_a_whi.ytd`,
    },
  ].map(Object.freeze),
);

/* Женское тело (11.11.2026): для «Нижнего слоя» женской вещи нужен только торс — те же имена, папка `mp_f_freemode_01`. Голова, ноги и стопы у женского кадра не нужны. */
const FEMALE_PEDS_FOLDER = `${PEDS}/mp_f_freemode_01`;
export const STOCK_BODY_PARTS_FEMALE = Object.freeze(
  [
    {
      name: "torso",
      zone: "up",
      component: "uppr",
      model: `${FEMALE_PEDS_FOLDER}/uppr_015_r.ydd`,
      texture: `${FEMALE_PEDS_FOLDER}/uppr_diff_015_a_whi.ytd`,
    },
  ].map(Object.freeze),
);

const SKIN_NAME = /^mp_fm_skin_([mf])_(hd|up|lo|fe)_([a-z]+)$/i;
const RACE_ORDER = ["whi", "lat", "chi", "pak", "ara", "bla"];
const UNKNOWN_RACE_RANK = 7;
const FEMALE_RANK = 100;

function hasMeshes(drawable) {
  return Boolean(drawable?.meshes?.length);
}

// Отказ обещания — как ответ null; брошенное сразу и не обещание роняют весь вызов.
function readOrNull(game, address) {
  return game.read(address).catch(() => null);
}

// Части по одной: оба чтения части уходят сразу, следующая часть — после ответа на оба.
async function* stockPartBytes(game, parts = STOCK_BODY_PARTS) {
  for (const part of parts) {
    const [model, texture] = await Promise.all(
      [part.model, part.texture].map((address) => readOrNull(game, address)),
    );
    yield { part, model, texture };
  }
}

// Любой сбой разбора — часть выпадает; картинка разбирается, только если словарь прочитан.
function parsedPart({ part, model, texture }, inflateRaw) {
  if (!model) return null;
  try {
    const drawable = clothingDrawable(model, { inflateRaw });
    const picture = texture ? colourPicture(texture, { inflateRaw }) : null;
    if (!hasMeshes(drawable)) return null;
    return { name: part.name, zone: part.zone, component: part.component, drawable, picture };
  } catch {
    return null;
  }
}

export async function readStockBody(game, { inflateRaw, gender = "male" } = {}) {
  const parts = [];
  for await (const bytes of stockPartBytes(game, gender === "female" ? STOCK_BODY_PARTS_FEMALE : STOCK_BODY_PARTS)) {
    const parsed = parsedPart(bytes, inflateRaw);
    if (parsed) parts.push(parsed);
  }
  return parts;
}

function skinRank(gender, race) {
  const place = RACE_ORDER.indexOf(race.toLowerCase());
  const raceRank = place < 0 ? UNKNOWN_RACE_RANK : place + 1;
  return (gender.toLowerCase() === "f" ? FEMALE_RANK : 0) + raceRank;
}

export function skinsOf(overlays = []) {
  const skins = {};
  const ranks = new Map();
  for (const { txd, picture } of overlays) {
    const match = SKIN_NAME.exec(String(txd || ""));
    if (match && picture) {
      const zone = match[2].toLowerCase();
      const rank = skinRank(match[1], match[3]);
      if (!ranks.has(zone) || rank < ranks.get(zone)) {
        ranks.set(zone, rank);
        skins[zone] = picture;
      }
    }
  }
  return skins;
}

// Правила одевания части по старшинству: своя вещь мода, кожа мода, штатное.
// Источник следующего правила смотрится, только если предыдущее ничего не нашло.
const DRESSING_RULES = [
  {
    find: (part, { items }) =>
      items.find(
        (item) =>
          item.component === part.component && hasMeshes(item.drawable) && item.gender !== "female",
      ),
    mark: (part) => part.component,
    dress: (part, own) => ({ drawable: own.drawable, picture: own.picture || part.picture }),
  },
  {
    find: (part, { skins }) => skins[part.zone],
    mark: (part) => `skin:${part.zone}`,
    dress: (part, skin) => ({ drawable: part.drawable, picture: skin }),
  },
  {
    find: () => true,
    mark: null,
    dress: (part) => ({ drawable: part.drawable, picture: part.picture }),
  },
];

function dressPart(part, sources, used) {
  for (const rule of DRESSING_RULES) {
    const found = rule.find(part, sources);
    if (found) {
      if (rule.mark) used.push(rule.mark(part));
      return { name: part.name, ...rule.dress(part, found) };
    }
  }
  return null; // недостижимо: последнее правило подходит всегда
}

export function bodyShowcase({ stock = [], skins = {}, items = [] } = {}) {
  const used = [];
  const parts = stock.map((part) => dressPart(part, { skins, items }, used));
  return { drawable: combinedDrawable(parts), used };
}

/*
 * Нижний слой (`accs`) на теле (ТЗ владельца 11.11.2026, Т2): у вещи от геометрии одни вставки — полоса на груди и пояс; по отдельности они висят в воздухе, и вещь выглядит «рваной»
 * (снимок 02 — «Amenoma Kageuchi»). В игре слой лежит на торсе под верхней вещью: в кадре — штатный торс игры и на нём слой. Нет торса у разборщика — вещь как есть (прежний показ).
 *
 * @param {{ stock?: Array<{ component: string, drawable: object, picture?: object|null }>, drawable: object, picture?: object|null }} input
 */
export function underlayerShowcase({ stock = [], drawable, picture = null } = {}) {
  if (!hasMeshes(drawable)) return drawable;
  const torso = stock.find((part) => part.component === "uppr" && hasMeshes(part.drawable));
  if (!torso) return drawable;
  return combinedDrawable([
    /* Торс — подложка, а не деталь вещи (`astralBody`): «3D» карточки — основа вещи в мастерской, и красить торс, целиться в него она не должна. */
    { name: "torso", drawable: torso.drawable, picture: torso.picture || null, extras: { astralBody: true } },
    { name: "layer", drawable, picture },
  ]);
}

/** Куски сетки: только треугольники, чей центр прошёл проверку. Вершины остаются как были — меняется список индексов. */
function trianglesWhere(mesh, accept) {
  if (!mesh?.positions || !mesh.indices) return null;
  const { positions, indices } = mesh;
  const kept = [];
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const centre = [0, 1, 2].map((axis) => (positions[indices[at] * 3 + axis] + positions[indices[at + 1] * 3 + axis] + positions[indices[at + 2] * 3 + axis]) / 3);
    if (accept(centre)) kept.push(indices[at], indices[at + 1], indices[at + 2]);
  }
  return kept.length ? { ...mesh, indices: new indices.constructor(kept) } : null;
}

function boundsOf(drawable) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const mesh of drawable.meshes) {
    const { positions, indices } = mesh;
    for (const index of indices)
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], positions[index * 3 + axis]);
        high[axis] = Math.max(high[axis], positions[index * 3 + axis]);
      }
  }
  return { low, high };
}

/*
 * Ногти на руке (ТЗ владельца 11.11.2026, «BlacknailsbyCarti»): у вещи от геометрии одни ногти — чёрные кусочки на концах пальцев; на прозрачном кадре их не видно вовсе (на обложке 0,2 % закрашенных
 * пикселей). В игре они лежат на пальцах, поэтому в кадре — штатная рука игры (кусок торса вокруг ногтей одной кисти) и ногти на ней. Рука и ногти — в одной системе координат: у штатных перчаток и
 * у ногтей общие края по размаху рук. Нет торса у разборщика или рядом с ногтями нет кожи — нижний слой целиком (`underlayerShowcase`).
 *
 * @param {{ stock?: Array<{ component: string, drawable: object, picture?: object|null }>, drawable: object, picture?: object|null, side?: 1|-1, margin?: number }} input
 */
export function handShowcase({ stock = [], drawable, picture = null, side = 1, margin = 0.06 } = {}) {
  if (!hasMeshes(drawable)) return drawable;
  const torso = stock.find((part) => part.component === "uppr" && hasMeshes(part.drawable));
  if (!torso) return drawable;
  const nailMeshes = drawable.meshes.map((mesh) => trianglesWhere(mesh, (centre) => centre[0] * side > 0)).filter(Boolean);
  if (!nailMeshes.length) return underlayerShowcase({ stock, drawable, picture });
  const nails = { ...drawable, meshes: nailMeshes };
  const { low, high } = boundsOf(nails);
  const inside = (centre) => centre.every((value, axis) => value >= low[axis] - margin && value <= high[axis] + margin);
  const skinMeshes = torso.drawable.meshes.map((mesh) => trianglesWhere(mesh, inside)).filter(Boolean);
  if (!skinMeshes.length) return underlayerShowcase({ stock, drawable, picture });
  return combinedDrawable([
    { name: "hand", drawable: { ...torso.drawable, meshes: skinMeshes }, picture: torso.picture || null, extras: { astralBody: true } },
    { name: "layer", drawable: nails, picture },
  ]);
}
