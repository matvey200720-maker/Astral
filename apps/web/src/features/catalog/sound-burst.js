/*
 * Очередь выстрелов в списке «Звуки мода» (владелец, 16.11.2026: «не 1 выстрел, а очередь выстрелов, чтобы можно было прослушать
 * звуки орудия»). Модуль без звука и без React: темп ствола, сколько выстрелов слушать и во сколько секунд от начала стартует каждый.
 * Играет очередь проигрыватель окна (`hooks/sound-burst-engine.js`).
 *
 * ТЕМП — НАСТОЯЩИЙ. Выстрелов в минуту у ствола — запись таблицы студии звука (`@modovik/sound-studio`, `weapon-sounds.js`): число снято
 * с `TimeBetweenShots` его weapons.meta, там же магазин. Своих чисел «на глаз» здесь нет. У ствола, которого в таблице студии нет
 * (пистолет, компактная винтовка и т. п.), темп берётся у типового ствола того же вида из той же таблицы — это запасное правило, оно
 * называется в плане (`source: "family"`). Холодное, метательное и звук без ствола — очереди нет, звук играет как раньше.
 *
 * СКОЛЬКО ВЫСТРЕЛОВ. Слушаем первые 1,2 секунды стрельбы в темпе ствола — у автомата это 9–14 выстрелов. Медленный ствол (дробовик,
 * гранатомёт, тяжёлая снайперка) — три выстрела, пока вся очередь укладывается в две с половиной секунды, иначе два. Больше магазина
 * очередь не бывает: двустволка стреляет два раза, тазер один.
 */
import { WEAPONS } from "@modovik/rpf-inspector/weapon-identity";
import { WEAPON_SOUND_MAP, weaponShotInterval } from "@modovik/sound-studio";
import { foldSearchText } from "./search-text.js";

/** Сколько секунд стрельбы слушаем у быстрого ствола. */
export const BURST_WINDOW_SECONDS = 1.2;

const MIN_SHOTS = 2;
const SLOW_SHOTS = 3;
/** Три выстрела медленного ствола — пока от первого до последнего не больше этого. */
const SLOW_SPAN_SECONDS = 2.5;
/** Страховка от битого темпа: больше выстрелов очередь не бывает. */
const MAX_SHOTS = 16;
/** Запас на ошибку дробей: 1,2 / 0,3 должно давать четыре, а не «почти четыре». */
const EPSILON = 1e-6;

/** Тип оружия → типовой ствол из таблицы студии, у которого берётся темп, когда своего числа нет. */
const FAMILY_REFERENCE = Object.freeze({
  pistol: "WEAPON_HEAVYPISTOL",
  smg: "WEAPON_SMG",
  rifle: "WEAPON_CARBINERIFLE",
  shotgun: "WEAPON_PUMPSHOTGUN",
  sniper: "WEAPON_SNIPERRIFLE",
  machinegun: "WEAPON_MG",
  launcher: "WEAPON_GRENADELAUNCHER",
});

/** Стволы, чей вид даёт чужой темп: миниган стреляет в десятки раз чаще гранатомёта, а числа у нас нет — очереди нет. */
const NO_FAMILY_PACE = new Set(["WEAPON_MINIGUN"]);

const isPositive = (value) => Number.isFinite(value) && value > 0;

/**
 * Расписание очереди: `starts` — секунды от начала до старта каждого выстрела, `end` — когда доиграет хвост последнего, `voices` —
 * сколько выстрелов звучит разом в самый плотный момент (звук длиннее такта — следующий выстрел встаёт поверх хвоста предыдущего).
 * Битый или нулевой такт — один выстрел.
 *
 * @param {{interval: number, duration: number, shots: number}} input секунды между выстрелами, длина звука, число выстрелов
 */
export function burstSchedule({ interval, duration, shots }) {
  const step = isPositive(interval) ? interval : 0;
  const wanted = Math.floor(Number(shots));
  const count = step > 0 && wanted >= 1 ? wanted : 1;
  const length = isPositive(duration) ? duration : 0;
  const starts = Array.from({ length: count }, (_, at) => at * step);
  const voices = step > 0 ? Math.min(count, Math.max(1, Math.ceil(length / step - 1e-9))) : 1;
  return { starts, end: starts[count - 1] + length, voices };
}

/**
 * Сколько выстрелов в очереди ствола с таким тактом; `clip` — его магазин, если известен.
 *
 * @param {number} interval секунды между выстрелами
 * @param {number} [clip]
 */
export function burstShotCount(interval, clip) {
  if (!isPositive(interval)) return 1;
  let count = Math.floor(BURST_WINDOW_SECONDS / interval + EPSILON) + 1;
  if (count < SLOW_SHOTS) count = (SLOW_SHOTS - 1) * interval <= SLOW_SPAN_SECONDS + EPSILON ? SLOW_SHOTS : MIN_SHOTS;
  count = Math.min(count, MAX_SHOTS);
  const magazine = Math.floor(Number(clip));
  if (magazine >= 1) count = Math.min(count, magazine);
  return Math.max(1, count);
}

