// Кривые Безье для мазков кисти: подгонка кривых к следу руки, разложение в ломаную, SVG-путь.
// Порядок действий над числами выбран так, чтобы результат совпадал бит в бит.
// Внутри точки и векторы — пары [x, y]; наружу выходят объекты { x, y }.

const TUNE = Object.freeze({
  cornerAngle: Math.PI / 3,
  sharpness: 0.7,
  cornerReach: 5,
  tangentReach: 3,
  turnLimit: 0.3,
  gapShare: 0.25,
  minTolerance: 0.001,
  retries: 16,
  retryFactor: 1.5,
  attempts: 5,
  chords: 64,
});

// ---- пары чисел -------------------------------------------------------------

function axes(fn) {
  return [fn(0), fn(1)];
}

function sub(a, b) {
  return axes((k) => a[k] - b[k]);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function norm(v) {
  return Math.hypot(...v);
}

function neg(v) {
  return axes((k) => -v[k]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Точка плюс вектор, умноженный на число (покомпонентно).
function along(p, v, s) {
  return axes((k) => p[k] + v[k] * s);
}

function between(a, b, share) {
  return axes((k) => a[k] + (b[k] - a[k]) * share);
}

function unit(v) {
  const length = norm(v);
  return length > 1e-9 ? axes((k) => v[k] / length) : null;
}

function tenth(value) {
  return Math.round(value * 10) / 10;
}

function toRounded([x, y]) {
  return { x: tenth(x), y: tenth(y) };
}

function range(from, count) {
  return Array.from({ length: count }, (_, n) => from + n);
}

// Сумма слагаемых слева направо, без начального нуля.
function addUp(terms) {
  return terms.reduce((sum, term) => sum + term);
}

function blend(vectors, weights) {
  return axes((k) => addUp(weights.map((w, n) => w * vectors[n][k])));
}

// ---- кубическая кривая по четырём точкам q ------------------------------------

function weightsAt(t) {
  const m = 1 - t;
  return [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t];
}

function bezierAt(q, t) {
  return blend(q, weightsAt(t));
}

function bezierVelocity(q, t) {
  const m = 1 - t;
  const legs = [sub(q[1], q[0]), sub(q[2], q[1]), sub(q[3], q[2])];
  return blend(legs, [3 * m * m, 6 * m * t, 3 * t * t]);
}

function bezierAcceleration(q, t) {
  const m = 1 - t;
  const bends = [
    axes((k) => q[2][k] - 2 * q[1][k] + q[0][k]),
    axes((k) => q[3][k] - 2 * q[2][k] + q[1][k]),
  ];
  return blend(bends, [6 * m, 6 * t]);
}

// Определитель 3 x 3 разложением по первой строке.
const MINOR_COLUMNS = [
  [1, 2],
  [0, 2],
  [0, 1],
];

function det3([a, b, c]) {
  const [m0, m1, m2] = MINOR_COLUMNS.map(([p, q]) => b[p] * c[q] - b[q] * c[p]);
  return a[0] * m0 - a[1] * m1 + a[2] * m2;
}

// Степени 1, s, s*s, (s*s)*s, ...: каждая из предыдущей умножением.
function powersOf(s, count) {
  const row = [1];
  while (row.length < count) row.push(row[row.length - 1] * s);
  return row;
}

export function isCurvePoints(points) {
  return Array.isArray(points) && points.length % 3 === 1 && points.length > 3;
}

// ---- очистка следа ---------------------------------------------------------------

// Конечные точки не ближе зазора друг к другу; конец следа сохраняется.
function cleanTrace(points, gap) {
  const good = [...(points || [])].flatMap((raw) => {
    const xy = ["x", "y"].map((key) => Number(raw?.[key]));
    return xy.every(Number.isFinite) ? [xy] : [];
  });
  const farEnough = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= gap;
  const kept = [];
  good.forEach((pt) => {
    if (kept.length === 0 || farEnough(kept.at(-1), pt)) kept.push(pt);
  });
  const tail = good.at(-1);
  const prev = kept.at(-1);
  if (tail === undefined || prev === tail) return kept;
  if (kept.length > 1 && !farEnough(prev, tail)) return [...kept.slice(0, -1), tail];
  const samePlace = tail[0] === prev[0] && tail[1] === prev[1];
  return samePlace ? kept : [...kept, tail];
}

// Расширяющиеся охваты: удвоение до предела включительно.
function reachesUpTo(start, limit) {
  const reaches = [start];
  while (reaches.at(-1) < limit) reaches.push(Math.min(reaches.at(-1) * 2, limit));
  return reaches;
}

// Допуски повторов: накопленное умножение на 1.5.
function tolerances(first) {
  const steps = [first];
  while (steps.length <= TUNE.retries) steps.push(steps.at(-1) * TUNE.retryFactor);
  return steps;
}

// ---- подгонка к очищенному следу pts ------------------------------------------------

// Возвращает проход подгонки: допуск h -> { points, curve }.
function buildFitter(pts) {
  const last = pts.length - 1;
  let run = 0;
  const dist = pts.map((p, n) => (n === 0 ? 0 : (run += norm(sub(p, pts[n - 1])))));

  // Точка на расстоянии d вдоль следа от точки i в сторону side (+1 вперёд, -1 назад).
  function pointAlong(i, d, side) {
    const target = dist[i] + side * d;
    const reached = side > 0 ? (b) => dist[b] >= target : (b) => dist[b] <= target;
    const starts = range(0, side > 0 ? last - i : i).map((n) => i + side * n);
    const a = starts.find((from) => reached(from + side));
    if (a === undefined) return pts[side > 0 ? last : 0];
    const span = dist[a + side] - dist[a];
    return between(pts[a], pts[a + side], span === 0 ? 0 : (target - dist[a]) / span);
  }

  function turnAt(i, reach) {
    const before = unit(sub(pts[i], pointAlong(i, reach, -1)));
    const after = unit(sub(pointAlong(i, reach, 1), pts[i]));
    return before && after ? Math.acos(clamp(dot(before, after), -1, 1)) : 0;
  }

  // Номера узлов: начало, острые изломы (по одному на кластер), конец.
  function cornersOf(reach) {
    const sharp = range(1, Math.max(0, last - 1)).flatMap((i) => {
      const edgeGap = Math.min(dist[i], dist[last] - dist[i]);
      if (edgeGap < reach / 2) return [];
      const turn = turnAt(i, reach);
      if (turn < TUNE.cornerAngle || turnAt(i, reach / 3) < turn * TUNE.sharpness) return [];
      return [{ i, turn }];
    });
    const clusters = [];
    for (const cand of sharp) {
      const open = clusters.at(-1);
      if (open && reach >= dist[cand.i] - dist[open.last]) {
        open.last = cand.i;
        if (cand.turn > open.turn) Object.assign(open, { best: cand.i, turn: cand.turn });
      } else {
        clusters.push({ last: cand.i, best: cand.i, turn: cand.turn });
      }
    }
    return [0, ...clusters.map((c) => c.best), last];
  }

  // Индексы точек от i в сторону side, пока они в пределах охвата и куска.
  function withinReach(i, reach, side, bound) {
    const room = side > 0 ? bound - i : i - bound;
    const candidates = range(1, Math.max(0, room)).map((n) => i + side * n);
    const stop = candidates.findIndex((k) => !(Math.abs(dist[k] - dist[i]) <= reach));
    return stop === -1 ? candidates : candidates.slice(0, stop);
  }

  // Парабола по точкам вокруг i в пределах куска и охвата reach.
  function parabolaAt(i, piece, reach) {
    const behind = withinReach(i, reach, -1, piece.lo).reverse();
    const picked = [...behind, i, ...withinReach(i, reach, 1, piece.hi)];
    if (picked.length < 3) return null;

    const samples = picked.map((k) => {
      const s = (dist[k] - dist[i]) / reach;
      return { s, rel: sub(pts[k], pts[i]), pow: powersOf(s, 5) };
    });
    const sums = range(0, 5).map((j) => samples.reduce((acc, smp) => acc + smp.pow[j], 0));
    const moments = range(0, 3).map((j) =>
      axes((k) => samples.reduce((acc, smp) => acc + smp.rel[k] * smp.pow[j], 0)),
    );
    const hankel = range(0, 3).map((r) => range(0, 3).map((c) => sums[r + c]));
    const det = det3(hankel);
    const singular = Math.abs(det) < 1e-9;
    if (singular) return null;

    // Правило Крамера: столбец col матрицы заменяется правой частью.
    function solve(rhs) {
      return range(0, 3).map((col) => {
        const swapped = hankel.map((row, r) => row.with(col, rhs[r]));
        return det3(swapped) / det;
      });
    }
    const coefs = axes((k) => solve(moments.map((m) => m[k])));
    const [a, b, c] = range(0, 3).map((n) => axes((k) => coefs[k][n]));

    const direction = unit(b);
    if (!direction) return null;
    const bend = Math.abs(cross(b, c));
    const turn = ((2 * bend) / norm(b) ** 3) * reach;
    const misses = samples.map(({ s, rel }) => norm(axes((k) => a[k] + b[k] * s + c[k] * s * s - rel[k])));
    return { direction, residual: Math.max(0, ...misses), turn };
  }

  // Единичная касательная в точке i куска.
  function tangentAt(i, piece, h) {
    const limit = Math.max(...[dist[i] - dist[piece.lo], dist[piece.hi] - dist[i]]);
    const poor = (fit) => !fit || fit.residual > h / 2 || fit.turn > TUNE.turnLimit;
    let best = null;
    for (const reach of reachesUpTo(Math.min(h * TUNE.tangentReach, limit), limit)) {
      const fit = parabolaAt(i, piece, reach);
      if (best !== null && poor(fit)) break;
      best = fit;
    }
    if (best === null) return unit(sub(pts[Math.min(i + 1, piece.hi)], pts[Math.max(i - 1, piece.lo)])) || [1, 0];
    return best.direction;
  }

  // Параметры точек куска на кривой: доля пройденной длины.
  function paramsFor({ lo, hi }) {
    const total = dist[hi] - dist[lo];
    return range(0, hi - lo + 1).map((n) => (total === 0 ? n / (hi - lo) : (dist[lo + n] - dist[lo]) / total));
  }

  // Кубическая кривая по наименьшим квадратам с касательными на концах куска.
  function leastSquares({ lo, hi, startTan, endTan }, params) {
    const [p0, p3] = [pts[lo], pts[hi]];
    const rows = params.map((t, n) => {
      const [b0, b1, b2, b3] = weightsAt(t);
      return {
        a1: axes((k) => startTan[k] * b1),
        a2: axes((k) => endTan[k] * b2),
        rest: axes((k) => pts[lo + n][k] - p0[k] * (b0 + b1) - p3[k] * (b2 + b3)),
      };
    });
    const total = (term) => rows.reduce((acc, row) => acc + term(row), 0);
    const c00 = total(({ a1 }) => dot(a1, a1));
    const c01 = total(({ a1, a2 }) => dot(a1, a2));
    const c11 = total(({ a2 }) => dot(a2, a2));
    const x0 = total(({ a1, rest }) => dot(a1, rest));
    const x1 = total(({ a2, rest }) => dot(a2, rest));

    const chord = norm(sub(p3, p0));
    const det = c00 * c11 - c01 * c01;
    const sum = c00 + c01;
    const shared = !(Math.abs(sum) > 1e-12) ? 0 : x0 / sum;
    let alphas =
      Math.abs(det) > 1e-12 ? [(x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det] : [shared, shared];
    const line = sub(p3, p0);
    const tooShort = alphas[0] < 1e-6 * chord || alphas[1] < 1e-6 * chord;
    const overshoot =
      !tooShort && alphas[0] * dot(startTan, line) - alphas[1] * dot(endTan, line) > chord * chord;
    if (tooShort || overshoot) alphas = [chord / 3, chord / 3];
    return [p0, along(p0, startTan, alphas[0]), along(p3, endTan, alphas[1]), p3];
  }

  // Точка куска (кроме крайних) с наибольшим квадратом отхода от кривой; при равенстве — последняя.
  function worstOf({ lo, hi }, curve, params) {
    const start = { index: lo + ((hi - lo) >> 1), error: 0 };
    return range(lo + 1, Math.max(0, hi - lo - 1)).reduce((worst, k) => {
      const gap = sub(bezierAt(curve, params[k - lo]), pts[k]);
      const error = gap[0] ** 2 + gap[1] ** 2;
      return error >= worst.error ? { index: k, error } : worst;
    }, start);
  }

  // Новый параметр точки target на кривой (метод Ньютона); без шага, если наклон мал.
  function newtonStep(curve, t, target) {
    const gap = sub(bezierAt(curve, t), target);
    const velocity = bezierVelocity(curve, t);
    const slope = dot(velocity, velocity) + dot(gap, bezierAcceleration(curve, t));
    return Math.abs(slope) > 1e-12 ? t - dot(gap, velocity) / slope : t;
  }

  // Шаг Ньютона для параметров (на месте); ложь, если их порядок нарушился.
  function refine({ lo }, curve, params) {
    params.forEach((t, n) => {
      params[n] = newtonStep(curve, t, pts[lo + n]);
    });
    return !params.some((t, n) => n > 0 && t <= params[n - 1]);
  }

  // Первая внутренняя точка не левее середины длины куска (иначе предпоследняя).
  function middleIndex({ lo, hi }) {
    const middle = (dist[hi] + dist[lo]) / 2;
    return range(lo + 1, Math.max(0, hi - lo - 2)).find((k) => !(dist[k] < middle)) ?? hi - 1;
  }

  // Кривые для куска: по две управляющие точки и конец каждой.
  function fitPiece(piece, h) {
    const { lo, hi, startTan, endTan } = piece;
    if (hi === lo + 1) {
      const third = norm(sub(pts[hi], pts[lo])) / 3;
      return [along(pts[lo], startTan, third), along(pts[hi], endTan, third), pts[hi]];
    }
    const budget = h * h;
    const params = paramsFor(piece);
    const length = dist[hi] - dist[lo];
    // Попытки с уточнением параметров: либо кривая в допуске, либо номер точки деления (-1 — середина).
    const attempt = (n, ceiling) => {
      const curve = leastSquares(piece, params);
      const worst = worstOf(piece, curve, params);
      if (worst.error < budget) return { curve };
      const share = (dist[worst.index] - dist[lo]) / length;
      const nearEnd = n === 0 && (share < 0.2 || share > 0.8);
      const split = worst.error >= ceiling && nearEnd ? -1 : worst.index;
      const stuck = worst.error >= ceiling || n + 1 === TUNE.attempts || !refine(piece, curve, params);
      return stuck ? { split } : attempt(n + 1, worst.error);
    };
    const outcome = attempt(0, budget * 16);
    if (outcome.curve) return outcome.curve.slice(1);
    const cut = outcome.split < 0 ? middleIndex(piece) : outcome.split;
    const center = tangentAt(cut, piece, h);
    const left = fitPiece({ lo, hi: cut, startTan, endTan: neg(center) }, h);
    const right = fitPiece({ lo: cut, hi, startTan: center, endTan }, h);
    return left.concat(right);
  }

  // Все ли кривые уложились в допуск h вокруг своей хорды.
  function allStraight(nodes, h) {
    const curves = range(0, (nodes.length - 1) / 3).map((g) => nodes.slice(3 * g, 3 * g + 4));
    return curves.every(([start, c1, c2, end]) => {
      const length = norm(sub(end, start));
      const chord = sub(end, start);
      return [c1, c2].every((handle) => {
        const offset = sub(handle, start);
        if (!length) return norm(offset) <= h;
        const t = dot(offset, chord) / (length * length);
        return t >= 0 && t <= 1 && Math.abs(cross(offset, chord)) / length <= h;
      });
    });
  }

  return function pass(h) {
    const knots = cornersOf(h * TUNE.cornerReach);
    const body = knots.slice(1).flatMap((hi, n) => {
      const span = { lo: knots[n], hi };
      const startTan = tangentAt(span.lo, span, h);
      const endTan = neg(tangentAt(hi, span, h));
      return fitPiece({ ...span, startTan, endTan }, h);
    });
    const nodes = [pts[0], ...body];
    const straight = allStraight(nodes, h);
    const shown = nodes.filter((_, k) => !straight || k % 3 === 0);
    return { points: shown.map(toRounded), curve: !straight };
  };
}

function plainResult(pts) {
  return { points: pts.map(toRounded), curve: false };
}

// Не больше maxPoints точек: у кривой остаётся 3n + 1 (но не меньше одной), у ломаной — срез.
function capPoints({ points, curve }, maxPoints) {
  if (!(points.length > maxPoints)) return { points, curve };
  const trimmed = curve ? (maxPoints - 1) % 3 : 0;
  return { points: points.slice(0, maxPoints - trimmed), curve };
}

export function fitStrokeCurve(points, options = {}) {
  const { tolerance = 1, maxPoints = Infinity } = options;
  const requested = Number(tolerance) || 0;
  const first = Math.max(TUNE.minTolerance, requested);
  const cleaned = cleanTrace(points, first * TUNE.gapShare);
  if (cleaned.length < 3) return plainResult(cleaned);

  const pass = buildFitter(cleaned);
  let result;
  for (const h of tolerances(first)) {
    result = pass(h);
    if (!(result.points.length > maxPoints)) break;
  }
  return capPoints(result, maxPoints);
}

// Хорды одной кривой: число хорд растёт с изгибом, не больше 64.
function flattenGroup(flatness) {
  return (q) => {
    const bend = norm(
      axes((k) => Math.max(Math.abs(q[0][k] - 2 * q[1][k] + q[2][k]), Math.abs(q[1][k] - 2 * q[2][k] + q[3][k]))),
    );
    const steps = [Math.sqrt, Math.ceil, (v) => Math.min(TUNE.chords, v), (v) => Math.max(1, v)];
    const count = steps.reduce((v, step) => step(v), (0.75 * bend) / flatness);
    return range(1, count).map((k) => {
      const [x, y] = bezierAt(q, k / count);
      return { x, y };
    });
  };
}

export function flattenCurve(points, flatness = 1) {
  if (isCurvePoints(points)) {
    const nodes = points.map((p) => [p.x, p.y]);
    const curves = range(0, (nodes.length - 1) / 3).map((g) => nodes.slice(3 * g, 3 * g + 4));
    return [points[0], ...curves.flatMap(flattenGroup(flatness))];
  }
  return points || [];
}

const flatLines = new WeakMap();

export function strokeLine(stroke) {
  const points = stroke?.points || [];
  const curved = Boolean(stroke?.curve) && isCurvePoints(points);
  if (!curved) return points;
  const cached = flatLines.get(points);
  if (cached !== undefined) return cached;
  const flat = flattenCurve(points, 1);
  flatLines.set(points, flat);
  return flat;
}

export function curvePath(points) {
  if (!points || !points.length) return "";
  const text = (p) => `${p.x} ${p.y}`;
  const curves = range(0, Math.floor((points.length - 1) / 3)).map((g) => range(1 + 3 * g, 3).map((n) => points[n]));
  return `M${text(points[0])}${curves.map((trio) => `C${trio.map(text).join(" ")}`).join("")}`;
}
