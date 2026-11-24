import { default as ru } from "./ru.js";
import { default as uk } from "./uk.js";
import { default as en } from "./en.js";
import { default as de } from "./de.js";
import { default as pl } from "./pl.js";
import { default as fr } from "./fr.js";
import { languageFromTimeZone } from "./zones.js";

const DEFAULT_LANGUAGE = "ru";

// Одна строка на язык: код, ярлык в шапке, название в меню, локаль чисел, словарь.
// Русский — запасной язык и эталон набора ключей; французский с 29.10.2026
// (CLAUDE.md, «Локализация»). Ярлыки как на сайте, но короче: там RUS/UA/ENG.
const TABLE = [
  ["ru", "RU", "Русский", "ru-RU", ru],
  ["uk", "UA", "Українська", "uk-UA", uk],
  ["en", "EN", "English", "en-US", en],
  ["de", "DE", "Deutsch", "de-DE", de],
  ["pl", "PL", "Polski", "pl-PL", pl],
  ["fr", "FR", "Français", "fr-FR", fr],
];
const ENTRY_KEYS = ["code", "short", "name", "locale"];

const DICTIONARIES = Object.freeze(Object.fromEntries(TABLE.map((row) => [row[0], row[4]])));

const LANGUAGES = Object.freeze(
  TABLE.map((row) => Object.freeze(Object.fromEntries(ENTRY_KEYS.map((key, at) => [key, row[at]])))),
);

const LOCALES = new Map(LANGUAGES.map((entry) => [entry.code, entry.locale]));

const own = (target, key) => Object.prototype.hasOwnProperty.call(target, key);

// Собственное свойство: имена из прототипа (toString, __proto__) языками не считаются.
const isLanguage = (code) => own(DICTIONARIES, code);

// «ua» понимает только этот выбор (в адресе и хранилище его игнорируют).
const languageOf = (candidate) => {
  const text = String(candidate ?? "").toLowerCase();
  const cut = text.search(/[-_]/);
  const head = cut < 0 ? text : text.slice(0, cut);
  return [head === "ua" ? "uk" : head].find(isLanguage);
};

const pickLanguage = (candidate) => languageOf(candidate) ?? DEFAULT_LANGUAGE;

/*
 * Язык первого запуска — одно правило для окна, установщика и сайта:
 * 1) явный выбор человека (сохранённый язык) — всегда главный; язык, показанный установщиком, идёт сразу за ним;
 * 2) язык системы или браузера — первый из списка, который у нас есть;
 * 3) иначе часовой пояс; 4) иначе английский.
 * Здесь п. 2–4 (`firstLanguage`, порядок меняется одной строкой); п. 1 и `?lang` проверяет `app.js`. Таблица поясов — копия таблицы окна (`zones.js`).
 */
const firstLanguage = ({ systems = [], zone } = {}) => systems.map(languageOf).find(Boolean) ?? languageFromTimeZone(zone) ?? "en";

const localeOf = (code) => LOCALES.get(code) ?? LANGUAGES[0].locale;

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

// Значения не разбираем повторно; `$&` в значении остаётся буквально (замена функцией).
const fill = (text, params) =>
  text.replace(PLACEHOLDER, (_, name) => {
    const value = params[name];
    return value === null || value === undefined ? "" : String(value);
  });

// Цепочка поиска: язык, английский, русский, а нет нигде — сам ключ, чтобы дыру
// было видно на снимке экрана. Пустая строка в словаре — найденный перевод.
const createTranslator = (code) => {
  const chain = [isLanguage(code) ? code : DEFAULT_LANGUAGE, "en", "ru"].map((lang) => DICTIONARIES[lang]);
  const find = (key) => {
    const holder = chain.find((dictionary) => own(dictionary, key));
    return holder ? holder[key] : key;
  };

  return (key, params) => (params ? fill(find(key), params) : find(key));
};

export { DEFAULT_LANGUAGE, DICTIONARIES, LANGUAGES, createTranslator, firstLanguage, isLanguage, localeOf, pickLanguage };
