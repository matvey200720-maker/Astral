/*
 * Плитки полки Redux, которых нет в таксономии каталога.
 *
 * За ними стоят редакторы мастерской, а не моды каталога, поэтому страница
 * добавляет их сама — после плиток таксономии и в этом порядке.
 */

import { isWorkshopEditorHidden } from "../../../features/workshop/hidden-editors.js";

const reduxInteriorSlot = {
  id: "interior",
  title: {
    ru: "Интерьеры", uk: "Інтер'єри",
    en: "Interiors",
    de: "Innenräume",
    pl: "Wnętrza",
    fr: "Intérieurs",
  },
  description: {
    ru: "Помещения, материалы и освещение", uk: "Приміщення, матеріали й освітлення",
    en: "Rooms, materials and lighting",
    de: "Räume, Materialien und Beleuchtung",
    pl: "Wnętrza, materiały i oświetlenie",
    fr: "Pièces, matériaux et éclairage",
  },
};

/*
 * Залазы — метки паркура для RP-серверов.
 *
 * Плитка была только в разделе «Прочее», куда из мастерской не заходят, и
 * человек не мог открыть редактор залазов вовсе. Редактор есть и ставит их в
 * игру, поэтому плитка стоит там же, где остальные редакторы мира.
 */
const reduxClimbingSlot = {
  id: "climbing",
  title: {
    ru: "Залазы", uk: "Залази",
    en: "Climbing",
    de: "Klettern",
    pl: "Wspinaczka",
    fr: "Escalade",
  },
  description: {
    ru: "Метки паркура: вид и цвет", uk: "Позначки паркуру: вигляд і колір",
    en: "Parkour markers: style, colour",
    de: "Parkour-Marker: Stil, Farbe",
    pl: "Znaczniki parkour: styl, kolor",
    fr: "Marqueurs de parkour\u00a0: style et couleur",
  },
};

/*
 * Прострелы — подсветка простреливаемых укрытий на каптах. Плитка рядом с
 * залазами: мод у них один и автор один, но редакторы и установка — свои.
 */
const reduxWallbangSlot = {
  id: "wallbang",
  title: {
    ru: "Прострелы", uk: "Прострели",
    en: "Wallbangs",
    de: "Durchschüsse",
    pl: "Przestrzały",
    fr: "Wallbangs",
  },
  description: {
    ru: "Подсветка укрытий для прострела", uk: "Підсвітка укриттів для прострілу",
    en: "Shoot-through cover highlight",
    de: "Durchschießbare Deckung markieren",
    pl: "Podświetlenie osłon do przestrzału",
    fr: "Surbrillance des abris traversables par les balles",
  },
};

/*
 * Зоны — оболочки двух модов: зелёные зоны и запретные для капта (мод
 * `gucci`): цвет с эффектом и прозрачность, от невидимых до сплошных.
 * Рядом с прострелами — тоже метки на картах каптов. Id прежний: под ним
 * лежат установки и работы.
 */
const reduxForbiddenZonesSlot = {
  id: "forbidden-zones",
  title: {
    ru: "Зоны", uk: "Зони",
    en: "Zones",
    de: "Zonen",
    pl: "Strefy",
    fr: "Zones",
  },
  /* С 17.10.2026 (задача 12) — ещё бизвар, ВЗХ и порт. */
  description: {
    ru: "Зелёные, запретные, бизвар, ВЗХ и порт", uk: "Зелені, заборонені, бізвар, ВЗХ і порт",
    en: "Green, no-capture, bizwar, VZKh and port",
    de: "Grüne, Sperrzonen, Bizwar, VZKh und Hafen",
    pl: "Zielone, zakazane, bizwar, VZKh i port",
    fr: "Zones vertes, interdites, bizwar, VZKh et port",
  },
};

/*
 * «Зоны каптов» — шайбы мода `heix` над тринадцатью каптами и ареной: цвет
 * и прозрачность каждой и всех сразу (задача 8 ТЗ 10.10.2026, вечер). Рядом
 * с запретными зонами — тоже карты каптов.
 */
