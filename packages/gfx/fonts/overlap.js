/*
 * Перекрывающиеся контуры буквы — без перекрытий.
 *
 * У вариативных шрифтов (Bahnschrift) и составных букв (Ç, Ş, Å) контуры
 * накладываются друг на друга: по правилу ненулевой обмотки (TrueType) это
 * одна заливка, по правилу «чёт-нечет» — дыры на месте наложения. Правило
 * заливки шрифтов Scaleform по файлам игры не видно (у её шрифтов наложений
 * нет), поэтому такая буква пересобирается: растр по ненулевой обмотке
 * (4 точки на единицу кегля), обход границ залитых точек и упрощение
 * ломаных (Дуглас — Пекер, допуск 0,35 единицы кегля: ступеньки растра
 * уходят, а буква в 60 точек отходит от исходной меньше чем на десятую
 * точки). Контуры выходят без наложений — одинаково при любом правиле, и
 * файл у шрифта с наложениями (Bahnschrift) втрое легче, чем при допуске
 * в полточки растра.
 */

const STEPS = 8;
const DENSITY = 4;
const TOLERANCE = 1.4;
/* Строк проверки наложений: петля толщиной в четверть единицы кегля не проскочит. */
const SCAN_ROWS = 128;

function flatten(contours) {
  return contours.map((contour) => {
    const points = [[contour.start.x, contour.start.y]];
    let x = contour.start.x;
    let y = contour.start.y;
    for (const segment of contour.segments) {
      if ("cx" in segment) {
        for (let step = 1; step <= STEPS; step += 1) {
          const t = step / STEPS;
          const u = 1 - t;
          points.push([u * u * x + 2 * u * t * segment.cx + t * t * segment.x, u * u * y + 2 * u * t * segment.cy + t * t * segment.y]);
        }
      } else points.push([segment.x, segment.y]);
      x = segment.x;
      y = segment.y;
    }
    return points;
  });
}

