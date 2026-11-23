/*
 * Подвид строки рук (`uppr`): перчатки или ногти — для чипа «Все | Перчатки | Ногти» окна цели (16.11.2026, просьба targets). Признак берётся из ДАННЫХ (`uppr-kind-flags-data.js`: подвид выложенных
 * карточек и наследование по стилю), а не из слов в названии строки: строки «Руки и перчатки №2.N» названием не различить. Строка без карточки и без группы с подвидом — без признака (`null`), в чипе
 * она остаётся только во «Всех»; по геометрии не угадываем.
 */

import { collectionOfFolder } from "./beard.js";
import { UPPR_KIND_FLAGS } from "./uppr-kind-flags-data.js";

/** Подвиды рук в порядке чипа: «Перчатки», «Ногти». */
export const UPPR_KINDS = Object.freeze(["gloves", "nails"]);

/**
 * Подвид вещи проекта вида `uppr`: `gloves` | `nails` | `null` (не руки или в данных нет). Вещь — как у `beardFlagOf`: `{ component, server, gender, collection | folder, drawable }`.
 * `flags` — таблицы (подмена в тестах).
 */
export const upprKindOf = (item, flags = UPPR_KIND_FLAGS) =>
  item?.component === "uppr"
    ? flags?.[item.server]?.[`${item.gender}|${item.collection || collectionOfFolder(item.folder)}|${Number(item.drawable)}`] || null
    : null;
