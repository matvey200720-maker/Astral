// Всплывашки оболочки (тосты внизу окна) и решение, что сказать при «Установить» без готовой подготовки GTA V.

// Порядок языков: по нему идут массивы текстов, кавычек и шаблонов ниже.
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Открывающая и закрывающая кавычки языка; во французском внутри них неразрывные пробелы.
const QUOTES = [
  ["«", "»"],
  ["«", "»"],
  ["“", "”"],
  ["„", "“"],
  ["„", "”"],
  ["«\u00a0", "\u00a0»"],
];

const hasValue = (value) => value != null && value !== "" && value === value;

// Тексты без подстановок. Ключ — путь через точку, значения — по порядку LANGUAGES.
// Три причины отказа подготовки (preparation*) без точки в конце: точку и хвост добавляет preparationStop.
const T = {
  launching: [
    "Запускаем GTA V",
    "Запускаємо GTA V",
    "Launching GTA V",
    "GTA V wird gestartet",
    "Uruchamiamy GTA V",
    "Lancement de GTA V",
  ],
  /* Кусок рубежа «Установить у одежды — всегда с выбором» не загрузился (ревью 16.11.2026, находка в): вещь не ставится, человек слышит об этом, а не получает тишину. */
  chooseClothingUnavailable: [
    "Не удалось открыть выбор, на что поставить, — попробуйте ещё раз",
    "Не вдалося відкрити вибір, на що поставити, — спробуйте ще раз",
    "Couldn’t open the choice of what to put it on — try again",
    "Die Auswahl, worauf es gesetzt werden soll, ließ sich nicht öffnen — versuche es noch einmal",
    "Nie udało się otworzyć wyboru, na co ustawić — spróbuj jeszcze raz",
    "Impossible d’ouvrir le choix de l’emplacement — réessayez",
  ],
  cancelled: [
    "Операция отменена",
    "Операцію скасовано",
    "Operation cancelled",
    "Vorgang abgebrochen",
    "Operacja anulowana",
    "Opération annulée",
  ],
  "reset.name": [
    "Вернуть GTA V без модов",
    "Повернути GTA V без модів",
    "Restore GTA V without mods",
    "GTA V ohne Mods wiederherstellen",
    "Przywróć GTA V bez modów",
    "Restaurer GTA V sans mods",
  ],
  "reset.description": [
    "Удаляет все изменения Astral — GTA V снова в исходном виде",
    "Прибирає всі зміни Astral — GTA V знову у вихідному вигляді",
    "Removes all Astral changes, GTA V returns to its original state",
    "Entfernt alle Astral-Änderungen, GTA V ist wieder im Originalzustand",
    "Usuwa wszystkie zmiany Astral — GTA V wraca do stanu początkowego",
    "Supprime toutes les modifications d’Astral\u00a0: GTA V retrouve son état d’origine",
  ],
  "reset.category": [
    "Восстановление",
    "Відновлення",
    "Restoring",
    "Wiederherstellung",
    "Przywracanie",
    "Restauration",
  ],
  "reset.platform": [
    "Все изменения Astral",
    "Усі зміни Astral",
    "All Astral changes",
    "Alle Astral-Modifikationen",
    "Wszystkie zmiany Astral",
    "Toutes les modifications d'Astral",
  ],
  favoriteAdded: [
    "Добавлено в понравившиеся",
    "Додано до вподобаних",
    "Added to favourites",
    "Zu Favoriten hinzugefügt",
    "Dodano do polubionych",
    "Ajouté aux favoris",
  ],
  favoriteRemoved: [
    "Убрано из понравившихся",
    "Прибрано з вподобаних",
    "Removed from favourites",
    "Aus Favoriten entfernt",
    "Usunięto z polubionych",
    "Retiré des favoris",
  ],
  gameClosedRestored: [
    "GTA V закрыта — профиль Astral восстановлен",
    "GTA V закрито — профіль Astral відновлено",
    "GTA V closed — Astral profile restored",
    "GTA V beendet — Astral-Profil wiederhergestellt",
    "GTA V zamknięta — profil Astral przywrócony",
    "GTA V fermé — profil Astral restauré",
  ],
  /* Путь «Витрина» (15.11.2026): окно «Сделать заменёнку» закрылось, работа идёт в «Загрузках». */
  swapStarted: [
    "Заменёнка ставится — в «Загрузках»",
    "Заміна встановлюється — у «Завантаженнях»",
    "Swap is installing — see Downloads",
    "Ersatz wird installiert — siehe Downloads",
    "Zamiennik się instaluje — zobacz Pobrane",
    "Remplacement en cours — voir Téléchargements",
  ],
  finishBeforeGameChange: [
    "Смена GTA V недоступна: дождись конца операций или отмени их",
    "Зміна GTA V недоступна: дочекайся кінця операцій або скасуй їх",
    "Can't change GTA V yet — wait for the operations to finish or cancel them",
    "GTA V jetzt nicht wechselbar — laufende Vorgänge abwarten oder abbrechen",
    "Zmiana GTA V niemożliwa — poczekaj lub anuluj operacje",
    "Impossible de changer GTA V — attendez la fin des opérations ou annulez-les",
  ],
  demoVirtualGame: [
    "Демо-режим: вместо игры виртуальная установка GTA V",
    "Демо-режим: замість гри віртуальна GTA V",
    "Demo mode: virtual GTA V install, no real game",
    "Demo-Modus: virtuelle GTA-V-Installation statt Spiel",
    "Tryb demo: wirtualna instalacja GTA V",
    "Mode démo\u00a0: GTA V virtuel à la place du jeu",
  ],
  demoNoLaunch: [
    "В демо GTA V не запускается — это проверка интерфейса",
    "У демо GTA V не запускається — це перевірка інтерфейсу",
    "Demo mode only tests the interface, GTA V won't launch",
    "Demo-Modus testet nur die Oberfläche, GTA V startet nicht",
    "Demo sprawdza tylko interfejs — GTA V nie startuje",
    "Le mode démo teste l’interface, GTA V ne se lance pas",
  ],
  chooseInstalledGame: [
    "Сначала выбери установку GTA V",
    "Спершу обери встановлення GTA V",
    "Choose a GTA V installation first",
    "Wähle zuerst eine GTA-V-Installation",
    "Najpierw wybierz instalację GTA V",
    "Choisissez d’abord une installation de GTA V",
  ],
  restoreBeforeLaunch: [
    "Перед запуском восстанови конфигурацию Astral",
    "Перед запуском віднови конфігурацію Astral",
    "First restore Astral's configuration, then launch",
    "Bevor du startest: Astral-Konfiguration wiederherstellen",
    "Zanim uruchomisz grę, przywróć konfigurację Astral",
    "Restaurez la configuration d’Astral avant le lancement",
  ],
  demoOperationDone: [
    "Демо-операция выполнена, файлы игры не менялись",
    "Демо-операцію виконано, файли гри не змінювались",
    "Demo operation done, game files were not changed",
    "Demo-Vorgang abgeschlossen, Spieldateien blieben unverändert",
    "Operacja demo wykonana, pliki gry bez zmian",
    "Opération de démo terminée, fichiers du jeu inchangés",
  ],
  finishVanillaGuard: [
    "Сначала заверши Vanilla Guard и восстанови профиль модов",
    "Спершу заверши Vanilla Guard і віднови профіль модів",
    "Finish Vanilla Guard first and restore the mod profile",
    "Beende zuerst Vanilla Guard und stelle das Modprofil wieder her",
    "Zakończ Vanilla Guard, a potem przywróć profil modów",
    "Terminez d’abord Vanilla Guard et restaurez le profil des mods",
  ],
  signInToInstall: [
    "Войди в аккаунт, чтобы ставить моды",
    "Увійди в акаунт, щоб ставити моди",
    "Sign in to install mods",
    "Melde dich an, um Mods zu installieren",
    "Zaloguj się, aby instalować mody",
    "Connectez-vous pour installer des mods",
  ],
  finishPreparation: [
    "Подожди, пока закончится подготовка GTA V",
    "Зачекай, поки закінчиться підготовка GTA V",
    "Wait for the GTA V preparation to finish",
    "GTA V wird noch vorbereitet — warte, bis es fertig ist",
    "Poczekaj, aż GTA V się przygotuje",
    "Attendez la fin de la préparation de GTA V",
  ],
  preparationNeedsAction: [
    "Открой «Настройки»: там подготовка GTA V ждёт от тебя действия.",
    "Відкрий «Налаштування»: там підготовка GTA V чекає на твою дію.",
    "Open “Settings”: the GTA V preparation is waiting for you there.",
    "Öffne „Einstellungen“: Dort wartet die Vorbereitung von GTA V auf dich.",
    "Otwórz „Ustawienia”: tam przygotowanie GTA V czeka na ciebie.",
    "Ouvrez «\u00a0Paramètres\u00a0»\u00a0: la préparation de GTA V vous y attend.",
  ],
  preparationRetry: [
    "Astral сам повторит подготовку, как только получится.",
    "Astral сам повторить підготовку, щойно це буде можливо.",
    "Astral will retry the preparation itself once it can.",
    "Astral wiederholt die Vorbereitung selbst, sobald es geht.",
    "Astral sam ponowi przygotowanie, gdy tylko będzie to możliwe.",
    "Astral relancera la préparation de lui-même dès que possible.",
  ],
  preparationGameOpen: [
    "Закрой GTA V и лаунчер сервера",
    "Закрий GTA V і лаунчер сервера",
    "Close GTA V and the server launcher",
    "Schließe GTA V und den Server-Launcher",
    "Zamknij GTA V i launcher serwera",
    "Fermez GTA V et le lanceur du serveur",
  ],
  preparationBattleye: [
    "Закрой окно BattlEye Launcher",
    "Закрий вікно BattlEye Launcher",
    "Close the BattlEye Launcher window",
    "Schließe das Fenster von BattlEye Launcher",
    "Zamknij okno BattlEye Launcher",
    "Fermez la fenêtre de BattlEye Launcher",
  ],
  preparationLauncherBusy: [
    "Чужой лаунчер обновляет или проверяет GTA V",
    "Чужий лаунчер оновлює чи перевіряє GTA V",
    "Another launcher is updating or checking GTA V",
    "Fremder Launcher aktualisiert oder prüft GTA V",
    "Obcy launcher aktualizuje lub sprawdza GTA V",
    "Un autre lanceur met à jour ou vérifie GTA V",
  ],
  preparationLoadersVanished: [
    "Сразу после установки загрузчики пропали из папки игры — обычно их удаляет антивирус: добавь папку GTA V в исключения",
    "Одразу після встановлення завантажувачі зникли з папки гри — зазвичай їх видаляє антивірус: додай папку GTA V до винятків",
    "The loaders vanished from the game folder right after installation — usually antivirus removes them: add the GTA V folder to its exclusions",
    "Die Loader sind direkt nach der Installation aus dem Spielordner verschwunden — meist löscht sie ein Virenscanner: GTA-V-Ordner zu dessen Ausnahmen hinzufügen",
    "Loadery zniknęły z folderu gry zaraz po instalacji — zwykle usuwa je antywirus: dodaj folder GTA V do jego wyjątków",
    "Les chargeurs ont disparu du dossier du jeu juste après l’installation — c’est généralement l’antivirus\u00a0: ajoutez le dossier de GTA V à ses exclusions",
  ],
  chooseFolder: [
    "Сначала укажи папку GTA V в настройках",
    "Спершу вкажи папку GTA V в налаштуваннях",
    "First set the GTA V folder in settings",
    "GTA-V-Ordner zuerst in den Einstellungen festlegen",
    "Najpierw wskaż folder GTA V w ustawieniach",
    "Indiquez d’abord le dossier de GTA V dans les paramètres",
  ],
  needGameFolder: [
    "Для установки нужна GTA V — укажи её папку",
    "Для встановлення потрібна GTA V — вкажи її папку",
    "GTA V is needed to install mods — choose its folder",
    "Zum Installieren wird GTA V benötigt — wähle den Ordner aus",
    "Do instalacji potrzebna jest GTA V — wskaż jej folder",
    "L’installation exige GTA V\u00a0: indiquez son dossier",
  ],
  unsignedPackage: [
    "Пакет мода не подписан ключом каталога, эта версия Astral его не поставит. Обнови Astral.",
    "Пакет моду не підписано ключем каталогу, ця версія Astral його не встановить. Онови Astral.",
    "This mod's package isn't signed with the catalogue key, so this Astral version can't install it. Update Astral.",
    "Das Modpaket ist nicht mit dem Katalogschlüssel signiert, diese Astral-Version installiert es nicht. Aktualisiere Astral.",
    "Pakiet moda nie jest podpisany kluczem katalogu, ta wersja Astral go nie zainstaluje. Zaktualizuj Astral.",
    "Le paquet du mod n’est pas signé avec la clé du catalogue\u00a0: cette version d’Astral ne peut pas l’installer. Mettez Astral à jour.",
  ],
  noFiles: [
    "У мода нет файлов, поэтому установка недоступна",
    "У моду немає файлів, тож встановлення недоступне",
    "This mod has no files, so it can't be installed",
    "Der Mod hat keine Dateien, Installation nicht möglich",
    "Mod nie ma plików, więc instalacja jest niedostępna",
    "Ce mod n’a aucun fichier, installation impossible",
  ],
  noVerifiedPackage: [
    "У мода нет проверенного установочного пакета",
    "У моду немає перевіреного пакета встановлення",
    "This mod has no verified installation package",
    "Der Mod hat kein geprüftes Installationspaket",
    "Brak sprawdzonego pakietu instalacyjnego tego moda",
    "Ce mod n’a pas de paquet d’installation vérifié",
  ],
  removalQueued: [
    "Удаление добавлено в очередь",
    "Видалення додано в чергу",
    "Removal added to the queue",
    "Entfernen in die Warteschlange gestellt",
    "Usuwanie dodano do kolejki",
    "Suppression ajoutée à la file d’attente",
  ],
  removalManyQueued: [
    "Удаление выбранных модов в очереди",
    "Видалення вибраних модів у черзі",
    "Selected mods queued for removal",
    "Entfernen der gewählten Mods eingereiht",
    "Usuwanie wybranych modów w kolejce",
    "Suppression des mods choisis en file d’attente",
  ],
  resetAlreadyQueued: [
    "Возврат GTA V без модов уже в очереди",
    "Повернення GTA V без модів вже в черзі",
    "Restoring GTA V without mods is already queued",
    "Wiederherstellung von GTA V ohne Mods ist schon eingereiht",
    "Powrót GTA V bez modów już w kolejce",
    "La restauration de GTA V sans mods est déjà en file",
  ],
  shareCodesUnsupported: [
    "Код сборки не читается. Скопируй целиком — он начинается с ASTR1-",
    "Код збірки не читається. Скопіюй повністю — він починається з ASTR1-",
    "Can't read the build code. Copy it whole: it starts with ASTR1-",
    "Der Build-Code ist nicht lesbar. Kopiere ihn vollständig — er beginnt mit ASTR1-",
    "Kod zestawu jest nieczytelny. Skopiuj go w całości — zaczyna się od ASTR1-",
    "Le code du build est illisible. Copiez-le en entier — il commence par ASTR1-",
  ],
  signInAndPrepare: [
    "Войди в аккаунт, затем заверши подготовку GTA V",
    "Увійди в акаунт, потім заверши підготовку GTA V",
    "Sign in, then finish the GTA V preparation",
    "Melde dich zuerst an und schließe dann die Vorbereitung von GTA V ab",
    "Zaloguj się, potem dokończ przygotowanie GTA V",
    "Connectez-vous, puis terminez la préparation de GTA V",
  ],
  demoProfile: [
    "В демо профиль зафиксирован до перезапуска",
    "У демо профіль фіксований до перезапуску",
    "In demo mode the profile is fixed until restart",
    "Demo-Modus: Profil bleibt bis zum Neustart fix",
    "W demo profil jest stały do restartu aplikacji",
    "Mode démo\u00a0: profil figé jusqu’au redémarrage",
  ],
};

