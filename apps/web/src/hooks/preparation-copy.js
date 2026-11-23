// Слова автомата подготовки GTA V на шести языках: preparationCopyFor(language) отдаёт дерево текстов
// языка, describeAstralLayer и describeRockstarCopy собирают подпись шага (пустая строка — не менять).

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
const FALLBACK_LANGUAGE = "en";
const LAYER_STATUSES = [
  "ready",
  "backup-only",
  "foreign-layer",
  "shadowed",
  "stock",
];
const LAUNCHER_ATTACHED = ["switched", "same"];
const SENTENCE_GLUE = ". ";

// Пути листьев дерева текстов; значения языка лежат списком в том же порядке.
const PATHS = [
  "copy.and",
  "copy.created",
  "copy.existing",
  "copy.skipped",
  "copy.launchers.majestic",
  "copy.launchers.rage",
  "copy.switched",
  "copy.launcherOpen",
  "rockstar",
  "steps.0.0",
  "steps.0.1",
  "steps.1.0",
  "steps.1.1",
  "steps.2.0",
  "steps.2.1",
  "steps.3.0",
  "steps.3.1",
  "steps.4.0",
  "steps.4.1",
  "messages.0",
  "messages.1",
  "messages.2",
  "messages.3",
  "messages.4",
  "messages.5",
  "messages.6",
  "demoReady",
  "layer.ready",
  "layer.backup-only",
  "layer.foreign-layer",
  "layer.shadowed",
  "layer.stock",
  "layer.unavailable",
];

