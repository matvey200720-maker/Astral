/*
 * Свет карточки по слоту — под снимки карточек (ТЗ 04.10.2026, задача 5):
 * чёрным вещам (жилет, перчатки, балаклава, большая сумка) на тёмной
 * матовой карточке нужен свет, белой футболке и кедам — нет, иначе белое
 * выгорает.
 */
const CLOTHING_PREVIEW_EXPOSURE = Object.freeze({
  armor: 1.26,
  tshirts: 0.95,
  "government-clothing": 1.02,
  pants: 1.12,
  shoes: 1.06,
  hats: 1.06,
  accessories: 1.24,
  gloves: 1.34,
  masks: 1.1,
  tattoos: 1.08,
  bags: 1.5,
});

export function clothingPreviewExposureFor(slotId) {
  return CLOTHING_PREVIEW_EXPOSURE[slotId] ?? 1.12;
}

export function clothingPreviewContrastFor() {
  return 0.98;
}
