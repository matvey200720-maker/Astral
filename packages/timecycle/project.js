// Проект неба: правки поверх файлов погоды игры («погода → регион → параметр →
// 13 чисел») и вид острова. Создание, правки, сводка, наложение на разобранный
// файл погоды, запись и чтение JSON.
import { SAMPLE_COUNT, findWeather, TIMECYCLE_REGIONS } from "./samples.js";
import { textBytes } from "./text-bytes.js";
import { cloneKeyframeDocument, findRegion } from "./keyframe-xml.js";
import { createLook, normalizeLook, lookIsNeutral, setGrayFrame } from "./look.js";

export const PROJECT_SCHEMA_VERSION = 2;

const LEGACY_SCHEMA_VERSION = 1;
const DEFAULT_NAME = "Моё небо";
const GRAY_FRAME_NAME = "Серый кадр";
const NAME_LIMIT = 120;
const SAMPLE_LIMIT = 100000;
const TEXT_LIMIT = 2 * 1024 * 1024;
const KNOWN_REGIONS = new Set(TIMECYCLE_REGIONS.map(({ id }) => id));
// Латинская буква и до 79 латинских букв, цифр, подчёркиваний.
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

const TEXTS = {
  weather: (weather) => `Неизвестный тип погоды: ${weather}`,
  region: (region) => `Неизвестный регион: ${region}`,
  parameter: (parameter) => `Недопустимое имя параметра: ${parameter}`,
  count: "Параметр таймцикла должен содержать 13 значений.",
  number: "Значение параметра таймцикла должно быть числом.",
  frame: (index) => `Опорный кадр вне диапазона: ${index}`,
  noRegion: (name) => `В файле нет региона ${name}.`,
  tooBig: "Проект неба превышает безопасный размер.",
  broken: "Проект неба повреждён.",
  version: (version) => `Проект неба сделан в другой версии редактора (${version}).`,
};

// ——— Имена: погода, регион, параметр ———

function weatherKey(weather) {
  const entry = findWeather(weather);
  if (!entry) throw new Error(TEXTS.weather(weather));
  return entry.id;
}

function regionKey(region) {
  const id = String(region || "").toUpperCase();
  if (!KNOWN_REGIONS.has(id)) throw new Error(TEXTS.region(region));
  return id;
}

// Место правки: погода проверяется раньше региона.
function placeOf(weather, region) {
  const weatherId = weatherKey(weather);
  return { weatherId, regionId: regionKey(region) };
}

function parameterKey(parameter) {
  const name = String(parameter || "");
  if (!PARAMETER_NAME.test(name)) throw new Error(TEXTS.parameter(parameter));
  return name;
}

const isObject = (value) => Boolean(value) && typeof value === "object";

// ——— Хранилище правок ———

// Все чтения и записи полок «погода → регион → параметр» и общая проверка
// значений. project читается при каждом обращении, а не при создании: отказы
// проверок имён опережают TypeError от проекта null.
class EditStore {
  constructor(project) {
    this.project = project;
  }

  // Новый массив из 13 конечных чисел, зажатых в ±100000.
  static row(values) {
    if (!Array.isArray(values) || values.length !== SAMPLE_COUNT) throw new Error(TEXTS.count);
    return Array.from(values, (raw) => {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(TEXTS.number);
      return Math.max(-SAMPLE_LIMIT, Math.min(SAMPLE_LIMIT, number));
    });
  }

  shelf({ weatherId, regionId }) {
    return this.project.weathers?.[weatherId]?.[regionId];
  }

  // Копия правки или null; имя параметра не проверяется.
  read(place, parameter) {
    const stored = this.shelf(place)?.[parameter];
    return Array.isArray(stored) ? stored.slice() : null;
  }

  // Значения проверяются до создания полок: отказ не оставляет в проекте пустую полку.
  write({ weatherId, regionId }, parameter, values) {
    const row = EditStore.row(values);
    const byRegion = (this.project.weathers[weatherId] ||= {});
    (byRegion[regionId] ||= {})[parameter] = row;
  }

  // Убирает правку и пустые полки по всему проекту; false — полки не было.
  remove(place, parameter) {
    const shelf = this.shelf(place);
    if (!shelf) return false;
    delete shelf[parameter];
    this.prune();
    return true;
  }

  prune() {
    const byWeather = this.project.weathers;
    for (const [weatherId, byRegion] of Object.entries(byWeather)) {
      for (const regionId of Object.keys(byRegion)) {
        if (keyCount(byRegion[regionId]) === 0) delete byRegion[regionId];
      }
      if (keyCount(byRegion) === 0) delete byWeather[weatherId];
    }
  }
}

const keyCount = (value) => Object.keys(value).length;