const reduxCaptZonesSlot = {
  id: "capt-zones",
  title: {
    ru: "Зоны каптов", uk: "Зони каптів",
    en: "Capture zones",
    de: "Eroberungszonen",
    pl: "Strefy przejęć",
    fr: "Zones de capture",
  },
  description: {
    ru: "Цвет и прозрачность зон каптов и арены", uk: "Колір і прозорість зон капту та арени",
    en: "Colour and transparency of capture zones and the arena",
    de: "Farbe und Transparenz der Eroberungszonen und der Arena",
    pl: "Kolor i przezroczystość stref przejęć i areny",
    fr: "Couleur et transparence des zones de capture et de l'arène",
  },
};

/*
 * Завод — мод «серого» завода в пустыне (cs4_13): цвет корпусов, земли,
 * контейнеров и реквизита, радуга.
 */
const reduxFactorySlot = {
  id: "factory",
  title: {
    ru: "Завод", uk: "Завод",
    en: "Factory",
    de: "Fabrik",
    pl: "Fabryka",
    fr: "Usine",
  },
  description: {
    ru: "Отделка корпусов и контейнеров", uk: "Оздоблення корпусів і контейнерів",
    en: "Finish of halls and containers",
    de: "Hallen und Container gestalten",
    pl: "Wykończenie hal i kontenerów",
    fr: "Finition des bâtiments et des conteneurs",
  },
};

/*
 * Ангар аэропорта — цвет каркаса снаружи и внутри, своя эмблема, техника
 * вокруг.
 */
const reduxHangarSlot = {
  id: "hangar",
  title: {
    ru: "Ангар", uk: "Ангар",
    en: "Hangar",
    de: "Hangar",
    pl: "Hangar",
    fr: "Hangar",
  },
  description: {
    ru: "Отделка, эмблема и свет ангара", uk: "Оздоблення, емблема й світло ангара",
    en: "Hangar finish, emblem and light",
    de: "Hangar: Oberfläche, Emblem, Licht",
    pl: "Hangar: wykończenie, emblemat",
    fr: "Finition, emblème et lumière du hangar",
  },
};

/* «Ашан / Икея» — гипермаркет You Tool из игры игрока: правка мира, а не
   интерьера; плитка открывает редактор здания (место `youtool`). */
const reduxAshanSlot = {
  id: "ashan",
  title: {
    ru: "Ашан / Икея", uk: "Ашан / Ікеа",
    en: "Auchan / IKEA",
    de: "Auchan / IKEA",
    pl: "Auchan / IKEA",
    fr: "Auchan / IKEA",
  },
  description: {
    ru: "Название, цвет и логотипы", uk: "Назва, колір і логотипи",
    en: "Store name, colours and logos",
    de: "Ladenname, Farben und Logos",
    pl: "Nazwa sklepu, kolory i loga",
    fr: "Nom, couleur et logos",
  },
};

/* «Вайнвуд» — надпись VINEWOOD на холме: своё слово, логотип или чистый склон. */
const reduxVinewoodSlot = {
  id: "vinewood",
  title: {
    ru: "Вайнвуд", uk: "Вайнвуд",
    en: "Vinewood sign",
    de: "Vinewood-Schriftzug",
    pl: "Napis Vinewood",
    fr: "Panneau Vinewood",
  },
  description: {
    ru: "Своё слово или логотип на холме", uk: "Власне слово або логотип на пагорбі",
    en: "Your word or logo on the hill",
    de: "Eigenes Wort oder Logo am Hügel",
    pl: "Własne słowo lub logo na wzgórzu",
    fr: "Votre propre mot ou logo sur la colline",
  },
};

