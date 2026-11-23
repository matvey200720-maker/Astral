const STORE_KEY = "astral.builds.mod-names.v1";
const KEEP_LAST = 2000;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Любой сбой хранилища (нет, бросает при доступе, чтении или записи) превращается в запасное значение.
function attempt(job, fallback) {
  try {
    return job();
  } catch {
    return fallback;
  }
}

export function readModNames() {
  const parsed = attempt(() => JSON.parse(globalThis.localStorage.getItem(STORE_KEY)), null);
  return isRecord(parsed) ? parsed : {};
}

// Пары «id → имя» только там, где каталог знает непустое имя и оно отличается от записанного.
function* changedNames(ids, modsById, current) {
  for (const id of ids) {
    const raw = modsById.get(id)?.name;
    if (!raw) continue;
    const label = String(raw).trim();
    if (label !== "" && current?.[id] !== label) yield [id, label];
  }
}

function keepNewest(record) {
  const pairs = Object.entries(record);
  return pairs.length > KEEP_LAST ? Object.fromEntries(pairs.slice(-KEEP_LAST)) : record;
}

function saveNames(record) {
  attempt(() => globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(record)), undefined);
}

export function rememberModNames(ids, modsById, known) {
  const current = known !== undefined ? known : readModNames();
  let draft = null;
  for (const [id, label] of changedNames(ids, modsById, current)) {
    draft ??= { ...current };
    draft[id] = label;
  }
  if (draft === null) return current;
  const result = keepNewest(draft);
  saveNames(result);
  return result;
}
