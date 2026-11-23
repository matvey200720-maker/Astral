/*
 * Кто есть кто среди оружия GTA V — по данным самой игры.
 *
 * Один и тот же ствол называется четырьмя именами: в архиве это модель
 * (`w_ar_carbineriflemk2`), в weapons.meta — имя (`WEAPON_CARBINERIFLE_MK2`),
 * в каталоге — подраздел «Скины → Carbine Rifle MK2», в мастерской — полка
 * `carbine-rifle-mk2`. Пока каждое имя жило в своём словаре, словари
 * разъехались: ключ `w_pi_pistol_mk2` не совпадал с настоящей моделью
 * `w_pi_pistolmk2`, а флотский револьвер назывался пистолетом-пулемётом.
 *
 * Здесь одна таблица на всё. Имена и модели сверены с данными игры
 * (`tools/data/weapon_data_v3717.json`, сборка 3717). У каждого ствола:
 * имя в weapons.meta, модель, семейство, русское название, подраздел
 * каталога и полка мастерской, если она есть.
 *
 * Подраздел — буква в букву подпись из `catalogSections.js`: витрина
 * фильтрует по ней, и тест сверяет оба списка. У экзотики (рельсотрон,
 * атомизатор) подраздела нет намеренно — выдумывать полку каталога под
 * ствол, который никто не красит, значит засорять навигацию.
 */

const weapon = (id, model, family, name, catalog = null, shelf = null) =>
  Object.freeze({ id, model, family, name, catalog, shelf });

