/*
 * «Облик предмета» мест (ТЗ 27.10.2026): адаптер для `arena-editor/arena-item-look.jsx` у редакторов, чьи вещи — записи карт района игры (завод и
 * остальные места). Что про набор — в договоре `place-item-looks.js` (рамки, места вещей, откуда брать файлы моделей); здесь — охват, «Цвет» и холст студии.
 *
 * Охват у мест свой (у «Предметов» мест нет «Только этот / Все такие» по модели): `one` — выбранная вещь, `all` — все вещи той же модели с обликом.
 */

import {
  placeItemCanPart,
  placeItemCanReplace,
  placeItemFrame,
  placeItemKeys,
  placeItemPlace,
  placeItemSource,
} from "@modovik/climb-contract/recolor/place-item-looks";
import { clipToPart, colourLookOf, itemElementStudioSurface, itemStudioSurface, silhouetteAt } from "../arena-editor/arena-item-looks.js";
import { sceneElementIsland, sceneItemElements, sceneMainElement } from "./item-elements.js";
import { itemElementWord } from "@modovik/climb-contract/recolor/item-elements";
import { colourOnEach, pictureOnMainElements } from "./item-set-looks.js";
import { tr } from "../../../locales/ui.js";

/** Устойчивые между отрисовками `frameOf` и `placeOf` для хука кадра (`item-look-objects.js`). */
export function placeItemFrameOf(setId, modelOf) {
  return (key) => {
    const model = modelOf(key);
    const bounds = model ? placeItemFrame(setId, model) : null;
    return bounds ? { bounds, modelKey: model } : null;
  };
}
export const placeItemPlaceOf = (setId) => (key) => placeItemPlace(setId, key);

/**
 * Адаптер набора `setId`: `modelOf(номер)` — модель вещи; `scene` — сцена кадра (для сетки «Цвета»); `entityOf(номер)` — номер вещи в сцене кадра, если он
 * не равен номеру вещи в работе (у маппинга номер вещи — место и номер сцены).
 */
export function placeItemLookAdapter(setId, modelOf, scene, { entityOf = (key) => key } = {}) {
  const withSource = placeItemKeys(setId, modelOf);
  return {
    copyHint: "Общий файл модели в игре не меняется: вещь получает свою копию в этом месте, остальная карта остаётся прежней.",
    keys: (item, scope) => {
      if (!withSource.has(item.key)) return [];
      if (scope === "one") return [item.key];
      const model = modelOf(item.key);
      return [...withSource].filter((key) => modelOf(key) === model);
    },
    paintable: (item) => Boolean(placeItemSource(setId, modelOf(item.key))),
    canReplace: (item) => placeItemCanReplace(setId, modelOf(item.key)),
    /* Облик на часть модели (`part` — `{ box, label }` из кадра) — только у рисуемой модели (`placeItemCanPart`). */
    canPart: (item) => placeItemCanPart(setId, modelOf(item.key)),
    paint: async (item, colour, part = null) => {
      const mesh = silhouetteAt(scene, placeItemPlace(setId, item.key), entityOf(item.key));
      if (!part) return colourLookOf(mesh, colour);
      const piece = clipToPart(mesh, part.box);
      if (mesh && !piece) throw new Error(tr("Этой части нет в кадре — цвет ей не задать."));
      return { ...(await colourLookOf(piece, colour)), part };
    },
    studio: (item, title, part = null) => itemStudioSurface({ server: setId, key: item.key, title, bounds: placeItemFrame(setId, modelOf(item.key)), part }),
    /* Элементы вещи — листы её модели (`kind: "elements"`, как у арены): `[{ texture, label, colour, area, box }]`; пусто — вещи нет в кадре. Картинку на
       элемент ставят только при `paintable`: копию с переписанным листом установщик строит из файла модели. */
    elements: (item) => sceneItemElements(scene, entityOf(item.key)),
    /* Холст студии на элемент `{ texture, label }`: пропорция его острова развёртки; итог — элемент с подгонкой «Растянуть». */
    elementStudio: (item, title, element) =>
      itemElementStudioSurface({ server: setId, key: item.key, title, texture: element.texture, label: element.label, island: sceneElementIsland(scene, entityOf(item.key), element.texture, placeItemPlace(setId, item.key)) }),
    /*
     * Набор вещей (Shift, `docs/3D-ELEMENTS-PICTURES.md`, п. 7): облик по модели для `setArenaItemLooks` одним шагом. `modelKey(ключ)` — модель
     * группы; `mainElement(вещь)` — её «Корпус»; `pictureMany(картинка)` — картинка на «Корпус» каждой (`{ look, skipped }`); `paintMany(ключи,
     * цвет)` — «Цвет» каждой модели (`{ look, failed }`).
     */
    modelKey: modelOf,
    mainElement: (item) => sceneMainElement(scene, entityOf(item.key)),
    pictureMany: (picture) =>
      pictureOnMainElements({
        picture,
        mainOf: (key) => sceneMainElement(scene, entityOf(key)),
        canElements: (key) => Boolean(placeItemSource(setId, modelOf(key))),
        coverOf: (key) => sceneItemElements(scene, entityOf(key)).filter((entry) => itemElementWord(entry.texture, entry.colour) !== "Экран").map((entry) => entry.texture),
      }),
    paintMany: (keys, colour) => colourOnEach({ keys, modelOf, paint: (key) => colourLookOf(silhouetteAt(scene, placeItemPlace(setId, key), entityOf(key)), colour) }),
  };
}
