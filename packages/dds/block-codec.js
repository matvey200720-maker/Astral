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
 *
 * Скорость. Растительность пережимает за сборку сотни мегапикселей, поэтому
 * горячий путь не создаёт на блок ни массивов, ни объектов: палитра лежит в
 * локальных переменных, индексы — в битах числа, 48 бит индексов альфы
 * DXT5 — в двух 24-битных числах вместо BigInt. Формулы, порядок операций и
 * правила равенства (строгое «<», первый кандидат побеждает) — те же, что у
 * прежней версии (`test-support/block-codec.reference.js`): байты на выходе
 * совпадают с ней для любых пикселей и любых байт блоков, это держит
 * `tests/dds-block-codec-equivalence.test.js`.
 */

const clamp255 = (value) => (value < 0 ? 0 : value > 255 ? 255 : value | 0);

const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

/*
 * n/3 для n = 0…766: промежуточные цвета палитры (2·a + b + 1)/3 — те же
 * дробные, что дало бы деление, только без шести делений на палитру.
 */
const THIRDS = new Float64Array(767);
for (let n = 0; n < THIRDS.length; n += 1) THIRDS[n] = n / 3;

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

/** Блок целиком внутри байтовой картинки — словами: пиксель за раз. */
function readBlockWords(source, width, blockX, blockY, out) {
  let at = blockY * width + blockX;
  for (let row = 0; row < 16; row += 4) {
    out[row] = source[at];
    out[row + 1] = source[at + 1];
    out[row + 2] = source[at + 2];
    out[row + 3] = source[at + 3];
    at += width;
  }
}

/*
 * Итог `matchPalette`: ошибка и индексы (по два бита на пиксель, пиксель 0 —
 * младшие). Типизированные ячейки, а не объект или возвращаемое дробное: так
 * подбор палитры ничего не выделяет.
 */
const matchError = new Float64Array(1);
const matchIndices = new Int32Array(1);
/* Расстояния пикселя до цветов палитры: ошибка берётся по номеру победителя. */
const distances = new Float64Array(4);
/* RGB учитываемых пикселей блока дробными: подбор палитры идёт до трёх раз
   на блок, и переводить каждый байт в double заново дороже, чем один раз. */
const PIXELS = new Float64Array(48);

/**
 * Ближайший цвет палитры (c0, c1) для каждого пикселя блока.
 *
 * Палитра — как у декодера: промежуточные цвета дробные, при c0 ≤ c1 без
 * `opaque` — три цвета и прозрачный. Расстояние взвешенное, при равенстве
 * побеждает меньший индекс. Пиксель вне маски `used` (прозрачный в DXT1) в
 * ошибку не входит и получает индекс 3. Как только ошибка дошла до `bound`,
 * счёт обрывается: кандидат с такой ошибкой уже не выигрывает, а индексы
 * его не нужны.
 *
 * Победитель выбирается без ветвлений: цвет k побеждает, если он строго
 * ближе каждого цвета перед ним, — ровно тот, кого нашёл бы перебор по
 * порядку со строгим «<». Ветвление на каждом сравнении предсказатель
 * переходов угадывает плохо: перебор с ним вдвое с лишним дольше.
 */
