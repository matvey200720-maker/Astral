/*
 * Свои надписи, значки, картинки и кисть карты на мини-карте (задача 28, этап В, 19.10.2026): переключатель, подсказки,
 * подпись кадра и строки итога установки.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneS1RadarItems1910 = {
  /* Плашка «Текстуры мира собраны прежней версией» (19.10, задача 33): над «Ухудшением текстур», «ЧБ-миром» и «Стилем мира». */
  "Текстуры мира собраны прежней версией и могут ронять игру.": [
    "Текстури світу зібрано попередньою версією, і вони можуть валити гру.",
    "The world textures were built by an earlier version and may crash the game.",
    "Die Welttexturen wurden mit einer früheren Version erstellt und können das Spiel zum Absturz bringen.",
    "Tekstury świata zbudowano wcześniejszą wersją i mogą wywalać grę.",
  ],
  "Пакет в игре собран до исправления: модели карты с зашитыми текстурами из него вылетают на некоторых местах. «Пересобрать» соберёт его заново — в игру ничего не пишется, пока вы не нажмёте.": [
    "Пакет у грі зібрано до виправлення: моделі карти зі зашитими текстурами з нього вилітають у деяких місцях. «Перезібрати» зробить його заново — у гру нічого не пишеться, доки ви не натиснете.",
    "The package in the game was built before the fix: map models with embedded textures from it crash at some places. “Rebuild” builds it again — nothing is written to the game until you press it.",
    "Das Paket im Spiel wurde vor der Korrektur erstellt: Kartenmodelle mit eingebetteten Texturen daraus stürzen an manchen Stellen ab. „Neu erstellen“ baut es neu — ins Spiel wird nichts geschrieben, bis Sie klicken.",
    "Pakiet w grze zbudowano przed poprawką: modele mapy z wszytymi teksturami z niego wywalają grę w niektórych miejscach. „Zbuduj ponownie” zbuduje go od nowa — do gry nic nie jest zapisywane, dopóki nie klikniesz.",
  ],
  "Текстуры мира собраны прежней версией": [
    "Текстури світу зібрано попередньою версією",
    "World textures built by an earlier version",
    "Welttexturen mit einer früheren Version erstellt",
    "Tekstury świata zbudowane wcześniejszą wersją",
  ],
  "Пересобрать": ["Перезібрати", "Rebuild", "Neu erstellen", "Zbuduj ponownie"],
  "Пересборка текстур мира": ["Перезбирання текстур світу", "Rebuilding the world textures", "Welttexturen neu erstellen", "Ponowne budowanie tekstur świata"],
  "В очереди…": ["У черзі…", "Queued…", "In der Warteschlange…", "W kolejce…"],
  "Пересобираем…": ["Перезбираємо…", "Rebuilding…", "Wird neu erstellt…", "Budujemy ponownie…"],
  "Не удалось пересобрать текстуры мира: {0}": [
    "Не вдалося перезібрати текстури світу: {0}",
    "Could not rebuild the world textures: {0}",
    "Die Welttexturen konnten nicht neu erstellt werden: {0}",
    "Nie udało się ponownie zbudować tekstur świata: {0}",
  ],
  "Текстуры мира пересобраны. Перезапустите игру, чтобы увидеть изменения.": [
    "Текстури світу перезібрано. Перезапустіть гру, щоб побачити зміни.",
    "The world textures were rebuilt. Restart the game to see the changes.",
    "Die Welttexturen wurden neu erstellt. Starten Sie das Spiel neu, um die Änderungen zu sehen.",
    "Tekstury świata zbudowano ponownie. Uruchom grę ponownie, aby zobaczyć zmiany.",
  ],
  /* Слова-примеры «Расстояния» в мини-карте (19.10): серая подсказка в пустом поле. */
  "моц": ["моц", "moc", "moc", "moc"],
  "Серое слово в пустом поле — только пример. Пока вы не ввели своё, в игре остаются «км» и «м».": [
    "Сіре слово в порожньому полі — лише приклад. Поки ви не ввели своє, у грі лишаються «км» і «м».",
    "The grey word in an empty field is only an example. Until you type your own, the game keeps “km” and “m”.",
    "Das graue Wort im leeren Feld ist nur ein Beispiel. Solange Sie kein eigenes eingeben, bleiben im Spiel „km“ und „m“.",
    "Szare słowo w pustym polu to tylko przykład. Dopóki nie wpiszesz własnego, w grze zostają „km” i „m”.",
  ],
  "Размер надписей на мини-карте": ["Розмір написів на міні-карті", "Label size on the minimap", "Größe der Beschriftungen auf der Minikarte", "Rozmiar napisów na minimapie"],
  "Надписи и значки на мини-карте": ["Написи та значки на міні-карті", "Labels and icons on the minimap", "Beschriftungen und Symbole auf der Minikarte", "Napisy i ikony na minimapie"],
  "Надписи и значки на мини-карте включены": [
    "Написи та значки на міні-карті ввімкнено",
    "Labels and icons on the minimap are on",
    "Beschriftungen und Symbole auf der Minikarte eingeschaltet",
    "Napisy i ikony na minimapie włączone",
  ],
  "Надписи и значки на мини-карте выключены": [
    "Написи та значки на міні-карті вимкнено",
    "Labels and icons on the minimap are off",
    "Beschriftungen und Symbole auf der Minikarte ausgeschaltet",
    "Napisy i ikony na minimapie wyłączone",
  ],
  "Мини-карта идёт в цветах вашей карты, и на неё наносятся зоны и их границы — те же, что на карте паузы, — подписи карт-модов, как их нарисовал автор, а также свои надписи, значки, картинки и кисть. Astral рисует их контурами и цветной сеткой из треугольников, поэтому мелкое упрощается, а совсем мелкое пропадает.": [
    "Міні-карта йде в кольорах вашої карти, і на неї наносяться зони та їхні межі — ті самі, що на карті паузи, — підписи мап-модів, як їх намалював автор, а також власні написи, значки, картинки й пензель. Astral малює їх контурами та кольоровою сіткою з трикутників, тому дрібне спрощується, а зовсім дрібне зникає.",
    "The minimap follows your map’s colours, and the zones and their borders — the same as on the pause map — are drawn on it, along with the map-mod labels as the author drew them and your own text, icons, pictures and brush. Astral draws them as outlines and a coloured grid of triangles, so small details are simplified and tiny ones disappear.",
    "Die Minikarte folgt den Farben Ihrer Karte, und darauf werden die Zonen und ihre Grenzen — dieselben wie auf der Pausenkarte —, die Beschriftungen der Karten-Mods, wie der Autor sie gezeichnet hat, sowie Ihre eigenen Texte, Symbole, Bilder und der Pinsel gezeichnet. Astral zeichnet sie als Umrisse und farbiges Dreiecksraster, daher werden Kleinigkeiten vereinfacht und ganz kleine verschwinden.",
    "Minimapa idzie w kolorach Twojej mapy, a na nią nanoszone są strefy i ich granice — te same co na mapie pauzy — napisy map-modów tak, jak narysował je autor, oraz Twoje własne napisy, ikony, obrazy i pędzel. Astral rysuje je konturami i kolorową siatką trójkątów, więc drobiazgi są upraszczane, a najmniejsze znikają.",
  ],
  "Мини-карта идёт в цветах вашей карты, и на неё наносятся зоны и их границы — те же, что на карте паузы, — а также подписи карт-модов, как их нарисовал автор. Свои надписи, значки и картинки на мини-карту не попадают.": [
    "Міні-карта йде в кольорах вашої карти, і на неї наносяться зони та їхні межі — ті самі, що на карті паузи, — а також підписи мап-модів, як їх намалював автор. Власні написи, значки й картинки на міні-карту не потрапляють.",
    "The minimap follows your map’s colours, and the zones and their borders — the same as on the pause map — are drawn on it, along with the map-mod labels as the author drew them. Your own text, icons and pictures do not appear on the minimap.",
    "Die Minikarte folgt den Farben Ihrer Karte, und darauf werden die Zonen und ihre Grenzen — dieselben wie auf der Pausenkarte — sowie die Beschriftungen der Karten-Mods gezeichnet, wie der Autor sie angelegt hat. Eigene Texte, Symbole und Bilder erscheinen nicht auf der Minikarte.",
    "Minimapa idzie w kolorach Twojej mapy, a na nią nanoszone są strefy i ich granice — te same co na mapie pauzy — oraz napisy map-modów, tak jak narysował je autor. Własne napisy, ikony i obrazy nie trafiają na minimapę.",
  ],
  "На мини-карту легли и свои надписи, значки и картинки карты": [
    "На міні-карту лягли й власні написи, значки та картинки карти",
    "Your own text, icons and pictures of the map are on the minimap too",
    "Auch Ihre eigenen Texte, Symbole und Bilder der Karte liegen auf der Minikarte",
    "Na minimapie są też własne napisy, ikony i obrazy mapy",
  ],
  "Часть из них упрощена, чтобы мини-карта не просела по кадрам": [
    "Частину з них спрощено, щоб міні-карта не просіла за кадрами",
    "Some of them were simplified so the minimap does not drop frames",
    "Einige davon wurden vereinfacht, damit die Minikarte keine Bildrate verliert",
    "Część z nich uproszczono, żeby minimapa nie traciła klatek",
  ],
};
