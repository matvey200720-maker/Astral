import {
  COVER_THUMB_WIDTHS,
  coverThumbUrl,
} from "../../../utils/cover-thumb.js";
import { editorCoverKind } from "../../workshop/covers/editor-covers.js";
import { stockCover } from "../../workshop/covers/stock-covers.js";
import { modPicture } from "../../library/mod-picture.js";

/*
 * Фото строки «Загрузок» (владелец 18.11.2026: вместо белой чёрточки — то, что ставится).
 *
 * Мод каталога — его обложка; часть сборки без своей обложки — обложка сборки (`coverFallback`, её кладёт оболочка в
 * очередь вместе со строкой); работа мастерской — обложка её редактора, та же, что на плитке редактора, а нет её —
 * картинка вещи, сохранённая вместе с работой. Ничего нет — пусто: место займёт значок вида, не чёрточка.
 *
 * Картинка не должна стоить установки: адрес строки зависит только от самой строки, а не от хода, и не меняется,
 * пока идут проценты, — браузер просит её один раз. Облачная обложка идёт лёгким ярусом превью, а не оригиналом
 * 1200 × 800: герою хватает верхней ступени ряда (его накрывает затемнение), плитке списка 76 × 44 — нижней.
 */

/* Ярус героя назван числом, а не «верхней ступенью ряда»: 18.11.2026 ряд вырос до 1600 (кадр открытой карточки), и герой
   молча стал просить 1600 вместо 960 — под затемнением это лишние килобайты. */
const HERO_WIDTH = 960;
const ROW_WIDTH = COVER_THUMB_WIDTHS[0];

/** Картинка строки каталога без превью-яруса: своя обложка, а у части сборки без неё — обложка сборки. */
export const catalogPicture = (row) =>
  modPicture(row) ||
  (typeof row?.coverFallback === "string" ? row.coverFallback : "");

/** Адрес картинки героя строки каталога (лёгкий ярус превью). */
export const catalogHeroPhoto = (row) =>
  coverThumbUrl(catalogPicture(row), HERO_WIDTH);

/** Адрес картинки плитки в списке очереди (лёгкий ярус превью). */
export const catalogRowPhoto = (row) =>
  coverThumbUrl(catalogPicture(row), ROW_WIDTH);

/** Картинка работы мастерской: обложка её редактора, иначе картинка вещи, сохранённая с работой; пусто — нечего показать. */
export function workPhoto(job, language) {
  const stock = stockCover(editorCoverKind(job?.coverSlotId), language)?.url;
  return stock || (typeof job?.coverImage === "string" ? job.coverImage : "");
}
