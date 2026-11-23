/*
 * Облик вещей мест маппинга в окне (ТЗ 27.10.2026, «Предметы»): ключ вещи в работе — место + номер сцены (`mappingItemKey` договора), а кадр, список и
 * `mesh.entity` знают только номер сцены. Здесь — переводы между ними и адаптер к плашкам арены (`items-panel/place-item-look.js`). Без React.
 */

import { MAPPING_ITEM_BASE, mappingItemAt, mappingItemKey, mappingItemModel } from "@modovik/climb-contract/recolor/mapping";
import { applyItemLook } from "../items-panel/item-set-looks.js";
import { placeItemFrameOf, placeItemLookAdapter, placeItemPlaceOf } from "../items-panel/place-item-look.js";

/** Рамки и места вещей мест для кадра: устойчивые между отрисовками. */
export const MAPPING_FRAME_OF = placeItemFrameOf("mapping", mappingItemModel);
export const MAPPING_PLACE_OF = placeItemPlaceOf("mapping");

/** Ставит ли игра вещи этого места в картах района (у остальных облик не ставится: их ставит сервер своей моделью). */
export const mappingItemsPlaced = (location) => Boolean(MAPPING_ITEM_BASE[location]);

/** Номер сетки вещи в сцене места по ключу работы (место + номер сцены). */
export const mappingEntityOf = (key) => mappingItemAt(key)?.entity ?? key;

/** Вещь `item` панели «Предметов» (номер сцены) места `location` — в ключах работы. */
export const mappingLookItem = (location, item) => ({ ...item, key: mappingItemKey(location, item.key) });

/** Адаптер плашек места `location`: охват и «Цвет» по ключам работы, сетка «Цвета» — по номеру сцены. */
export function mappingLookAdapter(location, scene) {
  const base = placeItemLookAdapter("mapping", mappingItemModel, scene, { entityOf: mappingEntityOf });
  return {
    ...base,
    /* «Все такие» — вещи той же модели этого места: так же, как их считает переключатель охвата панели (сцена места), а не всех мест сразу. */
    keys: (item, scope) => base.keys(item, scope).filter((key) => mappingItemAt(key)?.location === mappingItemAt(item.key)?.location),
    copyHint: "Вещь получает свою копию в этом месте из штатной модели игры; облик места на неё не действует.",
    reason: () => (mappingItemsPlaced(location) ? "" : "Это место ставит сервер своей моделью: вещей в картах игры нет, облик вещи не поставить."),
  };
}

/** Группы облика, что стоят в сцене места `location`: ключи остальных мест из них убраны. */
export function mappingLookGroups(items, location) {
  const out = [];
  for (const group of items || []) {
    const keys = group.keys.filter((key) => mappingItemAt(key)?.location === location);
    if (keys.length) out.push(keys.length === group.keys.length ? group : { ...group, keys });
  }
  return out;
}

/** Номера вещей сцены места, у которых свой облик (их прежнего вида в кадре нет), или `null`. Картинка на элементах вещь не прячет. */
export function mappingLookHidden(groups) {
  const list = (groups || [])
    .filter((group) => group.model)
    .flatMap((group) => group.keys.map((key) => mappingItemAt(key)?.entity))
    .filter(Boolean);
  return list.length ? list : null;
}

/** Работа с новым обликом вещей (набор разных моделей — по группе на модель, `applyItemLook`); `null`, если групп стало бы больше предела. */
export function mappingWithLook(project, keys, look, part = look?.part || null) {
  const { items } = applyItemLook(project.items, keys, look, mappingItemModel, part);
  return items ? { ...project, items } : null;
}
