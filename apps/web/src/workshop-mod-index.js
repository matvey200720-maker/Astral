import { shelfOfCategory } from "@modovik/clothing/taxonomy";
import { listedCatalogMods } from "./catalog-utils.js";
import { isReduxBase } from "./features/catalog/bundles/component-groups.js";

const EMPTY_MODS = Object.freeze([]);

export function workshopSlotKey(section, slotId) {
  return `${section || ""}:${slotId || ""}`;
}

export function resolveWorkshopVariant({
  mods = EMPTY_MODS,
  visibleMods = mods,
  selectedVariant = null,
  installedVariant = null,
} = {}) {
  const findById = (items, candidate) =>
    candidate?.id ? items.find((mod) => mod.id === candidate.id) : null;

  return (
    findById(visibleMods, selectedVariant) ||
    findById(mods, selectedVariant) ||
    findById(visibleMods, installedVariant) ||
    findById(mods, installedVariant) ||
    visibleMods[0] ||
    mods[0] ||
    null
  );
}

/*
 * `offers(mod)` — подходит ли мод выбранному проекту (ТЗ 05.10, задача 14):
 * на полки и в слоты встают только подходящие. Установленное — нет: что
 * стоит в игре, то стоит, и мастерская с библиотекой видят его при любом
 * проекте (иначе мод с преимуществом под GTA 5 RP исчез бы из виду ровно
 * тогда, когда о нём важнее всего знать).
 */
export function createWorkshopModIndex(
  mods = [],
  installedIds = [],
  { offers = null } = {},
) {
  const installedIdSet = new Set(installedIds);
  const offered = (mod) => !offers || installedIdSet.has(mod.id) || offers(mod);
  const publicMods = [];
  const modsBySection = new Map();
  const modsBySlot = new Map();
  const installedBySlot = new Map();
  const installedWorkshopMods = [];
  /* Группа вариантов (мини-карта 16:9 / 5:4, Т-77) на полке раздела — одной
     карточкой; слот мастерской — выбор между модами, там видны все. */
  const listed = new Set(listedCatalogMods(mods).map((mod) => mod.id));

  for (const mod of mods) {
    if (mod.internal || !mod.catalogSection || !offered(mod)) continue;
    /* «Основа редукса» (`redux-base`) лежит на полке маппинга (нарочно), но слотом мастерской не занимает: стоящая основа не должна отмечать «Маппинг» установленным и
       попадать в карточки библиотеки. Снимается она вместе со своим редуксом. */
    if (isReduxBase(mod)) continue;

    if (listed.has(mod.id)) {
      publicMods.push(mod);
      const sectionMods = modsBySection.get(mod.catalogSection);
      if (sectionMods) sectionMods.push(mod);
      else modsBySection.set(mod.catalogSection, [mod]);
    }

    if (mod.catalogSlot) {
      /* Очки и часы — на полке «Аксессуары» (`shelfOfCategory`). */
      const key = workshopSlotKey(
        mod.catalogSection,
        mod.catalogSection === "clothing"
          ? shelfOfCategory(mod.catalogSlot)
          : mod.catalogSlot,
      );
      const slotMods = modsBySlot.get(key);
      if (slotMods) slotMods.push(mod);
      else modsBySlot.set(key, [mod]);

      if (installedIdSet.has(mod.id) && !installedBySlot.has(key)) {
        installedBySlot.set(key, mod);
      }
    }

    if (
      installedIdSet.has(mod.id) &&
      ["redux", "gunpacks", "clothing", "other"].includes(mod.catalogSection)
    ) {
      installedWorkshopMods.push(mod);
    }
  }

  return {
    publicMods,
    installedIdSet,
    installedWorkshopMods,
    modsForSection(section) {
      return modsBySection.get(section) || EMPTY_MODS;
    },
    modsForSlot(section, slotId) {
      return modsBySlot.get(workshopSlotKey(section, slotId)) || EMPTY_MODS;
    },
    installedForSlot(section, slotId) {
      return installedBySlot.get(workshopSlotKey(section, slotId)) || null;
    },
  };
}
