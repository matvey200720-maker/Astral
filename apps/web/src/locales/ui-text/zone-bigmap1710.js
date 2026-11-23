/*
 * Большая карта, ТЗ владельца 17.10.2026 (задача 9): лёгкие плитки карты
 * паузы (вес плитки в игре, цена каждой ступени чёткости, море в плитках) и
 * большая карта на мини-карте. Русская строка → [uk, en, de, pl].
 */

export const zoneBigmap1710 = {
  /* вес плитки и чёткость */
  "При прокрутке игра подгружает плитку целиком: {tile} МБ (штатная — {stockTile} МБ).": [
    "Під час прокручування гра довантажує плитку цілком: {tile} МБ (штатна — {stockTile} МБ).",
    "When you scroll, the game loads a whole tile at once: {tile} MB (stock — {stockTile} MB).",
    "Beim Scrollen lädt das Spiel eine Kachel komplett nach: {tile} MB (Standard — {stockTile} MB).",
    "Podczas przewijania gra doczytuje cały kafelek naraz: {tile} MB (standardowy — {stockTile} MB).",
  ],
  "{size} МБ, плитка {tile} МБ": [
    "{size} МБ, плитка {tile} МБ",
    "{size} MB, tile {tile} MB",
    "{size} MB, Kachel {tile} MB",
    "{size} MB, kafelek {tile} MB",
  ],
  "«Очень чётко» — самая резкая карта, но каждая плитка в игре в десять раз тяжелее штатной. Если при прокрутке карты в игре проседают кадры — поставьте «Чётко»: подписи чуть мягче вблизи, подгрузка в четыре раза легче.": [
    "«Дуже чітко» — найрізкіша карта, але кожна плитка в грі вдесятеро важча за штатну. Якщо під час прокручування карти в грі просідають кадри — поставте «Чітко»: підписи трохи м'якші зблизька, довантаження вчетверо легше.",
    "“Very sharp” is the crispest map, but every tile in the game is ten times heavier than the stock one. If frames drop while you scroll the map in the game, choose “Sharp”: labels are a little softer up close, and loading is four times lighter.",
    "„Sehr scharf“ ist die schärfste Karte, aber jede Kachel ist im Spiel zehnmal schwerer als die Standardkachel. Wenn beim Scrollen der Karte im Spiel Bilder einbrechen, wählen Sie „Scharf“: Beschriftungen sind aus der Nähe etwas weicher, das Nachladen ist viermal leichter.",
    "„Bardzo ostro” to najostrzejsza mapa, ale każdy kafelek w grze jest dziesięć razy cięższy od standardowego. Jeśli podczas przewijania mapy w grze spadają klatki — wybierz „Ostro”: podpisy z bliska są nieco miększe, a doczytywanie cztery razy lżejsze.",
  ],
  "Этим цветом игра зальёт воду вокруг штата и поле за краем карты при отдалении. Тем же цветом Astral запекает воду в плитки карты — шва у края нет, а плитки вдвое легче.": [
    "Цим кольором гра заллє воду навколо штату й поле за краєм карти під час віддалення. Тим самим кольором Astral запікає воду в плитки карти — шва біля краю немає, а плитки вдвічі легші.",
    "The game fills the water around the state and the area beyond the map edge with this colour when zoomed out. Astral bakes the same colour into the map tiles as water — there is no seam at the edge, and the tiles are half as heavy.",
    "Mit dieser Farbe füllt das Spiel das Wasser um den Staat und die Fläche hinter dem Kartenrand beim Herauszoomen. Dieselbe Farbe brennt Astral als Wasser in die Kartenkacheln ein — am Rand gibt es keine Naht, und die Kacheln sind halb so schwer.",
    "Tym kolorem gra wypełni wodę wokół stanu i pole za krawędzią mapy przy oddaleniu. Tym samym kolorem Astral wypala wodę w kafelkach mapy — na krawędzi nie ma szwu, a kafelki są o połowę lżejsze.",
  ],
  /* большая карта на мини-карте */
  "Большая карта на мини-карте": [
    "Велика карта на міні-карті",
    "World map on the minimap",
    "Weltkarte auf der Minikarte",
    "Mapa świata na minimapie",
  ],
  "Мини-карта показывает большую карту": [
    "Міні-карта показує велику карту",
    "The minimap shows the world map",
    "Die Minikarte zeigt die Weltkarte",
    "Minimapa pokazuje mapę świata",
  ],
  "Мини-карта — в цветах карты": [
    "Міні-карта — у кольорах карти",
    "Minimap in the map's colours",
    "Minikarte in den Farben der Karte",
    "Minimapa w kolorach mapy",
  ],
  "Карта сейчас как в игре — мини-карта остаётся штатной. Измените карту, и она встанет и на мини-карту.": [
    "Карта зараз як у грі — міні-карта лишається штатною. Змініть карту, і вона стане й на міні-карту.",
    "The map is currently as in the game, so the minimap stays stock. Change the map and it will go onto the minimap too.",
    "Die Karte ist gerade wie im Spiel, daher bleibt die Minikarte Standard. Ändern Sie die Karte, dann kommt sie auch auf die Minikarte.",
    "Mapa jest teraz jak w grze — minimapa zostaje standardowa. Zmień mapę, a trafi też na minimapę.",
  ],
  "Мини-карта покажет ту же картинку, что пауза: подписи, зоны и рисунок. Штатный вектор мини-карты станет прозрачным, а игре велено рисовать картинку всегда.": [
    "Міні-карта покаже той самий малюнок, що й пауза: підписи, зони й малюнок. Штатний вектор міні-карти стане прозорим, а грі велено малювати картинку завжди.",
    "The minimap will show the same picture as the pause map: labels, zones and drawings. The game's standard minimap vector becomes transparent, and the game is told to always draw the picture.",
    "Die Minikarte zeigt dasselbe Bild wie die Pausenkarte: Beschriftungen, Zonen und Zeichnungen. Der Standard-Vektor der Minikarte wird durchsichtig, und das Spiel zeichnet das Bild immer.",
    "Minimapa pokaże ten sam obraz co mapa pauzy: podpisy, strefy i rysunki. Standardowy wektor minimapy stanie się przezroczysty, a gra ma zawsze rysować obraz.",
  ],
  "Сейчас мини-карта перекрашивается в цвета вашей карты: подписи, зоны и рисунок на неё не попадают.": [
    "Зараз міні-карта перефарбовується в кольори вашої карти: підписи, зони й малюнок на неї не потрапляють.",
    "Right now the minimap is recoloured to match your map: labels, zones and drawings do not get onto it.",
    "Derzeit wird die Minikarte in den Farben Ihrer Karte umgefärbt: Beschriftungen, Zonen und Zeichnungen kommen nicht darauf.",
    "Teraz minimapa jest przemalowywana na kolory twojej mapy: podpisy, strefy i rysunki na nią nie trafiają.",
  ],
  "Проверено по файлам игры, в самой игре — ещё нет. Если мини-карта окажется пустой, выключите и нажмите «Применить»: вернётся перекраска. Вблизи картинка на мини-карте мягче, чем на паузе, а за краем карты (Кайо-Перико) мини-карта пустая.": [
    "Перевірено за файлами гри, у самій грі — ще ні. Якщо міні-карта виявиться порожньою, вимкніть і натисніть «Застосувати»: повернеться перефарбування. Зблизька картинка на міні-карті м’якша, ніж на паузі, а за краєм карти (Кайо-Періко) міні-карта порожня.",
    "Checked against the game files, not yet in the game itself. If the minimap turns out empty, switch this off and press “Apply”: the recolouring comes back. Up close the picture on the minimap is softer than on the pause map, and beyond the map edge (Cayo Perico) the minimap is empty.",
    "Anhand der Spieldateien geprüft, im Spiel selbst noch nicht. Ist die Minikarte leer, schalten Sie das aus und drücken „Anwenden“: Die Umfärbung kommt zurück. Aus der Nähe ist das Bild auf der Minikarte weicher als auf der Pausenkarte, und hinter dem Kartenrand (Cayo Perico) ist die Minikarte leer.",
    "Sprawdzono na plikach gry, w samej grze — jeszcze nie. Jeśli minimapa okaże się pusta, wyłącz to i naciśnij „Zastosuj”: wróci przemalowanie. Z bliska obraz na minimapie jest miększy niż na mapie pauzy, a za krawędzią mapy (Cayo Perico) minimapa jest pusta.",
  ],
  "Мини-карта в углу экрана показывает вашу карту — как на паузе, с подписями и зонами": [
    "Міні-карта в кутку екрана показує вашу карту — як на паузі, з підписами й зонами",
    "The minimap in the corner of the screen shows your map — as on the pause map, with labels and zones",
    "Die Minikarte in der Bildschirmecke zeigt Ihre Karte — wie im Pausenmenü, mit Beschriftungen und Zonen",
    "Minimapa w rogu ekranu pokazuje twoją mapę — jak na pauzie, z podpisami i strefami",
  ],
  "Вы изменили карту, поэтому при установке Astral выключит штатный векторный слой карты паузы: иначе при приближении игра рисует поверх вашей карты свою, и ваша «пропадает». Мини-карта в углу экрана покажет вашу карту — как на паузе, с подписями и зонами.": [
    "Ви змінили карту, тому під час встановлення Astral вимкне штатний векторний шар карти паузи: інакше під час наближення гра малює поверх вашої карти свою, і ваша «зникає». Міні-карта в кутку екрана покаже вашу карту — як на паузі, з підписами й зонами.",
    "You changed the map, so when installing, Astral turns off the game's standard vector layer of the pause map: otherwise, when zooming in, the game draws its own over yours and yours disappears. The minimap in the corner will show your map — as on the pause map, with labels and zones.",
    "Sie haben die Karte geändert, daher schaltet Astral bei der Installation die Standard-Vektorebene der Pausenkarte ab: Sonst zeichnet das Spiel beim Heranzoomen seine eigene über Ihre, und Ihre verschwindet. Die Minikarte in der Ecke zeigt Ihre Karte — wie im Pausenmenü, mit Beschriftungen und Zonen.",
    "Zmieniono mapę, więc podczas instalacji Astral wyłączy standardową warstwę wektorową mapy pauzy: inaczej przy przybliżeniu gra narysuje swoją nad twoją i twoja zniknie. Minimapa w rogu pokaże twoją mapę — jak na pauzie, z podpisami i strefami.",
  ],
  /* ссылка из редактора мини-карты */
  "Свою большую карту — с подписями и зонами — мини-карта показывает, если включить «Большую карту на мини-карте» в редакторе «Большая карта», раздел «Карта в игре».": [
    "Свою велику карту — з підписами й зонами — міні-карта показує, якщо ввімкнути «Велику карту на міні-карті» в редакторі «Велика карта», розділ «Карта в грі».",
    "The minimap shows your own world map — with labels and zones — if you turn on “World map on the minimap” in the “World map” editor, “Map in the game” section.",
    "Die Minikarte zeigt Ihre eigene Weltkarte — mit Beschriftungen und Zonen —, wenn Sie im Editor „Weltkarte“, Bereich „Karte im Spiel“, „Weltkarte auf der Minikarte“ einschalten.",
    "Minimapa pokazuje twoją własną mapę świata — z podpisami i strefami — jeśli włączysz „Mapa świata na minimapie” w edytorze „Mapa świata”, sekcja „Mapa w grze”.",
  ],
  "Открыть «Большую карту»": [
    "Відкрити «Велику карту»",
    "Open “World map”",
    "„Weltkarte“ öffnen",
    "Otwórz „Mapę świata”",
  ],
  /* что стоит в игре сейчас */
  "Сейчас в игре: карта {size} МБ, плитка {side}² {format}{mips} — {tile} МБ.": [
    "Зараз у грі: карта {size} МБ, плитка {side}² {format}{mips} — {tile} МБ.",
    "In the game now: the map is {size} MB, a tile is {side}² {format}{mips} — {tile} MB.",
    "Derzeit im Spiel: Karte {size} MB, Kachel {side}² {format}{mips} — {tile} MB.",
    "Teraz w grze: mapa {size} MB, kafelek {side}² {format}{mips} — {tile} MB.",
  ],
  "без мипов": ["без міпів", "no mipmaps", "ohne Mipmaps", "bez mipmap"],
  "Такая плитка в {times} раз тяжелее штатной, а игра подгружает её целиком, когда она входит в кадр, — отсюда пролаги при прокрутке карты. «Применить» поставит вашу карту: плитка {ours} МБ.": [
    "Така плитка в {times} разів важча за штатну, а гра довантажує її цілком, коли вона потрапляє в кадр, — звідси пролаги під час прокручування карти. «Застосувати» поставить вашу карту: плитка {ours} МБ.",
    "Such a tile is {times} times heavier than the stock one, and the game loads it whole when it comes into view — that is where the stutter while scrolling the map comes from. “Apply” puts your map in: a tile of {ours} MB.",
    "Eine solche Kachel ist {times}-mal schwerer als die Standardkachel, und das Spiel lädt sie komplett nach, sobald sie ins Bild kommt — daher das Ruckeln beim Scrollen der Karte. „Anwenden“ setzt Ihre Karte ein: Kachel {ours} MB.",
    "Taki kafelek jest {times} razy cięższy od standardowego, a gra doczytuje go w całości, gdy wchodzi w kadr — stąd przycięcia przy przewijaniu mapy. „Zastosuj” wstawi twoją mapę: kafelek {ours} MB.",
  ],
};
