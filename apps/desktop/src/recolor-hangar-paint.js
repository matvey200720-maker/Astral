/*
 * Мастерская ангара — цвета, часть Б: проход «цвет конструкций и труб» сборщика `recolor-hangar.js` (`buildHangarFiles`). Нулевой коммит: проход ничего не делает (`null` — файл не тронут); тон листов
 * ферм, колонн, труб и остального кладёт часть Б.
 *
 * Договор прохода (общий у частей А, Б, В): `({ file, bytes, project, structure }) → null | { bytes, patch }`, где `bytes` — файл игры с правкой (до прохода — то, что уже собрано сборщиком), `patch` — поля
 * записи правки файла (`patches`), которые проход дописывает к собранным.
 */

// eslint-disable-next-line no-unused-vars -- заготовка нулевого коммита: параметры у прохода те же, что у частей
export async function hangarPaintPass({ file, bytes, project, structure }) {
  return null;
}
