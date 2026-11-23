/*
 * Заводские наборы обозначений и зон.
 *
 * Всё здесь — стартовые данные, а не истина. Точки заправок и ориентиров взяты
 * в мировых координатах самой GTA V и не зависят от сервера. Зоны — заготовки:
 * границы МЦЛ живут на стороне проекта и меняются от обновления к обновлению,
 * поэтому редактор не выдаёт их за факт. Он даёт полигоны, которые видно,
 * можно двигать по вершинам, переименовывать, красить и обмениваться ими.
 *
 * Отсюда следует правило для всей функции: любой заводской объект должен быть
 * редактируемым и удаляемым. Ничто не зашивается в отрисовку.
 */

import { WORLD_DISTRICTS } from "./districts.js";

/*
 * Категории обозначений. Порядок задаёт порядок в списке слоёв.
 *
 * `glyph` — имя пути из `glyphs.js`; «dot» рисуется кружком. `badge` — цветная
 * плашка под белой пиктограммой: так на картах сообщества выделяют коммерцию,
 * остальные значки идут цветным глифом прямо по карте.
 */
export const MARKER_CATEGORIES = Object.freeze([
  /*
   * Подписи без значка (Т-159): крупные имена районов и мелкие — мест, как
   * на картах сообщества. `label` — вид подписи категории: размер к общему
   * размеру подписей, начертание и свой цвет; `dot: false` — без точки.
   */
  {
    /*
     * Регионы (ревью тимлида 04.10): верхний ярус — Чилиад, Палето,
     * Лос-Сантос — огромной разрядкой, как «ЧИЛИАД» на карте Majestic. Глазу
     * есть за что зацепиться, районы под ними — мельче. Кегль вдвое крупнее
     * района (256 против 129 у района за городом): на 200 регион был лишь
     * чуть больше районов и на общем плане не главенствовал, как на эталоне.
     */
    id: "region",
    title: "Регионы",
    hint: "Самые крупные подписи — Чилиад, Палето, Лос-Сантос, с разрядкой",
    color: "#ffffff",
    glyph: "none",
    dot: false,
    label: { scale: 256, weight: "black", spacing: 30 },
  },
  {
    id: "area",
    title: "Районы",
    hint: "Крупные подписи районов — без значка",
    color: "#ffffff",
    glyph: "none",
    dot: false,
    label: { scale: 230, weight: "black" },
  },
  {
    /*
     * Кварталы города — районы Лос-Сантоса мельче загородных. В игре подписи
     * не прячутся по приближению: полным кеглем сорок пять длинных имён в
     * тесном городе налезают друг на друга, и разгрузка выбрасывает половину
     * — в плитки они не попадают вовсе. Мельче — помещаются все и читаются,
     * когда город приближен.
     */
    id: "quarter",
    title: "Кварталы",
    hint: "Районы города — мельче загородных, чтобы в игре поместились все",
    color: "#ffffff",
    glyph: "none",
    dot: false,
    label: { scale: 82, weight: "black" },
  },
  {
    id: "place",
    title: "Места",
    hint: "Мелкие подписи мест: мосты, трассы, КПП",
    color: "#ffffff",
    glyph: "none",
    dot: false,
    label: { scale: 82, weight: "bold" },
  },
  {
    /*
     * Точки с номером (ТЗ 05.10, задача 7): красный кружок и номер рядом —
     * так на картах GTA5RP отмечены пятьдесят точек гетто. Кружок — точка
     * значка без пиктограммы, номер — его подпись на своём месте.
     */
    id: "point",
    title: "Точки с номером",
    hint: "Красный кружок с номером рядом — как на картах GTA5RP",
    color: "#ff2424",
    glyph: "none",
    dot: true,
    /* Номер — белый, как в оригинале; на светлой карте вид подписей делает
       его тёмным (`withLabelLook`). */
    label: { scale: 100, weight: "black", color: "#ffffff" },
  },
  {
    id: "competitive",
    title: "Компетитив",
    hint: "Точки боёв и мероприятий — оранжевой подписью и кругом",
    color: "#ff8a2a",
    glyph: "target",
    circle: true,
    label: { scale: 112, weight: "black", color: "#ff8a2a" },
  },
  {
    id: "supply",
    title: "Поставки",
    hint: "Точки поставок фракций",
    color: "#ffffff",
    glyph: "truck",
    /* Поставки на картах сообщества — значок без подписи. */
    labelShown: false,
    label: { scale: 82, weight: "bold" },
  },
  /*
   * Значки с карт паков (11.10): красные грузовики, баллончики гетто и джипы
   * GUCCI VECTOR GTA5RP, белые грузовики и чемоданы редукса COMPETITIVE V2.
   * Глифы — свои пути пака (`pack-overlays.js`), размер — в метрах карты.
   * Баллончик несёт номер точки гетто.
   */
  {
    id: "pack-truck",
    title: "Грузовик (GUCCI)",
    hint: "Красный грузовик — как на карте GUCCI VECTOR GTA5RP",
    color: "#db2e4a",
    glyph: "pack-truck",
    labelShown: false,
    label: { scale: 82, weight: "bold" },
  },
  {
    id: "pack-spray",
    title: "Баллончик с номером",
    hint: "Красный баллончик и номер точки гетто — как на карте GUCCI",
    color: "#db2e4a",
    glyph: "pack-spray",
    label: { scale: 100, weight: "black", color: "#ffffff" },
  },
  {
    id: "pack-jeep",
    title: "Джип (GUCCI)",
    hint: "Красный джип площадки ВЗХ — как на карте GUCCI",
    color: "#db2e4a",
    glyph: "pack-jeep",
    labelShown: false,
    label: { scale: 82, weight: "bold" },
  },
  {
    id: "pack-truck-box",
    title: "Грузовик (Redux)",
    hint: "Белый грузовик с кузовом — как на карте COMPETITIVE V2 REDUX",
    color: "#ffffff",
    glyph: "pack-truck-box",
    labelShown: false,
    label: { scale: 82, weight: "bold" },
  },
  {
    id: "pack-case-x",
    title: "Чемодан (Redux)",
    hint: "Белый чемодан с крестом — как на карте COMPETITIVE V2 REDUX",
    color: "#ffffff",
    glyph: "pack-case-x",
    labelShown: false,
    label: { scale: 82, weight: "bold" },
  },
  {
    id: "landmark",
    title: "Ориентиры",
    hint: "Популярные места и точки сходок",
    color: "#f2f5ff",
    glyph: "dot",
  },
  {
    id: "fuel",
    title: "АЗС",
    hint: "Заправки с номерами",
    color: "#ffb454",
    glyph: "gas-pump",
  },
  {
    id: "medic",
    title: "Больницы",
    hint: "Медицинские центры",
    color: "#ff6b7d",
    glyph: "first-aid",
  },
  {
    id: "police",
    title: "Полиция",
    hint: "Участки и федеральные здания",
    color: "#6ea8ff",
    glyph: "shield-star",
  },
  {
    id: "business",
    title: "Бизнес",
    hint: "Производства, склады, карьер",
    color: "#5fd6a8",
    glyph: "factory",
  },
  {
    id: "transport",
    title: "Транспорт",
    hint: "Аэропорты и вокзалы",
    color: "#c69bff",
    glyph: "plane",
  },
  {
    id: "gang",
    title: "Гетто и банды",
    hint: "Кварталы группировок",
    color: "#ff5d72",
    glyph: "skull",
  },
  {
    id: "weapon",
    title: "Оружейные",
    hint: "Ammu-Nation и чёрный рынок",
    color: "#ff8a5f",
    glyph: "crosshair",
  },
  {
    id: "shop",
    title: "Магазины",
    hint: "24/7, LTD и продуктовые",
    color: "#ffd166",
    glyph: "basket",
  },
  {
    id: "clothes",
    title: "Одежда",
    hint: "Binco, Suburban и бутики",
    color: "#f7e26b",
    glyph: "t-shirt",
    badge: true,
  },
  {
    id: "food",
    title: "Еда",
    hint: "Бургерные и закусочные",
    color: "#ffb26b",
    glyph: "hamburger",
  },
  {
    id: "bank",
    title: "Банки",
    hint: "Отделения и банкоматы",
    color: "#9be8c0",
    glyph: "bank",
  },
  {
    id: "casino",
    title: "Казино",
    hint: "Игровые залы",
    color: "#f2c14e",
    glyph: "poker-chip",
  },
  {
    id: "house",
    title: "Дома и аренда",
    hint: "Жильё, квартиры, аренда",
    color: "#f5a97f",
    glyph: "house",
  },
  {
    id: "garage",
    title: "Гаражи",
    hint: "Стоянки и гаражи",
    color: "#a9b6c9",
    glyph: "garage",
  },
  {
    id: "tuning",
    title: "Тюнинг",
    hint: "LS Customs и мастерские",
    color: "#8fd3ff",
    glyph: "wrench",
  },
  {
    id: "carwash",
    title: "Мойки",
    hint: "Автомойки",
    color: "#6ecbff",
    glyph: "drop",
  },
  {
    id: "barber",
    title: "Парикмахерские",
    hint: "Барбершопы",
    color: "#ff9fb2",
    glyph: "scissors",
  },
  {
    id: "tattoo",
    title: "Тату",
    hint: "Тату-салоны",
    color: "#b48ead",
    glyph: "paint-brush",
  },
  {
    id: "gym",
    title: "Качалки",
    hint: "Спортзалы и площадки",
    color: "#d0f27e",
    glyph: "barbell",
  },
  {
    id: "taxi",
    title: "Такси",
    hint: "Депо и стоянки такси",
    color: "#ffe066",
    glyph: "taxi",
  },
  {
    id: "car",
    title: "Автосалоны",
    hint: "Дилеры и авторынки",
    color: "#9fb8d8",
    glyph: "car",
  },
  {
    id: "moto",
    title: "Мото",
    hint: "Мотосалоны и клубы",
    color: "#d8a47f",
    glyph: "motorcycle",
  },
  {
    id: "drift",
    title: "Дрифт и гонки",
    hint: "Трассы и точки сборов",
    color: "#ff7ad9",
    glyph: "steering-wheel",
  },
  {
    id: "port",
    title: "Порт и причалы",
    hint: "Доки и погрузка",
    color: "#7fa8d8",
    glyph: "anchor",
  },
  {
    id: "boat",
    title: "Яхты и лодки",
    hint: "Марины и прокат",
    color: "#6fd6e8",
    glyph: "boat",
  },
  {
    id: "train",
    title: "Железная дорога",
    hint: "Станции и депо",
    color: "#c9b458",
    glyph: "train",
  },
  {
    id: "farm",
    title: "Фермы и крафт",
    hint: "Поля, теплицы, сборка",
    color: "#7fd77f",
    glyph: "plant",
  },
  {
    id: "weed",
    title: "Плантации",
    hint: "Урожай и переработка",
    color: "#5fbf6f",
    glyph: "leaf",
  },
  {
    id: "fish",
    title: "Рыбалка",
    hint: "Точки клёва и скупка",
    color: "#7fc8e8",
    glyph: "fish",
  },
  {
    id: "mine",
    title: "Шахта и карьер",
    hint: "Добыча и копка",
    color: "#d0a95f",
    glyph: "hammer",
  },
  {
    id: "construction",
    title: "Стройки",
    hint: "Работа строителем",
    color: "#ffcf5f",
    glyph: "hard-hat",
  },
  {
    id: "event",
    title: "Ивенты",
    hint: "Точки мероприятий",
    color: "#ffe066",
    glyph: "star",
  },
  {
    id: "gov",
    title: "Госучреждения",
    hint: "Мэрия, суд, регистрации",
    color: "#cfd6e4",
    glyph: "scales",
  },
  {
    id: "job",
    title: "Работы",
    hint: "Биржи и подработки",
    color: "#d8c9a3",
    glyph: "briefcase",
  },
  {
    id: "hotel",
    title: "Отели",
    hint: "Гостиницы и мотели",
    color: "#e8a9c9",
    glyph: "bed",
  },
  {
    id: "cinema",
    title: "Кино и сцена",
    hint: "Кинотеатры и студии",
    color: "#b8c4ff",
    glyph: "film-slate",
  },
  {
    id: "church",
    title: "Церкви",
    hint: "Храмы и кладбища",
    color: "#e8e3d3",
    glyph: "church",
  },
]);

