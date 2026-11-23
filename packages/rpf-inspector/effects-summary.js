// Сводка эффектов редукса: сборка из результатов разбора, слияние по архивам поста и текст для журнала.

export const EFFECT_TABLE = /(?:^|\/)(?:common|x64)\/data\/effects\/[^/]+\.(?:dat|meta|xml|ymt)$/i;
export const EFFECT_CORE = /(?:^|\/)core(?:_hi|_lo)?\.ypt$/i;

const WAITS = "ptfx-core-release";
const EMPTY_PTFX_KEY = "ypt";
const TEXT_TAIL =
  "Трассер и перерисованные текстуры ставятся в ядро эффектов игрока отдельными карточками после проверки в игре; свои словари частиц пока не переносятся.";

const CORE_GROUPS = [
  ["tracer", "tracers", "трассеры"],
  ["blood", "blood", "кровь"],
  ["muzzle", "flashes", "вспышки выстрела"],
  ["impact", "impacts", "попадания"],
  ["smoke", "smoke", "дым"],
  ["fire", "fire", "огонь и взрывы"],
  ["water", "water", "вода"],
  ["other", "other", "прочее"],
];

// Объекты обычные: имя наследуемого свойства как вид или id даёт мусор намеренно.
const KEY_OF_KIND = Object.fromEntries(CORE_GROUPS.map(([kind, key]) => [kind, key]));
const WORD_OF_KEY = Object.fromEntries(CORE_GROUPS.map(([, key, word]) => [key, word]));

