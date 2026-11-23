/*
 * Новые пиксели текстуры ресурса — все уровни, байт в байт той длины, что у
 * файла.
 *
 * Правка текстуры на месте (`patchResourceTextures`) пишет готовые байты
 * поверх старых: у них должны быть те же формат, размер и число уровней.
 * Здесь из нового первого уровня RGBA считаются остальные (среднее четырёх
 * соседей) и каждый кодируется в формат текстуры: сжатые блоки DXT1/3/5 —
 * кодеком `@modovik/dds`, несжатые — перестановкой каналов.
 */

import { encodeBlocks } from "@modovik/dds";
import { halve } from "./recolor-pixels.js";

const BLOCK_FORMATS = new Set(["DXT1", "DXT3", "DXT5"]);

function encodeLevel(format, rgba, width, height) {
  if (BLOCK_FORMATS.has(format)) return encodeBlocks(format, rgba, width, height);
  const count = width * height;
  switch (format) {
    case "A8R8G8B8": {
      const out = new Uint8Array(count * 4);
      for (let at = 0; at < out.length; at += 4) {
        out[at] = rgba[at + 2];
        out[at + 1] = rgba[at + 1];
        out[at + 2] = rgba[at];
        out[at + 3] = rgba[at + 3];
      }
      return out;
    }
    case "A8B8G8R8":
      return new Uint8Array(rgba.buffer, rgba.byteOffset, count * 4).slice();
    case "A8":
    case "L8": {
      const out = new Uint8Array(count);
      const channel = format === "A8" ? 3 : 0;
      for (let index = 0; index < count; index += 1) out[index] = rgba[index * 4 + channel];
      return out;
    }
    default:
      throw new Error(`Текстура формата ${format} этой правкой не пишется.`);
  }
}

const BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16 });

/*
 * Маска изменённых текселей первого уровня и её уменьшение на уровень
 * ниже: тексель уровня изменён, если изменён любой из четырёх под ним.
 */
function changedMask(rgba, original, width, height) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const at = index * 4;
    if (
      rgba[at] !== original[at] ||
      rgba[at + 1] !== original[at + 1] ||
      rgba[at + 2] !== original[at + 2] ||
      rgba[at + 3] !== original[at + 3]
    )
      mask[index] = 1;
  }
  return mask;
}
function halveMask(mask, width, height) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let any = 0;
      for (let dy = 0; dy < 2 && !any; dy += 1)
        for (let dx = 0; dx < 2 && !any; dx += 1) {
          const sx = Math.min(width - 1, x * 2 + dx);
          const sy = Math.min(height - 1, y * 2 + dy);
          any = mask[sy * width + sx];
        }
      out[y * w + x] = any;
    }
  return out;
}

/**
 * Все уровни текстуры из первого: `texture` — запись `readResourceTextures`
 * (`format`, `width`, `height`, `levels`, `bytes`), `rgba` — первый уровень
 * размером `width × height`.
 *
 * `original` — первый уровень до правки (RGBA того же размера) и
 * `originalData` — сжатые байты текстуры в игре (все уровни): тогда у
 * сжатых форматов пережимаются только блоки 4×4, где что-то поменялось, а
 * остальные остаются байт в байт как в игре — на каждом уровне. Иначе
 * правка одного здания в атласе квартала (SLOD) пережимала бы весь квартал
 * чужим кодеком: соседние дома вдали теряли бы чёткость без всякой правки.
 */
export function texturePayload(texture, rgba, { original = null, originalData = null } = {}) {
  const blockBytes = BLOCK_BYTES[texture.format] || 0;
  const keep = Boolean(
    blockBytes && original && original.length === rgba.length && originalData && originalData.length === Number(texture.bytes?.length ?? texture.bytes),
  );
  /* `bytes` записи — сами байты или их длина (`readTextureDictionary`). */
  const out = keep ? new Uint8Array(originalData) : new Uint8Array(texture.bytes);
  let mask = keep ? changedMask(rgba, original, texture.width, texture.height) : null;
  let level = { rgba, width: texture.width, height: texture.height };
  let offset = 0;
  for (let index = 0; index < texture.levels; index += 1) {
    const encoded = encodeLevel(texture.format, level.rgba, level.width, level.height);
    if (offset + encoded.length > out.length)
      throw new Error(`Текстура ${texture.name}: уровни длиннее самой текстуры.`);
    if (keep) {
      /* Блок без изменённых текселей — прежние байты игры (они уже в `out`). */
      const columns = Math.max(1, Math.ceil(level.width / 4));
      const rows = Math.max(1, Math.ceil(level.height / 4));
      for (let by = 0; by < rows; by += 1)
        for (let bx = 0; bx < columns; bx += 1) {
          let touched = false;
          for (let y = by * 4; y < Math.min(level.height, by * 4 + 4) && !touched; y += 1)
            for (let x = bx * 4; x < Math.min(level.width, bx * 4 + 4) && !touched; x += 1)
              if (mask[y * level.width + x]) touched = true;
          if (!touched) continue;
          const at = (by * columns + bx) * blockBytes;
          out.set(encoded.subarray(at, at + blockBytes), offset + at);
        }
    } else out.set(encoded, offset);
    offset += encoded.length;
    if (index + 1 < texture.levels) {
      if (keep) mask = halveMask(mask, level.width, level.height);
      level = halve(level.rgba, level.width, level.height);
    }
  }
  if (offset !== out.length)
    throw new Error(`Текстура ${texture.name}: уровни не сошлись с длиной (${offset} из ${out.length}).`);
  return Buffer.from(out);
}
