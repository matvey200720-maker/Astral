/*
 * Готовые листы неба из материалов NASA: карта Луны и кусок настоящего звёздного неба (21.11.2026).
 *
 * Данные — отдельный модуль `sky-assets-data.js` (около 350 КБ текста): он тянется только отсюда, а этот модуль берут `import()`-ом
 * в тот момент, когда нужна настоящая Луна или настоящее небо, — окно и главный процесс не платят за него при каждом запуске.
 * Один разбор на процесс: результат запоминается.
 *
 * Кредит для окна «О программе» и подсказок — `SKY_ASSETS_CREDIT`; логотипы NASA не используются.
 */

import { MOON_ALBEDO, STAR_TILE } from "./sky-assets-data.js";

/** Строка кредита (источник и авторы — как указано на страницах NASA). */
export const SKY_ASSETS_CREDIT =
  "Карта Луны и звёздное небо — NASA's Scientific Visualization Studio (LRO, LROC/ASU; Gaia DR2: ESA/Gaia/DPAC)";

/** base64 → байты. */
function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** deflate (raw) → байты: одним путём и в окне, и в Node (`DecompressionStream`). */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** RGB подряд → RGBA `{ width, height, rgba }`, альфа 255. */
export function rgbToRgba(rgb, width, height) {
  if (rgb.length !== width * height * 3) throw new Error(`Лист ${width}×${height}: ${rgb.length} байт вместо ${width * height * 3}.`);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let from = 0, to = 0; from < rgb.length; from += 3, to += 4) {
    rgba[to] = rgb[from];
    rgba[to + 1] = rgb[from + 1];
    rgba[to + 2] = rgb[from + 2];
    rgba[to + 3] = 255;
  }
  return { width, height, rgba };
}

async function unpack(item) {
  return rgbToRgba(await inflateRaw(fromBase64(item.deflated)), item.width, item.height);
}

let loading = null;

/**
 * Оба листа: `{ moon, starTile }`, каждый — `{ width, height, rgba }`. Карта Луны — равнопромежуточная (для `renderBody(..., { maps: { moon } })`),
 * лист звёзд — бесшовный 512×512 (для `renderStarfield(..., { tile })`). Сбой разбора не запоминается: следующий вызов пробует заново.
 */
export function loadSkyAssets() {
  if (!loading) {
    loading = Promise.all([unpack(MOON_ALBEDO), unpack(STAR_TILE)]).then(
      ([moon, starTile]) => ({ moon, starTile }),
      (error) => {
        loading = null;
        throw error;
      },
    );
  }
  return loading;
}
