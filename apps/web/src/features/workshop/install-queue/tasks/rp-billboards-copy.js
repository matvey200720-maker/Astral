// Слова про билборды на GTA 5 RP (21.11.2026): «видно N из M щитов» и «не влезло K щитов». Строка зависит от числа (падеж слова «щит»), поэтому не запись словаря, а функция по языку, как `features/reshade/reshade-copy.js`.
// Числа присылает главный процесс (`viaUpdate.shields`, `apps/desktop/src/billboards-rp-count.js`): сколько щитов работы видно на RP, сколько их всего и сколько не влезло в файл игры.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Неразрывный пробел: во французском стоит перед «:».
const NBSP = String.fromCharCode(0x00a0);

// Слово «щит» после «из M» / «з M» / «of M» / «von M» / «z M» / «sur M»: единственное число — у M = 1 (в русском и украинском ещё 21, 31…, но не 11).
const WORDS = {
  ru: { one: "щита", other: "щитов" },
  uk: { one: "щита", other: "щитів" },
  en: { one: "billboard", other: "billboards" },
  de: { one: "Billboard", other: "Billboards" },
  pl: { one: "billboardu", other: "billboardów" },
  fr: { one: "panneau", other: "panneaux" },
};

// Целое предложение: «{n}», «{m}» и слово подставляются ниже. Вопросов и кавычек нет, двоеточие только в немецком (пробела перед ним нет).
const SENTENCES = {
  ru: "На GTA 5 RP видно {n} из {m} {word}. Остальные там остаются как в игре.",
  uk: "На GTA 5 RP видно {n} з {m} {word}. Решта там лишається як у грі.",
  en: "On GTA 5 RP, {n} of {m} {word} are visible. The rest stay as in the game there.",
  de: "Auf GTA 5 RP sichtbar: {n} von {m} {word}. Die übrigen bleiben dort wie im Spiel.",
  pl: "Na GTA 5 RP widać {n} z {m} {word}. Pozostałe zostają tam takie jak w grze.",
  fr: "Sur GTA 5 RP, {n} sur {m} {word} sont visibles. Les autres restent comme dans le jeu.",
};

// Щиты, что видны по файлам, но не влезли в предел размера (контейнер 1 ГиБ или бюджет `update.rpf`): слово в именительном падеже после числа «K», по правилам множественного числа языка.
const LIMITED_SENTENCES = {
  ru: " Не влезло в файл игры: ещё {k} {word}.",
  uk: " Не вмістилося у файл гри: ще {k} {word}.",
  en: " Did not fit into the game file: {k} more {word}.",
  de: " Nicht in die Spieldatei gepasst: {k} weitere {word}.",
  pl: " Nie zmieściło się w pliku gry: jeszcze {k} {word}.",
  fr: ` Ne tiennent pas dans le fichier du jeu${NBSP}: {k} {word} de plus.`,
};
const LIMITED_WORDS = {
  ru: { one: "щит", few: "щита", many: "щитов", other: "щита" },
  uk: { one: "щит", few: "щити", many: "щитів", other: "щита" },
  en: { one: "billboard", other: "billboards" },
  de: { one: "Billboard", other: "Billboards" },
  pl: {
    one: "billboard",
    few: "billboardy",
    many: "billboardów",
    other: "billboardu",
  },
  fr: { one: "panneau", other: "panneaux" },
};

const rules = {};
function categoryOf(language, count) {
  rules[language] ??= new Intl.PluralRules(language);
  return rules[language].select(count);
}

// Форма слова после «из M»: в русском и украинском единственное число и у 21, 31… (кроме 11, 111…), в остальных языках — только у 1.
function formOf(language, count) {
  if (language === "ru" || language === "uk")
    return count % 10 === 1 && count % 100 !== 11 ? "one" : "other";
  return count === 1 ? "one" : "other";
}

/**
 * Слова «видно N из M щитов» на языке `language`; `limited` — сколько щитов не влезло в файл игры (0 — ничего не добавляется). `seen` и `total` — целые, `0 ≤ seen ≤ total`, `total ≥ 1`; иначе — пустая строка
 * (говорить нечего). Язык вне списка — русский (так же поступает окно, пока перевод не пришёл).
 */
export function billboardsRpWords(language, seen, total, limited = 0) {
  if (!Number.isInteger(seen) || !Number.isInteger(total)) return "";
  if (total < 1 || seen < 0 || seen > total) return "";
  const code = LANGUAGES.includes(language) ? language : "ru";
  const text = SENTENCES[code]
    .replace("{n}", String(seen))
    .replace("{m}", String(total))
    .replace("{word}", WORDS[code][formOf(code, total)]);
  if (!Number.isInteger(limited) || limited < 1 || limited > total - seen)
    return text;
  const words = LIMITED_WORDS[code];
  const word = words[categoryOf(code, limited)] ?? words.other;
  return (
    text +
    LIMITED_SENTENCES[code]
      .replace("{k}", String(limited))
      .replace("{word}", word)
  );
}