function matchPalette(used, opaque, c0, c1, bound) {
  const r0 = (c0 >> 11) & 0x1f;
  const g0 = (c0 >> 5) & 0x3f;
  const b0 = c0 & 0x1f;
  const r1 = (c1 >> 11) & 0x1f;
  const g1 = (c1 >> 5) & 0x3f;
  const b1 = c1 & 0x1f;
  const p0r = (r0 << 3) | (r0 >> 2);
  const p0g = (g0 << 2) | (g0 >> 4);
  const p0b = (b0 << 3) | (b0 >> 2);
  const p1r = (r1 << 3) | (r1 >> 2);
  const p1g = (g1 << 2) | (g1 >> 4);
  const p1b = (b1 << 3) | (b1 >> 2);
  const fourColors = opaque || c0 > c1;
  const p2r = fourColors ? THIRDS[2 * p0r + p1r + 1] : (p0r + p1r) / 2;
  const p2g = fourColors ? THIRDS[2 * p0g + p1g + 1] : (p0g + p1g) / 2;
  const p2b = fourColors ? THIRDS[2 * p0b + p1b + 1] : (p0b + p1b) / 2;
  const p3r = THIRDS[p0r + 2 * p1r + 1];
  const p3g = THIRDS[p0g + 2 * p1g + 1];
  const p3b = THIRDS[p0b + 2 * p1b + 1];
  let error = 0;
  let indices = 0;
  for (let index = 0; index < 16; index += 1) {
    if (((used >> index) & 1) === 0) {
      indices |= 3 << (index << 1);
      continue;
    }
    const at = index * 3;
    const r = PIXELS[at];
    const g = PIXELS[at + 1];
    const b = PIXELS[at + 2];
    let dr = r - p0r;
    let dg = g - p0g;
    let db = b - p0b;
    const d0 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    dr = r - p1r;
    dg = g - p1g;
    db = b - p1b;
    const d1 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    dr = r - p2r;
    dg = g - p2g;
    db = b - p2b;
    const d2 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    const near1 = (d1 < d0) | 0;
    const near2 = (d2 < d0) & (d2 < d1);
    let best = near2 * 2 + (1 - near2) * near1;
    distances[0] = d0;
    distances[1] = d1;
    distances[2] = d2;
    if (fourColors) {
      dr = r - p3r;
      dg = g - p3g;
      db = b - p3b;
      const d3 = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      const near3 = (d3 < d0) & (d3 < d1) & (d3 < d2);
      best = near3 * 3 + (1 - near3) * best;
      distances[3] = d3;
    }
    error += distances[best];
    if (error >= bound) {
      matchError[0] = error;
      return;
    }
    indices |= best << (index << 1);
  }
  matchError[0] = error;
  matchIndices[0] = indices;
}

/* Пара кодов после `orderCodes`. */
let orderedC0 = 0;
let orderedC1 = 0;

/**
 * Порядок кодов задаёт режим палитры: c0 > c1 — четыре цвета, c0 ≤ c1 — три
 * и прозрачный. Блоку с прозрачными пикселями нужен второй, остальным —
 * первый; равные коды разводятся на ступень.
 */
function orderCodes(c0, c1, punchThrough) {
  let high = c0;
  let low = c1;
  if (punchThrough) {
    if (high > low) {
      high = c1;
      low = c0;
    }
    if (high === low && low < 0xffff) low += 1;
  } else if (high <= low) {
    if (high === low) low = high === 0 ? 0 : high - 1;
    else {
      high = c1;
      low = c0;
    }
  }
  orderedC0 = high;
  orderedC1 = low;
}

/*
 * Таблицы точного попадания для одноцветного блока.
 *
 * Если все шестнадцать пикселей одного цвета, брать оба конца равными этому
 * цвету — потерять до восьми единиц на красном и синем: в RGB565 у них по
 * пять бит. Промежуточные цвета палитры считаются как (2·c0 + c1)/3, поэтому
 * подобранная пара концов почти всегда попадает в цель точно. Таблица
 * считается один раз при первом блоке: 5-бит — 1024 пары, 6-бит — 4096.
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

/* Таблицы строятся при первом блоке, а не при загрузке модуля (30.10.2026, старт окна): модуль приезжает на любом запуске вместе с мастерской, а нужен он только тому, кто кодирует
   картинку, — 20 мс при ×4 на каждом старте. */
let MATCH_5_TABLE = null;
let MATCH_6_TABLE = null;
const match5 = () => MATCH_5_TABLE || (MATCH_5_TABLE = buildMatchTable(5));
const match6 = () => MATCH_6_TABLE || (MATCH_6_TABLE = buildMatchTable(6));

/* Доля второго конца у индекса палитры — для шага наименьших квадратов. */
const WEIGHTS = new Float64Array([0, 1, 1 / 3, 2 / 3]);

/*
 * Целые минимум и максимум без ветвлений: (a − b) >> 31 — все единицы при
 * a < b. Значения — байты и их скалярные произведения, разность далеко от
 * переполнения. Ветвление на каждом пикселе угадывается плохо.
 */
const lessMask = (a, b) => (a - b) >> 31;

