/*
 * Ровная заливка текстуры — байтами того формата, в котором она лежит.
 *
 * У модов завода и запретных зон каждая текстура — клетка 4×4 одного цвета:
 * перекрасить её — значит записать новую заливку на место старой, того же
 * формата и того же числа уровней. Длина обязана совпасть до байта: правка
 * на месте (`patchDrawable` в `@modovik/ypt`) не двигает страницы ресурса.
 */

import { wallbangDxt5Block } from "../wallbang/index.js";

const BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16 });
const PIXEL_BYTES = Object.freeze({ A8R8G8B8: 4, A8B8G8R8: 4 });

/** Сколько байт занимает уровень текстуры. */
export function levelByteLength(format, width, height) {
  if (BLOCK_BYTES[format])
    return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * BLOCK_BYTES[format];
  if (PIXEL_BYTES[format]) return width * height * PIXEL_BYTES[format];
  throw new RangeError(`Формат текстуры ${format} ровной заливкой не пишется.`);
}

/** Все уровни текстуры подряд. */
export function textureByteLength({ format, width, height, levels = 1 }) {
  let total = 0;
  for (let level = 0; level < levels; level += 1)
    total += levelByteLength(format, Math.max(1, width >> level), Math.max(1, height >> level));
  return total;
}

/*
 * Блок DXT одного цвета. Цвет DXT5 — тот же расчёт, что у оболочек
 * прострелов (`wallbangDxt5Block`: точный цвет, если он есть в 5-6-5, иначе
 * ближайший из трети между концами, первый конец больше второго — это
 * четырёхцветный режим и у DXT1). DXT1 — цветовая половина того же блока;
 * DXT3 — явная альфа по четыре бита.
 */
export function flatBlock(format, [r, g, b], alpha = 255) {
  const dxt5 = wallbangDxt5Block([r, g, b], alpha);
  if (format === "DXT5") return dxt5;
  if (format === "DXT1") return dxt5.slice(8, 16);
  if (format === "DXT3") {
    const block = new Uint8Array(16);
    const nibble = Math.max(0, Math.min(15, Math.round(alpha / 17)));
    block.fill(nibble * 17, 0, 8);
    block.set(dxt5.subarray(8, 16), 8);
    return block;
  }
  throw new RangeError(`Формат ${format} — не блочный.`);
}

/**
 * Полная текстура ровного цвета: все уровни, байт в байт той длины, что
 * заявляет модель. `alpha` — 0…255.
 */
export function flatTexturePayload(texture, rgb, alpha = 255) {
  const { format } = texture;
  const out = new Uint8Array(textureByteLength(texture));
  if (BLOCK_BYTES[format]) {
    const block = flatBlock(format, rgb, alpha);
    for (let at = 0; at < out.length; at += block.length) out.set(block, at);
    return out;
  }
  if (!PIXEL_BYTES[format]) throw new RangeError(`Формат текстуры ${format} ровной заливкой не пишется.`);
  const [r, g, b] = rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))));
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  /* A8R8G8B8 лежит в памяти как B, G, R, A; A8B8G8R8 — как R, G, B, A. */
  const pixel = format === "A8R8G8B8" ? [b, g, r, a] : [r, g, b, a];
  for (let at = 0; at < out.length; at += 4) out.set(pixel, at);
  return out;
}
