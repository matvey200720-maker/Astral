// Слова страницы ReShade: кадры и числа DLSS 5.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Неразрывный пробел: во французском стоит перед «:» и внутри кавычек.
const NBSP = "\u00a0";

const QUOTE_MARKS = {
  ru: ["«", "»"],
  uk: ["«", "»"],
  en: ["“", "”"],
  de: ["„", "“"],
  pl: ["„", "”"],
  fr: [`«${NBSP}`, `${NBSP}»`],
};

function quoted(language, text) {
  const [open, close] = QUOTE_MARKS[language];
  return open + text + close;
}

function hasValue(value) {
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    !Number.isNaN(value)
  );
}

// Слово «драйвер» и часть «(драйвер 576.80)»; без версии — пустая строка.
const DRIVER_WORDS = {
  ru: "драйвер",
  uk: "драйвер",
  en: "driver",
  de: "Treiber",
  pl: "sterownik",
  fr: "pilote",
};

function driverNote(language, driver) {
  return hasValue(driver) ? ` (${DRIVER_WORDS[language]} ${driver})` : "";
}

// Подпись видеокарты в скобках для итога прошлого запуска.
function gpuNote(gpu) {
  return hasValue(gpu) ? ` (${gpu})` : "";
}

// Тексты без подстановок. Ключ — путь в таблице через точку.
const WORDS = {
  "scenes.dlss5": {
    ru: "Магазин",
    uk: "Магазин",
    en: "Store",
    de: "Laden",
    pl: "Sklep",
    fr: "Magasin",
  },
  "scenes.dlss5-airport": {
    ru: "Аэропорт днём",
    uk: "Аеропорт удень",
    en: "Airport by day",
    de: "Flughafen am Tag",
    pl: "Lotnisko w dzień",
    fr: "Aéroport de jour",
  },
  "scenes.dlss5-night": {
    ru: "Заправка ночью",
    uk: "Заправка вночі",
    en: "Gas station at night",
    de: "Tankstelle bei Nacht",
    pl: "Stacja paliw nocą",
    fr: "Station-service de nuit",
  },
  shotCaption: {
    ru: "Настоящие скриншоты ReShade из GTA V на RTX 4060. Пару снимает одна и та же камера: без DLSS 5, затем с ним. Тяни кадр: линия «до/после» идёт за курсором или пальцем.",
    uk: "Справжні скриншоти ReShade з GTA V на RTX 4060. Пару знімає та сама камера: без DLSS 5, потім з ним. Тягни кадр: лінія «до/після» йде за курсором або пальцем.",
    en: "Real ReShade screenshots of GTA V on an RTX 4060. One scripted camera shoots each pair: without DLSS 5, then with it. Drag a shot and the before/after line follows your cursor or finger.",
    de: "Echte ReShade-Screenshots aus GTA V auf einer RTX 4060. Jedes Paar nimmt dieselbe Skriptkamera auf: erst ohne DLSS 5, dann mit. Am Bild ziehen: Die Vorher-Nachher-Linie folgt Cursor oder Finger.",
    pl: "Prawdziwe zrzuty ReShade z GTA V na RTX 4060. Parę kręci ta sama kamera ze skryptu: najpierw bez DLSS 5, potem z nim. Pociągnij kadr, a linia „przed/po” pójdzie za kursorem lub palcem.",
    fr: `Vraies captures d’écran ReShade de GTA V sur une RTX 4060. Même caméra scriptée pour chaque paire${NBSP}: sans DLSS 5, puis avec. Glissez sur l’image${NBSP}: la ligne «${NBSP}avant/après${NBSP}» suit le curseur ou le doigt.`,
  },
  before: {
    ru: "Без DLSS 5",
    uk: "Без DLSS 5",
    en: "Without DLSS 5",
    de: "Ohne DLSS 5",
    pl: "Bez DLSS 5",
    fr: "Sans DLSS 5",
  },
  after: {
    ru: "С DLSS 5",
    uk: "З DLSS 5",
    en: "With DLSS 5",
    de: "Mit DLSS 5",
    pl: "Z DLSS 5",
    fr: "Avec DLSS 5",
  },
  detailBefore: {
    ru: "До",
    uk: "До",
    en: "Before",
    de: "Vorher",
    pl: "Przed",
    fr: "Avant",
  },
  detailAfter: {
    ru: "После",
    uk: "Після",
    en: "After",
    de: "Nachher",
    pl: "Po",
    fr: "Après",
  },
  "detail.light": {
    ru: "Свет и потолок",
    uk: "Світло й стеля",
    en: "Light and ceiling",
    de: "Licht und Decke",
    pl: "Światło i sufit",
    fr: "Lumière et plafond",
  },
  "detail.glass": {
    ru: "Стекло холодильников",
    uk: "Скло холодильників",
    en: "Fridge glass",
    de: "Kühlschrankglas",
    pl: "Szkło lodówek",
    fr: "Vitres des frigos",
  },
  "detail.floor": {
    ru: "Полки и пол",
    uk: "Полиці й підлога",
    en: "Shelves and floor",
    de: "Regale und Boden",
    pl: "Półki i podłoga",
    fr: "Étagères et sol",
  },
  noShot: {
    ru: "Кадр из игры ещё не снят",
    uk: "Кадр із гри ще не знято",
    en: "No game shot yet",
    de: "Spielbild noch nicht aufgenommen",
    pl: "Kadr z gry jeszcze nie został zrobiony",
    fr: "Capture du jeu pas encore réalisée",
  },
  gpuUnknown: {
    ru: "не определена",
    uk: "не визначена",
    en: "not detected",
    de: "nicht erkannt",
    pl: "nie wykryto",
    fr: "non détectée",
  },
  gpuNeeded: {
    ru: "DLSS 5 нужна карта NVIDIA RTX и свежий драйвер.",
    uk: "DLSS 5 потрібна карта NVIDIA RTX і свіжий драйвер.",
    en: "DLSS 5 requires an NVIDIA RTX card and an up-to-date driver.",
    de: "DLSS 5 benötigt eine NVIDIA-RTX-Grafikkarte und einen aktuellen Treiber.",
    pl: "DLSS 5 wymaga karty NVIDIA RTX i aktualnego sterownika.",
    fr: "DLSS 5 nécessite une carte NVIDIA RTX et un pilote à jour.",
  },
  priceTitle: {
    ru: "Цена — кадры",
    uk: "Ціна — кадри",
    en: "Price — frames",
    de: "Preis — Bilder",
    pl: "Koszt — klatki",
    fr: "Coût — FPS",
  },
  priceText: {
    ru: "Цена — кадры в секунду: на RTX 40 нейросеть съедает до трети и больше, на RTX 50 потери меньше. Бывают артефакты: дрожь мелких деталей, текстуры, «додуманные» нейросетью, искажения у интерфейса игры.",
    uk: "Ціна — кадри за секунду: на RTX 40 нейромережа забирає до третини й більше, на RTX 50 втрати менші. Бувають артефакти: тремтіння дрібних деталей, текстури, «домальовані» нейромережею, викривлення біля інтерфейсу гри.",
    en: "Frames per second are the price: on RTX 40 cards the network takes a noticeable share, up to a third or more; RTX 50 loses less. Artifacts happen: small details shimmer, textures get “invented” by the network, and the game interface may distort.",
    de: "Der Preis sind Bilder pro Sekunde: Auf RTX 40 verliert man durch das Netz spürbar, bis zu einem Drittel und mehr, auf RTX 50 weniger. Artefakte sind möglich: flimmernde Details, vom Netz „erfundene“ Texturen, Verzerrungen am Spiel-Interface.",
    pl: "Płaci się klatkami: na RTX 40 sieć zabiera wyraźną część, do jednej trzeciej i więcej, na RTX 50 mniej. Bywają artefakty: drżą drobne detale, tekstury „dopowiedziane” przez sieć, zniekształcenia przy interfejsie gry.",
    fr: `On paie en images par seconde${NBSP}: sur RTX 40, le réseau en prend une part notable, jusqu’à un tiers ou plus${NBSP}; sur RTX 50, moins. Des artefacts existent${NBSP}: détails qui scintillent, textures «${NBSP}inventées${NBSP}» par le réseau, distorsions près de l’interface du jeu.`,
  },
  buildTitle: {
    ru: "Сборка",
    uk: "Збірка",
    en: "Build",
    de: "Build",
    pl: "Wersja",
    fr: "Build",
  },
  numbersAria: {
    ru: "Числа DLSS 5",
    uk: "Числа DLSS 5",
    en: "DLSS 5 values",
    de: "Werte für DLSS 5",
    pl: "Wartości DLSS 5",
    fr: "Valeurs DLSS 5",
  },
  numbersNote: {
    ru: "100 % — как в пакете. Меньше процент — мягче перерисовка и меньше «додуманных» деталей.",
    uk: "100 % — як у пакеті. Менший відсоток — м'якша перемальовка й менше «домальованих» деталей.",
    en: "100 % is as in the pack. Lower values mean a gentler redraw and fewer invented details.",
    de: "100 % entspricht dem Paket. Je kleiner der Wert, desto sanfter die Neuzeichnung und desto weniger Erfundenes.",
    pl: "100 % to wartość z pakietu. Im mniejszy procent, tym łagodniej sieć przerysowuje i tym mniej dopowiada.",
    fr: `100 % — comme dans le pack. Plus c’est bas, plus la retouche est douce et moins le réseau invente de détails.`,
  },
  "targets.majestic.label": {
    ru: "Majestic и «Россия Онлайн»",
    uk: "Majestic і «Россия Онлайн»",
    en: "Majestic and «Россия Онлайн»",
    de: "Majestic und «Россия Онлайн»",
    pl: "Majestic i «Россия Онлайн»",
    fr: `Majestic et «${NBSP}Россия Онлайн${NBSP}»`,
  },
  "targets.majestic.place": {
    ru: "папка графических модов в лаунчере Majestic",
    uk: "папка графічних модів у лаунчері Majestic",
    en: "the Majestic launcher's graphics mods folder",
    de: "Ordner für Grafikmods im Majestic-Launcher",
    pl: "folder modów graficznych w launcherze Majestic",
    fr: "dossier des mods graphiques du lanceur Majestic",
  },
  "targets.game.label": {
    ru: "GTA 5 RP и одиночная игра",
    uk: "GTA 5 RP і одиночна гра",
    en: "GTA 5 RP and single player",
    de: "GTA 5 RP und Einzelspieler",
    pl: "GTA 5 RP i gra jednoosobowa",
    fr: "GTA 5 RP et jeu solo",
  },
  "targets.game.place": {
    ru: "корневая папка GTA V с GTA5.exe",
    uk: "коренева папка GTA V з GTA5.exe",
    en: "the GTA V folder with GTA5.exe",
    de: "Hauptordner von GTA V mit GTA5.exe",
    pl: "główny folder GTA V z GTA5.exe",
    fr: "dossier racine de GTA V avec GTA5.exe",
  },
  writeToGame: {
    ru: "Записать в игру",
    uk: "Записати в гру",
    en: "Write to game",
    de: "In das Spiel schreiben",
    pl: "Zapisz w grze",
    fr: "Écrire dans le jeu",
  },
  writing: {
    ru: "Записываем…",
    uk: "Записуємо…",
    en: "Writing…",
    de: "Wird geschrieben…",
    pl: "Zapisujemy…",
    fr: "Écriture…",
  },
  checking: {
    ru: "Смотрим, что стоит…",
    uk: "Дивимося, що встановлено…",
    en: "Checking what is installed…",
    de: "Installiertes wird geprüft…",
    pl: "Sprawdzamy, co jest zainstalowane…",
    fr: "Vérification de ce qui est installé…",
  },
  packMissing: {
    ru: "Пакета DLSS 5 нет рядом с приложением — переустанови Astral.",
    uk: "Пакета DLSS 5 немає поруч із застосунком — перевстанови Astral.",
    en: "DLSS 5 package not found beside the app — reinstall Astral.",
    de: "Das DLSS-5-Paket fehlt neben der App — Astral neu installieren.",
    pl: "Brak pakietu DLSS 5 obok aplikacji — zainstaluj Astral ponownie.",
    fr: "Le pack DLSS 5 est absent à côté de l’application — réinstallez Astral.",
  },
  // Название опции остаётся таким, как оно написано в лаунчере Majestic.
  supportNotice: {
    ru: "В лаунчере Majestic включена опция «Поддержка графических модификаций».",
    uk: "У лаунчері Majestic увімкнено опцію «Підтримка графічних модифікацій».",
    en: "Majestic launcher: “Graphics mods support” is already on.",
    de: "Majestic-Launcher: Option „Unterstützung für Grafikmodifikationen“ ist schon aktiv.",
    pl: "W Majestic włączona jest opcja „Obsługa modów graficznych”.",
    fr: `Dans le lanceur Majestic, l’option «${NBSP}Prise en charge des mods graphiques${NBSP}» est déjà activée.`,
  },
  "fields.intensity.label": {
    ru: "Сила нейросети",
    uk: "Сила нейромережі",
    en: "Neural network strength",
    de: "Stärke des neuronalen Netzes",
    pl: "Siła sieci neuronowej",
    fr: "Force du réseau de neurones",
  },
  "fields.intensity.hint": {
    ru: "Как сильно нейросеть перерисовывает картинку; 100 % — как в пакете",
    uk: "Як сильно нейромережа перемальовує кадр; 100 % — як у пакеті",
    en: "How strongly the network redraws the image; 100 % is as in the pack",
    de: "Wie stark das Netz das Bild neu zeichnet; 100 % wie im Paket",
    pl: "Jak mocno sieć przerysowuje obraz; 100 % to wartość z pakietu",
    fr: `Intensité de la retouche par le réseau${NBSP}; 100 % — comme dans le pack`,
  },
  "fields.globalTone.label": {
    ru: "Общий тон",
    uk: "Загальний тон",
    en: "Global tone",
    de: "Gesamtton",
    pl: "Ogólny ton",
    fr: "Tonalité globale",
  },
  "fields.globalTone.hint": {
    ru: "Свет и цвет кадра целиком",
    uk: "Світло й колір усього кадру",
    en: "Light and colour of the whole frame",
    de: "Licht und Farbe des ganzen Bildes",
    pl: "Światło i kolor całego kadru",
    fr: "Lumière et couleur de toute l’image",
  },
  "fields.localTone.label": {
    ru: "Локальный тон",
    uk: "Локальний тон",
    en: "Local tone",
    de: "Lokaler Ton",
    pl: "Lokalny ton",
    fr: "Tonalité locale",
  },
  "fields.localTone.hint": {
    ru: "Свет и тени по участкам кадра",
    uk: "Світло й тіні за ділянками кадру",
    en: "Light and shadow per frame area",
    de: "Licht und Schatten je Bildbereich",
    pl: "Światło i cienie w częściach kadru",
    fr: "Lumière et ombres par zone de l’image",
  },
  "fields.structure.label": {
    ru: "Детали",
    uk: "Деталі",
    en: "Detail",
    de: "Details",
    pl: "Szczegóły",
    fr: "Détails",
  },
  "fields.structure.hint": {
    ru: "Резкость и проработка поверхностей",
    uk: "Різкість і деталізація поверхонь",
    en: "Sharpness and surface detail",
    de: "Schärfe und Oberflächendetails",
    pl: "Ostrość i szczegóły powierzchni",
    fr: "Netteté et finesse des surfaces",
  },
};

