/*
 * Таблицы урона серверов для счётчика урона (владелец, 30.10.2026: «серверное
 * именно, не просто какие-то рандомные цифры»). На обоих серверах урон считает
 * сервер, числа из `weapons.meta` там неверны.
 *
 * Здесь только то, что написано на страницах проектов: база по телу вблизи. Сервер
 * ещё учитывает голову, руки и ноги, дальность, резист и бронебойность, а игра
 * прицелу этого не сообщает. Ствола нет в таблице — числа нет: счётчик на нём
 * молчит (`damageForWeapon`), своё он не подставляет.
 *
 * Как имена сведены к `WEAPON_*`:
 *  • GTA 5 RP — по файлам раскрасок на wiki.gta5rp.com/skins: у каждого ствола там
 *    префикс его файла (`DA_` у «Кольта», `MACHPST_` у «Автоматического пистолета»,
 *    `CPDW_` у «Малокалиберной винтовки», `SAWNOFF_` у «Помпового обреза», `SGDB_`
 *    у «Обреза», `MUSKET_` у «Охотничьего ружья», `SR_` у «Sniper Rifle»), «Tactical
 *    SMG» = `weapon_tecpistol` — по таблице оружия вики Majestic (/ru/utils/weapons).
 *  • Majestic RP — по имени и описанию на странице предмета: это перевод описания
 *    ствола из игры (243 «Штурмовой пистолет» — Pistol .50, 269 «Малый ПП» — Machine
 *    Pistol, 265 «Наградной револьвер» — Double-Action, 326 «Томпсон» — Gusenberg,
 *    330 «Автоматический дробовик» — Sweeper, 331 «Пулемёт Калашникова» — MG, 332
 *    «Ручной пулемет» — Combat MG). `item` — номер страницы предмета.
 *
 * Не сведены, потому что подтверждения нет: 590 «Глок P80», 1009 «Боевая винтовка»,
 * 1077 «Кольтер», охотничьи стволы 1213–1221 и 1334 «Арбалет». У «Пистолета» и
 * «Боевого пистолета» на Majestic страницы с уроном нет.
 *
 * Дробовики Majestic: на странице предмета — урон всего выстрела, журнал сборки
 * 3.10670.4809 называет урон дробины (помповый: дробина 8, страница 64).
 * «ПП» (266) — 1 и на странице, и в журнале: «SMG: damage reduced to 1»; как написано.
 */

const gun = (value, name, item = null) => Object.freeze({ value, name, item });

export const FILES_DAMAGE_SERVER = "files";
export const DEFAULT_DAMAGE_SERVER = "gta5rp";

