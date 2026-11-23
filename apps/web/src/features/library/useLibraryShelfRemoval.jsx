import { useState } from "react";
import { readWorkshopInstallUnits } from "../../workshop-library.js";
import {
  LibraryRemovalDialog,
  LibrarySelectionActions,
  LibraryTrashButton,
} from "./LibraryRemoval.jsx";
import { libraryDuplicates } from "./library-duplicates.js";
import { entriesCarrying, libraryRemovalRequest } from "./removal-request.js";
import { extrasLeaving } from "./gunpack-state.js";
import { tr } from "../../locales/ui.js";
import {
  optimizationEntries,
  optimizationKnownUnits,
} from "./optimization-units.js";

/*
 * Корзина на полке библиотеки.
 *
 * Карточка полки — одна или несколько установок: мод каталога в слоте,
 * работа редактора на плитке. Отмечается карточка, и только она: общий патч
 * эффектов стоит на «Трейсерах», «Эффектах попадания» и «Огне», но отметка
 * «Трейсеров» остальные не отмечает — что из этого следует для установки,
 * решает запрос удаления (`removal-request.js`).
 *
 * Полка каталога — один большой компонент, и всё, что нужно корзине, он
 * отдаёт сюда параметрами: какие плитки сейчас на полке, как слот
 * раскладывается на детальные слоты, какие моды в них стоят. Обратно он
 * получает то, что встраивает в разметку: отметку карточки, кнопки на полосе
 * разделов и окно. Обложку карточки рисует сама полка
 * (`features/workshop/covers`): она одна на мастерскую и библиотеку.
 */
