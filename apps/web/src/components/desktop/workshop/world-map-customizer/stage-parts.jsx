// Части кадра: разметка поверх сцены (окно «Иконок», плашка провала карты мода,
// полоска выбора; заставку загрузки кладёт главный файл) и скрытое поле выбора файла.
import { createElement as h, Fragment } from "react";
import { tr } from "../../../../locales/ui.js";
import { MapIconsStage } from "../world-map/icons/MapIconsTool.jsx";
import { MAP_PICTURE_ACCEPT } from "../world-map-picture.js";
import WorldMapSelectionBar from "../WorldMapSelectionBar.jsx";

// Название мода — данные: кириллица помечается языком, перевода нет
const hasCyrillic = (text) => /[А-Яа-яЁё]/.test(text);

function failurePlate({ title, loading }) {
  const note = loading
    ? tr("Качаю и разбираю файлы карты — это займёт несколько секунд")
    : tr("Файлы карты не прочитались. Откройте мод заново или выберите другой вид карты справа.");
  return h(
    "div",
    { className: "wmc-stage-loading is-failed", role: "status", "aria-live": "polite" },
    h("strong", null, tr("Карта мода не открылась")),
    title ? h("span", hasCyrillic(title) ? { lang: "ru" } : null, title) : null,
    h("small", null, note),
  );
}

// Всё, что кадр рисует поверх сцены, в порядке слоёв
export function stageOverlay({ tool, icons, work, assetUrls, loader, source, bar, actions }) {
  const iconsWindow =
    tool === "icons"
      ? h(MapIconsStage, {
          model: icons.model,
          work,
          pick: icons.pick,
          onPick: icons.setPick,
          onWork: icons.onWork,
          assetUrls,
          query: icons.query,
          onQuery: icons.setQuery,
        })
      : null;
  const plate = source.packFailed
    ? failurePlate({ title: source.packOrigin?.title, loading: source.packLoading })
    : null;
  const selectionBar = bar
    ? h(WorldMapSelectionBar, {
        count: bar.count,
        grouped: bar.grouped,
        colour: bar.colour,
        onColour: bar.onColour,
        onGroup: actions.group,
        onUngroup: actions.ungroup,
        onRemove: actions.remove,
        onClear: actions.clear,
      })
    : null;
  return h(Fragment, null, iconsWindow, loader, plate, selectionBar);
}

// Скрытое поле выбора файла для инструмента «Картинки»
export function pictureInput(inputRef, onChange) {
  return h("input", {
    ref: inputRef,
    type: "file",
    accept: MAP_PICTURE_ACCEPT,
    hidden: true,
    "data-testid": "wmc-image-input",
    onChange,
  });
}
