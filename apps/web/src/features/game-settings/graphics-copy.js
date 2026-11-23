// Слова страницы «Настройки графики» на шести языках.
// В таблицах порядок строк в каждой записи один: ru, uk, en, de, pl, fr.
// В шаблонах функций {0}, {1} — аргументы по порядку.
const LANGS = ["ru", "uk", "en", "de", "pl", "fr"];
const LOCALES = ["ru-RU", "uk-UA", "en-US", "de-DE", "pl-PL", "fr-FR"];
const MINUS = "\u2212";
const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

const SAVE_AS = [
  "Сохранить как свой",
  "Зберегти як власний",
  "Save as my template",
  "Als eigene Vorlage speichern",
  "Zapisz jako własny",
  "Enregistrer comme mon modèle",
];
const OWN_TEMPLATE = [
  "Свой шаблон",
  "Власний шаблон",
  "My template",
  "Eigene Vorlage",
  "Własny szablon",
  "Mon modèle",
];
const PAGE_TITLE = [
  "Настройки графики",
  "Налаштування графіки",
  "Graphics settings",
  "Grafikeinstellungen",
  "Ustawienia grafiki",
  "Paramètres graphiques",
];
const SAVE = [
  "Сохранить",
  "Зберегти",
  "Save",
  "Speichern",
  "Zapisz",
  "Enregistrer",
];