function encodeColorBlock(block, output, offset, opaque) {
  // Учитываемые пиксели (в DXT1 — с альфой от 128), их рамка и сумма.
  let used = 0;
  let count = 0;
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let index = 0; index < 16; index += 1) {
    const at = index << 2;
    if (!opaque && block[at + 3] < 128) continue;
    used |= 1 << index;
    count += 1;
    const r = block[at];
    const g = block[at + 1];
    const b = block[at + 2];
    PIXELS[index * 3] = r;
    PIXELS[index * 3 + 1] = g;
    PIXELS[index * 3 + 2] = b;
    minR += (r - minR) & lessMask(r, minR);
    minG += (g - minG) & lessMask(g, minG);
    minB += (b - minB) & lessMask(b, minB);
    maxR += (r - maxR) & lessMask(maxR, r);
    maxG += (g - maxG) & lessMask(maxG, g);
    maxB += (b - maxB) & lessMask(maxB, b);
    sumR += r;
    sumG += g;
    sumB += b;
  }
  if (!count) {
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

  /*
   * Ось блока и проекция на неё: так концы садятся на реальные крайние
   * пиксели, а не на угол ограничивающего параллелепипеда. Сравниваются
   * целые числители проекции: знаменатель у всех один и положительный, а
   * частные лежат в [0, 1] дальше друг от друга, чем шаг double, — порядок
   * и равенства те же, что у частных.
   */
  let lowR = minR;
  let lowG = minG;
  let lowB = minB;
  let highR = maxR;
  let highG = maxG;
  let highB = maxB;
  const axisR = maxR - minR;
  const axisG = maxG - minG;
  const axisB = maxB - minB;
  if (axisR * axisR + axisG * axisG + axisB * axisB !== 0) {
    // Числитель не больше 3·255² — начальные границы вне его хода.
    let lowT = 0x40000000;
    let highT = -1;
    for (let index = 0; index < 16; index += 1) {
      if (((used >> index) & 1) === 0) continue;
      const at = index << 2;
      const r = block[at];
      const g = block[at + 1];
      const b = block[at + 2];
      const t = (r - minR) * axisR + (g - minG) * axisG + (b - minB) * axisB;
      const lower = lessMask(t, lowT);
      lowT += (t - lowT) & lower;
      lowR += (r - lowR) & lower;
      lowG += (g - lowG) & lower;
      lowB += (b - lowB) & lower;
      const higher = lessMask(highT, t);
      highT += (t - highT) & higher;
      highR += (r - highR) & higher;
      highG += (g - highG) & higher;
      highB += (b - highB) & higher;
    }
  }

  // Один шаг наименьших квадратов по индексам палитры этих концов.
  const endC0 = to565(highR, highG, highB);
  const endC1 = to565(lowR, lowG, lowB);
  matchPalette(used, opaque, endC0, endC1, Infinity);
  const endError = matchError[0];
  const endIndices = matchIndices[0];
  let a2 = 0;
  let ab = 0;
  let b2 = 0;
  let axR = 0;
  let axG = 0;
  let axB = 0;
  let bxR = 0;
  let bxG = 0;
  let bxB = 0;
  for (let index = 0; index < 16; index += 1) {
    if (((used >> index) & 1) === 0) continue;
    const w = WEIGHTS[(endIndices >> (index << 1)) & 3];
    const a = 1 - w;
    a2 += a * a;
    ab += a * w;
    b2 += w * w;
    const at = index * 3;
    const r = PIXELS[at];
    const g = PIXELS[at + 1];
    const b = PIXELS[at + 2];
    axR += a * r;
    bxR += w * r;
    axG += a * g;
    bxG += w * g;
    axB += a * b;
    bxB += w * b;
  }
  const determinant = a2 * b2 - ab * ab;
  let fitC0 = endC0;
  let fitC1 = endC1;
  if (Math.abs(determinant) >= 1e-6) {
    fitC1 = to565(
      clamp255((axR * b2 - bxR * ab) / determinant),
      clamp255((axG * b2 - bxG * ab) / determinant),
      clamp255((axB * b2 - bxB * ab) / determinant),
    );
    fitC0 = to565(
      clamp255((bxR * a2 - axR * ab) / determinant),
      clamp255((bxG * a2 - axG * ab) / determinant),
      clamp255((bxB * a2 - axB * ab) / determinant),
    );
  }

  /*
   * Кандидаты считаются оба и выбираются по ошибке: ось блока хороша на
   * градиенте, таблица точного попадания — на ровной заливке. Выбор по
   * измерению, а не по эвристике «похоже на градиент», делает результат
   * предсказуемым и не оставляет случая, где кодировщик заметно хуже.
   *
   * Второй выигрывает только строго меньшей ошибкой, поэтому его не
   * считают, когда он заведомо не лучше: у первого ошибки нет, коды те же
   * или его ошибка по ходу счёта уже догнала ошибку первого.
   */
  const punchThrough = !opaque && count < 16;
  orderCodes(fitC0, fitC1, punchThrough);
  let c0 = orderedC0;
  let c1 = orderedC1;
  let error = endError;
  let indices = endIndices;
  if (c0 !== endC0 || c1 !== endC1) {
    matchPalette(used, opaque, c0, c1, Infinity);
    error = matchError[0];
    indices = matchIndices[0];
  }
  if (error > 0) {
    const averageR = Math.round(sumR / count) * 2;
    const averageG = Math.round(sumG / count) * 2;
    const averageB = Math.round(sumB / count) * 2;
    const MATCH_5 = match5();
    const MATCH_6 = match6();
    orderCodes(
      (MATCH_5[averageR] << 11) | (MATCH_6[averageG] << 5) | MATCH_5[averageB],
      (MATCH_5[averageR + 1] << 11) |
        (MATCH_6[averageG + 1] << 5) |
        MATCH_5[averageB + 1],
      punchThrough,
    );
    const flatC0 = orderedC0;
    const flatC1 = orderedC1;
    if (flatC0 !== c0 || flatC1 !== c1) {
      matchPalette(used, opaque, flatC0, flatC1, error);
      if (matchError[0] < error) {
        c0 = flatC0;
        c1 = flatC1;
        indices = matchIndices[0];
      }
    }
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

/*
 * Альфа DXT5: концы — максимум и минимум блока, восемь ступеней между
 * ними, каждому пикселю — ближайшая (при равенстве — меньший номер).
 */
function encodeAlphaBlock(block, output, offset) {
  let min = 255;
  let max = 0;
  for (let at = 3; at < 64; at += 4) {
    const alpha = block[at];
    if (alpha < min) min = alpha;
    if (alpha > max) max = alpha;
  }
  const a0 = max;
  const a1 = min;
  output[offset] = a0;
  output[offset + 1] = a1;
  if (a0 === a1) {
    // Ровная альфа: все пиксели точно на первом конце, индексы нулевые.
    for (let byte = 2; byte < 8; byte += 1) output[offset + byte] = 0;
    return;
  }
  const v2 = (6 * a0 + a1) / 7;
  const v3 = (5 * a0 + 2 * a1) / 7;
  const v4 = (4 * a0 + 3 * a1) / 7;
  const v5 = (3 * a0 + 4 * a1) / 7;
  const v6 = (2 * a0 + 5 * a1) / 7;
  const v7 = (a0 + 6 * a1) / 7;
  // Индексы 0–7 → младшие 24 бита (байты 0–2), 8–15 → старшие (байты 3–5).
  let low = 0;
  let high = 0;
  for (let index = 0; index < 16; index += 1) {
    const alpha = block[(index << 2) + 3];
    let best = 0;
    if (alpha === a1) best = 1;
    else if (alpha !== a0) {
      let bestDistance = a0 - alpha;
      let distance = alpha - a1;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = 1;
      }
      distance = Math.abs(v2 - alpha);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = 2;
      }
      distance = Math.abs(v3 - alpha);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = 3;
      }
      distance = Math.abs(v4 - alpha);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = 4;
      }
      distance = Math.abs(v5 - alpha);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = 5;
      }
      distance = Math.abs(v6 - alpha);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = 6;
      }
      distance = Math.abs(v7 - alpha);
      if (distance < bestDistance) best = 7;
    }
    if (index < 8) low |= best << (index * 3);
    else high |= best << ((index - 8) * 3);
  }
  output[offset + 2] = low & 0xff;
  output[offset + 3] = (low >> 8) & 0xff;
  output[offset + 4] = (low >> 16) & 0xff;
  output[offset + 5] = high & 0xff;
  output[offset + 6] = (high >> 8) & 0xff;
  output[offset + 7] = (high >> 16) & 0xff;
}

