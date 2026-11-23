/*
 * Персонаж игрока (3.11.2026, владелец: «в анимациях танцует тот же персонаж, что в мастерской одежды; если я одел и накрасил его и применил в игру — танцует он, в той же одежде»).
 *
 * «Применить» комплекта в мастерской одежды (`installOutfit`) запоминает, что человек поставил в игру: запрос персонажа к Astral Desktop (вещи игры — номерами, вещи каталога — пакетом, тату на теле — отметкой) и
 * его облик (причёска, лицо). Окно «Анимации» читает запись и просит у Desktop того же персонажа, той же сборкой и из того же кэша GLB (`readClothingCharacter`, `CHARACTER_BUILD`): второй копии
 * персонажа нет. Покраску вещей и тату окно берёт из тех же черновиков мастерской (`outfitWorn`, `bakeOutfitDraft`), что и сама мастерская.
 *
 * Записи нет (комплект не применяли) — стандартный персонаж, как в мастерской одежды: тело в белье без вещей.
 */

import { wearLookRequest } from "./wear-character.js";

export const PLAYER_LOOK_KEY = "astral.player.look.v1";

/* Двенадцать слотов одежды с причёской и бородой (14.11.2026): полный комплект ничего не теряет. */
const MAX_OTHERS = 12;
const SLOT = /^[a-z-]{1,40}$/;

/* Запись вещи комплекта — только то, что понимает `outfitOthers` Desktop: вещь игры номером (и расцветкой), вещь каталога — пакетом. */
function cleanOther(item) {
  const slot = String(item?.slot || "");
  if (!SLOT.test(slot) || slot === "tattoos") return null;
  if (item?.manifest && typeof item.manifest === "object") {
    return { slot, manifest: item.manifest, baseUrl: String(item.baseUrl || ""), ...(/^[a-z]$/.test(String(item.colour || "")) ? { colour: String(item.colour) } : {}) };
  }
  const variant = Number(item?.variant);
  if (!Number.isInteger(variant) || variant < 0) return null;
  const texture = Number(item?.texture);
  return { slot, variant, ...(Number.isInteger(texture) && texture >= 0 ? { texture } : {}) };
}

/** Запрос комплекта в чистом виде: `{ others?, tattoos? }`; мусор отброшен. */
export function cleanLookRequest(request) {
  const others = (Array.isArray(request?.others) ? request.others : []).map(cleanOther).filter(Boolean).slice(0, MAX_OTHERS);
  return { ...(others.length ? { others } : {}), ...(request?.tattoos === true ? { tattoos: true } : {}) };
}

/**
 * Запомнить, во что одет персонаж, когда комплект поставили в игру: `request` — то, что вернул `outfitRequest` (`{ others, tattoos }`), `look` — `{ hair, face }` его облика.
 * Пустой комплект (ни вещи, ни тату) — запись снимается: стандартный персонаж.
 */
export function savePlayerLook(storage, { request, look = null, at = Date.now() } = {}) {
  const clean = cleanLookRequest(request);
  if (!storage) return null;
  try {
    if (!clean.others && !clean.tattoos) {
      storage?.removeItem(PLAYER_LOOK_KEY);
      return null;
    }
    /* Пол фигуры (14.11.2026): женская фигура с её вещами — «gender: female»; записи без поля — мужские, как были. */
    const entry = { v: 1, at, request: clean, hair: Number(look?.hair) || 0, face: Number(look?.face) || 0, gender: look?.gender === "female" ? "female" : "male" };
    storage?.setItem(PLAYER_LOOK_KEY, JSON.stringify(entry));
    return entry;
  } catch {
    return null;
  }
}

/** Запомненный персонаж игрока или `null`: комплект не применяли (или запись битая). */
export function readPlayerLook(storage = globalThis.localStorage) {
  try {
    const entry = JSON.parse(storage?.getItem(PLAYER_LOOK_KEY) || "null");
    if (!entry || entry.v !== 1) return null;
    const request = cleanLookRequest(entry.request);
    if (!request.others && !request.tattoos) return null;
    return { request, hair: Number(entry.hair) || 0, face: Number(entry.face) || 0, gender: entry.gender === "female" ? "female" : "male", at: Number(entry.at) || 0 };
  } catch {
    return null;
  }
}

/** Подпись персонажа для кэша окна: вещи (вещь каталога — id и расцветка), тату, причёска и лицо. */
export function lookSignature(look) {
  if (!look) return "standard";
  const items = (look.request.others || []).map((item) => (item.manifest ? `${item.slot}:c:${item.manifest.id}@${item.manifest.version}${item.colour || ""}` : `${item.slot}:${item.variant}${Number.isInteger(item.texture) ? `:t${item.texture}` : ""}`));
  return [...items, look.request.tattoos ? "tattoos" : "", look.gender === "female" ? "female" : "", `${look.hair}:${look.face}`].filter(Boolean).join("|");
}

/**
 * Запрос персонажа окна «Анимации»: стандартный (тело в белье, причёска и лицо — выбор человека в мастерской одежды) или игрока. Сборка и кэш — те же, что у мастерской одежды: слот и «без вещи» — как у её «одеть»,
 * поэтому у стандартного персонажа файл общий. `ahead: false` — соседей по полке Desktop не собирает.
 */
export function characterRequest(gameRoot, look = null) {
  const style = look ? { hair: look.hair, face: look.face } : wearLookRequest("male");
  return {
    gameRoot,
    slot: "tshirts",
    bare: true,
    onModel: true,
    animated: true,
    ahead: false,
    ...(look?.gender === "female" ? { gender: "female" } : {}),
    ...style,
    ...(look?.request || {}),
  };
}

/** Стандартный персонаж — без вещей и тату, с причёской и лицом человека: на нём рисуются плитки (белый манекен). */
export const standardRequest = (gameRoot) => characterRequest(gameRoot, null);

/**
 * Вещи и тату игрока с черновиками покраски — как их просит `paintOutfit` (`outfit-paint.js`): только то, что в записи, с покраской из нынешних черновиков мастерской. Вещь без черновика покраски в список не идёт:
 * на ней рисовать нечего. Читается лениво — холсты мастерской (`gun-canvas.js`) тянутся, только когда у персонажа игрока вообще есть что красить.
 */
export async function lookDrafts(look, storage = globalThis.localStorage) {
  if (!look) return [];
  const [{ outfitWorn }, { readColours, readTextures, readWorn }] = await Promise.all([
    import("../../../components/desktop/workshop/gun/outfit-paint.js"),
    import("../../../components/desktop/workshop/gun/wear/wear-outfit.js"),
  ]);
  const applied = new Map((look.request.others || []).map((item) => [item.slot, item]));
  const worn = outfitWorn("", { worn: readWorn(storage, look.gender), gender: look.gender, colours: readColours(storage), textures: readTextures(storage), storage });
  /* Черновик ложится только на ту вещь, что применили: сменили вещь в слоте после «Применить» — её правки персонажа игры не касаются. */
  const sameItem = (item, one) => (item.itemId ? Boolean(one?.manifest) : Boolean(one) && !one.manifest && one.variant === item.variant);
  return worn.filter((item) => item.project && (item.slot === "tattoos" ? look.request.tattoos === true : sameItem(item, applied.get(item.slot))));
}
