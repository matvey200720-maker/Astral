// locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) записаны в этом файле, словарь окна не нужен.

/* Порядок языков в каждой строке таблицы WORDS. */
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
const FALLBACK = LANGUAGES.indexOf("en");

/*
 * Слова раздела «Логи»: ключ → шесть значений по порядку LANGUAGES
 * (строки или функции) либо вложенная таблица таких же строк.
 * Порядок ключей здесь — порядок ключей результата.
 */
const WORDS = {
  title: ["Логи", "Журнал", "Logs", "Protokoll", "Dziennik", "Journaux"],
  lede: [
    "Всё, что приложение пишет о себе: сбои, ошибки, неудачные установки и шаги кнопки «Применить». Скачайте журнал файлом и приложите к тикету: имя пользователя и пути в нём заменены.",
    "Усе, що застосунок пише про себе: збої, помилки, невдалі встановлення й кроки кнопки «Застосувати». Завантажте журнал файлом і додайте до тікета: ім'я користувача та шляхи в ньому замінено.",
    "Everything the app records about itself: crashes, errors, failed installs and “Apply” steps. Download the log as one file and attach it to your ticket. User name and paths in it are already replaced.",
    "Alles, was die App über sich aufzeichnet: Abstürze, Fehler, gescheiterte Installationen und Schritte von „Anwenden“. Lade das Protokoll als Datei herunter und hänge es an dein Ticket. Benutzername und Pfade darin sind schon ersetzt.",
    "Wszystko, co aplikacja zapisuje o sobie: awarie, błędy, nieudane instalacje i kroki „Zastosuj”. Pobierz dziennik jako jeden plik i dołącz do zgłoszenia. Nazwa użytkownika i ścieżki są w nim już podmienione.",
    "Tout ce que l'application note sur elle-même\u00a0: plantages, erreurs, installations échouées, étapes du bouton «\u00a0Appliquer\u00a0». Téléchargez le journal en un fichier et joignez-le à votre ticket\u00a0: nom d'utilisateur et chemins y sont déjà remplacés.",
  ],
  browserOnly: [
    "Записи ведёт только версия «Astral для Windows», в браузере показывать нечего.",
    "Записи веде лише версія «Astral для Windows», у браузері показувати нічого.",
    "Only the desktop version, “Astral for Windows”, keeps a log, so there is nothing to show in a browser.",
    "Nur die Desktop-Version „Astral für Windows“ führt Aufzeichnungen, im Browser gibt es nichts zu zeigen.",
    "Wpisy prowadzi tylko wersja na komputer „Astral dla Windows”, w przeglądarce nie ma czego pokazać.",
    "Seule la version de bureau «\u00a0Astral pour Windows\u00a0» tient ce journal\u00a0: dans un navigateur, il n'y a rien à afficher.",
  ],
  download: [
    "Скачать для тикета",
    "Завантажити для тікета",
    "Download for a ticket",
    "Für ein Ticket herunterladen",
    "Pobierz do zgłoszenia",
    "Télécharger pour un ticket",
  ],
  discord: [
    "Написать в Discord",
    "Написати в Discord",
    "Write us on Discord",
    "Auf Discord schreiben",
    "Napisz na Discordzie",
    "Écrire sur Discord",
  ],
  downloading: [
    "Готовим файл…",
    "Готуємо файл…",
    "Preparing file…",
    "Datei wird vorbereitet…",
    "Przygotowuję plik…",
    "Préparation du fichier…",
  ],
  refresh: [
    "Обновить",
    "Оновити",
    "Refresh",
    "Aktualisieren",
    "Odśwież",
    "Actualiser",
  ],
  clear: [
    "Очистить журнал",
    "Очистити журнал",
    "Clear log",
    "Protokoll leeren",
    "Wyczyść dziennik",
    "Vider le journal",
  ],
  clearConfirm: [
    "Очистить насовсем",
    "Очистити назавжди",
    "Clear for good",
    "Endgültig leeren",
    "Wyczyść na zawsze",
    "Vider définitivement",
  ],
  clearCancel: [
    "Не очищать",
    "Не очищати",
    "Keep it",
    "Behalten",
    "Zostaw",
    "Ne pas vider",
  ],
  clearAsk: [
    "Очистка удалит записи и с экрана, и с диска. Скачанный раньше файл не изменится.",
    "Очищення видалить записи і з екрана, і з диска. Раніше завантажений файл не зміниться.",
    "This deletes the entries from the screen and from disk. A file you downloaded earlier stays as it is.",
    "Die Einträge werden am Bildschirm und auf der Festplatte gelöscht. Eine früher heruntergeladene Datei bleibt unberührt.",
    "Wpisy znikną z ekranu i z dysku. Pobrany wcześniej plik się nie zmieni.",
    "Les entrées seront supprimées de l'écran et du disque. Un fichier téléchargé auparavant reste intact.",
  ],
  saved: [
    (name) => `Сохранён файл ${name}`,
    (name) => `Збережено файл ${name}`,
    (name) => `File saved: ${name}`,
    (name) => `Datei gespeichert: ${name}`,
    (name) => `Zapisano plik ${name}`,
    (name) => `Fichier enregistré\u00a0: ${name}`,
  ],
  canceled: [
    "Сохранение отменено",
    "Збереження скасовано",
    "Saving canceled",
    "Speichern abgebrochen",
    "Anulowano zapis",
    "Enregistrement annulé",
  ],
  cleared: [
    "Журнал очищен",
    "Журнал очищено",
    "Log cleared",
    "Protokoll geleert",
    "Dziennik wyczyszczony",
    "Journal vidé",
  ],
  failed: [
    "Не получилось",
    "Не вдалося",
    "Action failed",
    "Fehlgeschlagen",
    "Nie udało się",
    "Échec de l'action",
  ],
  empty: [
    "Записей пока нет, всё спокойно",
    "Записів поки немає, усе спокійно",
    "Nothing logged yet, all quiet",
    "Noch keine Einträge, alles ruhig",
    "Brak wpisów, na razie spokojnie",
    "Aucune entrée pour l'instant, tout est calme",
  ],
  emptyFiltered: [
    "На этом уровне записей нет",
    "На цьому рівні записів немає",
    "No entries at this level",
    "Auf dieser Stufe gibt es keine Einträge",
    "Na tym poziomie nie ma wpisów",
    "Aucune entrée à ce niveau",
  ],
  levels: {
    all: ["Все", "Усі", "All", "Alle", "Wszystkie", "Tous"],
    error: ["Ошибки", "Помилки", "Errors", "Fehler", "Błędy", "Erreurs"],
    warn: [
      "Предупреждения",
      "Попередження",
      "Warnings",
      "Warnungen",
      "Ostrzeżenia",
      "Avertissements",
    ],
    info: [
      "События",
      "Події",
      "Events",
      "Ereignisse",
      "Zdarzenia",
      "Événements",
    ],
  },
  levelWord: {
    error: ["Ошибка", "Помилка", "Error", "Fehler", "Błąd", "Erreur"],
    warn: [
      "Предупреждение",
      "Попередження",
      "Warning",
      "Warnung",
      "Ostrzeżenie",
      "Avertissement",
    ],
    info: ["Событие", "Подія", "Event", "Ereignis", "Zdarzenie", "Événement"],
  },
  details: [
    "Подробности",
    "Подробиці",
    "Details",
    "Details",
    "Szczegóły",
    "Détails",
  ],
  count: [
    (shown, total) =>
      shown === total ? `Записи: ${total}` : `Показано ${shown} из ${total}`,
    (shown, total) =>
      shown === total ? `Записи: ${total}` : `Показано ${shown} з ${total}`,
    (shown, total) =>
      shown === total ? `Entries: ${total}` : `Showing ${shown} of ${total}`,
    (shown, total) =>
      shown === total
        ? `Einträge: ${total}`
        : `${shown} von ${total} angezeigt`,
    (shown, total) =>
      shown === total ? `Wpisy: ${total}` : `Pokazano ${shown} z ${total}`,
    (shown, total) =>
      shown === total
        ? `Entrées\u00a0: ${total}`
        : `${shown} sur ${total} affichées`,
  ],
  sources: [
    (names) => `В файл также попадают журналы других программ: ${names}.`,
    (names) => `До файлу також потрапляють журнали інших програм: ${names}.`,
    (names) => `The file also includes logs from other programs: ${names}.`,
    (names) =>
      `Die Datei enthält außerdem Protokolle anderer Programme: ${names}.`,
    (names) => `Do pliku trafiają też dzienniki innych programów: ${names}.`,
    (names) =>
      `Le fichier inclut aussi les journaux d'autres programmes\u00a0: ${names}.`,
  ],
  privacy: [
    "Ничего не отправляется само, файл к тикету прикладывается вручную.",
    "Нічого не надсилається само, файл до тікета додається вручну.",
    "Nothing is sent automatically. You attach the file to your ticket yourself.",
    "Nichts wird automatisch gesendet. Die Datei hängst du selbst an dein Ticket an.",
    "Nic nie jest wysyłane automatycznie. Plik do zgłoszenia dołączasz samodzielnie.",
    "Rien n'est envoyé automatiquement. Vous joignez vous-même le fichier à votre ticket.",
  ],
};

/* Слова по языкам собираются один раз: панель кладёт объект в зависимости мемоизации. */
const built = [];

function pick(node, index) {
  if (Array.isArray(node)) return node[index];
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, pick(child, index)]),
  );
}

/** Слова раздела «Логи» для языка окна; незнакомый язык получает английские (тот же объект, что и `en`). */
export function logsCopyFor(language) {
  const found = LANGUAGES.indexOf(language);
  const index = found < 0 ? FALLBACK : found;
  built[index] ??= pick(WORDS, index);
  return built[index];
}
