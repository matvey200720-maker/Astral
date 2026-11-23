import { tr } from "../../../../locales/ui.js";

// Подписи студии звука: слово после числа в нужной форме, число по правилам языка,
// перевод названий и отказов. Язык берётся у словаря при каждом вызове: tr("ru")
// отдаёт код языка окна, а пока перевод не подгружен, всё остаётся русским.

const CODES = ["ru", "uk", "en", "de", "pl", "fr"];
const LOCALE_TAGS = ["ru-RU", "uk-UA", "en-US", "de-DE", "pl-PL", "fr-FR"];

// Вид слова и его формы по колонкам CODES: три формы (один, несколько, много)
// или две (один, много). Для вида, которого здесь нет, подбор слова бросает TypeError.
const WORD_ROWS = [
  [
    "track",
    ["дорожка", "дорожки", "дорожек"],
    ["доріжка", "доріжки", "доріжок"],
    ["track", "tracks"],
    ["Spur", "Spuren"],
    ["ścieżka", "ścieżki", "ścieżek"],
    ["piste", "pistes"],
  ],
  [
    "bank",
    ["банк", "банка", "банков"],
    ["банк", "банки", "банків"],
    ["bank", "banks"],
    ["Bank", "Bänke"],
    ["bank", "banki", "banków"],
    ["banque", "banques"],
  ],
  [
    "file",
    ["файл", "файла", "файлов"],
    ["файл", "файли", "файлів"],
    ["file", "files"],
    ["Datei", "Dateien"],
    ["plik", "pliki", "plików"],
    ["fichier", "fichiers"],
  ],
  [
    "variant",
    ["вариант", "варианта", "вариантов"],
    ["варіант", "варіанти", "варіантів"],
    ["variant", "variants"],
    ["Variante", "Varianten"],
    ["wariant", "warianty", "wariantów"],
    ["variante", "variantes"],
  ],
  [
    "weapon",
    ["ствол", "ствола", "стволов"],
    ["ствол", "стволи", "стволів"],
    ["weapon", "weapons"],
    ["Waffe", "Waffen"],
    ["broń", "bronie", "broni"],
    ["arme", "armes"],
  ],
  [
    "replacement",
    ["замена", "замены", "замен"],
    ["заміна", "заміни", "замін"],
    ["replacement", "replacements"],
    ["Ersetzung", "Ersetzungen"],
    ["zamiana", "zamiany", "zamian"],
    ["remplacement", "remplacements"],
  ],
  [
    "channel",
    ["канал", "канала", "каналов"],
    ["канал", "канали", "каналів"],
    ["channel", "channels"],
    ["Kanal", "Kanäle"],
    ["kanał", "kanały", "kanałów"],
    ["canal", "canaux"],
  ],
  [
    "variantAll",
    ["вариант", "варианта", "вариантов"],
    ["варіант", "варіанти", "варіантів"],
    ["variant", "variants"],
    ["Variante", "Varianten"],
    ["wariant", "warianty", "wariantów"],
    ["variante", "variantes"],
  ],
  [
    "variantOf",
    ["варианта", "вариантов", "вариантов"],
    ["варіанта", "варіантів", "варіантів"],
    ["variant", "variants"],
    ["Variante", "Varianten"],
    ["wariantu", "wariantów", "wariantów"],
    ["variante", "variantes"],
  ],
];

// Категория правила множественного числа -> номер формы; остальное берёт последнюю.
const CATEGORY_SLOT = { one: 0, few: 1 };

const CODEC_HEAD = "Кодек ";
const CODEC_TAIL = ": импорт таких дорожек ещё не обкатан.";

const DIGITS_ONLY = /^[0-9]+$/;
const SINGLE_LINE = /^.*$/;
const NON_EMPTY_LINE = /^.+$/;
const ENDS_WITH_SPACE = /\s$/;

// Объекты Intl дороже самих вызовов: по одному на язык, создаются при первом обращении.
const intlMemo = {};

function localeOf(lang) {
  return LOCALE_TAGS[CODES.indexOf(lang)];
}

function pluralRulesFor(lang) {
  const id = `rules:${lang}`;
  if (!intlMemo[id]) intlMemo[id] = new Intl.PluralRules(localeOf(lang));
  return intlMemo[id];
}

