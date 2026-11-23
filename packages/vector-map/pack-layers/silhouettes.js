const SIDE = 24;
const CELLS = SIDE * SIDE;
const DEFAULT_THRESHOLD = 0.72;
const MIN_FRAME_SIDE = 1e-6;

// Центры клеток вдоль оси в долях стороны рамки: (k + 0.5) / 24.
const CENTRES = Float64Array.from({ length: SIDE }, (_, k) => (k + 0.5) / SIDE);

// ---------- разбор пути SVG: конечный автомат, читаются только пары после прописных M и L ----------

// виды знаков
const OTHER = 0;
const COMMAND = 1;
const MINUS = 2;
const COMMA = 3;
const DIGIT = 4;
const SPACE = 5;
const END = 6;
const KINDS = 7;

// состояния
const IDLE = 0;
const GAP1 = 1; // пробелы между буквой и первым числом
const SIGN1 = 2;
const INT1 = 3;
const GAP2 = 4; // разделитель между числами
const SIGN2 = 5;
const INT2 = 6;

// (состояние, вид знака) → следующее состояние; -1 — переход сорвался
const STEPS = new Int8Array(7 * KINDS).fill(-1);
[
  [IDLE, COMMAND, GAP1],
  [GAP1, SPACE, GAP1],
  [GAP1, MINUS, SIGN1],
  [GAP1, DIGIT, INT1],
  [SIGN1, DIGIT, INT1],
  [INT1, DIGIT, INT1],
  [INT1, SPACE, GAP2],
  [INT1, COMMA, GAP2],
  [GAP2, SPACE, GAP2],
  [GAP2, COMMA, GAP2],
  [GAP2, MINUS, SIGN2],
  [GAP2, DIGIT, INT2],
  [SIGN2, DIGIT, INT2],
  [INT2, DIGIT, INT2],
].forEach(([from, kind, to]) => {
  STEPS[from * KINDS + kind] = to;
});

const ASCII_KINDS = Uint8Array.from({ length: 128 }, (_, code) => {
  const char = String.fromCharCode(code);
  if (char === "M" || char === "L") return COMMAND;
  if (char === "-") return MINUS;
  if (char === ",") return COMMA;
  if (char === "." || (char >= "0" && char <= "9")) return DIGIT;
  return char.trim() === "" ? SPACE : OTHER;
});

const kindAt = (text, at) => {
  if (at >= text.length) return END;
  const code = text.charCodeAt(at);
  if (code < 128) return ASCII_KINDS[code];
  return text[at].trim() === "" ? SPACE : OTHER;
};

/** Контуры одной строки пути дописываются в shape; контуры короче трёх точек отбрасываются. */
function scanPath(text, shape) {
  const xs = [];
  const ys = [];
  const firsts = [];
  let state = IDLE;
  let at = 0;
  let opens = false;
  let startA = 0;
  let endA = 0;
  let startB = 0;
  // Сорвавшаяся попытка не съедает знак, на котором сорвалась: он разбирается заново с нуля.
  while (at <= text.length) {
    const next = STEPS[state * KINDS + kindAt(text, at)];
    if (next >= 0) {
      if (state === IDLE) opens = text.charCodeAt(at) === 77;
      else if (state === GAP1 && next !== GAP1) startA = at;
      else if (state === INT1 && next === GAP2) endA = at;
      else if (state === GAP2 && next !== GAP2) startB = at;
      state = next;
      at += 1;
    } else if (state === IDLE) {
      at += 1;
    } else {
      if (state === INT2) {
        if (opens || firsts.length === 0) firsts.push(xs.length);
        xs.push(Number(text.slice(startA, endA)));
        ys.push(Number(text.slice(startB, at)));
      }
      state = IDLE;
    }
  }
  firsts.push(xs.length);
  for (let ring = 0; ring + 1 < firsts.length; ring += 1) {
    if (firsts[ring + 1] - firsts[ring] < 3) continue;
    for (let i = firsts[ring]; i < firsts[ring + 1]; i += 1) {
      shape.xs.push(xs[i]);
      shape.ys.push(ys[i]);
    }
    shape.starts.push(shape.xs.length);
  }
}