const marker = (id, category, name, x, y, extra = {}) => ({
  id,
  category,
  name,
  x,
  y,
  ...extra,
});

/*
 * Заправки GTA V. Координаты — центроиды кластеров бензоколонок из дампа
 * игровых данных (DurtyFree/gta-v-data-dumps, worldGasPumps.json), поэтому
 * точка стоит на самой площадке, а не «где-то рядом». Порядок фиксирован — по
 * нему живёт нумерация «АЗС №15», которой пользуются русские RP-проекты, и
 * первые двадцать восемь позиций намеренно повторяют нумерацию прежних
 * версий редактора: у станции сменились только уточнённые координаты и имя,
 * но не номер. Две станции, которых раньше не было, добавлены в конец. И
 * номер, и имя можно переписать: у каждого сервера они свои, редактор не
 * навязывает.
 */
const GAS_STATIONS = [
  [54, 2782, "Шоссе 68 (запад)"],
  [264, 2607, "Хармони"],
  [1035, 2668, "Шоссе 68"],
  [1208, 2660, "Шоссе 68 (юг)"],
  [2541, 2618, "Ветряки"],
  [2686, 3267, "Сенора-восток"],
  [2005, 3774, "Песчанка"],
  [1691, 4926, "Грейпсид"],
  [1702, 6416, "Чилиад"],
  [172, 6612, "Палето"],
  [-93, 6410, "Палето-юг"],
  [-2555, 2334, "Занкудо"],
  [-1800, 803, "Ричман-Глен"],
  [-1437, -277, "Морнингвуд"],
  [-2094, -316, "Пасифик-Блаффс"],
  [-724, -932, "Литл-Сеул"],
  [-530, -1214, "Литл-Сеул (юг)"],
  [-71, -1762, "Гетто"],
  [265, -1261, "Строберри"],
  [819, -1029, "Ла-Меса"],
  [1204, -1400, "Эль-Бурро"],
  [1181, -330, "Зеркалка"],
  [622, 266, "Вайнвуд"],
  [2577, 360, "Татавиам"],
  [176, -1562, "Дэвис"],
  [-322, -1469, "Ла-Пуэрта"],
  [1786, 3331, "Трасса Сенора"],
  [-1437, -2185, "Аэропорт"],
  [1233, 2729, "У банка"],
  [-67, -2532, "Порт"],
];

