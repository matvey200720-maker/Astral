import { tr } from "../../../../locales/ui.js";

// Стороны света для плиток «Свет падает с»: русская «С» занята предлогом,
// поэтому в общий словарь таблица не идёт. У ru записи нет намеренно.
const COMPASS_BY_LANGUAGE = {
  uk: { "З": "З", "СЗ": "ПнЗ", "С": "Пн", "СВ": "ПнС" },
  en: { "З": "W", "СЗ": "NW", "С": "N", "СВ": "NE" },
  de: { "З": "W", "СЗ": "NW", "С": "N", "СВ": "NO" },
  pl: { "З": "Z", "СЗ": "PnZ", "С": "Pn", "СВ": "PnW" },
  fr: { "З": "O", "СЗ": "NO", "С": "N", "СВ": "NE" },
};

// Метка {имя}: при разбиении по этому выражению метки попадают на нечётные места.
const MARK_SPLITTER = /(\{[A-Za-z0-9_]+\})/;

// Текст отказа пакета карты: неизменные куски вокруг двух чисел; ключ словаря — он же.
const LIMIT_KEY = "В наборе {count} — в свой набор помещается до {limit}. Отметьте меньше.";
const LIMIT_PIECES = LIMIT_KEY.split(/\{(?:count|limit)\}/);
const ONLY_DIGITS = /^\d+$/;

const POINTS_TAIL = " · точки";
const PART_GLUE = " · ";

function printable(value) {
  return value === undefined || value === null ? "" : String(value);
}

export function fmt(text, vars = {}) {
  const chunks = String(text).split(MARK_SPLITTER);
  const filled = chunks.map((chunk, at) => {
    if (at % 2 === 0) return chunk;
    const value = vars[chunk.slice(1, -1)];
    return value === undefined || value === null ? chunk : String(value);
  });
  return filled.join("");
}

export function mapText(key, vars) {
  return fmt(tr(key), vars);
}

export function lowerFor(language, text) {
  if (language === "de") return text;
  return String(text).toLocaleLowerCase(language);
}

function translateOne(form) {
  return tr(form);
}

export function trForms(forms) {
  return forms.map(translateOne);
}

export function compassFor(language) {
  const table = COMPASS_BY_LANGUAGE[language];
  if (!table) return {};
  return table;
}

// { count, limit } из точного текста отказа либо null.
function limitsFrom(text) {
  const [opening, between, closing] = LIMIT_PIECES;
  if (!text.startsWith(opening) || !text.endsWith(closing)) return null;
  const numbers = text.slice(opening.length, text.length - closing.length).split(between);
  const exact = numbers.length === 2 && numbers.every((piece) => ONLY_DIGITS.test(piece));
  return exact ? { count: numbers[0], limit: numbers[1] } : null;
}

export function failureText(message) {
  const text = printable(message);
  const limits = limitsFrom(text);
  if (limits === null) return tr(text);
  return mapText(LIMIT_KEY, limits);
}

// Имя набора точек сервера: «<название> · точки», слово «точки» переводится отдельно.
function pointsTitle(text) {
  const cut = text.length - POINTS_TAIL.length;
  if (cut < 0 || text.slice(cut) !== POINTS_TAIL) return null;
  return [tr(text.slice(0, cut)), tr("точки")].join(PART_GLUE);
}

export function setTitle(title) {
  const text = printable(title);
  const forPoints = pointsTitle(text);
  if (forPoints !== null) return forPoints;

  const direct = tr(text);
  if (direct !== text || text.indexOf(PART_GLUE) < 0) return direct;
  return text.split(PART_GLUE).map(translateOne).join(PART_GLUE);
}
