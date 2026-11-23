/* locale-self-contained: названия значков и разделов написаны здесь на всех языках окна, словарь `ui-text` им не нужен. */
/*
 * Каталог значков карты игры для «Иконок» большой карты (05.11.2026): какие номера спрайтов показывать по разделам и как их
 * называть. Картинки здесь не лежат — их окно получает из файлов игры игрока (`readBlipIcons`): настоящие клетки листов значков.
 *
 * Разделы и подборка — свои, по смыслу значков (что это за место), а не списком чужого редактора. Подборка — те номера, что
 * серверы ставят на карту чаще всего: магазины и услуги, больницы и участки, транспорт, недвижимость, гонки. Всё остальное, что
 * можно заменить, идёт в раздел «Остальные значки игры» под именем символа из файла игры (`radar_*`) — это имя самой игры.
 *
 * Названия — на ru, uk, en, de, pl, fr. Название значка — это то, что на нём нарисовано и как зовёт его игра, а не обещание, что
 * сервер поставит его на то же место: сервер сам выбирает номер спрайта для каждого своего заведения.
 *
 * «Бизнесы серверов» (`servers`) — названия типов бизнесов, как они стоят на вики серверов, там, где у типа есть общепринятый
 * значок игры: «Магазин одежды» → рубашка (73), «Оружейный магазин» → пистолет (110) и так далее. Номер спрайта серверы не
 * публикуют, поэтому это соответствие по смыслу значка, а не выписка из клиента сервера (клиент Majestic зашифрован, к нему
 * Astral не обращается). Источники и дата снятия: Majestic — https://wiki.majestic-rp.ru/ru/businesses,
 * GTA5RP — https://wiki.gta5rp.com/businesses (05.11.2026).
 */

const n = (ru, uk, en, de, pl, fr) => ({ ru, uk, en, de, pl, fr });

export const BLIP_CATEGORIES = Object.freeze([
  { id: "city", title: n("Места города", "Місця міста", "City places", "Orte der Stadt", "Miejsca w mieście", "Lieux de la ville") },
  { id: "shops", title: n("Магазины и услуги", "Магазини та послуги", "Shops and services", "Geschäfte und Dienste", "Sklepy i usługi", "Commerces et services") },
  { id: "vehicles", title: n("Транспорт", "Транспорт", "Vehicles", "Fahrzeuge", "Transport", "Véhicules") },
  { id: "property", title: n("Недвижимость и бизнес", "Нерухомість і бізнес", "Property and business", "Immobilien und Geschäft", "Nieruchomości i biznes", "Immobilier et commerce") },
  { id: "crime", title: n("Преступный мир", "Злочинний світ", "Crime", "Unterwelt", "Półświatek", "Pègre") },
  { id: "race", title: n("Гонки и состязания", "Перегони та змагання", "Races and contests", "Rennen und Wettkämpfe", "Wyścigi i zawody", "Courses et compétitions") },
  { id: "misc", title: n("Разное", "Різне", "Miscellaneous", "Verschiedenes", "Różne", "Divers") },
]);

/** Раздел со всем остальным, что можно заменить: он собирается из таблицы игры, а не из подборки. */
export const BLIP_REST_CATEGORY = Object.freeze({
  id: "rest",
  title: n("Остальные значки игры", "Решта значків гри", "Other game icons", "Weitere Spielsymbole", "Pozostałe ikony gry", "Autres icônes du jeu"),
});

const server = (majestic, gta5rp) => ({ ...(majestic ? { majestic } : null), ...(gta5rp ? { gta5rp } : null) });

