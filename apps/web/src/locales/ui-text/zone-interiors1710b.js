/*
 * Зона: «Интерьеры» — зал и вещи, снова снаружи (фасады, вывески, колонки),
 * название заправки, свет внутри (задача 5 ТЗ 17.10.2026, вечер). Словарь:
 * русская строка → [uk, en, de, pl]. Своя зона файла — чтобы не было
 * конфликтов между сессиями.
 */

/* Места снаружи с номером: район переведён в словаре, номер остаётся. */
const numbered = (ru, uk, en, de, pl, count) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`${ru}, ${index + 1}`, [`${uk}, ${index + 1}`, `${en}, ${index + 1}`, `${de}, ${index + 1}`, `${pl}, ${index + 1}`]]));

export const zoneInteriors1710b = {
  /* Панель «Цвет и блеск»: зал и вещи. */
  "Зал: стены, пол, потолок": ["Зал: стіни, підлога, стеля", "Hall: walls, floor, ceiling", "Raum: Wände, Boden, Decke", "Sala: ściany, podłoga, sufit"],
  "Вещи в зале": ["Речі в залі", "Things in the hall", "Dinge im Raum", "Rzeczy w sali"],

  /* Снаружи: колонки. */
  "Колонки АЗС": ["Колонки АЗС", "Petrol pumps", "Zapfsäulen", "Dystrybutory"],
  "Колонки — один облик на все станции. Щелчок по колонке в кадре — сюда": [
    "Колонки — один вигляд на всі станції. Клік по колонці в кадрі — сюди",
    "Pumps — one look for all stations. Click a pump in the frame to jump here",
    "Zapfsäulen — ein Aussehen für alle Stationen. Ein Klick auf eine Zapfsäule im Bild führt hierher",
    "Dystrybutory — jeden wygląd dla wszystkich stacji. Kliknięcie dystrybutora w kadrze prowadzi tutaj",
  ],
  "Колонки — штатные модели игры: общий облик ложится на колонки всех {0} станций сразу, вместе с урнами, воздухом и стойкой. У этой станции колонок — {1}.": [
    "Колонки — штатні моделі гри: загальний вигляд лягає на колонки всіх {0} станцій одразу, разом із урнами, повітрям і стійкою. У цієї станції колонок — {1}.",
    "The pumps are the game's stock models: the shared look goes on the pumps of all {0} stations at once, together with the bins, air and stand. This station has {1} pumps.",
    "Die Zapfsäulen sind Standardmodelle des Spiels: Das gemeinsame Aussehen gilt für die Zapfsäulen aller {0} Stationen zugleich, samt Mülleimern, Luft und Ständer. Diese Station hat {1} Zapfsäulen.",
    "Dystrybutory to standardowe modele gry: wspólny wygląd trafia na dystrybutory wszystkich {0} stacji naraz, razem z koszami, powietrzem i stojakiem. Ta stacja ma dystrybutorów: {1}.",
  ],
  "Те же модели стоят и не у станций — ещё {0} {1} на карте: общий облик ляжет и там.": [
    "Ті самі моделі стоять і не біля станцій — ще {0} {1} на мапі: загальний вигляд ляже й там.",
    "The same models also stand away from stations — {0} more {1} on the map: the shared look will apply there too.",
    "Dieselben Modelle stehen auch abseits von Stationen — noch {0} {1} auf der Karte: Das gemeinsame Aussehen gilt auch dort.",
    "Te same modele stoją też poza stacjami — jeszcze {0} {1} na mapie: wspólny wygląd obejmie i je.",
  ],
  "Колонки одни на все станции: своих колонок у станции нет, потому что сервер заправки может узнавать колонку по модели.": [
    "Колонки одні на всі станції: власних колонок у станції немає, бо сервер заправки може впізнавати колонку за моделлю.",
    "The pumps are the same for all stations: a station can't have its own, because the fuel server may recognise a pump by its model.",
    "Die Zapfsäulen sind für alle Stationen gleich: Eine Station hat keine eigenen, weil der Tankserver eine Zapfsäule am Modell erkennen kann.",
    "Dystrybutory są wspólne dla wszystkich stacji: stacja nie ma własnych, bo serwer tankowania może rozpoznawać dystrybutor po modelu.",
  ],
  "Как в игре: колонки": ["Як у грі: колонки", "As in the game: pumps", "Wie im Spiel: Zapfsäulen", "Jak w grze: dystrybutory"],
  "Колонки — в обликах шаблона тоже: общие для всех станций.": [
    "Колонки — у виглядах шаблону теж: спільні для всіх станцій.",
    "Pumps are part of the template looks too: shared by all stations.",
    "Zapfsäulen gehören auch zu den Aussehen der Vorlage: gemeinsam für alle Stationen.",
    "Dystrybutory są też w wyglądach szablonu: wspólne dla wszystkich stacji.",
  ],

  /* Снаружи: части, шаблоны, кнопки. */
  "{0}. {1} игры у этого места.": ["{0}. {1} гри в цього місця.", "{0}. {1} of the game at this place.", "{0}. {1} des Spiels an diesem Ort.", "{0}. {1} gry w tym miejscu."],
  "{0}. Листов этой части у места нет — правка его не коснётся.": [
    "{0}. Аркушів цієї частини в місця немає — правка його не зачепить.",
    "{0}. This place has no sheets of this part — the edit will not touch it.",
    "{0}. Dieser Ort hat keine Blätter dieses Teils — die Änderung betrifft ihn nicht.",
    "{0}. Ten punkt nie ma arkuszy tej części — zmiana go nie obejmie.",
  ],
  "Как в игре: все части": ["Як у грі: усі частини", "As in the game: all parts", "Wie im Spiel: alle Teile", "Jak w grze: wszystkie części"],
  "Части мест и колонки — штатные. Цвета, узоры и картинки панель помнит.": [
    "Частини місць і колонки — штатні. Кольори, візерунки й картинки панель пам'ятає.",
    "Parts of places and pumps are stock. The panel remembers colours, patterns and pictures.",
    "Teile der Orte und Zapfsäulen sind serienmäßig. Farben, Muster und Bilder merkt sich das Panel.",
    "Części miejsc i dystrybutory są seryjne. Panel pamięta kolory, wzory i obrazy.",
  ],
  "Это место — как у всех": ["Це місце — як у всіх", "This place — like the others", "Dieser Ort — wie alle anderen", "To miejsce — jak wszystkie"],
  "Все места вида": ["Усі місця виду", "All places of the type", "Alle Orte der Art", "Wszystkie miejsca tego rodzaju"],
  "Всё снаружи": ["Усе ззовні", "Everything outside", "Alles von außen", "Wszystko z zewnątrz"],
  "Место: {0}": ["Місце: {0}", "Place: {0}", "Ort: {0}", "Miejsce: {0}"],
  "снаружи — {0}": ["ззовні — {0}", "outside — {0}", "draußen — {0}", "na zewnątrz — {0}"],
  "как у всех мест вида": ["як у всіх місць виду", "like all places of the type", "wie alle Orte der Art", "jak wszystkie miejsca tego rodzaju"],
  "Сцены этого места нет в этой версии Astral — свои модели сюда не поставить.": [
    "Сцени цього місця немає в цій версії Astral — власні моделі сюди не поставити.",
    "This place has no scene in this version of Astral — your own models can't be placed here.",
    "Für diesen Ort gibt es in dieser Astral-Version keine Szene — eigene Modelle lassen sich hier nicht platzieren.",
    "Tego miejsca nie ma w tej wersji Astral jako sceny — własnych modeli tu nie postawisz.",
  ],

  /* Данные договора «снаружи»: части, колонки, шаблоны. */
  "Стены, колонны и фасад": ["Стіни, колони та фасад", "Walls, columns and facade", "Wände, Säulen und Fassade", "Ściany, kolumny i fasada"],
  "Навес и крыша": ["Навіс і дах", "Canopy and roof", "Vordach und Dach", "Zadaszenie i dach"],
  "Навес над колонками, козырёк и крыша": [
    "Навіс над колонками, козирок і дах",
    "Canopy over the pumps, visor and roof",
    "Vordach über den Zapfsäulen, Schirm und Dach",
    "Zadaszenie nad dystrybutorami, daszek i dach",
  ],
  "Площадка": ["Майданчик", "Forecourt", "Vorplatz", "Plac"],
  "Площадка, бордюры и ступени у входа": [
    "Майданчик, бордюри та сходинки біля входу",
    "Forecourt, kerbs and steps by the entrance",
    "Vorplatz, Bordsteine und Stufen am Eingang",
    "Plac, krawężniki i schodki przy wejściu",
  ],
  "Вывески и подсветка": ["Вивіски та підсвітка", "Signs and lighting", "Schilder und Beleuchtung", "Szyldy i podświetlenie"],
  "Вывески, логотипы и световые полосы": ["Вивіски, логотипи та світлові смуги", "Signs, logos and light strips", "Schilder, Logos und Lichtstreifen", "Szyldy, loga i pasy świetlne"],
  "Корпус колонки; урны, воздух и стойка станции — этим же обликом": [
    "Корпус колонки; урни, повітря й стійка станції — цим самим виглядом",
    "Pump body; the station's bins, air and stand — with the same look",
    "Gehäuse der Zapfsäule; Mülleimer, Luft und Ständer der Station — mit demselben Aussehen",
    "Obudowa dystrybutora; kosze, powietrze i stojak stacji — tym samym wyglądem",
  ],
  "Табло": ["Табло", "Display", "Anzeige", "Wyświetlacz"],
  "Табло с ценой и брендом сверху, светится ночью": [
    "Табло з ціною й брендом угорі, світиться вночі",
    "Display with the price and brand on top, glows at night",
    "Anzeige mit Preis und Marke oben, leuchtet nachts",
    "Wyświetlacz z ceną i marką na górze, świeci w nocy",
  ],
  "Модели и листы Rockstar без правок": [
    "Моделі та аркуші Rockstar без правок",
    "Rockstar's models and sheets without edits",
    "Modelle und Blätter von Rockstar ohne Änderungen",
    "Modele i arkusze Rockstar bez zmian",
  ],
  "Белый и красный": ["Білий і червоний", "White and red", "Weiß und Rot", "Biały i czerwony"],
  "Белые стены и навес, красные вывески и колонки": [
    "Білі стіни й навіс, червоні вивіски та колонки",
    "White walls and canopy, red signs and pumps",
    "Weiße Wände und Vordach, rote Schilder und Zapfsäulen",
    "Białe ściany i zadaszenie, czerwone szyldy i dystrybutory",
  ],
  "Тёмные стены и навес, жёлтые вывески": [
    "Темні стіни й навіс, жовті вивіски",
    "Dark walls and canopy, yellow signs",
    "Dunkle Wände und Vordach, gelbe Schilder",
    "Ciemne ściany i zadaszenie, żółte szyldy",
  ],
  "Зелёная станция": ["Зелена станція", "Green station", "Grüne Station", "Zielona stacja"],
  "Зелёный навес и вывески, светлые стены": [
    "Зелений навіс і вивіски, світлі стіни",
    "Green canopy and signs, light walls",
    "Grünes Vordach und Schilder, helle Wände",
    "Zielone zadaszenie i szyldy, jasne ściany",
  ],
  "Тёмные стены, вывески градиентом бирюзы и розового": [
    "Темні стіни, вивіски градієнтом бірюзового та рожевого",
    "Dark walls, signs in a turquoise-to-pink gradient",
    "Dunkle Wände, Schilder im Verlauf von Türkis zu Rosa",
    "Ciemne ściany, szyldy w gradiencie turkusu i różu",
  ],
  "Кирпич и дерево": ["Цегла й дерево", "Brick and wood", "Backstein und Holz", "Cegła i drewno"],
  "Кирпичные стены, деревянный навес": ["Цегляні стіни, дерев'яний навіс", "Brick walls, wooden canopy", "Backsteinwände, Vordach aus Holz", "Ceglane ściany, drewniane zadaszenie"],
  "Синяя классика": ["Синя класика", "Blue classic", "Blaue Klassik", "Niebieska klasyka"],
  "Синий навес и колонки, белые стены": [
    "Синій навіс і колонки, білі стіни",
    "Blue canopy and pumps, white walls",
    "Blaues Vordach und Zapfsäulen, weiße Wände",
    "Niebieskie zadaszenie i dystrybutory, białe ściany",
  ],

  "у этого места": ["у цьому місці", "at this place", "an diesem Ort", "w tym miejscu"],

  /* Название заправки: плашка на вывеске. */
  "Свои слова на вывесках станции": ["Власні слова на вивісках станції", "Your own words on the station's signs", "Eigene Worte auf den Schildern der Station", "Własne słowa na szyldach stacji"],
  "Впишите название — оно встанет плашкой перед вывесками станции и закроет старую надпись целиком: фон в цвет вывески, размер с грань": [
    "Впишіть назву — вона стане плашкою перед вивісками станції й закриє старий напис повністю: тло в колір вивіски, розмір із грань",
    "Type a name — it will stand as a plate in front of the station's signs and cover the old inscription completely: the background matches the sign, the size matches the face",
    "Geben Sie einen Namen ein — er steht als Platte vor den Schildern der Station und deckt die alte Aufschrift vollständig ab: Hintergrund in der Farbe des Schildes, Größe wie die Fläche",
    "Wpisz nazwę — stanie jako tabliczka przed szyldami stacji i całkowicie zakryje stary napis: tło w kolorze szyldu, rozmiar jak płaszczyzna",
  ],
  "Название: вид": ["Назва: вигляд", "Name: look", "Name: Aussehen", "Nazwa: wygląd"],
  "Название: вывеска": ["Назва: вивіска", "Name: sign", "Name: Schild", "Nazwa: szyld"],
  "Название: все вывески станции": ["Назва: усі вивіски станції", "Name: all signs of the station", "Name: alle Schilder der Station", "Nazwa: wszystkie szyldy stacji"],
  "Название: убрано": ["Назву прибрано", "Name: removed", "Name: entfernt", "Nazwa: usunięta"],
  "Название: всем станциям бренда": ["Назва: усім станціям бренду", "Name: all stations of the brand", "Name: alle Stationen der Marke", "Nazwa: wszystkie stacje marki"],
  "Название стоит на вывесках других станций бренда: плашек — {0}.": [
    "Назва стоїть на вивісках інших станцій бренду: плашок — {0}.",
    "The name now stands on the signs of the brand's other stations: plates — {0}.",
    "Der Name steht jetzt auf den Schildern der anderen Stationen der Marke: Platten — {0}.",
    "Nazwa stoi na szyldach innych stacji marki: tabliczek — {0}.",
  ],
  "Название — {0}": ["Назва — {0}", "Name — {0}", "Name — {0}", "Nazwa — {0}"],
  "Слова встанут плашкой перед вывеской станции и закроют старую надпись целиком: фон — цвет вывески, размер — с её грань. Плашка видна с 200 м, в игру едет вместе с названием.": [
    "Слова стануть плашкою перед вивіскою станції й повністю закриють старий напис: тло — колір вивіски, розмір — з її грань. Плашку видно з 200 м, у гру їде разом із назвою.",
    "The words stand as a plate in front of the station's sign and cover the old inscription completely: the background is the sign's colour, the size is the size of its face. The plate is visible from 200 m and goes into the game with the name.",
    "Die Worte stehen als Platte vor dem Schild der Station und decken die alte Aufschrift vollständig ab: Hintergrund in der Farbe des Schildes, Größe wie seine Fläche. Die Platte ist ab 200 m sichtbar und kommt mit dem Namen ins Spiel.",
    "Słowa staną jako tabliczka przed szyldem stacji i całkowicie zakryją stary napis: tło w kolorze szyldu, rozmiar jak jego płaszczyzna. Tabliczka jest widoczna z 200 m i trafia do gry razem z nazwą.",
  ],
  "Например, название заправки": ["Наприклад, назва заправки", "For example, the name of the station", "Zum Beispiel der Name der Tankstelle", "Na przykład nazwa stacji paliw"],
  "Фон плашки — цвет вывески": ["Тло плашки — колір вивіски", "Plate background — the sign's colour", "Hintergrund der Platte — Farbe des Schildes", "Tło tabliczki — kolor szyldu"],
  "Вывески станции · {0}": ["Вивіски станції · {0}", "Station signs · {0}", "Schilder der Station · {0}", "Szyldy stacji · {0}"],
  "Ищем вывески станции в сцене…": ["Шукаємо вивіски станції в сцені…", "Looking for the station's signs in the scene…", "Suche die Schilder der Station in der Szene…", "Szukamy szyldów stacji w scenie…"],
  "Вывески станции": ["Вивіски станції", "Station signs", "Schilder der Station", "Szyldy stacji"],
  "Вывеска {0}": ["Вивіска {0}", "Sign {0}", "Schild {0}", "Szyld {0}"],
  "название стоит": ["назва стоїть", "name in place", "Name steht", "nazwa stoi"],
  "Впишите название — тогда его можно поставить на вывеску.": [
    "Впишіть назву — тоді її можна поставити на вивіску.",
    "Type a name — then it can be put on a sign.",
    "Geben Sie einen Namen ein — dann lässt er sich auf ein Schild setzen.",
    "Wpisz nazwę — wtedy można ją umieścić na szyldzie.",
  ],
  "На все вывески станции": ["На всі вивіски станції", "On all the station's signs", "Auf alle Schilder der Station", "Na wszystkie szyldy stacji"],
  "Убрать название": ["Прибрати назву", "Remove the name", "Namen entfernen", "Usuń nazwę"],
  "Больше {0} плашек с названиями в работе не поставить — уберите лишние.": [
    "Більше {0} плашок із назвами в роботі не поставити — приберіть зайві.",
    "More than {0} name plates cannot be put into a work — remove the extra ones.",
    "Mehr als {0} Namensplatten lassen sich in einer Arbeit nicht setzen — entfernen Sie überzählige.",
    "Więcej niż {0} tabliczek z nazwami w pracy nie postawisz — usuń zbędne.",
  ],
  "Вывески найдены по модели станции в кадре: если плашка встала не туда — снимите её с вывески. Как она выглядит в самой игре, в Astral проверить нельзя.": [
    "Вивіски знайдено за моделлю станції в кадрі: якщо плашка стала не туди — зніміть її з вивіски. Як вона виглядає в самій грі, в Astral перевірити не можна.",
    "The signs are found from the station's model in the frame: if a plate landed in the wrong place, take it off that sign. How it looks in the game itself cannot be checked in Astral.",
    "Die Schilder werden am Modell der Station im Bild gefunden: Sitzt eine Platte falsch, nehmen Sie sie vom Schild. Wie sie im Spiel selbst aussieht, lässt sich in Astral nicht prüfen.",
    "Szyldy są znajdowane po modelu stacji w kadrze: jeśli tabliczka stanęła nie tam, zdejmij ją z szyldu. Jak wygląda w samej grze, w Astral sprawdzić nie można.",
  ],
  "На этой станции вывесок не нашлось — название тут не поставить. Свою надпись можно поставить на стену инструментом «Текст».": [
    "На цій станції вивісок не знайшлося — назву тут не поставити. Свій напис можна поставити на стіну інструментом «Текст».",
    "No signs were found at this station — a name can't be put here. Your own inscription can be put on a wall with the “Text” tool.",
    "An dieser Station wurden keine Schilder gefunden — hier lässt sich kein Name setzen. Eine eigene Aufschrift lässt sich mit dem Werkzeug „Text“ an eine Wand setzen.",
    "Na tej stacji nie znaleziono szyldów — nazwy tu nie postawisz. Własny napis można postawić na ścianie narzędziem „Tekst”.",
  ],
  "Станции бренда {0}": ["Станції бренду {0}", "Stations of the {0} brand", "Stationen der Marke {0}", "Stacje marki {0}"],
  "Такое же название, шрифт и цвета — на две самые большие вывески каждой из остальных станций {0}: {1} {2}.": [
    "Така сама назва, шрифт і кольори — на дві найбільші вивіски кожної з решти станцій {0}: {1} {2}.",
    "The same name, font and colours — on the two largest signs of each of the other {0} stations: {1} {2}.",
    "Derselbe Name, dieselbe Schrift und Farben — auf den zwei größten Schildern jeder der übrigen {0}-Stationen: {1} {2}.",
    "Ta sama nazwa, czcionka i kolory — na dwóch największych szyldach każdej z pozostałych stacji {0}: {1} {2}.",
  ],
  "станция": ["станція", "station", "Station", "stacja"],
  "Всем станциям бренда": ["Усім станціям бренду", "All stations of the brand", "Allen Stationen der Marke", "Wszystkim stacjom marki"],
  "названий заправок — {0}": ["назв заправок — {0}", "names of petrol stations — {0}", "Namen von Tankstellen — {0}", "nazw stacji paliw — {0}"],

  /* Штатные интерьеры сверх магазинов: разделы и помещения. */
  "Госслужбы": ["Держслужби", "Public services", "Behörden", "Służby publiczne"],
  "Бары и кино": ["Бари й кіно", "Bars and cinema", "Bars und Kino", "Bary i kino"],
  "Салоны и ювелирка": ["Салони та ювелірні", "Showrooms and jewellers", "Autohäuser und Juweliere", "Salony i jubilerzy"],
  "Офисы": ["Офіси", "Offices", "Büros", "Biura"],
  "Жильё": ["Житло", "Homes", "Wohnungen und Häuser", "Mieszkania i domy"],
  "Производство": ["Виробництво", "Industry", "Produktion", "Produkcja"],
  "Полицейский участок": ["Поліцейська дільниця", "Police station", "Polizeiwache", "Komisariat policji"],
  "Офис шерифа": ["Офіс шерифа", "Sheriff's office", "Sheriff-Büro", "Biuro szeryfa"],
  "Морг": ["Морг", "Morgue", "Leichenhalle", "Kostnica"],
  "Пожарная часть": ["Пожежна частина", "Fire station", "Feuerwache", "Remiza strażacka"],
  "Бар Hick's": ["Бар Hick's", "Hick's bar", "Hick's Bar", "Bar Hick's"],
  "Рок-клуб Tequi-la-la": ["Рок-клуб Tequi-la-la", "Tequi-la-la rock club", "Rockclub Tequi-la-la", "Klub rockowy Tequi-la-la"],
  "Кинотеатр": ["Кінотеатр", "Cinema", "Kino", "Kino"],
  "Ювелирный Vangelico": ["Ювелірний Vangelico", "Vangelico jeweller's", "Juwelier Vangelico", "Jubiler Vangelico"],
  "Автосалон Premium Deluxe Motorsport": ["Автосалон Premium Deluxe Motorsport", "Premium Deluxe Motorsport showroom", "Autohaus Premium Deluxe Motorsport", "Salon samochodowy Premium Deluxe Motorsport"],
  "Офис Life Invader": ["Офіс Life Invader", "Life Invader office", "Life-Invader-Büro", "Biuro Life Invader"],
  "Квартира: высокий класс": ["Квартира: високий клас", "Apartment: high-end", "Wohnung: gehobene Klasse", "Mieszkanie: wysoki standard"],
  "Квартира уборщика": ["Квартира двірника", "Janitor's apartment", "Hausmeisterwohnung", "Mieszkanie dozorcy"],
  "Дом на Форум-драйв": ["Будинок на Форум-драйв", "House on Forum Drive", "Haus an der Forum Drive", "Dom przy Forum Drive"],
  "Скотобойня": ["Скотобійня", "Slaughterhouse", "Schlachthof", "Rzeźnia"],
  "Разборка автомобилей": ["Розбирання автомобілів", "Chop shop", "Autoverwertung", "Dziupla samochodowa"],
  "Литейный цех": ["Ливарний цех", "Foundry", "Gießerei", "Odlewnia"],
  "Швейный цех": ["Швейний цех", "Sewing workshop", "Näherei", "Szwalnia"],

  "Листов этой поверхности не нашлось: её лист общий с другими местами игры — правка разошлась бы и по ним, поэтому эта поверхность не красится.": [
    "Аркушів цієї поверхні не знайшлося: її аркуш спільний з іншими місцями гри — правка розійшлася б і по них, тому ця поверхня не фарбується.",
    "No sheets of this surface were found: its sheet is shared with other places in the game — an edit would spread to them too, so this surface is not painted.",
    "Für diese Fläche wurden keine Blätter gefunden: Ihr Blatt teilt sich das Spiel mit anderen Orten — eine Änderung würde auch dort wirken, deshalb wird diese Fläche nicht gefärbt.",
    "Nie znaleziono arkuszy tej powierzchni: jej arkusz jest wspólny z innymi miejscami w grze — zmiana rozeszłaby się i po nich, dlatego ta powierzchnia nie jest malowana.",
  ],

  /* Свет ламп помещения. */
  "Свет": ["Світло", "Light", "Licht", "Światło"],
  "Цвет и сила ламп помещения": ["Колір і сила ламп приміщення", "Colour and strength of the room's lamps", "Farbe und Stärke der Lampen des Raums", "Kolor i siła lamp pomieszczenia"],
  "Лампы, что стоят в одном этом помещении, — свой цвет и сила. Общие модели игры остаются штатными": [
    "Лампи, що стоять лише в цьому приміщенні, — свій колір і сила. Спільні моделі гри лишаються штатними",
    "Lamps that stand only in this room — your own colour and strength. The game's shared models stay stock",
    "Lampen, die nur in diesem Raum stehen — eigene Farbe und Stärke. Gemeinsame Modelle des Spiels bleiben serienmäßig",
    "Lampy stojące tylko w tym pomieszczeniu — własny kolor i siła. Wspólne modele gry zostają seryjne",
  ],
  "Свет ламп": ["Світло ламп", "Lamp light", "Lampenlicht", "Światło lamp"],
  "свет": ["світло", "light", "Licht", "światło"],
  "Ламп в моделях помещения: {0}, моделей: {1}. Правятся только модели, что игра ставит в одно это помещение; банкоматы, автоматы, неон брендов и всё, что стоит ещё где-то, остаётся штатным.": [
    "Ламп у моделях приміщення: {0}, моделей: {1}. Змінюються лише моделі, що гра ставить в одне це приміщення; банкомати, автомати, неон брендів і все, що стоїть ще десь, лишається штатним.",
    "Lamps in the room's models: {0}, models: {1}. Only models the game puts into this one room are changed; ATMs, vending machines, brand neon and anything that also stands elsewhere stay stock.",
    "Lampen in den Modellen des Raums: {0}, Modelle: {1}. Geändert werden nur Modelle, die das Spiel in genau diesen Raum stellt; Geldautomaten, Automaten, Marken-Neon und alles, was auch anderswo steht, bleiben serienmäßig.",
    "Lamp w modelach pomieszczenia: {0}, modeli: {1}. Zmieniane są tylko modele, które gra stawia w tym jednym pomieszczeniu; bankomaty, automaty, neony marek i wszystko, co stoi też gdzie indziej, zostają seryjne.",
  ],
  "У этого помещения нет своих ламп в отдельных моделях: его свет несут общие модели игры, они остаются штатными.": [
    "У цього приміщення немає власних ламп в окремих моделях: його світло несуть спільні моделі гри, вони лишаються штатними.",
    "This room has no lamps of its own in separate models: its light comes from the game's shared models, which stay stock.",
    "Dieser Raum hat keine eigenen Lampen in separaten Modellen: Sein Licht stammt von gemeinsamen Modellen des Spiels, sie bleiben serienmäßig.",
    "To pomieszczenie nie ma własnych lamp w osobnych modelach: jego światło dają wspólne modele gry, które zostają seryjne.",
  ],
  "Цвет света": ["Колір світла", "Light colour", "Lichtfarbe", "Kolor światła"],
  "цвет света": ["колір світла", "light colour", "Lichtfarbe", "kolor światła"],
  "Сила света": ["Сила світла", "Light strength", "Lichtstärke", "Siła światła"],
  "сила света": ["сила світла", "light strength", "Lichtstärke", "siła światła"],
  "Свет в кадре студийный: цвет ламп помещения здесь не виден, он появится в игре. Как свет выглядит в игре, в Astral проверить нельзя.": [
    "Світло в кадрі студійне: колір ламп приміщення тут не видно, він з'явиться в грі. Як світло виглядає в грі, в Astral перевірити не можна.",
    "The light in the frame is studio light: the colour of the room's lamps is not visible here, it will appear in the game. How the light looks in the game cannot be checked in Astral.",
    "Das Licht im Bild ist Studiolicht: Die Farbe der Lampen des Raums ist hier nicht zu sehen, sie erscheint im Spiel. Wie das Licht im Spiel aussieht, lässt sich in Astral nicht prüfen.",
    "Światło w kadrze jest studyjne: koloru lamp pomieszczenia tu nie widać, pojawi się w grze. Jak światło wygląda w grze, w Astral sprawdzić nie można.",
  ],

  /* Места снаружи: районы с номером. */
  ...numbered("Палето-Бэй", "Палето-Бей", "Paleto Bay", "Paleto Bay", "Paleto Bay", 2),
  ...numbered("Пустыня Гранд-Сенора", "Пустеля Гранд-Сенора", "Grand Senora Desert", "Grand Senora Desert", "Pustynia Grand Senora", 5),
  ...numbered("Маленький Сеул", "Маленький Сеул", "Little Seoul", "Little Seoul", "Little Seoul", 2),
  ...numbered("Эль-Бурро-Хайтс", "Ель-Бурро-Гайтс", "El Burro Heights", "El Burro Heights", "El Burro Heights", 2),
  /* Квартиры высокого класса: районы с номером (до девяти в районе). */
  ...numbered("Рокфорд-Хиллз", "Рокфорд-Гіллз", "Rockford Hills", "Rockford Hills", "Rockford Hills", 9),
  ...numbered("Западный Вайнвуд", "Західний Вайнвуд", "West Vinewood", "West Vinewood", "West Vinewood", 2),
  ...numbered("Дель-Перро", "Дель-Перро", "Del Perro", "Del Perro", "Del Perro", 2),
  ...numbered("Пиллбокс-Хилл", "Пілбокс-Гілл", "Pillbox Hill", "Pillbox Hill", "Pillbox Hill", 4),
};
