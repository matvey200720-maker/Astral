/*
 * Слова страницы «Профиль», у которых в общем словаре (`tr`) уже стоит другой смысл:
 * «Значки» там — значки на карте («Icons»), «Контакты» — контакты шин, «Мастерская» — «Studio».
 * Для этих слов своя таблица по языкам, как у `ProfilePanel.jsx`.
 */
import { currentUiLanguage } from "../../locales/ui.js";
import { navigationLabels } from "../../components/desktop/navigation/navigationRail.js";

const WORDS = {
  badges: {
    ru: "Значки",
    uk: "Значки",
    en: "Badges",
    de: "Abzeichen",
    pl: "Odznaki",
    fr: "Badges",
  },
  contacts: {
    ru: "Контакты",
    uk: "Контакти",
    en: "Contacts",
    de: "Kontakte",
    pl: "Kontakty",
    fr: "Contacts",
  },
  mod: { ru: "Мод", uk: "Мод", en: "Mod", de: "Mod", pl: "Mod", fr: "Mod" },
};

/** Слово по ключу на языке окна; чужой язык читается по-английски. */
export function word(key) {
  const table = WORDS[key];
  return table[currentUiLanguage()] || table.en;
}

/** Имя раздела рейки на языке окна (0 — Главная … 6 — Сборки): профиль зовёт страницы теми же словами, что и рейка. */
export function railName(index) {
  return (navigationLabels[currentUiLanguage()] || navigationLabels.en)[index];
}
