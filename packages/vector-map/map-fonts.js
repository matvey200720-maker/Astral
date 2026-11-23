// Шрифты надписей большой карты: список, переезд прежних имён и «свой шрифт подписи».
// Файлы шрифтов подключаются под именами гарнитур «Astral Map …», чтобы системный
// шрифт с тем же названием не подменил проектный.

const SYSTEM_STACK = ["'Segoe UI'", "'Helvetica Neue'", "Arial", "sans-serif"];
const MONO_STACK = ["Consolas", "monospace"];
const CUSTOM_PREFIX = "custom:";
const MAX_KEY_LENGTH = 128;
// запрещены в ключе: управляющие знаки (код ниже 32), двойная и одинарная кавычки, обратная косая
const FORBIDDEN_CODES = new Set([34, 39, 92]);

// id, название, [наименьшее, наибольшее начертание], пояснение
const FONT_ROWS = [
  ["golos", "Golos", [400, 900], "Плотный гротеск для районов и меток"],
  ["inter", "Inter", [100, 900], "Ровный и спокойный, как подписи игры"],
  ["manrope", "Manrope", [200, 800], "Округлый, современный"],
  ["unbounded", "Unbounded", [200, 900], "Широкий плакатный"],
  ["jetbrains", "JetBrains Mono", [100, 800], "Моноширинный: номера и коды"],
  ["montserrat", "Montserrat", [700, 900], "Широкий плакатный, как на картах МЦЛ"],
];

const toFont = ([id, title, weights, note]) => {
  const face = `Astral Map ${title}`;
  const stack = id === "jetbrains" ? MONO_STACK : SYSTEM_STACK;
  const font = {
    id,
    title,
    family: [`'${face}'`, ...stack].join(", "),
    face,
    weights: Object.freeze(weights.slice()),
    note,
  };
  return Object.freeze(font);
};

export const MAP_FONTS = Object.freeze(FONT_ROWS.map(toFont));

export const MAP_FONT_MAP = Object.freeze(Object.assign({}, ...MAP_FONTS.map((font) => ({ [font.id]: font }))));

export const DEFAULT_MAP_FONT = FONT_ROWS[0][0];

export const LEGACY_EMBLEM_FONTS = Object.freeze({
  display: "golos",
  heavy: "golos",
  condensed: "inter",
  stock: "inter",
  astral: "inter",
  wide: "unbounded",
  mono: "jetbrains",
});

// Ложное значение — пустая строка, остальное — как его приводит String.
const asText = (value) => (value ? String(value) : "");

// Правила ключа: каждое получает ключ без приставки.
const KEY_RULES = [
  (key) => key.length > 0,
  (key) => key.length <= MAX_KEY_LENGTH,
  (key) => Array.from(key, (ch) => ch.charCodeAt(0)).every((code) => code > 31 && !FORBIDDEN_CODES.has(code)),
];

export const customLabelFontKey = (value) => {
  const text = asText(value);
  const key = text.slice(CUSTOM_PREFIX.length);
  const prefixed = text.slice(0, CUSTOM_PREFIX.length) === CUSTOM_PREFIX;
  return prefixed && KEY_RULES.every((rule) => rule(key)) ? key : "";
};

export const isCustomLabelFont = (value) => customLabelFontKey(value) !== "";

// Имя шрифта надписи: слово custom и id списка остаются, прежнее имя переезжает, остальное — шрифт по умолчанию.
const EMBLEM_STEPS = [
  (name) => (name === "custom" || MAP_FONT_MAP[name] ? name : null),
  (name) => LEGACY_EMBLEM_FONTS[name] || null,
];

export const mapEmblemFont = (value) => {
  const name = asText(value);
  return EMBLEM_STEPS.reduce((found, step) => found ?? step(name), null) ?? DEFAULT_MAP_FONT;
};