// Фразы с названием: $ — первый аргумент, @ — второй; оба берутся в кавычки языка.
// Пустой аргумент уходит вместе со своим знаком и пробелом, двойных пробелов не остаётся.
const TEMPLATES = {
  alreadyQueued: [
    "Уже в очереди: $",
    "Вже в черзі: $",
    "$ is already queued",
    "$ ist schon in der Warteschlange",
    "Już w kolejce: $",
    "Déjà dans la file d’attente\u00a0: $",
  ],
  safeReplacement: [
    "$: безопасно заменит то, что уже стоит",
    "$: безпечно замінить уже встановлене",
    "$: safely replaces the current one",
    "$: ersetzt Vorhandenes sicher",
    "$: bezpiecznie zastąpi to, co już jest",
    "$\u00a0: remplacement sûr de l’existant",
  ],
  layeredOver: [
    "$ ляжет поверх твоей работы из мастерской; без мода она вернётся",
    "$ ляже поверх твоєї роботи з майстерні; без моду вона повернеться",
    "$ covers your workshop work; remove the mod and your work returns",
    "$ liegt über deiner Werkstatt-Arbeit; ohne den Mod ist sie wieder da",
    "$ przykryje twoją pracę z warsztatu; po usunięciu moda wróci ona na miejsce",
    "$ recouvrira votre travail de l’atelier\u00a0; sans le mod, il revient",
  ],
  queued: [
    "Добавлено в очередь: $",
    "Додано в чергу: $",
    "$ added to the queue",
    "$ in die Warteschlange gestellt",
    "Dodano do kolejki: $",
    "Ajouté à la file d’attente\u00a0: $",
  ],
  alreadyInstalled: [
    "Уже установлено: $",
    "Вже встановлено: $",
    "$ is already installed",
    "$ ist bereits installiert",
    "Już zainstalowano: $",
    "Déjà installé\u00a0: $",
  ],
  /* Вещь одежды ставится только из карточки, после выбора «на что поставить» (владелец, 15.11.2026): вход без выбора ведёт на карточку. */
  chooseClothingTarget: [
    "Выберите, на что поставить $ — карточка открыта",
    "Оберіть, на що поставити $ — картку відкрито",
    "Choose what to put $ on — the card is open",
    "Wähle, worauf $ gesetzt werden soll — die Karte ist geöffnet",
    "Wybierz, na co ustawić $ — karta jest otwarta",
    "Choisissez sur quoi mettre $ — la fiche est ouverte",
  ],
  noPublishedRelease: [
    "Нет проверенной опубликованной версии для $",
    "Немає опублікованої перевіреної версії для $",
    "No published, verified version of $",
    "Für $ gibt es keine veröffentlichte, geprüfte Version",
    "Brak opublikowanej, sprawdzonej wersji dla $",
    "Aucune version publiée et vérifiée pour $",
  ],
  buildQueued: [
    "$: установка сборки в очереди",
    "$: встановлення збірки додано в чергу",
    "$: build installation added to the queue",
    "$: Build-Installation eingereiht",
    "$: instalacja zestawu w kolejce",
    "$\u00a0: installation du build mise en file",
  ],
  buildActive: [
    "$ уже установлена целиком",
    "$ вже повністю встановлена",
    "$ is already fully installed",
    "$ ist bereits vollständig installiert",
    "$ jest już w pełni zainstalowany",
    "$ est déjà installé en entier",
  ],
  soundUnder: [
    "Для @ играет твой звук из мастерской, звук мода $ там молчит, пока твой на месте",
    "Для @ грає твій звук із майстерні, звук моду $ там мовчить, поки твій на місці",
    "Your workshop sound plays for @; the mod $ stays silent there while yours is in place",
    "Für @ spielt dein Werkstatt-Sound; der Sound von $ schweigt dort, solange deiner aktiv ist",
    "Dla @ gra twój dźwięk z warsztatu; dźwięk moda $ tam milczy, dopóki twój działa",
    "Pour @, votre son d’atelier joue\u00a0; celui du mod $ y reste muet tant que le vôtre est en place",
  ],
  sharedFarPlates: [
    "В работах $ старая сборка поставила проблемные эмблемы: игра падает на Majestic.",
    "У роботах $ стара збірка поставила проблемні емблеми: гра падає на Majestic.",
    "An old build placed problem emblems in $, so the game crashes on Majestic.",
    "In $ hat ein alter Build problematische Embleme gesetzt: das Spiel stürzt auf Majestic ab.",
    "W $ stara wersja ustawiła problemowe emblematy: gra wywala się na Majestic.",
    "Dans $, une ancienne version a posé des emblèmes problématiques\u00a0: le jeu plante sur Majestic.",
  ],
  rebuiltArenaShells: [
    "Работа $ собрана старой версией: Majestic не принимает такие модели зала, и игра вылетает. Открой арену в мастерской: там кнопки «Пересобрать безопасно» и «Снять».",
    "Робота $ зібрана старою версією: Majestic не приймає такі моделі залу, і гра вилітає. Відкрий арену в майстерні: там кнопки «Перезібрати безпечно» та «Зняти».",
    "The work $ was built by an old version: Majestic rejects such hall models and the game crashes. Open the arena in the workshop and press “Rebuild safely” or “Remove”.",
    "Die Arbeit $ wurde mit einer alten Version gebaut: Majestic lehnt solche Hallenmodelle ab und das Spiel stürzt ab. Öffne die Arena in der Werkstatt und wähle „Sicher neu bauen“ oder „Entfernen“.",
    "Praca $ została zbudowana starą wersją: Majestic odrzuca takie modele hali i gra się wywala. Otwórz arenę w warsztacie i kliknij „Przebuduj bezpiecznie” lub „Usuń”.",
    "Le travail $ a été construit par Astral à l’ancienne\u00a0: Majestic n’accepte actuellement pas ces arènes et le jeu plante. Ouvrez l’arène dans l’atelier et cliquez sur «\u00a0Reconstruire en sécurité\u00a0» ou «\u00a0Retirer\u00a0».",
  ],
  rebuiltArenaRemoved: [
    "Работа $ снята: старая сборка арены вылетала на Majestic. Открой арену в мастерской и нажми «Применить» — соберётся заново и безопасно.",
    "Роботу $ знято: стара збірка арени вилітала на Majestic. Відкрий арену в майстерні й натисни «Застосувати» — збереться заново й безпечно.",
    "The work $ was removed: the old arena build crashed on Majestic. Open the arena in the workshop and press “Apply” — it will be rebuilt safely.",
    "Die Arbeit $ wurde entfernt: Der alte Arena-Build stürzte auf Majestic ab. Öffne die Arena in der Werkstatt und klicke auf „Anwenden“ — sie wird sicher neu gebaut.",
    "Praca $ została usunięta: stara wersja areny wywalała się na Majestic. Otwórz arenę w warsztacie i kliknij „Zastosuj” — zbuduje się od nowa i bezpiecznie.",
    "Le travail $ a été retiré\u00a0: l’ancienne version de l’arène plantait sur Majestic. Ouvrez l’arène dans l’atelier et cliquez sur «\u00a0Appliquer\u00a0» — elle sera reconstruite en toute sécurité.",
  ],
  heavyArenaShells: [
    "В работах $ оболочка зала арены из старой версии занимает вдвое больше памяти, чем нужно: игра на Majestic может падать.",
    "У роботах $ оболонка залу арени зі старої версії займає вдвічі більше пам'яті, ніж треба: гра на Majestic може падати.",
    "The arena hall shell in $ is from an old version and uses twice the memory needed, so the game may crash on Majestic.",
    "Die Arena-Hallenhülle in $ stammt aus einer alten Version und braucht doppelt so viel Speicher, das Spiel kann auf Majestic abstürzen.",
    "Osłona hali areny w $ pochodzi ze starej wersji i zajmuje dwa razy więcej pamięci, więc gra na Majestic może się wywalać.",
    "La coque de la salle d’arène dans $ vient d’une ancienne version et occupe deux fois plus de mémoire, le jeu peut donc planter sur Majestic.",
  ],
};

