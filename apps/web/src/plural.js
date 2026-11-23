/*
 * Склонение после числа — одно на всё окно, по правилу языка окна.
 *
 * Его успели написать четыре раза: в подписях арены, в модели HUD, в
 * редакторе большой карты и на доске оптимизации. Три сигнатуры, два разных
 * контракта возврата (где-то слово, где-то «число слово») и один и тот же
 * десяток строк арифметики. Расходиться им было негде только потому, что до
 * пятого раза никто не дошёл, — а пятым стала студия звука, где «34 дорожек»
 * читается как недоделка ровно так же, как «1 мазков» под картой.
 *
 * Правило берётся у `Intl.PluralRules` языка окна, а не пишется руками: у
 * русского три формы и исключение на 11–14, у польского и украинского свои
 * «несколько», у английского и немецкого две формы, у французского «один» для
 * 0 и 1. Формы приходят уже переведёнными тремя строками (`[один, несколько,
 * много]`): у языков с двумя формами вторая и третья совпадают. Язык читается
 * при каждом вызове, поэтому смена языка на лету работает без перезагрузки.
 */

import { currentUiLanguage } from "./locales/ui.js";

const LOCALES = {
  ru: "ru-RU",
  uk: "uk-UA",
  en: "en-US",
  de: "de-DE",
  pl: "pl-PL",
  fr: "fr-FR",
};

/* Объекты `Intl` — при первом обращении к языку, а не при загрузке модуля (30.10.2026, главный модуль): первый из них поднимает данные ICU (~12 мс при ×4 в задаче главного модуля), и платит за это тот, кто загружается первым. */
const rulesByLanguage = new Map();
const formatsByLanguage = new Map();

function localeOfWindow() {
  const language = currentUiLanguage();
  return Object.hasOwn(LOCALES, language) ? language : "ru";
}

function rules() {
  const language = localeOfWindow();
  let value = rulesByLanguage.get(language);
  if (!value) {
    value = new Intl.PluralRules(LOCALES[language]);
    rulesByLanguage.set(language, value);
  }
  return value;
}

function numbers() {
  const language = localeOfWindow();
  let value = formatsByLanguage.get(language);
  if (!value) {
    value = new Intl.NumberFormat(LOCALES[language]);
    formatsByLanguage.set(language, value);
  }
  return value;
}

/**
 * Форма слова по числу.
 *
 * @param {number} count
 * @param {[string, string, string]} forms — «дорожка», «дорожки», «дорожек»
 */
export function pluralWord(count, [one, few, many]) {
  switch (rules().select(Math.abs(Number(count) || 0))) {
    case "one":
      return one;
    case "few":
      return few;
    default:
      return many;
  }
}

/** Число со словом и разрядами языка окна: «1 234 дорожки», «1,234 tracks». */
export const counted = (count, forms) =>
  `${numbers().format(Number(count) || 0)} ${pluralWord(count, forms)}`;

/* Слова, которые в окне встречаются не по одному разу. */
export const TRACKS = Object.freeze(["дорожка", "дорожки", "дорожек"]);
export const BANKS = Object.freeze(["банк", "банка", "банков"]);
export const FILES = Object.freeze(["файл", "файла", "файлов"]);