/** Ориентиры, которые русские RP-проекты зовут своими именами. */
const LANDMARKS = [
  marker("vinewood-sign", "landmark", "Буквы", 711, 1198),
  marker("humane-labs", "landmark", "Хумалка", 3619, 3739, { circle: true }),
  marker("quarry", "landmark", "Карьер", 2900, 2760, { circle: true }),
  marker("sawmill", "landmark", "Лесопилка", -540, 5540),
  marker("prison", "landmark", "Тюрьма", 1850, 2600, { circle: true }),
  marker("observatory", "landmark", "Обсерватория", -438, 1075),
  marker("golf", "landmark", "Гольф-клуб", -1350, 60),
  marker("pier", "landmark", "Пирс", -1850, -1240),
  marker("maze-tower", "landmark", "Мазик", -75, -818),
  marker("legion", "landmark", "Легион", 200, -930),
  marker("casino", "landmark", "Казино", 925, 46),
  marker("altruist", "landmark", "Альтруисты", -1170, 4930),
  marker("chiliad", "landmark", "Чилиад", 425, 5610),
  marker("trevor", "landmark", "Трейлер", 1985, 3812),
  marker("cluckin", "landmark", "Ферма", -100, 6270),
  marker("wind-farm", "landmark", "Турбины", 2130, 1780, { circle: true }),
  marker("power", "landmark", "Подстанция", 2700, 1560),
  marker("dam", "landmark", "Дамба", 1650, 250),
  marker("chumash", "landmark", "Чумаш", -3200, 970),
  marker("paleto", "landmark", "Палето-Бей", -275, 6635),
  marker("sandy", "landmark", "Песчанка", 1900, 3700),
  marker("grapeseed", "landmark", "Грейпсид", 1700, 4900),
  marker("zancudo", "landmark", "Зона 51", -2270, 3150, { circle: true }),
  marker("mirror-park", "landmark", "Зеркалка", 1090, -650),
  marker("vespucci", "landmark", "Веспуччи", -1200, -1500),
  marker("grove", "landmark", "Гроув", 100, -1900),
  marker("richman", "landmark", "Ричман", -1600, 200),
  marker("kortz", "landmark", "Кортц", -2243, 264),
];

