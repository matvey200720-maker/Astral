/*
 * Стили мира (ТЗ 17.10.2026, задача 10): «рисованный», «комикс» (как в
 * Borderlands), «мультяшный» (как в Симпсонах), «акварель» и «ретро».
 *
 * Стиль — стадия конвейера текстур (`texture-stages.js`): хост разжимает
 * текстуру в RGBA, красит ВЕРХНЮЮ ступень mip (`TextureStages.TransformFromTop`,
 * задача 35), остальные ступени получает её уменьшением и сжимает всё обратно
 * в тот же формат и вес. Этот файл — то же правило для окна: кадр
 * предпросмотра красится им же. Правило двойное и считается ЦЕЛЫМИ числами
 * (никаких float и Math.pow), поэтому байты окна и хоста совпадают; это
 * держит тест на настоящем хосте (`texture-styles.test.js`).
 *
 * Как красится один кадр (`width × height`, RGBA, альфа не меняется):
 *   • сглаживание [1 2 1]² с оборачиванием краёв — текстуры мира тайлятся,
 *     и шва на стыке плиток быть не должно;
 *   • постеризация яркости (`bandLevel`): цвет сдвигается на разницу между
 *     яркостью и её ступенькой, оттенок остаётся;
 *   • контуры — градиент Собеля по самому кадру (максимум по каналам, чтобы
 *     видна была и граница красного с зелёным той же яркости);
 *   • на малых текстурах контур гаснет (`styleDetail`): на 8×8 пикселях
 *     контур в один пиксель съел бы всю картинку; мелкая фактура — зерно
 *     бумаги и штриховка — гаснет раньше (`styleFineDetail`), чтобы не шуметь
 *     на движении;
 *   • у «Ретро» растра нет совсем: крупные пиксели и палитра — растр на
 *     движении даёт муар и мерцание.
 *
 * Вырезная альфа (листва, сетки, надписи; `isCutoutAlpha`): цвет под вырезом
 * — не картинка, а «затравка» фильтрации, и у листвы он светлее самих листьев.
 * Контур на такой границе обвёл бы каждый лист чёрным, а штриховка и
 * постеризация сочли бы вырез тенью (задача 35: чёрные пятна и квадраты на
 * деревьях). Поэтому цвет под вырезом сперва заменяется продолжением цвета
 * листьев (`fillHiddenColour`), а медиана и границы яркости комикса считаются
 * только по видимым точкам.
 *
 * Что красится — как у ЧБ-мира (`TextureStages.IsColourTexture`): цвет мира;
 * нормали и блеск — данные освещения, остаются. Палитры тинта (`_pal`) и
 * таблицы-полоски стилю не нужны (контур на таблице испортил бы тонировку) —
 * они остаются как есть, а ЧБ по-прежнему красит их в серый.
 *
 * Правишь краску — подними `TEXTURE_STAGES_VERSION` (`texture-stages.js`):
 * собранные варианты со стилем пересоберутся. Отпечаток краски держит тест.
 */

import { TEXTURE_STYLES } from "./texture-style-ids.js";
import { isPackedDataTexture } from "./texture-stages.js";

export { TEXTURE_STYLES };

/** Текстуры, которые стиль не трогает по имени: маски и карты, что не цвет. */
const MASKS = /_(?:mask|msk|ao|lightmap|ramp)\d*$/i;

/** Таблица, а не картинка: палитра тинта и полоска-таблица (копия `IsLookupTexture` хоста). */
export function isLookupTexture(name, width, height) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith("_pal") || lower.includes("_pal_") || lower.endsWith("_lut") || lower.includes("palette")) return true;
  return height <= 8 && width >= 16 * Math.max(1, height);
}

/** Стиль красит текстуру по имени и виду (палитры, маски и упакованные данные `…_h` — нет). */
export const isStyledTexture = (name, width, height) =>
  !MASKS.test(String(name || "")) && !isPackedDataTexture(name) && !isLookupTexture(name, width, height);

/* ── Целочисленные кирпичики ───────────────────────────────────────────── */

const clamp8 = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

/** Яркость 0…255 целыми: 54 + 183 + 19 = 256, Rec. 709 (как `grayLuma`, но без округления дроби). */
const luma = (r, g, b) => (54 * r + 183 * g + 19 * b + 128) >> 8;

