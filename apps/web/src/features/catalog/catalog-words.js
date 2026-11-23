/*
 * Каталог на языке окна.
 *
 * Страница каталога говорила по-русски на любом языке: рельс по-немецки
 * «Katalog», а под ним — «Все · Сборки · Улучшения…», «Ничего не нашлось»,
 * «Мини-карты» над именем мода и «217 КБ» (BUGS.md, нашла отладка-1).
 *
 * Подписи витрины — разделы, подразделы и раздел публикации из данных
 * каталога (`category_label`, «Мини-карты», «Оружие») — переводятся по
 * русской подписи: она же ключ подраздела в данных (`mod.catalogSubcategory`),
 * другого у подраздела нет. Незнакомая подпись — новый раздел, заведённый в
 * облаке, — остаётся как есть: это данные, а не слова окна. Названия стволов
 * («Heavy Pistol», «MG») — имена из игры, их не переводят.
 */

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

export const CATALOG_LOCALES = Object.freeze({
  ru: "ru-RU",
  uk: "uk-UA",
  en: "en-GB",
  de: "de-DE",
  pl: "pl-PL",
  fr: "fr-FR",
});

/** Язык окна, который каталог знает; незнакомый — английский. */
export const catalogLanguage = (language) =>
  LANGUAGES.includes(language) ? language : "en";

