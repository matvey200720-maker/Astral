/*
 * Бронежилеты по проектам (ТЗ 04.10.2026, задача 9).
 *
 * Как это устроено в игре. Бронежилет персонажа — компонент 9 (`task`):
 * модель `task_NNN_u.ydd` и её цвета `task_diff_NNN_<буква>_uni.ytd`. Проект
 * выдаёт фракции модель и цвет; заменёнка меняет файл цвета — и её видят
 * все, кто носит этот цвет. У жилета GTA Online один крой (одна развёртка)
 * на всё семейство: штатный жилет (`mp_m_freemode_01`, №1–9, пять цветов),
 * жилет фракций из обновления 01.2016 (`…_mp_m_january2016`, №0–11, десять
 * цветов) и тактический жилет ограблений (`…_male_heist`, №0, те же пять
 * текстур, что у штатного). Это проверено по файлам игры: развёртки
 * совпадают, отличается цвет.
 *
 * Жилет фракций Rockstar выпустила к обновлению про банды Лос-Сантоса: пять
 * его цветов — цвета банд (зелёный Families, оранжевый Vagos, фиолетовый
 * Ballas, бордовый Bloods, синий Marabunta). Моды бронежилетов для проектов
 * ставят именно в него («всех цветов» — значит, на все фракции).
 *
 * Поэтому «конкретный бронежилет» здесь — цвет семейства: покраска ложится
 * в файл этого цвета у всех моделей семейства (какую из моделей выдаёт
 * проект, он не сообщает), а модель и прочие цвета остаются заводскими. Чей
 * какой цвет на проекте — подсказка, а не факт сервера: так и подписано.
 *
 * Тяжёлый бронежилет (`…_male_apt01`, №1–2) и разгрузка (`…_mp_m_2023_01`,
 * №0) — другой крой: на них ставится только покраска их самих.
 *
 * Чистый JS: работает в окне, в главном процессе и в тестах.
 */

const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const colours = (entries) =>
  Object.freeze(
    Object.fromEntries(
      entries.map(([letter, label, swatch]) => [
        letter,
        Object.freeze({ label, swatch }),
      ]),
    ),
  );

/* Средний цвет текстуры каждого цвета — посчитан по файлам игры. */
const STOCK_COLOURS = colours([
  ["a", "Серый", "#4e4e4e"],
  ["b", "Чёрный", "#202020"],
  ["c", "Оливковый", "#3f4632"],
  ["d", "Пустынный камуфляж", "#695d54"],
  ["e", "Лесной камуфляж", "#4f4e43"],
]);

const STREET_COLOURS = colours([
  ["a", "Зелёный", "#2f4529"],
  ["b", "Оранжевый", "#8e5731"],
  ["c", "Фиолетовый", "#523371"],
  ["d", "Розовый", "#d079c6"],
  ["e", "Бордовый", "#532728"],
  ["f", "Синий", "#303b66"],
  ["g", "Графитовый", "#393839"],
  ["h", "Хаки", "#52493f"],
  ["i", "Светло-серый", "#a7a7a7"],
  ["j", "Чёрный", "#161616"],
]);

const HEAVY_COLOURS = colours([
  ["a", "Песочный", "#5c544a"],
  ["b", "Оливковый", "#2e322c"],
  ["c", "Чёрный", "#1a1a1a"],
]);

const RIG_COLOURS = colours([
  ["a", "Оливковый", "#44443c"],
  ["b", "Песочный", "#856e56"],
  ["c", "Чёрный", "#1d1d1d"],
]);

/**
 * Бронежилеты игры: `cut` — крой (одна развёртка), `drawables` — модели,
 * `colours` — цвета по буквам. Порядок — как в списке «Замены».
 */
