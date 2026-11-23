import { currentUiLanguage } from "../../locales/ui.js";

// У языка либо четыре формы (one, few, many, other), либо две (one, other).
const FORM_KEYS_FOUR = ["one", "few", "many", "other"];
const FORM_KEYS_TWO = ["one", "other"];

// Строка таблицы — массив слов по порядку ключей форм; порядок языков сохраняется.
function wordTable(rows) {
  const table = {};
  for (const [language, words] of Object.entries(rows)) {
    const keys = words.length === FORM_KEYS_FOUR.length ? FORM_KEYS_FOUR : FORM_KEYS_TWO;
    table[language] = Object.fromEntries(keys.map((key, index) => [key, words[index]]));
  }
  return Object.freeze(table);
}

export const BOARD_WORDS = wordTable({
  ru: ["щит", "щита", "щитов", "щита"],
  uk: ["щит", "щити", "щитів", "щита"],
  en: ["billboard", "billboards"],
  de: ["Billboard", "Billboards"],
  pl: ["billboard", "billboardy", "billboardów", "billboardu"],
  fr: ["panneau", "panneaux"],
});

export const CANVAS_WORDS = wordTable({
  ru: ["полотно", "полотна", "полотен", "полотна"],
  uk: ["полотно", "полотна", "полотен", "полотна"],
  en: ["banner", "banners"],
  de: ["Banner", "Banner"],
  pl: ["płótno", "płótna", "płócien", "płótna"],
  fr: ["bannière", "bannières"],
});

export const FLAG_WORDS = wordTable({
  ru: ["флаг", "флага", "флагов", "флага"],
  uk: ["прапор", "прапори", "прапорів", "прапора"],
  en: ["flag", "flags"],
  de: ["Fahne", "Fahnen"],
  pl: ["flaga", "flagi", "flag", "flagi"],
  fr: ["drapeau", "drapeaux"],
});

export const KIND_WORDS = wordTable({
  ru: ["вид", "вида", "видов", "вида"],
  uk: ["вид", "види", "видів", "виду"],
  en: ["kind", "kinds"],
  de: ["Art", "Arten"],
  pl: ["rodzaj", "rodzaje", "rodzajów", "rodzaju"],
  fr: ["type", "types"],
});

export const THING_WORDS = wordTable({
  ru: ["вещь", "вещи", "вещей", "вещи"],
  uk: ["річ", "речі", "речей", "речі"],
  en: ["item", "items"],
  de: ["Gegenstand", "Gegenstände"],
  pl: ["rzecz", "rzeczy", "rzeczy", "rzeczy"],
  fr: ["objet", "objets"],
});

const pluralRulesByLanguage = new Map();

function pluralRulesFor(language) {
  let rules = pluralRulesByLanguage.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRulesByLanguage.set(language, rules);
  }
  return rules;
}

// «3 флага»: форму слова выбирает правило множественного числа того языка,
// чья таблица взята; язык без таблицы читается как русский вместе с правилом.
export function countedIn(count, forms) {
  const wanted = currentUiLanguage();
  const own = forms[wanted];
  const language = own ? wanted : "ru";
  const words = own || forms.ru;

  const magnitude = Math.abs(Number(count)) || 0;
  const category = pluralRulesFor(language).select(magnitude);
  const word = words[category] ?? words.other ?? words.many;

  return `${count} ${word}`;
}