const GTA5RP = Object.freeze({
  id: "gta5rp",
  label: "GTA 5 RP",
  note: "Таблица вики проекта",
  source: "wiki.gta5rp.com/docs/basics/damage",
  url: "https://wiki.gta5rp.com/docs/basics/damage",
  updated: "29.10.2026",
  checked: "30.10.2026",
  weapons: Object.freeze({
    /* 9 мм */
    WEAPON_PISTOL: gun(12, "Пистолет"),
    WEAPON_VINTAGEPISTOL: gun(12, "Старинный пистолет"),
    WEAPON_HEAVYPISTOL: gun(16, "Тяжёлый пистолет"),
    WEAPON_PISTOL_MK2: gun(16, "Пистолет Mk2"),
    WEAPON_COMBATPISTOL: gun(16, "Боевой пистолет"),
    /* 5,56 мм */
    WEAPON_MACHINEPISTOL: gun(14, "Автоматический пистолет"),
    WEAPON_APPISTOL: gun(14, "AP пистолет"),
    WEAPON_COMBATPDW: gun(14, "Малокалиберная винтовка"),
    WEAPON_MINISMG: gun(14, "Мини-СМГ"),
    WEAPON_MICROSMG: gun(14, "Micro SMG"),
    WEAPON_SMG: gun(14, "SMG"),
    WEAPON_SMG_MK2: gun(14, "SMG Mk2"),
    WEAPON_ASSAULTSMG: gun(14, "Assault SMG"),
    WEAPON_TECPISTOL: gun(14, "Tactical SMG"),
    /* 7,62 мм */
    WEAPON_CARBINERIFLE: gun(14, "Carbine Rifle"),
    WEAPON_ASSAULTRIFLE: gun(14, "Assault Rifle"),
    WEAPON_COMPACTRIFLE: gun(14, "Compact Rifle"),
    WEAPON_SPECIALCARBINE: gun(14, "Special Rifle"),
    WEAPON_BATTLERIFLE: gun(14, "Battle Rifle"),
    WEAPON_MILITARYRIFLE: gun(14, "Military Rifle"),
    WEAPON_GUSENBERG: gun(14, "Gusenberg Sweeper"),
    /* 11,43 мм */
    WEAPON_DOUBLEACTION: gun(20, "Кольт"),
    WEAPON_REVOLVER: gun(45, "Револьвер"),
    /* 12 мм */
    WEAPON_MUSKET: gun(30, "Охотничье ружьё"),
    WEAPON_HEAVYSHOTGUN: gun(35, "Heavy Shotgun"),
    WEAPON_BULLPUPSHOTGUN: gun(35, "Дробовик булл-пап"),
    WEAPON_ASSAULTSHOTGUN: gun(35, "Assault Shotgun"),
    WEAPON_COMBATSHOTGUN: gun(35, "Combat Shotgun"),
    WEAPON_SAWNOFFSHOTGUN: gun(40, "Помповый обрез"),
    WEAPON_PUMPSHOTGUN: gun(45, "Pump Shotgun"),
    WEAPON_PUMPSHOTGUN_MK2: gun(45, "Pump Shotgun Mk2"),
    WEAPON_DBSHOTGUN: gun(45, "Обрез"),
    /* .50 */
    WEAPON_SNIPERRIFLE: gun(50, "Снайперская винтовка"),
  }),
});

