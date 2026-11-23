/*
 * Цвет для редакторов перекраски: запретные зоны, завод, ангар, маппинг.
 *
 * Одна арифметика на окно и на установщик. Кадр редактора красит модели
 * шейдером (`features/workshop/model-stage/recolor-material.js`), а установщик
 * — пиксели текстур, которые уедут в игру (`pixels.js`), и оба считают цвет
 * по формулам этого файла: иначе в кадре был бы один бирюзовый, а в игре —
 * другой.
 *
 * Все числа — в sRGB 0…1, как их хранят текстуры игры: перекраска работает
 * с байтами текстуры, а не со светом сцены.
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** `#rgb`/`#rrggbb` → `#rrggbb` строчными; иначе `fallback`. */
export function normalizeRecolourHex(value, fallback = null) {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text))
    return `#${[...text.slice(1)].map((char) => char + char).join("")}`.toLowerCase();
  return fallback;
}

/** `#rrggbb` → `[r, g, b]` байтами. */
export function hexBytes(hex) {
  const value = normalizeRecolourHex(hex, "#000000");
  return [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
}

/** `[r, g, b]` байтами → `#rrggbb`. */
export function bytesHex([r, g, b]) {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** sRGB 0…1 → [тон в градусах, насыщенность 0…1, светлота 0…1]. */
export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hueChannel(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

/** [тон°, насыщенность, светлота] → sRGB 0…1. */
export function hslToRgb(h, s, l) {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (((h % 360) + 360) % 360) / 360;
  return [hueChannel(p, q, hue + 1 / 3), hueChannel(p, q, hue), hueChannel(p, q, hue - 1 / 3)];
}

/** Яркость пикселя по весам Rec. 709 — прямо по байтам sRGB, как шейдер. */
export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Средняя яркость листа (0…1) по пикселям RGBA, прозрачные (альфа меньше 8) не в счёт; пустой лист — 0,5. Опора тона «Цвета» вещи и её
 * элемента (`tintPixel`, `ref`): средний пиксель листа становится ровно выбранным цветом, светотень — относительной (ведущая 31.10.2026:
 * белый на тёмной рамке планшета был не виден — опора 0,5 оставляла тёмный лист тёмным). Одна функция у установщика и кадра.
 */
export function meanLuma(rgba) {
  let sum = 0;
  let count = 0;
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    if (rgba[at + 3] < 8) continue;
    sum += luma(rgba[at], rgba[at + 1], rgba[at + 2]);
    count += 1;
  }
  return count ? sum / count / 255 : 0.5;
}

/**
 * Цель перекраски из `#rrggbb`: тон, насыщенность и светлота цвета, который
 * выбрал человек.
 */
export function tintTarget(hex) {
  const [r, g, b] = hexBytes(hex).map((value) => value / 255);
  const [h, s, l] = rgbToHsl(r, g, b);
  return { h, s, l };
}

/**
 * ПЕРЕКРАСКА С СОХРАНЕНИЕМ СВЕТОТЕНИ
 *
 * Текстуры модов маппинга — серые запечённые атласы: в них не цвет, а свет,
 * тень и фактура. Перекраска берёт у пикселя его яркость, а у цвета — тон и
 * насыщенность: пиксель средней яркости набора (`ref`) становится ровно
 * выбранным цветом, светлее — светлее, темнее — темнее. Поэтому бирюзовый
 * ангар остаётся ангаром с тенями и рёбрами, а не плоской бирюзовой коробкой.
 *
 *   k = яркость(пиксель) / ref
 *   светлота = clamp(L_цвета × k × яркость_работы)
 *   пиксель = hsl(H_цвета, S_цвета, светлота), смешанный с исходным по силе
 *
 * `hue` — тон вместо тона цвета (у радуги он свой в каждой точке).
 * `lift` — подъём тёмного (0…1): k = lift + (1 − lift) × яркость / ref.
 * У ноля — прежняя формула. Зданиям (05.10.2026, владелец: «покрасил
 * Мегамолл в синий, часть текстур осталась чёрной») чёрные полосы и
 * простенки листа дают тёмный оттенок цвета, а не чёрное пятно.
 */
export function tintPixel(r, g, b, target, { ref = 0.5, brightness = 1, strength = 1, hue = null, lift = 0 } = {}) {
  const k = lift + (1 - lift) * (luma(r, g, b) / Math.max(0.02, ref));
  const lightness = clamp01(target.l * k * brightness);
  const [tr, tg, tb] = hslToRgb(hue == null ? target.h : hue, target.s, lightness);
  return [r + (tr - r) * strength, g + (tg - g) * strength, b + (tb - b) * strength];
}

/*
 * РАДУГА
 *
 * Тон бежит по развёртке текстуры: `u` и `v` — координаты пикселя в листе
 * (0…1), `scale` — сколько раз спектр укладывается в лист, `phase` — сдвиг.
 * Считается одинаково в шейдере кадра и в пикселях установщика, поэтому
 * полосы радуги в игре лягут там же, где их видно в кадре.
 */
export function rainbowHue(u, v, { scale = 1, phase = 0 } = {}) {
  const t = (u * 0.8 + v * 0.35) * scale + phase;
  return (((t % 1) + 1) % 1) * 360;
}

/** Цвет спектра по доле 0…1: насыщенный, средней светлоты. */
export function spectrumHex(share, { saturation = 0.85, lightness = 0.55 } = {}) {
  const [r, g, b] = hslToRgb(share * 360, saturation, lightness);
  return bytesHex([r * 255, g * 255, b * 255]);
}

/*
 * Ровный цвет вместо текстуры 4×4: у модов завода и запретных зон каждая
 * текстура — одна заливка, и перекраска — это новая заливка.
 */
export function flatTint(hex, target, { ref = 0.5, brightness = 1 } = {}) {
  const [r, g, b] = hexBytes(hex).map((value) => value / 255);
  const out = tintPixel(r, g, b, target, { ref, brightness });
  return bytesHex(out.map((value) => value * 255));
}