export const WEAPONS = Object.freeze([
  /* Пистолеты */
  weapon(
    "WEAPON_PISTOL",
    "w_pi_pistol",
    "pistol",
    "Пистолет",
    "Pistol",
    "pistol",
  ),
  weapon(
    "WEAPON_PISTOL_MK2",
    "w_pi_pistolmk2",
    "pistol",
    "Пистолет MK2",
    "Pistol MK2",
    "pistol-mk2",
  ),
  weapon(
    "WEAPON_COMBATPISTOL",
    "w_pi_combatpistol",
    "pistol",
    "Боевой пистолет",
    "Combat Pistol",
    "combat-pistol",
  ),
  weapon(
    "WEAPON_APPISTOL",
    "w_pi_appistol",
    "pistol",
    "Автоматический пистолет",
    "AP Pistol",
    "ap-pistol",
  ),
  weapon(
    "WEAPON_PISTOL50",
    "w_pi_pistol50",
    "pistol",
    "Пистолет .50",
    "Pistol .50",
    "pistol-50",
  ),
  weapon(
    "WEAPON_SNSPISTOL",
    "w_pi_sns_pistol",
    "pistol",
    "Карманный пистолет",
    "SNS Pistol",
  ),
  weapon(
    "WEAPON_SNSPISTOL_MK2",
    "w_pi_sns_pistolmk2",
    "pistol",
    "Карманный пистолет MK2",
    "SNS Pistol MK2",
  ),
  weapon(
    "WEAPON_HEAVYPISTOL",
    "w_pi_heavypistol",
    "pistol",
    "Тяжёлый пистолет",
    "Heavy Pistol",
    "heavy-pistol",
  ),
  weapon(
    "WEAPON_VINTAGEPISTOL",
    "w_pi_vintage_pistol",
    "pistol",
    "Винтажный пистолет",
    "Vintage Pistol",
  ),
  weapon(
    "WEAPON_MARKSMANPISTOL",
    "w_pi_singleshot",
    "pistol",
    "Марксманский пистолет",
    "Marksman Pistol",
  ),
  weapon(
    "WEAPON_REVOLVER",
    "w_pi_revolver",
    "pistol",
    "Револьвер",
    "Heavy Revolver",
    "revolver",
  ),
  weapon(
    "WEAPON_REVOLVER_MK2",
    "w_pi_revolvermk2",
    "pistol",
    "Револьвер MK2",
    "Revolver MK2",
  ),
  weapon(
    "WEAPON_DOUBLEACTION",
    "w_pi_wep1_gun",
    "pistol",
    "Револьвер двойного действия",
    "Double Action Revolver",
  ),
  weapon(
    "WEAPON_NAVYREVOLVER",
    "w_pi_wep2_gun",
    "pistol",
    "Флотский револьвер",
  ),
  weapon(
    "WEAPON_CERAMICPISTOL",
    "w_pi_ceramic_pistol",
    "pistol",
    "Керамический пистолет",
  ),
  weapon(
    "WEAPON_GADGETPISTOL",
    "w_pi_singleshoth4",
    "pistol",
    "Перико-пистолет",
  ),
  weapon("WEAPON_PISTOLXM3", "w_pi_pistol_xm3", "pistol", "Пистолет WM 29"),
  weapon(
    "WEAPON_STUNGUN",
    "w_pi_stungun",
    "pistol",
    "Тазер",
    "Тазер",
    "stun-gun",
  ),
  weapon("WEAPON_FLAREGUN", "w_pi_flaregun", "pistol", "Ракетница"),
  weapon("WEAPON_RAYPISTOL", "w_pi_raygun", "pistol", "Атомизатор"),

  /* Пистолеты-пулемёты */
  weapon(
    "WEAPON_MICROSMG",
    "w_sb_microsmg",
    "smg",
    "Микро ПП",
    "Micro SMG",
    "micro-smg",
  ),
  weapon("WEAPON_SMG", "w_sb_smg", "smg", "Пистолет-пулемёт", "SMG", "smg"),
  weapon(
    "WEAPON_SMG_MK2",
    "w_sb_smgmk2",
    "smg",
    "ПП MK2",
    "SMG MK2",
    "smg-mk2",
  ),
  weapon(
    "WEAPON_ASSAULTSMG",
    "w_sb_assaultsmg",
    "smg",
    "Штурмовой ПП",
    "Assault SMG",
    "assault-smg",
  ),
  weapon(
    "WEAPON_COMBATPDW",
    "w_sb_pdw",
    "smg",
    "Боевой PDW",
    "Combat PDW",
    "combat-pdw",
  ),
  weapon(
    "WEAPON_MACHINEPISTOL",
    "w_sb_compactsmg",
    "smg",
    "Автоматический пистолет-пулемёт",
    "Machine Pistol",
  ),
  weapon(
    "WEAPON_MINISMG",
    "w_sb_minismg",
    "smg",
    "Мини ПП",
    "Mini SMG",
    "mini-smg",
  ),
  weapon(
    "WEAPON_TECPISTOL",
    "w_pi_pistolsmg_m31",
    "smg",
    "Тактический ПП",
    "Pistol SMG",
  ),
  weapon(
    "WEAPON_GUSENBERG",
    "w_sb_gusenberg",
    "machinegun",
    "Автомат Гузенберга",
    "Gusenberg",
    "gusenberg-sweeper",
  ),

  /* Винтовки */
  weapon(
    "WEAPON_ASSAULTRIFLE",
    "w_ar_assaultrifle",
    "rifle",
    "Штурмовая винтовка",
    "Assault Rifle",
    "assault-rifle",
  ),
  weapon(
    "WEAPON_ASSAULTRIFLE_MK2",
    "w_ar_assaultriflemk2",
    "rifle",
    "Штурмовая винтовка MK2",
    "Assault Rifle MK2",
  ),
  weapon(
    "WEAPON_CARBINERIFLE",
    "w_ar_carbinerifle",
    "rifle",
    "Карабинная винтовка",
    "Carbine Rifle",
    "carbine-rifle",
  ),
  weapon(
    "WEAPON_CARBINERIFLE_MK2",
    "w_ar_carbineriflemk2",
    "rifle",
    "Карабинная винтовка MK2",
    "Carbine Rifle MK2",
    "carbine-rifle-mk2",
  ),
  weapon(
    "WEAPON_ADVANCEDRIFLE",
    "w_ar_advancedrifle",
    "rifle",
    "Улучшенная винтовка",
    "Advanced Rifle",
    "advanced-rifle",
  ),
  weapon(
    "WEAPON_SPECIALCARBINE",
    "w_ar_specialcarbine",
    "rifle",
    "Специальный карабин",
    "Special Carbine",
    "special-carbine",
  ),
  weapon(
    "WEAPON_SPECIALCARBINE_MK2",
    "w_ar_specialcarbinemk2",
    "rifle",
    "Специальный карабин MK2",
    "Special Carbine MK2",
    "special-carbine-mk2",
  ),
  weapon(
    "WEAPON_BULLPUPRIFLE",
    "w_ar_bullpuprifle",
    "rifle",
    "Булл-пап винтовка",
    "Bullpup Rifle",
    "bullpup-rifle",
  ),
  weapon(
    "WEAPON_BULLPUPRIFLE_MK2",
    "w_ar_bullpupriflemk2",
    "rifle",
    "Булл-пап винтовка MK2",
    "Bullpup Rifle MK2",
  ),
  weapon(
    "WEAPON_COMPACTRIFLE",
    "w_ar_assaultrifle_smg",
    "rifle",
    "Компактная винтовка",
    "Compact Rifle",
  ),
  weapon(
    "WEAPON_MILITARYRIFLE",
    "w_ar_bullpuprifleh4",
    "rifle",
    "Военная винтовка",
    "Military Rifle",
  ),
  weapon(
    "WEAPON_HEAVYRIFLE",
    "w_ar_heavyrifleh",
    "rifle",
    "Тяжёлая винтовка",
    "Heavy Rifle",
  ),
  weapon(
    "WEAPON_TACTICALRIFLE",
    "w_ar_carbinerifle_reh",
    "rifle",
    "Служебный карабин",
    "Service Carbine",
    "carabine_reh",
  ),
  weapon(
    "WEAPON_BATTLERIFLE",
    "w_sl_battlerifle_m32",
    "rifle",
    "Боевая винтовка",
    "Battle Rifle",
  ),
  weapon("WEAPON_MUSKET", "w_ar_musket", "rifle", "Мушкет", "Мушкет"),
  weapon("WEAPON_RAYCARBINE", "w_ar_srifle", "rifle", "Адский карабин"),

  /* Дробовики */
  weapon(
    "WEAPON_PUMPSHOTGUN",
    "w_sg_pumpshotgun",
    "shotgun",
    "Помповый дробовик",
    "Pump Shotgun",
    "pump-shotgun",
  ),
  weapon(
    "WEAPON_PUMPSHOTGUN_MK2",
    "w_sg_pumpshotgunmk2",
    "shotgun",
    "Помповый дробовик MK2",
    "Pump Shotgun MK2",
  ),
  weapon(
    "WEAPON_SAWNOFFSHOTGUN",
    "w_sg_sawnoff",
    "shotgun",
    "Обрез",
    "Sawed-Off Shotgun",
    "sawed-off-shotgun",
  ),
  weapon(
    "WEAPON_ASSAULTSHOTGUN",
    "w_sg_assaultshotgun",
    "shotgun",
    "Штурмовой дробовик",
    "Assault Shotgun",
    "assault-shotgun",
  ),
  weapon(
    "WEAPON_BULLPUPSHOTGUN",
    "w_sg_bullpupshotgun",
    "shotgun",
    "Булл-пап дробовик",
    "Bullpup Shotgun",
    "bullpup-shotgun",
  ),
  weapon(
    "WEAPON_HEAVYSHOTGUN",
    "w_sg_heavyshotgun",
    "shotgun",
    "Тяжёлый дробовик",
    "Heavy Shotgun",
    "heavy-shotgun",
  ),
  weapon(
    "WEAPON_DBSHOTGUN",
    "w_sg_doublebarrel",
    "shotgun",
    "Двуствольный дробовик",
    "Double Barrel Shotgun",
    "double-barrel-shotgun",
  ),
  weapon(
    "WEAPON_AUTOSHOTGUN",
    "w_sg_sweeper",
    "shotgun",
    "Автоматический дробовик",
    "Sweeper Shotgun",
  ),
  weapon(
    "WEAPON_COMBATSHOTGUN",
    "w_sg_pumpshotgunh4",
    "shotgun",
    "Боевой дробовик",
    "Combat Shotgun",
  ),

  /* Пулемёты */
  weapon("WEAPON_MG", "w_mg_mg", "machinegun", "Пулемёт", "MG", "mg"),
  weapon(
    "WEAPON_COMBATMG",
    "w_mg_combatmg",
    "machinegun",
    "Боевой пулемёт",
    "Combat MG",
    "combat-mg",
  ),
  weapon(
    "WEAPON_COMBATMG_MK2",
    "w_mg_combatmgmk2",
    "machinegun",
    "Боевой пулемёт MK2",
    "Combat MG MK2",
  ),

  /* Снайперские */
  weapon(
    "WEAPON_SNIPERRIFLE",
    "w_sr_sniperrifle",
    "sniper",
    "Снайперская винтовка",
    "Sniper Rifle",
    "sniper-rifle",
  ),
  weapon(
    "WEAPON_HEAVYSNIPER",
    "w_sr_heavysniper",
    "sniper",
    "Тяжёлая снайперская винтовка",
    "Heavy Sniper",
    "heavy-sniper",
  ),
  weapon(
    "WEAPON_HEAVYSNIPER_MK2",
    "w_sr_heavysnipermk2",
    "sniper",
    "Тяжёлая снайперская винтовка MK2",
    "Heavy Sniper MK2",
    "heavy-sniper-mk2",
  ),
  weapon(
    "WEAPON_MARKSMANRIFLE",
    "w_sr_marksmanrifle",
    "sniper",
    "Марксманская винтовка",
    "Marksman Rifle",
    "marksman-rifle",
  ),
  weapon(
    "WEAPON_MARKSMANRIFLE_MK2",
    "w_sr_marksmanriflemk2",
    "sniper",
    "Марксманская винтовка MK2",
    "Marksman Rifle MK2",
  ),
  weapon(
    "WEAPON_PRECISIONRIFLE",
    "w_sr_precisionrifle_reh",
    "sniper",
    "Высокоточная винтовка",
    "Precision Rifle",
  ),

  /* Тяжёлое */
  weapon(
    "WEAPON_GRENADELAUNCHER",
    "w_lr_grenadelauncher",
    "launcher",
    "Гранатомёт",
    "Grenade Launcher",
    "grenade-launcher",
  ),
  weapon("WEAPON_RPG", "w_lr_rpg", "launcher", "РПГ"),
  weapon(
    "WEAPON_COMPACTLAUNCHER",
    "w_lr_compactgl",
    "launcher",
    "Компактный гранатомёт",
  ),
  weapon(
    "WEAPON_HOMINGLAUNCHER",
    "w_lr_homing",
    "launcher",
    "Самонаводящаяся ракетница",
  ),
  weapon(
    "WEAPON_EMPLAUNCHER",
    "w_lr_compactml",
    "launcher",
    "Компактный ЭМИ-гранатомёт",
  ),
  weapon("WEAPON_FIREWORK", "w_lr_firework", "launcher", "Фейерверк"),
  weapon("WEAPON_MINIGUN", "w_mg_minigun", "launcher", "Миниган"),
  weapon("WEAPON_RAILGUN", "w_ar_railgun", "launcher", "Рельсотрон"),

  /* Холодное */
  weapon("WEAPON_KNIFE", "w_me_knife_01", "melee", "Нож", "Нож"),
  weapon("WEAPON_BAT", "w_me_bat", "melee", "Бита", "Бита"),
  weapon("WEAPON_SWITCHBLADE", "w_me_switchblade", "melee", "Выкидной нож"),
  weapon("WEAPON_MACHETE", "w_me_machette_lr", "melee", "Мачете"),
  weapon("WEAPON_KNUCKLE", "w_me_knuckle", "melee", "Кастет"),
  weapon("WEAPON_DAGGER", "w_me_dagger", "melee", "Кинжал"),
  weapon("WEAPON_HATCHET", "w_me_hatchet", "melee", "Топорик"),
  weapon("WEAPON_BATTLEAXE", "w_me_battleaxe", "melee", "Боевой топор"),
  weapon("WEAPON_CROWBAR", "w_me_crowbar", "melee", "Лом"),
  weapon("WEAPON_GOLFCLUB", "w_me_gclub", "melee", "Клюшка для гольфа"),
  weapon("WEAPON_NIGHTSTICK", "w_me_nightstick", "melee", "Дубинка"),
  weapon("WEAPON_HAMMER", "w_me_hammer", "melee", "Молоток"),
  weapon("WEAPON_WRENCH", "w_me_wrench", "melee", "Гаечный ключ"),
  weapon("WEAPON_POOLCUE", "w_me_poolcue", "melee", "Кий"),
  weapon("WEAPON_BOTTLE", "w_me_bottle", "melee", "Розочка"),
  weapon("WEAPON_FLASHLIGHT", "w_me_flashlight", "melee", "Фонарик"),
  weapon(
    "WEAPON_STONE_HATCHET",
    "w_me_stonehatchet",
    "melee",
    "Каменный топор",
  ),
  weapon("WEAPON_STUNROD", "w_me_rod_m41", "melee", "Электродубинка"),
  weapon("WEAPON_CANDYCANE", "w_me_candy_xm3", "melee", "Леденец"),

  /*
   * Метательное (Т-126): гранаты, мины, зажигательное и канистры. Подраздела
   * каталога и полки мастерской у них нет — как у остальной экзотики: красить
   * гранату никто не просит, а ганпаки с их моделями встречаются, и без строки
   * в таблице такая модель была «неизвестной».
   */
  weapon("WEAPON_GRENADE", "w_ex_grenadefrag", "thrown", "Граната"),
  weapon("WEAPON_STICKYBOMB", "w_ex_pe", "thrown", "Липкая бомба"),
  weapon("WEAPON_PROXMINE", "w_ex_apmine", "thrown", "Мина"),
  weapon("WEAPON_PIPEBOMB", "w_ex_pipebomb", "thrown", "Самодельная бомба"),
  weapon("WEAPON_MOLOTOV", "w_ex_molotov", "thrown", "Коктейль Молотова"),
  /* Слезоточивый газ и «BZ-газ» в игре — две записи на одну модель; в таблице
     модель одна, и она у дымовой гранаты. */
  weapon(
    "WEAPON_SMOKEGRENADE",
    "w_ex_grenadesmoke",
    "thrown",
    "Дымовая граната",
  ),
  weapon("WEAPON_FLARE", "w_am_flare", "thrown", "Сигнальная шашка"),
  weapon("WEAPON_SNOWBALL", "w_ex_snowball", "thrown", "Снежок"),
  weapon("WEAPON_BALL", "w_am_baseball", "thrown", "Мяч"),
  weapon("WEAPON_PETROLCAN", "w_am_jerrycan", "thrown", "Канистра"),
  weapon("WEAPON_HAZARDCAN", "w_ch_jerrycan", "thrown", "Опасная канистра"),
  weapon(
    "WEAPON_FERTILIZERCAN",
    "w_am_jerrycan_sf",
    "thrown",
    "Канистра с удобрением",
  ),
]);

