/*
 * «Предметы» маппинга (ТЗ владельца 26.10.2026, п. A): что стоит на месте карты — здания фермы и базы, прицепы, поля, хлам. Опись
 * вещей лежит в записи сцены места (`scripts/prepare-recolor-sets.mjs`, `prepare-mapping-stock.mjs`: `objects`), номер вещи —
 * `mesh.entity` сетки. Здесь — слова про эту опись: категории, имена моделей, чья модель. Панель — общая
 * (`items-panel/SceneItemsSection.jsx`), без React и three: имена и категории берут и тесты.
 */

import { MAPPING_INVENTORY, MAPPING_STOCK } from "@modovik/climb-contract/recolor/mapping";
import { tr } from "../../../locales/ui.js";
import { MAPPING_ITEM_CATEGORIES, MAPPING_ITEM_RULES, itemRuleOf } from "@modovik/climb-contract/recolor/scene-item-rules";
import { itemCategoryOf, itemTitleOf } from "../items-panel/item-names.js";

/* Таблицы имён, категорий и родов лежат в контракте: их читает и выпечка (разметка выделения), и окно. */
export { MAPPING_ITEM_CATEGORIES, MAPPING_ITEM_RULES };

/** Запись сцены места по её адресу (облик «как в игре» и «как в моде» — две разные сцены): опись вещей, разметка выделения, sha256. */
export function mappingSceneRecord(url) {
  if (!url) return null;
  return [...MAPPING_INVENTORY.scenes, ...MAPPING_STOCK.scenes].find((scene) => scene.url === url) || null;
}

/** Опись вещей сцены места по её адресу. */
export const mappingSceneObjects = (url) => mappingSceneRecord(url)?.objects || null;

/* Слова инструмента и слота правки вещи (русские ключи словаря: сверяет `scene-items.test.js`). */
export const MAPPING_ITEMS_COPY = Object.freeze({
  note: "Каждая вещь места отдельно",
  hint: "Щёлкните вещь в кадре или выберите её в списке: кадр обведёт её по краям, а «Найти» подлетит к ней",
  aim: "выбрать вещь под курсором",
  editorNote: "Цвет и отделка задаются месту целиком: в игру уходят листы места, а не отдельные вещи. Вещь здесь можно найти, обвести и перелистать.",
  link: "Открыть «Облик»",
  removal: "Убрать отдельную вещь места нельзя: Astral красит листы места целиком, а здания и хлам стоят в игре как были.",
  panelHint: "Всё, что стоит в этом месте, — по группам. Откройте группу или щёлкните вещь в кадре: она обведётся, а «Найти» подлетит к ней.",
});

/** Откуда по умолчанию смотрит кадр места (общее с кадром и снимками плиток). */
export const MAPPING_VIEW_YAW = -0.62;

export const mappingItemCategory = (model) => itemCategoryOf(MAPPING_ITEM_RULES, model);

/** Род вещи в разметке выделения (по нему «Выбрать все такие»): из таблицы правил набора. */
export const mappingSelectionKind = (model) => itemRuleOf(MAPPING_ITEM_RULES, model?.name)?.kind || "";

/** Имя модели для человека на языке окна: «Дом фермы», «Прицеп 14»; незнакомая модель — внутренним именем. */
export const mappingModelTitle = (model) => itemTitleOf(MAPPING_ITEM_RULES, model);

/** Слова панели про место на карте: `stock` — облик «как в игре» (штатные модели), иначе модели мода. */
export function mappingItemsAdapter({ stock, placeTitle }) {
  return {
    categories: MAPPING_ITEM_CATEGORIES,
    categoryOf: mappingItemCategory,
    roomOf: () => "",
    roomOrder: () => 0,
    /* У места одна комната — само место: заголовок группы называет его. */
    roomLabel: () => tr(placeTitle),
    titleOf: mappingModelTitle,
    originOf: () => (stock ? tr("штатная модель игры") : tr("модель из мода маппинга")),
    scopes: false,
    hint: MAPPING_ITEMS_COPY.panelHint,
    words: Object.freeze({
      "{0} шт. в зале": "{0} шт. в этом месте",
      "Один в зале": "Один в этом месте",
      "Найти в зале": "Найти в кадре",
    }),
  };
}