export const ARMOR_MEMBERS = Object.freeze([
  Object.freeze({
    id: "stock",
    cut: "vest",
    title: "Штатный жилет GTA Online",
    noun: "Штатный бронежилет",
    folder: "mp_m_freemode_01",
    drawables: Object.freeze(range(1, 9)),
    colours: STOCK_COLOURS,
  }),
  Object.freeze({
    id: "street",
    cut: "vest",
    title: "Жилет фракций (обновление 01.2016)",
    noun: "Жилет фракций",
    folder: "mp_m_freemode_01_mp_m_january2016",
    drawables: Object.freeze(range(0, 11)),
    colours: STREET_COLOURS,
  }),
  Object.freeze({
    id: "tactical",
    cut: "vest",
    title: "Тактический жилет (ограбления)",
    noun: "Тактический жилет",
    folder: "mp_m_freemode_01_male_heist",
    drawables: Object.freeze([0]),
    colours: STOCK_COLOURS,
  }),
  Object.freeze({
    id: "heavy",
    cut: "heavy",
    title: "Тяжёлый бронежилет",
    noun: "Тяжёлый бронежилет",
    folder: "mp_m_freemode_01_male_apt01",
    drawables: Object.freeze([1, 2]),
    colours: HEAVY_COLOURS,
  }),
  Object.freeze({
    id: "rig",
    cut: "rig",
    title: "Разгрузка (обновление 01.2023)",
    noun: "Разгрузка",
    folder: "mp_m_freemode_01_mp_m_2023_01",
    drawables: Object.freeze([0]),
    colours: RIG_COLOURS,
  }),
]);

const CUT_NAMES = Object.freeze({
  vest: "жилет GTA Online",
  heavy: "тяжёлый бронежилет",
  rig: "разгрузку",
});

export const armorMember = (id) =>
  ARMOR_MEMBERS.find((member) => member.id === id) || null;

/** Чей бронежилет лежит в этом месте игры: `{ folder, drawable }` → член семейства. */
export function armorMemberOf(place) {
  const folder = String(place?.folder || "").toLowerCase();
  const drawable = Number(place?.drawable);
  return (
    ARMOR_MEMBERS.find(
      (member) =>
        member.folder === folder && member.drawables.includes(drawable),
    ) || null
  );
}

/** Имя бронежилета игры для «Моделей»; `null` — не из известных. */
export function armorItemName(place) {
  const member = armorMemberOf(place);
  if (!member) return null;
  return member.drawables.length > 1
    ? `${member.noun} №${place.drawable}`
    : member.noun;
}

/**
 * То же имя словами и номером порознь (17.11.2026): слова по-русски — ключ словаря окна, оно переводит их на язык интерфейса, номер у вещи семейства из нескольких (`null` — вещь одна).
 * `null` — не из известных.
 */
export function armorItemWords(place) {
  const member = armorMemberOf(place);
  if (!member) return null;
  return { words: member.noun, number: member.drawables.length > 1 ? Number(place.drawable) : null };
}

/** Папка вещи женской версии → папка мужской: жилеты одни и те же, у женщин свои номера. */
const maleFolder = (folder) =>
  String(folder || "")
    .toLowerCase()
    .replace(/^mp_f_/, "mp_m_")
    .replace(/_mp_f_/, "_mp_m_")
    .replace(/_female_/, "_male_");

/** Штатный жилет игры по месту вещи любого пола; `null` — скин или вещь не из семейства. */
export const standardArmorMember = (item) =>
  ARMOR_MEMBERS.find((member) => member.folder === maleFolder(item?.folder)) || null;

/*
 * Бронежилеты Majestic (файл владельца dlc.rpf, 01.11.2026): моддеры прячут вид брони, подменяя ровно эти четыре вещи, значит это они и есть.
 * Какая из них сколько держит — по картинкам и прочности вики Majestic (лёгкий — простой жилет, тяжёлый — чёрный с карманами, сверхтяжёлый — песочный). В игре не сверено.
 */
