/*
 * Слова заставки «Контур» (15.11.2026). Русские строки — ключи словаря (`locales/ui-text/zone-port-launch-splash-1511.js`),
 * переводятся в месте показа (`tr`): до смены языка модульные данные ещё русские.
 */

export const STAGE_COUNT = 4;

/** Слова этапов в порядке лучей знака: заголовок и пояснение. Этапы — четыре запроса `loadStartup` (`../startup.js`). */
export const STAGE_WORDS = Object.freeze([
  Object.freeze(["Проверяем вход", "Учётная запись и сессия"]),
  Object.freeze(["Ищем GTA V", "Steam, Epic Games и Rockstar Games"]),
  Object.freeze(["Открываем библиотеку", "Установленные моды и сборки"]),
  Object.freeze(["Загружаем каталог", "Свежие моды, обложки и новости"]),
]);
export const DONE_WORDS = Object.freeze(["Готово", "Открываем Astral"]);
export const LONG_WORDS =
  "Это дольше обычного: сеть отвечает медленно. Astral пробует ещё раз — подождите немного.";
export const WAKE_WORDS = Object.freeze([
  "Просыпаемся…",
  "Возвращаем всё, как было",
]);
export const FAIL_WORDS = Object.freeze({
  kicker: "Ошибка запуска",
  title: "Astral не удалось запустить",
  detail:
    "Локальный сервис приложения не запустился. Закройте другие копии Astral и попробуйте снова.",
  close: "Закрыть Astral",
  support: "Написать в поддержку",
});
