/*
 * «Выборочные» (каталог 2.0): что показывать. Чистые функции без React: из массива модов каталога собираются
 * плитки стволов, скины одного ствола и пак каждого скина.
 *
 * Выборочный мод — скин одного ствола (`catalogCategory: skins`, не ганпак): у него свой слот (`catalogSlot`),
 * своя обложка и свой кадр профиля. Ганпак (пак) перечисляет такие моды в `includedModIds` — по нему скин
 * находит свой пак. Ствол без кадра в поставке получает силуэт, а плитка без модели — запасной знак.
 */
import { workshopWeaponSlots } from "../../../catalog-taxonomy.js";
import { isGunpackMod } from "../../../components/desktop/catalog/catalogSections.js";
import { frameOnlyImage } from "./weapon-frames.js";

/*
 * Выбор «Размер модели» (80–120 % и свой 50–200 %) рисуется, только когда установка скина умеет перешивать модель под размер. Движок
 * перешивки готов в ветке `library-v2` (df40bf1ea, 562b7fc79): каталожный скин и ганпак с `modelScale` перешиваются и ставятся. Выключи флаг,
 * если ветка не едет вместе с этой: размер, который ничего не делает, не показывается — ряд тогда [Поставить][Корзина][Сердце].
 */
export const MODEL_SCALE_READY = true;

/* Переключатель семейств над сеткой: id семейства → русская подпись (ключ словаря). «Прочее» собирает холодное, метательное,
   тяжёлое и обвесы (владелец, 13.11.2026). */
export const FAMILY_CHIPS = Object.freeze([
  ["all", "Все"],
  ["pistol", "Пистолеты"],
  ["smg", "ПП"],
  ["shotgun", "Дробовики"],
  ["rifle", "Штурмовые"],
  ["machinegun", "Пулемёты"],
  ["sniper", "Снайперские"],
  ["other", "Прочее"],
]);

const CHIP_FAMILIES = new Set(
  FAMILY_CHIPS.map(([id]) => id).filter((id) => id !== "all" && id !== "other"),
);

export const chipOfFamily = (family) =>
  CHIP_FAMILIES.has(family) ? family : "other";

const slotOf = (mod) => String(mod?.catalogSlot || mod?.slot || "");

/** Скин одного ствола: вид «Ганпаки» без признаков пака и со слотом. */
export const isSelectiveSkin = (mod) =>
  mod?.catalogCategory === "skins" && !isGunpackMod(mod) && slotOf(mod) !== "";

export const selectiveSkins = (mods) =>
  Array.isArray(mods) ? mods.filter(isSelectiveSkin) : [];

/* Порядок плиток: как полка мастерской (по семействам), потом стволы, которых в её таблице нет, — по числу скинов. */
const SHELF_ORDER = new Map(
  workshopWeaponSlots.map((slot, at) => [slot.id, at]),
);
const SHELF_SLOT = new Map(workshopWeaponSlots.map((slot) => [slot.id, slot]));

/**
 * Плитки стволов со скинами.
 * @returns {{ slot: string, count: number, family: string, chip: string, ru: string, image: string, known: boolean }[]}
 */
export function weaponTiles(skins) {
  const counts = new Map();
  const names = new Map();
  for (const mod of skins) {
    const slot = slotOf(mod);
    counts.set(slot, (counts.get(slot) || 0) + 1);
    if (!names.has(slot)) names.set(slot, mod.catalogSubcategory || slot);
  }
  const tiles = [...counts].map(([slot, count]) => {
    const known = SHELF_SLOT.get(slot);
    const family = known?.family || "other";
    return {
      slot,
      count,
      family,
      chip: chipOfFamily(family),
      ru: known?.ru || names.get(slot),
      image: known?.image || frameOnlyImage(slot),
      known: Boolean(known),
    };
  });
  const rank = (tile) =>
    SHELF_ORDER.has(tile.slot) ? SHELF_ORDER.get(tile.slot) : Infinity;
  return tiles.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}

/** Плитки под выбранное семейство: «Все» — все, остальное — по семейству плитки. */
export const tilesOfChip = (tiles, chip) =>
  chip === "all" ? tiles : tiles.filter((tile) => tile.chip === chip);

/** Скины одного ствола: сначала самые популярные (скачивания, потом новизна по порядку каталога). */
export function skinsOfWeapon(skins, slot) {
  return skins
    .filter((mod) => slotOf(mod) === slot)
    .sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0));
}

/** Пак каждого скина: id скина → ганпак, который его перечисляет (первый по порядку каталога). */
export function packsOfSkins(mods) {
  const owner = new Map();
  for (const pack of Array.isArray(mods) ? mods : []) {
    if (
      !pack?.includedModIds?.length ||
      !isGunpackMod(pack) ||
      pack.catalogCategory !== "skins"
    )
      continue;
    for (const id of pack.includedModIds)
      if (!owner.has(id)) owner.set(id, pack);
  }
  return owner;
}

/** Адрес кадра скина для большой картинки: профиль из галереи, а если его нет — обложка. */
export function bigFrameOf(mod) {
  const first = Array.isArray(mod?.gallery)
    ? mod.gallery.find((entry) => entry?.url)
    : null;
  return first?.url || mod?.cover || "";
}

/** Адрес GLB-модели скина (у записей сервера строка). */
export function skinModelOf(mod) {
  const model = mod?.model;
  return typeof model === "string" ? model : model?.url || "";
}

/** Штатная модель ствола из поставки: `weapons-3d/<слот>.glb`. */
export function stockModelOf(slot) {
  return SHELF_SLOT.get(slot)?.model || "";
}

export const stockFrameOf = (slot) =>
  SHELF_SLOT.get(slot)?.image || frameOnlyImage(slot);
