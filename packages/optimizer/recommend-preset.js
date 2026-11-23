// Какой из готовых шаблонов «Графики» подойдёт этому компьютеру. Ступень
// задаёт видеокарта; объём ОЗУ и потоки процессора могут её только понизить.
// Название карты разбирается на слова: класс и модель ищутся по соседним словам.

// Лесенка шаблонов снизу вверх; индекс — ступень.
export const PRESET_LADDER = Object.freeze(["vram-27000", "vram-3600", "astral-medium", "astral-high", "astral-ultra"]);

const GPU_CLASSES = ["integrated", "entry", "mid", "strong", "top"];
const COMMON_RAM_GB = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const RAM_TOLERANCE = 1.08;
const UNKNOWN_NAME_LIMIT = 40;

// ---------------------------------------------------------------- слова названия

const cleanName = (name) => (name ? String(name) : "").replace(/\((?:R|TM)\)/gi, "");
const compactName = (name) => cleanName(name).replace(/\s+/g, " ").trim();

// Слово — непрерывный ряд латинских букв, цифр или подчёркиваний; `gap` — то, что
// стоит между этим словом и предыдущим (пустой `gap`: слова вплотную).
function tokenize(text) {
  const tokens = [];
  let lastEnd = 0;
  for (const found of text.matchAll(/[A-Za-z]+|[0-9]+|_+/g)) {
    const first = found[0][0];
    tokens.push({
      kind: first === "_" ? "under" : first >= "0" && first <= "9" ? "digits" : "alpha",
      text: found[0],
      upper: found[0].toUpperCase(),
      gap: text.slice(lastEnd, found.index),
      start: found.index,
    });
    lastEnd = found.index + found[0].length;
  }
  return tokens;
}

// Границы слова в смысле \b: слева и справа от слова нет другого знака слова.
const opensWord = (tokens, at) => at === 0 || tokens[at].gap !== "";
const closesWord = (tokens, at) => at === tokens.length - 1 || tokens[at + 1].gap !== "";

// Допустимое содержимое между соседними словами фразы.
const GAPS = {
  space: (gap) => gap !== "" && gap.trim() === "",
  maybeSpace: (gap) => gap.trim() === "",
  glued: (gap) => gap === "",
  dash: (gap) => gap === "-",
};

const letters = (names, before = "maybeSpace") => ({
  before,
  test: (token) => token.kind === "alpha" && [names].flat().includes(token.upper),
});
const digitRun = (min, max, before = "maybeSpace") => ({
  before,
  test: (token) => token.kind === "digits" && token.text.length >= min && token.text.length <= max,
});
const digitsOneOf = (values, before = "maybeSpace") => ({
  before,
  test: (token) => token.kind === "digits" && values.includes(token.text),
});
// edges: "both" — слово целиком с обеих сторон, "left" — граница только слева.
const phrase = (steps, edges = "both") => ({ steps, edges });

function phraseFitsAt(tokens, at, { steps, edges }) {
  if (at + steps.length > tokens.length || !opensWord(tokens, at)) return false;
  const fits = steps.every((step, index) => step.test(tokens[at + index]) && (index === 0 || GAPS[step.before](tokens[at + index].gap)));
  return fits && (edges === "left" || closesWord(tokens, at + steps.length - 1));
}

// Первая позиция, с которой начинается любая из фраз (или -1).
function findPhrase(tokens, phrases) {
  for (let at = 0; at < tokens.length; at += 1) {
    if (phrases.some((candidate) => phraseFitsAt(tokens, at, candidate))) return at;
  }
  return -1;
}

// ---------------------------------------------------------------- класс по модели

