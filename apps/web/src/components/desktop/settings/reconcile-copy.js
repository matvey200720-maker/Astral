/*
 * «Настройки › Логи › Сверка с игрой» (ТЗ H1, 14.11.2026): запись сверки
 * (`@modovik/minimap-contract/reconcile`, формат — в шапке того файла)
 * человеческими строками на шести языках (ru, uk, en, de, pl, fr; для
 * остальных — английский) и полный текст для «Скопировать».
 *
 * Таблица «ключ → [ru, uk, en, de, pl, fr]», как в `rockstar-mode-copy.js`;
 * `{имя}` подставляется из данных записи.
 */

import { factLabel, factRows } from "./reconcile-facts-copy.js";

const ORDER = ["ru", "uk", "en", "de", "pl", "fr"];
const LOCALE = {
  ru: "ru-RU",
  uk: "uk-UA",
  en: "en-GB",
  de: "de-DE",
  pl: "pl-PL",
  fr: "fr-FR",
};

const TEXT = {
  title: [
    "Сверка с игрой",
    "Звірка з грою",
    "Game check",
    "Abgleich mit dem Spiel",
    "Zgodność z grą",
    "Vérification avec le jeu",
  ],
  intro: [
    "Что Astral записал в игру при каждом «Применить» экрана игры: какой у вас экран, что посчитано и что прочиталось обратно. Запись можно скопировать и отправить в поддержку.",
    "Що Astral записав у гру під час кожного «Застосувати» екрана гри: який у вас екран, що пораховано і що прочиталось назад. Запис можна скопіювати й надіслати в підтримку.",
    "What Astral wrote into the game on every “Apply” of a game-screen editor: what your screen is, what was calculated and what was read back. You can copy the record and send it to support.",
    "Was Astral bei jedem „Anwenden“ eines Bildschirm-Editors ins Spiel geschrieben hat: Ihr Bildschirm, das Berechnete und das, was zurückgelesen wurde. Der Eintrag lässt sich kopieren und an den Support senden.",
    "Co Astral zapisał w grze przy każdym „Zastosuj” edytora ekranu gry: jaki masz ekran, co policzono i co odczytano z powrotem. Wpis można skopiować i wysłać do wsparcia.",
    "Ce qu'Astral a écrit dans le jeu à chaque «\u00a0Appliquer\u00a0» d'un éditeur d'écran de jeu\u00a0: votre écran, ce qui a été calculé et ce qui a été relu. Vous pouvez copier l'entrée et l'envoyer au support.",
  ],
  empty: [
    "Сверок пока не было: записи появятся после «Применить» мини-карты, прицела, счётчика патронов или счётчика урона.",
    "Записів поки немає: вони з'являться після «Застосувати» мінікарти, прицілу, лічильника набоїв або лічильника шкоди.",
    "No records yet: they appear after “Apply” of the minimap, crosshair, ammo counter or damage counter.",
    "Noch keine Einträge: Sie erscheinen nach „Anwenden“ von Minimap, Fadenkreuz, Munitionsanzeige oder Schadensanzeige.",
    "Na razie brak wpisów: pojawią się po „Zastosuj” minimapy, celownika, licznika amunicji lub licznika obrażeń.",
    "Aucune entrée pour l'instant\u00a0: elles apparaissent après «\u00a0Appliquer\u00a0» de la mini-carte, du viseur, du compteur de munitions ou du compteur de dégâts.",
  ],
  copyAll: [
    "Скопировать всё",
    "Скопіювати все",
    "Copy all",
    "Alles kopieren",
    "Skopiuj wszystko",
    "Tout copier",
  ],
  copyOne: [
    "Скопировать",
    "Скопіювати",
    "Copy",
    "Kopieren",
    "Skopiuj",
    "Copier",
  ],
  copied: [
    "Скопировано",
    "Скопійовано",
    "Copied",
    "Kopiert",
    "Skopiowano",
    "Copié",
  ],
  refresh: [
    "Обновить",
    "Оновити",
    "Refresh",
    "Aktualisieren",
    "Odśwież",
    "Actualiser",
  ],
  count: [
    "Записей: {n}",
    "Записів: {n}",
    "Records: {n}",
    "Einträge: {n}",
    "Wpisów: {n}",
    "Entrées\u00a0: {n}",
  ],
  details: [
    "Подробности",
    "Подробиці",
    "Details",
    "Details",
    "Szczegóły",
    "Détails",
  ],

  editorMinimap: [
    "Мини-карта",
    "Мінікарта",
    "Minimap",
    "Minimap",
    "Minimapa",
    "Mini-carte",
  ],
  editorReticle: [
    "Прицел",
    "Приціл",
    "Crosshair",
    "Fadenkreuz",
    "Celownik",
    "Viseur",
  ],
  editorAmmo: [
    "Счётчик патронов",
    "Лічильник набоїв",
    "Ammo counter",
    "Munitionsanzeige",
    "Licznik amunicji",
    "Compteur de munitions",
  ],
  editorDamage: [
    "Счётчик урона",
    "Лічильник шкоди",
    "Damage counter",
    "Schadensanzeige",
    "Licznik obrażeń",
    "Compteur de dégâts",
  ],
  triggerApply: [
    "«Применить»",
    "«Застосувати»",
    "“Apply”",
    "„Anwenden“",
    "„Zastosuj”",
    "«\u00a0Appliquer\u00a0»",
  ],
  triggerRemap: [
    "перестановка при запуске",
    "перестановка під час запуску",
    "re-placing at launch",
    "Neuplatzierung beim Start",
    "ponowne ustawienie przy starcie",
    "replacement au lancement",
  ],
  triggerRepair: [
    "автопересборка после починки фильма",
    "автопересборка після полагодження фільму",
    "automatic rebuild after the film repair",
    "automatischer Neuaufbau nach der Filmreparatur",
    "automatyczna przebudowa po naprawie filmu",
    "reconstruction automatique après la réparation du film",
  ],

  sectionGame: [
    "Экран игры",
    "Екран гри",
    "Game screen",
    "Spielbildschirm",
    "Ekran gry",
    "Écran du jeu",
  ],
  sectionWindow: [
    "Экран окна",
    "Екран вікна",
    "Window screen",
    "Fensterbildschirm",
    "Ekran okna",
    "Écran de la fenêtre",
  ],
  sectionChosen: [
    "Что выставлено",
    "Що виставлено",
    "What was set",
    "Was eingestellt wurde",
    "Co ustawiono",
    "Ce qui a été réglé",
  ],
  sectionComputed: [
    "Что посчитано",
    "Що пораховано",
    "What was calculated",
    "Was berechnet wurde",
    "Co policzono",
    "Ce qui a été calculé",
  ],
  sectionWritten: [
    "Что записано",
    "Що записано",
    "What was written",
    "Was geschrieben wurde",
    "Co zapisano",
    "Ce qui a été écrit",
  ],
  sectionVerify: [
    "Проверка",
    "Перевірка",
    "Check",
    "Prüfung",
    "Sprawdzenie",
    "Vérification",
  ],

  work: [
    "Работа: «{name}» ({id})",
    "Робота: «{name}» ({id})",
    "Work: “{name}” ({id})",
    "Arbeit: „{name}“ ({id})",
    "Praca: „{name}” ({id})",
    "Travail\u00a0: «\u00a0{name}\u00a0» ({id})",
  ],
  version: [
    "Astral {astral} · формула места {formula}",
    "Astral {astral} · формула місця {formula}",
    "Astral {astral} · placement formula {formula}",
    "Astral {astral} · Platzierungsformel {formula}",
    "Astral {astral} · formuła położenia {formula}",
    "Astral {astral} · formule de placement {formula}",
  ],
  versionUnknown: [
    "версия неизвестна",
    "версія невідома",
    "version unknown",
    "Version unbekannt",
    "wersja nieznana",
    "version inconnue",
  ],

  screenKnown: [
    "{resolution}, формат {form}{stretched}, безопасная зона {zone}, отступ {inset}",
    "{resolution}, формат {form}{stretched}, безпечна зона {zone}, відступ {inset}",
    "{resolution}, format {form}{stretched}, safe zone {zone}, margin {inset}",
    "{resolution}, Format {form}{stretched}, sicherer Bereich {zone}, Rand {inset}",
    "{resolution}, format {form}{stretched}, strefa bezpieczna {zone}, margines {inset}",
    "{resolution}, format {form}{stretched}, zone de sécurité {zone}, marge {inset}",
  ],
  stretched: [
    " (растянут)",
    " (розтягнуто)",
    " (stretched)",
    " (gestreckt)",
    " (rozciągnięty)",
    " (étiré)",
  ],
  resolutionUnknown: [
    "разрешение неизвестно",
    "роздільність невідома",
    "resolution unknown",
    "Auflösung unbekannt",
    "rozdzielczość nieznana",
    "résolution inconnue",
  ],
  zoneUnknown: [
    "не прочиталась",
    "не прочиталась",
    "not read",
    "nicht gelesen",
    "nie odczytano",
    "non lue",
  ],
  rawSettings: [
    "settings.xml: AspectRatio = {aspect}, ScreenWidth = {width}, ScreenHeight = {height}, Windowed = {windowed}{when}",
    "settings.xml: AspectRatio = {aspect}, ScreenWidth = {width}, ScreenHeight = {height}, Windowed = {windowed}{when}",
    "settings.xml: AspectRatio = {aspect}, ScreenWidth = {width}, ScreenHeight = {height}, Windowed = {windowed}{when}",
    "settings.xml: AspectRatio = {aspect}, ScreenWidth = {width}, ScreenHeight = {height}, Windowed = {windowed}{when}",
    "settings.xml: AspectRatio = {aspect}, ScreenWidth = {width}, ScreenHeight = {height}, Windowed = {windowed}{when}",
    "settings.xml: AspectRatio = {aspect}, ScreenWidth = {width}, ScreenHeight = {height}, Windowed = {windowed}{when}",
  ],
  rawSettingsNone: [
    "settings.xml: не найден",
    "settings.xml: не знайдено",
    "settings.xml: not found",
    "settings.xml: nicht gefunden",
    "settings.xml: nie znaleziono",
    "settings.xml\u00a0: introuvable",
  ],
  rawProfile: [
    "Профиль {name}: настройка 212 = {step}{when}",
    "Профіль {name}: налаштування 212 = {step}{when}",
    "Profile {name}: setting 212 = {step}{when}",
    "Profil {name}: Einstellung 212 = {step}{when}",
    "Profil {name}: ustawienie 212 = {step}{when}",
    "Profil {name}\u00a0: réglage 212 = {step}{when}",
  ],
  rawProfileNone: [
    "Профиль игрока не найден — отступ по умолчанию",
    "Профіль гравця не знайдено — відступ за замовчуванням",
    "Player profile not found — default margin",
    "Spielerprofil nicht gefunden — Standardrand",
    "Nie znaleziono profilu gracza — domyślny margines",
    "Profil du joueur introuvable — marge par défaut",
  ],
  fileTime: [
    " (изменён {time})",
    " (змінено {time})",
    " (changed {time})",
    " (geändert {time})",
    " (zmieniono {time})",
    " (modifié {time})",
  ],
  sourceAspect: [
    "Откуда формат: {source}",
    "Звідки формат: {source}",
    "Format from: {source}",
    "Format aus: {source}",
    "Skąd format: {source}",
    "Origine du format\u00a0: {source}",
  ],
  sourceInset: [
    "Откуда отступ: {source}",
    "Звідки відступ: {source}",
    "Margin from: {source}",
    "Rand aus: {source}",
    "Skąd margines: {source}",
    "Origine de la marge\u00a0: {source}",
  ],
  aspectFromSettings: [
    "AspectRatio из settings.xml",
    "AspectRatio із settings.xml",
    "AspectRatio from settings.xml",
    "AspectRatio aus settings.xml",
    "AspectRatio z settings.xml",
    "AspectRatio de settings.xml",
  ],
  aspectAuto: [
    "Авто: по разрешению",
    "Авто: за роздільністю",
    "Auto: from the resolution",
    "Auto: aus der Auflösung",
    "Auto: z rozdzielczości",
    "Auto\u00a0: d'après la résolution",
  ],
  aspectDefault: [
    "нет файла — по умолчанию",
    "немає файлу — за замовчуванням",
    "no file — default",
    "keine Datei — Standard",
    "brak pliku — domyślnie",
    "pas de fichier — par défaut",
  ],
  unknown: [
    "не узнать",
    "не дізнатися",
    "cannot be known",
    "nicht zu ermitteln",
    "nie do ustalenia",
    "impossible à connaître",
  ],
  insetFromProfile: [
    "настройка 212 профиля",
    "налаштування 212 профілю",
    "profile setting 212",
    "Profileinstellung 212",
    "ustawienie 212 profilu",
    "réglage 212 du profil",
  ],
  insetDefault: [
    "профиля нет — по умолчанию",
    "профілю немає — за замовчуванням",
    "no profile — default",
    "kein Profil — Standard",
    "brak profilu — domyślnie",
    "pas de profil — par défaut",
  ],
  screenUnknown: [
    "Экран игры не узнать ({reason}) — расчёт для 16:9",
    "Екран гри не дізнатися ({reason}) — розрахунок для 16:9",
    "The game screen cannot be known ({reason}) — calculated for 16:9",
    "Der Spielbildschirm ist nicht zu ermitteln ({reason}) — berechnet für 16:9",
    "Nie da się ustalić ekranu gry ({reason}) — obliczono dla 16:9",
    "Écran du jeu impossible à connaître ({reason}) — calcul pour 16:9",
  ],
  reasonNoFile: [
    "нет settings.xml",
    "немає settings.xml",
    "no settings.xml",
    "keine settings.xml",
    "brak settings.xml",
    "pas de settings.xml",
  ],
  reasonEnhanced: [
    "у GTA V Enhanced настройки не читаются",
    "у GTA V Enhanced налаштування не читаються",
    "GTA V Enhanced settings are not read",
    "bei GTA V Enhanced werden die Einstellungen nicht gelesen",
    "W GTA V Enhanced ustawienia nie są odczytywane",
    "les réglages de GTA V Enhanced ne sont pas lus",
  ],
  reasonUnreadable: [
    "файл не прочитался",
    "файл не прочитався",
    "the file could not be read",
    "die Datei ließ sich nicht lesen",
    "nie udało się odczytać pliku",
    "le fichier n'a pas pu être lu",
  ],

  windowLine: [
    "{form}, отступ {inset} — {source}",
    "{form}, відступ {inset} — {source}",
    "{form}, margin {inset} — {source}",
    "{form}, Rand {inset} — {source}",
    "{form}, margines {inset} — {source}",
    "{form}, marge {inset} — {source}",
  ],
  windowManual: [
    "выбран вручную",
    "обрано вручну",
    "chosen by hand",
    "von Hand gewählt",
    "wybrano ręcznie",
    "choisi à la main",
  ],
  windowDetected: [
    "по экрану игры",
    "за екраном гри",
    "from the game screen",
    "nach dem Spielbildschirm",
    "według ekranu gry",
    "d'après l'écran du jeu",
  ],
  windowAsWindow: [
    "«в игре у меня как здесь»",
    "«у грі в мене як тут»",
    "“the game is the same as here”",
    "„im Spiel genauso wie hier“",
    "„w grze mam tak samo jak tutaj”",
    "«\u00a0dans le jeu comme ici\u00a0»",
  ],
  windowStage: [
    "сцена 16:9",
    "сцена 16:9",
    "16:9 stage",
    "16:9-Bühne",
    "scena 16:9",
    "scène 16:9",
  ],

  chosenMap: [
    "Положение: смещение X {x}, Y {y}, размер {scale}, ширина {stretch}, развёрнутый радар — {expanded}",
    "Розташування: зсув X {x}, Y {y}, розмір {scale}, ширина {stretch}, розгорнутий радар — {expanded}",
    "Placement: offset X {x}, Y {y}, size {scale}, width {stretch}, expanded radar — {expanded}",
    "Position: Versatz X {x}, Y {y}, Größe {scale}, Breite {stretch}, erweitertes Radar — {expanded}",
    "Położenie: przesunięcie X {x}, Y {y}, rozmiar {scale}, szerokość {stretch}, rozwinięty radar — {expanded}",
    "Position\u00a0: décalage X {x}, Y {y}, taille {scale}, largeur {stretch}, radar agrandi — {expanded}",
  ],
  expandedLeft: ["слева", "ліворуч", "left", "links", "po lewej", "à gauche"],
  expandedCenter: [
    "по центру",
    "по центру",
    "centred",
    "mittig",
    "na środku",
    "au centre",
  ],
  placementLine: [
    "После пересчёта под экран игры: смещение X {x}, Y {y}, размер {scale}, ширина {stretch}",
    "Після перерахунку під екран гри: зсув X {x}, Y {y}, розмір {scale}, ширина {stretch}",
    "After conversion for the game screen: offset X {x}, Y {y}, size {scale}, width {stretch}",
    "Nach der Umrechnung für den Spielbildschirm: Versatz X {x}, Y {y}, Größe {scale}, Breite {stretch}",
    "Po przeliczeniu na ekran gry: przesunięcie X {x}, Y {y}, rozmiar {scale}, szerokość {stretch}",
    "Après conversion pour l'écran du jeu\u00a0: décalage X {x}, Y {y}, taille {scale}, largeur {stretch}",
  ],
  stockPlace: [
    "Штатное положение: числа игры не менялись",
    "Штатне розташування: числа гри не змінювались",
    "Stock placement: the game's numbers were not changed",
    "Standardposition: Die Zahlen des Spiels blieben unverändert",
    "Położenie standardowe: liczby gry nie zostały zmienione",
    "Position d'origine\u00a0: les nombres du jeu n'ont pas changé",
  ],
  rectWindow: [
    "Кадр в окне: слева {left}, сверху {top}, ширина {width}, высота {height}",
    "Кадр у вікні: зліва {left}, зверху {top}, ширина {width}, висота {height}",
    "Frame in the window: left {left}, top {top}, width {width}, height {height}",
    "Rahmen im Fenster: links {left}, oben {top}, Breite {width}, Höhe {height}",
    "Ramka w oknie: z lewej {left}, z góry {top}, szerokość {width}, wysokość {height}",
    "Cadre dans la fenêtre\u00a0: gauche {left}, haut {top}, largeur {width}, hauteur {height}",
  ],
  rectGame: [
    "Кадр на экране игры: слева {left}, сверху {top}, ширина {width}, высота {height}{pixels}",
    "Кадр на екрані гри: зліва {left}, зверху {top}, ширина {width}, висота {height}{pixels}",
    "Frame on the game screen: left {left}, top {top}, width {width}, height {height}{pixels}",
    "Rahmen auf dem Spielbildschirm: links {left}, oben {top}, Breite {width}, Höhe {height}{pixels}",
    "Ramka na ekranie gry: z lewej {left}, z góry {top}, szerokość {width}, wysokość {height}{pixels}",
    "Cadre sur l'écran du jeu\u00a0: gauche {left}, haut {top}, largeur {width}, hauteur {height}{pixels}",
  ],
  rectPixels: [
    " — в пикселях: {left}, {top}, {width}×{height} из {of}",
    " — у пікселях: {left}, {top}, {width}×{height} з {of}",
    " — in pixels: {left}, {top}, {width}×{height} of {of}",
    " — in Pixeln: {left}, {top}, {width}×{height} von {of}",
    " — w pikselach: {left}, {top}, {width}×{height} z {of}",
    " — en pixels\u00a0: {left}, {top}, {width}×{height} sur {of}",
  ],
  entryLine: [
    "frontend.xml, {name}: {changes}",
    "frontend.xml, {name}: {changes}",
    "frontend.xml, {name}: {changes}",
    "frontend.xml, {name}: {changes}",
    "frontend.xml, {name}: {changes}",
    "frontend.xml, {name}\u00a0: {changes}",
  ],
  noClamps: [
    "Зажимов нет: все числа встали как посчитаны",
    "Обмежень немає: усі числа стали як пораховано",
    "No clamping: every number went in as calculated",
    "Keine Begrenzung: alle Zahlen wurden wie berechnet eingesetzt",
    "Brak ograniczeń: wszystkie liczby weszły tak, jak policzono",
    "Aucun plafonnement\u00a0: tous les nombres sont entrés tels que calculés",
  ],
  clampLine: [
    "Зажим: {field} — нужно {wanted}, поставлено {used} (предел {from}…{to})",
    "Обмеження: {field} — потрібно {wanted}, поставлено {used} (межа {from}…{to})",
    "Clamped: {field} — needed {wanted}, set {used} (limit {from}…{to})",
    "Begrenzt: {field} — nötig {wanted}, gesetzt {used} (Grenze {from}…{to})",
    "Ograniczenie: {field} — potrzeba {wanted}, ustawiono {used} (granica {from}…{to})",
    "Plafonné\u00a0: {field} — nécessaire {wanted}, réglé {used} (limite {from}…{to})",
  ],
  moved: [
    "Кадр не влезал на экран — подтянут на экран",
    "Кадр не вміщався на екран — підтягнуто на екран",
    "The frame did not fit on the screen — pulled onto it",
    "Der Rahmen passte nicht auf den Bildschirm — wurde hineingezogen",
    "Ramka nie mieściła się na ekranie — przesunięto ją na ekran",
    "Le cadre ne tenait pas à l'écran — ramené dans l'écran",
  ],

  written: [
    "{target}: {size} Б, sha256 {sha}",
    "{target}: {size} Б, sha256 {sha}",
    "{target}: {size} B, sha256 {sha}",
    "{target}: {size} B, sha256 {sha}",
    "{target}: {size} B, sha256 {sha}",
    "{target}\u00a0: {size} o, sha256 {sha}",
  ],
  writtenNone: [
    "Файлы в запись не попали",
    "Файли до запису не потрапили",
    "No files were written",
    "Keine Dateien wurden geschrieben",
    "Żadne pliki nie zostały zapisane",
    "Aucun fichier n'a été écrit",
  ],
  engineLine: [
    "Движок: {text}",
    "Рушій: {text}",
    "Engine: {text}",
    "Engine: {text}",
    "Silnik: {text}",
    "Moteur\u00a0: {text}",
  ],
  engineVerified: [
    "записанное прочитано обратно и сверено",
    "записане прочитано назад і звірено",
    "what was written was read back and compared",
    "Geschriebenes wurde zurückgelesen und verglichen",
    "zapisane odczytano z powrotem i porównano",
    "l'écriture a été relue et comparée",
  ],
  enginePassed: [
    "проверка записи пройдена",
    "перевірка запису пройдена",
    "the write check passed",
    "Schreibprüfung bestanden",
    "sprawdzenie zapisu zakończone powodzeniem",
    "la vérification de l'écriture est réussie",
  ],
  engineArchives: [
    "поставлено архивов: {count}",
    "встановлено архівів: {count}",
    "archives installed: {count}",
    "installierte Archive: {count}",
    "zainstalowano archiwów: {count}",
    "archives installées : {count}",
  ],
  engineFinalizer: [
    "заголовок архива дописан: {value}",
    "заголовок архіву дописано: {value}",
    "archive header finished by: {value}",
    "Archivkopf ergänzt durch: {value}",
    "nagłówek archiwum uzupełniono: {value}",
    "en-tête de l'archive complété par : {value}",
  ],
  engineKeySource: [
    "ключи шифрования: {value}",
    "ключі шифрування: {value}",
    "encryption keys: {value}",
    "Verschlüsselungsschlüssel: {value}",
    "klucze szyfrowania: {value}",
    "clés de chiffrement : {value}",
  ],
  engineRestorePoint: [
    "точка отката на момент установки: {id}",
    "точка відкоту на момент встановлення: {id}",
    "restore point at the time of install: {id}",
    "Wiederherstellungspunkt zum Zeitpunkt der Installation: {id}",
    "punkt przywracania z chwili instalacji: {id}",
    "point de restauration au moment de l\u2019installation\u00a0: {id}",
  ],
  engineNone: [
    "итог проверки не пришёл",
    "підсумок перевірки не надійшов",
    "no check result came back",
    "kein Prüfergebnis erhalten",
    "nie przyszedł wynik sprawdzenia",
    "aucun résultat de vérification reçu",
  ],
  frontendOk: [
    "frontend.xml прочитан из установленного архива: {count} записей совпали с расчётом",
    "frontend.xml прочитано зі встановленого архіву: {count} записів збіглися з розрахунком",
    "frontend.xml read from the installed archive: {count} entries match the calculation",
    "frontend.xml aus dem installierten Archiv gelesen: {count} Einträge stimmen mit der Rechnung überein",
    "frontend.xml odczytano z zainstalowanego archiwum: {count} wpisów zgadza się z obliczeniem",
    "frontend.xml relu dans l'archive installée\u00a0: {count} entrées correspondent au calcul",
  ],
  frontendBad: [
    "frontend.xml из установленного архива НЕ совпал с расчётом: {list}",
    "frontend.xml зі встановленого архіву НЕ збігся з розрахунком: {list}",
    "frontend.xml from the installed archive does NOT match the calculation: {list}",
    "frontend.xml aus dem installierten Archiv stimmt NICHT mit der Rechnung überein: {list}",
    "frontend.xml z zainstalowanego archiwum NIE zgadza się z obliczeniem: {list}",
    "frontend.xml de l'archive installée ne correspond PAS au calcul\u00a0: {list}",
  ],
  frontendDiff: [
    "{name}.{key}: ждали {expected}, прочитали {read}",
    "{name}.{key}: чекали {expected}, прочитали {read}",
    "{name}.{key}: expected {expected}, read {read}",
    "{name}.{key}: erwartet {expected}, gelesen {read}",
    "{name}.{key}: oczekiwano {expected}, odczytano {read}",
    "{name}.{key}\u00a0: attendu {expected}, lu {read}",
  ],
  frontendNone: [
    "frontend.xml обратно не читался",
    "frontend.xml назад не читався",
    "frontend.xml was not read back",
    "frontend.xml wurde nicht zurückgelesen",
    "frontend.xml nie był odczytywany z powrotem",
    "frontend.xml n'a pas été relu",
  ],
  problemFrontend: [
    "frontend.xml не совпал с расчётом",
    "frontend.xml не збігся з розрахунком",
    "frontend.xml does not match the calculation",
    "frontend.xml stimmt nicht mit der Rechnung überein",
    "frontend.xml nie zgadza się z obliczeniem",
    "frontend.xml ne correspond pas au calcul",
  ],
  problemUnreadable: [
    "frontend.xml не удалось прочитать обратно",
    "frontend.xml не вдалося прочитати назад",
    "frontend.xml could not be read back",
    "frontend.xml ließ sich nicht zurücklesen",
    "nie udało się odczytać frontend.xml z powrotem",
    "frontend.xml n'a pas pu être relu",
  ],
  problemMissing: [
    "движок не вернул итог проверки",
    "рушій не повернув підсумок перевірки",
    "the engine returned no check result",
    "die Engine lieferte kein Prüfergebnis",
    "silnik nie zwrócił wyniku sprawdzenia",
    "le moteur n'a renvoyé aucun résultat de vérification",
  ],
  problemRect: [
    "кадр в игре не там же, где в окне (не влез на экран)",
    "кадр у грі не там, де у вікні (не вмістився на екран)",
    "the frame in the game is not where it is in the window (it did not fit the screen)",
    "der Rahmen im Spiel sitzt nicht dort wie im Fenster (er passte nicht auf den Bildschirm)",
    "ramka w grze nie jest tam, gdzie w oknie (nie zmieściła się na ekranie)",
    "le cadre dans le jeu n'est pas au même endroit que dans la fenêtre (il ne tenait pas à l'écran)",
  ],
  problems: [
    "Замечания: {list}",
    "Зауваження: {list}",
    "Notes: {list}",
    "Hinweise: {list}",
    "Uwagi: {list}",
    "Remarques\u00a0: {list}",
  ],
  trimmed: [
    "Запись сокращена, чтобы влезть в журнал",
    "Запис скорочено, щоб вміститися в журнал",
    "The record was shortened to fit the log",
    "Der Eintrag wurde gekürzt, damit er ins Protokoll passt",
    "Wpis skrócono, aby zmieścił się w dzienniku",
    "L'entrée a été raccourcie pour tenir dans le journal",
  ],
};

