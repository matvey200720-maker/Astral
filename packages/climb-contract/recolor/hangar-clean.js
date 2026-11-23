/*
 * Чистый лист крашеной стороны ангара (Ангар стандартный, ТЗ 13.10.2026).
 *
 * Владелец: «чтобы человек, когда его красил, у него текстурки не было вот
 * этих ржавчин, там всякие текстурки проглядывающие сквозь цвет». Тон
 * работы ложится на светотень штатного листа (`hangarSheetLook`), а листы
 * ангара несут грязь: ржавые пятна на гофре потолка (`ap1_01_hangre_4`),
 * потёки на кромках крыши (`im_metal26b`), разводы на бетоне. Перед тоном
 * (и отделкой) лист чистится:
 *
 *   крупные пятна — яркость делится на размытую копию листа (8 клеток по
 *     длинной стороне: мип «log2 листа − 3») и умножается на среднюю
 *     яркость листа. Гофра и швы мельче клетки — рельеф остаётся;
 *   ржавчина — тексель теплее среднего цвета листа (красный минус синий
 *     больше, чем у листа в целом, на 0,04…0,12) уходит к среднему цвету.
 *
 * Та же арифметика у кадра — шейдером по мипам листа (`recolor-material.js`,
 * `uRcClean`: x — сколько пятен убрать, y — во сколько светлее, z —
 * ржавчина), у установщика (`recolor-hangar.js`) и у подготовки набора:
 * опорная яркость листа (`ref` описи) снята с чистого листа.
 *
 * Цвет ржавчины (ТЗ 17.10.2026; владелец: «добавь возможность красить
 * ржавчину»): у листа, что остаётся штатным, ржавчина — те же тексели, что
 * чистка уводит к среднему, — берёт тон и насыщенность цвета работы при
 * своей яркости (`hangarRustPixels`, шейдер — `uRcRust`); остальной лист —
 * как в игре.
 */

import { tintPixel, tintTarget } from "./colour.js";

/* Клеток размытой копии по длинной стороне листа: у кадра — мип (log2 листа − 3). */
export const HANGAR_CLEAN_CELLS = 8;
/* Тепло текселя против среднего цвета листа, доли 0…1: с 0,04 — ржавчина
   начинается, с 0,12 — тексель целиком уходит к среднему. */
export const HANGAR_RUST_WARMTH = Object.freeze([0.04, 0.12]);
/* Средняя яркость ржавчины по умолчанию (оранжевая ржавчина листа — около 0,35). */
export const HANGAR_RUST_REF = 0.35;
/* Облик чистого листа в кадре (`look.clean`). */
export const HANGAR_CLEAN_LOOK = Object.freeze({
  amount: 1,
  lift: 1,
  rust: 1,
});

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (low, high, value) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/*
 * Размытая копия как мип видеокарты: лист ужат до клеток (по 8 на длинную
 * сторону, на короткую — во столько же раз меньше) средним по клетке и
 * растянут обратно билинейно с повтором — лист игра повторяет по развёртке.
 */
