/*
 * Обложка «Большая карта» части редукса: остров целиком, без поля и рамок (13.11.2026).
 *
 * Карта паузы автора тёмная (остров ~20 на матовом поле 15), и окно страницы мода, что подгоняет кадр под «рамку рисунка»,
 * резало её по ярким подписям (владелец: «большая карта … фоточки обрезал»). Карта остаётся такой, какой её нарисовал автор,
 * без осветления и подложек; поле вокруг неё прозрачное — такой кадр окно меряет по непрозрачным точкам, то есть по самой
 * карте, и показывает её целиком (`@modovik/gfx/map-card`). Серую рамку-карточку первой версии владелец запретил.
 *
 * Без окна и без игры: `mapPackCover` (плитки автора) → PNG с прозрачным полем, через `sharp`.
 */

import sharp from "sharp";
import { contentRoom } from "@modovik/gfx/map-card";

/** Пиксель «закрашен», если его альфа выше порога (как `drawnBounds` окна). */
const INK_ABOVE = 8;

/** Доля высоты кадра под зазор вокруг острова (`gap` у `mapPackCover`). Имя прежнее — его зовёт `part-covers.js`. */
export const cardGapRatio = (size) => contentRoom(size).margin / size.height;

/** Границы закрашенного (`{ x, y, width, height }`) или `null`, если кадр пуст. */
export function inkBounds(rgba, width, height, above = INK_ABOVE) {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (!(rgba[(y * width + x) * 4 + 3] > above)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  return right < 0
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * PNG обложки: карта автора как есть, поле вокруг неё прозрачное. Имя прежнее (`cardMapPng`) — его зовёт `part-covers.js`.
 * @param {{ rgba: Uint8Array|Uint8ClampedArray, width: number, height: number }} cover результат `mapPackCover`
 * @returns {Promise<Uint8Array|null>} `null` — на карте нет закрашенного
 */
export async function cardMapPng({ rgba, width, height }) {
  if (!inkBounds(rgba, width, height)) return null;
  const png = await sharp(
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    { raw: { width, height, channels: 4 } },
  )
    .png()
    .toBuffer();
  return new Uint8Array(png);
}
