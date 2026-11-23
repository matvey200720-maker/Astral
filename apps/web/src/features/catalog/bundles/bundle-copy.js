import { modPartsLabel } from "../../../components/desktop/catalog/modActionCopy.js";

// Колонки таблицы ниже — языки окна в этом порядке.
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Строка: ключ словаря и по тексту на язык (в порядке LANGUAGES). Место {N} занимает
// аргумент с номером N. Ключ «about.x» кладёт значение во вложенный объект about.
// Ячейка-пара — текст about.whole: с хвостом «виды» и без него.
const TEXT_ROWS = [
  [
    "install",
    "Установить сборку",
    "Встановити збірку",
    "Install bundle",
    "Paket installieren",
    "Zainstaluj zestaw",
    "Installer le build",
  ],
  [
    "installMissing",
    "Доставить {0}",
    "Довстановити {0}",
    "Install {0} left",
    "{0} nachinstallieren",
    "Doinstaluj {0}",
    "Installer le reste\u00a0: {0}",
  ],
  [
    "remove",
    "Снять сборку",
    "Зняти збірку",
    "Remove bundle",
    "Paket entfernen",
    "Usuń zestaw",
    "Retirer le build",
  ],
  [
    "busy",
    "Сборка ставится…",
    "Збірка встановлюється…",
    "Bundle is installing…",
    "Paket wird installiert…",
    "Zestaw się instaluje…",
    "Installation du build…",
  ],
  [
    "status",
    "В игре",
    "У грі",
    "In the game",
    "Im Spiel",
    "W grze",
    "Dans le jeu",
  ],
  [
    "installed",
    "Стоят {0} из {1}",
    "Стоять {0} з {1}",
    "{0} of {1} installed",
    "{0} von {1} installiert",
    "Zainstalowane {0} z {1}",
    "Installé\u00a0: {0} sur {1}",
  ],
  [
    "full",
    "Сборка стоит целиком",
    "Збірка стоїть повністю",
    "The whole bundle is installed",
    "Das ganze Paket ist installiert",
    "Cały zestaw jest zainstalowany",
    "Le build est entièrement installé",
  ],
  [
    "removeRemembered",
    "Снимет {0}, что поставила сборка",
    "Зніме {0}, що поставила збірка",
    "Removes {0} this bundle installed",
    "Entfernt {0}, die das Paket installiert hat",
    "Usunie {0} zainstalowane przez zestaw",
    "Retire ce que le build a installé\u00a0: {0}",
  ],
  [
    "queued",
    "Сборка «{0}»: {1} в очереди",
    "Збірка «{0}»: {1} у черзі",
    "Bundle “{0}”: {1} queued",
    "Paket „{0}“: {1} in der Warteschlange",
    "Zestaw „{0}”: {1} w kolejce",
    "Build «\u00a0{0}\u00a0»\u00a0: {1} en file d’attente",
  ],
  /* Одно слово вместо двух: остальное поставлено в очередь, а вещи одежды без выбора ждут своих карточек (второе слово в тот же такт затирало первое). */
  [
    "queuedByCard",
    "Сборка «{0}»: остальное в очереди. Вещи одежды не ставятся сами — откройте их карточки и выберите, на что поставить: {1}",
    "Збірка «{0}»: решта в черзі. Речі одягу не встановлюються самі — відкрийте їхні картки й оберіть, на що поставити: {1}",
    "Bundle “{0}”: the rest is queued. Clothing items are not installed on their own — open their cards and choose what to put them on: {1}",
    "Paket „{0}“: der Rest steht in der Warteschlange. Kleidungsstücke werden nicht von selbst installiert — öffne ihre Karten und wähle, worauf sie gesetzt werden sollen: {1}",
    "Zestaw „{0}”: reszta jest w kolejce. Elementy ubioru nie instalują się same — otwórz ich karty i wybierz, na co je ustawić: {1}",
    "Build «\u00a0{0}\u00a0»\u00a0: le reste est en file d’attente. Les vêtements ne s’installent pas seuls — ouvrez leurs fiches et choisissez sur quoi les mettre\u00a0: {1}",
  ],

  [
    "nothingToInstall",
    "Все части сборки «{0}» уже стоят",
    "Усі частини збірки «{0}» уже стоять",
    "Every part of “{0}” is already installed",
    "Alle Teile von „{0}“ sind schon installiert",
    "Wszystkie części zestawu „{0}” są już zainstalowane",
    "Toutes les parties du build «\u00a0{0}\u00a0» sont déjà installées",
  ],
  [
    "clothingByCard",
    "Вещи одежды из сборки «{0}» не ставятся сами: откройте их карточки и выберите, на что поставить — {1}",
    "Речі одягу зі збірки «{0}» не встановлюються самі: відкрийте їхні картки й оберіть, на що поставити — {1}",
    "Clothing items from “{0}” are not installed on their own: open their cards and choose what to put them on — {1}",
    "Kleidungsstücke aus „{0}“ werden nicht von selbst installiert: Öffne ihre Karten und wähle, worauf sie gesetzt werden sollen — {1}",
    "Elementy ubioru z zestawu „{0}” nie instalują się same: otwórz ich karty i wybierz, na co je ustawić — {1}",
    "Les vêtements du build «\u00a0{0}\u00a0» ne s’installent pas seuls\u00a0: ouvrez leurs fiches et choisissez sur quoi les mettre — {1}",
  ],
  [
    "workQueued",
    "«{0}» — в очереди «Применить» мастерской",
    "«{0}» — у черзі «Застосувати» майстерні",
    "“{0}” is queued to apply in the workshop",
    "„{0}“ wartet in der Werkstatt auf „Anwenden“",
    "„{0}” czeka w warsztacie na „Zastosuj”",
    "«\u00a0{0}\u00a0» est dans la file « Appliquer » de l’Atelier",
  ],
  [
    "workInGame",
    "«{0}» уже стоит в игре",
    "«{0}» уже стоїть у грі",
    "“{0}” is already in the game",
    "„{0}“ ist schon im Spiel",
    "„{0}” jest już w grze",
    "«\u00a0{0}\u00a0» est déjà dans le jeu",
  ],
  [
    "removeMapFirst",
    "«{0}» не поставлена: в игре стоит большая карта самого мода — снимите её, и своя карта встанет на её место.",
    "«{0}» не встановлено: у грі стоїть велика карта самого мода — зніміть її, і своя карта стане на її місце.",
    "“{0}” was not installed: the mod's own large map is in the game — remove it and your map takes its place.",
    "„{0}“ nicht installiert: Die große Karte des Mods ist im Spiel — entferne sie, dann tritt deine Karte an ihre Stelle.",
    "„{0}” nie zainstalowano: w grze jest duża mapa samego moda — usuń ją, a twoja mapa zajmie jej miejsce.",
    "«\u00a0{0}\u00a0» n’est pas installé\u00a0: la carte de pause du mod lui-même est dans le jeu — retirez-la et votre carte prendra sa place.",
  ],
  /* Остановка сборки (отказ части): причина и «Повторить» — в «Загрузках» (разбор 17.11.2026: раньше слово не говорило ни причины, ни где «Повторить»). */
  [
    "stopped",
    "Сборка «{0}» остановлена: «{1}» не встала, остальные части убраны из очереди. Причина и «Повторить» — в «Загрузках».",
    "Збірку «{0}» зупинено: «{1}» не встала, решту частин прибрано з черги. Причина й «Повторити» — у «Завантаженнях».",
    "Bundle “{0}” stopped: “{1}” did not install, the other parts were taken off the queue. The reason and “Retry” are in Downloads.",
    "Paket „{0}“ angehalten: „{1}“ wurde nicht installiert, die übrigen Teile wurden aus der Warteschlange genommen. Grund und „Wiederholen“ stehen unter „Downloads“.",
    "Zestaw „{0}” zatrzymany: „{1}” się nie zainstalował, pozostałe części zdjęto z kolejki. Przyczyna i „Ponów” są w „Pobraniach”.",
    "Build «\u00a0{0}\u00a0» interrompu\u00a0: «\u00a0{1}\u00a0» n’a pas été installé, les autres parties ont été retirées de la file. La cause et «\u00a0Réessayer\u00a0» sont dans «\u00a0Téléchargements\u00a0».",
  ],
  /* Часть сборки упёрлась в файлы игры, которые уже меняет другой мод: она ждёт ответа «оставить своё или заменить» в «Загрузках», остальные части ставятся (разбор 17.11.2026). */
  [
    "waitingForeign",
    "Сборка «{0}»: «{1}» ждёт твоего ответа — эти файлы игры уже изменены другим модом. Выбери в «Загрузках»: оставить своё или заменить, и сборка продолжит.",
    "Збірка «{0}»: «{1}» чекає твоєї відповіді — ці файли гри вже змінено іншим модом. Обери в «Завантаженнях»: залишити своє чи замінити, і збірка продовжить.",
    "Bundle “{0}”: “{1}” is waiting for your answer — another mod already changes these game files. Choose in Downloads: keep yours or replace, and the bundle goes on.",
    "Paket „{0}“: „{1}“ wartet auf deine Antwort — ein anderer Mod ändert diese Spieldateien bereits. Wähle unter „Downloads“: deine behalten oder ersetzen, dann geht das Paket weiter.",
    "Zestaw „{0}”: „{1}” czeka na twoją odpowiedź — inny mod już zmienia te pliki gry. Wybierz w „Pobraniach”: zostaw swoje albo zamień, a zestaw będzie się dalej instalował.",
    "Build «\u00a0{0}\u00a0»\u00a0: «\u00a0{1}\u00a0» attend votre réponse — un autre mod modifie déjà ces fichiers du jeu. Choisissez dans «\u00a0Téléchargements\u00a0»\u00a0: garder le vôtre ou le remplacer, et le build continuera.",
  ],
  /* Человек оставил своим всё, что кладёт часть: ставить нечего, часть пропускается, остальные встают. */
  [
    "keptOwn",
    "Сборка «{0}»: «{1}» пропущена — твои файлы остались как есть, ставить нечего.",
    "Збірка «{0}»: «{1}» пропущено — твої файли залишилися як є, встановлювати нічого.",
    "Bundle “{0}”: “{1}” skipped — your files stay as they are, there is nothing to install.",
    "Paket „{0}“: „{1}“ übersprungen — deine Dateien bleiben unverändert, es gibt nichts zu installieren.",
    "Zestaw „{0}”: „{1}” pominięto — twoje pliki zostały bez zmian, nie ma czego instalować.",
    "Build «\u00a0{0}\u00a0»\u00a0: «\u00a0{1}\u00a0» ignoré — vos fichiers sont restés tels quels, rien à installer.",
  ],
  [
    "libraryTitle",
    "Сборки",
    "Збірки",
    "Bundles",
    "Pakete",
    "Zestawy",
    "Builds",
  ],
  [
    "open",
    "Открыть",
    "Відкрити",
    "Open",
    "Öffnen",
    "Otwórz",
    "Ouvrir",
  ],
  [
    "about.whole",
    [
      "Весь редукс «{0}» одним модом — {1}: {2}.",
      "Весь редукс «{0}» одним модом — {1}.",
    ],
    [
      "Увесь редукс «{0}» одним модом — {1}: {2}.",
      "Увесь редукс «{0}» одним модом — {1}.",
    ],
    [
      "The whole “{0}” redux as one mod — {1}: {2}.",
      "The whole “{0}” redux as one mod — {1}.",
    ],
    [
      "Der ganze Redux „{0}“ als ein Mod — {1}: {2}.",
      "Der ganze Redux „{0}“ als ein Mod — {1}.",
    ],
    [
      "Cały redux „{0}” jako jeden mod — {1}: {2}.",
      "Cały redux „{0}” jako jeden mod — {1}.",
    ],
    [
      "Tout le Redux «\u00a0{0}\u00a0» en un seul mod — {1}\u00a0: {2}.",
      "Tout le Redux «\u00a0{0}\u00a0» en un seul mod — {1}.",
    ],
  ],
  [
    "about.any",
    "Любую часть можно поставить отдельно или открыть в мастерской — они в окне «{0}».",
    "Будь-яку частину можна поставити окремо або відкрити в майстерні — вони у вікні «{0}».",
    "Any part can be installed on its own or opened in the workshop — they're in the “{0}” window.",
    "Jeder Teil lässt sich einzeln installieren oder in der Werkstatt öffnen — sie stehen im Fenster „{0}“.",
    "Każdą część można zainstalować osobno albo otworzyć w warsztacie — są w oknie „{0}”.",
    "Chaque partie peut être installée séparément ou ouverte dans l’Atelier — elles se trouvent dans la fenêtre «\u00a0{0}\u00a0».",
  ],
  [
    "about.optimization",
    "Оптимизация — своя, Astral: {0} (включается вместе со сборкой).",
    "Оптимізація — своя, Astral: {0} (вмикається разом зі збіркою).",
    "Optimization is Astral's own: {0} (turns on together with the build).",
    "Die Optimierung ist Astrals eigene: {0} (wird zusammen mit dem Build aktiviert).",
    "Optymalizacja — własna, Astral: {0} (włącza się razem z kompilacją).",
    "L’optimisation est celle d’Astral\u00a0: {0} (activée avec le build).",
  ],
];

