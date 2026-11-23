// Цвета килл-эффекта: строки "#rrggbb" <-> доли единицы, смесь и яркость.

const DEFAULT_COLOR = "#000000";

// Ложное значение -> "", остальное -> строка без пробелов по краям.
const cleanText = (input) => (input ? String(input) : "").trim();

const hexDigitValue = (char) => {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
};

// Три байта цвета либо null, если запись не годится.
function parseBytes(input) {
  let body = cleanText(input);
  if (body.startsWith("#")) body = body.slice(1);
  if (body.length !== 3 && body.length !== 6) return null;
  const digits = [];
  for (const char of body) {
    const value = hexDigitValue(char);
    if (value < 0) return null;
    digits.push(value);
  }
  if (digits.length === 3) return digits.map((digit) => digit * 17);
  return [0, 2, 4].map((at) => digits[at] * 16 + digits[at + 1]);
}

// Число из чего угодно: нечисло -> 0, затем в границы [0, 1].
function toUnit(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

const byteHex = (byte) => byte.toString(16).padStart(2, "0");

export function hexToRgb(input) {
  const [r, g, b] = parseBytes(input) ?? [0, 0, 0];
  return { r: r / 255, g: g / 255, b: b / 255 };
}

export function rgbToHex({ r, g, b }) {
  const bytes = [r, g, b].map((share) => Math.round(toUnit(share) * 255));
  return `#${bytes.map(byteHex).join("")}`;
}

export function normalizeHex(input, fallback = DEFAULT_COLOR) {
  const bytes = parseBytes(input);
  return bytes ? `#${bytes.map(byteHex).join("")}` : fallback;
}

export function mixHex(from, to, amount) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const t = toUnit(amount);
  const blend = (key) => start[key] + (end[key] - start[key]) * t;
  return rgbToHex({ r: blend("r"), g: blend("g"), b: blend("b") });
}

export function hexToCss(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  const [red, green, blue] = [r, g, b].map((share) => Math.round(share * 255));
  const opacity = Math.round(toUnit(alpha) * 1000) / 1000;
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export function hexLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
