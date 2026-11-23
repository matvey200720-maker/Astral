import { addWorkTemplates, readWorkCode, savedWorkCode } from "../workshop/works/work-transfer.js";
import { workSignature } from "../workshop/install-queue/signature.js";
import { listWorkshopWorks } from "../workshop/works/workshop-works.js";
import { WORK_KINDS, gunSlotOf } from "../workshop/works/work-kinds.js";
import { readInstallRecord } from "../workshop/useInstallRecord.js";
import { normalizeBuildWorks, normalizeBuildWork } from "./build-works-model.js";
import { buildWorksEnabled } from "./works-switch.js";

export * from "./build-works-model.js";

// ---------- отпечаток кода ----------

export function workCodeFingerprint(code) {
  const text = String(code ?? "");
  return `${text.length}-${fnv1a32(text).toString(36)}`;
}

// FNV-1a по кодовым единицам UTF-16
function fnv1a32(text) {
  let hash = FNV_OFFSET;
  let at = 0;
  while (at < text.length) {
    hash = Math.imul(hash ^ text.charCodeAt(at++), FNV_PRIME);
  }
  return hash >>> 0;
}

// ---------- картинки слоёв попаданий ----------

// Любой сбой внутри — null: функция не отклоняется
export const impactPicturesFor = (work) => standingPictures(work).catch(() => null);

// Картинка слоя едет в сборку, только если в игре стоит именно она (совпал отпечаток при установке)
async function standingPictures(work) {
  const raw = JSON.parse(work.state);
  const [studio, installState, stamp] = await Promise.all([
    import("@modovik/ptfx-studio"),
    import("../../components/desktop/workshop/effects-install-state.js"),
    import("../../components/desktop/workshop/effects-stamp.js"),
  ]);

  const project = studio.serializeProject(studio.parseProject(raw));
  const layers = installState.uploadLayers(project);
  if (!layers.length) return null;

  const standing = readInstallRecord(installState.EFFECTS_INSTALL_KEY)?.installedPictures ?? {};
  const stored = stamp.storedPictureRecords();
  const keys = layers
    .map(({ zone, layer }) => studio.layerPictureKey(zone, layer))
    .filter((key) => stored[key] && stored[key].key === standing[key]);

  return keys.length ? Object.fromEntries(keys.map((key) => [key, stored[key]])) : null;
}

// ---------- сбор для новой сборки ----------

export async function collectInstalledBuildWorks({
  picturesFor = impactPicturesFor,
  projects = {},
  works = listWorkshopWorks(),
} = {}) {
  const records = [];
  for (const work of works) {
    if (!work.installed) continue;
    const record = await orNull(() => packRecord(planSavedWork(work, projects), picturesFor));
    if (record) records.push(record);
  }
  return normalizeBuildWorks(records);
}

export async function collectInstalledLibraryWorks(options = {}) {
  const { workItems = [], works, projects = {}, picturesFor = impactPicturesFor } = options;
  if (!buildWorksEnabled()) return [];

  const saved = await collectInstalledBuildWorks({ works, projects, picturesFor });
  const taken = new Set(saved.map((entry) => laneOf(entry.workKind, entry.slotId)));
  const standing = [];

  for (const item of workItems) {
    const plan = planInstalledItem(item, projects);
    if (!plan || taken.has(plan.lane)) continue;
    // не собралась запись (сбой или нет кода) — вид остаётся свободным для следующей работы
    const record = await orNull(() => packRecord(plan, picturesFor));
    if (!record) continue;
    taken.add(plan.lane);
    standing.push(record);
  }
  return normalizeBuildWorks([...saved, ...standing]);
}

// Одна работа не должна ломать сборку: любой сбой превращается в null
async function orNull(job) {
  try {
    return await job();
  } catch {
    return null;
  }
}

// «Дорожка» занятости: у видов «по стволу» вид + ствол, у остальных только вид
function laneOf(kind, slot) {
  return WORK_KINDS[kind]?.perSlot ? `${kind}:${slot}` : kind;
}

function projectFor(projects, projectId) {
  return (projectId && projects[projectId]) || null;
}

function wantsPictures(kind, snapshot) {
  return kind === PICTURE_KIND && Boolean(snapshot);
}

