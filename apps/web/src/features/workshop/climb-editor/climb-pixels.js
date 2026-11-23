// Смешивание слоёв метки залаза в итоговые пиксели: ореол, обводка, заливка,
// штрихи (снизу вверх). Только арифметика над байтами, поэтому модуль годится
// и для окна, и для потока.

const HALO_PEAK = 0.78;
const HALO_FALLOFF = 3;
const SHAPE_THRESHOLD = 0.5;
const CHANNEL_MAX = 255;

// NaN проходит насквозь: границы режут только настоящие числа
const unit = (value) => Math.min(1, Math.max(0, value));

// «Источник поверх» в накопителе [r, g, b, альфа]; слой с альфой NaN не пропускается
function laminate(acc, alpha, red, green, blue) {
  if (alpha <= 0) return;
  const total = alpha + acc[3] * (1 - alpha);
  const fresh = alpha / total;
  const kept = (acc[3] * (1 - alpha)) / total;
  acc[0] = red * fresh + acc[0] * kept;
  acc[1] = green * fresh + acc[1] * kept;
  acc[2] = blue * fresh + acc[2] * kept;
  acc[3] = total;
}

export function composeClimbPixels(options) {
  const {
    width,
    height,
    fillPixels,
    inkPixels,
    distance,
    outline,
    halo,
    content,
    gradient,
    fillTop,
    fillBottom,
    outlineColour,
    usesPicture,
    tint,
    opacity,
  } = options;
  const [penRed, penGreen, penBlue] = outlineColour;
  const { y: frameTop, height: frameHeight } = content;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const acc = new Float64Array(4);
  const tone = new Float64Array(3);
  const cell = { at: 0, fill: 0, ink: 0, shape: 0, gap: 0 };

  const retone = (row) => {
    const [r0, g0, b0] = fillTop;
    if (!gradient) {
      tone[0] = r0;
      tone[1] = g0;
      tone[2] = b0;
      return;
    }
    const [r1, g1, b1] = fillBottom;
    const k = unit((row + 0.5 - frameTop) / frameHeight);
    tone[0] = r0 + (r1 - r0) * k;
    tone[1] = g0 + (g1 - g0) * k;
    tone[2] = b0 + (b1 - b0) * k;
  };

  const haloLayer = () => {
    if (!(cell.gap > 0)) return;
    const reach = (cell.gap - outline) / halo;
    if (!(reach < 1)) return;
    const alpha = reach <= 0 ? HALO_PEAK : HALO_PEAK * Math.exp(-HALO_FALLOFF * reach) * (1 - reach);
    laminate(acc, alpha, tone[0], tone[1], tone[2]);
  };

  const outlineLayer = () => {
    const alpha = Math.max(cell.shape, unit(outline + 0.5 - cell.gap));
    laminate(acc, alpha, penRed, penGreen, penBlue);
  };

  const mix = (picture, base) => picture + (base - picture) * tint;
  const fillLayer = () => {
    if (!(cell.fill > 0)) return;
    if (!usesPicture) {
      laminate(acc, cell.fill, tone[0], tone[1], tone[2]);
      return;
    }
    const q = cell.at * 4;
    laminate(
      acc,
      cell.fill,
      mix(fillPixels[q], tone[0]),
      mix(fillPixels[q + 1], tone[1]),
      mix(fillPixels[q + 2], tone[2]),
    );
  };

  const inkLayer = () => {
    if (cell.ink > 0) laminate(acc, cell.ink, penRed, penGreen, penBlue);
  };

  const stack = [halo > 0 && haloLayer, outline > 0 && outlineLayer, fillLayer, inkLayer].filter(Boolean);

  for (let row = 0; row < height; row += 1) {
    retone(row);
    for (let col = 0; col < width; col += 1) {
      const at = row * width + col;
      const q = at * 4;
      cell.at = at;
      cell.fill = fillPixels[q + 3] / CHANNEL_MAX;
      cell.ink = inkPixels[q + 3] / CHANNEL_MAX;
      cell.shape = Math.max(cell.fill, cell.ink);
      cell.gap = distance ? distance[at] : cell.shape > SHAPE_THRESHOLD ? 0 : Infinity;

      acc.fill(0);
      for (let i = 0; i < stack.length; i += 1) stack[i]();

      rgba[q] = Math.round(acc[0]);
      rgba[q + 1] = Math.round(acc[1]);
      rgba[q + 2] = Math.round(acc[2]);
      rgba[q + 3] = Math.round(acc[3] * opacity * CHANNEL_MAX);
    }
  }
  return rgba;
}
