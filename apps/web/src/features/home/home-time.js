/*
 * Время на Главной: «12 минут назад», «сегодня, 12:40», «2 ч 14 мин до обновления подборки».
 * Слова даёт `Intl` на языке окна (ru, uk, en, de, pl, fr), своих таблиц нет. Форматы создаются один раз на язык:
 * создание формата на каждую карточку на старте окна стоило миллисекунды худшего кадра.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LOCALES = new Set(["ru", "uk", "en", "de", "pl", "fr"]);

const formats = new Map();
function formatOf(kind, language, make) {
  const locale = LOCALES.has(language) ? language : "en";
  const id = `${kind}:${locale}`;
  if (!formats.has(id)) formats.set(id, make(locale));
  return formats.get(id);
}

const relative = (language) =>
  formatOf(
    "relative",
    language,
    (locale) => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
  );
const clock = (language) =>
  formatOf(
    "clock",
    language,
    (locale) =>
      new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
  );
const date = (language) =>
  formatOf(
    "date",
    language,
    (locale) =>
      new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
  );

const stamp = (iso) => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
};

/** «сейчас», «12 минут назад», «вчера», «3 дня назад»; позже месяца — дата. Нет метки — пустая строка. */
export function agoText(iso, language, now = Date.now()) {
  const at = stamp(iso);
  if (at === null) return "";
  const gap = Math.max(0, now - at);
  const words = relative(language);
  if (gap < MINUTE) return words.format(0, "second");
  if (gap < HOUR) return words.format(-Math.floor(gap / MINUTE), "minute");
  if (gap < DAY) return words.format(-Math.floor(gap / HOUR), "hour");
  const days = Math.floor(gap / DAY);
  return days < 30 ? words.format(-days, "day") : date(language).format(at);
}

// Номер календарного дня по местному времени: «вчера» — это вчерашнее число, а не «ровно сутки назад».
const dayNumber = (time) =>
  Math.floor((time - new Date(time).getTimezoneOffset() * MINUTE) / DAY);

/** «сегодня, 12:40», «вчера, 12:40», «12 нояб.»; нет метки — пустая строка. */
export function whenText(iso, language, now = Date.now()) {
  const at = stamp(iso);
  if (at === null) return "";
  const back = dayNumber(now) - dayNumber(at);
  if (back < 0 || back > 1) return date(language).format(at);
  return `${relative(language).format(-back, "day")}, ${clock(language).format(at)}`;
}

/** Сколько осталось до следующего окна подборки: часы и минуты (минуты округляются вверх, шестьдесят минут — это час). */
export function leftParts(ms) {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
