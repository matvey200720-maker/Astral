/*
 * Какой редактор мастерской стоит за слотом компонента сборки (таблица Хелпера 27 «слот компонента → редактор» по коду движка, ТЗ ведущей 10.11.2026, этап 2).
 *
 * Кнопка «Сделать в мастерской» и вкладка «Моя работа» окна «Компоненты» — только там, где редактор есть: `editorOf(слот)` отдаёт слот работы мастерской
 * (`slotId` вида работы, `features/workshop/works/work-kinds.js`; им же открывается редактор, `useWorkshopEditors.jsx`) либо `null`. Ключ — слот установки компонента
 * (`componentSlotOf`: `timecycle`, `interior-7`, `zones-green`), а не слот полки каталога: у полки интерьеры, зоны и оптимизация общие.
 *
 * Нет редактора: `hudcolor`, `clouds` и `clouds-layer` (облака — отдельный компонент рядом с «Таймциклом», редактора под них нет), `interior-<N>` (номера автора нашему месту не соответствуют), `optimization-*` (редактор скрыт), `mapping-<имя>` не из известных мест
 * (ферма, парковка, самолёт, байкеры), `redux-base` («Основа редукса»: файлы редукса без своего раздела, редактора под них нет). Одна работа «Запретных зон» стоит на все три слота зон — `covers` их перечисляет, окно предупреждает, как у общего архива.
 *
 * Модуль без импортов: он нужен и кнопкам карточки, и разбору «какие работы подходят», и тестам, а стартовый кусок окна его не берёт.
 */

const ZONE_SLOTS = Object.freeze(["zones-green", "zones-forbidden", "zones-vzh"]);

/** Слот установки → слот работы мастерской. */
const EDITOR_SLOT = Object.freeze({
  arenas: "arenas",
  climbing: "climbing",
  "climbing-vzh": "climbing",
  hangar: "hangar",
  schedule: "schedule",
  "zones-green": "forbidden-zones",
  "zones-forbidden": "forbidden-zones",
  "zones-vzh": "forbidden-zones",
  zones: "forbidden-zones",
  "large-map": "large-map",
  water: "water",
  vegetation: "vegetation",
  lanterns: "lights",
  timecycle: "timecycle",
  minimap: "minimap",
  "minimap-position": "minimap",
  crosshair: "crosshair",
  effects: "hit-effects",
});

/** Известные места редактора «Маппинг» (`packages/climb-contract/recolor/inventory/mapping.js`: farm, bikers, plane, carpark). */
const MAPPING_PLACE = /(^|[^a-z])(farm|ferma|biker|bikers|plane|airplane|carpark|parking)([^a-z]|$)/i;

/**
 * Редактор мастерской для слота компонента.
 * @param {string} slot слот установки (`componentSlotOf`)
 * @returns {{ slotId: string, covers: string[] } | null} `covers` — слоты сборки, на которые встаёт одна работа (три слота зон), иначе один слот
 */
export function editorOf(slot) {
  if (typeof slot !== "string" || !slot) return null;
  const mapping = /^mapping-(.+)$/.exec(slot);
  if (mapping) return MAPPING_PLACE.test(mapping[1]) ? { slotId: "mapping", covers: [slot] } : null;
  const slotId = EDITOR_SLOT[slot];
  if (!slotId) return null;
  return { slotId, covers: slotId === "forbidden-zones" ? [...ZONE_SLOTS] : [slot] };
}

/**
 * Слоты, у которых редактора нет точно: для них нет и запасного разбора по слоту каталога (старые записи без таблицы слотов ищут редактор по `catalogSlot`).
 * Склеенные группы приходят ключом группы (`effects`), слоты их пакетов сюда не доходят.
 */
export const hasNoEditor = (slot) => /^(hudcolor$|clouds|interior-|optimization|mapping-|redux-base$)/.test(slot || "");

/** Есть ли у слота редактор мастерской. */
export const hasEditorFor = (slot) => editorOf(slot) !== null;

/** Все слоты установки, у которых есть редактор (для сверки с мастерской в тесте). */
export const EDITOR_SLOTS = Object.freeze(Object.keys(EDITOR_SLOT));
