/*
 * Как стволы называют игроки.
 *
 * В Discord-каналах сборок и в постах авторов стволы зовут не «Тяжёлая
 * снайперская винтовка», а «хевик», не «Тяжёлый дробовик», а «сайга».
 * Человек ищет «хевик» — и должен найти его и в студии, и в каталоге. Поэтому
 * у каждого ствола, у которого есть устойчивое прозвище, оно записано здесь
 * рядом с игровым идентификатором из таблицы оружия.
 *
 * Прозвища — только проверенные: их используют посты ганпаков GTA5RP и
 * Majestic и форумы (gtawrld.com, forum.gta5rp.com). Выдуманный перевод хуже
 * пустого поля: он учит человека несуществующему слову.
 */

export const WEAPON_SLANG = Object.freeze({
  WEAPON_HEAVYSNIPER: ["хевик", "хеви снайпер"],
  WEAPON_HEAVYSNIPER_MK2: ["хевик мк2"],
  WEAPON_HEAVYSHOTGUN: ["сайга"],
  WEAPON_SPECIALCARBINE: ["спешл", "спешик"],
  WEAPON_SPECIALCARBINE_MK2: ["спешл мк2"],
  WEAPON_CARBINERIFLE: ["карабин"],
  WEAPON_CARBINERIFLE_MK2: ["карабин мк2"],
  WEAPON_REVOLVER: ["ревик", "револьвер"],
  WEAPON_REVOLVER_MK2: ["ревик мк2"],
  WEAPON_COMBATPDW: ["пдв"],
  WEAPON_GUSENBERG: ["ппшка", "томпсон"],
  WEAPON_PISTOL50: ["дигл"],
  WEAPON_PUMPSHOTGUN: ["помпа"],
  WEAPON_MARKSMANRIFLE: ["марксман"],
  WEAPON_COMPACTRIFLE: ["компакт"],
  WEAPON_MICROSMG: ["микро", "узи"],
  WEAPON_ASSAULTRIFLE: ["калаш"],
  WEAPON_MINISMG: ["скорпион"],
  WEAPON_MACHINEPISTOL: ["тек"],
  WEAPON_SAWNOFFSHOTGUN: ["обрез"],
  WEAPON_HEAVYPISTOL: ["хеви пистол"],
});

/** Прозвища ствола по идентификатору из weapons.meta. */
export const slangFor = (weaponId) =>
  WEAPON_SLANG[String(weaponId || "").toUpperCase()] || [];

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

/**
 * Подходит ли ствол под поиск: по имени, модели, подразделу каталога и
 * прозвищу. «хевик», «heavy sniper», «w_sr_heavysniper» находят одно.
 */
export function weaponMatches(weapon, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const haystack = [
    weapon?.name,
    weapon?.model,
    weapon?.subcategory,
    ...(weapon?.slang || slangFor(weapon?.weaponId)),
  ]
    .map(normalize)
    .join(" | ");
  return needle
    .split(" ")
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
