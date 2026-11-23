/*
 * Область прицела — контурами без перекрытий.
 *
 * Прицел собирается из простых фигур: линии, точка, кольцо, уголки, шеврон.
 * Они пересекаются — кольцо проходит через линии, риски снайперки лежат на
 * самой линии, у плюса без зазора четыре руки сходятся в центре. В SVG это не
 * беда: правило `nonzero` закрашивает объединение. В Scaleform — беда: у
 * формы с одной заливкой перекрытие двух многоугольников вырезает дыру (так
 * заливку считает Flash, это видно и на рендере FFDec настоящего
 * `hud_reticle.gfx`: риски снайперки выходили с тёмной серединой ровно там,
 * где пересекали линию).
 *
 * Поэтому в игру уходит не набор фигур, а граница их объединения: замкнутые
 * контуры, которые друг на друга не заходят. Каждый обходится так, что
 * закрашенное лежит справа по ходу (по часовой стрелке на экране, где ось Y
 * смотрит вниз) — так пишет свои фигуры и сам Rockstar (`fillStyle1`). Дыры
 * — против часовой. При таком обходе всё равно, чем игра считает заливку:
 * чётностью пересечений или сторонами рёбер, — ответ один.
 *
 * Как считается. Плоскость режется на горизонтальные полосы по всем вершинам
 * и точкам пересечения рёбер. Внутри полосы рёбра не пересекаются, поэтому
 * покрытая часть полосы — набор трапеций, у каждой левая и правая сторона —
 * отрезки конкретных рёбер. Граница объединения — боковые стороны трапеций
 * плюс горизонтальные куски там, где покрытие полосы сверху и снизу
 * расходится. Остаётся склеить отрезки в замкнутые контуры по совпадающим
 * концам (в целых единицах сетки — твипах, двадцатых долях точки).
 *
 * `subject` — что закрасить, `clip` — что из этого вычесть: обводка
 * полупрозрачного прицела не должна лежать под его заливкой.
 */

const EPSILON = 1e-7;

const xAt = (edge, y) => edge.x0 + (y - edge.y0) * edge.k;

/** Фигура — массив контуров; контур — массив точек `[x, y]`. */
function loopsOf(shape) {
  if (!Array.isArray(shape) || !shape.length) return [];
  return Array.isArray(shape[0]?.[0]) ? shape : [shape];
}

/*
 * Вершины сразу встают на сетку: всё дальше считается в её целых единицах.
 * Тогда конец ребра, вычисленный из уравнения ребра, совпадает с вершиной
 * при округлении наверняка, и отрезки соседних полос сходятся без щелей.
 */
function collectEdges(shapes, set, edges, levels, firstId, scale) {
  let id = firstId;
  for (const shape of shapes) {
    for (const raw of loopsOf(shape)) {
      if (raw.length < 3) continue;
      const loop = raw.map(([x, y]) => {
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new TypeError("Точка фигуры прицела — не число.");
        return [Math.round(x * scale), Math.round(y * scale)];
      });
      for (let index = 0; index < loop.length; index += 1) {
        const a = loop[index];
        const b = loop[(index + 1) % loop.length];
        levels.push(a[1]);
        if (Math.abs(a[1] - b[1]) <= EPSILON) continue;
        const [top, bottom] = a[1] < b[1] ? [a, b] : [b, a];
        edges.push({
          x0: top[0],
          y0: top[1],
          y1: bottom[1],
          k: (bottom[0] - top[0]) / (bottom[1] - top[1]),
          shape: id,
          set,
        });
      }
    }
    id += 1;
  }
  return id;
}

/*
 * Точки пересечения рёбер — тоже границы полос. Рёбра перебираются в порядке
 * верхних концов с активным списком: пары, у которых высоты не пересекаются,
 * не сравниваются вовсе. Пересечение ищется по разности абсцисс на краях
 * общего отрезка высот: знак сменился — рёбра перекрестились внутри.
 */
function addCrossings(edges, levels) {
  const order = edges
    .map((_, index) => index)
    .sort((left, right) => edges[left].y0 - edges[right].y0);
  let active = [];
  for (const index of order) {
    const edge = edges[index];
    active = active.filter((other) => edges[other].y1 > edge.y0 + EPSILON);
    for (const otherIndex of active) {
      const other = edges[otherIndex];
      const top = Math.max(edge.y0, other.y0);
      const bottom = Math.min(edge.y1, other.y1);
      if (bottom - top <= EPSILON) continue;
      const above = xAt(edge, top) - xAt(other, top);
      const below = xAt(edge, bottom) - xAt(other, bottom);
      if (above * below >= 0) continue;
      levels.push(top + ((bottom - top) * above) / (above - below));
    }
    active.push(index);
  }
}

function uniqueSorted(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const result = [];
  for (const value of sorted)
    if (!result.length || value - result.at(-1) > EPSILON) result.push(value);
  return result;
}

/* Два соседних промежутка, у которых правая сторона первого совпадает с левой
   второго (две фигуры встык), — один промежуток: шва между ними нет. */
function mergeTouching(spans) {
  const result = [];
  for (const span of spans) {
    const last = result.at(-1);
    if (
      last &&
      Math.abs(last.ra - span.la) < 1e-6 &&
      Math.abs(last.rb - span.lb) < 1e-6
    ) {
      last.ra = span.ra;
      last.rb = span.rb;
    } else result.push({ ...span });
  }
  return result;
}

