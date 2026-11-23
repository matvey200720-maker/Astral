/*
 * Слова кнопки установки — одни на каталог, галерею мастерской, библиотеку и
 * сборки (задача 1 ТЗ 08.10, вечер). Статус установки показывает сама кнопка,
 * на которую нажали: «Загрузки» больше не открываются, и разные слова одной и
 * той же установки на соседних экранах читались бы как разные установки.
 * Страница мода берёт те же слова из своего словаря (`modActionCopy.js`).
 */
const COPY = {
  ru: {
    installing: "Идёт установка…",
    removing: "Идёт удаление…",
    queued: "в очереди",
    installed: "Установлено",
    failed: "Не удалось",
    retry: "Повторить",
    details: "Подробности — в «Загрузках»",
  },
  uk: {
    installing: "Триває встановлення…",
    removing: "Триває видалення…",
    queued: "у черзі",
    installed: "Встановлено",
    failed: "Не вдалося",
    retry: "Повторити",
    details: "Подробиці — у «Завантаженнях»",
  },
  en: {
    installing: "Installing…",
    removing: "Removing…",
    queued: "in queue",
    installed: "Installed",
    failed: "Failed",
    retry: "Try again",
    details: "Details are in Downloads",
  },
  de: {
    installing: "Installation läuft…",
    removing: "Wird entfernt…",
    queued: "in der Warteschlange",
    installed: "Installiert",
    failed: "Fehlgeschlagen",
    retry: "Erneut versuchen",
    details: "Details unter „Downloads“",
  },
  pl: {
    installing: "Trwa instalacja…",
    removing: "Trwa usuwanie…",
    queued: "w kolejce",
    installed: "Zainstalowano",
    failed: "Nie udało się",
    retry: "Spróbuj ponownie",
    details: "Szczegóły w „Pobranych”",
  },
  fr: {
    installing: "Installation en cours…",
    removing: "Suppression en cours…",
    queued: "en file d’attente",
    installed: "Installé",
    failed: "Échec",
    retry: "Réessayer",
    details: "Détails dans «\u00a0Téléchargements\u00a0»",
  },
};

export function installButtonCopy(language = "ru") {
  return COPY[language] || COPY[String(language).slice(0, 2)] || COPY.en;
}
