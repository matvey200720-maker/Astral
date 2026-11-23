import { isCatalogBundle, variantSiblings } from "../../../catalog-utils.js";
import { componentsOf } from "./component-choices.js";
import { REDUX_BASE_SLOT } from "./component-groups.js";

/*
 * Сколько у редукса компонентов (владелец 13.11.2026: «пиши просто, сколько там компонентов есть в этих сборках» — карточка в каталоге говорила «3 части» при 22 пакетах).
 *
 * Считается так же, как окно «Компоненты» делит сборку на строки (`componentsOf`): компонент — слот, а не пакет. Группа «Эффекты» (кровь, частицы, таблицы, ядро) — один компонент,
 * арена из трёх архивов — один, интерьеры — по одному, «Трейсеры» — свой. Служебный пакет «Остальные файлы» (`isReduxBase`, слот `redux-base`) человеку компонентом не показывается
 * и не считается. Пакеты, которых нет среди записей (не опубликованы), посчитать не из чего — они пропускаются.
 */

/** Компоненты по списку пакетов: без служебной «Основы редукса». */
export function partsComponentCount(parts = []) {
  return componentsOf(parts).filter(
    (component) => component.key !== REDUX_BASE_SLOT,
  ).length;
}

/** Компонентов у сборки: состав `includedModIds`, пакеты берутся из `mods` (все записи каталога, а не только выставленные на полки). */
export function bundleComponentCount(bundle, mods = []) {
  if (!bundle?.includedModIds?.length) return 0;
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  return partsComponentCount(
    bundle.includedModIds.map((id) => byId.get(id)).filter(Boolean),
  );
}

/**
 * Компонентов у редукса в сетке каталога: у сборки версии по умолчанию (версии одного редукса — один вариант `domain.variant`, первой идёт та, что по умолчанию).
 * Группа без сборки (одни части) — 0: счёта нет, карточка считает части сама.
 */
export function reduxGroupComponentCount(group, mods = []) {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const lead = [group?.packId, group?.leadId]
    .map((id) => byId.get(id))
    .find((mod) => isCatalogBundle(mod));
  if (!lead) return 0;
  return bundleComponentCount(variantSiblings(lead, mods)[0], mods);
}
