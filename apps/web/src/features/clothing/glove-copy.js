/*
 * Слова про формы перчатки мода на группах сервера (правило общей ведущей, 16.11.2026): числа склоняются функцией словаря по языку (`Intl.PluralRules`, у французского `one` для 0 и 1), а не склейкой «число + слово».
 * Таблицы с русским текстом переводятся в месте показа: язык берётся на момент вызова.
 */
import { currentUiLanguage } from "../../locales/ui.js";

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
const NBSP = "\u00a0";

const rule = (language) =>
  new Intl.PluralRules(LANGUAGES.includes(language) ? language : "ru");
const lang = (language) => (LANGUAGES.includes(language) ? language : "ru");

/* «из M форм»: родительный падеж после «из» — у 1, 21, 31… «формы», у остальных «форм» (ru, uk); en/de — по `one`; pl — «z 1 formy», дальше «form»; fr — слово при числе N (0 и 1 — «forme»). */
const FORMS_OF = {
  ru: (m) => (m % 10 === 1 && m % 100 !== 11 ? "формы" : "форм"),
  uk: (m) => (m % 10 === 1 && m % 100 !== 11 ? "форми" : "форм"),
  en: (m) => (m === 1 ? "form" : "forms"),
  de: (m) => (m === 1 ? "Form" : "Formen"),
  pl: (m) => (m === 1 ? "formy" : "form"),
  fr: (n) => (rule("fr").select(n) === "one" ? "forme" : "formes"),
};

/** «Подойдёт к N из M форм; остальные останутся как в игре» — когда часть форм цели без места в блоке (формы сервера в одной плитке с формами игры). */
export function fitsLine(count, total, language = currentUiLanguage()) {
  const code = lang(language);
  const n = Number(count);
  const m = Number(total);
  if (code === "fr")
    return `Convient à ${n} ${FORMS_OF.fr(n)} sur ${m}${NBSP}; les autres restent comme dans le jeu`;
  const word = FORMS_OF[code](m);
  if (code === "uk")
    return `Підійде до ${n} з ${m} ${word}; решта залишиться як у грі`;
  if (code === "en")
    return `Fits ${n} of ${m} ${word}; the rest stay as in the game`;
  if (code === "de")
    return `Passt zu ${n} von ${m} ${word}; die übrigen bleiben wie im Spiel`;
  if (code === "pl")
    return `Pasuje do ${n} z ${m} ${word}; pozostałe zostają jak w grze`;
  return `Подойдёт к ${n} из ${m} ${word}; остальные останутся как в игре`;
}

/*
 * Блок «набор перчаток здесь не встанет» (серверные группы без вида руки): заголовок, причина и выход, число не предложенных стилей. `server` — название проекта вкладки («Majestic», «GTA 5 RP»).
 * Показывается вместо пустого списка (значок, заголовок, причина — как «Astral пока не знает вещей этого вида») или строкой над списком, если часть плиток всё же предложена.
 */
const BLOCK = {
  ru: {
    title: "Здесь этот набор перчаток не встанет",
    reason: (server) =>
      `Набор перчаток ставится по видам рук, а у вещей ${server} вид руки неизвестен.`,
    exit: "Выберите перчатки на вкладке «GTA»: там набор встаёт по видам рук.",
    count: (n) => `Не предложено стилей: ${n}.`,
  },
  uk: {
    title: "Тут цей набір рукавичок не стане",
    reason: (server) =>
      `Набір рукавичок ставиться за видами рук, а в речей ${server} вид руки невідомий.`,
    exit: "Оберіть рукавички на вкладці «GTA»: там набір стає за видами рук.",
    count: (n) => `Не запропоновано стилів: ${n}.`,
  },
  en: {
    title: "This glove set won't fit here",
    reason: (server) =>
      `A glove set is applied by hand type, and the hand type of ${server} items is unknown.`,
    exit: "Pick the gloves on the “GTA” tab: there the set follows the hand types.",
    count: (n) => `Styles not offered: ${n}.`,
  },
  de: {
    title: "Dieses Handschuh-Set passt hier nicht",
    reason: (server) =>
      `Ein Handschuh-Set wird nach Handtyp gesetzt, und bei ${server}-Teilen ist der Handtyp unbekannt.`,
    exit: "Wähle die Handschuhe im Tab „GTA“: Dort folgt das Set den Handtypen.",
    count: (n) => `Nicht angebotene Stile: ${n}.`,
  },
  pl: {
    title: "Ten zestaw rękawic tu nie pasuje",
    reason: (server) =>
      `Zestaw rękawic jest nakładany według typów rąk, a dla elementów ${server} typ ręki jest nieznany.`,
    exit: "Wybierz rękawice na karcie „GTA”: tam zestaw dopasowuje się do typów rąk.",
    count: (n) => `Niezaproponowane style: ${n}.`,
  },
  fr: {
    title: "Cet ensemble de gants ne s’applique pas ici",
    reason: (server) =>
      `Un ensemble de gants s’applique selon le type de main, et le type de main des objets ${server} est inconnu.`,
    exit: `Choisissez les gants dans l’onglet «${NBSP}GTA${NBSP}»${NBSP}: là, l’ensemble suit les types de main.`,
    count: (n) => `Styles non proposés${NBSP}: ${n}.`,
  },
};

/** Части блока на языке окна: `{ title, reason, exit, count }` — готовые строки. */
export function noFormsBlock(server, count, language = currentUiLanguage()) {
  const words = BLOCK[lang(language)];
  return {
    title: words.title,
    reason: words.reason(server),
    exit: words.exit,
    count: words.count(Number(count)),
  };
}

/** Одной строкой над списком: причина, выход, число. */
export function noFormsLine(server, count, language = currentUiLanguage()) {
  const {
    reason,
    exit,
    count: counted,
  } = noFormsBlock(server, count, language);
  return `${reason} ${exit} ${counted}`;
}
