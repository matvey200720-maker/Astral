import { STORAGE_KINDS } from "./storage-census.js";

const GIB = 1024 ** 3;

export const BUDGET_AUTO = "auto";
const BUDGET_FIXED = "fixed";
export const BUDGET_OPTIONS = Object.freeze([BUDGET_AUTO, ...[2.5, 5, 10, 20, 40].map((count) => count * GIB)]);
export const AUTO_SHARE = 0.25;
export const AUTO_MIN_BYTES = 3 * GIB;
export const AUTO_MAX_BYTES = 15 * GIB;
export const DISK_FLOOR_BYTES = 5 * GIB;
export const RECENT_USE_MS = 10 * 60 * 1000;

const FIXED_OPTIONS = BUDGET_OPTIONS.filter((option) => typeof option === "number");
// Прежние умолчания лимита загрузок: человек их не выбирал.
const OLD_DEFAULT_LIMITS = [2 * GIB, 7.5 * GIB];
const KEPT_CLASSES = new Set(["C", "W", "B"]);
const SHORTFALL_CLASSES = new Set(["C", "B"]);
const WORK_PREFIXES = [
  ["local-legacy-roads-", "roads"],
  ["local-legacy-vegetation-", "vegetation"],
];

const orDefault = (value, fallback) => (value === undefined ? fallback : value);

function clamp(value, range) {
  const [low, high] = range;
  return Math.min(high, Math.max(low, value));
}

function atLeastZero(value) {
  return Math.max(0, value);
}

function byBytesDescending(a, b) {
  return b.bytes - a.bytes;
}

function bySizeDesc(rows) {
  return rows.sort(byBytesDescending);
}

function storeOf(storePath) {
  const parts = storePath.split(/[\\/]/);
  return parts[parts.length - 1];
}

// При равном расстоянии первым идёт больший вариант.
function closestOption(bytes) {
  const ranked = FIXED_OPTIONS.slice().sort((a, b) => {
    const gap = Math.abs(a - bytes) - Math.abs(b - bytes);
    return gap || b - a;
  });
  return ranked[0];
}

// Явный выбор человека: «auto» или одно из чисел списка; иначе null.
function readChoice(budget) {
  if (budget !== BUDGET_AUTO) {
    const bytes = Number(budget);
    return FIXED_OPTIONS.includes(bytes) ? bytes : null;
  }
  return BUDGET_AUTO;
}

// Прежний лимит загрузок: годится конечное положительное число, кроме прежних умолчаний.
function readLegacy(limit) {
  const bytes = Number(limit);
  const checks = [Number.isFinite(bytes), bytes > 0, !OLD_DEFAULT_LIMITS.includes(bytes)];
  return checks.every(Boolean) ? closestOption(bytes) : BUDGET_AUTO;
}

export function budgetFromSettings(parsed = {}) {
  const choice = readChoice(parsed.budget);
  if (choice === null || choice === undefined) {
    return readLegacy(parsed.cacheLimitBytes);
  }
  return choice;
}

// Одна бегущая сумма на всё неснимаемое: строковые «байты» склеиваются в порядке описи.
function sumByClass(census) {
  const sums = { keep: 0, evictable: 0 };
  for (const [kind, row] of Object.entries(census?.kinds ?? {})) {
    const bytes = row?.bytes || 0;
    const letter = STORAGE_KINDS[kind];
    if (letter === "A") {
      sums.evictable += bytes;
    } else if (KEPT_CLASSES.has(letter)) {
      sums.keep += bytes;
    }
  }
  return sums;
}

function autoBounds(keep, diskFreeBytes) {
  let free = AUTO_MAX_BYTES / AUTO_SHARE;
  if (Number.isFinite(diskFreeBytes)) {
    free = diskFreeBytes;
  }
  const allowance = clamp(Math.floor(free * AUTO_SHARE), [AUTO_MIN_BYTES, AUTO_MAX_BYTES]);
  return {
    mode: BUDGET_AUTO,
    allowance,
    limitBytes: keep + allowance,
    floorBytes: DISK_FLOOR_BYTES,
  };
}

function fixedBounds(keep, budget) {
  const limitBytes = Number(budget);
  return {
    mode: BUDGET_FIXED,
    allowance: atLeastZero(limitBytes - keep),
    limitBytes,
    floorBytes: 0,
  };
}

