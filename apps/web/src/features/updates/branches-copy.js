// Тексты экрана «Версии Astral»: карточка в «Настройки → О программе», вопрос о
// переключении, окно «Доступ снят» и угловая карточка «поставить ветку рядом».
// branchesCopyFor(language) отдаёт готовое дерево этого языка; названия веток
// приходят аргументами. branchErrorCopy и branchNoticeCopy выбирают текст ошибки
// и заметки под кнопкой (пустая строка значит «ничего не показывать»).

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
const FALLBACK_LANGUAGE = "en";
const SEPARATOR = " · ";

const SILENT_REASONS = [
  "declined",
  "already-asking",
  "same-branch",
  "already-running",
  "already-installed",
];
const NOTICE_REASONS = ["updating", "busy", "unavailable"];

const filled = (value) => value !== undefined && value !== null && value !== "";
const joined = (...parts) => parts.filter(filled).join(SEPARATOR);
const spaced = (...parts) => parts.filter(filled).join(" ");
const hasOwn = (object, key) =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);

// Строка ветки, которая стоит рядом: «версия · доступна новая» или, если номера
// нет, одно слово «установлена».
const installedLine = (versionLabel, fallback, availableLabel) =>
  function (version, available) {
    return joined(
      filled(version) ? versionLabel(version) : fallback,
      filled(available) && available !== version
        ? availableLabel(available)
        : "",
    );
  };

// Пути листьев дерева текстов; значения языка лежат списком в том же порядке.
const PATHS = [
  "heading",
  "lead",
  "chip.current",
  "chip.installed",
  "line.current",
  "line.installed",
  "line.available",
  "line.denied",
  "busy.checking",
  "busy.downloading",
  "busy.handingOff",
  "busy.verifying",
  "busy.applying",
  "actions.open",
  "actions.install",
  "actions.retry",
  "actions.refresh",
  "actions.close",
  "actions.ok",
  "refreshed",
  "neverRefreshed",
  "today",
  "none",
  "errors.NO_RELEASE",
  "errors.CHANNEL_DENIED",
  "errors.NO_NETWORK",
  "errors.DISK_FULL",
  "errors.HELPER_UNAVAILABLE",
  "errors.HELPER_FAILED",
  "errors.HASH_MISMATCH",
  "errors.SIGNATURE_INVALID",
  "errors.DEFAULT",
  "notices.updating",
  "notices.busy",
  "notices.unavailable",
  "notices.failed",
  "switch.label",
  "switch.title",
  "switch.text",
  "switch.detail",
  "switch.confirm",
  "switch.stay",
  "denied.title",
  "denied.text",
  "denied.openHint",
  "denied.installedTag",
  "denied.availableTag",
  "denied.open",
  "denied.install",
  "denied.none",
  "installing.label",
  "installing.title",
  "installing.verifyingTitle",
  "installing.preparingTitle",
  "installing.handingOffTitle",
  "installing.preparing",
  "installing.handingOff",
  "installing.hide",
  "installing.hideNote",
  "installing.failedTitle",
  "offer.label",
  "offer.title",
  "offer.text",
  "offer.install",
  "offer.later",
];

