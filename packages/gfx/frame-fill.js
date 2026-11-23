/*
 * Как окно увеличит кадр обложки на странице мода (13.11.2026, владелец: «миникарта и большая карта … фоточки чуть-чуть обрезал … зоны … показываются не полностью»).
 *
 * Страница мода не показывает картинку как есть: она ищет в ней «рамку рисунка» и увеличивает кадр до неё (`apps/web/src/components/ui/frame-crop.js`: `fitInset`,
 * `renderFillStyle`; замер на копии 96 px — `frame-crop-pixels.js`). Рисунок для неё — точки, что отличаются от поля (медианный цвет периметра) больше чем на 20; рамка — строки
 * и столбцы, где таких точек не меньше 2 % длины. У тёмных обложек (карта автора ~20, тело панели мини-карты ~33 на поле 15) тёмное чернилами не считается, и окно подгоняет кадр
 * под яркие подписи, отрезая остальное. Окно уже у игроков и в этом листе не правится, поэтому печь сама меряет обложку так же, как окно, и не принимает кадр, который оно обрежет.
 *
 * Здесь — та же арифметика без DOM и React: `measureCrop` (то же, что `measurePixels` окна, без полос краёв), `windowCuts` (то же, что считает `fitInset`: сколько кадра отрежет окно показа
 * на сцене с пропорцией `ratio`) и `contentBox` (границы настоящего содержимого с низким порогом). Совпадение с кодом окна держит тест (`tests/cover-frame-fill.test.js`): правка окна
 * без правки здесь его уронит.
 */

const opaque = (px, at) => 127 < px[at + 3];
const luma = (px, at) =>
  px[at] * 0.2126 + px[at + 1] * 0.7152 + px[at + 2] * 0.0722;
const median = (list) => list.sort((a, b) => +a - b)[list.length >> 1] ?? 0;
const offsetIn = (width) => (x, y) => 4 * (x + y * width);
const diffTo = (px, o, color) =>
  color.reduce((top, v, ch) => Math.max(top, Math.abs(px[o + ch] - v)), 0);
const tint = (px, offs) =>
  [0, 1, 2].map((ch) => median(offs.map((o) => px[o + ch])));
const isField = (b) =>
  b.spread <= 12 && !b.transparent && Math.max(...b.color) <= 100;

/** Порог «чернил» окна: отличие от поля по каналу. */
export const INK_DELTA = 20;
/** Сторона копии, по которой окно меряет кадр. */
export const SAMPLE = 96;

function sweep(w, h, visit) {
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) visit(x++, y);
  }
}

/** Поле кадра: медианный цвет периметра и разброс (как `borderField` окна). */
export function borderField(data, width, height) {
  const at = offsetIn(width);
  const ring = [];
  let i = 0;
  while (i < width) ring.push(at(i, 0), at(i++, height - 1));
  let j = 0;
  while (++j < height - 1) ring.push(at(0, j), at(width - 1, j));
  const solid = ring.filter((o) => opaque(data, o));
  if (solid.length * 2 < ring.length)
    return { transparent: true, color: null, spread: 0 };
  const color = tint(data, solid);
  const spread =
    solid.reduce((sum, o) => sum + diffTo(data, o, color), 0) / solid.length;
  return { color, spread, transparent: false };
}

const inkProbe = (data, border, delta) => {
  if (border.transparent) return (o) => opaque(data, o);
  return isField(border)
    ? (o) => opaque(data, o) && diffTo(data, o, border.color) > delta
    : null;
};

// [верх, низ, лево, право] линий, где попаданий не меньше 2 % длины поперёк; null без рамки.
function inkBox(w, h, hit, share = 50) {
  const [rows, cols] = [Array(h).fill(0), Array(w).fill(0)];
  sweep(w, h, (x, y) => {
    if (hit(x, y)) {
      rows[y]++;
      cols[x]++;
    }
  });
  const ends = (counts, across) => {
    const lit = (n) => !(n * share < across);
    return [counts.findIndex(lit), counts.findLastIndex(lit)];
  };
  const [top, bottom] = ends(rows, w);
  const [left, right] = ends(cols, h);
  return top >= 0 && left >= 0 && bottom > top && right > left
    ? [top, bottom, left, right]
    : null;
}

