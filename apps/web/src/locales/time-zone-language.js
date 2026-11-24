/*
 * Язык первого запуска — одно правило для окна, установщика и сайта:
 * 1) явный выбор человека (сохранённый язык) — всегда главный; язык, показанный установщиком, идёт сразу за ним;
 * 2) язык системы или браузера — первый из списка, который у нас есть;
 * 3) иначе часовой пояс; 4) иначе английский.
 * Здесь п. 2–4 (`firstRunLanguage`, порядок меняется одной строкой), п. 1 проверяет `main.jsx`. Пояс почти всегда совпадает со страной, сам IP никуда не уходит;
 * пояс без однозначного языка (вся Америка, Азия кроме СНГ…) — null. Копия таблицы — у установщика (`apps/beta-installer/ui/js/i18n/zones.js`), список сайта — `site/src/lib/site-language.js`.
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

/** Язык нового профиля (п. 2–4 правила): язык установщика, потом языки системы по порядку, пояс, английский. Сохранённый выбор (п. 1) проверяет вызывающий. */
export function firstRunLanguage({ installer, systems = [], zone } = {}) {
  const ours = (tag) => ["ru", "uk", "en", "de", "pl", "fr"].find((code) => code === String(tag).toLowerCase().split(/[-_]/)[0]);
  return [installer, ...systems].map(ours).find(Boolean) ?? languageFromTimeZone(zone) ?? "en";
}

/** Пояс этой системы; null, если среда его не называет. */
export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