// Общий хвост двух последних фраз: что сделать с работами.
const OPEN_WORKS = [
  "Открой их в мастерской и нажми «Применить».",
  "Відкрий їх у майстерні й натисни «Застосувати».",
  "Open them in the workshop and press “Apply”.",
  "Öffne sie in der Werkstatt und klicke auf „Anwenden“.",
  "Otwórz je w warsztacie i kliknij „Zastosuj”.",
  "Ouvrez-les dans l’atelier et cliquez sur «\u00a0Appliquer\u00a0».",
];
for (const key of ["sharedFarPlates", "heavyArenaShells"]) {
  TEMPLATES[key] = TEMPLATES[key].map((text, i) => `${text} ${OPEN_WORKS[i]}`);
}

function fill(text, [open, close], args) {
  return text
    .replace(
      /(\xa0?: | )?([$@])(\xa0?:|[;,])?/g,
      (all, before = "", mark, after = "") => {
        const value = args[+(mark === "@")];
        return hasValue(value) ? before + open + value + close + after : "";
      },
    )
    .trim();
}

function buildNotices(i) {
  const notices = { quotes: [...QUOTES[i]] };
  for (const [path, texts] of Object.entries(T)) {
    const [group, key] = path.split(".");
    if (key) (notices[group] ??= {})[key] = texts[i];
    else notices[group] = texts[i];
  }
  for (const [key, texts] of Object.entries(TEMPLATES)) {
    notices[key] = (name, ...more) =>
      fill(texts[i], QUOTES[i], [name, more[0]]);
  }
  return notices;
}