/* Русская подпись → [uk, en, de, pl, fr]. */
const LABELS = {
  /* Разделы. */
  Все: ["Усі", "All", "Alle", "Wszystkie", "Tous"],
  Сборки: ["Збірки", "Packs", "Pakete", "Paczki", "Builds"],
  Улучшения: ["Покращення", "Enhancements", "Verbesserungen", "Ulepszenia", "Améliorations"],
  Эффекты: ["Ефекти", "Effects", "Effekte", "Efekty", "Effets"],
  Интерфейс: ["Інтерфейс", "Interface", "Oberfläche", "Interfejs", "Interface"],
  Звуки: ["Звуки", "Sounds", "Sounds", "Dźwięki", "Sons"],
  Скины: ["Скіни", "Skins", "Skins", "Skiny", "Skins"],
  Одежда: ["Одяг", "Clothing", "Kleidung", "Ubrania", "Vêtements"],
  /* Разделы с вечера 15.10: Все, Редуксы, Ганпаки, Звуки, Одежда, Для
     редуксов («Ганпаки» — ниже, со стволами). Прежние подписи «Ган паки» и
     «Для редукса» остаются для старых ссылок и данных. */
  "Ган паки": ["Ган паки", "Gun packs", "Waffenpakete", "Zestawy broni", "Gunpacks"],
  "Для редукса": [
    "Для редуксу",
    "Redux add-ons",
    "Redux-Zusätze",
    "Dodatki do reduxa",
    "Pour Redux",
  ],
  "Для редуксов": [
    "Для редуксів",
    "Redux add-ons",
    "Redux-Zusätze",
    "Dodatki do reduxów",
    "Pour Redux",
  ],
  /* Группы редакторов в колонке (19.10, `EDITOR_GROUPS`); «Эффекты»,
     «Интерфейс» и «Маппинг» — уже в словаре. */
  Карта: ["Мапа", "Map", "Karte", "Mapa", "Carte"],
  Мир: ["Світ", "World", "Welt", "Świat", "Monde"],
  /* Подразделы «Для редуксов» — редакторы мастерской под их именами на
     плитках (`catalog-taxonomy.js`, `reduxEditorSlots.js`; тест
     `catalog-pilot-sections.test.js` сверяет слово в слово). Имена, что уже
     стоят ниже («Фонари», «Залазы», «Дороги»…), — те же слова мастерской. */
  "Мини-карта": ["Міні-карта", "Minimap", "Minikarte", "Minimapa", "Minicarte"],
  "Эффекты попадания": [
    "Ефекти влучання",
    "Hit effects",
    "Treffereffekte",
    "Efekty trafień",
    "Effets de touche",
  ],
  Арена: ["Арена", "Arena", "Arena", "Arena", "Arène"],
  Ганпак: ["Ганпак", "Gun pack", "Waffenpaket", "Gunpack", "Gunpack"],
  Деревья: ["Дерева", "Trees", "Bäume", "Drzewa", "Arbres"],
  "Звук оружия": ["Звук зброї", "Weapon sound", "Waffensound", "Dźwięk broni", "Son d’arme"],
  "Звуки оружия": ["Звуки зброї", "Weapon sounds", "Waffensounds", "Dźwięki broni", "Sons d’armes"],
  "Кнопки меню": ["Кнопки меню", "Menu buttons", "Menütasten", "Przyciski menu", "Boutons du menu"],
  "Одежда: спрятать": ["Одяг: сховати", "Clothing: hide", "Kleidung: ausblenden", "Odzież: ukryj", "Vêtements : masquer"],
  "Поверхность земли": ["Поверхня землі", "Ground surface", "Bodenoberfläche", "Powierzchnia ziemi", "Surface du sol"],
  Таймцикл: ["Таймцикл", "Timecycle", "Timecycle", "Timecycle", "Timecycle"],
  "Трава и кусты": ["Трава й кущі", "Grass and bushes", "Gras und Büsche", "Trawa i krzewy", "Herbe et buissons"],
  "Килл-эффект": ["Кілл-ефект", "Kill effect", "Kill-Effekt", "Efekt zabójstwa", "Effet de kill"],
  "Огонь и взрывы": [
    "Вогонь і вибухи",
    "Fire and explosions",
    "Feuer und Explosionen",
    "Ogień i eksplozje",
    "Feu et explosions",
  ],
  "Настройка автомобиля": [
    "Налаштування автомобіля",
    "Car setup",
    "Fahrzeugeinstellungen",
    "Ustawienia samochodu",
    "Réglages de la voiture",
  ],
  Прицел: ["Приціл", "Crosshair", "Fadenkreuz", "Celownik", "Réticule"],
  "Полоска HP": ["Смужка HP", "HP bar", "HP-Leiste", "Pasek HP", "Barre de vie"],
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "Групповые метки": ["Групові мітки", "Group markers", "Gruppenmarkierungen", "Znaczniki grupowe", "Marqueurs de groupe"],
  Шрифты: ["Шрифти", "Fonts", "Schriften", "Czcionki", "Polices"],
  Таймциклы: ["Таймцикли", "Timecycles", "Timecycles", "Timecycle", "Timecycles"],
  Дирижабли: ["Дирижаблі", "Airships", "Luftschiffe", "Sterowce", "Dirigeables"],
  "Эффекты попадания на экране": [
    "Ефекти влучання на екрані",
    "On-screen hit effects",
    "Treffereffekte auf dem Bildschirm",
    "Efekty trafień na ekranie",
    "Effets de touche à l'écran",
  ],
  Прочее: ["Інше", "Other", "Sonstiges", "Inne", "Divers"],
  /* Сборки. */
  Семейные: ["Сімейні", "Family", "Familie", "Rodzinne", "Famille"],
  Гетто: ["Гето", "Ghetto", "Ghetto", "Getto", "Ghetto"],
  Медиа: ["Медіа", "Media", "Medien", "Media", "Médias"],
  "Весна и лето": [
    "Весна й літо",
    "Spring & summer",
    "Frühling & Sommer",
    "Wiosna i lato",
    "Printemps et été",
  ],
  Осень: ["Осінь", "Autumn", "Herbst", "Jesień", "Automne"],
  Зима: ["Зима", "Winter", "Winter", "Zima", "Hiver"],
  /* Улучшения. */
  Дороги: ["Дороги", "Roads", "Straßen", "Drogi", "Routes"],
  Фонари: ["Ліхтарі", "Street lights", "Straßenlaternen", "Latarnie", "Lampadaires"],
  Билборды: ["Білборди", "Billboards", "Werbetafeln", "Billboardy", "Panneaux publicitaires"],
  "Баннеры на зданиях": ["Банери на будівлях", "Building banners", "Banner an Gebäuden", "Banery na budynkach", "Bannières sur les bâtiments"],
  Заправки: ["Заправки", "Gas stations", "Tankstellen", "Stacje paliw", "Stations-service"],
  Здания: ["Будівлі", "Buildings", "Gebäude", "Budynki", "Bâtiments"],
  Сирены: ["Сирени", "Sirens", "Sirenen", "Syreny", "Sirènes"],
  Растительность: ["Рослинність", "Vegetation", "Vegetation", "Roślinność", "Végétation"],
  Вода: ["Вода", "Water", "Wasser", "Woda", "Eau"],
  Облака: ["Хмари", "Clouds", "Wolken", "Chmury", "Nuages"],
  "Ночное небо": ["Нічне небо", "Night sky", "Nachthimmel", "Nocne niebo", "Ciel nocturne"],
  "Млечный путь": [
    "Чумацький Шлях",
    "Milky Way",
    "Milchstraße",
    "Droga Mleczna",
    "Voie lactée",
  ],
  "Северное сияние": [
    "Північне сяйво",
    "Northern lights",
    "Polarlicht",
    "Zorza polarna",
    "Aurore boréale",
  ],
  Маппинг: ["Мапінг", "Mapping", "Mapping", "Mapowanie", "Mapping"],
  Объекты: ["Об’єкти", "Objects", "Objekte", "Obiekty", "Objets"],
  Декали: ["Декалі", "Decals", "Decals", "Naklejki", "Decals"],
  Интерьеры: ["Інтер’єри", "Interiors", "Innenräume", "Wnętrza", "Intérieurs"],
  "Размытие в движении": [
    "Розмиття в русі",
    "Motion blur",
    "Bewegungsunschärfe",
    "Rozmycie ruchu",
    "Flou de mouvement",
  ],
  Внешность: ["Зовнішність", "Appearance", "Aussehen", "Wygląd", "Apparence"],
  Патчи: ["Патчі", "Patches", "Patches", "Łatki", "Patchs"],
  /* Улучшения с 11.10 — редакторы мастерской (`catalog-taxonomy.js`). */
  Остановки: ["Зупинки", "Bus stops", "Bushaltestellen", "Przystanki", "Arrêts"],
  Флаги: ["Прапори", "Flags", "Flaggen", "Flagi", "Drapeaux"],
  Банкоматы: ["Банкомати", "ATMs", "Geldautomaten", "Bankomaty", "Distributeurs"],
  "Интерьеры проектов": ["Інтер’єри проєктів", "Project interiors", "Projekt-Innenräume", "Wnętrza projektów", "Intérieurs des projets"],
  "Интерьеры Majestic RP": ["Інтер’єри Majestic RP", "Majestic RP interiors", "Majestic-RP-Innenräume", "Wnętrza Majestic RP", "Intérieurs Majestic RP"],
  Вайнвуд: ["Вайнвуд", "Vinewood sign", "Vinewood-Schriftzug", "Napis Vinewood", "Panneau Vinewood"],
  "Летающее лого": [
    "Літаюче лого",
    "Flying logo",
    "Schwebendes Logo",
    "Latające logo",
    "Logo volant",
  ],
  Расписание: ["Розклад", "Schedule board", "Zeitplan-Tafel", "Tablica harmonogramu", "Tableau des horaires"],
  "Интерьеры магазинов": [
    "Інтер'єри магазинів",
    "Shop interiors",
    "Ladeninnenräume",
    "Wnętrza sklepów",
    "Intérieurs des magasins",
  ],
  Мегамолл: ["Мегамолл", "Mega Mall", "Mega Mall", "Mega Mall", "Mega Mall"],
  "Ашан / Икея": ["Ашан / Ікеа", "Auchan / IKEA", "Auchan / IKEA", "Auchan / IKEA", "Auchan / IKEA"],
  Завод: ["Завод", "Factory", "Fabrik", "Fabryka", "Usine"],
  Ангар: ["Ангар", "Hangar", "Hangar", "Hangar", "Hangar"],
  Арены: ["Арени", "Arenas", "Arenen", "Areny", "Arènes"],
  Зоны: ["Зони", "Zones", "Zonen", "Strefy", "Zones"],
  "Зоны каптов": ["Зони каптів", "Capture zones", "Eroberungszonen", "Strefy przejęć", "Zones de capture"],
  "МСЛ-зоны": [
    "МСЛ-зони",
    "Ground zone lines",
    "Zonenlinien am Boden",
    "Linie stref na ziemi",
    "Lignes de zone au sol",
  ],
  Залазы: ["Залази", "Climbing", "Klettern", "Wspinaczka", "Escalade"],
  Прострелы: ["Прострели", "Wallbangs", "Durchschüsse", "Przestrzały", "Tirs à travers les murs"],
  Животные: ["Тварини", "Animals", "Tiere", "Zwierzęta", "Animaux"],
  Оптимизация: ["Оптимізація", "Optimization", "Optimierung", "Optymalizacja", "Optimisation"],
  /* Эффекты. */
  Трейсеры: ["Трасери", "Tracers", "Leuchtspuren", "Smugi", "Traceurs"],
  Дым: ["Дим", "Smoke", "Rauch", "Dym", "Fumée"],
  Попадания: ["Влучання", "Impacts", "Treffer", "Trafienia", "Impacts"],
  Освещение: ["Освітлення", "Lighting", "Beleuchtung", "Oświetlenie", "Éclairage"],
  Погода: ["Погода", "Weather", "Wetter", "Pogoda", "Météo"],
  /* Интерфейс. */
  "Мини-карты": ["Мінікарти", "Minimaps", "Minikarten", "Minimapy", "Minicartes"],
  Прицелы: ["Приціли", "Crosshairs", "Fadenkreuze", "Celowniki", "Réticules"],
  "Снайперские прицелы": [
    "Снайперські приціли",
    "Sniper scopes",
    "Zielfernrohre",
    "Lunety snajperskie",
    "Lunettes de sniper",
  ],
  "Большая карта": ["Велика карта", "World map", "Weltkarte", "Mapa świata", "Carte du monde"],
  /* Звуки. */
  Оружие: ["Зброя", "Weapons", "Waffen", "Broń", "Armes"],
  Транспорт: ["Транспорт", "Vehicles", "Fahrzeuge", "Pojazdy", "Véhicules"],
  Окружение: ["Оточення", "Ambience", "Umgebung", "Otoczenie", "Ambiance"],
  /* Скины: русские подписи; стволы — имена из игры. */
  Ганпаки: ["Ганпаки", "Gunpacks", "Waffenpacks", "Paczki broni", "Gunpacks"],
  Обвесы: ["Обвіси", "Attachments", "Aufsätze", "Dodatki", "Accessoires d'arme"],
  Мушкет: ["Мушкет", "Musket", "Muskete", "Muszkiet", "Mousquet"],
  Нож: ["Ніж", "Knife", "Messer", "Nóż", "Couteau"],
  Бита: ["Біта", "Bat", "Schläger", "Kij", "Batte"],
  Тазер: ["Тазер", "Stun gun", "Taser", "Paralizator", "Taser"],
  /* Разделы публикаций из данных каталога и подразделы ганпаков. */
  Редуксы: ["Редукси", "Redux", "Redux", "Redux", "Redux"],
  /* Сборка редукса одним модом (Т-81c) — подпись над её названием. */
  "Сборка редукса": [
    "Збірка редуксу",
    "Redux bundle",
    "Redux-Sammlung",
    "Zestaw Redux",
    "Build Redux",
  ],
  Другое: ["Інше", "Other", "Andere", "Inne", "Autre"],
  Пистолеты: ["Пістолети", "Pistols", "Pistolen", "Pistolety", "Pistolets"],
  Револьверы: ["Револьвери", "Revolvers", "Revolver", "Rewolwery", "Revolvers"],
  "Пистолеты-пулемёты": [
    "Пістолети-кулемети",
    "SMGs",
    "Maschinenpistolen",
    "Pistolety maszynowe",
    "Pistolets-mitrailleurs",
  ],
  Винтовки: ["Гвинтівки", "Rifles", "Gewehre", "Karabiny", "Fusils"],
  Дробовики: ["Дробовики", "Shotguns", "Schrotflinten", "Strzelby", "Fusils à pompe"],
  Пулемёты: [
    "Кулемети",
    "Machine guns",
    "Maschinengewehre",
    "Karabiny maszynowe",
    "Mitrailleuses",
  ],
  "Снайперские винтовки": [
    "Снайперські гвинтівки",
    "Sniper rifles",
    "Scharfschützengewehre",
    "Karabiny snajperskie",
    "Fusils de précision",
  ],
  /* Пол вещи одежды — у двух одинаковых карточек м/ж (Т-95). */
  Мужское: ["Чоловіче", "Men's", "Herren", "Męskie", "Homme"],
  Женское: ["Жіноче", "Women's", "Damen", "Damskie", "Femme"],
  /* Полки витрины (ТЗ 05.10, задача 14). */
  Город: ["Місто", "City", "Stadt", "Miasto", "Ville"],
  "Свет и фонари": [
    "Світло й ліхтарі",
    "Lights",
    "Licht und Laternen",
    "Światła",
    "Lumières et lampadaires",
  ],
  Природа: ["Природа", "Nature", "Natur", "Natura", "Nature"],
  Места: ["Місця", "Places", "Orte", "Miejsca", "Lieux"],
  "Зоны и метки": [
    "Зони й мітки",
    "Zones & marks",
    "Zonen und Markierungen",
    "Strefy i znaczniki",
    "Zones et marqueurs",
  ],
  Небо: ["Небо", "Sky", "Himmel", "Niebo", "Ciel"],
  Картинка: ["Картинка", "Image", "Bild", "Obraz", "Image"],
  Сезоны: ["Сезони", "Seasons", "Jahreszeiten", "Pory roku", "Saisons"],
  Тематические: ["Тематичні", "Themed", "Thematisch", "Tematyczne", "Thématiques"],
  "Тяжёлое оружие": [
    "Важка зброя",
    "Heavy weapons",
    "Schwere Waffen",
    "Broń ciężka",
    "Armes lourdes",
  ],
  Холодное: ["Холодна зброя", "Melee", "Nahkampf", "Broń biała", "Armes blanches"],
  Комплекты: ["Комплекти", "Outfits", "Outfits", "Zestawy", "Tenues"],
  HUD: ["HUD", "HUD", "HUD", "HUD", "HUD"],
  /* Категории одежды — полки «Одежды». */
  Верх: ["Верх", "Tops", "Oberteile", "Góra", "Hauts"],
  Низ: ["Низ", "Bottoms", "Hosen", "Dół", "Bas"],
  Обувь: ["Взуття", "Shoes", "Schuhe", "Buty", "Chaussures"],
  Маски: ["Маски", "Masks", "Masken", "Maski", "Masques"],
  "Головные уборы": [
    "Головні убори",
    "Headwear",
    "Kopfbedeckungen",
    "Nakrycia głowy",
    "Couvre-chefs",
  ],
  Очки: ["Окуляри", "Glasses", "Brillen", "Okulary", "Lunettes"],
  Уши: ["Вуха", "Ears", "Ohren", "Uszy", "Oreilles"],
  Часы: ["Годинники", "Watches", "Uhren", "Zegarki", "Montres"],
  Браслеты: ["Браслети", "Bracelets", "Armbänder", "Bransoletki", "Bracelets"],
  Аксессуары: ["Аксесуари", "Accessories", "Accessoires", "Akcesoria", "Accessoires"],
  /* Полки «Одежды» — слова мастерской (`catalog-taxonomy.js`). */
  Бронежилеты: ["Бронежилети", "Body armor", "Schutzwesten", "Kamizelki", "Gilets pare-balles"],
  Футболки: ["Футболки", "T-shirts", "T-Shirts", "Koszulki", "T-shirts"],
  Штаны: ["Штани", "Pants", "Hosen", "Spodnie", "Pantalons"],
  Перчатки: ["Рукавички", "Gloves", "Handschuhe", "Rękawiczki", "Gants"],
  Сумки: ["Сумки", "Bags", "Taschen", "Torby", "Sacs"],
  Татуировки: ["Татуювання", "Tattoos", "Tattoos", "Tatuaże", "Tatouages"],
  "Рюкзаки и сумки": ["Рюкзаки й сумки", "Bags", "Taschen", "Plecaki i torby", "Sacs à dos et sacs"],
  Броня: ["Броня", "Armor", "Rüstung", "Pancerz", "Armure"],
  "Руки и перчатки": [
    "Руки й рукавички",
    "Hands and gloves",
    "Hände und Handschuhe",
    "Dłonie i rękawice",
    "Mains et gants",
  ],
  Причёски: ["Зачіски", "Hair", "Frisuren", "Fryzury", "Coiffures"],
  Нашивки: ["Нашивки", "Decals", "Aufnäher", "Naszywki", "Écussons"],
  Госодежда: ["Держодяг", "Government", "Behördenkleidung", "Odzież służbowa", "Tenues officielles"],
  /* Подкатегории «Одежды» по виду вещи (14.11.2026, `clothing-sections.js`): к полкам выше. */
  Бороды: ["Бороди", "Beards", "Bärte", "Brody", "Barbes"],
  Серьги: ["Сережки", "Earrings", "Ohrringe", "Kolczyki", "Boucles d'oreilles"],
  Ногти: ["Нігті", "Nails", "Nägel", "Paznokcie", "Ongles"],
  "Нижний слой": ["Нижній шар", "Undershirt layer", "Unterste Schicht", "Dolna warstwa", "Couche de dessous"],
  "Часы и браслеты": ["Годинники та браслети", "Watches and bracelets", "Uhren und Armbänder", "Zegarki i bransoletki", "Montres et bracelets"],
  "Сумки и рюкзаки": ["Сумки та рюкзаки", "Bags and backpacks", "Taschen und Rucksäcke", "Torby i plecaki", "Sacs et sacs à dos"],
};

