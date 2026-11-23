/*
 * Разметка выделения: классы и роды (ТЗ владельца 26.10.2026, раздел D: «резать на классы: стены одной закрытой комнаты — один класс, другой — другой;
 * планшеты, экраны, баннеры, картины и всё, что хранит контент, — поодиночке, только один; выделить все планшеты — отдельной кнопкой»).
 *
 * Три типа элемента разметки:
 *   surface — конструкция (стены, пол, потолок, колонны): один класс = материал × закрытая комната; щелчок берёт весь класс;
 *   content — носитель контента (планшет, экран, монитор, ТВ, баннер, плакат, картина, вывеска, флаг): всегда одна вещь;
 *   prop    — мебель и вещи (стул, кресло, кубок, аирдроп, стол…): всегда одна вещь.
 * Род (`kind`) нужен кнопке «Выбрать все такие»: у всех элементов рода она берёт сразу всё множество, а не по щелчку.
 *
 * Чистый модуль без DOM и Node: его читают генератор разметки, окно и тесты.
 */

export const SELECTION_TYPES = Object.freeze(["surface", "content", "prop"]);

/** Роды по типам: `[id, подпись одним словом]` — подписи это ключи словаря (переводит место отрисовки). */
export const SELECTION_KINDS = Object.freeze({
  surface: Object.freeze([
    ["wall", "Стены"],
    ["floor", "Пол"],
    ["ceiling", "Потолок"],
    ["column", "Колонны"],
    ["surface", "Поверхность"],
  ]),
  content: Object.freeze([
    ["planshet", "Планшеты"],
    ["monitor", "Мониторы"],
    ["screen", "Экраны"],
    ["tv", "Телевизоры"],
    ["banner", "Баннеры"],
    ["poster", "Плакаты"],
    ["painting", "Картины"],
    ["sign", "Вывески"],
    ["flag", "Флаги"],
  ]),
  prop: Object.freeze([
    ["chair", "Стулья"],
    ["seat", "Кресла и диваны"],
    ["table", "Столы"],
    ["trophy", "Кубки"],
    ["airdrop", "Аирдропы"],
    ["cube", "Cube World"],
    ["rail", "Перила и ограждения"],
    ["kiosk", "Киоски"],
    ["plant", "Растения"],
    ["light", "Светильники"],
    ["door", "Двери"],
    ["food", "Еда и напитки"],
    ["tech", "Техника и автоматы"],
    ["decor", "Прочее"],
  ]),
});

const ALL = new Map();
for (const [type, kinds] of Object.entries(SELECTION_KINDS)) for (const [id, label] of kinds) ALL.set(id, { type, label });

/** Известный ли род и какого он типа (`surface`, `content`, `prop`) или `null`. */
export const selectionKindType = (kind) => ALL.get(kind)?.type || null;
export const selectionKindLabel = (kind) => ALL.get(kind)?.label || "Прочее";

/*
 * Род вещи по имени модели: первое совпавшее правило. Содержимое-носители — раньше мебели («монитор» раньше «стола», «картина» раньше «рамы»).
 * Имена — игровые, строчными (`mj_ma_int3_rm1_longscreen_a`, `prop_cs_tablet`, `vw_prop_casino_blckjack_01`).
 */
