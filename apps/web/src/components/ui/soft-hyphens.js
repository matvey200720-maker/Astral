/*
 * Мягкие переносы для узких подписей (ТЗ 22.10.2026, п. C: подписи под значками
 * инструментов, «длинные — переносом, без обрезки посередине»).
 *
 * Колонка инструментов узкая, а слова бывают длиннее неё: «Прозрачность» (78 px
 * при кегле 11), украинское «промальовування» (99), немецкие составные
 * «Hintergrundbeleuchtung» (129). Кегль уменьшать нельзя — он стоит на шкале
 * токенов, и живая сверка (`__astralAudit`) ругается на любой другой, — а режущий
 * слово `overflow: hidden` называет то, чего не договаривает. Остаётся перенос
 * внутри слова, и пишет его само слово: мягкий дефис (U+00AD) видимым не бывает,
 * пока слово влезает в строку, а когда не влезает — браузер ломает его по
 * ближайшему такому месту и рисует дефис. Словаря переносов браузер не даёт
 * (в Chromium под Electron `hyphens: auto` не гарантирован), поэтому места
 * находим сами, по слогам.
 *
 * Правило слога — общее для пяти языков и нарочно простое: перенос стоит перед
 * согласной, которой слева предшествует гласная (прямо или через одну согласную), а
 * справа в пределах двух звуков есть гласная; в части не меньше трёх букв; сочетания,
 * что слогом не делятся (`sch`, `ch`, `ck`, `sz`, `cz`, `rz`, `zh`, `kh` …), — один звук,
 * мягкий и твёрдый знак с «й» слог не начинают.
 * Составное с дефисом уже ломается по дефису; места ищем внутри каждой части.
 */

export const SOFT_HYPHEN = "­";

/* Слово короче этого и так не бывает шире колонки. */
const MIN_WORD = 8;
/* Меньше трёх букв до или после переноса — «Ко-» и «-ть» читаются хуже целого слова. */
const MIN_PART = 3;

const VOWELS = new Set([..."aeiouyäöüáàâãåæéèêëíìîïóòôõøúùûąęаеёиоуыэюяіїєѣ"]);
/* Сочетания, которые слогом не делятся: перенос между этими парами букв запрещён. */
const INSEPARABLE = new Set(["ch", "sh", "ck", "ph", "th", "ng", "qu", "sz", "cz", "rz", "dz", "zh", "kh", "ts", "tz", "pf", "gh", "wh"]);
/* Знаки, с которых слог не начинается. */
const NEVER_START = new Set([..."ьъй"]);

const isLetter = (char) => /\p{L}/u.test(char);
const isVowel = (char) => VOWELS.has(char.toLowerCase());

/*
 * Слово — цепочка «звуков»: сочетание из `INSEPARABLE` — один звук, перенос
 * внутри него невозможен. Каждый звук помнит, с какой буквы начинается.
 */
function sounds(chars) {
  const result = [];
  for (let index = 0; index < chars.length; index += 1) {
    const pair = `${chars[index]}${chars[index + 1] || ""}`.toLowerCase();
    const triple = `${pair}${chars[index + 2] || ""}`.toLowerCase();
    const length = triple === "sch" ? 3 : INSEPARABLE.has(pair) ? 2 : 1;
    result.push({ at: index, text: chars.slice(index, index + length).join(""), vowel: length === 1 && isVowel(chars[index]), letter: isLetter(chars[index]) });
    index += length - 1;
  }
  return result;
}

/* Перенос ставится перед звуком: слева гласная (с согласными или без), справа согласная, за которой в пределах
   двух звуков — гласная. «Про-зрач-ность», «Hin-ter-grun-dbe-leuch-tung»: не всегда как в словаре, зато только
   по слогам, и пользуется им браузер лишь тогда, когда слово не влезает в строку. */
function breaksOf(word) {
  const chars = [...word];
  const units = sounds(chars);
  const points = [];
  let last = 0;
  for (let position = 1; position < units.length - 1; position += 1) {
    const here = units[position];
    if (here.at < MIN_PART || chars.length - here.at < MIN_PART || here.at - last < MIN_PART) continue;
    if (!here.letter || here.vowel || NEVER_START.has(here.text.toLowerCase())) continue;
    if (![units[position - 1], units[position + 1]].every((unit) => unit?.letter)) continue;
    /* гласная | согласная + гласная («Про-зрачность»), либо гласная + согласная | согласная + гласная
       («Конструк-ции»): среди согласных подряд перенос стоит после первой, а не перед скоплением. */
    const previous = units[position - 1];
    const open = previous.vowel && units[position + 1].vowel;
    const closed = !previous.vowel && units[position - 2]?.vowel && (units[position + 1].vowel || units[position + 2]?.vowel);
    if (!open && !closed) continue;
    points.push(here.at);
    last = here.at;
  }
  return points;
}

function hyphenatePart(part) {
  if ([...part].length < MIN_WORD || part.includes(SOFT_HYPHEN)) return part;
  const chars = [...part];
  return breaksOf(part)
    .reverse()
    .reduce((out, index) => [...out.slice(0, index), SOFT_HYPHEN, ...out.slice(index)], chars)
    .join("");
}

/** Слово с мягкими переносами. Составное через дефис — по частям. */
export function hyphenateWord(word) {
  if (/[\d/]/.test(word)) return word;
  return word.split("-").map(hyphenatePart).join("-");
}

/** Подпись целиком: слова через пробел, перенос расставлен у каждого длинного. */
export function softHyphens(text) {
  return String(text ?? "")
    .split(" ")
    .map(hyphenateWord)
    .join(" ");
}