/** Насыщенность: `scale` — в 256-х (256 — как была). */
const saturate = (value, y, scale) => clamp8(y + (((value - y) * scale) >> 8));

/*
 * Насыщенность без обрезки (задача 35; копия `SaturationRoom` хоста): усиление
 * цвета ×1,3 и больше толкало тёплые текстуры (бордюр, глина, дерево) синим
 * каналом в ноль, а яркие — в 255: картинка в канале становилась плоской и
 * «заливалась одним цветом». Усиление плавно слабеет у краёв: канал ближе
 * `SATURATE_KNEE` к 0 или к 255 получает только долю усиления (доля —
 * расстояние до края / `SATURATE_KNEE`), так что рисунок в нём остаётся.
 * Меньше 1 (256) усиление не бывает.
 */
const SATURATE_KNEE = 48;
function saturationRoom(r, g, b, scale) {
  if (scale <= 256) return scale;
  const top = r > g ? (r > b ? r : b) : g > b ? g : b;
  const bottom = r < g ? (r < b ? r : b) : g < b ? g : b;
  let share = 256;
  if (bottom < SATURATE_KNEE) share = Math.min(share, ((bottom * 256) / SATURATE_KNEE) | 0);
  if (255 - top < SATURATE_KNEE) share = Math.min(share, (((255 - top) * 256) / SATURATE_KNEE) | 0);
  return 256 + (((scale - 256) * share) >> 8);
}

/** `from` → `to` на долю `amount` из 255. */
const mix = (from, to, amount) => from + ((((to - from) * amount) + 127) / 255 | 0);

/**
 * Постеризация: яркость 0…255 → одна из `levels` ступенек. `slope` — резкость
 * перехода между ступеньками: 1 — плавная лестница, 64 и больше — почти
 * ступень (переход у середины между ступеньками).
 */
export function bandLevel(y, levels, slope) {
  const position = y * (levels - 1);
  const floor = position >> 8;
  const fraction = position & 255;
  let t = (fraction - 128) * slope + 128;
  t = t < 0 ? 0 : t > 256 ? 256 : t;
  const smooth = (t * t * (768 - 2 * t)) >> 16;
  return (((floor << 8) + smooth) * 255 / ((levels - 1) << 8)) | 0;
}

/** Хэш точки в 0…255 (целые, как в хосте). */
function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) & 255;
}

/** Зерно бумаги −382…382: три слоя хэша крупнее и крупнее. */
const grain = (x, y) => hash(x, y, 1) + hash(x >> 1, y >> 1, 2) + hash(x >> 2, y >> 2, 3) - 382;

/**
 * Сколько рисунка остаётся на ступени (0…256): полный от 32 пикселей
 * стороны и больше, к 4 пикселям — ноль.
 */
export const styleDetail = (width, height) => {
  const side = Math.min(width, height);
  const value = Math.trunc(((side - 4) * 256) / 28);
  return value < 0 ? 0 : value > 256 ? 256 : value;
};

/**
 * Сколько мелкой фактуры (зерно бумаги, штриховка) остаётся на ступени
 * (0…256): полная от 128 пикселей стороны, на 64 — треть, от 32 и меньше —
 * ничего. Контуры (`styleDetail`) держатся дольше: на ступени в 32 пикселя
 * линия ещё читается, а зерно на ней — уже шум по всему миру.
 */
export const styleFineDetail = (width, height) => {
  const side = Math.min(width, height);
  const value = Math.trunc(((side - 32) * 256) / 96);
  return value < 0 ? 0 : value > 256 ? 256 : value;
};

/** Один канал сглажен [1 2 1] по обеим осям (края оборачиваются). */
function blurPlane(plane, width, height) {
  const middle = new Uint8Array(plane.length);
  const out = new Uint8Array(plane.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = row + (x === 0 ? width - 1 : x - 1);
      const right = row + (x === width - 1 ? 0 : x + 1);
      middle[row + x] = (plane[left] + 2 * plane[row + x] + plane[right] + 2) >> 2;
    }
  }
  for (let y = 0; y < height; y++) {
    const up = (y === 0 ? height - 1 : y - 1) * width;
    const row = y * width;
    const down = (y === height - 1 ? 0 : y + 1) * width;
    for (let x = 0; x < width; x++) out[row + x] = (middle[up + x] + 2 * middle[row + x] + middle[down + x] + 2) >> 2;
  }
  return out;
}