const TEXTS = {
  ru: [
    " и ",
    (folder) =>
      `Вторая папка игры собрана: ${folder}. Моды Astral ставятся в неё`,
    (folder) => `Моды Astral ставятся во вторую папку игры: ${folder}`,
    "Вторая папка игры не собрана (другой диск или мало места) — моды работают до следующего запуска через лаунчер Rockstar",
    "Majestic",
    "RAGE",
    (names) => `В ${names} игра запускается из неё`,
    "Закройте лаунчер Majestic — в нём путь к игре сменится при следующей подготовке",
    "лаунчер Rockstar при запуске возвращает update.rpf — моды вернёт «Библиотека»",
    "Поиск GTA V",
    "Steam, Epic Games и Rockstar",
    "Проверка версии и сборки",
    "Профили Legacy и Enhanced",
    "Подготовка SafeSwitch",
    "Слои модов и состояние отката",
    "Проверка архивной среды",
    "RPF-helper, ASI и загрузчик mods",
    "Синхронизация каталога",
    "Подписанные манифесты и превью",
    "Ищем установку GTA V",
    "Проверяем редакцию GTA V",
    "Загружаем безопасный профиль",
    "Проверяем архивную среду",
    "Синхронизируем каталог",
    "Нужно подключить безопасный загрузчик mods",
    "Каталог и SafeSwitch готовы",
    "Демо-каталог и безопасная очередь готовы",
    "Слой Astral готов: папка x64/astral создана, резервная копия update.rpf сохранена",
    "Резервная копия update.rpf сохранена; RPF-helper пока недоступен, папки слоя нет",
    "В update.rpf уже есть слой Astral без копии оригинала — сначала проверьте файлы игры",
    "Дубликат mods/update/update.rpf перекрывает оригинал — удалите его или отключите загрузчик, иначе моды не появятся",
    "Игра штатная, без модов: Astral пока её не трогает и подготовит сам, когда вы что-нибудь установите",
    (reason) => `Слой Astral не подготовлен: ${reason}`,
  ],
  uk: [
    " та ",
    (folder) =>
      `Друга тека гри створена: ${folder}. Моди Astral встановлюються в неї`,
    (folder) => `Моди Astral встановлюються в другу теку гри: ${folder}`,
    "Друга тека гри не створена (інший диск або мало місця) — моди діють до наступного запуску через лаунчер Rockstar",
    "Majestic",
    "RAGE",
    (names) => `У ${names} гра запускається з неї`,
    "Закрийте лаунчер Majestic — шлях до гри в ньому зміниться під час наступної підготовки",
    "лаунчер Rockstar під час запуску повертає update.rpf — моди поверне «Бібліотека»",
    "Пошук GTA V",
    "Steam, Epic Games та Rockstar",
    "Перевірка редакції та збірки",
    "Профілі Legacy та Enhanced",
    "Підготовка SafeSwitch",
    "Шари модів та стан відкоту",
    "Перевірка архівного середовища",
    "RPF-helper, ASI та завантажувач mods",
    "Синхронізація каталогу",
    "Підписані маніфести та прев’ю",
    "Шукаємо встановлену GTA V",
    "Перевіряємо редакцію GTA V",
    "Завантажуємо безпечний профіль",
    "Перевіряємо архівне середовище",
    "Синхронізуємо каталог",
    "Потрібно підключити безпечний завантажувач mods",
    "Каталог та SafeSwitch готові",
    "Демо-каталог та безпечна черга готові",
    "Шар Astral готовий: папка x64/astral створена, резервна копія update.rpf збережена",
    "Резервна копія update.rpf збережена; RPF-helper поки недоступний, папки шару немає",
    "У update.rpf уже є шар Astral без копії оригіналу — спершу перевірте файли гри",
    "Дублікат mods/update/update.rpf перекриває оригінал — видаліть його або вимкніть завантажувач, інакше модів не буде",
    "Гра штатна, без модів: Astral поки що її не чіпає й підготує сам, коли ви щось встановите",
    (reason) => `Шар Astral не підготовлено: ${reason}`,
  ],
  en: [
    " and ",
    (folder) =>
      `Second game folder created: ${folder}. Astral mods now go into it`,
    (folder) => `Astral mods go into the second game folder: ${folder}`,
    "Second game folder not created (other disk or low space) — mods last until the next launch via Rockstar Launcher",
    "Majestic",
    "RAGE",
    (names) => `In ${names}, the game starts from it`,
    "Close the Majestic launcher — its game path will be changed at the next preparation",
    "Rockstar Launcher restores update.rpf at game start — Library brings mods back",
    "GTA V search",
    "Steam, Epic Games and Rockstar",
    "Edition and build check",
    "Legacy and Enhanced profiles",
    "SafeSwitch preparation",
    "Mod layers and rollback state",
    "Archive environment check",
    "RPF-helper, ASI and mods loader",
    "Catalogue sync",
    "Signed manifests and previews",
    "Locating GTA V",
    "Checking the GTA V edition",
    "Loading the safe profile",
    "Checking the archive environment",
    "Synchronizing the catalogue",
    "Safe mods loader needs to be connected",
    "Catalogue and SafeSwitch are ready",
    "Demo catalogue and safe queue are ready",
    "Astral layer is ready: x64/astral folder created, update.rpf backup saved",
    "Backup of update.rpf saved; RPF-helper is not available yet, so there is no layer folder",
    "There is an Astral layer in update.rpf but no backup of the original — verify the game files first",
    "The duplicate mods/update/update.rpf shadows the original — remove it or turn off the loader, or mods will not show up",
    "The game is stock, with no mods: Astral won’t touch it now and will prepare it when you install something",
    (reason) => `Astral layer not prepared: ${reason}`,
  ],
  de: [
    " und ",
    (folder) =>
      `Zweiter Spielordner erstellt: ${folder}. Astral-Mods kommen jetzt dorthin`,
    (folder) => `Astral-Mods kommen in den zweiten Spielordner: ${folder}`,
    "Zweiter Spielordner nicht erstellt (anderes Laufwerk oder zu wenig Platz) — Mods gelten bis zum nächsten Start über Rockstar Launcher",
    "Majestic",
    "RAGE",
    (names) => `In ${names} startet das Spiel von dort`,
    "Schließe den Majestic-Launcher — der Spielpfad darin wird bei der nächsten Vorbereitung geändert",
    "Rockstar Launcher setzt update.rpf beim Spielstart zurück — Bibliothek holt die Mods zurück",
    "GTA V suchen",
    "Steam, Epic Games und Rockstar",
    "Edition und Build prüfen",
    "Profile für Legacy und Enhanced",
    "SafeSwitch vorbereiten",
    "Mod-Ebenen und Wiederherstellungsstatus",
    "Archivumgebung prüfen",
    "RPF-helper, ASI und Mods-Loader",
    "Katalog synchronisieren",
    "Signierte Manifeste und Vorschauen",
    "GTA V wird gesucht",
    "GTA-V-Edition wird geprüft",
    "Sicheres Profil wird geladen",
    "Archivumgebung wird geprüft",
    "Katalog wird synchronisiert",
    "Der sichere Mods-Loader ist noch nicht verbunden",
    "Katalog und SafeSwitch sind bereit",
    "Demo-Katalog und sichere Warteschlange sind bereit",
    "Astral-Ebene bereit: Ordner x64/astral angelegt, Sicherungskopie von update.rpf gespeichert",
    "Sicherung von update.rpf gespeichert; RPF-helper nicht verfügbar, daher kein Ebenenordner",
    "In update.rpf steckt schon eine Astral-Ebene ohne Sicherungskopie — prüfe zuerst die Spieldateien",
    "Das Duplikat mods/update/update.rpf überdeckt das Original — lösche es oder deaktiviere den Loader, sonst fehlen die Mods",
    "Spiel im Originalzustand, ohne Mods: Astral lässt es vorerst unberührt und bereitet es selbst vor, sobald du etwas installierst",
    (reason) => `Astral-Ebene nicht vorbereitet: ${reason}`,
  ],
  pl: [
    " i ",
    (folder) =>
      `Utworzono drugi folder gry: ${folder}. Mody Astral instalują się w nim`,
    (folder) => `Mody Astral instalują się w drugim folderze gry: ${folder}`,
    "Drugi folder gry nie powstał (inny dysk lub mało miejsca) — mody działają do kolejnego uruchomienia przez launcher Rockstar",
    "Majestic",
    "RAGE",
    (names) => `W ${names} gra uruchamia się z niego`,
    "Zamknij launcher Majestic — ścieżka do gry w nim zmieni się przy następnym przygotowaniu",
    "launcher Rockstar cofa update.rpf przy starcie — mody przywróci Biblioteka",
    "Wyszukiwanie GTA V",
    "Steam, Epic Games i Rockstar",
    "Sprawdzanie edycji i kompilacji",
    "Profile Legacy i Enhanced",
    "Przygotowanie SafeSwitch",
    "Warstwy modów i stan przywracania",
    "Sprawdzanie środowiska archiwów",
    "RPF-helper, ASI i loader mods",
    "Synchronizacja katalogu",
    "Podpisane manifesty i podglądy",
    "Wyszukiwanie instalacji GTA V",
    "Sprawdzanie edycji GTA V",
    "Ładowanie bezpiecznego profilu",
    "Sprawdzanie środowiska archiwów",
    "Synchronizacja katalogu",
    "Bezpieczny loader mods nie jest jeszcze podłączony",
    "Katalog i SafeSwitch są gotowe",
    "Katalog demo i bezpieczna kolejka są gotowe",
    "Warstwa Astral gotowa: folder x64/astral utworzony, kopia zapasowa update.rpf zapisana",
    "Kopia update.rpf zapisana; RPF-helper niedostępny, folderu warstwy jeszcze nie ma",
    "W update.rpf jest już warstwa Astral bez kopii oryginału — najpierw sprawdź pliki gry",
    "Duplikat mods/update/update.rpf przesłania oryginał — usuń go lub wyłącz loader, inaczej mody się nie pojawią",
    "Gra oryginalna, bez modów: Astral na razie jej nie rusza i sam ją przygotuje, gdy coś zainstalujesz",
    (reason) => `Nie przygotowano warstwy Astral: ${reason}`,
  ],
  fr: [
    " et ",
    (folder) =>
      `Second dossier du jeu créé\u00a0: ${folder}. Les mods Astral s’y installent désormais`,
    (folder) =>
      `Les mods Astral s’installent dans le second dossier du jeu\u00a0: ${folder}`,
    "Second dossier du jeu non créé (autre disque ou manque de place) — mods actifs jusqu’au prochain lancement via le lanceur Rockstar",
    "Majestic",
    "RAGE",
    (names) => `Dans ${names}, le jeu se lance depuis ce dossier`,
    "Fermez le lanceur Majestic — le chemin du jeu y sera modifié lors de la prochaine préparation",
    "le lanceur Rockstar remet l’archive update.rpf d’origine au lancement — «\u00a0Bibliothèque\u00a0» ramène les mods",
    "Recherche de GTA V",
    "Steam, Epic Games et Rockstar",
    "Vérification de l’édition et du build",
    "Profils Legacy et Enhanced",
    "Préparation de SafeSwitch",
    "Couches de mods et état de restauration",
    "Vérification de l’environnement d’archives",
    "RPF-helper, ASI et chargeur mods",
    "Synchronisation du catalogue",
    "Manifestes signés et aperçus",
    "Recherche de l’installation de GTA V",
    "Vérification de l’édition de GTA V",
    "Chargement du profil sécurisé",
    "Vérification de l’environnement d’archives",
    "Synchronisation du catalogue",
    "Le chargeur mods sécurisé n’est pas encore connecté",
    "Catalogue et SafeSwitch sont prêts",
    "Catalogue démo et file d’attente sécurisée sont prêts",
    "Couche Astral prête\u00a0: dossier x64/astral créé, sauvegarde d’update.rpf enregistrée",
    "Sauvegarde d’update.rpf enregistrée\u00a0; RPF-helper non prêt, donc pas de dossier de couche",
    "update.rpf contient déjà une couche Astral sans sauvegarde — vérifiez d’abord les fichiers du jeu",
    "Le doublon mods/update/update.rpf masque l’original — supprimez-le ou désactivez le chargeur, sinon les mods n’apparaîtront pas",
    "Jeu d’origine, sans mods\u00a0: Astral n’y touche pas et le préparera dès votre première installation",
    (reason) => `Couche Astral non préparée\u00a0: ${reason}`,
  ],
};

