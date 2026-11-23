/*
 * Экран «Ганпак» мастерской оружия, 02.11.2026.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-gun-pack-0211.js`.
 */
export const zoneGunPack0211 = {
  "Стволы пака": ["Стволи пака", "Pack guns", "Waffen im Pack", "Bronie w paczce"],
  "Здесь все стволы пака: щёлкните ствол, чтобы открыть его редактор": [
    "Тут усі стволи пака: клацніть ствол, щоб відкрити його редактор",
    "All the pack's guns are here: click a gun to open its editor",
    "Hier sind alle Waffen des Packs: Klicke auf eine Waffe, um ihren Editor zu öffnen",
    "Tu są wszystkie bronie z paczki: kliknij broń, aby otworzyć jej edytor",
  ],
  "Стволы ганпака": ["Стволи ганпака", "Gunpack guns", "Waffen im Gunpack", "Bronie w gunpacku"],
  "В ганпаке пока нет стволов": ["У ганпаку поки немає стволів", "No guns in the gunpack yet", "Noch keine Waffen im Gunpack", "W gunpacku nie ma jeszcze broni"],
  "стволов пока нет": ["стволів поки немає", "no guns yet", "noch keine Waffen", "brak broni"],
  "Добавить оружие": ["Додати зброю", "Add weapon", "Waffe hinzufügen", "Dodaj broń"],
  "Сначала добавьте оружие": ["Спершу додайте зброю", "Add a weapon first", "Füge zuerst eine Waffe hinzu", "Najpierw dodaj broń"],
  "уже в ганпаке": ["вже в ганпаку", "already in the gunpack", "schon im Gunpack", "już w gunpacku"],
  "Убрать из ганпака": ["Прибрати з ганпака", "Remove from the gunpack", "Aus dem Gunpack entfernen", "Usuń z gunpacka"],
  "Поставить ганпак": ["Поставити ганпак", "Install gunpack", "Gunpack installieren", "Zainstaluj gunpack"],
  "Ставлю {done} из {total}…": ["Ставлю {done} із {total}…", "Installing {done} of {total}…", "Installiere {done} von {total}…", "Instaluję {done} z {total}…"],
  "Все стволы с правками встанут в игру": [
    "Усі стволи з правками стануть у гру",
    "All edited guns will go into the game",
    "Alle bearbeiteten Waffen kommen ins Spiel",
    "Wszystkie bronie ze zmianami trafią do gry",
  ],
  "Нет стволов с правками: щёлкните ствол и покрасьте его": [
    "Немає стволів із правками: клацніть ствол і пофарбуйте його",
    "No edited guns: click a gun and paint it",
    "Keine bearbeiteten Waffen: Klicke auf eine Waffe und bemale sie",
    "Brak broni ze zmianami: kliknij broń i pomaluj ją",
  ],
  "В очередь встали: {list}": ["У чергу стали: {list}", "Queued: {list}", "In der Warteschlange: {list}", "W kolejce: {list}"],
  "Не встали: {list}": ["Не стали: {list}", "Not queued: {list}", "Nicht eingereiht: {list}", "Nie dodano: {list}"],
  "{name}: {reason}": ["{name}: {reason}", "{name}: {reason}", "{name}: {reason}", "{name}: {reason}"],
  "не встала в очередь": ["не стала в чергу", "was not queued", "wurde nicht eingereiht", "nie trafiła do kolejki"],
  "Щелчок по стволу": ["Клік по стволу", "Click a gun", "Klick auf eine Waffe", "Kliknięcie broni"],
  "открыть редактор": ["відкрити редактор", "open the editor", "Editor öffnen", "otwórz edytor"],
  "Загружаю модель…": ["Завантажую модель…", "Loading the model…", "Modell wird geladen…", "Wczytuję model…"],
  "Загружаю модели…": ["Завантажую моделі…", "Loading models…", "Modelle werden geladen…", "Wczytuję modele…"],
  "есть правки": ["є правки", "edited", "bearbeitet", "ze zmianami"],
  "Кадр не открылся": ["Кадр не відкрився", "The view did not open", "Die Ansicht wurde nicht geöffnet", "Widok się nie otworzył"],
  /* Правки уходят в ганпак сами; «Откатить» в «⋯» редактора ствола, 03.11.2026. */
  "Ствол снова стандартный — Ctrl+Z вернёт всё обратно": [
    "Ствол знову стандартний — Ctrl+Z поверне все назад",
    "The gun is stock again — Ctrl+Z will bring everything back",
    "Die Waffe ist wieder Standard — Strg+Z stellt alles wieder her",
    "Broń znów jest standardowa — Ctrl+Z przywróci wszystko",
  ],
  /* Слои и детали — тем же списком, что стволы ганпака (`LayerList`), «+ Слой» — меню, 04.11.2026. */
  "Роспись": ["Розпис", "Painting", "Bemalung", "Malowanie"],
  "скрыт": ["прихований", "hidden", "ausgeblendet", "ukryty"],
  "скрыта": ["прихована", "hidden", "ausgeblendet", "ukryta"],
  "скрыто": ["приховано", "hidden", "ausgeblendet", "ukryte"],
  "обтравка": ["обтравка", "clipped", "Schnittmaske", "przycięcie"],
  /* «Стандарт» → «Как в игре» у отката к игре (п. 15 design-qa.md), 04.11.2026. */
  "Как в игре: снять все украшения — в игре ствол без них": [
    "Як у грі: зняти всі прикраси — у грі ствол без них",
    "As in the game: remove all decorations — the weapon in the game has none",
    "Wie im Spiel: alle Verzierungen entfernen — die Waffe im Spiel hat keine",
    "Jak w grze: zdejmij wszystkie ozdoby — broń w grze nie ma ich",
  ],
  "Как в игре: снять {skin} из игры — в игре снова заводской {one}": [
    "Як у грі: зняти {skin} з гри — у грі знову заводський {one}",
    "As in the game: remove the {skin} from the game — the game shows the factory {one} again",
    "Wie im Spiel: {skin} aus dem Spiel entfernen — im Spiel ist wieder {one} im Originalzustand",
    "Jak w grze: zdejmij {skin} z gry — w grze znów jest {one} w wersji fabrycznej",
  ],
  "снимется при установке": ["зніметься під час встановлення", "will be removed on install", "wird bei der Installation entfernt", "zostanie zdjęty podczas instalacji"],
  "Стволы с правками встанут в игру, у откатанных скин снимется": [
    "Стволи з правками стануть у гру, у відкочених скін зніметься",
    "Edited guns will go into the game, rolled-back ones lose their skin",
    "Bearbeitete Waffen kommen ins Spiel, bei zurückgesetzten wird der Skin entfernt",
    "Bronie ze zmianami trafią do gry, u cofniętych skin zostanie zdjęty",
  ],
  "У откатанных стволов скин снимется из игры": [
    "У відкочених стволів скін зніметься з гри",
    "Rolled-back guns lose their skin in the game",
    "Bei zurückgesetzten Waffen wird der Skin aus dem Spiel entfernt",
    "U cofniętych broni skin zostanie zdjęty z gry",
  ],
  "Стволы можно открывать из списка справа.": [
    "Стволи можна відкривати зі списку праворуч.",
    "You can open guns from the list on the right.",
    "Waffen lassen sich über die Liste rechts öffnen.",
    "Broń można otwierać z listy po prawej.",
  ],
};
