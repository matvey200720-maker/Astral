import {
  billboardPicture,
  billboardPixels,
  paintBillboardOnSheet,
} from "@modovik/climb-contract/recolor/billboards";

const cloneRgba = (rgba) => new Uint8ClampedArray(rgba);

// Один щит ложится на готовый лист на месте. Картинку под место щита сосед
// запрашивает сам: размер места считается ровно тогда, когда он нужен.
export function paintBillboardItem(
  pixels,
  sheetWidth,
  sheetHeight,
  { entry: face, look, image: art, drawing: overlay, aspect },
  frame = 0,
) {
  function pictureAt(place) {
    return billboardPicture(look, art, ...billboardPixels(place, sheetWidth, sheetHeight), aspect, overlay, frame);
  }
  const area = { width: sheetWidth, height: sheetHeight };
  paintBillboardOnSheet(pixels, area.width, area.height, face, look, pictureAt);
}

// Щиты ложатся по порядку, каждый следующий поверх.
function layShields(sheet, source, items, frame) {
  for (const shield of items) {
    paintBillboardItem(sheet, source.width, source.height, shield, frame);
  }
  return sheet;
}

export const billboardSheetPixels = ({ base: source, items }, frame = 0) =>
  layShields(cloneRgba(source.rgba), source, items, frame);
