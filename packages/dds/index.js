// Текстуры DDS: чтение уровней любых читаемых форматов в RGBA, сборка DDS из RGBA с цепочкой mip-уровней,
// проверка раскладки, уменьшение и пересчёт размера, дозаливка цвета под прозрачные пиксели.
// Горячий модуль: работает на типизированных массивах и не заводит объект на пиксель.
// Заголовок и блочные кодеки лежат у соседей; часть их имён отдаётся наружу как есть.

import { BLOCK_FORMATS, DDS_HEADER_BYTES, READABLE_FORMATS, levelBytes, readDdsHeader, writeDdsHeader } from "./header.js";
import { decodeBlocks, encodeBlocks, encodeBlocksJs, hasNativeBlockEncoder, setNativeBlockEncoder } from "./block-codec.js";
import { decodeBc4, decodeBc5, decodeBc7, decodeUncompressed } from "./bc-decode.js";

export { BLOCK_FORMATS, DDS_HEADER_BYTES, READABLE_FORMATS, levelBytes, readDdsHeader, writeDdsHeader };
export { decodeBlocks, encodeBlocks, encodeBlocksJs, hasNativeBlockEncoder, setNativeBlockEncoder };
export { decodeBc4, decodeBc5, decodeBc7 };
export { encodeBc7 } from "./bc7-encode.js";

const MAX_SIDE = 8192;
const MAX_MIP_LEVELS = 16;
const MAX_READ_BYTES = 32 * 1024 * 1024;
const WRITABLE_FORMATS = new Set(["DXT1", "DXT3", "DXT5", "A8R8G8B8"]);
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

// Ложные значения — пустой массив, число N — N нулевых байт, остальное копируется конструктором.
const bytesFrom = (input) => (input instanceof Uint8Array ? input : new Uint8Array(input || 0));
const isSide = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_SIDE;
const clampedFrom = (rgba) => (rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba || 0));

// ---------------------------------------------------------------- чтение

// Как читать один уровень по имени формата: блочные DXT — общим декодером, остальные — каждый своим.
const LEVEL_DECODERS = new Map([
  ...BLOCK_FORMATS.map((name) => [name, decodeBlocks]),
  ["BC7", (name, data, width, height) => decodeBc7(data, width, height)],
  ["ATI1", (name, data, width, height) => decodeBc4(data, width, height)],
  ["ATI2", (name, data, width, height) => decodeBc5(data, width, height)],
]);

export function decodeTexture(format, data, width, height) {
  const [bytes, need] = [bytesFrom(data), levelBytes(format, width, height)];
  const missing = need - bytes.length;
  if (missing > 0) throw new RangeError(`Текстуре ${width}×${height} ${format} нужно ${need} байт, пришло ${bytes.length}.`);
  const decode = LEVEL_DECODERS.get(format) ?? decodeUncompressed;
  return decode(format, bytes, width, height);
}

export const fullMipLevels = (width, height) => {
  const longest = Math.max(width, height);
  const octave = Math.log2(longest);
  return Math.floor(octave) + 1;
};

// ---------------------------------------------------------------- перестановка каналов целыми пикселями

// BGRA <-> RGBA: пиксель читается одним 32-битным словом, красный и синий меняются местами.
// Слово здесь всегда понимается как little-endian (первый байт пикселя — младший).
const swapRedBlue = (word) => (word & 0xff00ff00) | ((word & 0xff) << 16) | ((word >>> 16) & 0xff);

function swizzlePixels(from, to, toOffset) {
  const count = from.length >>> 2;
  if (HOST_IS_LITTLE_ENDIAN && (to.byteOffset + toOffset) % 4 === 0) {
    const source = from.byteOffset % 4 === 0 ? from : new Uint8Array(from);
    const readWords = new Uint32Array(source.buffer, source.byteOffset, count);
    const writeWords = new Uint32Array(to.buffer, to.byteOffset + toOffset, count);
    let i = 0;
    while (i < count) {
      writeWords[i] = swapRedBlue(readWords[i]);
      i += 1;
    }
    return;
  }
  const reader = new DataView(from.buffer, from.byteOffset, from.byteLength);
  const writer = new DataView(to.buffer, to.byteOffset, to.byteLength);
  for (let at = 0; at < count * 4; at += 4) writer.setUint32(toOffset + at, swapRedBlue(reader.getUint32(at, true)), true);
}

// ---------------------------------------------------------------- уменьшение и пересчёт