function encodeSharpAlphaBlock(block, output, offset) {
  for (let index = 0; index < 16; index += 2) {
    const low = block[index * 4 + 3] >> 4;
    const high = block[(index + 1) * 4 + 3] >> 4;
    output[offset + index / 2] = low | (high << 4);
  }
}

function encodeBlock(format, block, output, offset) {
  if (format === "DXT5") {
    encodeAlphaBlock(block, output, offset);
    encodeColorBlock(block, output, offset + 8, true);
  } else if (format === "DXT3") {
    encodeSharpAlphaBlock(block, output, offset);
    encodeColorBlock(block, output, offset + 8, true);
  } else {
    encodeColorBlock(block, output, offset, false);
  }
}

function sameWords(left, right) {
  for (let word = 0; word < 16; word += 1) {
    if (left[word] !== right[word]) return false;
  }
  return true;
}

function copyWords(from, to) {
  for (let word = 0; word < 16; word += 1) to[word] = from[word];
}

function copyBytes(bytes, from, to, count) {
  for (let byte = 0; byte < count; byte += 1)
    bytes[to + byte] = bytes[from + byte];
}

/**
 * RGBA → сжатые блоки, кодек на JS. Он эталон: нативное ядро (Rust, ниже)
 * обязано давать те же байты, а где его нет или оно отказало, работает он.
 */
