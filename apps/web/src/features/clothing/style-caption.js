import { itemName } from "@modovik/clothing/assortment";
import { currentUiLanguage } from "../../locales/ui.js";

/*
 * Подпись плитки «стиль рук» (16.11.2026, необязательно, вместе с группами форм `uppr` в базе серверов): одна плитка — один стиль, под все виды торса; пустое «№N» в подписи не оставляем.
 * Подпись: «Стиль 12 · 5 форм» — номер стиля в разделе (остаток номера группы от 100000, устойчив: группы идут по первой вещи в куске) и число форм группы; если у «лица» группы
 * настоящее имя (не запасное «Руки и перчатки №0.12») — оно. Слова — по языкам прямо здесь, число форм склоняется по правилам языка (`Intl.PluralRules`).
 */
const WORDS = {
  ru: {
    style: "Стиль",
    forms: { one: "форма", few: "формы", many: "форм", other: "форм" },
  },
  uk: {
    style: "Стиль",
    forms: { one: "форма", few: "форми", many: "форм", other: "форм" },
  },
  en: { style: "Style", forms: { one: "form", other: "forms" } },
  de: { style: "Stil", forms: { one: "Form", other: "Formen" } },
  pl: {
    style: "Styl",
    forms: { one: "forma", few: "formy", many: "form", other: "formy" },
  },
  fr: { style: "Style", forms: { one: "forme", other: "formes" } },
};

/* Номера групп серверов (`server-base-format.js`): Majestic с 700000, GTA 5 RP с 800000. Номера таблицы игры меньше — их плитки подписаны, как прежде. */
const SERVER_LOOK_FROM = 700000;
const SERVER_STEP = 100000;

/** Плитка — группа форм сервера (две вещи и больше)? */
export const isStyleTile = (item) =>
  Boolean(item?.look?.forms) &&
  Number(item.look.id) >= SERVER_LOOK_FROM &&
  item.together?.length > 1;

/** Номер стиля в разделе: остаток номера группы от 100000 (группы идут по первой вещи в куске). */
export const styleNumber = (item) => Number(item.look.id) % SERVER_STEP;

/** «Стиль 12 · 5 форм» на языке окна; для плитки не из групп сервера — пустая строка. */
export function styleCaption(item, language = currentUiLanguage()) {
  if (!isStyleTile(item)) return "";
  /* Настоящее имя «лица» — по признаку базы (`fallbackName`: имя запасное, `BASE_FLAGS.fallback`), а не по тексту имени. */
  const face = item.together.find((place) => place.look?.rep);
  if (face?.name && !face.fallbackName) return face.name;
  const words = WORDS[language] || WORDS.ru;
  const count = item.together.length;
  const category = new Intl.PluralRules(
    language in WORDS ? language : "ru",
  ).select(count);
  return `${words.style} ${styleNumber(item)} · ${count} ${words.forms[category] || words.forms.other}`;
}

/** Подпись вещи для окна: стиль рук — по группе, остальное — имя вещи. */
export const tileLabel = (item, translate = (text) => text) =>
  styleCaption(item) || itemName(item, translate, currentUiLanguage());