/** Подпись витрины на языке окна; незнакомая — как есть. */
export function catalogLabel(text, language = "ru") {
  const index = LANGUAGES.indexOf(language) - 1;
  if (index < 0) return text;
  return LABELS[text]?.[index] || text;
}

/* Счёт на языке окна: форма числа — правилом языка, число — его записью. */
const FORMS = {
  ru: {
    publications: { one: "публикация", few: "публикации", many: "публикаций" },
    mods: { one: "модификация", few: "модификации", many: "модификаций" },
    reduxes: { one: "редукс", few: "редукса", many: "редуксов" },
    parts: { one: "часть", few: "части", many: "частей" },
    components: { one: "компонент", few: "компонента", many: "компонентов" },
  },
  uk: {
    publications: { one: "публікація", few: "публікації", many: "публікацій" },
    mods: { one: "модифікація", few: "модифікації", many: "модифікацій" },
    reduxes: { one: "редукс", few: "редукси", many: "редуксів" },
    parts: { one: "частина", few: "частини", many: "частин" },
    components: { one: "компонент", few: "компоненти", many: "компонентів" },
  },
  en: {
    publications: { one: "publication", other: "publications" },
    mods: { one: "mod", other: "mods" },
    reduxes: { one: "redux", other: "reduxes" },
    parts: { one: "part", other: "parts" },
    components: { one: "component", other: "components" },
  },
  de: {
    publications: { one: "Veröffentlichung", other: "Veröffentlichungen" },
    mods: { one: "Mod", other: "Mods" },
    reduxes: { one: "Redux", other: "Redux" },
    parts: { one: "Teil", other: "Teile" },
    components: { one: "Komponente", other: "Komponenten" },
  },
  pl: {
    publications: { one: "publikacja", few: "publikacje", many: "publikacji" },
    mods: { one: "modyfikacja", few: "modyfikacje", many: "modyfikacji" },
    reduxes: { one: "redux", few: "reduxy", many: "reduxów" },
    parts: { one: "część", few: "części", many: "części" },
    components: { one: "komponent", few: "komponenty", many: "komponentów" },
  },
  fr: {
    publications: { one: "publication", other: "publications" },
    mods: { one: "mod", other: "mods" },
    reduxes: { one: "Redux", other: "Redux" },
    parts: { one: "partie", other: "parties" },
    components: { one: "composant", other: "composants" },
  },
};
const pluralRules = new Map();
function countOf(language, count, kind) {
  if (!pluralRules.has(language))
    pluralRules.set(language, new Intl.PluralRules(language));
  const forms = FORMS[language][kind];
  const form = pluralRules.get(language).select(count);
  const word = forms[form] || forms.many || forms.other;
  return `${count.toLocaleString(CATALOG_LOCALES[language])} ${word}`;
}

