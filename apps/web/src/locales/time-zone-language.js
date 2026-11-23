/*
 * Язык при первом запуске — по часовому поясу системы: он почти всегда
 * совпадает со страной, а сам IP никуда не уходит и чужие сервисы не нужны.
 * Пояс без однозначного языка (вся Америка, Азия кроме СНГ…) — null, тогда
 * остаётся прежний выбор по умолчанию. Тот же список — у сайта
 * (site/src/lib/site-language.js).
 */

const ZONES = Object.freeze({
  uk: ["Europe/Kyiv", "Europe/Kiev", "Europe/Uzhgorod", "Europe/Zaporozhye"],
  pl: ["Europe/Warsaw"],
  fr: ["Europe/Paris", "Europe/Brussels", "Europe/Luxembourg", "Europe/Monaco", "America/Martinique", "America/Guadeloupe", "America/Cayenne", "Indian/Reunion", "Pacific/Tahiti", "Pacific/Noumea"],
  de: ["Europe/Berlin", "Europe/Busingen", "Europe/Vienna", "Europe/Zurich", "Europe/Vaduz"],
  en: ["Europe/London", "Europe/Dublin", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Australia/Sydney"],
});

/* Россия и соседи, где читают по-русски: все пояса Russia/СНГ. */
const RUSSIAN = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Minsk|Simferopol)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Qyzylorda|Aqtobe|Aqtau|Atyrau|Oral|Bishkek|Tashkent|Samarkand|Dushanbe|Ashgabat|Baku|Yerevan|Tbilisi))$/;

const BY_ZONE = new Map(Object.entries(ZONES).flatMap(([language, zones]) => zones.map((zone) => [zone, language])));

/** ru | uk | en | de | pl | fr по поясу IANA или null. */
export function languageFromTimeZone(zone) {
  const value = String(zone || "");
  if (BY_ZONE.has(value)) return BY_ZONE.get(value);
  return RUSSIAN.test(value) ? "ru" : null;
}

/** Пояс этой системы; null, если среда его не называет. */
export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
