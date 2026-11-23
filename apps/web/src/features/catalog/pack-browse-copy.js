// Подписи листания вещей пака одежды и звуков пака на шести языках.
//
// Данные разложены по ключам: одна запись — один ключ словаря и шесть значений
// в порядке PACK_BROWSE_LANGUAGES. Словари языков строятся одним обходом при
// первом обращении, а не при загрузке модуля: файл входит в стартовый кусок
// окна, поэтому на верхнем уровне только литералы, функции и одна заморозка.

export const PACK_BROWSE_LANGUAGES = Object.freeze(["ru", "uk", "en", "de", "pl", "fr"]);

// [ключ, способ сборки, значения по языкам]:
//   text     — готовая строка;
//   template — строка с метками {…}, из неё делается функция подстановки;
//   plural   — слова по категориям множественного числа платформы.
const VOCABULARY = [
  [
    "prevItem",
    "text",
    [
      "Предыдущая вещь пака",
      "Попередня річ паку",
      "Previous item in the pack",
      "Vorheriges Teil im Paket",
      "Poprzednia rzecz z paczki",
      "Élément précédent du pack",
    ],
  ],
  [
    "nextItem",
    "text",
    [
      "Следующая вещь пака",
      "Наступна річ паку",
      "Next item in the pack",
      "Nächstes Teil im Paket",
      "Następna rzecz z paczki",
      "Élément suivant du pack",
    ],
  ],
  [
    "position",
    "template",
    [
      "{index} из {count}",
      "{index} з {count}",
      "{index} of {count}",
      "{index} von {count}",
      "{index} z {count}",
      "{index} sur {count}",
    ],
  ],
  [
    "browseHint",
    "text",
    [
      "Стрелки ← → — другие вещи пака",
      "Стрілки ← → — інші речі паку",
      "Arrows ← → show the other items in the pack",
      "Pfeile ← → zeigen die anderen Teile im Paket",
      "Strzałki ← → pokazują inne rzeczy z paczki",
      "Flèches ← →\u00a0: autres éléments du pack",
    ],
  ],
  [
    "keys",
    "text",
    [
      "листать вещи пака",
      "гортати речі паку",
      "browse the pack’s items",
      "durch die Teile blättern",
      "przeglądaj rzeczy z paczki",
      "parcourir les éléments du pack",
    ],
  ],
  [
    "colour",
    "template",
    [
      "Цвет: {name}",
      "Колір: {name}",
      "Colour: {name}",
      "Farbe: {name}",
      "Kolor: {name}",
      "Couleur\u00a0: {name}",
    ],
  ],
  [
    "items",
    "plural",
    [
      { one: "вещь", few: "вещи", many: "вещей", other: "вещи" },
      { one: "річ", few: "речі", many: "речей", other: "речі" },
      { one: "item", other: "items" },
      { one: "Teil", other: "Teile" },
      { one: "rzecz", few: "rzeczy", many: "rzeczy", other: "rzeczy" },
      { one: "élément", many: "éléments", other: "éléments" },
    ],
  ],
  [
    "itemsTitle",
    "text",
    [
      "Вещи пака",
      "Речі паку",
      "Items in this pack",
      "Teile im Paket",
      "Rzeczy w paczce",
      "Éléments du pack",
    ],
  ],
  [
    "thumbs",
    "text",
    [
      "Все вещи пака",
      "Усі речі паку",
      "All items in the pack",
      "Alle Teile im Paket",
      "Wszystkie rzeczy z paczki",
      "Tous les éléments du pack",
    ],
  ],
  [
    "selected",
    "template",
    [
      "выбрано {count}",
      "вибрано {count}",
      "{count} selected",
      "{count} ausgewählt",
      "wybrano {count}",
      "Sélection\u00a0: {count}",
    ],
  ],
  [
    "choose",
    "text",
    [
      "Выбрать",
      "Вибрати",
      "Select",
      "Auswählen",
      "Wybierz",
      "Choisir",
    ],
  ],
  [
    "chosen",
    "text",
    [
      "Выбрана",
      "Вибрана",
      "Selected",
      "Ausgewählt",
      "Wybrana",
      "Choisi",
    ],
  ],
  [
    "chooseHint",
    "template",
    [
      "Выбрать «{name}» для установки",
      "Вибрати «{name}» для встановлення",
      "Select “{name}” to install",
      "„{name}“ zum Installieren auswählen",
      "Wybierz „{name}” do instalacji",
      "Choisir «\u00a0{name}\u00a0» pour l’installation",
    ],
  ],
  [
    "installSelected",
    "template",
    [
      "Поставить выбранные · {count}",
      "Встановити вибрані · {count}",
      "Install selected · {count}",
      "Ausgewählte installieren · {count}",
      "Zainstaluj wybrane · {count}",
      "Installer la sélection · {count}",
    ],
  ],
  [
    "installOne",
    "text",
    [
      "Поставить эту вещь",
      "Встановити цю річ",
      "Install this item",
      "Dieses Teil installieren",
      "Zainstaluj tę rzecz",
      "Installer cet élément",
    ],
  ],
  [
    "selectAll",
    "text",
    [
      "Выбрать все",
      "Вибрати всі",
      "Select all",
      "Alle auswählen",
      "Zaznacz wszystkie",
      "Tout sélectionner",
    ],
  ],
  [
    "clear",
    "text",
    [
      "Снять выбор",
      "Зняти вибір",
      "Clear selection",
      "Auswahl aufheben",
      "Odznacz",
      "Tout désélectionner",
    ],
  ],
  [
    "installed",
    "text",
    [
      "Стоит в игре",
      "Стоїть у грі",
      "In the game",
      "Im Spiel",
      "Jest w grze",
      "Dans le jeu",
    ],
  ],
  [
    "allInstalled",
    "text",
    [
      "Выбранное уже стоит в игре",
      "Вибране вже стоїть у грі",
      "Everything selected is already in the game",
      "Alles Ausgewählte ist schon im Spiel",
      "Wszystko wybrane jest już w grze",
      "Tout ce qui est sélectionné est déjà dans le jeu",
    ],
  ],
  [
    "targetNote",
    "text",
    [
      "Для каждой вещи Astral спросит, вместо какой вещи сервера её поставить.",
      "Для кожної речі Astral запитає, замість якої речі сервера її встановити.",
      "For each item Astral will ask which server item it replaces.",
      "Für jedes Teil fragt Astral, welches Server-Teil es ersetzen soll.",
      "Dla każdej rzeczy Astral zapyta, którą rzecz serwera ma zastąpić.",
      "Pour chaque élément, Astral demandera quel élément du serveur il doit remplacer.",
    ],
  ],
  [
    "step",
    "template",
    [
      "Вещь {index} из {count}",
      "Річ {index} з {count}",
      "Item {index} of {count}",
      "Teil {index} von {count}",
      "Rzecz {index} z {count}",
      "Élément {index} sur {count}",
    ],
  ],
  [
    "render",
    "text",
    [
      "Снимки — рендер вещей из пака, не кадры из игры.",
      "Знімки — рендер речей з паку, не кадри з гри.",
      "Pictures are renders of the pack’s items, not in-game shots.",
      "Bilder sind Renderings der Teile aus dem Paket, keine Spielszenen.",
      "Zdjęcia to rendery rzeczy z paczki, nie kadry z gry.",
      "Images\u00a0: rendus des éléments du pack, pas des captures du jeu.",
    ],
  ],
  [
    "sounds",
    "plural",
    [
      { one: "звук", few: "звука", many: "звуков", other: "звука" },
      { one: "звук", few: "звуки", many: "звуків", other: "звуку" },
      { one: "sound", other: "sounds" },
      { one: "Sound", other: "Sounds" },
      { one: "dźwięk", few: "dźwięki", many: "dźwięków", other: "dźwięku" },
      { one: "son", many: "sons", other: "sons" },
    ],
  ],
  [
    "weapons",
    "plural",
    [
      { one: "ствол", few: "ствола", many: "стволов", other: "ствола" },
      { one: "ствол", few: "стволи", many: "стволів", other: "ствола" },
      { one: "weapon", other: "weapons" },
      { one: "Waffe", other: "Waffen" },
      { one: "broń", few: "bronie", many: "broni", other: "broni" },
      { one: "arme", many: "armes", other: "armes" },
    ],
  ],
  [
    "soundsTitle",
    "text",
    [
      "Звуки пака",
      "Звуки паку",
      "Sounds in this pack",
      "Sounds im Paket",
      "Dźwięki w paczce",
      "Sons du pack",
    ],
  ],
  [
    "soundHit",
    "template",
    [
      "Есть звук: {names}",
      "Є звук: {names}",
      "Has the sound for: {names}",
      "Mit Sound für: {names}",
      "Ma dźwięk: {names}",
      "Son pour\u00a0: {names}",
    ],
  ],
  [
    "listen",
    "template",
    [
      "Послушать: {name}",
      "Послухати: {name}",
      "Listen: {name}",
      "Anhören: {name}",
      "Posłuchaj: {name}",
      "Écouter\u00a0: {name}",
    ],
  ],
  [
    "stop",
    "template",
    [
      "Остановить: {name}",
      "Зупинити: {name}",
      "Stop: {name}",
      "Stoppen: {name}",
      "Zatrzymaj: {name}",
      "Arrêter\u00a0: {name}",
    ],
  ],
  [
    "shot",
    "text",
    [
      "Выстрел",
      "Постріл",
      "Shot",
      "Schuss",
      "Strzał",
      "Tir",
    ],
  ],
  [
    "noSound",
    "text",
    [
      "Звука для прослушивания нет",
      "Звуку для прослуховування немає",
      "No preview to listen to",
      "Keine Hörprobe vorhanden",
      "Brak próbki do odsłuchania",
      "Pas d’extrait à écouter",
    ],
  ],
  [
    "takeOne",
    "template",
    [
      "Взять только этот звук — {name}",
      "Узяти лише цей звук — {name}",
      "Take only this sound — {name}",
      "Nur diesen Sound nehmen — {name}",
      "Weź tylko ten dźwięk — {name}",
      "Prendre uniquement ce son — {name}",
    ],
  ],
  [
    "found",
    "text",
    [
      "Нашлось по запросу",
      "Знайдено за запитом",
      "Matches your search",
      "Passt zur Suche",
      "Pasuje do wyszukiwania",
      "Correspond à la recherche",
    ],
  ],
  [
    "soundNote",
    "text",
    [
      "Звуки — из файлов самого пака: так ствол будет звучать в игре.",
      "Звуки — з файлів самого паку: так ствол звучатиме в грі.",
      "Sounds come from the pack’s own files: this is how the weapon will sound in game.",
      "Die Sounds stammen aus den Dateien des Pakets: So klingt die Waffe im Spiel.",
      "Dźwięki pochodzą z plików samej paczki: tak broń zabrzmi w grze.",
      "Les sons viennent des fichiers du pack lui-même\u00a0: c’est ainsi que l’arme sonnera dans le jeu.",
    ],
  ],
  [
    "soundFailed",
    "text",
    [
      "Звук не проигрался.",
      "Звук не відтворився.",
      "The sound did not play.",
      "Der Sound konnte nicht abgespielt werden.",
      "Nie udało się odtworzyć dźwięku.",
      "Le son n’a pas pu être lu.",
    ],
  ],
  [
    "sharedWith",
    "template",
    [
      "Так же звучит: {names}",
      "Так само звучить: {names}",
      "Sounds the same: {names}",
      "Klingt genauso: {names}",
      "Brzmi tak samo: {names}",
      "Sonne pareil\u00a0: {names}",
    ],
  ],
];