/* «Остановки» — автобусные остановки всей карты: цвет, текстура, прозрачность. */
const reduxBusStopsSlot = {
  id: "busstops",
  title: {
    ru: "Остановки", uk: "Зупинки",
    en: "Bus stops",
    de: "Bushaltestellen",
    pl: "Przystanki",
    fr: "Arrêts",
  },
  description: {
    ru: "Цвет, текстура и прозрачность остановок", uk: "Колір, текстура й прозорість зупинок",
    en: "Bus stop colour, texture and opacity",
    de: "Farbe, Textur und Transparenz",
    pl: "Kolor, tekstura i przezroczystość",
    fr: "Couleur, texture et transparence des arrêts de bus",
  },
};

/* «МСЛ-зоны» — линии зон на земле: дальность, цвет, ширина, стенки (ТЗ 08.10). */
const reduxMslZonesSlot = {
  id: "msl-zones",
  title: {
    ru: "МСЛ-зоны", uk: "МСЛ-зони",
    en: "Ground zone lines",
    de: "Zonenlinien am Boden",
    pl: "Linie stref na ziemi",
    fr: "Lignes de zones au sol",
  },
  description: {
    ru: "Линии зон на земле: цвет, ширина, стенки", uk: "Лінії зон на землі: колір, ширина, стінки",
    en: "Zone lines on the ground: colour, width, walls",
    de: "Zonenlinien: Farbe, Breite, Wände",
    pl: "Linie stref: kolor, szerokość, ściany",
    fr: "Lignes de zones au sol\u00a0: couleur, largeur, parois",
  },
};

/* «Летающее лого» — своя картинка или надпись над центром города (ТЗ 08.10). */
const reduxFloatLogoSlot = {
  id: "float-logo",
  title: {
    ru: "Летающее лого", uk: "Літаюче лого",
    en: "Flying logo",
    de: "Schwebendes Logo",
    pl: "Latające logo",
    fr: "Logo flottant",
  },
  description: {
    ru: "Своя картинка или надпись над центром города", uk: "Власна картинка або напис над центром міста",
    en: "Your picture or text above downtown",
    de: "Eigenes Bild oder Text über der Innenstadt",
    pl: "Własny obraz lub napis nad centrum",
    fr: "Votre propre image ou texte au-dessus du centre-ville",
  },
};

/* «Дирижабли» (ТЗ 11.10.2026) — облик дирижабля игры и что летает в небе. */
const reduxAirshipsSlot = {
  id: "airships",
  title: {
    ru: "Дирижабли", uk: "Дирижаблі",
    en: "Airships",
    de: "Luftschiffe",
    pl: "Sterowce",
    fr: "Dirigeables",
  },
  description: {
    ru: "Своя надпись на дирижабле, драконы, шары и НЛО в небе", uk: "Власний напис на дирижаблі, дракони, кулі й НЛО в небі",
    en: "Your text on the blimp, dragons, balloons and UFOs in the sky",
    de: "Eigener Schriftzug am Luftschiff, Drachen, Ballons und UFOs am Himmel",
    pl: "Własny napis na sterowcu, smoki, balony i UFO na niebie",
    fr: "Votre propre inscription sur le dirigeable, dragons, ballons et OVNI dans le ciel",
  },
};

/* «Интерьеры» — магазины и заведения изнутри (задача 3 ТЗ 10.10.2026). */
const reduxShopsSlot = {
  id: "shops",
  title: {
    ru: "Интерьеры магазинов", uk: "Інтер'єри магазинів",
    en: "Shop interiors",
    de: "Ladeninnenräume",
    pl: "Wnętrza sklepów",
    fr: "Intérieurs des magasins",
  },
  description: {
    /* интерьеры: только изнутри (12.10) — улицу (фасады, заправки с колонками) редактор больше не правит. */
    ru: "24/7, одежда, банки, клубы, LTD — стены, пол, вещи изнутри", uk: "24/7, одяг, банки, клуби, LTD — стіни, підлога, речі зсередини",
    en: "24/7, clothing, banks, clubs, LTD — walls, floor, fixtures inside",
    de: "24/7, Kleidung, Banken, Clubs, LTD — Wände, Boden, Einrichtung innen",
    pl: "24/7, odzież, banki, kluby, LTD — ściany, podłoga, wyposażenie w środku",
    fr: "24/7, vêtements, banques, clubs, LTD — murs, sol, objets à l'intérieur",
  },
};