// Обычные строки: путь в объекте слов → шесть языков.
const TEXT = {
  title: PAGE_TITLE,
  description: [
    "Готовые шаблоны графики для ПК разной мощности. Выберите шаблон и при желании подправьте его параметры. Astral запишет результат в settings.xml игры.",
    "Готові шаблони графіки для ПК різної потужності. Виберіть шаблон і за бажанням підправте його параметри. Astral запише результат у settings.xml гри.",
    "Ready-made graphics templates for PCs of different power. Pick one, adjust it if you wish; Astral saves it to the game’s settings.xml.",
    "Fertige Grafikvorlagen für PCs unterschiedlicher Leistung. Wählen Sie eine aus und passen Sie sie bei Bedarf an; Astral schreibt sie in die settings.xml des Spiels.",
    "Gotowe szablony grafiki dla komputerów o różnej mocy. Wybierz szablon i w razie potrzeby dopasuj jego parametry. Astral zapisze wynik w pliku settings.xml gry.",
    "Modèles graphiques prêts à l'emploi pour des PC de puissances variées. Choisissez un modèle et ajustez-le si besoin\u00a0: Astral enregistre le résultat dans le fichier settings.xml du jeu.",
  ],
  templatesLabel: [
    "Шаблоны графики",
    "Шаблони графіки",
    "Graphics templates",
    "Grafikvorlagen",
    "Szablony grafiki",
    "Modèles graphiques",
  ],
  newTemplate: OWN_TEMPLATE,
  newTemplateNote: [
    "Берёт текущие настройки игры",
    "Бере налаштування з гри",
    "Starts from current game settings",
    "Übernimmt die aktuellen Spieleinstellungen",
    "Zaczyna od ustawień z gry",
    "Part des réglages actuels du jeu",
  ],
  inGame: ["В игре", "У грі", "In game", "Im Spiel", "W grze", "En jeu"],
  open: [
    "Открыть и подстроить",
    "Відкрити й підлаштувати",
    "Open and tune",
    "Öffnen und anpassen",
    "Otwórz i dopasuj",
    "Ouvrir et ajuster",
  ],
  apply: [
    "Применить в игре",
    "Застосувати в грі",
    "Apply in game",
    "Im Spiel anwenden",
    "Zastosuj w grze",
    "Appliquer dans le jeu",
  ],
  mine: ["Мой", "Мій", "Mine", "Meine", "Mój", "Le mien"],
  applying: [
    "Записываем…",
    "Записуємо…",
    "Writing…",
    "Wird geschrieben…",
    "Zapisywanie…",
    "Écriture…",
  ],
  restore: [
    "Вернуть как было",
    "Повернути як було",
    "Restore previous",
    "Wie zuvor wiederherstellen",
    "Przywróć jak było",
    "Restaurer l'état précédent",
  ],
  restoring: [
    "Возвращаем…",
    "Повертаємо…",
    "Restoring…",
    "Wird wiederhergestellt…",
    "Przywracanie…",
    "Restauration…",
  ],
  standard: [
    "Стандарт",
    "Стандарт",
    "Default",
    "Standard",
    "Standard",
    "Standard",
  ],
  standardTitle: [
    "Вернёт графику, как было до Astral, из копии файла настроек, сохранённой до первой правки",
    "Поверне графіку, як було до Astral, з копії файлу налаштувань, збереженої до першої правки",
    "Restores the graphics as they were before Astral, from the settings copy saved before its first change",
    "Stellt die Grafik wie vor Astral wieder her, aus der vor der ersten Änderung gesicherten Dateikopie",
    "Przywróci grafikę sprzed Astral z kopii pliku ustawień zapisanej przed pierwszą zmianą",
    "Rétablit les graphismes d'avant Astral depuis la copie des réglages faite avant la première modification",
  ],
  restored: [
    "Графика теперь как до Astral",
    "Графіка тепер як до Astral",
    "Graphics are back to how they were before Astral",
    "Grafik wie vor Astral",
    "Grafika wróciła do stanu sprzed Astral",
    "Graphismes rétablis comme avant Astral",
  ],

  "groups.astral": [
    "Шаблоны Astral",
    "Шаблони Astral",
    "Astral templates",
    "Astral-Vorlagen",
    "Szablony Astral",
    "Modèles Astral",
  ],
  "groups.community": [
    "От игроков",
    "Від гравців",
    "From players",
    "Von Spielern",
    "Od graczy",
    "Des joueurs",
  ],
  "groups.own": [
    "Мои шаблоны",
    "Мої шаблони",
    "My templates",
    "Meine Vorlagen",
    "Moje szablony",
    "Mes modèles",
  ],

  "recommend.badge": [
    "Рекомендуем",
    "Рекомендуємо",
    "Recommended",
    "Empfohlen",
    "Polecany",
    "Recommandé",
  ],

  "gameLine.browser": [
    "В браузере нет файлов игры. Шаблон запишет Astral Desktop в файл Документы\\Rockstar Games\\GTA V\\settings.xml",
    "У браузері немає файлів гри. Шаблон запише Astral Desktop у файл Документи\\Rockstar Games\\GTA V\\settings.xml",
    "The browser has no game files. Astral Desktop writes templates to the file Documents\\Rockstar Games\\GTA V\\settings.xml",
    "Im Browser gibt es keine Spieldateien. Astral Desktop schreibt Vorlagen in die Datei Dokumente\\Rockstar Games\\GTA V\\settings.xml",
    "W przeglądarce nie ma plików gry. Szablony zapisuje Astral Desktop w pliku Dokumenty\\Rockstar Games\\GTA V\\settings.xml",
    "Le navigateur n'a pas accès aux fichiers du jeu. Astral Desktop enregistre les modèles dans le fichier Documents\\Rockstar Games\\GTA V\\settings.xml",
  ],
  "gameLine.missing": [
    "Файл settings.xml не найден. Запустите GTA V хотя бы раз, и игра создаст его сама.",
    "Файл settings.xml не знайдено. Запустіть GTA V бодай раз, і гра створить його сама.",
    "settings.xml was not found. Launch GTA V at least once and the game will create it.",
    "Die Datei settings.xml wurde nicht gefunden. Starten Sie GTA V mindestens einmal, dann legt das Spiel sie selbst an.",
    "Nie znaleziono pliku settings.xml. Uruchom GTA V choć raz, a gra utworzy go sama.",
    "Le fichier settings.xml est introuvable. Lancez GTA V au moins une fois\u00a0: le jeu le créera lui-même.",
  ],
  "gameLine.loading": [
    "Читаем settings.xml…",
    "Читаємо settings.xml…",
    "Reading settings.xml…",
    "settings.xml wird gelesen…",
    "Wczytywanie settings.xml…",
    "Lecture de settings.xml…",
  ],

  "editor.kicker": PAGE_TITLE,
  "editor.title": [
    "Шаблон графики",
    "Шаблон графіки",
    "Graphics template",
    "Grafikvorlage",
    "Szablon grafiki",
    "Modèle graphique",
  ],
  "editor.back": [
    "К шаблонам",
    "До шаблонів",
    "Back to templates",
    "Zu den Vorlagen",
    "Do szablonów",
    "Retour aux modèles",
  ],
  "editor.save": SAVE,
  "editor.saveAs": SAVE_AS,
  "editor.delete": [
    "Удалить шаблон",
    "Видалити шаблон",
    "Delete template",
    "Vorlage löschen",
    "Usuń szablon",
    "Supprimer le modèle",
  ],
  "editor.belowMin": [
    "Ниже самого низкого в меню игры; из меню такое не выбрать",
    "Нижче найнижчого в меню гри; із меню таке не вибрати",
    "Below the lowest option in the game menu; only a file can set it",
    "Unter dem niedrigsten Wert im Spielmenü; nur per Datei einstellbar",
    "Poniżej najniższej wartości w menu gry; tylko z pliku",
    "Sous le minimum du menu du jeu\u00a0; réglable uniquement via le fichier",
  ],
  "editor.standardTitle": [
    "Подставит в черновик графику как до Astral; в игре появится после «Применить»",
    "Підставить у чернетку графіку як до Astral; у грі з'явиться після «Застосувати»",
    "Puts pre-Astral graphics in the draft; the game changes only after “Apply”",
    "Setzt die Grafik wie vor Astral in den Entwurf; im Spiel erst nach „Anwenden“",
    "Wstawia do wersji roboczej grafikę sprzed Astral; w grze po „Zastosuj”",
    "Place les graphismes d'avant Astral dans le brouillon\u00a0; le jeu ne change qu'après «\u00a0Appliquer\u00a0»",
  ],
  "editor.special": [
    "Особые значения шаблона",
    "Особливі значення шаблону",
    "Special template values",
    "Besondere Vorlagenwerte",
    "Szczególne wartości szablonu",
    "Valeurs spéciales du modèle",
  ],
  "editor.specialNote": [
    "Параметры, которым автор шаблона задал значения ниже минимума игры или вне её меню. Astral записывает их как есть; ползунок или переключатель заменит значение обычным.",
    "Параметри, яким автор шаблону задав значення нижче мінімуму гри або поза її меню. Astral записує їх як є; повзунок чи перемикач замінить значення звичайним.",
    "Parameters the template author set below the game minimum or outside its menu. Astral writes them unchanged; moving the slider or switch swaps in a regular menu value.",
    "Parameter, deren Werte der Vorlagenautor unter dem Spielminimum oder außerhalb des Spielmenüs gesetzt hat. Astral schreibt sie unverändert; bewegt man Regler oder Schalter, gilt wieder ein normaler Menüwert.",
    "Parametry z wartościami poniżej minimum gry lub spoza jej menu. Astral zapisuje je bez zmian; ruszenie suwaka lub przełącznika zastąpi wartość zwykłą z menu.",
    "Paramètres dont l'auteur du modèle a fixé la valeur sous le minimum du jeu ou hors de son menu. Astral les écrit tels quels\u00a0; déplacer le curseur ou l'interrupteur la remplace par une valeur normale du menu.",
  ],

  "editor.summary.vram": [
    "Видеопамять",
    "Відеопам'ять",
    "Video memory",
    "Videospeicher",
    "Pamięć wideo",
    "Mémoire vidéo",
  ],
  "editor.summary.vramNote": [
    "Оценка по settings.xml",
    "Оцінка за settings.xml",
    "Estimated from settings.xml",
    "Schätzung aus settings.xml",
    "Szacunek na podstawie settings.xml",
    "Estimation d'après settings.xml",
  ],
  "editor.summary.game": [
    "Изменится в игре",
    "Зміниться в грі",
    "Will change in game",
    "Ändert sich im Spiel",
    "Zmieni się w grze",
    "Changera dans le jeu",
  ],
  "editor.summary.base": [
    "Основа",
    "Основа",
    "Base",
    "Basis",
    "Podstawa",
    "Base",
  ],

  "editor.saveDialog.title": OWN_TEMPLATE,
  "editor.saveDialog.description": [
    "Шаблон появится в «Моих шаблонах» и сохранится после перезапуска лаунчера.",
    "Шаблон з'явиться в «Моїх шаблонах» і збережеться після перезапуску лаунчера.",
    "The template goes to “My templates” and stays after the launcher restarts.",
    "Die Vorlage erscheint unter „Meine Vorlagen“ und bleibt nach einem Launcher-Neustart erhalten.",
    "Szablon znajdzie się w „Moich szablonach” i zostanie po restarcie launchera.",
    "Le modèle sera dans «\u00a0Mes modèles\u00a0» et restera après le redémarrage du lanceur.",
  ],
  "editor.saveDialog.name": [
    "Название",
    "Назва",
    "Name",
    "Name",
    "Nazwa",
    "Nom",
  ],
  "editor.saveDialog.placeholder": [
    "Например, «Для стримов»",
    "Наприклад, «Для стримів»",
    "For example, “Streaming”",
    "Zum Beispiel „Fürs Streaming“",
    "Na przykład „Do streamów”",
    "Par exemple «\u00a0Pour le stream\u00a0»",
  ],
  "editor.saveDialog.confirm": SAVE,
  "editor.saveDialog.cancel": [
    "Отмена",
    "Скасувати",
    "Cancel",
    "Abbrechen",
    "Anuluj",
    "Annuler",
  ],

  "editor.leaveDialog.title": [
    "Изменения не сохранены",
    "Зміни не збережено",
    "Unsaved changes",
    "Änderungen nicht gespeichert",
    "Zmiany niezapisane",
    "Modifications non enregistrées",
  ],
  "editor.leaveDialog.description": [
    "Правки внесены, но шаблон не сохранён. Чтобы не потерять их, сохраните его как свой.",
    "Зміни внесено, але шаблон не збережено. Щоб не втратити їх, збережіть його як власний.",
    "Changes were made, but the template is unsaved. To keep them, use “Save as my template”.",
    "Es wurden Änderungen vorgenommen, die Vorlage ist aber nicht gespeichert. Damit sie nicht verloren gehen, speichern Sie sie als eigene Vorlage.",
    "Wprowadzono zmiany, ale szablon nie został zapisany. Aby ich nie stracić, zapisz go jako własny.",
    "Des modifications ont été faites, mais le modèle n'est pas enregistré. Pour ne pas les perdre, enregistrez-le comme votre modèle.",
  ],
  "editor.leaveDialog.save": SAVE_AS,
  "editor.leaveDialog.discard": [
    "Выйти без сохранения",
    "Вийти без збереження",
    "Leave without saving",
    "Ohne Speichern verlassen",
    "Wyjdź bez zapisywania",
    "Quitter sans enregistrer",
  ],
  "editor.leaveDialog.stay": [
    "Остаться",
    "Залишитися",
    "Stay",
    "Bleiben",
    "Zostań",
    "Rester",
  ],
};