/** Копия сглаженная [1 2 1] по обеим осям, края оборачиваются; альфа — прежняя. */
function blur(source, width, height) {
  const middle = new Uint8Array(source.length);
  const out = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const left = (row + (x === 0 ? width - 1 : x - 1)) * 4;
      const centre = (row + x) * 4;
      const right = (row + (x === width - 1 ? 0 : x + 1)) * 4;
      for (let k = 0; k < 3; k++) middle[centre + k] = (source[left + k] + 2 * source[centre + k] + source[right + k] + 2) >> 2;
      middle[centre + 3] = source[centre + 3];
    }
  }
  for (let y = 0; y < height; y++) {
    const up = (y === 0 ? height - 1 : y - 1) * width;
    const row = y * width;
    const down = (y === height - 1 ? 0 : y + 1) * width;
    for (let x = 0; x < width; x++) {
      const a = (up + x) * 4;
      const b = (row + x) * 4;
      const c = (down + x) * 4;
      for (let k = 0; k < 3; k++) out[b + k] = (middle[a + k] + 2 * middle[b + k] + middle[c + k] + 2) >> 2;
      out[b + 3] = source[b + 3];
    }
  }
  return out;
}

/** Градиент Собеля, максимум по трём каналам (|gx| + |gy|) / 4, 0…255; края оборачиваются. */
function edges(source, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const up = ((y + height - 1) % height) * width;
    const row = y * width;
    const down = ((y + 1) % height) * width;
    for (let x = 0; x < width; x++) {
      const xm = (x + width - 1) % width;
      const xp = (x + 1) % width;
      let best = 0;
      for (let k = 0; k < 3; k++) {
        const a = source[(up + xm) * 4 + k];
        const b = source[(up + x) * 4 + k];
        const c = source[(up + xp) * 4 + k];
        const d = source[(row + xm) * 4 + k];
        const f = source[(row + xp) * 4 + k];
        const g = source[(down + xm) * 4 + k];
        const h = source[(down + x) * 4 + k];
        const i = source[(down + xp) * 4 + k];
        const gx = c + 2 * f + i - (a + 2 * d + g);
        const gy = g + 2 * h + i - (a + 2 * b + c);
        const magnitude = ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy)) >> 2;
        if (magnitude > best) best = magnitude;
      }
      out[row + x] = best > 255 ? 255 : best;
    }
  }
  return out;
}

/** Линия из градиента: порог `low`, усиление `gain`/16, потом по `detail`. */
const stroke = (edge, low, gain, detail) => {
  const value = ((edge - low) * gain) >> 4;
  return ((value < 0 ? 0 : value > 255 ? 255 : value) * detail) >> 8;
};

/**
 * Сдвиг яркости на `shift`, урезанный так, чтобы ни один канал не вышел за
 * 0…255: упёрся один канал — сдвиг кончается, оттенок не уходит (иначе
 * светлое белело, тёмное чернело).
 */
function room(r, g, b, shift) {
  const top = r > g ? (r > b ? r : b) : g > b ? g : b;
  const bottom = r < g ? (r < b ? r : b) : g < b ? g : b;
  return shift > 255 - top ? 255 - top : shift < -bottom ? -bottom : shift;
}

/* Краска пикселя в буфере: цвет и альфа прежняя. */
function put(pixels, at, r, g, b) {
  pixels[at] = clamp8(r);
  pixels[at + 1] = clamp8(g);
  pixels[at + 2] = clamp8(b);
}

/* ── Стили ─────────────────────────────────────────────────────────────── */

