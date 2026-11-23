/*
 * Тип вещи — что именно заменяет заменёнка (задача 4 ТЗ 05.10.2026:
 * «футболка — только на футболку, худи — на худи, пиджак — на пиджак»).
 *
 * Компонент педа у GTA один на весь верх (`jbib`), а вещи в нём разного
 * кроя: футболка, худи, пиджак, куртка. Сервер к каждой вещи подбирает свои
 * руки (`uppr`, у футболки — голые предплечья) и нижний слой (`accs`, под
 * распахнутым пиджаком — рубашка). Модель другого кроя на месте вещи
 * сервера ляжет на чужие руки и чужой нижний слой: рукава футболки под
 * пиджачными руками, куртка поверх голых плеч — те самые «баги». Поэтому
 * заменяется только вещь того же кроя, а крой узнаётся по названию: у
 * вещей игры — название магазина (рус. и англ.), у вещей серверов — их вики
 * и каталог, у модов каталога — название и хештеги.
 *
 * Совместимы вещи одной группы кроя: футболка, поло и джерси — короткий
 * рукав на голых руках; свитер, лонгслив и водолазка — длинный рукав без
 * распаха. Водолазка с футболкой — нет: у водолазки длинный рукав, сервер
 * под неё не даёт голых рук (проверено по крою: руки — отдельный компонент,
 * и у футболок и водолазок игры они разные).
 */

/** Типы по компонентам: `id`, подпись, группа кроя (совместимы внутри). */
export const GARMENT_KINDS = Object.freeze({
  jbib: Object.freeze([
    { id: "tshirt", label: "Футболка", group: "short" },
    { id: "polo", label: "Поло", group: "short" },
    { id: "tank", label: "Майка", group: "tank" },
    { id: "longsleeve", label: "Лонгслив", group: "long" },
    { id: "sweater", label: "Свитер или кофта", group: "long" },
    { id: "turtleneck", label: "Водолазка", group: "long" },
    { id: "shirt", label: "Рубашка", group: "shirt" },
    { id: "hoodie", label: "Худи", group: "hoodie" },
    { id: "olympic", label: "Олимпийка", group: "olympic" },
    { id: "jacket", label: "Пиджак", group: "jacket" },
    { id: "outerwear", label: "Куртка", group: "outerwear" },
    { id: "coat", label: "Пальто", group: "coat" },
    { id: "vest", label: "Жилет", group: "vest" },
    { id: "top", label: "Топ", group: "top" },
    { id: "dress", label: "Платье", group: "dress" },
  ]),
  lowr: Object.freeze([
    { id: "pants", label: "Брюки или джинсы", group: "pants" },
    { id: "shorts", label: "Шорты", group: "shorts" },
    { id: "skirt", label: "Юбка", group: "skirt" },
  ]),
  feet: Object.freeze([
    { id: "shoes", label: "Кроссовки или туфли", group: "shoes" },
    { id: "boots", label: "Ботинки или сапоги", group: "boots" },
    { id: "sandals", label: "Шлёпанцы или сандалии", group: "sandals" },
  ]),
});

/*
 * Слова по типам — по порядку: первое совпадение решает. Узкие раньше
 * широких: «куртка-олимпийка» — олимпийка, «смокинг» (jacket) — пиджак,
 * а не куртка; «рубашка-поло» — поло; «футболка с длинным рукавом» —
 * лонгслив.
 */
