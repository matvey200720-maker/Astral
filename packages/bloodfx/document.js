// Разбор и сборка bloodfx.dat без потерь: документ — список исходных строк плюс указатели на слова в них.

import {
  BLOODFX_EMPTY_NAME,
  BLOODFX_FIELD,
  BLOODFX_NAME_FIELDS,
  BLOODFX_RECORD_FIELDS,
  BLOODFX_RECORD_SECTIONS,
  BLOODFX_TABLES,
  BLOOD_BODY_PARTS,
  BLOOD_WEAPON_CLASSES,
} from "./schema.js";

const MAX_CHARS = 4 * 1024 * 1024;
const LONGEST_ROW = BLOOD_WEAPON_CLASSES.length;
const SHORTEST_ROW = LONGEST_ROW - 1;
const DOUBLE_ID = "номер записи встречается дважды";

const RULE_COLUMNS = ["fxSystem", "fxSystemBodyArmour", "fxSystemHeavyArmour", "fxSystemUnderwater"].map(
  (key) => BLOODFX_FIELD[key],
);

const isDigit = (ch) => ch >= "0" && ch <= "9";
const isDigits = (text) => text.length > 0 && [...text].every(isDigit);
const isNameChar = (ch) => (ch >= "A" && ch <= "Z") || isDigit(ch) || ch === "_";

// Слова строки: текст и границы в единицах UTF-16.
const wordsOf = (text) =>
  Array.from(text.matchAll(/\S+/g), ({ 0: word, index }) => ({ text: word, start: index, end: index + word.length }));

// Режем по LF; CR прямо перед LF уходит в окончание. Склейка text + terminator возвращает вход.
function* splitLines(text) {
  for (let from = 0; from < text.length; ) {
    const lf = text.indexOf("\n", from);
    if (lf < 0) {
      yield { text: text.slice(from), terminator: "" };
      return;
    }
    const crlf = text[lf - 1] === "\r";
    yield { text: text.slice(from, crlf ? lf - 1 : lf), terminator: crlf ? "\r\n" : "\n" };
    from = lf + 1;
  }
}

const isVersion = (text) => {
  const [whole, fraction, ...extra] = text.split(".");
  return extra.length === 0 && isDigits(whole) && isDigits(fraction ?? "");
};

const SECTION_ENDINGS = [
  ["_START", "start"],
  ["_END", "end"],
];

// Строка вида ИМЯ_START / ИМЯ_END или null.
const sectionMark = (trimmed) => {
  for (const [ending, kind] of SECTION_ENDINGS) {
    if (!trimmed.endsWith(ending)) continue;
    const name = trimmed.slice(0, -ending.length);
    if (name !== "" && [...name].every(isNameChar)) return { kind, name };
  }
  return null;
};

const buildTable = (section, rows) => {
  if (rows.length !== BLOOD_BODY_PARTS.length) {
    throw new Error(`${section}: ожидается ${BLOOD_BODY_PARTS.length} строк, найдено ${rows.length}.`);
  }
  const byPart = new Map();
  rows.forEach((row, position) => {
    const expected = BLOOD_BODY_PARTS[position];
    const found = row.tokens[0].text;
    if (found !== expected) throw new Error(`${section}: строка ${position} — ${found}, ожидается ${expected}.`);
    const columns = row.tokens.length - 1;
    if (columns < SHORTEST_ROW || columns > LONGEST_ROW) {
      throw new Error(`${section}/${expected}: ожидается ${SHORTEST_ROW} или ${LONGEST_ROW} колонок, найдено ${columns}.`);
    }
    byPart.set(expected, row);
  });
  return { section, rows: byPart };
};

// Колонка имени не должна начинаться с числа (знак + цифра); одинокий прочерк допустим.
const looksNumeric = (word) => isDigit(/^[+-]/.test(word) ? word[1] : word[0]);

const shapeProblem = ({ tokens }) => {
  if (tokens.length !== BLOODFX_RECORD_FIELDS) return `ожидается ${BLOODFX_RECORD_FIELDS} полей, найдено ${tokens.length}`;
  const column = BLOODFX_NAME_FIELDS.find((index) => looksNumeric(tokens[index].text));
  return column === undefined ? null : `колонка ${column} должна содержать имя эффекта`;
};

const buildRecords = (section, lines) => {
  const uses = new Map();
  lines.forEach(({ tokens }) => uses.set(tokens[0].text, (uses.get(tokens[0].text) ?? 0) + 1));
  const rows = new Map();
  const irregular = [];
  for (const row of lines) {
    const id = row.tokens[0].text;
    const problem = shapeProblem(row) ?? (uses.get(id) > 1 ? DOUBLE_ID : null);
    if (problem === null) rows.set(id, row);
    else irregular.push({ id, line: row.line, fields: row.tokens.length, problem });
  }
  return { section, rows, order: [...rows.keys()], irregular };
};

