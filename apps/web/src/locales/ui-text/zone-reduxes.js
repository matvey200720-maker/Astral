/*
 * Зона: reduxes. Словарь строк интерфейса: русская строка → [uk, en, de, pl].
 *
 * Части редукса в мастерской (`features/catalog/part-workshop.js`): почему
 * «Редактировать» не открывает часть, — и работы частей в очереди мастерской
 * (`features/workshop/works/catalog-work.js`). Словари по языку у плиток
 * «Что внутри» и сборки — в `pack-contents-copy.js` и `bundle-copy.js`.
 */

export const zoneReduxes = {
  "В файлах этой части нет того, что открывает мастерская.": [
    "У файлах цієї частини немає того, що відкриває майстерня.",
    "This part's files have nothing the workshop can open.",
    "In den Dateien dieses Teils gibt es nichts, was die Werkstatt öffnen kann.",
    "W plikach tej części nie ma niczego, co warsztat może otworzyć.",
  ],
  "У этой части нет пакета — открыть её в мастерской нечем.": [
    "У цієї частини немає пакета — відкрити її в майстерні нічим.",
    "This part has no package to open in the workshop.",
    "Dieser Teil hat kein Paket, das in der Werkstatt geöffnet werden kann.",
    "Ta część nie ma pakietu, który można otworzyć w warsztacie.",
  ],
  "Этот прицел нарисован не линиями, точкой и кольцом — редактор прицела его не повторит.":
    [
      "Цей приціл намальований не лініями, крапкою і кільцем — редактор прицілу його не повторить.",
      "This reticle isn't built from lines, a dot and a ring — the reticle editor can't rebuild it.",
      "Dieses Fadenkreuz besteht nicht aus Linien, Punkt und Ring — der Fadenkreuz-Editor kann es nicht nachbauen.",
      "Ten celownik nie składa się z linii, kropki i pierścienia — edytor celownika go nie odtworzy.",
    ],
  "Мини-карту этот мод не двигает: её строки в frontend.xml — как в игре, меняется другое (кнопки меню).":
    [
      "Цей мод не рухає мінікарту: її рядки у frontend.xml — як у грі, змінюється інше (кнопки меню).",
      "This mod doesn't move the minimap: its frontend.xml minimap lines are stock — it changes something else (menu buttons).",
      "Dieser Mod verschiebt die Minikarte nicht: Ihre Zeilen in frontend.xml sind wie im Spiel, geändert wird etwas anderes (Menütasten).",
      "Ten mod nie przesuwa minimapy: jej wiersze w frontend.xml są jak w grze, zmienia się coś innego (przyciski menu).",
    ],
  "Попадание этого мода — свои частицы автора: редактор попаданий их не повторит.":
    [
      "Влучання цього мода — власні частинки автора: редактор влучань їх не повторить.",
      "This mod's hit effect uses the author's own particles — the hit effect editor can't rebuild them.",
      "Der Treffereffekt dieses Mods nutzt eigene Partikel des Autors — der Treffer-Editor kann sie nicht nachbauen.",
      "Trafienie w tym modzie to własne cząsteczki autora — edytor trafień ich nie odtworzy.",
    ],
  "Эта часть — как в игре: её файл не отличается от штатного, менять в редакторе нечего.":
    [
      "Ця частина — як у грі: її файл не відрізняється від штатного, змінювати в редакторі нічого.",
      "This part is the same as the game: its file matches the stock one, there's nothing to edit.",
      "Dieser Teil ist wie im Spiel: Seine Datei entspricht der Originaldatei, im Editor gibt es nichts zu ändern.",
      "Ta część jest jak w grze: jej plik nie różni się od oryginalnego, w edytorze nie ma czego zmieniać.",
    ],
  "Звуки этого мода — у стволов, которых нет в мастерской звуков (тяжёлая винтовка из пакета дополнения): они остаются файлами мода.":
    [
      "Звуки цього мода — у стволів, яких немає в майстерні звуків (важка гвинтівка з пакета доповнення): вони лишаються файлами мода.",
      "This mod's sounds belong to weapons the sound workshop doesn't voice (the heavy rifle from a DLC pack): they stay as the mod's files.",
      "Die Sounds dieses Mods gehören zu Waffen, die die Sound-Werkstatt nicht vertont (das schwere Gewehr aus einem DLC-Paket): Sie bleiben Dateien des Mods.",
      "Dźwięki tego moda należą do broni, których warsztat dźwięków nie udźwiękawia (ciężki karabin z pakietu DLC): zostają plikami moda.",
    ],
  "Звук ещё загружается или недоступен: движок не запущен. Попробуйте открыть часть снова через минуту.": [
      "Звук ще завантажується або недоступний: рушій не запущено. Спробуйте відкрити частину знову за хвилину.",
      "The sound is still loading or unavailable: the engine is not running. Try opening the part again in a minute.",
      "Der Ton lädt noch oder ist nicht verfügbar: Die Engine läuft nicht. Öffnen Sie den Teil in einer Minute erneut.",
      "Dźwięk jeszcze się ładuje albo jest niedostępny: silnik nie działa. Otwórz część ponownie za minutę.",
    ],
  "Работа не встала в очередь.": [
    "Робота не стала в чергу.",
    "The work wasn't queued.",
    "Die Arbeit wurde nicht in die Warteschlange gestellt.",
    "Praca nie trafiła do kolejki.",
  ],
  "Рамка урона мода": [
    "Рамка урону мода",
    "Mod damage frame",
    "Schadensrahmen des Mods",
    "Ramka obrażeń moda",
  ],
  /* Подписи кадров, которые ставит разбор (`SERVER_CAPTIONS` в
     @modovik/publishing), — окно выводит их через `media-caption.js`. */
  "Превью обзора на YouTube": [
    "Прев'ю огляду на YouTube",
    "YouTube review preview",
    "Vorschau des YouTube-Reviews",
    "Podgląd recenzji na YouTube",
  ],
  "Кадр из поста автора": [
    "Кадр із посту автора",
    "Frame from the author's post",
    "Bild aus dem Beitrag des Autors",
    "Kadr z posta autora",
  ],
  "Рендер модели, не кадр из игры": [
    "Рендер моделі, не кадр із гри",
    "Model render, not an in-game frame",
    "Modell-Render, kein Spielbild",
    "Render modelu, nie kadr z gry",
  ],
  "Обложка-шаблон: кадра из игры пока нет": [
    "Обкладинка-шаблон: кадру з гри поки немає",
    "Template cover: no in-game frame yet",
    "Vorlagen-Cover: noch kein Spielbild",
    "Okładka-szablon: kadru z gry jeszcze nie ma",
  ],
  "Картинка из поста автора мода": [
    "Зображення з посту автора мода",
    "Image from the mod author's post",
    "Bild aus dem Beitrag des Mod-Autors",
    "Obraz z posta autora moda",
  ],
  "Где стоят объекты мода — по его картам, не кадр из игры": [
    "Де стоять об'єкти мода — за його картами, не кадр із гри",
    "Where the mod's objects stand — from its maps, not an in-game frame",
    "Wo die Objekte des Mods stehen — nach seinen Karten, kein Spielbild",
    "Gdzie stoją obiekty moda — według jego map, nie kadr z gry",
  ],
  "Постановочная сцена мастерской с текстурами мода — это не кадр из игры": [
    "Постановочна сцена майстерні з текстурами мода — це не кадр із гри",
    "A staged workshop scene with the mod's textures — not an in-game frame",
    "Eine gestellte Werkstatt-Szene mit den Texturen des Mods — kein Spielbild",
    "Inscenizowana scena warsztatu z teksturami moda — to nie kadr z gry",
  ],
  "Кадр из видео": [
    "Кадр із відео",
    "Frame from the video",
    "Standbild aus dem Video",
    "Klatka z wideo",
  ],
};
