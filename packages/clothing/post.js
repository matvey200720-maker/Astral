// Из текста поста автора мода достаёт то, чего нет в файлах: название вещи, вид,
// пол, какие вещи серверов она заменяет, автора и героев сюжета.
import { categoryOfChannel, categoryOfHashtag, serverById, serverOfText, SERVERS } from "./taxonomy.js";

// ложное значение — пустая строка, остальное — строкой
const asText = (value) => (value ? String(value) : "");

/* ---------- чистка строки ---------- */

const INLINE_MARKUP = /\*\*|__|~~/g;
const LINE_MARKUP = /^\s*(?:#{1,3}|>)\s+/;
const PICTOGRAPHS = /[\p{Extended_Pictographic}️‍]/gu;
const QUOTES = /[«»"“”„']/g;

// Разметка Discord ищется в исходной строке, до удаления эмодзи и кавычек.
function scrub(value) {
  return asText(value)
    .replace(INLINE_MARKUP, " ")
    .replace(LINE_MARKUP, " ")
    .replace(PICTOGRAPHS, "")
    .replace(QUOTES, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- слова серверов ---------- */

// Слово сервера — между не-буквами и не-цифрами любого алфавита, как в `serverOfText`: с границей
// латинского слова русские имена («ГТА5РП») не вырезались. Длинные слова первыми: иначе из
// «Majestic RP» вырезалось только «Majestic», и «RP» оставалось в названии.
const wordSource = (words) =>
  [...words]
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/ /g, "\\s*"))
    .join("|");
const serverWords = (words, flags) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${wordSource(words)})(?![\\p{L}\\p{N}])`, flags);
const ALL_SERVER_WORDS = serverWords(SERVERS.flatMap((server) => server.words), "giu");
const SERVER_WORD_TESTS = SERVERS.map(({ id, words }) => ({ id, pattern: serverWords(words, "iu") }));

const stripServerWords = (text) => text.replace(ALL_SERVER_WORDS, " ");

// Сервера, названные строкой, если в ней больше ничего нет (кроме «и»/«and»); иначе null.
function onlyServers(text) {
  const named = SERVER_WORD_TESTS.filter(({ pattern }) => pattern.test(text)).map(({ id }) => id);
  if (named.length === 0) return null;
  const leftovers = stripServerWords(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return leftovers.every((word) => /^(?:и|and)$/i.test(word)) ? named : null;
}

/* ---------- заголовок замены ---------- */

// Заголовок — отдельным словом, и «на» после него тоже: внутри слов он резал названия
// («Replaced Hoodie» -> «d Hoodie», «Заменяет навесной шлем» -> «весной шлем»).
const REPLACE_HEAD = /(?<![\p{L}\p{N}])(?:замена|заменя(?:ется|ет|ть|ются|ют)(?:\s*собой)?|replaces?)(?:\s*на(?![\p{L}\p{N}]))?(?![\p{L}\p{N}])\s*[:：]?/iu;
const TAIL_REPLACE = new RegExp(`^(.*?\\S)\\s*[-–—,(|]\\s*${REPLACE_HEAD.source}(.*)$`, "iu");
const QUESTION_HEAD = /^(?:на что|что)\s+заменя\p{L}*\s*\??$/iu;
const SECTION_MARK = /^(?:вверх|верх|низ|top|bottom|[([].*[)\]])$/i;

// «Название, заменяет вещь»: замена в хвосте строки после тире, запятой, скобки или «|».
function tailReplace(line) {
  const hit = TAIL_REPLACE.exec(line);
  if (!hit) return null;
  const thing = hit[2].replace(/\)\s*$/, "").trim();
  return thing ? { before: hit[1], thing } : null;
}

/* ---------- одна цель замены ---------- */

const ALL_COLOURS = /\s*[([]?\s*(?:все|всех)\s+(?:цвета|цветов|цветах)\s*[)\]]?\s*/i;
// Любая цепочка скобочных групп через один «&», «,» или «+» склеивается в одну:
// «[A],[B]&[C]» -> «[A, B, C]»; содержимое группы может быть пустым и содержать скобки.
const SHOP_JOIN = /(?<=\[.*)\]\s*[&,+]\s*\[/g;
const TRAILING_SHOP = /[([]([^\])]+)[)\]]\s*$/;
const DASH_BREAK = /\s+[-–—]|[-–—]\s+/;

export function parseReplaceLine(value) {
  let line = scrub(value);
  if (!line) return null;
  line = line.replace(REPLACE_HEAD, " ");
  const server = serverOfText(line);
  const allColours = ALL_COLOURS.test(line);
  line = line.replace(ALL_COLOURS, " ").replace(SHOP_JOIN, ", ");

  let shop = null;
  const bracket = TRAILING_SHOP.exec(line);
  if (bracket) {
    const inner = scrub(bracket[1]);
    if (/\S/.test(stripServerWords(inner))) shop = inner;
    line = line.slice(0, bracket.index);
  }

  const parts = stripServerWords(line).split(DASH_BREAK).map(scrub).filter(Boolean);
  const name = scrub(parts[0]).replace(/[\s–—:-]+$/, "");
  if (shop === null && parts.length > 1) shop = parts.at(-1);
  if (name.length < 2) return null;
  if (shop && shop.toLowerCase() === name.toLowerCase()) shop = null;
  return { name, shop: shop || null, server, allColours };
}

/* ---------- все цели поста ---------- */

const BODY_ZONE = /^(?:тело|торс|грудь|спина|шея|голова|лицо|руки|ноги|(?:левая|правая)\s+(?:рука|нога))$/i;

export function isBodyZone(value) {
  return BODY_ZONE.test(asText(value).trim());
}

const SECTION_PREFIX = /^в разделе [\p{L}\s]+[-–—]\s+/iu;
const VARIANT_BREAK = /\s+[\\/]\s+/;

// Тату: если «название» — место на теле, то это магазин, а настоящее название — рисунок.
const swapBodyZone = (target) =>
  target.name && target.shop && isBodyZone(target.name)
    ? { ...target, name: target.shop, shop: target.name }
    : target;

// Строка вещи: «в разделе …» отбрасывается, «A / B» — несколько вариантов.
function thingsOf(text) {
  return text
    .replace(SECTION_PREFIX, "")
    .split(VARIANT_BREAK)
    .map((variant) => parseReplaceLine(variant))
    .filter(Boolean)
    .map(swapBodyZone);
}

// Перечень через «|» и запятую: фрагмент со строчной буквы продолжает прежнее имя.
function splitList(text) {
  const names = [];
  for (const piece of text.split(/\s*[|,]\s*/)) {
    const clean = scrub(piece);
    if (!clean) continue;
    if (names.length > 0 && /^\p{Ll}/u.test(clean)) names[names.length - 1] += `, ${clean}`;
    else names.push(clean);
  }
  return names;
}

const WEIGHT_LINE = /^(\d+(?:[.,]\d+)?)\s*кг\s*[:：]\s*(.*)$/i;
const SERVER_COLON = /^([^:：]{2,24})[:：]\s*(\S.*)$/;

class ReplaceReader {
  targets = [];
  listOpen = false;
  listServers = [];
  sawHeader = false;

  // «с серверами»: своя метка сервера сильнее; иначе по копии на каждый сервер списка
  add(target) {
    if (target.server || this.listServers.length === 0) {
      this.targets.push(target);
      return;
    }
    for (const server of this.listServers) this.targets.push({ ...target, server });
  }

  addThings(text) {
    for (const target of thingsOf(text)) this.add(target);
  }
}

// Правила разбора строки: первое сработавшее (вернувшее true) решает.
const LINE_RULES = [
  (reader, line) => {
    if (line) return false;
    reader.listOpen = false;
    reader.listServers = [];
    return true;
  },
  (reader, line) => {
    if (!/^https?:\/\//i.test(line) && !line.startsWith("#")) return false;
    reader.listOpen = false;
    return true;
  },
  (reader, line) => {
    if (!QUESTION_HEAD.test(line)) return false;
    reader.listOpen = true;
    reader.sawHeader = true;
    return true;
  },
  (reader, line) => {
    const head = REPLACE_HEAD.exec(line);
    if (!head || head.index > 4) return false;
    const rest = line.slice(head.index + head[0].length).trim();
    reader.sawHeader = true;
    reader.listServers = [];
    const named = onlyServers(rest);
    if (named) {
      reader.listServers = named;
      reader.listOpen = true;
    } else if (!rest || SECTION_MARK.test(rest)) {
      reader.listOpen = true;
    } else {
      reader.listOpen = false;
      reader.addThings(rest);
    }
    return true;
  },
  (reader, line) => {
    const named = reader.sawHeader && onlyServers(line);
    if (!named) return false;
    reader.listServers = named;
    reader.listOpen = true;
    return true;
  },
  (reader, line) => {
    const tail = tailReplace(line);
    if (!tail) return false;
    reader.listOpen = false;
    reader.addThings(tail.thing);
    return true;
  },
  (reader, line) => {
    const weight = reader.listOpen && WEIGHT_LINE.exec(line);
    if (!weight) return false;
    const shop = `${weight[1].replace(",", ".")} кг`;
    for (const name of splitList(weight[2])) reader.add({ name, shop, server: null, allColours: false });
    return true;
  },
  (reader, line) => {
    const lead = SERVER_COLON.exec(line);
    const server = lead && serverOfText(lead[1]);
    const things = server ? thingsOf(lead[2]) : [];
    if (things.length === 0) return false;
    for (const thing of things) reader.targets.push({ ...thing, server });
    return true;
  },
  (reader, line) => {
    if (!reader.listOpen || reader.listServers.length === 0 || !line.includes("|")) return false;
    for (const name of splitList(line)) reader.add({ name, shop: null, server: null, allColours: false });
    return true;
  },
  (reader, line) => {
    if (!reader.listOpen) return false;
    reader.addThings(line.replace(/^на\s+/i, ""));
    return true;
  },
];

function toRows(lines) {
  if (Array.isArray(lines)) return lines;
  return lines ? String(lines).split(/\r?\n/) : [];
}

export function parseReplaces(lines) {
  const reader = new ReplaceReader();
  for (const row of toRows(lines)) {
    const line = scrub(row);
    LINE_RULES.some((rule) => rule(reader, line));
  }
  const seen = new Set();
  return reader.targets.filter((target) => {
    const key = JSON.stringify([target.server, target.name.toLowerCase(), (target.shop ?? "").toLowerCase()]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---------- прописные буквы и предложения ---------- */

const isLowerLetter = (char) => char === char.toLowerCase() && char !== char.toUpperCase();

// «ACNE STUDIOS» -> «Acne Studios»; короткие слова, слова с цифрами и кириллица не трогаются.
export function calmCaps(value) {
  const text = asText(value);
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 5 || letters.some(isLowerLetter) || /\p{Script=Cyrillic}/u.test(text)) return text;
  return text.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const chars = [...word];
    if (chars.length <= 3 || /[0-9]/.test(word)) return word;
    return chars[0] + chars.slice(1).join("").toLowerCase();
  });
}

export function isSentence(text) {
  const plain = asText(text).trim();
  const words = plain.split(/\s+/).filter(Boolean);
  return words.length > 14 || (words.length >= 6 && /[.!?]\s+\p{L}/u.test(plain));
}

/* ---------- герои сюжета ---------- */

const HEROES = new Map([
  ["player_zero", "Майкл"],
  ["player_one", "Франклин"],
  ["player_two", "Тревор"],
]);
const HERO_TOKEN = /(?<![A-Za-z0-9])(player_zero|player_one|player_two)(?![A-Za-z0-9])/gi;

export function storyHeroesOf(text) {
  const names = [];
  for (const [, token] of asText(text).matchAll(HERO_TOKEN)) {
    const name = HEROES.get(token.toLowerCase());
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/* ---------- автор ---------- */

const AUTHOR_KEYS = ["maker", "author", "made by", "created by", "автор", "сделал", "мейкер"];
const SIGNATURE = new RegExp(`^\\s*(?:${AUTHOR_KEYS.join("|")})\\s*[:：-]\\s*(.+)$`, "im");
const BY_LINE = /^\s*by\s+([\p{L}\p{N}_. -]{2,40})\s*$/iu;
const BY_AT_END = /\s(?:by|от)\s+([\p{L}\p{N}_. -]{2,40})\s*$/u;

// Три прохода по всем текстам: подпись «автор: …», строка «by имя», хвост первой строки.
export function authorFrom(...texts) {
  const sources = texts.map(asText);
  const linesOf = (text) => text.split(/\r?\n/);

  for (const text of sources) {
    const signed = SIGNATURE.exec(text);
    if (signed) return scrub(signed[1]).replace(/\s*discord:.*$/i, "").slice(0, 80);
  }
  for (const text of sources) {
    for (const line of linesOf(text)) {
      const credit = BY_LINE.exec(line);
      if (credit) return scrub(credit[1]);
    }
  }
  for (const text of sources) {
    const tail = BY_AT_END.exec(scrub(linesOf(text)[0]));
    if (tail) return tail[1];
  }
  return null;
}

/* ---------- пост целиком ---------- */

const URL_PART = /https?:\/\/\S+/gi;
const BRACKETED = /\[[^\]]*\]/g;
const TWO_ALNUM = /[\p{L}\p{N}]{2}/u;
const REVIEW_MARK = /reviews|отзыв/i;
const TEXT_HASHTAG = /(?:^|\s)#([\p{L}\p{N}_-]{2,40})/gu;
const TATTOO_WORD = /(?<!\p{L})(?:tattoos?|тату|татуировк\p{L}*)(?![\p{L}-])/u;
const FEMALE_MARK = /женск|женщ|females?(?![a-z0-9_])|#fem/;
const MALE_MARK = /мужск|(?<!\p{L})males?(?![a-z0-9_])/u;
const BY_TAIL = /\s+by\s+[\p{L}\p{N}_. -]{2,40}$/iu;

// Ярлыки ссылок и установки не бывают названием вещи.
const SHORTCUTS = [
  "скачать", "скачивание", "загрузить", "download", "dl", "ссылка", "link",
  "путь установки", "установка", "install", "installation", "path",
];
const SHORTCUT = new RegExp(`^(?:${SHORTCUTS.join("|")})(?![\\p{L}\\p{N}])`, "iu");

const startsWithShortcut = (text) => SHORTCUT.test(text.replace(URL_PART, " ").trim());

// Первая строка, похожая на название; у строки с хвостовой заменой названием служит часть до неё.
function titleCandidate(lines) {
  for (const raw of lines) {
    const line = scrub(raw);
    if (!line || !TWO_ALNUM.test(line) || startsWithShortcut(line)) continue;
    const headed = REPLACE_HEAD.test(line);
    const tail = headed ? tailReplace(line) : null;
    if (headed && !tail) continue;
    if (/^(?:https?:|#)/i.test(line) || line.includes("|") || REVIEW_MARK.test(line)) continue;
    return tail ? tail.before : line;
  }
  return null;
}

function tidyTitle(source) {
  const plain = source
    .replace(BY_TAIL, "")
    .replace(URL_PART, " ")
    .replace(BRACKETED, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = calmCaps(plain);
  return !title || isSentence(title) ? null : title;
}

function titleOf(post, lines) {
  const given = post?.title;
  if (given && !startsWithShortcut(given)) return tidyTitle(given);
  const candidate = titleCandidate(lines);
  return candidate === null ? null : tidyTitle(candidate);
}

const SERVER_SCAN = SERVERS.map(({ id, words }) => ({
  id,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${wordSource(words)})(?![\\p{L}\\p{N}])`, "u"),
}));

