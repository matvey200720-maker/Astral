/*
 * Запись BC7 — только режим 6.
 *
 * Чтение BC7 (`bc-decode.js`) появилось для превью: моды одежды и оружия
 * всё чаще сжаты им. Записывать его понадобилось воде: туман моря в игре —
 * плитки `waterfog-N.ytd` 256² BC7 с полной цепочкой mip, и словарь правится
 * на месте (`patchResourceTextures`): те же формат, размер и длина байт.
 *
 * Режим 6 — один отрезок цвета на блок 4×4: две опорные точки RGBA по 7 бит
 * и общему младшему биту у каждой, 16 ступеней между ними. Для плавных карт
 * вроде тумана воды это почти без потерь (на плитке игры — 54 дБ, разница не
 * больше трёх единиц), а кодировщик выходит простым и быстрым: главная ось
 * блока, проекция, подбор ступеней, одно уточнение концов по ступеням.
 */

const WEIGHTS = Object.freeze([0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]);

const clampByte = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

/* Опорная точка RGBA → 7 бит на канал и общий младший бит: из двух
   вариантов бита — тот, что ближе. */
function quantizeEndpoint(point, out, offset) {
  let best = Infinity;
  let bestBit = 0;
  for (let bit = 0; bit < 2; bit += 1) {
    let error = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const value = clampByte(point[channel]);
      let code = Math.round((value - bit) / 2);
      if (code < 0) code = 0;
      else if (code > 127) code = 127;
      const restored = (code << 1) | bit;
      error += (restored - value) * (restored - value);
    }
    if (error < best) {
      best = error;
      bestBit = bit;
    }
  }
  for (let channel = 0; channel < 4; channel += 1) {
    let code = Math.round((clampByte(point[channel]) - bestBit) / 2);
    if (code < 0) code = 0;
    else if (code > 127) code = 127;
    out[offset + channel] = code;
  }
  return bestBit;
}

/* Ступени отрезка и лучшая ступень каждого пикселя; возвращает ошибку. */
function assignIndices(pixels, codes, bits, palette, indices) {
  for (let step = 0; step < 16; step += 1) {
    const weight = WEIGHTS[step];
    for (let channel = 0; channel < 4; channel += 1) {
      const a = (codes[channel] << 1) | bits[0];
      const b = (codes[4 + channel] << 1) | bits[1];
      palette[step * 4 + channel] = ((64 - weight) * a + weight * b + 32) >> 6;
    }
  }
  let total = 0;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    let best = Infinity;
    let bestStep = 0;
    const at = pixel * 4;
    for (let step = 0; step < 16; step += 1) {
      const p = step * 4;
      const dr = palette[p] - pixels[at];
      const dg = palette[p + 1] - pixels[at + 1];
      const db = palette[p + 2] - pixels[at + 2];
      const da = palette[p + 3] - pixels[at + 3];
      const error = dr * dr + dg * dg + db * db + da * da;
      if (error < best) {
        best = error;
        bestStep = step;
      }
    }
    indices[pixel] = bestStep;
    total += best;
  }
  return total;
}

/* Концы отрезка по ступеням пикселей — наименьшие квадраты. */
function refitEndpoints(pixels, indices, low, high) {
  let aa = 0;
  let ab = 0;
  let bb = 0;
  const ax = [0, 0, 0, 0];
  const bx = [0, 0, 0, 0];
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const t = WEIGHTS[indices[pixel]] / 64;
    const s = 1 - t;
    aa += s * s;
    ab += s * t;
    bb += t * t;
    for (let channel = 0; channel < 4; channel += 1) {
      ax[channel] += s * pixels[pixel * 4 + channel];
      bx[channel] += t * pixels[pixel * 4 + channel];
    }
  }
  const det = aa * bb - ab * ab;
  if (Math.abs(det) < 1e-6) return false;
  for (let channel = 0; channel < 4; channel += 1) {
    low[channel] = (ax[channel] * bb - bx[channel] * ab) / det;
    high[channel] = (bx[channel] * aa - ax[channel] * ab) / det;
  }
  return true;
}

function writeBlock(out, offset, codes, bits, indices) {
  /* Якорный пиксель (первый) обязан иметь старший бит ступени 0: иначе
     меняем концы местами и ступени — на зеркальные. */
  if (indices[0] >= 8) {
    for (let channel = 0; channel < 4; channel += 1) {
      const swap = codes[channel];
      codes[channel] = codes[4 + channel];
      codes[4 + channel] = swap;
    }
    const swapBit = bits[0];
    bits[0] = bits[1];
    bits[1] = swapBit;
    for (let pixel = 0; pixel < 16; pixel += 1) indices[pixel] = 15 - indices[pixel];
  }
  out.fill(0, offset, offset + 16);
  let bit = 0;
  const put = (value, count) => {
    for (let index = 0; index < count; index += 1, bit += 1)
      if ((value >> index) & 1) out[offset + (bit >> 3)] |= 1 << (bit & 7);
  };
  put(1 << 6, 7);
  for (let channel = 0; channel < 4; channel += 1) {
    put(codes[channel], 7);
    put(codes[4 + channel], 7);
  }
  put(bits[0], 1);
  put(bits[1], 1);
  for (let pixel = 0; pixel < 16; pixel += 1) put(indices[pixel], pixel === 0 ? 3 : 4);
}

