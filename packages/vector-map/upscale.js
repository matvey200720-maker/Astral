/*
 * Чёткое увеличение плиток карты.
 *
 * Плитка большой карты в игре — 1024 точки на 4500 метров штата. На дальнем
 * виде этого хватает, а при приближении игра растягивает её в несколько раз, и
 * дороги расплываются: карта «мылится». Штатная игра прячет это векторным
 * слоем поверх картинки, но своя карта живёт именно в картинке (почему —
 * `mapzoom.js`), поэтому чёткость ей даёт только разрешение плитки.
 *
 * Просто растянуть плитку мало: бикубическое увеличение даёт ту же мягкую
 * кромку, только на большем числе точек. Карта же — не фотография: она
 * нарисована ровными заливками, и кромка между ними — это переход между ДВУМЯ
 * известными цветами, сглаженный на одну точку. Увеличив плитку вчетверо, этот
 * переход можно сделать вчетверо уже — положение кромки бикубика даёт с
 * точностью до долей точки, а крутизну возвращает правка доли смеси:
 *
 *   1. плитка увеличивается бикубически (Catmull–Rom) в предумноженной альфе,
 *      чтобы прозрачное море не тянуло кромку берега к чёрному;
 *   2. для каждой точки исходной плитки ищутся два ближайших «опорных» цвета —
 *      те, что стоят по обе стороны ближайшей кромки;
 *   3. цвет увеличенной точки раскладывается на отрезок между ними, и доля
 *      смеси делается круче во столько раз, во сколько выросла плитка.
 *
 * Пары ищутся рядом с точкой, а не по палитре всей карты: на стыке трёх
 * заливок цвет сглаживания дороги совпадает с цветом застройки, и общая
 * палитра обводила бы каждую дорогу тонкой серой линией.
 *
 * Там, где опорных цветов рядом нет, ничего не правится: плавный ореол берега,
 * фотография вместо карты и шум сжатия остаются обычной бикубикой.
 *
 * Модуль чистый: пиксели приходят и уходят массивом RGBA.
 */

/* В пределах этого разброса по каналу точки считаются одной заливкой: столько
   блочное сжатие даёт ровному цвету, с запасом. */
const FLAT_TOLERANCE = 10;
/* Меньше этого расстояния (RGBA с предумноженной альфой) между двумя опорными
   цветами кромки нет — это ступень градиента, и делать её резче значит
   нарезать ореол берега полосами. */
const EDGE_CONTRAST = 26;
/* Насколько гребень обязан отличаться от обоих соседей поперёк себя. */
const RIDGE_CONTRAST = 16;
/* На сколько точек от кромки ищутся её стороны. */
const PAIR_RADIUS = 2;
/* Цвет, ушедший от отрезка между сторонами кромки дальше этой доли его
   длины, — стык трёх заливок: правка затухает, а не тянет его к чужой паре. */
const OFF_SEGMENT = 0.35;

/** Самый большой множитель: плитка 1024 становится 4096. */
export const MAX_UPSCALE_FACTOR = 6;

/**
 * Фазы целого множителя: откуда берётся точка и с какими весами.
 *
 * `cell` и `blend` — ближайшая слева (сверху) точка исходной плитки и доля
 * пути до следующей: ими же смешиваются правки соседних точек.
 */
function phaseTable(factor) {
  const phases = [];
  for (let phase = 0; phase < factor; phase += 1) {
    const position = (phase + 0.5) / factor - 0.5;
    const cell = Math.floor(position);
    const t = position - cell;
    const t2 = t * t;
    const t3 = t2 * t;
    phases.push({
      cell,
      blend: t,
      /* Catmull–Rom: четыре отвода, первый — на точку левее `cell`. */
      weights: [
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1,
        -1.5 * t3 + 2 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2,
      ],
    });
  }
  return phases;
}

/** Пиксели с предумноженной альфой: цвет прозрачной точки ничего не весит. */
function premultiply(data, count) {
  const result = new Float32Array(count * 4);
  for (let index = 0; index < count * 4; index += 4) {
    const alpha = data[index + 3];
    const weight = alpha / 255;
    result[index] = data[index] * weight;
    result[index + 1] = data[index + 1] * weight;
    result[index + 2] = data[index + 2] * weight;
    result[index + 3] = alpha;
  }
  return result;
}