// ---------- рамка и закраска строк ----------

/** Квадратная рамка вокруг точек: фигура по центру, сторона не меньше 1e-6. NaN заражает рамку. */
function frameOf(xs, ys) {
  let lowX = Infinity;
  let highX = -Infinity;
  let lowY = Infinity;
  let highY = -Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    lowX = Math.min(lowX, xs[i]);
    highX = Math.max(highX, xs[i]);
    lowY = Math.min(lowY, ys[i]);
    highY = Math.max(highY, ys[i]);
  }
  const side = Math.max(highX - lowX, highY - lowY, MIN_FRAME_SIDE);
  return { left: (lowX + highX) / 2 - side / 2, up: (lowY + highY) / 2 - side / 2, side };
}

const columnsOf = (left, side) => Float64Array.from(CENTRES, (centre) => left + centre * side);

/**
 * Клетки строки от first до last: единица там, где центр клетки лежит левее нечётного числа
 * пересечений луча (hits[0..count)) — чёт-нечет. Нулей не пишет: маска изначально пуста.
 */
function paintRow(mask, offset, columns, first, last, hits, count) {
  for (let col = first; col <= last; col += 1) {
    const x = columns[col];
    let odd = 0;
    for (let k = 0; k < count; k += 1) {
      if (x < hits[k]) odd ^= 1;
    }
    if (odd) mask[offset + col] = 1;
  }
}

// ---------- экспорты ----------

/** Маска 24x24 по контурам путей SVG (Y вниз), дыры — по чёт-нечету. */
export const pathMask = (paths) => {
  const shape = { xs: [], ys: [], starts: [0] };
  paths.flatMap((path) => [String(path)]).forEach((text) => scanPath(text, shape));
  if (shape.starts.length === 1) return null;

  const xs = Float64Array.from(shape.xs);
  const ys = Float64Array.from(shape.ys);
  const { left, up, side } = frameOf(xs, ys);
  const columns = columnsOf(left, side);
  const mask = new Uint8Array(CELLS);
  const hits = new Float64Array(xs.length);
  for (let row = 0; row < SIDE; row += 1) {
    const y = up + CENTRES[row] * side;
    let count = 0;
    for (let ring = 0; ring + 1 < shape.starts.length; ring += 1) {
      const end = shape.starts[ring + 1];
      let previous = end - 1;
      for (let i = shape.starts[ring]; i < end; previous = i, i += 1) {
        const here = ys[i];
        const before = ys[previous];
        if ((here > y) !== (before > y)) {
          const x = xs[i];
          hits[count] = x + ((xs[previous] - x) * (y - here)) / (before - here);
          count += 1;
        }
      }
    }
    paintRow(mask, row * SIDE, columns, 0, SIDE - 1, hits, count);
  }
  return mask;
};

/** Вершины всех треугольников кусков: x и y по тройкам (Y вверх). */
function collectVertices(parts, xs, ys) {
  for (const part of parts) {
    const { positions } = part.group;
    for (const tri of part.tris) {
      const at = tri * 6;
      xs.push(positions[at], positions[at + 2], positions[at + 4]);
      ys.push(positions[at + 1], positions[at + 3], positions[at + 5]);
    }
  }
}

const cellOf = (distance, side) => Math.floor((distance / side) * SIDE);

const rowHits = (xs, ys, base, y, hits) => {
  let count = 0;
  for (let corner = 0; corner < 3; corner += 1) {
    const before = (corner + 2) % 3;
    const here = ys[base + corner];
    const other = ys[base + before];
    if ((here > y) !== (other > y)) {
      const x = xs[base + corner];
      hits[count] = x + ((xs[base + before] - x) * (y - here)) / (other - here);
      count += 1;
    }
  }
  return count;
};

