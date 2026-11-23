/*
 * Слово окна при частичном перекрытии в режиме GTA 5 RP (22.11.2026, задача Б ведущей, слово владельца: «начни чинить дефекты и вообще все»): вещь каталога встала, а прежняя работа на том же месте осталась, потому что в ней
 * есть файлы, которых нет в новой. Одна фраза после «установлен — …» (`features/downloads/newest-wins.js`, `hostStandingNote`, поле итога `hostStanding`). Обращение — как у соседних слов режима: ru/uk/fr на «вы»,
 * de — на «du», pl — повелительное на «ty». «{0}» и «{1}» — слова окна, а не вписанные руками: раздел «Библиотека» (`LibraryShelves.jsx`, `tr("Библиотека")`) и кнопка корзины в её шапке «Удалить выделенное» (`LibraryTrashBar.jsx`, перевод — `zone-library-v2.js`). Русская строка → [uk, en, de, pl]; французский — `fr/zone-host-standing-2211.js`.
 */
export const zoneHostStanding2211 = {
  "Прежняя работа на этом месте осталась: в ней есть файлы, которых нет в новой. Чтобы осталась одна, выделите прежнюю в разделе «{0}» и нажмите «{1}».": [
    "Попередня робота на цьому місці залишилась: у ній є файли, яких немає в новій. Щоб залишилась одна, виділіть попередню в розділі «{0}» і натисніть «{1}».",
    "The earlier work in this spot is still there: it has files the new one doesn't. To keep just one, select the earlier one in the {0} section and press “{1}”.",
    "Die frühere Arbeit an dieser Stelle ist noch vorhanden: In ihr gibt es Dateien, die in der neuen fehlen. Damit nur eine übrig bleibt, markiere die frühere im Bereich „{0}“ und klicke auf „{1}“.",
    "Poprzednia praca w tym miejscu nadal jest: ma pliki, których nie ma w nowej. Aby została jedna, zaznacz poprzednią w sekcji „{0}” i naciśnij „{1}”.",
  ],
};
