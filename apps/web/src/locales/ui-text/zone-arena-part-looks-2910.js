/*
 * Облик на часть вещи зала (ТЗ 29.10.2026, один баннер из десяти): слова отказов установки — главный процесс отдаёт их русскими
 * (`apps/desktop/src/recolor-arenas.js`, `buildPartCopy`), слой перевода разметки переводит их на экране. Шаблоны с `{n}` — по ключу.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneArenaPartLooks2910 = {
  "Разных обликов у вещей зала — {0}, больше {1}: верните часть вещей или частей к игре.": [
    "Різних виглядів у речей зали — {0}, більше ніж {1}: поверніть частину речей або частин до гри.",
    "The hall items have {0} different looks, more than {1}: return some items or parts to the game look.",
    "Die Gegenstände der Halle haben {0} verschiedene Looks, mehr als {1}: Setze einige Gegenstände oder Teile auf das Spiel zurück.",
    "Przedmioty hali mają {0} różnych wyglądów, więcej niż {1}: przywróć część przedmiotów lub części do wyglądu z gry.",
  ],
  "Разных обликов у вещей места — {0}, больше {1}: верните часть вещей или частей к игре.": [
    "Різних виглядів у речей місця — {0}, більше ніж {1}: поверніть частину речей або частин до гри.",
    "The place items have {0} different looks, more than {1}: return some items or parts to the game look.",
    "Die Gegenstände des Ortes haben {0} verschiedene Looks, mehr als {1}: Setze einige Gegenstände oder Teile auf das Spiel zurück.",
    "Przedmioty miejsca mają {0} różnych wyglądów, więcej niż {1}: przywróć część przedmiotów lub części do wyglądu z gry.",
  ],
  "У модели «{0}» нет файла в описи Astral — облик на её часть не поставить. Поставьте облик на всю вещь.": [
    "У моделі «{0}» немає файлу в описі Astral — вигляд на її частину не поставити. Поставте вигляд на всю річ.",
    "The model “{0}” has no file in the Astral inventory — a look can’t be set on its part. Set the look on the whole item.",
    "Das Modell „{0}“ hat keine Datei im Astral-Verzeichnis — ein Look lässt sich nicht auf seinen Teil setzen. Setze den Look auf den ganzen Gegenstand.",
    "Model „{0}” nie ma pliku w spisie Astral — wyglądu nie da się nadać jego części. Nadaj wygląd całemu przedmiotowi.",
  ],
  "Файл модели «{0}» не прочитался — подключите GTA V и нажмите «Применить» ещё раз.": [
    "Файл моделі «{0}» не прочитався — підключіть GTA V і натисніть «Застосувати» ще раз.",
    "The model file “{0}” could not be read — connect GTA V and press “Apply” again.",
    "Die Modelldatei „{0}“ ließ sich nicht lesen — verbinde GTA V und drücke noch einmal „Anwenden“.",
    "Nie udało się odczytać pliku modelu „{0}” — połącz GTA V i naciśnij „Zastosuj” jeszcze raz.",
  ],
  "Части «{0}» нет в модели «{1}»: файл игры другой версии — выберите часть ещё раз.": [
    "Частини «{0}» немає в моделі «{1}»: файл гри іншої версії — виберіть частину ще раз.",
    "The part “{0}” is not in the model “{1}”: the game file is a different version — pick the part again.",
    "Der Teil „{0}“ fehlt im Modell „{1}“: Die Spieldatei hat eine andere Version — wähle den Teil noch einmal.",
    "Części „{0}” nie ma w modelu „{1}”: plik gry jest w innej wersji — wybierz część jeszcze raz.",
  ],
  "У части «{0}» слишком подробная сетка для своего облика.": [
    "У частини «{0}» надто детальна сітка для власного вигляду.",
    "The part “{0}” has too detailed a mesh for a custom look.",
    "Der Teil „{0}“ hat ein zu detailliertes Netz für einen eigenen Look.",
    "Część „{0}” ma zbyt szczegółową siatkę na własny wygląd.",
  ],
  "«{0}»: картинка не пришла — нажмите «Применить» ещё раз.": [
    "«{0}»: картинка не надійшла — натисніть «Застосувати» ще раз.",
    "“{0}”: the picture did not arrive — press “Apply” again.",
    "„{0}“: Das Bild ist nicht angekommen — drücke noch einmal „Anwenden“.",
    "„{0}”: obraz nie dotarł — naciśnij „Zastosuj” jeszcze raz.",
  ],
  /* Окно: «Цвет» на часть, которой нет в сцене кадра (`arena-editor/arena-item-looks.js`, `colourLook`). */
  "Этой части нет в кадре — цвет ей не задать.": [
    "Цієї частини немає в кадрі — колір їй не задати.",
    "This part is not in the view — it can’t be given a colour.",
    "Dieser Teil ist nicht im Bild — ihm lässt sich keine Farbe geben.",
    "Tej części nie ma w kadrze — nie da się nadać jej koloru.",
  ],
  "Облик частей не сел в модель «{0}».": [
    "Вигляд частин не ліг у модель «{0}».",
    "The look of the parts did not fit into the model “{0}”.",
    "Der Look der Teile hat nicht ins Modell „{0}“ gepasst.",
    "Wygląd części nie wszedł do modelu „{0}”.",
  ],
  /* Подсказки «?» в колонках «Зон каптов» и «Билбордов» (обход 29.10.2026): целыми фразами — склейка кусков не переводилась. */
  "Цвет ляжет на все {0} сразу.": [
    "Колір ляже на всі {0} одразу.",
    "The colour goes on all {0} at once.",
    "Die Farbe landet auf allen {0} auf einmal.",
    "Kolor trafi na wszystkie {0} naraz.",
  ],
  "И на зону со своим цветом: {0}.": [
    "І на зону з власним кольором: {0}.",
    "Also on the zone with its own colour: {0}.",
    "Auch auf die Zone mit eigener Farbe: {0}.",
    "Także na strefę z własnym kolorem: {0}.",
  ],
  "И на зоны со своим цветом: {0}.": [
    "І на зони з власним кольором: {0}.",
    "Also on the zones with their own colour: {0}.",
    "Auch auf die Zonen mit eigener Farbe: {0}.",
    "Także na strefy z własnym kolorem: {0}.",
  ],
  "У мода — оранжевый, у Муравейника краснее. Свой цвет одной зоны — выберите её в списке или над кадром.": [
    "У мода — помаранчевий, у Мурашника червоніший. Власний колір однієї зони — оберіть її в списку або над кадром.",
    "The mod’s is orange, the Anthill’s is redder. Your own colour for one zone — pick it in the list or above the frame.",
    "Beim Mod ist sie orange, beim Ameisenhügel röter. Eigene Farbe einer Zone — wählen Sie sie in der Liste oder über dem Bild.",
    "W modzie jest pomarańczowy, w Mrowisku bardziej czerwony. Własny kolor jednej strefy — wybierz ją na liście lub nad kadrem.",
  ],
  "{0}. Свой цвет ляжет только на эту зону — поверх общего.": [
    "{0}. Власний колір ляже лише на цю зону — поверх загального.",
    "{0}. Your own colour lands only on this zone — over the shared one.",
    "{0}. Eigene Farbe gilt nur für diese Zone — über der gemeinsamen.",
    "{0}. Własny kolor trafi tylko na tę strefę — ponad wspólnym.",
  ],
  "0 % — сплошной цвет, 100 % — зоны не видно. У мода — {0}, у Муравейника гуще.": [
    "0 % — суцільний колір, 100 % — зони не видно. У мода — {0}, у Мурашника густіше.",
    "0 % — solid colour, 100 % — the zones are invisible. The mod’s is {0}, the Anthill’s is denser.",
    "0 % — volle Farbe, 100 % — die Zonen sind nicht zu sehen. Beim Mod — {0}, beim Ameisenhügel dichter.",
    "0 % — pełny kolor, 100 % — stref nie widać. W modzie — {0}, w Mrowisku gęściej.",
  ],
  "Насколько ярко зоны светятся сами — днём и особенно ночью; у всех зон одно. У мода — {0}. 0 — без свечения: стенка станет тёмной дымкой.": [
    "Наскільки яскраво зони світяться самі — вдень і особливо вночі; у всіх зон однаково. У мода — {0}. 0 — без світіння: стінка стане темною імлою.",
    "How brightly the zones glow on their own — by day and especially at night; all zones share one value. The mod’s is {0}. 0 — no glow: the wall becomes a dark haze.",
    "Wie stark die Zonen von selbst leuchten — tagsüber und besonders nachts; bei allen Zonen gleich. Beim Mod — {0}. 0 — ohne Leuchten: Die Wand wird zu einem dunklen Dunst.",
    "Jak mocno strefy świecą same z siebie — w dzień i zwłaszcza w nocy; wszystkie strefy mają jedną wartość. W modzie — {0}. 0 — bez świecenia: ściana stanie się ciemną mgiełką.",
  ],
  "Доля высоты мода, у всех зон сразу: у зоны «{0}» верх стенки — {1} над серединой (у мода {2}). Под землёй стенка остаётся модовой — на склонах и в низинах край виден от любой точки земли.": [
    "Частка висоти мода, у всіх зон одразу: у зони «{0}» верх стінки — {1} над серединою (у мода {2}). Під землею стінка лишається модовою — на схилах і в низинах край видно з будь-якої точки землі.",
    "Share of the mod’s height, for all zones at once: the top of the wall of zone “{0}” is {1} above the centre (the mod’s is {2}). Underground the wall stays the mod’s — on slopes and in hollows the edge is visible from any point on the ground.",
    "Anteil der Modhöhe, bei allen Zonen gleichzeitig: Bei Zone „{0}“ liegt die Oberkante der Wand {1} über der Mitte (beim Mod {2}). Unter der Erde bleibt die Wand modgetreu — an Hängen und in Senken ist der Rand von jedem Punkt des Bodens aus zu sehen.",
    "Udział wysokości moda, dla wszystkich stref naraz: u strefy „{0}” górna krawędź ściany jest {1} nad środkiem (w modzie {2}). Pod ziemią ściana zostaje modowa — na zboczach i w zagłębieniach krawędź widać z każdego punktu ziemi.",
  ],
  "{0}. Сейчас — {1}.": [
    "{0}. Наразі — {1}.",
    "{0}. Now — {1}.",
    "{0}. Derzeit — {1}.",
    "{0}. Obecnie — {1}.",
  ],
  "На щите — облик «Всех щитов»: {0}. Включите «Свой облик», чтобы поставить сюда свою картинку.": [
    "На щиті — вигляд «Усіх щитів»: {0}. Увімкніть «Власний вигляд», щоб поставити сюди власну картинку.",
    "On the billboard — the look of “All billboards”: {0}. Turn on “Custom look” to put your own image here.",
    "Auf dem Billboard — das Erscheinungsbild „Alle Billboards“: {0}. Aktivieren Sie „Eigenes Erscheinungsbild“, um hier Ihr eigenes Bild einzusetzen.",
    "Na billboardzie — wygląd „Wszystkich billboardów”: {0}. Włącz „Własny wygląd”, aby wstawić tu własny obraz.",
  ],
  "Щиты со своим обликом ({0}) остаются своими.": [
    "Щити з власним виглядом ({0}) лишаються своїми.",
    "Billboards with their own look ({0}) keep it.",
    "Billboards mit eigenem Erscheinungsbild ({0}) behalten es.",
    "Billboardy z własnym wyglądem ({0}) zostają przy swoim.",
  ],
};
