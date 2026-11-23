/*
 * Обложка вещи или ствола — в одну рамку (24.10.2026, владелец: одежда и ганпаки «подпрыгивают», большие карты обрезаны по краям).
 *
 * После вычитания матового поля (`cover-unbake.js`) кадр остался прежним: вещь вписана по высоте на 86 %, а широкая — по ширине на 80 %,
 * то есть зазор у высокой 47 точек сверху и снизу, а у широкой 120 слева и справа. Здесь прозрачный PNG перекадрируется по самой вещи:
 *
 *  1. рамка — по альфе, без полупрозрачной пыли (< `ALPHA_DUST` из 255): пыль заодно обнуляется, иначе она тянет рамку и остаётся в картинке;
 *  2. вещь вписывается в кадр 1200×675 так, чтобы зазор до края с ограничивающей стороны был `COVER_MARGIN` и одинаковый у всех, а по другой
 *     оси вещь стояла ровно по центру (зазоры с двух сторон равны); больше чем втрое не раздувается — мелочь не превращается в пятно;
 *  3. сжатие — Ланцош по предумноженной альфе (`sharp`), без каймы.
 *
 * Большая карта (`reframeMap`) — другое: она лежит на матовом поле и своим краем упирается в рамку кадра. Рамка содержимого — по отличию
 * от поля (вычитание поля даёт альфу), карта вписывается меньше, по центру, с равным зазором `MAP_MARGIN` со всех сторон, поле — то же поле.
 */

import sharp from "sharp";
import { COVER_HEIGHT, COVER_MARGIN, COVER_WIDTH, MAX_ENLARGE, fitScale, gapsOf } from "@modovik/gfx/cover-frame";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";
import { isOnMatte, transparentCover, unbake } from "./cover-unbake.js";

export { COVER_HEIGHT, COVER_MARGIN, COVER_WIDTH, MAX_ENLARGE, fitScale, gapsOf };
/** Альфа ниже этого — пыль: в рамку не входит и обнуляется. */
export const ALPHA_DUST = 8;
/** Зазор большой карты до края кадра, доля меньшей стороны с каждой стороны. */
export const MAP_MARGIN = 0.12;

/** Рамка непрозрачного содержимого по альфе: `{ left, top, right, bottom }` (правая и нижняя — за последним пикселем) или `null`. */
export function alphaBounds(data, width, height, dust = ALPHA_DUST) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < dust) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

const readRgba = async (input) => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Пыль (альфа ниже порога) — в ноль: цвет и альфа. */
function clearDust(data, dust = ALPHA_DUST) {
  for (let at = 3; at < data.length; at += 4)
    if (data[at] < dust) {
      data[at - 3] = 0;
      data[at - 2] = 0;
      data[at - 1] = 0;
      data[at] = 0;
    }
}

/**
 * Прозрачный PNG вещи или ствола → он же в кадре 1200×675 по рамке альфы. Обложка на матовом поле сначала освобождается от поля.
 * Ответ: `{ png, before, after, scale }` — зазоры до и после (`gapsOf`), `null` вместо картинки, если вещи в кадре нет.
 */
export async function reframeCover(input, { width = COVER_WIDTH, height = COVER_HEIGHT, margin = COVER_MARGIN } = {}) {
  const source = await transparentCover(input);
  const { data, width: sourceWidth, height: sourceHeight } = await readRgba(source);
  const found = alphaBounds(data, sourceWidth, sourceHeight);
  if (!found) return null;
  const before = gapsOf(found, sourceWidth, sourceHeight);
  clearDust(data);
  const box = { width: found.right - found.left, height: found.bottom - found.top };
  const scale = fitScale(box, { width, height, margin });
  const scaledWidth = Math.max(1, Math.round(box.width * scale));
  const scaledHeight = Math.max(1, Math.round(box.height * scale));
  const content = await sharp(data, { raw: { width: sourceWidth, height: sourceHeight, channels: 4 } })
    .extract({ left: found.left, top: found.top, width: box.width, height: box.height })
    .resize(scaledWidth, scaledHeight, { kernel: "lanczos3", fit: "fill" })
    .png()
    .toBuffer();
  const left = Math.floor((width - scaledWidth) / 2);
  const top = Math.floor((height - scaledHeight) / 2);
  const png = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: content, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const after = { left, right: width - left - scaledWidth, top, bottom: height - top - scaledHeight };
  return { png: new Uint8Array(png), before, after, scale };
}

/**
 * Большая карта на матовом поле → меньше, по центру, с равным зазором со всех сторон; поле — то же поле (`workshopMatteRgba`).
 * Рамка карты — по отличию от поля (альфа после вычитания поля). Ответ: `{ png, before, after, scale }` или `null`, если на кадре одно поле.
 */
export async function reframeMap(input, { margin = MAP_MARGIN } = {}) {
  if (!(await isOnMatte(input, { corners: true }))) return null;
  const { data, width, height } = await readRgba((await unbake(input)).png);
  const found = alphaBounds(data, width, height);
  if (!found) return null;
  const before = gapsOf(found, width, height);
  clearDust(data);
  const box = { width: found.right - found.left, height: found.bottom - found.top };
  const gap = Math.round(Math.min(width, height) * margin);
  const scale = Math.min((width - 2 * gap) / box.width, (height - 2 * gap) / box.height, 1);
  const scaledWidth = Math.max(1, Math.round(box.width * scale));
  const scaledHeight = Math.max(1, Math.round(box.height * scale));
  const content = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: found.left, top: found.top, width: box.width, height: box.height })
    .resize(scaledWidth, scaledHeight, { kernel: "lanczos3", fit: "fill" })
    .png()
    .toBuffer();
  const left = Math.floor((width - scaledWidth) / 2);
  const top = Math.floor((height - scaledHeight) / 2);
  const field = Buffer.from(workshopMatteRgba(width, height).buffer);
  const png = await sharp(field, { raw: { width, height, channels: 4 } })
    .composite([{ input: content, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const after = { left, right: width - left - scaledWidth, top, bottom: height - top - scaledHeight };
  return { png: new Uint8Array(png), before, after, scale };
}
