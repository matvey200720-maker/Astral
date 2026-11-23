/*
 * `depth.png` — кодировка глубины `rgb24-linear-z` (`docs/fx-scenes.md`, §3).
 *
 * Игра пишет reversed-Z (гиперболическую); стенд линеаризует её в расстояние вдоль оси взгляда (view-space Z, метры) и пакует в 24 бита по
 * каналам RGB (R — старший байт), A = 255: `viewZ = ((R·65536 + G·256 + B) / 16777215) · far`, где `far` — `scene.json.depth.far`. `near` не
 * нужен (Z от нуля). Небо и всё дальше `far` — `0xFFFFFF` (белое) = `far`. Мастерская читает обратно и сравнивает глубину частицы с метрами.
 */

export const DEPTH_MAX = 0xffffff;

/** Метры → `[r, g, b]`; за пределами `[0, far]` значение зажимается, «небо» — белое. */
export function encodeDepthLinearZ(viewZ, far) {
  const d = far > 0 ? Math.min(1, Math.max(0, viewZ / far)) : 0;
  const value = Math.round(d * DEPTH_MAX);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** `[r, g, b]` → метры вдоль взгляда камеры. */
export const decodeDepthLinearZ = (r, g, b, far) => ((((r & 0xff) * 65536 + (g & 0xff) * 256 + (b & 0xff)) / DEPTH_MAX) * far);

/** Метры (`Float32Array`) → RGBA `Uint8ClampedArray` для PNG, A = 255. */
export function encodeDepth(viewZ, far) {
  const out = new Uint8ClampedArray(viewZ.length * 4);
  for (let i = 0; i < viewZ.length; i += 1) {
    const [r, g, b] = encodeDepthLinearZ(viewZ[i], far);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * RGBA картинки глубины → метры (`Float32Array`, по строкам сверху вниз, как в PNG). Пиксель «небо» (все 255) даёт `far`.
 */
export function decodeDepth(rgba, width, height, far) {
  if (rgba.length < width * height * 4) throw new RangeError(`depth.png: ${rgba.length} байт, ожидалось ${width * height * 4}`);
  const out = new Float32Array(width * height);
  const scale = far / DEPTH_MAX;
  for (let i = 0; i < out.length; i += 1) out[i] = ((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]) * scale;
  return out;
}

/** Глубина кадра в экранной точке `[u, v]` (от верх-лево, `[0,1]`) из RGBA картинки глубины. */
export function sceneDepthAt(rgba, width, height, u, v, far) {
  const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
  const i = (y * width + x) * 4;
  return decodeDepthLinearZ(rgba[i], rgba[i + 1], rgba[i + 2], far);
}

/** Шаг кодировки, метры (проверка запаса точности). */
export const depthStep = (far) => far / DEPTH_MAX;