function coveredSpans(edges, active, ya, yb, shapeCount, covered) {
  const middle = (ya + yb) / 2;
  const sorted = active
    .map((index) => ({ edge: edges[index], x: xAt(edges[index], middle) }))
    .sort((left, right) => left.x - right.x);
  const inside = new Uint8Array(shapeCount);
  const counts = [0, 0];
  const spans = [];
  let open = null;
  for (const { edge } of sorted) {
    const before = covered(counts);
    counts[edge.set] += inside[edge.shape] ? -1 : 1;
    inside[edge.shape] ^= 1;
    const after = covered(counts);
    if (!before && after) open = edge;
    else if (before && !after && open) {
      spans.push({
        la: xAt(open, ya),
        lb: xAt(open, yb),
        ra: xAt(edge, ya),
        rb: xAt(edge, yb),
      });
      open = null;
    }
  }
  return mergeTouching(spans);
}

/* Где на одной прямой покрыто только сверху и где только снизу. */
function capRuns(above, below) {
  const points = uniqueSorted([...above.flat(), ...below.flat()]);
  const inside = (spans, x) => spans.some(([from, to]) => x > from && x < to);
  const runs = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const middle = (from + to) / 2;
    const up = inside(above, middle);
    const down = inside(below, middle);
    if (up === down) continue;
    const side = down ? "below" : "above";
    const last = runs.at(-1);
    if (last && last.side === side && Math.abs(last.to - from) < EPSILON)
      last.to = to;
    else runs.push({ from, to, side });
  }
  return runs;
}

const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

/* Лишние точки контура: повторы, точки на прямой и шипы «туда-обратно». */
function simplify(loop) {
  let points = loop;
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    const next = [];
    for (let index = 0; index < points.length; index += 1) {
      const previous = next.length ? next.at(-1) : points.at(-1);
      const current = points[index];
      const following = points[(index + 1) % points.length];
      /* На прямой — и продолжение, и шип: без средней точки граница та же
         (у шипа туда и обратно пройден один и тот же кусок). */
      if (
        (current[0] === previous[0] && current[1] === previous[1]) ||
        cross(previous, current, following) === 0
      ) {
        changed = true;
        continue;
      }
      next.push(current);
    }
    points = next;
  }
  return points.length >= 3 ? points : [];
}

/*
 * Отрезки границы — в замкнутые контуры. Концы совпадают точно: отрезки
 * считаются из одних и тех же рёбер на одних и тех же высотах и округляются
 * в одну сетку. Где контуры касаются вершиной, выбор продолжения не важен:
 * каждое ребро сохраняет свою сторону заливки, а чётность от порядка обхода
 * не зависит.
 */
function stitch(segments) {
  const key = ([x, y]) => `${x},${y}`;
  const outgoing = new Map();
  segments.forEach((segment, index) => {
    const from = key(segment[0]);
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(index);
  });
  const used = new Uint8Array(segments.length);
  const loops = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue;
    const loop = [];
    let index = start;
    while (index !== undefined && !used[index]) {
      used[index] = 1;
      loop.push(segments[index][0]);
      const candidates = outgoing.get(key(segments[index][1])) || [];
      index = candidates.find((candidate) => !used[candidate]);
    }
    const clean = simplify(loop);
    if (clean.length) loops.push(clean);
  }
  return loops;
}

/**
 * Граница области `subject − clip` замкнутыми контурами в целых единицах сетки.
 *
 * @param {Array} subject фигуры, которые закрашиваются (объединение)
 * @param {Array} clip фигуры, которые вычитаются
 * @param {{scale?: number}} options единиц сетки в точке (20 — твипы SWF)
 * @returns {Array<Array<[number, number]>>} контуры: закрашенное — справа
 */
export function regionContours(subject, clip = [], { scale = 20 } = {}) {
  const edges = [];
  const levels = [];
  const clipStart = collectEdges(subject, 0, edges, levels, 0, scale);
  const shapeCount = collectEdges(clip, 1, edges, levels, clipStart, scale);
  if (!edges.length) return [];
  addCrossings(edges, levels);
  const heights = uniqueSorted(levels);
  const covered = (counts) => counts[0] > 0 && counts[1] === 0;

  const byTop = edges
    .map((_, index) => index)
    .sort((left, right) => edges[left].y0 - edges[right].y0);
  const slabs = [];
  let next = 0;
  let active = [];
  for (let level = 0; level + 1 < heights.length; level += 1) {
    const ya = heights[level];
    const yb = heights[level + 1];
    while (next < byTop.length && edges[byTop[next]].y0 <= ya + EPSILON)
      active.push(byTop[next++]);
    active = active.filter((index) => edges[index].y1 >= yb - EPSILON);
    slabs.push(coveredSpans(edges, active, ya, yb, shapeCount, covered));
  }

  const point = (x, y) => [Math.round(x), Math.round(y)];
  const segments = [];
  const push = (from, to) => {
    if (from[0] !== to[0] || from[1] !== to[1]) segments.push([from, to]);
  };
  slabs.forEach((spans, level) => {
    const ya = heights[level];
    const yb = heights[level + 1];
    for (const span of spans) {
      /* Покрытое справа по ходу: левая сторона идёт вверх, правая — вниз. */
      push(point(span.lb, yb), point(span.la, ya));
      push(point(span.ra, ya), point(span.rb, yb));
    }
  });
  heights.forEach((y, level) => {
    const above = level > 0 ? slabs[level - 1].map((s) => [s.lb, s.rb]) : [];
    const below =
      level < slabs.length ? slabs[level].map((s) => [s.la, s.ra]) : [];
    for (const run of capRuns(above, below)) {
      /* Покрыто снизу — ход на восток, покрыто сверху — на запад. */
      if (run.side === "below") push(point(run.from, y), point(run.to, y));
      else push(point(run.to, y), point(run.from, y));
    }
  });
  return stitch(segments);
}
