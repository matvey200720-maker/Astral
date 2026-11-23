/*
 * Линия — полоса из треугольников (слои большой карты на радаре, задача 28).
 *
 * Радар знает только заливку треугольников, поэтому граница зоны, пунктир и
 * стрелка рисуются полосой: у каждой вершины ломаной две точки по обе стороны
 * (или по одну, если граница идёт «внутрь»), а между соседними вершинами —
 * четырёхугольник из двух треугольников. Соседние четырёхугольники делят
 * одни и те же две точки, поэтому не заходят друг на друга: полупрозрачная
 * линия не темнеет в изгибах, как темнела бы линия из отдельных отрезков.
 * Угол — срез по «скосу» с пределом, острый излом не выстреливает иглой.
 *
 * Работает в мировых метрах (Y вверх): так же, как лежат плитки радара.
 */

const EPSILON = 1e-9;

/** Ломаная без повторяющихся подряд точек; у замкнутой — без повтора первой в конце. */
export function cleanPolyline(points, closed) {
  const out = [];
  for (let at = 0; at < points.length; at += 2) {
    const x = points[at];
    const y = points[at + 1];
    const last = out.length;
    if (last && Math.hypot(out[last - 2] - x, out[last - 1] - y) <= EPSILON) continue;
    out.push(x, y);
  }
  if (closed && out.length >= 4 && Math.hypot(out[0] - out[out.length - 2], out[1] - out[out.length - 1]) <= EPSILON)
    out.length -= 2;
  return out;
}

/** Удвоенная площадь контура со знаком (Y вверх: против часовой — положительная). */
export function signedArea2(points) {
  let sum = 0;
  for (let at = 0, back = points.length - 2; at < points.length; back = at, at += 2)
    sum += points[back] * points[at + 1] - points[at] * points[back + 1];
  return sum;
}

/**
 * Полоса вдоль ломаной.
 *
 * @param {ArrayLike<number>} input X и Y подряд
 * @param {{ closed?: boolean, width: number, align?: "center"|"inside", miterLimit?: number }} options
 *   `width` — видимая толщина; `inside` — полоса лежит внутри замкнутого
 *   контура, от самой границы
 * @returns {{ points: number[], triangles: number[] }|null} вершины парами
 *   (по две на точку ломаной) и номера вершин по три; null — линии нет
 */
export function strokePolyline(input, { closed = false, width, align = "center", miterLimit = 3 }) {
  const points = cleanPolyline(input, closed);
  const count = points.length / 2;
  if (!(width > 0) || count < (closed ? 3 : 2)) return null;
  const half = width / 2;

  /* Единичные направления и левые нормали отрезков. */
  const segments = closed ? count : count - 1;
  const nx = new Float64Array(segments);
  const ny = new Float64Array(segments);
  for (let s = 0; s < segments; s += 1) {
    const next = (s + 1) % count;
    const dx = points[next * 2] - points[s * 2];
    const dy = points[next * 2 + 1] - points[s * 2 + 1];
    const length = Math.hypot(dx, dy) || 1;
    nx[s] = -dy / length;
    ny[s] = dx / length;
  }

  /* Внутренняя сторона замкнутого контура — слева, если он идёт против часовой. */
  const inward = closed && signedArea2(points) < 0 ? -1 : 1;

  const out = [];
  for (let v = 0; v < count; v += 1) {
    const before = closed ? (v + segments - 1) % segments : v - 1;
    const after = closed ? v % segments : v;
    let mx;
    let my;
    if (before < 0 || after >= segments) {
      const only = before < 0 ? after : before;
      mx = nx[only];
      my = ny[only];
    } else {
      const bx = nx[before] + nx[after];
      const by = ny[before] + ny[after];
      const square = bx * bx + by * by;
      if (square < 1e-6) {
        /* Разворот на месте: берём нормаль следующего отрезка. */
        mx = nx[after];
        my = ny[after];
      } else {
        /* Скос: длина 1/cos(половины угла), ограниченная пределом. */
        mx = (bx * 2) / square;
        my = (by * 2) / square;
        const length = Math.hypot(mx, my);
        if (length > miterLimit) {
          mx = (mx / length) * miterLimit;
          my = (my / length) * miterLimit;
        }
      }
    }
    const x = points[v * 2];
    const y = points[v * 2 + 1];
    if (align === "inside") {
      out.push(x, y, x + mx * width * inward, y + my * width * inward);
    } else {
      out.push(x + mx * half, y + my * half, x - mx * half, y - my * half);
    }
  }

  const triangles = [];
  for (let s = 0; s < segments; s += 1) {
    const next = (s + 1) % count;
    const a = s * 2;
    const b = s * 2 + 1;
    const c = next * 2 + 1;
    const d = next * 2;
    triangles.push(a, b, c, a, c, d);
  }
  return { points: out, triangles };
}

