/*
 * Слова каталога «через карандаш» (чистовой набор 2, 15.11.2026): «← Назад к «VEX REDUX»» и «меняем часть «Таймцикл»». Названия в кавычках языка окна; у французского ёлочки с неразрывными
 * пробелами. Шесть языков: ru, uk, en, de, pl, fr. Остальные слова режима — через `tr()` (`locales/ui-text/zone-port-card-1511.js`).
 */

const NBSP = String.fromCharCode(160);

const CODES = ["ru", "uk", "en", "de", "pl", "fr"];

const codeOf = (language) => {
  const code = String(language ?? "ru")
    .slice(0, 2)
    .toLowerCase();
  return CODES.includes(code) ? code : "en";
};

const QUOTES = {
  ru: ["«", "»"],
  uk: ["«", "»"],
  en: ["“", "”"],
  de: ["„", "“"],
  pl: ["„", "”"],
  fr: [`«${NBSP}`, `${NBSP}»`],
};

const BACK = {
  ru: "Назад к",
  uk: "Назад до",
  en: "Back to",
  de: "Zurück zu",
  pl: "Wróć do",
  fr: "Retour à",
};

const REPLACING = {
  ru: "меняем часть",
  uk: "змінюємо частину",
  en: "replacing the part",
  de: "ersetzt wird der Teil",
  pl: "zmieniamy część",
  fr: "remplacement de la partie",
};

const FROM_BUILD = {
  ru: "из сборки",
  uk: "зі збірки",
  en: "from the build",
  de: "aus dem Paket",
  pl: "ze zbioru",
  fr: "de l'assemblage",
};

/** Название в кавычках языка. */
export function quoteName(name, language) {
  const [open, close] = QUOTES[codeOf(language)];
  return `${open}${name}${close}`;
}

/** Слова режима по языку окна; все функции возвращают готовую строку. */
export function pencilCopy(language) {
  const code = codeOf(language);
  return {
    /** «Назад к «VEX REDUX»» */
    back: (name) => `${BACK[code]} ${quoteName(name, code)}`,
    /** «меняем часть «Таймцикл»» */
    replacing: (kind) => `${REPLACING[code]} ${quoteName(kind, code)}`,
    /** «из сборки «ЗАВИСИМОСТЬ REDUX»» */
    fromBuild: (name) => `${FROM_BUILD[code]} ${quoteName(name, code)}`,
  };
}
