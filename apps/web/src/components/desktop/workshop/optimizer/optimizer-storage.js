// Снимок применённого профиля оптимизации: переживает перезапуск, а при чтении
// приводится к актуальной форме. Пустое «в игре ничего нет» — отсутствие ключа.
import { normalizeOptimizerProfile } from "@modovik/optimizer";

const APPLIED_KEY = "astral.optimizer.applied.v1";

const asText = (value) => String(value || "");
const isObject = (value) => Object(value) === value;

// Как каждое поле снимка собирается из сырого объекта; порядок записей = порядок ключей.
const SNAPSHOT_FIELDS = {
  profile: (raw) => normalizeOptimizerProfile(raw.profile),
  appliedAt: (raw) => asText(raw.appliedAt),
  restorePointId: (raw) => asText(raw.restorePointId),
  files: (raw) => (Array.isArray(raw.files) ? raw.files.map((file) => String(file)) : []),
  // fromEntries заводит собственное свойство и для ключа «__proto__»
  settingsPrevious: ({ settingsPrevious }) =>
    Object.fromEntries(
      isObject(settingsPrevious)
        ? Object.entries(settingsPrevious).map(([name, value]) => [name, String(value)])
        : [],
    ),
};

// Сырой объект из хранилища или null; исключения хранилища и разбора не выходят.
function loadRaw(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(APPLIED_KEY));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readAppliedOptimizer(storage = globalThis.localStorage) {
  const raw = loadRaw(storage);
  if (raw === null) return null;
  const snapshot = {};
  for (const [name, build] of Object.entries(SNAPSHOT_FIELDS)) snapshot[name] = build(raw);
  return snapshot;
}

export function writeAppliedOptimizer(snapshot, storage = globalThis.localStorage) {
  try {
    const [method, ...args] =
      snapshot === null
        ? ["removeItem", APPLIED_KEY]
        : ["setItem", APPLIED_KEY, JSON.stringify(snapshot)];
    storage[method](...args);
  } catch {
    // переполнение, приватный режим, нет хранилища
  }
}

export const clearAppliedOptimizer = (storage = globalThis.localStorage) => {
  writeAppliedOptimizer(null, storage);
};

export function sameSelection(left, right) {
  const [first, second] = [left, right].map((profile) => profile?.enabled || []);
  if (first.length !== second.length) return false;
  return first.every((id, at) => id === second[at]);
}
