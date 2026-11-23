/*
 * Мини-карта: упрощение окна (владелец, 22.11.2026: «должно быть всё просто… сейчас, когда много наляпов стало, очень непонятно»).
 * Девять инструментов в новом порядке («Положение HP», «Линии HP», «Значки» с разделом «Урон с картинками», «Метки», «Положение карты»), «Тонкая настройка»
 * (строка уже есть в словаре), «Фон кадра» одной кнопкой с подсказкой у каждого пункта, проба здоровья и брони в углу кадра.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-minimap-simplify-2211.js`.
 */

export const zoneMinimapSimplify2211 = {
  /* Имена инструментов слева. */
  "Положение HP": ["Положення HP", "HP position", "HP-Position", "Pozycja HP"],
  "Линии HP": ["Лінії HP", "HP bars", "HP-Leisten", "Paski HP"],
  "Положение карты": [
    "Положення карти",
    "Map position",
    "Kartenposition",
    "Pozycja mapy",
  ],
  "HP отдельно от карты и готовые раскладки": [
    "HP окремо від карти та готові розкладки",
    "HP apart from the map and ready layouts",
    "HP getrennt von der Karte und fertige Layouts",
    "HP osobno od mapy i gotowe układy",
  ],
  "Включите «HP отдельно от карты» и выберите готовую раскладку — HP и броню можно тянуть по кадру":
    [
      "Увімкніть «HP окремо від карти» і виберіть готову розкладку — HP і броню можна тягнути по кадру",
      "Turn on “HP apart from the map” and pick a ready layout — HP and armor can then be dragged around the frame",
      "Aktivieren Sie „HP getrennt von der Karte“ und wählen Sie ein fertiges Layout — HP und Rüstung lassen sich dann im Bild ziehen",
      "Włącz „HP osobno od mapy” i wybierz gotowy układ — HP i pancerz można potem przeciągać po kadrze",
    ],
  "Значки HP и брони, цифры и урон с картинками": [
    "Значки HP і броні, цифри та шкода з картинками",
    "HP and armor icons, numbers and damage with pictures",
    "Symbole für HP und Rüstung, Zahlen und Schaden mit Bildern",
    "Ikony HP i pancerza, liczby i obrażenia z obrazkami",
  ],
  "Где карта стоит на экране игры, её размер и готовые мини-карты": [
    "Де карта стоїть на екрані гри, її розмір і готові мінікарти",
    "Where the map sits on the game screen, its size and ready-made minimaps",
    "Wo die Karte auf dem Spielbildschirm steht, ihre Größe und fertige Minikarten",
    "Gdzie mapa stoi na ekranie gry, jej rozmiar i gotowe minimapy",
  ],

  /* Раздел «Урон с картинками» внутри «Значков». */
  "Урон с картинками": [
    "Шкода з картинками",
    "Damage with pictures",
    "Schaden mit Bildern",
    "Obrażenia z obrazkami",
  ],
  "Запустите пробу: карта покажет урон по броне, потом по HP": [
    "Запустіть пробу: карта покаже шкоду броні, потім HP",
    "Run the test: the map shows damage to armor, then to HP",
    "Probe starten: Die Karte zeigt erst Schaden an der Rüstung, dann an den HP",
    "Uruchom próbę: mapa pokaże obrażenia pancerza, potem HP",
  ],

  /* Проба здоровья и брони в углу кадра. */
  "Проба: здоровье, броня": [
    "Проба: здоров’я, броня",
    "Test: health, armor",
    "Probe: Gesundheit, Rüstung",
    "Próba: zdrowie, pancerz",
  ],

  /* «Фон кадра»: подсказка в строку у каждого пункта. */
  "Живая улица, как в игре": [
    "Жива вулиця, як у грі",
    "Live street, like in the game",
    "Lebendige Straße wie im Spiel",
    "Żywa ulica, jak w grze",
  ],
  "Неподвижный кадр: удобно мерить на глаз": [
    "Нерухомий кадр: зручно міряти на око",
    "Still frame: easy to measure by eye",
    "Standbild: lässt sich gut nach Augenmaß ausmessen",
    "Nieruchoma klatka: łatwo mierzyć na oko",
  ],
  "Ровный фон: видно только вашу работу": [
    "Рівний фон: видно лише вашу роботу",
    "Plain background: only your work is visible",
    "Einfarbiger Hintergrund: nur Ihre Arbeit ist sichtbar",
    "Gładkie tło: widać tylko twoją pracę",
  ],

  /* «Разрешение игры» в «Положении карты»: готовые разрешения, своё число и формат. */
  "Разрешение игры": [
    "Роздільна здатність гри",
    "Game resolution",
    "Spielauflösung",
    "Rozdzielczość gry",
  ],
  "Готовые разрешения": [
    "Готові роздільні здатності",
    "Ready resolutions",
    "Fertige Auflösungen",
    "Gotowe rozdzielczości",
  ],
  "Ширина экрана, px": [
    "Ширина екрана, px",
    "Screen width, px",
    "Bildschirmbreite, px",
    "Szerokość ekranu, px",
  ],
  "Высота экрана, px": [
    "Висота екрана, px",
    "Screen height, px",
    "Bildschirmhöhe, px",
    "Wysokość ekranu, px",
  ],
  "Формат игры": ["Формат гри", "Game format", "Spielformat", "Format gry"],
  Формат: ["Формат", "Format", "Format", "Format"],
  "Допустимо от {0} до {1}": [
    "Допустимо від {0} до {1}",
    "Allowed: {0} to {1}",
    "Zulässig: {0} bis {1}",
    "Dozwolone: od {0} do {1}",
  ],
  "Растянутое {0} на {1}": [
    "Розтягнуте {0} на {1}",
    "Stretched {0} on {1}",
    "Gestrecktes {0} auf {1}",
    "Rozciągnięte {0} na {1}",
  ],
  "Разрешение меняет предпросмотр и растяжение кадра. Карта встанет на экране туда же при любом разрешении того же формата.":
    [
      "Роздільна здатність змінює попередній перегляд і розтягування кадру. Карта стане на екрані там само за будь-якої роздільної здатності того самого формату.",
      "The resolution changes the preview and the stretching of the frame. The map lands in the same place on screen at any resolution of the same format.",
      "Die Auflösung ändert die Vorschau und die Streckung des Bildes. Die Karte landet bei jeder Auflösung desselben Formats an derselben Stelle.",
      "Rozdzielczość zmienia podgląd i rozciągnięcie kadru. Mapa stanie na ekranie w tym samym miejscu przy każdej rozdzielczości tego samego formatu.",
    ],
  "Разрешение игры: как в игре": [
    "Роздільна здатність гри: як у грі",
    "Game resolution: as in the game",
    "Spielauflösung: wie im Spiel",
    "Rozdzielczość gry: jak w grze",
  ],
  "указано вами": [
    "вказано вами",
    "set by you",
    "von Ihnen angegeben",
    "podane przez ciebie",
  ],

  /* Выбранное отличается от найденного в настройках игры: установка считает под выбранное. */
  "В настройках игры сейчас {0}. Мини-карта будет рассчитана под выбранное: {1} ({2})":
    [
      "У налаштуваннях гри зараз {0}. Мінікарту буде розраховано під обране: {1} ({2})",
      "The game settings are currently {0}. The minimap will be calculated for your choice: {1} ({2})",
      "In den Spieleinstellungen steht aktuell {0}. Die Minikarte wird für Ihre Wahl berechnet: {1} ({2})",
      "W ustawieniach gry jest teraz {0}. Minimapa zostanie obliczona pod twój wybór: {1} ({2})",
    ],
  "Настройки игры не прочитаны. Мини-карта будет рассчитана под выбранное: {0} ({1})":
    [
      "Налаштування гри не прочитано. Мінікарту буде розраховано під обране: {0} ({1})",
      "The game settings could not be read. The minimap will be calculated for your choice: {0} ({1})",
      "Die Spieleinstellungen konnten nicht gelesen werden. Die Minikarte wird für Ihre Wahl berechnet: {0} ({1})",
      "Nie udało się odczytać ustawień gry. Minimapa zostanie obliczona pod twój wybór: {0} ({1})",
    ],

  /* Правило «наверху не больше пяти–шести ручек» (22.11.2026): разделы тонкой настройки. */
  "Малое HP и заливка": [
    "Мале HP і заливка",
    "Low HP and fill",
    "Wenig HP und Füllung",
    "Niskie HP i wypełnienie",
  ],
  "Размер значков": [
    "Розмір значків",
    "Icon size",
    "Symbolgröße",
    "Rozmiar ikon",
  ],
  "Цвет значков": ["Колір значків", "Icon color", "Symbolfarbe", "Kolor ikon"],
  "Расстановка цифр": [
    "Розстановка цифр",
    "Placing numbers",
    "Zahlen platzieren",
    "Rozmieszczanie liczb",
  ],
  "Сила, цвет и размер вспышки": [
    "Сила, колір і розмір спалаху",
    "Flash strength, color and size",
    "Stärke, Farbe und Größe des Blitzes",
    "Siła, kolor i rozmiar błysku",
  ],
  "Своё разрешение": [
    "Своя роздільна здатність",
    "Custom resolution",
    "Eigene Auflösung",
    "Własna rozdzielczość",
  ],
  "Мелкие цифры в игре не читаются: сделайте значок крупнее.": [
    "Дрібні цифри в грі не читаються: збільште значок.",
    "Small numbers are hard to read in the game: make the icon larger.",
    "Kleine Zahlen sind im Spiel schwer lesbar: Machen Sie das Symbol größer.",
    "Małych cyfr w grze nie da się odczytać: powiększ ikonę.",
  ],

  /* «Малая карта / Большая карта» из шапки сцены — строка тонкой настройки. */
  "Места на развёрнутом радаре": [
    "Місця на розгорнутому радарі",
    "Places on the expanded radar",
    "Plätze auf dem erweiterten Radar",
    "Miejsca na powiększonym radarze",
  ],
  "Развёрнутый радар — когда в игре карта раскрыта на пол-экрана": [
    "Розгорнутий радар — коли в грі карта розкрита на пів екрана",
    "Expanded radar: when the map is opened to half the screen in the game",
    "Erweitertes Radar: wenn die Karte im Spiel auf den halben Bildschirm geöffnet ist",
    "Powiększony radar: gdy w grze mapa jest rozwinięta na pół ekranu",
  ],
};
