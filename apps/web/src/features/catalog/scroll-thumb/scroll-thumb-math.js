/*
 * Расчёт бегунка прокрутки каталога (владелец, 24.11.2026). Чистые числа, без DOM и React: положение бегунка по
 * `scrollTop / scrollHeight / clientHeight` и обратный расчёт `scrollTop` при перетаскивании.
 */

export const MIN_THUMB = 36;

/* Когда листать почти нечего (не больше самого бегунка в минимуме), бегунка нет: пустой раздел длиннее окна на несколько пикселей
   из-за отступов страницы, и пилюля во всю высоту там только мешает. Заодно это запас на дробные значения раскладки. */
export const MIN_RANGE = MIN_THUMB;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Высота и смещение бегунка; `null`, когда содержимое не длиннее окна больше чем на `MIN_RANGE` (бегунка нет совсем).
 */
export function thumbMetrics({ scrollTop, scrollHeight, clientHeight, trackHeight, minThumb = MIN_THUMB }) {
  const range = scrollHeight - clientHeight;
  if (!(trackHeight > 0) || !(clientHeight > 0) || !(range > MIN_RANGE)) return null;
  const height = Math.min(trackHeight, Math.max(minThumb, (trackHeight * clientHeight) / scrollHeight));
  const travel = trackHeight - height;
  return { height, offset: clamp(scrollTop / range, 0, 1) * travel, travel, range };
}

/**
 * Новый `scrollTop`, когда бегунок сдвинули на `deltaY` пикселей от места, где `scrollTop` был `startScrollTop`.
 */
export function scrollTopForDrag({ startScrollTop, deltaY, scrollHeight, clientHeight, trackHeight, minThumb = MIN_THUMB }) {
  const metrics = thumbMetrics({ scrollTop: startScrollTop, scrollHeight, clientHeight, trackHeight, minThumb });
  if (!metrics || metrics.travel <= 0) return startScrollTop;
  return clamp(startScrollTop + (deltaY * metrics.range) / metrics.travel, 0, metrics.range);
}
