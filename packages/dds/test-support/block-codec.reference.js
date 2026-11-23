/*
 * ЭТАЛОН ДЛЯ ТЕСТОВ — не править и не подключать из кода приложения.
 *
 * Замороженная копия `packages/dds/block-codec.js` до ускорения (коммит
 * 78a67543). Код ниже — байт в байт прежний; по нему
 * `tests/dds-block-codec-equivalence.test.js` проверяет, что быстрый кодек
 * выдаёт те же байты.
 */

/*
 * BC1/BC2/BC3 (DXT1/3/5) — кодек блоков 4×4.
 *
 * Нужен, чтобы мастерская могла собрать настоящую игровую текстуру прямо в
 * приложении: игрок двигает цвет — приложение отдаёт установщику готовый DDS
 * ровно того размера, формата и числа mip, которых требует слот в core.ypt.
 * Внешний конвертер для этого не годится: он не установлен у игрока, а
 * «примерно похожая» текстура ломает патч на самом первом сравнении.
 *
 * Кодировщик работает по главной оси блока: концы берутся из проекции
 * пикселей на ось «минимум–максимум», затем один шаг наименьших квадратов
 * подтягивает их к реальному распределению. Для градиентов и мягких хвостов —
 * а это ровно то, из чего состоят трассеры и брызги — такой подход даёт
 * результат без заметных ступенек и остаётся детерминированным.
 */

const clamp255 = (value) => (value < 0 ? 0 : value > 255 ? 255 : value | 0);

const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

const from565 = (value) => {
  const r = (value >> 11) & 0x1f;
  const g = (value >> 5) & 0x3f;
  const b = value & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
};

/** Пиксели блока 4×4; края достраиваются повтором, как принято в DDS. */
function readBlock(rgba, width, height, blockX, blockY, out) {
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(height - 1, blockY + y);
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(width - 1, blockX + x);
      const source = (sourceY * width + sourceX) * 4;
      const target = (y * 4 + x) * 4;
      out[target] = rgba[source];
      out[target + 1] = rgba[source + 1];
      out[target + 2] = rgba[source + 2];
      out[target + 3] = rgba[source + 3];
    }
  }
  return out;
}

/** Концы цветовой оси блока. */
function colorEndpoints(block, opaque) {
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let used = 0;
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    if (!opaque && block[offset + 3] < 128) continue;
    used += 1;
    const r = block[offset];
    const g = block[offset + 1];
    const b = block[offset + 2];
    if (r < minR) minR = r;
    if (g < minG) minG = g;
    if (b < minB) minB = b;
    if (r > maxR) maxR = r;
    if (g > maxG) maxG = g;
    if (b > maxB) maxB = b;
  }
  if (!used) return null;

  // Ось блока и проекция на неё: так концы садятся на реальные крайние
  // пиксели, а не на угол ограничивающего параллелепипеда.
  const axisR = maxR - minR;
  const axisG = maxG - minG;
  const axisB = maxB - minB;
  const length = axisR * axisR + axisG * axisG + axisB * axisB;
  if (length === 0) {
    return { low: [minR, minG, minB], high: [maxR, maxG, maxB] };
  }
  let lowT = Infinity;
  let highT = -Infinity;
  let low = [minR, minG, minB];
  let high = [maxR, maxG, maxB];
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    if (!opaque && block[offset + 3] < 128) continue;
    const r = block[offset];
    const g = block[offset + 1];
    const b = block[offset + 2];
    const t =
      ((r - minR) * axisR + (g - minG) * axisG + (b - minB) * axisB) / length;
    if (t < lowT) {
      lowT = t;
      low = [r, g, b];
    }
    if (t > highT) {
      highT = t;
      high = [r, g, b];
    }
  }
  return { low, high };
}

