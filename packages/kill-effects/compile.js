// Сборка файлов игрока: в тексте таймцикла меняется один элемент <modifier>,
// в visualsettings.dat — один ключ. Результат перечитывается и проверяется.
import { createHash } from "node:crypto";
import {
  parseTimecycleModifierXml,
  serializeTimecycleModifierXml,
} from "@modovik/install-engine/timecycle-merge.js";
import {
  KILL_DURATION_KEY,
  KILL_MODIFIER_ARCHIVE_PATH,
  KILL_MODIFIER_FILE,
  KILL_MODIFIER_NAME,
  VANILLA_KILL_DURATION,
  VISUAL_SETTINGS_ARCHIVE_PATH,
  VISUAL_SETTINGS_FILE,
} from "./game-contract.js";
import { formatModifierValue, serializeKillModifierNode } from "./modifier-xml.js";
import { importKillEffectModifier, resolveKillEffectFields } from "./project.js";

const DEFAULT_IMPORT_NAME = "Мой килл-эффект";
const DEFAULT_REDUX_NAME = "Astral kill effect";
const DURATION_COMMENT = "Astral: длительность оверлея убийства";
const PAYLOAD_PREFIX = "payload/";

const MSG_NO_TIMECYCLE = "В архиве игры не нашёлся timecycle_mods_4.xml — ставить килл-эффект некуда.";
const MSG_NOT_REREAD = "Сборка килл-эффекта повредила таймцикл: модификатор не перечитался.";
const MSG_NEIGHBORS = "Сборка килл-эффекта задела соседние модификаторы таймцикла.";

const isKillModifier = (modifier) => modifier.name.toLowerCase() === KILL_MODIFIER_NAME;

/** "число число" -> [первое, второе]; null, если первое не конечное. */
function parseValuePair(text) {
  const [firstPart, secondPart] = text.trim().split(/\s+/);
  const first = parseFloat(firstPart);
  if (!Number.isFinite(first)) return null;
  const second = parseFloat(secondPart);
  return [first, Number.isFinite(second) ? second : 0];
}

// ---------------------------------------------------------------- текущее состояние файла

export function readKillEffectBase(baseXml) {
  const { modifiers } = parseTimecycleModifierXml(baseXml);
  const kill = modifiers.find(isKillModifier);
  if (!kill) return { present: false, empty: true, fields: [], modifiers: modifiers.length };

  const fields = [];
  for (const field of kill.fields) {
    const pair = parseValuePair(field.text);
    if (pair) fields.push([field.name, ...pair]);
  }
  const declared = Number(kill.attributes?.numMods);
  return {
    present: true,
    empty: fields.length === 0,
    fields,
    declaredMods: Number.isFinite(declared) ? declared : 0,
    modifiers: modifiers.length,
  };
}

export function importKillEffectFromGame({ timecycleXml, visualSettingsText, name }) {
  const base = readKillEffectBase(timecycleXml);
  const stored = readVisualSettingsValue(visualSettingsText, KILL_DURATION_KEY);
  const duration = stored && stored.number !== null ? stored.number : VANILLA_KILL_DURATION;
  const project = importKillEffectModifier({ fields: base.fields, name: name || DEFAULT_IMPORT_NAME, duration });
  return { base, duration, project };
}

// ---------------------------------------------------------------- visualsettings.dat

const isBlank = (char) => char === " " || char === "\t";
const isWordChar = (char) => char !== undefined && /\w/.test(char);
const asciiLower = (text) => text.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));

// Разрывы строки: LF, CR, LS, PS.
const LINE_BREAKS = String.fromCharCode(10, 13, 0x2028, 0x2029);

/** Границы строк текста: [начало, конец] без самого перевода строки. */
function* lineSpans(text) {
  let start = 0;
  while (start <= text.length) {
    let end = start;
    while (end < text.length && !LINE_BREAKS.includes(text[end])) end += 1;
    yield [start, end];
    if (end >= text.length) return;
    start = end + (text[end] === "\r" && text[end + 1] === "\n" ? 2 : 1);
  }
}

/** Значение ключа (с необязательным платформенным окончанием) в одной строке. */
function matchSettingLine(text, start, end, lowerKey) {
  let at = start;
  while (at < end && isBlank(text[at])) at += 1;
  if (asciiLower(text.slice(at, at + lowerKey.length)) !== lowerKey) return null;
  at += lowerKey.length;
  if (at < end && text[at] === ".") {
    const suffixStart = at + 1;
    at = suffixStart;
    while (at < end && isWordChar(text[at])) at += 1;
    if (at === suffixStart) return null;
  }
  if (at >= end || !isBlank(text[at])) return null;
  while (at < end && isBlank(text[at])) at += 1;
  const valueStart = at;
  while (at < end && text[at] !== "#" && !/\s/.test(text[at])) at += 1;
  return at > valueStart ? { valueStart, valueEnd: at } : null;
}