export function useLibraryShelfRemoval({
  isLibrary,
  selectedSlot,
  selection,
  installUnits,
  setInstallUnits,
  workshopModIndex,
  /* Детальные слоты плитки в её разделе: `(sectionId, slotId) => [...]`. */
  slotIdsIn,
  localized,
  /* Полки библиотеки по разделам: `{ redux, other, gunpacks, clothing, sounds, effects }` —
     функции, отдающие установленные плитки. */
  shelves,
  data,
  /* Установленное и «чья запись»: служебное «прочее» ганпака уходит вместе с последним стволом (`gunpack-state.js`). */
  installed = [],
  bundleOf = {},
  libraryCopy,
  locale,
  gameTargetId,
  onRemove,
  onNotice,
  onLibraryChanged,
}) {
  const [libraryRemoval, setLibraryRemoval] = useState(null);
  /* Карточки, которые уходят из игры прямо сейчас: «Удалить» нажато, а
     удаление ещё идёт. */
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const removalCopy = libraryCopy.library.removal;

  const modUnits = (sectionId, slotIds) =>
    slotIds.flatMap((slotId) =>
      workshopModIndex
        .modsForSlot(sectionId, slotId)
        .filter((mod) => workshopModIndex.installedIdSet.has(mod.id))
        .map((mod) => ({
          key: `mod:${mod.id}`,
          kind: "mod",
          modId: mod.id,
          name: mod.name,
        })),
    );
  const entryFor = (slot, sectionId) => {
    const slotIds = slotIdsIn(sectionId, slot.id);
    const units = new Map(
      [
        ...modUnits(sectionId, slotIds),
        ...installUnits.filter((unit) =>
          unit.slots.some((slotId) => slotIds.includes(slotId)),
        ),
      ].map((unit) => [unit.key, unit]),
    );
    return {
      id: slot.id,
      title: localized(slot.title || slot.labels),
      slots: slotIds,
      units: [...units.values()],
    };
  };

  /* Полка библиотеки одна на все разделы (владелец, 25.09.2026): «Выбрать
     всё» и Ctrl+A отмечают всё, что стоит в игре, — графику, оружие, одежду
     и оптимизацию (ТЗ 10.10: она снова на полке строкой, а «Удалить»
     возвращает стандартные значения). */
  const entries = (() => {
    if (!isLibrary || selectedSlot) return [];
    return [
      ...shelves.redux().map((slot) => entryFor(slot, "redux")),
      ...shelves.other().map((slot) => entryFor(slot, "other")),
      ...shelves.gunpacks().map((slot) => entryFor(slot, "gunpacks")),
      ...shelves.clothing().map((slot) => entryFor(slot, "clothing")),
      ...(shelves.sounds?.() || []).map((slot) => entryFor(slot, "sounds")),
      ...(shelves.effects?.() || []).map((slot) => entryFor(slot, "effects")),
      ...optimizationEntries(libraryCopy, locale),
    ];
  })().filter((entry) => entry.units.length);

  const librarySelectionFor = (slot) => {
    const entry = selection.active
      ? entries.find((item) => item.id === slot.id)
      : null;
    if (!entry)
      return {
        selecting: false,
        selected: false,
        removing: removingIds.has(slot.id),
      };
    return {
      selecting: true,
      selected: selection.selected.has(entry.id),
      onToggle: () => selection.toggle(entry.id),
    };
  };

  /*
   * Запрос удаления по отмеченным карточкам.
   *
   * `extras` — установки без карточки на этой полке: работа из другого
   * раздела, которую пришлось снять вместе с отмеченным. Запрос считается
   * один раз, при открытии окна, и лежит в состоянии: полка перерисовывается
   * часто, а окно по каждому новому запросу спрашивало бы план заново.
   */
  const requestFor = (ids, extras = []) => {
    const request = libraryRemovalRequest({ entries, selected: ids });
    const known = new Set(request.units.map((unit) => unit.key));
    const extra = extras.filter((unit) => !known.has(unit.key));
    const units = [...request.units, ...extra];
    /* «Прочее ганпака» уходит с последним стволом пака тем же удалением, но строкой в окне не называется: своей корзины у него нет. */
    const service = extrasLeaving(
      units.filter((unit) => unit.kind === "mod").map((unit) => unit.modId),
      { mods: data.mods, installed, bundleOf },
    ).flatMap(({ packId, extras: ids }) =>
      ids.map((id) => ({
        key: `mod:${id}`,
        kind: "mod",
        modId: id,
        name: tr("Ганпак «{name}»: прочее").replace("{name}", data.mods.find((mod) => mod.id === packId)?.name || ""),
      })),
    );
    return {
      ...request,
      selected: [...ids],
      extras: extra,
      entries: [
        ...request.entries,
        ...extra.map((unit) => ({
          id: unit.key,
          title: unit.name || removalCopy.kinds[unit.kind],
          units: [unit],
        })),
      ],
      units: [...units, ...service.filter((unit) => !units.some((one) => one.key === unit.key))],
    };
  };

  /* «Удалить и её тоже»: работа, которую нельзя поставить обратно, уходит
     вместе с выбранным — и отмечается на полке, чтобы выбор не врал. */
  const withUnit = (request, unit) => {
    const owners = entriesCarrying(entries, unit);
    return requestFor(
      [...new Set([...request.selected, ...owners])],
      owners.length ? request.extras : [...request.extras, unit],
    );
  };
  /* «Удалить весь набор эффектов»: по частям его снять нельзя — отмечаются
     все его карточки, и он уходит обычным удалением. */
  const withWhole = (request, split) =>
    requestFor(
      [
        ...new Set([
          ...request.selected,
          ...entriesCarrying(entries, split.unit),
        ]),
      ],
      request.extras,
    );

  const openRemoval = () => {
    const request = requestFor([...selection.selected]);
    if (request.units.length || request.splits.length)
      setLibraryRemoval(request);
  };

  /* Одна карточка без режима выбора: «Удалить ганпак» на карточке пака. Список карточек — заголовок группы на «Загрузках» («Удалить ганпак», «Снять сборку»): одно окно подтверждения на все её строки. */
  const askRemoval = (id) => {
    const request = requestFor(Array.isArray(id) ? id : [id]);
    if (request.units.length || request.splits.length)
      setLibraryRemoval(request);
  };

  /* «Удалить всё» (владелец, 15.11.2026): то же окно со всем, что стоит в игре; выделение на полке не трогается — «Отмена» в окне возвращает его как было. */
  const removeAll = () => {
    const request = requestFor(entries.map((entry) => entry.id));
    if (request.units.length || request.splits.length)
      setLibraryRemoval(request);
  };

  /* Корзина шапки библиотеки v2 (`LibraryTrashBar.jsx`): отметка на плитке стоит всегда, режима «включить» нет (владелец, 16.11.2026). */
  const trash = {
    available: isLibrary && entries.length > 0,
    active: selection.active,
    total: entries.length,
    /* Дубли — два мода на одном месте: плитка помечена, шапка подсказывает удалить лишний (`library-duplicates.js`). */
    duplicates: isLibrary ? libraryDuplicates(entries) : new Map(),
    onToggle: selection.toggle,
    count: entries.filter((entry) => selection.selected.has(entry.id)).length,
    /* Какие плитки отмечены: сводка библиотеки показывает, что станет после удаления. */
    selected: entries
      .filter((entry) => selection.selected.has(entry.id))
      .map((entry) => entry.id),
    busy: removingIds.size > 0,
    copy: removalCopy,
    onStart: selection.start,
    onCancel: selection.stop,
    onSelectAll: () => selection.replace(entries.map((entry) => entry.id)),
    onRemoveSelected: openRemoval,
    onRemoveAll: removeAll,
  };

  const include = (grow, subject) => {
    if (!libraryRemoval) return;
    const next = grow(libraryRemoval, subject);
    selection.add(next.selected);
    setLibraryRemoval(next);
  };

  const renderLibraryRemoval = () =>
    libraryRemoval && (
      <LibraryRemovalDialog
        copy={removalCopy}
        locale={locale}
        targetId={gameTargetId}
        entries={libraryRemoval.entries}
        units={libraryRemoval.units}
        splits={libraryRemoval.splits}
        /* Оптимизатор лежит в стопке точек восстановления: если удаление мода
           упирается в него, окно называет его и предлагает убрать и его
           (`replay-unavailable`). */
        knownUnits={[
          ...installUnits,
          ...(isLibrary ? optimizationKnownUnits(libraryCopy) : []),
        ]}
        onClose={() => {
          setLibraryRemoval(null);
          setRemovingIds(new Set());
        }}
        onStarted={() => {
          /* Выбор сделан — полка выходит из него сразу, а не через минуту
             удаления, и уходящие карточки гаснут на своих местах. */
          selection.stop();
          setRemovingIds(
            new Set(libraryRemoval.entries.map((entry) => entry.id)),
          );
        }}
        onInclude={(unit) => include(withUnit, unit)}
        onIncludeWhole={(split) => include(withWhole, split)}
        onQueueRemoval={(modIds) =>
          modIds.forEach((modId) => {
            const mod = data.mods.find((item) => item.id === modId);
            if (mod) onRemove?.(mod);
          })
        }
        onFinished={({ removedCount }) => {
          setInstallUnits(readWorkshopInstallUnits());
          setRemovingIds(new Set());
          selection.stop();
          onLibraryChanged?.();
          if (removedCount)
            onNotice?.(
              removalCopy.done.replace("{count}", String(removedCount)),
            );
        }}
      />
    );

  /* Корзина на полосе разделов; в режиме выбора на её месте — «Выбрать всё»
     и «Удалить выбранное». Удалять нечего — нет и корзины. */
  const libraryActions =
    isLibrary && entries.length ? (
      selection.active ? (
        <LibrarySelectionActions
          copy={removalCopy}
          entries={entries}
          selection={selection}
          onRemove={openRemoval}
        />
      ) : (
        <LibraryTrashButton
          copy={removalCopy}
          busy={removingIds.size > 0}
          onClick={selection.start}
        />
      )
    ) : null;

  return {
    removalCopy,
    librarySelectionFor,
    libraryActions,
    askRemoval,
    trash,
    removingIds,
    renderLibraryRemoval,
    /* Карточке одной работы — то же удаление, что у полки: «Удалить из игры»
       на «Трейсерах» снимает трейсеры, а не весь набор эффектов. */
    removalFor: { requestFor, withUnit, withWhole },
  };
}