/** Один шаг наименьших квадратов по выбранным индексам. */
function refineEndpoints(block, opaque, low, high) {
  const weights = [0, 1, 1 / 3, 2 / 3];
  let a2 = 0;
  let ab = 0;
  let b2 = 0;
  const ax = [0, 0, 0];
  const bx = [0, 0, 0];
  const palette = buildPalette(low, high, opaque);
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    if (!opaque && block[offset + 3] < 128) continue;
    const selected = nearestPaletteIndex(palette, block, offset, opaque);
    const w = weights[selected] ?? 0;
    const a = 1 - w;
    a2 += a * a;
    ab += a * w;
    b2 += w * w;
    for (let channel = 0; channel < 3; channel += 1) {
      ax[channel] += a * block[offset + channel];
      bx[channel] += w * block[offset + channel];
    }
  }
  const determinant = a2 * b2 - ab * ab;
  if (Math.abs(determinant) < 1e-6) return { low, high };
  const nextLow = [0, 0, 0];
  const nextHigh = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    nextLow[channel] = clamp255(
      (ax[channel] * b2 - bx[channel] * ab) / determinant,
    );
    nextHigh[channel] = clamp255(
      (bx[channel] * a2 - ax[channel] * ab) / determinant,
    );
  }
  return { low: nextLow, high: nextHigh };
}

function buildPalette(low, high, opaque) {
  const c0 = to565(high[0], high[1], high[2]);
  const c1 = to565(low[0], low[1], low[2]);
  return paletteFromCodes(c0, c1, opaque);
}

function paletteFromCodes(c0, c1, opaque) {
  const first = from565(c0);
  const second = from565(c1);
  const palette = [first, second, [0, 0, 0], [0, 0, 0]];
  if (opaque || c0 > c1) {
    for (let channel = 0; channel < 3; channel += 1) {
      palette[2][channel] = (2 * first[channel] + second[channel] + 1) / 3;
      palette[3][channel] = (first[channel] + 2 * second[channel] + 1) / 3;
    }
  } else {
    for (let channel = 0; channel < 3; channel += 1) {
      palette[2][channel] = (first[channel] + second[channel]) / 2;
      palette[3][channel] = 0;
    }
  }
  return {
    codes: [c0, c1],
    colors: palette,
    punchThrough: !opaque && c0 <= c1,
  };
}

function paletteDistance(palette, block, offset, index) {
  const color = palette.colors[index];
  const dr = block[offset] - color[0];
  const dg = block[offset + 1] - color[1];
  const db = block[offset + 2] - color[2];
  return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
}

function nearestPaletteIndex(palette, block, offset, opaque) {
  if (!opaque && block[offset + 3] < 128 && palette.punchThrough) return 3;
  let best = 0;
  let bestDistance = Infinity;
  const limit = palette.punchThrough ? 3 : 4;
  for (let index = 0; index < limit; index += 1) {
    const distance = paletteDistance(palette, block, offset, index);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function paletteError(palette, block, opaque) {
  let total = 0;
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    if (!opaque && block[offset + 3] < 128) continue;
    total += paletteDistance(
      palette,
      block,
      offset,
      nearestPaletteIndex(palette, block, offset, opaque),
    );
  }
  return total;
}

/*
 * Таблицы точного попадания для одноцветного блока.
 *
 * Если все шестнадцать пикселей одного цвета, брать оба конца равными этому
 * цвету — потерять до восьми единиц на красном и синем: в RGB565 у них по
 * пять бит. Промежуточные цвета палитры считаются как (2·c0 + c1)/3, поэтому
 * подобранная пара концов почти всегда попадает в цель точно. Таблица
 * считается один раз при загрузке модуля: 5-бит — 1024 пары, 6-бит — 4096.
 */
function buildMatchTable(bits) {
  const levels = 1 << bits;
  const expand =
    bits === 5 ? (q) => (q << 3) | (q >> 2) : (q) => (q << 2) | (q >> 4);
  const table = new Uint8Array(256 * 2);
  for (let target = 0; target < 256; target += 1) {
    let best = Infinity;
    for (let high = 0; high < levels; high += 1) {
      const a = expand(high);
      for (let low = 0; low < levels; low += 1) {
        const b = expand(low);
        const interpolated = Math.floor((2 * a + b + 1) / 3);
        const error = Math.abs(interpolated - target);
        if (error < best) {
          best = error;
          table[target * 2] = high;
          table[target * 2 + 1] = low;
          if (!error) break;
        }
      }
      if (!best) break;
    }
  }
  return table;
}

const MATCH_5 = buildMatchTable(5);
const MATCH_6 = buildMatchTable(6);

/** Средний цвет блока по непрозрачным пикселям. */
function blockAverage(block, opaque) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    if (!opaque && block[offset + 3] < 128) continue;
    r += block[offset];
    g += block[offset + 1];
    b += block[offset + 2];
    count += 1;
  }
  if (!count) return null;
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/** Пара кодов, у которой один из промежуточных цветов равен заданному. */
function singleColorCodes(color) {
  const r = MATCH_5.subarray(color[0] * 2, color[0] * 2 + 2);
  const g = MATCH_6.subarray(color[1] * 2, color[1] * 2 + 2);
  const b = MATCH_5.subarray(color[2] * 2, color[2] * 2 + 2);
  return {
    c0: (r[0] << 11) | (g[0] << 5) | b[0],
    c1: (r[1] << 11) | (g[1] << 5) | b[1],
  };
}