const MAJESTIC_ARMOR = Object.freeze({
  "mp_m_freemode_01_mp_m_january2016": Object.freeze({ drawable: 11, name: "Лёгкий бронежилет · 50%", member: "street", tier: 1 }),
  "mp_m_freemode_01_mp_m_clothes_pack0": Object.freeze({ drawable: 8, name: "Тяжёлый бронежилет · 100%", member: null, tier: 1.1 }),
  "mp_m_freemode_01_male_apt01": Object.freeze({ drawable: 2, name: "Сверхтяжёлый бронежилет · 150%", member: "heavy", tier: 1.2 }),
  "mp_m_freemode_01_male_heist": Object.freeze({ drawable: 0, name: "Служебный бронежилет", member: "tactical", tier: 1.3 }),
});

/*
 * Порядок в окне (владелец, 02.11.2026): сначала обычные жилеты игры — разноцветные, у фракций именно они; потом бронежилеты Majestic по прочности; потом скины.
 * Целая часть `armorTier` — ступень, дробная — место внутри неё.
 */
const STANDARD_TIER = Object.freeze({ stock: 0, street: 0.1, tactical: 0, heavy: 0.3, rig: 0.4 });
const SKIN_TIER = 2;
/* Скин Majestic — вещь из файлов и вики проекта; подпись из поста мода (`author`, `catalog`) вещью не считается. */
const PROJECT_SOURCES = Object.freeze(["curated", "external", "files"]);
const fromProject = (item) => (item?.sources || []).some((source) => PROJECT_SOURCES.includes(source));

/**
 * Вещь в окне выбора по проекту: что показать или `null`. Всем — обычные жилеты игры; Majestic — ещё четыре настоящие по прочности (жилет фракций у него и есть лёгкий · 50%);
 * скины — с сайта Nightz у GTA5RP и из вики у Majestic. Только мужские: женские не нужны (владелец, 01.11.2026).
 */
export function armorChoice(item, server, siteRecord = null) {
  if (item?.gender === "female") return null;
  const folder = String(item?.folder || "").toLowerCase();
  if (siteRecord) return { name: siteRecord.name, colourPictures: siteRecord.images, armorTier: SKIN_TIER };
  const standard = armorMemberOf(item);
  const tile = (member) => ({ name: armorTileName(member, server), colourNames: armorColourNames(member, server), armorTier: STANDARD_TIER[member.id] });
  if (server === "majestic") {
    const own = MAJESTIC_ARMOR[folder];
    if (own?.drawable === item.drawable) {
      const member = own.member ? armorMember(own.member) : null;
      /* Вещь проекта, а не игры: в окне другого проекта она идёт с его именем, и выбор переключает проект. */
      return { name: own.name, server: "majestic", armorTier: own.tier, ...(member ? { colourNames: armorColourNames(member, server) } : {}) };
    }
    if (standard?.id === "stock") return tile(standard);
    return !own && !standard && item.server === "majestic" && item.name && fromProject(item) ? { armorTier: SKIN_TIER } : null;
  }
  return standard ? tile(standard) : null;
}

/*
 * Имя жилета в окне выбора по проекту (владелец, 01.11.2026: на Majestic разделить 50 % и 100 %). Majestic: лёгкий — жилет 01.2016 (моды «50% Armor» ставятся на него),
 * прочность тяжёлого и сверхтяжёлого — из вики проекта («Тяжелый бронежилет… прочность 100», «Сверхтяжёлый… 150»).
 */
const ARMOR_TILE_NAMES = Object.freeze({
  other: Object.freeze({
    street: "Фракционный бронежилет",
    heavy: "Тяжёлый бронежилет",
    rig: "Разгрузка",
    stock: "Стандартный бронежилет",
    tactical: "Стандартный бронежилет",
  }),
});

export const armorTileName = (member, server) =>
  (ARMOR_TILE_NAMES[server] || ARMOR_TILE_NAMES.other)[member.id] || member.noun;