const planFrom = (item, source) => {
  const interval = weaponShotInterval(item);
  /* Магазин — только у ствола, у которого настоящая запись: у запасного правила он чужой. */
  return { interval, shots: burstShotCount(interval, source === "meta" ? item.clip : undefined), rpm: item.rpm, source };
};

const tableItem = (id) => (typeof id === "string" && Object.hasOwn(WEAPON_SOUND_MAP, id) ? WEAPON_SOUND_MAP[id] : null);

/**
 * План очереди ствола: `{ interval, shots, rpm, source }` или `null`, когда очереди нет. `weapon` — ствол игры
 * (`weaponById`: `id`, `family`). `source`: `"meta"` — темп из weapons.meta ствола, `"family"` — запасное правило по виду оружия.
 */
export function burstPlan(weapon) {
  if (!weapon) return null;
  const own = tableItem(weapon.id);
  if (own) return planFrom(own, "meta");
  if (NO_FAMILY_PACE.has(weapon.id)) return null;
  const family = typeof weapon.family === "string" && Object.hasOwn(FAMILY_REFERENCE, weapon.family) ? weapon.family : "";
  const reference = family ? tableItem(FAMILY_REFERENCE[family]) : null;
  return reference ? planFrom(reference, "family") : null;
}

/**
 * План очереди звука, который делят несколько стволов (общий банк игры): темп первого ствола, у которого план есть. Звук один, а
 * стволов названо несколько, и у каждого свой темп; звук называет их в порядке части, и ведущий — первый (в списке «Звуки мода»
 * карточки у каждого ствола своя строка и свой темп). Ни у одного нет плана — `null`.
 *
 * @param {Array<{id: string, family?: string}>} [weapons]
 */
export function burstPlanOfWeapons(weapons) {
  for (const weapon of Array.isArray(weapons) ? weapons : []) {
    const plan = burstPlan(weapon);
    if (plan) return plan;
  }
  return null;
}

/* ------------------------------------------------------------------ ствол по названию звука */

const GUN_BY_ID = new Map(WEAPONS.map((gun) => [gun.id, gun]));

/* Имя → ствол: русское и английское из таблицы стволов, имя студии звука; первое имя из двух одинаковых остаётся за первым стволом. */
const GUN_BY_NAME = new Map();
const nameGun = (name, gun) => {
  const key = foldSearchText(name);
  if (key && !GUN_BY_NAME.has(key)) GUN_BY_NAME.set(key, gun);
};
for (const gun of WEAPONS) {
  nameGun(gun.name, gun);
  nameGun(gun.catalog, gun);
}
for (const item of Object.values(WEAPON_SOUND_MAP)) if (GUN_BY_ID.has(item.id)) nameGun(item.title, GUN_BY_ID.get(item.id));

/* «Ствол — выстрел»: тире с пробелами; хвост — что за звук. Выстрелом считается хвост на любом из языков окна или его отсутствие. */
const TITLE_DASH = /\s+[—–-]\s+/;
const SHOT_WORD = /^(выстрел|постріл|shot|schuss|strza|tir)/;

const shotTail = (title) => {
  const [, ...rest] = String(title || "").split(TITLE_DASH);
  const tail = foldSearchText(rest.join(" "));
  return !tail || SHOT_WORD.test(tail);
};

/**
 * Стволы, которые называет название звука: «Карабинная винтовка + Карабинная винтовка MK2 — выстрел» → оба по порядку. Имя — точное
 * (регистр и «ё» не важны), русское или английское. Хвост не «выстрел» (перезарядка, эхо) или имена не найдены — пусто.
 *
 * @param {string} [title]
 */
export function weaponsOfTitle(title) {
  if (!shotTail(title)) return [];
  const [names] = String(title || "").split(TITLE_DASH);
  return names
    .split("+")
    .map((name) => GUN_BY_NAME.get(foldSearchText(name)))
    .filter(Boolean);
}

/**
 * План очереди звука, пришедшего записью `{ title, url }` (страница мода, публикация, карточка каталога): ствол — из названия звука, а
 * не названо — из `weaponIds` части, если он один (у нескольких неизвестно, чей это звук). Звук, который не выстрел, и ствол без плана —
 * `null`: играет один выстрел, как раньше.
 *
 * @param {{title?: string, weaponIds?: string[]}} [input]
 */
export function soundBurst({ title, weaponIds } = {}) {
  const named = weaponsOfTitle(title);
  if (named.length) return burstPlanOfWeapons(named);
  if (!shotTail(title)) return null;
  const ids = [...new Set((Array.isArray(weaponIds) ? weaponIds : []).filter((id) => typeof id === "string").map((id) => id.toUpperCase()))];
  const gun = ids.length === 1 ? GUN_BY_ID.get(ids[0]) : null;
  return gun ? burstPlan(gun) : null;
}
