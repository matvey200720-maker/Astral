/*
 * «Интерьеры» (задача 3 ТЗ 10.10.2026) — что такое заведение в игре.
 *
 * Отдельно от договора работы (`shops.js`): этот список берёт и подготовка
 * описи (`scripts/prepare-shops.mjs`), а опись договор читает сам — модуль
 * без описи не тянет её туда, где её ещё нет.
 *
 * Магазины одного вида в GTA V — ОДНО помещение (архетип интерьера, MLO),
 * расставленное экземплярами по карте: девять 24/7 — один `v_shop_247` в
 * `v_int_66.ytyp`. Поэтому облик «для всех 24/7» — правка этого помещения:
 * листы его словаря текстур и список его вещей. Вид заведения здесь — одно
 * помещение игры; у Ammu-Nation, LS Customs и тату-салонов их по два-три
 * (разные планировки), и каждое правится своим обликом.
 */

/*
 * Разделы — помещения, которыми пользуются проекты GTA5RP (задача 5 ТЗ
 * 11.10.2026: «не рандомные бары, а то, что есть на проектах»), по вики
 * сервера (wiki.gta5rp.com, «Бизнесы» и «Ночные клубы»): магазины 24/7,
 * АЗС, магазины одежды, барбершопы, тату-салоны, оружейные, Los Santos
 * Customs; 8 отделений банка — это шесть Fleeca, Pacific Standard и Blaine
 * County Savings; клубы мафий — Vanilla Unicorn, Bahama Mama's и Comedy Club
 * (Split Sides West). Порядок — порядок выбора над кадром.
 *
 * Источник раздела (`source`, ТЗ 17.10.2026, вечер, задача 5): откуда
 * помещения — `game` (штатные интерьеры игры, их красит этот инструмент) или,
 * потом, `project` («Проекты»: Majestic, GTA 5 RP — отдельный редактор
 * проектов добавит свои разделы и свои помещения с `source: "project"`).
 * Меню над кадром и список разделов уже читают источник: пока он один,
 * переключателя нет; когда появится второй — он встанет заголовком группы.
 */
export const SHOP_SOURCES = Object.freeze([{ id: "game", label: "Штатные" }].map((item) => Object.freeze(item)));
export const SHOP_SOURCE_IDS = Object.freeze(SHOP_SOURCES.map((item) => item.id));

export const SHOP_CATEGORIES = Object.freeze(
  [
    { id: "stores", label: "Магазины 24/7", source: "game" },
    { id: "gas", label: "Заправки", source: "game" },
    { id: "clothes", label: "Одежда", source: "game" },
    { id: "customs", label: "LS Customs", source: "game" },
    { id: "barbers", label: "Барбершопы", source: "game" },
    { id: "tattoo", label: "Тату-салоны", source: "game" },
    { id: "guns", label: "Ammu-Nation", source: "game" },
    { id: "banks", label: "Банки", source: "game" },
    { id: "clubs", label: "Клубы мафий", source: "game" },
    /* Штатные интерьеры сверх магазинов (17.10.2026, вечер, задача 5): службы, бары, салоны, жильё, производство. */
    { id: "gov", label: "Госслужбы", source: "game" },
    { id: "bars", label: "Бары и кино", source: "game" },
    { id: "retail", label: "Салоны и ювелирка", source: "game" },
    { id: "offices", label: "Офисы", source: "game" },
    { id: "homes", label: "Жильё", source: "game" },
    { id: "industry", label: "Производство", source: "game" },
  ].map((item) => Object.freeze(item)),
);
export const SHOP_CATEGORY_IDS = Object.freeze(SHOP_CATEGORIES.map((item) => item.id));

/** Источник раздела (`game` или `project`); неизвестный раздел — штатный. */
export const shopCategorySource = (categoryId) => SHOP_CATEGORIES.find((item) => item.id === categoryId)?.source || "game";

/*
 * Помещения игры: `mlo` — имя архетипа интерьера. Подписи с местом — где у
 * вида несколько планировок. Магазин LTD — помещение при заправке, поэтому
 * он в «Заправках».
 */