// Имя не длиннее предела и не кончается половиной суррогатной пары (эмодзи).
function clipName(name) {
  const clipped = String(name).slice(0, NAME_LIMIT);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

// ——— Создание ———

export function createProject(name = DEFAULT_NAME) {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: clipName(name),
    look: createLook(),
    weathers: {},
  };
}

// ——— Правки ———

// Порядок отказов: имя параметра, погода, регион, значения.
export function setParameter(project, { weather, region, parameter, values }) {
  const name = parameterKey(parameter);
  const place = placeOf(weather, region);
  new EditStore(project).write(place, name, values);
  return project;
}

export function readParameter(project, { weather, region, parameter }) {
  return new EditStore(project).read(placeOf(weather, region), parameter);
}

// Порядок отказов: кадр, погода, регион, исходные значения, имя параметра.
// Новый массив проверяется целиком до записи, поэтому отказ полок не оставляет.
export function setParameterSample(project, { weather, region, parameter, index, value, base }) {
  const slot = Number(index);
  if (!(Number.isInteger(slot) && slot >= 0 && slot < SAMPLE_COUNT)) throw new Error(TEXTS.frame(index));
  const place = placeOf(weather, region);
  // Правка проекта важнее base; base не массив — 13 нулей.
  const start = new EditStore(project).read(place, parameter) ?? (Array.isArray(base) ? base.slice() : Array(SAMPLE_COUNT).fill(0));
  const row = EditStore.row(start);
  row[slot] = Number(value) || 0;
  return setParameter(project, { weather: place.weatherId, region: place.regionId, parameter, values: EditStore.row(row) });
}

export function clearParameter(project, { weather, region, parameter }) {
  new EditStore(project).remove(placeOf(weather, region), parameter);
  return project;
}

// ——— Сводка ———

export function changedWeathers(project) {
  const byWeather = project?.weathers;
  if (!byWeather) return [];
  const hasEdits = (weatherId) => Object.values(byWeather[weatherId]).some((shelf) => keyCount(shelf) > 0);
  return Object.keys(byWeather).filter(hasEdits);
}

export function projectStats(project) {
  const weathers = changedWeathers(project).length;
  const shelfSizes = Object.values(project?.weathers ?? {}).flatMap((byRegion) => Object.values(byRegion).map(keyCount));
  const regions = shelfSizes.filter((size) => size > 0).length;
  const parameters = shelfSizes.reduce((sum, size) => sum + size, 0);
  const look = !lookIsNeutral(project?.look ?? createLook());
  return { weathers, regions, parameters, look, empty: parameters === 0 && !look };
}

export function projectIsEmpty(project) {
  return projectStats(project).empty;
}

// ——— Серый кадр ———

export function projectHasGrayFrame(project) {
  return project?.look?.weather?.grayFrame === true;
}

export function createGrayFrameProject(name = GRAY_FRAME_NAME) {
  const project = createProject(name);
  const withFlares = { ...project.look, weather: { ...project.look.weather, flares: true } };
  project.look = setGrayFrame(withFlares, true);
  return project;
}

export function withGrayFrame(project, on) {
  return { ...project, look: setGrayFrame(project.look, Boolean(on)) };
}

// ——— Разобранный файл погоды ———

// Позиции 0…12 — из правки, хвост длинного массива базы остаётся.
const overlay = (base, row) => base.map((old, slot) => (slot < SAMPLE_COUNT ? row[slot] : old));

export function applyProject(document, project, weather) {
  const weatherId = weatherKey(weather);
  const report = { document: cloneKeyframeDocument(document), applied: 0, skipped: [] };
  const byRegion = project?.weathers?.[weatherId];
  if (!byRegion) return report;

  for (const [regionName, parameters] of Object.entries(byRegion)) {
    const target = findRegion(report.document, regionName);
    for (const [parameter, values] of Object.entries(parameters)) {
      const base = target?.values[parameter];
      // Новых параметров в документ не добавляем.
      if (Array.isArray(base)) {
        target.values[parameter] = overlay(base, EditStore.row(values));
        report.applied += 1;
      } else {
        report.skipped.push(`${regionName}/${parameter}`);
      }
    }
  }
  return report;
}

export function resolveParameter(document, project, { weather, region, parameter }) {
  const edit = readParameter(project, { weather, region, parameter });
  if (edit !== null) return { values: edit, changed: true };
  const fromFile = findRegion(document, region)?.values?.[parameter];
  return { values: Array.isArray(fromFile) ? fromFile.slice() : null, changed: false };
}

const sameRow = (left, right) =>
  Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, slot) => value === right[slot]);