function numberFormatFor(lang) {
  const id = `digits:${lang}`;
  if (!intlMemo[id]) intlMemo[id] = new Intl.NumberFormat(localeOf(lang));
  return intlMemo[id];
}

// Число из любого значения; ложное (0, -0, NaN) становится 0.
function toCount(value) {
  return Number(value) || 0;
}

// Буквальная подстановка метки: знаки "$" в значении не действуют.
function fill(template, label, value) {
  return template.replace(label, () => value);
}

function wordIn(lang, count, kind) {
  const row = WORD_ROWS.find((entry) => entry[0] === kind);
  // Вида нет в таблице: row пуст, и чтение формы бросает TypeError платформы.
  const forms = row[1 + CODES.indexOf(lang)];
  const slot = CATEGORY_SLOT[pluralRulesFor(lang).select(Math.abs(count))] ?? 2;
  return forms[Math.min(slot, forms.length - 1)];
}

// Делит "слово 12" по последнему пробелу, если дальше только цифры 0-9.
function splitNumbered(text) {
  const cut = text.lastIndexOf(" ");
  if (cut < 0) return null;
  const digits = text.slice(cut + 1);
  return DIGITS_ONLY.test(digits) ? { head: text.slice(0, cut), digits } : null;
}

function canBeTranslatedWord(head) {
  return head.length > 0 && !ENDS_WITH_SPACE.test(head) && SINGLE_LINE.test(head);
}

// Имя кодека из отказа "Кодек <имя>: импорт таких дорожек ещё не обкатан." либо null.
function codecNameIn(text) {
  if (!text.startsWith(CODEC_HEAD) || !text.endsWith(CODEC_TAIL)) return null;
  const name = text.slice(CODEC_HEAD.length, text.length - CODEC_TAIL.length);
  return NON_EMPTY_LINE.test(name) ? name : null;
}

export function soundLanguage() {
  const reply = tr("ru");
  return CODES.includes(reply) ? reply : "ru";
}

export function soundWord(count, kind) {
  const lang = soundLanguage();
  return wordIn(lang, toCount(count), kind);
}

export function soundCounted(count, kind) {
  const lang = soundLanguage();
  const shown = numberFormatFor(lang).format(toCount(count));
  // Второе приведение намеренное: форму слова выбирает значение, а не его запись.
  return `${shown} ${wordIn(lang, toCount(count), kind)}`;
}

export function soundTitle(title) {
  const text = title === undefined || title === null ? "" : String(title);
  const parts = splitNumbered(text);
  if (parts !== null && parts.head === "Дорожка") {
    return fill(tr("Дорожка {n}"), "{n}", parts.digits);
  }
  const whole = tr(text);
  if (whole !== text) return whole;
  if (parts !== null && canBeTranslatedWord(parts.head)) {
    const word = tr(parts.head);
    if (word !== parts.head) return `${word} ${parts.digits}`;
  }
  return text;
}

export function soundReason(text) {
  if (typeof text !== "string") return text;
  const codec = codecNameIn(text);
  if (codec === null) return tr(text);
  const shown = codec === "неизвестен" ? tr("неизвестен") : codec;
  return fill(tr("Кодек {codec}: импорт таких дорожек ещё не обкатан."), "{codec}", shown);
}

export function soundClock(seconds) {
  const whole = Math.round(Number(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = String(whole - minutes * 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

export function soundChannels(count) {
  return count === 2 ? tr("стерео") : soundCounted(count, "channel");
}

export function soundLower(text) {
  const lang = soundLanguage();
  const source = String(text);
  return lang === "de" ? source : source.toLowerCase();
}

export function soundDecimal(text) {
  const source = String(text);
  const probe = tr("0,5");
  const mark = probe.length > 1 ? probe[1] : ",";
  const dot = source.indexOf(".");
  return dot < 0 ? source : source.slice(0, dot) + mark + source.slice(dot + 1);
}

export function soundSeconds(seconds, digits = 2) {
  const decimal = soundDecimal((Number(seconds) || 0).toFixed(digits));
  return fill(tr("{value} с"), "{value}", decimal);
}
