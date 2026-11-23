// Файлы ключевых кадров таймцикла GTA V (w_*.xml): жёсткий разбор, сборка целиком и точечная правка чисел.
// Источник файла ненадёжен, поэтому DTD и сущности запрещены, а размеры и числа ограничены.
// Работает со строками; файлов не трогает. XML читает saxes, длину в байтах считает ./text-bytes.js.

import { SaxesParser } from "saxes";
import { textBytes } from "./text-bytes.js";
import { xmlForParsing } from "./xml-declaration.js";

const ROOT_NAME = "timecycle_keyframe_data";
const DEFAULT_VERSION = "1.000000";
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_REGIONS = 16;
const MAX_PARAMETERS = 2048;
const MAX_VALUES = 64;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_REGION_NAME = 64;
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const DTD_MARK = /<!(?:doctype|entity)(?![A-Za-z0-9_])/i;
const XML_DECLARATIONS = /<\?xml[\s\S]*?\?>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

const FAIL = {
  empty: "Файл таймцикла пуст.",
  tooBig: "Файл таймцикла превышает безопасный размер.",
  dtd: "Файл таймцикла не может содержать DTD или сущности.",
  doctype: "Файл таймцикла не может содержать doctype.",
  rootOnlyCycle: "В корне таймцикла допустим только элемент <cycle>.",
  secondCycle: "Файл таймцикла содержит больше одного цикла.",
  noCycleName: "У цикла таймцикла нет имени.",
  cycleOnlyRegions: "В цикле таймцикла допустимы только элементы <region>.",
  badRegionName: "У региона таймцикла нет допустимого имени.",
  tooManyRegions: "Слишком много регионов в файле таймцикла.",
  tooManyParameters: "Слишком много параметров в регионе таймцикла.",
  nested: "Вложенные элементы внутри параметра не поддерживаются.",
  strayText: "Неожиданный текст в файле таймцикла.",
  truncated: "Файл таймцикла оборван.",
  noRegions: "В файле таймцикла нет ни одного региона.",
  unexpectedRoot: (name) => `Неожиданный корень файла таймцикла: <${name}>.`,
  regionRepeats: (name) => `Регион таймцикла «${name}» повторяется.`,
  badParameterName: (name) => `Недопустимое имя параметра таймцикла: <${name}>.`,
  parameterRepeats: (name) => `Параметр таймцикла «${name}» повторяется.`,
  parameterTooLong: (name) => `Параметр таймцикла «${name}» слишком длинный.`,
  parameterEmpty: (name) => `Параметр таймцикла «${name}» пуст.`,
  tooManyValues: (name) => `Параметр таймцикла «${name}» содержит слишком много значений.`,
  notNumeric: (name, chunk) => `Параметр таймцикла «${name}» содержит нечисловое значение «${chunk}».`,
  noSourceRegion: (name) => `В файле таймцикла нет региона «${name}».`,
  regionNotInText: (name) => `Регион «${name}» не найден в тексте файла.`,
  cannotAdd: (name) => `Параметра «${name}» нет в файле игры — добавлять его нельзя.`,
  parameterNotInText: (name) => `Параметр «${name}» не найден в тексте файла.`,
  renamedCycle: "Собранный таймцикл сменил имя цикла.",
  lostRegions: "Собранный таймцикл потерял регион.",
  lostRegion: (name) => `Собранный таймцикл потерял регион «${name}».`,
  orderBroken: (name) => `В регионе «${name}» сбит порядок параметров.`,
  wrongNumber: (name) => `Параметр «${name}» собран не тем числом.`,
};


// ---------------------------------------------------------------- запись чисел

// Четыре знака после точки; не конечное число даёт 0, «минус ноль» тоже нуль.
const formatNumber = (value) => {
  const number = Number(value);
  const text = Number.isFinite(number) ? number.toFixed(4) : "0.0000";
  return text === "-0.0000" ? "0.0000" : text;
};