/* Пересечения горизонтали `py` с ломаными: `[x, направление]`. */
function crossings(polygons, py) {
  const out = [];
  for (const points of polygons)
    for (let k = 0; k < points.length; k += 1) {
      const [ax, ay] = points[k];
      const [bx, by] = points[(k + 1) % points.length];
      if (ay <= py !== by <= py) out.push([ax + ((py - ay) / (by - ay)) * (bx - ax), by > ay ? 1 : -1]);
    }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Есть ли у буквы места, где обмотка и «чёт-нечет» расходятся. */
export function hasOverlaps(contours) {
  if (!contours.length) return false;
  const polygons = flatten(contours);
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const points of polygons) for (const [, y] of points) (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  for (let row = 0; row < SCAN_ROWS; row += 1) {
    const py = y0 + ((row + 0.5) / SCAN_ROWS) * (y1 - y0);
    let winding = 0;
    let parity = 0;
    const list = crossings(polygons, py);
    for (let k = 0; k + 1 < list.length; k += 1) {
      winding += list[k][1];
      parity ^= 1;
      if ((winding !== 0) !== (parity === 1) && list[k + 1][0] - list[k][0] > 0.25) return true;
    }
  }
  return false;
}

/* Дуглас — Пекер по замкнутой ломаной. */
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  /* Вторая опорная — самая дальняя от первой: замкнутая ломаная делится на две. */
  let far = 0;
  let best = -1;
  for (let k = 1; k < points.length; k += 1) {
    const d = (points[k][0] - points[0][0]) ** 2 + (points[k][1] - points[0][1]) ** 2;
    if (d > best) (best = d), (far = k);
  }
  keep[far] = 1;
  const stack = [[0, far], [far, points.length]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = points[a];
    const pb = points[b % points.length];
    let worst = -1;
    let at = -1;
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const length = Math.hypot(dx, dy) || 1;
    for (let k = a + 1; k < b; k += 1) {
      const d = Math.abs((points[k][0] - pa[0]) * dy - (points[k][1] - pa[1]) * dx) / length;
      if (d > worst) (worst = d), (at = k);
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/*
 * Полоса вокруг ломаных: точки растра не дальше `radius` от любого ребра
 * (капсулы рёбер). Строка капсулы — один отрезок: капсула выпуклая.
 */
function markNear(polygons, near, width, height, toRaster, radius) {
  const r2 = radius * radius;
  for (const points of polygons)
    for (let k = 0; k < points.length; k += 1) {
      const [ax, ay] = toRaster(points[k]);
      const [bx, by] = toRaster(points[(k + 1) % points.length]);
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const rowFrom = Math.max(0, Math.ceil(Math.min(ay, by) - radius));
      const rowTo = Math.min(height - 1, Math.floor(Math.max(ay, by) + radius));
      for (let row = rowFrom; row <= rowTo; row += 1) {
        let low = Infinity;
        let high = -Infinity;
        /* Круги на концах. */
        for (const [cx, cy] of [
          [ax, ay],
          [bx, by],
        ]) {
          const h = r2 - (row - cy) * (row - cy);
          if (h < 0) continue;
          const half = Math.sqrt(h);
          low = Math.min(low, cx - half);
          high = Math.max(high, cx + half);
        }
        /* Полоса вдоль ребра: точки с проекцией внутри отрезка. */
        if (length2 > 1e-9) {
          const length = Math.sqrt(length2);
          const nx = -dy / length;
          const ny = dx / length;
          /* Края полосы — четыре стороны прямоугольника ребра. */
          const corners = [
            [ax + nx * radius, ay + ny * radius],
            [bx + nx * radius, by + ny * radius],
            [bx - nx * radius, by - ny * radius],
            [ax - nx * radius, ay - ny * radius],
          ];
          for (let c = 0; c < 4; c += 1) {
            const [px, py] = corners[c];
            const [qx, qy] = corners[(c + 1) % 4];
            if (py === qy) {
              if (Math.abs(row - py) < 1e-9) (low = Math.min(low, px, qx)), (high = Math.max(high, px, qx));
              continue;
            }
            if ((row - py) * (row - qy) > 0) continue;
            const x = px + ((row - py) / (qy - py)) * (qx - px);
            low = Math.min(low, x);
            high = Math.max(high, x);
          }
        }
        if (low > high) continue;
        const from = Math.max(0, Math.ceil(low));
        const to = Math.min(width - 1, Math.floor(high));
        if (from <= to) near.fill(1, row * width + from, row * width + to + 1);
      }
    }
}

/**
 * Контуры без наложений: растр по ненулевой обмотке и обход его границ.
 * `offset` — сдвиг границы в тех же единицах: больше нуля — буква жирнее
 * (растр плюс полоса вокруг контура), меньше — тоньше (растр минус полоса).
 * Так толщина не даёт ни петель, ни «усов» на острых углах и закрывает
 * мелкие просветы, как настоящее утолщение. Возвращает сегменты-прямые в
 * тех же единицах.
 */
export function removeOverlaps(contours, { offset = 0 } = {}) {
  const polygons = flatten(contours);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const points of polygons)
    for (const [x, y] of points) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (!Number.isFinite(x0)) return [];
  const grow = Math.max(0, offset);
  const left = Math.floor(x0 - grow) - 1;
  const top = Math.floor(y0 - grow) - 1;
  const width = Math.ceil((x1 + grow - left + 1) * DENSITY) + 1;
  const height = Math.ceil((y1 + grow - top + 1) * DENSITY) + 1;
  const filled = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const py = top + (row + 0.5) / DENSITY;
    const list = crossings(polygons, py);
    let winding = 0;
    for (let k = 0; k + 1 < list.length; k += 1) {
      winding += list[k][1];
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil((list[k][0] - left) * DENSITY - 0.5));
      const to = Math.min(width - 1, Math.floor((list[k + 1][0] - left) * DENSITY - 0.5));
      for (let column = from; column <= to; column += 1) filled[row * width + column] = 1;
    }
  }
  if (offset) {
    /* Центр точки растра (column, row) — это (left + (column + ½)/D, top + (row + ½)/D). */
    const near = new Uint8Array(width * height);
    const toRaster = ([x, y]) => [(x - left) * DENSITY - 0.5, (y - top) * DENSITY - 0.5];
    markNear(polygons, near, width, height, toRaster, Math.abs(offset) * DENSITY);
    if (offset > 0) for (let at = 0; at < filled.length; at += 1) filled[at] |= near[at];
    else for (let at = 0; at < filled.length; at += 1) if (near[at]) filled[at] = 0;
  }
  const at = (column, row) => (column >= 0 && row >= 0 && column < width && row < height ? filled[row * width + column] : 0);
  /* Рёбра границы: залитая точка слева от направления обхода. */
  const edges = new Map();
  const key = (x, y) => y * (width + 1) + x;
  const addEdge = (ax, ay, bx, by) => {
    const from = key(ax, ay);
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push([bx, by]);
  };
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1) {
      if (!at(column, row)) continue;
      if (!at(column, row - 1)) addEdge(column + 1, row, column, row);
      if (!at(column - 1, row)) addEdge(column, row, column, row + 1);
      if (!at(column, row + 1)) addEdge(column, row + 1, column + 1, row + 1);
      if (!at(column + 1, row)) addEdge(column + 1, row + 1, column + 1, row);
    }
  const loops = [];
  for (const [start, list] of edges) {
    while (list.length) {
      const sx = start % (width + 1);
      const sy = Math.floor(start / (width + 1));
      const points = [[sx, sy]];
      let [cx, cy] = list.pop();
      for (let guard = 0; guard < width * height * 4; guard += 1) {
        if (cx === sx && cy === sy) break;
        points.push([cx, cy]);
        const next = edges.get(key(cx, cy));
        if (!next?.length) break;
        [cx, cy] = next.pop();
      }
      if (points.length >= 4) loops.push(points);
    }
  }
  return loops
    .map((points) => simplify(points, TOLERANCE))
    .filter((points) => points.length >= 3)
    .map((points) => {
      const unit = points.map(([x, y]) => ({ x: left + x / DENSITY, y: top + y / DENSITY }));
      return { start: unit[0], segments: [...unit.slice(1), unit[0]].map((point) => ({ x: point.x, y: point.y })) };
    });
}
