// Подписи редактора HUD на шести языках окна: строка о проекте и две
// подсказки с размерами. Тексты лежат записью на язык; выбор идёт по коду
// обычным обращением к ключу, поэтому лишнее значение языка не нормализуется.

const LANGUAGES = [
  {
    code: "ru",
    title: "\u00ab{name}\u00bb",
    noEdits: "без правок",
    edits: { one: "правка", few: "правки", many: "правок", other: "правки" },
    hidden: (count) => `скрыто ${count}`,
    scope: "только проект",
    size: "{width} \u00d7 {height} px на этом экране",
    safe: "{width} \u00d7 {height} px из {screenWidth} \u00d7 {screenHeight}",
  },
  {
    code: "uk",
    title: "\u00ab{name}\u00bb",
    noEdits: "без правок",
    edits: { one: "правка", few: "правки", many: "правок", other: "правки" },
    hidden: (count) => `приховано ${count}`,
    scope: "лише проєкт",
    size: "{width} \u00d7 {height} px на цьому екрані",
    safe: "{width} \u00d7 {height} px з {screenWidth} \u00d7 {screenHeight}",
  },
  {
    code: "en",
    title: "\u201c{name}\u201d",
    noEdits: "no edits",
    edits: { one: "edit", other: "edits" },
    hidden: (count) => `${count} hidden`,
    scope: "project only",
    size: "{width} \u00d7 {height} px on this screen",
    safe: "{width} \u00d7 {height} px of {screenWidth} \u00d7 {screenHeight}",
  },
  {
    code: "de",
    title: "\u201e{name}\u201c",
    noEdits: "keine Änderungen",
    edits: { one: "Änderung", other: "Änderungen" },
    hidden: (count) => `${count} ausgeblendet`,
    scope: "nur Projekt",
    size: "{width} \u00d7 {height} px auf diesem Bildschirm",
    safe: "{width} \u00d7 {height} px von {screenWidth} \u00d7 {screenHeight}",
  },
  {
    code: "pl",
    title: "\u201e{name}\u201d",
    noEdits: "bez zmian",
    edits: { one: "zmiana", few: "zmiany", many: "zmian", other: "zmiany" },
    hidden: (count) => `ukryto ${count}`,
    scope: "tylko projekt",
    size: "{width} \u00d7 {height} px na tym ekranie",
    safe: "{width} \u00d7 {height} px z {screenWidth} \u00d7 {screenHeight}",
  },
  {
    code: "fr",
    title: "\u00ab\u00a0{name}\u00a0\u00bb",
    noEdits: "aucune modification",
    edits: { one: "modification", other: "modifications" },
    // единственное число только при точном 1; строка "1" и прочее идут во множественном
    hidden: (count) => (count === 1 ? "1 masqué" : `${count} masqués`),
    scope: "projet uniquement",
    size: "{width} \u00d7 {height} px sur cet écran",
    safe: "{width} \u00d7 {height} px sur {screenWidth} \u00d7 {screenHeight}",
  },
];

/** Столбец из записей языков: объект, где ключ — код языка, а значение берёт функция read. */
const column = (read) =>
  Object.fromEntries(LANGUAGES.map((entry) => [entry.code, read(entry)]));

const TITLE = column((entry) => entry.title);
const NO_EDITS = column((entry) => entry.noEdits);
const EDIT_WORDS = column((entry) => ({
  rule: entry.code,
  words: entry.edits,
}));
const HIDDEN = column((entry) => entry.hidden);
const SCOPE = column((entry) => entry.scope);
const SIZE_LINE = column((entry) => entry.size);
const SAFE_LINE = column((entry) => entry.safe);

/** Значение для языка окна; любой незнакомый код читается по-русски. */
const pick = (table, language) => table[language] ?? table.ru;

/** Подставляет значения вместо {ключ}; не шаблон-строку возвращает как есть. */
function fill(template, values) {
  if (typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
}

const ruleCache = new Map();

/** Категория множественного числа по правилам платформы (правила кэшируются). */
function pluralCategory(locale, amount) {
  let rules = ruleCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    ruleCache.set(locale, rules);
  }
  return rules.select(amount);
}

/** Число и слово ("3 правки"): число остаётся в исходной записи, слово зависит от его модуля. */
function countedEdits(language, changes) {
  const { rule, words } = pick(EDIT_WORDS, language);
  const category = pluralCategory(rule, Math.abs(Number(changes)) || 0);
  return `${changes} ${words[category] ?? words.other}`;
}

export function hudStatusLine(language, options) {
  const { name, changes, hidden, width, height, aspect } = options;
  const parts = [
    fill(pick(TITLE, language), { name }),
    changes ? countedEdits(language, changes) : pick(NO_EDITS, language),
    `${width}\u00d7${height}`,
    `${aspect}`,
  ];
  if (hidden) {
    const describeHidden = pick(HIDDEN, language);
    parts.push(describeHidden(hidden));
  }
  parts.push(pick(SCOPE, language));
  return parts.join(" \u00b7 ");
}

export function hudSizeHint(language, width, height) {
  return fill(pick(SIZE_LINE, language), { width, height });
}

export function hudSafeHint(
  language,
  width,
  height,
  screenWidth,
  screenHeight,
) {
  return fill(pick(SAFE_LINE, language), {
    width,
    height,
    screenWidth,
    screenHeight,
  });
}
