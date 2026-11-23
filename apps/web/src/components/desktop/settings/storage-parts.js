// Классы видов места: A — освобождаемое (кэш), B — моды, W — работы, C — откатное и всё прочее.
// Это обычный объект, а не Map: имена с прототипа (constructor, toString…) остаются «известными»
// видами, и проверка `in` их пропускает — так было и раньше.
const KIND_GROUPS = [
  [
    "A",
    ["downloads", "engineAssets", "vegetationContent", "rebuildCache", "workPackages", "derived", "chromiumCache", "updates"],
  ],
  ["B", ["mods"]],
  ["W", ["works"]],
  ["C", ["restorePoints", "copyStore", "original", "rebases", "dlc", "composites", "recipes", "patches", "originals", "other"]],
];

export const KIND_CLASSES = Object.freeze(
  Object.fromEntries(KIND_GROUPS.flatMap(([cls, kinds]) => kinds.map((kind) => [kind, cls]))),
);

// Порядок видов резервных копий в панели.
export const BACKUP_KINDS = Object.freeze("original copyStore rebases composites restorePoints dlc".split(" "));

const PART_BY_CLASS = new Map([
  ["A", "cache"],
  ["B", "mods"],
  ["W", "mods"],
]);
// Порядок строк видов; класс вне списка (функция с прототипа) встаёт первым.
const CLASS_ORDER = ["A", "B", "W", "C"];

// Ложное (в том числе NaN) — ноль, отрицательное — ноль; нечисловая строка остаётся NaN.
function nonNegative(value) {
  return Math.max(0, value || 0);
}

function makePart(id, label, bytes) {
  return { id, label, bytes };
}

const partFrom = (spec) => makePart(...spec);

// Четвёртая часть «прочее» нужна, только если в ней есть что показать.
function withOther(parts, label, bytes) {
  if (!(bytes > 0)) return parts;
  return [...parts, makePart("other", label, bytes)];
}

// Записи описи, чей вид есть в таблице классов.
function knownKinds(budget) {
  const found = [];
  for (const entry of Object.entries(budget?.kinds || {})) {
    if (entry[0] in KIND_CLASSES) found.push(entry);
  }
  return found;
}

export function kindPart(kind) {
  return PART_BY_CLASS.get(KIND_CLASSES[kind]) ?? (kind === "other" ? "other" : "backups");
}

export function storageParts(status, words) {
  // Слова читаются первыми: без них падаем, даже если статуса нет.
  const { mods, cache, backups, other } = words;
  const cacheBytes = nonNegative(status?.usedBytes);
  const folderBytes = nonNegative(status?.backupBytes);
  const engine = status?.gameBackups;

  if (!engine || typeof engine.bytes !== "number") {
    return [["cache", cache, cacheBytes], ["backups", backups, folderBytes]].map(partFrom);
  }

  const modsBytes = nonNegative(engine.mods?.bytes);
  const copiesBytes = Math.max(0, engine.bytes);
  const parts = [
    ["mods", mods, modsBytes],
    ["cache", cache, cacheBytes],
    ["backups", backups, copiesBytes],
  ].map(partFrom);
  return withOther(parts, other, Math.max(0, folderBytes - copiesBytes - modsBytes));
}

export function budgetParts(budget, words) {
  const { mods, cache, backups, other } = words;
  const totals = knownKinds(budget).reduce(
    (sum, [kind, entry]) => {
      sum[kindPart(kind)] += nonNegative(entry?.bytes);
      return sum;
    },
    { mods: 0, cache: 0, backups: 0, other: 0 },
  );

  const parts = [
    ["mods", mods, totals.mods],
    ["cache", cache, totals.cache],
    ["backups", backups, totals.backups],
  ].map(partFrom);
  return withOther(parts, other, totals.other);
}

function byClassThenSize(a, b) {
  const classGap = CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls);
  return classGap || b.bytes - a.bytes;
}

// «Работы» отдельной строкой не показываются; пустые и нулевые виды тоже.
const isShownKind = ([kind, entry]) => kind !== "works" && entry?.bytes > 0;

function rowOf(freeable) {
  return function toRow([kind, entry]) {
    const cls = KIND_CLASSES[kind];
    const spare = nonNegative(freeable?.[kind]);
    return { kind, cls, bytes: entry.bytes, freeable: spare };
  };
}

export function budgetKindRows(budget) {
  const freeable = budget?.freeable;
  return knownKinds(budget).filter(isShownKind).map(rowOf(freeable)).sort(byClassThenSize);
}
