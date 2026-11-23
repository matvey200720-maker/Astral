import { variantOf } from "@modovik/publishing";
import { isCatalogBundle } from "../../../catalog-utils.js";
import { bundleMembers, bundleRemoval } from "./bundle-state.js";
import { slotsOf } from "./component-choices.js";

/*
 * Пачки пакетов для движка (ТЗ ведущей 10.11.2026, этап 2): `installRemotePackages({ packages, removeModIds })` ставит несколько пакетов и снимает другие моды одной
 * транзакцией, отказ ничего не меняет. Здесь — только правила «что уходит в `packages`, а что в `removeModIds`» для четырёх ходов на установленном редуксе; сама отправка —
 * `DesktopShell` (очередь «Загрузок»), выбор человека — `component-actions.js`. До установки редукса ничего из этого не вызывается: выбор только меняет план.
 *
 *  • смена версии (стоит A, выбрана и нажата B): пакеты B, которых ещё нет, плюс снятие пакетов A, которых нет в B; общие записи не трогаются;
 *  • «Взять из другой сборки»: пакеты слота чужой сборки плюс снятие родных (для общего архива зон — весь архив);
 *  • «Вернуть родную часть»: родные пакеты плюс снятие пакетов замены;
 *  • «Моя работа»: родные пакеты снимаются обычным снятием после того, как очередь мастерской поставила работу (отказ первого шага ничего не меняет).
 *
 * Пакеты `gta-settings` (переключатели оптимизации) в пачку не идут: их ставят и снимают отдельно, как раньше (`settings` в ответе планировщиков).
 */

const unique = (list) => [...new Set(list.filter(Boolean))];

/** Пакет настроек игры (переключатели оптимизации): пачка его не берёт. */
export const isSettingsPackage = (part) => part?.manifest?.adapter === "gta-settings" || slotsOf(part).includes("optimization-toggles");

// Разложить пакеты на «в пачку» и «отдельно».
const split = (parts) => ({ batch: parts.filter((part) => !isSettingsPackage(part)), settings: parts.filter(isSettingsPackage) });

const idsOf = (parts) => parts.map((part) => part.id);

/**
 * Смена версии редукса.
 * @param {{ bundle: object, mods: object[], installed: string[], bundleOf: object, resolvedIds: string[] }} input `bundle` — выбранная версия B, `resolvedIds` — что
 * входит в B после выбора человека (отключённое и замещённое учтено), `bundleOf` — «id части → сборка, что её поставила».
 * @returns {{ removeModIds: string[], settingsRemoveIds: string[] }} стоящее от других версий этой же карточки, чего в B нет: в пачку и отдельным снятием настроек
 */
export function versionSwitchPlan({ bundle, mods = [], installed = [], bundleOf = {}, resolvedIds = [] }) {
  const group = variantOf(bundle)?.group;
  if (!group) return { removeModIds: [], settingsRemoveIds: [] };
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const keep = new Set(resolvedIds);
  const siblings = mods.filter((mod) => mod.id !== bundle.id && isCatalogBundle(mod) && variantOf(mod)?.group === group);
  const standing = unique(siblings.flatMap((sibling) => bundleRemoval(sibling, { installed, members: bundleMembers(sibling.id, bundleOf), mods }).ids)).filter((id) => !keep.has(id));
  const parts = standing.map((id) => byId.get(id) || { id });
  const { batch, settings } = split(parts);
  return { removeModIds: idsOf(batch), settingsRemoveIds: idsOf(settings) };
}

/**
 * «Взять из другой сборки» на установленном редуксе.
 * @param {{ replacement: object[], native: object[], previous?: object[], installed: string[] }} input `replacement` — пакеты слота чужой сборки, `native` — родные пакеты
 * закрытых слотов (у общего архива зон — весь архив), `previous` — пакеты прежней замены, если она стояла.
 * @returns {{ packages: object[], removeModIds: string[], settings: { install: object[], remove: string[] } }}
 */
export function swapPlan({ replacement = [], native = [], previous = [], installed = [] }) {
  const stands = new Set(installed);
  const incoming = new Set(idsOf(replacement));
  const toInstall = replacement.filter((part) => !stands.has(part.id));
  const toRemove = unique([...native, ...previous].filter((part) => stands.has(part.id) && !incoming.has(part.id)).map((part) => part.id));
  const byId = new Map([...native, ...previous].map((part) => [part.id, part]));
  const install = split(toInstall);
  const removed = split(toRemove.map((id) => byId.get(id) || { id }));
  return { packages: install.batch, removeModIds: idsOf(removed.batch), settings: { install: install.settings, remove: idsOf(removed.settings) } };
}

/**
 * «Вернуть родную часть»: родные пакеты ставятся, пакеты замены снимаются.
 * @param {{ native: object[], replacement: object[], installed: string[] }} input
 */
export function restorePlan({ native = [], replacement = [], installed = [] }) {
  return swapPlan({ replacement: native, native: replacement, installed });
}

/**
 * «Моя работа» на установленном редуксе: родные пакеты слота, что стоят, снимаются после успеха мастерской.
 * @param {{ native: object[], installed: string[] }} input
 * @returns {{ removeModIds: string[], settingsRemoveIds: string[] }}
 */
export function workPlan({ native = [], installed = [] }) {
  const stands = new Set(installed);
  const { batch, settings } = split(native.filter((part) => stands.has(part.id)));
  return { removeModIds: idsOf(batch), settingsRemoveIds: idsOf(settings) };
}
