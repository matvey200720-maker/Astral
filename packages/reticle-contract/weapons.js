/*
 * Прицел на каждый ствол (задача 4 ТЗ 07.10.2026).
 *
 * КАК ИГРА ВЫБИРАЕТ ПРИЦЕЛ. У ствола в weapons.meta есть поле
 * `<ReticuleStyleHash>` — имя стиля: WEAPON_PISTOL, WEAPONTYPE_RIFLE… Игра
 * передаёт его хеш в hud_reticle.gfx (`SET_RETICLE_TYPE`), и класс
 * HUD_RETICLE по нему выбирает кадр; незнакомый хеш он ведёт как пистолет.
 * Стилей у игры два десятка, и у всех винтовок он один — поэтому раньше
 * прицел был один на класс, а по сути один на всё.
 *
 * СВОЙ СТИЛЬ НА СТВОЛ. Ствол со своим прицелом получает имя
 * `ASTRAL_RETICLE_<номер>__<штатный стиль>`, а hud_reticle.gfx узнаёт его
 * хеш: ведёт ствол как штатный стиль (тот же кадр, та же логика игры —
 * разброс, захват цели, затухание) и показывает рисунок под этим номером.
 * Одинаковые прицелы у разных стволов — один номер.
 *
 * Штатный стиль записан в самом имени — как донор в имени клона вспышки
 * (`muzzleDonorOf`): вернуть стволу штатный прицел можно по одному файлу
 * игры, без журнала прошлой установки.
 *
 * ОПТИКА — НЕ СТВОЛА. Сетку снайперки игра берёт у насадки
 * (`COMPONENT_AT_SCOPE_LARGE` / `_MAX` в weaponcomponents.meta, поле
 * ReticuleHash `SNIPER_LARGE` / `SNIPER_MAX`), а насадка одна на несколько
 * стволов. Поэтому свой рисунок на ствол бывает у обычного прицела, а
 * оптика остаётся одной на все снайперки.
 */

import { normalizeOrdinaryReticle } from "./config.js";

export const ASTRAL_RETICLE_PREFIX = "ASTRAL_RETICLE_";

/** Сколько стволов могут иметь свой прицел — больше в игре и нет. */
export const MAX_WEAPON_RETICLES = 64;

/*
 * Стили, кадры которых рисует обычный прицел (`ORDINARY_LABELS` компилятора):
 * имя стиля в weapons.meta и метка кадра в hud_reticle.gfx у них совпадают.
 * Свой рисунок встаёт только стволу с таким штатным стилем — у гранатомёта,
 * РПГ и техники свои кадры, и чужой рисунок там не показать.
 */
export const ORDINARY_RETICLE_STYLES = Object.freeze([
  "WEAPON_PISTOL",
  "WEAPONTYPE_SMG",
  "WEAPONTYPE_RIFLE",
  "WEAPONTYPE_SHOTGUN",
  "WEAPON_THROWN",
  "SIMPLE_RETICLE",
  "SIMPLE_MP_RETICLE",
]);
const ordinaryStyles = new Set(ORDINARY_RETICLE_STYLES);

export const isOrdinaryReticleStyle = (name) =>
  ordinaryStyles.has(String(name || "").toUpperCase());

const WEAPON_ID = /^WEAPON_[A-Z0-9_]{1,60}$/;
export const isReticleWeaponId = (id) => WEAPON_ID.test(String(id || ""));

const STYLE_NAME =
  /^ASTRAL_RETICLE_(\d{1,3})__([A-Z0-9_]{1,40}?)(?:__(WEAPON_[A-Z0-9_]{1,60}))?$/i;

/**
 * Имя стиля ствола: номер рисунка и штатный стиль, к которому он привязан.
 *
 * Счётчик урона (30.10.2026) различает стволы по хешу, а один рисунок и один
 * стиль делят одно имя. Поэтому при включённом счётчике в имени стоит ещё и сам
 * ствол (`weapon`), а номер 0 значит «рисунка своего нет, общий прицел».
 */
export function reticleStyleName(slot, original, weapon = null) {
  const number = Number(slot);
  const style = String(original || "").toUpperCase();
  const lowest = weapon ? 0 : 1;
  if (!Number.isInteger(number) || number < lowest || number > MAX_WEAPON_RETICLES)
    throw new RangeError(`Номер прицела ${slot} вне ${lowest}…${MAX_WEAPON_RETICLES}.`);
  if (!ordinaryStyles.has(style))
    throw new Error(`Стиль ${original} — не обычный прицел.`);
  const name = `${ASTRAL_RETICLE_PREFIX}${number}__${style}`;
  return weapon ? `${name}__${String(weapon).toUpperCase()}` : name;
}

/** `{ slot, original, weapon }` из имени стиля Astral, иначе `null`. */
export function parseReticleStyleName(name) {
  const match = STYLE_NAME.exec(String(name || "").trim());
  if (!match) return null;
  const original = match[2].toUpperCase();
  return ordinaryStyles.has(original)
    ? { slot: Number(match[1]), original, weapon: match[3]?.toUpperCase() || null }
    : null;
}

export const isAstralReticleStyle = (name) =>
  String(name || "")
    .trim()
    .toUpperCase()
    .startsWith(ASTRAL_RETICLE_PREFIX);

/**
 * Хеш имени стиля так, как его видит ActionScript прицела: joaat строчного
 * имени — числом со знаком (константы класса HUD_RETICLE лежат так же).
 */
export function reticleStyleHash(name) {
  let hash = 0;
  const lower = String(name).toLowerCase();
  for (let index = 0; index < lower.length; index += 1) {
    hash = (hash + (lower.charCodeAt(index) & 0xff)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash | 0;
}

/**
 * Свои прицелы стволов в границах контракта: `{ WEAPON_X: настройки }`.
 * Неизвестные имена и лишнее сверх предела отбрасываются.
 */
export function normalizeWeaponReticles(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result = {};
  for (const [id, config] of Object.entries(input)) {
    if (Object.keys(result).length >= MAX_WEAPON_RETICLES) break;
    if (!isReticleWeaponId(id)) continue;
    if (!config || typeof config !== "object" || Array.isArray(config))
      continue;
    result[id] = normalizeOrdinaryReticle(config);
  }
  return result;
}

/**
 * Свои прицелы, которые уйдут в игру (задача 12 ТЗ 10.10.2026): все, что
 * есть, — переключателя «Один на всё / На каждый ствол» больше нет, свой
 * прицел ствола появляется первой правкой этого ствола. Исключение — работы
 * прежнего режима «Один на всё» (`perWeapon: false`): их прицелы стволов
 * спали и в игру не шли, и с новым редактором они не просыпаются сами.
 */
export function activeWeaponReticles(module) {
  if (!module || module.perWeapon === false) return {};
  return normalizeWeaponReticles(module.weapons);
}

/**
 * Номера рисунков: одинаковые прицелы разных стволов — один номер, по
 * порядку первого появления. `slots[0]` — рисунок номер 1.
 */
export function weaponReticleSlots(weapons) {
  const slots = [];
  const keys = new Map();
  const slotOf = new Map();
  for (const [id, config] of Object.entries(weapons || {})) {
    const normalized = normalizeOrdinaryReticle(config);
    const key = JSON.stringify(normalized);
    if (!keys.has(key)) {
      slots.push(normalized);
      keys.set(key, slots.length);
    }
    slotOf.set(id, keys.get(key));
  }
  return { slots, slotOf };
}