/* «Билборды» — рекламные щиты всей карты (задача 4 ТЗ 10.10.2026, вечер). */
const reduxBillboardsSlot = {
  id: "billboards",
  title: {
    ru: "Билборды", uk: "Білборди",
    en: "Billboards",
    de: "Werbetafeln",
    pl: "Billboardy",
    fr: "Panneaux publicitaires",
  },
  description: {
    ru: "Своя картинка на щитах — на крышах и у дорог, на всех или по одному", uk: "Власна картинка на щитах — на дахах і біля доріг, на всіх або по одному",
    en: "Your picture on billboards — rooftops and roadsides, all or one by one",
    de: "Eigenes Bild auf Werbetafeln — auf Dächern und an Straßen, alle oder einzeln",
    pl: "Własny obraz na billboardach — na dachach i przy drogach, wszystkie lub po jednym",
    fr: "Votre propre image sur les panneaux — sur les toits et au bord des routes, tous ou un par un",
  },
};

/* «Баннеры на зданиях» (задача 7 ТЗ 18.10.2026): большие полотна на высотках, видно на целом здании. */
const reduxBannersSlot = {
  id: "banners",
  title: {
    ru: "Баннеры на зданиях", uk: "Банери на будівлях",
    en: "Building banners",
    de: "Banner an Gebäuden",
    pl: "Banery na budynkach",
    fr: "Bannières sur les bâtiments",
  },
  description: {
    ru: "Большие рекламные полотна на высотках, банке и ТЦ — на целом здании в 3D, каждое по одному", uk: "Великі рекламні полотна на висотках, банку й ТЦ — на цілій будівлі в 3D, кожне окремо",
    en: "Big ad banners on towers, the bank and the mall — on the whole building in 3D, one by one",
    de: "Große Werbebanner an Hochhäusern, Bank und Einkaufszentrum — am ganzen Gebäude in 3D, einzeln",
    pl: "Duże banery reklamowe na wieżowcach, banku i w centrum handlowym — na całym budynku w 3D, po jednym",
    fr: "Grandes toiles publicitaires sur les tours, la banque et le centre commercial — sur tout le bâtiment en 3D, une par une",
  },
};

/*
 * «Расписание» — табло расписания сервера Majestic по штату (задача 11 ТЗ
 * 10.10.2026, вечер): время, названия и значки строк, цвета и прозрачность.
 * Рядом со щитами — тоже щиты над улицами.
 */
const reduxScheduleSlot = {
  id: "schedule",
  title: {
    ru: "Расписание", uk: "Розклад",
    en: "Schedule board",
    de: "Zeitplan-Tafel",
    pl: "Tablica harmonogramu",
    fr: "Tableau des horaires",
  },
  description: {
    ru: "Табло расписания Majestic: свои строки, время, текст, значки, цвет и прозрачность", uk: "Табло розкладу Majestic: власні рядки, час, текст, значки, колір і прозорість",
    en: "Majestic schedule board: own rows, times, text, icons, colour and transparency",
    de: "Majestic-Zeitplantafel: eigene Zeilen, Zeiten, Text, Symbole, Farbe und Transparenz",
    pl: "Tablica harmonogramu Majestic: własne wiersze, godziny, tekst, ikony, kolor i przezroczystość",
    fr: "Tableau des horaires de Majestic\u00a0: vos propres lignes, heures, texte, icônes, couleur et transparence",
  },
};

/*
 * «Флаги» — флаги на флагштоках всей карты (задача 7 ТЗ 10.10.2026, вечер):
 * страна из шаблонов или своя картинка, ткань и ветер штатные.
 */