function encodeColorBlock(block, output, offset, opaque) {
  const endpoints = colorEndpoints(block, opaque);
  if (!endpoints) {
    // Полностью прозрачный блок: один цвет и punch-through индексы.
    output[offset] = 0;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
    output[offset + 3] = 0;
    output[offset + 4] = 0xff;
    output[offset + 5] = 0xff;
    output[offset + 6] = 0xff;
    output[offset + 7] = 0xff;
    return;
  }
  const refined = refineEndpoints(block, opaque, endpoints.low, endpoints.high);
  const needsPunchThrough =
    !opaque &&
    Array.from({ length: 16 }, (_, index) => block[index * 4 + 3]).some(
      (alpha) => alpha < 128,
    );

  /*
   * Кандидаты считаются оба и выбираются по ошибке: ось блока хороша на
   * градиенте, таблица точного попадания — на ровной заливке. Выбор по
   * измерению, а не по эвристике «похоже на градиент», делает результат
   * предсказуемым и не оставляет случая, где кодировщик заметно хуже.
   */
  const candidates = [];
  const average = blockAverage(block, opaque);
  const push = (rawHigh, rawLow) => {
    let c0 = rawHigh;
    let c1 = rawLow;
    if (needsPunchThrough) {
      if (c0 > c1) [c0, c1] = [c1, c0];
      if (c0 === c1 && c1 < 0xffff) c1 += 1;
    } else if (c0 <= c1) {
      if (c0 === c1) c1 = c0 === 0 ? 0 : c0 - 1;
      else [c0, c1] = [c1, c0];
    }
    const palette = paletteFromCodes(c0, c1, opaque);
    candidates.push({
      c0,
      c1,
      palette,
      error: paletteError(palette, block, opaque),
    });
  };
  push(
    to565(refined.high[0], refined.high[1], refined.high[2]),
    to565(refined.low[0], refined.low[1], refined.low[2]),
  );
  if (average) {
    const codes = singleColorCodes(average);
    push(codes.c0, codes.c1);
  }
  const best = candidates.reduce((left, right) =>
    right.error < left.error ? right : left,
  );
  const { c0, c1, palette } = best;
  let indices = 0;
  for (let index = 15; index >= 0; index -= 1) {
    indices =
      (indices << 2) | nearestPaletteIndex(palette, block, index * 4, opaque);
  }
  output[offset] = c0 & 0xff;
  output[offset + 1] = (c0 >> 8) & 0xff;
  output[offset + 2] = c1 & 0xff;
  output[offset + 3] = (c1 >> 8) & 0xff;
  output[offset + 4] = indices & 0xff;
  output[offset + 5] = (indices >>> 8) & 0xff;
  output[offset + 6] = (indices >>> 16) & 0xff;
  output[offset + 7] = (indices >>> 24) & 0xff;
}

function alphaPalette(a0, a1) {
  const values = [a0, a1, 0, 0, 0, 0, 0, 0];
  if (a0 > a1) {
    for (let index = 1; index < 7; index += 1) {
      values[index + 1] = ((7 - index) * a0 + index * a1) / 7;
    }
  } else {
    for (let index = 1; index < 5; index += 1) {
      values[index + 1] = ((5 - index) * a0 + index * a1) / 5;
    }
    values[6] = 0;
    values[7] = 255;
  }
  return values;
}