/** Ключи таблицы — для проверки шести колонок. */
export const RECONCILE_TEXT = TEXT;

const pick = (language) => {
  const index = ORDER.indexOf(language);
  return (key) => TEXT[key][index < 0 ? 2 : index];
};

const fill = (template, data) =>
  template.replace(/\{(\w+)\}/g, (_, key) =>
    data[key] === undefined || data[key] === null ? "" : String(data[key]),
  );

const dash = "—";

function formats(language) {
  const locale = LOCALE[language] || LOCALE.en;
  /* Пустое значение — тире, а не «0»: `Number(null)` — нуль, и «отступ 0 %» у записи прицела было бы неправдой. */
  const known = (value) =>
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value));
  const number = (value, digits = 3) =>
    known(value)
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
          Number(value),
        )
      : dash;
  const percent = (value) =>
    known(value)
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value) * 100)}\u00a0%`
      : dash;
  const stamp = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  };
  return { number, percent, stamp };
}

/**
 * Запись сверки → строки на языке. Возвращает
 * `{ title, sections: [{ id, title, rows }], text }`, где `text` — всё одним куском для «Скопировать».
 */
export function renderReconcile(record, language = "ru") {
  const t = pick(language);
  const { number, percent, stamp } = formats(language);
  /* Параметры записи словами на языке; незнакомое поле — как есть (`reconcile-facts-copy.js`). */
  const facts = (value) => factRows(value, { language, number });
  const game = record?.game || {};
  const raw = game.raw || {};
  const editorKey = {
    minimap: "editorMinimap",
    reticle: "editorReticle",
    ammo: "editorAmmo",
    damage: "editorDamage",
  }[record?.editor];
  const editor = editorKey ? t(editorKey) : String(record?.editor || "");
  const trigger =
    {
      remap: t("triggerRemap"),
      repair: t("triggerRepair"),
    }[record?.trigger] || t("triggerApply");
  const title = [stamp(record?.at), editor, trigger]
    .filter(Boolean)
    .join(" · ");
  const header = [];
  if (record?.work)
    header.push(
      fill(t("work"), {
        name: record.work.name || dash,
        id: record.work.id || dash,
      }),
    );
  header.push(
    fill(t("version"), {
      astral: record?.astral || t("versionUnknown"),
      formula: record?.formula || dash,
    }),
  );

  /* Экран игры: сырьё → форма и отступ → источник. */
  const gameRows = [];
  if (game.known) {
    gameRows.push(
      fill(t("screenKnown"), {
        resolution: game.resolution || t("resolutionUnknown"),
        form: game.form || dash,
        stretched: game.stretched ? t("stretched") : "",
        zone: Number.isInteger(game.safeZoneStep)
          ? game.safeZoneStep
          : t("zoneUnknown"),
        inset: percent(game.inset),
      }),
    );
  } else {
    const reason =
      {
        "no-file": t("reasonNoFile"),
        enhanced: t("reasonEnhanced"),
        unreadable: t("reasonUnreadable"),
      }[game.reason] || String(game.reason || dash);
    gameRows.push(fill(t("screenUnknown"), { reason }));
  }
  if (raw.settingsFile || raw.aspectRatio != null || raw.windowed != null) {
    const when = raw.settingsFile?.mtime
      ? fill(t("fileTime"), { time: stamp(raw.settingsFile.mtime) })
      : "";
    gameRows.push(
      fill(t("rawSettings"), {
        aspect: raw.aspectRatio ?? dash,
        width: game.width ?? dash,
        height: game.height ?? dash,
        windowed: raw.windowed ?? dash,
        when,
      }),
    );
  } else if (!game.known) gameRows.push(t("rawSettingsNone"));
  if (raw.profile) {
    gameRows.push(
      fill(t("rawProfile"), {
        name: raw.profile.name || dash,
        step: Number.isInteger(raw.safeZoneStep) ? raw.safeZoneStep : dash,
        when: raw.profile.mtime
          ? fill(t("fileTime"), { time: stamp(raw.profile.mtime) })
          : "",
      }),
    );
  } else if (game.known) gameRows.push(t("rawProfileNone"));
  const aspectSource = {
    settings: t("aspectFromSettings"),
    "auto-resolution": t("aspectAuto"),
    default: t("aspectDefault"),
    unknown: t("unknown"),
  }[game.sources?.aspect];
  const insetSource = {
    profile: t("insetFromProfile"),
    default: t("insetDefault"),
    unknown: t("unknown"),
  }[game.sources?.inset];
  if (aspectSource)
    gameRows.push(fill(t("sourceAspect"), { source: aspectSource }));
  if (insetSource)
    gameRows.push(fill(t("sourceInset"), { source: insetSource }));

  /* Экран окна. */
  const windowRows = [];
  if (record?.window) {
    const source =
      {
        manual: t("windowManual"),
        detected: t("windowDetected"),
        "as-window": t("windowAsWindow"),
        stage: t("windowStage"),
      }[record.window.source] || String(record.window.source || dash);
    windowRows.push(
      fill(t("windowLine"), {
        form: record.window.form || dash,
        inset: percent(record.window.inset),
        source,
      }),
    );
  }

  /* Что выставил человек. */
  const chosenRows = [];
  const map = record?.chosen?.map;
  if (map && typeof map === "object") {
    chosenRows.push(
      fill(t("chosenMap"), {
        x: number(map.offsetX),
        y: number(map.offsetY),
        scale: percent(map.scale),
        stretch: percent(map.stretch),
        expanded:
          map.expanded === "center" ? t("expandedCenter") : t("expandedLeft"),
      }),
    );
    const rest = { ...record.chosen };
    delete rest.map;
    chosenRows.push(...facts(rest));
  } else if (record?.chosen) chosenRows.push(...facts(record.chosen));

  /* Что посчитано. */
  const computed = record?.computed || {};
  const computedRows = [];
  if (computed.stockPlace) computedRows.push(t("stockPlace"));
  if (computed.placement)
    computedRows.push(
      fill(t("placementLine"), {
        x: number(computed.placement.offsetX),
        y: number(computed.placement.offsetY),
        scale: percent(computed.placement.scale),
        stretch: percent(computed.placement.stretch),
      }),
    );
  const rectRow = (key, rect, withPixels) => {
    const f = rect?.fractions;
    if (!f) return;
    const p =
      withPixels && rect.pixels
        ? fill(t("rectPixels"), {
            left: rect.pixels.left,
            top: rect.pixels.top,
            width: rect.pixels.width,
            height: rect.pixels.height,
            of: rect.pixels.of,
          })
        : "";
    computedRows.push(
      fill(t(key), {
        left: percent(f.left),
        top: percent(f.top),
        width: percent(f.width),
        height: percent(f.height),
        pixels: p,
      }),
    );
  };
  rectRow("rectWindow", computed.windowRect, false);
  rectRow("rectGame", computed.gameRect, true);
  for (const entry of Array.isArray(computed.entries) ? computed.entries : []) {
    const changes = ["posX", "posY", "sizeX", "sizeY"]
      .map(
        (key) =>
          `${key} ${entry.before ? `${number(entry.before[key], 6)} → ` : ""}${number(entry.after?.[key], 6)}`,
      )
      .join(", ");
    computedRows.push(fill(t("entryLine"), { name: entry.name, changes }));
  }
  if (record?.editor === "minimap" && computed.clamps) {
    if (computed.clamps.length === 0) computedRows.push(t("noClamps"));
    for (const clamp of computed.clamps)
      computedRows.push(
        fill(t("clampLine"), {
          field: factLabel(`clamp.${clamp.field}`, language) ?? clamp.field,
          wanted: number(clamp.wanted),
          used: number(clamp.used),
          from: number(clamp.limit?.[0]),
          to: number(clamp.limit?.[1]),
        }),
      );
  }
  if (computed.moved) computedRows.push(t("moved"));
  if (record?.editor !== "minimap") {
    const rest = { ...computed };
    delete rest.entries;
    computedRows.push(...facts(rest));
  }

  /* Что записано. */
  const writtenRows = (record?.written || []).map((item) =>
    fill(t("written"), {
      target: item.target || dash,
      size: item.size ?? dash,
      sha: String(item.sha256 || "").slice(0, 12) || dash,
    }),
  );
  if (!writtenRows.length) writtenRows.push(t("writtenNone"));

  /* Проверка. */
  const verifyRows = [];
  const engine = record?.verify?.engine;
  /* Итог движка: проверка пройдена (`passed`, как его отдаёт `engineVerifyFacts`; `verified` — прежний вид) и точка отката
     этой установки — подписана «на момент установки»: позже она могла смениться. */
  const engineText = engine
    ? engine.verified === true || engine.passed === true
      ? [
          engine.passed === true ? t("enginePassed") : t("engineVerified"),
          engine.restorePoint
            ? fill(t("engineRestorePoint"), { id: engine.restorePoint })
            : "",
          Array.isArray(engine.archives) && engine.archives.length
            ? fill(t("engineArchives"), { count: engine.archives.length })
            : "",
          engine.finalizer
            ? fill(t("engineFinalizer"), { value: engine.finalizer })
            : "",
          engine.keySource
            ? fill(t("engineKeySource"), { value: engine.keySource })
            : "",
        ]
          .filter(Boolean)
          .join("; ")
      : facts(engine).join(", ")
    : t("engineNone");
  verifyRows.push(fill(t("engineLine"), { text: engineText }));
  const frontend = record?.verify?.frontend;
  if (frontend) {
    if (frontend.matches)
      verifyRows.push(
        fill(t("frontendOk"), {
          count: Object.keys(frontend.read || {}).length,
        }),
      );
    else
      verifyRows.push(
        fill(t("frontendBad"), {
          list: (frontend.diffs || [])
            .slice(0, 5)
            .map((diff) =>
              fill(t("frontendDiff"), {
                name: diff.name,
                key: diff.key,
                expected: number(diff.expected, 6),
                read: number(diff.read, 6),
              }),
            )
            .join("; "),
        }),
      );
  } else if (record?.editor === "minimap") verifyRows.push(t("frontendNone"));
  if (record?.problems?.length) {
    const words = {
      "frontend-mismatch": t("problemFrontend"),
      "verify-unreadable": t("problemUnreadable"),
      "verify-missing": t("problemMissing"),
      "rect-mismatch": t("problemRect"),
    };
    verifyRows.push(
      fill(t("problems"), {
        list: record.problems.map((code) => words[code] || code).join("; "),
      }),
    );
  }
  if (record?.trimmed) verifyRows.push(t("trimmed"));

  const sections = [
    { id: "header", title: "", rows: header },
    { id: "game", title: t("sectionGame"), rows: gameRows },
    { id: "window", title: t("sectionWindow"), rows: windowRows },
    { id: "chosen", title: t("sectionChosen"), rows: chosenRows },
    { id: "computed", title: t("sectionComputed"), rows: computedRows },
    { id: "written", title: t("sectionWritten"), rows: writtenRows },
    { id: "verify", title: t("sectionVerify"), rows: verifyRows },
  ].filter((section) => section.rows.length > 0);
  const text = [
    title,
    ...sections.flatMap((section) =>
      [
        section.title ? `${section.title}:` : "",
        ...section.rows.map((row) => (section.title ? `  ${row}` : row)),
      ].filter(Boolean),
    ),
  ].join("\n");
  return { title, sections, text };
}

/** Строки раздела на языке (`ru`, `uk`, `en`, `de`, `pl`, `fr`; иначе английский). */
export function reconcileCopyFor(language) {
  const t = pick(language);
  return Object.fromEntries(Object.keys(TEXT).map((key) => [key, t(key)]));
}
