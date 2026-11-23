/*
 * Пятно света лампы на земле — по записи света из файла модели (13.11.2026).
 *
 * Игра светит лампой по модели, снятой в живой игре стендом (`docs/LAMPS.md`, память «lamp-light-model-measured»): освещённость точки пола
 *
 *     E = K · I · (1 − x²) · конус · cos / (C + n · x²),     x = d / R,
 *
 * где `I` — сила лампы, `R` — дальность (`falloff`), `n` — показатель спада (`exponent`), `d` — расстояние от лампы до точки, `cos` — угол падения на пол, `конус` — 1 внутри внутреннего
 * угла, плавно до нуля на внешнем (`+2°`, как в игре), `K = 21,6`, `C = 0,669`. Свет лампы в кадре окна — картинка пола по этой формуле, а не выдуманное пятно: цвет, сила, дальность, конус и
 * положение — из записи файла. Яркость картинки нормируется на самую яркую точку кадра (одна шкала на все лампы кадра, у пары «игра → автор» — общая): абсолютной яркости у экрана нет,
 * важно отношение между лампами и спад от центра.
 *
 * Здесь — чистые функции (тесты без окна) и сборка PNG; окно кладёт картинку на пол сложением света (`lamp-night-shot.js`).
 */

import sharp from "sharp";

export const POOL_K = 21.6;
export const POOL_C = 0.669;
/** Внешний угол конуса игры шире записанного на столько градусов (замер стенда). */
export const CONE_MARGIN = 2;
/** Сколько точек картинки на метр (не больше `POOL_SIDE` по большей стороне). */
const PIXELS_PER_METRE = 10;
const POOL_SIDE = 320;
/** Доля яркости, до которой нормируется самая яркая точка кадра: центр не белеет, спад читается. */
const PEAK = 0.9;
/** Мягкое насыщение: яркое не обрезается в белое. */
const SOFT = 2.2;
/** Свет гаснет к краю картинки по овалу: с этого доли радиуса (0 — центр, 1 — край) до края. Овал, а не прямоугольник: у пятна нет прямых краёв, и край картинки в кадре не виден. */
const TAPER_FROM = 0.45;

const smooth = (low, high, value) => {
  if (value <= low) return 0;
  if (value >= high) return 1;
  const t = (value - low) / (high - low);
  return t * t * (3 - 2 * t);
};

/** Освещённость точки пола `at = [x, y]` на высоте `z` лампой `light` (оси сцены, Z вверх); 0 — вне дальности, вне конуса, лампа ниже пола. */
export function groundIrradiance(light, at, z = 0) {
  const [lx, ly, lz] = light.position;
  const vx = at[0] - lx;
  const vy = at[1] - ly;
  const vz = z - lz;
  const dist = Math.hypot(vx, vy, vz);
  if (
    !(dist > 1e-6) ||
    !(light.falloff > 0) ||
    dist >= light.falloff ||
    vz >= 0
  )
    return 0;
  const x = dist / light.falloff;
  let cone = 1;
  if (light.type === "spot") {
    const [dx, dy, dz] = light.direction || [0, 0, -1];
    const along = (vx * dx + vy * dy + vz * dz) / dist;
    const angle = (Math.acos(Math.max(-1, Math.min(1, along))) * 180) / Math.PI;
    const [inner, outer] = light.cone || [0, 90];
    cone = 1 - smooth(inner, outer + CONE_MARGIN, angle);
  }
  const incidence = -vz / dist;
  return (
    (POOL_K * light.intensity * (1 - x * x) * cone * incidence) /
    (POOL_C + (light.exponent ?? 1) * x * x)
  );
}

/** Прямоугольник пола кадра `{ min: [x, y], max: [x, y] }`: основания ламп и поле вокруг, пропорция кадра `aspect` (ширина к высоте). `margin` — поле, м. */
export function poolRect(lights, { margin, aspect = 1.5, extra = [] } = {}) {
  const points = [...lights.map((light) => light.position), ...extra];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  let [x0, x1] = [Math.min(...xs) - margin, Math.max(...xs) + margin];
  let [y0, y1] = [Math.min(...ys) - margin, Math.max(...ys) + margin];
  const width = x1 - x0;
  const height = y1 - y0;
  if (width / height < aspect) {
    const grow = (height * aspect - width) / 2;
    x0 -= grow;
    x1 += grow;
  } else {
    const grow = (width / aspect - height) / 2;
    y0 -= grow;
    y1 += grow;
  }
  return { min: [x0, y0], max: [x1, y1] };
}