const NOTICES = new Map(
  LANGUAGES.map((language, i) => [language, buildNotices(i)]),
);

export function shellNoticesFor(language) {
  return NOTICES.get(language) ?? NOTICES.get("en");
}

// Начала русских сообщений главного процесса — внешний контракт, менять нельзя.
const KNOWN_REASONS = [
  ["Закройте GTA V", "preparationGameOpen"],
  ["Игры уже нет, но осталось окно BattlEye Launcher", "preparationBattleye"],
  ["Лаунчер обновляет", "preparationLauncherBusy"],
  ["Файлы загрузчиков исчезли", "preparationLoadersVanished"],
];

// Причина отказа в виде, пригодном для человека на этом языке; пустая строка — показывать нечего.
function readableReason(message, notices, language) {
  let reason = typeof message === "string" ? message.trim() : "";
  const russian = /[Ѐ-ӿ]/.test(reason);
  if (language !== "ru" && russian) {
    const known = KNOWN_REASONS.find(([start]) => reason.startsWith(start));
    reason = known ? notices[known[1]] : "";
  } else if (language === "ru" && !russian) {
    return "";
  }
  return reason.replace(/[.\s]+$/, "");
}

// Подпись дока «Подготовка GTA V» (22.11.2026, релиз 1.0.0): при отказе — причина тем же разбором, что в строке-стопе (русское сообщение главного процесса не показывается в окне на другом языке); иначе подпись как есть.
export function preparationLine(status, message, language = "ru") {
  if (status !== "error") return message;
  const notices = shellNoticesFor(language);
  return readableReason(message, notices, language) || notices.preparationRetry;
}

export function preparationStop(
  status,
  game,
  notices,
  message,
  language = "ru",
) {
  if (!game) {
    return { text: notices.needGameFolder, pick: true };
  }
  if (status !== "needs-action" && status !== "error") {
    return { text: notices.finishPreparation, pick: false };
  }
  const failed = status === "error";
  const tail = failed
    ? notices.preparationRetry
    : notices.preparationNeedsAction;
  const reason = readableReason(message, notices, language);
  return {
    text: reason ? `${reason}. ${tail}` : tail,
    pick: false,
    retry: failed,
    tone: "error",
  };
}