/* [номер спрайта, раздел, названия, бизнесы серверов]. */
const ROWS = [
  /* Места города */
  [61, "city", n("Больница", "Лікарня", "Hospital", "Krankenhaus", "Szpital", "Hôpital")],
  [60, "city", n("Полицейский участок", "Поліцейська дільниця", "Police station", "Polizeiwache", "Komisariat policji", "Commissariat")],
  [137, "city", n("Полицейский участок (синий)", "Поліцейська дільниця (синя)", "Police station (blue)", "Polizeiwache (blau)", "Komisariat (niebieski)", "Commissariat (bleu)")],
  [90, "city", n("Лётная школа", "Льотна школа", "Flight school", "Flugschule", "Szkoła lotnicza", "École de pilotage")],
  [63, "city", n("Лифт", "Ліфт", "Elevator", "Aufzug", "Winda", "Ascenseur")],
  [36, "city", n("Канатная дорога", "Канатна дорога", "Cable car", "Seilbahn", "Kolejka linowa", "Téléphérique")],
  [198, "city", n("Такси", "Таксі", "Taxi", "Taxi", "Taksówka", "Taxi")],
  [162, "city", n("Место интереса", "Цікаве місце", "Point of interest", "Sehenswürdigkeit", "Ciekawe miejsce", "Point d'intérêt")],
  [184, "city", n("Камера", "Камера", "Camera", "Kamera", "Kamera", "Caméra")],
  [85, "city", n("Экскурсии по Вайнвуду", "Екскурсії Вайнвудом", "Vinewood tours", "Vinewood-Touren", "Wycieczki po Vinewood", "Visites de Vinewood")],
  [266, "city", n("Парк аттракционов", "Парк атракціонів", "Fairground", "Jahrmarkt", "Wesołe miasteczko", "Fête foraine")],
  [135, "city", n("Кинотеатр", "Кінотеатр", "Cinema", "Kino", "Kino", "Cinéma")],
  [136, "city", n("Концертный клуб", "Концертний клуб", "Music venue", "Musikclub", "Klub muzyczny", "Salle de concert")],
  [102, "city", n("Клуб комиков", "Клуб коміків", "Comedy club", "Comedy-Club", "Klub komediowy", "Club d'humour")],
  [121, "city", n("Стриптиз-клуб", "Стриптиз-клуб", "Strip club", "Stripclub", "Klub ze striptizem", "Club de strip-tease")],
  [93, "city", n("Бар", "Бар", "Bar", "Bar", "Bar", "Bar")],
  [119, "city", n("Тир", "Тир", "Shooting range", "Schießstand", "Strzelnica", "Stand de tir")],
  [109, "city", n("Гольф", "Гольф", "Golf", "Golf", "Golf", "Golf")],
  [358, "city", n("Лунка для гольфа", "Лунка для гольфу", "Golf hole", "Golfloch", "Dołek golfowy", "Trou de golf")],
  [122, "city", n("Теннис", "Теніс", "Tennis", "Tennis", "Tenis", "Tennis")],
  [103, "city", n("Дартс", "Дартс", "Darts", "Darts", "Rzutki", "Fléchettes")],
  [197, "city", n("Йога", "Йога", "Yoga", "Yoga", "Joga", "Yoga")],
  [141, "city", n("Охота", "Полювання", "Hunting", "Jagd", "Polowanie", "Chasse")],
  [94, "city", n("Бейсджампинг", "Бейсджампінг", "BASE jumping", "BASE-Jumping", "BASE jumping", "Saut BASE")],
  [377, "city", n("Парашют", "Парашут", "Parachute", "Fallschirm", "Spadochron", "Parachute")],
  [40, "city", n("Убежище", "Схованка", "Safehouse", "Unterschlupf", "Kryjówka", "Planque")],

  /* Магазины и услуги */
  [52, "shops", n("Магазин 24/7", "Магазин 24/7", "24/7 store", "24/7-Laden", "Sklep 24/7", "Magasin 24/7"), server("Магазин 24/7", "24/7")],
  [73, "shops", n("Магазин одежды", "Магазин одягу", "Clothes store", "Bekleidungsgeschäft", "Sklep odzieżowy", "Magasin de vêtements"), server("Магазин одежды", "Магазины одежды")],
  [71, "shops", n("Барбершоп", "Барбершоп", "Barber shop", "Friseur", "Barber shop", "Barbier"), server("Барбершоп", "Барбершопы")],
  [75, "shops", n("Тату-салон", "Тату-салон", "Tattoo parlour", "Tattoo-Studio", "Salon tatuażu", "Salon de tatouage"), server("Тату-салон", "Тату салоны")],
  [110, "shops", n("Оружейный магазин", "Збройовий магазин", "Gun shop", "Waffenladen", "Sklep z bronią", "Armurerie"), server("Оружейный магазин", "Оружейные магазины")],
  [313, "shops", n("Оружейный магазин с тиром", "Збройовий магазин із тиром", "Gun shop with range", "Waffenladen mit Schießstand", "Sklep z bronią ze strzelnicą", "Armurerie avec stand de tir")],
  [72, "shops", n("Тюнинг-салон", "Тюнінг-салон", "Mod shop", "Tuning-Werkstatt", "Warsztat tuningowy", "Atelier de tuning"), server("Тюнинг салон", "")],
  [100, "shops", n("Автомойка", "Автомийка", "Car wash", "Autowäsche", "Myjnia samochodowa", "Station de lavage"), server("Автомойка", "")],
  [361, "shops", n("Канистра с топливом", "Каністра з пальним", "Fuel can", "Benzinkanister", "Kanister z paliwem", "Jerrican de carburant"), server("Заправка", "АЗС")],
  [108, "shops", n("Деньги, крупный «$»", "Гроші, великий «$»", "Money, large “$”", "Geld, großes „$“", "Pieniądze, duże „$”", "Argent, grand dollar")],
  [272, "shops", n("Деньги, малый «$»", "Гроші, малий «$»", "Money, small “$”", "Geld, kleines „$“", "Pieniądze, małe „$”", "Argent, petit dollar")],
  [207, "shops", n("Деньги, серый «$»", "Гроші, сірий «$»", "Money, grey “$”", "Geld, graues „$“", "Pieniądze, szare „$”", "Argent, dollar gris")],
  [140, "shops", n("Конопля", "Конопля", "Cannabis leaf", "Hanfblatt", "Liść konopi", "Feuille de cannabis")],

  /* Транспорт */
  [357, "vehicles", n("Гараж", "Гараж", "Garage", "Garage", "Garaż", "Garage")],
  [524, "vehicles", n("Склад машин", "Склад машин", "Vehicle warehouse", "Fahrzeuglager", "Magazyn pojazdów", "Entrepôt de véhicules")],
  [359, "vehicles", n("Ангар", "Ангар", "Hangar", "Hangar", "Hangar", "Hangar")],
  [360, "vehicles", n("Вертолётная площадка", "Гелікоптерний майданчик", "Helipad", "Hubschrauberlandeplatz", "Lądowisko dla helikopterów", "Héliport")],
  [356, "vehicles", n("Пристань", "Пристань", "Dock", "Anlegestelle", "Przystań", "Quai")],
  [64, "vehicles", n("Вертолёт", "Гелікоптер", "Helicopter", "Hubschrauber", "Helikopter", "Hélicoptère")],
  [523, "vehicles", n("Спорткар", "Спорткар", "Sports car", "Sportwagen", "Samochód sportowy", "Voiture de sport")],
  [225, "vehicles", n("Машина", "Машина", "Car", "Auto", "Samochód", "Voiture")],
  [226, "vehicles", n("Мотоцикл", "Мотоцикл", "Motorbike", "Motorrad", "Motocykl", "Moto")],
  [513, "vehicles", n("Автобус", "Автобус", "Bus", "Bus", "Autobus", "Bus")],
  [477, "vehicles", n("Грузовик", "Вантажівка", "Truck", "Lkw", "Ciężarówka", "Camion")],
  [318, "vehicles", n("Фургон", "Фургон", "Box truck", "Kastenwagen", "Furgon", "Fourgon")],
  [479, "vehicles", n("Прицеп", "Причіп", "Trailer", "Anhänger", "Przyczepa", "Remorque")],
  [68, "vehicles", n("Эвакуатор", "Евакуатор", "Tow truck", "Abschleppwagen", "Laweta", "Dépanneuse")],
  [317, "vehicles", n("Буксировка", "Буксирування", "Tow", "Abschleppen", "Holowanie", "Remorquage")],
  [527, "vehicles", n("Свалка", "Звалище", "Junkyard", "Schrottplatz", "Złomowisko", "Casse automobile")],
  [410, "vehicles", n("Парусная лодка", "Вітрильний човен", "Sailboat", "Segelboot", "Żaglówka", "Voilier")],
  [404, "vehicles", n("Катер", "Катер", "Motorboat", "Motorboot", "Motorówka", "Bateau à moteur")],
  [308, "vehicles", n("Подводная лодка", "Підводний човен", "Submarine", "U-Boot", "Łódź podwodna", "Sous-marin")],
  [401, "vehicles", n("Дирижабль", "Дирижабль", "Blimp", "Luftschiff", "Sterowiec", "Dirigeable")],
  [421, "vehicles", n("Танк", "Танк", "Tank", "Panzer", "Czołg", "Char")],
  [326, "vehicles", n("Машина для побега", "Машина для втечі", "Getaway car", "Fluchtauto", "Samochód do ucieczki", "Voiture de fuite")],

  /* Недвижимость и бизнес */
  [267, "property", n("Недвижимость", "Нерухомість", "Property", "Immobilie", "Nieruchomość", "Bien immobilier")],
  [374, "property", n("Бизнес", "Бізнес", "Business", "Geschäft", "Biznes", "Commerce")],
  [473, "property", n("Склад", "Склад", "Warehouse", "Lagerhaus", "Magazyn", "Entrepôt")],
  [475, "property", n("Офис", "Офіс", "Office", "Büro", "Biuro", "Bureau")],
  [492, "property", n("Клуб байкеров", "Клуб байкерів", "Biker clubhouse", "Biker-Clubhaus", "Klub motocyklistów", "Local de motards")],
  [411, "property", n("База", "База", "Base", "Basis", "Baza", "Base")],
  [176, "property", n("Захват собственности", "Захоплення власності", "Property takeover", "Übernahme einer Immobilie", "Przejęcie nieruchomości", "Prise de contrôle d'un bien")],

  /* Преступный мир */
  [50, "crime", n("Угон машины", "Викрадення авто", "Car theft", "Autodiebstahl", "Kradzież samochodu", "Vol de voiture")],
  [51, "crime", n("Наркотики", "Наркотики", "Drugs", "Drogen", "Narkotyki", "Drogues")],
  [47, "crime", n("Информатор", "Інформатор", "Snitch", "Informant", "Informator", "Indic")],
  [59, "crime", n("Ограбление", "Пограбування", "Heist", "Raubüberfall", "Napad", "Braquage")],
  [80, "crime", n("Ограбление ювелирного", "Пограбування ювелірного", "Jewelry heist", "Juwelenraub", "Napad na jubilera", "Braquage de bijouterie")],
  [252, "crime", n("Наручники", "Кайданки", "Handcuffs", "Handschellen", "Kajdanki", "Menottes")],
  [134, "crime", n("Ключ от наручников", "Ключ від кайданків", "Handcuff key", "Handschellenschlüssel", "Klucz do kajdanek", "Clé de menottes")],
  [362, "crime", n("Маска", "Маска", "Mask", "Maske", "Maska", "Masque")],
  [147, "crime", n("Торговля оружием", "Торгівля зброєю", "Arms dealing", "Waffenhandel", "Handel bronią", "Trafic d'armes")],
  [84, "crime", n("Бойня", "Бійня", "Rampage", "Amoklauf", "Rzeź", "Massacre")],

  /* Гонки и состязания */
  [38, "race", n("Флаг гонки", "Прапор перегонів", "Race flag", "Rennflagge", "Flaga wyścigu", "Drapeau de course")],
  [309, "race", n("Гонка", "Перегони", "Race", "Rennen", "Wyścig", "Course")],
  [315, "race", n("Гонка на машинах", "Перегони на авто", "Car race", "Autorennen", "Wyścig samochodów", "Course de voitures")],
  [314, "race", n("Воздушная гонка", "Повітряні перегони", "Air race", "Luftrennen", "Wyścig powietrzny", "Course aérienne")],
  [316, "race", n("Водная гонка", "Водні перегони", "Sea race", "Wasserrennen", "Wyścig wodny", "Course nautique")],
  [376, "race", n("Велогонка", "Велоперегони", "Bike race", "Radrennen", "Wyścig rowerowy", "Course de vélos")],
  [379, "race", n("Забег", "Забіг", "Foot race", "Laufrennen", "Bieg", "Course à pied")],
  [127, "race", n("Внедорожные гонки", "Позашляхові перегони", "Off-road racing", "Geländerennen", "Wyścigi terenowe", "Courses tout-terrain")],
  [126, "race", n("Триатлон", "Тріатлон", "Triathlon", "Triathlon", "Triathlon", "Triathlon")],
  [310, "race", n("Дефматч", "Дефматч", "Deathmatch", "Deathmatch", "Deathmatch", "Combat à mort")],
  [378, "race", n("Командный дефматч", "Командний дефматч", "Team deathmatch", "Team-Deathmatch", "Drużynowy deathmatch", "Combat à mort par équipes")],
  [311, "race", n("Армрестлинг", "Армреслінг", "Arm wrestling", "Armdrücken", "Siłowanie na rękę", "Bras de fer")],
  [408, "race", n("Захват флага", "Захоплення прапора", "Capture the flag", "Flaggenjagd", "Zdobądź flagę", "Capture du drapeau")],
  [409, "race", n("Последняя команда", "Остання команда", "Last team standing", "Letztes Team", "Ostatnia drużyna", "Dernière équipe en lice")],

  /* Разное */
  [153, "misc", n("Здоровье", "Здоров’я", "Health", "Gesundheit", "Zdrowie", "Santé")],
  [175, "misc", n("Бронежилет", "Бронежилет", "Body armour", "Schutzweste", "Kamizelka kuloodporna", "Gilet pare-balles")],
  [163, "misc", n("Пассивный режим", "Пасивний режим", "Passive mode", "Passiver Modus", "Tryb pasywny", "Mode passif")],
  [164, "misc", n("Игрок в меню", "Гравець у меню", "Player in a menu", "Spieler im Menü", "Gracz w menu", "Joueur dans un menu")],
  [354, "misc", n("Ускорение", "Прискорення", "Boost", "Boost", "Przyspieszenie", "Accélération")],
  [365, "misc", n("Точка появления", "Точка появи", "Spawn point", "Spawnpunkt", "Punkt odrodzenia", "Point d'apparition")],
  [367, "misc", n("Выполнено", "Виконано", "Completed", "Erledigt", "Ukończono", "Terminé")],
  [368, "misc", n("Ракеты", "Ракети", "Rockets", "Raketen", "Rakiety", "Roquettes")],
  [280, "misc", n("Друг", "Друг", "Friend", "Freund", "Przyjaciel", "Ami")],
  [306, "misc", n("Сброс груза", "Скидання вантажу", "Crate drop", "Kistenabwurf", "Zrzut skrzyni", "Largage de caisse")],
  [351, "misc", n("Пакет", "Пакет", "Package", "Paket", "Paczka", "Colis")],
  [304, "misc", n("Своя миссия", "Власна місія", "Custom mission", "Eigene Mission", "Własna misja", "Mission personnalisée")],
];

