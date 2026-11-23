/*
 * «Предметы» завода (ТЗ владельца 26.10.2026, п. A): что стоит на заводе — корпуса и земля двора, контейнеры, заборы и барьеры, реквизит.
 * Опись вещей выпек H3 в запись сцены завода (`inventory/factory.js`: `scene.objects`, 55 вещей, 19 моделей), номер вещи — `mesh.entity`
 * сетки. Здесь — слова про эту опись; панель общая (`items-panel/SceneItemsSection.jsx`), таблица имён, категорий и родов — в контракте
 * (`@modovik/climb-contract/recolor/scene-item-rules`).
 */

import { FACTORY_INVENTORY, factoryRemovable } from "@modovik/climb-contract/recolor/factory";
import { FACTORY_ITEM_CATEGORIES, FACTORY_ITEM_RULES, itemRuleOf } from "@modovik/climb-contract/recolor/scene-item-rules";
import { tr } from "../../../locales/ui.js";
import { itemCategoryOf, itemTitleOf } from "../items-panel/item-names.js";

export { FACTORY_ITEM_CATEGORIES, FACTORY_ITEM_RULES, factoryRemovable };

/** Откуда по умолчанию смотрит кадр завода (`factoryStageFrame`): снимки плиток встают с той же стороны. */
export const FACTORY_VIEW_YAW = -0.72;

/** Опись вещей сцены завода (`null` — у этой сборки её нет). */
export const factorySceneObjects = () => FACTORY_INVENTORY.scene?.objects || null;

export const factoryItemCategory = (model) => itemCategoryOf(FACTORY_ITEM_RULES, model);

/** Род вещи в разметке выделения (по нему «Выбрать все такие»): из таблицы правил завода. */
export const factorySelectionKind = (model) => itemRuleOf(FACTORY_ITEM_RULES, model?.name)?.kind || "";

/** Имя модели для человека на языке окна: «Корпус 3», «Контейнер, вид 2»; незнакомая модель — внутренним именем. */
export const factoryModelTitle = (model) => itemTitleOf(FACTORY_ITEM_RULES, model);

/* Слова инструмента и слота правки вещи (русские ключи словаря: сверяет `scene-items.test.js`). */
export const FACTORY_ITEMS_COPY = Object.freeze({
  note: "Каждая вещь завода отдельно",
  hint: "Щёлкните вещь в кадре или выберите её в списке: кадр обведёт её по краям, а «Найти» подлетит к ней",
  aim: "выбрать вещь под курсором",
  editorNote: "Цвет и отделка задаются группе и части корпуса целиком, а не одной вещи: в игру уходят листы завода. Вещь здесь можно найти, обвести и перелистать.",
  link: "Открыть «Облик»",
  removal: "Корпуса и земля завода красятся, но не убираются: без них завода нет.",
  removed: "Предмет убран с завода",
  panelHint: "Всё, что стоит на заводе, — по группам. Откройте группу или щёлкните вещь в кадре: она обведётся, а «Найти» подлетит к ней.",
});

/** Слова панели про завод: комната одна — сам завод; «Только этот / Все такие» не показывается (правка ложится на группу). */
export function factoryItemsAdapter() {
  return {
    categories: FACTORY_ITEM_CATEGORIES,
    /* Группы — строками без снимков (критик 31.10.2026): серые модели завода на тёмном выходили почти чёрными. */
    groupRows: true,
    categoryOf: factoryItemCategory,
    roomOf: () => "",
    roomOrder: () => 0,
    roomLabel: () => tr("Завод"),
    titleOf: factoryModelTitle,
    originOf: (model) => (model.own ? tr("файл мода завода") : tr("штатная модель игры")),
    scopes: false,
    hint: FACTORY_ITEMS_COPY.panelHint,
    words: Object.freeze({
      "{0} шт. в зале": "{0} шт. на заводе",
      "Один в зале": "Один на заводе",
      "Найти в зале": "Найти в кадре",
      "Предмет убран из зала: в игре его не будет.": "Предмет убран с завода: в игре его не будет.",
    }),
  };
}