/** Маска 24x24 по треугольникам кусков (Y вверх), объединение без чёт-нечета. */
export const partsMask = (parts) => {
  const listedX = [];
  const listedY = [];
  collectVertices(parts, listedX, listedY);
  if (listedX.length === 0) return null;

  const xs = Float64Array.from(listedX);
  const ys = Float64Array.from(listedY);
  const { left, up, side } = frameOf(xs, ys);
  const top = up + side;
  const columns = columnsOf(left, side);
  const mask = new Uint8Array(CELLS);
  const hits = new Float64Array(3);
  for (let base = 0; base < xs.length; base += 3) {
    const [ax, bx, cx] = [xs[base], xs[base + 1], xs[base + 2]];
    const [ay, by, cy] = [ys[base], ys[base + 1], ys[base + 2]];
    const firstColumn = Math.max(0, cellOf(Math.min(ax, bx, cx) - left, side));
    const lastColumn = Math.min(SIDE - 1, cellOf(Math.max(ax, bx, cx) - left, side));
    const lastRow = Math.min(SIDE - 1, cellOf(top - Math.min(ay, by, cy), side));
    for (let row = Math.max(0, cellOf(top - Math.max(ay, by, cy), side)); row <= lastRow; row += 1) {
      const count = rowHits(xs, ys, base, top - CENTRES[row] * side, hits);
      paintRow(mask, row * SIDE, columns, firstColumn, lastColumn, hits, count);
    }
  }
  return mask;
};

/** Образцы для sameSilhouette: массив { name, mask }, значки без контуров отброшены. */
export const packMasks = (paths) =>
  Object.entries(paths)
    .map(([name, path]) => ({ name, mask: pathMask([path]) }))
    .filter(({ mask }) => mask !== null);

// ---------- сравнение масок ----------

/** Общий случай: доля пересечения по длине первой маски; недостающие байты второй — нули. */
function overlap(a, b) {
  let both = 0;
  let either = 0;
  let at = a.length;
  while (at-- > 0) {
    both += a[at] & b[at];
    either += a[at] | b[at];
  }
  return either === 0 ? 0 : both / either;
}

/** Отражение по горизонтали: клетка (строка, столбец) берётся из (строка, 23 - столбец). */
const mirrorOf = (mask) => Array.from({ length: mask.length }, (_, cell) => mask[cell + SIDE - 1 - 2 * (cell % SIDE)]);

const isDense = (mask, least) => mask instanceof Uint8Array && mask.length >= least;

/** Большее из двух перекрытий (как есть и зеркально) за один проход по двум плотным маскам. */
function bestOverlap(mask, own) {
  let both = 0;
  let either = 0;
  let bothFlipped = 0;
  let eitherFlipped = 0;
  for (let row = 0; row < CELLS; row += SIDE) {
    for (let col = 0; col < SIDE; col += 1) {
      const there = own[row + col];
      const straight = mask[row + col];
      const flipped = mask[row + SIDE - 1 - col];
      both += straight & there;
      either += straight | there;
      bothFlipped += flipped & there;
      eitherFlipped += flipped | there;
    }
  }
  return Math.max(either === 0 ? 0 : both / either, eitherFlipped === 0 ? 0 : bothFlipped / eitherFlipped);
}

/** Имя образца, на который маска похожа сильнее всего (с учётом зеркала), или null. */
export const sameSilhouette = (mask, masks, threshold = DEFAULT_THRESHOLD) => {
  if (!mask) return null;
  const dense = isDense(mask, CELLS) && mask.length === CELLS;
  let mirror = null;
  let found = false;
  let leader = "";
  let top = 0;
  for (const sample of masks) {
    const { name, mask: own } = sample;
    let score;
    if (dense && isDense(own, CELLS)) {
      score = bestOverlap(mask, own);
    } else {
      mirror = mirror ?? mirrorOf(mask);
      score = Math.max(overlap(mask, own), overlap(mirror, own));
    }
    if (score >= threshold && (!found || score > top)) {
      found = true;
      leader = name;
      top = score;
    }
  }
  return (found && leader) || null;
};