// Ступень по номеру модели — данными. Номер делится на `divisor` (поколение или тысячи серии),
// берётся первая строка, в чей отрезок `groups` попала группа; внутри неё — первая подходящая
// ступень `steps` по показателю `metric` (rank — две последние цифры, rest — остаток от 1000,
// hundreds — сотни остатка, value — сам номер). `unless: "ti"` — не действует при отдельном слове Ti.
const CLASS_TABLES = {
  RTX: {
    divisor: 100,
    rows: [
      { groups: [30, Infinity], metric: "rank", steps: [{ from: 70, tier: "top" }], otherwise: "strong" },
      { groups: [0, 29], metric: "rank", steps: [{ from: 80, tier: "top" }, { from: 60, tier: "strong" }], otherwise: "mid" },
    ],
  },
  GTX: {
    divisor: 100,
    rows: [
      { groups: [16, 16], metric: "rank", steps: [{ from: 60, tier: "strong" }], otherwise: "mid" },
      {
        groups: [10, 10],
        metric: "rank",
        steps: [{ from: 70, tier: "strong" }, { from: 50, to: 50, tier: "entry", unless: "ti" }, { from: 50, tier: "mid" }],
        otherwise: "entry",
      },
      { groups: [9, 9], metric: "rank", steps: [{ from: 70, tier: "mid" }], otherwise: "entry" },
      { groups: [0, Infinity], metric: "rank", steps: [], otherwise: "entry" },
    ],
  },
  RX: {
    divisor: 1000,
    rows: [
      { groups: [0, 0], metric: "rank", steps: [{ from: 70, tier: "mid" }], otherwise: "entry" },
      { groups: [9, Infinity], metric: "rest", steps: [{ from: 70, tier: "top" }], otherwise: "strong" },
      { groups: [7, 7], metric: "hundreds", steps: [{ from: 7, tier: "top" }], otherwise: "strong" },
      {
        groups: [6, 6],
        metric: "hundreds",
        steps: [{ from: 7, tier: "top" }, { from: 6, tier: "strong" }, { from: 5, tier: "mid" }],
        otherwise: "entry",
      },
      { groups: [0, Infinity], metric: "hundreds", steps: [{ from: 6, tier: "strong" }], otherwise: "mid" },
    ],
  },
  ARC: {
    divisor: Infinity,
    rows: [{ groups: [0, Infinity], metric: "value", steps: [{ from: 570, tier: "strong" }], otherwise: "entry" }],
  },
};

function tierFromTable(table, model, facts) {
  const group = Math.floor(model / table.divisor);
  const row = table.rows.find(({ groups }) => group >= groups[0] && group <= groups[1]);
  const measures = { rank: model % 100, rest: model % 1000, hundreds: Math.floor((model % 1000) / 100), value: model };
  const value = measures[row.metric];
  const step = row.steps.find(({ from, to = Infinity, unless }) => value >= from && value <= to && !(unless && facts[unless]));
  return step ? step.tier : row.otherwise;
}

const hasLoneWord = (tokens, name) => findPhrase(tokens, [phrase([letters(name)])]) >= 0;

// Рядом с названием семейства стоит номер из 3–4 цифр: RTX 3070, RX 580, GTX1050.
function numberedTier(tokens, families) {
  const at = findPhrase(tokens, [phrase([letters(families), digitRun(3, 4)], "left")]);
  if (at < 0) return null;
  const model = Number(tokens[at + 1].text);
  return tierFromTable(CLASS_TABLES[tokens[at].upper], model, { ti: hasLoneWord(tokens, "TI") });
}

// Arc: после слова Arc (на той же строке) отдельное слово из буквы A/B и трёх цифр.
function arcTier(tokens) {
  const lineBreak = (gap) => gap.replace(/./g, "") !== "";
  for (let head = 0; head < tokens.length; head += 1) {
    if (!(tokens[head].upper === "ARC" && tokens[head].kind === "alpha" && opensWord(tokens, head) && closesWord(tokens, head))) continue;
    for (let at = head + 1; at + 1 < tokens.length && !lineBreak(tokens[at].gap); at += 1) {
      const letter = tokens[at];
      const number = tokens[at + 1];
      const isModel =
        letter.kind === "alpha" && ["A", "B"].includes(letter.upper) && opensWord(tokens, at) &&
        number.kind === "digits" && number.text.length === 3 && number.gap === "" && closesWord(tokens, at + 1);
      if (isModel) return tierFromTable(CLASS_TABLES.ARC, Number(number.text), {});
    }
  }
  return null;
}

