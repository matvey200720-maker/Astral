/*
 * Слова отказов чтения модели вещи игры (22.11.2026, пустой предпросмотр одежды в Astral 1.0.0): карточка «Модель не открылась» (`components/desktop/workshop/gun/model-failure.js`)
 * показывает слова главного процесса через словарь — раньше четыре из них (нет сетки, нет расцветки, место без модели, модель без вершин) на других языках оставались русскими.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-game-model-refusals-2211.js`.
 */
export const zoneGameModelRefusals2211 = {
  "Модель этой вещи пока не удалось прочитать из игры.": [
    "Модель цієї речі поки не вдалося прочитати з гри.",
    "This item's model could not be read from the game yet.",
    "Das Modell dieses Teils konnte noch nicht aus dem Spiel gelesen werden.",
    "Modelu tego elementu nie udało się jeszcze odczytać z gry.",
  ],
  "У этой вещи в игре нет модели — только место под неё.": [
    "У цієї речі в грі немає моделі — лише місце під неї.",
    "This item has no model in the game — only a slot for one.",
    "Dieses Teil hat im Spiel kein Modell — nur einen Platz dafür.",
    "Ten element nie ma w grze modelu — jest tylko miejsce na niego.",
  ],
  "У этой вещи в игре не нашлось расцветки.": [
    "У цієї речі в грі не знайшлося розфарбування.",
    "No colour variant was found for this item in the game.",
    "Für dieses Teil wurde im Spiel keine Farbvariante gefunden.",
    "Nie znaleziono wariantu kolorystycznego tego elementu w grze.",
  ],
  "В модели вещи нет сетки.": [
    "У моделі речі немає сітки.",
    "The item's model has no mesh.",
    "Das Modell des Teils enthält kein Mesh.",
    "Model elementu nie ma siatki.",
  ],
};