/* Рисованный: мягкие мазки (8 ступеней яркости внутри яркости текстуры), тонкий тёплый контур, бумажная фактура. */
function painted(pixels, width, height, detail, cutout) {
  const fine = (styleFineDetail(width, height) * detail) >> 8;
  const soft = blur(pixels, width, height);
  const edge = edges(soft, width, height);
  const range = rangeOf(soft, cutout);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      let r = soft[at];
      let g = soft[at + 1];
      let b = soft[at + 2];
      const lum = luma(r, g, b);
      const shift = room(r, g, b, bandShift(range, lum, bandLevel(bandPosition(range, lum), 8, 3)));
      r += shift;
      g += shift;
      b += shift;
      const y2 = luma(r, g, b);
      const boost = saturationRoom(r, g, b, 288);
      r = saturate(r, y2, boost);
      g = saturate(g, y2, boost);
      b = saturate(b, y2, boost);
      const line = stroke(edge[y * width + x], 20, 40, detail);
      r = mix(r, 46, line);
      g = mix(g, 32, line);
      b = mix(b, 26, line);
      let paper = (((grain(x, y) * 22) >> 10) * fine) >> 8;
      /* Зерно бумаги не чернит тёмное: вычитающее зерно ослабляется у точек темнее яркости 64. */
      if (paper < 0) paper = (paper * Math.min(luma(r, g, b), 64)) >> 6;
      put(pixels, at, r + paper, g + paper, b + paper);
    }
}

/* Порог градиента, с которого начинается линия комикса (0…255): ниже — зерно камня, асфальта и травы линией не становится. */
const LINE_LOW = 30;

/*
 * Штриховка комикса: тень — то, что темнее медианы самой текстуры больше чем
 * на `HATCH_BELOW`, а не абсолютно тёмное: асфальт тёмный весь и не штрихуется
 * весь. Ровный тёмный участок (окно без переплёта, пятно масла) не штрихуется
 * вовсе: штрих ложится там, где рядом есть детали (средняя «колючесть»
 * вокруг точки не ниже `HATCH_ACTIVE`).
 */
const HATCH_BELOW = 30;
const HATCH_ACTIVE = 12;

/*
 * Ступени яркости комикса — внутри яркости самой текстуры (задача 35): от
 * 2-го до 98-го процентиля видимых точек, а не от 0 до 255. Пять ступеней от
 * нуля до белого вдавливали тёмную листву и тёмные карточки дальних планов в
 * чёрное (до половины видимых точек), а ровный тёмный цвет асфальта
 * (яркость 35) подбрасывали на следующую ступень (64) и красили в бирюзу.
 * Теперь чёрным остаётся только контур, ровный цвет остаётся своим, а
 * текстура не светлеет и не темнеет в среднем. Размах яркости меньше
 * `BAND_SPAN_MIN` — картинка почти ровная — не постеризуется вовсе, к
 * `BAND_SPAN_MIN + BAND_SPAN_RAMP` постеризация набирает полную силу.
 */
const BAND_SPAN_MIN = 16;
const BAND_SPAN_RAMP = 48;

/* Яркость, ниже которой лежит `percent` % точек гистограммы (всего `total`). */
function percentile(histogram, total, percent) {
  let count = 0;
  for (let value = 0; value < 256; value++) {
    count += histogram[value];
    if (count * 100 >= total * percent) return value;
  }
  return 255;
}

/*
 * Диапазон ступеней яркости одной текстуры — общий у всех стилей (задача 35: комикс; затем остальные).
 * `low` и `span` — 2-й и 98-й процентили яркости видимых точек картинки, которую стиль ступенчато делит;
 * `banding` (0…256) — сила постеризации: размах меньше `BAND_SPAN_MIN` — не постеризуется вовсе. Ступени
 * лежат внутри этого диапазона: ни чёрное, ни светлее самой светлой точки текстуры из них не выходит
 * (копия `TextureStyles.BandRange`).
 */
function rangeOfHistogram(histogram, counted) {
  const low = percentile(histogram, counted, 2);
  const span = percentile(histogram, counted, 98) - low;
  return { low, span, banding: Math.min(256, Math.max(0, (((span - BAND_SPAN_MIN) * 256) / BAND_SPAN_RAMP) | 0)) };
}

/* Гистограмма яркости видимых точек картинки (у вырезной альфы — только видимые). */
function histogramOf(image, cutout) {
  const histogram = new Int32Array(256);
  let counted = 0;
  for (let at = 0; at < image.length; at += 4) {
    if (cutout && image[at + 3] < 128) continue;
    histogram[luma(image[at], image[at + 1], image[at + 2])]++;
    counted++;
  }
  return { histogram, counted };
}

function rangeOf(image, cutout) {
  const { histogram, counted } = histogramOf(image, cutout);
  return rangeOfHistogram(histogram, counted);
}

/* Яркость → 0…255 внутри диапазона (ступени считаются в этой шкале). */
const bandPosition = (range, lum) => (range.span <= 0 ? 0 : clamp8((((lum - range.low) * 255) / range.span) | 0));