const SERVICES = [
  marker("central-medical", "medic", "Больница Пиллбокс", 300, -580),
  marker("mount-zonah", "medic", "Маунт-Зона", -450, -320),
  marker("sandy-medical", "medic", "Больница Песчанки", 1839, 3672),
  marker("paleto-medical", "medic", "Больница Палето", -250, 6320),
  marker("mission-row", "police", "Участок Мишн-Роу", 425, -980),
  marker("fib", "police", "ФНБ", 135, -750),
  marker("sandy-police", "police", "Участок Песчанки", 1853, 3688),
  marker("paleto-police", "police", "Участок Палето", -448, 6008),
  marker("vespucci-police", "police", "Участок Веспуччи", -1108, -809),
  marker("lsia", "transport", "Аэропорт-ЛС", -1037, -2737),
  marker("terminal", "transport", "ТП Остров", 200, -2900),
  marker("docks", "transport", "Порт", -320, -2680),
  marker("sandy-airfield", "transport", "Аэродром Песчанки", 1700, 3250),
  marker("grapeseed-airfield", "transport", "Аэродром Грейпсид", 2130, 4790),
  marker("train-station", "transport", "Вокзал", -540, -1275),
  marker("scrapyard", "business", "Свалка", 2340, 3120),
  marker("cement", "business", "Цементный", 620, 2790),
  marker("methlab", "business", "Ферма Трейси", 1391, 3608),
  marker("warehouse", "business", "Склады", 960, -3000),
  marker("oil", "business", "Нефтевышки", 1360, -2100),
];

