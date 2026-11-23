// Профиль оптимизации — документ { schemaVersion, enabled, updatedAt }. Всё
// остальное (включена ли карточка, оценка нагрузки, план правок) выводится из
// списка `enabled`. Изменения профиля идут через один редуктор команд.
import { OPTIMIZER_TOTAL_LOAD, OPTIMIZER_TWEAK_MAP, OPTIMIZER_TWEAKS } from "./catalog.js";

export const OPTIMIZER_SCHEMA_VERSION = 1;

// Место каждого id в каталоге: по нему список приводится к порядку каталога.
const CATALOG_RANK = new Map(OPTIMIZER_TWEAKS.map((tweak, index) => [tweak.id, index]));

const LIGHT_BELOW = 0.2;
const NOTICEABLE_BELOW = 0.5;

// Карта — обычный объект с прототипом, поэтому `constructor` и `__proto__`
// «находятся» в ней; это поведение каталога намеренно не скрывается.
const findTweak = (id) => OPTIMIZER_TWEAK_MAP[id];

// Порядок каталога; чужие значения и повторы выпадают.
function catalogOrder(ids) {
  return [...new Set(ids)]
    .filter((id) => CATALOG_RANK.has(id))
    .sort((left, right) => CATALOG_RANK.get(left) - CATALOG_RANK.get(right));
}

export function createOptimizerProfile(input = {}) {
  const listed = input.enabled;
  const recognized = Array.isArray(listed) ? listed.filter((id) => findTweak(id)) : [];
  return {
    schemaVersion: OPTIMIZER_SCHEMA_VERSION,
    enabled: catalogOrder(recognized),
    updatedAt: String(input.updatedAt || ""),
  };
}

export function normalizeOptimizerProfile(value) {
  const isDocument = Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return createOptimizerProfile(isDocument ? value : undefined);
}

// Копия профиля с правкой списка; `edit` меняет множество включённых id.
function rewriteEnabled(profile, edit) {
  const enabled = new Set(profile.enabled);
  edit(enabled);
  return { ...profile, enabled: catalogOrder(enabled) };
}

const put = (enabled, id, on) => (on ? enabled.add(id) : enabled.delete(id));

// Неизвестный id или группа без переключателей: профиль возвращается тем же объектом.
const REDUCERS = {
  toggle(profile, { id, next }) {
    if (!findTweak(id)) return profile;
    return rewriteEnabled(profile, (enabled) => put(enabled, id, next === undefined ? !enabled.has(id) : Boolean(next)));
  },
  // Без `next` группа выключается — в отличие от toggle.
  group(profile, { id, next }) {
    const members = OPTIMIZER_TWEAKS.filter((tweak) => tweak.group === id);
    if (members.length === 0) return profile;
    return rewriteEnabled(profile, (enabled) => members.forEach((tweak) => put(enabled, tweak.id, next)));
  },
  clear: (profile) => ({ ...profile, enabled: [] }),
};

const reduceProfile = (profile, command) => REDUCERS[command.type](profile, command);

export const toggleTweak = (profile, tweakId, next) => reduceProfile(profile, { type: "toggle", id: tweakId, next });
export const toggleGroup = (profile, groupId, next) => reduceProfile(profile, { type: "group", id: groupId, next });
export const clearOptimizerProfile = (profile) => reduceProfile(profile, { type: "clear" });

function tierOf(relief) {
  if (relief <= 0) return "none";
  if (relief < LIGHT_BELOW) return "light";
  if (relief < NOTICEABLE_BELOW) return "noticeable";
  return "strong";
}

export function estimateOptimizerLoad(profile) {
  const listed = profile?.enabled || [];
  if (!Array.isArray(listed)) throw new TypeError("profile.enabled должен быть списком");

  // Один проход: повторы не схлопываются, группы идут в порядке первого появления.
  const tally = { count: 0, load: 0, groups: new Set(), looks: 0, changesFiles: false };
  for (const id of listed) {
    const tweak = findTweak(id);
    if (!tweak) continue;
    tally.count += 1;
    tally.load += tweak.load;
    tally.groups.add(tweak.group);
    if (tweak.risk === "look") tally.looks += 1;
    if (!tally.changesFiles) tally.changesFiles = tweak.recipe.kind !== "game";
  }

  const relief = tally.load / OPTIMIZER_TOTAL_LOAD;
  return {
    count: tally.count,
    total: OPTIMIZER_TWEAKS.length,
    load: tally.load,
    maxLoad: OPTIMIZER_TOTAL_LOAD,
    relief,
    percent: Math.round(relief * 100),
    tier: tierOf(relief),
    groups: [...tally.groups],
    changesFiles: tally.changesFiles,
    visualChanges: tally.looks,
  };
}
