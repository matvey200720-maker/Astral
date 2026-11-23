// Достаёт килл-эффект из файлов чужого редукса без общего XML-разборщика:
// ищется один элемент известного вида и один ключ визуальных настроек.
import {
  KILL_DURATION_KEY,
  KILL_DURATION_RANGE,
  KILL_MODIFIER_NAME,
  VANILLA_KILL_DURATION,
} from "./game-contract.js";
import { importKillEffectModifier } from "./project.js";

const TEXT_LIMIT = 8 * 1024 * 1024;
const DEFAULT_PROJECT_NAME = "Килл-эффект";

const isObject = (value) => typeof value === "object" && value !== null;
const fileName = (file) => String(file.name || "").toLowerCase();

// ---------------------------------------------------------------- модификатор

function stripComments(text) {
  let result = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf("<!--", from);
    const close = open < 0 ? -1 : text.indexOf("-->", open + 4);
    if (close < 0) return result + text.slice(from);
    result += text.slice(from, open);
    from = close + 3;
  }
}

const KILL_NAME_ATTRIBUTE = new RegExp(`\\bname\\s*=\\s*"${KILL_MODIFIER_NAME}"`, "i");
const MODIFIER_OPEN = /<modifier\b/gi;
const MODIFIER_CLOSE = /<\/modifier\s*>/gi;

/** Тело первого килл-модификатора: строка, "" для самозакрытого, null если элемента нет. */
function findKillBody(text) {
  MODIFIER_OPEN.lastIndex = 0;
  for (let hit = MODIFIER_OPEN.exec(text); hit; hit = MODIFIER_OPEN.exec(text)) {
    const tagEnd = text.indexOf(">", hit.index);
    if (tagEnd < 0) return null;
    const attributes = text.slice(hit.index + "<modifier".length, tagEnd);
    if (!KILL_NAME_ATTRIBUTE.test(attributes)) continue;
    if (attributes.endsWith("/")) return "";
    MODIFIER_CLOSE.lastIndex = tagEnd + 1;
    const close = MODIFIER_CLOSE.exec(text);
    return close ? text.slice(tagEnd + 1, close.index) : null;
  }
  return null;
}

const isNameStart = (char) => /[A-Za-z_]/.test(char);
const isNameChar = (char) => /\w/.test(char);

/** Простой элемент <имя ...>текст</имя> с позиции "<"; null, если здесь такого нет. */
function readSimpleElement(body, at) {
  let end = at + 1;
  if (end >= body.length || !isNameStart(body[end])) return null;
  while (end < body.length && isNameChar(body[end])) end += 1;
  const name = body.slice(at + 1, end);
  const next = body[end];
  if (next === undefined || !(next === ">" || next === "/" || /\s/.test(next))) return null;
  const tagEnd = body.indexOf(">", end);
  if (tagEnd < 0) return null;
  const textEnd = body.indexOf("<", tagEnd + 1);
  if (textEnd < 0) return null;
  const closing = `</${name}>`;
  if (!body.startsWith(closing, textEnd)) return null;
  return { name, text: body.slice(tagEnd + 1, textEnd), after: textEnd + closing.length };
}

function* simpleElements(body) {
  let at = body.indexOf("<");
  while (at >= 0) {
    const element = readSimpleElement(body, at);
    if (element) {
      yield element;
      at = body.indexOf("<", element.after);
    } else {
      at = body.indexOf("<", at + 1);
    }
  }
}

function parseRow({ name, text }) {
  const [firstPart, secondPart] = text.trim().split(/\s+/);
  const first = parseFloat(firstPart);
  if (!Number.isFinite(first)) return null;
  const second = parseFloat(secondPart);
  return [name, first, Number.isFinite(second) ? second : 0];
}

export function readKillModifierFields(xml) {
  const text = (xml ? String(xml) : "").slice(0, TEXT_LIMIT);
  if (/<!(?:doctype|entity)/i.test(text)) return null;
  const body = findKillBody(stripComments(text));
  if (body === null) return null;
  return [...simpleElements(body)].map(parseRow).filter((row) => row !== null);
}

// ---------------------------------------------------------------- длительность

const LINE_BREAK = /\r\n|[\n\r\u{2028}\u{2029}]/u;
const isBlank = (char) => char === " " || char === "\t";
const asciiLower = (text) => text.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
const LOWER_DURATION_KEY = asciiLower(KILL_DURATION_KEY);

/**
 * Значение ключа в строке (ключ в начале, после него пробел или табуляция) либо null.
 * Платформенный вариант ключа (`….duration.x64`) читается так же, как его читает сборка файла игрока.
 */
function durationValueOf(line) {
  let at = 0;
  while (isBlank(line[at])) at += 1;
  if (asciiLower(line.slice(at, at + LOWER_DURATION_KEY.length)) !== LOWER_DURATION_KEY) return null;
  at += LOWER_DURATION_KEY.length;
  if (line[at] === ".") {
    const suffixStart = at + 1;
    at = suffixStart;
    while (at < line.length && /\w/.test(line[at])) at += 1;
    if (at === suffixStart) return null;
  }
  if (!isBlank(line[at])) return null;
  while (isBlank(line[at])) at += 1;
  const start = at;
  while (at < line.length && line[at] !== "#" && !/\s/.test(line[at])) at += 1;
  return at > start ? line.slice(start, at) : null;
}

export function readKillDuration(text) {
  if (typeof text !== "string" || text === "") return null;
  for (const line of text.split(LINE_BREAK)) {
    const raw = durationValueOf(line);
    if (raw === null) continue;
    const number = parseFloat(raw);
    if (!Number.isFinite(number)) return null;
    return Math.min(KILL_DURATION_RANGE.max, Math.max(KILL_DURATION_RANGE.min, Math.round(number)));
  }
  return null;
}

// ---------------------------------------------------------------- файлы части

const TIMECYCLE_FILE = /timecycle_mods_(\d+)\.xml$/;

export function winningKillModifier(files = []) {
  let best = null;
  files.forEach((file) => {
    if (!isObject(file)) return;
    const match = TIMECYCLE_FILE.exec(fileName(file));
    if (!match) return;
    const fields = readKillModifierFields(file.text);
    if (fields === null) return;
    const number = Number(match[1]);
    if (best === null || number >= best.number) best = { number, fields };
  });
  return best ? best.fields : null;
}

function findDuration(files) {
  for (const file of files) {
    if (!isObject(file) || !fileName(file).endsWith("visualsettings.dat")) continue;
    const duration = readKillDuration(file.text);
    if (duration !== null) return duration;
  }
  return VANILLA_KILL_DURATION;
}

export function importKillEffectFromMod(files = [], { name = "" } = {}) {
  const duration = findDuration(files);
  const fields = winningKillModifier(files);
  if (fields === null) return null;
  const project = importKillEffectModifier({ fields, name: name || DEFAULT_PROJECT_NAME, duration });
  return { duration, empty: fields.length === 0, project };
}
