// Часовой пояс → язык интерфейса. КОПИЯ таблицы окна лаунчера (`apps/web/src/locales/time-zone-language.js`):
// установщик ставят до лаунчера и не может её импортировать. Совпадение с окном по всем поясам IANA держит
// `tests/installer-ui-i18n.test.js`; правишь здесь — правь там же (и таблицу сайта, `site/src/lib/site-language.js`).
const ZONES = {
  uk: ["Europe/Kyiv", "Europe/Kiev", "Europe/Uzhgorod", "Europe/Zaporozhye"],
  pl: ["Europe/Warsaw"],
  fr: ["Europe/Paris", "Europe/Brussels", "Europe/Luxembourg", "Europe/Monaco", "America/Martinique", "America/Guadeloupe", "America/Cayenne", "Indian/Reunion", "Pacific/Tahiti", "Pacific/Noumea"],
  de: ["Europe/Berlin", "Europe/Busingen", "Europe/Vienna", "Europe/Zurich", "Europe/Vaduz"],
  en: ["Europe/London", "Europe/Dublin", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Australia/Sydney"],
};

// Россия и соседи, где читают по-русски.
const RUSSIAN = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Minsk|Simferopol)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Qyzylorda|Aqtobe|Aqtau|Atyrau|Oral|Bishkek|Tashkent|Samarkand|Dushanbe|Ashgabat|Baku|Yerevan|Tbilisi))$/;

const BY_ZONE = new Map(Object.entries(ZONES).flatMap(([language, zones]) => zones.map((zone) => [zone, language])));

// Язык пояса или null, если пояс не говорит о языке.
export const languageFromTimeZone = (zone) => BY_ZONE.get(String(zone ?? "")) ?? (RUSSIAN.test(String(zone ?? "")) ? "ru" : null);
