// Перспективная матрица 3x3: прямоугольник поля надписи -> экранный четырёхугольник.

const PARALLEL_EPS = 1e-9;
const DET_EPS = 1e-12;
const CSS_DIGITS = 9;

// Точка раскладывается итератором: годятся массивы, типизированные массивы и строки.
const takeCorners = (quad) =>
  Array.from({ length: 4 }, (_, at) => {
    const [x, y] = quad[at];
    return [x, y];
  });

// Для одной оси: разности вдоль двух сторон и «невязка» параллелограмма.
const axisSkew = ([v1, v2, v3, v4]) => ({
  side: v2 - v3,
  back: v4 - v3,
  gap: v1 - v2 + v3 - v4,
});

const columnsOf = (xs, ys, w, h) => {
  const [x1, x2, x3, x4] = xs;
  const [y1, y2, y3, y4] = ys;
  const sx = axisSkew(xs);
  const sy = axisSkew(ys);
  const flat = Math.abs(sx.gap) < PARALLEL_EPS && Math.abs(sy.gap) < PARALLEL_EPS;
  const origin = [x1, y1, 1];
  if (flat) {
    return [
      [(x2 - x1) / w, (y2 - y1) / w, 0],
      [(x3 - x2) / h, (y3 - y2) / h, 0],
      origin,
    ];
  }
  const det = sx.side * sy.back - sx.back * sy.side;
  if (Math.abs(det) < DET_EPS) return null;
  const g = (sx.gap * sy.back - sx.back * sy.gap) / det;
  const k = (sx.side * sy.gap - sx.gap * sy.side) / det;
  return [
    [(x2 - x1 + g * x2) / w, (y2 - y1 + g * y2) / w, g / w],
    [(x4 - x1 + k * x4) / h, (y4 - y1 + k * y4) / h, k / h],
    origin,
  ];
};

export function rectToQuadMatrix(w, h, quad) {
  if (!(w > 0) || !(h > 0) || quad?.length !== 4) return null;
  const corners = takeCorners(quad);
  const columns = columnsOf(
    corners.map((point) => point[0]),
    corners.map((point) => point[1]),
    w,
    h,
  );
  if (!columns) return null;
  return [0, 1, 2].map((row) => columns.map((column) => column[row]));
}

const cssValue = (value) => (Number.isFinite(value) ? Number(value.toFixed(CSS_DIGITS)) : 0);

// Столбец 3x3 -> четыре числа матрицы 4x4 (нулевая «глубина» на третьем месте).
const liftColumn = ([top, middle, bottom]) => [top, middle, 0, bottom];

export function rectToQuadCss(w, h, quad) {
  const matrix = rectToQuadMatrix(w, h, quad);
  if (!matrix) return "";
  const [first, second, third] = [0, 1, 2].map((column) => liftColumn(matrix.map((row) => cssValue(row[column]))));
  return `matrix3d(${[...first, ...second, 0, 0, 1, 0, ...third].join(", ")})`;
}

const dot = (row, point) => [0, 1, 2].map((at) => row[at] * point[at]).reduce((sum, term) => sum + term);

export function mapThrough(matrix, x, y) {
  const [top, middle, bottom] = matrix;
  const point = [x, y, 1];
  const scale = dot(bottom, point);
  return [dot(top, point) / scale, dot(middle, point) / scale];
}
