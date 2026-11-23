import { formatSize } from "../../../catalog-utils.js";
import { newBuildModIds } from "../../../features/builds/build-mods.js";
import { mergeWorkCards } from "../../../features/library/work-cards.js";
import { visibleBuild } from "../../../features/builds/works-switch.js";
import { workshopCopyFor } from "../../../workshop-copy.js";
import { contentsOf, findById } from "./build-lists.js";

// Вычисления страницы сборок для useMemo и useEffect: чистые, данные берут параметрами.
// Сами хуки, их порядок и зависимости остаются в странице.

// Общий пустой список модов: не меняется от отрисовки к отрисовке.
export const NO_MODS = [];

// Названия видов работ на языке страницы.
export function kindNamesOf(language) {
  return workshopCopyFor(language)?.works?.kinds || {};
}

// Подпись размера на языке страницы.
export function sizeFormatterOf(language) {
  return (bytes) => formatSize(bytes, language);
}

// Работы выключены: сборки показываются без работ и установок мастерской.
export function visibleProfiles(profiles, worksOn) {
  if (worksOn) return profiles;
  return profiles.map((item) => visibleBuild(item));
}

// Из установленных работ в сборку попадают только те, что умеют уходить в код.
export function codableOnly(items) {
  return items.filter((item) => item.codable);
}

// Карточки работ из кода, расставленные по порядку установки.
export function importedCards(raw, installOrder) {
  return mergeWorkCards(raw, { order: installOrder });
}

// Что показывает карточка каждой сборки: моды, карточки работ и установки старой сборки.
export function cardViews(shown, entriesOf, modsById, installOrder, workItems) {
  return shown.map((profile) => {
    const view = contentsOf(profile, { entriesOf, modsById, installOrder, workItems });
    return { profile, mods: view.mods, workCards: view.works, items: view.items };
  });
}

// То же для открытой сборки, плюс признак «есть что показать».
export function openedContents(opened, entriesOf, modsById, installOrder, workItems) {
  if (!opened) return null;
  const view = contentsOf(opened, { entriesOf, modsById, installOrder, workItems });
  const { mods, works, items } = view;
  const hasContent = mods.length > 0 || works.length > 0 || items.length > 0;
  return { mods, works, items, hasContent };
}

// Стоящие моды каталога: их установка новой сборки снимет, если они не отмечены.
export function standingOf(isOpen, installed, modsById, catalogState) {
  if (!isOpen) return NO_MODS;
  return newBuildModIds(installed, { modsById, catalogState });
}

// Стоящие моды, которых нет среди отмеченных.
export function leavingOf(standingIds, enabledIds, entriesOf) {
  if (!standingIds.length) return NO_MODS;
  const unticked = standingIds.filter(function notMarked(id) {
    return !enabledIds.has(id);
  });
  return entriesOf(unticked);
}

// Открытая сборка живая: пропала из списка — окно закрывается, заменили запись — берём новую.
export function followLive(shown, opened, setOpened) {
  if (!opened) return;
  const live = findById(shown, opened.id);
  if (!live) {
    setOpened(null);
    return;
  }
  const swapped = live !== opened;
  if (swapped) setOpened(live);
}
