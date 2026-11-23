/*
 * Порядок плиток окна «На что поставить?» (общая ведущая, 16.11.2026): в каждом разделе каждой вкладки плитки с картинкой идут первыми, без картинки — после.
 *
 * Зачем. База Majestic пересобрана из дампа (4155 → 7874 вещей): три тысячи новых вещей без фото, у рук и перчаток почти все строки — запасные имена «Руки и перчатки №0.13». Такие плитки (значок вида, имя) не должны
 * вклиниваться между вещами с фото: человек выбирает по картинке.
 *
 * «Есть картинка» на стороне окна — у вещи есть источник, а не готовый файл: адрес по сквозному номеру (`global ≥ 0`: зеркало на CDN, файл GTA5RP, картинка вики), свой адрес (`preview`, снимок каталога), обложка карточки (`extra.pic`) или —
 * только у вещи самой игры (вкладка «GTA») — снимок из игры. У вещи сервера снимок из игры не считается: её файла в игре нет. Списки файлов зеркала в окно не едут; плитка, чей адрес не отдался (404), остаётся там, где стояла: порядок
 * строится до загрузки и по ходу не прыгает.
 *
 * Сортировка устойчивая: порядок внутри обеих частей прежний (полки, имена, номера). Остаются среди первых и не уходят вниз: вещи, что советует автор (`held`); вещь «по умолчанию» окно ставит первой уже после порядка.
 */
import {
  itemCoverUrl,
  itemPictureUrl,
} from "../../../features/clothing/item-picture.js";
import { canShootItem } from "./item-shots.js";

/** У вещи есть источник картинки (см. шапку файла). */
export function hasPictureSource(item, majesticImages = null) {
  if (!item) return false;
  if (itemPictureUrl(item, majesticImages) || itemCoverUrl(item)) return true;
  return !item.server && canShootItem(item);
}

/** 0 — вещь стоит среди первых (с картинкой или в `held`), 1 — после. */
export const pictureRank = (tile, majesticImages = null, held = null) =>
  held?.(tile) || hasPictureSource(tile.item, majesticImages) ? 0 : 1;

/** Плитки: с картинкой первыми, без — после; порядок внутри частей прежний. Нечего разделять — тот же массив. */
export function pictureFirst(tiles, majesticImages = null, held = null) {
  const first = [];
  const last = [];
  for (const tile of tiles)
    (pictureRank(tile, majesticImages, held) === 0 ? first : last).push(tile);
  return first.length && last.length ? [...first, ...last] : tiles;
}
