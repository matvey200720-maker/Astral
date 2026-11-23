/*
 * «Дороги», разметка по группам (ТЗ 17.10.2026, вечер, задача 1): названия
 * и пояснения групп, яркость и износ краски, неон, «Скрыть всё». Группы —
 * слова контракта (`packages/climb-contract/recolor/roads.js`), переводятся в
 * месте отрисовки (`roads-editor/roads-text.js`).
 * Русская строка → [uk, en, de, pl].
 */

export const zoneRoads1710b = {
  "Осевая (жёлтая)": ["Осьова (жовта)", "Centre line (yellow)", "Mittellinie (gelb)", "Linia osiowa (żółta)"],
  "Края и полосы (белая)": ["Краї й смуги (біла)", "Edges and lanes (white)", "Ränder und Fahrstreifen (weiß)", "Krawędzie i pasy (biała)"],
  "Пешеходные переходы": ["Пішохідні переходи", "Pedestrian crossings", "Fußgängerüberwege", "Przejścia dla pieszych"],
  "Стоп-линии и стрелки": ["Стоп-лінії та стрілки", "Stop lines and arrows", "Haltelinien und Pfeile", "Linie zatrzymania i strzałki"],
  "Цветная разметка": ["Кольорова розмітка", "Coloured markings", "Farbige Markierungen", "Kolorowe oznakowanie"],
  "Парковка": ["Парковка", "Parking", "Parken", "Parking"],
  "Жёлтые линии вдоль дороги: осевая, двойная, жёлтая кромка бордюра": [
    "Жовті лінії вздовж дороги: осьова, подвійна, жовта кромка бордюру",
    "Yellow lines along the road: centre, double, yellow kerb edge",
    "Gelbe Linien entlang der Straße: Mittellinie, Doppellinie, gelber Bordsteinrand",
    "Żółte linie wzdłuż drogi: osiowa, podwójna, żółta krawędź krawężnika",
  ],
  "Белые линии вдоль дороги: края, полосы, прерывистая": [
    "Білі лінії вздовж дороги: краї, смуги, переривчаста",
    "White lines along the road: edges, lanes, dashed",
    "Weiße Linien entlang der Straße: Ränder, Fahrstreifen, gestrichelt",
    "Białe linie wzdłuż drogi: krawędzie, pasy, przerywana",
  ],
  "Полосы зебры": ["Смуги зебри", "Zebra stripes", "Zebrastreifen", "Pasy zebry"],
  "Стоп-линии поперёк дороги, стрелки, надписи и значки на асфальте": [
    "Стоп-лінії впоперек дороги, стрілки, написи й значки на асфальті",
    "Stop lines across the road, arrows, lettering and symbols on the asphalt",
    "Haltelinien quer zur Straße, Pfeile, Schriftzüge und Symbole auf dem Asphalt",
    "Linie zatrzymania w poprzek drogi, strzałki, napisy i znaki na asfalcie",
  ],
  "Синяя, красная и зелёная краска: велополосы, места для инвалидов, остановки": [
    "Синя, червона й зелена фарба: велосмуги, місця для людей з інвалідністю, зупинки",
    "Blue, red and green paint: bike lanes, accessible bays, bus stops",
    "Blaue, rote und grüne Farbe: Radstreifen, Behindertenplätze, Haltestellen",
    "Niebieska, czerwona i zielona farba: pasy rowerowe, miejsca dla niepełnosprawnych, przystanki",
  ],
  "Линии парковочных мест. Общий «Скрыть» и общая яркость их не трогают": [
    "Лінії паркувальних місць. Загальні «Сховати» і яскравість їх не чіпають",
    "Parking bay lines. The global Hide and brightness do not touch them",
    "Linien der Parkplätze. Das allgemeine Ausblenden und die allgemeine Helligkeit betreffen sie nicht",
    "Linie miejsc parkingowych. Ogólne ukrywanie i jasność ich nie dotyczą",
  ],
  "скрыта": ["схована", "hidden", "ausgeblendet", "ukryta"],
  "цвет": ["колір", "colour", "Farbe", "kolor"],
  "яркость": ["яскравість", "brightness", "Helligkeit", "jasność"],
  "100 % — как в игре; меньше — стёртая, больше — свежая яркая краска": [
    "100 % — як у грі; менше — стерта, більше — свіжа яскрава фарба",
    "100 % is as in the game; less — worn, more — fresh bright paint",
    "100 % wie im Spiel; weniger — verblasst, mehr — frische leuchtende Farbe",
    "100 % — jak w grze; mniej — starta, więcej — świeża jaskrawa farba",
  ],
  "Общая для всех групп, кроме парковки. 100 % — как в игре; меньше — стёртая, больше — свежая краска, до 250 % — неон": [
    "Спільна для всіх груп, крім парковки. 100 % — як у грі; менше — стерта, більше — свіжа фарба, до 250 % — неон",
    "Shared by all groups except parking. 100 % is as in the game; less — worn, more — fresh paint, up to 250 % — neon",
    "Gilt für alle Gruppen außer Parken. 100 % wie im Spiel; weniger — verblasst, mehr — frische Farbe, bis 250 % — Neon",
    "Wspólna dla wszystkich grup oprócz parkingu. 100 % — jak w grze; mniej — starta, więcej — świeża farba, do 250 % — neon",
  ],
  "Износ краски": ["Знос фарби", "Paint wear", "Farbabnutzung", "Zużycie farby"],
  "100 % — потёртость краски как в игре; 0 % — ровная свежая краска без стёртых мест, как у неона": [
    "100 % — потертість фарби як у грі; 0 % — рівна свіжа фарба без стертих місць, як у неону",
    "100 % — paint wear as in the game; 0 % — even fresh paint with no worn spots, like neon",
    "100 % — Abnutzung wie im Spiel; 0 % — gleichmäßige frische Farbe ohne abgenutzte Stellen, wie bei Neon",
    "100 % — zużycie farby jak w grze; 0 % — równa świeża farba bez wytartych miejsc, jak w neonie",
  ],
  "Убирает краску всех групп, кроме парковки: листы разметки становятся прозрачными, линии в асфальте закрашиваются тем же асфальтом рядом, жёлтая полоса бордюра — цветом бордюра.": [
    "Прибирає фарбу всіх груп, крім парковки: аркуші розмітки стають прозорими, лінії в асфальті замальовуються тим самим асфальтом поруч, жовта смуга бордюру — кольором бордюру.",
    "Removes the paint of all groups except parking: marking sheets become transparent, lines in the asphalt are painted over with the asphalt next to them, the yellow kerb stripe takes the kerb colour.",
    "Entfernt die Farbe aller Gruppen außer Parken: Markierungsblätter werden transparent, Linien im Asphalt werden mit dem Asphalt daneben übermalt, der gelbe Bordsteinstreifen bekommt die Bordsteinfarbe.",
    "Usuwa farbę wszystkich grup oprócz parkingu: arkusze oznakowania stają się przezroczyste, linie w asfalcie zamalowuje sąsiedni asfalt, żółty pasek krawężnika dostaje kolor krawężnika.",
  ],
  "Одна и та же краска — в листах разметки, в линиях, нарисованных прямо в асфальте дорог, переходов и перекрёстков, во встроенных листах моделей и в дальних планах: цвет меняется везде сразу, поэтому линии не двоятся и не расходятся вблизи и вдали. Форма линий — как в игре.": [
    "Одна й та сама фарба — в аркушах розмітки, у лініях, намальованих просто в асфальті доріг, переходів і перехресть, у вбудованих аркушах моделей і в далеких планах: колір змінюється скрізь одразу, тому лінії не двояться й не розходяться зблизька та здалеку. Форма ліній — як у грі.",
    "The same paint lives in marking sheets, in lines drawn right into the asphalt of roads, crossings and junctions, in the sheets embedded in models and in the distant levels: the colour changes everywhere at once, so lines do not double up or drift apart near and far. The shape of the lines is as in the game.",
    "Dieselbe Farbe steckt in Markierungsblättern, in Linien direkt im Asphalt von Straßen, Überwegen und Kreuzungen, in den in Modelle eingebetteten Blättern und in den fernen Ebenen: Die Farbe ändert sich überall zugleich, deshalb verdoppeln sich die Linien nicht und laufen nah und fern nicht auseinander. Die Form der Linien bleibt wie im Spiel.",
    "Ta sama farba jest w arkuszach oznakowania, w liniach narysowanych wprost w asfalcie dróg, przejść i skrzyżowań, we wbudowanych arkuszach modeli i w dalekich planach: kolor zmienia się wszędzie naraz, więc linie nie dwoją się i nie rozjeżdżają z bliska ani z daleka. Kształt linii jest jak w grze.",
  ],
  "Неон: яркий насыщенный цвет, яркость выше 100 % и износ 0 %. Краска остаётся обычной краской на асфальте: ночью она не светит сама, а отражает свет фар и фонарей.": [
    "Неон: яскравий насичений колір, яскравість понад 100 % і знос 0 %. Фарба лишається звичайною фарбою на асфальті: уночі вона не світиться сама, а відбиває світло фар і ліхтарів.",
    "Neon: a bright saturated colour, brightness above 100 % and wear 0 %. The paint stays ordinary paint on the asphalt: at night it does not glow by itself but reflects the light of headlights and street lamps.",
    "Neon: eine leuchtende gesättigte Farbe, Helligkeit über 100 % und Abnutzung 0 %. Die Farbe bleibt gewöhnliche Farbe auf dem Asphalt: Nachts leuchtet sie nicht von selbst, sondern spiegelt das Licht von Scheinwerfern und Laternen.",
    "Neon: jaskrawy nasycony kolor, jasność powyżej 100 % i zużycie 0 %. Farba pozostaje zwykłą farbą na asfalcie: w nocy nie świeci sama, tylko odbija światło reflektorów i latarni.",
  ],
  "Осевая, края, переходы, стрелки": ["Осьова, краї, переходи, стрілки", "Centre, edges, crossings, arrows", "Mittellinie, Ränder, Überwege, Pfeile", "Osiowa, krawędzie, przejścia, strzałki"],
  "Каждая разметка отдельно: цвет, яркость, неон или «Скрыть» — везде, где она есть": [
    "Кожна розмітка окремо: колір, яскравість, неон або «Сховати» — скрізь, де вона є",
    "Each marking on its own: colour, brightness, neon or Hide — everywhere it appears",
    "Jede Markierung einzeln: Farbe, Helligkeit, Neon oder Ausblenden — überall, wo sie vorkommt",
    "Każde oznakowanie osobno: kolor, jasność, neon lub Ukryj — wszędzie, gdzie występuje",
  ],
  "Свежая краска": ["Свіжа фарба", "Fresh paint", "Frische Farbe", "Świeża farba"],
  "На участке по куску каждой краски: надпись со стоп-линией, переход, цветные полосы, линии со стрелками и парковка.": [
    "На ділянці по шматку кожної фарби: напис зі стоп-лінією, перехід, кольорові смуги, лінії зі стрілками та парковка.",
    "The section carries a piece of every kind of paint: lettering with a stop line, a crossing, coloured stripes, lines with arrows and parking.",
    "Der Abschnitt trägt ein Stück jeder Farbe: Schriftzug mit Haltelinie, Überweg, farbige Streifen, Linien mit Pfeilen und Parkplatz.",
    "Odcinek niesie kawałek każdej farby: napis z linią zatrzymania, przejście, kolorowe pasy, linie ze strzałkami i parking.",
  ],
  "В игре правка ложится на словари карты ({0}) и модели со встроенными листами ({1}) — общие словари, их копии высокой чёткости, дальние планы, словари районов и сами модели; интерьеры, асфальт парковок, отбойники и знаки не трогаются.": [
    "У грі правка лягає на словники карти ({0}) і моделі із вбудованими аркушами ({1}) — спільні словники, їхні копії високої чіткості, далекі плани, словники районів і самі моделі; інтер’єри, асфальт парковок, відбійники й знаки не чіпаються.",
    "In the game the edit applies to map dictionaries ({0}) and models with embedded sheets ({1}) — the shared dictionaries, their high-definition copies, the distant levels, district dictionaries and the models themselves; interiors, car-park asphalt, crash barriers and signs are not touched.",
    "Im Spiel wirkt die Änderung auf Kartenwörterbücher ({0}) und Modelle mit eingebetteten Blättern ({1}) — die gemeinsamen Wörterbücher, ihre hochauflösenden Kopien, die fernen Ebenen, Viertel-Wörterbücher und die Modelle selbst; Innenräume, Parkplatzasphalt, Leitplanken und Schilder bleiben unberührt.",
    "W grze zmiana dotyczy słowników mapy ({0}) i modeli z wbudowanymi arkuszami ({1}) — wspólnych słowników, ich kopii wysokiej rozdzielczości, dalekich planów, słowników dzielnic i samych modeli; wnętrza, asfalt parkingów, barierki i znaki nie są ruszane.",
  ],
  "Ложится на файлы карты: {0}, из них моделей — {1}; листов вблизи — {2}, вдали — {3}.": [
    "Лягає на файли карти: {0}, з них моделей — {1}; аркушів зблизька — {2}, здалеку — {3}.",
    "Applies to map files: {0}, of them models — {1}; sheets up close — {2}, in the distance — {3}.",
    "Wirkt auf Kartendateien: {0}, davon Modelle — {1}; Blätter in der Nähe — {2}, in der Ferne — {3}.",
    "Dotyczy plików mapy: {0}, w tym modeli — {1}; arkuszy z bliska — {2}, z daleka — {3}.",
  ],
};
