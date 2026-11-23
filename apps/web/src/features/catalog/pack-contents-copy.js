import { tr } from "../../locales/ui.js";
import { localPartName } from "./part-name.js";

// Подписи окна «Компоненты» на шести языках. Всё, что считается (выбор словаря,
// склонение, сборка подписей), строится при первом обращении, а не при загрузке
// модуля: этот файл тянут модули стартового куска окна.

// Столбцы в таблице ниже идут в таком порядке языков.
const CODES = ["ru", "uk", "en", "de", "pl", "fr"];

// Слова склонения этих словарей сначала проходят через tr (язык окна).
const WORDS_VIA_TR = ["ru", "uk"];

// Какое по счёту слово списка берёт категория Intl.PluralRules.
const FORM_SLOT = { one: 0, few: 1, many: 2, other: 3 };

// Готовые словари и правила множественного числа: заполняются по требованию.
const dictionaries = {};
const pluralRules = {};

// Строка таблицы: [ключ словаря, способ сборки, данные по языкам в порядке CODES].
//   text     готовая строка;
//   stamp    шаблон, `{}` заменяется аргументом;
//   count    списки слов: «число слово» в форме по категории;
//   group    вложенный объект из строк (где языка нет, ключ пропускается);
//   choice   replaces: шаблон для одного имени, шаблон со счётчиком, слова;
//   labelled versions: шаблон с `{}` и `{#}`, слова;
//   name     partName, данных нет.
// `{#}` в шаблоне - «число слово» в нужной форме.
const ENTRIES = [
  ["title", "text", [
    "Компоненты",
    "Компоненти",
    "Components",
    "Komponenten",
    "Komponenty",
    "Composants",
  ]],
  ["showAll", "stamp", [
    "Показать все · {}",
    "Показати всі · {}",
    "Show all · {}",
    "Alle zeigen · {}",
    "Pokaż wszystkie · {}",
    "Tout afficher · {}",
  ]],
  ["showLess", "text", ["Свернуть", "Згорнути", "Show less", "Weniger zeigen", "Zwiń", "Réduire"]],
  ["parts", "count", [
    ["часть", "части", "частей"],
    ["частина", "частини", "частин"],
    ["part", "parts"],
    ["Teil", "Teile"],
    ["część", "części"],
    ["partie", "parties"],
  ]],
  ["more", "stamp", [
    "ещё {} отдельно",
    "ще {} окремо",
    "{} more separately",
    "{} weitere separat",
    "jeszcze {} osobno",
    "{} de plus, à part",
  ]],
  ["attachments", "text", [
    "Обвесы",
    "Обвіси",
    "Attachments",
    "Aufsätze",
    "Dodatki",
    "Accessoires",
  ]],
  ["hidden", "text", [
    "скрыты автором",
    "приховані автором",
    "hidden by the author",
    "vom Autor ausgeblendet",
    "ukryte przez autora",
    "masqués par l'auteur",
  ]],
  ["detailCount", "count", [
    ["деталь", "детали", "деталей"],
    ["деталь", "деталі", "деталей"],
    ["part", "parts"],
    ["Teil", "Teile"],
    ["część", "części"],
    ["pièce", "pièces"],
  ]],
  ["weaponCount", "count", [
    ["ствол", "ствола", "стволов"],
    ["ствол", "стволи", "стволів", "ствола"],
    ["weapon", "weapons"],
    ["Waffe", "Waffen"],
    ["broń", "bronie", "broni", "broni"],
    ["arme", "armes"],
  ]],
  ["render", "text", [
    "Снимки — рендер моделей из пака, не кадры из игры.",
    "Знімки — рендер моделей з паку, не кадри з гри.",
    "Pictures are renders of the pack's models, not game footage.",
    "Bilder sind Renderings der Modelle aus dem Pack, keine Spielszenen.",
    "Obrazy to rendery modeli z paczki, nie kadry z gry.",
    "Images\u00a0: rendus des modèles du pack, pas des captures du jeu.",
  ]],
  ["peek", "group", {
    kicker: ["Оптимизация", "Оптимізація", "Optimization", "Optimierung", "Optymalizacja", "Optimisation"],
    changes: [
      "Что меняет",
      "Що змінює",
      "What it changes",
      "Was sich ändert",
      "Co zmienia",
      "Ce que ça change",
    ],
    looks: [
      "Как это выглядит в игре",
      "Як це виглядає в грі",
      "How it looks in game",
      "So sieht es im Spiel aus",
      "Jak to wygląda w grze",
      "Son rendu dans le jeu",
    ],
    shotNote: [
      "Кадры Astral: такая же оптимизация в игре, до и после. Это не кадры этого мода.",
      "Кадри Astral: така сама оптимізація в грі, до і після. Це не кадри цього мода.",
      "Astral frames: the same kind of optimization in game, before and after. These are not frames of this mod.",
      "Astral-Aufnahmen: dieselbe Art Optimierung im Spiel, vorher und nachher. Das sind keine Aufnahmen dieses Mods.",
      "Kadry Astral: ten sam rodzaj optymalizacji w grze, przed i po. To nie są kadry tego moda.",
      "Captures Astral\u00a0: la même optimisation dans le jeu, avant et après. Ce ne sont pas des captures de ce mod.",
    ],
    cloudsNote: [
      "«Редактировать» откроет редактор неба с облаками мода в ясную погоду. Облака в непогоду и свет облаков по часам у мода свои: редактор неба их не держит, они ставятся файлами мода.",
      "«Редагувати» відкриє редактор неба з хмарами мода в ясну погоду. Хмари в негоду й світло хмар за годинами в мода свої: редактор неба їх не тримає, вони ставляться файлами мода.",
      "Edit opens the sky editor with the mod's clear-weather clouds. The mod's bad-weather clouds and hourly cloud lighting are its own: the sky editor doesn't hold them, so they install as the mod's files.",
      "„Bearbeiten“ öffnet den Himmel-Editor mit den Schönwetterwolken des Mods. Wolken bei schlechtem Wetter und das stündliche Wolkenlicht bringt der Mod selbst mit: Der Himmel-Editor hält sie nicht, sie werden als Dateien des Mods installiert.",
      "„Edytuj” otworzy edytor nieba z chmurami moda przy dobrej pogodzie. Chmury przy niepogodzie i światło chmur o różnych porach mod ma własne: edytor nieba ich nie trzyma, instalują się jako pliki moda.",
      "«\u00a0Modifier\u00a0» ouvre l'éditeur de ciel avec les nuages du mod par beau temps. Les nuages par mauvais temps et l'éclairage des nuages heure par heure sont propres au mod\u00a0: l'éditeur de ciel ne les gère pas, ils s'installent via les fichiers du mod.",
    ],
    openPage: [
      "Страница части",
      "Сторінка частини",
      "Part page",
      "Seite des Teils",
      "Strona części",
      "Page de la partie",
    ],
    done: ["Готово", "Готово", "Done", "Fertig", "Gotowe", "Terminé"],
  }],
  ["kinds", "group", {
    timecycle: ["Таймцикл", "Таймцикл", "Timecycle", "Timecycle", "Timecycle", "Timecycle"],
    weather: ["Погода", "Погода", "Weather", "Wetter", "Pogoda", "Météo"],
    "large-map": ["Большая карта", "Велика карта", "Pause map", "Pausenkarte", "Duża mapa", "Grande carte"],
    "large-map-zoom": [
      "Отдаление карты",
      "Віддалення карти",
      "Map zoom-out",
      "Karten-Zoom",
      "Oddalenie mapy",
      "Éloignement de la carte",
    ],
    minimap: ["Мини-карта", "Мінікарта", "Minimap", "Minimap", "Minimapa", "Minicarte"],
    roads: ["Дороги", "Дороги", "Roads", "Straßen", "Drogi", "Routes"],
    mapping: ["Маппинг", "Мапінг", "Mapping", "Mapping", "Mapping", "Mapping"],
    /* Служебный пакет (13.11.2026): файлы автора без своего раздела в каталоге. «Основа редукса» / «Base files» владелец не понял — зовётся прямо. */
    "redux-base": ["Остальные файлы", "Інші файли", "Other files", "Weitere Dateien", "Pozostałe pliki", "Autres fichiers"],
    lights: ["Фонари", "Ліхтарі", "Street lights", "Straßenlampen", "Latarnie", "Lampadaires"],
    vegetation: ["Растительность", "Рослинність", "Vegetation", "Vegetation", "Roślinność", "Végétation"],
    interior: ["Интерьеры", "Інтер'єри", "Interiors", "Innenräume", "Wnętrza", "Intérieurs"],
    arenas: ["Арена", "Арена", "Arena", "Arena", "Arena", "Arène"],
    climbing: ["Залазы", "Залази", "Climb spots", "Kletterpunkte", "Punkty wspinaczki", "Points d'escalade"],
    water: ["Вода", "Вода", "Water", "Wasser", "Woda", "Eau"],
    /* Слова — как в мастерской (`workshop-effects-a.js`): uk «Трасери», pl «Smugi». Привязки следа пули (`tracer-bindings`) — тот же компонент «Трейсеры» (владелец 12.11.2026). */
    tracers: ["Трейсеры", "Трасери", "Tracers", "Leuchtspuren", "Smugi", "Traceurs"],
    "tracer-bindings": ["Трейсеры", "Трасери", "Tracers", "Leuchtspuren", "Smugi", "Traceurs"],
    "kill-effects": ["Килл-эффект", "Кіл-ефект", "Kill effect", "Kill-Effekt", "Efekt zabójstwa", "Effet de kill"],
    "hit-effects": ["Попадания", "Влучання", "Hit effects", "Treffereffekte", "Efekty trafień", "Impacts"],
    /* Пакет попаданий — часть компонента «Эффекты» (владелец 12.11.2026: «блуд» в названиях убрать). */
    "blood-routing": ["Эффекты", "Ефекти", "Effects", "Effekte", "Efekty", "Effets"],
    crosshair: ["Прицел", "Приціл", "Crosshair", "Fadenkreuz", "Celownik", "Réticule"],
    "sniper-crosshair": [
      "Снайперский прицел",
      "Снайперський приціл",
      "Sniper scope",
      "Zielfernrohr",
      "Luneta",
      "Réticule de sniper",
    ],
    "weapon-sounds": [
      "Звуки оружия",
      "Звуки зброї",
      "Weapon sounds",
      "Waffensounds",
      "Dźwięki broni",
      "Sons des armes",
    ],
    gunpack: ["Ганпак", "Ганпак", "Gun pack", "Waffenpaket", "Gunpack", "Gunpack"],
    optimization: ["Оптимизация", "Оптимізація", "Optimization", "Optimierung", "Optymalizacja", "Optimisation"],
    "fast-entry": [
      "Быстрый вход",
      "Швидкий вхід",
      "Quick entry",
      "Schnelleinstieg",
      "Szybkie wejście",
      "Entrée rapide",
    ],
    "minimap-position": [
      "Положение мини-карты",
      "Положення мінікарти",
      "Minimap position",
      "Minikarten-Position",
      "Położenie minimapy",
      "Position de la minicarte",
    ],
    hangar: ["Ангар", "Ангар", "Hangar", "Hangar", "Hangar", "Hangar"],
    "climbing-vzh": [
      "ВЗХ-залазы",
      "ВЗХ-залази",
      "VZH climb spots",
      "VZH-Kletterpunkte",
      "Punkty wspinaczki VZH",
      "Points d'escalade VZH",
    ],
    zones: ["Зоны", "Зони", "Zones", "Zonen", "Strefy", "Zones"],
    "zones-green": [
      "Зелёные зоны",
      "Зелені зони",
      "Green zones",
      "Grüne Zonen",
      "Zielone strefy",
      "Zones vertes",
    ],
    "zones-forbidden": [
      "Запретные зоны",
      "Заборонені зони",
      "Restricted zones",
      "Sperrzonen",
      "Strefy zakazane",
      "Zones interdites",
    ],
    "zones-vzh": ["Зоны ВЗХ", "Зони ВЗХ", "VZH zones", "VZH-Zonen", "Strefy VZH", "Zones VZH"],
    schedule: ["Расписание", "Розклад", "Schedule", "Fahrplan", "Rozkład", "Horaires"],
    hudcolor: [
      "Цвета интерфейса",
      "Кольори інтерфейсу",
      "Interface colours",
      "Interface-Farben",
      "Kolory interfejsu",
      "Couleurs de l'interface",
    ],
    lanterns: ["Фонари", "Ліхтарі", "Street lights", "Straßenlampen", "Latarnie", "Lampadaires"],
    "optimization-world": ["Оптимизация", "Оптимізація", "Optimization", "Optimierung", "Optymalizacja", "Optimisation"],
    "optimization-toggles": [
      "Настройки оптимизации",
      "Налаштування оптимізації",
      "Optimization settings",
      "Optimierungseinstellungen",
      "Ustawienia optymalizacji",
      "Réglages d'optimisation",
    ],
    clouds: ["Облака", "Хмари", "Clouds", "Wolken", "Chmury", "Nuages"],
    "clouds-layer": ["Облака", "Хмари", "Clouds", "Wolken", "Chmury", "Nuages"],
    effects: ["Эффекты", "Ефекти", "Effects", "Effekte", "Efekty", "Effets"],
  }],
  ["separate", "text", [
    "Отдельно от сборки",
    "Окремо від збірки",
    "Separate from the bundle",
    "Getrennt vom Paket",
    "Osobno od zestawu",
    "Séparé du build",
  ]],
  ["shared", "stamp", [
    "общая с «{}»",
    "спільна з «{}»",
    "shared with “{}”",
    "geteilt mit „{}“",
    "wspólna z „{}”",
    "partagée avec «\u00a0{}\u00a0»",
  ]],
  ["sections", "group", {
    sky: [
      "Небо и погода",
      "Небо й погода",
      "Sky and weather",
      "Himmel und Wetter",
      "Niebo i pogoda",
      "Ciel et météo",
    ],
    map: ["Карта", "Мапа", "Map", "Karte", "Mapa", "Carte"],
    interface: ["Интерфейс", "Інтерфейс", "Interface", "Oberfläche", "Interfejs", "Interface"],
    world: ["Мир", "Світ", "World", "Welt", "Świat", "Monde"],
    weapons: [
      "Оружие и звуки",
      "Зброя і звуки",
      "Weapons and sounds",
      "Waffen und Sounds",
      "Broń i dźwięki",
      "Armes et sons",
    ],
    clothing: ["Одежда", "Одяг", "Clothing", "Kleidung", "Ubrania", "Vêtements"],
    effects: ["Эффекты", "Ефекти", "Effects", "Effekte", "Efekty", "Effets"],
    carries: ["Везёт с собой", "Везе з собою", "Brings along", "Bringt mit", "Zabiera ze sobą"],
    optimization: ["Оптимизация", "Оптимізація", "Optimization", "Optimierung", "Optymalizacja", "Optimisation"],
    other: ["Другое", "Інше", "Other", "Sonstiges", "Inne", "Autre"],
  }],
  ["remove", "stamp", [
    "Снять «{}»",
    "Зняти «{}»",
    "Remove “{}”",
    "„{}“ entfernen",
    "Usuń „{}”",
    "Retirer «\u00a0{}\u00a0»",
  ]],
  ["install", "stamp", [
    "Поставить только «{}»",
    "Поставити лише «{}»",
    "Install only “{}”",
    "Nur „{}“ installieren",
    "Zainstaluj tylko „{}”",
    "Installer uniquement «\u00a0{}\u00a0»",
  ]],
  ["installed", "text", [
    "Стоит в игре",
    "Стоїть у грі",
    "In the game",
    "Im Spiel",
    "W grze",
    "Dans le jeu",
  ]],
  ["queued", "text", [
    "В очереди — открыть загрузки",
    "У черзі — відкрити завантаження",
    "Queued — open downloads",
    "In der Warteschlange — Downloads öffnen",
    "W kolejce — otwórz pobrane",
    "En file d'attente — ouvrir les téléchargements",
  ]],
  ["running", "stamp", [
    "Ставится, {} % — открыть загрузки",
    "Ставиться, {} % — відкрити завантаження",
    "Installing, {}% — open downloads",
    "Wird installiert, {} % — Downloads öffnen",
    "Instalacja, {}% — otwórz pobrane",
    "Installation, {}\u00a0% — ouvrir les téléchargements",
  ]],
  ["retry", "text", [
    "Не удалось — повторить",
    "Не вдалося — повторити",
    "Failed — try again",
    "Fehlgeschlagen — erneut versuchen",
    "Nie udało się — spróbuj ponownie",
    "Échec — réessayer",
  ]],
  ["replaces", "choice", {
    single: [
      "Заменит «{}»",
      "Замінить «{}»",
      "Replaces “{}”",
      "Ersetzt „{}“",
      "Zastąpi „{}”",
      "Remplacera «\u00a0{}\u00a0»",
    ],
    plural: [
      "Заменит {#} в игре",
      "Замінить {#} у грі",
      "Replaces {#} in the game",
      "Ersetzt {#} im Spiel",
      "Zastąpi {#} w grze",
      "Remplacera {#} dans le jeu",
    ],
    words: [
      ["мод", "мода", "модов"],
      ["мод", "моди", "модів", "мода"],
      ["mod", "mods"],
      ["Mod", "Mods"],
      ["mod", "mody", "modów", "modu"],
      ["mod", "mods"],
    ],
  }],
  ["actions", "text", ["Действия", "Дії", "Actions", "Aktionen", "Akcje", "Actions"]],
  ["versionsHeading", "text", [
    "Какую версию ставить",
    "Яку версію ставити",
    "Which version to install",
    "Welche Version installieren",
    "Którą wersję zainstalować",
    "Quelle version installer",
  ]],
  ["original", "text", [
    "Как в редуксе",
    "Як у редуксі",
    "As in the redux",
    "Wie im Redux",
    "Jak w reduksie",
    "Comme dans le Redux",
  ]],
  ["mine", "text", ["Моя карта", "Моя карта", "My map", "Meine Karte", "Moja mapa", "Ma carte"]],
  ["removeMapFirst", "text", [
    "В игре стоит большая карта мода — снимите её, чтобы поставить свою",
    "У грі стоїть велика карта мода — зніміть її, щоб поставити свою",
    "The mod's large map is in the game — remove it to install yours",
    "Die große Karte des Mods ist im Spiel — entferne sie, um deine zu installieren",
    "W grze jest duża mapa moda — usuń ją, aby zainstalować swoją",
    "La grande carte du mod est dans le jeu — retirez-la pour installer la vôtre",
  ]],
  ["mineNamed", "stamp", [
    "Моя: {}",
    "Моя: {}",
    "Mine: {}",
    "Meine: {}",
    "Moja: {}",
    "La mienne\u00a0: {}",
  ]],
  ["versions", "labelled", {
    line: [
      "Версия «{}» — {#}, выбрать",
      "Версія «{}» — {#}, вибрати",
      "Version “{}” — {#}, choose",
      "Version „{}“ — {#}, wählen",
      "Wersja „{}” — {#}, wybierz",
      "Version «\u00a0{}\u00a0» — {#}, choisir",
    ],
    words: [
      ["версия", "версии", "версий"],
      ["версія", "версії", "версій"],
      ["version", "versions"],
      ["Version", "Versionen"],
      ["wersja", "wersje", "wersji", "wersji"],
      ["version", "versions"],
    ],
  }],
  ["partName", "name", null],
];

