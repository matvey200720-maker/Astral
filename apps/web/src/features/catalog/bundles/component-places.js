import { MERGED_GROUPS } from "./component-groups.js";

/*
 * Где в каталоге лежат части компонента (владелец, 12.11.2026: «В „Компонентах“ выбираю часть, нажимаю „Взять из другого редукса“ — открывается мой каталог сразу на нужной
 * вкладке; листаю, нажимаю на вариант — он сразу подставляется»). Ключ — слот компонента (`componentSlotOf`), значение — редактор полки раздела «Для редуксов»
 * (`redux-editors.js`, `catalog-shelves.js`), на которой лежат части редуксов этого слота.
 *
 * В таблице только те слоты, у которых полка проверена по коду (`reduxEditorOf` по полке и подразделу, с которыми конвейер кладёт части: `rpf-inspector/card.js`,
 * `anatomy-drafts.js`, `anatomy-routes.js`, `anatomy-effects.js`) и части редуксов на неё действительно попадают. Нет в таблице — окно «Взять из другой сборки» остаётся прежним:
 *  • `climbing`, `climbing-vzh`, `vegetation`, `mapping-*` — части редуксов этих полок в каталоге скрыты (`UNLISTED_PART_EDITORS`, `catalogUnlisted`): на полке были бы одни отдельные вещи;
 *  • `interior-<N>` — полка «Интерьеры магазинов» спрятана (`HIDDEN_WORKSHOP_EDITORS`), номера автора на полку не ложатся;
 *  • `hudcolor`, `optimization-*`, `clouds`, `clouds-layer` — своей полки нет, части уходят в «Прочее»;
 *  • звуки оружия — паки звуков в «Компонентах» без выбора по слотам.
 *
 * «Эффекты» — склеенная группа из четырёх слотов (`component-groups.js`): заменяется набором другой сборки целиком, частичной замены нет, поэтому с полки годятся
 * только части сборок (`whole`), а отдельная вещь — нет. На полке попаданий у редукса одна карточка группы (ведущий пакет, `EFFECTS_LEAD_ORDER`), выбрав её, человек берёт весь набор.
 * «Трейсеры» (`tracer-bindings`) — отдельный компонент рядом с «Эффектами» (владелец 12.11.2026) и своя полка трейсеров.
 *
 * Модуль без тяжёлых импортов: его читают кнопки карточки и тесты, а стартовый кусок окна берёт только таблицу слотов.
 */

/** Раздел каталога, где лежат полки редакторов. */
export const PICK_CATEGORY = "for-redux";

/** Слот компонента → редактор полки. Старые записи без `manifest.slots` держат слот полки (`hit-effects`, `tracers`, `lights`), у новых слоты установки (`reticle`, `lanterns`). */
const EDITOR_OF_SLOT = Object.freeze({
  timecycle: "timecycle",
  minimap: "minimap",
  "minimap-position": "minimap",
  "large-map": "large-map",
  crosshair: "crosshair",
  reticle: "crosshair",
  effects: "hit-effects",
  "hit-effects": "hit-effects",
  "blood-effects": "hit-effects",
  tracers: "tracers",
  "tracer-bindings": "tracers",
  "kill-effects": "kill-effects",
  arenas: "arenas",
  hangar: "hangar",
  schedule: "schedule",
  water: "water",
  lanterns: "lights",
  lights: "lights",
  zones: "forbidden-zones",
  "zones-green": "forbidden-zones",
  "zones-forbidden": "forbidden-zones",
  "zones-vzh": "forbidden-zones",
});

/** Слоты, у которых есть полка в каталоге. */
export const PICK_SLOTS = Object.freeze(Object.keys(EDITOR_OF_SLOT));

/**
 * Место в каталоге для слота компонента либо `null`: тогда замена идёт прежним окном.
 * @returns {{ category: string, editor: string } | null} то, что принимает `navigate("catalog", place)` оболочки.
 */
export function placeOfSlot(slot) {
  if (typeof slot !== "string" || !Object.hasOwn(EDITOR_OF_SLOT, slot)) return null;
  return { category: PICK_CATEGORY, editor: EDITOR_OF_SLOT[slot] };
}

/** Склеенная группа слотов («Эффекты»): заменяется только набором целой сборки, отдельная вещь каталога не годится. */
export const isWholeOnly = (slot) => typeof slot === "string" && Object.hasOwn(MERGED_GROUPS, slot);