/**
 * Освещённость пола по прямоугольнику: `{ width, height, values: Float32Array (по лампам вместе), peak }`; лампы складываются (свет складывается), цвет у каждой свой —
 * поэтому значения считаются по лампам отдельно: `layers[i]` — освещённость лампой `i`.
 */
export function poolLayers(lights, rect, { z = 0 } = {}) {
  const spanX = rect.max[0] - rect.min[0];
  const spanY = rect.max[1] - rect.min[1];
  const scale = Math.min(PIXELS_PER_METRE, POOL_SIDE / Math.max(spanX, spanY));
  const width = Math.max(2, Math.round(spanX * scale));
  const height = Math.max(2, Math.round(spanY * scale));
  const layers = lights.map(() => new Float32Array(width * height));
  let peak = 0;
  for (let row = 0; row < height; row += 1) {
    const y = rect.max[1] - ((row + 0.5) / height) * spanY;
    for (let column = 0; column < width; column += 1) {
      const x = rect.min[0] + ((column + 0.5) / width) * spanX;
      let sum = 0;
      lights.forEach((light, index) => {
        const value = groundIrradiance(light, [x, y], z);
        layers[index][row * width + column] = value;
        sum += value;
      });
      if (sum > peak) peak = sum;
    }
  }
  return { width, height, layers, peak };
}

/**
 * RGBA картинки пятна (строки сверху вниз: верх картинки — большие `y`): цвета ламп складываются, прозрачность — сила света, цвет — без умножения на неё («прямой» альфа-канал). Окно кладёт
 * картинку на пол сложением света: где света нет, прозрачность нулевая и пол с фоном кадра остаются как были (чёрное непрозрачное сложение закрашивало фон вне круга пола).
 * `peak` — опора яркости (общая у пары кадров), по умолчанию — своя.
 */
export function poolRgba(lights, rect, { z = 0, peak = null } = {}) {
  const field = poolLayers(lights, rect, { z });
  const reference = peak ?? field.peak;
  const out = new Uint8Array(field.width * field.height * 4);
  if (!(reference > 0)) return { ...field, rgba: out, peak: reference };
  for (let at = 0; at < field.width * field.height; at += 1) {
    const column = at % field.width;
    const row = Math.floor(at / field.width);
    const across = Math.hypot(
      ((column + 0.5) / field.width - 0.5) * 2,
      ((row + 0.5) / field.height - 0.5) * 2,
    );
    const window = 1 - smooth(TAPER_FROM, 1, across);
    const rgb = [0, 0, 0];
    lights.forEach((light, index) => {
      const level =
        (1 - Math.exp((-SOFT * PEAK * field.layers[index][at]) / reference)) *
        window;
      for (let channel = 0; channel < 3; channel += 1)
        rgb[channel] += (light.colour[channel] / 255) * level;
    });
    const strength = Math.min(1, Math.max(rgb[0], rgb[1], rgb[2]));
    if (strength > 0)
      for (let channel = 0; channel < 3; channel += 1)
        out[at * 4 + channel] = Math.round(
          255 * Math.min(1, rgb[channel] / strength),
        );
    out[at * 4 + 3] = Math.round(255 * strength);
  }
  return { ...field, rgba: out, peak: reference };
}

/** Пятно для плана окна: `{ min, max, z, png (base64), width, height, peak }` или `null`, если лампы ничего не освещают. */
export async function lampPool(lights, rect, { z = 0, peak = null } = {}) {
  const made = poolRgba(lights, rect, { z, peak });
  if (!(made.peak > 0)) return null;
  const png = await sharp(
    Buffer.from(made.rgba.buffer, made.rgba.byteOffset, made.rgba.byteLength),
    { raw: { width: made.width, height: made.height, channels: 4 } },
  )
    .png()
    .toBuffer();
  return {
    min: rect.min,
    max: rect.max,
    z,
    png: png.toString("base64"),
    width: made.width,
    height: made.height,
    peak: made.peak,
  };
}
