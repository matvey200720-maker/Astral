/*
 * Фон сцены частиц: рендер персонажа и его рельеф глубины.
 *
 * В игре частицы попадания висят в объёме: гаснут у кожи (мягкость по
 * глубине), прячутся за телом (сторона «сзади»), освещаются там, где стоят.
 * Персонаж окна — картинка, поэтому объём ему даётся рельефом: расстояние от
 * каждой точки силуэта до его края превращается в толщину тела (корень —
 * тело круглое, а не клином), и эта толщина вычитается из расстояния до
 * плоскости персонажа. Получается глубина, по которой частицы и гаснут, и
 * прячутся — одной картой, без ручной разметки частей тела.
 *
 * Считается один раз на картинку и размер кадра: расстояния до края — два
 * прохода по сетке (Розенфельд — Пфальц, метрика «шахматного коня»
 * приближена восьмью соседями), этого достаточно для толщины в десятки
 * сантиметров.
 */

/* Максимальная толщина тела от плоскости силуэта к камере, метры. */
export const BODY_DEPTH = 0.16;

/**
 * Карта «сколько до края силуэта» по альфе (0…255) картинки: `width × height`,
 * порог — половина. Возвращает Float32Array расстояний в пикселях.
 */
export function silhouetteDistance(alpha, width, height, threshold = 128) {
  const inf = 1e9;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i += 1) dist[i] = alpha[i] >= threshold ? inf : 0;
  const diagonal = Math.SQRT2;
  /* Прямой проход: сверху-слева. */
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let best = dist[i];
      if (x > 0) best = Math.min(best, dist[i - 1] + 1);
      if (y > 0) {
        best = Math.min(best, dist[i - width] + 1);
        if (x > 0) best = Math.min(best, dist[i - width - 1] + diagonal);
        if (x < width - 1) best = Math.min(best, dist[i - width + 1] + diagonal);
      }
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) best = Math.min(best, 1);
      dist[i] = best;
    }
  }
  /* Обратный проход: снизу-справа. */
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let best = dist[i];
      if (x < width - 1) best = Math.min(best, dist[i + 1] + 1);
      if (y < height - 1) {
        best = Math.min(best, dist[i + width] + 1);
        if (x < width - 1) best = Math.min(best, dist[i + width + 1] + diagonal);
        if (x > 0) best = Math.min(best, dist[i + width - 1] + diagonal);
      }
      dist[i] = best;
    }
  }
  return dist;
}

/**
 * Толщина тела (метры, к камере) по карте расстояний до края: `pixelsPerMetre`
 * — масштаб картинки. Толщина растёт корнем от края и упирается в
 * `BODY_DEPTH`: у края силуэта — ноль, в середине груди — полная.
 */
export function bodyThickness(dist, pixelsPerMetre, depth = BODY_DEPTH) {
  const out = new Float32Array(dist.length);
  const full = depth * pixelsPerMetre;
  for (let i = 0; i < dist.length; i += 1) {
    const d = dist[i];
    if (d <= 0) continue;
    const t = Math.min(d / full, 1);
    out[i] = depth * Math.sqrt(t * (2 - t));
  }
  return out;
}