function planSavedWork(work, projects) {
  const { name, workKind, slotId, section } = work;
  return {
    fields: { name, workKind, slotId, section },
    codeInput: work,
    project: projectFor(projects, work.projectId),
    pictureInput: wantsPictures(workKind, work.state) ? work : undefined,
  };
}

// null — работу из библиотеки брать нельзя
function planInstalledItem(item, projects) {
  const kind = item.workKind;
  const kindInfo = WORK_KINDS[kind];
  if (!kindInfo) return null;

  const snapshot = item.work?.state ?? null;
  const projectId = item.work?.projectId || "";
  const project = projectFor(projects, projectId);
  if (kindInfo.studio ? !project : !snapshot) return null;

  const slot = kindInfo.perSlot ? gunSlotOf(snapshot) || item.slotId || "" : kindInfo.slotId || "";
  return {
    lane: laneOf(kind, slot),
    fields: { name: item.name, workKind: kind, slotId: slot, section: kindInfo.section || item.section || DEFAULT_SECTION },
    codeInput: { workKind: kind, state: snapshot || null, name: item.name, projectId },
    project,
    pictureInput: wantsPictures(kind, snapshot) ? { state: snapshot } : undefined,
  };
}

async function packRecord(plan, picturesFor) {
  const saved = await savedWorkCode(plan.codeInput, plan.project);
  const pictures = plan.pictureInput === undefined ? undefined : await picturesFor(plan.pictureInput);
  return normalizeBuildWork({
    ...plan.fields,
    code: typeof saved === "string" ? saved : saved?.code,
    pictures,
  });
}

// ---------- ввоз у получателя ----------

export async function importBuildWorks(entries, existing = listWorkshopWorks(), ledger = storedLedger) {
  const queue = normalizeBuildWorks(entries);
  const book = ledger.read();
  const world = { book, existing, alive: new Set(existing.map((work) => work.key)) };
  const report = { added: [], skipped: [], failed: [] };

  for (const entry of queue) {
    report[await settleEntry(entry, world)].push(entry.name);
  }
  ledger.write(book);
  return report;
}

// В какой список попадёт запись: added, skipped или failed
async function settleEntry(entry, world) {
  const fingerprint = workCodeFingerprint(entry.code);
  const knownKey = world.book[fingerprint];
  if (knownKey && world.alive.has(knownKey)) return "skipped";
  return importOne(entry, world, fingerprint).catch(() => "failed");
}

async function importOne(entry, { alive, book, existing }, fingerprint) {
  const { templates } = await readWorkCode(entry.code);
  const sample = templates.find((item) => item.kind === entry.workKind) ?? templates[0];

  const twin = existing.find((work) => work.workKind === entry.workKind && sameContent(work.state, sample?.state));
  if (twin) {
    book[fingerprint] = twin.key;
    return "skipped";
  }

  const created = await addWorkTemplates(
    templates.map((template) => ({ ...template, name: entry.name || template.name })),
  );
  const first = Array.isArray(created) ? created[0] : undefined;
  if (first) {
    const ledgerKey = first.projectId ? `project:${first.projectId}` : `work:${first.workId}`;
    book[fingerprint] = ledgerKey;
    alive.add(ledgerKey);
  }
  return "added";
}

// Подпись состояния, если оно строка с JSON; иначе null, и сравнение ложно
function contentSignature(state) {
  if (typeof state !== "string" || state === "") return null;
  return guarded(() => workSignature(JSON.parse(state)), null);
}

function sameContent(left, right) {
  const signature = contentSignature(left);
  return signature !== null && signature === contentSignature(right);
}

function guarded(action, fallback) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

// ---------- константы и леджер ----------

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const PICTURE_KIND = "impact";
const DEFAULT_SECTION = "redux";
const LEDGER_KEY = "astral.build-works.imported.v1";

// Леджер «отпечаток кода → ключ созданной работы» в localStorage; массив допускается как объект
const storedLedger = {
  read: () =>
    guarded(() => {
      const parsed = JSON.parse(globalThis.localStorage.getItem(LEDGER_KEY));
      return parsed !== null && typeof parsed === "object" ? parsed : {};
    }, {}),
  // не запомнилось — при повторе работа встанет снова, а не пропадёт
  write: (map) => void guarded(() => globalThis.localStorage.setItem(LEDGER_KEY, JSON.stringify(map)), null),
};