const TEXTS = {
  ru: [
    "Версии Astral",
    "На одном ПК может быть несколько веток Astral с общими данными: вход, мастерская и настройки.",
    "Открыта сейчас",
    "Установлена",
    (version) => (filled(version) ? `Версия ${version}` : "Определяется…"),
    installedLine(
      (version) => `Версия ${version}`,
      "Установлена",
      (available) => `доступна ${available}`,
    ),
    (version) =>
      joined("Не установлена", filled(version) ? `доступна ${version}` : ""),
    (installed) =>
      joined("Доступ снят", installed ? "файлы остались на месте" : ""),
    "Готовим…",
    (percent) => (filled(percent) ? `Скачиваем… ${percent} %` : "Скачиваем…"),
    "Запускаем установщик…",
    "Проверяем файлы…",
    "Обновляем…",
    "Открыть",
    "Установить рядом",
    "Повторить",
    "Обновить сведения",
    "Закрыть",
    "Понятно",
    (when) => (filled(when) ? `Обновлено: ${when}` : "Обновлено"),
    "Сведений о ветках пока нет",
    "сегодня",
    "Других веток у этого аккаунта пока нет.",
    "Для этой ветки пока нет выпуска",
    "Доступ к ветке снят",
    "Нет связи с сервером",
    "Не хватает места на диске",
    "Не удалось запустить установщик",
    "Установка не завершилась",
    "Файлы не прошли проверку",
    "Файлы не прошли проверку",
    "Не получилось",
    "Эту ветку сейчас обновляют — подождите минуту",
    "Сейчас уже ставится другая ветка",
    "В этой сборке Astral нельзя ставить ветки рядом",
    "Не получилось. Попробуйте ещё раз",
    "Переключение между ветками",
    (to) => `Открыть ${to}?`,
    (from, to) => `Сейчас открыт ${from}. Закрыть его и открыть ${to}?`,
    "Данные общие, ничего не потеряется. Если идёт запись в игру, Astral спросит перед закрытием.",
    (to) => `Закрыть и открыть ${to}`,
    "Остаться",
    (name) => `Доступ к ${name} снят`,
    "Эта ветка закрыта для вашего аккаунта и больше не открывается. Ничего не удалено: все файлы остались на диске, а вход, мастерская и настройки общие со всеми ветками.",
    "Можно открыть другую ветку:",
    "установлена",
    (version) => `доступна ${version}`,
    (name) => `Открыть ${name}`,
    (name) => `Поставить ${name} рядом`,
    "Другой доступной ветки пока нет. Если ждёте доступ — напишите в поддержку Astral в Discord.",
    "Установка ветки Astral",
    (name) => `Ставим ${name} рядом`,
    (name) => `Проверяем ${name}`,
    (name) => `Готовим ${name}`,
    (name) => `Запускаем установку ${name}`,
    "Спрашиваем сервер и готовим файлы…",
    "Сейчас откроется окно установщика: он распакует файлы и поставит ветку рядом.",
    "Скрыть",
    (heading) =>
      `Установка продолжится в фоне. Ход — в настройках, в разделе «${heading}».`,
    (name) => `Не удалось поставить ${name}`,
    "Другая ветка Astral",
    (name) => `Вам доступна ветка ${name}`,
    (name, version) =>
      `${spaced(name, version)} можно поставить рядом — данные общие.`,
    "Установить рядом",
    "Не сейчас",
  ],
  uk: [
    "Версії Astral",
    "На одному ПК може бути кілька гілок Astral зі спільними даними: вхід, майстерня й налаштування.",
    "Відкрита зараз",
    "Встановлена",
    (version) => (filled(version) ? `Версія ${version}` : "Визначається…"),
    installedLine(
      (version) => `Версія ${version}`,
      "Встановлена",
      (available) => `доступна ${available}`,
    ),
    (version) =>
      joined("Не встановлена", filled(version) ? `доступна ${version}` : ""),
    (installed) =>
      joined("Доступ знято", installed ? "файли залишилися на місці" : ""),
    "Готуємо…",
    (percent) =>
      filled(percent) ? `Завантажуємо… ${percent} %` : "Завантажуємо…",
    "Запускаємо інсталятор…",
    "Перевіряємо файли…",
    "Оновлюємо…",
    "Відкрити",
    "Встановити поруч",
    "Повторити",
    "Оновити відомості",
    "Закрити",
    "Зрозуміло",
    (when) => (filled(when) ? `Оновлено: ${when}` : "Оновлено"),
    "Відомостей про гілки ще немає",
    "сьогодні",
    "Інших гілок для цього облікового запису поки немає.",
    "Для цієї гілки поки немає випуску",
    "Доступ до гілки знято",
    "Немає зв’язку з сервером",
    "Не вистачає місця на диску",
    "Не вдалося запустити інсталятор",
    "Встановлення не завершилося",
    "Файли не пройшли перевірку",
    "Файли не пройшли перевірку",
    "Не вийшло",
    "Цю гілку зараз оновлюють — зачекайте хвилину",
    "Зараз уже встановлюється інша гілка",
    "У цій збірці Astral не можна ставити гілки поруч",
    "Не вийшло. Спробуйте ще раз",
    "Перемикання між гілками",
    (to) => `Відкрити ${to}?`,
    (from, to) => `Зараз відкритий ${from}. Закрити його й відкрити ${to}?`,
    "Дані спільні, нічого не втратиться. Якщо йде запис у гру, Astral спитає перед закриттям.",
    (to) => `Закрити та відкрити ${to}`,
    "Залишитися",
    (name) => `Доступ до ${name} знято`,
    "Ця гілка закрита для вашого облікового запису й більше не відкривається. Нічого не видалено: усі файли залишилися на диску, а вхід, майстерня й налаштування спільні з усіма гілками.",
    "Можна відкрити іншу гілку:",
    "встановлена",
    (version) => `доступна ${version}`,
    (name) => `Відкрити ${name}`,
    (name) => `Встановити ${name} поруч`,
    "Іншої доступної гілки поки немає. Якщо чекаєте на доступ — напишіть у підтримку Astral у Discord.",
    "Встановлення гілки Astral",
    (name) => `Встановлюємо ${name} поруч`,
    (name) => `Перевіряємо ${name}`,
    (name) => `Готуємо ${name}`,
    (name) => `Запускаємо встановлення ${name}`,
    "Запитуємо сервер і готуємо файли…",
    "Зараз відкриється вікно інсталятора: він розпакує файли й встановить гілку поруч.",
    "Сховати",
    (heading) =>
      `Встановлення триватиме у фоні. Хід — у налаштуваннях, у розділі «${heading}».`,
    (name) => `Не вдалося встановити ${name}`,
    "Інша гілка Astral",
    (name) => `Вам доступна гілка ${name}`,
    (name, version) =>
      `${spaced(name, version)} можна встановити поруч — дані спільні.`,
    "Встановити поруч",
    "Не зараз",
  ],
  en: [
    "Astral versions",
    "One PC can have several Astral branches sharing data: sign-in, workshop and settings.",
    "Open now",
    "Installed",
    (version) => (filled(version) ? `Version ${version}` : "Detecting…"),
    installedLine(
      (version) => `Version ${version}`,
      "Installed",
      (available) => `${available} available`,
    ),
    (version) =>
      joined("Not installed", filled(version) ? `${version} available` : ""),
    (installed) =>
      joined("Access removed", installed ? "files are still in place" : ""),
    "Preparing…",
    (percent) =>
      filled(percent) ? `Downloading… ${percent} %` : "Downloading…",
    "Starting the installer…",
    "Checking files…",
    "Updating…",
    "Open",
    "Install alongside",
    "Retry",
    "Refresh info",
    "Close",
    "Got it",
    (when) => (filled(when) ? `Refreshed: ${when}` : "Refreshed"),
    "No branch info yet",
    "today",
    "This account has no other branches for now.",
    "No release for this branch yet",
    "Access to this branch was removed",
    "Can’t reach the server",
    "Not enough disk space",
    "Couldn’t start the installer",
    "Installation didn’t finish",
    "Downloaded files failed the check",
    "Downloaded files failed the check",
    "Something went wrong",
    "This branch is being updated — wait about a minute",
    "Another branch is already being installed",
    "This build of Astral can’t install branches alongside",
    "That didn’t work. Try again",
    "Switching between branches",
    (to) => `Open ${to}?`,
    (from, to) => `${from} is open. Close it and open ${to}?`,
    "Data is shared, so nothing is lost. If changes are being written to the game, Astral asks before closing.",
    (to) => `Close and open ${to}`,
    "Stay",
    (name) => `Access to ${name} removed`,
    "This branch is closed for your account and no longer opens. Nothing was removed: all files are still on disk, and sign-in, workshop and settings are shared with every branch.",
    "You can open another branch:",
    "installed",
    (version) => `${version} available`,
    (name) => `Open ${name}`,
    (name) => `Install ${name} alongside`,
    "No other branch is available yet. If you are waiting for access, contact Astral support on Discord.",
    "Astral branch installation",
    (name) => `Installing ${name} alongside`,
    (name) => `Checking ${name}`,
    (name) => `Preparing ${name}`,
    (name) => `Starting installation of ${name}`,
    "Asking the server and preparing files…",
    "The installer window is about to open: it unpacks the files and installs the branch next to the others.",
    "Hide",
    (heading) =>
      `Installation continues in the background. Progress is in Settings, under “${heading}”.`,
    (name) => `Couldn’t install ${name}`,
    "Another Astral branch",
    (name) => `${name} is available to you`,
    (name, version) =>
      `${spaced(name, version)} can be installed alongside — data is shared.`,
    "Install alongside",
    "Not now",
  ],
  de: [
    "Astral-Versionen",
    "Auf einem PC können mehrere Astral-Zweige installiert sein, mit gemeinsamen Daten: Anmeldung, Werkstatt und Einstellungen.",
    "Jetzt geöffnet",
    "Installiert",
    (version) => (filled(version) ? `Version ${version}` : "Wird ermittelt"),
    installedLine(
      (version) => `Version ${version}`,
      "Installiert",
      (available) => `${available} verfügbar`,
    ),
    (version) =>
      joined(
        "Nicht installiert",
        filled(version) ? `${version} verfügbar` : "",
      ),
    (installed) =>
      joined("Zugriff entzogen", installed ? "Dateien bleiben erhalten" : ""),
    "Wird vorbereitet …",
    (percent) =>
      filled(percent) ? `Wird geladen … ${percent} %` : "Wird geladen …",
    "Installer wird gestartet …",
    "Dateien werden geprüft …",
    "Wird aktualisiert …",
    "Öffnen",
    "Daneben installieren",
    "Erneut versuchen",
    "Infos aktualisieren",
    "Schließen",
    "Verstanden",
    (when) => (filled(when) ? `Stand: ${when}` : "Aktualisiert"),
    "Noch keine Infos zu den Zweigen",
    "heute",
    "Dieses Konto hat vorerst keine weiteren Zweige.",
    "Noch kein Release für diesen Zweig",
    "Zugriff auf den Zweig entzogen",
    "Server nicht erreichbar",
    "Nicht genug Speicherplatz",
    "Installer konnte nicht gestartet werden",
    "Installation nicht abgeschlossen",
    "Dateien haben die Prüfung nicht bestanden",
    "Dateien haben die Prüfung nicht bestanden",
    "Das hat nicht geklappt",
    "Dieser Zweig wird aktualisiert — etwa eine Minute warten",
    "Es wird bereits ein anderer Zweig installiert",
    "Daneben installieren ist in diesem Astral-Build nicht möglich",
    "Das hat nicht geklappt. Erneut versuchen",
    "Wechsel zwischen Zweigen",
    (to) => `${to} öffnen?`,
    (from, to) => `${from} ist geöffnet. Diesen schließen und ${to} öffnen?`,
    "Die Zweige teilen ihre Daten, nichts geht verloren. Läuft ein Schreibvorgang ins Spiel, fragt Astral vor dem Schließen.",
    (to) => `Schließen und ${to} öffnen`,
    "Bleiben",
    (name) => `Zugriff auf ${name} entzogen`,
    "Dieser Zweig ist für dein Konto geschlossen und öffnet sich nicht mehr. Nichts wurde gelöscht: Alle Dateien bleiben da, und Anmeldung, Werkstatt und Einstellungen sind für alle Zweige gemeinsam.",
    "Stattdessen anderen Zweig öffnen:",
    "installiert",
    (version) => `${version} verfügbar`,
    (name) => `${name} öffnen`,
    (name) => `${name} daneben installieren`,
    "Noch kein anderer Zweig verfügbar. Wenn du auf Zugang wartest, wende dich auf Discord an den Astral-Support.",
    "Installation eines Astral-Zweigs",
    (name) => `${name} wird daneben installiert`,
    (name) => `${name} wird geprüft`,
    (name) => `${name} wird vorbereitet`,
    (name) => `Installation von ${name} wird gestartet`,
    "Server wird angefragt, Dateien werden vorbereitet …",
    "Gleich öffnet sich das Installer-Fenster: Es entpackt die Dateien und installiert den Zweig daneben.",
    "Ausblenden",
    (heading) =>
      `Die Installation läuft im Hintergrund weiter. Der Fortschritt steht in den Einstellungen unter „${heading}“.`,
    (name) => `${name} konnte nicht installiert werden`,
    "Weiterer Astral-Zweig",
    (name) => `${name} ist verfügbar`,
    (name, version) =>
      `${spaced(name, version)} lässt sich daneben installieren — die Daten werden gemeinsam genutzt.`,
    "Daneben installieren",
    "Nicht jetzt",
  ],
  pl: [
    "Wersje Astral",
    "Na jednym PC może działać kilka gałęzi Astral — łączą je wspólne dane: logowanie, warsztat i ustawienia.",
    "Otwarta teraz",
    "Zainstalowana",
    (version) => (filled(version) ? `Wersja ${version}` : "Ustalanie…"),
    installedLine(
      (version) => `Wersja ${version}`,
      "Zainstalowana",
      (available) => `dostępna ${available}`,
    ),
    (version) =>
      joined("Niezainstalowana", filled(version) ? `dostępna ${version}` : ""),
    (installed) =>
      joined("Dostęp cofnięty", installed ? "pliki zostały na miejscu" : ""),
    "Przygotowujemy…",
    (percent) => (filled(percent) ? `Pobieramy… ${percent} %` : "Pobieramy…"),
    "Uruchamiamy instalator…",
    "Sprawdzamy pliki…",
    "Aktualizujemy…",
    "Otwórz",
    "Zainstaluj obok",
    "Ponów",
    "Odśwież informacje",
    "Zamknij",
    "Rozumiem",
    (when) => (filled(when) ? `Odświeżono: ${when}` : "Odświeżono"),
    "Brak jeszcze informacji o gałęziach",
    "dzisiaj",
    "To konto nie ma na razie innych gałęzi.",
    "Dla tej gałęzi nie ma jeszcze wydania",
    "Dostęp do gałęzi cofnięty",
    "Brak połączenia z serwerem",
    "Za mało miejsca na dysku",
    "Nie udało się uruchomić instalatora",
    "Instalacja nie została ukończona",
    "Pliki nie przeszły weryfikacji",
    "Pliki nie przeszły weryfikacji",
    "Nie udało się",
    "Ta gałąź jest teraz aktualizowana — poczekaj minutę",
    "Trwa już instalacja innej gałęzi",
    "W tej kompilacji nie da się ustawić gałęzi obok",
    "Nie udało się. Spróbuj ponownie",
    "Przełączanie między gałęziami",
    (to) => `Otworzyć ${to}?`,
    (from, to) => `Teraz otwarty jest ${from}. Zamknąć go i otworzyć ${to}?`,
    "Dane są wspólne, nic nie zginie. Jeśli trwa zapis do gry, Astral zapyta przed zamknięciem.",
    (to) => `Zamknij i otwórz ${to}`,
    "Zostań",
    (name) => `Dostęp do ${name} cofnięty`,
    "Ta gałąź jest zamknięta dla Twojego konta i już się nie otwiera. Nic nie usunięto: wszystkie pliki zostały na dysku, a logowanie, warsztat i ustawienia są wspólne dla wszystkich gałęzi.",
    "Można otworzyć inną gałąź:",
    "zainstalowana",
    (version) => `dostępna ${version}`,
    (name) => `Otwórz ${name}`,
    (name) => `Zainstaluj ${name} obok`,
    "Na razie nie ma innej dostępnej gałęzi. Jeśli czekasz na dostęp, napisz do pomocy technicznej Astral na Discordzie.",
    "Instalacja gałęzi Astral",
    (name) => `Instalujemy ${name} obok`,
    (name) => `Sprawdzamy ${name}`,
    (name) => `Przygotowujemy ${name}`,
    (name) => `Uruchamiamy instalację ${name}`,
    "Pytamy serwer i przygotowujemy pliki…",
    "Za chwilę otworzy się okno instalatora: rozpakuje pliki i zainstaluje gałąź obok.",
    "Ukryj",
    (heading) =>
      `Instalacja trwa w tle. Postęp jest w ustawieniach, w sekcji „${heading}”.`,
    (name) => `Nie udało się zainstalować ${name}`,
    "Inna gałąź Astral",
    (name) => `Masz dostępną gałąź ${name}`,
    (name, version) =>
      `${spaced(name, version)} można zainstalować obok — dane są wspólne.`,
    "Zainstaluj obok",
    "Nie teraz",
  ],
  fr: [
    "Versions d’Astral",
    "Un PC peut avoir plusieurs branches d’Astral aux données partagées\u00a0: connexion, atelier et paramètres.",
    "Ouverte maintenant",
    "Installée",
    (version) => (filled(version) ? `Version ${version}` : "Détection…"),
    installedLine(
      (version) => `Version ${version}`,
      "Installée",
      (available) => `${available} disponible`,
    ),
    (version) =>
      joined("Non installée", filled(version) ? `${version} disponible` : ""),
    (installed) =>
      joined("Accès retiré", installed ? "fichiers restés en place" : ""),
    "Préparation…",
    (percent) =>
      filled(percent) ? `Téléchargement… ${percent}\u00a0%` : "Téléchargement…",
    "Lancement de l’installateur…",
    "Vérification des fichiers…",
    "Mise à jour…",
    "Ouvrir",
    "Installer en parallèle",
    "Réessayer",
    "Actualiser les infos",
    "Fermer",
    "Compris",
    (when) => (filled(when) ? `Actualisé\u00a0: ${when}` : "Actualisé"),
    "Pas encore d’infos sur les branches",
    "aujourd’hui",
    "Ce compte n’a pas d’autre branche pour le moment.",
    "Rien n’est encore publié pour cette branche",
    "Accès à la branche retiré",
    "Connexion au serveur impossible",
    "Espace disque insuffisant",
    "Impossible de lancer l’installateur",
    "L’installation ne s’est pas terminée",
    "Les fichiers n’ont pas passé la vérification",
    "Les fichiers n’ont pas passé la vérification",
    "Échec",
    "Branche en cours de mise à jour — patientez environ une minute",
    "Une autre branche est déjà en cours d’installation",
    "Ce build d’Astral ne permet pas d’installer une branche en parallèle",
    "Échec. Réessayez",
    "Changement de branche",
    (to) => `Ouvrir ${to}\u00a0?`,
    (from, to) =>
      `Actuellement, ${from} est ouvert. Le fermer et ouvrir ${to}\u00a0?`,
    "Les données sont partagées, rien ne sera perdu. Si une écriture dans le jeu est en cours, Astral vous demandera confirmation.",
    (to) => `Fermer et ouvrir ${to}`,
    "Rester",
    (name) => `Accès à ${name} retiré`,
    "Cette branche est fermée pour votre compte et ne s’ouvre plus. Rien n’est supprimé\u00a0: tous les fichiers sont conservés sur le disque, et la connexion, l’atelier et les réglages sont communs à toutes les branches.",
    "Vous pouvez ouvrir une autre branche\u00a0:",
    "installée",
    (version) => `${version} disponible`,
    (name) => `Ouvrir ${name}`,
    (name) => `Installer ${name} en parallèle`,
    "Aucune autre branche disponible pour l’instant. Si vous attendez un accès, contactez le support Astral sur Discord.",
    "Installation d’une branche d’Astral",
    (name) => `Installation de la branche ${name} en parallèle`,
    (name) => `Vérification de la branche ${name}`,
    (name) => `Préparation de la branche ${name}`,
    (name) => `Lancement de l’installation de la branche ${name}`,
    "Interrogation du serveur et préparation des fichiers…",
    "La fenêtre de l’installateur va s’ouvrir\u00a0: il décompresse les fichiers et installe la branche à côté.",
    "Masquer",
    (heading) =>
      `L’installation continue en arrière-plan. Progression dans les paramètres, section «\u00a0${heading}\u00a0».`,
    (name) => `Échec d’installation\u00a0: ${name}`,
    "Autre branche d’Astral",
    (name) => `La branche ${name} est disponible`,
    (name, version) =>
      `${spaced(name, version)} peut être installé en parallèle — les données sont partagées.`,
    "Installer en parallèle",
    "Pas maintenant",
  ],
};