export function encodeBlocksJs(format, rgba, width, height) {
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const blockBytes = format === "DXT1" ? 8 : 16;
  const output = new Uint8Array(blocksX * blocksY * blockBytes);
  const block = new Uint8ClampedArray(64);
  /* Блок, байт в байт повторивший последний сжатый, сжимается так же: его
     байты копируются. Ровные заливки и пустые поля проходят мгновенно. */
  const words = new Uint32Array(block.buffer);
  const previous = new Uint32Array(16);
  let previousOffset = -1;
  /* Картинка байтами с выровненным началом читается словами: те же четыре
     байта пикселя, только одним чтением. Остальное — побайтно, как было. */
  const source =
    (rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) &&
    rgba.byteOffset % 4 === 0 &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    rgba.length === width * height * 4
      ? new Uint32Array(rgba.buffer, rgba.byteOffset, width * height)
      : null;
  /* Один плоский цикл по блокам: вложенный цикл в долгой функции V8
     оптимизирует «на ходу» и выходит из такого кода в конце каждой строки. */
  const count = blocksX * blocksY;
  let blockX = 0;
  let blockY = 0;
  for (let index = 0, offset = 0; index < count; index += 1) {
    const left = blockX * 4;
    const top = blockY * 4;
    if (source !== null && left + 4 <= width && top + 4 <= height) {
      readBlockWords(source, width, left, top, words);
    } else {
      readBlock(rgba, width, height, left, top, block);
    }
    if (previousOffset >= 0 && sameWords(words, previous)) {
      copyBytes(output, previousOffset, offset, blockBytes);
    } else {
      encodeBlock(format, block, output, offset);
      copyWords(words, previous);
      previousOffset = offset;
    }
    offset += blockBytes;
    blockX += 1;
    if (blockX === blocksX) {
      blockX = 0;
      blockY += 1;
    }
  }
  return output;
}

/*
 * Нативное ядро сжатия (Rust, `@modovik/native-rs`). Пакет грузится и в окне
 * (браузер), где нативного модуля нет, поэтому сам он ядро не импортирует:
 * его назначает код Node — главный процесс и потоки сборки при старте
 * (`apps/desktop/src/native-block-codec.js`). Ядро — функция
 * (format, rgba, width, height) → блоки (Uint8Array) или `null`: «не берусь»,
 * тогда сжимает JS. Упавшее ядро снимается совсем: дальше всё идёт на JS.
 */
let nativeEncoder = null;

/** Назначить нативное ядро сжатия; не функция (или `null`) — вернуть JS. */
export function setNativeBlockEncoder(encoder) {
  nativeEncoder = typeof encoder === "function" ? encoder : null;
}

/** Сейчас сжимает нативное ядро (оно назначено и не снято сбоем)? */
export const hasNativeBlockEncoder = () => nativeEncoder !== null;

/** RGBA → сжатые блоки: нативное ядро, если оно есть и взялось, иначе JS. */
export function encodeBlocks(format, rgba, width, height) {
  if (nativeEncoder !== null) {
    try {
      const encoded = nativeEncoder(format, rgba, width, height);
      if (encoded) return encoded;
    } catch {
      nativeEncoder = null;
    }
  }
  return encodeBlocksJs(format, rgba, width, height);
}

