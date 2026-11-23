/*
 * Хелпер 14, 25.10.2026: «На что поставить?» картинками — сетка вещей сервера (`components/desktop/clothing/ClothingItemGrid.jsx`).
 * Русская строка → [uk, en, de, pl].
 */

export const zoneH14Clothing = {
  /* Разделы «На что поставить?» — виды вещи (`cross-sections.js`, `COMPONENTS` пакета одежды). */
  "другой вид": ["інший вид", "other kind", "andere Art", "inny rodzaj"],
  "Причёска": ["Зачіска", "Hairstyle", "Frisur", "Fryzura"],
  "Сумка или рюкзак": ["Сумка або рюкзак", "Bag or backpack", "Tasche oder Rucksack", "Torba lub plecak"],
  "Аксессуар на шею": ["Аксесуар на шию", "Neck accessory", "Halsaccessoire", "Dodatek na szyję"],
  "Нижний слой": ["Нижній шар", "Undershirt layer", "Unterste Schicht", "Dolna warstwa"],
  "Нашивка": ["Нашивка", "Patch", "Aufnäher", "Naszywka"],
  "Рот": ["Рот", "Mouth", "Mund", "Usta"],
  "Браслет": ["Браслет", "Bracelet", "Armband", "Bransoleta"],
  "Пояс": ["Пояс", "Belt", "Gürtel", "Pas"],
  /* Кадр «На персонаже» в карточке мода одежды (`mod-card/OnModelFrame.jsx`). */
  "На персонаже": ["На персонажі", "On the character", "Am Charakter", "Na postaci"],
  "Собираем персонажа из вашей игры…": [
    "Збираємо персонажа з вашої гри…",
    "Building the character from your game…",
    "Der Charakter wird aus deinem Spiel gebaut…",
    "Składamy postać z twojej gry…",
  ],
  "советуем": ["радимо", "suggested", "empfohlen", "polecamy"],
  "занята": ["зайнята", "taken", "belegt", "zajęta"],
  "Станет вещью": ["Стане річчю", "Will become", "Wird zu", "Stanie się"],
  "Все магазины": ["Усі магазини", "All shops", "Alle Geschäfte", "Wszystkie sklepy"],
  "Найдено · {count}": ["Знайдено · {count}", "Found · {count}", "Gefunden · {count}", "Znaleziono · {count}"],
  "{server} · {count}": ["{server} · {count}", "{server} · {count}", "{server} · {count}", "{server} · {count}"],
  "Вещи сервера": ["Речі сервера", "Server items", "Server-Items", "Rzeczy serwera"],
  "Спрятано вещей другого кроя: {count}": [
    "Приховано речей іншого крою: {count}",
    "Items of a different cut hidden: {count}",
    "Ausgeblendete Teile anderen Schnitts: {count}",
    "Ukryto rzeczy innego kroju: {count}",
  ],
  "По запросу «{query}» вещей нет.": [
    "За запитом «{query}» речей немає.",
    "No items match “{query}”.",
    "Keine Treffer für „{query}“.",
    "Brak rzeczy dla „{query}”.",
  ],
  /* «Сделать заменёнку» и «Какой цвет будет виден в игре» (`ClothingInstallDialog.jsx`, `ColourMappingDialog.jsx`, 25.10.2026). */
  "Какой цвет будет виден в игре": ["Який колір буде видно в грі", "Which colour you will see in the game", "Welche Farbe im Spiel zu sehen ist", "Jaki kolor będzie widoczny w grze"],
  "Вы носите на сервере одну вещь, а в игре видна другая. Осталось решить, как сопоставить их цвета.": ["Ви носите на сервері одну річ, а в грі видно іншу. Лишилося вирішити, як зіставити їхні кольори.", "You wear one item on the server, but the game shows another. Now decide how their colours match.", "Auf dem Server trägst du ein Teil, im Spiel siehst du ein anderes. Jetzt noch festlegen, wie ihre Farben zugeordnet werden.", "Na serwerze nosisz jedną rzecz, a w grze widać inną. Zostało zdecydować, jak dopasować ich kolory."],
  "Вещь — носите на сервере": ["Річ — носите на сервері", "Item — what you wear on the server", "Teil — das trägst du auf dem Server", "Rzecz — nosisz na serwerze"],
  "Заменёнка — видите вместо неё": ["Заміна — бачите замість неї", "Replacement — what you see instead", "Ersatz — das siehst du stattdessen", "Zamiennik — widzisz zamiast niej"],
  "Как заменить цвета": ["Як замінити кольори", "How to replace the colours", "Wie die Farben ersetzt werden", "Jak zastąpić kolory"],
  "На всех цветах вещи": ["На всіх кольорах речі", "On every colour of the item", "Auf allen Farben des Teils", "Na wszystkich kolorach rzeczy"],
  "Какого бы цвета ни была вещь на вас — в игре видна заменёнка одного цвета": ["Якого б кольору не була річ на вас — у грі видно заміну одного кольору", "Whatever colour the item is on you, the game shows the replacement in one colour", "Egal welche Farbe das Teil an dir hat — im Spiel siehst du den Ersatz in einer Farbe", "Jakiego koloru by nie była rzecz na tobie — w grze widać zamiennik w jednym kolorze"],
  "Цвет в цвет": ["Колір у колір", "Colour to colour", "Farbe zu Farbe", "Kolor w kolor"],
  "У каждого цвета вещи свой цвет заменёнки, по порядку": ["У кожного кольору речі свій колір заміни, по порядку", "Each colour of the item gets its own replacement colour, in order", "Jede Farbe des Teils bekommt ihre eigene Ersatzfarbe, der Reihe nach", "Każdy kolor rzeczy dostaje własny kolor zamiennika, po kolei"],
  "Проверьте": ["Перевірте", "Check", "Prüfen", "Sprawdź"],
  "Проверьте: слева цвет вещи, справа — что увидите": ["Перевірте: ліворуч колір речі, праворуч — що побачите", "Check: item colour on the left, what you will see on the right", "Prüfen: links die Farbe des Teils, rechts das, was du siehst", "Sprawdź: po lewej kolor rzeczy, po prawej — co zobaczysz"],
  "нажмите на пару, чтобы поменять": ["натисніть на пару, щоб змінити", "click a pair to change it", "Paar anklicken, um zu ändern", "kliknij parę, aby zmienić"],
  "Цвет {n}": ["Колір {n}", "Colour {n}", "Farbe {n}", "Kolor {n}"],
  "Цвет заменёнки": ["Колір заміни", "Replacement colour", "Ersatzfarbe", "Kolor zamiennika"],
  "Цвет заменёнки на всех цветах вещи": ["Колір заміни на всіх кольорах речі", "Replacement colour on every colour of the item", "Ersatzfarbe auf allen Farben des Teils", "Kolor zamiennika na wszystkich kolorach rzeczy"],
  "Цвет заменёнки для цвета {n} вещи": ["Колір заміни для кольору {n} речі", "Replacement colour for colour {n} of the item", "Ersatzfarbe für Farbe {n} des Teils", "Kolor zamiennika dla koloru {n} rzeczy"],
  "Все {count} {word} вещи станут цветом «{name}»": ["Усі {count} {word} речі стануть кольором «{name}»", "All {count} {word} of the item become “{name}”", "Alle {count} {word} des Teils werden zu „{name}“", "Wszystkie {count} {word} rzeczy staną się kolorem „{name}”"],
  "{paired} из {total} цветов вещи получат свой цвет заменёнки, остальные — «{name}»": ["{paired} з {total} кольорів речі отримають свій колір заміни, решта — «{name}»", "{paired} of {total} item colours get their own replacement colour, the rest get “{name}”", "{paired} von {total} Farben des Teils bekommen ihre Ersatzfarbe, der Rest „{name}“", "{paired} z {total} kolorów rzeczy dostanie własny kolor zamiennika, reszta — „{name}”"],
  "Заменятся все {count} {word} вещи, у каждого свой цвет заменёнки": ["Замінимо всі {count} {word} речі, у кожного свій колір заміни", "All {count} {word} of the item are replaced, each with its own replacement colour", "Alle {count} {word} des Teils werden ersetzt, jede mit eigener Ersatzfarbe", "Zastąpimy wszystkie {count} {word} rzeczy, każdy ma własny kolor zamiennika"],
  "Сделать заменёнку": ["Зробити заміну", "Make the replacement", "Ersatz erstellen", "Zrób zamiennik"],
  "Цвета мода": ["Кольори мода", "Mod colours", "Farben des Mods", "Kolory modu"],
  "Нажмите на вещь — она покажется слева рядом с модой": ["Натисніть на річ — вона з’явиться ліворуч поруч із модом", "Click an item — it appears on the left next to the mod", "Teil anklicken — es erscheint links neben dem Mod", "Kliknij rzecz — pojawi się po lewej obok modu"],
  "На вещи стоит заменёнка «{mod}»": ["На речі стоїть заміна «{mod}»", "A replacement is set on this item: “{mod}”", "Auf diesem Teil liegt ein Ersatz: „{mod}“", "Na tej rzeczy stoi zamiennik: „{mod}”"],
  "На вещи стоит заменёнка": ["На речі стоїть заміна", "A replacement is set on this item", "Auf diesem Teil liegt ein Ersatz", "Na tej rzeczy stoi zamiennik"],
  /* Подпись плитки-пары в «Библиотеке»: «вместо «вещь» | в игре» (`clothing-placements.js`). */
  "вместо «{item}»": ["замість «{item}»", "instead of “{item}”", "statt „{item}“", "zamiast „{item}”"],
};