const byModel = new Map(WEAPONS.map((item) => [item.model, item]));
const byId = new Map(WEAPONS.map((item) => [item.id, item]));
/* Длинные модели первыми: `w_pi_pistol50` должен найтись раньше `w_pi_pistol`. */
const modelsLongestFirst = [...byModel.keys()].sort(
  (left, right) => right.length - left.length,
);

/** Имя файла модели без расширения и без `_hi` / `+hi`. */
export const cleanWeaponModel = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/^.*[\\/]/, "")
    .replace(/\.(ydr|ytd|yft|ydd)$/, "")
    .replace(/(\+hi|_hi)$/, "");

/** Ствол по имени из weapons.meta (`WEAPON_PISTOL`). */
export const weaponById = (id) =>
  byId.get(
    String(id || "")
      .trim()
      .toUpperCase(),
  ) || null;

/** Ствол по точному имени модели. */
export const weaponByModel = (model) =>
  byModel.get(cleanWeaponModel(model)) || null;

/*
 * Штатный магазин ствола — отдельная модель со своим словарём текстур
 * (`w_pi_pistol_mag1.ydr` + `w_pi_pistol_mag1.ytd`), игра вешает его на кость
 * `WAPClip`. По данным игры (компонент `*_CLIP_01` с `IsDefault`) у
 * большинства это `<ствол>_mag1`; здесь — те, у кого иначе. У ствола без
 * магазина (дробовики, тазер) такого файла в игре просто нет.
 */
