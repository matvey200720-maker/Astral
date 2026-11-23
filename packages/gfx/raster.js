// Растеризация без canvas: доли покрытия пикселей для заливки (чёт-нечет, как в Scaleform)
// и обводки, наложение краски на поверхность с умноженной альфой, перевод в байты RGBA.

const SUBROWS = 4;
const SUBROW_WEIGHT = 1 / SUBROWS;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createSurface(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) };
}

// Габарит точек; Math.min/Math.max пропускают NaN (недостающая координата) дальше.
class Extent {
  constructor() {
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
  }

  add(x, y) {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }

  // Прямоугольник покрытия: габарит, раздвинутый на `margin`, в целых пикселях поверхности.
  coverage(margin, surfaceWidth, surfaceHeight) {
    const left = Math.max(0, Math.floor(this.minX - margin));
    const top = Math.max(0, Math.floor(this.minY - margin));
    const right = Math.min(surfaceWidth, Math.ceil(this.maxX + margin));
    const bottom = Math.min(surfaceHeight, Math.ceil(this.maxY + margin));
    if (!(bottom > top && right > left)) return null;
    const width = right - left;
    const height = bottom - top;
    return { x: left, y: top, width, height, cover: new Float32Array(width * height) };
  }
}

// ---------- заливка: чёт-нечет по подстрокам ----------

class EvenOddScan {
  constructor(segments) {
    // Наклонные рёбра подряд по шесть чисел: yLo, yHi, x0, y0, x1, y1. Горизонтальные
    // ни одну подстроку не пересекают — их нет.
    this.edges = [];
    for (let i = 0; i < segments.length; i += 4) {
      const y0 = segments[i + 1];
      const y1 = segments[i + 3];
      if (y0 !== y1) this.edges.push(Math.min(y0, y1), Math.max(y0, y1), segments[i], y0, segments[i + 2], y1);
    }
    this.hits = new Float64Array(16);
    this.span = { from: 0, to: 0 };
  }

  // Пересечения подстроки на высоте `sy`: высота в [yLo, yHi), x — по прямой ребра.
  crossings(sy) {
    const { edges } = this;
    let count = 0;
    for (let e = 0; e < edges.length; e += 6) {
      if (sy < edges[e] || sy >= edges[e + 1]) continue;
      if (count === this.hits.length) {
        const wider = new Float64Array(count * 2);
        wider.set(this.hits);
        this.hits = wider;
      }
      const x0 = edges[e + 2];
      const y0 = edges[e + 3];
      this.hits[count++] = x0 + ((sy - y0) * (edges[e + 4] - x0)) / (edges[e + 5] - y0);
    }
    return count;
  }

  // Закрашенные отрезки подстроки — пары пересечений по возрастанию x, обрезанные краями.
  *spans(sy, left, right) {
    const count = this.crossings(sy);
    if (count < 2) return;
    const xs = this.hits.subarray(0, count).sort();
    const { span } = this;
    for (let p = 1; p < count; p += 2) {
      span.from = Math.max(xs[p - 1], left);
      span.to = Math.min(xs[p], right);
      if (span.to > span.from) yield span;
    }
  }
}

// Отрезок подстроки [from, to) раскладывается по пикселям строки с весом подстроки.
function addSpan(cover, rowStart, left, from, to) {
  const firstPx = Math.floor(from);
  const lastPx = Math.ceil(to) - 1;
  if (firstPx === lastPx) {
    cover[rowStart + firstPx - left] += (to - from) * SUBROW_WEIGHT;
    return;
  }
  cover[rowStart + firstPx - left] += (firstPx + 1 - from) * SUBROW_WEIGHT;
  for (let px = firstPx + 1; px < lastPx; px++) cover[rowStart + px - left] += SUBROW_WEIGHT;
  cover[rowStart + lastPx - left] += (to - lastPx) * SUBROW_WEIGHT;
}

export function fillCoverage(segments, surfaceWidth, surfaceHeight) {
  const extent = new Extent();
  for (let i = 0; i < segments.length; i += 4) {
    extent.add(segments[i], segments[i + 1]);
    extent.add(segments[i + 2], segments[i + 3]);
  }
  const box = extent.coverage(0, surfaceWidth, surfaceHeight);
  if (!box) return null;

  const scan = new EvenOddScan(segments);
  const right = box.x + box.width;
  for (let row = 0; row < box.height; row++) {
    for (let k = 0; k < SUBROWS; k++) {
      const sy = box.y + row + (k + 0.5) / SUBROWS;
      for (const { from, to } of scan.spans(sy, box.x, right)) addSpan(box.cover, row * box.width, box.x, from, to);
    }
  }
  return box;
}