// Функции из одного шаблона подстановки.
const PATTERNS = {
  author: [
    "Автор — {0}",
    "Автор — {0}",
    "By {0}",
    "Von {0}",
    "Autor: {0}",
    "Par {0}",
  ],
  applyTitle: [
    "Записать «{0}» в settings.xml игры",
    "Записати «{0}» у settings.xml гри",
    "Write “{0}” to the game’s settings.xml",
    "„{0}“ in die settings.xml des Spiels schreiben",
    "Zapisz „{0}” w settings.xml gry",
    "Écrire «\u00a0{0}\u00a0» dans le settings.xml du jeu",
  ],
  applied: [
    "Шаблон «{0}» записан в settings.xml. Запустите игру.",
    "Шаблон «{0}» записано в settings.xml. Запустіть гру.",
    "Template “{0}” saved to settings.xml. Launch the game to see it.",
    "Vorlage „{0}“ in settings.xml gespeichert. Starten Sie das Spiel.",
    "Szablon „{0}” zapisany w settings.xml. Uruchom grę.",
    "Modèle «\u00a0{0}\u00a0» enregistré dans settings.xml. Lancez le jeu.",
  ],
  "gameLine.template": [
    "В игре сейчас «{0}» · {1}",
    "У грі зараз «{0}» · {1}",
    "In game now: “{0}” · {1}",
    "Aktuell im Spiel: „{0}“ · {1}",
    "W grze teraz: „{0}” · {1}",
    "En jeu actuellement\u00a0: «\u00a0{0}\u00a0» · {1}",
  ],
  "gameLine.custom": [
    "В игре сейчас свои настройки · {0}",
    "У грі зараз власні налаштування · {0}",
    "In game now: custom settings · {0}",
    "Aktuell im Spiel: eigene Einstellungen · {0}",
    "W grze teraz: własne ustawienia · {0}",
    "En jeu actuellement\u00a0: réglages personnalisés · {0}",
  ],
  "editor.inGame": [
    "в игре: {0}",
    "у грі: {0}",
    "in game: {0}",
    "im Spiel: {0}",
    "w grze: {0}",
    "en jeu\u00a0: {0}",
  ],
  "editor.fps": [
    "FPS: {0}",
    "FPS: {0}",
    "FPS: {0}",
    "FPS: {0}",
    "FPS: {0}",
    "FPS\u00a0: {0}",
  ],
  "editor.supersampling": [
    "Масштаб кадра {0} — сверхвыборка (нагрузка выше)",
    "Масштаб кадру {0} — суперсемплінг (навантаження вище)",
    "Frame scale {0} is supersampling, heavier than 100 %",
    "Skalierung {0} ist Supersampling, aufwendiger als 100 %",
    "Skala obrazu {0} to supersampling, większe obciążenie niż 100 %",
    "Échelle d'image {0}\u00a0: supersampling, plus lourd que 100\u00a0%",
  ],
  "editor.deleted": [
    "Шаблон «{0}» удалён",
    "Шаблон «{0}» видалено",
    "Template “{0}” deleted",
    "Vorlage „{0}“ gelöscht",
    "Szablon „{0}” usunięty",
    "Modèle «\u00a0{0}\u00a0» supprimé",
  ],
  "editor.saved": [
    "Шаблон «{0}» сохранён",
    "Шаблон «{0}» збережено",
    "Template “{0}” saved",
    "Vorlage „{0}“ gespeichert",
    "Szablon „{0}” zapisany",
    "Modèle «\u00a0{0}\u00a0» enregistré",
  ],
};

