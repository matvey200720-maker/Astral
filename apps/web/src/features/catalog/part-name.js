// Русские названия «частей» приходят с данными как «<вид> <продолжение>».
// Здесь вид заменяется словом выбранного языка, остальное остаётся как есть.

// Столбцы переводов после русского: у вида это строка из шести слов, русское первым.
const TRANSLATED = ["uk", "en", "de", "pl", "fr"];

// Вид, чьё слово подставляется и в хвост «<имя> · Остальные файлы».
const REST_KIND = "Остальные файлы";
const REST_TAIL = ` · ${REST_KIND}`;

// Что может стоять сразу после вида: пробельные символы JS, двойная кавычка,
// открывающая скобка, двоеточие, дефис, открывающая ёлочка, средняя точка и
// длинное тире. Всё прочее (цифра, буква, подчёркивание, запятая) вид
// не заканчивает.
const AFTER_KIND = /^[\s"(:«·—-]/;

const KINDS = [
  ["Арена", "Арена", "Arena", "Arena", "Arena", "Arène"],
  [
    "Большая карта · векторная",
    "Велика карта · векторна",
    "Pause map · vector",
    "Pausenkarte · Vektor",
    "Duża mapa · wektorowa",
    "Carte de pause · vectorielle",
  ],
  [
    "Большая карта",
    "Велика карта",
    "Pause map",
    "Pausenkarte",
    "Duża mapa",
    "Carte de pause",
  ],
  [
    "Быстрый вход",
    "Швидкий вхід",
    "Quick entry",
    "Schnelleinstieg",
    "Szybkie wejście",
    "Entrée rapide",
  ],
  ["Вода", "Вода", "Water", "Wasser", "Woda", "Eau"],
  ["Ганпак", "Ганпак", "Gun pack", "Waffenpaket", "Gunpack", "Gunpack"],
  ["Деревья", "Дерева", "Trees", "Bäume", "Drzewa", "Arbres"],
  ["Дороги", "Дороги", "Roads", "Straßen", "Drogi", "Routes"],
  [
    "Залазы",
    "Залази",
    "Climb spots",
    "Kletterpunkte",
    "Punkty wspinaczki",
    "Points d’escalade",
  ],
  ["Звуки", "Звуки", "Sounds", "Sounds", "Dźwięki", "Sons"],
  [
    "Звуки оружия",
    "Звуки зброї",
    "Weapon sounds",
    "Waffensounds",
    "Dźwięki broni",
    "Sons d’armes",
  ],
  [
    "Интерьеры",
    "Інтер'єри",
    "Interiors",
    "Innenräume",
    "Wnętrza",
    "Intérieurs",
  ],
  [
    "Килл-эффект",
    "Кіл-ефект",
    "Kill effect",
    "Kill-Effekt",
    "Efekt zabójstwa",
    "Effet de kill",
  ],
  [
    "Кнопки меню",
    "Кнопки меню",
    "Menu buttons",
    "Menütasten",
    "Przyciski menu",
    "Boutons du menu",
  ],
  ["Кровь", "Кров", "Blood", "Blut", "Krew", "Sang"],
  ["Маппинг", "Мапінг", "Mapping", "Mapping", "Mapping", "Mapping"],
  ["Мини-карта", "Мінікарта", "Minimap", "Minimap", "Minimapa", "Minicarte"],
  ["Обвесы", "Обвіси", "Attachments", "Aufsätze", "Dodatki", "Accessoires"],
  ["Одежда", "Одяг", "Clothing", "Kleidung", "Odzież", "Vêtements"],
  [
    "Оптимизация объектов",
    "Оптимізація об'єктів",
    "Object optimization",
    "Objekt-Optimierung",
    "Optymalizacja obiektów",
    "Optimisation des objets",
  ],
  [
    "Оптимизация",
    "Оптимізація",
    "Optimization",
    "Optimierung",
    "Optymalizacja",
    "Optimisation",
  ],
  ["Оружие", "Зброя", "Weapons", "Waffen", "Broń", "Armes"],
  [
    "Остальные файлы",
    "Інші файли",
    "Other files",
    "Weitere Dateien",
    "Pozostałe pliki",
    "Autres fichiers",
  ],
  [
    "Отдаление большой карты",
    "Віддалення великої карти",
    "Pause map zoom-out",
    "Pausenkarten-Zoom",
    "Oddalenie dużej mapy",
    "Éloignement de la carte de pause",
  ],
  [
    "Отдаление карты",
    "Віддалення карти",
    "Map zoom-out",
    "Karten-Zoom",
    "Oddalenie mapy",
    "Éloignement de la carte",
  ],
  [
    "Поверхность земли",
    "Поверхня землі",
    "Ground surface",
    "Bodenoberfläche",
    "Powierzchnia ziemi",
    "Surface du sol",
  ],
  ["Погода", "Погода", "Weather", "Wetter", "Pogoda", "Météo"],
  [
    "Положение мини-карты",
    "Положення мінікарти",
    "Minimap position",
    "Minikarten-Position",
    "Położenie minimapy",
    "Position de la minicarte",
  ],
  [
    "Попадания",
    "Влучання",
    "Hit effects",
    "Treffereffekte",
    "Efekty trafień",
    "Impacts",
  ],
  ["Прицел", "Приціл", "Crosshair", "Fadenkreuz", "Celownik", "Réticule"],
  [
    "Растительность",
    "Рослинність",
    "Vegetation",
    "Vegetation",
    "Roślinność",
    "Végétation",
  ],
  [
    "Снайперский прицел",
    "Снайперський приціл",
    "Sniper scope",
    "Zielfernrohr",
    "Luneta",
    "Lunette de sniper",
  ],
  ["Таймцикл", "Таймцикл", "Timecycle", "Timecycle", "Timecycle", "Timecycle"],
  [
    "Трава и россыпь",
    "Трава й розсип",
    "Grass and scatter",
    "Gras und Streuobjekte",
    "Trawa i rozsypka",
    "Herbe et objets épars",
  ],
  ["Трава", "Трава", "Grass", "Gras", "Trawa", "Herbe"],
  [
    "Россыпь",
    "Розсип",
    "Ground scatter",
    "Streuobjekte",
    "Rozsypka",
    "Objets épars",
  ],
  [
    "Трава и кусты",
    "Трава й кущі",
    "Grass and bushes",
    "Gras und Büsche",
    "Trawa i krzewy",
    "Herbe et buissons",
  ],
  ["Трейсеры", "Трасери", "Tracers", "Leuchtspuren", "Smugi", "Traceurs"],
  [
    "Фонари",
    "Ліхтарі",
    "Street lights",
    "Straßenlampen",
    "Latarnie",
    "Lampadaires",
  ],
  [
    "Эффекты и трассеры",
    "Ефекти й трасери",
    "Effects and tracers",
    "Effekte und Leuchtspuren",
    "Efekty i smugacze",
    "Effets et traceurs",
  ],
  [
    "Эффекты попадания",
    "Ефекти влучання",
    "Hit effects",
    "Treffereffekte",
    "Efekty trafień",
    "Effets d’impact",
  ],
];

// Длинные ключи идут первыми: «Большая карта · векторная» должна
// победить «Большая карта», если после неё стоит допустимая граница.
const LONGEST_FIRST = [...KINDS].sort((a, b) => b[0].length - a[0].length);

const restKind = KINDS.find(([ru]) => ru === REST_KIND);

function toText(value) {
  return value === null || value === undefined ? "" : String(value);
}

// Вид, с которого начинается текст, или null. Если у самого длинного ключа
// граница не прошла, пробуется следующий по длине.
function kindAtStart(text) {
  for (const kind of LONGEST_FIRST) {
    if (!text.startsWith(kind[0])) continue;
    const next = text.charAt(kind[0].length);
    if (next === "" || AFTER_KIND.test(next)) return kind;
  }
  return null;
}

// Слово вида на языке. null: у языка нет столбца, текст менять нельзя.
// undefined: язык назван именем, которое есть у любого объекта
// (constructor, toString, __proto__ …), столбец «есть», а слова в нём нет.
function wordOf(kind, language) {
  const column = String(language);
  const at = TRANSLATED.indexOf(column);
  if (at >= 0) return kind[at + 1];
  return column in Object.prototype ? undefined : null;
}

export function localPartName(name, language = "ru", prefixes = null) {
  const text = toText(name);
  const kind = kindAtStart(text);

  if (kind !== null) {
    if (prefixes && !prefixes.includes(kind[0])) return text;
    const word = wordOf(kind, language);
    return word === null ? text : `${word}${text.slice(kind[0].length)}`;
  }

  // Хвост «основы» смотрим, только когда вида в начале нет.
  if (!text.endsWith(REST_TAIL)) return text;
  if (prefixes && !prefixes.includes(REST_KIND)) return text;
  const word = wordOf(restKind, language);
  return word === null ? text : `${text.slice(0, -REST_KIND.length)}${word}`;
}

export function localKindWord(label, language = "ru") {
  const kind = kindAtStart(toText(label).trim());
  if (kind === null) return null;
  return language === "ru" ? kind[0] : wordOf(kind, language);
}