function* settingMatches(text, key) {
  const lowerKey = asciiLower(key);
  for (const [start, end] of lineSpans(text)) {
    const found = matchSettingLine(text, start, end, lowerKey);
    if (found) yield { ...found, raw: text.slice(found.valueStart, found.valueEnd) };
  }
}

function requireKeyText(key) {
  if (typeof key !== "string") throw new TypeError("Ключ визуальных настроек должен быть строкой.");
}

export function readVisualSettingsValue(text, key) {
  if (typeof text !== "string" || text === "") return null;
  requireKeyText(key);
  const first = settingMatches(text, key).next();
  if (first.done) return null;
  const { raw } = first.value;
  const number = parseFloat(raw);
  const lastChar = raw.slice(-1);
  return {
    raw,
    number: Number.isFinite(number) ? number : null,
    suffix: lastChar === "f" || lastChar === "F" ? lastChar : "",
  };
}

export function setVisualSettingsValue(text, key, value, { comment } = {}) {
  const source = typeof text === "string" ? text : "";
  // Непустой текст: ошибка ключа раньше ошибки длительности; пустой — наоборот.
  if (source !== "") requireKeyText(key);
  if (typeof value !== "number") throw new TypeError("Длительность должна быть числом.");
  requireKeyText(key);
  const previous = readVisualSettingsValue(source, key);

  if (previous) {
    const entry = `${value.toFixed(1)}${previous.suffix}`;
    let result = "";
    let from = 0;
    for (const { valueStart, valueEnd } of settingMatches(source, key)) {
      result += source.slice(from, valueStart) + entry;
      from = valueEnd;
    }
    return { text: result + source.slice(from), previous: previous.raw, added: false };
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const note = comment ? `# ${comment}${eol}` : "";
  const block = `${eol}${eol}${note}${key}\t${value.toFixed(1)}f${eol}`;
  return { text: source.trimEnd() + block, previous: null, added: true };
}

export function compileVisualSettings({ baseText, project }) {
  const result = setVisualSettingsValue(baseText, KILL_DURATION_KEY, project.duration, { comment: DURATION_COMMENT });
  return { text: result.text, previous: result.previous, added: result.added, duration: project.duration };
}

// ---------------------------------------------------------------- timecycle_mods_4.xml

// Весь элемент килл-модификатора вместе с отступом и одним переводом строки после него.
// Атрибуты не забирают «/» самозакрытого тега (вычищенный редуксом килл бывает `<modifier … />`,
// и иначе замена съела бы следующий модификатор), имя — в любых кавычках, как у разборщика.
const TAG_BODY = "(?:[^>/]|/(?!>))*";
const KILL_ELEMENT = new RegExp(
  `[ \\t]*<modifier\\s${TAG_BODY}name=(["'])${KILL_MODIFIER_NAME}\\1${TAG_BODY}(?:/>|>[\\s\\S]*?</modifier>)[ \\t]*(?:\\r?\\n)?`,
  "gi",
);
const ROOT_CLOSE_WITH_INDENT = /[ \t]*<\/timecycle_modifier_data\s*>/g;
const FIRST_INDENT = /\n([ \t]+)<modifier/;

// Разборщик комментарии пропускает, значит и место правки в них искать нельзя.
function commentSpans(xml) {
  const spans = [];
  for (let from = 0; ; ) {
    const open = xml.indexOf("<!--", from);
    if (open < 0) return spans;
    const close = xml.indexOf("-->", open + 4);
    from = close < 0 ? xml.length : close + 3;
    spans.push([open, from]);
  }
}

function matchesOutsideComments(pattern, xml) {
  const spans = commentSpans(xml);
  return [...xml.matchAll(pattern)].filter((match) => {
    const tagAt = match.index + match[0].indexOf("<");
    return !spans.some(([start, end]) => tagAt >= start && tagAt < end);
  });
}

const spliceText = (text, at, length, insert) => text.slice(0, at) + insert + text.slice(at + length);

function killDocumentEntry(fields) {
  return {
    name: KILL_MODIFIER_NAME,
    attributes: { name: KILL_MODIFIER_NAME, numMods: String(fields.length), userFlags: "0" },
    fields: fields.map(([name, first, second]) => ({
      name,
      attributes: {},
      text: `${formatModifierValue(first)} ${formatModifierValue(second)}`,
    })),
  };
}

// Новый текст файла и число модификаторов, которое проверка ждёт от результата.
function placeKillModifier(baseXml, document, fields) {
  const newline = baseXml.includes("\r\n") ? "\r\n" : "\n";
  const indent = FIRST_INDENT.exec(baseXml)?.[1] ?? "  ";
  const node = serializeKillModifierNode(fields, { newline, indent });
  const killIndex = document.modifiers.findIndex(isKillModifier);

  if (killIndex >= 0) {
    // Первый килл в тексте вне комментариев — тот же, что первый у разборщика.
    const [element] = matchesOutsideComments(KILL_ELEMENT, baseXml);
    if (element) {
      return { xml: spliceText(baseXml, element.index, element[0].length, node), expected: document.modifiers.length };
    }
    const modifiers = document.modifiers.map((modifier, index) =>
      index === killIndex ? killDocumentEntry(fields) : modifier,
    );
    const xml = serializeTimecycleModifierXml({ ...document, modifiers });
    return { xml, expected: document.modifiers.length };
  }

  // Настоящее закрытие корня — последнее вне комментариев.
  const rootClose = matchesOutsideComments(ROOT_CLOSE_WITH_INDENT, baseXml).at(-1);
  if (rootClose) {
    return { xml: spliceText(baseXml, rootClose.index, 0, node), expected: document.modifiers.length + 1 };
  }
  const modifiers = [...document.modifiers, killDocumentEntry(fields)];
  const xml = serializeTimecycleModifierXml({ ...document, modifiers });
  return { xml, expected: modifiers.length };
}

function buildKillModifier(baseXml, document, fields) {
  const previous = document.modifiers.find(isKillModifier);
  const { xml, expected } = placeKillModifier(baseXml, document, fields);

  const reread = parseTimecycleModifierXml(xml);
  const written = reread.modifiers.find(isKillModifier);
  if (!written || written.fields.length !== fields.length) throw new Error(MSG_NOT_REREAD);
  if (reread.modifiers.length !== expected) throw new Error(MSG_NEIGHBORS);

  return {
    xml,
    fields,
    replaced: Boolean(previous),
    previousFields: previous ? previous.fields.length : null,
    modifiers: reread.modifiers.length,
  };
}

export function compileKillModifierXml({ baseXml, project }) {
  const document = parseTimecycleModifierXml(baseXml);
  const fields = resolveKillEffectFields(project);
  return buildKillModifier(baseXml, document, fields);
}

// ---------------------------------------------------------------- файлы патча

function fileEntry(file, target, text) {
  const bytes = new TextEncoder().encode(text);
  return { file, target, text, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function compileKillEffectProject({ project, timecycleXml, visualSettingsText }) {
  if (!timecycleXml) throw new Error(MSG_NO_TIMECYCLE);
  const fields = resolveKillEffectFields(project);
  const document = parseTimecycleModifierXml(timecycleXml);
  const modifier = buildKillModifier(timecycleXml, document, fields);

  const files = [fileEntry(KILL_MODIFIER_FILE, KILL_MODIFIER_ARCHIVE_PATH, modifier.xml)];
  const hasSettings = typeof visualSettingsText === "string" && visualSettingsText.trim() !== "";
  const settings = hasSettings ? compileVisualSettings({ baseText: visualSettingsText, project }) : null;
  if (settings) files.push(fileEntry(VISUAL_SETTINGS_FILE, VISUAL_SETTINGS_ARCHIVE_PATH, settings.text));

  return {
    files,
    fields: modifier.fields,
    modifier: { replaced: modifier.replaced, previousFields: modifier.previousFields, modifiers: modifier.modifiers },
    duration: {
      requested: project.duration,
      applied: settings ? settings.duration : null,
      previous: settings ? settings.previous : null,
      added: settings ? settings.added : false,
    },
    missing: settings ? [] : [VISUAL_SETTINGS_FILE],
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

export function killEffectPatchManifest({ name, files }) {
  const actions = files.map((file) => ({
    Type: "Replace",
    TargetPath: file.target,
    SourcePath: `${PAYLOAD_PREFIX}${file.file}`,
    Size: file.size,
    Sha256: file.sha256,
    IsWholeReplaceNestedRpf: false,
  }));
  return {
    ReduxName: name || DEFAULT_REDUX_NAME,
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: files.reduce((sum, file) => sum + file.size, 0),
    Actions: actions,
  };
}