// Состояние редактора: правки есть (второй аргумент — их число) или нет.
const STATUS_CHANGED = [
  "«{0}» · изменено: {1}",
  "«{0}» · змінено: {1}",
  "“{0}” · changed: {1}",
  "„{0}“ · geändert: {1}",
  "„{0}” · zmienione: {1}",
  "«\u00a0{0}\u00a0» · modifié\u00a0: {1}",
];
const STATUS_SAME = [
  "«{0}» · без изменений",
  "«{0}» · без змін",
  "“{0}” · unchanged",
  "„{0}“ · unverändert",
  "„{0}” · bez zmian",
  "«\u00a0{0}\u00a0» · inchangé",
];

// Оценка видеопамяти: хвост после числа (единица и название величины).
const VRAM_TAIL = [
  " ГБ видеопамяти",
  " ГБ відеопам'яті",
  " GB of video memory",
  " GB Videospeicher",
  " GB pamięci wideo",
  "\u00a0Go de mémoire vidéo",
];

const BASED_ON = [
  "На основе «{0}»",
  "На основі «{0}»",
  "Based on “{0}”",
  "Basiert auf „{0}“",
  "Na bazie „{0}”",
  "Basé sur «\u00a0{0}\u00a0»",
];
// Запасное имя, когда названия исходного шаблона нет.
const BASED_ON_FALLBACK = [
  "Свой набор",
  "Власний набір",
  "Own set",
  "Eigenes Set",
  "Własny zestaw",
  "Réglages personnalisés",
];

