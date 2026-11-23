/*
 * Цвета света фонарей.
 *
 * Свет задаётся одним цветом на всю работу, а не температурой в кельвинах:
 * человек выбирает «натрий», «холодный LED» или «лиловый», а не 2700 K.
 * Температуры здесь — только подписи к образцам белого, посчитанные той же
 * формулой, что и прежний контракт фонарей (`kelvinToStreetLightRgb`), чтобы
 * «тёплый» и «холодный» в двух редакторах значили одно и то же.
 *
 * `null` вместо цвета — «как в игре»: каждая лампа остаётся своего цвета
 * (у Rockstar их десятки — натриевые, бирюзовые, белые), меняются только
 * яркость, лучи и блики. Это не «белый» и не «средний цвет»: это отказ
 * трогать цвет вовсе.
 */

import { kelvinToStreetLightRgb } from "../index.js";

const HEX = /^#[0-9a-f]{6}$/i;

const kelvinHex = (kelvin) => {
  const { r, g, b } = kelvinToStreetLightRgb(kelvin);
  return rgbToHex({ r, g, b });
};

/** `#RRGGBB` верхним регистром или `null`, если это не цвет. */
export function normalizeHex(value) {
  const text = String(value ?? "").trim();
  if (HEX.test(text)) return text.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(text))
    return `#${[...text.slice(1)].map((c) => c + c).join("")}`.toUpperCase();
  return null;
}

export function hexToRgb(hex) {
  const value = normalizeHex(hex);
  if (!value) throw new TypeError(`Цвет «${hex}» — не #RRGGBB.`);
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const channel = (value) =>
    Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/*
 * Готовые цвета света. Порядок — от привычного городу к необычному: первые
 * пять — белые и натриевые, как бывает в жизни, дальше — цветные.
 *
 * Натрий — цвет самой игры: 255, 104, 0 у `prop_streetlight_01` и соседей.
 * Остальные подобраны так, чтобы лампа оставалась лампой: у цветных нет
 * «чистого» канала в ноль — чистый синий 0,0,255 в игре светит почти чёрным
 * пятном, потому что яркость пятна считается по каналам.
 */
export const LIGHT_SWATCHES = Object.freeze([
  swatch("sodium", "Натрий", "#FF6A00", "Оранжевый свет улиц Лос-Сантоса"),
  swatch("warm", "Тёплый", kelvinHex(2700), "Как лампа накаливания, 2700 K"),
  swatch("neutral", "Белый", kelvinHex(4200), "Нейтральный светодиод, 4200 K"),
  swatch("cold", "Холодный", kelvinHex(6500), "Холодный светодиод, 6500 K"),
  swatch("moon", "Лунный", "#8FB8FF", "Голубоватый ночной свет"),
  swatch("violet", "Лиловый", "#A15CFF", "Фиолетовая ночь"),
  swatch("pink", "Розовый", "#FF5CB0", "Неоновый розовый"),
  swatch("red", "Алый", "#FF2E2E", "Красный свет"),
  swatch("amber", "Янтарь", "#FFB21F", "Жёлтый, как старые фонари"),
  swatch("emerald", "Изумруд", "#2EFF8C", "Зелёный неон"),
  swatch("cyan", "Бирюза", "#2EE6FF", "Бирюзовый LED, как у модели 01b"),
]);

function swatch(id, label, hex, description) {
  return Object.freeze({ id, label, hex: normalizeHex(hex), description });
}

/*
 * РАДУГА
 *
 * «Переливов» — лампы, меняющей цвет во времени, — у игры нет: 28.09.2026
 * на живой GTA V перебраны все режимы мигания лампы (`Flashiness` 0–20) —
 * они гасят, мерцают свечой и огнём, стробят, но цвет у лампы всегда один.
 *
 * Поэтому радуга — пространственная: у каждого вида фонаря свой цвет спектра.
 * Вид узнаётся по «подписи» его лампы — радиусу и показателю затухания: у
 * огней вдали (lodlights) те же числа, что у модели, от которой они
 * построены, и фонарь, приближаясь, не меняет цвета. Самый частый вид
 * получает первый цвет, следующий — второй, и так по кругу.
 */
export const LIGHT_RAINBOW = "rainbow";

export const RAINBOW_COLOURS = Object.freeze(
  ["#FF3B3B", "#FF8A1F", "#FFD21F", "#3BFF6B", "#2EE6FF", "#4C7DFF", "#B85CFF"].map(normalizeHex),
);

/** Подпись лампы: радиус и показатель её (штатных) чисел. */
export function lampSignature(light) {
  const falloff = Math.round(Number(light?.falloff) * 10) / 10;
  const exponent = Math.round(Number(light?.falloffExponent) * 10) / 10;
  return `${falloff}|${exponent}`;
}

/**
 * Цвета радуги по подписям: `lights` — все лампы моделей, которые правит
 * работа, `first` — подпись, которой отдать первый цвет. Возвращает
 * `Map(подпись → #RRGGBB)`; порядок — первая, затем от самого частого вида,
 * при равенстве — по подписи, чтобы одна игра давала одну радугу.
 */
export function rainbowPalette(lights, first = null) {
  const counts = new Map();
  for (const light of lights || []) {
    const key = lampSignature(light);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const ordered = [...counts.entries()].sort(
    (a, b) =>
      (b[0] === first) - (a[0] === first) || b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  return new Map(ordered.map(([key], index) => [key, RAINBOW_COLOURS[index % RAINBOW_COLOURS.length]]));
}

/** Цвет работы: `#RRGGBB`, «радуга» или `null` («как в игре»). */
export function normalizeLightColour(value) {
  if (value === LIGHT_RAINBOW) return LIGHT_RAINBOW;
  return value == null ? null : normalizeHex(value);
}

/** Быстрые цвета частиц: живые цвета бабочек, лепестков и светлячков. */
export const PARTICLE_SWATCHES = Object.freeze([
  "#FFFFFF",
  "#FFD166",
  "#FF8A3D",
  "#FF4D6D",
  "#FF7AD9",
  "#B983FF",
  "#5AA9FF",
  "#4DFFB8",
  "#C8FF4D",
]);

/** Готовый цвет по его значению — для подписи «Натрий», а не «#FF6A00». */
export function swatchFor(hex) {
  const value = normalizeHex(hex);
  return LIGHT_SWATCHES.find((item) => item.hex === value) || null;
}

/**
 * Яркость цвета по восприятию (Rec. 709), 0…1. Нужна, чтобы очень тёмный
 * цвет, выбранный пипеткой, не превращал фонарь в погасший: у игры яркость
 * пятна света — это цвет, умноженный на силу.
 */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