// Имя секции файла -> куда класть результат и чем её разбирать (порядок = порядок проверки «секции нет»).
const SECTIONS = new Map([
  ...BLOODFX_TABLES.map(({ id, section }) => [section, { sink: "tables", id, build: buildTable }]),
  ...BLOODFX_RECORD_SECTIONS.map(({ id, section }) => [section, { sink: "records", id, build: buildRecords }]),
]);

const readStructure = (lines) => {
  const sinks = { tables: {}, records: {} };
  let version = null;
  let open = null;

  lines.forEach(({ text }, index) => {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    if (version === null) {
      if (!isVersion(trimmed)) throw new Error("bloodfx.dat начинается не с номера версии.");
      version = trimmed;
      return;
    }
    const mark = sectionMark(trimmed);
    switch (mark?.kind) {
      case "start":
        if (open) throw new Error(`Секция ${open.name} не закрыта.`);
        if (!SECTIONS.has(mark.name)) throw new Error(`Неизвестная секция bloodfx.dat: ${mark.name}`);
        open = { name: mark.name, lines: [] };
        break;
      case "end": {
        if (open?.name !== mark.name) throw new Error(`Неожиданное завершение секции: ${mark.name}`);
        const { sink, id, build } = SECTIONS.get(open.name);
        sinks[sink][id] = build(open.name, open.lines);
        open = null;
        break;
      }
      default:
        if (!open) throw new Error("Данные bloodfx.dat вне секции.");
        open.lines.push({ line: index, tokens: wordsOf(text) });
    }
  });

  if (open) throw new Error(`Секция ${open.name} не закрыта.`);
  for (const [name, { sink, id }] of SECTIONS) {
    if (!Object.hasOwn(sinks[sink], id)) throw new Error(`В bloodfx.dat нет секции ${name}.`);
  }
  return { version, tables: sinks.tables, records: sinks.records };
};

export const parseBloodFx = (input) => {
  const text = String(input ?? "");
  if (text.trim() === "") throw new Error("bloodfx.dat пуст.");
  if (text.length > MAX_CHARS) throw new RangeError("bloodfx.dat превышает 4 МБ.");
  const lines = [...splitLines(text)];
  const { version, tables, records } = readStructure(lines);
  return { version, lines, tables, records };
};

export const irregularRecords = (document) =>
  BLOODFX_RECORD_SECTIONS.flatMap(({ id, section }) =>
    (document.records?.[id]?.irregular ?? []).map((item) => ({ section: id, name: section, ...item })),
  ).sort((a, b) => a.line - b.line);

export const serializeBloodFx = (document) =>
  document.lines.map(({ text, terminator }) => `${text}${terminator}`).join("");

// Новый просвет после заменённого слова: колонка за ним остаётся на месте, насколько позволяет ширина.
const regap = (word, value, gap) => {
  const room = word.text.length + gap.length - value.length;
  const tabbed = gap.includes("\t");
  if (room <= 0) return tabbed ? "\t" : " ";
  if (!tabbed) return " ".repeat(room);
  const cut = Math.min(Math.max(gap.length - 1, 0), Math.max(value.length - word.text.length, 0));
  return gap.slice(cut);
};

export const replaceToken = (document, lineIndex, tokens, field, value) => {
  const line = document.lines[lineIndex];
  const word = tokens[field];
  if (!line || !word) throw new Error("Поле bloodfx.dat не найдено.");
  const replacement = String(value);
  if (replacement === "" || /\s/.test(replacement)) {
    throw new Error("Значение поля bloodfx.dat не может быть пустым.");
  }

  const head = line.text.slice(0, word.start) + replacement;
  const following = tokens[field + 1];
  const text = following
    ? head + regap(word, replacement, line.text.slice(word.end, following.start)) + line.text.slice(following.start)
    : head + line.text.slice(word.end);

  line.text = text;
  tokens.length = 0;
  wordsOf(text).forEach((token) => tokens.push(token));
  return text;
};

export const tableRow = (document, tableId, bodyPart) => {
  const row = document.tables?.[tableId]?.rows?.get(bodyPart);
  return row ? row.tokens.slice(1).map((token) => token.text) : null;
};

export const recordField = (document, sectionId, id, field) => {
  const row = document.records?.[sectionId]?.rows?.get(String(id));
  return row?.tokens[field]?.text ?? null;
};

export const recordIds = (document, sectionId) => [...(document.records?.[sectionId]?.order ?? [])];

export const referencedEffectRules = (document) => {
  const names = new Set();
  for (const { id } of BLOODFX_RECORD_SECTIONS) {
    const rows = document.records?.[id]?.rows;
    if (!rows) continue;
    for (const { tokens } of rows.values()) {
      for (const column of RULE_COLUMNS) {
        const name = tokens[column]?.text;
        if (name && name !== BLOODFX_EMPTY_NAME) names.add(name);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
};