// Строка состояния: в какие издания игры пишется шаблон.
const EDITIONS_BOTH = [
  "Шаблон пишется в оба издания: GTA V Legacy и GTA V Enhanced. У Enhanced свой файл настроек, масштаб кадра там остаётся своим.",
  "Шаблон пишеться в обидва видання: GTA V Legacy і GTA V Enhanced. Масштаб кадру в Enhanced окремий.",
  "Template goes to both editions: GTA V Legacy and GTA V Enhanced. Enhanced keeps its own scale.",
  "Die Vorlage wird in beide Editionen geschrieben: GTA V Legacy und GTA V Enhanced. Enhanced-Skalierung bleibt separat.",
  "Szablon trafia do obu edycji: GTA V Legacy i GTA V Enhanced. Skala w Enhanced jest osobna.",
  "Le modèle va dans les deux éditions\u00a0: GTA V Legacy et GTA V Enhanced. Échelle d'Enhanced distincte.",
];
const EDITIONS_ONE = [
  "Найдено только издание Enhanced: шаблон пишется в его settings.xml",
  "Знайдено лише видання Enhanced: шаблон пишеться в його settings.xml",
  "Only the Enhanced edition found: template goes to its settings.xml",
  "Nur die Edition Enhanced gefunden: Die Vorlage wird in deren settings.xml geschrieben",
  "Znaleziono tylko edycję Enhanced: szablon trafia do jej settings.xml",
  "Seule l'édition Enhanced est trouvée\u00a0: le modèle va dans son settings.xml",
];