export const SHOP_INTERIORS = Object.freeze(
  [
    { id: "shop247", mlo: "v_shop_247", category: "stores", label: "24/7" },
    { id: "liquor", mlo: "v_gen_liquor", category: "stores", label: "Rob's Liquor" },
    { id: "binco", mlo: "v_clotheslo", category: "clothes", label: "Binco" },
    { id: "suburban", mlo: "v_clothesmid", category: "clothes", label: "Suburban" },
    { id: "ponsonbys", mlo: "v_clotheshi", category: "clothes", label: "Ponsonbys" },
    { id: "ammunation", mlo: "v_gun2", category: "guns", label: "Ammu-Nation" },
    { id: "ammurange", mlo: "v_gun", category: "guns", label: "Ammu-Nation с тиром" },
    { id: "barbers", mlo: "v_barbers", category: "barbers", label: "Барбершоп" },
    { id: "bobmulet", mlo: "v_hairdresser", category: "barbers", label: "Салон Bob Mulét" },
    { id: "lscustoms", mlo: "v_carmod", category: "customs", label: "LS Customs: Бёртон и аэропорт" },
    { id: "lscustoms68", mlo: "v_carmod3", category: "customs", label: "LS Customs: шоссе 68 и Палето" },
    { id: "lscustomslm", mlo: "v_lockup", category: "customs", label: "LS Customs: Ла-Меса" },
    { id: "fleeca", mlo: "v_genbank", category: "banks", label: "Fleeca" },
    { id: "pacific", mlo: "v_bank", category: "banks", label: "Pacific Standard" },
    { id: "blaine", mlo: "v_bank4", category: "banks", label: "Blaine County Savings" },
    { id: "unicorn", mlo: "v_strip3", category: "clubs", label: "Vanilla Unicorn" },
    { id: "bahama", mlo: "v_bahama", category: "clubs", label: "Bahama Mamas" },
    { id: "splitsides", mlo: "v_comedy", category: "clubs", label: "Split Sides West (Comedy Club)" },
    { id: "tattoo", mlo: "v_tattoo", category: "tattoo", label: "Тату-салон" },
    { id: "tattoo2", mlo: "v_tattoo2", category: "tattoo", label: "Тату-салон: Палето и Сэнди" },
    { id: "ltd", mlo: "v_gasstation", category: "gas", label: "Магазин LTD" },
    /* Штатные интерьеры сверх магазинов (ТЗ 17.10.2026, вечер): имена MLO — по картам `…interior_<имя>_milo_.ymap` игры. */
    { id: "policehub", mlo: "v_policehub", category: "gov", label: "Полицейский участок" },
    { id: "sheriff", mlo: "v_sheriff", category: "gov", label: "Офис шерифа" },
    { id: "hospital", mlo: "v_hospital", category: "gov", label: "Больница" },
    { id: "coroner", mlo: "v_coroner", category: "gov", label: "Морг" },
    { id: "firedept", mlo: "v_firedept", category: "gov", label: "Пожарная часть" },
    { id: "hicksbar", mlo: "v_hicksbar", category: "bars", label: "Бар Hick's" },
    { id: "rockclub", mlo: "v_rockclub", category: "bars", label: "Рок-клуб Tequi-la-la" },
    { id: "cinema", mlo: "v_cinema", category: "bars", label: "Кинотеатр" },
    { id: "jewel", mlo: "v_jewel2", category: "retail", label: "Ювелирный Vangelico" },
    { id: "showroom", mlo: "v_carshowroom", category: "retail", label: "Автосалон Premium Deluxe Motorsport" },
    { id: "lifeinvader", mlo: "v_faceoffice", category: "offices", label: "Офис Life Invader" },
    { id: "depository", mlo: "v_finalebank", category: "banks", label: "Union Depository" },
    { id: "apthigh", mlo: "v_apartment_high", category: "homes", label: "Квартира: высокий класс" },
    { id: "janitor", mlo: "v_janitor", category: "homes", label: "Квартира уборщика" },
    { id: "franklin", mlo: "v_franklinshouse", category: "homes", label: "Дом на Форум-драйв" },
    { id: "abattoir", mlo: "v_abattoir", category: "industry", label: "Скотобойня" },
    { id: "chopshop", mlo: "v_chopshop", category: "industry", label: "Разборка автомобилей" },
    { id: "foundry", mlo: "v_foundry", category: "industry", label: "Литейный цех" },
    { id: "sweatshop", mlo: "v_sweat", category: "industry", label: "Швейный цех" },
  ].map((item) => Object.freeze(item)),
);
export const SHOP_INTERIOR_IDS = Object.freeze(SHOP_INTERIORS.map((item) => item.id));

