/*
 * Вторая сторона вещи — вид внутри своего цвета, а не ещё один цвет (25.10.2026, владелец: «в карточке “Свитер” среди пяти
 * цветов один — тот же свитер, просто повёрнутый задом наперёд»).
 *
 * Разбор выкладывал кадр «Основной, расцветка A, спина» (`previewAlt`) в галерею рядом с кадрами цветов, и лента карточки
 * листала его как отдельный цвет. Выложенные карточки на сервере остаются такими, пока их не перевыложат, поэтому окно
 * разбирает галерею само (`@modovik/clothing/colour-list`): кадры сторон и слитых расцветок из ленты уходят, а вторая
 * сторона цвета едет полем `back` его главного кадра — сцена показывает её по кнопке «Сзади».
 *
 * Работает и на старых карточках (сторона узнаётся по подписи «…, спина»), и на новых (сторон в галерее уже нет — вещь
 * остаётся как есть).
 */

import { colourListOf } from "@modovik/clothing/colour-list";
import { clothingOf } from "./clothing-catalog.js";

/**
 * Кадры карточки вещи для ленты.
 * @param {object} mod мод окна (`domain.clothing`, `gallery[]` с `url` и `source`)
 * @param {Array<{ src: string, source?: string, caption?: string }>} items кадры карточки (`mediaOf`), у кадров галереи есть `source`
 * @returns {Array} те же кадры без вторых сторон и кадров слитых расцветок; у главного кадра цвета — `back: { src, caption }`
 */
export function withColourViews(mod, items) {
  const block = clothingOf(mod);
  if (!block || !Array.isArray(mod.gallery) || !mod.gallery.length) return items;
  const list = colourListOf({ clothing: block, gallery: mod.gallery });
  if (!list.views.length && list.frames.length === mod.gallery.length) return items;
  const shown = new Set(list.frames.map((frame) => frame.source));
  const own = new Set(mod.gallery.map((frame) => frame.source).filter(Boolean));
  const fronts = new Map(list.colours.filter((colour) => colour.frame).map((colour) => [colour.key, colour.frame.source]));
  const first = list.colours.find((colour) => colour.frame);
  /* Сторона цвета; у старой карточки без `previewAlt` — первого цвета (сторону снимали с него). */
  const backOf = new Map();
  for (const view of list.views) {
    const target = (view.colour && fronts.get(view.colour)) || first?.frame.source;
    const src = view.frame.url || view.frame.src;
    if (target && src && !backOf.has(target)) backOf.set(target, { src, caption: view.frame.caption || "" });
  }
  return items
    .filter((item) => !item.source || !own.has(item.source) || shown.has(item.source))
    .map((item) => (item.source && backOf.has(item.source) ? { ...item, back: backOf.get(item.source) } : item));
}