// Окна исходных пикселей по одной оси одним массивом: [от, до) для каждого выходного пикселя подряд.
// Границы целые: правая округляется вверх, цикл «пока меньше» от целого левого края от этого не меняется
// (дробный или нечисловой размер даёт пустое окно, как и раньше).
function halvingWindows(size) {
  const half = size >> 1;
  const slots = half > 1 ? half : 1;
  const bounds = new Int32Array(slots * 2);
  for (let slot = 0; slot < slots; slot += 1) {
    const first = slot * 2;
    bounds[first] = first;
    // Последний забирает всё до края, чтобы нечётная сторона не теряла ряд или столбец.
    bounds[first + 1] = slot < slots - 1 ? first + 2 : Math.ceil(Math.max(size, first + 1));
  }
  return bounds;
}

function proportionalWindows(size, slots) {
  const bounds = new Int32Array(slots * 2);
  for (let slot = 0; slot < slots; slot += 1) {
    const first = Math.floor((slot * size) / slots);
    const reach = Math.min(size, Math.ceil(((slot + 1) * size) / slots));
    bounds[slot * 2] = first;
    bounds[slot * 2 + 1] = Math.ceil(Math.max(first + 1, reach));
  }
  return bounds;
}

// Ядро свёртки, общее для уменьшения вдвое и пересчёта: на каждый выходной пиксель — прямоугольное окно
// исходных, цвет усредняется с весом альфы, альфа — обычное среднее. Нехватка данных даёт «не число»,
// а в выходном массиве оно нуль.
const average = (sum, weight) => Math.round(sum / weight);

function reduceBoxes(source, stride, columns, rows) {
  const outHeight = rows.length / 2;
  const outWidth = columns.length / 2;
  const out = new Uint8ClampedArray(4 * outWidth * outHeight);
  let at = 0;
  let y = 0;
  while (y < outHeight) {
    const top = rows[y * 2];
    const bottom = rows[y * 2 + 1];
    let x = 0;
    while (x < outWidth) {
      const left = columns[x * 2];
      const right = columns[x * 2 + 1];
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let row = top; row < bottom; row += 1) {
        let p = (row * stride + left) * 4;
        const stop = (row * stride + right) * 4;
        while (p < stop) {
          const opacity = source[p + 3];
          a += opacity;
          r += opacity * source[p];
          g += opacity * source[p + 1];
          b += opacity * source[p + 2];
          p += 4;
        }
      }
      if (a > 0) {
        out[at] = average(r, a);
        out[at + 1] = average(g, a);
        out[at + 2] = average(b, a);
      }
      const covered = Math.max(0, right - left) * Math.max(0, bottom - top);
      out[at + 3] = covered > 0 ? average(a, covered) : 0;
      at += 4;
      x += 1;
    }
    y += 1;
  }
  return out;
}

// Ровное уменьшение вдвое типичной текстуры: чётные стороны, байтовый массив с выравниванием по 4 и полными данными.
// Тогда каждое окно — ровно 2×2, а пиксель читается и пишется одним 32-битным словом.
const halvesByPairs = (rgba, width, height) =>
  HOST_IS_LITTLE_ENDIAN &&
  (rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) &&
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width >= 2 &&
  height >= 2 &&
  width % 2 === 0 &&
  height % 2 === 0 &&
  rgba.byteOffset % 4 === 0 &&
  rgba.length >= width * height * 4;

function halveByPairs(rgba, width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const words = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const out = new Uint8ClampedArray(halfWidth * halfHeight * 4);
  const outWords = new Uint32Array(out.buffer);
  let written = 0;
  for (let row = 0; row < halfHeight; row += 1) {
    let upperLeft = row * 2 * width;
    for (let column = 0; column < halfWidth; column += 1, upperLeft += 2) {
      const lowerLeft = upperLeft + width;
      const first = words[upperLeft];
      const second = words[upperLeft + 1];
      const third = words[lowerLeft];
      const fourth = words[lowerLeft + 1];
      // Слово пикселя: R | G << 8 | B << 16 | A << 24. Альфа соседей служит весом цвета.
      const weight1 = first >>> 24;
      const weight2 = second >>> 24;
      const weight3 = third >>> 24;
      const weight4 = fourth >>> 24;
      const alphaSum = weight1 + weight2 + weight3 + weight4;
      let packed = ((alphaSum + 2) >> 2) << 24;
      if (alphaSum > 0) {
        const red = (first & 255) * weight1 + (second & 255) * weight2 + (third & 255) * weight3 + (fourth & 255) * weight4;
        const green =
          ((first >>> 8) & 255) * weight1 + ((second >>> 8) & 255) * weight2 + ((third >>> 8) & 255) * weight3 + ((fourth >>> 8) & 255) * weight4;
        const blue =
          ((first >>> 16) & 255) * weight1 + ((second >>> 16) & 255) * weight2 + ((third >>> 16) & 255) * weight3 + ((fourth >>> 16) & 255) * weight4;
        // Одно деление на пиксель: сумма до 255 * 1020, запас 1e-9 не даёт ошибке умножения сбить ровную половину
        // (для всех сумм и весов результат совпадает с Math.round(сумма / вес)).
        const inverse = 1 / alphaSum;
        packed |= ((red * inverse + 0.5000000001) | 0) | (((green * inverse + 0.5000000001) | 0) << 8) | (((blue * inverse + 0.5000000001) | 0) << 16);
      }
      outWords[written++] = packed;
    }
  }
  return out;
}

