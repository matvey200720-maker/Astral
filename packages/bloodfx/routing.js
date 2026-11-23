// Правка blood-routing-v1: нормализация, наложение на документ bloodfx.dat, снятие по журналу, слияние.

import { replaceToken } from "./document.js";
import {
  findBloodRecordSection,
  findBloodTable,
  BLOOD_BODY_PARTS,
  BLOOD_WEAPON_CLASSES,
  BLOODFX_EMPTY_NAME,
  BLOODFX_FIELD,
} from "./schema.js";

export const BLOOD_ROUTING_STRATEGY = "blood-routing-v1";

const MAX_ROUTES = 2200; // 4 таблицы × 22 кости × 25 классов
const MAX_EFFECTS = 256;

const columnsOf = (...keys) => keys.map((key) => BLOODFX_FIELD[key]);

const NAME_KEYS = ["fxSystem", "fxSystemBodyArmour", "fxSystemHeavyArmour", "fxSystemUnderwater"];
const TINT_COLUMNS = columnsOf("tintRed", "tintGreen", "tintBlue");
const DECAL_COLUMNS = columnsOf(
  "splatDecalNormal",
  "splatDecalSoak",
  "sprayDecalNormal",
  "sprayDecalSoak",
  "mistDecalNormal",
  "mistDecalSoak",
);
const SIZE_COLUMNS = columnsOf(
  "sizeAHighMin",
  "sizeAHighMax",
  "sizeALowMin",
  "sizeALowMax",
  "sizeBHighMin",
  "sizeBHighMax",
  "sizeBLowMin",
  "sizeBLowMax",
);

const listOf = (value) => (Array.isArray(value) ? value : []);
const plainText = (value) => String(value || "");
const isPresent = (value) => value !== undefined && value !== null;
const byLocale = (a, b) => a.localeCompare(b);

const isEntryNumber = (text) => text.length >= 1 && text.length <= 4 && [...text].every((ch) => ch >= "0" && ch <= "9");
const isEffectName = (name) => name.length <= 64 && /^[A-Za-z_]\w*$/.test(name);
const isJournalWord = (word) => /^[\w.+-]{1,64}$/.test(word);

const routeKey = ({ table, bodyPart, weaponClass }) => `${table}/${bodyPart}/${weaponClass}`;

// ---------- нормализация: разборщики полей «сырое значение -> каноническое или исключение» ----------

const knownId = (find, label) => (raw) => {
  const found = find(raw);
  if (!found) throw new Error(`${label}: ${raw}`);
  return found.id;
};

const memberOf = (list, label) => (raw) => {
  const text = plainText(raw);
  if (!list.includes(text)) throw new Error(`${label}: ${text}`);
  return text;
};

const entryNumber = (raw) => {
  const text = plainText(raw).trim();
  if (!isEntryNumber(text)) throw new Error(`Недопустимый номер записи bloodfx: ${text}`);
  return text;
};

const boundedNumber = (label, raw, min, max) => {
  const number = Number(raw);
  if (number >= min && number <= max) return number;
  throw new Error(`${label}: допустимо от ${min} до ${max}.`);
};

const rangeParser = (field, min, max) => (raw) => boundedNumber(field, raw, min, max);

const nameParser = (field) => (raw) => {
  const name = String(raw).trim();
  if (name === BLOODFX_EMPTY_NAME || isEffectName(name)) return name;
  throw new Error(`${field}: недопустимое имя эффекта «${name}».`);
};

// Дыры в массиве тона остаются дырами: map их не вызывает.
const parseTint = (raw) => {
  const parts = listOf(raw);
  if (parts.length !== 3) throw new Error("Тон записи bloodfx задаётся тремя числами.");
  return parts.map((part, index) => Math.round(boundedNumber(`tint[${index}]`, part, 0, 255)));
};

const parseDecals = (raw) => {
  if (raw === false) return raw;
  throw new Error("Декали записи bloodfx можно только выключить.");
};

const ROUTE_PARSERS = [
  ["table", knownId(findBloodTable, "Неизвестная таблица bloodfx")],
  ["bodyPart", memberOf(BLOOD_BODY_PARTS, "Неизвестная кость bloodfx")],
  ["weaponClass", memberOf(BLOOD_WEAPON_CLASSES, "Неизвестный класс оружия bloodfx")],
  ["entry", entryNumber],
];