export function budgetLimits(options) {
  const { budget, census } = options;
  const diskFreeBytes = orDefault(options.diskFreeBytes, null);
  const { keep, evictable } = sumByClass(census);
  let bounds;
  if (budget === BUDGET_AUTO) {
    bounds = autoBounds(keep, diskFreeBytes);
  } else {
    bounds = fixedBounds(keep, budget);
  }
  const { mode, allowance, limitBytes, floorBytes } = bounds;
  return { mode, keepBytes: keep, evictableBytes: evictable, allowance, limitBytes, floorBytes };
}

// Сколько не хватает по бюджету, по свободному месту диска и сколько нужно освободить.
function deviations(census, limits, incomingBytes, diskFreeBytes) {
  const { limitBytes, floorBytes: floor } = limits;
  const overBudget = census.bytes + incomingBytes - limitBytes;
  let overFloor = 0;
  if (floor && Number.isFinite(diskFreeBytes)) {
    overFloor = floor - (diskFreeBytes - incomingBytes);
  }
  const need = Math.max(0, overBudget, overFloor);
  return { overBudget, overFloor, need };
}

function isReclaimable(unit) {
  return STORAGE_KINDS[unit.kind] === "A" && unit.freeable > 0;
}

function isRecent(unit, now) {
  return now - unit.lastUsed < RECENT_USE_MS;
}

// Кандидаты в порядке описи; `protect` спрашивается только у годных по виду и объёму.
function* reclaimable(units, protect, now) {
  for (const unit of units) {
    if (!isReclaimable(unit)) continue;
    if (protect(unit.path)) continue;
    if (isRecent(unit, now)) continue;
    yield unit;
  }
}

// Берём кандидатов, пока освобождённое не дойдёт до нужного; следующего не запрашиваем.
function gather(candidates, need) {
  const plan = [];
  let freed = 0;
  let step = candidates.next();
  while (!step.done) {
    plan.push(step.value);
    freed += step.value.freeable;
    step = freed >= need ? { done: true } : candidates.next();
  }
  return { plan, freed };
}

export function planEviction(options) {
  const { census, limits } = options;
  const incomingBytes = orDefault(options.incomingBytes, 0);
  const diskFreeBytes = orDefault(options.diskFreeBytes, null);
  const now = options.now === undefined ? Date.now() : options.now;
  const protect = orDefault(options.protect, () => false);

  const { overBudget, overFloor, need } = deviations(census, limits, incomingBytes, diskFreeBytes);
  let gathered = { plan: [], freed: 0 };
  if (need > 0) {
    gathered = gather(reclaimable(census.units, protect, now), need);
  }
  const { plan, freed } = gathered;
  return {
    need,
    plan,
    freed,
    shortfall: atLeastZero(need - freed),
    overBudget: atLeastZero(overBudget),
    overFloor: atLeastZero(overFloor),
  };
}

export function workNameOf(storeName) {
  const lower = `${storeName}`.toLowerCase();
  for (const [prefix, name] of WORK_PREFIXES) {
    if (lower.startsWith(prefix)) return name;
  }
  return "work";
}

// Как описать единицу каждого вида в недоборе.
function describeMod(unit) {
  return { store: storeOf(unit.path), bytes: unit.bytes };
}

function describeWork(unit) {
  const store = storeOf(unit.path);
  return { store, name: workNameOf(store), bytes: unit.bytes, path: unit.path };
}

const DESCRIBE_UNIT = { mods: describeMod, works: describeWork };

function storesOf(census, kind) {
  const ofKind = census.units.filter((unit) => unit.kind === kind);
  return bySizeDesc(ofKind.map(DESCRIBE_UNIT[kind]));
}

export function modStores(census) {
  return storesOf(census, "mods");
}

// Строка вида читается без защиты, но только у видов классов C и B.
function heldBackKinds(census) {
  const held = [];
  for (const [kind, row] of Object.entries(census.kinds)) {
    if (SHORTFALL_CLASSES.has(STORAGE_KINDS[kind]) && row.bytes > 0) {
      held.push({ kind, bytes: row.bytes });
    }
  }
  return bySizeDesc(held);
}

function enoughFor(needBytes) {
  for (const option of FIXED_OPTIONS) {
    if (option >= needBytes) return option;
  }
  return BUDGET_AUTO;
}

export function budgetShortfall(options) {
  const { census, limits } = options;
  const overdraft = limits.keepBytes - limits.limitBytes;
  if (overdraft > 0 && limits.mode === BUDGET_FIXED) {
    return {
      bytes: overdraft,
      needBytes: limits.keepBytes,
      kinds: heldBackKinds(census),
      works: storesOf(census, "works"),
      mods: modStores(census),
      enough: enoughFor(limits.keepBytes),
    };
  }
  return null;
}
