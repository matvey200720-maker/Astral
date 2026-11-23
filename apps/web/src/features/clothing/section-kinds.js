import { beardKindOf } from "@modovik/clothing/beard";
import { upprKindOf } from "@modovik/clothing/uppr-kind";
import { isGameBeardItem } from "./game-beard-items.js";

/*
 * Подвиды внутри раздела окна «На что поставить?» (Ц3 и Ц4, решение общей ведущей 16.11.2026; правка владельца 18.11.2026): владелец ищет «усы», «бороды», «ногти» и «перчатки» отдельно, а раздел «Маска» и раздел
 * «Руки и перчатки» сваливают их в одну кучу. 18.11 владелец убрал второй переключатель «Все | Перчатки» под рядом разделов: что показывать, решает чип раздела. Подвиды теперь — чипы того же ряда
 * («Маски | Бороды | Усы», «Перчатки | Ногти»), в начале ряда, свой подвид мода первым и выбранным; «Все» нет. Это не новые разделы, а фильтр списка этого раздела; ряд и выбор — `SectionChips`.
 *
 * Вещь без признака подвида не прячется: она стоит под СВОИМ подвидом мода (у ногтей — «Руки игры» без названия, у перчаток — «Черные с защитой»), а в чужом подвиде её нет. Подвид вещи берётся из того, что про неё известно:
 *   • «Маска» (`berd`) — по признаку бороды из данных разбора проектов и по названию (`beardKindOf`): `beard` — «Бороды», `moustache` — «Усы», остальное — «Маски». Штатные бороды игры
 *     (`game-beard-items.js`) стоят там же: по виду листа (`shape`) усы — «Усы», остальное — «Бороды»; на вкладке «GTA» моделей бород у игры нет, и под «Бородами» естественно встают они;
 *   • «Руки и перчатки» (`uppr`) — по данным базы серверов (`upprKindOf`: подвид карточек и наследование по стилю); у вещи без флага — только вещи авторов и вещи самой игры, у которых данных нет, —
 *     слова названия («ногти / nails», «перчатки / gloves»; общее «Руки и перчатки №…» не в счёт); остальное — под своим подвидом мода.
 * Чипы нужны, когда в списке есть вещи минимум двух подвидов и свой подвид среди них; иначе список показывается весь под одним чипом раздела (без чипов подвидов).
 */

/** Чипы по компоненту раздела: `[id подвида, русская подпись]`; перевод — словарь (`tr`). */
export const SECTION_KINDS = Object.freeze({
  berd: Object.freeze([
    ["mask", "Маски"],
    ["beard", "Бороды"],
    ["moustache", "Усы"],
  ]),
  uppr: Object.freeze([
    ["gloves", "Перчатки"],
    ["nails", "Ногти"],
  ]),
});

/* Слова. Начало целым словом: «Руки и перчатки» (общее название раздела) в счёт не идёт — его снимает `stripped`. */
const START = "(?:^|[^а-яёa-z])";
/* Русский корень — в любом месте слова («полуперчатки», «безногтевые»…): у вещи без данных лучше признать, чем спрятать; английский — целым словом. */
const NAILS = new RegExp(`ногт|${START}nails?(?![a-z])`, "i");
const GLOVES = new RegExp(`перчат|${START}gloves?(?![a-z])`, "i");
/* Общее название раздела в начале («Руки и перчатки №4.14 · …»): о подвиде вещи оно ничего не говорит. */
const stripped = (name) =>
  String(name || "").replace(/^\s*руки\s+и\s+перчатки(?![а-яёa-z])/i, "");

/* Слова названия — запасной признак: только у вещей авторов и вещей самой игры, у которых базы серверов не говорят ничего. */
const byWords = (item) => {
  const names = [item?.name, ...(item?.aliases || [])].map(stripped);
  if (names.some((name) => NAILS.test(name))) return "nails";
  return names.some((name) => GLOVES.test(name)) ? "gloves" : null;
};