// Дерево текстов языка: пути листьев разворачиваются во вложенные объекты.
const build = (language) => {
  const tree = {};
  for (const [at, path] of PATHS.entries()) {
    const keys = path.split(".");
    let node = tree;
    for (const key of keys.slice(0, -1)) {
      node[key] ??= {};
      node = node[key];
    }
    node[keys[keys.length - 1]] = TEXTS[language][at];
  }
  return tree;
};

const trees = new Map();

export function branchesCopyFor(language) {
  const code = LANGUAGES.includes(language) ? language : FALLBACK_LANGUAGE;
  if (!trees.has(code)) {
    trees.set(code, build(code));
  }
  return trees.get(code);
}

export function branchErrorCopy(copy, code) {
  return hasOwn(copy.errors, code) ? copy.errors[code] : copy.errors.DEFAULT;
}

export function branchNoticeCopy(copy, reason) {
  if (typeof reason !== "string") {
    return copy.notices.failed;
  }
  if (SILENT_REASONS.includes(reason)) {
    return "";
  }
  if (NOTICE_REASONS.includes(reason)) {
    return copy.notices[reason];
  }
  if (reason !== "DEFAULT" && hasOwn(copy.errors, reason)) {
    return copy.errors[reason];
  }
  return copy.notices.failed;
}
