// Пиксельная арифметика замера рамки: чистые функции над RGBA, без DOM и React.
const opaque = (px, at) => 127 < px[at + 3];
const luma = (px, at) => px[at] * 0.2126 + px[at + 1] * 0.7152 + px[at + 2] * 0.0722;
const median = (list) => list.sort((a, b) => +a - b)[list.length >> 1] ?? 0;
const offsetIn = (width) => (x, y) => 4 * (x + y * width);
// Наибольшая разница каналов пикселя o и цвета.
const diffTo = (px, o, color) =>
  color.reduce((top, v, ch) => Math.max(top, Math.abs(px[o + ch] - v)), 0);
// Медианный цвет по набору пикселей.
const tint = (px, offs) => [0, 1, 2].map((ch) => median(offs.map((o) => px[o + ch])));
const isField = (b) => b.spread <= 12 && !b.transparent && Math.max(...b.color) <= 100;

function sweep(w, h, visit) {
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) visit(x++, y);
  }
}

export function borderField(data, width, height) {
  // периметр: верх и низ для каждого столбца, затем бока средних строк
  const at = offsetIn(width);
  const ring = [];
  let i = 0;
  while (i < width) ring.push(at(i, 0), at(i++, height - 1));
  let j = 0;
  while (++j < height - 1) ring.push(at(0, j), at(width - 1, j));
  const solid = ring.filter((o) => opaque(data, o));
  if (solid.length * 2 < ring.length) return { transparent: true, color: null, spread: 0 };
  const color = tint(data, solid);
  const spread = solid.reduce((sum, o) => sum + diffTo(data, o, color), 0) / solid.length;
  return {
    color,
    spread,
    transparent: false,
  };
}

// Проверка «пиксель — чернила»; null, если рисунка нет (фото).
const inkProbe = (data, border) => {
  if (border.transparent) return (o) => opaque(data, o);
  return isField(border) ? (o) => opaque(data, o) && diffTo(data, o, border.color) > 20 : null;
};

const survey = (data, w, h) => {
  const border = borderField(data, w, h);
  return [data, w, h, border, offsetIn(w), inkProbe(data, border)];
};

// [верх, низ, лево, право] линий, где попаданий не меньше 2 % длины поперёк; null без рамки.
function inkBox(w, h, hit) {
  const [rows, cols] = [Array(h).fill(0), Array(w).fill(0)];
  sweep(w, h, (x, y) => {
    if (hit(x, y)) {
      rows[y]++;
      cols[x]++;
    }
  });
  const ends = (counts, across) => {
    const lit = (n) => !(n * 50 < across);
    return [counts.findIndex(lit), counts.findLastIndex(lit)];
  };
  const [top, bottom] = ends(rows, w);
  const [left, right] = ends(cols, h);
  return top >= 0 && left >= 0 && bottom > top && right > left ? [top, bottom, left, right] : null;
}

// Рамка мелкого рисунка расширяется тёмными чернилами: пиксели темнее среднего квадрата 7x7
// и темнее поля. Среднее — из таблицы накопленных сумм яркости.
function widen(box, [data, w, h, border, at, ink]) {
  const sums = Array.from({ length: h + 1 }, () => new Float64Array(w + 1));
  sweep(w, h, (x, y) => {
    sums[y + 1][x + 1] = luma(data, at(x, y)) + sums[y][x + 1] + sums[y + 1][x] - sums[y][x];
  });
  const reach = (p, size) => [Math.max(0, p - 3), Math.min(size, p + 4)];
  const dark = (x, y) => {
    const [x0, x1] = reach(x, w);
    const [y0, y1] = reach(y, h);
    const total = sums[y1][x1] - sums[y0][x1] - sums[y1][x0] + sums[y0][x0];
    const own = luma(data, at(x, y));
    return own < total / ((x1 - x0) * (y1 - y0)) - 5 && own < luma(border.color, 0) + 8;
  };
  const wider = inkBox(w, h, (x, y) => ink(at(x, y)) || dark(x, y));
  return wider ? box.map((v, i) => Math[i % 2 ? "max" : "min"](v, wider[i])) : box;
}

function insetOf(scan) {
  const [, w, h, border, at, ink] = scan;
  if (typeof ink !== "function") return null;
  const found = inkBox(w, h, (x, y) => ink(at(x, y)));
  if (!found) return null;
  const small = ((found[3] - found[2] + 1) * (found[1] - found[0] + 1)) / (w * h) < 0.1;
  const box = small && !border.transparent ? widen(found, scan) : found;
  const gaps = [[box[0], h], [h - 1 - box[1], h], [box[2], w], [w - 1 - box[3], w]];
  const [top, bottom, left, right] = gaps.map(([gap, side]) => Math.max(0, gap / side - 0.012));
  const room = (a, b) => 1 - a - b;
  const kept = room(left, right) * room(top, bottom);
  return kept > 0.97 || kept < 0.02 ? null : { top, bottom, left, right };
}

function brightnessOf([data, w, h, , at, ink]) {
  if (!ink) return null;
  const seen = [];
  sweep(w, h, (x, y) => {
    const o = at(x, y);
    if (ink(o)) seen.push(luma(data, o));
  });
  return seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length / 255 : null;
}

export const contentInset = (data, width, height) => insetOf(survey(data, width, height));

export const inkLuma = (data, width, height) => brightnessOf(survey(data, width, height));

// Девять отрезков вдоль каждого края; цвет отрезка — медиана двух рядов пикселей у края.
export function edgeColors(data, width, height) {
  const at = offsetIn(width);
  const segment = (k, length) => {
    const from = Math.floor((k * length) / 9);
    const count = Math.max(from + 1, Math.floor(((k + 1) * length) / 9)) - from;
    return Array.from({ length: count }, (_, n) => from + n);
  };
  return Object.fromEntries(
    ["top", "bottom", "left", "right"].map((name, j) => {
      const vertical = j > 1;
      // глубина d от края: у верха и левого — от нуля, у низа и правого — с конца
      const depthAt = (size, d) =>
        j % 2 === 0 ? Math.min(size - 1, d) : Math.max(0, size - 1 - d);
      const spot = (i, d) => (vertical ? at(depthAt(width, d), i) : at(i, depthAt(height, d)));
      return [
        name,
        Array.from({ length: 9 }, (_, k) =>
          tint(
            data,
            segment(k, vertical ? height : width).flatMap((i) => [spot(i, 0), spot(i, 1)]),
          ),
        ),
      ];
    }),
  );
}

export const SAMPLE = 96;

export const sampleSize = (naturalWidth, naturalHeight) => {
  const aspect = naturalWidth / naturalHeight;
  const atLeastEight = (side) => Math.max(8, Math.round(side));
  if (aspect >= 1) return { aspect, height: atLeastEight(SAMPLE / aspect), width: SAMPLE };
  return { aspect, height: SAMPLE, width: atLeastEight(SAMPLE * aspect) };
};

export function measurePixels(data, width, height, aspect) {
  const scan = survey(data, width, height);
  const border = scan[3];
  const inset = insetOf(scan);
  let bright = false;
  if (inset !== null) bright = (brightnessOf(scan) ?? 0) > 0.4;
  return {
    aspect,
    transparent: border.transparent,
    field: isField(border) ? border.color : null,
    inset,
    bright,
    edges: edgeColors(data, width, height),
  };
}
