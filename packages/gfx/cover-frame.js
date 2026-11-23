/*
 * Рамка обложки вещи или ствола (24.10.2026, владелец: одежда и ганпаки «подпрыгивают»).
 *
 * Одна арифметика для всех, кто кладёт вещь в кадр обложки: съёмщик одежды (`features/clothing/clothing-shot.js`), перекадрирование уже
 * опубликованных прозрачных PNG (`apps/desktop/src/cover-reframe.js`). Вещь вписывается в кадр так, чтобы зазор до края с
 * ограничивающей стороны был `COVER_MARGIN` и одинаковый у всех вещей, а по другой оси вещь стояла по центру (зазоры с двух сторон
 * равны). Прежнее «86 % высоты, 80 % ширины» давало высокой вещи 47 точек зазора, а широкой — 120 слева и справа.
 */

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 675;
/** Зазор до края с ограничивающей стороны, точек: 7 % высоты — как у ref/04 (вещь на 86–87 % высоты карточки). */
export const COVER_MARGIN = 48;
/** Во сколько раз вещь можно увеличить при вписывании: мелочь не раздувается в пятно. */
export const MAX_ENLARGE = 3;

/** Во сколько раз масштабировать рамку `box` (`{ width, height }`), чтобы она вошла в кадр с зазором `margin` со всех сторон. */
export function fitScale(box, { width = COVER_WIDTH, height = COVER_HEIGHT, margin = COVER_MARGIN, enlarge = MAX_ENLARGE } = {}) {
  return Math.min((width - 2 * margin) / box.width, (height - 2 * margin) / box.height, enlarge);
}

/** Поля вокруг содержимого `bounds` (`{ left, top, right, bottom }`, правая и нижняя — за последним пикселем) в кадре `width × height`. */
export const gapsOf = (bounds, width, height) => ({
  left: bounds.left,
  right: width - bounds.right,
  top: bounds.top,
  bottom: height - bounds.bottom,
});
