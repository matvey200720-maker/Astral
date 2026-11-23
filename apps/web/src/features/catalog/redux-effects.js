import { isCatalogBundle } from "../../catalog-utils.js";

// Потолок каждого длинного списка: защита окна от раздутой сводки.
const MAX_NAMES = 200;
// Ключ ypt в emptied — число опустошённых словарей частиц, а не группа.
const PARTICLE_DICTIONARIES_KEY = "ypt";

// Сводку эффектов автора редукса присылает сервер, поэтому ей не доверяем: типы проверяются,
// числа приводятся к целым от нуля, имена остаются только строками, неизвестная группа
// уходит в «other».

// Порядок показа: что заметнее в бою, то раньше.
export const EFFECT_GROUPS = Object.freeze([
  "tracers", "blood", "flashes", "impacts",
  "smoke", "fire", "water", "other",
]);

// Известные окну словари текстур эффектов и их знаки. В graphics лежат маски
// мини-карты, в frontend — логотип экрана загрузки.
export const TEXTURE_DICTIONARY_GLYPHS = Object.freeze(
  Object.fromEntries([
    ["fxweather", "weather"],
    ["peddamagedecals", "blood"],
    ["fxdecal", "impacts"],
    ["graphics", "sheet"],
    ["frontend", "sheet"],
  ]),
);

const GROUP_IDS = new Set(EFFECT_GROUPS);
const GLYPH_KEYS = new Set(Object.keys(TEXTURE_DICTIONARY_GLYPHS));

// Поля сводки, которые показываются списками; waits сам по себе показывать не заставляет.
const LIST_FIELDS = [
  "redrawn",
  "disabled",
  "emptyTextureDictionaries",
  "dictionaries",
  "textureDictionaries",
  "tables",
];

export function knownTextureDictionary(name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : null;
  return key !== null && GLYPH_KEYS.has(key) ? key : null;
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isObjectLike = (value) => typeof value === "object" && value !== null;

// Целое от нуля; всё остальное (строка «7», NaN, бесконечность, булево, отрицательное) — 0.
const wholeCount = (value) => (typeof value === "number" && value > 0 && value < Infinity ? Math.floor(value) : 0);

function groupOf(id) {
  if (GROUP_IDS.has(id)) return id;
  return "other";
}

const nonBlank = (value) => typeof value === "string" && value.trim().length > 0;

// Имена: только строки, края обрезаны, пустые и повторы отброшены, первые MAX_NAMES.
function namesOf(list) {
  if (!Array.isArray(list)) return [];
  const trimmed = list.filter(nonBlank).map((item) => item.trim());
  return [...new Set(trimmed)].slice(0, MAX_NAMES);
}

const freshRows = () => new Map(EFFECT_GROUPS.map((id) => [id, { id, textures: 0, added: 0, ownParticles: false }]));

// Строка списка changed прибавляется к своей группе; «своя кровь» — правила хоть у одной.
function addChange(rows, entry) {
  const row = rows.get(groupOf(entry.id));
  row.textures += wholeCount(entry.textures);
  row.added += wholeCount(entry.added);
  if (Array.isArray(entry.rules) && entry.rules.some(nonBlank)) row.ownParticles = true;
  return rows;
}

const isChanged = (row) => row.textures || row.added || row.ownParticles;

function redrawnOf(changed) {
  // Массив в списке — объект без полей: ничего не добавляет.
  const entries = Array.isArray(changed) ? changed.filter(isObjectLike) : [];
  const rows = entries.reduce(addChange, freshRows());
  return Array.from(rows.values()).filter(isChanged);
}

// emptied: ключ ypt — словари частиц, остальные ключи — группы (чужие уходят в other).
function emptiedOf(emptied) {
  const source = isRecord(emptied) ? emptied : {};
  const counts = Object.keys(source)
    .filter((key) => key !== PARTICLE_DICTIONARIES_KEY)
    .reduce((sums, key) => {
      const id = groupOf(key);
      return sums.set(id, sums.get(id) + wholeCount(source[key]));
    }, new Map(EFFECT_GROUPS.map((id) => [id, 0])));
  return {
    disabled: EFFECT_GROUPS.filter((id) => counts.get(id)).map((id) => ({ id, count: counts.get(id) })),
    particleDictionaries: wholeCount(source[PARTICLE_DICTIONARIES_KEY]),
  };
}

// Словарь текстур, названный несколько раз, пуст, лишь если пуст в каждой записи;
// порядок — по первому появлению имени.
function textureDictionariesOf(list) {
  const entries = Array.isArray(list) ? list : [];
  const verdicts = new Map();
  for (const entry of entries) {
    if (!isRecord(entry) || !nonBlank(entry.name)) continue;
    const name = entry.name.trim();
    const hollow = entry.empty === true;
    verdicts.set(name, verdicts.has(name) ? verdicts.get(name) && hollow : hollow);
  }
  const emptied = [];
  const own = [];
  for (const [name, hollow] of verdicts) {
    if (hollow) emptied.push(name);
    else own.push(name);
  }
  return { emptied: emptied.slice(0, MAX_NAMES), own: own.slice(0, MAX_NAMES) };
}

export function reduxEffectsOf(mod) {
  const summary = isCatalogBundle(mod) ? mod.domain?.effects : null;
  if (!isRecord(summary)) return null;

  const gone = emptiedOf(summary.emptied);
  const textures = textureDictionariesOf(summary.textureDictionaries);
  const effects = {
    redrawn: redrawnOf(summary.changed),
    disabled: gone.disabled,
    emptyDictionaries: gone.particleDictionaries,
    emptyTextureDictionaries: textures.emptied,
    dictionaries: namesOf(summary.dictionaries),
    textureDictionaries: textures.own,
    tables: namesOf(summary.tables),
    waits: nonBlank(summary.waits),
  };

  const worthShowing = effects.emptyDictionaries > 0 || LIST_FIELDS.some((field) => effects[field].length > 0);
  return worthShowing ? effects : null;
}