const reduxFlagsSlot = {
  id: "flags",
  title: {
    ru: "Флаги", uk: "Прапори",
    en: "Flags",
    de: "Flaggen",
    pl: "Flagi",
    fr: "Drapeaux",
  },
  description: {
    ru: "Свой флаг на флагштоках карты — страна или картинка, развевается как в игре", uk: "Власний прапор на флагштоках карти — країна або картинка, що майорить, як у грі",
    en: "Your flag on the map's flagpoles — a country or a picture, waving as in the game",
    de: "Eigene Flagge an den Fahnenmasten — Land oder Bild, weht wie im Spiel",
    pl: "Własna flaga na masztach — kraj lub obraz, powiewa jak w grze",
    fr: "Votre propre drapeau sur les mâts de la carte — un pays ou une image, qui flotte comme dans le jeu",
  },
};

/*
 * «Банкоматы» — банкоматы всей карты (задача 4 ТЗ 17.10.2026): цвет
 * корпуса и панели, своя картинка экрана и вывески, свечение — у всех
 * банкоматов модели разом.
 */
const reduxAtmsSlot = {
  id: "atms",
  title: {
    ru: "Банкоматы", uk: "Банкомати",
    en: "ATMs",
    de: "Geldautomaten",
    pl: "Bankomaty",
    fr: "Distributeurs",
  },
  description: {
    ru: "Цвет корпуса, свой экран и вывеска — у всех банкоматов карты", uk: "Колір корпусу, власний екран і вивіска — в усіх банкоматів карти",
    en: "Body colour, your own screen and sign — on every ATM on the map",
    de: "Gehäusefarbe, eigener Bildschirm und Schild — an allen Geldautomaten der Karte",
    pl: "Kolor obudowy, własny ekran i szyld — na wszystkich bankomatach mapy",
    fr: "Couleur du boîtier, écran et enseigne personnalisés — sur tous les distributeurs de billets de la carte",
  },
};

/*
 * «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер) — интерьеры Majestic
 * и GTA 5 РП из ваших папок: цвет и блеск стен, пола, потолка и мебели,
 * установка в одиночную игру.
 */
const reduxProjectInteriorsSlot = {
  id: "project-interiors",
  title: {
    ru: "Интерьеры проектов", uk: "Інтер’єри проєктів",
    en: "Project interiors",
    de: "Projekt-Innenräume",
    pl: "Wnętrza projektów",
    fr: "Intérieurs de projets",
  },
  description: {
    ru: "Интерьеры Majestic и GTA 5 РП из каталога Astral и ваших папок: цвет и блеск, установка в игру", uk: "Інтер’єри Majestic і GTA 5 РП з каталогу Astral і ваших тек: колір і блиск, установлення в гру",
    en: "Majestic and GTA 5 RP interiors from the Astral catalogue and your folders: colour and shine, install into the game",
    de: "Majestic- und GTA-5-RP-Innenräume aus dem Astral-Katalog und deinen Ordnern: Farbe und Glanz, Installation ins Spiel",
    pl: "Wnętrza Majestic i GTA 5 RP z katalogu Astral i twoich folderów: kolor i połysk, instalacja w grze",
    fr: "Intérieurs de Majestic et de GTA 5 RP issus du catalogue Astral et de vos dossiers\u00a0: couleur et brillance, installation dans le jeu",
  },
};

/*
 * «Интерьеры Majestic RP» (25.10.2026) — интерьеры сервера Majestic: у казино покрытия и подсветка, у остальных одиннадцати цвет и
 * блеск стен, пола, потолка и мебели; установка в одиночную игру.
 */