// ---------- обводка ----------

// Отрезок ломаной толщиной 2·half: доля пикселя по центру (cx, cy). Концы: скруглённый или плоский.
class StrokeSegment {
  constructor(ax, ay, bx, by, half, roundStart, roundEnd) {
    this.ax = ax;
    this.ay = ay;
    this.bx = bx;
    this.by = by;
    this.length = Math.hypot(bx - ax, by - ay);
    // Нулевая длина — направление вдоль x.
    this.ux = this.length > 0 ? (bx - ax) / this.length : 1;
    this.uy = this.length > 0 ? (by - ay) / this.length : 0;
    this.edge = half + 0.5;
    this.roundStart = roundStart;
    this.roundEnd = roundEnd;
    this.reach = half + 1;
  }

  share(cx, cy) {
    const rx = cx - this.ax;
    const ry = cy - this.ay;
    const along = rx * this.ux + ry * this.uy;
    const across = Math.abs(rx * this.uy - ry * this.ux);
    if (along < 0) return this.beyondEnd(this.roundStart, rx, ry, across, -along);
    if (along > this.length) return this.beyondEnd(this.roundEnd, cx - this.bx, cy - this.by, across, along - this.length);
    return clamp01(this.edge - across);
  }

  // За концом: скруглённый — расстояние до конца (dx, dy); плоский — поперёк × (0.5 − выход за конец).
  beyondEnd(round, dx, dy, across, overshoot) {
    if (round) return clamp01(this.edge - Math.hypot(dx, dy));
    return clamp01(this.edge - across) * clamp01(0.5 - overshoot);
  }

  // Наибольшая доля в каждом пикселе рядом с отрезком (габарит концов ± (half + 1)).
  maxInto(box) {
    const { x: left, y: top, width, height, cover } = box;
    const fromX = Math.max(left, Math.floor(Math.min(this.ax, this.bx) - this.reach));
    const toX = Math.min(left + width, Math.ceil(Math.max(this.ax, this.bx) + this.reach));
    const fromY = Math.max(top, Math.floor(Math.min(this.ay, this.by) - this.reach));
    const toY = Math.min(top + height, Math.ceil(Math.max(this.ay, this.by) + this.reach));
    for (let py = fromY; py < toY; py++) {
      let cell = (py - top) * width + (fromX - left);
      for (let px = fromX; px < toX; px++, cell++) {
        const value = this.share(px + 0.5, py + 0.5);
        if (value > cover[cell]) cover[cell] = value;
      }
    }
  }
}

// Отрезки одной ломаной: стыки внутри всегда скруглены; концы ломаной — по `startCap`/`endCap`,
// квадратный конец сначала продлевает отрезок на полутолщину и дальше плоский.
function* polylineSegments(run, half, startCap, endCap) {
  const last = run.length / 2 - 2;
  for (let s = 0; s <= last; s++) {
    let ax = run[2 * s];
    let ay = run[2 * s + 1];
    let bx = run[2 * s + 2];
    let by = run[2 * s + 3];
    const opens = s === 0;
    const closes = s === last;
    const squareStart = opens && startCap === "square";
    const squareEnd = closes && endCap === "square";
    if (squareStart || squareEnd) {
      const length = Math.hypot(bx - ax, by - ay);
      const ux = length > 0 ? (bx - ax) / length : 1;
      const uy = length > 0 ? (by - ay) / length : 0;
      if (squareStart) {
        ax -= ux * half;
        ay -= uy * half;
      }
      if (squareEnd) {
        bx += ux * half;
        by += uy * half;
      }
    }
    yield new StrokeSegment(ax, ay, bx, by, half, !opens || startCap === "round", !closes || endCap === "round");
  }
}

export function strokeCoverage(runs, half, { startCap = "round", endCap = "round" }, surfaceWidth, surfaceHeight) {
  const extent = new Extent();
  for (const run of runs) {
    for (let i = 0; i < run.length; i += 2) extent.add(run[i], run[i + 1]);
  }
  const box = extent.coverage(half + 1, surfaceWidth, surfaceHeight);
  if (!box) return null;
  for (const run of runs) {
    for (const segment of polylineSegments(run, half, startCap, endCap)) segment.maxInto(box);
  }
  return box;
}

