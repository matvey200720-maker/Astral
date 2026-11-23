/*
 * Отказы установки арены по вещам зала (06.11.2026): сетка «Цвета» вещи испорчена в хранилище окна и вещь, которую хост не соберёт (дальше 39 м от оси).
 * Главный процесс отдаёт слова русскими (`apps/desktop/src/recolor-place-models.js`, `recolor-arenas.js`), слой перевода разметки переводит их на экране.
 * Русская строка → [uk, en, de, pl]. Шаблоны с `{n}` — по ключу.
 */

export const zoneArenaItemReach0611 = {
  "«{0}»: сетка модели повреждена в хранилище окна — поставьте эту модель или цвет в редакторе заново.": [
    "«{0}»: сітка моделі пошкоджена в сховищі вікна — поставте цю модель або колір у редакторі заново.",
    "“{0}”: the model mesh is damaged in the window storage — set this model or colour in the editor again.",
    "„{0}“: Das Netz des Modells ist im Fensterspeicher beschädigt — setze dieses Modell oder diese Farbe im Editor neu.",
    "„{0}”: siatka modelu jest uszkodzona w pamięci okna — ustaw ten model lub kolor w edytorze od nowa.",
  ],
  "«{0}»: вещь уходит от своей оси дальше {1} м (до {2} м) — установщик не соберёт для неё копию. Верните её к игре и нажмите «Применить» ещё раз.": [
    "«{0}»: річ відходить від своєї осі далі ніж на {1} м (до {2} м) — інсталятор не збере для неї копію. Поверніть її до гри та натисніть «Застосувати» ще раз.",
    "“{0}”: the item extends more than {1} m from its axis (up to {2} m) — the installer can’t build a copy of it. Return it to the game look and press “Apply” again.",
    "„{0}“: Der Gegenstand reicht mehr als {1} m von seiner Achse weg (bis {2} m) — der Installer kann dafür keine Kopie bauen. Setze ihn auf den Spiel-Look zurück und drücke noch einmal „Anwenden“.",
    "„{0}”: przedmiot sięga dalej niż {1} m od swojej osi (do {2} m) — instalator nie zbuduje dla niego kopii. Przywróć go do wyglądu z gry i naciśnij „Zastosuj” jeszcze raz.",
  ],
};
