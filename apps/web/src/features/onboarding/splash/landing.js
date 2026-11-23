/*
 * Куда садится знак заставки: на настоящий знак в заголовке окна (15.11.2026).
 *
 * Заголовок есть и у окна после входа, и у страницы входа (`.desktop-titlebar-brand-mark`). Знак там — картинка-маска
 * (`brand/astral-mark.png`), и сам знак занимает в ней 54 % ширины: заставка садится на знак, а не на рамку. Если у знака в
 * шапке другая рамка (рисуется контуром, а не маской), у элемента ставится `data-startup-glyph` — доля ширины, которую занимает
 * знак. Пока знак шапки не нашёлся, садимся в точку макета (`LAND_DEFAULT`).
 */

import { LAND_DEFAULT } from "./wake-model.js";

export const MARK_SELECTOR =
  "[data-startup-mark], .desktop-titlebar-brand-mark";
const GLYPH_OF_MASK = 0.543;

/** Настоящий знак шапки и место посадки: `{ el, land: { x, y, w } }` (пиксели окна). */
export function markLanding(root = document) {
  const el = root.querySelector(MARK_SELECTOR);
  const rect = el?.getBoundingClientRect();
  if (!rect || rect.width < 4) return { el: null, land: LAND_DEFAULT };
  const share = Number(el.dataset.startupGlyph) || GLYPH_OF_MASK;
  return {
    el,
    land: {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      w: rect.width * share,
    },
  };
}