/*
 * Коммерция и сервисы города. Координаты — позиции настоящих интерьеров игры
 * из дампа mloInteriors.json (DurtyFree/gta-v-data-dumps): оружейные, 24/7 и
 * LTD, одежда, парикмахерские, тату, тюнинг, банки, автомойки. Больницы и
 * полиция не дублируются — они уже стоят в списке сервисов выше.
 */
const CITY_POI_SOURCES = Object.freeze([
  [
    "weapon",
    "Оружейный",
    [
      [-327, 6079, "Палето"],
      [1697, 3755, "Песчанка"],
      [-1115, 2694, "Шоссе 68"],
      [-3167, 1085, "Чумаш"],
      [2569, 300, "Татавиам"],
      [247, -47, "Хоик"],
      [-1311, -392, "Морнингвуд"],
      [-663, -941, "Литл-Сеул"],
      [843, -1028, "Ла-Меса"],
      [11, -1106, "Пиллбокс"],
      [821, -2155, "Сайпресс"],
    ],
  ],
  [
    "shop",
    "Магазин",
    [
      [1732, 6417, "Чилиад"],
      [1961, 3745, "Песчанка"],
      [2676, 3284, "Сенора"],
      [547, 2667, "Хармони"],
      [-3246, 1003, "Чумаш"],
      [-3043, 586, "Бэнхэм"],
      [2554, 384, "Татавиам"],
      [376, 329, "Вайнвуд"],
      [27, -1344, "Строберри"],
      [1705, 4928, "Грейпсид"],
      [-1828, 791, "Ричман-Глен"],
      [1157, -321, "Зеркалка"],
      [-714, -911, "Литл-Сеул"],
      [-51, -1751, "Гроув"],
      [1168, 2708, "Шоссе 68"],
      [-2969, 389, "Бэнхэм-юг"],
      [-1487, -381, "Морнингвуд"],
      [-1225, -907, "Веспуччи"],
      [1136, -980, "Мурриета"],
    ],
  ],
  [
    "clothes",
    "Одежда",
    [
      [5, 6513, "Палето"],
      [1693, 4824, "Грейпсид"],
      [617, 2759, "Хармони"],
      [-1102, 2710, "Шоссе 68"],
      [1196, 2710, "Шоссе 68 (восток)"],
      [-3172, 1048, "Чумаш"],
      [-710, -151, "Рокфорд"],
      [124, -219, "Альта"],
      [-1448, -237, "Морнингвуд"],
      [-165, -304, "Бертон"],
      [-1195, -772, "Дель-Перро"],
      [425, -805, "Текстиль-Сити"],
      [-823, -1074, "Каналы"],
      [76, -1394, "Строберри"],
    ],
  ],
  [
    "barber",
    "Парикмахерская",
    [
      [-278, 6228, "Палето"],
      [1932, 3730, "Песчанка"],
      [-33, -152, "Хоик"],
      [-818, -186, "Рокфорд"],
      [1212, -473, "Зеркалка"],
      [-1283, -1117, "Веспуччи"],
      [137, -1708, "Дэвис"],
    ],
  ],
  [
    "tattoo",
    "Тату",
    [
      [-294, 6200, "Палето"],
      [1864, 3748, "Песчанка"],
      [-3171, 1076, "Чумаш"],
      [323, 182, "Вайнвуд"],
      [-1153, -1427, "Веспуччи"],
      [1324, -1653, "Эль-Бурро"],
    ],
  ],
  [
    "tuning",
    "Тюнинг",
    [
      [111, 6626, "Палето"],
      [1175, 2641, "Хармони"],
      [-343, -132, "Бертон"],
      [-210, -1320, "Строберри (Benny's)"],
      [-1149, -2004, "Аэропорт"],
    ],
  ],
  [
    "bank",
    "Банк",
    [
      [-109, 6468, "Палето"],
      [1180, 2707, "Шоссе 68"],
      [-2963, 478, "Бэнхэм"],
      [248, 218, "Пасифик"],
      [-355, -49, "Бертон"],
      [310, -278, "Хоик"],
      [-1217, -333, "Рокфорд"],
      [145, -1039, "Легион"],
    ],
  ],
  [
    "carwash",
    "Мойка",
    [
      [22, -1392, "Строберри"],
      [-700, -934, "Литл-Сеул"],
    ],
  ],
]);