const always = (tier, phrases) => (tokens) => (findPhrase(tokens, phrases) >= 0 ? tier : null);

const VEGA_MODELS = ["56", "64"];
const INTEGRATED_PHRASES = [
  phrase([letters(["UHD", "IRIS", "VEGA"])]),
  phrase([letters("HD"), letters("GRAPHICS", "space")]),
  phrase([letters("RADEON"), letters("GRAPHICS", "space")]),
  phrase([letters("RADEON"), digitRun(3, 4, "space"), letters("M", "glued"), letters("GRAPHICS", "space")]),
  phrase([letters("RADEON"), digitRun(3, 4, "space"), letters("M", "glued")]),
  phrase([letters("ARC"), letters("GRAPHICS", "space")]),
];

// Порядок важен: побеждает первое сработавшее правило.
const CLASS_RULES = [
  (tokens) => numberedTier(tokens, ["RTX", "GTX"]),
  always("top", [phrase([letters("TITAN")])]),
  always("entry", [phrase([letters(["GT", "MX"]), digitRun(3, 4)])]),
  always("strong", [
    phrase([letters("RADEON"), letters("VEGA", "space"), digitsOneOf(VEGA_MODELS)]),
    phrase([letters("RADEON"), letters("RX", "space"), letters("VEGA"), digitsOneOf(VEGA_MODELS)]),
    phrase([letters("RADEON"), letters("VII", "space")]),
  ]),
  (tokens) => numberedTier(tokens, ["RX"]),
  arcTier,
  always("integrated", INTEGRATED_PHRASES),
];

export function gpuClass(name) {
  const cleaned = cleanName(name);
  if (cleaned.trim() === "") return null;
  const tokens = tokenize(cleaned);
  for (const rule of CLASS_RULES) {
    const tier = rule(tokens);
    if (tier !== null) return tier;
  }
  return null;
}

// ---------------------------------------------------------------- короткое имя

const LAPTOP_PHRASES = [
  phrase([letters(["LAPTOP", "MOBILE"])]),
  phrase([letters("MAX"), letters("Q", "dash")]),
  phrase([letters("RX"), digitRun(3, 4), letters("M", "glued")]),
];
const MODEL_FAMILIES = ["RTX", "GTX", "GT", "MX", "RX"];
const MODEL_SUFFIXES = ["TI", "SUPER", "XTX", "XT", "GRE"];

// Модель, начинающаяся со слова `at`: до какого знака тянется её запись, на каком слове
// закончилась и закрыто ли последнее слово целиком (после него возможны приставки).
// Справа от номера нет проверки границы: у RTX 30700 берутся первые четыре цифры.
function modelSpan(tokens, at) {
  const head = tokens[at];
  const next = tokens[at + 1];
  if (head.kind !== "alpha" || next === undefined) return null;

  if (MODEL_FAMILIES.includes(head.upper)) {
    if (next.kind !== "digits" || next.text.length < 3 || !GAPS.maybeSpace(next.gap)) return null;
    return { end: next.start + Math.min(next.text.length, 4), last: at + 1, closed: next.text.length <= 4 };
  }
  const number = tokens[at + 2];
  const isArc =
    head.upper === "ARC" && next.kind === "alpha" && ["A", "B"].includes(next.upper) && GAPS.space(next.gap) &&
    number !== undefined && number.kind === "digits" && number.text.length >= 3 && number.gap === "";
  return isArc ? { end: number.start + 3, last: at + 2, closed: number.text.length === 3 } : null;
}

