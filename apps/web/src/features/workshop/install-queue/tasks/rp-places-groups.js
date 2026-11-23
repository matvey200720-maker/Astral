/*
 * Названия групп мест, что едут на GTA 5 RP частью (21.11.2026): главный процесс присылает id групп (`viaUpdate.chosen` / `refused`, арена — `packages/install-engine/arena-rp-parts.js`), окно называет их словами
 * мастерской, без имён файлов. Модуль грузится по требованию из `rp-partial-words.js` (`import()`), в главный кусок окна он не входит. Русские строки переводит `tr()` при показе:
 * словарь — `locales/ui-text/zone-rp-arena-2111.js` и `fr/` (у следующих наборов — свои файлы зон).
 */
/* Общие названия групп зданий (завод, маппинг, Мегамолл, Ашан / Икея): здание и плашки у каждого свои, остальное одно. */
const BUILDING_COMMON = Object.freeze({
  models: "Свои модели снаружи",
  items: "Вещи по одной (убрать, своя модель, картинка)",
  far: "Вид здания с большого расстояния",
});

const PLACES_GROUPS = Object.freeze({
  factory: Object.freeze({
    ...BUILDING_COMMON,
    building: "Цвет и вид завода",
    plates: "Эмблемы на здании",
  }),
  mapping: Object.freeze({
    ...BUILDING_COMMON,
    building: "Цвет и вид зданий маппинга",
    plates: "Эмблемы на здании",
  }),
  megamall: Object.freeze({
    ...BUILDING_COMMON,
    building: "Цвет и вид здания Мегамолла",
    plates: "Надписи, логотипы, стороны и щиты на здании",
  }),
  youtool: Object.freeze({
    ...BUILDING_COMMON,
    building: "Цвет и вид здания Ашана и Икеи",
    plates: "Надписи, логотипы, стороны и щиты на здании",
  }),
  arenas: Object.freeze({
    facade: "Цвет и вид здания арены",
    "hall-colours": "Цвет зала арены",
    plates: "Эмблемы, щит, знак и надписи на здании",
    models: "Свои модели снаружи",
    "hall-items": "Вещи зала (кресла, автоматы, банкоматы, парковка)",
    star: "Звезда в зале",
    "hall-panels": "Картинки на полотнах внутри зала",
    cloths: "Свой вид полотен у арок по одному",
    far: "Вид арены с большого расстояния",
  }),
});

/** Название группы набора по id (`""` — группы нет) или `null`, если набор частью на RP не едет. */
export function placesGroupLabel(set) {
  const groups = PLACES_GROUPS[set];
  return groups ? (id) => groups[id] || "" : null;
}
