import { tr } from "../../../locales/ui.js";

// Шаг между единицами 1024 = 2^10, поэтому номер единицы считаем по log2:
// на точных степенях двойки он не промахивается мимо целого.
const BITS_PER_STEP = 10;
const BASE = 2 ** BITS_PER_STEP;
const LAST_UNIT = 4;
// С этого номера (ГБ) у числа появляется один знак после запятой.
const FIRST_FRACTION_UNIT = 3;

// Русские единицы — ключи словаря: перевод берётся при вызове, по языку окна.
const CYRILLIC_UNIT_KEYS = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
const FRENCH_UNITS = ["o", "Ko", "Mo", "Go", "To"];
const LATIN_UNITS = ["B", "KB", "MB", "GB", "TB"];

function unitsFor(language) {
  if (language === "ru" || language === "uk") return CYRILLIC_UNIT_KEYS.map((key) => tr(key));
  return language === "fr" ? FRENCH_UNITS : LATIN_UNITS;
}

const formatterCache = new Map();

// Язык уходит в Intl как есть; кэшируем только строки, чтобы ошибки Intl
// (пустой тег, null) каждый раз возникали заново и не прятались в кэше.
function numberFormatter(language, fractionDigits) {
  const options = { maximumFractionDigits: fractionDigits };
  if (typeof language !== "string") return new Intl.NumberFormat(language, options);
  const key = `${fractionDigits}:${language}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatBytes(size, language = "en") {
  const parsed = Number(size);
  const amount = parsed > 0 ? parsed : 0;
  const rawStep = amount > 0 ? Math.floor(Math.log2(amount) / BITS_PER_STEP) : 0;
  const step = Math.min(LAST_UNIT, Math.max(0, rawStep));
  const scaled = amount / BASE ** step;
  const digits = step >= FIRST_FRACTION_UNIT ? 1 : 0;
  const shown = numberFormatter(language, digits).format(scaled);
  return `${shown} ${unitsFor(language)[step]}`;
}
