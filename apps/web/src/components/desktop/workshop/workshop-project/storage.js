import { WORKSHOP_DRAFT_KEY, WORKSHOP_DRAFTS_KEY, WORKSHOP_STORAGE_KEY } from "./constants.js";
import { migrateWorkshopProject } from "./project.js";

// Проекты мастерской и черновики восстановления в localStorage.
// Записи, которые не удалось привести к проекту, не теряются: они уходят в карантин
// и при каждой записи возвращаются в хвост списка.

const DRAFT_LIMIT = 4;

const here = () => globalThis.localStorage;
const stampNow = () => new Date().toISOString();

// Выполнить и вернуть результат; любое исключение заменяется запасным значением.
const attempt = (job, otherwise) => {
  try {
    return job();
  } catch {
    return otherwise;
  }
};

const migrated = (value) => attempt(() => migrateWorkshopProject(value), null);

// ---------- проекты ----------

const storedList = (storage) => {
  const list = attempt(() => JSON.parse(storage.getItem(WORKSHOP_STORAGE_KEY) || "[]"), []);
  return Array.isArray(list) ? list : [];
};

// Исход одной записи: мигрированный проект или запись для карантина.
// Миграция ставит «сейчас»; настоящее время сохранения берём из самой записи.
function revive(raw) {
  try {
    const project = migrateWorkshopProject(raw);
    const savedAt = raw.updatedAt;
    if (typeof savedAt === "string" && savedAt) project.updatedAt = savedAt;
    return { project };
  } catch (error) {
    return { rejected: { raw, reason: error?.message || "invalid" } };
  }
}

export function readWorkshopProjectRecords(storage = here()) {
  const revived = storedList(storage).map(revive);
  const newerFirst = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
  return {
    projects: revived.flatMap(({ project = [] }) => project).sort(newerFirst),
    quarantined: revived.flatMap(({ rejected = [] }) => rejected),
  };
}

export const readWorkshopProjects = (storage) => readWorkshopProjectRecords(storage).projects;

export function writeWorkshopProjects(projects, storage = here()) {
  if (!storage) return;
  const { quarantined } = readWorkshopProjectRecords(storage);
  const combined = [...projects, ...quarantined.map((entry) => entry.raw)];
  storage.setItem(WORKSHOP_STORAGE_KEY, JSON.stringify(combined));
}

export function upsertWorkshopProject(project, storage = here()) {
  const saved = migrateWorkshopProject({ ...project, updatedAt: stampNow() });
  const existing = readWorkshopProjects(storage);
  writeWorkshopProjects([saved, ...existing.filter((other) => other.id !== saved.id)], storage);
  clearProjectDraft(saved.id, storage);
  return saved;
}

// ---------- черновики по проектам ----------

const PLAIN_OBJECT = "[object Object]";

// «id проекта → запись»; всё, что не обычный объект, читается как пустое.
function loadDrafts(storage) {
  const found = attempt(() => JSON.parse(storage.getItem(WORKSHOP_DRAFTS_KEY) || "{}"), null);
  return Object.prototype.toString.call(found) === PLAIN_OBJECT ? found : {};
}

// Штамп всегда больше любого из уже записанных: два сохранения в одну миллисекунду различимы.
function nextStamp(drafts) {
  let stamp = Date.now();
  for (const record of Object.values(drafts)) {
    stamp = Math.max(stamp, (Number(record?.stamp) || 0) + 1);
  }
  return stamp;
}

const newerStampFirst = (a, b) => (b.stamp || 0) - (a.stamp || 0);

// Записи без проекта отпадают, свежие вперёд, остаются четыре.
function freshestEntries(entries) {
  const withProject = entries.filter((pair) => pair[1]?.project);
  withProject.sort((a, b) => newerStampFirst(a[1], b[1]));
  return withProject.slice(0, DRAFT_LIMIT);
}

// Не влезло — ещё раз только с самым свежим; и это не влезло — молча ничего.
function commitDrafts(entries, storage) {
  if (entries.length === 0) {
    storage.removeItem(WORKSHOP_DRAFTS_KEY);
    return;
  }
  const tries = [entries, entries.slice(0, 1)];
  tries.some((chosen) =>
    attempt(() => {
      const text = JSON.stringify(Object.fromEntries(chosen));
      storage.setItem(WORKSHOP_DRAFTS_KEY, text);
      return true;
    }, false),
  );
}

function putProjectDraft(storage, project, { base, origin, clean }) {
  const drafts = loadDrafts(storage);
  const record = Object.assign(
    { at: stampNow(), stamp: nextStamp(drafts), base, project },
    origin && { origin },
    clean && { clean },
  );
  commitDrafts(freshestEntries(Object.entries({ ...drafts, [project.id]: record })), storage);
  storage.removeItem(WORKSHOP_DRAFT_KEY);
}

export function saveRecoveryDraft(project, storage = here(), options = {}) {
  const { base = "", origin = null, clean = false } = options;
  if (!storage) return;
  if (project?.id) putProjectDraft(storage, project, { base, origin, clean });
  else storage.setItem(WORKSHOP_DRAFT_KEY, JSON.stringify(project));
}

export function draftBase(savedFingerprint) {
  const text = String(savedFingerprint || "");
  let hash = 2166136261;
  for (const symbol of text.split("")) {
    hash = Math.imul(hash ^ symbol.charCodeAt(0), 16777619);
  }
  return `${text.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

const draftOf = (storage, id) => loadDrafts(storage)[id] ?? {};

export function readProjectDraft(id, base, storage = here()) {
  const draft = draftOf(storage, id);
  return draft.project && draft.base === base ? migrated(draft.project) : null;
}

export function readProjectDraftOrigin(id, storage = here()) {
  const origin = id ? draftOf(storage, id).origin : null;
  return origin ? migrated(origin) : null;
}

// Общий (прежний) черновик уходит, если он нечитаем, пуст или это тот же проект.
// Сбой снятия в первой попытке ловит тот же обработчик: снимаем ещё раз, и уже без защиты.
function dropLegacyDraft(id, storage) {
  const remove = () => storage.removeItem(WORKSHOP_DRAFT_KEY);
  try {
    const legacy = JSON.parse(storage.getItem(WORKSHOP_DRAFT_KEY));
    if (!legacy || legacy.id === id) remove();
  } catch {
    remove();
  }
}

export function clearProjectDraft(id, storage = here()) {
  if (!storage) return;
  dropLegacyDraft(id, storage);
  const drafts = loadDrafts(storage);
  if (!(id in drafts)) return;
  const others = Object.entries(drafts).filter(([key]) => key !== String(id));
  commitDrafts(freshestEntries(others), storage);
}

const isOpenDraft = (record) => Boolean(record?.project) && !record.clean;

export function readRecoveryDraft(storage = here()) {
  return attempt(() => {
    const legacy = storage.getItem(WORKSHOP_DRAFT_KEY);
    if (legacy) return migrateWorkshopProject(JSON.parse(legacy));
    const [newest] = Object.values(loadDrafts(storage)).filter(isOpenDraft).sort(newerStampFirst);
    return newest ? migrateWorkshopProject(newest.project) : null;
  }, null);
}
