/*
 * Разбор краски дорожных листов на группы (ТЗ 17.10.2026, вечер, задача 1).
 *
 * Разметка в GTA V лежит двумя способами: листами-атласами с альфой
 * (`im_roadmarkings*`: полосы, стрелки, надписи на одном листе) и линиями,
 * нарисованными прямо в листе асфальта (трассы, сельские дороги, переходы).
 * Редактор красит не лист, а краску на нём — и красит группами: каждая
 * группа своим цветом, яркостью или «Скрыть».
 *
 * Прежний разбор (HSL, порог «средняя светлота листа + 0,3», пятна короче
 * пятой части листа не краска) промахивался, и это доказано по файлам игры:
 *   • кремовая белая краска сельских трасс (231, 219, 200) в HSL «насыщенная»
 *     (0,39) и считалась жёлтой; в HSV её насыщенность 0,13 — это белая;
 *   • зебра переходов (`im_road_crossing_002…005`) занимает до половины листа,
 *     порог «среднее + 0,3» оказывался выше самой зебры, и линий не находили;
 *   • на дальних листах (64–256 px) линии размыты в 2–3 тексель.
 *
 * Здесь краска ищется по HSV (жёлтая: тон 26–72°, насыщенность от 0,36;
 * белая: почти серая и светлая; цветная: насыщенная прочая) и по поверхности
 * листа (краска ярче своего окружения), потом пятна — связные компоненты —
 * получают группу по форме и цвету:
 *
 *   center   — жёлтые линии вдоль дороги (осевая, двойная, жёлтая кромка);
 *   edge     — белые линии вдоль дороги (края, полосы, прерывистая);
 *   crossing — полосы пешеходных переходов;
 *   stops    — стоп-линии (поперёк дороги), стрелки, надписи, значки;
 *   coloured — цветная краска (синяя, красная, зелёная);
 *   parking  — разметка парковок.
 *
 * Функция одна у кадра мастерской, у установщика и у описи, поэтому в игре
 * ровно то, что было в кадре. Чистая: только числа, ничего не читает.
 */

export const ROAD_GROUP_IDS = Object.freeze(["center", "edge", "crossing", "stops", "coloured", "parking"]);
/** Бит группы в маске описи (`inventory/roads.js`): 1, 2, 4, 8, 16, 32. */
export const ROAD_GROUP_BITS = Object.freeze(Object.fromEntries(ROAD_GROUP_IDS.map((id, index) => [id, 1 << index])));
export const ROAD_GROUP_ALL = (1 << ROAD_GROUP_IDS.length) - 1;
/** Номер группы в карте краски листа: 0 — не краска, 1…6 — по порядку `ROAD_GROUP_IDS`. */
export const roadGroupNumber = (id) => ROAD_GROUP_IDS.indexOf(id) + 1;

/* Тон 0…360, насыщенность и яркость HSV 0…1. */
export function paintHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, v];
}

export const YELLOW_HUE = Object.freeze([26, 72]);
/* Насыщенность жёлтой краски в листе асфальта: песок и грязь (0,25–0,32) — не краска. */
export const YELLOW_SATURATION = 0.36;
/* Ниже — «почти серая»: белая краска, в том числе тёплая (кремовая). */
export const WHITE_SATURATION = 0.26;

/**
 * Цвет краски пикселя: 1 жёлтая, 2 белая, 3 цветная, 0 — не краска.
 * `atlas` — лист-атлас с альфой: жёлтая и с насыщенностью от 0,26 (потёртая).
 * `floor` — яркость HSV, ниже которой тёмное — не краска, а покрытие.
 */
export function paintColourClass(r, g, b, { atlas = false, floor = atlas ? 0.38 : 0.5 } = {}) {
  return colourClassOf(r, g, b, atlas, floor);
}

/*
 * То же, что `paintColourClass`, но числами, без массива `[h, s, v]` на каждый тексель (04.11.2026: в профиле сборки «Дорог» разбор краски — сотни тысяч
 * вызовов на лист, массивы шли в сборщик мусора). Арифметика та же, порядок проверок тот же — ответ тот же на каждом входе.
 */
