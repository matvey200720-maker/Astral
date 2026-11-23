import { useMemo } from "react";

import { useRememberedReducer } from "../../section-memory.js";

export function resolveWorkshopEntry(initialGroup) {
  const requestedSlot =
    initialGroup && typeof initialGroup === "object"
      ? initialGroup.slot || null
      : null;
  const requestedSection =
    initialGroup && typeof initialGroup === "object"
      ? initialGroup.section || null
      : initialGroup;
  const section =
    requestedSection === "weapons"
      ? "gunpacks"
      : requestedSection === "graphics"
        ? "redux"
        : ["redux", "gunpacks", "clothing", "animations", "other", "optimization"].includes(
              requestedSection,
            )
          ? requestedSection
          : "redux";

  return { requestedSlot, section };
}

function initialState(section) {
  return {
    section,
    weaponMode: section === "gunpacks" ? "selective" : null,
    reduxMode: section === "redux" ? "selective" : null,
    clothingMode: section === "clothing" ? "selective" : null,
    selectedSlot: null,
    slotSearch: "",
    weaponCatalogExpanded: false,
    reduxDetailSlot: null,
    packSearch: "",
    packSort: "newest",
    packFavoritesOnly: false,
    packServerFilter: "all",
    packPurposeFilter: "all",
    selectedVariant: null,
    slotEntryMode: null,
    weaponViewerOpen: false,
    slotPreviewOverrides: {},
  };
}

function reducer(state, { field, value }) {
  return {
    ...state,
    [field]: typeof value === "function" ? value(state[field]) : value,
  };
}

const setterNames = {
  section: "setSection",
  weaponMode: "setWeaponMode",
  reduxMode: "setReduxMode",
  clothingMode: "setClothingMode",
  selectedSlot: "setSelectedSlot",
  slotSearch: "setSlotSearch",
  weaponCatalogExpanded: "setWeaponCatalogExpanded",
  reduxDetailSlot: "setReduxDetailSlot",
  packSearch: "setPackSearch",
  packSort: "setPackSort",
  packFavoritesOnly: "setPackFavoritesOnly",
  packServerFilter: "setPackServerFilter",
  packPurposeFilter: "setPackPurposeFilter",
  selectedVariant: "setSelectedVariant",
  slotEntryMode: "setSlotEntryMode",
  weaponViewerOpen: "setWeaponViewerOpen",
  slotPreviewOverrides: "setSlotPreviewOverrides",
};

/*
 * Полка помнит, на чём её оставили.
 *
 * Полторы дюжины значений — раздел, выделенный слот, поиск в галерее слота,
 * раскрытый список оружия — живут одним состоянием, и памяти оно отдаётся
 * целиком: ключей на каждое поле завелось бы столько же, а забыть при этом
 * можно было бы любое.
 *
 * Полок две — мастерская и библиотека, — и память у них своя (`mode`): в
 * мастерской человек собирает, в библиотеке смотрит, что стоит в игре, и
 * раздел, открытый в одной, не обязан открываться в другой.
 *
 * Поиска по полке, сортировки, фильтра избранного и режима удаления здесь
 * больше нет: 2026-09-15 полка стала полосой разделов без инструментов, а
 * снимать установленное ходят в библиотеку, к самой вещи.
 *
 * `entryRequested` отделяет два способа сюда попасть. Иконка в панели — это
 * «вернуться»: раздел показывает то, на чём его оставили. Плитка «собрать в
 * мастерской» из каталога называет слот вслух — и тогда страница обязана
 * открыться на нём, а не на прошлой работе человека. Различает их наличие
 * `initialGroup`: оболочка ставит его только на втором пути. Сам сброс делает
 * страница (CatalogPages), потому что кроме этих полей ей есть что сбросить.
 */
export function useWorkshopState(initialGroup, mode = "workshop") {
  const entry = resolveWorkshopEntry(initialGroup);
  const [state, dispatch] = useRememberedReducer(
    `${mode}:state`,
    reducer,
    entry.section,
    initialState,
  );
  const setters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(setterNames).map(([field, setterName]) => [
          setterName,
          (value) => dispatch({ field, value }),
        ]),
      ),
    [dispatch],
  );

  return {
    ...state,
    ...setters,
    normalizedInitial: entry.section,
    requestedWorkshopSlot: entry.requestedSlot,
    entryRequested: Boolean(initialGroup),
  };
}
