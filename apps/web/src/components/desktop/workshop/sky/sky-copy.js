import { counted, FILES } from "../../../../plural.js";
import { tr } from "../../../../locales/ui.js";

// По языку: локаль для числа и склонения, три формы слова «файл»
// (один / несколько / много) и обе фразы. Язык без записи читается как русский.
const SKY_PACKS = {
  uk: {
    locale: "uk-UA",
    forms: ["файл", "файли", "файлів"],
    installed: "Небо встановлено: {value} гри",
    done: "Готово: {value}",
  },
  en: {
    locale: "en-US",
    forms: ["game file", "game files", "game files"],
    installed: "Sky installed: {value}",
    done: "Done: {value}",
  },
  de: {
    locale: "de-DE",
    forms: ["Spieldatei", "Spieldateien", "Spieldateien"],
    installed: "Himmel installiert: {value}",
    done: "Fertig: {value}",
  },
  pl: {
    locale: "pl-PL",
    forms: ["plik", "pliki", "plików"],
    installed: "Niebo zainstalowane: {value} gry",
    done: "Gotowe: {value}",
  },
  fr: {
    locale: "fr-FR",
    forms: ["fichier de jeu", "fichiers de jeu", "fichiers de jeu"],
    installed: "Ciel installé\u00a0: {value}",
    done: "Terminé\u00a0: {value}",
  },
};

// Правила склонения создаются лениво: первое обращение к Intl дорого,
// платить за него должен вызывающий, а не загрузка модуля.
const pluralByLocale = {};

function pluralRulesOf(locale) {
  if (!pluralByLocale[locale]) pluralByLocale[locale] = new Intl.PluralRules(locale);
  return pluralByLocale[locale];
}

const slot = (template, value) => template.replace("{value}", () => String(value));

function numberWithWord(pack, files) {
  const amount = Number(files) || 0;
  const category = pluralRulesOf(pack.locale).select(Math.abs(amount));
  const formIndex = { one: 0, few: 1 }[category] ?? 2;
  return `${new Intl.NumberFormat(pack.locale).format(amount)} ${pack.forms[formIndex]}`;
}

export function skyDoneTextFor(language, files, rainbowText) {
  const pack = Object.hasOwn(SKY_PACKS, language) ? SKY_PACKS[language] : null;
  const rainbow = rainbowText || "";

  if (!files) {
    if (!rainbow) return tr("Небо установлено");
    return pack ? slot(pack.done, rainbow) : `Готово: ${rainbow}`;
  }

  const base = pack
    ? slot(pack.installed, numberWithWord(pack, files))
    : `Небо установлено: ${counted(files, FILES)} игры`;
  return rainbow ? `${base}, ${rainbow}` : base;
}
