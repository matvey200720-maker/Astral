/*
 * Строки «Компонентов» пака звуков — по строке на каждое оружие (владелец, 25.10.2026: у пака звуков в «Компонентах» часть на каждый
 * ствол — значок или модель ствола, «Carbine Rifle», «Установить» и карандаш в наш редактор звука).
 *
 * Разбор делит звук по банкам игры, а не по стволам: карабин и карабин MK2 играют один банк, и пак публикует их ОДНОЙ частью
 * (`domain.sound.weapons` — оба). Ставится и правится такая часть целиком, поэтому строк у неё столько же, сколько стволов, а
 * «Установить» у них общее и стоит в одном состоянии; под именем — с кем ствол делит звук. Карандаш у строки открывает студию звука
 * на ЕГО стволе (`openSoundInWorkshop`, `weapon`).
 *
 * Модуль без React: картинку и модель ствола берёт из набора мастерской (слот стволов того же места на полке), имя — по-русски
 * (переводит окно: `tr`).
 */
import { workshopWeaponSlots } from "../../catalog-taxonomy.js";
import { labelThumb } from "./catalog-shelves.js";

const SLOT_BY_ID = new Map(workshopWeaponSlots.map((slot) => [slot.id, slot]));

/** Картинка ствола из нашего набора: кадр слота мастерской, а нет — силуэт подписи полки; иначе пусто. */
export function weaponPicture(weapon) {
  if (!weapon) return "";
  return SLOT_BY_ID.get(weapon.shelf)?.image || labelThumb(weapon.catalog) || "";
}

/** 3D-модель ствола из нашего набора (та же, что в мастерской оружия) или пусто. */
export function weaponModel(weapon) {
  return (weapon && SLOT_BY_ID.get(weapon.shelf)?.model) || "";
}

/**
 * Строки списка: `[{ key, part, row, weapon, others, first }]` по порядку пака. `items` — `packContents` пака звуков
 * (`{ mod, sound: { weapons, sound } }`); `weapon` — ствол игры (`weaponById`) или `null`, если звук ни за каким стволом
 * не закреплён (строка всё равно есть — звук можно поставить и послушать); `others` — остальные стволы этой части;
 * `first` — первая строка части (на неё встаёт подсветка найденного поиском звука).
 */
export function soundWeaponRows(items = []) {
  const rows = [];
  for (const item of items) {
    const row = item?.sound;
    if (!item?.mod || !row) continue;
    const weapons = row.weapons.length ? row.weapons : [null];
    weapons.forEach((weapon, index) =>
      rows.push({
        key: `${item.mod.id}:${weapon?.id || index}`,
        part: item.mod,
        row,
        weapon,
        others: weapons.filter((other) => other && other !== weapon),
        first: index === 0,
      }),
    );
  }
  return rows;
}

/** Сколько разных стволов в паке — по строкам. */
export const soundWeaponCount = (rows) =>
  new Set(rows.map((row) => row.weapon?.id).filter(Boolean)).size;