const sectionParser = knownId(findBloodRecordSection, "Неизвестная секция записей bloodfx");

// Необязательные поля записи в каноническом порядке ключей.
const EFFECT_PARSERS = [
  ...NAME_KEYS.map((field) => [field, nameParser(field)]),
  ["tint", parseTint],
  ["sizeEvolution", rangeParser("sizeEvolution", 0, 25)],
  ["probability", rangeParser("probability", 0, 1)],
  ["sizeScale", rangeParser("sizeScale", 0.25, 4)],
  ["decals", parseDecals],
];

// Выдаёт проверку ключа: второй раз тот же ключ — ошибка с заданным текстом.
const claimKey = (describe) => {
  const taken = new Set();
  return (key) => {
    if (taken.has(key)) throw new Error(describe(key));
    taken.add(key);
  };
};

const routeNormalizer = () => {
  const claim = claimKey((key) => `Маршрут ${key} задан дважды.`);
  return (raw) => {
    const source = raw ?? {};
    const route = Object.fromEntries(ROUTE_PARSERS.map(([field, parse]) => [field, parse(source[field])]));
    claim(routeKey(route));
    return Object.freeze(route);
  };
};

const effectNormalizer = () => {
  const claim = claimKey((key) => `Запись ${key} задана дважды.`);
  return (raw) => {
    const source = raw ?? {};
    const section = sectionParser(source.section);
    const id = entryNumber(source.id);
    const key = `${section}/${id}`;
    claim(key);

    const given = EFFECT_PARSERS.flatMap(([field, parse]) =>
      isPresent(source[field]) ? [[field, parse(source[field])]] : [],
    );
    if (given.length === 0) throw new Error(`Запись ${key} не меняет ни одного поля.`);
    return Object.freeze({ section, id, ...Object.fromEntries(given) });
  };
};

const sealPatch = (routes, effects) => {
  const [sealedRoutes, sealedEffects] = [routes, effects].map((list) => Object.freeze(list));
  return Object.freeze({ strategy: BLOOD_ROUTING_STRATEGY, routes: sealedRoutes, effects: sealedEffects });
};

export const normalizeBloodRouting = (input = {}) => {
  const { routes: rawRoutes, effects: rawEffects } = input;
  const [routes, effects] = [rawRoutes, rawEffects].map(listOf);
  const limits = [
    [routes, MAX_ROUTES, "Слишком много маршрутов bloodfx."],
    [effects, MAX_EFFECTS, "Слишком много записей эффектов bloodfx."],
  ];
  for (const [list, max, message] of limits) {
    if (list.length > max) throw new RangeError(message);
  }

  const normalRoutes = routes.map(routeNormalizer());
  const normalEffects = effects.map(effectNormalizer());
  if (normalRoutes.length + normalEffects.length === 0) throw new Error("Правка bloodfx пуста.");
  return sealPatch(normalRoutes, normalEffects);
};

// ---------- общее для наложения и снятия ----------

// Строка таблицы по полям маршрута; отсутствующий маршрут читается как пустой.
const rowOfRoute = (document, route) => {
  const { table, bodyPart } = route ?? {};
  return document.tables?.[table]?.rows?.get(bodyPart);
};

const rowOfRecord = (document, record) => {
  const { section, id } = record ?? {};
  return document.records?.[section]?.rows?.get(id);
};

// Колонка класса оружия в строке таблицы: индекс класса + 1 (0 — класс не найден).
const classColumn = (route) => BLOOD_WEAPON_CLASSES.indexOf(route?.weaponClass) + 1;

const editorFor = (document, row) => ({
  read: (column) => row.tokens[column].text,
  put: (column, value) => replaceToken(document, row.line, row.tokens, column, value),
});

// Число «как образец»: без точки — целое, с точкой — столько же знаков после неё.
const fractionDigits = (sample) => (sample.includes(".") ? sample.length - sample.indexOf(".") - 1 : -1);

const likeSample = (sample, number) => {
  const digits = fractionDigits(sample);
  return digits < 0 ? String(Math.round(number)) : number.toFixed(digits);
};

const scaledWord = (previous, effect) => {
  const number = Number(previous);
  return Number.isFinite(number) ? likeSample(previous, number * effect.sizeScale) : undefined;
};

// ---------- поля записи: наложение (forward) и возврат по журналу (backward) ----------

