/*
 * Фразы большой карты, 13.10.2026 (оптимизация, помощник «карта»): вес карты в
 * видеопамяти у «Чёткости при приближении» — оценка, предупреждение и кнопка.
 * Русская строка → [uk, en, de, pl]. Метки `{size}`, `{stock}` подставляет
 * `mapText` (`world-map/map-copy.js`).
 */

export const zoneOpt1310Map = {
  "В игре карта займёт около {size} МБ видеопамяти (штатная — {stock} МБ).": [
    "У грі карта займе близько {size} МБ відеопам’яті (штатна — {stock} МБ).",
    "In the game the map will take about {size} MB of video memory (the stock map — {stock} MB).",
    "Im Spiel belegt die Karte etwa {size} MB Grafikspeicher (die Originalkarte — {stock} MB).",
    "W grze mapa zajmie około {size} MB pamięci graficznej (oryginalna — {stock} MB).",
  ],
  "Оценка по штатным плиткам игры: игра ещё не прочитана.": [
    "Оцінка за штатними плитками гри: гру ще не прочитано.",
    "An estimate from the game's stock tiles: the game has not been read yet.",
    "Eine Schätzung nach den Originalkacheln des Spiels: das Spiel wurde noch nicht gelesen.",
    "Szacunek według oryginalnych kafelków gry: gra nie została jeszcze odczytana.",
  ],
  "На слабых видеокартах карта в игре может подтормаживать при движении и приближении.": [
    "На слабких відеокартах карта в грі може підгальмовувати під час руху та наближення.",
    "On weaker graphics cards the map in the game may stutter when moving and zooming.",
    "Auf schwächeren Grafikkarten kann die Karte im Spiel beim Bewegen und Zoomen ruckeln.",
    "Na słabszych kartach graficznych mapa w grze może się przycinać podczas ruchu i przybliżania.",
  ],
  "Поставить «Чётко»": [
    "Поставити «Чітко»",
    "Set “Sharp”",
    "„Scharf“ wählen",
    "Ustaw „Ostro”",
  ],
};