export function downsample(rgba, width, height) {
  if (halvesByPairs(rgba, width, height)) return halveByPairs(rgba, width, height);
  return reduceBoxes(rgba, width, halvingWindows(width), halvingWindows(height));
}

export function resample(rgba, width, height, nextWidth, nextHeight) {
  const resized = width !== nextWidth || height !== nextHeight;
  if (resized) {
    if (!isSide(nextWidth) || !isSide(nextHeight)) throw new Error("Целевой размер вне допустимых границ.");
    return reduceBoxes(rgba, width, proportionalWindows(width, nextWidth), proportionalWindows(height, nextHeight));
  }
  // Размер тот же: свой Uint8ClampedArray отдаётся без копии, чужой вид копируется.
  return rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
}

// ---------------------------------------------------------------- дозаливка цвета под прозрачные пиксели

// Волна идёт слоями от видимых пикселей: сосед, до которого она ещё не дошла, берёт цвет того, откуда пришла.
// Все достигнутые пиксели лежат в одном массиве в порядке достижения, слой — его подотрезок.
export function bleedTransparent(rgba, width, height) {
  const total = height * width;
  if (!(total > 0)) return rgba;
  const seen = new Uint8Array(total);
  const order = new Int32Array(total);
  let tail = 0;
  for (let pixel = 0, alphaAt = 3; pixel < total; pixel += 1, alphaAt += 4) {
    if (rgba[alphaAt] !== 0) {
      seen[pixel] = 1;
      order[tail++] = pixel;
    }
  }
  if (tail === 0 || tail === total) return rgba;

  // Существующий и ещё не достигнутый сосед попадает в очередь и красится цветом источника.
  const claim = (neighbour, source, exists) => {
    const fresh = exists && seen[neighbour] === 0;
    if (fresh) {
      order[tail++] = neighbour;
      seen[neighbour] = 1;
      let from = source * 4;
      let to = neighbour * 4;
      rgba[to++] = rgba[from++];
      rgba[to++] = rgba[from++];
      rgba[to] = rgba[from];
    }
  };
  let layerStart = 0;
  while (layerStart < tail) {
    const layerEnd = tail;
    for (let i = layerStart; i < layerEnd; i += 1) {
      const pixel = order[i];
      const column = pixel % width;
      // Порядок обхода: слева, справа, сверху, снизу; через край строки волна не переходит.
      claim(pixel - 1, pixel, column > 0);
      claim(pixel + 1, pixel, column < width - 1);
      claim(pixel - width, pixel, pixel >= width);
      claim(pixel + width, pixel, pixel + width < total);
    }
    layerStart = layerEnd;
  }
  return rgba;
}

// ---------------------------------------------------------------- mip-уровни

// Размеры уровней: половина на каждом шаге, но не меньше единицы. Число уровней сравнивается как есть.
function* mipSizes(width, height, count) {
  let level = 0;
  while (level < count) {
    yield { width: Math.max(1, width >> level), height: Math.max(1, height >> level) };
    level += 1;
  }
}

export function buildMipChain(rgba, width, height, mipLevels) {
  const sizes = mipSizes(width, height, mipLevels);
  sizes.next(); // нулевой уровень свой, он есть всегда
  const levels = [{ width, height, rgba }];
  let latest = levels[0];
  for (const size of sizes) {
    latest = { ...size, rgba: downsample(latest.rgba, latest.width, latest.height) };
    levels.push(latest);
  }
  return levels;
}

// ---------------------------------------------------------------- запись файла

function joinBytes(parts) {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => {
    joined.set(part, offset);
    return offset + part.length;
  }, 0);
  return joined;
}