// Одна колонка; в журнале изменение — { previous, value }.
const wordField = (key, column, render) => ({
  key,
  forward(editor, effect, required) {
    const wanted = effect[key];
    if (wanted === undefined) return undefined;
    const previous = editor.read(column);
    const value = render(wanted, previous, required);
    if (value === previous) return undefined;
    editor.put(column, value);
    return { previous, value };
  },
  *backward(changes) {
    yield [column, changes[key]?.value, changes[key]?.previous];
  },
});

// Несколько колонок; в журнале изменение — список { field, previous, value } только по тронутым колонкам.
const listField = (key, listColumns, isWanted, nextWord) => ({
  key,
  forward(editor, effect) {
    if (!isWanted(effect)) return undefined;
    const done = listColumns.flatMap((field) => {
      const previous = editor.read(field);
      const value = nextWord(previous, effect);
      if (value === undefined || value === previous) return [];
      editor.put(field, value);
      return [{ field, previous, value }];
    });
    return done.length > 0 ? done : undefined;
  },
  *backward(changes) {
    for (const { field, value, previous } of listOf(changes[key])) yield [field, value, previous];
  },
});

const nameField = (key) =>
  wordField(key, BLOODFX_FIELD[key], (wanted, _previous, required) => {
    if (wanted !== BLOODFX_EMPTY_NAME) required.add(wanted);
    return wanted;
  });

// Тон: запись об изменении есть всегда, даже если все три слова совпали.
const tintField = {
  key: "tint",
  forward(editor, { tint }) {
    if (!tint) return undefined;
    const previous = TINT_COLUMNS.map((column) => editor.read(column));
    TINT_COLUMNS.forEach((column, index) => {
      const word = String(tint[index]);
      if (word !== previous[index]) editor.put(column, word);
    });
    return { previous, value: [...tint] };
  },
  *backward(changes) {
    for (const [index, column] of TINT_COLUMNS.entries()) {
      yield [column, changes.tint?.value?.[index], changes.tint?.previous?.[index]];
    }
  },
};

// Порядок обработчиков — порядок ключей changes в отчёте и порядок возврата по журналу.
const FIELD_HANDLERS = [
  ...NAME_KEYS.map(nameField),
  tintField,
  wordField("sizeEvolution", BLOODFX_FIELD.sizeEvolution, (wanted, previous) => likeSample(previous, wanted)),
  wordField("probability", BLOODFX_FIELD.fxProbability, (wanted, previous) => likeSample(previous, wanted)),
  listField("decals", DECAL_COLUMNS, (effect) => effect.decals === false, () => "0"),
  listField("sizeScale", SIZE_COLUMNS, (effect) => effect.sizeScale !== undefined, scaledWord),
];

// ---------- наложение ----------

const applyRoute = (document, entries, route) => {
  if (!entries.has(route.entry)) {
    throw new Error(`Запись ${route.entry} отсутствует в BLOODFX_ENTRY_INFO — маршрут повис бы в пустоте.`);
  }
  const row = rowOfRoute(document, route);
  if (!row) throw new Error(`В таблице ${route.table} нет строки ${route.bodyPart}.`);
  const column = classColumn(route);
  const previous = row.tokens[column]?.text;
  const stale = previous !== undefined && previous !== route.entry;
  if (stale) replaceToken(document, row.line, row.tokens, column, route.entry);
  return stale ? [{ ...route, previous }] : [];
};

const applyEffect = (document, effect, required) => {
  const row = rowOfRecord(document, effect);
  if (!row) throw new Error(`Записи ${effect.id} нет в секции ${effect.section} этого bloodfx.dat.`);
  const editor = editorFor(document, row);
  const changes = Object.fromEntries(
    FIELD_HANDLERS.flatMap((handler) => {
      const change = handler.forward(editor, effect, required);
      return change === undefined ? [] : [[handler.key, change]];
    }),
  );
  return Object.keys(changes).length > 0 ? [{ section: effect.section, id: effect.id, changes }] : [];
};

const entryRows = (document) => {
  const rows = document.records?.entry?.rows;
  if (!rows) throw new Error("В документе bloodfx нет секции записей.");
  return rows;
};

