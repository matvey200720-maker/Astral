import { tr } from "../../../../locales/ui.js";

export { count, ctx, fill, nounWords, plural, tl, trKey, trProps, trValues, uiLanguage, weaponNoun };

const PROBE = "interface-language-probe";

// Язык окна словарь выдаёт сам: на пробу он отвечает своим кодом, у русского записи нет.
const uiLanguage = () => {
  const answer = tr(PROBE);
  if (answer !== PROBE) return answer;
  return "ru";
};

// Метка для данных уровня модуля: ключ остаётся русским, переводит место показа.
const trKey = (text) => text;

function hasRussianLetter(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0x410 && code <= 0x44f) || code === 0x401 || code === 0x451) return true;
  }
  return false;
}

function liveReader(value) {
  if (typeof value === "string" && hasRussianLetter(value)) return () => tr(value);
  return () => value;
}

function trProps(source) {
  const shape = Object.fromEntries(
    Object.entries(source).map(([name, value]) => [name, { enumerable: true, get: liveReader(value) }]),
  );
  return Object.freeze(Object.defineProperties({}, shape));
}

function trValues(source) {
  const pairs = [];
  for (const [name, value] of Object.entries(source)) pairs.push([name, tr(value)]);
  return Object.fromEntries(pairs);
}

const isNameChar = (code) =>
  (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 95;

function fill(template, vars = {}) {
  const text = String(template);
  const out = [];
  let copied = 0;
  let open = text.indexOf("{");
  while (open >= 0) {
    let end = open + 1;
    while (end < text.length && isNameChar(text.charCodeAt(end))) end += 1;
    if (end === open + 1 || text.charCodeAt(end) !== 125) {
      open = text.indexOf("{", open + 1);
      continue;
    }
    const value = vars[text.slice(open + 1, end)];
    if (value != null) {
      out.push(text.slice(copied, open), String(value));
      copied = end + 1;
    }
    open = text.indexOf("{", end + 1);
  }
  out.push(text.slice(copied));
  return out.join("");
}

const inRange = (x, from, to) => x >= from && x <= to;

const FEW_FORM_RULES = new Map([
  ["en", (a) => (a === 1 ? 0 : 1)],
  ["de", (a) => (a === 1 ? 0 : 1)],
  ["fr", (a) => (a === 0 || a === 1 ? 0 : 1)],
  [
    "pl",
    (a) => {
      if (a === 1) return 0;
      return inRange(a % 10, 2, 4) && !inRange(a % 100, 12, 14) ? 1 : 2;
    },
  ],
]);

function eastSlavicForm(a) {
  const r10 = a % 10;
  const r100 = a % 100;
  if (r10 === 1 && r100 !== 11) return 0;
  return inRange(r10, 2, 4) && !inRange(r100, 12, 14) ? 1 : 2;
}

function plural(n, forms) {
  const variants = tr(forms).split("|");
  const rule = FEW_FORM_RULES.get(uiLanguage()) ?? eastSlavicForm;
  const absolute = Math.abs(Number(n));
  const magnitude = absolute > 0 ? absolute : 0;
  return variants[Math.min(rule(magnitude), variants.length - 1)];
}

function count(n, forms) {
  const written = `${n}`;
  return `${written} ${plural(n, forms)}`;
}

const ctx = (id) => Object.freeze({ ctx: id });

const isContextRef = (label) => Boolean(label) && typeof label === "object";

function tl(label) {
  const lang = uiLanguage();
  if (!isContextRef(label)) return LABEL_WORDS[label]?.[lang] ?? tr(label);
  const row = CONTEXT_WORDS[label.ctx];
  return row[lang] ?? row.ru;
}

function nounWords(kind, masked = "") {
  const wordAt = (slot) => () => {
    const rows = NOUN_ROWS[kind];
    return (rows[uiLanguage()] ?? rows.ru)[slot];
  };
  const shape = {};
  NOUN_FIELDS.forEach((field, slot) => {
    shape[field] = { enumerable: true, get: wordAt(slot) };
  });
  shape.masked = { enumerable: true, get: () => (masked ? tr(masked) : "") };
  return Object.freeze(Object.defineProperties({}, shape));
}

/* ---- таблицы слов ---- */

const LANG_CODES = ["ru", "uk", "en", "de", "pl", "fr"];

// Строка «слово|слово|…» по порядку LANG_CODES превращается в объект «язык → слово».
const byLang = (line) => {
  const words = line.split("|");
  return Object.fromEntries(LANG_CODES.map((code, i) => [code, words[i]]));
};

const CONTEXT_WORDS = {
  magazine: byLang("Магазин|Магазин|Magazine|Magazin|Magazynek|Chargeur"),
  scope: byLang("Прицел|Приціл|Scope|Zielfernrohr|Luneta|Lunette"),
  barrel: byLang("Ствол|Ствол|Barrel|Lauf|Lufa|Canon"),
  melee: byLang("Холодное|Холодна зброя|Melee|Nahkampfwaffen|Broń biała|Armes blanches"),
};

const LABEL_WORDS = {
  Полоска: byLang("Полоска|Смужка|Stripe|Streifen|Pasek|Bande"),
  Стоит: byLang("Стоит|Стоїть|Standing|Stehend|Stoi|Debout"),
  Развёртка: byLang("Развёртка|Розгортка|Unwrap|Abwicklung|Rozwinięcie|Dépliage"),
};

const NOUN_FIELDS = ["one", "of", "acc", "dat", "loc", "ins", "skin", "mine"];

// Слова по полям NOUN_FIELDS, разделитель «|»; «’» — типографский апостроф французского.
const nounRows = (rows) =>
  Object.fromEntries(Object.entries(rows).map(([code, line]) => [code, line.split("|")]));

const NOUN_ROWS = {
  weapon: nounRows({
    ru: "ствол|ствола|ствол|стволу|стволе|стволом|скин|Мой скин",
    uk: "ствол|ствола|ствол|стволу|стволі|стволом|скін|Мій скін",
    en: "weapon|weapon|weapon|weapon|weapon|weapon|skin|My skin",
    de: "Waffe|der Waffe|die Waffe|der Waffe|der Waffe|der Waffe|Skin|Mein Skin",
    pl: "broń|broni|broń|broni|broni|bronią|skin|Mój skin",
    fr: "arme|de l’arme|l’arme|l’arme|l’arme|l’arme|le skin|Mon skin",
  }),
  clothing: nounRows({
    ru: "модель|модели|модель|модели|модели|моделью|покраска|Моя покраска",
    uk: "модель|моделі|модель|моделі|моделі|моделлю|фарбування|Моє фарбування",
    en: "model|model|model|model|model|model|paint|My paint",
    de: "Modell|des Modells|das Modell|dem Modell|dem Modell|dem Modell|Lackierung|Meine Lackierung",
    pl: "model|modelu|model|modelowi|modelu|modelem|malowanie|Moje malowanie",
    fr: "modèle|du modèle|le modèle|le modèle|le modèle|le modèle|la peinture|Ma peinture",
  }),
};

const weaponNoun = nounWords("weapon");
