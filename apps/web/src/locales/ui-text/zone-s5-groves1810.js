/*
 * Зона S5, задача 22 ТЗ 19.10.2026: «В разнобой» на настоящих местах карты — названия мест,
 * подпись кадра и подсказки. Русская строка → [uk, en, de, pl].
 *
 * Строки со вставками `{0}` собираются в коде через `trFill` — подставляется уже готовое название.
 */

export const zoneS5Groves1810 = {
  "Лес у Палето": ["Ліс біля Палето", "Forest near Paleto", "Wald bei Paleto", "Las koło Paleto"],
  "Кусок карты вашей GTA V": ["Шматок мапи вашої GTA V", "A piece of your GTA V map", "Ein Stück Ihrer GTA-V-Karte", "Fragment mapy Twojej GTA V"],
  "Кусок карты вашей GTA V — {0}: кадр читает её файлы на этом компьютере, текстур Rockstar в поставке нет. Земля, дороги и дома — как стоят в игре, дальние дома и мелочь убраны, чтобы кадр был лёгким; деревья и кусты — настоящие модели игры на своих местах.": [
    "Шматок мапи вашої GTA V — {0}: кадр читає її файли на цьому комп’ютері, текстур Rockstar у поставці немає. Земля, дороги й будинки — як стоять у грі, далекі будинки та дрібниці прибрано, щоб кадр був легким; дерева й кущі — справжні моделі гри на своїх місцях.",
    "A piece of your GTA V map — {0}: the view reads its files on this computer, and no Rockstar textures ship with the app. The ground, roads and houses stand as in the game; far houses and small props are left out to keep the view light; trees and bushes are the game's real models in their real places.",
    "Ein Stück der Karte Ihres GTA V — {0}: Die Ansicht liest dessen Dateien auf diesem Computer, Rockstar-Texturen werden nicht mitgeliefert. Boden, Straßen und Häuser stehen wie im Spiel; ferne Häuser und Kleinkram sind weggelassen, damit die Ansicht leicht bleibt; Bäume und Büsche sind die echten Modelle des Spiels an ihren Plätzen.",
    "Fragment mapy Twojej GTA V — {0}: widok czyta jej pliki na tym komputerze, tekstur Rockstar nie ma w pakiecie. Ziemia, drogi i domy stoją jak w grze; dalekie domy i drobiazgi pominięto, żeby widok był lekki; drzewa i krzewy to prawdziwe modele gry na swoich miejscach.",
  ],
  "Лист кроны — лист игры, перекрашенный той же функцией, что копии моделей при установке.": [
    "Лист крони — лист гри, перефарбований тією самою функцією, що й копії моделей під час встановлення.",
    "The crown leaf is the game's leaf, recoloured by the same function that recolours the model copies at install.",
    "Das Kronenblatt ist das Blatt des Spiels, mit derselben Funktion umgefärbt wie die Modellkopien bei der Installation.",
    "Liść korony to liść z gry, przemalowany tą samą funkcją co kopie modeli przy instalacji.",
  ],
  "Трава в кадре не показана: в игре её цвет ложится пятнами по клеткам 6 м.": [
    "Траву в кадрі не показано: у грі її колір лягає плямами за клітинками 6 м.",
    "Grass is not shown in the view: in the game its colour lands in patches of 6 m cells.",
    "Gras ist in der Ansicht nicht zu sehen: Im Spiel legt sich ihre Farbe in Flecken nach 6-m-Feldern.",
    "Trawy w widoku nie pokazano: w grze jej kolor układa się plamami po polach 6 m.",
  ],
  "Кусок карты с деревьями в облике работы: каждое дерево своим цветом палитры. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.": [
    "Шматок мапи з деревами в вигляді роботи: кожне дерево своїм кольором палітри. Стрілки — повернути, плюс і мінус — наблизити, права кнопка — політ.",
    "A piece of the map with trees in the work's look: each tree in its own palette colour. Arrows rotate, plus and minus zoom, right button flies.",
    "Ein Kartenausschnitt mit Bäumen im Look der Arbeit: jeder Baum in seiner Palettenfarbe. Pfeile drehen, Plus und Minus zoomen, die rechte Taste fliegt.",
    "Fragment mapy z drzewami w wyglądzie pracy: każde drzewo w swoim kolorze palety. Strzałki obracają, plus i minus przybliżają, prawy przycisk to lot.",
  ],

  /* --- Залазы на настоящих местах карты (задача 26) --- */
  "К метке": ["До мітки", "To the marker", "Zur Markierung", "Do znacznika"],
  "Камера подлетает к следующей метке выбранного вида на этом месте": [
    "Камера підлітає до наступної мітки вибраного виду на цьому місці",
    "The camera flies to the next marker of the chosen kind at this place",
    "Die Kamera fliegt zur nächsten Markierung der gewählten Art an diesem Ort",
    "Kamera podlatuje do następnego znacznika wybranego rodzaju w tym miejscu",
  ],
  "На этом месте такой метки нет — выберите другое место": [
    "На цьому місці такої мітки немає — виберіть інше місце",
    "There is no such marker at this place — pick another place",
    "An diesem Ort gibt es keine solche Markierung — wählen Sie einen anderen Ort",
    "W tym miejscu nie ma takiego znacznika — wybierz inne miejsce",
  ],
  "Земля, дороги и дома вокруг — кусок вашей GTA V: кадр читает её файлы на этом компьютере, текстур Rockstar в поставке нет. Мелочь и дальние дома убраны, чтобы кадр был лёгким. Метки стоят там, где их ставит расстановка мода; сама метка — те же пиксели, что уедут в DDS.": [
    "Земля, дороги й будинки навколо — шматок вашої GTA V: кадр читає її файли на цьому комп’ютері, текстур Rockstar у поставці немає. Дрібницю й далекі будинки прибрано, щоб кадр був легким. Мітки стоять там, де їх ставить розстановка мода; сама мітка — ті самі пікселі, що поїдуть у DDS.",
    "The ground, roads and houses around are a piece of your GTA V: the view reads its files on this computer, and no Rockstar textures ship with the app. Small props and far houses are left out to keep the view light. Markers stand where the mod's placement puts them; the marker itself is the same pixels that will go into the DDS.",
    "Boden, Straßen und Häuser ringsum sind ein Ausschnitt Ihres GTA V: Die Ansicht liest dessen Dateien auf diesem Computer, Rockstar-Texturen werden nicht mitgeliefert. Kleinkram und ferne Häuser sind weggelassen, damit die Ansicht leicht bleibt. Die Markierungen stehen dort, wo die Platzierung des Mods sie setzt; die Markierung selbst sind dieselben Pixel, die in die DDS gehen.",
    "Ziemia, drogi i domy wokół to wycinek Twojej GTA V: widok czyta jej pliki na tym komputerze, tekstur Rockstar nie ma w pakiecie. Drobiazgi i dalekie domy pominięto, żeby widok był lekki. Znaczniki stoją tam, gdzie stawia je rozmieszczenie moda; sam znacznik to te same piksele, które trafią do DDS.",
  ],
  "Игра не подключена: земля и дома — средними цветами, текстур Rockstar в поставке нет. Метки стоят там, где их ставит расстановка мода; сама метка — те же пиксели, что уедут в DDS.": [
    "Гру не підключено: земля й будинки — середніми кольорами, текстур Rockstar у поставці немає. Мітки стоять там, де їх ставить розстановка мода; сама мітка — ті самі пікселі, що поїдуть у DDS.",
    "The game is not connected: the ground and houses use average colours, and no Rockstar textures ship with the app. Markers stand where the mod's placement puts them; the marker itself is the same pixels that will go into the DDS.",
    "Das Spiel ist nicht verbunden: Boden und Häuser in Durchschnittsfarben, Rockstar-Texturen werden nicht mitgeliefert. Die Markierungen stehen dort, wo die Platzierung des Mods sie setzt; die Markierung selbst sind dieselben Pixel, die in die DDS gehen.",
    "Gra nie jest podłączona: ziemia i domy mają średnie kolory, tekstur Rockstar nie ma w pakiecie. Znaczniki stoją tam, gdzie stawia je rozmieszczenie moda; sam znacznik to te same piksele, które trafią do DDS.",
  ],
  "На этом месте {0} из {1} меток мода стоят на стенах и земле игры; остальные — над постройками, которых в игре нет, и здесь не показаны.": [
    "На цьому місці {0} із {1} міток мода стоять на стінах і землі гри; решта — над спорудами, яких у грі немає, і тут не показані.",
    "At this place {0} of {1} mod markers stand on the game's walls and ground; the rest hang over buildings that are not in the game and are not shown here.",
    "An diesem Ort stehen {0} von {1} Markierungen des Mods auf Wänden und Boden des Spiels; die übrigen hängen über Bauten, die es im Spiel nicht gibt, und werden hier nicht gezeigt.",
    "W tym miejscu {0} z {1} znaczników moda stoi na ścianach i ziemi gry; pozostałe wiszą nad budynkami, których nie ma w grze, i nie są tu pokazane.",
  ],
  "Метки залазов на настоящем месте карты. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.": [
    "Мітки залазів на справжньому місці мапи. Стрілки — повернути, плюс і мінус — наблизити, права кнопка — політ.",
    "Climb markers at a real place on the map. Arrows rotate, plus and minus zoom, right button flies.",
    "Klettermarkierungen an einem echten Ort der Karte. Pfeile drehen, Plus und Minus zoomen, die rechte Taste fliegt.",
    "Znaczniki podejść w prawdziwym miejscu mapy. Strzałki obracają, plus i minus przybliżają, prawy przycisk to lot.",
  ],
  "Кадр «На месте» показывает метку на настоящем месте карты — днём, в сумерках и ночью.": [
    "Кадр «На місці» показує мітку на справжньому місці мапи — вдень, у сутінках і вночі.",
    "The «In place» view shows the marker at a real place on the map — by day, at dusk and at night.",
    "Die Ansicht «An Ort und Stelle» zeigt die Markierung an einem echten Ort der Karte — bei Tag, in der Dämmerung und nachts.",
    "Widok «Na miejscu» pokazuje znacznik w prawdziwym miejscu mapy — za dnia, o zmierzchu i w nocy.",
  ],
};