/** Подписи цветов жилета по порядку текстур: чей цвет на проекте, иначе сам цвет. */
export function armorColourNames(member, server) {
  const gangs = member.id === "street" ? ARMOR_PROJECTS[server]?.gangs || {} : {};
  return Object.entries(member.colours).map(([letter, colour]) => gangs[letter] || colour.label);
}

/*
 * Проекты: какие фракции носят бронежилеты и что о них известно.
 * Списки фракций — с сайтов проектов (вики GTA5RP, вики Majestic «Крафты
 * фракций»); цвета банд — общепринятые, ими же подписаны моды для проектов.
 */
export const ARMOR_PROJECTS = Object.freeze({
  /* Вкладка «GTA» (14.11.2026): штатные жилеты игры, проекта у них нет. */
  gta: Object.freeze({
    note: "Жилеты из пакетов обновлений (фракций, тактический, тяжёлый, разгрузка) заменяются на месте в паке игры — этот пак грузят и RAGE MP, и Majestic. Штатный жилет базовой игры ставится в Astral Clothing DLC: Majestic его не увидит, и на GTA 5 RP (RAGE MP) его не видно: клиент сервера не подключает пакеты Astral.",
    gangs: Object.freeze({}),
    others: "",
    government: "",
  }),
  gta5rp: Object.freeze({
    note: "На GTA5RP бронежилеты фракций приходят с сервера — у проекта свой способ сменить их вид (F10 → «Коллекции» → «Броня»). Администрация пишет, что заменённые в файлах бронежилеты на проекте не видны. Astral поставит покраску в файлы игры, но увидишь ли её на GTA5RP, решает сервер.",
    gangs: Object.freeze({
      a: "The Families",
      b: "Los Santos Vagos",
      c: "East Side Ballas",
      e: "Bloods Street Gang",
      f: "Marabunta Grande",
      i: "Организации",
    }),
    others: "Цвета банд — общепринятые, ими подписаны моды для проекта. Остальные цвета — мафии (Русская, Итальянская, Армянская, Мексиканская, Японская): чей какой, проект не сообщает",
    government:
      "Government, LSPD, LSSD, National Guard, EMS, Weazel News, FIB, SASPA",
  }),
  majestic: Object.freeze({
    note: "Лёгкий бронежилет банд и магазина на Majestic — жилет игры: моды для проекта меняют его цвета в обновлении 01.2016. Служебные бронежилеты (лёгкий и тяжёлый) — у гос. структур.",
    gangs: Object.freeze({
      a: "Families",
      b: "Vagos",
      c: "Ballas",
      e: "Bloods",
      f: "Marabunta",
    }),
    others: "Цвета банд — общепринятые, ими подписаны моды для проекта. Чей остальной цвет, проект не сообщает",
    government: "LSPD, LSCSD, EMS, SANG, GOV, WN, FIB",
  }),
  rmrp: Object.freeze({
    note: "Раскладку бронежилетов RMRP Astral не знает: выбери жилет и цвет по виду в игре.",
    gangs: Object.freeze({}),
    others: "",
    government: "",
  }),
});

const projectOf = (server) =>
  ARMOR_PROJECTS[server] || ARMOR_PROJECTS.rmrp;

const MODEL_WORDS = ["модель", "модели", "моделей"];
const modelsWord = (count) => {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return MODEL_WORDS[2];
  if (ones === 1) return MODEL_WORDS[0];
  if (ones >= 2 && ones <= 4) return MODEL_WORDS[1];
  return MODEL_WORDS[2];
};

/* Что это за жилет — коротко, для второй строки: «Жилет фракций · 12 моделей». */
const aboutOf = (member) =>
  member.drawables.length > 1
    ? `${member.noun} · ${member.drawables.length} ${modelsWord(member.drawables.length)}`
    : member.noun;

