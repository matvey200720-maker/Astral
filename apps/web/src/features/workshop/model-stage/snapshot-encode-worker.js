/*
 * Поток кодирования снимков 3D-плиток в WebP (`scene-snapshot.js`,
 * оптимизация ночи 12.10.2026). Кодирование `toBlob` в окне держало главный
 * поток — стенд мастерской: 190 мс за полку обложек, рывки прокрутки. Здесь
 * снимок рисуется на свой холст потока и кодируется целиком вне окна; окну
 * возвращается готовый `data:`-адрес.
 */

import { drawCover } from "./snapshot-draw.js";

self.onmessage = async (event) => {
  const { id, bitmap, quality, box = null, size = null, place = null } = event.data || {};
  try {
    /* `box` — кусок снимка, `size` — размер картинки, `place` — куда лечь в ней (обложка работы): обрезка и уменьшение тоже здесь, а не в окне. */
    const from = box || [0, 0, bitmap.width, bitmap.height];
    const to = size || [from[2], from[3]];
    const canvas = new OffscreenCanvas(to[0], to[1]);
    drawCover(canvas.getContext("2d"), bitmap, { from, to, place });
    bitmap.close?.();
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    self.postMessage({ id, url });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
