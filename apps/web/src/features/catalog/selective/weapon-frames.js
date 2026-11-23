/*
 * Стволы с кадром в поставке, но без витринной 3D-модели (13.11.2026, «Выборочные»): кадр снят из игры тем же сборщиком, что и
 * кадры полки мастерской (`scripts/build-game-weapon-showcase.mjs --frame-only`, Blender, игра только на чтение), лежит рядом с ними —
 * `public/assets/catalog/weapons/<ствол>.webp`. Модель такого ствола в мастерской по-прежнему из игры игрока, поэтому в полку
 * мастерской (`weaponCatalogSlots`) они не входят: у `workshopWeapon` модель обязательна, а 0,5 МБ GLB на ствол в поставку не едут.
 *
 * Модуль без зависимостей: список читает ленивый экран «Выборочные» и тест, сверяющий список с папкой.
 */
export const FRAME_ONLY_SLOTS = Object.freeze([
  "assault-rifle-mk2",
  "bat",
  "battle-rifle",
  "bullpup-rifle-mk2",
  "combat-mg-mk2",
  "compact-rifle",
  "crowbar",
  "double-action-revolver",
  "flaregun",
  "flashlight",
  "gclub",
  "grenadefrag",
  "hammer",
  "hatchet",
  "heavy-rifle",
  "knife-01",
  "knuckle",
  "machette-lr",
  "machine-pistol",
  "marksman-rifle-mk2",
  "military-rifle",
  "minigun",
  "molotov",
  "musket",
  "nightstick",
  "pistol-smg",
  "precision-rifle",
  "pump-shotgun-mk2",
  "revolver-mk2",
  "sns-pistol-mk2",
  "sns-pistol",
  "vintage-pistol",
  "wrench",
]);

const FRAMED = new Set(FRAME_ONLY_SLOTS);

/** Адрес кадра ствола из этого списка; у остальных пусто (у них кадр — из полки мастерской или иконка игры). */
export const frameOnlyImage = (slot) =>
  FRAMED.has(slot) ? `/assets/catalog/weapons/${slot}.webp?v=catalog-v7` : "";