function stemOf(path) {
  const file = String(path || "").split("/").pop();
  const dot = file.lastIndexOf(".");
  return (dot < 0 ? file : file.slice(0, dot)).toLowerCase();
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

// Порядок ключей сводки постоянный, пустые поля опускаются.
function assemble({ changed, emptied, dictionaries, tables, textureDictionaries }) {
  const summary = {};
  if (changed.length) summary.changed = changed;
  if (Object.keys(emptied).length) summary.emptied = emptied;
  if (dictionaries.length) summary.dictionaries = dictionaries;
  if (tables.length) summary.tables = tables;
  if (textureDictionaries.length) summary.textureDictionaries = textureDictionaries;
  summary.waits = WAITS;
  return summary;
}

class CoreTally {
  groups = new Map();
  emptied = {};

  group(key) {
    if (!this.groups.has(key)) this.groups.set(key, { textures: 0, added: 0 });
    return this.groups.get(key);
  }

  count({ kind, change }) {
    const key = KEY_OF_KIND[kind] || "other";
    if (change === "blanked") this.emptied[key] = (this.emptied[key] || 0) + 1;
    else if (change === "changed") this.group(key).textures += 1;
    else if (change === "added") this.group(key).added += 1;
  }

  changedRows() {
    return [...this.groups].map(([id, { textures, added }]) =>
      added ? { id, textures, added } : { id, textures },
    );
  }
}

export function effectsSummaryOf({
  core = null,
  dictionaries = [],
  tables = [],
  bloodRules = [],
  textureDictionaries = [],
} = {}) {
  const tally = new CoreTally();
  for (const item of core || []) tally.count(item);
  const { emptied } = tally;
  const changed = tally.changedRows();

  const emptyCount = dictionaries.filter((row) => row.empty).length;
  if (emptyCount) emptied[EMPTY_PTFX_KEY] = emptyCount;
  const ownDictionaries = dictionaries
    .filter((row) => !row.empty)
    .map((row) => stemOf(row.path))
    .sort();

  const tableNames = [...new Set(tables.map(stemOf))].sort();

  if (bloodRules.length) {
    let blood = changed.find((row) => row.id === "blood");
    if (!blood) {
      blood = { id: "blood", textures: 0 };
      changed.push(blood);
    }
    blood.rules = [...new Set(bloodRules)].sort();
  }

  const textures = textureDictionaries
    .map((row) => ({ name: stemOf(row.path), empty: Boolean(row.empty) }))
    .sort(byName);

  const hasData =
    changed.length ||
    Object.keys(emptied).length ||
    ownDictionaries.length ||
    tableNames.length ||
    textures.length;
  if (!hasData) return null;

  return assemble({
    changed,
    emptied,
    dictionaries: ownDictionaries,
    tables: tableNames,
    textureDictionaries: textures,
  });
}

function atLeast(current, value) {
  return Math.max(current, Number(value || 0));
}

// Любое ложное `changed` (пустая строка, 0, false, NaN) читается как пустой список — и здесь, и в тексте.
function mergeChangedRows(summaries) {
  const merged = new Map();
  for (const summary of summaries) {
    for (const row of summary.changed || []) {
      if (!merged.has(row.id)) merged.set(row.id, { textures: 0, added: 0, rules: new Set() });
      const slot = merged.get(row.id);
      slot.textures = atLeast(slot.textures, row.textures);
      slot.added = atLeast(slot.added, row.added);
      for (const rule of row.rules ?? []) slot.rules.add(rule);
    }
  }
  return [...merged].map(([id, { textures, added, rules }]) => {
    const row = { id, textures };
    if (added) row.added = added;
    if (rules.size) row.rules = [...rules].sort();
    return row;
  });
}

function mergeEmptied(summaries) {
  const emptied = {};
  for (const summary of summaries) {
    for (const [key, value] of Object.entries(summary.emptied ?? {})) {
      emptied[key] = Math.max(emptied[key] ?? 0, Number(value));
    }
  }
  return emptied;
}

function unionSorted(summaries, field) {
  const names = new Set();
  for (const summary of summaries) {
    for (const name of summary[field] ?? []) names.add(name);
  }
  return [...names].sort();
}

function mergeTextureDictionaries(summaries) {
  const latest = new Map();
  for (const summary of summaries) {
    for (const row of summary.textureDictionaries ?? []) latest.set(row.name, row);
  }
  return [...latest.values()].sort(byName);
}

export function mergeEffectsSummaries(list = []) {
  const summaries = list.filter(Boolean);
  if (summaries.length === 0) return null;
  return assemble({
    changed: mergeChangedRows(summaries),
    emptied: mergeEmptied(summaries),
    dictionaries: unionSorted(summaries, "dictionaries"),
    tables: unionSorted(summaries, "tables"),
    textureDictionaries: mergeTextureDictionaries(summaries),
  });
}

function wordOf(key) {
  return WORD_OF_KEY[key] || key;
}

// Каждый шаг даёт текст своей части или пустоту; порядок шагов — порядок частей.
const TEXT_PARTS = [
  ({ changed }) => {
    const rows = (changed || []).filter((row) => row.textures || row.added);
    if (rows.length === 0) return "";
    const items = rows.map(({ id, textures, added }) => {
      const own = added ? `, ещё ${added} своих` : "";
      return `${wordOf(id)} (${textures}${own})`;
    });
    return `перерисованы ${items.join(", ")}`;
  },
  ({ emptied }) => {
    const rows = Object.entries(emptied ?? {}).filter(([key]) => key !== EMPTY_PTFX_KEY);
    if (rows.length === 0) return "";
    // Сумма без приведения: счётчик-строка склеивается намеренно.
    const total = rows.reduce((sum, [, count]) => sum + count, 0);
    const items = rows.map(([key, count]) => `${wordOf(key)} ${count}`);
    return `сжаты в пустышки ради FPS ${total} текстур ядра (${items.join(", ")})`;
  },
  ({ emptied }) => (emptied?.[EMPTY_PTFX_KEY] ? `пустых словарей частиц ${emptied[EMPTY_PTFX_KEY]}` : ""),
  ({ dictionaries }) =>
    dictionaries?.length ? `свои словари частиц: ${dictionaries.join(", ")}` : "",
  ({ changed }) => {
    const row = (changed || []).find((candidate) => candidate.rules?.length);
    return row ? `кровь на своих частицах автора (${row.rules.join(", ")})` : "";
  },
  ({ tables }) => (tables?.length ? `изменены таблицы ${tables.join(", ")}` : ""),
  ({ textureDictionaries }) => {
    if (!textureDictionaries?.length) return "";
    const items = textureDictionaries.map(
      ({ name, empty }) => `${name}${empty ? " (пустой)" : ""}`,
    );
    return `словари текстур эффектов: ${items.join(", ")}`;
  },
];

export function effectsSummaryText(summary) {
  if (!summary) return "";
  const parts = TEXT_PARTS.map((part) => part(summary)).filter(Boolean);
  return `Эффекты автора: ${parts.join("; ")}. ${TEXT_TAIL}`;
}
