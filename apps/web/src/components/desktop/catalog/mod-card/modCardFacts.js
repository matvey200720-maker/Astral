import { isCatalogBundle } from "../../../../catalog-utils.js";
import { isCatalogWork } from "../../../../features/workshop/works/catalog-work.js";
import { partsComponentCount } from "../../../../features/catalog/bundles/component-count.js";
import { modComponentsLabel } from "../modActionCopy.js";

function fact(id, title, value, note) {
  return { id, title, value, note };
}

// Сколько компонентов у сборки (владелец 13.11.2026): части из плиток «Что внутри» без отметки separate делятся на компоненты так же, как в окне «Компоненты»
// (группа «Эффекты» — один, «Основа редукса» не считается); если плиток нет, то длина состава.
export function bundleComponentTotal(mod, contents) {
  const parts = contents ? contents.filter((tile) => !tile.separate).flatMap((tile) => tile.pieces ?? [tile.mod]) : [];
  return partsComponentCount(parts) || mod.includedModIds?.length || 0;
}

function bundleFacts({ mod, actionCopy, cardCopy, language, contents }) {
  return [
    fact(
      "how",
      actionCopy.bundleHow,
      modComponentsLabel(bundleComponentTotal(mod, contents), language),
      actionCopy.bundleHowNote,
    ),
    fact("rollback", actionCopy.rollback, cardCopy.rollbackValue, actionCopy.rollbackNote),
  ];
}

function workFacts({ actionCopy }) {
  return [
    fact("how", actionCopy.workHow, actionCopy.workHowValue, actionCopy.workHowNote),
    fact("files", actionCopy.workFiles, actionCopy.workFilesValue, actionCopy.workFilesNote),
  ];
}

function plainFacts({ plan, actionCopy, cardCopy }) {
  const stated = plan.editionsStated;
  return [
    fact(
      "version",
      actionCopy.gameVersion,
      stated ? plan.modEditions.join(" + ") : actionCopy.notStated,
      stated ? actionCopy.fromManifest : actionCopy.notStatedNote,
    ),
    fact("changes", actionCopy.changes, plan.changeSummary, ""),
    fact(
      "rollback",
      actionCopy.rollback,
      cardCopy.rollbackValue,
      plan.ready ? actionCopy.installedRollbackNote : actionCopy.rollbackNote,
    ),
    { ...fact("after", actionCopy.after, plan.afterInstallNote, ""), ready: plan.ready },
  ];
}

/**
 * Ответы для шапки страницы мода перед «Установить»: у обычного мода четыре
 * (версия игры, изменения, откат, после установки), у сборки и работы мастерской по две.
 */
export function modCardFacts({ mod, plan, actionCopy, cardCopy, language, contents = null }) {
  const context = { mod, plan, actionCopy, cardCopy, language, contents };
  if (isCatalogBundle(mod)) return bundleFacts(context);
  if (isCatalogWork(mod)) return workFacts(context);
  return plainFacts(context);
}
