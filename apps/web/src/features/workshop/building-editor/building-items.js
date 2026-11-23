/*
 * «Предметы» зданий (Мегамолл, Ашан / Икея; ТЗ владельца 26.10.2026, п. A): что стоит у здания — сама постройка по частям, земля и
 * парковка, лестницы и перила, забор, крыша, контейнеры, флаги. Опись вещей лежит в записи сцены здания
 * (`scripts/lib/building-set.mjs`: `objects`), номер вещи — `mesh.entity` сетки. Здесь — слова про эту опись; панель общая
 * (`items-panel/SceneItemsSection.jsx`).
 */

import { buildingInventory, buildingSide } from "@modovik/climb-contract/recolor/buildings";
import { tr } from "../../../locales/ui.js";
import { BUILDING_ITEM_CATEGORIES, BUILDING_ITEM_RULES, itemRuleOf } from "@modovik/climb-contract/recolor/scene-item-rules";
import { itemCategoryOf, itemTitleOf } from "../items-panel/item-names.js";

/* Таблицы имён, категорий и родов лежат в контракте: их читает и выпечка (разметка выделения), и окно. */
export { BUILDING_ITEM_CATEGORIES, BUILDING_ITEM_RULES };

/** Опись вещей сцены здания (`null` — у этого здания сцены нет). */
export const buildingSceneObjects = (place) => buildingInventory(place)?.scenes?.[0]?.objects || null;

/* Слова инструмента и слота правки вещи (русские ключи словаря: сверяет `scene-items.test.js`). */
export const BUILDING_ITEMS_COPY = Object.freeze({
  note: "Каждая вещь у здания отдельно",
  hint: "Щёлкните вещь в кадре или выберите её в списке: кадр обведёт её по краям, а «Найти» подлетит к ней",
  aim: "выбрать вещь под курсором",
  editorNote: "Цвет, отделка и баннеры задаются части здания целиком, а не одной вещи: в игру уходят листы здания. Вещь здесь можно найти, обвести и перелистать.",
  link: "Открыть «Здание»",
  removal: "Убрать отдельную вещь у здания нельзя: Astral красит листы здания целиком, а модели стоят в игре как были.",
  /* У здания с описью карт района («Удалить» по одной, ТЗ 27.10.2026): оболочку красят, но не убирают. */
  removalShell: "Постройка, земля и парковка красятся, но не убираются: без них здания нет.",
  removed: "Предмет убран у здания",
  panelHint: "Всё, что стоит у здания, — по группам. Откройте группу или щёлкните вещь в кадре: она обведётся, а «Найти» подлетит к ней.",
});

/** Откуда по умолчанию смотрит кадр здания: со стороны главного фасада, чуть сбоку (как `BuildingStage`). Снимки плиток — оттуда же. */
export function buildingViewYaw(place) {
  const normal = buildingSide(place, "front")?.normal || [0, -1, 0];
  return Math.atan2(normal[0], -normal[1]) + 0.4;
}

export const buildingItemCategory = (model) => itemCategoryOf(BUILDING_ITEM_RULES, model);

/** Род вещи в разметке выделения (по нему «Выбрать все такие»): из таблицы правил набора. */
export const buildingSelectionKind = (model) => itemRuleOf(BUILDING_ITEM_RULES, model?.name)?.kind || "";

/** Имя модели для человека на языке окна: «Лестница 2», «Секция забора»; незнакомая модель — внутренним именем. */
export const buildingModelTitle = (model) => itemTitleOf(BUILDING_ITEM_RULES, model);

/** Слова панели про здание: `title` — как зовётся место («Мегамолл», «Ашан / Икея»). */
export function buildingItemsAdapter({ title }) {
  return {
    categories: BUILDING_ITEM_CATEGORIES,
    /* Группы — строками без снимков (критик 31.10.2026): серые модели здания на тёмном выходили почти чёрными, у «Здания» — пустым местом. */
    groupRows: true,
    categoryOf: buildingItemCategory,
    roomOf: () => "",
    roomOrder: () => 0,
    /* У здания одна комната — само здание: заголовок группы называет его. */
    roomLabel: () => tr(title),
    titleOf: buildingModelTitle,
    originOf: () => tr("штатная модель игры"),
    scopes: false,
    hint: BUILDING_ITEMS_COPY.panelHint,
    words: Object.freeze({
      "{0} шт. в зале": "{0} шт. у здания",
      "Один в зале": "Один у здания",
      "Найти в зале": "Найти в кадре",
      "Предмет убран из зала: в игре его не будет.": "Предмет убран у здания: в игре его не будет.",
    }),
  };
}