// Рамка мелкого рисунка расширяется тёмными чернилами (как `widen` окна).
function widen(box, data, w, h, border, at, ink) {
  const sums = Array.from({ length: h + 1 }, () => new Float64Array(w + 1));
  sweep(w, h, (x, y) => {
    sums[y + 1][x + 1] =
      luma(data, at(x, y)) + sums[y][x + 1] + sums[y + 1][x] - sums[y][x];
  });
  const reach = (p, size) => [Math.max(0, p - 3), Math.min(size, p + 4)];
  const dark = (x, y) => {
    const [x0, x1] = reach(x, w);
    const [y0, y1] = reach(y, h);
    const total = sums[y1][x1] - sums[y0][x1] - sums[y1][x0] + sums[y0][x0];
    const own = luma(data, at(x, y));
    return (
      own < total / ((x1 - x0) * (y1 - y0)) - 5 &&
      own < luma(border.color, 0) + 8
    );
  };
  const wider = inkBox(w, h, (x, y) => ink(at(x, y)) || dark(x, y));
  return wider
    ? box.map((v, i) => Math[i % 2 ? "max" : "min"](v, wider[i]))
    : box;
}

function insetOf(data, w, h, border, at, ink) {
  if (typeof ink !== "function") return null;
  const found = inkBox(w, h, (x, y) => ink(at(x, y)));
  if (!found) return null;
  const small =
    ((found[3] - found[2] + 1) * (found[1] - found[0] + 1)) / (w * h) < 0.1;
  const box =
    small && !border.transparent
      ? widen(found, data, w, h, border, at, ink)
      : found;
  const gaps = [
    [box[0], h],
    [h - 1 - box[1], h],
    [box[2], w],
    [w - 1 - box[3], w],
  ];
  const [top, bottom, left, right] = gaps.map(([gap, side]) =>
    Math.max(0, gap / side - 0.012),
  );
  const room = (a, b) => 1 - a - b;
  const kept = room(left, right) * room(top, bottom);
  return kept > 0.97 || kept < 0.02 ? null : { top, bottom, left, right };
}

function brightnessOf(data, w, h, at, ink) {
  if (!ink) return null;
  const seen = [];
  sweep(w, h, (x, y) => {
    const o = at(x, y);
    if (ink(o)) seen.push(luma(data, o));
  });
  return seen.length
    ? seen.reduce((a, b) => a + b, 0) / seen.length / 255
    : null;
}

/**
 * Замер кадра, как его делает окно (`measurePixels`): `{ aspect, transparent, field, inset, bright }`. `inset` — рамка рисунка в долях (`null` — рамки нет: кадр показывается как есть).
 * `delta` — порог «чернил» (у окна 20): печь меряет и им, и низким порогом.
 */
export function measureCrop(
  data,
  width,
  height,
  aspect = width / height,
  { delta = INK_DELTA } = {},
) {
  const at = offsetIn(width);
  const border = borderField(data, width, height);
  const ink = inkProbe(data, border, delta);
  const inset = insetOf(data, width, height, border, at, ink);
  const bright =
    inset !== null
      ? (brightnessOf(data, width, height, at, ink) ?? 0) > 0.4
      : false;
  return {
    aspect,
    transparent: border.transparent,
    field: isField(border) ? border.color : null,
    inset,
    bright,
  };
}

/** Размер копии для замера (как `sampleSize` окна). */
export const sampleSize = (naturalWidth, naturalHeight) => {
  const aspect = naturalWidth / naturalHeight;
  const atLeastEight = (side) => Math.max(8, Math.round(side));
  if (aspect >= 1)
    return { aspect, height: atLeastEight(SAMPLE / aspect), width: SAMPLE };
  return { aspect, height: SAMPLE, width: atLeastEight(SAMPLE * aspect) };
};

// ---------- окно показа ----------

const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const fitAxis = (ideal, win, pic, free, keep) => {
  const start = free
    ? ideal
    : clamp(ideal, ...(win < pic ? [0, pic - win] : keep || [pic - win, 0]));
  const [from, to] = [Math.max(0, start), Math.min(pic, start + win)];
  return [
    (from - start) / win,
    (start + win - to) / win,
    from / pic,
    1 - to / pic,
  ];
};

/**
 * Сколько кадра отрежет окно показа на сцене `ratio` (ширина : высота) — то же, что считает `fitInset` окна. `{ top, right, bottom, left }` — доли картинки, что вне окна.
 * Кадр, который окно не увеличивает (рамки нет), показывается «как есть» по сцене: у `cover` лишнее по длинной стороне уходит поровну.
 */