const cityPoi = () =>
  CITY_POI_SOURCES.flatMap(([category, title, entries]) =>
    entries.map(([x, y, place], index) =>
      marker(`${category}-${index + 1}`, category, `${title} ${place}`, x, y),
    ),
  );

const numberedFuel = () =>
  GAS_STATIONS.map(([x, y], index) =>
    marker(`fuel-${index + 1}`, "fuel", `АЗС №${index + 1}`, x, y),
  );

const namedFuel = () =>
  GAS_STATIONS.map(([x, y, place], index) =>
    marker(`fuel-${index + 1}`, "fuel", `АЗС ${place}`, x, y),
  );

/*
 * Источники наборов подписей (`label-sets.js`, редизайн 04.10): те же точки,
 * что у профилей серверов, но отдельными наборами — АЗС, службы, ориентиры и
 * коммерция включаются и выключаются каждая своим тумблером.
 */
export const MARKER_SOURCES = Object.freeze({
  landmarks: () => LANDMARKS,
  services: () => SERVICES,
  fuelNumbered: () => numberedFuel(),
  fuelNamed: () => namedFuel(),
  commerce: () => cityPoi(),
});

/** Заводской набор обозначений: ориентиры, сервисы и пронумерованные АЗС. */
export const DEFAULT_MARKERS = Object.freeze([
  ...LANDMARKS,
  ...SERVICES,
  ...numberedFuel(),
]);

/*
 * Серверные профили. Оба собраны из одних и тех же настоящих координат — врут
 * тут только названия, и они нарочно повторяют язык своих сообществ. Профиль —
 * стартовый набор, а не истина: точки и зоны дальше правятся как любые другие.
 *
 * Различия сняты с открытых вики проектов: на GTA5RP заправки живут номерами
 * («АЗС №15» — идентификатор в интерфейсе), а кварталы гетто статичные — их
 * держат одни и те же банды. На Мажестике АЗС — покупаемые бизнесы, зовущиеся
 * по районам, а территории банд динамические, поэтому профиль ставит зоны на
 * весь штат — под перекраску.
 */
/*
 * Оформление профилей повторяет карты сообщества, а не заводские значения
 * редактора: кварталы — тонкая обводка и лёгкая заливка, подписи и значки
 * мелкие и служебные. Патч ложится на разделы поверх текущих настроек, не
 * трогая ни нарисованное, ни палитру подложки.
 */
const PRESET_STYLE = Object.freeze({
  zones: {
    fillOpacity: 12,
    strokeWidth: 1.6,
    strokeOpacity: 90,
    glow: 14,
    labelSize: 7,
    labelOutline: 85,
  },
  markers: {
    font: "heavy",
    labelSize: 10.5,
    letterSpacing: 4,
    dotSize: 5,
    iconSize: 11,
    circleWidth: 1.4,
    circleOpacity: 48,
    labelOutline: 85,
  },
});

