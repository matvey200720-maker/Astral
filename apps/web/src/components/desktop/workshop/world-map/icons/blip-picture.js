/*
 * Своя картинка значка (05.11.2026): любая картинка → PNG 64×64 с прозрачными полями, как клетка листа значков игры.
 * Целиком, без обрезки, по центру; прозрачность сохраняется. Игра красит значок в цвет метки, поэтому лучшая картинка —
 * белая на прозрачном фоне; цветная смешается с цветом метки.
 */

export const BLIP_PICTURE_SIDE = 64;

/**
 * @param {File|Blob} file исходная картинка (PNG, WebP, JPEG, GIF — первый кадр)
 * @param {string} [name] имя нового файла
 * @returns {Promise<File|null>} PNG 64×64 или `null`, если картинка не открылась
 */
export async function squareBlipPicture(file, name = "blip.png") {
  if (!file || typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const side = BLIP_PICTURE_SIDE;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const scale = Math.min(side / bitmap.width, side / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, Math.floor((side - width) / 2), Math.floor((side - height) / 2), width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], name, { type: "image/png" }) : null;
  } finally {
    bitmap.close?.();
  }
}