const ODD_MAGAZINES = Object.freeze({
  w_pi_ceramic_pistol: "w_pi_ceramic_mag1",
  w_pi_singleshoth4: "w_pi_singleshoth4_shell",
  w_sr_precisionrifle_reh: "w_sr_w_sr_precisionrifle_reh_mag1",
  w_pi_wep1_gun: "w_pi_wep1_mag1",
  w_lr_grenadelauncher: "w_lr_40mm",
  w_ar_musket: "p_w_ar_musket_chrg",
  w_ar_heavyrifleh: "w_ar_specialcarbine_mag1",
  w_ar_carbinerifle_reh: "w_ar_carbinerifle_mag1",
  w_pi_singleshot: "w_pi_singleshot_shell",
  w_ar_railgun_xm3: "w_ar_railgun_mag1",
});

/* У холодного и метательного магазина нет вовсе: искать его в архивах
   незачем (поиск по всем пакетам — секунды на пустом месте). */
const NO_MAGAZINE_FAMILIES = new Set(["melee", "thrown"]);

/** Имя модели штатного магазина ствола (в игре его может не быть). */
export function defaultMagazineModel(model) {
  const base = cleanWeaponModel(model);
  if (!/^w_[a-z]{2}_[a-z0-9_]+$/.test(base)) return null;
  if (NO_MAGAZINE_FAMILIES.has(byModel.get(base)?.family)) return null;
  return ODD_MAGAZINES[base] || `${base}_mag1`;
}

