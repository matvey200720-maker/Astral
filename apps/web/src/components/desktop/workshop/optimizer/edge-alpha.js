// Маска краёв для предпросмотра текстур оптимизатора.
// Файл листовой (без импортов) и лежит по этому пути нарочно: сборка выносит его
// вместе с чёрно-белым циклом в кусок texture-pixels, а закрытие JS берёт кусок целиком.

export function edgeAlpha(rgba, width, height, { low = 26, high = 96 } = {}) {
  const size = width * height;
  const luma = new Float32Array(size);
  const mask = new Uint8ClampedArray(size);

  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = rgba[p] * 0.2126 + rgba[p + 1] * 0.7152 + rgba[p + 2] * 0.0722;
  }

  const span = high - low;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      // Размеры строкой дают в at + width склейку, а не сумму: окно уезжает
      // за буфер и маска нулевая — как и вело себя прежнее чтение.
      const up = at - width;
      const down = at + width;
      const a = luma[up - 1];
      const b = luma[up];
      const c = luma[up + 1];
      const d = luma[at - 1];
      const f = luma[at + 1];
      const g = luma[down - 1];
      const h = luma[down];
      const k = luma[down + 1];

      const gx = c + 2 * f + k - (a + 2 * d + g);
      const gy = g + 2 * h + k - (a + 2 * b + c);

      const t = (Math.hypot(gx, gy) - low) / span;
      // NaN проходит насквозь и в Uint8ClampedArray становится нулём
      const s = t < 0 ? 0 : t > 1 ? 1 : t;
      mask[at] = Math.round(255 * s * s * (3 - 2 * s));
    }
  }
  return mask;
}