export const SERVER_PRESETS = Object.freeze([
  {
    id: "majestic",
    title: "Мажестик",
    hint: "АЗС по районам, вся коммерция, круги и все зоны игры под перекраску",
    zoneTemplate: "full",
    /* На карте Majestic зон не видно — набор встаёт выключенным, тумблер рядом. */
    zonesHidden: true,
    /*
     * Карта в игре не прячет подписи по приближению — всё включённое
     * печатается в плитки разом. Поэтому по умолчанию — только регионы и
     * районы, места и мелкие точки выключены (ревью тимлида 04.10).
     */
    hiddenTiers: [1, 2],
    labelSets: ["regions-ru", "districts-ru"],
    zoneSets: ["majestic-circles"],
    patch: PRESET_STYLE,
    markers: Object.freeze([...LANDMARKS, ...SERVICES, ...namedFuel(), ...cityPoi()]),
  },
  {
    id: "gta5rp",
    title: "GTA5RP",
    hint: "Нумерованные АЗС, коммерция и зоны города, как в игре",
    zoneTemplate: "city",
    labelSets: ["regions-ru", "districts-ru"],
    zoneSets: ["events-blank"],
    hiddenTiers: [1, 2],
    patch: PRESET_STYLE,
    markers: Object.freeze([...LANDMARKS, ...SERVICES, ...numberedFuel(), ...cityPoi()]),
  },
]);

export const SERVER_PRESET_MAP = Object.freeze(
  Object.fromEntries(SERVER_PRESETS.map((item) => [item.id, item])),
);

const ZONE_COLORS = [
  "#ff5d72",
  "#6ea8ff",
  "#ffb454",
  "#5fd6a8",
  "#c69bff",
  "#4fd8e8",
  "#ff7ad9",
  "#ffe066",
];

/*
 * Заготовки зон — настоящие зоны игры, а не нарисованные на глаз пятна:
 * контур приходит из зонных данных GTA V, цвет раздаётся по кругу, а
 * подсказкой каждая зона несёт свой английский оригинал. Дальше набор
 * правится руками — границы МЦЛ у каждого проекта свои.
 */
const districtZones = (group) =>
  Object.freeze(
    WORLD_DISTRICTS.filter(
      (district) => !group || district.group === group,
    ).map((district, index) =>
      Object.freeze({
        id: district.id,
        name: district.name,
        hint: district.nameEn,
        color: ZONE_COLORS[index % ZONE_COLORS.length],
        /* Природа приходит выключенной — иначе штат накрыт одеялом. */
        enabled: !district.wild,
        points: district.points,
      }),
    ),
  );

/** Наборы зон, доступные из редактора одним нажатием. */
export const ZONE_TEMPLATES = Object.freeze([
  {
    id: "none",
    title: "Без зон",
    hint: "Чистая карта — зоны рисуются вручную",
    zones: Object.freeze([]),
  },
  {
    id: "city",
    title: "Зоны Лос-Сантоса",
    hint: "Все городские зоны, как их видит сама игра",
    zones: districtZones("city"),
  },
  {
    id: "county",
    title: "Округ Блейн",
    hint: "Все зоны за городом — от Чумаша до горы Гордо",
    zones: districtZones("county"),
  },
  {
    id: "full",
    title: "Все зоны игры",
    hint: "Город и округ вместе — вся зонная сетка GTA V",
    zones: districtZones(null),
  },
]);

export const ZONE_TEMPLATE_MAP = Object.freeze(
  Object.fromEntries(ZONE_TEMPLATES.map((item) => [item.id, item])),
);

/*
 * Ярусы подписей (Т-159, ревью тимлида): на общем плане — только районы,
 * с городского приближения — места и заметные службы, с ближнего — мелкие
 * точки (АЗС, магазины, тату). На карте Majestic подписей мало, и они
 * крупные: мелочь на весь штат — каша, а не карта.
 */
const PLACE_TIER = new Set([
  "place",
  "landmark",
  "competitive",
  "medic",
  "police",
  "gov",
  "casino",
  "event",
  "port",
]);

/** Ярус категории: 0 — регионы и районы, 1 — места, 2 — мелкие точки. */
export const markerTier = (category) =>
  category === "area" || category === "region" || category === "quarter"
    ? 0
    : PLACE_TIER.has(category)
      ? 1
      : 2;

/** С какого приближения редактора виден ярус. */
export const MARKER_TIER_ZOOM = Object.freeze([0, 1.8, 4]);

export const MARKER_CATEGORY_MAP = Object.freeze(
  Object.fromEntries(MARKER_CATEGORIES.map((item) => [item.id, item])),
);