/** Многоугольник-«точка» вокруг (x, y): круглый торец пунктира. */
export function dotPolygon(x, y, radius, steps = 8) {
  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    out.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return out;
}

/**
 * Ломаная — на отрезки по шаблону `pattern` (как `setLineDash` канвы: штрих,
 * просвет, штрих, …). Штрих короче `dotBelow` — точка: возвращается своим
 * центром, а не отрезком.
 *
 * @returns {{ pieces: number[][], dots: number[], whole: boolean }} штрихи — ломаные X, Y подряд;
 *   точки — X, Y подряд; `whole` — шаблон не годится, и ломаная осталась целой
 */
export function dashPolyline(input, closed, pattern, dotBelow = 0) {
  const points = cleanPolyline(input, closed);
  const lengths = pattern.map((value) => Math.max(0, Number(value) || 0));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (points.length < 4 || !(total > EPSILON) || lengths.length < 2) return { pieces: [points], dots: [], whole: true };
  if (lengths.length % 2) lengths.push(...lengths);
  const route = closed ? [...points, points[0], points[1]] : points;
  const pieces = [];
  const dots = [];
  let at = 0;
  let on = true;
  let remaining = lengths[0];
  let current = null;
  const finish = () => {
    if (!current) return;
    const span = Math.hypot(current[current.length - 2] - current[0], current[current.length - 1] - current[1]);
    if (current.length === 4 && span < dotBelow) dots.push((current[0] + current[2]) / 2, (current[1] + current[3]) / 2);
    else pieces.push(current);
    current = null;
  };
  const turn = (x, y) => {
    if (on) finish();
    at = (at + 1) % lengths.length;
    on = !on;
    remaining = lengths[at];
    /* Штрих нулевой длины — точка прямо здесь. */
    if (on && remaining <= EPSILON) {
      dots.push(x, y);
      at = (at + 1) % lengths.length;
      on = false;
      remaining = lengths[at];
    }
  };
  /* Точка в начале, если шаблон открывается нулевым штрихом. */
  if (remaining <= EPSILON) {
    dots.push(route[0], route[1]);
    at = 1;
    on = false;
    remaining = lengths[1];
  }
  for (let p = 0; p + 3 < route.length; p += 2) {
    const ax = route[p];
    const ay = route[p + 1];
    const bx = route[p + 2];
    const by = route[p + 3];
    const length = Math.hypot(bx - ax, by - ay);
    if (length <= EPSILON) continue;
    let walked = 0;
    let guard = 0;
    while (walked < length - EPSILON && guard < 100000) {
      guard += 1;
      const take = Math.min(remaining, length - walked);
      const t0 = walked / length;
      const t1 = (walked + take) / length;
      if (on) {
        if (!current) current = [ax + (bx - ax) * t0, ay + (by - ay) * t0];
        current.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
      }
      walked += take;
      remaining -= take;
      if (remaining <= EPSILON) turn(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    }
  }
  if (on) finish();
  return { pieces, dots, whole: false };
}
