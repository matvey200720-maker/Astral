// Поле «расстояние до пустоты» в плане: от него зависит мягкий край куска карты.
// Считается и в окне, и в потоке разбора, поэтому модуль не знает ни о three, ни об окне.

export const EDGE_FIELD_SIZE = 256;
export const EDGE_FIELD_CLOSE = 3;

const FLAT_AREA = 1e-4;
const FAR = 1e9;
const RADIUS_MIN = 1;
const RADIUS_MAX = 6;

// ---------------------------------------------------------------------------
// Растрирование: треугольники сцены ложатся на сетку плана
// ---------------------------------------------------------------------------

// Закрасить отрезок клеток ряда; всё, что вне сетки, отсекается.
function paintSpan(ctx, row, left, right) {
  const from = Math.max(0, left);
  const to = Math.min(ctx.size - 1, right);
  if (!(from <= to)) return;
  const base = row * ctx.size;
  const { mask } = ctx;
  for (let at = base + from; at <= base + to; at += 1) mask[at] = 1;
  ctx.touched = true;
}

// Треугольник не больше клетки: красим клетки от целой части наименьшей
// координаты до целой части наибольшей, обе включительно.
function paintBlock(t, ctx) {
  const top = Math.max(0, Math.floor(t.loY));
  const bottom = Math.min(Math.floor(t.hiY), ctx.size - 1);
  const left = Math.floor(t.loX);
  const right = Math.floor(t.hiX);
  for (let row = top; row <= bottom; row += 1) paintSpan(ctx, row, left, right);
}

// Часть стороны, лежащая в полосе каждого ряда, расширяет отрезок этого ряда.
function cutEdge(px, py, qx, qy, top, rows, ctx) {
  const rise = qy - py;
  const run = qx - px;
  const { spanLeft, spanRight } = ctx;
  for (let k = 0; k < rows; k += 1) {
    const row = top + k;
    let from = 0;
    let to = 1;
    if (rise === 0) {
      if (py < row || py > row + 1) continue;
    } else {
      const entry = (row - py) / rise;
      const exit = (row + 1 - py) / rise;
      from = Math.max(0, Math.min(entry, exit));
      to = Math.min(1, Math.max(entry, exit));
      if (from > to) continue;
    }
    const xa = from <= 0 ? px : px + run * from;
    const xb = to >= 1 ? qx : px + run * to;
    spanLeft[k] = Math.min(spanLeft[k], xa, xb);
    spanRight[k] = Math.max(spanRight[k], xa, xb);
  }
}

// Обычный треугольник: по трём сторонам набираем отрезки рядов, потом красим.
function paintStrips(t, ctx) {
  const top = Math.max(0, Math.floor(t.loY));
  const bottom = Math.min(Math.floor(t.hiY), ctx.size - 1);
  if (!(top <= bottom)) return;
  const rows = bottom - top + 1;
  for (let k = 0; k < rows; k += 1) {
    ctx.spanLeft[k] = Infinity;
    ctx.spanRight[k] = -Infinity;
  }
  cutEdge(t.ax, t.ay, t.bx, t.by, top, rows, ctx);
  cutEdge(t.bx, t.by, t.cx, t.cy, top, rows, ctx);
  cutEdge(t.cx, t.cy, t.ax, t.ay, top, rows, ctx);
  for (let k = 0; k < rows; k += 1) {
    paintSpan(ctx, top + k, Math.floor(ctx.spanLeft[k]), Math.floor(ctx.spanRight[k]));
  }
}

// Правила для треугольника в клетках: срабатывает первое подходящее.
// null в действии — треугольник ничего не закрашивает.
const TRIANGLE_RULES = [
  {
    applies: (t, ctx) => t.hiX < 0 || t.loX >= ctx.size || t.hiY < 0 || t.loY >= ctx.size,
    act: null,
  },
  { applies: (t) => t.hiX - t.loX <= 1 && t.hiY - t.loY <= 1, act: paintBlock },
  {
    applies: (t) => Math.abs((t.bx - t.ax) * (t.cy - t.ay) - (t.by - t.ay) * (t.cx - t.ax)) < FLAT_AREA,
    act: null,
  },
  { applies: () => true, act: paintStrips },
];

function loadTriangle(t, positions, a, b, c, frame, size) {
  const { x0, y0, width, height } = frame;
  t.ax = ((positions[3 * a] - x0) * size) / width;
  t.ay = ((positions[3 * a + 1] - y0) * size) / height;
  t.bx = ((positions[3 * b] - x0) * size) / width;
  t.by = ((positions[3 * b + 1] - y0) * size) / height;
  t.cx = ((positions[3 * c] - x0) * size) / width;
  t.cy = ((positions[3 * c + 1] - y0) * size) / height;
  t.loX = Math.min(t.ax, t.bx, t.cx);
  t.hiX = Math.max(t.ax, t.bx, t.cx);
  t.loY = Math.min(t.ay, t.by, t.cy);
  t.hiY = Math.max(t.ay, t.by, t.cy);
}

// Возвращает маску «земли» size × size или null, если не закрашено ни одной клетки.
function footprintMask(meshes, frame, size) {
  const ctx = {
    size,
    mask: new Uint8Array(size * size),
    touched: false,
    spanLeft: new Float64Array(Math.max(0, Math.ceil(size)) + 1),
    spanRight: new Float64Array(Math.max(0, Math.ceil(size)) + 1),
  };
  const tri = {};
  for (const mesh of meshes) {
    const positions = mesh?.positions;
    const indices = mesh?.indices;
    if (!positions || !indices) continue;
    for (let k = 0; k + 2 < indices.length; k += 3) {
      loadTriangle(tri, positions, indices[k], indices[k + 1], indices[k + 2], frame, size);
      for (let r = 0; r < TRIANGLE_RULES.length; r += 1) {
        const rule = TRIANGLE_RULES[r];
        if (!rule.applies(tri, ctx)) continue;
        if (rule.act) rule.act(tri, ctx);
        break;
      }
    }
  }
  return ctx.touched ? ctx.mask : null;
}