// Начало подписи сравнения; название кадра или пресета дописывается после двоеточия.
const COMPARE_ACTIONS = {
  ru: "Сравнить до/после",
  uk: "Порівняти до/після",
  en: "Compare before/after",
  de: "Vorher-Nachher-Vergleich",
  pl: "Porównaj przed/po",
  fr: "Comparer avant/après",
};

// Единица измерения размера пакета.
const MEGABYTE_UNITS = {
  ru: "МБ",
  uk: "МБ",
  en: "MB",
  de: "MB",
  pl: "MB",
  fr: "Mo",
};

// Фразы, где порядок слов зависит от языка. Каждая получает значения для вставки.
const TEMPLATES = {
  gpuThis: {
    ru: ({ name, driver } = {}) =>
      `Твоя видеокарта — ${name}${driverNote("ru", driver)}, DLSS 5 с ней работает.`,
    uk: ({ name, driver } = {}) =>
      `Твоя відеокарта — ${name}${driverNote("uk", driver)}, DLSS 5 з нею працює.`,
    en: ({ name, driver } = {}) =>
      `This PC has ${name}${driverNote("en", driver)}: DLSS 5 works with this card.`,
    de: ({ name, driver } = {}) =>
      `In diesem PC steckt ${name}${driverNote("de", driver)}, DLSS 5 läuft damit.`,
    pl: ({ name, driver } = {}) =>
      `W tym komputerze jest ${name}${driverNote("pl", driver)}, DLSS 5 z nią działa.`,
    fr: ({ name, driver } = {}) =>
      `Ce PC embarque ${name}${driverNote("fr", driver)}${NBSP}: DLSS 5 fonctionne avec cette carte.`,
  },
  gpuNoRtx: {
    ru: ({ names } = {}) =>
      `Нет карты NVIDIA RTX (найдено: ${names}) — DLSS 5 не запустится.`,
    uk: ({ names } = {}) =>
      `Немає карти NVIDIA RTX (знайдено: ${names}) — DLSS 5 не запуститься.`,
    en: ({ names } = {}) =>
      `No NVIDIA RTX card (found: ${names}) — DLSS 5 will not start.`,
    de: ({ names } = {}) =>
      `Keine NVIDIA-RTX-Karte (gefunden: ${names}) — DLSS 5 startet nicht.`,
    pl: ({ names } = {}) =>
      `Brak karty NVIDIA RTX (znaleziono: ${names}) — DLSS 5 się nie uruchomi.`,
    fr: ({ names } = {}) =>
      `Pas de carte NVIDIA RTX (trouvé${NBSP}: ${names}) — DLSS 5 ne marchera pas.`,
  },
  lastWorked: {
    ru: (gpu) => `В прошлый запуск DLSS 5 сработал${gpuNote(gpu)}.`,
    uk: (gpu) => `Під час минулого запуску DLSS 5 спрацював${gpuNote(gpu)}.`,
    en: (gpu) => `DLSS 5 worked on the last game launch${gpuNote(gpu)}.`,
    de: (gpu) =>
      `Beim letzten Spielstart hat DLSS 5 funktioniert${gpuNote(gpu)}.`,
    pl: (gpu) =>
      `Przy ostatnim uruchomieniu gry DLSS 5 zadziałał${gpuNote(gpu)}.`,
    fr: (gpu) =>
      `Au dernier lancement du jeu, DLSS 5 a fonctionné${gpuNote(gpu)}.`,
  },
  lastFailed: {
    ru: (failure) =>
      `В прошлый запуск DLSS 5 не включился: ${quoted("ru", failure)}. Обнови драйвер NVIDIA и запусти игру ещё раз.`,
    uk: (failure) =>
      `Під час минулого запуску DLSS 5 не ввімкнувся: ${quoted("uk", failure)}. Онови драйвер NVIDIA і запусти гру ще раз.`,
    en: (failure) =>
      `DLSS 5 failed to turn on last time: ${quoted("en", failure)}. Update the NVIDIA driver and launch the game again.`,
    de: (failure) =>
      `Beim letzten Spielstart hat sich DLSS 5 nicht eingeschaltet: ${quoted("de", failure)}. Aktualisiere den NVIDIA-Treiber und starte das Spiel erneut.`,
    pl: (failure) =>
      `Przy ostatnim uruchomieniu DLSS 5 się nie włączył: ${quoted("pl", failure)}. Zaktualizuj sterownik NVIDIA i uruchom grę ponownie.`,
    fr: (failure) =>
      `DLSS 5 est resté éteint lors du dernier lancement${NBSP}: ${quoted("fr", failure)}. Mettez le pilote NVIDIA à jour, puis relancez le jeu.`,
  },
  settingsChanged: {
    ru: (summary) =>
      `Игра пока на ${quoted("ru", summary)} — жми ${quoted("ru", WORDS.writeToGame.ru)}.`,
    uk: (summary) =>
      `Гра ще на ${quoted("uk", summary)} — тисни ${quoted("uk", WORDS.writeToGame.uk)}.`,
    en: (summary) =>
      `The game still runs ${quoted("en", summary)}; press ${quoted("en", WORDS.writeToGame.en)}.`,
    de: (summary) =>
      `Im Spiel gilt noch ${quoted("de", summary)} — ${quoted("de", WORDS.writeToGame.de)} klicken.`,
    pl: (summary) =>
      `W grze nadal ${quoted("pl", summary)} — kliknij ${quoted("pl", WORDS.writeToGame.pl)}.`,
    fr: (summary) =>
      `Le jeu a encore ${quoted("fr", summary)} — cliquez sur ${quoted("fr", WORDS.writeToGame.fr)}.`,
  },
};