function colourClassOf(r, g, b, atlas, floor) {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = max - min;
  if (max / 255 < floor) return 0;
  const s = max === 0 ? 0 : d / max;
  if (s < WHITE_SATURATION) return 2;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  if (h >= YELLOW_HUE[0] && h <= YELLOW_HUE[1] && s >= (atlas ? 0.26 : YELLOW_SATURATION)) return 1;
  if (s >= 0.45) return 3;
  return 0;
}

/*
 * Среднее по окну (2r + 1)² с оборачиванием: листы дорог повторяются плиткой.
 *
 * 04.11.2026 (профиль сборки «Дорог»: 180 с процессора из 1136): индексы со сдвигом «по кругу» считаются один раз на размер, а не остатком от деления на каждый
 * тексель, а вертикальный проход идёт по строкам (суммы столбцов лежат в `Float64Array`), а не по столбцам через весь лист. Числа те же и в том же порядке
 * (сумма окна — двойной точности, запись — во `Float32Array`), поэтому ответ тот же до последнего бита.
 */
function boxBlur(source, width, height, radius) {
  const window = 2 * radius + 1;
  const wrapped = (count, size, shift) => {
    const indexes = new Int32Array(count);
    for (let at = 0; at < count; at += 1) indexes[at] = (((at + shift) % size) + size) % size;
    return indexes;
  };
  const columnsAdd = wrapped(width, width, radius + 1);
  const columnsDrop = wrapped(width, width, -radius);
  const rowsAdd = wrapped(height, height, radius + 1);
  const rowsDrop = wrapped(height, height, -radius);
  const tmp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += source[row + (((x % width) + width) % width)];
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / window;
      sum += source[row + columnsAdd[x]] - source[row + columnsDrop[x]];
    }
  }
  const column = new Float64Array(width);
  for (let y = -radius; y <= radius; y += 1) {
    const row = (((y % height) + height) % height) * width;
    for (let x = 0; x < width; x += 1) column[x] += tmp[row + x];
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const add = rowsAdd[y] * width;
    const drop = rowsDrop[y] * width;
    for (let x = 0; x < width; x += 1) {
      out[row + x] = column[x] / window;
      column[x] += tmp[add + x] - tmp[drop + x];
    }
  }
  return out;
}

/* Порог Оцу по светлоте 0…1: граница между покрытием и краской (зебра — две горки). */
function otsu(values) {
  const histogram = new Float64Array(64);
  let count = 0;
  for (const value of values) {
    histogram[Math.min(63, Math.floor(value * 64))] += 1;
    count += 1;
  }
  if (!count) return 0.5;
  let sumAll = 0;
  for (let index = 0; index < 64; index += 1) sumAll += index * histogram[index];
  let weightBack = 0;
  let sumBack = 0;
  let best = 0;
  let threshold = 32;
  for (let index = 0; index < 64; index += 1) {
    weightBack += histogram[index];
    if (!weightBack) continue;
    const weightFront = count - weightBack;
    if (!weightFront) break;
    sumBack += index * histogram[index];
    const between = weightBack * weightFront * (sumBack / weightBack - (sumAll - sumBack) / weightFront) ** 2;
    if (between > best) {
      best = between;
      threshold = index + 1;
    }
  }
  return threshold / 64;
}

/*
 * Полосы зебры: лист переходов — покрытие и широкие светлые полосы, а у
 * износа полосы ещё и пятнисты. Порог — между горками светлоты (Оцу); если
 * горки не разошлись (лист без зебры: трещины, пятна), полос нет. Полосы —
 * столбцы (или строки) листа, где светлого не меньше половины: так вся полоса
 * целиком, а не крошки по её краю; тёмное внутри полосы — стёртая краска,
 * цвет её тоже сменится, но светлота останется тёмной.
 */
