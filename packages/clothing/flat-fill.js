// Расцветка-«заливка»: вместо текстуры в архиве сплошной цвет. На перекраске штатной вещи (модели в архиве нет) рисовать нечем — выходит гладкий ком одного цвета на упрощённой штатной
// модели («Обувь красная» Tuner: `feet_002_u` — 396 треугольников, расцветка 3,5 КБ с заливкой (201, 2, 0)), 06.11.2026.

/** Разброс канала (стандартное отклонение, из 255), ниже которого картинка — заливка; запас — на шум сжатия. */
export const FLAT_STD = 4;
/** Не больше стольких различимых цветов (по 4 бита на канал) у заливки: узор из двух-трёх цветов — уже рисунок. */
export const FLAT_COLOURS = 3;
/* Картинка короче этой стороны (4×4 — служебные заглушки словарей) настоящей расцветкой не бывает и заливкой не называется: судить не о чем. */
const MIN_SIDE = 16;
const SAMPLE_STEP = 7;

/** Сплошная заливка: разброс по каждому каналу мал и цветов — единицы. */
export function isFlatFill(picture) {
  const rgba = picture?.rgba;
  if (!rgba?.length || Math.min(picture.width, picture.height) < MIN_SIDE) return false;
  const sum = [0, 0, 0];
  const square = [0, 0, 0];
  const seen = new Set();
  let count = 0;
  for (let pixel = 0; pixel * 4 < rgba.length; pixel += SAMPLE_STEP) {
    const at = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      sum[channel] += rgba[at + channel];
      square[channel] += rgba[at + channel] ** 2;
    }
    seen.add(((rgba[at] >> 4) << 8) | ((rgba[at + 1] >> 4) << 4) | (rgba[at + 2] >> 4));
    count += 1;
  }
  const spread = Math.max(...square.map((value, channel) => Math.sqrt(Math.max(0, value / count - (sum[channel] / count) ** 2))));
  return spread < FLAT_STD && seen.size <= FLAT_COLOURS;
}

/**
 * Почему у вещи нет настоящей текстуры, словами; `null` — есть. Судят все расцветки: хоть одна с рисунком — текстура есть.
 * @param {Array<{ variants: Array<{ picture: { rgba: ArrayLike<number> } }> }>} sets расцветки по наборам (`inspectClothingItem(...).variants`)
 */
export function flatFillReason(sets) {
  const pictures = (sets || []).flatMap((entry) => (entry.variants || []).map((variant) => variant.picture)).filter(Boolean);
  if (!pictures.length || !pictures.every(isFlatFill)) return null;
  return `в архиве вместо текстуры сплошная заливка (${pictures.length === 1 ? "одна расцветка" : `${pictures.length} расцветок`}, ни одной детали)`;
}