// Приставки Ti, SUPER, XTX, XT, GRE через пробел; слово может быть лишь началом
// слова («Tight» даёт Ti), после такого слова приставки кончаются.
function suffixEnd(tokens, span) {
  let { end, last, closed } = span;
  while (closed) {
    const token = tokens[last + 1];
    if (token === undefined || token.kind !== "alpha" || !GAPS.space(token.gap)) break;
    const suffix = MODEL_SUFFIXES.find((candidate) => token.upper.startsWith(candidate));
    if (suffix === undefined) break;
    end = token.start + suffix.length;
    last += 1;
    closed = suffix.length === token.text.length;
  }
  return end;
}

export function shortGpuName(name) {
  const compact = compactName(name);
  const tokens = tokenize(compact);
  for (let at = 0; at < tokens.length; at += 1) {
    const span = opensWord(tokens, at) ? modelSpan(tokens, at) : null;
    if (span === null) continue;
    const model = compact.slice(tokens[at].start, suffixEnd(tokens, span));
    return findPhrase(tokens, LAPTOP_PHRASES) >= 0 ? `${model} Laptop` : model;
  }
  return compact.slice(0, UNKNOWN_NAME_LIMIT);
}

// ---------------------------------------------------------------- ОЗУ и потолки

export function ramLabelGb(memoryGb) {
  const gb = Number(memoryGb);
  if (!(gb > 0 && gb < Infinity)) return null;
  // Ближайший ходовой размер не ниже значения — если он в пределах допуска.
  const nextSize = COMMON_RAM_GB.find((size) => size >= gb);
  return nextSize !== undefined && nextSize <= gb * RAM_TOLERANCE ? nextSize : Math.round(gb);
}

const positiveNumber = (value) => {
  const number = Number(value);
  return number > 0 && number < Infinity ? number : null;
};

// Что ограничивает ступень: источник, откуда читать, и строки «меньше предела → потолок».
const LIMITS = [
  { source: "ram", read: (hardware) => hardware.memoryGb, rows: [[7, 1], [11, 2]] },
  { source: "cpu", read: (hardware) => hardware.cpu?.threads, rows: [[4, 1], [6, 2]] },
];

function ceilingOf(value, rows) {
  if (value === null) return Infinity;
  const row = rows.find(([limit]) => value < limit);
  return row ? row[1] : Infinity;
}

// Самый жёсткий потолок; при равных остаётся ОЗУ (она в списке первая).
function tightestLimit(hardware) {
  return LIMITS.map(({ source, read, rows }) => ({ source, ceiling: ceilingOf(positiveNumber(read(hardware)), rows) })).reduce(
    (tightest, limit) => (limit.ceiling < tightest.ceiling ? limit : tightest),
  );
}

// ---------------------------------------------------------------- рекомендация

// Узнанные карты со ступенью; ноутбучная опускается на одну ступень, но не ниже первой.
function rankedCards(gpus) {
  return gpus.flatMap((entry) => {
    const name = entry?.name;
    if (!name) return [];
    const className = gpuClass(name);
    if (className === null) return [];
    const base = GPU_CLASSES.indexOf(className);
    const laptop = base > 1 && findPhrase(tokenize(cleanName(name)), LAPTOP_PHRASES) >= 0;
    return [{ name, className, step: laptop ? base - 1 : base }];
  });
}

export function recommendPreset(hardware) {
  const cards = rankedCards(Array.isArray(hardware?.gpus) ? hardware.gpus : []);
  if (cards.length === 0) return null;

  // При равных ступенях побеждает первая карта списка.
  const best = cards.reduce((top, card) => (card.step > top.step ? card : top));
  const limit = tightestLimit(hardware);
  const step = Math.min(best.step, limit.ceiling);
  return {
    id: PRESET_LADDER[step],
    gpuClass: best.className,
    gpuName: best.name,
    gpuLabel: shortGpuName(best.name),
    ramGb: ramLabelGb(hardware.memoryGb),
    limitedBy: step < best.step ? limit.source : null,
  };
}
