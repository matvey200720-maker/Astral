/*
 * Рамка выделения не схлопывается на мелком размере (владелец, 16.11.2026: размер счётчика и цифр урона — от 10 %).
 *
 * Счётчик и цифры урона в кадре рисуются в группе с масштабом размера, рамка — её частью: при 10 % она в десять раз меньше и в десять раз тоньше, ни разглядеть, ни поймать
 * мышью. Рамка не меньше `MIN_GRAB_UNITS` точек сцены (около 17 px в окне редактора, где сцена 1280 точек занимает ~800 px) по каждой стороне, вокруг того же центра; сам счётчик, подложка и отступы масштабируются как раньше.
 */

/** Наименьшая сторона рамки на сцене, в точках HUD. */
export const MIN_GRAB_UNITS = 28;

/** Рамка `{ x, y, width, height }` в координатах группы с масштабом `scale`: не меньше `MIN_GRAB_UNITS` на сцене, центр прежний. */
export function grabFrame(box, scale) {
  const unit = Math.max(Number(scale) || 0, 0.001);
  const floor = MIN_GRAB_UNITS / unit;
  const width = Math.max(box.width, floor);
  const height = Math.max(box.height, floor);
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}