export const applyBloodRouting = (document, input) => {
  const patch = normalizeBloodRouting(input);
  const entries = entryRows(document);
  const required = new Set();

  const routes = patch.routes.flatMap((route) => applyRoute(document, entries, route));
  const effects = patch.effects.flatMap((effect) => applyEffect(document, effect, required));
  return {
    strategy: BLOOD_ROUTING_STRATEGY,
    routes,
    effects,
    requiredEffectRules: [...required].sort(byLocale),
    changed: routes.length + effects.length > 0,
  };
};

// ---------- снятие по журналу ----------

// Слово для возврата или null: колонка всё ещё держит то, что записали мы, а прежнее слово безопасно.
const journalWord = (row, column, written, previous) => {
  if (!row || !isPresent(previous)) return null;
  const word = String(previous);
  if (!isJournalWord(word)) return null;
  const expected = String(written);
  return row.tokens[column]?.text === expected && word !== expected ? word : null;
};

// Лениво: каждый шаг читает документ только когда до него дошли.
function* journalSteps(document, report) {
  for (const route of listOf(report?.routes)) {
    const row = rowOfRoute(document, route);
    const column = classColumn(route);
    if (column > 0) yield [row, column, route.entry, route.previous];
  }
  for (const effect of listOf(report?.effects)) {
    const row = rowOfRecord(document, effect);
    const changes = effect?.changes || {};
    for (const handler of FIELD_HANDLERS) {
      for (const [column, written, previous] of handler.backward(changes)) yield [row, column, written, previous];
    }
  }
}

export const revertBloodRouting = (document, report) => {
  let restored = 0;
  for (const [row, column, written, previous] of journalSteps(document, report)) {
    const word = journalWord(row, column, written, previous);
    if (word === null) continue;
    replaceToken(document, row.line, row.tokens, column, word);
    restored += 1;
  }
  return restored;
};

// ---------- слияние и добавление классов ----------

// Тот же маршрут с другим номером записи — конфликт; тот же номер — остаётся первая копия.
const pickRoute = (known, route) => {
  if (known && known.entry !== route.entry) {
    throw new Error(`Два эффекта попадания претендуют на ${route.bodyPart}/${route.weaponClass}.`);
  }
  return known ?? route;
};

// Складывает поля extra в base; уже заданное поле с другим значением — конфликт.
const combine = (base, extra) => {
  for (const [field, value] of Object.entries(extra)) {
    if (Object.hasOwn(base, field) && JSON.stringify(base[field]) !== JSON.stringify(value)) {
      throw new Error(`Два эффекта попадания задают ${field} для записи ${extra.id}.`);
    }
    base[field] = value;
  }
  return base;
};

const absorb = (pool, patch) => {
  for (const route of patch.routes) {
    const key = routeKey(route);
    pool.routes.set(key, pickRoute(pool.routes.get(key), route));
  }
  for (const effect of patch.effects) {
    const key = `${effect.section}/${effect.id}`;
    pool.effects.set(key, combine(pool.effects.get(key) ?? {}, effect));
  }
  return pool;
};

export const mergeBloodRouting = (patches) => {
  const pool = [...patches].reduce((merged, patch) => absorb(merged, normalizeBloodRouting(patch)), {
    routes: new Map(),
    effects: new Map(),
  });
  return normalizeBloodRouting({
    effects: Array.from(pool.effects.values()),
    routes: Array.from(pool.routes.values()),
  });
};

const preparedFor = (extra, weaponClass) => {
  const prepared = extra?.[weaponClass];
  if (!Array.isArray(prepared) || prepared.length === 0) {
    throw new Error(`Для класса оружия ${weaponClass} заявка не приготовила маршрутов.`);
  }
  const stray = prepared.findIndex((route) => route?.weaponClass !== weaponClass);
  if (stray >= 0) {
    const route = prepared[stray];
    throw new Error(`Маршрут ${route?.bodyPart}/${route?.weaponClass} не относится к ${weaponClass}.`);
  }
  return prepared;
};

export const addBloodWeaponClasses = (input, extra = {}, classes = []) => {
  const patch = normalizeBloodRouting(input);
  const wanted = Array.isArray(classes) ? Array.from(new Set(classes.map(String))) : [];
  if (wanted.length === 0) return patch;
  const added = wanted.flatMap((weaponClass) => preparedFor(extra, weaponClass));
  return normalizeBloodRouting({ routes: [...patch.routes, ...added], effects: patch.effects });
};
