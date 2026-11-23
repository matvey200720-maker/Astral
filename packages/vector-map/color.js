/*
 * Цвет большой карты: разбор и запись #rrggbb, расстояние в RGB.
 *
 * Мелочь, которой пользуются и поиск цветов карты, и пиксельный конвейер, и
 * готовые текстуры: держать её в трёх копиях — верный способ однажды
 * округлить цвет по-разному в окне и в экспорте.
 */

const HEX = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value) => HEX.test(String(value || ""));

export function hexToRgb(hex) {
  const text = isHexColor(hex) ? String(hex) : "#000000";
  return [
    parseInt(text.slice(1, 3), 16),
    parseInt(text.slice(3, 5), 16),
    parseInt(text.slice(5, 7), 16),
  ];
}

const byte = (value) => Math.max(0, Math.min(255, Math.round(value)));

export function rgbToHex(rgb) {
  return `#${rgb.map((value) => byte(value).toString(16).padStart(2, "0")).join("")}`;
}

export const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Расстояние между двумя цветами RGB 0..255. */
export const colorDistance = (left, right) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