function crossingBars(luma, opaque, width, height, candidate) {
  const sample = [];
  for (let index = 0; index < luma.length; index += 7) if (opaque[index]) sample.push(luma[index]);
  const threshold = otsu(sample);
  let high = 0;
  let low = 0;
  let highCount = 0;
  let lowCount = 0;
  for (const value of sample) {
    if (value >= threshold) {
      high += value;
      highCount += 1;
    } else {
      low += value;
      lowCount += 1;
    }
  }
  if (!highCount || !lowCount || high / highCount - low / lowCount < 0.14) return;
  const byColumn = new Float32Array(width);
  const byRow = new Float32Array(height);
  for (let index = 0; index < luma.length; index += 1)
    if (opaque[index] && luma[index] >= threshold) {
      byColumn[index % width] += 1;
      byRow[Math.floor(index / width)] += 1;
    }
  for (let x = 0; x < width; x += 1) byColumn[x] /= height;
  for (let y = 0; y < height; y += 1) byRow[y] /= width;
  const spread = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  };
  const vertical = spread(byColumn) >= spread(byRow);
  const profile = vertical ? byColumn : byRow;
  const length = profile.length;
  const runs = [];
  for (let at = 0; at < length; at += 1) {
    if (profile[at] < 0.5) continue;
    let end = at;
    while (end + 1 < length && profile[end + 1] >= 0.5) end += 1;
    runs.push([at, end]);
    at = end;
  }
  /* Близкие полосы с щелью меньше полутора процентов листа — одна полоса. */
  const joined = [];
  for (const run of runs) {
    const last = joined.at(-1);
    if (last && run[0] - last[1] <= length * 0.015) last[1] = run[1];
    else joined.push([...run]);
  }
  const bars = joined.filter(([from, to]) => to - from + 1 >= length * 0.025 && to - from + 1 <= length * 0.3);
  /* Зебра — несколько полос, что вместе занимают меньшую часть листа; сплошное пятно — не зебра, а светлый износ. */
  const covered = bars.reduce((sum, [from, to]) => sum + to - from + 1, 0);
  if (bars.length < 2 || covered > length * 0.62) return;
  for (const [from, to] of bars)
    for (let across = 0; across < (vertical ? height : width); across += 1)
      for (let along = from; along <= to; along += 1) {
        const index = vertical ? across * width + along : along * width + across;
        if (opaque[index]) candidate[index] = 2;
      }
}

/**
 * Карта краски листа: `{ groups, present, painted, counts }`. `groups` — по
 * тексельно: 0 не краска, 1…6 группа (`ROAD_GROUP_IDS`); `present` — маска
 * групп, что есть на листе; `counts` — текселей в каждой группе.
 *
 * `part` — часть листа (`markings` — лист-атлас с альфой, остальное — краска
 * поверх покрытия), `kind` — `crossing` (лист зебры) или `parking`
 * (разметка парковок), `lod` — дальний лист (линии тоньше, порог мягче).
 */