/**
 * Что это за модель.
 *
 *  • `attachment` — общий обвес `w_at_*`: прицел, глушитель, фонарь. Один
 *    обвес стоит на многих стволах, своим стволом он не бывает.
 *  • `weapon` — ствол из таблицы. Детали ствола (`_sight`, `_mag1`) и
 *    авторские варианты (`w_ar_carbinerifle_m31`) узнаются по самой длинной
 *    известной модели в начале имени — на границе подчёркивания или цифры,
 *    чтобы `w_pi_pistolx` не стал пистолетом.
 *  • `unknown` — модель, которой в таблице нет.
 */
export function identifyWeaponModel(name) {
  const model = cleanWeaponModel(name);
  if (/^w_at_/.test(model)) return { kind: "attachment", model };
  const exact = byModel.get(model);
  if (exact) return { kind: "weapon", model: exact.model, weapon: exact };
  const known = modelsLongestFirst.find(
    (candidate) =>
      model.startsWith(candidate) &&
      /^[_\d]/.test(model.slice(candidate.length)),
  );
  if (known)
    return { kind: "weapon", model: known, weapon: byModel.get(known) };
  return { kind: "unknown", model };
}

const byShelf = new Map(
  WEAPONS.filter((item) => item.shelf).map((item) => [item.shelf, item]),
);

