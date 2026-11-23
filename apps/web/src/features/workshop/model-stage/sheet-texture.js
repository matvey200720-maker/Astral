/*
 * Сжатый лист (`sheet-container.js`) как текстура сцены (этап 2 «3D на Rust», шаг A1).
 *
 * Сцена создаёт `new THREE.Texture()` заранее, до прихода картинки (`orbit-stage.js`, `textureFor`: NoColorSpace, flipY = false,
 * RepeatWrapping по обеим осям, анизотропия 4), и материалы уже держат ссылку на этот объект. Поэтому сжатый лист не создаёт
 * новую текстуру, а «надевается» на уже существующую (`applySheet`): та же ссылка, другие данные. Формат `RGBA_S3TC_*` и
 * `RGBA_BPTC_Format` — без sRGB-вариантов: шейдер линеаризует сам, как у листов из WebP.
 *
 * Чистые функции, без сцены и без DOM. Подключение к `orbit-stage.js` — отдельный шаг.
 */

import { LinearFilter, LinearMipmapLinearFilter, RGBA_BPTC_Format, RGBA_S3TC_DXT1_Format, RGBA_S3TC_DXT3_Format, RGBA_S3TC_DXT5_Format, UnsignedByteType } from "three";
import { decodeBc7 } from "@modovik/dds";

/** Имя формата листа → формат three (не sRGB-варианты). */
export const SHEET_GL_FORMATS = Object.freeze({
  DXT1: RGBA_S3TC_DXT1_Format,
  DXT3: RGBA_S3TC_DXT3_Format,
  DXT5: RGBA_S3TC_DXT5_Format,
  BC7: RGBA_BPTC_Format,
});

const NAME_OF_GL = new Map(Object.entries(SHEET_GL_FORMATS).map(([name, format]) => [format, name]));
const BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16, BC7: 16 });

/** Формат three для имени формата листа или `null`. */
export function sheetGlFormat(format) {
  return Object.hasOwn(SHEET_GL_FORMATS, format) ? SHEET_GL_FORMATS[format] : null;
}

/** Имя формата листа по формату three (или `null`, если текстура не из листа). */
export function sheetFormatName(glFormat) {
  return NAME_OF_GL.get(glFormat) ?? null;
}

/**
 * Какие форматы листов умеет эта видеокарта — будущий `accept` запроса листов. Принимает `THREE.WebGLRenderer` или контекст
 * WebGL; нет расширений — пустой список. S3TC даёт DXT1, DXT3 и DXT5, BPTC — BC7.
 */
export function sheetFormatsOf(source) {
  const has = (name) => {
    try {
      if (typeof source?.extensions?.has === "function") return Boolean(source.extensions.has(name));
      if (typeof source?.getExtension === "function") return Boolean(source.getExtension(name));
    } catch {
      /* потерянный контекст — расширений нет */
    }
    return false;
  };
  const formats = [];
  if (has("WEBGL_compressed_texture_s3tc")) formats.push("DXT1", "DXT3", "DXT5");
  if (has("EXT_texture_compression_bptc")) formats.push("BC7");
  return formats;
}

/** Сколько байт лист занимает на видеокарте: сумма уровней (достроенные тоже). */
export function sheetBytes(sheet) {
  let total = 0;
  for (const level of sheet?.mipmaps ?? []) total += level.data.length;
  return total;
}

/**
 * Превращает существующий `THREE.Texture` в сжатый на месте: `isCompressedTexture`, формат, `mipmaps`, `image = { width, height }`,
 * без `generateMipmaps`, фильтры с мипами. Обёртку, анизотропию, flipY, цветовое пространство и прочие поля не трогает; в `userData.sheet`
 * кладёт формат, признак альфы, байты на видеокарте и размеры. Сразу же ставит `needsUpdate`: three заведёт новую GL-текстуру
 * (ключ кэша меняется вместе с форматом и `generateMipmaps`) и выбросит прежнюю. Обратного превращения нет. Возвращает ту же текстуру.
 *
 * @param {import("three").Texture} texture
 * @param {{ kind: string, format: string, width: number, height: number, mipmaps: Array<{ data: Uint8Array, width: number, height: number }>, alpha?: boolean, synthesized?: number }} sheet запись `parseSheets` вида «bcn»
 */