/* Сдвиг яркости к ступени `level` (0…255 внутри диапазона) по силе постеризации. */
const bandShift = (range, lum, level) => (range.banding <= 0 ? 0 : ((range.low + (((level * range.span) / 255) | 0) - lum) * range.banding) >> 8);

/* Комикс: плоские цвета (5 ступеней), жирные чёрные контуры, штриховка в тенях. */
function comic(pixels, width, height, detail, cutout) {
  const soft = blur(pixels, width, height);
  /* Контур — по дважды сглаженному: зерно камня и асфальта линиями не становится. */
  const edge = edges(blur(soft, width, height), width, height);
  const lines = new Uint8Array(width * height);
  for (let i = 0; i < lines.length; i++) lines[i] = stroke(edge[i], LINE_LOW, 72, detail);
  /* Медиана, границы яркости и «колючесть» вокруг каждой точки — по видимым точкам. */
  const { histogram, counted } = histogramOf(soft, cutout);
  let median = 0;
  for (let count = 0; median < 255; median++) {
    count += histogram[median];
    if (count * 2 >= counted) break;
  }
  const range = rangeOfHistogram(histogram, counted);
  const activity = blurPlane(blurPlane(edge, width, height), width, height);
  /* Штриховка — на ступенях от 64 пикселей: через 4 пикселя на больших и 3 на малых; мельче гаснет. */
  const hatching = (styleFineDetail(width, height) * detail) >> 8;
  const period = Math.min(width, height) >= 96 ? 4 : 3;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      let r = soft[at];
      let g = soft[at + 1];
      let b = soft[at + 2];
      let lum = luma(r, g, b);
      const shadow = lum + HATCH_BELOW < median && activity[y * width + x] >= HATCH_ACTIVE;
      const shift = room(r, g, b, bandShift(range, lum, bandLevel(bandPosition(range, lum), 5, 64)));
      r += shift;
      g += shift;
      b += shift;
      lum = luma(r, g, b);
      const boost = saturationRoom(r, g, b, 340);
      r = saturate(r, lum, boost);
      g = saturate(g, lum, boost);
      b = saturate(b, lum, boost);
      if (hatching > 0 && shadow && (x + y) % period === 0) {
        const strength = (130 * hatching) >> 8;
        r = mix(r, 14, strength);
        g = mix(g, 12, strength);
        b = mix(b, 18, strength);
      }
      const line = lines[y * width + x];
      put(pixels, at, mix(r, 14, line), mix(g, 12, line), mix(b, 18, line));
    }
}

/* Мультяшный: яркие плоские цвета (6 ступеней внутри яркости текстуры), мягкий контур тёмнее собственного цвета. */
function cartoon(pixels, width, height, detail, cutout) {
  const soft = blur(blur(pixels, width, height), width, height);
  const edge = edges(soft, width, height);
  const range = rangeOf(soft, cutout);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      let r = soft[at];
      let g = soft[at + 1];
      let b = soft[at + 2];
      let lum = luma(r, g, b);
      /* Середина светлее — лёгкий подъём без float, в шкале диапазона самой текстуры. */
      const position = bandPosition(range, lum);
      const lifted = clamp8(position + ((position * (255 - position)) >> 11));
      const shift = room(r, g, b, bandShift(range, lum, bandLevel(lifted, 6, 2)));
      r += shift;
      g += shift;
      b += shift;
      lum = luma(r, g, b);
      const boost = saturationRoom(r, g, b, 410);
      r = saturate(r, lum, boost);
      g = saturate(g, lum, boost);
      b = saturate(b, lum, boost);
      const line = stroke(edge[y * width + x], 28, 30, detail);
      /* Контур — тот же цвет, потемнее: 35 % от него. */
      put(pixels, at, mix(r, (r * 90) >> 8, line), mix(g, (g * 90) >> 8, line), mix(b, (b * 90) >> 8, line));
    }
}

/*
 * Акварель: размытые заливки, светлее и бледнее, влажный край пигмента, крупное зерно бумаги. Ступени (8) —
 * внутри яркости текстуры. Бумага светлит заливку: до 14 % к белому, но тёмное она светлит меньше — тёмный
 * пигмент остаётся тёмным, а ровный тёмный цвет (асфальт, бордюр) не уходит в серый: доля бумаги растёт с
 * яркостью до 128 и дальше не меняется.
 */
