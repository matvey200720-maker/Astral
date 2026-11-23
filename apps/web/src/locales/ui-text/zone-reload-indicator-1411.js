/*
 * Индикатор перезарядки в редакторе прицела (владелец, 14.11.2026): инструмент «Перезарядка», панель, кадр и подписи
 * договора (`reticle-contract/reload.js`). Русская строка → [uk, en, de, pl]; французский — `fr/zone-reload-indicator-1411.js`.
 */

export const zoneReloadIndicator1411 = {
  /* Инструмент и шапка панели. */
  "Заливка у прицела, пока ствол перезаряжается": [
    "Заливка біля приціла, поки зброя перезаряджається",
    "A fill next to the crosshair while the weapon reloads",
    "Eine Füllung am Fadenkreuz, solange die Waffe nachlädt",
    "Wypełnienie przy celowniku, gdy broń się przeładowuje",
  ],
  "Выберите готовый индикатор и нажмите «Перезарядка» — кадр покажет, как он заливается в игре":
    [
      "Виберіть готовий індикатор і натисніть «Перезарядка» — кадр покаже, як він заливається в грі",
      "Pick a ready-made indicator and press “Reload”: the frame shows how it fills in the game",
      "Wählen Sie einen fertigen Indikator und drücken Sie „Nachladen“ – das Bild zeigt, wie er sich im Spiel füllt",
      "Wybierz gotowy wskaźnik i naciśnij „Przeładowanie” — kadr pokaże, jak wypełnia się w grze",
    ],
  "Индикатор перезарядки": [
    "Індикатор перезарядки",
    "Reload indicator",
    "Nachladeanzeige",
    "Wskaźnik przeładowania",
  ],
  "Индикатор в игре": [
    "Індикатор у грі",
    "Indicator in the game",
    "Anzeige im Spiel",
    "Wskaźnik w grze",
  ],
  "Убрать индикатор перезарядки": [
    "Прибрати індикатор перезарядки",
    "Remove the reload indicator",
    "Nachladeanzeige entfernen",
    "Usuń wskaźnik przeładowania",
  ],
  "Поставить индикатор перезарядки": [
    "Поставити індикатор перезарядки",
    "Add the reload indicator",
    "Nachladeanzeige hinzufügen",
    "Dodaj wskaźnik przeładowania",
  ],
  "Индикатор перезарядки включён": [
    "Індикатор перезарядки увімкнено",
    "Reload indicator on",
    "Nachladeanzeige an",
    "Wskaźnik przeładowania włączony",
  ],
  "Индикатор перезарядки выключен": [
    "Індикатор перезарядки вимкнено",
    "Reload indicator off",
    "Nachladeanzeige aus",
    "Wskaźnik przeładowania wyłączony",
  ],
  "Выключен: «Применить» поставит прицел без индикатора, а в кадре он бледный. Любая настройка ниже включит его.":
    [
      "Вимкнено: «Застосувати» поставить приціл без індикатора, а в кадрі він блідий. Будь-яке налаштування нижче ввімкне його.",
      "Off: “Apply” installs the crosshair without the indicator, and it looks faded in the frame. Any setting below turns it on.",
      "Aus: „Anwenden“ installiert das Fadenkreuz ohne Anzeige, im Bild ist sie blass. Jede Einstellung unten schaltet sie ein.",
      "Wyłączony: „Zastosuj” zainstaluje celownik bez wskaźnika, a w kadrze jest blady. Każde ustawienie poniżej go włączy.",
    ],

  /* Кнопки показа в кадре. */
  "Обойма опустела: заливка идёт, пока игра не пришлёт полную обойму": [
    "Обойма спорожніла: заливка йде, поки гра не надішле повну обойму",
    "The magazine is empty: the fill runs until the game reports a full magazine",
    "Das Magazin ist leer: Die Füllung läuft, bis das Spiel ein volles Magazin meldet",
    "Magazynek jest pusty: wypełnianie trwa, aż gra zgłosi pełny magazynek",
  ],
  "Вы перезарядили неполную обойму сами: индикатор вспыхивает в конце": [
    "Ви самі перезарядили неповну обойму: індикатор спалахує наприкінці",
    "You reloaded a magazine that was not empty yourself: the indicator flashes at the end",
    "Sie haben ein nicht leeres Magazin selbst nachgeladen: Die Anzeige blitzt am Ende auf",
    "Sam przeładowałeś niepusty magazynek: wskaźnik błyska na końcu",
  ],
  Ручная: ["Вручну", "Manual", "Manuell", "Ręczne"],
  "Дробовик заряжается патрон за патроном": [
    "Дробовик заряджається патрон за патроном",
    "A shotgun loads one shell at a time",
    "Eine Schrotflinte lädt Patrone für Patrone",
    "Strzelba ładuje się nabój po naboju",
  ],
  "По патрону": [
    "По патрону",
    "Shell by shell",
    "Patrone für Patrone",
    "Po naboju",
  ],

  /* Готовые и «Как работает». */
  "Готовый индикатор": [
    "Готовий індикатор",
    "Ready-made indicator",
    "Fertige Anzeige",
    "Gotowy wskaźnik",
  ],
  "Как работает": [
    "Як працює",
    "How it works",
    "So funktioniert es",
    "Jak to działa",
  ],
  "Слова «перезарядка» игра прицелу не шлёт. Astral смотрит на числа патронов: обойма опустела, а запас есть — заливка пошла; обойма снова полная — заливка закончилась.":
    [
      "Слова «перезарядка» гра приціл не надсилає. Astral дивиться на числа набоїв: обойма спорожніла, а запас є — заливка пішла; обойма знову повна — заливка закінчилася.",
      "The game never tells the crosshair the word “reload”. Astral watches the ammo numbers: the magazine is empty and there is spare ammo — the fill starts; the magazine is full again — the fill ends.",
      "Das Wort „Nachladen“ schickt das Spiel dem Fadenkreuz nicht. Astral beobachtet die Munitionszahlen: Magazin leer und Vorrat da – die Füllung beginnt; Magazin wieder voll – die Füllung endet.",
      "Słowa „przeładowanie” gra celownikowi nie wysyła. Astral patrzy na liczby amunicji: magazynek pusty, a zapas jest — wypełnianie rusza; magazynek znowu pełny — wypełnianie się kończy.",
    ],
  "Длительность перезарядки каждого ствола Astral берёт при установке из файлов игры: weapons.meta и клипа перезарядки. Не успела — заливка ждёт на 95 %. Если у ствола длительность не нашлась, заливки по ходу нет: индикатор дозаливается, когда приходит полная обойма.":
    [
      "Тривалість перезарядки кожної зброї Astral бере під час встановлення з файлів гри: weapons.meta і кліпу перезарядки. Не встигла — заливка чекає на 95 %. Якщо тривалість зброї не знайшлася, заливки під час перезарядки немає: індикатор доливається, коли приходить повна обойма.",
      "Astral takes each weapon’s reload duration from the game files at install time: weapons.meta and the reload clip. If the reload runs longer, the fill waits at 95 %. If a weapon’s duration was not found, there is no fill along the way: the indicator fills up when the full magazine arrives.",
      "Die Nachladedauer jeder Waffe liest Astral bei der Installation aus den Spieldateien: weapons.meta und der Nachlade-Clip. Dauert es länger, wartet die Füllung bei 95 %. Wurde für eine Waffe keine Dauer gefunden, gibt es währenddessen keine Füllung: Die Anzeige füllt sich auf, sobald das volle Magazin gemeldet wird.",
      "Czas przeładowania każdej broni Astral bierze przy instalacji z plików gry: weapons.meta i klipu przeładowania. Gdy trwa dłużej, wypełnienie czeka na 95 %. Jeśli dla broni nie znaleziono czasu, w trakcie nie ma wypełniania: wskaźnik dopełnia się, gdy przyjdzie pełny magazynek.",
    ],
  "У гранат, РПГ и оружия без обоймы индикатора нет. Если сервер прячет прицел целиком, индикатор прячется вместе с ним.":
    [
      "У гранат, РПГ і зброї без обойми індикатора немає. Якщо сервер ховає приціл повністю, індикатор ховається разом із ним.",
      "Grenades, the RPG and weapons without a magazine have no indicator. If a server hides the whole crosshair, the indicator hides with it.",
      "Granaten, RPG und Waffen ohne Magazin haben keine Anzeige. Blendet ein Server das ganze Fadenkreuz aus, verschwindet die Anzeige mit.",
      "Granaty, RPG i broń bez magazynka nie mają wskaźnika. Jeśli serwer ukrywa cały celownik, wskaźnik znika razem z nim.",
    ],
  "Настройки индикатора": [
    "Налаштування індикатора",
    "Indicator settings",
    "Anzeigeeinstellungen",
    "Ustawienia wskaźnika",
  ],

  /* Страницы. */
  "Ручная перезарядка": [
    "Ручна перезарядка",
    "Manual reload",
    "Manuelles Nachladen",
    "Ręczne przeładowanie",
  ],
  "Вспышка в конце": [
    "Спалах наприкінці",
    "Flash at the end",
    "Blitz am Ende",
    "Błysk na końcu",
  ],
  "Вид индикатора": [
    "Вигляд індикатора",
    "Indicator style",
    "Anzeigestil",
    "Wygląd wskaźnika",
  ],
  "Перезарядка: вид": [
    "Перезарядка: вигляд",
    "Reload: style",
    "Nachladen: Stil",
    "Przeładowanie: wygląd",
  ],
  "Перезарядка: значок": [
    "Перезарядка: значок",
    "Reload: icon",
    "Nachladen: Symbol",
    "Przeładowanie: ikona",
  ],
  "Дуги кольца": ["Дуги кола", "Ring arcs", "Ringbögen", "Łuki pierścienia"],
  "Перезарядка: дуги": [
    "Перезарядка: дуги",
    "Reload: arcs",
    "Nachladen: Bögen",
    "Przeładowanie: łuki",
  ],
  "Откуда заливка": [
    "Звідки заливка",
    "Fill starts from",
    "Füllung beginnt",
    "Skąd wypełnienie",
  ],
  "Перезарядка: откуда заливка": [
    "Перезарядка: звідки заливка",
    "Reload: fill start",
    "Nachladen: Füllbeginn",
    "Przeładowanie: skąd wypełnienie",
  ],
  "Перезарядка: размер": [
    "Перезарядка: розмір",
    "Reload: size",
    "Nachladen: Größe",
    "Przeładowanie: rozmiar",
  ],
  "Перезарядка: толщина": [
    "Перезарядка: товщина",
    "Reload: thickness",
    "Nachladen: Dicke",
    "Przeładowanie: grubość",
  ],
  "Перезарядка: цвет": [
    "Перезарядка: колір",
    "Reload: colour",
    "Nachladen: Farbe",
    "Przeładowanie: kolor",
  ],
  "Цвет пустой части": [
    "Колір порожньої частини",
    "Empty part colour",
    "Farbe des leeren Teils",
    "Kolor pustej części",
  ],
  "Перезарядка: цвет пустой части": [
    "Перезарядка: колір порожньої частини",
    "Reload: empty part colour",
    "Nachladen: Farbe des leeren Teils",
    "Przeładowanie: kolor pustej części",
  ],
  "Перезарядка: пустая часть": [
    "Перезарядка: порожня частина",
    "Reload: empty part",
    "Nachladen: leerer Teil",
    "Przeładowanie: pusta część",
  ],
  "Перезарядка: прозрачность": [
    "Перезарядка: прозорість",
    "Reload: opacity",
    "Nachladen: Deckkraft",
    "Przeładowanie: przezroczystość",
  ],
  "Перетащите индикатор в кадре или задайте сдвиг от середины прицела в точках экрана 1280×720. Прицел игра ставит в середину экрана.":
    [
      "Перетягніть індикатор у кадрі або задайте зсув від середини приціла в точках екрана 1280×720. Приціл гра ставить у середину екрана.",
      "Drag the indicator in the frame or set its offset from the crosshair centre in 1280×720 screen points. The game puts the crosshair in the middle of the screen.",
      "Ziehen Sie die Anzeige im Bild oder legen Sie den Versatz zur Fadenkreuzmitte in Punkten des 1280×720-Bildschirms fest. Das Spiel setzt das Fadenkreuz in die Bildschirmmitte.",
      "Przeciągnij wskaźnik w kadrze albo ustaw przesunięcie od środka celownika w punktach ekranu 1280×720. Gra stawia celownik na środku ekranu.",
    ],
  "Быстрое место": [
    "Швидке місце",
    "Quick position",
    "Schnelle Position",
    "Szybkie miejsce",
  ],
  "Перезарядка: место": [
    "Перезарядка: місце",
    "Reload: position",
    "Nachladen: Position",
    "Przeładowanie: miejsce",
  ],
  "При ручной перезарядке вспыхивает в конце": [
    "Під час ручної перезарядки спалахує наприкінці",
    "Flashes at the end of a manual reload",
    "Blitzt beim manuellen Nachladen am Ende auf",
    "Przy ręcznym przeładowaniu błyska na końcu",
  ],
  "Индикатор быстро дозаливается, когда обойма снова полная": [
    "Індикатор швидко доливається, коли обойма знову повна",
    "The indicator quickly fills up when the magazine is full again",
    "Die Anzeige füllt sich schnell auf, wenn das Magazin wieder voll ist",
    "Wskaźnik szybko się dopełnia, gdy magazynek znowu jest pełny",
  ],
  "Перезарядка: вспышка в конце": [
    "Перезарядка: спалах наприкінці",
    "Reload: flash at the end",
    "Nachladen: Blitz am Ende",
    "Przeładowanie: błysk na końcu",
  ],
  "Когда вы перезаряжаете неполную обойму сами, игра присылает только новые числа в конце: начала Astral не видит, поэтому заливки по ходу нет.":
    [
      "Коли ви самі перезаряджаєте неповну обойму, гра надсилає лише нові числа наприкінці: початку Astral не бачить, тож заливки під час перезарядки немає.",
      "When you reload a magazine that is not empty yourself, the game only sends the new numbers at the end: Astral cannot see the start, so there is no fill along the way.",
      "Laden Sie ein nicht leeres Magazin selbst nach, schickt das Spiel erst am Ende die neuen Zahlen: Den Beginn sieht Astral nicht, daher gibt es keine Füllung währenddessen.",
      "Gdy sam przeładowujesz niepusty magazynek, gra wysyła tylko nowe liczby na końcu: początku Astral nie widzi, więc w trakcie nie ma wypełniania.",
    ],

  /* Подписи договора: виды, значки, готовые и места. */
  "заливается по часовой от верха": [
    "заливається за годинниковою від верху",
    "fills clockwise from the top",
    "füllt sich im Uhrzeigersinn von oben",
    "wypełnia się zgodnie z zegarem od góry",
  ],
  "полоса слева направо или от середины": [
    "смуга зліва направо або від середини",
    "a bar from left to right or from the middle",
    "ein Balken von links nach rechts oder von der Mitte",
    "pasek od lewej do prawej albo od środka",
  ],
  "значок заливается снизу вверх": [
    "значок заливається знизу вгору",
    "the icon fills from the bottom up",
    "das Symbol füllt sich von unten nach oben",
    "ikona wypełnia się od dołu do góry",
  ],
  "От середины": [
    "Від середини",
    "From the middle",
    "Von der Mitte",
    "Od środka",
  ],
  "Пустая часть": [
    "Порожня частина",
    "Empty part",
    "Leerer Teil",
    "Pusta część",
  ],
  Патрон: ["Набій", "Bullet", "Patrone", "Nabój"],
  "Три патрона": ["Три набої", "Three bullets", "Drei Patronen", "Trzy naboje"],
  "Магазин патронов": ["Магазин набоїв", "Magazine", "Magazin", "Magazynek"],
  Гильза: ["Гільза", "Shell", "Hülse", "Łuska"],
  Вокруг: ["Навколо", "Around", "Rundherum", "Dookoła"],
  "Под прицелом": [
    "Під прицілом",
    "Below the crosshair",
    "Unter dem Fadenkreuz",
    "Pod celownikiem",
  ],
  "Над прицелом": [
    "Над прицілом",
    "Above the crosshair",
    "Über dem Fadenkreuz",
    "Nad celownikiem",
  ],

  /* Кадр. */
  "Индикатор перезарядки — те же кадры заливки, что уйдут в игру; в игре он виден только во время перезарядки.":
    [
      "Індикатор перезарядки — ті самі кадри заливки, що підуть у гру; у грі його видно лише під час перезарядки.",
      "The reload indicator uses the same fill frames that go into the game; in the game it shows only while reloading.",
      "Die Nachladeanzeige nutzt dieselben Füllbilder, die ins Spiel gehen; im Spiel ist sie nur beim Nachladen sichtbar.",
      "Wskaźnik przeładowania to te same klatki wypełnienia, które trafią do gry; w grze widać go tylko podczas przeładowania.",
    ],
  "Бледный индикатор выключен — в игру он не уйдёт.": [
    "Блідий індикатор вимкнено — у гру він не піде.",
    "The faded indicator is off — it will not go into the game.",
    "Die blasse Anzeige ist aus – sie kommt nicht ins Spiel.",
    "Blady wskaźnik jest wyłączony — nie trafi do gry.",
  ],
};