const memo = { table: null, rules: {} };

function pluralRules(code) {
  if (!memo.rules[code]) memo.rules[code] = new Intl.PluralRules(code);
  return memo.rules[code];
}

// Метки заполняются по порядку аргументов. Значение вставляется как есть:
// шаблонная строка приводит его к строке и не трогает «$» и фигурные скобки.
function makeTemplate(template) {
  const pieces = template.split(/\{[a-z]+\}/);
  if (pieces.length === 2) {
    const [before, after] = pieces;
    return (value) => `${before}${value}${after}`;
  }
  const [before, between, after] = pieces;
  return (first, second) => `${before}${first}${between}${second}${after}`;
}

// Сначала текст числа, потом само число для платформы (так видно по порядку
// обращений к аргументу); слова категорий, которых у языка нет, — как other.
function makePlural(code, words) {
  return (count) => {
    const text = `${count}`;
    const category = pluralRules(code).select(count);
    return `${text} ${words[category] ?? words.other}`;
  };
}

function makeMember(how, variant, code, key) {
  if (how === "text") return variant;
  const member = how === "template" ? makeTemplate(variant) : makePlural(code, variant);
  return Object.defineProperty(member, "name", { value: key });
}

function buildTable() {
  const table = {};
  PACK_BROWSE_LANGUAGES.forEach((code, slot) => {
    const dictionary = {};
    for (const [key, how, variants] of VOCABULARY) {
      dictionary[key] = makeMember(how, variants[slot], code, key);
    }
    table[code] = dictionary;
  });
  return table;
}

export function packBrowseCopy(language = "ru") {
  if (memo.table === null) memo.table = buildTable();
  const { table } = memo;
  return language in table ? table[language] : table.en;
}
