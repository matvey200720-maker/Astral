/*
 * Зона «Обход мастерской: оружие и эффекты», 15.11.2026 (S1): строки раздела, у которых в словаре не было перевода,
 * потому что текст в коде поменяли, а запись словаря осталась прежней (или не заводилась вовсе).
 * Французский — `fr/zone-s1-sweep-1511.js`. Русская строка → [uk, en, de, pl].
 */

export const zoneS1Sweep1511 = {
  /* «Прицел» → вариант на оружие: пустой результат поиска (в словаре стоял другой пример — «carbine, sniper»). */
  "Ничего не нашлось — попробуйте по-английски: carbine, mk2.": [
    "Нічого не знайдено — спробуйте англійською: carbine, mk2.",
    "Nothing found — try English: carbine, mk2.",
    "Nichts gefunden — versuchen Sie es auf Englisch: carbine, mk2.",
    "Nic nie znaleziono — spróbuj po angielsku: carbine, mk2.",
  ],
  /* Студия оружия, «Вид»: кнопка под списком моделей (в словаре были только «Показать ещё» и «Показать ещё ·»). */
  "Показать ещё · {N}": ["Показати ще · {N}", "Show more · {N}", "Mehr anzeigen · {N}", "Pokaż więcej · {N}"],
  /* Студия оружия, «Готовые»: кнопка «Стандарт» стала «Как в игре», запись словаря осталась со «Стандартом». */
  "Ствол как в игре одним шагом: покраска, узоры, наклейки и потёртость снимаются. Скин сейчас стоит в игре — после «Как в игре» «Применить» снимет его, и в игре снова заводской ствол.": [
    "Ствол як у грі одним кроком: фарбування, візерунки, наклейки і потертість знімаються. Скін зараз стоїть у грі — після «Як у грі» «Застосувати» зніме його, і в грі знову заводський ствол.",
    "The weapon as in the game in one step: paint, patterns, stickers and wear are removed. A skin is installed in the game now — after “As in the game”, “Apply” will remove it and the game will show the factory weapon again.",
    "Die Waffe wie im Spiel mit einem Schritt: Lackierung, Muster, Sticker und Abnutzung werden entfernt. Ein Skin ist jetzt im Spiel installiert — nach „Wie im Spiel“ entfernt „Anwenden“ ihn, und im Spiel erscheint wieder die Werksversion.",
    "Broń jak w grze jednym krokiem: malowanie, wzory, naklejki i zużycie są zdejmowane. Skin jest teraz zainstalowany w grze — po „Jak w grze” „Zastosuj” go zdejmie i w grze znów będzie fabryczna broń.",
  ],
  /* «Полоска HP»: подсказка инструмента «Вид» (без записи в словаре с 11.10) и уведомление после «Сбросить всё». */
  "По умолчанию — как в игре: белая полоска при наведении. Выберите вид — кадр покажет его над игроками": [
    "За замовчуванням — як у грі: біла смужка при наведенні. Оберіть вигляд — кадр покаже його над гравцями",
    "By default — as in the game: a white bar on aim. Pick a style — the frame shows it above the players",
    "Standard — wie im Spiel: eine weiße Leiste beim Anvisieren. Wählen Sie einen Stil — das Bild zeigt ihn über den Spielern",
    "Domyślnie — jak w grze: biały pasek po namierzeniu. Wybierz wygląd — kadr pokaże go nad graczami",
  ],
  "Работа с начала: полоска как в игре": [
    "Робота з початку: смужка як у грі",
    "Work from scratch: bar as in the game",
    "Arbeit von vorn: Leiste wie im Spiel",
    "Praca od nowa: pasek jak w grze",
  ],
  /* «Прострелы»: подсказка инструмента «Укрытие»; 30.10 к тексту дописали «или строкой списка», запись словаря осталась прежней. */
  "Укрытие выбирают над кадром, плиткой «Все укрытия» или строкой списка; своя подсветка — только у него": [
    "Укриття обирають над кадром, плиткою «Усі укриття» або рядком списку; власна підсвітка — лише в нього",
    "A cover is picked above the preview, with the «All covers» tile or a list row; its own glow — only for it",
    "Eine Deckung wählt man über der Vorschau, mit der Kachel «Alle Deckungen» oder per Listenzeile; eigene Beleuchtung — nur bei ihr",
    "Osłonę wybiera się nad podglądem, kafelkiem «Wszystkie osłony» lub wierszem listy; własne podświetlenie — tylko dla niej",
  ],
  /* «Настройка автомобиля»: под кадром «Дым в кадре не собрался: машина игры не разобралась: <причина>»; слой разметки переводит каждую фразу до двоеточия. */
  "машина игры не разобралась": [
    "машину гри не вдалося розібрати",
    "the game's car could not be parsed",
    "das Auto aus dem Spiel konnte nicht gelesen werden",
    "nie udało się odczytać samochodu z gry",
  ],
  /* Студия ганпаков: отказы съёмки и коллажа показывает плашка «Не получилось» через `tr(studio.error)`. */
  "Рендер ствола дал пустой кадр (потерян контекст WebGL) на всех трёх ступенях качества.": [
    "Рендер ствола дав порожній кадр (втрачено контекст WebGL) на всіх трьох ступенях якості.",
    "The weapon render came out blank (WebGL context lost) at all three quality levels.",
    "Das Rendering der Waffe war leer (WebGL-Kontext verloren) auf allen drei Qualitätsstufen.",
    "Renderowanie broni dało pusty kadr (utracono kontekst WebGL) na wszystkich trzech poziomach jakości.",
  ],
  "На кадрах стволов нет ни одного ствола: рендер дал пустые листы.": [
    "На кадрах немає жодного ствола: рендер дав порожні аркуші.",
    "No weapon is visible in the frames: the render produced blank sheets.",
    "Auf den Bildern ist keine Waffe zu sehen: Das Rendering hat leere Blätter geliefert.",
    "Na kadrach nie ma żadnej broni: renderowanie dało puste arkusze.",
  ],
};
