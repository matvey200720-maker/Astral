// locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) записаны в этом файле, словарь окна не нужен.
import { FILES, counted } from "../../../plural.js";

/* Порядок языков в каждой строке таблицы TABLE. */
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

const isOne = (count) => Number(count) === 1;
/* Во французском единственное число и у нуля. */
const isFrenchOne = (count) => Number(count) === 0 || Number(count) === 1;

/*
 * Слова раздела «GTA V»: ключ → шесть значений по порядку LANGUAGES (строки или функции).
 * Пара [название, пояснение] — массив из двух таких шести значений.
 * Вложенный объект — группа ключей.
 */
const TABLE = {
  why: {
    loader: [
      "Нужен модам внутри архивов игры (.rpf). Без него игра их не видит.",
      "Потрібен модам усередині архівів гри (.rpf). Без нього гра їх не бачить.",
      "Needed for mods that live inside game archives (.rpf). Without it the game ignores them.",
      "Nötig für Mods innerhalb der Spielarchive (.rpf). Ohne ihn erkennt das Spiel sie nicht.",
      "Potrzebny modom w archiwach gry (.rpf). Bez niego gra ich nie widzi.",
      "Nécessaire aux mods placés dans les archives du jeu (.rpf). Sans lui, le jeu ne les voit pas.",
    ],
    asi: [
      "Запускает скриптовые моды (.asi) вместе с игрой: меню, загрузчики, фонари",
      "Запускає скриптові моди (.asi) разом з грою: меню, завантажувачі, ліхтарі",
      "Launches script mods (.asi) with the game: menus, loaders, street lights",
      "Startet Skript-Mods (.asi) mit dem Spiel: Menüs, Loader, Straßenlaternen",
      "Uruchamia mody skryptowe (.asi) razem z grą: menu, loadery, latarnie",
      "Lance les mods de script (.asi) avec le jeu\u00a0: menus, loaders, lampadaires",
    ],
  },
  install: [
    "Установить",
    "Встановити",
    "Install",
    "Installieren",
    "Zainstaluj",
    "Installer",
  ],
  copies: [
    "Найденные копии",
    "Знайдені копії",
    "Found copies",
    "Gefundene Kopien",
    "Znalezione kopie",
    "Copies trouvées",
  ],
  main: ["Основная", "Основна", "Main", "Hauptkopie", "Główna", "Principale"],
  makeMain: [
    "Сделать основной",
    "Зробити основною",
    "Make main",
    "Als Hauptkopie",
    "Ustaw jako główną",
    "Définir comme principale",
  ],
  build: ["сборка", "збірка", "build", "Build", "kompilacja", "build"],
  status: {
    ready: [
      "Готова к модам",
      "Готова до модів",
      "Ready for mods",
      "Bereit für Mods",
      "Gotowa na mody",
      "Prête pour les mods",
    ],
    "needs-loader": [
      "Не хватает загрузчиков",
      "Бракує завантажувачів",
      "Loaders missing",
      "Loader fehlen",
      "Brakuje loaderów",
      "Loaders manquants",
    ],
    "launcher-busy": [
      "Лаунчер Rockstar блокирует файлы",
      "Лаунчер Rockstar блокує файли",
      "Rockstar launcher blocks the files",
      "Rockstar-Launcher blockiert Dateien",
      "Launcher Rockstar blokuje pliki",
      "Le launcher Rockstar bloque les fichiers",
    ],
  },
  /* Папка не выбрана («Пульт», 15.11.2026): вердикт сверху раздела (`missing` ниже), кнопка и что нужно для модов. */
  pickFolder: [
    "Выбрать папку",
    "Вибрати теку",
    "Choose folder",
    "Ordner wählen",
    "Wybierz folder",
    "Choisir le dossier",
  ],
  loadersNeed: [
    "Что нужно для модов",
    "Що потрібно для модів",
    "What mods need",
    "Was Mods brauchen",
    "Czego potrzebują mody",
    "Ce dont les mods ont besoin",
  ],
  noCopies: [
    [
      "GTA V не найдена",
      "GTA V не знайдено",
      "GTA V not found",
      "GTA V nicht gefunden",
      "Nie znaleziono GTA V",
      "GTA V introuvable",
    ],
    [
      "Укажите папку с игрой, дальше Astral проверит её сам",
      "Вкажіть теку з грою, далі Astral перевірить її сам",
      "Pick the game folder and Astral will check it",
      "Wählen Sie den Spielordner, Astral prüft ihn selbst",
      "Wskaż folder z grą, a Astral sam go sprawdzi",
      "Indiquez le dossier du jeu, Astral le vérifiera lui-même",
    ],
  ],
  addFolder: [
    [
      "Добавить папку вручную",
      "Додати теку вручну",
      "Add a folder manually",
      "Ordner manuell hinzufügen",
      "Dodaj folder ręcznie",
      "Ajouter un dossier manuellement",
    ],
    [
      "Если Astral не нашёл игру сам",
      "Якщо Astral не знайшов гру сам",
      "For when Astral didn't find the game by itself",
      "Falls Astral das Spiel nicht selbst gefunden hat",
      "Gdy Astral sam nie znalazł gry",
      "Si Astral n'a pas trouvé le jeu tout seul",
    ],
  ],
  addButton: [
    "Выбрать папку",
    "Вибрати теку",
    "Choose folder",
    "Ordner wählen",
    "Wybierz folder",
    "Choisir un dossier",
  ],
  check: [
    [
      "Проверить файлы игры",
      "Перевірити файли гри",
      "Check game files",
      "Spieldateien prüfen",
      "Sprawdź pliki gry",
      "Vérifier les fichiers du jeu",
    ],
    [
      "Сверка файлов, которые меняет Astral, с нужным состоянием",
      "Звіряє файли, які змінює Astral, з потрібним станом",
      "Compares files changed by Astral with their expected state",
      "Vergleicht die von Astral geänderten Dateien mit ihrem Sollzustand",
      "Porównuje pliki zmieniane przez Astral z ich właściwym stanem",
      "Compare les fichiers modifiés par Astral à leur état attendu",
    ],
  ],
  checkButton: [
    "Проверить",
    "Перевірити",
    "Check",
    "Prüfen",
    "Sprawdź",
    "Vérifier",
  ],
  checking: [
    "Проверяю…",
    "Перевіряю…",
    "Checking…",
    "Prüfe…",
    "Sprawdzam…",
    "Vérification…",
  ],
  // Число файлов: русский склоняет слово через общий помощник, украинский и польский ставят число после двоеточия.
  healthy: [
    (files) => `Всё в порядке: проверено ${counted(files, FILES)}`,
    (files) => `Усе гаразд. Перевірено файлів: ${files}`,
    (files) =>
      isOne(files)
        ? `All good: ${files} file matches`
        : `All good: ${files} files match`,
    (files) =>
      isOne(files)
        ? `Alles in Ordnung: ${files} Datei stimmt überein`
        : `Alles in Ordnung: ${files} Dateien stimmen überein`,
    (files) => `Wszystko w porządku. Sprawdzone pliki: ${files}`,
    (files) =>
      isFrenchOne(files)
        ? `Tout va bien\u00a0: ${files} fichier conforme`
        : `Tout va bien\u00a0: ${files} fichiers conformes`,
  ],
  untouched: [
    "Astral пока не менял файлы этой копии, сверять нечего",
    "Astral поки не змінював файли цієї копії, звіряти нічого",
    "Astral hasn't changed files in this copy yet, nothing to compare",
    "Astral hat in dieser Kopie noch keine Dateien geändert, daher gibt es nichts zu prüfen",
    "Astral jeszcze nie zmieniał plików w tej kopii, więc nie ma czego porównywać",
    "Astral n'a pas encore modifié de fichiers dans cette copie, rien à vérifier",
  ],
  drift: [
    (files) =>
      `Расхождения: ${counted(files, FILES)}. Изменено не через Astral`,
    (files) => `Файлів із розбіжностями: ${files}. Їх змінили не через Astral`,
    (files) =>
      `${files} ${isOne(files) ? "file doesn't" : "files don't"} match. Changed outside Astral`,
    (files) =>
      isOne(files)
        ? `${files} Datei weicht ab. Sie wurde außerhalb von Astral geändert`
        : `${files} Dateien weichen ab. Sie wurden außerhalb von Astral geändert`,
    (files) => `Niezgodnych plików: ${files}. Zmieniono je poza Astralem`,
    (files) =>
      isFrenchOne(files)
        ? `${files} fichier non conforme, modifié hors d'Astral`
        : `${files} fichiers non conformes, modifiés hors d'Astral`,
  ],
  repair: [
    "Вернуть как было",
    "Повернути як було",
    "Restore as it was",
    "Wiederherstellen",
    "Przywróć jak było",
    "Rétablir",
  ],
  repairing: [
    "Возвращаю…",
    "Повертаю…",
    "Putting back…",
    "Stelle wieder her…",
    "Przywracam…",
    "Rétablissement…",
  ],
  repaired: [
    "Файлы возвращены, всё совпадает",
    "Файли повернуто, усе збігається",
    "Files restored, everything matches now",
    "Dateien wiederhergestellt, jetzt stimmt alles überein",
    "Pliki przywrócone, wszystko się zgadza",
    "Fichiers rétablis, tout est conforme",
  ],
  /* После «Вернуть как было» движок принял чужие изменения в файле игры основой (П3, 21.11.2026): «всё совпадает» не говорим, чужое Astral не трогает. Функция получает подпись кнопки «Проверить» (`checkButton`): после ответа в ряду стоит только она, «Вернуть как было» появляется лишь после новой проверки с расхождением. */
  repairedAdopted: [
    (button) => `В файле игры остались изменения не от Astral, он их не трогает. Если игра ведёт себя неправильно, проверьте файлы игры в Steam или Rockstar, затем нажмите «${button}»`,
    (button) => `У файлі гри залишилися зміни не від Astral, він їх не чіпає. Якщо гра поводиться неправильно, перевірте файли гри в Steam або Rockstar, потім натисніть «${button}»`,
    (button) => `The game file still has changes that did not come from Astral, and Astral leaves them alone. If the game misbehaves, verify the game files in Steam or Rockstar, then press “${button}”`,
    (button) => `In der Spieldatei sind Änderungen geblieben, die nicht von Astral stammen; Astral rührt sie nicht an. Verhält sich das Spiel falsch: Spieldateien in Steam oder Rockstar prüfen und dann „${button}“ wählen`,
    (button) => `W pliku gry zostały zmiany, które nie pochodzą od Astral, a Astral ich nie rusza. Jeśli gra działa nieprawidłowo, należy sprawdzić pliki gry w Steam lub Rockstar, a następnie użyć „${button}”`,
    (button) => `Le fichier du jeu contient encore des modifications qui ne viennent pas d’Astral\u00a0; Astral n’y touche pas. Si le jeu se comporte mal, vérifiez les fichiers du jeu dans Steam ou Rockstar, puis cliquez sur «\u00a0${button}\u00a0»`,
  ],
  /* После «Вернуть как было» движок не смог принять правки мастерской (небо, фонари) и собрал файл из прежней основы (`patchesNotAdopted` в ответе, 22.11.2026): файлы возвращены, но правки могли сброситься. Не ошибка, строка той же «внимательной» окраски. */
  repairedPatchesLost: [
    "Файлы возвращены, но правки мастерской (небо, фонари и другие) могли сброситься. Примените их заново в мастерской",
    "Файли повернуто, але зміни майстерні (небо, ліхтарі та інші) могли скинутися. Застосуйте їх знову в майстерні",
    "Files restored, but your workshop changes (sky, street lights and others) may have been reset. Apply them again in the workshop",
    "Dateien wiederhergestellt, aber Änderungen aus der Werkstatt (Himmel, Straßenlaternen und andere) wurden möglicherweise zurückgesetzt. Bitte in der Werkstatt erneut anwenden",
    "Pliki przywrócone, ale zmiany z warsztatu (niebo, latarnie i inne) mogły zostać cofnięte. Należy zastosować je ponownie w warsztacie",
    "Fichiers rétablis, mais les modifications de l’atelier (ciel, lampadaires et autres) ont peut-être été réinitialisées. Appliquez-les de nouveau dans l’atelier",
  ],
  suspended: [
    "Запущена игра без модов, сверка пройдёт после её закрытия",
    "Запущено гру без модів, звірка буде після її закриття",
    "A game without mods is running; the check will run once it is closed",
    "Spiel ohne Mods läuft, Prüfung folgt nach dem Schließen",
    "Działa gra bez modów, sprawdzenie po jej zamknięciu",
    "Le jeu sans mods est lancé, la vérification aura lieu à sa fermeture",
  ],
  checkDesktopOnly: [
    "Проверка есть только в «Astral для Windows»",
    "Перевірка є лише в «Astral для Windows»",
    "Checking works only in “Astral for Windows”",
    "Die Prüfung gibt es nur in „Astral für Windows“",
    "Sprawdzanie działa tylko w „Astral dla Windows”",
    "La vérification n'existe que dans «\u00a0Astral pour Windows\u00a0»",
  ],
  danger: [
    "Опасная зона",
    "Небезпечна зона",
    "Danger zone",
    "Gefahrenzone",
    "Strefa zagrożenia",
    "Zone dangereuse",
  ],
  resetConfirm: [
    "Да, удалить все моды",
    "Так, видалити всі моди",
    "Yes, remove every mod",
    "Ja, alle Mods entfernen",
    "Tak, usuń wszystkie mody",
    "Oui, supprimer tous les mods",
  ],
  cancel: ["Отмена", "Скасувати", "Cancel", "Abbrechen", "Anuluj", "Annuler"],
  resetOpen: [
    "Открыть загрузки",
    "Відкрити завантаження",
    "Open Downloads",
    "Downloads öffnen",
    "Otwórz Pobrania",
    "Ouvrir les téléchargements",
  ],
  resetQueued: [
    "В очереди, начнётся после текущей операции",
    "У черзі, почнеться після поточної операції",
    "Queued, will start after the current task",
    "In der Warteschlange, startet nach dem aktuellen Vorgang",
    "W kolejce, ruszy po bieżącej operacji",
    "En attente, démarrera après l'opération en cours",
  ],
  resetRunning: [
    (percent) => `Восстановление GTA V: ${percent}%`,
    (percent) => `Відновлення GTA V: ${percent}%`,
    (percent) => `Restoring: ${percent}%`,
    (percent) => `Wiederherstellung: ${percent} %`,
    (percent) => `Przywracanie: ${percent}%`,
    (percent) => `Rétablissement\u00a0: ${percent}%`,
  ],
  // Пары, которых окно сейчас не показывает; ключи на месте, потому что набор путей сверяется целиком.
  ready: [
    [
      "Готово к установке модов",
      "Готово до встановлення модів",
      "Ready to install mods",
      "Bereit zur Installation von Mods",
      "Gotowe do instalacji modów",
      "Prêt pour l'installation des mods",
    ],
    [
      "Astral видит и игру, и оба загрузчика",
      "Astral бачить і гру, і обидва завантажувачі",
      "Astral finds both the game folder and the loaders",
      "Astral findet den Spielordner und beide Loader",
      "Astral widzi i grę, i oba loadery",
      "Astral trouve le dossier du jeu et les deux loaders",
    ],
  ],
  "needs-loader": [
    [
      "Моды сейчас не установятся",
      "Моди зараз не встановляться",
      "Mods will not install yet",
      "Mods lassen sich gerade nicht installieren",
      "Mody teraz się nie zainstalują",
      "Les mods ne s'installeront pas pour l'instant",
    ],
    [
      "В папке игры нет файлов, без которых мод не запустится",
      "У теці гри немає файлів, без яких мод не запуститься",
      "The game folder lacks files a mod needs in order to start",
      "Im Spielordner fehlen Dateien, die ein Mod zum Start braucht",
      "W folderze gry brakuje plików, bez których mod nie ruszy",
      "Le dossier du jeu ne contient pas les fichiers dont un mod a besoin pour démarrer",
    ],
  ],
  "launcher-busy": [
    [
      "Rockstar Games Launcher запущен",
      "Rockstar Games Launcher запущено",
      "Rockstar Games Launcher is running",
      "Rockstar Games Launcher läuft",
      "Działa Rockstar Games Launcher",
      "Rockstar Games Launcher est lancé",
    ],
    [
      "Rockstar Games Launcher держит файлы: закройте его и GTA V",
      "Rockstar Games Launcher тримає файли: закрийте його та GTA V",
      "Rockstar Games Launcher holds the files: close it and GTA V",
      "Rockstar Games Launcher hält die Dateien: Schließen Sie ihn und GTA V",
      "Launcher blokuje pliki, zamknij go i GTA V",
      "Rockstar Games Launcher retient les fichiers, fermez-le et GTA V",
    ],
  ],
  missing: [
    [
      "Папка GTA V не выбрана",
      "Папку GTA V не вибрано",
      "No GTA V folder selected",
      "Kein GTA-V-Ordner gewählt",
      "Nie wybrano folderu GTA V",
      "Dossier de GTA V non choisi",
    ],
    [
      "Без папки с игрой Astral не может установить ни один мод.",
      "Без теки з грою Astral не може встановити жодного мода.",
      "Without the game folder Astral cannot install any mod.",
      "Ohne Spielordner kann Astral keinen Mod installieren.",
      "Bez folderu z grą Astral nie może zainstalować żadnego moda.",
      "Sans le dossier du jeu, Astral ne peut installer aucun mod.",
    ],
  ],
  folderLabel: [
    "Папка игры",
    "Папка гри",
    "Game folder",
    "Spielordner",
    "Folder gry",
    "Dossier du jeu",
  ],
  installsLabel: [
    "Копии GTA V",
    "Копії GTA V",
    "GTA V copies",
    "GTA-V-Kopien",
    "Kopie GTA V",
    "Installations de GTA V",
  ],
  checksLabel: [
    "Что нужно для модов",
    "Що потрібно для модів",
    "What mods need",
    "Was Mods brauchen",
    "Czego wymagają mody",
    "Ce dont les mods ont besoin",
  ],
  facts: {
    store: ["Магазин", "Магазин", "Store", "Store", "Sklep", "Boutique"],
    edition: ["Издание", "Видання", "Edition", "Edition", "Edycja", "Édition"],
    build: ["Сборка", "Збірка", "Build", "Build", "Kompilacja", "Build"],
    executable: [
      "Файл запуска",
      "Файл запуску",
      "Executable",
      "Startdatei",
      "Plik startowy",
      "Fichier de lancement",
    ],
  },
  unknown: [
    "Неизвестно",
    "Невідомо",
    "Unknown",
    "Unbekannt",
    "Nieznane",
    "Inconnu",
  ],
  checks: {
    loader: [
      "Загрузчик архивов",
      "Завантажувач архівів",
      "Archive loader",
      "Archiv-Loader",
      "Loader archiwów",
      "Loader d'archives",
    ],
    asi: [
      "ASI-загрузчик",
      "ASI-завантажувач",
      "ASI loader",
      "ASI-Loader",
      "Loader ASI",
      "Loader ASI",
    ],
  },
  present: ["Есть", "Є", "Present", "Vorhanden", "Jest", "Présent"],
  absent: ["Не найден", "Не знайдено", "Missing", "Fehlt", "Brak", "Absent"],
  fix: [
    "Установить загрузчики",
    "Встановити завантажувачі",
    "Install the loaders",
    "Loader installieren",
    "Zainstaluj loadery",
    "Installer les loaders",
  ],
  fixing: [
    "Устанавливаем…",
    "Встановлюємо…",
    "Installing…",
    "Wird installiert…",
    "Instaluję…",
    "Installation…",
  ],
  fixNote: [
    "Загрузчики берутся официальные: Astral сам скачает их и положит в папку игры, искать ничего не нужно",
    "Завантажувачі беруться офіційні: Astral сам їх завантажить і покладе в теку гри, шукати нічого не треба",
    "Official loaders only: Astral downloads them itself and puts them in the game folder, no manual search needed",
    "Es werden die offiziellen Loader verwendet: Astral lädt sie selbst herunter und legt sie im Spielordner ab, Suchen entfällt",
    "Loadery są oficjalne: Astral sam je pobierze i umieści w folderze gry, niczego nie trzeba szukać",
    "Ce sont les loaders officiels\u00a0: Astral les télécharge lui-même et les place dans le dossier du jeu, sans recherche manuelle",
  ],
  fixBusy: [
    "Сначала закройте GTA V и Rockstar Games Launcher: пока они держат файлы, подменить их нельзя",
    "Спершу закрийте GTA V і Rockstar Games Launcher: поки вони тримають файли, підмінити їх не можна",
    "Close GTA V and Rockstar Games Launcher first: while they hold the files, they can't be replaced",
    "Schließen Sie zuerst GTA V und den Rockstar Games Launcher: Solange sie die Dateien halten, lassen sie sich nicht ersetzen",
    "Najpierw zamknij GTA V i Rockstar Games Launcher: dopóki trzymają pliki, nie da się ich podmienić",
    "Fermez d'abord GTA V et Rockstar Games Launcher\u00a0: tant qu'ils retiennent les fichiers, on ne peut pas les remplacer",
  ],
  issues: {
    "asi-loader": [
      [
        "Нет ASI-загрузчика",
        "Немає ASI-завантажувача",
        "No ASI loader",
        "Kein ASI-Loader",
        "Brak loadera ASI",
        "Pas de loader ASI",
      ],
      [
        "Для Legacy нужен dinput8.dll или dsound.dll, для Enhanced xinput1_4.dll",
        "Для Legacy потрібен dinput8.dll або dsound.dll, для Enhanced xinput1_4.dll",
        "Legacy needs dinput8.dll or dsound.dll, Enhanced needs xinput1_4.dll",
        "Legacy braucht dinput8.dll oder dsound.dll, Enhanced braucht xinput1_4.dll",
        "Legacy: dinput8.dll lub dsound.dll, Enhanced: xinput1_4.dll",
        "Legacy\u00a0: dinput8.dll ou dsound.dll, Enhanced\u00a0: xinput1_4.dll",
      ],
    ],
    "archive-loader-legacy": [
      [
        "Нет загрузчика архивов",
        "Немає завантажувача архівів",
        "No archive loader",
        "Kein Archiv-Loader",
        "Brak loadera archiwów",
        "Pas de loader d'archives",
      ],
      [
        "Положите в папку игры OpenIV.asi, ClosedIV.asi или RageOpenV.asi",
        "Покладіть у теку гри OpenIV.asi, ClosedIV.asi або RageOpenV.asi",
        "Put OpenIV.asi, ClosedIV.asi or RageOpenV.asi in the game folder",
        "Legen Sie OpenIV.asi, ClosedIV.asi oder RageOpenV.asi in den Spielordner",
        "Wrzuć do folderu gry OpenIV.asi, ClosedIV.asi lub RageOpenV.asi",
        "Placez OpenIV.asi, ClosedIV.asi ou RageOpenV.asi dans le dossier du jeu",
      ],
    ],
    "archive-loader-enhanced": [
      [
        "Нет загрузчика архивов",
        "Немає завантажувача архівів",
        "No archive loader",
        "Kein Archiv-Loader",
        "Brak loadera archiwów",
        "Pas de loader d'archives",
      ],
      [
        "Для Enhanced нужен OpenRPF.asi или RageOpenV.asi",
        "Для Enhanced потрібен OpenRPF.asi або RageOpenV.asi",
        "Enhanced needs OpenRPF.asi or RageOpenV.asi",
        "Enhanced benötigt OpenRPF.asi oder RageOpenV.asi",
        "Enhanced wymaga OpenRPF.asi lub RageOpenV.asi",
        "Enhanced exige OpenRPF.asi ou RageOpenV.asi",
      ],
    ],
    "launcher-busy": [
      [
        "Лаунчер блокирует файлы",
        "Лаунчер блокує файли",
        "Launcher is blocking the files",
        "Launcher blockiert die Dateien",
        "Launcher blokuje pliki",
        "Le launcher bloque les fichiers",
      ],
      [
        "Файлы игры занял Rockstar Games Launcher",
        "Файли гри зайняв Rockstar Games Launcher",
        "Rockstar Games Launcher has locked the game folder",
        "Der Rockstar Games Launcher sperrt den Spielordner",
        "Rockstar Games Launcher zajął pliki gry",
        "Rockstar Games Launcher verrouille le dossier du jeu",
      ],
    ],
  },
};

/* Разворачивает таблицу для одного языка: группа → объект, пара → массив из двух слов, остальное — значение языка. */
function resolve(node, index) {
  if (!Array.isArray(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => [key, resolve(child, index)]),
    );
  }
  return Array.isArray(node[0]) ? node.map((row) => row[index]) : node[index];
}

/** Слова раздела «Игра › GTA V»: ключ — код языка; для незнакомого кода обращение даёт undefined. */
export const gameLocationCopy = Object.fromEntries(
  LANGUAGES.map((language, index) => [language, resolve(TABLE, index)]),
);
