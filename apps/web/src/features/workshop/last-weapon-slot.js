/*
 * Последний ствол мастерской оружия (ТЗ 06.10.2026, вечер, задача 2):
 * вкладка «Оружие» открывает мастерскую сразу на нём, а в первый раз — на
 * карабине. Помнится между запусками; хранилище недоступно — карабин.
 */

const KEY = "astral.gun-studio.last-slot.v1";
export const DEFAULT_WEAPON_SLOT = "carbine-rifle";

export function lastWeaponSlot(known = null, storage = globalThis.localStorage) {
  try {
    const value = String(storage?.getItem(KEY) || "");
    if (value && (!known || known(value))) return value;
  } catch {
    /* хранилище закрыто — карабин */
  }
  return DEFAULT_WEAPON_SLOT;
}

export function rememberWeaponSlot(slot, storage = globalThis.localStorage) {
  try {
    if (slot) storage?.setItem(KEY, String(slot));
  } catch {
    /* не запомнилось — в следующий раз откроется карабин */
  }
}
