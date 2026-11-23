/*
 * Слова корзины, которые зависят от числа («N вещей одежды ждут выбора цели»), — функцией по языку, как `features/reshade/reshade-copy.js`: падеж и число у каждого языка свои
 * (`Intl.PluralRules`; у французского `one` для 0 и 1). Остальные строки корзины — словарь (`locales/ui-text/zone-cart-1611.js`).
 * Кавычки у языков свои; у французского неразрывный пробел внутри «…» и перед двоеточием — только escape (`\u00a0`).
 */

/** `{n}` — число вещей одежды. Формы по категориям `Intl.PluralRules`; нет нужной — `other`. */
const CLOTHING_WAITING = {
  ru: {
    one: "{n} вещь одежды ждёт выбора цели — нажмите «Установить» у неё.",
    few: "{n} вещи одежды ждут выбора цели — нажмите «Установить» у каждой.",
    many: "{n} вещей одежды ждут выбора цели — нажмите «Установить» у каждой.",
    other: "{n} вещи одежды ждут выбора цели — нажмите «Установить» у каждой.",
  },
  uk: {
    one: "{n} річ одягу чекає вибору цілі — натисніть «Встановити» біля неї.",
    few: "{n} речі одягу чекають вибору цілі — натисніть «Встановити» біля кожної.",
    many: "{n} речей одягу чекають вибору цілі — натисніть «Встановити» біля кожної.",
    other:
      "{n} речі одягу чекають вибору цілі — натисніть «Встановити» біля кожної.",
  },
  en: {
    one: "{n} clothing item is waiting for a target — press “Install” on it.",
    other:
      "{n} clothing items are waiting for a target — press “Install” on each.",
  },
  de: {
    one: "{n} Kleidungsstück wartet auf die Zielwahl – tippe bei ihm auf „Installieren“.",
    other:
      "{n} Kleidungsstücke warten auf die Zielwahl – tippe bei jedem auf „Installieren“.",
  },
  pl: {
    one: "{n} element odzieży czeka na wybór celu — naciśnij „Zainstaluj” przy nim.",
    few: "{n} elementy odzieży czekają na wybór celu — naciśnij „Zainstaluj” przy każdym.",
    many: "{n} elementów odzieży czeka na wybór celu — naciśnij „Zainstaluj” przy każdym.",
    other:
      "{n} elementu odzieży czeka na wybór celu — naciśnij „Zainstaluj” przy każdym.",
  },
  fr: {
    one: "{n} vêtement attend le choix de la cible — appuyez sur «\u00a0Installer\u00a0» sur sa ligne.",
    other:
      "{n} vêtements attendent le choix de la cible — appuyez sur «\u00a0Installer\u00a0» sur chaque ligne.",
  },
};

/** Сборки и работы: числа в слове нет, форма одна. */
const CARDS_WAITING = {
  ru: "Сборки и работы ставятся со своей карточки: «Установить» у такой позиции открывает её.",
  uk: "Збірки й роботи встановлюються зі своєї картки: «Встановити» біля такої позиції відкриває її.",
  en: "Bundles and works are installed from their own card: “Install” on such an item opens it.",
  de: "Pakete und Arbeiten werden auf ihrer eigenen Karte installiert: „Installieren“ bei so einer Position öffnet sie.",
  pl: "Zestawy i prace instaluje się z własnej karty: „Zainstaluj” przy takiej pozycji otwiera ją.",
  fr: "Les builds et les travaux s’installent depuis leur propre fiche\u00a0: «\u00a0Installer\u00a0» sur une telle ligne l’ouvre.",
};

/** Работы мастерской: файлы уже на компьютере, качать нечего. */
const WORKS_WAITING = {
  ru: "Работы мастерской уже на компьютере, качать нечего: ставьте их кнопкой «Установить» у самой работы.",
  uk: "Роботи майстерні вже на комп’ютері, завантажувати нічого: встановлюйте їх кнопкою «Встановити» біля самої роботи.",
  en: "Workshop works are already on your computer, nothing to download: install them with the “Install” button on the work itself.",
  de: "Werkstattarbeiten liegen schon auf deinem Rechner, es gibt nichts herunterzuladen: installiere sie mit „Installieren“ bei der Arbeit selbst.",
  pl: "Prace warsztatu są już na komputerze, nie ma czego pobierać: instaluj je przyciskiem „Zainstaluj” przy samej pracy.",
  fr: "Les travaux de l’atelier sont déjà sur l’ordinateur, rien à télécharger\u00a0: installez-les avec «\u00a0Installer\u00a0» sur le travail lui-même.",
};

const rulesFor = (language) => {
  try {
    return new Intl.PluralRules(language);
  } catch {
    return new Intl.PluralRules("en");
  }
};

/**
 * Что сказать после «Скачать всё», когда часть позиций молча не ставится: `clothing` — вещей одежды (и работ одежды), `cards` — сборок и работ каталога, `works` — работ мастерской
 * (число — только у одежды).
 * Пустая строка — говорить нечего.
 */
export function choiceWaitingText(
  language,
  { clothing = 0, cards = 0, works = 0 } = {},
) {
  const code = Object.hasOwn(CLOTHING_WAITING, language) ? language : "en";
  const parts = [];
  if (clothing > 0) {
    const forms = CLOTHING_WAITING[code];
    const phrase = forms[rulesFor(code).select(clothing)] ?? forms.other;
    parts.push(phrase.replace("{n}", String(clothing)));
  }
  if (cards > 0) parts.push(CARDS_WAITING[code]);
  if (works > 0) parts.push(WORKS_WAITING[code]);
  return parts.join(" ");
}