function watercolor(pixels, width, height, detail, cutout) {
  const fine = (styleFineDetail(width, height) * detail) >> 8;
  const wash = blur(blur(blur(pixels, width, height), width, height), width, height);
  const edge = edges(wash, width, height);
  const range = rangeOf(wash, cutout);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      let r = wash[at];
      let g = wash[at + 1];
      let b = wash[at + 2];
      let lum = luma(r, g, b);
      const shift = room(r, g, b, bandShift(range, lum, bandLevel(bandPosition(range, lum), 8, 2)));
      r += shift;
      g += shift;
      b += shift;
      lum = luma(r, g, b);
      r = saturate(r, lum, 250);
      g = saturate(g, lum, 250);
      b = saturate(b, lum, 250);
      /* Бумага светлит заливку: до 14 % к белому, у тёмного — меньше. */
      const paperShare = (36 * Math.min(lum, 128)) >> 7;
      r += ((255 - r) * paperShare) >> 8;
      g += ((255 - g) * paperShare) >> 8;
      b += ((255 - b) * paperShare) >> 8;
      /* Влажный край: у границ заливки пигмент темнее — на тот же цвет, множителем. */
      const rim = stroke(edge[y * width + x], 8, 44, detail);
      r = mix(r, (r * 150) >> 8, rim);
      g = mix(g, (g * 150) >> 8, rim);
      b = mix(b, (b * 150) >> 8, rim);
      const paper = (((grain(x, y) * 18) >> 10) * fine) >> 8;
      put(pixels, at, r + paper, g + paper, b + paper);
    }
}

/*
 * Ретро: крупные пиксели (4×4 на 128, 2×2 на 64) и ограниченная палитра — 8
 * ступеней яркости и цвет крупными шагами, без растра: растр на движении даёт
 * муар и мерцание. Яркость и цвет делятся, а не три канала по отдельности: у
 * серой текстуры (асфальт, штукатурка) три канала округлились бы порознь, и
 * она вся стала бы одним плоским серым.
 *
 * Ступени — внутри яркости самой текстуры (по блокам, как их видит игра), а цвет крупными шагами
 * ослабляется вместе с ними: почти ровная текстура (асфальт, штукатурка) остаётся своим цветом,
 * только крупными пикселями, а не подпрыгивает к ближайшей из восьми глобальных ступеней.
 */
function retro(pixels, width, height, cutout) {
  const side = Math.min(width, height);
  const block = side >= 128 ? 4 : side >= 64 ? 2 : 1;
  const source = Uint8Array.from(pixels);
  const blocksX = Math.ceil(width / block);
  const blocksY = Math.ceil(height / block);
  const means = new Int32Array(blocksX * blocksY * 3);
  const histogram = new Int32Array(256);
  let counted = 0;
  for (let by = 0; by < height; by += block)
    for (let bx = 0; bx < width; bx += block) {
      const toX = Math.min(width, bx + block);
      const toY = Math.min(height, by + block);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      let visible = 0;
      for (let y = by; y < toY; y++)
        for (let x = bx; x < toX; x++) {
          const at = (y * width + x) * 4;
          r += source[at];
          g += source[at + 1];
          b += source[at + 2];
          count++;
          if (!cutout || source[at + 3] >= 128) visible++;
        }
      r = ((r + (count >> 1)) / count) | 0;
      g = ((g + (count >> 1)) / count) | 0;
      b = ((b + (count >> 1)) / count) | 0;
      const slot = ((by / block) * blocksX + bx / block) * 3;
      means[slot] = r;
      means[slot + 1] = g;
      means[slot + 2] = b;
      histogram[luma(r, g, b)] += visible;
      counted += visible;
    }
  const range = rangeOfHistogram(histogram, counted);
  /* Цвет крупными шагами: к ближайшему кратному 28 (от нуля вверх и вниз одинаково). */
  const snap = (value) => (((value + (value < 0 ? -14 : 14)) / 28) | 0) * 28;
  for (let by = 0; by < height; by += block)
    for (let bx = 0; bx < width; bx += block) {
      const toX = Math.min(width, bx + block);
      const toY = Math.min(height, by + block);
      const slot = ((by / block) * blocksX + bx / block) * 3;
      const r = means[slot];
      const g = means[slot + 1];
      const b = means[slot + 2];
      let rr = r;
      let gg = g;
      let bb = b;
      if (range.banding > 0) {
        const lum = luma(r, g, b);
        const level = ((((bandPosition(range, lum) * 7 + 127) / 255) | 0) * 255 / 7) | 0;
        const target = lum + bandShift(range, lum, level);
        const chromaR = r - lum;
        const chromaB = b - lum;
        rr = clamp8(target + chromaR + (((snap(chromaR) - chromaR) * range.banding) >> 8));
        bb = clamp8(target + chromaB + (((snap(chromaB) - chromaB) * range.banding) >> 8));
        /* Зелёный — из яркости: 54 r + 183 g + 19 b = 256 · target. */
        gg = clamp8((((target << 8) - 54 * rr - 19 * bb) / 183) | 0);
      }
      for (let y = by; y < toY; y++)
        for (let x = bx; x < toX; x++) put(pixels, (y * width + x) * 4, rr, gg, bb);
    }
}