export const GARMENT_WORDS = Object.freeze({
  jbib: [
    ["dress", /плать|сарафан|комбинезон|\bdress\b|\bgown\b|romper|jumpsuit/],
    ["olympic", /олимпийк|track ?suit top|track ?jacket|tracksuit/],
    ["hoodie", /худи|толстовк|с капюшон|hoodie|hooded|\bhoody\b/],
    ["coat", /пальто|плащ|тренч|шуб[аы]|дублёнк|дубленк|халат|мантия|overcoat|trench|\bcoat\b|peacoat|duster|\brobe\b/],
    ["jacket", /пиджак|жакет|блейзер|смокинг|фрак|blazer|suit jacket|smoking jacket|tuxedo|sport ?coat|dinner jacket/],
    ["vest", /жилет|безрукавк|\bvest\b|waistcoat|gilet|biker cut|\bcut\b/],
    ["outerwear", /куртк|бомбер|ветровк|пуховик|парк[аи](?![а-я])|косух|анорак|джинсовк|кожанк|бушлат|jacket|bomber|parka|puffer|windbreaker|anorak|varsity|letterman|raincoat|chore|racer/],
    ["turtleneck", /водолазк|turtle ?neck|roll ?neck|polo ?neck/],
    ["longsleeve", /лонгслив|длинн\S* рукав|long ?sleeve/],
    /* У кириллицы нет \b в JS: границы слова — соседями-буквами. */
    ["polo", /(?<![а-я])поло(?![а-я])|polo/],
    ["shirt", /рубашк|сорочк|гавайк|пижам|воротник|\bshirt\b|button|flannel|blouse|блуз|pajama|collar|tucked short|service short/],
    ["sweater", /свитер|кофт|джемпер|свитшот|кардиган|пуловер|sweater|sweat ?shirt|cardigan|jumper|pullover|knit/],
    ["tank", /майк|без рукав|tank|sleeveless|singlet/],
    ["top", /(?<![а-я])топ(?![а-я])|кроп|бюстгальт|бюстье|\bbra\b|crop|bikini|\btop\b|corset|корсет|bustier/],
    ["tshirt", /футболк|\btee\b|t-?shirt|v-? ?neck|shortsleeve|short sleeve|jersey|джерси/],
  ],
  lowr: [
    ["shorts", /шорт|бермуд|бикини|shorts|bermuda|trunks|bikini/],
    ["skirt", /юбк|выше колен|skirt|\bmini\b|above knee/],
    ["pants", /брюк|джинс|штан|джоггер|треник|спортивк|трико|леггинс|легинс|лосин|комбинезон|карго|чинос|бриджи|кальсон|чулк|подвернут|широк|кротч|талией|pants|jeans|trousers|joggers|sweats|chinos|cargo|slacks|leggings|overalls|denims|long johns|stockings|turnups|wide|crotch|waisted|skinny/],
  ],
  feet: [
    ["sandals", /шлёп|шлеп|тапк|тапоч|сланц|сандал|вьетнамк|клоги|flip ?flop|slides|sandal|slipper|clogs/],
    ["boots", /ботин|сапог|берц|казак|челси|угг|boots?\b|chelsea|uggs?\b|ugglies|combat/],
    ["shoes", /кроссов|кед|туфл|мокасин|лофер|слипон|ботас|парусин|походн|подсветк|шнуров|sneaker|trainer|shoes?\b|loafer|kicks|runners?|heels|pumps|oxfords?|brogue|canvas|trail|light ups|lace-up/],
  ],
});

const byId = new Map(Object.values(GARMENT_KINDS).flat().map((kind) => [kind.id, kind]));

/** Типы компонента (или пустой список: у масок, сумок, шапок тип один). */
export const garmentKindsOf = (component) => GARMENT_KINDS[component] || [];

/** Подпись типа по `id` (или пусто). */
export const garmentKindLabel = (id) => byId.get(id)?.label || "";

/**
 * Тип вещи по названиям: `names` — все, что есть (рус., англ., из вики, из
 * каталога), `component` — компонент педа. `null` — у компонента типов нет
 * или ни одно название не говорит, что это.
 */
export function garmentKindOf({ component, names = [] } = {}) {
  const rules = GARMENT_WORDS[component];
  if (!rules) return null;
  const text = names
    .filter(Boolean)
    .map((name) => String(name).toLowerCase().replace(/ё/g, "е"))
    .join(" | ");
  if (!text.trim()) return null;
  for (const [kind, pattern] of rules) if (pattern.test(text)) return kind;
  return null;
}

/**
 * Можно ли вещь типа `source` ставить на вещь типа `target`: тот же крой
 * (группа). `null` у компонента без типов — да; неизвестный тип у одной из
 * сторон — «не проверить» (`unknown`), решает окно.
 * Ответ: `"yes" | "no" | "unknown"`.
 */
const EVERY_TOP = new Set(["turtleneck", "olympic"]);

export function garmentFit(component, source, target) {
  if (!GARMENT_KINDS[component]) return "yes";
  if (!source || !target) return "unknown";
  const a = byId.get(source);
  const b = byId.get(target);
  if (!a || !b) return "unknown";
  /* Водолазка и олимпийка — дефолтные вещи GTA5RP, на них ставят и футболку (владелец, 01.11.2026). */
  if (EVERY_TOP.has(b.id)) return "yes";
  return a.group === b.group ? "yes" : "no";
}

/** Почему нельзя — словами для строки списка. */
export function garmentRefusal(component, source, target) {
  if (garmentFit(component, source, target) !== "no") return "";
  return `${garmentKindLabel(target)} — другой крой: ${garmentKindLabel(source).toLowerCase()} на ней ляжет на чужие руки и нижний слой и будет «багаться».`;
}