// ---------- наложение ----------

// Режимы BlendMode Flash по каналам: b — фон, s — краска, оба прямые 0…1.
const BLENDS = new Map([
  [3, (b, s) => b * s],
  [4, (b, s) => b + s - b * s],
  [5, (b, s) => Math.max(b, s)],
  [6, (b, s) => Math.min(b, s)],
  [7, (b, s) => Math.abs(b - s)],
  [8, (b, s) => Math.min(1, b + s)],
  [9, (b, s) => Math.max(0, b - s)],
  [13, (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s))],
  [14, (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s))],
]);

// Обычное наложение — ложное значение или всё, что при сравнении с 2 не больше его
// (строки "0"…"2", true, [1] — тоже); иначе режим из таблицы.
export function blendSupported(mode) {
  return !mode || mode <= 2 || BLENDS.has(mode);
}

// Смесь пикселя: цвет краски `color` (прямой) с непрозрачностью `opacity` поверх данных с `at`.
// Режим действует, только если под краской что-то есть (W3C: Cs' = (1 − αb)·Cs + αb·B(Cb, Cs)).
function mixPixel(data, at, color, opacity, mix) {
  const under = data[at + 3];
  const keep = 1 - opacity;
  const blended = mix !== undefined && under > 0;
  for (let ch = 0; ch < 3; ch++) {
    const source = blended ? color[ch] * (1 - under) + under * mix(data[at + ch] / under, color[ch]) : color[ch];
    data[at + ch] = source * opacity + data[at + ch] * keep;
  }
  data[at + 3] = opacity + under * keep;
}

export function composite(surface, coverage, paint, mask = null, blend = 0) {
  if (!coverage) return;
  const mix = BLENDS.get(blend);
  const { data, width: stride } = surface;
  const { cover, width, height } = coverage;
  // Один массив цвета на весь вызов: что краска не записала, остаётся от прошлого пикселя.
  const color = [0, 0, 0, 0];

  let cell = 0;
  for (let row = 0; row < height; row++) {
    const y = coverage.y + row;
    for (let col = 0; col < width; col++, cell++) {
      let share = cover[cell];
      if (share <= 0) continue;
      share = Math.min(share, 1);
      const x = coverage.x + col;
      // Место без проверки границ: правее края — следующая строка, за концом — запись теряется.
      const pixel = y * stride + x;
      if (mask) {
        share *= mask[pixel];
        if (share <= 0) continue;
      }
      paint(x + 0.5, y + 0.5, color);
      const opacity = color[3] * share;
      if (opacity <= 0) continue;
      mixPixel(data, pixel * 4, color, opacity, mix);
    }
  }
}

// ---------- байты ----------
// Выход — Uint8Array, а не «зажатый»: значения вне 0…255 ложатся по модулю 256, NaN — 0.

function overBackground(data, rgba, size, background) {
  const under = [background[0] / 255, background[1] / 255, background[2] / 255];
  const [r, g, b] = under;
  for (let at = 0; at < size; at += 4) {
    const rest = 1 - data[at + 3];
    rgba[at] = Math.round((data[at] + r * rest) * 255);
    rgba[at + 1] = Math.round((data[at + 1] + g * rest) * 255);
    rgba[at + 2] = Math.round((data[at + 2] + b * rest) * 255);
    rgba[at + 3] = 255;
  }
}

function straightAlpha(data, rgba, size) {
  for (let at = 0; at < size; at += 4) {
    const alpha = data[at + 3];
    if (!(alpha > 0)) continue;
    rgba[at] = Math.round((data[at] / alpha) * 255);
    rgba[at + 1] = Math.round((data[at + 1] / alpha) * 255);
    rgba[at + 2] = Math.round((data[at + 2] / alpha) * 255);
    rgba[at + 3] = Math.round(alpha * 255);
  }
}

export function surfaceToRgba(surface, background = null) {
  const size = surface.width * surface.height * 4;
  const rgba = new Uint8Array(size);
  if (background) overBackground(surface.data, rgba, size, background);
  else straightAlpha(surface.data, rgba, size);
  return rgba;
}
