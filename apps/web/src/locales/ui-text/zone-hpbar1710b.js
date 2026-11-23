/*
 * Фразы редактора «Полоска HP» (ТЗ 17.10.2026, вечер, задача 9): честная
 * строка «где работает» (Majestic RP и GTA 5 RP рисуют ник и полоску сами),
 * итог установки и остальные подписи редактора, которым не хватало перевода.
 * Русская строка → [uk, en, de, pl]. Вставка `{0}` — значение, оно само
 * переводится, если у него есть запись.
 */

export const zoneHpbar1710b = {
  /* --- где работает --- */
  "Меняется метка игрока самой GTA — на серверах, которые ставят метки игры. На Majestic RP и GTA 5 RP ник и полоску над игроком рисует сам сервер — файлом игры их не поменять.": [
    "Змінюється мітка гравця самої GTA — на серверах, які ставлять мітки гри. На Majestic RP і GTA 5 RP нік і смужку над гравцем малює сам сервер — файлом гри їх не змінити.",
    "This changes GTA's own player tag — on servers that use the game's tags. On Majestic RP and GTA 5 RP the server itself draws the name and the bar above the player — a game file cannot change them.",
    "Geändert wird die eigene Spielermarkierung von GTA — auf Servern, die die Markierungen des Spiels setzen. Auf Majestic RP und GTA 5 RP zeichnet der Server selbst Namen und Leiste über dem Spieler — mit einer Spieldatei lassen sie sich nicht ändern.",
    "Zmienia się znacznik gracza samej GTA — na serwerach, które stawiają znaczniki gry. Na Majestic RP i GTA 5 RP nick i pasek nad graczem rysuje sam serwer — plikiem gry nie da się ich zmienić.",
  ],
  "Проверить свой сервер: вид «Одна цифра» и «Всегда», «Применить» и в игру. Число над игроками — это метка игры, полоска поменяется; числа нет — рисует сервер.": [
    "Перевірити свій сервер: вигляд «Одна цифра» і «Завжди», «Застосувати» і в гру. Число над гравцями — це мітка гри, смужка зміниться; числа немає — малює сервер.",
    "To check your server: pick “One number” and “Always”, press “Apply” and join the game. A number above the players means it is the game's tag and the bar will change; no number means the server draws it.",
    "So prüfen Sie Ihren Server: Stil „Eine Zahl“ und „Immer“, „Anwenden“ und ins Spiel. Steht eine Zahl über den Spielern, ist es die Markierung des Spiels und die Leiste ändert sich; keine Zahl — dann zeichnet der Server.",
    "Jak sprawdzić swój serwer: wygląd „Jedna liczba” i „Zawsze”, „Zastosuj” i do gry. Liczba nad graczami to znacznik gry, pasek się zmieni; brak liczby — rysuje serwer.",
  ],
  "Полоска HP установлена: {0}. Перезапустите игру. На Majestic RP и GTA 5 RP полоску рисует сервер: там она не изменится.": [
    "Смужку HP встановлено: {0}. Перезапустіть гру. На Majestic RP і GTA 5 RP смужку малює сервер: там вона не зміниться.",
    "The HP bar is installed: {0}. Restart the game. On Majestic RP and GTA 5 RP the server draws the bar: it will not change there.",
    "Die HP-Leiste ist installiert: {0}. Starten Sie das Spiel neu. Auf Majestic RP und GTA 5 RP zeichnet der Server die Leiste: dort ändert sie sich nicht.",
    "Pasek HP został zainstalowany: {0}. Uruchom grę ponownie. Na Majestic RP i GTA 5 RP pasek rysuje serwer: tam się nie zmieni.",
  ],

  /* --- слова сводки: «Моя полоска HP · цифры · всегда» --- */
  "Моя полоска HP": ["Моя смужка HP", "My HP bar", "Meine HP-Leiste", "Mój pasek HP"],
  "полоска": ["смужка", "bar", "Leiste", "pasek"],
  "цифры": ["цифри", "numbers", "Zahlen", "liczby"],
  "одна цифра": ["одна цифра", "one number", "eine Zahl", "jedna liczba"],
  "цифры в полоске": ["цифри в смужці", "digits in the bar", "Ziffern in der Leiste", "cyfry w pasku"],
  "две полоски": ["дві смужки", "two strips", "zwei Streifen", "dwa paski"],
  "друг под другом": ["одна під одною", "stacked", "untereinander", "jedno pod drugim"],
  "всегда": ["завжди", "always", "immer", "zawsze"],
  "без брони": ["без броні", "no armour", "ohne Rüstung", "bez pancerza"],

  /* --- кадр --- */
  "Полное HP": ["Повне HP", "Full HP", "Volle HP", "Pełne HP"],
  "Ранен": ["Поранений", "Wounded", "Verwundet", "Ranny"],
  "100 HP без брони — штатная белая полоска": [
    "100 HP без броні — штатна біла смужка",
    "100 HP, no armour — the stock white bar",
    "100 HP ohne Rüstung — die weiße Standardleiste",
    "100 HP bez pancerza — standardowy biały pasek",
  ],
  "полное HP и полная броня: одной цифрой — 200": [
    "повне HP і повна броня: одним числом — 200",
    "full HP and full armour: as one number — 200",
    "volle HP und volle Rüstung: als eine Zahl — 200",
    "pełne HP i pełny pancerz: jedną liczbą — 200",
  ],
  "62 HP и 35 брони": ["62 HP і 35 броні", "62 HP and 35 armour", "62 HP und 35 Rüstung", "62 HP i 35 pancerza"],
  "Сколько HP и брони у того, на кого навелись": [
    "Скільки HP і броні у того, на кого навелися",
    "How much HP and armour the targeted player has",
    "Wie viel HP und Rüstung der anvisierte Spieler hat",
    "Ile HP i pancerza ma gracz, na którego celujesz",
  ],
  "Игроки с полоской HP над головой": [
    "Гравці зі смужкою HP над головою",
    "Players with an HP bar above their heads",
    "Spieler mit einer HP-Leiste über dem Kopf",
    "Gracze z paskiem HP nad głową",
  ],
  "Фон под игроками": ["Тло під гравцями", "Background behind the players", "Hintergrund hinter den Spielern", "Tło za graczami"],
  ". Метка того, на кого навелись, приближена в {0} раза.": [
    ". Мітка того, на кого навелися, наближена в {0} раза.",
    ". The tag of the targeted player is magnified {0} times.",
    ". Die Markierung des anvisierten Spielers ist {0}-fach vergrößert.",
    ". Znacznik gracza, na którego celujesz, jest powiększony {0} razy.",
  ],
  "Имена и цифры — буквами шрифтов из вашей игры.": [
    "Імена й цифри — літерами шрифтів із вашої гри.",
    "Names and digits use the letters of the fonts from your game.",
    "Namen und Ziffern — in den Schriften aus Ihrem Spiel.",
    "Nazwy i cyfry — literami czcionek z twojej gry.",
  ],
  "Имена и цифры — шрифтом окна: шрифты игры Astral читает из игры, а она ещё не найдена.": [
    "Імена й цифри — шрифтом вікна: шрифти гри Astral читає з гри, а її ще не знайдено.",
    "Names and digits use the window's font: Astral reads the game's fonts from the game, and it has not been found yet.",
    "Namen und Ziffern — in der Schrift des Fensters: Astral liest die Spielschriften aus dem Spiel, und es wurde noch nicht gefunden.",
    "Nazwy i cyfry — czcionką okna: Astral czyta czcionki gry z gry, a ta jeszcze nie została znaleziona.",
  ],

  /* --- «Вид» --- */
  "Полоска, цифры или одна цифра; одна полоса или две; когда видна": [
    "Смужка, цифри або одна цифра; одна смуга чи дві; коли видно",
    "Bar, digits or one number; one strip or two; when it shows",
    "Leiste, Ziffern oder eine Zahl; ein Streifen oder zwei; wann sichtbar",
    "Pasek, cyfry lub jedna liczba; jeden pasek albo dwa; kiedy widoczny",
  ],
  "Одна цифра": ["Одна цифра", "One number", "Eine Zahl", "Jedna liczba"],
  "два числа без полоски: 100 и 100": [
    "два числа без смужки: 100 і 100",
    "two numbers without a bar: 100 and 100",
    "zwei Zahlen ohne Leiste: 100 und 100",
    "dwie liczby bez paska: 100 i 100",
  ],
  "HP + броня одним числом, до 200": [
    "HP + броня одним числом, до 200",
    "HP + armour as one number, up to 200",
    "HP + Rüstung als eine Zahl, bis 200",
    "HP + pancerz jedną liczbą, do 200",
  ],
  "Белая полоса HP и броня #2F5C73 рядом — ровно как рисует игра. Цвета, толщина и цифры правятся дальше.": [
    "Біла смуга HP і броня #2F5C73 поруч — достеменно як малює гра. Кольори, товщина й цифри правляться далі.",
    "A white HP strip with the #2F5C73 armour beside it — exactly as the game draws it. Colours, thickness and digits are adjusted further on.",
    "Weißer HP-Streifen und Rüstung #2F5C73 daneben — genau so, wie das Spiel zeichnet. Farben, Dicke und Ziffern stellen Sie weiter unten ein.",
    "Biały pasek HP i pancerz #2F5C73 obok — dokładnie tak, jak rysuje gra. Kolory, grubość i cyfry ustawiasz dalej.",
  ],
  "Одна полоса или две": ["Одна смуга чи дві", "One strip or two", "Ein Streifen oder zwei", "Jeden pasek czy dwa"],
  "Одна полоса": ["Одна смуга", "One strip", "Ein Streifen", "Jeden pasek"],
  "Две полоски": ["Дві смужки", "Two strips", "Zwei Streifen", "Dwa paski"],
  "Раскладка HP и брони": ["Розкладка HP і броні", "HP and armour layout", "Anordnung von HP und Rüstung", "Układ HP i pancerza"],
  "как в игре: HP слева, броня справа": [
    "як у грі: HP ліворуч, броня праворуч",
    "as in the game: HP on the left, armour on the right",
    "wie im Spiel: HP links, Rüstung rechts",
    "jak w grze: HP z lewej, pancerz z prawej",
  ],
  "две полосы: HP сверху, броня под ней": [
    "дві смуги: HP зверху, броня під нею",
    "two strips: HP on top, armour below it",
    "zwei Streifen: HP oben, Rüstung darunter",
    "dwa paski: HP u góry, pancerz pod nim",
  ],
  "Как в игре: HP слева, броня справа в одной полосе; без брони — короткая полоса HP.": [
    "Як у грі: HP ліворуч, броня праворуч в одній смузі; без броні — коротка смуга HP.",
    "As in the game: HP on the left, armour on the right in one strip; without armour — a short HP strip.",
    "Wie im Spiel: HP links, Rüstung rechts in einem Streifen; ohne Rüstung — ein kurzer HP-Streifen.",
    "Jak w grze: HP z lewej, pancerz z prawej w jednym pasku; bez pancerza — krótki pasek HP.",
  ],
  "Две полосы во всю ширину: HP сверху, броня под ней. Без брони — одна полоса HP.": [
    "Дві смуги на всю ширину: HP зверху, броня під нею. Без броні — одна смуга HP.",
    "Two full-width strips: HP on top, armour below it. Without armour — a single HP strip.",
    "Zwei Streifen in voller Breite: HP oben, Rüstung darunter. Ohne Rüstung — ein HP-Streifen.",
    "Dwa paski na całą szerokość: HP u góry, pancerz pod nim. Bez pancerza — jeden pasek HP.",
  ],
  "Броня убрана (инструмент «Броня») — полоска всегда одним HP.": [
    "Броню прибрано (інструмент «Броня») — смужка завжди лише з HP.",
    "Armour is removed (the “Armour” tool) — the bar is always HP only.",
    "Die Rüstung ist entfernt (Werkzeug „Rüstung“) — die Leiste zeigt immer nur HP.",
    "Pancerz usunięty (narzędzie „Pancerz”) — pasek zawsze pokazuje samo HP.",
  ],
  "В строку": ["У рядок", "In a row", "In einer Zeile", "W wierszu"],
  "HP и броня одной строкой": ["HP і броня одним рядком", "HP and armour in one line", "HP und Rüstung in einer Zeile", "HP i pancerz w jednym wierszu"],
  "HP сверху, броня строкой ниже": ["HP зверху, броня рядком нижче", "HP on top, armour in a line below", "HP oben, Rüstung in einer Zeile darunter", "HP u góry, pancerz w wierszu niżej"],
  "HP сверху, броня строкой ниже.": ["HP зверху, броня рядком нижче.", "HP on top, armour in a line below.", "HP oben, Rüstung in einer Zeile darunter.", "HP u góry, pancerz w wierszu niżej."],
  "HP и броня одной строкой: 100 100.": [
    "HP і броня одним рядком: 100 100.",
    "HP and armour in one line: 100 100.",
    "HP und Rüstung in einer Zeile: 100 100.",
    "HP i pancerz w jednym wierszu: 100 100.",
  ],
  "Подпись «HP»": ["Підпис «HP»", "“HP” label", "Beschriftung „HP“", "Podpis „HP”"],
  "Подпись после числа": ["Підпис після числа", "Label after the number", "Beschriftung nach der Zahl", "Podpis po liczbie"],
  "Писать HP после числа": ["Писати HP після числа", "Write HP after the number", "HP nach der Zahl schreiben", "Pisz HP po liczbie"],
  "Убрать подпись HP": ["Прибрати підпис HP", "Remove the HP label", "HP-Beschriftung entfernen", "Usuń podpis HP"],
  "Над головой — «200 HP».": ["Над головою — «200 HP».", "Above the head — “200 HP”.", "Über dem Kopf — „200 HP“.", "Nad głową — „200 HP”."],
  "Над головой — одно число: «200».": ["Над головою — одне число: «200».", "Above the head — one number: “200”.", "Über dem Kopf — eine Zahl: „200“.", "Nad głową — jedna liczba: „200”."],
  "Без брони у игрока — до 100.": ["Без броні в гравця — до 100.", "Without armour the player shows up to 100.", "Ohne Rüstung des Spielers — bis 100.", "Bez pancerza u gracza — do 100."],
  "Броня убрана в «Броне» — число только HP, до 100.": [
    "Броню прибрано в «Броні» — число лише HP, до 100.",
    "Armour is removed in “Armour” — the number is HP only, up to 100.",
    "Die Rüstung ist unter „Rüstung“ entfernt — die Zahl ist nur HP, bis 100.",
    "Pancerz usunięty w „Pancerzu” — liczba to samo HP, do 100.",
  ],
  "Штатная полоска игры: белое HP, броня рядом, чёрная рамка, при наведении": [
    "Штатна смужка гри: біле HP, броня поруч, чорна рамка, при наведенні",
    "The game's stock bar: white HP, armour beside it, a black frame, on aiming",
    "Die Standardleiste des Spiels: weiße HP, Rüstung daneben, schwarzer Rahmen, beim Anvisieren",
    "Standardowy pasek gry: białe HP, pancerz obok, czarna ramka, po najechaniu celownikiem",
  ],
  "Поставить полоску как в игре — дальше её можно править": [
    "Поставити смужку як у грі — далі її можна правити",
    "Install the bar as in the game — you can adjust it afterwards",
    "Die Leiste wie im Spiel installieren — danach lässt sie sich anpassen",
    "Zainstaluj pasek jak w grze — potem można go poprawić",
  ],
  "Поставить полоску в GTA V Legacy": ["Поставити смужку в GTA V Legacy", "Install the bar into GTA V Legacy", "Die Leiste in GTA V Legacy installieren", "Zainstaluj pasek w GTA V Legacy"],

  /* --- «HP», «Броня», «Размер», «Цифры» --- */
  "Белая — как в игре: красит полосу HP игра, только если её попросит скрипт сервера. Пустая часть — тот же цвет, приглушённый.": [
    "Біла — як у грі: смугу HP фарбує гра, лише якщо її попросить скрипт сервера. Порожня частина — той самий колір, приглушений.",
    "White is the game's own: the game colours the HP strip only if the server's script asks it to. The empty part is the same colour, dimmed.",
    "Weiß ist wie im Spiel: Den HP-Streifen färbt das Spiel nur, wenn das Skript des Servers es verlangt. Der leere Teil hat dieselbe Farbe, abgedunkelt.",
    "Biały — jak w grze: pasek HP koloruje gra, tylko jeśli poprosi o to skrypt serwera. Pusta część to ten sam kolor, przygaszony.",
  ],
  "Белая — как в игре; пустая часть полосы — тот же цвет, приглушённый": [
    "Біла — як у грі; порожня частина смуги — той самий колір, приглушений",
    "White is the game's own; the empty part of the strip is the same colour, dimmed",
    "Weiß ist wie im Spiel; der leere Teil des Streifens hat dieselbe Farbe, abgedunkelt",
    "Biały — jak w grze; pusta część paska to ten sam kolor, przygaszony",
  ],
  "В виде «Цифры» этим цветом пишется число HP.": [
    "У вигляді «Цифри» цим кольором пишеться число HP.",
    "In the “Digits” style the HP number is written in this colour.",
    "In der Ansicht „Ziffern“ wird die HP-Zahl in dieser Farbe geschrieben.",
    "W widoku „Cyfry” liczba HP jest pisana tym kolorem.",
  ],
  "«Одна цифра» пишется этим цветом.": ["«Одна цифра» пишеться цим кольором.", "“One number” is written in this colour.", "„Eine Zahl“ wird in dieser Farbe geschrieben.", "„Jedna liczba” jest pisana tym kolorem."],
  "Показывать ли броню и её цвет": ["Чи показувати броню та її колір", "Whether to show armour, and its colour", "Ob die Rüstung und ihre Farbe angezeigt werden", "Czy pokazywać pancerz i jego kolor"],
  "Показывать броню в полоске": ["Показувати броню в смужці", "Show armour in the bar", "Rüstung in der Leiste anzeigen", "Pokaż pancerz w pasku"],
  "Полоска — одно HP, даже когда у игрока есть броня.": [
    "Смужка — лише HP, навіть коли в гравця є броня.",
    "The bar is HP only, even when the player has armour.",
    "Die Leiste zeigt nur HP, auch wenn der Spieler Rüstung hat.",
    "Pasek to samo HP, nawet gdy gracz ma pancerz.",
  ],
  "Броня видна, когда она у игрока есть: без брони игра показывает одно HP. #2F5C73 — цвет брони в файле игры. Одна полоса или две — в «Виде».": [
    "Броня видна, коли вона є в гравця: без броні гра показує лише HP. #2F5C73 — колір броні у файлі гри. Одна смуга чи дві — у «Вигляді».",
    "Armour shows when the player has it: without armour the game shows HP only. #2F5C73 is the armour colour in the game's file. One strip or two — in “Style”.",
    "Die Rüstung ist sichtbar, wenn der Spieler sie hat: ohne Rüstung zeigt das Spiel nur HP. #2F5C73 ist die Rüstungsfarbe in der Spieldatei. Ein Streifen oder zwei — unter „Stil“.",
    "Pancerz jest widoczny, gdy gracz go ma: bez pancerza gra pokazuje samo HP. #2F5C73 to kolor pancerza w pliku gry. Jeden pasek czy dwa — w „Wyglądzie”.",
  ],
  "В «Одной цифре» броня прибавляется к HP: полное HP и полная броня — 200. Своего цвета у неё тут нет.": [
    "В «Одній цифрі» броня додається до HP: повне HP і повна броня — 200. Власного кольору в неї тут немає.",
    "In “One number” armour is added to HP: full HP and full armour make 200. It has no colour of its own here.",
    "In „Eine Zahl“ wird die Rüstung zu den HP addiert: volle HP und volle Rüstung ergeben 200. Eine eigene Farbe hat sie hier nicht.",
    "W „Jednej liczbie” pancerz dodaje się do HP: pełne HP i pełny pancerz to 200. Własnego koloru tu nie ma.",
  ],
  "Размер, толщина, место над головой и фон": [
    "Розмір, товщина, місце над головою і тло",
    "Size, thickness, position above the head and background",
    "Größe, Dicke, Position über dem Kopf und Hintergrund",
    "Rozmiar, grubość, miejsce nad głową i tło",
  ],
  "С цифрами внутри полоска не тоньше {0} пт": [
    "З цифрами всередині смужка не тонша за {0} пт",
    "With digits inside, the bar is no thinner than {0} pt",
    "Mit Ziffern darin ist die Leiste nicht dünner als {0} pt",
    "Z cyframi w środku pasek nie jest cieńszy niż {0} pt",
  ],
  "Толщина: значение": ["Товщина: значення", "Thickness: value", "Dicke: Wert", "Grubość: wartość"],
  "Выше или ниже: значение": ["Вище чи нижче: значення", "Higher or lower: value", "Höher oder tiefer: Wert", "Wyżej lub niżej: wartość"],
  "Плотность фона: значение": ["Щільність тла: значення", "Background density: value", "Hintergrunddichte: Wert", "Gęstość tła: wartość"],
  "Шрифт игры, цвет и тень цифр": [
    "Шрифт гри, колір і тінь цифр",
    "The game's font, digit colour and shadow",
    "Spielschrift, Farbe und Schatten der Ziffern",
    "Czcionka gry, kolor i cień cyfr",
  ],
  "Та же строка на точку вправо-вниз, противоположной яркости: у светлых цифр — чёрная, у тёмных — белая. Так цифры читаются и на заливке, и на пустой части полосы.": [
    "Той самий рядок на точку праворуч-вниз, протилежної яскравості: у світлих цифр — чорний, у темних — білий. Так цифри читаються і на заливці, і на порожній частині смуги.",
    "The same line one point right and down, of opposite brightness: black for light digits, white for dark ones. That way the digits read both on the fill and on the empty part of the strip.",
    "Dieselbe Zeile einen Punkt nach rechts unten, mit gegensätzlicher Helligkeit: bei hellen Ziffern schwarz, bei dunklen weiß. So bleiben die Ziffern auf der Füllung und auf dem leeren Teil des Streifens lesbar.",
    "Ten sam wiersz o punkt w prawo i w dół, o przeciwnej jasności: dla jasnych cyfr czarny, dla ciemnych biały. Dzięki temu cyfry są czytelne i na wypełnieniu, i na pustej części paska.",
  ],
  "Цифры {0}": ["Цифри {0}", "Numbers {0}", "Zahlen {0}", "Liczby {0}"],
  "Число HP — цветом HP, число брони — цветом брони: они правятся в «HP» и «Броне».": [
    "Число HP — кольором HP, число броні — кольором броні: вони правляться в «HP» і «Броні».",
    "The HP number uses the HP colour, the armour number uses the armour colour: both are set in “HP” and “Armour”.",
    "Die HP-Zahl hat die HP-Farbe, die Rüstungszahl die Rüstungsfarbe: beide stellen Sie unter „HP“ und „Rüstung“ ein.",
    "Liczba HP ma kolor HP, liczba pancerza — kolor pancerza: oba ustawisz w „HP” i „Pancerzu”.",
  ],
  "«Одна цифра» пишется цветом HP — он правится в «HP».": [
    "«Одна цифра» пишеться кольором HP — він правиться в «HP».",
    "“One number” is written in the HP colour — it is set in “HP”.",
    "„Eine Zahl“ wird in der HP-Farbe geschrieben — sie stellen Sie unter „HP“ ein.",
    "„Jedna liczba” jest pisana kolorem HP — ustawisz go w „HP”.",
  ],

  /* --- подписи полей: у ползунков и полей цвета они уходят в `aria-label`
     поля ввода, а такие поля слой перевода разметки пропускает --- */
  "белая полоска HP и брони, как в игре": [
    "біла смужка HP і броні, як у грі",
    "a white HP and armour bar, as in the game",
    "weiße HP- und Rüstungsleiste, wie im Spiel",
    "biały pasek HP i pancerza, jak w grze",
  ],
  "Цвет полосы здоровья": ["Колір смуги здоров'я", "Colour of the health strip", "Farbe des Gesundheitsstreifens", "Kolor paska zdrowia"],
  "Цвет полосы HP": ["Колір смуги HP", "HP strip colour", "Farbe des HP-Streifens", "Kolor paska HP"],
  "Убрать броню из полоски": ["Прибрати броню зі смужки", "Remove armour from the bar", "Rüstung aus der Leiste entfernen", "Usuń pancerz z paska"],

  "Как решает игра или сервер — например, когда наводишься на игрока.": [
    "Як вирішує гра або сервер — наприклад, коли наводишся на гравця.",
    "As the game or the server decides — for example, when you aim at a player.",
    "So, wie Spiel oder Server es entscheiden — zum Beispiel, wenn man auf einen Spieler zielt.",
    "Tak, jak zdecyduje gra lub serwer — na przykład gdy celujesz w gracza.",
  ],
  "Цвет цифр": ["Колір цифр", "Digit colour", "Ziffernfarbe", "Kolor cyfr"],
  "Цифры — доля HP и брони от 0 до 100, как её считает игра; одна цифра — их сумма, до 200": [
    "Цифри — частка HP і броні від 0 до 100, як її рахує гра; одна цифра — їхня сума, до 200",
    "Numbers are the share of HP and armour from 0 to 100, as the game counts it; one number is their sum, up to 200",
    "Zahlen — Anteil von HP und Rüstung von 0 bis 100, wie das Spiel ihn berechnet; eine Zahl ist ihre Summe, bis 200",
    "Liczby to udział HP i pancerza od 0 do 100, tak jak liczy gra; jedna liczba to ich suma, do 200",
  ],
  "«Крупно» в углу кадра — метка того, на кого навелись: так видна толщина": [
    "«Крупно» у кутку кадру — мітка того, на кого навелися: так видно товщину",
    "“Large” in the corner of the frame is the tag of the targeted player: that is how the thickness shows",
    "„Groß“ in der Bildecke zeigt die Markierung des anvisierten Spielers: So sieht man die Dicke",
    "„Duży” w rogu kadru pokazuje znacznik gracza, na którego celujesz: tak widać grubość",
  ],

  /* --- остальное по видам --- */
  "Друг под другом": ["Одна під одною", "Stacked", "Untereinander", "Jedno pod drugim"],
  "Одно число — HP и броня вместе: полное HP и полная броня — 200, без брони — до 100. HP и броня — доли полос игры, по 0…100 каждая.": [
    "Одне число — HP і броня разом: повне HP і повна броня — 200, без броні — до 100. HP і броня — частки смуг гри, по 0…100 кожна.",
    "One number — HP and armour together: full HP and full armour make 200, without armour — up to 100. HP and armour are shares of the game's strips, 0…100 each.",
    "Eine Zahl — HP und Rüstung zusammen: volle HP und volle Rüstung ergeben 200, ohne Rüstung — bis 100. HP und Rüstung sind Anteile der Spielstreifen, je 0…100.",
    "Jedna liczba — HP i pancerz razem: pełne HP i pełny pancerz to 200, bez pancerza — do 100. HP i pancerz to ułamki pasków gry, po 0…100 każdy.",
  ],
  "Без брони полоска и цифры — одно HP; «HP и броня» в углу кадра показывает броню": [
    "Без броні смужка й цифри — лише HP; «HP і броня» в кутку кадру показує броню",
    "Without armour the bar and digits are HP only; “HP and armour” in the corner of the frame shows the armour",
    "Ohne Rüstung zeigen Leiste und Ziffern nur HP; „HP und Rüstung“ in der Bildecke zeigt die Rüstung",
    "Bez pancerza pasek i cyfry to samo HP; „HP i pancerz” w rogu kadru pokazuje pancerz",
  ],
  "Чёрная рамка 100 % — как в игре": ["Чорна рамка 100 % — як у грі", "A black frame at 100 % — as in the game", "Schwarzer Rahmen bei 100 % — wie im Spiel", "Czarna ramka 100 % — jak w grze"],
  "У полоски сейчас нет цифр. Они видны у видов «Цифры HP и брони», «Одна цифра» и «Цифры в полоске» — выберите вид, и здесь появятся шрифт, цвет и тень.": [
    "У смужки зараз немає цифр. Вони видні у виглядах «Цифри HP і броні», «Одна цифра» та «Цифри в смужці» — оберіть вигляд, і тут з'являться шрифт, колір і тінь.",
    "The bar has no digits right now. They show in the “HP and armour numbers”, “One number” and “Digits in the bar” styles — pick a style and the font, colour and shadow appear here.",
    "Die Leiste hat derzeit keine Ziffern. Sie sind in den Stilen „HP- und Rüstungszahlen“, „Eine Zahl“ und „Ziffern in der Leiste“ sichtbar — wählen Sie eine Ansicht, und hier erscheinen Schrift, Farbe und Schatten.",
    "Pasek nie ma teraz cyfr. Widać je w wyglądach „Liczby HP i pancerza”, „Jedna liczba” i „Cyfry w pasku” — wybierz widok, a tu pojawią się czcionka, kolor i cień.",
  ],
};