/*
 * Группы вещей помещения — что можно убрать. Оболочка, двери, окна, трубы
 * и прочее устройство помещения в группы не входят: их не убрать без
 * дыр в стенах и сломанных дверей.
 */
export const SHOP_ITEM_GROUPS = Object.freeze(
  [
    { id: "vending", label: "Автоматы и игры", note: "Газировка, кофе, снеки, жвачка, джукбокс, аркады" },
    { id: "atm", label: "Банкоматы", note: "Банкоматы в зале" },
    { id: "fridges", label: "Холодильники", note: "Холодильники и витрины-охладители" },
    { id: "shelves", label: "Полки и стеллажи", note: "Стеллажи, стойки, шкафы-витрины" },
    { id: "goods", label: "Товары", note: "Всё, что стоит на полках и прилавке" },
    { id: "clothes", label: "Одежда на витринах", note: "Вешалки и манекены с одеждой" },
    { id: "counter", label: "Прилавок и касса", note: "Прилавок, стойка бара, кассы" },
    { id: "furniture", label: "Мебель", note: "Стулья, кресла, столы, диваны, шкафы" },
    { id: "garage", label: "Оборудование", note: "Подъёмники, покрасочная камера, верстак" },
    { id: "tools", label: "Инструмент и запчасти", note: "Инструмент, канистры, шины, баллоны" },
    { id: "stage", label: "Сцена и музыка", note: "Сцена, пилон, пульт, колонки" },
    { id: "tech", label: "Техника", note: "Камеры, мониторы, телевизоры, телефоны, часы" },
    { id: "lights", label: "Лампы и неон", note: "Вместе с лампой уходит и её свет" },
    { id: "signs", label: "Вывески и плакаты", note: "Плакаты, вывески, логотипы, картины" },
    { id: "plants", label: "Растения и декор", note: "Цветы, статуи, аквариумы" },
    { id: "clutter", label: "Мелочи", note: "Бумаги, коробки, урны, кружки, огнетушители" },
  ].map((item) => Object.freeze(item)),
);
export const SHOP_ITEM_GROUP_IDS = Object.freeze(SHOP_ITEM_GROUPS.map((item) => item.id));

/*
 * Поверхности помещения: стены, пол и потолок — листы оболочки по сторонам
 * граней; прилавок, полки и мебель — листы вещей этих групп (задача 5 ТЗ
 * 11.10.2026), только те, что меняет одно это помещение. Банкоматы,
 * автоматы и холодильники (ТЗ 12.10.2026, задача 2: «цвет самого
 * интерьера — полок, магазинчиков, банкоматов») — так же; общая модель
 * красится своей копией у этого помещения.
 */
export const SHOP_SURFACES = Object.freeze(
  [
    { id: "walls", label: "Стены", colour: "#c9c4b8" },
    { id: "floor", label: "Пол", colour: "#8a8178" },
    { id: "ceiling", label: "Потолок", colour: "#e8e6e1" },
    { id: "counter", label: "Прилавок и касса", colour: "#a07850", items: true },
    { id: "shelves", label: "Полки и стеллажи", colour: "#d8d2c4", items: true },
    { id: "furniture", label: "Мебель", colour: "#8a5a36", items: true },
    { id: "equipment", label: "Банкоматы, автоматы, холодильники", colour: "#8f9aa3", items: true },
  ].map((item) => Object.freeze(item)),
);
export const SHOP_SURFACE_IDS = Object.freeze(SHOP_SURFACES.map((item) => item.id));

export const findShopCategory = (id) => SHOP_CATEGORIES.find((item) => item.id === id) || null;
export const findShopItemGroup = (id) => SHOP_ITEM_GROUPS.find((item) => item.id === id) || null;
