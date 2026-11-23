import {
  GUN_DRAFTS_KEY,
  putGunDraftEntry,
  readGunDraftEntries,
  writeGunDraftEntries,
} from "../../../../features/workshop/works/gun-draft-store.js";
import { serializeGunProject, parseGunProject } from "@modovik/gun-studio";

// Прежний единственный черновик (до того, как у каждого ствола появился свой).
const LEGACY_KEY = "astral.gun-studio.project.v1";
const BUILTIN = "builtin:";

// Результат работы или запасное значение, если она бросила.
const attempt = (job, fallback) => {
  try {
    return job();
  } catch {
    return fallback;
  }
};

const projectOf = (entry) => (entry?.project ? parseGunProject(entry.project) : null);

// Чей это был черновик: ствол из «builtin:<ствол>», иначе тот, кого сейчас читают.
function legacyOwner(project, reader) {
  const id = project.modelId;
  const isNamedBuiltin = typeof id === "string" && id.startsWith(BUILTIN) && id.length > BUILTIN.length;
  return isNamedBuiltin ? id.slice(BUILTIN.length) : reader;
}

function legacyProject(storage) {
  return attempt(() => {
    const text = storage.getItem(LEGACY_KEY);
    return text ? parseGunProject(text) : null;
  }, null);
}

/*
 * Переезд прежнего черновика к его стволу. Проект возвращается, когда читающему надо отдать
 * именно его: он и есть владелец, а своего черновика у владельца не было (копия легла или,
 * если записать не вышло, работа пока живёт только в прежнем ключе). Иначе null, и чтение
 * идёт обычным путём. Прежний ключ снимается лишь когда у владельца есть запись.
 */
function carryLegacyDraft(slot, storage) {
  const legacy = legacyProject(storage);
  if (!legacy) return null;
  const owner = legacyOwner(legacy, slot);
  const hadOwn = Boolean(readGunDraftEntries(storage)[owner]);
  const landed = hadOwn || putGunDraftEntry(owner, JSON.parse(serializeGunProject(legacy)), storage);
  const forReader = owner === slot && !hadOwn ? legacy : null;
  if (!landed) return forReader;
  return attempt(() => {
    storage.removeItem(LEGACY_KEY);
    return forReader;
  }, null);
}

function readGunDraft(slot, storage = globalThis.localStorage, key = GUN_DRAFTS_KEY) {
  return attempt(() => {
    const carried = key === GUN_DRAFTS_KEY ? attempt(() => carryLegacyDraft(slot, storage), null) : null;
    return carried ?? projectOf(readGunDraftEntries(storage, key)[slot]);
  }, null);
}

function writeGunDraft(slot, project, storage = globalThis.localStorage, key = GUN_DRAFTS_KEY) {
  return slot ? putGunDraftEntry(slot, JSON.parse(serializeGunProject(project)), storage, key) : false;
}

function clearGunDraft(slot, storage = globalThis.localStorage) {
  attempt(() => {
    const drafts = readGunDraftEntries(storage);
    if (slot in drafts) {
      delete drafts[slot];
      writeGunDraftEntries(drafts, storage);
    }
  });
}

const summarize = ([slot, entry]) => ({
  slot,
  updatedAt: entry?.updatedAt || "",
  project: entry?.project || null,
});

function listGunDrafts(storage = globalThis.localStorage) {
  return Object.entries(readGunDraftEntries(storage)).map(summarize);
}

export { CLOTHING_DRAFTS_KEY, GUN_DRAFTS_KEY } from "../../../../features/workshop/works/gun-draft-store.js";
export { clearGunDraft, listGunDrafts, readGunDraft, writeGunDraft };
