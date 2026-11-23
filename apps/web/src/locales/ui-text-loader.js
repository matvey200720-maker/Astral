/*
 * Откуда окно берёт куски словаря (бюджет бандла 18.10.2026): по языку — четыре куска (языков шесть
 * с французским, 29.10.2026), плюс один общий список шаблонов. Сами куски собирает `ui-text-plugin.js` из `ui-text/index.js` в виртуальные
 * модули; здесь они названы по одному — буквально, потому что бандлер делит бандл только по
 * `import()` с литералом, а не со склеенной строкой.
 *
 * Файл обычный, а не виртуальный, чтобы `ui.js` грузился и там, где Vite нет (проверки ядра под
 * Node): там источник подставляют явно — `provideUiText` в `ui.js`.
 *
 * Число кусков на язык — `UI_TEXT_SHARDS` (`ui-text-hash.js`); тест сверяет, что здесь их ровно столько.
 */

export const LANGUAGES = Object.freeze(["uk", "en", "de", "pl", "fr"]);

export const PACKS = Object.freeze({
  uk: [
    () => import("virtual:astral-ui-text/pack/uk/0"),
    () => import("virtual:astral-ui-text/pack/uk/1"),
    () => import("virtual:astral-ui-text/pack/uk/2"),
    () => import("virtual:astral-ui-text/pack/uk/3"),
  ],
  en: [
    () => import("virtual:astral-ui-text/pack/en/0"),
    () => import("virtual:astral-ui-text/pack/en/1"),
    () => import("virtual:astral-ui-text/pack/en/2"),
    () => import("virtual:astral-ui-text/pack/en/3"),
  ],
  de: [
    () => import("virtual:astral-ui-text/pack/de/0"),
    () => import("virtual:astral-ui-text/pack/de/1"),
    () => import("virtual:astral-ui-text/pack/de/2"),
    () => import("virtual:astral-ui-text/pack/de/3"),
  ],
  pl: [
    () => import("virtual:astral-ui-text/pack/pl/0"),
    () => import("virtual:astral-ui-text/pack/pl/1"),
    () => import("virtual:astral-ui-text/pack/pl/2"),
    () => import("virtual:astral-ui-text/pack/pl/3"),
  ],
  fr: [
    () => import("virtual:astral-ui-text/pack/fr/0"),
    () => import("virtual:astral-ui-text/pack/fr/1"),
    () => import("virtual:astral-ui-text/pack/fr/2"),
    () => import("virtual:astral-ui-text/pack/fr/3"),
  ],
});

export const TEMPLATES = () => import("virtual:astral-ui-text/templates");
