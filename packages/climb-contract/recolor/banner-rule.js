/*
 * «Баннеры на зданиях»: какое полотно считается большим (слово владельца 30.10.2026: «большие билборды на зданиях — Mile High Club,
 * Fame or Shame, Центральный банк, ТЦ Бёртон, Pacific Standard; маленькие баннеры, билбордики и арену Maze Bank убрать»).
 *
 * Правило одно, числом, и от него зависят и опись мест (`scripts/prepare-banner-sites.mjs`), и меню окна, и тест:
 *
 *   большое полотно — высота не меньше `BANNER_MIN_HEIGHT` м (около пяти этажей), площадь не меньше `BANNER_MIN_AREA` м²,
 *   и оно не делит место на листе со щитом у дороги (`bannerSharesShield`).
 *
 * Размер берётся по картинке полотна (`pictureSize`, если она есть: изгиб Flow на углу банка — 12 × 26,6 м, а не прямой кусок у стены),
 * иначе по самому щиту (`size`). Высота — вторая сторона `[ширина, высота]` описи билбордов.
 *
 * Третье условие — вывеска-столб, а не баннер на стене: две стороны `ss1_08_sign01` (9,4 × 25,3 м) стоят на одном листе с четырьмя
 * уличными щитами, их картинка одна (`linkedBillboards`), и правится она в «Билбордах» вместе со щитами. Такое полотно в «Баннерах
 * на зданиях» было бы чужим щитом на здании, которого нет.
 */

import { billboard, billboardIsShield, linkedBillboards } from "./billboards.js";

/** Высота полотна, м: ниже — вывеска, щит на крыше или полотно на ограде, а не баннер на стене здания. */
export const BANNER_MIN_HEIGHT = 15;
/** Площадь полотна, м²: меньше — узкая лента или малый баннер. */
export const BANNER_MIN_AREA = 200;

/** `[ширина, высота]` полотна в метрах — по картинке, а если её размера нет, то по щиту. */
export function bannerSize(board) {
  const size = Array.isArray(board?.pictureSize) ? board.pictureSize : board?.size;
  return [Number(size?.[0]) || 0, Number(size?.[1]) || 0];
}

/** Площадь полотна, м². */
export const bannerArea = (board) => {
  const [width, height] = bannerSize(board);
  return width * height;
};

/** Полотно делит место на листе с обычным щитом (картинка у них одна): это вывеска-щит, а не баннер на стене здания. */
export const bannerSharesShield = (board) => Boolean(board?.id) && linkedBillboards(board.id).some((id) => id !== board.id && billboardIsShield(billboard(id)));

/** Полотно большое: попадает в «Баннеры на зданиях». */
export function bannerIsLarge(board) {
  const [, height] = bannerSize(board);
  return height >= BANNER_MIN_HEIGHT && bannerArea(board) >= BANNER_MIN_AREA && !bannerSharesShield(board);
}