/*
 * Палитра блока для декодера: четыре цвета RGBA подряд. Ячейки —
 * Uint8ClampedArray, как и вывод: дробный промежуточный цвет округляется
 * при записи сюда ровно так, как округлился бы при записи в картинку.
 * Через `COLOR_WORDS` цвет пишется в картинку одним словом: оба вида
 * смотрят на байты в родном порядке платформы, байты ложатся те же.
 */
const COLORS = new Uint8ClampedArray(16);
const COLOR_WORDS = new Uint32Array(COLORS.buffer);
const ALPHAS = new Uint8ClampedArray(8);

function fillColors(colors, c0, c1, opaque) {
  const r0 = (c0 >> 11) & 0x1f;
  const g0 = (c0 >> 5) & 0x3f;
  const b0 = c0 & 0x1f;
  const r1 = (c1 >> 11) & 0x1f;
  const g1 = (c1 >> 5) & 0x3f;
  const b1 = c1 & 0x1f;
  const p0r = (r0 << 3) | (r0 >> 2);
  const p0g = (g0 << 2) | (g0 >> 4);
  const p0b = (b0 << 3) | (b0 >> 2);
  const p1r = (r1 << 3) | (r1 >> 2);
  const p1g = (g1 << 2) | (g1 >> 4);
  const p1b = (b1 << 3) | (b1 >> 2);
  colors[0] = p0r;
  colors[1] = p0g;
  colors[2] = p0b;
  colors[3] = 255;
  colors[4] = p1r;
  colors[5] = p1g;
  colors[6] = p1b;
  colors[7] = 255;
  colors[11] = 255;
  if (opaque || c0 > c1) {
    colors[8] = THIRDS[2 * p0r + p1r + 1];
    colors[9] = THIRDS[2 * p0g + p1g + 1];
    colors[10] = THIRDS[2 * p0b + p1b + 1];
    colors[12] = THIRDS[p0r + 2 * p1r + 1];
    colors[13] = THIRDS[p0g + 2 * p1g + 1];
    colors[14] = THIRDS[p0b + 2 * p1b + 1];
    colors[15] = 255;
  } else {
    // Три цвета и прозрачный чёрный (punch-through DXT1).
    colors[8] = (p0r + p1r) / 2;
    colors[9] = (p0g + p1g) / 2;
    colors[10] = (p0b + p1b) / 2;
    colors[12] = 0;
    colors[13] = 0;
    colors[14] = 0;
    colors[15] = 0;
  }
}

/* Восемь ступеней альфы DXT5; ячейки округляют так же, как вывод. */
function fillAlphas(alphas, a0, a1) {
  alphas[0] = a0;
  alphas[1] = a1;
  if (a0 > a1) {
    for (let index = 1; index < 7; index += 1) {
      alphas[index + 1] = ((7 - index) * a0 + index * a1) / 7;
    }
  } else {
    for (let index = 1; index < 5; index += 1) {
      alphas[index + 1] = ((5 - index) * a0 + index * a1) / 5;
    }
    alphas[6] = 0;
    alphas[7] = 255;
  }
}

/* Откуда альфа пикселя при разборе. */
const ALPHA_FROM_COLOR = 0;
const ALPHA_SHARP = 1;
const ALPHA_STEPS = 2;

/**
 * Один блок в картинку с левого верхнего пикселя (left, top); пиксели за
 * краем картинки пропускаются. `pixels` — та же картинка словами (или
 * `null`, если размеры не целые): внутри картинки цвет с альфой палитры
 * пишется одним словом, альфа DXT3/DXT5 — поверх байтом.
 */