/** Подвид вещи раздела `component` или `null` — о вещи нечего сказать (она видна только во «Всех»). */
export function sectionKindOf(component, item) {
  if (component === "berd") {
    /* Штатная борода игры: вид по самому листу (`shape`: moustache | beard | stubble | пусто). */
    if (isGameBeardItem(item))
      return item.shape === "moustache" ? "moustache" : "beard";
    const found = beardKindOf(item);
    return found === "beard"
      ? "beard"
      : found === "moustache"
        ? "moustache"
        : "mask";
  }
  if (component === "uppr") {
    const flagged = upprKindOf(item);
    if (flagged) return flagged;
    return !item?.server || item?.sources?.includes("author")
      ? byWords(item)
      : null;
  }
  return null;
}

/**
 * Все подвиды вещи: обычно один (`sectionKindOf`); штатная борода с СПОРНЫМ видом листа (`shapeDisputed`: числа на границе правила, форму глаз читает иначе) стоит и в «Бородах», и в «Усах» — не теряется ни там,
 * ни там (решение общей ведущей, 16.11.2026).
 */
export function sectionKindsOf(component, item) {
  const kind = sectionKindOf(component, item);
  if (component === "berd" && isGameBeardItem(item) && item.shapeDisputed)
    return ["beard", "moustache"];
  return kind ? [kind] : [];
}

/**
 * Подвиды вещи ДЛЯ ряда: как `sectionKindsOf`, а вещь без признака подвида встаёт под своим подвидом мода (`ownKind`, если он из подвидов раздела); нет и его — подвидов нет.
 */
export function rowKindsOf(component, item, ownKind) {
  const kinds = sectionKindsOf(component, item);
  if (kinds.length) return kinds;
  return ownKind && SECTION_KINDS[component]?.some(([id]) => id === ownKind)
    ? [ownKind]
    : [];
}

/**
 * Чипы подвидов раздела `component` для списка `items` (18.11.2026): `[{ id, label, count }]`, свой подвид (`ownKind`) первым, остальные по порядку раздела; «Все» нет. Подпись — русская, переводит тот, кто
 * рисует. Пусто — чипы не нужны: подвидов в списке меньше двух или своего среди них нет (список показывается весь под одним чипом раздела).
 */
export function kindChips(component, items, ownKind = null) {
  const kinds = SECTION_KINDS[component];
  if (!kinds || !items?.length || !ownKind) return [];
  const counts = new Map();
  for (const item of items) {
    for (const kind of rowKindsOf(component, item, ownKind))
      counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  if (counts.size < 2 || !counts.has(ownKind)) return [];
  const chips = kinds
    .filter(([id]) => counts.has(id))
    .map(([id, label]) => ({ id, label, count: counts.get(id) }));
  return [
    ...chips.filter((chip) => chip.id === ownKind),
    ...chips.filter((chip) => chip.id !== ownKind),
  ];
}

/** Вещи подвида `kind`; пусто и «all» — как есть. Вещь без признака — в своём подвиде мода (`ownKind`). */
export const filterByKind = (component, items, kind, ownKind = null) =>
  !kind || kind === "all"
    ? items
    : items.filter((item) =>
        rowKindsOf(component, item, ownKind).includes(kind),
      );

/**
 * С какого подвида открывается окно: со своего (`ownKind`), если чипы подвидов есть; иначе подвидов нет и список весь (`all`). `emptyOwn` — свой подвид (кроме «Масок») на этой вкладке пуст, а вещи
 * других подвидов есть: окно показывает весь раздел и говорит об этом строкой.
 */
export function openingKind(component, items, ownKind) {
  if (
    !ownKind ||
    ownKind === "all" ||
    !SECTION_KINDS[component] ||
    !items?.length
  )
    return { kind: "all", emptyOwn: false };
  if (kindChips(component, items, ownKind).length)
    return { kind: ownKind, emptyOwn: false };
  const own = items.some((item) =>
    rowKindsOf(component, item, ownKind).includes(ownKind),
  );
  return { kind: "all", emptyOwn: !own && ownKind !== "mask" };
}
