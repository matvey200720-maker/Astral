/*
 * Сколько файлов вода трогает в игре — для подписей окна. Опись рек
 * (`@modovik/climb-contract/recolor/inventory/water`, 40 КБ адресов) в окно
 * не тянется ради одного числа; совпадение с описью держит тест редактора.
 */

import { WATER_FOG_GRIDS } from "@modovik/climb-contract/recolor/water";

export default Object.freeze({
  tiles: Object.values(WATER_FOG_GRIDS).reduce((sum, grid) => sum + grid.cols * grid.rows, 0),
  rivers: 120,
});
