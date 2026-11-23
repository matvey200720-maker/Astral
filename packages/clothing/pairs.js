/*
 * Пары «мужская вещь → женская вещь» из игры игрока (ТЗ владельца 29.10.2026, «скин одежды на женского персонажа», п. 2).
 *
 * Скин мужской вещи едет на женского персонажа картинкой на женскую пару — вещь, которая «та же». Кандидаты — только из самой игры
 * игрока (файлы Rockstar не раздаём), по трём признакам, от точного к приблизительному:
 *   1. тот же ярлык магазина без пола: `CLO_SCM_U_4_0` ↔ `CLO_SCF_U_4_0` (буква пола стоит в конце названия дополнения);
 *   2. то же название в таблице языка (русском или английском), в том же дополнении и виде;
 *   3. тот же номер вещи в том же дополнении — только там, где названия нет хотя бы у одной из двух вещей (базовая игра, патчи):
 *      сверить нечем, остаётся номер, а крой (`shapeCloseness`) подтверждает или отвергает его по самим моделям.
 * Лучший кандидат — по умолчанию (`PAIR_CONFIDENT` и выше — уверенная пара), человек может выбрать другую женскую вещь.
 *
 * Модуль чистый: оглавление игры (`apps/desktop/src/game-clothing-index.js`) на входе, таблица пар на выходе. Пары не зависят от окна и
 * сервера — они кэшируются Desktop по отпечатку игры.
 */

import { BLANK_MODEL_BYTES, itemFolder } from "./game-assortment.js";

export const PAIR_VERSION = 1;
/** С такого счёта пара «уверенная»: ярлык или название совпали. Ниже — номер, пару нужно подтвердить кроем. */
export const PAIR_CONFIDENT = 85;
/** Сколько кандидатов хранится у вещи. */
export const MAX_PAIR_CANDIDATES = 5;

const SCORE = Object.freeze({ label: 100, name: 90, nameEn: 86, number: 30 });
/* Мелкие добавки только упорядочивают равных: число расцветок и близость номера. */
const SAME_TEXTURES = 4;
const SAME_NUMBER = 3;

const LABEL = /^CLO_([A-Z0-9]*?)([MF])_([A-Z]+_\d+_\d+)$/;

/**
 * Ярлык магазина без пола: `CLO_SCM_U_0_0` и `CLO_SCF_U_0_0` → `CLO_SC_U_0_0`. Ярлык другого вида (логотипы банд, пустой) — пусто:
 * по нему пару не найти.
 */
export function pairLabelKey(label) {
  const match = LABEL.exec(String(label || "").trim().toUpperCase());
  return match ? `CLO_${match[1]}_${match[3]}` : "";
}

const fold = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");

/** Ключ вещи игры: вид, папка и номер. По нему окно находит пару мужской вещи (`replaces[].folder` и номер в игре). */
export const pairItemKey = ({ component, folder, drawable }) => `${component}|${String(folder || "").toLowerCase()}|${drawable}`;

const real = (item) => Boolean(item?.model) && item.modelSize >= BLANK_MODEL_BYTES;

const describe = (section, item) => ({
  item,
  folder: String(itemFolder(section, item) || "").toLowerCase(),
  label: pairLabelKey(item.label),
  name: fold(item.name),
  nameEn: fold(item.nameEn),
});

/** Счёт пары и чем она подтверждена; `null` — не пара. */
function score(male, female) {
  const base = { number: male.item.drawable === female.item.drawable };
  if (male.label && male.label === female.label) return { ...base, score: SCORE.label, why: "label" };
  if (male.name && male.name === female.name) return { ...base, score: SCORE.name, why: "name" };
  if (male.nameEn && male.nameEn === female.nameEn) return { ...base, score: SCORE.nameEn, why: "name" };
  /* Названия есть у обеих и разные — это разные вещи, а не та же с другим номером. */
  if (base.number && (!male.name || !female.name)) return { ...base, score: SCORE.number, why: "number" };
  return null;
}

/**
 * Пары одного дополнения: ключ мужской вещи → кандидаты женских (лучший первым). Ничья по названию (у вещи несколько видов с одним
 * именем — заправленная и нет) решается числом расцветок и номером.
 */
export function collectionPairs(collection) {
  const males = (collection?.male?.items || []).filter(real).map((item) => describe(collection.male, item));
  const females = (collection?.female?.items || []).filter(real).map((item) => describe(collection.female, item));
  const out = {};
  for (const male of males) {
    const found = [];
    for (const female of females) {
      if (female.item.component !== male.item.component || Boolean(female.item.prop) !== Boolean(male.item.prop)) continue;
      const verdict = score(male, female);
      if (!verdict) continue;
      const number = verdict.number ? SAME_NUMBER : 0;
      const textures = female.item.textures === male.item.textures ? SAME_TEXTURES : 0;
      found.push({
        folder: female.folder,
        drawable: female.item.drawable,
        textures: female.item.textures,
        score: verdict.score,
        why: verdict.why,
        rank: verdict.score + number + textures,
        near: Math.abs(female.item.drawable - male.item.drawable),
      });
    }
    if (!found.length) continue;
    found.sort((left, right) => right.rank - left.rank || left.near - right.near || left.drawable - right.drawable);
    out[pairItemKey({ component: male.item.component, folder: male.folder, drawable: male.item.drawable })] = found
      .slice(0, MAX_PAIR_CANDIDATES)
      .map(({ rank: _rank, near: _near, ...candidate }) => candidate);
  }
  return out;
}

