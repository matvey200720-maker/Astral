/*
 * Подписи часов под лентой суток (`SkyTimebar`): сколько их умещается по ширине.
 *
 * Отметки стоят под своими часами, а отрезок у часа — час ленты. В узкой ленте
 * (рядом с лентой в кадре «Фонарей» и «Воды» переключатель видов, и дорожка —
 * 350–400 точек) соседние часы 05, 06, 07 и 16…22 делят по двадцать с небольшим
 * точек, и подписи слипаются в «050607» и «16171819202122». Лишние прячутся:
 * слева направо остаётся подпись, до которой от прежней оставленной — не меньше
 * `MIN_GAP` точек. Спрятанная подпись остаётся кнопкой во весь свой отрезок
 * (она ярлык на точный час, мишень — вся дорожка), выбранная для правки — на
 * виду всегда.
 *
 * Модуль без DOM: ширина и отрезки — числа, их проверяет тест.
 */

/* Подпись «16» — около четырнадцати точек в мелком кегле; с зазором — столько от начала до начала. */
export const MIN_GAP = 26;

/**
 * Какие подписи показать.
 *
 * @param {number[]} spans — ширина отрезка каждой отметки, в часах
 * @param {number} width — ширина дорожки, точек; 0 или неизвестна — показать все
 * @param {{ minGap?: number, selected?: Iterable<number> }} [options] — `selected`: номера, что остаются всегда
 * @returns {Set<number>} номера отметок, подписи которых видны
 */
export function visibleLabels(spans, width, { minGap = MIN_GAP, selected = [] } = {}) {
  const shown = new Set();
  const total = spans.reduce((sum, span) => sum + span, 0);
  if (!(width > 0) || !(total > 0)) {
    spans.forEach((_, index) => shown.add(index));
    return shown;
  }
  const keep = new Set(selected);
  let before = 0;
  let last = -Infinity;
  spans.forEach((span, index) => {
    const start = (before / total) * width;
    before += span;
    if (keep.has(index) || start - last >= minGap) {
      shown.add(index);
      last = start;
    }
  });
  return shown;
}