const PAINTERS = { "style-painted": painted, "style-comic": comic, "style-cartoon": cartoon, "style-watercolor": watercolor, "style-retro": retro };

/**
 * Альфа — вырез (листва, сетка, надпись на прозрачном), а не маска блеска или
 * градиент: не меньше 3 % точек прозрачнее половины, видимых не меньше 0,5 %
 * и «серединой» (32…223) не больше 40 % (копия `TextureStyles.IsCutout`).
 */
export function isCutoutAlpha(rgba, width, height) {
  const count = width * height;
  if (count === 0) return false;
  let hidden = 0;
  let middle = 0;
  for (let i = 0; i < count; i++) {
    const alpha = rgba[i * 4 + 3];
    if (alpha < 128) hidden++;
    if (alpha >= 32 && alpha < 224) middle++;
  }
  return hidden * 100 >= count * 3 && (count - hidden) * 200 >= count && middle * 100 <= count * 40;
}

/**
 * Цвет под вырезом (альфа < 128) — продолжение цвета видимых точек: слой за
 * слоем, каждая скрытая точка берёт среднее своих видимых соседей из 8 (края
 * оборачиваются). Слой читает только то, что было видно до него, поэтому
 * порядок обхода ничего не меняет (копия `TextureStyles.FillHidden`).
 */
export function fillHiddenColour(rgba, width, height) {
  const count = width * height;
  const known = new Uint8Array(count);
  let pending = [];
  for (let i = 0; i < count; i++) {
    known[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    if (!known[i]) pending.push(i);
  }
  if (pending.length === 0 || pending.length === count) return;
  const limit = Math.max(width, height);
  for (let pass = 0; pass < limit && pending.length > 0; pass++) {
    const found = [];
    const rest = [];
    for (const i of pending) {
      const x = i % width;
      const y = (i / width) | 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = ((y + dy + height) % height) * width + ((x + dx + width) % width);
          if (!known[j]) continue;
          r += rgba[j * 4];
          g += rgba[j * 4 + 1];
          b += rgba[j * 4 + 2];
          n++;
        }
      if (n === 0) {
        rest.push(i);
        continue;
      }
      rgba[i * 4] = ((r + (n >> 1)) / n) | 0;
      rgba[i * 4 + 1] = ((g + (n >> 1)) / n) | 0;
      rgba[i * 4 + 2] = ((b + (n >> 1)) / n) | 0;
      found.push(i);
    }
    for (const i of found) known[i] = 1;
    pending = rest;
  }
}

/**
 * Стиль на месте: кадр RGBA `width × height`, альфа прежняя. Кадр
 * предпросмотра и проверки; в игру то же правило кладёт хост. `detail`
 * (0…256) — сколько рисунка оставить; не названо — по размеру кадра.
 */
export function styleRgba(rgba, width, height, style, detail = styleDetail(width, height)) {
  const paint = PAINTERS[style];
  if (!paint) throw new Error(`Стиля мира «${style}» нет.`);
  if (width < 1 || height < 1 || rgba.length < width * height * 4) throw new Error("Кадр для стиля меньше своих размеров.");
  const cutout = isCutoutAlpha(rgba, width, height);
  if (cutout) fillHiddenColour(rgba, width, height);
  paint(rgba, width, height, detail, cutout);
  return rgba;
}
