import { weaponByShelf } from "@modovik/rpf-inspector/weapon-identity";

// Слота нет или у него есть свой кадр в поставке: иконка из игры не нужна.
const needsNoGameIcon = (slot) => !slot || Boolean(slot.image);

// Имя ствола в игре для слота полки; неизвестный слот даёт undefined.
const gameNameOf = (slot) => weaponByShelf(slot.id)?.id;

export function shelfWeaponIcon(icons, slot) {
  if (needsNoGameIcon(slot)) return "";
  const gameName = gameNameOf(slot);
  return icons?.get(gameName) || "";
}
