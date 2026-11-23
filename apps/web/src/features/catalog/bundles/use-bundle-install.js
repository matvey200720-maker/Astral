import { tr } from "../../../locales/ui.js";
import { useBundleActions } from "./BundleContext.js";
import { bundlePartsLabel, bundleCopy } from "./bundle-copy.js";
import { isVectorMapPart } from "../part-map.js";
import { useBundleComponents, componentGroupOf } from "./component-choices.js";
import { useBundleChoices } from "./bundle-choices.js";
import { usePartMapWorks, chosenMapWork } from "./map-works.js";
import { withKnownWorks } from "./component-works.js";
import { bundleRemoval, bundleMembers } from "./bundle-state.js";
import { useOwnWorks } from "./use-own-works.js";
import { bundleProgressOf, bundlePartsOf } from "./component-state.js";

/*
 * Состояние установки сборки для новой карточки редукса (Каталог 2.0, часть 2): ровно те же расчёты, что в `BundleInstallActions.jsx` (части по выбору человека,
 * ход очереди, что можно снять, подпись кнопки), только отдаёт он их данными, а не готовой разметкой: «Установить» и корзина на новой карточке стоят в одном
 * ряду по доске. Логику установки хук не меняет — действия те же `installBundle` и `removeBundle` оболочки.
 *
 * Хуки зовутся при каждом показе и до решения «оболочки нет» (порядок вызовов не зависит от данных). Ответ `null` — оболочки нет (витрина без установки).
 */
export function useBundleInstall(bundle, language) {
  const shell = useBundleActions();
  const choices = useBundleChoices(bundle.id);
  const picked = useBundleComponents(componentGroupOf(bundle));
  const ownWorks = useOwnWorks(!!Object.keys(picked.work).length);
  const catalog = shell?.mods || null;
  const mapIds = catalog
    ? catalog.flatMap((mod) =>
        (bundle.includedModIds ?? []).some((id) => id === mod.id) &&
        isVectorMapPart(mod)
          ? [mod.id]
          : [],
      )
    : [];
  const mapWorks = usePartMapWorks(mapIds);
  if (!shell) return null;

  const { installed, queue, bundleOf, installBundle, removeBundle } = shell;
  const components = withKnownWorks(picked, ownWorks);
  const { parts, skipped } = bundlePartsOf(bundle, catalog ?? [], {
    installed,
    choices,
    mapWorks,
    components,
    ownWorks: ownWorks ?? [],
  });
  const { total, installedCount, pendingIds, state } = bundleProgressOf(
    bundle,
    installed,
    catalog,
    mapIds.flatMap((id) =>
      chosenMapWork(id, mapWorks, choices)?.installed ? [id] : [],
    ),
    components,
    ownWorks ?? [],
  );
  const removable = bundleRemoval(bundle, {
    installed,
    members: bundleMembers(bundle.id, bundleOf),
    mods: catalog,
  }).ids;
  const watched = new Set([
    ...(bundle.includedModIds ?? []),
    ...parts.map(({ id }) => id),
  ]);
  const busy = queue.some(
    ({ failed, id, batch }) =>
      !failed &&
      (watched.has(id) ||
        (batch?.ids ?? []).some((other) => watched.has(other))),
  );
  const allOff = total === 0 && skipped.length > 0;
  const words = bundleCopy(language);
  const caption =
    (allOff && tr("Все компоненты отключены")) ||
    (busy && words.busy) ||
    (state === "partial" &&
      words.installMissing(bundlePartsLabel(pendingIds.length, language))) ||
    words.install;
  return {
    busy,
    allOff,
    /* Строка «Статус: Сборка стоит целиком / Стоит 3 из 5» — как у прежней карточки; пока ничего не стоит, её нет. */
    status:
      installedCount > 0
        ? {
            label: words.status,
            value:
              (state === "full" && words.full) ||
              words.installed(installedCount, total),
          }
        : null,
    /* Подсказка корзины: что снимется и что запомнится. */
    removeNote: words.removeRemembered(
      bundlePartsLabel(removable.length, language),
    ),
    /* Сборка стоит целиком: главная кнопка снимает. */
    whole: state === "full",
    caption,
    removeWord: words.remove,
    removable: removable.length > 0,
    install: () => installBundle(bundle),
    remove: () => removeBundle(bundle),
  };
}