// Словари строятся при первом обращении: модуль достижим из стартового куска окна,
// и на верхнем уровне допустимы только литералы и определения функций.
const memo = { dictionaries: null };

// Куски текста: чётные места — обычный текст, нечётные — номер аргумента.
function piecesOf(text) {
  return text.split(/[{}]/);
}

// Аргументы превращаются в текст до подстановки, по порядку: упавший первый не даёт читать второй.
function fillerOf(pieces) {
  return (args) => {
    const shown = args.map((value) => `${value}`);
    return pieces.map((piece, at) => (at % 2 ? shown[piece] : piece)).join("");
  };
}

function makeWhole(withKinds, withoutKinds) {
  const full = fillerOf(piecesOf(withKinds));
  const bare = fillerOf(piecesOf(withoutKinds));
  return (name, parts, kinds) => (kinds ? full([name, parts, kinds]) : bare([name, parts]));
}

// Вне about.whole в данных не больше двух меток, поэтому хватает функций на один и два аргумента.
function makeValue(cell) {
  if (Array.isArray(cell)) return makeWhole(cell[0], cell[1]);
  const pieces = piecesOf(cell);
  const marks = (pieces.length - 1) / 2;
  if (marks === 0) return cell;
  const fill = fillerOf(pieces);
  return marks === 1 ? (a) => fill([a]) : (a, b) => fill([a, b]);
}

function putValue(dictionary, key, value) {
  const dot = key.indexOf(".");
  if (dot < 0) {
    dictionary[key] = value;
    return;
  }
  const group = key.slice(0, dot);
  if (!dictionary[group]) dictionary[group] = {};
  dictionary[group][key.slice(dot + 1)] = value;
}

function buildDictionary(column) {
  const dictionary = {};
  for (const row of TEXT_ROWS) {
    putValue(dictionary, row[0], makeValue(row[column + 1]));
  }
  return dictionary;
}

function buildAll() {
  const all = {};
  LANGUAGES.forEach((code, column) => {
    all[code] = buildDictionary(column);
  });
  return all;
}

export function bundleCopy(language) {
  if (!memo.dictionaries) memo.dictionaries = buildAll();
  return memo.dictionaries[language] ?? memo.dictionaries.en;
}

export function bundlePartsLabel(count, language) {
  return modPartsLabel(count, language);
}