function encodeAlphaBlock(block, output, offset) {
  let min = 255;
  let max = 0;
  for (let index = 0; index < 16; index += 1) {
    const alpha = block[index * 4 + 3];
    if (alpha < min) min = alpha;
    if (alpha > max) max = alpha;
  }
  const a0 = max;
  const a1 = min;
  const palette = alphaPalette(a0, a1);
  output[offset] = a0;
  output[offset + 1] = a1;
  let bits = 0n;
  for (let index = 0; index < 16; index += 1) {
    const alpha = block[index * 4 + 3];
    let best = 0;
    let bestDistance = Infinity;
    for (let code = 0; code < 8; code += 1) {
      const distance = Math.abs(palette[code] - alpha);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = code;
      }
    }
    bits |= BigInt(best) << BigInt(index * 3);
  }
  for (let byte = 0; byte < 6; byte += 1) {
    output[offset + 2 + byte] = Number((bits >> BigInt(byte * 8)) & 0xffn);
  }
}

function encodeSharpAlphaBlock(block, output, offset) {
  for (let index = 0; index < 16; index += 2) {
    const low = block[index * 4 + 3] >> 4;
    const high = block[(index + 1) * 4 + 3] >> 4;
    output[offset + index / 2] = low | (high << 4);
  }
}

/** RGBA → сжатые блоки. */
export function encodeBlocks(format, rgba, width, height) {
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const blockBytes = format === "DXT1" ? 8 : 16;
  const output = new Uint8Array(blocksX * blocksY * blockBytes);
  const block = new Uint8ClampedArray(64);
  let offset = 0;
  for (let y = 0; y < blocksY; y += 1) {
    for (let x = 0; x < blocksX; x += 1) {
      readBlock(rgba, width, height, x * 4, y * 4, block);
      if (format === "DXT5") {
        encodeAlphaBlock(block, output, offset);
        encodeColorBlock(block, output, offset + 8, true);
      } else if (format === "DXT3") {
        encodeSharpAlphaBlock(block, output, offset);
        encodeColorBlock(block, output, offset + 8, true);
      } else {
        encodeColorBlock(block, output, offset, false);
      }
      offset += blockBytes;
    }
  }
  return output;
}

/** Сжатые блоки → RGBA. */
export function decodeBlocks(format, data, width, height) {
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const blockBytes = format === "DXT1" ? 8 : 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let offset = 0;
  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      const colorOffset = format === "DXT1" ? offset : offset + 8;
      const c0 = data[colorOffset] | (data[colorOffset + 1] << 8);
      const c1 = data[colorOffset + 2] | (data[colorOffset + 3] << 8);
      const palette = paletteFromCodes(c0, c1, format !== "DXT1");
      const indices =
        data[colorOffset + 4] |
        (data[colorOffset + 5] << 8) |
        (data[colorOffset + 6] << 16) |
        (data[colorOffset + 7] << 24);
      let alphaValues = null;
      if (format === "DXT5") {
        const values = alphaPalette(data[offset], data[offset + 1]);
        let bits = 0n;
        for (let byte = 0; byte < 6; byte += 1) {
          bits |= BigInt(data[offset + 2 + byte]) << BigInt(byte * 8);
        }
        alphaValues = { values, bits };
      }
      for (let index = 0; index < 16; index += 1) {
        const x = blockX * 4 + (index % 4);
        const y = blockY * 4 + Math.floor(index / 4);
        if (x >= width || y >= height) continue;
        const code = (indices >>> (index * 2)) & 0x3;
        const color = palette.colors[code];
        const target = (y * width + x) * 4;
        rgba[target] = color[0];
        rgba[target + 1] = color[1];
        rgba[target + 2] = color[2];
        if (format === "DXT5") {
          const selector = Number(
            (alphaValues.bits >> BigInt(index * 3)) & 0x7n,
          );
          rgba[target + 3] = alphaValues.values[selector];
        } else if (format === "DXT3") {
          const nibble = data[offset + (index >> 1)];
          const value = index % 2 === 0 ? nibble & 0xf : nibble >> 4;
          rgba[target + 3] = value * 17;
        } else {
          rgba[target + 3] = palette.punchThrough && code === 3 ? 0 : 255;
        }
      }
      offset += blockBytes;
    }
  }
  return rgba;
}