const recordedForm = (values) => values.map(formatNumber);
function sameRecordedValues(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------- разбор

// Атрибуты saxes (объект без прототипа) -> обычный объект со строковыми значениями в порядке файла.
function plainAttributes(attributes) {
  const entries = [];
  for (const key in attributes) entries.push([key, `${attributes[key]}`]);
  return Object.fromEntries(entries);
}

const emptyRegion = (name, attributes) => ({ name, attributes, order: [], values: {} });

// Сборщик документа по событиям saxes. Ошибки XML и структуры копятся (побеждает первая),
// ошибки чисел бросаются сразу в момент закрытия параметра, если до этого всё было в порядке.
function createReader(lenient) {
  const state = {
    error: null,
    openCount: 0,
    rootAttributes: null,
    cycle: null,
    regions: [],
    region: null,
    parameter: null,
    duplicates: [],
  };
  const fail = (reason) => {
    state.error ??= typeof reason === "string" ? new Error(reason) : reason;
  };

  // По одному обработчику на уровень вложенности: корень, цикл, регион, параметр.
  const enterRoot = ({ name, attributes }) => {
    if (name === ROOT_NAME) state.rootAttributes = plainAttributes(attributes);
    else fail(FAIL.unexpectedRoot(name));
  };

  const enterCycle = ({ name, attributes }) => {
    const own = plainAttributes(attributes);
    const cycleName = (own.name ?? "").trim();
    if (name !== "cycle") fail(FAIL.rootOnlyCycle);
    else if (state.cycle) fail(FAIL.secondCycle);
    else if (cycleName === "") fail(FAIL.noCycleName);
    else state.cycle = { name: cycleName, attributes: own };
  };

  const enterRegion = ({ name, attributes }) => {
    if (name !== "region") {
      fail(FAIL.cycleOnlyRegions);
      return;
    }
    const own = plainAttributes(attributes);
    const regionName = (own.name ?? "").trim();
    if (regionName === "" || regionName.length > MAX_REGION_NAME) fail(FAIL.badRegionName);
    else if (state.regions.length >= MAX_REGIONS) fail(FAIL.tooManyRegions);
    else if (state.regions.some((known) => known.name === regionName)) fail(FAIL.regionRepeats(regionName));
    else {
      state.region = emptyRegion(regionName, own);
      state.regions.push(state.region);
    }
  };

  const enterParameter = ({ name }) => {
    const { region } = state;
    if (!PARAMETER_NAME.test(name)) {
      fail(FAIL.badParameterName(name));
      return;
    }
    if (region.order.length >= MAX_PARAMETERS) {
      fail(FAIL.tooManyParameters);
      return;
    }
    const repeated = Object.hasOwn(region.values, name);
    if (repeated && !lenient) {
      fail(FAIL.parameterRepeats(name));
      return;
    }
    // Повтор в мягком режиме пропускается целиком: его содержимое не разбирается.
    if (repeated) state.duplicates.push(`${region.name}/${name}`);
    state.parameter = { name, text: "", skipped: repeated };
  };

  const entering = [enterRoot, enterCycle, enterRegion, enterParameter];

  // Читает числа параметра; пустое, слишком длинное и нечисловое бросает сразу.
  const storeParameter = () => {
    const { name, text, skipped } = state.parameter;
    state.parameter = null;
    if (skipped) return;
    const chunks = text.split(/\s+/).filter(Boolean);
    const refusal = chunks.length === 0 ? FAIL.parameterEmpty(name) : chunks.length > MAX_VALUES ? FAIL.tooManyValues(name) : "";
    if (refusal) throw new Error(refusal);
    const numbers = [];
    for (const chunk of chunks) {
      const number = Number(chunk);
      if (!Number.isFinite(number)) throw new Error(FAIL.notNumeric(name, chunk));
      numbers.push(number);
    }
    state.region.values[name] = numbers;
    state.region.order.push(name);
  };

  return {
    fail,
    open(tag) {
      if (state.error) return;
      const level = state.openCount;
      state.openCount += 1;
      if (level < entering.length) entering[level](tag);
      else fail(FAIL.nested);
    },
    // Текст и CDATA: внутри параметра копится, вне параметра допустимы только пробельные знаки.
    text(chunk) {
      if (state.error) return;
      const current = state.parameter;
      if (!current) {
        if (chunk.trim() !== "") fail(FAIL.strayText);
      } else if (!current.skipped) {
        current.text += chunk;
        if (textBytes(current.text) > MAX_TEXT_BYTES) fail(FAIL.parameterTooLong(current.name));
      }
    },
    close() {
      if (state.error) return;
      state.openCount -= 1;
      if (state.openCount === 3) storeParameter();
      else if (state.openCount === 2) state.region = null;
    },
    finish() {
      if (state.error) throw state.error;
      if (state.openCount !== 0 || !state.rootAttributes) throw new Error(FAIL.truncated);
      if (state.regions.length === 0) throw new Error(FAIL.noRegions);
      const parsed = {
        version: state.rootAttributes.version || DEFAULT_VERSION,
        rootAttributes: state.rootAttributes,
        cycleName: state.cycle.name,
        cycleAttributes: state.cycle.attributes,
        regions: state.regions,
      };
      if (lenient && state.duplicates.length > 0) parsed.duplicates = state.duplicates;
      return parsed;
    },
  };
}

// Мягкий режим (чужие моды): без BOM, без деклараций <?xml ...?> и без комментариев.
const withoutAuthorNoise = (text) =>
  (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(XML_DECLARATIONS, "").replace(COMMENTS, "");

// Проверки до разбора, по порядку; побеждает первая сработавшая.
const PRECHECKS = [
  [(text) => text.trim() === "", FAIL.empty],
  [(text) => textBytes(text) > MAX_FILE_BYTES, FAIL.tooBig],
  [(text) => DTD_MARK.test(text), FAIL.dtd],
];

export function parseKeyframeXml(input, { lenient = false } = {}) {
  const raw = String(input || "");
  const text = lenient ? withoutAuthorNoise(raw) : raw;
  const refusal = PRECHECKS.find(([violated]) => violated(text));
  if (refusal) throw new Error(refusal[1]);

  const reader = createReader(lenient);
  const parser = new SaxesParser({ xmlns: false });
  // on() у saxes ничего не возвращает, поэтому подписки идут по одной, а не цепочкой.
  const subscriptions = [
    ["error", reader.fail],
    ["doctype", () => reader.fail(FAIL.doctype)],
    ["opentag", (tag) => reader.open(tag)],
    ["text", (chunk) => reader.text(chunk)],
    ["cdata", (chunk) => reader.text(chunk)],
    ["closetag", () => reader.close()],
  ];
  for (const [event, handler] of subscriptions) parser.on(event, handler);
  parser.write(xmlForParsing(text)).close();
  return reader.finish();
}

// ---------------------------------------------------------------- сборка целиком

const escapeAttribute = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const attributesText = (attributes) =>
  Object.entries(attributes).reduce((text, [key, value]) => `${text} ${key}="${escapeAttribute(value)}"`, "");

const parameterLine = (name, values = []) => `      <${name}> ${values.map(formatNumber).join(" ")}</${name}>`;

function* documentLines(document) {
  const rootAttributes = document.rootAttributes || { version: document.version || DEFAULT_VERSION };
  const cycleAttributes = {
    ...document.cycleAttributes,
    name: document.cycleName,
    regions: String(document.regions.length),
  };
  yield '<?xml version="1.0" encoding="UTF-8"?>';
  yield "";
  yield `<${ROOT_NAME}${attributesText(rootAttributes)}>`;
  yield `  <cycle${attributesText(cycleAttributes)}>`;
  for (const region of document.regions) {
    yield `    <region${attributesText({ ...region.attributes, name: region.name })}>`;
    for (const name of region.order) yield parameterLine(name, region.values[name]);
    yield "    </region>";
  }
  yield "  </cycle>";
  yield `</${ROOT_NAME}>`;
  yield "";
}

export const serializeKeyframeXml = (document) => [...documentLines(document)].join("\n");

// ---------------------------------------------------------------- поиск и копия

export const findRegion = (document, name) => {
  const target = String(name).toUpperCase();
  const sameName = (region) => region.name.toUpperCase() === target;
  return document.regions.find(sameName) ?? null;
};

function* parameterNames(document) {
  for (const region of document.regions) {
    for (const name of region.order) yield name;
  }
}

export const documentParameters = (document) => [...new Set(parameterNames(document))];

const duplicate = (values) => [...values];

const cloneRegion = (region) => ({
  name: region.name,
  attributes: { ...region.attributes },
  order: [...region.order],
  values: Object.fromEntries(Object.entries(region.values).map(([name, list]) => [name, duplicate(list)])),
});

export function cloneKeyframeDocument(document) {
  const version = document.version;
  const rootAttributes = { ...document.rootAttributes };
  const cycleName = document.cycleName;
  const cycleAttributes = { ...document.cycleAttributes };
  const regions = document.regions.map(cloneRegion);
  return { version, rootAttributes, cycleName, cycleAttributes, regions };
}

// ---------------------------------------------------------------- проверка

const ensure = (holds, message) => {
  if (!holds) throw new Error(message);
};

export function verifyKeyframeXml(xml, document) {
  const parsed = parseKeyframeXml(xml);
  ensure(parsed.cycleName === document.cycleName, FAIL.renamedCycle);
  ensure(parsed.regions.length === document.regions.length, FAIL.lostRegions);
  for (const region of document.regions) {
    const found = findRegion(parsed, region.name);
    ensure(found, FAIL.lostRegion(region.name));
    ensure(found.order.join("\n") === region.order.join("\n"), FAIL.orderBroken(region.name));
    for (const name of region.order) {
      const documented = region.values[name].map(formatNumber);
      ensure(sameRecordedValues(found.values[name].map(formatNumber), documented), FAIL.wrongNumber(name));
    }
  }
  return true;
}

// ---------------------------------------------------------------- точечная правка

const REGION_OPENING = /<region(?![A-Za-z0-9_])[^>]*>/g;

// Тело региона в тексте: первый тег <region ...> с name="ИМЯ" (только двойные кавычки; перед «name» не буква,
// цифра или «_») и ближайший за ним </region>. В имени остаются лишь A-Za-z0-9_.
function findRegionBody(text, regionName) {
  const named = new RegExp(`[^A-Za-z0-9_]name="${regionName.replace(/[^A-Za-z0-9_]/g, "")}"`);
  for (const opening of text.matchAll(REGION_OPENING)) {
    if (!named.test(opening[0])) continue;
    const start = opening.index + opening[0].length;
    const end = text.indexOf("</region>", start);
    return end < 0 ? null : { start, end };
  }
  return null;
}

// Первый голый <имя>...</имя> в теле региона: без атрибутов и без вложенных тегов.
function findBareParameter(text, body, name) {
  const inside = text.slice(body.start, body.end);
  const found = new RegExp(`<${name}>([^<]*)</${name}>`).exec(inside);
  if (!found) return null;
  const start = body.start + found.index + name.length + 2;
  return { start, end: start + found[1].length };
}

// Параметры региона документа, чья запись с четырьмя знаками отличается от записи в файле.
function changedParameters(region, sourceRegion) {
  const changed = [];
  const known = new Set(sourceRegion.order);
  for (const name of region.order) {
    if (!known.has(name)) {
      changed.push({ name, missing: true });
      continue;
    }
    const next = region.values[name].map(formatNumber);
    if (!sameRecordedValues(recordedForm(sourceRegion.values[name]), next)) changed.push({ name, next });
  }
  return changed;
}

function rewriteRegion(text, regionName, changed) {
  const body = findRegionBody(text, regionName);
  if (!body) throw new Error(FAIL.regionNotInText(regionName));
  let result = text;
  for (const { name, next, missing } of changed) {
    if (missing) throw new Error(FAIL.cannotAdd(name));
    const slot = findBareParameter(result, body, name);
    if (!slot) throw new Error(FAIL.parameterNotInText(name));
    const content = ` ${next.join(" ")}`;
    result = result.slice(0, slot.start) + content + result.slice(slot.end);
    body.end += content.length - (slot.end - slot.start);
  }
  return result;
}

export function patchKeyframeXml(originalXml, document) {
  const original = String(originalXml || "");
  const source = parseKeyframeXml(original);
  const patched = [...document.regions].reduce((text, region) => {
    const sourceRegion = findRegion(source, region.name);
    if (!sourceRegion) throw new Error(FAIL.noSourceRegion(region.name));
    const changed = changedParameters(region, sourceRegion);
    return changed.length > 0 ? rewriteRegion(text, region.name, changed) : text;
  }, original);
  verifyKeyframeXml(patched, document);
  return patched;
}