// Дерево текстов языка: пути листьев разворачиваются во вложенные объекты и списки (числовой ключ — список).
function buildTree(language) {
  const tree = {};
  for (const [at, path] of PATHS.entries()) {
    const keys = path.split(".");
    let node = tree;
    keys.slice(0, -1).forEach((key, depth) => {
      node[key] ??= Number.isInteger(Number(keys[depth + 1])) ? [] : {};
      node = node[key];
    });
    node[keys[keys.length - 1]] = TEXTS[language][at];
  }
  return tree;
}

const trees = new Map();

export function preparationCopyFor(language) {
  const code =
    typeof language === "string" && LANGUAGES.includes(language)
      ? language
      : FALLBACK_LANGUAGE;
  if (!trees.has(code)) trees.set(code, buildTree(code));
  return trees.get(code);
}

export function describeAstralLayer(layer, language) {
  if (!layer || typeof layer !== "object") return "";
  const words = preparationCopyFor(language).layer;
  const status = layer.status;
  if (status === "unavailable")
    return layer.reason ? words.unavailable(String(layer.reason)) : "";
  return LAYER_STATUSES.includes(status) ? words[status] : "";
}

export function describeRockstarCopy(result, language) {
  if (!result || typeof result !== "object") return "";
  const copy = preparationCopyFor(language).copy;
  if (result.skipped) return copy.skipped;
  const folder = result.copy?.path;
  if (!folder) return "";
  const sentences = [
    result.created ? copy.created(folder) : copy.existing(folder),
  ];
  const attached = (value) => LAUNCHER_ATTACHED.includes(value);
  const names = [];
  if (attached(result.launchers?.majestic)) names.push(copy.launchers.majestic);
  if (attached(result.launchers?.rage)) names.push(copy.launchers.rage);
  if (names.length) sentences.push(copy.switched(names.join(copy.and)));
  if (result.launchers?.majestic === "launcher-open")
    sentences.push(copy.launcherOpen);
  return sentences.join(SENTENCE_GLUE);
}