/*
 * Опорные точки — те, чей цвет принадлежит самой карте, а не кромке.
 *
 * Их два рода. Заливка — точка, входящая хотя бы в один квадрат 2×2 одного
 * цвета. Гребень — точка линии у́же двух точек (просёлок, тонкая дорога): поперёк
 * себя она отличается от обоих соседей в одну сторону. Кромка сглаживания под
 * это не подходит: её соседи стоят по разные стороны от неё — один светлее,
 * другой темнее, — поэтому полоса вдоль прямой дороги опорой не становится и
 * каймой вокруг дороги не ложится.
 */
function anchorMask(data, premultiplied, width, height) {
  const block = new Uint8Array(width * height);
  const close = (a, b) =>
    Math.abs(data[a] - data[b]) <= FLAT_TOLERANCE &&
    Math.abs(data[a + 1] - data[b + 1]) <= FLAT_TOLERANCE &&
    Math.abs(data[a + 2] - data[b + 2]) <= FLAT_TOLERANCE &&
    Math.abs(data[a + 3] - data[b + 3]) <= FLAT_TOLERANCE;
  for (let y = 0; y + 1 < height; y += 1) {
    for (let x = 0; x + 1 < width; x += 1) {
      const a = (y * width + x) * 4;
      const b = a + 4;
      const c = a + width * 4;
      const d = c + 4;
      if (close(a, b) && close(a, c) && close(a, d) && close(b, c))
        block[y * width + x] = 1;
    }
  }
  const anchors = new Uint8Array(width * height);
  const limit = RIDGE_CONTRAST * RIDGE_CONTRAST;
  /* Гребень вдоль оси: оба соседа поперёк отличаются от точки, и в одну
     сторону (скалярное произведение разностей положительно). */
  const ridge = (index, step) => {
    const p = index * 4;
    const a = (index - step) * 4;
    const b = (index + step) * 4;
    let dot = 0;
    let first = 0;
    let second = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const da = premultiplied[a + channel] - premultiplied[p + channel];
      const db = premultiplied[b + channel] - premultiplied[p + channel];
      dot += da * db;
      first += da * da;
      second += db * db;
    }
    return dot > 0 && first >= limit && second >= limit;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (
        block[index] ||
        (x > 0 && block[index - 1]) ||
        (y > 0 && block[index - width]) ||
        (x > 0 && y > 0 && block[index - width - 1])
      ) {
        anchors[index] = 1;
        continue;
      }
      if (x < 1 || y < 1 || x + 1 >= width || y + 1 >= height) continue;
      if (
        ridge(index, 1) ||
        ridge(index, width) ||
        ridge(index, width + 1) ||
        ridge(index, width - 1)
      )
        anchors[index] = 1;
    }
  }
  return anchors;
}

/* Обход соседей кольцами: сначала ближние. Порядок фиксирован — результат
   обязан быть одинаковым при каждом запуске. */
const RINGS = (() => {
  const offsets = [];
  for (let dy = -PAIR_RADIUS; dy <= PAIR_RADIUS; dy += 1)
    for (let dx = -PAIR_RADIUS; dx <= PAIR_RADIUS; dx += 1)
      if (dx || dy) offsets.push([dx, dy, dx * dx + dy * dy]);
  offsets.sort(
    (left, right) =>
      left[2] - right[2] || left[1] - right[1] || left[0] - right[0],
  );
  return offsets;
})();

/*
 * Стороны кромки для каждой точки исходной плитки: индексы двух опорных точек
 * разного цвета, ближайших к ней. `-1` — кромки рядом нет.
 */
function edgePairs(premultiplied, anchors, width, height) {
  const pairs = new Int32Array(width * height * 2).fill(-1);
  const contrast = (a, b) => {
    const dr = premultiplied[a * 4] - premultiplied[b * 4];
    const dg = premultiplied[a * 4 + 1] - premultiplied[b * 4 + 1];
    const db = premultiplied[a * 4 + 2] - premultiplied[b * 4 + 2];
    const da = premultiplied[a * 4 + 3] - premultiplied[b * 4 + 3];
    return dr * dr + dg * dg + db * db + da * da;
  };
  const limit = EDGE_CONTRAST * EDGE_CONTRAST;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let first = anchors[index] ? index : -1;
      let second = -1;
      for (const [dx, dy] of RINGS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (!anchors[neighbour]) continue;
        if (first < 0) {
          first = neighbour;
          continue;
        }
        if (contrast(first, neighbour) >= limit) {
          second = neighbour;
          break;
        }
      }
      if (second < 0) continue;
      pairs[index * 2] = first;
      pairs[index * 2 + 1] = second;
    }
  }
  return pairs;
}