export function encodeDds({ width, height, format, mipLevels = 1, rgba }) {
  let levelCount;
  let pixels;
  // Отказы проверяются по порядку, побеждает первый.
  const refusals = [
    () => (WRITABLE_FORMATS.has(format) ? "" : `Формат DDS ${format} не поддерживается.`),
    () => (isSide(width) && isSide(height) ? "" : "Размер DDS вне допустимых границ."),
    () => {
      levelCount = Number(mipLevels || 1);
      const fits = Number.isInteger(levelCount) && levelCount >= 1 && levelCount <= MAX_MIP_LEVELS;
      return fits ? "" : "Число mip-уровней DDS вне допустимых границ.";
    },
    () => (levelCount <= fullMipLevels(width, height) ? "" : `Для ${width}×${height} нельзя построить ${levelCount} mip-уровней.`),
    () => {
      pixels = clampedFrom(rgba);
      return pixels.length === width * height * 4 ? "" : "Размер RGBA не совпадает с заявленным размером DDS.";
    },
  ];
  for (const refusal of refusals) {
    const reason = refusal();
    if (reason) throw new Error(reason);
  }

  const levels = buildMipChain(pixels, width, height, levelCount);
  const header = writeDdsHeader({ format, mipLevels: levelCount, height, width });
  if (format !== "A8R8G8B8") {
    const blocksOf = ({ rgba: pixelsOfLevel, width: w, height: h }) => encodeBlocks(format, pixelsOfLevel, w, h);
    return joinBytes([header, ...levels.map(blocksOf)]);
  }
  let offset = header.length;
  for (const level of levels) offset += level.rgba.length;
  const file = new Uint8Array(offset);
  file.set(header);
  offset = header.length;
  for (const level of levels) {
    swizzlePixels(level.rgba, file, offset);
    offset += level.rgba.length;
  }
  return file;
}

// ---------------------------------------------------------------- чтение файла

function readLevel(format, data, width, height) {
  if (format !== "A8R8G8B8") return decodeBlocks(format, data, width, height);
  const rgba = new Uint8ClampedArray(data.length);
  swizzlePixels(data, rgba, 0);
  return rgba;
}

function checkedBytes(input) {
  const bytes = bytesFrom(input);
  if (bytes.length > MAX_READ_BYTES) throw new RangeError("DDS превышает 32 МБ.");
  return bytes;
}

// Уровни файла по порядку; обрыв данных обнаруживается на том уровне, который не поместился.
function* fileLevels(bytes, header) {
  const { dataOffset, format, mipLevels } = header;
  let from = dataOffset;
  let number = 0;
  for (const { width, height } of mipSizes(header.width, header.height, mipLevels)) {
    const to = from + levelBytes(format, width, height);
    if (to > bytes.length) throw new Error(`DDS обрывается на уровне ${number}: заявлено ${mipLevels} mip.`);
    yield { width, height, rgba: readLevel(format, bytes.subarray(from, to), width, height) };
    from = to;
    number += 1;
  }
}

export function decodeDds(input) {
  const bytes = checkedBytes(input);
  const header = readDdsHeader(bytes);
  return { ...header, levels: [...fileLevels(bytes, header)] };
}

/**
 * Только верхний уровень: нужен, когда картинка слота берётся с него одного (обложка трассеров, превью). Файл автора часто обрывает мелкие mip —
 * заявлено 9, данных на 6 (sad redux, 15.11.2026) — и `decodeDds` на нём падал, хотя верхний уровень лежит целиком. Здесь мелкие уровни не читаются;
 * не поместился сам верхний — ошибка прежняя («обрывается на уровне 0»). Форма ответа как у `decodeDds` (`levels` из одного уровня).
 */
export function decodeDdsTop(input) {
  const bytes = checkedBytes(input);
  const header = readDdsHeader(bytes);
  const top = fileLevels(bytes, header).next();
  if (top.done) throw new Error("DDS без уровней.");
  return { ...header, levels: [top.value] };
}

/**
 * DDS, сведённый к целым уровням: число mip в заголовке — по тем уровням, что лежат в файле целиком. Мелкие уровни у файлов автора записаны без округления
 * до блока 4×4 (или оборваны), строгое чтение (`decodeDds`, `fitDdsLayout`) на них падало «обрывается на уровне N» (ALLIANCE V3 11.11.2026, sad redux 15.11.2026).
 * Нет ни одного целого уровня или все целые — файл как был (чтение скажет, что не так).
 */
export function wholeMipLevels(dds) {
  const header = readDdsHeader(dds);
  let from = header.dataOffset;
  let whole = 0;
  while (whole < header.mipLevels) {
    const to = from + levelBytes(header.format, Math.max(1, header.width >> whole), Math.max(1, header.height >> whole));
    if (to > dds.length) break;
    from = to;
    whole += 1;
  }
  if (!whole || whole === header.mipLevels) return dds;
  const fixed = new Uint8Array(dds.subarray(0, from));
  new DataView(fixed.buffer).setUint32(28, whole, true);
  return fixed;
}

const headerOf = (input) => (input?.width ? input : readDdsHeader(input));

export function assertDdsLayout(input, layout) {
  const header = headerOf(input);
  const mismatch = Object.entries(layout).find(([field, expected]) => header[field] !== expected);
  if (mismatch) {
    const [field, expected] = mismatch;
    throw new Error(`DDS должен иметь ${field}=${expected}; получено ${header[field] ?? "неизвестно"}.`);
  }
  return header;
}