const MAJESTIC = Object.freeze({
  id: "majestic",
  label: "Majestic RP",
  note: "Таблица вики проекта",
  source: "wiki.majestic-rp.ru/ru/items/ammunition",
  url: "https://wiki.majestic-rp.ru/ru/items/ammunition",
  updated: null,
  checked: "30.10.2026",
  weapons: Object.freeze({
    /* Пистолеты */
    WEAPON_PISTOL_MK2: gun(25, "Пистолет Mk2", 249),
    WEAPON_APPISTOL: gun(11, "Бронебойный пистолет", 255),
    WEAPON_PISTOL50: gun(25, "Штурмовой пистолет", 243),
    WEAPON_SNSPISTOL: gun(20, "Карманный пистолет", 245),
    WEAPON_HEAVYPISTOL: gun(22, "Тяжелый пистолет", 260),
    WEAPON_VINTAGEPISTOL: gun(15, "Винтажный пистолет", 261),
    WEAPON_MARKSMANPISTOL: gun(77, "Пистолет Marksman", 262),
    WEAPON_REVOLVER: gun(55, "Револьвер", 263),
    WEAPON_REVOLVER_MK2: gun(65, "Револьвер Mk2", 264),
    WEAPON_DOUBLEACTION: gun(44, "Наградной револьвер", 265),
    WEAPON_NAVYREVOLVER: gun(55, "Военно-морской револьвер", 430),
    WEAPON_GADGETPISTOL: gun(65, "Пистолет Перико", 431),
    /* Пистолеты-пулемёты */
    WEAPON_MICROSMG: gun(11, "Микро ПП", 472),
    WEAPON_SMG: gun(1, "ПП", 266),
    WEAPON_SMG_MK2: gun(13, "ПП Mk2", 267),
    WEAPON_ASSAULTSMG: gun(12, "Штурмовой ПП", 405),
    WEAPON_COMBATPDW: gun(12, "Боевой ПОС", 268),
    WEAPON_MACHINEPISTOL: gun(10, "Малый ПП", 269),
    WEAPON_MINISMG: gun(10, "Мини ПП", 270),
    WEAPON_TECPISTOL: gun(11, "Тактический ПП", 820),
    /* Винтовки */
    WEAPON_ASSAULTRIFLE: gun(14, "Штурмовая винтовка", 241),
    WEAPON_ASSAULTRIFLE_MK2: gun(19, "Штурмовая винтовка Mk2", 271),
    WEAPON_CARBINERIFLE: gun(13, "Карабинная винтовка", 275),
    WEAPON_CARBINERIFLE_MK2: gun(15, "Карабинная винтовка Mk2", 274),
    WEAPON_ADVANCEDRIFLE: gun(14, "Улучшенная винтовка", 248),
    WEAPON_SPECIALCARBINE: gun(13, "Специальный карабин", 273),
    WEAPON_SPECIALCARBINE_MK2: gun(15, "Специальный карабин Mk2", 272),
    WEAPON_BULLPUPRIFLE: gun(13, "Винтовка Буллпап", 276),
    WEAPON_BULLPUPRIFLE_MK2: gun(13, "Винтовка Буллпап Mk2", 277),
    WEAPON_COMPACTRIFLE: gun(16, "Компактная винтовка", 278),
    WEAPON_MILITARYRIFLE: gun(14, "Военная винтовка", 433),
    WEAPON_HEAVYRIFLE: gun(16, "Тяжёлая винтовка", 595),
    WEAPON_TACTICALRIFLE: gun(14, "Тактическая винтовка", 629),
    WEAPON_MUSKET: gun(101, "Мушкет", 973),
    /* Дробовики: урон всего выстрела */
    WEAPON_PUMPSHOTGUN: gun(64, "Помповый дробовик", 250),
    WEAPON_PUMPSHOTGUN_MK2: gun(80, "Помповый дробовик Mk2", 256),
    WEAPON_SAWNOFFSHOTGUN: gun(88, "Короткий дробовик", 247),
    WEAPON_ASSAULTSHOTGUN: gun(48, "Штурмовой дробовик", 257),
    WEAPON_HEAVYSHOTGUN: gun(40, "Тяжелый дробовик", 259),
    WEAPON_DBSHOTGUN: gun(56, "Двуствольный дробовик", 258),
    WEAPON_AUTOSHOTGUN: gun(30, "Автоматический дробовик", 330),
    WEAPON_COMBATSHOTGUN: gun(48, "Боевой дробовик", 432),
    /* Пулемёты */
    WEAPON_MG: gun(19, "Пулемёт Калашникова", 331),
    WEAPON_COMBATMG: gun(17, "Ручной пулемет", 332),
    WEAPON_COMBATMG_MK2: gun(17, "Ручной пулемет Mk2", 333),
    WEAPON_GUSENBERG: gun(14, "Пистолет-пулемёт Томпсона", 326),
    /* Снайперские */
    WEAPON_SNIPERRIFLE: gun(55, "Снайперская винтовка", 329),
    WEAPON_HEAVYSNIPER: gun(100, "Тяжелая снайперская винтовка", 279),
    WEAPON_HEAVYSNIPER_MK2: gun(150, "Тяжелая снайперская винтовка Mk2", 328),
    WEAPON_MARKSMANRIFLE: gun(32, "Винтовка Marksman", 1010),
    WEAPON_MARKSMANRIFLE_MK2: gun(34, "Винтовка Marksman Mk2", 337),
    WEAPON_PRECISIONRIFLE: gun(90, "Прецизионная винтовка", 630),
  }),
});

const FILES = Object.freeze({
  id: FILES_DAMAGE_SERVER,
  label: "Как в файлах игры",
  note: "Числа из файлов оружия вашей игры",
  source: null,
  url: null,
  updated: null,
  checked: null,
  weapons: null,
});

/** Что можно выбрать в инструменте: порядок — порядок в окне. */
export const DAMAGE_SERVERS = Object.freeze([GTA5RP, MAJESTIC, FILES]);

export const DAMAGE_SERVER_IDS = new Set(DAMAGE_SERVERS.map((server) => server.id));

const byId = new Map(DAMAGE_SERVERS.map((server) => [server.id, server]));

/** Запись таблицы; чужой номер — таблица по умолчанию. */
export const damageServer = (id) => byId.get(id) || GTA5RP;

/** Число ствола в таблице сервера или `null`: числа нет. */
export const serverWeaponDamage = (id, weapon) =>
  damageServer(id).weapons?.[weapon]?.value ?? null;

/** Сервер по проекту приложения (`astral.project.v1`); чужого проекта у таблиц нет. */
export const damageServerOfProject = (project) =>
  project === MAJESTIC.id ? MAJESTIC.id : project === GTA5RP.id ? GTA5RP.id : DEFAULT_DAMAGE_SERVER;