// Подпись под цифрой «Изменится в игре»: файл не прочитан / менять нечего / есть изменения.
const NOTE_UNREAD = [
  "Файл не прочитан",
  "Файл не прочитаний",
  "File not read",
  "Datei nicht gelesen",
  "Plik nieodczytany",
  "Non lu",
];
const NOTE_NOTHING = [
  "Менять нечего",
  "Змінювати нічого",
  "Nothing to change",
  "Nichts zu ändern",
  "Nic do zmiany",
  "Rien à changer",
];
const NOTE_PENDING = [
  "Запишется после «Применить»",
  "Запишеться після «Застосувати»",
  "Written after “Apply”",
  "Wird nach „Anwenden“ geschrieben",
  "Zapisane po „Zastosuj”",
  "Écrit après «\u00a0Appliquer\u00a0»",
];

// Заметка под значением вне меню игры; число подставляется уже отформатированным.
const SPECIAL_VALUE = [
  "Шаблон задаёт {0} — вне игрового меню",
  "Шаблон задає {0} — поза межами меню гри",
  "Template sets {0} — outside the game menu range",
  "Vorlage setzt {0} — außerhalb des Spielmenüs",
  "Szablon ustawia {0} — poza menu gry",
  "Le modèle fixe {0} — hors du menu du jeu",
];

const SHARE = ["{0} %", "{0} %", "{0} %", "{0} %", "{0} %", "{0}\u00a0%"];

const fill =
  (pattern) =>
  (...args) =>
    pattern.replace(/\{(\d)\}/g, (_, n) => args[n]);

function put(target, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let node = target;
  for (const key of keys) node = node[key] ??= {};
  node[last] = value;
}

function buildCopy(index) {
  const copy = {};
  for (const [path, row] of Object.entries(TEXT)) put(copy, path, row[index]);
  for (const [path, row] of Object.entries(PATTERNS))
    put(copy, path, fill(row[index]));

  const gigabytes = (megabytes) =>
    (megabytes / 1024).toLocaleString(LOCALES[index], ONE_DECIMAL);
  put(
    copy,
    "vram",
    (megabytes) => `≈ ${gigabytes(megabytes)}${VRAM_TAIL[index]}`,
  );

  const basedOn = fill(BASED_ON[index]);
  put(copy, "basedOn", (name) =>
    name ? basedOn(name) : BASED_ON_FALLBACK[index],
  );

  put(copy, "editions", (list) =>
    list.length > 1 ? EDITIONS_BOTH[index] : EDITIONS_ONE[index],
  );

  const changedLine = fill(STATUS_CHANGED[index]);
  const sameLine = fill(STATUS_SAME[index]);
  put(copy, "editor.status", (name, changed) =>
    changed ? changedLine(name, changed) : sameLine(name),
  );

  put(copy, "editor.summary.gameNote", (count) => {
    if (count === null) return NOTE_UNREAD[index];
    return count === 0 ? NOTE_NOTHING[index] : NOTE_PENDING[index];
  });

  const decimal = LANGS[index] === "en" ? "." : ",";
  const special = fill(SPECIAL_VALUE[index]);
  put(copy, "editor.specialValue", (value) =>
    special(String(value).replace(/-/g, MINUS).replace(/\./g, decimal)),
  );

  const share = fill(SHARE[index]);
  put(copy, "editor.share", (value) => share(Math.round(value * 100)));
  return copy;
}