export function roadPaintGroups(rgba, width, height, { part = "asphalt", kind = null, lod = false } = {}) {
  const total = width * height;
  const atlas = part === "markings";
  const small = lod || Math.min(width, height) <= 128;
  const groups = new Uint8Array(total);
  const counts = new Array(ROAD_GROUP_IDS.length).fill(0);
  const luma = new Float32Array(total);
  const opaque = new Uint8Array(total);
  for (let index = 0, at = 0; index < total; index += 1, at += 4) {
    luma[index] = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
    /* У листа-атласа краска потёрта и полупрозрачна (значки и надписи — с альфой от 40): порог низкий. */
    opaque[index] = rgba[at + 3] >= (atlas ? 24 : 128) ? 1 : 0;
  }
  /* Кандидаты: цвет краски и — у листа асфальта — «ярче окружения». */
  const candidate = new Uint8Array(total);
  const floor = atlas ? 0.38 : small ? 0.45 : 0.52;
  if (atlas) {
    for (let index = 0, at = 0; index < total; index += 1, at += 4)
      if (opaque[index]) candidate[index] = colourClassOf(rgba[at], rgba[at + 1], rgba[at + 2], true, floor);
  } else if (kind === "crossing") {
    crossingBars(luma, opaque, width, height, candidate);
  } else {
    const radius = Math.max(small ? 3 : 6, Math.round(Math.min(width, height) * 0.05));
    const local = boxBlur(luma, width, height, radius);
    const margin = small ? 0.05 : 0.09;
    for (let index = 0, at = 0; index < total; index += 1, at += 4) {
      if (!opaque[index] || luma[index] - local[index] < margin) continue;
      candidate[index] = colourClassOf(rgba[at], rgba[at + 1], rgba[at + 2], false, floor);
    }
  }

  /* Пятна: связные компоненты по краске (8 соседей), пыль — прочь. */
  const least = Math.max(small ? 4 : 10, Math.round(total * (atlas ? 0.00005 : 0.00008)));
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  /* Тексели пятна лежат в одном буфере на лист (а не в новом массиве на каждое пятно): их потом перебирают подряд. */
  const members = new Int32Array(total);
  const longSide = Math.max(width, height);
  const reach = small ? 1 : 2;
  for (let start = 0; start < total; start += 1) {
    if (!candidate[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let size = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    /* Пятно — связные тексели одного цвета краски: жёлтая стрелка рядом с белой надписью — два пятна. */
    const colour = candidate[start];
    while (top) {
      const index = stack[--top];
      members[size++] = index;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      /* Соседи в пределах двух текселей: потёртая краска в крапинах не рвётся на крошки. Окно обрезается по листу один раз, а не проверкой каждого соседа;
         сам тексель в окне уже виден (`seen`), отдельной проверки не нужно. */
      const fromY = y > reach ? y - reach : 0;
      const toY = y + reach < height ? y + reach : height - 1;
      const fromX = x > reach ? x - reach : 0;
      const toX = x + reach < width ? x + reach : width - 1;
      for (let ny = fromY; ny <= toY; ny += 1) {
        const row = ny * width;
        for (let nx = fromX; nx <= toX; nx += 1) {
          const next = row + nx;
          if (candidate[next] === colour && !seen[next]) {
            seen[next] = 1;
            stack[top++] = next;
          }
        }
      }
    }
    if (size < least) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const elongated = Math.max(w, h) / Math.max(1, Math.min(w, h)) >= 4;
    const vertical = h >= w;
    const fill = size / (w * h);
    /* Толщина — сколько текселей в поперечнике полосы: у настоящей линии десятки, у ряби покрытия (зернистый бетон, канавки) — два-три. */
    const thickness = size / Math.max(w, h);
    const dominant = colour;
    let group;
    if (kind === "parking") group = 6;
    else if (kind === "crossing") group = 3;
    else if (atlas) {
      /* Атлас: вытянутое вдоль листа — линия, поперёк — стоп-линия, крупное остальное — знаки и надписи; мелкая крошка — не краска. */
      if (elongated && vertical && Math.max(w, h) >= longSide * 0.25) group = dominant === 3 ? 5 : dominant === 1 ? 1 : 2;
      else if (elongated && !vertical && Math.max(w, h) >= longSide * 0.25) group = 4;
      else if (size >= Math.max(least, total * 0.0003)) group = dominant === 3 ? 5 : 4;
      else continue;
      if (dominant === 3) group = 5;
    } else {
      /* Краска в листе асфальта — полоса: вытянутая, плотная (не крошка и не рябь покрытия) и не короче заметной части листа. */
      const line = elongated && fill >= 0.4 && thickness >= (small ? 1 : 6) && Math.max(w, h) >= longSide * (small ? 0.12 : 0.06);
      const sign = !elongated && fill >= 0.4 && size >= total * 0.002;
      if (!line && !sign) continue;
      group = dominant === 3 ? 5 : sign ? 4 : dominant === 1 ? 1 : 2;
    }
    for (let at = 0; at < size; at += 1) groups[members[at]] = group;
    counts[group - 1] += size;
  }

  /* Кромка: тексель рядом с краской, светлее покрытия, но ниже порога, — тоже краска
     (так у линии не остаётся ободка прежнего цвета). У атласа кромка — альфа листа. */
  if (!atlas) {
    const grown = new Uint8Array(groups);
    for (let index = 0; index < total; index += 1) {
      if (groups[index] || !opaque[index]) continue;
      const x = index % width;
      /* Соседи слева, справа, сверху, снизу — в этом порядке, берётся последний с краской (как в массиве, что был здесь раньше). */
      let best = 0;
      if (x > 0 && groups[index - 1]) best = groups[index - 1];
      if (x < width - 1 && groups[index + 1]) best = groups[index + 1];
      if (index >= width && groups[index - width]) best = groups[index - width];
      if (index + width < total && groups[index + width]) best = groups[index + width];
      if (best && luma[index] >= 0.28) grown[index] = best;
    }
    for (let index = 0; index < total; index += 1)
      if (grown[index] && !groups[index]) {
        groups[index] = grown[index];
        counts[grown[index] - 1] += 1;
      }
  }
  let present = 0;
  counts.forEach((count, index) => {
    if (count) present |= 1 << index;
  });
  return { groups, present, painted: present !== 0, counts };
}