export function copyRegion(document, project, { weather, from, to }) {
  const source = findRegion(document, from);
  if (!source) throw new Error(TEXTS.noRegion(from));
  const target = findRegion(document, to);
  if (!target) throw new Error(TEXTS.noRegion(to));

  const valuesIn = (region, parameter) => resolveParameter(document, project, { weather, region: region.name, parameter }).values;
  const changes = [];
  for (const parameter of target.order) {
    const incoming = valuesIn(source, parameter);
    if (!incoming || sameRow(valuesIn(target, parameter), incoming)) continue;
    changes.push({ weather, region: target.name, parameter, values: incoming });
  }
  // Все правки проверяются до первой записи: отказ на одном параметре не оставляет
  // в проекте уже скопированные остальные.
  for (const { region, parameter, values } of changes) {
    parameterKey(parameter);
    placeOf(weather, region);
    EditStore.row(values);
  }
  for (const change of changes) setParameter(project, change);
  return project;
}

export function flattenParameter(document, project, { weather, region, parameter, index }) {
  const { values } = resolveParameter(document, project, { weather, region, parameter });
  if (!values) return project;
  // Номер кадра — целое от нуля (null — кадр 0); иначе отказ про номер, а не про «не число» в значениях.
  const frame = Number(index);
  if (!Number.isInteger(frame) || frame < 0) throw new Error(`Недопустимый номер кадра: ${index}`);
  const chosen = values[Math.min(frame, values.length - 1)];
  return setParameter(project, { weather, region, parameter, values: Array(SAMPLE_COUNT).fill(chosen) });
}

// ——— JSON ———

// Массив из одних чисел — в одну строку. Только вне строк JSON: имя «Небо [1, 2]»
// при записи не меняется.
const NUMBER_ARRAY = /\[\s*([-+0-9.eE]+(?:\s*,\s*[-+0-9.eE]+)*)\s*\]/y;
const oneLine = (items) => `[${items.split(",").map((item) => item.trim()).join(",")}]`;

function compactNumberArrays(json) {
  let out = "";
  let inString = false;
  for (let at = 0; at < json.length; at += 1) {
    const ch = json[at];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += json[at + 1];
        at += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === "[") {
      NUMBER_ARRAY.lastIndex = at;
      const match = NUMBER_ARRAY.exec(json);
      if (match) {
        out += oneLine(match[1]);
        at += match[0].length - 1;
        continue;
      }
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function guardSize(text) {
  if (textBytes(text) > TEXT_LIMIT) throw new Error(TEXTS.tooBig);
}

export function serializeProject(project) {
  const saved = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: project.name,
    look: normalizeLook(project.look),
    weathers: project.weathers || {},
  };
  const text = compactNumberArrays(JSON.stringify(saved, null, 2));
  guardSize(text);
  return `${text}\n`;
}

// Версия входа: 2 или прежняя 1 после Number(); у результата всегда 2.
function savedVersion(value) {
  const version = Number(value);
  if (version !== PROJECT_SCHEMA_VERSION && version !== LEGACY_SCHEMA_VERSION) throw new Error(TEXTS.version(value));
  return version;
}

// Правки входа тройками; ложная или не объектная погода или регион пропускаются.
function* savedEdits(byWeather) {
  for (const [weather, byRegion] of Object.entries(byWeather)) {
    if (!isObject(byRegion)) continue;
    for (const [region, parameters] of Object.entries(byRegion)) {
      if (!isObject(parameters)) continue;
      for (const [parameter, values] of Object.entries(parameters)) yield { weather, region, parameter, values };
    }
  }
}

// Схема сохранённого проекта: поле → проверка → значение по умолчанию (для
// ложного поля) → куда кладётся. when — читать ли поле вообще.
const SAVED_FIELDS = [
  { field: "schemaVersion", check: savedVersion, put: (project, version, seen) => { seen.version = version; } },
  { field: "name", fallback: DEFAULT_NAME, check: clipName, put: (project, name) => { project.name = name; } },
  // У первой схемы вид не читается: остаётся вид нового проекта.
  { field: "look", when: (seen) => seen.version === PROJECT_SCHEMA_VERSION, check: normalizeLook, put: (project, look) => { project.look = look; } },
  {
    field: "weathers",
    fallback: {},
    check: savedEdits,
    put: (project, edits) => {
      for (const edit of edits) setParameter(project, edit);
    },
  },
];

function fromSaved(raw) {
  const project = createProject();
  const seen = {};
  for (const { field, when, fallback, check, put } of SAVED_FIELDS) {
    if (when && !when(seen)) continue;
    const given = raw[field];
    put(project, check(fallback !== undefined && !given ? fallback : given), seen);
  }
  return project;
}

// Размер входа: строка — как есть, undefined — 0, иное — компактный JSON.
function inputText(input) {
  if (typeof input === "string") return input;
  return input === undefined ? "" : JSON.stringify(input);
}

export function parseProject(input) {
  guardSize(inputText(input));
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!isObject(raw) || Array.isArray(raw)) throw new Error(TEXTS.broken);
  return fromSaved(raw);
}