/**
 * Увеличивает плитку карты в целое число раз, сохраняя кромки заливок
 * резкими.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} source
 * @param {number} factor множитель: 1, 2 или 4
 * @param {object} [options]
 * @param {boolean} [options.sharpen] `false` оставляет обычную бикубику
 * @returns {{data: Uint8ClampedArray, width: number, height: number}}
 */
export function upscaleMapPixels(source, factor, options = {}) {
  const width = Number(source?.width) || 0;
  const height = Number(source?.height) || 0;
  const scale = Math.max(
    1,
    Math.min(MAX_UPSCALE_FACTOR, Math.round(Number(factor) || 1)),
  );
  if (!source?.data || !width || !height)
    return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  if (scale === 1)
    return { data: new Uint8ClampedArray(source.data), width, height };

  const sharpen = options.sharpen !== false;
  const outWidth = width * scale;
  const outHeight = height * scale;
  const premultiplied = premultiply(source.data, width * height);
  const pairs = sharpen
    ? edgePairs(
        premultiplied,
        anchorMask(source.data, premultiplied, width, height),
        width,
        height,
      )
    : null;
  const phases = phaseTable(scale);
  const result = new Uint8ClampedArray(outWidth * outHeight * 4);

  /*
   * Проход по строкам идёт окном: вертикальной свёртке нужны четыре строки,
   * уже растянутые по горизонтали, и держать всю промежуточную картинку
   * (шестьдесят мегабайт на плитку 4096) незачем.
   */
  const rows = new Map();
  const stretched = (sourceRow) => {
    const y = Math.min(height - 1, Math.max(0, sourceRow));
    let row = rows.get(y);
    if (row) return row;
    row = new Float32Array(outWidth * 4);
    const base = y * width * 4;
    for (let x = 0; x < outWidth; x += 1) {
      const { cell, weights } = phases[x % scale];
      const start = Math.floor(x / scale) + cell - 1;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let tap = 0; tap < 4; tap += 1) {
        const column = Math.min(width - 1, Math.max(0, start + tap));
        const at = base + column * 4;
        const weight = weights[tap];
        r += premultiplied[at] * weight;
        g += premultiplied[at + 1] * weight;
        b += premultiplied[at + 2] * weight;
        a += premultiplied[at + 3] * weight;
      }
      const to = x * 4;
      row[to] = r;
      row[to + 1] = g;
      row[to + 2] = b;
      row[to + 3] = a;
    }
    rows.set(y, row);
    /* Дальше четырёх строк назад окно не заглядывает. */
    for (const key of rows.keys()) if (key < y - 4) rows.delete(key);
    return row;
  };

  /*
   * Правка одной точки по паре её исходной клетки, с весом: сдвиг цвета
   * копится в `shift`. Клетки без пары ничего не добавляют.
   */
  const shift = [0, 0, 0, 0];
  const correct = (cell, weight, r, g, b, a) => {
    const first = pairs[cell * 2];
    if (first < 0) return;
    const from = first * 4;
    const to = pairs[cell * 2 + 1] * 4;
    const dr = premultiplied[to] - premultiplied[from];
    const dg = premultiplied[to + 1] - premultiplied[from + 1];
    const db = premultiplied[to + 2] - premultiplied[from + 2];
    const da = premultiplied[to + 3] - premultiplied[from + 3];
    const lengthSquared = dr * dr + dg * dg + db * db + da * da;
    const pr = r - premultiplied[from];
    const pg = g - premultiplied[from + 1];
    const pb = b - premultiplied[from + 2];
    const pa = a - premultiplied[from + 3];
    const t = (pr * dr + pg * dg + pb * db + pa * da) / lengthSquared;
    const steep = Math.min(1, Math.max(0, (t - 0.5) * scale + 0.5));
    /* Насколько цвет лежит на отрезке: вне его правка затухает. */
    const or = pr - dr * t;
    const og = pg - dg * t;
    const ob = pb - db * t;
    const oa = pa - da * t;
    const off =
      Math.sqrt(or * or + og * og + ob * ob + oa * oa) /
      (Math.sqrt(lengthSquared) * OFF_SEGMENT);
    if (off >= 1) return;
    const amount = (steep - t) * (1 - off) * weight;
    shift[0] += dr * amount;
    shift[1] += dg * amount;
    shift[2] += db * amount;
    shift[3] += da * amount;
  };

  for (let y = 0; y < outHeight; y += 1) {
    const phaseY = phases[y % scale];
    const cellY = Math.floor(y / scale) + phaseY.cell;
    const r0 = stretched(cellY - 1);
    const r1 = stretched(cellY);
    const r2 = stretched(cellY + 1);
    const r3 = stretched(cellY + 2);
    const [w0, w1, w2, w3] = phaseY.weights;
    /* Две строки клеток, между которыми стоит эта строка точек. */
    const top = Math.min(height - 1, Math.max(0, cellY)) * width;
    const bottom = Math.min(height - 1, Math.max(0, cellY + 1)) * width;
    const fy = phaseY.blend;
    for (let x = 0; x < outWidth; x += 1) {
      const at = x * 4;
      let r = r0[at] * w0 + r1[at] * w1 + r2[at] * w2 + r3[at] * w3;
      let g =
        r0[at + 1] * w0 + r1[at + 1] * w1 + r2[at + 1] * w2 + r3[at + 1] * w3;
      let b =
        r0[at + 2] * w0 + r1[at + 2] * w1 + r2[at + 2] * w2 + r3[at + 2] * w3;
      let a =
        r0[at + 3] * w0 + r1[at + 3] * w1 + r2[at + 3] * w2 + r3[at + 3] * w3;

      if (pairs) {
        /*
         * Правка смешивается из четырёх клеток вокруг точки теми же долями,
         * что билинейная выборка. Пара у соседних клеток бывает разной, и
         * правка «по своей клетке» рвалась бы ступенькой на их границе.
         */
        const phaseX = phases[x % scale];
        const cellX = Math.floor(x / scale) + phaseX.cell;
        const left = Math.min(width - 1, Math.max(0, cellX));
        const right = Math.min(width - 1, Math.max(0, cellX + 1));
        const fx = phaseX.blend;
        if (
          pairs[(top + left) * 2] >= 0 ||
          pairs[(top + right) * 2] >= 0 ||
          pairs[(bottom + left) * 2] >= 0 ||
          pairs[(bottom + right) * 2] >= 0
        ) {
          shift[0] = 0;
          shift[1] = 0;
          shift[2] = 0;
          shift[3] = 0;
          correct(top + left, (1 - fx) * (1 - fy), r, g, b, a);
          correct(top + right, fx * (1 - fy), r, g, b, a);
          correct(bottom + left, (1 - fx) * fy, r, g, b, a);
          correct(bottom + right, fx * fy, r, g, b, a);
          r += shift[0];
          g += shift[1];
          b += shift[2];
          a += shift[3];
        }
      }

      const alpha = a < 0 ? 0 : a > 255 ? 255 : a;
      if (alpha < 0.5) continue;
      const to = (y * outWidth + x) * 4;
      const unit = 255 / alpha;
      result[to] = r * unit;
      result[to + 1] = g * unit;
      result[to + 2] = b * unit;
      result[to + 3] = alpha;
    }
  }
  return { data: result, width: outWidth, height: outHeight };
}

/**
 * Во сколько раз можно увеличить плитку, не выйдя за предел стороны.
 *
 * @param {number} side сторона плитки игрока
 * @param {number} wanted множитель из проекта
 * @param {number} limit наибольшая сторона плитки, которую пишет редактор
 */
export function upscaleFactorFor(side, wanted, limit) {
  const size = Number(side) || 0;
  const target = Math.max(1, Math.round(Number(wanted) || 1));
  if (!size) return 1;
  let factor = 1;
  for (const candidate of [2, 3, 4, 6])
    if (candidate <= target && size * candidate <= limit) factor = candidate;
  return factor;
}