function pluralRulesOf(code) {
  if (!pluralRules[code]) pluralRules[code] = new Intl.PluralRules(code);
  return pluralRules[code];
}

// Подпись «число слово»: слово выбирает платформа по числу и коду словаря.
function counter(code, words) {
  const throughWindow = WORDS_VIA_TR.includes(code);
  return (value) => {
    const forms = throughWindow ? words.map((word) => tr(word)) : words;
    const shown = `${value}`;
    const form = forms[FORM_SLOT[pluralRulesOf(code).select(value)]] || forms[1];
    return `${shown} ${form}`;
  };
}

// Куски шаблона идут по очереди: текст, метка, текст, метка, текст...
function expand(pieces, count, first, second) {
  let text = pieces[0];
  for (let at = 1; at < pieces.length; at += 2) {
    const arg = at === 1 ? first : second;
    text += pieces[at] === "{#}" ? count(arg) : `${arg}`;
    text += pieces[at + 1];
  }
  return text;
}

function oneArgument(template, count) {
  const pieces = template.split(/(\{#?\})/);
  return (value) => expand(pieces, count, value);
}

function twoArguments(template, count) {
  const pieces = template.split(/(\{#?\})/);
  return (label, number) => expand(pieces, count, label, number);
}

function gather(rows, column) {
  const group = {};
  for (const key of Object.keys(rows)) {
    if (rows[key][column] !== undefined) group[key] = rows[key][column];
  }
  return group;
}

function member(kind, data, code, column) {
  switch (kind) {
    case "text":
      return data[column];
    case "stamp":
      return oneArgument(data[column], null);
    case "count":
      return oneArgument("{#}", counter(code, data[column]));
    case "group":
      return gather(data, column);
    case "choice": {
      const single = oneArgument(data.single[column], null);
      const several = oneArgument(data.plural[column], counter(code, data.words[column]));
      return (list) => (list.length === 1 ? single(list[0]) : several(list.length));
    }
    case "labelled":
      return twoArguments(data.line[column], counter(code, data.words[column]));
    default:
      return (name, kinds = null) => localPartName(name, code, kinds);
  }
}

function buildDictionary(code) {
  const column = CODES.indexOf(code);
  const dictionary = {};
  for (const [key, kind, data] of ENTRIES) {
    const value = member(kind, data, code, column);
    // Имя функции совпадает с ключом; у partName оно пустое.
    if (typeof value === "function" && kind !== "name") {
      Object.defineProperty(value, "name", { value: key });
    }
    dictionary[key] = value;
  }
  return dictionary;
}

export function packContentsCopy(language = "ru") {
  const key = typeof language === "symbol" ? language : String(language);
  // Обычный объект: имена из прототипа отдают встроенные значения, как и раньше.
  const known = dictionaries[key];
  if (known !== undefined) return known;
  const code = CODES.includes(key) ? key : "en";
  if (!dictionaries[code]) dictionaries[code] = buildDictionary(code);
  return dictionaries[code];
}