/**
 * Оглавление игры → таблица пар: `{ version, pairs: { <ключ мужской вещи>: [{ folder, drawable, textures, score, why }] }, stats }`.
 * `stats` — сколько мужских вещей с настоящей моделью и у скольких есть пара (всего, уверенных).
 */
export function buildGamePairs(index) {
  const pairs = {};
  let males = 0;
  for (const collection of index?.collections || []) {
    males += (collection?.male?.items || []).filter(real).length;
    Object.assign(pairs, collectionPairs(collection));
  }
  const keys = Object.keys(pairs);
  return {
    version: PAIR_VERSION,
    pairs,
    stats: { males, paired: keys.length, confident: keys.filter((key) => pairs[key][0].score >= PAIR_CONFIDENT).length },
  };
}

/** Лучшая пара мужской вещи или `null`: `{ folder, drawable, textures, score, why, confident }`. */
export function bestPair(table, item) {
  const [best] = table?.pairs?.[pairItemKey(item)] || [];
  return best ? { ...best, confident: best.score >= PAIR_CONFIDENT } : null;
}

/*
 * Крой по моделям (`garmentShape`): размах (рукава у верха, ширина у низа и обуви) сравнивается с поправкой `FEMALE_REACH`, длина —
 * отношением высот вещей. Поправка снята с пар, которые игра сама называет одной вещью (ярлык и название совпали), на игре 29.10.2026
 * (`scripts/clothing-pair-quality.mjs`): медиана размаха женской модели к мужской — 0,993 у верхов (60 пар) и 1,0 у масок, высота женского верха —
 * 0,927 от мужского. Размах у женских вещей не уже: рукава и ширина рассчитаны на фигуру, а не на мужской размер, поэтому поправка единица.
 */
export const FEMALE_REACH = 1;

const MIN_LENGTH = 0.55;
const MIN_WIDTH = 0.5;
const round = (value) => Math.round(value * 1000) / 1000;
const ratio = (left, right) => (left > 0 && right > 0 ? Math.min(left, right) / Math.max(left, right) : 0);

/**
 * Насколько крой женской вещи подходит к мужской: `{ closeness 0…1, sleeve, hood, length, width, fits }` или `null`, если по одной из
 * моделей судить нечем (пустышка). Рукав и капюшон — только у верха (`null`, где не применимы); `fits` — рукав и капюшон не спорят
 * и вещь в целом похожа.
 */
export function shapeCloseness(male, female) {
  if (!male || !female || male.placeholder || female.placeholder) return null;
  const sleeve = male.sleeve && female.sleeve ? male.sleeve === female.sleeve : null;
  const hood = male.sleeve && female.sleeve ? Boolean(male.hood) === Boolean(female.hood) : null;
  const length = ratio(male.top - male.bottom, female.top - female.bottom);
  const width = ratio(male.reach * FEMALE_REACH, female.reach);
  const parts = [
    [0.3, sleeve === null ? null : Number(sleeve)],
    [0.15, hood === null ? null : Number(hood)],
    [0.3, length],
    [0.25, width],
  ].filter(([, value]) => value !== null);
  const closeness = parts.reduce((sum, [weight, value]) => sum + weight * value, 0) / parts.reduce((sum, [weight]) => sum + weight, 0);
  /* «Подходит»: рукав и капюшон не спорят, вещь в целом похожа и не втрое короче или уже (шорты — не брюки). */
  const fits = sleeve !== false && hood !== false && closeness >= 0.6 && length >= MIN_LENGTH && width >= MIN_WIDTH;
  return { closeness: round(closeness), sleeve, hood, length: round(length), width: round(width), fits };
}

/**
 * Кандидаты, упорядоченные с учётом кроя: `shapes` — `ключ женской вещи (вид, папка, номер) → крой` (нет ключа — крой не известен).
 * Пара по номеру или по одному крою поднимается, если крой сошёлся, и опускается, если нет; пара по ярлыку и названию остаётся на месте —
 * игра сама назвала её одной вещью, крой лишь отмечается в `shape`.
 */
export function rankByShape(candidates, maleShape, shapes = {}, component = "") {
  return candidates
    .map((candidate) => {
      const verdict = shapeCloseness(maleShape, shapes[pairItemKey({ ...candidate, component })]);
      const weak = candidate.score < PAIR_CONFIDENT;
      const adjusted = verdict && weak ? candidate.score + (verdict.fits ? 30 : -30) + 20 * verdict.closeness : candidate.score;
      return { ...candidate, ...(verdict ? { shape: verdict } : {}), adjusted: round(adjusted) };
    })
    .sort((left, right) => right.adjusted - left.adjusted);
}
