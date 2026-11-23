/*
 * Слова новой карточки ганпака и редукса, которые зависят от числа или падежа (Каталог 2.0, часть 2, 13.11.2026): «18 стволов», «отмечено 14»,
 * «Установить 14 из 18», «12,4 тыс. установок», «обновлён 2 ноября». Шесть языков окна: ru, uk, en, de, pl, fr. Остальные слова карточки — через `tr()`
 * (`locales/ui-text/zone-catalog2-card.js`). Французский: `one` — для 0 и 1, остальное `other` (`Intl.PluralRules("fr")`); двоеточие — с неразрывным пробелом.
 */

const NBSP = String.fromCharCode(160);

const CODES = ["ru", "uk", "en", "de", "pl", "fr"];
const LOCALES = {
  ru: "ru-RU",
  uk: "uk-UA",
  en: "en-US",
  de: "de-DE",
  pl: "pl-PL",
  fr: "fr-FR",
};

const codeOf = (language) => {
  const code = String(language ?? "ru")
    .slice(0, 2)
    .toLowerCase();
  return CODES.includes(code) ? code : "en";
};

/** Форма слова по числу: у ru и uk — `one / few / many`, у pl — то же, у en, de, fr — `one / other`. */
export function pluralForm(language, count) {
  const code = codeOf(language);
  const rules = new Intl.PluralRules(LOCALES[code]);
  const category = rules.select(Math.abs(Number(count) || 0));
  return category === "one" || category === "few" || category === "many"
    ? category
    : "other";
}

// Слово по числу: у языка две формы (`one`, `other`) или три (`one`, `few`, `many`).
const word = (forms, language, count) => {
  const form = pluralForm(language, count);
  return forms[form] ?? forms.many ?? forms.other;
};

const FORMS = {
  weapons: {
    ru: { one: "ствол", few: "ствола", many: "стволов" },
    uk: { one: "ствол", few: "стволи", many: "стволів" },
    en: { one: "weapon", other: "weapons" },
    de: { one: "Waffe", other: "Waffen" },
    pl: { one: "broń", few: "bronie", many: "broni" },
    fr: { one: "arme", other: "armes" },
  },
  installs: {
    ru: { one: "установка", few: "установки", many: "установок" },
    uk: { one: "встановлення", few: "встановлення", many: "встановлень" },
    en: { one: "install", other: "installs" },
    de: { one: "Installation", other: "Installationen" },
    pl: { one: "instalacja", few: "instalacje", many: "instalacji" },
    fr: { one: "installation", other: "installations" },
  },
};

const MARKED = {
  ru: "отмечено",
  uk: "позначено",
  en: "selected",
  de: "ausgewählt",
  pl: "zaznaczono",
  fr: "sélection",
};
// «Установить 14 из 18»: у каждого языка своя фраза, а не склейка слов (в немецком число идёт впереди).
const INSTALL_SOME = {
  ru: (marked, total) => `Установить ${marked} из ${total}`,
  uk: (marked, total) => `Встановити ${marked} з ${total}`,
  en: (marked, total) => `Install ${marked} of ${total}`,
  de: (marked, total) => `${marked} von ${total} installieren`,
  pl: (marked, total) => `Zainstaluj ${marked} z ${total}`,
  fr: (marked, total) => `Installer ${marked} sur ${total}`,
};
const UPDATED = {
  ru: "обновлён",
  uk: "оновлено",
  en: "updated",
  de: "aktualisiert am",
  pl: "zaktualizowano",
  fr: "mis à jour le",
};

/** Число компактно по правилам языка: «12,4 тыс.», «1.2K». Малые числа — как есть. */
export function compactNumber(value, language) {
  const locale = LOCALES[codeOf(language)];
  const number = Number(value) || 0;
  return new Intl.NumberFormat(
    locale,
    number >= 1000
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { maximumFractionDigits: 0 },
  ).format(number);
}

/** Слова карточки по языку окна. Все функции возвращают готовую строку. */
export function cardWideCopy(language) {
  const code = codeOf(language);
  const colon = code === "fr" ? `${NBSP}: ` : ": ";
  return {
    /** «18 стволов» */
    weapons: (count) => `${count} ${word(FORMS.weapons[code], code, count)}`,
    /** «18 · отмечено 14» */
    headCount: (total, marked) =>
      `${total} · ${MARKED[code]}${code === "fr" ? colon : " "}${marked}`,
    /** «Установить 14 из 18» */
    installSome: INSTALL_SOME[code],
    /** «12,4 тыс. установок» */
    installs: (count) =>
      `${compactNumber(count, code)} ${word(FORMS.installs[code], code, count)}`,
    /** «обновлён 2 ноября» */
    updated: (date) => `${UPDATED[code]} ${date}`,
    /** «Автор: @nightz» */
    author: (label, name) => `${label}${colon}${name}`,
  };
}
