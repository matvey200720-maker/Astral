/*
 * Обложка маппинга: кадр сцены мода и карта «где стоят» вставкой (ТЗ 27.10.2026, владелец: «для всех превьюшек» — настоящий кадр).
 *
 * Карточка части маппинга с картами размещения (`.ymap`) была картой мира с жёлтыми точками — это рисунок-схема, а не кадр. Теперь, когда у мода
 * есть свои модели, обложка — они сами своими листами на сцене мастерской (`mod-model-scene.js`), а карта мест остаётся мелкой вставкой в углу:
 * по ней видно, где в мире мод стоит. Моделей нет — прежняя карта целиком.
 */

import sharp from "sharp";

/** Доля ширины кадра под вставку и отступ от края. */
export const INSET = Object.freeze({ share: 0.3, margin: 0.025 });
/** Угол свободен, если содержимого (точек, что отличаются от фона кадра больше, чем на `delta` по каналу) под вставкой не больше этой доли. */
export const FREE_CORNER = Object.freeze({ delta: 14, share: 0.02, patch: 12 });
const RADIUS = 0.08;
const BORDER = 3;

const roundedMask = (width, height, radius) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);

/**
 * Пуст ли прямоугольник кадра `raw` (RGB/RGBA, `channels` каналов): фон — средний цвет четырёх углов кадра, содержимое — точки, что от него отличаются. Здание, что
 * доходит до угла, закрывать вставкой нельзя.
 */
export function cornerIsFree({ data, width, height, channels }, { left, top, boxWidth, boxHeight }) {
  const { delta, share, patch } = FREE_CORNER;
  const at = (x, y, channel) => data[(y * width + x) * channels + channel];
  const background = [0, 1, 2].map((channel) => {
    let sum = 0;
    let count = 0;
    for (const [x0, y0] of [[0, 0], [width - patch, 0], [0, height - patch], [width - patch, height - patch]])
      for (let y = y0; y < y0 + patch; y += 1)
        for (let x = x0; x < x0 + patch; x += 1) {
          sum += at(x, y, channel);
          count += 1;
        }
    return sum / count;
  });
  let busy = 0;
  for (let y = top; y < Math.min(height, top + boxHeight); y += 2)
    for (let x = left; x < Math.min(width, left + boxWidth); x += 2) if ([0, 1, 2].some((channel) => Math.abs(at(x, y, channel) - background[channel]) > delta)) busy += 1;
  return busy <= share * Math.ceil(boxWidth / 2) * Math.ceil(boxHeight / 2);
}

/**
 * Кадр `scene` (PNG) с картой `map` (PNG) вставкой в правом верхнем углу (сцена мода стоит ниже центра, верх кадра пуст): скруглённая, с тонкой светлой рамкой, чтобы не терялась на тёмной сцене.
 * Размер кадра сохраняется. `null`, если карта или кадр не читаются, — вызывающий оставляет кадр без вставки. `free: true` — вставка только на пустое место: здание, что
 * доходит до угла (фасад крупно), вставкой не закрывается, и `null` значит «угол занят» (карта идёт в галерею).
 */
export async function withMapInset(scene, map, { share = INSET.share, margin = INSET.margin, free = false } = {}) {
  try {
    const base = sharp(Buffer.from(scene));
    const { width, height } = await base.metadata();
    if (!width || !height) return null;
    const insetWidth = Math.round(width * share);
    const picture = sharp(Buffer.from(map));
    const meta = await picture.metadata();
    if (!meta.width || !meta.height) return null;
    const insetHeight = Math.round((insetWidth * meta.height) / meta.width);
    const radius = Math.round(insetWidth * RADIUS);
    if (free) {
      const raw = await sharp(Buffer.from(scene)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const room = { left: width - insetWidth - Math.round(width * margin), top: Math.round(width * margin), boxWidth: insetWidth, boxHeight: insetHeight };
      if (!cornerIsFree({ data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels }, room)) return null;
    }
    const inner = await picture
      .resize(insetWidth - BORDER * 2, insetHeight - BORDER * 2, { fit: "fill" })
      .composite([{ input: roundedMask(insetWidth - BORDER * 2, insetHeight - BORDER * 2, Math.max(0, radius - BORDER)), blend: "dest-in" }])
      .png()
      .toBuffer();
    const framed = await sharp({ create: { width: insetWidth, height: insetHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.55 } } })
      .composite([
        { input: roundedMask(insetWidth, insetHeight, radius), blend: "dest-in" },
        { input: inner, left: BORDER, top: BORDER },
      ])
      .png()
      .toBuffer();
    const gap = Math.round(width * margin);
    const merged = await base
      .composite([{ input: framed, left: width - insetWidth - gap, top: gap }])
      .png()
      .toBuffer();
    return new Uint8Array(merged);
  } catch {
    return null;
  }
}