/*
 * Картинка цвета жилета — вид в игре (задача 2 ТЗ 06.10.2026): картинка
 * вики GTA5RP первой модели жилета в этом цвете. Сквозной номер модели у
 * GTA5RP тот же, что в игре: штатный №1 (база), тактический (ограбления) —
 * №10, тяжёлый №1 — №15, жилет фракций 01.2016 №0 — №17 (сверено по
 * картинкам сервера 06.10.2026, №17 — и в игре 04.10.2026). У разгрузки
 * картинки на сервере нет — образец цвета.
 */
const ARMOR_PICTURES = "https://files.gta5rp.com/Clothes512/m_9_";
const ARMOR_GLOBAL = Object.freeze({ stock: 1, tactical: 10, heavy: 15, street: 17 });
const pictureOf = (member, letter) => {
  const index = Object.keys(member.colours).indexOf(letter);
  const global = ARMOR_GLOBAL[member.id];
  return global === undefined ? null : `${ARMOR_PICTURES}${global}_${index}.png`;
};

const item = (member, letter, extra) => ({
  key: `armor:${member.id}:${letter}`,
  member: member.id,
  cut: member.cut,
  letter,
  title: member.colours[letter].label,
  swatch: member.colours[letter].swatch,
  picture: pictureOf(member, letter),
  ...extra,
});

/**
 * Бронежилеты проекта группами «Стандартный / Государственные / Фракции».
 * У строки — цвет, чей он на проекте (`hint`) и что это за жилет (`about`).
 */
export function armorGroups(server) {
  const project = projectOf(server);
  const stock = armorMember("stock");
  const street = armorMember("street");
  const service = ["tactical", "heavy", "rig"].map(armorMember);
  return [
    {
      id: "standard",
      title: "Стандартный",
      note: "Обычный бронежилет из магазина — штатный жилет GTA Online, все девять моделей.",
      items: Object.keys(stock.colours).map((letter) =>
        item(stock, letter, { about: aboutOf(stock), hint: "" }),
      ),
    },
    {
      id: "government",
      title: "Государственные",
      note: project.government
        ? `Служебные бронежилеты: ${project.government}. Какой жилет у какой структуры, проект не сообщает — выбери по виду в игре.`
        : "Служебные бронежилеты гос. структур — тактические. Выбери по виду в игре.",
      items: service.flatMap((member) =>
        Object.keys(member.colours).map((letter) =>
          item(member, letter, { about: aboutOf(member), hint: "" }),
        ),
      ),
    },
    {
      id: "factions",
      title: "Фракции",
      note:
        project.others ||
        "Жилет фракций — у каждой фракции свой цвет. Чей какой, проект не сообщает.",
      items: Object.keys(street.colours).map((letter) =>
        item(street, letter, {
          about: aboutOf(street),
          hint: project.gangs[letter] || "",
        }),
      ),
    },
  ];
}

/** Строка бронежилета по ключу «armor:<жилет>:<буква>». */
export function armorItem(key, server) {
  for (const group of armorGroups(server))
    for (const entry of group.items) if (entry.key === key) return entry;
  return null;
}

/** Почему на этот бронежилет покраску не поставить; `""` — можно. */
export function armorRefusal(entry, source) {
  const member = armorMember(entry?.member);
  if (!member) return "Такого бронежилета в игре нет.";
  const own = armorMemberOf(source);
  if (!own)
    return "Цвет бронежилета меняет покраска самого бронежилета: выбери его в «Моделях» → «Из игры».";
  if (own.cut !== member.cut)
    return `Другой крой: чтобы поставить сюда, покрась ${CUT_NAMES[member.cut]}.`;
  return "";
}

/**
 * Цель установки: файл этого цвета у всех моделей семейства. Модель и
 * прочие цвета не трогаются (`drawables` + `letter` — форма «цвет вещи»).
 */
export function armorInstallTarget(entry) {
  const member = armorMember(entry.member);
  return {
    name: `${member.noun} — ${entry.title.toLowerCase()}${entry.hint ? ` (${entry.hint})` : ""}`,
    folder: member.folder,
    component: "task",
    drawables: [...member.drawables],
    letter: entry.letter,
    race: "uni",
  };
}