// Функции, у которых нет языковых различий в порядке слов, собираются из подписи и единицы.
function simpleFunctions(language) {
  const action = COMPARE_ACTIONS[language];
  const colon = language === "fr" ? `${NBSP}:` : ":";
  const unit = MEGABYTE_UNITS[language];
  return {
    shotTitle: (scene) => (hasValue(scene) ? `DLSS 5 — ${scene}` : "DLSS 5"),
    compareAria: (title) =>
      hasValue(title) ? `${action}${colon} ${title}` : action,
    megabytes: (value) => (hasValue(value) ? `${value} ${unit}` : unit),
  };
}

// Кладёт значение по пути «группа.ключ», создавая группы по дороге.
function put(table, path, value) {
  const steps = path.split(".");
  const last = steps.pop();
  let node = table;
  for (const step of steps) {
    node[step] ??= {};
    node = node[step];
  }
  node[last] = value;
}

function buildTable(language) {
  const table = {};
  for (const [path, texts] of Object.entries(WORDS)) {
    put(table, path, texts[language]);
  }
  for (const [key, byLanguage] of Object.entries(TEMPLATES)) {
    table[key] = byLanguage[language];
  }
  for (const [key, fn] of Object.entries(simpleFunctions(language))) {
    table[key] = fn;
  }
  return table;
}

const TABLES = new Map(
  LANGUAGES.map((language) => [language, buildTable(language)]),
);

export function reshadeCopyFor(language) {
  return TABLES.get(language) ?? TABLES.get("en");
}
