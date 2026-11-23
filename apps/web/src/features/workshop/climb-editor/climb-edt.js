/*
 * Евклидово расстояние до метки — для обводки и ореола.
 *
 * Обводка у метки одна на всё: на контуры видов, на буквы надписи и на
 * принесённую картинку. Рисовать её каждому своим способом значило бы
 * получить три разные толщины — у текста штрих `strokeText`, у картинки
 * размытие альфы, у фигуры обводку контура. Поэтому обводка и ореол
 * строятся из одного и того же поля: расстояния от каждого пикселя до
 * ближайшего пикселя самой метки. Обводка — всё, что ближе своей толщины,
 * ореол — затухание дальше неё.
 *
 * Поле точное (Фельценшвальб и Хаттенлохер, «Distance Transforms of Sampled
 * Functions»): два прохода одномерного преобразования — по столбцам и по
 * строкам, линейно от площади. 512×512 — несколько миллисекунд.
 */

const FAR = 1e20;

/* Одномерное квадратичное расстояние: нижняя огибающая парабол. */
function transform1d(source, count, out, sites, bounds) {
  const crossing = (q, site) =>
    (source[q] + q * q - (source[site] + site * site)) / (2 * q - 2 * site);
  let hull = 0;
  sites[0] = 0;
  bounds[0] = -Infinity;
  bounds[1] = Infinity;
  for (let q = 1; q < count; q += 1) {
    let at = crossing(q, sites[hull]);
    while (at <= bounds[hull]) {
      hull -= 1;
      at = crossing(q, sites[hull]);
    }
    hull += 1;
    sites[hull] = q;
    bounds[hull] = at;
    bounds[hull + 1] = Infinity;
  }
  hull = 0;
  for (let q = 0; q < count; q += 1) {
    while (bounds[hull + 1] < q) hull += 1;
    const site = sites[hull];
    out[q] = (q - site) * (q - site) + source[site];
  }
}

/**
 * Расстояние в пикселях от каждого пикселя до ближайшего пикселя метки.
 *
 * `coverage` — покрытие метки 0…255 (альфа маски); пикселем метки считается
 * покрытый больше чем наполовину. Внутри метки расстояние — ноль.
 */
export function distanceToShape(coverage, width, height, threshold = 128) {
  const size = width * height;
  const grid = new Float64Array(size);
  let any = false;
  for (let index = 0; index < size; index += 1) {
    const inside = coverage[index] >= threshold;
    grid[index] = inside ? 0 : FAR;
    any ||= inside;
  }
  const result = new Float32Array(size);
  if (!any) return result.fill(Infinity);
  const longest = Math.max(width, height);
  const line = new Float64Array(longest);
  const out = new Float64Array(longest);
  const sites = new Int32Array(longest);
  const bounds = new Float64Array(longest + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) line[y] = grid[y * width + x];
    transform1d(line, height, out, sites, bounds);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = out[y];
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) line[x] = grid[row + x];
    transform1d(line, width, out, sites, bounds);
    for (let x = 0; x < width; x += 1) result[row + x] = Math.sqrt(out[x]);
  }
  return result;
}
