/*
 * Полоса длины под фигурами «На сервере» и «У тебя» (дизайн 15.11.2026, макет r8/anim/anim-dur).
 *
 * Длины — настоящие, из данных клипа (`track.clipDuration`, они уже читаются для показа); нет длины — нет и дорожки.
 * Порог «сильно отличается» тот же, что в установке (`apps/desktop/src/animations/ycd-graft.js`): отношение длин больше 2,5 или меньше 0,4.
 * Между ними — «немного отличается» (больше 1,25 или меньше 0,8), иначе длина как на сервере.
 */

/** Отношение длины замены к длине клипа сервера, за которым установка уже говорит «длительность сильно отличается». */
export const FAR_RATIO = 2.5;
export const FAR_RATIO_LOW = 0.4;
const MID_RATIO = 1.25;
const MID_RATIO_LOW = 0.8;

/** `none` — замены нет (или нет длины), иначе `near`, `mid` или `far`. */
export function durationVerdict(server, mine) {
  if (!(server > 0) || !(mine > 0)) return "none";
  const ratio = mine / server;
  if (ratio > FAR_RATIO || ratio < FAR_RATIO_LOW) return "far";
  if (ratio > MID_RATIO || ratio < MID_RATIO_LOW) return "mid";
  return "near";
}

/** Шаг делений шкалы под её длину: полсекунды на коротких клипах, пять секунд на длинных. */
export function rulerStep(end) {
  if (end <= 4) return 0.5;
  if (end <= 8) return 1;
  if (end <= 20) return 2;
  return 5;
}

/** Конец шкалы: ближайшее «круглое» число, не меньше самой длинной дорожки. */
export function rulerEnd(longest) {
  const step = rulerStep(longest);
  return Math.ceil((longest + 0.001) / step) * step;
}

/** Длина шкалы: у пары — по более длинному клипу, у одиночного клипа — на три его повтора, чтобы было видно, как он идёт по кругу. */
export function rulerLength(server, mine) {
  return rulerEnd(
    server > 0 && mine > 0 ? Math.max(server, mine) : (server || mine) * 3,
  );
}

/** Деления шкалы: `[{ at, left }]`, `left` — доля шкалы 0…1. */
export function rulerTicks(end) {
  const step = rulerStep(end);
  const ticks = [];
  for (let index = 0; index * step <= end + 1e-6; index += 1)
    ticks.push({ at: index * step, left: (index * step) / end });
  return ticks;
}

/** Куски одной дорожки: первый настоящий, дальше пунктиром повторы по кругу до конца шкалы. `[{ left, width, first }]`, доли шкалы. */
export function laneSegments(length, end) {
  const segments = [];
  if (!(length > 0) || !(end > 0)) return segments;
  for (
    let start = 0, index = 0;
    start < end - 1e-6;
    start += length, index += 1
  ) {
    segments.push({
      left: start / end,
      width: Math.min(length, end - start) / end,
      first: index === 0,
    });
  }
  return segments;
}

const NUMBER_LOCALE = {
  ru: "ru-RU",
  uk: "uk-UA",
  en: "en-US",
  de: "de-DE",
  pl: "pl-PL",
  fr: "fr-FR",
};
const SECOND_UNIT = { ru: "с", uk: "с", en: "s", de: "s", pl: "s", fr: "s" };

const oneDecimal = (value, language) =>
  new Intl.NumberFormat(NUMBER_LOCALE[language] || "en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(Math.round(value * 10) / 10);

/** «2,4 с» — время на языке окна, одна цифра после запятой, ноль после запятой не пишется. */
export function secondsText(value, language = "ru") {
  return `${oneDecimal(value, language)}\u00a0${SECOND_UNIT[language] || "s"}`;
}

/** «+10,9 с» / «\u221210,9 с»: на сколько замена длиннее клипа сервера. */
export function deltaText(server, mine, language = "ru") {
  const delta = Math.round((mine - server) * 10) / 10;
  return `${delta >= 0 ? "+" : "\u2212"}${secondsText(Math.abs(delta), language)}`;
}