function lowPass(rgba, width, height) {
  const levels = Math.floor(Math.log2(Math.max(width, height, 1)));
  const shift = Math.max(0, levels - Math.log2(HANGAR_CLEAN_CELLS));
  const cw = Math.max(1, width >> shift);
  const ch = Math.max(1, height >> shift);
  const cells = new Float64Array(cw * ch);
  const counts = new Float64Array(cw * ch);
  const mean = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(ch - 1, Math.floor((y * ch) / height));
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const cell = cy * cw + Math.min(cw - 1, Math.floor((x * cw) / width));
      cells[cell] += luma(rgba[at], rgba[at + 1], rgba[at + 2]);
      counts[cell] += 1;
      mean[0] += rgba[at];
      mean[1] += rgba[at + 1];
      mean[2] += rgba[at + 2];
    }
  }
  for (let index = 0; index < cells.length; index += 1)
    cells[index] /= Math.max(1, counts[index]);
  const pixels = Math.max(1, width * height);
  const meanColour = mean.map((value) => value / pixels);
  const sample = (x, y) => {
    const fx = ((x + 0.5) * cw) / width - 0.5;
    const fy = ((y + 0.5) * ch) / height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (cx, cy) =>
      cells[(((cy % ch) + ch) % ch) * cw + (((cx % cw) + cw) % cw)];
    return (
      (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
      (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
    );
  };
  return { sample, meanColour, mean: luma(...meanColour) };
}

/**
 * Чистый лист: `rgba` (ширина × высота × 4, 0…255) — новые пиксели, альфа
 * как была. Крупные пятна сглажены, ржавчина ушла к среднему цвету листа;
 * гофра, швы и мелкий рельеф остались.
 */
export function hangarCleanPixels(rgba, width, height) {
  const out = new Uint8ClampedArray(rgba);
  if (!width || !height) return out;
  const { sample, meanColour, mean } = lowPass(rgba, width, height);
  const meanWarmth = (meanColour[0] - meanColour[2]) / 255;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const k = mean / Math.max(2, sample(x, y));
      const rust = smoothstep(
        HANGAR_RUST_WARMTH[0],
        HANGAR_RUST_WARMTH[1],
        (rgba[at] - rgba[at + 2]) / 255 - meanWarmth,
      );
      for (let channel = 0; channel < 3; channel += 1) {
        const flat = Math.min(255, rgba[at + channel] * k);
        out[at + channel] = flat + (meanColour[channel] - flat) * rust;
      }
    }
  return out;
}

/* Средний цвет листа (0…255) — у кадра последний мип. */
function meanColourOf(rgba) {
  const mean = [0, 0, 0];
  const count = Math.max(1, rgba.length / 4);
  for (let at = 0; at < rgba.length; at += 4)
    for (let channel = 0; channel < 3; channel += 1)
      mean[channel] += rgba[at + channel];
  return mean.map((value) => value / count);
}

/*
 * Доля ржавчины в текселе (0…1): тепло текселя против среднего цвета листа
 * (как у чистки). У накладки из одних ржавых подтёков (`whole`) ржавчина —
 * каждый тексель.
 */
function rustMask(r, b, meanWarmth, whole) {
  if (whole) return 1;
  return smoothstep(
    HANGAR_RUST_WARMTH[0],
    HANGAR_RUST_WARMTH[1],
    (r - b) / 255 - meanWarmth,
  );
}

/**
 * Средняя яркость ржавчины листа (0…1) — опора тона ржавчины (`ref` описи):
 * тексель этой яркости получает ровно цвет работы. `whole` — накладка из
 * одних подтёков: вес — её непрозрачность.
 */
export function hangarRustReference(rgba, { whole = false } = {}) {
  const meanColour = meanColourOf(rgba);
  const meanWarmth = (meanColour[0] - meanColour[2]) / 255;
  let weight = 0;
  let sum = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    const share = whole
      ? rgba[at + 3] / 255
      : rustMask(rgba[at], rgba[at + 2], meanWarmth, false);
    weight += share;
    sum += share * (luma(rgba[at], rgba[at + 1], rgba[at + 2]) / 255);
  }
  return weight > 0 ? sum / weight : HANGAR_RUST_REF;
}

/**
 * Лист с ржавчиной цвета работы: `rgba` (ширина × высота × 4, 0…255) —
 * новые пиксели; ржавые тексели берут тон и насыщенность `colour` при своей
 * яркости (опора — `ref`), прочие и прозрачность — как были.
 */
export function hangarRustPixels(
  rgba,
  width,
  height,
  { colour, ref = HANGAR_RUST_REF, whole = false },
) {
  const out = new Uint8ClampedArray(rgba);
  if (!width || !height || !colour) return out;
  const target = tintTarget(colour);
  const meanColour = meanColourOf(rgba);
  const meanWarmth = (meanColour[0] - meanColour[2]) / 255;
  for (let at = 0; at < rgba.length; at += 4) {
    const strength = rustMask(rgba[at], rgba[at + 2], meanWarmth, whole);
    if (!strength) continue;
    const pixel = tintPixel(
      rgba[at] / 255,
      rgba[at + 1] / 255,
      rgba[at + 2] / 255,
      target,
      { ref, strength },
    );
    out[at] = pixel[0] * 255;
    out[at + 1] = pixel[1] * 255;
    out[at + 2] = pixel[2] * 255;
  }
  return out;
}