const built = new Map();

export function graphicsLocale(language) {
  return LANGS.includes(language) ? language : "en";
}

export function graphicsCopyFor(language) {
  const code = graphicsLocale(language);
  if (!built.has(code)) built.set(code, buildCopy(LANGS.indexOf(code)));
  return built.get(code);
}

// ---- Готовые шаблоны оптимизатора: подписи плиток на uk, de, pl, fr ----

const TEMPLATE_LANGS = ["uk", "de", "pl", "fr"];

// id шаблона → [название плитки, вторая строка плитки] на каждом из четырёх языков.
const TEMPLATE_TILES = {
  "astral-ultra": {
    label: [
      "Топові ПК",
      "High-End-PCs",
      "Topowe komputery",
      "PC haut de gamme",
    ],
    level: ["Максимальні", "Maximal", "Maksymalne", "Maximal"],
  },
  "astral-high": {
    label: [
      "Потужні ПК",
      "Leistungsstarke PCs",
      "Mocne komputery",
      "PC puissants",
    ],
    level: ["Високі", "Hoch", "Wysokie", "Élevé"],
  },
  "astral-medium": {
    label: [
      "Середні ПК",
      "Mittelklasse-PCs",
      "Średnie komputery",
      "PC milieu de gamme",
    ],
    level: ["Збалансовані", "Ausgewogen", "Zrównoważone", "Équilibré"],
  },
  "vram-3600": {
    label: ["Слабкі ПК", "Schwache PCs", "Słabe komputery", "PC faibles"],
    level: ["Низькі", "Niedrig", "Niskie", "Faible"],
  },
  "vram-27000": {
    label: [
      "Найслабші ПК",
      "Sehr schwache PCs",
      "Najsłabsze komputery",
      "PC très faibles",
    ],
    level: ["Мінімальні", "Minimal", "Minimalne", "Minimal"],
  },
  "game-minimum": {
    label: ["Мінімум гри", "Spielminimum", "Minimum gry", "Minimum du jeu"],
    level: [
      "Нижній рядок меню гри",
      "Unterste Werte im Spielmenü",
      "Najniższe wartości w menu gry",
      "Valeurs les plus basses du menu du jeu",
    ],
  },
  "below-minimum": {
    label: [
      "Нижче мінімуму",
      "Unter dem Minimum",
      "Poniżej minimum",
      "Sous le minimum",
    ],
    level: [
      "Без тіней, решта нижче меню гри",
      "Schatten aus, Rest unter dem Spielmenü",
      "Bez cieni, reszta poniżej menu gry",
      "Sans ombres, reste sous le menu du jeu",
    ],
  },
  potato: {
    label: ["Картопля", "Kartoffel", "Ziemniak", "Patate"],
    level: [
      "Усе мінімум, масштаб кадру 50 %",
      "Alles auf Minimum, Skalierung 50 %",
      "Wszystko na minimum, skala 50 %",
      "Tout au minimum, échelle 50\u00a0%",
    ],
  },
  "yukiko-vex": {
    label: [
      "Середні ПК",
      "Mittelklasse-PCs",
      "Średnie komputery",
      "PC milieu de gamme",
    ],
    level: [
      "Низькі налаштування",
      "Niedrige Einstellungen",
      "Niskie ustawienia",
      "Réglages bas",
    ],
  },
};

const tileCache = new Map();

// Подписи плитки для uk, de, pl, fr; для остальных языков и неизвестных id — null.
export function graphicsTemplateText(language, id) {
  const column = TEMPLATE_LANGS.indexOf(language);
  if (column < 0 || !Object.hasOwn(TEMPLATE_TILES, id)) return null;
  const key = `${language}:${id}`;
  if (!tileCache.has(key)) {
    const tile = TEMPLATE_TILES[id];
    tileCache.set(key, {
      label: tile.label[column],
      level: tile.level[column],
    });
  }
  return tileCache.get(key);
}
