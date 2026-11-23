/*
 * Зона «Банкоматы» (задача 4 ТЗ 17.10.2026): редактор банкоматов всей
 * карты — модели, части, шаблоны, свечение, места на карте.
 * Русская строка → [uk, en, de, pl].
 */
export const zoneAtm1710 = {
  /* Модели */
  "Банкомат-тумба": ["Банкомат-тумба", "Kiosk ATM", "Standautomat", "Bankomat wolnostojący"],
  "Тумба": ["Тумба", "Kiosk", "Standgerät", "Wolnostojący"],
  "Стоит отдельно: магазины 24/7, заправки, улицы": [
    "Стоїть окремо: магазини 24/7, заправки, вулиці",
    "Free-standing: 24/7 stores, gas stations, streets",
    "Freistehend: 24/7-Läden, Tankstellen, Straßen",
    "Wolnostojący: sklepy 24/7, stacje paliw, ulice",
  ],
  "Настенный синий": ["Настінний синій", "Blue wall ATM", "Blauer Wandautomat", "Niebieski ścienny"],
  "Синий": ["Синій", "Blue", "Blau", "Niebieski"],
  "В стене: улицы, банк Pacific Standard": [
    "У стіні: вулиці, банк Pacific Standard",
    "In the wall: streets, Pacific Standard bank",
    "In der Wand: Straßen, Pacific-Standard-Bank",
    "W ścianie: ulice, bank Pacific Standard",
  ],
  "Настенный красный": ["Настінний червоний", "Red wall ATM", "Roter Wandautomat", "Czerwony ścienny"],
  "Красный": ["Червоний", "Red", "Rot", "Czerwony"],
  "В стене: деловой центр и Маленький Сеул": [
    "У стіні: діловий центр і Маленький Сеул",
    "In the wall: downtown and Little Seoul",
    "In der Wand: Geschäftsviertel und Little Seoul",
    "W ścianie: centrum biznesowe i Little Seoul",
  ],
  "Банкомат Fleeca": ["Банкомат Fleeca", "Fleeca ATM", "Fleeca-Geldautomat", "Bankomat Fleeca"],
  "Зелёный, у отделений банка Fleeca": [
    "Зелений, біля відділень банку Fleeca",
    "Green, at Fleeca bank branches",
    "Grün, an den Filialen der Fleeca-Bank",
    "Zielony, przy oddziałach banku Fleeca",
  ],

  /* Части */
  "Панель": ["Панель", "Panel", "Bedienfeld", "Panel"],
  "Полоса логотипов": ["Смуга логотипів", "Logo strip", "Logoleiste", "Pasek logotypów"],

  /* Шаблоны */
  "Банкоматы Rockstar": ["Банкомати Rockstar", "Rockstar's ATMs", "Geldautomaten von Rockstar", "Bankomaty Rockstar"],
  "Тёмный корпус и рамка, экран и вывеска — как в игре": [
    "Темний корпус і рамка, екран і вивіска — як у грі",
    "Dark body and frame, screen and sign as in the game",
    "Dunkles Gehäuse und Rahmen, Bildschirm und Schild wie im Spiel",
    "Ciemna obudowa i ramka, ekran i szyld jak w grze",
  ],
  "Золотой корпус в чёрной рамке": ["Золотий корпус у чорній рамці", "Gold body in a black frame", "Goldenes Gehäuse im schwarzen Rahmen", "Złota obudowa w czarnej ramce"],
  "Белый корпус и рамка, панель ровным светлым": [
    "Білий корпус і рамка, панель рівним світлим",
    "White body and frame, panel in plain light colour",
    "Weißes Gehäuse und Rahmen, Bedienfeld einfarbig hell",
    "Biała obudowa i ramka, panel jednolicie jasny",
  ],
  "Фиолетовый корпус, синяя рамка, экран и вывеска светятся ярче": [
    "Фіолетовий корпус, синя рамка, екран і вивіска світяться яскравіше",
    "Purple body, blue frame, screen and sign glow brighter",
    "Violettes Gehäuse, blauer Rahmen, Bildschirm und Schild leuchten heller",
    "Fioletowa obudowa, niebieska ramka, ekran i szyld świecą jaśniej",
  ],
  "Выключенные": ["Вимкнені", "Switched off", "Ausgeschaltet", "Wyłączone"],
  "Экраны чёрные, экран и вывеска не светятся": [
    "Екрани чорні, екран і вивіска не світяться",
    "Black screens, screen and sign don't glow",
    "Schwarze Bildschirme, Bildschirm und Schild leuchten nicht",
    "Czarne ekrany, ekran i szyld nie świecą",
  ],
  "Готовые виды банкоматов": ["Готові вигляди банкоматів", "Ready-made ATM looks", "Fertige Geldautomaten-Looks", "Gotowe wyglądy bankomatów"],
  "свои картинки (остаются на этом компьютере)": [
    "власні картинки (залишаються на цьому комп’ютері)",
    "your own pictures (they stay on this computer)",
    "eigene Bilder (bleiben auf diesem Computer)",
    "własne obrazy (zostają na tym komputerze)",
  ],

  /* Кадр */
  "Все банкоматы": ["Усі банкомати", "All ATMs", "Alle Geldautomaten", "Wszystkie bankomaty"],
  "Все банкоматы карты": ["Усі банкомати карти", "All ATMs on the map", "Alle Geldautomaten der Karte", "Wszystkie bankomaty na mapie"],
  "Сейчас всё как в игре — ставить нечего.": [
    "Зараз усе як у грі — встановлювати нічого.",
    "Everything is as in the game — nothing to install.",
    "Alles ist wie im Spiel — nichts zu installieren.",
    "Wszystko jest jak w grze — nie ma czego instalować.",
  ],
  "Банкоматы — штатные модели и листы вашей GTA V; цвет, отделка, картинки и свечение — те же, что уедут в игру. Стена за настенными — постановка.": [
    "Банкомати — штатні моделі й текстури вашої GTA V; колір, оздоблення, картинки й світіння — ті самі, що поїдуть у гру. Стіна за настінними — постановка.",
    "ATMs are the stock models and textures of your GTA V; colour, finish, pictures and glow are the same as will go into the game. The wall behind the wall ATMs is staging.",
    "Geldautomaten sind die Originalmodelle und Texturen deines GTA V; Farbe, Oberfläche, Bilder und Leuchten sind genau die, die ins Spiel gehen. Die Wand hinter den Wandautomaten ist Kulisse.",
    "Bankomaty to oryginalne modele i tekstury twojej GTA V; kolor, wykończenie, obrazy i świecenie są takie, jakie trafią do gry. Ściana za bankomatami ściennymi to inscenizacja.",
  ],
  "облик работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.": [
    "вигляд роботи. Стрілки — повернути, плюс і мінус — наблизити, права кнопка — політ.",
    "the work's look. Arrows rotate, plus and minus zoom, right button flies.",
    "Aussehen der Arbeit. Pfeile drehen, Plus und Minus zoomen, rechte Taste fliegt.",
    "wygląd pracy. Strzałki obracają, plus i minus przybliżają, prawy przycisk — lot.",
  ],

  /* Панель правок */
  "У настенных и Fleeca цвет корпуса — палитра игры: металл умножается на цвет, поэтому в игре он темнее образца, как и штатный синий. У тумбы корпус красится тоном листа.": [
    "У настінних і Fleeca колір корпусу — палітра гри: метал множиться на колір, тому в грі він темніший за зразок, як і штатний синій. У тумби корпус фарбується тоном текстури.",
    "On wall and Fleeca ATMs the body colour is the game's palette: the metal is multiplied by the colour, so in the game it is darker than the swatch, like the stock blue. The kiosk body is tinted by its texture.",
    "Bei Wand- und Fleeca-Automaten ist die Gehäusefarbe die Palette des Spiels: Das Metall wird mit der Farbe multipliziert, im Spiel ist sie daher dunkler als das Muster, wie das originale Blau. Der Standautomat wird über den Ton seiner Textur gefärbt.",
    "W bankomatach ściennych i Fleeca kolor obudowy to paleta gry: metal jest mnożony przez kolor, więc w grze jest ciemniejszy niż próbka, jak oryginalny niebieski. Obudowa wolnostojącego jest barwiona tonem tekstury.",
  ],
  "Рамка вокруг настенного банкомата — серые и белые полосы палитры.": [
    "Рамка навколо настінного банкомата — сірі й білі смуги палітри.",
    "The frame around a wall ATM — the grey and white palette stripes.",
    "Der Rahmen um den Wandautomaten — die grauen und weißen Palettenstreifen.",
    "Ramka wokół bankomatu ściennego — szare i białe pasy palety.",
  ],
  "Панель с клавиатурой, щелью для карты и выдачей денег.": [
    "Панель із клавіатурою, щілиною для картки й видачею грошей.",
    "The panel with the keypad, card slot and cash dispenser.",
    "Das Bedienfeld mit Tastatur, Kartenschlitz und Geldausgabe.",
    "Panel z klawiaturą, szczeliną na kartę i wypłatą gotówki.",
  ],
  "Экран светится сам — днём и ночью. Меню банкомата, которое открывается в игре, рисует интерфейс игры: файлом модели его не поменять.": [
    "Екран світиться сам — удень і вночі. Меню банкомата, що відкривається в грі, малює інтерфейс гри: файлом моделі його не змінити.",
    "The screen glows by itself, day and night. The ATM menu that opens in the game is drawn by the game's interface: a model file can't change it.",
    "Der Bildschirm leuchtet von selbst, Tag und Nacht. Das Automatenmenü im Spiel zeichnet die Spieloberfläche: Eine Modelldatei kann es nicht ändern.",
    "Ekran świeci sam — w dzień i w nocy. Menu bankomatu otwierane w grze rysuje interfejs gry: plikiem modelu go nie zmienisz.",
  ],
  "Вывеска над банкоматом; у тумбы — наклейка банков наверху. У настенных и Fleeca светится сама.": [
    "Вивіска над банкоматом; у тумби — наліпка банків угорі. У настінних і Fleeca світиться сама.",
    "The sign above the ATM; on the kiosk it's the bank sticker on top. On wall and Fleeca ATMs it glows by itself.",
    "Das Schild über dem Automaten; beim Standautomaten der Bankaufkleber oben. Bei Wand- und Fleeca-Automaten leuchtet es von selbst.",
    "Szyld nad bankomatem; w wolnostojącym — naklejka banków na górze. W ściennych i Fleeca świeci sam.",
  ],
  "Полоса логотипов банков под козырьком; у Fleeca — полоса ATM.": [
    "Смуга логотипів банків під козирком; у Fleeca — смуга ATM.",
    "The strip of bank logos under the hood; on Fleeca it's the ATM strip.",
    "Die Leiste mit Banklogos unter der Blende; bei Fleeca die ATM-Leiste.",
    "Pasek logotypów banków pod daszkiem; w Fleeca — pasek ATM.",
  ],
  "Нет у": ["Немає в", "Missing on", "Fehlt bei", "Brak w"],
  "Сейчас эта модель как «Все банкоматы». Любая правка здесь заведёт ей свой облик — копией общего.": [
    "Зараз ця модель як «Усі банкомати». Будь-яка правка тут заведе їй власний вигляд — копією загального.",
    "Right now this model follows “All ATMs”. Any edit here gives it its own look — a copy of the shared one.",
    "Dieses Modell folgt gerade „Alle Geldautomaten“. Jede Änderung hier gibt ihm ein eigenes Aussehen — als Kopie des gemeinsamen.",
    "Teraz ten model jest jak „Wszystkie bankomaty”. Każda zmiana tutaj nada mu własny wygląd — kopię wspólnego.",
  ],
  "Правки на этой вкладке — только у этой модели. Выключите, чтобы она снова была как все.": [
    "Правки на цій вкладці — лише в цієї моделі. Вимкніть, щоб вона знову була як усі.",
    "Edits on this tab apply to this model only. Turn off to make it follow the rest again.",
    "Änderungen auf diesem Tab gelten nur für dieses Modell. Ausschalten, damit es wieder wie alle ist.",
    "Zmiany na tej karcie dotyczą tylko tego modelu. Wyłącz, aby znów był jak wszystkie.",
  ],
  "облик": ["вигляд", "look", "Aussehen", "wygląd"],
  "Рисунок листа убран: панель ровного цвета, без клавиатуры и надписей.": [
    "Малюнок текстури прибрано: панель рівного кольору, без клавіатури й написів.",
    "The texture's drawing is removed: a plain-coloured panel without keypad or labels.",
    "Die Texturzeichnung ist entfernt: einfarbiges Bedienfeld ohne Tastatur und Beschriftungen.",
    "Rysunek tekstury usunięty: panel w jednolitym kolorze, bez klawiatury i napisów.",
  ],
  "Любая картинка — логотип своего банка, заставка, фото. PNG, JPEG или WebP до 8 МБ. Картинка остаётся на этом компьютере: в код для друга она не едет.": [
    "Будь-яка картинка — логотип свого банку, заставка, фото. PNG, JPEG або WebP до 8 МБ. Картинка залишається на цьому комп’ютері: у код для друга вона не їде.",
    "Any picture — your bank's logo, a splash screen, a photo. PNG, JPEG or WebP up to 8 MB. The picture stays on this computer: it doesn't go into the code for a friend.",
    "Jedes Bild — Logo deiner Bank, Startbildschirm, Foto. PNG, JPEG oder WebP bis 8 MB. Das Bild bleibt auf diesem Computer: Es geht nicht in den Code für Freunde.",
    "Dowolny obraz — logo własnego banku, wygaszacz, zdjęcie. PNG, JPEG lub WebP do 8 MB. Obraz zostaje na tym komputerze: nie trafia do kodu dla znajomego.",
  ],
  "как вписать картинку": ["як вписати картинку", "how to fit the picture", "wie das Bild eingepasst wird", "jak dopasować obraz"],
  "размер картинки": ["розмір картинки", "picture size", "Bildgröße", "rozmiar obrazu"],
  "фон вокруг картинки": ["тло навколо картинки", "background around the picture", "Hintergrund um das Bild", "tło wokół obrazu"],
  "Тон листа: надписи и светотень остаются, цвет — ваш.": [
    "Тон текстури: написи й світлотінь лишаються, колір — ваш.",
    "Texture tone: labels and shading stay, the colour is yours.",
    "Texturton: Beschriftungen und Schattierung bleiben, die Farbe ist deine.",
    "Ton tekstury: napisy i cieniowanie zostają, kolor — twój.",
  ],
  "Ровный цвет вместо рисунка листа.": ["Рівний колір замість малюнка текстури.", "A plain colour instead of the texture's drawing.", "Eine einheitliche Farbe statt der Texturzeichnung.", "Jednolity kolor zamiast rysunku tekstury."],
  "Стандарт: все банкоматы": ["Стандарт: усі банкомати", "Standard: all ATMs", "Standard: alle Geldautomaten", "Standard: wszystkie bankomaty"],
  "Стандарт: эта модель": ["Стандарт: ця модель", "Standard: this model", "Standard: dieses Modell", "Standard: ten model"],
  "Банкоматы красятся в своих файлах моделей — других вещей у них нет, поэтому правка видна только на банкоматах: сразу на всех банкоматах модели по всему миру, вблизи и издалека. Один банкомат отдельно файлом не покрасить.": [
    "Банкомати фарбуються у своїх файлах моделей — інших речей у них немає, тому правку видно лише на банкоматах: одразу на всіх банкоматах моделі по всьому світу, зблизька й здалеку. Один банкомат окремо файлом не пофарбувати.",
    "ATMs are recoloured in their own model files — nothing else uses them, so the edit shows only on ATMs: on every ATM of the model across the world at once, near and far. A single ATM can't be recoloured separately by a file.",
    "Geldautomaten werden in ihren eigenen Modelldateien gefärbt — nichts anderes nutzt sie, die Änderung ist also nur an Geldautomaten zu sehen: an allen Automaten des Modells auf der ganzen Welt, nah und fern. Einen einzelnen Automaten kann eine Datei nicht getrennt färben.",
    "Bankomaty są barwione we własnych plikach modeli — nic innego z nich nie korzysta, więc zmianę widać tylko na bankomatach: od razu na wszystkich bankomatach modelu na całym świecie, z bliska i z daleka. Pojedynczego bankomatu nie da się przemalować osobno plikiem.",
  ],
  "Свечение экрана и вывески": ["Світіння екрана й вивіски", "Screen and sign glow", "Leuchten von Bildschirm und Schild", "Świecenie ekranu i szyldu"],
  "100 % — как в игре, 0 — не светятся": ["100 % — як у грі, 0 — не світяться", "100% is as in the game, 0 means no glow", "100 % wie im Spiel, 0 leuchtet nicht", "100% — jak w grze, 0 — nie świecą"],
  "Экран и вывеска светятся шейдером самой игры — днём и ночью, ночью заметнее. Сила — его множитель, тот же у всех банкоматов модели.": [
    "Екран і вивіска світяться шейдером самої гри — удень і вночі, вночі помітніше. Сила — його множник, той самий в усіх банкоматів моделі.",
    "The screen and sign glow with the game's own shader — day and night, more visible at night. Strength is its multiplier, the same on every ATM of the model.",
    "Bildschirm und Schild leuchten mit dem Shader des Spiels — Tag und Nacht, nachts deutlicher. Die Stärke ist sein Multiplikator, gleich an allen Automaten des Modells.",
    "Ekran i szyld świecą shaderem samej gry — w dzień i w nocy, w nocy wyraźniej. Siła to jego mnożnik, taki sam we wszystkich bankomatach modelu.",
  ],
  "Банкоматы по моделям": ["Банкомати за моделями", "ATMs by model", "Geldautomaten nach Modell", "Bankomaty według modeli"],
  "Эта модель сейчас как в игре.": ["Ця модель зараз як у грі.", "This model is as in the game right now.", "Dieses Modell ist gerade wie im Spiel.", "Ten model jest teraz jak w grze."],
  "По районам": ["За районами", "By district", "Nach Bezirk", "Według dzielnic"],
  "по районам": ["за районами", "by district", "nach Bezirk", "według dzielnic"],
  "Числа — по описи мира вашей игры: улицы, магазины, заправки и банк. Копии одного банкомата в картах-вариантах считаются одним. Правка меняет файл модели — изменятся все банкоматы этой модели сразу.": [
    "Числа — за описом світу вашої гри: вулиці, магазини, заправки й банк. Копії одного банкомата в картах-варіантах рахуються як один. Правка змінює файл моделі — зміняться всі банкомати цієї моделі одразу.",
    "Numbers come from your game's world index: streets, stores, gas stations and the bank. Copies of one ATM in variant maps count as one. The edit changes the model file — every ATM of this model changes at once.",
    "Die Zahlen stammen aus dem Weltindex deines Spiels: Straßen, Läden, Tankstellen und die Bank. Kopien eines Automaten in Kartenvarianten zählen als einer. Die Änderung betrifft die Modelldatei — alle Automaten dieses Modells ändern sich auf einmal.",
    "Liczby pochodzą z indeksu świata twojej gry: ulice, sklepy, stacje paliw i bank. Kopie jednego bankomatu w wariantach map liczą się jako jeden. Zmiana dotyczy pliku modelu — zmienią się od razu wszystkie bankomaty tego modelu.",
  ],
  "Все банкоматы как в игре одним шагом: цвета, картинки и свечение — штатные, свои облики моделей снимаются.": [
    "Усі банкомати як у грі одним кроком: кольори, картинки й світіння — штатні, власні вигляди моделей знімаються.",
    "All ATMs as in the game in one step: stock colours, pictures and glow; own model looks are removed.",
    "Alle Geldautomaten in einem Schritt wie im Spiel: Farben, Bilder und Leuchten original, eigene Modell-Looks werden entfernt.",
    "Wszystkie bankomaty jak w grze jednym krokiem: kolory, obrazy i świecenie oryginalne, własne wyglądy modeli są usuwane.",
  ],

  /* Инструменты и полоса */
  "Корпус и панель": ["Корпус і панель", "Body and panel", "Gehäuse und Bedienfeld", "Obudowa i panel"],
  "Корпус, рамка и панель с клавиатурой": ["Корпус, рамка й панель із клавіатурою", "Body, frame and keypad panel", "Gehäuse, Rahmen und Tastaturfeld", "Obudowa, ramka i panel z klawiaturą"],
  "Выберите сверху, какие банкоматы правите, — все сразу или одну модель. Корпус и рамку можно покрасить, панель — покрасить, заменить узором или картинкой": [
    "Виберіть угорі, які банкомати правите, — усі одразу чи одну модель. Корпус і рамку можна пофарбувати, панель — пофарбувати, замінити візерунком або картинкою",
    "Choose at the top which ATMs you edit — all at once or one model. The body and frame can be recoloured, the panel recoloured or replaced with a pattern or picture",
    "Wähle oben, welche Geldautomaten du bearbeitest — alle auf einmal oder ein Modell. Gehäuse und Rahmen lassen sich färben, das Bedienfeld färben oder durch Muster oder Bild ersetzen",
    "Wybierz u góry, które bankomaty edytujesz — wszystkie naraz czy jeden model. Obudowę i ramkę można przemalować, panel — przemalować lub zastąpić wzorem albo obrazem",
  ],
  "Экран и вывеска": ["Екран і вивіска", "Screen and sign", "Bildschirm und Schild", "Ekran i szyld"],
  "Экран, вывеска, логотипы и свечение": ["Екран, вивіска, логотипи й світіння", "Screen, sign, logos and glow", "Bildschirm, Schild, Logos und Leuchten", "Ekran, szyld, logotypy i świecenie"],
  "Своя картинка на экран, вывеску или полосу логотипов — или свой цвет. Ползунок свечения — насколько ярко они светятся": [
    "Власна картинка на екран, вивіску чи смугу логотипів — або власний колір. Повзунок світіння — наскільки яскраво вони світяться",
    "Your own picture on the screen, sign or logo strip — or your own colour. The glow slider sets how brightly they shine",
    "Eigenes Bild auf Bildschirm, Schild oder Logoleiste — oder eigene Farbe. Der Leuchtregler bestimmt, wie hell sie leuchten",
    "Własny obraz na ekran, szyld lub pasek logotypów — albo własny kolor. Suwak świecenia — jak jasno świecą",
  ],
  "Сколько банкоматов на карте и в каких районах": ["Скільки банкоматів на мапі й у яких районах", "How many ATMs are on the map and in which districts", "Wie viele Geldautomaten auf der Karte und in welchen Bezirken", "Ile bankomatów jest na mapie i w jakich dzielnicach"],
  "Сколько банкоматов этой модели в мире и где — правка меняет их все сразу": [
    "Скільки банкоматів цієї моделі у світі та де — правка змінює їх усі одразу",
    "How many ATMs of this model are in the world and where — the edit changes all of them at once",
    "Wie viele Automaten dieses Modells es in der Welt gibt und wo — die Änderung betrifft alle auf einmal",
    "Ile bankomatów tego modelu jest na świecie i gdzie — zmiana obejmuje wszystkie naraz",
  ],
  "Готовый вид оформляет все банкоматы разом — дальше любую часть и любую модель можно поправить": [
    "Готовий вигляд оформлює всі банкомати разом — далі будь-яку частину й будь-яку модель можна поправити",
    "A ready-made look styles all ATMs at once — then any part and any model can be adjusted",
    "Ein fertiger Look gestaltet alle Geldautomaten auf einmal — danach lässt sich jedes Teil und jedes Modell anpassen",
    "Gotowy wygląd zmienia wszystkie bankomaty naraz — potem każdą część i każdy model można poprawić",
  ],
  "Банкоматы в игре уже такие — ставить было нечего": ["Банкомати в грі вже такі — встановлювати було нічого", "The ATMs in the game are already like this — nothing to install", "Die Geldautomaten im Spiel sind schon so — nichts zu installieren", "Bankomaty w grze już takie są — nie było czego instalować"],
  "Банкоматы установлены. Перезапустите игру.": ["Банкомати встановлено. Перезапустіть гру.", "ATMs installed. Restart the game.", "Geldautomaten installiert. Starte das Spiel neu.", "Bankomaty zainstalowane. Uruchom grę ponownie."],
  "Банкоматы как в игре": ["Банкомати як у грі", "ATMs as in the game", "Geldautomaten wie im Spiel", "Bankomaty jak w grze"],
  "Снять банкоматы Astral — в игре станут как были": ["Зняти банкомати Astral — у грі стануть як були", "Remove Astral ATMs — the game goes back to how it was", "Astral-Geldautomaten entfernen — im Spiel wird es wie vorher", "Usuń bankomaty Astral — w grze wrócą do poprzedniego stanu"],
  "Ставим банкоматы в игру": ["Встановлюємо банкомати в гру", "Installing the ATMs into the game", "Geldautomaten werden ins Spiel installiert", "Instalujemy bankomaty w grze"],
  "Банкоматы сняты из игры — остальные моды на месте": ["Банкомати знято з гри — інші моди на місці", "ATMs removed from the game — other mods stay in place", "Geldautomaten aus dem Spiel entfernt — andere Mods bleiben", "Bankomaty usunięte z gry — pozostałe mody na miejscu"],
  "Какие банкоматы": ["Які банкомати", "Which ATMs", "Welche Geldautomaten", "Które bankomaty"],

  /* Проход по редактору */
  "Сверху — какие правите: все сразу или одну модель. Стрелки — повернуть.": [
    "Угорі — які правите: усі одразу чи одну модель. Стрілки — повернути.",
    "At the top — what you edit: all at once or one model. Arrows rotate.",
    "Oben — was du bearbeitest: alle auf einmal oder ein Modell. Pfeile drehen.",
    "U góry — co edytujesz: wszystkie naraz albo jeden model. Strzałki obracają.",
  ],
  "Свой цвет корпуса и рамки, панель — цветом, узором или картинкой.": [
    "Власний колір корпусу й рамки, панель — кольором, візерунком чи картинкою.",
    "Your own body and frame colour, the panel in a colour, pattern or picture.",
    "Eigene Farbe für Gehäuse und Rahmen, das Bedienfeld mit Farbe, Muster oder Bild.",
    "Własny kolor obudowy i ramki, panel — kolorem, wzorem lub obrazem.",
  ],
  "Своя картинка на экран и вывеску, свой цвет и сила свечения.": [
    "Власна картинка на екран і вивіску, власний колір і сила світіння.",
    "Your own picture on the screen and sign, your own colour and glow strength.",
    "Eigenes Bild auf Bildschirm und Schild, eigene Farbe und Leuchtstärke.",
    "Własny obraz na ekran i szyld, własny kolor i siła świecenia.",
  ],

  /* Полка и районы */
  "Стандартные банкоматы": ["Стандартні банкомати", "Standard ATMs", "Standard-Geldautomaten", "Standardowe bankomaty"],
  "Дэвис-Кварц": ["Девіс-Кварц", "Davis Quartz", "Davis Quartz", "Davis Quartz"],
  "Арена Maze Bank": ["Арена Maze Bank", "Maze Bank Arena", "Maze Bank Arena", "Arena Maze Bank"],
};
