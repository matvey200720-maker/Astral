/*
 * Вид «стена» в студии (3Б ТЗ 18.10.2026): выбранная стена в метрах, развёрнутая на
 * плоскость, с листом, повторённым так, как он лежит на ней в игре. Холст по-прежнему —
 * лист; стена — лишь окно, через которое на него смотрят и по которому рисуют.
 *
 * Модуль чистый: из стены (`wall-face.js`) и размера листа он строит
 *   — пространство стены: размер в «пикселях стены» (1 пиксель ≈ 1 пиксель листа вдоль
 *     стены: плотность считается по площади, `sqrt(|det|)`), аффинное отображение
 *     «пиксель стены → пиксель листа» и обратное;
 *   — матрицу узора для `CanvasPattern` — лист повторяется по `repeat`;
 *   — клетки плиток листа под стеной: какая из них «главная» (в ней середина стены),
 *     остальные — повторы;
 *   — область листа, что стена накрывает (для замка кисти), если это не весь лист.
 */

/** Сторона «пикселей стены» не больше этого: гигантская стена не заводит гигантский вид. */
export const WALL_SIDE_LIMIT = 8192;
/** Плиток в сетке повторов больше — рисуем только линии, без затемнения каждой. */
export const GHOST_TILES_LIMIT = 64;

/**
 * Пространство стены: `{ width, height, density, toDoc(x, y), toWall(x, y), pattern, tiles }`
 * или `null`, если лист вырожден. `docWidth`, `docHeight` — размер листа в пикселях.
 */
export function wallSpace(wall, docWidth, docHeight) {
  const { a, b, c, d, e, f } = wall.sheet;
  const determinant = a * e - b * d;
  const perMetre = Math.sqrt(Math.abs(determinant) * docWidth * docHeight);
  if (!(perMetre > 1e-6) || !(docWidth > 0) || !(docHeight > 0)) return null;
  /* Пикселей стены в метре; гигантскую стену сжимаем, мелкую не растягиваем сверх разумного. */
  const density = perMetre * Math.min(1, WALL_SIDE_LIMIT / Math.max(wall.width * perMetre, wall.height * perMetre));
  const width = Math.max(1, wall.width * density);
  const height = Math.max(1, wall.height * density);
  /* Пиксель стены (x, y): s = x / density, t = высота − y / density. */
  const m = {
    xx: (a * docWidth) / density,
    xy: (-b * docWidth) / density,
    x0: (b * wall.height + c) * docWidth,
    yx: (d * docHeight) / density,
    yy: (-e * docHeight) / density,
    y0: (e * wall.height + f) * docHeight,
  };
  const det = m.xx * m.yy - m.xy * m.yx;
  if (!(Math.abs(det) > 1e-12)) return null;
  const toDoc = (x, y) => ({ x: m.xx * x + m.xy * y + m.x0, y: m.yx * x + m.yy * y + m.y0 });
  const toWall = (x, y) => ({
    x: (m.yy * (x - m.x0) - m.xy * (y - m.y0)) / det,
    y: (-m.yx * (x - m.x0) + m.xx * (y - m.y0)) / det,
  });
  /* Узор: точка листа → пиксель стены; порядок — как у `DOMMatrix(a, b, c, d, e, f)`. */
  const inverse = {
    a: m.yy / det,
    b: -m.yx / det,
    c: -m.xy / det,
    d: m.xx / det,
    e: (m.xy * m.y0 - m.yy * m.x0) / det,
    f: (m.yx * m.x0 - m.xx * m.y0) / det,
  };
  return { width, height, density, toDoc, toWall, pattern: inverse, matrix: m, docWidth, docHeight, tiles: wallTileCells(wall, toWall, docWidth, docHeight) };
}

/**
 * Плитки листа под стеной: `{ cells, count, main }`. Клетка — `{ i, j, corners }`: углы плитки
 * в пикселях стены, по часовой от левого верхнего угла листа; `main` — клетка, где середина
 * стены (в ней «настоящая» правка, остальные — её повторы).
 */
export function wallTileCells(wall, toWall, docWidth, docHeight) {
  const { u0, u1, v0, v1 } = wall.uvBounds;
  const first = Math.floor(u0 + 1e-6);
  const last = Math.ceil(u1 - 1e-6);
  const top = Math.floor(v0 + 1e-6);
  const bottom = Math.ceil(v1 - 1e-6);
  const across = Math.max(1, last - first);
  const down = Math.max(1, bottom - top);
  const centre = {
    u: wall.sheet.a * (wall.width / 2) + wall.sheet.b * (wall.height / 2) + wall.sheet.c,
    v: wall.sheet.d * (wall.width / 2) + wall.sheet.e * (wall.height / 2) + wall.sheet.f,
  };
  const main = { i: Math.floor(centre.u), j: Math.floor(centre.v) };
  const cells = [];
  if (across * down <= GHOST_TILES_LIMIT * 4)
    for (let j = top; j < top + down; j += 1)
      for (let i = first; i < first + across; i += 1) {
        const corner = (dx, dy) => toWall((i + dx) * docWidth, (j + dy) * docHeight);
        cells.push({ i, j, corners: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)], main: i === main.i && j === main.j });
      }
  return { cells, count: across * down, across, down, main };
}

/**
 * Область листа, что накрывает стена, как доли листа `[u0, v0, u1, v1]` (для замка кисти) или
 * `null`, если стена накрывает почти весь лист (плитка по обеим осям — правка и так на всём листе).
 */
export function wallRegion(wall, { whole = 0.9 } = {}) {
  const span = (low, high) => {
    if (high - low >= 1) return [0, 1];
    const start = low - Math.floor(low);
    const end = start + (high - low);
    return end > 1 ? [0, 1] : [start, end];
  };
  const [u0, u1] = span(wall.uvBounds.u0, wall.uvBounds.u1);
  const [v0, v1] = span(wall.uvBounds.v0, wall.uvBounds.v1);
  return (u1 - u0) * (v1 - v0) < whole ? [u0, v0, u1, v1] : null;
}

/** Точка листа, свёрнутая в лист (плитка): `mod` без отрицательных остатков. */
export const wrapPoint = (point, width, height) => ({
  x: ((point.x % width) + width) % width,
  y: ((point.y % height) + height) % height,
});