const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/*
 * Полка мастерской у ствола без своей полки в поставке (задача 6 ТЗ
 * 17.10.2026: ближний бой, все MK2, метательное — модель из игры игрока):
 * его слот каталога (`revolver-mk2`) или, без подраздела, имя модели
 * (`knife-01`) — тот же слот, что даёт `describeWeaponSlot`, чтобы моды
 * каталога и скины одного ствола не разъезжались по двум местам.
 */
const plainSlotOf = (weapon) =>
  weapon?.shelf ||
  slug(weapon?.catalog) ||
  slug(String(weapon?.model || "").replace(/^w_[a-z]{2}_/, "")) ||
  "";

/* Две канистры (`w_am_jerrycan`, `w_ch_jerrycan`) дают одно короткое имя —
   у второй полка зовётся по модели целиком. */
const studioSlots = new Map();
for (const weapon of WEAPONS) {
  const plain = plainSlotOf(weapon);
  const taken = [...studioSlots.values()].includes(plain);
  studioSlots.set(weapon, taken ? slug(weapon.model) : plain);
}

export const studioSlotOf = (weapon) =>
  studioSlots.get(weapon) || studioSlots.get(byId.get(weapon?.id)) || plainSlotOf(weapon);

const byStudioSlot = new Map(
  WEAPONS.filter((item) => !item.shelf).map((item) => [studioSlotOf(item), item]),
);

/**
 * Ствол по полке мастерской (`revolver`, `carbine-rifle-mk2`, а у стволов
 * только из игры — `revolver-mk2`, `knife-01`) — чтобы мастерская оружия
 * знала, в какие файлы игры запекать покраску.
 */
export const weaponByShelf = (shelf) => {
  const id = String(shelf || "").trim();
  return byShelf.get(id) || byStudioSlot.get(id) || null;
};