const CONTENT_RULES = Object.freeze([
  ["planshet", /tablet|planshet|screen_touch|ipad/],
  ["monitor", /gamingmonitor|monitor|dubg_maptable|flatscreen|desktop_screen|pc_screen/],
  ["tv", /(^|_)tv(_|\d|$)|tvscreen|television|screen_(tnt|rnx)/],
  ["screen", /longscreen|circle_screen|fake_screen|(^|_)screen(_|\d|$)|_screen$|scoreboard|display/],
  ["painting", /painting|paint(_|$)|(^|_)pics?(_|$)|picture|photo|frame_art|artwork/],
  ["flag", /(^|_)flags?(_|\d|$)/],
  ["banner", /banner|billboard|streamer/],
  ["poster", /poster|placard|leaflet/],
  ["sign", /(^|_)sign(_|\d|$)|signage|logo|racing_sign|restroomsign|fameorshame|fos_star|table_sign|(^|_)text(_|\d|$)|neon/],
]);
const PROP_RULES = Object.freeze([
  /* Киоск зала GTA 5 RP назван по вывеске-меню на нём (`xj_pos_smallscreen`): это киоск, а не экран. */
  ["kiosk", /pos_smallscreen|kiosk/],
  ["airdrop", /airdrop/],
  ["cube", /(^|_)mn_|cbwrld|brstand/],
  ["trophy", /trophy|(^|_)cup(_|$)|cup_stand|racer_cup|helmet/],
  ["rail", /barrier|rope|(^|_)rails?(_|\d|$)|railing|fence|bollard|handrail/],
  ["chair", /chair|stool|bench/],
  ["tech", /laptop|keyboard|mouse|pctower|arcade|phone|djset|projector|speaker|liftbutton|atm_|vend_|mic_|cashpoint|slot|machine|luckywheel/],
  ["seat", /seat|sofa|couch|armchair|cushion|pouf|podushka/],
  ["table", /(^|_)tab(_|le)|table|desk|(^|_)stand$|counter|(^|_)bar(_|\d|$)|crate|fire_hosebox/],
  ["plant", /plant|palm|planter|vase|flowers|hedge|(^|_)trees?(_|\d|$)/],
  ["light", /lamp|light|lght|chandelier|chan_|bakelight|torch|candles/],
  ["door", /door|enterdec|doorcover|doordecor/],
  ["food", /food|_can(_|$)|ecola|bottle|bag|coffee|juice|napkin|pot_fry|beer|handbag|carrier|champ|glass_stack|cup_/],
]);

/*
 * Группы родов — «как человек называет вещи зала»: одни и те же имена у панели «Предметы» (`arena-item-categories.js`, `ARENA_ITEM_CATEGORIES`)
 * и у разметки. Группа — один или несколько родов (монитор и планшет — «Мониторы», экран и телевизор — «Экраны»); конструкция — группа «shell».
 */
export const SELECTION_GROUPS = Object.freeze({
  monitors: Object.freeze(["planshet", "monitor"]),
  screens: Object.freeze(["screen", "tv"]),
  seats: Object.freeze(["seat"]),
  chairs: Object.freeze(["chair"]),
  trophies: Object.freeze(["trophy"]),
  airdrops: Object.freeze(["airdrop"]),
  cube: Object.freeze(["cube"]),
  posters: Object.freeze(["banner", "poster", "painting", "sign", "flag"]),
  rails: Object.freeze(["rail"]),
  kiosks: Object.freeze(["kiosk"]),
  tables: Object.freeze(["table"]),
  tech: Object.freeze(["tech"]),
  light: Object.freeze(["light"]),
  plants: Object.freeze(["plant"]),
  doors: Object.freeze(["door"]),
  food: Object.freeze(["food"]),
  shell: Object.freeze(["wall", "floor", "ceiling", "column", "surface"]),
  decor: Object.freeze(["decor"]),
});

const GROUP_OF_KIND = new Map(Object.entries(SELECTION_GROUPS).flatMap(([group, kinds]) => kinds.map((kind) => [kind, group])));

/** Группа рода (`monitors`, `posters`, `shell`…) или `decor` для неизвестного. */
export const selectionGroupOfKind = (kind) => GROUP_OF_KIND.get(kind) || "decor";

/** `{ type, kind }` вещи по имени модели: носитель контента, иначе мебель; незнакомая — `prop`/`decor`. */
export function selectionKindOfModel(name) {
  const text = String(name || "").toLowerCase();
  for (const [kind, rule] of CONTENT_RULES) if (rule.test(text)) return { type: "content", kind };
  for (const [kind, rule] of PROP_RULES) if (rule.test(text)) return { type: "prop", kind };
  return { type: "prop", kind: "decor" };
}

/** Род поверхности по группе (`floor`, `walls`, `ceiling`) и имени материала. */
export function selectionKindOfSurface(group, sheet = "") {
  const text = `${group || ""} ${sheet || ""}`.toLowerCase();
  if (/floor|carpet|tile_floor/.test(String(group || "").toLowerCase())) return "floor";
  if (/ceiling|roof|celling/.test(String(group || "").toLowerCase())) return "ceiling";
  if (/wall/.test(String(group || "").toLowerCase())) return "wall";
  if (/column|pillar/.test(text)) return "column";
  if (/carpet|floor/.test(text)) return "floor";
  if (/ceiling|roof|celling/.test(text)) return "ceiling";
  if (/wall/.test(text)) return "wall";
  return "surface";
}