/**
 * Блок 4×4 (`pixels` — 64 байта RGBA) → 16 байт BC7 режима 6 в `out` с
 * `offset`. Рабочие массивы — снаружи, чтобы плитка не плодила мусор.
 */
function encodeBlock(pixels, out, offset, work) {
  const { mean, axis, next, low, high, codes, bits, palette, indices, bestIndices, bestCodes } = work;
  mean.fill(0);
  for (let pixel = 0; pixel < 16; pixel += 1)
    for (let channel = 0; channel < 4; channel += 1) mean[channel] += pixels[pixel * 4 + channel] / 16;

  /* Главная ось — степенным методом по ковариации. */
  const cov = work.cov;
  cov.fill(0);
  for (let pixel = 0; pixel < 16; pixel += 1)
    for (let i = 0; i < 4; i += 1) {
      const di = pixels[pixel * 4 + i] - mean[i];
      for (let j = i; j < 4; j += 1) cov[i * 4 + j] += di * (pixels[pixel * 4 + j] - mean[j]);
    }
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < i; j += 1) cov[i * 4 + j] = cov[j * 4 + i];
  axis[0] = 1;
  axis[1] = 1;
  axis[2] = 1;
  axis[3] = 0.25;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let length = 0;
    for (let i = 0; i < 4; i += 1) {
      next[i] = cov[i * 4] * axis[0] + cov[i * 4 + 1] * axis[1] + cov[i * 4 + 2] * axis[2] + cov[i * 4 + 3] * axis[3];
      length += next[i] * next[i];
    }
    length = Math.sqrt(length);
    if (length < 1e-9) break;
    for (let i = 0; i < 4; i += 1) axis[i] = next[i] / length;
  }
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    let t = 0;
    for (let channel = 0; channel < 4; channel += 1) t += (pixels[pixel * 4 + channel] - mean[channel]) * axis[channel];
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  for (let channel = 0; channel < 4; channel += 1) {
    low[channel] = mean[channel] + axis[channel] * tMin;
    high[channel] = mean[channel] + axis[channel] * tMax;
  }
  bits[0] = quantizeEndpoint(low, codes, 0);
  bits[1] = quantizeEndpoint(high, codes, 4);
  let best = assignIndices(pixels, codes, bits, palette, indices);
  bestIndices.set(indices);
  bestCodes.set(codes);
  let bestBits0 = bits[0];
  let bestBits1 = bits[1];

  /* Одно уточнение концов по найденным ступеням. */
  if (best > 0 && refitEndpoints(pixels, indices, low, high)) {
    bits[0] = quantizeEndpoint(low, codes, 0);
    bits[1] = quantizeEndpoint(high, codes, 4);
    const error = assignIndices(pixels, codes, bits, palette, indices);
    if (error < best) {
      best = error;
      bestIndices.set(indices);
      bestCodes.set(codes);
      bestBits0 = bits[0];
      bestBits1 = bits[1];
    }
  }
  bits[0] = bestBits0;
  bits[1] = bestBits1;
  writeBlock(out, offset, bestCodes, bits, bestIndices);
}

const workspace = () => ({
  mean: new Float64Array(4),
  axis: new Float64Array(4),
  next: new Float64Array(4),
  low: new Float64Array(4),
  high: new Float64Array(4),
  cov: new Float64Array(16),
  codes: new Int32Array(8),
  bestCodes: new Int32Array(8),
  bits: new Int32Array(2),
  palette: new Int32Array(64),
  indices: new Int32Array(16),
  bestIndices: new Int32Array(16),
});

/**
 * Один уровень RGBA → байты BC7 (16 байт на блок 4×4). Края меньше блока
 * повторяют последний пиксель — как у блочного кодека DXT.
 */
export function encodeBc7(rgba, width, height) {
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  const out = new Uint8Array(blocksWide * blocksHigh * 16);
  const pixels = new Int32Array(64);
  const work = workspace();
  for (let by = 0; by < blocksHigh; by += 1)
    for (let bx = 0; bx < blocksWide; bx += 1) {
      for (let y = 0; y < 4; y += 1)
        for (let x = 0; x < 4; x += 1) {
          const sx = Math.min(width - 1, bx * 4 + x);
          const sy = Math.min(height - 1, by * 4 + y);
          const source = (sy * width + sx) * 4;
          const target = (y * 4 + x) * 4;
          pixels[target] = rgba[source];
          pixels[target + 1] = rgba[source + 1];
          pixels[target + 2] = rgba[source + 2];
          pixels[target + 3] = rgba[source + 3];
        }
      encodeBlock(pixels, out, (by * blocksWide + bx) * 16, work);
    }
  return out;
}