// ---------------------------------------------------------------------------
// Замыкание узких щелей: рост и сжатие квадратным окном
// ---------------------------------------------------------------------------

// Одна линия клеток. При росте цель — земля, при сжатии — пустота, а край сетки
// сам считается пустотой. Клетка выживает по расстоянию до ближайшей цели.
function reshapeLine(cells, start, stride, count, radius, grow, gap) {
  const target = grow ? 1 : 0;
  let hit = grow ? -Infinity : -1;
  for (let k = 0; k < count; k += 1) {
    if (cells[start + k * stride] === target) hit = k;
    gap[k] = k - hit;
  }
  hit = grow ? Infinity : count;
  for (let k = count - 1; k >= 0; k -= 1) {
    const at = start + k * stride;
    if (cells[at] === target) hit = k;
    const near = Math.min(gap[k], hit - k);
    cells[at] = (grow ? near <= radius : near > radius) ? 1 : 0;
  }
}

// Маска, дополненная пустотой на радиус со всех сторон, после роста и сжатия.
function closeGaps(mask, size, radius) {
  // size не приводится к числу: строка «4» склеится с радиусом, как и в прежнем коде
  const wide = size + radius * 2;
  const cells = new Uint8Array(wide * wide);
  for (let row = 0; row < size; row += 1) {
    cells.set(mask.subarray(row * size, (row + 1) * size), (row + radius) * wide + radius);
  }
  const side = Number(wide);
  const gap = new Float64Array(side);
  for (const grow of [true, false]) {
    for (let line = 0; line < side; line += 1) reshapeLine(cells, line * side, 1, side, radius, grow, gap);
    for (let line = 0; line < side; line += 1) reshapeLine(cells, line, side, side, radius, grow, gap);
  }
  return { cells, side };
}

// ---------------------------------------------------------------------------
// Расстояния: два прохода «фаски»
// ---------------------------------------------------------------------------

// Начальные значения: замкнутая земля — «очень далеко», пустота — 0.
function seedMetres({ cells, side }, size, radius) {
  const metres = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (cells[(y + radius) * side + x + radius]) metres[y * size + x] = FAR;
    }
  }
  return metres;
}

// Один проход. forward — сверху вниз и слева направо, иначе — наоборот.
// Сосед за краем сетки считается пустотой (0).
function relax(metres, size, cost, forward) {
  const lead = forward ? -1 : 1;
  for (let a = 0; a < size; a += 1) {
    const row = forward ? a : size - 1 - a;
    const hasVertical = forward ? row > 0 : row < size - 1;
    for (let b = 0; b < size; b += 1) {
      const col = forward ? b : size - 1 - b;
      const i = row * size + col;
      if (!(metres[i] > 0)) continue;
      // индексы строятся от size как есть: у строкового размера нижние соседи уезжают
      const vertical = forward ? i - size : i + size;
      const sideA = col + lead >= 0 && col + lead < size;
      const sideB = col - lead >= 0 && col - lead < size;
      let best = metres[i];
      best = Math.min(best, (sideA ? metres[i + lead] : 0) + cost.x);
      best = Math.min(best, (hasVertical ? metres[vertical] : 0) + cost.y);
      best = Math.min(best, (hasVertical && sideA ? metres[vertical + lead] : 0) + cost.diag);
      best = Math.min(best, (hasVertical && sideB ? metres[vertical - lead] : 0) + cost.diag);
      metres[i] = best;
    }
  }
}

// Расстояния шли от центров клеток: у кромки земли остаётся полклетки.
function trimToEdge(metres, half) {
  for (let i = 0; i < metres.length; i += 1) {
    if (metres[i] > 0) metres[i] = Math.max(0, metres[i] - half);
  }
}

// ---------------------------------------------------------------------------
// Публичные функции
// ---------------------------------------------------------------------------

export function footprintDistances(
  meshes,
  box,
  { size = EDGE_FIELD_SIZE, closeMetres = EDGE_FIELD_CLOSE } = {},
) {
  const [x0, y0, x1, y1] = box;
  const width = x1 - x0;
  const height = y1 - y0;
  if (!(width > 0) || !(height > 0) || !meshes || !meshes.length) return null;

  const mask = footprintMask(meshes, { x0, y0, width, height }, size);
  if (!mask) return null;

  const cost = { x: width / size, y: height / size };
  cost.diag = Math.sqrt(cost.x * cost.x + cost.y * cost.y);
  const cell = Math.min(cost.x, cost.y);
  const radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.ceil(closeMetres / cell)));

  const metres = seedMetres(closeGaps(mask, size, radius), size, radius);
  relax(metres, size, cost, true);
  relax(metres, size, cost, false);
  trimToEdge(metres, cell / 2);
  return { size, box: [x0, y0, x1, y1], metres };
}

export function sceneBoxOf(bounds) {
  const corners = [bounds?.min, bounds?.max];
  if (!corners.every(Boolean)) return null;
  const [low, high] = corners;
  return [low[0], low[1], high[0], high[1]];
}

// Поле нужно у контура по умолчанию: у рамки, круга и своей рамки оно не нужно.
const WANTED_BY_TYPE = {
  boolean: () => true,
  number: () => true,
  object: ({ shape, box }) => !(shape === "box" || shape === "disc" || Array.isArray(box)),
};

export function edgeFieldWanted(option) {
  if (!option) return false;
  const verdict = WANTED_BY_TYPE[typeof option];
  return verdict ? verdict(option) : false;
}
