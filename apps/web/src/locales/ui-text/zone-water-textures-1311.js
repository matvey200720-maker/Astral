/*
 * Зона «Обложка воды из текстур автора», 13.11.2026 (ENEMY V2: у части «Вода» один файл — словарь текстур поверхности `water.ytd`): подпись обложки, которую ставит печь
 * (`apps/desktop/src/water-textures-cover.js`: `WATER_CAPTION`, `WATER_CAPTION_AUTHOR_ONLY`), окно показывает её подсказкой под кадром (`FrameTile.jsx`, `tr`).
 * Число текстур в подписи не склоняется: «Текстуры» — слово словаря (`water.ytd` — словарь текстур), одна или несколько.
 * Французский — `fr/zone-water-textures-1311.js`. Русская строка → [uk, en, de, pl].
 */

export const zoneWaterTextures1311 = {
  "Текстуры воды: слева из игры, справа из файла автора": [
    "Текстури води: ліворуч із гри, праворуч із файлу автора",
    "Water textures: the game's on the left, the author's file on the right",
    "Wassertexturen: links aus dem Spiel, rechts aus der Datei des Autors",
    "Tekstury wody: po lewej z gry, po prawej z pliku autora",
  ],
  "Текстуры воды из файла автора": [
    "Текстури води з файлу автора",
    "Water textures from the author's file",
    "Wassertexturen aus der Datei des Autors",
    "Tekstury wody z pliku autora",
  ],
};
