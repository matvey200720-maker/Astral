/*
 * Перекраска плиток тумана воды и рек — чистые функции (ТЗ 06.10.2026,
 * вечер): их считает пул потоков (`heavy-work.js`), а не главный процесс.
 * Прежде сотни плиток (BC7 на каждом уровне mip) красились в главном потоке
 * с передышкой каждые восемь плиток — окно подёргивалось всю сборку воды.
 * Модуль ничего не тянет из Electron — его можно грузить в поток.
 */

import { decodeTexture, encodeBc7, encodeBlocks, levelBytes } from "@modovik/dds";
import { WATER_EFFECT_BOUNDS, recolourWaterFogLevel, waterFogTexel } from "@modovik/climb-contract/recolor/water";
import { patchResourceTextures, readResourceTextures } from "./recolor-textures.js";

/* Уровень RGBA → байты формата текстуры; незнакомый формат — `null`. */
function encodeLevel(format, rgba, width, height) {
  if (format === "BC7") return encodeBc7(rgba, width, height);
  if (format === "DXT1" || format === "DXT3" || format === "DXT5") return encodeBlocks(format, rgba, width, height);
  if (format === "A8R8G8B8" || format === "A8B8G8R8") {
    const out = new Uint8Array(width * height * 4);
    for (let at = 0; at < out.length; at += 4) {
      const [r, b] = format === "A8R8G8B8" ? [rgba[at + 2], rgba[at]] : [rgba[at], rgba[at + 2]];
      out[at] = r;
      out[at + 1] = rgba[at + 1];
      out[at + 2] = b;
      out[at + 3] = rgba[at + 3];
    }
    return out;
  }
  return null;
}

/**
 * Новые байты текстуры: каждый уровень mip — `recolour(rgba, w, h, уровень)`.
 * Уровень, который правка не меняет, остаётся байт в байт; ни один не
 * изменился — `null`.
 */
function recolourTexture(texture, recolour) {
  const payload = Buffer.from(texture.payload);
  let offset = 0;
  let changed = false;
  for (let level = 0; level < texture.levels; level += 1) {
    const width = Math.max(1, texture.width >> level);
    const height = Math.max(1, texture.height >> level);
    const size = levelBytes(texture.format, width, height);
    if (offset + size > payload.length) break;
    const rgba = decodeTexture(texture.format, payload.subarray(offset, offset + size), width, height);
    const next = recolour(rgba, width, height, level);
    if (next && Buffer.compare(Buffer.from(next.buffer, next.byteOffset, next.byteLength), Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)) !== 0) {
      const encoded = encodeLevel(texture.format, next, width, height);
      if (!encoded || encoded.length !== size) return null;
      payload.set(encoded, offset);
      changed = true;
    }
    offset += size;
  }
  return changed ? payload : null;
}

/** Плитка тумана в облике работы или `null`, если она не меняется. */
export function recolourFogTile(bytes, fileName, rect, looks, lakes) {
  const textures = readResourceTextures(bytes, fileName);
  const replacements = {};
  for (const texture of textures) {
    const payload = recolourTexture(texture, (rgba, width, height) => recolourWaterFogLevel(rgba, width, height, rect, looks, lakes));
    if (payload) replacements[texture.name] = payload;
  }
  if (!Object.keys(replacements).length) return null;
  return patchResourceTextures(bytes, fileName, replacements).bytes;
}

/* Середина карты — место реки, которое опись не нашла. */
const MAP_MIDDLE = Object.freeze([
  (WATER_EFFECT_BOUNDS.west + WATER_EFFECT_BOUNDS.east) / 2,
  (WATER_EFFECT_BOUNDS.south + WATER_EFFECT_BOUNDS.north) / 2,
]);

/**
 * Туман реки: облик «Озёра и реки» по месту реки. Отмель — по яркости
 * внутри самой текстуры (туман рек темнее морского, по морской мерке он
 * весь вышел бы «глубиной»); ровная текстура — середина между отмелью и
 * глубью.
 */
function recolourRiverLevel(rgba, width, height, look, centre) {
  let low = Infinity;
  let high = -Infinity;
  const lumas = new Float32Array(width * height);
  for (let at = 0, pixel = 0; at < rgba.length; at += 4, pixel += 1) {
    const value = 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
    lumas[pixel] = value;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const flat = high - low < 8;
  const out = new Uint8ClampedArray(rgba);
  const texel = [0, 0, 0];
  const point = { s: 0.6, x: centre[0], y: centre[1] };
  for (let at = 0, pixel = 0; at < rgba.length; at += 4, pixel += 1) {
    point.s = flat ? 0.6 : 0.3 + (0.6 * (lumas[pixel] - low)) / (high - low);
    waterFogTexel(look.compiled, point, texel);
    out[at] = texel[0];
    out[at + 1] = texel[1];
    out[at + 2] = texel[2];
  }
  return out;
}

/** Файл реки в облике работы или `null`, если его туман не меняется. */
export function recolourRiverFile(bytes, river, looks) {
  if (!looks.inland.tint) return null;
  const wanted = new Map(river.textures.map((texture) => [texture.name.toLowerCase(), texture.centre || MAP_MIDDLE]));
  const replacements = {};
  for (const texture of readResourceTextures(bytes, river.name)) {
    const centre = wanted.get(texture.name.toLowerCase());
    if (!centre) continue;
    const payload = recolourTexture(texture, (rgba, width, height) => recolourRiverLevel(rgba, width, height, looks.inland, centre));
    if (payload) replacements[texture.name] = payload;
  }
  if (!Object.keys(replacements).length) return null;
  return patchResourceTextures(bytes, river.name, replacements).bytes;
}
