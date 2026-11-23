// Единый словарь одежды: компоненты педа, категории витрины, серверы, модели
// персонажа и функции поиска по ним.

// имя, номер слота, проп ли, подпись
const COMPONENT_ROWS = [
  ["head", 0, false, "Голова"],
  ["berd", 1, false, "Маска"],
  ["hair", 2, false, "Причёска"],
  ["uppr", 3, false, "Руки и перчатки"],
  ["lowr", 4, false, "Низ"],
  ["hand", 5, false, "Сумка или рюкзак"],
  ["feet", 6, false, "Обувь"],
  ["teef", 7, false, "Аксессуар на шею"],
  ["accs", 8, false, "Нижний слой"],
  ["task", 9, false, "Бронежилет"],
  ["decl", 10, false, "Нашивка"],
  ["jbib", 11, false, "Верх"],
  ["p_head", 0, true, "Головной убор"],
  ["p_eyes", 1, true, "Очки"],
  ["p_ears", 2, true, "Уши"],
  ["p_mouth", 3, true, "Рот"],
  ["p_lhand", 4, true, "Левая рука"],
  ["p_rhand", 5, true, "Правая рука"],
  ["p_lwrist", 6, true, "Часы"],
  ["p_rwrist", 7, true, "Браслет"],
  ["p_hip", 8, true, "Пояс"],
  ["p_lfoot", 9, true, "Левая нога"],
  ["p_rfoot", 10, true, "Правая нога"],
];

// id, подпись, компоненты, хештеги (без решётки, строчными)
const CATEGORY_ROWS = [
  ["tshirts", "Верх", ["jbib", "accs"], ["вверх", "верх", "футболка", "худи", "куртка", "кофта"]],
  ["pants", "Низ", ["lowr"], ["низ", "штаны", "джинсы", "шорты"]],
  ["shoes", "Обувь", ["feet"], ["обувь", "кроссовки", "кроссы", "ботинки"]],
  ["masks", "Маски", ["berd"], ["маска", "маски"]],
  ["hats", "Головные уборы", ["p_head"], ["шапка", "кепка", "головнойубор", "шляпа", "рожки"]],
  ["glasses", "Очки", ["p_eyes"], ["очки"]],
  ["ears", "Уши", ["p_ears"], ["уши", "наушники", "серьги"]],
  ["watches", "Часы", ["p_lwrist"], ["часы"]],
  ["bracelets", "Браслеты", ["p_rwrist"], ["браслет", "браслеты"]],
  [
    "accessories",
    "Аксессуары",
    ["teef", "p_mouth", "p_hip", "p_lhand", "p_rhand", "p_lfoot", "p_rfoot"],
    ["аксессуар", "аксессуары", "цепь", "галстук"],
  ],
  ["tattoos", "Татуировки", [], ["тату", "татуировка", "татуировки", "tattoo", "tattoos"]],
  ["bags", "Рюкзаки и сумки", ["hand"], ["рюкзак", "сумка", "рюкзаки"]],
  ["armor", "Броня", ["task"], ["броня", "бронежилет", "броник"]],
  ["gloves", "Руки и перчатки", ["uppr"], ["перчатки", "руки"]],
  ["hair", "Причёски", ["hair"], ["причёска", "прическа", "волосы"]],
  ["decals", "Нашивки", ["decl"], ["нашивка", "нашивки", "допы"]],
  ["government-clothing", "Госодежда", [], ["госка", "госодежда", "форма", "гос"]],
];

// В словах пробел значит «любое число пробельных, в том числе ни одного».
const SERVER_ROWS = [
  ["gta5rp", "GTA5RP", ["gta5rp", "gta 5 rp", "gta5 rp", "гта5рп", "гта 5 рп", "5rp", "5рп"]],
  ["majestic", "Majestic", ["majestic", "majesticrp", "majestic rp", "маджестик", "мажестик", "mj"]],
  ["rmrp", "RMRP", ["rmrp", "рмрп", "radmir"]],
];

