/*
 * Редакторы перекраски мастерской: зоны, завод, ангар, маппинг, вода,
 * растительность, арены, здания из игры (Мегамолл, Ашан / Икея) — и шрифты,
 * набор без мода и без цвета, но с той же работой, кодом и «Применить».
 *
 * Общее у них одно: мод, который меняет облик мира своими моделями и
 * текстурами, и работа человека — какого цвета этот облик. Установщик
 * перекрашивает текстуры в файлах мода на месте (длина и раскладка те же) и
 * ставит набор в свой контейнер слоя Astral; кадр редактора показывает те же
 * модели тем же цветом шейдером (`colour.js` — одна арифметика на обоих).
 *
 * Отдельным пакетом не заведено по той же причине, что и прострелы: новый
 * пакет воркспейса требует `npm install`, а ярлык «Астрал» подтягивает main
 * без него. Подпуть `./recolor` добавляет только package.json.
 */

export * from "./arena-star.js";
export * from "./arenas.js";
export * from "./buildings.js";
export * from "./colour.js";
export * from "./colour-effects.js";
export * from "./decal.js";
export * from "./emblems.js";
export * from "./factory.js";
export * from "./finish.js";
export * from "./flat.js";
export * from "./fonts.js";
export * from "./hangar.js";
export * from "./mapping.js";
export * from "./pixels.js";
export * from "./placement.js";
export * from "./projects.js";
export * from "./uv-raster.js";
export * from "./vegetation.js";
export * from "./water.js";
export * from "./zones.js";
