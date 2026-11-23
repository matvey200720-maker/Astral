/*
 * Модель бороды: слова из названия или тегов вещи (TASK-targets-5, дополнение владельца 14.11.2026: «на какую хочешь бороду»).
 *
 * Штатные бороды GTA V — наложения на лицо (`facialHair` цирюльника), а не модели: «на штатную бороду» модель не поставить. Модель бороды — вещь проекта в слоте «Маска» (`berd`): ставится
 * вместо маски игры или вместо бороды/маски проекта. По названию это узнаётся, по файлам — нет: у карточки вида `berd` нет признака «борода».
 */

import { BEARD_FLAGS } from "./beard-flags-data.js";

/*
 * Слова. Начало — целым словом: «Трусы», «Бусы» усами не считаются; «усы», «усов», «усики» — целым словом: «Маска усыпанная стразами» бородой не считается (ревью 14.11, №19).
 * «Бородатый», «усатый», «bearded», «mustached», «щетинистый» — описание персонажа, а не борода: маска «Красный бородатый демон» (`halloween` №12 у обоих полов) бородой не считается
 * (15.11.2026); «Бородинский» — тоже (ревью 15.11, №5). В выложенном каталоге (3755 карточек, 15.11.2026) ни одной карточки с этими словами нет — правило строгое и одно на цели и на название карточки.
 */
const START = "(?:^|[^а-яёa-z])";
const MOUSTACHE_WORDS =
  "(?:усы|усов|усами|усах|усик(?:и|ов|ами)?|mustache?s?|moustache?s?)(?![а-яёa-z])";
const BEARD_WORDS =
  "(?:бород(?!ат|инск)|эспаньолк|бакенбард|щетин(?!ист)|beard(?!ed)|goatee|stubble|sideburn)";
const BEARD_ONLY = new RegExp(`${START}${BEARD_WORDS}`, "i");
const MOUSTACHE = new RegExp(`${START}${MOUSTACHE_WORDS}`, "i");

/** Называет ли хоть одно из слов бороду или усы. */
export const looksLikeBeard = (...names) =>
  names
    .flat()
    .some(
      (name) =>
        BEARD_ONLY.test(String(name || "")) ||
        MOUSTACHE.test(String(name || "")),
    );

/** Коллекция вещи — папка без префикса персонажа: `mp_m_freemode_01_mp_m_gta5rp_skins2` → `mp_m_gta5rp_skins2`. */
export const collectionOfFolder = (folder) =>
  String(folder || "")
    .toLowerCase()
    .replace(/^mp_[mf]_freemode_01_/, "");

/**
 * Признак бороды вещи проекта из данных разбора (`beard-flags-data.js`): `beard` | `moustache` | `none` | `null` — в данных вещи нет. `flags` — таблицы (подмена в тестах).
 * Коллекция — `item.collection` вещи окна (`assortmentItem`), иначе из папки.
 */
export const beardFlagOf = (item, flags = BEARD_FLAGS) =>
  flags?.[item?.server]?.[
    `${item?.gender}|${item?.collection || collectionOfFolder(item?.folder)}|${item?.drawable}`
  ] || null;

/**
 * Что за вещь: `beard` (борода), `moustache` (усы) или `null` (не борода, маска). Признак берётся из ДАННЫХ разбора по паре «коллекция, номер» (шейдер волос и высота сетки, `beard-flags-data.js`) и перекрывает название
 * (`none` — «не борода»); данных нет — по названию и псевдонимам (`looksLikeBeard`): слова бороды — `beard`, одни усы — `moustache`. Только для вида `berd`: у остальных видов бород нет.
 */
export function beardKindOf(item, flags = BEARD_FLAGS) {
  if (item?.component !== "berd") return null;
  const flag = beardFlagOf(item, flags);
  if (flag) return flag === "none" ? null : flag;
  const names = [item.name, ...(item.aliases || [])].map((name) =>
    String(name || ""),
  );
  if (names.some((name) => BEARD_ONLY.test(name))) return "beard";
  return names.some((name) => MOUSTACHE.test(name)) ? "moustache" : null;
}

/** Борода или усы — вещь окна цели, которую ставят «вместо другой бороды» (`beardKindOf`). Один аргумент: годится в `items.filter(isBeardItem)` (вторым там идёт номер). */
export const isBeardItem = (item) => beardKindOf(item) !== null;
