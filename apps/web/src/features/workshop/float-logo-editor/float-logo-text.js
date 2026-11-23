import { tr } from "../../../locales/ui.js";

const NBSP = String.fromCharCode(0xa0);
const TIMES = "×";

// Порог километров, множитель точек экрана и предел, ниже которого лого не видно.
const KM_FROM = 1000;
const SCREEN_POINTS_PER_UNIT = 1500;
const MIN_VISIBLE_POINTS = 6;

export const FLOAT_LOGO_SWATCHES = Object.freeze([
  "#00e0ff",
  "#ff3df2",
  "#ffd400",
  "#ffffff",
  "#22d36b",
  "#ff4d4d",
  "#8b5cff",
  "#ff8a1f",
]);

// Число с заданным количеством знаков: лишние нули не дописываются, запятая
// вместо точки. Нечисловой вход приводится умножением, NaN и Infinity остаются словами.
function decimal(value, places) {
  const scale = 10 ** places;
  return String(Math.round(value * scale) / scale).replace(".", ",");
}

export const metresText = (value) => `${decimal(value, 1)} ${tr("м")}`;

export const glowText = (value) => decimal(value, 1);

export const speedText = (value) => TIMES + decimal(value, 2);

export const percentText = (value) => Math.round(value) + NBSP + "%";

export function distanceText(value) {
  // Порог сравнивается до округления: 999,6 м остаётся «1000 м».
  if (!(value >= KM_FROM)) return `${Math.round(value)} ${tr("м")}`;
  return `${decimal(value / KM_FROM, 1)} ${tr("км")}`;
}

export function distanceWarning(size, range) {
  const points = (size / range) * SCREEN_POINTS_PER_UNIT;
  if (!(points < MIN_VISIBLE_POINTS)) return "";
  return tr("На такой дистанции лого меньше нескольких точек экрана — сделайте его больше или ближе.");
}
