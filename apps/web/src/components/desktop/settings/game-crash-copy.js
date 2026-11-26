/* locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) написаны в этом файле, словарь `ui-text` ему не нужен. */
/*
 * Уведомление после падения игры на языке окна (владелец, 11.11 и 26.11.2026): игра закрылась с ошибкой, и что делать,
 * если это повторяется. Ни причины, ни догадки о моде здесь нет. Подробностей в окне тоже нет: они уходят в файл
 * «Скачать для тикета». Названия раздела и кнопки — те же, что в окне (`settings-map.js`, `logs-copy.js`; сверяет тест
 * `game-crash-watch.test.jsx`). Текст длиннее 120 знаков: такую всплывашку оболочка держит 7 с, а не 3,2 с.
 */

/* Клиент не определён (`where.unknown` пуст) — скобок нет. */
const inBrackets = (where) => (where ? ` (${where})` : "");

const COPY = {
  ru: {
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "",
    },
    notice: (where) =>
      `Игра закрылась с ошибкой${inBrackets(where)}. Если это повторяется, нажмите «Скачать для тикета» в «Настройки → Логи» и напишите в поддержку.`,
  },
  uk: {
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "",
    },
    notice: (where) =>
      `Гра закрилася з помилкою${inBrackets(where)}. Якщо це повторюється, натисніть «Завантажити для тікета» в «Налаштування → Логи» та напишіть у підтримку.`,
  },
  en: {
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "",
    },
    notice: (where) =>
      `The game closed with an error${inBrackets(where)}. If it keeps happening, click “Download for a ticket” in Settings → Logs and contact support.`,
  },
  de: {
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "",
    },
    notice: (where) =>
      `Das Spiel wurde mit einem Fehler beendet${inBrackets(where)}. Falls das öfter passiert, klicken Sie unter Einstellungen → Protokolle auf „Für ein Ticket herunterladen“ und schreiben Sie dem Support.`,
  },
  pl: {
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "",
    },
    notice: (where) =>
      `Gra zamknęła się z błędem${inBrackets(where)}. Jeśli to się powtarza, kliknij „Pobierz do zgłoszenia” w Ustawienia → Logi i napisz do wsparcia.`,
  },
  fr: {
    where: {
      sp: "GTA V",
      majestic: "Majestic",
      gta5rp: "GTA 5 RP",
      altv: "alt:V",
      unknown: "",
    },
    notice: (where) =>
      `Le jeu s'est fermé avec une erreur${inBrackets(where)}. Si cela se reproduit, cliquez sur «\u00a0Télécharger pour un ticket\u00a0» dans Paramètres → Journaux et écrivez au support.`,
  },
};

export const gameCrashCopyFor = (language) => COPY[language] || COPY.en;
