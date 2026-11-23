// apps/desktop/src/startup-failure-words.js
// Окна «Astral не удалось открыть» и «Astral не удалось запустить» (срыв старта до главного окна) на шести языках
// и короткая строка причины. Язык — системный (`app.getLocale()`), как у окон доступа беты: окно с интерфейсом ещё
// не поднято, его язык читать неоткуда. Модуль без побочных действий: окно показывает `showStartupFailure`.

import { BETA_LANGUAGES, pickBetaLanguage } from "./beta/messages.js";

/** Виды срыва: `open` — интерфейс не загрузился в окно, `start` — локальный сервис приложения не поднялся. */
export const STARTUP_FAILURE_KINDS = Object.freeze(["open", "start"]);

const REASON_LIMIT = 160;
// Неразрывный пробел во французском тексте перед «:» — только escape, не символом.
const FR_NBSP = "\u00A0";

// Таблица «вид → язык → [заголовок, текст]».
const WORDS = {
  open: {
    ru: ["Astral не удалось открыть", "Локальный интерфейс не загрузился. Перезапустите приложение."],
    uk: ["Astral не вдалося відкрити", "Локальний інтерфейс не завантажився. Перезапустіть застосунок."],
    en: ["Astral could not open", "The local interface did not load. Restart the app."],
    de: ["Astral konnte nicht geöffnet werden", "Die lokale Oberfläche wurde nicht geladen. Starte die App neu."],
    pl: ["Nie udało się otworzyć Astral", "Lokalny interfejs się nie załadował. Uruchom aplikację ponownie."],
    fr: ["Impossible d’ouvrir Astral", "L’interface locale ne s’est pas chargée. Redémarrez l’application."],
  },
  start: {
    ru: ["Astral не удалось запустить", "Локальный сервис приложения не запустился. Закройте другие копии Astral и попробуйте снова."],
    uk: ["Astral не вдалося запустити", "Локальний сервіс застосунку не запустився. Закрийте інші копії Astral і спробуйте знову."],
    en: ["Astral could not start", "The app’s local service did not start. Close other copies of Astral and try again."],
    de: ["Astral konnte nicht gestartet werden", "Der lokale Dienst der App wurde nicht gestartet. Schließe andere Kopien von Astral und versuche es erneut."],
    pl: ["Nie udało się uruchomić Astral", "Lokalna usługa aplikacji nie wystartowała. Zamknij inne kopie Astral i spróbuj ponownie."],
    fr: ["Impossible de démarrer Astral", "Le service local de l’application n’a pas démarré. Fermez les autres copies d’Astral et réessayez."],
  },
};

const REASON_LABEL = {
  ru: "Причина: ",
  uk: "Причина: ",
  en: "Reason: ",
  de: "Grund: ",
  pl: "Przyczyna: ",
  fr: `Cause${FR_NBSP}: `,
};

// Папка пользователя Windows в тексте ошибки — под «~»: окно могут сфотографировать для тикета.
// Имя папки может быть с пробелом («Иван Петров»), поэтому до следующей косой, а не до пробела.
const USER_FOLDER = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/"'<>|]+/gi;

/** Одна короткая строка причины: первая строка, без путей пользователя, не длиннее ~160 знаков. Пусто — «». */
export function shortReason(reason) {
  const text = reason == null ? "" : String(reason);
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const clean = firstLine.replace(USER_FOLDER, "~").replace(/\s+/g, " ").trim();
  if (clean.length <= REASON_LIMIT) return clean;
  return `${clean.slice(0, REASON_LIMIT - 1).trimEnd()}…`;
}

/** `[заголовок, текст]` окна на языке; неизвестный язык — английский, причина — последней строкой, если она есть. */
export function startupFailureWords(language, kind, reason = "") {
  const lang = BETA_LANGUAGES.includes(language) ? language : "en";
  const [title, text] = (WORDS[kind] ?? WORDS.start)[lang];
  const why = shortReason(reason);
  return [title, why ? `${text}\n\n${REASON_LABEL[lang]}${why}` : text];
}

/**
 * Показывает окно срыва старта. Язык берётся у системы; `log` (если задан) получает запись с причиной — по ней поддержка
 * находит срыв в журнале. Сбой самого окна или журнала молча глотается: старт и так сорван.
 */
export function showStartupFailure({ dialog, app, kind, reason = "", log }) {
  const language = pickBetaLanguage(app?.getLocale?.());
  try {
    const why = shortReason(reason);
    log?.({ level: "error", source: "main", message: `Окно срыва старта (${kind})${why ? `: ${why}` : ""}` });
  } catch {
    // журнал не мешает окну
  }
  const [title, text] = startupFailureWords(language, kind, reason);
  try {
    dialog.showErrorBox(title, text);
  } catch {
    // окно не показалось — запуск всё равно закончится
  }
}