// каналы Discord (латиницей, строчными) по категориям; опечатки в именах настоящие
const CHANNELS_BY_CATEGORY = {
  tattoos: ["body", "tattoo", "tattoos"],
  hats: ["headdress", "headderss", "hats"],
  tshirts: ["outewear", "outerwear"],
  masks: ["mask", "masks"],
  accessories: ["accessories"],
  gloves: ["gloves"],
  shoes: ["sneakers", "shoes"],
  pants: ["pants"],
  bags: ["backpacks", "bags"],
  armor: ["armour", "armor"],
};

// малые прописные (капитель), которыми авторы пишут «ʙᴏᴅʏ»; буквы x в таблице нет
const SMALL_CAPITALS = new Map([
  ["\u1D00", "a"],
  ["\u0299", "b"],
  ["\u1D04", "c"],
  ["\u1D05", "d"],
  ["\u1D07", "e"],
  ["\uA730", "f"],
  ["\u0262", "g"],
  ["\u029C", "h"],
  ["\u026A", "i"],
  ["\u1D0A", "j"],
  ["\u1D0B", "k"],
  ["\u029F", "l"],
  ["\u1D0D", "m"],
  ["\u0274", "n"],
  ["\u1D0F", "o"],
  ["\u1D18", "p"],
  ["\u01EB", "q"],
  ["\u0280", "r"],
  ["\uA731", "s"],
  ["\u1D1B", "t"],
  ["\u1D1C", "u"],
  ["\u1D20", "v"],
  ["\u1D21", "w"],
  ["\u028F", "y"],
  ["\u1D22", "z"],
]);

// Верхний уровень заморожен, записи внутри — нет.
export const COMPONENTS = Object.freeze(
  Object.fromEntries(COMPONENT_ROWS.map(([name, index, prop, label]) => [name, { index, prop, label }])),
);
export const COMPONENT_NAMES = Object.freeze(Object.keys(COMPONENTS));
export const CATEGORIES = Object.freeze(
  CATEGORY_ROWS.map(([id, label, components, hashtags]) => ({ id, label, components, hashtags })),
);
export const SERVERS = Object.freeze(SERVER_ROWS.map(([id, label, words]) => ({ id, label, words })));
export const PEDS = Object.freeze({ male: "mp_m_freemode_01", female: "mp_f_freemode_01" });
export const GENDER_LABELS = Object.freeze({ male: "Мужское", female: "Женское" });

// ложное значение — пустая строка, остальное — строкой
const asText = (value) => (value ? String(value) : "");

// Полки мастерской для украшений. Это обычный объект, и так задумано: имена из
// прототипа («toString») находят унаследованные свойства, как в старом коде.
const SHELVES = { glasses: "accessories", ears: "accessories", watches: "accessories", bracelets: "accessories" };

const CHANNEL_CATEGORIES = new Map(
  Object.entries(CHANNELS_BY_CATEGORY).flatMap(([id, names]) => {
    const category = CATEGORIES.find((item) => item.id === id);
    return names.map((name) => [name, category]);
  }),
);

const escapeWord = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");

const SERVER_MATCHERS = SERVERS.map(({ id, words }) => ({
  id,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeWord).join("|")})(?![\\p{L}\\p{N}])`, "u"),
}));

export function categoryById(id) {
  const wanted = asText(id);
  return CATEGORIES.find((category) => category.id === wanted) ?? null;
}

export function serverById(id) {
  return SERVERS.find((server) => server.id === id) ?? null;
}

export function shelfOfCategory(id) {
  return SHELVES[id] ?? id;
}

export function categoryOfComponent(component) {
  const name = asText(component);
  return CATEGORIES.find((category) => category.components.includes(name)) ?? null;
}

function channelKey(name) {
  let key = "";
  for (const symbol of asText(name).normalize("NFKC")) key += SMALL_CAPITALS.get(symbol) ?? symbol;
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

export function categoryOfChannel(name) {
  return CHANNEL_CATEGORIES.get(channelKey(name)) ?? null;
}

export function categoryOfHashtag(tag) {
  const bare = asText(tag).toLowerCase().replace(/^#/, "");
  return CATEGORIES.find((category) => category.hashtags.includes(bare)) ?? null;
}

export function serverOfText(value) {
  const lower = asText(value).toLowerCase();
  return SERVER_MATCHERS.find(({ pattern }) => pattern.test(lower))?.id ?? null;
}