export function windowCuts(crop, ratio = 1.35, { margin = 0.05 } = {}) {
  if (!crop) return null;
  const fillable = Boolean(crop.inset && (crop.field || crop.transparent));
  if (!fillable) {
    if (crop.transparent) return { ...NO_INSET, mode: "contain" };
    const excess = crop.aspect > ratio ? 1 - ratio / crop.aspect : 0;
    const tall = crop.aspect < ratio ? 1 - crop.aspect / ratio : 0;
    return {
      top: tall / 2,
      bottom: tall / 2,
      left: excess / 2,
      right: excess / 2,
      mode: "cover",
    };
  }
  const centered = Boolean(crop.transparent);
  const edge = crop.inset || NO_INSET;
  const x0 = edge.left * crop.aspect;
  const x1 = (1 - edge.right) * crop.aspect;
  const y0 = edge.top;
  const y1 = 1 - edge.bottom;
  const inkW = x1 - x0;
  const inkH = y1 - y0;
  const tile = ratio || inkW / inkH;
  const gap = Math.min(tile, 1) * clamp(margin, 0, 0.2);
  const fitW = (tile - gap * 2) / inkW;
  const room = 1;
  const scale = Math.min(
    fitW,
    (1 - gap * 2) / inkH,
    Math.min(tile / crop.aspect, 1) * 2.5,
  );
  const winW = tile / scale;
  const winH = 1 / scale;
  const above = clamp((room - inkH * scale) / 2, gap, (1 - inkH * scale) / 2);
  const across = fitAxis(
    (x0 + x1 - winW) / 2,
    winW,
    crop.aspect,
    centered,
    null,
  );
  const down = fitAxis(y0 - above * winH, winH, 1, centered, null);
  return {
    top: Math.max(0, down[2]),
    right: Math.max(0, across[3]),
    bottom: Math.max(0, down[3]),
    left: Math.max(0, across[2]),
    mode: "fill",
  };
}

/**
 * Границы настоящего содержимого кадра в долях `{ left, top, right, bottom }` (правая и нижняя — за последним пикселем): точки, что отличаются от поля больше чем на `delta`.
 * Поле — матовое поле обложек мастерской (`field(x, y)` — его яркость в долях кадра: пятно света посередине), если оно известно, иначе медианный цвет периметра. Одиночные точки не в счёт:
 * строка или столбец входят, если в них не меньше `share` длины поперёк.
 */
export function contentBox(
  data,
  width,
  height,
  { delta = 6, share = 0.004, field = null } = {},
) {
  const border = borderField(data, width, height);
  if (border.transparent) return null;
  const at = offsetIn(width);
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const o = at(x, y);
      if (!opaque(data, o)) continue;
      const base = field ? field((x + 0.5) / width, (y + 0.5) / height) : null;
      const away =
        base == null
          ? diffTo(data, o, border.color)
          : Math.max(
              Math.abs(data[o] - base),
              Math.abs(data[o + 1] - base),
              Math.abs(data[o + 2] - base),
            );
      if (away > delta) {
        rows[y] += 1;
        cols[x] += 1;
      }
    }
  const lit = (counts, across) => (n) => n > 0 && n >= across * share;
  const top = rows.findIndex(lit(rows, width));
  const bottom = rows.findLastIndex(lit(rows, width));
  const left = cols.findIndex(lit(cols, height));
  const right = cols.findLastIndex(lit(cols, height));
  if (top < 0 || left < 0) return null;
  return {
    left: left / width,
    top: top / height,
    right: (right + 1) / width,
    bottom: (bottom + 1) / height,
  };
}

/**
 * Режет ли окно показа настоящее содержимое: `{ ok, cut }`, где `cut` — сколько содержимого окно оставит за кадром по каждой стороне (доли кадра); `ok`, если ни одна сторона не больше `tolerance`.
 * @param {{ top: number, right: number, bottom: number, left: number }} cuts `windowCuts`
 * @param {{ left: number, top: number, right: number, bottom: number }} box `contentBox`
 */
export function hiddenContent(cuts, box, { tolerance = 0.01 } = {}) {
  if (!cuts || !box)
    return { ok: true, cut: { top: 0, right: 0, bottom: 0, left: 0 } };
  const cut = {
    top: Math.max(0, cuts.top - box.top),
    bottom: Math.max(0, box.bottom - (1 - cuts.bottom)),
    left: Math.max(0, cuts.left - box.left),
    right: Math.max(0, box.right - (1 - cuts.right)),
  };
  return { ok: Object.values(cut).every((value) => value <= tolerance), cut };
}