export function applySheet(texture, sheet) {
  const format = sheetGlFormat(sheet?.format);
  if (sheet?.kind !== "bcn" || format === null || !sheet.mipmaps?.length) throw new TypeError("applySheet: нужен лист вида «bcn» с уровнями.");
  texture.isCompressedTexture = true;
  texture.format = format;
  texture.type = UnsignedByteType;
  texture.internalFormat = null;
  texture.mipmaps = sheet.mipmaps;
  texture.image = { width: sheet.mipmaps[0].width, height: sheet.mipmaps[0].height };
  texture.generateMipmaps = false;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.userData.sheet = {
    format: sheet.format,
    alpha: Boolean(sheet.alpha),
    bytes: sheetBytes(sheet),
    levels: sheet.mipmaps.length,
    synthesized: sheet.synthesized ?? 0,
    width: sheet.mipmaps[0].width,
    height: sheet.mipmaps[0].height,
  };
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ альфа одного пикселя */

/** Палитра альфы блока DXT5 (как у разборщика пакета: промежуточные — ближайшее целое от дроби). */
function dxt5Alpha(block, texel) {
  const a0 = block[0];
  const a1 = block[1];
  const bits = texel < 8 ? block[2] | (block[3] << 8) | (block[4] << 16) : block[5] | (block[6] << 8) | (block[7] << 16);
  const code = (bits >> (3 * (texel & 7))) & 7;
  if (code === 0) return a0;
  if (code === 1) return a1;
  if (a0 > a1) return Math.floor((2 * ((8 - code) * a0 + (code - 1) * a1) + 7) / 14);
  if (code === 6) return 0;
  if (code === 7) return 255;
  return Math.floor((2 * ((6 - code) * a0 + (code - 1) * a1) + 5) / 10);
}

/**
 * Альфа одного пикселя уровня 0 листа (0…1) — для щелчка сквозь прозрачные места. `texture` — сжатый лист (`applySheet`);
 * (u, v) оборачиваются как в `pick-surface.js` (`value − floor(value)`), строка берётся от `v` без переворота (flipY = false).
 * Не лист — `null`, чтобы вызывающий взял прежний путь (холст, байты). Разбирается один блок: DXT — прямо, BC7 — пакетом `@modovik/dds`.
 */
export function sheetTexelAlpha(texture, u, v) {
  const name = texture?.isCompressedTexture ? sheetFormatName(texture.format) : null;
  const level = name ? texture.mipmaps?.[0] : null;
  if (!level) return null;
  const wrap = (value) => (Number.isFinite(value) ? value - Math.floor(value) : 0);
  const x = Math.min(level.width - 1, Math.floor(wrap(u) * level.width));
  const y = Math.min(level.height - 1, Math.floor(wrap(v) * level.height));
  const size = BLOCK_BYTES[name];
  const at = ((y >> 2) * Math.ceil(level.width / 4) + (x >> 2)) * size;
  const block = level.data.subarray(at, at + size);
  const texel = (y & 3) * 4 + (x & 3);
  if (block.length < size) return 1;
  if (name === "DXT1") {
    const c0 = block[0] | (block[1] << 8);
    const c1 = block[2] | (block[3] << 8);
    const index = (block[4 + (texel >> 2)] >> ((texel & 3) * 2)) & 3;
    return c0 <= c1 && index === 3 ? 0 : 1;
  }
  if (name === "DXT3") return (texel % 2 === 0 ? block[texel >> 1] & 15 : block[texel >> 1] >> 4) / 15;
  if (name === "DXT5") return dxt5Alpha(block, texel) / 255;
  return decodeBc7(block, 4, 4)[texel * 4 + 3] / 255;
}