const entry = ([sprite, category, names, servers]) => Object.freeze({ sprite, category, names: Object.freeze(names), servers: Object.freeze(servers ?? {}) });

export const BLIP_CATALOG = Object.freeze(ROWS.map(entry));

const BY_SPRITE = new Map(BLIP_CATALOG.map((item) => [item.sprite, item]));

/** Запись каталога по номеру спрайта или `undefined` (значок только в «Остальных»). */
export const blipCatalogEntry = (sprite) => BY_SPRITE.get(sprite);

/** Строка на языке окна: нет перевода — английская, а нет и её — русская. */
export const blipText = (names, language) => names[language] || names.en || names.ru;

/** Имя из символа игры: `radar_arena_trap_bomb` → «arena trap bomb» (имя самой игры, без перевода). */
export const humanSymbol = (symbol) => String(symbol || "").replace(/^radar_/, "").replaceAll("_", " ");

/** Название значка для показа: из каталога на языке окна, иначе — по имени символа игры. */
export function blipTitle(sprite, symbol, language) {
  const found = BY_SPRITE.get(sprite);
  return found ? blipText(found.names, language) : humanSymbol(symbol);
}

/** Раздел по умолчанию для номера: подборка каталога или «Остальные значки игры». */
export const blipCategoryOf = (sprite) => BY_SPRITE.get(sprite)?.category ?? BLIP_REST_CATEGORY.id;

export const BLIP_SERVERS = Object.freeze({
  majestic: Object.freeze({ title: "Majestic RP", source: "https://wiki.majestic-rp.ru/ru/businesses", date: "2026-11-05" }),
  gta5rp: Object.freeze({ title: "GTA 5 RP", source: "https://wiki.gta5rp.com/businesses", date: "2026-11-05" }),
});