function decodeBlock(
  data,
  offset,
  colorOffset,
  opaque,
  alphaMode,
  rgba,
  pixels,
  width,
  height,
  left,
  top,
) {
  const c0 = data[colorOffset] | (data[colorOffset + 1] << 8);
  const c1 = data[colorOffset + 2] | (data[colorOffset + 3] << 8);
  fillColors(COLORS, c0, c1, opaque);
  const indices =
    data[colorOffset + 4] |
    (data[colorOffset + 5] << 8) |
    (data[colorOffset + 6] << 16) |
    (data[colorOffset + 7] << 24);
  // Индексы альфы DXT5: пиксели 0–7 — в первых трёх байтах, 8–15 — в
  // следующих трёх.
  let alphaLow = 0;
  let alphaHigh = 0;
  if (alphaMode === ALPHA_STEPS) {
    fillAlphas(ALPHAS, data[offset], data[offset + 1]);
    alphaLow =
      data[offset + 2] | (data[offset + 3] << 8) | (data[offset + 4] << 16);
    alphaHigh =
      data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
  }
  if (pixels !== null && left + 4 <= width && top + 4 <= height) {
    // Блок целиком внутри картинки: строка — четыре слова подряд.
    let pixel = top * width + left;
    for (let row = 0; row < 4; row += 1) {
      const codes = indices >>> (row * 8);
      pixels[pixel] = COLOR_WORDS[codes & 0x3];
      pixels[pixel + 1] = COLOR_WORDS[(codes >>> 2) & 0x3];
      pixels[pixel + 2] = COLOR_WORDS[(codes >>> 4) & 0x3];
      pixels[pixel + 3] = COLOR_WORDS[(codes >>> 6) & 0x3];
      pixel += width;
    }
    if (alphaMode === ALPHA_FROM_COLOR) return;
    let at = (top * width + left) * 4 + 3;
    for (let row = 0; row < 4; row += 1) {
      const alphaBits = row < 2 ? alphaLow : alphaHigh;
      for (let column = 0; column < 4; column += 1) {
        const index = row * 4 + column;
        if (alphaMode === ALPHA_STEPS) {
          rgba[at + column * 4] =
            ALPHAS[(alphaBits >> ((index & 7) * 3)) & 0x7];
        } else {
          const nibble = data[offset + (index >> 1)];
          rgba[at + column * 4] =
            (index % 2 === 0 ? nibble & 0xf : nibble >> 4) * 17;
        }
      }
      at += width * 4;
    }
    return;
  }
  // Край картинки — попиксельно, ровно как прежний разбор: тот же адрес
  // пикселя и тот же порядок байт (так совпадают и дробные размеры).
  for (let index = 0; index < 16; index += 1) {
    const x = left + (index % 4);
    const y = top + Math.floor(index / 4);
    if (x >= width || y >= height) continue;
    const color = ((indices >>> (index * 2)) & 0x3) * 4;
    const target = (y * width + x) * 4;
    rgba[target] = COLORS[color];
    rgba[target + 1] = COLORS[color + 1];
    rgba[target + 2] = COLORS[color + 2];
    if (alphaMode === ALPHA_STEPS) {
      rgba[target + 3] =
        ALPHAS[((index < 8 ? alphaLow : alphaHigh) >> ((index & 7) * 3)) & 0x7];
    } else if (alphaMode === ALPHA_SHARP) {
      const nibble = data[offset + (index >> 1)];
      rgba[target + 3] = (index % 2 === 0 ? nibble & 0xf : nibble >> 4) * 17;
    } else {
      rgba[target + 3] = COLORS[color + 3];
    }
  }
}

/** Сжатые блоки → RGBA. */
export function decodeBlocks(format, data, width, height) {
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const blockBytes = format === "DXT1" ? 8 : 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const dxt1 = format === "DXT1";
  const alphaMode =
    format === "DXT5"
      ? ALPHA_STEPS
      : format === "DXT3"
        ? ALPHA_SHARP
        : ALPHA_FROM_COLOR;
  const count = blocksX * blocksY;
  if (alphaMode === ALPHA_STEPS && count >= 1) {
    // Без битов альфы последнего блока DXT5 не разобрать — как и раньше,
    // это отказ, а не прозрачный хвост.
    const last = (count - 1) * 16 + 7;
    if (data[last] === undefined) {
      throw new TypeError(
        `DXT5 ${width}×${height}: нет байта ${last} — блоки оборваны.`,
      );
    }
  }
  /* Словами — только картинку целых размеров: у дробных (вне договора, но
     прежний разбор их принимал) адрес пикселя бывает дробным. */
  const pixels =
    Number.isInteger(width) && Number.isInteger(height)
      ? new Uint32Array(rgba.buffer)
      : null;
  // Плоский цикл по блокам — по той же причине, что и у кодировщика.
  let blockX = 0;
  let blockY = 0;
  for (let index = 0, offset = 0; index < count; index += 1) {
    decodeBlock(
      data,
      offset,
      dxt1 ? offset : offset + 8,
      !dxt1,
      alphaMode,
      rgba,
      pixels,
      width,
      height,
      blockX * 4,
      blockY * 4,
    );
    offset += blockBytes;
    blockX += 1;
    if (blockX === blocksX) {
      blockX = 0;
      blockY += 1;
    }
  }
  return rgba;
}
