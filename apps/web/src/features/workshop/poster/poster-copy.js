/*
 * Слова «Афиши редакторов», которые зависят от числа и языка: «7 редакторов · 4 в игре», «правка 14 ноября».
 * Остальные строки афиши — обычные записи словаря (`locales/ui-text/zone-port-workshop-1511.js`).
 * Языки: ru, uk, en, de, pl, fr; у французского `one` на 0 и 1, остальное `other`.
 */

import { currentUiLanguage } from "../../../locales/ui.js";

const EDITOR_WORDS = {
  ru: { one: "редактор", few: "редактора", many: "редакторов" },
  uk: { one: "редактор", few: "редактори", many: "редакторів" },
  en: { one: "editor", other: "editors" },
  de: { one: "Editor", other: "Editoren" },
  pl: { one: "edytor", few: "edytory", many: "edytorów" },
  fr: { one: "éditeur", other: "éditeurs" },
};

const IN_GAME = {
  ru: "в игре",
  uk: "у грі",
  en: "in game",
  de: "im Spiel",
  pl: "w grze",
  fr: "en jeu",
};

function pluralWord(table, language, count) {
  const category = new Intl.PluralRules(language).select(count);
  const words = table[language] || table.en;
  return words[category] ?? words.other ?? words.many;
}

/** «7 редакторов» / «1 editor». */
export function editorsCountText(count, language = currentUiLanguage()) {
  return `${count} ${pluralWord(EDITOR_WORDS, language, count)}`;
}

/** «7 редакторов · 4 в игре»; без «в игре», если там пусто. */
export function groupSummaryText(
  count,
  installed,
  language = currentUiLanguage(),
) {
  const base = editorsCountText(count, language);
  return installed > 0
    ? `${base} · ${installed} ${IN_GAME[language] || IN_GAME.en}`
    : base;
}