const reduxMajesticInteriorsSlot = {
  id: "majestic-interiors",
  title: {
    ru: "Интерьеры Majestic RP", uk: "Інтер’єри Majestic RP",
    en: "Majestic RP interiors",
    de: "Majestic-RP-Innenräume",
    pl: "Wnętrza Majestic RP",
    fr: "Intérieurs Majestic RP",
  },
  description: {
    ru: "Интерьеры сервера Majestic RP: покрытия и подсветка казино, цвет и блеск остальных — установка в игру", uk: "Інтер’єри сервера Majestic RP: покриття й підсвічування казино, колір і блиск решти — установлення в гру",
    en: "Majestic RP server interiors: casino coverings and glow, colour and shine for the rest — install into the game",
    de: "Innenräume des Majestic-RP-Servers: Beläge und Beleuchtung des Casinos, Farbe und Glanz der übrigen — Installation ins Spiel",
    pl: "Wnętrza serwera Majestic RP: pokrycia i podświetlenie kasyna, kolor i połysk pozostałych — instalacja w grze",
    fr: "Intérieurs du serveur Majestic RP\u00a0: revêtements et éclairage du casino, couleur et brillance des autres — installation dans le jeu",
  },
};

const reduxCrosshairSlot = {
  id: "crosshair",
  title: {
    ru: "Прицел", uk: "Приціл",
    en: "Crosshair",
    de: "Fadenkreuz",
    pl: "Celownik",
    fr: "Réticule",
  },
  description: {
    ru: "Обычный и снайперский прицел", uk: "Звичайний і снайперський приціл",
    en: "Standard and sniper crosshair",
    de: "Normales und Sniper-Fadenkreuz",
    pl: "Zwykły i snajperski celownik",
    fr: "Réticule standard et de sniper",
  },
};

/* «Полоска HP» (задача 2 ТЗ 11.10.2026) — полоска здоровья и брони над
   игроком; утром была инструментом прицела, теперь своя плитка рядом. */
const reduxTargetHpSlot = {
  id: "target-hp",
  title: {
    ru: "Полоска HP", uk: "Смужка HP",
    en: "HP bar",
    de: "HP-Leiste",
    pl: "Pasek HP",
    fr: "Barre de HP",
  },
  description: {
    ru: "Здоровье и броня над игроком: цвет, вид, цифры", uk: "Здоров’я та броня над гравцем: колір, вигляд, цифри",
    en: "Health and armour above players: colour, style, numbers",
    de: "Gesundheit und Panzerung über Spielern: Farbe, Stil, Zahlen",
    pl: "Zdrowie i pancerz nad graczem: kolor, wygląd, liczby",
    fr: "Santé et armure au-dessus du joueur\u00a0: couleur, style, chiffres",
  },
};

/* «Настройка автомобиля» (бывший «Дым из-под колёс», ТЗ 11.10.2026, вечер;
   17.10.2026, второй заход: переименован, добавлены огонь выхлопа и воздушный
   пакет) — свой редактор дыма, искр и огня из-под колёс и из трубы;
   каталожный «Дым от дрифта» остаётся полкой модов. */
const reduxWheelSmokeSlot = {
  id: "wheel-smoke",
  title: {
    ru: "Настройка автомобиля", uk: "Налаштування автомобіля",
    en: "Car setup",
    de: "Fahrzeugeinstellungen",
    pl: "Ustawienia samochodu",
    fr: "Réglages de la voiture",
  },
  description: {
    ru: "Дым из-под колёс, огонь выхлопа и воздушный пакет: цвет, прозрачность, размер; звёзды, искры или огонь вместо дыма", uk: "Дим з-під коліс, вогонь вихлопу та повітряний пакет: колір, прозорість, розмір; зорі, іскри або вогонь замість диму",
    en: "Tyre smoke, exhaust flames and slipstream: colour, opacity, size; stars, sparks or fire instead of smoke",
    de: "Reifenrauch, Auspuffflammen und Windschatten: Farbe, Deckkraft, Größe; Sterne, Funken oder Feuer statt Rauch",
    pl: "Dym spod kół, ogień z wydechu i smuga aerodynamiczna: kolor, przezroczystość, rozmiar; gwiazdy, iskry lub ogień zamiast dymu",
    fr: "Fumée des roues, flammes d'échappement et sillage\u00a0: couleur, transparence, taille\u00a0; étoiles, étincelles ou feu à la place de la fumée",
  },
};

/* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер) — метки игры: цвет, своя картинка, убрать. */
const reduxGroupMarkersSlot = {
  id: "group-markers",
  title: {
    ru: "Групповые метки", uk: "Групові мітки",
    en: "Group markers",
    de: "Gruppenmarkierungen",
    pl: "Znaczniki grupowe",
    fr: "Marqueurs de groupe",
  },
  description: {
    ru: "Метки игры в мире: свой цвет, своя картинка или убрать", uk: "Мітки гри у світі: свій колір, своя картинка або прибрати",
    en: "In-world game markers: your colour, your picture or none",
    de: "Spielmarkierungen in der Welt: eigene Farbe, eigenes Bild oder keine",
    pl: "Znaczniki gry w świecie: własny kolor, własny obraz lub brak",
    fr: "Marqueurs du jeu dans le monde\u00a0: couleur ou image personnalisée, ou aucun marqueur",
  },
};

const reduxSniperCrosshairSlot = {
  id: "sniper-crosshair",
  title: {
    ru: "Прицел на снайперку", uk: "Приціл для снайперки",
    en: "Sniper scope",
    de: "Scharfschützenvisier",
    pl: "Celownik snajperski",
    fr: "Réticule de sniper",
  },
  description: {
    ru: "Сетка и оформление снайперского прицела", uk: "Сітка й оформлення снайперського прицілу",
    en: "Reticle and styling for sniper scopes",
    de: "Absehen und Gestaltung für Scharfschützenvisiere",
    pl: "Siatka i wygląd celownika snajperskiego",
    fr: "Grille et apparence du réticule de sniper",
  },
};

/*
 * «Животные» (05.11.2026): кабан, олень, собаки, птицы, рыбы — все животные игры. Цвет, свечение и метка над животным,
 * видная издалека. Файлами игры, без скриптов: работает и там, где скрипты запрещены.
 */
const reduxAnimalsSlot = {
  id: "animals",
  title: {
    ru: "Животные", uk: "Тварини",
    en: "Animals",
    de: "Tiere",
    pl: "Zwierzęta",
    fr: "Animaux",
  },
  description: {
    ru: "Цвет, свечение и метка над кабаном, оленем и другими животными игры", uk: "Колір, світіння й мітка над кабаном, оленем та іншими тваринами гри",
    en: "Colour, glow and a marker above the boar, deer and other animals of the game",
    de: "Farbe, Leuchten und Markierung über Wildschwein, Hirsch und anderen Tieren des Spiels",
    pl: "Kolor, poświata i znacznik nad dzikiem, jeleniem i innymi zwierzętami z gry",
    fr: "Couleur, lueur et marqueur au-dessus du sanglier, du cerf et des autres animaux du jeu",
  },
};

export const REDUX_EDITOR_SLOTS = Object.freeze([
  reduxInteriorSlot,
  reduxClimbingSlot,
  reduxWallbangSlot,
  reduxForbiddenZonesSlot,
  reduxCaptZonesSlot,
  reduxFactorySlot,
  reduxHangarSlot,
  reduxAshanSlot,
  reduxVinewoodSlot,
  reduxBusStopsSlot,
  reduxMslZonesSlot,
  reduxFloatLogoSlot,
  /* Дирижабли (ТЗ 11.10.2026). */
  reduxAirshipsSlot,
  reduxShopsSlot,
  reduxBillboardsSlot,
  reduxBannersSlot,
  reduxScheduleSlot,
  reduxFlagsSlot,
  reduxAtmsSlot,
  reduxProjectInteriorsSlot,
  reduxMajesticInteriorsSlot,
  reduxCrosshairSlot,
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  reduxTargetHpSlot,
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  reduxGroupMarkersSlot,
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  reduxWheelSmokeSlot,
  reduxSniperCrosshairSlot,
  /* «Животные» (05.11.2026). */
  reduxAnimalsSlot,
  /* Скрытые редакторы (`hidden-editors.js`) — без плитки на полке и в поиске. */
].filter((slot) => !isWorkshopEditorHidden(slot.id)));