function serversOf(post, flat) {
  const given = post?.servers;
  if (Array.isArray(given)) return [...new Set(given)].filter((id) => serverById(id) !== null);
  return SERVER_SCAN.filter(({ pattern }) => pattern.test(flat)).map(({ id }) => id);
}

function categoryOf(post, hashtags, flat) {
  for (const tag of hashtags) {
    const found = categoryOfHashtag(tag);
    if (found) return found.id;
  }
  if (TATTOO_WORD.test(flat)) return "tattoos";
  return (typeof post === "string" ? null : categoryOfChannel(post?.channel))?.id ?? null;
}

function genderOf(flat) {
  const female = FEMALE_MARK.test(flat);
  const male = MALE_MARK.test(flat);
  if (female === male) return null;
  return female ? "female" : "male";
}

export function clothingFromPost(post) {
  const isText = typeof post === "string";
  // любое ложное lines — «строк нет»; истинное без join (число, объект) — TypeError платформы
  const lines = isText ? post.split(/\r?\n/) : (post?.lines || []);
  const hashtags = isText
    ? [...post.matchAll(TEXT_HASHTAG)].map((hit) => hit[1].toLowerCase())
    : (post?.hashtags ?? []);
  const flat = lines.join(" ").toLowerCase();

  return {
    title: titleOf(post, lines),
    category: categoryOf(post, hashtags, flat),
    gender: genderOf(flat),
    replaces: parseReplaces(lines),
    servers: serversOf(post, flat),
    storyHeroes: storyHeroesOf(lines.join("\n")),
  };
}