const COPY = {
  ru: {
    quotes: ["«", "»"],
    sorts: { new: "Новые", popular: "Популярные", downloads: "По скачиваниям" },
    categoriesLabel: "Категории каталога",
    sortLabel: "Сортировка каталога",
    sortFilterLabel: "Порядок и фильтры каталога",
    searchPlaceholder: "Название или тег",
    searchLabel: "Поиск по каталогу",
    favoriteAdd: (name) => `Добавить ${name} в избранное`,
    favoriteRemove: (name) => `Убрать ${name} из избранного`,
    buildInWorkshop: "Собрать в мастерской",
    loadingNote: (count) =>
      `Каталог догружается: пока ${count}, остальные появятся сами.`,
    layoutNote: (query, swapped) =>
      `Ничего не нашлось по «${query}» — показано по «${swapped}», как если бы раскладка была другой.`,
    pendingTitle: "Каталог ещё не загрузился",
    pendingNote:
      "Astral повторяет сам — публикации появятся здесь, как только сервис ответит. Мастерская, библиотека и настройки работают и без каталога.",
    retry: "Повторить",
    loadingTitle: "Каталог ещё загружается",
    loadingText:
      "Здесь пока не все публикации — остальные появятся сами, через несколько секунд.",
    inFavorites: "в избранном",
    inSubcategory: (name) => `в подразделе «${name}»`,
    inSection: (name) => `в разделе «${name}»`,
    nothingIn: (scope) => `Ничего не нашлось ${scope}`,
    elsewhere: (query, count) =>
      `По запросу «${query}» в остальном каталоге — ${count}.`,
    searchEverywhere: "Искать во всём каталоге",
    nothingFound: "Ничего не нашлось",
    noMatches: (query) => `По запросу «${query}» совпадений нет.`,
    resetSearch: "Сбросить поиск",
    favoritesEmpty: "В избранном пусто",
    favoritesEmptyNote: "Отметьте модификацию сердечком — она соберётся здесь.",
    showWholeCatalog: "Показать весь каталог",
    showAllMods: "Показать все модификации",
    subcategoryNoPublications: (name) =>
      `В подразделе «${name}» пока нет публикаций`,
    sectionNoPublications: (name) => `В разделе «${name}» пока нет публикаций`,
    workshopNote: (list) =>
      `Зато ${list} можно собрать самому — в мастерской. Готовая работа ставится в игру так же, как мод из каталога.`,
    and: "и",
    showWholeSection: "Показать весь раздел",
    seeAllSections: "Смотреть все разделы",
    catalogEmpty: "Каталог ещё пуст",
    catalogEmptyNote:
      "Публикаций нет ни в одном разделе: каждый пакет проходит проверку и подпись, прежде чем попасть в каталог. Прицел, мини-карту и дороги можно собрать самому — в мастерской.",
    openWorkshop: "Открыть мастерскую",
    sectionNoMods: (name) => `В разделе «${name}» пока нет модификаций`,
    sectionNoModsNote:
      "Опубликованные модификации сейчас лежат в других разделах каталога.",
    subcategoryNoMods: (name) => `В подразделе «${name}» пока нет модификаций`,
    subcategoryNoModsNote: (section) =>
      `В остальных подразделах «${section}» публикации уже есть.`,
    fallbackTitle: "Здесь пока пусто",
    fallbackNote: "Ни одна модификация не подошла под выбранные условия.",
    projectLabel: "Проект",
    allProjects: "Все проекты",
    projectNotes: {
      all: "моды для любого проекта",
      majestic: "только то, что работает на Majestic",
      gta5rp: "без модов с преимуществом: за них банят",
      russia: "только то, что работает на «Россия Онлайн»",
    },
    russiaOnline: "Россия Онлайн",
    filtersLabel: "Фильтры каталога",
    sizeLabel: "Размер",
    sizes: { any: "Любой размер", 500: "до 500 МБ", 2000: "до 2 ГБ" },
    genderLabel: "Персонаж",
    genderAll: "Все",
    clearSearch: "Очистить поиск",
    catalogTitle: "Каталог",
    navigatorLabel: "Навигация по каталогу",
    navigatorHeading: "Разделы",
    collapseNavigator: "Свернуть меню",
    expandNavigator: "Развернуть меню",
    favoritesNav: "Избранное",
  },
  uk: {
    quotes: ["«", "»"],
    sorts: {
      new: "Нові",
      popular: "Популярні",
      downloads: "За завантаженнями",
    },
    categoriesLabel: "Категорії каталогу",
    sortLabel: "Сортування каталогу",
    sortFilterLabel: "Порядок і фільтри каталогу",
    searchPlaceholder: "Назва або тег",
    searchLabel: "Пошук у каталозі",
    favoriteAdd: (name) => `Додати ${name} до обраного`,
    favoriteRemove: (name) => `Прибрати ${name} з обраного`,
    buildInWorkshop: "Зібрати в майстерні",
    loadingNote: (count) =>
      `Каталог довантажується: поки ${count}, решта з’явиться сама.`,
    layoutNote: (query, swapped) =>
      `За «${query}» нічого не знайдено — показано за «${swapped}», ніби розкладка була інша.`,
    pendingTitle: "Каталог ще не завантажився",
    pendingNote:
      "Astral повторює сам — публікації з’являться тут, щойно сервіс відповість. Майстерня, бібліотека й налаштування працюють і без каталогу.",
    retry: "Повторити",
    loadingTitle: "Каталог ще завантажується",
    loadingText:
      "Тут поки не всі публікації — решта з’явиться сама за кілька секунд.",
    inFavorites: "в обраному",
    inSubcategory: (name) => `у підрозділі «${name}»`,
    inSection: (name) => `у розділі «${name}»`,
    nothingIn: (scope) => `Нічого не знайдено ${scope}`,
    elsewhere: (query, count) =>
      `За запитом «${query}» в іншій частині каталогу — ${count}.`,
    searchEverywhere: "Шукати в усьому каталозі",
    nothingFound: "Нічого не знайдено",
    noMatches: (query) => `За запитом «${query}» збігів немає.`,
    resetSearch: "Скинути пошук",
    favoritesEmpty: "В обраному порожньо",
    favoritesEmptyNote: "Позначте модифікацію сердечком — вона збереться тут.",
    showWholeCatalog: "Показати весь каталог",
    showAllMods: "Показати всі модифікації",
    subcategoryNoPublications: (name) =>
      `У підрозділі «${name}» поки немає публікацій`,
    sectionNoPublications: (name) =>
      `У розділі «${name}» поки немає публікацій`,
    workshopNote: (list) =>
      `Зате ${list} можна зібрати самому — у майстерні. Готова робота ставиться в гру так само, як мод із каталогу.`,
    and: "і",
    showWholeSection: "Показати весь розділ",
    seeAllSections: "Дивитися всі розділи",
    catalogEmpty: "Каталог поки порожній",
    catalogEmptyNote:
      "Публікацій немає в жодному розділі: кожен пакет проходить перевірку й підпис, перш ніж потрапити до каталогу. Приціл, мінікарту й дороги можна зібрати самому — у майстерні.",
    openWorkshop: "Відкрити майстерню",
    sectionNoMods: (name) => `У розділі «${name}» поки немає модифікацій`,
    sectionNoModsNote:
      "Опубліковані модифікації зараз лежать в інших розділах каталогу.",
    subcategoryNoMods: (name) =>
      `У підрозділі «${name}» поки немає модифікацій`,
    subcategoryNoModsNote: (section) =>
      `В інших підрозділах «${section}» публікації вже є.`,
    fallbackTitle: "Тут поки порожньо",
    fallbackNote: "Жодна модифікація не підійшла під вибрані умови.",
    projectLabel: "Проєкт",
    allProjects: "Усі проєкти",
    projectNotes: {
      all: "моди для будь-якого проєкту",
      majestic: "лише те, що працює на Majestic",
      gta5rp: "без модів із перевагою: за них банять",
      russia: "лише те, що працює на «Росія Онлайн»",
    },
    russiaOnline: "Росія Онлайн",
    filtersLabel: "Фільтри каталогу",
    sizeLabel: "Розмір",
    sizes: { any: "Будь-який розмір", 500: "до 500 МБ", 2000: "до 2 ГБ" },
    genderLabel: "Персонаж",
    genderAll: "Усі",
    clearSearch: "Очистити пошук",
    catalogTitle: "Каталог",
    navigatorLabel: "Навігація каталогом",
    navigatorHeading: "Розділи",
    collapseNavigator: "Згорнути меню",
    expandNavigator: "Розгорнути меню",
    favoritesNav: "Обране",
  },
  en: {
    quotes: ["“", "”"],
    sorts: { new: "Newest", popular: "Popular", downloads: "Most downloaded" },
    categoriesLabel: "Catalog sections",
    sortLabel: "Catalog sorting",
    sortFilterLabel: "Catalog order and filters",
    searchPlaceholder: "Name or tag",
    searchLabel: "Search the catalog",
    favoriteAdd: (name) => `Add ${name} to favorites`,
    favoriteRemove: (name) => `Remove ${name} from favorites`,
    buildInWorkshop: "Build in the workshop",
    loadingNote: (count) =>
      `The catalog is still loading: ${count} so far, the rest will appear on their own.`,
    layoutNote: (query, swapped) =>
      `Nothing matched “${query}” — showing results for “${swapped}” from the other keyboard layout.`,
    pendingTitle: "The catalog hasn't loaded yet",
    pendingNote:
      "Astral keeps retrying — publications will appear here as soon as the service answers. The workshop, library and settings work without the catalog.",
    retry: "Retry",
    loadingTitle: "The catalog is still loading",
    loadingText:
      "Not every publication is here yet — the rest will appear on their own in a few seconds.",
    inFavorites: "in favorites",
    inSubcategory: (name) => `in “${name}”`,
    inSection: (name) => `in “${name}”`,
    nothingIn: (scope) => `Nothing found ${scope}`,
    elsewhere: (query, count) =>
      `The rest of the catalog has ${count} for “${query}”.`,
    searchEverywhere: "Search the whole catalog",
    nothingFound: "Nothing found",
    noMatches: (query) => `Nothing matches “${query}”.`,
    resetSearch: "Clear search",
    favoritesEmpty: "No favorites yet",
    favoritesEmptyNote: "Tap the heart on a mod — it will show up here.",
    showWholeCatalog: "Show the whole catalog",
    showAllMods: "Show all mods",
    subcategoryNoPublications: (name) => `Nothing published in “${name}” yet`,
    sectionNoPublications: (name) => `Nothing published in “${name}” yet`,
    workshopNote: (list) =>
      `But you can build ${list} yourself in the workshop. A finished work installs into the game just like a catalog mod.`,
    and: "and",
    showWholeSection: "Show the whole section",
    seeAllSections: "See all sections",
    catalogEmpty: "The catalog is empty for now",
    catalogEmptyNote:
      "No section has publications yet: every package is checked and signed before it reaches the catalog. A crosshair, a minimap and roads you can build yourself in the workshop.",
    openWorkshop: "Open the workshop",
    sectionNoMods: (name) => `No mods in “${name}” yet`,
    sectionNoModsNote: "Published mods are in other catalog sections for now.",
    subcategoryNoMods: (name) => `No mods in “${name}” yet`,
    subcategoryNoModsNote: (section) =>
      `Other parts of “${section}” already have publications.`,
    fallbackTitle: "Nothing here yet",
    fallbackNote: "No mod matches the chosen filters.",
    projectLabel: "Project",
    allProjects: "All projects",
    projectNotes: {
      all: "mods for any project",
      majestic: "only what works on Majestic",
      gta5rp: "no mods with an edge: they get you banned",
      russia: "only what works on Russia Online",
    },
    russiaOnline: "Russia Online",
    filtersLabel: "Catalog filters",
    sizeLabel: "Size",
    sizes: { any: "Any size", 500: "up to 500 MB", 2000: "up to 2 GB" },
    genderLabel: "Character",
    genderAll: "All",
    clearSearch: "Clear search",
    catalogTitle: "Catalog",
    navigatorLabel: "Catalog navigation",
    navigatorHeading: "Sections",
    collapseNavigator: "Collapse the menu",
    expandNavigator: "Expand the menu",
    favoritesNav: "Favorites",
  },
  de: {
    quotes: ["„", "“"],
    sorts: {
      new: "Neueste",
      popular: "Beliebt",
      downloads: "Meiste Downloads",
    },
    categoriesLabel: "Katalogbereiche",
    sortLabel: "Katalog sortieren",
    sortFilterLabel: "Reihenfolge und Filter des Katalogs",
    searchPlaceholder: "Name oder Tag",
    searchLabel: "Im Katalog suchen",
    favoriteAdd: (name) => `${name} zu den Favoriten hinzufügen`,
    favoriteRemove: (name) => `${name} aus den Favoriten entfernen`,
    buildInWorkshop: "In der Werkstatt bauen",
    loadingNote: (count) =>
      `Der Katalog lädt noch: bisher ${count}, der Rest erscheint von selbst.`,
    layoutNote: (query, swapped) =>
      `Zu „${query}“ nichts gefunden — gezeigt wird „${swapped}“, als wäre das Tastaturlayout ein anderes.`,
    pendingTitle: "Der Katalog ist noch nicht geladen",
    pendingNote:
      "Astral versucht es weiter — Veröffentlichungen erscheinen hier, sobald der Dienst antwortet. Werkstatt, Bibliothek und Einstellungen funktionieren auch ohne Katalog.",
    retry: "Erneut",
    loadingTitle: "Der Katalog lädt noch",
    loadingText:
      "Noch sind nicht alle Veröffentlichungen da — der Rest erscheint in ein paar Sekunden von selbst.",
    inFavorites: "in den Favoriten",
    inSubcategory: (name) => `in „${name}“`,
    inSection: (name) => `in „${name}“`,
    nothingIn: (scope) => `Nichts gefunden ${scope}`,
    elsewhere: (query, count) =>
      `Im übrigen Katalog gibt es zu „${query}“ ${count}.`,
    searchEverywhere: "Im ganzen Katalog suchen",
    nothingFound: "Nichts gefunden",
    noMatches: (query) => `Zu „${query}“ gibt es keine Treffer.`,
    resetSearch: "Suche zurücksetzen",
    favoritesEmpty: "Noch keine Favoriten",
    favoritesEmptyNote:
      "Markiere eine Mod mit dem Herz — sie sammelt sich hier.",
    showWholeCatalog: "Ganzen Katalog zeigen",
    showAllMods: "Alle Mods zeigen",
    subcategoryNoPublications: (name) =>
      `In „${name}“ ist noch nichts veröffentlicht`,
    sectionNoPublications: (name) =>
      `In „${name}“ ist noch nichts veröffentlicht`,
    workshopNote: (list) =>
      `Dafür kannst du ${list} selbst in der Werkstatt bauen. Eine fertige Arbeit wird genauso ins Spiel installiert wie eine Mod aus dem Katalog.`,
    and: "und",
    showWholeSection: "Ganzen Bereich zeigen",
    seeAllSections: "Alle Bereiche ansehen",
    catalogEmpty: "Der Katalog ist noch leer",
    catalogEmptyNote:
      "In keinem Bereich gibt es Veröffentlichungen: Jedes Paket wird geprüft und signiert, bevor es in den Katalog kommt. Fadenkreuz, Minikarte und Straßen kannst du selbst in der Werkstatt bauen.",
    openWorkshop: "Werkstatt öffnen",
    sectionNoMods: (name) => `In „${name}“ gibt es noch keine Mods`,
    sectionNoModsNote:
      "Veröffentlichte Mods liegen gerade in anderen Bereichen des Katalogs.",
    subcategoryNoMods: (name) => `In „${name}“ gibt es noch keine Mods`,
    subcategoryNoModsNote: (section) =>
      `Andere Teile von „${section}“ haben schon Veröffentlichungen.`,
    fallbackTitle: "Hier ist noch nichts",
    fallbackNote: "Keine Mod passt zu den gewählten Bedingungen.",
    projectLabel: "Projekt",
    allProjects: "Alle Projekte",
    projectNotes: {
      all: "Mods für jedes Projekt",
      majestic: "nur was auf Majestic läuft",
      gta5rp: "keine Mods mit Vorteil: dafür gibt es Bans",
      russia: "nur was auf Russia Online läuft",
    },
    russiaOnline: "Russia Online",
    filtersLabel: "Katalogfilter",
    sizeLabel: "Größe",
    sizes: { any: "Beliebige Größe", 500: "bis 500 MB", 2000: "bis 2 GB" },
    genderLabel: "Figur",
    genderAll: "Alle",
    clearSearch: "Suche leeren",
    catalogTitle: "Katalog",
    navigatorLabel: "Katalognavigation",
    navigatorHeading: "Bereiche",
    collapseNavigator: "Menü einklappen",
    expandNavigator: "Menü ausklappen",
    favoritesNav: "Favoriten",
  },
  pl: {
    quotes: ["„", "”"],
    sorts: {
      new: "Najnowsze",
      popular: "Popularne",
      downloads: "Najczęściej pobierane",
    },
    categoriesLabel: "Działy katalogu",
    sortLabel: "Sortowanie katalogu",
    sortFilterLabel: "Kolejność i filtry katalogu",
    searchPlaceholder: "Nazwa lub tag",
    searchLabel: "Szukaj w katalogu",
    favoriteAdd: (name) => `Dodaj ${name} do ulubionych`,
    favoriteRemove: (name) => `Usuń ${name} z ulubionych`,
    buildInWorkshop: "Zbuduj w warsztacie",
    loadingNote: (count) =>
      `Katalog jeszcze się wczytuje: na razie ${count}, reszta pojawi się sama.`,
    layoutNote: (query, swapped) =>
      `Dla „${query}” nic nie znaleziono — pokazano wyniki dla „${swapped}”, jakby układ klawiatury był inny.`,
    pendingTitle: "Katalog jeszcze się nie wczytał",
    pendingNote:
      "Astral ponawia sam — publikacje pojawią się tu, gdy usługa odpowie. Warsztat, biblioteka i ustawienia działają bez katalogu.",
    retry: "Ponów",
    loadingTitle: "Katalog jeszcze się wczytuje",
    loadingText:
      "Nie ma tu jeszcze wszystkich publikacji — reszta pojawi się sama za kilka sekund.",
    inFavorites: "w ulubionych",
    inSubcategory: (name) => `w „${name}”`,
    inSection: (name) => `w dziale „${name}”`,
    nothingIn: (scope) => `Nic nie znaleziono ${scope}`,
    elsewhere: (query, count) =>
      `W pozostałej części katalogu dla „${query}”: ${count}.`,
    searchEverywhere: "Szukaj w całym katalogu",
    nothingFound: "Nic nie znaleziono",
    noMatches: (query) => `Dla „${query}” nie ma wyników.`,
    resetSearch: "Wyczyść wyszukiwanie",
    favoritesEmpty: "Brak ulubionych",
    favoritesEmptyNote: "Zaznacz modyfikację serduszkiem — zbierze się tutaj.",
    showWholeCatalog: "Pokaż cały katalog",
    showAllMods: "Pokaż wszystkie mody",
    subcategoryNoPublications: (name) =>
      `W „${name}” nie ma jeszcze publikacji`,
    sectionNoPublications: (name) =>
      `W dziale „${name}” nie ma jeszcze publikacji`,
    workshopNote: (list) =>
      `Za to ${list} możesz zbudować sam — w warsztacie. Gotowa praca instaluje się w grze tak samo jak mod z katalogu.`,
    and: "i",
    showWholeSection: "Pokaż cały dział",
    seeAllSections: "Zobacz wszystkie działy",
    catalogEmpty: "Katalog jest na razie pusty",
    catalogEmptyNote:
      "Żaden dział nie ma jeszcze publikacji: każda paczka przechodzi sprawdzenie i podpis, zanim trafi do katalogu. Celownik, minimapę i drogi możesz zbudować sam — w warsztacie.",
    openWorkshop: "Otwórz warsztat",
    sectionNoMods: (name) => `W dziale „${name}” nie ma jeszcze modyfikacji`,
    sectionNoModsNote:
      "Opublikowane modyfikacje są teraz w innych działach katalogu.",
    subcategoryNoMods: (name) => `W „${name}” nie ma jeszcze modyfikacji`,
    subcategoryNoModsNote: (section) =>
      `Pozostałe części „${section}” mają już publikacje.`,
    fallbackTitle: "Na razie pusto",
    fallbackNote: "Żadna modyfikacja nie pasuje do wybranych warunków.",
    projectLabel: "Projekt",
    allProjects: "Wszystkie projekty",
    projectNotes: {
      all: "mody na każdy projekt",
      majestic: "tylko to, co działa na Majestic",
      gta5rp: "bez modów z przewagą: dostaje się za nie bana",
      russia: "tylko to, co działa na Russia Online",
    },
    russiaOnline: "Russia Online",
    filtersLabel: "Filtry katalogu",
    sizeLabel: "Rozmiar",
    sizes: { any: "Dowolny rozmiar", 500: "do 500 MB", 2000: "do 2 GB" },
    genderLabel: "Postać",
    genderAll: "Wszystkie",
    clearSearch: "Wyczyść wyszukiwanie",
    catalogTitle: "Katalog",
    navigatorLabel: "Nawigacja po katalogu",
    navigatorHeading: "Działy",
    collapseNavigator: "Zwiń menu",
    expandNavigator: "Rozwiń menu",
    favoritesNav: "Ulubione",
  },
  fr: {
    quotes: ["«\u00a0", "\u00a0»"],
    sorts: {
      new: "Récents",
      popular: "Populaires",
      downloads: "Plus téléchargés",
    },
    categoriesLabel: "Catégories du catalogue",
    sortLabel: "Tri du catalogue",
    sortFilterLabel: "Ordre et filtres du catalogue",
    searchPlaceholder: "Nom ou tag",
    searchLabel: "Rechercher dans le catalogue",
    favoriteAdd: (name) => `Ajouter ${name} aux favoris`,
    favoriteRemove: (name) => `Retirer ${name} des favoris`,
    buildInWorkshop: "Assembler dans l'atelier",
    loadingNote: (count) =>
      `Le catalogue se charge encore\u00a0: ${count} pour l'instant, le reste apparaîtra tout seul.`,
    layoutNote: (query, swapped) =>
      `Rien trouvé pour «\u00a0${query}\u00a0» — résultats affichés pour «\u00a0${swapped}\u00a0», comme si la disposition du clavier était différente.`,
    pendingTitle: "Le catalogue n'est pas encore chargé",
    pendingNote:
      "Astral réessaie tout seul — les publications apparaîtront ici dès que le service répondra. L'atelier, la bibliothèque et les paramètres fonctionnent sans le catalogue.",
    retry: "Réessayer",
    loadingTitle: "Le catalogue se charge encore",
    loadingText:
      "Toutes les publications ne sont pas encore là — le reste apparaîtra tout seul dans quelques secondes.",
    inFavorites: "dans les favoris",
    inSubcategory: (name) => `dans la sous-section «\u00a0${name}\u00a0»`,
    inSection: (name) => `dans la section «\u00a0${name}\u00a0»`,
    nothingIn: (scope) => `Rien trouvé ${scope}`,
    elsewhere: (query, count) =>
      `Pour «\u00a0${query}\u00a0», le reste du catalogue compte ${count}.`,
    searchEverywhere: "Rechercher dans tout le catalogue",
    nothingFound: "Rien trouvé",
    noMatches: (query) => `Aucun résultat pour «\u00a0${query}\u00a0».`,
    resetSearch: "Réinitialiser la recherche",
    favoritesEmpty: "Aucun favori",
    favoritesEmptyNote: "Marquez un mod avec le cœur — il apparaîtra ici.",
    showWholeCatalog: "Afficher tout le catalogue",
    showAllMods: "Afficher tous les mods",
    subcategoryNoPublications: (name) =>
      `Pas encore de publications dans la sous-section «\u00a0${name}\u00a0»`,
    sectionNoPublications: (name) =>
      `Pas encore de publications dans la section «\u00a0${name}\u00a0»`,
    workshopNote: (list) =>
      `En revanche, vous pouvez créer vous-même dans l'atelier\u00a0: ${list}. Une création terminée s'installe dans le jeu comme un mod du catalogue.`,
    and: "et",
    showWholeSection: "Afficher toute la section",
    seeAllSections: "Voir toutes les sections",
    catalogEmpty: "Le catalogue est encore vide",
    catalogEmptyNote:
      "Aucune section n'a encore de publications\u00a0: chaque pack est vérifié et signé avant d'arriver dans le catalogue. Vous pouvez créer vous-même un réticule, une minicarte et des routes dans l'atelier.",
    openWorkshop: "Ouvrir l'atelier",
    sectionNoMods: (name) =>
      `Pas encore de mods dans la section «\u00a0${name}\u00a0»`,
    sectionNoModsNote:
      "Les mods publiés se trouvent pour l'instant dans d'autres sections du catalogue.",
    subcategoryNoMods: (name) =>
      `Pas encore de mods dans la sous-section «\u00a0${name}\u00a0»`,
    subcategoryNoModsNote: (section) =>
      `Les autres sous-sections de «\u00a0${section}\u00a0» ont déjà des publications.`,
    fallbackTitle: "Rien ici pour l'instant",
    fallbackNote: "Aucun mod ne correspond aux critères choisis.",
    projectLabel: "Projet",
    allProjects: "Tous les projets",
    projectNotes: {
      all: "mods pour n'importe quel projet",
      majestic: "uniquement ce qui fonctionne sur Majestic",
      gta5rp: "sans mods donnant un avantage\u00a0: ils valent un ban",
      russia: "uniquement ce qui fonctionne sur Russia Online",
    },
    russiaOnline: "Russia Online",
    filtersLabel: "Filtres du catalogue",
    sizeLabel: "Taille",
    sizes: { any: "Toutes tailles", 500: "jusqu'à 500 Mo", 2000: "jusqu'à 2 Go" },
    genderLabel: "Personnage",
    genderAll: "Tous",
    clearSearch: "Effacer la recherche",
    catalogTitle: "Catalogue",
    navigatorLabel: "Navigation du catalogue",
    navigatorHeading: "Sections",
    collapseNavigator: "Réduire le menu",
    expandNavigator: "Développer le menu",
    favoritesNav: "Favoris",
  },
};

/** Слова страницы каталога на языке окна. */
export function catalogWordsFor(language) {
  const lang = catalogLanguage(language);
  return {
    ...COPY[lang],
    language: lang,
    locale: CATALOG_LOCALES[lang],
    label: (text) => catalogLabel(text, lang),
    publications: (count) => countOf(lang, count, "publications"),
    modifications: (count) => countOf(lang, count, "mods"),
    /* Раздел «Редуксы» считает редуксы, карточка редукса — его части. */
    reduxes: (count) => countOf(lang, count, "reduxes"),
    parts: (count) => countOf(lang, count, "parts"),
    /* Карточка редукса считает его компоненты (владелец 13.11.2026), а не части, попавшие на полки. */
    components: (count) => countOf(lang, count, "components"),
  };
}
